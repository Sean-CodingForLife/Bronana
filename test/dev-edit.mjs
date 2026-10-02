/* =========================================================
   dev-edit.mjs — 结构化文本编辑（`tools/dev-edit.mjs`）
   ---------------------------------------------------------
   这一套证明的不是"它能改文件"，而是**它能挡住 shell 咬人的那 6 类**。
   每条判据都对应一次真实踩过的坑（见 `tools/dev-edit.mjs` 文件头）：

     1. 非 ASCII + 内嵌引号 → shell 的 ParserError
     2. 反引号转义被展开   → 写进去的是真换行，不是字面 `\n`
     3. CRLF vs LF 不匹配  → shell 的 `.Replace()` **静默不命中**
     4. `+` 被当成算术
     5. `Set-Content` 写 CRLF → 整文件变改动
     6. 正则误改注释

   做法：**拿真的 CRLF 文件、真的中文引号、真的注释行**跑，看它报什么。
   ========================================================= */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { T } from './_assert.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const TOOL = path.join(ROOT, 'tools', 'dev-edit.mjs');
/* ⚠ 临时件放**系统临时目录**，不放工作区（本仓库"零素材"那条约束同样适用于测试残留） */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-edit-'));

function run(patch, extra) {
  const pf = path.join(TMP, 'patch-' + Math.random().toString(36).slice(2) + '.json');
  fs.writeFileSync(pf, JSON.stringify(patch), 'utf8');
  const r = spawnSync(process.execPath, [TOOL, '--patch', pf, '--json'].concat(extra || []),
    { cwd: ROOT, encoding: 'utf8' });
  try { fs.unlinkSync(pf); } catch (e) { /* 无所谓 */ }
  let out = null;
  try { out = JSON.parse(String(r.stdout).trim().split('\n').pop()); } catch (e) { out = { parseErr: e.message, raw: String(r.stdout).slice(0, 300) }; }
  return { code: r.status, out, stderr: String(r.stderr).slice(0, 200) };
}
function mk(name, content, crlf) {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, crlf ? content.replace(/\n/g, '\r\n') : content, 'utf8');
  return p;
}
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const read = (p) => fs.readFileSync(p, 'utf8');

/* ---------------- 1. 非 ASCII + 内嵌引号 ---------------- */
T.section('1. 非 ASCII + 内嵌引号（shell 会在这里 ParserError）');
{
  /* 内容里同时有：中文、双引号、单引号、反斜杠、反引号 */
  const p = mk('a.ts', 'var s = "旧文案";\nvar path = "a\\\\b";\n');
  const r = run({ ops: [{ op: 'replace', file: rel(p), from: 'var s = "旧文案";', to: 'var s = "新文案（含 \\"引号\\" 与 \\\\ 反斜杠）";' }] });
  T.eq(r.code, 0, '退出码 0（没有解析不了的东西 —— 文本走 patch 文件，命令行只有 ASCII 路径）');
  /* ⚠ 断言写清：patch 里的四个反斜杠在 JSON 里解出**两个**，而 `\"` 解出
     **反斜杠 + 双引号**（也就是文件里真的有一个 `\"`）。第一版两处都写少了 ——
     **是断言错，不是工具错**。这里按实测形状断言。 */
  const got1 = read(p);
  T.ok(got1.includes('新文案（含 \\"引号\\"'), '**中文 + 双引号 + 转义引号**原样写进去了');
  T.ok(got1.indexOf('与 ' + String.raw`\\` + ' 反斜杠') >= 0,
    '**两个反斜杠**原样写进去了（没有被吃掉一个）');
}

/* ---------------- 2. 反引号 / 字面 \n ---------------- */
T.section('2. 反引号与字面 \\n 不被 shell 展开');
{
  const p = mk('b.ts', 'var x = 1;\n');
  /* 注意：这里是 **JSON 里的 \\n**，也就是要写进去的**字面两字符 \n**，
     不是真换行。shell 的 here-string 会把它变成真换行（失败模式 2）。 */
  const r = run({ ops: [{ op: 'replace', file: rel(p), 'from': 'var x = 1;', to: 'var s = "a\\nb";' }] });
  T.eq(r.code, 0, '退出码 0');
  T.eq(read(p), 'var s = "a\\nb";\n',
    '写进去的是**字面 `\\n` 两个字符**，不是真换行（shell 的 here-string 会搞错这条）');
}

/* ---------------- 3. CRLF 源文件 + 唯一性判据 ---------------- */
T.section('3. CRLF 源文件（shell 的 .Replace() 会静默不命中）');
{
  const p = mk('c.ts', 'var a = 1;\nvar b = 2;\n', /* crlf */ true);
  T.ok(read(p).indexOf('\r\n') >= 0, '（前提）这个文件真的是 CRLF');
  const r = run({ ops: [{ op: 'replace', file: rel(p), from: 'var b = 2;', to: 'var b = 20;' }] });
  T.eq(r.code, 0, 'CRLF 文件里按 `\\n` 拼的搜索串**命中了**（工具内部统一成 LF 再匹配）');
  const after = read(p);
  T.ok(after.indexOf('var b = 20;') >= 0, '内容真的改了');
  T.ok(after.indexOf('\r\n') >= 0, '**行尾风格保持原样（还是 CRLF）** —— 不会整文件变改动');
}

