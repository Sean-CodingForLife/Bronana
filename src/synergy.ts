/* =========================================================
   synergy.ts — 武器联动（"组合"这一层）

   为什么需要它：改造前**武器之间没有任何关系** —— 6 把武器就是 6 份独立伤害，
   "拿什么"只影响数值，不影响**构筑**。这是本作战斗层最深的一个缺口：
   参照的两家都把"组合"当成核心玩法之一 ——
     · **Brotato**：同名武器叠到 N 把给套装加成（"6 把刀"是一种身份）
     · **吸血鬼幸存者**：武器 + 道具**进化**成另一把武器（组合本身是目标）

   但直接照抄"同名武器 N 把"在本作**是死的**：22 种造型关键字里只有手枪有 2 把，
   其余每种就 1 把 —— 阈值 ≥2 的轴永远触发不了。所以这里先补一个**声明层**：
   `FAMILIES` 把 kind 归成 5 个家族（刀剑 / 重击 / 射击 / 能量 / 火爆），
   家族才是有足够件数的分组。这样"组合"从数据上就成立，
   而且**以后往某个家族加武器时，联动自动变强**，不用改代码。

   四条轴（全部是"数件数 → 取达到的最高档"的同一套折叠）：
     family  同家族（4~7 把的家族，主力轴）
     type    清一色近战 / 清一色远程（混编 vs 专一）
     element 同元素（火 / 电 / 魔法 / 激光；不带元素的不参与）
     engage  工程系（哨戒机枪那条线）

   纪律：
     · 纯数据 + 纯函数，**没有随机**：同一套武器永远折出同一份加成
     · 没达到最低档 → 返回**恒等**（空 stats），这是行为指纹不受影响的前提
     · 文案与说明都写在表里（界面不列键名，与据点/营地同一套做法）
   ========================================================= */

import { SelfCheck } from './selfcheck.ts';
import { Registry } from './registry.ts';
import { Stats } from './stats.ts';
import { Weapons } from './data_weapons.ts';
import { Items } from './data_items.ts';

var Synergy = {} as SynergyApi;

/* =========================================================
   1. 家族表（kind → 家族）
   ---------------------------------------------------------
   为什么要有这一层：`kind` 是**造型关键字**（22 种，为了画得不一样），
   不是玩法分组。拿它当"同类"用，每种就只有 1 把 —— 组合玩法根本触发不了。
   家族是玩法概念，所以单独声明一次，**每个 kind 必须归属且只归属一个家族**
   （自检守着：漏一个就是"这把武器不参与任何联动"，玩家看不出来）。
   ========================================================= */
var FAMILIES: SynergyFamilyDef[] = [
  {
    id: 'blade', name: '刀剑', note: '轻快、连击 —— 靠攻速叠',
    kinds: ['knife', 'sword', 'spear', 'axe']
  },
  {
    id: 'heavy', name: '重击', note: '慢、重、高单发',
    kinds: ['hammer', 'plasma', 'tentacle']
  },
  {
    id: 'gun', name: '射击', note: '远程火力线（本作件数最多的家族）',
    kinds: ['pistol', 'smg', 'shotgun', 'sniper', 'minigun', 'sentry']
  },
  {
    id: 'energy', name: '能量', note: '激光 / 磁轨 / 法球 —— 靠暴击与元素',
    kinds: ['laser', 'railgun', 'orb', 'taser']
  },
  {
    id: 'blast', name: '火爆', note: '灼烧与爆炸',
    kinds: ['torch', 'flame', 'rocket', 'sling', 'crossbow']
  }
];

var KIND_TO_FAMILY: Record<string, string> = Object.create(null);
for (var fi = 0; fi < FAMILIES.length; fi++) {
  for (var ki = 0; ki < FAMILIES[fi].kinds.length; ki++) {
    KIND_TO_FAMILY[FAMILIES[fi].kinds[ki]] = FAMILIES[fi].id;
  }
}

