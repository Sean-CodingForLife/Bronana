/* =========================================================
   hall.ts — 大厅与枢纽：**两间真的能走的房子**
   ---------------------------------------------------------
   用户对这一块的原始要求（这一份文件存在的全部理由）：

     "我需要的是一个玩家真实可交互可游玩的局内世界，而不是什么文字冒险，
      我需要真实可以玩可以探索的世界，而不是给我几个按钮和选项就完了"
     "点击开始游戏选择角色存档，进入游戏大厅，然后选择去往各个不同的
      游戏模块地图进行游玩…有点类似于挺进地牢、深岩银河、元气骑士、死亡细胞"

   改造前的大厅与枢纽是**整屏覆盖层 + 一排按钮卡**：世界在后面当背景图，
   玩家能做的只有"点哪张卡"。那不是"一张大地图上的三个模块"，那是三个菜单项。

   现在这两间房有：**地面、墙、能撞的货箱柱子、站在地上的门与灯**，
   玩家用 WASD 走，走到传送门上就换模块，走到人面前按 E 说话。
   这份文件就是那两间房的数据与几何（纯数据 + 纯函数，不认识界面也不认识对局）。

   三条纪律：

   1. **门表还是 `station.ts` 的**。这里只声明"那三道门摆在哪"，不新增门、
      不改它们的去处 —— 所以"加一个模块"仍然只动 `station.ts` 一张表，
      而"把门挪个位置"只动这里。自检（`Hall.audit`）守着两边一一对应。
   2. **枢纽里站着谁由 `story.ts` 说了算**（人有解锁条件），这里只声明
      "每一站摆在哪"；没解锁的人不出现（`Hall.liveSpots` 过滤），
      但**位置是常驻的** —— 否则记录官一出现，整间屋子的东西会挪位。
   3. **墙是一堆轴对齐矩形**。不是随便简化：这个项目的碰撞体只有圆（见
      `collide.ts`），而"圆 vs 轴对齐矩形"的推出有闭式解、没有迭代误差，
      于是玩家贴着墙走不会抖，也不会在某条缝里被卡住。
      斜墙与弧墙要的是另一套东西（线段碰撞 + 寻路），这一版不需要。

   ⚠ 与战场（`arena.ts`）的关系：那一边是**随机生成**的地牢房间（每波重掷），
   这一边是**手写**的两间房（每一局都一样，玩家记得住哪扇门在哪）——
   "熟悉的地方"正是大厅该给的东西，所以这两份数据不共用生成器。
   ========================================================= */

import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';
import { Station } from './station.ts';
import { Story } from './story.ts';
import { PAL, U } from './utils.ts';

var Hall = {} as HallApi;

/* =========================================================
   1. 两间房
   ---------------------------------------------------------
   坐标与战场同一套：左上原点、y 向下、单位是像素。房间比屏幕大
   （1500×1120，1280×720 的窗口一眼看不全）—— 这是**有意的**：
   "一眼看全"的房间走到哪都一样，探索感就没了。

   墙面厚度统一 36：够厚，画得出一圈"墙里墙外"，
   也让"撞上去"这件事看得见（角色贴墙时不会压在墙线上）。
   ========================================================= */

/** 墙的厚度（两面共用；画法也读它，所以它只写一次） */
Hall.WALL = 36;

var W = 1500, H = 1120, T = 36;

