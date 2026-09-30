/* =========================================================
   containers.ts — 容器与对象管理（每个容器在一处声明，统一的回收/上限/账目）
   ---------------------------------------------------------
   体检结论：这块以前**不是系统，是零件** ——
     · 怪的回收是"就地交换删除"（cleanup()），而子弹 / 敌弹 / 掉落物 / 炮塔
       每步都 `var out = []; … out.push(x); S.bullets = out;` ——
       新建数组 + 全量拷贝，**即使这一帧一个对象都没死**；
     · 上限散在三处：`Game.cfg.enemyCap`、`Emit.VIS_CAP/TEXT_CAP`、`Game.cfg.decalCap`；
       子弹 / 敌弹 / 掉落物 / 炮塔**根本没有上限**；
     · 没有一处能回答"这个容器装什么、最多装多少、满了怎么办、怎么回收、现在多大"。

   现在每个容器声明一次（在拥有它的模块里自注册），机制只有一份：
     · `policy`  回收方式：swap（就地交换删除）/ ring（环形缓冲，永不删除）
     · `dead`    怎么算"该回收"（缺省 = 对象的 dead 字段）
     · `onFull`  满了怎么办：reject / drop-oldest / reclaim-farthest / never
     · `cap`     上限（`Infinity` 必须显式写出来，表示"想清楚了）
   之后：回收走 `Containers.reap()`，入队走 `Containers.add()`，
   账目与不变量走 `Containers.stats()` / `Containers.check()`。

   零分配：`reap` 就地倒序交换删除（不新建数组、不拷贝），`add` 只碰得上限时才处理。
   ========================================================= */

import { Registry } from './registry.ts';

var Containers = {} as ContainersApi;

var DEFS: Record<string, ContainerDef> = Object.create(null);
var NAMES: string[] = [];

/**
 * 声明一个容器。
 * @param list   会话上的字段名（也是 Comp.archetype 的 opts.list）
 * @param note   这个容器装什么
 * @param cap    上限
 * @param policy 'swap' 就地交换删除 | 'ring' 环形缓冲（写满覆盖最旧）
 * @param onFull 'reject' 拒绝新建 | 'drop-oldest' 丢最旧的 | 'reclaim-farthest' 回收最远的 | 'never' 不设上限
 * @param dead   该回收的判据（缺省 ref.dead === true）
 * @param keep   回收时"免死"的判据（reclaim-farthest 用：Boss 不回收）
 */
Containers.declare = function (name, def) {
  if (DEFS[name]) throw new Error('containers: 容器重名 ' + name);
  if (!def || !def.list || !def.note) throw new Error('containers: 容器 ' + name + ' 缺少 list / note');
  if (def.cap === undefined) throw new Error('containers: 容器 ' + name + ' 必须显式声明 cap（不设上限就写 Infinity）');
  if (def.cap !== Infinity && !(def.cap > 0)) throw new Error('containers: 容器 ' + name + ' 的 cap 非法');
  var policy = def.policy || 'swap';
  if (policy !== 'swap' && policy !== 'ring' && policy !== 'external') {
    throw new Error('containers: 容器 ' + name + ' 的 policy 只能 swap / ring / external');
  }
  var onFull = def.onFull || 'reject';
  if (['reject', 'drop-oldest', 'reclaim-farthest', 'never'].indexOf(onFull) < 0) {
    throw new Error('containers: 容器 ' + name + ' 的 onFull 非法：' + onFull);
  }
  if (policy === 'ring' && onFull !== 'never') {
    throw new Error('containers: 环形缓冲 ' + name + ' 的 onFull 必须是 never（写满即覆盖）');
  }
  DEFS[name] = {
    name: name, list: def.list, note: def.note, cap: def.cap, policy: policy, onFull: onFull,
    dead: def.dead || function (ref) { return !!ref.dead; },
    keep: def.keep || null
  };
  NAMES.push(name);
  return DEFS[name];
};

Containers.has = function (name) { return !!DEFS[name]; };
Containers.names = function () { return NAMES.slice(); };
Containers.def = function (name) { return DEFS[name] || null; };
Containers.table = function () {
  return NAMES.map(function (n) {
    var d = DEFS[n];
    return { name: n, list: d.list, note: d.note, cap: d.cap, policy: d.policy, onFull: d.onFull };
  });
};

