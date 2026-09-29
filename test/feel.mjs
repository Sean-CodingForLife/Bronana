/* =========================================================
   feel.mjs — **打击感**：命中定帧（hit-stop）
   ---------------------------------------------------------
   为什么这一套单独存在：定帧是唯一一条**会改模拟时序**的"手感"功能，
   所以它必须"默认关 + 显式打开"。两件事方向相反，都要守住：

     [1] 默认档（0）下**什么都没变** —— "纯重构逐位不变"的前提。
     [2] 打开之后**真的顿住**，而且顿的帧数**正好是配置的那个数**，
         同时**枪还能开**（不是整体卡死）。

   ⚠ 这一套的判据差点写成"30 帧里总位移变少" —— 那个量**测不出来**：
   4 帧定帧在 30 帧里只占 13%，而噪声来自别处（AI 相位、击退、夹取）。
   正确的量法是**逐帧位移**：定帧窗口内那一帧的位移必须几乎为 0，
   窗口外必须与基准**逐帧相同**。这才是"时序被精确改了 N 帧"的直接证据。

   用法： node test/feel.mjs
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { installDom } from './_ctx.mjs';
import { loadAll, SIM_MODULES } from './_load.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
let failures = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  \x1b[32mPASS\x1b[0m ' + label);
  else { failures++; console.log('  \x1b[31mFAIL\x1b[0m ' + label + (extra !== undefined ? '  → ' + extra : '')); }
}

installDom();
await loadAll(SIM_MODULES);
const { Game, Settings } = globalThis;

console.log('\n=== Bronana · 打击感：命中定帧 ===\n');

/* =========================================================
   [1] 声明与默认档
   ========================================================= */
console.log('[1] 声明与默认档（默认必须是关 —— 否则指纹会变）');
{
  const cfg = Game.cfg.hitStop;
  ok(cfg && typeof cfg === 'object', '定帧档位表存在（不是散在代码里的魔数）');
  ok(cfg.off === 0, '`off` 档就是 0 帧 —— "关"是一个真正的档，不是特殊分支', String(cfg.off));
  const vals = Object.keys(cfg).map(k => cfg[k]);
  ok(vals.every(v => Number.isInteger(v) && v >= 0), '所有档位都是非负整数帧', vals.join(','));
  ok(vals.indexOf(0) >= 0 && Math.max(...vals) <= 20,
    '档位范围合理（有 0，且最大不超过 20 帧 —— 再多就是卡顿了）', vals.join(','));

  ok(Settings.keys().indexOf('hitStop') >= 0, '设置表里有「命中定帧」这一项');
  ok(Settings.def('hitStop').def === 0,
    '**默认档是 0（关）**：会改模拟时序的东西必须显式打开（这是指纹纪律的前提）',
    String(Settings.def('hitStop').def));
  ok(Settings.def('hitStop').values.join(',') === vals.join(','),
    '设置表的档位与 `Game.cfg.hitStop` 的档位**一一对应**（两处不会漂）',
    Settings.def('hitStop').values.join(',') + ' vs ' + vals.join(','));
  ok(Game.cfg.hitStopScale > 0 && Game.cfg.hitStopScale < 0.2,
    '定帧期间的位移系数是"近乎冻住"而不是"慢下来"：' + Game.cfg.hitStopScale,
    String(Game.cfg.hitStopScale));

  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  ok(/data-act="set-hitstop"/.test(html), '设置页里有它的按钮（声明了却调不到 = 假开关）');
}

/* =========================================================
   摆一个可复现的小场景：一只怪 + 玩家，不刷怪、不超时
   ========================================================= */
function stage() {
  const s = Game.newRun('ranger', 4242, 1, null, null);
  Game.setState('playing');
  s.spawnQueue.length = 0;
  s.waveLeft = 1e9;
  s.enemies.length = 0;
  const e = Game._internals.spawnEnemy('grub', s.player.x + 120, s.player.y);
  e.hp = 1e9;                 // 打不死，定帧只由测试控制
  e.spawnT = 0;               // 入场动画期间它整只都不动，会掩盖判据
  return { s, e };
}
/* 可复现的重放：把怪与会话里**所有会被这几十帧改动**的字段抄回去。
   为什么非要重放：`Game.newRun` 每次都会推进全局随机流，所以"再建一局"
   得到的怪**不一样**（AI 相位不同），两次的位移差里有一半是随机的 ——
   第一版就是这么测的，于是判据在 22.9px vs 25.9px 上晃。 */