var ROOMS: HallRoomDef[] = [
  {
    id: 'station',
    name: '大厅',
    w: W, h: H,
    /* 出生点：默认站在屋子中央偏南（正对那扇通往枢纽的门）。
       从别处**回来**时用 `spawnAt`（回到哪个门口就从哪站起来 —— 见下）。 */
    spawn: { x: 750, y: 950 },
    spawnAt: {
      /* ⚠ 这些落点必须**站在触发圈之外**（离门心 > 门的 r），
         否则"从养成门回来"会被立刻再送进养成 —— 玩家看到的是"传送门弹射"。 */
      hub: { x: 750, y: 960 },
      playing: { x: 300, y: 470 },
      keep: { x: 750, y: 470 },
      talents: { x: 1200, y: 470 },
      title: { x: 750, y: 950 }
    },
    walls: [
      // —— 四面外墙（南墙中间留出通往枢纽的门洞）——
      { x: 0, y: 0, w: W, h: T },
      { x: 0, y: H - T, w: 660, h: T },
      { x: 840, y: H - T, w: W - 840, h: T },
      { x: 0, y: 0, w: T, h: H },
      { x: W - T, y: 0, w: T, h: H },
      // —— 北墙下的两张控制台：三个传送门之间的"绕过它"才是走位 ——
      { x: 380, y: 190, w: 300, h: 40 },
      { x: 820, y: 190, w: 300, h: 40 },
      // —— 公告板后面的矮墙（板子是读账的地方，不是墙；墙在它背后）——
      { x: 650, y: 730, w: 200, h: 32 },
      // —— 两根柱子与一堆货箱：把"这是个大房间"说出来 ——
      { x: 150, y: 700, w: 70, h: 70 },
      { x: 1280, y: 700, w: 70, h: 70 },
      { x: 1000, y: 560, w: 130, h: 130 }
    ],
    props: [
      { x: 470, y: 150, kind: 'pipe', s: 1, rot: 0 },
      { x: 1040, y: 150, kind: 'pipe', s: 1, rot: 0 },
      { x: 120, y: 420, kind: 'crate', s: 1, rot: 0 },
      { x: 120, y: 500, kind: 'crate', s: 0.8, rot: 0.4 },
      { x: 1390, y: 420, kind: 'barrel', s: 1, rot: 0 },
      { x: 1390, y: 500, kind: 'barrel', s: 1, rot: 0 },
      { x: 1085, y: 300, kind: 'mushroom', s: 1, rot: 0 },
      { x: 430, y: 300, kind: 'mushroom', s: 0.8, rot: 0 },
      { x: 250, y: 1020, kind: 'crate', s: 1, rot: 0 },
      { x: 1260, y: 1020, kind: 'crate', s: 1, rot: 0 },
      { x: 750, y: 620, kind: 'pillar', s: 1, rot: 0 }
    ],
    /* 地面：冷灰钢板 + 深色缝。**有意与地牢的红棕地面拉开** ——
       一眼就能看出"我回到站里了"，而不是"这一间房长得不一样"。 */
    floor: { base: '#4a423b', alt: '#413a34', edge: PAL.STEEL, rug: '#5a5049', lit: '#6b5f52' },
    spots: [
      /* 三道门：`id` 就是 `Station.LIST` 里的站点 id（自检守着两边一一对应），
         去哪个模块也由那张表说了算（`module` 只是给画法与提示用的副本，
         自检会查它们一致 —— 写错一个字母就是"走进门去了别的模块"）。 */
      { id: 'gate-combat', name: '出击门', kind: 'portal', x: 300, y: 320, r: 46, face: 1, module: 'combat' },
      { id: 'gate-manage', name: '经营门', kind: 'portal', x: 750, y: 320, r: 46, face: 0, module: 'manage' },
      { id: 'gate-grow', name: '养成门', kind: 'portal', x: 1200, y: 320, r: 46, face: -1, module: 'grow' },
      /* 公告板：不是门（`kind:'board'`，没有 screen）—— 走到它面前按 E 读账 */
      { id: 'board', name: '公告板', kind: 'board', x: 750, y: 640, r: 44, face: 0 },
      /* 通往**枢纽**的门洞：枢纽是这一局的"家"，也是局内的一间 ——
         所以它是墙上的一个洞，不是菜单里的一行字。 */
      { id: 'to-hub', name: '枢纽门', kind: 'door', x: 750, y: H - T - 6, r: 44, face: 0, screen: 'hub' }
    ],
    lamps: [
      { x: 300, y: 320, r: 150 },
      { x: 750, y: 320, r: 150 },
      { x: 1200, y: 320, r: 150 },
      { x: 750, y: 700, r: 170 }
    ]
  },
  {
    id: 'hub',
    name: '枢纽',
    w: W, h: H,
    spawn: { x: 750, y: 170 },
    spawnAt: {
      station: { x: 750, y: 180 },
      paused: { x: 750, y: 180 },
      playing: { x: 750, y: 180 },
      keep: { x: 1180, y: 760 },
      talents: { x: 1100, y: 420 },
      codex: { x: 1100, y: 180 },
      title: { x: 750, y: 170 }
    },
    walls: [
      // —— 四面外墙（北墙中间留出回大厅的门洞）——
      { x: 0, y: 0, w: 660, h: T },
      { x: 840, y: 0, w: W - 840, h: T },
      { x: 0, y: H - T, w: W, h: T },
      { x: 0, y: 0, w: T, h: H },
      { x: W - T, y: 0, w: T, h: H },
      // —— 炉子周围四根柱子：中间这圈是"家"的中心，绕过去才走到四个角落 ——
      { x: 560, y: 470, w: 80, h: 80 },
      { x: 860, y: 470, w: 80, h: 80 },
      { x: 560, y: 700, w: 80, h: 80 },
      { x: 860, y: 700, w: 80, h: 80 },
      // —— 菌床那一角（菌母的窝）——
      { x: 36, y: 460, w: 220, h: 40 },
      // —— 钟楼那一边的矮墙（守钟人背后的墙）——
      { x: 1240, y: 760, w: 224, h: 40 },
      // —— 记录墙（档案墙背后那面）——
      { x: 1180, y: 180, w: 44, h: 220 }
    ],
    props: [
      { x: 750, y: 620, kind: 'fire', s: 1, rot: 0 },
      { x: 300, y: 300, kind: 'mushroom', s: 1.3, rot: 0 },
      { x: 190, y: 380, kind: 'mushroom', s: 0.9, rot: 0 },
      { x: 250, y: 900, kind: 'crate', s: 1, rot: 0 },
      { x: 330, y: 960, kind: 'barrel', s: 1, rot: 0 },
      { x: 1250, y: 950, kind: 'barrel', s: 1, rot: 0 },
      { x: 1400, y: 950, kind: 'crate', s: 1, rot: 0 },
      { x: 1050, y: 200, kind: 'pipe', s: 1, rot: 0 },
      { x: 690, y: 980, kind: 'sign', s: 1, rot: 0 },
      { x: 1400, y: 640, kind: 'pillar', s: 1, rot: 0 }
    ],
    /* 地面：暖土 + 菌毯色（与大厅的冷灰钢板正好相反 —— 一个是站，一个是家） */
    floor: { base: '#5b4030', alt: '#523929', edge: PAL.WOOD_D, rug: '#6b4a35', lit: '#7a5a3f' },
    spots: [
      /* 四件设施：走上去就进去（与地牢里"走进门就换房"同一条规矩）。
         去处来自 `story.ts` 的站点表，这里只是**摆在哪**。 */
      { id: 'mirror', name: '镜面', kind: 'device', x: 750, y: 300, r: 48, face: 0 },
      { id: 'wall', name: '档案墙', kind: 'device', x: 1100, y: 300, r: 48, face: 0 },
      { id: 'contract', name: '契约台', kind: 'device', x: 1180, y: 620, r: 48, face: 0 },
      /* 四位 NPC：站在房里的人 —— 走到跟前按 E 说话（人不会因为撞上去就开口） */
      { id: 'mother', name: '菌母', kind: 'npc', x: 300, y: 330, r: 64, face: 1 },
      { id: 'picker', name: '拾荒者', kind: 'npc', x: 300, y: 830, r: 64, face: 1 },
      { id: 'keeper', name: '守钟人', kind: 'npc', x: 1120, y: 900, r: 64, face: -1 },
      { id: 'archivist', name: '记录官', kind: 'npc', x: 700, y: 900, r: 64, face: 0 },
      /* 门口：墙上那个洞，走上去回大厅（枢纽归**局内**：出去不是回主菜单） */
      { id: 'door', name: '门口', kind: 'door', x: 750, y: T + 6, r: 44, face: 0 }
    ],
    lamps: [
      { x: 750, y: 620, r: 230 },
      { x: 300, y: 330, r: 130 },
      { x: 1120, y: 900, r: 130 },
      { x: 750, y: 180, r: 140 }
    ]
  }
];

