/* =========================================================
render.ts — 渲染层（只读世界状态，不做任何模拟）
俯视上帝视角 · 粗黑描边 · 纯色平涂 · 低饱和
========================================================= */

import { Arena } from './arena.ts';
import { Appearance } from './appearance.ts';
import { Art } from './art_spec.ts';
import { ArtParallax } from './art_parallax.ts';
import { ArtShaders } from './art_shaders.ts';
import { ArtTiles } from './art_tiles.ts';
import { D } from './draw2d.ts';
import { Depth } from './depth.ts';
import { Dungeon } from './dungeon.ts';
import { Game } from './game.ts';
import { Bronana } from './bronana.ts';
import { Scene } from './scene.ts';
import { S } from './sprites.ts';
import { Stats } from './stats.ts';
import { PAL, Perf, U } from './utils.ts';
import { World } from './world.ts';

var R = ({
  cam: { x: 0, y: 0, w: 0, h: 0, zoom: 1, shakeX: 0, shakeY: 0 },
  dpr: 1,
  canvas: null,
  ctx: null,
  showDebug: false,
  showFps: false,
  /** 深度叠层（?z=1）：打印本帧的层带账目与排序队列 */
  showDepth: false,
  phase: 'idle',
  culled: 0,
  cullEnabled: true,
  view: { x0: 0, y0: 0, x1: 0, y1: 0, on: false }
} as unknown as RenderApi);

R.init = function (canvas) {
  R.canvas = canvas;
  R.ctx = canvas.getContext('2d');
  R.resize();
  // 模拟层只发"发生了需要抖动的冲击"事件，具体幅度由渲染层决定（保持层次分离）
  Game.events.on('shake', function (a) { R.addTrauma(a); });
  Game.events.on('runStart', function () { R.resetShake(); });
};

R.resize = function () {
  if (!R.canvas) return;
  var dpr = Math.min(2, window.devicePixelRatio || 1);
var w = window.innerWidth, h = window.innerHeight;
  var changed = dpr !== R.dpr;
  R.dpr = dpr;
  R.canvas.width = Math.floor(w * dpr);
  R.canvas.height = Math.floor(h * dpr);
  R.cam.w = w; R.cam.h = h;
  // 分辨率变了：位图缓存（离屏贴图 + 两层烘焙）必须按新倍率重建，
  // 否则拖到另一个显示器上之后，缓存层还是旧倍率的那一份。
  if (changed) { S.setScale(dpr); R.invalidateBakes(); }
};

/* =========================================================
   摄像机
   ========================================================= */
function updateCamera(dt) {
  var cam = R.cam;
  /* 目标：屋里跟屋里的玩家，战斗里跟会话玩家。夹取范围也跟着世界尺寸走 ——
     大厅 / 枢纽是 1500×1120 的**手写房间**（不是 Arena 那张 1680×1260），
     用 Arena 的尺寸夹取会让镜头在屋里偏出去一截。 */
  var hall = Game.hall();
  var tx, ty, worldW, worldH;
  if (hall && hall.def) {
    tx = hall.x; ty = hall.y; worldW = hall.def.w; worldH = hall.def.h;
  } else {
    var sess = Game.getSession();
    if (!sess) return;
    /* 战场尺寸读**世界区域表**（不是 `Arena`）：镜头夹取与"人能站到哪"
       从此用同一个数。`World.zone()` 返回表里那一份（不复制、不分配），
       所以这条每帧都跑的路没有新增分配。 */
    var zone = World.zone('arena');
    tx = sess.player.x; ty = sess.player.y; worldW = zone.w; worldH = zone.h;
  }
  cam.x = U.lerp(cam.x, tx, Math.min(1, dt * 7));
  cam.y = U.lerp(cam.y, ty, Math.min(1, dt * 7));

  var halfW = cam.w / 2 / cam.zoom, halfH = cam.h / 2 / cam.zoom;
  cam.x = U.clamp(cam.x, Math.min(halfW, worldW / 2), Math.max(worldW - halfW, worldW / 2));
  cam.y = U.clamp(cam.y, Math.min(halfH, worldH / 2), Math.max(worldH - halfH, worldH / 2));

  updateShake(dt);
  cam.shakeX = R.shake.x;
  cam.shakeY = R.shake.y;
}

/* =========================================================
   摄像机抖动（trauma 模型）
   旧实现的两个问题（实测）：
     1) 偏移每帧用 Math.random() 重采样 → 抖动频率 = 刷新率。
        60Hz 每秒位移总量 65px，144Hz 是 238px：幅度一样但手感完全不同，
        而且 Math.random 破坏了可复现性。
     2) 幅度与 trauma 线性相关 → 收尾拖沓。
   现在：trauma ∈ [0,1]，幅度 = trauma²（收尾干净）；
        位移取固定频率的确定性平滑噪声，与刷新率无关、同 seed 可复现；
        幅度以屏幕像素定义再按 zoom 折算，缩放时观感一致。
   ========================================================= */
var SHAKE_MAX_PX = 16;    // trauma=1 时的最大屏幕位移（像素）
var SHAKE_FREQ = 26;      // 噪声采样频率（Hz），越高越"碎"
var SHAKE_DECAY = 2.4;    // trauma 每秒衰减量（受击抖动约 0.2 秒）

R.shake = { trauma: 0, t: 0, x: 0, y: 0, seed: 1337 };
R.SHAKE_MAX_PX = SHAKE_MAX_PX;

/**
 * 请求抖动。用 max 语义（而不是累加）：
 * 火箭筒这类高频事件如果累加，trauma 会长期顶到 1，变成永久晃动。
 */
R.addTrauma = function (a) {
  if (!(a > 0)) return;
  a = a * R.shakeScale;                 // 设置里的"屏幕抖动"倍率（0 = 完全关掉）
  if (a > R.shake.trauma) R.shake.trauma = Math.min(1, a);
};

R.resetShake = function () {
  R.shake.trauma = 0;
  R.shake.t = 0;
  R.shake.x = 0;
  R.shake.y = 0;
};

/** 整数哈希 → [-1,1] */
function hash1(n) {
  n = Math.imul(n ^ (n >>> 15), 2246822519);
  n = Math.imul(n ^ (n >>> 13), 3266489917);
  return (((n ^ (n >>> 16)) >>> 0) / 4294967296) * 2 - 1;
}

/** 一维平滑值噪声：确定性、连续、取值 ±1 */
function noise1(seed, t) {
  var i = Math.floor(t), f = t - i;
  var a = hash1(seed + i), b = hash1(seed + i + 1);
  var u = f * f * (3 - 2 * f);          // smoothstep，保证一阶连续
  return a + (b - a) * u;
}

function updateShake(dt) {
  var s = R.shake;
  if (s.trauma <= 0) { s.x = 0; s.y = 0; return; }
  s.t += dt;
  s.trauma = Math.max(0, s.trauma - SHAKE_DECAY * dt);
  var mag = s.trauma * s.trauma * SHAKE_MAX_PX / R.cam.zoom;
  var tt = s.t * SHAKE_FREQ;
  s.x = noise1(s.seed, tt) * mag;
  s.y = noise1(s.seed + 977, tt) * mag;
}

/**
 * 世界坐标 → 画布像素（**鼠标 → 世界方向**要用它）。
 * 它是 `applyCamera` 那条变换的逆：
 *   canvasX = (worldX - cam.x) * zoom + cam.w / 2   （再乘 dpr）
 * `worldToScreen(px, py).x / dpr` 就是 CSS 像素坐标（鼠标事件的单位）。
 * ⚠ 相机与 dpr 都只有渲染层认识 —— 输入层拿到的是一个点，不是矩阵。
 */
R.worldToScreen = function (wx, wy) {
  var cam = R.cam;
  var s = R.dpr * cam.zoom;
  return {
    x: (wx - cam.x) * s + cam.w / 2 * R.dpr,
    y: (wy - cam.y) * s + cam.h / 2 * R.dpr
  };
};

function applyCamera(x) {
  var cam = R.cam;
  x.setTransform(R.dpr * cam.zoom, 0, 0, R.dpr * cam.zoom, 0, 0);
  x.translate(-cam.x + cam.w / 2 / cam.zoom + cam.shakeX, -cam.y + cam.h / 2 / cam.zoom + cam.shakeY);
}

/* =========================================================
   视口剔除
   摄像机视野之外的实体一律不画。这是唯一"收益随实体数量放大"的优化：
   300 只怪铺满战场时约四成在屏幕外，白画它们等于白烧帧预算。
   余量 90px 用来容纳比碰撞半径大的贴图（Boss 贴图高达 8R）。
   ========================================================= */
var VIEW_MARGIN = 90;

function updateView() {
  var cam = R.cam;
  var hw = cam.w / 2 / cam.zoom, hh = cam.h / 2 / cam.zoom;
  R.view.x0 = cam.x - hw - VIEW_MARGIN;
  R.view.y0 = cam.y - hh - VIEW_MARGIN;
  R.view.x1 = cam.x + hw + VIEW_MARGIN;
  R.view.y1 = cam.y + hh + VIEW_MARGIN;
  R.view.on = true;
  R.culled = 0;
}

/** r 为形状外接半径；不可见则返回 false（调用方直接 skip） */
R.inView = function (x, y, r) {
  if (!R.cullEnabled || !R.view.on) return true;
  r = r || 0;
  if (x + r < R.view.x0 || x - r > R.view.x1 ||
      y + r < R.view.y0 || y - r > R.view.y1) {
    R.culled++;
    return false;
  }
  return true;
};

/* =========================================================
   地面
   ========================================================= */
/** 纵向第几档色调（**由环境配色给**，所以这一带"亮在哪"不再写死）。
 *  `pal.tones` 由深到浅 5 档，与这里的 5 段分层一一对应。 */
function bandTone(y, pal) {
  var tones = (pal && pal.tones) || PAL_TONES;
  var t = y / Arena.H;
  if (t < 0.18) return tones[0];
  if (t < 0.38) return tones[1];
  if (t < 0.60) return tones[2];
  if (t < 0.80) return tones[3];
  return tones[4];
}

/** 没有环境时的降级色表（默认环境 = 改造前那套红棕，逐位相同） */
var PAL_TONES = [PAL.G6, PAL.G1, PAL.G3, PAL.G4, PAL.G5];

/**
 * 静态地面绘制（坐标即战场坐标，不含摄像机变换）
 * 注意：这个函数很重（约 4.5 万次 fillRect），只允许在换波时烘焙一次
 */
