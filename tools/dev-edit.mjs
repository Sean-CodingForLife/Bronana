/* =========================================================
   dev-edit.mjs — **结构化文本编辑**（给 AGENT 与开发者用）
   ---------------------------------------------------------
   ## 它解决的问题：在 shell 里做文本编辑是**工具选错了**

   本项目用 PowerShell 干活，而实测下来它咬过 **6 类**（每类都真发生过）：

    1. **非 ASCII + 内嵌引号 → `ParserError`** —— 中文字符串里带 `"` 时，
       shell 的解析先于我的意图介入
    2. **反引号转义被展开** —— 反引号 n 会变成**真换行**，
       于是写进文件的是断成两行的东西，而不是字面 `\n`
    3. **CRLF vs LF 不匹配 ⇒ `.Replace()` 静默不命中** ——
       源文件是 LF、我按 `\n` 拼的搜索串是 CRLF（或反过来），
       于是"改了但没改到"，而且**不报错**
    4. **`+` 被当成算术** —— 多行字符串拼接写成 `+`，shell 拿它做加法 ⇒ `InvalidArgument`
    5. **`Set-Content` 写 CRLF** ⇒ 整文件变改动（家法里已记这一条）
    6. **正则替换带脚本块** ⇒ 正则把**注释里的同名文本**也改了

   ## patch 这一层自己咬过的 3 类（2026-10-02 起**结构性消除**）

   这一节是本文件存在的**第二层理由**：上面那 6 类是"shell 不适合做文本编辑"，
   下面这 3 类是"**我自己用这个工具时反复犯的错**"。它们的处置方式**不是**
   "记进注释、下次注意"（那正是本仓库家法反对的：凡是靠人记住的规范都会漂），
   而是**让错误不可能发生、或者发生时当场自证**：

     P1. **patch 的 JSON 里出现没转义的 ASCII 双引号** ⇒ 整份 patch 被 `JSON.parse` 拒掉。
         实测一轮里发生 **6 次**，每次都白烧一轮（中文文案里写 `"` 极容易漏转义）。
         ⇒ 现在：① `--patch-js x.mjs` 用 **JS 模块**写 patch（可用反引号整段包住，
         **完全不用转义**）；② 仍然用 JSON 时，报错会指出**第几行第几列**、
         把那一行打出来并点上插入符，同时说清这是哪一类错。

     P2. **手打的长锚点对不上** ⇒ 只说"一次都没命中"，等于没给任何线索（实测 3 次）。
         ⇒ 现在：失败的 op 会自己在文件里找**最接近的几行**（按双字组相似度 + 子串探测）
         并列出行号与原文 —— 让人一眼看出"文件里其实是这么写的"。

     P3. **`replaceAll` 的前缀碰撞** ⇒ `r * 0.1` 把 `r * 0.15` / `r * 0.12` 一起吃掉，
         **把源码改坏**（丢一整轮）。这类错误**默认没有声音**，而它改的是真代码。
         ⇒ 现在：① 每一处命中都连**行号与上下文**打出来（以前只说"命中 N 处"）；
         ② 命中边界**紧邻标识符/数字字符**时（正是前缀碰撞的形状）**直接拒绝**，
         要过就必须 ③ 加 `"word": true`（自动加整词护栏，`r * 0.1` 就不会再匹配 `r * 0.15`）
         或显式 `--allow-risk` 认账。

   > 一句话：**看不见的替换就是危险本身。** 所以本工具的原则是
   > "宁可吵，不可静默" —— 命中 0 次要说、命中多次要说、命中在哪要说、有碰撞风险要拦。

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

     # 写法 A（推荐，**零转义**）：patch 是一个 .mjs，用反引号包住任意文本
     export default { ops: [
       { op: 'replace', file: 'src/x.ts', from: `旧文本"带引号"`, to: `新文本"也带引号"` },
     ] };
     node tools/dev-edit.mjs --patch-js .tmp-patch.mjs

     # 写法 B：JSON（命令行上仍然只有 ASCII 路径）
     node tools/dev-edit.mjs --patch .tmp-patch.json

   支持的 op：

     { "op": "replace",      "file": "src/x.ts", "from": "旧", "to": "新" }          // from 必须唯一
     { "op": "replaceAll",   "file": "src/x.ts", "from": "旧", "to": "新", "word": true }
     { "op": "insertBefore", "file": "src/x.ts", "anchor": "某行", "text": "新内容" }
     { "op": "insertAfter",  "file": "src/x.ts", "anchor": "某行", "text": "新内容" }
     { "op": "writeLine",    "file": "src/x.ts", "match": "^import", "line": "新行" }

   · `"word": true`：把 `from` 两侧加上"整词"护栏（不许紧邻 `[\w$]`）——
     这是 P3 的正确解法：`r * 0.1` 便不再匹配 `r * 0.15`
   · `--code-only`：只改代码行，跳过注释行（防"正则误改注释"那一类）
   · `--dry`：只报会改什么，不写盘
   · `--allow-risk`：命中边界紧邻标识符时也照改（默认**拒绝**，见 P3）

   ## 为什么它比 shell 的字符串替换**安全**

     · **UTF-8 读写**：读原字节、按 UTF-8 解、按 UTF-8 写 —— 不碰编码
     · **行尾不猜**：把原文件统一成 LF 再匹配（这正是失败模式 3）
     · **`from` 必须唯一**：命中 0 次或 >1 次**都报错退出 1**（失败模式 3 的根治），
       且失败时**逐字节不写盘**（两阶段提交）
     · **注释/代码分域**：`--code-only` 只改**代码行** —— 跳过行注释、块注释的
       续行、以及块注释的起止行（这正是失败模式 6）
       ⚠ **本文件自己踩过这个坑**：我在这一段里写了块注释的**结束符**（两个字符
       `*` 与 `/` 挨着）来举例，**那个结束符把本注释提前关掉了**，于是下面那行
       裸的转义序列落到了代码位置 ⇒ `SyntaxError`。**讲转义的时候最容易踩转义。**
       所以这里只用**文字描述**，不写那个结束符。
     · **`\n` 是字面两字符**：JSON 字符串按 JSON 规则解，shell 不参与
     · **改完自检**：报告"改了几处 / 在哪几行 / 文件是否真的变了"，**不静默成功**

   ⚠ 它**不碰** `tools/` 里那些门的事 —— 这不是门，是**开发工具**（`dev-*`）。
   它自己的判据在 `test/dev-edit.mjs`（每条都拿真文件跑，包括上面 P1–P3）。
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');

/* ---------------- 参数（纯 ASCII） ---------------- */
function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const has = (name) => process.argv.includes('--' + name);
const PATCH = arg('patch', '');
const PATCH_JS = arg('patch-js', '');
const JSON_OUT = has('json');
const CODE_ONLY = has('code-only');
const DRY = has('dry');
const ALLOW_RISK = has('allow-risk');

