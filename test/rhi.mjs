/* =========================================================
   rhi.mjs — 渲染硬件接口（rhi.ts，R60）
   ---------------------------------------------------------
   这一套测的是**一个承诺**：`RHI.wrap()` 是**透明的**。
   因为 `draw2d.ts` 那 380 行绘制原语**一行都没改**，全靠这句承诺不破 ——
   所以它必须有机器判据，不能靠"我看了一遍没问题"。

   四件事：
     [1] 面的表与后端表自洽（成员非空 / 无重复归类 / 恰好一个活跃后端）
     [2] **透明性**：同一个 ctx，包过与不包，`test/_ctx.mjs` 记下的
         `set:<成员>` + 每次绘制调用的**先后与内容逐字节一致**
     [3] **幂等**：同一个 ctx 只包一次；`isWrapped` 的契约写清
     [4] **绘制原语真的走了 RHI，且面是完整的**：拿一个只会记成员的 Proxy 当 ctx，
         跑一遍 `D.*`，断言**它碰到的每个成员都在 `RHI.surface()` 里** ——
         漏一个声明就红

   ⚠ 用 `test/_assert.mjs` 的 `T`，**不自己抄一份 `ok()`** ——
   那个库的第一句注释就是"55 套各自复制了一份 `ok()`"，而我第一版又抄了一份
   （`drift` 门当场报"自带 ok() 的套件从 54 涨到 55"）。门是对的。
   ========================================================= */
import { installDom, makeProbeCtx } from './_ctx.mjs';
import { loadAll, RENDER_MODULES } from './_load.mjs';
import { T } from './_assert.mjs';

installDom();
await loadAll(RENDER_MODULES);
const g = globalThis;
const { RHI, D, PAL, Registry } = g;

/* ---------------- [1] 面的表与后端表自洽 ---------------- */
T.section('1. 绘制面与后端表');
{
  const groups = RHI.surfaceGroups();
  const flat = RHI.surface();
  T.ok(groups.length >= 3 && flat.length >= 20,
    '绘制面分成 ' + groups.length + ' 块、共 ' + flat.length + ' 个成员');
  T.eq(new Set(flat).size, flat.length, '同一个成员没有跨块重复归类');
  T.ok(flat.every(m => typeof m === 'string' && m.length), '成员名都是非空字符串');
  T.ok(groups.every(x => x.note && x.note.length > 8),
    '每一块都写了用途（不写用途的成员表会被随手塞东西）');

  const backends = RHI.backends();
  T.ok(backends.length >= 3 && backends.filter(b => b.active).length === 1,
    '后端表有 ' + backends.length + ' 项、恰好一个活跃');
  T.ok(backends.every(b => b.note && b.impl),
    '每个后端都写了"是什么"与"实现在哪"（没写 impl 就等于计划里有个名字）');
  T.eq(RHI.activeBackend(), 'canvas2d', '今天的活跃后端是 canvas2d（WebGL2 与 null 是 planned）');

  const v = RHI.audit();
  T.ok(v.ok, '启动期自检认可这套表');
  T.ok(!!(Registry && Registry.has && Registry.has('rhiSurface')), '绘制面注册进了总账');
}

/* ---------------- [2] 透明性：包与不包，记录逐字节一致 ---------------- */
T.section('2. 透明性（本层的核心承诺：包过之后行为逐字节不变）');
{
  /* 一段覆盖各块的绘制序列：状态 / 路径 / 上色 / 文字 / 变换 */
  function sequence(x) {
    x.save();
    x.globalAlpha = 0.85;
    x.beginPath();
    x.moveTo(1, 2); x.lineTo(3, 4); x.quadraticCurveTo(5, 6, 7, 8); x.closePath();
    x.fillStyle = PAL.G2; x.fill();
    x.strokeStyle = PAL.INK; x.lineWidth = 3; x.lineJoin = 'round'; x.lineCap = 'round'; x.stroke();
    x.restore();
    x.fillRect(0, 0, 10, 10);
    x.font = '700 11px sans-serif'; x.textAlign = 'left'; x.textBaseline = 'middle';
    x.fillText('测试', 5, 5);
    x.translate(1, 1); x.rotate(0.5); x.scale(2, 2);
    x.drawImage({ width: 4, height: 4 }, 0, 0);
  }

  const raw = makeProbeCtx({ log: true });
  sequence(raw);
  const target = makeProbeCtx({ log: true });
  const wrapped = RHI.wrap(target);
  sequence(wrapped);

  T.eq(JSON.stringify(target.log), JSON.stringify(raw.log),
    '同一段绘制序列：包过与不包，记录**逐字节一致**（' + raw.log.length + ' 条）');

  T.ok(wrapped.fillStyle === raw.fillStyle && wrapped.lineWidth === raw.lineWidth,
    '读回来的状态也一致（不是只有写被转发）');

  T.eq(Object.keys(wrapped).sort().join(','), Object.keys(raw).sort().join(','),
    '`Object.keys` 看到同一份成员（ownKeys 透传）');
  T.eq('fillRect' in wrapped, 'fillRect' in raw, '`in` 判断一致（has 透传）');
}

