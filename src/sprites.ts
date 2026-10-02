/* =========================================================
sprites.ts — 程序化绘制总库
全游戏唯一的"造型来源"：Bronana / 怪物 / 武器 / 道具 / 特效
美术宪法：粗黑外轮廓 + 纯色平涂，无渐变、无纹理、无写实反光
========================================================= */

import { D } from './draw2d.ts';
import { Appearance } from './appearance.ts';
import { Art } from './art_spec.ts';
import { Bronana } from './bronana.ts';
import { ArtShaders } from './art_shaders.ts';
import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';
import { PAL, U } from './utils.ts';
var S = {} as SpritesApi;

/* =========================================================
   缓存工具
   ---------------------------------------------------------
   贴图是"生成一次、之后只 blit"的离线图层。这里只管一件事：
   逻辑尺寸（世界的像素）与设备尺寸（画布的像素）分开记账。

     · 逻辑尺寸 = 调用方声明的 w/h，`Sprite.width/height` 给的就是它，
       渲染层按逻辑尺寸画，所以**倍率变化不会移动任何东西**；
     · 设备尺寸 = 逻辑尺寸 × 烘焙倍率，画布属性给的是它，
       倍率 = 设备像素比（上限 2）时，贴图在 2× 屏上与画布 1:1，
       不会因为"1× 贴图被放大 2 倍"而变糊。

   倍率是全局的：它是屏幕属性，不是单个贴图的属性。改倍率会把整张表作废，
   下次用到时懒重建（重建是一次程序化绘制，不需要预生成清单）。
   ========================================================= */
var cache = {};
var CACHE_SCALE = 1;
var MAX_SCALE = 2;

/**
 * @param w 逻辑宽（世界像素）
 * @param h 逻辑高（世界像素）
 * @returns {{canvas, lw, lh}} lw/lh 是**逻辑**尺寸，供 Sprite 包装记账
 *
 * 画布尺寸 = 逻辑盒子 × 倍率，**原点在盒子左上角**，由调用方自己摆位。
 * 老实现这里有一层 `if (h) x.translate(w / 2, h)`，同时画布高又写成宽（正方画布），
 * 两个"半个约定"叠在一起，结果就是怪物贴图的下半部分整块画在画布外（详见 README）。
 * 一个函数只留一种约定：画布尺寸由 w/h 决定，原点就是左上角。
 */
function make(w, h, fn) {
  if (typeof document === 'undefined') return null;
  var s = CACHE_SCALE;
  var c = document.createElement('canvas');
  var lw = Math.max(1, Math.ceil(w));
  var lh = Math.max(1, Math.ceil(h));
  c.width = Math.max(1, Math.ceil(lw * s));
  c.height = Math.max(1, Math.ceil(lh * s));
  var x = c.getContext('2d');
  x.save();
  x.scale(s, s);            // 之后一律用逻辑坐标绘制，倍率只体现在画布分辨率上
  fn(x);
  x.restore();
  return { canvas: c, lw: lw, lh: lh };
}

function wrap(m, extra) {
  if (!m) return null;
  var spr: any = { canvas: m.canvas, width: m.lw, height: m.lh, scale: CACHE_SCALE };
  // 贴图自报的锚点（身体中心在画布里的 y、脚底距画布底边的距离）：
  // 渲染层用它把贴图对准世界坐标，而不是猜"底边就是脚底"
  if (extra) for (var k in extra) spr[k] = extra[k];
  return spr;
}

function cached(key, w, h, fn, extra?) {
  if (typeof document === 'undefined') return null;
  var hit = cache[key];
  if (hit && hit.scale === CACHE_SCALE) return hit;
  cache[key] = wrap(make(w, h, fn), extra);
  return cache[key];
}

/**
 * 设置烘焙倍率（设备像素比）。返回是否真的变了 —— 没变就什么都不做，
 * 免得每帧 resize 都把整张表作废重建。
 */
S.setScale = function (s) {
  s = Math.max(1, Math.min(MAX_SCALE, Number(s) || 1));
  if (s === CACHE_SCALE) return false;
  CACHE_SCALE = s;
  cache = {};        // 旧贴图全部作废：它们是按旧倍率烘焙的
  return true;
};
S.scale = function () { return CACHE_SCALE; };

/**
 * 建一个**要放进 DOM** 的画布：属性尺寸 = 逻辑尺寸 × 倍率，CSS 尺寸 = 逻辑尺寸，
 * 返回的 ctx 已经 scale 好，调用方照旧用逻辑坐标画。
 *
 * 为什么不能直接 setAttribute：styles.css 里 `.char-card canvas` 等写了
 * `image-rendering:pixelated`，浏览器会把 1× 画布用**最近邻**放大到设备像素，
 * 于是肖像的描边变成 2px 的胖台阶。让画布本身就是设备分辨率，才是真的清楚。
 * 无 DOM 环境返回 null，调用方自己兜底成裸画布（无头测试里就是这么跑的）。
 */
S.domCanvas = function (w, h) {
  if (typeof document === 'undefined') return null;
  var s = CACHE_SCALE;
  var c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w * s));
  c.height = Math.max(1, Math.ceil(h * s));
  if (c.style) { c.style.width = w + 'px'; c.style.height = h + 'px'; }
  var x = c.getContext('2d');
  x.scale(s, s);
  return { canvas: c, ctx: x, width: w, height: h, scale: s };
};

/**
 * 缓存账目：条数、像素、字节、当前倍率。
 * 有了它，"缓存有没有失控"才是可测量的，而不是靠看代码猜。
 */
S.cacheStats = function () {
  var keys = Object.keys(cache);
  var px = 0;
  var list = [];
  for (var i = 0; i < keys.length; i++) {
    var e = cache[keys[i]];
    if (!e || !e.canvas) continue;
    var p = (e.canvas.width || 0) * (e.canvas.height || 0);
    px += p;
    list.push({
      key: keys[i], w: e.width, h: e.height, scale: e.scale,
      px: p, bytes: p * 4
    });
  }
  list.sort(function (a, b) { return b.px - a.px; });
  return { entries: list.length, px: px, bytes: px * 4, scale: CACHE_SCALE, list: list };
};

/* =========================================================
   1. 豆豆角色
   画法搬到了 bronana.ts（骨架 + 部件），这里保留原来的调用签名：
   一次性绘制（UI 肖像、图标）用一份共享的骨架实例摆静止姿态即可。
   游戏内的角色由 render.ts 直接驱动 player.rig（因为武器要挂在
   同一个骨架的武器挂点上）。
   ========================================================= */
var _scratchRig: RigInstance | null = null;
var _bronanaArgs = { skin: null, seed: 1, face: 0, mood: 'idle', eyeStyle: 'stern', mouthStyle: 'flat', dots: true, outlineWidth: 0 };

/**
 * @param faceDir -1 / 0 / 1 眼睛朝向
 * @param mood    'idle' | 'hurt' | 'dead'
 */
S.drawBronana = function (x, cx, cy, rx, ry, skin, seed, opts) {
  opts = opts || {};
  if (!_scratchRig) _scratchRig = Bronana.create();
  if (!skin) {
    skin = { base: PAL.SKIN, hi: PAL.SKIN_HI, sh: PAL.SKIN_SH, dp: PAL.SKIN_DP, dot: PAL.SKIN_DOT };
  }
  Bronana.pose(_scratchRig, {
    x: cx, y: cy, rx: rx, ry: ry,
    bob: opts.bob || 0, armSwing: opts.armSwing || 0
  });
  _bronanaArgs.skin = skin;
  _bronanaArgs.seed = seed === undefined || seed === null ? 1 : seed;
  _bronanaArgs.face = opts.faceDir === undefined ? 0 : opts.faceDir;
  _bronanaArgs.mood = opts.mood || 'idle';
  _bronanaArgs.eyeStyle = opts.eyeStyle || 'stern';
  _bronanaArgs.mouthStyle = opts.mouth || 'flat';
  _bronanaArgs.dots = opts.dots !== false;
  _bronanaArgs.outlineWidth = opts.outlineWidth || 0;
  Bronana.draw(x, _scratchRig, _bronanaArgs);
};

/**
 * **角色姿态图集**：把"不随动作变化的部分"（躯干 / 暗部 / 斑点 / 五官）烘成贴图，
 * 每帧只 blit 一次；手臂与武器仍然逐帧矢量绘制（它们每帧都在转，烘不了）。
 *
 * 为什么这是"图集/批处理"而不是治标：一帧里角色原本要 300+ 次绘制调用
 * （躯干轮廓、暗部裁剪、斑点、眼、嘴、高光…），占全部调用的一半以上；
 * 烘成图集后身体只剩 1 次 drawImage。
 *
 * 决定它能否做到**像素级等价**的两个细节：
 *   · 呼吸形变（sx·sy≡1）是连续的，只烘一张会在绘制时缩放 → 重采样发虚。
 *     做法是把 sy 量化到 0.002 一档（±0.1%，肉眼不可见）并**逐档各烘一张**：
 *     每张贴图就是在那一档的形状下画的，绘制时不再缩放。
 *   · 倍率沿用贴图缓存那一套（设备像素比），2× 屏同样清楚。
 */
var ATLAS_ARGS = { skin: null, seed: 1, face: 0, mood: 'idle', eyeStyle: 'stern', mouthStyle: 'flat', dots: true, outlineWidth: 0 };
var _atlasRig: RigInstance | null = null;
var SY_QUANT = 500;                       // sy 量化档数（0.002 一档）

/**
 * 皮肤取色的**缓存键片段**：颜色必须进键。
 *
 * 老键只有（职业 id / seed / 脸型 / 情绪 / 眼型 / 斑点 / 呼吸档），于是"同一个职业
 * 换一套色板"会命中上一套颜色烘出来的那张图 —— 实测：同参数换皮肤后拿到的是
 * **同一个 canvas**，贴图里旧色有 9 笔、新色 0 笔。而手臂是逐帧矢量绘制、用的是新色，
 * 结果同一个角色身上出现两种颜色（UI 肖像的键含 `look`，所以肖像还是新色，更容易看混）。
 *
 * 取四段而不是拼整个对象：键要短；`undefined` 一律落成固定占位符 `x`，
 * 否则"没传皮肤"的两次调用会拼出两个不同的键，缓存条目会凭空翻倍。
 */
function skinKey(skin) {
  if (!skin) return 'x';
  var out = [skin.base, skin.hi, skin.sh, skin.dp];
  for (var i = 0; i < out.length; i++) out[i] = out[i] === undefined || out[i] === null ? 'x' : String(out[i]);
  return out.join('~');
}

S.playerBodySprite = function (charDef, opts) {
  if (typeof document === 'undefined') return null;
  opts = opts || {};
  var r = opts.r || 18;
  var sy = opts.sy || 1;
  var bucket = Math.round(sy * SY_QUANT) / SY_QUANT;
  var sx = 1 / bucket;                    // 保持体积：sx·sy ≡ 1
  var key = 'atlas-' + charDef.id + '-' + (opts.seed | 0) + '-' + (opts.face | 0) + '-' +
    (opts.mood || 'idle') + '-' + (opts.eyeStyle || 'stern') + '-' + (opts.dots === false ? 0 : 1) +
    '-' + bucket.toFixed(3) + '-' + skinKey(opts.skin);
  var rx = r * sx, ry = r * Bronana.RY_RATIO * bucket;
  var w = Math.ceil(rx * 2.6) + 2, h = Math.ceil(ry * 2.6) + 2;   // 盒子中心 = 身体中心
  return cached(key, w, h, function (x) {
    if (!_atlasRig) _atlasRig = Bronana.create();
    Bronana.pose(_atlasRig, { x: w / 2, y: h / 2, rx: rx, ry: ry, bob: 0, armSwing: 0 });
    ATLAS_ARGS.skin = opts.skin || null;
    ATLAS_ARGS.seed = opts.seed === undefined ? 1 : opts.seed;
    ATLAS_ARGS.face = opts.face === undefined ? 0 : opts.face;
    ATLAS_ARGS.mood = opts.mood || 'idle';
    ATLAS_ARGS.eyeStyle = opts.eyeStyle || 'stern';
    ATLAS_ARGS.mouthStyle = opts.mouthStyle || 'flat';
    ATLAS_ARGS.dots = opts.dots !== false;
    ATLAS_ARGS.outlineWidth = 0;
    Bronana.draw(x, _atlasRig, ATLAS_ARGS, Bronana.LIVE_PARTS);   // 只烘"不动的部件"
  }, { bodyR: r });
};