if (!PATCH && !PATCH_JS) {
  console.log('\n=== dev-edit：结构化文本编辑 ===\n');
  console.log('  用法：node tools/dev-edit.mjs --patch-js <patch.mjs> [--code-only] [--dry] [--json]');
  console.log('        node tools/dev-edit.mjs --patch    <patch.json> [--code-only] [--dry] [--json]\n');
  console.log('  **推荐 .mjs**：patch 是 JS 模块，用反引号包文本 ⇒ **引号/中文完全不用转义**（P1 的根治）');
  console.log('    export default { ops: [ { op: \'replace\', file: \'src/x.ts\', from: `旧`, to: `新` } ] }\n');
  console.log('  JSON 写法也行（{ "ops": [ ... ] }），只是字符串里的 ASCII 双引号要写成 \\"：');
  console.log('      { "op": "replace",       "file": "src/x.ts", "from": "旧", "to": "新" },');
  console.log('      { "op": "insertBefore","file": "src/x.ts", "anchor": "某行", "text": "新内容" },');
  console.log('      { "op": "insertAfter", "file": "src/x.ts", "anchor": "某行", "text": "新内容" },');
  console.log('      { "op": "replaceAll",  "file": "src/x.ts", "from": "旧", "to": "新", "word": true },');
  console.log('      { "op": "writeLine",   "file": "src/x.ts", "match": "^import", "line": "新行" }');
  console.log('\n  ⚠ **为什么要有它**：见文件头 —— shell 做文本编辑实测咬过 6 类；');
  console.log('    而 patch 这一层自己又咬过 3 类（P1 JSON 引号 · P2 锚点对不上 · P3 前缀碰撞）。');
  console.log('  关键：**文本进 patch 文件，命令行上只有 ASCII 路径**。\n');
  console.log('  `"word": true`：from 两侧加整词护栏（P3 的正确解法）');
  console.log('  `--code-only`：只改代码行，跳过注释行（防"正则误改注释"那一类）');
  console.log('  `--allow-risk`：命中边界紧邻标识符时也照改（默认**拒绝**，见 P3）');
  console.log('  `--dry`：只报会改什么，不写盘\n');
  process.exit(0);
}

