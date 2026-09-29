/* =========================================================
   _ctx.mjs — 带 CTM 追踪的 Canvas2D 桩
   普通桩只能回答"调用了哪些绘制函数"，回答不了"画在世界的哪个位置"。
   这里维护一个真实的 2D 仿射矩阵（save/restore 栈 + translate/rotate/
   scale/transform/setTransform），把路径点、clip 区域、填充区域都换算成
   设备坐标记录下来。

   这样无头环境也能验证一类只有浏览器才暴露的问题：
   "这段绘制其实落在了别的地方" —— 典型来源是"先建路径、后 translate"
   （Canvas2D 的路径在加入时就被当前变换映射到设备空间，之后改变换
   不会移动已经建好的路径）。

   用法：
     const ctx = makeProbeCtx();
     ctx.translate(...); ctx.rotate(...);   // 想模拟的变换
     drawSomething(ctx);                    // 真实绘制代码
     ctx.clips / ctx.fills / ctx.strokes    // 每次 clip / fill / stroke 的
                                            // 设备空间包围盒与样式
   ========================================================= */

/* ---------------- 2D 仿射矩阵 [a, b, c, d, e, f] ----------------
   x' = a·x + c·y + e
   y' = b·x + d·y + f                                        */
function matMul(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5]
  ];
}

function mapPt(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function bboxOf(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (!isFinite(p[0]) || !isFinite(p[1])) continue;
    if (p[0] < x0) x0 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[0] > x1) x1 = p[0];
    if (p[1] > y1) y1 = p[1];
  }
  if (x0 === Infinity) return null;
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}

/** 旋转椭圆的包围盒半宽/半高（角度区间不是整圈时是"超集"，够用） */
function ellipseHalf(rx, ry, rot) {
  const c = Math.cos(rot || 0), s = Math.sin(rot || 0);
  return [
    Math.sqrt((rx * c) * (rx * c) + (ry * s) * (ry * s)),
    Math.sqrt((rx * s) * (rx * s) + (ry * c) * (ry * c))
  ];
}

