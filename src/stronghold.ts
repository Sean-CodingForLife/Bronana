/* =========================================================
   stronghold.ts — 跨局据点（模拟经营的第二级，长线那一半）

   与局内营地的分工：
     · 营地：花**局内材料**，本局有效，结算清零 —— 解决"这一局怎么打"
     · 据点：花**孢子**（局外货币），永久有效 —— 解决"长期往哪长"

   两条循环的互供就在这里接上（Cult of the Lamb 的核心教训）：
       据点解锁营地容量与折扣 → 营地让这一局打得更好
         → 打出更多孢子与天赋点 → 据点更强 → 再反哺营地
   任一环节断开，两个系统就退化成两个半成品。所以据点里**必须有**
   `campSlots` / `campDiscount` 这两个键 —— 它们是那条连接线，不是装饰。

   据点给的是**功能**而不是纯数值：多一个货架位、多几次免费刷新、
   多一个设施位、营地更便宜、开局带材料、孢子产出更高。
   纯数值的永久强化会稀释"每局从零开始"，功能解锁不会。

   与 danger.ts / camp.ts 同一套纪律：效果键是**枚举**的，
   每个键都得在别处被读到（声明了没人读 = 这条效果是假的，测试静态守着）。
   ========================================================= */

import { SelfCheck } from './selfcheck.ts';
import { Registry } from './registry.ts';

var Stronghold = {} as StrongholdApi;

/* =========================================================
   1. 修正键
   ---------------------------------------------------------
   每个键**自己带说明与文案**（`note` 给开发者、`text(v)` 给玩家）。
   为什么这么设计：改造前"这个键叫什么、怎么写给人看"散在**六个地方**
   （ui 的当前效果行 / ui 的"下一级" / camp 的 nextTxt / camp 的 effTxt /
   camp.describeState / stronghold.describe），新增一个键要改六处，
   漏一处就是"效果生效了、界面上看不见"。现在**只有这一处**，
   而且有一条静态检查盯着"ui 里不许再出现键名字面量"。

   值就是"量"本身（保底几级、多带几件、必出几件）—— 模拟层读的就是这个数，
   **不在代码里写死**（改造前 `shopRoll` 里藏着一个硬编码的 3）。
   ========================================================= */
interface KeepModKeyDef { note: string; text: (v: number) => string[]; }
function kd(note: string, text: (v: number) => string[]): KeepModKeyDef { return { note: note, text: text }; }

var MOD_KEYS: Record<string, KeepModKeyDef> = {
  startMaterials: kd('开局材料（game.ts newSession）',
    function (v) { return ['开局材料 +' + v]; }),
  shopSlots: kd('商店每列多几件货（game.ts shopRoll）',
    function (v) { return ['每列货架 +' + v]; }),
  freeRerolls: kd('每波白送的刷新次数（game.ts startWave）',
    function (v) { return ['每波免费刷新 +' + v]; }),
  campSlots: kd('**工坊设施位上限**（market.campBuy → Camp.canBuy 的 slots）—— 据点 → 制造那条边的产能',
    function (v) { return ['工坊设施位 +' + v + '（= 产线 +' + v + '）']; }),
  /* ---- 这一档是"**能力解锁**"，不是数值 ----
     据点这一层只回答"你能做什么"：能建几条产线、能买到什么、能拆回来、
     离线能产多少、能带什么出门。**凡是乘到另外两根柱子上的数字都删掉了**
     （刷新折扣、工坊价格折扣、孢子产出倍率）—— 那几条正是"据点数值穿透"。 */
  refundFull: kd('拆工坊设施是否全额返还（market.campSell → Camp.refundOf）：摆法可以试错',
    function (v) { return v ? ['拆工坊设施全额返还'] : []; }),
  offlineLevel: kd('离线产出的等级（profile.settleOffline → offline.settle 的 sporebedLevel）',
    function (v) { return ['离线产出等级 +' + v]; }),
  /* ---- 下面两条是"据点 → 天赋"这条边 ----
     参照 Darkest Dungeon 的 Guild：那里的城镇建筑**不直接发技能等级**，
     而是 **Training Regimen 每次升级 −10% 训练费**、**Instructor Mastery 抬高技能上限**。
     本作照这个形状做：设施改的是"养成这条路的成本与速度"，不是直接送点数。
     它落在**养成层内部**（据点与天赋都是局外养成），不穿透到战斗或制造。 */
  freeRespecs: kd('每个角色多几次免费洗点（profile.ts 的免费次数）',
    function (v) { return ['免费洗点 +' + v + ' 次']; }),
  capacityBonus: kd('每波的**产能产出**额外 +N（Craft.capacityYield —— 建造 → 经营，**同模块内**）',
    function (v) { return ['每局天赋点 +' + v]; }),
  /* ---- 下面三个是"**结构性解锁**"（不是加数值）----
     参照 Loop Hero 的营地：Gymnasium **解锁特性**、Crypt **解锁职业**、
     Smelter 给的是 **Arsenal 卡（每个职业多一个道具槽）**，Intel Center 给的是
     **开局自带的 gold 卡** —— 那些建筑改的是"你能做什么"，不是"+15% 什么"。
     以及 DD 的 The Mill：直接**取消随机饥饿检定**，抹掉一条机制也算解锁。 */
  workshop: kd('刷新时至少保证一件"这个等级及以上"的货（game.ts shopRoll）',
    function (v) { return ['刷新保底 T' + v + '+']; }),
  rangeItem: kd('每局开局额外带几件道具，按局数轮换（profile.ts openingOf）',
    function (v) { return ['开局多带 ' + v + ' 件道具']; }),
  depot: kd('商店必有几件"你已持有的武器类别"（game.ts shopRoll）',
    function (v) { return ['商店必有 ' + v + ' 件在用的武器类别']; })
};

