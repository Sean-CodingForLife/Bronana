/* =========================================================
   craft.ts — 制造（经营那一根柱子的核心）
   ---------------------------------------------------------
   三根柱子各自的职责（这一步重排的**唯一**目的）：
     · 出击 = 探索 + 收集（房间、路线、掉落）
     · **制造 = 把收集到的东西造成装备与道具** ← 本文件
     · 图纸 = 解锁"能造什么"（forge.ts）
   接口是**单向**的，只有三根线：
     出击 → 制造：材料 / 建材 / 旧装备
     制造 → 出击：装备与道具
     制造 → 图纸 → 两边：能造什么、产能多少

   为什么制造要用**已有的表**：产物就是现成的 24 把武器与 29 件道具。
   没有一条新装备、没有一种新货币、没有一种新材料 —— 这一步的产物、
   输入、费用单位全部是游戏里已经存在的东西。配方不是一张新表：
   **每一件已存在的装备本身就是一条配方**，费用由它自己的价格算出来。

   与"商店买卖"的关系（这一条是设计要害）：
     · 制造 = 便宜，但要**图纸** + 占**一条产线的一波**
     · 商店 = 应急成品，贵（MARKUP 之上再溢价），但立刻到手、不需要图纸
   于是"能买为什么要造"这个问题有答案：造得起的比买得便宜，
   而产线本身就是稀缺（位子只有 3 个、每波每条只出一件）。
   ========================================================= */

import { Items } from './data_items.ts';
/* 经营子模块读**建造子模块的设施表**来算产出 —— 同层（都是 meta），方向合法：
   经营看建造是「看它盖了什么」，而建造不认识经营。 */
import { Stronghold } from './stronghold.ts';
import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';
import { Weapons } from './data_weapons.ts';

var Craft = {} as CraftApi;

/** 制造成本 = 原价 × 这个数（比商店的应急价便宜，但要多花一条产线的这一波） */
Craft.MARKUP = 1.4;
/** 商店那一边的"应急"溢价（market.ts 读它） */
Craft.EMERGENCY_MARKUP = 1.6;

/**
 * 配方表：**由已有的两张表长出来**，不是手写的第三张表。
 * `id` 形如 `weapon:knife` / `item:coffee`，与仓库里的日志、存档、界面按钮同构。
 */
function buildRecipes() {
  var out: CraftRecipe[] = [];
  var i;
  for (i = 0; i < Weapons.LIST.length; i++) {
    var w = Weapons.LIST[i];
    out.push({
      id: 'weapon:' + w.id, kind: 'weapon', refId: w.id, name: w.name, tier: w.tier || 1,
      base: Weapons.priceOf(w, 0), def: w
    });
  }
  for (i = 0; i < Items.LIST.length; i++) {
    var it = Items.LIST[i];
    out.push({
      id: 'item:' + it.id, kind: 'item', refId: it.id, name: it.name, tier: it.tier || 1,
      base: Items.priceOf(it, 0), def: it
    });
  }
  return out;
}

/* =========================================================
   经营子模块的**产出**：产能（M2 第二刀）
   ---------------------------------------------------------
   v3 §三-2 把「资源 / 生产 / 供需 / 效率 / 市场 / 人员 / 时间」划给
   **经营子模块** —— 所以产能是**这里**产出来的，不是建造那边。

   ⚠ **为什么有一个不依赖设施的底数**：只由设施产的话，开局就是
   0 设施 → 0 产能 → 建不了设施 —— 一个把自己锁死的循环。
   v3 §5.3-9 的「撞墙不卡死」要求的正是这一条：**经营模块自己会运转**，
   设施是让它转得更快，不是让它开始转。
   ========================================================= */
Craft.CAPACITY_BASE = 1;      // 每波的基础运转（不依赖任何设施）
Craft.CAPACITY_PER_LEVEL = 2; // 每波、每级设施额外产的

/** 这一波的**产能产出**：基础运转 + 设施产出（v3 §8-2 的「设施产出」） */
/**
 * 这一波的产能产出：基础运转 + 设施产出 + 据点的加成。
 *
 * ⚠ `bonus` 来自据点「档案馆」（M2 第二刀从 `bonusPoints` 改过来的）。
 *   它**原来是"训练每次额外给成长点"** —— 那是**建造机制承载养成的成长**，
 *   而 v3 §三-2 明令禁止（"不得让建造机制承载战斗或养成的成长"）。
 *   改指到产能上之后，它走的是**同一模块内两个子模块共享代币**这条路 ——
 *   那正是 v3 §三-2 允许的那一条。
 */
Craft.capacityYield = function (owned, bonus) {
  var lv = 0;
  for (var i = 0; i < Stronghold.LIST.length; i++) {
    lv += Stronghold.levelOf(owned, Stronghold.LIST[i].id);
  }
  return Craft.CAPACITY_BASE + lv * Craft.CAPACITY_PER_LEVEL + Math.max(0, Math.floor(Number(bonus) || 0));
};

