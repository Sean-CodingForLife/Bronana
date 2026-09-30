/* =========================================================
   rooms.mjs — 地牢接进对局（G2）：门 · 房型内容 · 暗门墙 · 翻层 · 存档

   地图生成已经由 dungeon.mjs 用几百个种子守住了。这一套盯的是**接缝**：
   那一层纯数据接进模拟层之后，最容易静默出错的地方是
     · 房型的量（预算 / 精英 / Boss）到底有没有真的作用到刷怪上
     · 门有没有真的锁住（战斗中乱走 = 可以永远躲怪）
     · 暗门有没有真的"看不见、进不去、要打穿"
     · 翻层 / 通关 / 存档往返有没有把地图进度丢掉或算重
     · 房间内容（宝箱 / 商店房 / 营地房 / 事件房 / 密室）有没有"走进去什么都不发生"

   用法： node test/rooms.mjs
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { loadAll, SIM_MODULES, holdRoom, toShop, enterFightRoom } from './_load.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
let failures = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  \x1b[32mPASS\x1b[0m ' + label);
  else { failures++; console.log('  \x1b[31mFAIL\x1b[0m ' + label + (extra !== undefined ? '  → ' + extra : '')); }
}

await loadAll(SIM_MODULES);
const { Game, Dungeon, Danger, Enemies, Camp, Registry, Weapons, Items, U, Arena } = globalThis;
console.error = function () { };

console.log('\n=== Bronana · 地牢接进对局 ===\n');

/* ---------------- 1. 房型内容表：每一种房都得"有事发生" ---------------- */
console.log('[1] 房型内容表（房型没有内容 = 走进去什么都不发生）');
{
  const fx = Game.ROOM_FX;
  const missing = Dungeon.TYPES.filter(t => !fx[t.id]).map(t => t.id);
  ok(missing.length === 0, '每种房型都写了"进门内容"（' + Dungeon.TYPES.length + ' 种）', missing.join(','));
  const extra = Object.keys(fx).filter(id => !Dungeon.TYPE_BY_ID[id]);
  ok(extra.length === 0, '内容表里没有已不存在的房型', extra.join(','));
  const noNote = Object.keys(fx).filter(id => !fx[id].note || fx[id].note.length < 4);
  ok(noNote.length === 0, '每一种都有人话说明（界面直接用它，不另抄一份）', noNote.join(','));
  ok(Game.roomFxNote('treasure') === fx.treasure.note, 'roomFxNote 就是内容表里的那一行（单一来源）');
  // 房型自检里的 Boss/精英 语义必须与内容表一致
  ok(!!fx.boss && !!fx.elite && !!fx.secret, 'Boss / 精英 / 密室都有内容');
  // 事件房：每一条遭遇都要同时有"好处"和"代价"的文字
  const evs = Game.ROOM_EVENTS;
  ok(evs.length >= 3, '事件房至少有 3 种遭遇（只有一种就成不了"事件"）', evs.length + ' 种');
  const evBad = evs.filter(e => !e.name || !e.note || typeof e.apply !== 'function');
  ok(evBad.length === 0, '每条遭遇都有名字 / 说明 / 效果', evBad.map(e => e.id).join(','));
  ok(Registry.has('roomMod') && Registry.has('roomType') && Registry.has('floorTheme'),
    '房间相关家族都登记在总账里');
}

/* ---------------- 2. 房型的量真的作用到刷怪上 ---------------- */
console.log('\n[2] 房型 × 层主题 → 刷怪量（键名与 danger 一致，折一次）');
{
  const s = Game.newRun('ranger', 4242, 0);
  const fl = s.map;
  const at = id => Dungeon.modsFor(fl, id);
  ok(at(fl.start).waveBudget === 0, '入口间预算为 0（安全房）');
  ok(at(fl.boss).bossEvery === 1, 'Boss 房保证出 Boss');
  const fight = fl.rooms.find(r => r.type === 'fight');
  const elite = fl.rooms.find(r => r.type === 'elite');
  ok(at(fight.id).waveBudget === 1, '普通战斗房预算是基准');
  if (elite) {
    ok(at(elite.id).waveBudget > 1 && at(elite.id).eliteChance > 0,
      '精英房预算更高且带精英加成', JSON.stringify(at(elite.id)));
  } else {
    ok(true, '这一层没有精英房（地图生成允许）—— 跳过');
  }

  // 真刷一遍：同一波、同一房型，预算倍率必须体现在队列长度上
  function queueLen(roomId, wave) {
    Game.newRun('ranger', 4242, 0);
    const ss = Game.getSession();
    Game._internals.warpTo(roomId);
    Game._internals.startWave(wave);
    return ss.spawnQueue.length;
  }
  const qn = queueLen(fight.id, 6);
  ok(qn > 0, '战斗房真的刷怪（' + qn + ' 只）');
  Game.newRun('ranger', 4242, 0);
  const ss2 = Game.getSession();
  Game._internals.warpTo(ss2.map.start);
  Game._internals.startWave(6);
  ok(ss2.spawnQueue.length === 0, '入口间真的不刷怪');

  // 层主题：同一种房、同一波，第二层（更狠的主题）敌人血更多
  Game.newRun('ranger', 4242, 0);
  const s1 = Game.getSession();
  const fight1 = s1.map.rooms.find(r => r.type === 'fight');
  Game._internals.warpTo(fight1.id);
  Game._internals.startWave(6);
  const q1 = Enemies.buildWave(6, U.rng(1), s1.wmods);
  const fl2 = Dungeon.genFloor(s1.seed, 2);
  const w2 = Dungeon.foldMods(s1.dmods, fl2, fl2.rooms.find(r => r.type === 'fight').id);
  ok(w2.enemyHp > s1.wmods.enemyHp, '第 2 层的敌人生命倍率更高（主题生效）',
    s1.wmods.enemyHp.toFixed(2) + ' → ' + w2.enemyHp.toFixed(2));
  ok(w2.poolShift > s1.wmods.poolShift, '第 2 层的怪物池更靠后');
  const q2 = Enemies.buildWave(6, U.rng(1), w2);
  ok(q2.length >= q1.length, '主题更狠时刷怪量不减少（' + q1.length + ' → ' + q2.length + '）');
}

