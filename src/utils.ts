/* =========================================================
utils.ts — 数学 / 随机 / 格式 / 样式注入
无任何渲染逻辑，可在 Node 中直接加载（无头测试用）
========================================================= */
var U = {} as UtilsApi;

U.TAU = Math.PI * 2;

/* ---------------- 数学 ---------------- */
U.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
U.lerp = function (a, b, t) { return a + (b - a) * t; };
U.dist2 = function (ax, ay, bx, by) { var dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; };
U.dist = function (ax, ay, bx, by) { return Math.sqrt(U.dist2(ax, ay, bx, by)); };
U.angle = function (ax, ay, bx, by) { return Math.atan2(by - ay, bx - ax); };
U.round2 = function (v) { return Math.round(v * 100) / 100; };
/** 取**三位**小数（技能参数用：符文连乘之后要抹掉浮点尾巴，
 *  而两位不够 —— 弹速 460 × 1.2 = 552，可半径 9 × 1.3 = 11.7 会变成 11.7 没问题，
 *  但连乘三项之后两位会把误差放大到看得见）。与 `round2` 一样是唯一实现。 */
U.round3 = function (v) { return Math.round((Number(v) || 0) * 1000) / 1000; };
/* ---- 百分号：**唯一实现** ----
   改造前 `Math.round(v * 100) + '%'` 在四个模块里各写了一遍
   （`camp.ts` 5 处、`forge.ts` 3 处、`stats.ts`、`ui.ts`）—— 而且它们
   **看起来不一样**：有的带正负号、有的不带。两套写法只要有一处改了舍入，
   "同一个数值在工坊里显示 25%、在属性面板里显示 25.0%"就会成为一个
   没人能一眼看出原因的差异。所以两件事分开、各自只有一处实现。 */
U.pct = function (v) { return String(Math.round((Number(v) || 0) * 100)); };
U.plusPct = function (v) {
  var n = Math.round((Number(v) || 0) * 100);
  return (n >= 0 ? '+' : '') + n + '%';
};
/* 一位小数的百分比：**给 CSS 宽度用**（血条 / 经验条 / Boss 条）。
   与 `pct` 分开是因为用途不同：`pct` 是"给人读的数"（25 比 25.0 好），
   而进度条截断到整数会**一格一格地跳** —— 两者要的东西不一样，
   所以是两个函数而不是一个函数加参数（参数化之后调用点看不出区别，
   而"血条用哪个"这件事必须一眼看出来）。 */
U.pct1 = function (v) { return ((Number(v) || 0) * 100).toFixed(1) + '%'; };
U.approach = function (cur, target, maxStep) {
  if (cur < target) return Math.min(cur + maxStep, target);
  if (cur > target) return Math.max(cur - maxStep, target);
  return target;
};

/* ---------------- 随机 ----------------
   xorshift32。**状态可以拿出来也可以放回去**（`state()` / `setState()`）——
   存档要用：不带着状态，"继续上一局"就把随机流重置回种子起点，
   于是读档后的商店 / 选卡 / 刷怪与"没存过档接着玩"是两条不同的序列（实测过）。
   这两个方法不改变序列本身（指纹不受影响）。 */
U.rng = function (seed) {
  var s = (seed >>> 0) || 1;
  var fn = (function () {
    // xorshift32
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  }) as RngFn;
  fn.state = function () { return s >>> 0; };
  fn.setState = function (v) { s = (v >>> 0) || 1; return fn; };
  return fn;
};

