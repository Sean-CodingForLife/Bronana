/* =========================================================
   ai.ts — 怪物行为与弹幕模式（注册表驱动）
   ---------------------------------------------------------
   改造前：这两件事都是 game.ts 里的 if/else 链 ——
     · 行为：`if (beh === 'ranged' || beh === 'boss') {…} else {追}`，
       而接触伤害单独写成 `if (beh === 'chase')`；
     · 弹幕：`if (pattern === 'ring') … else if (pattern === 'fan') … else 单发`。
   问题不是"分支多"，而是**分支的默认值会吞掉错误**：
   `behavior` 写错一个字母，怪物会照常移动（走 else 分支）但**永远不造成接触伤害**；
   `pattern` 写错则静默退化成单发。数据表里 10 种怪 4 种模式，全靠人眼核对。

   现在：
     · 行为与弹幕模式都是**注册表**（新增一种 = 一次注册，不改更新循环）；
     · 未知名字**当场抛错**（`AI.step` / `AI.shoot` 里查表失败即炸），
       测试再对数据表逐个核对（见 test/ai.mjs）；
     · 依赖倒置：本模块不认识 Game/Session，只认 `AiCtx` 里那几个能力
       （查询、伤害、击杀、开火、夹取坐标、随机数）。
       于是行为可以**脱离整局游戏单独测**：给一个假 ctx 就能断言"它该逼近还是该保持距离"。
   ========================================================= */

import { Registry } from './registry.ts';
import { U } from './utils.ts';

var AI = {} as AiApi;

/* =========================================================
   注册表
   ========================================================= */
var BEHS: Record<string, AiBehaviour> = Object.create(null);
var BEH_NAMES: string[] = [];
var PATS: Record<string, AiPattern> = Object.create(null);
var PAT_NAMES: string[] = [];

/** 注册一种行为。`move` 决定速度意图，`contact` 处理接触判定（近战型才有）。 */
AI.behaviour = function (name, def) {
  if (BEHS[name]) throw new Error('ai: 行为重名 ' + name);
  if (!def || typeof def.move !== 'function') throw new Error('ai: 行为 ' + name + ' 缺少 move');
  if (def.contact !== undefined && typeof def.contact !== 'function') {
    throw new Error('ai: 行为 ' + name + ' 的 contact 不是函数');
  }
  BEHS[name] = { name: name, note: def.note || '', move: def.move, contact: def.contact || null };
  BEH_NAMES.push(name);
  return BEHS[name];
};
AI.hasBehaviour = function (name) { return !!BEHS[name]; };
AI.behaviours = function () { return BEH_NAMES.slice(); };
AI.behaviourInfo = function (name) {
  var b = BEHS[name];
  return b ? { name: b.name, note: b.note, contact: !!b.contact } : null;
};

/**
 * 注册一种弹幕模式。
 * @param big 该模式是否用"大弹"（Boss 扇形弹用的就是这一档）
 * @param angles(def, base) → 角度数组（base = 指向玩家的方向）
 */
AI.pattern = function (name, opts, angles) {
  if (PATS[name]) throw new Error('ai: 弹幕模式重名 ' + name);
  if (typeof angles !== 'function') throw new Error('ai: 弹幕模式 ' + name + ' 缺少 angles');
  PATS[name] = { name: name, note: (opts && opts.note) || '', big: !!(opts && opts.big), angles: angles };
  PAT_NAMES.push(name);
  return PATS[name];
};
AI.hasPattern = function (name) { return !!PATS[name]; };
AI.patterns = function () { return PAT_NAMES.slice(); };
AI.patternInfo = function (name) {
  var p = PATS[name];
  return p ? { name: p.name, note: p.note, big: p.big } : null;
};

/* =========================================================
   共用骨架：击退 → 行为给出的速度意图 → 分离力 → 位移 → 血量光环 → 接触判定
   （与改造前的 updateEnemies 逐步一致，包括随机数的消费顺序）
   ========================================================= */
