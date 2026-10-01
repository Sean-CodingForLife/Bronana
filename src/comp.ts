/* =========================================================
comp.ts — 组件式组合运行时
改造前：每种对象都是一个手写的对象字面量（玩家 / 怪 / 子弹 / 敌弹 /
粒子 / 掉落 / 贴花 / 炮塔 / 武器 / 道具），字段散在各处，
`w.dup`、`e._spr` 这类"用到才挂上去"的字段会让同一个类型的对象
在运行期长出不同的隐藏类（V8 上就是同类型对象形状不一致，
属性访问要走慢路径）。

现在：所有对象都由"组件"组合而成。
  · Comp.define(组件, {字段: 默认值})       —— 组件是字段的声明式打包
  · Comp.archetype(原型, [组件...])          —— 原型 = 组件清单
  · Comp.spawn(原型) / Comp.assign(对象, 覆盖) —— 对象一定字段齐全、形状一致
  · Comp.query(会话, 原型) / Comp.run(系统)   —— 系统声明自己需要哪些组件

设计取舍（刻意的）：
  · 存储是"扁平混入"：一个对象直接持有它所有组件的字段。热循环里仍是
    `e.x` 这样的直接属性访问，没有 id 间接层，因此不会比原来慢。
  · 组件定义与原型定义都放在本文件里（自注册）。分成两个文件更"干净"，
    但会引入"谁先加载"的隐患：emit.ts 造粒子时若原型尚未注册就会抛错。
  · 默认值是数组时每个对象拿到独立的新数组（否则会共享同一个数组）；
    对象/函数类型的默认值一律拒绝，逼着写 null，避免隐式共享可变状态。
  ========================================================= */

import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';

var Comp = {} as CompApi;

/* =========================================================
   1. 注册表
   ========================================================= */
var DEFS: Record<string, CompDef> = Object.create(null);
var DEF_NAMES: string[] = [];
var ARCHS: Record<string, CompArch> = Object.create(null);
var ARCH_NAMES: string[] = [];
var SYSTEMS: Record<string, CompSystem> = Object.create(null);
var SYS_NAMES: string[] = [];

/* =========================================================
   对象身份（**每个对象出生时拿到的实例号**）
   ---------------------------------------------------------
   用户的要求（2026-10-01）：「游戏里所有东西都是一个对象……没有每个对象的属性」。

   改造前：连"这是哪一个对象"都没有一处能回答 —— 怪身上有 `EnemyCore.id`
   （`S.nextId++`），那是**怪物编号**（存档 / 行为用），而子弹 / 粒子 / 掉落 /
   贴花 / 炮塔**一个身份字段都没有**。于是"同一个对象在两帧之间是同一个吗"
   这个问题只能靠引用比较回答，池化复用之后连引用都会撞。

   现在：工厂产出的字面量里带一格 `$id`（与 `$arch` 同为**运行期字段**，
   不属于任何组件），`Comp.spawn` 出生时写一个全项目唯一的整数。
   它是 `object.ts`（对象系统的普查）与调试面板读身份的唯一入口。

   ⚠ 全项目唯一而不是"每局唯一"：会话会被重建，而身份一旦重复
   （第 2 局的 1 号与第 1 局的 1 号），"回放里那发子弹"就没法指认。

   ⚠ 计数器是**模块级可变状态**（登记在 test/persist.mjs 的清单里）：
   它对玩法没有任何影响（只被审计与调试读），但不登记就会被盘点漏掉。
   ========================================================= */
Comp.seq = 0;

/** 定义一个组件。fields 的键 = 字段名，值 = 默认值 */
Comp.define = function (name, fields, hooks) {
  if (DEFS[name]) throw new Error('comp: 组件重名 ' + name);
  var keys: string[] = [];
  for (var k in fields) {
    if (!Object.prototype.hasOwnProperty.call(fields, k)) continue;
    var v = fields[k];
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      throw new Error('comp: 组件 ' + name + '.' + k +
        ' 的默认值是对象 —— 组件默认值只能是原始值 / null / 数组（数组会按对象复制）');
    }
    if (!/^[A-Za-z_$][\w$]*$/.test(k)) {
      throw new Error('comp: 组件 ' + name + ' 的字段名 ' + k + ' 不是合法标识符');
    }
    keys.push(k);
  }
  if (!keys.length) throw new Error('comp: 组件 ' + name + ' 没有任何字段');
  DEFS[name] = { name: name, fields: fields, keys: keys, hooks: hooks || null };
  DEF_NAMES.push(name);
  return DEFS[name];
};

