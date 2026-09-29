/* =========================================================
   tutorial.ts — 首局引导（**上下文提示**，不是一页说明书）
   ---------------------------------------------------------
   改造前：上手只有一张静态的「操作说明」页（`scr-howto`）。
   玩家在真正需要提示的那一刻（第一波不知道要动、第一次进商店不知道能买、
   血少了不知道会掉什么）**什么都看不到**，而说明书早被关掉了。

   这一版的形状与其它系统一致：**一张声明表 + 一个"什么时候说"的判据**。
     · 每条提示：id / when（触发时机）/ text（中文原文，同时是 i18n 的键）
     · `when` 是**声明式的条件名**，不是回调 —— 于是"有哪些触发时机"
       可以静态列出来，体检能一条条数（回调式的话就只能靠读代码）

   三条纪律：
     1. **一条只说一次**（`seen` 里记着；重复弹同一句等于没有提示）
     2. **首局才说**（`runsSeen`，`Profile` 的累计局数）——
        老玩家不该被新手提示糊脸；但 `--force` 可以在设置里重看
     3. **提示不是阻挡**：它只是一条飘字，不暂停、不抢焦点、不挡按钮

   ⚠ 与 `UI.toast` 的分工：toast 是"刚才发生了什么"（事件回执），
   tutorial 是"你现在该知道什么"（一次性知识）。两者都用飘字，
   但**判据完全不同** —— 所以是两个系统，不是同一个的两种用法。
   ========================================================= */
import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';

var Tutorial = {} as TutorialApi;

/* =========================================================
   1. 声明表（加一条提示 = 加一行 + 一个 when 名字）
   ========================================================= */
/** 触发时机：名字是**给人和体检看的**，实现里按它分发 */
var WHEN = {
  'run-start': '一局刚开始（第一次能动的时候）',
  'first-wave-cleared': '第一次清完一间（要进商店了）',
  'first-shop': '第一次站在商店里',
  'first-levelup': '第一次升级选卡',
  'low-hp': '第一次掉到半血以下',
  'first-boss': '第一次遇到关底 Boss',
  'first-craft': '第一次打开工坊（能造东西了）',
  'first-meta': '第一次回到枢纽（局外）'
};

var LIST: TutorialHintDef[] = [
  {
    id: 'move', when: 'run-start',
    text: 'WASD 移动 —— 武器会自己开火，你只管走位',
    note: '第一条必须回答"我该按什么"，否则玩家会在原地等'
  },
  {
    id: 'shop', when: 'first-shop',
    text: '这里是商店：花废料买武器与道具。同名同档的两把可以合并成高一档',
    note: '"合并"是本作最容易漏掉的机制，而它是成长的第二条轴'
  },
  {
    id: 'doors', when: 'first-wave-cleared',
    text: '清完一间就能选下一扇门 —— 门上的图标告诉你会遇到什么',
    note: '房间制之下"选哪扇门"是每回合的主决策'
  },
  {
    id: 'levelup', when: 'first-levelup',
    text: '升级了：四张卡挑一张。带「防」字的是防御向，等级越高越常出现',
    note: '升级池的权重随等级变化（`player.cardPool`），说清楚它才不是玄学'
  },
  {
    id: 'lowhp', when: 'low-hp',
    text: '血量过半了 —— 血到 0 就是这一局结束，但打到的材料会带出局（那是经营的本钱）',
    note: '同时给出"失败也有产出"这条安全感，否则玩家不敢冒险'
  },
  {
    id: 'boss', when: 'first-boss',
    text: '关底 Boss：打倒它掉**核心材料** —— 局外的据点与图纸都要它',
    note: '把"为什么值得打 Boss"与三模块循环接上'
  },
  {
    id: 'craft', when: 'first-craft',
    text: '工坊能自己造：花废料 + 占一条产线。设施位与产线是可以经营的',
    note: '把局内营地（经营）的存在告诉玩家'
  },
  {
    id: 'meta', when: 'first-meta',
    text: '这里是枢纽：据点是经营（产能与容量），天赋是养成（永久成长）',
    note: '局外两块的名字必须在这里出现，否则玩家永远找不到它们'
  }
];

