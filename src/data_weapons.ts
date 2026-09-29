/* =========================================================
data_weapons.ts — 武器库（近战 / 远程）
kind 决定程序化绘制的造型（sprites.ts 中按 kind 绘制）
========================================================= */

import { Comp } from './comp.ts';
import { Registry } from './registry.ts';
import { Tiers } from './data_tiers.ts';
import { Affixes } from './affixes.ts';
import { U } from './utils.ts';
var W = {} as WeaponsApi;

/**
 * 字段说明
 *  type      'melee' | 'ranged'
 *  dmg       基础伤害
 *  cd        基础冷却（秒）
 *  reach     攻击半径（像素，受 range 属性加成）
 *  arc       近战扇形弧度（度）
 *  knock     击退力度
 *  speed     弹速（远程）
 *  pierce    穿透数量
 *  spread    散射角度（度）
 *  shots     每次发射弹丸数
 *  kind      造型关键字
 *  tints     [主色, 暗色]
 */

W.LIST = [
  /* ================= 近战 ================= */
  { id: 'knife', name: '匕首', en: 'Knife', tier: 1, type: 'melee', price: 8,
    dmg: 4, cd: 0.62, reach: 78, arc: 62, knock: 90, kind: 'knife', tints: ['#c6cad1', '#8d9198'], icon: 'dagger',
    desc: '轻快短刃，出手极快。' },

  { id: 'sword', name: '长剑', en: 'Sword', tier: 2, type: 'melee', price: 20,
    dmg: 9, cd: 0.82, reach: 96, arc: 86, knock: 130, kind: 'sword', tints: ['#c6cad1', '#8d9198'], icon: 'sword',
    desc: '攻守均衡的经典近战。' },

  { id: 'spear', name: '长矛', en: 'Spear', tier: 2, type: 'melee', price: 20,
    dmg: 8, cd: 0.88, reach: 132, arc: 42, knock: 150, kind: 'spear', tints: ['#b98a4b', '#7d5329'], icon: 'spear',
    desc: '手长，攻击范围极大。' },

  { id: 'axe', name: '战斧', en: 'Axe', tier: 3, type: 'melee', price: 32,
    dmg: 15, cd: 1.02, reach: 92, arc: 100, knock: 190, kind: 'axe', tints: ['#c6cad1', '#8d9198'], icon: 'axe',
    desc: '重击横扫，击退凶猛。' },

  { id: 'hammer', name: '雷霆战锤', en: 'Hammer', tier: 4, type: 'melee', price: 48,
    dmg: 26, cd: 1.35, reach: 104, arc: 120, knock: 320, kind: 'hammer', tints: ['#a8adb6', '#6f747c'], icon: 'hammer',
    desc: '极重的一击，砸出地震。' },

  // 「重击」家族的第二把锤：家族轴要 4 把才够得着最高档，而重击原本只有 3 把
  // （战锤 / 等离子刃 / 触手）—— test/synergy.mjs 当场算出"这一档永远达不到"。
  // 复用 `kind: 'hammer'` 是刻意的：造型不用新画，而**玩法分组是按家族算的**，
  // 不按 kind —— 这正是"家族"这一层存在的理由。
  { id: 'quake', name: '裂地锤', en: 'Quake Maul', tier: 3, type: 'melee', price: 40,
    dmg: 20, cd: 1.16, reach: 116, arc: 132, knock: 350, kind: 'hammer', tints: ['#b0603c', '#83442a'], icon: 'hammer',
    desc: '砸下去，地面跟着抖一下。' },

  { id: 'torch', name: '火把', en: 'Torch', tier: 2, type: 'melee', price: 22,
    dmg: 6, cd: 0.70, reach: 84, arc: 70, knock: 80, kind: 'torch', tints: ['#e07a3a', '#a8481f'], element: 'fire', icon: 'torch',
    desc: '挥击附带灼烧，元素伤害。' },

  { id: 'taser', name: '电击棒', en: 'Taser', tier: 3, type: 'melee', price: 30,
    dmg: 10, cd: 0.95, reach: 90, arc: 58, knock: 90, kind: 'taser', tints: ['#7fc4d9', '#4a7f92'], element: 'shock', icon: 'taser',
    desc: '命中后电弧连锁到附近敌人。' },

  { id: 'plasma', name: '等离子刃', en: 'Plasma Blade', tier: 4, type: 'melee', price: 44,
    dmg: 20, cd: 0.90, reach: 98, arc: 92, knock: 160, kind: 'plasma', tints: ['#8f6fae', '#5d4576'], element: 'magic', icon: 'plasma',
    desc: '紫色能量刃，元素伤害极高。' },

  /* ================= 远程 ================= */
  { id: 'pistol', name: '手枪', en: 'Pistol', tier: 1, type: 'ranged', price: 8,
    dmg: 5, cd: 0.66, reach: 260, speed: 620, pierce: 0, kb: 40, kind: 'pistol', tints: ['#8d9198', '#5c6067'], icon: 'gun',
    desc: '初始远程，稳定可靠。' },

  { id: 'smg', name: '冲锋枪', en: 'SMG', tier: 2, type: 'ranged', price: 24,
    dmg: 3, cd: 0.16, reach: 232, speed: 700, pierce: 0, kb: 16, spread: 7, kind: 'smg', tints: ['#8d9198', '#5c6067'], icon: 'smg',
    desc: '射速极高，弹幕倾泻。' },

  { id: 'shotgun', name: '霰弹枪', en: 'Shotgun', tier: 3, type: 'ranged', price: 34,
    dmg: 4, cd: 0.92, reach: 176, speed: 560, pierce: 0, kb: 70, shots: 5, spread: 30, kind: 'shotgun', tints: ['#a9743f', '#6f4a26'], icon: 'shotgun',
    desc: '一次五弹，近距离噩梦。' },

  { id: 'sniper', name: '狙击枪', en: 'Sniper', tier: 3, type: 'ranged', price: 36,
    dmg: 22, cd: 1.30, reach: 460, speed: 1250, pierce: 3, kb: 120, kind: 'sniper', tints: ['#6f747c', '#464a51'], icon: 'sniper',
    desc: '超远射程，穿透一整排。' },

  { id: 'laser', name: '激光枪', en: 'Laser Gun', tier: 3, type: 'ranged', price: 38,
    dmg: 9, cd: 0.52, reach: 330, speed: 1500, pierce: 1, kb: 24, kind: 'laser', tints: ['#e2564f', '#9c2f2a'], element: 'laser', icon: 'laser',
    desc: '高速能量束，冷却极短。' },

  { id: 'rocket', name: '火箭筒', en: 'Rocket', tier: 4, type: 'ranged', price: 50,
    dmg: 24, cd: 1.80, reach: 320, speed: 400, pierce: 0, kb: 200, blast: 76, kind: 'rocket', tints: ['#7d8a5a', '#4f5a38'], icon: 'rocket',
    desc: '爆炸溅射，清群效率极高。' },

  { id: 'flame', name: '喷火器', en: 'Flamethrower', tier: 3, type: 'ranged', price: 34,
    dmg: 3, cd: 0.10, reach: 132, speed: 250, pierce: 99, kb: 0, life: 0.42, kind: 'flame', tints: ['#e07a3a', '#a8481f'], element: 'fire', icon: 'flame',
    desc: '持续喷射，短程高温。' },

  { id: 'railgun', name: '磁轨炮', en: 'Railgun', tier: 4, type: 'ranged', price: 52,
    dmg: 18, cd: 1.10, reach: 420, speed: 2200, pierce: 99, kb: 60, kind: 'railgun', tints: ['#5f8fc4', '#37608c'], element: 'laser', icon: 'rail',
    desc: '贯穿全场的一条直线。' },

  { id: 'crossbow', name: '十字弩', en: 'Crossbow', tier: 2, type: 'ranged', price: 22,
    dmg: 11, cd: 0.86, reach: 300, speed: 760, pierce: 1, kb: 90, kind: 'crossbow', tints: ['#a9743f', '#6f4a26'], icon: 'bow',
    desc: '穿透一人的精准木质弩。' },

  { id: 'slingshot', name: '弹弓', en: 'Slingshot', tier: 1, type: 'ranged', price: 10,
    dmg: 7, cd: 0.78, reach: 250, speed: 580, pierce: 0, kb: 55, kind: 'sling', tints: ['#a9743f', '#6f4a26'], icon: 'sling',
    desc: '便宜好用，前期过渡。' },

  /* ================= 工程 / 特殊 ================= */
  { id: 'turretgun', name: '哨戒机枪', en: 'Sentry', tier: 3, type: 'ranged', price: 40,
    dmg: 4, cd: 0.34, reach: 210, speed: 640, pierce: 0, kb: 20, kind: 'sentry', tints: ['#9c9384', '#6a6358'], engineering: true, icon: 'gear',
    desc: '工程学武器，伤害随工程学提升。' },

  { id: 'mutantgun', name: '变异手枪', en: 'Mutant Gun', tier: 3, type: 'ranged', price: 32,
    dmg: 7, cd: 0.44, reach: 250, speed: 700, pierce: 0, kb: 30, shots: 2, spread: 12, kind: 'pistol', tints: ['#8ab84f', '#5a7a2f'], icon: 'gun',
    desc: '双发齐射，弹道略散。' },

  { id: 'minigun', name: '转轮机枪', en: 'Minigun', tier: 4, type: 'ranged', price: 54,
    dmg: 3, cd: 0.09, reach: 250, speed: 780, pierce: 0, kb: 12, spread: 10, kind: 'minigun', tints: ['#a8adb6', '#6f747c'], icon: 'minigun',
    desc: '真正的火力覆盖，弹药如雨。' },

  { id: 'orb', name: '元素法球', en: 'Elemental Orb', tier: 3, type: 'ranged', price: 36,
    dmg: 12, cd: 0.95, reach: 300, speed: 380, pierce: 2, kb: 60, blast: 48, kind: 'orb', tints: ['#8f6fae', '#5d4576'], element: 'magic', icon: 'orb',
    desc: '法球缓慢飞行，命中后小范围爆裂。' },

  { id: 'tentacle', name: '触手', en: 'Tentacle', tier: 2, type: 'melee', price: 26,
    dmg: 7, cd: 0.72, reach: 118, arc: 130, knock: 60, kind: 'tentacle', tints: ['#c96f9a', '#8f4a6e'], icon: 'tentacle',
    desc: '来自身后的诡异挥击，覆盖极广。' }
];