AI.step = function (e, ctx) {
  var p = ctx.player;
  var dt = ctx.dt;
  var def = e.def;

  var dx = p.x - e.x, dy = p.y - e.y;
  var d = Math.sqrt(dx * dx + dy * dy) || 1;
  var nx = dx / d, ny = dy / d;

  var beh = BEHS[def.behavior || 'chase'];
  if (!beh) throw new Error('ai: 未注册的行为 ' + def.behavior + '（怪物 ' + def.id + '）');

  ctx.d = d; ctx.nx = nx; ctx.ny = ny;

  // 击退位移
  e.x += e.kx * dt; e.y += e.ky * dt;
  e.kx *= Math.max(0, 1 - dt * 11);
  e.ky *= Math.max(0, 1 - dt * 11);

  beh.move(e, ctx);

  // 分离力（避免完全重叠）
  var near = ctx.query(e.x, e.y, e.r * 2.1);
  for (var q = 0; q < near.length; q++) {
    var o = near[q];
    if (o === e) continue;
    var ox = e.x - o.x, oy = e.y - o.y;
    var od = Math.sqrt(ox * ox + oy * oy) || 1;
    var overlap = (e.r + o.r) - od;
    if (overlap > 0) {
      e.vx += (ox / od) * overlap * 6;
      e.vy += (oy / od) * overlap * 6;
    }
  }

  e.x += e.vx * dt;
  e.y += e.vy * dt;
  var cl = ctx.clamp(e.x, e.y, e.r * 0.8);
  e.x = cl.x; e.y = cl.y;

  // 治疗光环（数据驱动的"特质"，不属于任何一种行为）
  if (def.healAura) {
    var aura = def.healAura;
    var allies = ctx.query(e.x, e.y, aura.radius);
    for (var h = 0; h < allies.length; h++) {
      var a2 = allies[h];
      if (a2 === e || a2.dead) continue;
      if (a2.hp < a2.maxHp) a2.hp = Math.min(a2.maxHp, a2.hp + aura.hps * dt);
    }
  }

  if (beh.contact) beh.contact(e, ctx);
};

/* =========================================================
   弹幕：模式查表 → 交给 ctx.shoot 真正造子弹
   ========================================================= */
AI.shoot = function (e, ctx) {
  var def = e.def;
  var pat = PATS[def.pattern || 'single'];
  if (!pat) throw new Error('ai: 未注册的弹幕模式 ' + def.pattern + '（怪物 ' + def.id + '）');
  var base = Math.atan2(ctx.ny, ctx.nx);
  var angles = pat.angles(def, base, e);
  for (var i = 0; i < angles.length; i++) ctx.shoot(e, angles[i], pat.big);
  if (ctx.sfx) ctx.sfx.shoot('sniper');
};

/* =========================================================
   内置行为
   ========================================================= */

/** 保持距离 + 环绕 + 到点开火（远程怪与 Boss 共用，只有两个参数不同） */
function standoff(e, ctx, keepDist, shootRange) {
  var keep = keepDist;
  var want;
  if (ctx.d > keep + 24) want = 1;
  else if (ctx.d < keep - 30) want = -1;
  else want = 0;
  e.vx = ctx.nx * e.speed * want;
  e.vy = ctx.ny * e.speed * want;
  // 到位之后环绕（横向滑动），不是站着不动
  if (want === 0) {
    e.vx = -ctx.ny * e.speed * 0.6;
    e.vy = ctx.nx * e.speed * 0.6;
  }
  e.atkCd -= ctx.dt;
  if (e.atkCd <= 0 && ctx.d < shootRange) {
    e.atkCd = e.def.atkCd;
    e.windup = 0.34;
  }
  if (e.windup > 0) {
    e.windup -= ctx.dt;
    if (e.windup <= 0) AI.shoot(e, ctx);
  }
}

AI.behaviour('chase', {
  note: '直线追击 + 贴身撕咬（带前摇的二连击）',
  move: function (e, ctx) {
    e.vx = ctx.nx * e.speed;
    e.vy = ctx.ny * e.speed;
  },
  contact: function (e, ctx) {
    var cr = e.r + ctx.player.r - 4;
    var d = ctx.d, def = e.def;
    if (d < cr) {
      if (def.explodeOnDeath) {          // 自爆怪：接触即引爆
        ctx.kill(e);
      } else {
        ctx.hurt(e.dmg);
        e.kx = -ctx.nx * 130; e.ky = -ctx.ny * 130;   // 顶开
      }
    } else if (e.windup > 0) {
      e.windup -= ctx.dt;
      if (e.windup <= 0 && d < cr + 26) ctx.hurt(e.dmg);
    } else if (d < cr + 34 && ctx.rnd() < ctx.dt * 1.6) {
      e.windup = 0.28;
    }
  }
});

AI.behaviour('ranged', {
  note: '停在 keepDist 外环绕射击',
  move: function (e, ctx) {
    standoff(e, ctx, e.def.keepDist || 0, (e.def.keepDist || 200) + 130);
  }
});

AI.behaviour('boss', {
  note: '体型大、射程远：缓慢逼近到 120px 内，扇形弹幕',
  move: function (e, ctx) {
    // keepDist 为 0：只在贴身（<24px）时才环绕，否则一直压上来
    standoff(e, ctx, 0, 620);
  }
});

/* ---- G3：三位"换应对方式"的 Boss ----
   每一条行为都必须回答一个**玩家该怎么做**的问题，否则它就只是换皮：
     burrow    什么时候该拉开（它钻地时打不到，冒出来是环形弹）
     summon    先清小怪还是先集火本体（它不停下蛋）
     metronome 什么时候横移（它按固定节拍扫一整条弧线）
   状态存在 AI 组件的 t1/t2 上（声明过，不是临时挂字段）。 */

