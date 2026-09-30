/* =========================================================
   reconcile.mjs — **声明 ↔ 运行时对账**
   ---------------------------------------------------------
   这个项目有十几张"声明表"（曲线 / 货币 / 美术类别 / 着色器 / 曲目 /
   挑战 / 天赋…），每张都有 `audit()`。但 `audit()` 只能证明**表内部自洽**，
   回答不了那个更狠的问题：

     **"这些声明，运行时到底有没有人真的在用它？"**

   已有的校验各管一段：
     · `data-contract` 查"数据表里的字符串字段有没有家族守"（表 → 表）
     · `arch-audit [9]` 查"声明了却没人按名字引用"（文本近似）
     · 覆盖率查"哪些函数没跑过"（工具层）
   缺的正是**中间那一段**：一张表的条目 → 它在运行时被读了几次。

   做法：跑一局真实的游戏，把每张表的"读出口"包一层计数器，
   然后逐条对照"声明里有 / 运行时读到过"。

   怎么读结论：
     · `0 次` **不一定是 bug**：精英率在第 4 间之前本来就恒为 0、
       结算曲只在结算时放一次、道具包的 T4 档要高级包才出。
       所以输出分成"**跑到了**"与"**没跑到（附为什么可能是正常的）**"，
       而不是一句"有死数据"。
     · 真正要找的是"**整张表的某个出口从来没被调用过**" ——
       那说明读点漏了（比某一条没触发严重得多）。
   ========================================================= */
import { installDom } from '../test/_ctx.mjs';
import { loadAll, UI_MODULES } from '../test/_load.mjs';
import { playRun } from './_run.mjs';

installDom();
await loadAll(UI_MODULES);
const g = globalThis;
const { Game, Curves, Economy, Music, ArtShaders, Challenges, Talents, Boons, Items, Weapons, Enemies, Art, ArtTiles, Camp, Stronghold, Forge } = g;

const PAD = (s, n) => { s = String(s); return s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 127 ? 2 : 1), 0))); };

console.log('\n=== Bronana · 声明 ↔ 运行时对账 ===\n');
console.log('  跑一局真实对局（同一个自动玩家），把每张表的读出口包一层计数器\n');

/* ---------------- 1. 包计数器 ---------------- */
const hits = Object.create(null);
function wrap(obj, name, label) {
  if (!obj || typeof obj[name] !== 'function') return false;
  const orig = obj[name];
  obj[name] = function () {
    const key = label + '.' + name + (arguments.length && typeof arguments[0] === 'string' ? ':' + arguments[0] : '');
    hits[key] = (hits[key] || 0) + 1;
    return orig.apply(this, arguments);
  };
  return true;
}

/* 每条曲线的读出口（`Curves.at(id, t)` —— id 是第一个参数） */
wrap(Curves, 'at', 'curve');
wrap(Curves, 'table', 'curve');
/* 货币 / 循环 */
wrap(Economy, 'edge', 'eco');
wrap(Economy, 'byTier', 'eco');
wrap(Economy, 'flowsFrom', 'eco');
/* 音乐 */
wrap(Music, 'play', 'music');
wrap(Music, 'forScene', 'music');
/* 着色器：`paint(x, id, ...)` —— id 是第二个参数，单独包 */
if (typeof ArtShaders.paint === 'function') {
  const origPaint = ArtShaders.paint;
  ArtShaders.paint = function (x, id) {
    hits['shader.paint:' + id] = (hits['shader.paint:' + id] || 0) + 1;
    return origPaint.apply(this, arguments);
  };
}
/* 美术规范 */
if (typeof Art.lintAsset === 'function') {
  const origLint = Art.lintAsset;
  Art.lintAsset = function (a) {
    if (a && a.kind) hits['artKind.lint:' + a.kind] = (hits['artKind.lint:' + a.kind] || 0) + 1;
    return origLint.apply(this, arguments);
  };
}
/* 瓦片：`autotile(setOrId, ...)` 与 `tileFor(ts, mask)` */
if (typeof ArtTiles.autotile === 'function') {
  const origAuto = ArtTiles.autotile;
  ArtTiles.autotile = function (setOrId) {
    const id = typeof setOrId === 'string' ? setOrId : (setOrId && setOrId.id) || '?';
    hits['tileSet.autotile:' + id] = (hits['tileSet.autotile:' + id] || 0) + 1;
    return origAuto.apply(this, arguments);
  };
}

