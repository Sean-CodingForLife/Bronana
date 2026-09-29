/* =========================================================
   art_tiles.ts — 瓦片集与**自动规则瓦片**（autotiling）
   ---------------------------------------------------------
   为什么需要这一层：在它之前，"地面长什么样"是**一支笔刷**——
   `render.ts` 的 `drawGroundStatic` 按 `patch` 数据一块一块地画椭圆与色块，
   拼不出"一堵墙""一片地砖"这种**由格子构成**的东西。
   于是画面里只有"笔触"，没有"结构"；而墙、门框、台阶、地砖
   这些东西的本质就是结构。

   这一层做三件事，每件都独立可测：

     ① **位掩码约定**（`MASK`）：一块瓦片的邻居长什么样。
        4 位 = 上下左右，**邻居同种地形就把那一位立起来**。
        16 种组合叫一个 mask，每块瓦片只认一个 mask —— 这是
        「自动规则瓦片」的全部内容（外部叫 blob / Wang / marching-squares，
        见 README「美术资源体系」那一节的取材）。
     ② **规则表**（`TILESETS`）：mask → 瓦片形状。
        一个瓦片集必须把 16 个 mask **填满** —— 漏一个的表现是
        "某种地形的接缝处突然没有瓦片"，而它不会报错，只会缺一块。
        这是本文件 `audit()` 最要紧的一条。
     ③ **算法**（`ArtTiles.autotile`）：给一张地形网格，
        算出每一格该用哪个 mask、该画在哪 —— 纯函数，能脱离渲染单测。

   纪律：**这里只有数据与纯函数，没有一行绘制代码。**
   瓦片画成什么样由 `render.ts` 决定（那是表现层的事），
   本层只负责"哪一格该是哪种形状"。于是改画法不会碰规则，
   改规则不会碰画法 —— 与 `curves.ts` / `affixes.ts` 同一条分层纪律。
   ========================================================= */
import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';
import { Art } from './art_spec.ts';

var ArtTiles = {} as ArtTilesApi;

/* =========================================================
   1. 位掩码约定
   ---------------------------------------------------------
   顺序（上 → 右 → 下 → 左）与 `Dungeon.DIRS` 一致 —— 项目里凡是
   "四个方向"都按这个顺序，多一处别处就得跟着换算，那正是错位 bug 的温床。
   `INV` 让"读某一位"不必在每处重新写 `1 << i`。
   ========================================================= */
ArtTiles.DIRS = ['N', 'E', 'S', 'W'];
ArtTiles.BIT = { N: 1, E: 2, S: 4, W: 8 };
ArtTiles.MASK_ALL = 15;

/** 反查：某一向是哪一位（与 DIRS 同序，读点不必自己算 1<<i） */
ArtTiles.BIT_OF_DIR = (function () {
  var m: Record<string, number> = Object.create(null);
  for (var i = 0; i < ArtTiles.DIRS.length; i++) m[ArtTiles.DIRS[i]] = 1 << i;
  return m;
})();

/* `[dx, dy]` —— 与 BIT_OF_DIR 同序（上右下左）。
   单独一张表而不是从 Dungeon.DIRS 引：本层在数据表之下，
   不为四行偏移量把地牢层拖进来（那会造出一条向上的边）。 */
ArtTiles.OFFSETS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** 掩码 → 人类可读的位串（`0b0101` → `'N.S.'`），报错信息里用它 */
ArtTiles.maskLabel = function (mask) {
  var s = '';
  for (var i = 0; i < 4; i++) s += (mask & (1 << i)) ? ArtTiles.DIRS[i] : '.';
  return s;
};

/** 掩码 → 形状名。**纯查表**（形状只有这 6 种可能，没有别的） */
ArtTiles.SHAPE_OF_MASK = [
  'isolated',   // 0
  'end',        // 1  N
  'end',        // 2  E
  'corner',     // 3  NE
  'end',        // 4  S
  'straight',   // 5  NS（竖）
  'corner',     // 6  SE
  'tee',        // 7  NES（缺西）
  'end',        // 8  W
  'corner',     // 9  NW
  'straight',   // 10 EW（横）
  'tee',        // 11 NEW（缺南）
  'corner',     // 12 SW
  'tee',        // 13 NSW（缺东）
  'tee',        // 14 ESW（缺北）
  'fill'        // 15 四面都有 —— 内部
];

