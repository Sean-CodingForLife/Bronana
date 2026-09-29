/* =========================================================
emit.ts — 粒子发生器（Emitter）
职责：
1) 特效"配方"集中定义在这里，玩法代码只说"要什么效果"，不关心粒子怎么造
2) 粒子对象用自由链表复用，运行期零分配
3) 满员时 O(1) 轮转覆盖（而不是线性扫描找最旧的一个）
4) 回收时必须整体重置字段，避免上一条粒子的残留字段串到新特效上
渲染仍在 sprites.ts / render.ts（本文件不碰 canvas）
========================================================= */

import { Comp } from './comp.ts';
import { PAL, U } from './utils.ts';

var VIS_CAP = 420;    // 视觉粒子上限
var TEXT_CAP = 28;    // 伤害飘字上限（文字渲染较贵，单独限流）

var Emit = {} as EmitApi;
var S = null;         // 当前会话

Emit.VIS_CAP = VIS_CAP;
Emit.TEXT_CAP = TEXT_CAP;

Emit.bind = function (sess) {
  S = sess;
  if (!S.particles) S.particles = [];
  if (!S.textParticles) S.textParticles = [];
  if (!S.freeParticles) S.freeParticles = [];
  if (!S.freeTextParticles) S.freeTextParticles = [];
  if (S.visCursor === undefined) S.visCursor = 0;
  if (S.textCursor === undefined) S.textCursor = 0;
  return Emit;
};

/* =========================================================
   对象池
   ========================================================= */
/** 视觉粒子的完整字段表：回收/复用前必须逐项重置 */
function resetVis(p) {
  p.kind = 'dot';
  p.x = 0; p.y = 0;
  p.vx = 0; p.vy = 0;
  p.r = 2;
  p.color = PAL.WHITE;
  p.life = 0; p.lifeMax = 0;
  p.drag = 0;
  p.a = 0; p.arc = 0; p.rot = 0;
  p.r0 = 0; p.r1 = 0; p.w = 0;
  // 组件化之后粒子出生即带全部字段（text/size 也在），所以重置必须是"全字段"的：
  // 原来这两行不存在，靠的是"视觉粒子压根没有 text/size 属性"这个隐含前提。
  p.text = ''; p.size = 0;
  return p;
}

function resetText(p) {
  p.kind = 'text';
  p.x = 0; p.y = 0;
  p.vx = 0; p.vy = -46;
  p.text = '';
  p.color = PAL.WHITE;
  p.size = 14;
  p.life = 0; p.lifeMax = 0;
  p.drag = 0; p.a = 0; p.arc = 0; p.rot = 0;
  p.r0 = 0; p.r1 = 0; p.w = 0;
  return p;
}

/**
 * 取一个可用槽位。
 * 未满：从自由链表拿（链表空则新建一次）；
 * 已满：轮转覆盖，O(1)，效果上等价于"丢掉最旧的一条"。
 */
function acquire(list, free, cap, cursorKey, factory, reset) {
  if (list.length < cap) {
    var p = free.pop() || factory();
    reset(p);
    list.push(p);
    return p;
  }
  var idx = S[cursorKey] % list.length;
  S[cursorKey]++;
  var q = list[idx];
  reset(q);          // 关键：覆盖前彻底重置，防残留字段
  return q;
}

/** O(1) 移除：把末尾元素填到空位，被移除的对象回收到自由链表 */
function removeSwap(list, i, free) {
  var removed = list[i];
  var last = list.pop();
  if (i < list.length) list[i] = last;
  free.push(removed);
}

function acquireVis() {
  return acquire(S.particles, S.freeParticles, VIS_CAP, 'visCursor',
    function () { return Comp.spawn('particle'); }, resetVis);
}

function acquireText() {
  return acquire(S.textParticles, S.freeTextParticles, TEXT_CAP, 'textCursor',
    function () { return Comp.spawn('particle'); }, resetText);
}

Emit.clear = function () {
  if (!S) return;
  for (var i = 0; i < S.particles.length; i++) S.freeParticles.push(S.particles[i]);
  for (var j = 0; j < S.textParticles.length; j++) S.freeTextParticles.push(S.textParticles[j]);
  S.particles.length = 0;
  S.textParticles.length = 0;
  S.visCursor = 0; S.textCursor = 0;
};

/* =========================================================
   低层发射
   ========================================================= */
