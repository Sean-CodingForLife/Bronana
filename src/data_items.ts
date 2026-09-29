/* =========================================================
   data_items.ts — 商店道具（被动强化）
   icon 决定程序化绘制的图标造型
   ========================================================= */

import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';
import { Tiers } from './data_tiers.ts';
import { Affixes } from './affixes.ts';
import { U } from './utils.ts';
var I = {} as ItemsApi;

/**
 * **代价数据是否已经填过**。
 *
 * `COST_KINDS` / `COST_AXES` / `foldCosts` 把"道具的代价"做成了一等公民
 * （声明表 + 折叠出口 + 写错键要报出来的守卫）。这一版**数据填好了**：
 * 29 件里 26 件"有得有失"，3 件是明示的白板（新手锚点，有名额上限）。
 *
 * 开关留着是为了"以后要重配平"时有个明确的两档：
 * `false` = 机制在、数据留白（守卫只查"写了的键对不对"）；
 * `true`  = 数据填好了（四条系统级守卫开始要求每一件都"有得有失"）。
 */
var COST_DATA_READY = true;

I.LIST = [
  /* =========================================================
     T1 · 便宜货 —— 前两波的锚点
     ---------------------------------------------------------
     这一档刻意留了 2 件**白板**（`plain: true`）：开局裸装时玩家需要一个
     "不用想就能拿"的锚点，否则第一次进商店就要做四个取舍 ——
     而那是在他还没有建立起任何体系之前。白板只允许出现在 T1/T2，且有名额上限。
     其余每一件都"有得有失"，而且**换的轴不一样**（见 `I.COST_AXES`）。
     ========================================================= */
  { id: 'coffee',   name: '咖啡',       en: 'Coffee',        slot: 'consumable', tier: 1, price: 8,  icon: 'bottle', tint: '#8a5a33',
    stats: { attackSpeed: 0.12, damage: -0.04 }, desc: '手更快，但每一击没那么重' },
  { id: 'snack',    name: '能量棒',     en: 'Snack',         slot: 'consumable', tier: 1, price: 8,  icon: 'bar',    tint: '#c98a55',
    stats: { maxHp: 5 }, cost: { shopPrice: 1.06 },
    desc: '血更厚，代价是货架上的东西更贵' },
  { id: 'helmet',   name: '皮质头盔',   en: 'Leather Hood',  slot: 'armor',      tier: 1, price: 9,  icon: 'helm',   tint: '#8a5a33',
    stats: { armor: 3, critChance: -0.03 }, desc: '护住脑袋，也就看不清要害' },
  { id: 'sneaker',  name: '旧球鞋',     en: 'Sneakers',      slot: 'trinket',    tier: 1, price: 9,  icon: 'boot',   tint: '#6f8fb0',
    plain: true, plainNote: '开局走位锚点：前两波玩家还没有任何体系，需要一件"不用想就能拿"的东西',
    stats: { speed: 0.09 }, desc: '跑得快一点。没有别的' },
  { id: 'clover',   name: '四叶草',     en: 'Clover',        slot: 'trinket',    tier: 1, price: 10, icon: 'clover', tint: '#4f9d69',
    plain: true, plainNote: '幸运是"经济"那一轴的门票：第一件必须是纯的，否则没人敢碰这条线',
    stats: { luck: 4 }, desc: '运气好一点。没有别的' },
  { id: 'magnet',   name: '磁铁',       en: 'Magnet',        slot: 'trinket',    tier: 1, price: 10, icon: 'magnet', tint: '#5f8fc4',
    stats: { pickupRange: 8, harvesting: 3, armor: -1 }, desc: '捡得又远又多，代价是身上更脆' },

  /* =========================================================
     T2 · 主力 —— 从这里开始每一件都是一次选择题
     ========================================================= */
  { id: 'whetstone', name: '磨刀石',    en: 'Whetstone',     slot: 'gear',       tier: 2, price: 18, icon: 'stone',  tint: '#9c9384',
    stats: { meleeDmg: 7, rangedDmg: -4 }, desc: '近战更狠，手上的枪就顾不上了' },
  { id: 'scopeitem', name: '瞄准镜',    en: 'Scope',         slot: 'gear',       tier: 2, price: 18, icon: 'scope',  tint: '#5f8fc4',
    stats: { rangedDmg: 7, meleeDmg: -4 }, desc: '远程更准，贴身肉搏就别指望了' },
  { id: 'glove',    name: '拳击手套',   en: 'Boxing Glove',  slot: 'gear',       tier: 2, price: 16, icon: 'glove',  tint: '#c05a4a',
    stats: { damage: 0.10, knockbackBonus: 0.30, attackSpeed: -0.05 }, desc: '每一拳都重，但出手慢了半拍' },
  { id: 'medicine', name: '小药瓶',     en: 'Medicine',      slot: 'consumable', tier: 2, price: 17, icon: 'potion', tint: '#cf5a6a',
    stats: { hpRegen: 1.5, maxHp: 3 }, cost: { fragile: 1.10 },
    desc: '一直在回血，代价是挨打也更疼（×1.10）' },
  { id: 'tattoo',   name: '图腾纹身',   en: 'Tattoo',        slot: 'trinket',    tier: 2, price: 18, icon: 'tattoo', tint: '#8f6fae',
    stats: { lifesteal: 0.06, hpRegen: -0.6 }, desc: '打人回血，但不再自然愈合' },
  { id: 'beret',    name: '幸运贝雷帽', en: 'Lucky Beret',   slot: 'trinket',    tier: 2, price: 19, icon: 'helm',   tint: '#c96f9a',
    stats: { luck: 9, harvesting: 4, damage: -0.10 }, desc: '开出与捡到的都更好，代价是打得更轻' },
  { id: 'cloak',    name: '轻甲斗篷',   en: 'Light Cloak',   slot: 'armor',      tier: 2, price: 20, icon: 'cloak',  tint: '#7d8a5a',
    stats: { armor: 4, dodge: 0.04, attackSpeed: -0.06 }, desc: '防得住也躲得开，就是挥不动' },
  { id: 'treadmill', name: '跑步机',    en: 'Treadmill',     slot: 'trinket',    tier: 2, price: 19, icon: 'gear',   tint: '#b8763f',
    stats: { speed: 0.16, maxHp: -3 }, desc: '快得像换了个角色，代价是心更薄' },
  { id: 'rations',  name: '压缩口粮',   en: 'Rations',       slot: 'consumable', tier: 2, price: 15, icon: 'bar',    tint: '#a8894f',
    stats: { harvesting: 7, maxHp: -3 }, desc: '收获更高（材料来得快），代价是身体被掏空' },
  { id: 'warpipe',  name: '异星烟斗',   en: 'Alien Pipe',    slot: 'consumable', tier: 2, price: 14, icon: 'stone',  tint: '#7a5f8f',
    stats: { luck: 6, harvesting: 6 }, cost: { enemyHp: 1.10, enemyDmg: 1.06, enemySpeed: 1.04, salvage: 0.85 },
    desc: '敌人更结实更快也更疼、拆装备也更亏（回收 ×0.85），但你开出与捡到的都更好' },

  /* =========================================================
     T3 · 强力 —— 好处大、代价也重（构筑真正开始的地方）
     ========================================================= */
  { id: 'coffee2',  name: '浓缩咖啡',   en: 'Espresso',      slot: 'consumable', tier: 3, price: 30, icon: 'bottle', tint: '#5a3a22',
    stats: { attackSpeed: 0.24, damage: -0.12 }, desc: '快。很脆的快' },
  { id: 'bionic',   name: '仿生手臂',   en: 'Bionic Arm',    slot: 'gear',       tier: 3, price: 32, icon: 'arm',    tint: '#b9bcc2',
    stats: { rangedDmg: 12, damage: 0.06, meleeDmg: -6 }, desc: '枪法如神，近身却成了短板' },
  { id: 'ripper',   name: '解剖刀',     en: 'Ripper',        slot: 'gear',       tier: 3, price: 32, icon: 'dagger', tint: '#c6cad1',
    stats: { meleeDmg: 12, critChance: 0.07, rangedDmg: -6 }, desc: '贴脸精准到能切开要害，代价是远程全废' },
  { id: 'cloak2',   name: '厚重护甲',   en: 'Heavy Armor',   slot: 'armor', tags: ['heavy'], tier: 3, price: 34, icon: 'armor', tint: '#8d9198',
    stats: { armor: 8, maxHp: 4, dodge: -0.06, speed: -0.08 }, desc: '变成一堵墙，也就跑不动了' },
  { id: 'lens',     name: '狙击透镜',   en: 'Sniper Lens',   slot: 'gear',       tier: 3, price: 33, icon: 'scope',  tint: '#e2564f',
    stats: { critChance: 0.16, attackSpeed: -0.06 }, cost: { rerollCost: 1.25 },
    desc: '每一下都可能致命；代价是刷新货架更贵（×1.25）' },
  { id: 'scanner',  name: '战术雷达',   en: 'Radar',         slot: 'gear',       tier: 3, price: 31, icon: 'gear',   tint: '#5f8fc4',
    stats: { range: 0.16, pickupRange: 12, damage: -0.06 }, desc: '看得更远、捡得更广，代价是打得轻一点' },
  { id: 'charm',    name: '骨制护符',   en: 'Bone Charm',    slot: 'trinket',    tier: 3, price: 30, icon: 'bone',   tint: '#ded3b6',
    stats: { lifesteal: 0.07, maxHp: 5, luck: -8 }, desc: '越打越活，代价是开不出好东西' },
  { id: 'goggles',  name: '工程师护目镜', en: 'Goggles',     slot: 'gear', tags: ['engineering'], tier: 3, price: 30, icon: 'goggles', tint: '#8ab84f',
    stats: { engineering: 10, critChance: -0.04 }, desc: '工程师的眼睛，代价是看不太清要害' },

  /* =========================================================
     T4 · 神装 —— 代价换成了"规则"（限制一条玩法，而不只是减属性）
     ========================================================= */
  { id: 'charcoal', name: '燃烧炭块',   en: 'Charcoal',      slot: 'trinket',    tier: 4, price: 46, icon: 'stone',  tint: '#4a423b',
    stats: { elementalDmg: 10, speed: -0.08 }, desc: '元素伤害暴涨，代价是脚步被烤焦' },
  { id: 'exo',      name: '外骨骼',     en: 'Exoskeleton',   slot: 'armor', tags: ['heavy'], tier: 4, price: 48, icon: 'armor', tint: '#b9bcc2',
    stats: { armor: 7, speed: 0.18, maxHp: 6, dodge: -0.06 }, desc: '又快又厚，代价是闪不开了' },
  { id: 'nano',     name: '纳米医疗',   en: 'Nano Medic',    slot: 'consumable', tier: 4, price: 50, icon: 'potion', tint: '#6fc07d',
    stats: { hpRegen: 4, lifesteal: 0.04, damage: -0.10 }, desc: '几乎死不掉，代价是伤害少一截' },
  { id: 'amulet',   name: '异星护符',   en: 'Alien Amulet',  slot: 'trinket',    tier: 4, price: 54, icon: 'amulet', tint: '#8f6fae',
    stats: { damage: 0.20, attackSpeed: 0.10 }, cost: { noHeal: 1 },
    desc: '伤害与攻速双暴涨，代价是本局**结算不再回血**' },
  { id: 'turretitem', name: '便携炮塔', en: 'Portable Turret', slot: 'gear', tags: ['engineering'], tier: 4, price: 56, icon: 'gear', tint: '#9c9384',
    stats: { engineering: 6, speed: -0.10 }, special: 'turret',
    desc: '每波开始时在场上部署 1 座自动炮塔；代价是背着它跑不快' },
  { id: 'duplicator', name: '克隆装置', en: 'Duplicator',    slot: 'gear', tags: ['engineering'], tier: 4, price: 58, icon: 'chip',   tint: '#e8b23c',
    stats: {}, special: 'extraProjectile', cost: { matMul: 0.75, noFreeReroll: 1 },
    desc: '所有远程武器额外发射 1 发弹丸；代价是**材料收入 −25%** 且**本局不再有免费刷新**' },
  { id: 'berserk',  name: '狂战士之心', en: 'Berserker Heart', slot: 'trinket',  tier: 4, price: 60, icon: 'heart',  tint: '#c05a4a',
    stats: { damage: 0.24, armor: -4 }, desc: '伤害暴涨，代价是护甲被撕开' }
];

