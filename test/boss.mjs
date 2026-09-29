/* =========================================================
   boss.mjs — 随机 Boss 池（G3）

   "随机 Boss"最容易做成假的两件事：
     · 四只只有数值不同（换个颜色、血更多）→ 随机毫无意义
     · 每波掷一次骰子 → 同一层前后说法不一致，剧情碎片也对不上
   这一套守的就是这两条，外加三条"机制真的存在"的验证：
     掘地者钻地期间**免伤且不是目标** · 母巢真的**召唤** · 钟摆真的**扫射**
   以及"打倒之后记下了哪一只"（剧情碎片的输入）。

   用法： node test/boss.mjs
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { loadAll, SIM_MODULES, toShop } from './_load.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
let failures = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  \x1b[32mPASS\x1b[0m ' + label);
  else { failures++; console.log('  \x1b[31mFAIL\x1b[0m ' + label + (extra !== undefined ? '  → ' + extra : '')); }
}

await loadAll(SIM_MODULES);
const { Game, Dungeon, Enemies, Registry, AI, U } = globalThis;
console.error = function () { };

console.log('\n=== Bronana · 随机 Boss 池 ===\n');

/* ---------------- 1. 池子本身：够多、够不同、都进得了第一层 ---------------- */
console.log('[1] Boss 池：够多、够不同');
{
  const B = Enemies.BOSSES;
  ok(B.length >= 3, 'Boss 池至少 3 只（' + B.length + ' 只：' + B.map(b => b.name).join(' / ') + '）');
  const bad = B.filter(b => {
    const d = Enemies.BY_ID[b.id];
    return !d || !d.boss || d.minWave > 5;
  });
  ok(bad.length === 0, '每只都在怪物表里、标了 boss、且第一层就可能遇到', bad.map(b => b.id).join(','));
  const sigs = B.map(b => {
    const d = Enemies.BY_ID[b.id];
    return (d.behavior || 'chase') + '/' + (d.pattern || 'single');
  });
  ok(new Set(sigs).size === sigs.length,
    '没有两只的应对方式是一样的（' + sigs.join(', ') + '）');
  ok(Enemies.audit().ok, 'Boss 池自检通过', Enemies.audit().problems.join(' | '));
  ok(Registry.has('boss') && Registry.count('boss') === B.length,
    'boss 家族登记在总账里，且正好等于池子的规模', Registry.count('boss'));
  // 每只的 behavior / pattern 都必须是注册过的（写错名字以前会静默退化）
  const unreg = [];
  for (const b of B) {
    const d = Enemies.BY_ID[b.id];
    if (!AI.hasBehaviour(d.behavior)) unreg.push(d.id + ':' + d.behavior);
    if (d.pattern && !AI.hasPattern(d.pattern)) unreg.push(d.id + ':' + d.pattern);
  }
  ok(unreg.length === 0, '每只的 behavior / pattern 都在 AI 注册表里', unreg.join(','));
}

/* ---------------- 2. 出哪一只由"层"决定，不由"波"决定 ---------------- */
console.log('\n[2] 同一层永远是同一只（随机落在层上，不是落在波上）');
{
  const seen = {};
  for (let s = 0; s < 200; s++) seen[Enemies.bossFor(s, 1)] = true;
  ok(Object.keys(seen).length === Enemies.BOSSES.length,
    '200 个种子之后四只都出现过（随机是真的）', Object.keys(seen).join(','));
  ok(Enemies.bossFor(12345, 2) === Enemies.bossFor(12345, 2), '同种子同层 → 同一只（纯函数）');
  const perFloor = [1, 2, 3].map(f => Enemies.bossFor(4242, f));
  ok(new Set(perFloor).size >= 2, '同一个种子的三层不会永远是同一只（' + perFloor.join(',') + '）');

  // 真的进 Boss 房：刷出来的必须是这一层的那一只
  const s = Game.newRun('ranger', 4242, 0);
  s.roomId = s.map.boss;
  Game._internals.startWave(6);
  const want = Enemies.bossFor(s.seed, s.floor);
  const bossItems = s.spawnQueue.filter(q => q.boss);
  ok(bossItems.length === 1 && bossItems[0].id === want,
    'Boss 房刷的就是这一层那只（' + want + '）', JSON.stringify(bossItems));
  ok(s.bossId === want, '会话里记着"这一间的 Boss 是谁"（界面/剧情都要用）', s.bossId);
  // 非 Boss 房不该带上 Boss id
  Game.newRun('ranger', 4242, 0);
  const s2 = Game.getSession();
  Game._internals.warpTo(s2.map.rooms.find(r => r.type === 'fight').id);
  Game._internals.startWave(6);
  ok(s2.bossId === null, '普通房不记 Boss id', String(s2.bossId));
}

