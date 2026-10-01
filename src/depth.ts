/* =========================================================
   depth.ts — Z 深度：层带 + 层内 y 排序 + 确定性 tie-break
   ---------------------------------------------------------
   借鉴的是成熟引擎里那套最通用的做法，而不是发明新东西：
     · **Unity**：`sortingLayer`（具名层）+ `sortingOrder`（层内整数序）
     · **Godot**：节点 `z_index`（稀疏整数） + `y_sort_enabled`（同层按 y 排）
     · **Bevy / 一般 ECS**：`ZIndex(i32)` 组件，同值时按实体 id 保证**确定性**
     · **2D 俯视游戏惯例**：所有"站在地上的东西"同层按 y 排，
       地面/贴花/影子/特效/UI 各自独立成层

   合成到本项目的三件事：

   1. **层带（band）**：稀疏整数（0/100/200…），中间留空位 ——
      新增一层不用重排已有的层号，这是引擎里"层是数据不是代码顺序"的关键。
   2. **层内按 y 排**：同一带里的实体按 y 升序绘制（y 大 = 更靠镜头，画得晚）。
      实现用三元组 `(band, y, id)`，最后再用自增 `seq` 兜底 ——
      排序结果**与入队顺序、与 sort 实现是否稳定都无关**（可复现是硬要求）。
   3. **注册表而不是 switch**：`Depth.actor('enemy', {band, y, id, draw})`，
      新增一类可视实体 = 一次注册，主渲染循环不动（开闭原则）。
      注册项自己给出"用哪个 y、怎么画"，所以 sim 层不需要知道任何渲染概念。

   零分配：`push` 从复用的槽位池里取对象，`flush` 复用同一个 live 数组，
   一帧几百个实体不会产生数组/对象垃圾（渲染预算由 render-check 守着）。
   ========================================================= */

import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';

var Depth = {} as DepthApi;

/* =========================================================
   1. 层带表
   ========================================================= */
/* =========================================================
   1. 层带的声明表
   ---------------------------------------------------------
   ⚠ **层是一等实体，不是"画法的先后"**。每一条层带声明四件事：

     · `name`    名字（写错即抛错 —— 层名错是配置错误，不该静默画错层次）
     · `z`       稀疏整数（0/100/200…），表序 = 叠放顺序
     · `domain`  **变换域**：`world` 吃相机变换 / `screen` 不吃
     · `note`    这一层放什么

   外加两个可选：
     · `baked`       这一层是否烘焙成离屏位图（每帧一次 blit）
     · `ySort`       同层内是否按 y 排（2D 俯视的通行做法）

   ## 为什么 `domain` 必须是**声明**而不是靠代码顺序

   改造前"不随相机"是靠 `render.ts` 的 `screenSetup()` **在画之前重置一次变换**
   实现的 —— 那是一句**调用约定**，不是层自己的属性。后果：
   任何人在那之前插一层绘制，它就会**静默地**吃上相机变换；
   而"哪些层该吃变换"这件事，**在层表里读不出来**。

   调研了六家引擎（Godot `CanvasLayer` 自带 transform / Unity 的
   `Screen Space - Overlay` vs `World Space` / Phaser 的 `scrollFactor`
   / libgdx 的"HUD 用另一个 Viewport"），**通行模型**是：

       Window ⊃ Viewport ⊃ Layer ⊃ Item
       相机**属于 Viewport**并修改 Viewport 的 canvas 变换 —— **相机不是层**

   所以变换域是**层的属性**（层绑定到哪个域），而相机是域的变换来源。
   启动期自检会强制"屏幕域恰好一层、且必须是最高层"（见第 6 节）。
   ========================================================= */