U.seedFromStr = function (str) {
  var h = 2166136261 >>> 0;
  for (var i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
};

/* ---------------- 格式 ---------------- */
U.plus = function (v) { return (v >= 0 ? '+' : '') + v; };
U.fmtNum = function (v) {
  if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
  if (v >= 10000) return (v / 1000).toFixed(1) + 'k';
  return String(Math.round(v));
};

/* ---------------- 加权随机 ----------------
   只留 pickWeighted：它是唯一有调用方的（武器/道具/怪物/升级卡四处）。
   `pick` 与 `shuffle` 没有任何调用方，而且它们的 `rnd` 参数缺省时会退化成
   Math.random —— 这种"默认值破坏可复现性"的助手留在公共 API 里迟早会被误用。 */
U.pickWeighted = function (entries, rnd) {
  // entries: [{w:number, ...}]
  var total = 0, i;
  for (i = 0; i < entries.length; i++) total += entries[i].w;
  var r = (rnd || Math.random)() * total;
  for (i = 0; i < entries.length; i++) { r -= entries[i].w; if (r <= 0) return entries[i]; }
  return entries[entries.length - 1];
};

/* ---------------- 对象 ---------------- */
U.cloneObj = function (o) { return Object.assign({}, o); };

/* ---------------- DOM ----------------
   注意 `U.el` 的返回类型是 **HTMLElement**（types.d.ts）。
   这一条以前是 `any`，于是界面层到处写成 `var b: any = U.el('button', …)` ——
   一个 any 会生出十几个 any（架构体检里 ui.ts 的 15 处 any 基本都是它的下游）。 */
U.$ = function (sel, root) { return (root || document).querySelector(sel) as HTMLElement | null; };
U.$$ = function (sel, root) {
  return Array.prototype.slice.call((root || document).querySelectorAll(sel)) as HTMLElement[];
};
U.el = function (tag, cls, html) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};
U.clear = function (node) { while (node && node.firstChild) node.removeChild(node.firstChild); };

/* ---------------- 全屏 ----------------
   浏览器与 Electron 外壳走的是同一个 Fullscreen API（外壳就是 Chromium），
   所以桌面模式不需要单独开一条 IPC 通道。带 webkit 前缀是因为老 Safari 只有前缀版。
   全程 try/catch：缺用户手势、被策略拒绝都只会让切换"没生效"，绝不该抛出去。 */
U.fullscreenSupported = function () {
  if (typeof document === 'undefined') return false;
  var d = document as any;
  return !!(d.fullscreenEnabled || d.webkitFullscreenEnabled);
};
U.isFullscreen = function () {
  if (typeof document === 'undefined') return false;
  var d = document as any;
  return !!(d.fullscreenElement || d.webkitFullscreenElement);
};
/** 切换全屏；返回切换后**期望**的状态（失败返回当前实际状态） */
U.toggleFullscreen = function () {
  if (typeof document === 'undefined') return false;
  var d = document as any;
  var el: any = d.documentElement;
  try {
    if (U.isFullscreen()) {
      var exit = d.exitFullscreen || d.webkitExitFullscreen;
      if (exit) { var r = exit.call(d); if (r && r.catch) r.catch(function () { }); }
      return false;
    }
    var req = el && (el.requestFullscreen || el.webkitRequestFullscreen);
    if (!req) return false;
    var p = req.call(el);
    if (p && p.catch) p.catch(function () { });
    return true;
  } catch (e) {
    return U.isFullscreen();
  }
};

/* =========================================================
   事件总线（信号）
   最初的实现只有 on/off/emit。审计出的四个问题在游戏循环里都很致命：
     1) 一个处理器抛错会向外传播 → 中断整帧模拟，并且后续处理器不再执行
     2) 处理器里再 emit（重入）没有深度保护 → 自触发信号把调用栈打爆
     3) 派发过程中增删监听器行为依赖下标，不可预测
     4) 没有 once / clear / 计数，init 跑两次订阅就翻倍（全项目 off 用了 0 次）
   现在补齐：异常隔离、重入深度上限、快照语义、once/clear/计数与诊断。
   ========================================================= */
var BUS_MAX_DEPTH = 32;