AI.behaviour('burrow', {
  note: '钻地 → 贴身 → 破土（钻地期间打不到，破土放一整圈弹）',
  move: function (e, ctx) {
    if (!e.t1) {                       // 0 = 地面上
      e.t1 = 3.6 + ctx.rnd() * 1.2;    // 露头时长
      e.t2 = 0;
    }
    e.t1 -= ctx.dt;
    if (e.t1 > 0) {
      // 地面上：压上去，按 atkCd 放扇形（复用 boss 的逼近手感）
      e.burrowed = 0;
      standoff(e, ctx, 0, 620);
      return;
    }
    // 钻地：锁定"当前朝玩家的方向"，直线冲过去，不打人也不被打
    e.burrowed = 1;
    var dive = 1.1;
    if (!e.t2) e.t2 = dive;
    e.t2 -= ctx.dt;
    e.vx = ctx.nx * e.speed * 2.1;
    e.vy = ctx.ny * e.speed * 2.1;
    e.atkCd = 0.15;
    if (e.t2 <= 0) {
      e.t1 = 0;                        // 回到地面 → 破土
      e.burrowed = 0;
      e.windup = 0.0001;               // 立刻吐一整圈
      if (ctx.shake) ctx.shake(0.35);
    }
  }
});

AI.behaviour('summon', {
  note: '保持中距，按节拍召唤小怪（不清小怪就会被挤死）',
  move: function (e, ctx) {
    standoff(e, ctx, e.def.keepDist || 90, (e.def.keepDist || 90) + 150);
    e.t2 -= ctx.dt;
    if (e.t2 <= 0) {
      e.t2 = e.def.summonEvery || 3.4;
      var ids = e.def.summonIds || ['grub'];
      var n = e.def.summonCount || 2;
      for (var i = 0; i < n; i++) {
        var id = ids[Math.floor(ctx.rnd() * ids.length)] || ids[0];
        var a = ctx.rnd() * U.TAU;
        if (ctx.spawn) ctx.spawn(id, e.x + Math.cos(a) * (e.r + 22), e.y + Math.sin(a) * (e.r + 22));
      }
      e.windup = 0.2;                  // 下蛋时顺便吐一圈
    }
  }
});

AI.behaviour('metronome', {
  note: '按固定节拍左右扫射（考横移时机，不是考躲弹密度）',
  move: function (e, ctx) {
    standoff(e, ctx, e.def.keepDist || 150, (e.def.keepDist || 150) + 200);
    // 扫射相位：t1 在 0..1 之间来回，弹幕模式按它算角度
    e.t1 += ctx.dt * 0.55 * (e.t2 >= 0 ? 1 : -1);
    if (e.t1 > 1) { e.t1 = 1; e.t2 = -1; }
    if (e.t1 < -1) { e.t1 = -1; e.t2 = 1; }
  }
});

/* =========================================================
   内置弹幕模式
   ========================================================= */
AI.pattern('single', { note: '朝玩家一发', big: false }, function (def, base) {
  return [base];
});

AI.pattern('ring', { note: '整圈均匀撒 n 发', big: false }, function (def, base) {
  var n = def.ringCount || 6;
  var out = [];
  for (var i = 0; i < n; i++) out.push(base + i / n * U.TAU);
  return out;
});

AI.pattern('fan', { note: '朝玩家扇形 n 发（大弹）', big: true }, function (def, base) {
  var n = def.fanCount || 5;
  var out = [];
  for (var i = 0; i < n; i++) out.push(base + (i - (n - 1) / 2) * 0.20);
  return out;
});

/* 扫射：以"朝玩家的方向"为中心，按怪身上的 t1 相位把整条弧线平移过去。
   相位来自**怪**（e.t1），不是来自 def —— def 是共享的声明表，
   往上面写运行期状态会让同一只怪的相位泄漏给所有同类。 */
AI.pattern('sweep', { note: '沿一条弧线扫射 n 发（相位由行为驱动）', big: false }, function (def, base, e) {
  var n = def.sweepCount || 7;
  var arc = def.sweepArc || 1.2;
  var phase = e && typeof e.t1 === 'number' ? e.t1 : 0;
  var out = [];
  for (var i = 0; i < n; i++) out.push(base + phase * arc * 0.5 + (i - (n - 1) / 2) * (arc / n));
  return out;
});

/* 注册到扩展点总账：行为与弹幕模式都是家族，怪物数据表引用它们（enemies.ts） */
Registry.family('aiBehaviour', {
  note: '怪物行为（注册表驱动）', owner: 'ai.ts',
  values: function () { return BEH_NAMES.slice(); }
});
Registry.family('aiPattern', {
  note: '敌弹弹幕模式', owner: 'ai.ts',
  values: function () { return PAT_NAMES.slice(); }
});
export { AI };