/* 无原型表 —— 理由与 data_chars.ts 那张一样：`BY_ID['constructor']` 在普通对象上
   会返回 Object 构造函数，于是存档里 `items: ["constructor"]` 能塞进一件假道具 */
I.BY_ID = Object.create(null);
for (var i = 0; i < I.LIST.length; i++) I.BY_ID[I.LIST[i].id] = I.LIST[i];

I.priceOf = function (def, luck) {
  var p = (def.price || 10) * (1 - Math.min(0.30, (luck || 0) * 0.012));
  return Math.max(1, Math.round(p));
};

/** 生成商店随机道具（档位上限与武器共用品级表的那一份阶梯） */
I.rollShop = function (wave, rnd) {
  var maxTier = Tiers.capFor(wave);
  var pool = I.LIST.filter(function (d) { return d.tier <= maxTier; });
  var top = Tiers.topOf(pool, maxTier);
  var entries = pool.map(function (d) {
    var dist = top - d.tier;
    var w = dist === 0 ? 1.0 : (dist === 1 ? 1.6 : (dist === 2 ? 0.9 : 0.5));
    return { w: w, def: d };
  });
  return U.pickWeighted(entries, rnd).def;
};

/* =========================================================
   随机道具包
   价格不是拍出来的，而是由**开包期望值 × 折扣**反推，
   所以"概率表"和"标价"永远自洽：改权重不用改价格。
   幸运（luck）把权重往高层搬 —— 于是幸运这个属性第一次有了硬收益：
   同样的价钱，幸运越高开出的期望品质越好。
   ========================================================= */
