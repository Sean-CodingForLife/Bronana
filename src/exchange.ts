/* =========================================================
   exchange.ts — **模块代币之间的兑换**（v3 §5.3 + §7-12，M5）
   ---------------------------------------------------------
   v3 §5.3：
     "每个模块可把自己的**模块代币**兑换成另一个模块的**模块代币**。
      兑换后得到的是'另一个模块的代币'，不是通用货币。"

   v3 §7-12：
     "需**高税、限额、单向或消耗全局货币**"，否则玩家会找最优路径绕过某个模块。

   ## 为什么单独一个文件

   `ledger.ts` 是**机制**，它按设计"故意不含任何一个代币 id" —— 表要由别处填，
   与 `Ledger.define` 由 `eco_*.ts` 调用是同一个套路。
   而兑换是**两个模块之间**的事，不归任何一本账，所以它需要自己的落点。

   ## 这里只有两条，而且都是**单向**的

     战斗 --废料--> 经营 --产能--> 养成

   方向与核心素材那条链（`core` → `relic` → `sigil`）**一致**：
   两者都是往前走的通道，区别只是核心素材**不花全局货币**（它是打出来的），
   而兑换**要付行动成本**（§7-12 明写"或消耗全局货币"）。

   ⚠ **没有反向的条目**，这是刻意的：反向兑换会让"战斗 → 经营 → 养成 → 战斗"
   变成一个**闭环套利**，而那条回程是**徽记**（`sigil`）的活 ——
   核心素材是"打赢了带回来的东西"，兑换是"拿钱买近路"，两者不能互相冒充。
   ========================================================= */
import { Ledger } from './ledger.ts';
/* ⚠ **必须显式 import 那三本账**：兑换的两边是它们的代币，而 `Ledger.EXCHANGE`
   是在**模块加载时**填进去的 —— `ledger` 的 `audit` 会在那一刻查"这两个 id 存不存在"。
   靠别的模块（`economy.ts`）间接把它们带进来是不行的：加载顺序一变就报
   "不是已登记的代币"，而那只在 **CLI**（只加载模拟层）里露出来。 */
import './eco_combat.ts';
import './eco_manage.ts';
import './eco_grow.ts';
import './eco_global.ts';
import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';

var Exchange = {} as ExchangeApi;

/* =========================================================
   两条兑换
   ---------------------------------------------------------
   税率都压得很低（换一次亏一多半），这样它才真的是"近路"而不是"主路"：
   真要走得快，还是得把那个模块玩起来。
   ========================================================= */
Exchange.LIST = [
  {
    id: 'scrapToCapacity',
    from: 'scrap', to: 'capacity',
    rate: 0.4, cap: 30, oneWay: true, cost: 5,
    where: 'combat',
    note: '把打怪攒的废料换成经营的产能，好去盖第一座设施（在商店换）',
    why: '税 60%：换一次亏一多半，所以它只在"差一点就能盖起来"的时候划算 —— ' +
      '那正是近路该有的样子。限额 30 挡住"一次换够一整局"。'
  },
  {
    id: 'capacityToGrowth',
    from: 'capacity', to: 'growth',
    rate: 0.3, cap: 20, oneWay: true, cost: 10,
    where: 'manage',
    note: '把经营攒的产能换成养成点，好点第一条天赋线（在据点换）',
    why: '税 70%、手续费 10 ——比上一条更贵。越靠后越贵是**刻意**的：' +
      '离"自己把这个模块做起来"越远，买路就越不划算。'
  }
];

Exchange.BY_ID = (function () {
  var m: Record<string, ExchangeDef> = Object.create(null);
  for (var i = 0; i < Exchange.LIST.length; i++) m[Exchange.LIST[i].id] = Exchange.LIST[i];
  return m;
})();

/* 填进机制层那张表 —— `ledger.ts` 的 `audit` 会逐条查那四条限制 */
(function () {
  for (var i = 0; i < Exchange.LIST.length; i++) Ledger.EXCHANGE.push(Exchange.LIST[i]);
})();

/* =========================================================
   自检
   ---------------------------------------------------------
   每一条对着一次真实的绕过：
     · 某条**不是单向** → 反着换一次就能套利（而回程应当是徽记的活）
     · 某条**不收全局货币** → 兑换变成免费，行动成本那一层被架空
     · 两条的方向不成链 → 玩家能跳过中间那个模块（`scrap` 直接换 `growth`）
   ========================================================= */
Exchange.audit = function () {
  var problems: string[] = [];
  if (!Exchange.LIST.length) {
    problems.push('一条兑换都没有 —— v3 §5.3 说模块代币之间**可以**兑换，' +
      '而"可以"这件事要有落点，否则玩家只能硬走核心素材那条独木桥');
  }
  var seen: Record<string, boolean> = Object.create(null);
  for (var i = 0; i < Exchange.LIST.length; i++) {
    var e = Exchange.LIST[i];
    if (!e.id) { problems.push('第 ' + i + ' 条兑换没有 id'); continue; }
    if (seen[e.id]) problems.push('兑换 id 重复：' + e.id);
    seen[e.id] = true;
    if (!e.where) problems.push(e.id + ' 没说清在**哪里**换（玩家找不到就等于没有）');
    if (!e.note) problems.push(e.id + ' 没有说明');
    if (!e.why) problems.push(e.id + ' 没有 why');
    if (e.oneWay !== true) {
      problems.push(e.id + ' 不是单向 —— 反着换一次就能套利（§7-12 明写要单向或限额或高税，' +
        '而"回程"应当是徽记（`sigil`）那条边的活）');
    }
    if (!(e.cost > 0)) {
      problems.push(e.id + ' 不收全局货币 —— 兑换变成免费的，' +
        '"全局货币 = 行动成本"那一层就被架空了（§7-12 明写"或消耗全局货币"）');
    }
  }
  /* 方向必须成**一条链**：不许出现"跳过中间模块"的直通 */
  var hasSkip = false;
  for (var j = 0; j < Exchange.LIST.length; j++) {
    var a = Exchange.LIST[j];
    if (a.from === 'scrap' && a.to === 'growth') hasSkip = true;
  }
  if (hasSkip) {
    problems.push('有一条 `scrap → growth` 的直通 —— 那让玩家**跳过整个经营模块**，' +
      '而 v3 §4 说三个模块要各自成立、互相接入，不能有一条绕过其中一个的近路');
  }
  return { ok: problems.length === 0, problems: problems, counts: { exchanges: Exchange.LIST.length } };
};

var verdict = Exchange.audit();
if (!verdict.ok) throw new Error('exchange.ts 自检失败：\n' + verdict.problems.join('\n'));

SelfCheck.register('Exchange', Exchange.audit);

Registry.family('exchange', {
  note: '游戏模式代币之间的兑换（单向 + 高税 + 限额 + 消耗全局货币）',
  owner: 'exchange.ts',
  values: function () { return Exchange.LIST.map(function (e) { return e.id; }); }
});

export { Exchange };
