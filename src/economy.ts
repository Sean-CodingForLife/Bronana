/* =========================================================
   economy.ts — **只读聚合**（它**不定义任何一笔代币**）
   ---------------------------------------------------------
   ⚠ 这个文件名在设计上下文 v3 §5.4-错误1 里被**点名过**：

     "错误1：把三个模块的货币压成一套。**禁止统一 `economy.ts`
      定义五六种货币互相兑换。**"

   而它原来做的正是这件事 —— 一张 `Eco.LIST` 定义全部代币，外加一张
   `Eco.EXCHANGE` 给它们定汇率。本文件因此被拆成四块，定义搬到了别处：

     `ledger.ts`      账本**机制**（连一笔代币 id 都不含）
     `eco_combat.ts`  战斗账本（`scrap`）
     `eco_manage.ts`  经营账本（`capacity`）—— 建造 + 经营两个子模块共用
     `eco_grow.ts`    养成账本（`growth`）—— 角色成长 + NPC羁绊 + 能力解锁共用
     `eco_global.ts`  全局货币（`material`）—— 行动成本，单独一本
     `link.ts`        **核心素材**（三个）—— 它在**任何账本之外**

   留在这里的只有**读**：
     · `Economy.LIST` / `BY_ID` —— 四本账的汇总视图（给工具与界面看）
     · `Economy.loop()`        —— 循环图（**由核心素材推出来**，不是由货币流向）
     · `Economy.audit()`       —— 把三处自检合起来，**外加一条自己的**：
       本文件里不许出现任何一笔代币的定义

   ## 为什么"聚合"可以，"定义"不行

   差别不是形式，是**诱惑**：只要货币定义集中在一处，"给它们定个汇率吧"
   就是下一个自然冲动 —— 而那一刻模块边界就没了。汇总视图没有这个诱惑：
   它读到的每一笔都**已经**归好了账，改不了归属，也生不出新的兑换。

   这条约束由门 `drift` 的**判据 H** 守着（它扫本文件的源码文本）。
   ========================================================= */
import { Ledger } from './ledger.ts';
import { Link } from './link.ts';
import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';

/* 四本账在这里被"接上电"：它们各自定义自己，本文件只是让它们被加载。
   ⚠ 这四行是**副作用导入**（模块顶层的 `Ledger.define` 会跑）——
   去掉任何一行，对应的账本就是空的，而 `audit()` 会当场报"账本没有被定义"。 */
import './eco_combat.ts';
import './eco_manage.ts';
import './eco_grow.ts';
import './eco_global.ts';

var Eco = {} as EconomyApi;

/** 三个模块（转发；真相源在 `ledger.ts`） */
Eco.SYSTEMS = Ledger.SYSTEMS;
Eco.ROLES = Ledger.ROLES;

/** 四本账（转发） */
Eco.ledgers = function () { return Ledger.all(); };
/** 全部代币的**汇总视图**（只读；要改一笔代币请去它自己的账本文件） */
Eco.LIST = Ledger.currencies();
Eco.BY_ID = (function () {
  var m: Record<string, CurrencyDef> = Object.create(null);
  var list = Ledger.currencies();
  for (var i = 0; i < list.length; i++) m[list[i].id] = list[i];
  return m;
})();

/** 这笔代币归哪个模块（"只能在自己模块花"的判据） */
Eco.ownerOf = function (id) { var d = Eco.BY_ID[id]; return d ? d.owner : ''; };
/** 某个模块自己的代币 */
Eco.ownedBy = function (sys) { return Ledger.ownedBy(sys); };
/** 这笔代币是模块代币吗（产在本模块、只在本模块花） */
Eco.isModule = function (id) { var d = Eco.BY_ID[id]; return !!d && d.role === 'module'; };
/** 这笔代币是全局货币吗（三模块都产都花，是行动成本） */
Eco.isGlobal = function (id) { var d = Eco.BY_ID[id]; return !!d && d.role === 'global'; };
/** 某个模块的账本 */
Eco.ledgerOf = function (sys) { return Ledger.of(sys); };

/** 兑换（转发；只有**模块代币之间**才谈得上兑换） */
Eco.EXCHANGE = Ledger.EXCHANGE;
Eco.exchangeById = Ledger.exchangeById;
Eco.canExchange = Ledger.canExchange;

/* =========================================================
   循环图：**由核心素材推出来**
   ---------------------------------------------------------
   ⚠ 这是本文件里最要紧的一处改动。旧版的 `loop()` 是**由货币的 from/to
   推出来**的 —— 于是"循环"读起来像"钱在三个模块之间流动"，而钱本来就
   到处流，那个图证明不了任何东西。

   v3 §5.2 说循环是**核心素材**构成的：

     战斗产出核心素材A → 只能给经营消费
     经营产出核心素材B → 只能给养成消费
     养成产出核心素材C → 只能给战斗消费

   于是这里每一条边都对应**一个核心素材**，而且是"产在 A、只能在 B 花"。
   一条边没有核心素材 = 那条路走不通 = 链条缺一环（`Link.audit` 会报）。
   ========================================================= */