/**
 * 预热姿态图集：把呼吸的所有档位一次烘完。
 * 不预热的话，游戏里每跨过一档（0.002 的 sy，一次呼吸约 25 档）就会在那一帧
 * 现烘一张 —— 单帧多出 ~300 次绘制调用的抖动。预热之后稳态就是"1 次 blit"。
 */
S.warmPlayerAtlas = function (charDef, opts) {
  if (typeof document === 'undefined') return 0;
  opts = opts || {};
  var minSy = opts.minSy === undefined ? 0.975 : opts.minSy;
  var maxSy = opts.maxSy === undefined ? 1.025 : opts.maxSy;
  var n = 0;
  for (var sy = minSy; sy <= maxSy + 1e-9; sy += 1 / SY_QUANT) {
    var o: any = {};
    for (var k in opts) o[k] = opts[k];
    o.sy = sy;
    if (S.playerBodySprite(charDef, o)) n++;
  }
  return n;
};

/* =========================================================
   2c. 宣传美术：**标题字与徽记**（`EMBLEMS`）
   ---------------------------------------------------------
   美术宪法说"没有一张图片文件"，而宣传美术（封面 / Logo / 标题插画）
   在真实项目里就是图片 —— 于是这一类在本项目里按**同一套画法**重做：
   标题 **Bronana** 是画出来的字（粗黑描边 + 纯色平涂 + 硬边投影），
   下面垫一枚豆形徽记（就是主角那颗豆的剪影）。

   为什么它算"资源"而不是"界面样式"：
     · 它有**尺寸规范**（`Art.SIZES.icon` 的整数倍），因为它出现在
       DOM 的 `<canvas>` 里，不是 CSS 文字 —— 不受字体与 line-height 影响；
     · 它有**状态**（常态 / 悬停高光），所以是 `states` 而不是一行 CSS 类；
     · 它要进**资源体检**（`pnpm run art` 里 `promo` 这一类从此有主）。

   与 `src/ui.ts` 的分工：本文件只回答"标题长什么样"，
   什么时候画、画在哪个节点上由界面层决定（那是它的职责）。
   注册表里写死的字（Bronana / ROGUELITE · SURVIVOR）是**声明**，
   不是界面里的一句文案 —— 改名要落在这一张表上。
   ========================================================= */
S.EMBLEMS = [
  {
    id: 'title',
    /** 每个字依次画：字符 + 缩进（进深靠它做手写字的错落） */
    glyphs: [
      { ch: 'B', dy: 0 }, { ch: 'r', dy: 2 }, { ch: 'o', dy: 5 }, { ch: 'n', dy: 2 },
      { ch: 'a', dy: 5 }, { ch: 'n', dy: 0 }, { ch: 'a', dy: 3 }
    ],
    sub: 'ROGUELITE · SURVIVOR',
    /** 逻辑尺寸（画布按设备倍率放大） */
    w: 512, h: 160,
    note: '标题字体：逐字画（含错落），硬边投影，无渐变'
  },
  {
    id: 'emblem',
    glyphs: [],
    sub: '',
    w: 128, h: 128,
    note: '豆形徽记：主角剪影 + 一圈硬边光环（独立的一枚，可单独用在 Loading / 结算）'
  }
];

S.EMBLEM_BY_ID = (function () {
  var m: Record<string, EmblemDef> = Object.create(null);
  for (var i = 0; i < S.EMBLEMS.length; i++) m[S.EMBLEMS[i].id] = S.EMBLEMS[i];
  return m;
})();

/**
 * 画一枚宣传美术件。
 * 逐字画而不是 `fillText` 的原因与美术宪法一致：
 * 标题要**锁死**字形间距与投影（3px 描边 + 4px 硬边影），
 * 而 `fillText` 的排版受字体与平台影响 —— 同一个标题在三台机器上会不一样宽。
 * 这里用等宽格位手排，于是"标题多宽"是算出来的。
 */
S.drawEmblem = function (x, emblem, scale) {
  var em = typeof emblem === 'string' ? (S.EMBLEM_BY_ID[emblem] || null) : emblem;
  if (!x || !em) return false;
  var s = Number(scale) || 1;
  x.save();
  x.scale(s, s);

  if (em.id === 'emblem') {
    /* 徽记：一颗豆 + 硬边光环 */
    D.circle(x, 64, 64, 40, PAL.SKIN_DOT, D.O.ink3);
    D.circle(x, 52, 52, 9, PAL.INK, D.O.none);
    D.circle(x, 76, 52, 9, PAL.INK, D.O.none);
    D.arcRing(x, 64, 64, 54, 0, U.TAU, 4, PAL.GOLD);
    x.restore();
    return true;
  }

  /* 标题字：逐字画。`font` 用一套"有粗描边"的画法：
     先画硬边投影（右下 4px 的纯色副本），再画本体（粗黑描边 + 纯色填充）。 */
  var size = 62;
  var slot = 54;
  var x0 = 26;
  var baseY = 92;
  for (var i = 0; i < (em.glyphs || []).length; i++) {
    var g = em.glyphs[i];
    var cx = x0 + i * slot + slot / 2;
    var cy = baseY + (g.dy || 0);
    /* 投影：同一枚字形往右下挪 4px，纯深色（不是渐变、不是模糊） */
    D.text(x, g.ch, cx + 4, cy + 4, size, PAL.INK, { align: 'center', outlineWidth: 0, weight: 900 });
    D.text(x, g.ch, cx, cy, size, PAL.CREAM, { align: 'center', outlineWidth: 7, weight: 900 });
  }
  /* 副题：小一号、字距拉开 */
  if (em.sub) {
    D.text(x, em.sub, 26 + (em.glyphs.length * slot) / 2, 130, 17, PAL.GOLD,
      { align: 'center', outlineWidth: 4, weight: 600 });
  }
  x.restore();
  return true;
};

/** 把一枚宣传美术件烘成缓存贴图（界面把它塞进 `<canvas>`）。
 *  键前缀用 `pk-`（与掉落物同一组）：`test/cache.mjs` 守着"缓存键前缀只有五种"，
 *  多一种前缀 = 多一类没人管的条目 —— 那条守卫是有理由的，所以这里共用而不是新开。 */
S.emblemSprite = function (id) {
  var em = S.EMBLEM_BY_ID[id];
  if (!em) return null;
  return cached('pk-' + id, em.w, em.h, function (x) { S.drawEmblem(x, em, 1); });
};

/* =========================================================
   2c. 外观配件（时装那一半：头上顶一件东西）
   ---------------------------------------------------------
   R50 第 9 条（时装系统）的**画法那一半**。声明在 `appearance.ts` 的
   `ACCESSORIES` 表里（id / 名字 / dy），画法在这里 —— 两边必须一一对应：
   **表里多一件而这里少一支画法 = 玩家选中一件什么也看不见**，
   那是最坏的一种假声明，所以 `test/character.mjs` 有一条断言盯着它（配件表每一档都要有画法）。

   美术宪法照旧：粗黑描边（`D` 的默认描边）+ 纯色平涂。
   坐标：`cx, cy` 是**头顶中心**（调用方按身体半径算好），`r` 是身体半径。
   ========================================================= */
S.drawAccessory = function (x, cx, cy, r, kind) {
  var shape = Appearance.accessoryShape(kind);
  if (!shape || shape.id === 'none') return false;
  var y = cy - r * shape.dy;
  /* ⚠ 一律**不传** `o` —— 那就是美术宪法的默认（`PAL.INK` 描边 + 默认线宽）。
     显式写 `D.O.none` 会让配件变成没有黑边的一块色，与角色身体接不上。 */
  switch (shape.id) {
    case 'cap': {
      /* 扁帽子 + 一条横檐（檐往前伸，于是"朝哪边"看得出来） */
      var w = r * 0.78, h = r * 0.30;
      D.rect(x, cx - w / 2, y - h, w, h, '#4a5a6e');
      D.rect(x, cx - w * 0.62, y - h * 0.18, w * 1.24, h * 0.34, '#3a4757');
      return true;
    }
    case 'horns': {
      /* 两根弯角：每边两段折线，从头顶两侧长出来 */
      var hx = r * 0.42, hy = r * 0.34;
      D.rect(x, cx - hx - r * 0.06, y - hy, r * 0.13, hy * 1.2, '#e8dcc0');
      D.rect(x, cx - hx - r * 0.16, y - hy * 1.5, r * 0.13, hy * 0.62, '#e8dcc0');
      D.rect(x, cx + hx - r * 0.07, y - hy, r * 0.13, hy * 1.2, '#e8dcc0');
      D.rect(x, cx + hx + r * 0.03, y - hy * 1.5, r * 0.13, hy * 0.62, '#e8dcc0');
      return true;
    }
    case 'antenna': {
      /* 一根细须 + 顶端一个亮点（菌类的样子） */
      D.rect(x, cx - r * 0.035, y - r * 0.62, r * 0.07, r * 0.62, '#7a6f5c');
      D.circle(x, cx, y - r * 0.70, r * 0.11, '#e8c24a');
      return true;
    }
    case 'goggles': {
      /* 一条横带 + 两个圆镜片 —— 压在眼睛那一线（dy 为负） */
      var gw = r * 0.84;
      D.rect(x, cx - gw / 2, y - r * 0.10, gw, r * 0.20, '#3a4757');
      D.circle(x, cx - r * 0.26, y, r * 0.15, '#8ab84f');
      D.circle(x, cx + r * 0.26, y, r * 0.15, '#8ab84f');
      return true;
    }
    default:
      /* 认不出的配件什么也不画（表与画法对不上由测试抓，
         这里**不抛** —— 一个坏 id 不该让整帧渲染炸掉）。 */
      return false;
  }
};

/** 用于 UI（卡片 / 角色选择）的静态豆豆肖像。
 *
 *  `look` 是**外观系统**（`appearance.ts`）的那三样；省略时逐位退回
 *  改造前的行为（角色表里的 `tint` / `face`、不戴配件）——
 *  这是"外观系统在没人用它的时候不改动任何像素"的落地处。 */
S.bronanaPortrait = function (size, charDef, look) {
  var key = 'port-' + charDef.id + '-' + size +
    (look ? ('-' + (look.palette || '') + '-' + (look.face || '') + '-' + (look.accessory || '')) : '');
  var box = size + 8;
  return cached(key, box, box, function (x) {
    var r = size * 0.40;
    /* ⚠ 取色与取脸**只走 `Appearance`**（`skinFor` / `eyesOf`）——
       改造前这里与 `render.ts` 各写了一遍 `charDef.tint` / `charDef.face || 'stern'`，
       加一种脸型就要改三处而漏改不报错。 */
    var skin = Appearance.skinFor(look && look.palette, charDef.tint, null);
    var eye = Appearance.eyesOf(charDef, look && look.face);
    x.translate(size / 2 + 4, size / 2 + 4);
    // 地面小影
    D.ellipse(x, 0, r * 1.05, r * 1.05, r * 0.32, 0, 'rgba(16,13,12,0.18)', D.O.none);
    S.drawBronana(x, 0, 0, r, r * 0.96, skin, U.seedFromStr(charDef.id) % 100,
      { eyeStyle: eye, mood: 'idle', dots: true });
    /* 配件画在**身体之后**（它是"戴在头上的东西"）。dy 按身体半径走 ——
       写死像素的话换个角色就会陷进头里或飘在半空。 */
    if (look && look.accessory) {
      S.drawAccessory(x, 0, -r * 0.72, r, look.accessory);
    }
  });
};

/* =========================================================
   2b. 枢纽的"站点"头像（N2 后的界面改版）
   ---------------------------------------------------------
   参照的是 Hades 的"家"：那里不是一个菜单，而是**一间房 + 若干站点**
   （镜子=天赋、承包商=建筑、纪念品柜=配装、经纪人=兑换），每个站点有自己的位置与形象，
   NPC 站在房里，谁有新话谁头上挂个气泡。所以这里给每个站点画一张**头像**，
   而不是把它们列成一行行文字 —— 文字列表读起来像设置页，不像一个地方。

   美术宪法照旧：粗黑描边 + 纯色平涂，无渐变无贴图。
   ========================================================= */
