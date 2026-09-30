/* =========================================================
   forge.ts — 图纸工坊（局外"养成"的第三条腿）
   ---------------------------------------------------------
   局外已经有两条腿，它们各自解决一个不同的问题：
     · 据点（stronghold.ts，花**孢子**）：改**这一局的规则与容量** —— 货架多一格、
       商店便宜一点、营地能盖更多。它靠离线产出与结算给孢子。
     · 天赋（talents.ts，花**点数**，按角色）：只改**开局条件**（起始属性与携带）。
   那么这一条腿解决什么？**"合成"这件事本身**。
     · 参考 Dead Cells 的 Collector：局外花局内挣来的资源，解锁**物品与品质**；
       它的 Blacksmith 更狠 —— 永久提高"掉落更高品质"的概率，而不是给你属性。
     · 参考 brotato：它**故意不给你永久属性**（全靠挑战解锁内容），
       因为"永久属性"会把局内的取舍直接买断（钱能解决的问题就不是选择了）。
   所以工坊的每一条都是**能力**（能合什么、怎么合、回收多少、槽位几个），
   没有一条是"+X 伤害"。这条纪律由 test/forge.mjs 静态守着：节点表里不许出现属性键。

   货币是**合金**，来源只有两个，都在"合成"这条链上：
     · 局内每次合成（档位越高给得越多）—— 合成越多，工坊越快
     · 每次结算的基础产出（`3 + 波次/3`）—— 保证"一次都没合成"的局也在推进
   为什么不做第三条来源（比如离线）：孢子已经在做那件事了，两条曲线互相放大
   会让"复利"失控（孢子那条曲线只由天赋与打得深来推，据点不再乘它）。
   ========================================================= */
import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';
import { Tiers } from './data_tiers.ts';
import { U } from './utils.ts';

var Forge = {} as ForgeApi;

/* =========================================================
   1. 修正键：**唯一**的一张声明表
   ---------------------------------------------------------
   每个键都在这里写清楚"界面怎么说这句话"（text），
   界面只翻译、不写文案 —— 新增一个键不需要动 ui.ts。
   键名就是模拟层读的那个名字（没有改名层），所以"声明了却没人读"
   能被 test/forge.mjs 的静态检查直接抓出来。
   ========================================================= */
Forge.MOD_KEYS = {
  craftTier: {
    kind: 'max', text: function (v) { return '图纸到 T' + v + '（能造这一档及以下的装备与道具）'; }
  },
  craftQuality: {
    kind: 'max', text: function (v) { return '造武器 ' + U.pct(v) + '% 概率高一档'; }
  },
  lines: {
    kind: 'add', text: function (v) { return '额外产线 +' + v; }
  },
  salvageBonus: {
    kind: 'add', text: function (v) { return '回收多返还 ' + U.pct(v) + '%'; }
  },
  alloyPerSalvage: {
    kind: 'add', text: function (v) { return '每次回收 +' + v + ' 合金'; }
  },
  fuseDiff: {
    kind: 'max', text: function (v) { return v ? '异档熔接：同名不同档也能合' : ''; }
  },
  alloyMul: {
    kind: 'add', text: function (v) { return '结算合金 +' + U.pct(v) + '%'; }
  }
};

Forge.emptyMods = function () {
  var out: Record<string, number> = {};
  for (var k in Forge.MOD_KEYS) {
    if (Object.prototype.hasOwnProperty.call(Forge.MOD_KEYS, k)) out[k] = 0;
  }
  return out as unknown as ForgeMods;
};

/* =========================================================
   2. 图纸树
   ---------------------------------------------------------
   三阶九张：T1 是"能造什么"的起点（基础图纸 / 回收 / 合金），
   T2 打开工艺档与产线，T3 是大师档与结算。
   `req` 是**全部**前置（空数组 = 无前置）。
   前置不是为了拖时间，而是让"先点哪条"有代价：想要大师图纸，
   就得先走工艺那一条 —— 于是"我要不要练制造"在开局前就要回答。
   **每一条都是能力**（能造什么 / 产能 / 质量 / 回收），一条属性都没有。
   ========================================================= */