/** 取容器本体（会话上的数组）。list 支持点号路径（如 `player.weapons`） */
Containers.of = function (sess, name) {
  var d = DEFS[name];
  if (!d) throw new Error('containers: 未声明的容器 ' + name);
  if (d.list.indexOf('.') < 0) return sess[d.list];
  var parts = d.list.split('.');
  var cur = sess;
  for (var i = 0; i < parts.length; i++) {
    if (!cur) throw new Error('containers: 容器 ' + name + ' 的路径不存在：' + d.list);
    cur = cur[parts[i]];
  }
  return cur;
};

/* =========================================================
   入队：唯一的上限执行点
   ========================================================= */
/**
 * 往容器里放一个对象。
 * @returns 放进去的对象；被上限拒绝时返回 null（调用方自己决定要不要销毁它）
 */
Containers.add = function (sess, name, obj) {
  var d = DEFS[name];
  if (!d) throw new Error('containers: 未声明的容器 ' + name);
  var list = Containers.of(sess, name);
  if (d.policy === 'ring') {
    throw new Error('containers: 环形缓冲 ' + name + ' 请用 Containers.slot()（它要自己写槽位）');
  }
  if (list.length < d.cap) { list.push(obj); return obj; }
  if (d.onFull === 'never' || d.cap === Infinity) { list.push(obj); return obj; }

  if (d.onFull === 'drop-oldest') {
    var oldest = list.shift();
    list.push(obj);
    return { dropped: oldest, added: obj };
  }
  if (d.onFull === 'reclaim-farthest') {
    // 回收"离玩家最远且允许回收"的那一个；一个都不能回收就拒绝
    var worst = -1, worstD = -1;
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (d.keep && d.keep(it)) continue;
      var dd = (it.x - sess.player.x) * (it.x - sess.player.x) + (it.y - sess.player.y) * (it.y - sess.player.y);
      if (dd > worstD) { worstD = dd; worst = i; }
    }
    if (worst < 0) return null;
    var reaped = list[worst];
    list[worst] = list[list.length - 1];
    list.pop();
    list.push(obj);
    return { reaped: reaped, added: obj };
  }
  return null;   // reject
};

/** 环形缓冲的槽位：第 n 次写入落在 n % cap，返回该槽位（写满即覆盖最旧） */
Containers.slot = function (sess, name, seq) {
  var d = DEFS[name];
  if (!d) throw new Error('containers: 未声明的容器 ' + name);
  if (d.policy !== 'ring') throw new Error('containers: ' + name + ' 不是环形缓冲');
  var list = Containers.of(sess, name);
  var idx = (seq - 1) % d.cap;
  if (idx < 0) idx += d.cap;
  return { index: idx, list: list, cap: d.cap };
};

/* =========================================================
   回收：就地交换删除（零分配）
   ========================================================= */
/**
 * 回收一个容器里"该死"的对象。
 * 倒序遍历是交换删除的前提（正序会把被搬到空位的元素跳过）。
 * @returns 回收掉的个数
 */
Containers.reap = function (sess, name) {
  var d = DEFS[name];
  if (!d) throw new Error('containers: 未声明的容器 ' + name);
  if (d.policy !== 'swap') return 0;          // 环形缓冲靠覆盖、池化容器由属主回收
  var list = Containers.of(sess, name);
  var n = 0;
  for (var i = list.length - 1; i >= 0; i--) {
    if (!d.dead(list[i])) continue;
    list[i] = list[list.length - 1];
    list.pop();
    n++;
  }
  return n;
};

/**
 * 事后兜底：超过上限就按 onFull 策略裁掉多余的。
 * 为什么需要它：创建点往往是 `S.bullets.push(Comp.spawn(…))` 这种一行写法，
 * 但"上限"必须在**一处**执行 —— 于是回收阶段统一裁剪：
 *   · drop-oldest：丢掉**最旧**的一批（子弹/敌弹/掉落物，顺序无语义）
 *   · reject：丢掉**最新**的一批（本该在创建时就被拒绝）
 * ring / external 不动（覆盖式与属主自管）。
 */
