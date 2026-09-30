/* =========================================================
   object.mjs — 对象系统（身份 · 普查 · 容器对账）
   用户的要求（2026-10-01）：「游戏里所有东西都是一个对象……没有每个对象的属性，
   能明白吗，没有一套系统性的东西去支持」。

   这一套守五件事：
     1) 普查：每个原型一行（组件 / 字段 / 家 / 现在几个），字段 = 组件并集
     2) 身份：每个对象出生时拿到一个唯一整数（`$id`），且**改不了**
     3) 属性：字段不是"用到才挂上去"的 —— 每个原型字段逐项可查
     4) 对账：每个容器都要认出装的是哪一类对象（池 / 唯一实例逐条在案）
     5) 活体：真打一场，场上每个对象都有身份、都是合规的组合对象、
        都住在认领它的容器里
   用法： node test/object.mjs
   ========================================================= */
import { loadAll, SIM_MODULES } from './_load.mjs';
import { T } from './_assert.mjs';

/* 断言走共享库（`test/_assert.mjs`）：抛了继续跑，失败时两个值都打出来。
   新套件**不带**自己那份 `ok()` —— 那正是迁移预算（`registry-drift` 判据 K）在守的事。 */
const ok = T.ok;
function throws(fn) { try { fn(); return null; } catch (e) { return e.message; } }

await loadAll(SIM_MODULES);
const g = globalThis;
const { Objects, Comp, Containers, Game, Registry, SelfCheck, Items } = g;
const FIXED = Game.cfg.fixedDt;

console.log('\n=== Bronana · 对象系统（身份 / 普查 / 容器）===\n');

/* ---------------- 1. 契约与普查 ---------------- */
T.section('契约与普查：每个原型一行');
{
  const c = Objects.CONTRACT;
  ok(c.identity === '$id' && typeof c.unit === 'string' && c.note.length > 10,
    '契约：身份字段 ' + c.identity + '（' + c.unit + '）', JSON.stringify(c));

  const kinds = Objects.kinds();
  const archs = Comp.archetypes();
  ok(kinds.length === archs.length, '普查覆盖全部 ' + archs.length + ' 个原型',
    kinds.length + ' vs ' + archs.length);
  const noHome = kinds.filter(k => !k.homes.length && k.arch !== 'player');
  ok(noHome.length === 0, '除玩家（唯一实例）之外，每个原型都有容器认领它',
    noHome.map(k => k.arch).join(','));
  const badRow = kinds.filter(k => !k.comps.length || !k.fields.length || !k.note);
  ok(badRow.length === 0, '每行都写了组件 / 字段 / 说明（普查不是一张空表）',
    badRow.map(k => k.arch).join(','));

  /* 字段必须是组件并集：一个不多一个不少 */
  const unionErr = [];
  for (const k of kinds) {
    const union = new Set();
    k.comps.forEach(cn => (Comp.componentKeys(cn) || []).forEach(f => union.add(f)));
    if (union.size !== k.fields.length) unionErr.push(k.arch + ' 字段数不符');
    k.fields.forEach(f => { if (!union.has(f)) unionErr.push(k.arch + '.' + f + ' 不属于任何组件'); });
  }
  ok(unionErr.length === 0, '每个原型的字段恰好是它的组件字段并集', unionErr.slice(0, 3).join(' | '));

  const tables = Objects.kinds().map(k => k.arch + ' ' + k.comps.length + '+' + k.fields.length +
    ' → ' + (k.homes.join('/') || '（会话字段）')).join('  ·  ');
  console.log('    ' + tables);
}

/* ---------------- 2. 身份 ---------------- */
T.section('身份：每个对象出生时拿到一个唯一的整数');
{
  const a = Comp.spawn('enemy'), b = Comp.spawn('enemy');
  ok(Objects.id(a) > 0 && Objects.id(b) > 0, '对象有身份', Objects.id(a) + ' / ' + Objects.id(b));
  ok(Objects.id(b) === Objects.id(a) + 1, '身份是**单调递增**的（同一次创建挨着）',
    Objects.id(a) + ' → ' + Objects.id(b));
  ok(Comp.seq >= Objects.id(b), '身份序列跟着走（Comp.seq = ' + Comp.seq + '）');
  ok(Comp.archOf(a) === 'enemy' && a.$arch === 'enemy', '原型仍然可查（$arch 与身份并列）');

  const ids = new Set();
  for (let i = 0; i < 200; i++) ids.add(Objects.id(Comp.spawn('bullet')));
  ok(ids.size === 200 && !ids.has(0), '200 个对象 200 个不同身份（没有撞号）', String(ids.size));

  ok(Objects.id({ x: 1 }) === 0 && Objects.id(null) === 0,
    '不是组合对象 → 身份 0（不抛、不发明身份）');

  const err = throws(() => Comp.assign(a, { $id: 999 }));
  ok(!!err && /没有字段/.test(err), 'assign 改不了身份（$id 不是组件字段，写它当场抛）', err);
  ok(Objects.id(a) !== 999, '失败之后身份没被改掉', Objects.id(a));

  /* 全项目唯一：换一个会话（新一局）继续发号，不会从 1 重来 */
  const before = Objects.id(Comp.spawn('pickup'));
  Game.newRun('ranger', 4242);
  const after = Objects.id(Comp.spawn('pickup'));
  ok(after > before, '跨会话不重号（第 2 局的对象身份接着上一局发）', before + ' → ' + after);
}

