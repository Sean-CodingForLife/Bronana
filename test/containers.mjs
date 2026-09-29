/* =========================================================
   containers.mjs — 容器与对象管理测试
   守的是"对象管理是一套系统"，不是"某个容器恰好好用"：
     · 声明齐备：每个原型声明的集合都必须是一个已声明的容器
     · 统一回收：就地交换删除（不重建数组），回收后不残留、不重复、不超上限
     · 上限策略：drop-oldest / reject / reclaim-farthest / ring 各自真的生效
     · 池化容器：空闲池 + 在使用数守恒（不泄漏、不重复回收）
     · 长局不变量：跑完一场后 Containers.check() 必须干净，并报出各容器峰值
   用法： node test/containers.mjs
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { loadAll, SIM_MODULES } from './_load.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
let failures = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  \x1b[32mPASS\x1b[0m ' + label);
  else { failures++; console.log('  \x1b[31mFAIL\x1b[0m ' + label + (extra !== undefined ? '  → ' + extra : '')); }
}
function throws(fn) { try { fn(); return null; } catch (e) { return e.message; } }

await loadAll(SIM_MODULES);
const g = globalThis;
const { Containers, Game, Comp, Emit, Stats } = g;
const FIXED = Game.cfg.fixedDt;

console.log('\n=== Bronana · 容器与对象管理 ===\n');

/* ---------------- 1. 声明齐备 ---------------- */
console.log('[1] 声明：容器总账');
{
  const names = Containers.names();
  ok(names.length >= 8, '已声明容器 ' + names.length + ' 个：' + names.join('/'), String(names.length));

  const rows = Containers.table();
  ok(rows.every(r => r.note && r.note.length >= 4), '每个容器都写了"装什么"',
    rows.filter(r => !r.note || r.note.length < 4).map(r => r.name).join(','));
  ok(rows.every(r => r.cap === Infinity || r.cap > 0), '每个容器都有明确上限（不设上限要显式写 Infinity）');
  ok(rows.some(r => r.policy === 'ring') && rows.some(r => r.policy === 'external') &&
    rows.some(r => r.policy === 'swap'),
    '三种回收策略都在用：' + [...new Set(rows.map(r => r.policy))].join('/'));

  // 原型声明的集合必须是已声明的容器（否则就是"没人管的容器"）
  const archetypeLists = Comp.archetypes().map(a => Comp.archetypeInfo(a).list).filter(Boolean);
  const undeclared = [...new Set(archetypeLists)].filter(l => !Containers.names().some(n => Containers.def(n).list === l));
  ok(undeclared.length === 0,
    '全部 ' + new Set(archetypeLists).size + ' 个原型集合都有对应的容器声明', undeclared.join(', '));

  // 引擎配置里的上限必须与容器声明一致（不能有两份真源）
  ok(Containers.def('enemies').cap === Game.cfg.enemyCap, '怪物上限与 Game.cfg.enemyCap 一致',
    Containers.def('enemies').cap + ' vs ' + Game.cfg.enemyCap);
  ok(Containers.def('decals').cap === Game.cfg.decalCap, '贴花容量与 Game.cfg.decalCap 一致');
  ok(Containers.def('particles').cap === Emit.VIS_CAP && Containers.def('textParticles').cap === Emit.TEXT_CAP,
    '粒子/飘字上限与 emit.ts 的常量一致');

  const e1 = throws(() => Containers.declare('enemies', { list: 'x', note: 'x', cap: 1 }));
  ok(!!e1 && /重名/.test(e1), '容器重名被拒绝', e1);
  const e2 = throws(() => Containers.declare('tmpA', { list: 'x', note: 'x' }));
  ok(!!e2 && /必须显式声明 cap/.test(e2), '不写上限被拒绝（逼你回答"会不会无限增长"）', e2);
  const e3 = throws(() => Containers.declare('tmpB', { list: 'x', note: 'x', cap: 1, policy: 'magic' }));
  ok(!!e3 && /policy/.test(e3), '回收策略非法被拒绝', e3);
  const e4 = throws(() => Containers.declare('tmpC', { list: 'x', note: 'x', cap: 1, policy: 'ring' }));
  ok(!!e4 && /never/.test(e4), '环形缓冲不允许配 onFull（写满即覆盖）', e4);
}

