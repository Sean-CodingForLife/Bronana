/* =========================================================
   danger.mjs — 难度阶梯（逐级累加的修正表）

   这一套盯的是三类**静默故障**：
     1) 第 0 级不是恒等 —— 那么"没选难度"也会改变对局，行为指纹立刻变
     2) 某个修正键声明了却没人读 —— 那一级等于什么都没加，而界面上看不出来
     3) 折叠规则漏了某个键 —— 它会以"基准值"的身份混进结果，永远不生效
   外加一条：**结构类修正必须真的存在**（后段换招，而不是继续加数字）。

   用法： node test/danger.mjs
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

await loadAll(SIM_MODULES);
const { Danger, Dungeon, Enemies, Game, U, Profile, Registry } = globalThis;
console.error = function () { };

console.log('\n=== Bronana · 难度阶梯 ===\n');

/* ---------------- 1. 阶梯形状 ---------------- */
console.log('[1] 阶梯形状');
{
  ok(Danger.LIST.length >= 5, '阶梯至少 5 级（共 ' + Danger.LIST.length + ' 级，最高 ' + Danger.MAX + '）');
  const bad = Danger.LIST.filter((d, i) => d.level !== i);
  ok(bad.length === 0, '等级号连续从 0 开始', bad.map(d => d.level).join(','));
  const noName = Danger.LIST.filter(d => !d.name || !d.note);
  ok(noName.length === 0, '每一级都有名字与说明', noName.map(d => d.level).join(','));
  const emptyMid = Danger.LIST.filter(d => d.level > 0 && Object.keys(d.mods).length === 0);
  ok(emptyMid.length === 0, '除第 0 级外每一级都至少加一条修正', emptyMid.map(d => d.level).join(','));
  ok(Object.keys(Danger.LIST[0].mods).length === 0, '第 0 级没有任何修正');
}

/* ---------------- 2. 第 0 级必须是恒等 ---------------- */
console.log('\n[2] 第 0 级 = 恒等（这是行为指纹的前提）');
{
  const m = Danger.modsFor(0);
  const diff = Object.keys(Danger.BASE).filter(k => m[k] !== Danger.BASE[k]);
  ok(diff.length === 0, 'modsFor(0) 逐键等于基准', diff.join(','));
  const mNeg = Danger.modsFor(-5);
  ok(Object.keys(Danger.BASE).every(k => mNeg[k] === Danger.BASE[k]), '负数等第 0 级');
  const mBig = Danger.modsFor(9999);
  ok(Object.keys(Danger.BASE).every(k => mBig[k] === Danger.modsFor(Danger.MAX)[k]),
    '超过上限按最高级处理（不会溢出成更难的虚构等级）');
}

/* ---------------- 3. 累加性与单调性 ---------------- */
console.log('\n[3] 逐级累加，且难度只增不减');
{
  const higher = { enemyHp: 1, enemyDmg: 1, enemySpeed: 1, waveBudget: 1, waveTime: 1, shopPrice: 1, rerollCost: 1 };
  const additive = { eliteChance: 1, poolShift: 1 };
  // "越小越难"的三个：开局血量比例、Boss 间隔、货架件数（负增量 = 更难）
  const smallerIsHarder = { startHpFrac: 1, bossEvery: 1, offerCount: 1 };
  const lv = (n) => Danger.modsFor(n);
  let drop = [];
  for (let n = 1; n <= Danger.MAX; n++) {
    const a = lv(n - 1), b = lv(n);
    for (const k in higher) {
      // 方向由 danger.ts 的 DIRECTION 声明：waveTime 在房间制下是"越小越难"
      if (Danger.harder(k) < 0) { if (b[k] > a[k] + 1e-12) drop.push('L' + n + ' ' + k + ' 反而变松了 ' + a[k] + '→' + b[k]); }
      else if (b[k] < a[k] - 1e-12) drop.push('L' + n + ' ' + k + ' ' + a[k] + '→' + b[k]);
    }
    for (const k in additive) {
      if (Danger.harder(k) < 0) { if (b[k] > a[k]) drop.push('L' + n + ' ' + k + ' 反而变松了 ' + a[k] + '→' + b[k]); }
      else if (b[k] < a[k]) drop.push('L' + n + ' ' + k + ' ' + a[k] + '→' + b[k]);
    }
    for (const k in smallerIsHarder) if (b[k] > a[k]) drop.push('L' + n + ' ' + k + ' 反而变松了 ' + a[k] + '→' + b[k]);
  }
  ok(drop.length === 0, '每一级都不会让难度下降（累加而不是替换，方向按 DIRECTION 判）', drop.join(' | '));
  ok(Danger.DIRECTION.waveTime === 'down',
    'waveTime 的方向被显式声明为"越小越难"（房间制改变了它的含义）');
  ok(Object.keys(Danger.DIRECTION).every(k => k in Danger.BASE),
    'DIRECTION 里没有多余的键');

  const l0 = lv(0), l9 = lv(Danger.MAX);
  ok(l9.enemyHp > l0.enemyHp && l9.waveBudget > l0.waveBudget && l9.shopPrice > l0.shopPrice,
    '最高级在多个维度上都严格比第 0 级难',
    JSON.stringify({ hp: l9.enemyHp, budget: l9.waveBudget, price: l9.shopPrice }));
  ok(Math.abs(l9.enemyHp - 1.08 * 1.08) < 1e-9, '乘性修正真的相乘（1.08 × 1.08）', l9.enemyHp);
  ok(l9.bossEvery === 4 && l9.doubleBoss === true, '"结构类"两条都在最高级生效',
    'bossEvery=' + l9.bossEvery + ' doubleBoss=' + l9.doubleBoss);
}

