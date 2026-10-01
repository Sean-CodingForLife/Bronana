/* =========================================================
   viewport.ts — **窗口 / 视口 / 相机**（三件事，三个对象）
   ---------------------------------------------------------
   改造前这三件事压缩在 `render.ts` 的一个 `R.cam` 里：
   `cam.w` / `cam.h` 既是**窗口**的 CSS 尺寸、又是**相机**取景尺寸，
   而 `zoom` 是相机属性。行业通行模型是四层：

       Window ⊃ Viewport ⊃ Layer ⊃ Item
       相机**属于 Viewport**并修改 Viewport 的 canvas 变换 —— **相机不是层**

   所以这里把三件事分开，**每个都有一个能被读出来的名字**：

     · `Window`   —— **设备表面**：CSS 尺寸 + DPR + 由此得的**像素缓冲**尺寸。
                     它只回答"有多少物理像素可用"，不认识世界、不认识相机。
     · `Viewport` —— **设计尺寸 + 缩放策略**，并且是**变换的唯一出处**：
                     `worldToScreen` 与 `applyCamera` **必须互为逆**，
                     而它们都由这里推导（改造前这两条公式各写在两处，
                     靠注释里的那句"它是 applyCamera 的逆"维持一致 —— 那是靠人记住）。
     · `Camera`   —— **只**有世界里的位置、缩放、抖动。它不持有"屏幕多大"。

   ## 缩放策略是**声明**的（这一版刻意声明成"行为不变"）

   现状是"**1 设计单位 = 1 CSS 像素**"（`cam.w = window.innerWidth`）——
   也就是**不缩放**：屏幕多大就看到多大。它的后果很具体：

     · 宽屏玩家**看得更远**（视野随窗口变宽）；
     · 极端宽高比下，相机夹取到世界边界之后会露出世界之外。

   ⚠ **这一版不改变它**（行为指纹必须逐位不变），只把策略**声明出来**：
   `SCALE_POLICY = 'fit-1x'`，并在 `note` 里写清它的后果与另外几档的取舍
   （`letterbox` / `expand` 是主流引擎的做法，见 `techstack-upgrade-research.md` 的
   分辨率策略三家对照）。**改策略是改行为**，要有用户点头 + 指纹基线一起更新。

   它坐 **L0 mech 层**：只依赖 `utils.ts`，不认识 Game / 渲染 / 界面。
   ========================================================= */
import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';

var Viewport = {} as ViewportApi;

/* =========================================================
   1. 缩放策略（**声明出来的那一档**）
   ---------------------------------------------------------
   每一档都写清"看到多少"与"代价"，因为这几档的差别**直接影响玩法**
   （视野即信息，宽屏看得远就是竞技优势）。
   ========================================================= */
var SCALE_POLICIES: ViewportScaleDef[] = [
  {
    id: 'fit-1x', name: '1:1 不缩放（**当前**）',
    note: '1 设计单位 = 1 CSS 像素。屏幕多大就看到多大 —— **宽屏看得更远**；' +
      '极端宽高比下相机夹到世界边界之后会露出世界之外',
    cost: '零（没有额外变换）；代价是**视野随窗口变**'
  },
  {
    id: 'letterbox', name: '保比例 + 黑边',
    note: '按参考分辨率等比缩放，多出来的方向留黑边（Godot 的 `keep` / libgdx 的 `FitViewport`）',
    cost: '黑边占掉一部分屏幕；好处是**所有人看到的视野一样**'
  },
  {
    id: 'expand', name: '保比例 + 多看到内容',
    note: '按参考分辨率等比缩放，多出来的方向**露出更多世界**（Godot 的 `expand` / ' +
      'libgdx 的 `ExtendViewport`）。无黑边，但视野**仍然随宽高比变**（只是变得可控）',
    cost: '要在参考尺寸之外还能画；HUD 要锚到边而不是钉死在参考框里'
  },
  {
    id: 'crop', name: '保比例 + 裁切',
    note: '填满屏幕但切掉超出参考比例的部分（libgdx 的 `FillViewport`）',
    cost: '**窄屏会看不到两边** —— 对俯视竞技场是危险的（看不到就等于被偷袭）'
  }
];
var SCALE_POLICY = 'fit-1x';
/** 参考分辨率：**只有选了带缩放的策略才有意义**。
 *  取值与理由见 `docs/techstack-upgrade-research.md` 的分辨率策略一节
 *  （Godot 推荐 640×360 能整数倍映射到 720p/1080p/1440p/4K；本作是矢量绘制，
 *   不要求整数倍，取 1280×720 更接近"一张房间能装下"的直觉）。 */