I.PACK_DISCOUNT = 0.62;        // 相对期望值的折扣（赌的代价 = 不能挑）

/* 各层级的基础权重：普通包偏低层，高级包偏高层。
   **一项一档**（下标 0 = T1），长度必须等于品级表的档数 —— 以前这里写死四个数，
   而下面的循环也写死 `i < 4`：加一档会让 T5 永远开不出来（而且不报错）。
   现在长度由 `I.audit()` 守住，加档时它会当场说"包种的权重表少了一项"。
   末尾的 0 是"目前没有 T5 存量道具"这个事实，不是漏配。 */
I.PACK_BASE = {
  basic: [8, 4, 1, 0, 0],
  deluxe: [0, 3, 6, 2, 0]
};

/** 该波次能出现的最高层级（与商店一致，避免前期开出神装） */
I.maxTierFor = function (wave) { return Tiers.capFor(wave); };

/** 各层级的平均售价（用于反推期望值）—— 长度跟着品级表走 */
I.tierAvgPrice = (function () {
  var sum = [], cnt = [], out = [];
  for (var t = 0; t <= Tiers.MAX; t++) { sum[t] = 0; cnt[t] = 0; out[t] = 0; }
  for (var i = 0; i < I.LIST.length; i++) {
    var d = I.LIST[i];
    sum[d.tier] += d.price;
    cnt[d.tier]++;
  }
  for (var t2 = 1; t2 <= Tiers.MAX; t2++) out[t2] = cnt[t2] ? sum[t2] / cnt[t2] : 0;
  return out;
})();