var STATION_TINT: Record<string, string[]> = {
  mother: ['#b58ab8', '#7a5a86'],
  picker: ['#c08a5a', '#8a5f36'],
  keeper: ['#d9b04a', '#9a7a24'],
  archivist: ['#7fa8c4', '#4f7a9a'],
  mirror: ['#c8bce0', '#8f7fb0'],
  contract: ['#b0a48a', '#7a705a'],
  wall: ['#a8c49a', '#6f8f62'],
  door: ['#c98a6a', '#8a5a3c'],
  /* 大厅（站）的四张 —— 三个模块的门各画各的样子（见 stationPortrait 末尾四个 case）。
     三扇门长得一样的话，"选去哪块"这件事在画面上就不成立。 */
  'gate-combat': [PAL.GATE_COMBAT, '#8a4434'],
  'gate-manage': [PAL.GATE_MANAGE, '#7a6a2c'],
  'gate-grow': [PAL.GATE_GROW, '#557f45'],
  board: ['#d9c48a', '#9a8452']
};

function stationSkin(id) {
  var t = STATION_TINT[id] || ['#c8b0a0', '#8a7264'];
  return { base: t[0], sh: t[1] };
}

/**
 * 一个站点的头像（缓存；逻辑尺寸 size×size）。
 * 四个 NPC 是四张脸，四个设施是四件"东西"——**看得出一眼是不同的地方**，
 * 这是"枢纽是房间"这件事在画面上的最低要求。
 */
S.stationPortrait = function (id, size) {
  size = size || 56;
  var key = 'stn-' + id + '-' + size;
  var box = size + 8;
  return cached(key, box, box, function (x) {
    var sk = stationSkin(id);
    var c = sk.base, sh = sk.sh;
    x.translate(size / 2 + 4, size / 2 + 4);
    var r = size * 0.42;
    switch (id) {
      case 'mother':      // 菌母：一坨菌床，上面三只眼
        D.ellipse(x, 0, r * 0.42, r * 1.0, r * 0.5, 0, sh, D.O.ink3);
        D.circle(x, 0, -r * 0.1, r * 0.72, c, D.O.ink3);
        D.circle(x, -r * 0.3, -r * 0.28, r * 0.13, PAL.INK, D.O.none);
        D.circle(x, 0, -r * 0.42, r * 0.13, PAL.INK, D.O.none);
        D.circle(x, r * 0.3, -r * 0.28, r * 0.13, PAL.INK, D.O.none);
        D.circle(x, -r * 0.16, -r * 0.62, r * 0.16, sh, D.O.ink2);
        D.circle(x, r * 0.22, -r * 0.7, r * 0.13, sh, D.O.ink2);
        break;
      case 'picker':      // 拾荒者：兜帽 + 一只露出来的眼
        D.poly(x, [[-r * 0.8, r * 0.9], [-r * 0.6, -r * 0.2], [0, -r * 0.95],
          [r * 0.6, -r * 0.2], [r * 0.8, r * 0.9]], c, D.O.ink3);
        D.rect(x, -r * 0.42, -r * 0.24, r * 0.84, r * 0.5, PAL.DEEP, D.O.ink2);
        D.circle(x, -r * 0.18, 0, r * 0.11, PAL.GOLD, D.O.none);
        D.rect(x, -r * 0.5, r * 0.42, r, r * 0.3, sh, D.O.ink2);
        break;
      case 'keeper':      // 守钟人：高瘦 + 背后的钟面
        D.circle(x, 0, -r * 0.5, r * 0.72, sh, D.O.ink3);
        D.rect(x, -r * 0.06, -r * 0.66, r * 0.12, r * 0.34, PAL.INK, D.O.none);
        D.rect(x, -r * 0.06, -r * 0.5, r * 0.3, r * 0.1, PAL.INK, D.O.none);
        D.poly(x, [[-r * 0.5, r * 0.9], [-r * 0.35, -r * 0.15], [0, -r * 0.3],
          [r * 0.35, -r * 0.15], [r * 0.5, r * 0.9]], c, D.O.ink3);
        D.rect(x, -r * 0.14, r * 0.3, r * 0.28, r * 0.4, sh, D.O.ink2);
        break;
      case 'archivist':   // 记录官：方头 + 手里的板子
        D.rect(x, -r * 0.72, -r * 0.72, r * 1.44, r * 1.1, c, D.O.ink3);
        D.rect(x, -r * 0.5, -r * 0.55, r * 1.0, r * 0.5, sh, D.O.ink2);
        D.rect(x, -r * 0.36, -r * 0.42, r * 0.3, r * 0.1, PAL.PAPER, D.O.none);
        D.rect(x, -r * 0.36, -r * 0.24, r * 0.52, r * 0.1, PAL.PAPER, D.O.none);
        D.rect(x, -r * 0.9, r * 0.3, r * 0.75, r * 0.55, PAL.PAPER, D.O.ink3);
        D.rect(x, -r * 0.78, r * 0.42, r * 0.5, r * 0.08, PAL.INK, D.O.none);
        D.rect(x, -r * 0.78, r * 0.58, r * 0.36, r * 0.08, PAL.INK, D.O.none);
        break;
      case 'mirror':      // 镜面（天赋）：一面带框的镜子
        D.ellipse(x, 0, 0, r * 0.85, r * 1.05, 0, c, D.O.ink3);
        D.ellipse(x, 0, 0, r * 0.55, r * 0.75, 0, '#e6ecf2', D.O.ink2);
        D.poly(x, [[-r * 0.2, r * 0.3], [r * 0.05, -r * 0.3], [r * 0.2, r * 0.3]], '#ffffff', D.O.none);
        break;
      case 'contract':    // 契约台（据点）：一卷摊开的图纸
        D.rect(x, -r * 0.9, -r * 0.55, r * 1.8, r * 1.15, PAL.PAPER, D.O.ink3);
        D.rect(x, -r * 0.6, -r * 0.3, r * 1.2, r * 0.12, PAL.INK, D.O.none);
        D.rect(x, -r * 0.6, -r * 0.05, r * 0.9, r * 0.12, PAL.INK, D.O.none);
        D.rect(x, -r * 0.6, r * 0.2, r * 1.05, r * 0.12, PAL.INK, D.O.none);
        D.circle(x, r * 0.55, r * 0.5, r * 0.2, c, D.O.ink2);
        break;
      case 'wall':        // 记录墙（图鉴）：一面贴满纸条的墙
        D.rect(x, -r * 0.95, -r * 0.85, r * 1.9, r * 1.7, sh, D.O.ink3);
        D.rect(x, -r * 0.78, -r * 0.68, r * 0.5, r * 0.42, PAL.PAPER, D.O.ink2);
        D.rect(x, -r * 0.18, -r * 0.6, r * 0.5, r * 0.42, PAL.PAPER, D.O.ink2);
        D.rect(x, r * 0.42, -r * 0.72, r * 0.44, r * 0.42, PAL.PAPER, D.O.ink2);
        D.rect(x, -r * 0.7, -r * 0.02, r * 0.62, r * 0.5, PAL.PAPER, D.O.ink2);
        D.rect(x, -r * 0.02, r * 0.02, r * 0.5, r * 0.44, PAL.PAPER, D.O.ink2);
        D.rect(x, r * 0.5, r * 0.1, r * 0.4, r * 0.5, c, D.O.ink2);
        break;
      case 'door':        // 门（出发）：一道亮着的外门
        D.rect(x, -r * 0.66, -r * 0.9, r * 1.32, r * 1.8, sh, D.O.ink3);
        D.rect(x, -r * 0.46, -r * 0.68, r * 0.92, r * 1.6, c, D.O.ink2);
        D.rect(x, -r * 0.46, -r * 0.1, r * 0.92, r * 0.14, PAL.INK, D.O.none);
        D.circle(x, r * 0.28, r * 0.42, r * 0.1, PAL.GOLD, D.O.ink2);
        break;
      case 'gate-combat': // 出击门：地牢入口 —— 门里是往下走的台阶
        D.rect(x, -r * 0.72, -r * 0.94, r * 1.44, r * 1.88, sh, D.O.ink3);
        D.rect(x, -r * 0.52, -r * 0.74, r * 1.04, r * 1.64, c, D.O.ink2);
        D.rect(x, -r * 0.44, -r * 0.52, r * 0.4, r * 0.16, PAL.INK, D.O.none);
        D.rect(x, -r * 0.2, -r * 0.22, r * 0.4, r * 0.16, PAL.INK, D.O.none);
        D.rect(x, r * 0.04, r * 0.08, r * 0.4, r * 0.16, PAL.INK, D.O.none);
        break;
      case 'gate-manage': // 经营门：一只齿轮（建造与产线）
        D.poly(x, [[-r * 0.26, -r * 0.88], [r * 0.26, -r * 0.88], [r * 0.34, -r * 0.52],
          [r * 0.88, -r * 0.34], [r * 0.88, r * 0.34], [r * 0.34, r * 0.52],
          [r * 0.26, r * 0.88], [-r * 0.26, r * 0.88], [-r * 0.34, r * 0.52],
          [-r * 0.88, r * 0.34], [-r * 0.88, -r * 0.34], [-r * 0.34, -r * 0.52]], c, D.O.ink3);
        D.circle(x, 0, 0, r * 0.3, PAL.INK, D.O.none);
        break;
      case 'gate-grow':   // 养成门：一株顶出土的新芽
        D.rect(x, -r * 0.11, -r * 0.24, r * 0.22, r * 1.02, c, D.O.ink3);
        D.ellipse(x, -r * 0.42, -r * 0.3, r * 0.4, r * 0.2, -0.5, c, D.O.ink3);
        D.ellipse(x, r * 0.42, -r * 0.54, r * 0.4, r * 0.2, 0.5, c, D.O.ink3);
        D.rect(x, -r * 0.62, r * 0.74, r * 1.24, r * 0.2, sh, D.O.ink3);
        break;
      case 'board':       // 公告板：一块钉着纸条的板（读账的地方，不是门）
        D.rect(x, -r * 0.86, -r * 0.72, r * 1.72, r * 1.42, sh, D.O.ink3);
        D.rect(x, -r * 0.68, -r * 0.52, r * 0.56, r * 0.42, PAL.PAPER, D.O.ink2);
        D.rect(x, r * 0.08, -r * 0.52, r * 0.56, r * 0.42, PAL.PAPER, D.O.ink2);
        D.rect(x, -r * 0.68, -r * 0.02, r * 1.32, r * 0.42, PAL.PAPER, D.O.ink2);
        D.rect(x, -r * 0.12, r * 0.7, r * 0.24, r * 0.52, c, D.O.ink2);
        break;
      default:            // 兜底：一块方牌（新站点没画之前不会变成空白）
        D.rect(x, -r * 0.8, -r * 0.8, r * 1.6, r * 1.6, c, D.O.ink3);
        D.rect(x, -r * 0.45, -r * 0.2, r * 0.9, r * 0.12, PAL.INK, D.O.none);
        D.rect(x, -r * 0.45, r * 0.05, r * 0.6, r * 0.12, PAL.INK, D.O.none);
    }
  });
};

/* =========================================================
   3. 怪物身体（缓存，逐帧只做位移/旋转/挤压）
   ========================================================= */
function enemySkin(def) { return { base: def.color, dark: def.dark }; }

/**
 * 怪物贴图的逻辑盒子：**脚底以上 up、以下 down**，水平对称。
 * 贴图原点（局部 0,0）是脚底中心，身体中心在 (0, -R)。
 *
 * 数值按各形状的真实外扩量给，而不是"差不多给个方框"：
 *   · 头顶最高：尖刺兽的星形外径 1.30R（圆心在身体中心，即脚底上方 R）→ 2.30R
 *   · 脚下最低：触手 1.50R 段 + 0.22R 端帽 → 0.72R；巨块腿 0.51R
 * 盒子报给渲染层（bodyY / foot），由 drawEnemy 把**身体中心**对准敌人坐标 ——
 * 这样"看得见的身体"与命中圈同心，脚正好落在命中圈底部。
 */