/* 无原型表 —— 与 data_chars / data_items 同一条理由（原型键不该被当成真实武器 id） */
W.BY_ID = Object.create(null);
for (var i = 0; i < W.LIST.length; i++) W.BY_ID[W.LIST[i].id] = W.LIST[i];

/* =========================================================
   品级与合成（档位表在 data_tiers.ts：T1–T5）
   ---------------------------------------------------------
   参考 brotato：**两把同名同品级的武器合成为一把更高品级的同名武器**
   （两把 T1 匕首 → 一把 T2 匕首；顶档是 T5「神话」，要 16 把同名 T1 才够）。原作的两条细节也照搬，
   因为它们各自解决一个真问题：
     ① 身上**还有空武器槽**时不自动合成 —— 直接装上第二把。
        合成是"没地方放了"时的出路，而不是买第二把就必然触发。
        （否则你永远没法在同一局里同时拿两把同型号的枪。）
     ② 合成可以**手动**做，也可以在武器栏里"回收"（低价卖回）。
        手动存在的前提是合成结果可以被规划 —— 所以这里是纯数据函数，没有随机。
   与本作原有设定的一处关键区别（也是它必须存在的理由）：
     `def.tier` 是"这把武器**通常**出现在哪一档"，
     `w.tier`   是"这把武器**现在**是哪一档"。
   两者分开之后，"T4 的匕首"仍然是匕首（造型 / 手感 / 家族 / 弹药类型全不变），
   只是更强 —— 于是合成不需要 92 个"每档一把"的武器条目，也不会把
   武器联动（synergy.ts 按家族算）打散。
   倍率是**台阶**（相对武器自己那一档），不是绝对表：
   绝对表会让 T1 武器升到顶也追不平 T4 武器的底子，台阶则保证
   每一级合成的收益差不多 —— 这正是"要不要花两个格子换一档"这个问题的可作答形式。
   ========================================================= */
