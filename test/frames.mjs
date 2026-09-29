/* =========================================================
   frames.mjs — 碰撞体与帧模型无头校验
   1) 碰撞体：圆 / 扫掠线段的数学（含退化输入）
   2) 穿透回归：离散落点判定会漏掉的高速擦边，扫掠必须命中
      （实测老实现：railgun 对 grub 有 5.6px 宽的穿透带，d ∈ [28.5, 33]）
   3) 帧模型：逻辑帧步长只有一份来源；显示帧 alpha 插值落在两次逻辑帧之间
   用法： node test/frames.mjs
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { installDom, makeProbeCtx } from './_ctx.mjs';
import { loadAll, RENDER_MODULES } from './_load.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
installDom();
const g = globalThis;

let failures = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  \x1b[32mPASS\x1b[0m ' + label);
  else { failures++; console.log('  \x1b[31mFAIL\x1b[0m ' + label + (extra !== undefined ? '  → ' + extra : '')); }
}

console.log('\n=== Bronana · 碰撞体与帧模型无头校验 ===\n');

console.log('[1] 加载');
let loadErr = null;
try { await loadAll(RENDER_MODULES); } catch (e) { loadErr = e.message; }
if (loadErr) { console.log('  \x1b[31mFAIL\x1b[0m 加载失败 → ' + loadErr); process.exit(1); }
ok(true, '全部模块以 ES 模块方式加载成功');

const { Col, Game, Comp, Enemies, R, S } = g;
const FIXED = Game.cfg.fixedDt;

/* =========================================================
   1. 碰撞体数学
   ========================================================= */
console.log('\n[2] 碰撞体：圆与扫掠线段');
{
  ok(Col.circle(0, 0, 5, 9, 0, 5), '两圆相切算重叠');
  ok(!Col.circle(0, 0, 5, 11, 0, 5), '分开的圆不算重叠');
  ok(Col.point(0, 0, 3, 4, 5), '点在圆上算命中');
  ok(!Col.point(0, 0, 3, 4.1, 5), '点在圆外不算命中');

  // 线段横穿圆：圆心 (10,0)、r=5，线段 (0,0)→(20,0) → 首次接触 t=0.25
  const t = Col.segCircle(0, 0, 20, 0, 10, 0, 5);
  ok(Math.abs(t - 0.25) < 1e-12, '线段横穿：首次接触的 t 正确', String(t));
  ok(Col.segCircle(0, 0, 20, 0, 10, 40, 5) === -1, '线段不碰圆返回 -1');
  ok(Col.segCircle(0, 0, 20, 0, 5, 0, 5) === 0, '起点已在圆内返回 0（"已经重叠"，不是"这一步碰到"）');
  ok(Col.segCircle(-10, 0, 10, 0, 0, 0, 1) >= 0, '两端都在圆外但穿过圆 → 命中（正是落点法漏掉的情形）');
  ok(Col.segCircle(0, 0, 0, 0, 1, 0, 5) >= 0, '长度 0 的线段按点处理（圆内）');
  ok(Col.segCircle(0, 0, 0, 0, 100, 0, 5) === -1, '长度 0 的线段按点处理（圆外）');
  ok(Col.segCircle(-20, 5, 20, 5, 0, 0, 5) >= 0, '擦着切线过去也算接触（浮点边界不漏判）');

  const box = Col.segBounds(0, 0, 10, 0, 3, {});
  ok(Math.abs(box.x - 5) < 1e-12 && Math.abs(box.y) < 1e-12 && Math.abs(box.r - 8) < 1e-12,
    'segBounds 给出覆盖线段的包围圆', JSON.stringify(box));
}

/* =========================================================
   2. 穿透回归
   ========================================================= */
