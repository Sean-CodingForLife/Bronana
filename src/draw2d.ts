/* =========================================================
draw2d.ts — 美术宪法执行层
所有绘制入口：粗黑外轮廓 + 纯色平涂
本文件不提供任何渐变 / 阴影 / 模糊 / 贴图 API（有意为之）
========================================================= */

import { PAL, U } from './utils.ts';
var OUT = 3;             // 标准外轮廓线宽

/* ================= 基础 ================= */
function ctxOf(c) {
  if (!c) return null;
  var x = (c.getContext ? c.getContext('2d') : c);
  if (x) { x.lineJoin = 'round'; x.lineCap = 'round'; }
  return x;
}

function col(x) { return (x === undefined || x === null) ? PAL.INK : x; }
function lw(x) { return (x === undefined || x === null) ? OUT : x; }

function ink(x, color, width) {
  if (!width) return;                 // width<=0 → 不描边
  x.strokeStyle = col(color);
  x.lineWidth = width;
  x.stroke();
}

function fill(x, color) {
  if (!color) return;                 // null 色 → 只画轮廓（镂空）
  x.fillStyle = color;
  x.fill();
}

/* ================= 路径生成 ================= */
function polyPath(x, pts, close) {
  x.beginPath();
  if (!pts || !pts.length) return;
  x.moveTo(pts[0][0], pts[0][1]);
  for (var i = 1; i < pts.length; i++) x.lineTo(pts[i][0], pts[i][1]);
  if (close !== false) x.closePath();
}

/**
 * 钝圆多边形：把折线边向外圆角化（Bronana 圆润笨拙感）
 */
function blobPath(x, pts, r, close) {
  var n = pts.length;
  if (n < 2) return;
  if (close === undefined) close = true;
  if (r <= 0) { polyPath(x, pts, close); return; }

  var P = pts.slice();
  if (close) P.push(pts[0]);
  var ends = close ? n : n - 1;
  var start = [0, 0];

  // 计算每段起终点，段间用二次曲线倒圆
  var segs = [];
  for (var i = 0; i < ends; i++) {
    var a = P[i], b = P[i + 1];
    var dx = b[0] - a[0], dy = b[1] - a[1];
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var rr = Math.min(r, len * 0.45);
    segs.push({
      a: a, b: b,
      s: [a[0] + dx / len * rr, a[1] + dy / len * rr],
      e: [b[0] - dx / len * rr, b[1] - dy / len * rr]
    });
  }

  x.beginPath();
  x.moveTo(segs[0].s[0], segs[0].s[1]);
  for (var k = 0; k < segs.length; k++) {
    var sg = segs[k];
    x.lineTo(sg.e[0], sg.e[1]);
    var nx = segs[(k + 1) % segs.length];
    if (k + 1 < segs.length || close) x.quadraticCurveTo(sg.b[0], sg.b[1], nx.s[0], nx.s[1]);
  }
  if (close) x.closePath();
}

/**
 * 豆豆形轮廓：圆润饱满、略扁、底部两瓣
 * 用平滑谐波生成，天然带手绘笨拙感且逐帧稳定
 */
function bronanaPath(x, rx, ry, seed, bump) {
  var N = 30, pts = [], i;
  bump = bump === undefined ? 0.055 : bump;
  for (i = 0; i < N; i++) {
    var t = i / N * U.TAU;
    var w = 1
      + Math.sin(t * 2 + seed * 1.7) * bump * 0.9
      + Math.sin(t * 3 - seed * 2.3) * bump * 0.55
      + Math.sin(t * 5 + seed * 0.9) * bump * 0.3;
    var yy = 1;
    // 底部略宽（豆豆坐地感）
    if (Math.cos(t) > 0) yy *= 1 + (Math.cos(t) * 0.06);
    pts.push([Math.cos(t) * rx * w, Math.sin(t) * ry * w * yy]);
  }
  x.beginPath();
  x.moveTo(pts[0][0], pts[0][1]);
  for (i = 1; i < N; i++) x.lineTo(pts[i][0], pts[i][1]);
  x.closePath();
}

/** 星形路径（尖刺怪、爆炸） */
function starPath(x, spikes, rOut, rIn, rot) {
  x.beginPath();
  for (var i = 0; i < spikes * 2; i++) {
    var r = (i % 2 === 0) ? rOut : rIn;
    var a = rot + i / (spikes * 2) * U.TAU;
    var px = Math.cos(a) * r, py = Math.sin(a) * r;
    if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
  }
  x.closePath();
}