/* =========================================================
   2. 四条轴
   ---------------------------------------------------------
   每一档写的是**这一档给什么**（增量），而且**只取达到的最高一档**（不叠档）。
   为什么只取最高档（Brotato 也是这个做法）：叠档会让 6 把同族变成
   "1+2+3 档全拿"，加成爆炸；只取最高档，件数是**阶梯**而不是**复利**。
   `group` 决定按什么分组（fold 里只有一个 switch，是唯一"按组取值"的地方）。
   ========================================================= */
function tier(at, title, text, stats, econ?) {
  return { at: at, title: title, text: text, stats: stats, econ: econ || null };
}

var AXES: SynergyAxisDef[] = [
  {
    id: 'family', name: '同家族', group: 'family',
    note: '主力轴：同一个家族的武器拿到 N 把。' +
      '档位是按**真实容量**定的（家族最多 7 把、武器位 6 个）—— ' +
      '第一版把最高档写成 6，而刀剑/重击/能量分别只有 4/3/4 把，那两档永远达不到',
    tiers: [
      tier(2, '成对', '攻速 +6%', { attackSpeed: 0.06 }),
      tier(3, '成套', '攻速 +10%、伤害 +5%', { attackSpeed: 0.10, damage: 0.05 }),
      tier(4, '成军', '攻速 +15%、伤害 +12%', { attackSpeed: 0.15, damage: 0.12 })
    ]
  },
  {
    id: 'type', name: '同系', group: 'type',
    note: '清一色近战或清一色远程 —— 于是"混编"与"专一"是两条路（近战 9 / 远程 14 把）',
    tiers: [
      tier(4, '成阵', '伤害 +5%', { damage: 0.05 }),
      tier(6, '一统', '伤害 +12%', { damage: 0.12 })
    ]
  },
  {
    id: 'element', name: '同元素', group: 'element',
    note: '火 / 电 / 魔法 / 激光各算一系；不带元素的武器不参与。' +
      '只有一档：元素武器本来就少（每种 1~2 把），档位定高了就是空头支票',
    tiers: [
      tier(2, '共鸣', '元素伤害 +4、暴击 +3%', { elementalDmg: 4, critChance: 0.03 })
    ]
  }
  /* 曾经还有一条"工程"轴（工程系武器 ≥2 → 工程学 +5），
     但全游戏只有 1 把工程武器（哨戒机枪），**这条轴永远触发不了** ——
     自检直接报了出来。等工程系有第二把武器再加回来，而不是留一条死轴。 */
];

/* =========================================================
   3. 折叠（纯函数）
   ========================================================= */
/** 一把武器落在某个分组里的键；`null` = 不参与这条轴 */
function groupKey(group, def) {
  if (!def) return null;
  if (group === 'family') return KIND_TO_FAMILY[def.kind] || null;
  if (group === 'type') return def.type || null;
  if (group === 'element') return def.element || null;
  return null;
}

/**
 * 把一套武器折成联动加成。
 * @param defs 武器定义数组（`w.def`；顺序无关）
 * @returns { stats, active, near } —— `stats` 是**增量**，没触发任何档时是空对象（恒等）
 */