Eco.loop = function () {
  var edges = Link.LIST.map(function (l) {
    return { from: l.producedBy, to: l.consumedBy, what: [l.id] };
  });
  return { systems: Object.keys(Ledger.SYSTEMS), edges: edges };
};
/** 某一条链边上的核心素材（`combat → manage` 这条边有哪几个） */
Eco.edge = function (from, to) {
  return Link.LIST.filter(function (l) { return l.producedBy === from && l.consumedBy === to; })
    .map(function (l) { return l.id; });
};
/** 全库唯一的那笔全局货币 */
Eco.globalCurrency = function () {
  var list = Ledger.currencies();
  for (var i = 0; i < list.length; i++) if (list[i].role === 'global') return list[i];
  return null;
};

/** 核心素材（转发；它在账本之外） */
Eco.LINKS = Link.LIST;
Eco.linkOf = function (id) { return Link.BY_ID[id] || null; };

/* =========================================================
   自检：三处合起来，**外加一条自己的**
   ---------------------------------------------------------
   本文件自己的那一条是 v3 §8-7 点名要的守卫：

     "守卫：**禁止统一 `economy.ts`**，禁止核心素材入货币表，
      禁止跨模块直接消费。"

   前两条在这里查：
     · `economy.ts` **自己**不许定义代币 —— 汇总视图里每一笔都必须
       来自某本**已定义**的账；手写一笔就没有合法的 `ledger`
     · 核心素材**不许**出现在 `Eco.BY_ID` 里（它不在任何账本）
   第三条（调用点不许跨模块直花）由门 `drift` 的判据 F 读源码守。
   ========================================================= */
Eco.audit = function () {
  var problems: string[] = [];

  var lv = Ledger.audit();
  for (var i = 0; i < lv.problems.length; i++) problems.push(lv.problems[i]);
  var kv = Link.audit();
  for (var j = 0; j < kv.problems.length; j++) problems.push(kv.problems[j]);

  /* 四本账都要在（少一本 = 那个模块没有代币，它就不在循环里） */
  var need = ['combat', 'manage', 'grow', 'global'];
  for (var k = 0; k < need.length; k++) {
    if (!Ledger.byId(need[k])) {
      problems.push('账本 ' + need[k] + ' 没有被定义 —— 它的代币无处安放' +
        '（很可能是 `economy.ts` 里少了一行副作用 import）');
    }
  }

  /* ⚠ **核心素材不许进账本**（v3 §5.4-错误2 的守卫；`link.ts` 里是第一道） */
  for (var m = 0; m < Link.LIST.length; m++) {
    if (Eco.BY_ID[Link.LIST[m].id]) {
      problems.push('核心素材「' + Link.LIST[m].name + '」出现在账本汇总里 —— ' +
        '它是钥匙不是钱，进了账本就会被兑换（v3 §5.4-错误2）');
    }
  }

  /* ⚠ **本文件不许定义货币**：汇总视图里每一笔都必须来自某本已定义的账 */
  var list = Ledger.currencies();
  for (var n = 0; n < list.length; n++) {
    if (!Ledger.byId(list[n].ledger)) {
      problems.push('代币「' + list[n].name + '」声称住在 ' + list[n].ledger +
        '，但那本账不存在 —— 它多半是被手写在 `economy.ts` 里的');
    }
  }

  return {
    ok: problems.length === 0, problems: problems,
    counts: {
      currencies: Eco.LIST.length,
      ledgers: lv.counts.ledgers,
      links: kv.counts.links,
      exchanges: lv.counts.exchanges,
      systems: Object.keys(Ledger.SYSTEMS).length,
      edges: Eco.loop().edges.length
    }
  };
};

var verdict = Eco.audit();
if (!verdict.ok) {
  // 定义期就炸：与其它表一个套路（坏表不该等到玩家点到才发现）
  throw new Error('economy.ts 聚合自检失败：\n' + verdict.problems.join('\n'));
}

SelfCheck.register('Economy', Eco.audit);

Registry.family('currency', {
  note: '代币汇总视图（**只读**：定义在 eco_combat / eco_manage / eco_grow / eco_global）',
  owner: 'economy.ts',
  entries: function () {
    return Eco.LIST.map(function (d) {
      return {
        id: d.id,
        refs: [
          { field: 'ledger', value: d.ledger, family: 'ledger' },
          { field: 'role', value: d.role, family: 'currencyRole' }
        ]
      };
    });
  }
});

export { Eco as Economy };
