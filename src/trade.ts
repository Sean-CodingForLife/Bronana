/* =========================================================
   trade.ts — **NPC 交易**（R41 普查里那"完全没有"的一栏）
   ---------------------------------------------------------
   R41 的普查写着：

   > **② NPC 交易系统：完全没有。** 全仓搜 `trade` / `merchant` 只搜到两条无关的。
   > 现在只有 `market.ts` 的商店（货架 / 刷新 / 回收），那是**战斗模块内部**的，
   > 不是"跟人做买卖"。

   ## 这一层与 `market.ts` 的分工（这是本模块唯一要想清楚的事）

   | | 商店（`market.ts`） | 交易（本模块） |
   | --- | --- | --- |
   | 在哪 | **战斗模块内部**：波间那一屏 | **养成模块**：枢纽里跟人说话 |
   | 花什么 | `scrap`（战斗代币） | **`growth`（养成代币）或 `material`（全局货币）** |
   | 换什么 | 这一局的战力（武器 / 道具进背包） | **开局条件**（下一局的起始携带与起始废料） |
   | 时间感 | 每一波刷新货架 | 每位商人**每波限次**（与训练 / 制造同一形状） |

   ⚠ **§6.5 的硬约束**："NPC 互动**不能直接花战斗/经营模块代币**，必须通过合法
   兑换或核心素材路径。" 所以：

     · `ask` 只许是 **`growth`** 或 **`material`** —— `scrap`（战斗）与
       `capacity`（经营）**一律不许**。自检里那条判据就是它，而且是**实测反证过**的
       （往一条报价里塞 `scrap`，自检当场报红）。
     · NPC 互动归**养成模块**（v3 §6.1），所以它花养成的钱名正言顺。

   ⚠ **"换开局条件"是刻意的**，不是偷懒：交易如果换这一局的战力，它就与商店重复了
   （同一个功能两条路，且一条更便宜就废掉另一条）；而换成**下一局的起始携带**
   才是养成模块该干的事 —— 与 R10 那条"经营产出的东西不是自动的"同一个道理：
   玩家自己花、自己挑。

   ## 关系阶段是门槛（把对话与交易接起来）

   每一档报价可以写 `needStage`（`bonds.ts` 的关系阶段 id）。
   于是"跟这个人处好关系"第一次有了**玩法上的**回报 ——
   而叙事线本身仍然一个铜板都不碰（见 `story.ts` 那条硬约束）。
   ========================================================= */
import { Bonds } from './bonds.ts';
import { Ledger } from './ledger.ts';
import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';

var Trade = {} as TradeApi;

/* =========================================================
   1. 商品表
   ---------------------------------------------------------
   `give` / `ask` 各是一份**纯数据**：`{ material, growth, scrap, weapon, item }`。
   多个字段可以同时出现（"给你 20 废料 + 一件道具"也是合法的报价）。

   ⚠ 表里的 id **不在这里查**（本模块坐 L0，不认识数据表）——
     `Registry.family('tradeOffer')` 的 `refs` 把它们指到 `weapon` / `item` 家族上，
     写错一个字母由总账当场报红。这是 R51 那套"跨表引用"的标准做法。
   ========================================================= */
