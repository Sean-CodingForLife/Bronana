/* =========================================================
   art_parallax.ts — **分层视差背景** + **状态动画**（非人物件）
   ---------------------------------------------------------
   两样东西放一个文件，因为它们回答的是同一个问题：
   **"这一层在动，但它不参与玩法"**。
   动的方式只有两种 —— 跟着镜头动（视差），或者跟着时间动（动画）。

   ---------------------------------------------------------
   一、视差：为什么这里**真的**有得谈
   ---------------------------------------------------------
   视差滚动要有意义，前提是"镜头会平移一段距离"。这一点成立：
   战场 1680×1260，视口 1280×720（`cam.zoom` 缺省 1），
   于是横向可平移 ±200px、纵向 ±270px。玩家从房间一头走到另一头时，
   背景以 `rate` 倍的速度跟动 —— 画面于是有了"前面还有东西"的深度。

   `rate` 的取值有硬约束：
     · `1.0` = 完全跟镜头 = 与地面同速 = **看起来没动**（那是"贴纸"不是背景）
     · `0`   = 完全不动 = 贴着屏幕 = 一看就假
     · 真实项目用的区间是 **0.15 ~ 0.5**（越远越小）。本项目取 0.10 / 0.22 / 0.38。
   而 `rate` 之间必须**拉开**：两层差 0.02 的话肉眼分不出层次，
   那两层就是白画。`audit()` 因此强制"相邻两层的 rate 差 ≥ 0.05"。

   二、循环包裹：视差不许出现"走到底露出画布外"
   ---------------------------------------------------------
   内容按 `repeat`（周期）在世界坐标里重复铺。镜头最多平移
   `maxPan = (战场 - 视口) / 2`，于是只需要
   `ceil(maxPan * rate / repeat) * 2 + 1` 份副本就永远铺得满 ——
   这个份数是**算出来的**，不是"多画几份保险"。少画一份的表现是
   走到房间角落时背景突然断掉，而它只在**那一个角落**发生。

   三、状态动画：物件的状态变了一下，怎么演出来
   ---------------------------------------------------------
   `anim_*` 之前没有：门是"开着/锁着"的瞬时切换，宝箱是"没开/开了"。
   门在玩家清完房间的**那一刻**从"锁着"跳成"开着"—— 它不报错，
   只是把一件本来可以演的事吞掉了。这里给它一个通用的、**数据驱动**的
   状态动画：一条 clip = 一组关键帧（t, 值），物件的 `t` 由
   "进入这个状态之后过了多久"给。取值用**插值**，于是
   "门闩抬起 0.25 秒"是数据，不是散在渲染里的一个缓动函数。
   ========================================================= */
import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';
import { Art } from './art_spec.ts';

var ArtParallax = {} as ArtParallaxApi;

/* =========================================================
   1. 视差层
   ========================================================= */
ArtParallax.LAYERS = [
  {
    id: 'sky',
    name: '远景',
    depth: 3,
    /** 跟着镜头走的速度：越小越"远" */
    rate: 0.10,
    /** 内容在世界坐标里重复的周期（像素） */
    repeat: 420,
    note: '最远的一层：大块暗色起伏，只给出"远处还有轮廓"',
    bands: 3
  },
  {
    id: 'ridge',
    name: '中景',
    depth: 2,
    rate: 0.22,
    repeat: 360,
    note: '山脊/墙影：比远景亮一档，形状更碎',
    bands: 4
  },
  {
    id: 'ruin',
    name: '近景',
    depth: 1,
    rate: 0.38,
    repeat: 300,
    note: '断柱与残墙：最亮、最实，几乎贴着地面但不进碰撞',
    bands: 5
  }
];

ArtParallax.BY_ID = (function () {
  var m: Record<string, ParallaxLayerDef> = Object.create(null);
  for (var i = 0; i < ArtParallax.LAYERS.length; i++) m[ArtParallax.LAYERS[i].id] = ArtParallax.LAYERS[i];
  return m;
})();

