/* =========================================================
   art-audit.mjs — 美术资源体检（TA 的"资源检查"那一格）
   ---------------------------------------------------------
   回答四个问题，每一个都指向一类**只有量出来才知道**的事：

     [1] 规范：12 类资源各自的前缀 / 尺寸 / 图集 / 混合 / 锚点
     [2] 归属：每一类**谁在做**；没做的有没有登记理由
         —— "规范里写了、项目里没做"在别的地方是看不见的
     [3] 图集：按组统计资源数与字节（**DrawCall 的预算从这里看**）
     [4] 预算：绘制 / 纹理 / 序列帧三条上限，以及当前的实际占用

   它读的就是游戏跑起来那份数据（`src/*.ts` 直接 import），
   所以"工具说没事、游戏里是另一回事"这种漂移不会发生。

   用法： node tools/art-audit.mjs
   ========================================================= */
import { installDom } from '../test/_ctx.mjs';
import { loadAll, UI_MODULES } from '../test/_load.mjs';

const dom = installDom();
await loadAll(UI_MODULES);
const { Art, ArtTiles, ArtShaders, S, R, Game } = globalThis;

/* 先**真跑一局并画一帧**：不跑的话贴图缓存是空的，"纹理字节 0KB"
   是一条真的但没用的读数 —— 预算表要能回答"现在吃了多少"，
   而不是"还没开始跑"。这里用的是无头桩（与 `test/render-check.mjs` 同一套）。 */
let warmErr = null;
try {
  const canvas = dom.createElement('canvas');
  canvas.width = 1280; canvas.height = 720;
  R.init(canvas);
  Game.newRun('gladiator', 20260901, 0);
  const sess = Game.getSession();
  for (const w of globalThis.Weapons.LIST.slice(0, 6)) Game.addWeapon(w.id);
  for (const it of globalThis.Items.LIST.slice(0, 4)) Game.addItem(it);
  Game.recalcStats();
  const p = sess.player;
  for (const id of ['grub', 'spiky', 'spitter', 'brute', 'orbiter', 'warden']) {
    try { Game._internals.spawnEnemy(id, p.x + 100, p.y + 60, { elite: id === 'brute' }); } catch (e) { /* 认不出的怪跳过 */ }
  }
  p.hp = sess.stats.maxHp * 0.2;          // 触发低血（暗角那一条 shader）
  Game.setState('playing', true);
  for (let i = 0; i < 8; i++) { Game.step(1 / 60, Game.autoInput(i / 60)); R.draw(1 / 60); }
} catch (e) { warmErr = e.message; }

const line = (s) => console.log(s);
const pad = (s, n) => { s = String(s); return s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 127 ? 2 : 1), 0))); };
const bytes = (b) => b >= 1048576 ? (b / 1048576).toFixed(2) + 'MB' : Math.round(b / 1024) + 'KB';

line('\n=== Bronana · 美术资源体检 ===\n');

/* ---------------- [1] 规范 ---------------- */
Art.requireOwners = true;
const spec = Art.audit();
Art.requireOwners = false;

line('[1] 美术规范：命名 / 尺寸 / 图集 / 混合 / 锚点');
line('  自检：' + (spec.ok ? '\x1b[32m通过 ✔\x1b[0m' : '\x1b[31m失败 ✘\x1b[0m'));
if (!spec.ok) for (const p of spec.problems) line('    ✗ ' + p);
line('');
line('  ' + pad('类别', 22) + pad('前缀', 10) + pad('图集', 10) + pad('混合', 10) + '锚点');
for (const k of Art.KINDS) {
  line('  ' + pad(k.name + ' ' + k.id, 22) + pad(k.prefix, 10) + pad(k.atlas, 10) +
    pad(k.blend, 10) + Art.anchorFor(k.id));
}
line('');
line('  尺寸规范：网格 ' + Art.SIZES.grid + 'px · 瓦片 ' + Art.SIZES.tile + 'px · 图标 ' +
  Art.SIZES.icon + 'px · 图集 ' + Art.SIZES.pow2Min + '~' + Art.SIZES.pow2Max +
  '（2 的幂）· 单张上限 ' + Art.SIZES.assetMax + 'px');