function drawGroundStatic(x, a) {
  var pal = a.pal || null;
  var tones = (pal && pal.tones) || PAL_TONES;
  // 基色（按纵向条带平涂，无渐变）
  x.fillStyle = (pal && pal.base) || PAL.G2;
  x.fillRect(-40, -40, Arena.W + 80, Arena.H + 80);

  var bandH = Arena.H / 5;
  for (var i = 0; i < 5; i++) {
    var y0 = i * bandH;
    var tone = bandTone(y0 + bandH / 2, pal);
    D.ditherBand(x, -10, Arena.W + 10, y0, bandH + 1, tone, bandTone(y0, pal), 'band' + a.wave + i, 0.34);
  }

  // 大地块色斑
  for (var p = 0; p < a.patches.length; p++) {
    var pt = a.patches[p];
    if (pt.form === 'flat') {
      D.ellipse(x, pt.x, pt.y, pt.rx, pt.ry, pt.rot, pt.tone, { outlineWidth: 0, alpha: 0.85 });
    } else {
      var pts = [];
      for (var k = 0; k < pt.pts; k++) {
        var ang = k / pt.pts * U.TAU;
        var w = 1 + Math.sin(ang * 2 + pt.seed) * pt.bump + Math.sin(ang * 5 - pt.seed) * pt.bump * 0.4;
        pts.push([pt.x + Math.cos(ang) * pt.rx * w, pt.y + Math.sin(ang) * pt.ry * w]);
      }
      D.blob(x, pts, 24, pt.tone, { outlineWidth: 0, alpha: 0.8 });
    }
  }

  /* 地砖区（`art_tiles.ts` 的自动规则瓦片）。
     为什么要它：上面那 70 块"色斑"是**笔刷**——它们能给出大块色调，
     但给不出"结构"。而废墟感来自**破碎的铺装**：整块的砖、断在中间的砖、
     拐角的砖、孤零零的一格。这类东西的本质是**格子**，笔刷画不出来。
     瓦片只在这里画一次（随静态层烘焙），所以**每帧绘制数一点没变**。
     网格是从已有的 patches 派生的（不新增随机流）：同一个波次仍是同一张地面。 */
  drawRuins(x, a, pal);

  // 裂纹
  for (var c = 0; c < a.cracks.length; c++) {    var cr = a.cracks[c];    x.save();
    x.globalAlpha = 0.34;
    x.strokeStyle = (pal && pal.crack) || PAL.G6; x.lineWidth = cr.w; x.lineJoin = 'round';
    x.beginPath();
    x.moveTo(cr.pts[0][0], cr.pts[0][1]);
    for (var q = 1; q < cr.pts.length; q++) x.lineTo(cr.pts[q][0], cr.pts[q][1]);
    x.stroke();
    x.restore();
  }

  // 碎石
  for (var s = 0; s < a.pebbles.length; s++) {
    var pb = a.pebbles[s];
    D.ellipse(x, pb.x, pb.y, pb.r, pb.r * pb.sq, pb.rot, pb.tone, D.O.none);
  }
}

/**
 * 把地面上的**破碎铺装**画成瓦片（自动规则瓦片的第一处真实用法）。
 *
 * 输入是 `Arena.build` 已经算好的 patches —— **不新增一条随机流**：
 * 同一个波次、同一个环境仍然是同一张地面（`test/cache.mjs` 的烘焙键前提）。
 *
 * 为什么这一层值得存在（而不是"再画几个色块"）：
 *   · 笔刷给不出**结构**：一块断在中间的砖、一个拐角、一格孤砖，
 *     这些东西的形状由**邻居**决定 —— 那正是 auto-tiling 的定义；
 *   · 它落在**静态层烘焙**里，所以是"零每帧成本"的结构：
 *     1500 块瓦片画一次，之后每帧一次 `drawImage`。
 *
 * 颜色取自环境调色板（`pal.tones`），所以换层不用改这里一个像素 ——
 * 与"瓦片只声明结构、色由环境给"这条规范一致。
 */
/**
 * 铺装区的最低叠加层数（见 `drawRuins`）。
 * 这个数字同时是**观感**与**烘焙开销**的旋钮 —— 2 层太满（几乎整片都是砖），
 * 5 层太稀（只剩几个小岛）。3 是量出来的：既看得出"成片的残存铺装"，
 * 又把静态层烘焙压在预算里（`test/render-check.mjs` 的烘焙帧守卫）。
 */
var RUIN_MIN_LAYERS = 3;

/** 上一次烘焙里铺了多少格瓦片（**要能被量**：它是静态层开销的主要项，
 *  与 `R.bakeStats()` 一起回答"这一层重在哪"）。0 = 这一次没铺。 */
R.terrain = { tiles: 0, cells: 0, set: '' };

function drawRuins(x, a, pal) {
  if (!ArtTiles || !a || !a.patches || !a.patches.length) return 0;
  var set = ArtTiles.get('ruinFloor');
  if (!set) return 0;
  var ts = set.tileSize;
  var gw = Math.ceil(Arena.W / ts), gh = Math.ceil(Arena.H / ts);
  /* 覆盖**计数**而不是布尔：70 块色斑互相重叠，几乎铺满整个战场（实测
     105×79 格里 7900 格都被覆盖到）—— 全都铺砖 = 静态层烘焙从 2 万笔
     涨到 7.5 万笔，把"烘焙帧上限"这条守卫顶红。
     而"废墟铺装"要的本来就不是"整个地面都是砖"，是**土里露出来的残存铺装**：
     所以只在色斑**叠加**的地方铺（层数越多 = 那块地越"被翻动过"）。
     阈值是一条校验（`RUIN_MIN_LAYERS`），它同时决定观感与烘焙开销。 */
  var cover = ArtTiles.blankGrid(gw, gh);

  /* 覆盖判定：色斑是一块椭圆的**近似** —— 这一层的用途是铺装，
     判定差半格看不出来，而精确求交要把每个 patch 的多边形重算一遍。 */
  for (var p = 0; p < a.patches.length; p++) {
    var pt = a.patches[p];
    var rx = pt.rx, ry = pt.ry;
    if (rx < ts || ry < ts) continue;              // 太小的色斑铺不下砖
    var x0 = Math.max(0, Math.floor((pt.x - rx) / ts));
    var x1 = Math.min(gw - 1, Math.floor((pt.x + rx) / ts));
    var y0 = Math.max(0, Math.floor((pt.y - ry) / ts));
    var y1 = Math.min(gh - 1, Math.floor((pt.y + ry) / ts));
    for (var gy = y0; gy <= y1; gy++) {
      for (var gx = x0; gx <= x1; gx++) {
        var dx = (gx * ts + ts / 2 - pt.x) / rx;
        var dy = (gy * ts + ts / 2 - pt.y) / ry;
        if (dx * dx + dy * dy <= 1) cover[gy][gx]++;
      }
    }
  }

  var grid = ArtTiles.blankGrid(gw, gh);
  var cells = 0;
  for (var yy = 0; yy < gh; yy++) {
    for (var xx = 0; xx < gw; xx++) {
      if (cover[yy][xx] >= RUIN_MIN_LAYERS) { grid[yy][xx] = 1; cells++; }
    }
  }
  if (!cells) return 0;

  var plan = ArtTiles.autotile(set, grid, 0, 0);
  R.terrain.tiles = plan.cells.length;
  R.terrain.cells = cells;
  R.terrain.set = set.id;
  if (!plan.cells.length) return 0;

  /* 色：**每一格按它所在的纵向条带取色**（与背景 bandTone 同一套），
     于是铺装不会在换色带的地方变成一整块突兀的矩形。 */
  var tones = (pal && pal.tones) || PAL_TONES;
  var base = (pal && pal.base) || PAL.G2;
  var seams = (pal && pal.crack) || PAL.G6;
  var drawn = 0;
  for (var i = 0; i < plan.cells.length; i++) {
    var cell = plan.cells[i];
    var tone = tones[Math.floor((cell.y / Arena.H) * tones.length)] || base;
    S.drawTile(x, set, cell.tile, cell.mask, cell.x, cell.y, ts, {
      fill: tone, lit: base, dark: seams, seam: seams,
      inset: set.art.edgeInset, bevel: set.art.bevel
    });
    drawn++;
  }
  return drawn;
}

/* ---- 地面烘焙缓存：静态内容只画一次，之后每帧一次 drawImage ---- */
/* 键是 **(波次, 环境)**：只认波次的话，同一波里翻层换了环境，
   交出来的还是上一层的红棕地面 —— 缓存会静默地把"环境"吃掉。 */
R.ground = { canvas: null, wave: -1, theme: '', scale: 0 };
var GROUND_PAD = 40;   // 战场外扩，保证边界外侧的地面色不被裁掉

/**
 * 烘焙倍率 = 设备像素比（R.dpr 已经在 resize 里夹到 ≤2）。
 * 缓存层是**位图**：世界变换里有 dpr 这一层缩放，如果位图按 1× 烘焙，
 * 在 2× 屏上就是被拉大 2 倍（画布内 drawImage 默认开平滑 → 描边发虚），
 * 而同一帧里矢量绘制的东西（角色、子弹、粒子）是清楚的 —— 一虚一实很显眼。
 *
 * 代价是显存，而且不小：整块战场 1760×1340 逻辑像素，2× 时**每层** 9.43M
 * 设备像素 ≈ 36MB，两层 72MB（实测值见 test/cache.mjs 的输出）。
 * 所以给的是"两层加起来"的总预算，超了就整体退回 1× ——
 * 宁可背景糊一点，也不要为了背景把显存吃光（角色贴图不受影响，那是小块）。
 */
var BAKE_MAX_TOTAL_PX = 20e6;

function bakeScale() {
  var s = R.dpr || 1;
  var perLayer = (Arena.W + GROUND_PAD * 2) * (Arena.H + GROUND_PAD * 2) * s * s;
  return perLayer * 2 <= BAKE_MAX_TOTAL_PX ? s : 1;
}

function bakeLayer(slot, wave, theme, drawFn, a) {
  if (typeof document === 'undefined') return null;
  var s = bakeScale();
  if (slot.canvas && slot.wave === wave && slot.theme === theme && slot.scale === s) return slot.canvas;
  var lw = Arena.W + GROUND_PAD * 2, lh = Arena.H + GROUND_PAD * 2;
  var c = document.createElement('canvas');
  c.width = Math.ceil(lw * s);
  c.height = Math.ceil(lh * s);
  var g = c.getContext('2d');
  g.scale(s, s);              // 之后用逻辑坐标画，倍率只体现在分辨率上
  g.translate(GROUND_PAD, GROUND_PAD);
  drawFn(g, a);
  slot.canvas = c;
  slot.wave = wave;
  slot.theme = theme;
  slot.scale = s;
  return c;
}

/** 让烘焙层全部作废（换 dpr / 换战场尺寸 / 测试用） */
R.invalidateBakes = function () {
  R.ground.canvas = null; R.ground.wave = -1; R.ground.theme = ''; R.ground.scale = 0;
  R.props.canvas = null; R.props.wave = -1; R.props.theme = ''; R.props.scale = 0;
};

/** 烘焙层账目：像素 / 字节 / 倍率，用于回答"缓存吃了多少显存" */
R.bakeStats = function () {
  function one(slot) {
    var c = slot.canvas;
    var px = c ? c.width * c.height : 0;
    return { baked: !!c, wave: slot.wave, theme: slot.theme, scale: slot.scale, px: px, bytes: px * 4 };
  }
  var g = one(R.ground), p = one(R.props);
  return {
    ground: g, props: p, scale: bakeScale(), maxPx: BAKE_MAX_TOTAL_PX,
    px: g.px + p.px, bytes: g.bytes + p.bytes
  };
};

function bakeGround(a) {
  return bakeLayer(R.ground, a.wave, a.theme, drawGroundStatic, a);
}

function drawGround(x, a) {
  var baked = bakeGround(a);
  // 逻辑尺寸显式传给 drawImage：画布是 dpr 倍分辨率的，不写尺寸就会被放大 dpr 倍
  if (baked) x.drawImage(baked, -GROUND_PAD, -GROUND_PAD, Arena.W + GROUND_PAD * 2, Arena.H + GROUND_PAD * 2);
  else drawGroundStatic(x, a);   // 无 DOM 环境（无头测试）下的降级路径
}