Hall.ROOMS = ROOMS;
Hall.BY_ID = (function () {
  var m: Record<string, HallRoomDef> = Object.create(null);
  for (var i = 0; i < ROOMS.length; i++) m[ROOMS[i].id] = ROOMS[i];
  return m;
})();

/* =========================================================
   1b. 接线：摆位 ⇄ 两张表
   ---------------------------------------------------------
   这一间房里只写"**摆在哪**"（坐标、半径、朝向、画成什么），
   而"**通向哪**"与"**站着谁**"各有唯一出处：
     · 大厅三道门 → `station.ts` 的站点表（`screen` / `module`）
     · 枢纽八站   → `story.ts` 的站点表（`npc` / `screen`）

   为什么不把 screen 直接抄在坐标旁边：那样等于把同一件事写两份，
   "改了一处忘了另一处"的表现是**走进出击门去了养成模块**这一类
   最难查的故障。这里在加载期合成一次，之后一律读合成后的摆位。
   ========================================================= */
(function wire() {
  var st = Hall.BY_ID.station;
  if (st) {
    for (var i = 0; i < st.spots.length; i++) {
      var sp = st.spots[i];
      var site = Station.BY_ID[sp.id];
      if (!site) continue;                       // 摆错的门由 audit 报
      sp.name = site.name;
      if (site.kind === 'portal') {
        sp.screen = site.screen || undefined;
        sp.module = site.to || undefined;
      }
    }
  }
  var hub = Hall.BY_ID.hub;
  if (hub) {
    for (var j = 0; j < hub.spots.length; j++) {
      var hs = hub.spots[j];
      for (var k = 0; k < Story.STATIONS.length; k++) {
        var stn = Story.STATIONS[k];
        if (stn.id !== hs.id) continue;
        hs.name = stn.name;
        if (stn.npc) hs.npc = stn.npc;
        if (stn.screen) hs.screen = stn.screen;
        break;
      }
    }
  }
})();

