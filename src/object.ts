/* =========================================================
   object.ts — **对象系统**（身份 · 普查 · 分类账）
   ---------------------------------------------------------
   用户的要求（2026-10-01）：

     「游戏里所有东西都是一个对象，你现在给我的东西里，没有对象这个概念我感觉，
       而且不仅没有对象，也没有游戏引擎里的坐标，没有网格，没有每个对象的属性，
       能明白吗，没有一套系统性的东西去支持」

   全量盘点（改造前是什么样）—— **底子是有的，账是没有的**：

     | 概念 | 改造前住在哪 | 缺的那一块 |
     | --- | --- | --- |
     | 对象 | `comp.ts`：组件 → 原型 → `Comp.spawn` | 没有一处能回答"这个项目一共有几类对象、每类几个" |
     | 属性 | 组件的字段（`Comp.define` 的键） | 字段被分成 30 多个组件，**没有一张并集表**能一次看全 |
     | 身份 | 怪有 `EnemyCore.id`（`S.nextId++`） | 子弹 / 粒子 / 掉落 / 贴花 / 炮塔**一个身份都没有** |
     | 家 | `containers.ts`：13 个容器 | 容器与原型**谁装谁**只存在于两边的 `list` 字符串里，没人对账 |

   这一轮把这三件事收成一条系统（`Comp` 造对象、`Containers` 管回收、
   `Objects` 立账）：

     · **身份**：`Comp.spawn` 出生时写 `$id`（全项目唯一的整数，见 comp.ts）
     · **普查**：`Objects.kinds()` —— 每个原型一行：组件 / 字段 / 家 / 现在几个
     · **对账**：`Objects.audit()` —— 每个容器都要认出装的是哪一类对象；
       认不出的（池 / 手工容器）要逐条写在案，写漏了就在启动期抛
     · **活体审计**：`Objects.liveAudit(会话)` —— 场上每个对象都要有身份、
       都在自己的字段表里（测试与 `?diag=2` 用它）

   ⚠ 刻意**不做**第四张注册表：原型在 `comp.ts`、容器在 `containers.ts`、
   家族在 `registry.ts`。`Objects` 只读它们，自己不拥有任何一张表 ——
   否则"同一个事实有两份"这件事就会从这一层重新长出来。
   ========================================================= */

import { Containers } from './containers.ts';
import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';

var Objects = {} as ObjectsApi;

/* =========================================================
   ⚠ **组件运行时的注入点**（E1 普查之后加，2026-10-01）
   ---------------------------------------------------------
   改造前这里是 `import { Comp } from './comp.ts'`。那条边**方向合法**
   （两个都是引擎），但 `comp.ts` 在 E1 普查里被正确地划成了**混合**
   （运行时是引擎，同一个文件里装着本作 37 个组件 / 11 个原型 / 1 个玩法系统）
   —— 于是"引擎 `object.ts` 静态 import 混合模块 `comp.ts`"被门 `engine-boundary`
   当场抓成越界。**门是对的。**

   为什么用注入而不是"把它划回引擎"：那样等于把"同一个文件里有两种东西"
   这件事按下去（门抓不住它，人会忘）。注入之后：

     · `object.ts` 认识的是**一组能力**（`ObjectsApi` 要的那几个查询），不是一个模块；
     · `comp.ts` 在文件末尾调 `Objects.setComponents(Comp)` —— 它是**主动提供方**；
     · 依赖方向变成 `comp.ts → object.ts`，而"混合模块 import 引擎"是**允许的边**。

   ⚠ **为什么安全**：本模块**没有一处**在加载期读 `Comp` ——
   上面那个注释（"只能登记、不能在加载期跑"）说的正是这件事，
   而所有 `requireComp().*` 调用都在**函数体**里，启动期（`SelfCheck.run`）时才发生，
   那时 `comp.ts` 早已加载并完成注入。
   这与 `grid.ts` 的 `GridCtx { session() }` 是**同一套 DIP 样板**。

   若是注入前被调用，`require()` 会**抛明确的名字**而不是静默返回 undefined ——
   这一层不许出现"静默少算"。 */
var CompRef: CompApi | null = null;
function requireComp(): CompApi {
  if (!CompRef) {
    throw new Error('object.ts：组件运行时还没注入（应当在 comp.ts 末尾调 Objects.setComponents(Comp)）');
  }
  return CompRef;
}
/** 由 `comp.ts` 在文件末尾调用 —— **它是提供方**（依赖方向 comp → object） */
Objects.setComponents = function (c) { CompRef = c; };

