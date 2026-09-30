/* =========================================================
   ledger.ts — **账本机制**（只提供"怎么定义一个账本"，**不定义任何一笔代币**）
   ---------------------------------------------------------
   为什么必须有这一层、以及它为什么必须**空**：

   设计上下文 v3 §5.4 的第一条错误就是本项目的真实事故：

     "错误1：把三个模块的货币压成一套。**禁止统一 `economy.ts`
      定义五六种货币互相兑换。**"

   而 `economy.ts` 原来做的正是这件事 —— 一张 `Eco.LIST` 定义全部代币，
   外加一张 `Eco.EXCHANGE` 给它们定汇率。只要货币定义集中在一处，
   "给它们定个汇率吧"就是下一个自然冲动，模块边界就在那一刻消失。

   所以这一层**故意不含任何一个代币 id**：

     · 每个模块用 `Ledger.define` 定义**自己的**账本
       （`eco_combat.ts` / `eco_manage.ts` / `eco_grow.ts`）
     · 全局货币单独一本（`eco_global.ts`）—— 它是"行动成本"，不是钱
     · **核心素材不在任何账本里**（`link.ts`）：
       v3 §5.4-错误2 "把核心素材当货币处理…一旦可兑换或流通，循环就散了"

   本文件提供三样东西，**都不碰具体货币**：
     1. `Ledger.define` —— 定义一个账本（顺带登记进总账 + 自检）
     2. `Ledger.audit`  —— **跨账本**的结构约束（模块代币不许跨界流通等）
     3. `Ledger.EXCHANGE` —— 模块代币之间的兑换（v3 §5.3），带限制条件
   ========================================================= */
import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';

var Ledger = {} as LedgerApi;

/** 三个模块（v3 §二：战斗 / 经营 / 养成 **是三个**，不是四个） */
var SYSTEMS: Record<string, SystemDef> = {
  combat: { name: '战斗', note: '对抗、胜负、风险、奖励 —— 地牢那一块' },
  manage: {
    name: '经营',
    note: '含**建造子模块**（布局/设施/升级/空间）与**经营子模块**' +
      '（资源/生产/供需/效率/市场/人员/时间）—— 对外一个模块、一套经营代币'
  },
  grow: {
    name: '养成',
    note: '含**角色成长**（等级/技能/天赋/属性/突破）、**NPC 羁绊**（好感/信任/关系阶段）' +
      '与**能力解锁** —— 对外一个模块、一套养成代币；叙事线**不产经济资源**'
  }
};

/** 代币的三种**角色**（v3 §5.1：模块代币 / 核心素材 / 全局货币） */
var ROLES: Record<string, CurrencyRoleDef> = {
  module: {
    name: '模块代币',
    note: '产出在本模块、**消费在本模块**。跨模块只能走兑换（高税、限额、消耗全局货币）'
  },
  global: {
    name: '全局货币',
    note: '三模块通用，每个模块都产、都用。它是**行动成本**（税），不是钱'
  }
};

var LEDGERS: Record<string, LedgerDef> = Object.create(null);
var ORDER: string[] = [];

/**
 * 定义一个账本。
 *
 * @param def.owner 这个账本归哪个模块（`combat` / `manage` / `grow` / `global`）
 * @param def.currencies 这个账本的**全部**代币 —— 只有这一个模块能产、能花
 *
 * ⚠ **一个模块一个账本，模块代币不许出现在别人的账本里**。
 * 这条由 `Ledger.audit()` 守（它不认识具体货币，只认识"这本账归谁"）。
 */
Ledger.define = function (def) {
  if (!def || !def.id) throw new Error('ledger: 账本没有 id');
  if (LEDGERS[def.id]) throw new Error('ledger: 账本重名 ' + def.id);
  if (!def.owner) throw new Error('ledger: 账本 ' + def.id + ' 没有 owner');
  if (!def.note) throw new Error('ledger: 账本 ' + def.id + ' 没有说明（note）');
  var rows = (def.currencies || []).map(function (c) {
    return {
      id: c.id, name: c.name, note: c.note, why: c.why,
      role: c.role || (def.owner === 'global' ? 'global' : 'module'),
      ledger: def.id, owner: def.owner
    };
  });
  var book: LedgerDef = {
    id: def.id, owner: def.owner, name: def.name || def.id, note: def.note,
    currencies: rows
  };
  LEDGERS[def.id] = book;
  ORDER.push(def.id);
  return book;
};