/** 形状名 → 说明（界面与文档用；形状是"这块瓦片的接缝开在哪一边"） */
ArtTiles.SHAPES = [
  { id: 'fill', name: '实心', note: '四面都是同种地形 —— 地形内部，不需要接缝装饰' },
  { id: 'straight', name: '直段', note: '对边相连 —— 走廊 / 一段墙' },
  { id: 'end', name: '端头', note: '只有一边相连 —— 地形的尽头' },
  { id: 'corner', name: '转角', note: '相邻两边相连 —— 拐角' },
  { id: 'tee', name: '丁字', note: '三边相连 —— 岔口' },
  { id: 'isolated', name: '孤立', note: '四面都不相连 —— 一格大小的地形' }
];

ArtTiles.SHAPE_BY_ID = (function () {
  var m: Record<string, ArtShapeDef> = Object.create(null);
  for (var i = 0; i < ArtTiles.SHAPES.length; i++) m[ArtTiles.SHAPES[i].id] = ArtTiles.SHAPES[i];
  return m;
})();

/** 一个 mask 对应哪个形状（掩码只许 0..15） */
ArtTiles.shapeOfMask = function (mask) {
  var m = Number(mask);
  if (!(m >= 0 && m <= ArtTiles.MASK_ALL) || m !== Math.floor(m)) return '';
  return ArtTiles.SHAPE_OF_MASK[m];
};

/* =========================================================
   2. 瓦片集的声明
   ---------------------------------------------------------
   一个瓦片集 = 一批地形 + 每种地形一张 16 格的 mask 表。

   为什么 mask 表要**逐格写出来**而不是"按形状自动生成"：
   自动生成会让"某一种地形忘了做端头瓦片"变成静默的（生成器会
   随便挑一个塞进去）。逐格写出来，缺哪一格在数据上就看得见，
   `audit()` 于是能报出"mask 7 没有瓦片"。
   ========================================================= */
ArtTiles.TILESETS = [
  {
    id: 'dungeonStructure',
    name: '地牢结构',
    note: '战场边界与结构件：墙、门槛、台阶。**这一套是"结构"不是"地面"** —— 它决定画面里的硬边',
    tileSize: Art.SIZES.tile,
    tiles: [
      { id: 'wall_fill', shape: 'fill', note: '墙体内部（四面都是墙）' },
      { id: 'wall_straight', shape: 'straight', note: '一段直墙' },
      { id: 'wall_end', shape: 'end', note: '墙的端头（收口）' },
      { id: 'wall_corner', shape: 'corner', note: '墙角' },
      { id: 'wall_tee', shape: 'tee', note: '丁字墙' },
      { id: 'wall_isolated', shape: 'isolated', note: '孤立的墙垛' }
    ],
    /** mask → 瓦片 id。**16 格必须填满**（audit 会数） */
    mask: [
      'wall_isolated',    // 0
      'wall_end',         // 1
      'wall_end',         // 2
      'wall_corner',      // 3
      'wall_end',         // 4
      'wall_straight',    // 5
      'wall_corner',      // 6
      'wall_tee',         // 7
      'wall_end',         // 8
      'wall_corner',      // 9
      'wall_straight',    // 10
      'wall_tee',         // 11
      'wall_corner',      // 12
      'wall_tee',         // 13
      'wall_tee',         // 14
      'wall_fill'         // 15
    ],
    /** 画法参数：**色**由环境（层主题）给，这里只给"结构参数" */
    art: { edgeInset: 3, bevel: true, seam: true },
    /** 生产模块（资源归属：规范 → 内容的那条线） */
    owner: 'render.ts'
  },
  {
    id: 'ruinFloor',
    name: '废墟地砖',
    note: '地面上的破碎地砖区：给"平铺的地面"一点结构。地基仍是笔刷（环境条带），这一套叠在上面',
    /** 32 = 网格的 2 倍：**铺装是粗活**，一格 16px 的地砖在 1680×1260 的
     *  战场上会铺出近 8000 格，静态层烘焙直接翻三倍（实测 6.9 万笔）。
     *  粗一档之后格数降到约 1/4，而"残存铺装"的观感反而更像地砖。 */
    tileSize: 32,
    tiles: [
      { id: 'slab_fill', shape: 'fill', note: '完整地砖' },
      { id: 'slab_straight', shape: 'straight', note: '长条残砖' },
      { id: 'slab_end', shape: 'end', note: '残砖端头' },
      { id: 'slab_corner', shape: 'corner', note: '残砖转角' },
      { id: 'slab_tee', shape: 'tee', note: '残砖丁字' },
      { id: 'slab_isolated', shape: 'isolated', note: '单块碎砖' }
    ],
    mask: [
      'slab_isolated',    // 0
      'slab_end',         // 1
      'slab_end',         // 2
      'slab_corner',      // 3
      'slab_end',         // 4
      'slab_straight',    // 5
      'slab_corner',      // 6
      'slab_tee',         // 7
      'slab_end',         // 8
      'slab_corner',      // 9
      'slab_straight',    // 10
      'slab_tee',         // 11
      'slab_corner',      // 12
      'slab_tee',         // 13
      'slab_tee',         // 14
      'slab_fill'         // 15
    ],
    art: { edgeInset: 2, bevel: false, seam: true },
    owner: 'render.ts'
  }
];

