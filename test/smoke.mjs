/* =========================================================
   smoke.ts — 无头冒烟测试
   在 Node 中加载全部模拟层代码，自动跑多个波次，
   验证：语法、运行时异常、伤害/击杀/掉落/升级/商店/结算闭环。
   用法： node test/smoke.mjs
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

/* ---------------- 加载 ---------------- */
console.log('\n=== Bronana · 无头冒烟测试 ===\n');
console.log('[1] 加载模拟层');
let loadErr = null;
try { await loadAll(SIM_MODULES); } catch (e) { loadErr = e.message + '\n      ' + (e.stack.split('\n')[1] || '').trim(); }
ok(!loadErr, '全部模拟层模块以 ES 模块方式加载成功', loadErr);
if (loadErr) process.exit(1);

const { U, Game, Chars, Weapons, Items, Enemies, Stats, Arena } = globalThis;
ok(!!U && !!Game && !!Chars && !!Weapons && !!Items && !!Enemies && !!Stats, '全部模块注册到全局');

/* ---------------- 数据完整性 ---------------- */
console.log('\n[2] 数据完整性');
ok(Weapons.LIST.length >= 20, '武器数量 ≥ 20', Weapons.LIST.length);
ok(Items.LIST.length >= 25, '道具数量 ≥ 25', Items.LIST.length);
ok(Chars.LIST.length >= 6, '角色数量 ≥ 6', Chars.LIST.length);
ok(Object.keys(Enemies.BY_ID).length >= 10, '怪物种类 ≥ 10', Object.keys(Enemies.BY_ID).length);

let dataErr = [];
Weapons.LIST.forEach(w => {
  if (!w.id || !w.name || !w.kind || !w.type) dataErr.push('weapon:' + w.id);
  if (!(w.dmg > 0) || !(w.cd > 0) || !(w.reach > 0)) dataErr.push('weapon stats:' + w.id);
  if (w.type === 'ranged' && !(w.speed > 0)) dataErr.push('weapon speed:' + w.id);
});
Items.LIST.forEach(i => {
  if (!i.id || !i.name || !i.icon) dataErr.push('item:' + i.id);
  const st = i.stats || {};
  Object.keys(st).forEach(k => {
    if (!Stats.DEF[k]) dataErr.push('item unknown stat ' + i.id + '.' + k);
  });
});
Chars.LIST.forEach(c => {
  if (!c.id || !c.name) dataErr.push('char:' + c.id);
  Object.keys(c.stats || {}).forEach(k => {
    if (!Stats.DEF[k]) dataErr.push('char unknown stat ' + c.id + '.' + k);
  });
  (c.startWeapons || []).forEach(id => {
    if (!Weapons.BY_ID[id]) dataErr.push('char ' + c.id + ' bad weapon ' + id);
  });
});
ok(dataErr.length === 0, '武器/道具/角色数据字段合法', dataErr.slice(0, 6).join(', '));

// 所有怪物都有渲染所需字段
let enemyErr = [];
Enemies.LIST.forEach(d => {
  if (!d.color || !d.dark || !d.shape) enemyErr.push(d.id);
});
ok(enemyErr.length === 0, '怪物造型字段齐全', enemyErr.join(', '));

/* ---------------- 属性公式的边界 ----------------
   这一节补的是一块**从来没人测过**的地方：`Stats.moveSpeed` / `damageTaken` 是
   "玩家的命"与"怪打你多疼"的唯一出口，而两条公式各有一个静默的极端：
     · 负 speed 恒等于 0（`Math.max(0, s.speed)` 让 `Math.sign` 那个因子永远乘到 0）
       → 掘进者/工程师/基石/契约/套装/护甲上写着的那 6 处负速**一点效果都没有**；
     · 护甲在 -14 有一个极点（分母跨 0）→ 伤害 Infinity 一击必死，-14 以下还反转
       （护甲更差反而更不疼）。护甲是整数、-14 恰好命中，所以它是**能凑出来**的。
   两条都不是"平衡"问题，是"写着的规则没生效"和"数学上会炸"。 */