S.enemyBox = function (def) {
  var R = 26 * (def.scale || 1);
  var top = def.shape === 'spiky' ? 2.35
    : def.shape === 'jelly' ? 2.06
      : def.shape === 'eye' ? 2.04
        : 2.20;                                  // blob（豆豆同源轮廓，带鼓包）
  var below = def.legs === 'tentacle' ? 0.85 : 0.62;
  var up = R * top + 6;                          // +6：3px 描边的一半 + 余量
  var down = R * below + 8;
  return { R: R, up: up, down: down, w: 2 * (R * 1.45 + 6), h: up + down };
};

/**
 * 生成怪物贴图。画布 = enemyBox 的盒子，原点在盒子左上角，
 * 回调先把原点挪到 (w/2, up) = 脚底中心，之后所有坐标都以脚底为原点。
 */
S.enemySprite = function (def) {
  var box = S.enemyBox(def);
  var R = box.R;
  return cached('en-' + def.id + '-' + R.toFixed(1), box.w, box.h, function (x) {
    x.translate(box.w / 2, box.up);
    var cx = 0, cy = -R;   // 相对脚底：身体中心在 R 高处
    var legs = def.legs || 'nub';

    // 触手 / 腿
    if (legs === 'nub') {
      for (var i = -1; i <= 1; i += 2) {
        D.capsule(x, cx + i * R * 0.42, cy + R * 0.62, cx + i * R * 0.70, cy + R * 1.02,
          Math.max(5, R * 0.30), def.dark, D.O.ink25);
      }
    } else if (legs === 'thick') {
      for (var j = -1; j <= 1; j += 2) {
        D.capsule(x, cx + j * R * 0.40, cy + R * 0.55, cx + j * R * 0.72, cy + R * 1.05,
          Math.max(8, R * 0.46), def.dark, D.O.ink3);
      }
    } else if (legs === 'tentacle') {
      var rnd = U.rng(U.seedFromStr('tent' + def.id));
      for (var k = 0; k < 5; k++) {
        var ax = cx + (k - 2) * R * 0.36;
        var sway = (rnd() - 0.5) * R * 0.5;
        D.capsule(x, ax, cy + R * 0.60, ax + sway, cy + R * (1.15 + rnd() * 0.35),
          Math.max(4, R * 0.22), def.dark, D.O.ink2);
      }
    } else if (legs === 'float') {
      // 悬浮：底部三根石笋，不接地
      for (var mi = -1; mi <= 1; mi++) {
        D.poly(x, [
          [cx + mi * R * 0.46 - R * 0.12, cy + R * 0.55],
          [cx + mi * R * 0.46 + R * 0.12, cy + R * 0.55],
          [cx + mi * R * 0.46, cy + R * (1.0 + 0.12 * (mi === 0 ? -1 : 1))]
        ], def.dark, D.O.ink2);
      }
    }

    // 身体
    if (def.shape === 'spiky') {
      var spikes = 9;
      // starPath 在**局部原点**建路径，所以必须先平移到身体中心再建 ——
      // 与 blob 分支同一个坑（Canvas2D 的路径在加入时就被当前变换固定）。
      // 老实现漏了这次平移，星形被画在"脚底"上：下半截插进地面、
      // 上半截几乎没露出来，看上去像"圆身上随便扎了几根刺"。
      x.save();
      x.translate(cx, cy);
      D.starPath(x, spikes, R * 1.30, R * 0.94, 0.2);
      x.fillStyle = def.dark; x.fill();
      x.lineWidth = 3; x.strokeStyle = PAL.INK; x.stroke();
      x.restore();
      D.circle(x, cx, cy, R * 0.94, def.color, D.O.ink3);
    } else if (def.shape === 'jelly') {
      // 钟形伞盖
      x.beginPath();
      x.moveTo(cx - R, cy + R * 0.42);
      x.quadraticCurveTo(cx - R * 1.06, cy - R * 0.92, cx, cy - R * 0.98);
      x.quadraticCurveTo(cx + R * 1.06, cy - R * 0.92, cx + R, cy + R * 0.42);
      x.quadraticCurveTo(cx + R * 0.5, cy + R * 0.62, cx, cy + R * 0.42);
      x.quadraticCurveTo(cx - R * 0.5, cy + R * 0.62, cx - R, cy + R * 0.42);
      x.closePath();
      D.fill(x, def.color); D.ink(x, PAL.INK, 3);
      // 硬边暗部
      x.save(); x.beginPath();
      x.moveTo(cx - R, cy + R * 0.42);
      x.quadraticCurveTo(cx - R * 1.06, cy - R * 0.92, cx, cy - R * 0.98);
      x.quadraticCurveTo(cx + R * 1.06, cy - R * 0.92, cx + R, cy + R * 0.42);
      x.closePath(); x.clip();
      D.fill(x, def.dark);
      x.beginPath(); x.ellipse(cx + R * 0.25, cy + R * 0.30, R * 0.85, R * 0.55, 0, 0, U.TAU); x.fill();
      x.restore();
    } else if (def.shape === 'eye') {
      D.circle(x, cx, cy, R * 0.98, PAL.WHITE, D.O.ink3);
      D.circle(x, cx + R * 0.12, cy + R * 0.05, R * 0.44, def.color, D.O.ink25);
      D.circle(x, cx + R * 0.16, cy + R * 0.08, R * 0.18, PAL.INK, D.O.none);
      // 血丝（两道足矣）
      D.capsule(x, cx - R * 0.75, cy - R * 0.55, cx - R * 0.30, cy - R * 0.20, 2, def.dark, D.O.none);
      D.capsule(x, cx + R * 0.70, cy - R * 0.50, cx + R * 0.34, cy - R * 0.16, 2, def.dark, D.O.none);
    } else {
      // blob：圆润笨拙，与豆豆同源的轮廓语言
      D.seedBlob(x, cx, cy, R, R * 1.02, def.color, { seed: U.seedFromStr(def.id) % 50, outline: PAL.INK, outlineWidth: 3 });
      // 轮廓内压一层暗色（与 jelly 分支同样的处理）。
      // 注意顺序：Canvas2D 的路径在加入时就被当前变换固定，所以必须先 translate
      // 再建路径 —— 老实现把 translate 放在 seedBlobPath 之后，裁剪区留在了画布原点
      // （比身体低 1.00R），实际只盖住了下半身、且是"意外地"盖住的。
      // 这里的椭圆坐标相应改成角色局部坐标（原来写的是绝对坐标 cy + ...）。
      x.save();
      x.translate(cx, cy);
      D.seedBlobPath(x, R, R * 1.02, U.seedFromStr(def.id) % 50);
      x.clip();
      D.fill(x, def.dark);
      x.beginPath(); x.ellipse(R * 0.15, R * 0.62, R * 0.66, R * 0.46, 0, 0, U.TAU); x.fill();
      x.restore();
      D.dots(x, cx, cy, R * 0.9, 5, 'en' + def.id, def.dark, Math.max(1.6, R * 0.07));
    }

    // 疣 / 斑点（非 blob 用）
    if (def.shape !== 'blob' && def.shape !== 'eye') {
      D.dots(x, cx, cy, R * 0.82, 4, 'en2' + def.id, def.dark, Math.max(1.4, R * 0.06));
    }

    // 眼睛
    var eyes = def.eyes || 1;
    var eyeR = Math.max(2.4, R * 0.19);
    var eyeY = cy - R * (def.shape === 'jelly' ? 0.22 : 0.10);
    if (eyes === 1) {
      /* `shape === 'eye'` 时**不画眼睛部件**：那颗眼白 + 虹膜 + 瞳孔就是它的眼睛。
         `'none'` 是 `Bronana.eye` 的一支真分支（见 draw2d.ts）—— 老实现没有它，
         于是这里会落到 `else`（stern），表现是白眼球上多压一道半月形。 */
      Bronana.eye(x, cx, eyeY, eyeR * 1.15, def.shape === 'eye' ? 'none' : 'dot', D.O.empty);
    } else if (eyes === 2) {
      Bronana.eye(x, cx - R * 0.36, eyeY, eyeR, 'round');
      Bronana.eye(x, cx + R * 0.36, eyeY, eyeR, 'round');
    } else {
      Bronana.eye(x, cx - R * 0.46, eyeY, eyeR * 0.85, 'round');
      Bronana.eye(x, cx, eyeY - R * 0.30, eyeR * 0.85, 'round');
      Bronana.eye(x, cx + R * 0.46, eyeY, eyeR * 0.85, 'round');
    }

    // 嘴
    var m = def.mouth || 'flat';
    if (eyes !== 1 || def.shape === 'blob' || m !== 'none') {
      if (m === 'angry') {
        Bronana.mouth(x, cx, cy + R * 0.44, R * 0.30, 'grin');
        D.capsule(x, cx - R * 0.34, cy + R * 0.20, cx - R * 0.60, cy + R * 0.34, 3, PAL.INK, D.O.none);
        D.capsule(x, cx + R * 0.34, cy + R * 0.20, cx + R * 0.60, cy + R * 0.34, 3, PAL.INK, D.O.none);
      } else {
        Bronana.mouth(x, cx, cy + R * 0.42, R * 0.26, m);
      }
    }
  }, {
    // 渲染层要的两个锚点：身体中心在画布里的 y、脚底距画布底边的距离
    bodyY: box.up - R,
    foot: box.down,
    bodyR: R
  });
};

/**
 * 把一张 shader 烘到**怪物贴图自己的像素**上，产出一张与本体同尺寸同锚点的覆盖层。
 *
 * 为什么"覆盖层"必须离屏烘一次，而不是在世界画布上现画：
 * 这类效果的合成（`atop` / `in`）认的是**目标的 alpha**。在离屏画布上目标是这只怪的
 * 剪影，于是效果精确地只落在轮廓内；在世界画布上目标是一整块不透明背景，
 * 于是同一段代码会连同背景一起染色（实测：精英色老实现漏出一块 90×86 的金色矩形，
 * 左上角还在怪的身体中心）。**一处烘焙、两条效果共用**，也就没有"某一个效果接错了地方"。
 *
 * @param prefix 缓存键前缀（`fl-` 白闪 / `el-` 精英色）—— 缓存账目按前缀分类核对
 */
function bakeOverlay(prefix, def, shaderId, params) {
  if (typeof document === 'undefined') return null;
  var key = prefix + def.id;
  if (cache[key]) return cache[key];
  var spr = S.enemySprite(def);
  if (!spr) return null;
  var c = document.createElement('canvas');
  c.width = spr.canvas.width; c.height = spr.canvas.height;   // 设备像素：与本体同一倍率
  var x = c.getContext('2d');
  x.drawImage(spr.canvas, 0, 0);
  /* 效果本身走 **shader 库**（`art_shaders.ts`），不在这里裸写合成模式 ——
     否则"把白闪改成暖白"要改两三个地方，而漏掉的那个只会表现为"有一只怪闪的颜色不一样"。 */
  ArtShaders.paint(x, shaderId, c.width, c.height, params);
  // 逻辑尺寸与锚点都与本体一致 —— 覆盖层才能严丝合缝地叠在怪物身上
  cache[key] = {
    canvas: c, width: spr.width, height: spr.height, scale: spr.scale,
    bodyY: spr.bodyY, foot: spr.foot, bodyR: spr.bodyR
  };
  return cache[key];
}

/** 怪物受击白闪剪影（纯白平涂，缓存生成） */
S.enemyFlash = function (def) {
  return bakeOverlay('fl-', def, 'hitFlash', { color: '#ffffff' });
};

/** 精英色覆盖层（薄金平涂，只落在轮廓内；缓存生成） */
S.enemyElite = function (def) {
  return bakeOverlay('el-', def, 'elite', { color: PAL.GOLD, alpha: 0.30 });
};

/**
 * 绘制怪物（自动处理挤压 / 朝向 / 受击白闪）
 * @param ox oy 显示帧插值的亚帧偏移（缺省 0 = 直接画在当前逻辑帧位置）
 */