var OFFERS: TradeOfferDef[] = [
  /* ---- 拾荒者：把材料换成"下一局的本钱" ---- */
  {
    id: 'picker_scrap', npc: 'picker', name: '一把废料', note: '他替你攒着，下一局开局就带在身上',
    ask: { material: 10 }, give: { scrap: 30 }
  },
  {
    id: 'picker_coffee', npc: 'picker', name: '一罐咖啡', note: '他喝不惯，说苦。下一局开局带上',
    ask: { material: 14 }, give: { item: 'coffee' }
  },
  {
    id: 'picker_clover', npc: 'picker', name: '四叶草', note: '"这玩意儿在他口袋里发了三天芽。"',
    ask: { growth: 18 }, give: { item: 'clover' }
  },
  {
    id: 'picker_rations', npc: 'picker', name: '两包口粮', note: '他那儿的存货，够你吃一阵',
    ask: { material: 20 }, give: { item: 'rations' }
  },
  {
    id: 'picker_knife', npc: 'picker', name: '一把旧匕首', note: '刃口卷了，但还能用 —— 下一局真的带在身上',
    ask: { material: 12 }, give: { weapon: 'knife' },
    needStage: 'acquaintance'
  },
  {
    id: 'picker_whetstone', npc: 'picker', name: '磨刀石', note: '"你会用得上的。"',
    ask: { growth: 16 }, give: { item: 'whetstone' },
    needStage: 'trusted'
  },
  {
    id: 'picker_bulk', npc: 'picker', name: '整堆打包', note: '把一堆东西一次换成下一局的本钱',
    ask: { material: 120 }, give: { scrap: 240 },
    needStage: 'trusted'
  },

  /* ---- 守钟人：时间与记录那一侧的交换 ---- */
  {
    id: 'keeper_notes', npc: 'keeper', name: '旧笔记', note: '"拿去。我记不住了。"',
    ask: { growth: 16 }, give: { item: 'coffee' }
  },
  {
    id: 'keeper_cash', npc: 'keeper', name: '一串旧币', note: '钟楼底下挖出来的，早就不流通了 —— 但废料能收',
    ask: { material: 18 }, give: { scrap: 50 }
  },
  {
    id: 'keeper_eye', npc: 'keeper', name: '眼睛', note: '"你拿这个去，看得清一点。"',
    ask: { growth: 20 }, give: { item: 'clover' },
    needStage: 'bonded'
  },

  /* ---- 记录官：记录碎片那一侧的交换（贵，而且要有东西可说） ---- */
  {
    id: 'archivist_scroll', npc: 'archivist', name: '抄本', note: '他自己抄的一份，字很丑但意思对',
    ask: { growth: 22 }, give: { item: 'whetstone' }
  },
  {
    id: 'archivist_kit', npc: 'archivist', name: '一整套补给', note: '"你要往下走，这个比什么都实在。"',
    ask: { material: 30 }, give: { item: 'medicine' },
    needStage: 'acquaintance'
  }
];

var BY_ID: Record<string, TradeOfferDef> = Object.create(null);
(function () { for (var i = 0; i < OFFERS.length; i++) BY_ID[OFFERS[i].id] = OFFERS[i]; })();

/* =========================================================
   2. 规则（全是纯函数）
   ========================================================= */

/**
 * **允许收的钱**（§6.5 的硬约束，写成一个常量而不是散在判断里）。
 *
 * 为什么是这两笔：
 *   · `growth`   —— 养成模块的代币。NPC 互动按 v3 §6.1 归**养成模块**，
 *                    所以它花养成的钱名正言顺。
 *   · `material` —— 全局货币（"行动成本"）。三模块通用，任何模块都能花。
 *
 * ⚠ 不许的是：`scrap`（**战斗**模块代币）与 `capacity`（**经营**模块代币）——
 *   §6.5 点名禁止"直接花另一个模块的代币"。而 `core` / `relic` / `sigil`
 *   是**核心素材**（不在任何账本里），它们是"钥匙"不是"钱"，也不该出现在这里。
 */
Trade.ASK_CURRENCIES = ['growth', 'material'];

/** 一份报价的"付出那一侧"里的代币键（只认 ASK_CURRENCIES 里的） */
Trade.askCurrencies = function (offer) {
  var out: string[] = [];
  if (!offer || !offer.ask) return out;
  for (var i = 0; i < Trade.ASK_CURRENCIES.length; i++) {
    var k = Trade.ASK_CURRENCIES[i];
    if (Number(offer.ask[k]) > 0) out.push(k);
  }
  return out;
};

/** 付出那一侧里**不合法**的代币键（自检与测试都读它） */
Trade.illegalAsks = function (offer) {
  var out: string[] = [];
  if (!offer || !offer.ask) return out;
  for (var k in offer.ask) {
    if (!Object.prototype.hasOwnProperty.call(offer.ask, k)) continue;
    /* 只查"钱的键"：`scrap` / `capacity` 是钱；`weapon` / `item` 是物（另有一条判据） */
    if (k === 'weapon' || k === 'item') continue;
    if (Trade.ASK_CURRENCIES.indexOf(k) < 0) out.push(k);
  }
  return out;
};