/**
 * 某一层级的实际权重：基础权重 → 截断到本波可出层级 → 按幸运做几何倾斜
 * 返回 [t1, t2, t3, t4]
 *
 * 注意"退化"分支：高级包的基础权重是 [0,3,6,2]，而第 1~2 波只允许 T1，
 * 截断后权重全为 0 → 概率表为空、售价退化成最低价、rollPack 兜底给最便宜的道具。
 * 因此当某包种在本波没有任何可用层级时，退化为"只出本波最高可用层级"，
 * 保证函数是全的（任何波次、任何包种都能算出合法概率）。
 */
I.packWeights = function (wave, luck, kind) {
  var base = I.PACK_BASE[kind] || I.PACK_BASE.basic;
  var maxTier = I.maxTierFor(wave);
  var lift = Math.min(0.6, Math.max(0, (luck || 0) * 0.02));   // 幸运最多把高层权重抬高到这个程度
  var out = [];
  var sum = 0;
  for (var i = 0; i < Tiers.MAX; i++) {
    out[i] = 0;
    if (i + 1 > maxTier) continue;
    out[i] = base[i] * Math.pow(1 + lift, i);
    sum += out[i];
  }
  if (sum <= 0) out[maxTier - 1] = 1;      // 退化：只出本波最高可用层级
  return out;
};

/** 该包种在当前波次是否有意义（高级包在第 1~2 波还没有可用层级） */
I.packAvailable = function (wave, kind) {
  if (kind !== 'deluxe') return true;
  var base = I.PACK_BASE.deluxe;
  var maxTier = I.maxTierFor(wave);
  for (var i = 0; i < maxTier; i++) if (base[i] > 0) return true;
  return false;
};

/** 按权重逐层抽，再在该层内等概率抽一件 */
I.rollPack = function (wave, luck, rnd, kind) {
  var w = I.packWeights(wave, luck, kind);
  var entries = [];
  for (var i = 0; i < Tiers.MAX; i++) if (w[i] > 0) entries.push({ w: w[i], tier: i + 1 });
  if (!entries.length) return I.LIST[0];
  var tier = U.pickWeighted(entries, rnd).tier;
  var pool = I.LIST.filter(function (d) { return d.tier === tier; });
  return pool[Math.floor(rnd() * pool.length) % pool.length];
};

/** 开包期望价值（按当前概率表与价格表） */
I.packEV = function (wave, luck, kind) {
  var w = I.packWeights(wave, luck, kind);
  var ev = 0, tot = 0;
  for (var i = 0; i < Tiers.MAX; i++) {
    if (w[i] <= 0) continue;
    ev += w[i] * I.tierAvgPrice[i + 1];
    tot += w[i];
  }
  if (tot <= 0) return 0;
  return ev / tot;
};

/**
 * 道具包售价。
 * 注意：只用**幸运 0 的基准期望值**定价，幸运不再额外打折 ——
 * 否则幸运会同时抬高期望值又压低价格（同一个属性吃两次收益，
 * 实测会把实际折扣从 62% 变成 43%，标价与概率表也对不上了）。
 * 现在的不变式很简单：**价格恒等于基准期望值 × 折扣**，
 * 幸运的效果是"同样的价钱开出更好的东西"（实际折扣随幸运变优）。
 */
I.packPrice = function (wave, luck, kind) {
  var evBase = I.packEV(wave, 0, kind);
  return Math.max(3, Math.round(evBase * I.PACK_DISCOUNT));
};

/** 实际折扣（随幸运变优，用于显示/测试） */
I.packRealDiscount = function (wave, luck, kind) {
  var price = I.packPrice(wave, luck, kind);
  var ev = I.packEV(wave, luck, kind);
  return ev > 0 ? price / ev : 0;
};

/** 概率文字（给 UI 显示，让赌局透明） */
I.packOddsText = function (wave, luck, kind) {
  var w = I.packWeights(wave, luck, kind);
  var tot = 0, i;
  for (i = 0; i < Tiers.MAX; i++) tot += w[i];
  if (tot <= 0) return '';
  var parts = [];
  for (i = 0; i < Tiers.MAX; i++) {
    if (w[i] <= 0) continue;
    parts.push('T' + (i + 1) + ' ' + Math.round(w[i] / tot * 100) + '%');
  }
  return parts.join(' / ');
};