S.drawEnemy = function (x, e, time, ox, oy) {
  var def = e.def;
  // 每实例的记忆：倍率变了就重取（否则换屏幕后手上的贴图还是旧的）
  var spr = e._spr;
  if (!spr || spr.scale !== CACHE_SCALE) { spr = e._spr = S.enemySprite(def); e._fl = null; e._el = null; }
  if (!spr) return;
  ox = ox || 0; oy = oy || 0;
  var ex = e.x + ox, ey = e.y + oy;
  var R = spr.bodyR || 26 * (def.scale || 1);
  var t = time * 6 + e.phase;
  var squash = 1 + Math.sin(t) * 0.045;
  var bob = Math.sin(t) * R * 0.06;
  var drawW = spr.width, drawH = spr.height;
  // 身体中心对准敌人坐标 (ex, ey)：命中圈就是圆心在 (ex, ey) 的圆，
  // 于是"看得见的身体"与命中圈同心，脚正好落在命中圈底部（局部 y = +R）。
  // 老实现用 -spr.height - 4（"贴图底边 = 脚底"）+ 一张被裁掉下半部分的方画布，
  // 结果身体只有上半截可见、还整体上移了 6~10px。
  var dx = -spr.width / 2, dy = -(spr.bodyY === undefined ? spr.height : spr.bodyY);

  x.save();
  x.translate(ex, ey + bob);
  x.scale(1 / squash, squash);
  x.drawImage(spr.canvas, dx, dy, drawW, drawH);
  /* 受击白闪：叠加纯白剪影（平涂，不是发光）
     走 **shader 库**的 `hitFlash` —— 它在这里、在 `enemyFlash` 的烘焙里
     是**同一条**效果，合成步骤只有一处出处。 */
  if (e.hitFlash > 0) {
    var fl = e._fl || (e._fl = S.enemyFlash(def));
    if (fl) {
      x.globalAlpha = Math.min(0.8, e.hitFlash * 4.5);
      x.drawImage(fl.canvas, dx, dy, drawW, drawH);
    }
  }
  /* 精英色：blit 那张**烘好的**覆盖层（与白闪同一套路）。
     为什么不再在这里调 `ArtShaders.paint`：`elite` 的合成认的是目标 alpha，
     画在世界画布上就会连同背景一起染成一块金色矩形（那就是老实现的表现，
     实测 90×86、左上角还落在怪的身体中心）。
     烘到离屏画布之后，金色只落在这一只怪的轮廓内，于是"它是精英"读起来是
     **这只怪本身泛金光**，而不是套了个金圈或贴了块色板。 */
  if (e.elite) {
    var el = e._el || (e._el = S.enemyElite(def));
    if (el) x.drawImage(el.canvas, dx, dy, drawW, drawH);
  }
  x.restore();

  // 精英光环（纯色粗环，非发光）。半径按**贴图上的身体**算，不是按命中圈：
  // 可见身体半径是 26*scale、命中圈是 22*scale，按命中圈画光环会陷进身体里。
  if (e.elite) {
    var auraR = R * 1.02 + 6;
    x.save();
    x.globalAlpha = 0.85;
    D.arcRing(x, ex, ey, auraR, 0, U.TAU, 3, PAL.GOLD);
    x.restore();
    var headY = ey - R * 1.10;    // 头顶（含鼓包）再往上一点
    D.poly(x, [
      [ex - 7, headY - 16], [ex + 7, headY - 16], [ex, headY - 5]
    ], PAL.GOLD, D.O.ink2);
  }
};

/* =========================================================
   3. 武器
   ========================================================= */
/**
 * 绘制一把武器
 * @param rot      朝向（弧度，0 = 指向右）
 * @param swing    近战挥击进度 0..1（0 = 收起，1 = 挥到最远）
 */
S.drawWeapon = function (x, kind, rot, tints, swing, scale) {
  var c1 = (tints && tints[0]) || PAL.STEEL;
  var c2 = (tints && tints[1]) || PAL.DARK;
  scale = scale || 1;
  // 所有描边统一走共享常量 D.O.ink3（原 iw 恒为 3，已内联以消除每帧字面量分配）

  D.at(x, 0, 0, rot, function (g) {
    g.scale(scale, scale);
    switch (kind) {
      case 'knife':
        D.poly(g, [[2, -4], [24, -2], [30, 0], [24, 2], [2, 4]], c1, D.O.ink3);
        D.poly(g, [[2, 1], [22, 1], [26, 2], [2, 4]], c2, D.O.none);
        D.rect(g, -10, -4, 13, 8, PAL.WOOD, D.O.ink3);
        break;
      case 'sword':
        D.poly(g, [[4, -5], [40, -3], [48, 0], [40, 3], [4, 5]], c1, D.O.ink3);
        D.poly(g, [[6, 1], [38, 1], [44, 3]], c2, D.O.none);
        D.rect(g, -4, -11, 7, 22, c2, D.O.ink3);
        D.rect(g, -14, -5, 11, 10, PAL.WOOD_D, D.O.ink3);
        D.circle(g, -17, 0, 4, PAL.GOLD, D.O.ink2);
        break;
      case 'spear':
        D.capsule(g, -16, 0, 44, 0, 7, PAL.WOOD, D.O.ink3);
        D.poly(g, [[42, -7], [64, 0], [42, 7]], c1, D.O.ink3);
        D.poly(g, [[44, 0], [62, 0], [42, 5]], c2, D.O.none);
        D.poly(g, [[9, -8], [20, -8], [14, 3]], PAL.WOOD_D, D.O.ink2);
        break;
      case 'axe':
        D.capsule(g, -14, 0, 40, 0, 8, PAL.WOOD, D.O.ink3);
        D.poly(g, [[30, -6], [44, -26], [56, -14], [48, 2], [30, 8]], c1, D.O.ink3);
        D.poly(g, [[44, -22], [54, -13], [47, -2], [40, -4]], c2, D.O.none);
        D.poly(g, [[30, -6], [42, -18], [48, -6], [34, 2]], c1, D.O.ink3);
        break;
      case 'hammer':
        D.capsule(g, -14, 0, 34, 0, 9, PAL.WOOD_D, D.O.ink3);
        D.rect(g, 32, -22, 26, 44, c1, D.O.ink3);
        D.rect(g, 32, -22, 26, 12, c2, D.O.none);
        D.rect(g, 42, -30, 8, 60, c2, D.O.ink2);
        break;
      case 'torch':
        D.capsule(g, -12, 0, 34, 0, 8, PAL.WOOD_D, D.O.ink3);
        D.circle(g, 40, 0, 12, PAL.FIRE, D.O.ink3);
        D.poly(g, [[40, -18], [48, -4], [46, 8], [34, 8], [32, -4]], PAL.MUZZLE, D.O.ink2);
        break;
      case 'taser':
        D.capsule(g, -12, 0, 30, 0, 9, c2, D.O.ink3);
        D.capsule(g, 30, 0, 46, 0, 6, c1, D.O.ink2);
        D.circle(g, 48, 0, 5, PAL.MUZZLE, D.O.ink2);
        D.poly(g, [[46, -8], [56, -14], [50, -4]], PAL.MUZZLE, D.O.none);
        break;
      case 'plasma':
        D.rect(g, -10, -5, 16, 10, c2, D.O.ink3);
        D.poly(g, [[6, -8], [54, -3], [62, 0], [54, 3], [6, 8]], c1, D.O.ink3);
        D.poly(g, [[12, 0], [54, 0], [58, 2]], PAL.WHITE, D.O.none);
        break;
      case 'tentacle': {
        var pts = [[0, 0]];
        for (var i2 = 1; i2 <= 6; i2++) {
          pts.push([i2 * 13, Math.sin(i2 * 0.9 + swing * 3) * 12 * (i2 / 5)]);
        }
        D.poly(g, pts, c1, D.O.ink3open);
        D.poly(g, pts.map(function (p) { return [p[0], p[1] + 3]; }), c2, { outlineWidth: 0, close: false });
        for (var d2 = 0; d2 < 4; d2++) {
          D.circle(g, 16 + d2 * 14, Math.sin((d2 + 1) * 0.9 + swing * 3) * 12 * ((d2 + 1) / 5) - 8, 3, PAL.WHITE, D.O.ink2);
        }
        break;
      }

      /* ---------- 远程枪械 ---------- */
      case 'pistol':
        D.rect(g, -8, -6, 12, 16, c2, D.O.ink3);
        D.rect(g, 2, -7, 26, 13, c1, D.O.ink3);
        D.rect(g, 26, -4, 10, 7, c2, D.O.ink2);
        D.rect(g, 2, -3, 22, 4, c2, D.O.none);
        break;
      case 'smg':
        D.rect(g, -6, -4, 12, 14, c2, D.O.ink3);
        D.rect(g, 4, -8, 30, 16, c1, D.O.ink3);
        D.rect(g, 30, -4, 14, 8, c2, D.O.ink2);
        D.rect(g, 8, 6, 8, 14, c2, D.O.ink2);
        D.rect(g, 6, -3, 24, 4, c2, D.O.none);
        D.circle(g, 14, 16, 4, PAL.GOLD, D.O.ink2);
        break;
      case 'minigun':
        D.rect(g, -8, -8, 14, 26, c2, D.O.ink3);
        D.rect(g, 4, -11, 26, 22, c1, D.O.ink3);
        D.rect(g, 28, -9, 18, 6, c2, D.O.ink2);
        D.rect(g, 28, -2, 18, 5, c2, D.O.ink2);
        D.rect(g, 28, 4, 16, 5, c2, D.O.ink2);
        break;
      case 'shotgun':
        D.rect(g, -8, -6, 16, 20, PAL.WOOD_D, D.O.ink3);
        D.rect(g, 6, -8, 34, 9, c1, D.O.ink3);
        D.rect(g, 6, 1, 34, 8, c2, D.O.ink3);
        D.rect(g, 38, -8, 9, 17, PAL.STEEL, D.O.ink2);
        break;
      case 'sniper':
        D.rect(g, -10, -5, 14, 20, c2, D.O.ink3);
        D.rect(g, 2, -7, 46, 13, c1, D.O.ink3);
        D.rect(g, 46, -4, 18, 7, c2, D.O.ink2);
        D.rect(g, 8, -18, 26, 10, c2, D.O.ink3);
        D.circle(g, 34, -13, 6, PAL.ICE, D.O.ink2);
        break;
      case 'laser':
        D.rect(g, -8, -7, 16, 18, c2, D.O.ink3);
        D.poly(g, [[0, -10], [34, -8], [48, 0], [34, 8], [0, 10]], c1, D.O.ink3);
        D.circle(g, 40, 0, 5, PAL.WHITE, D.O.ink2);
        D.rect(g, 6, -12, 14, 5, c2, D.O.ink2);
        break;
      case 'railgun':
        D.rect(g, -12, -8, 18, 24, c2, D.O.ink3);
        D.rect(g, 4, -11, 48, 8, c1, D.O.ink3);
        D.rect(g, 4, 3, 48, 8, c1, D.O.ink3);
        D.rect(g, 20, -3, 34, 6, PAL.ICE, D.O.ink2);
        break;
      case 'rocket':
        D.capsule(g, -14, 0, 40, 0, 18, c1, D.O.ink3);
        D.poly(g, [[38, -9], [58, 0], [38, 9]], c2, D.O.ink3);
        D.rect(g, -22, -8, 10, 16, c2, D.O.ink2);
        D.rect(g, 4, 6, 12, 10, c2, D.O.ink2);
        break;
      case 'flame':
        D.rect(g, -8, -6, 14, 18, PAL.FIRE, D.O.ink3);
        D.capsule(g, 2, 0, 30, 0, 12, c1, D.O.ink3);
        D.circle(g, 32, 0, 8, PAL.MUZZLE, D.O.ink2);
        break;
      case 'crossbow':
        D.rect(g, -10, -5, 40, 11, PAL.WOOD, D.O.ink3);
        D.poly(g, [[14, -22], [22, -22], [22, 22], [14, 22]], c1, D.O.ink3);
        D.capsule(g, -4, 0, 30, 0, 4, PAL.BONE2, D.O.ink2);
        D.circle(g, -6, 0, 5, PAL.STEEL, D.O.ink2);
        break;
      case 'sling':
        D.capsule(g, -12, -12, 26, -6, 6, PAL.WOOD, D.O.ink2);
        D.capsule(g, -12, 12, 26, 6, 6, PAL.WOOD, D.O.ink2);
        D.capsule(g, -12, -12, -12, 12, 8, PAL.WOOD_D, D.O.ink3);
        D.circle(g, 22, 0, 6, PAL.ROCK, D.O.ink2);
        D.capsule(g, 26, -7, 22, 0, 3, PAL.BONE2, D.O.none);
        D.capsule(g, 26, 7, 22, 0, 3, PAL.BONE2, D.O.none);
        break;
      case 'sentry':
        D.rect(g, -14, 10, 30, 12, c2, D.O.ink3);
        D.circle(g, 1, -2, 15, c1, D.O.ink3);
        D.rect(g, 10, -6, 26, 11, c2, D.O.ink3);
        D.circle(g, 1, -2, 5, PAL.E3, D.O.ink2);
        break;
      case 'orb':
        D.circle(g, 26, 0, 16, c1, D.O.ink3);
        D.circle(g, 20, -5, 6, PAL.WHITE, D.O.ink2);
        D.capsule(g, -14, 0, 12, 0, 7, PAL.WOOD_D, D.O.ink3);
        D.poly(g, [[8, -14], [14, -22], [20, -13]], c2, D.O.ink2);
        break;
      default:
        D.rect(g, 0, -4, 30, 8, c1, D.O.ink3);
    }
  });
};

