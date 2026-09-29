/* =========================================================
   _load.mjs — 无头测试的共享加载器
   src/*.ts 现在是真正的 ES 模块（import / export），
   测试直接用 Node 原生类型擦除 import 它们 —— 不经过任何打包器，
   测的就是浏览器里跑的那份源码。

   为了不改动既有测试主体的写法，加载后把各模块的导出挂回 globalThis，
   于是测试里 `const { Game, U } = globalThis;` 依旧成立。

   注意：DOM 桩必须在 loadAll() 之前装好 —— 动态 import 是真正的求值时机，
   input/audio 这类模块在模块顶层就会探测 window / document。
   ========================================================= */

export const MODULES = {
  utils:   '../src/utils.ts',
  registry: '../src/registry.ts',
  selfcheck: '../src/selfcheck.ts',
  containers: '../src/containers.ts',
  envelope: '../src/envelope.ts',
  dungeon: '../src/dungeon.ts',
  boons:   '../src/boons.ts',
  story: '../src/story.ts',
  synergy: '../src/synergy.ts',
  danger: '../src/danger.ts',
  daily: '../src/daily.ts',
  season: '../src/season.ts',
  offline: '../src/offline.ts',
  score: '../src/score.ts',
  camp: '../src/camp.ts',
  stronghold: '../src/stronghold.ts',
  forge: '../src/forge.ts',
  craft: '../src/craft.ts',
  talents: '../src/talents.ts',
  profile: '../src/profile.ts',
  challenges: '../src/challenges.ts',
  record: '../src/record.ts',
  diag: '../src/diag.ts',
  crash: '../src/crash.ts',
  comp:    '../src/comp.ts',
  rig:     '../src/rig.ts',
  draw2d:  '../src/draw2d.ts',
  collide: '../src/collide.ts',
  bronana:  '../src/bronana.ts',
  input:   '../src/input.ts',
  audio:   '../src/audio.ts',
  stats:   '../src/stats.ts',
  tiers:   '../src/data_tiers.ts',
  elems:   '../src/data_elems.ts',
  curves:  '../src/curves.ts',
  economy: '../src/economy.ts',
  art_spec: '../src/art_spec.ts',
  art_tiles: '../src/art_tiles.ts',
  art_shaders: '../src/art_shaders.ts',
  art_parallax: '../src/art_parallax.ts',
  music: '../src/music.ts',
  affixes: '../src/affixes.ts',
  weapons: '../src/data_weapons.ts',
  items:   '../src/data_items.ts',
  chars:   '../src/data_chars.ts',
  enemies: '../src/enemies.ts',
  arena:   '../src/arena.ts',
  ai:      '../src/ai.ts',
  depth:   '../src/depth.ts',
  sprites: '../src/sprites.ts',
  emit:    '../src/emit.ts',
  game:    '../src/game.ts',
  market:  '../src/market.ts',
  scene:   '../src/scene.ts',
  storage: '../src/storage.ts',
  slots:   '../src/slots.ts',
  settings: '../src/settings.ts',
  tutorial: '../src/tutorial.ts',
  i18n:    '../src/i18n.ts',
  save:    '../src/save.ts',
  demo:    '../src/demo.ts',
  render:  '../src/render.ts',
  ui:      '../src/ui.ts'
};

/** 模拟层（无 DOM 依赖，无头环境直接跑） */
export const SIM_MODULES = [
  'utils', 'registry', 'selfcheck', 'containers', 'envelope', 'dungeon', 'boons', 'story', 'comp', 'rig', 'draw2d', 'collide', 'bronana', 'input', 'audio', 'stats', 'tiers', 'elems', 'curves', 'economy', 'art_spec', 'affixes', 'synergy', 'weapons',
  'items', 'chars', 'enemies', 'arena', 'ai', 'depth', 'sprites', 'emit', 'game', 'market', 'scene', 'demo',
  'art_tiles', 'art_shaders', 'art_parallax', 'music',
  'storage', 'slots', 'settings', 'i18n', 'tutorial', 'save', 'challenges', 'camp', 'stronghold', 'forge', 'craft', 'talents', 'profile', 'danger', 'daily', 'season', 'offline', 'record', 'score', 'diag', 'crash'
];

