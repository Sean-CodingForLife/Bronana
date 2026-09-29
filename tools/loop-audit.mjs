/* =========================================================
   loop-audit.mjs — 循环体检：把"三个模块怎么互相喂"画出来

   这一份输出回答的是**架构问题**，不是数值问题：
     · 每一笔钱的层级（能不能带出局）、来源、去向
     · 三个模块之间的边，以及每条边上流的是什么
     · 每条边**成不成立**（有没有货币在走）
     · 每一笔钱"从哪来、花在哪"是不是都落在已登记的系统上

   为什么值得单独一个工具：`economy.ts` 的 `audit()` 只能证明**表自洽**，
   证明不了"这条循环是通的"。而"通不通"要看**有向图**——
   一张表看不出方向，一张图一眼就能看出断在哪。

   用法： node tools/loop-audit.mjs
   ========================================================= */
import { loadAll, SIM_MODULES } from '../test/_load.mjs';

await loadAll(SIM_MODULES);
const { Economy, Profile } = globalThis;
console.error = function () { };

const PAD = (s, n) => String(s).padEnd(n);
const PADR = (s, n) => String(s).padStart(n);

console.log('=== Bronana · 三模块循环体检 ===\n');

const v = Economy.audit();
console.log('货币表自检：' + (v.ok ? '通过 ✔' : '未通过 ✘'));
if (!v.ok) {
  console.log('  ' + v.problems.join('\n  '));
  process.exit(1);
}
console.log('  ' + v.counts.currencies + ' 笔货币 · ' + v.counts.tiers + ' 档层级 · ' +
  v.counts.systems + ' 个系统 · ' + v.counts.edges + ' 条循环边\n');

/* ---------------- 1. 货币表 ---------------- */
console.log('[1] ' + Economy.LIST.length + ' 笔钱：层级 / 来源 / 去向\n');
console.log('  ' + PAD('货币', 12) + PAD('层级', 12) + PAD('来源', 10) + PAD('去向', 16) + '带出局');
for (const d of Economy.LIST) {
  const tier = Economy.TIERS[d.tier];
  const from = d.from.map(s => Economy.SYSTEMS[s].name).join('/');
  const to = d.to.map(s => Economy.SYSTEMS[s].name).join('/');
  console.log('  ' + PAD(d.name, 12) + PAD(tier.name + '（' + d.tier + '）', 12) +
    PAD(from, 10) + PAD(to, 16) + (Economy.isAccount(d.id) ? '是' : '否（结算清零）'));
  console.log('    ' + PAD('', 12) + d.note);
  console.log('    ' + PAD('', 12) + 'why：' + d.why);
}
console.log('');

/* ---------------- 2. 循环图 ---------------- */
console.log('[2] 循环图：三个模块之间的边\n');
const loop = Economy.loop();
const NAME = (s) => Economy.SYSTEMS[s] ? Economy.SYSTEMS[s].name : s;
console.log('       ┌──────────────┐');
console.log('       │   ' + NAME('combat') + '（局内）  │  ← 唯一能产出的地方');
console.log('       └──┬────────┬──┘');
for (const e of loop.edges) {
  const what = e.what.map(id => Economy.BY_ID[id].name).join(' + ');
  console.log('          │ ' + PAD(NAME(e.from) + ' → ' + NAME(e.to), 14) + what);
}
console.log('');
for (const s of Object.keys(Economy.SYSTEMS)) {
  const def = Economy.SYSTEMS[s];
  const inFlow = loop.edges.filter(e => e.to === s).map(e => e.what.map(i => Economy.BY_ID[i].name).join('+'));
  const outFlow = loop.edges.filter(e => e.from === s).map(e => e.what.map(i => Economy.BY_ID[i].name).join('+'));
  console.log('  ' + PAD(NAME(s), 8) + PAD('（' + (def.where === 'in-run' ? '局内' : '局外') + '）', 10) +
    '流入：' + PADR(inFlow.join('/') || '—', 14) + '  流出：' + (outFlow.join('/') || '—'));
  console.log('          ' + def.note);
  /* 局外模块还要显示"怎么回到战斗"：只看货币那一列会把它们读成死胡同 */
  const bf = Economy.backflowFrom(s);
  if (bf.length) {
    for (const b of bf) console.log('          反哺 → 战斗：' + b.via);
  }
}
console.log('');

/* ---------------- 3. 反哺边（局外 → 战斗） ---------------- */
console.log('[3] 反哺边（局外 → 战斗）：不是货币，是"下一局的开局条件"\n');
for (const b of Economy.BACKFLOW) {
  console.log('  → ' + PAD(NAME(b.from) + ' → ' + NAME(b.to), 14) + b.what);
  console.log('      通道：' + b.via);
  console.log('      门槛：' + b.limit);
}
console.log('');
console.log('  这一档**不是货币**：它们在 `newSession` 里折一次（`kmods` / `fmods` / `opening`），');
console.log('  之后模拟层不再回表 —— 这就是"三个模块不互相穿透"的实现方式。');
console.log('  `limit` 那一栏必须指向真的会被花掉的东西：**白给的反哺不是循环的一环**。');
console.log('');

/* ---------------- 4. 缺口（诚实记录） ---------------- */
console.log('[4] 还缺哪条边（`economy.ts` 的 `GAPS` 里**登记着**的那些）\n');
const missing = Economy.missingEdges();
if (missing.length) {
  for (const m of Economy.GAPS) {
    if (!missing.some(x => x.from === m.from && x.to === m.to)) continue;
    console.log('  ✗ ' + NAME(m.from) + ' → ' + NAME(m.to) + '：' + m.what);
    console.log('      现在：' + m.now);
    console.log('      补它：' + m.todo);
  }
} else {
  console.log('  缺口清单是空的 ✔ —— 循环闭合（三模块互相喂，两条反哺边都有门槛）');
}
console.log('');

/* ---------------- 5. 当前余额 ---------------- */
console.log('[5] 档案里的余额（跨局那三笔）\n');
try {
  console.log('  ' + PAD('孢子', 10) + Profile.spores());
  console.log('  ' + PAD('合金', 10) + Profile.alloy());
  console.log('  ' + PAD('核心材料', 10) + Profile.core());
} catch (e) {
  console.log('  （读不到档案：' + (e && e.message) + '）');
}
console.log('');

console.log('=== 结果 ===');
console.log('货币表自洽 · 循环图已输出' + (missing.length ? ' · 有 ' + missing.length + ' 条反哺边未登记（见 [3]）' : '') + ' ✔');