Synergy.of = function (defs) {
  var out: SynergyFold = { stats: {}, active: [], near: null };
  var list = defs || [];
  if (!list.length) return out;

  for (var a = 0; a < AXES.length; a++) {
    var axis = AXES[a];
    // 按分组值数件数
    var counts: Record<string, number> = Object.create(null);
    for (var i = 0; i < list.length; i++) {
      var g = groupKey(axis.group, list[i]);
      if (g === null) continue;
      counts[g] = (counts[g] || 0) + 1;
    }
    // 每个分组值各自取"达到的最高一档"
    for (var val in counts) {
      if (!Object.prototype.hasOwnProperty.call(counts, val)) continue;
      var n = counts[val];
      var reached = null;
      for (var t = 0; t < axis.tiers.length; t++) {
        if (n >= axis.tiers[t].at) reached = axis.tiers[t];
      }
      if (reached) {
        for (var k in reached.stats) {
          if (!Object.prototype.hasOwnProperty.call(reached.stats, k)) continue;
          out.stats[k] = (out.stats[k] || 0) + reached.stats[k];
        }
        out.active.push({ axis: axis.id, axisName: axis.name, value: val, count: n, tier: reached });
      } else {
        // 没到第一档：记住"最接近的那条"，界面用来提示"再拿一件就能联动"
        var need = axis.tiers[0].at - n;
        if (!out.near || need < out.near.need) {
          out.near = {
            axis: axis.id, axisName: axis.name, value: val, count: n,
            need: need, next: axis.tiers[0]
          };
        }
      }
    }
  }
  // 顺序稳定（同一套武器永远同样的顺序）—— 按轴表顺序 + 值字典序
  out.active.sort(function (x, y) {
    var ax = 0, ay = 0;
    for (var i2 = 0; i2 < AXES.length; i2++) {
      if (AXES[i2].id === x.axis) ax = i2;
      if (AXES[i2].id === y.axis) ay = i2;
    }
    return ax - ay || String(x.value).localeCompare(String(y.value));
  });
  return out;
};

/** 家族名（界面用；未知就给原值，不抛） */
Synergy.familyName = function (id) { return Synergy.FAMILY_BY_ID[id] ? Synergy.FAMILY_BY_ID[id].name : id; };

/** 分组值的可读名（家族要翻名字；type/element 直接给值） */
Synergy.valueName = function (axisId, value) {
  return axisId === 'family' ? Synergy.familyName(value) : value;
};

/**
 * 四条轴**各自的进度**（界面用它把"离下一档还差几件"画出来）。
 * 与 `of()` 共用同一份分组逻辑与同一张档位表 —— 不允许界面自己再算一遍。
 * @returns 每条命中的分组一行：{ axis, axisName, value, count, tier, next, need }
 *          `tier` 是已达成的最高档（没达成是 null），`next` 是下一档（没有了是 null）
 */
Synergy.progress = function (defs) {
  var rows: SynergyRow[] = [];
  var list = defs || [];
  for (var a = 0; a < AXES.length; a++) {
    var axis = AXES[a];
    var counts: Record<string, number> = Object.create(null);
    var order: string[] = [];
    for (var i = 0; i < list.length; i++) {
      var g = groupKey(axis.group, list[i]);
      if (g === null) continue;
      if (!counts[g]) order.push(g);
      counts[g] = (counts[g] || 0) + 1;
    }
    order.sort();
    for (var o = 0; o < order.length; o++) {
      var val = order[o], n = counts[val];
      var reached: SynergyTierDef | null = null, next: SynergyTierDef | null = null;
      for (var t = 0; t < axis.tiers.length; t++) {
        if (n >= axis.tiers[t].at) reached = axis.tiers[t];
        else if (!next) next = axis.tiers[t];
      }
      rows.push({
        axis: axis.id, axisName: axis.name, value: val, valueName: Synergy.valueName(axis.id, val),
        count: n, tier: reached, next: next, need: next ? next.at - n : 0
      });
    }
  }
  return rows;
};

Synergy.FAMILIES = FAMILIES;
Synergy.KIND_TO_FAMILY = KIND_TO_FAMILY;
Synergy.AXES = AXES;
Synergy.FAMILY_BY_ID = (function () {
  var m: Record<string, SynergyFamilyDef> = Object.create(null);
  for (var i = 0; i < FAMILIES.length; i++) m[FAMILIES[i].id] = FAMILIES[i];
  return m;
})();

