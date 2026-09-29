/* =========================================================
   comp.mjs — 组件式组合测试
   改造前每种对象都是手写对象字面量，字段散在各处；"用到才挂上去"的字段
   （w.dup / e._spr / d = {} 后逐字段赋值）会让同类型对象在运行期长出
   不同的形状。这套测试守住四件事：
     1) 组件 / 原型 / 系统的注册与校验（重名、缺组件、字段冲突都要抛错）
     2) 造出来的对象字段齐全、形状一致、数组默认值不共享
     3) 写一个原型没有的字段必须抛错（这是"漏声明组件"的主要入口）
     4) 打一场真实对局，场上每个对象都不得有游离字段
   用法： node test/comp.mjs
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
function throws(fn) {
  try { fn(); return null; } catch (e) { return e.message; }
}

await loadAll(SIM_MODULES);
const { Comp, Game, Weapons, Items, Dungeon } = globalThis;
const FIXED = Game.cfg.fixedDt;

console.log('\n=== Bronana · 组件式组合测试 ===\n');

/* ---------------- 1. 注册表 ---------------- */
console.log('[1] 组件 / 原型 / 系统注册表');
{
  const st = Comp.stats();
  console.log('    ' + st.components + ' 个组件 · ' + st.archetypes + ' 个原型 · ' + st.systems + ' 个系统');
  ok(st.components >= 25, '组件目录已建立', st.components);
  ok(st.archetypes >= 10, '原型目录已建立', st.archetypes);

  const archs = Comp.archetypes();
  const need = ['player', 'enemy', 'bullet', 'ebullet', 'particle', 'pickup', 'decal', 'turret', 'weapon', 'item'];
  const missing = need.filter(a => !Comp.hasArchetype(a));
  ok(missing.length === 0, '全部 ' + need.length + ' 种游戏对象都有原型', missing.join(', '));

  // 实体类原型必须真的是"组合"；纯记录型原型（item/offer）只要求 ≥1
  const entityArchs = ['player', 'enemy', 'bullet', 'ebullet', 'particle', 'pickup', 'decal', 'turret', 'weapon'];
  const thin = entityArchs.filter(a => Comp.archetypeInfo(a).comps.length < 3);
  ok(thin.length === 0, '实体原型都由 ≥3 个组件组合而成', thin.join(', '));
  const none = archs.filter(a => Comp.archetypeInfo(a).comps.length < 1);
  ok(none.length === 0, '每个原型至少由 1 个组件构成', none.join(', '));

  // 原型字段 = 其组件字段的并集，一个不多一个不少
  let unionErr = [];
  for (const a of archs) {
    const info = Comp.archetypeInfo(a);
    const union = new Set();
    info.comps.forEach(c => Comp.componentKeys(c).forEach(k => union.add(k)));
    if (union.size !== info.fields.length) unionErr.push(a + ' 字段数不符');
    info.fields.forEach(f => { if (!union.has(f)) unionErr.push(a + '.' + f + ' 不属于任何组件'); });
  }
  ok(unionErr.length === 0, '每个原型的字段恰好等于其组件字段的并集', unionErr.slice(0, 3).join(' | '));
}

/* ---------------- 2. 定义期校验 ---------------- */
console.log('\n[2] 定义期校验（错误必须在注册时就炸，而不是跑起来才炸）');
{
  const e1 = throws(() => Comp.define('Transform', { x: 0 }));
  ok(!!e1 && /重名/.test(e1), '组件重名被拒绝', e1);

  const e2 = throws(() => Comp.define('BadObj', { o: {} }));
  ok(!!e2 && /默认值/.test(e2), '对象类型的默认值被拒绝（会隐式共享可变状态）', e2);

  const e3 = throws(() => Comp.define('BadEmpty', {}));
  ok(!!e3, '空组件被拒绝', e3);

  const e4 = throws(() => Comp.archetype('bad1', ['Transform', 'NoSuchComp']));
  ok(!!e4 && /未定义/.test(e4), '引用未定义组件被拒绝', e4);

  // 字段冲突：A 与 B 都声明 hp
  Comp.define('ClashA', { hp: 1 });
  Comp.define('ClashB', { hp: 2 });
  const e5 = throws(() => Comp.archetype('bad2', ['ClashA', 'ClashB']));
  ok(!!e5 && /同时声明/.test(e5), '两个组件声明同一字段被拒绝', e5);

  const e6 = throws(() => Comp.archetype('enemy', ['Transform']));
  ok(!!e6 && /重名/.test(e6), '原型重名被拒绝', e6);
}