var BASE: StrongholdMods = {
  startMaterials: 0,
  shopSlots: 0,
  freeRerolls: 0,
  campSlots: 0,
  refundFull: 0,
  offlineLevel: 0,
  freeRespecs: 0,
  capacityBonus: 0,
  workshop: 0,
  rangeItem: 0,
  depot: 0
};

/* =========================================================
   2. 设施表
   ---------------------------------------------------------
   **每一级写的是"这一级加多少"（增量）** —— 与营地同一套模型。
   写混会静默翻倍，所以 test/keep.mjs 把每个设施"买满"的合计值逐个钉死。

   `req` 是**前置链**：`{ id, level }` —— 想盖这个，得先把那个盖到第几级。
   为什么要有它（Loop Hero 的教训）：那里的建筑有相邻与先后要求，
   官方攻略把"建的时候没给后续升级留位置"列为五大错误之一 ——
   也就是说**顺序本身是玩法**。没有前置时，据点只是一张"按价格从低到高买"的清单。
   ========================================================= */
function lv(cost, effect) { return { cost: cost, effect: effect }; }
function req(id, level) { return { id: id, level: level }; }

/* =========================================================
   **核心材料**：把"打了 Boss 才有"的东西变成真正的门槛
   ---------------------------------------------------------
   起因（自查发现的断头路）：核心材料能从战斗里赚到、能进档案
   （`Profile.addCore` / `applyRun`），但 `Profile.spendCore` **一次都没有被调用** ——
   也就是"打 Boss 拿到核心材料"这条线在玩家那一侧是**看得见摸不着**的：
   档案里那个数字永远只涨不花，经济表里写的 `core → 经营 + 养成` 是假的。

   现在它是**两道真正的门**（各一处，不铺开）：
     · 经营：`archive` Lv.3 —— 据点唯一那条 3 级线，也是"据点 → 天赋"那条边
     · 养成：`master` 图纸 —— 图纸树的开档位那一步
   为什么只放两处：核心材料每局只有 1~3 个（三层关底各一个，`CORE_PER_BOSS`），
   它是**元进度里最稀的一档**（`economy.ts` 的 meta-rare）。铺开成"每个高级设施都要"
   会让它从"值得"变成"又一次刷"。两条线各一处，正好是"这一局值了"的分量。
   ========================================================= */
function coreCost(n) { return n > 0 ? n : 0; }