Craft.LIST = buildRecipes();
Craft.BY_ID = (function () {
  var m: Record<string, CraftRecipe> = Object.create(null);
  for (var i = 0; i < Craft.LIST.length; i++) m[Craft.LIST[i].id] = Craft.LIST[i];
  return m;
})();

/**
 * 这一件现在能不能造。
 * 门槛只有一条：**图纸够不够高**（`mods.craftTier`，由工坊图纸树给）。
 * 为什么用"档位上限"而不是"每件单独解锁"：那 53 件装备各自一张图纸，
 * 玩家要读 53 行才能知道自己能造什么；按档位分成四层，一屏就说清楚。
 * @returns { ok, reason }
 */
Craft.canMake = function (r, mods) {
  if (!r) return { ok: false, reason: '没有这个配方' };
  var cap = Math.max(1, Math.floor((mods && mods.craftTier) || 1));
  if ((r.tier || 1) > cap) {
    return { ok: false, reason: '需要 T' + r.tier + ' 图纸（现在只能造到 T' + cap + '）' };
  }
  return { ok: true, reason: '' };
};

/**
 * 一件的实际材料费用。输入三样，全部已有：原价、这件东西的类型、工坊的省料。
 * 封顶由 camp.ts 的 COST_CAP 负责（不让"省料"叠到免费 —— 那会把材料经济整条抹掉）。
 * **图纸不给省料**：图纸给的是"能造什么"（档位）与产能，省料是工坊设施的事 ——
 * 这样两根柱子的产出不重叠。
 */
Craft.costOf = function (r, mods, campFx) {
  if (!r) return 0;
  var off = 0;
  if (r.kind === 'weapon') off += (campFx && campFx.weaponCost) || 0;
  else off += (campFx && campFx.itemCost) || 0;
  off = Math.max(0, Math.min(0.6, off));
  return Math.max(1, Math.round(r.base * Craft.MARKUP * (1 - off)));
};

/** 能造的配方（界面按它铺一屏），`mods` 决定档位上限 */
Craft.available = function (mods) {
  return Craft.LIST.filter(function (r) { return Craft.canMake(r, mods).ok; });
};

/**
 * 这一次制造出来的东西是**哪一档**。
 * 两种加成叠在一起（都用已有的品级系统，没有第二套强度轴）：
 *   · 营地「锻台 / 试制台」：本局的制造质量
 *   · 图纸「淬火」：永久的制造质量
 *
 * **顶档要图纸**：抬到品级表最后一档（T5 神话）必须已经点开「神话图纸」。
 * 为什么只夹顶档、中间档不夹：营地「锻台」的 +1 是本局花建材买来的，
 * 它以前能把 T1 造到 T2、T3 造到 T4 —— 那是营地那一根柱子的价值。
 * 如果按图纸上限一刀切，没点图纸的玩家盖了锻台也一点用没有，
 * 等于让"养成"去否决"经营"（正是要拆的耦合）。所以规则收紧成一句：
 *   **中间的台阶照旧（营地/淬火），只有最后一档归图纸。**
 * 顺带修掉一处**假成功**：以前在顶档配方上淬火成功、`lucky` 仍是 true，
 * 界面会说"淬火成功"而档位一点没变（clampTier 把它夹回去了）。
 * 现在 `lucky` 只在**档位真的被抬起来**时为真。
 *
 * @returns { tier, lucky, double }（lucky = 这一件是不是被抬上去的，界面据此说一句）
 */
Craft.resultTier = function (r, mods, campFx, rnd) {
  var t = r.tier || 1;
  /* 图纸允许造到哪一档（与 canMake 用的是同一个数：能造什么 = 能造出哪一档） */
  var cap = Math.min(Weapons.TIER_MAX, Math.max(1, Math.floor((mods && mods.craftTier) || 1)));
  var chance = 0;
  if (r.kind === 'weapon') {
    chance += (campFx && campFx.weaponQuality) || 0;
    chance += (mods && mods.craftQuality) || 0;
  } else {
    chance += (campFx && campFx.itemDouble) || 0;   // 道具的"质量"表现为**多出一件**
  }
  chance = Math.max(0, Math.min(0.9, chance));
  /* 没有质量加成时**一次随机都不抽** —— 空配置必须恒等，而且不能动随机流
     （否则所有既有存档的回放都会从第一次制造那一步起分叉）。 */
  if (chance <= 0 || typeof rnd !== 'function') return { tier: t, lucky: false, double: false };
  var hit = rnd() < chance;
  if (r.kind === 'item') return { tier: t, lucky: hit, double: hit };
  var raised = hit ? Math.min(t + 1, Weapons.TIER_MAX) : t;
  if (raised >= Weapons.TIER_MAX && cap < raised) raised = Math.max(t, Weapons.TIER_MAX - 1);
  return { tier: raised, lucky: raised > t, double: false };
};