/* 品级（档位、名字、颜色类、解锁波次、合成台阶）**只住在 data_tiers.ts**。
   这里不再有 `TIER_MAX = 4` 与第二份台阶表 —— 那曾经是"加一档要改六处"的源头之一。 */
W.TIER_MAX = Tiers.MAX;
W.TIERS = Tiers.LIST;
W.TIER_BY = Tiers.BY;

W.clampTier = function (t) { return Tiers.clamp(t); };

/** 这把武器**当前**的品级（实例字段优先，缺了就用 def 自己的档） */
W.tierOf = function (w) {
  if (!w) return 1;
  var t = Math.floor(Number(w.tier) || 0);
  if (t >= 1) return W.clampTier(t);
  return W.clampTier(w.def ? w.def.tier : 1);
};

/** 相对武器**自己那一档**的倍率：`mul(w,'dmg')` = 当前档 ÷ 出身档 */
W.mulFor = function (def, tier, key) {
  var a = W.TIER_BY[W.clampTier(tier)] || W.TIER_BY[1];
  var b = W.TIER_BY[W.clampTier(def && def.tier ? def.tier : 1)] || W.TIER_BY[1];
  return a[key] / b[key];
};
W.mul = function (w, key) { return W.mulFor(w && w.def, W.tierOf(w), key); };
/* 顶档起给穿透（T4 +1 / T5 +2 —— 逐档的数是品级表里的 `pierce` 列）。
   "打穿一切"的武器（pierce ≥ 5）不吃这一口：给了也只是噪音。 */
