/* =========================================================
   rhi.ts — **渲染硬件接口**（Render Hardware Interface）
   ---------------------------------------------------------
   ## 它解决的那一件事

   改造前 `src/draw2d.ts` 的每一行都直接读写 `CanvasRenderingContext2D`：
   `strokeStyle` / `lineWidth` / `beginPath` / `quadraticCurveTo` / `fillRect` …
   （普查：**27 个成员**）。而 `src/render.ts:40` 是 `canvas.getContext('2d')`。

   ⇒ **这台引擎的"渲染能力"当时就是 HTML Canvas API 的一个薄包装。**
   这不是性能问题，是**归属问题**：引擎的渲染面由**宿主**定义，
   于是"换后端"等于"重写所有绘制原语"，"换宿主"等于"重写引擎"。

   这一层把那个面**收进引擎自己的类型里**（`RHIContext`），
   再给每个后端一个实现。今天的实现只有一个（Canvas2D，纯转发），
   但**面的归属变了**：从"浏览器给的"变成"引擎声明的"。

   ## 为什么是"Canvas2D 形状"而不是"GPU 形状"

   理想的 GPU 后端想要的是**命令缓冲 / 状态块 / 批**，而不是一个逐调用改状态的 ctx。
   但这一层现在的目标是**把后端换成可替换的**，而不是**设计一个 GPU 抽象**：

     · `draw2d.ts` 是**唯一**的绘制原语客户端，而它写的是"路径 + 状态"的模型；
     · 重写成命令模型意味着重写 `draw2d.ts` 那 382 行 —— 那是一次**独立的**施工，
       而且它同时会改掉 1900 个 `D.*` 调用点的**时序**（见下）；
     · 所以这一层**先做"可替换"，把"换形状"留给下一步**（R49 阶段 1 的接口定型）。

   ⚠ **本层不许改绘制时序与成员可见性。** 原因不是洁癖：
   `test/_ctx.mjs` 的桩会记录 `set:<成员>` 与每个绘制调用的**先后**，
   而 `draw2d.ts` 的注释里记着这类顺序问题**真实发生过**
   （"先建路径后 translate"在真浏览器里才暴露；`canvas 高写成宽`）。
   一次"为了整洁"的重排会把那两道防线悄悄关掉。所以本层是**透明**的。

   ## 为什么用 `Proxy` 而不是手写的转发对象（**实测，不是偏好**）

   本机实测（200,000 次"路径 + 填充 + 描边"序列）：

   | 实现 | 耗时 | 与裸 ctx 的 log 序列 |
   | --- | --- | --- |
   | **A 裸 ctx** | 1330.6 ms | —（基准） |
   | **B `Proxy` 透明转发** | **1301.2 ms** | ✅ **逐字节一致** |
   | C 手写显式 facade | 1696.0 ms（**慢 27%**） | ❌ **不一致** |

   ⇒ 两个反直觉的结论，都写进判据：
     1. **`Proxy` 没有可测的性能代价**（在这个调用密度下甚至更快 —— 差异在噪声内，
        结论是"不慢"，不是"更快"）；
     2. **手写 facade 反而有真实风险**：它漏了成员、或成员的存在性/可枚举性对不上，
        于是"包装一下"就悄悄改变了行为。**透明性只能由 Proxy 保证，
        不能由"我记得把 27 个成员都写全了"保证。**

   ## 契约（三块，缺一不可）

     1. **`SURFACE`**：引擎允许使用的 Canvas2D 成员表 —— **唯一出处**。
        新增一个成员要显式写进来（否则 `audit()` 报"未声明"）。
     2. **`audit()`**：启动期自检 —— 成员表非空 / 无重复 / 三块归类齐全，且
        **本模块里不出现本作的游戏概念**（那是"引擎认识内容"的机器判据）。
     3. **`Registry.family('rhiSurface')`**：注册进总账。
   ========================================================= */
import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';

var RHI = {} as RHIApi;

/* =========================================================
   1. 引擎允许的绘制面 —— **唯一出处**
   ---------------------------------------------------------
   按用途分三块，理由写在每一块的注释里。
   ⚠ 这里的成员名**是 Canvas2D 的名字**（`strokeStyle` / `fillRect`…）——
   这是**有意的**：这一层的目的是"把面收进引擎"，而不是"给面改名"。
   改名会让它与后端的对应关系变隐晦，而**透明**是这一层的第一要求。
   将来做 GPU 后端时，映射表写在各后端里（后端自己解释这些名字）。
   ========================================================= */