ArtTiles.BY_ID = (function () {
  var m: Record<string, ArtTilesetDef> = Object.create(null);
  for (var i = 0; i < ArtTiles.TILESETS.length; i++) m[ArtTiles.TILESETS[i].id] = ArtTiles.TILESETS[i];
  return m;
})();

ArtTiles.get = function (id) { return id ? (ArtTiles.BY_ID[id] || null) : null; };

/* =========================================================
   3. 算法：一张地形网格 → 每一格该用哪块瓦片
   ---------------------------------------------------------
   `grid` 的行列约定：`grid[y][x]`，非 0 = 这一格属于本瓦片集的地形。
   **只有 0 / 非 0** —— 多地形（草地/石地/水）靠"多张 set"表达，
   而不是在一格里塞优先级：格子里塞不下两个地形，硬塞就得定优先级，
   而优先级是规则，不是数据（外部叫 terrain layer，见 README）。

   返回的每一项都是**画得出来的**：`{ x, y, tile, mask, shape }`，
   `x/y` 是**像素**（格子左上角），这样渲染层不必再乘一次 ——
   乘错一次就是整层偏移半个格子，而且看起来"只是有点歪"。
   ========================================================= */

/** 某一格是不是本瓦片集的地形（越界一律当作"不是"，于是边界自动收口） */
ArtTiles.solidAt = function (grid, x, y) {
  if (!grid || y < 0 || y >= grid.length) return false;
  var row = grid[y];
  if (!row || x < 0 || x >= row.length) return false;
  return !!row[x];
};

/** 某一格的四邻掩码（邻居同种地形 → 立起对应位） */
ArtTiles.maskAt = function (grid, x, y) {
  var mask = 0;
  for (var i = 0; i < 4; i++) {
    var ox = ArtTiles.OFFSETS[i][0], oy = ArtTiles.OFFSETS[i][1];
    if (ArtTiles.solidAt(grid, x + ox, y + oy)) mask |= (1 << i);
  }
  return mask;
};

/** mask → 瓦片 id（认不出的 mask 返回 ''，调用方据此跳过这一格） */
ArtTiles.tileFor = function (ts, mask) {
  if (!ts || !ts.mask) return '';
  var t = ts.mask[mask];
  return t || '';
};

/**
 * 自动规则瓦片：把网格摊成一张绘制清单。
 * @param setOrId 瓦片集（id 或定义本身）
 * @param grid    `grid[y][x]`，非 0 = 本瓦片集的地形
 * @param originX/originY 网格左上角在世界里的像素位置
 * @returns `{ set, tileSize, cells: [{x,y,gx,gy,mask,shape,tile}], counts }`
 */
