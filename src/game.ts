/* =========================================================
game.ts — 模拟层（纯逻辑，无 DOM / 无 canvas）
浏览器与 Node 无头测试共用同一份代码
========================================================= */

import { AI } from './ai.ts';
import { Affixes } from './affixes.ts';
import { Registry } from './registry.ts';
import { Arena } from './arena.ts';
import { Boons } from './boons.ts';
import { Comp } from './comp.ts';
import { Containers } from './containers.ts';
/* **存档角色**（R50）：`Game.character/saveCharacter/setCharacterMeta/renderLookOf`
   转发给档案层 —— 外观的唯一分派处是 `character.ts` + `appearance.ts`。 */
import { Character } from './character.ts';
import { Chars } from './data_chars.ts';
import { Elems } from './data_elems.ts';
import { Items } from './data_items.ts';
import { Tiers } from './data_tiers.ts';
import { Weapons } from './data_weapons.ts';
import { Col } from './collide.ts';
import { Danger } from './danger.ts';
import { Dialogue } from './dialogue.ts';
import { Dungeon } from './dungeon.ts';
import { Emit } from './emit.ts';
import { Enemies } from './enemies.ts';
import { Fold } from './fold.ts';
import { Forge } from './forge.ts';
/* 大厅 / 枢纽那两间**能走的房**：墙、站点、出生点与碰撞都在那边，
   这里只管"人在这间房里走到哪了"（见文件里的 `stepHall`）。 */
import { Hall } from './hall.ts';
import { makeChamber } from './chamber.ts';
import { makeGrid } from './grid.ts';
import { makeImpact } from './impact.ts';
/* 世界系统：坐标契约 / 区域尺寸 / 网格表 —— 会话里的空间参数从这里读 */
import { World } from './world.ts';
import { Bronana } from './bronana.ts';
import { Camp } from './camp.ts';
/* 养成模块的第一个局内行动（训练：花全局货币换养成代币）—— 见 M3 的说明。 */
import { Train } from './training.ts';
/* **模块代币之间的兑换**（v3 §5.3 + §7-12，M5）：表在那边，钱在这边。 */
import { Exchange } from './exchange.ts';
/* **软引导**（v3 §8-15）：规则在那边，状态在这边折。 */
import { Guide } from './guide.ts';
/* 兑换的**判定**在机制层（那四条限制的审计也在那里）—— 这里只改状态。 */
import { Ledger } from './ledger.ts';
/* 天赋的规则全在 `talents.ts`（纯函数收 state）；这里只用它的判定与折叠。 */
import { Talent } from './talents.ts';
/* NPC 关系状态（v3 §8-3 的「共享关系状态」）：叙事与养成**都读它** —— 见 `bonds.ts`。 */
import { Bonds } from './bonds.ts';
import { Craft } from './craft.ts';
import { Market } from './market.ts';
import { Pool } from './levelup.ts';
import { Profile } from './profile.ts';
import { RunSave } from './run_save.ts';
import { Skills } from './skills.ts';
import { Stats } from './stats.ts';
import { Synergy } from './synergy.ts';
import { Stronghold } from './stronghold.ts';
import { Curves } from './curves.ts';
import { PAL, U } from './utils.ts';

/* 精英三段倍率：**值住在 `curves.ts` 的 `elite.*`**（那张表里能一次看到
   "精英一共改了哪几个量"）。这里保留常量名，是因为它们在 `spawnEnemy` 里
   是循环外的固定值 —— 每只怪都去查一次表纯属浪费。
   `Curves.audit()` 保证表里的值与改造前的 `3.2 / 1.35 / 1.12` 逐位相同。 */
var ELITE_HP = Curves.at('elite.hp', 1), ELITE_DMG = Curves.at('elite.dmg', 1), ELITE_SPEED = Curves.at('elite.speed', 1);
/* 每次升级抽几张卡：值住在 `curves.ts` 的 `player.cardGain`（那条曲线的形状是
   `exponential {a:1, r:1}` = 恒为 1 的常数），这里读一次并缓存。
   **为什么必须从表里读而不是再写一个 4**：`player.cardGain` 的注释写着
   "玩家每级长多少的一半答案在它这里" —— 如果运行时另有一个常数，
   那张表就成了第二个出处，改表不会有任何效果。`Curves.at` 在模块加载时调一次，
   与 `ELITE_*` 同一处理，不影响主循环。 */
var LEVELUP_CARDS = 4 * Curves.at('player.cardGain', 1);
/* **每个 Boss 给几笔核心材料**（`economy.ts` 的 `meta-rare` 那一档：每局 1~5 笔）。
   一层一只 Boss、一局三层 —— 所以一局满打满算 3 笔，而经营与养成**都要花它**。
   为什么是常数而不是曲线：这一档的设计意图就是"每局只有几笔"，
   让它随深度成长会把它推回 bridge 那一档（孢子已经在做那件事了）。 */
var CORE_PER_BOSS = 1;

/** 武器挂点的复用坐标（fire 里同步用完即弃，不产生每帧分配） */
var _seat = { x: 0, y: 0 };

var Game = ({
  state: 'title',       // title | chars | playing | levelup | shop | paused | howto | end
  time: 0,
  speed: 1,
  wave: 0,
  events: U.Bus(),
  toast: null,
  cfg: {
    maxWeapons: 6,
    /* ---- 房间时限（秒）----
       房间制之后这个数字的含义**变了**：以前是"这一波要撑多久"，
       现在是"这一间要在多久内打完"。所以它是一条**紧箍**而不是耐力条：
       越晚的房间怪越多（预算按 Enemies.step 拉长），时限跟着放宽，但封在 45 秒
       （旧设计封在 60 秒且是"必须撑满"，现在封在 45 秒且"越快越好"）。
       超过时限：场上剩下的怪狂暴 + 这一间的奖励打折（见 overrun/endWave）。 */
    waveTime: function (w) { return Math.min(45, 13 + 1.7 * (Enemies.equivWave(w) - 1)); },
    /** 时限内清完的奖励倍率 / 超时的惩罚倍率（差 1.5 倍，是"效率"这个玩点的份量） */
    clearBonus: 1.2,
    overrunBonus: 0.8,
    /** 打完 Boss 给下一层挑几条契约（抽签候选数） */
    boonChoices: 2,
    /** 超时后场上剩下的怪（一次性）：移速 / 伤害倍率 */
    overrun: { speed: 1.25, dmg: 1.15 },
    enemyCap: 300,
    decalCap: 90,          // 血迹环形缓冲容量
    stainPerSec: 8,        // 命中溅血每秒预算
    stainBurst: 8,         // 预算上限（攒着不用也不会爆）

    /* ---- 命中定帧（hit-stop）----
       打在**精英与 Boss**身上时，让怪与玩家一起冻住 `elite` 个逻辑帧。
       这是"打击感"配方里最有效的一条（比加粒子便宜得多，也比加音效有效）。

       ⚠ 为什么默认 **0（关）**：它会改变**模拟时序**（怪物少走几步），
       所以默认打开就会改行为指纹 —— 而"纯重构必须逐位不变"是本项目的纪律。
       做成可调项之后两边都成立：
         · 玩家可以在设置里打开（默认档 `medium`），那是**有意改行为**
         · 默认档下所有既有测试与指纹逐位不变
       这不是"没做完"，这是"会改手感的东西必须显式选择"。

       ⚠ 实现方式是**缩短这一步的 dt**，不是"暂停引擎"：
       跳过整个 `step()` 会让子弹/计时器/波次一起停，而这时玩家已经看到
       命中了（枪口火光都画出来了）——那种"整体卡住"不是打击感，是掉帧。
       只让**位移**变慢才是。 */
    hitStop: { off: 0, light: 2, medium: 4, heavy: 7 },
    /* 定帧期间位移保留几成。**0.02 是"近乎冻住"而不是"慢下来"** ——
       定帧要的是"世界被砸得顿了一下"，所以位移必须几乎停住；
       留一点（而不是 0）是为了不让物理积分彻底停摆（速度不清零，
       顿帧结束后立刻恢复原速，不会有一段"重新加速"的滞涩感）。
       第一版用的是 0.15，实测 30 帧里只少走了 11% —— 那根本看不出来，
       而"参数写进去了但看不出效果"正是这一轮要消灭的那类问题。 */
    hitStopScale: 0.02,

    /* ---- 战斗模式 ----
       `auto`   = 现在的玩法：武器自动找最近的敌人开火，技能冷却好了自动放。
       `manual` = 普通攻击与技能都由玩家操作（鼠标/右摇杆瞄准，左键/扳机开火，
                  数字键/肩键放技能）。
       为什么默认 `auto`：行为指纹跑的就是它，而且它是这个项目原来的手感 ——
       换默认值等于把所有既有测试的基线全部作废。模式是**设置项**，
       玩家随时可以切（见 settings.ts 的 combatMode）。 */
    combatMode: 'auto',

    /* ---- 帧模型：逻辑帧 / 物理帧的固定步长 ----
       模拟层只认这一份 dt。main.ts 用它做累积器，测试也用它的整数倍步进，
       所以"逻辑帧多长"不会在两个地方各写一遍（改造前 main.ts 写 1/60、
       8 个测试各自写 1/60，改一次要动 9 处）。 */
    fixedDt: 1 / 60,
    maxSteps: 6,           // 一次渲染最多补几步（超过就丢弃积压，避免雪崩）
    maxFrameDt: 0.25       // 单帧 dt 上限（切后台回来不跳帧）
  }
} as unknown as GameApi);

/* 当前激活的会话（无则 null）。
   ---------------------------------------------------------
   这一行以前是 `var S = null` —— 于是 `S` 是**隐式 any**：
   这个 3100 行的模拟内核里，所有 `S.xxx` 的读取都不受 TypeScript 检查。
   实测的代价是真金白银的：`S.fmods.bonusTier`（图纸改版时删掉的键）一直
   静默读到 undefined、恒等于 0，而 `tsc` 全绿 —— 这类 bug 不会崩，只会让代码说谎。

   现在写成 `Session` 却不带 null 检查：**先要字段检查，再谈 null 安全**。
   两个理由：
     · 代码里已经到处是 `if (!S) return` 前置守卫，null 检查是第二层收益；
     · `S = { ... }` 那个字面量现在会被编译器照着 `Session` 逐个核对 ——
       分组声明与真实字段第一次由编译器而不是由测试来对账。
   代价写在明面上：`null as unknown as Session` 是一次**有意为之的类型谎**，
   所以它必须配一条测试（`test/persist.mjs [2b-2]`：game.ts 读的每个 `S.字段`
   都必须在 7 个分组里声明过）—— 谎言的护栏不能只是注释。 */
var S: Session = null as unknown as Session;

/* 玩家现在在哪间**能走的屋子**里走到哪了（大厅 / 枢纽）。
   ---------------------------------------------------------
   它**不在 `Session` 里**（理由见 types.d.ts 的 HallState 注）：屋子里的
   位置不影响任何玩法数值，也不进存档 —— 回到哪一屏就站在哪个门口，
   这件事由 `hall.ts` 的 `spawnAt` 表达。放在会话之外还有一个好处：
   换局（newRun）不用记得清掉它，`setState` 离开屋子时会自己丢。 */
var hallRoom: HallState | null = null;

/* =========================================================
   拆出去的两块：**房间层**（`chamber.ts`）与**空间网格**（`grid.ts`）
   ---------------------------------------------------------
   它们原先就住在这个文件里。拆的判据不是"短一点好看"，而是这两块
   **各自能一句话说清自己管什么**（房间层：玩家在这一层走到哪了；
   网格：圈里有谁），而且它们的依赖是**会话数据**而不是这个文件里的逻辑。

   为什么是 `make(ctx)` 注入而不是让它们 import 本文件：
   反过来依赖会让分层表把边算成"房间层/网格依赖模拟内核"，
   而它们其实只依赖会话数据与少数几个回调。注入之后依赖是单向的
   （本文件 → 它们），两边都不认识对方的名字。

   ⚠ `session` 传的是**函数**而不是 `S` 本身 —— 换局时 `S` 是整体替换的，
   存一个快照就会对着上一局的敌人/地图做查询（而且不报错，只是行为诡异）。
   ⚠ 这两行必须在**任何调用点之前**求值：`Ch` / `Grid` 是 `var` 声明的对象，
   在被赋值前调用它们的成员会抛 `undefined is not a function`。
   放在 `S` 之后（`S` 也必须在它们之前声明）是有意的顺序，别随手挪走。
   ========================================================= */
var Grid: GridApi = makeGrid({ session: function () { return S; } });
var Imp: ImpactApi = makeImpact({
  session: function () { return S; },
  /* `decalCap` 住在 `Game.cfg`（配置在模拟层的门口）—— 用**函数**现取，
     因为 `Game.cfg` 是可配置的，而模块加载时它可能还没被 `main.ts` 写好。 */
  decalCap: function () { return Game.cfg.decalCap; },
  onShake: function (amount) { Game.events.emit('shake', amount); }
});
var Ch: ChamberApi = makeChamber({
  session: function () { return S; },
  wallBreakFx: function (x, y) { Emit.wallBreak(x, y); },
  wallBreakSfx: function () { sfx('explode'); },
  onWallBreak: function (from, to, secret) {
    Game.events.emit('wallBreak', { from: from, to: to, secret: secret });
  },
  onFloorEnter: function (floor, theme, name) {
    Game.events.emit('floorEnter', { floor: floor, theme: theme, name: name });
  }
});

/* =========================================================
   状态机
   以前 state 是裸字符串，15 处写入散在 4 个文件里，没有任何校验。
   实测后果：
     · 非商店状态调用 nextWave() 会**直接跳掉一整波**（"下一波"连点两次就中招）
     · 非商店状态调用 buyOffer() 能买走商店货（残留点击）
     · UI.refresh() 缺 howto 分支 → 帮助浮层消失但游戏没恢复
   现在：合法转换写在表里，所有写入走 setState，UI 由 stateChange 事件驱动。
   ========================================================= */
Game.STATES = ['title', 'slots', 'chars', 'create', 'station', 'playing', 'levelup', 'shop', 'camp', 'paused', 'howto', 'settings', 'records', 'codex', 'talents', 'skills', 'keep', 'hub', 'end'];

Game.TRANSITIONS = {
  /* ⚠ 标题页 / 选人页**没有** `hub`：枢纽是局内的一间（见下面 hub 那一档），
     局外菜单不摆局内的门 —— 它的入口在大厅与暂停里。
     ⚠ 「开始游戏」落的是 **`slots`（选存档）**，不是选人页（R50）：
     用户的流程原话是「点击开始游戏按钮，**选择存档**，进入游戏，第一个到的是大厅」。 */
  title: ['slots', 'chars', 'howto', 'settings', 'records', 'codex', 'talents', 'keep'],
  /* 选存档（R50）：三张档位卡。
       · 这个档**有人** → 「继续」直接进大厅（`station`）
       · 这个档**没人** → 「开始新档」去选职业（`chars`），再捏人（`create`）
     ⚠ 两条路都不经过 `playing`：进对局只有 `newRun` 一条路（它先建好会话再切状态），
       直接从这一屏切 `playing` 会出现"playing 但没有会话"，模拟层访问 S 直接崩。 */
  slots: ['title', 'chars', 'create', 'station', 'howto', 'settings', 'records', 'codex'],
  // 注意：chars 不能直接进 playing —— 那样会出现"playing 但没有会话"的状态，
  // 模拟层访问 S 会直接崩。进入对局必须走 newRun（它用 force 建好会话再切状态）。
  chars: ['title', 'slots', 'create', 'howto', 'settings', 'records', 'codex', 'talents', 'keep'],
  /* 捏人（R50）：名字 / 外观 / 初始职业 / 入门三选。
     出去只有两条正经路 —— 回选存档（换一个档）、或者确定出发（`station`）。 */
  create: ['title', 'slots', 'chars', 'station', 'howto', 'settings'],
  /* ⚠ `station`（大厅）也在出边里：它是**局内**的一屏，走的是"暂停 → 回大厅"。
     少了这条边，`UI.startRun` 里那句 `setState('station')` 会被状态机**直接拒绝** ——
     表现是"点了出发，游戏开局了，但界面还停在选人页"。 */
  playing: ['levelup', 'shop', 'paused', 'howto', 'title', 'end', 'station'],
  levelup: ['playing', 'paused', 'shop', 'end'],
  // 营地是商店旁边的一个可选去处（不是必经）：自动化跑局不会进它，
  // 所以行为指纹不受影响 —— 这也是把它做成"可选"而不是"必经一步"的原因之一。
  shop: ['playing', 'camp', 'paused', 'levelup', 'end'],
  camp: ['shop', 'playing', 'paused', 'end'],
  /* ⚠ 大厅（`station`）是**局内**的：从战斗回大厅是**走回去**（暂停菜单里那条路），
     不是"退出到主菜单"。所以进来的边挂在 `paused` 上，而不是 `chars` 上。 */
  paused: ['playing', 'levelup', 'shop', 'camp', 'title', 'howto', 'settings', 'records', 'codex', 'talents', 'keep', 'hub', 'end', 'station'],
  // howto / settings / records / codex / talents 是"可返回覆盖层"：出边必须**包含全部可能的来处**，
  // 因为返回就是沿来处那条边回去（缺一条边 = 从那里进来就退不回去）。
  // 覆盖层之间**互不相通**：允许 A→B 就会出现"A 的来处被 B 改写"，
  // 于是 A⇄B 来回弹、永远回不到真正的那一屏。
  howto: ['title', 'slots', 'chars', 'create', 'playing', 'paused', 'shop', 'levelup', 'hub'],
  settings: ['title', 'slots', 'chars', 'create', 'paused', 'hub'],
  records: ['title', 'slots', 'chars', 'paused', 'end', 'hub'],
  codex: ['title', 'slots', 'chars', 'paused', 'end', 'hub'],
  talents: ['title', 'slots', 'chars', 'paused', 'hub', 'skills', 'station'],
  /* 技能构筑与天赋是**并列的两个可返回覆盖层**（可以互相跳），
     所以两者的出边都包含对方 —— 缺一条就是「从这里进去退不回来」。 */
  skills: ['title', 'chars', 'paused', 'hub', 'talents', 'station'],
  keep: ['title', 'chars', 'paused', 'hub', 'station'],
  /* 大厅（站）：每一次开局的起点。三道门都**常开**（`station.ts` 的表 + 自检守着），
     所以这里的出边与门一一对应：出击 → 回到这一局（`playing`）、
     经营 → `keep`、养成 → `talents`。`hub` 是"回家里看看"（枢纽也是**局内**的一间，
     见下面那一档）。`title` 是"放下这一局回标题"
     （档案里那一局的自动存档还在「继续上一局」下面）。
     ⚠ **不许**有 `chars`：从大厅回选人 = 开新局，那条路只有 `newRun` 一条
     （与 `chars → playing` 被拒同一个理由 —— 会话必须先存在）。 */
  station: ['playing', 'keep', 'talents', 'skills', 'title', 'hub', 'paused'],
  /* 枢纽（N2）：**这一局的"家"**（NPC 对话推进剧情；不推进模拟）。
     ⚠ 它归**局内**（2026-09 用户拍板）：不是"局与局之间的地方"，也不该出现在
     局外菜单里 —— 标题页 / 选人页那一对入口已经删掉，连"有人想说新话"的角标
     都搬到了大厅的「枢纽」上。进来的边是**大厅 / 暂停**（都在这局里），
     出去按原路走回去：否则"暂停 → 枢纽"会变成一次性丢掉这一局
     （存档点还在，但手里的局没了）。`title` 只当兜底出口 —— 与大厅的
     "回标题"同一条纪律：放下这一局。 */
  hub: ['title', 'paused', 'station', 'howto', 'settings', 'records', 'codex', 'talents', 'keep'],
  end: ['chars', 'title', 'slots', 'records', 'codex', 'hub']
};

/** 可返回覆盖层：进入时记住来处，退出时沿那条边走回去 */
var RETURN_STATES: Record<string, boolean> = {
  howto: true, settings: true, records: true, codex: true, talents: true, keep: true
};
/** 真实的对局状态（不是覆盖层） */
var RUN_STATES: Record<string, boolean> = { playing: true, levelup: true, shop: true };
Game._returnFrom = Object.create(null);

/**
 * 覆盖层的返回目标。来处必须**仍然可达**（状态机里真有这条边），
 * 否则退回 title —— 而不是发一个必被拒绝的转换、让按钮看起来没反应。
 */
Game.returnFrom = function (state) {
  var back = Game._returnFrom[state];
  var allow = Game.TRANSITIONS[state] || [];
  if (!back || back === state || allow.indexOf(back) < 0) return 'title';
  return back;
};

/** 该转换是否被允许（同状态视为幂等，算允许） */
Game.canSetState = function (to) {
  if (to === Game.state) return true;
  var allow = Game.TRANSITIONS[Game.state];
  return !!allow && allow.indexOf(to) >= 0;
};

/**
 * 唯一的状态入口。
 * 非法转换被拒绝并发 'stateDenied'（不抛异常：一次残留点击不该让游戏崩）。
 * force=true 供开发/测试强制跳转。
 */
Game.setState = function (to, force) {
  if (to === Game.state) return true;
  if (!force && !Game.canSetState(to)) {
    Game.events.emit('stateDenied', { from: Game.state, to: to });
    return false;
  }
  var from = Game.state;
  // 暂停的"来处"只记**真实对局状态**：从帮助/设置/战绩退回暂停时不能覆盖它，
  // 否则再点"继续"会被送回那个覆盖层（实测：暂停 → 设置 → 返回 → 继续 = 又进了设置）。
  // 覆盖层同样记住来处，但只记真实屏幕，免得两个覆盖层互相改写、来回弹。
  /* 大厅 / 枢纽也是"真实屏幕"：从屋里暂停，继续时要回到屋里那一张
     （不然在枢纽里按 Esc 再继续会被送回上一次的战斗）。 */
  if (to === 'paused') {
    if (RUN_STATES[from] || from === 'station' || from === 'hub' || !Game._pauseFrom) {
      Game._pauseFrom = from;
    }
  }
  else if (to === 'hub') { Game._hubFrom = from; }
  else if (RETURN_STATES[to]) { if (!RETURN_STATES[from]) Game._returnFrom[to] = from; }
  Game.state = to;
  /* ---- 屋里进屋 / 出屋 ----
     进屋：按 `spawnAt` 站在"从哪来"的那扇门口（第一次进用默认出生点）。
     出屋：把这份走到哪了丢掉 —— 下次进来会按新的来处重新落点。 */
  if (to === 'station' || to === 'hub') enterHall(to, from);
  else if (hallRoom) hallRoom = null;
  Game.events.emit('stateChange', { from: from, to: to });
  return true;
};

/** 动作入口前置校验：不在指定状态就拒绝（并给出提示） */
function requireState(s, what) {
  return requireStateIn([s], what);
}

/**
 * 同上，但允许一组状态。
 * 营地是"从商店过去的一个可选去处"，所以"下一波"在商店与**营地**里都该能用
 * （只认 shop 的话，玩家在营地按下"下一波"会被告知"当前不在商店界面"）。
 */
var STATE_LABEL: Record<string, string> = {
  shop: '商店', camp: '营地', levelup: '升级', playing: '战斗中', chars: '选人',
  station: '大厅', end: '结算'
};
function requireStateIn(list, what) {
  if (list.indexOf(Game.state) >= 0) return true;
  Game.events.emit('stateDenied', { from: Game.state, to: list[0], action: what });
  Game.events.emit('deny', '当前不在' + (STATE_LABEL[list[0]] || list[0]) + '界面');
  return false;
}

/* =========================================================
   会话创建
   ========================================================= */
/* =========================================================
   技能构筑 → 技能槽（**唯一把 fold 变成运行时状态的地方**）
   ---------------------------------------------------------
   为什么技能是"开局折一次"而不是每帧问表：
     · 折一次之后模拟层只读一份纯数据（与据点/图纸/难度同一套路），
       于是战斗中没有任何一处需要认识 `skills.ts`
     · 每帧问表的代价不是性能，而是**读点散开**：那时"这个技能现在是什么参数"
       会有好几个答案（表里的、符文改过的、某个道具再改过的）

   读档时用的是**存档里那一刻的构筑**（`importRun` 传进来），不是档案里现在的 ——
   中途改了构筑不该回溯地改变一局已经开始的对局（与 forge/keep 同一条纪律）。
   ========================================================= */
function applySkillBuild(sess, charId, build) {
  if (!sess) return;
  var fold = Skills.fold(charId, build || []);
  sess.skills = {
    fold: fold,
    slots: fold.slots.map(function (sk) {
      return { skill: sk, cd: 0, castT: 0, flash: 0 };
    }),
    mods: fold.mods || {},
    casting: null
  };
  /* 能量从满开始：开局就能放一个技能，而不是先站着等 12 秒 */
  sess.energy = 100;
  sess.energyMax = 100;
}