/** 渲染层 = 模拟层 + render */
export const RENDER_MODULES = SIM_MODULES.concat(['render']);

/** 界面层 = 渲染层 + ui */
export const UI_MODULES = RENDER_MODULES.concat(['ui']);

/**
 * 钉住这一间不自动结束。
 *
 * 房间制之后"清空即过"成了常规路径，于是**很多短测试会在自己还没准备好时
 * 被推进商店**。以前那些测试写的是 `sess.waveLeft = 1e9`（"别让波次结束"），
 * 但 waveLeft 现在只是"时限"，清空照样会过 —— 语义变了，写法就得跟着说清楚。
 * 所以给一个名字明确的入口，挂到全局（与 loadAll 挂模块导出的做法一致），
 * 测试里直接写 `holdRoom(sess)`。
 */
export function holdRoom(sess) {
  if (sess) sess.roomHold = true;
  return sess;
}

/**
 * 把会话挪进一间**会刷怪的**房里。
 *
 * 房间制之后"哪一间"决定了刷什么：入口间/宝箱房/商店房都不刷怪
 * （`budgetMul = 0`），所以在入口间里 `_internals.startWave(n)` 会得到一片空场。
 * 想测战斗的用例先调这个，再 startWave —— 否则测的是"空房间里没有怪"。
 */
export function enterFightRoom(sess, type) {
  const s = sess || globalThis.Game.getSession();
  if (!s || !s.map) return s;
  const want = type || 'fight';
  let r = null;
  for (const room of s.map.rooms) { if (room.type === want) { r = room; break; } }
  if (!r) for (const room of s.map.rooms) { if (room.type === 'fight') { r = room; break; } }
  if (r) globalThis.Game._internals.warpTo(r.id);
  return s;
}

/**
 * 合法地回到商店。
 *
 * 房间制之后商店是"**清完这一间**之后的地方"，所以 `setState('shop', true)` 这种
 * 硬跳会造出一个假状态：人在商店里，可是这一间还没清 —— 于是门锁着，
 * `nextWave()`（自动探索）会被拒（实测：营地那套测试的"每波回血/免费刷新"全空转）。
 * 这个助手就是"把这一间打完"，也就是玩家真正走一遍的路径。
 */
export function toShop(sess) {
  const g = globalThis.Game;
  const s = sess || g.getSession();
  if (!s) return s;
  s.waveLeft = 0;
  s.spawnQueue = [];
  s.spawnIdx = 0;
  s.enemies.length = 0;
  // 从 playing / shop / camp 都能回到"清完这一间之后的商店"：
  // 后两者要先回 playing，step 才会把这一间结算掉（endWave 有 waveEnding 兜底，不会重复结算）
  if (g.state === 'playing') g.step(g.cfg.fixedDt, { x: 0, y: 0 });
  else if (g.state === 'shop' || g.state === 'camp') {
    g.setState('playing', true);
    g.step(g.cfg.fixedDt, { x: 0, y: 0 });
  }
  if (g.state !== 'shop') g.setState('shop', true);
  return s;
}

export async function loadAll(names, before) {
  if (typeof before === 'function') before();
  const out = {};
  for (const n of names) {
    const spec = MODULES[n];
    if (!spec) throw new Error('未知模块键：' + n);
    const mod = await import(spec);
    out[n] = mod;
    for (const k of Object.keys(mod)) globalThis[k] = mod[k];
  }
  globalThis.holdRoom = holdRoom;
  globalThis.enterFightRoom = enterFightRoom;
  globalThis.toShop = toShop;
  return out;
}
