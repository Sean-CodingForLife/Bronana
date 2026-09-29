/* =========================================================
   talents.ts — 角色天赋树（多级永久养成，**只改开局条件**）

   形状取自 Path of Exile 的天赋树（那页我读了全文）：
     · **共享大图 + 各自起点** —— 一张表所有角色共用，但每个角色在自己那一扇区
     投入是基准价，跨扇区要 **+1 费**。这就是"起点不同"的等价物：
     不需要真的画一张图去寻路，效果一样是"你的天赋点花在自己家门口最值"。
     · **节点分四级**：微点（纯属性）→ 显著点（强化本职机制）→
       **精通**（同类簇选一个，且**同类在全树只能选一次**）→
       **基石**（改变运作方式，收益与代价并存）。
     · 另外一层：每个角色有**两节点本职子树**（对应 Ascendancy），给角色身份。

   一条硬约束（这一轮的验收就是它）：
     **天赋只能改"开局条件"** —— 起始属性 / 起始武器与道具 / 起始材料。
     它绝对不碰模拟层的规则：不改进攻曲线、不改收益递减、不改刷怪逻辑。
     实现上由 `openingFor()` 产出一个纯数据对象，交给 `Game.newRun` 在**建会话时**
     一次性应用；模拟层从头到尾不认识"天赋"这个词。
   ========================================================= */

import { SelfCheck } from './selfcheck.ts';
import { Chars } from './data_chars.ts';
import { Registry } from './registry.ts';
import { Stats } from './stats.ts';

var Talent = {} as TalentApi;

/* =========================================================
   1. 节点类型（四级）
   ========================================================= */
var TYPES: Record<string, TalentTypeDef> = {
  minor: { label: '微点', cost: 1, note: '单条小属性。树的主体，用来铺路' },
  notable: { label: '显著点', cost: 2, note: '强化某种打法或该角色的本职机制' },
  mastery: { label: '精通', cost: 2, note: '同类簇里选一个，且【同类在全树只能选一次】（互斥才构成选择）' },
  // 基石：PoE 里"显著改变角色运作方式"，通常代价与收益并存
  keystone: { label: '基石', cost: 3, note: '改变运作方式，收益与代价并存。【同一时刻只能带一个基石】' }
};

/* =========================================================
   2. 扇区（共享大图的四块）
   ========================================================= */
var SECTORS: Record<string, { name: string; note: string }> = {
  melee: { name: '近战', note: '贴脸、护甲、生命' },
  ranged: { name: '远程', note: '射程、攻速、机动' },
  engineering: { name: '工程', note: '炮塔、工程学、收获' },
  elemental: { name: '元素', note: '元素伤害、暴击、吸血' },
  // 第五块扇区：**经营**。它是"三角"里养成→经营那一条边的实现 ——
  // 参照 Dead Cells 的 Collector：那棵局外树里除了多一瓶血，还摆着
  // Gold Reserves（死后保金币）/ Recycling（道具换钱）/ Restock（刷新商店），
  // 也就是**玩家在同一笔点数上权衡"战力"与"赚钱能力"**。
  // 本作的对应物：折扣、收获、幸运、孢子产出 —— 全是"换钱效率"而不是战力。
  economy: { name: '经营', note: '折扣、收获、孢子 —— 换钱的效率（不是战力）' }
};

/** 角色 → 本命扇区。均衡豆豆刻意**没有**本命扇区（万物皆跨扇区，也万物皆不额外贵） */
var AFFINITY: Record<string, string> = {
  ranger: '',
  brawler: 'melee',
  masochist: 'melee',
  gladiator: 'melee',
  mole: 'melee',          // 隐藏角色：破墙的那把锤子是重击家族 → 近战本命
  mage: 'elemental',
  engineer: 'engineering',
  collector: 'ranged',
  sprinter: 'ranged'
};