/** id → 层定义（认不出的返回 null；读点一律走它） */
ArtParallax.get = function (id) { return id ? (ArtParallax.BY_ID[id] || null) : null; };

/**
 * 一层的偏移量：**纯函数**。
 *
 * 镜头平移了 `pan` 像素，这一层要平移 `pan * rate`。
 * 返回的是"世界坐标里要额外减掉多少"，调用方直接加在内容位置上。
 * 写成函数是为了它能被单测 —— 视差算错的表现是"走到头背景断了"，
 * 而那只有一个角落能看出来。
 */
ArtParallax.offsetOf = function (layerOrId, camX, camY, viewW, viewH, arenaW, arenaH) {
  var ly = typeof layerOrId === 'string' ? ArtParallax.get(layerOrId) : layerOrId;
  if (!ly) return { x: 0, y: 0 };
  /* 镜头相对战场中心的平移量（钳制之后的值由调用方给，这里只做换算） */
  var panX = (Number(camX) || 0) - (Number(arenaW) || 0) / 2;
  var panY = (Number(camY) || 0) - (Number(arenaH) || 0) / 2;
  return { x: panX * ly.rate, y: panY * ly.rate };
};

/**
 * 这一层要画几份副本才铺得满（**算出来的**）。
 *
 * 推导：镜头最多平移 `maxPan`，于是这一层最多平移 `maxPan * rate`。
 * 内容周期是 `repeat`，所以需要覆盖的长度是 `maxPan * rate` 的两侧各一份，
 * 即 `ceil(maxPan * rate / repeat) * 2 + 1`。
 * 少画一份的表现是"走到某个角落背景突然断掉"——只在那一处发生。
 */
ArtParallax.copiesOf = function (layerOrId, viewW, viewH, arenaW, arenaH) {
  var ly = typeof layerOrId === 'string' ? ArtParallax.get(layerOrId) : layerOrId;
  if (!ly) return 1;
  /* 视口比战场大时没有可平移的余地（钳制把镜头钉在中心） */
  var maxPanX = Math.max(0, ((Number(arenaW) || 0) - (Number(viewW) || 0)) / 2);
  var maxPanY = Math.max(0, ((Number(arenaH) || 0) - (Number(viewH) || 0)) / 2);
  var need = Math.max(maxPanX, maxPanY) * ly.rate;
  return Math.ceil(need / ly.repeat) * 2 + 1;
};

/**
 * 摊开成绘制清单：每一份副本在世界坐标里的位置。
 * `tick` 只影响**装饰性抖动**（火光/尘埃），不参与位置 —— 于是
 * "同一帧位置一定一样"，而抖动可以随时间变。
 */
ArtParallax.layout = function (layerOrId, camX, camY, viewW, viewH, arenaW, arenaH, tick) {
  var ly = typeof layerOrId === 'string' ? ArtParallax.get(layerOrId) : layerOrId;
  var out: ParallaxItem[] = [];
  if (!ly) return out;
  var off = ArtParallax.offsetOf(ly, camX, camY, viewW, viewH, arenaW, arenaH);
  var copies = ArtParallax.copiesOf(ly, viewW, viewH, arenaW, arenaH);
  var half = (copies - 1) / 2;
  var ph = Math.max(0, Math.floor(Number(tick) || 0));
  for (var i = 0; i < copies; i++) {
    var k = i - half;
    var x = Math.round(ly.repeat * k + off.x);
    /* 每一份的相位由**它在世界里的档位**决定（不是随机）：
       同一份永远长一样，于是平移时不会"抖动"或"重掷" */
    var seed = ArtParallax.hashSeed(ly.id, k);
    out.push({
      layer: ly.id, copy: k, x: x, y: Math.round(-off.y * 0.35), seed: seed,
      flick: Math.sin((ph + seed) * 0.06) * 0.5 + 0.5
    });
  }
  return out;
};