/* =========================================================
   3b. 道具套装（F 的后半："武器同类联动 + 道具套装"）
   ---------------------------------------------------------
   为什么道具也要有这一层：道具是**可以无限叠**的（见 containers 的说明），
   所以"多买一件"永远只是数值 +N，没有"攒出个什么"的感觉。
   套装把若干件**同主题**的道具绑在一起：持有件数到档就给一份别的给不了的加成。

   与武器那四条轴的区别（也是为什么它单独写一张表）：
     · 武器按 kind/type/element **自动分组**（一把武器天生属于某个家族）
     · 道具没有"天生"的分类 —— 一件道具属于哪一套是**设计决定**，所以必须显式声明
   守卫：每件道具必须归属且只归属一套（漏一件 = 那件不参与任何套装，玩家看不出来），
   而且每套的成员数必须够到它的最高档（否则那一档是空头支票）。
   ========================================================= */
var ITEM_SETS: SynergyItemSetDef[] = [
  {
    id: 'scrap', name: '拾荒', note: '靠捡、靠运气、靠材料滚雪球',
    items: ['clover', 'magnet', 'sneaker', 'beret', 'treadmill', 'charcoal', 'duplicator', 'rations', 'warpipe'],
    tiers: [
      tier(2, '顺手', '拾取范围 +10、幸运 +3', { pickupRange: 10, luck: 3 }),
      tier(3, '惯犯', '收获 +10、幸运 +6', { harvesting: 10, luck: 6 }),
      tier(4, '老手', '收获 +22、每波材料 +8（写进 econ，与天赋同一条路）',
        { harvesting: 22 }, { waveIncome: 8 })
    ]
  },
  {
    id: 'plating', name: '装甲', note: '厚起来：护甲与生命，代价是慢',
    items: ['helmet', 'snack', 'cloak', 'cloak2', 'charm', 'exo'],
    tiers: [
      tier(2, '披挂', '护甲 +2、生命上限 +4', { armor: 2, maxHp: 4 }),
      tier(3, '全甲', '护甲 +5、生命上限 +10、移速 −4%', { armor: 5, maxHp: 10, speed: -0.04 }),
      tier(4, '铁壳', '护甲 +10、生命上限 +20，但移速 −10%', { armor: 10, maxHp: 20, speed: -0.10 })
    ]
  },
  {
    id: 'stim', name: '兴奋剂', note: '快、疼、回得快 —— 拿命换输出',
    items: ['coffee', 'coffee2', 'medicine', 'nano', 'berserk', 'tattoo'],
    tiers: [
      tier(2, '上头', '攻速 +6%、生命回复 +0.5', { attackSpeed: 0.06, hpRegen: 0.5 }),
      tier(3, '过载', '攻速 +12%、伤害 +5%、生命回复 +1', { attackSpeed: 0.12, damage: 0.05, hpRegen: 1 }),
      tier(4, '烧穿', '攻速 +20%、伤害 +12%、生命窃取 +4%，但护甲 −2',
        { attackSpeed: 0.20, damage: 0.12, lifesteal: 0.04, armor: -2 })
    ]
  },
  {
    id: 'toolkit', name: '工具', note: '工程与精度：数字不大，但对特定 build 是质变',
    items: ['whetstone', 'scopeitem', 'glove', 'lens', 'scanner', 'goggles', 'ripper', 'bionic', 'amulet', 'turretitem'],
    tiers: [
      tier(2, '两件', '伤害 +4%', { damage: 0.04 }),
      tier(4, '工具箱', '伤害 +10%、暴击 +4%、工程学 +6', { damage: 0.10, critChance: 0.04, engineering: 6 }),
      tier(6, '整备间', '伤害 +20%、暴击 +8%、工程学 +14', { damage: 0.20, critChance: 0.08, engineering: 14 })
    ]
  }
];

var ITEM_TO_SET: Record<string, string> = Object.create(null);
for (var si = 0; si < ITEM_SETS.length; si++) {
  for (var ii = 0; ii < ITEM_SETS[si].items.length; ii++) ITEM_TO_SET[ITEM_SETS[si].items[ii]] = ITEM_SETS[si].id;
}