/* =========================================================
   3b. 经济修正的键（**唯一声明**）
   ---------------------------------------------------------
   键名与据点（stronghold.ts 的 MOD_KEYS）和营地（camp.ts 的 EFFECT_KEYS）
   **完全一致**：同一份词汇，三个来源（难度 / 据点 / 天赋）在同一个读点上相加。
   没有改名层，所以 test/talents.mjs 可以直接断言
   "每个声明的键都在 game.ts 里被读到"。
   分工也写在这里：**据点给"槽位与功能"，天赋给"折扣与倍率"** ——
   两边都做同一件事会让两条线互相贬值。
   ========================================================= */
var ECON_KEYS: Record<string, string> = {
  shopDiscount: '商店售价折扣（market.shopRoll / packPrice）—— 工坊已不再给折扣，折扣只剩天赋这一条',
  campDiscount: '工坊建造折扣（market.campOpts）',
  rerollDiscount: '刷新折扣（market.shopRoll）',
  sporeMul: '孢子产出倍率（profile.ts applyRun）—— 据点那一份已删，现在只有天赋与"打得深"',
  // 这一条是**整条边能不能成立的关键**，所以把原因写在这里：
  // 本作的材料几乎全部来自击杀，于是"更能打"本身就是最好的经济 ——
  // 只做折扣与收获倍率的话，经济流永远被战力流支配（实测：5 点战力 8.2 波，
  // 5 点经济 5.4 波，而且战力流的材料还更多，因为杀得多）。
  // Brotato 的 Harvesting 是**每波结算**的，与击杀脱钩 —— 照抄这一点，
  // 经济流才有"我不需要杀得多也能攒钱"的立足点。
  waveIncome: '每波开始到账的材料（game.ts startWave；与击杀脱钩的固定产出）'
};
/** 折出来的默认值（全 0 = 恒等，这是行为指纹不受影响的前提） */
var ECON_DEFAULTS: OpeningEcon = { shopDiscount: 0, campDiscount: 0, rerollDiscount: 0, sporeMul: 0, waveIncome: 0 };
/** 折扣类与倍率类的上限（与据点/营地同一套：折扣 ≤0.6）；
    每波材料上限按"基准每波收入约 40"定成 60 —— 到此为止，再多就把局内经济打穿了；
    孢子倍率的上限 = 两个孢子节点叠满（商人 +25% + 商会 +60% = +85%），
    再与据点的 +50% 相加后在 profile.ts 里统一封顶（Profile.SPORE_MUL_CAP）。 */
var ECON_CAP: Record<string, number> = { shopDiscount: 0.6, campDiscount: 0.6, rerollDiscount: 0.6, sporeMul: 0.85, waveIncome: 60 };

/* =========================================================
   3c. 节点表
   ---------------------------------------------------------
   effects 的四种形态（**都是开局条件**）：
     stats     : 起始属性增量（与角色固有属性同一套单位：pct 类用小数）
     weapons   : 开局额外携带的武器 id
     items     : 开局额外携带的道具 id
     scrap : 开局废料
     econ      : 经济修正（键见 ECON_KEYS；唯一作用于局外的效果是 sporeMul）
   ========================================================= */
function n(id, sector, type, name, desc, effects, mastery?) {
  return { id: id, sector: sector, type: type, name: name, desc: desc, effects: effects, mastery: mastery || null };
}