function newSession(charDef, seed, danger, opening, smods, skillBuild) {
  /* **外观**（R50）：在这一刻从存档里折一次，存进玩家对象。
     为什么不是每帧现算：`render.ts` 的 `drawPlayer` 每帧都要它，
     现算就是每帧新建一个对象（`test/render-check.mjs` 的"每帧新建对象"那一栏盯着）。

     ⚠ **没有存档角色时它是 `null`**（不是"一份等于本色的外观"）：
       两者的区别是**可判定**的 —— `p.look === null` 就是"这一局没捏过人"，
       而"一份恰好等于本色的外观"要靠逐字段比才认得出来。
       渲染层据此退回职业本色与职业脸型，与改造前逐位相同 ——
       这是行为指纹不变的前提（挑战 / CLI / 无头测试都走那条路）。 */
  var me = Profile.character();
  var look = me ? Game.renderLookOf(charDef) : null;
  /* **短句那两本账必须跟着新一局清空**（R41）：它们是"这一局说过什么"的记账，
     留着会让第二局一句话都不说（而且不报错）。它们与 `hallRoom` 同性质 ——
     模块级可变状态，所以登记在 `test/persist.mjs` 的清单里。 */
  _barkN = Object.create(null);
  _barkSaid = Object.create(null);
  // 玩家也走原型：字段由组件声明，不再手写字面量
  // （骨架由 player 原型的生成钩子随对象一起造出来，见 bronana.ts 的 Comp.onSpawn）
  var p: Player = Comp.spawn('player', {
    charDef: charDef,
    look: look,
    accessory: look ? (look.accessory || '') : '',
    x: Arena.W / 2, y: Arena.H / 2,
    r: 20,
    face: 1,
    base: Stats.base(),
    upgrades: Stats.empty(),
    xpNeed: Stats.xpNeeded(1)
  });

  // 据点修正：与难度同一套路 —— 开局折叠**一份**，模拟里不回表
  var keep = Stronghold.modsFor(smods && smods.owned ? smods.owned : (smods || null));
  var ownedKeep = (smods && smods.owned) ? smods.owned : null;
  /* 图纸工坊的修正走同一条路（开局折一次）。空 = 全 0 = 恒等，这是行为指纹不变的前提。
     注意它**只解锁能力**（能合什么、槽位几个、回收多少），没有一条改属性 ——
     否则"永久属性"会把局内的取舍直接买断，那正是 brotato 刻意不做的事。 */
  var fmods = Forge.modsFor(smods && (smods as { forge?: Record<string, unknown> }).forge);

  // 应用角色
  var k;
  for (k in charDef.stats) {
    if (Object.prototype.hasOwnProperty.call(charDef.stats, k)) p.base[k] += charDef.stats[k];
  }
  p.charDef = charDef;
  // 天赋的产物（**开局条件**）在这里一次性并进基础属性；
  // 模拟层别处完全不认识"天赋"，它只看到一份更高的起始属性
  applyOpening(p, opening);

  // 难度：整局的修正折成**一份**，只在开局算一次（模拟里不再回表）
  var dlevel = Math.max(0, Math.min(Danger.MAX, Math.floor(Number(danger) || 0)));
  var dmods = Danger.modsFor(dlevel);

  // 播种：默认按时间；传入 seed 则完全可复现（测试、复现 bug、存档续玩都用它）
  var sd = (seed === undefined || seed === null) ? ((Date.now() ^ 0x9e3779b9) >>> 0) : (seed >>> 0);

  // 开局条件只折一次（属性在这里并进 p.base，经济修正折成 omods）
  var op = sanitizeOpening(opening);

  S = {
    rnd: U.rng(sd),
    seed: sd,
    danger: dlevel,
    dmods: dmods,
    opening: op,
    /** 天赋的经济修正（与 dmods/kmods 同形：开局算一次，模拟里不回表） */
    omods: op.econ,
    /** 据点：已买到的设施等级 + 折叠好的修正（跨局永久，开局算一次） */
    keep: ownedKeep ? cloneNumMap(ownedKeep) : {},
    kmods: keep,
    /**
     * **已解锁的图纸 = 局内状态**（M1 第四块，2026-09）。
     *
     * 设计上下文 v3 §8-3：养成模块含"**能力解锁**（技能/被动/支援加成/功能开放）"，
     * 而图纸正是"功能开放"（能造什么）；§二 说三个模块全在局内 ⇒ 解锁集合属于这一局。
     *
     * ⚠ **本轮只搬"集合住在哪"，没动"用哪笔钱解锁"** —— `Forge.canUnlock` 收的
     * 仍然是 `合金` + `核心材料`，而 `合金` 不在 v3 的货币模型里（v3 只有
     * 3 个模块代币 + 1 个全局货币 + 3 个核心素材）。那个归属是**设计决定**，
     * 需要用户拍板，所以本轮不碰。
     *
     * 归一成映射再存：档案给的可能是 id 数组，不归一的话 `Object.keys`
     * 会把这个数组变成 `["0","1"]` 那种下标。
     */
    forge: Forge.toMap(smods && (smods as { forge?: unknown }).forge),
    fmods: fmods,
    /** 回收比例 = 底价 0.5 + 图纸「废料回收」+ 工坊「回收炉」。
        ⚠ 工坊那一份现在**开局也折进来**（营地跨局，开局时它已经有确定的值），
        但工坊可以在一局进行中被改建 —— 那时由 `Profile.campSell/Buy` 之后
        的 `Game.refreshCampFx()` 重算这个字段，否则会出现"拆了回收炉回收价不降"。 */
    salvageRate: campSalvageRate(fmods),
    /** 本局累积的合金（回收产出；结算时入账，局内不能花） */
    growth: 0,
    /** 本局滚过几批词条（词条随机流的计数器；**不进存档** —— 见 SessionCore 的说明） */
    affixN: 0,
    /* =========================================================
       **工坊（经营模块的制造设施）= 局内状态**（M1 第三块，2026-09）
       ---------------------------------------------------------
       设计上下文 v3 §二：三个模块全在局内；工坊属于**经营**（设施 / 布局 / 产能）。
       所以它的等级与建造顺序都是**这一局**的状态。

       以前它们在账号档案里（`data.camp` / `data.campRow`），`run_save` 的注释写着
       "设施与建造顺序是跨局资产 … 三者都不该按局清零"。
       与据点同一条理由，那句话在 v3 之下是反的。

       `campEffects` 是**派生**值（`Camp.effects` 的结果），每次改动重算一次；
       它不单独存，读的时候由 `refreshCampFx()` 保证是最新的。 */
    /** 工坊设施 → 等级（这一局建的） */
    camp: {} as Record<string, number>,
    /** 建造顺序（相邻组合要靠它判定，所以顺序本身是数据） */
    campRow: [] as string[],
    /** 工坊效果的折叠结果（`Camp.effects` 的产物；改动后由 `refreshCampFx` 重算） */
    campEffects: null as CampEffects | null,
    /** 这一波已经用过的产线（每波重置：经营那一侧的"回合"） */
    craftUsed: [],
    /** 这一波训练了几次（养成那一侧的"回合"） */
    trainUsed: 0,
    /* =========================================================
       **养成模块的局内状态**（M3 第二块，2026-09）
       ---------------------------------------------------------
       v3 §5.1：模块代币"产出在本模块、**消费在本模块**"，而 §二 说三个模块全在局内
       ⇒ `growth` 是**局内的余额**，不是账号钱包。

       ⚠ 它以前是账号级的（`data.growth`），而且它的**收入产在战斗端**（结算按
         波次/合成发）—— 那是"战斗 → 养成"，v3 §5.2 里没有这条边。
         产出点已在上一轮搬进 `Game.train`（养成模块内部）。
       ========================================================= */
    /** 这一局点过的天赋节点（一局一个角色，所以是一张平表） */
    talents: [] as string[],
    /** 这一局洗过几次点（免费次数用完之后要花材料） */
    respecs: 0,
    /* ---- NPC 关系状态（M3 第三块，2026-09）----
       v3 §8-3：养成模块的**共享关系状态**。叙事线（`story.ts`）与养成线（相处）
       **读同一份**，但只有养成那一侧能改经济。 */
    /** NPC id → **信任**（关系阶段由它推出来，不另存字段 —— 多存的一定会漂） */
    bonds: {},
    /** NPC id → **这一波**相处了几次（模块内的时间感；每波重置） */
    talks: {},
    /* ---- 产能（`capacity`）：**局内**（M2，2026-09）----
       v3 §5.1：模块代币"产出在本模块、消费在本模块"；§二：三个模块全在局内。
       产出 = 每波据点运转；消费 = 建造子模块盖设施。 */
    /** **经营代币余额**（局内）：每波由据点产出，盖设施时花掉 */
    capacity: 0,
    /* ---- **核心素材**（跨模块，M4，2026-09）----
       v3 §5.2 的三条边：**战斗 → 经营 → 养成 → 战斗**。
       它们**不在任何账本里**（见 `link.ts`）：模块代币"产出与消费都在本模块"，
       而核心素材的整个存在意义就是**跨模块**。
       ⚠ 两处都落在 `Session`（v3 §二：三个模块全在局内）—— 这正是
         `Link.PENDING` 当初等的那一步。 */
    /** **遗物**：经营的关键建筑产出它，养成的关键能力（图纸）花它 */
    relic: 0,
    /** **徽记**：养成走通一条关键能力线产出它，回到战斗里花 */
    sigil: 0,
    /** 已经为哪几个扇区发过徽记（**发过就不再发** —— 否则每次点天赋都重发一遍） */
    sigilSectors: [] as string[],
    /** 上一次折过的**天赋开局效果**（M3）：用来算差 —— 见 `refoldTalents()` */
    talentFx: null,
    /** 本局造了几件（结算展示用；进存档） */
    craftCount: 0,
    /** 本局打到多少**材料**（`gainMaterial` 记账；只用于展示 —— 材料当场进钱包） */
    materialEarned: 0,
    /* =========================================================
       **材料（全局货币）= 这一局的钱**（M1 的第一块，2026-09）
       ---------------------------------------------------------
       设计上下文 v3 §5.1：全局货币"三模块通用，每个模块都要用它，
       每个模块也都能产出它" —— 而 v3 §二 说三个模块**全在局内**
       （用户原话："这些东西都是局内的，他们都是属于三个模块内的玩法和机制"）。
       两者合起来只有一个结论：**材料是局内货币，不跨局**。

       ⚠ 这里以前写的是反面：

         "设施与建造顺序是**跨局资产**（`Profile.campOwned()`）…
          钱是**材料**（`Profile.material()`）—— **三者都不该按局清零**。"

       那是"账号资产 + 开局快照"的模型，`run_save` 里也照它存了
       `keep: input.keep` / `forge: input.forge`。M1 把这三样逐个搬回局内，
       **材料是第一个**（它最基础：另外两样都要花它）。

       **开局是 0**：这是设计选择，不是遗漏 —— "打才有"正是 v3 §5.2
       那条链的第一环（战斗产材料 → 材料盖经营）。给一笔启动资金会把
       "先打还是先盖"这个取舍抹掉。
       ========================================================= */
    material: 0,
    /* **营地搬出去之后这里不再有 camp / campRow / campPoints / campFx。**
       ⚠ 但"设施与建造顺序是跨局资产"那句话**只对了一半**：它们是账号资产没错，
       而设计上下文 v3 §二 说三个模块**全在局内** —— 所以 M2 会把它们也搬回来。
       **钱（材料）已经搬完了**：它在上面 `material` 那个字段里，按局清零。
       留在会话里的只有 `craftUsed`（"这一波用过哪几条产线"），
       因为它确实是**这一局**的回合计数器。
       折叠效果也不在这里缓存了：它在经营场景里随买随变，
       冻结进会话就会出现"盖了熔炉这局却不省料"。 */
    /* 两份**派生**的联动结果（每次 recalcStats 重算；界面直接读，不自己算）：
       武器那一份按四条轴折，道具那一份按套装折 —— 分开存是因为界面上是两块。 */
    synergy: null,
    itemSets: null,
    /* 道具**机制类**效果的折叠（`{ special: 件数 }`）。与上面两份同理：折一次、只读结果。
       以前是每帧 `for (items) if (def.special === 'turret')` 的两处裸扫描 ——
       一件写着 special 却没被任何一行 if 认领的道具，等于**什么也不做**。 */
    itemFx: Items.foldSpecials([]),
    /* 道具**代价**的折叠（`{ mul, add }`；缺省恒等）。理由同上：
       读点（废料 / 商店价 / 敌人 / 受伤）只读结果，不每帧遍历道具。 */
    itemCost: Items.foldCosts([]),
    freeRerolls: 0,
    /* 商店"刷新一次要多少钱"（`market.ts` 每次开商店会按波次与已刷次数重算它）。
       这里必须给初值，理由不是"防 undefined 崩" —— 是**存档格式**：
       `exportRun` 要写它，而"还没开过商店"时它是 `undefined`，
       `JSON.stringify` 会把 undefined 字段**整条丢掉**，于是同一份存档
       在"开商店之前存"与"开商店之后存"是**两种形状**。
       0 = "还没算过"，`importRun` 读到的也是 `Math.max(0, …)`，两边一致。
       它是 `test/run-save.mjs` 的 [2] 节"每个字段都能 JSON 往返"抓出来的。 */
    rerollCost: 0,
    /* ---- 地牢（G 批）：地图由种子长出来，只有**进度**进存档 ---- */
    floor: 1,
    map: null,
    roomId: '',
    /** 破过的墙：`Dungeon.wallKey(层号, a, b)` → true（无向；**键里带层号**） */
    walls: Object.create(null),
    /** 当前房间里还没打穿的暗门墙（每帧要检查的那一小份） */
    wallsNow: [],
    /** 钉住这一间不自动结束（测试/调试用；将来的"限时房/无尽房"也走这个口子） */
    roomHold: false,
    /** 这一间的房间效果（进门折一次：商店货架/折扣等） */
    roomFx: {},
    /** 打完这一间的奖励倍率（事件房可以改它：代价与好处并存） */
    bonusMul: 1,
    /** 这一局发现过几间密室（跨局发现记在档案里，见 profile） */
    secretsFound: 0,
    /** 这一局通关了吗（成绩码回放要用**事实**，不再是"波次 ≥ finalWave"这种推断） */
    won: false,
    /** 当前这一间的 Boss id（只有 Boss 房有；由**层**决定，不是每次随机） */
    bossId: null,
    /** 这一局打倒了哪些 Boss（剧情碎片的输入；按 id 记） */
    bossesDown: Object.create(null),
    /* 这一局打到的**核心材料**（Boss 掉落）：结算时才入档。
       它是 `economy.ts` 里 `meta-rare` 那一档唯一的来源 —— 所以必须跟着存档走，
       否则"读档再打一次 Boss"就能刷它（与 `paid` 那条套利是同一类洞）。 */
    coreEarned: 0,
    /** 这一局在事件房见过的遭遇 id（剧情碎片与图鉴的输入） */
    runEvents: [],
    /** 层间契约：已挑的那一条（id）与它折出来的三组修正 */
    boon: '',
    boonFold: null,
    /** 还没挑的候选（打完 Boss 抽一组；挑完清空） */
    pendingBoons: [],
    /** 难度折叠结果 × 当前房间/层主题的结果（进房算一次） */
    wmods: null,
    charDef: charDef,
    player: p,
    stats: Stats.base(),
    weapons: p.weapons,
    enemies: [],
    bullets: [],       // 玩家子弹
    ebullets: [],      // 敌人子弹
    pickups: [],
    particles: [],
    /* 飘字与"视觉粒子"是**两套池**（emit.ts 各有一套上限与游标）。它们以前是
       `Emit.bind(S)` 懒创建的 —— 编译器接管 `S` 的类型之后立刻指出：这几个字段
       在分组里声明成**必填**，字面量里却没有。声明与初值必须对齐（要么都必填并在这里给初值，
       要么都写成可选）—— 现在是前者：出生即齐全，`Emit.bind` 里的 `if (!S.x)` 退化成防御。 */
    textParticles: [],
    freeParticles: [],
    freeTextParticles: [],
    visCursor: 0,
    textCursor: 0,
    decals: [],
    decalSeq: 0,
    decalCursor: 0,
    stainBudget: 8,
    hitStop: 0,
    /* 技能：**默认是空载荷** —— "没点过技能树"与改造前逐位相同（指纹靠这个）。
       真正的载荷在 `newRun` 里按技能构筑折出来（那时才知道角色是谁）。 */
    skills: { fold: Skills.fold('', []), slots: [], mods: {}, casting: null },
    energy: 100, energyMax: 100,
    packsOpened: 0,
    packSpent: 0,
    turrets: [],
    spawnQueue: [],
    spawnIdx: 0,
    waveT: 0,
    waveLeft: 0,
    waveScrap: 0,
    /** 这一间是不是已经在收尾 / 是不是被超时强制清掉（startWave 复位，两条都在用） */
    waveEnding: false,
    forceClear: false,
    /* 这一行曾经是 `shop: null` —— 一个**没人读**的会话字段（.shop 全仓零命中，
       真正的商店状态在 offers/levelCards 里）。是"72 个字段的平铺大对象"里最典型的那种：
       加的时候顺手写了一个，之后谁也没删。字段分组守卫（test/persist.mjs [2b]）把它抓了出来。 */
    offers: [],
    levelCards: [],
    /** 本局合成过几次（结算展示用；进存档，所以要在 newSession 里就有初值，
        不能等到第一次合成才懒创建 —— persist 的字段分组守卫查的就是这个） */
    combineCount: 0,
    stats_total: { kills: 0, scrap: 0, dmg: 0, taken: 0, healed: 0, waves: 0 },
    /* 空间网格的格边长走世界系统的网格表（`spatial`）——
       这一格以前写死 68，而"还有别的网格吗、各自多大"没有一处能回答。 */
    grid: { cell: World.grid('spatial'), map: Object.create(null) },
    nextId: 1
  };

  Game.wave = 1;
  Game.speed = 1;

  // 把粒子发生器绑定到本局（粒子池随会话创建/清理）
  Emit.bind(S);

  // 起始武器
  for (k = 0; k < charDef.startWeapons.length; k++) addWeapon(charDef.startWeapons[k]);
  // 天赋带来的额外武器 / 道具 / 废料（同样是开局条件，一起在建会话时给完）
  applyOpeningExtras(p, S.opening);
  /* 图纸「备料」那条**没了**：它以前把开局第一把武器免费抬到 T2/T3 ——
     那是"养成直接给战斗数值"，正是要拆的耦合。现在图纸给的是**能造什么**
     （`craftTier`），强度由玩家自己在工坊里造出来。 */
  /* =========================================================
     据点给的**开局材料** —— 修掉一个玩家可见的错账（2026-09）
     ---------------------------------------------------------
     ⚠ 这里以前写的是：

       `// 据点"仓库"给的起始废料（也是开局条件，只是来源不同）`
       `p.scrap = (p.scrap || 0) + S.kmods.startMaterials;`

     而**三处**都说明它是**材料**，只有那句注释说是废料：

       · 字段名就叫 `startMaterials`（`stronghold.ts` 的 `MOD_KEYS`）
       · 那个字段的 `note` 写着"开局材料（game.ts newSession）"
       · **界面文案**是 `'开局材料 +' + v` —— 玩家看到的是"开局材料 +60"

     于是症状是：玩家买了仓库、界面告诉他"开局材料 +60"，
     而他拿到的是 **60 废料**。它不报错、不进任何断言，
     只是"那 60 点材料怎么从来没到账"。

     ⚠ 为什么现在才发现：材料以前住在**账号钱包**（`Profile.wallet.material`），
     而废料是 `p.scrap` —— 两者在类型上都是 `number`，写错了没有任何东西会拦。
     这正是把状态搬进局内（M1）带来的**副作用收益**：`S.material` 有了名字与位置，
     "这 60 点该进哪本账"才成为一个看得见的问题。
     ========================================================= */
  if (S.kmods.startMaterials > 0) {
    addMaterial(S.kmods.startMaterials);
  }

  recalcStats();
  p.hp = p.base.maxHp;
  recalcStats();
  // 高难度的"开局不满血"（startHpFrac）：夹在 1 以上，绝不让它开成 0 血
  p.hp = Math.max(1, Math.round(S.stats.maxHp * S.dmods.startHpFrac));

  // 地牢：先长出一层、落进入口房，再开第 1 波（入口房不刷怪，等于"安全开局"）
  enterFloor(1, { silent: true });
  startWave(1);
  applyRoomEntry();
  /* 难度的"开局不满血"最后再夹一次。
    入口间会回 15% 血，而它是**房间内容**（每个入口间都给）——
     如果按老顺序在进门前夹血，高难度那 15% 就被入口间当场补满了
     （实测：难度 9 的 startHpFrac=0.85，开局血量 20/20，"不满血"这条修正是假的）。
     所以顺序改成"先给房间内容、后夹难度"，两条规则都成立。 */
  p.hp = Math.max(1, Math.min(p.hp, Math.round(S.stats.maxHp * S.dmods.startHpFrac)));
  /* 技能构筑：**默认是空构筑**（`skillBuild` 没传）—— 空构筑折出 0 个槽位，
     于是"没点过技能树"与改造前逐位相同（行为指纹靠这个）。
     有技能时，这里也是**唯一**把 fold 变成槽位的地方。 */
  applySkillBuild(S, charDef.id, skillBuild || []);
  S.skillBuildSource = (skillBuild || []).slice();
  return S;
}

/**
 * 进一间房的**内容**：查表、跑一次性效果、把这一间的商店参数折好。
 * 放在 `startWave` 之后：房间效果里给的废料/回血不该被 startWave 的重置吃掉。
 */
function applyRoomEntry() {
  var room = currentRoom();
  S.roomFx = {};
  if (!room) return null;
  var fx: RoomFxDef = ROOM_FX[room.type] || ({} as RoomFxDef);
  S.roomFx = {
    shopSlots: fx.shopSlots || 0, shopDiscount: fx.shopDiscount || 0,
    // 限时房把"速清/超时"两档也改了：按时打完翻倍、超时几乎什么都没有
    fastMul: fx.fastMul || 0, slowMul: fx.slowMul || 0
  };
  var msg = null;
  if (fx.enter) msg = fx.enter(S.player, room);
  Game.events.emit('roomEnter', {
    room: room.id, type: room.type, floor: S.floor, wave: Game.wave,
    name: (Dungeon.TYPE_BY_ID[room.type] || {}).name || room.type, msg: msg
  });
  return msg;
}

/* =========================================================
   属性重算
   ========================================================= */
/** 当前这套武器的**定义**数组（联动只需要 def，不需要实例） */
function weaponDefs(p) {
  var out = [];
  if (!p || !p.weapons) return out;
  for (var i = 0; i < p.weapons.length; i++) if (p.weapons[i] && p.weapons[i].def) out.push(p.weapons[i].def);
  return out;
}

/** 当前这套道具的定义数组（道具套装那一条联动要它） */
function itemDefs(p) {
  var out = [];
  if (!p || !p.items) return out;
  for (var i = 0; i < p.items.length; i++) if (p.items[i] && p.items[i].def) out.push(p.items[i].def);
  return out;
}

function recalcStats() {
  if (!S) return;
  var p = S.player;
  var s = Stats.base();
  var k, i;

  for (k in p.base) if (Object.prototype.hasOwnProperty.call(p.base, k)) s[k] = p.base[k];
  for (k in p.upgrades) if (Object.prototype.hasOwnProperty.call(p.upgrades, k)) s[k] += p.upgrades[k];
  for (i = 0; i < p.items.length; i++) {
    var st = p.items[i].def.stats;
    if (!st) continue;
    for (k in st) if (Object.prototype.hasOwnProperty.call(st, k)) s[k] += st[k];
  }
  /* 层间契约的属性那一条（`stats` 组）：与道具走同一条路 ——
     它同样是"本局的选择"，所以同样不进 upgrades。
     注意工坊**不在这里**：它的效果全部只作用于制造（见 camp.ts），
     这条读点在解耦时被删掉了 —— 那是"经营给战斗加数值"的最后一根线。 */
  var bst = S.boonFold && S.boonFold.stats ? S.boonFold.stats : null;
  if (bst) {
    for (k in bst) if (Object.prototype.hasOwnProperty.call(bst, k)) s[k] += bst[k];
  }

  /* 武器联动（synergy.ts）：由**当前这套武器**折出来的增量。
     它是**派生值**（不存状态、不掷骰子），所以每次重算属性都重新折一遍；
     一件武器都没联动时返回空对象 → 这里是恒等（行为指纹靠这个）。
     折出来的结果顺手存进 S.synergy，界面直接读，不用自己再算一次。 */
  var syn = Synergy.of(weaponDefs(p));
  /* 道具套装（同一份表、同一套折叠）：把**道具**折成第二份增量。
     两份分开存 —— 界面画"我的武器"与"我的道具"是两块，合起来就分不开了。 */
  var iset = Synergy.ofItems(itemDefs(p));
  S.synergy = syn;
  S.itemSets = iset;
  /* 道具的机制那一份（炮塔数 / 额外弹丸）也在这里折一次。
     与属性分开：属性进 stats，机制进 itemFx —— 两类效果的读点完全不同。 */
  S.itemFx = Items.foldSpecials(p.items);
  /* 道具的**代价**那一份（经济 / 敌人 / 规则三类）：同样折一次、只读结果。
     它是**乘性**的（废料 / 商店价 / 敌人 / 受伤），缺省恒等 1 —— 所以
     "一件带代价的道具都没有"时这里是空对象，行为逐位不变。
     属性型的代价不在这里 —— 它是 stats 里的负值，走上面那条累加。
     （这一段以前**写了两遍**：第一行与紧接着的第二行是同一句，
     是两次改动各自"顺手补一句"叠出来的。折两次结果一样，
     但它掩盖了"这里是不是唯一折叠点"这个问题 —— 留一份。） */
  S.itemCost = Items.foldCosts(p.items);
  for (k in syn.stats) if (Object.prototype.hasOwnProperty.call(syn.stats, k)) s[k] += syn.stats[k];
  for (k in iset.stats) if (Object.prototype.hasOwnProperty.call(iset.stats, k)) s[k] += iset.stats[k];

  /* 词条（affixes.ts）：**唯一**的折叠点。
     两类效果在这里**分流**，因为它们之后的读点完全不同：
       · 属性类（`stats`）就地并进属性表 —— 与道具 / 契约 / 升级走同一条路，
         于是"词条加的那 2 点护甲"享受与别处完全一样的公式与夹取；
       · 武器本地类（`wmods`）写回**每一把武器自己**（伤害倍率 / 冷却倍率）——
         它只作用于这一把，进全局属性表就错了（6 把枪会各吃一遍）。
     武器与道具的词条分开折：`wmods` 必须落在实例上，不能只存一份。
     一套词条都没有时 `fold` 返回空对象 + 恒等倍率 → 这里是恒等（行为指纹靠这个）。 */
  for (i = 0; i < p.weapons.length; i++) {
    var fw = Affixes.fold(p.weapons[i].affixes);
    p.weapons[i].wmods = fw.wmods;
    for (k in fw.stats) if (Object.prototype.hasOwnProperty.call(fw.stats, k)) s[k] += fw.stats[k];
  }
  for (i = 0; i < p.items.length; i++) {
    Affixes.applyStats(p.items[i].affixes, s);
  }

  /* 角色的专属机制：**唯一**的读点（`chars.ts` 的 `SPECIALS` 声明了它是什么）。
     改造前这里是裸比字符串 `p.charDef.special === 'rage'`，另外还有两处
     （移速、受伤）各裸比一次 —— 于是"改个机制名"或"加一种机制"要改三处，
     而漏掉任何一处都**不报错**，只是那个角色悄悄变成白板。
     现在机制名只在声明表里出现，三处读点都问 `Chars.specialOf`。 */
  if (Chars.specialOf(p.charDef.id, 'rage') && s.maxHp > 0) {
    var missing = 1 - U.clamp(p.hp / s.maxHp, 0, 1);
    p.rage = U.clamp(missing * 1.25, 0, 1);
    s.damage += p.rage * 0.30;
    s.attackSpeed += p.rage * 0.25;
  } else {
    p.rage = 0;
  }

  s.maxHp = Math.max(4, Math.round(s.maxHp));
  S.stats = s;
  /* **生命上限变了，当前生命就跟着夹一次** —— 这是 maxHp 唯一的安全出口。
     为什么必须在这里而不是在各调用点：`maxHp` 会被**买到的道具**改小
     （`rations` / `treadmill` 都是 `stats: { maxHp: -3 }`，这是"有得有失"的"失"）。
     以前只有商店买 / 制造 / 升级选卡三条路各自记得夹一次（`Math.min(p.hp, S.stats.maxHp)`），
     而 `pickBoon` 与**加道具的另一条路**没有 —— 于是血量可以停在一个已经不存在的身位：
     实测（探针 24 局）collector 第 4 波买下 `rations` 后 `hp=24 / maxHp=21`，
     一直持续到这一波结束（`takeLevelCard` 那一次夹血才把它拉回来）。
     放在这里等于"重算属性"与"生命不超上限"变成同一件事：任何新增的改属性路径
     都不可能再漏掉它 —— 与"废料只有一个扣点"是同一个原则。
     注意 `rage`（受虐狂）读的是**夹之前**的 p.hp，所以先算 rage 再夹，顺序不能换。 */
  if (p.hp > s.maxHp) p.hp = s.maxHp;
  p.xpNeed = Stats.xpNeeded(p.level);
}

/* =========================================================
   武器管理
   ========================================================= */
/**
 * 这一局能带几把武器（**唯一的读点**：装配 / 购买 / 界面三处都走它）。
 * 现在没有任何图纸能改它：武器挂在骨架的 6 个挂点上（bronana.ts 的 SEATS），
 * 要 +1 槽得先在骨架上加挂点 —— 那是渲染层 / 装配层的事，不是一个数字能解决的。
 * 所以工坊里"多带装备"那一条走的是**货架**（每次多两件可选），而不是硬塞第 7 把武器
 * （那样第 7 把没有挂点，画出来会叠在第 1 把上或者变成 NaN）。
 */
function maxWeapons() {
  return Game.cfg.maxWeapons;
}

/** 给玩家一把武器。`paid` = 为它付过多少废料（回收价的上限，见 data_weapons.ts）
 *  `set` = 已经定好的词条（货架上那一件 / 存档里那一份）。不给就现滚一套。 */
function addWeapon(id, tier?, paid?, set?) {
  if (!S) return null;
  if (S.player.weapons.length >= maxWeapons()) return null;
  var w = Weapons.instantiate(id, tier, paid);
  if (!w) return null;
  w.index = S.player.weapons.length;
  /* 词条在**唯一**的入口生成（不是每个调用点各滚一次）：
     开局携带 / 天赋 / 商店 / 制造 / 调试全都走这里，于是"有没有词条"
     不取决于它是怎么来的。读档时会用存档里的那一份**覆盖**它（见 importRun）。
     随机走**词条自己的流**（`Affixes.rollStream`：由主状态派生）——
     于是"这件装备有几条词条"不会扰动商店卖什么、刷什么怪、升级卡是哪四张。 */
  w.affixes = set || Affixes.roll('weapon', w.def, Weapons.tierOf(w), affixRnd());
  S.player.weapons.push(w);
  return w;
}

/**
 * 取一个"本批词条"的随机流：主随机流的状态 + 本局第几批。
 * **只读主状态、不推进它** —— 这是词条与主序列解耦的全部机制（见 affixes.ts 的 rollStream）。
 */
function affixRnd() {
  var n = S.affixN = (S.affixN || 0) + 1;
  return Affixes.rollStream(S.rnd && S.rnd.state ? S.rnd.state() : undefined, n);
}

/**
 * 给玩家一件道具。**道具唯一的入口**（与 `addWeapon` 对称）——
 * 制造 / 宝箱 / 开局携带 / 商店买 / 弹窗奖励全都走它，于是"词条在生成时滚一次"
 * 这件事只有一处实现，不会出现"某个入口忘了滚词条"。
 * @param def 道具定义（调用方一般已经从 `Items.BY_ID` 取好）
 */
function addItem(def, set?) {
  if (!S || !def) return null;
  var it = Comp.spawn('item', { def: def });
  it.affixes = set || Affixes.roll('item', def, def.tier || 1, affixRnd());
  S.player.items.push(it);
  return it;
}

/**
 * 买武器时的**唯一**落位规则（brotato 的两条原作细节）。
 *
 * 空槽位就装上去；**槽位满了**才考虑合成：找一个同名同档的伙伴，把这一把并进去
 * （结果抬一档，不占新格子）。合不了就明确拒绝 —— 以前这里只说"武器槽已满"，
 * 玩家没法知道"那我买两把一样的会怎样"。
 *
 * 分开的原因：`addWeapon` 是"给我一把"（开局携带 / 天赋 / 调试），
 * 本函数是"这一把**买**进来之后该变成什么" —— 后者要回答"装不下怎么办"。
 * @returns { ok, why, combined, tier, weapon }
 */
function addWeaponOrCombine(id, tier?, paid?, set?) {
  if (!S) return { ok: false, why: '还没有开局', combined: false, tier: 0, weapon: null };
  var p = S.player;
  var t = tier === undefined || tier === null ? 0 : tier;
  if (p.weapons.length < maxWeapons()) {
    var w = addWeapon(id, t || undefined, paid, set);
    if (!w) return { ok: false, why: '没有这把武器', combined: false, tier: 0, weapon: null };
    return { ok: true, why: '', combined: false, tier: Weapons.tierOf(w), weapon: w };
  }
  // 槽位满了：找一个同名同档（开了「异档熔接」就放宽到同名的任意档）的伙伴
  var def = Weapons.BY_ID[id];
  if (!def) return { ok: false, why: '没有这把武器', combined: false, tier: 0, weapon: null };
  var want = Weapons.clampTier(t || def.tier);
  var diff = fuseDiff();
  var j = -1, bestLow = -1, bestLowTier = 99;
  for (var i = 0; i < p.weapons.length; i++) {
    var q = p.weapons[i];
    if (q.id !== id) continue;
    var qt = Weapons.tierOf(q);
    if (qt === want) { j = i; break; }
    // 异档熔接：宁可挑**最低档**的那一把当燃料（别把攒出来的 T3 当柴烧）
    if (diff && qt < Weapons.TIER_MAX && qt < bestLowTier) { bestLow = i; bestLowTier = qt; }
  }
  if (j < 0 && diff && bestLow >= 0 && want < Weapons.TIER_MAX) j = bestLow;
  if (j < 0 || (want >= Weapons.TIER_MAX && Weapons.tierOf(p.weapons[j]) >= Weapons.TIER_MAX)) {
    return {
      ok: false, combined: false, tier: 0, weapon: null,
      why: want >= Weapons.TIER_MAX ? '同名武器已经是 T' + want + '（满档）'
        : '武器槽已满（上限 ' + maxWeapons() + '）：要合并得先有同名同档的另一把'
    };
  }
  var to2 = fusedTier(Weapons.tierOf(p.weapons[j]), want);
  if (to2 <= Weapons.tierOf(p.weapons[j])) {
    return { ok: false, combined: false, tier: 0, weapon: null, why: topTierLocked() };
  }
  /* 这一把"买进来的"在并档失败前**还没有实例**（只是货架上的一件），
     所以它的词条要在这里定下来 —— `set` 是货架上那一件的（买的就是它），
     没给就现滚一套（与 `addWeapon` 用的是**同一个** `Affixes.roll`）。
     定下来的那套会并进留下的那一把（见 `upTier`）：于是"并档不丢词条"，
     而且"哪一把当燃料"这件事有了意义（好词条那一把更该留下）。
     `paid` 一起带着走：回收价的上限必须把并进去这一把的成本算上。 */
  var incSet = set || Affixes.roll('weapon', def, want, affixRnd());
  var up = upTier(j, to2, incSet);
  /* 并进去的那一把也是**花了钱**的：把它的成本累加到留下来的那一把上 ——
     否则"买两把 → 合并 → 回收"就能把两笔成本洗成一笔（价值却翻了倍）。 */
  if (up && paid > 0) up.paid = (Math.floor(Number(up.paid) || 0)) + Math.floor(Number(paid) || 0);
  return { ok: true, why: '', combined: true, tier: up ? Weapons.tierOf(up) : 0, weapon: up };
}

/** 把第 i 格抬到 tier（**只由合成调用**）：同一个实例升级，槽位不动 */
function upTier(i, tier, incomingSet?) {
  var w = S.player.weapons[i];
  if (!w) return null;
  var before = Weapons.tierOf(w);
  w.tier = Weapons.clampTier(tier);
  /* 合成同时**合并词条**：并进来的那一把（`incomingSet` = 它现滚的那一套）
     身上的好词条不会白瞎。规则是"同名各取更好的那一条，上限取两边更宽的那一个"
     （`Affixes.merge`）。为什么不是"重滚一套"：那等于把"这把攒出来的好词条"
     重新赌一次，玩家没法规划自己的装备；而"合并"让"拿哪一把当燃料"成为一个真决定。
     上限**不跟着新档位**走（T2 并到 T3 仍是 2 条）：上限是"这件装备滚出来时
     有几条"，抬档不该凭空长出新词条 —— 那是 T4 起步靠**造出来 / 打出来**的待遇。 */
  w.affixes = Affixes.merge(w.affixes, incomingSet || null,
    Math.max((w.affixes && w.affixes.max) || 0, (incomingSet && incomingSet.max) || 0));
  S.combineCount = (S.combineCount || 0) + 1;
  /* 合金**不再从合成来**（这一步改的）：合成是把已有装备加工一下，不产新东西；
     合金的唯一稳定来源是**回收**（把不要的装备拆了）—— 见 market.sellWeapon。
     这样"探索捡到/造出多余装备 → 回收成合金 → 解锁图纸"是一条完整的链。 */
  Game.events.emit('combine', { name: w.def.name, tier: w.tier, index: i, from: before, alloy: 0 });
  return w;
}

/* =========================================================
   合成（战斗 × 经营的交点）
   ---------------------------------------------------------
   规则全在 data_weapons.ts 里（纯数据：谁能合、合完多强、值多少钱）；
   这里只负责**改动会话状态**这一件事，所以它对存档 / 回放都是确定的：
   `combine(i, j)` 是纯函数式的（同样的 i/j 在同样的状态下结果相同），
   于是它和 buyOffer 一样可以进录像带（record.ts 的 COMMANDS）。
   ========================================================= */
/** 工坊「异档熔接」：同名但不同档也能合（T1+T3 → T4） */
function fuseDiff() { return !!(S && S.fmods && S.fmods.fuseDiff); }
/** 合成结果的档位：取两把里更高的那一把 +1。
    （以前这里还加过一个 `bonusTier`（图纸「大师锻造」让结果再 +1 档）——
     那张图纸改成"解锁 T4 制造"之后就删了，但这个读点留了下来：
     `S.fmods.bonusTier` 已经不存在，永远读到 undefined → 恒 0。
     它不改变行为（0 就是没有加成），但它是一句**读起来像有加成的假话**，
     而这种假话最贵 —— 下一次有人加回这个键，会以为这里早就在生效。
     顺手记一笔：这行能被 tsc 放过去，是因为 `var S = null`（见文件头的那条说明）。 */
/** 合成能到哪一档：**顶档要图纸**（与制造那一侧同一条纪律，见 craft.ts 的 resultTier）。
    顶档之下照旧免费 —— 合成是战斗那一侧的能力，不该被养成整体否决；
    但最后一档如果谁都能靠 16 把同名硬攒出来，那么"图纸"在这条链上就没有位置了。
    （实测：3 条产线盯着一把刀造 + 实测废料收入，第 6 波 8 把 = T4、第 11 波 16 把 = T5 ——
     也就是说顶档离一局的寿命并不远，不设门槛就等于没有门槛。） */
function combineCap() {
  var max = Weapons.TIER_MAX;
  if (S && S.fmods && (S.fmods.craftTier || 0) >= max) return max;
  return Math.max(1, max - 1);
}
/** 顶档锁着时给人看的理由（界面/提示用同一句） */
function topTierLocked() {
  return '顶档（T' + Weapons.TIER_MAX + ' ' + Tiers.nameOf(Weapons.TIER_MAX) +
    '）要先解锁「神话图纸」：图纸树点到第 4 阶';
}

function fusedTier(ta, tb) {
  return Math.min(combineCap(), Weapons.clampTier(Math.max(ta, tb) + 1));
}

/** 第 i 格能不能合、跟谁合（界面拿它决定要不要画"合并"按钮） */
function combinePlan(i) {
  if (!S) return null;
  var list = S.player.weapons;
  var w = list[i];
  if (!w || !Weapons.canCombine(w)) return null;
  var j = Weapons.partnerOf(list, w, i, fuseDiff());
  if (j < 0) return null;
  var ta = Weapons.tierOf(w), tb = Weapons.tierOf(list[j]);
  var to = fusedTier(ta, tb);
  if (to <= ta) {
    /* 两条完全不同的"合不了"要分开说：
       ① 已经是顶档（没路了）→ 不画按钮；
       ② 顶档**锁着**（要先点「神话图纸」）→ 画一个禁用的按钮 + 理由。
       少了②，"合并按钮不见了"就成了一条玩家看不见的规则 —— 而它恰好是
       养成那一侧在战斗里唯一能被感觉到的地方。 */
    var need = Math.min(Weapons.TIER_MAX, Math.max(ta, tb) + 1);
    if (combineCap() < Weapons.TIER_MAX && need > combineCap()) {
      return {
        i: i, j: j, id: w.id, name: w.def.name,
        from: ta, to: to, partnerTier: tb, dmgMul: 1, locked: true, why: topTierLocked()
      };
    }
    return null;
  }
  return {
    i: i, j: j, id: w.id, name: w.def.name,
    from: ta, to: to, partnerTier: tb,
    dmgMul: Weapons.mulFor(w.def, to, 'dmg') / Weapons.mulFor(w.def, ta, 'dmg')
  };
}

/** 所有可合成的格子（界面按它渲染按钮；顺序即槽位顺序） */
function combinePlans() {
  var out = [];
  if (!S) return out;
  for (var i = 0; i < S.player.weapons.length; i++) {
    var p = combinePlan(i);
    if (p) out.push(p);
  }
  return out;
}

/**
 * 合成：同名同档的两把 → 一把高一档的同名武器，落在**靠前**的那个槽位。
 * 为什么结果落在靠前的格子：玩家的槽位顺序是他自己排的（`index` 也是挂点），
 * 让结果跳到最后会把他排好的阵型打乱 —— 合成应该是"变强"，不是"重新摆一遍"。
 */
function combine(i, j) {
  if (!S) return false;
  var list = S.player.weapons;
  /* 每一条失败都要**说出理由**：这里是唯一知道理由的地方，
     外面（market.combine / 界面）只能把这句话转给玩家。 */
  if (i === j) return deny('不能和自己合成');
  var a = list[i], b = list[j];
  if (!a || !b) return deny('没有这把武器');
  if (a.id !== b.id) return deny('只能合成**同名**武器（两把一样的）');
  if (!Weapons.canCombine(a) || !Weapons.canCombine(b)) return deny('这把武器已经到顶了');
  var ta = Weapons.tierOf(a), tb = Weapons.tierOf(b);
  if (ta !== tb && !fuseDiff()) {
    return deny('要**同名同档**（T' + ta + ' 与 T' + tb + ' 合不了；工坊「异档熔接」可以放宽）');
  }
  var lo = Math.min(i, j), hi = Math.max(i, j);
  var tier = fusedTier(ta, tb);
  /* 到顶了就**拒绝**，而不是把两把 T4 变成一把 T4 —— 那种"合完没变化"的静默失败
     比拒绝更糟（玩家会以为自己点错了）。 */
  if (tier <= Math.max(ta, tb)) return deny(topTierLocked());
  list.splice(hi, 1);
  list.splice(lo, 1);
  /* 两把的成本合并到结果上：回收价的上限跟着走，所以"买两把合一把再拆"不产钱 */
  var w = Weapons.instantiate(a.id, tier, (Math.floor(Number(a.paid) || 0)) + (Math.floor(Number(b.paid) || 0)));
  if (!w) return false;
  /* 词条跟着一起合（与 `upTier` 那条路同一套规则）：两把各取更好的那一条，
     上限取两把里更宽的那一个 —— 于是"拿哪一把当燃料"是一个真决定。
     注意这里是**手工合成**那一支（两把都已经是实例），所以两边都有词条可合。 */
  w.affixes = Affixes.merge(a.affixes, b.affixes,
    Math.max((a.affixes && a.affixes.max) || 0, (b.affixes && b.affixes.max) || 0));
  list.splice(lo, 0, w);
  for (var k = 0; k < list.length; k++) list[k].index = k;
  S.combineCount = (S.combineCount || 0) + 1;
  Game.events.emit('combine', { name: w.def.name, tier: tier, index: lo, from: Math.max(ta, tb), alloy: 0 });
  return true;
}