/** 档位 → 一个稳定的种子（同一份副本永远同一个值） */
ArtParallax.hashSeed = function (key, k) {
  var h = 2166136261 >>> 0;
  var s = String(key) + '|' + String(k);
  for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
  return (h % 1000) / 1000;
};

/* =========================================================
   2. 状态动画（非人物件）
   ========================================================= */
ArtParallax.CLIPS = [
  {
    id: 'doorOpen',
    name: '开门',
    /** 作用在谁身上（只是说明，读点由调用方决定） */
    subject: 'door',
    duration: 0.30,
    note: '门闩抬起：横向门闩的抬升量从 1 到 0（1 = 完全压住缺口）',
    keys: [
      { t: 0, v: 1 },
      { t: 0.55, v: -0.18 },   // 冲过一点再回落 —— "抬起"要有惯性
      { t: 1, v: 0 }
    ]
  },
  {
    id: 'doorClose',
    name: '关门',
    subject: 'door',
    duration: 0.22,
    note: '门闩落下（反向播一遍会有"弹起"，所以单独一条）',
    keys: [
      { t: 0, v: 0 },
      { t: 0.7, v: 1.12 },
      { t: 1, v: 1 }
    ]
  },
  {
    id: 'chestOpen',
    name: '开箱',
    subject: 'chest',
    duration: 0.45,
    note: '箱盖掀起的角度（0 = 关着，1 = 完全掀开）',
    keys: [
      { t: 0, v: 0 },
      { t: 0.35, v: 1.15 },
      { t: 1, v: 1 }
    ]
  },
  {
    id: 'shrineSpin',
    name: '神龛旋转',
    subject: 'shrine',
    duration: 2.4,
    loop: true,
    note: '孢子神龛的浮环持续旋转（1 = 一圈）',
    keys: [{ t: 0, v: 0 }, { t: 1, v: 1 }]
  },
  {
    id: 'pillarCrumble',
    name: '断柱崩塌',
    subject: 'pillar',
    duration: 0.8,
    note: '近景断柱被震到：0 = 完好，1 = 只剩基座',
    keys: [{ t: 0, v: 0 }, { t: 0.25, v: 0.35 }, { t: 1, v: 1 }]
  }
];

ArtParallax.CLIP_BY_ID = (function () {
  var m: Record<string, AnimClipDef> = Object.create(null);
  for (var i = 0; i < ArtParallax.CLIPS.length; i++) m[ArtParallax.CLIPS[i].id] = ArtParallax.CLIPS[i];
  return m;
})();

ArtParallax.clip = function (id) { return id ? (ArtParallax.CLIP_BY_ID[id] || null) : null; };

/**
 * 在 `t`（0..1 的**进度**）处取样。
 *
 * 线性插值而不是缓动表：这些动画是"物件动一下"，
 * 缓动函数一多就成了"每条动画一个曲线"，而曲线该写在关键帧里
 * （`doorOpen` 的过冲就是靠中间那个关键帧表达的）。
 */
ArtParallax.sample = function (clipOrId, t) {
  var c = typeof clipOrId === 'string' ? ArtParallax.clip(clipOrId) : clipOrId;
  if (!c || !c.keys || !c.keys.length) return 0;
  var u = Number(t);
  if (!isFinite(u)) u = 0;
  u = u < 0 ? 0 : (u > 1 ? 1 : u);
  if (u <= c.keys[0].t) return c.keys[0].v;
  for (var i = 1; i < c.keys.length; i++) {
    var a = c.keys[i - 1], b = c.keys[i];
    if (u <= b.t) {
      var span = b.t - a.t;
      var k = span <= 0 ? 1 : (u - a.t) / span;
      return a.v + (b.v - a.v) * k;
    }
  }
  return c.keys[c.keys.length - 1].v;
};