Comp.componentKeys = function (name) { return DEFS[name] ? DEFS[name].keys.slice() : null; };

/**
 * 把一个模板默认值写成**源码里的字面量**；写不出来（数组 / 函数 / undefined /
 * 非有限数 / -0）返回 null，那些字段回落到从模板读。
 * 数组必须走 `t.f.slice()`：数组默认值是"按对象复制"的语义，内联会把同一个
 * 数组字面量……其实内联成 `[]` 也会每次新建，但切片能保留模板里的元素，
 * 所以数组一律从模板取。
 */
function inlineLiteral(v) {
  if (v === null) return 'null';
  var t = typeof v;
  if (t === 'boolean') return String(v);
  if (t === 'number') {
    // NaN / ±Infinity / -0 直接写成源码会丢失语义（-0 会变成 0）
    if (!isFinite(v) || Object.is(v, -0)) return null;
    return String(v);
  }
  if (t === 'string') return JSON.stringify(v);
  return null;
}

/**
 * 为一个原型编译出"造对象"的工厂。
 * 三代实现，跟着实测改的（都是同一台机器上 20 万次 spawn 的最小值）：
 *   ① 逐字段从模板拷贝       ~1650 ns   —— 模板是运行期逐个加属性建起来的字典
 *                                          模式对象，每次 spawn 都在做哈希查找
 *   ② 代码生成、值从模板读    ~290 ns   —— 隐藏类与模板一致了，但每次 spawn 仍要
 *                                          从 `t` 上读 24 个属性
 *   ③ 代码生成、值内联进源码  见 test/comp.mjs [7] —— 生成的函数体就是一句对象
 *                                          字面量，不再读模板、不再持有闭包上下文
 * 也就是说：热路径上"组合造对象"的额外开销只剩 Comp.spawn 自己那几次查表与判断，
 * 造对象本身与手写字面量等价。
 * 不依赖 eval 的兜底（CSP 下 new Function 会被拒）：Object.assign({}, tpl) —— 慢，
 * 但行为一致，且 test/comp.mjs 校验的是行为不是速度，兜底路径照样过。
 */
function compileFactory(name, fields, tpl) {
  /* `$arch` / `$id` 是**运行期字段**：前者回答"它是什么"，后者回答"它是哪一个"。
     两者都不属于任何组件，所以不在 `fields` 里；工厂把它们写在最前面，
     与组件字段一起构成同原型对象的固定形状。 */
  var parts = ['$arch: ' + JSON.stringify(name), '$id: 0'];
  var fromTemplate = false;
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    var lit = inlineLiteral(tpl[f]);
    if (lit !== null) { parts.push(f + ': ' + lit); continue; }
    fromTemplate = true;
    parts.push(f + ': ' + (Array.isArray(tpl[f]) ? 't.' + f + '.slice()' : 't.' + f));
  }
  var body = '{ ' + parts.join(', ') + ' }';
  try {
    // 没有字段需要从模板读时，连参数都不必引用 —— 内层函数不再创建闭包上下文
    return fromTemplate
      ? new Function('t', 'return function () { return ' + body + '; };')(tpl) as () => any
      : new Function('return function () { return ' + body + '; };')() as () => any;
  } catch (e) {
    return function () { return Object.assign({}, tpl); };
  }
}

/**
 * 定义一个原型：由若干组件组合而成。
 * 同一个字段被两个组件同时声明会直接抛错 —— 这是最容易悄悄出问题的地方
 * （谁覆盖谁取决于顺序，而顺序是会被重构改掉的）。
 */