/* ---------------- 3. 门：战斗中锁着，清干净才能走 ---------------- */
console.log('\n[3] 门：战斗中锁着，清干净才能走');
{
  const s = Game.newRun('ranger', 777, 0);
  Game._internals.warpTo(s.map.rooms.find(r => r.type === 'fight').id);
  Game._internals.startWave(6);
  const cur = Dungeon.roomById(s.map, s.roomId);
  // 找一个有门的方向
  let dir = -1;
  for (let d = 0; d < 4; d++) if (cur.doors[d]) { dir = d; break; }
  ok(dir >= 0, '这一间有门（否则后面的断言没意义）');
  const before = s.roomId;
  ok(Game.enterRoom(dir) === false, '战斗还没清完 → 走不了');
  ok(s.roomId === before, '被拒之后位置没变');

  // 清空这一间（清空即过）
  holdRoom(s);
  s.spawnQueue = []; s.spawnIdx = 0; s.enemies.length = 0;
  s.roomHold = false;
  Game.setState('playing', true);
  Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });
  ok(Game.state === 'shop', '刷完 + 场上清空 = 这一间过了（不用等计时器）', Game.state);
  ok(Dungeon.roomById(s.map, before).cleared === true, '这一间被标记为已清');

  // 清完之后从商店也能走门
  ok(Game.enterRoom(dir) === true, '清完之后（在商店里）也能走门');
  ok(s.roomId !== before, '换了房间', s.roomId);
  ok(Game.state === 'playing', '换房之后立刻开这一间的遭遇', Game.state);
  ok(s.spawnQueue.length > 0 || Dungeon.modsFor(s.map, s.roomId).waveBudget === 0,
    '新房间要么有自己的刷怪队列，要么是不刷怪的房型（budget 0）',
    s.spawnQueue.length + ' 只 · ' + Dungeon.roomText(Dungeon.roomById(s.map, s.roomId)));
}

/* ---------------- 4. 走到门口会自动过去 ---------------- */
console.log('\n[4] 走到门口就过去（不用按键）');
{
  const s = Game.newRun('ranger', 555, 0);
  Game._internals.warpTo(s.map.rooms.find(r => r.type === 'fight').id);
  Game._internals.startWave(4);
  const cur = Dungeon.roomById(s.map, s.roomId);
  let dir = -1;
  for (let d = 0; d < 4; d++) if (cur.doors[d]) { dir = d; break; }
  s.spawnQueue = []; s.spawnIdx = 0; s.enemies.length = 0; s.waveLeft = 0;
  Game.setState('playing', true);
  Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });          // 结算 → 商店
  ok(Game.state === 'shop', '先清完这一间');
  Game.setState('playing', true);                        // 回到场上（玩家可以走）
  const f = Dungeon.doorFrac(dir);
  s.player.x = U.clamp(f.fx * Arena.W, 26, Arena.W - 26);
  s.player.y = U.clamp(f.fy * Arena.H, 26, Arena.H - 26);
  const before = s.roomId;
  Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });
  ok(s.roomId !== before, '站到门口那一帧就换房了', before + ' → ' + s.roomId);
}