/* =========================================================
   道具的 special（"这一件改的是机制，不是数值"）
   ---------------------------------------------------------
   只有两条，但它们以前是**裸 if**：一件道具写着 `special: 'clone'`，
   而模拟层里没有那一行 `if (def.special === 'clone')` —— 这件道具就是**彻底没用**的，
   描述还在界面上写着它的效果。所以这里给它们一张声明表 + 一次折叠：
     · 表里登记每个 special（说明 + 谁读它）
     · `I.foldSpecials(items)` 在 recalcStats 时折成 `S.itemFx`，
       模拟层只读 `S.itemFx.xxx`，不再每帧遍历道具找字符串
     · 审计两条：每件道具的 special 必须在表里；表里的每个键必须有读点
   ========================================================= */
I.SPECIALS = {
  turret: { note: '进场时在玩家周围摆一圈工程炮塔', read: 'game.ts startWave → S.itemFx.turrets' },
  extraProjectile: { note: '所有远程武器每次多发一发弹丸', read: 'game.ts fire() → S.itemFx.extraProjectile' }
};

/** 把一串道具折成"机制那一份"（数值仍在 recalcStats 的属性累加里） */
I.foldSpecials = function (items) {
  var out: Record<string, number> = {};
  for (var k in I.SPECIALS) {
    if (Object.prototype.hasOwnProperty.call(I.SPECIALS, k)) out[k] = 0;
  }
  for (var i = 0; i < (items || []).length; i++) {
    var it = items[i];
    var sp = it && it.def && it.def.special;
    if (sp && Object.prototype.hasOwnProperty.call(out, sp)) out[sp] += 1;
  }
  return out;
};

/* =========================================================
   代价（`ItemDef.cost`）—— "有得有失"的**唯一**声明表
   ---------------------------------------------------------
   问题（改造前）：29 件道具有 **26 件是纯增益**，只有 3 件带负数
   （厚重护甲 / 狂战士之心 / 本身就是副作用的），而且是随手加的，
   没有一句"这件在换什么"。后果不是"不够难"，而是**没有决策**：
   货架上四张牌只有"哪个数字大"，玩家不需要分析、不需要构筑，
   只需要比大小 —— 于是"刷货架"取代了"想体系"。

   对照三家（都只取它们被验证过的那一层）：
     · **Brotato**：208 件道具里带负数的遍地都是，而且**不是随手加的**：
       `Coffee +10% Attack Speed / -2% Damage`、`Cape +20% Dodge / -2 三种伤害`、
       `Ball and Chain +15% Damage +3 Armor / -3% Speed + 武器冷却下限 0.75s`。
       它的每一件都在回答"你愿意拿什么换什么"。
     · **Slay the Spire 的 Boss 遗物**：代价机制**多样化** ——
       有的是永久限制（Sozu：不能再喝药水），有的是持续代价（Ectoplasm：不能再获得金币），
       有的是路线代价（Philosopher's Stone：敌人 +1 力量）。不是清一色的 "-N 属性"。
     · **Brotato 的 Curse（DLC）**：[诅咒](https://brotato.wiki.spellsandguns.com/index.php?title=Curse)
       把代价做成了**一整条独立的轴**：敌人更强（+150% HP / +25% 伤害 / +15% 速度），
       换更多材料与更强装备。它甚至给"代价本身"标了价 ——
       这是本作 `cost` 这一层最想学的东西：**代价可以是敌我双方的东西**。

   于是这里做三件事：
     1. **属性型的代价写成负 `stats`**（`{ armor: -3 }`）。为什么不是
        `cost.stat`：属性只有一条折进属性表的路径，写两处就是两条路径，
        而"同一件事有两个执行点"正是前面几轮反复踩到的坑。
        `cost` 只留给**属性表之外**的那三种代价（经济 / 敌人 / 规则）。
     2. `cost` 是**结构化**的（走 `COST_KINDS` 这张表）：`{ enemyHp: 1.10 }`、
        `{ noHeal: 1 }`。于是"减 6% 移速"与"+10% 敌人生命"在界面上、
        在折叠里被当成同一类东西。
     3. 每一件道具必须**两者都有**：至少一条收益 + 至少一条代价。
        只有极少数"白板"（`plain: true`）允许纯增益，而且有名额上限 ——
        它们是新手锚点，不是常态。

   `kind.fold` 决定代价怎么折：
     'stat'   并进属性表（**当前没有条目用它** —— 属性型代价走 `stats` 负值）
     'econ'   进 `S.itemCost`（材料收入 / 商店价 / 刷新价 / 回收价）
     'enemy'  进 `S.itemCost`（直接改敌人：这是"拿更强的敌人换更强的自己"）
     'flag'   进 `S.itemCost`（受伤倍率 / 布尔型限制，如"结算不再回血"）
   ========================================================= */