W.pierceBonus = function (w) {
  var def = w && w.def;
  if (!def || def.type !== 'ranged') return 0;
  if ((def.pierce || 0) >= 5) return 0;
  return (W.TIER_BY[W.tierOf(w)] || W.TIER_BY[1]).pierce;
};

/** 合成：能不能再往上抬一档 */
W.canCombine = function (w) { return !!w && W.tierOf(w) < W.TIER_MAX; };

/**
 * 在哪一格能找到合成对象（-1 = 没有）。
 * 默认要**同名同档**；`allowDiff`（工坊「异档熔接」）放宽到"同名的任意档"。
 * 放宽时**先找同档的、再退而求其次找最低档的**：把攒出来的 T3 当柴烧是最亏的一手，
 * 不能让"手滑点一下"就发生（这也是为什么它宁可多写十行）。
 */
W.partnerOf = function (list, w, skipIndex, allowDiff) {
  if (!list || !w || !W.canCombine(w)) return -1;
  var t = W.tierOf(w);
  var bestLow = -1, bestLowTier = 99;
  for (var i = 0; i < list.length; i++) {
    if (i === skipIndex) continue;
    var q = list[i];
    if (!q || q.id !== w.id) continue;
    var qt = W.tierOf(q);
    if (qt === t) return i;
    if (allowDiff && W.canCombine(q) && qt < bestLowTier) { bestLow = i; bestLowTier = qt; }
  }
  return allowDiff ? bestLow : -1;
};

/* 价值与回收：一把合成出来的武器，材料价值 = 底价 × 2^抬升档数 ——
   每抬一档都吃掉了两把，所以这是**修复过的**换算，而不是另写一个常数。
   于是"买两把再回收"永远是白干（返还 50% 的那一半），没有套利空间。 */