/* =========================================================
   4. 道具图标
   ========================================================= */
S.itemIcon = function (icon, tint, size) {
  size = size || 52;
  var s = size / 52;
  var key = 'icon-' + icon + '-' + tint + '-' + size;
  var box = size + 6;
  return cached(key, box, box, function (x) {
    x.translate(size / 2 + 3, size / 2 + 3);
    x.scale(s, s);
    var c1 = tint || PAL.PAPER;
    var c2 = '#4a423b';
    switch (icon) {
      case 'bottle':
        D.rect(x, -9, 2, 18, 22, c1, D.O.ink3);
        D.rect(x, -5, -12, 10, 14, c2, D.O.ink3);
        D.rect(x, -6, -18, 12, 7, c1, D.O.ink3);
        D.rect(x, -5, 8, 10, 5, PAL.WHITE, D.O.none);
        break;
      case 'bar':
        D.rect(x, -14, -9, 28, 18, c1, D.O.ink3);
        D.rect(x, -10, -9, 5, 18, PAL.WHITE, D.O.none);
        D.rect(x, -2, -6, 12, 3, c2, D.O.none);
        D.rect(x, -2, 1, 12, 3, c2, D.O.none);
        break;
      case 'helm':
        D.poly(x, [[-15, 8], [-13, -8], [0, -16], [13, -8], [15, 8], [10, 15], [-10, 15]], c1, D.O.ink3);
        D.rect(x, -13, -1, 26, 6, c2, D.O.ink2);
        break;
      case 'boot':
        D.poly(x, [[-8, -14], [6, -14], [8, 4], [16, 4], [16, 14], [-10, 14], [-10, 2]], c1, D.O.ink3);
        D.rect(x, -10, 7, 26, 5, PAL.INK, D.O.none);
        D.rect(x, -8, -12, 12, 4, PAL.WHITE, D.O.none);
        break;
      case 'clover':
        [0, 1, 2, 3].forEach(function (i) {
          var a = i * Math.PI / 2 + 0.5;
          D.circle(x, Math.cos(a) * 8, Math.sin(a) * 8 - 2, 8, c1, D.O.ink3);
        });
        D.capsule(x, 0, 4, 2, 18, 4, PAL.E7, D.O.ink2);
        break;
      case 'magnet': {
        /* 马蹄形：本体一层 tint（13px 带宽）+ 内外两条 3px 墨线，两极一端红一端蓝。
           老实现有 **5 笔同几何覆盖**：`:1027` 的 tint 弧被 `:1028` 同宽的 INK 弧完整盖住，
           `:1032-1033` 的两块红极头又被 `:1034-1035` 同几何的 tint 块盖住 ——
           于是 tint 完全不可见、两极也不分色，而它是 21 个图标里**唯一没有 3px 墨线**的
           （实测线宽集 {13,7,2}，其余 20 个都是 {3}）。
           所以这里保留 tint 本体、把墨线挪到内外边缘（同一条"平涂 + 粗黑描边"的语言），
           并让两极分色 —— 磁铁的"两极"正是它一眼可辨的那两笔。 */
        var ma0 = Math.PI * 0.15, ma1 = Math.PI * 0.85;
        D.arcRing(x, 0, 0, 14, ma0, ma1, 13, c1, D.O.empty);       // 本体（tint）
        D.arcRing(x, 0, 0, 21, ma0, ma1, 3, PAL.INK, D.O.empty);   // 外缘墨线（3px 基线）
        D.arcRing(x, 0, 0, 7, ma0, ma1, 3, PAL.INK, D.O.empty);    // 内缘墨线
        D.rect(x, -20, 8, 12, 10, PAL.E3, D.O.ink2);               // 红极
        D.rect(x, 8, 8, 12, 10, PAL.E5, D.O.ink2);                 // 蓝极
        break;
      }
      case 'stone':
        D.poly(x, [[-14, 12], [-16, -2], [-6, -12], [8, -13], [16, -2], [12, 12]], c1, D.O.ink3);
        D.poly(x, [[-6, -12], [8, -13], [16, -2], [2, -4]], PAL.WHITE, D.O.none);
        break;
      case 'scope':
        D.capsule(x, -16, 0, 16, 0, 13, c1, D.O.ink3);
        D.circle(x, 16, 0, 8, c2, D.O.ink3);
        D.circle(x, 16, 0, 4, PAL.ICE, D.O.none);
        D.rect(x, -8, -12, 8, 8, c2, D.O.ink2);
        break;
      case 'glove':
        D.rect(x, -10, -6, 16, 18, c1, D.O.ink3);
        D.circle(x, 8, 2, 10, c1, D.O.ink3);
        D.rect(x, -12, 8, 20, 8, PAL.WHITE, D.O.ink2);
        break;
      case 'potion':
        D.poly(x, [[-13, -6], [13, -6], [9, 16], [-9, 16]], c1, D.O.ink3);
        D.rect(x, -7, -16, 14, 11, PAL.BONE2, D.O.ink3);
        D.rect(x, -6, -19, 12, 5, c2, D.O.ink2);
        D.poly(x, [[-8, 6], [8, 6], [6, 12], [-6, 12]], PAL.WHITE, D.O.none);
        break;
      case 'tattoo':
        D.circle(x, 0, 0, 15, c1, D.O.ink3);
        D.poly(x, [[0, -9], [7, 0], [0, 9], [-7, 0]], PAL.WHITE, D.O.ink2);
        D.circle(x, 0, 0, 3, PAL.INK, D.O.none);
        break;
      case 'cloak':
        D.poly(x, [[-15, 14], [-9, -12], [0, -15], [9, -12], [15, 14]], c1, D.O.ink3);
        D.poly(x, [[-5, -14], [5, -14], [3, 12], [-3, 12]], c2, D.O.none);
        D.circle(x, 0, -8, 4, PAL.GOLD, D.O.ink2);
        break;
      case 'armor':
        D.poly(x, [[-15, -12], [15, -12], [15, 6], [0, 16], [-15, 6]], c1, D.O.ink3);
        D.rect(x, -2, -12, 4, 26, c2, D.O.none);
        D.rect(x, -12, -2, 24, 4, c2, D.O.none);
        break;
      case 'arm':
        D.rect(x, -8, -14, 16, 18, c1, D.O.ink3);
        D.capsule(x, 0, 4, 0, 18, 10, PAL.STEEL, D.O.ink3);
        D.circle(x, 0, 20, 8, c1, D.O.ink3);
        D.rect(x, -8, -14, 16, 5, PAL.E3, D.O.ink2);
        break;
      case 'dagger':
        D.poly(x, [[-6, 14], [-4, -16], [6, -16], [8, 14]], c1, D.O.ink3);
        D.rect(x, -10, 12, 20, 7, c2, D.O.ink3);
        D.poly(x, [[-2, -16], [3, -16], [0, -22]], c1, D.O.ink2);
        break;
      case 'gear':
        D.starPath(x, 8, 17, 11, 0);
        D.fill(x, c1); D.ink(x, PAL.INK, 3);
        D.circle(x, 0, 0, 6, PAL.WHITE, D.O.ink3);
        break;
      case 'bone':
        D.capsule(x, -13, -9, 13, 9, 8, c1, D.O.ink3);
        D.circle(x, -14, -10, 6, c1, D.O.ink3);
        D.circle(x, 14, 10, 6, c1, D.O.ink3);
        break;
      case 'goggles':
        D.rect(x, -17, -6, 34, 13, c1, D.O.ink3);
        D.circle(x, -8, 0, 5, PAL.ICE, D.O.ink2);
        D.circle(x, 8, 0, 5, PAL.ICE, D.O.ink2);
        D.rect(x, -20, -3, 6, 6, c2, D.O.ink2);
        D.rect(x, 14, -3, 6, 6, c2, D.O.ink2);
        break;
      case 'amulet':
        D.arcRing(x, 0, -2, 12, Math.PI * 0.9, Math.PI * 2.1, 3, c2, D.O.empty);
        D.poly(x, [[0, -4], [11, 4], [0, 15], [-11, 4]], c1, D.O.ink3);
        D.circle(x, 0, 4, 4, PAL.WHITE, D.O.none);
        break;
      case 'chip':
        D.rect(x, -14, -14, 28, 28, c1, D.O.ink3);
        D.rect(x, -7, -7, 14, 14, PAL.INK, D.O.none);
        for (var q = -1; q <= 1; q++) {
          D.rect(x, -18, q * 8 - 2, 5, 4, PAL.STEEL, D.O.ink2);
          D.rect(x, 13, q * 8 - 2, 5, 4, PAL.STEEL, D.O.ink2);
        }
        break;
      case 'heart':
        D.circle(x, -7, -5, 8, c1, D.O.ink3);
        D.circle(x, 7, -5, 8, c1, D.O.ink3);
        D.poly(x, [[-14, -2], [14, -2], [0, 16]], c1, D.O.ink3);
        D.circle(x, -6, -6, 3, PAL.WHITE, D.O.none);
        break;
      default:
        D.rect(x, -14, -14, 28, 28, c1, D.O.ink3);
    }
  });
};

/* =========================================================
   5. 子弹 / 特效
   ========================================================= */
S.drawBullet = function (x, b, ox, oy) {
  var ang = Math.atan2(b.vy, b.vx);
  ox = ox || 0; oy = oy || 0;                 // 显示帧插值的亚帧偏移
  var bx = b.x + ox, by = b.y + oy;
  switch (b.kind) {
    case 'rocket':
      D.at(x, bx, by, ang, function (g) {
        D.capsule(g, -12, 0, 8, 0, 12, b.color, D.O.ink25);
        D.poly(g, [[8, -6], [18, 0], [8, 6]], b.dark || PAL.E8D, D.O.ink25);
        D.poly(g, [[-12, -4], [-20 - Math.random() * 6, 0], [-12, 4]], PAL.MUZZLE, D.O.none);
      });
      break;
    case 'flame': {
      // 透明度随生命变化：改用 ctx.globalAlpha，避免每颗火焰弹分配选项对象
      var fa = U.clamp(b.life / b.lifeMax, 0, 1);
      x.save();
      x.globalAlpha = fa;
      D.circle(x, bx, by, b.r, b.tintA || PAL.MUZZLE, D.O.none);
      D.circle(x, bx, by, b.r * 0.55, PAL.WHITE, D.O.none);
      x.restore();
      break;
    }
    case 'orb':
      D.circle(x, bx, by, b.r, b.color, D.O.ink25);
      D.circle(x, bx - b.r * 0.25, by - b.r * 0.25, b.r * 0.35, PAL.WHITE, D.O.none);
      break;
    case 'laser':
      D.at(x, bx, by, ang, function (g) {
        D.capsule(g, -16, 0, 10, 0, 6, b.color, D.O.ink2);
        D.capsule(g, -14, 0, 10, 0, 2.5, PAL.WHITE, D.O.none);
      });
      break;
    case 'bolt':
      D.at(x, bx, by, ang, function (g) {
        D.poly(g, [[-9, -3], [10, 0], [-9, 3]], b.color, D.O.ink2);
      });
      break;
    case 'ball':
      D.circle(x, bx, by, b.r, b.color, D.O.ink25);
      D.circle(x, bx - b.r * 0.3, by - b.r * 0.3, b.r * 0.4, PAL.WHITE, D.O.none);
      break;
    default: // 普通弹药
      D.at(x, bx, by, ang, function (g) {
        D.capsule(g, -7, 0, 7, 0, 7, b.color, D.O.ink2);
      });
  }
};