/* ---------------- 5. 暗门墙：看不见 · 进不去 · 打穿才开 ---------------- */
console.log('\n[5] 暗门墙：看不见 · 进不去 · 打穿才开');
{
  // 造一间"贴着密室"的房：把当前房挪到密室的邻居上
  const s = Game.newRun('ranger', 2468, 0);
  const secretId = s.map.secrets[0];
  ok(!!secretId, '这一层有密室');
  const sec = Dungeon.roomById(s.map, secretId);
  const nb = Dungeon.neighbours(s.map, sec)[0];
  Game._internals.warpTo(nb.id);
  Game._internals.startWave(3);
  ok(s.wallsNow.length >= 1, '当前房里出现了"可打穿的墙"（' + s.wallsNow.length + ' 面）');
  const wall = s.wallsNow[0];
  ok(wall.to === secretId, '这面墙通向密室');
  // 小地图上看不见密室
  ok(Dungeon.visible(s.map).every(r => r.id !== secretId), '没打穿之前密室不在小地图上');
  /* **门牌也不许报身份**：以前 `Game.doors()` 照样回 类型/名字/图标，
     于是门牌上直接写着"✳ 密室 —— 墙上只有一道裂纹"，玩家一眼就知道墙后是什么。
     线索只留一处（HUD 的"⚠ 右 墙上有裂纹"），门牌只说"这里有一面可疑的墙"。 */
  {
    /* 先"清完这一间"：门牌的第一条规则是"先把这一间清干净"，
       暗门的理由要在清完之后才轮到（这与游戏里的顺序一致）。 */
    const here = Dungeon.roomById(s.map, s.roomId);
    const wasCleared = here ? here.cleared : false;
    if (here) here.cleared = true;
    const door = Game.doors().filter(d => d.dir === wall.dir)[0];
    ok(!!door, '当前房的门牌里有这一面');
    ok(door && door.hidden === true && door.type === '?' && door.name !== '密室' &&
      /裂纹/.test(door.name) && door.icon === '?',
      '未打穿的暗门在门牌上是"裂纹的墙"而不是"密室"（身份不泄露）',
      door ? door.icon + ' ' + door.name + ' / ' + door.type : '没有这一面');
    ok(door && door.open === false && /裂纹/.test(door.why || ''), '门牌上仍然说清了"打穿它"',
      door ? door.why : '');
    if (here) here.cleared = wasCleared;
  }
  // 走不过去
  const dir = wall.dir;
  s.spawnQueue = []; s.spawnIdx = 0; s.enemies.length = 0;
  Game.setState('playing', true);
  Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });
  Game.setState('shop', true);
  ok(Game.enterRoom(dir) === false, '暗门没破 → 走不过去');
  // 打穿它
  const hp0 = wall.hp;
  const before = s.player.scrap;
  const alloyBefore = s.growth || 0;
  const hit = Game._internals.hitWalls(wall.x - 5, wall.y, wall.x + 5, wall.y, 8, hp0);
  /* 墙键带**层号**（`层号|房A|房B`）。带层号的原因是读档只重建当前层的地图 ——
     不带的话别的层的破墙记录会被当成"坏档"丢掉（回归见 `test/states.mjs` [4c]）。 */
  ok(hit === true && s.walls[Dungeon.wallKey(s.floor, wall.from, wall.to)] === true, '打够伤害就破墙');
  ok(Dungeon.visible(s.map).some(r => r.id === secretId), '破了墙密室才出现在小地图上');
  ok(s.roomId !== secretId, '破墙不等于进门（还要自己走进去）');
  ok(Game.enterRoom(dir) === true && s.roomId === secretId, '破了墙就能走进密室');
  ok(Game.state === 'playing', '密室也是一间房（有自己的遭遇）');
  ok(s.secretsFound >= 1, '进过密室会被记下来（跨局发现要用）', s.secretsFound);
  ok(s.player.scrap > before, '密室给的东西很实在（+' + (s.player.scrap - before) + ' 材料）');
  ok((s.growth || 0) > alloyBefore, '密室给**养成代币**（+' + ((s.alloy || 0) - alloyBefore) +
    '）—— 图纸树唯一的局内来源，而密室是全游戏唯一"进门要付代价"的地方');
  ok(Game.ROOM_FX.secret.note.indexOf('打穿') >= 0, '密室的内容说明也写着"要打穿"');
}

/* ---------------- 5b. 迷雾：看见的是"这一间 + 它那一圈" ---------------- */
console.log('\n[5b] 迷雾：小地图只画见过的');
{
  const s = Game.newRun('ranger', 3131, 0);
  const start = Dungeon.roomById(s.map, s.map.start);
  const vis0 = Dungeon.visible(s.map);
  const ring = Dungeon.neighbours(s.map, start).filter(r => r.type !== Dungeon.SECRET_TYPE);
  ok(vis0.length === 1 + ring.length && vis0.indexOf(start) >= 0,
    '刚开局：只看见入口 + 它的 ' + ring.length + ' 间邻房（' + vis0.length + '/' + s.map.rooms.length + ' 间）',
    vis0.map(r => r.type).join(','));
  ok(ring.every(r => vis0.indexOf(r) >= 0), '邻房都在（门牌上能看到它们是什么，所以小地图也该看到）');
  /* 走到邻房 → 那一圈继续长出来；**远处仍然看不见** */
  const nb = ring[0];
  ok(!!nb, '入口至少有一间邻房');
  Game._internals.warpTo(nb.id);
  const vis1 = Dungeon.visible(s.map);
  const ring2 = Dungeon.neighbours(s.map, Dungeon.roomById(s.map, nb.id))
    .filter(r => r.type !== Dungeon.SECRET_TYPE);
  ok(vis1.length > vis0.length && ring2.every(r => vis1.indexOf(r) >= 0),
    '进一间 → 地图长大一圈（' + vis0.length + ' → ' + vis1.length + ' 间）');
  const far = s.map.rooms.filter(r => Dungeon.path(s.map, nb.id, r.id, null).length > 3);
  ok(far.length === 0 || far.every(r => vis1.indexOf(r) < 0),
    '隔了 3 间以上的房间仍然看不见（迷雾没漏）', far.length + ' 间远的');
  /* 密室（如果这一层有）不许被"那一圈"顺带看见 */
  for (const sid of s.map.secrets) {
    ok(Dungeon.visible(s.map).every(r => r.id !== sid), '密室不在"那一圈"里（身份不泄露）');
  }
  /* "下一波"按钮**不受迷雾影响**：它要能找到整层的下一间（否则玩家会被卡住） */
  ok(/Dungeon\.SECRET_TYPE/.test(fs.readFileSync(path.join(ROOT, 'src', 'game.ts'), 'utf8')),
    '自动探索用的是"整层"而不是"看见的那一份"（迷雾只管小地图）');
}