export function makeProbeCtx(opts) {
  const o = opts || {};
  const st = {
    m: [1, 0, 0, 1, 0, 0],
    stack: [],
    path: [],
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    globalAlpha: 1,
    lineJoin: 'round',
    lineCap: 'round',
    font: '',
    textAlign: '',
    textBaseline: '',
    globalCompositeOperation: 'source-over'
  };

  const ctx = {
    clips: [],
    fills: [],
    strokes: [],
    rects: [],
    images: [],
    texts: [],
    log: [],
    /** 全局绘制序列（opts.ops 打开）：与 log 不同，它带当时样式与 alpha，
        于是"影子是不是都画在实体之前""哪个层带先画"这类**跨类型**的顺序问题可测。
        fills/images 是分开的数组，拿不到彼此的先后。 */
    ops: [],
    badArgs: [],
    /** 当前变换矩阵（只读快照） */
    get ctm() { return st.m.slice(); },
    /** 当前路径的设备空间包围盒（含未闭合） */
    get pathBox() { return bboxOf(st.path); },
    /** 当前变换把世界点映射到哪 */
    map(x, y) { return mapPt(st.m, x, y); }
  };

  function note(op, args) {
    if (o.log) ctx.log.push([op].concat(args));
    if (o.ops) ctx.ops.push({ op, args, fill: st.fillStyle, stroke: st.strokeStyle, alpha: st.globalAlpha, ctm: st.m.slice() });
    for (const a of args) {
      if (typeof a === 'number' && !isFinite(a)) ctx.badArgs.push(op + '(' + args.join(',') + ')');
    }
  }
  function put(x, y) { note('pt', [x, y]); st.path.push(mapPt(st.m, x, y)); }

  /* ---- 状态 ---- */
  ctx.save = function () {
    note('save', []);
    st.stack.push({ m: st.m.slice(), fillStyle: st.fillStyle, strokeStyle: st.strokeStyle, lineWidth: st.lineWidth, globalAlpha: st.globalAlpha, font: st.font, textAlign: st.textAlign, textBaseline: st.textBaseline, globalCompositeOperation: st.globalCompositeOperation });
  };
  ctx.restore = function () {
    note('restore', []);
    const s = st.stack.pop();
    if (!s) { ctx.badArgs.push('restore 多于 save'); return; }
    st.m = s.m;
    st.fillStyle = s.fillStyle; st.strokeStyle = s.strokeStyle; st.lineWidth = s.lineWidth;
    st.globalAlpha = s.globalAlpha; st.font = s.font; st.textAlign = s.textAlign;
    st.textBaseline = s.textBaseline; st.globalCompositeOperation = s.globalCompositeOperation;
  };
  ctx.getTransform = function () { return { a: st.m[0], b: st.m[1], c: st.m[2], d: st.m[3], e: st.m[4], f: st.m[5] }; };
  ctx.setTransform = function (a, b, c, d, e, f) {
    note('setTransform', [a, b, c, d, e, f]);
    st.m = [a, b, c, d, e, f];
  };
  ctx.resetTransform = function () { st.m = [1, 0, 0, 1, 0, 0]; };
  ctx.transform = function (a, b, c, d, e, f) { note('transform', [a, b, c, d, e, f]); st.m = matMul(st.m, [a, b, c, d, e, f]); };
  ctx.translate = function (x, y) { note('translate', [x, y]); st.m = matMul(st.m, [1, 0, 0, 1, x, y]); };
  ctx.rotate = function (r) {
    note('rotate', [r]);
    const c = Math.cos(r), s = Math.sin(r);
    st.m = matMul(st.m, [c, s, -s, c, 0, 0]);
  };
  ctx.scale = function (sx, sy) { note('scale', [sx, sy]); st.m = matMul(st.m, [sx, 0, 0, sy, 0, 0]); };

  /* ---- 路径 ---- */
  ctx.beginPath = function () { note('beginPath', []); st.path = []; };
  ctx.closePath = function () { note('closePath', []); };
  ctx.moveTo = function (x, y) { put(x, y); };
  ctx.lineTo = function (x, y) { put(x, y); };
  ctx.quadraticCurveTo = function (cx, cy, x, y) { put(cx, cy); put(x, y); };
  ctx.bezierCurveTo = function (c1x, c1y, c2x, c2y, x, y) { put(c1x, c1y); put(c2x, c2y); put(x, y); };
  ctx.arc = function (cx, cy, r, a0, a1, ccw) {
    note('arc', [cx, cy, r, a0, a1, ccw === undefined ? false : ccw]);
    const h = ellipseHalf(r, r, 0);
    put(cx - h[0], cy - h[1]); put(cx + h[0], cy + h[1]);
  };
  ctx.arcTo = function (x1, y1, x2, y2, r) { note('arcTo', [x1, y1, x2, y2, r]); put(x1, y1); put(x2, y2); };
  ctx.ellipse = function (cx, cy, rx, ry, rot, a0, a1, ccw) {
    note('ellipse', [cx, cy, rx, ry, rot, a0, a1, ccw === undefined ? false : ccw]);
    const h = ellipseHalf(Math.abs(rx), Math.abs(ry), rot || 0);
    put(cx - h[0], cy - h[1]); put(cx + h[0], cy + h[1]);
  };
  ctx.rect = function (x, y, w, h) { note('rect', [x, y, w, h]); put(x, y); put(x + w, y + h); };
  ctx.setLineDash = function (a) { note('setLineDash', [a]); };

  /* ---- 绘制 ---- */
  ctx.clip = function () {
    note('clip', []);
    ctx.clips.push({ box: bboxOf(st.path), m: st.m.slice() });
  };
  ctx.fill = function () {
    note('fill', []);
    ctx.fills.push({ box: bboxOf(st.path), style: st.fillStyle, alpha: st.globalAlpha, m: st.m.slice() });
  };
  ctx.stroke = function () {
    note('stroke', []);
    ctx.strokes.push({ box: bboxOf(st.path), style: st.strokeStyle, lineWidth: st.lineWidth, alpha: st.globalAlpha, m: st.m.slice() });
  };
  ctx.fillRect = function (x, y, w, h) {
    note('fillRect', [x, y, w, h]);
    ctx.rects.push({ box: bboxOf([mapPt(st.m, x, y), mapPt(st.m, x + w, y + h)]), style: st.fillStyle, alpha: st.globalAlpha });
  };
  ctx.strokeRect = function (x, y, w, h) { note('strokeRect', [x, y, w, h]); };
  ctx.clearRect = function (x, y, w, h) { note('clearRect', [x, y, w, h]); };
  ctx.fillText = function (s, x, y) { note('fillText', [s, x, y]); ctx.texts.push({ text: s, at: mapPt(st.m, x, y), style: st.fillStyle }); };
  ctx.strokeText = function (s, x, y) { note('strokeText', [s, x, y]); };
  ctx.measureText = function (s) { return { width: String(s).length * 6 }; };
  ctx.drawImage = function (img, x, y, w, h) {
    note('drawImage', [x, y, w, h]);
    // ops 里额外记下图片本身：跨类型的顺序断言（"影子都在实体之前"）要按图片身份认
    if (o.ops) ctx.ops[ctx.ops.length - 1].img = img;
    ctx.images.push({ img, at: mapPt(st.m, x || 0, y || 0), w, h, m: st.m.slice() });
  };
  ctx.createPattern = function () { return {}; };
  ctx.getImageData = function (x, y, w, h) { return { data: new Uint8ClampedArray(Math.max(1, (w | 0) * (h | 0) * 4)), width: w | 0, height: h | 0 }; };
  ctx.putImageData = function () { note('putImageData', []); };

  /* ---- 样式属性（普通读写） ---- */
  for (const k of ['fillStyle', 'strokeStyle', 'lineWidth', 'globalAlpha', 'lineJoin', 'lineCap', 'font', 'textAlign', 'textBaseline', 'globalCompositeOperation', 'filter']) {
    Object.defineProperty(ctx, k, {
      get() { return st[k]; },
      set(v) { note('set:' + k, [v]); st[k] = v; }
    });
  }

  ctx._st = st;
  return ctx;
}