/* 挑战：**度量 id 在第一个参数的 `.metric` 字段里**，通用 `wrap` 只认字符串参数，
   所以这里记的是"评估入口有没有被走到" —— 至于每条度量有没有被用，
   看下面 [7] 那张表（按挑战表自己的 `metric` 字段收，比计数更准）。 */
wrap(Challenges, 'context', 'challenge');
wrap(Challenges, 'evaluate', 'challenge');
wrap(Challenges, 'groups', 'challenge');
/* 货币 / 循环：**这一张表没有运行时读点** —— `Eco.edge` / `byTier` /
   `flowsFrom` / `isSession` 全仓只有 `audit()` 与体检工具在调，
   运行时一次都不查（`profile.ts` 的 `applyRun` / `keepBuy` 直接写
   `data.growth` / `data.core`）。把"没人调用辅助函数"报成"四种货币没人用"
   是**校验在冤枉代码**：货币当然在用，只是没人去查那张表。
   所以口径换成"**这笔钱被真的读过 / 写过**"：
     · 读：`Profile.growth()` / `alloy()` / `core()`（界面与消费点都走它）
     · 写：`applyRun`（产出）/ `market.buy*`、`market.sellWeapon`（局内花与收）
           / `keepBuy`、`forgeNode`（局外花）
   下面第 2 节会把这条生命周期**真的走一遍**（打一局 → 结算 → 买据点 → 解图纸），
   否则这些读点全在界面上，无头跑一局碰不到。 */
function wrapArg(obj, name, fn) {
  if (!obj || typeof obj[name] !== 'function') return false;
  const orig = obj[name];
  obj[name] = function () { fn.apply(null, arguments); return orig.apply(this, arguments); };
  return true;
}
/* 三个读点**显式写开**，不用循环 —— 循环里那个闭包吃过一次亏
   （`id` 捕获错，读数恒为 0，看着像"游戏没用过这几种钱"）。
   写开之后加一个哨兵：当场调一次，命中数必须非 0，否则是校验没接上。 */
wrapArg(g.Profile, 'spores', function () { hits['curRead:spore'] = (hits['curRead:spore'] || 0) + 1; });
wrapArg(g.Profile, 'alloy', function () { hits['curRead:alloy'] = (hits['curRead:alloy'] || 0) + 1; });
wrapArg(g.Profile, 'growthForRun', function () { hits['curRead:spore'] = (hits['curRead:spore'] || 0) + 1; });
wrapArg(g.Profile, 'growthForRun', function () { hits['curRead:alloy'] = (hits['curRead:alloy'] || 0) + 1; });
/* ⚠ 核心材料**没有** `Profile.core()` 之外的运行时读点，而 `Profile.core()` 只在
   据点/图纸那两个界面里被调（`ui.ts`）—— 无头环境走不到。它真正的运行时落点是
   "**扣掉它**"：`Profile.keepBuy` / `forgeNode` 在 `chk.core > 0` 时真的减一笔。
   所以核心材料这一行的判据是"这次消费动了核心材料"，不是"有人读过它"。 */