console.log('\n[2b] 属性公式的边界（护甲极点 / 负速度 / 单调性）');
{
  const dmgAt = a => Stats.damageTaken({ armor: a }, 10);
  ok(isFinite(dmgAt(-14)) && dmgAt(-14) === 15,
    '护甲 -14 不再是一击必死（分母取 |armor|+14：极点没了，-14 → ×1.5）', dmgAt(-14));
  const ladder = [-40, -20, -15, -14, -13, -10, -9, -6, -3, 0, 7, 14, 30].map(dmgAt);
  let mono = true;
  for (let i = 1; i < ladder.length; i++) if (ladder[i] > ladder[i - 1] + 1e-9) mono = false;
  ok(mono, '受伤倍率随护甲**单调不增**（-13 → ×14、-14 → ×∞、-15 → ×0.22 那种反转已经没了）',
    ladder.map(x => x.toFixed(2)).join(' '));
  ok(dmgAt(-40) > dmgAt(-14) && dmgAt(-40) < 18,
    '负侧有界：护甲越低越疼，但不会失控（-∞ 时 ×1.74）', dmgAt(-40));
  ok(Math.abs(dmgAt(0) - 10) < 1e-9 && dmgAt(7) < 10 && dmgAt(30) < dmgAt(7),
    '正侧曲线没被动过（0 护甲 = 原伤害；护甲越高越不疼）',
    dmgAt(0) + ' / ' + dmgAt(7) + ' / ' + dmgAt(30));
  ok(dmgAt(7) === Math.max(1, 10 * (1 - Math.min(0.78, 7 / 21))),
    '正侧与改造前逐位一致（a ≥ 0 时 |a| = a，同一条公式）', dmgAt(7));
  ok(isFinite(dmgAt(Infinity)) && isFinite(dmgAt(NaN)), '护甲是 NaN / ∞ 时也不放行（当 0 算）');

  const mv = s => Stats.moveSpeed({ speed: s });
  ok(mv(0) === 205, '0 加成 = 基础移速 205', mv(0));
  ok(mv(-0.12) < 205 && mv(-0.12) > 204,
    '负 speed **真的减速**（-12% ≈ -0.94 px/s）—— 以前是精确的 0，6 处负速数据形同虚设',
    mv(-0.12));
  ok(mv(0.12) > 205 && mv(0.12) < 206, '正 speed 照旧加速（与负侧对称）', mv(0.12));
  ok(mv(-0.12) - mv(0) === -(mv(0.12) - mv(0)), '正负两侧严格对称（同一个公式，只有符号不同）');
  ok(mv(NaN) === 205 && mv(Infinity) === 205 + 8 * 2, 'NaN 当 0、∞ 夹在封顶 2.0',
    mv(NaN) + ' / ' + mv(Infinity));
}

/* ---------------- 完整跑一局 ---------------- */
console.log('\n[3] 自动对战（模拟真实玩家操作）');

const wavesToPlay = parseInt(process.env.WAVES || '12', 10);
const stats = { frames: 0, levelups: 0, shops: 0, buys: 0, rerolls: 0, sells: 0, kills: 0, maxEnemies: 0 };

const FIXED = Game.cfg.fixedDt;
const MAX_FRAMES = 60 * 60 * 30;   // 硬上限：30 分钟游戏内时间

let runErr = null;
const t0 = Date.now();