/** 这一档报价现在能不能做（**只看条件，不看余额** —— 余额由调用方查） */
Trade.check = function (offer, ctx) {
  if (!offer) return { ok: false, reason: '没有这一档报价' };
  var c = ctx || {};
  if (offer.needStage) {
    var stage = String(c.stage || 'stranger');
    var need = Bonds.STAGES.findIndex(function (s) { return s.id === offer.needStage; });
    var have = Bonds.STAGES.findIndex(function (s) { return s.id === stage; });
    if (need < 0) return { ok: false, reason: '这一档要求一个不存在的关系阶段' };
    if (have < need) {
      var nm = Bonds.BY_STAGE[offer.needStage];
      /* ⚠ 理由里那对书名号用**中文引号**（「」）—— 界面把它原样渲染出来，
         `ui-check` 有一条"渲染出来的 DOM 里不许有 markdown"的判据，
         而 `**` 那种写法（哪怕只是想强调一下）会被它当场抓住。实测踩过。 */
      return { ok: false, reason: '得先跟他处到「' + (nm ? nm.name : offer.needStage) + '」' };
    }
  }
  if (offer.locked) return { ok: false, reason: '这一档还没解锁' };
  return { ok: true, reason: '' };
};

/** 这一位商人现在摆着哪些报价（没解锁 / 关系不够的**也列出来**，但标成不可做） */
Trade.offersFor = function (npcId, ctx) {
  var out: TradeView[] = [];
  for (var i = 0; i < OFFERS.length; i++) {
    var o = OFFERS[i];
    if (o.npc !== String(npcId || '')) continue;
    var chk = Trade.check(o, ctx);
    var c = ctx || {};
    var left = Math.max(0, Math.floor(Number(o.perWave) || Trade.PER_WAVE) -
      Math.max(0, Math.floor(Number((c.used && c.used[o.id]) || 0))));
    out.push({
      id: o.id, name: o.name, note: o.note,
      give: Trade.giveText(o), ask: Trade.askText(o),
      ok: chk.ok && left > 0,
      reason: chk.ok ? (left > 0 ? '' : '这一波买够了（每波 ' + (o.perWave || Trade.PER_WAVE) + ' 次）') : chk.reason,
      left: left
    });
  }
  return out;
};

/** 这一位 NPC 是不是商人（界面据此决定要不要画"交易"那个入口） */
Trade.isTrader = function (npcId) {
  var id = String(npcId || '');
  for (var i = 0; i < OFFERS.length; i++) if (OFFERS[i].npc === id) return true;
  return false;
};
/** 摆着报价的那几位（自检拿它查"每一档都归属一位真实存在的 NPC"） */
Trade.traders = function () {
  var out: string[] = [];
  for (var i = 0; i < OFFERS.length; i++) {
    if (out.indexOf(OFFERS[i].npc) < 0) out.push(OFFERS[i].npc);
  }
  return out;
};

/** 一位商人**每波**能做几次交易（与训练的"每波 3 次"、制造的"每波每条产线一次"同一形状） */
Trade.PER_WAVE = 2;

/** 一份报价是不是"换了一件空的"（两样都不给 = 花了钱什么也没拿到） */
Trade.isEmpty = function (offer) {
  if (!offer || !offer.give) return true;
  var g = offer.give;
  return !(Number(g.scrap) > 0 || String(g.weapon || '') || String(g.item || ''));
};

/* ---- 文案：**唯一实现**（界面与 describe 共用，不各写一份） ---- */
var CURRENCY_NAME: Record<string, string> = { growth: '成长点', material: '材料', scrap: '废料' };