I.COST_KINDS = {
  /* ---- 经济型代价 ---- */
  matMul: { fold: 'econ', note: '材料收入倍率', how: 'mul' },
  shopPrice: { fold: 'econ', note: '商店价格倍率', how: 'mul' },
  rerollCost: { fold: 'econ', note: '刷新价倍率', how: 'mul' },
  salvage: { fold: 'econ', note: '回收返还倍率', how: 'mul' },
  /* ---- 敌人型代价：拿更强的敌人换更强的自己（Brotato 的 Curse 那一层） ---- */
  enemyHp: { fold: 'enemy', note: '敌人生命倍率', how: 'mul' },
  enemyDmg: { fold: 'enemy', note: '敌人伤害倍率', how: 'mul' },
  enemySpeed: { fold: 'enemy', note: '敌人移速倍率', how: 'mul' },
  /* ---- 规则型代价：不是数值，是一条限制（StS 的 Sozu / Ectoplasm 那一层） ---- */
  fragile: { fold: 'flag', note: '受到伤害倍率（大于 1 = 更疼）', how: 'mul' },
  noFreeReroll: { fold: 'flag', note: '本局不再有免费刷新', how: 'add' },
  noHeal: { fold: 'flag', note: '局内结算不再回血', how: 'add' }
};

/** 代价轴（界面上按这几类着色 / 排序；也是"取舍要有种类"的守卫依据） */
I.COST_AXES = {
  power: { name: '战斗力', note: '拿一条战斗属性换另一条' },
  mobility: { name: '机动', note: '拿走位换别的' },
  survival: { name: '生存', note: '拿血量 / 护甲 / 闪避换别的' },
  economy: { name: '经济', note: '拿材料与价格换战斗力' },
  danger: { name: '风险', note: '让敌人更强，换更强的自己' },
  rule: { name: '规则', note: '永久限制一条规则' }
};

/** 效果键 → 代价轴（审计用它回答"这件在换什么"） */
I.AXIS_OF_MOD = {
  damage: 'power', meleeDmg: 'power', rangedDmg: 'power', elementalDmg: 'power',
  attackSpeed: 'power', critChance: 'power', range: 'power', knockbackBonus: 'power',
  engineering: 'power',
  speed: 'mobility', pickupRange: 'mobility',
  maxHp: 'survival', armor: 'survival', dodge: 'survival',
  hpRegen: 'survival', lifesteal: 'survival',
  luck: 'economy', harvesting: 'economy',
  matMul: 'economy', shopPrice: 'economy', rerollCost: 'economy', salvage: 'economy',
  enemyHp: 'danger', enemyDmg: 'danger', enemySpeed: 'danger',
  fragile: 'rule', noFreeReroll: 'rule', noHeal: 'rule'
};

/**
 * 把一串道具折成"代价那一份"。
 * 与 `foldSpecials` 同一套路（折一次、只读结果）：
 *   `{ mul: { matMul, enemyHp, … }, add: { noHeal, … } }`
 * 缺省 = 全恒等（`mul` 是 1、`add` 是 0）—— 这是"行为指纹不受影响"的前提。
 *
 * 乘性代价会被**夹到 [0, 1]**（`mul`）：`1.10` 这类"代价"是"更大 = 更糟"的，
 * 所以它与缺省的 1 相乘会把值**推大**，而不是推小 —— 读点要按语义各自夹取
 * （见 game.ts 里 `itemCostMul` 的两种读法）。这一层只负责**如实折叠与相乘**。
 */
I.foldCosts = function (items) {
  var mul: Record<string, number> = {};
  var add: Record<string, number> = {};
  for (var k in I.COST_KINDS) {
    if (!Object.prototype.hasOwnProperty.call(I.COST_KINDS, k)) continue;
    if (I.COST_KINDS[k].how === 'add') add[k] = 0; else mul[k] = 1;
  }
  for (var i = 0; i < (items || []).length; i++) {
    var it = items[i];
    var cost = it && it.def ? it.def.cost : null;
    if (!cost) continue;
    for (var key in cost) {
      if (!Object.prototype.hasOwnProperty.call(cost, key)) continue;
      var kind = I.COST_KINDS[key];
      if (!kind) continue;
      var v = Number(cost[key]);
      if (!isFinite(v)) continue;
      if (kind.how === 'add') add[key] = (add[key] || 0) + v;
      else mul[key] = (mul[key] === undefined ? 1 : mul[key]) * v;
    }
  }
  return { mul: mul, add: add };
};