Containers.enforce = function (sess, name) {
  var d = DEFS[name];
  if (!d) throw new Error('containers: 未声明的容器 ' + name);
  if (d.policy !== 'swap' || d.cap === Infinity) return 0;
  var list = Containers.of(sess, name);
  var over = list.length - d.cap;
  if (over <= 0) return 0;
  if (d.onFull === 'drop-oldest') list.splice(0, over);
  else list.length = d.cap;                   // reject / 其它：裁掉最新多出来的
  return over;
};

/** 兜底全部容器 */
Containers.enforceAll = function (sess) {
  var n = 0;
  for (var i = 0; i < NAMES.length; i++) n += Containers.enforce(sess, NAMES[i]);
  return n;
};

/** 回收全部容器 */
Containers.reapAll = function (sess) {
  var n = 0;
  for (var i = 0; i < NAMES.length; i++) n += Containers.reap(sess, NAMES[i]);
  return n;
};

/** 清空（换波 / 换局用） */
Containers.clear = function (sess, name) {
  var d = DEFS[name];
  if (!d) throw new Error('containers: 未声明的容器 ' + name);
  Containers.of(sess, name).length = 0;
  return 0;
};

/* =========================================================
   账目与不变量
   ========================================================= */
Containers.stats = function (sess) {
  var out: Record<string, ContainerStat> = {};
  for (var k = 0; k < NAMES.length; k++) {
    var name = NAMES[k];
    var dd = DEFS[name];
    var list = Containers.of(sess, name);
    var dead = 0;
    for (var j = 0; j < list.length; j++) if (dd.dead(list[j])) dead++;
    out[name] = {
      len: list.length, cap: dd.cap, dead: dead,
      use: dd.cap === Infinity ? 0 : list.length / dd.cap,
      policy: dd.policy, onFull: dd.onFull
    };
  }
  return out;
};

/**
 * 不变量检查（测试与调试叠层用）：
 *   1) 不该有"该死却还留着"的对象（回收被漏掉）
 *   2) 不能超过声明的上限（上限被绕过）
 *   3) 同一对象不能在一个容器里出现两次（交换删除写错就会出现）
 */
Containers.check = function (sess) {
  var problems: string[] = [];
  for (var k = 0; k < NAMES.length; k++) {
    var name = NAMES[k];
    var d = DEFS[name];
    var list = Containers.of(sess, name);
    if (list.length > d.cap) problems.push(name + ' 超过上限 ' + list.length + ' > ' + d.cap);
    var seen: any[] = [];
    for (var j = 0; j < list.length; j++) {
      var it = list[j];
      if (d.dead(it)) problems.push(name + '[' + j + '] 该回收却还在（回收被漏掉）');
      if (it && typeof it === 'object') {
        if (seen.indexOf(it) >= 0) problems.push(name + '[' + j + '] 同一对象出现了两次（交换删除写错）');
        else if (seen.length < 512) seen.push(it);
      }
    }
  }
  return problems;
};

/** 人话报告（调试叠层 / 测试失败信息） */
Containers.describe = function (sess) {
  var st = Containers.stats(sess);
  var lines = ['容器账目：' + NAMES.length + ' 个'];
  for (var i = 0; i < NAMES.length; i++) {
    var n = NAMES[i];
    var s = st[n];
    lines.push('  ' + n.padEnd(14) + String(s.len).padStart(5) + ' / ' +
      (s.cap === Infinity ? '∞' : String(s.cap)).padStart(5) +
      '  ' + s.policy.padEnd(5) + s.onFull.padEnd(17) + DEFS[n].note);
  }
  return lines.join('\n');
};

/* =========================================================
   登记进扩展点总账（见 registry.ts）
   ---------------------------------------------------------
   容器是**对象系统的第三个家族**（前两个是组件与原型）：
   `object.ts` 的普查表用 `family: 'container'` 引用这里的名字，
   于是"普查表里写了一个不存在的容器"在启动期就会抛。
   ========================================================= */
Registry.family('container', {
  note: '容器（对象住在哪个会话字段、最多几个、满了怎么办）', owner: 'containers.ts',
  /* 只登记**名字**：policy / onFull 的取值域在 `Containers.declare` 里当场就校验了
     （写错直接抛），再立两个家族只是把同一条规则写两遍 —— 那是噪音。 */
  values: function () { return NAMES.slice(); }
});

export { Containers };