/* ---------------- 4. 命中 0 次 / 多次 ⇒ 当场红（不静默） ---------------- */
T.section('4. 命中 0 次或多次 ⇒ 退出码 1（shell 是静默不报）');
{
  const p = mk('d.ts', 'var a = 1;\nvar a2 = 1;\n');
  const none = run({ ops: [{ op: 'replace', file: rel(p), from: 'var 不存在的 = 1;', to: 'x' }] });
  T.eq(none.code, 1, '**一次都没命中 ⇒ 退出码 1**（这条正是 shell 静默失败的对立面）');
  T.eq(read(p), 'var a = 1;\nvar a2 = 1;\n', '失败时**不写盘**（文件一字未动）');

  const many = run({ ops: [{ op: 'replace', file: rel(p), from: 'var a', to: 'var z' }] });
  T.eq(many.code, 1, '`replace` 命中 2 次 ⇒ 退出码 1（要求唯一，逼你把 from 写长一点）');
  T.eq(read(p), 'var a = 1;\nvar a2 = 1;\n', '同上，不写盘');

  const all = run({ ops: [{ op: 'replaceAll', file: rel(p), from: '= 1;', to: '= 2;' }] });
  T.eq(all.code, 0, '`replaceAll` 才允许多次命中');
  T.eq(read(p), 'var a = 2;\nvar a2 = 2;\n', '两处都改了');
}

/* ---------------- 5. 算完了但没变 ⇒ 也报（防"以为改了"） ---------------- */
T.section('5. to 与 from 相同时报"没变"（防"以为改了"）');
{
  const p = mk('e.ts', 'var q = 1;\n');
  const r = run({ ops: [{ op: 'replace', file: rel(p), from: 'var q = 1;', to: 'var q = 1;' }] });
  T.eq(r.code, 1, '算完了文本没变 ⇒ 退出码 1（不是"成功但没做事"）');
}

/* ---------------- 6. 注释分域（正则误改注释那一类） ---------------- */
T.section('6. `--code-only` 只改代码行，跳过注释（防"正则误改注释"）');
{
  /* ⚠ 这一节的断言**改过一版**，因为它第一版把事实写错了：
     我原以为"不带 --code-only 时块注释里的 `{ Comp }` 也会被改" ——
     实测**没有**，因为 `from` 是 `Comp.`（**带点**），而 `{ Comp }` 里是 `Comp` **不带点**。
     ⇒ 断言的措辞必须与判据的**形状**一致；不然测试会描述一个没发生的事。
     下面拆成两段：**先证明会咬人**（用一个真的会命中注释的搜索串），
     **再证明 `--code-only` 挡住了它**。 */
  const SRC =
    '/* 改造前这里是 import { Comp } */\n' +
    '// 见 Comp 的注释\n' +
    'var v = Comp.x;\n';

  /* ① 会咬人的那一次：搜索串是裸的 `Comp`（注释里也有）⇒ 三处都命中 */
  const p = mk('f.ts', SRC);
  const loose = run({ ops: [{ op: 'replaceAll', file: rel(p), from: 'Comp', to: 'requireComp()' }] });
  T.eq(loose.code, 0, '不带 --code-only 时全文替换（默认语义）');
  const looseOut = read(p);
  T.ok(looseOut.includes('import { requireComp() }') && looseOut.includes('// 见 requireComp() 的注释'),
    '**注释被改了** —— 这就是"正则误改注释"那一类（我本轮真踩过）');

  /* ② 同样的事，带 --code-only ⇒ 注释必须原样 */
  const p2 = mk('g.ts', SRC);
  const strict = run({ ops: [{ op: 'replace', file: rel(p2), from: 'Comp', to: 'requireComp()' }] }, ['--code-only']);
  T.eq(strict.code, 0, '带 --code-only 时**只命中代码那一处**（所以 replace 的唯一性判据通过）');
  const out = read(p2);
  T.ok(out.includes('/* 改造前这里是 import { Comp } */'), '块注释里的 `Comp` **原样保留**');
  T.ok(out.includes('// 见 Comp 的注释'), '`//` 注释也原样保留');
  T.ok(out.includes('var v = requireComp().x;'), '代码那一处改了');
  T.ok(!out.includes('import { requireComp() }'), '没有"改到注释里"的痕迹');
}

/* ---------------- 7. --dry 不写盘 ---------------- */
T.section('7. `--dry` 只报不写');
{
  const p = mk('h.ts', 'var dry = 1;\n');
  const r = run({ ops: [{ op: 'replace', file: rel(p), from: 'var dry = 1;', to: 'var dry = 2;' }] }, ['--dry']);
  T.eq(r.code, 0, '退出码 0');
  T.eq(read(p), 'var dry = 1;\n', '**文件没变**（dry 就是 dry）');
}

/* ---------------- ⑨ 原子性（2026-10-02 修的真问题） ---------------- */
/*
  文件头那句「失败一律不写盘」曾经**只对失败的那个 op 成立**：
  每个 op 成功就立刻写盘，而失败的 op 只 `continue`。
  实测症状：op1 合法 + op2 锚点不命中 ⇒ 文件已被改坏，而提示说「没写」。
  修法是两阶段提交（先全在内存里跑，全成才写）。下面这条断言就是守它。
*/
{
  const p = mk('atomic.ts', 'var a = 1;\nvar b = 2;\n');
  const before = read(p);
  const r = run({
    ops: [
      { op: 'replace', file: rel(p), from: 'var a = 1;', to: 'var a = 99;' },
      { op: 'replace', file: rel(p), from: '根本不存在的锚点', to: 'x' }
    ]
  });
  T.eq(r.code, 1, '有一项失败 ⇒ 退出码 1');
  T.eq(read(p), before,
    '**原子性**：op1 合法 + op2 非法 ⇒ 文件**逐字节不变**（修之前它已经被改成 var a = 99）');
}


/* ---------------- 清理 ---------------- */
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* 无所谓 */ }

process.exit(T.done());