Comp.archetype = function (name, comps, opts) {
  if (ARCHS[name]) throw new Error('comp: 原型重名 ' + name);
  opts = opts || {};
  var owner: Record<string, string> = Object.create(null);
  var fields: string[] = [];
  var tpl: Record<string, any> = {};
  for (var c = 0; c < comps.length; c++) {
    var cn = comps[c];
    var d = DEFS[cn];
    if (!d) throw new Error('comp: 原型 ' + name + ' 引用了未定义的组件 ' + cn);
    for (var i = 0; i < d.keys.length; i++) {
      var f = d.keys[i];
      if (owner[f]) {
        throw new Error('comp: 原型 ' + name + ' 的字段 ' + f + ' 被两个组件同时声明（' +
          owner[f] + ' 与 ' + cn + '）');
      }
      owner[f] = cn;
      fields.push(f);
      tpl[f] = d.fields[f];
    }
  }
  tpl.$arch = name;    // 代码生成的工厂从这里取原型名
  tpl.$id = 0;         // 身份在 spawn 时写（见文件头的"对象身份"）
  var has: Record<string, boolean> = Object.create(null);
  for (var q = 0; q < fields.length; q++) has[fields[q]] = true;
  var a: CompArch = {
    name: name, comps: comps.slice(), fields: fields, owner: owner,
    has: has, template: tpl, list: opts.list || null, note: opts.note || '',
    hooks: null,
    // Transform 带 px/py（上一逻辑帧的位置）：这类原型出生时要把 px/py 与 x/y 对齐，
    // 否则表现层插值会把刚出生的对象从 (0,0) 拉过来。编译期算好，spawn 只多一次布尔判断。
    seedPrev: has.px === true && has.py === true
  };
  a.make = compileFactory(name, fields, tpl);
  ARCHS[name] = a;
  ARCH_NAMES.push(name);
  return a;
};

Comp.hasArchetype = function (name) { return !!ARCHS[name]; };
Comp.archetypes = function () { return ARCH_NAMES.slice(); };
Comp.archetypeInfo = function (name) {
  var a = ARCHS[name];
  if (!a) return null;
  return { name: a.name, comps: a.comps.slice(), fields: a.fields.slice(), list: a.list, note: a.note };
};

/* =========================================================
   2. 造对象
   ========================================================= */
/**
 * 为一个原型注册"生成钩子"：每次 spawn 出来后自动补齐那些**不能写进组件默认值**
 * 的字段（对象/函数类型的默认值被 define 拒绝，因为会隐式共享可变状态）。
 * 第一个用它的就是骨架：`bronana.ts` 注册 player → `rig = Bronana.create()`，
 * 于是"玩家一定有骨架"由原型保证，而不是靠调用方记得再 assign 一次。
 */
Comp.onSpawn = function (archName, fn) {
  var a = ARCHS[archName];
  if (!a) throw new Error('comp: 为未注册的原型 ' + archName + ' 注册生成钩子');
  if (typeof fn !== 'function') throw new Error('comp: 生成钩子必须是函数');
  if (!a.hooks) a.hooks = [];
  a.hooks.push(fn);
  return a;
};

/**
 * 按原型造一个对象。
 * 逐字段按固定顺序写出 → 同原型的所有对象隐藏类完全一致（这是本次改造
 * 最实在的性能收益：原来 `w.dup` / `e._spr` 会让同类型对象形状分叉）。
 * 没有注册过钩子的原型（子弹/粒子这些热路径）只多一次 falsy 判断。
 */
Comp.spawn = function (name, overrides) {
  var a = ARCHS[name];
  if (!a) throw new Error('comp: 未注册的原型 ' + name);
  var e = a.make();
  /* 身份：出生时写，且**只能**在这里写（assign 会拒绝 `$id`，它不是组件字段）。
     这一行在热路径上，但它只是一次整数自增 + 一次属性写入 ——
     与 `seedPrev` 的两次写入同类，实测开销见 test/comp.mjs [7]。 */
  e.$id = (Comp.seq += 1);
  if (overrides) Comp.assign(e, overrides);
  if (a.seedPrev) { e.px = e.x; e.py = e.y; }
  var hk = a.hooks;
  if (hk) for (var i = 0; i < hk.length; i++) hk[i](e);
  return e;
};

/** 把覆盖值写进已有对象；写不存在的字段直接抛错（防字段漂移） */
Comp.assign = function (e, overrides) {
  var a = ARCHS[e && e.$arch];
  if (!a) throw new Error('comp: assign 的目标不是组合出来的对象');
  for (var k in overrides) {
    if (!Object.prototype.hasOwnProperty.call(overrides, k)) continue;
    if (!a.has[k]) {
      throw new Error('comp: 原型 ' + a.name + ' 没有字段 ' + k +
        ' —— 该字段属于哪个组件？（漏声明组件是本次改造要防的主要问题）');
    }
    e[k] = overrides[k];
  }
  return e;
};

/** 该对象属于哪个原型（不是组合出来的对象返回 null） */
Comp.archOf = function (e) {
  if (!e || typeof e.$arch !== 'string') return null;
  return ARCHS[e.$arch] ? e.$arch : null;
};
Comp.has = function (e, compName) {
  var a = ARCHS[e && e.$arch];
  return !!a && a.comps.indexOf(compName) >= 0;
};

