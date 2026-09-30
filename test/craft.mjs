/* =========================================================
   craft.mjs — 制造（经营这根柱子的核心）

   这一套盯三件事：
     1) **配方不是手写的第三张表** —— 它由已有的武器 / 道具两张表长出来，
        每一件已存在的装备/道具都恰好一条配方（漏一件 = 玩家在图鉴里看得到、
        在工坊里永远造不出）
     2) 费用与档位：费用随档位单调上涨；费用只由"原价 + 工坊省料"决定
     3) **没有新元素**：产物、输入、费用单位全部是游戏里已经有的东西
        （这条是"用已有的东西重构"的落地判据）

   用法： node test/craft.mjs
   ========================================================= */
import { loadAll, SIM_MODULES } from './_load.mjs';
/* ⚠ 共享断言库（`_assert.mjs`）—— 不再各自复制一份 `T.ok()`。
   它多给两件事：失败时**两个值都打出来**（`T.eq`），
   以及**一条抛异常不会炸掉整套**（`T.try`）。 */
import { T } from './_assert.mjs';

await loadAll(SIM_MODULES);
const { Craft, Weapons, Items, Camp, Forge, Game } = globalThis;
console.error = function () { };

console.log('\n=== Bronana · 制造（配方 = 已有的装备与道具） ===\n');

T.section('配方表：由两张已有的表长出来，一件不落');
{
  const a = Craft.audit();
  T.ok(a.ok === true, '定义期自检通过（' + a.counts.recipes + ' 条配方 = ' +
    a.counts.weapons + ' 武器 + ' + a.counts.items + ' 道具 / ' + a.counts.tiers + ' 个档位）',
    a.problems.slice(0, 4).join(' | '));
  T.ok(Craft.LIST.length === Weapons.LIST.length + Items.LIST.length,
    '配方数 = 武器数 + 道具数（没有手写的第三张表）',
    Craft.LIST.length + ' vs ' + (Weapons.LIST.length + Items.LIST.length));

  const missingW = Weapons.LIST.filter(d => !Craft.BY_ID['weapon:' + d.id]);
  const missingI = Items.LIST.filter(d => !Craft.BY_ID['item:' + d.id]);
  T.ok(missingW.length === 0 && missingI.length === 0, '每一件武器与道具都有配方',
    missingW.concat(missingI).map(d => d.id).join(','));

  const tiers = new Set(Craft.LIST.map(r => r.tier));
  T.ok([1, 2, 3, 4].every(t => tiers.has(t)), '四个档位都有东西可造（有空档 = 那一档图纸是空头支票）',
    [...tiers].join(','));

  // 没有新元素：配方指向的 id 必须真的在已有的两张表里
  const badRef = Craft.LIST.filter(r => !(r.kind === 'weapon' ? Weapons.BY_ID[r.refId] : Items.BY_ID[r.refId]));
  T.ok(badRef.length === 0, '每条配方指向的东西都真实存在（没有新造的东西）', badRef.map(r => r.id).join(','));
}

T.section('费用：档位越高越贵，且只由「原价 + 工坊省料」决定');
{
  const mins = [1, 2, 3, 4].map(t => {
    const list = Craft.LIST.filter(r => r.tier === t).map(r => Craft.costOf(r, null, null));
    return Math.min.apply(null, list);
  });
  for (let i = 1; i < mins.length; i++) {
    T.ok(mins[i] > mins[i - 1], 'T' + (i + 1) + ' 的最低价高于 T' + i + '（' + mins[i - 1] + ' → ' + mins[i] + '）');
  }
  const w = Craft.BY_ID['weapon:knife'];
  T.ok(Craft.costOf(w, null, null) === Math.max(1, Math.round(w.base * Craft.MARKUP)),
    '没有工坊时：费用 = 原价 × ' + Craft.MARKUP, Craft.costOf(w, null, null));
  const cheap = Craft.costOf(w, null, { weaponCost: 0.3, itemCost: 0, weaponQuality: 0, itemDouble: 0, salvageBonus: 0 });
  T.ok(cheap < Craft.costOf(w, null, null), '工坊省料 → 更便宜（' + Craft.costOf(w, null, null) + ' → ' + cheap + '）');
  const item = Craft.BY_ID['item:coffee'];
  const itemOff = Craft.costOf(item, null, { weaponCost: 0.9, itemCost: 0, weaponQuality: 0, itemDouble: 0, salvageBonus: 0 });
  T.ok(itemOff === Craft.costOf(item, null, null),
    '武器的省料不影响道具（两类各自一条产线）', itemOff);

  // 制造必须**比商店的应急价便宜** —— 否则"能买为什么要造"
  T.ok(Craft.MARKUP < Craft.EMERGENCY_MARKUP,
    '制造（×' + Craft.MARKUP + '）比货架的应急价（×' + Craft.EMERGENCY_MARKUP + '）便宜');
}

T.section('档位门槛：图纸决定「能造什么」');
{
  const cap = t => ({ craftTier: t, craftQuality: 0, lines: 0, salvageBonus: 0, alloyPerSalvage: 0, fuseDiff: 0, alloyMul: 0 });
  const shotgun = Craft.BY_ID['weapon:shotgun'];   // T3
  T.ok(Craft.canMake(shotgun, cap(2)).ok === false, '图纸只到 T2 时，T3 造不了',
    Craft.canMake(shotgun, cap(2)).reason);
  T.ok(Craft.canMake(shotgun, cap(3)).ok === true, '图纸到 T3 → 能造');
  T.ok(Craft.canMake(shotgun, null).ok === false, '完全没有图纸时也造不了 T3（默认只有 T1）');
  const knife = Craft.BY_ID['weapon:knife'];
  T.ok(Craft.canMake(knife, null).ok === true, '但 T1 永远能造（起步不至于无从下手）');
  T.ok(Craft.available(cap(1)).every(r => r.tier === 1), 'available() 只列够档的',
    Craft.available(cap(1)).map(r => r.tier).join(','));
}

T.section('产线：设备数 + 图纸名额，每波每条只能造一件');
{
  const f = Forge.emptyMods();
  T.ok(Craft.linesOf(0, f) === 0, '没有设施就没有产线');
  T.ok(Craft.linesOf(2, f) === 2, '两座设施 → 两条产线');
  T.ok(Craft.linesOf(2, { lines: 1 }) === 3, '图纸「量产线」再加一条（3）', Craft.linesOf(2, { lines: 1 }));
  T.ok(Craft.lineFree([], 0) === true && Craft.lineFree([0], 0) === false &&
     Craft.lineFree([0], 1) === true, '这一波用过的产线不再空着（每波重置）');
  /* 工坊的省料封顶（camp.ts 的 COST_CAP）：叠到免费会把材料经济整条抹掉 */
  const fx = Camp.effects({ furnace: 2, still: 2, anvil: 2, assay: 2, salvage: 2 },
    ['furnace', 'still', 'anvil', 'assay', 'salvage']);
  const k = Craft.BY_ID['weapon:knife'];
  T.ok(Craft.costOf(k, null, fx) >= Math.round(k.base * Craft.MARKUP * (1 - Camp.COST_CAP)),
    '省料叠满也留得住成本（' + Craft.costOf(k, null, fx) + ' ≥ ' +
    Math.round(k.base * Craft.MARKUP * (1 - Camp.COST_CAP)) + '）');
  T.ok(Game.craftOptions().every(o => typeof o.cost === 'number' && o.cost > 0),
    'craftOptions() 每条都算了费用（界面不自己算）');
}

process.exit(T.done());
