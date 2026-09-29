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
var BAND_LIST: [string, number, string][] = [
  ['ground', 0, '地面与静态装饰（烘焙成一张图，每帧一次 blit）'],
  ['decal', 100, '血迹贴花：在地面之上、一切实体之下'],
  ['prop', 200, '岩石与白骨（与地面分成两层，保持"地面→贴花→岩石"的叠放顺序）'],
  ['bounds', 300, '战场围墙'],
  ['shadow', 400, '影子：单独一遍。这样 A 的影子不会压在后画的 B 身上'],
  ['marker', 450, '地面标记（拾取范围圈）：属于地面语义，压在实体之下'],
  ['actor', 500, '站在地上的实体：拾取物 / 炮塔 / 怪 / 玩家，**同带内按 y 排**'],
  ['air', 600, '（预留）悬浮实体：飞行怪、升空的弹道'],
  ['projectile', 700, '子弹与敌弹：压在实体之上，保证弹幕可读'],
  ['fx', 800, '命中粒子'],
  ['swing', 850, '挥击弧与冲击环：压在实体与粒子之上'],
  ['text', 900, '伤害飘字：最上层的世界内内容'],
  ['screen', 1000, '屏幕层：不随摄像机（危险边框 / 横幅 / 调试叠层）']
];
var BANDS: Record<string, number> = Object.create(null);
var BAND_NOTE: Record<string, string> = Object.create(null);
for (var bi = 0; bi < BAND_LIST.length; bi++) {
  BANDS[BAND_LIST[bi][0]] = BAND_LIST[bi][1];
  BAND_NOTE[BAND_LIST[bi][0]] = BAND_LIST[bi][2];
}

/** 具名层带。名字写错直接抛错（引擎里层名错是配置错误，不该静默画错层次） */
Depth.band = function (name) {
  var z = BANDS[name];
  if (z === undefined) throw new Error('depth: 未知层带 ' + name);
  return z;
};
Depth.bandNames = function () { return BAND_LIST.map(function (b) { return b[0]; }); };
Depth.bandNote = function (name) { return BAND_NOTE[name] || ''; };
/** 层带表（调试叠层用） */
Depth.bandTable = function () {
  return BAND_LIST.map(function (b) { return { name: b[0], z: b[1], note: b[2] }; });
};

/* =========================================================
   2. 实体注册表
   ========================================================= */
var ACTORS: Record<string, DepthActor> = Object.create(null);
var ACTOR_NAMES: string[] = [];

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
  used = 0; frameSeq = 0; pushes = 0;
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
 */
Depth.flush = function (ctx, env) {
  live.length = used;
  live.sort(Depth.compare);
  for (var i = 0; i < used; i++) {
    var s = live[i];
    counts[s.kind] = (counts[s.kind] || 0) + 1;
    var bn = BAND_LIST_NAME[s.z] || '?';
    bandCounts[bn] = (bandCounts[bn] || 0) + 1;
    ACTORS[s.kind].draw(ctx, s.ref, env);
    if (TRACE) TRACE(s.kind, s.ref, i);
  }
};
var BAND_LIST_NAME: Record<number, string> = {};
for (var bj = 0; bj < BAND_LIST.length; bj++) BAND_LIST_NAME[BAND_LIST[bj][1]] = BAND_LIST[bj][0];

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
  return { pushed: pushes, actors: ac, bands: bc, slots: pool.length, live: used };
};

/** 人类可读的一帧深度报告（?z=1 叠层 / 测试失败信息都用它） */
Depth.describe = function () {
  var st = Depth.stats();
  var lines = ['深度队列 ' + st.pushed + ' 个实体（槽位池 ' + st.slots + '，复用 ' +
    (st.slots ? (st.slots - st.live) : 0) + ' 个空闲）'];
  var rows = Depth.bandTable();
  for (var i = 0; i < rows.length; i++) {
    var n = st.bands[rows[i].name] || 0;
    if (!n) continue;
    lines.push('  z=' + String(rows[i].z).padStart(4) + '  ' + rows[i].name.padEnd(11) +
      ' ×' + n + '   ' + rows[i].note);
  }
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
  for (i = 0; i < BAND_LIST.length; i++) {
    var row = BAND_LIST[i];
    name = row[0]; z = row[1];
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
  }
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
  note: 'Z 深度层带', owner: 'depth.ts',
  values: function () { return BAND_LIST.map(function (b) { return b[0]; }); }
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