/** 共享大图：四个扇区，每区 6 个节点 */
var SHARED = [
  /* ---- 近战 ---- */
  n('m1', 'melee', 'minor', '厚皮', '最大生命 +5', { stats: { maxHp: 5 } }),
  n('m2', 'melee', 'minor', '铁甲', '护甲 +2', { stats: { armor: 2 } }),
  n('m3', 'melee', 'notable', '重击', '近战伤害 +5、击退 +15%', { stats: { meleeDmg: 5, knockbackBonus: 0.15 } }),
  n('m4', 'melee', 'mastery', '近战精通', '近战伤害 +7，但远程伤害 −3', { stats: { meleeDmg: 7, rangedDmg: -3 } }, 'offense'),
  n('m5', 'melee', 'keystone', '狂徒', '生命上限 −4，伤害 +25%、攻速 +10%', { stats: { maxHp: -4, damage: 0.25, attackSpeed: 0.10 } }),
  n('m6', 'melee', 'minor', '活血', '生命回复 +1', { stats: { hpRegen: 1 } }),

  /* ---- 远程 ---- */
  n('r1', 'ranged', 'minor', '长臂', '攻击范围 +8%', { stats: { range: 0.08 } }),
  n('r2', 'ranged', 'minor', '轻装', '移动速度 +4%', { stats: { speed: 0.04 } }),
  n('r3', 'ranged', 'notable', '速射', '攻速 +12%、远程伤害 +3', { stats: { attackSpeed: 0.12, rangedDmg: 3 } }),
  n('r4', 'ranged', 'mastery', '远程精通', '远程伤害 +7，但近战伤害 −3', { stats: { rangedDmg: 7, meleeDmg: -3 } }, 'offense'),
  n('r5', 'ranged', 'keystone', '风筝', '移速 +18%、闪避 +8%，但生命上限 −5', { stats: { speed: 0.18, dodge: 0.08, maxHp: -5 } }),
  n('r6', 'ranged', 'minor', '拾荒', '拾取范围 +8', { stats: { pickupRange: 8 } }),

  /* ---- 工程 ---- */
  n('e1', 'engineering', 'minor', '扳手', '工程学 +4', { stats: { engineering: 4 } }),
  n('e2', 'engineering', 'minor', '仓储', '开局多带 30 废料', { scrap: 30 }),
  n('e3', 'engineering', 'notable', '流水线', '工程学 +5、收获 +6', { stats: { engineering: 5, harvesting: 6 } }),
  n('e4', 'engineering', 'mastery', '经济精通', '收获 +14，但最大生命 −3', { stats: { harvesting: 14, maxHp: -3 } }, 'economy'),
  n('e5', 'engineering', 'keystone', '工坊', '开局额外携带一座便携炮塔，但攻速 −8%', { stats: { attackSpeed: -0.08 }, items: ['turretitem'] }),
  n('e6', 'engineering', 'minor', '备用零件', '开局多带 1 件随机道具包的量（废料 +20）', { scrap: 20 }),

  /* ---- 元素 ---- */
  n('x1', 'elemental', 'minor', '余烬', '元素伤害 +4', { stats: { elementalDmg: 4 } }),
  n('x2', 'elemental', 'minor', '锐利', '暴击率 +5%', { stats: { critChance: 0.05 } }),
  n('x3', 'elemental', 'notable', '秘能', '元素伤害 +4、攻速 +8%', { stats: { elementalDmg: 4, attackSpeed: 0.08 } }),
  n('x4', 'elemental', 'mastery', '吸血精通', '生命窃取 +6%，但护甲 −2', { stats: { lifesteal: 0.06, armor: -2 } }, 'sustain'),
  n('x5', 'elemental', 'keystone', '献祭', '生命上限 −6，元素伤害 +12、暴击率 +12%', { stats: { maxHp: -6, elementalDmg: 12, critChance: 0.12 } }),
  n('x6', 'elemental', 'minor', '余温', '生命回复 +1、护甲 +1', { stats: { hpRegen: 1, armor: 1 } }),

  /* ---- 经营（第五块扇区：养成 → 经营那一条边） ----
     这一区的节点**刻意不直接加战力**，代价大多是生命/伤害 ——
     选了它就是在"这局更能打"和"长期更富"之间做取舍。
     `waveIncome` 是主力：它和击杀脱钩，所以"打不动但会攒钱"是一条真实的路。 */
  n('g1', 'economy', 'minor', '集市', '收获 +6、每波 +8 材料', { stats: { harvesting: 6 }, econ: { waveIncome: 8 } }),
  n('g2', 'economy', 'minor', '眼力', '幸运 +6、每波 +8 材料', { stats: { luck: 6 }, econ: { waveIncome: 8 } }),
  n('g3', 'economy', 'notable', '议价', '商店折扣 +8%、刷新折扣 +12%、每波 +16 材料',
    { econ: { shopDiscount: 0.08, rerollDiscount: 0.12, waveIncome: 16 } }),
  // 精通类别仍用 'economy' → 与工程扇区的「经济精通」**互斥**（同类精通全树只能选一次）
  n('g4', 'economy', 'mastery', '商人', '孢子产出 +25%、每波 +12 材料，但生命上限 −3（与工程的「经济精通」互斥）',
    { econ: { sporeMul: 0.25, waveIncome: 12 }, stats: { maxHp: -3 } }, 'economy'),
  n('g5', 'economy', 'keystone', '商会', '孢子产出 +60%、商店折扣 +12%、营地折扣 +25%、每波 +28 材料，但伤害 −8%、生命上限 −5',
    { econ: { shopDiscount: 0.12, campDiscount: 0.25, sporeMul: 0.60, waveIncome: 28 }, stats: { damage: -0.08, maxHp: -5 } }),
  n('g6', 'economy', 'minor', '库存', '每波 +12 材料（不再是开局一次性）', { econ: { waveIncome: 12 } })
];

