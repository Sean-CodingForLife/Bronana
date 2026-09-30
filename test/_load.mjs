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
  fold:    '../src/fold.ts',
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
  training: '../src/training.ts',
  bonds:   '../src/bonds.ts',
  exchange: '../src/exchange.ts',
  guide:   '../src/guide.ts',
  craft: '../src/craft.ts',
  skills:  '../src/skills.ts',
  talents: '../src/talents.ts',
  profile: '../src/profile.ts',
  challenges: '../src/challenges.ts',
  record: '../src/record.ts',
  diag: '../src/diag.ts',
  crash: '../src/crash.ts',
  comp:    '../src/comp.ts',
  world:   '../src/world.ts',
  object:  '../src/object.ts',
  rig:     '../src/rig.ts',
  draw2d:  '../src/draw2d.ts',
  collide: '../src/collide.ts',
  bronana:  '../src/bronana.ts',
  input:   '../src/input.ts',
  audio:   '../src/audio.ts',
  stats:   '../src/stats.ts',
  /* ---- R50：外观（时装）/ 入门三选 / 存档角色 ----
     `appearance` 只认识 registry + selfcheck；`openings` 还读 `stats`；
     `character` 读 `appearance`。三者都在 meta 层，所以**必须排在 `profile` 之后、
     数据表之前**吗？不必 —— 它们不 import 任何数据表（职业 id 由总账查）。
     但要排在 `stats` 之后（openings 读它），所以位置就在这一行下面。 */
  appearance: '../src/appearance.ts',
  openings:   '../src/openings.ts',
  character:  '../src/character.ts',
  tiers:   '../src/data_tiers.ts',
  elems:   '../src/data_elems.ts',
  curves:  '../src/curves.ts',
  /* ⚠ **账本拆成四本**（v3 §5.4-错误1："禁止统一 `economy.ts` 定义
     五六种货币互相兑换"）。`ledger` 是机制，四个 `eco_*` 是各模块自己的账，
     `link` 是核心素材（**在账本之外**），`economy` 只剩只读聚合。
     顺序有讲究：`economy` 靠副作用 import 把四本账接上电，所以它排在最后。 */
  ledger:  '../src/ledger.ts',
  eco_combat: '../src/eco_combat.ts',
  eco_manage: '../src/eco_manage.ts',
  eco_grow:   '../src/eco_grow.ts',
  eco_global: '../src/eco_global.ts',
  link:    '../src/link.ts',
  economy: '../src/economy.ts',
  station: '../src/station.ts',
  hall:    '../src/hall.ts',
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
  grid:    '../src/grid.ts',
  chamber: '../src/chamber.ts',
  impact:  '../src/impact.ts',
  market:  '../src/market.ts',
  levelup: '../src/levelup.ts',
  run_save: '../src/run_save.ts',
  scene:   '../src/scene.ts',
  storage: '../src/storage.ts',
  slots:   '../src/slots.ts',
  settings: '../src/settings.ts',
  tutorial: '../src/tutorial.ts',
  i18n:    '../src/i18n.ts',
  save:    '../src/save.ts',
  demo:    '../src/demo.ts',
  /* 文件存储后端（Node 专用；web 包不 import 它，见 `tsconfig.json` 的 exclude） */
  storage_fs: '../src/storage_fs.ts',
  render:  '../src/render.ts',
  ui:      '../src/ui.ts'
};