/**
 * 把一套**道具**折成套装加成。
 * 与 `of()` 同构：数件数 → 每一套取达到的最高档 → 增量相加；没到档就是空对象（恒等）。
 * @param defs 道具定义数组（`it.def`；顺序无关）
 */
Synergy.ofItems = function (defs) {
  var out: SynergyFold = { stats: {}, active: [], near: null };
  var list = defs || [];
  if (!list.length) return out;
  var counts: Record<string, number> = Object.create(null);
  for (var i = 0; i < list.length; i++) {
    var sid = ITEM_TO_SET[list[i] && list[i].id];
    if (!sid) continue;
    counts[sid] = (counts[sid] || 0) + 1;
  }
  for (var s = 0; s < ITEM_SETS.length; s++) {
    var set = ITEM_SETS[s];
    var n = counts[set.id] || 0;
    if (!n) continue;
    var reached: SynergyTierDef | null = null;
    for (var t = 0; t < set.tiers.length; t++) if (n >= set.tiers[t].at) reached = set.tiers[t];
    if (!reached) {
      var need = set.tiers[0].at - n;
      if (!out.near || need < out.near.need) {
        out.near = { axis: 'itemset', axisName: set.name, value: set.id, count: n, need: need, next: set.tiers[0] };
      }
      continue;
    }
    for (var k in reached.stats) {
      if (!Object.prototype.hasOwnProperty.call(reached.stats, k)) continue;
      out.stats[k] = (out.stats[k] || 0) + reached.stats[k];
    }
    // econ 那一小撮（每波材料）单独收着：它不是属性，走的是天赋 econ 那条路
    if (reached.econ) {
      out.econ = out.econ || {};
      for (var ek in reached.econ) {
        if (!Object.prototype.hasOwnProperty.call(reached.econ, ek)) continue;
        out.econ[ek] = (out.econ[ek] || 0) + reached.econ[ek];
      }
    }
    out.active.push({ axis: 'itemset', axisName: set.name, value: set.id, count: n, tier: reached });
  }
  return out;
};

/** 每一套的进度（界面用：离下一档还差几件） */
Synergy.setProgress = function (defs) {
  var rows: SynergyRow[] = [];
  var list = defs || [];
  var counts: Record<string, number> = Object.create(null);
  for (var i = 0; i < list.length; i++) {
    var sid = ITEM_TO_SET[list[i] && list[i].id];
    if (sid) counts[sid] = (counts[sid] || 0) + 1;
  }
  // 件数为 0 的套装也列出来（否则玩家不知道有这几套）
  for (var s = 0; s < ITEM_SETS.length; s++) {
    var set = ITEM_SETS[s];
    var n = counts[set.id] || 0;
    var reached: SynergyTierDef | null = null, next: SynergyTierDef | null = null;
    for (var t = 0; t < set.tiers.length; t++) {
      if (n >= set.tiers[t].at) reached = set.tiers[t];
      else if (!next) next = set.tiers[t];
    }
    rows.push({
      axis: 'itemset', axisName: set.name, value: set.id, valueName: set.name,
      count: n, tier: reached, next: next, need: next ? next.at - n : 0
    });
  }
  return rows;
};
Synergy.ITEM_SETS = ITEM_SETS;
Synergy.setName = function (id) {
  for (var i = 0; i < ITEM_SETS.length; i++) if (ITEM_SETS[i].id === id) return ITEM_SETS[i].name;
  return id;
};

/* =========================================================
   4. 自检
   ========================================================= */