U.Bus = function (busName) {
  var map = Object.create(null);
  var depth = 0;
  var stats = { emits: 0, calls: 0, errors: 0, refused: 0, lastError: null };

  var api = {
    name: busName || 'bus',

    /** 订阅；返回原函数（可直接传给 off） */
    on: function (evt, fn) {
      (map[evt] || (map[evt] = [])).push(fn);
      return fn;
    },

    /** 只触发一次（触发前先摘除，重入也不会重复触发） */
    once: function (evt, fn) {
      function wrapper(p) {
        api.off(evt, wrapper);
        fn(p);
      }
      wrapper._src = fn;
      api.on(evt, wrapper);
      return fn;
    },

    /** 退订；传 fn 时同时匹配 once 产生的包装函数 */
    off: function (evt, fn) {
      var a = map[evt];
      if (!a) return api;
      for (var i = a.length - 1; i >= 0; i--) {
        if (a[i] === fn || a[i]._src === fn) a.splice(i, 1);
      }
      return api;
    },

    /** 清空某事件（不传则清空全部） */
    clear: function (evt?) {
      if (evt) delete map[evt];
      else map = Object.create(null);
      return api;
    },

    listenerCount: function (evt?) {
      if (evt) return (map[evt] || []).length;
      var n = 0;
      for (var k in map) n += map[k].length;
      return n;
    },

    events: function () {
      var out = [];
      for (var k in map) if (map[k].length) out.push(k + '×' + map[k].length);
      return out;
    },

    stats: function () {
      return {
        emits: stats.emits, calls: stats.calls,
        errors: stats.errors, refused: stats.refused,
        lastError: stats.lastError, listeners: api.listenerCount()
      };
    },

    /**
     * 派发。同步、深度优先（处理器内 emit 会立即执行），
     * 但用快照保证"派发期间增删监听器"不影响本次调用。
     */
    emit: function (evt, payload) {
      var a = map[evt];
      if (!a || !a.length) return api;
      if (depth >= BUS_MAX_DEPTH) {
        stats.refused++;
        return api;                     // 拒绝派发：疑似自触发死循环
      }
      stats.emits++;
      var snapshot = a.slice();
      depth++;
      try {
        for (var i = 0; i < snapshot.length; i++) {
          stats.calls++;
          try {
            snapshot[i](payload);
          } catch (e) {
            // 单个处理器出错不能影响模拟，也不能影响其它监听器
            stats.errors++;
            stats.lastError = e;
            if (console && console.error) {
              console.error('[' + api.name + '] "' + evt + '" 处理器抛错：', e);
            }
          }
        }
      } finally {
        depth--;
      }
      return api;
    }
  };
  return api;
};

/* =========================================================
   调色板 —— 美术宪法（低饱和 / 复古清新 / 平涂）
   ========================================================= */