Forge.LIST = [
  /* ---- T1：起步（一次回收左右就能点一条）---- */
  {
    id: 'basic', tier: 1, cost: 3, req: [], mod: 'craftTier', value: 2,
    name: '基础图纸', note: '打开 T2：能造的不再只有最粗的那几件'
  },
  {
    id: 'recycle', tier: 1, cost: 4, req: [], mod: 'salvageBonus', value: 0.20,
    name: '废料回收', note: '拆装备多捞一点回来 —— 制造的第一笔本钱'
  },
  {
    id: 'extract', tier: 1, cost: 5, req: [], mod: 'alloyPerSalvage', value: 1,
    name: '合金萃取', note: '每次回收都产合金：拆得越多，图纸来得越快'
  },

  /* ---- T2：工艺 ---- */
  {
    id: 'craft', tier: 2, cost: 9, req: ['basic'], mod: 'craftTier', value: 3,
    name: '工艺图纸', note: '打开 T3 —— 制造真正开始压过"应急买成品"'
  },
  {
    id: 'fuse', tier: 2, cost: 12, req: ['basic'], mod: 'fuseDiff', value: 1,
    name: '异档熔接', note: '同名的 T1 与 T2 也能合成 T3，不必再攒一模一样的两把'
  },
  {
    id: 'quench', tier: 2, cost: 14, req: ['craft'], mod: 'craftQuality', value: 0.25,
    name: '淬火', note: '造出来的武器有几率直接高一档'
  },

  /* ---- T3：大师（攒几局才够）---- */
  {
    id: 'master', tier: 3, cost: 24, req: ['craft'], mod: 'craftTier', value: 4,
    name: '大师图纸', note: '打开 T4：全套图纸打通'
  },
  {
    id: 'mass', tier: 3, cost: 26, req: ['fuse'], mod: 'lines', value: 1,
    name: '量产线', note: '永久多一条产线（不占工坊的设施位）'
  },
  {
    id: 'furnace', tier: 3, cost: 30, req: ['quench'], mod: 'alloyMul', value: 0.25,
    name: '熔炉', note: '结算合金 +25%：想快点走完整棵树就走这条'
  },

  /* ---- T4：神话（顶档。它买的不是数值，是"造得出来"）----
     为什么顶档要**多花一张图纸**：T5 的合成路径是"16 把同名"（约一整局的产出），
     如果淬火能不用图纸就把 T4 直接抬成 T5，"顶档"会退化成一次运气。
     所以抬档后的结果受图纸上限夹制（见 craft.ts 的 resultTier）：
     没有这张图纸，T4 就是你能造出来的最高一档。 */
  {
    /* ⚠ **它花的是 `relic`（遗物），不是 `core`**（M4，2026-09）。
       `core` 是**战斗 → 经营**那一环，图纸属于养成 —— 直接花 `core` 就是
       **跳过经营**把战斗的东西拿来用，而 v3 §5.2 的边是
       **战斗 → 经营 → 养成 → 战斗**，一跳都不能省。
       `relic` 由经营的关键建筑产出、在这里消费 —— 这条边这才算接上。 */
    id: 'myth', tier: 4, cost: 40, relic: 1, req: ['master'], mod: 'craftTier', value: 5,
    name: '神话图纸', note: '打开 T5：淬火第一次能把顶档装备造出来（要核心材料）'
  }
];

/* 无原型表 —— 与其余 BY_ID 同一条理由（档案里的图纸 id 直接查它） */
Forge.BY_ID = Object.create(null);
for (var fi = 0; fi < Forge.LIST.length; fi++) Forge.BY_ID[Forge.LIST[fi].id] = Forge.LIST[fi];

/* 图纸的"阶"只是树上的分组名（界面用它写一行小字）。
   它自己一张表：`audit` 的阶位范围、界面文案都从这里读 ——
   以前阶名是 {1:'入门',2:'工艺',3:'大师'}，而 audit 里另写着 `tier <= 3`：
   加第四阶时两处都得记得改，漏一处就是"界面上没有名字"或"自检说这张图纸非法"。 */
Forge.TIERS = [
  { tier: 1, name: '入门', note: '一次回收左右就能点一条' },
  { tier: 2, name: '工艺', note: '制造真正开始压过"应急买成品"' },
  { tier: 3, name: '大师', note: '攒几局才够' },
  { tier: 4, name: '神话', note: '顶档：它买的不是数值，是"造得出来"' }
];
Forge.TIER_NAME = (function () {
  var m: Record<number, string> = {};
  for (var i = 0; i < Forge.TIERS.length; i++) m[Forge.TIERS[i].tier] = Forge.TIERS[i].name;
  return m;
})();

/* =========================================================
   3. 纯函数：折叠 / 判定 / 审计
   ========================================================= */