console.log('\n[3] 穿透回归：高速弹的擦边命中');
{
  const sess = Game.newRun('ranger', 999);
  const p = sess.player;
  /* 这一节自己手工摆子弹与怪，不需要刷怪队列 —— 但房间制下"场上清空"就等于打完
     这一间（清空即过），第一次 step 就会把状态推进商店，后面的扫掠判定全成空转。
     所以钉住这一间。 */
  holdRoom(sess);

  /** 一颗子弹从 x0 向右飞，怪放在横向偏移 d 处（d 就是最近距离） */
  function shot(speed, d, bulletR, enemyR) {
    sess.enemies.length = 0;
    sess.bullets.length = 0;
    const e = Game._internals.spawnEnemy('grub', 0, 0, {});
    e.r = enemyR; e.hp = e.maxHp = 1e9; e.spawnT = 0;
    const stepLen = speed * FIXED;
    const x0 = p.x - stepLen / 2 - 200;
    e.x = x0 + stepLen / 2; e.y = p.y + d;
    sess.bullets.push(Comp.spawn('bullet', {
      x: x0, y: p.y, vx: speed, vy: 0, r: bulletR,
      dmg: 1, pierce: 0, hitSet: null, life: 1, lifeMax: 1,
      color: '#fff', dark: '#000', kind: 'laser', element: 'laser',
      knock: 0, blast: 0, crit: false, bigCrit: false, fromX: x0, fromY: p.y
    }));
    const hp0 = e.hp;
    Game.step(FIXED, { x: 0, y: 0 });
    return e.hp < hp0;
  }

  const pad = 6, bulletR = 5;
  const cases = [
    ['railgun 对 grub(r22)', 2200, 22, 28.5, 33],
    ['railgun 对小怪(r15.4)', 2200, 15.4, 20, 26.4],
    ['railgun 对更小的怪(r12)', 2200, 12, 15.5, 23]
  ];
  let bad = '';
  for (const [name, speed, er, missFrom, thr] of cases) {
    // 老实现的穿透带 [missFrom, 阈值] 内必须全部命中
    let bandOk = true, failedAt = -1;
    for (let d = Math.ceil(missFrom); d <= thr; d += 0.5) {
      if (!shot(speed, d, bulletR, er)) { bandOk = false; if (failedAt < 0) failedAt = d; }
    }
    // 阈值之外必须不命中（扫掠不能把碰撞体撑大）
    let outsideOk = true, outsideAt = -1;
    for (let d = thr + 2; d <= thr + 12; d += 2) {
      if (shot(speed, d, bulletR, er)) { outsideOk = false; if (outsideAt < 0) outsideAt = d; }
    }
    if (!bandOk || !outsideOk) {
      bad += name + ': ' + (bandOk ? '' : '带内漏判@' + failedAt + ' ') + (outsideOk ? '' : '阈值外误判@' + outsideAt) + ' | ';
    }
    console.log('    ' + name.padEnd(22) + ' 阈值 ' + (bulletR + pad + er).toFixed(1) + 'px' +
      '  老穿透带 [' + missFrom + ', ' + thr + '] 全部命中=' + bandOk + '  阈值外不误判=' + outsideOk);
  }
  ok(bad === '', '高速弹的擦边穿透带已被扫掠判定补齐，且碰撞体没有变大', bad);
  ok(shot(2200, 0, bulletR, 22), '正对命中仍然命中');
  ok(!shot(2200, 60, bulletR, 22), '远距离偏移仍然不命中');

  // 穿透（pierce）按接触点先后结算
  sess.enemies.length = 0; sess.bullets.length = 0;
  const near = Game._internals.spawnEnemy('grub', p.x + 60, p.y, {});
  const far = Game._internals.spawnEnemy('grub', p.x + 120, p.y, {});
  near.r = far.r = 22; near.spawnT = far.spawnT = 0;
  near.hp = near.maxHp = 1e9; far.hp = far.maxHp = 1e9;
  const x0 = p.x + 20;
  const pb = Comp.spawn('bullet', {
    x: x0, y: p.y, vx: 2200, vy: 0, r: 5,
    dmg: 1, pierce: 1, hitSet: [], life: 1, lifeMax: 1,
    color: '#fff', dark: '#000', kind: 'laser', element: 'laser',
    knock: 0, blast: 0, crit: false, bigCrit: false, fromX: x0, fromY: p.y
  });
  sess.bullets.push(pb);
  Game.step(FIXED, { x: 0, y: 0 });
  ok(pb.hitSet && pb.hitSet[0] === near, '穿透弹先结算更近的那只（按接触点 t 升序）');
  ok(near.hp < 1e9 && far.hp === 1e9, 'pierce=1 只打穿一只');

  // 敌弹对玩家同样走扫掠
  sess.enemies.length = 0; sess.ebullets.length = 0;
  p.invuln = 0;
  const hpBefore = p.hp;
  sess.ebullets.push(Comp.spawn('ebullet', {
    x: p.x - 300, y: p.y, vx: 300, vy: 0, r: 6, dmg: 3, color: '#f00', life: 3, kind: 'shot'
  }));
  let hitAt = -1;
  for (let i = 0; i < 120 && hitAt < 0; i++) {
    sess.enemies.length = 0;                 // 只留下这颗敌弹作为伤害来源
    Game.step(FIXED, { x: 0, y: 0 });
    if (p.hp < hpBefore) hitAt = i;
  }
  ok(hitAt >= 0, '敌弹扫掠判定命中玩家（阈值与老实现一致：b.r + p.r - 4）', '第 ' + hitAt + ' 步');
}