/* ---------------- 3. 属性：字段是可查的 ---------------- */
T.section('属性：字段 = 组件声明，不是"用到才挂上去"');
{
  const e = Comp.spawn('enemy');
  const d = Objects.describeObject(e);
  ok(!!d && d.arch === 'enemy' && d.id === Objects.id(e),
    'describeObject 给出原型 / 身份 / 组件 / 字段 / 家', JSON.stringify(d).slice(0, 90));
  ok(d.comps.indexOf('Health') >= 0 && d.comps.indexOf('AI') >= 0,
    '怪的组件清单可查：' + d.comps.join('+'));
  ok(d.fields.indexOf('hp') >= 0 && d.fields.indexOf('speed') >= 0 && d.fields.indexOf('x') >= 0,
    '字段清单可查（坐标 / 生命 / 行为参数都在一张表里）');
  ok(Objects.describeObject({ x: 1 }) === null, '普通对象没有"对象描述"（返回 null）');

  /* 写一个没声明的字段 → 当场抛（这就是"每个对象的属性"的守卫） */
  const err = throws(() => Comp.assign(e, { 不存在的字段: 1 }));
  ok(!!err && /没有字段/.test(err), '写未声明的字段被拒（字段漂移不可能发生）', err);
}

/* ---------------- 4. 对账：容器 ↔ 原型 ---------------- */
T.section('对账：每个容器都认得出装的是哪一类对象');
{
  const rows = Objects.bindings();
  const names = Containers.names();
  ok(rows.length === names.length, rows.length + ' 个容器逐个配对', String(rows.length));
  const unbound = rows.filter(r => r.kind === 'manual');
  ok(unbound.length === 0, '没有"装了什么都不知道"的容器', unbound.map(r => r.container).join(','));
  const pools = rows.filter(r => r.kind === 'pool').map(r => r.container);
  ok(pools.length === 3, '池容器逐条在案（' + pools.join(' / ') + '）', pools.join(','));

  const a = Objects.audit();
  ok(a.ok, '对象系统自检通过（' + a.counts.kinds + ' 类 / ' + a.counts.containers +
    ' 容器 / ' + a.counts.fields + ' 个字段）', a.problems.slice(0, 3).join(' | '));
  ok(SelfCheck.names().indexOf('Objects') >= 0, '自检登记进了启动期清单');

  /* 负例：容器名写错 → 跨表引用当场断链（不是"跑起来才发现"） */
  const bad = Registry.audit().missing.filter(m => m === 'container' || m === 'archetype');
  ok(bad.length === 0, 'objectKind 引用的两个家族都注册了', bad.join(','));

  /* 会话说的是同一件事：容器的 list 路径真的能取到数组 */
  const sess = Game.newRun('gladiator', 909);
  const stat = Objects.stats(sess);
  ok(Object.keys(stat).length === names.length, '每个容器在会话里都能取到（list 路径没问题）');
  const mismatch = names.filter(n => stat[n].cap !== Containers.def(n).cap);
  ok(mismatch.length === 0, '普查里的上限与容器声明一致', mismatch.join(','));
}

/* ---------------- 5. 活体：真打一场 ---------------- */
T.section('活体审计：真打一场，场上每个对象都合规');
{
  Game.newRun('gladiator', 909);
  g.enterFightRoom(); Game._internals.startWave(30);
  const s = Game.getSession();
  s.player.weapons.length = 0;
  ['minigun', 'sword', 'shotgun', 'flame', 'laser', 'hammer'].forEach(id => Game.addWeapon(id));
  Items.LIST.slice(0, 6).forEach(it => s.player.items.push(Comp.spawn('item', { def: it })));
  Game.recalcStats();

  let runErr = null;
  try {
    for (let i = 0; i < 1200; i++) {
      if (Game.state === 'playing') { s.player.invuln = 999; holdRoom(s); Game.step(FIXED, Game.autoInput(i / 60)); }
      else if (Game.state === 'levelup') Game.chooseLevelCard(0);
      else if (Game.state === 'shop') Game.nextWave();
      else break;
    }
  } catch (e) { runErr = e.message; }
  ok(!runErr, '1200 帧实战无异常', runErr);

  const r = Objects.liveAudit(s);
  ok(r.checked > 100, '审计样本量足够（' + r.checked + ' 个场上的对象）', String(r.checked));
  ok(r.problems.length === 0, '每个对象都有身份、字段不多不少、住在认领它的容器里',
    r.problems.slice(0, 4).join(' | '));

  /* 身份在场上真的唯一：把所有容器 + 玩家侧的 id 收一遍 */
  const seen = new Map();
  let dup = [];
  for (const n of Containers.names()) {
    for (const o of Containers.of(s, n)) {
      const id = Objects.id(o);
      if (seen.has(id)) dup.push(id + '（' + n + ' 与 ' + seen.get(id) + '）');
      else seen.set(id, n);
    }
  }
  ok(dup.length === 0, '场上 ' + seen.size + ' 个对象的身份互不相同', dup.slice(0, 3).join(','));

  /* 负例：一个手写字面量混进容器 → 活体审计必须抓出来（判据不是空转） */
  s.pickups.push({ x: 1, y: 1, kind: 'scrap', dead: false });
  const r2 = Objects.liveAudit(s);
  ok(r2.problems.some(p => /不是组合对象/.test(p)),
    '往容器里塞手写对象字面量 → 活体审计当场报出来', r2.problems.slice(0, 2).join(' | '));
  s.pickups.pop();

  /* 诊断面板读的就是这套账 */
  console.log('    ' + g.Diag.objects());
  console.log('    ' + g.Diag.world());
}

console.log('\n=== 结果 ===');
process.exit(T.done());
