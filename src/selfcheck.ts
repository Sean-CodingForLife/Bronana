/* =========================================================
   selfcheck.ts — 启动期自检的**唯一入口**（把"审计"从测试期搬到启动期）
   ---------------------------------------------------------
   问题（改造前）：12 个模块都写了 `audit()`，但**只有 scene.ts 会抛**。
   其余 9 个在模块加载时被调用、返回值直接丢掉 —— 于是：
     · 一张表写错了（某个效果键没人读、某个 id 指向不存在的条目），
       程序照样能起来，只是**某条效果悄悄不生效**；
     · 唯一的发现途径是"有人跑测试"。护栏存在，但不在必经之路上。
   这不叫系统，叫纪律。所以这里把它变成门：

     · 各模块**注册**自己的自检（`SelfCheck.register('dungeon', Dungeon.audit)`），
       而不是自己算完丢掉 —— 注册是声明，跑不跑由启动流程决定
     · `SelfCheck.run()` 一次跑完：先各模块自己的表，最后是总账的跨表引用
       （家族是各模块宣布的，所以它必须最后跑）
     · 任何一条不过 → **抛一个把全部问题列全的错误**，而不是抛第一条
       （一次看到所有错，比改一条跑一次快得多）
     · 浏览器入口（main.ts）与命令行入口（cli.ts）都调它；浏览器里失败会画一张
       **能读的失败页**，而不是白屏

   刻意不做的事：不做运行期周期自检（表是静态的，每帧查一遍纯属浪费），
   也不做"发现问题就降级继续跑"（半坏的表比坏掉更难查）。
   ========================================================= */
import { Registry } from './registry.ts';

var SelfCheck = {} as SelfCheckApi;

var CHECKS: Array<{ name: string; fn: () => { ok: boolean; problems: string[] } }> = [];
var NAMES: Record<string, boolean> = Object.create(null);
/* 内置的最后一项：总账的跨表引用（家族是各模块宣布的，所以它必须最后跑）。
   名字占用 'registry'，模块不能再用它注册 —— 免得"到底谁查的跨表引用"含糊。 */
var BUILTIN = ['registry'];

/**
 * 注册一个启动期自检。
 * @param name 模块名（报告里指路用）
 * @param fn   返回 `{ ok, problems }` 的函数（就是各模块的 `audit` / `validate`）
 */
SelfCheck.register = function (name, fn) {
  if (!name || typeof fn !== 'function') throw new Error('selfcheck: register 需要 (名字, 函数)');
  if (NAMES[name] || BUILTIN.indexOf(name) >= 0) throw new Error('selfcheck: 自检名重复或占用了内置名 ' + name);
  NAMES[name] = true;
  CHECKS.push({ name: name, fn: fn });
  return SelfCheck;
};

/** 全部自检名（登记的 + 内置的 `registry`）—— 测试用它验"有 audit 的模块都登记了" */
SelfCheck.names = function () {
  return CHECKS.map(function (c) { return c.name; }).concat(BUILTIN);
};

/**
 * 跑完全部自检。
 *
 * `opts.registry` 决定总账那一项怎么查 —— 这个开关是**必要的**，不是妥协：
 * 跨表引用里有一大批是指向**渲染层家族**的（怪物造型 / 道具图标 / 武器造型，
 * 它们由 sprites.ts 注册）。命令行入口是"只有模拟层"的构建，那些家族根本没加载，
 * 全量查会报 147 条假警报（实测过）。所以：
 *   · `'full'`（默认，浏览器与测试用）：未注册的家族也算问题
 *   · `'partial'`（只有模拟层的入口用）：只查"目标家族已注册但值不在里面"，
 *     漏掉目标家族**不代表**写错了，只代表那个模块没被加载
 *   · `'off'`：完全不查
 * @returns `{ ok, problems, ran }`（**不抛**，方便调用方自己决定怎么报）
 */
SelfCheck.scan = function (opts) {
  var mode = (opts && opts.registry) || 'full';
  var problems: string[] = [];
  var ran: string[] = [];
  for (var i = 0; i < CHECKS.length; i++) {
    var c = CHECKS[i];
    ran.push(c.name);
    var r = null;
    try {
      r = c.fn();
    } catch (e) {
      problems.push(c.name + '：自检本身抛了异常 —— ' + ((e && e.message) || e));
      continue;
    }
    if (!r || r.ok) continue;
    var list = r.problems || [];
    for (var j = 0; j < list.length; j++) problems.push(c.name + '：' + list[j]);
  }
  // 总账的跨表引用**最后**查：家族是各模块在加载时宣布的，顺序不能反
  if (mode !== 'off') {
    ran.push('registry');
    try {
      var a = Registry.audit();
      if (mode === 'full') {
        for (var m = 0; m < a.missing.length; m++) {
          problems.push('registry：引用了未注册的家族 ' + a.missing[m] + '（那个模块没被加载，或者名字写错了）');
        }
      }
      for (var p = 0; p < a.problems.length; p++) {
        var x = a.problems[p];
        problems.push('registry：' + x.family + '.' + x.id + '.' + x.field + ' = ' + x.value +
          ' 不在 ' + x.target + ' 里（' + x.reason + '）');
      }
    } catch (e) {
      problems.push('registry：自检本身抛了异常 —— ' + ((e && e.message) || e));
    }
  }
  return { ok: problems.length === 0, problems: problems, ran: ran };
};

/**
 * 启动期把门：不过就抛（**一次列全**，不是抛第一条）。
 * @param opts 见 `scan()`；浏览器入口用默认（全量），只有模拟层的入口传 `partial`
 * @returns 跑过的自检名
 */
SelfCheck.run = function (opts) {
  var r = SelfCheck.scan(opts);
  if (!r.ok) {
    throw new Error('定义期自检未通过（' + r.problems.length + ' 条）：\n  - ' + r.problems.join('\n  - '));
  }
  return r.ran;
};

export { SelfCheck };