Ledger.byId = function (id) { return LEDGERS[id] || null; };
/** 全部账本（**按定义顺序**；工具打印用它） */
Ledger.all = function () {
  return ORDER.map(function (id) { return LEDGERS[id]; });
};
/** 一本账里的全部代币（扁平成一行一笔） */
Ledger.currencies = function () {
  var out: CurrencyDef[] = [];
  for (var i = 0; i < ORDER.length; i++) {
    var b = LEDGERS[ORDER[i]];
    for (var j = 0; j < b.currencies.length; j++) out.push(b.currencies[j]);
  }
  return out;
};
/** 按 id 查一笔代币（**只读**：它住在哪本账里不改变"谁能花它"） */
Ledger.currency = function (id) {
  var list = Ledger.currencies();
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
};
/** 某个模块的账本 */
Ledger.of = function (owner) {
  for (var i = 0; i < ORDER.length; i++) if (LEDGERS[ORDER[i]].owner === owner) return LEDGERS[ORDER[i]];
  return null;
};
/** 某个模块自己的代币 id（"这笔钱只能在这个模块花"的判据） */
Ledger.ownedBy = function (owner) {
  var b = Ledger.of(owner);
  return b ? b.currencies.map(function (c) { return c.id; }) : [];
};

Ledger.SYSTEMS = SYSTEMS;
Ledger.ROLES = ROLES;

/* =========================================================
   兑换（v3 §5.3 + §7-12）
   ---------------------------------------------------------
   "每个模块可把自己的**模块代币**兑换成另一个模块的**模块代币**。
    兑换后得到的是'另一个模块的代币'，不是通用货币。"

   它是模块之间**唯一**合法的代币通道，所以必须带限制（§7-12
   "需高税、限额、单向或消耗全局货币"），否则玩家会找最优路径绕过某个模块。

   四条限制，全部写进表里、由 `audit` 查：
     · `rate`   —— 汇率，**必须 < 1**（高税：换一次就亏一截）
     · `cap`    —— 每局限额（`0` = 不限）
     · `oneWay` —— 单向（只许 A→B，不许 B→A）
     · `cost`   —— 兑换本身还要**消耗全局货币**（行动成本）
   ========================================================= */
Ledger.EXCHANGE = [] as Array<ExchangeDef>;

Ledger.exchangeById = function (from, to) {
  for (var i = 0; i < Ledger.EXCHANGE.length; i++) {
    var e = Ledger.EXCHANGE[i];
    if (e.from === from && e.to === to) return e;
  }
  return null;
};
/** 这笔兑换现在能不能做（余额、限额、全局货币都查） */
Ledger.canExchange = function (from, to, n, have, global) {
  var e = Ledger.exchangeById(from, to);
  if (!e) return { ok: false, reason: '这两个模块的代币之间没有登记的兑换（' + from + ' → ' + to + '）' };
  var amt = Math.floor(Number(n) || 0);
  if (amt <= 0) return { ok: false, reason: '数量必须是正整数' };
  if (e.cap > 0 && amt > e.cap) return { ok: false, reason: '一次最多换 ' + e.cap + '（限额）' };
  if ((e.cost || 0) > 0 && Math.max(0, Number(global) || 0) < e.cost) {
    return { ok: false, reason: '还要 ' + e.cost + ' 全局货币当手续费' };
  }
  if (Math.max(0, Number(have) || 0) < amt) return { ok: false, reason: '不够换' };
  return { ok: true, got: Math.max(1, Math.floor(amt * e.rate)), cost: e.cost || 0 };
};

/* =========================================================
   跨账本自检
   ---------------------------------------------------------
   它**不认识任何一笔具体代币**，只认识结构 —— 这正是它不会变成
   "统一货币表"的原因。每一条对着一个真实故障：

     · 账本归属不是已登记的模块 → 那本账谁也说不清归谁
     · 模块代币出现在别人的账本里 → **内嵌**（v3 §4-规则1 的头号禁令）
     · 全局货币不止一笔 / 不在全局账本里 → 它就不再是"行动成本"而是另一笔模块钱
     · 兑换：不是"模块代币 ↔ 模块代币" → 那是在绕过模块的玩法
     · 兑换：没有税 / 没有限额或手续费 → 玩家会用它绕过整个模块
   ========================================================= */