/* ---------------- 4. 折叠规则完备 ---------------- */
console.log('\n[4] 折叠规则完备');
{
  const missingFold = Object.keys(Danger.BASE).filter(k => !Danger.FOLD[k]);
  ok(missingFold.length === 0,
    '每个修正键都有折叠方式（漏了它会以基准值混进结果、永远不生效）', missingFold.join(','));
  const unknownFold = Object.keys(Danger.FOLD).filter(k => !(k in Danger.BASE));
  ok(unknownFold.length === 0, '没有多余的折叠规则', unknownFold.join(','));
  const badKind = Object.keys(Danger.FOLD).filter(k => ['mul', 'add', 'min', 'or'].indexOf(Danger.FOLD[k]) < 0);
  ok(badKind.length === 0, '折叠方式都是已知的四种', badKind.join(','));

  const declared = new Set();
  for (const d of Danger.LIST) for (const k in d.mods) declared.add(k);
  const neverUsed = Object.keys(Danger.BASE).filter(k => !declared.has(k));
  ok(neverUsed.length === 0, '每个键都至少被某一级用到（否则它是死配置）', neverUsed.join(','));

  const noNote = Object.keys(Danger.BASE).filter(k => !Danger.NOTES[k]);
  ok(noNote.length === 0, '每个键都写了说明与用在哪', noNote.join(','));
}