/* =========================================================
   工坊效果 → 会话（营地跨局之后的接入）
   ---------------------------------------------------------
   改造前营地是局内的，所以"建/拆了立刻生效"由 `market.recalcCampFx` 当场写回
   `S.campFx` 与 `S.salvageRate`。现在设施在**档案**里（经营场景随买随变），
   于是需要一条"档案变了 → 会话重新折一次"的单向通道：

     经营场景改设施（Profile.campBuy / campSell）
       → `Game.campFacilitiesChanged()`
         → `salvageRate` 重折 + `recalcStats()`

   只重算**真的被冻进会话的那一个派生值**（回收比例）。制造的费用与档位
   不缓存（每次现读 `Profile.campFx()`），因为它们在经营场景里变，
   缓存下来就会出现"盖了熔炉这局却不省料"。
   ========================================================= */
/** 回收比例 = 底价 0.5 + 图纸「废料回收」 + 工坊「回收炉」（夹 0.9） */
function campSalvageRate(fmods) {
  var campFx = campEffects();
  return Math.min(0.9,
    Weapons.salvageRate + ((fmods && fmods.salvageBonus) || 0) + (campFx.salvageBonus || 0));
}

/* 工坊的读出口（都在**会话**上，不碰账号档案） */
/** 这一局建的工坊设施（id → 等级） */
function campOwned() { return (S && S.camp) || {}; }
/** 建造顺序（只保留"真的建了"的设施，且每项只出现一次） */
function campRow() {
  if (!S) return [];
  var owned = S.camp, src = S.campRow || [], out: string[] = [];
  for (var i = 0; i < src.length; i++) {
    var id = src[i];
    if (owned[id] > 0 && out.indexOf(id) < 0) out.push(id);
  }
  return out;
}
/** 工坊效果的折叠结果（每次改动后重算并存进会话，读的时候直接用） */
function campEffects() {
  if (!S) return Camp.effects({}, []);
  if (!S.campEffects) S.campEffects = Camp.effects(campOwned(), campRow());
  return S.campEffects;
}
/** 这一局用掉的设施位 */
function campLines() { return Camp.usedSlots(campOwned()); }
/** 某个工坊设施的等级（0 = 没建） */
function campLevel(id) { return Camp.levelOf(campOwned(), String(id || '')); }

/** 经营场景改完工坊之后调它：重算派生值（没有会话时是空操作） */
function refreshCampFx() {
  if (!S) return false;
  S.campEffects = Camp.effects(campOwned(), campRow());
  S.salvageRate = campSalvageRate(S.fmods);
  recalcStats();
  return true;
}

/* =========================================================
   **据点 = 局内的东西**（M1 第二块，2026-09）
   ---------------------------------------------------------
   设计上下文 v3 §二：三个模块**全在局内**。据点属于**经营模块**
   （它是"建造子模块"的那一半：设施 / 升级 / 布局 / 空间），
   所以它的等级是**这一局**的状态。

   ⚠ 这里以前写的是反面（`run_save.ts`）：
     "设施与建造顺序是**跨局资产**…三者都不该按局清零。"
   于是 `S.keep` 只是**开局快照**：`newRun` 从账号读一次、折成 `S.kmods`，
   之后一局里再也不变。现在它是**活的**：`Game.keepBuy` 直接写它，
   改完立刻 `refreshKeepFx()` 重折 —— 与工坊那边 `refreshCampFx` 同一套路。

   为什么"重折"这一步不能省：`S.kmods` 里的每个键（货架位 / 免费刷新 /
   工坊位 / 开局材料）都是**开局折一次**的，模拟里不回表。买了设施不重折，
   就会出现"盖了仓库这一局却没有仓库的效果"。
   ========================================================= */
/** 改完据点之后调它：把 `S.kmods` 从 `S.keep` 重折一遍（没有会话时是空操作） */
function refreshKeepFx() {
  if (!S) return false;
  S.kmods = Stronghold.modsFor(S.keep);
  /* 开局材料是**开局那一刻**发的一次性东西（`newSession` 里发过）——
     中途盖仓库**不再补发**，否则"先打再盖"和"先盖再打"会不等价。
     但免费刷新那一档是**每波**读的（`startWave`），所以它会立刻生效。 */
  recalcStats();
  return true;
}
/** 这一局已经建了哪些据点设施（id → 等级）。**局内**状态。 */
function keepOwned() { return (S && S.keep) || {}; }
/** 某个据点设施的等级（0 = 没建）。界面与测试都读它，不自己 `levelOf`。 */
function keepLevel(id) { return Stronghold.levelOf(keepOwned(), String(id || '')); }
/** 据点折叠出来的修正（`S.kmods`；界面与模拟都读它，不自己算） */
function keepMods() { return (S && S.kmods) || Stronghold.modsFor({}); }
/** 在这一局里往据点投了多少材料 */
function keepInvested() { return Stronghold.invested(keepOwned()); }

/* 图纸（局内）：已解锁的集合在 `S.forge`，折叠修正在 `S.fmods`。
   ⚠ 本轮只搬了"集合住在哪"，**没动"用哪笔钱解锁"** —— 见会话里 `forge` 那段说明。 */
/** 这一局已解锁的图纸（id 数组） */
function forgeOwned() { return S ? Object.keys(S.forge || {}) : []; }
/** 某张图纸解锁了吗 */
function isForged(id) { return !!(S && S.forge && S.forge[String(id || '')] === true); }
/** 图纸折叠出来的修正（界面与模拟都读它，不自己算） */
function forgeMods() { return (S && S.fmods) || Forge.emptyMods(); }


/* =========================================================
   制造（经营那一根柱子的出口）
   ---------------------------------------------------------
   **一次制造 = 一条产线的一波**。规则与费用全在 craft.ts / camp.ts / forge.ts，
   这里只负责改会话状态：扣材料、把产物放进装备栏、记账、发事件。
   为什么"占产线的一波"这件事必须在模拟层：它是经营**自己的稀缺**
   （位子只有 3 个、每波每条只出一件），也是"这一波投产线还是投自己"这个
   取舍的真正来源 —— 放在界面里就只是冷却计数了。

   ⚠ **营地搬出局外之后，这一节有三处换了口径**：
     · 设施与建造顺序读 `Profile`（跨局），不再读会话；于是"这条产线"是
       **你账号上真有的那座设施**，不是这一局临时盖的
     · 钱从**废料**换成**材料**（用户拍板："材料靠战斗获得，玩家自己花材料打造"）
     · 折叠效果每次现算（`Profile.campFx()`）：设施在经营场景里随买随变，
       缓存进会话就会出现"盖了熔炉这局却不省料"
   ========================================================= */
/** 这一局有几条产线（**账号上已建**的设施 + 图纸给的名额） */
function craftLineCount() {
  if (!S) return 0;
  return Craft.linesOf(campLines(), S.fmods);
}
/** 现在还空着的产线号（界面按它画按钮；空数组 = 这一波的产线都用完了） */
function craftFreeLines() {
  var out = [];
  var n = craftLineCount();
  for (var i = 0; i < n; i++) if (Craft.lineFree(S.craftUsed, i)) out.push(i);
  return out;
}
/** 能造的配方 + 费用 + 能不能造（界面铺一屏用它；**不写任何规则**） */
function craftOptions(): Array<{
  id: string; kind: 'weapon' | 'item'; refId: string; name: string; tier: number;
  cost: number; ok: boolean; reason: string; affordable: boolean;
}> {
  if (!S) return [];
  return Profile.craftOptions(S.fmods, material(), campEffects());
}
/**
 * 造一件。
 * @param line 用哪条产线（这一波还没用过的那条）
 * @param id   配方 id（`weapon:knife` / `item:coffee`）
 * 失败一律**不动任何状态**（材料、产线都不扣）—— 与买装备同一条纪律。
 */
function craft(line, id) {
  if (!S) return false;
  /* 与买 / 卖 / 建同一道门：制造只能在**商店、工坊或经营场景**里做。
     以前这里没有状态校验 —— 接口上"战斗中也能造一件"，界面虽然不画那个按钮，
     但一个不一致的调用点（或未来的机器人 / 新界面）就能在枪林弹雨里凭空变出装备。 */
  if (!requireStateIn(['shop', 'camp', 'keep'], 'craft')) return false;
  var r = Craft.BY_ID[id];
  if (!r) return deny('没有这个配方');
  var n = craftLineCount();
  if (n <= 0) return deny('还没有产线 —— 先到经营场景盖一座设施');
  if (!(line >= 0 && line < n)) return deny('没有这条产线');
  if (!Craft.lineFree(S.craftUsed, line)) return deny('这条产线这一波已经造过了');
  var chk = Craft.canMake(r, S.fmods);
  if (!chk.ok) return deny(chk.reason);
  var campFx = campEffects();
  var cost = Craft.costOf(r, S.fmods, campFx);
  var p = S.player;
  if (material() < cost) return deny('材料不够（需要 ' + cost + '）');
  /* **先掷出来是"哪一档"，再按它探路**。
     顺序不能反：营地的「锻台 / 检验台」与图纸「淬火」会把结果抬一档，
     如果按配方自己的档位去探"放得下吗"，就会出现"探的是 T2、造出来是 T3"——
     槽满时 T3 可能没有同名同档可以并，于是材料花了、产线也用掉了，什么都没拿到。
     （这一支是极端情况，但它是**静默**的，所以两件事一起做：先按真实档位探路，
     万一落位还是失败，就把材料与产线**退回去**，绝不吞。） */
  var res = Craft.resultTier(r, S.fmods, campFx, S.rnd);
  if (r.kind === 'weapon' && p.weapons.length >= maxWeapons()) {
    var def = Weapons.BY_ID[r.refId];
    var probe = { id: r.refId, def: def, cd: 0, swing: 0, tier: res.tier };
    if (Weapons.partnerOf(p.weapons, probe, -1, fuseDiff()) < 0) {
      return deny('武器槽满了，而且没有同名同档可以并 —— 先回收一件');
    }
  }
  if (!spendMaterial(cost)) return deny('材料不够（需要 ' + cost + '）');
  S.craftUsed.push(line);
  var got = r.name;
  if (r.kind === 'weapon') {
    /* `cost` 作为 `paid` 一起交给落位：回收价的上限就是它（+1 的净亏），
       所以"造了立刻拆"不会变成无限产出 —— 哪怕质量触发把回收价抬了一倍 */
    var placed = addWeaponOrCombine(r.refId, res.tier, cost);
    if (!placed.ok) {                                  // 理论上到不了；真到了就把账退回去
      addMaterial(cost);
      S.craftUsed.pop();
      return deny(placed.why);
    }
  } else {
    addItem(Items.BY_ID[r.refId]);
    if (res.double) addItem(Items.BY_ID[r.refId]);
  }
  recalcStats();
  p.hp = Math.min(p.hp, S.stats.maxHp);
  S.craftCount = (S.craftCount || 0) + 1;
  Game.events.emit('craft', {
    id: r.id, name: got, kind: r.kind, tier: res.tier, lucky: res.lucky,
    double: res.double, cost: cost, line: line
  });
  return true;
}

/* 三处读武器数值的地方都要过**品级台阶**（Weapons.mul），
   并且都要过**这一把自己的词条**（`w.wmods`，由 recalcStats 折一次写好）。
   以前这里直接读 def.*，于是"合成出来的 T4 匕首"和 T1 匕首一模一样 ——
   数值必须从同一个出口出去，否则"变强了"只是界面上写着的一句话。
   `wmods` 缺省 = `{ weaponDmgPct: 1, weaponCdPct: 1 }`，乘上去恒等 ——
   老存档 / 手工造的对象（测试、调试、演示）没有它也一样跑。 */
function weaponMul(w, key) {
  var m = w && w.wmods;
  var v = m ? Number(m[key]) : 1;
  return isFinite(v) && v > 0 ? v : 1;
}

function weaponDamage(w) {
  var s = S.stats;
  var def = w.def;
  var base = def.dmg * Weapons.mul(w, 'dmg') * weaponMul(w, 'weaponDmgPct') * Stats.damageMul(s, def);
  if (def.type === 'melee') base += s.meleeDmg * 0.55;
  else base += s.rangedDmg * 0.55;
  if (def.elemental) base += s.elementalDmg * 0.4;
  if (def.engineering) base += s.engineering * 0.5;
  return Math.max(1, base);
}

function weaponReach(w) {
  return w.def.reach * Weapons.mul(w, 'reach') * Stats.rangeMul(S.stats);
}

function weaponCd(w) {
  return Math.max(0.05, w.def.cd * Weapons.mul(w, 'cd') * weaponMul(w, 'weaponCdPct') * Stats.cooldownMul(S.stats));
}

/* =========================================================
   开局条件（天赋的唯一出口）
   ---------------------------------------------------------
   `opening` 是一份纯数据：{ stats, weapons, items, scrap }。
   它由 talents.ts 折出来，由 **接入层** 传进来 ——
   模拟层不认识"天赋""角色养成"这些词，只看到一份起始状态。
   这是"养成只能改开局条件"这条约束的落地方式：
   要越界就得先往这个对象里加字段，而它只覆盖起始属性/起始携带/起始废料。
   ========================================================= */
function sanitizeOpening(opening) {
  var o = opening && typeof opening === 'object' ? opening : {};
  var stats: Record<string, number> = {};
  var src = (o.stats && typeof o.stats === 'object') ? o.stats : {};
  for (var i = 0; i < Stats.KEYS.length; i++) {
    var k = Stats.KEYS[i];
    var v = Number(src[k]);
    if (isFinite(v) && v !== 0) stats[k] = v;
  }
  function ids(list) {
    var out = [];
    if (!list || !list.length) return out;
    for (var j = 0; j < list.length; j++) if (typeof list[j] === 'string' && list[j]) out.push(list[j]);
    return out;
  }
  /* 经济修正（天赋"经营扇区"的产物）。
     只认 ECON 的这几个键 —— **键名与据点/营地一致，没有改名层**，
     所以"声明了却没人读"能被静态检查直接抓出来。
     上限与据点/营地同一套：折扣 ≤0.6、复利倍率 ≤0.5、每波废料 ≤60
     （test/talents.mjs 会拿 Talent.ECON_CAP 逐个对照这里的行为，防两份数值漂移）。
     全 0（空开局）= 恒等，这是行为指纹不受影响的前提。 */
  var ECON_CAPS: Record<string, number> = {
    shopDiscount: 0.6, campDiscount: 0.6, rerollDiscount: 0.6, sporeMul: 0.85, waveIncome: 60
  };
  var econ: OpeningEcon = { shopDiscount: 0, campDiscount: 0, rerollDiscount: 0, sporeMul: 0, waveIncome: 0 };
  var econSrc = (o.econ && typeof o.econ === 'object') ? o.econ : {};
  for (var ek in econ) {
    if (!Object.prototype.hasOwnProperty.call(econSrc, ek)) continue;
    var ev = Number(econSrc[ek]);
    if (!isFinite(ev) || ev <= 0) continue;
    econ[ek] = Math.min(ECON_CAPS[ek], ev);
  }
  return {
    stats: stats,
    weapons: ids(o.weapons),
    items: ids(o.items),
    scrap: Math.max(0, Math.round(Number(o.scrap) || 0)),
    /* **开局材料**（全局货币）。
       为什么要在这里开一个口：`S.material` 是**局内余额**（M1），
       而录制回放（`record.ts`）**只录离散命令**，`Game.addMaterial` 不在命令表里 ——
       所以"测出来的开局资金"必须走 `newRun` 的实参，回放时才重建得出来。
       语义上与据点给的 `startMaterials` 是同一类东西（都是开局条件）。 */
    material: Math.max(0, Math.round(Number(o.material) || 0)),
    econ: econ
  };
}

/** 起始属性：并进 p.base（与角色固有属性同一套单位） */
function applyOpening(p, opening) {
  var o = sanitizeOpening(opening);
  for (var k in o.stats) {
    if (Object.prototype.hasOwnProperty.call(o.stats, k)) p.base[k] += o.stats[k];
  }
}

/** 起始携带：额外武器 / 额外道具 / 起始废料 */
function applyOpeningExtras(p, opening) {
  var o = sanitizeOpening(opening);
  var i;
  for (i = 0; i < o.weapons.length; i++) addWeapon(o.weapons[i]);
  for (i = 0; i < o.items.length; i++) {
    var def = Items.BY_ID[o.items[i]];
    if (def) addItem(def);
  }
  if (o.scrap) p.scrap = (p.scrap || 0) + o.scrap;
  if (o.material) addMaterial(o.material);
}

/** 只留数字的映射（据点设施等级那种） */
function cloneNumMap(src) {
  var out: Record<string, number> = {};
  for (var k in (src || {})) {
    if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
    var v = Number(src[k]);
    if (isFinite(v) && v > 0) out[k] = Math.floor(v);
  }
  return out;
}

/* =========================================================
   地牢：房间内容（地图层 → 玩法层的接缝）
   ---------------------------------------------------------
   每一种房型"进门就发生什么"写在下面这张表里，模拟层只按 id 查表 ——
   所以加一种房型 = dungeon.ts 加一行 + 这里加一行内容，不用在 step/endWave 里
   再塞一个 if。覆盖检查在 test/rooms.mjs：**房型没有内容** = 玩家走进去
   什么都不发生（那正是"浅尝辄止"的样子）。

   表里的数字（货架 +2、九折、+3 建材…）就是这一间的全部份量，
   它们都写在表里而不是散在函数里：想调"商店房到底多给多少"，只改这一处。
   ========================================================= */
interface RoomFxDef {
  note: string;
  /** 进门时的一次性效果；返回给人看的一句（没有就返回 null） */
  enter?: (p: Player, room: DungeonRoom) => string | null;
  /** 在**这一间**里开的商店：多几件货 / 打几折 */
  shopSlots?: number;
  shopDiscount?: number;
  /** 这一间把"速清/超时"两档奖励换成什么（限时房用；0 = 用全局配置） */
  fastMul?: number;
  slowMul?: number;
}

/** 事件房的遭遇表：每一个都是"代价与好处并存"，挑一个由 S.rnd 决定（可复现） */
var ROOM_EVENTS: RoomEventDef[] = [
  {
    id: 'cache', name: '补给箱', note: '白给一批废料（没有代价）',
    apply: function () {
      var m = 30 + Game.wave * 6;
      S.player.scrap += m; S.stats_total.scrap += m; S.waveScrap += m;
      return '补给箱：+' + m + ' 废料';
    }
  },
  {
    /* ⚠ 这一条的代价口径**换了主人**。改造前它捐的是"建材"（局内那笔专门盖工坊的钱），
       建材随营地搬出局外一起被删掉了。现在它捐的是**这一局已经打出来的材料** ——
       也就是从 `S.stats_total.scrap` 里真的扣掉一笔（`buildSummary` 的 `earned`
       就是它），所以"带出去的材料变少"是真的会发生的事，不是一句话。

       为什么从"总量"里扣而不是扣 `p.scrap`：`p.scrap` 是**局内废料余额**
       （商店与刷新花的），扣它只是"少买一件"；扣总量才是"这一局白打了一段"。
       两个都列在这里，因为它们是这两笔钱各自真正的含义。 */
    id: 'shrine', name: '孢子神龛', note: '生命上限 +6，但这一局打出来的材料要捐掉三成',
    apply: function () {
      var p = S.player;
      var took = Math.round(S.stats_total.scrap * 0.3);
      S.stats_total.scrap = Math.max(0, S.stats_total.scrap - took);
      p.upgrades.maxHp += 6;
      recalcStats();
      p.hp = Math.min(S.stats.maxHp, p.hp + 8);
      return '孢子神龛：生命上限 +6（捐掉本局 30% 材料 ≈ ' + took + '）';
    }
  },
  {
    id: 'forge', name: '废弃锻造台', note: '免费刷新 ×4，代价是这一间的废料奖励减半',
    apply: function () {
      S.freeRerolls += 4;
      S.bonusMul = 0.5;
      return '废弃锻造台：刷新 ×4（这一间奖励减半）';
    }
  },
  {
    id: 'pact', name: '血契', note: '立刻损失当前生命的 15%，换一大笔废料',
    apply: function () {
      var p = S.player;
      var cost = Math.max(1, Math.round(p.hp * 0.15));
      p.hp = Math.max(1, p.hp - cost);
      var m = 40 + Game.wave * 8;
      p.scrap += m; S.stats_total.scrap += m; S.waveScrap += m;
      return '血契：-' + cost + ' 生命，+' + m + ' 废料';
    }
  }
];

var ROOM_EVENT_BY_ID: Record<string, RoomEventDef> = Object.create(null);
for (var rei = 0; rei < ROOM_EVENTS.length; rei++) ROOM_EVENT_BY_ID[ROOM_EVENTS[rei].id] = ROOM_EVENTS[rei];

var ROOM_FX: Record<string, RoomFxDef> = {
  start: {
    note: '入口间：安全，进门回一点血',
    enter: function () {
      var h = Math.round(S.stats.maxHp * 0.15);
      settleHeal(h);
      return '入口间 · 回血 ' + h;
    }
  },
  fight: { note: '普通遭遇：按当前层与波次刷一批怪' },
  elite: {
    /* 精英房 = **废料的收集点**。
       改造前它是笔亏账：整批精英化（更硬更疼）却和普通房拿一样的东西 ——
       所以玩家没有理由进去，房型表上那一行等于不存在。
       现在它给一笔明显的废料（按波次放大），于是"要不要拿命换这一笔"才是决定。 */
    note: '精英房：整批精英化（更硬更疼），但打完有一大笔废料**和一笔材料**',
    enter: function () {
      var m = 30 + Game.wave * 8;
      S.player.scrap += m; S.stats_total.scrap += m; S.waveScrap += m;
      /* 营地在局外之后，房型表里原本给"建材"的那几行改发**材料** ——
         这就是"材料靠战斗获得"在房间这一层的落点，也是经营那条循环的燃料。
         直接进钱包（而不是像废料那样先记在会话里、结算再入账）：
         材料**当场**就要能在经营场景里花掉，否则"打一场 → 回工坊造一件"
         这个循环中间会缺一环。重复入账不会发生 —— `earned` 只算废料。 */
      var mat = 6 + Game.wave * 2;
      gainMaterial(mat);
      return '精英：+' + m + ' 废料 · +' + mat + ' 材料';
    }
  },
  treasure: {
    /* 宝箱房 = **装备的收集点**（改造前它只是"又一笔废料"，与战斗房没有区别）。
       给的是已有的 24 把武器 / 29 件道具里的一件 —— **不新造任何东西**。
       武器放不下时退成道具（道具没有上限），所以"进宝箱"永远不会白进。 */
    note: '宝箱房：白给一件装备（武器或道具）',
    enter: function () {
      var wantWeapon = S.rnd() < 0.5;
      var got = '';
      /* 档位上限来自**品级表**（`Items.maxTierFor` → `Tiers.capFor`）：只从"这一波
         买得到的档位"里挑，宝箱不该直接给通关级的货。这句阶梯以前在这一段里
         内联写了两遍 —— 加一档时它会**静默地**不给新档。 */
      var cap = Items.maxTierFor(Game.wave);
      if (wantWeapon) {
        var pool = Weapons.LIST.filter(function (w) { return (w.tier || 1) <= cap; });
        var pick = pool[Math.floor(S.rnd() * pool.length)] || Weapons.LIST[0];
        var res = addWeaponOrCombine(pick.id, 0);
        if (res.ok) got = pick.name + '（' + (res.combined ? 'T' + res.tier + '，与第 1 格同名并档' : 'T' + res.tier) + '）';
      }
      if (!got) {
        var ipool = Items.LIST.filter(function (d) { return (d.tier || 1) <= cap; });
        var ipick = ipool[Math.floor(S.rnd() * ipool.length)] || Items.LIST[0];
        addItem(ipick);
        recalcStats();
        got = ipick.name + '（道具）';
      }
      var mat = 8;
      gainMaterial(mat);
      return '宝箱：' + got + ' · +' + mat + ' 材料';
    }
  },
  shop: {
    note: '商店房：货架多两件，这一间里买东西打九折',
    shopSlots: 2, shopDiscount: 0.10,
    enter: function () { return '商店房：货架 +2 · 本间九折'; }
  },
  camp: {
    /* 补给房 = **材料的收集点**（材料是工坊唯一的本钱，造装备全靠它） */
    note: '补给房：进门回血、一批材料，可以就地开工',
    enter: function () {
      var h = Math.round(S.stats.maxHp * 0.25);
      settleHeal(h);
      var mat = 10 + Game.wave * 2;
      gainMaterial(mat);
      return '补给房：回血 ' + h + ' · 材料 +' + mat;
    }
  },
  event: {
    note: '事件房：随机一次遭遇，代价与好处并存',
    enter: function (p, room) { return rollRoomEvent(p, room); }
  },
  boss: { note: '关底：这一层的 Boss 守在这里（打完就下一层）' },
  rush: {
    note: '限时房：时限砍半，按时打完奖励翻倍、超时几乎什么都没有',
    fastMul: 1.8, slowMul: 0.45,
    enter: function () { return '限时房：时限砍半 —— 抢时间'; }
  },
  secret: {
    /* 密室 = **合金的收集点**（合金是图纸树唯一的稳定来源；平时只能靠回收装备换）。
       它已经在"进门要付点东西"那一档里（先找到裂纹、花时间砸开墙），
       所以给它独占产出是合理的：这是全游戏唯一一处"代价换独占"的地方。 */
    note: '密室：藏起来的东西 —— 要先打穿那道有裂纹的墙；里面是合金与一笔废料',
    enter: function () {
      var m = 60 + Game.wave * 10;
      S.player.scrap += m; S.stats_total.scrap += m; S.waveScrap += m;
      var mat = 14;
      gainMaterial(mat);
      var alloy = 2 + Math.floor(Game.wave / 6);
      S.growth = (S.growth || 0) + alloy;
      S.secretsFound = (S.secretsFound || 0) + 1;
      Game.events.emit('secretFound', { room: S.roomId, floor: S.floor, count: S.secretsFound, alloy: alloy });
      bark('secret');
      return '密室：+' + m + ' 废料 · +' + mat + ' 材料 · 合金 +' + alloy;
    }
  }
};

function rollRoomEvent(p, room) {
  var idx = Math.floor(S.rnd() * ROOM_EVENTS.length);
  if (idx >= ROOM_EVENTS.length) idx = ROOM_EVENTS.length - 1;
  var ev = ROOM_EVENTS[idx];
  var msg = ev.apply(p, room);
  // 记下"这一局见过这条遭遇"：剧情碎片与图鉴都要用（模拟层只记 id）
  if (S.runEvents.indexOf(ev.id) < 0) S.runEvents.push(ev.id);
  Game.events.emit('roomEvent', { id: ev.id, name: ev.name, note: ev.note, msg: msg });
  return '事件 · ' + ev.name + '：' + msg;
}

/** 给人看的一行（界面用；**不要**在 ui.ts 里硬编码房型文案） */
Game.roomFxNote = function (type) {
  var fx = ROOM_FX[type];
  return fx ? fx.note : '';
};
Game.ROOM_FX = ROOM_FX;
Game.ROOM_EVENTS = ROOM_EVENTS;

/* ---------------- 地图状态：当前层 / 当前房 / 破过的墙 ----------------
   实现已搬到 `chamber.ts`（"玩家在这一层走到哪了"是它管的四件事之一）。
   这里保留**同名转发**：本文件里有 40 多处调用点，而转发让这次拆分对
   其余部分完全透明（少改 40 处 = 少 40 个出错的机会）。
   ⚠ `Ch` 在文件顶部（`S` 之后）就建好了 —— 不要在这里再 `makeChamber` 一次，
   那会得到第二个实例，它自己的 `wallsNow` 之类状态与这个不同步。
   ⚠ 转发**不是**空壳：`ctx.session()` 每次现取 `S`，所以换局之后旧会话不会被留住。 */
function currentRoom() { return Ch.currentRoom(); }
function doorPoint(dir) { return Ch.doorPoint(dir); }
function dirTo(a, b) { return Ch.dirTo(a, b); }
function roomAtDir(cur, d) { return Ch.roomAtDir(cur, d); }
function seeRoom(id) { return Ch.seeRoom(id); }
function doorNearby() { return Ch.doorNearby(); }
function recalcWalls() { Ch.recalcWalls(); }
function hitWalls(x0, y0, x1, y1, r, dmg) { return Ch.hitWalls(x0, y0, x1, y1, r, dmg); }
function breakWall(from, to, x?, y?) { return Ch.breakWall(from, to, x, y); }
function enterFloor(f, opt?) { Ch.enterFloor(f, opt); }
function floorMeanDepth() { return Ch.floorMeanDepth(); }
function depthBonus(floor, depth) { return Ch.depthBonus(floor, depth); }


/**
 * 把一组"与 danger 同键名"的修正折进目标对象。
 *
 * 折法取自 **`ops`**（声明这些键的那张表），所以不会出现"两处各写一套怎么折"；
 * 而且**只认目标里已经有的键** —— 契约若声明了一个 wmods 里没有的键，
 * 这里会静默跳过（不凭空塞键），测试负责把这种"声明了没人读"抓出来。
 *
 * ⚠ 这里以前写的是"折法取自 `Danger.FOLD`（唯一来源）" —— **那句话是错的**：
 * 契约的折法由 `boons.MOD_KEYS` 声明，而 `boons.apply` 读的正是它。
 * 于是同一个键有两份声明，改一份不会同步（实测：把 boons 的 `enemyHp` 改成 `'add'`，
 * `boons.apply` 做加法、这里做乘法，而 17 道门全绿）。
 * 现在折谁的就读谁的表 —— 调用方把那张表传进来。
 */
function foldInto(target, mods, ops) {
  if (!target || !mods) return target;
  for (var k in mods) {
    if (!Object.prototype.hasOwnProperty.call(mods, k)) continue;
    if (!(k in target)) continue;
    target[k] = Fold.num(ops[k] || 'add', target[k], mods[k]);
  }
  return target;
}

/* =========================================================
   波次
   ========================================================= */
function startWave(n) {
  Game.wave = n;
  S.waveT = 0;
  S.waveScrap = 0;
  S.waveEnding = false;
  S.forceClear = false;
  /* 这一间的奖励倍率：**深度的回报**先铺上（层号 + 这一间在层里有多深，见 depthBonus），
     事件房之类的"代价与好处并存"再在它上面乘（applyRoomEntry 里的 roomFx/事件）。 */
  var curRoom = currentRoom();
  S.bonusMul = depthBonus(S.floor, curRoom ? curRoom.depth : 0);
  S.time = 0;
  // 难度修正整份交给 buildWave（键名与 danger.ts 一致，不做映射层）；
  // 地牢（房型 + 层主题）再折一层进来 —— 仍然是**开局/进房算一次，模拟里不回表**
  S.wmods = Dungeon.foldMods(S.dmods, S.map, S.roomId);
  /* 层间契约的**敌人那一组**也折进同一份（同一套键名，折法取自它自己那张表）——
     于是 buildWave / spawnEnemy 一行都不用改，"契约说这层敌人更虚"必然生效。 */
  if (S.boonFold) foldInto(S.wmods, S.boonFold.enemy, Boons.OPS);
  // 时限：难度/房型/契约三处都折在 wmods.waveTime 上（它本来就在 danger 的键集里）
  S.waveLeft = Game.cfg.waveTime(n) * (S.wmods.waveTime || 1);
  /* Boss 由**层**决定（不是这里随机挑）：同一层永远是同一只，
     地图、Boss、剧情碎片三者才不会各说各话。非 Boss 房传 null。 */
  var room = currentRoom();
  var bossId = (room && room.type === Dungeon.BOSS_TYPE) ? Enemies.bossFor(S.seed, S.floor) : null;
  S.bossId = bossId;
  S.spawnQueue = Enemies.buildWave(n, S.rnd, S.wmods, bossId);
  S.spawnIdx = 0;
  S.arena = Arena.build(n, S.map ? S.map.theme : null);
  S.decals.length = 0;
  S.decalSeq = 0;
  S.decalCursor = 0;
  S.stainBudget = Game.cfg.stainBurst;
  S.enemies.length = 0;
  S.bullets.length = 0;
  S.ebullets.length = 0;
  S.pickups.length = 0;
  Emit.clear();          // 粒子回收到自由链表，而不是直接丢数组
  S.turrets.length = 0;
  S.grid.map = Object.create(null);

  var p = S.player;
  p.x = Arena.W / 2; p.y = Arena.H / 2;
  p.px = p.x; p.py = p.y;      // 插值基准同帧对齐：换房时不会拉出一条横穿战场的残影
  p.invuln = 1.2;

  // 工程学炮塔（件数来自 recalcStats 折好的 `S.itemFx`，不再每波扫一遍道具）
  var turrets = (S.itemFx && S.itemFx.turret) || 0;
  /* 工坊**不给炮塔、不给回血、不给刷新了**（这一步解耦的核心）：
     它以前是"给战斗挂被动"的面板，现在是制造车间 —— 它的产物是装备与道具，
     由玩家在工坊里自己造（Game.craft）。战斗数值的唯一来源回到：
     属性加点 / 道具 / 武器 / 层间契约。 */
  for (var t = 0; t < turrets; t++) {
    var ang = (t / Math.max(1, turrets)) * U.TAU;
    S.turrets.push(Comp.spawn('turret', {
      x: p.x + Math.cos(ang) * 90, y: p.y + Math.sin(ang) * 90,
      hp: 40 + S.stats.engineering * 3, maxHp: 40 + S.stats.engineering * 3,
      r: 18
    }));
  }

  // 据点钟楼：每波白送的刷新次数
  S.freeRerolls = (S.kmods && S.kmods.freeRerolls) || 0;

  /* 生产线**每波重置一次**：这是经营那一侧的"回合"。
     每条产线每波只能造一件 —— 于是"这一波造什么、造不造"是真决定，
     而空着的产线就是浪费（它自己的失败状态，不需要额外的惩罚机制）。 */
  S.craftUsed = [];
  /* **经营模块每波自己运转一次**（M2）：产出 = 基础 + 设施产出。
     ⚠ 之所以有一个不依赖设施的底数，见 `Stronghold.CAPACITY_BASE` 那段说明 ——
       没有它，开局 0 设施 → 0 产能 → 建不了设施，是个把自己锁死的循环。 */
  addCapacity(Craft.capacityYield(keepOwned(), (S.kmods && S.kmods.capacityBonus) || 0));
  /* **相处次数也跟着每波重置**：它与 `craftUsed` 是同一个东西（模块内的回合数），
     只是分别属于经营与养成两条线。放一起才看得出来它们是同一套时间感。 */
  S.talks = {};

  /* 建材那一笔**没有了**：材料现在只从"打"，不从"到账"（宝箱 / 精英 / 补给 /
     密室四处 + 每只怪的掉落）。每波白送材料会让"打得好不好"与"经营能做什么"
     脱钩 —— 那正是改造前"先攒钱盖房"越过战斗的那条捷径。 */

  /* 天赋"经营"扇区 / 道具套装：每波到账的**材料**。
     `waveIncome`（天赋表里的键名）说的就是材料 —— "每波 +8 材料"。
     与击杀**脱钩**是刻意的：材料几乎全部来自击杀时，"更能打"本身就是最好的经济，
     经济流会被战力流完全支配（实测出来的结论，见下面那段）。
     Brotato 的 Harvesting 就是每波结算的，这里照抄那一点。

     ⚠ **这里曾经发的是废料**（`p.scrap`），而键名、天赋文案（"每波 +8 材料"）、
     `talents.ts` 的键说明（"每波开始到账的**材料**"）三处说的都是材料 ——
     键名与实现分叉，工具与文档都跟着说错。它不会报错，只会让
     "经济流"换个货币变富：实测经济流 5 点的**废料**多 50%、而**材料**只多 25%
     （那 25% 来自 `harvesting`），于是 `tools/balance.mjs` 报
     "战斗流在所有指标上都不弱于其他配置 —— 等于没有选择"。
     根因就是这一行：经济流拿到的不是它该拿的那种钱。
     材料与废料**不能互换**：材料是制造业（造武器 / 造道具 / 盖产线）的本钱，
     废料是商店（买装备 / 刷新 / 开包）的本钱 —— 两种货币各自对应一条花法，
     发错哪一种等于把玩家的选择换掉了。 */
  /* 两个来源相加：天赋经济扇区 + 道具套装的档位（同一套键名 `waveIncome`，
     所以这里只多一项相加，不需要第二条读点）。 */
  var waveIncome = Math.round(
    ((S.omods && S.omods.waveIncome) || 0) +
    ((S.itemSets && S.itemSets.econ && S.itemSets.econ.waveIncome) || 0));
  if (waveIncome > 0) gainMaterial(waveIncome);

  Game.events.emit('waveStart', n);
}