/** 玩家在这一层里的碰撞半径（比战场上的略小一点：屋里要贴着货箱走） */
Hall.R = 15;
/** 站里的脚程（像素/秒）。**有意不用战斗属性**：站里没有战斗 buff，
    而"跑得多快"这件事在安全屋里不该被符文改（与"时间流速一致"不冲突 ——
    一致的是世界的时间，不是角色的加成）。 */
Hall.SPEED = 268;
Hall.ACCEL = 11;

/* =========================================================
   2. 几何（纯函数）
   ========================================================= */

/** 点是否落在某个矩形里（可以外扩 pad） */
function inRect(r: HallWallDef, x: number, y: number, pad: number) {
  pad = pad || 0;
  return x > r.x - pad && x < r.x + r.w + pad && y > r.y - pad && y < r.y + r.h + pad;
}
Hall.inRect = inRect;

/** 这一间里哪面墙压住了这个圆（没有就返回 null）—— 出生点/站点的自检用它 */
Hall.hitWall = function (roomId: string, x: number, y: number, r: number) {
  var room = Hall.BY_ID[roomId];
  if (!room) return null;
  for (var i = 0; i < room.walls.length; i++) {
    if (inRect(room.walls[i], x, y, r)) return room.walls[i];
  }
  return null;
};

Hall.inside = function (roomId: string, x: number, y: number, r: number) {
  var room = Hall.BY_ID[roomId];
  if (!room) return false;
  var pad = Hall.WALL + (r || 0);
  return x >= pad && x <= room.w - pad && y >= pad && y <= room.h - pad;
};

/**
 * 把圆推出所有挡路的矩形（**轴对齐推出**，不迭代到收敛）。
 *
 * 每一面墙都是一次"取最小穿透轴"：圆心的 x 落在墙的 x 区间内就沿 y 推，
 * 否则沿 x 推。两遍就够 —— 第一遍解开与墙的重叠，第二遍处理
 * "被第一遍推进了另一面墙"的墙角情形（箱子与柱子挨着时会发生）。
 * 三遍以上是浪费：房间是手写的，没有需要迭代收敛的尖角。
 *
 * @returns `{ x, y, hitX, hitY }`；两个 `hit*` 用来把撞墙那一轴的速度清零
 *          （否则贴着墙走会"积着"一份速度，松手时弹一下）。
 */
Hall.slide = function (roomId: string, x: number, y: number, r: number) {
  var room = Hall.BY_ID[roomId];
  var hitX = false, hitY = false;
  if (!room) return { x: x, y: y, hitX: hitX, hitY: hitY };

  // 先夹在房间的可行区里（外墙也在这条线里，不用单独判）
  var lo = Hall.WALL + r, hiX = room.w - Hall.WALL - r, hiY = room.h - Hall.WALL - r;
  if (x < lo) { x = lo; hitX = true; }
  if (x > hiX) { x = hiX; hitX = true; }
  if (y < lo) { y = lo; hitY = true; }
  if (y > hiY) { y = hiY; hitY = true; }

  for (var pass = 0; pass < 2; pass++) {
    for (var i = 0; i < room.walls.length; i++) {
      var w = room.walls[i];
      if (!inRect(w, x, y, r)) continue;
      // 四个方向各自要推多远（负数表示不需要往那边推）
      var left = x - (w.x - r), right = (w.x + w.w + r) - x;
      var up = y - (w.y - r), down = (w.y + w.h + r) - y;
      if (left <= right && left <= up && left <= down) { x = w.x - r; hitX = true; }
      else if (right <= up && right <= down) { x = w.x + w.w + r; hitX = true; }
      else if (up <= down) { y = w.y - r; hitY = true; }
      else { y = w.y + w.h + r; hitY = true; }
    }
  }
  return { x: x, y: y, hitX: hitX, hitY: hitY };
};

/** 这一间现在**真的摆着**的那些站（`live` 为 null = 表里的全都在） */
Hall.liveSpots = function (roomId: string, live: string[] | null): HallSpotDef[] {
  var room = Hall.BY_ID[roomId];
  if (!room) return [];
  if (!live) return room.spots.slice();
  var set: Record<string, boolean> = Object.create(null);
  for (var i = 0; i < live.length; i++) set[live[i]] = true;
  return room.spots.filter(function (s) {
    /* 门洞与设施是**常驻**的（它们没有解锁条件）；只有人会因为剧情不在。
       判据写成"人要在名单里"，而不是"不在名单里就藏起来" —— 后者会把
       门洞一起藏掉（玩家一进屋就发现出不去）。 */
    return s.kind !== 'npc' || set[s.id] === true;
  });
};