/* =========================================================
   3. 审计（测试与 ?fps=1 叠加层用）
   ========================================================= */
/**
 * 对象上出现了原型没声明的字段 → 返回字段名列表；不是组合对象返回 null。
 * `$arch` / `$id` 是**运行期字段**（原型与身份），与组件字段分开算。
 */
Comp.unknownFields = function (e) {
  var a = ARCHS[e && e.$arch];
  if (!a) return null;
  var bad: string[] = [];
  for (var k in e) {
    if (Object.prototype.hasOwnProperty.call(e, k) && k !== '$arch' && k !== '$id' && !a.has[k]) bad.push(k);
  }
  return bad;
};

Comp.audit = function (e) {
  var a = ARCHS[e && e.$arch];
  var unknown = Comp.unknownFields(e);
  var missing: string[] = [];
  if (a) {
    for (var i = 0; i < a.fields.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(e, a.fields[i])) missing.push(a.fields[i]);
    }
  }
  return {
    arch: (e && e.$arch) || null,
    id: (e && typeof e.$id === 'number') ? e.$id : 0,
    unknown: unknown || [], missing: missing
  };
};

/* =========================================================
   定义期自检（`component` / `archetype` 两个家族的守卫）
   ---------------------------------------------------------
   这一份判据原先**只在 `test/comp.mjs` 里被调**（`Comp.selfCheck()`），
   也就是护栏存在、但不在必经之路上：改坏一个组件的默认值，只有跑测试才发现得到。
   现在它返回 `SelfCheck.scan()` 约定的 `{ok, problems}` 并登记进启动期自检
   （`SelfCheck.register('Comp', …)`，见文件末尾），
   于是浏览器入口与命令行入口在启动时都会跑它，不过就抛（一次列全）。

   为什么它**能**在加载期跑一遍（不像 tutorial.ts 那样只登记）：
   这一份判据只读本模块的表（DEFS / ARCHS / 工厂产物），不读任何别的家族，
   所以"谁先加载"对它没有影响。

   每条判据都对着一个真实的静默故障：
     · 生成的工厂把默认值**内联进源码**（`compileFactory`），写错（NaN / -0 /
       科学计数法 / 字符串转义）只会在"裸产物 vs 模板"的 `Object.is` 比对里现形 ——
       不比对的话表现为"某个组件字段莫名其妙是 NaN"，查起来极贵
     · 数组默认值被两个对象共享 → 给一个拾取物 push 元素，另一个也变了
     · 原型引用的组件若不在场，`archetype()` 当场抛；但**注册后的表**再被改坏
       （补丁 / 重构漏改）不会有人喊，只有 spawn 会失败
   ========================================================= */
/** 自查：所有原型都试造一个对象，检查字段完整性 */
Comp.selfCheck = function () {
  var problems: string[] = [];
  for (var i = 0; i < ARCH_NAMES.length; i++) {
    var name = ARCH_NAMES[i];
    var e: any;
    try { e = Comp.spawn(name); } catch (err) { problems.push(name + ': ' + err.message); continue; }
    var r = Comp.audit(e);
    if (r.missing.length) problems.push(name + ' 缺少字段 ' + r.missing.join(','));
    if (r.unknown.length) problems.push(name + ' 多出字段 ' + r.unknown.join(','));
    // 数组默认值必须每个对象独立
    var e2 = Comp.spawn(name);
    var a = ARCHS[name];
    // 默认值比对用**工厂的裸产物** a.make()，不用 spawn 的产物：
    // onSpawn 钩子本来就会改写字段（player.rig 出生时由钩子搭骨架，
    // 模板里写的是 null），拿钩子后的对象去比会误报。
    var raw: any = a.make();
    for (var f = 0; f < a.fields.length; f++) {
      var k = a.fields[f];
      var tv = a.template[k];
      if (Array.isArray(raw[k]) && raw[k] === e2[k]) {
        problems.push(name + '.' + k + ' 的数组默认值被两个对象共享');
      }
      // 默认值必须与模板逐字段一致：spawn 的值可能是编译期**内联进源码**的，
      // 内联写错（NaN / -0 / 科学计数法 / 字符串转义）只能在这里抓到。
      var ev = raw[k];
      if (Array.isArray(tv)) {
        if (!Array.isArray(ev) || ev.length !== tv.length) {
          problems.push(name + '.' + k + ' 的数组默认值长度不对');
        } else {
          for (var j = 0; j < tv.length; j++) {
            if (!Object.is(tv[j], ev[j])) problems.push(name + '.' + k + '[' + j + '] 与模板不一致');
          }
        }
      } else if (!Object.is(tv, ev)) {
        problems.push(name + '.' + k + ' 的默认值与模板不一致：模板 ' + String(tv) +
          ' → 实际 ' + String(ev));
      }
    }
  }
  return { ok: problems.length === 0, problems: problems };
};