/* ---------------- 读 patch ---------------- */
/** JSON 解析失败时说清**在哪一行、哪一列**，并点明这十有八九是 P1（没转义的双引号）。 */
function jsonHint(src, e) {
  const lines = src.split(/\r?\n/);
  const m = /position (\d+)/.exec(e.message);
  const head = '✘ patch 不是合法 JSON：' + e.message;
  const advice = [
    '  ⚠ 十有八九是 **P1：字符串里出现了没转义的 ASCII 双引号**（中文文案里最常见）。',
    '  两条出路（都别再手数转义）：',
    '    ① 把它写成 \\" ；',
    '    ② 更省事：把 patch 存成 .mjs（`export default { ops: [...] }`），文本用反引号包起来，',
    '       命令行改成 `node tools/dev-edit.mjs --patch-js <那个 .mjs>` —— **零转义**。'
  ];
  if (!m) return [head, ...advice].join('\n');
  const pos = Number(m[1]);
  let line = 1, col = 1, acc = 0;
  for (let i = 0; i < lines.length; i++) {
    if (acc + lines[i].length + 1 > pos) { line = i + 1; col = pos - acc + 1; break; }
    acc += lines[i].length + 1;
  }
  const bad = lines[line - 1] === undefined ? '' : lines[line - 1];
  const caret = ' '.repeat(Math.max(0, col - 1)) + '^';
  return [head,
    '  第 ' + line + ' 行 第 ' + col + ' 列：',
    '    ' + bad,
    '    ' + caret,
    ...advice].join('\n');
}

async function loadPatch(file, forceJs) {
  const p = path.resolve(ROOT, file);
  if (!fs.existsSync(p)) throw new Error('✘ patch 文件不存在：' + file);
  if (forceJs || /\.(mjs|cjs|js)$/i.test(p)) {
    let mod;
    try {
      mod = await import(pathToFileURL(p).href + '?v=' + Date.now());
    } catch (e) {
      throw new Error('✘ 这个 JS patch **自己**就报错了（先单独跑通它再交给本工具）：' + e.message);
    }
    let v = mod.default;
    if (v === undefined) v = mod.patch !== undefined ? mod.patch : mod.ops;
    if (v === undefined) {
      throw new Error('✘ JS patch 里没找到 ops —— 要 `export default { ops: [...] }` 或 `export const ops = [...]`');
    }
    return v;
  }
  const src = fs.readFileSync(p, 'utf8');
  try { return JSON.parse(src); } catch (e) { throw new Error(jsonHint(src, e)); }
}