/** 站在这些站里的哪一个面前（提示用；取最近的一个） */
/** 走到多近算"站在它面前"（在站的半径之外还要走这么近） */
Hall.REACH = 42;

Hall.near = function (spots: HallSpotDef[], x: number, y: number, r: number): HallSpotDef | null {
  var best: HallSpotDef | null = null, bd = Infinity;
  for (var i = 0; i < spots.length; i++) {
    var s = spots[i];
    var d = Math.sqrt(U.dist2(x, y, s.x, s.y)) - s.r - r;
    if (d > Hall.REACH) continue;
    if (d < bd) { bd = d; best = s; }
  }
  return best;
};

/**
 * 走进去就会触发的那一个站（自动门 / 传送门 / 设施）。**没有就是 null。**
 * 人是例外：撞到人身上不会开口（要按 E）—— 与"走进门就换房"同一条规矩的
 * 边界：门是**过道**，人是**对象**。
 */
Hall.touch = function (spots: HallSpotDef[], x: number, y: number, r: number): HallSpotDef | null {
  var best: HallSpotDef | null = null, bd = Infinity;
  for (var i = 0; i < spots.length; i++) {
    var s = spots[i];
    if (s.kind === 'npc' || s.kind === 'board') continue;   // 人要用 E；公告板要用 E
    if (!s.screen) continue;                                 // 没有去处的站不是门
    var d = Math.sqrt(U.dist2(x, y, s.x, s.y)) - s.r - r;
    if (d > 0) continue;
    if (d < bd) { bd = d; best = s; }
  }
  return best;
};

/** 进这一间时站在哪（从哪一扇门回来就站回哪个门口） */
Hall.spawnFor = function (roomId: string, from: string | null) {
  var room = Hall.BY_ID[roomId];
  if (!room) return null;
  var s = (from && room.spawnAt && room.spawnAt[from]) || room.spawn;
  return { x: s.x, y: s.y };
};

/** 一间房里有哪些门/设施通向哪一屏（自检与界面共用一份读口） */
Hall.exits = function (roomId: string) {
  var room = Hall.BY_ID[roomId];
  var out: Array<{ id: string; screen: string; kind: string }> = [];
  if (!room) return out;
  for (var i = 0; i < room.spots.length; i++) {
    var s = room.spots[i];
    if (s.screen) out.push({ id: s.id, screen: s.screen, kind: s.kind });
  }
  return out;
};

/* =========================================================
   3. 定义期自检
   ---------------------------------------------------------
   每一条都对着一个**真实的静默故障**：
     · 墙的宽高写成 0 / 负数 → 那面墙不存在，人可以走进去（而且看不出来）
     · 出生点在墙里        → 一进大厅就被推出去，方向随机（取决于推出的顺序）
     · 站点摆进墙里        → 那道门永远走不到（提示圈被墙挡住）
     · 门表里的门没摆出来   → 玩家进不了那个模块，而界面上什么异常都没有
     · 摆出来的门不在门表里 → 走上去"什么也没发生"
     · 站点的 id 重复      → 提示会说两个名字，触发只认其中一个
     · `module` 与门表不一致 → **走进出击门去了养成模块**（最难查的一类）
   ========================================================= */