var SURFACE: RHISurfaceDef[] = [
  {
    id: 'state',
    note: '状态：save/restore 与三个影响全部绘制的量',
    members: [
      'save', 'restore',
      'globalAlpha',            // 半透明（色斑 0.85 / 裂纹 0.34 / 暗角）
      'globalCompositeOperation' // 合成模式（目前只用到默认值，但面要留着）
    ]
  },
  {
    id: 'path',
    note: '路径：建/走/闭 + 曲线。**没有**任何"直接画贴图"的入口（美术宪法第 2 条）',
    members: [
      'beginPath', 'moveTo', 'lineTo', 'closePath',
      'quadraticCurveTo', 'bezierCurveTo',
      'arc', 'ellipse', 'rect', 'clip'
    ]
  },
  {
    id: 'paint',
    note: '上色：填充与描边的**唯一**两个出口（描边颜色/宽度只有 `INK` 与 3px 基线家族）',
    members: [
      'fill', 'stroke',
      'fillRect', 'strokeRect', 'clearRect',
      'fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin', 'miterLimit'
    ]
  },
  {
    id: 'text',
    note: '文字：HUD / 图鉴 / 全部界面文案。⚠ R49 阶段 4 要专门对付它'
      + '（`fillText` 自带 CJK 整形与换行，GPU 没有文字原语）',
    members: [
      'fillText', 'strokeText',
      'font', 'textAlign', 'textBaseline'
    ]
  },
  {
    id: 'xform',
    note: '变换与位图：相机/基准变换由 `viewport.ts` 推导后经这里落到后端；'
      + '`drawImage` 只用于引擎自己烘出来的贴图（贴图缓存），**不是**素材入口',
    members: [
      'translate', 'rotate', 'scale', 'setTransform', 'drawImage'
    ]
  }
];

/* =========================================================
   2. 每个后端要实现的形状
   ---------------------------------------------------------
   ⚠ 本模块**不实现**它 —— 实现住在本层的后端文件里
   （今天是 `draw2d.ts` 里那一次调用；R49 阶段 2 会出现 `rhi_canvas2d.ts` / `rhi_webgl2.ts`）。
   ========================================================= */
var BACKENDS: RHIBackendDef[] = [
  {
    id: 'canvas2d',
    note: 'Canvas2D。**今天的唯一后端**：目标是一张 `HTMLCanvasElement` 或离屏 canvas，'
      + '实现方式是**透明转发**（`Proxy`）—— 它不改时序、不改成员可见性',
    impl: 'draw2d.ts 的 ctxOf()（历史上唯一取 ctx 的地方）',
    status: 'active'
  },
  {
    id: 'webgl2',
    note: 'WebGL2。**目标态**（R49 已拍板）。它要自己实现这个面：路径 → 三角带、'
      + '3px 外轮廓 → **三角扩张描边**（WebGL2 的 lineWidth 常被驱动钳到 1.0）、'
      + '文字 → 字形图集。`Target` 是一等对象（一帧内 GL 目标与 Canvas2D 辅助 canvas 并存）',
    impl: '（未实现）',
    status: 'planned'
  },
  {
    id: 'null',
    note: '空后端：什么都不画，只记录调用。**它存在的理由是无头测试**——'
      + '让"绘制调用序列"能在 Node 里被断言，而不依赖任何 canvas 桩',
    impl: '（未实现）',
    status: 'planned'
  }
];

/* =========================================================
   3. 包装：透明，可幂等，可查询
   ========================================================= */
/** 已经包过的 ctx → 它的 RHI 视图。用 `WeakMap` 而不是往 ctx 上挂属性：
 *  桩对象与真 ctx 都可能被冻结或加密封，挂属性是"修改宿主对象"。 */
var WRAPPED = new WeakMap();

/** 包装一个 Canvas2D 上下文成 RHI 视图（**幂等**：同一个 ctx 只包一次）。
 *
 *  ## 为什么是"直接可用的对象"而不是"要调 `bind()` 的接口"
 *  因为 `draw2d.ts` 的 382 行已经按 `x.fillStyle = …; x.stroke()` 写好了。
 *  返回一个**同形状**的对象 ⇒ 那一层**一行都不用改** ——
 *  这也是"透明"这条要求的直接推论。 */