Synergy.audit = function () {
  var problems = [];
  var i, k;
  // 家族：id 唯一、非空、kind 不重复归属
  var famIds: Record<string, boolean> = Object.create(null);
  var kindOwner: Record<string, string> = Object.create(null);
  for (i = 0; i < FAMILIES.length; i++) {
    var f = FAMILIES[i];
    if (famIds[f.id]) problems.push('家族 id 重复：' + f.id);
    famIds[f.id] = true;
    if (!f.name || !f.note) problems.push(f.id + ' 缺名字或说明');
    if (!f.kinds || !f.kinds.length) problems.push(f.id + ' 没有任何 kind');
    for (k = 0; k < (f.kinds || []).length; k++) {
      if (kindOwner[f.kinds[k]]) problems.push('kind ' + f.kinds[k] + ' 同时属于两个家族');
      kindOwner[f.kinds[k]] = f.id;
    }
  }
  if (FAMILIES.length < 3) problems.push('家族太少（' + FAMILIES.length + '）：组合玩法立不住');
  // **每个 kind 都必须有家族** —— 漏一个就是"这把武器不参与任何联动"
  var orphan = [];
  for (i = 0; i < Weapons.LIST.length; i++) {
    var kd2 = Weapons.LIST[i].kind;
    if (!KIND_TO_FAMILY[kd2]) orphan.push(Weapons.LIST[i].id + '(' + kd2 + ')');
  }
  if (orphan.length) problems.push('这些武器没有家族（不参与联动）：' + orphan.join(','));
  // 每个家族至少 2 把武器（否则它的"成对"档永远达不到）
  for (var fid in famIds) {
    if (!Object.prototype.hasOwnProperty.call(famIds, fid)) continue;
    var n = Weapons.LIST.filter(function (d) { return KIND_TO_FAMILY[d.kind] === fid; }).length;
    if (n < 2) problems.push('家族 ' + fid + ' 只有 ' + n + ' 把武器 —— "成对"档永远达不到');
  }
  // 轴：id 唯一、档次递增、属性键真实、文案齐全
  var axisIds: Record<string, boolean> = Object.create(null);
  for (i = 0; i < AXES.length; i++) {
    var ax = AXES[i];
    if (axisIds[ax.id]) problems.push('轴 id 重复：' + ax.id);
    axisIds[ax.id] = true;
    if (!ax.name || !ax.note) problems.push(ax.id + ' 缺名字或说明');
    if (['family', 'type', 'element'].indexOf(ax.group) < 0) {
      problems.push(ax.id + ' 用了未知的分组方式：' + ax.group);
    }
    if (!ax.tiers || !ax.tiers.length) { problems.push(ax.id + ' 没有分档'); continue; }
    var last = 0;
    for (var t = 0; t < ax.tiers.length; t++) {
      var tt = ax.tiers[t];
      if (!(tt.at > last)) problems.push(ax.id + ' 的档位没有递增（' + tt.at + '）');
      last = tt.at;
      if (!tt.title || !tt.text) problems.push(ax.id + ' 第 ' + (t + 1) + ' 档缺标题或文案');
      if (!tt.stats || !Object.keys(tt.stats).length) problems.push(ax.id + ' 第 ' + (t + 1) + ' 档没有任何效果');
      for (var sk in (tt.stats || {})) {
        if (!Object.prototype.hasOwnProperty.call(tt.stats, sk)) continue;
        if (Stats.KEYS.indexOf(sk as StatKey) < 0) problems.push(ax.id + ' 用了不存在的属性：' + sk);
      }
    }
    // 轴必须**够得着**：最高档不能超过游戏里能同时带的上限（武器位 6）
    var maxAt = ax.tiers[ax.tiers.length - 1].at;
    if (maxAt > 6) {
      problems.push(ax.id + ' 最高档要 ' + maxAt + ' 件，但武器上限是 6 —— 这一档永远达不到');
    }
  }
  // 道具套装：id 唯一、成员不重复归属、每件道具都有归属、件数够到最高档
  var setIds: Record<string, boolean> = Object.create(null);
  var itemOwner: Record<string, string> = Object.create(null);
  for (i = 0; i < ITEM_SETS.length; i++) {
    var set = ITEM_SETS[i];
    if (setIds[set.id]) problems.push('道具套装 id 重复：' + set.id);
    setIds[set.id] = true;
    if (!set.name || !set.note) problems.push(set.id + ' 缺名字或说明');
    if (!set.items || !set.items.length) problems.push(set.id + ' 没有任何成员');
    for (k = 0; k < (set.items || []).length; k++) {
      if (itemOwner[set.items[k]]) {
        problems.push('道具 ' + set.items[k] + ' 同时属于两套（' + itemOwner[set.items[k]] + ' / ' + set.id + '）');
      }
      itemOwner[set.items[k]] = set.id;
    }
    if (!set.tiers || !set.tiers.length) { problems.push(set.id + ' 没有分档'); continue; }
    var last2 = 0;
    for (var t2 = 0; t2 < set.tiers.length; t2++) {
      var st = set.tiers[t2];
      if (!(st.at > last2)) problems.push(set.id + ' 的档位没有递增（' + st.at + '）');
      last2 = st.at;
      if (!st.title || !st.text) problems.push(set.id + ' 第 ' + (t2 + 1) + ' 档缺标题或文案');
      if ((!st.stats || !Object.keys(st.stats).length) && !st.econ) {
        problems.push(set.id + ' 第 ' + (t2 + 1) + ' 档没有任何效果');
      }
      for (var sk2 in (st.stats || {})) {
        if (!Object.prototype.hasOwnProperty.call(st.stats, sk2)) continue;
        if (Stats.KEYS.indexOf(sk2 as StatKey) < 0) problems.push(set.id + ' 用了不存在的属性：' + sk2);
      }
    }
    var maxSet = set.tiers[set.tiers.length - 1].at;
    if ((set.items || []).length < maxSet) {
      problems.push(set.id + ' 只有 ' + (set.items || []).length + ' 件，但最高档要 ' + maxSet + ' 件 —— 永远达不到');
    }
  }
  if (ITEM_SETS.length < 3) problems.push('道具套装太少（' + ITEM_SETS.length + '）');
  // **每件道具都必须有套装**（漏一件 = 那件不参与套装，玩家看不出来）
  var iOrphan = [];
  for (i = 0; i < Items.LIST.length; i++) {
    if (!ITEM_TO_SET[Items.LIST[i].id]) iOrphan.push(Items.LIST[i].id);
  }
  if (iOrphan.length) problems.push('这些道具没有套装：' + iOrphan.join(','));
  return {
    ok: problems.length === 0, problems: problems,
    counts: {
      families: FAMILIES.length, axes: AXES.length, weapons: Weapons.LIST.length,
      itemSets: ITEM_SETS.length, items: Items.LIST.length, orphans: orphan.length
    }
  };
};

