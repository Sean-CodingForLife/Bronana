/* =========================================================
   world.ts — **世界系统**（坐标 · 网格 · 区域）
   ---------------------------------------------------------
   用户的要求（2026-10-01）：

     「游戏里所有东西都是一个对象……而且不仅没有对象，也没有游戏引擎里的坐标，
       没有网格，没有每个对象的属性」
     「我在先设计开发一套原生游戏引擎和游戏系统，再在基础知识开发游戏，
       所以优秀的游戏引擎要有的，我的这个项目都要有」

   盘点（改造前是什么样）：这三样**都存在，但都是零件，不是系统** ——

     | 概念 | 改造前住在哪 | 问题 |
     | --- | --- | --- |
     | 世界尺寸 | `arena.ts` 的 1680×1260、`hall.ts` 的 1500×1120 | "这张地图多大"取决于问谁 |
     | 网格 | `game.ts` 的 `S.grid.cell = 68`、`hall.ts` 的 `CELL = 12` | 两个格子边长各写各的，没有一处能回答"这个项目有几套网格" |
     | 坐标系 | **没有任何一处写下来** | 原点是左上、y 朝下、单位是像素 —— 全项目都在用，却没有一条能引用的契约 |

   这个模块把它们收成**一条世界系统**：一份坐标契约 + 一张区域表 + 一张网格表。
   它是**纯数据 + 纯函数**：不认识会话、不认识渲染、不认识任何实体 ——
   所以它可以被模拟层、渲染层、工具链同时读，而不会引入任何一条向上的依赖边。

   ⚠ 与 `arena.ts` / `hall.ts` 的分工（别把它们混起来）：
     · `world.ts` 说"这块地多大、一格多宽、坐标怎么数" —— **尺寸的出处**
     · `arena.ts` 说"战场上长什么（岩石 / 白骨 / 裂纹）" —— 画法与装饰
     · `hall.ts` 说"这两间屋里墙摆在哪" —— 手写的几何
   尺寸与内容是两件事：把尺寸提上来之后，"同一间屋换个装饰"不会连带改玩法边界。
   ========================================================= */

import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';

var World = {} as WorldApi;

/* =========================================================
   1. 坐标契约（**唯一一处**）
   ---------------------------------------------------------
   这是全项目的坐标约定。它不是文档，是被自检守着的常量：
   任何地方要写"y 向下 / 单位是像素"这类话，都该引用这里而不是重写一遍。
   ========================================================= */
World.CONTRACT = {
  origin: '左上',
  yAxis: '向下',
  unit: 'px',
  note: '世界坐标：原点在左上角，y 轴向下，单位是像素（不是格）。相机与剔除都按这份契约算'
};

/* =========================================================
   2. 区域表（这个世界的三块地）
   ---------------------------------------------------------
   ⚠ 这三块地**同时存在于一局里**（不是三张地图的切换）：
   大厅与枢纽是手写的两间房，战场是每次换波重掷的地牢 —— 尺寸不同是有意的，
   而"不同在哪、谁说了算"以前没有一处能回答。

   `pad` = 边界内缩（角色不可越过的软边界）。大厅 / 枢纽的墙是**真碰撞体**，
   所以它们的 pad 是 0；战场没有墙，靠这条内缩把玩家关在场内。
   ========================================================= */
var ZONES: WorldZoneDef[] = [
  {
    id: 'arena', name: '战场',
    w: 1680, h: 1260, pad: 26,
    note: '出击门通向的地方：每波重掷的地牢房间，无墙，靠边界内缩把角色关在场内'
  },
  {
    id: 'station', name: '大厅',
    w: 1500, h: 1120, pad: 0,
    note: '这一局的起点 / 传送门房间：手写的房，四面是真墙，所以不需要软边界'
  },
  {
    id: 'hub', name: '枢纽',
    w: 1500, h: 1120, pad: 0,
    note: '这一局的家（NPC 那几站）。与大厅**同一房型**：两间房的墙坐标按同一套数写，' +
      '尺寸必须一致 —— 这一条由 hall.ts 的自检守着'
  }
];

var BY_ID: Record<string, WorldZoneDef> = Object.create(null);
for (var zi = 0; zi < ZONES.length; zi++) BY_ID[ZONES[zi].id] = ZONES[zi];

World.zones = function () { return ZONES.slice(); };
/** 取一块地（id 写错即抛错 —— 与 `Depth.band` 同一条纪律：静默兜底会让错字变成"尺寸为 0 的世界"） */
World.zone = function (id) {
  var z = BY_ID[id];
  if (!z) throw new Error('world: 没有这块地 ' + id);
  return z;
};
World.has = function (id) { return !!BY_ID[id]; };

/** 这块地有多大（`{ w, h }`） */
World.size = function (id) {
  var z = World.zone(id);
  return { w: z.w, h: z.h };
};

/** 世界坐标 → 夹到这块地的可站范围内（半径 r 的圆不许压到软边界上） */
World.clampTo = function (id, x, y, r) {
  var z = World.zone(id), pad = z.pad + (r || 0);
  return {
    x: Math.min(Math.max(x, pad), z.w - pad),
    y: Math.min(Math.max(y, pad), z.h - pad)
  };
};

/** 半径 r 的圆是不是整块都在这块地里 */
World.inside = function (id, x, y, r) {
  var z = World.zone(id), pad = z.pad + (r || 0);
  return x >= pad && x <= z.w - pad && y >= pad && y <= z.h - pad;
};