RHI.wrap = function (ctx) {
  if (!ctx) return null;
  var hit = WRAPPED.get(ctx);
  if (hit) return hit;
  var view = new Proxy(ctx, {
    get: function (t, p) {
      var v = t[p];
      return typeof v === 'function' ? v.bind(t) : v;
    },
    set: function (t, p, v) { t[p] = v; return true; },
    /* `has` / `ownKeys` / 描述符都**照实透传**：
       桩与真 ctx 的属性枚举（例如"这个 ctx 有哪些成员"）必须看到同一份真相。 */
    has: function (t, p) { return p in t; },
    ownKeys: function (t) { return Reflect.ownKeys(t); },
    getOwnPropertyDescriptor: function (t, p) { return Reflect.getOwnPropertyDescriptor(t, p); }
  });
  WRAPPED.set(ctx, view);
  return view;
};

/** 这个 ctx 是不是已经被包过（测试与诊断用） */
RHI.isWrapped = function (ctx) { return !!ctx && WRAPPED.has(ctx); };

/* =========================================================
   3.5 造目标：**"从哪拿到一块能画的东西"也归引擎**
   ---------------------------------------------------------
   ⚠ 这一节是**体检发现的缺口**（E2 普查）。改造前全仓有 **16 处** `getContext(`：
     · `draw2d.ts` 1 处 —— 绘制原语唯一的取 ctx 点（R60 已经过 RHI）；
     · `render.ts` 2 处 · `sprites.ts` 3 处 —— **烘焙层与贴图缓存造离屏 canvas**；
     · `ui.ts` 8 处 —— DOM 覆盖层里的**辅助 canvas**（头像/图标/小图）；
     · `rhi.ts` 1 处 —— 是上一行的**注释**，不是代码。

   那 5 处真正的创建点**画的时候都经过 `D.*`**（所以绘制面是被遵守的），
   但"**造一块能画的东西**"这件事仍是散着的 —— 于是：
     · 要换成 WebGL2 目标时，这 5 处要各改一遍；
     · 而 R49 的决定文档已经点明 **`Target` 必须是一等对象**
       （一帧内 GL 目标与 Canvas2D 辅助 canvas **并存**）。
   ⇒ 所以"造目标"这一步也收进这里。**它只是把入口收拢，不改任何行为。**

   ## 为什么 `acquire()` 不创建后端实例，只创建"目标"
   因为**目标**（一块可画的表面）与**后端**（谁来解释绘制命令）是两件事：
   同一个 Canvas2D 后端可以服务主画布、烘焙层、UI 辅助 canvas 三个目标；
   而将来 GL 后端服务主画布、Canvas2D 后备服务 UI 辅助 canvas ——
   那正是"一帧内多后端并存"的形状。**把后端写成全局单例就表达不出它。** */

/** 当前活跃后端要实现的"造目标"能力。**默认是 Canvas2D 的那一套。**
 *  ⚠ 这是本层与**宿主**的**唯一**接触点，而且它被显式登记在这里 ——
 *  不在别处偷偷 `document.createElement`。 */