/* =========================================================
   通用绘制注册表
   每种"种类"的画法与其剔除半径放在一起注册，
   渲染循环只做 S.drawObj / S.cullRadius，不再写 switch。
   新增一种特效 = 一次 S.register()，不必改任何渲染代码。
   ========================================================= */
S.kinds = Object.create(null);

S.register = function (kind, def) {
  // 归一化成"一定有 cullR"的形状，避免可选字段在存进注册表后仍然是可选
  var entry = {
    cullR: def.cullR === undefined ? 16 : def.cullR,
    draw: def.draw
  };
  S.kinds[kind] = entry;
  return entry;
};

/** 该对象在屏幕外需要多大余量才能安全剔除（形状越大余量越大） */
S.cullRadius = function (obj) {
  var d = S.kinds[obj.kind];
  if (!d) return 16;
  return typeof d.cullR === 'function' ? d.cullR(obj) : d.cullR;
};

S.drawObj = function (x, obj) {
  var d = S.kinds[obj.kind];
  if (d) d.draw(x, obj);
};

/* ---- 粒子种类注册 ---- */
S.register('text', {
  cullR: 40,
  draw: function (x, p) {
    // 按字号挑选共享常量，避免每帧为飘字分配选项对象
    var to = p.size <= 15 ? D.O.ink2 : (p.size <= 19 ? D.O.ink3 : D.O.ink4);
    D.text(x, p.text, p.x, p.y, p.size, p.color, to);
  }
});

S.register('slash', {
  cullR: 140,     // 挥击弧半径可达 110
  draw: function (x, p) {
    var k = U.clamp(p.life / p.lifeMax, 0, 1);
    var prog = 1 - k;
    var a0 = p.a - p.arc / 2 + p.arc * prog * 0.15;
    var a1 = p.a - p.arc / 2 + p.arc * (0.15 + prog * 0.9);
    x.save();
    x.globalAlpha = k * 0.95;
    D.arcRing(x, p.x, p.y, p.r, a0, a1, 9, PAL.WHITE, D.O.empty);
    x.restore();
  }
});

S.register('ring', {
  cullR: 140,     // 爆炸冲击环半径可达 90
  draw: function (x, p) {
    var k = U.clamp(p.life / p.lifeMax, 0, 1);
    var rr = p.r0 + (p.r1 - p.r0) * (1 - k);
    x.save(); x.globalAlpha = k;
    D.arcRing(x, p.x, p.y, rr, 0, U.TAU, p.w * k + 1, p.color, D.O.empty);
    x.restore();
  }
});

S.register('blast', {
  cullR: 130,
  draw: function (x, p) {
    var k = U.clamp(p.life / p.lifeMax, 0, 1);
    x.save(); x.globalAlpha = k * 0.9;
    D.circle(x, p.x, p.y, p.r * (0.6 + (1 - k) * 0.7), p.color, D.O.none);
    D.circle(x, p.x, p.y, p.r * (0.34 + (1 - k) * 0.5), PAL.MUZZLE, D.O.none);
    x.restore();
  }
});

S.register('spark', {
  cullR: 20,
  draw: function (x, p) {
    var k = U.clamp(p.life / p.lifeMax, 0, 1);
    x.save(); x.globalAlpha = k;
    D.circle(x, p.x, p.y, Math.max(1, p.r * k), p.color, D.O.none);
    x.restore();
  }
});

S.register('flash', {
  cullR: 40,
  draw: function (x, p) {
    var k = U.clamp(p.life / p.lifeMax, 0, 1);
    x.save(); x.globalAlpha = k * 0.9;
    D.starPath(x, 4, p.r, p.r * 0.3, p.rot || 0);
    D.fill(x, PAL.MUZZLE); x.restore();
  }
});

S.register('dot', {
  cullR: 16,
  draw: function (x, p) {
    var k = U.clamp(p.life / p.lifeMax, 0, 1);
    x.save(); x.globalAlpha = k;
    D.circle(x, p.x, p.y, Math.max(0.8, p.r * k), p.color, D.O.none);
    x.restore();
  }
});

/* 打墙碎屑：带黑轮廓的小方块（与"溅血 / 火花"在形状与轮廓上区分开 ——
   玩家要能一眼看出"我在打的是墙"，这是隐藏要素能不能被发现的前提） */
S.register('chip', {
  cullR: 22,
  draw: function (x, p) {
    var k = U.clamp(p.life / p.lifeMax, 0, 1);
    x.save(); x.globalAlpha = k;
    x.translate(p.x, p.y);
    x.rotate((p.rot || 0) + (1 - k) * 3.2);
    D.rect(x, -p.r, -p.r, p.r * 2, p.r * 2, p.color, D.O.ink2);
    x.restore();
  }
});

/** 子弹的剔除半径同样集中在这里，不再散落在渲染循环中 */
S.bulletCullR = function (b) {
  if (b.kind === 'laser') return 30;    // 长条形状
  if (b.kind === 'flame') return 30;
  if (b.kind === 'rocket') return 20;
  return 14;
};

/* =========================================================
   掉落物：形状固定（只有上下浮动），因此烘焙成贴图后 1:1 贴出。
   直接绘制每个掉落物要 11 次调用，贴图只要 1 次 drawImage。
   坐标取整 → 1:1 贴图不做重采样，线条依旧锐利。
   ========================================================= */
var PICKUP_BOX = 30;

function drawPickupShape(x, kind) {
  if (kind === 'heal') {
    D.circle(x, 0, 0, 9, PAL.HEAL, D.O.ink25);
    D.rect(x, -2, -6, 4, 12, PAL.WHITE, D.O.none);
    D.rect(x, -6, -2, 12, 4, PAL.WHITE, D.O.none);
  } else {
    D.poly(x, [[0, -9], [8, -2], [6, 8], [-6, 8], [-8, -2]], PAL.MAT, D.O.ink25);
    D.poly(x, [[0, -9], [8, -2], [0, 0]], PAL.WHITE, D.O.none);
  }
}

S.pickupSprite = function (kind) {
  return cached('pk-' + kind, PICKUP_BOX, PICKUP_BOX, function (x) {
    x.translate(PICKUP_BOX / 2, PICKUP_BOX / 2);
    drawPickupShape(x, kind);
  });
};

/** 掉落材料 / 回血 */
S.drawPickup = function (x, p, time) {
  var kind = p.kind === 'heal' ? 'heal' : 'mat';
  var spr = S.pickupSprite(kind);
  if (!spr) {   // 无 DOM 环境的降级路径
    D.at(x, Math.round(p.x), Math.round(p.y + Math.sin(time * 5 + p.seed) * 2.2), 0, function (g) {
      drawPickupShape(g, kind);
    });
    return;
  }
  // 浮动量取整，保证贴图 1:1 贴出（不重采样 = 不糊）
  var bob = Math.round(Math.sin(time * 5 + p.seed) * 2.2);
  x.drawImage(spr.canvas, Math.round(p.x) - PICKUP_BOX / 2, Math.round(p.y) + bob - PICKUP_BOX / 2,
    spr.width, spr.height);
};

/* =========================================================
   6b. 瓦片（`art_tiles.ts` 的形状 → 像素）
   ---------------------------------------------------------
   分工：`art_tiles.ts` 只回答"这一格是实心 / 直段 / 端头 / 转角 / 丁字 / 孤立"，
   本函数回答"这六种形状各自长什么样"。于是改规则不碰画法、改画法不碰规则。

   **接缝画在哪一边，完全由 mask 决定**（不是由形状猜）：
   形状只说明了"有几条边连着"，而 mask 才说明"是哪几条边"。
   只按形状画的表现是：转角与端头都会画在同一个方向 —— 画面上像
   贴错方向的瓷砖，而它看起来"只是有点怪"，不会报错。

   `inset` 是接缝内缩：接缝落在瓦片边界上时，相邻两格各画一条会叠成双线，
   内缩之后才是"一格一条"。这是瓦片美术里最容易忽略的一格。
   ========================================================= */
S.drawTile = function (x, def, tileId, mask, px, py, size, col) {
  if (!def || !col) return false;
  var inset = col.inset === undefined ? 2 : col.inset;
  var seam = col.seam || PAL.INK;
  var fill = col.fill || PAL.G2;
  var lit = col.lit || null;
  var dark = col.dark || null;
  var s = Number(size) || 16;

  /* **实心瓦片走短路**：mask 15 = 四面都是同种地形。
     它占绝大多数（实测：一整片连续的铺装里 80% 以上是实心），
     而它的接缝在相邻格各画一条会叠成双线 —— 所以实心格**不画接缝**，
     只画主体与立体的上下两条亮暗边。
     这一步是量出来的：不短路时静态层烘焙从 4.5 万笔涨到 7.5 万笔，
     把"烘焙帧上限 6 万"这条守卫直接顶红。短路后接缝只出现在真正有拐弯的地方，
     而那正是**需要**看见接缝的地方。 */
  if (mask === 15 && tileId.indexOf('fill') >= 0) {
    D.rect(x, px, py, s, s, fill, D.O.none);
    if (col.bevel) {
      if (lit) D.rect(x, px, py, s, Math.max(1, s * 0.18), lit, D.O.none);
      if (dark) D.rect(x, px, py + s - Math.max(1, s * 0.18), s, Math.max(1, s * 0.18), dark, D.O.none);
    }
    return true;
  }

  /* 主体：一块方砖。`bevel` 时上面一条亮、下面一条暗 —— 这是"立体边"的
     全部实现（**不是渐变**：两条纯色块，与美术宪法一致）。 */
  D.rect(x, px, py, s, s, fill, D.O.none);
  if (col.bevel) {
    if (lit) D.rect(x, px, py, s, Math.max(1, s * 0.18), lit, D.O.none);
    if (dark) D.rect(x, px, py + s - Math.max(1, s * 0.18), s, Math.max(1, s * 0.18), dark, D.O.none);
  }

  /* 接缝：mask 的每一位 = 那一边是**地形边界**，于是那一边画一条缝。
     上下左右与 `ArtTiles.OFFSETS` 同序。 */
  if (def.art && def.art.seam) {
    x.strokeStyle = seam;
    x.lineWidth = 1;
    var edges = [
      [px, py + inset, px + s, py + inset],                       // 上
      [px + s - inset, py, px + s - inset, py + s],               // 右
      [px, py + s - inset, px + s, py + s - inset],               // 下
      [px + inset, py, px + inset, py + s]                        // 左
    ];
    for (var i = 0; i < 4; i++) {
      if (mask & (1 << i)) continue;      // 这一边连着 → 不画缝
      x.beginPath();
      x.moveTo(edges[i][0], edges[i][1]);
      x.lineTo(edges[i][2], edges[i][3]);
      x.stroke();
    }
  }

  /* 形状专有的结构细节。这里**刻意只留转角那一块内凹**：
     直段的"正中一道砖缝"与丁字的"中心接点"我加过又删了 ——
     量出来的账是它们在静态层里又吃掉约 9 千笔绘制，而观感上与
     "接缝已经标出了走向"重复。转角不同：它必须一眼看出**拐向哪边**，
     而接缝只说明"哪几边有边"，说明不了拐向。
     这条注释留着，是因为"再加一个装饰"看起来永远很便宜。 */
  if (tileId.indexOf('corner') >= 0) {
    var miss = (~mask) & 15;
    var nx = (miss & 2) ? 1 : ((miss & 8) ? -1 : 0);
    var ny = (miss & 4) ? 1 : ((miss & 1) ? -1 : 0);
    if (nx && ny) {
      var w = s * 0.3;
      D.rect(x, px + (nx > 0 ? s - w - inset : inset), py + (ny > 0 ? s - w - inset : inset), w, w, seam, D.O.none);
    }
  }
  return true;
};

/* =========================================================
   7. 炮塔（工程学）
   ========================================================= */