/** 按 `def + 档位`算价值（**不用先造出实例**）：`salvageOf` 要用它。
    留在模块内而不是挂到 `W` 上：外面只需要"这把武器值多少 / 能回收多少"两个答案，
    中间那两步（按 def 算价值、按比例算回收价）没有必要成为公共 API
    （arch-audit 的 [7] 节就是查这个：挂出去却只在本文件里用的成员）。 */
function valueOfDef(def, tier) {
  if (!def) return 0;
  var t = (tier === undefined || tier === null) ? def.tier : tier;
  var steps = W.clampTier(t) - W.clampTier(def.tier);
  return W.priceOf(def, 0) * Math.pow(2, steps > 0 ? steps : 0);
}
W.valueOf = function (w) {
  if (!w || !w.def) return 0;
  return valueOfDef(w.def, W.tierOf(w));
};
/** 回收比例的**唯一**读法：缺省 = 底价 0.5，封顶 0.9，非有限数退回缺省 */
function clampSalvageRate(rate) {
  var r = (rate === undefined || rate === null) ? W.salvageRate : Number(rate);
  if (!isFinite(r)) r = W.salvageRate;
  return Math.max(0, Math.min(0.9, r));
}
/** 回收价（按 def + 档位算，**不含**"付过多少钱"那道上限） */
function salvageFor(def, tier, rate) {
  return Math.max(1, Math.round(valueOfDef(def, tier) * clampSalvageRate(rate)));
}
/** 回收（低价卖出）返还比例。工坊「废料回收」通过**每一局的 salvageRate** 抬它 */
W.salvageRate = 0.5;

/** 回收价 = 当前价值 × 比例，但**封顶在"你为它付过的钱 − 1"**。
 *
 *  为什么必须有这道封顶（两个洞都是实测出来的，而且都只在"极端加成叠加"时才出现）：
 *    · 折扣（天赋 + 商店房 + 契约，封顶 0.6）与回收比例（工坊回收炉，封顶 0.9）
 *      是两个**互不相干**的封顶：`1.6 × 0.4 × 0.7 = 0.448 < 0.9` ——
 *      折扣叠满时货架上一件都成了净赚（T2 触手 18 买 / 25 拆、T4 转轮机枪 43 买 / 58 拆）；
 *    · 制造那一侧的省料可以叠到 0.40（`1.4 × 0.6 = 0.84 < 0.9`），而**质量触发抬档**
 *      还会把回收价翻倍（价值按结果算）—— 造一件 T1 匕首（8 材料）出精品 T2 就能拆 14。
 *  两条的根都是"回收价没有参照**你付了多少**"。所以参照它：
 *  付过的钱记在实例上（`w.paid`，买 / 造 / 合成都会累加），回收价不许超过它。
 *                                                                        ← 付过 0（捡到 / 开局自带）不受限。
 *  这样定价那一侧一行都不用改：折扣照旧、省料照旧，而"买光拆光"永远净亏 ≥1 材料
 *  （`data_weapons.ts` 里那条"买两把再回收永远是白干"就是这个意思）。
 *  合金仍然由回收产出（那是图纸树唯一的稳定来源），但它现在是**用材料换来的**。
 */
W.salvageOf = function (w, rate?) {
  if (!w || !w.def) return 1;                       // 与改造前一致：认不出的东西给 1
  var v = salvageFor(w.def, W.tierOf(w), rate);
  var paid = Math.floor(Number(w.paid) || 0);
  if (paid > 0 && v > paid - 1) v = paid - 1;       // 净亏至少 1（不然就是白拿材料与合金）
  return Math.max(1, v);
};

/** 价格（受幸运影响） */
W.priceOf = function (def, luck) {
  var base = def.basePrice || def.price || 10;
  var p = base * (1 + (def.tier - 1) * 0.06) * (1 - Math.min(0.30, (luck || 0) * 0.012));
  return Math.max(1, Math.round(p));
};

/** 创建武器实例。`tier` 缺省 = 这把武器的出身档（商店卖出来的就是这一档）；
 *  `paid` = 为它付过多少材料（0 = 捡到 / 开局自带）—— 回收价的上限就是它，见 `salvageOf` */