var LAYERS: DepthLayerDef[] = [
  { name: 'ground', z: 0, domain: 'world', baked: true, note: '地面与静态装饰（烘焙成一张图，每帧一次 blit）' },
  { name: 'decal', z: 100, domain: 'world', note: '血迹贴花：在地面之上、一切实体之下' },
  { name: 'prop', z: 200, domain: 'world', note: '岩石与白骨（与地面分成两层，保持"地面→贴花→岩石"的叠放顺序）' },
  { name: 'bounds', z: 300, domain: 'world', note: '战场围墙' },
  { name: 'shadow', z: 400, domain: 'world', note: '影子：单独一遍。这样 A 的影子不会压在后画的 B 身上' },
  { name: 'marker', z: 450, domain: 'world', note: '地面标记（拾取范围圈）：属于地面语义，压在实体之下' },
  { name: 'actor', z: 500, domain: 'world', ySort: true, note: '站在地上的实体：拾取物 / 炮塔 / 怪 / 玩家，**同带内按 y 排**' },
  { name: 'air', z: 600, domain: 'world', note: '（预留）悬浮实体：飞行怪、升空的弹道' },
  { name: 'projectile', z: 700, domain: 'world', note: '子弹与敌弹：压在实体之上，保证弹幕可读' },
  { name: 'fx', z: 800, domain: 'world', note: '命中粒子' },
  { name: 'swing', z: 850, domain: 'world', note: '挥击弧与冲击环：压在实体与粒子之上' },
  { name: 'text', z: 900, domain: 'world', note: '伤害飘字：最上层的世界内内容' },
  { name: 'screen', z: 1000, domain: 'screen', note: '屏幕层：不随摄像机（危险边框 / 横幅 / 调试叠层）' }
];
var BANDS: Record<string, number> = Object.create(null);
var BAND_NOTE: Record<string, string> = Object.create(null);
var BAND_DOMAIN: Record<string, string> = Object.create(null);
/* z → 名字（`flush` 的账目、`describe`、调试叠层都读它） */
var BAND_LIST_NAME: Record<number, string> = Object.create(null);
for (var bi = 0; bi < LAYERS.length; bi++) {
  BANDS[LAYERS[bi].name] = LAYERS[bi].z;
  BAND_NOTE[LAYERS[bi].name] = LAYERS[bi].note;
  BAND_DOMAIN[LAYERS[bi].name] = LAYERS[bi].domain;
  BAND_LIST_NAME[LAYERS[bi].z] = LAYERS[bi].name;
}
/** 兼容旧名：`BAND_LIST` 是本表的历史叫法（元组时代的名字），只给家族与自检用 */
var BAND_LIST = LAYERS;

/** 具名层带。名字写错直接抛错（引擎里层名错是配置错误，不该静默画错层次） */
Depth.band = function (name) {
  var z = BANDS[name];
  if (z === undefined) throw new Error('depth: 未知层带 ' + name);
  return z;
};
Depth.bandNames = function () { return LAYERS.map(function (b) { return b.name; }); };
Depth.bandNote = function (name) { return BAND_NOTE[name] || ''; };
/** 层带表（调试叠层、`describe`、逐项对照用）—— 含**变换域**与两个可选属性 */
Depth.bandTable = function () {
  return LAYERS.map(function (b) {
    return {
      name: b.name, z: b.z, domain: b.domain, note: b.note,
      ySort: !!b.ySort, baked: !!b.baked
    };
  });
};
/** 这一层的**变换域**：`world` 吃相机变换，`screen` 不吃 */
Depth.bandDomain = function (name) {
  var d = BAND_DOMAIN[name] as DepthLayerDomain | undefined;
  if (d === undefined) throw new Error('depth: 未知层带 ' + name);
  return d;
};
/** 某个变换域里的层（按叠放顺序）—— 渲染层据此"每个域只设一次变换" */
Depth.bandsOfDomain = function (domain) {
  return LAYERS.filter(function (b) { return b.domain === domain; }).map(function (b) { return b.name; });
};
/** 某个变换域的**最靠下**的层名（渲染层在这里设一次变换，之后整域不必再设） */
Depth.firstBandOfDomain = function (domain) {
  for (var i = 0; i < LAYERS.length; i++) if (LAYERS[i].domain === domain) return LAYERS[i].name;
  return null;
};

/* =========================================================
   2. 实体注册表
   ========================================================= */
var ACTORS: Record<string, DepthActor> = Object.create(null);
var ACTOR_NAMES: string[] = [];
/** 整层开关的运行时状态（只记"被显式改过"的层，见第 4b 节） */
var LAYER_STATE: Record<string, { visible: boolean; alpha: number }> = Object.create(null);
/** 因整层开关而被跳过的实体数（本帧） */
var skipped = 0;

/**
 * 注册一类可视实体。
 * @param band 层带名（同带内按 y 排）
 * @param y    取 y 的函数（渲染层传插值后的 y，这样排序与画面一致）
 * @param id   取 id 的函数（同 y 时的次序依据；缺省 0）
 * @param seq  取"次级次序"的函数（缺省 0）—— 再同值就落到入队序号
 * @param cull 视口剔除余量：数字或 (ref) => number（缺省 0）
 * @param draw (ctx, ref, env) => void
 *
 * 剔除余量放在这里而不是调用方：入队与剔除是同一件事（"这一类实体算不算在场"）。
 * 分开写就会变成渲染循环里散着 16 / 34 / r*3 这些魔法数字 —— 那正是"零件"而非"系统"。
 */
