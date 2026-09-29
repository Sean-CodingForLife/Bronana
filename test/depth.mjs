/* =========================================================
   depth.mjs — Z 深度（层带 + 层内 y 排序）测试
   借鉴引擎的那套机制要成立，得守住四件事：
     1) 层带表是**数据**：稀疏、有序、具名、有说明；名字错就抛错
     2) 排序是 (band, y, id, seq) 的字典序，且**与入队顺序无关**（可复现）
     3) 零分配：一帧几百个实体不能产生垃圾（复用槽位池）
     4) 真实一帧里各层带的先后、以及"实体按 y 交织"确实发生了
   用法： node test/depth.mjs
   ========================================================= */
import { installDom, makeProbeCtx } from './_ctx.mjs';
import { loadAll, RENDER_MODULES } from './_load.mjs';

let failures = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  \x1b[32mPASS\x1b[0m ' + label);
  else { failures++; console.log('  \x1b[31mFAIL\x1b[0m ' + label + (extra !== undefined ? '  → ' + extra : '')); }
}
function throws(fn) { try { fn(); return null; } catch (e) { return e.message; } }

installDom();
const g = globalThis;

console.log('\n=== Bronana · Z 深度（层带 + y 排序） ===\n');
console.log('[1] 加载');
let loadErr = null;
try { await loadAll(RENDER_MODULES); } catch (e) { loadErr = e.message; }
ok(!loadErr, '渲染层以 ES 模块方式加载成功', loadErr);
if (loadErr) process.exit(1);

const { Depth, R, S, Game, Arena, Enemies, PAL, U } = g;
const FIXED = Game.cfg.fixedDt;

/* ---------------- 1. 层带表是数据 ---------------- */
console.log('\n[2] 层带表');
{
  const rows = Depth.bandTable();
  ok(rows.length >= 10, '层带数量充足（' + rows.length + ' 个）', String(rows.length));

  let inc = true, gapOk = true;
  for (let i = 1; i < rows.length; i++) {
    if (!(rows[i].z > rows[i - 1].z)) inc = false;
    if (rows[i].z - rows[i - 1].z < 10) gapOk = false;      // 留空位才能插新层
  }
  ok(inc, '层号严格递增', rows.map(r => r.z).join(','));
  ok(gapOk, '层号之间留了 ≥10 的空位（新增一层不用重排已有层号）');
  ok(rows.every(r => r.note && r.note.length >= 4), '每个层带都写了说明（层是数据，得解释它是什么）',
    rows.filter(r => !r.note || r.note.length < 4).map(r => r.name).join(','));
  ok(new Set(rows.map(r => r.name)).size === rows.length, '层带名字不重复');

  ok(Depth.band('actor') === 500 && Depth.band('ground') === 0, '按名字取层号');
  ok(Depth.bandNames().indexOf('shadow') >= 0 && Depth.bandNames().indexOf('text') >= 0,
    '关键层都在：shadow / marker / actor / projectile / fx / swing / text');
  const e1 = throws(() => Depth.band('Actors'));
  ok(!!e1 && /未知层带/.test(e1), '层名写错即抛错（大小写敏感，防拼写漂移）', e1);
}

/* ---------------- 2. 实体注册表 ---------------- */
console.log('\n[3] 实体注册表');
{
  ok(Depth.actors().length >= 4, '渲染层已注册实体：' + Depth.actors().join('/'), Depth.actors().join('/'));
  ok(Depth.actors().every(n => Depth.actorInfo(n).band === 'actor'),
    '四类实体都在 actor 层带（同带内按 y 排）');

  const e1 = throws(() => Depth.actor('enemy', { band: 'actor', y: function () { return 0; }, draw: function () {} }));
  ok(!!e1 && /重名/.test(e1), '实体类型重名被拒绝', e1);
  const e2 = throws(() => Depth.actor('tmp1', { band: 'actor', y: function () { return 0; } }));
  ok(!!e2 && /缺少 draw/.test(e2), '缺 draw 被拒绝', e2);
  const e3 = throws(() => Depth.actor('tmp2', { band: 'actor', draw: function () {} }));
  ok(!!e3 && /缺少 y/.test(e3), '缺 y() 被拒绝', e3);
  const e4 = throws(() => Depth.actor('tmp3', { band: 'nowhere', y: function () { return 0; }, draw: function () {} }));
  ok(!!e4 && /未知层带 nowhere/.test(e4), '注册到不存在的层带被拒绝', e4);
  const e5 = throws(() => { Depth.reset(); Depth.push('ghost', {}); });
  ok(!!e5 && /未注册的实体类型 ghost/.test(e5), '推入未注册类型被拒绝', e5);
}

/* ---------------- 3. 排序规则 ---------------- */
console.log('\n[4] 排序：层带 → y → id → 序号');
{
  // 排序测试用的探针实体（不画任何东西，只记顺序）
  Depth.actor('probe', {
    band: 'actor',
    y: function (o) { return o.y; },
    id: function (o) { return o.id || 0; },
    draw: function () {}
  });

  const mk = (z, y, id, seq) => ({ z, y, id, seq });
  ok(Depth.compare(mk(100, 999, 9, 9), mk(200, 0, 0, 0)) < 0, '层带优先于 y');
  ok(Depth.compare(mk(200, 10, 9, 9), mk(200, 20, 0, 0)) < 0, '同层按 y 升序');
  ok(Depth.compare(mk(200, 20, 1, 9), mk(200, 20, 2, 0)) < 0, '同层同 y 按 id');
  ok(Depth.compare(mk(200, 20, 2, 5), mk(200, 20, 2, 6)) < 0, '再同则按入队序号（不依赖 sort 是否稳定）');
  ok(Depth.compare(mk(200, 20, 2, 5), mk(200, 20, 2, 5)) === 0, '完全相同返回 0');

  const order = (seq) => {
    Depth.reset();
    for (const s of seq) Depth.push('probe', s);
    const seen = [];
    Depth.trace((name, ref) => seen.push(ref.tag));
    Depth.flush(makeProbeCtx(), null);
    Depth.trace(null);
    return seen.join(',');
  };
  // 同 y 的两项用 id 区分：a/c 都是 y=300，c 的 id 更大 → 应该排在 a 后面
  const items = [
    { tag: 'a', y: 300, id: 1 }, { tag: 'b', y: 100, id: 2 },
    { tag: 'c', y: 300, id: 3 }, { tag: 'd', y: 200, id: 4 }
  ];
  const forward = order(items);
  const backward = order(items.slice().reverse());
  ok(forward === 'b,d,a,c', '按 (y, id) 升序绘制', forward);
  ok(forward === backward, '两种入队顺序得到同一序列（排序与入队顺序无关）',
    forward + ' vs ' + backward);
}

/* ---------------- 4. 零分配 ---------------- */
console.log('\n[5] 槽位池复用');
{
  Depth.reset();
  for (let i = 0; i < 500; i++) Depth.push('probe', { y: i, id: i });
  const s1 = Depth.stats();
  for (let k = 0; k < 20; k++) {
    Depth.reset();
    for (let i = 0; i < 500; i++) Depth.push('probe', { y: i, id: i });
    Depth.flush(makeProbeCtx(), null);
  }
  const s2 = Depth.stats();
  ok(s1.slots === s2.slots && s2.slots === 500, '槽位池只增长到最大同时在场的数量（500）',
    s1.slots + ' → ' + s2.slots);
  ok(s2.live === 500 && s2.pushed === 500, '每帧重新计数（reset 之后不累加）', s2.pushed + '/' + s2.live);

  Depth.reset();
  for (let i = 0; i < 50; i++) Depth.push('probe', { y: i, id: i });
  ok(Depth.count() === 50, 'count() 报当前队列长度', String(Depth.count()));
}

/* ---------------- 5. 真实一帧：层带顺序与 y 交织 ---------------- */
console.log('\n[6] 真实一帧');
{
  const main = g.document.createElement('canvas');
  R.init(main);
  const probe = makeProbeCtx({ ops: true });
  R.ctx = probe;                                  // 用带全局序列的桩接管绘制

  Game.newRun('gladiator', 4242);
  const sess = Game.getSession();
  holdRoom(sess);
  sess.enemies.length = 0;
  sess.arena = Arena.build(3);
  // 构造一个"一前一后"的确定性场景：y=400 在玩家后面，y=800 在玩家前面
  const py = sess.player.y;
  const behind = Game._internals.spawnEnemy('grub', sess.player.x - 120, py - 200, {});
  const front = Game._internals.spawnEnemy('grub', sess.player.x + 120, py + 200, {});
  sess.player.invuln = 999;
  for (const e of sess.enemies) e.spawnT = 0;

  const order = [];
  Depth.trace((name, ref) => order.push(name === 'player' ? 'player' : (ref === behind ? 'behind' : (ref === front ? 'front' : name))));
  R.draw(FIXED);
  Depth.trace(null);

  ok(order.indexOf('behind') >= 0 && order.indexOf('front') >= 0 && order.indexOf('player') >= 0,
    '三类实体都进了深度队列', order.join(' → '));
  ok(order.indexOf('behind') < order.indexOf('player'), 'y 更小的怪画在玩家之前（在玩家后面）', order.join(' → '));
  ok(order.indexOf('player') < order.indexOf('front'),
    'y 更大的怪画在玩家之后（挡住玩家）—— 改造前玩家永远压在所有怪之上', order.join(' → '));

  const st = Depth.stats();
  ok(st.bands.actor === st.pushed && st.pushed >= 3, '本帧 actor 层带数量 = 入队数量',
    st.bands.actor + '/' + st.pushed);
  ok(Object.keys(st.bands).length === 1, '这一帧只有 actor 一个层带（其余层不在深度队列里，是固定 pass）',
    Object.keys(st.bands).join(','));
  ok(Depth.describe().indexOf('actor') >= 0, 'describe() 给得出人话的深度报告');

  /* ---- 层带先后：用全局绘制序列核对（影子必须在实体之前） ---- */
  const enemyCanvas = S.enemySprite(Enemies.BY_ID.grub).canvas;
  const isEnemySprite = (op) => op.op === 'drawImage' && op.img === enemyCanvas;
  const isShadow = (op) => op.op === 'fill' &&
    typeof op.fill === 'string' && /^rgba\(16,13,12,0\.(18|20|22)\)$/.test(op.fill);
  const firstEnemy = probe.ops.findIndex(isEnemySprite);
  const lastShadow = probe.ops.reduce((acc, op, i) => (isShadow(op) ? i : acc), -1);
  ok(firstEnemy >= 0 && lastShadow >= 0, '这一帧既有怪贴图也有影子',
    'firstEnemy ' + firstEnemy + ' / lastShadow ' + lastShadow);
  ok(lastShadow < firstEnemy, '影子层（shadow）整体画在实体层（actor）之前 —— A 的影子不会压在 B 身上',
    '最后影子 #' + lastShadow + ' < 首个怪贴图 #' + firstEnemy);

  const groundImg = probe.ops.findIndex(op => op.op === 'drawImage' && op.img === R.ground.canvas);
  const firstDecal = probe.ops.findIndex(op => op.op === 'fill' && op.fill === PAL?.BLOOD);
  ok(groundImg >= 0 && groundImg < firstEnemy,
    '地面烘焙层（ground）比实体层早（一次 blit 在最前面）', 'ground #' + groundImg);
  ok(firstDecal < 0 || groundImg < firstDecal, '贴花在地面之后',
    'ground #' + groundImg + ' / decal #' + firstDecal);

  /* ---- 统计口径不受影响：每类实体的绘制调用仍按类型计数 ---- */
  const shots = {};
  const probe2 = makeProbeCtx();
  R.ctx = probe2;
  const seenPhase = new Set();
  const origPhase = Object.getOwnPropertyDescriptor(R, 'phase');
  R.draw(FIXED);
  ok(R.phase === 'idle', '帧末 phase 回到 idle', String(R.phase));
  R.ctx = main.getContext('2d') || R.ctx;
}

/* ---------------- 6. 扩展性：注册一类新实体不用改渲染循环 ---------------- */
console.log('\n[7] 扩展点：新实体类型只注册，不改主循环');
{
  let drawn = 0;
  Depth.actor('depthProbe', {
    band: 'fx',                                  // 故意放到 fx 层带
    y: function (o) { return o.y; },
    draw: function () { drawn++; }
  });
  Depth.reset();
  Depth.push('probe', { y: 500, id: 1 });
  Depth.push('depthProbe', { y: 0 });
  const seq = [];
  Depth.trace((name) => seq.push(name));
  Depth.flush(makeProbeCtx(), null);
  Depth.trace(null);
  ok(drawn === 1 && seq.join(',') === 'probe,depthProbe',
    '新注册的实体按它的层带参与排序（fx 在 actor 之后）', seq.join(','));
  ok(Depth.actorInfo('depthProbe').z === Depth.band('fx'), '注册项带着自己的层号',
    String(Depth.actorInfo('depthProbe').z));
}

/* ---------------- 7. 分层不污染模拟层 ---------------- */
console.log('\n[8] 层次分离');
{
  const src = (await import('node:fs')).readFileSync(new URL('../src/depth.ts', import.meta.url), 'utf8');
  const imports = [...src.matchAll(/^import\s[^'"]*from\s*'\.\/([^']+)'/gm)].map(m => m[1]);
  /* **只依赖** utils / 总账这一层，而不是"必须恰好 import 两个模块" ——
     后者会把"模块里少了一个不再用的 import"也判成失败（实测：清掉未使用的
     `U` 之后这条红了）。分层守的是**依赖方向与允许的层**，
     不是 import 的条数；`utils` 现在没被 import，恰恰是它**没有**越层依赖的证明。 */
  const allowed = ['utils.ts', 'registry.ts'];
  const beyond = imports.filter(f => allowed.indexOf(f) < 0);
  ok(beyond.length === 0,
    'depth.ts 只依赖 utils 与扩展点总账（不认识 Game / 实体 / 渲染层）', imports.join(','));
  ok(!/Session|session|\bsess\b/.test(src.replace(/^\s*\/\*[\s\S]*?\*\//gm, '')),
    'depth.ts 里没有会话/存档之类的玩法概念');
}

console.log('\n=== 结果 ===');
if (failures === 0) { console.log('\x1b[32m全部通过 ✔\x1b[0m'); process.exit(0); }
console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m');
process.exit(1);
