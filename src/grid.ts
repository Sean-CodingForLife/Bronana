/* =========================================================
   grid.ts — **空间网格**（子弹 / 近战 / 爆炸的范围查询）
   ---------------------------------------------------------
   这一块原先住在 `game.ts` 里（那个文件 3700 行、116 个顶层函数）。
   拆出来的理由不是"看起来整齐"，而是它**内聚得可以单独说清楚**：

     · 它做的事只有一件：把"敌人现在在哪"编进一张格子表，
       然后回答"以 (x, y) 为心、r 为半径，圈里有谁"。
     · 它**不认识**武器、伤害、波次、渲染 —— 只认识 `S.enemies` 与 `S.grid`。
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
   ========================================================= */
import { U } from './utils.ts';

/** `game.ts` 注入的能力（本模块不认识 `Game`） */
export interface GridCtx {
  /** 当前会话（**每次调用现取**：换局之后对象就换了） */
  session(): { grid: { cell: number; map: Record<string, Enemy[]> }; enemies: Enemy[] };
}

/** 一个格子的键。**唯一实现** —— 建表与查表用同一处，否则改一格就静默查不到 */
export function gridKey(cx: number, cy: number) {
  return cx + ',' + cy;
}

export function makeGrid(ctx: GridCtx) {
  var Grid = {} as GridApi;

  /**
   * 重建整张表（每次"敌人动了"之后调一次，不是每发子弹调一次）。
   * 复用单元格数组：`map[k].length = 0` 而不是新建 —— 每帧重建上百个小数组
   * 是 GC 尖峰的典型来源，而尖峰在 300 怪场景里表现为**偶发掉帧**，
   * 比"平均慢一点"难查得多。
   */
  Grid.rebuild = function () {
    var S = ctx.session();
    var g = S.grid, cell = g.cell, map = g.map, k;
    for (k in map) map[k].length = 0;
    for (var i = 0; i < S.enemies.length; i++) {
      var e = S.enemies[i];
      if (e.dead) continue;
      k = gridKey(Math.floor(e.x / cell), Math.floor(e.y / cell));
      var arr = map[k];
      if (!arr) arr = map[k] = [];
      arr.push(e);
    }
  };

  /**
   * `以 (x,y) 为心、r 为半径`圈内的活敌人。
   * @param out 复用的输出数组（省略则新建）。**会先清空它** ——
   *   半个"追加"语义会让调用方拿到上一次的结果混在里面。
   */
  Grid.queryCircle = function (x, y, r, out?) {
    out = out || [];
    out.length = 0;
    var S = ctx.session();
    var g = S.grid, cell = g.cell;
    var x0 = Math.floor((x - r) / cell), x1 = Math.floor((x + r) / cell);
    var y0 = Math.floor((y - r) / cell), y1 = Math.floor((y + r) / cell);
    for (var cx = x0; cx <= x1; cx++) {
      for (var cy = y0; cy <= y1; cy++) {
        var arr = g.map[gridKey(cx, cy)];
        if (!arr) continue;
        for (var i = 0; i < arr.length; i++) {
          var e = arr[i];
          if (e.dead) continue;
          /* 用 `dist2` 而不是 `dist`：开方既慢又没必要 ——
             比较"距离 ≤ r"与比较"距离² ≤ r²"是同一件事。 */
          var rr = r + e.r;
          if (U.dist2(x, y, e.x, e.y) <= rr * rr) out.push(e);
        }
      }
    }
    return out;
  };

  return Grid;
}