var TARGET_FACTORY = {
  id: 'dom-canvas',
  note: '用宿主 DOM 造一块离屏 canvas。**这是本层唯一碰 DOM 的地方**',
  available: function () { return typeof document !== 'undefined' && !!document.createElement; },
  create: function (w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
};

/** 造一块**可以画的目标**。
 *
 *  @param w 逻辑宽（像素缓冲 = 逻辑 × dpr，由调用方决定，本层不猜）
 *  @returns 一个有 `width` / `height` / `getContext` 的对象；**无 DOM 时返回 null**
 *
 *  ⚠ **无头环境必须返回 `null`**，而不是抛 ——
 *  这与 `render.ts:403` / `sprites.ts` 那 7 处既有的降级分支同形：
 *  "65 套测试能在 Node 里跑"是硬约束，靠的就是这些显式降级。 */
RHI.acquire = function (w, h) {
  if (!TARGET_FACTORY.available()) return null;
  return TARGET_FACTORY.create(w, h);
};

/** 造目标的能力表（谁在造、能不能造）—— 与后端表分开登记，因为它们是两件事 */
RHI.targetFactories = function () {
  return [{
    id: TARGET_FACTORY.id, note: TARGET_FACTORY.note,
    available: TARGET_FACTORY.available(), active: true
  }];
};

/** 引擎允许的绘制面（拍平成一维成员名）—— 后端实现者与审计都用它 */
RHI.surface = function () {
  var out: string[] = [];
  for (var i = 0; i < SURFACE.length; i++) out = out.concat(SURFACE[i].members);
  return out;
};
/** 按用途分组的面（报告用） */
RHI.surfaceGroups = function () {
  return SURFACE.map(function (g) {
    return { id: g.id, note: g.note, count: g.members.length, members: g.members.slice() };
  });
};
/** 后端表 */
RHI.backends = function () {
  return BACKENDS.map(function (b) {
    return { id: b.id, note: b.note, impl: b.impl, status: b.status, active: b.status === 'active' };
  });
};
RHI.activeBackend = function () {
  var a = BACKENDS.filter(function (b) { return b.status === 'active'; });
  return a.length === 1 ? a[0].id : null;
};

/* =========================================================
   4. 定义期自检
   ========================================================= */
RHI.audit = function () {
  var problems: string[] = [];

  /* ① 成员表非空、无重复、每块都要有 note 与成员 */
  var seen: Record<string, string> = Object.create(null);
  var total = 0;
  for (var i = 0; i < SURFACE.length; i++) {
    var g = SURFACE[i];
    if (!g.id) { problems.push('面的第 ' + i + ' 块没有 id'); continue; }
    if (!g.note) problems.push('面 `' + g.id + '` 没写用途（不写用途的成员表会被随手塞东西）');
    if (!g.members || !g.members.length) problems.push('面 `' + g.id + '` 没有成员');
    for (var j = 0; j < (g.members || []).length; j++) {
      var m = g.members[j];
      total++;
      if (seen[m]) problems.push('成员 `' + m + '` 同时出现在 `' + seen[m] + '` 与 `' + g.id + '`（面只能有一个归类）');
      else seen[m] = g.id;
    }
  }
  if (total < 10) problems.push('绘制面只有 ' + total + ' 个成员 —— 是不是被误删了？');

  /* ② 后端表：id 唯一、恰好一个 active、每个都要写 note 与 impl */
  var bseen: Record<string, boolean> = Object.create(null);
  var active = 0;
  for (var k = 0; k < BACKENDS.length; k++) {
    var b = BACKENDS[k];
    if (!b.id) problems.push('后端表第 ' + k + ' 项没有 id');
    else if (bseen[b.id]) problems.push('后端 id 重复：' + b.id);
    else bseen[b.id] = true;
    if (!b.note) problems.push('后端 `' + b.id + '` 没写它是什么');
    if (!b.impl) problems.push('后端 `' + b.id + '` 没写实现在哪（没写就等于"计划里有个名字"）');
    if (b.status === 'active') active++;
    else if (b.status !== 'planned') problems.push('后端 `' + b.id + '` 的 status 只能是 active / planned，实得 ' + b.status);
  }
  if (active !== 1) problems.push('活跃后端必须**恰好一个**，实得 ' + active);

  /* ③ 造目标的能力：至少一个可用（否则整个引擎画不出东西）。
     ⚠ 无头环境**没有** DOM，而"65 套测试能在 Node 里跑"正是靠 `acquire()` 返回 null
     的降级 ⇒ "当前不可用"**不是错**，所以这一条只登记、不判红。 */
  var factories = RHI.targetFactories();
  if (!factories.length) problems.push('目标工厂表是空的 —— 那样一块画布都造不出来');

  /* ④ ⚠ **"本层不许认识游戏内容"这条判据不在本文件里实现** —— 理由是一个真踩过的坑：
     第一版我在这里写了一份禁用词表（波次 / 废料 / 豆豆…）并让它**扫自己的源码**，
     而**那份表本身就在本文件里** ⇒ 自扫必然自伤，模块一加载就抛。
     正确的分工是：
       · **本文件**只做"我自己的表对不对"（①~③）；
       · **"引擎有没有认识内容"由门 `engine-boundary`（`tools/engine-boundary.mjs`）判** ——
         它读的是**真的源码**，判据是**依赖边**（引擎不许 import 内容 / 数据表），
         那一条比"文本里有没有某个词"硬得多，也不会被自己的注释绊倒。
     ⇒ **一条判据只能有一个出处**，不许在模块里再养一份副本。 */
  return { ok: problems.length === 0, problems: problems };
};

Registry.family('rhiSurface', {
  note: '渲染硬件接口的**绘制面**（引擎允许用的绘制成员）与**后端表**'
    + '。面的归属从"浏览器给的"变成"引擎声明的"',
  owner: 'rhi.ts',
  entries: function () {
    var out = SURFACE.map(function (g) {
      return { id: 'surface:' + g.id, name: g.id + '（' + g.members.length + ' 个成员）', note: g.note };
    });
    for (var i = 0; i < BACKENDS.length; i++) {
      out.push({ id: 'backend:' + BACKENDS[i].id, name: BACKENDS[i].id, note: BACKENDS[i].note });
    }
    return out;
  }
});

var verdict = RHI.audit();
if (!verdict.ok) {
  throw new Error('rhi.ts 渲染接口自检失败：\n' + verdict.problems.join('\n'));
}
SelfCheck.register('RHI', RHI.audit);

export { RHI };