var PAL: Palette = ({} as Palette);
var PAL_COLORS: Record<string, string> = {
  INK: '#100d0c',           // 唯一外轮廓色：纯黑

  // 地面（外星荒漠：红棕 + 土黄）
  G1: '#8e5233', G2: '#a4623a', G3: '#b8763f', G4: '#c98a55',
  G5: '#d9a26a', G6: '#7a4630',
  PEBBLE: '#6d4128', PEBBLE_HI: '#c99a68',
  ROCK: '#5d4a45', ROCK_HI: '#7b6660', ROCK_DARK: '#3f3230',

  // 豆豆本体
  SKIN: '#f2e3bd', SKIN_HI: '#fbf3d8', SKIN_SH: '#d3bd8c', SKIN_DP: '#a98f60',
  BRONANA_DOT: '#8c7040',

  // 通用实体色
  WHITE: '#f6efdd', BONE: '#e2d6b8', GREY: '#9c9384', DARK: '#4a423b',

  // 怪物色（诡异简约）
  E1: '#8f6fae', E1D: '#6b5086',   // 紫
  E2: '#4f9d69', E2D: '#37734c',   // 绿
  E3: '#c05a4a', E3D: '#8f3f33',   // 红
  E4: '#d9a83c', E4D: '#a87d24',   // 黄
  E5: '#5f8fc4', E5D: '#426a97',   // 蓝
  E6: '#c96f9a', E6D: '#9a4e73',   // 粉
  E7: '#7d8a5a', E7D: '#5a6440',   // 橄榄
  E8: '#b0603c', E8D: '#83442a',   // 橙棕

  // 特效 / 道具
  BLOOD: '#7c3b62', MUZZLE: '#ffd97a', SPARK: '#f2e6c8',
  XP: '#6fc07d', MAT: '#7fb2d6', HEAL: '#cf5a6a',
  /* HP / PAPER / CREAM 这三个键以前**不存在**，而 render/emit/sprites 里已经在读它们 ——
     于是那几处 `PAL.X || '#兜底'` 的左边永远是 undefined，`||` 只走右边：
     写起来像在读调色板，其实是一句写死的字面量（与 `S.fmods.bonusTier` 同一类假话）。
     更要紧的是 sprites.ts 里**没有兜底**的那几笔（记录官/契约台/记录墙的纸片）：
     `fill()` 收到 undefined 颜色直接 return，纸片一个像素都没画（不是画错，是没画）。
     三个值都取各自兜底里那个已经定好的色，所以补键**不改变任何已有画面**；
     只有原本没画出来的那几笔纸片，现在按作者写的颜色出现了。 */
  HP: '#cf4a3f', PAPER: '#c98a55', CREAM: '#f2e6c8',
  GOLD: '#e8b23c', STEEL: '#b9bcc2', WOOD: '#a9743f', WOOD_D: '#7d5329',
  MAGIC: '#8f6fae', FIRE: '#e07a3a', ICE: '#7fc4d9', TOXIC: '#8ab84f',
  LASER: '#e2564f', BONE2: '#ded3b6'
};
/* 把颜色铺到 `PAL` 上：`PAL` 是**唯一的调色板对象**（各处读它），
   而 `PAL_COLORS` 是那份字面量 —— 分开是因为 `PAL` 还要挂色弱档那几个方法
   （`mode/setMode/at`），字面量里混方法会让"调色板就是一堆颜色"这件事失真。 */
(function () {
  for (var k in PAL_COLORS) {
    if (Object.prototype.hasOwnProperty.call(PAL_COLORS, k)) PAL[k] = PAL_COLORS[k];
  }
})();

/* =========================================================
   样式注入（按钮 / 卡片外观在 JS 里再兜一层，防止样式被覆盖）
   ========================================================= */
var CSS_TEXT = [
  'button,input{font-family:inherit;}',
  '.screen{backdrop-filter:none;}',
  '.card .cv canvas,.char-card canvas,.wslot canvas{display:block;}',
  '.pin{position:absolute;}',
  '.tier-legend{display:flex;gap:14px;font-size:11px;color:#cbb894;letter-spacing:.1em;}'
].join('\n');

U.injectCSS = function (id, text) {
  if (typeof document === 'undefined') return;
  if (document.getElementById(id)) return;
  var s = document.createElement('style');
  s.id = id; s.textContent = text;
  document.head.appendChild(s);
};
U.injectBaseCSS = function () { U.injectCSS('dsh-base', CSS_TEXT); };

/* =========================================================
   剪贴板（存档搬运用）
   ---------------------------------------------------------
   为什么不用 `navigator.clipboard.writeText`（现代 API）：
     · 它**只在 https 或 localhost** 下可用，而本作要能双击 `index.html` 跑；
     · 它在 Electron 的离屏/无焦点状态下会静默拒绝。
   所以走 `document.execCommand('copy')` 那条老路 + 一个隐藏 textarea，
   失败时返回 false（调用方据此给提示，而不是静默什么也没发生）。
   ⚠ 两边都**不抛**：剪贴板被策略禁用不该让游戏崩。
   ========================================================= */
U.copyText = function (text) {
  if (typeof document === 'undefined') return false;
  try {
    var ta = document.createElement('textarea');
    ta.value = String(text);
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    if (typeof document.execCommand === 'function') ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return !!ok;
  } catch (e) { return false; }
};

/**
 * 读剪贴板（异步）。
 * @param cb (text) => void —— 读不到时给空串
 * 现代 API 读剪贴板要权限，所以它可能弹权限框；读不到就走 `cb('')`，
 * 调用方会报"这不是合法存档"，而不是卡在这里等。
 */