/* ================= 绘制原语 ================= */
var D = {} as DrawApi;

D.OUT = OUT;
D.ink = ink;
D.fill = fill;
D.bronanaPath = bronanaPath;
D.starPath = starPath;

/**
 * 共享选项常量（**只读，任何代码都不得修改**）。
 * 渲染热路径里 D.circle(x, y, r, color, {outlineWidth: 0}) 这类字面量
 * 每帧会产生上千次对象分配（实测峰值 461 个/帧 ≈ 每秒 2.7 万次）。
 * 统一改用这里的常量后，分配数降到个位数。
 */
var O = {
  none:  { outlineWidth: 0 },                        // 只填充，不描边
  empty: {},                                         // 全部使用默认参数
  ink15: { outline: PAL.INK, outlineWidth: 1.5 },
  ink16: { outline: PAL.INK, outlineWidth: 1.6 },     // 怪物血条
  ink2:  { outline: PAL.INK, outlineWidth: 2 },
  ink25: { outline: PAL.INK, outlineWidth: 2.5 },
  ink3:  { outline: PAL.INK, outlineWidth: 3 },
  ink3open: { outline: PAL.INK, outlineWidth: 3, close: false },   // 折线（不闭合）
  ink4:  { outline: PAL.INK, outlineWidth: 4 },       // 大字飘字用
  slopeStern: { slope: 0.35 },                        // 常态半月眼
  slopeAngry: { slope: -0.55 }                        // 凶相眼
};
D.O = O;

D.rect = function (c, x0, y0, w, h, color, o) {
  o = o || {};
  var x = ctxOf(c);
  var st = o.alpha !== undefined;
  if (st) { x.save(); x.globalAlpha = o.alpha; }
  x.beginPath(); x.rect(x0, y0, w, h);
  fill(x, o.fillColor === undefined ? color : o.fillColor);
  ink(x, o.outline, lw(o.outlineWidth));
  if (st) x.restore();
};

D.roundRect = function (c, x0, y0, w, h, r, color, o) {
  o = o || {};
  var x = ctxOf(c);
  r = Math.min(r, w / 2, h / 2);
  var st = o.alpha !== undefined;
  if (st) { x.save(); x.globalAlpha = o.alpha; }
  x.beginPath();
  x.moveTo(x0 + r, y0);
  x.lineTo(x0 + w - r, y0); x.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
  x.lineTo(x0 + w, y0 + h - r); x.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h);
  x.lineTo(x0 + r, y0 + h); x.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
  x.lineTo(x0, y0 + r); x.quadraticCurveTo(x0, y0, x0 + r, y0);
  x.closePath();
  fill(x, color);
  ink(x, o.outline, lw(o.outlineWidth));
  if (st) x.restore();
};

D.circle = function (c, cx, cy, r, color, o) {
  o = o || {};
  var x = ctxOf(c);
  var st = o.alpha !== undefined;
  if (st) { x.save(); x.globalAlpha = o.alpha; }
  x.beginPath(); x.arc(cx, cy, Math.max(0, r), 0, U.TAU);
  fill(x, color);
  ink(x, o.outline, lw(o.outlineWidth));
  if (st) x.restore();
};

D.ellipse = function (c, cx, cy, rx, ry, rot, color, o) {
  o = o || {};
  var x = ctxOf(c);
  var st = o.alpha !== undefined;
  if (st) { x.save(); x.globalAlpha = o.alpha; }
  x.beginPath(); x.ellipse(cx, cy, Math.max(0, rx), Math.max(0, ry), rot || 0, 0, U.TAU);
  fill(x, color);
  ink(x, o.outline, lw(o.outlineWidth));
  if (st) x.restore();
};

D.poly = function (c, pts, color, o) {
  o = o || {};
  var x = ctxOf(c);
  var st = o.alpha !== undefined;
  if (st) { x.save(); x.globalAlpha = o.alpha; }
  polyPath(x, pts, o.close);
  fill(x, color);
  ink(x, o.outline, lw(o.outlineWidth));
  if (st) x.restore();
};