Depth.actor = function (name, def) {
  if (ACTORS[name]) throw new Error('depth: 实体类型重名 ' + name);
  if (!def || typeof def.draw !== 'function') throw new Error('depth: 实体 ' + name + ' 缺少 draw');
  if (typeof def.y !== 'function') throw new Error('depth: 实体 ' + name + ' 缺少 y()');
  Depth.band(def.band);                       // 层名必须在表里
  ACTORS[name] = {
    name: name, band: def.band, z: BANDS[def.band],
    y: def.y, id: def.id || function () { return 0; },
    seq: def.seq || function () { return 0; },
    cull: def.cull === undefined ? 0 : def.cull,
    draw: def.draw
  };
  ACTOR_NAMES.push(name);
  return ACTORS[name];
};
Depth.hasActor = function (name) { return !!ACTORS[name]; };
Depth.actors = function () { return ACTOR_NAMES.slice(); };
/** 该类实体的视口剔除余量（数字或函数，统一在这里取值） */
Depth.cullRadius = function (name, ref) {
  var a = ACTORS[name];
  if (!a) throw new Error('depth: 未注册的实体类型 ' + name);
  return typeof a.cull === 'function' ? a.cull(ref) : a.cull;
};
Depth.actorInfo = function (name) {
  var a = ACTORS[name];
  return a ? { name: a.name, band: a.band, z: a.z } : null;
};

/* =========================================================
   3. 排序：三元组 + 序号兜底
   ========================================================= */
/** 层带 → y → id → 入队序号。全部相等时**不能**依赖 sort 的稳定性，所以有 seq */
Depth.compare = function (a, b) {
  return (a.z - b.z) || (a.y - b.y) || (a.id - b.id) || (a.seq - b.seq);
};

/* =========================================================
   4. 一帧的队列（零分配）
   ========================================================= */
var pool: DepthSlot[] = [];
var live: DepthSlot[] = [];
var used = 0;
var frameSeq = 0;
var counts: Record<string, number> = Object.create(null);
var bandCounts: Record<string, number> = Object.create(null);
var pushes = 0;
var TRACE: ((name: string, ref: any, order: number) => void) | null = null;

/** 开始一帧 */
Depth.reset = function () {
  used = 0; frameSeq = 0; pushes = 0; skipped = 0;
  for (var k in counts) counts[k] = 0;
  for (var b in bandCounts) bandCounts[b] = 0;
};

/** 入队一个实体（按注册表读层带与 y） */
Depth.push = function (name, ref) {
  var a = ACTORS[name];
  if (!a) throw new Error('depth: 未注册的实体类型 ' + name);
  var s = pool[used];
  if (!s) { s = pool[used] = { z: 0, y: 0, id: 0, seq: 0, kind: name, ref: null }; }
  s.z = a.z;
  s.y = a.y(ref);
  s.id = a.id(ref);
  s.seq = frameSeq++;
  s.kind = name;
  s.ref = ref;
  live[used] = s;
  used++;
  pushes++;
};

/** 当前队列长度（调试 / 测试用） */
Depth.count = function () { return used; };

/**
 * 排序并依次绘制。
 * @param trace 可选：每次绘制回调 `(name, ref, order)`，调试叠层与测试用
 *
 * 两件在"层"语义下必须在这里做、而不能交给调用方的事：
 *
 *   1. **整层开关**（`visible` / `alpha`）—— 判据在**层**上，不在每个实体上。
 *      隐藏的层直接跳过（连遍历都不做）；`alpha` 非 1 的层包一次
 *      `save / globalAlpha *= / restore`。代价只在真的用到时才付。
 *   2. **隐藏不传播**：把它声明清楚 —— 隐藏 A 层**只**影响 A，
 *      不会连带隐藏别的层（Godot 的 `CanvasLayer.visible` 也是这个语义：
 *      "只隐藏本层，不向下传播"）。反过来做（传播到子层）会让"临时关一层"
 *      变成"关一片"，那是排查层次问题时最难查的一种。
 */
