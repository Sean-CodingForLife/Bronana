/* =========================================================
   scene.ts — 场景表：一个阶段"是什么"只在这里声明一次

   改造前，"当前在哪个阶段"这件事被硬编码在 4 个模块的 9 处比较里：
     · ui.ts   SCREEN_FOR（状态 → 覆盖层，8 条）
     · ui.ts   UI.show 里的 inGame = playing|pause（HUD 可见）
     · ui.ts   UI.show 里的 inRun  = playing|pause|levelup|shop（武器条）
     · ui.ts   UI.refresh 里"只有 shop/levelup 要重画内容"
     · main.ts state !== 'playing' 才推进模拟
     · main.ts state !== 'title' && !== 'chars' 才画世界（否则画待机背景）
     · main.ts state === 'playing' || 'levelup' 才刷 HUD
     · main.ts 5 处按状态分支的按键处理
     · game.ts TRANSITIONS（合法转换）+ step() 的早退
   于是"加一个场景"要同时改 4 个文件，而且漏掉任何一处都不会报错 ——
   只会在某个界面上表现为"HUD 不刷了""按键没反应"这类难查的现象。

   现在每个阶段在这张表里一行：覆盖层 / 是否推进模拟 / 画世界还是待机背景 /
   HUD / 武器条 / 按键组。**状态机（Game.TRANSITIONS）仍然是唯一的状态权威**，
   本表只描述"处在这个状态时各项表现应该是什么"。

   两个刻意的取舍：
     · 表里不放函数：`refresh` 是字符串，按键处理留在 main.ts 按 `keys` 分组派发。
       这样本模块是纯数据（只依赖 game.ts 取状态清单），能被静态检查与测试直接对照。
     · 定义期就校验：状态漏了场景、场景多了状态、两个场景抢同一个覆盖层，
       都在模块加载时抛错 —— 而不是等某个界面显示不出来。
   ========================================================= */

import { Game } from './game.ts';
import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';
import { Station } from './station.ts';

var Scene = {} as SceneApi;

/* =========================================================
   1. 场景表
   ========================================================= */