/** 本职子树：每个角色两节点（显著点强化本职机制，基石给身份） */
var CHAR_NODES = [
  n('c_ranger', 'ranged', 'notable', '均衡之道', '远程伤害 +2、最大生命 +4、开局 15 废料', { stats: { rangedDmg: 2, maxHp: 4 }, scrap: 15 }, 'char:ranger'),
  n('k_ranger', 'ranged', 'keystone', '六边形', '所有伤害 +12%，但收获 −6', { stats: { damage: 0.12, harvesting: -6 } }),

  n('c_brawler', 'melee', 'notable', '血怒', '近战伤害 +6、护甲 +1', { stats: { meleeDmg: 6, armor: 1 } }, 'char:brawler'),
  n('k_brawler', 'melee', 'keystone', '不退', '近战伤害 +14、击退 +25%，但移动速度 −10%', { stats: { meleeDmg: 14, knockbackBonus: 0.25, speed: -0.10 } }),

  n('c_mage', 'elemental', 'notable', '元素共鸣', '元素伤害 +6、攻速 +6%', { stats: { elementalDmg: 6, attackSpeed: 0.06 } }, 'char:mage'),
  n('k_mage', 'elemental', 'keystone', '玻璃炮', '元素伤害 +16、攻速 +18%，但生命上限 −8', { stats: { elementalDmg: 16, attackSpeed: 0.18, maxHp: -8 } }),

  n('c_engineer', 'engineering', 'notable', '流水线主管', '工程学 +8、开局多带 40 废料', { stats: { engineering: 8 }, scrap: 40 }, 'char:engineer'),
  n('k_engineer', 'engineering', 'keystone', '钢铁洪流', '开局额外带一座便携炮塔与一台哨戒机枪，但移速 −12%', { stats: { speed: -0.12 }, items: ['turretitem'], weapons: ['turretgun'] }),

  n('c_masochist', 'melee', 'notable', '痛觉转化', '伤害 +10%、生命上限 −2', { stats: { damage: 0.10, maxHp: -2 } }, 'char:masochist'),
  n('k_masochist', 'melee', 'keystone', '濒死', '伤害 +30%、攻速 +15%，但生命上限 −10、护甲 −3', { stats: { damage: 0.30, attackSpeed: 0.15, maxHp: -10, armor: -3 } }),

  n('c_gladiator', 'melee', 'notable', '双持架势', '近战伤害 +4、攻速 +8%', { stats: { meleeDmg: 4, attackSpeed: 0.08 } }, 'char:gladiator'),
  n('k_gladiator', 'melee', 'keystone', '角斗场', '开局额外带一把长剑，且武器伤害 +10%，但最大生命 −4', { stats: { damage: 0.10, maxHp: -4 }, weapons: ['sword'] }),

  n('c_collector', 'ranged', 'notable', '囤积', '收获 +12、幸运 +6', { stats: { harvesting: 12, luck: 6 } }, 'char:collector'),
  n('k_collector', 'ranged', 'keystone', '垄断', '收获 +22、开局多带 60 废料，但伤害 −12%', { stats: { harvesting: 22, damage: -0.12 }, scrap: 60 }),

  n('c_sprinter', 'ranged', 'notable', '步法', '移速 +8%、闪避 +4%', { stats: { speed: 0.08, dodge: 0.04 } }, 'char:sprinter'),
  n('k_sprinter', 'ranged', 'keystone', '残影', '移速 +25%、闪避 +12%，但最大生命 −6', { stats: { speed: 0.25, dodge: 0.12, maxHp: -6 } }),

  /* 隐藏角色（G5）：本职子树同样要有 —— 自检会验"每个角色都有本职天赋" */
  n('c_mole', 'melee', 'notable', '破墙者', '近战伤害 +5、护甲 +2、击退 +20%', { stats: { meleeDmg: 5, armor: 2, knockbackBonus: 0.20 } }, 'char:mole'),
  n('k_mole', 'melee', 'keystone', '地脉', '生命上限 +14、护甲 +4，但移速 −14%', { stats: { maxHp: 14, armor: 4, speed: -0.14 } })
];

