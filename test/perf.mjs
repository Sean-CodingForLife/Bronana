/* =========================================================
   perf.ts — 性能基准（模拟层）
   在 Node 中测量每帧模拟耗时，判断能否稳定吃下 60fps 的 16.6ms 预算。
   渲染层的对应指标是"每帧绘制调用数"，见 render-check.ts。
   用法： node test/perf.mjs
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { loadAll, SIM_MODULES, RENDER_MODULES, UI_MODULES } from './_load.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
let failures = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  \x1b[32mPASS\x1b[0m ' + label);
  else { failures++; console.log('  \x1b[31mFAIL\x1b[0m ' + label + (extra !== undefined ? '  → ' + extra : '')); }
}

await loadAll(SIM_MODULES);

const { Game, Weapons, Items, Enemies, Arena, Stats } = globalThis;
const FIXED = Game.cfg.fixedDt;
const BUDGET_MS = 16.6;

console.log('\n=== Bronana · 性能基准（模拟层） ===\n');

/* ---------------- 工具 ---------------- */
function buildLoadout(ids) {
  const s = Game.getSession();
  s.player.weapons.length = 0;
  ids.forEach(id => Game.addWeapon(id));
  Items.LIST.slice(0, 6).forEach(it => s.player.items.push({ def: it }));
  Game.recalcStats();
  return s;
}

function spawnAtEdge(defId) {
  const s = Game.getSession();
  const edge = Math.floor(Math.random() * 4);
  const pad = Arena.PAD + 40;
  let x, y;
  if (edge === 0) { x = pad + Math.random() * (Arena.W - pad * 2); y = pad; }
  else if (edge === 1) { x = Arena.W - pad; y = pad + Math.random() * (Arena.H - pad * 2); }
  else if (edge === 2) { x = pad + Math.random() * (Arena.W - pad * 2); y = Arena.H - pad; }
  else { x = pad; y = pad + Math.random() * (Arena.H - pad * 2); }
  return Game._internals.spawnEnemy(defId, x, y, {});
}

/**
 * 跑一段模拟并统计每步耗时。
 *
 * 这台机器是共享的（实测同一份代码三轮跑出 0.186 / 0.245 / 0.288ms，
 * 还出现过 37.97ms 的单步尖峰 —— 同时有别的进程在抢 CPU）。
 * 因此：**每一轮都重建同样的场景**（否则轮间不可比），三轮全量测量，
 * 报告全部三轮，断言取**最好的一轮**。
 *
 * 为什么断言取最好的而不是平均：被测的是"这份代码跑一步要多久"，
 * 别的进程抢走的时间不属于这份代码；取最小值是"这台机器能给的最好条件"，
 * 它只会被真实的性能回归抬高，不会被噪声抬高。轮间抖动另外单独断言 ——
 * 抖动爆掉说明这次测量本身不可信（而不是代码慢）。
 */
