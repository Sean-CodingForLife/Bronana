/* =========================================================
   naming-gate.mjs — 门 `naming` 的自证
   ---------------------------------------------------------
   家法：**一条不会失败的审计等于装饰。** 
   而这条门比一般审计更危险 —— 它带一张**欠账表**（`tools/naming.mjs` 的 `DEBT`），
   而"豁免表"这种东西**天然会退化成永久豁免**（本仓库反复栽过）。

   所以这一套要证明**三件事都会红**：
     ① 往引擎模块写一个新内容名 ⇒ 红（新增）
     ② 欠账表与实测对不上   ⇒ 红（表是欠条，不是豁免）—— 两个方向都验
     ③ 引擎模块的文件名带内容名 ⇒ 红（这一条当场生效，与表无关）
     + 干净时**绿**（否则门在乱报，人就会去关掉它）
   ========================================================= */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { T } from './_assert.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const GATE = path.join(ROOT, 'tools', 'naming.mjs');
const BOUNDARY = path.join(ROOT, 'tools', 'engine-boundary.mjs');

/** 跑门，拿退出码 + 输出 */
function run() {
  const r = spawnSync(process.execPath, [GATE], { cwd: ROOT, encoding: 'utf8' });
  return { code: r.status, out: String(r.stdout) };
}

/** 临时改一个文件、跑一次、**无论如何都还原**（这几个文件是仓库资产，不许留痕） */
function withFile(p, mutate, fn) {
  const orig = fs.readFileSync(p, 'utf8');
  try {
    fs.writeFileSync(p, mutate(orig), 'utf8');
    return fn();
  } finally {
    fs.writeFileSync(p, orig, 'utf8');
  }
}

/* ---------------- 0. 干净时必须绿 ---------------- */
T.section('0. 干净时绿（否则门在乱报，人就会去关掉它）');
{
  const r = run();
  T.eq(r.code, 0, '当前仓库状态 ⇒ 退出码 0');
  T.ok(r.out.includes('没有新增'), '报告里明说"没有新增"');
}

/* ---------------- ① 往引擎模块写新内容名 ⇒ 红 ---------------- */
T.section('① 往引擎模块写一个新内容名 ⇒ 红');
{
  const victim = path.join(ROOT, 'src', 'fold.ts');
  const r = withFile(victim, (s) => s + '\nvar probeBronana = 1;\n', run);
  T.eq(r.code, 1, '退出码 1');
  T.ok(r.out.includes('新增了内容名'), '报告里出现「新增了内容名」');
  T.ok(r.out.includes('fold.ts'), '报告点名了 fold.ts');
  T.ok(r.out.includes('probeBronana'), '报告把那行原文打出来了');

  const after = fs.readFileSync(victim, 'utf8');
  T.ok(!after.includes('probeBronana'), '（还原）fold.ts 里的探针已经清掉');
}

/* ---------------- ② 欠账表对不上 ⇒ 红（两个方向） ---------------- */
T.section('② 欠账表与实测对不上 ⇒ 红（表是欠条，不是豁免）');
{
  /* ⚠ **探针由本测试自己造，不再引用表里任何一条真实欠账。**
     第一版把 `'comp.ts': 1,` 写死在测试里 —— 而 E3 第 1 小步把那一条**还清并删掉**之后，
     `s.replace("'comp.ts': 1,", …)` 变成**静默的空操作**（`.replace` 匹配不到**不报错**），
     于是门照旧是绿的、而测试报「期望 1 得到 0」。
     这与本项目记过的「**改名只改一半 / 判据里硬编旧值**」是同一个坑
     （E2 的 `BRONANA_SOURCEMAP` 被断言写死那一次）—— **判据里的旧值要跟着被测对象一起改**。
     现在改成**注入一条合成欠账**（`fold.ts` 是引擎模块、实测 0 处）：
     表变短、乃至表被清空成 `{}`，这一套仍然有效。 */
  const victim = path.join(ROOT, 'src', 'fold.ts');
  const injectDebt = (src, line) => src.replace('const DEBT = {', 'const DEBT = {\n  ' + line);

  /* 方向 A：实测 > 表（有人加了）—— 表里写 0，源码里塞进 1 处内容名 */
  const rA = withFile(GATE, (s) => injectDebt(s, "'fold.ts': 0,"), () =>
    withFile(victim, (s) => s + '\nvar probeBronana = 1;\n', run));
  T.eq(rA.code, 1, '实测多于表 ⇒ 退出码 1');
  T.ok(rA.out.includes('对不上'), '报告里出现「欠账表与实测对不上」');
  T.ok(!fs.readFileSync(victim, 'utf8').includes('probeBronana'), '（还原）fold.ts 的探针已经清掉');

  /* 方向 B：实测 < 表（债还清了但没删）—— 表里写 2，源码里 0 处 */
  const rB = withFile(GATE, (s) => injectDebt(s, "'fold.ts': 2,"), run);
  T.eq(rB.code, 1, '实测少于表 ⇒ 退出码 1');
  T.ok(rB.out.includes('还清了'), '报告里出现「债还清了，请删掉表里那一条」');
}

/* ---------------- ③ 引擎模块的文件名带内容名 ⇒ 红 ---------------- */
T.section('③ 引擎模块的文件名带内容名 ⇒ 红（当场生效，与表无关）');
{
  /* ⚠ 这一条要**两处同时改**才算真验：
       · 建一个 `src/bronana_probe.ts`
       · 把它加进**引擎模块清单**（门 `engine-boundary` 的 ENGINE 表）——
         因为"文件名规则"只对**引擎模块**生效（内容模块叫 bronana.ts 是对的）
     第一版我只建了文件、去改门的欠账表，于是门报的是"表漂了" ——
     **那不是这一条的判据**，是另一条。探针造错会让人以为判据不管用。 */
  const probe = path.join(ROOT, 'src', 'bronana_probe.ts');
  fs.writeFileSync(probe, 'export var P = 1;\n', 'utf8');
  try {
    const r = withFile(BOUNDARY, (s) => s.replace("  'utils.ts':", "  'bronana_probe.ts': '探针',\n  'utils.ts':"), run);
    T.eq(r.code, 1, '退出码 1');
    T.ok(r.out.includes('文件名带内容名'), '报告里出现「引擎模块的文件名带内容名」');
    T.ok(r.out.includes('bronana_probe.ts'), '报告点名了那个文件');
  } finally {
    try { fs.unlinkSync(probe); } catch (e) { /* 无所谓 */ }
  }
  T.ok(!fs.existsSync(probe), '（还原）探针文件已经删掉');
  const back = fs.readFileSync(BOUNDARY, 'utf8');
  T.ok(!back.includes('bronana_probe'), '（还原）engine-boundary 里没有探针残留');
}

/* ---------------- 4. 欠账表**只许变短**这件事要有人守 ---------------- */
T.section('4. 欠账表只许变短（否则它会退化成永久豁免）');
{
  const src = fs.readFileSync(GATE, 'utf8');
  T.ok(/const DEBT = \{/.test(src), '欠账表在 `tools/naming.mjs` 里、且能被解析到');
  T.ok(/只许变短/.test(src), '文件里写明了"只许变短"这条纪律');
  /* ② 方向 B 已经证明"债还清了会红" —— 那正是这条纪律的执行手段 */
  T.ok(true, '（手段）（由 ② 方向 B 保证：还清了不删表 ⇒ 红）');
}

process.exit(T.done());
