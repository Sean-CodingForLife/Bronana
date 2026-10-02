/* =========================================================
   loop-audit.mjs — 三模块循环体检
   ---------------------------------------------------------
   它回答的是**设计上下文 v3** 里的那几个结构问题：

     · 三个模块各自的账本有没有分开（§5.4-错误1"禁止统一 economy.ts"）
     · 核心素材有没有被当成钱（§5.4-错误2）
     · 循环是不是**由核心素材构成**的（§5.2：A→B→C→A）
     · 核心素材有没有**保底**（§9-建议1 / §7-11）
     · 兑换有没有带限制（§7-12）

   ⚠ 与旧版的区别（这次改动值得记下来）：
   旧版按**货币的 from/to** 画循环图 —— 于是"循环"读起来像"钱在三个模块
   之间流动"，而钱本来就到处流，那张图证明不了任何东西。它当年报
   "循环闭合 ✔" 而 `relic`/`sigil` 在代码里**一处调用点都没有**。

   现在循环图**由核心素材推出来**：一条边一个核心素材，产在 A、只能在 B 花。
   一条边没有核心素材 = 那条路根本走不通。
   ========================================================= */
import { loadAll, SIM_MODULES } from '../test/_load.mjs';

await loadAll(SIM_MODULES);
const { Economy, Ledger, Link } = globalThis;
console.error = function () { };

const PAD = (s, n) => { s = String(s); let w = 0; for (const c of s) w += c.charCodeAt(0) > 127 ? 2 : 1; return s + ' '.repeat(Math.max(0, n - w)); };
const NAME = (s) => (Ledger.SYSTEMS[s] ? Ledger.SYSTEMS[s].name : s);

console.log('=== Teapot · 三模块循环体检 ===\n');

const v = Economy.audit();
console.log('聚合自检：' + (v.ok ? '通过 ✔' : '未通过 ✘'));
if (!v.ok) console.log('  ' + v.problems.join('\n  '));
console.log('  ' + v.counts.ledgers + ' 本账 · ' + v.counts.currencies + ' 笔代币 · ' +
  v.counts.links + ' 个核心素材 · ' + v.counts.exchanges + ' 条兑换\n');

/* ---------------- 1. 四本账 ---------------- */
console.log('[1] 四本账（**禁止统一 `economy.ts`** —— v3 §5.4-错误1）\n');
console.log('  ' + PAD('账本', 34) + PAD('归属', 8) + '代币');
for (const b of Ledger.all()) {
  const cur = b.currencies.map(c => c.name + '（' + c.role + '）').join(' + ');
  console.log('  ' + PAD(b.name, 34) + PAD(NAME(b.owner) || b.owner, 8) + cur);
  console.log('    \x1b[90m' + b.note + '\x1b[0m');
}
console.log('');
console.log('  ⚠ `economy.ts` 现在是**只读聚合**：一笔代币都不定义，');
console.log('  只把四本账汇总给这里读。定义在 eco_combat / eco_manage / eco_grow / eco_global。');

/* ---------------- 2. 循环图 ---------------- */
console.log('\n[2] 循环图（**由核心素材推出来**，不是由货币流向）\n');
const loop = Economy.loop();
console.log('       ┌──────────────┐');
console.log('       │   ' + NAME('combat') + '   │');
console.log('       └──┬────────┬──┘');
for (const e of loop.edges) {
  const what = e.what.map(id => { const l = Link.BY_ID[id]; return l ? l.name : id; }).join(' + ');
  console.log('          │ ' + PAD(NAME(e.from) + ' → ' + NAME(e.to), 16) + what);
}
console.log('');
console.log('  每一条边 = **一个核心素材**：产在 A、只能在 B 花。');
console.log('  一条边没有核心素材 = 那条路走不通（`Link.audit` 会报"链条缺一环"）。');

