/* =========================================================
   economy.mjs — 账本 / 核心素材 / 循环
   ---------------------------------------------------------
   这一套守的是**设计上下文 v3** 里那几条最容易被做错的约束：

     §5.4-错误1  "把三个模块的货币压成一套。禁止统一 `economy.ts`
                 定义五六种货币互相兑换。"
     §5.4-错误2  "把核心素材当货币处理…一旦可兑换或流通，循环就散了。"
     §5.1/§5.2   三套模块代币 + 一笔全局货币 + 三个核心素材（A→B→C→A）
     §9-建议1    "核心素材保底：概率掉落 + **保底计数** + 多路径获取。"
     §7-12       "模块代币兑换…需高税、限额、单向或消耗全局货币。"

   ⚠ 与上一版的区别：上一版测的是"一张表上七八笔代币各自的 from/to"
   —— 那套模型本身已经被 v3 否掉了（它就是错误1）。现在测的是**结构**：
   每本账归谁、核心素材在不在账本里、循环是不是由核心素材构成的。
   ========================================================= */
import { loadAll, SIM_MODULES } from './_load.mjs';

await loadAll(SIM_MODULES);
const { Economy, Ledger, Link, Registry } = globalThis;

let failures = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  \x1b[32mPASS\x1b[0m ' + label);
  else { failures++; console.log('  \x1b[31mFAIL\x1b[0m ' + label + (extra !== undefined ? '  → ' + extra : '')); }
}

console.log('\n=== Bronana · 账本 / 核心素材 / 循环 ===\n');

/* =========================================================
   [1] 四本账：每个模块只定义自己的代币（v3 §5.4-错误1 的头号禁令）
   ========================================================= */
console.log('[1] 四本账（禁止"一张表定义所有货币"）');
{
  const v = Economy.audit();
  ok(v.ok, '聚合自检通过（' + v.counts.ledgers + ' 本账 / ' + v.counts.currencies +
    ' 笔代币 / ' + v.counts.links + ' 个核心素材）', (v.problems || []).join(' | '));

  for (const id of ['combat', 'manage', 'grow', 'global']) {
    ok(!!Ledger.byId(id), '账本「' + id + '」已定义');
  }

  /* 每本账归一个模块，而且里面的模块代币**必须**归那个模块 */
  for (const b of Ledger.all()) {
    for (const c of b.currencies) {
      if (c.role === 'module') {
        ok(b.owner === c.owner,
          '模块代币「' + c.name + '」住在自己的账本里（' + b.id + '）—— 不许出现在别人的账本里');
      }
    }
  }

  /* **内嵌的头号禁令**：别的模块的代币不许出现在这本账里 */
  for (const b of Ledger.all()) {
    const mine = b.currencies.filter(c => c.owner !== b.owner);
    ok(mine.length === 0, '账本「' + b.name + '」里没有别人的代币', mine.map(c => c.id).join(','));
  }

  const led = Economy.ledgerOf('combat');
  ok(!!led && led.currencies.length === 1 && led.currencies[0].id === 'scrap',
    '战斗账本里只有 `scrap` 一笔（"战斗的成长在战斗内部"）');
}

/* =========================================================
   [2] 核心素材：**不在任何账本里**（v3 §5.4-错误2）
   ========================================================= */
console.log('\n[2] 核心素材不是钱，是钥匙');
{
  for (const l of Link.LIST) {
    ok(!Economy.BY_ID[l.id], '核心素材「' + l.name + '」**不在账本汇总里**（进了账本就会被兑换）');
    ok(!Ledger.currency(l.id), '核心素材「' + l.name + '」不在任何一本账里');
  }
  ok(Economy.LINKS.length === 3, '核心素材**恰好 3 个**（v3 §5.2：一条边一个）');

  for (const l of Link.LIST) {
    ok(l.producedBy !== l.consumedBy,
      '「' + l.name + '」的产出地（' + l.producedBy + '）与消费地（' + l.consumedBy + '）是分开的');
  }

  ok(Economy.EXCHANGE.every(e => e.from !== 'core' && e.to !== 'core'),
    '核心素材不参与任何兑换（能换就等于没锁）');
}

/* =========================================================
   [3] 循环：**由核心素材推出来**（v3 §5.2）
   ========================================================= */
console.log('\n[3] 循环 = 战斗 → 经营 → 养成 → 战斗');
{
  const loop = Economy.loop();
  ok(loop.edges.length === 3, '循环正好 3 条边（' + loop.edges.map(e => e.from + '→' + e.to).join(' ') + '）');

  for (const [a, b] of [['combat', 'manage'], ['manage', 'grow'], ['grow', 'combat']]) {
    const hit = Economy.edge(a, b);
    ok(hit.length === 1,
      '链边「' + a + ' → ' + b + '」**恰好一个**核心素材锁着' +
      (hit.length ? '（' + hit[0] + '）' : ' —— 缺一环，会退回"并列独立"'), hit.join(','));
  }

  const pairs = new Map();
  for (const l of Link.LIST) {
    const k = l.producedBy + '>' + l.consumedBy;
    pairs.set(k, (pairs.get(k) || 0) + 1);
  }
  ok([...pairs.values()].every(n => n === 1), '每对模块之间只有一条核心素材边（多一条 = 没锁）');

  for (const r of Link.closed()) {
    ok(r.produce === 1 && r.consume === 1,
      '模块「' + (Ledger.SYSTEMS[r.sys] ? Ledger.SYSTEMS[r.sys].name : r.sys) +
      '」产 ' + r.produce + ' 个、消费 ' + r.consume + ' 个核心素材');
  }
  ok(Economy.SYSTEMS && Object.keys(Economy.SYSTEMS).length === 3,
    '循环正好**三个**模块（战斗 / 经营 / 养成，不是四个）', Object.keys(Economy.SYSTEMS).join(','));
}

/* =========================================================
   [4] 全局货币：恰好一笔，且是"行动成本"不是钱（v3 §5.1 + §9-建议3）
   ========================================================= */
console.log('\n[4] 全局货币（三模块通用的那一笔）');
{
  const globals = Economy.LIST.filter(c => c.role === 'global');
  ok(globals.length === 1, '全局货币**恰好一笔**（多一笔它就变成另一笔模块钱）', globals.map(c => c.id).join(','));
  ok(globals[0] && globals[0].id === 'material', '那一笔是「材料」');
  ok(globals[0] && globals[0].ledger === 'global', '它住在 global 账本里，不和任何模块的代币同住');
  const gbook = Ledger.byId('global');
  ok(gbook && gbook.currencies.length === 1, 'global 账本里只有它一笔');
}

/* =========================================================
   [5] 保底：v3 §9-建议1（概率 + 保底计数 + 多路径）
   ========================================================= */
console.log('\n[5] 核心素材保底（v3 §9-建议1）');
{
  for (const l of Link.LIST) {
    ok(l.chance > 0 && l.chance < 1, '「' + l.name + '」有掉率且不是必掉（' + l.chance + '）');
    ok(l.pity >= 1, '「' + l.name + '」有保底计数（连续 ' + l.pity + ' 次没出必出）');
    ok(l.paths.length >= 2, '「' + l.name + '」有多路径（' + l.paths.length + ' 条）');
  }

  for (const l of Link.LIST) {
    const st = Link.empty();
    const never = () => 0.999;
    let got = null;
    for (let i = 1; i <= l.pity; i++) got = Link.roll(l.id, st, never);
    ok(got.got && got.byPity,
      '「' + l.name + '」连 ' + l.pity + ' 次不出之后，第 ' + l.pity + ' 次**保底必出**');
  }

  {
    const st = Link.empty();
    const r = Link.roll('core', st, () => 0.01);
    ok(r.got && !r.byPity, '掉率生效：随机数低于 chance 时直接出（不是靠保底）');
  }
  {
    const st = Link.empty();
    const never = () => 0.999;
    const pit = Link.BY_ID['core'].pity;
    const a = Link.roll('core', st, never).until;
    const b = Link.roll('core', st, never).until;
    /* ⚠ `until` 是"还差**几次尝试**必出"，所以它**不会到 0** ——
       到了 0 之前那一发就已经走保底分支出了（`miss + 1 >= pity`）。
       第一版把断言写成 `b === 0` 是错的：`pity = 3` 时两发之后
       `miss = 2`、`until = 1`，而**第三发**才是保底那一发。 */
    const c = Link.roll('core', st, never);
    ok(a === pit - 1 && b === pit - 2 && c.byPity,
      '保底进度逐次递减（' + a + ' → ' + b + '），而下一发走保底（byPity=' + c.byPity + '）');
  }
  ok(Link.untilPity('core', Link.empty()) === Link.BY_ID['core'].pity,
    '刚开局时"还差 N 次必出" = 该素材的 pity');
  ok(!Link.roll('nope', Link.empty(), () => 0).got, '掷一个不存在的核心素材 → 不出、不炸');
  ok(!Link.roll('core', Link.empty(), null).got, '不给随机源 → 不出（回放要可复现，不给就不掷）');
}

/* =========================================================
   [6] 兑换：只有**模块代币之间**，而且必须带限制（v3 §5.3 + §7-12）
   ========================================================= */
console.log('\n[6] 兑换（模块代币 ↔ 模块代币）');
{
  const savedEx = Economy.EXCHANGE.slice();
  const bad = (label, ex) => {
    Economy.EXCHANGE.length = 0;
    Economy.EXCHANGE.push(ex);
    const v = Economy.audit();
    ok(!v.ok, label, (v.problems || [])[0]);
  };

  bad('把**核心素材**塞进兑换 → 审计报出来（它是钥匙不是钱）',
    { id: 'x', from: 'core', to: 'material', rate: 0.5, cap: 1, cost: 1, where: 'combat', note: '反证' });
  bad('拿全局货币当模块代币换 → 审计报出来（兑换只谈模块代币之间）',
    { id: 'x', from: 'material', to: 'capacity', rate: 0.5, cap: 1, cost: 1, where: 'manage', note: '反证' });
  bad('汇率 ≥ 1（不是高税）→ 审计报出来',
    { id: 'x', from: 'scrap', to: 'capacity', rate: 1, cap: 1, cost: 1, where: 'manage', note: '反证' });
  bad('既不限额也不要手续费 → 审计报出来（玩家会拿它绕过整个模块）',
    { id: 'x', from: 'scrap', to: 'capacity', rate: 0.5, cap: 0, cost: 0, where: 'manage', note: '反证' });

  Economy.EXCHANGE.length = 0;
  Economy.EXCHANGE.push(...savedEx);
  ok(Economy.audit().ok, '兑换表装回去之后重新通过');

  const n = Economy.EXCHANGE.length;
  ok(n === 0, '当前登记的兑换条数：' + n +
    '（机制已就位；真正的兑换要等三个模块各自成立之后再定）');
}

/* =========================================================
   [7] 守卫：`economy.ts` **自己不许定义货币**（v3 §8-7）
   ========================================================= */
console.log('\n[7] 守卫：禁止统一 economy.ts');
{
  ok(Registry.has('currency'), '代币进了总账（family: currency）');
  ok(Registry.has('ledger'), '四本账进了总账（family: ledger）');
  ok(Registry.has('currencyRole'), '代币角色进了总账（family: currencyRole）');
  ok(Registry.has('coreLink'), '核心素材进了总账（family: coreLink）');
  ok(!Registry.has('currencyTier'), '旧的 `currencyTier`（按"能不能带出局"分档）已经**不存在**');

  ok(Registry.ids('currency').length === Economy.LIST.length, '总账里的代币数与汇总视图一致');
  ok(Registry.ids('ledger').length === 4, '总账里有 4 本账');
  ok(Registry.ids('coreLink').length === 3, '总账里有 3 个核心素材');

  const orphan = Economy.LIST.filter(c => !Ledger.byId(c.ledger));
  ok(orphan.length === 0, '汇总视图里没有"无账可归"的代币（手写的会露出来）',
    orphan.map(c => c.id).join(','));

  const v = Registry.audit();
  ok(v.ok, '总账整体自洽（跨表引用都真的存在）', (v.missing || []).slice(0, 3).join(' | '));
}

console.log(failures ? '\n  \x1b[31m' + failures + ' 项失败 ✘\x1b[0m' : '\n  全部通过 ✔');
process.exit(failures ? 1 : 0);