var NODES: TalentNodeDef[] = SHARED.concat(CHAR_NODES);

// 本职子树的节点只给对应角色（`mastery: 'char:xxx'` 就是它的归属标记）
var OWNER: Record<string, string> = Object.create(null);
for (var ci = 0; ci < CHAR_NODES.length; ci++) {
  var cn = CHAR_NODES[ci];
  OWNER[cn.id] = cn.mastery ? cn.mastery.slice(5) : '';
}

var BY_ID: Record<string, TalentNodeDef> = Object.create(null);
for (var i = 0; i < NODES.length; i++) BY_ID[NODES[i].id] = NODES[i];

Talent.LIST = NODES;
Talent.BY_ID = BY_ID;
Talent.TYPES = TYPES;
Talent.SECTORS = SECTORS;
Talent.AFFINITY = AFFINITY;
Talent.OWNER = OWNER;
Talent.ECON_KEYS = ECON_KEYS;
Talent.ECON_DEFAULTS = ECON_DEFAULTS;
Talent.ECON_CAP = ECON_CAP;

/* =========================================================
   4. 成本与互斥
   ========================================================= */
/**
 * 成本：**跨扇区 +1，本扇区不加价**。
 *
 * 一开始写的是"本扇区 −1"，但那会把层级压平：显著点（基准 2）在自己扇区也变成 1，
 * 和微点同价 —— 四级节点的意义就没了（测试也正是这么发现的）。
 * 起点差异用"跨扇区更贵"表达就够了，而且它保住了"层级越高越贵"这条不变量。
 */
Talent.costFor = function (node, charId) {
  if (!node) return 0;
  var base = (TYPES[node.type] && TYPES[node.type].cost) || 1;
  if (OWNER[node.id]) return base;                 // 本职子树不参与扇区加价
  var home = AFFINITY[charId] || '';
  if (!home) return base;
  return base + (node.sector === home ? 0 : 1);
};

/** 这个角色能看到的节点：共享全图 + 自己的本职子树 */
Talent.visibleFor = function (charId) {
  var out = [];
  for (var i = 0; i < NODES.length; i++) {
    var own = OWNER[NODES[i].id];
    if (own && own !== charId) continue;
    out.push(NODES[i]);
  }
  return out;
};

/**
 * 能不能点这一条。
 * @param taken 已点的节点 id 数组
 * @param earned 累计获得的天赋点
 * @returns { ok, reason, cost }
 */