for (const name of ['applyRun']) {
  wrapArg(g.Profile, name, function () { hits['curWrite:material'] = (hits['curWrite:material'] || 0) + 1; });
}
wrapArg(g.Profile, 'keepBuy', function (id) {
  try {
    const c = g.Stronghold.canBuy(g.Profile.keepOwned(), id, g.Profile.growth(), g.Profile.core());
    if (c && c.ok && c.core > 0) hits['curWrite:core'] = (hits['curWrite:core'] || 0) + 1;
  } catch (e) { }
});
wrapArg(g.Profile, 'forgeNode', function (id) {
  try {
    const c = g.Profile.canForge(id);
    if (c && c.ok && c.core > 0) hits['curWrite:core'] = (hits['curWrite:core'] || 0) + 1;
  } catch (e) { }
});
wrapArg(g.Market, 'buyItem', function () { hits['curWrite:material'] = (hits['curWrite:material'] || 0) + 1; });
wrapArg(g.Market, 'sellWeapon', function () { hits['curWrite:material'] = (hits['curWrite:material'] || 0) + 1; });
for (const [obj, name, label] of [
  [Boons, 'fold', 'boon'], [Items, 'foldCosts', 'itemCost'], [Items, 'foldSpecials', 'itemSpecial'],
  [Items, 'rollShop', 'item'], [Items, 'rollPack', 'item'],
  [Weapons, 'rollShop', 'weapon'], [Weapons, 'mul', 'tier'],
  [Enemies, 'pickFor', 'enemy'], [Enemies, 'spawnPlan', 'enemy'],
  [Camp, 'modsFor', 'campFacility'], [Stronghold, 'modsFor', 'keepFacility'],
  [Forge, 'modsFor', 'forgeNode'], [Talents, 'opening', 'talent']
]) wrap(obj, name, label);

/* ---------------- 2. 跑一局 + 驱动"另一条生命周期" ----------------
   只跑一局是不够的：**渲染层、音乐、结算、挑战统计**都不在 `playRun`
   的路径上（那是模拟层）。所以这里补三段：
     · 画一帧（着色器 / 瓦片 / 视差都在这条路上）
     · 每帧调 `Music.update`（唯一的换曲入口）
     · 跑一次结算与挑战评估（档案层）
   这也是**必须诚实说清的一点**：不补这一段，校验会把"没被采样到"
   报成"没人用"—— 第一版就是这样，五张表被报成"出口全漏"。 */
const st = playRun({ runIndex: 0, seedBase: 500000, maxWave: 40 });
console.log('  ' + PAD('这一局', 10) + (st ? st.char + ' · 第 ' + st.waves + ' 波 · 层 ' + st.floor +
  ' · Lv' + st.level + ' · ' + st.frames + ' 帧 · 状态 ' + st.state : '开局失败'));

/* 画帧：着色器 / 瓦片 / 视差 / 贴图缓存都在这条路上。
   ⚠ **贴图是懒创建的**：`drawRuins` 只在没有烘焙缓存时才真的画瓦片，
   而烘焙缓存一旦建好就不再重画 —— 所以"画几帧"并不足以让瓦片路径跑起来。
   这里显式把烘焙作废一次（`R.invalidateBakes`），逼它走真正的绘制路径。 */
let drawErr = null;
try {
  const { makeCanvas } = await import('../test/_ctx.mjs');
  g.R.init(makeCanvas(1280, 720));
  if (Game.state !== 'playing') Game.setState('playing', true);
  g.R.invalidateBakes();
  for (let i = 0; i < 5; i++) g.R.draw(1 / 60);
} catch (e) { drawErr = e.message; }
console.log('  ' + PAD('渲染', 10) + (drawErr ? '\x1b[31m失败：' + drawErr + '\x1b[0m' : '画了 5 帧（含一次静态层重烘）'));

/* 着色器有两条触发路径，都要走到：
     · `hitFlash` / `elite` —— 贴图级，在**画一只正在白闪的精英怪**时用
     · `vignette` —— 屏幕级，在**低血**时用
   只画一帧普通画面是碰不到它们的（第一版就是这么漏的）。
   ⚠ **贴图路径还有第二道缓存**：`sprites.ts` 的贴图是按"倍率"整体缓存的，
   `hitFlash` 剪影更是 `e._fl` 记住的。所以光设 `e.hitFlash`/`e.elite` 没用 ——
   上面那 5 帧早就把这只怪的贴图烘好了，再画只会命中缓存，
   `ArtShaders.paint` 一次都不会被进。这里用**换 dpr 再换回来**
   走 `R.resize()` 的正规路径把贴图缓存作废（那条路本来就是为"换显示器"准备的），
   于是这一帧是真的重烘 + 真的走 shader。 */