Hall.audit = function () {
  var problems: string[] = [];
  var seenRoom: Record<string, boolean> = Object.create(null);
  var i, j, k;

  for (i = 0; i < ROOMS.length; i++) {
    var room = ROOMS[i];
    if (!room.id) { problems.push('第 ' + i + ' 间房没有 id'); continue; }
    if (seenRoom[room.id]) problems.push('房间 id 重复：' + room.id);
    seenRoom[room.id] = true;
    if (!room.name) problems.push(room.id + ' 没有名字');
    if (!(room.w > Hall.WALL * 3) || !(room.h > Hall.WALL * 3)) {
      problems.push(room.id + ' 尺寸不合理：' + room.w + '×' + room.h);
    }

    for (j = 0; j < room.walls.length; j++) {
      var w = room.walls[j];
      if (!(w.w > 0) || !(w.h > 0)) {
        problems.push(room.id + ' 第 ' + j + ' 面墙的尺寸是 ' + w.w + '×' + w.h +
          '（零或负数的墙 = 不存在，人会直接走进去）');
      }
      if (w.x < 0 || w.y < 0 || w.x + w.w > room.w || w.y + w.h > room.h) {
        problems.push(room.id + ' 第 ' + j + ' 面墙伸到房间外面去了（' +
          w.x + ',' + w.y + ' ' + w.w + '×' + w.h + '）');
      }
    }

    var put = function (label, x, y, r) {
      if (!Hall.inside(room.id, x, y, 0)) {
        problems.push(room.id + ' 的' + label + '在房间外面（' + x + ',' + y + '）');
        return;
      }
      var hit = Hall.hitWall(room.id, x, y, r);
      if (hit) {
        problems.push(room.id + ' 的' + label + '压在墙里（' + x + ',' + y + '）—— 那它就永远走不到');
      }
    };
    put('出生点', room.spawn.x, room.spawn.y, Hall.R);
    if (room.spawnAt) {
      for (var key in room.spawnAt) {
        if (!Object.prototype.hasOwnProperty.call(room.spawnAt, key)) continue;
        var sa = room.spawnAt[key];
        put('回程落点「' + key + '」', sa.x, sa.y, Hall.R);
        /* 回程落点必须在**所有触发圈之外**：落在圈里 = 一回来就被再送出去。
           这一条实测过（第一版把落点写在了门心，表现是"从养成门回来立刻又进养成"）。 */
        for (k = 0; k < room.spots.length; k++) {
          var sp0 = room.spots[k];
          if (sp0.kind !== 'door' && sp0.kind !== 'portal' && sp0.kind !== 'device') continue;
          if (U.dist2(sa.x, sa.y, sp0.x, sp0.y) <= (sp0.r + Hall.R) * (sp0.r + Hall.R)) {
            problems.push(room.id + ' 的回程落点「' + key + '」站在「' + sp0.name +
              '」的触发圈里 —— 玩家一回来就会被立刻再送出去');
          }
        }
      }
    }

    var seenSpot: Record<string, boolean> = Object.create(null);
    for (j = 0; j < room.spots.length; j++) {
      var s = room.spots[j];
      if (!s.id) { problems.push(room.id + ' 第 ' + j + ' 个站点没有 id'); continue; }
      if (seenSpot[s.id]) problems.push(room.id + ' 的站点 id 重复：' + s.id);
      seenSpot[s.id] = true;
      if (!s.name) problems.push(room.id + '.' + s.id + ' 没有名字（提示里要念出来）');
      if (!(s.r > 0)) problems.push(room.id + '.' + s.id + ' 的半径不是正数');
      if (s.kind !== 'portal' && s.kind !== 'device' && s.kind !== 'npc' &&
        s.kind !== 'board' && s.kind !== 'door') {
        problems.push(room.id + '.' + s.id + ' 的 kind 认不出：' + s.kind);
      }
      /* 人用 E 说话（没有 screen 是正常的），但**必须指明是谁**；
         门 / 设施 / 门洞反过来：必须有去处，否则走上去什么也不会发生。 */
      if (s.kind !== 'board' && s.kind !== 'npc' && !s.screen) {
        problems.push(room.id + '.' + s.id + ' 没有去处（screen）—— 走上去什么也不会发生');
      }
      if (s.kind === 'npc' && !s.npc) {
        problems.push(room.id + '.' + s.id + ' 是个 NPC 站却没写是谁（按 E 没人开口）');
      }
      if (s.kind === 'board' && s.screen) {
        problems.push(room.id + '.' + s.id + ' 是公告板却有 screen（它不是门）');
      }
      put('站点「' + s.name + '」', s.x, s.y, 0);
    }
  }

  /* ---- 大厅 ⇄ 门表（`station.ts` 是唯一的一张）---- */
  var st = Hall.BY_ID.station;
  if (!st) {
    problems.push('没有大厅（station）这一间 —— 开局无路可走');
  } else {
    for (i = 0; i < Station.LIST.length; i++) {
      var site = Station.LIST[i];
      var mine = st.spots.filter(function (x) { return x.id === site.id; });
      if (mine.length !== 1) {
        problems.push('站点「' + site.name + '」在大厅里摆了 ' + mine.length +
          ' 个（门表里的每一站都该有且只有一个位置）');
        continue;
      }
      if (site.kind === 'portal') {
        if (mine[0].kind !== 'portal') {
          problems.push('站点「' + site.name + '」是门，摆出来的却是 ' + mine[0].kind);
        }
        if (mine[0].module !== site.to) {
          problems.push('站点「' + site.name + '」在门表里通向 ' + site.to +
            '，摆出来的那一站写着 ' + mine[0].module + '（走进门会去错模块）');
        }
      }
    }
    for (i = 0; i < st.spots.length; i++) {
      var sid = st.spots[i].id;
      if (sid === 'to-hub') continue;                      // 门洞不是模块（见下）
      if (!Station.BY_ID[sid]) {
        problems.push('大厅里摆着一个门表里没有的站点：' + sid + '（走上去什么也不会发生）');
      }
    }
    /* 枢纽门：它是**门洞**不是模块门 —— 枢纽也是局内的一间（见 station.ts 的文件头） */
    var hubDoor = st.spots.filter(function (x) { return x.id === 'to-hub'; });
    if (hubDoor.length !== 1) problems.push('大厅里通往枢纽的门洞有 ' + hubDoor.length + ' 个（该有且只有一个）');
    else if (hubDoor[0].screen !== 'hub') {
      problems.push('大厅通往枢纽的门洞写着 ' + hubDoor[0].screen + '，不是 hub');
    }
  }

  /* ---- 枢纽 ⇄ 剧情站表 ---- */
  var hub = Hall.BY_ID.hub;
  if (!hub) {
    problems.push('没有枢纽（hub）这一间');
  } else {
    for (i = 0; i < Story.STATIONS.length; i++) {
      var stn = Story.STATIONS[i];
      var found = hub.spots.filter(function (x) { return x.id === stn.id; });
      if (found.length !== 1) {
        problems.push('枢纽站点「' + stn.name + '」摆了 ' + found.length +
          ' 个位置（剧情站表里的每一站都该有且只有一个）');
        continue;
      }
      if (!!found[0].npc !== !!stn.npc) {
        problems.push('枢纽站点「' + stn.name + '」在剧情表里' + (stn.npc ? '有' : '没有') +
          '人，摆出来的一站却是' + (found[0].npc ? '「' + found[0].npc + '」' : '空的'));
      } else if (stn.npc && found[0].npc !== stn.npc) {
        problems.push('枢纽站点「' + stn.name + '」站的是 ' + found[0].npc +
          '，剧情表里写的是 ' + stn.npc);
      }
      /* 设施的去处**只认剧情表**：这里摆的 screen 是给画法用的副本，
         对不上就是"走上去进了另一个界面"。 */
      if (stn.screen && found[0].screen !== stn.screen) {
        problems.push('枢纽站点「' + stn.name + '」的去处在剧情表里是 ' + stn.screen +
          '，摆出来的是 ' + (found[0].screen || '（没写）'));
      }
    }
    for (i = 0; i < hub.spots.length; i++) {
      var hid = hub.spots[i].id;
      if (!Story.STATIONS.some(function (x) { return x.id === hid; })) {
        problems.push('枢纽里摆着一个剧情站表里没有的站点：' + hid);
      }
    }
    /* ⚠ 屋里**必须有路**：从门口走到每一站，都不该被墙切断。
       判据用一张粗网格做连通性（12px 格），比"看着像通的"可靠。 */
    var walk = Hall.reachable(hub);
    for (i = 0; i < hub.spots.length; i++) {
      if (!Hall.spotReachable(hub, hub.spots[i], walk)) {
        problems.push('枢纽的「' + hub.spots[i].name + '」被墙围住了 —— 走不到（连通性检查）');
      }
    }
  }
  if (st) {
    var walk2 = Hall.reachable(st);
    for (i = 0; i < st.spots.length; i++) {
      if (!Hall.spotReachable(st, st.spots[i], walk2)) {
        problems.push('大厅的「' + st.spots[i].name + '」被墙围住了 —— 走不到（连通性检查）');
      }
    }
    if (!walk2[gridKey(st.spawn.x, st.spawn.y)]) {
      problems.push('大厅的出生点站在走不到的地方（连通性检查）');
    }
  }

  return {
    ok: problems.length === 0, problems: problems,
    counts: {
      rooms: ROOMS.length,
      spots: ROOMS.reduce(function (a, r) { return a + r.spots.length; }, 0),
      walls: ROOMS.reduce(function (a, r) { return a + r.walls.length; }, 0)
    }
  };
};