D.blob = function (c, pts, r, color, o) {
  o = o || {};
  var x = ctxOf(c);
  var st = o.alpha !== undefined;
  if (st) { x.save(); x.globalAlpha = o.alpha; }
  blobPath(x, pts, r, o.close);
  fill(x, color);
  ink(x, o.outline, lw(o.outlineWidth));
  if (st) x.restore();
};

D.bronana = function (c, cx, cy, rx, ry, color, o) {
  o = o || {};
  var x = ctxOf(c);
  x.save();
  x.translate(cx, cy); x.rotate(o.rot || 0);
  if (o.alpha !== undefined) x.globalAlpha = o.alpha;
  bronanaPath(x, rx, ry, o.seed === undefined ? 1 : o.seed, o.bump);
  fill(x, color);
  ink(x, o.outline, lw(o.outlineWidth));
  x.restore();          // 本函数无条件 save（含变换），故无条件 restore
};

D.arcRing = function (c, cx, cy, r, a0, a1, width, color, o) {
  o = o || {};
  var x = ctxOf(c);
  var st = o.alpha !== undefined;
  if (st) { x.save(); x.globalAlpha = o.alpha; }
  x.beginPath(); x.arc(cx, cy, r, a0, a1);
  x.strokeStyle = color; x.lineWidth = width;
  x.stroke();
  if (st) x.restore();  // 必须与上面的条件 save 配对，否则会弹掉调用方的状态
};

/** 粗黑描边的胶囊（四肢 / 武器柄 / 炮管） */
D.capsule = function (c, x0, y0, x1, y1, w, color, o) {
  o = o || {};
  var x = ctxOf(c);
  var st = o.alpha !== undefined;
  if (st) { x.save(); x.globalAlpha = o.alpha; }
  x.beginPath();
  x.moveTo(x0, y0); x.lineTo(x1, y1);
  x.lineCap = 'round'; x.lineWidth = w;
  x.strokeStyle = col(o.outline); x.stroke();
  x.lineWidth = Math.max(1, w - 2 * lw(o.outlineWidth));
  x.strokeStyle = color; x.stroke();
  if (st) x.restore();
};

/* ================= 面部（豆豆与怪物共用简化五官） ================= */
/**
 * 眼睛：默认"坚毅冷峻"半月眼
 * @param style: 'stern' | 'round' | 'angry' | 'dead' | 'dot' | 'none'
 *   `'none'` = **一个像素都不画**（给"眼球本体自己就是眼睛"的那种怪用）。
 *   它与选项常量 `D.O.none` 是两件事：那个是"不描边"，这个是"不画眼睛"。
 */
D.eye = function (c, cx, cy, r, style, o) {
  o = o || {};
  style = style || 'stern';
  var x = ctxOf(c);
  x.save();
  /* ⚠ 这一支必须存在：老实现没有它，`'none'` 就落到最后的 `else`（stern），
     表现是浮游之眼 / 钟摆那颗白眼球上多压了一道半月形 —— 而 `sprites.ts` 对
     `shape === 'eye'` 传的正是 `'none'`（那里的注释写着"眼球本体已有瞳孔"）。
     `'empty'` 这个名字**从来没有过画法**：它混进家族是因为 `D.O.empty` 是个选项常量；
     家族里已经删掉它（声明一个画不出来的值 = 假声明）。 */
  if (style === 'none') { x.restore(); return; }
  if (style === 'round' || style === 'dot') {
    D.circle(x, cx, cy, style === 'dot' ? r * 0.55 : r, o.white === false ? PAL.INK : PAL.WHITE, O.ink2);
    D.circle(x, cx, cy + r * 0.1, Math.max(1, r * 0.42), PAL.INK, O.none);
  } else if (style === 'angry') {
    D.circle(x, cx, cy, r * 0.92, PAL.WHITE, O.ink2);
    D.circle(x, cx, cy + r * 0.12, Math.max(1, r * 0.45), PAL.INK, O.none);
    D.poly(x, [[cx - r * 1.2, cy - r * 1.05], [cx + r * 1.15, cy - r * 1.6], [cx + r * 1.1, cy - r * 1.05]], PAL.INK, O.none);
  } else if (style === 'dead') {
    D.capsule(x, cx - r, cy - r, cx + r, cy + r, 3, PAL.INK, { outlineWidth: 0 });
    D.capsule(x, cx + r, cy - r, cx - r, cy + r, 3, PAL.INK, { outlineWidth: 0 });
  } else { // stern：上半平直、下缘圆弧的半月眼
    x.beginPath();
    x.moveTo(cx - r, cy - r * 0.15);
    x.lineTo(cx + r, cy - r * (o.slope === undefined ? 0.35 : o.slope));
    x.lineTo(cx + r, cy + r * 0.1);
    x.quadraticCurveTo(cx, cy + r * 1.25, cx - r, cy + r * 0.1);
    x.closePath();
    fill(x, PAL.INK);
    x.lineWidth = 2; x.strokeStyle = PAL.INK; x.stroke();
  }
  x.restore();
};