var TABLE: Record<string, SceneDef> = {
  title: {
    overlay: 'title', sim: false, world: false, hud: false, strip: false, keys: 'menu',
    note: '标题页：待机背景 + 菜单，没有会话'
  },
  chars: {
    overlay: 'chars', sim: false, world: false, hud: false, strip: false, keys: 'start',
    note: '选人页：同上；从这里有且只有一条进对局的路（newRun）'
  },
  /* 选存档 / 捏人（R50）：用户流程原话「点击开始游戏按钮，**选择存档**，进入游戏，
     第一个到的是大厅」/「选择新存档，就会需要**捏人**选择初始角色外观，
     选择初始角色职业，然后就能确定这个角色的初始技能，初始属性，初始天赋」。
     两屏都是**局外**（`world:false` —— 这时候还没有会话，画不出世界）。 */
  slots: {
    overlay: 'slots', sim: false, world: false, hud: false, strip: false, keys: 'start',
    note: '选存档：三张档位卡（有人的档「继续」，没人的档「开始新档」）'
  },
  create: {
    overlay: 'create', sim: false, world: false, hud: false, strip: false, keys: 'start',
    note: '捏人：名字 / 外观（色板 · 脸型 · 配件）/ 初始职业 / 入门三选（技能 · 属性 · 天赋）'
  },
  station: {
    /* 大厅（站）：**每一次开局的起点**。它归**局内**（不是菜单）——
       从战斗回大厅是走回去，从大厅出击是回到这一局。

       ⚠ 2026-10 改动（"要真的能走的世界，不要按钮和选项"）：
         `sim:true` —— 大厅是一间**能走的房间**（`hall.ts` 摆的墙与门），
           玩家用 WASD 走、撞墙、走进传送门换模块。它推进的只有"走动"这一层：
           `Game.step` 在 station 里走 `stepHall`，**不碰波次**（见 game.ts 的
           `stepHall` 注释：世界的时间在走，战斗的波次不在走）。
         `keys:'hall'` —— 这一档按键组是"房间里走路"：方向键/WASD 是**移动**
           （不是菜单焦点），E 是与面前的人/公告板交互，Esc 暂停。 */
    overlay: 'station', sim: true, world: true, hud: false, strip: false, keys: 'hall',
    note: '大厅（站）：这一局的起点，**一间能走的房**；三道常开的门通向三个模块（出击 / 经营 / 养成）'
  },
  playing: {
    overlay: null, sim: true, world: true, hud: true, strip: true, keys: 'battle',
    note: '战斗中：唯一推进逻辑帧的场景'
  },
  levelup: {
    overlay: 'levelup', sim: false, world: true, hud: false, strip: true, keys: 'cards',
    note: '升级选卡：模拟暂停，世界继续画（看得见被围住）'
  },
  shop: {
    overlay: 'shop', sim: false, world: true, hud: false, strip: true, keys: 'shop',
    note: '波间商店：模拟暂停，武器条可见（可以卖）'
  },
  camp: {
    overlay: 'camp', sim: false, world: true, hud: false, strip: true, keys: 'camp',
    note: '局内营地：花同一笔材料搞建设（可选去处，不是必经），结算清零'
  },
  paused: {
    overlay: 'pause', sim: false, world: true, hud: true, strip: true, keys: 'pause',
    note: '暂停：HUD 保持可见（要看得见当前状态），值当然是冻结的'
  },
  howto: {
    overlay: 'howto', sim: false, world: true, hud: false, strip: false, keys: 'back',
    note: '帮助浮层：从标题或战斗中都能进，返回时回到来处'
  },
  settings: {
    overlay: 'settings', sim: false, world: true, hud: false, strip: false, keys: 'back',
    note: '设置：标题页与暂停页都能进（改造前只能从暂停进，想调音量必须先开一局）'
  },
  records: {
    overlay: 'records', sim: false, world: true, hud: false, strip: false, keys: 'back',
    note: '战绩：跨局累计。改造前 Save.addRun 一直在写，但没有任何界面读它'
  },
  codex: {
    overlay: 'codex', sim: false, world: true, hud: false, strip: false, keys: 'back',
    note: '图鉴与挑战：账号档案的可见面（解锁进度 / 三态图鉴 / 孢子）'
  },
  talents: {
    overlay: 'talents', sim: false, world: true, hud: false, strip: false, keys: 'back',
    note: '天赋：角色养成（多级永久树，只改开局条件）'
  },
  skills: {
    overlay: 'skills', sim: false, world: true, hud: false, strip: false, keys: 'back',
    note: '技能构筑：每个角色一张两张卡的树（选技能 + 选改造器）'
  },
  keep: {
    overlay: 'keep', sim: false, world: true, hud: false, strip: false, keys: 'back',
    note: '据点：跨局经营（花孢子解锁功能，永久）'
  },
  hub: {
    /* ⚠ 与大厅同一档（`sim:true` / `keys:'hall'`）：枢纽也是**一间能走的房**
       （2026-10，"要真的能走的世界"）。四个人站在屋里，走到谁面前按 E 说话；
       四件设施走上去就进 —— 出去走回大厅（门口那一站），不是回主菜单。
       这一档按键组取代了原来的 `none`（那档是"整屏面板 + 焦点按钮"的做法）。 */
    overlay: 'hub', sim: true, world: true, hud: false, strip: false, keys: 'hall',
    note: '枢纽：这一局的"家"，**一间能走的房**（NPC 站在屋里，走到跟前按 E 说话）'
  },
  end: {
    overlay: 'end', sim: false, world: true, hud: false, strip: false, keys: 'none',
    note: '结算：世界当背景，覆盖层里出统计'
  }
};

/** 需要重画内容的覆盖层（UI.refresh 用；字符串而不是函数，保持本模块是纯数据） */
var REFRESH: Record<string, string> = {
  /* 标题页也要重画：它的"继续上一局"按钮与"枢纽有人想说新话"角标是**从存档/档案读出来的**。
     不登记它的后果实测过 —— 从暂停里"放弃本局"再回标题，存档明明还在
     （有意为之：放弃不删档），按钮却停在上一次的"没有存档"状态，续玩入口看不见也点不到。 */
  title: 'title',
  slots: 'slots', create: 'create',
  shop: 'shop', camp: 'camp', levelup: 'cards', settings: 'settings', records: 'records',
  paused: 'pause', codex: 'codex', talents: 'talents', skills: 'skills', keep: 'keep', hub: 'hub',
  /* 大厅也要重画：三道门是**按表**画的，公告板上的账与"下一步"是**从这一局读出来的** ——
     不登记它，进站第二眼看到的就是上一次的账。 */
  station: 'station'
};