/* ---------------- 3. 造对象 ---------------- */
console.log('\n[3] 造对象：字段齐全、形状一致、默认值独立');
{
  const e7 = throws(() => Comp.spawn('NoSuchArch'));
  ok(!!e7 && /未注册/.test(e7), '未注册的原型无法 spawn', e7);

  const problems = Comp.selfCheck();
  ok(problems.ok && problems.problems.length === 0, '全部原型自查通过（字段不多不少）', problems.problems.slice(0, 3).join(' | '));

  // 形状一致：同原型所有对象的键顺序必须完全一致（V8 隐藏类稳定的前提）
  let shapeErr = [];
  for (const a of Comp.archetypes()) {
    const k1 = Object.keys(Comp.spawn(a)).join(',');
    const k2 = Object.keys(Comp.spawn(a)).join(',');
    if (k1 !== k2) shapeErr.push(a);
  }
  ok(shapeErr.length === 0, '同原型对象的键顺序完全一致（形状不分叉）', shapeErr.join(', '));

  // 数组默认值必须按对象复制
  const w1 = Comp.spawn('player'), w2 = Comp.spawn('player');
  w1.weapons.push('x');
  ok(w2.weapons.length === 0, '数组默认值不被两个对象共享', w2.weapons.length);

  // 内联字面量的边角：工厂把原始值直接写进生成源码，写错只会在这里暴露。
  // -0 / NaN / ±Infinity / 1e21 / 5e-324 这些必须原样保住（写不出来的回落到读模板）。
  Comp.define('EdgeLit', {
    zero: -0, nan: NaN, inf: Infinity, ninf: -Infinity,
    big: 1e21, tiny: 5e-324, minus: -1.5,
    quote: 'a"b\\c\nd', uni: '豆豆\n\t', empty: '', bool: true, off: false, nul: null
  });
  Comp.define('EdgeArr', { arr: [1, 'x', null], deep: [] });
  const edge = Comp.archetype('edge', ['EdgeLit', 'EdgeArr']);
  const e1 = edge.make(), e2 = edge.make();
  const edgeBad = edge.fields.filter((f) => {
    const tv = edge.template[f], ev = e1[f];
    if (Array.isArray(tv)) return !Array.isArray(ev) || ev.length !== tv.length || tv.some((x, i) => !Object.is(x, ev[i]));
    return !Object.is(tv, ev);
  });
  ok(edgeBad.length === 0, '内联进生成源码的默认值与模板逐字段一致（-0/NaN/Infinity/转义）', edgeBad.join(', '));
  ok(e1.arr !== e2.arr, '数组字段即使只有一个元素也每个对象独立', String(e1.arr === e2.arr));
  ok(Object.is(e1.zero, -0), '-0 没有被写成 0', String(e1.zero));
  ok(Number.isNaN(e1.nan) && e1.inf === Infinity && e1.ninf === -Infinity, '非有限数按原样保住', String(e1.inf));

  const problems2 = Comp.selfCheck();
  ok(problems2.ok && problems2.problems.length === 0, '把边角原型也算进去后自查仍全绿（默认值逐字段比对）', problems2.problems.slice(0, 3).join(' | '));

  // assign 校验：写未声明字段必须抛错
  const e = Comp.spawn('enemy');
  Comp.assign(e, { x: 5 });
  ok(e.x === 5, 'assign 可写已声明字段');
  const e8 = throws(() => Comp.assign(e, { hp: 1, nope: 2 }));
  ok(!!e8 && /没有字段 nope/.test(e8), 'assign 写未声明字段被拒绝（漏声明组件的入口）', e8);
  // 部分成功是可接受的，但必须报错，不能静默
  ok(e.hp === 1, '报错前已写的字段仍然生效（失败是拒绝而非回滚，行为可预期）', e.hp);

  const e9 = throws(() => Comp.assign({}, { x: 1 }));
  ok(!!e9, 'assign 到非组合对象被拒绝', e9);
}

