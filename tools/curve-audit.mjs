/* =========================================================
   curve-audit.mjs — 曲线体检：把"两边各自的成长"摊在同一张表上

   为什么要有它：`curves.ts` 保证了两边的曲线**各自都对**（都在涨、都与改造前
   逐位相同），但"涨得一样快吗"没有任何一处回答 —— 而那正是这个系统存在的理由。

   它做两件事，**刻意分成两半**（混淆这两件事是这类工具最常见的自欺）：

     ① 曲线对齐（这一半是纯函数，可复现）
        每个房间刻度上同时给出：怪有多硬（生命/伤害/移速/精英率/预算），
        以及玩家那一边的**代理量**（累计经验 → 能升几级 → 拿多少张卡）。
        它**不下"谁更强"的结论** —— 那需要把属性换算成 DPS 与有效生命。

     ② 实机落点（这一半是**量出来的**）
        用 `tools/balance.mjs` 的机器人跑若干种子，报"实际打到第几波/第几层"。
        这一半才是"平衡"的证据；上半张表只是地图，不是结论。

   用法：
     node tools/curve-audit.mjs                          # 打印对照表（快）
     node tools/curve-audit.mjs --talents                # 附带机器人实机落点（慢，默认 24 局）
     node tools/curve-audit.mjs --talents --runs 12      # 少跑几局
     node tools/curve-audit.mjs --talents --max-wave 60  # 放远上限（看后段曲线有没有人走到）

   ⚠ 第 [3] 节的机器人取 `tools/_run.mjs`（与 fun-audit / bug-probe / reconcile 同一个实现）。
     这一节曾经是**死代码** —— 它去 import `tools/balance.mjs` 拿 `runAll`，而那个文件
     一个 export 都没有，于是永远"跳过"。详见第 [3] 节里的注释。
   ========================================================= */
import { loadAll, SIM_MODULES } from '../test/_load.mjs';

await loadAll(SIM_MODULES);
const { Curves, Enemies, Stats } = globalThis;
console.error = function () { };

const PAD = (s, n) => String(s).padStart(n);
const PADR = (s, n) => String(s).padEnd(n);
/** `--runs 12` 这类"带一个值"的参数（没给值就当不存在） */
const argOf = (name) => {
  const i = process.argv.indexOf(name);
  if (i < 0) return null;
  const v = process.argv[i + 1];
  return (v && !v.startsWith('--')) ? v : null;
};

console.log('=== Bronana · 数值曲线体检 ===\n');

/* ---------------- 0. 表本身 ---------------- */
const v = Curves.audit();
console.log('曲线表：' + v.counts.curves + ' 条 · ' + v.counts.shapes + ' 种形状 · ' +
  v.counts.domains + ' 个域 · 逐点等价校验 ' + v.counts.legacy + ' 条');
if (!v.ok) {
  console.log('自检未通过：\n  ' + v.problems.join('\n  '));
  process.exit(1);
}
console.log('自检：通过 ✔\n');

/* ---------------- 1. 每条曲线的里程碑表 ----------------
   方法论要求的那张 `milestone table`：形状对不对，要看值不能看公式。 */
console.log('[1] 里程碑表（每条曲线在起点 / 早期 / 中期 / 后期的值）\n');
const SHOW = { 'enemy.hp': 1, 'enemy.dmg': 1, 'enemy.speed': 1, 'enemy.eliteChance': 1, 'spawn.budget': 1, 'player.xp': 1 };
for (const id of Object.keys(SHOW)) {
  const t = Curves.table(id, [1, 3, 6, 10, 15, 20, 25, 30, 39]);
  if (!t) continue;
  console.log('  ' + PADR(t.id, 20) + '（' + t.unit + ' · ' + t.shape + '）');
  console.log('    ' + t.rows.map(r => PAD(r.t, 4)).join(''));
  console.log('    ' + t.rows.map(r => PAD(r.value < 10 ? r.value.toFixed(2) : Math.round(r.value), 4)).join(''));
  console.log('    ' + t.why);
  console.log('');
}