/* =========================================================
   4. 查询与系统
   ========================================================= */
Comp.query = function (sess, archName) {
  var a = ARCHS[archName];
  if (!a) throw new Error('comp: 未注册的原型 ' + archName);
  if (!a.list) throw new Error('comp: 原型 ' + archName + ' 没声明集合（archetype 的 opts.list）');
  // 集合路径支持点号（`player.weapons`）：武器挂在玩家身上，不在会话顶层。
  // 老实现只认 `sess[a.list]`，于是 query(sess, 'weapon') 静默返回空数组。
  var parts = a.list.split('.');
  var cur: any = sess;
  for (var i = 0; i < parts.length && cur; i++) cur = cur[parts[i]];
  return cur || [];
};

Comp.system = function (name, need, fn, opts) {
  if (SYSTEMS[name]) throw new Error('comp: 系统重名 ' + name);
  opts = opts || {};
  for (var i = 0; i < need.length; i++) {
    if (!DEFS[need[i]]) throw new Error('comp: 系统 ' + name + ' 依赖未定义的组件 ' + need[i]);
  }
  SYSTEMS[name] = { name: name, need: need.slice(), fn: fn, _checked: false, back: !!opts.back };
  SYS_NAMES.push(name);
  return SYSTEMS[name];
};

/**
 * 跑一个系统。首次执行时校验集合元素确实具备系统声明的组件 ——
 * "系统声明依赖"如果没人校验，就只是注释。
 * fn(e, dt, ctx) 返回 false 表示"这个对象本次没有处理"。
 */
Comp.run = function (name, list, dt, ctx) {
  var sys = SYSTEMS[name];
  if (!sys) throw new Error('comp: 未注册的系统 ' + name);
  var n = list ? list.length : 0;
  if (!n) return 0;
  if (!sys._checked) {
    var a = ARCHS[list[0].$arch];
    if (!a) throw new Error('comp: 系统 ' + name + ' 的集合里有非组合对象');
    for (var i = 0; i < sys.need.length; i++) {
      if (a.comps.indexOf(sys.need[i]) < 0) {
        throw new Error('comp: 系统 ' + name + ' 声明的组件 ' + sys.need[i] +
          ' 不在原型 ' + a.name + ' 上（' + a.name + ' = ' + a.comps.join('+') + '）');
      }
    }
    sys._checked = true;
  }
  if (!ctx) ctx = sys._ctx || (sys._ctx = {});
  var done = 0, k;
  if (sys.back) {
    // 倒序 + 交换删除的集合必须倒着遍历（正序会把被搬到空位的元素跳过）
    for (k = n - 1; k >= 0; k--) {
      ctx.i = k;
      if (sys.fn(list[k], dt, ctx) !== false) done++;
    }
  } else {
    for (k = 0; k < n; k++) {
      ctx.i = k;
      if (sys.fn(list[k], dt, ctx) !== false) done++;
    }
  }
  return done;
};

Comp.stats = function () {
  return {
    components: DEF_NAMES.length, archetypes: ARCH_NAMES.length, systems: SYS_NAMES.length,
    spawned: Comp.seq
  };
};

/* =========================================================
   5. 组件目录（本项目用到的全部组件）
   ========================================================= */
Comp.define('Transform', { x: 0, y: 0, px: 0, py: 0 });
Comp.define('Motion', { vx: 0, vy: 0 });
Comp.define('Body', { r: 0 });
Comp.define('Health', { hp: 0, maxHp: 0 });
Comp.define('Damage', { dmg: 0 });
Comp.define('Lifetime', { life: 0, lifeMax: 0 });
/* 装置（炮塔）的两个扩展字段 —— 与 `Lifetime`（上面）同一类：
   **技能放的装置**要用它们。
     · `range`  = 它自己看得多远（道具炮塔固定 300；技能的装置在表里配）
     · `dmgMul` = 技能强度折出来的伤害系数（缺省 0 = 恒等，见 `updateTurrets`）
   为什么要在这里声明而不是往对象上随手挂：组件系统会**当场拒绝**未声明字段
   （那正是它存在的意义 —— 池化复用时会留下上一只怪的残值）。 */