/**
 * 视觉强度（0~1），由"减少动效"设置调低：只影响**看得见的东西**。
 * 抽稀按计数器、不按 S.rnd() —— 用随机数抽稀等于让"画面设置"改变模拟的
 * 随机序列，同一份录制在两种设置下回放就会分叉。画面设置不该动模拟。
 */
Emit.visScale = 1;
var _visTick = 0;

/** 通用视觉粒子：props 直接覆盖到池对象上（字段已在 acquire 时重置） */
Emit.spawn = function (props) {
  if (Emit.visScale < 1) {
    _visTick++;
    if ((_visTick & 1) === 0) return null;      // 隔一个丢一个 = 砍掉一半
  }
  var p = acquireVis();
  // 走 Comp.assign 而不是裸 for-in：写一个原型没声明的字段会**当场抛错**，
  // 而不是在池对象上悄悄长出一个游离字段 —— 池对象复用最怕这个，
  // 一个拼错的字段会让整池粒子的形状分叉（而且只有那条配方会中招）。
  Comp.assign(p, props);
  p.lifeMax = p.lifeMax || p.life || 0.4;
  p.life = p.lifeMax;
  return p;
};

/**
 * 伤害飘字 / 提示文字。
 * priority=true（暴击、治疗、受击）时即使满员也会挤进一条；
 * 否则满员就丢弃 —— 转轮机枪配置下每秒上百次命中，全画出来既卡也看不清。
 */
Emit.text = function (x, y, str, color, size, priority) {
  if (S.textParticles.length >= TEXT_CAP && !priority) return null;
  var t = acquireText();
  t.x = x; t.y = y;
  t.text = str;
  t.color = color;
  t.size = size;
  t.life = t.lifeMax = 0.7;
  return t;
};

/* =========================================================
   效果配方（玩法代码只调这些）
   ========================================================= */

/** 击杀碎片 */
Emit.deathSparks = function (e) {
  for (var i = 0; i < 4; i++) {
    var a = S.rnd() * U.TAU;
    Emit.spawn({
      kind: 'spark', x: e.x, y: e.y,
      vx: Math.cos(a) * 90, vy: Math.sin(a) * 90,
      r: 3 + S.rnd() * 3, color: e.def.color, life: 0.35, drag: 3
    });
  }
};

/** 玩家受击溅血 */
Emit.blood = function (x, y, n) {
  n = n || 3;
  for (var i = 0; i < n; i++) {
    var a = S.rnd() * U.TAU;
    Emit.spawn({
      kind: 'spark', x: x, y: y,
      vx: Math.cos(a) * 70, vy: Math.sin(a) * 70,
      r: 3, color: PAL.BLOOD, life: 0.3, drag: 3
    });
  }
};

/** 灼烧余烬 */
Emit.ember = function (e) {
  Emit.spawn({
    kind: 'spark', x: e.x + (S.rnd() - 0.5) * 16, y: e.y - e.r * 0.5,
    vx: 0, vy: -40, r: 3, color: PAL.FIRE, life: 0.3
  });
};

/** 近战挥击弧 */
Emit.slash = function (x, y, r, a, arc) {
  return Emit.spawn({ kind: 'slash', x: x, y: y, r: r, a: a, arc: arc, life: 0.18 });
};

/** 枪口闪光 */
Emit.muzzle = function (x, y, ang, big) {
  return Emit.spawn({
    kind: 'flash', x: x, y: y,
    r: 9 + (big ? 6 : 0), life: 0.1, rot: ang
  });
};

/** 电弧（电击棒连锁 / 电击弹） */
Emit.shockRing = function (x, y) {
  return Emit.spawn({ kind: 'ring', x: x, y: y, r0: 4, r1: 20, w: 2, color: PAL.ICE, life: 0.16 });
};

/** 子弹爆炸（火箭 / 元素法球） */
Emit.bulletExplosion = function (x, y, radius, crit) {
  Emit.spawn({ kind: 'blast', x: x, y: y, r: radius * (crit ? 1.25 : 1), color: PAL.FIRE, life: 0.3 });
  Emit.spawn({ kind: 'ring', x: x, y: y, r0: 8, r1: radius * 1.2, w: 5, color: PAL.MUZZLE, life: 0.26 });
};

/** 死亡自爆（爆裂菌等） */
Emit.deathExplosion = function (x, y, radius) {
  Emit.spawn({ kind: 'blast', x: x, y: y, r: radius * 0.8, color: PAL.FIRE, life: 0.32 });
  Emit.spawn({ kind: 'ring', x: x, y: y, r0: 10, r1: radius, w: 5, color: PAL.E4, life: 0.28 });
};