ArtTiles.autotile = function (setOrId, grid, originX, originY) {
  var ts = typeof setOrId === 'string' ? ArtTiles.get(setOrId) : setOrId;
  var ox = Number(originX) || 0, oy = Number(originY) || 0;
  var out: ArtCell[] = [];
  var counts: Record<string, number> = Object.create(null);
  if (!ts || !grid) return { set: ts, tileSize: ts ? ts.tileSize : 0, cells: out, counts: counts };

  var size = ts.tileSize;
  for (var y = 0; y < grid.length; y++) {
    var row = grid[y];
    if (!row) continue;
    for (var x = 0; x < row.length; x++) {
      if (!row[x]) continue;
      var mask = ArtTiles.maskAt(grid, x, y);
      var tile = ArtTiles.tileFor(ts, mask);
      if (!tile) continue;                 // 规则表缺这一格：跳过而不是塞一个错的
      var shape = ArtTiles.shapeOfMask(mask);
      out.push({ x: ox + x * size, y: oy + y * size, gx: x, gy: y, mask: mask, shape: shape, tile: tile });
      counts[tile] = (counts[tile] || 0) + 1;
    }
  }
  return { set: ts, tileSize: size, cells: out, counts: counts };
};

/* =========================================================
   4. 规则表的构造工具（给调用方造网格用，也是"零依赖"的边界）
   ========================================================= */

/** 造一张全 0 的网格（宽高以**格**为单位） */
ArtTiles.blankGrid = function (w, h) {
  var g: number[][] = [];
  for (var y = 0; y < h; y++) {
    var row: number[] = [];
    for (var x = 0; x < w; x++) row.push(0);
    g.push(row);
  }
  return g;
};

/** 往网格里填一个矩形（含端点；越界自动裁） */
ArtTiles.fillRect = function (grid, x0, y0, x1, y1, v) {
  var val = v === undefined ? 1 : v;
  for (var y = y0; y <= y1; y++) {
    if (y < 0 || y >= grid.length) continue;
    for (var x = x0; x <= x1; x++) {
      if (x < 0 || x >= grid[y].length) continue;
      grid[y][x] = val;
    }
  }
  return grid;
};

/**
 * 在一个矩形区域里**撒**若干块连通的碎块（碎块是矩形的并集，
 * 于是每一块都有真实的转角与端头 —— 这正是 auto-tiling 想要的输入）。
 * `rnd` 是调用方给的随机流（本层不自己播种，否则没法复现）。
 */
ArtTiles.scatterBlobs = function (grid, w, h, count, rnd, sizeMin, sizeMax) {
  var lo = sizeMin === undefined ? 1 : sizeMin;
  var hi = sizeMax === undefined ? 3 : sizeMax;
  var made = 0, guard = 0;
  while (made < count && guard++ < count * 50) {
    var bw = lo + Math.floor(rnd() * (hi - lo + 1));
    var bh = lo + Math.floor(rnd() * (hi - lo + 1));
    var bx = Math.floor(rnd() * Math.max(1, w - bw));
    var by = Math.floor(rnd() * Math.max(1, h - bh));
    ArtTiles.fillRect(grid, bx, by, bx + bw - 1, by + bh - 1, 1);
    made++;
  }
  return grid;
};

/* =========================================================
   5. 定义期自检
   ========================================================= */