function bench(name, steps, opts) {
  opts = opts || {};
  const reps = opts.reps || 3;

  function runOnce() {
    const s = Game.getSession();
    const samples = new Float64Array(steps);
    let peak = 0, sumEnemies = 0, realSteps = 0;

    /** 保持游戏停在 playing：升级弹窗会让 step 直接 early-return，
     *  那样测出来的就是一堆空操作（本基准曾因此得出过假数据）。
     *  同时把玩家设为无敌，避免基准中途死亡导致后半段全是空步。 */
    function keepPlaying() {
      let guard = 0;
      while (Game.state !== 'playing' && guard++ < 40) {
        if (Game.state === 'levelup') Game.chooseLevelCard(0);
        else if (Game.state === 'shop') Game.nextWave();
        else break;
      }
      s.player.invuln = 999;         // 免伤：只测负载，不测生死
      holdRoom(s);              // 基准期间不结束波次
    }

    // 预热（让 JIT 编译热点路径）
    for (let i = 0; i < 240; i++) {
      keepPlaying();
      s.player.hp = s.stats.maxHp;
      if (opts.holdEnemies && s.enemies.length < opts.holdEnemies) spawnAtEdge('grub');
      Game.step(FIXED, Game.autoInput(i / 60));
    }

    for (let i = 0; i < steps; i++) {
      keepPlaying();
      s.player.hp = s.stats.maxHp;                       // 保持存活，避免提前结算
      if (opts.holdEnemies && s.enemies.length < opts.holdEnemies) spawnAtEdge('grub');
      const t0 = process.hrtime.bigint();
      Game.step(FIXED, Game.autoInput(i / 60));
      const t1 = process.hrtime.bigint();
      if (Game.state === 'playing') { samples[realSteps] = Number(t1 - t0) / 1e6; realSteps++; }
      if (s.enemies.length > peak) peak = s.enemies.length;
      sumEnemies += s.enemies.length;
    }

    const sorted = Array.from(samples.slice(0, realSteps)).sort((a, b) => a - b);
    const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];
    const max = sorted[sorted.length - 1];
    // 截尾均值：均值会被单次 OS 级停顿（进程被挂起）彻底带偏，
    // 因此预算断言用"去掉最差 1% 后的均值"，离群点单独报出来。
    const keep = Math.max(1, Math.floor(sorted.length * 0.99));
    const trimmedAvg = sorted.slice(0, keep).reduce((a, b) => a + b, 0) / keep;
    const outliers = sorted.filter(v => v > 50);
    return {
      avg, trimmedAvg, p50, p95, p99, max, outliers: outliers.length,
      peak, avgEnemies: sumEnemies / steps, effective: realSteps / steps
    };
  }

  const runs = [];
  for (let r = 0; r < reps; r++) {
    if (opts.setup) opts.setup();       // 每轮重建同样的场景，轮间才可比
    runs.push(runOnce());
  }
  const best = runs.reduce((a, b) => (b.trimmedAvg < a.trimmedAvg ? b : a));
  const worst = runs.reduce((a, b) => (b.trimmedAvg > a.trimmedAvg ? b : a));
  const spread = worst.trimmedAvg / Math.max(1e-9, best.trimmedAvg);

  console.log('  ' + name);
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    console.log('    第 ' + (i + 1) + '/' + reps + ' 轮：截尾均值 ' + r.trimmedAvg.toFixed(3) +
      'ms  中位 ' + r.p50.toFixed(3) + 'ms  P95 ' + r.p95.toFixed(3) +
      'ms  P99 ' + r.p99.toFixed(3) + 'ms  最差 ' + r.max.toFixed(2) + 'ms' +
      (r.outliers ? '（>50ms 离群 ' + r.outliers + ' 个，疑似系统级停顿）' : ''));
  }
  console.log('    取最好一轮：截尾均值 ' + best.trimmedAvg.toFixed(3) + 'ms  中位 ' +
    best.p50.toFixed(3) + 'ms  P95 ' + best.p95.toFixed(3) +
    'ms  | 占 60fps 预算 ' + (best.trimmedAvg / BUDGET_MS * 100).toFixed(1) + '%' +
    '  · 轮间抖动 ' + spread.toFixed(2) + '×');
  console.log('    怪物 平均 ' + best.avgEnemies.toFixed(0) + '/峰值 ' + best.peak +
    ' · 有效步 ' + best.effective.toFixed(3) + '（最好一轮）');

  ok(spread < 6, '三轮之间的抖动在可解释范围内（<6×，更大说明别的进程在抢 CPU，数字不可信）',
    spread.toFixed(2) + '×');

  return Object.assign({}, best, { runs, spread, worstTrimmed: worst.trimmedAvg });
}

/* ---------------- 场景 1：真实 30 秒波次 ---------------- */
console.log('[1] 真实波次（第 10 波，满配 6 武器，自然刷怪）');
function setupNatural() {
  Game.newRun('ranger');
  enterFightRoom(); Game._internals.startWave(10);
  buildLoadout(['minigun', 'sword', 'shotgun', 'flame', 'laser', 'hammer']);
}
const natural = bench('20 秒实战 × 3 轮', 1200, { setup: setupNatural });
ok(natural.trimmedAvg < 2.0, '截尾均值 < 2ms（单个系统停顿不计入）', natural.trimmedAvg.toFixed(3) + 'ms');
ok(natural.p50 < 1.5, '中位步耗时 < 1.5ms', natural.p50.toFixed(3) + 'ms');
ok(natural.p95 < 4.0, 'P95 < 4ms（无卡顿尖峰）', natural.p95.toFixed(3) + 'ms');
ok(natural.effective > 0.95, '基准有效性：≥95% 的步确实在执行模拟', (natural.effective * 100).toFixed(1) + '%');

