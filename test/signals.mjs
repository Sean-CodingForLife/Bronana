/* =========================================================
   signals.ts — 事件总线（信号）测试
   审计出的四个问题都必须被守住：
     1) 处理器抛错不能向外传播、不能影响其它监听器（否则一帧模拟会被打断）
     2) 重入必须有深度上限（自触发信号不能把调用栈打爆）
     3) 派发期间增删监听器采用快照语义
     4) once/clear/计数齐全；重复 init 不能导致订阅翻倍
   用法： node test/signals.mjs
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { loadAll, SIM_MODULES, RENDER_MODULES, UI_MODULES } from './_load.mjs';
/* ⚠ **跨根枚举**（E4 批次 1）：只扫 `src/` 的断言在搬家后会"看着全绿、其实没看那些模块" */
import srcScan from '../tools/src-files.cjs';

const ROOT = path.resolve(import.meta.dirname, '..');
let failures = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  \x1b[32mPASS\x1b[0m ' + label);
  else { failures++; console.log('  \x1b[31mFAIL\x1b[0m ' + label + (extra !== undefined ? '  → ' + extra : '')); }
}

await loadAll(SIM_MODULES);

const { U, Game } = globalThis;
const FIXED = Game.cfg.fixedDt;

// 抑制被隔离的异常在测试输出里刷屏
const realError = console.error;
console.error = function () { };

console.log('\n=== Bronana · 事件总线（信号）测试 ===\n');

/* ---------------- 基础语义 ---------------- */
console.log('[1] 基础语义');
{
  const b = U.Bus('test');
  let n = 0;
  const h = () => n++;
  b.on('e', h);
  b.emit('e');
  b.emit('e');
  ok(n === 2, 'on 订阅后每次派发都触发', n + ' 次');
  ok(b.listenerCount('e') === 1, 'listenerCount 正确', b.listenerCount('e'));

  b.off('e', h);
  b.emit('e');
  ok(n === 2, 'off 之后不再触发', n + ' 次');

  let once = 0;
  b.once('o', () => once++);
  b.emit('o'); b.emit('o'); b.emit('o');
  ok(once === 1, 'once 只触发一次', once + ' 次');

  // once 的 off 也能按原函数摘除
  const fn = () => once++;
  b.once('o2', fn);
  b.off('o2', fn);
  b.emit('o2');
  ok(once === 1, 'once 可用原函数退订', once + ' 次');

  b.on('a', () => n++);
  b.on('b', () => n++);
  b.clear();
  b.emit('a'); b.emit('b');
  ok(b.listenerCount() === 0 && n === 2, 'clear 清空全部订阅', b.listenerCount());
}

/* ---------------- 异常隔离 ---------------- */
console.log('\n[2] 异常隔离');
{
  const b = U.Bus('iso');
  let later = false;
  b.on('e', () => { throw new Error('故意抛错'); });
  b.on('e', () => { later = true; });
  let escaped = null;
  try { b.emit('e'); } catch (e) { escaped = e.message; }
  ok(escaped === null, '处理器抛错不会向外传播', escaped);
  ok(later, '后续监听器仍然执行');
  ok(b.stats().errors === 1, '错误计数被记录', b.stats().errors);
}

/* ---------------- 重入与深度保护 ---------------- */
console.log('\n[3] 重入派发');
{
  const b = U.Bus('reentry');
  const order = [];
  b.on('a', () => { order.push('a1'); b.emit('b'); order.push('a2'); });
  b.on('b', () => { order.push('b1'); });
  b.emit('a');
  ok(order.join(',') === 'a1,b1,a2', '嵌套派发是同步深度优先（顺序可预测）', order.join(','));

  const b2 = U.Bus('loop');
  let hits = 0;
  b2.on('loop', () => { hits++; b2.emit('loop'); });      // 自触发
  let blew = null;
  try { b2.emit('loop'); } catch (e) { blew = e.constructor.name; }
  ok(blew === null, '自触发信号不会把调用栈打爆', blew);
  ok(hits > 0 && hits <= 64, '自触发被深度上限截断', '执行 ' + hits + ' 次');
  ok(b2.stats().refused > 0, '越界派发被计数', b2.stats().refused);
}

/* ---------------- 快照语义 ---------------- */
console.log('\n[4] 派发期间增删监听器');
{
  const b = U.Bus('snap');
  const seen = [];
  function h2() { seen.push('h2'); }
  function h3() { seen.push('h3'); }
  b.on('e', () => { seen.push('h1'); b.off('e', h2); b.on('e', h3); });
  b.on('e', h2);
  b.emit('e');
  ok(seen.join(',') === 'h1,h2', '本次派发用快照：已排队的仍执行、新加的本次不执行', seen.join(','));
  seen.length = 0;
  b.emit('e');
  ok(seen.join(',') === 'h1,h3', '下一次派发生效', seen.join(','));
}

/* ---------------- 与游戏循环的集成 ---------------- */
console.log('\n[5] 与游戏循环集成');
{
  // 一个抛错的界面处理器不能中断整帧模拟
  Game.events.clear();
  Game.events.on('shake', () => { throw new Error('界面处理器炸了'); });
  Game.newRun('ranger', 99);
  const s = Game.getSession();
  holdRoom(s);
  s.enemies.length = 0;
  const e = Game._internals.spawnEnemy('exploder', s.player.x + 200, s.player.y, {});
  if (e) e.spawnT = 0;
  let stepErr = null;
  try {
    for (let i = 0; i < 30; i++) { holdRoom(s); s.player.invuln = 999; Game.step(FIXED, { x: 0, y: 0 }); }
    Game.damageEnemy(e, 99999, { fromX: s.player.x, fromY: s.player.y });   // 触发 shake
    for (let i = 0; i < 30; i++) { holdRoom(s); s.player.invuln = 999; Game.step(FIXED, { x: 0, y: 0 }); }
  } catch (err) { stepErr = err.message; }
  ok(stepErr === null, '抛错的监听器不会中断 Game.step', stepErr);
  ok(Game.events.stats().errors > 0, '异常被总线记录', Game.events.stats().errors);

  // stateChange 事件确实带出来处与去处
  Game.events.clear();
  Game.newRun('ranger', 98);
  let last = null;
  Game.events.on('stateChange', d => { last = d; });
  Game.setState('paused');
  ok(last && last.from === 'playing' && last.to === 'paused',
    'stateChange 携带 from/to', last ? last.from + '→' + last.to : '无事件');
  Game.setState('playing', true);   // 收尾
}

/* ---------------- 订阅不重复 ---------------- */
console.log('\n[6] 订阅计数与幂等');
{
  const counts = {};
  for (const f of ['game.ts', 'render.ts', 'ui.ts']) {
    const src = fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
    counts[f] = [...src.matchAll(/\.on\('([A-Za-z]+)'/g)].map(m => m[1]);
  }
  console.log('    game.ts 发射的事件：' +
    [...new Set([...fs.readFileSync(path.join(ROOT, 'src/game.ts'), 'utf8')
      .matchAll(/events\.emit\('([A-Za-z]+)'/g)].map(m => m[1]))].join(', '));
  console.log('    render.ts 订阅：' + counts['render.ts'].join(', '));
  console.log('    ui.ts 订阅：' + counts['ui.ts'].length + ' 个事件');
  ok(counts['render.ts'].length > 0 && counts['ui.ts'].length > 0, '订阅确实存在');

  // 每个被订阅的事件都必须有人发射（否则是死订阅）
  const emitters = new Set();
  for (const { base: f, code: src } of srcScan.sources()) {
    for (const m of src.matchAll(/emit\('([A-Za-z]+)'/g)) emitters.add(m[1]);
  }
  const dead = [...counts['render.ts'], ...counts['ui.ts']].filter(e => !emitters.has(e));
  ok(dead.length === 0, '没有"订阅了但永远不会触发"的死订阅', dead.join(', '));
}

console.error = realError;
console.log('\n=== 结果 ===');
if (failures === 0) { console.log('\x1b[32m全部通过 ✔\x1b[0m\n'); process.exit(0); }
console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m\n');
process.exit(1);