ArtTiles.audit = function () {
  var problems: string[] = [];

  /* ---- 位掩码约定自洽 ---- */
  if (ArtTiles.DIRS.length !== 4) problems.push('方向必须是 4 个（上下左右）');
  for (var d = 0; d < 4; d++) {
    if (ArtTiles.BIT[ArtTiles.DIRS[d]] !== (1 << d)) {
      problems.push('第 ' + d + ' 个方向 ' + ArtTiles.DIRS[d] + ' 的位不是 ' + (1 << d));
    }
    if (!ArtTiles.OFFSETS[d] || ArtTiles.OFFSETS[d].length !== 2) {
      problems.push('方向 ' + ArtTiles.DIRS[d] + ' 没有偏移量（算法会算错邻居）');
    }
  }
  if (ArtTiles.MASK_ALL !== 15) problems.push('mask 全域必须是 15（4 位）');
  if (ArtTiles.SHAPE_OF_MASK.length !== 16) problems.push('mask → 形状的表必须是 16 格');
  for (var m = 0; m < 16; m++) {
    if (!ArtTiles.SHAPE_BY_ID[ArtTiles.SHAPE_OF_MASK[m]]) {
      problems.push('mask ' + m + ' 的形状不在形状表里：' + ArtTiles.SHAPE_OF_MASK[m]);
    }
  }
  /* 形状必须**被真的用到**：声明了一种形状却没有任何 mask 映射到它 = 死内容 */
  var shapeUsed: Record<string, boolean> = Object.create(null);
  for (var s = 0; s < 16; s++) shapeUsed[ArtTiles.SHAPE_OF_MASK[s]] = true;
  for (var sh = 0; sh < ArtTiles.SHAPES.length; sh++) {
    if (!shapeUsed[ArtTiles.SHAPES[sh].id]) {
      problems.push('形状 ' + ArtTiles.SHAPES[sh].id + ' 没有任何 mask 映射到它（死内容）');
    }
  }
  /* 形状表自己不许重复 */
  var seenShape: Record<string, boolean> = Object.create(null);
  for (var sh2 = 0; sh2 < ArtTiles.SHAPES.length; sh2++) {
    var sid = ArtTiles.SHAPES[sh2].id;
    if (seenShape[sid]) problems.push('形状 id 重复：' + sid);
    seenShape[sid] = true;
    if (!ArtTiles.SHAPES[sh2].name || !ArtTiles.SHAPES[sh2].note) problems.push(sid + ' 缺少名字或说明');
  }

  /* ---- 瓦片集 ---- */
  var seenSet: Record<string, boolean> = Object.create(null);
  var seenTile: Record<string, boolean> = Object.create(null);
  var setCounts: Record<string, number> = Object.create(null);
  for (var t = 0; t < ArtTiles.TILESETS.length; t++) {
    var ts = ArtTiles.TILESETS[t];
    if (!ts.id) problems.push('第 ' + t + ' 个瓦片集没有 id');
    if (seenSet[ts.id]) problems.push('瓦片集 id 重复：' + ts.id);
    seenSet[ts.id] = true;
    if (!ts.name || !ts.note) problems.push(ts.id + ' 缺少名字或说明');
    if (!ts.owner) problems.push(ts.id + ' 没有归属模块（规范与内容之间的那条线断了）');

    /* 瓦片尺寸必须是**绘制网格的整数倍**（含 1 倍）—— 否则拼接处是半像素缝。
       为什么允许倍数而不是只许一种：**结构件与铺装本来就不该一样大**。
       墙是 16 的结构件（细），铺装是 32 的地砖（粗）。逼成同一个尺寸
       只会让其中一个难看；而"必须是网格的整数倍"这条**不会**被牺牲。 */
    if (!Art.tileDivides(ts.tileSize)) {
      problems.push(ts.id + ' 的瓦片尺寸不整除网格 ' + Art.SIZES.grid + '：' + ts.tileSize);
    }
    if (ts.tileSize < Art.SIZES.grid) {
      problems.push(ts.id + ' 的瓦片比绘制网格还小：' + ts.tileSize + ' < ' + Art.SIZES.grid);
    }

    /* 瓦片清单 */
    var localTile: Record<string, ArtTileDef> = Object.create(null);
    for (var i = 0; i < (ts.tiles || []).length; i++) {
      var td = ts.tiles[i];
      if (!td.id) problems.push(ts.id + ' 的第 ' + i + ' 块瓦片没有 id');
      if (seenTile[td.id]) problems.push('瓦片 id 跨集重复（绘制分支会撞车）：' + td.id);
      seenTile[td.id] = true;
      localTile[td.id] = td;
      if (!ArtTiles.SHAPE_BY_ID[td.shape]) problems.push(ts.id + '.' + td.id + ' 的形状不认识：' + td.shape);
      if (!td.note) problems.push(ts.id + '.' + td.id + ' 没有说明');
      /* 每一块瓦片都必须被 mask 表用到 —— 否则它是一张永远不画的图 */
      if ((ts.mask || []).indexOf(td.id) < 0) {
        problems.push(ts.id + '.' + td.id + ' 没有任何 mask 用它（永远画不到的瓦片）');
      }
    }
    /* 瓦片数量：6 种形状各一块是最低要求 */
    if ((ts.tiles || []).length < 6) problems.push(ts.id + ' 的瓦片少于 6 块（6 种形状各一块是下限）');

    /* mask 表：**16 格必须填满**，且指到的瓦片必须存在 */
    if (!ts.mask || ts.mask.length !== 16) {
      problems.push(ts.id + ' 的 mask 表不是 16 格（现在是 ' + (ts.mask ? ts.mask.length : 0) + '）—— 漏掉的格子会长不出瓦片');
    } else {
      for (var mk = 0; mk < 16; mk++) {
        var tid = ts.mask[mk];
        if (!tid) { problems.push(ts.id + ' 的 mask ' + mk + '（' + ArtTiles.maskLabel(mk) + '）没有瓦片'); continue; }
        if (!localTile[tid]) problems.push(ts.id + ' 的 mask ' + mk + ' 指向了不存在的瓦片：' + tid);
        else {
          /* 形状必须与 mask 对得上 —— 对不上的表现是"转角画成了直段"，
             而它**看起来只是有点怪**，不会报错。这是本表最容易写错的一格。 */
          var wantShape = ArtTiles.shapeOfMask(mk);
          if (localTile[tid].shape !== wantShape) {
            problems.push(ts.id + ' 的 mask ' + mk + '（' + ArtTiles.maskLabel(mk) + '）应当是「' + wantShape +
              '」形状，却指向了「' + localTile[tid].shape + '」的 ' + tid);
          }
        }
      }
    }

    /* 画法参数：只许声明"结构"参数，色由环境给 */
    var art = ts.art || ({} as ArtTilesetDef['art']);
    if (art.edgeInset === undefined) problems.push(ts.id + ' 没有声明 edgeInset（接缝内缩量）');
    else if (!(art.edgeInset >= 0)) problems.push(ts.id + ' 的 edgeInset 必须是 ≥ 0 的数');
    if (art.bevel === undefined) problems.push(ts.id + ' 没有声明 bevel（立体边）');
    if (art.seam === undefined) problems.push(ts.id + ' 没有声明 seam（接缝）');

    /* 资源规范：瓦片集必须过 art_spec 的那把尺子 */
    var lint = Art.lintAsset({
      name: 'TILE_' + ts.id.charAt(0).toUpperCase() + ts.id.slice(1),
      kind: 'tileset', w: ts.tileSize, h: ts.tileSize, anchor: 'tile'
    });
    if (!lint.ok) problems.push(ts.id + ' 过不了美术规范检查：' + lint.problems.join(' / '));

    setCounts[ts.id] = (ts.tiles || []).length;
  }
  if (ArtTiles.TILESETS.length < 2) {
    problems.push('瓦片集少于 2 套：结构（墙）与地面（地砖）是两类不同的东西，塞进一套会互相污染形状表');
  }

  return {
    ok: problems.length === 0, problems: problems,
    counts: { sets: ArtTiles.TILESETS.length, shapes: ArtTiles.SHAPES.length, tiles: Object.keys(seenTile).length }
  };
};

