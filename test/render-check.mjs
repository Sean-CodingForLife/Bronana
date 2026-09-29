/* =========================================================
   render-check.ts — 渲染层无头校验（桩 canvas）
   用 Proxy 桩掉 Canvas2D / DOM，真实执行 sprites.ts + render.ts
   目的是抓出只有浏览器才会暴露的绘制期错误与逻辑错误。
   用法： node test/render-check.mjs
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

/* ---------------- 桩 ---------------- */
const drawCalls = { count: 0, gradientUsed: false, shadowUsed: false, filterUsed: false };
const phaseCalls = {};   // 分层绘制调用统计
const phaseImg = {};     // 分层 drawImage 次数（用于校验剔除精度）
let ctxDepth = 0;        // 绘制状态栈深度
let depthMin = 0;        // 出现过的最小深度（负数说明 restore 多了）
const unbalanced = [];
const holder = { R: null };   // 加载后指向 R，桩里直接读 R.phase 做归属

const METHODS = [
  'save', 'restore', 'translate', 'rotate', 'scale', 'setTransform', 'transform',
  'beginPath', 'closePath', 'moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo',
  'arc', 'arcTo', 'ellipse', 'rect', 'fill', 'stroke', 'clip', 'fillRect', 'strokeRect',
  'clearRect', 'fillText', 'strokeText', 'measureText', 'drawImage', 'setLineDash',
  'createPattern', 'getImageData', 'putImageData'
];

/* 选项对象分配统计：
   每个绘制调用的最后一个对象参数，如果调用点写的是字面量，就是一次真实分配；
   共享常量在 Set 里会折叠成同一个身份。因此"每帧不同选项对象数"≈ 每帧分配数。 */
const optSeen = new Set();
let optPrevSize = 0;
const optByMethod = {};
const optStacks = {};
let optCallsTotal = 0;
let optSteady = false;
function optByMethodClear() { for (const k in optByMethod) delete optByMethod[k]; }
let optFrameMark = 0;
const optPerFrame = [];

function makeCtx() {
  const state = { fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1, font: '', textAlign: '', textBaseline: '', globalCompositeOperation: 'source-over', lineJoin: '', lineCap: '' };
  const target = Object.assign({}, state);
  const ctx = new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (prop === 'measureText') return () => ({ width: 10 });
      if (typeof prop === 'string' && METHODS.includes(prop)) {
        return (...args) => {
          drawCalls.count++;
          const ph = holder.R && holder.R.phase;
          if (ph) phaseCalls[ph] = (phaseCalls[ph] || 0) + 1;
          // save/restore 平衡检查：多一次 restore 会弹掉调用方的状态（真实 bug 源）
          if (prop === 'save') ctxDepth++;
          else if (prop === 'restore') {
            ctxDepth--;
            if (ctxDepth < 0) unbalanced.push('restore 多于 save');
            if (ctxDepth < depthMin) depthMin = ctxDepth;
          }
          if (args.some(a => typeof a === 'number' && !isFinite(a))) {
            throw new Error('绘制参数包含 NaN/Infinity: ' + prop + '(' + args.join(',') + ')');
          }
          // drawImage 的首参必须是真正的 canvas（历史上这里漏过 wrapper 对象）
          if (prop === 'drawImage') {
            const ph0 = holder.R && holder.R.phase;
            if (ph0) phaseImg[ph0] = (phaseImg[ph0] || 0) + 1;
            const img = args[0];
            if (img && typeof img === 'object' && typeof img.getContext !== 'function') {
              throw new Error('drawImage 收到非 canvas 对象：' +
                JSON.stringify(Object.keys(img)) + '（是否忘了取 .canvas？）');
            }
          }
          // 说明：选项对象不会传到这里（draw2d 只读取字段再调 fill/stroke），
          // 因此选项对象的分配统计改为包裹 D.* 进行，见下方 installOptProbe()。
          if (prop === 'createLinearGradient' || prop === 'createRadialGradient' || prop === 'createConicGradient') {
            drawCalls.gradientUsed = true;
          }
          return { addColorStop() {} };
        };
      }
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
        drawCalls.gradientUsed = true;
        return () => ({ addColorStop() {} });
      }
      return undefined;
    },
    set(t, prop, val) {
      if (prop === 'shadowBlur' || prop === 'shadowColor' || prop === 'shadowOffsetX' || prop === 'shadowOffsetY') {
        if (val && val !== 0 && val !== 'transparent' && val !== 'none') drawCalls.shadowUsed = true;
      }
      if (prop === 'filter' && val && val !== 'none') drawCalls.filterUsed = true;
      t[prop] = val;
      return true;
    }
  });
  return ctx;
}