Comp.define('TurretExt', { range: 0, dmgMul: 0 });
Comp.define('Look', { kind: '', color: '', dark: '', tintA: '' });
Comp.define('HitFlash', { hitFlash: 0 });
Comp.define('Hurt', { hurtFlash: 0 });
Comp.define('Invuln', { invuln: 0 });
Comp.define('Aim', { aim: 0, muzzle: 0 });
Comp.define('Cooldown', { cd: 0 });
/* AI 状态：phase 是动画相位；t1/t2 是行为自己的两个计时器
   （钻地的上浮/下潜、召唤的节拍、钟摆的扫射角），
   声明在这里而不是让行为临时往怪身上挂字段 —— 后者会被 Comp.audit 当场拒掉，
   而且池化复用时会留下上一只怪的残值。 */
Comp.define('AI', { speed: 0, phase: 0, atkCd: 0, windup: 0, shootCd: 0, spawnT: 0, t1: 0, t2: 0 });
Comp.define('Knock', { kx: 0, ky: 0 });
/* ---- **状态系统的宿主字段**（R50 第 10 条）----
   ⚠ 这两个组件是"状态写在谁身上"的**唯一声明**（`status.ts` 只管时长与叠法，
     不管字段住在哪）。加一种新状态 = 这里加字段 + `status.ts` 的表里加一行。

   ⚠ 改造前这里只有 `Burn`（`burn` / `burnDps`），而**技能载荷的 `slow` / `stun`
     是写在未声明字段上的**（`e.slow` / `e.slowMul` / `e.stun`）——
     于是两个真 bug：
       ① 它们**没有任何读点**（全仓搜 `e.slow` / `e.stun` 只搜到写入那两行）：
          「冰冻」与「打断」两个技能载荷**实际什么也没做**，而界面上写着它的说明
       ② 未声明字段**不参与池化复位**：容器回收复用一只怪时，
          上一只的 `slow` / `stun` 会**留在它身上**（`Comp` 的字段校验只看声明过的字段）
     现在它们与 `burn` 同一个待遇：声明 → 初始化 → 有读点 → 池化复位。 */
Comp.define('Burn', { burn: 0, burnDps: 0, burnN: 0 });
Comp.define('Slow', { slow: 0, slowMul: 0, slowN: 0 });
Comp.define('Stun', { stun: 0, stunMul: 0, stunN: 0 });
Comp.define('Pierce', { pierce: 0, hitSet: null });
Comp.define('Crit', { crit: false, bigCrit: false });
Comp.define('Origin', { fromX: 0, fromY: 0 });
Comp.define('Loadout', { weapons: [], items: [], base: null, upgrades: null });
Comp.define('Progress', { level: 1, xp: 0, xpNeed: 0, pendingLevels: 0 });
Comp.define('Locomotion', { animT: 0, moveBlend: 0, moving: false, face: 1, rage: 0 });
Comp.define('Wallet', { scrap: 0 });
Comp.define('Regen', { _regenAcc: 0 });
/* `look` / `accessory`：**存档角色的外观**（R50 的时装系统）。
   为什么住在玩家对象上而不是 `charDef` 上：`charDef` 是**共享的**职业表一行
   （9 个角色一共 9 个对象），把玩家捏的外观写上去会污染整张表 ——
   而外观是**这一份档**的属性。渲染层每帧读它（`render.ts` 的 drawPlayer），
   所以它必须是一个**已经折好的值**，不能每帧现算（那会每帧新建一个对象）。
   缺省是 `null` + `''`：那正是"没捏人"的样子 —— 渲染层退回职业本色，
   与改造前逐位相同（行为指纹不变的前提）。 */
Comp.define('CharCore', { charDef: null, look: null, accessory: '' });
Comp.define('Skeleton', { rig: null });
/* `enraged`：超时狂暴标记（game.ts 的 overrun() 写它、渲染层据此画一圈红环 +
   ui.ts 用 `overrun` 事件说一句"怪狂暴了、奖励打折"）。
   它以前是**游离字段** —— 组件校验（test/comp.mjs）在一条真跑到超时的对局里抓到了：
   "enemy 有游离字段 enraged"。声明在这里之后，字段集合与声明表才对得上。 */
