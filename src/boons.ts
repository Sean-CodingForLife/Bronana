/* =========================================================
   boons.ts — 层间契约（打完一层 Boss 之后，给**下一层**挑一条规矩）

   为什么要有它：房间制的三层现在是**直的** —— 打完 Boss 就进下一层，
   除了"更强"没有别的变化。Cell 的层间变异、StS 打完 Boss 拿遗物、
   DD 的补给决策都是同一件事：**让玩家在两层之间做一个不可撤销的选择**。
   本作把它做成"契约"：一条好处 + 常常带着一条代价。

   分工与别的声明表一致：这里是纯数据 + 纯函数，模拟层只读折叠好的那一份。
   三个读点（都不新增机制）：
     · `enemy` 组折进 `S.wmods`（和层主题/房型同一套键名）
     · `econ`  组在四个地方各读一次（材料收集 / 每间奖励 / 商店货架 / 折扣）
     · `stats` 组并进 `recalcStats`（和营地设施走同一条路）

   守卫：`stats` 组里的键必须真的是属性表里的键（`Stats.base()` 的键集），
   否则"契约说它加了护甲"而玩家身上什么都没变 —— 这是最难查的一类静默故障。
   ========================================================= */

import { SelfCheck } from './selfcheck.ts';
import { Registry } from './registry.ts';
import { Stats } from './stats.ts';
import { U } from './utils.ts';
import { Fold } from './fold.ts';

var Boons = {} as BoonsApi;

/* =========================================================
   1. 效果键声明（**键自带说明**：界面不写第二份文案）
   ========================================================= */
var MOD_KEYS: Record<string, BoonsModKey> = {
  // ---- 敌人侧：折进 wmods（键名与 danger/dungeon 一致） ----
  enemyHp: { group: 'enemy', how: 'mul', note: '敌人生命' },
  enemyDmg: { group: 'enemy', how: 'mul', note: '敌人伤害' },
  eliteChance: { group: 'enemy', how: 'add', note: '精英概率' },
  // ---- 经济侧：模拟层各读一次 ----
  materialMul: { group: 'econ', how: 'mul', note: '材料收集' },
  bonusMul: { group: 'econ', how: 'mul', note: '每间结算奖励' },
  shopSlots: { group: 'econ', how: 'add', note: '商店货架' },
  shopDiscount: { group: 'econ', how: 'add', note: '商店折扣' },
  // ---- 属性侧：并进 recalcStats ----
  speed: { group: 'stats', how: 'add', note: '移速' },
  maxHp: { group: 'stats', how: 'add', note: '生命上限' },
  armor: { group: 'stats', how: 'add', note: '护甲' },
  dodge: { group: 'stats', how: 'add', note: '闪避' },
  harvesting: { group: 'stats', how: 'add', note: '收获' },
  luck: { group: 'stats', how: 'add', note: '幸运' },
  engineering: { group: 'stats', how: 'add', note: '工程学' }
};

/* =========================================================
   2. 契约表
   ---------------------------------------------------------
   每条都要回答"下一层会不一样在哪"。纯增益太多会没有选择，
   所以后半段都是**带代价**的（贪食/猎场/血契）。
   ========================================================= */
var LIST: BoonDef[] = [
  { id: 'bounty', name: '矿脉', note: '地下的东西更好挖', mods: { materialMul: 1.35 } },
  { id: 'armory', name: '军械库', note: '这一层的商店更像样', mods: { shopSlots: 2, shopDiscount: 0.10 } },
  { id: 'hunt', name: '猎场', note: '更多的精英，但打完给得更多', mods: { eliteChance: 0.10, bonusMul: 1.5 } },
  { id: 'bulwark', name: '壁垒', note: '这一层的敌人更虚', mods: { enemyHp: 0.88 } },
  { id: 'swift', name: '疾行', note: '腿脚更利索', mods: { speed: 0.12 } },
  /* 淬火原来是**纯增益**（护甲 +3、生命 +6），实测在 12 个种子上支配了其他所有契约
     （波次 +0.6、材料 +29、孢子 +2，三项都不弱）。纯增益在"生存是瓶颈"的肉鸽里
     必然支配 —— 所以给它一条真代价：更重 = 更慢。 */
  { id: 'forged', name: '淬火', note: '更厚，也更沉', mods: { armor: 3, maxHp: 6, speed: -0.08 } },
  /* 贪食原来是 +25% 材料 / +15% 敌人伤害，实测在三个指标上都不如"不挑"（死选项）——
     代价压过了好处。改成"材料给得更多、敌人只多一点点疼"。 */
  { id: 'greedy', name: '贪食', note: '拿得多，也更疼', mods: { materialMul: 1.35, enemyDmg: 1.10 } },
  { id: 'feast', name: '丰饶', note: '收获暴涨，战斗属性不变', mods: { harvesting: 10 } },
  /* 后三条是"专精型"：它们只对某一种 build 有意义，所以代价各自不同 ——
     抽签时它们让"这一条对现在这套装备值不值"变成一个真问题。 */
  { id: 'nimble', name: '灵巧', note: '闪得开，但这一层的敌人更结实', mods: { dodge: 0.08, enemyHp: 1.06 } },
  /* 赌徒原来是 luck +10 / 材料 −15%，也是死选项（材料那 −15% 直接把运气的好处吃掉了）。
     现在代价换成"这一层的结算奖励 −8%"：运气换钱，而不是运气换运气。 */
  { id: 'gambler', name: '赌徒', note: '运气好，但这一层结算得少', mods: { luck: 16, bonusMul: 0.92 } },
  { id: 'rig', name: '钻机', note: '工程学暴涨，代价是脚步', mods: { engineering: 8, speed: -0.06 } }
];