/* ---------------- 2. 两边的对照表 ---------------- */
console.log('[2] 两边的对照：同一个房间刻度上摊开双方\n');
console.log('  ' + PADR('房间', 5) + PAD('怪生命', 9) + PAD('怪伤害', 9) + PAD('怪移速', 9) +
  PAD('精英率', 8) + PAD('刷怪预算', 10) + PAD('本级经验', 10) + PAD('累计经验', 10) +
  PAD('等效等级', 9) + PAD('卡幅度', 8));
const rows = Curves.checkpoint([1, 3, 6, 10, 15, 20, 25, 30, 39]);
for (const r of rows) {
  /* 等效等级 = 累计经验能升到几级（用**逐级求和**，与游戏同一套口径）。
     它是玩家侧的**代理量**：真实战力还取决于拿到什么武器与道具，
     所以下面这一列只用来回答"经验这边跟不跟得上"。 */
  let lv = 1, acc = 0;
  while (acc + Stats.xpNeeded(lv) <= r.xpCumulative && lv < 999) { acc += Stats.xpNeeded(lv); lv++; }
  /* 卡幅度：这一间对应的等级上，一张升级卡是多少倍。
     **它才是"玩家每级长多少"那一列** —— 在它存在之前，这一列是平的（恒为 1）。 */
  const cardMul = Curves.at('player.cardAmt', lv);
  console.log('  ' + PADR(r.room, 5) + PAD(r.enemyHp.toFixed(1), 9) + PAD(r.enemyDmg.toFixed(2), 9) +
    PAD(r.enemySpeed.toFixed(3), 9) + PAD((r.eliteChance * 100).toFixed(0) + '%', 8) +
    PAD(Math.round(r.budget), 10) + PAD(Math.round(r.xpToLevel), 10) +
    PAD(Math.round(r.xpCumulative), 10) + PAD(lv, 9) + PAD('×' + cardMul.toFixed(2), 8));
}
console.log('');
console.log('  怎么读这张表：');
console.log('   · 左边五列是**怪物侧**（值住在 curves.ts，读点在 enemies.ts 与 game.ts）');
console.log('   · 右边四列是**角色侧**：本级经验 / 累计经验 / 等效等级 / 卡幅度');
console.log('   · `卡幅度` = 那一级的一张升级卡值几倍（`player.cardAmt`）。');
console.log('     它取 1.0 → 1.6 而不是更大：这条曲线乘在"一整局的抽卡次数"上，');
console.log('     强度一个人扛完成长会滑成割草 —— 见 curves.ts 里那条 why');
console.log('   · 它**不下"谁更强"的结论** —— 那要把属性换算成 DPS 与有效生命，');
console.log('     而"实际打得到第几层"要看机器人实机（`pnpm run fun` 是那个校验）');

/* ---------------- 3. 实机落点（可选，慢） ----------------
   ⚠ 这一节曾经是**死代码**：它 `import('./balance.mjs')` 想拿 `runAll`，
   而 `tools/balance.mjs` **一个 export 都没有** —— 于是 `if (!runAll)` 恒为真、
   永远打印"跳过"，`else` 那行永远不执行。而这一节的注释写着
   "**这一半才是"平衡"的证据；上半张表只是地图，不是结论**"。
   换句话说：曲线的"实机落点"从来没被自动量过。

   为什么改成直接用 `tools/_run.mjs` 的机器人（而不是修 balance.mjs 的导出）：
   `balance.mjs` **自己另写了一份机器人**（它不 import `_run.mjs`），
   而 `fun-audit.mjs` 的表头把"必须走同一份机器人"列为硬要求 ——
   "第一版这里另写了一份，于是同一个种子跑出完全不同的结果
   （探针到第 15 波、这里第 3 波就死），量出来的根本不是同一局游戏"。
   所以让本节去借 balance 的机器人等于**又接错一次**。这里用共享的那一份。 */