/* ---------------- 4. 审计 ---------------- */
console.log('\n[4] 审计：游离字段检测');
{
  const e = Comp.spawn('bullet');
  ok(Comp.unknownFields(e).length === 0, '新造的对象没有游离字段');
  e.hacked = 1;
  const bad = Comp.unknownFields(e);
  ok(bad.length === 1 && bad[0] === 'hacked', '手工挂上去的字段会被审计抓出来', bad.join(', '));
  ok(Comp.unknownFields({ x: 1 }) === null, '普通对象（非组合）返回 null，便于区分');
  ok(Comp.archOf(e) === 'bullet', 'archOf 认得自己的原型', Comp.archOf(e));
  ok(Comp.has(e, 'Pierce') && !Comp.has(e, 'Health'), 'has 按组件判断', '');
}

/* ---------------- 5. 查询与系统 ---------------- */
console.log('\n[5] 查询与系统');
{
  Game.newRun('ranger', 4242);
  const sess = Game.getSession();
  const q = Comp.query(sess, 'enemy');
  ok(q === sess.enemies, 'query 返回会话里对应的集合');
  const e10 = throws(() => Comp.query(sess, 'player'));
  ok(!!e10 && /没声明集合/.test(e10), '没声明集合的原型无法 query', e10);

  const e11 = throws(() => Comp.system('badSys', ['NoSuchComp'], () => {}));
  ok(!!e11 && /未定义的组件/.test(e11), '系统依赖未定义组件被拒绝', e11);

  // 声明了组件但集合里是别的原型 → 必须在首次运行时抛错
  Comp.system('needsHealth', ['Health'], () => {});
  const e12 = throws(() => Comp.run('needsHealth', [Comp.spawn('bullet')], 1 / 60, {}));
  ok(!!e12 && /不在原型/.test(e12), '系统声明的组件不在集合原型上 → 抛错（声明被真正校验）', e12);

  // 倒序 + 交换删除：粒子步进必须不跳元素
  Comp.system('countAll', ['Lifetime'], () => {});
  const list = [];
  for (let i = 0; i < 5; i++) list.push(Comp.spawn('particle'));
  let seen = 0;
  Comp.system('countBack', ['Lifetime'], (p, dt, ctx) => { seen++; ctx.i = ctx.i; }, { back: true });
  Comp.run('countBack', list, 1 / 60, {});
  ok(seen === 5, '倒序系统遍历到全部元素', seen);
}