var REF_W = 1280, REF_H = 720;

/* =========================================================
   2. Window（设备表面）
   ========================================================= */
var WIN = { cssW: 0, cssH: 0, dpr: 1, bufW: 0, bufH: 0 };

Viewport.resize = function (cssW, cssH, dpr) {
  var d = dpr > 0 ? dpr : 1;
  WIN.cssW = Math.max(1, Math.floor(cssW));
  WIN.cssH = Math.max(1, Math.floor(cssH));
  WIN.dpr = d;
  WIN.bufW = Math.floor(WIN.cssW * d);
  WIN.bufH = Math.floor(WIN.cssH * d);
  return Viewport.windowInfo();
};

/* =========================================================
   3. Viewport（设计尺寸 + 变换的唯一出处）
   ---------------------------------------------------------
   `view()` 给出"这一帧能看到多大一块世界"（**设计单位**）。
   当前策略是 1:1，所以它就等于 CSS 尺寸；换策略时只有这一个函数要改，
   而 `applyCamera` / `worldToScreen` 自动跟着变（它们都从这里取）。
   ========================================================= */
/** 这一帧的取景尺寸（设计单位） */
Viewport.view = function () {
  if (SCALE_POLICY === 'fit-1x') return { w: WIN.cssW, h: WIN.cssH };
  /* 其余策略按参考分辨率等比缩放 —— 留在这里当实现骨架，**当前不启用** */
  var s = Math.min(WIN.cssW / REF_W, WIN.cssH / REF_H);
  if (SCALE_POLICY === 'expand') s = Math.max(WIN.cssW / REF_W, WIN.cssH / REF_H);
  if (SCALE_POLICY === 'crop') s = Math.max(WIN.cssW / REF_W, WIN.cssH / REF_H);
  return { w: WIN.cssW / s, h: WIN.cssH / s };
};

Viewport.windowInfo = function () {
  return { cssW: WIN.cssW, cssH: WIN.cssH, dpr: WIN.dpr, bufW: WIN.bufW, bufH: WIN.bufH };
};
Viewport.policy = function () { return SCALE_POLICY; };
Viewport.policyTable = function () {
  return SCALE_POLICIES.map(function (p) {
    return { id: p.id, name: p.name, note: p.note, cost: p.cost, active: p.id === SCALE_POLICY };
  });
};
Viewport.reference = function () { return { w: REF_W, h: REF_H }; };
Viewport.stretch = function () {
  /* 设计单位 → CSS 像素的倍率。`fit-1x` 恒为 1，也就是**不缩放**。
     换策略时这里是唯一的旋钮（`applyCamera` 与 `worldToScreen` 都乘它）。 */
  var v = Viewport.view();
  return WIN.cssW / v.w;
};

/* =========================================================
   4. 变换：**两条互为逆的公式放在一起**，都从上面推导
   ---------------------------------------------------------
   改造前 `applyCamera` 在 L171、`worldToScreen` 在 L162，
   一致性靠一句注释（"它是 applyCamera 那条变换的逆"）维持 —— 那是靠人记住。
   现在两条并排写，谁改了一看就知道要改另一条。
   ========================================================= */
/**
 * **取景尺寸的一半**（世界单位）—— 相机夹取、变换、以及"中心在哪"都用它。
 * ⚠ 这个函数是硬编码门逼出来的：第一版把 `v.w / 2` / `v.h / 2` 写在三个地方
 * （`worldToScreen` / `applyCamera` / `halfView`），门当场报
 * "同一文件里重复 >=3 次的算术表达式" —— 而它是对的：
 * "取景的一半"是一个概念，写三遍就是三份真相（换缩放策略时漏改一处就错位）。
 */
Viewport.halfView = function (cam) {
  var v = Viewport.view();
  return { w: v.w / 2 / cam.zoom, h: v.h / 2 / cam.zoom };
};

/**
 * 世界坐标 → **画布像素**（`/dpr` 之后才是 CSS 像素，也就是鼠标事件的单位）。
 * 逆变换见 `applyCamera`。
 *
 * ⚠ 与改造前逐位等价（`st = 1` 时化简回 `(wx - cam.x) * dpr * zoom + halfW * dpr`）——
 * `fit-1x` 下 `stretch()` 恒为 `1`，审计里有一条判据守着这件事。
 */