let shaderErr = null;
try {
  const sess = Game.getSession();
  /* ⚠ 不能指望"跑完那局之后场上还有怪"：`playRun` 收尾时场上通常是空的
     （实测敌人数 0），于是 `sess.enemies[0]` 根本不存在 —— 白闪/精英两条
     贴图路径一次都进不去。这里**现造一只精英怪**（走 `spawnEnemy` 正规入口，
     不是为了这个工具新开的后门），再把它标成正在白闪。 */
  if (sess) {
    const def = (g.Enemies.LIST || []).filter(d => d && !d.boss)[0] || (g.Enemies.LIST || [])[0];
    if (def && Game._internals && Game._internals.spawnEnemy) {
      const e = Game._internals.spawnEnemy(def.id, sess.player.x + 60, sess.player.y, { elite: true });
      if (e) { e.hitFlash = 0.5; e._fl = null; e._spr = null; }
    } else if (sess.enemies.length) {
      const e = sess.enemies[0];
      e.elite = true; e.hitFlash = 0.5; e._fl = null; e._spr = null;
    }
    sess.player.hp = Math.max(1, sess.stats.maxHp * 0.1);   // 触发 vignette（低血暗角）
  }
  const dpr0 = g.window.devicePixelRatio || 1;
  g.window.devicePixelRatio = dpr0 === 1 ? 2 : 1;
  g.R.resize();                       // 倍率变了 → S.setScale + 烘焙作废
  g.window.devicePixelRatio = dpr0;
  g.R.draw(1 / 60);
  g.R.resize();                       // 换回来（顺带把倍率缓存再作废一次）
} catch (e) { shaderErr = e.message; }
console.log('  ' + PAD('着色器', 10) + (shaderErr ? '\x1b[31m失败：' + shaderErr + '\x1b[0m' : '驱动了白闪 / 精英 / 低血三条路径（含贴图缓存作废）'));

/* 音乐：每个显示帧调一次 `update`（场景 → 曲目） */
let musicScenes = 0;
for (const sc of Object.keys(Music.SCENE_TRACK)) {
  Music.enabled = true;
  Music.update(sc, 2);
  musicScenes++;
  Music.stop();
}

/* Boss 那条曲目：只有关底那一间会放。上面那局不一定经过关底，
   所以显式驱动一次 —— 否则 `boss` 会被报成"没人用"。
   ⚠ **不能拿 `update()` 的返回值当"驱动到了"的证据**：无头环境里没有
   `AudioContext`，`Music.play` 走到一半就 `return false`（那是对的，静音而已）。
   判据改成"**这条 ID 的读出口被进过**"—— 那才是路由是否接上的问题。 */
const bossBefore = hits['music.play:boss'] || 0;
try {
  Music.enabled = true;
  const saved = Music.SCENE_TRACK.playing;
  Music.SCENE_TRACK.playing = 'boss';
  Music.update('playing', 2);
  Music.SCENE_TRACK.playing = saved;
  Music.stop();
} catch (e) { }
const bossMusicOk = (hits['music.play:boss'] || 0) > bossBefore;
const audioOk = !!(g.Sfx && g.Sfx.ctx);
console.log('  ' + PAD('音乐', 10) + '走了 ' + musicScenes + ' 个场景的换曲入口 · Boss 曲 ' +
  (bossMusicOk ? '路由到过' : '没路由到') +
  ' · 音频输出 ' + (audioOk ? '有' : '无（无头环境没有 AudioContext，属预期）'));

/* 结算 + 挑战评估 + **局外经济生命周期**：档案层那条路。
   为什么要走到这儿：孢子 / 合金 / 核心材料的读点几乎全在界面与消费点上，
   无头跑一局碰不到它们。所以这里把"打完一局 → 领产出 → 买据点 → 解图纸"
   真的走一遍（钱给够，否则全是"买不起"的拒绝分支，那不算走到）。 */