/* =========================================================
   1b. "去某个界面"的按钮动作表
   ---------------------------------------------------------
   界面里一多半按钮其实只是**跳到某个界面**（返回 / 设置 / 图鉴 / 据点 / 枢纽…）。
   那是数据，不是代码 —— 改造前它是 ui.ts 里 switch 的 53 个分支之一。

   放在本模块（而不是 ui.ts）有三个理由：
     · 它引用的是**状态名**，而状态机与场景表都归这里管 —— 于是"跳到一个不存在的
       界面"能在**定义期**就被抓住（validate 里查），不必等谁点一下才发现
     · 它是纯数据：模拟层的测试也会加载它（ui.ts 在无头模拟里根本不加载）
     · 它进了总账（family: screenAct），跨表引用由 Registry.audit() 统一查
   ========================================================= */
var SCREEN_ACTS: Record<string, GameStateName> = {
  'back-title': 'title',
  'howto': 'howto',
  'settings': 'settings',
  'records': 'records',
  'codex': 'codex',
  'talents': 'talents',
  'skills': 'skills',
  'keep': 'keep',
  'hub': 'hub',
  'camp-back': 'shop',       // 营地是"局内商店旁边的一间"，回营地就是回商店
  'hub-go': 'station',       // 枢纽的门口 = 去大厅（这一局的传送门房间）
  /* 暂停菜单里的「回大厅」：这也是**唯一**一条从局内走回大厅的路
     （三扇门全在 `station.ts` 的表里，界面不自己造门）。 */
  'to-station': 'station'
};

/* =========================================================
   1c. 模块 ⇄ 屏幕：大厅那三道门**通向哪一屏**
   ---------------------------------------------------------
   这张表**搬去了 `station.ts`**（2026-10），因为它本来就是门自己的属性：
   玩家走进那道门 = 切到那一屏，而"走进门"这件事发生在模拟层
   （`game.ts` 的 `stepHall` 走 `Station.screenOf`）—— 而模拟层不能
   import 本模块（本模块 import 它，环形依赖会被架构门拦下）。

   留在这里的是**校验**：只有本模块认识全部状态名，所以"目标状态存不存在"
   仍然在定义期就查（写错一个字母 = 那道门走上去什么也不会发生）。
   本模块对外仍然提供同一个读口 `Scene.moduleScreenOf`（调用方不用改）。

   ⚠ 其中"战斗 → playing"指的是**回到手里这一局**，不是新开一局
     （新开一局只有 `newRun` 一条路，见 game.ts 的 TRANSITIONS 注释）。
   ========================================================= */
var MODULE_SCREENS: Record<string, GameStateName> = (function () {
  var out: Record<string, GameStateName> = Object.create(null);
  for (var i = 0; i < Station.LIST.length; i++) {
    var s = Station.LIST[i];
    if (s.kind === 'portal' && s.to && s.screen) out[s.to] = s.screen as GameStateName;
  }
  return out;
})();

/* =========================================================
   2. 定义期校验
   ========================================================= */
var FIELDS = ['overlay', 'sim', 'world', 'hud', 'strip', 'keys'];
var KEY_GROUPS = ['menu', 'start', 'battle', 'cards', 'shop', 'camp', 'pause', 'back', 'hall', 'none'];