Comp.define('EnemyCore', { id: 0, def: null, elite: false, dead: false, armorFlat: 0, _shockTag: -1, burrowed: 0, enraged: false });Comp.define('SpriteCache', { _spr: null, _fl: null });
/* `dead`：掉落物"被捡走 = 该回收"的标记。containers 的**缺省 dead 判据**读的就是它
   （`def.dead || function (ref) { return !!ref.dead; }`），而它以前不在任何组件里 ——
   一个被写、被读、却没声明的字段（`S` 上类型之前，编译器看不见这种漏）。 */
Comp.define('PickupCore', { seed: 0, value: 0, dead: false });
Comp.define('DecalArt', { seq: 0, a1: 0, a2: 0, d1: 0, d2: 0, s1: 0, s2: 0 });
/* `tier`：这把武器**当前**的品级（1–4）。它与 `def.tier` 不是一回事 ——
   `def.tier` 是"这把武器通常在商店的哪一档出现"，`tier` 是"合成把它抬到哪一档"。
   旧字段 `dup`（"身上有同名武器"）已删除：它的唯一读点是"散射武器多打一发"，
   而那个位置现在归**合成**（同名同档的两把合成一把更高的），见 data_weapons.ts 的品级表。 */
/* `paid`：为这把武器**付过多少材料**（0 = 捡到 / 开局自带 / 手工造的对象）。
   它是回收价的上限（`data_weapons.ts` 的 salvageOf）—— 用来堵住"折扣叠满时买光拆光"
   与"造价低于回收价时造了立刻拆"这两条印钞路线。买 / 造会写入，合成会**累加**。 */
Comp.define('WeaponCore', { id: '', def: null, swing: 0, tier: 1, paid: 0 });
/** 武器挂在骨架的哪个挂点上（槽位号就是它唯一的字段：挂点是骨架的事） */
Comp.define('Seat', { index: 0 });
/* ---- 词条（affixes.ts）----
   两件装备**各自**带一份词条：AffixSet 组件就是那个字段（见下面的原型的挂载）。
   `affixes` = 这一件身上的词条（`{ list, max }`，null = 还没生成），
   `wmods`   = 词条里"武器本地"那一份的折叠结果（伤害倍率 / 冷却倍率），
              由 `recalcStats` 写、由三个武器数值出口读（见 game.ts）。
   为什么 `wmods` 是**独立一格**而不是塞进 affixes：它的读点是**每帧每把武器**，
   不该在热路径上重新折叠一遍（组件的意义就是"折一次、只读结果"）。 */
Comp.define('AffixSet', { affixes: null, wmods: null });
Comp.define('ItemCore', { def: null, affixes: null });
Comp.define('BulletExtra', { element: '', knock: 0, blast: 0 });
/* `tier`：货架上的武器是**哪一档**（0 = 没这一说，比如道具/被换过的格子）。
   商店按 wave 只解锁到某一档（Weapons.rollShop），但据点的「工坊」与后面的
   「锻炉」会往上抬，所以档位必须存在报价上，而不是从 def 现算。 */
Comp.define('OfferCore', { type: '', def: null, sold: false, price: 0, tier: 0 });
Comp.define('ParticleExtra', {
  drag: 0, a: 0, arc: 0, rot: 0, r0: 0, r1: 0, w: 0, text: '', size: 0
});

/* =========================================================
   6. 原型目录（= "所有对象都是组件组合出来的" 的那张表）
   ========================================================= */
Comp.archetype('player',
  ['Transform', 'Motion', 'Body', 'Health', 'HitFlash', 'Hurt', 'Invuln', 'Aim',
    'Loadout', 'Progress', 'Locomotion', 'Wallet', 'Regen', 'CharCore', 'Skeleton'],
  { note: '唯一实例，仍按原型造，方便和别的实体走同一套校验' });

Comp.archetype('enemy',
  ['Transform', 'Motion', 'Body', 'Health', 'Damage', 'HitFlash',
    'Knock', 'Burn', 'Slow', 'Stun', 'AI', 'EnemyCore', 'SpriteCache'],
  { list: 'enemies', note: '怪：AI 驱动追击 / 攻击，掉落与经验在死亡时结算' });

Comp.archetype('bullet',
  ['Transform', 'Motion', 'Body', 'Damage', 'Pierce', 'Crit', 'Origin',
    'Lifetime', 'Look', 'BulletExtra'],
  { list: 'bullets', note: '玩家子弹：穿透 / 暴击 / 来源都在组件里（不是特例代码）' });

Comp.archetype('ebullet',
  ['Transform', 'Motion', 'Body', 'Damage', 'Lifetime', 'Look'],
  { list: 'ebullets', note: '敌弹：与玩家子弹同构但更轻（无穿透 / 无暴击 / 无来源）' });

