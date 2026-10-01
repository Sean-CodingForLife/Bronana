/* =========================================================
   dev-edit.mjs — **结构化文本编辑**（给 AGENT 与开发者用）
   ---------------------------------------------------------
   ## 它解决的问题：在 shell 里做文本编辑是**工具选错了**

   本项目用 PowerShell 干活，而实测下来它咬过 **6 类**（每类都真发生过）：

     1. **非 ASCII + 内嵌引号 → `ParserError`** —— 中文字符串里带 `"` 时，
        shell 的解析先于我的意图介入（本轮至少 6 次）
     2. **反引号转义被展开** —— `"…`` `n …"` 里的 `` `n `` 会变成**真换行**，
        于是写进文件的是断成两行的东西，而不是字面 `\n`
     3. **CRLF vs LF 不匹配 ⇒ `.Replace()` 静默不命中** ——
        源文件是 LF、我按 `\n` 拼的搜索串是 CRLF（或反过来），
        于是"改了但没改到"，而且**不报错**
     4. **`+` 被当成算术** —— 多行字符串拼接写成 `+`，shell 拿它做加法 ⇒ `InvalidArgument`
     5. **`Set-Content` 写 CRLF** ⇒ 整文件变改动（家法里已记这一条）
     6. **`[regex]::Replace` 带脚本块** ⇒ 正则把**注释里的同名文本**也改了
        （本轮 3 处：`Comp.` → `requireComp().` 误伤了注释）

   ## 判据：什么情况下必须用这个工具而不是 shell

   | 条件 | 用什么 |
   | --- | --- |
   | 内容里**有非 ASCII**（中文注释/文案） | **本工具** |
   | 内容里**有引号 / 反斜杠 / 反引号** | **本工具** |
   | 内容**跨多行** | **本工具**（写 patch 文件，见下） |
   | 只是跑命令、看输出、`git` | shell 没问题 |

   ## 用法：**文本进文件，shell 只看见 ASCII 路径**

   这是关键设计 —— 只要中文/引号/多行出现在 shell 命令行上，问题就还在。
   所以文本一律走 patch 文件（用编辑器的 write 工具写，它保证 UTF-8 + LF）：

     # 1) 用 write 工具写一个 patch（JSON）：
     #    { "op":"replace", "file":"src/x.ts", "from":"旧文本", "to":"新文本" }
     # 2) shell 只传路径（纯 ASCII）：
     node tools/dev-edit.mjs --patch .tmp-patch.json

   ## 为什么它比 shell 的字符串替换**安全**

     · **UTF-8 读写**：读原字节、按 UTF-8 解、按 UTF-8 写 —— 不碰编码
     · **行尾不猜**：把原文件统一成 LF 再匹配（这正是失败模式 3）
     · **`from` 必须唯一**：命中 0 次或 >1 次**都报错退出 1**（失败模式 3 的根治）
     · **注释/代码分域**：`--code-only` 只改**代码行** —— 跳过行注释、块注释的
       续行、以及块注释的起止行（这正是失败模式 6）
       ⚠ **本文件自己踩过这个坑**：我在这一段里写了块注释的**结束符**（两个字符
       `*` 与 `/` 挨着）来举例，**那个结束符把本注释提前关掉了**，于是下面那行
       裸的转义序列落到了代码位置 ⇒ `SyntaxError`。**讲转义的时候最容易踩转义。**
       所以这里只用**文字描述**，不写那个结束符。
     · **`\n` 是字面两字符**：JSON 字符串按 JSON 规则解，shell 不参与
     · **改完自检**：报告"改了几处 / 文件是否真的变了"，**不静默成功**

   ⚠ 它**不碰** `tools/` 里那些门的事 —— 这不是门，是**开发工具**（`dev-*`）。
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

/* ---------------- 参数（纯 ASCII） ---------------- */
function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const has = (name) => process.argv.includes('--' + name);
const PATCH = arg('patch', '');
const JSON_OUT = has('json');
const CODE_ONLY = has('code-only');
const DRY = has('dry');