/** 一条产线这一波还能不能用（`used` 是这一波已经用过的产线号列表） */
Craft.lineFree = function (used, line) { return (used || []).indexOf(line) < 0; };

/** 产线数 = **建了几座设施** + 图纸给的名额（每座设施就是一条产线） */
Craft.linesOf = function (builtCount, mods) {
  return Math.max(0, Math.floor(builtCount || 0)) + Math.max(0, Math.floor((mods && mods.lines) || 0));
};

/* =========================================================
   定义期自检：配方的两条硬规矩
     ① 每一件装备/道具都必须能在**某一档图纸**下造出来
        （否则"这件东西存在但永远造不出来"，玩家在图鉴里看得到、在工坊里找不到）
     ② 费用必须**随档位单调上涨**（否则所有人只会造最便宜的那一件）
   ========================================================= */
Craft.audit = function () {
  var problems: string[] = [];
  var seen: Record<string, boolean> = Object.create(null);
  var byTier: Record<number, number[]> = Object.create(null);
  for (var i = 0; i < Craft.LIST.length; i++) {
    var r = Craft.LIST[i];
    if (!r || !r.id) { problems.push('第 ' + i + ' 条配方没有 id'); continue; }
    if (seen[r.id]) problems.push('配方 id 重复：' + r.id);
    seen[r.id] = true;
    if (r.kind !== 'weapon' && r.kind !== 'item') problems.push(r.id + ' 的类型不是 weapon/item：' + r.kind);
    if (!(r.tier >= 1 && r.tier <= Weapons.TIER_MAX)) problems.push(r.id + ' 的档位越界：' + r.tier);
    if (!(r.base > 0)) problems.push(r.id + ' 没有基础价（费用算不出来）');
    if (!r.def) problems.push(r.id + ' 没有指向真实的定义');
    (byTier[r.tier] = byTier[r.tier] || []).push(Craft.costOf(r, null, null));
  }
  /* 每一档都要**到得了**：要么有配方，要么能从下一档抬上来（淬火 / 营地锻台）。
     顶档 T5（神话）就是后一种 —— 它**不在货架上**（没有 T5 的存量武器/道具），
     只能靠 16 把同名合成，或者靠「神话图纸」让淬火抬上去。
     这一条以前写的是"每一档都必须有配方"，于是加 T5 时它会把这张表判成坏的。 */
  for (var t = 1; t <= Weapons.TIER_MAX; t++) {
    if (byTier[t] && byTier[t].length) continue;
    if (t > 1 && byTier[t - 1] && byTier[t - 1].length) continue;
    problems.push('T' + t + ' 既没有配方，也没有下一档可以抬上来');
  }
  // 档位越高越贵：拿每一档的**最低价**比
  var mins = [];
  for (var t2 = 1; t2 <= Weapons.TIER_MAX; t2++) {
    if (byTier[t2] && byTier[t2].length) mins.push(Math.min.apply(null, byTier[t2]));
  }
  for (var m = 1; m < mins.length; m++) {
    if (mins[m] <= mins[m - 1]) problems.push('第 ' + (m + 1) + ' 档的最低价不比上一档高（' + mins[m - 1] + ' → ' + mins[m] + '）');
  }
  // 武器与道具都要有：只造武器或只造道具都会让另一半图纸无处可用
  var kinds: Record<string, number> = Object.create(null);
  for (var k = 0; k < Craft.LIST.length; k++) kinds[Craft.LIST[k].kind] = (kinds[Craft.LIST[k].kind] || 0) + 1;
  if (!kinds.weapon) problems.push('一条武器配方都没有');
  if (!kinds.item) problems.push('一条道具配方都没有');
  return {
    ok: problems.length === 0, problems: problems,
    counts: { recipes: Craft.LIST.length, weapons: kinds.weapon || 0, items: kinds.item || 0, tiers: mins.length }
  };
};

var verdict = Craft.audit();
if (!verdict.ok) throw new Error('craft.ts 配方自检失败：\n' + verdict.problems.join('\n'));
/* 也登记进**启动期自检**（main.ts 的 boot 门槛会跑）：定义期那次 throw 只在加载时跑一遍，
   而"有人改坏了配方（比如把某件装备漏掉）"通常发生在加载之后 —— 两处都守才算守住。 */
SelfCheck.register('Craft', Craft.audit);

/* 登记进总账：每一条配方指向一件真实的装备/道具（跨表引用），
   写错一个 id 会静默变成"这条配方造出来是空的"。 */
Registry.family('craftRecipe', {
  note: '制造配方（由武器 / 道具两张表长出来，每件一份）', owner: 'craft.ts',
  entries: function () {
    return Craft.LIST.map(function (r) {
      return { id: r.id, refs: [{ field: 'refId', value: r.refId, family: r.kind }] };
    });
  }
});

export { Craft };