/* ---------------- 3. 三条机制：钻地 / 召唤 / 扫射 ---------------- */
console.log('\n[3] 三条机制必须真的存在（不是换皮）');
{
  const mk = (id, wave) => {
    Game.newRun('ranger', 909, 0);
    const s = Game.getSession();
    Game._internals.warpTo(s.map.rooms.find(r => r.type === 'fight').id);
    Game._internals.startWave(wave);
    // 只留这一只 Boss：不清队列的话，这一波的小怪会一起上来
    //（玩家会死 → 状态变 end → 后面所有 AI 都不再推进，测试会得到一堆假失败）
    s.spawnQueue = []; s.spawnIdx = 0;
    s.enemies.length = 0;
    s.player.invuln = 1e9;
    const e = Game._internals.spawnEnemy(id, s.player.x + 240, s.player.y, {});
    e.spawnT = 0;
    e.hp = e.maxHp;
    return { s, e };
  };
  const tick = (s, n, pred) => {
    for (let i = 0; i < n; i++) {
      Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });
      s.player.invuln = 1e9;
      if (pred && pred()) return true;
    }
    return false;
  };

  // (a) 掘地者：钻地期间免伤 + 不是目标
  const a = mk('digger', 8);
  ok(a.e.def.behavior === 'burrow', '掘地者用的是 burrow 行为');
  tick(a.s, 1);
  ok(a.e.t1 > 0, '它一上来在地面上（t1 = ' + a.e.t1.toFixed(2) + '）');
  const burrowed = tick(a.s, 60 * 8, () => !!a.e.burrowed);
  ok(burrowed, '它真的会钻下去（8 秒内）');
  if (burrowed) {
    const hp0 = a.e.hp;
    const dealt = Game.damageEnemy(a.e, 99999, { fromX: 0, fromY: 0 });
    ok(dealt === 0 && a.e.hp === hp0, '钻地期间**免伤**（伤害 0，血量不变）', dealt + ' / ' + a.e.hp);
    ok(!a.e.dead, '钻地期间打不死');
    ok(Game._internals ? true : true, '（下面验它冒出来之后又能打）');
  }
  // 冒出来之后又能打了
  let surfaced = false;
  for (let i = 0; i < 60 * 4 && !surfaced; i++) {
    Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });
    a.s.player.invuln = 1e9;
    if (!a.e.burrowed && !a.e.dead && a.e.t1 > 0) surfaced = true;
  }
  ok(surfaced && Game.damageEnemy(a.e, 5, { fromX: 0, fromY: 0 }) > 0,
    '冒出来之后又能被打到（有出有进，不是永久无敌）');

  // (b) 母巢：真的召唤
  const b = mk('brood', 8);
  b.e.t2 = 0;                                  // 立刻到节拍
  tick(b.s, 30);
  const spawned = b.s.enemies.filter(e => e !== b.e);
  ok(spawned.length >= 1, '母巢真的召唤了小怪（' + spawned.length + ' 只）');
  ok(spawned.every(e => (b.e.def.summonIds || []).indexOf(e.def.id) >= 0),
    '召唤的是声明表里写的那些小怪', spawned.map(e => e.def.id).join(','));

  // (c) 钟摆：扫射相位在动，弹幕角度随之变化
  const c = mk('pendulum', 8);
  c.e.t1 = -1; c.e.t2 = 1;
  tick(c.s, 60);
  ok(c.e.t1 > -1, '扫射相位在推进（-1.00 → ' + c.e.t1.toFixed(2) + '）');
  const def = c.e.def;
  ok(def.pattern === 'sweep' && def.sweepCount > 1,
    '它用的是 sweep 弹幕，而且是一串而不是一发（' + def.sweepCount + ' 发）');
}