if (!PATCH) {
  console.log('\n=== dev-edit：结构化文本编辑 ===\n');
  console.log('  用法：node tools/dev-edit.mjs --patch <patch.json> [--code-only] [--dry] [--json]\n');
  console.log('  patch 是一个 JSON 文件（用编辑器的 write 工具写，保证 UTF-8 + LF）：');
  console.log('    { "ops": [');
  console.log('      { "op": "replace",       "file": "src/x.ts", "from": "旧", "to": "新" },');
  console.log('      { "op": "insertBefore","file": "src/x.ts", "anchor": "某行", "text": "新内容" },');
  console.log('      { "op": "insertAfter", "file": "src/x.ts", "anchor": "某行", "text": "新内容" },');
  console.log('      { "op": "replaceAll",  "file": "src/x.ts", "from": "旧", "to": "新" },');
  console.log('      { "op": "writeLine",   "file": "src/x.ts", "match": "^import", "line": "新行" }');
  console.log('    ] }\n');
  console.log('  ⚠ **为什么要有它**：见文件头 —— PowerShell 做文本编辑实测咬过 6 类');
  console.log('    （非 ASCII/引号 → ParserError · 反引号被展开 · CRLF 静默不命中 ·');
  console.log('     `+` 被当算术 · Set-Content 写 CRLF · 正则误改注释）。');
  console.log('  关键：**文本进 patch 文件，命令行上只有 ASCII 路径**。\n');
  console.log('  `--code-only`：只改代码行，跳过注释行（防"正则误改注释"那一类）');
  console.log('  `--dry`：只报会改什么，不写盘\n');
  process.exit(0);
}

/* ---------------- 读 patch ---------------- */
let patch;
try {
  patch = JSON.parse(fs.readFileSync(path.resolve(ROOT, PATCH), 'utf8'));
} catch (e) {
  console.error('✘ 读不了 patch：' + e.message);
  process.exit(1);
}
const ops = Array.isArray(patch) ? patch : patch.ops;
if (!Array.isArray(ops) || !ops.length) {
  console.error('✘ patch 里没有 ops（要么给数组，要么给 { "ops": [...] }）');
  process.exit(1);
}

/* ---------------- 工具 ---------------- */
/** 读成 LF（**行尾不猜** —— 失败模式 3 的根治）。
 *  返回 { text, eol } 并在写回时恢复**原来的**行尾风格。 */
function readLF(file) {
  const p = path.resolve(ROOT, file);
  if (!fs.existsSync(p)) return { err: '文件不存在：' + file };
  const raw = fs.readFileSync(p, 'utf8');
  const crlf = raw.indexOf('\r\n') >= 0;
  return { p, text: raw.replace(/\r\n/g, '\n'), eol: crlf ? '\r\n' : '\n' };
}
function writeBack(r) {
  fs.writeFileSync(r.p, r.text.replace(/\n/g, r.eol === '\r\n' ? '\r\n' : '\n'), 'utf8');
}
/** 一行是不是注释（**失败模式 6 的根治**） */
function isCommentLine(line) {
  const s = line.trimStart();
  return s.startsWith('//') || s.startsWith('/*') || s.startsWith('*') || s.startsWith('*/');
}
/** 在 text 里找 `needle`：
 *  · 默认**全文**找；`--code-only` 时逐行找、跳过注释行
 *  返回 { hits, replaceAt(lineIndex) } 形状的信息，命中数由调用方判。 */
function locate(text, needle, codeOnly) {
  const hits = [];
  if (!codeOnly) {
    let i = text.indexOf(needle);
    while (i >= 0) { hits.push({ start: i, end: i + needle.length }); i = text.indexOf(needle, i + needle.length); }
    return hits;
  }
  /* 逐行：只在**非注释行**里找，且 needle 必须落在同一行内（一次编辑一行足够） */
  const lines = text.split('\n');
  let off = 0;
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    if (!isCommentLine(line)) {
      const k = line.indexOf(needle);
      if (k >= 0) hits.push({ start: off + k, end: off + k + needle.length, line: n + 1 });
    }
    off += line.length + 1;
  }
  return hits;
}

/* ---------------- 跑 ops ---------------- */
const report = [];
let failed = 0;