/** 模拟层（无 DOM 依赖，无头环境直接跑） */
export const SIM_MODULES = [
  /* `world`（世界系统）只需要 registry / selfcheck；`object`（对象系统）需要 comp / containers。
     两者都是 L0 地基，所以排在最前面 —— 后面的 arena / hall / game / render 都读它们。 */
  'utils', 'registry', 'selfcheck', 'fold', 'containers', 'envelope', 'dungeon', 'boons', 'story',
  'world', 'comp', 'object', 'rig', 'draw2d', 'collide', 'bronana', 'input', 'audio', 'stats',
  /* **外观与入门三选**（R50）：两者都只依赖 registry / selfcheck（openings 还读 stats），
     所以它们坐在这一批的最前面 —— `character` 读 `appearance`，顺序必须如此。 */
  'appearance', 'openings', 'character',
  'tiers', 'elems', 'curves',
  /* 账本四本 + 核心素材 + 只读聚合（顺序见 MODULES 里那段说明） */
  'ledger', 'eco_combat', 'eco_manage', 'eco_grow', 'eco_global', 'link', 'economy', 'station', 'hall',
  'exchange', 'guide', 'art_spec', 'affixes', 'synergy', 'weapons',
  'items', 'chars', 'enemies', 'arena', 'ai', 'depth', 'sprites', 'emit', 'training', 'bonds', 'game', 'grid', 'chamber', 'impact', 'market', 'scene', 'demo',
  /* 从 `game.ts` 拆出去的两块（都是"数据 ↔ 数据"的变换，不推进任何状态）：
     `levelup` = 升级池（声明表 + 两条随等级走的纯计算），
     `run_save` = 一局存档的编解码。它们排在 `game` 之后只是顺读，
     实际顺序无关 —— `game.ts` import 它们，加载器不做拓扑排序，
     但 ESM 的依赖图会先解析被 import 的那一份。 */
  'levelup', 'run_save', 'storage_fs',
  'art_tiles', 'art_shaders', 'art_parallax', 'music',
  /* 技能表只依赖 `chars` / `elems` / 注册表与自检，所以它与模拟层同批加载；
     它**不认识** `Game`（模拟层反过来读它的 `fold`），所以顺序无关紧要 ——
     但放在前面让"技能是数据"这件事在加载顺序上也成立。 */
  'skills',
  /* ---- 局外与元层 ----
     ⚠ 这一段曾经**整个消失过**（一次编辑把尾巴截掉了），而症状极隐蔽：
     `registry.mjs` 的"必须存在的家族"里列着 `scoreField`，于是它报
     "scoreField 不在总账里" —— 看起来像成绩码那边把登记删了，
     实际是**测试根本没加载 score.ts**（家族从没被登记）。
     所以这一行现在带注释：它不是可选的收尾，它是那 20 多套元层测试的入口。 */
  'profile', 'talents', 'challenges', 'danger', 'camp', 'stronghold', 'forge', 'craft',
  'settings', 'storage', 'slots', 'i18n', 'tutorial', 'daily', 'season', 'offline',
  'record', 'score', 'diag', 'crash',
  /* `save.ts` 必须排在 `slots` / `storage` / `score` / `profile` 之后
     （它的读写与登记要那几个已经在总账里），所以它是这一段的**最后一项**。
     ⚠ 少了它，5 套测试报的是 `Cannot read properties of undefined`，
     而错误位置（测试文件里那一行）与真正的原因（清单少一项）隔着很远。 */
  'save'
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
 * `nextWave()`（自动探索）会被拒（实测：营地那套测试的"每波回血/免费刷新"全都不生效）。
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
  /* 技能树按真实角色表建一次（与 `main.ts` 的 boot 同一件事）：
     `skills.ts` 自己不认识角色表（那会构成向上的依赖边），
     所以"有哪些角色"必须由调用方告诉它 —— 测试里也是。 */
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
  if (globalThis.Skills && globalThis.Chars) {
    globalThis.Skills.make({ chars: function () { return globalThis.Chars.LIST; } });
  /* 档案层也要接上技能表（与 `main.ts` 的 boot 同一件事）：
     它是**注入**而不是 import（import 会构成一条向上的依赖边）。 */
  if (globalThis.Skills && globalThis.Profile && globalThis.Profile.useSkills) {
    globalThis.Profile.useSkills(globalThis.Skills);
  }
  }
  globalThis.enterFightRoom = enterFightRoom;
  globalThis.toShop = toShop;
  return out;
}