function endWave() {
  if (S.waveEnding) return;
  S.waveEnding = true;
  /* 超时那一档要在**清掉标记之前**读：forceClear 是"这一间超时了"的唯一事实，
     而 endWave 一开头就会把它复位（startWave 才是它该被复位的地方）。 */
  var overran = S.forceClear;
  S.forceClear = false;
  /* 波次奖励 = 基础 × 收获 × 事件房倍率 × 速清/超时 × **契约的经济那一组**。
     速清/超时两档可以被**房型**改写（限时房：按时打完翻倍、超时几乎什么都没有），
     所以这里先问 roomFx，再退回全局配置。 */
  var rfx = S.roomFx || {};
  var speedMul = overran
    ? (rfx.slowMul || Game.cfg.overrunBonus)
    : (rfx.fastMul || Game.cfg.clearBonus);
  var bonus = Math.round((8 + Game.wave * 3) * harvestMul() * (S.bonusMul || 1) * speedMul * econMul('bonusMul') * itemCostMul('matMul'));
  S.stats_total.scrap += bonus;
  S.player.scrap = (S.player.scrap || 0) + bonus;

  /* **清间的材料**（`material`，带得出局的那一笔）。
     ⚠ 这一条是端到端模拟时补上的，理由值得写下来：
     删掉"每波白送建材"之后，材料只剩下宝箱 / 精英 / 补给 / 密室**四种房间**这一个来源 ——
     而普通战斗房一分不给。实测（`tools/tmp-loop-e2e` 那次的发现）：玩家清完第一间
     拿到 **0 材料**，连最便宜的一座设施（2）都盖不起，于是"打 → 拿材料 → 造 → 再打"
     这条循环在**真实游玩里是断的**；测试没发现是因为它们直接发材料。

     它与被删掉的"每波白送"有本质区别，这也是它能留下的理由：
       · 旧的那条是**无条件到账**（活得久就拿），与"打得好不好"无关
       · 这一条挂在**清间**上，而且随波次增长 —— 打不完、被时限逼着狂暴，就拿不到
     量与房间产出同级（房间是"进去了就有"，这里是"清掉了才有"）。 */
  var matClear = Math.round((4 + Game.wave * 1.5) * harvestMul());
  if (matClear > 0) gainMaterial(matClear);
  S.stats_total.waves++;

  var room = currentRoom();
  if (room) { room.cleared = true; room.seen = true; }
  Game.events.emit('waveClear', {
    wave: Game.wave, bonus: bonus,
    room: room ? room.id : null, type: room ? room.type : null
  });
  bark('waveClear');

  /* 关底：打完**最后一层**的 Boss 房 = 通关。
     改造前的通关条件是"撑到第 finalWave 波并清场"，有了楼层之后那个条件是错的：
     一局的长度现在由**地图**决定（三层的房间数），波次只是全局进度计数。
     硬留 finalWave 会造成"地图还没走完就强制结算"—— 实测过一版，第 20 波把玩家
     从第二层中间踢进结算画面。 */
  if (room && room.type === 'boss') {
    if (S.floor >= Dungeon.FLOORS) { winRun(); return; }
    enterFloor(S.floor + 1);
    // 新一层的入口间是**安全房**：不打一波、直接算已清（否则玩家会卡在"门锁着"）
    var nr = currentRoom();
    if (nr) { nr.cleared = true; nr.seen = true; }
    applyRoomEntry();
    /* 层间契约：打完 Boss 给下一层挑一条规矩。
       候选由 `S.rnd` 抽（同种子同一组），**抽签只决定给哪几条、不改数值**；
       挑不挑由玩家定，所以这一屏不是"必选"（跳过就等于放弃这次机会）。 */
    if (!S.pendingBoons.length) {
      S.pendingBoons = Boons.roll(Game.cfg.boonChoices, S.rnd);
      Game.events.emit('boonOffer', { floor: S.floor, choices: S.pendingBoons.slice() });
    }
  }

  market.openShop(bonus);
}

/** 通关：写死一个**事实**（S.won），而不是让下游从波次去推断 */
function winRun() {
  S.won = true;
  Game.events.emit('runWin', { wave: Game.wave, danger: S.danger, floor: S.floor });
  Game.setState('end');
  bark('bossDown');
  Game.events.emit('gameOver', buildSummary(true));
}

/* =========================================================
   升级 / 商店
   ========================================================= */
/* =========================================================
   升级池：**声明表与曲线都在 `levelup.ts`**（L1 数据层），这里只掷骰子
   ---------------------------------------------------------
   搬出去的理由很简单：那张表是**数据**（哪些属性可以被抽到、谁是防御向），
   两条计算是**纯函数** —— 它们不该住在一个 4100 行的模拟内核里，
   否则"一次升级能长多少"这个问题要在内核代码里翻半天才答得上来。

   留在这里的三件事恰好都是模拟层的职责：
     · 写会话（`S.levelCards`）
     · 消费会话的随机流（`S.rnd`）
     · 发事件（`Game.events.emit('levelCards')`）
   ========================================================= */

/**
 * 抽 `LEVELUP_CARDS` 张互不重复的升级卡。
 * 卡上带着**这一刻算好的 `amt`**：界面与 `takeLevelCard` 都读它，
 * 于是"看到的幅度"与"选中的幅度"是同一个数（两处各算一次就会漂）。
 */
function rollLevelCards() {
  S.levelCards = [];
  var lvl = S.player.level;
  var used = {};
  var guard = 0;
  while (S.levelCards.length < LEVELUP_CARDS && guard++ < 200) {
    var entry = U.pickWeighted(Pool.weighted(lvl), S.rnd).e;
    var key = Pool.cardId(entry);
    if (used[key]) continue;
    used[key] = true;
    S.levelCards.push({
      key: entry.key, amt: Pool.amountAt(entry, lvl), base: entry.amt,
      level: lvl, guard: !!entry.guard
    });
  }
  // 升级卡换了就通知界面重画（连续升级时状态不变，不会触发 stateChange）
  Game.events.emit('levelCards', S.levelCards);
}

function checkLevelUp() {
  var p = S.player;
  var guard = 0;
  while (p.xp >= p.xpNeed && guard++ < 60) {
    p.xp -= p.xpNeed;
    p.level++;
    p.pendingLevels++;
    p.xpNeed = Stats.xpNeeded(p.level);
  }
  // 极端情况下（一次性吃到海量经验）限制单次待选卡数量，避免连点几十屏
  if (p.pendingLevels > 6) p.pendingLevels = 6;
  if (p.pendingLevels > 0 && Game.state === 'playing') {
    rollLevelCards();
    Game.setState('levelup');
    Game.events.emit('levelup', { level: p.level });
    bark('levelUp');
  }
}

function takeLevelCard(i) {
  if (!requireState('levelup', 'chooseLevelCard')) return false;
  var card = S.levelCards[i];
  if (!card) return false;
  S.player.upgrades[card.key] += card.amt;
  S.player.pendingLevels--;
  recalcStats();
  S.player.hp = Math.min(S.player.hp, S.stats.maxHp);
  Game.events.emit('levelupChosen', card);
  if (S.player.pendingLevels > 0) {
    rollLevelCards();
    Game.setState('levelup');
  } else {
    S.levelCards = [];
    Game.setState('playing');
    Game.events.emit('resume');
  }
  return true;
}

/** 天赋（养成）折出来的经济修正。没点就是全 0 —— 乘上去必须还是原值（指纹靠这个） */
/* =========================================================
   局内经济（商店 / 道具包 / 营地）搬到了 market.ts
   ---------------------------------------------------------
   这里只留**注入**：把 game.ts 的内部能力（会话、波次、事件、重算属性…）交给它，
   以及几个保持公开 API 不变的转发（`Game.buyOffer` 等）。
   为什么切出去：那十几件事是"由界面驱动、只在 shop/camp 发生"的**子系统**，
   而本文件剩下的部分是每帧都在跑的模拟内核；混在一起时两边都读不懂。
   ========================================================= */
/* 回收价：底价 × 2^抬升档数 × **这一局的回收比例**（工坊「回收炉」+ 图纸「废料回收」）。
   写成一个函数而不是各处自己乘：市场卖、界面显示价格、提示语都要同一个数。 */
function salvageOf(w) {
  return Weapons.salvageOf(w, S ? S.salvageRate : undefined);
}

/**
 * 回收一件装备顺带产出的**合金**（图纸树的唯一稳定来源）。
 * 为什么是"回收"而不是"合成"：合成只是把已有装备加工一下，不产生新东西；
 * 而回收是**把不要的装备换成图纸进度** —— 这正是"探索收集 → 解锁 → 造更好的"那条链。
 * 越值钱的装备拆出越多（用它自己的价值算），所以"把 T4 拆了"不算白拆。
 */
function salvageAlloy(w) {
  if (!S || !w) return 0;
  var base = 1 + Math.floor(Weapons.valueOf(w) / 40);
  var bonus = (S.fmods && S.fmods.alloyPerSalvage) || 0;
  return Math.max(1, Math.round(base + bonus));
}

var market = Market.make({
  S: function () { return S; },
  wave: function () { return Game.wave; },
  cfg: function () { return Game.cfg; },
  events: function () { return Game.events; },
  setState: function (to) { return Game.setState(to); },
  recalcStats: recalcStats,
  requireState: requireState,
  requireStateIn: requireStateIn,
  addWeaponOrCombine: addWeaponOrCombine,
  addItem: addItem,
  affixRnd: affixRnd,
  combine: combine,
  salvageOf: salvageOf,
  itemCostMul: itemCostMul,
  itemCostFlag: itemCostFlag,
  salvageAlloy: salvageAlloy
});
function omod(key) { return market.omod(key); }
function econMul(key) { return (S.boonFold && S.boonFold.econ && S.boonFold.econ[key]) || 1; }
function econAdd(key) { return market.econAdd(key); }

/* =========================================================
   地牢：走门（房间之间怎么移动）
   ========================================================= */
function deny(msg) { Game.events.emit('deny', msg); return false; }

/** 音效意图：模拟层**只广播**，放什么音由表现层决定（main.ts 把 audio.ts 接到这条事件上）。
 *
 *  改造前这里直接写 `if (Sfx) Sfx.kill()`，共 **9 处** —— 那是"模拟 → 造型"的依赖边：
 *  模拟内核因此认识了 AudioContext 那一层，而声音对一局的走向没有任何影响。
 *  事件总线上本来就有同样的先例（`buy` / `deny` 都是界面监听之后再响），所以这不是新机制。
 *  契约：`name` 必须是 main.ts 的 `SFX_BY_INTENT` 里登记过的意图（守卫会对齐两边）。 */
function sfx(name, arg?) { Game.events.emit('sfx', { name: name, arg: arg }); }

/**
 * 挑一条层间契约（在商店里挑，不受"必须站着不动"之类的约束）。
 * 挑完立刻重算属性（`stats` 组）并广播事件；**不可撤销** —— 这就是它的份量。
 * @returns 是否挑成功
 */
function pickBoon(id) {
  if (!S) return false;
  if (S.pendingBoons.indexOf(id) < 0) return deny('这一条不在候选里');
  S.boon = id;
  S.boonFold = Boons.fold(id);
  S.pendingBoons = [];
  recalcStats();                 // stats 组要立刻生效（enemy/econ 组在下一次 startWave 折）
  var def = Boons.BY_ID[id];
  Game.events.emit('boonPick', { id: id, name: def ? def.name : id });
  return true;
}

/**
 * 进一间房。**唯一**换房间的入口（玩家走门、点小地图、自动探索都走它）。
 *
 * 三道校验，每一道都对应一个真实的设计决定：
 *   · 那一面得有门（`doors[d]`）
 *   · 这一间得清干净（战斗中门是锁的 —— 否则"边打边跑"能一直躲）
 *   · 暗门要先**打穿**（`hidden` + 没破过的墙 = 进不去，这就是"隐藏要素"）
 * 从商店/营地也能走（先回 playing）：玩家在商店里点小地图上的门就该走。
 */
/**
 * 这一间现在有哪些门、通向哪、现在能不能走。
 *
 * **这是"玩家自己选房间"这条设计的唯一数据来源**（Hades / 以撒那种：
 * 打完一间自己挑下一间，而不是被系统推着走）。规则全在这里：
 * 有没有门、门锁着没有、暗门破没破 —— 界面只负责把这份数据画成可点的按钮，
 * 既不重复判断，也不按房型 id 分支（房型名与图标都来自 dungeon.ts 的房型表）。
 *
 * @returns [{ dir, roomId, type, name, icon, hidden, open, why }]
 *          `open:false` 的门也返回：界面据此显示"先把它打穿 / 先清干净"，
 *          而不是把一个走不了的门藏起来（藏起来玩家会以为地图画错了）。
 *          **暗门例外**：没打穿之前，密室的身份不给出去（见下面那段）。
 */
Game.doors = function () {
  var out = [];
  if (!S || !S.map) return out;
  var cur = currentRoom();
  if (!cur) return out;
  for (var d = 0; d < 4; d++) {
    if (!cur.doors[d]) continue;                      // 这一面根本没有门
    var to = roomAtDir(cur, d);
    if (!to) continue;
    var lk = Dungeon.link(S.map, cur, to);
    if (!lk || !lk.door) continue;
    var td = Dungeon.TYPE_BY_ID ? Dungeon.TYPE_BY_ID[to.type] : null;
    var open = true, why = '';
    var hidden = !!(lk.hidden && !Dungeon.wallOpen(S.walls, S.floor, cur.id, to.id));
    if (!cur.cleared) { open = false; why = '先把这一间清干净'; }
    else if (hidden) { open = false; why = '墙上只有一道裂纹 —— 打穿它'; }
    /* **暗门不报身份**：以前这里照样回 `type/name/icon`，于是门牌上直接写着
       "✳ 密室 —— 墙上只有一道裂纹"，玩家一眼就知道墙后面是什么、在哪一面 ——
       而 dungeon.ts 的设计是"密室不显示在地图上、seen 为假时根本不知道它存在"。
       线索只保留一处（HUD 的"⚠ 右 墙上有裂纹 —— 打穿它"由 `S.wallsNow` 给），
       门牌只说"这里有一面可疑的墙"：知道**有一处东西**，不知道**是什么**。 */
    out.push({
      dir: d, roomId: to.id, hidden: hidden,
      type: hidden ? '?' : to.type,
      name: hidden ? '裂纹的墙' : (td ? td.name : to.type),
      icon: hidden ? '?' : (td ? td.icon : '·'),
      open: open, why: why
    });
  }
  return out;
};

/* =========================================================
   进一间房（玩家走门、点小地图、自动探索都走它）
   ---------------------------------------------------------
   **顺序即正确性**：以前第一件事就是"从商店/营地切回 playing"，
   然后才检查门、锁、暗门 —— 于是任何一次**失败的**走门都会把玩家
   从商店里拽回战斗状态：`buyOffer` 从此开始全是"当前不在商店界面"，
   而玩家看到的是"我明明还在商店里，怎么买不了了"。
   实测（`tools/fun-audit.mjs`）：一局试买 4 次、成功 **0** 次，
   全部倒在 `enterRoom(9)` 这个越界参数上 —— 它是无头 bot 的越界测试，
   但**玩家也会踩到**（点小地图边缘、手柄方向键的边界值）。

   现在：所有校验先过，**状态切换放到最后**（真的要走才切）。
   于是"失败的无副作用"这条纪律对状态机也成立 —— 与"废料不足时
   一分钱不扣"是同一条。
   ========================================================= */
function enterRoom(dir) {
  if (!S) return false;
  if (Game.state !== 'playing' && Game.state !== 'shop' && Game.state !== 'camp') return false;
  var cur = currentRoom();
  if (!cur) return false;
  var d = Math.floor(Number(dir));
  if (!(d >= 0 && d < 4) || !cur.doors[d]) return deny('那一面没有门');
  if (!cur.cleared) return deny('门锁着 —— 先把这一间清干净');
  var to = roomAtDir(cur, d);
  if (!to) return deny('那边没有房间');
  var lk = Dungeon.link(S.map, cur, to);
  if (!lk || !lk.door) return deny('那一面没有门');
  if (lk.hidden && !Dungeon.wallOpen(S.walls, S.floor, cur.id, to.id)) {
    return deny('墙上只有一道裂纹……先把它打穿');
  }
  /* 到这里才允许离开商店 / 营地 */
  if (Game.state !== 'playing') Game.setState('playing');
  return goRoom(to.id);
}

/** 换到某一间房并开这一间的遭遇 */
function goRoom(id) {
  var room = Dungeon.roomById(S.map, id);
  /* **走进一间已经清过的房 = 走过走廊**，不是打一波。
     以前这里无条件 `startWave(wave+1)`，于是走进已清房间会：
       · 波次计数 +1（难度与奖励都跟着涨）
       · 白拿一份"每波到账"（建材 / 天赋废料 / 营火回血 / 免费刷新）
       · 在一间地图上标着"已清"的房里刷出一整波怪
     连起来就是一个可反复刷的循环（两间已清房间来回走），也是"点下一关像跳关"的来源。
     现在：已清的房只挪位置，不开波、不进店、不触发进门效果（那些是一次性的）。 */
  S.roomId = id;
  seeRoom(id);
  recalcWalls();
  S.rerolls = 0;
  S.offers = [];
  S.shopLocked = false;
  if (room && room.cleared) return true;      // 走廊：只挪位置
  startWave(Game.wave + 1);
  applyRoomEntry();
  return true;
}

/**
 * 自动选下一间：给"下一波"按钮与无头跑局用的默认路径。
 *   ① 最近的、**还没打过**的可达房间（暗门不算通 —— 密室不会被自动走进去）
 *   ② 同样近就先挑特殊房（宝箱/商店/营地/精英），再挑深的
 *   ③ 关底**最后**才去：只要还有别的房间可走，就不进关底
 * 选路是**确定性的**（同一个种子 + 同一份进度 → 同一条路），所以回放与成绩码成立。
 */
function autoExplore() {
  var cur = currentRoom();
  if (!cur) return false;
  if (!cur.cleared) return deny('门锁着 —— 先把这一间清干净');
  /* "下一波"的选路看**整层**，不是"玩家看见的那一份"：
     迷雾只决定小地图画什么，不决定按钮能不能找到下一间
     （否则探图的任务会落到"下一波"按钮上，而那是一个便利功能）。 */
  var rooms = S.map.rooms.filter(function (r) { return r.type !== Dungeon.SECRET_TYPE; });
  /* 关底分两轮找 —— 这是一个真 bug 的修法：
     关底房的 type 也算"特殊房"，所以它以前和宝箱/商店一起参与比较，
     于是**距离一样时它会被优先选中**。表现就是玩家点"下一波"被直接送进关底，
     打完 Boss 触发翻层，这一层剩下的房间全没了（"点下一关就跳关"就是这个）。
     先只看非关底，实在没有别的可走才去关底。 */
  var picked = pickNextRoom(cur, rooms, false) || pickNextRoom(cur, rooms, true);
  if (!picked) return deny('这一层的房间都走过了');
  /* **一路走到那一间**，而不是只走一步。
     只走一步的话，目标是三格外的房间时玩家会停在中间某间**已经清过**的空房里：
     地图上没怪、商店没开、"下一波"也不在那儿了 —— 玩家的感受就是"点一下跳关了"。
     中间的已清房间由 goRoom 当走廊处理（不刷怪、不算一波），所以走多远都不吃亏。 */
  var target = picked.room.id;
  for (var hop = 0; hop < 16; hop++) {
    var path = Dungeon.path(S.map, cur.id, target, S.walls);
    if (path.length < 2) break;
    var nxt = Dungeon.roomById(S.map, path[1]);
    var d = dirTo(cur, nxt);
    if (d < 0) return deny('走不过去');
    if (!enterRoom(d)) return false;
    cur = currentRoom();
    if (cur && !cur.cleared) return true;             // 到了要打的那一间
  }
  return deny('走不过去');
}

/**
 * 在候选里挑一间：`bossOnly=false` 只看非关底房，`true` 只看关底房。
 * 排序规则见 `autoExplore` 的①②；返回 `{ room, path }`（没得挑返回 null）。
 */
function pickNextRoom(cur, rooms, bossOnly) {
  var best = null, bestPath = null, bestSpecial = false;
  for (var i = 0; i < rooms.length; i++) {
    var r = rooms[i];
    if (r.id === cur.id || r.cleared) continue;
    if ((r.type === Dungeon.BOSS_TYPE) !== bossOnly) continue;
    var path = Dungeon.path(S.map, cur.id, r.id, S.walls);
    if (!path.length) continue;                       // 走不到（例如没破墙的密室）
    var special = isSpecialRoom(r);
    var better = !bestPath ||
      path.length < bestPath.length ||
      (path.length === bestPath.length && special && !bestSpecial) ||
      (path.length === bestPath.length && special === bestSpecial && r.depth > best.depth);
    if (better) { best = r; bestPath = path; bestSpecial = special; }
  }
  return bestPath ? { room: best, path: bestPath } : null;
}

/** 特殊房（有内容值得绕路的那些）：除了入口与普通战斗房都算 */
function isSpecialRoom(r) {
  return r.type !== 'fight' && r.type !== 'start';
}

function nextWave() {
  /* 正常从商店/营地出发；**另外允许"站在已清房间里"继续走** ——
     手动走回一间清过的房时（那是合法的），按钮不该变成死的。 */
  if (!requireStateIn(['shop', 'camp'], 'nextWave')) {
    var here = currentRoom();
    if (Game.state !== 'playing' || !here || !here.cleared) return false;
  }
  S.rerolls = 0;
  S.offers = [];
  Game.setState('playing');
  return autoExplore();
}

/* =========================================================
   空间网格（子弹/近战范围查询）
   ---------------------------------------------------------
   实现已搬到 `grid.ts`（它只认识 `S.enemies` 与 `S.grid`，不认识武器/伤害/波次）。
   这里保留两个**同名转发**：调用点有 8 处，而"转发"让这次拆分对
   本文件的其余部分完全透明（少改 8 处 = 少 8 个出错的机会）。
   ⚠ `Grid` 本身在文件顶部（`S` 之后）就建好了，这里**只**放转发 ——
   在此处再 `makeGrid` 一次会得到第二个实例，而两个实例各自持有的
   复用缓冲是分开的，于是"没分配数组"这件事会静默失效。
   ========================================================= */
function rebuildGrid() { Grid.rebuild(); }
function queryCircle(x, y, r, out?) { return Grid.queryCircle(x, y, r, out); }

/* =========================================================
   伤害
   特效一律走 Emit（见 emit.ts）：配方集中在那边，本文件只描述"发生了什么"
   ========================================================= */

/* =========================================================
   血迹贴花 + 屏幕抖动请求
   ---------------------------------------------------------
   实现已搬到 `impact.ts`（它只做一件事：把"打中了"变成地上的痕迹
   与一个抖动强度）。这里保留**同名转发**，调用点有 10 处以上。
   ⚠ 这三个函数**会消费 `S.rnd()`**（血迹形状在生成时随机一次），
   所以它们不是纯表现：动这个文件里的随机次数会改行为指纹。
   ⚠ `Imp` 在文件顶部（`S` 之后）就建好了，不要在这里再 `makeImpact` 一次。
   ========================================================= */
function addStain(x, y, r, color) { return Imp.addStain(x, y, r, color); }
function tryHitStain(e) { return Imp.tryHitStain(e); }
function requestShake(amount) { Imp.requestShake(amount); }

/* =========================================================
   命中定帧（hit-stop）
   ---------------------------------------------------------
   打在**精英与 Boss**身上时，让整个世界"顿"几个逻辑帧。

   为什么是"缩短这一步的位移"而不是"跳过整个 step()"：
   跳过 step 会让子弹、计时器、波次、AI 一起停 —— 而这时玩家已经看到命中了
   （枪口火光与伤害飘字都出来了）。那种"整体卡住"不是打击感，是掉帧。
   只让**位移**变慢才是：画面还在动，世界慢了半拍。

   为什么取**本次调用的最大值**而不是累加：
   同一个逻辑帧里可能同时打中三只精英（霰弹、爆炸）。取最大值 = 定帧最多到
   玩家选的那一档，不会因为"打中三只"就顿三倍 —— 那会变成卡顿。

   ⚠ 默认档是 **0（关）**，所以这条路径在默认设置下**一次都不执行**，
   行为指纹逐位不变。这不是"没接上"：会改模拟时序的东西必须显式选择。
   ========================================================= */
function requestHitStop() {
  var n = Math.floor(Number(Game.cfg.hitStop) || 0);
  if (n > S.hitStop) S.hitStop = n;
}

function damageEnemy(e, amount, opt) {
  if (e.dead) return 0;
  /* 钻地中：**完全免伤**（连暴击判定都不掷）。
     这里必须挡在随机数之前 —— 否则"打不到"会变成"打得到但没伤害"，
     而且随机序列会因为玩家对着土堆开火而变化（回放会分叉）。 */
  if (e.burrowed) return 0;
  opt = opt || {};
  var s = S.stats;
  var dmg = amount;
  var crit = false;
  if (!opt.noCrit && S.rnd() < Stats.critChance(s)) {
    crit = true;
    dmg *= Stats.critMul();
  }
  /* 护甲：**与玩家侧同一条公式**（`Stats.armorMul`）。
     改造前这里是 `dmg = Math.max(1, dmg - e.armorFlat)` —— 每击减**固定值**、下限压到 1。
     后果实测：第一层 Boss（`warden`，armorFlat 3）在第 5 间，而开局武器单击只有 3~5 点，
     `max(1, 3-3) = 1` 把 smg「高射速低单击」的定位整个抹掉（−67%），
     而同场的 `quake`（20 点）只被削 15%。固定减伤**惩罚低单击、放过高单击**，
     且这个偏差随玩家成长自己消失 —— 方向与"难度递增"相反。
     外部依据：Isaac 的护甲是百分比 + 9% 伤害下限；本作玩家侧本来就是百分比。 */
  if (e.armorFlat) dmg = Math.max(1, dmg * Stats.armorMul(e.armorFlat));

  e.hp -= dmg;
  e.hitFlash = 0.16;
  S.stats_total.dmg += dmg;

  /* **命中音**（最高频的那一层反馈）。改造前是"开火有声、命中无声" ——
     而玩家真正想听见的是"打着了"。
     ⚠ 必须走 `sfx()` 助手，**不能**自己写 `Game.events.emit('sfx', {name:...})`：
     项目已有的 6 个意图全走助手，而守卫（`test/arch.mjs` 的 [4] 节）就是用
     `\bsfx\('name'` 这个正则对齐两边的 —— 换一种写法它看不到，于是
     `hit` 会被判成"接入表里永远不会发的死键"（我第一版就是这么错的）。
     ⚠ 刻意**不加命中粒子**：粒子数进了行为指纹（`fingerprint.mjs` 哈希
     `s.particles.length`），且粒子配方会消费 `S.rnd()`（那会挪动主随机流）。
     命中火花要加就得走"确定性方向"或派生随机流，那是独立的一件事。 */
  sfx('hit');

  if (opt.showText !== false) {
    Emit.damage(e.x + (S.rnd() - 0.5) * 10, e.y - e.r - 6, dmg, crit);
  }

  /* 命中定帧：打在**精英的甲**上（或 Boss）才触发 —— 打杂兵也定帧会让
     射速快的配置变成"一直在定格"（那是掉帧，不是打击感）。
     ⚠ 这一步**不消费随机数**：定帧是纯时序，掷骰子在这里会改行为指纹。 */
  if (e.elite || e.boss) requestHitStop();

  // 生命窃取
  if (s.lifesteal > 0) {
    var heal = dmg * s.lifesteal;
    if (heal > 0.4) healPlayer(heal, false);
  }

  // 元素附加：**机制名来自元素表**（见 data_elems.ts）
  applyElement(e, opt.element, dmg, opt.depth || 0);

  // 击退（统一换算成速度冲量并封顶，避免多段命中把怪物打飞出地图）
  if (opt.knock) {
    var kb = Math.min(420, opt.knock * (1 + (s.knockbackBonus || 0)) * 0.30);
    var a = opt.knockAngle === undefined ? Math.atan2(e.y - opt.fromY, e.x - opt.fromX) : opt.knockAngle;
    e.kx += Math.cos(a) * kb;
    e.ky += Math.sin(a) * kb;
    var klen = Math.sqrt(e.kx * e.kx + e.ky * e.ky);
    if (klen > 520) { e.kx = e.kx / klen * 520; e.ky = e.ky / klen * 520; }
  }

  if (e.hp <= 0) killEnemy(e, opt);
  else tryHitStain(e);        // 未致死的命中留下小片溅血（受预算限制）
  return dmg;
}

/**
 * 元素的**附带效果**：唯一的认领处。
 *
 * 改造前这里是两句按元素名比较的裸 if（`opt.element === 'fire'` / `'shock'`），
 * 而"元素有哪些名字、谁带效果"没有任何一处声明 —— `data_items.ts` 的 SPECIALS
 * 就是被同一个坑逼出来的（一件道具写着 special 却没人认领 = 它彻底没用）。
 * 现在元素表声明 `effect`（`burn` / `chain`），这里只按**机制名**分派：
 * 元素改名字、加元素都不碰这一行；声明了却没人认领的机制由 `test/elems.mjs` 抓。
 *
 * 系数（灼烧 0.35 / 电弧 0.5）留在这里而不是表里：它们是**公式的一部分**
 * （和暴击倍率、击退换算同一个位置），不是"每种元素各自的参数"。
 */
function applyElement(e, element, dmg, depth) {
  switch (Elems.effectOf(element)) {
    case 'burn': applyBurn(e, dmg * 0.35); return;
    case 'chain': shockChain(e, dmg * 0.5, depth); return;
    default: return;                       // 没有附带效果（含认不出的元素名）
  }
}

function applyBurn(e, dps) {
  e.burn = Math.max(e.burn || 0, 2.2);
  e.burnDps = Math.max(e.burnDps || 0, dps);
}

function shockChain(e, dmg, depth) {
  if (depth > 2) return;
  var near = queryCircle(e.x, e.y, 96);
  var hits = 0;
  for (var i = 0; i < near.length && hits < 2; i++) {
    var o = near[i];
    if (o === e || o.dead || o._shockTag === S.time) continue;
    o._shockTag = S.time;
    Emit.shockRing(o.x, o.y);
    damageEnemy(o, dmg, { noCrit: true, showText: depth < 1, element: 'shock', depth: depth + 1, fromX: e.x, fromY: e.y, knock: 20 });
    hits++;
  }
}

/**
 * "白给的回血"（进门间 15% / 补给房 25%）—— 与生命窃取**分开**走这一道门。
 *
 * 为什么必须分开：道具代价 `noHeal`（异星护符）要取消的是**这一档**，
 * 而不是"一切回血"。那件道具同时给 lifesteal，如果把 `healPlayer` 整个关掉，
 * "吸血换不回复"就自相矛盾了 —— 实测那样配会让这件道具纯亏，
 * 而"纯亏的选项"正是这一轮要消灭的东西（没有决策 = 不选它）。
 */
/* =========================================================
   材料（**全局货币**）= 这一局的钱 —— 唯一的三个出口
   ---------------------------------------------------------
   v3 §5.1：全局货币"三模块通用，每个模块都要用它，每个模块也都能产出它。
   更像'税'或'行动成本'，不是钱。" + §二：三个模块**全在局内**
   ⇒ **材料住在 `S.material`，不跨局**（M1 的第一块，2026-09）。

   ⚠ 这里以前写的是反面（`Profile.addMaterial` → **账号钱包**），
   而 `run_save.ts` 里还写着"钱是**材料**（`Profile.material()`）——
   三者都不该按局清零"。那句话在 v3 下是错的：按局清零**正是**要的。

   为什么要摆成三个访问器而不是随处 `S.material +=`：
   材料是三个模块共同的成本，任何一个模块想多花一笔都得从这里过 ——
   于是"谁花了多少"在一处看得见（v3 §9-建议3 要的"消耗刚性"靠这个才能查）。
   ========================================================= */
/** 现在的材料余额 */
function material() { return Math.max(0, Math.floor((S && S.material) || 0)); }
/** 进材料（产出；只有 `gainMaterial` 该调它） */
function addMaterial(n) {
  if (!S) return 0;
  var v = Math.max(0, Math.floor(Number(n) || 0));
  if (!v) return S.material || 0;
  S.material = material() + v;
  return S.material;
}
/** 花材料；不够就**不扣**并返回 false（调用方据此拒绝） */
function spendMaterial(n) {
  if (!S) return false;
  var cost = Math.max(0, Math.floor(Number(n) || 0));
  if (cost <= 0) return true;
  if (material() < cost) return false;
  S.material = material() - cost;
  return true;
}

/* =========================================================
   发材料（**唯一出口**）
   ---------------------------------------------------------
   材料在局内的路径与废料**刻意不同**，这里要写清楚，否则很容易接错：

     废料（`scrap`） 局内余额，结算按"总量"（`stats_total.scrap`）入账 → 走 `p.scrap`
     材料（`material`）**当场进 `S.material`** → 走这里

   为什么材料不等结算：它要在**经营场景**里立刻花得出去（打一场 → 回工坊造一件 → 再打）。
   等结算的话，中间那一环"我想现在就造"就得先退出去结算一次。

   ⚠ **这里与结算的关系（2026-09 修过一次真 bug）**：
   本函数既 `addMaterial(v)`（当场进余额）**又**记 `S.materialEarned`（只用于展示），
   而 `buildSummary` 的 `materials` **取的就是** `S.materialEarned` ——
   于是 `applyRun` 里那句"按 `run.materials` 再入一次账"会**把每一笔材料加两遍**。
   现在 `applyRun` 只报数不入账（见门 `drift` 的判据 J：入账只许有一个出口）。
   ========================================================= */