var LIST: KeepFacilityDef[] = [
  {
    id: 'storehouse', name: '仓库', note: '每局开局就带一笔材料',
    levels: [lv(30, { startMaterials: 60 }), lv(80, { startMaterials: 80 })]
  },
  {
    id: 'shelves', name: '货架', note: '商店每列多一件货 —— 选择更多',
    levels: [lv(50, { shopSlots: 1 })]
  },
  {
    id: 'clocktower', name: '钟楼', note: '每波白送刷新次数 —— 商店决策更从容',
    levels: [lv(40, { freeRerolls: 1 }), lv(100, { freeRerolls: 1 })]
  },
  {
    // 这条是两条循环的连接线之一：没有它，工坊永远只有 3 条产线
    id: 'foundation', name: '地基', note: '工坊多一个设施位（= 多一条产线；据点 → 制造那条边）',
    levels: [lv(60, { campSlots: 1 }), lv(150, { campSlots: 1 })]
  },
  {
    /* 工匠：**能力**而不是折扣。
       改造前它是"工坊建造便宜 15%"—— 那是把数字乘到制造那根柱子上（据点数值穿透）。
       现在 L1 给的是"拆了全额返还"（摆法可以试错），L2 再给一个设施位。 */
    id: 'craftsmen', name: '工匠', note: '拆工坊设施全额返还 → 再多一条产线',
    levels: [lv(45, { refundFull: 1 }), lv(120, { campSlots: 1 })]
  },
  {
    /* 菌床 = **离线产出的解锁**（买了它才有离线孢子，`offline.settle` 的等级就是它）。
       改造前它还给"孢子产出 +35%"，那是跨柱子的经济乘数 —— 删掉了：
       它的价值现在全在"离线能产多少"这一件事上，而那本来就是能力。 */
    id: 'sporebed', name: '菌床', note: '解锁离线产出；升级它抬离线的产能',
    levels: [lv(80, { offlineLevel: 1 }), lv(200, { offlineLevel: 1 })],
    req: req('storehouse', 1)              // 先有地方放，才谈得上产出
  },
  {
    /* 「档案馆」—— **据点 → 天赋** 这条边。
       这是全据点唯一的 3 级设施，也是最贵的一条线（合计 530 孢子 ≈ 7 局通关）。
       三级各有分工，而且是**递进**的：
         L1 给你更多免费洗点（鼓励试错）
         L2 再给两次（鼓励换流派）
         L3 每局结算多给一点天赋点（真正开始"喂"养成）
       为什么 L3 才是"给点"：直接按点数送会让"通关才给点"的稀缺性消失
       （DD 的 Guild 也是先降成本、再抬上限，从不直接送等级）。 */
    id: 'archive', name: '档案馆',
    note: '【据点 → 天赋】免费洗点更多 → 再多 → 每局多给一点天赋点',
    levels: [
      lv(70, { freeRespecs: 1 }),
      lv(160, { freeRespecs: 2 }),
      /* L3 额外要**核心材料**：它是据点唯一那条 3 级线，也是"每局多给一点天赋点"
         这个**永久产出**的闸门。加了它之后，"打 Boss"这件事在局外第一次有了
         不可替代的用途 —— 而不是"再打两把攒孢子"。 */
      { cost: 300, core: 2, effect: { capacityBonus: 1 } }
    ],
    req: req('clocktower', 1)              // 记录时间的人，得先有钟
  },
  {
    /* 三个"结构性解锁"：它们给的不是数值，是**新的可能**。
       这一档是营地比据点厚的原因（营地有组合、据点原来只有加法），补上之后
       据点才配得上"模拟经营第二级"这个名字。 */
    id: 'workshop', name: '检验所', note: '【结构性】刷新时至少保证一件 T3 及以上的货',
    levels: [lv(130, { workshop: 3 })],
    req: req('craftsmen', 2)               // 工匠升级成检验所
  },
  {
    id: 'range', name: '靶场', note: '【结构性】每局开局额外带一件道具（按局数轮换）',
    levels: [lv(110, { rangeItem: 1 })],
    req: req('shelves', 1)                 // 有货架才有家伙可练
  },
  {
    id: 'depot', name: '货栈', note: '【结构性】商店每列必出一件"你已持有的武器类别"',
    levels: [lv(90, { depot: 1 }), lv(180, { depot: 1 })],
    req: req('storehouse', 2)              // 货栈要建在仓库上
  }
];

var BY_ID: Record<string, KeepFacilityDef> = Object.create(null);
for (var i = 0; i < LIST.length; i++) BY_ID[LIST[i].id] = LIST[i];

Stronghold.LIST = LIST;
Stronghold.BY_ID = BY_ID;
Stronghold.MOD_KEYS = MOD_KEYS;
Stronghold.BASE = BASE;

/* =========================================================
   3. 查询（纯函数）
   ========================================================= */