/* =========================================================
   3. 帧模型
   ========================================================= */
console.log('\n[4] 帧模型：逻辑帧步长只有一份来源');
{
  ok(Math.abs(Game.cfg.fixedDt - 1 / 60) < 1e-12,
    '逻辑帧步长 = 1/60（Game.cfg.fixedDt）', String(Game.cfg.fixedDt));
  ok(Game.cfg.maxSteps >= 1 && Game.cfg.maxFrameDt > 0, '补帧上限与单帧 dt 上限都有定义');

  const read = f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
  const main = read('main.ts');
  const hard = /var\s+FIXED\s*=\s*1\s*\/\s*60|dt\s*>\s*0\.25|maxSteps\s*=\s*6/.test(main);
  ok(!hard, 'main.ts 不再自己写死 1/60 / 0.25 / 6（都取自 Game.cfg）', hard ? '仍有硬编码' : '');
  const suites = ['smoke.mjs', 'states.mjs', 'signals.mjs', 'particles.mjs', 'packs.mjs',
    'render-check.mjs', 'ui-check.mjs', 'perf.mjs', 'rig.mjs', 'comp.mjs'];
  const testHard = suites.filter(f => /const\s+FIXED\s*=\s*1\s*\/\s*60/.test(fs.readFileSync(path.join(ROOT, 'test', f), 'utf8')));
  ok(testHard.length === 0, '测试也不再各自写死 1/60（统一取 Game.cfg.fixedDt）', testHard.join(', '));
}

