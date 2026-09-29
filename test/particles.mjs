/* =========================================================
   particles.ts — 粒子发生器（emit.ts）专项测试
   池化最容易出的问题是"回收/复用没处理干净"：
     · 同一个对象同时出现在活跃列表和自由链表里（双重回收）
     · 复用时残留上一条粒子的字段（例如上一条是文字，新粒子带着 text 属性）
     · 上限被突破，或回收后对象泄漏
   用法： node test/particles.mjs
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

const { Game, Emit, Arena, Items } = globalThis;
const FIXED = Game.cfg.fixedDt;

console.log('\n=== Bronana · 粒子发生器测试 ===\n');
console.log('[1] 上限定值与发射');
Game.newRun('ranger');
enterFightRoom(); Game._internals.startWave(12);
let s = Game.getSession();
ok(Emit.VIS_CAP === 420 && Emit.TEXT_CAP === 28, '上限定值正确',
  'vis=' + Emit.VIS_CAP + ' text=' + Emit.TEXT_CAP);

// 造一个敌人用于各种配方
function foe(x, y) {
  const e = Game._internals.spawnEnemy('grub', x, y, {});
  e.spawnT = 0;
  return e;
}
const e1 = foe(s.player.x + 80, s.player.y);

let recipeErr = null;
try {
  Emit.deathSparks(e1);
  Emit.blood(s.player.x, s.player.y, 3);
  Emit.ember(e1);
  Emit.slash(s.player.x, s.player.y, 80, 0, 1.4);
  Emit.muzzle(s.player.x, s.player.y, 0, false);
  Emit.shockRing(e1.x, e1.y);
  Emit.bulletExplosion(e1.x, e1.y, 60, true);
  Emit.deathExplosion(e1.x, e1.y, 70);
  Emit.damage(e1.x, e1.y, 12, false);
  Emit.heal(s.player.x, s.player.y, 3);
  Emit.dodge(s.player.x, s.player.y);
  Emit.playerHurt(s.player.x, s.player.y, 5);
} catch (e) { recipeErr = e.message; }
ok(!recipeErr, '全部 12 种效果配方可正常发射', recipeErr);

const st0 = Emit.stats();
console.log('    发射后：视觉 ' + st0.vis + ' / 飘字 ' + st0.text);
ok(st0.vis >= 10, '视觉粒子已生成', st0.vis);
ok(st0.text === 4, '飘字已生成（伤害/治疗/闪避/受击 各 1）', st0.text);

/* ---------------- 池一致性 ---------------- */
console.log('\n[2] 池一致性（无重复引用 / 无泄漏）');
let audit = Emit.audit();
ok(audit.duplicates === 0, '活跃列表与自由链表之间无重复引用', '重复 ' + audit.duplicates);

/* ---------------- 上限行为 ---------------- */
console.log('\n[3] 上限与轮转覆盖');
let capErr = null;
try {
  // 大量普通粒子：超过上限后应轮转覆盖而不是无限增长
  for (let i = 0; i < Emit.VIS_CAP * 3; i++) {
    Emit.spawn({ kind: 'spark', x: 100 + (i % 50), y: 100, vx: 0, vy: 0, r: 3, color: '#fff', life: 5 });
  }
  for (let i = 0; i < Emit.TEXT_CAP * 4; i++) Emit.text(100, 100, 't' + i, '#fff', 14, false);
} catch (e) { capErr = e.message; }
ok(!capErr, '超量发射不抛异常', capErr);

const st1 = Emit.stats();
ok(st1.vis <= Emit.VIS_CAP, '视觉粒子不超过上限', st1.vis + ' ≤ ' + Emit.VIS_CAP);
ok(st1.text <= Emit.TEXT_CAP, '飘字不超过上限', st1.text + ' ≤ ' + Emit.TEXT_CAP);

audit = Emit.audit();
ok(audit.duplicates === 0, '轮转覆盖后仍无重复引用', '重复 ' + audit.duplicates);

/* ---------------- 复用时的字段残留 ---------------- */
console.log('\n[4] 复用时不残留上一条粒子的字段');
let staleErr = null;
try {
  // 先塞满并清空一遍，让池里留下"用过的"对象
  Emit.clear();
  for (let i = 0; i < 40; i++) {
    Emit.text(10, 10, 'RESIDUE', '#f00', 30, true);     // 文字粒子带 text/size/vx
  }
  Emit.update(10);                                       // dt=10 → 全部过期回收
  const afterText = Emit.stats();
  if (afterText.text !== 0) staleErr = '文字粒子未全部回收：' + afterText.text;

  // 再发射普通视觉粒子，复用刚才的对象
  const p = Emit.spawn({ kind: 'spark', life: 1 });
  // 组件化之后所有粒子都带全部字段，"没有这个属性"不再是可用的判据 ——
  // 改成断言"值回到了默认值"，并对真正会发生复用的同一个池做残留检查。
  if (p.text !== '') staleErr = '复用的粒子残留了 text：' + JSON.stringify(p.text);
  if (p.size !== 0) staleErr = '复用的粒子残留了 size：' + p.size;
  if (p.vx !== 0) staleErr = '复用的粒子残留了 vx：' + p.vx;
  if (p.drag !== 0) staleErr = '复用的粒子残留了 drag：' + p.drag;
  if (p.kind !== 'spark') staleErr = 'kind 未正确赋值：' + p.kind;

  // 同池复用才是真的会发生：环形冲击波用 r0/r1/w/arc，复用到 spark 上必须清干净
  Emit.clear();
  for (let i = 0; i < 30; i++) {
    Emit.spawn({ kind: 'ring', life: 0.01, r0: 4, r1: 88, w: 5, a: 1.7, arc: 2.2, rot: 0.9, drag: 2 });
  }
  Emit.update(1);                                  // 全部过期 → 回收到视觉池
  const q = Emit.spawn({ kind: 'spark', life: 1 });
  if (q.r0 !== 0 || q.r1 !== 0 || q.w !== 0) {
    staleErr = '同池复用残留环形参数：r0=' + q.r0 + ' r1=' + q.r1 + ' w=' + q.w;
  }
  if (q.a !== 0 || q.arc !== 0 || q.rot !== 0 || q.drag !== 0) {
    staleErr = '同池复用残留角度参数：a=' + q.a + ' arc=' + q.arc + ' rot=' + q.rot + ' drag=' + q.drag;
  }
} catch (e) { staleErr = e.message; }
ok(!staleErr, '池对象复用时字段被完整重置', staleErr);