Objects.CONTRACT = {
  identity: '$id',
  unit: '整数（从 1 起，全项目唯一）',
  note: '对象 = 原型 × 组件 × 字段。身份在出生时由 comp.ts 写（$id）；' +
    '家由 containers.ts 给（每个容器装一类对象）；本模块只立账，不拥有表'
};

/* =========================================================
   1. 两条"不能自动配对"的名单（逐条写在案）
   ---------------------------------------------------------
   容器与原型**大多数**能自动配对：原型声明 `list: 'enemies'`、容器也声明
   `list: 'enemies'` —— 两边对得上就是一对。但有两类配不上，它们不是错误，
   而是**事实**，所以逐条写出来（写漏或写陈了由 audit 抓）：
   ========================================================= */

/** 池容器：装的是**同一个原型**（粒子），但"空闲池"不是它的语义归属 */
var POOLS: Record<string, string> = {
  textParticles: 'particle',
  freeParticles: 'particle',
  freeTextParticles: 'particle'
};

/** 没有容器的原型（唯一实例 / 直接住在会话字段上），逐条写明为什么 */
var HOMELESS: Record<string, string> = {
  player: '唯一实例：住在会话的 `sess.player` 上（不是数组），但仍由原型造、走同一套字段校验'
};

/** 按"集合路径"反查原型（`player.weapons` 这种点号路径原样比） */
function archOfList(list: string) {
  var archs = requireComp().archetypes();
  for (var i = 0; i < archs.length; i++) {
    var info = requireComp().archetypeInfo(archs[i]);
    if (info && info.list === list) return archs[i];
  }
  return null;
}

/** 一个原型住在哪些容器里（可能不止一个：粒子的视觉池 / 飘字池 / 两个空闲池） */
function homesOf(arch: string) {
  var out: string[] = [];
  var names = Containers.names();
  var info = requireComp().archetypeInfo(arch);
  for (var i = 0; i < names.length; i++) {
    var d = Containers.def(names[i]);
    if (!d) continue;
    if (info && info.list && d.list === info.list) out.push(names[i]);
    else if (POOLS[names[i]] === arch) out.push(names[i]);
  }
  return out;
}

/* =========================================================
   2. 普查：每个原型一行
   ========================================================= */
Objects.bindings = function () {
  var out = [] as { container: string; arch: string; list: string; kind: string }[];
  var names = Containers.names();
  for (var i = 0; i < names.length; i++) {
    var n = names[i];
    var d = Containers.def(n);
    var arch = archOfList(d.list);
    out.push({
      container: n,
      arch: arch || POOLS[n] || '',
      list: d.list,
      kind: arch ? 'live' : (POOLS[n] ? 'pool' : 'manual')
    });
  }
  return out;
};

Objects.kinds = function (sess) {
  var st = sess ? Containers.stats(sess) : null;
  var archs = requireComp().archetypes();
  var out: ObjectKindRow[] = [];
  for (var i = 0; i < archs.length; i++) {
    var name = archs[i];
    var info = requireComp().archetypeInfo(name);
    var homes = homesOf(name);
    var live = 0;
    if (st) for (var h = 0; h < homes.length; h++) live += st[homes[h]] ? st[homes[h]].len : 0;
    out.push({
      arch: name,
      note: info.note,
      comps: info.comps,
      fields: info.fields,
      list: info.list || '',
      homes: homes,
      container: homes.length ? homes[0] : '',
      live: live
    });
  }
  return out;
};

/* =========================================================
   3. 定义期对账（启动期自检）
   ---------------------------------------------------------
   每条判据都对着一个真实的静默故障：
     · 原型声明了集合、却没有容器认领它 → `requireComp().query` 拿到的是**别的数组**
       （老实现就发生过：`query(sess,'weapon')` 静默返回空数组）
     · 容器存在、却没有原型认领它 → 往里面 push 的东西**没有字段校验**，
       长得和别的对象一样、但不受任何守卫约束
     · 池 / 唯一实例没有登记 → 上面两条会误报，所以名单本身也要对账
     · 原型字段 ≠ 组件字段的并集 → "某个属性属于哪个组件"没有一处能回答
   ========================================================= */