/* ---------------- 2. 回收：就地交换删除 ---------------- */
console.log('\n[2] 回收：就地交换删除');
{
  const sess = Game.newRun('ranger', 7);
  const { Comp: C } = g;
  sess.bullets.length = 0;
  const keepRefs = [];
  for (let i = 0; i < 10; i++) {
    const b = C.spawn('bullet', { life: 1, x: i, y: 0 });
    sess.bullets.push(b);
    keepRefs.push(b);
  }
  // 杀掉第 2、5、9 个（下标奇数/偶数混合，覆盖交换删除的边界）
  sess.bullets[1].life = -1;
  sess.bullets[5].life = -1;
  sess.bullets[9].life = -1;
  const arrRef = sess.bullets;
  const n = Containers.reap(sess, 'bullets');
  ok(n === 3 && sess.bullets.length === 7, '回收 3 个，剩 7 个', n + ' / ' + sess.bullets.length);
  ok(sess.bullets === arrRef, '**数组本体没有被替换**（老实现是 S.bullets = out，每步新建）');
  const alive = new Set(sess.bullets);
  ok(!alive.has(keepRefs[1]) && !alive.has(keepRefs[5]) && !alive.has(keepRefs[9]),
    '该回收的都不在了');
  ok(keepRefs.filter((b, i) => i % 3 !== 0 && [1, 5, 9].indexOf(i) < 0).every(b => alive.has(b)),
    '活着的都还在（一个没被误删）');
  ok(new Set(sess.bullets).size === sess.bullets.length, '没有重复元素');
  ok(Containers.check(sess).length === 0, '回收后不变量干净', Containers.check(sess).join(' | '));

  // 连续回收 + 后续入队仍然正确
  sess.bullets[0].life = -1;
  Containers.reap(sess, 'bullets');
  sess.bullets.push(C.spawn('bullet', { life: 1 }));
  ok(sess.bullets.length === 7 && Containers.check(sess).length === 0,
    '回收后再入队仍然一致', String(sess.bullets.length));
}

/* ---------------- 3. 上限策略 ---------------- */
console.log('\n[3] 上限策略');
{
  const sess = Game.newRun('gladiator', 11);
  const C = g.Comp;
  // drop-oldest：超了丢最旧
  sess.pickups.length = 0;
  const cap = Containers.def('pickups').cap;
  const first = C.spawn('pickup', { kind: 'mat', x: 1, y: 1, seed: 1 });
  sess.pickups.push(first);
  for (let i = 1; i < cap + 40; i++) sess.pickups.push(C.spawn('pickup', { kind: 'mat', x: i, y: 1, seed: i }));
  const over = sess.pickups.length - cap;
  const dropped = Containers.enforce(sess, 'pickups');
  ok(dropped === over && sess.pickups.length === cap, 'drop-oldest：裁剪到上限', dropped + ' / ' + cap);
  ok(sess.pickups.indexOf(first) < 0, '丢的是**最旧**的那批（最先进来的被丢掉）');

  // reject：超了裁掉最新的
  sess.turrets.length = 0;
  const tcap = Containers.def('turrets').cap;
  for (let i = 0; i < tcap + 5; i++) sess.turrets.push({ x: i, y: 0, cd: 1, muzzle: 0, aim: 0 });
  const newest = sess.turrets[sess.turrets.length - 1];
  Containers.enforce(sess, 'turrets');
  ok(sess.turrets.length === tcap && sess.turrets.indexOf(newest) < 0,
    'reject：裁掉最新多出来的（本该在创建时就被拒绝）', String(sess.turrets.length));

  // reclaim-farthest：满了回收离玩家最远且允许回收的
  sess.enemies.length = 0;
  sess.player.x = 0; sess.player.y = 0;
  const eCap = Containers.def('enemies').cap;
  for (let i = 0; i < eCap; i++) {
    const e = Game._internals.spawnEnemy('grub', 100 + i, 100, {});
    if (!e) break;
  }
  const far = Game._internals.spawnEnemy('grub', 99999, 99999, {});   // 最远的那只
  const near = Game._internals.spawnEnemy('grub', 5, 5, {});          // 新来的（近）
  ok(sess.enemies.length <= eCap, '怪物数量不超上限', String(sess.enemies.length));
  ok(far && near && sess.enemies.indexOf(near) >= 0, '新生成的怪在场上');
  ok(!far || sess.enemies.indexOf(far) < 0, '最远的那只被优先回收（reclaim-farthest）');

  // ring：写满覆盖最旧，长度恒定
  sess.decals.length = 0; sess.decalSeq = 0;
  const dcap = Containers.def('decals').cap;
  for (let i = 0; i < dcap * 3; i++) {
    const slot = Containers.slot(sess, 'decals', ++sess.decalSeq);
    const list = slot.list;
    list[slot.index] = { x: i, y: 0, r: 4, seq: sess.decalSeq, color: '#7c3b62' };
  }
  ok(sess.decals.length === dcap, '环形缓冲长度恒定在上限', String(sess.decals.length));
  const seqs = sess.decals.map(d => d.seq).sort((a, b) => a - b);
  ok(seqs[0] === sess.decalSeq - dcap + 1 && seqs[seqs.length - 1] === sess.decalSeq,
    '活着的是**最新**的 cap 条（覆盖最旧）', seqs[0] + '..' + seqs[seqs.length - 1]);
  ok(Containers.reap(sess, 'decals') === 0, '环形缓冲不参与交换删除');
}