/** 已解锁集合的**唯一**读法：存档里存的是 id 列表，运行时传的是映射 —— 两种都收 */
function holds(owned, id) {
  if (!owned) return false;
  if (Array.isArray(owned)) return owned.indexOf(id) >= 0;
  return owned[id] === true || owned[id] === 1;
}
Forge.holds = holds;

/**
 * 归一成 `{ id: true }` 映射。
 * 为什么要这一层：**数组与映射在项目里都真实存在** —— 档案里的 `forge` 是映射，
 * `Profile.forgeOwned()` 与存档里的是数组。不归一的话 `Object.keys(数组)` 会给出
 * `["0","1","2"]` 这种下标（第一次接存档时就是这么错的：读档以后工坊修正全成 0）。
 */
Forge.toMap = function (owned) {
  var out: Record<string, boolean> = {};
  if (!owned) return out;
  if (Array.isArray(owned)) {
    for (var i = 0; i < owned.length; i++) if (typeof owned[i] === 'string' && owned[i]) out[owned[i]] = true;
    return out;
  }
  var src = owned as Record<string, unknown>;
  for (var k in src) {
    if (Object.prototype.hasOwnProperty.call(src, k) && (src[k] === true || src[k] === 1)) out[k] = true;
  }
  return out;
};

/**
 * 把已解锁的图纸折成**一份修正**（模拟层只在开局读一次，之后不回表 —— 与据点同套路）。
 * 同键多个节点：`add` 相加、`max` 取最大（军械库的 startTier 3 覆盖备料的 2）。
 */
Forge.modsFor = function (owned) {
  var out = Forge.emptyMods();
  for (var i = 0; i < Forge.LIST.length; i++) {
    var d = Forge.LIST[i];
    if (!holds(owned, d.id)) continue;
    var meta = Forge.MOD_KEYS[d.mod];
    if (!meta) continue;
    if (meta.kind === 'max') out[d.mod] = Math.max(out[d.mod] || 0, d.value);
    else out[d.mod] = (out[d.mod] || 0) + d.value;
  }
  return out;
};

/** 前置都满足了吗（`owned` 是已解锁集合） */
Forge.reqsMet = function (owned, d) {
  if (!d || !d.req || !d.req.length) return true;
  for (var i = 0; i < d.req.length; i++) if (!holds(owned, d.req[i])) return false;
  return true;
};

/**
 * 能不能解锁这一张。
 * @param alloy 合金余额
 * @param relic 遗物余额（**经营 → 养成**那一环，M4；只有声明了 `relic` 的图纸才读它）
 * @returns { ok, reason, cost, core, relic, locked }
 *   locked = 前置没满足（与"合金不够"是两种不同的等待，界面必须分开说）
 */
Forge.canUnlock = function (owned, id, growth, core, relic) {
  var d = Forge.BY_ID[id];
  if (!d) return { ok: false, reason: '没有这张图纸', cost: 0, core: 0, relic: 0, locked: true };
  if (holds(owned, id)) return { ok: false, reason: '已经解锁', cost: d.cost, core: 0, relic: 0, locked: false };
  if (!Forge.reqsMet(owned, d)) {
    var names = d.req.map(function (r) { return Forge.BY_ID[r] ? Forge.BY_ID[r].name : r; }).join('、');
    return { ok: false, reason: '前置图纸还没解锁：' + names, cost: d.cost, core: coreOf(d), relic: relicOf(d), locked: true };
  }
  var have = Math.max(0, Number(growth) || 0);
  var needCore = coreOf(d);
  if (have < d.cost) return { ok: false, reason: '合金不够（需要 ' + d.cost + '）', cost: d.cost, core: needCore, locked: false };
  /* 核心材料单独报缺哪一样：两种资源都不够时说"资源不够"，
     玩家不知道该去打 Boss 还是去多拆几件装备 —— 那是两种完全不同的行动。 */
  if (needCore > 0 && Math.max(0, Number(core) || 0) < needCore) {
    return { ok: false, reason: '核心材料不够（需要 ' + needCore + '，只有关底 Boss 掉）', cost: d.cost, core: needCore, locked: false };
  }
  /* **遗物**（`relic`）：经营的关键建筑产出它，养成的关键能力在这里花它 ——
     这是 v3 §5.2 那条 **经营 → 养成** 的边。
     ⚠ 「神话图纸」原来是花 `core` 的 —— 那是**跳过经营**把战斗的东西直接拿来用。 */
  var needRelic = relicOf(d);
  if (needRelic > 0 && Math.max(0, Number(relic) || 0) < needRelic) {
    return { ok: false, reason: '遗物不够（需要 ' + needRelic + '，经营的关键建筑产出）', cost: d.cost, core: needCore, relic: needRelic, locked: false };
  }
  return { ok: true, reason: '', cost: d.cost, core: needCore, relic: needRelic, locked: false };
};