/* =========================================================
   血迹贴花
   贴花存在环形缓冲里，越旧越淡：
     · 最旧的一条淡到 0 时正好被覆盖 → 没有"突然消失"的跳变
     · 因此也不需要"满了就不再加"，每一次击杀都留痕
   淡到看不见的直接跳过绘制。
   ========================================================= */
var DECAL_ALPHA = 0.55;
/** 低于这个透明度的旧血迹只画主圆（溅射两笔在那个浓度下看不出来） */
var DECAL_SPLASH_MIN = 0.35;

/** 按新旧排名给出透明度（1=最新）。暴露出来是为了能单测。 */
R.decalAlpha = function (d, sess) {
  var cap = Game.cfg.decalCap;
  var newest = sess.decalSeq || 0;
  var span = Math.min(cap, newest) - 1;
  if (span <= 0) return DECAL_ALPHA;
  var rank = (d.seq - (newest - span)) / span;
  if (rank <= 0) return 0;
  if (rank > 1) rank = 1;
  return DECAL_ALPHA * rank;
};

function drawDecals(x) {
  var sess = Game.getSession();
  if (!sess) return;
  var list = sess.decals;
  // save/restore 提到循环外：循环中间没有任何别的绘制，每帧唯一的可变状态就是
  // globalAlpha。逐条 save/restore 在密集场景是 2×N 次纯多余调用（N≈55 → 110 次），
  // 提出来之后画的还是同样三笔，像素完全一致。
  x.save();
  for (var i = 0; i < list.length; i++) {
    var d = list[i];
    if (!R.inView(d.x, d.y, d.r * 2)) continue;
    var a = R.decalAlpha(d, sess);
    if (a < 0.03) continue;              // 已经淡到看不见
    x.globalAlpha = a;
    D.circle(x, d.x, d.y, d.r, d.color, D.O.none);
    // 溅射（LOD）：角度/距离/半径都在生成时随机过，所以每个血迹形状不同。
    // 但已经淡到 <0.35 的血迹只画主圆 —— 两笔溅射在那个透明度下的差别肉眼不可见，
    // 而密集场景里这类"旧血迹"占绝大多数（贴花层 497 次/帧 → 约 250 次）。
    if (a >= DECAL_SPLASH_MIN) {
      D.circle(x, d.x + Math.cos(d.a1) * d.r * d.d1, d.y + Math.sin(d.a1) * d.r * d.d1 * 0.7,
        d.r * d.s1, d.color, D.O.none);
      D.circle(x, d.x + Math.cos(d.a2) * d.r * d.d2, d.y + Math.sin(d.a2) * d.r * d.d2 * 0.7,
        d.r * d.s2, d.color, D.O.none);
    }
  }
  x.restore();
}

/* =========================================================
   环境装饰物的画法（**每种环境的"地形语言"**）
   ---------------------------------------------------------
   改造前这里只有一套白骨 —— 因为只有一个环境。现在按 `a.prop` 分派：
   白骨 / 菌伞 / 晶簇 / 余烬 / 冰棱，形状与配色都不同，但遵守同一条宪法：
   **平涂 + 3px 黑描边**，不用渐变。
   每种两个变体（`kind`），所以同一层里也不会看到 12 个一模一样的东西。
   键名必须能在 `Dungeon.PROP_KINDS` 里找到同名项（test/dungeon.mjs 静态对照）——
   否则"声明了一种装饰物却没人画"只能靠人眼发现。
   ========================================================= */
var PROP_DRAW: Record<string, (x: CanvasRenderingContext2D, kind: string, pal: ThemePal) => void> = {  /** 白骨：肋骨 / 头骨 */
  bone: function (x, kind, pal) {
    if (kind === 'rib') {
      for (var k = 0; k < 3; k++) {
        D.capsule(x, -12, k * 6 - 6, 12, k * 6 - 10, 4, pal.propA, D.O.ink2);
      }
    } else {
      D.circle(x, 0, 0, 8, pal.propA, D.O.ink25);
      D.circle(x, -3, -1, 2.2, PAL.INK, D.O.none);
      D.circle(x, 3, -1, 2.2, PAL.INK, D.O.none);
      D.rect(x, -2, 4, 4, 5, PAL.INK, D.O.none);
    }
  },
  /** 菌伞：半球伞盖带斑点 / 细柄 + 小伞 */
  fungus: function (x, kind, pal) {
    if (kind === 'cap') {
      D.ellipse(x, 0, 0, 15, 11, 0, pal.propA, D.O.ink3);
      D.ellipse(x, 0, 1, 15, 6, 0, pal.propB, D.O.none);
      D.circle(x, -5, -3, 2.4, pal.propB, D.O.none);
      D.circle(x, 4, -5, 1.8, pal.propB, D.O.none);
      D.rect(x, -3, 8, 6, 8, pal.propB, D.O.ink2);
    } else {
      D.capsule(x, 0, 12, 0, -4, 5, pal.propB, D.O.ink2);
      D.poly(x, [[-11, -4], [11, -4], [0, -14]], pal.propA, D.O.ink25);
    }
  },
  /** 晶簇：单根尖晶 / 三根一丛 */
  crystal: function (x, kind, pal) {
    if (kind === 'shard') {
      D.poly(x, [[0, -16], [7, -2], [4, 12], [-4, 12], [-7, -2]], pal.propA, D.O.ink3);
      D.poly(x, [[0, -16], [0, 12], [-4, 12], [-7, -2]], pal.propB, D.O.none);
    } else {
      D.poly(x, [[-10, 8], [-6, -8], [-1, 8]], pal.propA, D.O.ink25);
      D.poly(x, [[1, 9], [6, -13], [11, 9]], pal.propB, D.O.ink25);
      D.poly(x, [[-14, 10], [-11, 0], [-7, 10]], pal.propB, D.O.ink2);
    }
  },
  /** 余烬：压着火星的焦块 / 一圈石头围着的火口 */
  ember: function (x, kind, pal) {
    if (kind === 'ember') {
      D.blob(x, [[-13, 6], [-9, -7], [2, -10], [12, -3], [10, 8], [-2, 11]], 4, pal.propB, D.O.ink3);
      D.poly(x, [[-6, 2], [0, -5], [6, 2], [2, 7], [-4, 7]], pal.propA, D.O.none);
    } else {
      for (var k = 0; k < 6; k++) {
        var a0 = k / 6 * U.TAU;
        D.circle(x, Math.cos(a0) * 13, Math.sin(a0) * 9, 4, pal.propB, D.O.ink2);
      }
      D.ellipse(x, 0, 0, 7, 5, 0, pal.propA, D.O.ink25);
    }
  },
  /** 冰棱：三角尖冰 / 方冰台 */
  ice: function (x, kind, pal) {
    if (kind === 'spike') {
      D.poly(x, [[0, -16], [8, 10], [-8, 10]], pal.propA, D.O.ink3);
      D.poly(x, [[0, -16], [0, 10], [-8, 10]], pal.propB, D.O.none);
    } else {
      D.rect(x, -11, -8, 22, 18, pal.propA, D.O.ink3);
      D.rect(x, -11, -8, 9, 18, pal.propB, D.O.none);
    }
  }
};

function drawPropsStatic(x, a) {
  var pal = a.pal || null;
  var rock = (pal && pal.rock) || PAL.ROCK;
  var rockHi = (pal && pal.rockHi) || PAL.ROCK_HI;
  var rockDark = (pal && pal.rockDark) || PAL.ROCK_DARK;
  for (var i = 0; i < a.rocks.length; i++) {
    var r = a.rocks[i];
    var base = r.dark ? rockDark : rock;
    D.ellipse(x, r.x + 3, r.y + r.r * 0.52, r.r * 1.02, r.r * 0.3, 0, 'rgba(16,13,12,0.22)', D.O.none);
    D.blob(x, r.pts.map(function (p) { return [r.x + p[0], r.y + p[1]]; }), 4, base,
      D.O.ink3);
    // 顶面亮块（硬边平涂）
    D.blob(x, r.pts.map(function (p) { return [r.x + p[0] * 0.62, r.y + p[1] * 0.62 - r.r * 0.16]; }), 4,
      r.dark ? rock : rockHi, D.O.none);
  }
  // 环境装饰物
  var draw = PROP_DRAW[a.prop] || PROP_DRAW.bone;
  var props = a.props || [];
  for (var b = 0; b < props.length; b++) {
    var it = props[b];
    x.save();
    x.translate(it.x, it.y); x.rotate(it.rot); x.scale(it.s, it.s);
    draw(x, it.kind, pal || PAL_PAL_FALLBACK);
    x.restore();
  }
}

/* =========================================================
   大厅 / 枢纽：**能走的两间屋**（渲染这一半）
   ---------------------------------------------------------
   用户对这一块的要求（见 `hall.ts` 的文件头）：不是"一排按钮卡"，
   是一间真的房间 —— 有地面、墙、货箱、站在地上的门与人。

   所以这一块画三样东西：
     · 静态：地面（棋盘 + 灯圈 + 中央毯）、墙、装饰
     · 站点：传送门（发光的门环 + 门牌号）、设施、NPC（站在地上的人）、公告板
     · 玩家：复用战斗里**同一个角色画法**（骨架 / 呼吸 / 走路都在那一条路上）

   渲染层只读世界状态：这一块不写任何 `Game` 字段，也不认识状态机。
   ========================================================= */
var HALL_WALL_FILL = '#332e2a';
var HALL_WALL_TOP = '#453e38';
var HALL_WALL_EDGE = { outline: PAL.INK, outlineWidth: 3 };
var HALL_THIN_EDGE = { outline: PAL.INK, outlineWidth: 2.5 };
var HALL_LIT_SOFT = { alpha: 0.09, outlineWidth: 0 };
var HALL_LIT_HARD = { alpha: 0.13, outlineWidth: 0 };
var HALL_LABEL = { outline: PAL.INK, outlineWidth: 4, weight: 700 };
var HALL_HINT = { outline: PAL.INK, outlineWidth: 5, weight: 700 };
var HALL_GATE_A = { alpha: 0.85, outline: PAL.INK, outlineWidth: 2.5 };

function hallGateColor(module) {
  if (module === 'combat') return '#c47a5c';
  if (module === 'manage') return '#b8a45c';
  if (module === 'grow') return '#8fc47a';
  return PAL.STEEL;
}

function drawHallFloor(x, room) {
  D.rect(x, 0, 0, room.w, room.h, room.floor.base, D.O.none);
  /* 棋盘格：64px 一格（与 `hall.ts` 的连通性网格 12px 无关 —— 那是碰撞用的，
     这是给人看的）。格子只画一半（另一半留 base），于是地面有走向、不花。 */
  var tile = 64;
  for (var iy = 0; iy * tile < room.h; iy++) {
    for (var ix = 0; ix * tile < room.w; ix++) {
      if ((ix + iy) % 2) continue;
      D.rect(x, ix * tile, iy * tile, tile, tile, room.floor.alt, D.O.none);
    }
  }
  // 中央毯：把"屋子中间"说出来（也提示玩家这里可以站着看四周）
  D.roundRect(x, room.w / 2 - 250, room.h / 2 - 180, 500, 360, 26,
    room.floor.rug, HALL_THIN_EDGE);
  /* 灯：同心圆 + alpha 的平涂光晕。**不是渐变** —— 美术宪法禁渐变，
     所以"光"是几层不同 alpha 的圆，不是一个 radial gradient。 */
  for (var l = 0; l < room.lamps.length; l++) {
    var lp = room.lamps[l];
    D.circle(x, lp.x, lp.y, lp.r, room.floor.lit, HALL_LIT_SOFT);
    D.circle(x, lp.x, lp.y, lp.r * 0.6, room.floor.lit, HALL_LIT_HARD);
  }
}

