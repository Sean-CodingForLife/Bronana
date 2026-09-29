/* =========================================================
   collide.ts — 碰撞体的形状与判定（纯数学，只依赖 utils）
   本作所有实体都是圆，但"圆"有两种用法，以前混在一起：
     · 静态重叠：两个圆当前是否相交（接触伤害、爆炸范围、分离力、范围查询）
     · 扫掠重叠：一个圆从 A 走到 B 的这一段路，有没有碰到谁
   只有前者时，判定只看"落点"。落点法的漏判是量出来的，不是猜的：
   最快武器 railgun 单步位移 36.7px，而判定阈值是 子弹r+6+怪r；
   当擦边距离落在 sqrt(阈值² - (步长/2)²) 与 阈值 之间时，线段两端都在
   圆外 → 整发子弹穿过去。实测 railgun 对 grub（阈值 33）的穿透带是
   d ∈ [28.5, 33]，共 5.6px；对更小的怪可到 9.1px。

   所以弹丸的碰撞体是"线段 + 半径"（胶囊），不是点。segCircle 返回首次
   接触的插值 t，穿透（pierce）要按 t 升序结算才符合直觉。
   ========================================================= */

import { U } from './utils.ts';

var Col = {} as ColApi;

/** 两个圆是否重叠（切点算重叠） */
Col.circle = function (ax, ay, ar, bx, by, br) {
  var rr = ar + br;
  return U.dist2(ax, ay, bx, by) <= rr * rr;
};

/** 点是否在圆内 */
Col.point = function (px, py, cx, cy, r) {
  return U.dist2(px, py, cx, cy) <= r * r;
};

/**
 * 线段 A→B 与圆 (cx,cy,r) 的首次接触。
 * @returns 接触处的插值 t ∈ [0,1]；不相交返回 -1。
 *          起点已经在圆内返回 0（"已经重叠"，不是"这一步碰到"）。
 */
Col.segCircle = function (ax, ay, bx, by, cx, cy, r) {
  var dx = bx - ax, dy = by - ay;
  var fx = ax - cx, fy = ay - cy;
  var c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0;                    // 起点已在圆内
  var a = dx * dx + dy * dy;
  if (a <= 1e-12) return -1;               // 退化线段 = 点，且点在圆外
  var b = 2 * (fx * dx + fy * dy);
  var disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  var t = (-b - Math.sqrt(disc)) / (2 * a);  // 近根 = 首次接触
  if (t < 0 || t > 1) return -1;
  return t;
};

/**
 * 覆盖线段 A→B（两端各外扩 pad）的包围圆。
 * 网格是按圆查的，用它把"线段的 AABB 覆盖"退化成一次圆查询：
 * 半径 = 半长 + pad，多查一点但不会漏。
 * @returns { x, y, r }（写入 out，避免每次分配）
 */
Col.segBounds = function (ax, ay, bx, by, pad, out) {
  out = out || { x: 0, y: 0, r: 0 };
  out.x = (ax + bx) * 0.5;
  out.y = (ay + by) * 0.5;
  var hx = (bx - ax) * 0.5, hy = (by - ay) * 0.5;
  out.r = Math.sqrt(hx * hx + hy * hy) + (pad || 0);
  return out;
};

export { Col };