/* ---------------- 场景 2：压满敌人上限 ---------------- */
console.log('\n[2] 压力场景（强制维持 300 只怪物 = 引擎上限）');
function setupStress() {
  Game.newRun('ranger');
  enterFightRoom(); Game._internals.startWave(15);
  buildLoadout(['minigun', 'minigun', 'flame', 'shotgun', 'laser', 'orb']);
}
const stressed = bench('300 只怪 + 6 武器满负荷 × 3 轮', 600, { holdEnemies: 300, setup: setupStress });
ok(stressed.trimmedAvg < 6.0, '截尾均值 < 6ms（压力下仍留出渲染时间）', stressed.trimmedAvg.toFixed(3) + 'ms');
ok(stressed.p50 < 2.0, '中位步耗时 < 2ms', stressed.p50.toFixed(3) + 'ms');
ok(stressed.p95 < 12.0, 'P95 < 12ms', stressed.p95.toFixed(3) + 'ms');
ok(stressed.effective > 0.95, '基准有效性：≥95% 的步确实在执行模拟', (stressed.effective * 100).toFixed(1) + '%');
ok(stressed.avgEnemies > 250, '确实维持了高怪物密度', stressed.avgEnemies.toFixed(0));

/* ---------------- 场景 3：全屏弹幕（伤害飘字上限） ---------------- */
console.log('\n[3] 弹幕场景（转轮机枪 ×6，检查飘字/粒子不再无限增长）');
function setupBullets() {
  Game.newRun('ranger');
  enterFightRoom(); Game._internals.startWave(20);
  buildLoadout(['minigun', 'minigun', 'minigun', 'minigun', 'minigun', 'minigun']);
}
const bulletHell = bench('六转轮机枪 × 3 轮', 600, { holdEnemies: 200, setup: setupBullets });
ok(bulletHell.trimmedAvg < 6.0, '截尾均值 < 6ms', bulletHell.trimmedAvg.toFixed(3) + 'ms');
ok(bulletHell.effective > 0.95, '基准有效性：≥95% 的步确实在执行模拟',
  (bulletHell.effective * 100).toFixed(1) + '%');

const sess = Game.getSession();
const st = globalThis.Emit.stats();
console.log('    并发伤害飘字 ' + st.text + ' 条 · 视觉粒子 ' + st.vis +
  ' · 池内空闲 ' + (st.freeVis + st.freeText));
ok(st.text <= globalThis.Emit.TEXT_CAP, '伤害飘字并发数受限（≤' + globalThis.Emit.TEXT_CAP + '）', st.text);
ok(st.vis <= globalThis.Emit.VIS_CAP, '视觉粒子数受限（≤' + globalThis.Emit.VIS_CAP + '）', st.vis);

/* ---------------- 汇总 ---------------- */
console.log('\n=== 结果 ===');
const worstP95 = Math.max(natural.p95, stressed.p95, bulletHell.p95);
console.log('最好一轮的成绩（截尾均值）：真实波次 ' + natural.trimmedAvg.toFixed(3) +
  'ms  ·  300 怪 ' + stressed.trimmedAvg.toFixed(3) +
  'ms  ·  弹幕 ' + bulletHell.trimmedAvg.toFixed(3) + 'ms');
console.log('轮间抖动：真实波次 ' + natural.spread.toFixed(2) + '×  ·  300 怪 ' +
  stressed.spread.toFixed(2) + '×  ·  弹幕 ' + bulletHell.spread.toFixed(2) + '×');
console.log('最差 P95 帧耗时：' + worstP95.toFixed(3) + 'ms / 预算 ' + BUDGET_MS + 'ms');
if (failures === 0) { console.log('\x1b[32m全部通过 ✔\x1b[0m\n'); process.exit(0); }
console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m\n');
process.exit(1);