function drawHallWalls(x, room) {
  for (var i = 0; i < room.walls.length; i++) {
    var w = room.walls[i];
    D.rect(x, w.x, w.y, w.w, w.h, HALL_WALL_FILL, HALL_WALL_EDGE);
    if (w.w > 16 && w.h > 16) {
      D.rect(x, w.x + 5, w.y + 5, w.w - 10, w.h - 10, HALL_WALL_TOP, D.O.none);
    }
  }
}

/** 装饰：不挡路（挡路的那些在 `room.walls` 里，这里只是"屋里有什么"） */
function drawHallProps(x, room, t) {
  for (var i = 0; i < room.props.length; i++) {
    var p = room.props[i];
    var s = p.s || 1;
    switch (p.kind) {
      case 'crate':
        D.rect(x, p.x - 20 * s, p.y - 20 * s, 40 * s, 40 * s, PAL.WOOD, HALL_THIN_EDGE);
        D.rect(x, p.x - 20 * s, p.y - 4 * s, 40 * s, 8 * s, PAL.WOOD_D, D.O.none);
        break;
      case 'barrel':
        D.roundRect(x, p.x - 15 * s, p.y - 19 * s, 30 * s, 38 * s, 7 * s, PAL.WOOD_D, HALL_THIN_EDGE);
        D.rect(x, p.x - 15 * s, p.y - 4 * s, 30 * s, 5 * s, PAL.WOOD, D.O.none);
        break;
      case 'pillar':
        D.circle(x, p.x, p.y, 23 * s, HALL_WALL_TOP, HALL_THIN_EDGE);
        D.circle(x, p.x, p.y, 13 * s, '#5a5148', { outline: PAL.INK, outlineWidth: 2 });
        break;
      case 'pipe':
        D.rect(x, p.x - 58 * s, p.y - 9 * s, 116 * s, 18 * s, '#6f6a62', HALL_THIN_EDGE);
        D.circle(x, p.x - 58 * s, p.y, 12 * s, '#7d786f', HALL_THIN_EDGE);
        break;
      case 'mushroom':
        D.rect(x, p.x - 5 * s, p.y - 4 * s, 10 * s, 16 * s, PAL.CREAM, D.O.none);
        D.ellipse(x, p.x, p.y - 6 * s, 22 * s, 12 * s, 0, '#8a5f86', HALL_THIN_EDGE);
        break;
      case 'fire': {
        /* 火堆：石圈 + 火苗。火苗的抖动是**表现**（Game.time 驱动），
           不影响任何模拟 —— 枢纽是这一局的"家"，家里有火。 */
        D.circle(x, p.x, p.y, 30 * s, '#4a4038', HALL_THIN_EDGE);
        var fl = Math.sin(t * 7.3) * 2.4;
        D.circle(x, p.x + fl * 0.4, p.y - 8 * s, 15 * s, '#e08a34', D.O.none);
        D.circle(x, p.x - fl * 0.3, p.y - 16 * s, 9 * s, '#f2c85e', D.O.none);
        break;
      }
      case 'sign':
        D.rect(x, p.x - 3, p.y - 8, 6, 30, PAL.WOOD_D, D.O.none);
        D.rect(x, p.x - 26, p.y - 30, 52, 26, PAL.WOOD, HALL_THIN_EDGE);
        break;
    }
  }
}

/** 一个站点：门环 / 设施 / 站在地上的人 / 公告板 */
function drawHallSpot(x, s, t, playerNear) {
  var spr = null;
  x.save();
  if (playerNear) {
    D.circle(x, s.x, s.y + 8, s.r + 10, '#f2e6c8', { alpha: 0.13, outlineWidth: 0 });
  }
  switch (s.kind) {
    case 'portal':
    case 'device':
    case 'door': {
      var col = hallGateColor(s.module);
      if (s.kind === 'door') col = PAL.WOOD;
      // 门环：地上的一个椭圆环 + 深色底（"走进去"这件事要看得见）
      D.ellipse(x, s.x, s.y + 10, s.r * 1.15, s.r * 0.62, 0, '#241f1c', HALL_THIN_EDGE);
      D.ellipse(x, s.x, s.y + 6, s.r * 0.98, s.r * 0.5, 0, col, HALL_GATE_A);
      if (s.kind !== 'door') {
        // 门柱上的一对灯：告诉玩家"这是能用的"
        var blink = 0.55 + Math.sin(t * 3 + s.x * 0.02) * 0.25;
        D.circle(x, s.x - s.r * 0.9, s.y - s.r * 0.2, 7, PAL.GOLD, { alpha: blink, outlineWidth: 0 });
        D.circle(x, s.x + s.r * 0.9, s.y - s.r * 0.2, 7, PAL.GOLD, { alpha: blink, outlineWidth: 0 });
      }
      spr = S.stationPortrait(s.id, s.kind === 'door' ? 72 : 92);
      if (spr) {
        var bob = Math.sin(t * 2.1 + s.x * 0.013) * 3;
        x.drawImage(spr.canvas, s.x - spr.width / 2, s.y - 92 + bob);
      }
      D.text(x, s.name, s.x, s.y + 46, 15, PAL.CREAM, HALL_LABEL);
      break;
    }
    case 'board':
      D.rect(x, s.x - 34, s.y - 8, 68, 10, PAL.WOOD_D, D.O.none);
      D.rect(x, s.x - 46, s.y - 62, 92, 58, PAL.WOOD, HALL_THIN_EDGE);
      D.rect(x, s.x - 36, s.y - 52, 30, 20, PAL.PAPER, D.O.none);
      D.rect(x, s.x + 2, s.y - 50, 26, 16, PAL.CREAM, D.O.none);
      D.rect(x, s.x - 30, s.y - 24, 58, 12, PAL.CREAM, D.O.none);
      D.text(x, s.name, s.x, s.y + 34, 15, PAL.CREAM, HALL_LABEL);
      break;
    case 'npc':
      D.ellipse(x, s.x, s.y + s.r * 0.55, s.r * 0.72, s.r * 0.26, 0,
        'rgba(16,13,12,0.28)', D.O.none);
      spr = S.stationPortrait(s.id, 96);
      if (spr) {
        var bobN = Math.sin(t * 1.7 + s.y * 0.01) * 2.2;
        x.drawImage(spr.canvas, s.x - spr.width / 2, s.y - 62 + bobN);
      }
      D.text(x, s.name, s.x, s.y + 48, 15, PAL.CREAM, HALL_LABEL);
      break;
  }
  x.restore();
}

/** 站在谁面前就在他头上写一句"按 E 做什么" */
function drawHallPrompt(x, h) {
  var s = h.near;
  if (!s) return;
  var text = s.kind === 'npc' ? ('按 E 与' + s.name + '说话')
    : s.kind === 'board' ? '按 E 读这一局的账'
      : ('走进' + s.name + (s.screen ? ' · 或按 E' : ''));
  D.text(x, text, s.x, s.y - 104, 16, PAL.CREAM, HALL_HINT);
}

/** 屋里那个玩家：复用战斗里同一个角色画法（骨架 / 呼吸 / 走路都在那条路上） */
function drawHallPlayerActor(x, h, sess) {
  if (!sess || !sess.player) return;
  var src = sess.player;
  var weapons = [];
  for (var i = 0; i < src.weapons.length; i++) {
    var w = src.weapons[i];
    weapons.push({ def: w.def, index: w.index, swing: 0 });
  }
  var view = {
    x: h.x, y: h.y, px: h.px, py: h.py, r: h.r,
    vx: h.vx, vy: h.vy, aim: h.aim,
    animT: h.animT, moveBlend: h.moveBlend,
    rig: src.rig, charDef: src.charDef, weapons: weapons,
    invuln: 0, hurtFlash: 0, rage: 0,
    hp: sess.stats.maxHp
  };
  D.ellipse(x, h.x, h.y + h.r * 0.94, h.r * 0.9, h.r * 0.3, 0,
    'rgba(16,13,12,0.24)', D.O.none);
  drawPlayer(x, view, sess);
}

/** 一间屋的整帧：地面 → 墙 → 装饰 → 站点 → 玩家 → 提示 */
function drawHall(x, h) {
  var room = h.def;
  if (!room) return;
  var t = Game.time;
  R.phase = 'hallFloor';
  drawHallFloor(x, room);
  R.phase = 'hallWalls';
  drawHallWalls(x, room);
  R.phase = 'hallProps';
  drawHallProps(x, room, t);
  R.phase = 'hallSpots';
  for (var i = 0; i < h.spots.length; i++) {
    if (!R.inView(h.spots[i].x, h.spots[i].y, h.spots[i].r + 70)) continue;
    drawHallSpot(x, h.spots[i], t, h.near === h.spots[i]);
  }
  R.phase = 'hallPlayer';
  drawHallPlayerActor(x, h, Game.getSession());
  R.phase = 'hallPrompt';
  drawHallPrompt(x, h);
}

/* =========================================================
   玩家
   ========================================================= */
/** 没有环境时的降级配色（默认环境 = 改造前那套红棕，逐位相同） */
var PAL_PAL_FALLBACK: ThemePal = {
  base: PAL.G2, tones: PAL_TONES,
  pebble: PAL.PEBBLE, pebbleHi: PAL.PEBBLE_HI,
  rock: PAL.ROCK, rockHi: PAL.ROCK_HI, rockDark: PAL.ROCK_DARK,
  crack: PAL.G6, propA: PAL.BONE, propB: PAL.BONE
};

/* ---- 场景道具层烘焙缓存（岩石 + 环境装饰物） ----
   岩石与环境装饰物每波完全静态，但每帧要花约 900 次绘制调用（实测占全部绘制的一半）。
   与地面同样处理：换波时烘焙进离屏 canvas，每帧只 blit 一次。
   之所以与地面分成两层，是为了保持"地面 → 血迹贴花 → 岩石"的原有叠放顺序。 */
R.props = { canvas: null, wave: -1, theme: '', scale: 0 };

function bakeProps(a) {
  return bakeLayer(R.props, a.wave, a.theme, drawPropsStatic, a);
}

function drawRocks(x, a) {
  var baked = bakeProps(a);
  if (baked) x.drawImage(baked, -GROUND_PAD, -GROUND_PAD, Arena.W + GROUND_PAD * 2, Arena.H + GROUND_PAD * 2);
  else drawPropsStatic(x, a);   // 无 DOM 环境下的降级路径
}

/** 战场边界（粗黑围墙，厚重的造型语言）。墙色跟着环境走，
 *  否则换了环境之后围墙还是红棕的，边界会显得像贴上去的。 */