try {
  Game.events.on('levelup', () => {
    stats.levelups++;
    /* 自动选卡。**必须是确定性的** —— 这里以前是
         Game.chooseLevelCard(Math.floor(Math.random() * sess.levelCards.length));
       而下面 L153 的注释写着"测量要可复现，所以这里钉死种子"：
       **种子钉了、随机数没钉**，于是这一段的击杀数在两次跑之间能从 334 掉到 11
       （实测三次：13波/334杀 · 13波/345杀 · 2波/11杀），
       `击杀数 > 20` 就成了一条会随机变红的断言 —— 而"钉死种子"那句话让它看起来已经修好了。
       现在按**等级取模**选：既有变化（不是永远选第一张），又完全可复现。
       与 `tools/fingerprint.mjs` 的 `chooseLevelCard(0)` 同一个道理。 */
    const n = sess.levelCards.length;
    Game.chooseLevelCard(n > 0 ? (sess.player.level % n) : 0);
  });

  Game.events.on('shopOpen', () => {
    stats.shops++;
    const sess = Game.getSession();
    if (!sess) return;
    if (stats.shops % 3 === 0 && sess.offers.length) Game.reroll();
    if (sess.player.weapons.length > 3 && stats.shops > 4) {
      if (Game.sellWeapon(sess.player.weapons.length - 1)) stats.sells++;
    }
    // 买得起就买（武器优先），最多买到 6 把
    let guard = 0;
    let bought = true;
    while (bought && guard++ < 12) {
      bought = false;
      for (let i = 0; i < sess.offers.length; i++) {
        const o = sess.offers[i];
        if (o.sold) continue;
        if (o.type === 'weapon' && sess.player.weapons.length >= Game.cfg.maxWeapons) continue;
        if ((sess.player.scrap || 0) >= o.price) {
          if (Game.buyOffer(i)) { stats.buys++; bought = true; }
        }
      }
    }
    Game.nextWave();
  });

  /* **显式种子**：不传种子时 `newRun` 用 Date.now() 当种子，于是这一段"机器人打一局"
     每次跑的结果都不一样 —— `击杀数 > 20` 就成了一条会随机变红的断言
     （实测撞到过刚好 20）。测量要可复现，所以这里钉死种子。 */
  Game.newRun('ranger', 20240922);
  const sess = Game.getSession();
  ok(!!sess, '会话已创建');
  ok(sess.player.weapons.length === 1, '起始武器已装配', sess.player.weapons.length);

  let t = 0;
  while (Game.state !== 'end' && Game.state !== 'shop' && Game.wave <= wavesToPlay && stats.frames < MAX_FRAMES) {
    if (Game.state === 'playing') {
      Game.step(FIXED, Game.autoInput(t));
      t += FIXED;
      stats.frames++;
      if (sess.enemies.length > stats.maxEnemies) stats.maxEnemies = sess.enemies.length;
      // 自动回血，保证跑到高波次（仅测试用）
      if (sess.player.hp < sess.stats.maxHp * 0.25) Game.healPlayer(sess.stats.maxHp);
    } else if (Game.state === 'levelup') {
      Game.chooseLevelCard(0);
    } else if (Game.state === 'shop') {
      break;
    } else {
      break;
    }
  }
} catch (e) {
  runErr = e;
}

const ms = Date.now() - t0;
ok(!runErr, '对战过程无运行时异常', runErr && (runErr.message + '\n' + runErr.stack.split('\n').slice(1, 4).join('\n')));
if (runErr) {
  console.log('\n\x1b[31m运行中断，后续断言跳过\x1b[0m\n');
  process.exit(1);
}

const s = Game.getSession();
stats.kills = s.stats_total.kills;

console.log('  模拟帧数 ' + stats.frames + '（≈' + (stats.frames / 60).toFixed(1) + ' 秒游戏时间），耗时 ' + ms + 'ms');
console.log('  波次 ' + Game.wave + ' · 击杀 ' + stats.kills + ' · 升级 ' + stats.levelups +
  ' · 商店 ' + stats.shops + ' · 购买 ' + stats.buys + ' · 卖出 ' + stats.sells +
  ' · 同屏最多怪物 ' + stats.maxEnemies);