/** 嘴：'flat' | 'grin' | 'open' | 'wave' | 'none' */
D.mouth = function (c, cx, cy, w, style, color) {
  var x = ctxOf(c);
  x.save();
  x.strokeStyle = color || PAL.INK; x.lineWidth = 3; x.lineCap = 'round';
  x.beginPath();
  if (style === 'grin') {
    x.moveTo(cx - w, cy); x.quadraticCurveTo(cx, cy + w * 1.15, cx + w, cy);
  } else if (style === 'open') {
    D.ellipse(x, cx, cy + 1, w * 0.55, w * 0.7, 0, PAL.INK, O.none);
  } else if (style === 'wave') {
    x.moveTo(cx - w, cy);
    x.quadraticCurveTo(cx - w * 0.5, cy - w * 0.55, cx, cy);
    x.quadraticCurveTo(cx + w * 0.5, cy + w * 0.55, cx + w, cy);
  } else if (style === 'none') {
    // nothing
  } else {
    x.moveTo(cx - w, cy); x.lineTo(cx + w, cy);
  }
  x.stroke();
  x.restore();
};

/* ================= 平涂辅助 ================= */
/** 纯色斑点（豆豆坑、怪物疣） */
D.dots = function (c, cx, cy, r, n, seedStr, color, size) {
  var x = ctxOf(c);
  var rnd = U.rng(U.seedFromStr(seedStr || 'dot'));
  x.save();
  if (color) x.fillStyle = color; else x.fillStyle = PAL.BRONANA_DOT;
  for (var i = 0; i < n; i++) {
    var a = rnd() * U.TAU;
    var d = Math.sqrt(rnd()) * r * 0.78;
    x.beginPath();
    x.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, (size || 2.2) * (0.6 + rnd() * 0.8), 0, U.TAU);
    x.fill();
  }
  x.restore();
};

/** 抖动排线（复古 dither，用于地面过渡，仍属"平涂"范畴） */
D.ditherBand = function (x, x0, x1, y, h, cA, cB, seedStr, density) {
  x.save();
  x.fillStyle = cA; x.fillRect(x0, y, x1 - x0, h);
  var rnd = U.rng(U.seedFromStr(seedStr || 'dith'));
  x.fillStyle = cB;
  var step = 4, d = density === undefined ? 0.5 : density;
  for (var yy = y; yy < y + h; yy += step) {
    for (var xx = x0; xx < x1; xx += step) {
      if (rnd() < d) x.fillRect(xx, yy, 2, 2);
    }
  }
  x.restore();
};

/* ================= 描边文字（HUD 用，风格统一） ================= */
D.text = function (c, str, x0, y0, size, color, o) {
  o = o || {};
  var x = ctxOf(c);
  x.save();
  x.font = (o.weight || 700) + ' ' + size + 'px "Microsoft YaHei","PingFang SC",sans-serif';
  x.textAlign = o.align || 'center';
  x.textBaseline = o.baseline || 'middle';
  if (o.outline !== false && o.outline !== null) {
    x.lineWidth = o.outlineWidth === undefined ? Math.max(2, size * 0.16) : o.outlineWidth;
    x.strokeStyle = col(o.outline);
    x.lineJoin = 'round';
    x.strokeText(str, x0, y0);
  }
  x.fillStyle = color || PAL.INK;
  x.fillText(str, x0, y0);
  x.restore();
};

/* ================= 旋转辅助 ================= */
D.at = function (c, x0, y0, rot, fn) {
  var x = ctxOf(c);
  x.save(); x.translate(x0, y0); x.rotate(rot || 0);
  fn(x);
  x.restore();
};

export { D, D as draw2d };