/* ---------------- 6. 真实对局：场上不得有游离字段 ---------------- */
console.log('\n[6] 真实对局审计（跑满一场，逐个对象查字段）');
{
  Game.newRun('gladiator', 909);
  /* 波次给高一点：房间制之后成长曲线按 `Enemies.equivWave` 摊开了
     （第 N 间 ≈ 旧第 1+(N-1)×0.55 波），同一波号的怪比改造前少，
     场上对象数会掉到 200 以下 —— 这条断言要的是"足够多的样本"，那就把波次抬上去。
     抬到 30 是因为后来加了联动与道具套装：玩家更强 → 同屏存活更少。 */
  enterFightRoom(); Game._internals.startWave(30);
  const s = Game.getSession();
  s.player.weapons.length = 0;
  ['minigun', 'sword', 'shotgun', 'flame', 'laser', 'hammer'].forEach(id => Game.addWeapon(id));
  Items.LIST.slice(0, 6).forEach(it => s.player.items.push(Comp.spawn('item', { def: it })));
  Game.recalcStats();

  let runErr = null;
  try {
    for (let i = 0; i < 1500; i++) {
      if (Game.state === 'playing') { s.player.invuln = 999; holdRoom(s); Game.step(FIXED, Game.autoInput(i / 60)); }
      else if (Game.state === 'levelup') Game.chooseLevelCard(0);
      else if (Game.state === 'shop') Game.nextWave();
      else break;
    }
  } catch (e) { runErr = e.message + ' @ ' + (e.stack.split('\n')[1] || '').trim(); }
  ok(!runErr, '1500 帧实战无异常', runErr);

  // 这些集合里的对象必须全部由原型产出
  const collections = {
    player: [s.player],
    weapons: s.player.weapons,
    items: s.player.items,
    enemies: s.enemies,
    bullets: s.bullets,
    ebullets: s.ebullets,
    particles: s.particles,
    textParticles: s.textParticles,
    pickups: s.pickups,
    decals: s.decals,
    turrets: s.turrets
  };
  let notComposed = [], driftErrors = [], checked = 0;
  const seenShapes = {};
  for (const name in collections) {
    const list = collections[name];
    for (const obj of list) {
      checked++;
      const arch = Comp.archOf(obj);
      if (!arch) { notComposed.push(name); continue; }
      const r = Comp.audit(obj);
      if (r.unknown.length) driftErrors.push(name + '.' + arch + ' 游离字段 ' + r.unknown.join(','));
      if (r.missing.length) driftErrors.push(name + '.' + arch + ' 缺字段 ' + r.missing.join(','));
      // 运行期形状一致性：同原型对象的键顺序必须和模板一致
      const shape = Object.keys(obj).join(',');
      if (seenShapes[arch] === undefined) seenShapes[arch] = shape;
      else if (seenShapes[arch] !== shape) driftErrors.push(name + '.' + arch + ' 形状与同原型其它对象不一致');
    }
  }
  console.log('    审计了 ' + checked + ' 个场上的对象，覆盖原型：' + Object.keys(seenShapes).join(', '));
  ok(notComposed.length === 0, '场上每个对象都由组件组合而成', notComposed.slice(0, 5).join(', '));
  ok(driftErrors.length === 0, '没有游离字段、没有缺字段、同类对象形状一致', driftErrors.slice(0, 3).join(' | '));
  ok(checked > 200, '审计样本量足够（场上对象数）', checked);

  // 明确记录边界：这几个是"共享定义 / 每波一次的记录"，不是每帧实体
  const plainRecords = ['levelCards（引用 UPGRADE_POOL 里的共享词条定义）',
    'spawnQueue（Enemies.buildWave 产出的刷怪表）',
    'events 载荷与 RunSummary（跨层传值的数据包）'];
  console.log('    刻意未做成原型的：' + plainRecords.join(' · '));
}