/* =========================================================
   **产能（`capacity`）的产出与消费**（M2，2026-09）
   ---------------------------------------------------------
   v3 §8-2 要求"接上 `capacity` 代币的真实产出点与消费点（现在 0/0）"。
   这两个数就是那两个点 —— 规则在这里（纯函数），钱在会话层（`game.ts`）。

   ⚠ **为什么有一个不依赖设施的底数**：
     如果产能**只**由设施产，开局就是 0 设施 → 0 产能 → 建不了设施 ——
     一个把自己锁死的循环。v3 §5.3-9 的"撞墙不卡死"要求的正是这一条：
     经营模块**自己会运转**，设施是让它转得更快，不是让它开始转。
   ========================================================= */
/* ⚠ **产出不在这里**（M2 第二刀）：v3 §三-2 把「生产 / 效率」划给**经营子模块**，
   而「设施 / 升级」才是建造子模块的。所以产能的**产出**搬到了 `craft.ts`
   （`Craft.capacityYield`）—— 见 `eco_manage.ts` 的子模块声明。
   这个文件（建造）只留**消费**那一半：`capacityFor`。 */


/**
 * 升这一级要多少**产能**（v3 §8-2 的消费点：**建造子模块**用它盖设施）。
 *
 * 与材料造价成比例：越贵的设施越"重"，需要的产能越多 ——
 * 于是"先把经营盘起来"这件事在越大的工程上越要紧。
 */
Stronghold.capacityFor = function (step) {
  if (!step) return 0;
  return Math.max(1, Math.ceil((Number(step.cost) || 0) / 12));
};

Stronghold.maxLevel = function (id) {
  var d = BY_ID[id];
  return d ? d.levels.length : 0;
};
Stronghold.levelOf = function (owned, id) {
  var v = owned ? Number(owned[id]) : 0;
  if (!isFinite(v)) return 0;
  return Math.max(0, Math.min(Stronghold.maxLevel(id), Math.floor(v)));
};

/**
 * 能不能买 / 升级。
 * **前置链**在这里挡住：没满足 `req` 的设施连"买得起"都算不上。
 * 返回的 `locked` 让界面能区分"锁着"和"资源不够"（两种不同的等待）。
 * @param material 材料余额（跨局 wallet，从局内带出来的那一笔）
 * @param core 核心材料余额（缺省 0 = 旧调用点的行为不变；只有要核心的等级才读它）
 * @returns { ok, reason, cost, core, toLevel, locked }
 */
Stronghold.canBuy = function (owned, id, material, core, capacity) {
  var d = BY_ID[id];
  if (!d) return { ok: false, reason: '没有这个设施', cost: 0, core: 0, toLevel: 0, locked: false };
  var cur = Stronghold.levelOf(owned, id);
  if (cur >= d.levels.length) return { ok: false, reason: '已经满级', cost: 0, core: 0, toLevel: cur, locked: false };
  // 前置链：先在"锁"这一层挡住，再谈钱 —— 否则界面会显示"材料不够"，
  // 玩家攒够材料回来还是买不了，那种体验最差。
  var lack = Stronghold.missingReq(owned, id);
  if (lack) {
    return {
      ok: false,
      reason: '需要「' + BY_ID[lack.id].name + '」到 Lv.' + lack.level + '（现在是 Lv.' + Stronghold.levelOf(owned, lack.id) + '）',
      cost: 0, core: 0, toLevel: cur + 1, locked: true
    };
  }
  var step = d.levels[cur];
  var cost = step.cost;
  var needCore = coreCost(step.core);
  if (Math.max(0, Number(material) || 0) < cost) {
    return { ok: false, reason: '材料不够（需要 ' + cost + '）', cost: cost, core: needCore, toLevel: cur + 1, locked: false };
  }
  /* 核心材料单独报缺哪一样：两种资源都不够时说"资源不够"，
     玩家不知道该去打 Boss 还是去多打两把 —— 那是两种完全不同的行动。 */
  if (needCore > 0 && Math.max(0, Number(core) || 0) < needCore) {
    return {
      ok: false, reason: '核心材料不够（需要 ' + needCore + '，只有关底 Boss 掉）',
      cost: cost, core: needCore, toLevel: cur + 1, locked: false
    };
  }
  /* **产能**（M2）：建造子模块花的是**经营自己的钱** ——
     v3 §5.1 说模块代币"产出在本模块、消费在本模块"，而盖设施正是建造子模块。
     放在材料与核心材料之后：先说更容易解决的那一样，玩家才知道该去干什么。 */
  var needCap = Stronghold.capacityFor(step);
  if (needCap > 0 && Math.max(0, Number(capacity) || 0) < needCap) {
    return {
      ok: false, reason: '产能不够（需要 ' + needCap + '，每波由据点运转产出）',
      cost: cost, core: needCore, capacity: needCap, toLevel: cur + 1, locked: false
    };
  }
  return { ok: true, reason: '', cost: cost, core: needCore, capacity: needCap, toLevel: cur + 1, locked: false };
};