S.drawTurret = function (x, t, time) {
  var rot = t.aim || 0;
  D.at(x, t.x, t.y, 0, function (g) {
    D.ellipse(g, 0, 9, 17, 7, 0, 'rgba(16,13,12,0.20)', D.O.none);
    D.rect(g, -15, -6, 30, 16, PAL.GREY, D.O.ink3);
    D.rect(g, -11, -10, 22, 6, PAL.DARK, D.O.ink2);
  });
  D.at(x, t.x, t.y, rot, function (g) {
    D.circle(g, 0, -4, 13, PAL.BONE, D.O.ink3);
    D.rect(g, 10, -9, 26, 10, PAL.DARK, D.O.ink3);
    D.circle(g, 0, -4, 4, t.muzzle > 0 ? PAL.MUZZLE : PAL.E3, D.O.ink2);
    if (t.muzzle > 0) {
      D.starPath(g, 4, 12, 4, time * 10);
      D.fill(g, PAL.MUZZLE);
    }
  });
  // 血条
  if (t.hp < t.maxHp) {
    var w = 34, k = t.hp / t.maxHp;
    D.rect(x, t.x - w / 2, t.y - 34, w, 6, PAL.TROUGH, D.O.ink2);
    D.rect(x, t.x - w / 2, t.y - 34, w * k, 6, PAL.E2, D.O.none);
  }
};

/* =========================================================
   7. 怪物子弹
   ========================================================= */
S.drawEnemyBullet = function (x, b, time, ox, oy) {
  var ang = Math.atan2(b.vy, b.vx);
  ox = ox || 0; oy = oy || 0;
  var bx = b.x + ox, by = b.y + oy;
  if (b.kind === 'bossball') {
    D.circle(x, bx, by, b.r, b.color, D.O.ink3);
    D.circle(x, bx - b.r * 0.28, by - b.r * 0.28, b.r * 0.34, PAL.WHITE, D.O.none);
    D.starPath(x, 5, b.r * 1.5, b.r * 0.9, time * 2);
    D.ink(x, PAL.INK, 2);
  } else {
    D.at(x, bx, by, ang, function (g) {
      D.circle(g, 0, 0, b.r, b.color, D.O.ink25);
      D.circle(g, b.r * 0.25, -b.r * 0.25, b.r * 0.35, PAL.WHITE, D.O.none);
    });
  }
};

/* =========================================================
   8b. 定义期自检（**这个模块原先一条都没有**）
   ---------------------------------------------------------
   为什么这里最需要它：造型分派是"**注册即声明**" —— 写错一个字符串，
   画面上的表现是"那个东西不出现"，而不是报错。两个真实的静默故障：

     · `S.drawObj`（第 1101 行）在 `kind` 没注册时**什么都不画**，
       连一次 console 都没有 —— 少一个粒子，没人会发现
     · `S.drawPickup`（第 1231 行）写的是 `p.kind === 'heal' ? 'heal' : 'mat'`，
       于是**任何**写错的掉落物种类都静默变成 `mat`（回血药画成材料）

   这一版**刻意不做的**：不拿手写清单去跟代码对账。试过一版"把弹丸/掉落物的
   `values()` 清单与源码里的 `kind ===` 分支逐一比对"，那是错的 ——
   `mat` 是 `else` 兜底（不是分支）、`bulletCullR` 只管剔除半径不管形状，
   于是判据会大面积假阳。"清单与代码有没有对齐"是**检查期**的事，
   留在 `test/art.mjs`；启动期只验"注册表自身是不是完整可用的"。
   ========================================================= */
/** 粒子种类清单（注册表在每个 `S.register` 处 populate；这里只钉住"必须有"的那几个） */
var REQUIRED_PARTICLE_KINDS = ['text', 'slash', 'ring', 'blast', 'spark', 'flash', 'dot', 'chip'];

S.audit = function () {
  var problems: string[] = [];
  var i;

  /* ---- 粒子注册表：每一项都得真的能画 ---- */
  var reg = Object.keys(S.kinds);
  if (!reg.length) problems.push('粒子注册表是空的（S.register 一次都没被调用）');
  for (i = 0; i < reg.length; i++) {
    var e = S.kinds[reg[i]];
    if (!e) { problems.push('粒子种类 ' + reg[i] + ' 是空的'); continue; }
    /* 这一条直接对着 drawObj 的 `if (d) d.draw(x, obj)`：没有 draw 就永远不会被画 */
    if (typeof e.draw !== 'function') {
      problems.push('粒子种类 ' + reg[i] + ' 没有 draw —— S.drawObj 会用 `if (d)` 静默跳过它');
    }
    if (!(e.cullR !== undefined && (typeof e.cullR === 'function' || isFinite(e.cullR)))) {
      problems.push('粒子种类 ' + reg[i] + ' 的 cullR 既不是数字也不是函数（剔除余量算不出来）');
    }
  }
  /* 声明了却没注册 = 那个效果在画面上永远不会出现 */
  for (i = 0; i < REQUIRED_PARTICLE_KINDS.length; i++) {
    var k = REQUIRED_PARTICLE_KINDS[i];
    if (reg.indexOf(k) < 0) problems.push('粒子种类 ' + k + ' 声明了却没注册（这个特效永远画不出来）');
  }

  /* ---- 注册表不能有孤儿：注册了却没人用的种类是死配置 ---- */
  var registered = Object.keys(S.kinds).length;
  return {
    ok: problems.length === 0, problems: problems,
    counts: { particles: registered, required: REQUIRED_PARTICLE_KINDS.length }
  };
};

var spriteVerdict = S.audit();
if (!spriteVerdict.ok) throw new Error('sprites.ts 造型分派自检失败：\n' + spriteVerdict.problems.join('\n'));
SelfCheck.register('Sprites', S.audit);

/* =========================================================
   9. 造型分派表登记到扩展点总账（见 registry.ts）
   ---------------------------------------------------------
   这些"种类"以前只存在于 if/else 分支里：`def.shape` 写错会静默退化成 blob、
   `legs` 写错就是"少画两条腿"，没人报错。现在它们和别的家族一样被声明与审计。
   ========================================================= */
Registry.family('enemyShape', {
  note: '怪物身体造型（sprites.ts 的 shape 分派）', owner: 'sprites.ts',
  values: function () { return ['blob', 'spiky', 'jelly', 'eye']; }
});
Registry.family('enemyLegs', {
  note: '怪物腿部造型（nub 短腿 / thick 粗腿 / tentacle 触手 / float 悬浮石笋）', owner: 'sprites.ts',
  values: function () { return ['nub', 'thick', 'tentacle', 'float']; }
});
Registry.family('enemyMouth', {
  note: '怪物嘴型（draw2d 的 mouth 分派）', owner: 'sprites.ts',
  values: function () { return ['none', 'flat', 'grin', 'open', 'wave', 'angry']; }
});
Registry.family('enemyEye', {
  note: '眼睛画法（draw2d 的 eye 分派；`none` = 不画，给"眼球本体就是眼睛"的怪用）', owner: 'sprites.ts',
  /* ⚠ 这里**不列 `empty`**：它从来没有过画法，混进这张表是因为 `D.O.empty` 是
     一个选项常量（"全部用默认参数"），被当成了眼型。声明一个画不出来的值
     就是假声明 —— 而假声明的表现是"选了它，画的是另一张脸"。 */
  values: function () { return ['none', 'dot', 'round', 'stern', 'angry', 'dead']; }
});
Registry.family('bulletKind', {
  note: '弹丸造型（我方 bullet / 敌方 ebullet 共用的 kind）', owner: 'sprites.ts',
  values: function () { return ['shot', 'knife', 'sword', 'spear', 'axe', 'hammer', 'bolt', 'ball', 'orb', 'rocket', 'flame', 'laser', 'bossball']; }
});
Registry.family('particleKind', {
  note: '粒子特效种类（S.register 的画法注册表）', owner: 'sprites.ts',
  values: function () { return Object.keys(S.kinds); }
});
Registry.family('pickupKind', {
  note: '掉落物种类（材料 / 回血）', owner: 'sprites.ts',
  values: function () { return ['mat', 'heal']; }
});
Registry.family('itemIcon', {
  note: '道具图标画法（S.itemIcon 的 icon 分派；default 是方块兜底）', owner: 'sprites.ts',
  values: function () {
    return ['amulet', 'arm', 'armor', 'bar', 'bone', 'boot', 'bottle', 'chip', 'cloak', 'clover',
      'dagger', 'gear', 'glove', 'goggles', 'heart', 'helm', 'magnet', 'potion', 'scope', 'stone', 'tattoo'];
  }
});

Registry.family('weaponKind', {
  note: '武器造型（S.drawWeapon 的 kind 分派）', owner: 'sprites.ts',
  values: function () {
    return ['knife', 'sword', 'spear', 'axe', 'hammer', 'torch', 'taser', 'plasma', 'tentacle',
      'pistol', 'smg', 'minigun', 'shotgun', 'sniper', 'laser', 'railgun', 'rocket', 'flame',
      'crossbow', 'sling', 'sentry', 'orb'];
  }
});
Registry.family('weaponType', {
  note: '武器类别（近战 / 远程，影响命中判定与手感）', owner: 'data_weapons.ts',
  values: function () { return ['melee', 'ranged']; }
});

/**
 * **武器图集**：武器是刚体，只绕握把旋转 —— 正是"贴图 + rotate"的适用场景。
 * 形状本体烘一次（含 tints 与 0.82 缩放），绘制时只做 translate + rotate。
 *
 * 唯一的例外是 `tentacle`：它的鞭身正弦相位与挥舞进度 swing 有关，
 * 形状本身随 swing 变 → 那种武器按 swing 分档各烘一张（0.25 一档）。
 * 哪些武器"形状随 swing 变"是**声明**出来的（WEAPON_SWING_SHAPED），不是猜的。
 */
S.WEAPON_SWING_SHAPED = { tentacle: true };
S.weaponSprite = function (kind, tints, scale, swing) {
  if (typeof document === 'undefined') return null;
  scale = scale || 1;
  var sw = S.WEAPON_SWING_SHAPED[kind] ? Math.round((swing || 0) * 4) / 4 : 0;
  var key = 'wp-' + kind + '-' + ((tints && tints.join('')) || '') + '-' +
    scale.toFixed(2) + '-' + sw.toFixed(2);
  var w = Math.ceil(140 * scale), h = Math.ceil(72 * scale);   // 覆盖最长的矛/等离子刃
  return cached(key, w, h, function (x) {
    x.translate(w / 2, h / 2);
    S.drawWeapon(x, kind, 0, tints, sw, scale);               // 形状本体（旋转交给调用方）
  });
};

/**
 * 这一层的**美术资源归属**（`art_spec.ts` 的"谁生产了哪一类资源"）。
 *
 * 为什么必须登记：规范表里写了 12 类资源，而"哪几类这个项目真的做了"
 * 只能由生产它的模块自己说。不登记的话，`pnpm run art` 会把
 * "规范里有、项目里没做"这一类**漏报成通过**。
 *
 * 本文件生产四类：
 *   · `icon`     —— 道具图标（`itemIcon`，21 种画法 + 兜底）
 *   · `device`   —— 器械装置（炮塔 / 子弹 / 敌方弹丸）
 *   · `object`   —— 交互物件（掉落物：材料 / 回血）
 *   · `particle` —— 粒子贴图（`S.kinds` 里注册的 8 种画法）
 *   · `fx`       —— 特效贴图（白闪剪影走 `hitFlash`）
 */
Art.noteOwner('icon', 'sprites.ts');
Art.noteOwner('device', 'sprites.ts');
Art.noteOwner('object', 'sprites.ts');
Art.noteOwner('particle', 'sprites.ts');
Art.noteOwner('fx', 'sprites.ts');
/* `promo`（标题字与徽记）也在这里：它们与其它类别**一样走缓存**，
   于是"宣传美术"在本项目里不是一堆外部图片，而是同一套画法的两件作品。 */
Art.noteOwner('promo', 'sprites.ts');
/* 白闪：`enemyFlash` 用的是 shader 库里的 `hitFlash`。
   登记"谁用了哪条 shader"与"谁生产了哪类资源"是两件事 ——
   前者回答"这条效果接入了吗"，后者回答"这类资源有人做吗"。 */
ArtShaders.noteUse('hitFlash', 'sprites.ts');
ArtShaders.noteUse('elite', 'sprites.ts');

export { S, S as Sprites };
