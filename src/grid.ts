/* =========================================================
   grid.ts — **空间网格**（子弹 / 近战 / 爆炸的范围查询）
   ---------------------------------------------------------
   这一块原先住在 `game.ts` 里（那个文件 3700 行、116 个顶层函数）。
   拆出来的理由不是"看起来整齐"，而是它**内聚得可以单独说清楚**：

     · 它做的事只有一件：把"敌人现在在哪"编进一张格子表，
       然后回答"以 (x, y) 为心、r 为半径，圈里有谁"。
     · 它**不认识**武器、伤害、波次、渲染 —— 只认识 `S.enemies` 与一格格子。
     · 它的性能约束是"每帧不分配数组"，所以缓冲区是模块级复用的
       （`queryCircle(x, y, r, out)` 的 `out` 参数就是为此存在）。

   **为什么用 `make(ctx)` 而不是直接 import `game.ts` 的 `S`**：
   反过来依赖（`grid.ts` → `game.ts`）会让这条边看着像"网格依赖模拟内核"，
   而实际上它只依赖**会话数据**。注入之后依赖是单向的
   （`game.ts` → `grid.ts`），分层表能算对，而本模块也不认识 `Game` 这个名字。
   ⚠ `session()` 是**函数**而不是一个会话对象：换局之后 `S` 会被整体替换，
   存一个快照就会对着上一局的敌人做查询。

   空间网格本身的意义（为什么不能"每发子弹遍历所有敌人"）：
   300 只怪 × 每秒上百次查询 = 每帧三万次距离判定。分格之后一次查询只看
   9 个格子里的那几个。`test/perf.mjs` 的 300 怪场景量的就是它。

   =========================================================
   ⚠ **2026-10-01 重写：字符串键 → 整数键 + 扁平 `Int32Array`（R57 第 1 步）**
   ---------------------------------------------------------
   改造前这里用**字符串**当格子键：

       function gridKey(cx, cy) { return cx + ',' + cy; }      // ← 每次查一格新建一个字符串

   而 `queryCircle` 每次要遍历 (2r/cell+1)² 个格子，每格**新建一个字符串**再当
   哈希键去查普通对象 —— 于是每帧都在制造垃圾 + 走一次字符串哈希。

   **实测（CPU profiler，300 怪压力场景）**：改造前 `grid.ts` 占模拟层
   **56.8%** 的 CPU（`queryCircle` 43.4% + `rebuild` 13.4%）。
   **原型 A/B**：同一批敌人、同一批查询，"整数键 + 扁平 `Int32Array`"比
   "字符串键 + 普通对象"**快 4.64×**（7.70ms → 1.66ms）。

   ⇒ 结论（写在 `docs/requirements.md` 的 R57 里）：**那是数据结构问题，
   不是"JS 算力不够"**。所以这一版先拿到这笔收益，而 WASM 的评估基准
   从此是**这一版**，不是改造前那一版。

   ## 现在的数据结构（三块 TypedArray + 计数/前缀和/填充）

       ENEMY_CELL[i]   第 i 个敌人所在格（-1 = 跳过）
       CELL_N[c]       第 c 格有几个（rebuild 时先清零再统计）
       CELL_START[c]   第 c 格在 `CELL_ITEMS` 里的起始下标（前缀和）
       CELL_ITEMS[k]   按格分组的**敌人下标**（没有嵌套数组）
       CELL_WP[c]      填充用的写指针（**与 CELL_N 分开** —— 见下面的坑）

   查询时 `[CELL_START[c], CELL_START[c] + CELL_N[c])` 就是这一格的成员区间，
   **没有一次字符串操作、没有一次数组分配**。

   ### 两个真踩过的坑（都写在这里，免得下一个人重踩）

   1. **写指针不能复用 `CELL_N`**。第一版为了省一个数组，填完前缀和之后把
      `CELL_N` 就地当写指针使 —— 但查询时还要用 `CELL_N` 读"每格几个"，
      于是读到的是**被写坏的值**。改成独立的 `CELL_WP` 之后数字才对。
   2. **敌人可以跑到世界之外**（击退 / 冲撞），所以格子坐标必须**夹取**，
      否则下标为负会静默写到 `Int32Array` 的范围之外（写不进去、查询却按
      错位的下标读 → **查得到不存在的敌人**，比崩掉更难查）。
   ========================================================= */
import { World } from './world.ts';

