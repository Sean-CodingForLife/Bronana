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
     node tools/curve-audit.mjs            # 打印对照表
     node tools/curve-audit.mjs --talents   # 附带机器人实机落点（慢）
   ========================================================= */
import { loadAll, SIM_MODULES } from '../test/_load.mjs';

await loadAll(SIM_MODULES);
const { Curves, Enemies, Stats } = globalThis;
console.error = function () { };

const PAD = (s, n) => String(s).padStart(n);
const PADR = (s, n) => String(s).padEnd(n);

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
console.log('     而"实际打得到第几层"要看机器人实机（`pnpm run fun` 是那个尺子）');

/* ---------------- 3. 实机落点（可选，慢） ---------------- */
if (process.argv.includes('--talents')) {
  console.log('\n[3] 实机落点（机器人跑若干种子 —— 这一半才是平衡的证据）\n');
  const { runAll } = await import('./balance.mjs').catch(() => ({ runAll: null }));
  if (!runAll) {
    console.log('  跳过：tools/balance.mjs 没有导出 runAll（它是个脚本）。');
    console.log('  直接跑 `node tools/balance.mjs talents` 看实机落点。');
  } else {
    console.log(JSON.stringify(runAll(), null, 1));
  }
} else {
  console.log('\n[3] 实机落点：跳过（加 `--talents` 才跑；那是慢的那一半）');
}

console.log('\n=== 结果 ===');
console.log('曲线自检通过 · 逐点等价校验通过 · 对照表已输出 ✔');