/* ---------------- 6. 房间内容：宝箱 / 商店房 / 营地房 / 事件房 ---------------- */console.log('\n[6] 房间内容：每一种都真的有东西');
{
  /** 真的**走进**一间指定房型的房（走的是玩家那条路：从邻居清空 → 走门）。
      只用带种子长出来的图，不做"手工摆一间"—— 那样测的是测试自己。 */
  const dirBetween = (a, b) => {
    for (let d = 0; d < 4; d++) {
      if (b.x === a.x + Dungeon.DIRS[d][0] && b.y === a.y + Dungeon.DIRS[d][1]) return d;
    }
    return -1;
  };
  const enterType = (type, seed, prep) => {
    for (let t = 0; t < 30; t++) {
      Game.newRun('ranger', (seed + t * 977) >>> 0, 0);
      const s = Game.getSession();
      const room = s.map.rooms.find(r => r.type === type);
      if (!room) continue;
      const nb = Dungeon.neighbours(s.map, room)[0];
      if (!nb) continue;
      Game._internals.warpTo(nb.id);
      Game._internals.startWave(4);
      toShop(s);                                   // 合法地清掉邻居（门才会开）
      if (prep) prep(s);
      const before = {
        mats: s.player.scrap, mat: Game.material(), rr: s.freeRerolls,
        hp: s.player.hp, maxHp: s.stats.maxHp,
        weapons: s.player.weapons.length, items: s.player.items.length,
        growth: s.growth || 0
      };
      if (!Game.enterRoom(dirBetween(nb, room))) continue;
      if (s.roomId !== room.id) continue;
      return { s, before, room };
    }
    return null;
  };

  /* 宝箱房 = **装备的收集点**（这一步改的：以前它只是"又一笔材料"，与战斗房没区别）。
     度量方式要跟着换：现在量的是"武器或道具多了一件"，不是"材料涨了"。 */
  const t1 = enterType('treasure', 100);
  ok(!!t1, '宝箱房进得去');
  if (t1) {
    const s = t1.s, b = t1.before;
    const gotGear = s.player.weapons.length > b.weapons || s.player.items.length > b.items;
    ok(gotGear, '宝箱：多了一件装备（武器 ' + b.weapons + '→' + s.player.weapons.length +
      ' · 道具 ' + b.items + '→' + s.player.items.length + '）');
    ok(Game.material() > b.mat, '宝箱：材料也涨（+' + (Game.material() - b.mat) + '）');
    ok(s.spawnQueue.length === 0, '宝箱房不刷怪（白给的房间）');
  }

  // 商店房：货架更多 + 这一间打折
  const t2 = enterType('shop', 200);
  ok(!!t2, '商店房进得去');
  if (t2) {
    const s = t2.s;
    ok(s.roomFx.shopSlots > 0 && s.roomFx.shopDiscount > 0,
      '商店房把"货架 +N / 本间打折"折进 roomFx', JSON.stringify(s.roomFx));
    const base = Dungeon.modsFor(s.map, s.roomId);
    ok(base.waveBudget === 0, '商店房不刷怪');
    Game._internals.openShop(0);
    const withRoom = s.offers.length;
    const cheap = s.offers.length
      ? (Weapons.priceOf(s.offers[0].def, s.stats.luck) * Craft.EMERGENCY_MARKUP) - s.offers[0].price : 0;
    s.roomFx = {};                                  // 对照：把这一间的加成撤掉
    Game._internals.openShop(0);
    ok(withRoom > s.offers.length, '商店房的货架确实更多（' + withRoom + ' vs ' + s.offers.length + '）');
    ok(cheap > 0, '商店房的售价确实更低（比同价的非商店房便宜 ' + Math.round(cheap) + '）');
  }

  // 补给房：回血 + 一批材料（先把血压到 1 —— 满血时"回血 0"不代表没生效）
  const t3 = enterType('camp', 300, s => { s.player.hp = 1; });
  ok(!!t3, '营地房进得去');
  if (t3) {
    const s = t3.s, b = t3.before;
    ok(s.player.hp > b.hp && Game.material() > b.mat,
      '补给房：回血 ' + (s.player.hp - b.hp) + ' · 材料 +' + (Game.material() - b.mat));
  }

  // 事件房：**经过的遭遇真的改了状态**（四种里随便中一个都算）
  const t4 = enterType('event', 400);
  ok(!!t4, '事件房进得去（生成器真的会放事件房）');
  if (t4) {
    const s = t4.s, b = t4.before;
    const changed = s.player.hp !== b.hp || s.player.scrap !== b.mats ||
      Game.material() !== b.mat || s.freeRerolls !== b.rr || s.stats.maxHp !== b.maxHp ||
      s.bonusMul !== 1;
    ok(changed, '事件房的一次遭遇真的改了状态（代价与好处并存）',
      JSON.stringify({ hp: [b.hp, s.player.hp], mats: [b.mats, s.player.scrap], mat: [b.mat, Game.material()], rr: [b.rr, s.freeRerolls], bonus: s.bonusMul }));
  }
  const ids = Game.ROOM_EVENTS.map(e => e.id);
  ok(new Set(ids).size === ids.length, '遭遇 id 不重复');

  /* 每一条遭遇单独验一遍（不要靠"抽到哪条算哪条"）：
     每条都必须真的改动状态 —— 一条只会生成一句文本的遭遇等于不存在。
     另外每条都得有"代价"或"可能亏"的一面（note 里写了），否则事件房就只是宝箱房。 */
  const evBad = [];
  Game.ROOM_EVENTS.forEach(ev => {
    Game.newRun('ranger', 808, 0);
    const s = Game.getSession();
    s.player.hp = Math.max(2, Math.round(s.stats.maxHp * 0.6));
    s.player.scrap = 0;
    const b = { hp: s.player.hp, mats: s.player.scrap, mat: Game.material(), rr: s.freeRerolls, max: s.stats.maxHp, bonus: s.bonusMul };
    const msg = ev.apply(s.player, Dungeon.roomById(s.map, s.map.start));
    const changed = s.player.hp !== b.hp || s.player.scrap !== b.mats ||
      Game.material() !== b.mat || s.freeRerolls !== b.rr || s.stats.maxHp !== b.max ||
      s.bonusMul !== b.bonus;
    if (!changed) evBad.push(ev.id + ' 什么也没改');
    if (!msg || msg.length < 4) evBad.push(ev.id + ' 没给出发生了什么');
  });
  ok(evBad.length === 0, '四条遭遇各自都真的改了状态并说明发生了什么', evBad.join(' | '));

  /* 精英房：生成器**允许**某些层没有它（死路数量决定），所以这里跨种子找一层有它的 ——
     找不到才是真问题（"表里有、局里没有"的死内容）。 */
  let tElite = null;
  for (let sd = 500; sd < 540 && !tElite; sd++) tElite = enterType('elite', sd);
  if (tElite) {
    const s = tElite.s, b = tElite.before;
    ok(s.player.scrap > b.mats + 20, '精英房给**一大笔材料**（+' + (s.player.scrap - b.mats) + '）');
    ok(b.weapons === s.player.weapons.length, '精英房不给装备（它的独占产出是材料，不与宝箱重叠）');
  } else {
    ok(false, '四十个种子里至少有一层的生成器放了精英房（它是死路上的挑战房）');
  }

  /* ---- 深度的回报：层与层之间（层倍率）+ 一层之内（深浅梯度）----
     没有它，"走光这一层"永远最优（多打一间只会更多），关底时机就不是选择而是顺序。
     用的是已有的 bonusMul（事件房也在用同一个字段）。
     一层之内的那一项**以本层平均深度为基准** —— 它是梯度，不是通胀：
     浅房略少、深房略多，整层平均仍然是这个层的基准倍率。 */
  {
    /** 把第 f 层每一间房的奖励倍率都取一遍（走的是模拟层同一个入口） */
    const mulFor = f => {
      Game._internals.enterFloor(f, { silent: true });
      const s = Game.getSession();
      const out = [];
      for (const r of s.map.rooms) {
        Game._internals.warpTo(r.id);
        Game._internals.startWave(Game.wave);
        out.push({ d: r.depth, mul: s.bonusMul, type: r.type });
      }
      return { rows: out, theme: Dungeon.THEME_BY_ID[s.map.theme] };
    };
    const avg = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
    const F = [1, 2, 3].map(mulFor);
    const mean = F.map(x => avg(x.rows.map(r => r.mul)));
    const base = F.map((x, i) => (1 + i * 0.30) * x.theme.hpMul);
    ok(Math.abs(mean[0] - base[0]) < 0.03,
      '第 1 层整层平均 = 基准 ' + base[0].toFixed(2) + '（浅层不额外给，深的那几间多拿是在**层内**挪）',
      mean[0].toFixed(3));
    ok(Math.abs(mean[1] - base[1]) < 0.03 && Math.abs(mean[2] - base[2]) < 0.03,
      '第 2 / 3 层同样以"层的基准"为中心（不是整体通胀）',
      mean.map(m => m.toFixed(2)).join(' / ') + ' vs ' + base.map(b => b.toFixed(2)).join(' / '));
    ok(mean[1] > mean[0] && mean[2] > mean[1],
      '层越深、每次收集越多（' + mean.map(m => m.toFixed(2)).join(' → ') + '）');
    ok(mean[2] >= 1.5, '第 3 层的倍率够大，值得为它**少清几间**（' + mean[2].toFixed(2) + '）');
    /* 层内梯度：最深的那间 > 最浅的那间（这就是"绕进去"的第二个理由） */
    const grad = F.map(x => {
      const deep = x.rows.reduce((a, b) => (b.d > a.d ? b : a));
      const shallow = x.rows.reduce((a, b) => (b.d < a.d ? b : a));
      return deep.mul - shallow.mul;
    });
    ok(grad.every(g => g > 0.1),
      '一层之内：深处的房间比浅处值钱（三层分别 +' + grad.map(g => g.toFixed(2)).join(' / +') + '）');
    /* 两边都要成立：早打关底 = 单次更肥；走光这一层 = 次数更多 + 吃到层内梯度
       （每一间都是一次收集 + 一次买卖 + 一个制造回合）。 */
    const perRoom = Game.wave * 3 + 8;
    const greedy = 2 * perRoom * 1.0;              // 第 1 层多清两间
    const rush = 2 * perRoom * mean[2];            // 把这两间留到第 3 层再收
    ok(rush > greedy, '早翻层的收益**能**超过多清两间（' + Math.round(greedy) + ' vs ' + Math.round(rush) + '）');
  }
  ok(Game.ROOM_EVENTS.every(e => /代价|损失|捐|减半|换/.test(e.note)),
    '每条遭遇都写明了自己的代价（只有好处的那是宝箱）',
    Game.ROOM_EVENTS.filter(e => !/代价|损失|捐|减半|换/.test(e.note)).map(e => e.id).join(','));
}