Ledger.audit = function () {
  var problems: string[] = [];
  var seenCur: Record<string, string> = Object.create(null);
  var i, j, k;

  if (!ORDER.length) problems.push('一笔账本都没有定义 —— 三个模块的代币都无处安放');
  for (i = 0; i < ORDER.length; i++) {
    var b = LEDGERS[ORDER[i]];
    if (!SYSTEMS[b.owner] && b.owner !== 'global') {
      problems.push('账本 ' + b.id + ' 的归属不是已登记的模块：' + b.owner);
    }
    if (!b.currencies.length) problems.push('账本 ' + b.id + ' 一笔代币都没有（空账本）');
    for (j = 0; j < b.currencies.length; j++) {
      var c = b.currencies[j];
      if (!c.name) problems.push(c.id + ' 没有名字');
      if (!c.note) problems.push(c.id + ' 没有说明（"从哪来、花在哪"要写出来）');
      if (!c.why) problems.push(c.id + ' 没有 why —— 说不出它为什么存在的代币不该存在');
      if (seenCur[c.id]) {
        problems.push('代币 id 重复：' + c.id + '（既在 ' + seenCur[c.id] + '、又在 ' + b.id + '）');
      }
      seenCur[c.id] = b.id;
      /* **内嵌的头号禁令**：模块代币只能住在自己模块的账本里 */
      if (c.role === 'module' && b.owner !== c.owner) {
        problems.push('模块代币「' + c.name + '」住在 ' + b.id + '，而它归 ' + c.owner +
          ' —— 模块代币不许出现在别人的账本里（内嵌）');
      }
    }
  }

  /* 全局货币：**恰好一笔**，而且住在 `global` 账本里 */
  var globals: string[] = [];
  var all = Ledger.currencies();
  for (i = 0; i < all.length; i++) if (all[i].role === 'global') globals.push(all[i].id);
  if (globals.length !== 1) {
    problems.push('全局货币有 ' + globals.length + ' 笔（应当**恰好一笔**）—— ' +
      '多一笔它就不再是"行动成本"，而是另一笔模块钱');
  } else {
    var g = Ledger.currency(globals[0]);
    if (g && g.ledger !== 'global') {
      problems.push('全局货币「' + g.name + '」住在 ' + g.ledger + ' 账本里，应当住在 global 账本里');
    }
  }

  /* 兑换：模块代币 ↔ 模块代币，而且必须有税 */
  var seenEx: Record<string, boolean> = Object.create(null);
  for (i = 0; i < Ledger.EXCHANGE.length; i++) {
    var e = Ledger.EXCHANGE[i];
    var key = e.from + '>' + e.to;
    if (seenEx[key]) problems.push('兑换重复：' + key);
    seenEx[key] = true;
    var fa = Ledger.currency(e.from), tb = Ledger.currency(e.to);
    if (!fa) problems.push('兑换 ' + key + ' 的 `from` 不是已登记的代币');
    if (!tb) problems.push('兑换 ' + key + ' 的 `to` 不是已登记的代币');
    if (e.from === e.to) problems.push('兑换 ' + key + ' 两边是同一笔代币');
    if (fa && tb) {
      if (fa.role !== 'module' || tb.role !== 'module') {
        problems.push('兑换 ' + key + ' 的两边不是"模块代币 ↔ 模块代币"（' +
          fa.role + ' → ' + tb.role + '）—— 只有模块代币之间才谈得上兑换');
      }
      if (fa.owner === tb.owner) {
        problems.push('兑换 ' + key + ' 两边是同一个模块的（自己换自己没有意义）');
      }
    }
    if (!(e.rate > 0 && e.rate < 1)) {
      problems.push('兑换 ' + key + ' 的汇率必须在 (0,1) —— 兑换必须有**高税**，' +
        '不然玩家会拿它当套利通道绕过整个模块');
    }
    if (!(e.cap >= 0)) problems.push('兑换 ' + key + ' 的 `cap` 不是非负数（0 = 不限）');
    if (!(e.cost >= 0)) problems.push('兑换 ' + key + ' 的 `cost`（全局货币手续费）不是非负数');
    if (e.cap === 0 && e.cost === 0) {
      problems.push('兑换 ' + key + ' 既不限额也不要手续费 —— ' +
        'v3 §7-12 要的是"高税、限额、单向或消耗全局货币"至少满足一样');
    }
    if (e.oneWay && Ledger.exchangeById(e.to, e.from)) {
      problems.push('兑换 ' + key + ' 声明了单向，而反向那条也在表里 —— 自相矛盾');
    }
    if (!e.where || !SYSTEMS[e.where]) {
      problems.push('兑换 ' + key + ' 的 `where`（在哪个模块换）不是已登记的模块：' + e.where);
    }
    if (!e.note) problems.push('兑换 ' + key + ' 没有说明');
  }

  return {
    ok: problems.length === 0, problems: problems,
    counts: { ledgers: ORDER.length, currencies: all.length, exchanges: Ledger.EXCHANGE.length }
  };
};

SelfCheck.register('Ledger', Ledger.audit);

Registry.family('ledger', {
  note: '四本账（战斗 / 经营 / 养成 / 全局）—— 每个模块只定义自己的代币',
  owner: 'ledger.ts',
  entries: function () {
    return Ledger.all().map(function (b) { return { id: b.id, refs: [] }; });
  }
});
Registry.family('ledgerSystem', {
  note: '循环的三个模块（战斗 / 经营 / 养成）—— 账本的归属只能是它们之一（+ global）',
  owner: 'ledger.ts',
  values: function () { return Object.keys(SYSTEMS); }
});
Registry.family('currencyRole', {
  note: '代币的角色（模块代币 / 全局货币）—— 核心素材**不在这里**，它不在任何账本里',
  owner: 'ledger.ts',
  values: function () { return Object.keys(ROLES); }
});
Registry.uses('owner', 'ledgerSystem');

export { Ledger };