console.log('');
ok(stats.frames > 600, '模拟运行了足够帧数', stats.frames);
ok(stats.kills > 20, '击杀数正常（伤害/死亡链路通）', stats.kills);
ok(stats.shops > 0, '波次结算并进入商店', stats.shops);
ok(Game.wave >= 2, '推进到第 2 波以上', Game.wave);
ok(Object.keys(Game._internals.grid.cellCounts()).length >= 0 && s.enemies.length < 500,
    '同屏怪物数量受控（网格账目读得出来 + 敌人上限生效）',
    stats.maxEnemies + ' 只 · 用了 ' + Game._internals.grid.stats().used + '/' + Game._internals.grid.stats().cells + ' 格');

/* 升级链路：**不靠"机器人恰好捡够材料"**。
   材料掉落要靠角色走过去捡（拾取半径），而这个机器人是"直线远离最近的怪"——
   它捡到多少纯看运气，于是 `levelups > 0` 会时红时绿（实测：换一个种子就 0 次）。
   所以这里摆好条件直接把链路走一遍。
   注意本套件在 [3] 注册过一个 `levelup` 监听器，它会**顺手把卡选掉** ——
   所以断言看的是"等级涨了、状态回得来"，而不是"停在选卡界面"。 */
var lvBefore = s.player.level;
Game.setState('playing', true);          // 上面那一局可能已经阵亡，升级链路是另一条链路
s.player.hp = s.stats.maxHp;
s.player.pendingLevels = 0;
s.player.xp = s.player.xpNeed;
Game._internals.checkLevelUp();
ok(s.player.level > lvBefore, '升级链路触发（经验够了就升级）', lvBefore + ' → ' + s.player.level);
ok(Game.state === 'playing' && s.levelCards.length === 0,
  '选卡链路完整（卡被选掉 → 回到战斗且货架清空）', Game.state + ' · ' + s.levelCards.length + ' 张');

/* ---------------- 边界与稳定性 ---------------- */
console.log('\n[4] 边界与稳定性');

// 商店买不起时的拒绝路径
const before = s.player.scrap;
s.player.scrap = 0;
const denied = !Game.buyOffer(0);
ok(denied || s.offers.every(o => o.sold), '材料不足时购买被正确拒绝');
s.player.scrap = before;

// 武器槽上限
s.player.weapons.length = 0;
for (let i = 0; i < 12; i++) Game.addWeapon('pistol');
ok(s.player.weapons.length === Game.cfg.maxWeapons, '武器槽上限 6 生效', s.player.weapons.length);

// 全部角色都能开局并跑 3 秒
console.log('\n[5] 全角色开局验证');
let charErr = [];
Chars.LIST.forEach(c => {
  try {
    Game.newRun(c.id);
    const cs = Game.getSession();
    for (let i = 0; i < 180; i++) Game.step(FIXED, { x: Math.cos(i / 20), y: Math.sin(i / 20) });
    if (!(cs.stats.maxHp > 0) || !isFinite(cs.player.hp)) charErr.push(c.id + ' 属性异常');
    if (cs.player.weapons.length < 1) charErr.push(c.id + ' 无起始武器');
  } catch (e) {
    charErr.push(c.id + ': ' + e.message);
  }
});
ok(charErr.length === 0, '全部 ' + Chars.LIST.length + ' 个角色可正常开局', charErr.join(' | '));

// 全部武器都能开火（覆盖每种 kind 的攻击路径）
console.log('\n[6] 全武器开火验证');
let weaponErr = [];
Game.newRun('ranger');
let ws = Game.getSession();
/* 钉住这一间：房间制下"场上清空"就等于打完这一间 ——
   测试每帧自己摆一个靶子，靶子被打死后这一间会当场结算进商店，
   于是后面所有帧都不再推进，武器看起来"没开火"（实测 orb 只记到 1 次）。 */