/* ---------------- 7. 时限：超时会狂暴 + 奖励打折 ---------------- */
console.log('\n[7] 时限：超时 = 剩下的怪狂暴 + 这一间奖励打折');
{
  const s = Game.newRun('ranger', 31, 0);
  Game._internals.warpTo(s.map.rooms.find(r => r.type === 'fight').id);
  Game._internals.startWave(10);
  ok(s.enemies.length === 0, '刚开波时场上还没有怪（按时间入场）');
  for (let i = 0; i < 90 && !s.enemies.length; i++) Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });
  const e = s.enemies[0];
  ok(!!e, '第一只怪入场了');
  const sp0 = e.speed, dmg0 = e.dmg;
  s.waveLeft = 0;
  let overruns = 0;
  Game.events.on('overrun', () => { overruns++; });
  Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });
  ok(overruns === 1 && s.forceClear === true, '超时发一次 overrun 并停止继续刷怪');
  ok(e.speed > sp0 && e.dmg > dmg0, '场上剩下的怪被强化（移速 ' + sp0.toFixed(0) + '→' + e.speed.toFixed(0) + '）');
  ok(e.enraged === true, '怪身上留下"狂暴"标记（渲染/调试可读）');
  // 奖励：速清 vs 超时（**走真实路径**：清场/超时都靠 step 触发，不直接调 endWave）
  const bonus = (fast) => {
    Game.newRun('ranger', 31, 0);
    const ss = Game.getSession();
    Game._internals.warpTo(ss.map.rooms.find(r => r.type === 'fight').id);
    Game._internals.startWave(10);
    for (let i = 0; i < 90 && !ss.enemies.length; i++) Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });
    const m0 = ss.player.scrap;
    if (fast) {
      ss.spawnQueue = []; ss.spawnIdx = 0; ss.enemies.length = 0; ss.waveLeft = 5;
      Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });                 // 清空 → 过
    } else {
      ss.waveLeft = 0;
      Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });                 // 超时 → 狂暴 + 停刷
      ss.enemies.length = 0;
      Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });                 // 清掉剩下的 → 过
    }
    return ss.player.scrap - m0;
  };
  const fast = bonus(true), slow = bonus(false);
  ok(fast > slow, '速清奖励 > 超时奖励（' + fast + ' vs ' + slow + '，比值 ' +
    (fast / Math.max(1, slow)).toFixed(2) + '）');
  ok(Math.abs(fast / Math.max(1, slow) - Game.cfg.clearBonus / Game.cfg.overrunBonus) < 0.2,
    '两档奖励就是配置里那两个倍率（差 ' + (Game.cfg.clearBonus / Game.cfg.overrunBonus).toFixed(2) + ' 倍）');
}