/** 定义期自检：包的权重表长度、档位均价表的长度都必须跟着品级表走 */
I.audit = function () {
  var problems = [];
  for (var kind in I.PACK_BASE) {
    if (!Object.prototype.hasOwnProperty.call(I.PACK_BASE, kind)) continue;
    var row = I.PACK_BASE[kind];
    if (row.length !== Tiers.MAX) {
      problems.push('包种 ' + kind + ' 的权重表有 ' + row.length + ' 项，品级表有 ' + Tiers.MAX + ' 档');
    }
  }
  if (I.tierAvgPrice.length !== Tiers.MAX + 1) {
    problems.push('档位均价表长度 ' + I.tierAvgPrice.length + ' ≠ 品级档数 + 1');
  }
  var axesUsed: Record<string, number> = Object.create(null);
  var plainCount = 0, costCount = 0, gainCount = 0;
  var kindsUsed: Record<string, number> = Object.create(null);
  for (var i = 0; i < I.LIST.length; i++) {
    var d = I.LIST[i];
    if (!(d.tier >= 1 && d.tier <= Tiers.MAX)) problems.push(d.id + ' 的档位越界：T' + d.tier);
    if (d.special && !I.SPECIALS[d.special]) problems.push(d.id + ' 的 special 没登记：' + d.special);
    /* 词条槽位：写错一个字母的后果是"这件道具永远是一张白板"，
       而它在货架上和别的道具长得一模一样（只是从来没有词条）——
       是最难被玩家发现、也最难被作者发现的一类坏数据。 */
    if (!d.slot) problems.push(d.id + ' 没有词条槽位（slot）——它会永远滚不出词条');
    else if (!Affixes.SLOTS.some(function (s) { return s.base === d.slot; })) {
      problems.push(d.id + ' 的词条槽位不在声明表里：' + d.slot);
    }
    /* 标签同理：写错一个字母 → `armor:heavy` 这条细分词条永远轮不到它 */
    if (d.tags) {
      for (var tg = 0; tg < d.tags.length; tg++) {
        if (!Affixes.TAGS[d.tags[tg]]) problems.push(d.id + ' 用了未声明的标签：' + d.tags[tg]);
      }
    }

    /* ---- "有得有失"的守卫 ----
       收益与代价都从**两处**收集：
         · 属性（`stats` 的正 / 负）—— 属性只有这一条路径
         · 结构化代价（`cost`）—— 经济 / 敌人 / 规则
       于是"有得有失"这件事只有一个判据，而它就是上面那两处的并集。 */
    var gains: string[] = [];
    var costs: string[] = [];
    for (var sk in (d.stats || {})) {
      if (!Object.prototype.hasOwnProperty.call(d.stats, sk)) continue;
      var sv = Number(d.stats[sk]);
      if (!isFinite(sv) || sv === 0) continue;
      if (!I.AXIS_OF_MOD[sk]) problems.push(d.id + ' 的属性 ' + sk + ' 没有归属的代价轴（AXIS_OF_MOD 里补一条）');
      if (sv > 0) gains.push(sk); else costs.push(sk);
    }
    if (d.special) gains.push(d.special);
    if (!gains.length) problems.push(d.id + ' 一条增益都没有（道具必须有"得"）');
    else gainCount++;

    for (var ck in (d.cost || {})) {
      if (!Object.prototype.hasOwnProperty.call(d.cost, ck)) continue;
      if (!I.COST_KINDS[ck]) {
        problems.push(d.id + ' 的代价键没登记：' + ck + '（这条代价永远不会生效）');
        continue;
      }
      var cv = Number(d.cost[ck]);
      if (!isFinite(cv)) { problems.push(d.id + ' 的代价 ' + ck + ' 不是有限数'); continue; }
      /* 方向守卫：乘性代价必须是"更糟的方向"，否则它其实是一条**藏起来的增益**
         （写成 `enemyHp: 0.9` 的意思就是"敌人变弱" —— 那不该叫代价）。 */
      var kd = I.COST_KINDS[ck];
      if (kd.how === 'mul' && cv <= 0) problems.push(d.id + ' 的代价 ' + ck + ' 不是正数：' + cv);
      costs.push(ck);
      kindsUsed[ck] = (kindsUsed[ck] || 0) + 1;
    }

    if (d.plain) {
      plainCount++;
      /* 白板是**例外**：它必须自己声明，而且有名额（见下面那条总量守卫）。
         允许它存在的理由只有一个：开局前几波需要一个"不用想就能拿"的锚点。 */
      if (!d.plainNote) problems.push(d.id + ' 标了 plain 却没写 plainNote（为什么它可以是纯增益）');
      if (d.tier > 2) problems.push(d.id + ' 是 T' + d.tier + ' 却标 plain —— 白板只允许出现在 T1/T2');
      if (costs.length) problems.push(d.id + ' 标了 plain 却有代价（两者矛盾）');
    } else if (COST_DATA_READY && !costs.length) {
      problems.push(d.id + ' 没有任何代价（"有得有失"是这一层的规则：要么写代价，要么标 plain）');
    } else if (costs.length) {
      costCount++;
    }
    /* 代价轴：这件在换什么？一个都答不出来 = 代价是随手加的 */
    for (var ci = 0; ci < costs.length; ci++) {
      var ax = I.AXIS_OF_MOD[costs[ci]];
      if (!ax) problems.push(d.id + ' 的代价 ' + costs[ci] + ' 没有归属的代价轴（AXIS_OF_MOD 里补一条）');
      else axesUsed[ax] = (axesUsed[ax] || 0) + 1;
    }
  }

  /* ---- 系统级守卫：取舍必须**成体系**，不是零星几件 ----
     与上面那条一样，**只有在代价数据真的填过之后才有意义**：
     数据留白时它们会对着"一件代价都没有"大喊，而那正是当下的已知状态。 */
  var n = I.LIST.length;
  var axisNames = Object.keys(I.COST_AXES);
  if (COST_DATA_READY) {
    if (costCount < n * 0.75) {
      problems.push('带代价的道具只有 ' + costCount + '/' + n + ' 件 —— "有得有失"没成体系（至少 75%）');
    }
    if (plainCount > 6) problems.push('白板（纯增益）有 ' + plainCount + ' 件，太多了（上限 6）');
    for (var a = 0; a < axisNames.length; a++) {
      if (!axesUsed[axisNames[a]]) problems.push('代价轴 ' + axisNames[a] + ' 一件道具都没有 —— 这一轴是装饰');
    }
    /* 种类也要够：全是"减属性"等于只有一种代价（StS 的教训：代价机制必须多样） */
    var nonStatKinds = 0;
    for (var kk in kindsUsed) {
      if (Object.prototype.hasOwnProperty.call(kindsUsed, kk)) nonStatKinds++;
    }
    if (nonStatKinds < 3) {
      problems.push('非属性型的代价只有 ' + nonStatKinds + ' 种（材料/价格/敌人/规则）—— 代价种类太少，读起来全是"-N 属性"');
    }
    /* "声明了没人用"：每个代价键都该有道具在用（有 11 个键而只用了 2 个
       说明这张表是摆设）。 */
    for (var mk in I.COST_KINDS) {
      if (Object.prototype.hasOwnProperty.call(I.COST_KINDS, mk) && !kindsUsed[mk]) {
        problems.push('代价键 ' + mk + ' 声明了却没有任何道具用它');
      }
    }
  }

  return {
    ok: problems.length === 0, problems: problems,
    counts: {
      items: n, specials: Object.keys(I.SPECIALS).length,
      withCost: costCount, plain: plainCount, gains: gainCount,
      axes: axisNames.length, kinds: Object.keys(I.COST_KINDS).length
    }
  };
};