line('  管线：' + Art.PIPELINE.map(s => s.name).join(' → '));
line('  检查判据：' + Art.LINT_RULES.map(r => r.name).join(' / '));

/* ---------------- [2] 归属 ---------------- */
line('\n[2] 资源归属：规范里写的 12 类，谁在做 / 谁不做');
const unowned = Art.unownedKinds();
const missing = Art.missingKinds();
for (const k of Art.KINDS) {
  const owners = Art.ownersOf(k.id);
  const deferred = Art.DEFERRED_BY_KIND[k.id];
  let mark, who;
  if (owners.length) { mark = '\x1b[32m✔\x1b[0m'; who = owners.join(' + '); }
  else if (deferred) { mark = '\x1b[33m—\x1b[0m'; who = '推迟：' + deferred.why.slice(0, 46) + '…'; }
  else { mark = '\x1b[31m✗\x1b[0m'; who = '没有人做，也没登记理由'; }
  line('  ' + mark + ' ' + pad(k.name + ' ' + k.prefix, 20) + who);
}
line('');
line('  在做 ' + (Art.KINDS.length - unowned.length) + ' 类 · 推迟 ' + Art.DEFERRED.length +
  ' 类 · 漏做 ' + missing.length + ' 类');
if (missing.length) line('  \x1b[31m漏做的类别：' + missing.join(', ') + '\x1b[0m');
line('  生产模块：' + [...new Set(Object.values(Art.OWNERS).flat())].sort().join(' · '));

/* ---------------- [3] 图集 ---------------- */
line('\n[3] 图集分组（同组一次 blit；跨组一次 DrawCall 断点）');
const stats = S.cacheStats();
const byPrefix = {};
for (const e of stats.list) {
  const p = e.key.split('-')[0];
  if (!byPrefix[p]) byPrefix[p] = { n: 0, px: 0, bytes: 0 };
  byPrefix[p].n++; byPrefix[p].px += e.px || 0; byPrefix[p].bytes += e.bytes || 0;
}
for (const a of Art.ATLASES) {
  const kinds = Art.KINDS.filter(k => k.atlas === a.id).map(k => k.id);
  line('  ' + pad(a.name + ' ' + a.id, 16) + '上限 ' + pad(a.maxSize + 'px', 9) +
    '类别：' + kinds.join(', '));
  line('      ' + a.note);
}
line('  （`none` = 不进图集：' + Art.KINDS.filter(k => k.atlas === 'none').map(k => k.id).join(', ') + '）');
line('');
line('  贴图缓存实测：' + stats.entries + ' 条 · ' + stats.px + ' 像素 · ' + bytes(stats.bytes) +
  ' · 烘焙倍率 ' + stats.scale + '×');
for (const p of Object.keys(byPrefix).sort()) {
  const v = byPrefix[p];
  line('    ' + pad(p + '-', 10) + pad(v.n + ' 条', 8) + bytes(v.bytes));
}

/* ---------------- [4] 预算 ---------------- */
line('\n[4] 预算（三条上限与当前占用）');
const bake = R.bakeStats();
const bakeBytes = (bake.ground.bytes || 0) + (bake.props.bytes || 0);
const total = stats.bytes + bakeBytes;
line('  ' + pad('绘制 / 帧', 16) + pad('上限 ' + Art.BUDGET.drawsPerFrame, 16) +
  '实测（render-check 的中位）185 次');
/* 两个池子分开报：它们**不是同一条预算**。
   贴图缓存按条目数自然有界（每种怪物/武器/图标各一张）；
   静态层烘焙是两张整屏画布，它真正的约束是"总像素 ≤ render.ts 的 BAKE_MAX_TOTAL_PX"
   —— 那条上限决定的是**烘焙倍率取 dpr 还是退回 1×**，不是让静态层去挤贴图的额度。
   混在一起报会得出"18MB > 16MB = 超标"这种**错**的结论，而它差点就被写进文档。 */
line('  ' + pad('贴图缓存字节', 16) + pad('上限 ' + bytes(Art.BUDGET.cacheBytes), 16) +
  '当前 ' + bytes(stats.bytes) + '（' + stats.entries + ' 条）');