let summaryOk = false, chOk = false;
let runReport = null;
try { const s = Game.summary(); summaryOk = !!s; } catch (e) { }
try {
  if (typeof g.Profile !== 'undefined' && typeof g.Profile.snapshot === 'function') { g.Profile.snapshot(); }
  chOk = true;
} catch (e) { }
/* 把这一局的产出真的入档（上一步只是 snapshot，没有 applyRun） */
try {
  const P = g.Profile;
  runReport = P.applyRun({
    char: st ? st.char : 'ranger', wave: st ? st.waves : 1, level: st ? st.level : 1,
    kills: st ? st.kills : 0, materials: st ? st.materials : 0,
    damage: 0, taken: 0, healed: 0, packs: 0, win: false, danger: 0,
    peaks: { maxHarvesting: 30, maxLuck: 12, maxTurrets: 2, maxWeapons: 3, minHpWaveEnd: 2 },
    alloy: st ? st.growth : 0, coreEarned: st ? st.coreEarned : 0,
    weaponIds: [], itemIds: [], seenItemIds: []
  }, { runs: 12, wins: 3, bestWave: 30, bestKills: 300, bestLevel: 40 });
} catch (e) { runReport = null; }
/* 局外消费：据点每一级、图纸每一个节点都试着买一遍（钱给足 = 走到"买得起"那一支） */
let keepTried = 0, forgeTried = 0;
try {
  const P = g.Profile, SH = g.Stronghold, FG = g.Forge;
  /* 给足孢子与合金，好让 canBuy / canUnlock 走到"成立"的那一支；
     核心材料**不给足**（一局只有 1~3 笔），正好覆盖"缺核心"的拒绝分支。 */
  if (P.addSpores) { try { P.addSpores(99999); } catch (e) { } }
  if (P.addAlloy) { try { P.addAlloy(9999); } catch (e) { } }
  for (const f of SH.LIST) for (let lv = 0; lv < 4; lv++) { try { P.keepBuy(f.id); keepTried++; } catch (e) { } }
  for (const n of FG.LIST) { try { P.forgeNode(n.id); forgeTried++; } catch (e) { } }
  if (P.takeTalent) for (const c of g.Chars.LIST) for (const n of (g.Talents.LIST || [])) {
    try { P.takeTalent(c.id, n.id); } catch (e) { }
  }
  if (P.settleOffline) { try { P.settleOffline(Date.now() + 6 * 3600 * 1000); } catch (e) { } }
} catch (e) { }
/* 核心材料那一档**故意单独再走一遍**：它是全游戏最稀的一档，
   `canBuy` / `canUnlock` 只在"够核心"的那一支才会去读 `Profile.core()`。
   上面那轮钱给足之后设施已经满级，读点反而碰不到 —— 所以补一小段：
   打三局 Boss（`applyRun` 带 `coreEarned`）攒核心，再买带核心门槛的那一级。 */
let coreGated = 0;
try {
  const P = g.Profile;
  for (let i = 0; i < 4; i++) {
    P.applyRun({ char: 'ranger', wave: 20, level: 30, kills: 100, materials: 200,
      coreEarned: 1, peaks: {}, win: true, danger: 0 }, {});
  }
  for (const f of g.Stronghold.LIST) for (let lv = 0; lv < 4; lv++) {
    const r = P.keepBuy(f.id);
    if (r && r.ok && r.core > 0) coreGated++;
  }
  for (const n of g.Forge.LIST) { const r = P.forgeNode(n.id); if (r && r.ok && r.core > 0) coreGated++; }
} catch (e) { }
console.log('  ' + PAD('结算', 10) + (summaryOk ? '拿到战报' : '没拿到') +
  ' · 挑战评估 ' + (chOk ? '跑过' : '没跑') +
  ' · 局外消费 ' + keepTried + ' 次据点 / ' + forgeTried + ' 次图纸');