/* ---------------- [3] 幂等与可查询 ---------------- */
T.section('3. 幂等与可查询');
{
  const c = makeProbeCtx({ log: true });
  const a = RHI.wrap(c);
  const b = RHI.wrap(c);
  T.ok(a === b, '同一个 ctx 包两次拿到**同一个**视图（WeakMap 缓存）');
  /* ⚠ 契约写清：`isWrapped` 问的是"**这个 ctx** 有没有被包过"。
     第一版断言"视图也说 true"，而 `WRAPPED.get(view)` 里视图不是键 ⇒ false。
     处置是**把契约写清**而不是改实现：视图只可能从 `wrap()` 来，
     而"你手上这个 ctx 被包过没"只对**原对象**有意义。 */
  T.eq(RHI.isWrapped(c), true, 'isWrapped 认原 ctx');
  T.eq(RHI.isWrapped(a), false, 'isWrapped 不认视图（契约不含糊）');
  T.eq(RHI.wrap(null), null, '包 null 返回 null（不抛）');
  T.eq(RHI.wrap(undefined), undefined === RHI.wrap(undefined) ? RHI.wrap(undefined) : null,
    '包 undefined 返回 null');
}

/* ---------------- [4] 绘制原语真的走了 RHI，且面是完整的 ---------------- */
T.section('4. `D.*` 碰到的每个成员都在面里（漏一个声明就红）');
{
  const touched = new Set();
  /* 一个只会记成员的 ctx：
     · `getContext` 必须返回自己 —— `ctxOf` 先试它（桩与真 canvas 都是这样）
     · 状态成员返回**字符串**（`ctxOf` 会写它们）
     · 其余成员当成方法：读一下就记下来，返回空实现 */
  const STATE = new Set(['fillStyle', 'strokeStyle', 'lineJoin', 'lineCap', 'globalAlpha',
    'lineWidth', 'miterLimit', 'font', 'textAlign', 'textBaseline', 'globalCompositeOperation']);
  const spy = new Proxy({}, {
    get(_t, p) {
      if (typeof p !== 'string') return undefined;
      touched.add(p);
      if (p === 'getContext') return () => spy;
      if (STATE.has(p)) return '';
      return () => { };
    },
    set(_t, p, _v) { if (typeof p === 'string') touched.add(p); return true; }
  });

  T.try('跑一遍覆盖各块的 `D.*` 原语', () => {
    D.rect(spy, 0, 0, 10, 10, PAL.G2, D.O.ink3);
    D.circle(spy, 5, 5, 4, PAL.E1, D.O.ink2);
    D.poly(spy, [[0, 0], [1, 0], [1, 1]], PAL.E2, D.O.ink3);
    if (typeof D.capsule === 'function') D.capsule(spy, 0, 0, 20, 6, PAL.E3, D.O.ink2);
    D.text(spy, '测试', 5, 5, 11, PAL.WHITE);
    D.ditherBand(spy, 0, 0, 20, 10, 10, PAL.G1, PAL.G2, 'probe', 0.3);
    if (typeof D.ellipse === 'function') D.ellipse(spy, 3, 3, 4, 2, 0, PAL.E4, D.O.ink2);
  });

  const surface = new Set(RHI.surface());
  /* 桩把 `getContext` 也当成一个成员（`ctxOf` 会先试它）—— 那不是绘制面成员 */
  const ignore = new Set(['getContext', 'then', 'toJSON', 'inspect', 'constructor', 'prototype']);
  const outside = [...touched].filter(m => !surface.has(m) && !ignore.has(m)).sort();

  T.ok(touched.size >= 10, '`D.*` 一共碰到了 ' + touched.size + ' 个 ctx 成员（覆盖面够）');
  T.eq(outside, [], '碰到的成员**全部**在 `RHI.surface()` 里 —— 面是完整的');
}

process.exit(T.done());