/* ---------------- 5. 每个键都必须真的被读 ---------------- */
console.log('\n[5] 声明了却没人读 = 这条修正是假的（静态检查）');
{
  /* 读键的地方不一定在 game.ts 里了：局内经济（商店/道具包/营地）已经切到 market.ts。
     所以这里查的是"**模拟层**里有没有人读它"，而不是某一个具体文件。 */
  const files = ['game.ts', 'market.ts', 'enemies.ts'];
  const src = files.map(f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8')).join('\n');
  const unread = Object.keys(Danger.BASE).filter(k => src.indexOf(k) < 0);
  ok(unread.length === 0,
    '每个修正键都在模拟层（' + files.join(' / ') + '）里被读过（键名与读取名一致，故意不做映射层）',
    unread.join(', '));
  // NOTES 里申报的位置也必须真有这个键（防止说明写歪）
  const misDeclared = Object.keys(Danger.NOTES).filter(k => {
    const m = /（([a-z.]+\.ts)/.exec(Danger.NOTES[k]);
    if (!m) return false;
    const f = m[1];
    try { return fs.readFileSync(path.join(ROOT, 'src', f), 'utf8').indexOf(k) < 0; } catch (e) { return true; }
  });
  ok(misDeclared.length === 0, '说明里申报的"用在哪"确实在读这个键', misDeclared.join(','));
}

/* ---------------- 6. buildWave 的恒等性与真实效果 ---------------- */
console.log('\n[6] 刷怪队列：恒等性 + 修正真的生效');
{
  const q = (wave, mods) => JSON.stringify(Enemies.buildWave(wave, U.rng(1234), mods));
  ok(q(7, undefined) === q(7, Danger.BASE), '不传修正 与 传基准 逐位一致',
    '两个基准之间不该有任何差别');
  ok(q(7, Danger.BASE) === q(7, Danger.modsFor(0)), '基准 与 modsFor(0) 逐位一致');

  const base8 = Enemies.buildWave(8, U.rng(99), Danger.BASE);
  const hard8 = Enemies.buildWave(8, U.rng(99), Danger.modsFor(8));
  const bossBase = base8.filter(e => e.boss).length;
  const bossHard = hard8.filter(e => e.boss).length;
  ok(bossBase + bossHard > 0, '第 8 波在某一难度下确实有 Boss', bossBase + '/' + bossHard);

  // wave 8：基准每 5 波出 Boss（8 不是），L8 起每 4 波出（8 是）→ 结构类修正看得见
  const w8base = Enemies.buildWave(8, U.rng(7), Danger.BASE).filter(e => e.boss).length;
  const w8hard = Enemies.buildWave(8, U.rng(7), Danger.modsFor(8)).filter(e => e.boss).length;
  ok(w8base === 0 && w8hard === 1, 'Boss 频率修正真的改了出 Boss 的波次（第 8 波：0 → 1）',
    w8base + ' → ' + w8hard);

  // 并集而不是替换：把间隔压小**不能**取消原有的 Boss 波（实测踩过这个坑）
  const lostBase = [5, 10, 15, 20].filter(w => {
    const b = Enemies.buildWave(w, U.rng(7), Danger.BASE).filter(e => e.boss).length;
    const h = Enemies.buildWave(w, U.rng(7), Danger.modsFor(Danger.MAX)).filter(e => e.boss).length;
    return h < b;
  });
  ok(lostBase.length === 0, '提高难度不会取消任何原有的 Boss 波', lostBase.join(','));

  const w10hard = Enemies.buildWave(10, U.rng(7), Danger.modsFor(Danger.MAX)).filter(e => e.boss).length;
  ok(w10hard === 2, '最高级在第 10 波出两只 Boss（双王）', w10hard);

  // poolShift 的咬合力只在前期（非 Boss 怪第 7 波就全解锁了）—— 这是它的真实边界
  const early = Enemies.buildWave(1, U.rng(5), Danger.modsFor(8));
  const earlyIds = new Set(early.map(e => e.id));
  const baseIds = new Set(Enemies.buildWave(1, U.rng(5), Danger.BASE).map(e => e.id));
  ok([...earlyIds].some(id => !baseIds.has(id)),
    '第 1 波就能碰到原本第 3 波才解锁的怪（poolShift 前期有效）', [...earlyIds].join(','));

  const long0 = Enemies.buildWave(12, U.rng(3), Danger.BASE).length;
  const long9 = Enemies.buildWave(12, U.rng(3), Danger.modsFor(9)).length;
  ok(long9 > long0, '最高级的每波刷怪预算更大（12 波：' + long0 + ' → ' + long9 + '）');
}

/* ---------------- 7. 会话里真的应用了 ---------------- */
console.log('\n[7] 一局里的真实效果（同一 seed，只差难度）');
{
  const e0 = Game.newRun('ranger', 4321, 0).player;
  const s0 = Game.getSession();
  Game._internals.spawnEnemy('brute', 100, 100);
  const hp0 = s0.enemies[s0.enemies.length - 1].maxHp;
  const maxHp0 = s0.stats.maxHp;

  const s9 = Game.newRun('ranger', 4321, 9);
  const p9 = s9.player;
  Game._internals.spawnEnemy('brute', 100, 100);
  const hp9 = s9.enemies[s9.enemies.length - 1].maxHp;

  const want = 1.08 * 1.08;
  ok(Math.abs(hp9 / hp0 - want) < 1e-9, '敌人生命按折叠后的倍率放大（×' + want.toFixed(4) + '）',
    hp0 + ' → ' + hp9 + '（比 ' + (hp9 / hp0).toFixed(4) + '）');
  ok(p9.hp < s9.stats.maxHp, '最高级开局不满血（startHpFrac）', p9.hp + '/' + s9.stats.maxHp);
  ok(s9.danger === 9 && s9.dmods.enemyHp === want, '会话带着难度等级与折叠后的修正',
    JSON.stringify({ danger: s9.danger, hp: s9.dmods.enemyHp }));

  // 商店：货架少一件 + 售价上浮（货架上的成品是**应急价**：还要乘 craft.ts 的溢价）
  Game._internals.openShop(0);
  const offers9 = s9.offers.length;
  const price9 = s9.offers[0].price;
  const basePrice = globalThis.Weapons.priceOf(s9.offers[0].def, s9.stats.luck) * globalThis.Craft.EMERGENCY_MARKUP;
  ok(offers9 === 6, '最高级货架少一件（4+4 → 3+3）', offers9);
  ok(price9 === Math.round(basePrice * 1.1), '售价按倍率上浮',
    Math.round(basePrice) + ' → ' + price9 + '（期望 ' + Math.round(basePrice * 1.1) + '）');

  const s0b = Game.newRun('ranger', 4321, 0);
  Game._internals.openShop(0);
  ok(s0b.offers.length === 8, '第 0 级仍是 4+4 货架', s0b.offers.length);
  ok(s0b.offers[0].price === Math.round(globalThis.Weapons.priceOf(s0b.offers[0].def, s0b.stats.luck) * globalThis.Craft.EMERGENCY_MARKUP),
    '第 0 级不加**难度**价（只有应急溢价）');
  ok(maxHp0 > 0 && e0.hp === maxHp0, '第 0 级开局满血', e0.hp + '/' + maxHp0);
}

/* ---------------- 8. 每角色进度 ---------------- */
console.log('\n[8] 进度按角色独立（StS 式：打赢第 N 级才解锁 N+1）');
{
  Profile.reset();
  ok(Profile.dangerOf('ranger') === 0, '默认只有第 0 级');
  ok(Profile.unlockDanger('ranger', 3) === true && Profile.dangerOf('ranger') === 3, '解锁到第 3 级');
  ok(Profile.unlockDanger('ranger', 1) === false && Profile.dangerOf('ranger') === 3, '只升不降');
  ok(Profile.unlockDanger('ranger', 999) === true && Profile.dangerOf('ranger') === Danger.MAX,
    '越界夹回最高级', Profile.dangerOf('ranger'));
  Profile.unlockDanger('mage', 2);
  ok(Profile.dangerOf('ranger') === Danger.MAX && Profile.dangerOf('mage') === 2,
    '角色之间独立', Profile.dangerOf('ranger') + ' / ' + Profile.dangerOf('mage'));

  // 通关才解锁下一级
  Profile.reset();
  const runAt = (danger, win) => ({
    char: 'ranger', wave: 20, level: 20, kills: 900, scrap: 2000,
    damage: 1, taken: 1, healed: 1, packs: 0, win: win, danger: danger, peaks: {}
  });
  let rep = Profile.applyRun(runAt(0, false), {});
  ok(rep.dangerUnlocked === 0 && Profile.dangerOf('ranger') === 0, '没通关 → 不解锁难度');
  rep = Profile.applyRun(runAt(0, true), {});
  ok(rep.dangerUnlocked === 1 && Profile.dangerOf('ranger') === 1, '第 0 级通关 → 解锁第 1 级');
  rep = Profile.applyRun(runAt(1, true), {});
  ok(rep.dangerUnlocked === 2, '第 1 级通关 → 解锁第 2 级');
  rep = Profile.applyRun(runAt(0, true), {});
  ok(rep.dangerUnlocked === 0, '回头打低难度通关不会重复解锁', rep.dangerUnlocked);
  // 先真的解锁到最高级，再在最高级通关 —— 而不是直接跳到最高级
  Profile.unlockDanger('ranger', Danger.MAX);
  rep = Profile.applyRun(runAt(Danger.MAX, true), {});
  ok(rep.dangerUnlocked === 0 && Profile.dangerOf('ranger') === Danger.MAX, '最高级通关不再往上解锁',
    rep.dangerUnlocked + ' / ' + Profile.dangerOf('ranger'));

  // 坏档里的难度被夹回
  globalThis.Storage.setJSON(globalThis.Storage.KEYS.profile, {
    v: 1, at: Date.now(), kind: 'profile',
    data: { perChar: { ranger: { runs: 1, danger: 999 } } }
  });
  Profile.load();
  ok(Profile.dangerOf('ranger') === Danger.MAX, '坏档里的 999 被夹到最高级（不是直接给最后一级）',
    Profile.dangerOf('ranger'));
  Profile.reset();
}

/* ---------------- 9. 通关条件 ---------------- */
console.log('\n[9] 通关条件（阶梯的解锁规则需要它）');
{
  ok(Dungeon.FLOORS > 1, '配置里有楼层数（' + Dungeon.FLOORS + '）—— 通关条件挂在最后一层');
  const s = Game.newRun('ranger', 777, 0);
  const clearRoom = () => {
    const ss = Game.getSession();
    ss.waveLeft = 0; ss.spawnQueue = []; ss.spawnIdx = 0;
    ss.enemies.length = 0;
    Game.setState('playing', true);
    Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });
  };
  let winEvt = null;
  Game.events.on('runWin', d => { winEvt = d; });
  ok(s.floor === 1 && !!s.map, '开局就长好了第一层地图', s.map ? s.map.count + ' 间' : '没有地图');

  /* 真的沿地图走到底：每一层用 Dungeon.path 算到 Boss 房的路，一步步走门进去。
     不做"把 Game.wave 摆到某一波"那种摆拍 —— 那样测的就不是通关条件本身了。
     走门用 Game.enterRoom（商店里也能走），而不是 nextWave：
     nextWave 走的是"自动探索"（最近的一间没打过的房），那不是去 Boss 的最短路径。 */
  const dirTo = (a, b) => {
    for (let d = 0; d < 4; d++) {
      if (a.x + Dungeon.DIRS[d][0] === b.x && a.y + Dungeon.DIRS[d][1] === b.y) return d;
    }
    return -1;
  };
  const stepTowardBoss = () => {
    const sess = Game.getSession();
    const path = Dungeon.path(sess.map, sess.roomId, sess.map.boss, sess.walls);
    if (path.length < 2) return false;
    const cur = Dungeon.roomById(sess.map, sess.roomId);
    const nxt = Dungeon.roomById(sess.map, path[1]);
    return Game.enterRoom(dirTo(cur, nxt));
  };
  let guard = 0, walked = 0;
  while (Game.getSession().floor <= Dungeon.FLOORS && guard++ < 400) {
    const sess = Game.getSession();
    const st = Game.state;
    if (st === 'end') break;
    if (st === 'levelup') { Game.chooseLevelCard(0); continue; }
    // 战斗中：把这一间打完（清场即过 → 进商店 / 翻层）
    if (st === 'playing') { clearRoom(); continue; }
    // 商店/营地里：走一扇门（往 Boss 的方向）
    if (st === 'shop' || st === 'camp') {
      const before = sess.roomId;
      ok(stepTowardBoss(), '走门成功（第 ' + sess.floor + ' 层 · ' + before + '）');
      walked++;
      continue;
    }
    ok(false, '意外的状态：' + st);
    break;
  }
  ok(walked >= Dungeon.FLOORS, '三层是一间一间走过去的（共走了 ' + walked + ' 次门）', walked);
  ok(Game.state === 'end', '打完最后一层的 Boss 后进入结算（而不是进商店）', Game.state);
  ok(!!winEvt && winEvt.floor === Dungeon.FLOORS, '发出了 runWin 事件', JSON.stringify(winEvt));
  ok(Game.summary().win === true, '结算摘要把这一局记为 win');
  ok(Game.getSession().won === true, '会话里写下了"通关"这个事实（成绩码回放按它核对）');
  ok(Game.getSession().floor === Dungeon.FLOORS, '通关时停在最后一层', Game.getSession().floor);

  // 只在第 1 层时不该触发：打完第 1 层 Boss 只是翻层
  Game.newRun('ranger', 777, 0);
  const s2 = Game.getSession();
  s2.roomId = s2.map.boss;
  clearRoom();
  ok(Game.state === 'shop', '第 1 层 Boss 之后是"下一层的商店"（不是结算）', Game.state);
  ok(s2.floor === 2, '翻到了第 2 层', s2.floor);
  Game.setState('title', true);
}

/* ---------------- 10. 登记与可读性 ---------------- */
console.log('\n[10] 总账与可读性');
{
  const a = Registry.audit();
  const probs = a.problems.filter(p => p.family === 'dangerLevel');
  ok(probs.length === 0, 'registry 审计对难度家族不报错',
    probs.slice(0, 3).map(p => p.id + '.' + p.field).join(','));
  ok(Registry.count('dangerMod') === Object.keys(Danger.BASE).length,
    'dangerMod 家族就是全部修正键', Registry.count('dangerMod'));

  const desc = Danger.describe(Danger.MAX);
  ok(desc.indexOf('×') >= 0 && desc.split('\n').length > 3, 'describe 给出可读的累计修正');
  const d = Danger.deltaOf(5);
  ok(d.length === 2 && d.every(x => x.key), 'deltaOf 给出"这一级新增了什么"', JSON.stringify(d));
  ok(Danger.name(3) && Danger.name(3) !== Danger.name(4), '不同级有不同名字');
}

console.log('\n=== 结果 ===');
if (failures === 0) { console.log('\x1b[32m全部通过 ✔\x1b[0m\n'); process.exit(0); }
console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m\n');
process.exit(1);