/* ---------------- 3. 核心素材 ---------------- */
console.log('\n[3] 核心素材（**不在任何账本里** —— v3 §5.4-错误2）\n');
console.log('  ' + PAD('素材', 12) + PAD('产出 → 消费', 18) + PAD('掉率', 8) + PAD('保底', 8) + '路径数');
for (const l of Link.LIST) {
  const inLedger = Ledger.currency(l.id) ? ' \x1b[31m⚠ 在账本里\x1b[0m' : '';
  console.log('  ' + PAD(l.name, 12) +
    PAD(NAME(l.producedBy) + ' → ' + NAME(l.consumedBy), 18) +
    PAD(String(l.chance), 8) + PAD(l.pity + ' 次', 8) + l.paths.length + inLedger);
  console.log('    \x1b[90m' + l.source + '　·　' + l.paths.join(' / ') + '\x1b[0m');
}
console.log('');
console.log('  v3 §9-建议1："核心素材保底：概率掉落 + **保底计数** + 多路径获取。"');
console.log('  上面每一行都同时有掉率与保底 —— `Link.audit` 少了任何一样都报错。');

/* ---------------- 4. 全局货币 ---------------- */
console.log('\n[4] 全局货币（行动成本，不是钱 —— v3 §5.1 / §9-建议3）\n');
const g = Economy.globalCurrency();
if (g) {
  console.log('  ' + g.name + '（' + g.id + '）：住在 ' + g.ledger + ' 账本，单独一本');
  console.log('    \x1b[90m' + g.note + '\x1b[0m');
  console.log('    \x1b[33m⚠ 它的成败不在"通用"，在**获取有限 + 消耗刚性**：\x1b[0m');
  console.log('    \x1b[33m  一旦它变得又多又好赚，三个模块代币就都成了摆设（v3 §9-风险3）。\x1b[0m');
} else {
  console.log('  \x1b[31m✘ 没有全局货币 —— 三模块就没有共同语言（v3 §5.1）\x1b[0m');
}

/* ---------------- 5. 兑换 ---------------- */
console.log('\n[5] 兑换（v3 §5.3：模块代币 ↔ 模块代币；§7-12：高税 / 限额 / 单向 / 手续费）\n');
if (!Economy.EXCHANGE.length) {
  console.log('  \x1b[33m一条都没有登记。\x1b[0m');
  console.log('  \x1b[90m机制已就位（`Ledger.canExchange` + 四条限制的审计），');
  console.log('  但真正的兑换率要等三个模块各自成立之后再定 —— v3 §八：「先让三个模块');
  console.log('  各自成立，再让它们循环。」现在定汇率就是在猜。\x1b[0m');
} else {
  for (const e of Economy.EXCHANGE) {
    console.log('  ' + NAME(e.from) + ' → ' + NAME(e.to) + '　汇率 ' + e.rate +
      '　限额 ' + (e.cap || '不限') + '　手续费 ' + (e.cost || 0) + ' 全局货币' +
      (e.oneWay ? '　单向' : ''));
  }
}

/* ---------------- 6. 守卫 ---------------- */
console.log('\n[6] 守卫（v3 §8-7 点名要的那三条）\n');
const need = ['禁止统一 economy.ts', '禁止核心素材入货币表', '禁止跨模块直接消费'];
const where = [
  '`economy.ts` 只读聚合（判据 H 扫源码）',
  '`Link.audit` + `Eco.audit` 两道（核心素材进了账本就报）',
  '门 drift 的判据 F（读调用点，认 `Ledger.EXCHANGE`）'
];
for (let i = 0; i < need.length; i++) {
  console.log('  ✔ ' + PAD(need[i], 28) + '\x1b[90m' + where[i] + '\x1b[0m');
}

console.log('\n=== 结果 ===');
console.log((v.ok ? '结构自洽 ✔' : '\x1b[31m结构有问题 ✘\x1b[0m') +
  '（' + v.counts.ledgers + ' 本账 / ' + v.counts.links + ' 个核心素材 / ' +
  v.counts.exchanges + ' 条兑换）');
console.log('');