function drawBounds(x, pal) {
  var t = 14;
  var wall = (pal && pal.rockDark) || PAL.ROCK_DARK;
  x.save();
  x.fillStyle = wall;
  x.fillRect(-t - 2, -t - 2, Arena.W + (t + 2) * 2, t + 2);
  x.fillRect(-t - 2, Arena.H, Arena.W + (t + 2) * 2, t + 2);
  x.fillRect(-t - 2, 0, t + 2, Arena.H);
  x.fillRect(Arena.W, 0, t + 2, Arena.H);
  x.strokeStyle = PAL.INK; x.lineWidth = 3;
  x.strokeRect(-t - 2, -t - 2, Arena.W + (t + 2) * 2, t + 2);
  x.strokeRect(-t - 2, Arena.H, Arena.W + (t + 2) * 2, t + 2);
  x.strokeRect(-t - 2, 0, t + 2, Arena.H);
  x.strokeRect(Arena.W, 0, t + 2, Arena.H);
  x.restore();
}

/* =========================================================
   分层视差背景（`art_parallax.ts` 定层，本文件定画法）
   ---------------------------------------------------------
   为什么它**画在静态层之上**（而不是被盖住）：静态层那两张烘焙画布是
   `Arena.W + 80 × Arena.H + 80` 的大矩形，它自己就盖住了整个可视区 ——
   画在它下面等于没画。所以视差层只画在**静态层之外的那一圈**：
   地面外扩 40px 之外、以及屏幕边缘到战场边界之间的余量。
   效果上这正是想要的：玩家看到的是"墙外还有远景"，而不是"地面下有图案"。

   代价是每帧多画几道，所以 `R.parallax` 把份数记下来供体检读 ——
   视差是最容易悄悄变贵的一层（多一层 = 多一批副本）。
   ========================================================= */
R.parallax = { layers: 0, items: 0 };
R.parallax = { layers: 0, items: 0 };

/* 视差的绘制选项**共享**（不是每帧新建）：
   `test/render-check.mjs` 会统计"每帧新建的选项对象数"，而它当场抓到了
   这里 —— 第一版每个副本都写了一个选项字面量，于是每帧多分配 7.8 个对象。
   那本身不致命（预算是 60），但它是一条**会随层数与份数一起长大**的债。 */
var PAR_OPTS = { outline: PAL.INK, outlineWidth: 2, close: true };
var PAR_OPTS2 = { outlineWidth: 0 };

function drawParallax(x, pal) {
  R.parallax.layers = 0;
  R.parallax.items = 0;
  var tones = (pal && pal.tones) || PAL_TONES;
  var cam = R.cam;
  var tick = Game.time * 60;
  var horizon = Arena.H * 0.30;

  for (var i = 0; i < ArtParallax.LAYERS.length; i++) {
    var ly = ArtParallax.LAYERS[i];
    var items = ArtParallax.layout(ly, cam.x, cam.y, cam.w, cam.h, Arena.W, Arena.H, tick);
    if (!items.length) continue;
    R.parallax.layers++;
    /* 颜色：越远越暗。索引由 depth 算（不是由数组下标算）——
       数组顺序一改，颜色就会跟着错位，而"哪一层该更亮"是**语义**不是顺序。 */
    var toneIdx = tones.length - 1 - Math.min(tones.length - 1, ly.depth);
    var fill = tones[Math.max(0, toneIdx)] || PAL.G6;
    /* 先铺一整条底（一个矩形盖住这一层要占的高度），再在上面画起伏。
       起伏只**往上**长：于是这一层是一整片剪影，中间不会有缝。 */
    var lift = 20 + ly.depth * 14;
    var w = ly.repeat;

    for (var k = 0; k < items.length; k++) {
      var it = items[k];
      R.parallax.items++;
      var top = horizon - lift * (0.5 + it.flick * 0.25);
      /* 底：从起伏顶一直到战场底 */
      D.rect(x, it.x, top, w + 1, Arena.H - top + 40, fill, PAR_OPTS2);
      /* 脊线：三个取样点的折线（低多边形是有意的：平涂美术语言里
         "一条硬边折线"比"一条平滑曲线"更像剪影） */
      D.poly(x, [
        [it.x, top + 10 + it.flick * 5],
        [it.x + w * 0.5, top],
        [it.x + w, top + 12 + (1 - it.flick) * 5]
      ], fill, PAR_OPTS);
    }
  }
}

/* =========================================================
   门开合动画的**唯一读点**
   ---------------------------------------------------------
   门清完之后是"锁着 → 开着"的瞬时切换。改造前它真的就是瞬时的 ——
   一件本来可以演的事被吞掉了（玩家只看到门闩凭空消失）。
   现在门闩抬起 0.3 秒（`art_parallax.ts` 的 `doorOpen` clip），
   而且**播的是同一个 clip**：改动画只改那张关键帧表。

   计时放在渲染层而不是世界状态里：它是**纯表现**，不该进存档，
   也不该让模拟层知道"门闩抬到哪了"。渲染层只读世界状态，
   所以这里只记住"这一间是什么时候变清的"。
   ========================================================= */
var doorAnim: Record<string, { cleared: boolean; t: number }> = Object.create(null);
const DOOR_OPEN_CLIP = 'doorOpen';

/** 门闩当前的抬升量（1 = 完全压住缺口，0 = 完全抬起）。`dt` 推进计时，可单测。 */
R.doorBoltLift = function (dt, roomId, cleared) {
  var key = String(roomId || '');
  var rec = doorAnim[key];
  var step = Math.max(0, Number(dt) || 0);
  if (!rec) rec = doorAnim[key] = { cleared: !!cleared, t: 0 };
  if (rec.cleared !== !!cleared) { rec.cleared = !!cleared; rec.t = 0; }

  /* 锁着 = 门闩压到底（而且**计时也推进**：不然开门之后第一帧
     会从"上一次关门之后累积了很久"的那个 t 开始，动画一上来就播完了）。
     注意计时在**早退之前**推进 —— 第一版把它放在后面，
     于是"状态刚变的那一帧把 t 清 0、然后就早退"，门闩永远停在 t=0。 */
  var clip = ArtParallax.clip(DOOR_OPEN_CLIP);
  rec.t += step;
  if (!cleared || !clip) return 1;
  return ArtParallax.valueAt(clip, rec.t);
};

/* =========================================================
   门与暗门墙（房间制的"出口"必须看得见）
   ---------------------------------------------------------
   门画在四面墙的**开口**上：清干净了是亮色的门框，战斗中挂上横闩（锁着）。
   暗门画成一段有裂纹的墙 —— 裂纹的走向由地图数据里的 clueSeed 决定，
   所以"这一面墙看起来不太对"是同种子下**每个玩家都能看到的同一个线索**，
   而不是随机闪烁。这是隐藏要素唯一的入口，不能靠猜。
   ========================================================= */
function drawDoors(x, sess, dt) {
  var cur = sess.map ? Dungeon.roomById(sess.map, sess.roomId) : null;
  if (!cur) return;
  var half = Dungeon.DOOR_HALF * Math.min(Arena.W, Arena.H);
  var t = 14;
  for (var d = 0; d < 4; d++) {
    if (!cur.doors[d]) continue;
    var f = Dungeon.doorFrac(d);
    var cx = U.clamp(f.fx * Arena.W, Arena.PAD, Arena.W - Arena.PAD);
    var cy = U.clamp(f.fy * Arena.H, Arena.PAD, Arena.H - Arena.PAD);
    var horiz = (d === 0 || d === 2);           // 门开在横墙上
    x.save();
    x.translate(cx, cy);
    if (cur.cleared) {
      // 开着的门：地面缺口 + 两侧门柱
      x.fillStyle = PAL.G6;
      if (horiz) x.fillRect(-half, -t - 2, half * 2, t + 4);
      else x.fillRect(-t - 2, -half, t + 4, half * 2);
      x.fillStyle = PAL.WOOD_D || PAL.ROCK_DARK;
      if (horiz) {
        x.fillRect(-half - 9, -t - 4, 9, t + 5);
        x.fillRect(half, -t - 4, 9, t + 5);
      } else {
        x.fillRect(-t - 4, -half - 9, t + 5, 9);
        x.fillRect(-t - 4, half, t + 5, 9);
      }
      x.strokeStyle = PAL.INK; x.lineWidth = 3;
      x.strokeRect(horiz ? -half - 9 : -t - 4, horiz ? -t - 4 : -half - 9,
        horiz ? half * 2 + 18 : t + 5, horiz ? t + 5 : half * 2 + 18);
    } else {
      // 锁着的门：横闩压在缺口上
      x.fillStyle = PAL.ROCK_DARK;
      if (horiz) x.fillRect(-half, -t - 2, half * 2, t + 4);
      else x.fillRect(-t - 2, -half, t + 4, half * 2);
      x.strokeStyle = PAL.INK; x.lineWidth = 3;
      x.beginPath();
      if (horiz) { x.moveTo(-half, -t / 2); x.lineTo(half, -t / 2); }
      else { x.moveTo(-t / 2, -half); x.lineTo(-t / 2, half); }
      x.stroke();
    }
    /* 门闩抬起的那 0.3 秒（`doorBoltLift` → `art_parallax.ts` 的 doorOpen clip）。
       画在**两种状态之上**：清干净的那一刻门闩不会凭空消失，而是抬起来。
       抬起的幅度用 `lift`（1 = 还压着，0 = 已经抬起），方向与门所在的墙垂直。 */
    var lift = R.doorBoltLift(dt, cur.id, cur.cleared);
    if (lift > 0.02) {
      var boltCol = PAL.ROCK_DARK;
      x.globalAlpha = U.clamp(lift, 0, 1);
      x.fillStyle = boltCol;
      var bw = 5;
      if (horiz) x.fillRect(-half, -t / 2 - bw / 2 - (1 - lift) * (t + 10), half * 2, bw);
      else x.fillRect(-t / 2 - bw / 2 - (1 - lift) * (t + 10), -half, bw, half * 2);
      x.globalAlpha = 1;
    }
    x.restore();
  }
  // 暗门墙：裂纹 + 血量
  for (var i = 0; i < sess.wallsNow.length; i++) {
    var w = sess.wallsNow[i];
    x.save();
    x.translate(w.x, w.y);
    var n = 7;
    x.strokeStyle = PAL.INK; x.lineWidth = 2;
    x.beginPath();
    for (var k = 0; k <= n; k++) {
      var u = (k / n) * 2 - 1;                       // -1..1 沿墙展开
      var v = Math.sin(u * 7 + (w.x + w.y) * 0.02) * 0.35 + (k % 2 ? 0.24 : -0.2);
      var px = (w.dir === 0 || w.dir === 2) ? u * half : v * t;
      var py = (w.dir === 0 || w.dir === 2) ? v * t : u * half;
      if (k === 0) x.moveTo(px, py); else x.lineTo(px, py);
    }
    x.stroke();
    // 被打过之后显示残量（打到哪了一目了然）
    var k2 = U.clamp(w.hp / w.maxHp, 0, 1);
    if (k2 < 1) {
      var barW = 46, barH = 5;
      x.fillStyle = '#2b2622';
      x.fillRect(-barW / 2, (w.dir === 0 ? -34 : 34), barW, barH);
      x.fillStyle = PAL.E4;
      x.fillRect(-barW / 2 + 1, (w.dir === 0 ? -33 : 35), (barW - 2) * k2, barH - 2);
    }
    x.restore();
  }
}

/* =========================================================
   玩家
   ========================================================= */