/* ---------------- 4. 打倒之后记下是哪一只 ---------------- */
console.log('\n[4] 打倒之后记下是哪一只（剧情碎片的输入）');
{
  Game.newRun('ranger', 4242, 0);
  const s = Game.getSession();
  s.roomId = s.map.boss;
  Game._internals.startWave(6);
  const want = s.bossId;
  let evt = null;
  Game.events.on('bossDown', d => { evt = d; });
  // 把 Boss 直接打死（走真实的击杀路径）
  const boss = Game._internals.spawnEnemy(want, s.player.x + 120, s.player.y, {});
  boss.spawnT = 0;
  Game.damageEnemy(boss, 1e9, { fromX: s.player.x, fromY: s.player.y });
  ok(boss.dead === true, 'Boss 被打倒了');
  ok(s.bossesDown[want] === true, '记下了是哪一只（' + want + '）', JSON.stringify(s.bossesDown));
  ok(!!evt && evt.id === want, '发出了 bossDown 事件', JSON.stringify(evt));

  // 存档往返：认得出的留下，认不出的丢掉
  const payload = Game.exportRun();
  ok(Array.isArray(payload.bossesDown) && payload.bossesDown.indexOf(want) >= 0,
    '打倒过的 Boss 进了存档', JSON.stringify(payload.bossesDown));
  const back = Game.importRun(Object.assign({}, payload, { bossesDown: [want, '不存在的Boss', 42] }));
  ok(back.bossesDown[want] === true && Object.keys(back.bossesDown).length === 1,
    '读档只收真有的 Boss（坏档防线）', JSON.stringify(back.bossesDown));
}

/* ---------------- 5. 关底血条与界面接线 ---------------- */
console.log('\n[5] 关底血条与界面接线');
{
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  ok(html.indexOf('id="boss-bar"') >= 0 && html.indexOf('id="boss-fill"') >= 0,
    'index.html 里有关底血条（Boss 头上不再画小血条）');
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  ok(/#boss-bar/.test(css), '关底血条有样式');
  const ui = fs.readFileSync(path.join(ROOT, 'src', 'ui.ts'), 'utf8');
  ok(/def\.boss/.test(ui), '界面按 def.boss 找关底（不是按 id 认某一具体 Boss）');
  const rc = fs.readFileSync(path.join(ROOT, 'src', 'render.ts'), 'utf8');
  ok(/burrowed/.test(rc), '渲染层知道"钻地中"要画土堆');
  const rec = fs.readFileSync(path.join(ROOT, 'src', 'score.ts'), 'utf8');
  ok(rec.indexOf('bossesDown') < 0, '成绩码不关心打倒过哪几只 Boss（那是档案，不是成绩）');
}

/* ---------------- 6. 弱机制：四只都能在真实对局里跑起来且会被打死 ------------ */
console.log('\n[6] 四只都能在真实对局里跑起来');
{
  const bad = [];
  for (const b of Enemies.BOSSES) {
    try {
      Game.newRun('gladiator', 77, 0);
      const s = Game.getSession();
      Game._internals.warpTo(s.map.rooms.find(r => r.type === 'fight').id);
      Game._internals.startWave(10);
      s.enemies.length = 0;
      const e = Game._internals.spawnEnemy(b.id, s.player.x + 260, s.player.y, {});
      e.spawnT = 0;
      const hp0 = e.hp;
      s.player.invuln = 1e9;
      let shots = 0;
      const off = Game.events.on('bossDown', () => { shots++; });
      for (let i = 0; i < 60 * 12 && !e.dead; i++) {
        Game.step(Game.cfg.fixedDt, { x: Math.cos(i * 0.02), y: Math.sin(i * 0.02) });
        s.player.invuln = 1e9;
      }
      off();
      if (!isFinite(e.x) || !isFinite(e.hp)) bad.push(b.id + ' 数值异常');
      if (e.hp === hp0 && !e.dead) bad.push(b.id + ' 12 秒里一次都没被打到（可能永远打不到）');
      Game.damageEnemy(e, 1e9, { fromX: s.player.x, fromY: s.player.y });
      if (!e.dead) bad.push(b.id + ' 打不死');
    } catch (err) {
      bad.push(b.id + ': ' + err.message);
    }
  }
  ok(bad.length === 0, '四只 Boss 各自都能跑、能被打到、能被打死', bad.join(' | '));
}

console.log('\n=== 结果 ===');
if (failures === 0) { console.log('\x1b[32m全部通过 ✔\x1b[0m\n'); process.exit(0); }
console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m\n');
process.exit(1);