var BY_ID: Record<string, BoonDef> = Object.create(null);
for (var i = 0; i < LIST.length; i++) BY_ID[LIST[i].id] = LIST[i];

/* =========================================================
   3. 折叠与文案（纯函数）
   ========================================================= */
function apply(out: Record<string, number>, key: string, v: number) {
  var def = MOD_KEYS[key];
  if (!def) return;
  // 第一次碰到这个键时先摆上恒等值：`undefined + 0.1 = NaN` 是个真踩到的坑
  // （折出来的 eliteChance 是 NaN → 精英概率变成 NaN → 一只精英都不会出）
  // 恒等值取自折法表，不在这里写 1/0 —— 写死的话"换成取小"就会静默从 Infinity 起算。
  if (out[key] === undefined) out[key] = Fold.numIdentity(def.how);
  out[key] = Fold.num(def.how, out[key], v);
}

/**
 * 把一条契约折成三组（缺省 = 全恒等）。
 * `enemy` 会再折进 wmods；`econ` 由模拟层各读一次；`stats` 并进属性表。
 */
Boons.fold = function (id) {
  var def = typeof id === 'string' ? BY_ID[id] : id;
  var out: BoonsFold = { id: def ? def.id : '', enemy: {}, econ: {}, stats: {} };
  if (!def) return out;
  for (var k in def.mods) {
    if (!Object.prototype.hasOwnProperty.call(def.mods, k)) continue;
    var mk = MOD_KEYS[k];
    if (!mk) continue;
    apply(out[mk.group], k, def.mods[k]);
  }
  return out;
};

/** 一条契约的一行说明（键自带 note，界面不写第二份） */
Boons.lines = function (id) {
  var def = typeof id === 'string' ? BY_ID[id] : id;
  if (!def) return [];
  var out: string[] = [];
  for (var k in def.mods) {
    if (!Object.prototype.hasOwnProperty.call(def.mods, k)) continue;
    var mk = MOD_KEYS[k];
    if (!mk) continue;
    out.push(effectText(k, def.mods[k]));
  }
  return out;
};

/** 单个效果键 → 人话（`how` 决定 ×还是+） */
function effectText(key, v) {
  var mk = MOD_KEYS[key];
  if (!mk) return '';
  var num = Math.round(Number(v) * 100) / 100;
  var sign = mk.how === 'mul'
    ? (num >= 1 ? U.plusPct(num - 1) : '-' + U.pct(1 - num) + '%')
    : (num >= 0 ? '+' + num : String(num));
  return mk.note + ' ' + sign;
}
Boons.effectText = effectText;
Boons.MOD_KEYS = MOD_KEYS;
/**
 * 键 → 折法的一份扁平表。
 *
 * 为什么需要它：`game.foldInto` 把契约的 enemy 那一组折进 `S.wmods` 时要知道折法。
 * 改造前它读的是 `Danger.FOLD` —— 而那个键的折法其实是**这张表**声明的，
 * 于是同一个键有两份声明，改一份不会同步：
 * 实测把 `enemyHp` 在这里改成 `'add'`（`Danger.FOLD` 保持 `'mul'`），
 * `boons.apply` 会做加法、`game.foldInto` 会做乘法，而 **17 道门全绿**。
 * 折谁的就读谁的表，重叠键的一致性由 `test/fold.mjs` 的跨表对账守住。
 */
Boons.OPS = (function () {
  var m: Record<string, FoldOp> = Object.create(null);
  for (var k in MOD_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(MOD_KEYS, k)) continue;
    m[k] = MOD_KEYS[k].how;
  }
  return m;
})();
Boons.BY_ID = BY_ID;
Boons.LIST = LIST;

/** 一行行给人看（调试/图鉴共用） */
Boons.describe = function (id) {
  var def = typeof id === 'string' ? BY_ID[id] : id;
  if (!def) return '（没有契约）';
  return def.name + '：' + def.note + '（' + Boons.lines(def).join(' · ') + '）';
};