Trade.giveText = function (offer) {
  if (!offer || !offer.give) return '';
  var g = offer.give, out: string[] = [];
  if (Number(g.scrap) > 0) out.push(g.scrap + ' 废料');
  if (g.weapon) out.push('武器 ' + g.weapon);
  if (g.item) out.push('道具 ' + g.item);
  return out.join(' + ');
};
Trade.askText = function (offer) {
  if (!offer || !offer.ask) return '';
  var a = offer.ask, out: string[] = [];
  for (var i = 0; i < Trade.ASK_CURRENCIES.length; i++) {
    var k = Trade.ASK_CURRENCIES[i];
    if (Number(a[k]) > 0) out.push(a[k] + ' ' + (CURRENCY_NAME[k] || k));
  }
  /* 不合法的键也要显示出来（否则"界面说不要钱、自检说它不合法"会让人找不到北）*/
  var bad = Trade.illegalAsks(offer);
  for (var j = 0; j < bad.length; j++) out.push(Number(offer.ask[bad[j]]) + ' ' + bad[j] + '(!)');
  return out.join(' + ');
};

/** 一行行给人看（调试 / 诊断共用） */
Trade.describe = function () {
  var lines = ['交易：' + OFFERS.length + ' 档报价 · ' + Trade.traders().length + ' 位商人'];
  for (var i = 0; i < Trade.traders().length; i++) {
    var npc = Trade.traders()[i];
    var n = 0;
    for (var j = 0; j < OFFERS.length; j++) if (OFFERS[j].npc === npc) n++;
    lines.push('  ' + npc + '：' + n + ' 档');
  }
  return lines.join('\n');
};

Trade.LIST = OFFERS;
Trade.BY_ID = BY_ID;
Trade.byId = function (id) { return BY_ID[String(id || '')] || null; };

/* =========================================================
   3. 自检
   ---------------------------------------------------------
   每一条对着一个真实故障：
     · `ask` 里出现 `scrap` / `capacity` → **§6.5 的硬约束被破**（玩家可以用
       战斗的钱买养成的东西）。这条**反证过**：塞一笔 `scrap` 进去当场报红。
     · `give` 是空的 → 花了钱什么也没拿到，而界面上照样写着"已购买"。
     · 报价归属一个不存在的 NPC → 玩家永远见不到它（死声明）。
     · 两个商人的同一档 id 重复 → 买了 A 却算在 B 头上。
     · 价格 <= 0 → 白送。
     · `needStage` 写错 → 那一档**永远不可达**（关系阶段是推出来的，没有"越过它"这回事）。
     · 一位商人每波 0 次 → 他的报价全是摆设。
   ========================================================= */