/* ---------------- 7. 开销 ---------------- */
console.log('\n[7] 开销：组合造对象 vs 手写字面量');
{
  const N = 200000;
  let sink = 0;
  // 造出来的对象必须"逃逸"到循环外，否则 V8 会做标量替换 + 常量折叠，
  // 把手写字面量那一侧优化成 1.1ns/个（实测：不逃逸时就是 1.1ns，纯属测了个空）。
  // 两侧写法必须对称，只让参照物更有利就是把比值做假。
  let live = null;

  // 取三次最小值：这台机器上偶发一次 486ns 的离群值（其余 318/364/318），
  // 断言不该由别的进程抢 CPU 决定。三次全量测量，报告全部。
  function bestOf(reps, fn) {
    const all = [];
    for (let k = 0; k < reps; k++) {
      const t = process.hrtime.bigint();
      sink += fn();
      all.push(Number(process.hrtime.bigint() - t) / N);
    }
    return { best: Math.min.apply(null, all), all: all };
  }

  const lit = bestOf(3, function () {
    let acc = 0;
    for (let i = 0; i < N; i++) {
      const o = { x: 1, y: 2, vx: 3, vy: 4, r: 5, dmg: 6, pierce: 0, hitSet: null, life: 1, lifeMax: 1, color: '', dark: '', kind: '', tintA: '', element: '', knock: 0, blast: 0, crit: false, bigCrit: false, fromX: 0, fromY: 0, px: 3, py: 4 };
      live = o;
      acc += o.x;
    }
    return acc + live.vx;
  });

  const sp = bestOf(3, function () {
    let acc = 0;
    for (let i = 0; i < N; i++) {
      const o = Comp.spawn('bullet');
      live = o;
      acc += o.x;
    }
    return acc + live.vx;
  });

  const fmt = function (a) { return a.map(function (n) { return n.toFixed(1); }).join(' / '); };
  console.log('    字面量 三次 ' + fmt(lit.all) + ' ns  → 最小 ' + lit.best.toFixed(1) + ' ns/个');
  console.log('    spawn  三次 ' + fmt(sp.all) + ' ns  → 最小 ' + sp.best.toFixed(1) + ' ns/个');
  console.log('    最小比值 ' + (sp.best / lit.best).toFixed(2) + '×   （sink ' + sink + '）');
  // 宽上限：这里只防"病态慢"，具体比值只报告不断言
  ok(sp.best < 400, '组合造对象的单次开销在合理量级（<400ns，取三次最小值）', sp.best.toFixed(1) + 'ns');
  ok(lit.best > 5, '参照组测到的是真的在分配对象（>5ns，没被 V8 折叠掉）', lit.best.toFixed(1) + 'ns');
  ok(sp.best / lit.best < 10, '代码生成构造函数的开销倍率没有失控（<10×）', (sp.best / lit.best).toFixed(2) + '×');
  console.log('    注：spawn 走的是按原型"代码生成"出来的构造函数，值已经内联进源码，');
  console.log('        生成的函数体就是一句对象字面量 —— 剩下的倍率是 Comp.spawn 自己的');
  console.log('        查表与判断（未注册原型 / 覆盖值 / seedPrev / 钩子）。');
}