Talent.canTake = function (charId, nodeId, taken, earned) {
  var node = BY_ID[nodeId];
  if (!node) return { ok: false, reason: '没有这个天赋', cost: 0 };
  var own = OWNER[nodeId];
  if (own && own !== charId) return { ok: false, reason: '这是别的角色的本职天赋', cost: 0 };
  if (taken.indexOf(nodeId) >= 0) return { ok: false, reason: '已经点过了', cost: 0 };

  var cost = Talent.costFor(node, charId);
  if (Talent.spentOn(taken, charId) + cost > earned) {
    return { ok: false, reason: '天赋点不够', cost: cost };
  }
  // 基石：同一时刻只能带一个（"改变运作方式"的东西叠起来就没有取舍了）
  if (node.type === 'keystone') {
    var other = taken.filter(function (id) { return BY_ID[id] && BY_ID[id].type === 'keystone'; });
    if (other.length) {
      return { ok: false, reason: '已经带了一个基石（' + BY_ID[other[0]].name + '），要先洗掉', cost: cost };
    }
  }
  // 精通：同一"类"在全树只能选一次（PoE 的规则）
  if (node.type === 'mastery' && node.mastery) {
    var same = taken.filter(function (id) {
      return BY_ID[id] && BY_ID[id].type === 'mastery' && BY_ID[id].mastery === node.mastery;
    });
    if (same.length) {
      return { ok: false, reason: '「' + node.mastery + '」这一类的精通已经选过了', cost: cost };
    }
  }
  return { ok: true, reason: '', cost: cost };
};

/** 已花掉的点数（按这个角色算成本） */
Talent.spentOn = function (taken, charId) {
  var sum = 0;
  for (var i = 0; i < (taken || []).length; i++) {
    var node = BY_ID[taken[i]];
    if (node) sum += Talent.costFor(node, charId);
  }
  return sum;
};

/* =========================================================
   5. 开局条件（**这是天赋唯一的出口**）
   ========================================================= */
/**
 * 把已点的天赋折成"开局条件"：起始属性 / 起始武器 / 起始道具 / 起始材料 / 经济修正。
 * 模拟层只认识这个对象，不认识"天赋"这个词。
 *
 * 经济修正是**加法折叠 + 单项封顶**（与据点/营地同一套）：
 * 加法的折叠不会因为点的顺序不同而漂移。
 */
Talent.openingFor = function (charId, taken) {
  var out: OpeningLoadout = { stats: {}, weapons: [], items: [], scrap: 0, econ: undefined };
  var econ: OpeningEcon = { shopDiscount: 0, campDiscount: 0, rerollDiscount: 0, sporeMul: 0, waveIncome: 0 };
  var list = taken || [];
  for (var i = 0; i < list.length; i++) {
    var node = BY_ID[list[i]];
    if (!node) continue;
    if (OWNER[node.id] && OWNER[node.id] !== charId) continue;   // 别人的本职天赋不生效
    var e = node.effects || {};
    var k;
    if (e.stats) {
      for (k in e.stats) {
        if (!Object.prototype.hasOwnProperty.call(e.stats, k)) continue;
        out.stats[k] = (out.stats[k] || 0) + e.stats[k];
      }
    }
    if (e.weapons) for (k = 0; k < e.weapons.length; k++) out.weapons.push(e.weapons[k]);
    if (e.items) for (k = 0; k < e.items.length; k++) out.items.push(e.items[k]);
    if (e.scrap) out.scrap += e.scrap;
    if (e.econ) {
      for (k in ECON_DEFAULTS) {
        if (!Object.prototype.hasOwnProperty.call(e.econ, k)) continue;
        var v = Number(e.econ[k]);
        if (isFinite(v) && v > 0) econ[k] += v;
      }
    }
  }
  out.scrap = Math.max(0, Math.round(out.scrap));
  for (var key in ECON_DEFAULTS) {
    econ[key] = Math.max(0, Math.min(ECON_CAP[key], econ[key]));
  }
  out.econ = econ;
  return out;
};