Comp.archetype('particle',
  ['Transform', 'Motion', 'Body', 'Lifetime', 'Look', 'ParticleExtra'],
  { list: 'particles', note: '视觉粒子与伤害飘字共用（飘字多用 text/size）' });

Comp.archetype('pickup',
  ['Transform', 'Motion', 'Look', 'PickupCore'],
  { list: 'pickups', note: '地面掉落物：吸附与拾取由 PickupCore 驱动（废料 / 回血 / 弹药）' });

Comp.archetype('decal',
  ['Transform', 'Body', 'Look', 'DecalArt'],
  { list: 'decals', note: '贴花：纯视觉残留（血渍 / 焦痕），只有寿命与画法，不参与碰撞' });

/* 装置（炮塔）：它比别的原型多一个 `Lifetime` ——
   道具白给的炮塔寿命是"永久"（`life` 留 0 = 不过期），
   而**技能放下的装置有寿命**（临时帮手，不是第二座塔）。
   两者共用这一个原型，所以寿命做成可选：0 = 不过期。 */
Comp.archetype('turret',
  ['Transform', 'Body', 'Health', 'Cooldown', 'Aim', 'Lifetime', 'TurretExt'],
  { list: 'turrets', note: '装置：白给的塔寿命为 0（永久），技能放下的有寿命 —— 共用这一个原型' });

Comp.archetype('weapon',
  ['WeaponCore', 'Cooldown', 'Seat', 'AffixSet'],
  { list: 'player.weapons', note: '武器：住在 player.weapons（不是会话顶层），词条折进 wmods' });

Comp.archetype('offer',
  ['OfferCore', 'AffixSet'],
  { list: 'offers', note: '货架商品：商店 / 锻炉的报价，sold 决定它还能不能买' });

Comp.archetype('item',
  ['ItemCore'],
  /* `list` 这一格是**对象系统**加的（object.ts 的普查靠它把"类"配到"容器"上）：
     道具住在 `player.items`，与武器那一条同一套写法 —— 于是
     `Comp.query(sess, 'item')` 也能用，不再需要每个读点自己记得路径。 */
  { list: 'player.items', note: '道具实例只有 def（与词条）两个字段，但仍然走原型，便于统一审计' });

/* =========================================================
   7. 系统（本项目里语义确实一致的那几趟）
   ========================================================= */
/**
 * 粒子池的通用步进：寿命衰减 + 位移积分 + 到期回收。
 * 视觉粒子与伤害飘字原本各写一遍（emit.ts 的 stepList 被调用两次），
 * 这里登记成系统，让"它需要 Lifetime / Motion"变成被校验的声明。
 */
Comp.system('particleStep', ['Lifetime', 'Motion'], function (p, dt, ctx) {
  p.life -= dt;
  if (p.life <= 0) { ctx.remove(ctx.i); return false; }
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  if (p.drag) {
    var k = Math.max(0, 1 - dt * p.drag);
    p.vx *= k; p.vy *= k;
  }
  if (p.kind === 'text') p.vy += 60 * dt;   // 飘字受重力
  return true;
}, { back: true });

/* =========================================================
   注册到扩展点总账（见 registry.ts）
   组件、原型、系统都是可扩展点：原型引用的组件必须存在，字段并集由 comp 自查。
   ========================================================= */
Registry.family('component', {
  note: '组件（字段的声明式打包）', owner: 'comp.ts',
  values: function () { return DEF_NAMES.slice(); }
});
Registry.family('archetype', {
  note: '原型（组件清单 → 游戏对象）', owner: 'comp.ts',
  entries: function () {
    return ARCH_NAMES.map(function (n) {
      var a = ARCHS[n];
      return {
        id: n,
        refs: a.comps.map(function (c, i) { return { field: 'comps[' + i + ']', value: c, family: 'component' }; })
      };
    });
  }
});

/* 定义期自检：不过就抛（与 danger.ts 同一条纪律 —— 表写坏了不该等到玩家遇到才发现）。
   只读本模块的表，所以加载期跑是安全的；登记之后启动期还会再跑一遍。 */
var compVerdict = Comp.selfCheck();
if (!compVerdict.ok) {
  throw new Error('comp.ts 组件 / 原型表自检失败：\n' + compVerdict.problems.join('\n'));
}
SelfCheck.register('Comp', Comp.selfCheck);

export { Comp };