holdRoom(ws);
Weapons.LIST.forEach(w => {
  try {
    ws.player.weapons.length = 0;
    const inst = Game.addWeapon(w.id);
    if (!inst) { weaponErr.push(w.id + ' 无法装配'); return; }
    ws.shots = 0;
    for (let i = 0; i < 480; i++) {
      // 保持测试角色不死，且场上始终只有一个测试靶子
      ws.player.hp = ws.stats.maxHp;
      ws.enemies.length = 0;
      Game._internals.spawnEnemy('grub', ws.player.x + 90, ws.player.y, {});
      Game.step(FIXED, { x: 0, y: 0 });
    }
    if (!(ws.shots >= 2)) weaponErr.push(w.id + ' 未开火(shots=' + ws.shots + ')');
  } catch (e) {
    weaponErr.push(w.id + ': ' + e.message);
  }
});
ok(weaponErr.length === 0, '全部 ' + Weapons.LIST.length + ' 把武器可正常开火', weaponErr.join(' | '));

// 全部怪物类型都能生成、行动、被击杀
console.log('\n[7] 全怪物验证');
let mobErr = [];
Game.newRun('ranger');
ws = Game.getSession();
Enemies.LIST.forEach(d => {
  try {
    const e = Game._internals.spawnEnemy(d.id, ws.player.x + 150, ws.player.y, {});
    if (!e) { mobErr.push(d.id + ' 生成失败'); return; }
    for (let i = 0; i < 90; i++) Game.step(FIXED, { x: 0, y: 0 });
    if (!isFinite(e.x) || !isFinite(e.y) || !isFinite(e.hp)) mobErr.push(d.id + ' 数值异常');
    Game.damageEnemy(e, 99999, { fromX: ws.player.x, fromY: ws.player.y });
    Game.step(FIXED, { x: 0, y: 0 });
    if (!e.dead) mobErr.push(d.id + ' 无法被击杀');
  } catch (err) {
    mobErr.push(d.id + ': ' + err.message);
  }
});
ok(mobErr.length === 0, '全部 ' + Enemies.LIST.length + ' 种怪物行为正常', mobErr.join(' | '));

/* ---------------- 抖动请求事件（模拟层侧） ---------------- */
console.log('\n[8] 抖动请求事件');
{
  const shakes = [];
  const onShake = a => shakes.push(a);
  Game.events.on('shake', onShake);

  Game.newRun('ranger', 4321);
  const s8 = Game.getSession();
  holdRoom(s8);
  s8.player.invuln = 999;          // 免伤，先测"平静时不该抖"
  s8.enemies.length = 0;
  shakes.length = 0;
  for (let i = 0; i < 60; i++) { holdRoom(s8); Game.step(FIXED, { x: 0, y: 0 }); }
  ok(shakes.length === 0, '平静状态不请求抖动', shakes.length + ' 次');

  // 玩家受击
  s8.player.invuln = 0;
  s8.enemies.length = 0;
  const foe = Game._internals.spawnEnemy('grub', s8.player.x, s8.player.y, {});
  if (foe) foe.spawnT = 0;
  shakes.length = 0;
  for (let i = 0; i < 240 && shakes.length === 0; i++) {
    holdRoom(s8);
    s8.player.hp = s8.stats.maxHp;   // 别死
    Game.step(FIXED, { x: 0, y: 0 });
  }
  ok(shakes.length > 0, '玩家受击请求抖动', shakes.join(','));
  ok(shakes.length > 0 && shakes.every(a => a > 0 && a <= 1), '抖动请求值在 (0,1] 区间', shakes.join(','));

  // 自爆怪死亡
  s8.enemies.length = 0;
  const boom = Game._internals.spawnEnemy('exploder', s8.player.x + 200, s8.player.y, {});
  if (boom) boom.spawnT = 0;
  shakes.length = 0;
  Game.damageEnemy(boom, 99999, { fromX: s8.player.x, fromY: s8.player.y });
  ok(shakes.length > 0, '爆炸死亡请求抖动', shakes.join(','));

  // Boss 倒下：应显著强于普通事件
  s8.enemies.length = 0;
  const boss = Game._internals.spawnEnemy('warden', s8.player.x + 300, s8.player.y, {});
  if (boss) boss.spawnT = 0;
  shakes.length = 0;
  Game.damageEnemy(boss, 9999999, { fromX: s8.player.x, fromY: s8.player.y });
  const bossShake = shakes.length ? Math.max(...shakes) : 0;
  console.log('    Boss 死亡抖动强度 ' + bossShake);
  ok(bossShake >= 0.5, 'Boss 倒下给出明显更强的抖动', bossShake);

  Game.events.off('shake', onShake);
}