SelfCheck.register('Synergy', Synergy.audit);

/* =========================================================
   5. 登记进扩展点总账
   ========================================================= */
Registry.family('weaponFamily', {
  note: '武器家族（联动用的玩法分组；每个 kind 必须归属一个）', owner: 'synergy.ts',
  entries: function () {
    return FAMILIES.map(function (f) {
      return {
        id: f.id,
        refs: f.kinds.map(function (kind, i) {
          return { field: 'kinds[' + i + ']', value: kind, family: 'weaponKind' };
        })
      };
    });
  }
});
Registry.family('synergyAxis', {
  note: '联动轴（同家族 / 同系 / 同元素 / 工程）', owner: 'synergy.ts',
  values: function () { return AXES.map(function (a) { return a.id; }); }
});
Registry.family('itemSet', {
  note: '道具套装（每件道具必须归属且只归属一套）', owner: 'synergy.ts',
  entries: function () {
    return ITEM_SETS.map(function (s) {
      return {
        id: s.id,
        refs: s.items.map(function (id, i) {
          return { field: 'items[' + i + ']', value: id, family: 'item' };
        })
      };
    });
  }
});

/* 字段 → 家族的声明（守卫读它，见 test/data-contract.mjs）。 */
Registry.uses('kinds', 'weaponKind');
Registry.uses('items', 'item');

export { Synergy };