Objects.audit = function () {
  var problems: string[] = [];
  var archs = requireComp().archetypes();
  var names = Containers.names();
  var fieldTotal = 0, i, j;

  /* 3.1 每个原型：有家 或 在 HOMELESS 里；字段并集与组件一致 */
  for (i = 0; i < archs.length; i++) {
    var info = requireComp().archetypeInfo(archs[i]);
    if (!info) { problems.push('原型 ' + archs[i] + ' 查不到信息'); continue; }
    var homes = homesOf(archs[i]);
    if (!homes.length && !HOMELESS[archs[i]]) {
      problems.push('原型 ' + archs[i] + ' 既没有容器认领、也不在"没有容器"的名单里' +
        '（它的对象会被 push 到哪个数组？）');
    }
    if (info.list && !homes.length) {
      problems.push('原型 ' + archs[i] + ' 声明了集合 ' + info.list + '，但没有容器用这个 list');
    }
    var union: Record<string, boolean> = Object.create(null);
    var n = 0;
    for (j = 0; j < info.comps.length; j++) {
      var keys = requireComp().componentKeys(info.comps[j]);
      if (!keys) { problems.push('原型 ' + archs[i] + ' 引用了未登记的组件 ' + info.comps[j]); continue; }
      for (var k = 0; k < keys.length; k++) if (!union[keys[k]]) { union[keys[k]] = true; n++; }
    }
    if (n !== info.fields.length) {
      problems.push('原型 ' + archs[i] + ' 的字段数 ' + info.fields.length +
        ' 与组件并集 ' + n + ' 对不上');
    }
    fieldTotal += info.fields.length;
  }

  /* 3.2 每个容器：能认出装的是哪一类（自动配对 或 在 POOLS 里） */
  for (i = 0; i < names.length; i++) {
    var cname = names[i];
    var d = Containers.def(cname);
    if (!archOfList(d.list) && !POOLS[cname]) {
      problems.push('容器 ' + cname + '（list=' + d.list + '）没有原型认领它 —— ' +
        '往里面放的对象不会走原型校验');
    }
  }

  /* 3.3 名单不许有已删除的条目（名单只会越积越松） */
  for (var p in POOLS) {
    if (!Containers.has(p)) problems.push('POOLS 里的容器 ' + p + ' 已经不存在了');
    else if (!requireComp().hasArchetype(POOLS[p])) problems.push('POOLS 里的原型 ' + POOLS[p] + ' 已经不存在了');
  }
  for (var h2 in HOMELESS) {
    if (!requireComp().hasArchetype(h2)) problems.push('HOMELESS 里的原型 ' + h2 + ' 已经不存在了');
    else if (homesOf(h2).length) problems.push('原型 ' + h2 + ' 已经有容器了，不该再留在 HOMELESS 里');
  }
  if (!Objects.CONTRACT.identity || !Objects.CONTRACT.unit) problems.push('对象契约不完整');

  return {
    ok: problems.length === 0, problems: problems,
    counts: { kinds: archs.length, containers: names.length, fields: fieldTotal }
  };
};

/* ⚠ 这一条**只能登记、不能在加载期跑**（与 `hall.ts` 同一条纪律）：
   容器是 `game.ts` 在 L4 声明的，而本模块在 L0 加载 —— 加载期跑会看到
   一张空容器表，把 10 个原型全报成"没有家"。启动期（SelfCheck.run）跑时
   全部模块都已加载，才是真正的对账。
   代价是"写错要等到启动"—— 但启动就是必经之路（浏览器入口与命令行入口都跑），
   所以它仍然在必经之路上，只是晚了一步。 */
SelfCheck.register('Objects', Objects.audit);

/* =========================================================
   4. 活体账目（跑起来的会话）
   ========================================================= */
Objects.stats = function (sess) {
  var out: Record<string, { arch: string; len: number; cap: number; identified: number }> = {};
  var rows = Objects.bindings();
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var d = Containers.def(r.container);
    var list = Containers.of(sess, r.container);
    var identified = 0;
    for (var j = 0; j < list.length; j++) if (Objects.id(list[j]) > 0) identified++;
    out[r.container] = { arch: r.arch, len: list.length, cap: d.cap, identified: identified };
  }
  return out;
};

/**
 * 场上审计：每个对象都要有身份、字段不多不少。
 * 与 `Containers.check()`（账目）分工：那条查"该回收的还在不在 / 超没超上限"，
 * 这条查"它是不是一个合规的对象"。
 */