if (process.argv.includes('--talents')) {
  const RUNS = Math.max(1, parseInt(argOf('--runs') || '24', 10));
  const MAXW = Math.max(1, parseInt(argOf('--max-wave') || '40', 10));
  console.log('\n[3] 实机落点（机器人跑 ' + RUNS + ' 个种子 —— 这一半才是平衡的证据）\n');
  console.log('  机器人：`tools/_run.mjs` —— 与 `pnpm run fun` / `bug-probe` / `reconcile` **同一个实现**');
  console.log('  每局最多 ' + MAXW + ' 波\n');

  const { playRun } = await import('./_run.mjs');
  const t0 = Date.now();
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    try {
      const r = playRun({ runIndex: i, seedBase: 500000, maxWave: MAXW });
      if (r) runs.push(r);
    } catch (e) {
      console.log('  ✘ run' + i + ' 抛了：' + (e && e.message));
    }
  }
  if (!runs.length) {
    console.log('  ✘ 一局都没跑成 —— 这一节没有数据，不要当成"通过"。');
    process.exitCode = 1;
  } else {
    const wall = (Date.now() - t0) / 1000;
    const waveList = runs.map((r) => r.waves);
    const sorted = waveList.slice().sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
    const won = runs.filter((r) => r.won).length;

    console.log('  落点分布（机器人打到第几波）');
    console.log('    中位 ' + med + ' · P90 ' + p90 + ' · 最深 ' + Math.max(...waveList) +
      ' · 通关 ' + won + '/' + runs.length + ' · 墙钟 ' + wall.toFixed(1) + ' 秒\n');

    /* 直方图：一眼看出是不是"双峰"（早期暴死 + 后期无解，中间没人死） */
    const BIN = 5;
    const bins = [];
    for (let b = 0; b < Math.ceil(MAXW / BIN); b++) bins.push(0);
    for (const w of waveList) {
      const b = Math.min(bins.length - 1, Math.max(0, Math.floor((w - 1) / BIN)));
      bins[b]++;
    }
    console.log('    每 ' + BIN + ' 波一格的直方图：');
    const peak = Math.max(...bins, 1);
    for (let b = 0; b < bins.length; b++) {
      if (!bins[b] && b > sorted[sorted.length - 1] / BIN) break;
      const lo = b * BIN + 1;
      console.log('      ' + String(lo).padStart(3) + '–' + String(lo + BIN - 1).padEnd(4) +
        String(bins[b]).padStart(3) + ' 局  ' + '█'.repeat(Math.round(bins[b] / peak * 28)));
    }
    console.log('');

    /* ---- 这张才是"曲线设计到哪、实际到哪"的对照 ---- */
    console.log('  曲线表的里程碑，有多少局**真的走到**（左边取自上半张表，右边是实测）');
    console.log('    房间   怪生命   怪伤害   走到这里的局数   占比');
    const MARKS = [1, 5, 10, 15, 20, 25, 30, 35, 39];
    for (const t of MARKS) {
      const reached = waveList.filter((w) => w >= t).length;
      const hp = Curves.at('enemy.hp', t), dmg = Curves.at('enemy.dmg', t);
      const share = reached / runs.length;
      console.log('    ' + String(t).padStart(4) + '   ×' + hp.toFixed(1).padStart(7) +
        '   ×' + dmg.toFixed(2).padStart(5) + '      ' + String(reached).padStart(3) + '/' + runs.length +
        '          ' + (share * 100).toFixed(0).padStart(3) + '%' + (share < 0.2 ? '   ← 多数局没体验到' : ''));
    }
    console.log('');
    console.log('  怎么读：右边占比 < 20% 的那几行，说明曲线那一段**在多数局里根本没被体验到** ——');
    console.log('  这不是"设计得对不对"，是"要调它得按哪一段调"。以及直方图若是**双峰**');
    console.log('  （前段一堆 + 后段一堆、中间空），那是"中段没有威胁"的典型形状。');
  }
} else {
  console.log('\n[3] 实机落点：跳过（加 `--talents` 才跑；那是慢的那一半）');
  console.log('    也可以： node tools/curve-audit.mjs --talents --runs 12 --max-wave 40');
}

console.log('\n=== 结果 ===');
console.log('曲线自检通过 · 逐点等价校验通过 · 对照表已输出 ✔');