Scene.validate = function () {
  var i, s;
  var problems = [];

  // 状态 ⇄ 场景 必须一一对应
  for (i = 0; i < Game.STATES.length; i++) {
    s = Game.STATES[i];
    if (!TABLE[s]) problems.push('状态 ' + s + ' 没有对应场景');
  }
  for (s in TABLE) {
    if (Game.STATES.indexOf(s) < 0) problems.push('场景 ' + s + ' 不在 Game.STATES 里');
  }

  var overlays: Record<string, string> = Object.create(null);
  for (s in TABLE) {
    var d = TABLE[s];
    for (i = 0; i < FIELDS.length; i++) {
      if (d[FIELDS[i]] === undefined) problems.push('场景 ' + s + ' 缺字段 ' + FIELDS[i]);
    }
    if (d.overlay !== null && typeof d.overlay !== 'string') {
      problems.push('场景 ' + s + ' 的 overlay 只能是字符串或 null');
    }
    if (d.overlay !== null) {
      if (overlays[d.overlay]) {
        problems.push('覆盖层 ' + d.overlay + ' 被 ' + overlays[d.overlay] + ' 与 ' + s + ' 共用' +
          '（同一时刻只能有一个界面在显示）');
      }
      overlays[d.overlay] = s;
    }
    if (KEY_GROUPS.indexOf(d.keys) < 0) {
      problems.push('场景 ' + s + ' 的按键组 ' + d.keys + ' 未定义（可用：' + KEY_GROUPS.join('/') + '）');
    }
    if (d.sim && !d.world) {
      // 推进模拟却画待机背景，一定有一处写错了
      problems.push('场景 ' + s + ' 声明推进模拟但不画世界');
    }
  }

  // 动作 → 界面：去处必须是真实存在的状态（写错一个字母，那个按钮从此点了没反应）
  for (var act in SCREEN_ACTS) {
    if (!Object.prototype.hasOwnProperty.call(SCREEN_ACTS, act)) continue;
    if (Game.STATES.indexOf(SCREEN_ACTS[act]) < 0) {
      problems.push('动作 ' + act + ' 指向不存在的界面：' + SCREEN_ACTS[act]);
    }
  }

  // 模块 → 屏幕：同一件事（大厅那三道门靠它落地）
  for (var mod in MODULE_SCREENS) {
    if (!Object.prototype.hasOwnProperty.call(MODULE_SCREENS, mod)) continue;
    if (Game.STATES.indexOf(MODULE_SCREENS[mod]) < 0) {
      problems.push('模块 ' + mod + ' 指向不存在的界面：' + MODULE_SCREENS[mod] +
        '（那扇门点下去什么也不会发生）');
    }
  }

  /* 门表里的 `screen` 与 MODULE_SCREENS 是同一件事的两个读口（前者在
     `station.ts`，后者派生于它）—— 这里再逐个查一遍，于是"门自己写着
     一个不存在的状态名"也会在定义期被抓住。 */
  for (var si = 0; si < Station.LIST.length; si++) {
    var site = Station.LIST[si];
    if (!site.screen) continue;
    if (Game.STATES.indexOf(site.screen as GameStateName) < 0) {
      problems.push('站点 ' + site.id + ' 写着不存在的界面：' + site.screen +
        '（走上去什么也不会发生）');
    }
  }

  /* 两间能走的房（大厅 / 枢纽）不在这里查：
       · "有没有写去处 / 摆位压没压墙 / 走不走得到" 归 `hall.ts` 的 `Hall.audit`
       · "写的去处是不是真实状态" 归总账（`hallRoom` / `hallSpot` 的 refs → family 'state'）
     本模块只留"门表 → 屏幕"这条翻译（MODULE_SCREENS，由 Station 派生）。 */

  /* 与其它模块的 `audit()` 同一形状（返回 `{ok, problems}` 而不是抛）：
     于是它既能被启动期自检统一收集，也能被测试直接读问题清单。
     "抛不抛"由调用方决定 —— 本模块自己在加载时抛（状态机必须比谁都早）。 */
  return { ok: problems.length === 0, problems: problems };
};

/* =========================================================
   3. 查询
   ========================================================= */
/** 该状态的场景（未定义直接抛错，而不是返回 undefined 让调用方踩空） */
Scene.of = function (state) {
  var d = TABLE[state];
  if (!d) throw new Error('scene: 未知状态 ' + state + '（场景表里没有它）');
  return d;
};

Scene.has = function (state) { return !!TABLE[state]; };
Scene.overlayOf = function (state) { return Scene.of(state).overlay; };
Scene.refreshOf = function (state) { return REFRESH[state] || null; };
/** 该状态是否推进逻辑帧（= Game.step 的闸门） */
Scene.simulates = function (state) { return Scene.of(state).sim; };
/** 当前是否画世界（title/chars 画待机背景） */
Scene.drawsWorld = function (state) { return Scene.of(state).world; };
Scene.showsHud = function (state) { return Scene.of(state).hud; };
Scene.showsStrip = function (state) { return Scene.of(state).strip; };
Scene.keyGroup = function (state) { return Scene.of(state).keys; };
/** 这个按钮动作是不是"去某个界面"（不是就返回 null） */
Scene.screenActOf = function (act) { return SCREEN_ACTS[act] || null; };
Scene.screenActNames = function () { return Object.keys(SCREEN_ACTS); };
/** 大厅的门通向哪一屏（模块名 → 状态名；不在表里就返回 null，调用方不许瞎猜） */
Scene.moduleScreenOf = function (mod) { return MODULE_SCREENS[mod] || null; };
Scene.moduleScreenNames = function () { return Object.keys(MODULE_SCREENS); };
/** 所有用到的覆盖层名字（ui.ts 用它建元素引用） */
Scene.overlayNames = function () {
  var out = [];
  for (var s in TABLE) if (TABLE[s].overlay !== null) out.push(TABLE[s].overlay);
  return out;
};
/** 一张给人看的表（README/调试用） */
Scene.describe = function () {
  var lines = ['场景        覆盖层    模拟  世界  HUD  武器条  按键'];
  for (var i = 0; i < Game.STATES.length; i++) {
    var s = Game.STATES[i], d = TABLE[s];
    lines.push(s.padEnd(11) + String(d.overlay || '—').padEnd(10) +
      (d.sim ? ' 是  ' : ' 否  ') + (d.world ? ' 是  ' : ' 否  ') +
      (d.hud ? ' 是  ' : ' 否  ') + (d.strip ? ' 是  ' : ' 否  ') + '  ' + d.keys);
  }
  return lines.join('\n');
};