/** 这个设施**下一级**要不要核心材料（界面用它标出"这一级要打过 Boss"） */
Stronghold.coreFor = function (owned, id) {
  var d = BY_ID[id];
  if (!d) return 0;
  var cur = Stronghold.levelOf(owned, id);
  if (cur >= d.levels.length) return 0;
  return coreCost(d.levels[cur].core);
};

/** 这个设施还差哪个前置（都满足就返回 null） */
Stronghold.missingReq = function (owned, id) {
  var d = BY_ID[id];
  if (!d || !d.req) return null;
  return Stronghold.levelOf(owned, d.req.id) >= d.req.level ? null : d.req;
};

/** 从零开始要按什么顺序买才能解锁全部设施（前置链的拓扑序；自检用它验无环） */
Stronghold.buildOrder = function () {
  var out = [], done: Record<string, boolean> = Object.create(null), guard = 0;
  while (out.length < LIST.length && guard++ < LIST.length * 2) {
    for (var i = 0; i < LIST.length; i++) {
      var d = LIST[i];
      if (done[d.id]) continue;
      if (!d.req || done[d.req.id]) { done[d.id] = true; out.push(d.id); }
    }
  }
  return out;
};

/** 已投入的总材料（界面显示"沉没成本"用） */
Stronghold.invested = function (owned) {
  var sum = 0;
  for (var id in (owned || {})) {
    if (!Object.prototype.hasOwnProperty.call(owned, id)) continue;
    var d = BY_ID[id];
    if (!d) continue;
    var lvl = Stronghold.levelOf(owned, id);
    for (var i = 0; i < lvl; i++) sum += d.levels[i].cost;
  }
  return sum;
};

/* =========================================================
   4. 折叠：据点 → 一份修正（模拟里只读这一份）
   ========================================================= */
Stronghold.modsFor = function (owned) {
  var m: any = {};
  for (var k in BASE) m[k] = BASE[k];
  for (var id in (owned || {})) {
    if (!Object.prototype.hasOwnProperty.call(owned, id)) continue;
    var d = BY_ID[id];
    if (!d) continue;
    var lvl = Stronghold.levelOf(owned, id);
    for (var i = 0; i < lvl; i++) {
      var e: any = d.levels[i].effect || {};
      for (var key in e) {
        if (!Object.prototype.hasOwnProperty.call(e, key)) continue;
        // 全是加法（没有乘性键）—— 加法的折叠不会因为顺序不同而漂移
        m[key] = m[key] + e[key];
      }
    }
  }
  m.refundFull = m.refundFull ? 1 : 0;
  m.offlineLevel = Math.max(0, Math.min(2, m.offlineLevel));
  m.freeRespecs = Math.max(0, Math.min(4, m.freeRespecs));
  m.capacityBonus = Math.max(0, Math.min(2, m.capacityBonus));
  return m;
};

/** 一行行给人看（界面与 describe 都用它 —— **文案只有一份**） */
Stronghold.effectLines = function (mods) {
  var out = [];
  for (var k in BASE) {
    if (!Object.prototype.hasOwnProperty.call(BASE, k)) continue;
    var v = mods ? mods[k] : 0;
    if (!v) continue;
    var key = MOD_KEYS[k];
    if (key && typeof key.text === 'function') out.push.apply(out, key.text(v));
    else out.push(k + ' +' + v);
  }
  return out;
};
/** 单个键的文案（levels 里"下一级给什么"用） */
Stronghold.effectText = function (k, v) {
  var key = MOD_KEYS[k];
  return (key && typeof key.text === 'function') ? key.text(v) : [k + ' +' + v];
};