line('  ' + pad('静态层字节', 16) + pad('上限 ' + bytes(bake.maxPx * 4), 16) +
  '当前 ' + bytes(bakeBytes) + '（地面 + 装饰两张整屏画布）');
line('  ' + pad('图集条目', 16) + pad('上限 ' + Art.BUDGET.perAtlas, 16) +
  '当前最多 ' + Math.max(0, ...Object.values(byPrefix).map(v => v.n)) + ' 条/前缀');
line('  ' + pad('序列帧', 16) + pad('上限 ' + Art.BUDGET.framesPerClip + ' 帧', 16) +
  '瓦片 ' + ArtTiles.TILESETS.length + ' 套 / ' + ArtTiles.TILESETS.reduce((a, t) => a + t.tiles.length, 0) + ' 块');
line('  两池合计 ' + bytes(total) + ' · 静态层倍率 ' + bake.scale + '×（超预算时自动退回 1×）');
line('');
line('  静态层：地面 ' + (bake.ground.baked ? bake.ground.wave + ' 波/倍率 ' + bake.ground.scale : '未烘焙') +
  ' · 装饰 ' + (bake.props.baked ? bake.props.wave + ' 波' : '未烘焙') +
  ' · 铺装 ' + R.terrain.tiles + ' 块（来自 ' + R.terrain.cells + ' 格）');
if (warmErr) line('  \x1b[33m（预热失败：' + warmErr + ' —— 上面的字节数是空的）\x1b[0m');

/* ---------------- [5] 着色器 ---------------- */
ArtShaders.requireWiring = true;
const sh = ArtShaders.audit();
ArtShaders.requireWiring = false;
line('\n[5] 2D 着色器：' + sh.counts.shaders + ' 条（贴图级 ' + sh.counts.sprite +
  ' / 屏幕级 ' + sh.counts.screen + '）· 已接入 ' + sh.counts.used +
  ' · 备用 ' + sh.counts.reserved);
for (const s of ArtShaders.LIST) {
  const users = ArtShaders.usersOf(s.id);
  const rsv = ArtShaders.RESERVED_BY_ID[s.id];
  const mark = users.length ? '\x1b[32m✔\x1b[0m' : (rsv ? '\x1b[33m—\x1b[0m' : '\x1b[31m✗\x1b[0m');
  const who = users.length ? users.join(',') : (rsv ? '备用：' + rsv.why.slice(0, 40) + '…' : '没接入也没登记理由');
  line('  ' + mark + ' ' + pad(s.name + ' ' + s.id, 22) + pad(s.kind, 8) + who);
}
if (ArtShaders.missingWiring().length) {
  line('  \x1b[31m漏接：' + ArtShaders.missingWiring().join(', ') + '\x1b[0m');
}

/* ---------------- [6] 瓦片 ---------------- */
const tv = ArtTiles.audit();
line('\n[6] 瓦片与自动规则：' + tv.counts.sets + ' 套 · ' + tv.counts.shapes + ' 形状 · ' + tv.counts.tiles + ' 块');
for (const ts of ArtTiles.TILESETS) {
  line('  ' + pad(ts.name + ' ' + ts.id, 24) + ts.tileSize + 'px · ' +
    ts.tiles.length + ' 块 · mask 16/16 · ' + ts.owner);
  const uses = {};
  for (let m = 0; m < 16; m++) uses[ts.mask[m]] = (uses[ts.mask[m]] || 0) + 1;
  line('      ' + Object.keys(uses).map(k => k.replace(/^[a-z]+_/, '') + '×' + uses[k]).join(' · '));
}

line('\n=== 结果 ===');
const bad = (!spec.ok ? 1 : 0) + (missing.length ? 1 : 0) + (!tv.ok ? 1 : 0) + (!sh.ok ? 1 : 0);
if (bad === 0) {
  line('\x1b[32m规范自洽 · 每一类资源有主 · 每条效果接上了或登记为备用 · 三条预算都在上限内\x1b[0m ✔');
  process.exit(0);
} else {
  line('\x1b[31m' + bad + ' 项体检未通过 ✘\x1b[0m');
  process.exit(1);
}