function makeCanvas(w, h) {
  const ctx = makeCtx();
  return {
    width: w || 0, height: h || 0,
    getContext: () => ctx,
    style: {},
    addEventListener() {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    _ctx: ctx
  };
}

const domStub = {
  devicePixelRatio: 1,
  innerWidth: 1280,
  innerHeight: 720,
  performance: { now: () => Date.now() },
  requestAnimationFrame: () => 0,
  addEventListener() {},
  removeEventListener() {},
  createElement(tag) {
    if (tag === 'canvas') return makeCanvas(0, 0);
    return { style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, appendChild() {}, addEventListener() {}, set textContent(v) {}, set innerHTML(v) {} };
  },
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => []
};

/* ---------------- 加载 ---------------- */
console.log('\n=== Bronana · 渲染层无头校验 ===\n');
console.log('[1] 加载（含渲染层）');

const g = globalThis;
g.window = g;
g.document = domStub;
g.devicePixelRatio = 1;
g.innerWidth = 1280;
g.innerHeight = 720;

let loadErr = null;
try { await loadAll(RENDER_MODULES); } catch (e) { loadErr = e.message; }
ok(!loadErr, '渲染层以 ES 模块方式加载无异常', loadErr);
if (loadErr) process.exit(1);

const { R, S, Game, U, Arena, Weapons, Items, Chars, Enemies, PAL, D } = g;
holder.R = R;

/* ---------------- 选项对象分配探针 ----------------
   渲染代码里大量出现 D.circle(x, y, r, color, { outlineWidth: 0 }) 这种写法，
   每个字面量都是一次真实分配。包裹 D 的每个方法，记录"最后一个对象参数"的身份：
   共享常量在 Set 中会折叠成同一个对象，字面量则每条都是一次分配。
   于是"每帧不同选项对象数"≈ 每帧分配的对象数。 */
function installOptProbe() {
  Object.keys(D).forEach(k => {
    const fn = D[k];
    if (typeof fn !== 'function') return;
    D[k] = function (...args) {
      if (args.length) {
        const last = args[args.length - 1];
        if (last && typeof last === 'object' && typeof last.getContext !== 'function') {
          optCallsTotal++;
          if (!optSeen.has(last)) {
            optByMethod[k] = (optByMethod[k] || 0) + 1;
            if (optSteady) {
              const samples = (optStacks[k] = optStacks[k] || []);
              if (samples.length < 2) {
                const st = new Error().stack.split('\n').slice(2, 5)
                  .map(s => s.trim().replace(/^at\s+/, '')).filter(s => !/render-check/.test(s));
                samples.push(st[0] || '?');
              }
            }
          }
          optSeen.add(last);
        }
      }
      return fn.apply(this, args);
    };
  });
}
installOptProbe();

/* ---------------- 初始化 ---------------- */
console.log('\n[2] 画布初始化与整帧绘制');
const canvas = makeCanvas(0, 0);
let initErr = null;
try { R.init(canvas); } catch (e) { initErr = e.message + '\n' + e.stack.split('\n')[1]; }
ok(!initErr, 'R.init 成功', initErr);
ok(canvas.width === 1280 && canvas.height === 720, '画布按视口+dpr 尺寸设置', canvas.width + 'x' + canvas.height);

/* 造一个内容丰富的世界状态 */
Game.newRun('gladiator');
const sess = Game.getSession();
// 塞满各种实体，确保所有绘制分支都被走到
Weapons.LIST.slice(0, 6).forEach(w => Game.addWeapon(w.id));
Items.LIST.slice(0, 4).forEach(it => sess.player.items.push({ def: it }));
Game.recalcStats();
Game._internals.spawnEnemy('grub', sess.player.x + 120, sess.player.y, {});
Game._internals.spawnEnemy('spiky', sess.player.x - 140, sess.player.y + 60, { elite: true });
Game._internals.spawnEnemy('spitter', sess.player.x + 200, sess.player.y - 90, {});
Game._internals.spawnEnemy('brute', sess.player.x - 200, sess.player.y - 130, {});
Game._internals.spawnEnemy('jelly'.length ? 'orbiter' : 'grub', sess.player.x + 60, sess.player.y + 210, {});
Game._internals.spawnEnemy('warden', sess.player.x - 300, sess.player.y + 240, {});
sess.player.hp = sess.stats.maxHp * 0.2;       // 触发低血警示
sess.player.hurtFlash = 0.2;
sess.player.invincible = 0;
R.banner('第 5 波 · 荒原暴君', 2);

// 跑 240 帧：既模拟又渲染，覆盖子弹/粒子/命中特效/死亡
let drawErr = null, frames = 0;
const before = drawCalls.count;
const callsPerFrameArr = [];
let lastFrameCount = drawCalls.count;
try {
  for (let i = 0; i < 240; i++) {
    if (Game.state === 'playing') Game.step(1 / 60, Game.autoInput(i / 60));
    else if (Game.state === 'levelup') Game.chooseLevelCard(0);
    else if (Game.state === 'shop') Game.nextWave();
    R.draw(1 / 60);
    R.tick(1 / 60);
    if (ctxDepth !== 0) unbalanced.push('帧结束时栈深度 ' + ctxDepth);
    callsPerFrameArr.push(drawCalls.count - lastFrameCount);
    lastFrameCount = drawCalls.count;
    // 持久 Set：共享常量只在第一次出现时计入，字面量则每帧新增
    optPerFrame.push(optSeen.size - optPrevSize);
    optPrevSize = optSeen.size;
    if (frames === 30) { optSteady = true; optCallsTotal = 0; optByMethodClear(); }
    frames++;
  }
} catch (e) {
  drawErr = e.message + '\n      ' + (e.stack.split('\n')[1] || '').trim();
}
ok(!drawErr, '连续 ' + frames + ' 帧 更新+渲染 无异常', drawErr);

/* 绘制状态栈必须平衡：多一次 restore 会悄悄弹掉调用方的 alpha/变换 */
ok(unbalanced.length === 0 && depthMin >= 0,
  'save/restore 严格配对（无多余 restore、帧末栈深为 0）',
  unbalanced.slice(0, 3).join(' | ') + (depthMin < 0 ? ' 最小深度 ' + depthMin : ''));
ok(drawCalls.count - before > 5000, '绘制调用量正常（非空帧）', (drawCalls.count - before) + ' 次');

/* ---------------- 渲染开销预算（每帧绘制调用数） ---------------- */
// 用中位数代表稳态（换波时会把静态层烘焙一次，那一帧会明显偏高）
const sortedCalls = callsPerFrameArr.slice().sort((a, b) => a - b);
const callsMedian = sortedCalls[Math.floor(sortedCalls.length / 2)];
const callsMax = sortedCalls[sortedCalls.length - 1];
const callsPerFrame = (drawCalls.count - before) / frames;
console.log('  · 每帧绘制调用 中位 ' + callsMedian + ' 次（峰值 ' + callsMax +
  '，均值 ' + Math.round(callsPerFrame) + '）');
ok(callsMedian < 900, '每帧绘制调用中位数在预算内（<900）', callsMedian + ' 次/帧');

/* 分层明细：找出绘制开销集中在哪一层 */
{
  const rows = Object.entries(phaseCalls)
    .map(([k, v]) => [k, v / frames])
    .sort((a, b) => b[1] - a[1]);
  console.log('    分层（次/帧）：' + rows.map(([k, v]) => k + ' ' + v.toFixed(0)).join('  ·  '));
}

/* 选项对象分配：60fps 下每帧 N 个 = 每秒 60N 次分配。
   共享常量在持久 Set 中只计一次，因此稳态下这个数字就是"每帧真实分配数"。 */
const optAvg = optPerFrame.slice(30).reduce((a, b) => a + b, 0) / Math.max(1, optPerFrame.length - 30);
const optMax = Math.max(...optPerFrame.slice(30));
console.log('  · 每帧新建选项对象 ' + optAvg.toFixed(1) + ' 个（峰值 ' + optMax +
  '）→ 60fps 下约 ' + Math.round(optAvg * 60) + ' 次/秒');
console.log('    （改造前：每次带选项的绘制调用都是一次分配，稳态 ' +
  (optCallsTotal / Math.max(1, frames - 30)).toFixed(0) + ' 次/帧 ≈ ' +
  Math.round(optCallsTotal / Math.max(1, frames - 30) * 60) + ' 次/秒）');
const topOffenders = Object.entries(optByMethod).sort((a, b) => b[1] - a[1]).slice(0, 5);
if (topOffenders.length) {
  console.log('    分配来源：' + topOffenders.map(([k, v]) =>
    'D.' + k + '×' + (v / frames).toFixed(1) + '/帧').join('  '));
  topOffenders.forEach(([k, v]) => {
    if (optStacks[k]) console.log('      D.' + k + ' ← ' + optStacks[k].join(' | '));
  });
}
ok(optAvg < 60, '每帧选项对象分配在预算内（<60）', optAvg.toFixed(1) + ' 个/帧');

/* ---------------- 美术宪法检查 ---------------- */
console.log('\n[3] 美术宪法（禁止渐变/阴影/滤镜）');
ok(!drawCalls.gradientUsed, '全程未使用任何渐变 API');
ok(!drawCalls.shadowUsed, '全程未使用阴影/发光');
ok(!drawCalls.filterUsed, '全程未使用 CSS filter（模糊/景深）');

const srcAll = ['src/sprites.ts', 'src/render.ts', 'src/draw2d.ts']
  .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
ok(!/createLinearGradient|createRadialGradient|createConicGradient/.test(srcAll), '源码中不存在渐变调用');
ok(!/shadowBlur|shadowColor/.test(srcAll), '源码中不存在阴影调用');
ok(!/ctx\.filter|\.filter\s*=\s*['"]blur/.test(srcAll), '源码中不存在模糊滤镜');

/* ---------------- 离线绘图产出（UI 用的小图） ---------------- */
console.log('\n[4] UI 小图生成（角色肖像 / 武器 / 道具图标）');
let artErr = [];
try {
  Chars.LIST.forEach(c => { if (!S.bronanaPortrait(74, c)) artErr.push('portrait:' + c.id); });
  Weapons.LIST.forEach(w => {
    const cv = makeCanvas(62, 62);
    const cx = cv.getContext('2d');
    cx.translate(31, 31); cx.scale(0.7, 0.7);
    S.drawWeapon(cx, w.kind, -0.3, w.tints, 0.5, 1);
  });
  Items.LIST.forEach(it => { if (!S.itemIcon(it.icon, it.tint, 58)) artErr.push('icon:' + it.icon); });
  Enemies.LIST.forEach(d => {
    if (!S.enemySprite(d)) artErr.push('enemy:' + d.id);
    if (!S.enemyFlash(d)) artErr.push('flash:' + d.id);
  });
} catch (e) {
  artErr.push(e.message);
}
ok(artErr.length === 0, '全部角色/武器/道具/怪物小图可生成', artErr.slice(0, 5).join(', '));

/* ---------------- 贴图边界（防止大体积怪与 Boss 被裁切） ----------------
   这里按**各形状的设计外扩量**独立核对盒子够不够大（不引用 S.enemyBox 的公式，
   否则就是自己证自己）；"内容是否真的落在画布内"由 rig.mjs [9] 用实测包围盒断言。 */
console.log('\n[4b] 贴图边界与裁切检查');
let clipErr = [];
Enemies.LIST.forEach(d => {
  const spr = S.enemySprite(d);
  if (!spr) { clipErr.push(d.id + ' 无贴图'); return; }
  const R = 26 * (d.scale || 1);
  // 以**身体中心**为基准的可用空间（贴图自报 bodyY，渲染层也是按它定位的）
  const upRoom = spr.bodyY, downRoom = spr.height - spr.bodyY, sideRoom = spr.width / 2;
  const needSide = d.shape === 'spiky' ? R * 1.30 : R * 1.10;
  const needUp = d.shape === 'spiky' ? R * 1.30 : (d.shape === 'jelly' || d.shape === 'eye') ? R * 0.98 : R * 1.10;
  const needDown = R * 1.04 + (d.legs === 'tentacle' ? R * 0.75 : R * 0.52);
  const slack = 0.5;
  if (sideRoom + slack < needSide) clipErr.push(d.id + ' 左右裁切(' + sideRoom.toFixed(1) + '<' + needSide.toFixed(1) + ')');
  if (upRoom + slack < needUp) clipErr.push(d.id + ' 顶部裁切(' + upRoom.toFixed(1) + '<' + needUp.toFixed(1) + ')');
  if (downRoom + slack < needDown) clipErr.push(d.id + ' 底部裁切(' + downRoom.toFixed(1) + '<' + needDown.toFixed(1) + ')');
  if (spr.width <= 0 || spr.height <= 0) clipErr.push(d.id + ' 尺寸非法');
  if (spr.bodyY === undefined || spr.foot === undefined) {
    clipErr.push(d.id + ' 没报出锚点（渲染层就无法把贴图对准敌人坐标）');
  }
});
ok(clipErr.length === 0, '全部 ' + Enemies.LIST.length + ' 种怪物贴图预留了足够留白', clipErr.slice(0, 5).join(' | '));

/* ---------------- [4c] 角色姿态图集（把多笔绘制烘成一张图） ----------------
   批处理/图集的关键判据：**同一姿势必须命中同一张图**（否则每帧都在重烘，
   比不烘还慢），而且烘出来的内容不能超出画布。 */
console.log('\n[4c] 角色姿态图集');
{
  const def = Chars.LIST[0];
  const opts = { r: 18, sy: 1.003, skin: null, seed: 7, face: 0, mood: 'idle', eyeStyle: 'stern', dots: true };
  const a1 = S.playerBodySprite(def, opts);
  const a2 = S.playerBodySprite(def, opts);
  ok(!!a1, '图集能生成', def.id);
  ok(a1 === a2, '同一姿势第二次取用命中同一张贴图（不是每帧重烘）');
  const other = S.playerBodySprite(def, { ...opts, sy: 1.017 });
  ok(other !== a1, '不同呼吸档位是不同贴图（逐档各烘一张，绘制时不缩放）');
  ok(a1.width > 0 && a1.height > 0 && a1.canvas.width >= Math.ceil(a1.width * S.scale()),
    '贴图按设备倍率烘焙（2× 屏同样清楚）',
    a1.canvas.width + ' / ' + a1.width + ' @' + S.scale());

  // 烘焙确实在画东西（不是空贴图）：现烘一张没缓存过的，数它的绘制调用
  const before = drawCalls.count;
  S.playerBodySprite(def, { ...opts, seed: 12345 });
  const bakeCalls = drawCalls.count - before;
  ok(bakeCalls > 40, '一次烘焙要画几十笔（说明烘的是真身体，不是空贴图）', bakeCalls + ' 笔');

  // 预热后条目有界：一次呼吸只覆盖 0.975~1.025 的档位
  const atlasCount = () => S.cacheStats().list.filter(e => e.key.indexOf('atlas-') === 0).length;
  const pre = atlasCount();
  const n = S.warmPlayerAtlas(def, { r: 18, skin: null, seed: 7, eyeStyle: 'stern' });
  const atlas = S.cacheStats().list.filter(e => e.key.indexOf('atlas-') === 0);
  ok(n >= 20 && n <= 40 && atlasCount() - pre <= 30,
    '预热把整段呼吸的档位一次烘完（' + n + ' 张，同期只增 ' + (atlasCount() - pre) + ' 张）',
    atlas.length + ' 张');
  console.log('    · 图集条目 ' + atlas.length + ' 张，共 ' +
    (atlas.reduce((a, e) => a + e.bytes, 0) / 1048576).toFixed(2) + 'MB');
}


/* ---------------- [4d] 武器图集 + 贴花 LOD ---------------- */
console.log('\n[4d] 武器图集 / 贴花 LOD');
{
  const kind = Weapons.LIST[1].kind, tints = Weapons.LIST[1].tints;
  const w1 = S.weaponSprite(kind, tints, 0.82, 0);
  const w2 = S.weaponSprite(kind, tints, 0.82, 0);
  ok(!!w1 && w1 === w2, '同参数命中同一张武器贴图（' + kind + '）');
  ok(S.weaponSprite(kind, tints, 0.82, 1) === w1, '形状与 swing 无关的武器不分档（' + kind + '）');
  if (S.WEAPON_SWING_SHAPED.tentacle) {
    const t0 = S.weaponSprite('tentacle', [PAL.BLOOD, PAL.INK], 0.82, 0);
    const t1 = S.weaponSprite('tentacle', [PAL.BLOOD, PAL.INK], 0.82, 1);
    ok(!!t0 && !!t1 && t0 !== t1, '形状随 swing 变的武器按档各烘一张（tentacle）');
  }
  ok(w1.canvas.width >= Math.ceil(w1.width * S.scale()), '武器图集同样按设备倍率烘焙');

  // 贴花 LOD：淡到 <0.35 的只画主圆（1 笔），新的仍然 3 笔。
  // 用 render-check 自己的桩：按 phase 统计 decals 层的绘制调用数。
  //
  // 夹具要点：血迹要放在**玩家脚下**，不能放固定坐标。
  // 固定坐标 (100,100) 曾经能用，但那是**隐性耦合** —— 它假设前面几节把相机留在了左上角；
  // 一旦别的测试改了开局内容，相机位置变了，血迹就全被视口剔除，
  // 于是"splash 与 plain 都等于 0"，这条断言以一种看不出原因的方式红掉。
  // 相机永远跟着玩家，所以以玩家为参照才是自洽的夹具。
  const sess = Game.getSession();
  const bx = Math.round(sess.player.x), by = Math.round(sess.player.y);
  const countDecals = (n, fresh) => {
    sess.decals.length = 0; sess.decalSeq = 0;
    Game._internals.addStain(bx, by, 14, PAL.BLOOD);                // 最新（alpha 0.55）
    for (let i = 0; i < n; i++) Game._internals.addStain(bx + i, by - 40, 14, PAL.BLOOD);
    if (!fresh) {                                                   // 让第一条也变旧
      sess.decals.length = 0; sess.decalSeq = 0;
      for (let i = 0; i < n + 1; i++) Game._internals.addStain(bx + i, by - 40, 14, PAL.BLOOD);
    }
    const b = phaseCalls.decals || 0;
    R.draw(1 / 60);
    return (phaseCalls.decals || 0) - b;
  };
  const calls = countDecals(40, true);
  // 逐条按规则算一遍期望值：视野内且 alpha≥0.03 才画，alpha≥0.35 画 3 笔否则 1 笔
  let expect = 0, splash = 0, plain = 0;
  for (const d of sess.decals) {
    const a = R.decalAlpha(d, sess);
    if (!R.inView(d.x, d.y, d.r * 2) || a < 0.03) continue;
    if (a >= 0.35) { expect += 9; splash++; } else { expect += 3; plain++; }   // 每画一个圆 = beginPath+arc+fill
  }
  ok(calls >= expect && calls <= expect + 8 && splash > 0 && plain > 0,
    '贴花层笔数 = 逐条按 LOD 规则算出的期望（' + splash + ' 条完整 + ' + plain + ' 条只画主圆）',
    calls + ' vs ' + expect);
}

/* ---------------- 视口剔除：效果与正确性（确定性场景） ---------------- */
console.log('\n[6] 视口剔除');
{
  // 固定种子 + 固定布局，保证可复现的 A/B 对比
  const s2 = Game.newRun('ranger', 12345);
  const ss = Game.getSession();
  holdRoom(ss);
  ss.arena = Arena.build(9);
  ss.enemies.length = 0; ss.pickups.length = 0; ss.decals.length = 0;
  ss.particles.length = 0; ss.textParticles.length = 0; ss.bullets.length = 0; ss.ebullets.length = 0;

  // 300 只怪铺满整个战场（后期真实密度）+ 其他实体也铺满
  let n = 0;
  for (let gy = 0; gy < 15 && n < 300; gy++) {
    for (let gx = 0; gx < 20 && n < 300; gx++) {
      const e = Game._internals.spawnEnemy('grub', 60 + gx * 80, 60 + gy * 80, {});
      if (e) { e.spawnT = 0; n++; }
    }
  }
  for (let i = 0; i < 80; i++) {
    ss.pickups.push({ kind: 'mat', x: 40 + (i * 137) % 1600, y: 40 + (i * 211) % 1200, vx: 0, vy: 0, seed: i, value: 1 });
    Game._internals.addStain(30 + (i * 173) % 1620, 30 + (i * 97) % 1200, 12, '#7c3b62');
  }
  for (let i = 0; i < 120; i++) {
    EmitSpawnHelper(i);
  }
  function EmitSpawnHelper(i) {
    const g2 = globalThis.Emit;
    g2.spawn({ kind: 'spark', x: 40 + (i * 149) % 1600, y: 40 + (i * 61) % 1200, vx: 0, vy: 0, r: 3, color: '#fff', life: 5 });
  }

  ss.player.x = Arena.W / 2; ss.player.y = Arena.H / 2;

  function measure(cullOn) {
    R.cullEnabled = cullOn;
    // 稳定摄像机
    for (let i = 0; i < 40; i++) R.draw(1 / 60);
    const c0 = drawCalls.count;
    phaseImg.enemies = 0;
    R.draw(1 / 60);
    const c1 = drawCalls.count;
    const img = phaseImg.enemies || 0;
    return { calls: c1 - c0, enemyImgs: img };
  }

  const off = measure(false);
  const on = measure(true);
  const cut = (1 - on.calls / off.calls) * 100;
  console.log('    关闭剔除 ' + off.calls + ' 次/帧 →  开启剔除 ' + on.calls +
    ' 次/帧（降低 ' + cut.toFixed(1) + '%）');
  console.log('    怪物层 drawImage：' + off.enemyImgs + ' → ' + on.enemyImgs + ' 张');

  // 密集场景的分层明细（这才是后期真实压力）
  for (const k in phaseCalls) delete phaseCalls[k];
  R.cullEnabled = true;
  for (let i = 0; i < 5; i++) R.draw(1 / 60);
  for (const k in phaseCalls) delete phaseCalls[k];
  R.draw(1 / 60);
  const dense = Object.entries(phaseCalls).map(([k, v]) => [k, v])
    .sort((a, b) => b[1] - a[1]);
  console.log('    密集场景分层：' + dense.map(([k, v]) => k + ' ' + v).join('  ·  '));

  /* 贴花层专项：它是密集场景第二大开销，也是"要不要上烘焙层"这个决定的依据。
     save/restore 提到循环外之后 605 → 497（每帧省 2×已画贴花数）。
     阈值取 560：改造前是 605，会红；现在 497，余量足够。 */
  const decalCalls = phaseCalls.decals || 0;
  const denseTotal = dense.reduce((a, b) => a + b[1], 0);
  console.log('    贴花层 ' + decalCalls + ' 次/帧（密集场景占比 ' +
    (decalCalls / Math.max(1, denseTotal) * 100).toFixed(1) + '%，改造前 605）');
  ok(decalCalls < 560, '贴花层每帧调用受控（save/restore 已提到循环外）', decalCalls + ' 次/帧');
  ok(cut > 15, '剔除显著降低绘制调用（300 怪铺满战场）', cut.toFixed(1) + '%');
  ok(on.calls > 100, '剔除后仍有内容在画（没有过度剔除）', on.calls + ' 次');

  /* 换波那一帧：地面烘焙是全游戏最重的单帧。把它单独测出来，而不是让一个
     "峰值 4.9 万" 的数字孤零零印在日志里 —— 这是已知并接受的每波一次尖峰，
     但它的上限要有人守（有人在静态层里加重活就会红）。 */
  {
    R.ground.wave = -1;                       // 强制重新烘焙
    for (const k in phaseCalls) delete phaseCalls[k];
    const c0 = drawCalls.count;
    R.draw(1 / 60);
    const bakeCalls = drawCalls.count - c0;
    const bakeSplit = Object.entries(phaseCalls).map(([k, v]) => k + ' ' + v).sort()
      .filter(s => !/ (0|1|4|9|10)$/.test(s)).join('  ·  ');
    console.log('    换波烘焙帧 ' + bakeCalls + ' 次调用（' + bakeSplit + '）');
    ok(bakeCalls > 20000, '地面烘焙确实是最重的单帧（4.5 万次 fillRect 的抖动）', bakeCalls);
    ok(bakeCalls < 60000, '烘焙帧上限被守住（>60000 说明静态层里被加了重活）', bakeCalls);
  }

  // 精度校验：视野内 5 只 + 视野外 5 只 → 恰好画 5 张身体贴图
  ss.enemies.length = 0;
  const cam = R.cam;
  for (let i = 0; i < 5; i++) {
    const e1 = Game._internals.spawnEnemy('grub', cam.x - 100 + i * 40, cam.y - 60, {});
    if (e1) e1.spawnT = 0;
    const e2 = Game._internals.spawnEnemy('grub', cam.x - 100 + i * 40, cam.y - 5000, {});
    if (e2) e2.spawnT = 0;
  }
  R.view.on = true;
  R.draw(1 / 60);
  phaseImg.enemies = 0;
  R.draw(1 / 60);
  ok(phaseImg.enemies === 5, '视野内 5 只怪各画 1 张、视野外 5 只不画',
    '实际 ' + (phaseImg.enemies || 0) + ' 张');

  // 恢复：世界坐标下的实体不应被误剔除（摄像机跟随玩家）
  ss.enemies.length = 0;
  const e3 = Game._internals.spawnEnemy('warden', ss.player.x + 120, ss.player.y + 60, {});
  if (e3) e3.spawnT = 0;
  for (let i = 0; i < 30; i++) R.draw(1 / 60);
  phaseImg.enemies = 0;
  R.draw(1 / 60);
  ok(phaseImg.enemies >= 1, '摄像机附近的 Boss 正常绘制', phaseImg.enemies + ' 张');
}

/* ---------------- 摄像机抖动（trauma 模型） ---------------- */
console.log('\n[7] 摄像机抖动');
{
  const sh = R.shake;
  // a) 无 trauma 时不得有任何残留抖动
  R.resetShake();
  for (let i = 0; i < 10; i++) R.draw(1 / 60);
  ok(R.shake.x === 0 && R.shake.y === 0 && R.cam.shakeX === 0 && R.cam.shakeY === 0,
    '无 trauma 时偏移严格为 0（无残留抖动）',
    R.shake.x + ',' + R.shake.y);

  // b) 确定性：同 seed 同时序 → 逐帧完全一致
  function trace(hz, seconds, trauma) {
    R.resetShake();
    R.addTrauma(trauma);
    const dt = 1 / hz, n = Math.round(seconds * hz);
    const out = [];
    for (let i = 0; i < n; i++) { R.draw(dt); out.push(R.shake.x); }
    return out;
  }
  const t1 = trace(60, 0.4, 0.6);
  const t2 = trace(60, 0.4, 0.6);
  let identical = t1.length === t2.length;
  for (let i = 0; identical && i < t1.length; i++) if (t1[i] !== t2[i]) identical = false;
  ok(identical, '同样输入产生完全相同的抖动轨迹（确定性，不依赖 Math.random）');

  // c) 与刷新率无关：每秒位移总量在 60Hz 与 144Hz 下应接近
  function totalVariationPerSec(hz, seconds, trauma) {
    const tr = trace(hz, seconds, trauma);
    let tv = 0;
    for (let i = 1; i < tr.length; i++) tv += Math.abs(tr[i] - tr[i - 1]);
    return tv / seconds;
  }
  const tv60 = totalVariationPerSec(60, 0.5, 0.8);
  const tv144 = totalVariationPerSec(144, 0.5, 0.8);
  const ratio = tv144 / tv60;
  console.log('    每秒位移总量：60Hz ' + tv60.toFixed(1) + 'px  144Hz ' +
    tv144.toFixed(1) + 'px  比值 ' + ratio.toFixed(2) + '（旧实现为 ~2.4 倍）');
  ok(ratio > 0.75 && ratio < 1.35, '抖动强度与刷新率无关（比值接近 1）', ratio.toFixed(2));

  // d) 幅度上限：trauma=1、zoom=1 时不超过设定的屏幕像素上限
  R.resetShake();
  R.addTrauma(1);
  let peak = 0;
  for (let i = 0; i < 60; i++) {
    R.draw(1 / 60);
    peak = Math.max(peak, Math.abs(R.shake.x), Math.abs(R.shake.y));
  }
  console.log('    trauma=1 峰值位移 ' + peak.toFixed(2) + 'px（上限 ' + R.SHAKE_MAX_PX + 'px）');
  ok(peak <= R.SHAKE_MAX_PX + 0.001, '抖动幅度不超过上限', peak.toFixed(2) + 'px');

  // e) 缩放一致性：zoom=2 时世界单位位移应减半（屏幕观感不变）
  R.cam.zoom = 2;
  R.resetShake(); R.addTrauma(1);
  R.draw(1 / 60);
  const worldAtZoom2 = Math.abs(R.shake.x);
  R.cam.zoom = 1;
  R.resetShake(); R.addTrauma(1);
  R.draw(1 / 60);
  const worldAtZoom1 = Math.abs(R.shake.x);
  ok(Math.abs(worldAtZoom2 * 2 - worldAtZoom1) < 0.01,
    'zoom 变化时屏幕位移保持一致',
    'zoom1 ' + worldAtZoom1.toFixed(2) + ' / zoom2×2 ' + (worldAtZoom2 * 2).toFixed(2));

  // f) 衰减归零：约 0.42 秒内 trauma 必须回到 0，且不会回弹
  R.resetShake(); R.addTrauma(1);
  let framesToZero = -1;
  for (let i = 0; i < 200; i++) {
    R.draw(1 / 60);
    if (R.shake.trauma <= 0) { framesToZero = i + 1; break; }
  }
  const secsToZero = framesToZero / 60;
  console.log('    trauma 1→0 用时 ' + secsToZero.toFixed(2) + 's');
  ok(framesToZero > 0 && secsToZero < 0.6, '抖动按时衰减归零', secsToZero.toFixed(2) + 's');

  // g) 归零后摄像机精确回到玩家位置（抖动不产生漂移）
  const pl = Game.getSession().player;
  pl.x = Arena.W / 2; pl.y = Arena.H / 2;
  for (let i = 0; i < 90; i++) R.draw(1 / 60);
  ok(Math.abs(R.cam.x - pl.x) < 0.5 && Math.abs(R.cam.y - pl.y) < 0.5 &&
     R.cam.shakeX === 0 && R.cam.shakeY === 0,
    '抖动结束后摄像机精确回到玩家位置（无漂移）',
    'cam ' + R.cam.x.toFixed(1) + ',' + R.cam.y.toFixed(1));

  // h) max 语义：高频小冲击不应把 trauma 累加到 1
  R.resetShake();
  for (let i = 0; i < 30; i++) R.addTrauma(0.2);
  ok(R.shake.trauma <= 0.2 + 1e-9, '高频小冲击不会累加顶满（max 语义）', R.shake.trauma);
  R.resetShake();
}

/* ---------------- 角色呼吸 / 走路律动 ---------------- */
console.log('\n[8] 角色律动（呼吸 / 走路）');
{
  const sess8 = Game.newRun('ranger', 2024);
  const p = sess8.player;
  holdRoom(sess8);
  const FIXED = Game.cfg.fixedDt;

  // 用假玩家对象直接求曲线（确定性、不依赖模拟）
  const fake = (animT, moveBlend) => ({ animT: animT, moveBlend: moveBlend });

  // a) 曲线连续性：细密扫描不应出现跳变
  let maxFine = 0;
  for (let i = 0; i < 4000; i++) {
    const a = R.playerAnim(fake(i / 600, 0.5)).bob;
    const b = R.playerAnim(fake((i + 1) / 600, 0.5)).bob;
    maxFine = Math.max(maxFine, Math.abs(b - a));
  }
  console.log('    曲线最大单步变化（1/600 秒步长）' + maxFine.toFixed(4) + 'px');
  ok(maxFine < 0.02, '律动曲线连续（无跳变点）', maxFine.toFixed(4) + 'px');

  // b) 呼吸确实存在：待机时 bob 有幅度、身体有挤压
  let bobMin = Infinity, bobMax = -Infinity, syMin = Infinity, syMax = -Infinity, armMin = Infinity, armMax = -Infinity;
  for (let i = 0; i < 600; i++) {
    const a = R.playerAnim(fake(i / 60, 0));   // 待机
    bobMin = Math.min(bobMin, a.bob); bobMax = Math.max(bobMax, a.bob);
    syMin = Math.min(syMin, a.sy); syMax = Math.max(syMax, a.sy);
    armMin = Math.min(armMin, a.armSwing); armMax = Math.max(armMax, a.armSwing);
  }
  console.log('    待机：bob ' + bobMin.toFixed(2) + '~' + bobMax.toFixed(2) +
    'px   纵向缩放 ' + syMin.toFixed(4) + '~' + syMax.toFixed(4) +
    '   摆臂 ' + armMin.toFixed(2) + '~' + armMax.toFixed(2));
  ok(bobMax - bobMin > 1.5, '待机有可见的上下呼吸幅度', (bobMax - bobMin).toFixed(2) + 'px');
  ok(syMax - syMin > 0.03, '待机有挤压拉伸（不只是平移）', (syMax - syMin).toFixed(4));
  ok(armMax - armMin > 0.2, '待机手臂有轻微摆动（旧实现恒为 0）', (armMax - armMin).toFixed(2));

  // c) 体积守恒：横向缩放与纵向缩放互为倒数
  let volErr = 0;
  for (let i = 0; i < 300; i++) {
    const a = R.playerAnim(fake(i / 60, 0));
    volErr = Math.max(volErr, Math.abs(a.sx * a.sy - 1));
  }
  ok(volErr < 1e-9, '呼吸形变保持体积（sx·sy≡1）', volErr);

  // d) 呼吸周期约 2.4 秒（过零点计数）
  let zeroCross = 0, prev = R.playerAnim(fake(0, 0)).bob;
  for (let i = 1; i < 60 * 10; i++) {
    const cur = R.playerAnim(fake(i / 60, 0)).bob;
    if ((prev < 0 && cur >= 0) || (prev > 0 && cur <= 0)) zeroCross++;
    prev = cur;
  }
  const period = (60 * 10 / 60) / (zeroCross / 2);
  console.log('    呼吸周期约 ' + period.toFixed(2) + ' 秒');
  ok(period > 1.5 && period < 3.5, '呼吸周期在合理区间（1.5~3.5 秒）', period.toFixed(2) + 's');

  // e) 走路时呼吸被步频覆盖：形变基本消失、摆臂幅度变大
  let wSy = [], wArm = [];
  for (let i = 0; i < 600; i++) {
    const a = R.playerAnim(fake(i / 60, 1));
    wSy.push(a.sy); wArm.push(a.armSwing);
  }
  const wSyRange = Math.max(...wSy) - Math.min(...wSy);
  const wArmRange = Math.max(...wArm) - Math.min(...wArm);
  ok(wSyRange < 0.002, '走路时不做呼吸形变（改由步频驱动）', wSyRange.toFixed(4));
  ok(wArmRange > 1.5, '走路时摆臂幅度明显更大', wArmRange.toFixed(2));

  // f) 松手不再突跳：模拟层混合 + 渲染层曲线
  // 先走 1 秒，再松手，记录逐帧 bob 变化
  Game.newRun('ranger', 99);
  const s9 = Game.getSession();
  holdRoom(s9); s9.enemies.length = 0; s9.player.invuln = 999;
  const seq = [];
  for (let i = 0; i < 200; i++) {
    const moving = i < 90;
    holdRoom(s9);
    Game.step(FIXED, moving ? { x: 1, y: 0 } : { x: 0, y: 0 });
    seq.push(R.playerAnim(s9.player));
  }
  let maxJump = 0, jumpAt = -1, maxArmJump = 0, armBigSteps = 0;
  for (let i = 1; i < seq.length; i++) {
    const d = Math.abs(seq[i].bob - seq[i - 1].bob);
    if (d > maxJump) { maxJump = d; jumpAt = i; }
    const da = Math.abs(seq[i].armSwing - seq[i - 1].armSwing);
    maxArmJump = Math.max(maxArmJump, da);
    if (i > 80 && i < 120 && da > 0.02) armBigSteps++;
  }
  const walkAvg = seq.slice(1, 90).reduce((a, x, i) => a + Math.abs(x.bob - seq[i].bob), 0) / 89;
  console.log('    走动中每帧 bob 变化均值 ' + walkAvg.toFixed(3) +
    'px   最大单帧 ' + maxJump.toFixed(3) + 'px（第 ' + jumpAt + ' 帧，松手在第 90 帧）');
  ok(maxJump < walkAvg * 2.5, '松手不产生突跳（最大单帧变化接近正常步进）',
    maxJump.toFixed(3) + 'px vs 均值 ' + walkAvg.toFixed(3) + 'px');

  // 手臂：过渡应摊到多帧，而不是一帧硬切
  // （旧实现松手那一帧从 -0.641 直接变成 0，即单帧跳变 0.641）
  console.log('    手臂过渡：最大单帧 ' + maxArmJump.toFixed(3) + '，摊到 ' + armBigSteps + ' 帧');
  ok(maxArmJump < 0.30 && armBigSteps >= 4,
    '手臂过渡摊到多帧（非一帧硬切，旧实现单帧跳 0.641）',
    '最大 ' + maxArmJump.toFixed(3) + ' / ' + armBigSteps + ' 帧');

  // g) 混合权重行为：单调趋近、约 0.13 秒完成
  ok(s9.player.moveBlend < 0.01, '停下后混合权重回落到 0', s9.player.moveBlend.toFixed(4));
  Game.step(FIXED, { x: 1, y: 0 });
  const b1 = s9.player.moveBlend;
  for (let i = 0; i < 8; i++) Game.step(FIXED, { x: 1, y: 0 });
  const b9 = s9.player.moveBlend;
  ok(b1 > 0 && b1 < b9 && b9 <= 1, '混合权重随时间单调上升', b1.toFixed(3) + ' → ' + b9.toFixed(3));
  for (let i = 0; i < 20; i++) Game.step(FIXED, { x: 1, y: 0 });
  ok(s9.player.moveBlend === 1, '持续移动后权重达到 1', s9.player.moveBlend);

  // h) 同一相位必然得到同一结果（确定性）
  const r1 = R.playerAnim(fake(3.7, 0.4));
  const r2 = R.playerAnim(fake(3.7, 0.4));
  ok(r1.bob === r2.bob && r1.sx === r2.sx && r1.armSwing === r2.armSwing, '同相位输出完全一致');

  // i) 相位不重置：走路与待机共用 animT，松手不会让相位回跳
  const tBefore = s9.player.animT;
  for (let i = 0; i < 30; i++) { holdRoom(s9); Game.step(FIXED, { x: 0, y: 0 }); }
  ok(s9.player.animT > tBefore, '相位持续推进（永不重置）', s9.player.animT.toFixed(2));
}

/* ---------------- 血迹贴花 ---------------- */
console.log('\n[9] 血迹贴花');
{
  Game.newRun('ranger', 555);
  const s10 = Game.getSession();
  s10.decals.length = 0; s10.decalSeq = 0; s10.decalCursor = 0;

  const cap = Game.cfg.decalCap;
  // a) 环形缓冲：写满后继续写，长度不增长、最旧的被覆盖
  for (let i = 0; i < cap + 40; i++) {
    Game._internals.addStain(100 + i, 200, 10, '#7c3b62');
  }
  ok(s10.decals.length === cap, '贴花数量不超过容量（环形缓冲）', s10.decals.length + '/' + cap);
  ok(s10.decalSeq === cap + 40, '序号持续递增（每次击杀都真的写入了）', s10.decalSeq);

  // b) 最新的血迹最不透明，最旧的接近 0（所以被覆盖时看不出跳变）
  let newest = null, oldest = null;
  for (const d of s10.decals) {
    if (!newest || d.seq > newest.seq) newest = d;
    if (!oldest || d.seq < oldest.seq) oldest = d;
  }
  const aNew = R.decalAlpha(newest, s10);
  const aOld = R.decalAlpha(oldest, s10);
  console.log('    透明度：最新 ' + aNew.toFixed(3) + '  最旧 ' + aOld.toFixed(3));
  ok(aNew > aOld, '越新的血迹越浓', aNew.toFixed(3) + ' > ' + aOld.toFixed(3));
  ok(aOld < 0.03, '最旧的血迹已淡到不可见（覆盖时无跳变）', aOld.toFixed(3));
  ok(aNew > 0.5 && aNew <= 0.56, '最新血迹保持满浓度', aNew.toFixed(3));

  // c) 淡到看不见的不参与绘制
  const s11 = Game.getSession();
  const before9 = drawCalls.count;
  R.draw(1 / 60);
  const withFull = drawCalls.count - before9;
  s11.decals.length = 3;               // 只留 3 条（都接近满浓度）
  s11.decalCursor = 0;
  const before10 = drawCalls.count;
  R.draw(1 / 60);
  const withThree = drawCalls.count - before10;
  ok(withFull > withThree, '褪色贴花被跳过绘制（数量越多开销越大但可跳过）',
    withFull + ' vs ' + withThree);

  // d) 形状有随机差异（不再是同一个圆簇）
  Game.newRun('ranger', 777);
  const s12 = Game.getSession();
  s12.decals.length = 0; s12.decalSeq = 0; s12.decalCursor = 0;
  /* 预热一帧：烘焙键是 (波次, **环境**)，换一局就换了环境，首帧必然重烘焙。
     下面 e) 比的是"20 条屏幕外血迹"与"0 条"的绘制量之差 ——
     不预热的话，"20 条"那一帧会把整层烘焙的开销（几万次 fillRect）算进去。 */
  R.draw(1 / 60);
  for (let i = 0; i < 6; i++) Game._internals.addStain(300 + i * 20, 400, 12, '#7c3b62');
  const shapes = new Set(s12.decals.map(d => [d.a1.toFixed(3), d.a2.toFixed(3), d.d1.toFixed(3), d.s1.toFixed(3)].join('|')));
  ok(shapes.size === s12.decals.length, '每个血迹形状都不同', shapes.size + '/' + s12.decals.length);

  // e) 贴花必须落在屏幕外的剔除逻辑内（不整场乱画）
  s12.decals.length = 0; s12.decalSeq = 0;
  for (let i = 0; i < 20; i++) Game._internals.addStain(-9999, -9999, 12, '#7c3b62');
  const before11 = drawCalls.count;
  R.draw(1 / 60);
  const offscreen = drawCalls.count - before11;
  s12.decals.length = 0; s12.decalSeq = 0;
  const before12 = drawCalls.count;
  R.draw(1 / 60);
  const none = drawCalls.count - before12;
  ok(offscreen === none, '视野外的血迹不绘制', offscreen + ' vs ' + none);
}

/* ---------------- 边界：空会话 / 极端窗口 ---------------- */
console.log('\n[5] 边界情况');
let edgeErr = null;
try {
  // 记录无会话时调用 draw 不应崩溃
  const savedState = Game.state;
  Game.setState('title', true);
  R.drawIdle(1 / 60);
  // 极小与极大视口
  g.innerWidth = 320; g.innerHeight = 240; R.resize(); R.draw(1 / 60);
  g.innerWidth = 3840; g.innerHeight = 2160; R.resize(); R.draw(1 / 60);
  g.innerWidth = 1280; g.innerHeight = 720; R.resize();
  Game.setState(savedState, true);
} catch (e) {
  edgeErr = e.message;
}
ok(!edgeErr, '极端视口与标题背景绘制安全', edgeErr);

// 玩家贴边时的摄像机钳制
let camErr = null;
try {
  sess.player.x = 5; sess.player.y = 5;
  R.draw(1 / 60);
  sess.player.x = Arena.W - 5; sess.player.y = Arena.H - 5;
  R.draw(1 / 60);
  if (!isFinite(R.cam.x) || !isFinite(R.cam.y)) camErr = '摄像机坐标 NaN';
} catch (e) { camErr = e.message; }
ok(!camErr, '玩家贴地图边界时摄像机钳制正常', camErr);

console.log('\n=== 结果 ===');
if (failures === 0) { console.log('\x1b[32m全部通过 ✔\x1b[0m\n'); process.exit(0); }
console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m\n');
process.exit(1);
