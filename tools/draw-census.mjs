/* =========================================================
   draw-census.mjs — 绘制调用普查：每一帧的调用到底花在谁身上
   批处理 / 图集要花在刀刃上，就得先知道刀刃在哪。
   用带 CTM 的桩跑真实若干帧，按**调用来源函数**与**分层**归类统计。
   用法： node tools/draw-census.mjs [帧数]
   ========================================================= */
import { installDom, makeProbeCtx } from '../test/_ctx.mjs';
import { loadAll, RENDER_MODULES } from '../test/_load.mjs';

const FRAMES = Number(process.argv[2] || 3);
installDom();
await loadAll(RENDER_MODULES);
const { R, Game } = globalThis;

const main = globalThis.document.createElement('canvas');
R.init(main);
const probe = makeProbeCtx();
R.ctx = probe;

const counts = Object.create(null);
const byPhase = Object.create(null);
function bump(map, key) { map[key] = (map[key] || 0) + 1; }
for (const k of ['fill', 'stroke', 'fillRect', 'drawImage', 'fillText', 'strokeText', 'clip']) {
  const orig = probe[k];
  probe[k] = function (...args) {
    const st = (new Error()).stack.split('\n')[2] || '';
    const m = st.match(/at\s+([\w$.]+)\s+\(/) || st.match(/at\s+(.*):\d+:\d+/);
    const who = m ? String(m[1]).replace(/^Object\./, '') : '?';
    bump(counts, who);
    bump(byPhase, (R.phase || '?') + ' → ' + who);
    return orig.apply(this, args);
  };
}

Game.newRun('gladiator', 4242);
const sess = Game.getSession();
sess.waveLeft = 1e9;
sess.player.invuln = 999;
Game._internals.startWave(8);
for (let i = 0; i < 240; i++) Game.step(1 / 60, Game.autoInput(i / 60));
for (let f = 0; f < FRAMES; f++) R.draw(1 / 60);

const per = (v) => (v / FRAMES).toFixed(1).padStart(8);
const total = Object.values(counts).reduce((a, b) => a + b, 0) / FRAMES;
console.log('=== 单帧绘制调用普查（' + FRAMES + ' 帧平均，合计 ' + total.toFixed(0) + ' 次/帧）===\n');
console.log('按调用来源：');
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 24)) {
  console.log('  ' + per(v) + '  ' + k);
}
console.log('\n按 phase → 来源（前 20）：');
for (const [k, v] of Object.entries(byPhase).sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log('  ' + per(v) + '  ' + k);
}
console.log('\n场上：' + JSON.stringify({
  enemies: sess.enemies.length, bullets: sess.bullets.length, ebullets: sess.ebullets.length,
  particles: sess.particles.length, textParticles: sess.textParticles.length,
  decals: sess.decals.length, pickups: sess.pickups.length, turrets: sess.turrets.length
}));