W.instantiate = function (id, tier?, paid?) {
  var def = W.BY_ID[id];
  if (!def) return null;
  // index / dup 以前是"用到才挂上去"，会让同类型武器形状分叉；现在由
  // WeaponCore（id/def/swing/tier）+ Cooldown（cd）+ Seat（挂点槽位 index）声明，出生即齐全。
  // 挂点坐标（老的 wx/wy/ang）不再存字段：骨架是按需算的，缓存下来只会变成没人读的死状态。
  var t = tier === undefined || tier === null ? def.tier : tier;
  if (t < def.tier) t = def.tier;          // 合成只往上，不许出现"比出身还低"的档
  var p = Math.floor(Number(paid) || 0);
  return Comp.spawn('weapon', { id: def.id, def: def, tier: W.clampTier(t), paid: p > 0 ? p : 0 });
};

/** 生成商店随机武器（按波次解锁层级）
    档位上限来自品级表（`Tiers.capFor`），权重按**池子里真实存在的最高档**算 ——
    见 Tiers.topOf 的注释：按 capFor 算会让"以后加了 T5 存量"把货色分布整体平移。 */
W.rollShop = function (wave, rnd) {
  var maxTier = Tiers.capFor(wave);
  var pool = W.LIST.filter(function (d) { return d.tier <= maxTier; });
  var top = Tiers.topOf(pool, maxTier);
  var entries = pool.map(function (d) {
    var w = d.tier === top ? 1.0 : (top - d.tier === 1 ? 1.5 : 0.9);
    return { w: w, def: d };
  });
  return U.pickWeighted(entries, rnd).def;
};

/* 登记到扩展点总账：每把武器的 kind 必须能画出武器造型，也必须能映射出弹丸造型
   （game.ts 的 bulletKind() 把武器 kind 映射成弹丸 kind —— 漏一个就会静默变成普通弹）。
   顺带把 `tier` 也登记成跨表引用：品级表是**行为表**（合成台阶）而不只是标签，
   写一个表外的档位（比如 tier: 6）会让合成查不到台阶、静默退化成 T1。 */
Registry.family('weapon', {
  note: '武器库（23 把）', owner: 'data_weapons.ts',
  entries: function () {
    return W.LIST.map(function (d) {
      return {
        id: d.id,
        refs: [
          { field: 'kind', value: d.kind, family: 'weaponKind' },
          { field: 'type', value: d.type, family: 'weaponType' },
          { field: 'tier', value: 'T' + d.tier, family: 'tier' },
          /* `element` 也必须落在**元素表**里：写错一个字母的表现是
             "这把武器不再吃元素加成、也永远不会触发附带效果"，而界面上
             它照样写着"元素：fir" —— 三个读点没有一个会报错（见 data_elems.ts）。 */
          { field: 'element', value: d.element, family: 'element' }
        ]
      };
    });
  }
});

/* 把武器表交给词条系统（**单向**：表认识词条，词条不认识表）。
   为什么不用 import：`data_weapons → affixes → data_weapons` 会成环，
   而"每把武器都能滚出词条"这条自检必须拿到表 —— 于是表在末尾主动交一次。
   这一步漏掉的表现是"自检少查一项"（不报错、只是不查），
   所以 test/affixes.mjs 会独立验一次"两张表都交上来了"。 */
Affixes.bindTables('weapon', W.LIST);

export { W as Weapons };
/* 字段 → 家族的声明（守卫读它，见 test/data-contract.mjs）：武器表上每个字符串字段
   的值域都必须有家族守着 —— 写错一个字母的表现是"造型变了 / 不吃元素加成 / 合成查不到台阶"，
   全都不报错。 */
Registry.uses('kind', 'weaponKind');
Registry.uses('type', 'weaponType');
Registry.uses('tier', 'tier');
Registry.uses('element', 'element');
Registry.uses('tags', 'affixTag');