/** 真实 canvas 元素桩（sprites.ts 的缓存需要 document.createElement('canvas')） */
export function makeCanvas(w, h, ctx) {
  const c = ctx || makeProbeCtx();
  return {
    width: w || 0,
    height: h || 0,
    getContext: () => c,
    style: {},
    dataset: {},
    addEventListener() {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    _ctx: c
  };
}

/* =========================================================
   最小的**带父子关系**的 DOM 元素桩
   ---------------------------------------------------------
   为什么要有它：`I18n.bindDom / applyDom` 的判据是"遍历页面、找纯文本节点、
   把人能读到的字换掉"。canvas 桩那种 `querySelectorAll: () => []` 的写法
   让这两件事**根本无法被测**（绑定恒为 0），于是 i18n 的测试只能测到
   "表里有键"，测不到"界面真的跟着变了"。

   这里只实现被用到的那几个：`appendChild` / `children` / `textContent`
   （读写，写会清子节点）/ `getAttribute` / `setAttribute` / `querySelectorAll`
   （只支持 `'*'` 与 `[data-i18n]` 两种最简选择器）/ `parentNode`。
   ⚠ **不要去扩展它**：桩越大越像真的 DOM，就越容易掩盖"真浏览器里不一样"的问题。
   ========================================================= */
export function makeDomEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    style: {}, dataset: {},
    children: [],
    parentNode: null,
    _attrs: Object.create(null),
    _text: '',
    addEventListener() {}, removeEventListener() {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
    removeChild(c) {
      const i = el.children.indexOf(c);
      if (i >= 0) { el.children.splice(i, 1); c.parentNode = null; }
      return c;
    },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(el._attrs, k) ? el._attrs[k] : null; },
    setAttribute(k, v) { el._attrs[k] = String(v); },
    removeAttribute(k) { delete el._attrs[k]; },
    /** 后代（前序），不含自己 */
    descendants() {
      const out = [];
      const walk = (n) => { for (const c of n.children) { out.push(c); walk(c); } };
      walk(el);
      return out;
    },
    querySelectorAll(sel) {
      const all = el.descendants();
      if (sel === '*') return all;
      const m = /^\[([\w-]+)\]$/.exec(String(sel));
      if (m) return all.filter(n => n.getAttribute(m[1]) !== null);
      return [];
    }
  };
  Object.defineProperty(el, 'textContent', {
    get() { return el.children.length ? el._text + el.children.map(c => c.textContent).join('') : el._text; },
    set(v) { el._text = String(v); el.children.length = 0; }
  });
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._text; },
    set(v) { el._text = String(v); el.children.length = 0; }
  });
  return el;
}

/** 安装最小 DOM 桩（必须在 loadAll 之前调用） */
export function installDom() {
  const g = globalThis;
  const created = [];
  const dom = {
    _canvases: created,
    head: { appendChild() {} },   // U.injectCSS 会往 head 里插 <style>
    body: { appendChild() {} },
    devicePixelRatio: 1,
    innerWidth: 1280,
    innerHeight: 720,
    performance: { now: () => Date.now() },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame() {},
    addEventListener() {},
    removeEventListener() {},
    createElement(tag) {
      if (tag === 'canvas') { const c = makeCanvas(0, 0); created.push(c); return c; }
      return {
        style: {}, dataset: {},
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        appendChild() {}, addEventListener() {}, removeEventListener() {},
        set textContent(v) {}, set innerHTML(v) {}, set className(v) {}
      };
    },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => []
  };
  g.window = g;
  g.document = dom;
  g.devicePixelRatio = 1;
  g.innerWidth = 1280;
  g.innerHeight = 720;
  return dom;
}