/* ---------------- 血迹贴花（模拟层侧） ---------------- */
console.log('\n[9] 血迹贴花');
{
  Game.newRun('ranger', 31337);
  enterFightRoom(); Game._internals.startWave(3);        // 低波次：怪物血少，击杀快
  const s = Game.getSession();
  s.player.weapons.length = 0;
  ['minigun', 'minigun', 'flame', 'shotgun', 'laser', 'orb'].forEach(id => Game.addWeapon(id));
  Items.LIST.slice(0, 6).forEach(it => s.player.items.push({ def: it }));
  Game.recalcStats();

  const cap = Game.cfg.decalCap;
  const seconds = 20;
  let maxLen = 0, maxSeq = 0;
  for (let i = 0; i < 60 * seconds; i++) {
    s.player.invuln = 999;          // 免伤 → 不会有"玩家出血"混进来
    holdRoom(s);
    while (Game.state !== 'playing') {
      if (Game.state === 'levelup') Game.chooseLevelCard(0); else Game.nextWave();
    }
    // 贴着玩家刷怪，保证击杀速率远高于贴花容量
    if (s.enemies.length < 60) {
      Game._internals.spawnEnemy('grub', s.player.x + 50, s.player.y + 20, {});
      Game._internals.spawnEnemy('grub', s.player.x - 50, s.player.y - 20, {});
    }
    Game.step(FIXED, Game.autoInput(i / 60));
    maxLen = Math.max(maxLen, s.decals.length);
    maxSeq = Math.max(maxSeq, s.decalSeq);
  }

  const kills = s.stats_total.kills;
  const hitStains = Math.max(0, maxSeq - kills);
  const budget = Game.cfg.stainPerSec * seconds + Game.cfg.stainBurst;
  console.log('    ' + seconds + ' 秒：击杀 ' + kills + ' 次，贴花写入 ' + maxSeq +
    ' 次（其中命中溅血约 ' + hitStains + '），缓冲 ' + maxLen + '/' + cap);
  ok(maxSeq >= kills, '每一次击杀都留下血迹（旧实现 90 次后全部丢失）',
    maxSeq + ' ≥ ' + kills);
  ok(maxLen <= cap, '贴花缓冲不超过容量', maxLen + ' ≤ ' + cap);
  ok(hitStains <= budget + 1, '命中溅血受每秒预算限制（否则地面会被铺满）',
    hitStains + ' ≤ ' + Math.round(budget));
  ok(kills > cap, '击杀数超过贴花容量（否则测不出环形覆盖）', kills + ' > ' + cap);

  // 玩家自己受伤也要留血
  Game.newRun('ranger', 8888);
  const s2 = Game.getSession();
  s2.player.invuln = 0;
  s2.enemies.length = 0;
  const seq0 = s2.decalSeq;
  const foe = Game._internals.spawnEnemy('grub', s2.player.x, s2.player.y, {});
  if (foe) foe.spawnT = 0;
  for (let i = 0; i < 240 && s2.decalSeq === seq0; i++) {
    holdRoom(s2);
    s2.player.hp = s2.stats.maxHp;
    Game.step(FIXED, { x: 0, y: 0 });
  }
  const bloodStain = s2.decals.some(d => d.color === PAL.BLOOD);
  ok(s2.decalSeq > seq0, '玩家受击也会留下血迹', s2.decalSeq - seq0 + ' 条');
  ok(bloodStain, '玩家血迹用的是血迹色 PAL.BLOOD');

  // 换波清空
  enterFightRoom(); Game._internals.startWave(13);
  ok(s2.decals.length === 0 && s2.decalSeq === 0, '进入新一波时血迹清空',
    s2.decals.length + ' / seq ' + s2.decalSeq);
}