/* ---------------- 生命周期与回收 ---------------- */
console.log('\n[5] 生命周期：全部过期后对象回到自由链表');
let lifeErr = null;
try {
  Emit.clear();
  const st = Emit.stats();
  if (st.freeVis + st.freeText === 0) lifeErr = 'clear() 后自由链表为空，对象被丢弃了';

  for (let i = 0; i < 200; i++) Emit.spawn({ kind: 'spark', life: 0.2, vx: 5, vy: 5, drag: 1 });
  const during = Emit.stats();
  Emit.update(1);        // 一步跨过全部生命周期
  const after = Emit.stats();
  if (during.vis < 190) lifeErr = '发射数量异常：' + during.vis;
  if (after.vis !== 0) lifeErr = '过期后仍活跃：' + after.vis;
  if (after.freeVis < during.vis) lifeErr = '回收数量不足：空闲 ' + after.freeVis + ' < 发射 ' + during.vis;
} catch (e) { lifeErr = e.message; }
ok(!lifeErr, '过期粒子全部回收到自由链表', lifeErr);

/* ---------------- 与真实战斗联调 ---------------- */
console.log('\n[6] 真实战斗 30 秒（覆盖所有玩法触发路径）');
Game.newRun('ranger');
enterFightRoom(); Game._internals.startWave(16);
s = Game.getSession();
s.player.weapons.length = 0;
['minigun', 'flame', 'shotgun', 'laser', 'orb', 'hammer'].forEach(id => Game.addWeapon(id));
Items.LIST.slice(0, 6).forEach(it => s.player.items.push({ def: it }));
Game.recalcStats();

let combatErr = null, peakVis = 0, peakText = 0, peakFree = 0, auditBad = 0;
try {
  for (let i = 0; i < 1800; i++) {
    s.player.hp = s.stats.maxHp;
    holdRoom(s);
    while (Game.state !== 'playing') {
      if (Game.state === 'levelup') Game.chooseLevelCard(0); else Game.nextWave();
    }
    if (s.enemies.length < 200) Game._internals.spawnEnemy('grub', Arena.PAD + 60 + Math.random() * 200, Arena.PAD + 60, {});
    Game.step(FIXED, Game.autoInput(i / 60));
    peakVis = Math.max(peakVis, s.particles.length);
    peakText = Math.max(peakText, s.textParticles.length);
    if (i % 300 === 0 && Emit.audit().duplicates > 0) auditBad++;
    if (i % 60 === 0) peakFree = Math.max(peakFree, Emit.stats().freeVis);
  }
} catch (e) { combatErr = e.message + '\n      ' + (e.stack.split('\n')[1] || '').trim(); }
ok(!combatErr, '30 秒实战无异常', combatErr);
console.log('    峰值：视觉 ' + peakVis + ' / 飘字 ' + peakText + '（上限 ' + Emit.VIS_CAP + '/' + Emit.TEXT_CAP + '）');
ok(peakVis <= Emit.VIS_CAP && peakText <= Emit.TEXT_CAP, '实战中上限始终未被突破');
ok(auditBad === 0, '实战过程中池一致性保持（每 5 秒抽检）');

const fin = Emit.stats();
console.log('    结束时空闲对象：视觉 ' + fin.freeVis + ' / 飘字 ' + fin.freeText +
  '（过程中出现过 ' + peakFree + ' 个空闲）');
/* 这一条以前是"结束时必须有空闲对象或全清空"，而它是**时间点相关**的：
   这一场战斗里有 6 把武器在持续喷粒子，最后一帧恰好全部在用是常事
   （实测：跑 4 次里 1 次会让断言红）。判据换成两件稳定的事：
     · 账目自洽：活跃 + 空闲 ≤ 上限（对象凭空消失就会被抓）
     · 过程中出现过空闲 → 回收真的发生了（每帧采样，不押在最后一帧） */
ok(fin.vis + fin.freeVis <= Emit.VIS_CAP, '池账目自洽（活跃 ' + fin.vis + ' + 空闲 ' + fin.freeVis +
  ' ≤ 上限 ' + Emit.VIS_CAP + '）');
ok(peakFree > 0, '池被复用：过程中出现过空闲对象（回收真的发生了）', String(peakFree));

console.log('\n=== 结果 ===');
if (failures === 0) { console.log('\x1b[32m全部通过 ✔\x1b[0m\n'); process.exit(0); }
console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m\n');
process.exit(1);