var iverdict = I.audit();
if (!iverdict.ok) throw new Error('data_items.ts 道具表自检失败：\n' + iverdict.problems.join('\n'));
SelfCheck.register('Items', I.audit);

/* 登记到扩展点总账：每个道具的 icon 必须有画法，tier 必须落在**品级表**里
   （以前这里另有一个 `itemTier` 家族写着 values: [1,2,3,4] —— 品级表加一档，
   它不会跟着动，于是"新档位的道具"会被总账判成非法。现在两边是同一份。） */
Registry.family('item', {
  note: '道具库（数据表）', owner: 'data_items.ts',
  entries: function () {
    return I.LIST.map(function (d) {
      var refs = [
        { field: 'icon', value: d.icon, family: 'itemIcon' },
        { field: 'tier', value: 'T' + d.tier, family: 'tier' },
        /* `special` 是一次跨表引用：写一个表里没有的机制名（或表里登记了却没人读），
           这件道具就是**彻底没用**的 —— 而它的描述还在界面上写着效果。 */
        { field: 'special', value: d.special, family: 'itemSpecial' }
      ];
      /* 代价键也是一次跨表引用：写错一个键（`enmyHp`）会让这条代价**永远不生效**，
         而界面上它照旧写着"敌人更结实"。 */
      for (var ck in (d.cost || {})) {
        if (Object.prototype.hasOwnProperty.call(d.cost, ck)) {
          refs.push({ field: 'cost.' + ck, value: ck, family: 'itemCost' });
        }
      }
      return { id: d.id, refs: refs };
    });
  }
});
Registry.family('itemSpecial', {
  note: '道具的机制类效果（改了机制而不是数值的那些）+ 谁读它', owner: 'data_items.ts',
  values: function () { return Object.keys(I.SPECIALS); }
});
Registry.family('itemCost', {
  note: '道具的代价键（经济 / 敌人 / 规则三类；写错 = 这条代价永远不生效）', owner: 'data_items.ts',
  values: function () { return Object.keys(I.COST_KINDS); }
});
Registry.family('itemCostAxis', {
  note: '代价轴（界面按它分类；"取舍要有种类"的守卫依据）', owner: 'data_items.ts',
  values: function () { return Object.keys(I.COST_AXES); }
});

/* 把道具表交给词条系统（与 data_weapons.ts 末尾同一步，理由见那里的注释）。
   **必须放在家族登记之后**：`Affixes.audit` 的"这件装备滚不出词条"那一条
   要读道具表，而它自己在下面被注册进启动期自检。 */
Affixes.bindTables('item', I.LIST);

/* 字段 → 家族的声明（守卫读它，见 test/data-contract.mjs）。 */
Registry.uses('icon', 'itemIcon');
Registry.uses('tier', 'tier');
Registry.uses('special', 'itemSpecial');
Registry.uses('slot', 'affixSlot');
Registry.uses('tags', 'affixTag');

export { I as Items };