console.log('\n[5] 显示帧插值（逻辑帧 60Hz，显示帧可以更快）');
{
  ok(R.alpha === 1, 'alpha 缺省为 1 = 直接画当前逻辑帧（不设 alpha 的调用方行为不变）', String(R.alpha));
  R.alpha = 0;   ok(R.lerpPos(100, 110) === 100, 'alpha=0 画上一逻辑帧的位置');
  R.alpha = 1;   ok(R.lerpPos(100, 110) === 110, 'alpha=1 画当前逻辑帧的位置');
  R.alpha = 0.5; ok(Math.abs(R.lerpPos(100, 110) - 105) < 1e-12, 'alpha=0.5 取两帧中点');
  ok(Math.abs(R.posOffset(100, 110) + 5) < 1e-12, 'posOffset 与 lerpPos 自洽（x + off = 插值位置）');
  R.alpha = 1;

  const sess = Game.newRun('ranger', 4242);
  const p = sess.player;
  sess.enemies.length = 0;
  const e = Game._internals.spawnEnemy('grub', p.x + 300, p.y, {});
  e.spawnT = 0; e.speed = 120;

  // 渲染层就是按这个偏移调 S.drawEnemy 的（同一份算式）
  function drawn(alpha) {
    R.alpha = alpha;
    const ctx = makeProbeCtx();
    S.drawEnemy(ctx, e, 1, R.posOffset(e.px, e.x), R.posOffset(e.py, e.y));
    const img = ctx.images[ctx.images.length - 1];
    return img.m[4];        // drawImage 时的 CTM 平移 x = 画在哪
  }

  const before = e.x;
  Game.step(FIXED, { x: 0, y: 0 });
  const moved = e.x - before;
  ok(Math.abs(moved) > 0.5, '怪确实在这一逻辑帧里移动了 ' + moved.toFixed(2) + 'px');
  ok(e.px === before, '逻辑帧开头记下了上一帧位置（px = 积分前的位置）',
    'px=' + e.px.toFixed(3) + ' 期望 ' + before.toFixed(3));

  const at0 = drawn(0), at5 = drawn(0.5), at1 = drawn(1);
  R.alpha = 1;
  ok(Math.abs(at0 - e.px) < 1e-6, 'alpha=0：画在上一逻辑帧的位置', at0.toFixed(3) + ' vs ' + e.px.toFixed(3));
  ok(Math.abs(at1 - e.x) < 1e-6, 'alpha=1：画在当前逻辑帧的位置', at1.toFixed(3) + ' vs ' + e.x.toFixed(3));
  ok(Math.abs(at5 - (e.px + e.x) / 2) < 1e-6, 'alpha=0.5：画在两次逻辑帧正中间（插值真的生效）',
    at5.toFixed(3) + ' vs ' + ((e.px + e.x) / 2).toFixed(3));
  // 单调（方向无所谓：怪是朝玩家走的，可能向左也可能向右）
  ok((at0 - at5) * (at5 - at1) > 0 && at5 !== at0 && at5 !== at1,
    '插值位置单调落在一逻辑帧的位移上（不会回跳）');

  // 渲染层确实把插值接上了（静态检查，防止只有测试代码在用它）
  const renderSrc = fs.readFileSync(path.join(ROOT, 'src', 'render.ts'), 'utf8');
  ok(/R\.posOffset\(b\.px/.test(renderSrc) && /R\.lerpPos\(e\.px/.test(renderSrc) &&
    /R\.lerpPos\(p\.px/.test(renderSrc),
    'render.ts 对玩家 / 怪 / 子弹都用了 px/py 求插值位置');

  // 刚出生的对象不能从 (0,0) 被拉过来
  const fresh = Comp.spawn('bullet', { x: 555, y: 666, vx: 0, vy: 0, r: 5, kind: 'shot', life: 1, lifeMax: 1, color: '#fff' });
  ok(fresh.px === 555 && fresh.py === 666, '新生成的实体 px/py 与 x/y 对齐（不会从 (0,0) 插值过来）',
    fresh.px + ',' + fresh.py);
  const fe = Comp.spawn('enemy', { x: 100, y: 200, def: Enemies.BY_ID.grub });
  ok(fe.px === 100 && fe.py === 200, '怪出生时同样对齐');
}

console.log('\n[6] 与整帧渲染的集成');
{
  const sess = Game.newRun('gladiator', 777);
  const p = sess.player;
  for (let i = 0; i < 600; i++) {
    if (Game.state === 'playing') {
      p.hp = sess.stats.maxHp;
      sess.enemies.length = 0;
      Game._internals.spawnEnemy('grub', p.x + 80, p.y, {});
      Game.step(FIXED, Game.autoInput(i / 60));
    } else if (Game.state === 'levelup') Game.chooseLevelCard(0);
    else if (Game.state === 'shop') Game.nextWave();
  }

  const ctx = makeProbeCtx();
  const canvas = {
    width: 1280, height: 720, style: {}, addEventListener() {},
    getContext: () => ctx
  };
  R.init(canvas);
  let err = null;
  for (const alpha of [0, 0.37, 1]) {
    R.alpha = alpha;
    try { R.draw(FIXED); R.tick(FIXED); } catch (e2) { err = 'alpha=' + alpha + ': ' + e2.message; break; }
  }
  ok(err === null, 'alpha 取 0 / 0.37 / 1 时整帧渲染都不抛异常', err);
  ok(ctx.badArgs.length === 0, '渲染参数里没有 NaN / 无穷', ctx.badArgs.slice(0, 3).join(' | '));
  ok(ctx._st.stack.length === 0, 'save / restore 严格配对（帧末栈深为 0）', String(ctx._st.stack.length));
  R.alpha = 1;

  // ?test=demo 的密集团战现场：容器最杂的那个场景也必须画得出来
  // （老实现里它手写的贴花字面量缺 7 个形状字段 → 这一帧有 14 次 NaN canvas 参数）
  const demo = g.Demo.stage('gladiator', 8);
  g.Demo.scene(demo.sess);
  const ctx2 = makeProbeCtx();
  R.init({ width: 1280, height: 720, style: {}, addEventListener() {}, getContext: () => ctx2 });
  R.alpha = 1;
  let err2 = null;
  try { R.draw(FIXED); } catch (e3) { err2 = e3.message; }
  ok(err2 === null, '?test=demo 场景整帧渲染不抛异常', err2);
  ok(ctx2.badArgs.length === 0,
    '?test=demo 场景渲染零 NaN 参数（含 16 个贴花、22 个掉落、14 只怪 + Boss）',
    ctx2.badArgs.length + ' 次：' + ctx2.badArgs.slice(0, 3).join(' | '));
}

console.log('\n=== 结果 ===');
if (failures === 0) console.log('\x1b[32m全部通过 ✔\x1b[0m');
else console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m');
process.exit(failures ? 1 : 0);