let patch;
try {
  patch = await loadPatch(PATCH_JS || PATCH, !!PATCH_JS);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
const ops = Array.isArray(patch) ? patch : patch.ops;
if (!Array.isArray(ops) || !ops.length) {
  console.error('✘ patch 里没有 ops（要么给数组，要么给 { ops: [...] }）');
  process.exit(1);
}

/* ---------------- 工具 ---------------- */
/** 读成 LF（**行尾不猜** —— 失败模式 3 的根治）。
 *  ⚠ **同一个文件被多个 op 碰到时，读的是内存里的工作副本**（见下面那段注释）——
 *  否则"三个 op 改一个文件"会变成"只有最后一个生效"，而报告上说三项都成功。 */
function readLF(file) {
  const p = path.resolve(ROOT, file);
  if (ORIG.has(p)) return { p, text: WORK.get(p).text, eol: ORIG.get(p).eol };
  if (!fs.existsSync(p)) return { err: '文件不存在：' + file };
  const raw = fs.readFileSync(p, 'utf8');
  const crlf = raw.indexOf('\r\n') >= 0;
  const text = raw.replace(/\r\n/g, '\n');
  const eol = crlf ? '\r\n' : '\n';
  ORIG.set(p, { text, eol });
  WORK.set(p, { text, eol });
  return { p, text, eol };
}
/* ⚠ **两阶段提交 · 第一半**（2026-10-02 修的真问题）：这里**不写盘**，只记下来。
   以前每个 op 成功就**立刻**写盘，而失败的 op 只 `failed++; continue;` ——
   于是文件头那句「失败一律不写盘、退出码 1」**只对失败的那个 op 成立，对整份 patch 不成立**。
   实测：一份 op1 合法 + op2 锚点不命中的 patch 跑完，**文件已被改坏**，
   而工具打印的是「失败不写盘」—— 把「保证说了 A、实际做 B」演了一遍。
   现在：全部 op 先在内存里跑，**任何一个失败 ⇒ 一个字节都不写**（见循环之后的第二半）。 */
/* ⚠ **第二次修（同一天）· 同一个文件里的多个 op**：两阶段提交本身带来一个新洞 ——
   每个 op 都从**磁盘**读一遍（循环期间没人写盘），于是"同一个文件的两个 op"各自算出的
   都是"原始文本 + 自己那处改动"，**最后一次写盘把前面的一起覆盖掉**，而工具报告"各项成功"。
   实测：一份 7 个 op、其中 4 个落在 `AGENTS.md` 上的 patch，**只有最后一个生效，前三个静默丢失**
   （是门 `doc-num` 变红才发现的 —— 也就是说"静默丢改动"这类错误连工具自己都不会叫）。
   现在改成**内存工作副本**：`ORIG` 是磁盘原样、`WORK` 是当前值；op 从 `WORK` 读、结果写回 `WORK`；
   **只有全部 op 都成功时才把 `WORK` 落盘**。两条性质同时成立：**累积生效** + **失败一个字节都不写**。 */
const ORIG = new Map();   /* 绝对路径 → { text, eol }：**磁盘原样** */
const WORK = new Map();   /* 绝对路径 → { text, eol }：**内存里的当前值** */
/** 一行是不是注释（**失败模式 6 的根治**） */
function isCommentLine(line) {
  const s = line.trimStart();
  return s.startsWith('//') || s.startsWith('/*') || s.startsWith('*') || s.startsWith('\u002a\u002f');
}
/** 把字面文本编成"整词"正则（`"word": true`）：两侧不许紧邻标识符字符。
    ⚠ **P3 的正确解法**：有了它，`r * 0.1` 就不会再匹配 `r * 0.15`。 */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function wordRe(from) {
  return new RegExp('(?<![\\w$])' + escapeRe(from) + '(?![\\w$])', 'g');
}
/** 在 text 里找 `needle`（或正则 `re`）：
 *  · 默认**全文**找；`--code-only` 时逐行找、跳过注释行
 *  返回 [{ start, end }]，命中数由调用方判。 */
function locate(text, needle, codeOnly, re) {
  const hits = [];
  const push = (start, end) => hits.push({ start, end });
  if (!codeOnly) {
    if (re) {
      const rx = new RegExp(re.source, 'g');
      let m;
      while ((m = rx.exec(text))) { push(m.index, m.index + m[0].length); if (!m[0].length) rx.lastIndex++; }
    } else {
      let i = text.indexOf(needle);
      while (i >= 0) { push(i, i + needle.length); i = text.indexOf(needle, i + needle.length); }
    }
    return hits;
  }
  /* 逐行：只在**非注释行**里找，且命中必须落在同一行内（一次编辑一行足够） */
  const lines = text.split('\n');
  let off = 0;
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    if (!isCommentLine(line)) {
      if (re) {
        const rx = new RegExp(re.source, 'g');
        let m;
        while ((m = rx.exec(line))) { push(off + m.index, off + m.index + m[0].length); if (!m[0].length) rx.lastIndex++; }
      } else {
        const k = line.indexOf(needle);
        if (k >= 0) push(off + k, off + k + needle.length);
      }
    }
    off += line.length + 1;
  }
  return hits;
}
const lineOf = (text, pos) => {
  let n = 1;
  for (let i = 0; i < pos && i < text.length; i++) if (text[i] === '\n') n++;
  return n;
};
/** 命中处的上下文（所在行，去空白、截断）——**P3 的"看得见"** */
function ctxOf(text, start, end) {
  let a = text.lastIndexOf('\n', start - 1) + 1;
  let b = text.indexOf('\n', end);
  if (b < 0) b = text.length;
  const s = text.slice(a, b).trim();
  const mark = text.slice(start, end);
  return (s.length > 120 ? s.slice(0, 117) + '...' : s) + '   ⟵ 命中的是「' + (mark.length > 40 ? mark.slice(0, 37) + '...' : mark) + '」';
}
/** 命中边界是否**紧邻标识符/数字字符** —— 这正是"前缀碰撞"的形状：
 *  `r * 0.1` 命中 `r * 0.15` 时，命中串后面紧跟 `5`（`\w`）⇒ 判为有风险。 */