var BY_ID: Record<string, TutorialHintDef> = Object.create(null);
for (var i = 0; i < LIST.length; i++) BY_ID[LIST[i].id] = LIST[i];

/* =========================================================
   2. 状态（**可变**：`test/persist.mjs` 的 ALLOWED 里登记着）
   ---------------------------------------------------------
   `seen` 记"这条说过了没有"。它落盘在**账号档案**里（`Profile` 的
   `tutorialSeen`）—— 于是换设备/换槽位之后提示行为跟着那一份档走，
   而不是"每开一次浏览器就重新新手一次"。这里只缓存一份内存副本。
   ========================================================= */
var seen: Record<string, boolean> = Object.create(null);
var enabled = true;

Tutorial.LIST = LIST;
Tutorial.BY_ID = BY_ID;
Tutorial.WHEN = WHEN;
Tutorial.whenNames = function () { return Object.keys(WHEN); };

/** 载入"已经说过的"（由 `Profile` 在 load 之后灌进来） */
Tutorial.hydrate = function (record) {
  seen = Object.create(null);
  if (record && typeof record === 'object') {
    for (var k in record) if (record[k] === true) seen[k] = true;
  }
  return Tutorial.seenCount();
};
/** 导出成可落盘的形状（只有 true 的那些） */
Tutorial.snapshot = function () {
  var out: Record<string, boolean> = Object.create(null);
  for (var k in seen) if (seen[k]) out[k] = true;
  return out;
};
Tutorial.seenCount = function () { return Object.keys(seen).length; };
Tutorial.isSeen = function (id) { return seen[id] === true; };
/** 开关（设置里那一项；关掉之后**不弹**但也不清记录） */
Tutorial.setEnabled = function (on) { enabled = !!on; return enabled; };
Tutorial.enabled = function () { return enabled; };
/** 仅供设置页：把"说过的"清空，于是提示会再出现一遍 */
Tutorial.forget = function () { seen = Object.create(null); return true; };

/**
 * 问一次"这个时机该不该说点什么"。
 * @param when 时机名（必须在 `WHEN` 里）
 * @param opts.force 无视"说过了"与开关（设置页"再看一遍引导"用）
 * @returns 该说的那些（**一次可以有多条**，但同一时机通常只有一条）
 *
 * ⚠ 这个函数**不改状态**：它只回答"该不该说"，标记由 `mark` 显式做。
 * 为什么分开：调用点可能是"每帧问一次"（比如低血那一类），
 * 如果它顺手就把 seen 标了，那么"还没来得及显示 toast"的情况会丢提示。
 */
Tutorial.pending = function (when, opts) {
  var o = opts || {};
  var out: TutorialHintDef[] = [];
  for (var i = 0; i < LIST.length; i++) {
    var d = LIST[i];
    if (d.when !== when) continue;
    if (!o.force && (!enabled || seen[d.id])) continue;
    out.push(d);
  }
  return out;
};
/** 标记"说过了"（返回是否真的从"没说"变成"说了"） */
Tutorial.mark = function (id) {
  if (!BY_ID[id] || seen[id]) return false;
  seen[id] = true;
  /* 落盘**不做在这里**：`tutorial.ts` 不认识账号档案（那是 profile 的字段）。
     它只发一个"记录变了"的通知，由 profile 自己订阅并保存 ——
     与 `Storage.onWipe` 同一个形状：谁持有数据谁负责存。
     ⚠ 不保存的后果很具体：玩家看完提示、关掉游戏，下次进来又被同一句糊一次。 */
  Tutorial.emitChanged();
  return true;
};

/* ---------------- 记录变更通知（谁负责落盘谁订阅） ---------------- */
var changedListeners: Array<() => void> = [];
Tutorial.onChanged = function (fn) {
  changedListeners.push(fn);
  return function () { var i = changedListeners.indexOf(fn); if (i >= 0) changedListeners.splice(i, 1); };
};
Tutorial.emitChanged = function () {
  for (var i = 0; i < changedListeners.length; i++) {
    try { changedListeners[i](); } catch (e) { /* 一个订阅者抛错不影响别的 */ }
  }
};

