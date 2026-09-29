/* =========================================================
   diag.ts — 诊断面板的内容聚合（引擎里的 debug overlay / inspector）
   ---------------------------------------------------------
   这几个月做出来的东西大半是"看不见的系统"：扩展点总账、容器账目、深度层带、
   缓存与烘焙预算、帧预算。它们各自有 `describe()`，但没人在游戏里看得到。
   这里只做一件事：把那些报告拼成一段纯文本，交给 UI 显示。

   刻意只返回**字符串**：面板不参与任何模拟或渲染决策，
   所以它在无头环境里也能被测试（`Diag.text()` 直接断言内容），
   而且不会成为"调试代码渗进玩法"的入口。
   ========================================================= */

import { Containers } from './containers.ts';
import { Depth } from './depth.ts';
import { Game } from './game.ts';
import { Registry } from './registry.ts';
import { S } from './sprites.ts';
import { Perf } from './utils.ts';

var Diag = {} as DiagApi;

/** 一帧预算（与 perf/render 测试口径一致） */
var BUDGET_MS = 16.6;

function pad(s, n) { return String(s).length >= n ? String(s) : String(s) + new Array(n - String(s).length + 1).join(' '); }

/** 顶上一行：状态 / 波次 / 帧率 / 帧耗时 */
Diag.header = function () {
  var s = Game.getSession();
  var st = Game.state;
  if (!s) return '状态 ' + st + '（没有会话）';
  return '状态 ' + pad(st, 8) + '波次 ' + pad(Game.wave, 3) +
    '等级 ' + pad(s.player.level, 3) + '生命 ' + Math.ceil(s.player.hp) + '/' + s.stats.maxHp;
};

/** 帧预算：模拟步耗时 / 绘制调用 / 帧率（有就报，没有就 --） */
Diag.frame = function () {
  var pf = Perf;
  var fps = pf && pf.fps ? pf.fps.toFixed(0) : '--';
  var ms = pf && pf.ms ? pf.ms.toFixed(2) : '--';
  var sess = Game.getSession();
  var counts = sess ? (sess.enemies.length + ' 怪 / ' + (sess.bullets.length + sess.ebullets.length) + ' 弹') : '';
  return '帧  FPS ' + pad(fps, 4) + '帧耗时 ' + pad(ms, 6) + 'ms  ' + counts + '  预算 ' + BUDGET_MS + 'ms';
};

/** 实体与容器：直接复用容器总账的账目（一行一个非空容器） */
Diag.containers = function () {
  var s = Game.getSession();
  if (!s) return '容器  （无会话）';
  var st = Containers.stats(s);
  var parts = [];
  var names = Containers.names();
  for (var i = 0; i < names.length; i++) {
    var n = names[i];
    if (!st[n] || st[n].len === 0) continue;
    parts.push(n + ' ' + st[n].len + '/' + (st[n].cap === Infinity ? '∞' : st[n].cap));
  }
  return '容器  ' + (parts.length ? parts.join('  ') : '空');
};

/** 深度：层带分布（复用深度总账） */
Diag.depth = function () {
  var st = Depth.stats();
  if (!st.pushed) return '深度  本帧无入队';
  var parts = [];
  for (var b in st.bands) parts.push(b + ' ' + st.bands[b]);
  return '深度  队列 ' + st.pushed + '  槽位 ' + st.slots + '  ' + parts.join('  ');
};

/** 扩展点总账：家族数 + 审计结论 */
Diag.registry = function () {
  var a = Registry.audit();
  return '总账  ' + Registry.names().length + ' 个家族' +
    (a.ok ? '  审计通过' : '  ✗ ' + (a.problems.length + a.missing.length) + ' 处断链');
};

/** 缓存与烘焙预算 */
Diag.cache = function () {
  var c = S.cacheStats();
  var out = '贴图  ' + c.entries + ' 条  ' + (c.bytes / 1048576).toFixed(2) + 'MB  倍率 ' + c.scale;
  return out;
};

/** 汇总：面板就显示这几行 */
Diag.lines = function () {
  return [Diag.header(), Diag.frame(), Diag.containers(), Diag.depth(), Diag.registry(), Diag.cache()];
};

Diag.text = function () { return Diag.lines().join('\n'); };

/** 体检报告（按 ?diag=2 展开）：把三份 describe() 全放出来 */
Diag.full = function () {
  var s = Game.getSession();
  var out = Diag.lines().slice();
  out.push('');
  out.push(s ? Containers.describe(s) : '（无会话）');
  out.push('');
  out.push(Depth.describe());
  out.push('');
  out.push(Registry.describe());
  return out.join('\n');
};

export { Diag };