/* ---------------- 8. 自动探索：确定性、不钻密室、一定到 Boss ---------------- */
console.log('\n[8] 自动探索（"下一波"按钮在无导航时的路径）');
{
  const walk = (seed) => {
    const s = Game.newRun('ranger', seed, 0);
    holdRoom(s);
    const path = [];
    let guard = 0;
    while (guard++ < 80) {
      const ss = Game.getSession();
      if (ss.roomId === ss.map.boss) break;
      // 清掉当前这一间 → 商店 → 自动探索
      ss.roomHold = false;
      ss.spawnQueue = []; ss.spawnIdx = 0; ss.enemies.length = 0;
      Game.setState('playing', true);
      Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });
      if (Game.state !== 'shop') break;
      const before = ss.roomId;
      if (!Game.nextWave()) break;
      path.push(before + '→' + ss.roomId);
    }
    return { s: Game.getSession(), path, guard };
  };
  const a = walk(90210), b = walk(90210);
  ok(a.path.join(',') === b.path.join(','), '同一个种子 → 同一条自动路线（' + a.path.length + ' 步）');
  ok(a.s.roomId === a.s.map.boss, '自动探索最终走到 Boss 房', a.s.roomId + ' vs ' + a.s.map.boss);
  ok(a.path.every(p => p.indexOf('secret') < 0), '自动探索不会走进密室（隐藏要素要玩家自己发现）');
  const c = walk(90211);
  ok(c.path.join(',') !== a.path.join(','), '换个种子 → 换条路（不是写死的顺序）');

  /* ---- 两个真 bug 的守卫（都是"点下一关像跳关"的来源）----
     ① 只走一步：目标是三格外的房时，玩家会停在中间**已清**的空房里 ——
        没怪、没商店、按钮也不在了；
     ② 走进已清的房还开一波：波次 +1、白拿一份每波收入、还在一间标着"已清"的房里刷出怪。
     所以这里逐步检查：每一次点"下一波"都必须落在**未清**的房间上，且波次只 +1。 */
  {
    const s = Game.newRun('ranger', 12345, 0);
    holdRoom(s);
    const bad = [];
    const waves = [];
    for (let i = 0; i < 12; i++) {
      const cur = Dungeon.roomById(s.map, s.roomId);
      if (!cur) break;
      // 把这一间"打完"：走真实的结算路径（进商店）
      if (!cur.cleared) {
        s.roomHold = false;
        s.spawnQueue = []; s.spawnIdx = 0; s.enemies.length = 0;
        s.forceClear = true; s.waveEnding = false;
        Game._internals.endWave();
      }
      if (Game.state === 'end') break;
      const waveBefore = Game.wave;
      if (!Game.nextWave()) break;
      const room = Dungeon.roomById(s.map, s.roomId);
      if (!room || room.cleared) bad.push('第' + (i + 1) + '步落到了已清房间 ' + (room ? room.id : '?'));
      waves.push(Game.wave - waveBefore);
      if (room && room.type === 'boss') break;
    }
    ok(bad.length === 0, '每一步"下一波"都落在**未清**的房间上（不会停在空房里）', bad.join('；'));
    ok(waves.length >= 3 && waves.every(d => d === 1),
      '走了 ' + waves.length + ' 步，每一步波次只 +1（走过走廊不再算一波）', waves.join(','));
  }

  /* ---- "自己选房间"（Hades / 以撒那种）：门列表是唯一的对外数据 ----
     `Game.doors()` 必须与 `Game.enterRoom()` 的规则**完全一致**：
     界面只画它、不重判；两者不一致时，玩家会看到"能走的门走不了"或反之。 */
  {
    const s = Game.newRun('ranger', 12345, 0);
    holdRoom(s);
    s.roomHold = false; s.spawnQueue = []; s.spawnIdx = 0; s.enemies.length = 0;
    s.forceClear = true; s.waveEnding = false;
    Game._internals.endWave();                       // 清掉入口间 → 商店（存档点）
    const doors = Game.doors();
    ok(doors.length >= 1, '当前这一间列出了 ' + doors.length + ' 扇门', doors.length);
    ok(doors.every(d => d.name && d.name.length > 0 && typeof d.icon === 'string'),
      '每扇门都带房型名与图标（界面直接写它，不按房型 id 分支）');
    ok(doors.every(d => d.open || d.why.length > 0),
      '走不了的门都给了原因（界面据此显示"先打穿它"，而不是把门藏起来）');
    const closedEnter = doors.filter(d => !d.open).map(d => Game.enterRoom(d.dir));
    ok(closedEnter.every(r => r === false), '关着的门真的进不去（列表与校验一致）',
      closedEnter.map(String).join(','));
    const openDir = (doors.find(d => d.open) || {}).dir;
    ok(typeof openDir === 'number' && Game.enterRoom(openDir) === true,
      '开着的门真的走得进去', String(openDir));
  }
}