Scene.TABLE = TABLE;
Scene.SCREEN_ACTS = SCREEN_ACTS;
/* 场景表是"状态机完整性"，所以**加载即校验**（它必须比谁都早，启动期自检只是再报一次）；
   同时登记进启动期自检，于是入口那边一次能拿到全部问题，而不是分两处报。 */
var sceneCheck = Scene.validate();
if (!sceneCheck.ok) {
  throw new Error('scene: 场景表有问题\n  - ' + sceneCheck.problems.join('\n  - '));
}
SelfCheck.register('Scene', Scene.validate);

/* 登记到扩展点总账：场景名必须与状态机一致，覆盖层必须是真实存在的界面 */
Registry.family('scene', {
  note: '场景表（每个阶段是什么）', owner: 'scene.ts',
  entries: function () {
    var out = [];
    for (var k in TABLE) {
      if (!Object.prototype.hasOwnProperty.call(TABLE, k)) continue;
      out.push({
        id: k,
        refs: [
          { field: 'state', value: k, family: 'state' },
          { field: 'overlay', value: TABLE[k].overlay, family: 'overlay' },
          { field: 'keys', value: TABLE[k].keys, family: 'keyGroup' }
        ]
      });
    }
    return out;
  }
});
/* 登记到扩展点总账：覆盖层与按键组都是家族（后者表里已有清单，前者由场景表派生） */
Registry.family('overlay', {
  note: 'UI 覆盖层（对应 index.html 里的 scr-<名字>）', owner: 'scene.ts',
  values: function () { return Scene.overlayNames(); }
});
Registry.family('keyGroup', {
  note: '按键组（main.ts 按键处理的分发单位）', owner: 'scene.ts',
  values: function () { return KEY_GROUPS.slice(); }
});
/* 按钮动作 → 界面。这是"把分支变成数据"的那一半：写错一个字母，
   那个按钮从此点了没反应 —— 所以在这里登记，让总账去查目标状态真实存在。 */
Registry.family('screenAct', {
  note: '去某个界面的按钮动作（值 = 状态名）', owner: 'scene.ts',
  entries: function () {
    var out = [];
    for (var a in SCREEN_ACTS) {
      if (!Object.prototype.hasOwnProperty.call(SCREEN_ACTS, a)) continue;
      out.push({ id: a, refs: [{ field: 'to', value: SCREEN_ACTS[a], family: 'state' }] });
    }
    return out;
  }
});
/* 模块 → 屏幕：**两边的名字都要真的存在**（左 = 经济循环的三个模块，
   右 = 状态机里的状态）。写错任一边的表现都是"大厅里那扇门点不开"。 */
Registry.family('moduleScreen', {
  note: '模块（combat / manage / grow）通向哪一屏 —— 大厅那三道门的翻译表' +
    '（表在 station.ts 的门上，这里登记"它指向的状态真实存在"）', owner: 'scene.ts',
  entries: function () {
    var out = [];
    /* 名单从公开读口拿（而不是直接遍历私有变量）：总账登的就是
       "表里有哪些模块"这件事本身，两边不会各数一遍。 */
    var names = Scene.moduleScreenNames();
    for (var i = 0; i < names.length; i++) {
      var m = names[i];
      out.push({
        id: m,
        refs: [
          { field: 'screen', value: MODULE_SCREENS[m], family: 'state' },
          { field: 'module', value: m, family: 'ledgerSystem' }
        ]
      });
    }
    return out;
  }
});
export { Scene };