function gainMaterial(n) {
  var v = Math.max(0, Math.round(Number(n) || 0));
  if (!v) return 0;
  addMaterial(v);
  if (S) S.materialEarned = (S.materialEarned || 0) + v;
  return v;
}

function settleHeal(amount) {
  if (itemCostFlag('noHeal')) return 0;
  healPlayer(amount, true);
  return amount;
}
function healPlayer(amount, silent?) {
  var p = S.player;
  var before = p.hp;
  p.hp = Math.min(S.stats.maxHp, p.hp + amount);
  var got = p.hp - before;
  if (got > 0) {
    S.stats_total.healed += got;
    // 生命窃取每帧都在回血，弹字会刷屏 —— silent 用来抑制（调用方本来就传了 false）
    if (!silent) Emit.heal(p.x, p.y - 34, got);
  }
}

function killEnemy(e, opt?) {
  if (e.dead) return;
  e.dead = true;
  S.stats_total.kills++;

  // 血液贴花（平涂色块，留在战场地面，换波时清空）
  // 环形缓冲保证"每一次击杀都留痕"，而不是前 90 次之后就没了
  addStain(e.x, e.y, e.r * 0.72, e.def.dark);

  // 死亡碎片
  Emit.deathSparks(e);
  if (e.def.boss) {
    requestShake(0.9);      // Boss 倒下：一次明显的冲击
    /* 记下"这一局打倒了哪一只 Boss" —— 剧情碎片（按 `boss:<id>` 认来源）读它。
       模拟层只记事实，不解释它通向哪一段剧情（那是接入层的活）。 */
    S.bossesDown[e.def.id] = true;
    /* **核心材料只有 Boss 掉**（`economy.ts` 里那笔 `meta-rare`）。
       它不进局内经济、不落在地上 —— 直接记进这一局的账，结算时才入档。
       为什么不做成地上的掉落物：那是"局内的钱"，而这笔钱的定义就是**局外的**。
       做成掉落会让"捡不捡得到"取决于走位，而它该取决于"你打没打倒 Boss"。 */
    S.coreEarned = (S.coreEarned || 0) + CORE_PER_BOSS;
    Game.events.emit('bossDown', { id: e.def.id, name: e.def.name, floor: S.floor, core: CORE_PER_BOSS });
    /* 短句（R41）：打赢一个器官就说一句 —— **允许重复**（`repeat`），
       而且 `barkFor` 按表长轮转，所以第二次打赢换一句。
       这与 hurtHard / lowHp 那几条"一局一次"的刻意不同：那些是状态，
       这是**事件**，每一次都值得说。 */
    bark('bossDown', true);
  }

  // 掉落废料
  var count = 1 + Math.floor(S.rnd() * 2) + (e.elite ? 2 : 0) + (e.def.boss ? 14 : 0);
  for (var c = 0; c < count; c++) {
    var ang = S.rnd() * U.TAU, sp = 40 + S.rnd() * 70;
    S.pickups.push(Comp.spawn('pickup', {
      kind: 'mat', x: e.x, y: e.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
      seed: S.rnd() * 10, value: 1 + (e.elite ? 1 : 0)
    }));
  }
  // 小概率回血
  if (S.rnd() < (e.def.boss ? 1 : 0.035 + S.stats.luck * 0.002)) {
    S.pickups.push(Comp.spawn('pickup', { kind: 'heal', x: e.x, y: e.y, seed: S.rnd() * 10, value: 2 + Math.round(S.stats.maxHp * 0.06) }));
  }

  // 死亡爆炸（爆裂菌）
  if (e.def.explodeOnDeath) {
    var ex = e.def.explodeOnDeath;
    Emit.deathExplosion(e.x, e.y, ex.radius);
    requestShake(0.30);
    if (U.dist(S.player.x, S.player.y, e.x, e.y) < ex.radius + S.player.r) {
      hurtPlayer(ex.dmg * Enemies.dmgScale(Game.wave));
    }
  }

  // 分裂
  if (e.def.splitInto) {
    var sp2 = e.def.splitInto;
    var def = Enemies.BY_ID[sp2.id];
    if (def) {
      for (var j = 0; j < sp2.count; j++) {
        var a2 = (j / sp2.count) * U.TAU + S.rnd();
        spawnEnemy(def, e.x + Math.cos(a2) * 18, e.y + Math.sin(a2) * 18, {
          hpMul: 0.5, elite: false, noBoss: true
        });
      }
    }
  }

  sfx('kill');
}

/**
 * **战斗短句**（R41 补的那一栏："战斗中短句（barks）" ❌ → ✅）。
 *
 * 它是一句**飘过去就没**的话，不是对话框 —— 所以它不进会话、不改任何数值，
 * 只**广播**一条 `bark` 事件给界面。三条纪律：
 *
 *   1. **不许 `Math.random`**：`record.ts` 只录种子与逐帧输入，
 *      随机短句会让同一盘带子放出不同的话。所以"第几次触发"是**记账**的
 *      （`_barkN`），由 `Dialogue.barkFor` 按表长轮转 —— 确定，且一轮内不重复。
 *   2. **同一个条件一局只说一次**（`lowHp` 那种尤其）：反复喊同一句就不再是脾气，
 *      是噪音。`_barkSaid` 记账，与 `_barkN` 一起在 `newSession` 里清空。
 *   3. **它不认识界面**：这里只发事件，画在哪、飘多久由 `ui.ts` 决定
 *      （与 `sfx` 那条"只广播意图"同一条纪律）。
 *
 * ⚠ `_barkN` / `_barkSaid` 是**接入层的记账**（不进存档、不进会话）——
 *   它们与 `hallRoom` 同一性质：模块级可变状态，所以登记在 `test/persist.mjs`。
 */
var _barkN: Record<string, number> = Object.create(null);
var _barkSaid: Record<string, boolean> = Object.create(null);

/**
 * @param repeat 允许同一条件在一局里说多次（默认**不**）——
 *   "打赢一个器官说一句"要 repeat（每一次都值得说，而且轮转会换一句），
 *   而"挨了重击"不要（反复喊同一句就不再是脾气，是噪音）。
 */
function bark(when: string, repeat?: boolean) {
  if (!S || !S.player) return null;
  if (!repeat && _barkSaid[when]) return null;
  var nth = _barkN[when] || 0;
  var def = Dialogue.barkFor(when, nth);
  if (!def) return null;
  _barkN[when] = nth + 1;
  _barkSaid[when] = true;
  Game.events.emit('bark', { id: def.id, when: def.when, text: def.text, x: S.player.x, y: S.player.y });
  return def;
}
/** 一局里说过哪些短句（界面/测试读它；**不进存档**） */
Game.barksSaid = function () { return Object.keys(_barkSaid); };
/** 短句表一共几条（诊断面板要"说过几 / 共几"—— 它不该 import `dialogue.ts`） */
Game.barkTotal = function () { return Dialogue.BARKS.length; };

function hurtPlayer(raw) {
  var p = S.player;
  if (p.invuln > 0) return;
  var s = S.stats;
  if (S.rnd() < U.clamp(s.dodge, 0, 0.75)) {
    Emit.dodge(p.x, p.y - 36);
    p.invuln = 0.25;
    return;
  }
  /* 道具的 `fragile` 代价：挨打更疼。乘在护甲减伤**之后** ——
     于是它与"你堆了多少护甲"是两个独立的问题（护甲不会把这条代价吃掉）。 */
  var dmg = Stats.damageTaken(s, raw) * itemCostMul('fragile');
  p.hp -= dmg;
  p.invuln = 0.42;
  p.hurtFlash = 0.3;
  requestShake(0.50);          // 玩家受击：明显但不夸张
  S.stats_total.taken += dmg;
  Emit.playerHurt(p.x, p.y - 38, dmg);
  Emit.blood(p.x, p.y, 3);
  addStain(p.x + (S.rnd() - 0.5) * 10, p.y + 6, 9 + S.rnd() * 4, PAL.BLOOD);
  sfx('hurt');
  recalcStats();
  /* 短句（R41）：两条 —— "一次挨掉两成以上生命"与"掉到三成以下"。
     两条都由**同一份账**去重（一局各说一次），所以不必在这里判重复。 */
  if (dmg >= s.maxHp * 0.2) bark('hurtHard');
  if (p.hp > 0 && p.hp <= s.maxHp * 0.3) bark('lowHp');
  if (p.hp <= 0) {
    p.hp = 0;
    bark('die');
    Game.setState('end');
    Game.events.emit('gameOver', buildSummary(false));
  }
}

/* =========================================================
   刷怪
   ========================================================= */
function pickSpawnPoint() {
  var p = S.player;
  var best = null, bestD = -1;
  for (var i = 0; i < 8; i++) {
    var edge = Math.floor(S.rnd() * 4);
    /* 边距与"可用的那条边长"。写成两个名字而不是每次现算 ——
       改造前这里四行里各写了一遍 `pad * 2`（同一件事四份副本），
       而它的含义（"两边各让出 pad"）只在脑子里，不在代码里。 */
    var pad = Arena.PAD + 40;
    var spanX = Arena.W - pad * 2, spanY = Arena.H - pad * 2;
    var x, y;
    if (edge === 0) { x = pad + S.rnd() * spanX; y = pad; }
    else if (edge === 1) { x = Arena.W - pad; y = pad + S.rnd() * spanY; }
    else if (edge === 2) { x = pad + S.rnd() * spanX; y = Arena.H - pad; }
    else { x = pad; y = pad + S.rnd() * spanY; }
    var d = U.dist2(x, y, p.x, p.y);
    if (d > bestD) { bestD = d; best = { x: x, y: y }; }
  }
  return best;
}

/**
 * 道具**代价**的读法（**唯一**的一处）。
 *
 * `S.itemCost` 由 `recalcStats` 折一次（`Items.foldCosts`），这里只读结果 ——
 * 与 `econMul` / `econAdd`（契约那条经济线）同一个套路。
 *
 * `mul` 类的代价语义**随键名而分**，这一点必须写清楚，否则一定会写反：
 *   · 大多数键是"**越小越糟**"（`matMul 0.8` = 废料少两成）→ 值直接乘；
 *   · `enemyHp / enemyDmg / enemySpeed / fragile` 是"**越大越糟**"
 *     （`enemyHp 1.10` = 敌人更硬）→ 值也直接乘，因为它在乘法里本来就把结果推大。
 * 两种读法恰好都是"值直接乘进去"，所以这里只有一个函数；
 * 真正要小心的是**写数据的人**：`matMul: 1.2` 的意思是"废料变多"，
 * 那是增益不是代价 —— 方向由 `test/items.mjs` 的语义守卫逐个键钉住。
 * @param key 代价键（`matMul` / `enemyHp` / …）
 * @returns 倍率（没有这件道具就是 **1**，即恒等）
 */
function itemCostMul(key) {
  var m = S && S.itemCost && S.itemCost.mul;
  var v = m ? Number(m[key]) : 1;
  return isFinite(v) && v > 0 ? v : 1;
}
/** 规则型代价的布尔读法（`noHeal` / `noFreeReroll`：值 ≥1 即生效） */
function itemCostFlag(key) {
  var a = S && S.itemCost && S.itemCost.add;
  return !!(a && Number(a[key]) >= 1);
}

function spawnEnemy(def, x, y, opt) {
  opt = opt || {};
  if (!def) return null;
  // 上限与"满了怎么办"由容器总账执行（enemies 的策略是 reclaim-farthest、Boss 免回收）

  var wave = Game.wave;
  // 敌人属性读的是**这一间的折叠结果**（难度 × 房型 × 层主题），不是裸的 dmods
  var dm = S.wmods || S.dmods;
  /* 道具的**敌人型代价**（Brotato 的 Curse 那一层）：让敌人更强，换更强的自己。
     它乘在难度修正之后 —— 于是"这一件值不值"与"你选了多难的局"是两个独立的问题。 */
  var hpMul = Enemies.hpScale(wave) * (opt.hpMul || 1) * dm.enemyHp * itemCostMul('enemyHp');
  var dmgMul = Enemies.dmgScale(wave) * dm.enemyDmg * itemCostMul('enemyDmg');
  var spMul = Enemies.speedScale(wave) * dm.enemySpeed * itemCostMul('enemySpeed');
  var elite = !!opt.elite;

  var e = Comp.spawn('enemy', {
    id: S.nextId++,
    def: def,
    x: x, y: y,
    vx: 0, vy: 0, kx: 0, ky: 0,
    r: 22 * (def.scale || 1),
    maxHp: def.hp0 * hpMul * (elite ? ELITE_HP : 1),
    dmg: def.dmg0 * dmgMul * (elite ? ELITE_DMG : 1),
    speed: def.speed * spMul * (elite ? ELITE_SPEED : 1),
    elite: elite,
    hp: 0, dead: false,
    hitFlash: 0, burn: 0, burnDps: 0,
    atkCd: (def.atkCd || 0) * (0.5 + S.rnd() * 0.8),
    windup: 0, shootCd: 0.6 + S.rnd() * 1.2,
    phase: S.rnd() * 10,
    spawnT: 0.35,
    // AI 的两个计时器（钻地上浮/下潜、召唤节拍、扫射相位）—— 声明在 AI 组件里
    t1: 0, t2: 1,
    // 钻地中的 Boss 打不到也不打人（渲染层据此画"土堆"）
    burrowed: 0,
    _shockTag: -1
  });
  e.hp = e.maxHp;
  // 满了由容器策略决定（回收最远的非 Boss）；被拒绝时返回 null，调用方不生成
  return Containers.add(S, 'enemies', e) ? e : null;
}

function updateSpawns(dt) {
  if (S.forceClear) return;        // 超时之后不再补怪（"这一间已经没有援军了"）
  var q = S.spawnQueue;
  while (S.spawnIdx < q.length && q[S.spawnIdx].at <= S.waveT) {
    var item = q[S.spawnIdx++];
    var def = Enemies.BY_ID[item.id];
    if (!def) continue;
    var pos = pickSpawnPoint();
    spawnEnemy(def, pos.x, pos.y, { elite: item.elite });
  }
}

/* =========================================================
   主更新
   ========================================================= */
/* =========================================================
   帧模型：一次 step = 一个固定时长的"逻辑帧"，物理（积分 + 碰撞）在同一个
   帧内按固定顺序跑完。表现层可能跑得更快（144Hz 显示器），所以每帧开头先把
   位置存进 px/py，渲染层用 alpha 在两次逻辑帧之间插值 —— 逻辑帧与显示帧
   因此互相独立：逻辑帧永远是 1/60 且顺序确定（可复现、可测），显示帧想多快都行。
   ========================================================= */
function snapPrev(list) {
  for (var i = 0; i < list.length; i++) {
    var o = list[i];
    o.px = o.x; o.py = o.y;
  }
}

function recordPrev() {
  var p = S.player;
  p.px = p.x; p.py = p.y;
  snapPrev(S.enemies);
  snapPrev(S.bullets);
  snapPrev(S.ebullets);
  snapPrev(S.pickups);
  snapPrev(S.turrets);
}

/* =========================================================
   大厅 / 枢纽：**能走的局内世界**（模拟层这一半）
   ---------------------------------------------------------
   用户的原始要求（这一整块存在的理由）：
     "我需要的是一个玩家真实可交互可游玩的局内世界，而不是什么文字冒险，
      我需要真实可以玩可以探索的世界，而不是给我几个按钮和选项就完了"

   改造前这两屏是**整屏覆盖层 + 一排按钮卡**：世界在背后当背景图，
   玩家点的其实是菜单。现在它们是两间**手写的房子**（数据在 `hall.ts`）：

     · WASD / 方向键 / 手柄推动角色（加速式，与战斗里同一条 `U.approach`）
     · 墙是轴对齐矩形，圆 vs 矩形的推出用 `Hall.slide`（贴墙走不抖、不卡角）
     · 走进传送门 / 设施 = 直接换屏（与地牢里"走进门就换房"同一条规矩）
     · 走到人 / 公告板面前按 E = 说话 / 读账（`Game.hallAct`）

   ⚠ 这里**不碰波次**：`S.waveT` / 刷怪 / 命中全都按兵不动 —— 站里没有敌人。
     但 `S.time` 照走：世界只有一口钟，状态机测试也拿它当"这一屏推不推进"的判据
     （见 test/states.mjs 的 [8]：sim 列必须与实测一致）。
   ⚠ 移动速度**不用角色属性**：站里没有战斗 buff，见 `hall.ts` 的注释。
   ========================================================= */

/** 这一间现在该出现哪些站：大厅的门常驻；枢纽的人跟着剧情解锁走 */
function hallLive(roomId: string): string[] | null {
  if (roomId !== 'hub') return null;
  /* 人在剧情里解锁（`Profile.stationsFor` 已经按 ctx 过滤过）——
     摆位不变，只是"现在屋里有没有这个人"。 */
  return Profile.stationsFor().map(function (s) { return s.id; });
}

/**
 * 进屋：按"从哪来"站在对应的门口（第一次进用默认出生点）。
 * 落点由 `hall.ts` 的 `spawnAt` 说了算 —— 状态机只交一个来处字符串，
 * 不认门口在哪（自检守着"落点不许站在触发圈里"，否则一回来就被再送出去）。
 */
function enterHall(roomId: string, from: string | null): HallState | null {
  var def = Hall.BY_ID[roomId];
  if (!def) { hallRoom = null; return null; }
  var at = Hall.spawnFor(roomId, from) || { x: def.spawn.x, y: def.spawn.y };
  hallRoom = {
    room: roomId, def: def,
    x: at.x, y: at.y, px: at.x, py: at.y,
    vx: 0, vy: 0, r: Hall.R,
    aim: Math.PI / 2, fx: 0, animT: 0, moveBlend: 0,
    spots: Hall.liveSpots(roomId, hallLive(roomId)),
    near: null
  };
  return hallRoom;
}

/** 屋里的一步：移动 → 撞墙 → 站名单 → 走上去就过门 → 算"站在谁面前" */
function stepHall(dt: number, input: { x: number; y: number }) {
  var h = hallRoom;
  if (!h) h = enterHall(Game.state, null);
  if (!h) return;
  if (S) S.time = (S.time || 0) + dt;       // 世界同一口钟（见上面那段注）

  h.px = h.x; h.py = h.y;
  var ix = input.x || 0, iy = input.y || 0;
  var il = Math.sqrt(ix * ix + iy * iy);
  if (il > 1) { ix /= il; iy /= il; }

  var tvx = ix * Hall.SPEED, tvy = iy * Hall.SPEED;
  h.vx = U.approach(h.vx, tvx, Hall.SPEED * Hall.ACCEL * dt);
  h.vy = U.approach(h.vy, tvy, Hall.SPEED * Hall.ACCEL * dt);

  var sl = Hall.slide(h.room, h.x + h.vx * dt, h.y + h.vy * dt, h.r);
  if (sl.hitX) h.vx = 0;
  if (sl.hitY) h.vy = 0;
  h.x = sl.x; h.y = sl.y;

  var speed = Math.sqrt(h.vx * h.vx + h.vy * h.vy);
  h.moveBlend = U.clamp(speed / Hall.SPEED, 0, 1);
  h.animT = (h.animT || 0) + dt;
  if (il > 0.01) { h.aim = Math.atan2(iy, ix); h.fx = ix; }

  /* 站名单每步重算：枢纽里的人会因为剧情/换档变化（屋里的人越站越多），
     而大厅的门永远都在。重算的代价是几十次数组过滤，与"每帧渲染"无关。 */
  h.spots = Hall.liveSpots(h.room, hallLive(h.room));

  /* 走进门 / 设施 = 换屏（自动，不用按键 —— 与地牢同一条规矩）。 */
  var hit = Hall.touch(h.spots, h.x, h.y, h.r);
  if (hit && hit.screen) {
    if (Game.setState(hit.screen as GameStateName)) return;
  }
  h.near = Hall.near(h.spots, h.x, h.y, h.r);
}

/* ---- 公开读口（界面层只读这两样，模拟层不反向认识界面） ---- */

/** 玩家现在在哪间屋里走到哪了（不在屋里就是 null）。 */
Game.hall = function () { return hallRoom; };

/**
 * 在站里按 E：**面前有什么就做什么**。
 *
 * 返回值给界面层用（它决定画哪一句话）：
 *   · `talk`  —— 面前是 NPC（`id` = 人在 story.ts 里的 id）
 *   · `board` —— 面前是公告板（读这一局的账，不换屏）
 *   · `enter` —— 面前是门 / 设施（`Game.setState` 已经切过去了；
 *                `id` = 要去的那一屏，界面不用猜）
 * 面前没有人也没有东西（或不在屋里）→ null。
 *
 * ⚠ 说话**不在这里说**：台词记账归档案层（`Profile.say`），而这句"要不要现在说"
 * 是界面的显示决策（对话框只画一句）。模拟层只回答"你面前站着谁"。
 */
Game.hallAct = function () {
  var h = hallRoom;
  if (!h || !h.near) return null;
  var s = h.near;
  if (s.kind === 'npc') {
    /* 广播"玩家按了 E、面前是谁" —— 界面层订阅它去显示/推进对话。
       模拟层不画对话框（与 `sfx` 同一条路：模拟层广播意图，表现层消费）。 */
    Game.events.emit('hallTalk', { id: s.npc || '', spot: s });
    return { act: 'talk', spot: s, id: s.npc || '' };
  }
  if (s.kind === 'board') {
    Game.events.emit('hallBoard', { spot: s });
    return { act: 'board', spot: s, id: s.id };
  }
  if (s.screen) {
    var screen = s.screen;
    if (Game.setState(screen as GameStateName)) {
      return { act: 'enter', spot: s, id: screen };
    }
    return null;
  }
  return null;
};

function step(dt, input) {
  Game.time += dt;
  /* 大厅 / 枢纽：**真的在走的世界**。它们也推进 `S.time`（世界同一口钟），
     所以场景表的 `sim:true` 与实测一致；但这一支**不碰**波次、刷怪、命中。 */
  if (Game.state === 'station' || Game.state === 'hub') {
    stepHall(dt, input || { x: 0, y: 0 });
    return;
  }
  if (Game.state !== 'playing') return;
  if (!S) return;              // 防御：没有会话时绝不推进（避免访问 null 崩溃）
  S.time = (S.time || 0) + dt;

  /* ---- 命中定帧：**只缩短位移用的时间**，不动别的东西 ----
     `moveDt` 给实体位移用（玩家与怪物）；`dt` 仍然是逻辑帧长 ——
     计时器、波次剩余、溅血预算、刷怪都按真实 `dt` 走。
     这样"世界慢了半拍"而"游戏没有卡住"两件事同时成立。
     ⚠ 默认档 0 时 `moveDt === dt`（`Math.min` 之外没有任何分支），
     所以这条路径在默认设置下对行为是**恒等**的 —— 指纹不变。 */
  var stopFrames = Math.floor(Number(S.hitStop) || 0);
  var moveDt = dt;
  if (stopFrames > 0) {
    moveDt = dt * Game.cfg.hitStopScale;
    S.hitStop = stopFrames - 1;
  }

  S.waveT += dt;
  S.waveLeft = Math.max(0, S.waveLeft - dt);
  // 命中溅血预算按时间回充（避免每秒上百次命中把地面铺满）
  S.stainBudget = Math.min(Game.cfg.stainBurst, S.stainBudget + Game.cfg.stainPerSec * dt);

  recordPrev();                // 插值基准：本帧积分前的位置

  updateSpawns(dt);
  rebuildGrid();

  updatePlayer(moveDt, input || { x: 0, y: 0 });
  /* 战斗模式在这里分岔：**只换"目标从哪来"，不换开火本身** ——
     两种模式打出去的是同一条 `fire(w, target)`，伤害与弹道完全共用。
     技能同理（`updateSkills` 里分"玩家按了才放"与"冷却好了就放"）。 */
  if (String(Game.cfg.combatMode) === 'manual') updateWeaponsManual(dt, input);
  else updateWeapons(dt);
  updateSkills(dt, input);
  updateTurrets(dt);
  updateEnemies(moveDt);
  updateBullets(dt);
  updateEnemyBullets(dt);
  updatePickups(dt);
  updateParticles(dt);
  cleanup();

  /* ---------------- 这一间什么时候算打完 ----------------
     房间制：**刷完 + 场上清空 = 过**（不用干等计时器）。计时器因此从
     "要撑多久"变成"多久内打完"：时限内清完 = 速清奖励，超时 = 剩下的怪狂暴
     并且**停止再刷**（`forceClear`）。这个改动是刻意的，也是行为指纹变化的原因之一。
     `S.roomHold` 是"这一间不自动结束"的口子（测试/调试用）。
     注意 `drained` 要把 forceClear 算进去：超时之后剩下的怪是被**丢掉**的，
     `spawnIdx` 永远不会追平队列长度，不算进去这一间就永远结束不了。 */
  if (!S.roomHold) {
    var drained = S.forceClear || S.spawnIdx >= S.spawnQueue.length;
    if (drained && S.enemies.length === 0) endWave();
    else if (S.waveLeft <= 0) overrun();
  }
}

/**
 * 超时：还没清完的怪**狂暴**（一次性），同时停止刷新的怪。
 * 这是时限存在的意义 —— 否则"清空即过"会让 waveTime 变成没人读的数字。
 */
function overrun() {
  if (S.forceClear) return;
  S.forceClear = true;
  var mul = Game.cfg.overrun;
  for (var i = 0; i < S.enemies.length; i++) {
    var e = S.enemies[i];
    if (e.def && e.def.boss) continue;         // Boss 本来就够狠，不再叠
    e.speed *= mul.speed;
    e.dmg *= mul.dmg;
    e.enraged = true;
  }
  Game.events.emit('overrun', { wave: Game.wave, left: S.enemies.length });
  bark('overrun');
}

/* ---------------- 玩家 ---------------- */
function updatePlayer(dt, input) {
  var p = S.player;
  var s = S.stats;
  var mv = Stats.moveSpeed(s);
  /* 慢走由**输入载荷**带来（`Input.moveVec()` 的 `slow`），模拟层不 import 输入层。
     改造前这里是 `if (Input && Input.isSlow && Input.isSlow())` —— 全项目唯一一条
     "模拟 → 界面"的依赖边：一帧的行为不再只由 (状态, dt, 输入载荷) 决定，
     而是取决于输入单例此刻的字段。载荷缺 `slow` 时按"不慢走"算（与改造前一致）。 */
  if (input.slow) mv *= 0.55;
  // 受虐狂：低血加速
  if (Chars.specialOf(p.charDef.id, 'rage')) mv *= 1 + p.rage * 0.18;

  var ix = input.x || 0, iy = input.y || 0;
  var il = Math.sqrt(ix * ix + iy * iy);
  if (il > 1) { ix /= il; iy /= il; }

  var targetVx = ix * mv, targetVy = iy * mv;
  var accel = 12;
  p.vx = U.approach(p.vx, targetVx, mv * accel * dt);
  p.vy = U.approach(p.vy, targetVy, mv * accel * dt);

  p.x += p.vx * dt;
  p.y += p.vy * dt;
  var cl = Arena.clampPos(p.x, p.y, p.r);
  if (cl.x !== p.x) p.vx = 0;
  if (cl.y !== p.y) p.vy = 0;
  p.x = cl.x; p.y = cl.y;

  /* 走到门口就过去（以撒那一套：不用按键，走进门就换房）。
     只有**这一间清干净**之后才判定 —— 战斗中门是锁着的。 */
  if (S.waveEnding && !S.roomHold) {
    var dd = doorNearby();
    if (dd >= 0 && enterRoom(dd)) return;
  }

  /* ---------------- 角色律动状态（曲线在渲染层求） ----------------
     旧实现直接在模拟层切两套公式：
       bob = moving ? |sin(step)|*-3.2 : sin(step*0.5)*-1.2
     幅度与相位在松手那一帧同时跳变（实测 bob 瞬时跳 1.19px、手臂从 -0.64 硬切到 0），
     而且待机只有上下平移、没有挤压，看起来是"漂浮"不是"呼吸"。
     现在模拟层只提供两个连续量：
       moveBlend  走路权重，平滑过渡（约 0.13 秒）
       animT      统一相位，永不重置 → 不存在相位跳变
     具体 bob / 挤压 / 摆臂由 render.ts 的 R.playerAnim 求值。 */
  var moving = il > 0.01;
  p.moving = moving;
  p.moveBlend = U.approach(p.moveBlend === undefined ? (moving ? 1 : 0) : p.moveBlend,
    moving ? 1 : 0, dt * 8);
  p.animT += dt * (1 + 0.55 * p.moveBlend);   // 走路时律动加快

  if (p.invuln > 0) p.invuln -= dt;
  if (p.hitFlash > 0) p.hitFlash -= dt;
  if (p.hurtFlash > 0) p.hurtFlash -= dt;

  // 生命回复
  if (s.hpRegen > 0 && p.hp < s.maxHp) {
    p._regenAcc = (p._regenAcc || 0) + s.hpRegen * dt;
    if (p._regenAcc >= 1) {
      var whole = Math.floor(p._regenAcc);
      p._regenAcc -= whole;
      p.hp = Math.min(s.maxHp, p.hp + whole);
    }
  }
  if (Chars.specialOf(p.charDef.id, 'rage')) recalcStats();
}