/** 天赋点从哪来：**打通关**。赢了给 2 + 难度级（越难的关卡给得越多，鼓励爬梯） */
Talent.pointsForRun = function (run) {
  if (!run) return 0;
  var win = run.win === true;
  var danger = Math.max(0, Math.floor(Number(run.danger) || 0));
  var pts = 0;
  if (win) pts += 2 + danger;
  // 没通关也有一点进度：第一次打到第 10 / 15 / 20 波各给一点（避免"打不过就毫无成长"）
  var wave = Math.max(0, Math.floor(Number(run.wave) || 0));
  if (wave >= 10) pts += 1;
  if (wave >= 15) pts += 1;
  if (wave >= 20) pts += 1;
  return pts;
};

/* =========================================================
   6. 洗点（有成本但不痛：先给固定次数免费，之后花孢子）
   ========================================================= */
Talent.FREE_RESPECS = 3;
Talent.RESPEC_COST = 20;

/**
 * 这次洗点要花多少孢子（免费次数用完后开始收费）。
 * @param opts.free     免费次数（据点「档案馆」L2 会把它抬高）
 * @param opts.discount 费用折扣（「档案馆」L1 给 50%）
 *
 * 注意这里**只收一个折扣参数**，不认识"据点"这个词 ——
 * 与 opening 的纪律一样：加法折叠 + 由调用方把环境带进来。
 */
Talent.respecCost = function (usedFree, opts) {
  var used = Math.max(0, Math.floor(Number(usedFree) || 0));
  var free = (opts && opts.free > 0) ? Math.floor(opts.free) : Talent.FREE_RESPECS;
  if (used < free) return 0;
  var disc = (opts && opts.discount > 0) ? Math.min(0.9, opts.discount) : 0;
  return Math.max(1, Math.round(Talent.RESPEC_COST * (1 - disc)));
};

/* =========================================================
   7. 自检（测试与启动都用它；一条不对就抛）
   ========================================================= */
Talent.audit = function () {
  var problems = [];
  var seen: Record<string, boolean> = Object.create(null);
  var sectors = {}, types = {}, masteryBySector = {}, keystones = 0;
  for (var i = 0; i < NODES.length; i++) {
    var d = NODES[i];
    if (seen[d.id]) problems.push('节点 id 重复：' + d.id);
    seen[d.id] = true;
    if (!TYPES[d.type]) problems.push(d.id + ' 的类型不存在：' + d.type);
    if (!SECTORS[d.sector]) problems.push(d.id + ' 的扇区不存在：' + d.sector);
    if (!d.name || !d.desc) problems.push(d.id + ' 缺名字或说明');
    types[d.type] = (types[d.type] || 0) + 1;
    sectors[d.sector] = (sectors[d.sector] || 0) + 1;
    if (d.type === 'keystone') keystones++;
    if (d.type === 'mastery' && !d.mastery) problems.push(d.id + ' 是精通却没有类别');
    if (d.mastery) masteryBySector[d.mastery] = (masteryBySector[d.mastery] || 0) + 1;
    // 效果里的属性键必须真的存在（写错的键会静默不生效）
    var st = (d.effects && d.effects.stats) || {};
    for (var k in st) {
      if (!Object.prototype.hasOwnProperty.call(st, k)) continue;
      if (Stats.KEYS.indexOf(k as StatKey) < 0) problems.push(d.id + ' 的效果用了不存在的属性：' + k);
    }
    // 经济修正的键也必须在 ECON_KEYS 里（同一类"写错就静默不生效"的问题）
    var ec = (d.effects && d.effects.econ) || {};
    for (var ek in ec) {
      if (!Object.prototype.hasOwnProperty.call(ec, ek)) continue;
      if (!ECON_KEYS[ek]) problems.push(d.id + ' 用了未登记的经济键：' + ek);
    }
    if (!st || Object.keys(st).length === 0) {
      var e2 = d.effects || {};
      if (!(e2.weapons && e2.weapons.length) && !(e2.items && e2.items.length) &&
        !e2.scrap && !(e2.econ && Object.keys(e2.econ).length)) {
        problems.push(d.id + ' 没有任何效果（点了等于没点）');
      }
    }
  }
  for (var s in SECTORS) {
    if (!sectors[s]) problems.push('扇区 ' + s + ' 一个节点都没有');
  }
  if (keystones < 4) problems.push('基石太少（' + keystones + ' 个）：取舍不够');
  // 每个角色至少有一条本职天赋，且归属指向真实角色
  for (var c = 0; c < Chars.LIST.length; c++) {
    var id = Chars.LIST[c].id;
    var mine = NODES.filter(function (d) { return OWNER[d.id] === id; });
    if (!mine.length) problems.push('角色 ' + id + ' 没有本职天赋');
    if (AFFINITY[id] && !SECTORS[AFFINITY[id]]) problems.push('角色 ' + id + ' 的本命扇区不存在：' + AFFINITY[id]);
  }
  for (var nid in OWNER) {
    if (OWNER[nid] && !Chars.BY_ID[OWNER[nid]]) problems.push(nid + ' 的归属角色不存在：' + OWNER[nid]);
  }
  return { ok: problems.length === 0, problems: problems, counts: { total: NODES.length, sectors: sectors, types: types, keystones: keystones } };
};