/** 进度：`elapsed` 秒 → 0..1（钳住；`loop` 的 clip 取小数部分） */
ArtParallax.progress = function (clipOrId, elapsed) {
  var c = typeof clipOrId === 'string' ? ArtParallax.clip(clipOrId) : clipOrId;
  if (!c) return 0;
  var e = Number(elapsed);
  if (!isFinite(e) || e <= 0) return 0;
  var k = e / (c.duration || 1);
  if (c.loop) return k - Math.floor(k);
  return k > 1 ? 1 : k;
};

/** 取一条 clip 的值：`elapsed` 秒之后它到哪了（读点走这一个，别自己算） */
ArtParallax.valueAt = function (clipOrId, elapsed) {
  return ArtParallax.sample(clipOrId, ArtParallax.progress(clipOrId, elapsed));
};

/* =========================================================
   3. 定义期自检
   ========================================================= */
ArtParallax.audit = function () {
  var problems: string[] = [];

  /* ---- 视差层 ---- */
  if (ArtParallax.LAYERS.length < 2) {
    problems.push('视差层少于 2 层：一层不构成"视差"，那只是背景图');
  }
  var seenId: Record<string, boolean> = Object.create(null);
  var prevRate: number | null = null;
  var prevDepth: number | null = null;
  var sorted = ArtParallax.LAYERS.slice().sort(function (a, b) { return b.depth - a.depth; });
  for (var i = 0; i < ArtParallax.LAYERS.length; i++) {
    var ly = ArtParallax.LAYERS[i];
    if (!ly.id) problems.push('第 ' + i + ' 层没有 id');
    if (seenId[ly.id]) problems.push('视差层 id 重复：' + ly.id);
    seenId[ly.id] = true;
    if (!ly.name || !ly.note) problems.push(ly.id + ' 缺少名字或说明');
    if (!(ly.rate > 0 && ly.rate < 1)) {
      problems.push(ly.id + ' 的 rate 必须严格落在 (0,1)：0=贴屏幕、1=跟地面同速（都看不出来）');
    }
    if (!(ly.repeat > 0)) problems.push(ly.id + ' 的 repeat 必须是正数');
    if (!(ly.bands > 0 && ly.bands === Math.floor(ly.bands))) problems.push(ly.id + ' 的 bands 必须是正整数');
    if (!(ly.depth >= 1 && ly.depth === Math.floor(ly.depth))) problems.push(ly.id + ' 的 depth 必须是正整数');
  }
  /* 相邻两层必须**拉得开** —— 差 0.02 的话肉眼分不出层次，两层就是白画 */
  for (var s = 0; s < sorted.length; s++) {
    if (prevRate !== null && Math.abs(sorted[s].rate - prevRate) < 0.05) {
      problems.push('视差层 ' + sorted[s].id + ' 与它的相邻层 rate 只差 ' +
        Math.abs(sorted[s].rate - prevRate).toFixed(3) + '（< 0.05 就分不出层次）');
    }
    prevRate = sorted[s].rate;
    if (prevDepth !== null && sorted[s].depth >= prevDepth) {
      problems.push('视差层的 depth 必须随 rate 单调（越远 depth 越大）');
    }
    prevDepth = sorted[s].depth;
  }
  /* 越远越慢：depth 越大（越远）→ rate 必须越小，两者**反向**变化，
     于是 (Δdepth × Δrate) 必须 < 0。
     这一条我写错过两次（先写成 < 0 判"反了"、再写成 <= 0 判"同向"），
     两次都被这段自检当场拦住 —— 一条挂在启动期的断言比一句注释值钱，
     因为它会在**下一次**有人改这两个数字时再拦一次。 */
  for (var j = 0; j < ArtParallax.LAYERS.length; j++) {
    for (var k = j + 1; k < ArtParallax.LAYERS.length; k++) {
      var a = ArtParallax.LAYERS[j], b = ArtParallax.LAYERS[k];
      if ((a.depth - b.depth) * (a.rate - b.rate) >= 0) {
        problems.push('层 ' + a.id + ' 与 ' + b.id + ' 的 depth 与 rate 不同向（越远必须越慢）');
      }
    }
  }

  /* ---- 动画 clip ---- */
  if (ArtParallax.CLIPS.length < 3) problems.push('状态动画少于 3 条：物件状态的变化是最低要求');
  var seenClip: Record<string, boolean> = Object.create(null);
  for (var c = 0; c < ArtParallax.CLIPS.length; c++) {
    var cl = ArtParallax.CLIPS[c];
    if (!cl.id) problems.push('第 ' + c + ' 条 clip 没有 id');
    if (seenClip[cl.id]) problems.push('clip id 重复：' + cl.id);
    seenClip[cl.id] = true;
    if (!cl.name || !cl.note) problems.push(cl.id + ' 缺少名字或说明');
    if (!cl.subject) problems.push(cl.id + ' 没有说它作用在什么物件上');
    if (!(cl.duration > 0)) problems.push(cl.id + ' 的时长必须是正数');
    if (!cl.keys || cl.keys.length < 2) {
      problems.push(cl.id + ' 的关键帧少于 2 个（那不叫动画）');
      continue;
    }
    /* 关键帧：t 必须严格递增、落在 [0,1]、首尾必须封口 */
    var prevT = -1;
    for (var kk = 0; kk < cl.keys.length; kk++) {
      var key = cl.keys[kk];
      if (!isFinite(key.t) || key.t < 0 || key.t > 1) problems.push(cl.id + ' 第 ' + kk + ' 个关键帧的 t 越界：' + key.t);
      if (key.t <= prevT) problems.push(cl.id + ' 的关键帧 t 必须严格递增（第 ' + kk + ' 个）');
      if (!isFinite(key.v)) problems.push(cl.id + ' 第 ' + kk + ' 个关键帧的 v 不是有限数');
      prevT = key.t;
    }
    if (cl.keys[0].t !== 0) problems.push(cl.id + ' 的第一个关键帧必须落在 t=0（否则开头那一段没有定义）');
    if (cl.keys[cl.keys.length - 1].t !== 1) problems.push(cl.id + ' 的最后一个关键帧必须落在 t=1（否则结尾那一段没有定义）');
    /* 取样器必须真的能取到值 */
    var v0 = ArtParallax.valueAt(cl.id, 0);
    var v1 = ArtParallax.valueAt(cl.id, cl.duration);
    if (!isFinite(v0) || !isFinite(v1)) problems.push(cl.id + ' 取样出非有限数');
  }

  return {
    ok: problems.length === 0, problems: problems,
    counts: {
      layers: ArtParallax.LAYERS.length, clips: ArtParallax.CLIPS.length,
      keys: ArtParallax.CLIPS.reduce(function (a, c) { return a + c.keys.length; }, 0)
    }
  };
};

var verdict = ArtParallax.audit();
if (!verdict.ok) throw new Error('art_parallax.ts 视差与动画表自检失败：\n' + verdict.problems.join('\n'));
SelfCheck.register('ArtParallax', ArtParallax.audit);

/* 登记到扩展点总账：视差层与动画 clip 两个家族 */
Registry.family('parallaxLayer', {
  note: '分层视差背景（rate 越远越小；相邻层必须拉得开，否则两层是白画）', owner: 'art_parallax.ts',
  entries: function () {
    return ArtParallax.LAYERS.map(function (d) { return { id: d.id, refs: [] }; });
  }
});
Registry.family('animClip', {
  note: '非人物件的状态动画（门 / 宝箱 / 神龛 / 断柱）', owner: 'art_parallax.ts',
  entries: function () {
    return ArtParallax.CLIPS.map(function (d) { return { id: d.id, refs: [] }; });
  }
});

/* 资源归属：本模块定义了 `bg`（视差层）与 `anim`（状态动画）这两类；
   实际绘制在 `render.ts`（它是只读世界状态的那一层）。 */
Art.noteOwner('bg', 'art_parallax.ts');
Art.noteOwner('anim', 'art_parallax.ts');

export { ArtParallax };