U.readClipboard = function (cb) {
  if (typeof navigator === 'undefined' || !navigator.clipboard || !navigator.clipboard.readText) {
    cb(''); return false;
  }
  try {
    navigator.clipboard.readText().then(function (t) { cb(String(t || '')); },
      function () { cb(''); });
    return true;
  } catch (e) { cb(''); return false; }
};

/* ---------------- 帧率采样（HUD 显示 + 性能排查） ---------------- */
var Perf = {
  fps: 0, ms: 0, acc: 0, frames: 0,
  sample: function (dt) {
    if (!(dt > 0)) return;
    this.acc += dt;
    this.frames++;
    if (this.acc >= 0.25) {          // 每 0.25 秒刷新一次读数
      this.fps = this.frames / this.acc;
      this.ms = (this.acc / this.frames) * 1000;
      this.acc = 0;
      this.frames = 0;
    }
  }
};

/* =========================================================
   色弱 / 高对比：**换调色板，不换玩法**
   ---------------------------------------------------------
   为什么放在 `PAL` 上而不是各处判设置：
   颜色只有一个出处（本文件），于是"色弱档换哪几个色"也是一处声明。
   各处（render / sprites / emit）只管读 `PAL`，不判模式。

   ⚠ 一个**必须知道**的代价：贴图是**按颜色烘焙后缓存的**
   （怪物剪影、拾取物、瓦片、视差层都在 `cache` 里）。改调色板之后
   那份缓存就是旧色的，所以换档时必须**作废缓存**（`R.invalidateBakes()`
   + `S.setScale(S.scale())` 那两下）—— `main.ts` 的 `applyColourblind` 就是这么做的。
   不做这一步的表现是"有些东西换了色、有些没换"，比不换更难查。
   ========================================================= */
var PAL_BASE: Record<string, string> = Object.create(null);
var PAL_MODE = 0;
(function () {
  /* 记下"第 0 档"的原值：换档要能**换回来**，所以不能就地覆盖了事 */
  for (var k in PAL) if (Object.prototype.hasOwnProperty.call(PAL, k)) PAL_BASE[k] = String(PAL[k]);
})();

/**
 * 危险色 / 拾取色 / 治疗色在三档下的取值。
 * 取值的依据是**色觉缺陷的可分辨轴**，不是审美：
 *   · 红绿色盲（protan/deutan）最难分的是红↔绿，最容易分的是**蓝↔黄**
 *   · 所以 1 档把"危险"推到蓝白冷端、"拾取"推到暖黄端
 *   · 2 档在此之上把明度差拉开（给低视力与强光环境）
 */
var PAL_MODES: Record<string, string[]> = {
  HP: ['#cf4a3f', '#4a78d0', '#2f5fd0'],      /* 危险 / 敌人血条 */
  HEAL: ['#cf5a6a', '#d8a03c', '#c8781c'],    /* 治疗 */
  XP: ['#6fc07d', '#7fc4e8', '#3fa8e0'],      /* 经验 */
  MAT: ['#7fb2d6', '#e0c060', '#d8a81c']      /* 材料掉落 */
};

/** 切档（0 = 原色，1 = 红绿友好，2 = 高对比） */
PAL.mode = function () { return PAL_MODE; };
PAL.setMode = function (m) {
  var next = Math.max(0, Math.min(2, Math.floor(Number(m) || 0)));
  if (next === PAL_MODE) return false;
  PAL_MODE = next;
  for (var k in PAL_MODES) {
    if (!Object.prototype.hasOwnProperty.call(PAL_MODES, k)) continue;
    PAL[k] = PAL_MODES[k][next];
  }
  return true;
};
/** 某一档下这个键是什么色（体检工具与测试用，避免它们各写一份表） */
PAL.at = function (key, mode) {
  var m = Math.max(0, Math.min(2, Math.floor(Number(mode) || 0)));
  if (PAL_MODES[key]) return PAL_MODES[key][m];
  return PAL_BASE[key];
};
PAL.KEYS_IN_MODES = Object.keys(PAL_MODES);
PAL.BASE = PAL_BASE;

export { U, PAL, Perf };