/** `game.ts` 注入的能力（本模块不认识 `Game`） */
export interface GridCtx {
  /** 当前会话（**每次调用现取**：换局之后对象就换了）。
   *  ⚠ 格边长是 **`grid.cell`**，不是顶层 `cell`。第一版我在这里写成顶层
   *  `cell: number`，于是**声明与实现一起错**、`tsc` 没有对手可拦 ——
   *  而运行时 `s.cell` 恒为 `undefined` ⇒ 网格尺寸全 `NaN` ⇒
   *  **每一次范围查询返回 0 个目标**（游戏能跑、但不造成伤害）。
   *  写类型时要么对着真会话抄，要么就别写窄 —— 写窄了自己就成了"另一个真相"。 */
  session(): { grid: { cell: number }; enemies: Enemy[] };
  /** 网格覆盖的世界区域 id（读 `world.ts` 的区域表 —— 尺寸的唯一出处） */
  zone?: string;
}

/** 一格的键（**给测试与调试用的人类可读形式**）。
 *  ⚠ 它**不再是**热点路径上的哈希键 —— 那条路径走整数下标 `cy * CX + cx`。 */
export function gridKey(cx: number, cy: number) {
  return cx + ',' + cy;
}

export function makeGrid(ctx: GridCtx) {
  var Grid = {} as GridApi;

  /* 网格尺寸：从**世界区域表**算（`world.ts` 是尺寸的唯一出处） */
  var zoneId = ctx.zone || 'arena';
  var zone = World.zone(zoneId);
  var cell = 0;                 /* 每次 rebuild 现读（会话可能换） */
  var CX = 0, CY = 0;

  /* 缓冲区：按需增长（`N = 敌人数的上界`） */
  var N = 0;
  var ENEMY_CELL = new Int32Array(0);
  var CELL_ITEMS = new Int32Array(0);
  var CELL_N = new Int32Array(0);
  var CELL_START = new Int32Array(0);
  var CELL_WP = new Int32Array(0);

  /** 兼容读口：`{ 'cx,cy': 格内数量 }`。
   *  ⚠ 它不是主路径 —— `test/smoke.mjs` 数过 `Object.keys(s.grid.map).length`，
   *  而那是"每格几个"的合法问法，所以留一个**惰性构建**的视图，
   *  而不是让测试去认识 `Int32Array`。每次 `rebuild` 让它失效。 */
  var mapView: Record<string, number> | null = null;

  /** 上一次见到的会话对象。
   *  ⚠ **换局必须整体重建**：`game.ts` 的 `newRun()` 是把 `S` 换成一个新对象，
   *  而本模块的缓冲区（尺寸 / 前缀和 / 成员表）都挂在会话之外。只比"格边长变了没变"
   *  是不够的 —— 换局时格边长往往**一样**，于是旧会话的前缀和会被新会话的敌人用到
   *  （实测表现：换局后第一帧的查询返回**上一局的**结果）。
   *  所以判据是**对象身份**，不是任何一个字段的值。 */
  var lastSession: unknown = null;

  function ensure(nEnemies: number) {
    var s = ctx.session();
    if (s !== lastSession) {
      /* 新会话（或第一次）：尺寸重算、缓冲区丢弃 —— 一切从头来 */
      lastSession = s;
      /* ⚠ 格边长住在 **`s.grid.cell`**，不是 `s.cell`。
         第一版我写成 `s.cell` —— 它永远是 `undefined`，于是
         `cell`/`CX`/`CY` 全变 `NaN`、`cellIndex` 全返回 `NaN`、
         前缀和全空、**每一次范围查询都返回 0 个目标**。
         而它的表现是"游戏能跑、但不造成伤害" —— 最坏的一类 bug：
         不抛异常、不崩、**只是静默地什么都不发生**。
         （这也是 `tsc` 该拦住的那类：`session()` 的返回类型里没写 `cell`，
         而 `GridCtx` 的声明恰恰是我自己写错的那一份 —— 声明与实现一起错，
         类型检查就没有对手了。） */
      cell = s.grid.cell;
      CX = Math.ceil(zone.w / cell);
      CY = Math.ceil(zone.h / cell);
      N = 0;
      CELL_N = new Int32Array(CX * CY + 1);
      CELL_START = new Int32Array(CX * CY + 1);
      CELL_WP = new Int32Array(CX * CY + 1);
      mapView = null;
    }
    if (nEnemies <= N && CELL_START.length === CX * CY + 1) return;
    N = Math.max(nEnemies, 16);
    ENEMY_CELL = new Int32Array(N);
    CELL_ITEMS = new Int32Array(N);
    CELL_N = new Int32Array(CX * CY + 1);
    CELL_START = new Int32Array(CX * CY + 1);
    CELL_WP = new Int32Array(CX * CY + 1);
    mapView = null;
  }

  function cellIndex(x: number, y: number) {
    var cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    /* **夹取**（见上面第 2 个坑）：越界不属于任何格，归到最近的边界格上 */
    if (cx < 0) cx = 0; else if (cx >= CX) cx = CX - 1;
    if (cy < 0) cy = 0; else if (cy >= CY) cy = CY - 1;
    return cy * CX + cx;
  }

  /**
   * 重建整张表（每次"敌人动了"之后调一次，不是每发子弹调一次）。
   *
   * 三段：**计数 → 前缀和 → 填充**。全程只用 TypedArray 与整数，
   * 没有字符串、没有嵌套数组、没有每帧新建的对象 ——
   * 而这三样正是改造前那 56.8% 的 CPU 花掉的地方。
   */
  Grid.rebuild = function () {
    var s = ctx.session();
    var list = s.enemies;
    ensure(list.length);

    var nCells = CX * CY;
    var i, c;

    /* ① 清零 + 计数 */
    CELL_N.fill(0, 0, nCells + 1);
    for (i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.dead) { ENEMY_CELL[i] = -1; continue; }
      c = cellIndex(e.x, e.y);
      ENEMY_CELL[i] = c;
      CELL_N[c]++;
    }

    /* ② 前缀和：`CELL_START[c]` = 第 c 格的起始下标 */
    var acc = 0;
    for (c = 0; c < nCells; c++) { CELL_START[c] = acc; acc += CELL_N[c]; }
    CELL_START[nCells] = acc;

    /* ③ 填充：写指针从每格的起点出发（**独立数组**，见坑 1） */
    for (c = 0; c < nCells; c++) CELL_WP[c] = CELL_START[c];
    for (i = 0; i < list.length; i++) {
      c = ENEMY_CELL[i];
      if (c < 0) continue;
      CELL_ITEMS[CELL_WP[c]++] = i;
    }
    mapView = null;
  };

  /**
   * `以 (x,y) 为心、r 为半径`圈内的活敌人。
   * @param out 复用的输出数组（省略则新建）。**会先清空它** ——
   *   半个"追加"语义会让调用方拿到上一次的结果混在里面。
   */
  Grid.queryCircle = function (x, y, r, out?) {
    out = out || [];
    out.length = 0;
    if (!CX) return out;                     /* 还没 rebuild 过 */
    var s = ctx.session();
    var list = s.enemies;

    var x0 = Math.floor((x - r) / cell), x1 = Math.floor((x + r) / cell);
    var y0 = Math.floor((y - r) / cell), y1 = Math.floor((y + r) / cell);
    /* 查询范围也夹取（世界之外的查询没有意义，而越界下标是未定义行为） */
    if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0;
    if (x1 >= CX) x1 = CX - 1; if (y1 >= CY) y1 = CY - 1;

    for (var cx = x0; cx <= x1; cx++) {
      for (var cy = y0; cy <= y1; cy++) {
        var c = cy * CX + cx;
        var from = CELL_START[c], to = from + CELL_N[c];
        for (var k = from; k < to; k++) {
          var e = list[CELL_ITEMS[k]];
          /* `dead` 在 rebuild 时已经滤过，但 rebuild 与查询之间可能有怪死掉 */
          if (!e || e.dead) continue;
          /* 用 `dist2` 而不是 `dist`：开方既慢又没必要 ——
             比较"距离 ≤ r"与比较"距离² ≤ r²"是同一件事。 */
          var rr = r + e.r;
          var dx = x - e.x, dy = y - e.y;
          if (dx * dx + dy * dy <= rr * rr) out.push(e);
        }
      }
    }
    return out;
  };

  /** 每格几个（**惰性视图**，给测试与调试用；主路径不碰它） */
  Grid.cellCounts = function () {
    if (mapView) return mapView;
    mapView = {};
    var nCells = CX * CY;
    for (var c = 0; c < nCells; c++) {
      if (!CELL_N[c]) continue;
      mapView[gridKey(c % CX, Math.floor(c / CX))] = CELL_N[c];
    }
    return mapView;
  };

  /** 网格账目（诊断面板 / 测试用） */
  Grid.stats = function () {
    var used = 0, max = 0;
    for (var c = 0; c < CX * CY; c++) { if (CELL_N[c]) { used++; if (CELL_N[c] > max) max = CELL_N[c]; } }
    return { cx: CX, cy: CY, cells: CX * CY, used: used, maxPerCell: max, cell: cell, zone: zoneId };
  };

  return Grid;
}