function isPrefixRisk(text, start, end) {
  const W = /[\w$]/;
  return W.test(text[start - 1] || '') || W.test(text[end] || '');
}
/** 双字组 Dice 相似度（0~1），用于"最接近的几行" */
function dice(a, b) {
  const bg = (s) => {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) { const k = s.slice(i, i + 2); m.set(k, (m.get(k) || 0) + 1); }
    return m;
  };
  const A = bg(a), B = bg(b);
  let inter = 0, tot = 0;
  for (const [k, v] of A) { tot += v; const w = B.get(k); if (w) inter += Math.min(v, w); }
  for (const [, v] of B) tot += v;
  return tot ? (2 * inter) / tot : 0;
}
const squash = (s) => String(s).replace(/\s+/g, ' ').trim();
/** **P2 的根治**：锚点没命中时，自己去文件里找最接近的几行并列出来。
 *  两条判据合起来用：① 双字组相似度（对"写错几个字"最灵）；② 子串探测（对"只写了一部分"最灵）。 */
function nearestLines(text, needle, limit = 3) {
  const lines = text.split('\n');
  const want = squash(needle.split('\n')[0] || needle);
  if (!want) return [];
  const picked = new Map();   // 行号 → { line, text, why, score }
  for (let i = 0; i < lines.length; i++) {
    const s = squash(lines[i]);
    if (!s) continue;
    const sc = dice(s, want);
    if (sc >= 0.34) picked.set(i, { line: i + 1, text: lines[i], why: '相似度 ' + sc.toFixed(2), score: sc });
  }
  /* 子串探测：从完整串开始，按"掐一半"逐步缩短首尾，像剥洋葱一样找 */
  for (let len = want.length; len >= 6; len = Math.floor(len / 2)) {
    for (const probe of [want.slice(0, len), want.slice(-len)]) {
      if (probe.length < 6) continue;
      for (let i = 0; i < lines.length; i++) {
        if (picked.has(i)) continue;
        if (lines[i].includes(probe)) picked.set(i, { line: i + 1, text: lines[i], why: '含有「' + probe + '」', score: 0.5 });
      }
    }
    if (picked.size >= limit) break;
  }
  return [...picked.values()].sort((a, b) => b.score - a.score).slice(0, limit)
    .map(({ line, text, why }) => ({ line, text: text.length > 120 ? text.slice(0, 117) + '...' : text, why }));
}

/* ---------------- 跑 ops ---------------- */
const report = [];
let failed = 0;
const MAX_SHOWN_HITS = 8;