console.log('\n[8] 容器审计：容器里的每个对象都必须由组件组合而成');
{
  /* `?test=demo` 那条开发路径以前直接手写对象字面量 push 进容器
     （贴花少了 7 个形状字段 → 渲染时 14 次 NaN 参数），而且它藏在入口文件里、
     测试够不到。舞台搭建已搬到 demo.ts，这里把它的产物逐个过一遍。 */
  // levelCards 不在这里：它是刻意的例外（直接引用 UPGRADE_POOL 里的共享词条定义，
  // 见 [6] 打印的边界说明），不是每帧实体，所以不进组合审计。
  const CONTAINERS = ['enemies', 'bullets', 'ebullets', 'pickups', 'decals',
    'turrets', 'particles', 'textParticles', 'offers'];

  function auditWorld(sess, label) {
    const bad = [];
    let n = 0;
    for (const key of CONTAINERS) {
      const list = sess[key];
      if (!list || !list.length) continue;
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        n++;
        if (!Comp.archOf(o)) { bad.push(label + '.' + key + '[' + i + '] 不是组合对象（手写字面量？）'); continue; }
        const a = Comp.audit(o);
        if (a.missing.length) bad.push(label + '.' + key + '[' + i + '] 缺字段 ' + a.missing.join(','));
        if (a.unknown.length) bad.push(label + '.' + key + '[' + i + '] 游离字段 ' + a.unknown.join(','));
      }
    }
    for (const o of [sess.player].concat(sess.player.weapons, sess.player.items)) {
      n++;
      if (!Comp.archOf(o)) bad.push(label + '.player 侧不是组合对象');
    }
    return { bad, n };
  }

  const dev = globalThis.Demo;
  ok(!!dev && typeof dev.stage === 'function', '开发场景搭建已从 main.ts 抽到 demo.ts（可被测试覆盖）');

  // 真实对局（自己跑一段，不复用上一节的局部变量）
  const live = Game.newRun('gladiator', 4242);
  for (let i = 0; i < 900; i++) {
    if (Game.state === 'playing') Game.step(FIXED, Game.autoInput(i / 60));
    else if (Game.state === 'levelup') Game.chooseLevelCard(0);
    else if (Game.state === 'shop') Game.nextWave();
  }
  const r1 = auditWorld(live, '实战');
  ok(r1.bad.length === 0, '真实对局的 ' + r1.n + ' 个对象全部由组件组合而成', r1.bad.slice(0, 4).join(' | '));

  for (const m of ['play', 'levelup', 'shop']) {
    const st = dev.stage('gladiator', 6);
    ok(Game.wave === 6, '?test=' + m + ' 能跳到第 6 波（老实现 while(nextWave) 是死循环，会卡死浏览器）',
      String(Game.wave));
    if (m === 'levelup') { st.p.xp = 999; Game._internals.checkLevelUp(); }
    if (m === 'shop') { st.sess.waveLeft = 0; st.sess.spawnQueue = []; st.sess.spawnIdx = 0; st.sess.enemies.length = 0; st.p.scrap = 220; Game.step(FIXED, { x: 0, y: 0 }); }
    const r = auditWorld(st.sess, '?test=' + m);
    ok(r.bad.length === 0, '?test=' + m + ' 场景的 ' + r.n + ' 个对象全部由组件组合而成', r.bad.slice(0, 4).join(' | '));
  }

  const st3 = dev.stage('gladiator', 6);
  dev.scene(st3.sess);
  const r3 = auditWorld(st3.sess, '?test=demo');
  ok(r3.bad.length === 0,
    '?test=demo 场景的 ' + r3.n + ' 个对象全部由组件组合而成（含 22 个掉落与 16 个贴花）',
    r3.bad.slice(0, 4).join(' | '));

  // 贴花的形状字段必须齐全 —— 缺了它在 canvas 上就是一堆 NaN
  const d = st3.sess.decals[0];
  const shape = ['seq', 'a1', 'a2', 'd1', 'd2', 's1', 's2'];
  const miss = !d ? shape : shape.filter(k => typeof d[k] !== 'number');
  ok(!!d && miss.length === 0,
    'demo 场景的贴花带齐 7 个形状字段（老实现这里是 14 次 NaN canvas 参数）', miss.join(','));
  ok(st3.sess.pickups.length > 0 && Comp.archOf(st3.sess.pickups[0]) === 'pickup',
    'demo 场景的掉落走 Comp.spawn（带 px/py，能被显示帧插值）');

  /* ?test=arena：**只为量地面**而生的场景。它存在的原因是一条真实的测量缺口 ——
     环境改成每局抽签之后，"另一个地方长什么样"等不来，必须能点单；
     而 ui-shot 原来那两屏分别停在商店与升级界面上，**没有任何一屏拍得到战场地面**。 */
  const st4 = dev.stage('gladiator', 6, 'frost');
  ok(st4.sess.map.theme === 'frost' && st4.sess.arena && st4.sess.arena.theme === 'frost',
    '&theme=frost 真的把这一层的环境钉住了（连战场也按它生成）',
    (st4.sess.map ? st4.sess.map.theme : '?') + '/' + (st4.sess.arena ? st4.sess.arena.theme : '?'));
  dev.arena(st4.sess);
  const r4 = auditWorld(st4.sess, '?test=arena');
  ok(r4.bad.length === 0, '?test=arena 场景的 ' + r4.n + ' 个对象全部由组件组合而成', r4.bad.slice(0, 4).join(' | '));
  ok(Game.state === 'playing' && st4.sess.enemies.length > 0,
    '?test=arena 停在战斗中（场上有怪 → 房间不算清空 → 不会跳到商店/升级）',
    Game.state + ' · ' + st4.sess.enemies.length + ' 怪');

  // 不认识的 id 不能把地图搞坏（顺序放在最后：stage 会开新的一局）
  const st5 = dev.stage('gladiator', 6, '不存在这个环境');
  ok(!!Dungeon.THEME_BY_ID[st5.sess.map.theme],
    '不认识的环境 id 被忽略（退回本局抽到的那个，而不是把地图搞坏）', st5.sess.map.theme);
}

console.log('\n=== 结果 ===');
if (failures === 0) { console.log('\x1b[32m全部通过 ✔\x1b[0m\n'); process.exit(0); }
console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m\n');
process.exit(1);