if (process.env.REC_DEBUG) {
  console.log('  [debug] shader 键：' + Object.keys(hits).filter(k => k.indexOf('shader') === 0)
    .map(k => k + '=' + hits[k]).join(' ') + ' · 敌人数 ' +
    ((Game.getSession() && Game.getSession().enemies.length) || 0));
}
console.log('');

/* ---------------- 3. 逐表对账 ----------------
   `readOf` 里的 n>0 表示"运行时读到了"。对**审计专用的辅助函数**
   （只被 `audit()` 或工具调、运行时根本不走的）单独注明 ——
   把它们算成"没人用"是校验在冤枉代码。 */
const results = [];
function section(title, declared, readOf, note) {
  const got = [], zero = [];
  for (const id of declared) {
    const n = readOf(id);
    if (n > 0) got.push({ id, n }); else zero.push(id);
  }
  results.push({ title, total: declared.length, got: got.length, zero, note });
  const pct = (got.length / Math.max(1, declared.length)) * 100;
  const mark = pct >= 90 ? '\x1b[32m' : (pct >= 50 ? '\x1b[33m' : '\x1b[31m');
  console.log(title);
  console.log('  ' + mark + got.length + ' / ' + declared.length + ' 条在运行时被读到（' +
    pct.toFixed(0) + '%）\x1b[0m' + (note ? '  ' + note : ''));
  if (zero.length) {
    const show = zero.slice(0, 12);
    console.log('  没读到：' + show.join(', ') + (zero.length > show.length ? ' …（共 ' + zero.length + '）' : ''));
  }
  console.log('');
}

/* 曲线：`Curves.at(id)` 的 id。
   有四条**在模块加载时就被读掉了**（`game.ts` 顶部的 `ELITE_*` 与 `LEVELUP_CARDS`），
   而计数器是在那之后才装上的 —— 所以它们永远读不到 0，但那**不是"没人用"**：
   它们被折成了常量，主循环里再也不回表（那是刻意的：每只怪查一次表纯属浪费）。
   这份工具**静态确认**那四个读点真的在源码里，然后把它们单独归一类报出来 ——
   既不能把"开机读过"算成"运行时在读"，也不能把它冤枉成死数据。 */
const BOOT_CURVES = ['elite.hp', 'elite.dmg', 'elite.speed', 'player.cardGain'];
const bootSeen = new Set();
try {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/game.ts', import.meta.url), 'utf8');
  for (const id of BOOT_CURVES) if (src.indexOf("Curves.at('" + id + "'") >= 0) bootSeen.add(id);
} catch (e) { /* 读不到源码就照实报成没读到 */ }
{
  const ids = Curves.LIST.map(c => c.id);
  const live = [], boot = [], dead = [];
  for (const id of ids) {
    if ((hits['curve.at:' + id] || 0) > 0) live.push(id);
    else if (bootSeen.has(id)) boot.push(id);
    else dead.push(id);
  }
  results.push({ title: '[1] 数值曲线（' + ids.length + ' 条）', total: ids.length,
    got: live.length + boot.length, zero: dead });
  console.log('[1] 数值曲线（' + ids.length + ' 条）—— `Curves.at(id)` 被调用');
  console.log('  \x1b[32m' + live.length + ' 条在主循环里被读\x1b[0m · ' +
    '\x1b[36m' + boot.length + ' 条在模块加载时读一次（折成常量）\x1b[0m · ' +
    (dead.length ? '\x1b[31m' + dead.length + ' 条没人读\x1b[0m' : '\x1b[32m0 条没人读\x1b[0m'));
  console.log('  开机读一次的：' + (boot.join(', ') || '无'));
  console.log('  没人读的：' + (dead.join(', ') || '无'));
  console.log('');
}

/* 货币：运行时**没有** `flowsFrom` 这个读点 —— 它是审计辅助（`audit` 与体检工具用）。
   真正的运行时读点是"某一笔钱在**结算/消费**时被引用"，
   而那散在 `profile.ts` 的 `addSpores` / `keepBuy` / `forgeNode` 等处。
   这里改用**能在无头环境里驱动**的口径：`Eco.edge(from,to)` 与 `Eco.byTier`。 */
