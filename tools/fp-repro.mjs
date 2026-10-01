/* =========================================================
   fp-repro.mjs — 门 `repro`：**跨进程可复现性**
   ---------------------------------------------------------
   ## 为什么需要它（这是现有指纹**原理上看不见**的那一类 bug）

   `tools/fingerprint.mjs` 把一段固定对局压成一个哈希，用途是
   "改了代码之后对比，看有没有悄悄跑出不一样的对局"。但它只跑**一遍**，
   所以它回答的是"**这一份代码跑出来的结果是不是我以为的那个**"，
   而**没有**回答另一个问题：

     > 同一个种子、同一份代码，跑两遍**真的**一样吗？

   这两个问题不是一回事，而且第二个才是"确定性"这个词的本义。
   第一类 bug 的形态是：

     · 遍历 `Set` / `Map` 时依赖插入顺序 —— 而 V8 的哈希种子**每个进程不同**；
     · 读 `Date.now()` / `performance.now()` 参与数值（本仓库 `game.ts` 的
       `Math.random` 那处**已经**被注释明令禁止，说明这条纪律是活的）；
     · 读了没被重置的**模块级状态**（上一次对局的残留）。

   它们的共同点是：**同一份代码、同一种子、两次运行结果不同** ——
   而单跑一遍的指纹**永远看不到**，因为两次都只跟"记录下来的那个哈希"比，
   而那个哈希就是它自己刚算出来的。**它是自证的。**

   ## 做法：跑 3 个**独立进程**，比对它们的输出

   为什么要**独立进程**而不是同进程跑 3 遍：哈希种子、`Set`/`Map` 的迭代顺序、
   惰性初始化，都是**进程级**的东西。同进程跑三遍会共用同一份已初始化的状态，
   于是恰好绕过我们要抓的东西。
   （实测：同一进程内跑 3 遍是稳定的 —— 但这证明不了跨进程稳定，也不该由它来证明。）

   ## 它**不**做的事（写清楚，免得被当成"重复的指纹门"）

   它**不**记录也不校验基线哈希 —— 那是 `test/smoke.mjs` 的职责（家法：一条判据
   只能有一个理由）。这一道门只问一件事：**跑三遍一样吗**。
   所以**故意改行为**时它**不会红**；只有"结果不稳定"才红。
   ========================================================= */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FINGERPRINT = path.join(ROOT, 'tools', 'fingerprint.mjs');
const N = 3;
const JSON_OUT = process.argv.includes('--json');

/** 跑一次 `fingerprint.mjs`，回传它的输出行（stdout 原样） */
function once() {
  const r = spawnSync(process.execPath, [FINGERPRINT], {
    cwd: ROOT, encoding: 'utf8', timeout: 600000
  });
  if (r.error) return { err: 'spawn 失败：' + r.error.message };
  if (r.status !== 0) {
    return { err: '子进程退出码 ' + r.status + (r.stderr ? '：' + String(r.stderr).slice(0, 300) : '') };
  }
  const lines = String(r.stdout).split(/\r?\n/)
    .map(s => s.trim())
    .filter(s => s && s.indexOf('→') >= 0);
  return { lines: lines };
}

console.log('\n=== Bronana · 跨进程可复现性（同一份代码、同一个种子，跑 ' + N + ' 个独立进程）===\n');
console.log('  判据：**同一份代码 + 同一个种子 ⇒ 结果必须逐字节相同**');
console.log('  （这正是单跑一遍的指纹原理上看不见的那一类：Set/Map 迭代顺序、');
console.log('    进程级哈希种子、未重置的模块状态、读时钟参与数值）\n');

const runs = [];
for (let i = 0; i < N; i++) {
  const r = once();
  if (r.err) {
    console.log('  ✘ 第 ' + (i + 1) + ' 次没跑起来：' + r.err);
    console.log('\n=== 结果 ===\n  ✘ 无法完成可复现性校验（子进程失败，不是"不稳定"）');
    process.exit(1);
  }
  runs.push(r.lines);
  console.log('  第 ' + (i + 1) + '/' + N + ' 次：');
  for (const l of r.lines) console.log('      ' + l);
}

const problems = [];
if (runs[0].length === 0) problems.push('指纹工具没有输出任何结果行（是不是它的输出格式变了？）');
for (let i = 1; i < N; i++) {
  if (runs[i].length !== runs[0].length) {
    problems.push('第 ' + (i + 1) + ' 次的行数与第 1 次不同（' + runs[i].length + ' vs ' + runs[0].length + '）');
    continue;
  }
  for (let k = 0; k < runs[0].length; k++) {
    if (runs[i][k] !== runs[0][k]) {
      problems.push('第 ' + (i + 1) + ' 次第 ' + (k + 1) + ' 行不同：\n        第 1 次 ' + runs[0][k] + '\n        第 ' + (i + 1) + ' 次 ' + runs[i][k]);
    }
  }
}

if (JSON_OUT) { console.log(JSON.stringify({ runs: runs, problems: problems })); process.exit(problems.length ? 1 : 0); }

console.log('\n=== 结果 ===');
if (problems.length) {
  console.log('  ✘ ' + problems.length + ' 处不稳定：');
  for (const p of problems) console.log('    · ' + p);
  console.log('\n  处置：这不是"基线该更新了"，而是**代码里有不可复现的来源**。');
  console.log('  常见根因（按本项目踩过的顺序）：');
  console.log('    · 遍历 Set / Map 时依赖插入顺序（V8 哈希种子每进程不同）');
  console.log('    · 读了 Date.now() / performance.now() 参与数值');
  console.log('    · 模块级状态没在 newRun 时重置（上一次对局的残留）');
  console.log('  ⚠ **不要**去改基线把它糊过去 —— 那正是这道门要防的事。');
  process.exit(1);
}
console.log('  ✔ 同一份代码 + 同一个种子 ⇒ 结果一致（跑 ' + N + ' 个独立进程逐字节相同）');
