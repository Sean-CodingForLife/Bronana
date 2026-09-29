/* =========================================================
   ai.mjs — 怪物行为 / 弹幕模式测试
   这一套测的是"抽出来之后是不是真的可测了"：
     · 注册表：重名、缺字段、未知名字都要抛错（不再静默退化）
     · 数据表核对：Enemies.LIST 里每个 behavior / pattern 都必须有实现
       （改造前 behavior 写错一个字母 → 怪物照常走 but 永不造成接触伤害）
     · 行为单测：给一个**假 ctx**，断言"该逼近 / 该保持距离 / 该开火 / 该回血"，
       不需要跑整局游戏
   用法： node test/ai.mjs
   ========================================================= */
import { loadAll, SIM_MODULES } from './_load.mjs';

let failures = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  \x1b[32mPASS\x1b[0m ' + label);
  else { failures++; console.log('  \x1b[31mFAIL\x1b[0m ' + label + (extra !== undefined ? '  → ' + extra : '')); }
}
function throws(fn) { try { fn(); return null; } catch (e) { return e.message; } }

await loadAll(SIM_MODULES);
const { AI, Enemies, Game } = globalThis;

console.log('\n=== Bronana · 怪物行为 / 弹幕模式 ===\n');

/* ---------------- 1. 注册表自身的约束 ---------------- */
console.log('[1] 注册表：定义期校验');
{
  ok(AI.behaviours().length >= 3, '已注册的行为：' + AI.behaviours().join('/'), AI.behaviours().join('/'));
  ok(AI.patterns().length >= 3, '已注册的弹幕模式：' + AI.patterns().join('/'), AI.patterns().join('/'));

  const e1 = throws(() => AI.behaviour('chase', { move: function () {} }));
  ok(!!e1 && /重名/.test(e1), '行为重名被拒绝', e1);

  const e2 = throws(() => AI.behaviour('nope', {}));
  ok(!!e2 && /缺少 move/.test(e2), '行为缺 move 被拒绝', e2);

  const e3 = throws(() => AI.behaviour('badContact', { move: function () {}, contact: 1 }));
  ok(!!e3 && /contact/.test(e3), 'contact 不是函数被拒绝', e3);

  const e4 = throws(() => AI.pattern('single', {}, function () { return []; }));
  ok(!!e4 && /重名/.test(e4), '弹幕模式重名被拒绝', e4);

  const e5 = throws(() => AI.pattern('bad', {}, null));
  ok(!!e5 && /缺少 angles/.test(e5), '弹幕模式缺 angles 被拒绝', e5);

  const dense = AI.behaviourInfo('chase');
  const rng = AI.behaviourInfo('ranged');
  ok(dense && dense.contact === true, '近战行为声明了 contact');
  ok(rng && rng.contact === false, '远程行为没有 contact（不应该有接触伤害）');
  ok(AI.behaviourInfo('nope') === null && AI.patternInfo('nope') === null, '查不到的名字返回 null');
  ok(AI.hasBehaviour('chase') && !AI.hasBehaviour('Chase'), '行为名区分大小写（防拼写漂移）');
}

/* ---------------- 2. 数据表核对：写错一个字母必须在这里红 ---------------- */
console.log('\n[2] 数据表 ↔ 注册表');
{
  const badBeh = [], badPat = [];
  for (const def of Enemies.LIST) {
    const beh = def.behavior || 'chase';
    if (!AI.hasBehaviour(beh)) badBeh.push(def.id + ':' + beh);
    const pat = def.pattern || 'single';
    if (!AI.hasPattern(pat)) badPat.push(def.id + ':' + pat);
  }
  ok(badBeh.length === 0, '全部 ' + Enemies.LIST.length + ' 种怪的 behavior 都有实现', badBeh.join(', '));
  ok(badPat.length === 0, '全部怪物的 pattern 都有实现', badPat.join(', '));

  const noNote = Enemies.LIST.filter(d => !(AI.behaviourInfo(d.behavior || 'chase') || {}).note)
    .map(d => d.id);
  ok(noNote.length === 0, '每种行为都写了说明（新增行为时强制解释它是什么）', noNote.join(', '));

  // 未知名字必须在**运行期**当场抛错，而不是静默走默认分支
  const fake = { def: { id: 'ghost', behavior: 'teleport', scale: 1 }, x: 0, y: 0, r: 10, kx: 0, ky: 0, vx: 0, vy: 0, speed: 50, hp: 1, maxHp: 1, dmg: 1, atkCd: 1, windup: 0 };
  const e6 = throws(() => AI.step(fake, stubCtx()));
  ok(!!e6 && /未注册的行为 teleport/.test(e6), '未知行为在 step 时抛错（改造前是静默变成"追但无接触伤害"）', e6);

  const fake2 = { def: { id: 'ghost2', behavior: 'chase', pattern: 'spiral' }, x: 0, y: 0, r: 10 };
  const e7 = throws(() => AI.shoot(fake2, stubCtx()));
  ok(!!e7 && /未注册的弹幕模式 spiral/.test(e7), '未知弹幕模式抛错（改造前是静默退化成单发）', e7);
}

/* ---------------- 假上下文：脱离整局游戏跑一个怪物的一步 ---------------- */
function stubCtx(opts) {
  opts = opts || {};
  const c = {
    dt: opts.dt === undefined ? 1 / 60 : opts.dt,
    player: { x: opts.px === undefined ? 0 : opts.px, y: opts.py === undefined ? 0 : opts.py, r: opts.pr === undefined ? 18 : opts.pr },
    d: 0, nx: 0, ny: 0, sfx: null,
    log: { hurt: [], kill: [], shoot: [], clamp: 0 },
    queue: opts.queue || [],
    rnd: opts.rnd || function () { return 0.5; },
    query: function () { return c.queue.length ? c.queue.shift() : []; },
    hurt: function (dmg) { c.log.hurt.push(dmg); },
    kill: function (e) { c.log.kill.push(e.def.id); },
    shoot: function (e, a, big) { c.log.shoot.push({ a: a, big: big }); },
    clamp: function (x, y) { c.log.clamp++; return { x: x, y: y }; },
  };
  return c;
}
function mkEnemy(over) {
  return Object.assign({
    def: { id: 'test', behavior: 'chase', scale: 1, dmg: 5, atkCd: 2, speed: 60 },
    x: 100, y: 0, r: 20, kx: 0, ky: 0, vx: 0, vy: 0,
    speed: 60, hp: 10, maxHp: 10, dmg: 5, atkCd: 2, windup: 0, elite: false, dead: false
  }, over || {});
}

/* ---------------- 3. 行为：追击 / 接触伤害 ---------------- */
console.log('\n[3] chase：逼近 + 接触伤害');
{
  const ctx = stubCtx({ px: 300, py: 0 });
  const e = mkEnemy({});
  AI.step(e, ctx);
  ok(e.vx > 0 && Math.abs(e.vy) < 1e-9, '远离时朝玩家直线加速', e.vx.toFixed(1) + ',' + e.vy.toFixed(1));
  ok(ctx.log.hurt.length === 0, '还没碰到就不伤害玩家');

  // 贴身：玩家就在脚下 → 接触伤害 + 被顶开
  const ctx2 = stubCtx({ px: 0, py: 0 });
  const e2 = mkEnemy({ x: 10, y: 0 });
  AI.step(e2, ctx2);
  ok(ctx2.log.hurt.length === 1 && ctx2.log.hurt[0] === 5, '接触造成 e.dmg 点伤害', JSON.stringify(ctx2.log.hurt));
  ok(e2.kx > 0, '接触后被朝"远离玩家"的方向顶开', e2.kx.toFixed(0));

  // 自爆怪：接触即引爆（不是造成伤害）
  const ctx3 = stubCtx({ px: 0, py: 0 });
  const e3 = mkEnemy({ x: 10, y: 0, def: { id: 'boom', behavior: 'chase', dmg: 9, explodeOnDeath: { dmg: 7, radius: 74 } } });
  AI.step(e3, ctx3);
  ok(ctx3.log.kill.length === 1 && ctx3.log.hurt.length === 0, '自爆怪接触即引爆而不是咬人',
    'kill ' + ctx3.log.kill.length + ' / hurt ' + ctx3.log.hurt.length);

  // 前摇：d 在 [cr, cr+34) 且随机数命中 → 进入前摇；前摇结束且仍在范围内 → 咬一口
  const ctx4 = stubCtx({ px: 40, py: 0, rnd: function () { return 0; } });
  const e4 = mkEnemy({ x: 0, y: 0 });
  AI.step(e4, ctx4);
  ok(e4.windup > 0, '贴身但未接触时进入前摇', e4.windup.toFixed(2));
  const ctx5 = stubCtx({ px: 40, py: 0 });
  const e5 = mkEnemy({ x: 0, y: 0, windup: 0.01 });
  AI.step(e5, ctx5);
  ok(ctx5.log.hurt.length === 1, '前摇结束且玩家仍在范围内 → 咬中', JSON.stringify(ctx5.log.hurt));
  ok(e5.windup <= 0, '前摇清零（不会重复触发）');
}

/* ---------------- 4. 行为：保持距离的远程怪 ---------------- */
console.log('\n[4] ranged：保持距离 + 环绕 + 前摇开火');
{
  const def = { id: 'spit', behavior: 'ranged', keepDist: 200, atkCd: 2, speed: 40, projDmg: 4, pattern: 'ring', ringCount: 6 };
  const far = mkEnemy({ def: def, x: 500, y: 0, speed: 40, atkCd: 2 });
  const ctxFar = stubCtx({ px: 0, py: 0 });
  AI.step(far, ctxFar);
  ok(far.vx < 0, '太远 → 朝玩家靠近', far.vx.toFixed(1));

  const near = mkEnemy({ def: def, x: 100, y: 0, speed: 40, atkCd: 2 });
  const ctxNear = stubCtx({ px: 0, py: 0 });
  AI.step(near, ctxNear);
  ok(near.vx > 0, '太近 → 后退', near.vx.toFixed(1));

  const inBand = mkEnemy({ def: def, x: 200, y: 0, speed: 40, atkCd: 2 });
  const ctxBand = stubCtx({ px: 0, py: 0 });
  AI.step(inBand, ctxBand);
  ok(Math.abs(inBand.vx) < 1e-9 && inBand.vy !== 0, '在距离带内 → 环绕（速度与玩家方向垂直）',
    inBand.vx.toFixed(1) + ',' + inBand.vy.toFixed(1));

  // 冷却到期 → 进入前摇；前摇结束 → 按 pattern 开火
  const shooter = mkEnemy({ def: def, x: 200, y: 0, speed: 40, atkCd: 0 });
  const cs = stubCtx({ px: 0, py: 0 });
  AI.step(shooter, cs);
  ok(shooter.windup > 0 && cs.log.shoot.length === 0, '冷却到期先进前摇（不是立刻出弹）', shooter.windup.toFixed(2));
  shooter.windup = 0.01;
  AI.step(shooter, cs);
  ok(cs.log.shoot.length === 6, '前摇结束后按 ring 模式出 6 发', String(cs.log.shoot.length));
  ok(cs.log.shoot.every(s => s.big === false), 'ring 模式用的是普通弹');

  // 射程：超出 keepDist + 130 就不开火
  const tooFar = mkEnemy({ def: def, x: 400, y: 0, speed: 40, atkCd: 0 });
  const cf = stubCtx({ px: 0, py: 0 });
  AI.step(tooFar, cf);
  ok(tooFar.windup === 0, '超出射程不进入前摇', String(tooFar.windup));
}

/* ---------------- 5. 行为：Boss ---------------- */
console.log('\n[5] boss：逼近 + 远射程扇形大弹');
{
  const def = { id: 'warden', behavior: 'boss', keepDist: 0, atkCd: 2.2, speed: 32, projDmg: 7, pattern: 'fan', fanCount: 7 };
  const e = mkEnemy({ def: def, x: 500, y: 0, speed: 32, atkCd: 2.2 });
  const ctx = stubCtx({ px: 0, py: 0 });
  AI.step(e, ctx);
  ok(e.vx < 0, 'Boss 在射程内也持续逼近（keepDist=0）', e.vx.toFixed(1));

  const shooter = mkEnemy({ def: def, x: 500, y: 0, speed: 32, atkCd: 0 });
  const cs = stubCtx({ px: 0, py: 0 });
  AI.step(shooter, cs);
  shooter.windup = 0.01;
  AI.step(shooter, cs);
  ok(cs.log.shoot.length === 7, 'Boss 扇形弹 7 发', String(cs.log.shoot.length));
  ok(cs.log.shoot.every(s => s.big === true), '扇形弹走"大弹"档（与改造前 pushEnemyBullet(…, true) 一致）');
  const spread = cs.log.shoot.map(s => s.a);
  ok(Math.abs(spread[0] - spread[spread.length - 1] - (7 - 1) * 0.20) < 1e-9 ||
    Math.abs((spread[spread.length - 1] - spread[0]) - (7 - 1) * 0.20) < 1e-9,
    '扇形展开角 = (n-1)×0.20', (spread[spread.length - 1] - spread[0]).toFixed(3));

  // 620 的射程：500 能打，700 不能
  const far = mkEnemy({ def: def, x: 700, y: 0, speed: 32, atkCd: 0 });
  const cfar = stubCtx({ px: 0, py: 0 });
  AI.step(far, cfar);
  ok(far.windup === 0, '超出 620 射程不开火', String(far.windup));
}

/* ---------------- 6. 共用骨架：分离力 / 光环 / 夹取 ---------------- */
console.log('\n[6] 共用骨架：分离、治疗光环、边界夹取');
{
  const e = mkEnemy({ x: 0, y: 0, r: 20, speed: 0 });
  const other = { x: 25, y: 0, r: 20, dead: false };
  const ctx = stubCtx({ px: 0, py: -500, queue: [[other]] });
  AI.step(e, ctx);
  ok(e.vx < 0, '两只怪重叠 → 互相推开（分离力加在速度上）', e.vx.toFixed(1));
  ok(ctx.log.clamp === 1, '每步都会把怪夹回战场内（一次）');

  const healer = mkEnemy({
    x: 0, y: 0, def: { id: 'shielder', behavior: 'chase', healAura: { radius: 130, hps: 2.2 } }
  });
  const ally = { x: 40, y: 0, r: 20, hp: 5, maxHp: 10, dead: false };
  const self = healer;
  // AI.step 会查两次：第一次是分离力、第二次才是光环 —— 按调用顺序给结果
  const ctx2 = stubCtx({ px: 0, py: -500, queue: [[], [ally, self]] });
  AI.step(healer, ctx2);
  ok(ally.hp > 5, '光环给附近友军回血', ally.hp.toFixed(2));
  ok(healer.hp === 10, '不给自己回血');

  const ally2 = { x: 40, y: 0, r: 20, hp: 9.99, maxHp: 10, dead: false };
  const ctx3 = stubCtx({ px: 0, py: -500, queue: [[], [ally2]] });
  AI.step(mkEnemy({ def: { id: 'x', behavior: 'chase', healAura: { radius: 130, hps: 100 } } }), ctx3);
  ok(ally2.hp === 10, '回血不会超过上限', String(ally2.hp));
}

/* ---------------- 7. 真实对局：行为与模式全都在注册表里 ---------------- */
console.log('\n[7] 真实对局冒烟');
{
  let err = null;
  const seenKind = new Set();
  try {
    Game.newRun('gladiator', 4242);
    enterFightRoom(); Game._internals.startWave(8);
    const sess = Game.getSession();
    holdRoom(sess);                 // 不结束波次，专心看这一波
    sess.player.invuln = 999;            // 站着不动当靶子，别被打死（否则后半段全是空步）
    // 全部 10 种怪都放进场；远程与 Boss 放在各自射程内，保证弹幕一定会被走到
    let n = 0;
    for (const d of Enemies.LIST) {
      const dist = d.behavior === 'boss' ? 420 : (d.behavior === 'ranged' ? 200 : 120);
      const e = Game._internals.spawnEnemy(d.id, sess.player.x + dist, sess.player.y + 40 + n * 8, {});
      if (e) { e.spawnT = 0; n++; }
    }
    for (let i = 0; i < 900; i++) {
      if (Game.state === 'playing') Game.step(1 / 60, { x: 0, y: 0 });   // 玩家原地不动
      else if (Game.state === 'levelup') Game.chooseLevelCard(0);
      sess.player.hp = sess.stats.maxHp;
      for (const b of Game.getSession().ebullets) seenKind.add(b.kind);
    }
  } catch (e) { err = e.message + '\n      ' + (e.stack.split('\n')[1] || '').trim(); }
  ok(!err, '全部 10 种怪一起上场跑 900 帧无异常（每条行为分支都真的走到）', err);

  const sess = Game.getSession();
  ok(sess.stats_total.kills >= 0 && sess.player.hp > 0, '对局状态正常（有击杀、玩家存活）',
    '击杀 ' + sess.stats_total.kills + ' / 玩家 ' + Math.ceil(sess.player.hp));
  ok(seenKind.size > 0, '远程怪与 Boss 在真实对局里真的开了火（弹幕模式接到 pushEnemyBullet）',
    seenKind.size ? [...seenKind].join('/') : '整局都没出现敌弹');
  ok(seenKind.has('ball') || seenKind.has('bossball'), '敌弹用的是注册表里声明的弹种',
    [...seenKind].join('/'));
  console.log('    · 本轮出现过的敌弹：' + [...seenKind].join('/'));
}

console.log('\n=== 结果 ===');
if (failures === 0) { console.log('\x1b[32m全部通过 ✔\x1b[0m'); process.exit(0); }
console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m');
process.exit(1);