/* =========================================================
   3. 定义期自检
   ========================================================= */
Tutorial.audit = function () {
  var problems: string[] = [];
  var ids: Record<string, boolean> = Object.create(null);
  var perWhen: Record<string, number> = Object.create(null);
  for (var i = 0; i < LIST.length; i++) {
    var d = LIST[i];
    if (!d.id) problems.push('第 ' + i + ' 条提示没有 id');
    if (ids[d.id]) problems.push('提示 id 重复：' + d.id);
    ids[d.id] = true;
    if (!WHEN[d.when]) problems.push(d.id + ' 的时机没登记：' + d.when);
    else perWhen[d.when] = (perWhen[d.when] || 0) + 1;
    if (!d.text) problems.push(d.id + ' 没有文案（它是 i18n 的键，不能空）');
    if (!d.note) problems.push(d.id + ' 没有 note —— 说不出"为什么要有这条提示"的提示不该存在');
    /* 文案**必须**进 i18n 表：否则切到英文之后这几句会一直是中文。
       ⚠ 这里**必须先问"那个家族在不在"**，不能直接 `Registry.ids('messageKey')` ——
       它是**跨模块**检查，而 `i18n.ts` 只被 `main.ts` / `ui.ts` 认识。
       在无头入口（`cli.ts`、测试、任何只加载模拟层的场景）里 i18n 可能根本没被加载，
       于是这一句会抛"未注册的家族"，把整个模块的加载打断 ——
       而这个错误的**表现**是"加载失败"，与"文案没进表"完全无关，极难定位。
       这与 `SelfCheck.scan({registry:'partial'})` 是同一条纪律：
       **目标家族不在场时不代表写错了，只代表那个模块没被加载**。
       在浏览器里 i18n 一定在（main.ts 先加载它），所以这条检查照样生效。 */
    if (d.text && Registry.has('messageKey') &&
      !Registry.ids('messageKey').some(function (k) { return k === d.text; })) {
      problems.push(d.id + ' 的文案不在 i18n 表里（切英文之后它会一直是中文）');
    }
  }
  /* 每个时机至少一条：声明了时机却没人用 = 那条时机是装饰 */
  var whens = Object.keys(WHEN);
  for (var j = 0; j < whens.length; j++) {
    if (!perWhen[whens[j]]) problems.push('时机「' + WHEN[whens[j]] + '」没有任何提示用它');
  }
  return { ok: problems.length === 0, problems: problems, counts: { hints: LIST.length, whens: whens.length } };
};

/* 这里**故意不在加载期跑一遍**（其它表模块大多会跑）。
   理由与上面那条 `Registry.has` 是同一个：这一份 audit 里有一条**跨模块**检查
   （"文案必须进 i18n 表"），它要求 `i18n` 已经加载 —— 而"谁先加载"对
   本模块是**不可控**的（`i18n.ts` 只被 main / ui 认识，不在模拟层的依赖图里）。
   在加载期跑就等于把"模块求值顺序"变成一条隐式契约：顺序对了没事，
   顺序变了就报一个**看起来毫不相关**的错（实测就是这样，见上面那段注释）。

   `SelfCheck.register` 才是它该待的地方：那条路在**两个入口的启动期**都会走
   （`main.ts` 的 boot 与 `cli.ts`），而那时 i18n 一定已经在场。
   `test/tutorial.mjs` 也会显式调它。 */
SelfCheck.register('Tutorial', Tutorial.audit);

/* =========================================================
   4. 登记进扩展点总账
   ========================================================= */
Registry.family('tutorialHint', {
  note: '首局上下文提示（一条只说一次；时机是声明式的，所以能被一条条数出来）',
  owner: 'tutorial.ts',
  values: function () { return LIST.map(function (d) { return d.id; }); }
});

export { Tutorial };