/* =========================================================
   显示帧插值
   逻辑帧固定 1/60，显示帧可能 144Hz —— 渲染时用 alpha 在"上一逻辑帧"与
   "当前逻辑帧"之间取位置，否则高刷屏上会看到同一逻辑帧被画两遍的顿挫。
   alpha=1 时画的就是当前逻辑帧（任何不设 alpha 的调用方都保持旧行为）。
   只插值会动的实体（角色 / 怪 / 子弹），粒子与贴花不做：它们小而短命，
   而每帧给几百个粒子套一层变换的代价换不来可见收益。
   ========================================================= */
R.alpha = 1;

/** 屏幕抖动倍率（设置项 "shake"；0 = 完全关掉，1 = 正常，2 = 加强） */
R.shakeScale = 1;

/** 上一次逻辑帧位置 → 本帧要画的位置 */
R.lerpPos = function (prev, cur) {
  return prev + (cur - prev) * R.alpha;
};

/** 给"按自身 x/y 绘制"的部件用的偏移量（drawn = x + off） */
R.posOffset = function (prev, cur) {
  return (prev - cur) * (1 - R.alpha);
};

/* =========================================================
   角色律动（呼吸 / 走路）
   模拟层只给 animT（统一相位，永不重置）与 moveBlend（走路权重），
   曲线在这里求，因此没有"两套公式硬切"造成的突跳。
   呼吸 = 轻微挤压拉伸（体积守恒）+ 小幅上下浮动；走路 = 弹跳 + 摆臂。
   ========================================================= */
var BREATH_HZ = 2.6;      // 呼吸频率（弧度/秒 → 周期约 2.4 秒）
var BREATH_BOB = 1.15;    // 呼吸浮动幅度（像素）
var BREATH_SQUASH = 0.024;// 呼吸形变（±2.4%）
var BREATH_ARM = 0.22;    // 待机轻微摆臂
var WALK_HZ = 5.2;
var WALK_BOB = 3.2;
var WALK_ARM = 0.9;

/**
 * @returns {{bob:number, sx:number, sy:number, armSwing:number}}
 *   bob  纵向浮动（负值向上）
 *   sx/sy 横向/纵向缩放（呼吸挤压，sx*sy≈1 保持体积）
 */
R.playerAnim = function (p) {
  var t = p.animT || 0;
  var walk = p.moveBlend === undefined ? 0 : p.moveBlend;
  var breathe = Math.sin(t * BREATH_HZ);
  var bounce = Math.abs(Math.sin(t * WALK_HZ));
  var bob = U.lerp(breathe * -BREATH_BOB, bounce * -WALK_BOB, walk);
  var sy = 1 + U.lerp(breathe * BREATH_SQUASH, 0, walk);
  var armSwing = U.lerp(Math.sin(t * BREATH_HZ + 1.1) * BREATH_ARM,
    Math.sin(t * WALK_HZ) * WALK_ARM, walk);
  return { bob: bob, sx: 1 / sy, sy: sy, armSwing: armSwing };
};

/* 角色绘制的复用对象：皮肤 / 骨架姿态参数 / 部件参数 / 挂点坐标。
   每帧新建这些对象就是每帧几次分配，改成模块级复用（同步用完即弃）。 */
var _skin = { base: PAL.SKIN, hi: '#fffdf2', sh: PAL.SKIN_SH, dp: PAL.SKIN_DP, dot: PAL.BRONANA_DOT };
var _pose = { x: 0, y: 0, rx: 0, ry: 0, bob: 0, armSwing: 0 };
var _atlasWarm = false;   // 姿态图集预热过一次就够
var _parts = {
  skin: _skin, seed: 1, face: 0, mood: 'idle',
  eyeStyle: 'stern', mouthStyle: 'flat', dots: true, outlineWidth: 0
};
var _seat = { x: 0, y: 0 };
var _flashOpt = { seed: 1, outlineWidth: 0 };

function drawPlayer(x, p, sess) {
  /* 外观：**已经折好的值**（`newSession` 从存档里折一次存进玩家对象）。
     所以这里只做一次取色，不调任何规则入口 —— 渲染层每帧都要它。
     缺省（`p.look` 为 null）逐位退回改造前的两行：职业本色 + 职业脸型。
     ⚠ 取色**走后端那一个口**（`Appearance.skinFor` / `eyesOf`），
       不再在这里写 `p.charDef.tint[0]` 与 `p.charDef.face || 'stern'` ——
       那两行以前与 `sprites.ts` 各写了一遍（加一种脸型要改三处）。 */
  if (p.look && p.look.skin && p.look.skin.base) {
    _skin.base = p.look.skin.base;
    _skin.sh = p.look.skin.sh || p.look.skin.base;
    /* 高光也跟色板走：`wheat`（缺省档）的 `hi` 就是白色，
       于是"没捏人"与"捏了缺省色"是同一件事。 */
    _skin.hi = p.look.skin.hi || '#fffdf2';
    _skin.dp = p.look.skin.dp || _skin.sh;
  } else {
    _skin.base = (p.charDef.tint && p.charDef.tint[0]) || PAL.SKIN;
    _skin.sh = (p.charDef.tint && p.charDef.tint[1]) || PAL.SKIN_SH;
    _skin.hi = '#fffdf2';
    _skin.dp = PAL.SKIN_DP;
  }

  // 显示帧插值后的位置（alpha=1 时就是 p.x/p.y，与改造前一致）
  var ppx = R.lerpPos(p.px === undefined ? p.x : p.px, p.x);
  var ppy = R.lerpPos(p.py === undefined ? p.y : p.py, p.y);

  // 影子与拾取范围圈已经挪到 drawUnderlays（层带 shadow / marker，压在实体之下）
  var blink = p.invuln > 0 && Math.floor(p.invuln * 18) % 2 === 0;
  var an = R.playerAnim(p);      // 呼吸 / 走路律动

  // 骨架：躯干缩放就是半径，四肢与五官挂在骨头上
  var rig = p.rig;
  var seed = U.seedFromStr(p.charDef.id) % 100;
  var rx = p.r * an.sx, ry = p.r * Bronana.RY_RATIO * an.sy;
  _pose.x = ppx; _pose.y = ppy; _pose.rx = rx; _pose.ry = ry;
  _pose.bob = an.bob; _pose.armSwing = an.armSwing;
  Bronana.pose(rig, _pose);

  if (!blink) {
    // 呼吸形变：纵向 sy、横向 1/sy，保持体积不变（只鼓不胖）
    _parts.skin = _skin;
    _parts.seed = seed;
    _parts.face = Math.cos(p.aim) > 0.2 ? 1 : (Math.cos(p.aim) < -0.2 ? -1 : 0);
    _parts.mood = p.hurtFlash > 0 ? 'hurt' : 'idle';
    /* 脸型**只走一个口**（`Appearance.eyesOf`：捏人挑的 > 职业本色 > stern）。
       这一行与 `sprites.ts` 的预热各写过一遍 `charDef.face || 'stern'` ——
       加一种脸型就要改三处，而漏改不会报错。 */
    _parts.eyeStyle = (p.look && p.look.eyeStyle) ? p.look.eyeStyle : Appearance.eyesOf(p.charDef, '');
    _parts.dots = true;

    // 身体走**姿态图集**：一次 drawImage 顶掉原本 300+ 次绘制调用。
    // 首次进场先把呼吸的所有档位烘完（否则每跨一档现烘一张，会有一帧抖动）
    if (!_atlasWarm) {
      _atlasWarm = true;
      S.warmPlayerAtlas(p.charDef, { r: p.r, skin: _skin, seed: seed, eyeStyle: _parts.eyeStyle });
    }
    // 手臂/武器仍是矢量（它们每帧都在转），用的是同一个骨架、同一套部件层序。
    var body = S.playerBodySprite(p.charDef, {
      r: p.r, sy: an.sy, skin: _skin, seed: seed, face: _parts.face,
      mood: _parts.mood, eyeStyle: _parts.eyeStyle, dots: true
    });
    if (body) {
      x.drawImage(body.canvas, ppx - body.width / 2, ppy + an.bob - body.height / 2,
        body.width, body.height);
      Bronana.draw(x, rig, _parts, Bronana.BAKED_PARTS);     // 只画手臂等"会动的部件"
    } else {
      Bronana.draw(x, rig, _parts);                          // 无 DOM 环境的降级路径
    }
  }

  // 武器：挂在骨架的武器挂点上（与模拟层同一根骨头、同一份排布公式）
  for (var i = 0; i < p.weapons.length; i++) {
    var w = p.weapons[i];
    var bone = Bronana.seat(rig, w.index === undefined ? i : w.index, p.aim, p.r, ppx, ppy);
    Bronana.seatPoint(rig, bone, _seat);

    var rot = p.aim;
    if (w.def.type === 'melee') {
      var swingA = w.swing > 0 ? w.swing : 0;
      var half = Bronana.meleeArc(w.def) / 2;   // 与模拟层的命中锥同一个来源
      rot = p.aim - half + half * 2 * (1 - swingA);
    }
    x.save();
    x.translate(_seat.x, _seat.y);
    // 武器走**图集**：形状烘一次，这里只 translate + rotate（每把 1 次 drawImage）
    var wspr = S.weaponSprite(w.def.kind, w.def.tints, 0.82, w.swing || 0);
    if (wspr) {
      x.rotate(rot);
      x.drawImage(wspr.canvas, -wspr.width / 2, -wspr.height / 2, wspr.width, wspr.height);
    } else {
      S.drawWeapon(x, w.def.kind, rot, w.def.tints, w.swing || 0, 0.82);   // 无 DOM 降级
    }
    x.restore();
  }

  /* 配件（时装）：画在身体与武器**之后** —— 它是戴在头上的东西，
     压在眼睛那一线的护目镜更必须在五官之后（否则会被脸盖住）。
     ⚠ 只有捏过人才有它（`p.accessory` 缺省是空串 → 一次都不调）。
     dy 按身体半径走（`Appearance.accessoryShape`），所以换个角色不会陷进头里。 */
  if (p.accessory) {
    S.drawAccessory(x, ppx, ppy + an.bob - ry * 0.72, ry, p.accessory);
  }

  // 受击红闪（平涂色块覆盖，非发光）
  if (p.hurtFlash > 0) {
    x.save();
    x.globalAlpha = Math.min(0.45, p.hurtFlash * 1.5);
    _flashOpt.seed = seed;
    D.bronana(x, ppx, ppy + an.bob, rx, ry, '#e2564f', _flashOpt);
    x.restore();
  }

  // 低血警示环
  var hpK = p.hp / sess.stats.maxHp;
  if (hpK < 0.32) {
    x.save();
    x.globalAlpha = 0.5 + Math.sin(Game.time * 8) * 0.3;
    D.arcRing(x, ppx, ppy, p.r + 12, 0, U.TAU, 3, PAL.HP, D.O.empty);
    x.restore();
  }
}

/* =========================================================
   实体绘制
   ---------------------------------------------------------
   画什么、在哪一层、按什么排序，全部登记在 Depth 的注册表里（见 depth.ts）。
   这里只负责把"场上有哪些实体"告诉它：**主循环不再写死绘制顺序**，
   新增一类实体 = 一次 Depth.actor() 注册。

   改造前的顺序是代码顺序：拾取物 → 炮塔 → 怪（内部按 y 排）→ 玩家 → 弹幕 → 粒子。
   两个后果：玩家**永远**压在所有怪之上（y 更大的怪本该挡住玩家），
   拾取物与炮塔永远压在所有怪之下（与 y 无关）。
   ========================================================= */