Depth.flush = function (ctx, env) {
  live.length = used;
  live.sort(Depth.compare);
  for (var i = 0; i < used; i++) {
    var s = live[i];
    counts[s.kind] = (counts[s.kind] || 0) + 1;
    var bn = BAND_LIST_NAME[s.z] || '?';
    bandCounts[bn] = (bandCounts[bn] || 0) + 1;
    var st = LAYER_STATE[bn];
    if (st) {
      if (!st.visible) { skipped++; continue; }
      if (st.alpha !== 1) {
        ctx.save();
        ctx.globalAlpha = ctx.globalAlpha * st.alpha;
        ACTORS[s.kind].draw(ctx, s.ref, env);
        ctx.restore();
        if (TRACE) TRACE(s.kind, s.ref, i);
        continue;
      }
    }
    ACTORS[s.kind].draw(ctx, s.ref, env);
    if (TRACE) TRACE(s.kind, s.ref, i);
  }
};

/* =========================================================
   4b. 层的运行时状态（整层开关）
   ---------------------------------------------------------
   只有**被显式设置过**的层才在这里留下一行 —— 表里的默认值是
   `visible = true` / `alpha = 1`，不预先物化每一层（省分配，
   也让 `layerState()` 能回答"这一层被改过吗"）。
   ========================================================= */
Depth.setLayerVisible = function (name, on) {
  Depth.band(name);                                   // 层名错即抛错
  (LAYER_STATE[name] || (LAYER_STATE[name] = { visible: true, alpha: 1 })).visible = !!on;
  return Depth.layerState(name);
};
Depth.setLayerAlpha = function (name, a) {
  Depth.band(name);
  var v = a < 0 ? 0 : (a > 1 ? 1 : a);
  (LAYER_STATE[name] || (LAYER_STATE[name] = { visible: true, alpha: 1 })).alpha = v;
  return Depth.layerState(name);
};
/** 这一层的当前状态（没被设置过就是表的默认值） */
Depth.layerState = function (name) {
  Depth.band(name);
  var st = LAYER_STATE[name];
  return { visible: st ? st.visible : true, alpha: st ? st.alpha : 1, overridden: !!st };
};
/** 清掉所有整层覆盖（回到表的默认值）—— 换场景 / 关调试叠层时用 */
Depth.resetLayers = function () {
  for (var k in LAYER_STATE) if (Object.prototype.hasOwnProperty.call(LAYER_STATE, k)) delete LAYER_STATE[k];
  skipped = 0;
};
/** 被整层开关跳过的实体数（`stats` 报它 —— 否则"画面上少东西"没有读数可查） */
Depth.skipped = function () { return skipped; };

/** 调试钩子：设为函数后每次绘制都会回调（传 null 关闭） */
Depth.trace = function (fn) { TRACE = typeof fn === 'function' ? fn : null; return !!TRACE; };

/* =========================================================
   5. 账目与调试描述
   ========================================================= */
Depth.stats = function () {
  var ac: Record<string, number> = {};
  for (var k in counts) if (counts[k]) ac[k] = counts[k];
  var bc: Record<string, number> = {};
  for (var b in bandCounts) if (bandCounts[b]) bc[b] = bandCounts[b];
  return { pushed: pushes, actors: ac, bands: bc, slots: pool.length, live: used, skipped: skipped };
};

/** 人类可读的一帧深度报告（?z=1 叠层 / 测试失败信息都用它） */
Depth.describe = function () {
  var st = Depth.stats();
  var lines = ['深度队列 ' + st.pushed + ' 个实体（槽位池 ' + st.slots + '，复用 ' +
    (st.slots ? (st.slots - st.live) : 0) + ' 个空闲）'];
  var rows = Depth.bandTable();
  var domain = '';
  for (var i = 0; i < rows.length; i++) {
    /* 变换域换了就打一条分隔 —— 它回答"从哪一层起不再吃相机变换" */
    if (rows[i].domain !== domain) {
      domain = rows[i].domain;
      lines.push('  ── ' + domain + ' 域' + (domain === 'screen' ? '（不随相机）' : '（吃相机变换）') + ' ──');
    }
    var n = st.bands[rows[i].name] || 0;
    if (!n) continue;
    var stt = Depth.layerState(rows[i].name);
    var flags = (stt.visible ? '' : ' [隐藏]') + (stt.alpha !== 1 ? ' [alpha ' + stt.alpha + ']' : '');
    lines.push('  z=' + String(rows[i].z).padStart(4) + '  ' + rows[i].name.padEnd(11) +
      ' ×' + String(n).padEnd(4) + flags + '  ' + rows[i].note);
  }
  if (st.skipped) lines.push('  （整层开关跳过了 ' + st.skipped + ' 个实体）');
  return lines.join('\n');
};