/** 一张图纸要几个核心材料（没写就是 0） */
function coreOf(d) { return d && d.core > 0 ? Math.floor(d.core) : 0; }

/** 一张图纸要几个遗物（没写就是 0）。**经营 → 养成**那条边的价签。 */
function relicOf(d) { return d && d.relic > 0 ? Math.floor(d.relic) : 0; }

/** 一张图纸的效果，翻成人话（界面用） */
Forge.nodeText = function (d) {
  var meta = Forge.MOD_KEYS[d.mod];
  return meta && meta.text ? meta.text(d.value) : '';
};

/** 一份修正的所有效果，翻成人话（据点那一屏的"当前效果"同一套做法） */
Forge.effectLines = function (mods) {
  var out = [];
  var m = mods || {};
  for (var i = 0; i < Forge.LIST.length; i++) {
    var d = Forge.LIST[i];
    var v = m[d.mod];
    if (!v && v !== 0) continue;
    if (v) out.push(Forge.nodeText(d) + '（' + d.name + '）');
  }
  return out;
};

/** 一键解锁整棵树要多少合金（测试拿它算"够不够得着"） */
Forge.totalCost = function () {
  return Forge.LIST.reduce(function (a, d) { return a + d.cost; }, 0);
};

/**
 * 定义期自检 —— **一条抓不到错的审计等于装饰**，所以它自己也要被检查：
 *   · 每张图纸的 mod 必须在 MOD_KEYS 里，且 kind/value 合法
 *   · 前置必须存在、不能在时间上倒挂（前置的阶必须 ≤ 自己）
 *   · 每张图纸必须真的给出一条修正（value 为 0/空的效果 = 假图纸）
 *   · 每个 MOD_KEYS 里的键都必须有节点在用（声明了没人用 = 文案是假的）
 */