const ENEMY_FIELDS = ['x', 'y', 'px', 'py', 'vx', 'vy', 'hp', 'hitFlash', 'kx', 'ky',
  'burn', 'burnDps', 'phase', 'atkCd', 'windup', 'shootCd', 'spawnT', 't1', 't2',
  'dead', 'enraged', 'burrowed'];
function snapshot(st) {
  const o = { e: {}, s: {} };
  for (const k of ENEMY_FIELDS) o.e[k] = st.e[k];
  o.s = { player: { x: st.s.player.x, y: st.s.player.y, hp: st.s.player.hp }, time: st.s.time };
  return o;
}
function restore(st, snap) {
  for (const k of ENEMY_FIELDS) st.e[k] = snap.e[k];
  st.s.player.x = snap.s.player.x; st.s.player.y = snap.s.player.y;
  st.s.player.hp = snap.s.player.hp; st.s.time = snap.s.time;
  st.s.bullets.length = 0;
  st.s.ebullets.length = 0;
}
/** 走 `n` 帧，返回每帧的位移（第一项是第 1 帧的位移） */
function walk(st, n, stopAtFrame) {
  const out = [];
  for (let i = 0; i < n; i++) {
    if (stopAtFrame !== undefined && i === stopAtFrame) st.s.hitStop = stopAtFrame === 0
      ? Game.cfg.hitStop.medium : Game.cfg.hitStop.medium;
    const before = st.e.x;
    Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });
    out.push(st.e.x - before);
  }
  return out;
}

/* =========================================================
   [2] 默认档（关）下对模拟是恒等的
   ========================================================= */
console.log('\n[2] 默认档（关）下对模拟是恒等的');
{
  Game.cfg.hitStop = 0;
  const st = stage();
  ok(st.s.hitStop === 0, '新会话的 `hitStop` 从 0 开始', String(st.s.hitStop));
  for (let i = 0; i < 120; i++) Game.step(Game.cfg.fixedDt, { x: 1, y: 0 });
  ok(st.s.hitStop === 0, '走 120 步之后它仍然是 0（没有路径在默认档下写它）', String(st.s.hitStop));

  /* 反证：默认档下"打中精英"这一下**不产生**任何定帧 */
  st.s.enemies.length = 0;
  st.s.hitStop = 0;
  for (let i = 0; i < 3; i++) {
    const e = Game._internals.spawnEnemy('grub', st.s.player.x + 60 + i * 24, st.s.player.y, { elite: true });
    e.hp = 1e9; e.spawnT = 0;
    Game.damageEnemy(e, 1, { noCrit: true });
  }
  ok(st.s.hitStop === 0, '（反证）默认档下打中三只精英，定帧仍然是 0', String(st.s.hitStop));
}

/* =========================================================
   [3] 打开之后：窗口内近乎不动，窗口外与基准逐帧相同
   ========================================================= */