/* =========================================================
   6. 定义期自检（`depthBand` / `actor` 两个家族的守卫）
   ---------------------------------------------------------
   判据原先只散在 `test/depth.mjs` 里（层号递增 / 名字不重复 / 有说明）。
   搬进来的意义不是"再检查一遍"，而是**换到必经之路上**：
   启动期（main.ts / cli.ts 的 SelfCheck.run）就会跑，不过就抛，一次列全。

   每条判据都对着一个真实的静默故障：
     · 层带**重名** → `BANDS[name]` 被后一条覆盖：前一条的层号静默丢失，
       用它注册的实体从此画在另一个层上（不报错，只是层次看起来"有点怪"）
     · 层号**重复** → `BAND_LIST_NAME`（z → 名字）被后写覆盖：
       `describe()` 与调试叠层会把两条带报成同一条，`stats().bands` 也记到错的带名下
     · 层带表**不按层号递增** → 表序就是"叠放顺序"的声明（describe / 调试叠层按表序打印），
       乱序时那份报告与实际绘制顺序不符 —— 而它是排查层次问题时唯一的读数
     · 派生表（`BANDS` / `BAND_LIST_NAME`）与源表**脱节** → `Depth.band(name)` 抛错、
       或 z 映射到 '?'，两者都表现为"某个层不见了"
     · 实体的层带**不在表里** → `a.z` 是 undefined → `compare()` 返回 NaN →
       `sort` 的比较函数返回 NaN 时顺序**未定义**：整帧的层次静默乱掉
     · 实体**缓存的 z 与层带表不一致**（`Depth.actor` 注册时把 z 抄了一份）→
       改了层带号却没重新注册实体，它会永远画在旧层上

   ⚠ 这一份**没有**"某个层带有没有人用 / 某个键有没有人读"这类判据：
   那要扫源码，是检查期（test/depth.mjs）的活，启动期跑在浏览器里，没有 fs。
   ========================================================= */