Objects.liveAudit = function (sess) {
  var problems: string[] = [];
  var seen: Record<string, boolean> = Object.create(null);
  var checked = 0;
  var rows = Objects.bindings();
  /* 数组按**身份**去重：容器可以认领会话上同一个数组（`weapons` 的 list 是
     `player.weapons`），逐个容器照走会把同一批对象查两遍 —— 第二遍就会把
     "身份撞号"报成故障（自己的同一个对象）。所以一个数组只走一次。 */
  var visited: object[] = [];
  function visitedList(list: object) {
    for (var v = 0; v < visited.length; v++) if (visited[v] === list) return true;
    return false;
  }
  var i, j;
  function one(where: string, o: unknown, want: string) {
    checked++;
    if (!requireComp().archOf(o)) {
      problems.push(where + ' 不是组合对象（手写的对象字面量？）');
      return;
    }
    /* 字段随原型而定（这正是组件系统的本质），所以这里只声明"每个对象都有的那两格" */
    var bag = o as Record<string, unknown>;
    if (want && bag.$arch !== want) {
      problems.push(where + ' 是 ' + bag.$arch + '，但这个容器装的是 ' + want +
        '（容器与原型对不上：它不会走那一类的校验）');
    }
    var id = Objects.id(o);
    if (!(id > 0)) problems.push(where + '（' + bag.$arch + '）没有身份（$id=' + id + '）');
    else if (seen[id]) problems.push(where + ' 的身份 #' + id + ' 与别的对象撞了');
    else seen[id] = true;
    var r = requireComp().audit(o);
    if (r.unknown.length) problems.push(where + '（' + bag.$arch + '）游离字段 ' + r.unknown.join(','));
    if (r.missing.length) problems.push(where + '（' + bag.$arch + '）缺字段 ' + r.missing.join(','));
  }
  for (i = 0; i < rows.length; i++) {
    var list = Containers.of(sess, rows[i].container);
    if (visitedList(list)) continue;
    visited.push(list);
    for (j = 0; j < list.length; j++) one(rows[i].container + '[' + j + ']', list[j], rows[i].arch);
  }
  /* 玩家不在任何容器里（HOMELESS 的唯一实例），单独查一次 */
  if (sess.player) one('player', sess.player, '');
  return { checked: checked, problems: problems };
};

/* =========================================================
   5. 读口（诊断面板 / 悬浮提示 / 测试）
   ========================================================= */
/** 这个对象的身份（不是组合对象返回 0） */
Objects.id = function (e) {
  return (e && typeof e.$id === 'number') ? e.$id : 0;
};

/** 这个对象是什么：原型 / 身份 / 组件 / 字段 / 家 */
Objects.describeObject = function (e) {
  var arch = requireComp().archOf(e);
  if (!arch) return null;
  var info = requireComp().archetypeInfo(arch);
  return {
    arch: arch, id: Objects.id(e), comps: info.comps, fields: info.fields,
    list: info.list || ''
  };
};

/** 人话报告（`?diag=2` 展开档用） */
Objects.describe = function (sess) {
  var rows = Objects.kinds(sess);
  var lines = ['对象普查：' + rows.length + ' 类 · ' + Containers.names().length +
    ' 个容器 · 身份到 #' + requireComp().seq];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    lines.push('  ' + r.arch.padEnd(10) +
      (r.homes.length ? r.homes.join('/') : '（会话字段）').padEnd(28) +
      String(r.live).padStart(5) + ' 个  ' +
      r.comps.length + ' 组件 / ' + r.fields.length + ' 字段  ' + r.note);
  }
  return lines.join('\n');
};

/* =========================================================
   6. 登记进扩展点总账（见 registry.ts）
   ---------------------------------------------------------
   对象类 = 原型 ↔ 容器的一张**普查表**：它引用 `archetype` 与 `container`
   两个家族，于是"某个原型在表里、但容器名写错了"在启动期就会抛。
   ========================================================= */
Registry.family('objectKind', {
  note: '对象类（原型 → 组件 / 字段 / 容器的普查表；对象系统的读数）', owner: 'object.ts',
  entries: function () {
    return Objects.kinds().map(function (r) {
      var refs = [{ field: 'arch', value: r.arch, family: 'archetype' }];
      for (var i = 0; i < r.homes.length; i++) {
        refs.push({ field: 'homes[' + i + ']', value: r.homes[i], family: 'container' });
      }
      return { id: r.arch, refs: refs };
    });
  }
});

export { Objects };