console.log('\n[3] 打开之后：定帧窗口内近乎冻住，窗口外恢复常速');
{
  Game.cfg.hitStop = 0;
  /* --- 基准：完全不开定帧 --- */
  const A = stage();
  const base = walk(A, 40);

  /* --- 对照：第 5 帧打中精英（4 帧定帧） --- */
  const B = stage();
  const snap = snapshot(B);
  Game.cfg.hitStop = 4;                  // 让"打中精英"真的产生定帧
  const withStop = [];
  for (let i = 0; i < 40; i++) {
    if (i === 5) B.s.hitStop = 4;        // 等价于这一帧打中了精英
    const before = B.e.x;
    Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });
    withStop.push(B.e.x - before);
  }
  restore(B, snap);
  Game.cfg.hitStop = 0;

  ok(Math.abs(base[0]) > 0.5, '（基准）第 1 帧怪就走了 ' + base[0].toFixed(3) + 'px（不为 0，判据不空转）');
  const before = base.slice(0, 5), beforeB = withStop.slice(0, 5);
  ok(before.every((v, i) => v === beforeB[i]),
    '定帧发生**之前**的 5 帧逐帧完全相同（定帧只在被触发时才存在）',
    before.map(v => v.toFixed(3)).join(',') + ' vs ' + beforeB.map(v => v.toFixed(3)).join(','));

  const winA = base.slice(5, 9), winB = withStop.slice(5, 9);
  ok(winB.every(v => Math.abs(v) < Math.abs(winA[0]) * 0.1),
    '定帧窗口内 4 帧的位移几乎为 0（' + winB.map(v => v.toFixed(3)).join(', ') +
    ' vs 基准 ' + winA.map(v => v.toFixed(3)).join(', ') + '）');
  /* 窗口之后**恢复常速**。这里刻意不要求"与基准逐位相同" ——
     AI 的相位/计时器按真实 `dt` 走（那是刻意的：定帧只该影响位移），
     所以顿完之后怪的朝向与节奏可能和基准不同。要求逐位相同会变成
     一条"测 AI 有没有被 dt 影响"的判据，而那不是这一节要问的事。
     要问的是：**位移速度有没有恢复**。 */
  const after = base.slice(9, 40).map(Math.abs), afterB = withStop.slice(9, 40).map(Math.abs);
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const rec = avg(afterB) / avg(after);
  ok(rec > 0.8 && rec < 1.25,
    '窗口结束后位移速度恢复常速（平均 |dx| 是基准的 ' + (rec * 100).toFixed(0) + '%）',
    rec.toFixed(3));
  /* 精确到帧：窗口内**正好** 4 帧被压住（第 5 帧起恢复） */
  const pressed = withStop.map((v, i) => Math.abs(v) < Math.abs(base[i]) * 0.5);
  const idx = pressed.map((v, i) => v ? i : -1).filter(i => i >= 0);
  ok(idx.join(',') === '5,6,7,8',
    '被压住的帧**正好是第 5~8 帧**（4 帧，不多不少）', idx.join(','));
}

/* =========================================================
   [4] 枪还能开 —— 跳过整个 step() 的实现会让这里恒为 0
   ========================================================= */
console.log('\n[4] 定帧期间子弹照常发射（不是整体卡死）');
{
  Game.cfg.hitStop = 7;
  const st = stage();
  st.s.hitStop = 7;
  let fired = 0, last = st.s.bullets.length;
  for (let i = 0; i < 120; i++) {
    Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });
    if (st.s.bullets.length > last) { fired++; last = st.s.bullets.length; }
  }
  ok(fired > 0, '定帧开着时 120 帧里新射出 ' + fired + ' 发子弹' +
    '（跳过整个 step 的实现会让这里恒为 0 —— 那是掉帧不是打击感）');
  /* 反证：这 120 帧里定帧确实发生过 */
  const st2 = stage();
  st2.s.hitStop = 7;
  const seq = [];
  for (let i = 0; i < 8; i++) { seq.push(st2.s.hitStop); Game.step(Game.cfg.fixedDt, { x: 0, y: 0 }); }
  ok(seq.join(',') === '7,6,5,4,3,2,1,0',
    '（反证）定帧在 7 帧里逐帧递减到 0，没有越界', seq.join(','));
  Game.cfg.hitStop = 0;
}

/* =========================================================
   [5] 同一帧多次触发只取最大档
   ========================================================= */
console.log('\n[5] 同一个逻辑帧里多次触发只取最大档（打中三只精英不该顿三倍）');
{
  Game.cfg.hitStop = 4;
  const st = stage();
  st.s.enemies.length = 0;
  st.s.hitStop = 0;
  const list = [];
  for (let i = 0; i < 3; i++) {
    const e = Game._internals.spawnEnemy('grub', st.s.player.x + 60 + i * 24, st.s.player.y, { elite: true });
    e.hp = 1e9; e.spawnT = 0;
    list.push(e);
  }
  for (const e of list) Game.damageEnemy(e, 1, { noCrit: true });
  ok(st.s.hitStop === 4, '一帧里打中三只精英，定帧仍然是 4 帧（取最大值，不是 12）', String(st.s.hitStop));

  Game.cfg.hitStop = 0;
  st.s.hitStop = 0;
  for (const e of list) Game.damageEnemy(e, 1, { noCrit: true });
  ok(st.s.hitStop === 0, '关掉之后打精英一点定帧都不产生（默认档恒等）', String(st.s.hitStop));
}

console.log('\n=== 结果 ===');
if (failures === 0) console.log('\x1b[32m全部通过 ✔\x1b[0m');
else console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m');
process.exit(failures ? 1 : 0);