/* =========================================================
   3. 网格表（这个项目有几套网格）
   ---------------------------------------------------------
   "网格"在本作不是一个东西，是三个不同的东西 —— 名字写在一处，
   免得下次有人问"格子多大"时得到三个不同答案：

     · `spatial`  空间网格：范围查询用（一发子弹只看周围 9 格）。**边长 68**
     · `walk`     行走网格：大厅 / 枢纽的连通性洪水填充。**边长 12**
     · `tile`     瓦片：美术的自动规则瓦片（autotiling）。**边长 16**

   ⚠ 三者**互不换算**：空间网格是查询加速（对玩法透明），行走网格是可达性证明
   （大厅没有寻路，只有"走不走得到"），瓦片是画法。混用会让"改一格"变成"改一个玩法"。
   ========================================================= */
var GRIDS: WorldGridDef[] = [
  { id: 'spatial', cell: 68, note: '空间网格：子弹 / 近战 / 爆炸的范围查询（grid.ts）' },
  { id: 'walk', cell: 12, note: '行走网格：大厅 / 枢纽的可达性洪水填充（hall.ts 的自检）' },
  { id: 'tile', cell: 16, note: '瓦片：美术的自动规则瓦片（art_tiles.ts）' }
];
var GRID_BY_ID: Record<string, WorldGridDef> = Object.create(null);
for (var gi = 0; gi < GRIDS.length; gi++) GRID_BY_ID[GRIDS[gi].id] = GRIDS[gi];

World.grids = function () { return GRIDS.slice(); };
/** 取一套网格的格边长（id 写错即抛错） */
World.grid = function (id) {
  var g = GRID_BY_ID[id];
  if (!g) throw new Error('world: 没有这套网格 ' + id);
  return g.cell;
};

/** 世界坐标 → 格坐标（**向下取整**：负坐标也落在负格，不做夹取） */
World.cell = function (id, x, y) {
  var c = World.grid(id);
  return { cx: Math.floor(x / c), cy: Math.floor(y / c) };
};

/* =========================================================
   4. 定义期自检
   ---------------------------------------------------------
   判据只收"写错了一定会出事、而人眼看不出来"的那几条：
     · 区域 id / 网格 id 不许重名（重名 = 后者静默覆盖前者）
     · 软边界必须留在场地内（pad * 2 < 最短边），否则可站范围是负的
     · 格边长必须是正整数且能被世界尺寸整除的那一档（现在只查正整数的下界与上界）

   ⚠ **"尺寸没有被别处抄第二遍"这条不在本文件里** —— 它要靠静态检查
   （谁的源码里还写着裸数字），见 `test/world.mjs` [3] 那一节。
   ========================================================= */
World.audit = function () {
  var problems: string[] = [];
  var seenZ: Record<string, boolean> = Object.create(null);
  for (var i = 0; i < ZONES.length; i++) {
    var z = ZONES[i];
    if (!z.id || !z.name) problems.push('区域 #' + i + ' 缺 id / name');
    if (seenZ[z.id]) problems.push('区域 id 重名：' + z.id);
    seenZ[z.id] = true;
    if (!(z.w > 0) || !(z.h > 0)) problems.push('区域 ' + z.id + ' 的尺寸非法');
    if (!(z.pad >= 0)) problems.push('区域 ' + z.id + ' 的 pad 非法');
    if (!(z.pad * 2 < Math.min(z.w, z.h))) {
      problems.push('区域 ' + z.id + ' 的软边界吃掉了整块地（pad ' + z.pad + ' vs ' + z.w + '×' + z.h + '）');
    }
  }
  var seenG: Record<string, boolean> = Object.create(null);
  for (var g = 0; g < GRIDS.length; g++) {
    var gr = GRIDS[g];
    if (!gr.id) problems.push('网格 #' + g + ' 缺 id');
    if (seenG[gr.id]) problems.push('网格 id 重名：' + gr.id);
    seenG[gr.id] = true;
    /* 格子边长：太小 = 每帧建表爆炸；太大 = 范围查询退化成遍历。
       实测区间是 8~128 —— 下界取 8 而不是 16，因为行走网格（洪水填充）用的是 12：
       大厅最窄的缝是 36px 的墙留出的门洞，格子比它更粗就会把"过得去"判成"过不去"。 */
    if (!(gr.cell >= 8 && gr.cell <= 128)) problems.push('网格 ' + gr.id + ' 的格边长越界：' + gr.cell);
  }
  if (!(ZONES.length >= 3)) problems.push('这个世界的区域少于 3 块（战场 / 大厅 / 枢纽）');
  if (!World.CONTRACT.origin || !World.CONTRACT.yAxis || !World.CONTRACT.unit) {
    problems.push('坐标契约不完整');
  }
  return { ok: problems.length === 0, problems: problems, counts: { zones: ZONES.length, grids: GRIDS.length } };
};

if (!World.audit().ok) throw new Error('world 自检失败：\n' + World.audit().problems.join('\n'));
SelfCheck.register('World', World.audit);

/* =========================================================
   5. 登记进扩展点总账
   ========================================================= */
Registry.family('worldZone', {
  note: '世界区域（战场 / 大厅 / 枢纽：尺寸与软边界的**唯一出处**）', owner: 'world.ts',
  values: function () { return ZONES.map(function (z) { return z.id; }); }
});
Registry.family('worldGrid', {
  note: '网格表（空间查询 / 行走连通 / 美术瓦片：三套互不换算）', owner: 'world.ts',
  values: function () { return GRIDS.map(function (g) { return g.id; }); }
});

export { World };