/* ---- 连通性：一张粗网格上的洪水填充（12px 一格）----
   为什么值得写：房间是手写的，而"手写的东西会挡住路"这件事
   **肉眼看不出来** —— 少留一个口子，玩家就永远走不到记录墙，
   而所有别的自检都是绿的（墙是合法的、站点是合法的、就是过不去）。 */
var CELL = 12;
function gridKey(x: number, y: number) {
  return Math.floor(x / CELL) + ':' + Math.floor(y / CELL);
}
Hall.gridKey = gridKey;
/**
 * 从出生点洪水填充，返回"走得到"的格子集合（键 = `gridKey`）。
 * 判据是**圆能不能站在这里**（`Hall.hitWall`），所以它与真正的移动用同一套碰撞。
 */
Hall.reachable = function (room: HallRoomDef) {
  var open: Record<string, boolean> = Object.create(null);
  var seen: Record<string, boolean> = Object.create(null);
  var w = Math.ceil(room.w / CELL), h = Math.ceil(room.h / CELL);
  for (var iy = 0; iy < h; iy++) {
    for (var ix = 0; ix < w; ix++) {
      var x = ix * CELL + CELL / 2, y = iy * CELL + CELL / 2;
      if (!Hall.inside(room.id, x, y, Hall.R)) continue;
      if (Hall.hitWall(room.id, x, y, Hall.R)) continue;
      open[ix + ':' + iy] = true;
    }
  }
  var sx = Math.floor(room.spawn.x / CELL), sy = Math.floor(room.spawn.y / CELL);
  var queue: number[][] = [[sx, sy]];
  if (!open[sx + ':' + sy]) return seen;
  seen[sx + ':' + sy] = true;
  while (queue.length) {
    var cur = queue.pop() as number[];
    var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var d = 0; d < 4; d++) {
      var nx = cur[0] + dirs[d][0], ny = cur[1] + dirs[d][1];
      var k = nx + ':' + ny;
      if (!open[k] || seen[k]) continue;
      seen[k] = true;
      queue.push([nx, ny]);
    }
  }
  /* 站点是一个圆：只查圆心那一格会漏判（圆心在窄缝里、边上却走不到）。
     所以把站点半径内的**每一格**都算作"它可达"—— 只要有一格走得到，
     玩家就能走到它面前。 */
  return seen;
};