Trade.audit = function () {
  var problems: string[] = [];
  var seen: Record<string, boolean> = Object.create(null);
  var i, j;

  if (!OFFERS.length) problems.push('一档报价都没有（"NPC 交易"这一栏还是空的）');

  for (i = 0; i < OFFERS.length; i++) {
    var o = OFFERS[i];
    if (!o.id) { problems.push('第 ' + i + ' 档报价没有 id'); continue; }
    if (seen[o.id]) problems.push('报价 id 重复：' + o.id);
    seen[o.id] = true;
    if (!o.name) problems.push(o.id + ' 没有名字（界面上是个空按钮）');
    if (!o.note) problems.push(o.id + ' 没有说明（玩家不知道自己在换什么）');
    if (!o.npc) problems.push(o.id + ' 没有归属的商人（它永远不会出现）');
    if (!o.ask) problems.push(o.id + ' 没有 `ask`（白送）');
    if (!o.give) problems.push(o.id + ' 没有 `give`');

    /* **§6.5**：收的钱只许是 growth / material */
    var bad = Trade.illegalAsks(o);
    if (bad.length) {
      problems.push(o.id + ' 收 ' + bad.join('/') + ' —— §6.5 明令禁止 NPC 互动' +
        '直接花战斗/经营**游戏模式代币**（只许 ' + Trade.ASK_CURRENCIES.join(' / ') + '）');
    }
    /* 价格必须为正 */
    for (j = 0; j < Trade.ASK_CURRENCIES.length; j++) {
      var k = Trade.ASK_CURRENCIES[j];
      if (o.ask && o.ask[k] !== undefined && !(Number(o.ask[k]) > 0)) {
        problems.push(o.id + ' 的 ' + k + ' 不是正数（0 或负数 = 白送）');
      }
    }
    /* 不许"换了个空" */
    if (Trade.isEmpty(o)) {
      problems.push(o.id + ' 什么都不给（花了钱拿不到东西，而界面上照样写着"已购买"）');
    }
    /* 关系阶段必须是真的（写错 = 这一档永远不可达） */
    if (o.needStage && !Bonds.BY_STAGE[o.needStage]) {
      problems.push(o.id + ' 要求的关系阶段不存在：' + o.needStage + '（这一档永远买不到）');
    }
    /* 每波次数 */
    var pw = o.perWave === undefined ? Trade.PER_WAVE : o.perWave;
    if (!(pw > 0)) problems.push(o.id + ' 每波能做 ' + pw + ' 次 —— 那它是个摆设');
    /* 收的钱必须是一笔**已登记**的代币（拼错一个字母 = 玩家永远付不起）。
       ⚠ 这一条**只在账本已经接上电的时候查**：`ledger.ts` 只提供机制，
         `eco_*.ts` 才是定义代币的地方，而本模块（L0）比它们先加载 ——
         加载期硬查会把 12 档报价全部误报成"拼错了"（**实测踩过**：
         `material` / `growth` 都报"不在任何账本里"）。
         判据是"账本表非空"：空表说明"还没到那一步"，不是"没有这笔钱"。
         真判据在 `test/trade.mjs` [2]（那里在账本接上电之后逐个查）。 */
    if (Ledger.all().length > 0) {
      for (j = 0; j < Trade.ASK_CURRENCIES.length; j++) {
        var kk = Trade.ASK_CURRENCIES[j];
        if (o.ask && o.ask[kk] !== undefined && !Ledger.currency(kk)) {
          problems.push(o.id + ' 收的代币 ' + kk + ' 不在任何账本里（拼错了？）');
        }
      }
    }
  }

  /* 关系阶段那道门槛必须**够得着**：要求 `bonded` 的报价里，
     至少得有一位商人真的能处到那一步（每位 NPC 的相处上限由 Bonds 定） */
  var gates = OFFERS.filter(function (x) { return x.needStage === 'bonded'; });
  if (gates.length && !Bonds.STAGES.some(function (s) { return s.id === 'bonded'; })) {
    problems.push('有报价要求「羁绊」阶段，而那个阶段不存在');
  }

  return {
    ok: problems.length === 0, problems: problems,
    counts: { offers: OFFERS.length, traders: Trade.traders().length, perWave: Trade.PER_WAVE }
  };
};

var verdict = Trade.audit();
if (!verdict.ok) throw new Error('trade.ts 自检失败：\n' + verdict.problems.join('\n'));
SelfCheck.register('Trade', Trade.audit);

/* =========================================================
   4. 登记进扩展点总账
   ---------------------------------------------------------
   ⚠ 三样都要登记：
     · 报价归属的 NPC（`storyNpc`）—— 写错 = 没人见得到这档报价
     · 给的武器 / 道具（`weapon` / `item`）—— 写错 = 买到一件不存在的东西
     · 关系阶段门槛（`bondStage`）—— 写错 = 这一档永远不可达
   ========================================================= */
Registry.family('tradeOffer', {
  note: 'NPC 交易的一档报价（收 growth / material，给下一局的开局条件）', owner: 'trade.ts',
  entries: function () {
    return OFFERS.map(function (o) {
      var refs: RegistryRef[] = [
        { field: 'npc', value: o.npc, family: 'storyNpc' },
        { field: 'needStage', value: o.needStage, family: 'bondStage' }
      ];
      if (o.give && o.give.weapon) refs.push({ field: 'give.weapon', value: o.give.weapon, family: 'weapon' });
      if (o.give && o.give.item) refs.push({ field: 'give.item', value: o.give.item, family: 'item' });
      return { id: o.id, refs: refs };
    });
  }
});

export { Trade };