/* ---------------- 武器 ---------------- */
function nearestEnemy(x, y, maxDist, exclude?) {
  var list = queryCircle(x, y, maxDist);
  var best = null, bestD = Infinity;
  for (var i = 0; i < list.length; i++) {
    var e = list[i];
    // 钻地中的 Boss 不是目标（否则武器会对着一个打不到的土堆一直开火）
    if (e === exclude || e.dead || e.burrowed) continue;
    var d = U.dist2(x, y, e.x, e.y);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

function updateWeapons(dt) {
  var p = S.player;
  for (var i = 0; i < p.weapons.length; i++) {
    var w = p.weapons[i];
    w.cd -= dt;
    if (w.swing > 0) w.swing = Math.max(0, w.swing - dt * 5.5);
    if (w.cd > 0) continue;

    var reach = weaponReach(w);
    var target = nearestEnemy(p.x, p.y, reach + 60);
    if (!target) continue;
    fire(w, target);
    w.cd = weaponCd(w);
  }
}

/**
 * 手动模式下的普通攻击：**玩家按了才打**，方向由输入给。
 *
 * 与自动模式的唯一区别是"目标从哪来"：
 *   · 自动：`nearestEnemy`（以撒/Brotato 那一类）
 *   · 手动：输入的 `aimX/aimY` 指向的那个方向
 * 打出去的**是同一条 `fire(w, target)`** —— 伤害公式、弹道、特效全部共用。
 * 这一点是刻意的：如果手动模式另写一条开火路径，"同一把枪两种手感"
 * 会成为一个只在某一种模式下出现的静默差异。
 */
function updateWeaponsManual(dt, input) {
  var p = S.player;
  var firing = !!(input && input.fire);
  for (var i = 0; i < p.weapons.length; i++) {
    var w = p.weapons[i];
    w.cd -= dt;
    if (w.swing > 0) w.swing = Math.max(0, w.swing - dt * 5.5);
  }
  if (!firing) return;

  /* 有目标就朝目标（冷却各自算），没目标时**近战不空挥**、远程朝输入方向打。
     为什么近战不空挥：空挥会让"按着不放"变成无意义的动画噪声，
     而远程空放是有意义的（可以预判、可以打墙）。 */
  for (i = 0; i < p.weapons.length; i++) {
    var w2 = p.weapons[i];
    if (w2.cd > 0) continue;
    var ph = aimPoint(input, p);
    var tgt = nearestEnemy(p.x, p.y, weaponReach(w2) + 60);
    if (w2.def.type === 'melee' && !tgt) continue;
    fire(w2, tgt || { x: ph.x, y: ph.y, r: 0 });
    w2.cd = weaponCd(w2);
  }
}

/** 输入的瞄准方向 → 世界里的一个点（手动模式用；没有方向时返回自己前方 400px） */
function aimPoint(input, p) {
  var ax = input && isFinite(input.aimX) ? Number(input.aimX) : 0;
  var ay = input && isFinite(input.aimY) ? Number(input.aimY) : 0;
  var len = Math.sqrt(ax * ax + ay * ay);
  if (len < 1e-6) {
    var a = p.aim || 0;
    return { x: p.x + Math.cos(a) * 400, y: p.y + Math.sin(a) * 400 };
  }
  return { x: p.x + (ax / len) * 400, y: p.y + (ay / len) * 400 };
}

/* =========================================================
   技能：释放、能量、以及"打在谁身上"
   ---------------------------------------------------------
   技能的三张数据表在 `skills.ts`（形 × 效 × 符文），**模拟层只认识
   `Skills.fold` 折出来的那一份** —— 它不认识"技能树"这个词，也不认识符文 id。
   这里负责三件模拟层该负责的事：

     1. **能量**：每帧回充、施法扣除的一个 0..100 的条。
        为什么冷却之外还要它：只有冷却时"两个技能谁先放"没有取舍。
     2. **形**：把"效"送到目标身上的六种几何（弹丸 / 扇形 / 环 / 直线 / 装置 / 自身）。
     3. **效**：命中之后做什么（伤害 / 灼烧 / 电弧 / 减速 / 定身 / 击退 / 回血 / 吸血）。

   命的判定**全部复用已有的东西**：`queryCircle`（空间网格）、`damageEnemy`（伤害与元素）、
   `hitWalls`（暗门墙）、`Emit`（特效）、`sfx`（声音）。技能不新开一条伤害路径 ——
   那条路径上每一处都已经被测试与指纹钉住了。

   ⚠ **默认档恒等**：`S.skills.slots` 为空时这一整段都不执行
   （`updateSkills` 第一行就返回），所以"没点技能树的玩家"与改造前逐位相同。
   ========================================================= */
function updateSkills(dt, input) {
  if (!S || !S.skills || !S.skills.slots.length) return;
  castEnergy(dt);

  var wantCast = false, wantSlot = 0;
  var mode = String((Game.cfg && Game.cfg.combatMode) || 'auto');
  if (mode === 'manual') {
    /* 手动模式：**玩家按了才放**，方向由输入给（`aimX/aimY`）。
       没按就什么都不做 —— 这是"手动"的定义，不是"没实现自动"。 */
    if (input && input.cast) { wantCast = true; wantSlot = Math.max(0, Math.floor(Number(input.slot) || 0)); }
  } else {
    /* 自动模式：冷却好了就放，方向朝最近的目标。
       `autoCast` 与武器那条自动攻击是同一套思路（以撒/Brotato 那一类）。 */
    for (var i = 0; i < S.skills.slots.length; i++) {
      var st0 = S.skills.slots[i];
      if (st0.cd > 0) continue;
      if (S.energy < st0.skill.cost) continue;
      wantCast = true; wantSlot = i;
      break;
    }
  }

  for (var j = 0; j < S.skills.slots.length; j++) {
    var st = S.skills.slots[j];
    if (st.cd > 0) st.cd = Math.max(0, st.cd - dt);
  }
  if (!wantCast) return;

  var slot = S.skills.slots[wantSlot];
  if (!slot || slot.cd > 0) return;
  if (S.energy < slot.skill.cost) {
    /* 手动的"按了但没能量"要给反馈 —— 否则玩家以为按键坏了。
       自动模式不会走到这里（上面已经筛过）。 */
    if (mode === 'manual') { sfx('deny'); slot.flash = 0.35; }
    return;
  }
  castSkill(slot, slotIdxOf(wantSlot), aimFor(slot, input));
}

/** 这个槽位在载荷里的下标（界面与输入用它对齐） */
function slotIdxOf(i) { return i; }

/**
 * 这一发朝哪。
 * @returns { x, y, ang }：`ang` 是弧度，`x/y` 是"朝着看的那个点"（画指示线用）
 *
 * 手动模式用玩家给的方向；没给方向（手柄没推、鼠标没动过）时**退回最近目标** ——
 * 否则"站着不动按技能"会朝右打，那比不打更让人困惑。
 */
function aimFor(slot, input) {
  var p = S.player;
  var ax = input && isFinite(input.aimX) ? Number(input.aimX) : 0;
  var ay = input && isFinite(input.aimY) ? Number(input.aimY) : 0;
  var len = Math.sqrt(ax * ax + ay * ay);
  if (slot.skill.target === 'self' || len < 1e-6) {
    var t = nearestEnemy(p.x, p.y, 900);
    if (t) { var a = U.angle(p.x, p.y, t.x, t.y); return { x: t.x, y: t.y, ang: a, auto: true }; }
    return { x: p.x + Math.cos(p.aim || 0), y: p.y + Math.sin(p.aim || 0), ang: p.aim || 0, auto: true };
  }
  ax /= len; ay /= len;
  return { x: p.x + ax * 400, y: p.y + ay * 400, ang: Math.atan2(ay, ax), auto: false };
}

function castEnergy(dt) {
  var max = 100;
  if (S.energyMax && S.energyMax !== max) max = S.energyMax;
  /* 回充速度：满条 12 秒左右回满（一个技能 20 能量 ≈ 2.4 秒攒一发）。
     它比冷却慢，所以"连放两个技能"不会成为常态 —— 这正是能量存在的意义。 */
  var regen = max / 12;
  S.energy = Math.min(max, (S.energy || 0) + regen * dt);
}

/**
 * 放一个技能。
 * @param aim `aimFor` 的结果
 * 这里只做"形"的分派与资源扣除；**"效"落在 `applyPayload`**。
 */
function castSkill(slot, index, aim) {
  var p = S.player;
  if (!p) return false;
  var sk = slot.skill;
  S.energy = Math.max(0, S.energy - sk.cost);
  slot.cd = sk.cd;
  slot.castT = 0.18;
  S.shots = (S.shots || 0) + 1;          // 与武器共用一个"打了多少次"计数（结算/挑战读它）

  var pr = sk.params || {};
  var ang = aim.ang;
  var dmg = skillDamage(sk, pr);
  /* 把"这一发是什么"挂在会话上：`hurtWithSkill` 是命中回调，
     它拿不到栈上的 `sk`（形 → damageEnemy → 效，中间隔了好几层）。
     用会话字段而不是闭包，是因为形与效分散在六个小函数里。 */
  S.skills.casting = sk;
  var element = sk.element || '';
  var hitCount = 0;

  if (sk.form === 'bolt') {
    hitCount = formBolt(p, pr, aim, dmg, element);
  } else if (sk.form === 'cone') {
    hitCount = formCone(p, pr, ang, dmg, element);
  } else if (sk.form === 'nova') {
    hitCount = formNova(p, pr, dmg, element);
  } else if (sk.form === 'beam') {
    hitCount = formBeam(p, pr, ang, dmg, element);
  } else if (sk.form === 'summon') {
    hitCount = formSummon(p, pr, dmg);
  } else if (sk.form === 'buff') {
    hitCount = formBuff(p, pr, ang, dmg, element);
  }

  /* ---- 效：命中之后的附加（回血 / 吸血 / 减速 / 定身 / 灼烧 / 电弧） ---- */
  applyPayload(sk, pr, null, dmg, element);

  /* ---- 符文的两个"读原始修正"的效果 ---- */
  var mods = S.skills.mods || {};
  if (mods.scrapOnHit && hitCount > 0) {
    /* 「贪婪」：技能命中额外产出废料（按伤害折算）——
       它把"技能打得多"变成一条经济来源，是收藏家的身份。 */
    var gain = Math.max(1, Math.round(dmg * hitCount * 0.12));
    p.scrap = (p.scrap || 0) + gain;
    S.stats_total.scrap += gain;
    S.waveScrap += gain;
  }

  S.skills.casting = null;
  Game.events.emit('skillCast', { id: sk.id, name: sk.name, slot: index, hits: hitCount });
  return true;
}

/** 技能伤害：**相对武器面板**的倍率 —— 技能该随装备成长，否则中后期变成摆设 */
function skillDamage(sk, pr) {
  var p = S.player;
  var base = 0;
  for (var i = 0; i < p.weapons.length; i++) {
    if (weaponDamage(p.weapons[i]) > base) base = weaponDamage(p.weapons[i]);
  }
  /* 一把武器都没有时给一个下限（`pistol` 的基准），否则技能会打出 0 伤害 */
  if (!(base > 0)) base = 7;
  var d = base * (pr.mul || 1);
  /* 「狂怒」：按已失生命加成（受虐狂的符文） */
  var rage = (S.skills.mods && S.skills.mods.rageScale) || 0;
  if (rage > 0 && S.stats.maxHp > 0) {
    var missing = 1 - U.clamp(p.hp / S.stats.maxHp, 0, 1);
    d *= (1 + missing * rage);
  }
  return d;
}

/* ---------------- 六种形 ---------------- */

function formBolt(p, pr, aim, dmg, element) {
  var count = Math.max(1, Math.floor(pr.count || 1));
  var spread = pr.spread || 0;
  var speed = pr.speed || 560;
  var hits = 0;
  for (var k = 0; k < count; k++) {
    var a = aim.ang;
    if (count > 1) a += (k - (count - 1) / 2) * spread;
    var spd = speed * (0.94 + S.rnd() * 0.12);
    S.bullets.push(Comp.spawn('bullet', {
      x: p.x, y: p.y,
      vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
      r: pr.radius || 6,
      dmg: dmg, pierce: Math.max(0, Math.floor(pr.pierce || 0)), hitSet: null,
      life: pr.life || 1.5, lifeMax: pr.life || 1.5,
      color: PAL.STEEL, dark: PAL.DARK,
      kind: 'orb',
      element: element,
      knock: 26,
      blast: 0,
      crit: false, bigCrit: false,
      fromX: p.x, fromY: p.y,
    }));
    hits++;
  }
  Emit.muzzle(p.x, p.y, aim.ang, true);
  sfx('shoot', 'laser');
  return hits;
}

function formCone(p, pr, ang, dmg, element) {
  var range = pr.range || 130;
  /* 默认弧度走 Bronana.DEFAULT_ARC：与武器那边**同一个常量** ——
     技能与武器的「默认扇形」必须是同一个角度，否则同一个玩家会看到两种手感。 */
  var arc = (pr.arc || Bronana.DEFAULT_ARC) * Math.PI / 180;
  var half = arc / 2;
  var hit = queryCircle(p.x, p.y, range);
  var n = 0;
  for (var i = 0; i < hit.length; i++) {
    var e = hit[i];
    var ea = U.angle(p.x, p.y, e.x, e.y);
    if (Math.abs(((ea - ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI) > half) continue;
    hurtWithSkill(e, dmg, element, p.x, p.y, 120);
    n++;
  }
  Emit.slash(p.x, p.y, range * 0.9, ang, arc);
  if (S.wallsNow.length && (S.skills.mods && S.skills.mods.hitsWalls)) {
    hitWalls(p.x, p.y, p.x + Math.cos(ang) * range, p.y + Math.sin(ang) * range, range * 0.4, dmg);
  }
  sfx('melee');
  return n;
}

function formNova(p, pr, dmg, element) {
  var radius = pr.radius || 150;
  var hit = queryCircle(p.x, p.y, radius);
  var n = 0;
  for (var i = 0; i < hit.length; i++) {
    hurtWithSkill(hit[i], dmg, element, p.x, p.y, 160);
    n++;
  }
  Emit.shockRing(p.x, p.y);
  if (S.wallsNow.length && (S.skills.mods && S.skills.mods.hitsWalls)) {
    hitWalls(p.x - radius, p.y, p.x + radius, p.y, radius * 0.5, dmg);
  }
  sfx('explode');
  return n;
}

function formBeam(p, pr, ang, dmg, element) {
  var len = pr.length || 420;
  var w = (pr.width || 14) / 2;
  var x1 = p.x + Math.cos(ang) * len, y1 = p.y + Math.sin(ang) * len;
  /* 用两条偏移的平行线段做"带宽"：`Col.segCircle` 是唯一实现，
     两次调用分别覆盖带的两侧 —— 比新写一个"点到线段距离"更安全
     （新写一份就会与碰撞那份分叉，而分叉的表现是"看起来打到了却没伤害"）。 */
  var nx = -Math.sin(ang) * w, ny = Math.cos(ang) * w;
  var hit = queryCircle((p.x + x1) / 2, (p.y + y1) / 2, len / 2 + w + 24);
  var n = 0;
  for (var i = 0; i < hit.length; i++) {
    var e = hit[i];
    var t1 = Col.segCircle(p.x + nx, p.y + ny, x1 + nx, y1 + ny, e.x, e.y, e.r);
    var t2 = Col.segCircle(p.x - nx, p.y - ny, x1 - nx, y1 - ny, e.x, e.y, e.r);
    if (t1 < 0 && t2 < 0) continue;
    hurtWithSkill(e, dmg, element, p.x, p.y, 80);
    n++;
  }
  if (S.wallsNow.length) hitWalls(p.x, p.y, x1, y1, w, dmg);
  Emit.muzzle(p.x, p.y, ang, true);
  sfx('shoot', 'sniper');
  return n;
}

function formSummon(p, pr, dmg) {
  var count = Math.max(1, Math.floor(pr.count || 1));
  var life = pr.life || 14;
  var range = pr.range || 260;
  for (var k = 0; k < count; k++) {
    var a = (k / count) * U.TAU;
    S.turrets.push(Comp.spawn('turret', {
      x: p.x + Math.cos(a) * 70, y: p.y + Math.sin(a) * 70,
      hp: 30 + (S.stats.engineering || 0) * 2, maxHp: 30 + (S.stats.engineering || 0) * 2,
      r: 18,
      /* 技能的装置比道具给的炮塔**有寿命**：它是"临时帮手"而不是"永久多一座"。 */
      life: life, lifeMax: life, range: range,
      dmgMul: Math.max(0.2, (pr.mul || 1) * 0.6)
    }));
  }
  Emit.shockRing(p.x, p.y);
  sfx('buy');
  return count;
}

function formBuff(p, pr, ang, dmg, element) {
  var hits = 0;
  /* 位移：沿朝向冲一段，途中撞到的都吃伤害（角斗士的突刺 / 疾行者的闪步） */
  var dash = pr.dash || 0;
  if (dash > 0) {
    var nx = p.x + Math.cos(ang) * dash, ny = p.y + Math.sin(ang) * dash;
    var cl = Arena.clampPos(nx, ny, p.r);
    /* 途中扫一遍（线段判定，不是落点判定）—— 不然"冲过去"会穿怪 */
    var near = queryCircle((p.x + cl.x) / 2, (p.y + cl.y) / 2, dash / 2 + 60);
    for (var i = 0; i < near.length; i++) {
      if (Col.segCircle(p.x, p.y, cl.x, cl.y, near[i].x, near[i].y, near[i].r + 10) < 0) continue;
      hurtWithSkill(near[i], dmg, element, p.x, p.y, 200);
      hits++;
    }
    p.x = cl.x; p.y = cl.y;
    p.px = cl.x; p.py = cl.y;
    Emit.blood(cl.x, cl.y, 4);
    sfx('melee');
  }
  return hits;
}

/**
 * "效"的落点。
 *
 * @param e 目标（`null` = 形的分派已经自己处理完了命中，这里只做**不依赖目标**的那部分）
 * 为什么 `e` 可以是 null：有些效（回血、给自己上 buff）根本不需要目标，
 * 而把它们分成两条路径会让"形 × 效"的组合表出现空洞。
 */
function applyPayload(sk, pr, e, dmg, element) {
  var p = S.player;
  switch (sk.payload) {
    case 'heal':
      healPlayer(pr.heal || 0, true);
      return;
    case 'leech':
      /* 吸血：按"这一发打出的伤害"回一小口（不是按命中数 —— 那会让 AoE 变成大回血） */
      if (e) healPlayer(dmg * (pr.leech || 0) * 0.25, true);
      return;
    default: return;
  }
}

/** 技能打中一只怪：**走同一个 damageEnemy**，再按效补一层状态 */
function hurtWithSkill(e, dmg, element, fromX, fromY, knock) {
  var pr = null, sk = null;
  /* 找到当前这一发的载荷（`castSkill` 把它挂在 `S.skills.casting` 上） */
  sk = S.skills && S.skills.casting;
  if (sk) pr = sk.params || {};
  damageEnemy(e, dmg, {
    fromX: fromX, fromY: fromY,
    knock: knock,
    element: element,
    noCrit: true
  });
  if (!sk || e.dead) return;
  var mods = S.skills.mods || {};
  /* 「附魔」：技能附带一层电击 */
  if (mods.addElement && sk.element !== 'shock') {
    applyElement(e, 'shock', dmg * 0.35, 0);
  }
  switch (sk.payload) {
    case 'burn': applyBurn(e, pr && pr.burn ? pr.burn : 7); break;
    case 'slow':
      e.slow = Math.max(e.slow || 0, (pr && pr.life) || 3);
      e.slowMul = Math.min(e.slowMul === undefined ? 1 : e.slowMul, 1 - ((pr && pr.slow) || 0.45));
      break;
    case 'stun':
      e.stun = Math.max(e.stun || 0, (pr && pr.stun) || 0.55);
      break;
    default: break;
  }
}


function fire(w, target) {
  var p = S.player;
  var def = w.def;
  var s = S.stats;
  var ang = U.angle(p.x, p.y, target.x, target.y);
  p.aim = ang;

  // 武器位置：由骨架的武器挂点算（render.ts 用的是同一根骨头、同一份公式）
  var bone = Bronana.seat(p.rig, w.index, ang, p.r, p.x, p.y);
  Bronana.seatPoint(p.rig, bone, _seat);

  var dmg = weaponDamage(w);
  var crit = S.rnd() < Stats.critChance(s);
  S.shots = (S.shots || 0) + 1;

  if (def.type === 'melee') {
    w.swing = 1;
    var arc = Bronana.meleeArc(def);
    var half = arc / 2;
    var hit = queryCircle(p.x + Math.cos(ang) * weaponReach(w) * 0.45,
      p.y + Math.sin(ang) * weaponReach(w) * 0.45, weaponReach(w) * 0.72);
    var n = 0;
    for (var i = 0; i < hit.length; i++) {
      var e = hit[i];
      var ea = U.angle(p.x, p.y, e.x, e.y);
      var diff = Math.abs(((ea - ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (diff > half) continue;
      damageEnemy(e, dmg, { fromX: p.x, fromY: p.y, knock: def.knock ? def.knock * Weapons.mul(w, 'knock') : def.knock, element: def.element, isMelee: true });
      n++;
    }
    Emit.slash(p.x, p.y, weaponReach(w) * 0.82, ang, arc);
    // 近战也能砸墙（只用枪的 build 与只用刀的 build 都该能开密室）
    if (S.wallsNow.length) {
      var wp = { x: p.x + Math.cos(ang) * weaponReach(w), y: p.y + Math.sin(ang) * weaponReach(w) };
      hitWalls(p.x, p.y, wp.x, wp.y, weaponReach(w) * 0.5, dmg);
    }
    sfx('melee');
  } else {
    /* 同名武器多打一发的旧规则（`w.dup`）已删除：那个位置现在归**合成**。
       理由：两把同型号的枪，"再打一发"是最弱的一种解释（数值上几乎看不见），
       而"合成一把更高品级的"是 brotato 那条被验证过的、玩家真会去规划的路。
       于是同名武器仍然有用 —— 只是它的用途从"多一发"变成了"燃料"。 */
    var shots = def.shots || 1;
    var pierceBonus = Weapons.pierceBonus(w);
    /* 「克隆装置」这一类"改机制"的道具：件数由 recalcStats 折进 `S.itemFx` */
    var extra = (S.itemFx && S.itemFx.extraProjectile) ? 1 : 0;
    shots += extra;

    var spread = (def.spread || 0) * Math.PI / 180;
    Bronana.aheadPoint(p.rig, bone, Bronana.BULLET_AHEAD, _seat);
    var bx = _seat.x, by = _seat.y;
    for (var k = 0; k < shots; k++) {
      var a = ang;
      if (shots > 1) a += (k - (shots - 1) / 2) * (spread / Math.max(1, shots - 1)) * 2;
      if (!def.spread && shots > 1) a += (k - (shots - 1) / 2) * 0.12;
      var spd = (def.speed || 600) * (0.94 + S.rnd() * 0.12);
      var b = Comp.spawn('bullet', {
        x: bx, y: by,
        vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
        r: def.kind === 'orb' ? 9 : (def.kind === 'rocket' ? 8 : 5),
        dmg: dmg, pierce: (def.pierce || 0) + pierceBonus, hitSet: null,
        life: def.life || 1.6, lifeMax: def.life || 1.6,
        color: (def.tints && def.tints[0]) || PAL.STEEL,
        dark: (def.tints && def.tints[1]) || PAL.DARK,
        kind: bulletKind(def),
        element: def.element,
        knock: (def.kb || 30) * Weapons.mul(w, 'knock'),
        blast: def.blast || 0,
        crit: crit, bigCrit: crit,
        fromX: p.x, fromY: p.y
      });
      if (b.pierce > 0) b.hitSet = [];
      S.bullets.push(b);
    }
    Bronana.aheadPoint(p.rig, bone, Bronana.MUZZLE_AHEAD, _seat);
    Emit.muzzle(_seat.x, _seat.y, ang, def.kind === 'shotgun');
    sfx('shoot', def.kind);
  }
}

function bulletKind(def) {
  switch (def.kind) {
    case 'rocket': return 'rocket';
    case 'flame': return 'flame';
    case 'orb': return 'orb';
    case 'laser': case 'railgun': return 'laser';
    case 'crossbow': case 'sniper': return 'bolt';
    case 'sling': return 'ball';
    default: return 'shot';
  }
}

/* ---------------- 炮塔 ---------------- */
function updateTurrets(dt) {
  for (var i = 0; i < S.turrets.length; i++) {
    var t = S.turrets[i];
    /* **技能的装置有寿命**（`life` 留 0 = 不过期，那是道具白给的炮塔）。
       倒着遍历（上面那个 for 改成 i--）是为了能在循环里回收 ——
       正向删会把后面的元素跳过。 */
    if (t.life > 0) {
      t.life -= dt;
      if (t.life <= 0) { S.turrets.splice(i, 1); continue; }
    }
    if (t.muzzle > 0) t.muzzle -= dt;
    t.cd -= dt;
    var target = nearestEnemy(t.x, t.y, t.range > 0 ? t.range : 300);
    if (!target) continue;
    t.aim = U.angle(t.x, t.y, target.x, target.y);
    if (t.cd > 0) continue;
    t.cd = Math.max(0.08, 0.55 * Stats.cooldownMul(S.stats));
    t.muzzle = 0.07;
    var dmg = (4 + S.stats.engineering * 0.6 + S.stats.rangedDmg * 0.5) * (1 + S.stats.damage);
    /* 技能的装置按**技能强度**算（`dmgMul`），道具炮塔按工程学那套 ——
       两者共用这一个更新函数，所以倍率做成"乘法上的一个系数"（缺省 0 = 恒等）。 */
    if (t.dmgMul > 0) dmg *= t.dmgMul;
    var spd = 680;
    S.bullets.push(Comp.spawn('bullet', {
      x: t.x, y: t.y, vx: Math.cos(t.aim) * spd, vy: Math.sin(t.aim) * spd,
      r: 5, dmg: dmg, life: 1.2, lifeMax: 1.2,
      color: PAL.STEEL, dark: PAL.DARK, kind: 'shot', knock: 26,
      fromX: t.x, fromY: t.y
    }));
    sfx('shoot', 'pistol');
  }
}

/* ---------------- 怪物 ----------------
   行为与弹幕模式本身在 ai.ts 里（注册表驱动，未知名字当场抛错）。
   这里只做**适配**：AI 不认识 Game / Session，它要的是下面这几个能力。
   ctx 复用同一个对象，每帧零分配。 */
/* AI 能用的音效只有"开枪"这一件，所以注入的是**一个只有 shoot 的能力对象**，
   而不是整个 Sfx —— 注入面越小，AI 层能碰到的东西越少（它连 Sfx 这个名字都不认识）。 */
var _aiSfx = { shoot: function (kind) { sfx('shoot', kind); } };
var _aiCtx: AiCtx = {
  dt: 0, player: null, d: 0, nx: 0, ny: 0, sfx: null,
  query: function (x, y, r) { return queryCircle(x, y, r); },
  hurt: function (dmg) { hurtPlayer(dmg); },
  kill: function (e) { killEnemy(e); },
  shoot: function (e, a, big) { pushEnemyBullet(e, a, big); },
  clamp: function (x, y, r) { return Arena.clampPos(x, y, r); },
  rnd: function () { return S.rnd(); },
  // 母巢召唤：走的是同一条刷怪路径（所以召唤物也受上限/回收策略管）
  spawn: function (id, x, y) { return spawnEnemy(Enemies.BY_ID[id], x, y, {}); },
  shake: function (a) { requestShake(a); }
};

function updateEnemies(dt) {
  var p = S.player;
  var list = S.enemies;
  _aiCtx.dt = dt; _aiCtx.player = p; _aiCtx.sfx = _aiSfx;
  for (var i = 0; i < list.length; i++) {
    var e = list[i];
    if (e.dead) continue;
    if (e.spawnT > 0) { e.spawnT -= dt; continue; }

    if (e.hitFlash > 0) e.hitFlash -= dt;
    if (e.burn > 0) {
      e.burn -= dt;
      e.hp -= e.burnDps * dt;
      if (S.rnd() < dt * 8) {
        Emit.ember(e);
      }
      if (e.hp <= 0) { killEnemy(e); continue; }
    }

    AI.step(e, _aiCtx);
  }
}

function pushEnemyBullet(e, a, boss?) {
  var def = e.def;
  var spd = def.projSpeed || 220;
  S.ebullets.push(Comp.spawn('ebullet', {
    x: e.x + Math.cos(a) * (e.r + 4),
    y: e.y + Math.sin(a) * (e.r + 4),
    vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
    r: e.def.boss ? 10 : 7,
    dmg: (def.projDmg || 3) * Enemies.dmgScale(Game.wave) * (e.elite ? ELITE_DMG : 1),
    color: def.projColor || PAL.E2,
    life: 3.2, kind: boss ? 'bossball' : 'ball'
  }));
}

/* ---------------- 子弹 ----------------
   命中判定是"扫掠"的：把这一步的位移当成线段去撞怪的圆。
   老实现只看落点，快速弹擦边时会整发穿过去（实测 railgun 有 5.6~9.1px 宽的穿透带）。
   判定半径仍保留原来的 +6 余量（这是刻意的手感宽容度，不是误差补偿），
   所以扫掠只会**多**命中那一圈擦边，不会让原本能打中的变少。
   候选按接触点的 t 升序结算，穿透（pierce）打到的第一只就是最近的那只。 */
var _cand = [];      // 复用的候选缓冲（按 t 升序）
var _candT = [];
var _candRaw = [];   // 网格查询结果（复用，避免每发子弹分配一个数组）
var _segQ = { x: 0, y: 0, r: 0 };

function updateBullets(dt) {
  for (var i = 0; i < S.bullets.length; i++) {
    var b = S.bullets[i];
    b.life -= dt;
    if (b.kind === 'rocket') { b.vx *= 1 - dt * 0.05; b.vy *= 1 - dt * 0.05; }
    var x0 = b.x, y0 = b.y;
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    if (b.kind === 'flame') {
      b.r = 10 + (1 - b.life / b.lifeMax) * 16;
    }

    // 命中判定：这一步扫过的线段 × 怪
    var rad = b.r + 6;
    // 暗门墙先判：打中墙的子弹就停在墙上（"对着可疑的墙打两枪"是真实动作）
    if (S.wallsNow.length && hitWalls(x0, y0, b.x, b.y, rad, b.dmg)) {
      Emit.deathExplosion(b.x, b.y, 12);
      b.life = -1;
      continue;
    }
    var box = Col.segBounds(x0, y0, b.x, b.y, rad, _segQ);
    var cand = queryCircle(box.x, box.y, box.r, _candRaw);
    var n = 0;
    for (var j = 0; j < cand.length; j++) {
      var e = cand[j];
      if (e.burrowed) continue;              // 钻地中的 Boss 连"命中"都不算（子弹穿过去）
      if (b.hitSet && b.hitSet.indexOf(e) >= 0) continue;
      var t = Col.segCircle(x0, y0, b.x, b.y, e.x, e.y, rad + e.r);
      if (t < 0) continue;
      var ins = n++;                       // 插入排序（候选通常 0~3 个）
      while (ins > 0 && _candT[ins - 1] > t) {
        _candT[ins] = _candT[ins - 1]; _cand[ins] = _cand[ins - 1];
        ins--;
      }
      _candT[ins] = t; _cand[ins] = e;
    }

    for (var h = 0; h < n; h++) {
      var hit = _cand[h];
      b.hitSet && b.hitSet.push(hit);

      damageEnemy(hit, b.dmg, {
        fromX: b.fromX, fromY: b.fromY,
        knock: b.knock, element: b.element,
        knockAngle: Math.atan2(b.vy, b.vx)
      });

      if (b.blast > 0) {
        explode(b);
        b.life = -1;
        break;
      }
      if (b.pierce > 0) { b.pierce--; }
      else { b.life = -1; if (b.kind === 'flame') b.life = 0; break; }
    }

    if (b.life > 0 && !Arena.inside(b.x, b.y, 40)) b.life = -1;
  }
  // 出界的已经 life<=0，回收统一由 Containers.reapAll 做（不再每步重建数组）
}

function explode(b) {
  Emit.bulletExplosion(b.x, b.y, b.blast, b.crit);
  requestShake(b.crit ? 0.34 : 0.20);   // 火箭/元素弹爆炸；暴击稍强
  var hits = queryCircle(b.x, b.y, b.blast);
  for (var i = 0; i < hits.length; i++) {
    var e = hits[i];
    damageEnemy(e, b.dmg * 0.75, {
      noCrit: true, fromX: b.x, fromY: b.y, knock: 90, element: b.element, showText: i < 6
    });
  }
  // 爆炸同样炸墙（火箭/手雷是"开墙"的自然工具）
  if (S.wallsNow.length) hitWalls(b.x, b.y, b.x, b.y, b.blast * 0.6, b.dmg);
  sfx('explode');
}

function updateEnemyBullets(dt) {
  var p = S.player;
  for (var i = 0; i < S.ebullets.length; i++) {
    var b = S.ebullets[i];
    b.life -= dt;
    var x0 = b.x, y0 = b.y;
    b.x += b.vx * dt; b.y += b.vy * dt;
    // 同样走扫掠：敌弹现在还慢（单步 5px 上下），但改了速度就不会突然漏判
    var rr = b.r + p.r - 4;
    if (Col.segCircle(x0, y0, b.x, b.y, p.x, p.y, rr) >= 0) {
      hurtPlayer(b.dmg);
      b.life = -1;
    }
    if (!Arena.inside(b.x, b.y, 30)) b.life = -1;
  }
}

/* ---------------- 掉落物 ---------------- */
function updatePickups(dt) {
  var p = S.player;
  var radius = Stats.pickupRadius(S.stats);
  for (var i = 0; i < S.pickups.length; i++) {
    var it = S.pickups[i];
    var dx = p.x - it.x, dy = p.y - it.y;
    var d = Math.sqrt(dx * dx + dy * dy) || 1;
    var pullDist = it.kind === 'heal' ? radius * 0.85 : radius;
    if (d < pullDist) {
      var pull = (1 - d / pullDist) * 620 + 120;
      it.vx += (dx / d) * pull * dt * 6;
      it.vy += (dy / d) * pull * dt * 6;
    }
    it.x += it.vx * dt; it.y += it.vy * dt;
    it.vx *= Math.max(0, 1 - dt * 5);
    it.vy *= Math.max(0, 1 - dt * 5);

    if (d < p.r + 10) {
      collect(it);
      it.dead = true;          // 被捡走 = 该回收（由容器总账统一交换删除）
    }
  }
}

/** 收获加成（平方根递减，防止道具堆叠导致废料爆炸） */
function harvestMul() {
  return 1 + Math.min(2.0, Math.sqrt(Math.max(0, S.stats.harvesting)) * 0.085);
}

function collect(it) {
  var p = S.player;
  if (it.kind === 'heal') {
    healPlayer(it.value);
    sfx('pickup');
    return;
  }
  // 废料收集也吃契约的"废料收集"那一条（矿脉/贪食）。**经验跟着废料走**，
  // 所以它就是"经济契约也顺带养得更快"——这条关系是刻意的，写在注释里免得以后被当成 bug。
  var gain = (it.value || 1) * harvestMul() * econMul('materialMul') * itemCostMul('matMul');
  p.scrap = (p.scrap || 0) + gain;
  p.xp += gain;
  S.stats_total.scrap += gain;
  S.waveScrap += gain;
  sfx('pickup');
  checkLevelUp();
}

/* ---------------- 粒子（生命周期与回收交给 emit.ts） ---------------- */
function updateParticles(dt) {
  Emit.update(dt);
  // 抖动衰减不在这里：它属于表现层，由 render.ts 按渲染时间衰减
}

function cleanup() {
  // 回收 + 上限兜底交给容器总账（containers.ts）：就地交换删除，零分配。
  // 老实现对怪是"新建数组 + 逐个 push 存活者"，对子弹/敌弹/掉落物则**一直是**那个写法 ——
  // 每步都分配一个新数组并全量拷贝，即使这一帧一个对象都没死。
  Containers.reapAll(S);
  Containers.enforceAll(S);
}

/* =========================================================
   容器声明（对象管理是"一套系统"：每个容器在一处说清装什么、多大、满了怎么办、怎么回收）
   ========================================================= */
Containers.declare('enemies', {
  list: 'enemies', note: '场上怪物', cap: Game.cfg.enemyCap, onFull: 'reclaim-farthest',
  keep: function (e) { return !!e.def.boss; }        // Boss 不参与"回收最远的"
});
Containers.declare('bullets', {
  list: 'bullets', note: '玩家子弹', cap: 1500, onFull: 'drop-oldest',
  dead: function (b) { return !(b.life > 0); }
});
Containers.declare('ebullets', {
  list: 'ebullets', note: '敌弹（怪物发射的弹幕）', cap: 800, onFull: 'drop-oldest',
  dead: function (b) { return !(b.life > 0); }
});
Containers.declare('pickups', {
  list: 'pickups', note: '掉落物（废料 / 回血）', cap: 500, onFull: 'drop-oldest'
});
Containers.declare('turrets', {
  list: 'turrets', note: '工程炮塔', cap: 24, onFull: 'reject'
});
Containers.declare('particles', {
  list: 'particles', note: '视觉粒子（池化，回收在 emit.ts）', cap: Emit.VIS_CAP, policy: 'external'
});
Containers.declare('textParticles', {
  list: 'textParticles', note: '伤害飘字（池化，回收在 emit.ts）', cap: Emit.TEXT_CAP, policy: 'external'
});
Containers.declare('decals', {
  list: 'decals', note: '血迹环形缓冲（写满覆盖最旧，越旧越淡）', cap: Game.cfg.decalCap,
  policy: 'ring', onFull: 'never'
});
Containers.declare('freeParticles', {
  list: 'freeParticles', note: '粒子空闲池（复用，不参与上限）', cap: Emit.VIS_CAP, policy: 'external'
});
Containers.declare('freeTextParticles', {
  list: 'freeTextParticles', note: '飘字空闲池', cap: Emit.TEXT_CAP, policy: 'external'
});
// 玩家身上的两个容器（路径带点号）：由 UI 卖出与开局重置管理，不参与每步回收
Containers.declare('weapons', {
  list: 'player.weapons', note: '玩家武器（上限就是武器槽数）',
  cap: Game.cfg.maxWeapons, onFull: 'reject', policy: 'external'
});
Containers.declare('items', {
  list: 'player.items', note: '玩家道具（可叠加，不设上限：受废料经济限制）',
  cap: Infinity, onFull: 'never', policy: 'external'
});
Containers.declare('offers', {
  /* 货架件数 = `4 + 难度 + 据点货架 + 这一间房（商店房 +2）+ 契约`，
     然后武器与道具**各** n 件 —— 所以件数会随进度长（实测到过 16 件）。
     `cap: 12` 是照着早期数值写的，于是"货架变多"这条正当的成长
     会被容器不变量报成"上限被绕过"（假报警）。真正的约束在 `market.ts`
     的 `n` 那一行：它由经济与房间决定，不在这里重复一遍。 */
  list: 'offers', note: '商店货架（每次进商店重掷；件数由经济与房间给，不设上限）',
  cap: Infinity, onFull: 'never', policy: 'external'
});

/* =========================================================
   结算
   ========================================================= */
function buildSummary(win) {
  var p = S.player;
  // 除了给人看的 name，也带上 id：挑战里的"用某角色"与图鉴的点亮都靠 id
  // （名字是显示用的，可能改；id 才是身份）
  var wIds = [], iIds = [], wTop = [], iTop = [];
  for (var i = 0; i < p.weapons.length; i++) {
    wIds.push(p.weapons[i].def.id);
    if (p.weapons[i].def.tier >= 4) wTop.push(p.weapons[i].def.id);
  }
  for (i = 0; i < p.items.length; i++) {
    iIds.push(p.items[i].def.id);
    if (p.items[i].def.tier >= 4) iTop.push(p.items[i].def.id);
  }
  return {
    win: !!win,
    wave: Game.wave,
    level: p.level,
    kills: S.stats_total.kills,
    scrap: Math.round(S.stats_total.scrap),
    /* ---- 两种货币分开报（**曾经混成一个字段，代价是一笔真实的双计**）----
       本作有**两种**局内货币，名字容易混、读错了不报错：
         · 废料 `scrap`    —— 商店本钱，与击杀挂钩（`stats_total.scrap`）
         · 材料 `material` —— **制造业本钱**，清间与奖励房给，
                              而且它**当场进钱包**（`Profile.wallet.material`）
       这里曾经只有一个 `earned`，而它被三处当作**材料**入账
       （`Profile.applyRun` 的 `addMaterial`、`Save.recordRun` 的 totalMaterials、
       `main.ts` 的派发），实际填的却是**废料累计** —— 于是玩家每局都拿到一笔
       凭空多出来的材料（等于废料又发了一遍）。它不报错，只让"材料"这个数字说谎。

       现在两个字段各自只装自己那种货币：
         · `earned`    = 废料累计（"这一局一共打出来多少废料"，不是手里剩多少）
         · `materials` = 材料累计（`S.materialEarned`，`gainMaterial` 记的那一笔账）
       下面每一处消费点都按这两个名字读，不再互相顶替。 */
    earned: Math.round(S.stats_total.scrap),
    materials: Math.max(0, Math.round(S.materialEarned || 0)),
    /* **据点快照**：离线产出（局外）读它 —— 据点本身是局内的（`S.keep`），
       局外读不到，所以在结算这一刻截一份。 */
    keep: cloneNumMap(S.keep),
    damage: Math.round(S.stats_total.dmg),
    taken: Math.round(S.stats_total.taken),
    healed: Math.round(S.stats_total.healed),
    charName: S.charDef.name,
    char: S.charDef.id,
    danger: S.danger,
    packs: S.packsOpened || 0,
    packSpent: S.packSpent || 0,
    weapons: p.weapons.map(function (w) { return w.def.name; }),
    items: p.items.map(function (it) { return it.def.name; }),
    weaponIds: wIds, itemIds: iIds,
    masteredWeaponIds: wTop, masteredItemIds: iTop,
    /* ---- 剧情/档案要的"这一局碰到了什么来源" ----
       模拟层只报事实：打到第几层、打赢了哪几只 Boss、发现了几间密室、见过哪些事件。
       "这些来源对应哪一片记录、哪一句台词"属于接入层，模拟层不认识那一套。 */
    floor: S.floor,
    bossesDown: Object.keys(S.bossesDown || {}),
    coreEarned: Math.max(0, Math.round(S.coreEarned || 0)),
    secrets: S.secretsFound || 0,
    events: (S.runEvents || []).slice(),
    stats: S.stats
  };
}

/* =========================================================
   对外 API
   ========================================================= */
Game.newRun = function (charId, seed, danger, opening, smods, skillBuild) {
  var def = Chars.BY_ID[charId] || Chars.LIST[0];
  var s = newSession(def, seed, danger, opening, smods, skillBuild);
  Game.setState('playing', true);   // 从选人界面进入新一局
  Game.events.emit('runStart', def);
  return s;
};

/* =========================================================
   **存档角色**（R50）：改哪一份存档、这一档的那个人是谁
   ---------------------------------------------------------
   为什么这几个口开在 `Game` 而不是让界面直接读 `Profile`：
   与 `Game.material` / `Game.keepBuy` 同一条纪律 —— 界面走一个口，
   于是"这个人归哪一层"只有一个答案。真正的账在 `profile.ts`
   （`data.characters[槽位]`），这里只是**转发**，一行逻辑都不加。
   ========================================================= */
Game.character = function () { return Profile.character(); };
Game.hasCharacter = function () { return Profile.hasCharacter(); };
Game.saveCharacter = function (raw, charId) { return Profile.saveCharacter(raw, charId); };
Game.setCharacterMeta = function (patch) { return Profile.setCharacterMeta(patch); };
/** 存档角色 + 职业本色 → 渲染层要的三样（外观的**唯一**分派处） */
Game.renderLookOf = function (charDef) { return Profile.renderLookOf(charDef); };
/** 捏人页要画的三列（技能 / 属性 / 天赋）—— 界面照它画，不自己翻表 */
Game.creationOptions = function () { return Profile.creationOptions(); };
/** 一次**确定性的**随机外观（捏人页的"随机"按钮）：同一种子 → 同一套 */
Game.randomLook = function (seed) { return Character.randomLook(seed); };

/* =========================================================
   存档：一局怎么序列化由玩法层自己决定
   只存"进度"，不存场上实体（怪/子弹/粒子/贴花）：那些是派生状态，
   恢复时由 startWave 重新铺开即可。代价是**随机数流不会接着原来的走** ——
   恢复的是进度，不是"同一局的未来"（那需要整局重放）。

   ⚠ **编解码在 `run_save.ts`**（`RunSave`）。这里只做一件事：
   把"哪几个字段属于存档"摊平传过去。为什么要素数摊平而不是把 `S` 递进去 ——
   那样 `run_save.ts` 就得认识 `Session` 的 78 个字段里哪几个是存档，
   而"哪几个是存档"正是这张实参表在回答的问题（它自己就是那份文档）。
   ========================================================= */
Game.exportRun = function () {
  if (!S || !S.player) return null;
  return RunSave.serialize({
    sess: S,
    waves: Game.wave,
    speed: Game.speed,
    keep: S.keep,
    forge: Object.keys(S.forge || {}),
    cleared: clearedIds(),
    seen: seenIds(),
    walls: Object.keys(S.walls),
    bossesDown: Object.keys(S.bossesDown || {})
  });
};

/** 这一层里已清 / 已发现的房间 id（存档用；地图本身由种子重建） */
function clearedIds() {
  var out = [];
  if (!S.map) return out;
  for (var i = 0; i < S.map.rooms.length; i++) if (S.map.rooms[i].cleared) out.push(S.map.rooms[i].id);
  return out;
}
function seenIds() {
  var out = [];
  if (!S.map) return out;
  for (var i = 0; i < S.map.rooms.length; i++) if (S.map.rooms[i].seen) out.push(S.map.rooms[i].id);
  return out;
}

/** 只看不取：校验一份存档能不能用（给"继续上一局"按钮判断用） */
Game.inspectRun = function (data) {
  return RunSave.inspect(data, function (id) {
    var def = Chars.BY_ID[id];
    return def ? def.name : '';
  });
};

/**
 * 恢复一局。**能修的修，不能修的拒**：
 *   · 未知角色 / 非法波次 → 直接失败（返回 null，调用方保留标题页）
 *   · 未知武器 / 未知道具 → 丢掉那几条，其余照常恢复
 * @returns Session 或 null
 */
Game.importRun = function (data) {
  if (!data || typeof data !== 'object') return null;
  // 外部输入的第一道（也是唯一一道）卫生检查：非有限数不许进会话
  RunSave.sanitizeNumbers(data, 0);
  var info = Game.inspectRun(data);
  if (!info) return null;

  /* 据点与图纸都是"开局修正的来源"，所以要跟着**这一局的存档**走
     （与 `keep` 同一个理由：不带着它，读档就会把这些修正静默降级成"没有"）。
     注意存的是**这一局开局时**的图纸集合，而不是"现在档案里的"：
     中途解锁的新图纸不该回溯地改变一局已经开始的对局。 */
  var smods = { owned: data.keep, forge: data.forge };
  var sess = Game.newRun(info.char,
    isFinite(Number(data.seed)) ? Number(data.seed) : undefined,
    isFinite(Number(data.danger)) ? Number(data.danger) : 0,
    data.opening,
    smods,
    /* 技能构筑同理：存的是**开局时那一份**，读档要用它而不是档案里现在的
       （中途改了构筑不该回溯地改变一局已经开始的对局）。
       老存档没有这个字段 → 空数组 → 技能栏空着，与"这个存档本来就没有技能"一致。 */
    Array.isArray(data.skillBuild) ? data.skillBuild : []);
  var p = sess.player;

  // 升级加点（逐项按 StatMap 的键拷，未知键丢弃）
  var ups = data.upgrades;
  if (ups && typeof ups === 'object') {
    for (var k in p.upgrades) {
      if (Object.prototype.hasOwnProperty.call(ups, k) && isFinite(Number(ups[k]))) {
        p.upgrades[k] = Number(ups[k]);
      }
    }
  }
  p.level = info.level;
  p.xp = Math.max(0, Number(data.xp) || 0);
  p.scrap = Math.max(0, Number(data.scrap) || 0);
  if (isFinite(Number(data.speed)) && Number(data.speed) >= 1) Game.speed = Number(data.speed) >= 2 ? 2 : 1;

  /* 武器与道具：按 id 还原，未知 id 丢掉。
     武器带**品级**：老存档里是字符串（那时没有合成），新存档是 { id, t } —— 两种都收，
     认不出的档位就退回这把武器的出身档。
     **词条**（`a`）走同一条纪律：能给就用存档里的那一份覆盖（`addWeapon` 已经按
     当前随机流滚了一套，这里**覆盖**而不是"再滚一次" —— 读档不该改变玩家看着的装备）；
     老存档没有 `a` → 保留刚滚出来的那一套（算是"这件装备第一次被看见"）。 */
  p.weapons.length = 0;
  var ids = Array.isArray(data.weapons) ? data.weapons : [];
  for (var i = 0; i < ids.length; i++) {
    var wi = ids[i];
    if (typeof wi === 'string') { addWeapon(wi); continue; }
    if (!wi || typeof wi !== 'object') continue;
    var wd = Weapons.BY_ID[wi.id];
    if (!wd) continue;
    var wt = isFinite(Number(wi.t)) ? Math.floor(Number(wi.t)) : wd.tier;
    if (wt < wd.tier) wt = wd.tier;
    if (wt > Weapons.TIER_MAX) wt = Weapons.TIER_MAX;
    /* `p` = 付过的钱（回收价上限）。老存档 / 字符串武器没有 → 0 = 当作捡来的 */
    var wpaid = Math.max(0, Math.floor(Number(wi.p) || 0));
    var wnew = addWeapon(wd.id, wt, wpaid);
    if (wnew && wi.a) wnew.affixes = Affixes.fromSave(wi.a, 'weapon', wd);
  }
  /* **道具也要先清空**（武器那行 `p.weapons.length = 0` 的对称项）。
     不清的后果是实测出来的：`Game.newRun(…, data.opening)` 刚刚把开局道具
     （天赋「工程师」的炮塔、据点靶场的射程片…）发进 `p.items`，而 `data.items`
     里**也**有它们（`exportRun` 写的就是 `p.items`）——于是每读一次档就多一件：
     实测 items 1→2→3→4 件、攻速 0.10→0.26→0.42→0.60，`itemFx.turret` 1→2→3
     （读两次档白拿两个炮塔）。武器没这个洞，就是因为它有这一行。 */
  p.items.length = 0;
  var iids = Array.isArray(data.items) ? data.items : [];
  for (var j = 0; j < iids.length; j++) {
    /* 道具也一样：新存档是 `{ id, a }`（带词条），老存档是裸 id 字符串 —— 两种都收。
       裸 id 的那一支保留 `addItem` 刚滚出来的词条（"第一次被看见"）。 */
    var raw = iids[j];
    var iid = (typeof raw === 'string') ? raw : (raw && typeof raw === 'object' ? raw.id : null);
    var idef = iid ? Items.BY_ID[iid] : null;
    if (!idef) continue;
    var iit = addItem(idef);
    if (iit && raw && typeof raw === 'object' && raw.a) {
      iit.affixes = Affixes.fromSave(raw.a, 'item', idef);
    }
  }
  /* **一把武器都没有的存档不是"能玩的局"**（新版卖不出最后一把，所以这只会来自
     老档 / 坏档 / 被改名后认不出的武器 id）。为什么必须修：这一间"打完"的条件是
     **场上清空**（见 market.sellWeapon 那段注释），零武器 = 永远清不掉 = 商店永不再开。
     按同一条"能修的修"的原则，把角色的起始武器还给他（认不出角色的档 inspectRun 已经拒了）。 */
  if (p.weapons.length === 0 && sess.charDef && sess.charDef.startWeapons.length) {
    addWeapon(sess.charDef.startWeapons[0]);
  }

  // 跳到存档所在波次，并把生命/成长重新算一遍
  Game.wave = 1;
  restoreFloor(data);
  /* 这一间的房间效果要**从存档贴回来**（`restoreFloor` 只贴进度、不跑进门内容：
     回血/给废料那类一次性效果不能在读档时再来一遍）。不贴的后果是实测的：
     存档点在有折扣的商店房里（`shopSlots:2 / shopDiscount:0.10`），
     读档后同一间房的货架从 12 件变 8 件、道具包从 6 涨到 7 —— 同一份进度两个价。 */
  var rfx = data.roomFx;
  S.roomFx = {
    shopSlots: (rfx && isFinite(Number(rfx.shopSlots))) ? Math.max(0, Math.round(Number(rfx.shopSlots))) : 0,
    shopDiscount: (rfx && isFinite(Number(rfx.shopDiscount))) ? U.clamp(Number(rfx.shopDiscount), 0, 0.9) : 0,
    fastMul: (rfx && isFinite(Number(rfx.fastMul))) ? Math.max(0, Number(rfx.fastMul)) : 0,
    slowMul: (rfx && isFinite(Number(rfx.slowMul))) ? Math.max(0, Number(rfx.slowMul)) : 0
  };
  var cur0 = currentRoom();
  // 存档点是"清完这一间 → 进商店"，所以正常存档里当前房**是已清的**：
  // 这时不该把刚打完的那一间重打一遍（老实现就是重打，等于白送一遍怪和经验）
  var roomSettled = !!(cur0 && cur0.cleared);
  if (roomSettled) {
    Game.wave = Math.max(1, Math.floor(Number(info.wave) || 1));
    S.waveEnding = true;            // 这一间已经结算过：再落一次 endWave 会白送一份奖励
  } else {
    startWave(Math.max(1, Math.floor(Number(info.wave) || 1)));
  }
  recalcStats();
  p.hp = U.clamp(Number(data.hp) || sess.stats.maxHp, 1, S.stats.maxHp);
  p.xpNeed = Stats.xpNeeded(p.level);

  var t = data.totals;
  if (t && typeof t === 'object') {
    S.stats_total.kills = Math.max(0, Math.round(Number(t.kills) || 0));
    S.stats_total.scrap = Math.max(0, Number(t.scrap) || 0);
    S.stats_total.dmg = Math.max(0, Number(t.dmg) || 0);
    S.stats_total.taken = Math.max(0, Number(t.taken) || 0);
    S.stats_total.healed = Math.max(0, Number(t.healed) || 0);
    S.stats_total.waves = Math.max(0, Math.round(Number(t.waves) || 0));
  }
  S.packsOpened = Math.max(0, Math.round(Number(data.packsOpened) || 0));
  S.packSpent = Math.max(0, Math.round(Number(data.packSpent) || 0));
  /* 商店的此刻：货架按存档还原（**不重掷**），刷新价 / 刷新次数 / 锁定 / 免费刷新也带回来。
     认不出的武器与道具 id 直接丢（坏档防线与武器/道具一致）。 */
  S.rerolls = Math.max(0, Math.round(Number(data.rerolls) || 0));
  if (isFinite(Number(data.rerollCost))) S.rerollCost = Math.max(0, Math.round(Number(data.rerollCost)));
  S.shopLocked = data.shopLocked === true;
  S.shopBonus = Math.max(0, Number(data.shopBonus) || 0);
  S.freeRerolls = Math.max(0, Math.round(Number(data.freeRerolls) || 0));
  S.combineCount = Math.max(0, Math.round(Number(data.combineCount) || 0));
  S.craftCount = Math.max(0, Math.round(Number(data.craftCount) || 0));
  S.craftUsed = Array.isArray(data.craftUsed)
    ? data.craftUsed.map(function (v) { return Math.max(0, Math.round(Number(v) || 0)); }).slice(0, 8)
    : [];
  S.growth = Math.max(0, Math.round(Number(data.growth) || 0));
  /* **产能**（M2）：与 `growth` 同一组 —— 局内的模块代币。
     ⚠ 只写不读的话 `flow` 门会报"存档不幂等"：读档后它归零，再存一次就与上一份不同。 */
  S.capacity = Math.max(0, Math.round(Number(data.capacity) || 0));
  /* **核心素材**（M4）：与 `capacity` 同一组，**只写不读**会让 `flow` 门报"存档不幂等"。 */
  S.relic = Math.max(0, Math.round(Number(data.relic) || 0));
  S.sigil = Math.max(0, Math.round(Number(data.sigil) || 0));
  S.sigilSectors = Array.isArray(data.sigilSectors)
    ? data.sigilSectors.filter(function (x) { return typeof x === 'string'; })
    : [];
  /* **工坊（局内）**：从存档恢复等级与建造顺序。
     老档没有这两个字段 → 空工坊（工坊以前在账号档案里，那一份不再被读）。 */
  S.camp = {};
  if (data.camp && typeof data.camp === 'object') {
    for (var ck in data.camp) {
      if (!Object.prototype.hasOwnProperty.call(data.camp, ck)) continue;
      if (!Camp.BY_ID[ck]) continue;
      var clv = Math.floor(Number(data.camp[ck]));
      if (isFinite(clv) && clv > 0) S.camp[ck] = Math.min(clv, Camp.maxLevel(ck));
    }
  }
  S.campRow = Array.isArray(data.campRow)
    ? data.campRow.filter(function (x) { return typeof x === 'string' && S.camp[x] > 0; }).slice(0, 16)
    : [];
  /* 顺序里漏掉的设施补到行尾（与 `Profile.load` 的收口同一条纪律：
     顺序与状态不能脱节，否则"谁挨着谁"会凭空少一段）。 */
  for (var cid in S.camp) {
    if (Object.prototype.hasOwnProperty.call(S.camp, cid) && S.campRow.indexOf(cid) < 0) S.campRow.push(cid);
  }
  S.campEffects = null;   // 派生值：下一次 `campEffects()` 现算
  /* **图纸（局内）**：从存档恢复已解锁集合，并重折修正。
     老档给的是 id 数组（`Forge.toMap` 会归一）。 */
  S.forge = Forge.toMap(data.forge);
  S.fmods = Forge.modsFor(S.forge);
  /* **材料余额（局内全局货币）** —— 老档里没有这个字段，那时材料住在账号钱包
     （`Profile.wallet.material`）。缺字段时**回退去读一次账号**，把老档的余额
     当成本局的开局资金接上 —— 否则读一次老档就静默清零，玩家会以为东西没了。
     这条迁移是**单向**的（只在这里读、不再写回账号），M2/M3 会把账号那一侧删掉。 */
  S.material = data.material === undefined
    ? Math.max(0, Math.round(Profile.material()))
    : Math.max(0, Math.round(Number(data.material) || 0));
  S.runEvents = Array.isArray(data.runEvents)
    ? data.runEvents.filter(function (e) { return typeof e === 'string'; }).slice(0, 32) : [];
  p.pendingLevels = Math.max(0, Math.round(Number(data.pendingLevels) || 0));
  var restoredOffers = false;
  if (Array.isArray(data.offers) && data.offers.length) {
    var offers: Offer[] = [];
    for (var oi = 0; oi < data.offers.length; oi++) {
      var od = data.offers[oi];
      if (!od || typeof od !== 'object') continue;
      var def = od.t === 'item' ? Items.BY_ID[od.id] : Weapons.BY_ID[od.id];
      if (!def) continue;
      var oKind = (od.t === 'item' ? 'item' : 'weapon') as 'item' | 'weapon';
      var price = Math.max(1, Math.round(Number(od.price) || 1));
      var inst = Comp.spawn('offer', { type: oKind, def: def, price: price });
      inst.sold = od.sold === true;
      inst.tier = (isFinite(Number(od.tier)) && Number(od.tier) >= 1) ? Weapons.clampTier(od.tier) : 0;
      /* 货架上的词条：老存档没有 `a` → 现滚一套（"第一次被看见"），
         与武器/道具那两处同一条纪律（能修的修，缺的按现在的规则补）。 */
      inst.affixes = od.a
        ? Affixes.fromSave(od.a, oKind, def)
        : Affixes.roll(oKind, def,
          oKind === 'item' ? ((def as ItemDef).tier || 1) : (inst.tier || (def as WeaponDef).tier || 1), affixRnd());
      offers.push(inst);
    }
    if (offers.length) { S.offers = offers; restoredOffers = true; }
  }
  /* 营地**不在这里恢复了**：它在档案里（`Profile`），读档不该、也不能改它。
     唯一要做的是把"冻在会话里的回收比例"按档案重折一次 ——
     玩家可能在上一次读档之后回经营场景改建过工坊。 */
  S.materialEarned = Math.max(0, Math.round(Number(data.materialEarned) || 0));
  refreshCampFx();
  /* 老存档里的 `data.camp` / `data.campRow` / `data.campPoints` 会被**静默忽略**。
     这是有意的不迁移：那三个字段记的是"这一局临时盖的工坊"，
     而新模型下工坊是账号资产 —— 把旧值搬进档案会让玩家凭一局旧档
     白得一座工坊（越权），丢掉它只是"这一局没盖过"，代价小得多。 */

  Game.setState('playing', true);
  /* 随机流**放在最后**恢复：`restoreFloor` 里的 `enterFloor` 要重新长一遍地图，
     那是会消耗随机数的 —— 早恢复会被它吃掉，等于没恢复（第一版就踩了这个）。
     放在这里：旧存档走 openShop（它要 shopRoll）时也是从"存档那一刻的流"继续。 */
  if (S.rnd && S.rnd.setState && isFinite(Number(data.rndState))) {
    S.rnd.setState(Number(data.rndState));
  }
  /* 回到商店（存档就发生在这里）——而不是"回到场上对着已经清空的房间发呆"。
     货架已经在上面按存档还原过了：这时**不能再 openShop**（它会 shopRoll 重掷一次，
     把你看着的货换掉、刷新价跌回去）。老存档没有 offers 字段时仍旧走 openShop 兜底。 */
  if (roomSettled) {
    if (restoredOffers) {
      Game.setState('shop');
      Game.events.emit('shopOpen', { bonus: 0 });      // 不重复播报"波次奖励"
    } else {
      market.openShop(0);
    }
  }
  Game.events.emit('runResumed', Game.inspectRun(data));
  return sess;
};

/**
 * 从存档恢复"走到哪了"。
 * 地图本身由**种子重新长**（同一个种子必然同一张图），所以这里只把进度贴回去：
 * 层号 / 当前房 / 清过的房 / 发现过的房 / 破过的墙。
 * 坏档防线与武器/道具一致：**能修的修，不能修的拒** —— 认不出的房间 id、
 * 越界的层号、格式不对的墙键一律忽略，绝不因为一条坏字段丢掉整份存档。
 */
function restoreFloor(data) {
  var f = Math.floor(Number(data.floor));
  if (!isFinite(f) || f < 1) f = 1;
  if (f > Dungeon.FLOORS) f = Dungeon.FLOORS;
  enterFloor(f, { silent: true });

  var list = Array.isArray(data.roomsCleared) ? data.roomsCleared : [];
  for (var i = 0; i < list.length; i++) {
    var r = Dungeon.roomById(S.map, list[i]);
    if (r) { r.cleared = true; r.seen = true; }
  }
  var seen = Array.isArray(data.roomsSeen) ? data.roomsSeen : [];
  for (i = 0; i < seen.length; i++) {
    var r2 = Dungeon.roomById(S.map, seen[i]);
    if (r2) r2.seen = true;
  }
  /* 破过的墙：键的格式是 `层号|房A|房B`（`Dungeon.wallKey`）。
     **由种子推导，不查地图** —— 房间 id 是 `r<层>_<x>_<y>`，从键本身就能
     判断它属不属于这一局的层（`1..Dungeon.FLOORS`）。
     老实现拿 `Dungeon.roomById(S.map, …)` 去校，而 `restoreFloor` 只重建
     **当前这一层**的地图 —— 于是别的层的破墙记录全被当成"坏档"丢掉
     （实测：三层跑到第 2 层读档，walls 从 2 条变 1 条；现在键里带层号，
     这一条也一并修了）。 */
  var walls = Array.isArray(data.walls) ? data.walls : [];
  for (i = 0; i < walls.length; i++) {
    if (typeof walls[i] !== 'string') continue;
    var parts = walls[i].split('|');
    if (parts.length !== 3) continue;
    var wfl = Math.floor(Number(parts[0]) || 0);
    if (!(wfl >= 1 && wfl <= Dungeon.FLOORS)) continue;      // 不存在的层：丢
    if (!/^r\d+_-?\d+_-?\d+$/.test(parts[1]) || !/^r\d+_-?\d+_-?\d+$/.test(parts[2])) continue;
    S.walls[Dungeon.wallKey(wfl, parts[1], parts[2])] = true;
  }
  var cur = Dungeon.roomById(S.map, data.room);
  S.roomId = cur ? cur.id : S.map.start;
  seeRoom(S.roomId);
  S.secretsFound = Math.max(0, Math.round(Number(data.secretSeen) || 0));
  // 打倒过的 Boss：只收怪物表里真有的 id（坏档防线与武器/道具一致）
  S.coreEarned = Math.max(0, Math.round(Number(data.coreEarned) || 0));
  var down = Array.isArray(data.bossesDown) ? data.bossesDown : [];
  S.bossesDown = Object.create(null);
  for (i = 0; i < down.length; i++) {
    if (typeof down[i] === 'string' && Enemies.BY_ID[down[i]] && Enemies.BY_ID[down[i]].boss) {
      S.bossesDown[down[i]] = true;
    }
  }
  // 层间契约：只收契约表里真有的 id（坏档防线与武器/道具一致）
  S.boon = (typeof data.boon === 'string' && Boons.BY_ID[data.boon]) ? data.boon : '';
  S.boonFold = S.boon ? Boons.fold(S.boon) : null;
  S.pendingBoons = [];
  var pend = Array.isArray(data.pendingBoons) ? data.pendingBoons : [];
  for (i = 0; i < pend.length; i++) {
    if (typeof pend[i] === 'string' && Boons.BY_ID[pend[i]] && S.pendingBoons.indexOf(pend[i]) < 0) {
      S.pendingBoons.push(pend[i]);
    }
  }
  recalcWalls();
}

Game.step = step;

/* =========================================================
   换技能构筑（技能构筑屏打了卡之后**立刻生效**）
   ---------------------------------------------------------
   为什么不是「下一局才生效」：技能构筑是**局外**的东西，
   玩家点完那张卡会立刻回去打 —— 而他期待手感马上变。
   代价写在明面上：它绕过了 `importRun` 那条「存的是开局时那一份」的纪律。
   那是刻意的取舍 —— `importRun` 守的是**读档不回溯**，
   而这里是玩家在界面上主动改当前这一局（同一件事的两种意图）。 */
Game.refreshSkills = function (build) {
  if (!S) return false;
  applySkillBuild(S, S.charDef.id, build || []);
  S.skillBuildSource = (build || []).slice();
  return true;
};

Game.getSession = function () { return S; };

Game.chooseLevelCard = takeLevelCard;
Game.buyOffer = market.buyOffer;
Game.buyPack = market.buyPack;
Game.packPrice = market.packPrice;
Game.packOdds = function (kind) {
  return Items.packOddsText(Game.wave, S ? (S.stats.luck || 0) : 0, kind);
};
Game.sellWeapon = market.sellWeapon;
Game.reroll = market.reroll;
/**
 * **用徽记重掷一次货架**（M4）：`养成 → 战斗` 那条边的**消费点**。
 *
 * 为什么要单独一个出口而不是给 `Game.reroll` 加参数：徽记是**跨模块**的钱，
 * 它扣在**会话**上，而 `market.reroll` 只管货架。两件事分开写，
 * 扣钱与掷货架就各有一个明确的主人（失败时也才回滚得干净）。
 */
/**
 * **兑换一次**（M5，v3 §5.3 + §7-12）。
 *
 * 四条限制全在表里（`exchange.ts`），判定在 `Ledger.canExchange`（机制层）——
 * 这里只负责**改状态**：扣源代币、扣全局货币、给目标代币。
 *
 * ⚠ 任何一步扣不动就**整笔回滚**（与 `keepBuy` / `forgeNode` 同一条纪律）。
 */
Game.exchange = function (from, to, n) {
  if (!S) return { ok: false, reason: '还没开局', got: 0, cost: 0 };
  var amt = Math.max(0, Math.floor(Number(n) || 0));
  var chk = Ledger.canExchange(from, to, amt, tokenBalance(from), material());
  if (!chk.ok) return { ok: false, reason: chk.reason, got: 0, cost: 0 };
  if (!spendToken(from, amt)) {
    return { ok: false, reason: '不够换', got: 0, cost: 0 };
  }
  if (chk.cost > 0 && !spendMaterial(chk.cost)) {
    addToken(from, amt);   // 退回去，这一笔不算
    return { ok: false, reason: '全局货币不够当手续费（需要 ' + chk.cost + '）', got: 0, cost: 0 };
  }
  addToken(to, chk.got);
  return { ok: true, reason: '', got: chk.got, cost: chk.cost };
};
/** 界面铺一屏兑换选项（价钱 / 能不能换 / 换多少） */
/**
 * **下一步该去哪**（M5 的软引导，v3 §8-15 / §9-建议7）。
 *
 * 它把会话折成 `GuideState` 再问规则表 —— 规则表**不认识会话**
 * （与 `talents.ts` / `stronghold.ts` / `craft.ts` 同一形状）。
 *
 * 返回 `null` 表示**循环转起来了**（没有任何一条规则觉得你卡住了）——
 * 那不是"没有建议"，那是最好的状态，界面据此换个说法。
 */
Game.guide = function () {
  if (!S) return null;
  return Guide.next({
    material: material(),
    capacity: capacity(),
    growth: growth(),
    core: Profile.core(),
    relic: relic(),
    sigil: sigil(),
    /* 「关键建筑」= 花核心材料盖起来的那座（档案馆 L3）。
       ⚠ 判据沿用 `keepBuy` 里的那一句：**花了 `core` 就算**，不新开字段。 */
    keyBuilding: (Stronghold.BY_ID['archive'] ? keepLevel('archive') : 0),
    mythForged: isForged('myth')
  });
};

/* =========================================================
   **模块内时间感独立**（v3 §8-12，M5）
   ---------------------------------------------------------
   三个模块各有各的"这一波还能做几次"，而且**互不占用**：
     战斗：实时（一局就是一串房间，没有回合）
     经营：营地每波 2 点 · 每条产线每波 1 次
     养成：训练每波 3 次 · 与每位 NPC 每波 2 次

   ⚠ 这四处**分散在各自的模块里**（`camp.ts` / `craft.ts` / `training.ts` / `bonds.ts`）
     —— 那是对的（额度属于那个模块，不属于会话）。但玩家那侧就**看不见**它们，
     于是"时间感独立"变成一句只有开发者知道的话。

   这里只做**汇总**，不改任何额度：一次把三个模块的余量摆出来。
   ========================================================= */
/** 这一波三个模块各还剩多少"回合"（界面用它把时间感摆出来） */
Game.waveBudget = function () {
  if (!S) return null;
  /* 经营：这一波还有几条产线没动过。
     ⚠ 用**会话里的** `S.craftUsed` 与声明的产线数对减 ——
       不去读营地那笔（`campOwned`）：营地是**账号侧**的（M1 搬走了），
       它的每波额度不在会话里，拿它算会算出一个与局内无关的数。 */
  /* 产线数 = **真的建了几座工坊设施**（一座一条）。
     ⚠ 不去调 `Craft.linesOf`：它的声明收 `ForgeMods`，而实现读的是 `mods.lines` ——
       那是**既有**的一处类型与实现不符（还有别的调用点靠它），不该顺手在这一轮动。
       数"建了的"比"按公式算"也更不容易漂。 */
  var lines = Object.keys(campOwned() || {}).length;
  var usedLines = (S.craftUsed || []).length;
  /* 养成：训练还剩几次；与 NPC 相处还剩几次（取**聊得最多的那位**的余量） */
  var maxTalks = 0;
  var npcs = Bonds.NPCS();
  for (var i = 0; i < npcs.length; i++) maxTalks = Math.max(maxTalks, talksOf(npcs[i].id));
  return {
    /* 战斗：**实时**，没有"回合"这个数 —— 所以它是 `null` 而不是 0。
       ⚠ 写成 0 会让界面显示"战斗还剩 0 次"，而那是错的（它是实时的）。 */
    combat: null,
    craftLines: Math.max(0, lines - usedLines),
    trainLeft: Train.left(trainUsed()),
    talkLeft: Math.max(0, Bonds.TALK_PER_WAVE - maxTalks)
  };
};

Game.exchangeOpts = function () {
  return Exchange.LIST.map(function (e) {
    var amt = Math.min(e.cap > 0 ? e.cap : 1, tokenBalance(e.from));
    var chk = Ledger.canExchange(e.from, e.to, amt, tokenBalance(e.from), material());
    return {
      id: e.id, from: e.from, to: e.to, rate: e.rate, cap: e.cap, fee: e.cost,
      have: tokenBalance(e.from), note: e.note, ok: chk.ok, reason: chk.reason
    };
  });
};

Game.rerollWithSigil = function () {
  if (!S) return false;
  if (!spendSigil(1)) return false;
  var ok = market.reroll(true);
  if (!ok) addSigil(1);   // 没掷成就退回去，这一笔不算
  return ok;
};
Game.toggleLock = market.toggleLock;
Game.nextWave = nextWave;
/** 走门（玩家点小地图 / 按方向键都走它）。这是**唯一**换房间的公开入口 */
Game.enterRoom = function (dir) { return enterRoom(dir); };
/** 挑一条层间契约（打完 Boss 之后在商店里挑；不可撤销） */
Game.pickBoon = function (id) { return pickBoon(String(id || '')); };
/** 当前还没挑的契约候选（界面用；空数组 = 没有可挑的） */
Game.boonChoices = function () { return S ? S.pendingBoons.slice() : []; };
/** 已挑的那一条（界面用） */
Game.boonId = function () { return S ? S.boon : ''; };
/** 自动探索（= "下一波"按钮在没有指定门时的默认路径），也留给"自动前进"用 */
Game.autoExplore = function () { return autoExplore(); };
/* ---- 工坊（经营场景）----
   规则在 camp.ts，账在 profile.ts（**跨局**）。这里只做两件模拟层该做的事：
     ① 把"据点容量 / 天赋折扣 / 工匠全额返还"这三点开局修正带上（它们住在会话里）
     ② 成交之后刷新"冻在会话里的那一份派生值"（回收比例）—— 否则会出现
        "刚盖好的回收炉，这一局的回收价却还是旧的"
   制造的费用与档位**不缓存**（每次现读 `Profile.campFx()`），所以它们不需要这一步。 */
function campOpts() {
  var base = Camp.SLOTS + ((S && S.kmods && S.kmods.campSlots) || 0);
  return {
    slots: base,
    discount: Math.min(0.6, omod('campDiscount')),
    fullRefund: !!((S && S.kmods && S.kmods.refundFull) || 0)
  };
}
Game.campOpts = function () { return campOpts(); };
/** 买/升级一个据点设施。**钱在这里扣**（局内材料）+ 核心材料由 `Profile` 扣。
 *
 * ⚠ 界面以前直接调 `Profile.keepBuy(id)` —— 那条路读的是**账号钱包**。
 * 现在统一从这里走：局内余额进、`Profile` 只改状态。 */
/** 洗点（养成侧的动作，钱在**局内**扣）。
 *
 * ⚠ 它以前花的是 `Profile.material()`（**账号钱包**）—— 而 M1 之后账号钱包
 * 不再进材料了，那条路**永远付不起**。现在统一从这里走。 */
Game.respecTalents = function (charId) {
  if (!S) return { ok: false, reason: '还没开局', cost: 0, refund: 0 };
  /* 没点过就没有可洗的 —— 这条校验原来由 `Profile.respecTalents` 里的
     `pc.talents` 空判承担；搬到局内之后要**显式**判，否则白洗一次还涨 `respecs`。 */
  if (!talentsOf().length) return { ok: false, reason: '还没点过天赋', cost: 0, refund: 0 };
  /* 价钱用 `Talent.respecCost`（免费次数用完之后开始收费）—— 界面显示的也是它，
     两处共用同一个算法（`talents.mjs` 有一条断言盯着"显示价与实际扣费不许漂"）。 */
  var km = (S.kmods || {}) as { freeRespecs?: number };
  var cost = Talent.respecCost(S.respecs || 0, {
    free: Talent.FREE_RESPECS + (km.freeRespecs || 0),
    discount: 0
  });
  if (!spendMaterial(cost)) return { ok: false, reason: '材料不够（需要 ' + cost + '）', cost: cost, refund: 0 };
  /* **把成长点退回去**：余额语义下"洗点"就是"把投进去的拿回来"（再点要重新花）。
     ⚠ 这是余额语义与原来"累计预算"语义的分界点 —— 原来洗点只是清空 `talents`，
       因为预算不会减少；现在不退的话，那些成长点就凭空消失了。 */
  var refund = Talent.spentOn(talentsOf(), S.charDef.id);
  addGrowth(refund);
  S.talents = [];
  S.respecs = (S.respecs || 0) + 1;
  refoldTalents();
  return { ok: true, reason: '', cost: cost, refund: refund };
};
Game.keepBuy = function (id) {
  var key = String(id || '');
  if (!S) return { ok: false, reason: '还没开局', cost: 0, toLevel: 0 };
  /* 四条校验都在 `Stronghold.canBuy`（规则层），这里只负责改局内状态：
     ① 材料（**局内余额**）② 核心材料（钱在哪本账见 M4）③ **产能**（M2：经营自己的钱）
     ④ 到没到满级 / 前置。 */
  var chk = Stronghold.canBuy(S.keep, key, material(), Profile.core(), capacity());
  if (!chk.ok) return chk;
  if (!spendMaterial(chk.cost)) {
    return { ok: false, reason: '材料不够（需要 ' + chk.cost + '）', cost: chk.cost, toLevel: 0 };
  }
  /* 核心材料**仍然从账号扣** —— 它还没搬进局内（M4 的事，它是战斗→经营的核心素材）。
     ⚠ 放在改状态**之前**：`canBuy` 已经验过余额，真扣不动就整笔不动（与 `craft` 同一条纪律）。 */
  /* **产能也在这里扣**（M2）：它与材料一样是"局内的钱"，所以走同一条纪律 ——
     任何一步扣不动就**整笔回滚**。 */
  if ((chk.capacity || 0) > 0 && !spendCapacity(chk.capacity)) {
    addMaterial(chk.cost);   // 材料退回去，这一笔不算
    return { ok: false, reason: '产能不够（需要 ' + chk.capacity + '）', cost: chk.cost, toLevel: 0 };
  }
  if (chk.core > 0 && !Profile.spendCore(chk.core)) {
    addMaterial(chk.cost);   // 材料退回去，这一笔不算
    if (chk.capacity > 0) addCapacity(chk.capacity);   // 产能也退回去
    return { ok: false, reason: '核心材料不够（需要 ' + chk.core + '）', cost: chk.cost, core: chk.core, toLevel: 0 };
  }
  S.keep[key] = chk.toLevel;
  /* =========================================================
     **核心素材的第一处产出：经营的关键建筑**（M4，2026-09）
     ---------------------------------------------------------
     判据是"这一级花了 `core`" —— `core` 是**战斗 → 经营**那一环的战利品，
     而花掉它的那座建筑就是"经营把它变成自己的东西"的地方。
     它产出的 `relic` 才是**经营 → 养成**那条边的通货。

     ⚠ 这个判据不新开字段：`core` 已经在等级声明里了，多写一个"是不是关键建筑"
       的布尔值等于把同一件事记两遍 —— 而两份一定会漂。
     ========================================================= */
  if (chk.core > 0) addRelic(1);
  refreshKeepFx();
  /* 顺手让**账号**记一份（离线产出与剧情 flag 要读 —— 它们是局外机制，
     读不到局内的 `S.keep`）。这不是"把状态写回账号"：写的是**快照**，
     真相仍在 `S.keep`。见 `Profile.noteKeep` 的说明。 */
  Profile.noteKeep(S.keep);
  return { ok: true, reason: '', cost: chk.cost, core: chk.core || 0, toLevel: chk.toLevel };
};
/** 这一局建了哪些据点设施（**局内**） */
Game.keepOwned = function () { return keepOwned(); };
/** 据点折叠出来的修正（界面读它，不自己算） */
Game.keepMods = function () { return keepMods(); };
/** 某个据点设施的等级（0 = 没建） */
Game.keepLevel = function (id) { return keepLevel(id); };
/* 图纸（局内）—— 见会话里 `forge` 那段说明：只搬了"集合住在哪"。 */
/** 这一局已解锁的图纸（id 数组） */
Game.forgeOwned = function () { return forgeOwned(); };
/** 某张图纸解锁了吗 */
Game.isForged = function (id) { return isForged(id); };
/** 图纸折叠出来的修正（界面读它，不自己算） */
Game.forgeMods = function () { return forgeMods(); };
/** 这张图纸现在能不能解锁（规则在 `Forge.canUnlock`，纯函数） */
Game.canForge = function (id) {
  if (!S) return Forge.canUnlock({}, String(id || ''), 0, 0);
  return Forge.canUnlock(S.forge, String(id || ''), growth(), Profile.core(), relic());
};
/** 解锁一张图纸。
 *
 * ⚠ **钱暂时仍从账号扣**：`合金` 与 `核心材料` 都还没有局内的家。
 *   `核心材料` 是 v3 §5.2 的核心素材（战斗 → 经营），**归 M4**；
 *   `合金` 不在 v3 的货币模型里（v3 只有 3 个模块代币 + 1 个全局货币 + 3 个核心素材），
 *   它的归属是**设计决定**，等用户拍板。所以本轮只搬"解锁集合住在哪"。 */
Game.forgeNode = function (id) {
  var key = String(id || '');
  if (!S) return { ok: false, reason: '还没开局', cost: 0, core: 0 };
  var chk = Forge.canUnlock(S.forge, key, growth(), Profile.core(), relic());
  if (!chk.ok) return chk;
  if (chk.cost > 0 && !spendGrowth(chk.cost)) {
    return { ok: false, reason: '合金不够（需要 ' + chk.cost + '）', cost: chk.cost, core: chk.core || 0 };
  }
  /* **遗物在这里扣**（M4）：它是**经营 → 养成**那条边的钱 ——
     `core` 是战斗 → 经营那一环，图纸直接花它等于**跳过经营**。 */
  if ((chk.relic || 0) > 0 && !spendRelic(chk.relic)) {
    if (chk.cost > 0) addGrowth(chk.cost);   // 退回去，这一笔不算
    return { ok: false, reason: '遗物不够（需要 ' + chk.relic + '）', cost: chk.cost, relic: chk.relic };
  }
  if (chk.core > 0 && !Profile.spendCore(chk.core)) {
    if (chk.cost > 0) addGrowth(chk.cost);   // 退回去，这一笔不算
    if (chk.relic > 0) addRelic(chk.relic);  // 遗物也退回去
    return { ok: false, reason: '核心材料不够（需要 ' + chk.core + '）', cost: chk.cost, core: chk.core };
  }
  S.forge[key] = true;
  S.fmods = Forge.modsFor(S.forge);
  refreshCampFx();     // 回收比例等派生值跟着图纸走
  return { ok: true, reason: '', cost: chk.cost, core: chk.core || 0 };
};
/** 这一局往据点投了多少材料 */
Game.keepInvested = function () { return keepInvested(); };
/* 工坊（经营模块的制造设施）—— 与据点同一套路：都在**会话**里。 */
/** 这一局建的工坊设施（id → 等级） */
Game.campOwned = function () { return campOwned(); };
/** 建造顺序（只保留"真的建了"的，且每项一次） */
Game.campRow = function () { return campRow(); };
/** 工坊效果的折叠结果（界面读它，不自己算） */
Game.campFx = function () { return campEffects(); };
/** 某个工坊设施的等级（0 = 没建） */
Game.campLevel = function (id) { return campLevel(id); };

Game.campBuy = function (id) {
  var key = String(id || '');
  if (!S) return false;
  /* 规则在 `Camp.canBuy`（纯函数，收 state）；钱与状态都在**这一局**。 */
  var chk = Camp.canBuy(S.camp, key, material(), campOpts());
  if (!chk.ok) return false;
  if (!spendMaterial(chk.cost)) return false;
  var isNew = Camp.levelOf(S.camp, key) === 0;
  S.camp[key] = chk.toLevel;
  /* 新建设施排到行尾（升级**不挪**位置）——「谁挨着谁」由建造顺序决定。 */
  if (isNew && S.campRow.indexOf(key) < 0) S.campRow.push(key);
  refreshCampFx();
  return true;
};
Game.campSell = function (id) {
  var key = String(id || '');
  if (!S) return false;
  if (!Camp.levelOf(S.camp, key)) return false;
  var back = Camp.refundOf(S.camp, key, campOpts());
  delete S.camp[key];
  var at = S.campRow.indexOf(key);
  if (at >= 0) S.campRow.splice(at, 1);
  if (back > 0) addMaterial(back);
  refreshCampFx();
  return true;
};
/** 界面铺一屏工坊（费用 / 能不能盖 / 造不造得起）—— 不含规则 */
Game.campFacilities = function () {
  var owned = campOwned();
  var opts = campOpts();
  var out = [];
  for (var i = 0; i < Camp.LIST.length; i++) {
    var d = Camp.LIST[i];
    var chk = Camp.canBuy(owned, d.id, material(), opts);
    out.push({
      id: d.id, name: d.name, note: d.note, level: Camp.levelOf(owned, d.id),
      maxLevel: Camp.maxLevel(d.id), cost: chk.cost, toLevel: chk.toLevel,
      ok: chk.ok, reason: chk.reason,
      refund: Camp.refundOf(owned, d.id, opts)
    });
  }
  return out;
};
/** 从商店进工坊（可选去处；回商店是 camp → shop） */
Game.openCamp = function () {
  if (Game.state !== 'shop' && Game.state !== 'camp') return false;
  return Game.setState('camp');
};
Game.addWeapon = addWeapon;
Game.addWeaponOrCombine = addWeaponOrCombine;
/** 词条的随机流（**只给演示舞台与测试**：正常路径由 `addWeapon` / `addItem` 自己取）。
 *  公开它是因为 `demo.ts` 要按同一条规则给手工摆的道具补词条 ——
 *  少一个出口，演示舞台上就会出现"唯一没有词条的那种道具"。 */
Game.affixRnd = affixRnd;
/** 给玩家一件道具（**唯一的入口**：词条在这里定下来）。
 *  公开它是因为"造一件带词条的道具"在测试 / 实验台 / 将来的奖励发放里都要用到 ——
 *  少一个入口就少一处"忘了滚词条"的机会。 */
Game.addItem = addItem;
Game.maxWeapons = maxWeapons;
/* 制造（经营那一侧的主行动）：规则在 craft.ts，费用在 camp.ts / forge.ts，
   这里只做状态变更与校验。 */
Game.craft = function (line, id) { return craft(Math.floor(Number(line) || 0), String(id || '')); };
Game.craftOptions = function () { return craftOptions(); };
Game.craftLines = craftLineCount;
Game.craftFreeLines = craftFreeLines;
/** 回收价（界面显示与市场扣费共用一个算法：含品级与这一局的回收比例） */
Game.salvageOf = function (w) { return salvageOf(w); };
/** 这一局累积的合金（结算展示与界面提示读它） */
Game.growthEarned = function () { return (S && S.growth) || 0; };
/* =========================================================
   **材料（全局货币）= 这一局的钱** —— 对外的三个出口（M1，2026-09）
   ---------------------------------------------------------
   ⚠ 这三个出口是给**界面与经营侧**用的。它们读的都是 `S.material`，
   **不是账号钱包** —— 与 v3 §5.1（全局货币三模块通用）+ §二（三个模块
   全在局内）一致：材料是局内的，不跨局。

   为什么必须从这里过而不是让界面直接 `Profile.material()`：
   门 `drift` 的判据 I（M1 迁移预算）统计的就是"还有多少处直接读账号"，
   这个出口每被用一次、那个数就少一处 —— 于是**迁移进度是可量的**。
   ========================================================= */
/* =========================================================
   **训练 = 养成模块的局内行动**（M3，2026-09）
   ---------------------------------------------------------
   花 `material`（全局货币 = 行动成本）换 `growth`（养成代币）。
   规则全在 `training.ts`（纯声明 + 纯函数），这里只改会话状态。
   ========================================================= */
/** 这一波已经训练了几次（**模块内的时间感**：不是冷却，是回合数） */
function trainUsed() { return (S && S.trainUsed) || 0; }
/** **养成代币余额**（局内）。⚠ 未开局时是 0 —— 界面据此显示"还没开始"。 */
function growth() { return (S && S.growth) || 0; }
function addGrowth(n) {
  if (!S) return 0;
  var add = Math.max(0, Math.floor(Number(n) || 0));
  S.growth = growth() + add;
  return S.growth;
}
/** 花养成代币；不够就**不扣**并返回 false（与 `spendMaterial` 同一纪律）。 */
function spendGrowth(n) {
  var cost = Math.max(0, Math.floor(Number(n) || 0));
  if (cost <= 0) return true;
  if (!S || growth() < cost) return false;
  S.growth = growth() - cost;
  return true;
}
/** 这一局点过的天赋节点 */
function talentsOf() { return (S && S.talents) || []; }
/* 核心素材的读写（**局内**）。形状与模块代币一样 —— 只是它们跨模块。 */
function relic() { return (S && S.relic) || 0; }
function addRelic(n) {
  if (!S) return 0;
  S.relic = relic() + Math.max(0, Math.floor(Number(n) || 0));
  return S.relic;
}
function spendRelic(n) {
  var cost = Math.max(0, Math.floor(Number(n) || 0));
  if (cost <= 0) return true;
  if (!S || relic() < cost) return false;
  S.relic = relic() - cost;
  return true;
}
/* 兑换要按 id 读写**各模块的代币** —— 这是唯一一处"按名字取本模块的钱"。
   ⚠ 它只认三个模块代币（`scrap` / `capacity` / `growth`），
     不认核心素材也不认全局货币：那两样各有各的通道（`link.ts` / `material`）。 */
function tokenBalance(id) {
  if (id === 'scrap') return (S && S.player && S.player.scrap) || 0;
  if (id === 'capacity') return capacity();
  if (id === 'growth') return growth();
  return 0;
}
function addToken(id, n) {
  var add = Math.max(0, Math.floor(Number(n) || 0));
  if (!S || !add) return 0;
  if (id === 'scrap') { S.player.scrap = ((S.player.scrap) || 0) + add; return S.player.scrap; }
  if (id === 'capacity') return addCapacity(add);
  if (id === 'growth') return addGrowth(add);
  return 0;
}
function spendToken(id, n) {
  var cost = Math.max(0, Math.floor(Number(n) || 0));
  if (cost <= 0) return true;
  if (!S || tokenBalance(id) < cost) return false;
  if (id === 'scrap') { S.player.scrap -= cost; return true; }
  if (id === 'capacity') return spendCapacity(cost);
  if (id === 'growth') return spendGrowth(cost);
  return false;
}

function sigil() { return (S && S.sigil) || 0; }
function addSigil(n) {
  if (!S) return 0;
  S.sigil = sigil() + Math.max(0, Math.floor(Number(n) || 0));
  return S.sigil;
}
function spendSigil(n) {
  var cost = Math.max(0, Math.floor(Number(n) || 0));
  if (cost <= 0) return true;
  if (!S || sigil() < cost) return false;
  S.sigil = sigil() - cost;
  return true;
}
/** **经营代币余额**（局内）。未开局时 0。 */
function capacity() { return (S && S.capacity) || 0; }
function addCapacity(n) {
  if (!S) return 0;
  var add = Math.max(0, Math.floor(Number(n) || 0));
  S.capacity = capacity() + add;
  return S.capacity;
}
/** 花产能；不够就**不扣**并返回 false（与 `spendMaterial` 同一纪律）。 */
function spendCapacity(n) {
  var cost = Math.max(0, Math.floor(Number(n) || 0));
  if (cost <= 0) return true;
  if (!S || capacity() < cost) return false;
  S.capacity = capacity() - cost;
  return true;
}
/** 与某位 NPC 的信任 */
function bondTrust(npcId) { return (S && S.bonds && S.bonds[String(npcId || '')]) || 0; }
/** 这一波与某位 NPC 相处了几次 */
function talksOf(npcId) { return (S && S.talks && S.talks[String(npcId || '')]) || 0; }

/**
 * **把天赋的开局效果按差补进当前局**（M3）。
 *
 * 为什么是"按差补"而不是"重折一遍"：开局那一次（`applyOpening`）已经把属性并进了
 * `p.base`。整个重折会把属性加两次 —— 与 R43 那次 `growth` 翻倍同一类错。
 *
 * `S.talentFx` 记住上一次折过的值，所以 `new - old` 就是这一批新点的天赋贡献。
 * 撤销（`undoTalent`）走同一条路 —— 差是负的，减回去就行。
 */
/** 把具名的修正对象当成"名字 → 数"的字典来遍历（`refoldTalents` 要按名字取差） */
function asRecord(o: unknown): Record<string, number> {
  return (o || {}) as Record<string, number>;
}

function refoldTalents() {
  if (!S) return;
  var next = Talent.openingFor(S.charDef.id, talentsOf());
  var prev = S.talentFx || { stats: {}, econ: {} };
  var k;
  /* 属性：按差并进 p.base */
  for (k in next.stats) {
    if (!Object.prototype.hasOwnProperty.call(next.stats, k)) continue;
    var delta = (Number(next.stats[k]) || 0) - (Number(prev.stats && prev.stats[k]) || 0);
    if (delta) S.player.base[k] = (Number(S.player.base[k]) || 0) + delta;
  }
  /* 经济：按差并进 omods。
     ⚠ 用 `asRecord` 转一下视图 —— `OpeningEcon` 的键是**具名的**，
     而这里要按名字遍历（`k` 是字符串），直接索引会被 TS 拦住。 */
  var cur = asRecord(S.omods);
  var ne = asRecord(next.econ);
  var pe = asRecord(prev.econ);
  for (k in ne) {
    if (!Object.prototype.hasOwnProperty.call(ne, k)) continue;
    var de = ne[k] - (pe[k] || 0);
    if (de) cur[k] = (cur[k] || 0) + de;
  }
  /* 属性变了，当前 HP 要跟着夹一次（上限变大时不该白扣血） */
  if (S.player && S.player.base && S.player.base.maxHp) S.player.hp = Math.min(S.player.hp, S.player.base.maxHp);
  S.talentFx = { stats: next.stats, econ: asRecord(next.econ) };
}
/* ---- 养成代币与天赋：**局内**（M3，2026-09）----
   ⚠ v3 §5.1：模块代币"产出在本模块、消费在本模块"；§二：三个模块全在局内。
   所以余额与已点节点都住在 `Session`，`data.growth` 只剩**老档迁移**的用途。 */
/* ---- 产能（`capacity`）：**局内**（M2，2026-09）----
   v3 §8-2：产出 = 每波据点运转；消费 = 建造子模块盖设施。 */
/**
 * **核心素材余额**（局内，M4）。
 *
 * 它们不在任何账本里（见 `link.ts`）—— 模块代币"产出与消费都在本模块"，
 * 而核心素材的整个存在意义就是**跨模块**。
 */
Game.relic = function () { return relic(); };
Game.sigil = function () { return sigil(); };
/** **经营代币余额**（局内） */
Game.capacity = function () { return capacity(); };
/** 这一波的**产能产出**是多少（界面拿它显示"每波 +N"） */
Game.capacityPerWave = function () { return S ? Craft.capacityYield(keepOwned(), (S.kmods && S.kmods.capacityBonus) || 0) : 0; };

/** 养成代币余额（**局内**） */
Game.growth = function () { return growth(); };
/** 这一局点过的天赋节点 */
Game.talentsOf = function () { return talentsOf().slice(); };
/** 天赋已经投进去多少成长点（**展示用**；判定走余额，见 `Talent.canTake`） */
Game.talentSpent = function () { return Talent.spentOn(talentsOf(), S ? S.charDef.id : ''); };
/** 这一局洗过几次点 */
Game.respecsUsed = function () { return (S && S.respecs) || 0; };
/** **累计获得过多少成长点**（= 现在还剩的 + 已经投进天赋的）。
 *  它是一个**派生值**，不是独立的一个数 —— 余额语义下没有"累计预算"这个字段了，
 *  而界面要显示"累计"。派生比多存一个字段安全：多存的那个一定会漂。 */
Game.talentEarned = function () { return growth() + Talent.spentOn(talentsOf(), S ? S.charDef.id : ''); };
/** 还能花多少成长点（就是余额本身 —— 余额语义下"可用"与"剩余"是同一件事） */
Game.talentFree = function () { return growth(); };
/** 点一个天赋：**花成长点**（v3 §8-3："把 talents 的成长接到 growth 上"）。
 *  失败一律不动任何状态。 */
Game.takeTalent = function (nodeId) {
  if (!S) return { ok: false, reason: '还没开局', cost: 0 };
  var key = String(nodeId || '');
  var chk = Talent.canTake(S.charDef.id, key, talentsOf(), growth());
  if (!chk.ok) return chk;
  if (!spendGrowth(chk.cost)) return { ok: false, reason: '成长点不够', cost: chk.cost };
  S.talents = talentsOf().concat([key]);
  /* =========================================================
     **核心素材的第三处产出：养成走通一条能力线**（M4，2026-09）
     ---------------------------------------------------------
     v3 §5.2 的第三条边是 **养成 → 战斗**，而它的起点就是这里：
     一个天赋扇区**点满**，就算"走通了一条能力线"。

     ⚠ 扇区一旦点满就**一直**是满的 —— 所以必须记"发过没有"，
       否则之后每点一个别的节点都会再发一次徽记（一台安静的印钞机）。
     ========================================================= */
  for (var sigKey in Talent.SECTORS) {
    if (!Object.prototype.hasOwnProperty.call(Talent.SECTORS, sigKey)) continue;
    if (S.sigilSectors.indexOf(sigKey) >= 0) continue;
    if (Talent.sectorComplete(talentsOf(), sigKey)) {
      S.sigilSectors = S.sigilSectors.concat([sigKey]);
      addSigil(1);
    }
  }
  /* ⚠ 天赋折出来的是 **`omods`（开局经济修正）**，不是 `fmods`（那是图纸的）。
     而且它连带属性/武器/道具一起折 —— 那正是 `openingOf()` 干的事。
     这里直接重折一次：天赋是**局内**点的，开局条件必须跟着变（v3 §4-规则2）。 */
  /* ⚠ 天赋折出来的是 **`omods`（开局经济修正）** 与**起始属性**两样。
     而开局那一次已经把属性并进 `p.base` 了 —— 所以这里只能**按差补**，
     不能整个重折（那会把属性加两次，与 R43 那次"翻倍"同一类错）。
     `S.talentFx` 记住上一次折过的值，正好用来取差。 */
refoldTalents();
  return { ok: true, reason: '', cost: chk.cost };
};
/** 撤销最后点的一个（**免费**，并把成长点退回去）：误点不该被罚 */
Game.undoTalent = function () {
  if (!S || !talentsOf().length) return false;
  var list = talentsOf().slice();
  var last = list.pop();
  var node = Talent.BY_ID[last];
  if (node) addGrowth(Talent.costFor(node, S.charDef.id));
  S.talents = list;
  /* ⚠ 天赋折出来的是 **`omods`（开局经济修正）**，不是 `fmods`（那是图纸的）。
     而且它连带属性/武器/道具一起折 —— 那正是 `openingOf()` 干的事。
     这里直接重折一次：天赋是**局内**点的，开局条件必须跟着变（v3 §4-规则2）。 */
  /* ⚠ 天赋折出来的是 **`omods`（开局经济修正）** 与**起始属性**两样。
     而开局那一次已经把属性并进 `p.base` 了 —— 所以这里只能**按差补**，
     不能整个重折（那会把属性加两次，与 R43 那次"翻倍"同一类错）。
     `S.talentFx` 记住上一次折过的值，正好用来取差。 */
refoldTalents();
  return true;
};

/* ---- NPC 关系：**局内**（M3 第三块）----
   v3 §8-3 的「共享关系状态」：叙事线与养成线读**同一份** `S.bonds`。
   ⚠ §6.5 的硬约束：NPC 互动**不能直接花战斗/经营模块代币** ——
     所以 `Bonds` 里没有任何代价字段：相处**不花钱**，它只**产**养成那一侧的东西。 */
/** 列出所有 NPC 的关系（界面铺一屏） */
Game.bondsAll = function () {
  return Bonds.NPCS().map(function (n) { return Bonds.view(n.id, bondTrust(n.id), talksOf(n.id)); });
};
/**
 * **相处一次**（养成线的动作）。
 *
 * 信任 +`Bonds.TRUST_PER_TALK`；**跨过一个关系阶段就产养成代币** ——
 * 那正是 v3 §8-3 说的产出动作之一「与 NPC 相处到某个关系阶段」。
 *
 * ⚠ 它**不花钱**（§6.5）：花战斗/经营的钱是明令禁止的，而花养成的钱会让这条线
 *   变成「用成长点买成长点」的空转。相处付的是**时间**（每波限次）。
 */
Game.talkTo = function (npcId) {
  if (!S) return { ok: false, reason: '还没开局', gain: 0, stage: '' };
  var key = String(npcId || '');
  var known = Bonds.NPCS().some(function (n) { return n.id === key; });
  if (!known) return { ok: false, reason: '没有这个人', gain: 0, stage: '' };
  if (talksOf(key) >= Bonds.TALK_PER_WAVE) {
    return { ok: false, reason: '这一波已经跟他聊够了（' + Bonds.TALK_PER_WAVE + ' 次）', gain: 0, stage: '' };
  }
  var before = bondTrust(key);
  var after = before + Bonds.TRUST_PER_TALK;
  S.bonds[key] = after;
  S.talks[key] = talksOf(key) + 1;
  /* **跨阶段才产成长点**：只有真的「到达」了某个关系阶段才算数 ——
     每次都给的就不叫阶段了。 */
  var gain = 0;
  var i0 = Bonds.stageIndex(before);
  var i1 = Bonds.stageIndex(after);
  for (var i = i0 + 1; i <= i1; i++) gain += Bonds.STAGES[i].growth;
  if (gain > 0) addGrowth(gain);
  return { ok: true, reason: '', gain: gain, stage: Bonds.stageOf(after).id };
};

/** 界面铺一屏训练科目 */
Game.trainingOptions = function () {
  if (!S) return [];
  return Train.options(trainUsed(), material());
};
/** 这一波还能训练几次 */
Game.trainingLeft = function () { return Train.left(trainUsed()); };
/** 训练一次：花材料、得养成代币。**失败一律不动任何状态**（与制造同一条纪律）。 */
Game.train = function (id) {
  if (!S) return { ok: false, reason: '还没开局', cost: 0, gain: 0 };
  var key = String(id || '');
  var d = Train.BY_ID[key];
  if (!d) return { ok: false, reason: '没有这个训练科目', cost: 0, gain: 0 };
  if (Train.left(trainUsed()) <= 0) {
    return { ok: false, reason: '这一波已经训练满了（' + Train.PER_WAVE + ' 次）', cost: 0, gain: 0 };
  }
  var cost = Train.costOf(key, trainUsed());
  if (!spendMaterial(cost)) return { ok: false, reason: '材料不够（需要 ' + cost + '）', cost: cost, gain: 0 };
  S.trainUsed = trainUsed() + 1;
  /* ⚠ `growth` 目前仍是**账号余额**（`Profile.addGrowth`）—— 它是养成代币，
     按 v3 §5.1 该住在局内，而它的**消费者**（天赋树）还是账号级的。
     两件事（`growth` 搬进会话 + 天赋树搬进会话）与 M1 最后一块一起做。 */
  /* **天赋的产出倍率指到这里**（原 `孢子` 那条曲线）。
     ⚠ 产出点搬进养成端之后（M3），如果它还乘**结算**，那两条天赋节点就
     完全没有作用了 —— "声明了却没人读"的一种。指到训练上才是它该在的地方。
     上限与原来同一套（`Profile.SPORE_MUL_CAP`），不新开一份。 */
  var mul = 1 + Math.min(Profile.SPORE_MUL_CAP, Math.max(0, (S.omods && S.omods.sporeMul) || 0));
  var gain = Math.round(d.gain * mul);
  /* ⚠ **据点不再往这里加成了**（M2 第二刀）。
     上一轮曾把「档案馆」的 `bonusPoints` 指到训练产出上 —— 那仍然是
     **建造机制承载养成的成长**，而 v3 §三-2 明令禁止这一条。
     它现在指到**产能产出**上（`Craft.capacityYield` 的 `bonus`），
     走的是同一模块内两个子模块共享代币那条**合法**的路。 */
  /* **产在局内余额上**（M3 第二块）：`growth` 是模块代币，按 v3 §5.1
     产出与消费都在本模块内。 */
  addGrowth(gain);
  return { ok: true, reason: '', cost: cost, gain: gain };
};

/** 现在的材料余额（**局内**） */
Game.material = function () { return material(); };
/** 进材料（产出走 `gainMaterial`；这里是给界面/经营侧的访问器） */
Game.addMaterial = function (n) { return addMaterial(n); };
/** 花材料；不够就**不扣**并返回 false */
Game.spendMaterial = function (n) { return spendMaterial(n); };
Game.forgeMods = function () { return (S && S.fmods) || Forge.emptyMods(); };
/* 合成：状态校验在 market.ts（和买 / 卖 / 刷新同一道门），模拟实现在上面 */
Game.combine = market.combine;
Game.combinePlans = combinePlans;
Game.combinePlan = combinePlan;
Game.recalcStats = recalcStats;
Game.summary = function () { return buildSummary(true); };
Game.healPlayer = healPlayer;
Game.damageEnemy = damageEnemy;

/** 暂停：能从进行中的界面进入；来处由 setState 记录。
    大厅 / 枢纽也在名单里 —— 屋里按 Esc 该看到暂停菜单（菜单里有"回大厅"），
    而不是"按了没反应"。 */
Game.pause = function () {
  if (['playing', 'levelup', 'shop', 'station', 'hub'].indexOf(Game.state) < 0) return false;
  return Game.setState('paused');
};
Game.resume = function () {
  if (Game.state !== 'paused') return false;
  var back = Game._pauseFrom;
  // 来处必须仍然可达，否则退回 playing
  if (!back || !Game.TRANSITIONS.paused || Game.TRANSITIONS.paused.indexOf(back) < 0) back = 'playing';
  return Game.setState(back);
};

/** 无头测试用的自动操作（保证代码路径被覆盖） */
Game.autoInput = function (t) {
  if (!S) return { x: 0, y: 0 };
  var p = S.player;
  var best = null, bd = Infinity;
  for (var i = 0; i < S.enemies.length; i++) {
    var e = S.enemies[i];
    var d = U.dist2(p.x, p.y, e.x, e.y);
    if (d < bd) { bd = d; best = e; }
  }
  if (!best) return { x: Math.cos(t * 0.7), y: Math.sin(t * 0.7) };
  var a = Math.atan2(p.y - best.y, p.x - best.x) + Math.sin(t * 0.6) * 0.4;
  return { x: Math.cos(a), y: Math.sin(a) };
};

Game._internals = {
  spawnEnemy: function (id, x, y, opt) { return spawnEnemy(Enemies.BY_ID[id], x, y, opt); },
  startWave: startWave,
  /** 直接翻到某一层（测试/实验台用：层的深度回报与主题倍率都在它里面算） */
  enterFloor: enterFloor,
  endWave: endWave,
  openShop: market.openShop,
  /* 武器数值的两个出口（**只给实验台与测试用**）：品级台阶是不是真的接在伤害公式上，
     要能直接量 —— 否则只能靠"打桩打了一段时间差不多更多"去猜。 */
  weaponDamage: weaponDamage,
  /* "白给的回血"那一道门（**只给测试**）：道具代价 `noHeal` 要取消的是它，
     而"它到底关没关掉"必须能被直接量出来 —— 否则只能靠"打一段时间看血条"去猜。 */
  settleHeal: settleHeal,
  /* **等级推进的唯一入口**（只给测试与实验台）。
     `checkLevelUp` 平时只在"吃到废料"时跑（经验跟着废料走），
     所以"玩家的成长曲线长什么样"没法在无头环境里直接量 ——
     没有掉落物可吃。数值曲线体检要的正是这条曲线，于是把它开出来。 */
  checkLevelUp: checkLevelUp,
  weaponCd: weaponCd,
  weaponReach: weaponReach,
  rollLevelCards: rollLevelCards,
  addStain: addStain,
  hitWalls: hitWalls,
  breakWall: breakWall,
  /** 直接挪到某一间房（测试用：房间制下"哪一间"决定了刷什么怪、有没有门）
      走的仍是**同一套"看见"逻辑**（`seeRoom`）——迷雾不该因为"怎么来的"而不同。 */
  warpTo: function (roomId) {
    var r = Dungeon.roomById(S.map, roomId);
    if (!r) return false;
    S.roomId = r.id;
    seeRoom(r.id);
    recalcWalls();
    return true;
  },
  /** 直接设一条契约（**只给实验台与测试用**：正常路径是打完 Boss 抽签再挑） */
  setBoon: function (id) {
    if (!S || !Boons.BY_ID[id]) return false;
    S.boon = id;
    S.boonFold = Boons.fold(id);
    S.pendingBoons = [];
    recalcStats();
    return true;
  },
  /** 钉住这一间不自动结束（房间制下"清空即过"会让短测试意外推进状态） */
  holdRoom: function (sess) { if (sess) sess.roomHold = true; },
  /* **进屋 / 走到哪**（只给测试与实验台）：界面走的是 setState 与按键，
     但"大厅真的能走"这件事要在无头环境里直接驱动 —— 见 test/station.mjs。 */
  enterHall: enterHall
};

/* 注册到扩展点总账：状态名与场景表必须一一对应（场景表在 scene.ts 里反向引用这里） */
Registry.family('state', {
  note: '状态机状态（唯一入口 setState）', owner: 'game.ts',
  values: function () { return Game.STATES.slice(); }
});
export { Game };