/* ---------------- 9. 翻层：Boss 房之后是下一层 ---------------- */
console.log('\n[9] 翻层与通关条件');
{
  const s = Game.newRun('ranger', 606, 0);
  const fl1 = s.map.key;
  s.roomId = s.map.boss;
  s.spawnQueue = []; s.spawnIdx = 0; s.enemies.length = 0;
  Game.setState('playing', true);
  Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });
  ok(Game.state === 'shop', '打完第 1 层 Boss → 进商店（不是结算）', Game.state);
  ok(s.floor === 2, '翻到第 2 层', s.floor);
  ok(s.map.key !== fl1, '地图换了一张', s.map.key);
  ok(Dungeon.roomById(s.map, s.roomId).cleared === true, '新层的入口间直接算已清（否则会卡在门锁着）');
  ok(s.secretsFound === 0, '发现计数是**本局**的（换层不清零，但这里还没发现过）');
  // 层主题随层变狠
  ok(Dungeon.THEME_BY_ID[s.map.theme].hpMul >= Dungeon.THEME_BY_ID[Dungeon.genFloor(606, 1).theme].hpMul,
    '第 2 层的主题不比第 1 层软（' + s.map.theme + '）');
}

/* ---------------- 10. 存档：只存进度，地图由种子重建 ---------------- */
console.log('\n[10] 存档：只存进度，地图由种子重建');
{
  const s = Game.newRun('ranger', 31337, 0);
  Game._internals.warpTo(s.map.rooms.find(r => r.type === 'fight').id);
  Game._internals.startWave(5);
  s.spawnQueue = []; s.spawnIdx = 0; s.enemies.length = 0; s.waveLeft = 0;
  Game.setState('playing', true);
  Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });
  const payload = Game.exportRun();
  ok(payload.floor === 1 && typeof payload.room === 'string' && payload.room.length > 0,
    '存档里有层号与当前房', payload.floor + ' / ' + payload.room);
  ok(Array.isArray(payload.roomsCleared) && payload.roomsCleared.length >= 1,
    '存档里有"清过的房"', JSON.stringify(payload.roomsCleared));
  ok(!('map' in payload), '**地图本身不进存档**（由种子长出来，存档只存进度）');

  const back = Game.importRun(payload);
  ok(back && back.floor === payload.floor && back.roomId === payload.room, '读档回到同一层同一间');
  const cleared = Dungeon.roomById(back.map, payload.room).cleared;
  ok(cleared === true, '那一间仍然是"已清"');
  ok(Game.state === 'shop', '读档落到商店（存档点就是"清完一间之后的商店"）', Game.state);
  const mats = back.player.scrap;
  Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });     // 不该再结算一次
  ok(back.player.scrap === mats, '读档不会把这一间的奖励再发一遍');

  // 破墙进度也进存档
  const s2 = Game.newRun('ranger', 2468, 0);
  const secretId = s2.map.secrets[0];
  const nb = Dungeon.neighbours(s2.map, Dungeon.roomById(s2.map, secretId))[0];
  Game._internals.warpTo(nb.id);
  Game._internals.startWave(3);
  const w = s2.wallsNow[0];
  Game._internals.hitWalls(w.x - 4, w.y, w.x + 4, w.y, 8, w.hp);
  const p2 = Game.exportRun();
  ok(p2.walls.length >= 1, '破过的墙进了存档', JSON.stringify(p2.walls));
  const b2 = Game.importRun(p2);
  ok(Dungeon.wallOpen(b2.walls, b2.floor, w.from, w.to), '读档之后那面墙仍然是破的');
  // 发现计数（进过几间密室）也要往返 —— 它是跨局图鉴的输入
  const b2b = Game.importRun(Object.assign({}, p2, { secretSeen: 2 }));
  ok(b2b.secretsFound === 2, '密室发现计数往返（' + b2b.secretsFound + '）');

  // 坏档：层号越界 / 房间 id 认不出 / 墙键乱写 → 能修的修，不整份丢掉
  const bad = Object.assign({}, payload, { floor: 99, room: 'r999_9_9', walls: ['乱写', 'a|b|c', null], roomsCleared: ['不存在'] });
  const b3 = Game.importRun(bad);
  ok(!!b3, '坏档（越界层号 / 认不出的房间）仍能读进来');
  ok(b3.floor === Dungeon.FLOORS, '越界层号夹回最后一层', b3.floor);
  ok(!!Dungeon.roomById(b3.map, b3.roomId), '认不出的当前房退回入口间', b3.roomId);
  ok(Object.keys(b3.walls).length === 0, '乱写的墙键被丢掉', JSON.stringify(b3.walls));
}