Viewport.worldToScreen = function (cam, wx, wy) {
  var half = Viewport.halfView(cam);
  var st = Viewport.stretch();
  var s = st * cam.zoom * WIN.dpr;
  return {
    x: (wx - cam.x) * s + half.w * cam.zoom * WIN.dpr * st,
    y: (wy - cam.y) * s + half.h * cam.zoom * WIN.dpr * st
  };
};

/**
 * 把画布设成"世界 → 屏幕"的变换（渲染层每帧调一次）。
 * ⚠ 与 `worldToScreen` 是同一件事的两个方向：**改一条就要改另一条**。
 */
Viewport.applyCamera = function (x, cam) {
  var half = Viewport.halfView(cam);
  var k = Viewport.stretch() * WIN.dpr * cam.zoom;
  x.setTransform(k, 0, 0, k, 0, 0);
  x.translate(-cam.x + half.w + cam.shakeX, -cam.y + half.h + cam.shakeY);
};

/* =========================================================
   5. 定义期自检 + 总账
   ========================================================= */
Viewport.audit = function () {
  var problems: string[] = [];
  var seen: Record<string, boolean> = Object.create(null);
  var i;
  for (i = 0; i < SCALE_POLICIES.length; i++) {
    var p = SCALE_POLICIES[i];
    if (!p.id) problems.push('第 ' + i + ' 档缩放策略没有 id');
    else if (seen[p.id]) problems.push('缩放策略 id 重复：' + p.id + '（后一条会覆盖前一条）');
    else seen[p.id] = true;
    if (!p.note) problems.push('缩放策略 ' + p.id + ' 没写"看到多少"（这是选它的唯一理由）');
    if (!p.cost) problems.push('缩放策略 ' + p.id + ' 没写代价（不写代价的选项看起来永远是免费的）');
  }
  if (!seen[SCALE_POLICY]) {
    problems.push('当前策略 ' + SCALE_POLICY + ' 不在策略表里（那它就没有"看到多少 / 代价"的说明）');
  }
  var active = SCALE_POLICIES.filter(function (p) { return p.id === SCALE_POLICY; });
  if (active.length !== 1) problems.push('当前策略在表里出现了 ' + active.length + ' 次（应当恰好一次）');
  if (!(REF_W > 0 && REF_H > 0)) problems.push('参考分辨率不合法：' + REF_W + '×' + REF_H);
  /* ⚠ **这条判据守着"行为逐位不变"**：`fit-1x` 的定义就是"1 设计单位 = 1 CSS 像素"，
     也就是 `stretch() === 1` —— 而 `applyCamera` / `worldToScreen` 的化简
     （去掉 `st` 因子）只在 `st === 1` 时与改造前**逐位相同**。
     谁把 `fit-1x` 的 `view()` 改成会缩放的东西，这条当场红。 */
  if (SCALE_POLICY === 'fit-1x' && WIN.cssW > 0 && Viewport.stretch() !== 1) {
    problems.push('`fit-1x` 的 stretch 必须是 1（当前 ' + Viewport.stretch() +
      '）—— 否则渲染层的变换就不再与改造前逐位相同');
  }
  /* 设计尺寸必须在窗口尺寸算出来之后才有效 —— 这里只查"算出来之后自洽" */
  var v = Viewport.view();
  if (WIN.cssW > 0 && !(v.w > 0 && v.h > 0)) {
    problems.push('窗口 ' + WIN.cssW + '×' + WIN.cssH + ' 算出的取景尺寸不合法：' + v.w + '×' + v.h);
  }
  return { ok: problems.length === 0, problems: problems };
};

Registry.family('viewportScale', {
  note: '视口缩放策略（**声明**的，因为"看到多少"直接影响玩法：视野即信息）',
  owner: 'viewport.ts',
  entries: function () {
    return SCALE_POLICIES.map(function (p) {
      return { id: p.id, name: p.name, note: p.note + '｜代价：' + p.cost };
    });
  }
});

var verdict = Viewport.audit();
if (!verdict.ok) {
  throw new Error('viewport.ts 缩放策略自检失败：\n' + verdict.problems.join('\n'));
}
SelfCheck.register('Viewport', Viewport.audit);

export { Viewport };
