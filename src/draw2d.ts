/* =========================================================
draw2d.ts — 美术宪法执行层
所有绘制入口：粗黑外轮廓 + 纯色平涂
本文件不提供任何渐变 / 阴影 / 模糊 / 贴图 API（有意为之）
========================================================= */

import { PAL, U } from './utils.ts';
import { RHI } from './rhi.ts';
import { Text } from './text.ts';
var OUT = 3;             // 标准外轮廓线宽

/* ================= 基础 ================= */

/**
 * 取绘制上下文 —— **本模块唯一的 ctx 入口**（R60 之后它是 RHI 的插点）。
 *
 * ## 为什么这里是那个插点
 * 改造前本文件 382 行、**27 个成员**全部直接读写 `CanvasRenderingContext2D`
 * （`strokeStyle` / `lineWidth` / `beginPath` / `quadraticCurveTo` …）。
 * ⇒ 这台引擎的"渲染能力"当时就是 **HTML Canvas API 的一个薄包装**：
 *   换后端 = 重写全部绘制原语；换宿主 = 重写引擎。
 *
 * 现在经 `RHI.wrap()` 过一次（`rhi.ts` 声明**引擎允许用哪些成员**）。
 * ⚠ **它今天是透明的**：`wrap()` 用 `Proxy` 逐成员转发，不改时序、不改成员可见性 ——
 * 所以本文件下面那 380 行**一行都没改**，而绘制调用序列与改造前**逐字节一致**
 * （`test/draw.mjs` 有断言；这是"零行为变化"的机器判据）。
 * 将来的 WebGL2 后端要自己实现这同一个面（路径→三角带、3px 外轮廓→三角扩张描边）。
 */
function ctxOf(c) {
  if (!c) return null;
  var raw = (c.getContext ? c.getContext('2d') : c);
  if (!raw) return null;
  var x = RHI.wrap(raw);
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
 * 钝圆多边形：把折线边向外圆角化（圆润笨拙的造型感 —— 美术宪法）
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
 * 种子团形轮廓：圆润饱满、略扁、底部两瓣
 * 用平滑谐波生成，天然带手绘笨拙感且逐帧稳定（**与任何具体角色无关**）
 *
 * ⚠ 为什么叫 `seedBlob` 而不叫 `blob`：`D.blob`（点列表团形，本文件 :230）与
 *   `blobPath`（它的路径助手，:66）**本来就已经存在** —— E3 原始计划里写的
 *   `D.blob` / `blobPath` 会**撞名**。`seedBlob` 保留「团形」家族名，
 *   并点出区别特征（**由 seed 调制**）。
 */
function seedBlobPath(x, rx, ry, seed, bump) {
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
D.seedBlobPath = seedBlobPath;
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
/* ⚠ 2026-10-02（批次 2）：表情原语 `eye` / `mouth` 搬去内容侧的造型模块之后，
   那边需要这个「把 canvas 归一成 RHI 包装过的 ctx」的入口。
   它本来就是**通用能力**（引擎的），所以按 content → engine 的方向**导出**，
   而不是复制一份 —— 复制一份就等于两份真相。 */
D.ctxOf = ctxOf;

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

D.seedBlob = function (c, cx, cy, rx, ry, color, o) {
  o = o || {};
  var x = ctxOf(c);
  x.save();
  x.translate(cx, cy); x.rotate(o.rot || 0);
  if (o.alpha !== undefined) x.globalAlpha = o.alpha;
  seedBlobPath(x, rx, ry, o.seed === undefined ? 1 : o.seed, o.bump);
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

/* ================= 平涂辅助 ================= */
/** 纯色斑点（躯体凹坑、怪物疣） */
D.dots = function (c, cx, cy, r, n, seedStr, color, size) {
  var x = ctxOf(c);
  var rnd = U.rng(U.seedFromStr(seedStr || 'dot'));
  x.save();
  if (color) x.fillStyle = color; else x.fillStyle = PAL.SKIN_DOT;
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
  /* ⚠ 字体串与缺省排版**不再在这里拼** —— 它们住在 `text.ts`（R61）。
     理由：R49 阶段 4 要把字形烘成图集，而"烘哪几档字号 / 哪一族字体"
     必须有出处。写在这行里就等于"内容在定义引擎的面"。
     参数取自下面两处声明：字体栈 `STACKS.ui`、缺省字重 700、描边 `max(2, size*0.16)`。 */
  x.font = Text.font(size, o.weight);
  x.textAlign = o.align || Text.layout().align;
  x.textBaseline = o.baseline || Text.layout().baseline;
  if (o.outline !== false && o.outline !== null) {
    x.lineWidth = Text.outlineWidth(size, o.outlineWidth);
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