/**
 * 站点是否可达（把站点半径 + 提示距离内的**每一格**都算上）。
 * 只查圆心那一格是不够的：门口那两站就在墙的开口里，圆心本身落在
 * "圆站不进去"的位置上（36px 的墙 + 15px 的半径），而它们显然走得到 ——
 * 判据要问的是"玩家能不能站到它面前"，不是"它的圆心能不能站人"。
 * `seen` 可以传进来复用（自检里每间房只洪水填充一次）。
 */
Hall.spotReachable = function (room: HallRoomDef, spot: HallSpotDef, seen?: Record<string, boolean>) {
  seen = seen || Hall.reachable(room);
  var i, j;
  var pad = spot.r + Hall.REACH;
  for (i = -pad; i <= pad; i += CELL) {
    for (j = -pad; j <= pad; j += CELL) {
      if (i * i + j * j > pad * pad) continue;
      if (seen[gridKey(spot.x + i, spot.y + j)]) return true;
    }
  }
  return false;
};

SelfCheck.register('Hall', Hall.audit);

/* =========================================================
   4. 登记到扩展点总账
   ---------------------------------------------------------
   门洞里写着的去处在 `scene.ts` 那边校（它是唯一知道全部状态名的模块）——
   这里只登记"这一间里有什么"，于是 `Registry.audit()` 会替我们查
   "枢纽门指向的 hub 真的存在吗"这类跨表引用。
   ========================================================= */
Registry.family('hallRoom', {
  note: '可走的房间（大厅 / 枢纽）—— 墙、站点、出生点', owner: 'hall.ts',
  entries: function () {
    return ROOMS.map(function (r) {
      /* 房间 id 就是"进来的那一屏"；`spawnAt` 的键是"从哪一屏回来"——
         两者都进总账，于是"从一屏回来站在不存在的门口"这类错字会被抓住。 */
      var refs: Array<{ field: string; value: string; family: string }> =
        [{ field: 'state', value: r.id, family: 'state' }];
      for (var k in r.spawnAt) {
        if (!Object.prototype.hasOwnProperty.call(r.spawnAt, k)) continue;
        refs.push({ field: 'spawnAt.' + k, value: k, family: 'state' });
      }
      return {
        id: r.id,
        refs: refs
      };
    });
  }
});
Registry.family('hallSpot', {
  note: '房间里的站点（走上去的门 / 站在那儿的人 / 公告板）', owner: 'hall.ts',
  entries: function () {
    var out: Array<{ id: string; refs: Array<{ field: string; value: string; family: string }> }> = [];
    for (var i = 0; i < ROOMS.length; i++) {
      var r = ROOMS[i];
      for (var j = 0; j < r.spots.length; j++) {
        var s = r.spots[j];
        var refs: Array<{ field: string; value: string; family: string }> = [];
        /* 站的 id 可能是门表的站点（大厅）或剧情站表的站点（枢纽）——
           哪一种都登记，于是"摆了一个两边的表里都没有的站"会被总账抓住。 */
        if (Station.BY_ID[s.id]) refs.push({ field: 'site', value: s.id, family: 'stationSite' });
        if (Story.STATIONS.some(function (x) { return x.id === s.id; })) {
          refs.push({ field: 'storyStation', value: s.id, family: 'hubStation' });
        }
        if (s.screen) refs.push({ field: 'screen', value: s.screen, family: 'state' });
        out.push({ id: r.id + '.' + s.id, refs: refs });
      }
    }
    return out;
  }
});

export { Hall };