/** 打墙（暗门）：灰白的碎屑，颜色刻意与打怪区分开 —— 让"我在打墙"一眼看得出 */
Emit.wallHit = function (x, y, n) {
  var cnt = n || 3;
  for (var i = 0; i < cnt; i++) {
    var a = (i / cnt) * U.TAU + x * 0.01;
    Emit.spawn({
      kind: 'chip', x: x, y: y,
      vx: Math.cos(a) * (40 + (i % 3) * 24), vy: Math.sin(a) * (40 + (i % 3) * 24) - 20,
      r: 2 + (i % 2), color: PAL.PEBBLE_HI, life: 0.28, drag: 2.2, rot: a
    });
  }
};

/** 墙塌了一面 */
Emit.wallBreak = function (x, y) {
  Emit.spawn({ kind: 'ring', x: x, y: y, r0: 8, r1: 74, w: 6, color: PAL.PEBBLE, life: 0.34 });
  Emit.spawn({ kind: 'blast', x: x, y: y, r: 34, color: PAL.PEBBLE, life: 0.3 });
  Emit.wallHit(x, y, 10);
};

/* ---- 文字配方 ---- */
/** 伤害飘字开关（"伤害飘字"设置）。治疗/闪避/受击不受影响 ——
    那些是低频且重要的反馈，关掉只会让人看不懂发生了什么。 */
Emit.showDamage = true;
Emit.damage = function (x, y, amount, crit) {
  if (!Emit.showDamage) return null;
  return Emit.text(x, y, U.fmtNum(amount) + (crit ? '!' : ''),
    crit ? PAL.GOLD : PAL.WHITE, crit ? 19 : 14, crit);
};
Emit.heal = function (x, y, amount) {
  return Emit.text(x, y, '+' + U.round2(amount), PAL.XP, 13, true);
};
Emit.dodge = function (x, y) {
  return Emit.text(x, y, '闪避', PAL.ICE, 15, true);
};
Emit.playerHurt = function (x, y, dmg) {
  return Emit.text(x, y, '-' + U.fmtNum(dmg), PAL.HP, 16, true);
};

/* =========================================================
   更新（移动 / 生命周期 / 回收）
   ========================================================= */
// 步进逻辑登记为组件系统（comp.ts 的 particleStep）：
// "它需要 Lifetime + Motion" 从此是被校验的声明，而不是注释。
// 倒序遍历是必须的：交换删除会把末尾元素搬到空位，正序会跳过它。
var STEP_CTX = {
  list: null as any[], free: null as any[],
  i: 0,
  remove: function (i) { removeSwap(STEP_CTX.list, i, STEP_CTX.free); }
};
function stepList(list, free, dt) {
  if (!list.length) return;
  STEP_CTX.list = list; STEP_CTX.free = free;
  Comp.run('particleStep', list, dt, STEP_CTX);
}

Emit.update = function (dt) {
  if (!S) return;
  stepList(S.particles, S.freeParticles, dt);
  stepList(S.textParticles, S.freeTextParticles, dt);
};

/* =========================================================
   统计（测试与 ?fps=1 叠加层用）
   ========================================================= */
Emit.stats = function () {
  if (!S) return { vis: 0, text: 0, freeVis: 0, freeText: 0 };
  return {
    vis: S.particles.length,
    text: S.textParticles.length,
    freeVis: S.freeParticles.length,
    freeText: S.freeTextParticles.length
  };
};

/** 活跃对象里是否有重复引用（自检：池不允许同一个对象出现在数组里两次） */
Emit.audit = function () {
  var seen = new Set(), dup = 0, i;
  for (i = 0; i < S.particles.length; i++) {
    if (seen.has(S.particles[i])) dup++;
    seen.add(S.particles[i]);
  }
  for (i = 0; i < S.textParticles.length; i++) {
    if (seen.has(S.textParticles[i])) dup++;
    seen.add(S.textParticles[i]);
  }
  // 自由链表里也不该出现活跃对象
  for (i = 0; i < S.freeParticles.length; i++) if (seen.has(S.freeParticles[i])) dup++;
  for (i = 0; i < S.freeTextParticles.length; i++) if (seen.has(S.freeTextParticles[i])) dup++;
  return { duplicates: dup, tracked: seen.size };
};

export { Emit };