Stronghold.describe = function (owned) {
  var lines = ['据点：材料 ' + Stronghold.invested(owned) + ' 已投入'];
  var any = false;
  for (var id in (owned || {})) {
    if (!Object.prototype.hasOwnProperty.call(owned, id)) continue;
    var lvl = Stronghold.levelOf(owned, id);
    if (!lvl) continue;
    any = true;
    lines.push('  ' + BY_ID[id].name + ' Lv.' + lvl + '  ' + BY_ID[id].note);
  }
  if (!any) lines.push('  （空）');
  var m = Stronghold.modsFor(owned);
  var eff = Stronghold.effectLines(m);
  for (var e = 0; e < eff.length; e++) lines.push('  ' + eff[e]);
  return lines.join('\n');
};

/* =========================================================
   5. 自检
   ========================================================= */
Stronghold.audit = function () {
  var problems = [];
  var seen: Record<string, boolean> = Object.create(null);
  for (var i = 0; i < LIST.length; i++) {
    var d = LIST[i];
    if (seen[d.id]) problems.push('设施 id 重复：' + d.id);
    seen[d.id] = true;
    if (!d.name || !d.note) problems.push(d.id + ' 缺名字或说明');
    if (!d.levels || !d.levels.length) { problems.push(d.id + ' 没有等级'); continue; }
    var last = 0, lastCore = 0;
    for (var l = 0; l < d.levels.length; l++) {
      var step = d.levels[l];
      if (!(step.cost > 0)) problems.push(d.id + ' 第 ' + (l + 1) + ' 级没有价格');
      if (step.cost <= last) problems.push(d.id + ' 的价格没有随等级上涨');
      last = step.cost;
      /* 核心材料（`core`）：可选的**第二价**。三条判据都来自它的稀缺度 ——
         它是全游戏最稀的一档（一局最多 3 个，见 `CORE_PER_BOSS`）：
           · 写上了就必须是正整数（0 或负数 = 写错了）
           · 不能超过一局的产出（超过就是"要打两局"，那是拖延不是门槛）
           · 同一设施里必须随等级递增（不递增说明是拍脑袋加的） */
      var c = coreCost(step.core);
      if (step.core !== undefined && c <= 0) problems.push(d.id + ' 第 ' + (l + 1) + ' 级的 core 必须是正整数');
      if (c > 3) problems.push(d.id + ' 第 ' + (l + 1) + ' 级要 ' + c + ' 个核心材料（一局最多 3 个，超过就是拖延）');
      if (c > 0 && c <= lastCore) problems.push(d.id + ' 的核心材料没有随等级上涨');
      if (c > 0) lastCore = c;
      var keys = Object.keys(step.effect || {});
      if (!keys.length) problems.push(d.id + ' 第 ' + (l + 1) + ' 级没有任何效果');
      for (var k = 0; k < keys.length; k++) {
        if (!MOD_KEYS[keys[k]]) problems.push(d.id + ' 用了未声明的修正键：' + keys[k]);
      else if (typeof MOD_KEYS[keys[k]].text !== 'function') {
        problems.push(d.id + ' 的第 ' + (l + 1) + ' 级用了没有文案的键：' + keys[k] + '（界面上会看不见）');
      }
      // 数值型效果必须是"量"而不是 0/1 的开关（除了纯开关型的结构性解锁）
      var v0 = (step.effect as any)[keys[k]];
      if (typeof v0 !== 'number' || !isFinite(v0) || v0 < 0) {
        problems.push(d.id + ' 的第 ' + (l + 1) + ' 级里 ' + keys[k] + ' 不是合法数值：' + v0);
      }
      }
    }
  }
  // 两条循环的连接线必须真的在（否则据点与工坊是两个不相干的系统）
  if (!LIST.some(function (d) { return d.levels.some(function (l) { return l.effect.campSlots; }); })) {
    problems.push('没有任何设施给工坊加产线 —— 据点 → 制造那条边是断的');
  }
  /* "据点 → 产能"这条边必须有设施接着 —— 建造（设施）与经营（产能）是**同一个**
     模块的两个子模块，它们共享代币正是 v3 §三-2 允许的那条路。
     ⚠ 这里原来守的是"据点 → 天赋"，而那是**建造机制承载养成的成长** ——
       正是 §三-2 末尾那句明令禁止的。它已被改指到产能上（见 `Craft.capacityYield`）。 */
  if (!LIST.some(function (d) { return d.levels.some(function (l) { return l.effect.capacityBonus; }); })) {
    problems.push('没有任何设施加产能产出 —— "据点 → 产能"这条边是断的');
  }
  if (!LIST.some(function (d) { return d.levels.some(function (l) { return l.effect.freeRespecs; }); })) {
    problems.push('没有任何设施让养成可以试错（免费洗点）—— 这条边只有"送点"没有"降本"');
  }
  /* **解耦的判据**：据点不许把数字乘到另外两根柱子上。
     写进自检是因为"顺手给个折扣"是最容易复发的那种退化（一行 effect 就能发生），
     而它正是"据点数值穿透"的来源 —— 折扣/倍率/开局免费量都算。 */
  var BLEED = ['rerollDiscount', 'campDiscount', 'sporeMul', 'shopDiscount', 'damage', 'maxHp'];
  for (var bi = 0; bi < BLEED.length; bi++) {
    if (MOD_KEYS[BLEED[bi]]) continue;               // 键已经不存在 = 已经删干净
    if (LIST.some(function (d) { return d.levels.some(function (l) { return l.effect[BLEED[bi]]; }); })) {
      problems.push('据点里出现了跨柱子的数值键：' + BLEED[bi] + '（穿透会从这里长回来）');
    }
  }
  if (!LIST.some(function (d) { return d.levels.length >= 3; })) {
    problems.push('没有任何 3 级设施 —— 据点会显得比工坊还浅（工坊都是 2 级）');
  }
  /* **核心材料必须真的被花掉**。
     这一条是自查时发现的断头路：核心材料能从关底 Boss 赚到、能进档案，
     但全仓没有一处调用 `Profile.spendCore` —— 也就是"打 Boss 拿到核心材料"
     在玩家那一侧是**看得见摸不着**的（数字只涨不花，`economy.ts` 里写的
     `core → 经营` 是一条假边）。现在它至少是**一个**真门槛。 */
  if (!LIST.some(function (d) { return d.levels.some(function (l) { return coreCost(l.core) > 0; }); })) {
    problems.push('据点里没有任何设施要核心材料 —— "战斗 → 经营"这条边在玩家那一侧是断的（赚得到、花不掉）');
  }
  /* 前置链的合法性：
     · 指向的设施必须存在
     · 要求的等级不能超过那个设施的满级（否则这条链永远解不开）
     · **不能有环**（A 要 B、B 要 A = 两个设施永远买不到，而且界面只会说"需要…"）
     · 不能自己要求自己 */
  var cyc = Stronghold.buildOrder();
  if (cyc.length < LIST.length) {
    var unreachable = LIST.filter(function (d) { return cyc.indexOf(d.id) < 0; }).map(function (d) { return d.id; });
    problems.push('前置链有环/解不开：' + unreachable.join(','));
  }
  for (var r = 0; r < LIST.length; r++) {
    var dd = LIST[r];
    if (!dd.req) continue;
    if (!BY_ID[dd.req.id]) { problems.push(dd.id + ' 的前置不是真实设施：' + dd.req.id); continue; }
    if (dd.req.id === dd.id) problems.push(dd.id + ' 要求自己 —— 永远买不到');
    if (!(dd.req.level >= 1)) problems.push(dd.id + ' 的前置等级不合法：' + dd.req.level);
    if (dd.req.level > BY_ID[dd.req.id].levels.length) {
      problems.push(dd.id + ' 要求「' + BY_ID[dd.req.id].name + '」Lv.' + dd.req.level +
        '，但它只有 ' + BY_ID[dd.req.id].levels.length + ' 级（这条链永远解不开）');
    }
  }
  if (!LIST.some(function (d) { return d.req; })) {
    problems.push('一个前置都没有 —— 据点会退化成"按价格从低到高买"的清单');
  }
  return {
    ok: problems.length === 0, problems: problems,
    counts: {
      facilities: LIST.length,
      maxLevel: Math.max.apply(null, LIST.map(function (d) { return d.levels.length; })),
      withReq: LIST.filter(function (d) { return d.req; }).length
    }
  };
};

SelfCheck.register('Stronghold', Stronghold.audit);

/* =========================================================
   6. 登记进扩展点总账
   ========================================================= */
Registry.family('keepFacility', {
  note: '跨局据点设施（花材料 —— conomy.ts 的 bridge 档，只供经营）', owner: 'stronghold.ts',
  entries: function () {
    return LIST.map(function (d) { return { id: d.id, refs: [] }; });
  }
});
Registry.family('keepMod', {
  note: '据点修正键（声明了却没人读 = 这条效果是假的）', owner: 'stronghold.ts',
  values: function () { return Object.keys(BASE); }
});

export { Stronghold };