/** 影子 + 地面标记：单独一遍（否则 A 的影子会压在后画的 B 身上） */
function drawUnderlays(x, sess) {
  for (var i = 0; i < sess.enemies.length; i++) {
    var e = sess.enemies[i];
    if (!R.inView(e.x, e.y, e.r * 3)) continue;
    var ex = R.lerpPos(e.px === undefined ? e.x : e.px, e.x);
    var ey = R.lerpPos(e.py === undefined ? e.y : e.py, e.y);
    D.ellipse(x, ex, ey + e.r * 0.34, e.r * 0.86, e.r * 0.28, 0, 'rgba(16,13,12,0.20)', D.O.none);
  }
  var p = sess.player;
  var ppx = R.lerpPos(p.px === undefined ? p.x : p.px, p.x);
  var ppy = R.lerpPos(p.py === undefined ? p.y : p.py, p.y);
  D.ellipse(x, ppx, ppy + p.r * 0.94, p.r * 0.9, p.r * 0.3, 0, 'rgba(16,13,12,0.18)', D.O.none);
  // 拾取范围是"地面标记"：压在实体之下（改造前它跟玩家一起画，会盖在怪物身上）
  x.save();
  x.globalAlpha = 0.16;
  D.arcRing(x, ppx, ppy, Stats.pickupRadius(sess.stats), 0, U.TAU, 2, PAL.WHITE, D.O.empty);
  x.restore();
}

/** 一只怪（含出生环、血条、燃烧环）—— 由 Depth 按 (层带, y, id) 排序后调用 */
function drawOneEnemy(x, e) {
  var ex = R.lerpPos(e.px === undefined ? e.x : e.px, e.x);
  var ey = R.lerpPos(e.py === undefined ? e.y : e.py, e.y);
  if (e.spawnT > 0) {
    // 出生：从地面钻出的纯色圆环
    x.save();
    x.globalAlpha = 1 - e.spawnT / 0.35;
    D.arcRing(x, ex, ey, e.r * (1.6 - e.spawnT * 2), 0, U.TAU, 3, PAL.INK, D.O.empty);
    x.restore();
  }
  /* 钻地中（掘地者）：不画本体，只画一撮被拱起来的土 ——
     "打不到"必须在画面上看得出来，否则玩家会以为自己 miss 了。 */
  if (e.burrowed) {
    var rr = e.r * 0.9;
    D.ellipse ? D.ellipse(x, ex, ey, rr, rr * 0.5, 0, PAL.E6 || PAL.G4, D.O.ink3)
      : D.circle(x, ex, ey, e.r * 0.5, PAL.E6 || PAL.G4, D.O.ink3);
    for (var k2 = 0; k2 < 5; k2++) {
      var a2 = k2 / 5 * U.TAU + Game.time * 0.6;
      D.circle(x, ex + Math.cos(a2) * rr * 0.7, ey + Math.sin(a2) * rr * 0.35,
        2.6, PAL.PEBBLE_HI, D.O.ink2);
    }
    x.save();
    x.globalAlpha = 0.45 + Math.abs(Math.sin(Game.time * 6)) * 0.3;
    D.arcRing(x, ex, ey, e.r * 1.15, 0, U.TAU, 2, PAL.INK, D.O.empty);
    x.restore();
    return;
  }
  S.drawEnemy(x, e, Game.time, ex - e.x, ey - e.y);

  // 血条（仅受伤后显示）
  if (e.hp < e.maxHp && !e.def.boss) {
    var w = Math.max(20, e.r * 1.9), k = U.clamp(e.hp / e.maxHp, 0, 1);
    D.rect(x, ex - w / 2, ey - e.r * 1.65, w, 5, '#3a2f26', D.O.ink16);
    D.rect(x, ex - w / 2, ey - e.r * 1.65, w * k, 5, k > 0.5 ? PAL.E2 : PAL.E3, D.O.none);
  }
  if (e.burn > 0) {
    x.save(); x.globalAlpha = 0.5;
    D.arcRing(x, ex, ey, e.r + 5, 0, U.TAU, 2, PAL.FIRE, D.O.empty);
    x.restore();
  }
  /* 超时狂暴（`overrun`）：以前这个标记**只有模拟层知道** ——
     每只怪速度 ×1.25、伤害 ×1.15、这一间奖励 ×0.8，而画面上没有任何一处说得出
     "它变强了"（comp.ts 的注释写着"渲染层用它画红眼"，但渲染层一次都没读过它）。
     画法与既有两个标记同构、靠**半径**分开：燃烧 = 命中圈 +5、精英 = 身体 +6、
     狂暴 = 精英之外再 +7 的一圈红。 */
  if (e.enraged) {
    var rr2 = e.r * 1.45 + 10 + Math.abs(Math.sin(Game.time * 7)) * 2;
    x.save();
    x.globalAlpha = 0.75;
    D.arcRing(x, ex, ey, rr2, 0, U.TAU, 2, PAL.HP, D.O.empty);
    x.restore();
  }
}

function drawBullets(x, sess) {
  for (var i = 0; i < sess.bullets.length; i++) {
    var b = sess.bullets[i];
    if (!R.inView(b.x, b.y, S.bulletCullR(b))) continue;
    S.drawBullet(x, b, R.posOffset(b.px === undefined ? b.x : b.px, b.x),
      R.posOffset(b.py === undefined ? b.y : b.py, b.y));
  }
}

function drawEnemyBullets(x, sess) {
  for (var i = 0; i < sess.ebullets.length; i++) {
    var b = sess.ebullets[i];
    if (!R.inView(b.x, b.y, b.r + 10)) continue;
    S.drawEnemyBullet(x, b, Game.time, R.posOffset(b.px === undefined ? b.x : b.px, b.x),
      R.posOffset(b.py === undefined ? b.y : b.py, b.y));
  }
}

function drawTurret(x, t) {
  S.drawTurret(x, t, Game.time);
}

function drawPickup(x, p) {
  S.drawPickup(x, p, Game.time);
}

/* ---- 注册可视实体：层带 / y / id / 剔除余量 / 画法 ----
   每个 draw 里顺手把 R.phase 设成该类实体，这样 render-check 的
   "每层绘制调用"统计仍是按类型看的（排序由 Depth 负责，统计不受影响）。 */
Depth.actor('pickup', {
  band: 'actor',
  y: function (p) { return R.lerpPos(p.py === undefined ? p.y : p.py, p.y); },
  id: function (p) { return p.seed || 0; },
  cull: 16,
  draw: function (x, p) { R.phase = 'pickups'; drawPickup(x, p); }
});
Depth.actor('turret', {
  band: 'actor',
  y: function (t) { return t.y; },
  cull: 34,
  draw: function (x, t) { R.phase = 'turrets'; drawTurret(x, t); }
});
Depth.actor('enemy', {
  band: 'actor',
  y: function (e) { return R.lerpPos(e.py === undefined ? e.y : e.py, e.y); },
  id: function (e) { return e.id; },
  // 怪物贴图从脚底向上延伸约 3R，纵向余量按 3R 给
  cull: function (e) { return e.r * 3; },
  draw: function (x, e) { R.phase = 'enemies'; drawOneEnemy(x, e); }
});
Depth.actor('player', {
  band: 'actor',
  y: function (p) { return R.lerpPos(p.py === undefined ? p.y : p.py, p.y); },
  draw: function (x, p, sess) { R.phase = 'player'; drawPlayer(x, p, sess); }
});

/** 把场上所有"站在地上的实体"交给深度队列（剔除余量由注册表给出；不入队就不排序） */
function queueActors(sess) {
  var i, list;
  list = sess.pickups;
  for (i = 0; i < list.length; i++) {
    if (R.inView(list[i].x, list[i].y, Depth.cullRadius('pickup', list[i]))) Depth.push('pickup', list[i]);
  }
  list = sess.turrets;
  for (i = 0; i < list.length; i++) {
    if (R.inView(list[i].x, list[i].y, Depth.cullRadius('turret', list[i]))) Depth.push('turret', list[i]);
  }
  list = sess.enemies;
  for (i = 0; i < list.length; i++) {
    if (R.inView(list[i].x, list[i].y, Depth.cullRadius('enemy', list[i]))) Depth.push('enemy', list[i]);
  }
  Depth.push('player', sess.player);
}

/** 普通命中粒子（不含挥击弧与飘字） */
function drawFx(x, sess) {
  var list = sess.particles;
  for (var i = 0; i < list.length; i++) {
    var p = list[i];
    if (p.kind === 'slash' || p.kind === 'ring') continue;
    if (!R.inView(p.x, p.y, S.cullRadius(p))) continue;
    S.drawObj(x, p);
  }
}

/** 挥击弧 / 冲击环：压在实体与粒子之上 */
function drawSwing(x, sess) {
  var list = sess.particles;
  for (var i = 0; i < list.length; i++) {
    if (list[i].kind !== 'slash' && list[i].kind !== 'ring') continue;
    if (!R.inView(list[i].x, list[i].y, S.cullRadius(list[i]))) continue;
    S.drawObj(x, list[i]);
  }
}

/** 伤害飘字：世界内最上层 */
function drawTexts(x, sess) {
  var texts = sess.textParticles;
  if (!texts) return;
  for (var i = 0; i < texts.length; i++) {
    if (!R.inView(texts[i].x, texts[i].y, S.cullRadius(texts[i]))) continue;
    S.drawObj(x, texts[i]);
  }
}

/* =========================================================
   屏幕层（不随摄像机缩放）
   ========================================================= */
function screenSetup(x) {
  x.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
}

/** 屏幕边缘危险提示（纯色粗边，非渐变） */
function drawDangerFrame(x, sess) {
  var p = sess.player;
  var k = 1 - U.clamp(p.hp / sess.stats.maxHp, 0, 1);
  if (k < 0.55) return;
  var pulse = 0.35 + Math.abs(Math.sin(Game.time * 5)) * 0.45;
  var a = U.clamp((k - 0.55) / 0.45, 0, 1) * pulse;
  var w = R.cam.w, h = R.cam.h, t = 12;

  /* **暗角**（shader 库的 `vignette`）：低血时屏幕四周压暗。
     与下面的红边是**同一类信息的两个层次**：红边说"你在挨打"（瞬时），
     暗角说"你处在危险里"（状态）。两条都留 —— 去掉任何一条都会掉一档可读性。
     它画的是"四块边条"而不是一整块半透明：整块会把整个画面压灰，
     而"低血"要压暗的是**余光**，不是玩家正在看的地方。 */
  var vk = U.clamp((k - 0.55) / 0.45, 0, 1);
  if (vk > 0) {
    ArtShaders.paint(x, 'vignette', R.cam.w, R.cam.h,
      { color: '#100d0c', alpha: 0.10 + vk * 0.22, border: Math.round(R.cam.h * 0.16) });
  }

  x.save();
  x.globalAlpha = a * 0.5;
  x.fillStyle = PAL.HP;
  x.fillRect(0, 0, w, t); x.fillRect(0, h - t, w, t);
  x.fillRect(0, 0, t, h); x.fillRect(w - t, 0, t, h);
  x.restore();
}