/* ---------------- 行为指纹：纯结构重构不许改变对局 ----------------
   抽模块、换注册表、改调用顺序这类重构最怕"悄悄跑出不一样的对局"——
   不报错、不崩，只是怪物走位/开火时机变了。
   这里用固定种子跑三段固定长度的对局，把状态压成哈希比对。
   哈希对随机数消费顺序极敏感，所以"把一次 rnd() 挪到别处"同样会被抓到。
   指纹变了有两种可能：① 真的改了行为（那就更新这张表，并说明为什么）；
   ② 只是换了结构（那说明重构不等价，要查）。 */
console.log('\n[指纹] 行为指纹（纯重构不得改变对局）');
{
  const { runCase } = await import('../tools/fingerprint.mjs');
  /* 基线在"房间制"那次改造后整表更新过一次（5f763627/a00dad64/b1d751da →
     4a89e77d/62b9f577/21b2e870）。那次**是故意的行为变更**，不是重构漂移，
     三处原因都写在 README 的"地牢化"一节：
       ① 一波的刷怪量现在由**房型 × 层主题**决定（Dungeon.foldMods 折进 buildWave），
          而且起点从"第 1 波"变成了"一间普通战斗房"（入口间不刷怪，测它会得到空场）；
       ② 敌人成长按 `Enemies.equivWave` 摊开（PACE=0.55：一间房 ≠ 旧的一波）；
       ③ "清空即过"取代了"撑满计时器"：一局的推进节奏变了，随机数消费点随之变化。
     有意保留的旧记录：gladiator 那条基线曾在"容器统一回收"后从 ac2a349e 变成 a00dad64
     （交换删除不保序 → 多段命中的结算顺序变了），那次也是有意接受。

     **第二次整表更新（层环境抽签）**：4a89e77d/62b9f577/21b2e870 →
     76b6aaa3/fb57410d/ed7c1067。这一次同样**必须**变，而且原因只有一个：
     环境不再按层号钉死，同一层每局可能抽到带内的另一个环境，而环境的
     hpMul/dmgMul/poolShift 本来就会折进刷怪 —— 数值变了，对局自然不同。
     这一条**不能只说"应该变"**，所以做了一次排除法：把每一带钉回旧主题
     （shallow/fungal/molten），三段指纹**逐位回到旧基线**，
     证明除此之外（房间布局、随机数消费顺序、刷怪次序）没有任何位移。

     **第三次：只有 engineer 变了**（ed7c1067 → f2bbc8de，另外两段逐位不动）。
     原因是 `Stats.moveSpeed` 修掉了"负 speed 恒等于 0"那条死分支：
     engineer 的 base.speed = -0.05，以前移速 205，现在 205 − 8×0.34×√0.05 = 204.39
     （-0.61 px/s，-0.3%）。ranger / gladiator 的 speed 是 0，轨迹一位没动 ——
     这正是"改动只落在负速度上"的旁证。同类数据还有掘进者 -12%（-0.94 px/s）、
     基石「不退」/「钢铁洪流」、契约「淬火」、装甲套装、厚重护甲。

     **第四次整表更新（词条系统）**：f2bbc8de 之前的三值 →
     8b90ed4f/08205e33/f4f27172。三段**全变**，这是有意的行为变更，而且
     原因必须是**伤害变了**，不是"随机数消费顺序变了"：
       · 词条自己的随机流（`Affixes.rollStream`，由主状态派生）**一步都不推进主序列** ——
         这一点由 `test/affixes.mjs` 与这一次的旁证共同守着：如果主序列被扰动，
         那么"只改词条表、不动任何玩法数值"也会让三段指纹漂移，而那是不可能的；
       · 真正变的是**数值**：开局那几把武器带着 +6%~12% 伤害 / -4%~8% 冷却，
         清怪时刻因此整体前移，而"什么时候死、掉什么、拾取哪一帧到账"
         本来就与随机数消费点绑定 —— 于是整局轨迹跟着变。
     换句话说：这一条**不是**"重构漂移"，是"数值确实变了"。
     反过来的旁证也在：`keep.mjs` 的货栈对照（"没有货栈时不保证"）在词条接入的
     第一版里**假红过一次**，原因正是当时词条还在共用主随机流。改成派生流之后
     那条对照逐位回到原样 —— 这就是"主序列没被动"的实证。

     **第五次：两段变、一段不变**（8b90ed4f / 08205e33 / f4f27172 →
     622d6ebf / a9c2902b / f4f27172）。这又是一次**有意的数值变更**，两个来源：

       · `enemy.dmg` 的系数 0.16 → 0.37（r39 ×4.34 → ×8.73）。起因是实测
         `生命:伤害 = 6.2:1`，而七款同类游戏在 0.3:1 ~ 1.5:1 之间 ——
         见 `docs/scaling-benchmarks.md`；
       · 敌人护甲从"每击减固定值"改成**与玩家侧同一条百分比公式**
         （`Stats.armorMul`；`brute` 2→5、`warden` 3→8、`digger` 2→5），
         因为固定减伤把开局 `smg`（单击 3）削掉 67%，而 `quake`（单击 20）只削 15%。

     ⚠ **engineer 那段没变（f4f27172 逐位保留）**，这值得记一笔：它是三段里
     唯一"从第 13 波开跑、且是远程"的样本 —— 20 秒内玩家没吃到接触伤害，
     而护甲改动落在 `brute` 与两个 Boss 身上，那一段的怪池恰好没碰上。
     也就是说**这一段对"敌人伤害"这条轴不敏感**；要覆盖它得靠别的套件
     （`test/danger.mjs` 与 `pnpm run fun` 的实机落点）。

     **第六次：只有 engineer 变了**（622d6ebf / a9c2902b / f4f27172 →
     622d6ebf / a9c2902b / **354cc83c**）。来源是**词条链加深**：
     词条表的 `cap` 从"几乎全是 2"改成一条跟着物品品级长的阶梯
     （多数 4 档、三个大数值平坦防御类 3 档）。cap 只影响**物品 T3 及以上**，
     而这一段恰好是唯一捡到 T3+ 装备的样本 —— 另两段的装备都还在 T1/T2，
     词条档位没变，所以逐位保留。**这正是"改动范围 = 指纹变化范围"的又一次旁证。 */
  const CASES = [
    ['ranger', 20240922, 5, 1800, '622d6ebf'],
    ['gladiator', 777, 9, 1800, 'a9c2902b'],
    ['engineer', 4242, 13, 1200, '354cc83c']
  ];
  const drift = [];
  for (const [c, seed, wave, frames, want] of CASES) {
    const got = runCase(c, seed, wave, frames);
    if (got.hash !== want) drift.push(c + '/' + seed + ' 期望 ' + want + ' 实得 ' + got.hash);
  }
  ok(drift.length === 0, '三段固定对局的指纹与基线一致（共 ' + CASES.reduce((a, c) => a + c[3], 0) + ' 帧）',
    drift.join(' | '));
}

/* ---------------- 汇总 ---------------- */
console.log('\n=== 结果 ===');
if (failures === 0) {
  console.log('\x1b[32m全部通过 ✔\x1b[0m\n');
  process.exit(0);
} else {
  console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m\n');
  process.exit(1);
}