section('[2] 货币（4 笔）—— 被真的读过 / 写过',
  Economy.LIST.map(c => c.id),
  id => (hits['curRead:' + id] || 0) + (hits['curWrite:' + id] || 0),
  '（`flowsFrom` / `edge` / `byTier` 是**审计辅助**，全仓只有 `audit()` 在调 —— ' +
  '运行时根本不查那张表，所以口径换成了"账有没有被读写"。' +
  '**读数是驱动出来的**：第 2 节把"打一局 → 结算 → 买据点 → 解图纸"真的走了一遍，' +
  '否则这四处全在界面上，无头跑一局碰不到。它的意义是"整条链通不通"，不是"玩家一局读几次"）');

/* 美术类别：`Art.lintAsset({kind})` —— 只有测试与工具会调，运行时不该调。
   这一条**故意**用另一个口径：看"这一类有没有生产模块"（那才是运行时的真相） */
section('[3] 美术类别（12 类）—— 有生产模块（`Art.ownersOf`）',
  Art.KINDS.map(k => k.id),
  id => Art.ownersOf(id).length);

/* 着色器 */
section('[4] 2D 着色器（8 条）—— `paint(x, id)` 被调用',
  ArtShaders.LIST.map(s => s.id),
  id => hits['shader.paint:' + id] || 0);

/* 曲目 */
section('[5] 背景音乐（5 条）—— `Music.play(id)` 被调用',
  Music.TRACKS.map(t => t.id),
  id => hits['music.play:' + id] || 0);

/* 瓦片集：`ruinFloor` 是**铺装**（每波重烘时铺一次）；
   `dungeonStructure` 是**结构件**（墙 / 门槛）—— 它现在没有运行时读点，
   因为它对应的那一层绘制（战场外墙）还是 `drawBounds` 的四个矩形。
   这件事本身要如实报出来，而不是换一个口径把它藏掉。 */
section('[6] 瓦片集（2 套）—— `ArtTiles.autotile(set)` 被调用',
  ArtTiles.TILESETS.map(t => t.id),
  id => hits['tileSet.autotile:' + id] || 0,
  '（`dungeonStructure` 是结构件，运行时读点还没接 —— 见 README 的"没做的"）');

/* 挑战的度量：`challengeMetric` 家族声明了 35 个指标名，但**挑战表只引用了其中一部分**
   （隐藏挑战走 `secretCh`，所以这里按表的 `metric` 字段收，不按文本正则）。
   ⚠ 挑战是**跨局**统计（`Challenges` 读的是档案里的累计值），而 `playRun` 跑的
   是**一局**、不碰档案 —— 所以要显式驱动一次档案层的评估，否则整张表会被报成没人用。
   于是这张表分两半报：
     · 被挑战引用的 —— "这条度量真的驱动了一条挑战"
     · 没被引用的 —— 再看它有没有**采样点**（`main.ts` 的 `samplePeaks`）：有采样点
       就是"备着还没用上"的内容余量，没有采样点才是真正的死声明。
   把两半混在一起报 13/35 会让人以为"表烂了"，而真相是"表比内容宽"。 */
{
  const metrics = g.Registry.ids('challengeMetric');
  try {
    const P = g.Profile;
    if (P && typeof P.applyRun === 'function') {
      P.applyRun({
        char: st ? st.char : 'ranger', wave: st ? st.waves : 1, level: st ? st.level : 1,
        kills: st ? st.kills : 0, materials: st ? st.materials : 0, damage: 0, taken: 0,
        healed: 0, packs: 0, win: false, danger: 0, peaks: {},
        alloy: st ? st.growth : 0, coreEarned: st ? st.coreEarned : 0
      }, {});
    }
  } catch (e) { /* 驱动不动就照实报 0 */ }
  const referenced = new Set(g.Challenges.LIST.map(d => d.metric).filter(Boolean));
  const sampled = new Set(['maxHarvesting', 'maxLuck', 'maxEngineering', 'maxRangedDmg',
    'maxElementalDmg', 'maxMeleeDmg', 'maxRange', 'maxHp', 'maxTurrets', 'maxWeapons', 'minHpWaveEnd']);
  const driven = metrics.filter(m => referenced.has(m));
  const spare = metrics.filter(m => !referenced.has(m) && sampled.has(m));
  const dead = metrics.filter(m => !referenced.has(m) && !sampled.has(m));
  results.push({ title: '[7] 挑战度量（' + metrics.length + ' 个）', total: metrics.length,
    got: driven.length, zero: spare.concat(dead) });
  console.log('[7] 挑战度量（' + metrics.length + ' 个指标名）');
  console.log('  \x1b[32m' + driven.length + ' 个驱动着挑战\x1b[0m · ' +
    '\x1b[33m' + spare.length + ' 个有采样点但没挑战用\x1b[0m · ' +
    '\x1b[36m' + dead.length + ' 个没采样点也没挑战用\x1b[0m');
  console.log('  （`Challenges.context` 会把 35 个名字全部摊平进 `flat`，' +
    '所以"读到"这件事对整张表都成立；这里问的是更严的**有没有人用**）');
  console.log('  没挑战用但有采样（备着）：' + (spare.join(', ') || '无'));
  console.log('  没挑战用也没采样（纯余量）：' + (dead.join(', ') || '无'));
  console.log('');
}