/** 屏幕中下方的 Boss / 波次提示 */
function drawBanner(x) {
  /* **有覆盖层时不画**：这条横幅画在 0.22 屏高，而每个界面（暂停 / 结算 / 商店…）
     的标题也在那一带 —— 叠在一起就是"这一[暂停]干净了"那种糊成一团。
     判据用场景表（不是硬编码状态名）：有覆盖层 = 那一屏归 DOM 管，画布让位。 */
  if (Scene.overlayOf(Game.state) !== null) return;
  if (banner.t > 0) {
    var k = U.clamp(banner.t / 2.2, 0, 1);
    x.save();
    x.globalAlpha = Math.min(1, k * 1.6);
    D.text(x, banner.text, R.cam.w / 2, R.cam.h * 0.22, Math.min(46, R.cam.w * 0.045), PAL.CREAM, { outlineWidth: 7 });
    x.restore();
  }
}

/** ?fps=1 性能详情叠加层（屏幕空间，仅开发排查用） */
function drawStats(x, sess) {
var pf = Perf;
  var lines = [
    'FPS ' + (pf && pf.fps ? pf.fps.toFixed(0) : '--') +
    '    帧耗时 ' + (pf && pf.ms ? pf.ms.toFixed(1) + ' ms' : '--'),
    '怪物 ' + sess.enemies.length +
    '    子弹 ' + (sess.bullets.length + sess.ebullets.length),
    '粒子 ' + sess.particles.length + '（文字 ' + (sess.textParticles ? sess.textParticles.length : 0) + '）' +
    '    贴花 ' + sess.decals.length,
    '剔除 ' + (R.culled || 0) + ' 个视口外实体' + (R.ground.canvas ? '    静态层已烘焙' : ''),
    '掉落 ' + sess.pickups.length + '    炮塔 ' + sess.turrets.length
  ];
  var bx = 12, by = 96, w = 232, lh = 19;
  D.roundRect(x, bx, by, w, lh * lines.length + 12, 8, 'rgba(16,13,12,0.74)',
    D.O.ink2);
  for (var i = 0; i < lines.length; i++) {
    D.text(x, lines[i], bx + 11, by + 17 + i * lh, 12, '#f2e6c8',
      { align: 'left', outlineWidth: 0, weight: 400 });
  }

  // 深度叠层（?z=1）：引擎的 debug view 都得能回答"这一帧是按什么顺序画的"。
  // 没有它，层带就只是代码里的一个数字，肉眼无法验证。
  if (R.showDepth) {
    var dl = Depth.describe().split('\n');
    var dy = by + lh * lines.length + 20;
    D.roundRect(x, bx, dy, w + 120, lh * dl.length + 12, 8, 'rgba(16,13,12,0.80)', D.O.ink2);
    for (var k = 0; k < dl.length; k++) {
      D.text(x, dl[k], bx + 11, dy + 17 + k * lh, 11, k === 0 ? '#e8b23c' : '#f2e6c8',
        { align: 'left', outlineWidth: 0, weight: 400 });
    }
  }
}

/* =========================================================
   主渲染
   ========================================================= */
R.draw = function (dt) {
  var x = R.ctx;
  if (!x) return;
  var sess = Game.getSession();
  var hall = Game.hall();
  var arenaData = sess && sess.arena ? sess.arena : null;

  updateCamera(dt);
  updateView();
  screenSetup(x);
  R.phase = 'clear';
  x.clearRect(0, 0, R.cam.w, R.cam.h);
  // 战场外那一圈底色也属于环境：用这一层最暗的那一档，边界之外不会是另一种气候
  x.fillStyle = (hall && hall.def) ? hall.def.floor.edge
    : (arenaData ? arenaData.pal.tones[0] : PAL.G6);
  x.fillRect(0, 0, R.cam.w, R.cam.h);

  /* 大厅 / 枢纽：**能走的两间屋**。这一支没有战斗实体 ——
     画完屋子、站点、玩家就收工（弹幕 / 贴花 / 门闩都不属于这里）。 */
  if (hall) {
    applyCamera(x);
    drawHall(x, hall);
    screenSetup(x);
    R.phase = 'idle';
    return;
  }

  if (!sess) return;

  applyCamera(x);
  var a = arenaData;
  if (a) {
    /* 视差层先画（在静态层**之前**）：静态层那两张烘焙画布盖住整个可视区，
       画在它之后等于把这一层压在墙外面看不见。顺序是"由远及近"：
       视差 → 地面 → 贴花 → 装饰 → 边界。 */
    R.phase = 'parallax'; drawParallax(x, a.pal);
    R.phase = 'ground'; drawGround(x, a);
    R.phase = 'decals'; drawDecals(x);
    R.phase = 'rocks'; drawRocks(x, a);
  }
  R.phase = 'bounds'; drawBounds(x, arenaData ? arenaData.pal : null);
  R.phase = 'doors'; drawDoors(x, sess, dt);
  R.phase = 'underlay'; drawUnderlays(x, sess);
  // 实体：全部交给深度队列，按 (层带, y, id) 排序后绘制（含玩家）
  R.phase = 'actors';
  Depth.reset();
  queueActors(sess);
  Depth.flush(x, sess);
  R.phase = 'ebullets'; drawEnemyBullets(x, sess);
  R.phase = 'bullets'; drawBullets(x, sess);
  R.phase = 'particles'; drawFx(x, sess);
  R.phase = 'swing'; drawSwing(x, sess);
  R.phase = 'texts'; drawTexts(x, sess);

  screenSetup(x);
  R.phase = 'overlay';
  drawDangerFrame(x, sess);
  drawBanner(x);
  if (R.showFps) drawStats(x, sess);
  R.phase = 'idle';
};

/** 主菜单背景（无会话时） */
/**
 * 待机背景（标题页 / 选人页 —— 这两屏没有会话，所以画不了世界）。
 *
 * 改造前它是一张**静态棋盘格**：没有会话时那两屏就是一块不动的花纹。
 * 它算"有背景"，但不算"有个画面"—— 而标题页是玩家看到的第一个东西。
 *
 * 现在它用**已经有的那套视差**（`art_parallax.ts` 的三层）铺一张会动的远景：
 * 镜头缓慢横移（不是跟着玩家 —— 这一屏没有玩家），于是三层以不同速度漂。
 * 这仍然是占位（真做要一张标题插画），但它是**能看的占位**，
 * 而且复用了同一套层与同一套画法 —— 换素材时改的是曲目表，不是这里。
 */
var idleT = 0;
R.drawIdle = function (dt) {
  var x = R.ctx;
  if (!x) return;
  screenSetup(x);
  idleT += Math.max(0, Number(dt) || 0);

  var W = R.cam.w, H = R.cam.h, horizon = H * 0.52;
  /* 天：上下两段平涂（**不是渐变** —— 美术宪法禁渐变），交界处用抖动带过渡 */
  x.fillStyle = PAL.G6;
  x.fillRect(0, 0, W, horizon);
  x.fillStyle = PAL.G1;
  x.fillRect(0, horizon, W, H - horizon);
  D.ditherBand(x, 0, W, horizon - 10, 20, PAL.G6, PAL.G1, 'idle', 0.3);

  /* 三层视差：镜头自己慢慢横移（一圈 60 秒），于是三层以不同速率漂 */
  var camX = ((idleT / 60) % 1) * 4000;
  var tones = [PAL.G5, PAL.G4, PAL.G3];
  for (var i = 0; i < ArtParallax.LAYERS.length; i++) {
    var ly = ArtParallax.LAYERS[i];
    var items = ArtParallax.layout(ly, camX, 0, 0, 0, 8000, 1, idleT * 60);
    var fill = tones[Math.min(tones.length - 1, i)] || PAL.G3;
    var baseY = horizon + (i - 1) * 26;
    var lift = 34 + ly.depth * 16;
    for (var k = 0; k < items.length; k++) {
      var it = items[k];
      var w = ly.repeat;
      var top = baseY - lift * (0.5 + it.flick * 0.3);
      D.rect(x, it.x, top, w + 1, H - top, fill, D.O.none);
      D.poly(x, [
        [it.x, top + 12 + it.flick * 6],
        [it.x + w * 0.5, top],
        [it.x + w, top + 14 + (1 - it.flick) * 6]
      ], fill, { outline: PAL.INK, outlineWidth: 2, close: true });
    }
  }

  /* 地面：一行整齐的石板（占位，但把"这是个俯视游戏"说出来） */
  var step = 44;
  for (var gy = horizon + 40; gy < H; gy += step) {
    for (var gx = -step; gx < W + step; gx += step) {
      var v = ((gx / step | 0) + (gy / step | 0)) % 2;
      x.fillStyle = v ? PAL.G2 : PAL.G1;
      x.fillRect(gx, gy, step - 1, step - 1);
    }
  }
  x.fillStyle = PAL.INK;
  x.fillRect(0, 0, W, 3); x.fillRect(0, H - 3, W, 3);
  x.fillRect(0, 0, 3, H); x.fillRect(W - 3, 0, 3, H);
};

/**
 * 横幅（"第 N 间 · 房型" / "这一间清干净了"）的状态**住在渲染层自己这里**。
 *
 * 以前它是会话字段（`sess.bannerT` / `sess.bannerText`）：一份纯表现的倒计时挂在世界状态上，
 * 模拟层一处都不读它。后果是"同一份状态 + 不同渲染次数"会让会话对象本身不同 ——
 * 那正是"渲染只读"这条纪律要杜绝的东西（也让 `arch-audit` 的写入者名单漏看了 render.ts，
 * 因为它扫的是 `S.` 而这里是 `sess.`）。`sess` 换局（`Game.getSession()` 指向新对象）时清掉，
 * 免得上一局的横幅飘到新一局。
 */
var banner = { text: '', t: 0, sess: null };

/** 更新横幅计时 */
R.tick = function (dt) {
  var sess = Game.getSession();
  if (sess !== banner.sess) { banner.sess = sess; banner.t = 0; banner.text = ''; }
  if (banner.t > 0) banner.t -= dt;
};

R.banner = function (text, dur) {
  if (!Game.getSession()) return;
  banner.text = text;
  banner.t = dur || 2.2;
};

/* =========================================================
   美术资源归属（`art_spec.ts` 的"谁生产了哪一类"）
   ---------------------------------------------------------
   这里登记三类，每一类都对应本文件里一段**真的绘制**：
     · `prop`    —— 环境装饰物（`PROP_DRAW`：白骨 / 菌伞 / 晶簇 / 余烬 / 冰棱）
     · `decal`   —— 叠在地面上的痕迹（血迹环形缓冲 + 命中溅血）
     · `tileset` —— 废墟铺装（`drawRuins` 用 `art_tiles.ts` 的规则铺砖）
     · `bg`      —— 战场边界与外围（`drawBounds`：那圈墙是这一层的"背景框"）
   规范表里声明了 12 类，而"哪几类真的做了"只能由生产它的模块自己说 ——
   不登记的话，"规范里有、项目里没做"这一类会被漏报成通过。 */
Art.noteOwner('prop', 'render.ts');
Art.noteOwner('decal', 'render.ts');
Art.noteOwner('tileset', 'render.ts');
Art.noteOwner('bg', 'render.ts');
/* 屏幕级的 shader 由本文件使用（暗角用在低血警示里）。
   "谁用了哪条 shader"与"谁生产了哪类资源"是两件事，分开登记。 */
ArtShaders.noteUse('vignette', 'render.ts');

export { R };