for (const op of ops) {
  const kind = op.op;
  const file = op.file;
  const r = readLF(file);
  if (r.err) { report.push({ ok: false, file, op: kind, why: r.err }); failed++; continue; }

  const before = r.text;
  let next = null;
  let note = '';
  let hitsInfo = [];

  if (kind === 'replace' || kind === 'replaceAll') {
    const from = String(op.from === undefined ? '' : op.from);
    const to = String(op.to === undefined ? '' : op.to);
    if (!from) { report.push({ ok: false, file, op: kind, why: 'from 是空的（那会替换任何位置）' }); failed++; continue; }
    const re = op.word ? wordRe(from) : null;
    const hits = locate(r.text, from, CODE_ONLY, re);
    if (!hits.length) {
      report.push({
        ok: false, file, op: kind,
        why: '**一次都没命中**（CRLF？缩进？内容对不上？）' + (op.word ? ' ⚠ 而且带 word 护栏，边界要求"两侧不是标识符字符"' : ''),
        from: from.slice(0, 60), near: nearestLines(r.text, from)
      });
      failed++; continue;
    }
    hitsInfo = hits.map((h) => ({
      line: lineOf(r.text, h.start),
      ctx: ctxOf(r.text, h.start, h.end),
      risk: op.word ? false : isPrefixRisk(r.text, h.start, h.end)
    }));
    if (kind === 'replace' && hits.length > 1) {
      report.push({
        ok: false, file, op: kind,
        why: '命中 ' + hits.length + ' 次而 op 是 replace（要求唯一）—— 要么用 replaceAll，要么把 from 写长一点',
        count: hits.length, hits: hitsInfo.slice(0, MAX_SHOWN_HITS)
      });
      failed++; continue;
    }
    /* **P3 的拦阻**：多处命中 + 边界紧邻标识符 ⇒ 默认**拒绝**（这正是把源码改坏的那一次） */
    const risky = hitsInfo.filter((h) => h.risk).length;
    if (risky && !ALLOW_RISK) {
      report.push({
        ok: false, file, op: kind, risk: risky,
        why: '**前缀碰撞风险**：' + risky + '/' + hits.length + ' 处命中的边界紧邻标识符或数字字符 —— ' +
          '这类替换会**静默地**把 `r * 0.15` 变成 `r * 0.15` 之外的别的东西（实测改坏过源码）。' +
          '解法：给 op 加 `"word": true`（自动加整词护栏）；确实要这样改就加命令行 `--allow-risk`',
        count: hits.length, hits: hitsInfo.slice(0, MAX_SHOWN_HITS)
      });
      failed++; continue;
    }
    /* 从后往前替换，避免位移 */
    next = r.text;
    for (let i = hits.length - 1; i >= 0; i--) {
      next = next.slice(0, hits[i].start) + to + next.slice(hits[i].end);
    }
    note = '命中 ' + hits.length + ' 处（' + hitsInfo.map((h) => '第 ' + h.line + ' 行').slice(0, MAX_SHOWN_HITS).join(' · ') +
      (hitsInfo.length > MAX_SHOWN_HITS ? ' …' : '') + '）' + (op.word ? ' · 整词护栏' : '') + (risky ? ' · --allow-risk' : '');

  } else if (kind === 'insertBefore' || kind === 'insertAfter') {
    const anchor = String(op.anchor || '');
    const text = String(op.text === undefined ? '' : op.text);
    if (!anchor) { report.push({ ok: false, file, op: kind, why: 'anchor 是空的' }); failed++; continue; }
    const hits = locate(r.text, anchor, CODE_ONLY, null);
    if (!hits.length) {
      report.push({ ok: false, file, op: kind, why: 'anchor 一次都没命中', near: nearestLines(r.text, anchor) });
      failed++; continue;
    }
    if (hits.length > 1) {
      hitsInfo = hits.map((h) => ({ line: lineOf(r.text, h.start), ctx: ctxOf(r.text, h.start, h.end), risk: false }));
      report.push({ ok: false, file, op: kind, why: 'anchor 命中 ' + hits.length + ' 次（要求唯一）', count: hits.length, hits: hitsInfo.slice(0, MAX_SHOWN_HITS) });
      failed++; continue;
    }
    const at = kind === 'insertBefore' ? hits[0].start : hits[0].end;
    next = r.text.slice(0, at) + (kind === 'insertBefore' ? text + '\n' : '\n' + text) + r.text.slice(at);
    note = (kind === 'insertBefore' ? '插在它之前' : '插在它之后') + '（第 ' + lineOf(r.text, hits[0].start) + ' 行）';

  } else if (kind === 'writeLine') {
    const re = new RegExp(String(op.match || ''));
    const lines = r.text.split('\n');
    let at = -1;
    for (let i = 0; i < lines.length; i++) {
      if (isCommentLine(lines[i])) continue;
      if (re.test(lines[i])) { at = i; break; }
    }
    if (at < 0) {
      report.push({ ok: false, file, op: kind, why: '没有一行匹配 ' + op.match, near: nearestLines(r.text, String(op.match || '')) });
      failed++; continue;
    }
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
  WORK.get(r.p).text = next;   /* **累积**：下一个碰到这个文件的 op 读到的就是它 */
  report.push({ ok: true, file, op: kind, note, bytes: next.length - before.length, dry: DRY, hits: hitsInfo.slice(0, MAX_SHOWN_HITS) });
}

/* ---------------- 报告 ---------------- */
/* ⚠ **两阶段提交 · 第二半**：只有**全部** op 都成功才写盘 ——
   这才对得起文件头那句「失败一律不写盘」。失败时 `WORK` 直接丢掉（内存里那点改动不影响磁盘）。
   写盘是**按文件**做的（`WORK` 已经累积了同一个文件上的所有改动），而且**没动过的文件不重写**。 */
if (!failed && !DRY) {
  for (const [p, w] of WORK) {
    if (w.text === ORIG.get(p).text) continue;
    fs.writeFileSync(p, w.text.replace(/\n/g, w.eol === '\r\n' ? '\r\n' : '\n'), 'utf8');
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify({ report, failed }));
  process.exit(failed ? 1 : 0);
}

console.log('\n=== dev-edit ===\n');
for (const x of report) {
  if (x.ok) {
    console.log('  ✔ ' + x.file + '  [' + x.op + ']  ' + x.note +
      '  · ' + (x.bytes >= 0 ? '+' : '') + x.bytes + ' 字节' + (x.dry ? '  （dry，未写盘）' : ''));
    /* **P3 的"看得见"**：多处命中时把每一处的行号与上下文都打出来 */
    if (x.hits && x.hits.length > 1) {
      for (const h of x.hits) console.log('      第 ' + h.line + ' 行： ' + h.ctx + (h.risk ? '   ⚠ 前缀碰撞风险' : ''));
    }
  } else {
    console.log('  ✘ ' + x.file + '  [' + x.op + ']  ' + x.why + (x.count ? '（命中 ' + x.count + ' 次）' : ''));
    if (x.hits) for (const h of x.hits) console.log('      第 ' + h.line + ' 行： ' + h.ctx + (h.risk ? '   ⚠ 前缀碰撞风险' : ''));
    /* **P2 的"自证"**：把文件里最接近的几行直接摆出来 */
    if (x.near && x.near.length) {
      console.log('      ⤷ 文件里最接近的 ' + x.near.length + ' 行（' + x.near[0].why + '）：');
      for (const n of x.near) console.log('        第 ' + n.line + ' 行： ' + n.text);
    }
  }
}
console.log('\n  ' + report.filter((x) => x.ok).length + ' 项成功 · ' + failed + ' 项失败');
if (failed) {
  console.log('\n  ⚠ **失败一律不写盘、退出码 1** —— 这就是它比 shell 的字符串替换安全的地方：');
  console.log('    shell 的 `.Replace()` 不命中时**静默不报**，而这个工具当场告诉你"一次都没命中"、');
  console.log('    并且（P2）把文件里最接近的几行摆出来，让你不必再猜"它到底是怎么写的"。');
}
process.exit(failed ? 1 : 0);