for (const op of ops) {
  const kind = op.op;
  const file = op.file;
  const r = readLF(file);
  if (r.err) { report.push({ ok: false, file, op: kind, why: r.err }); failed++; continue; }

  const before = r.text;
  let next = null;
  let note = '';

  if (kind === 'replace' || kind === 'replaceAll') {
    const from = String(op.from === undefined ? '' : op.from);
    const to = String(op.to === undefined ? '' : op.to);
    if (!from) { report.push({ ok: false, file, op: kind, why: 'from 是空的（那会替换任何位置）' }); failed++; continue; }
    const hits = locate(r.text, from, CODE_ONLY);
    if (!hits.length) {
      report.push({ ok: false, file, op: kind, why: '**一次都没命中**（CRLF？缩进？内容对不上？）', from: from.slice(0, 60) });
      failed++; continue;
    }
    if (kind === 'replace' && hits.length > 1) {
      report.push({ ok: false, file, op: kind, why: '命中 ' + hits.length + ' 次而 op 是 replace（要求唯一）—— 要么用 replaceAll，要么把 from 写长一点', count: hits.length });
      failed++; continue;
    }
    /* 从后往前替换，避免位移 */
    next = r.text;
    for (let i = hits.length - 1; i >= 0; i--) {
      next = next.slice(0, hits[i].start) + to + next.slice(hits[i].end);
    }
    note = '命中 ' + hits.length + ' 处' + (hits[0].line ? '（首个在第 ' + hits[0].line + ' 行）' : '');

  } else if (kind === 'insertBefore' || kind === 'insertAfter') {
    const anchor = String(op.anchor || '');
    const text = String(op.text === undefined ? '' : op.text);
    if (!anchor) { report.push({ ok: false, file, op: kind, why: 'anchor 是空的' }); failed++; continue; }
    const hits = locate(r.text, anchor, CODE_ONLY);
    if (!hits.length) { report.push({ ok: false, file, op: kind, why: 'anchor 一次都没命中' }); failed++; continue; }
    if (hits.length > 1) { report.push({ ok: false, file, op: kind, why: 'anchor 命中 ' + hits.length + ' 次（要求唯一）' }); failed++; continue; }
    const at = kind === 'insertBefore' ? hits[0].start : hits[0].end;
    next = r.text.slice(0, at) + (kind === 'insertBefore' ? text + '\n' : '\n' + text) + r.text.slice(at);
    note = (kind === 'insertBefore' ? '插在它之前' : '插在它之后');

  } else if (kind === 'writeLine') {
    const re = new RegExp(String(op.match || ''));
    const lines = r.text.split('\n');
    let at = -1;
    for (let i = 0; i < lines.length; i++) {
      if (isCommentLine(lines[i])) continue;
      if (re.test(lines[i])) { at = i; break; }
    }
    if (at < 0) { report.push({ ok: false, file, op: kind, why: '没有一行匹配 ' + op.match }); failed++; continue; }
    lines[at] = String(op.line === undefined ? '' : op.line);
    next = lines.join('\n');
    note = '改写了第 ' + (at + 1) + ' 行';

  } else {
    report.push({ ok: false, file, op: kind, why: '不认识的 op（只有 replace / replaceAll / insertBefore / insertAfter / writeLine）' });
    failed++; continue;
  }

  if (next === before) {
    report.push({ ok: false, file, op: kind, why: '**算完了但文本没变** —— 是不是 to 与 from 一样？', note });
    failed++; continue;
  }
  if (!DRY) writeBack({ ...r, text: next });
  report.push({ ok: true, file, op: kind, note, bytes: next.length - before.length, dry: DRY });
}

/* ---------------- 报告 ---------------- */
if (JSON_OUT) {
  console.log(JSON.stringify({ report, failed }));
  process.exit(failed ? 1 : 0);
}

console.log('\n=== dev-edit ===\n');
for (const x of report) {
  if (x.ok) {
    console.log('  ✔ ' + x.file + '  [' + x.op + ']  ' + x.note +
      '  · ' + (x.bytes >= 0 ? '+' : '') + x.bytes + ' 字节' + (x.dry ? '  （dry，未写盘）' : ''));
  } else {
    console.log('  ✘ ' + x.file + '  [' + x.op + ']  ' + x.why + (x.count ? '（命中 ' + x.count + ' 次）' : ''));
  }
}
console.log('\n  ' + report.filter(x => x.ok).length + ' 项成功 · ' + failed + ' 项失败');
if (failed) {
  console.log('\n  ⚠ **失败一律不写盘、退出码 1** —— 这就是它比 shell 的字符串替换安全的地方：');
  console.log('    shell 的 `.Replace()` 不命中时**静默不报**，而这个工具当场告诉你"一次都没命中"。');
}
process.exit(failed ? 1 : 0);