/* ---------------- 11. 记录：换房也要进带子 ---------------- */
console.log('\n[11] 记录与界面接入');
{
  const rec = fs.readFileSync(path.join(ROOT, 'src', 'record.ts'), 'utf8');
  ok(/'enterRoom'/.test(rec) && /'autoExplore'/.test(rec),
    'enterRoom / autoExplore 都在录制命令清单里（否则回放会少一段状态变更）');
  ok(/'breakWall'/.test(rec) === false,
    'breakWall **不**单独录制（它是打墙的后果，由逐帧输入重放出来）');

  const ui = fs.readFileSync(path.join(ROOT, 'src', 'ui.ts'), 'utf8');
  /* 界面**不得**按房型 id 分支（分类/配色都在 dungeon.ts 的表里）——
     注意不能按裸字符串搜：'camp'/'shop' 在 ui.ts 里是**状态名**，不是房型。 */
  const hard = Dungeon.TYPES
    .map(t => t.id)
    .filter(id => new RegExp('(\\.type|roomType)\\s*===\\s*[\'"]' + id + '[\'"]').test(ui));
  ok(hard.length === 0, 'ui.ts 里没有按房型 id 分支（文案与配色都在声明表里）', hard.join(','));
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const noCss = Dungeon.TYPES.filter(t => css.indexOf('.mm-cell.mm-' + t.cls) < 0).map(t => t.cls);
  ok(noCss.length === 0, '每种房型的样式类都在 CSS 里有定义（照表生成，不会漏）', noCss.join(','));
  ok(/Dungeon\.visible\(/.test(ui), '小地图用的是"玩家看得见的那一份"（隐藏房不泄露）');
  ok(/data-act="enter-room"|'enter-room'/.test(ui), '小地图上可走的房间是可点的按钮');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  ok(html.indexOf('id="minimap"') >= 0 && html.indexOf('id="mm-grid"') >= 0, 'index.html 里有小地图容器');
  ok(html.indexOf('id="hud-room"') >= 0, 'HUD 里有"所在"一栏（层 + 房型）');
}

/* ---------------- 12. 键名一致：地牢与难度用的是同一套 ---------------- */
console.log('\n[12] 修正键：地牢与难度同名同折法');
{
  const bad = [];
  for (const k of Object.keys(Dungeon.MOD_KEYS)) {
    if (!(k in Danger.BASE)) bad.push(k + ' 不在 danger 的键里');
    else if (Danger.FOLD[k] !== Dungeon.MOD_KEYS[k].how) bad.push(k + ' 折法不一致');
  }
  ok(bad.length === 0, '地牢给的每个键都能在难度那套里找到同折法的', bad.join(','));
  ok(Registry.has('roomMod'), 'roomMod 家族在总账里');
  const folded = Dungeon.foldMods(Danger.BASE, null, null);
  ok(Object.keys(folded).length === Object.keys(Danger.BASE).length,
    '不传地图时折叠结果是"原样"（恒等）');
}

console.log('\n=== 结果 ===');
if (failures === 0) { console.log('\x1b[32m全部通过 ✔\x1b[0m\n'); process.exit(0); }
console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m\n');
process.exit(1);