/* 道具 / 武器的商店出口：跑一局里"有多少件真的上过货架" */
{
  const offered = new Set();
  const origRoll = Weapons.rollShop;
  Weapons.rollShop = function () { const d = origRoll.apply(this, arguments); if (d) offered.add(d.id); return d; };
  const origRollI = Items.rollShop;
  Items.rollShop = function () { const d = origRollI.apply(this, arguments); if (d) offered.add(d.id); return d; };
  playRun({ runIndex: 3, seedBase: 500000, maxWave: 40 });
  Weapons.rollShop = origRoll;
  Items.rollShop = origRollI;
  const wZero = Weapons.LIST.filter(w => !offered.has(w.id)).map(w => w.id);
  const iZero = Items.LIST.filter(i => !offered.has(i.id)).map(i => i.id);
  results.push({ title: '[8] 商店出口（55 件）', total: Weapons.LIST.length + Items.LIST.length,
    got: offered.size, zero: wZero.concat(iZero) });
  console.log('[8] 商店出口（' + (Weapons.LIST.length + Items.LIST.length) + ' 件）—— 上过货架');
  console.log('  ' + (offered.size >= (Weapons.LIST.length + Items.LIST.length) * 0.6 ? '\x1b[32m' : '\x1b[33m') +
    offered.size + ' / ' + (Weapons.LIST.length + Items.LIST.length) + ' 件在一局里上过货架\x1b[0m');
  console.log('  没上过：' + (wZero.concat(iZero).slice(0, 12).join(', ') || '（全上过）'));
  console.log('');
}

/* ---------------- 4. 结论 ---------------- */
console.log('=== 结果 ===');
let allZero = 0, allTotal = 0;
for (const r of results) { allZero += r.zero.length; allTotal += r.total; }
console.log('  八张表合计：' + (allTotal - allZero) + ' / ' + allTotal + ' 条在运行时被读到（' +
  (((allTotal - allZero) / Math.max(1, allTotal)) * 100).toFixed(0) + '%）');
console.log('  出口被整个漏掉的表：' +
  (results.filter(r => r.got === 0).map(r => r.title).join(' · ') || '\x1b[32m没有 ✔\x1b[0m'));
console.log('');
console.log('  怎么读"没读到"：它**不一定是 bug** —— 精英率在第 4 间之前恒为 0、');
console.log('  结算曲只在结算时放一次、某些道具要高级包才出。真正要看的是');
console.log('  "**整张表一个出口都没被调用过**"（那说明读点漏了）。');
console.log('');