var verdict = ArtTiles.audit();
if (!verdict.ok) throw new Error('art_tiles.ts 瓦片表自检失败：\n' + verdict.problems.join('\n'));
SelfCheck.register('ArtTiles', ArtTiles.audit);

/* 登记到扩展点总账：地形 / 形状 / 瓦片集三张表互相引用，
   写错一个名字的表现是"那一片地形长不出瓦片"，不报错。 */
Registry.family('terrain', {
  note: '地形（自动规则瓦片的"哪一种地面"；一个瓦片集至少一种）', owner: 'art_tiles.ts',
  entries: function () {
    return ArtTiles.TILESETS.map(function (d) { return { id: d.id, refs: [] }; });
  }
});
Registry.family('tileShape', {
  note: '瓦片形状（由 mask 唯一决定：实心/直段/端头/转角/丁字/孤立）', owner: 'art_tiles.ts',
  values: function () { return ArtTiles.SHAPES.map(function (d) { return d.id; }); }
});

/* 资源归属：本模块与它声明的生产模块各登记一次。
   `tileset` 这一类**规范在本文件、生产在渲染层** —— 一条资源两类贡献者，
   所以 `ownersOf('tileset')` 会返回两个名字：数据产地与绘制产地。
   只登记一个的话，`pnpm run art` 会把"有人定义没人画"报成"有人在画"。 */
Art.noteOwner('tileset', 'art_tiles.ts');
for (var oi = 0; oi < ArtTiles.TILESETS.length; oi++) {
  if (ArtTiles.TILESETS[oi].owner) Art.noteOwner('tileset', ArtTiles.TILESETS[oi].owner);
}

export { ArtTiles };