Forge.audit = function () {
  var problems = [];
  var used: Record<string, boolean> = Object.create(null);
  var seen: Record<string, boolean> = Object.create(null);
  var i, j;
  for (i = 0; i < Forge.LIST.length; i++) {
    var d = Forge.LIST[i];
    if (!d.id || seen[d.id]) problems.push('图纸 id 重复或为空：' + d.id);
    seen[d.id] = true;
    if (!(d.tier >= 1 && d.tier <= Forge.TIERS.length)) {
      problems.push(d.id + ' 的阶不在 1–' + Forge.TIERS.length + '：' + d.tier);
    }
    if (!(d.cost > 0)) problems.push(d.id + ' 没有成本（白送的图纸不是决策）');
    /* 核心材料（可选第二价）：与据点同一套判据 —— 正整且不超过一局产出（3） */
    if (d.core !== undefined && !(d.core > 0)) problems.push(d.id + ' 的 core 必须是正整数');
    if (d.core > 3) problems.push(d.id + ' 要 ' + d.core + ' 个核心材料（一局最多 3 个，超过就是拖延）');
    if (!Forge.MOD_KEYS[d.mod]) { problems.push(d.id + ' 的修正键没声明：' + d.mod); continue; }
    if (!(d.value > 0)) problems.push(d.id + ' 的效果是 0（这张图纸什么也不做）');
    used[d.mod] = true;
    for (j = 0; j < (d.req || []).length; j++) {
      var r = Forge.BY_ID[d.req[j]];
      if (!r) { problems.push(d.id + ' 的前置不存在：' + d.req[j]); continue; }
      if (r.tier > d.tier) problems.push(d.id + ' 的前置比它自己更靠后：' + r.id);
      if (r.id === d.id) problems.push(d.id + ' 的前置是它自己');
    }
  }
  // 环检测（三阶九节点也可能被写成一个圈，那样谁都点不出来）
  var state: Record<string, number> = Object.create(null);
  var cyc = [];
  function walk(id, path) {
    if (state[id] === 2) return;
    if (state[id] === 1) { cyc.push(path.concat(id).join('→')); return; }
    state[id] = 1;
    var d = Forge.BY_ID[id];
    if (d) for (var q = 0; q < (d.req || []).length; q++) walk(d.req[q], path.concat(id));
    state[id] = 2;
  }
  for (i = 0; i < Forge.LIST.length; i++) walk(Forge.LIST[i].id, []);
  if (cyc.length) problems.push('前置成环：' + cyc[0]);

  // 每个键都得有人用：声明了却没有任何图纸给出来 = 这条文案永远不会出现
  for (var k in Forge.MOD_KEYS) {
    if (Object.prototype.hasOwnProperty.call(Forge.MOD_KEYS, k) && !used[k]) {
      problems.push('修正键声明了却没有图纸用它：' + k);
    }
  }
  /* 每一阶都得有节点：加了阶名却没有图纸落在那一阶 = 界面上永远不会出现的分组 */
  var tierUsed: Record<string, boolean> = Object.create(null);
  for (i = 0; i < Forge.LIST.length; i++) tierUsed[Forge.LIST[i].tier] = true;
  for (i = 0; i < Forge.TIERS.length; i++) {
    if (!tierUsed[Forge.TIERS[i].tier]) problems.push('第 ' + Forge.TIERS[i].tier + ' 阶（' + Forge.TIERS[i].name + '）一张图纸都没有');
  }
  /* 跨表不变式：图纸最高能开到品级表的顶档。
     否则"顶档"在制造这一侧**不可达** —— 玩家只能靠 16 把同名合成，
     而工坊那句"能造到 T5"就成了空话（加档时最容易漏的正是这一条）。 */
  var maxCraft = 0;
  for (i = 0; i < Forge.LIST.length; i++) {
    if (Forge.LIST[i].mod === 'craftTier') maxCraft = Math.max(maxCraft, Forge.LIST[i].value);
  }
  if (maxCraft < Tiers.MAX) {
    problems.push('图纸最高只开到 T' + maxCraft + '，而品级表有 T' + Tiers.MAX + ' 档：顶档没有图纸可达');
  }
  /* ⚠ **这条边现在是 `relic`**（M4）：图纸属于**养成**，而 `core` 是**战斗 → 经营**
     那一环 —— 图纸直接花 `core` 等于**跳过经营**，而 v3 §5.2 的边是
     **战斗 → 经营 → 养成 → 战斗**，一跳都不能省。
     「神话图纸」原来花 `core`，现在花 `relic`（经营的关键建筑产出它）。
     这里守的是"赚得到、也花得掉"：图纸树里必须**真的有一张**要遗物。 */
  var relicUsed = 0;
  for (i = 0; i < Forge.LIST.length; i++) if (relicOf(Forge.LIST[i]) > 0) relicUsed++;
  if (!relicUsed) {
    problems.push('图纸树里没有一张要遗物 —— "经营 → 养成"这条边在玩家那一侧是断的（赚得到、花不掉）');
  }
  return { ok: problems.length === 0, problems: problems, counts: { nodes: Forge.LIST.length, keys: Object.keys(Forge.MOD_KEYS).length, tiers: Forge.TIERS.length } };
};

var verdict = Forge.audit();
if (!verdict.ok) {
  // 定义期就炸：与其它表一个套路（坏表不该等到玩家点到才发现）
  throw new Error('forge.ts 图纸表自检失败：\n' + verdict.problems.join('\n'));
}
/* 也登记进**启动期自检**（main.ts 的 boot 门槛会跑）：定义期那次 throw 只在模块加载时跑一遍，
   而"有人改坏了这张表"通常发生在加载之后的热更新里 —— 两处都守才算守住。 */
SelfCheck.register('Forge', Forge.audit);

/* =========================================================
   4. 登记到扩展点总账
   ---------------------------------------------------------
   每张图纸的 `mod` 是一次跨表引用：写错一个键（比如 `slot` 少个 s）会静默变成
   "这张图纸什么也不加" —— 那正是总账要抓的东西。
   ========================================================= */
Registry.family('forgeMod', {
  note: '图纸工坊的修正键（节点表的 mod 必须在这里）', owner: 'forge.ts',
  entries: function () {
    return Object.keys(Forge.MOD_KEYS).map(function (k) { return { id: k, refs: [] }; });
  }
});
Registry.family('forgeNode', {
  note: '图纸工坊的树（三阶九张）', owner: 'forge.ts',
  entries: function () {
    return Forge.LIST.map(function (d) {
      return { id: d.id, refs: [{ field: 'mod', value: d.mod, family: 'forgeMod' }] };
    });
  }
});

/* 字段 → 家族的声明（守卫读它，见 test/data-contract.mjs）。 */
Registry.uses('mod', 'forgeMod');

export { Forge };