Depth.audit = function () {
  var problems: string[] = [];
  var seenName: Record<string, boolean> = Object.create(null);
  var seenZ: Record<string, boolean> = Object.create(null);
  var prevZ = -Infinity;
  var i, name, z;
  var screenCount = 0, lastDomain = '';
  for (i = 0; i < LAYERS.length; i++) {
    var row = LAYERS[i];
    name = row.name; z = row.z;
    if (!name) problems.push('第 ' + i + ' 条层带没有名字');
    else if (seenName[name]) {
      problems.push('层带重名：' + name + '（BANDS 会被后一条覆盖，前一条的层号静默丢失）');
    } else seenName[name] = true;
    if (seenZ[String(z)]) {
      problems.push('层号重复：' + z + '（z→名字的映射会被后一条覆盖，describe() 会把两条带报成同一条）');
    }
    seenZ[String(z)] = true;
    if (!(z > prevZ)) {
      problems.push('层带表没有按层号递增：' + name + ' 的 z=' + z +
        '（表序就是叠放顺序，describe() 按表序打印，乱序时它报的层次与真实绘制不符）');
    }
    prevZ = z;
    /* 派生表必须与源表逐条对得上：拆成两处维护（或加带时只加了一边）时，
       表现是"某个层不见了"，而不是一条能读懂的错。 */
    if (BANDS[name] !== z) {
      problems.push('派生表 BANDS 与层带表不一致：' + name + ' 表里是 ' + z + '，BANDS 里是 ' + BANDS[name]);
    }
    if (BAND_LIST_NAME[z] !== name) {
      problems.push('z→名字的映射与层带表不一致：z=' + z + ' 映射到 ' + BAND_LIST_NAME[z] + '，表里是 ' + name);
    }
    /* ---- 变换域（本轮新增的判据，三条各对着一个真实的静默故障）---- */
    if (row.domain !== 'world' && row.domain !== 'screen') {
      problems.push('层带 ' + name + ' 的变换域不合法：' + row.domain +
        '（只允许 world / screen。域写错的后果是"这一层吃不吃相机变换"变成未定义）');
    }
    if (row.domain === 'screen') screenCount++;
    /* ⚠ 域必须**成块**出现，不能交错：渲染层是"每个域设一次变换，然后连着画完这个域"，
       交错时第二个 world 层会带着 screen 域的变换画 —— 表现是"某些东西的位置偏了"，
       而层表看起来完全正常。 */
    if (lastDomain && row.domain !== lastDomain && row.domain === 'world') {
      problems.push('变换域交错：' + name + ' 是 world，但它前面已经是 ' + lastDomain +
        '（渲染层每个域只设一次变换，交错会让它带着上一个域的变换画）');
    }
    lastDomain = row.domain;
  }
  /* 屏幕域恰好一层，且必须是**最高**层。
     两层屏幕域没有意义（它们是同一个变换，区别只是谁先画）；不在最高层则
     在它之后画的 world 层会被当成屏幕内容 —— 而"UI 之上还有世界"是错的。 */
  if (screenCount === 0) {
    problems.push('没有 screen 域的层：横幅 / 危险边框 / 调试叠层无处可放，只能塞进 world 域跟着相机跑');
  } else if (screenCount > 1) {
    problems.push('screen 域有 ' + screenCount + ' 层：它们变换相同，叠放顺序没有意义；' +
      '同一域内要分层请用 world 域里的层号');
  } else if (LAYERS.length && LAYERS[LAYERS.length - 1].domain !== 'screen') {
    problems.push('screen 域不在最高层（最高层是 ' + LAYERS[LAYERS.length - 1].name +
      '）：在它之后画的 world 层会被当成屏幕内容，而"UI 之上还有世界"是错的');
  }
  /* 已注册实体的域必须与层表一致 —— `Depth.actor` 注册时把 z 抄了一份，
     所以域也在这里核（改域却没重新注册 = 实体永远画在旧域） */
  for (name in BANDS) {
    if (Object.prototype.hasOwnProperty.call(BANDS, name) && !seenName[name]) {
      problems.push('BANDS 里有层带表没有的层：' + name + '（它是死配置，永远取不到）');
    }
  }
  /* 每条已注册的可视实体：层带在场，且缓存的 z 与当前表一致。
     实体由渲染层在 depth.ts 之后注册，所以这一半在**启动期**才真的查得到东西。 */
  for (i = 0; i < ACTOR_NAMES.length; i++) {
    var a = ACTORS[ACTOR_NAMES[i]];
    if (!a) { problems.push('实体 ' + ACTOR_NAMES[i] + ' 没有记录（名字表与注册表脱节）'); continue; }
    if (BANDS[a.band] === undefined) {
      problems.push('实体 ' + a.name + ' 的层带不在表里：' + a.band +
        '（它的 z 是 undefined，compare() 返回 NaN，整帧的层次顺序未定义）');
      continue;
    }
    if (a.z !== BANDS[a.band]) {
      problems.push('实体 ' + a.name + ' 缓存的 z=' + a.z + ' 与层带表的 ' + a.band + '=' + BANDS[a.band] +
        ' 不一致（改了层带号却没重新注册实体：它会永远画在旧层）');
    }
  }
  return { ok: problems.length === 0, problems: problems };
};

/* 注册到扩展点总账：层带是家族；可视实体引用层带（render.ts 注册实体时用） */
Registry.family('depthBand', {
  note: 'Z 深度层带（名字 + 层号 + **变换域** world/screen + 可选 ySort/baked）', owner: 'depth.ts',
  values: function () { return LAYERS.map(function (b) { return b.name; }); }
});
Registry.family('depthDomain', {
  note: '变换域：world 吃相机变换 / screen 不吃（行业通行模型 Window ⊃ Viewport ⊃ Layer ⊃ Item）',
  owner: 'depth.ts',
  values: function () { return ['world', 'screen']; }
});
Registry.family('actor', {
  note: '可视实体类型（层带 + 取 y + 画法）', owner: 'depth.ts',
  entries: function () {
    return ACTOR_NAMES.map(function (n) {
      return { id: n, refs: [{ field: 'band', value: ACTORS[n].band, family: 'depthBand' }] };
    });
  }
});

/* 定义期自检：不过就抛。加载期这一遍只查得到层带表（实体由渲染层稍后注册），
   启动期那一遍（SelfCheck.register）两半都查。 */
var depthVerdict = Depth.audit();
if (!depthVerdict.ok) {
  throw new Error('depth.ts 深度层带 / 实体表自检失败：\n' + depthVerdict.problems.join('\n'));
}
SelfCheck.register('Depth', Depth.audit);

export { Depth };