/**
 * 抽 n 条不重复的契约（**用调用方给的 rnd** —— 确定性因此归模拟层管）。
 * 抽签只影响"给哪几条"，不影响任何数值，所以同种子必然同一组候选。
 */
Boons.roll = function (n, rnd) {
  var pool = LIST.slice();
  var out: string[] = [];
  var want = Math.max(0, Math.min(Math.floor(Number(n) || 0), pool.length));
  for (var i = 0; i < want; i++) {
    var idx = Math.floor(rnd() * pool.length);
    if (idx >= pool.length) idx = pool.length - 1;
    out.push(pool[idx].id);
    pool.splice(idx, 1);
  }
  return out;
};

/* =========================================================
   4. 自检
   ========================================================= */
Boons.audit = function () {
  var problems = [];
  var ids: Record<string, boolean> = Object.create(null);
  var used: Record<string, boolean> = Object.create(null);
  var statKeys = Stats.base();
  for (var i = 0; i < LIST.length; i++) {
    var d = LIST[i];
    if (ids[d.id]) problems.push('契约 id 重复：' + d.id);
    ids[d.id] = true;
    if (!d.name || !d.note) problems.push(d.id + ' 缺名字或说明');
    var keys = Object.keys(d.mods || {});
    if (!keys.length) problems.push(d.id + ' 一个效果都没有');
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      used[key] = true;
      if (!MOD_KEYS[key]) { problems.push(d.id + ' 用了未声明的键：' + key); continue; }
      if (MOD_KEYS[key].group === 'stats' && !(key in statKeys)) {
        problems.push(d.id + ' 的属性键 ' + key + ' 不在属性表里（加了也看不见）');
      }
      var v = d.mods[key];
      // 数值合法性：乘法键必须为正（乘 0 或负数没有意义）；
      // 加法键**允许负数** —— 那正是"代价"的表达方式（灵巧/钻机都是负的）。
      if (typeof v !== 'number' || !isFinite(v)) problems.push(d.id + ' 的 ' + key + ' 不是合法数值');
      else if (MOD_KEYS[key].how === 'mul' && v <= 0) problems.push(d.id + ' 的 ' + key + ' 是乘法键，必须为正数');
    }
  }
  // 每个声明的键都要有人用（声明了没人用 = 界面上永远不出现的键）
  for (var mk in MOD_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(MOD_KEYS, mk)) continue;
    if (!used[mk]) problems.push('键 ' + mk + ' 声明了却没有任何契约用它');
  }
  if (LIST.length < 6) problems.push('契约太少（' + LIST.length + '）：抽两条会反复见到同一批');
  // 全是纯增益 = 没有选择（至少要有一条带代价的）
  var withCost = LIST.filter(function (d) {
    return Object.keys(d.mods).some(function (k) {
      return MOD_KEYS[k] && MOD_KEYS[k].group === 'enemy';
    });
  });
  if (!withCost.length) problems.push('没有任何带代价的契约 —— 抽签就只剩"哪个更好"');
  return { ok: problems.length === 0, problems: problems, counts: { boons: LIST.length, keys: Object.keys(MOD_KEYS).length } };
};
SelfCheck.register('Boons', Boons.audit);

/* =========================================================
   5. 登记进扩展点总账
   ========================================================= */
Registry.family('boon', {
  note: '层间契约（打完 Boss 给下一层挑一条规矩）', owner: 'boons.ts',
  entries: function () {
    return LIST.map(function (d) {
      var refs = [];
      for (var k in d.mods) refs.push({ field: 'mods.' + k, value: k, family: 'boonMod' });
      return { id: d.id, refs: refs };
    });
  }
});
Registry.family('boonMod', {
  note: '契约的效果键（声明了却没人读 = 这条契约是假的）', owner: 'boons.ts',
  values: function () { return Object.keys(MOD_KEYS); }
});
/* 契约的**分组**（`stats` 折进属性表 / `enemy` 折进 wmods / `econ` 各读一次）：
   它在 `MOD_KEYS` 里逐条写着，而模拟层按组取用 —— 写错一个组名，
   那条契约的效果会**折进没人读的那一份**（静默失效）。所以它也是一个值域。 */
Registry.family('boonGroup', {
  note: '契约效果的分组（决定它折到哪里去）', owner: 'boons.ts',
  values: function () {
    var out: string[] = [];
    for (var k in MOD_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(MOD_KEYS, k)) continue;
      if (out.indexOf(MOD_KEYS[k].group) < 0) out.push(MOD_KEYS[k].group);
    }
    return out;
  }
});

/* 字段 → 家族的声明（守卫读它，见 test/data-contract.mjs）。 */
Registry.uses('mods', 'boonMod');
Registry.uses('group', 'boonGroup');

export { Boons };