/** 一行行给人看 */
Talent.describe = function () {
  var lines = ['天赋表：' + NODES.length + ' 条（共享 ' + SHARED.length + ' + 本职 ' + CHAR_NODES.length + '）'];
  for (var s in SECTORS) {
    var mine = NODES.filter(function (d) { return d.sector === s && !OWNER[d.id]; });
    lines.push('  ' + SECTORS[s].name.padEnd(4) + mine.length + ' 条   ' + SECTORS[s].note);
  }
  for (var t in TYPES) {
    lines.push('  ' + TYPES[t].label.padEnd(5) + '基准 ' + TYPES[t].cost + ' 点   ' + TYPES[t].note);
  }
  return lines.join('\n');
};

SelfCheck.register('Talent', Talent.audit);     // 定义期就校验：写错的键不该等到玩家点下去才发现

/* =========================================================
   8. 登记进扩展点总账
   ========================================================= */
Registry.family('talent', {
  note: '角色天赋（四级节点：微点/显著点/精通/基石）', owner: 'talents.ts',
  entries: function () {
    return NODES.map(function (d) {
      var refs = [
        { field: 'sector', value: d.sector, family: 'talentSector' },
        { field: 'type', value: d.type, family: 'talentType' }
      ];
      var e = d.effects || {};
      if (e.weapons) for (var i = 0; i < e.weapons.length; i++) {
        refs.push({ field: 'effects.weapons[' + i + ']', value: e.weapons[i], family: 'weapon' });
      }
      if (e.items) for (var j = 0; j < e.items.length; j++) {
        refs.push({ field: 'effects.items[' + j + ']', value: e.items[j], family: 'item' });
      }
      if (OWNER[d.id]) refs.push({ field: 'owner', value: OWNER[d.id], family: 'char' });
      return { id: d.id, refs: refs };
    });
  }
});
Registry.family('talentSector', {
  note: '天赋扇区（共享大图的五块：四个战斗扇区 + 一个经营扇区）', owner: 'talents.ts',
  values: function () { return Object.keys(SECTORS); }
});
Registry.family('talentType', {
  note: '天赋节点类型', owner: 'talents.ts',
  values: function () { return Object.keys(TYPES); }
});
Registry.family('talentEcon', {
  note: '天赋的经济修正键（与据点/营地同名；每个键都必须被读到）', owner: 'talents.ts',
  values: function () { return Object.keys(ECON_KEYS); }
});

export { Talent };