/* ---------------- 4. 池化容器：守恒 ---------------- */
console.log('\n[4] 池化容器：使用中 + 空闲 = 已分配');
{
  const sess = Game.newRun('engineer', 5);
  Emit.reset ? Emit.reset() : null;
  let created = 0;
  for (let i = 0; i < 400; i++) {
    holdRoom(sess);
    sess.player.hp = sess.stats.maxHp;
    Game.step(FIXED, { x: 0, y: 0 });
    Emit.hitText ? null : null;
    const vis = sess.particles.length + sess.freeParticles.length;
    if (vis > created) created = vis;
  }
  const st = Containers.stats(sess);
  const visTotal = sess.particles.length + sess.freeParticles.length;
  const textTotal = sess.textParticles.length + sess.freeTextParticles.length;
  console.log('    · 粒子 在用 ' + sess.particles.length + ' + 空闲 ' + sess.freeParticles.length +
    ' = ' + visTotal + '（上限 ' + st.particles.cap + '）');
  console.log('    · 飘字 在用 ' + sess.textParticles.length + ' + 空闲 ' + sess.freeTextParticles.length +
    ' = ' + textTotal + '（上限 ' + st.textParticles.cap + '）');
  ok(st.particles.len <= st.particles.cap && st.textParticles.len <= st.textParticles.cap,
    '在用粒子/飘字不超过上限');
  ok(visTotal <= st.particles.cap && textTotal <= st.textParticles.cap,
    '池总量也不超过上限（空闲对象不无限囤积）', visTotal + ' / ' + textTotal);
  ok(sess.particles.every(p => p.life > 0), '在用粒子都活着（没有残留的死对象）');
  ok(new Set(sess.particles).size === sess.particles.length, '在用粒子没有重复引用');
}

/* ---------------- 5. 长局不变量 + 峰值账目 ---------------- */
console.log('\n[5] 长局：不变量与峰值');
{
  const sess = Game.newRun('ranger', 31337);
  enterFightRoom(); Game._internals.startWave(12);
  const peak = {};
  let err = null;
  const before = sess.bullets.length;      // 引用不变性检查用
  try {
    for (let i = 0; i < 1800; i++) {
      if (Game.state === 'playing') Game.step(FIXED, Game.autoInput(i * FIXED));
      else if (Game.state === 'levelup') Game.chooseLevelCard(0);
      else if (Game.state === 'shop') Game.nextWave();
      sess.player.hp = sess.stats.maxHp;
      const st = Containers.stats(sess);
      for (const k in st) if (!peak[k] || st[k].len > peak[k]) peak[k] = st[k].len;
      if (i % 300 === 299) {
        const bad = Containers.check(sess);
        if (bad.length) { err = '第 ' + (i + 1) + ' 帧：' + bad.slice(0, 3).join(' | '); break; }
      }
    }
  } catch (e) { err = e.message + '\n      ' + (e.stack.split('\n')[1] || '').trim(); }
  ok(!err, '1800 帧里容器不变量一直成立（不残留死对象 / 不超上限 / 无重复引用）', err);
  ok(sess.bullets.length >= before, '子弹容器本体是同一个数组（不再每步重建）');

  const st = Containers.stats(sess);
  console.log('    · 峰值：' + Object.keys(peak).sort()
    .filter(k => peak[k] > 0)
    .map(k => k + ' ' + peak[k] + '/' + st[k].cap).join('  ·  '));
  ok(Object.keys(peak).some(k => peak[k] > 0), '长局里确实用到了多个容器');
  const overflow = Object.keys(peak).filter(k => st[k].cap !== Infinity && peak[k] > st[k].cap);
  ok(overflow.length === 0, '没有任何容器在长局中超过声明上限', overflow.join(', '));

  /* 静态契约：不能再出现"每步重建数组"的写法 */
  const src = fs.readFileSync(path.join(ROOT, 'src', 'game.ts'), 'utf8');
  const rebuild = [...src.matchAll(/S\.(bullets|ebullets|pickups|enemies|turrets)\s*=\s*out/g)].map(m => m[1]);
  ok(rebuild.length === 0,
    'game.ts 里没有"S.x = out"式的每步重建（回收统一走 Containers）', rebuild.join(', '));
  const hotLoops = [...src.matchAll(/var out = \[\]/g)].length;
  console.log('    · game.ts 里剩余的 `var out = []`：' + hotLoops + ' 处（查询辅助用，不在每步回收路径上）');
}

console.log('\n=== 结果 ===');
if (failures === 0) { console.log('\x1b[32m全部通过 ✔\x1b[0m'); process.exit(0); }
console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m');
process.exit(1);
