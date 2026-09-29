/* =========================================================
   crash.ts — **运行时错误兜底**（跑着跑着出意外时玩家看到什么）
   ---------------------------------------------------------
   与"启动自检失败页"是两件事，所以是两个东西：
     · 启动自检失败 = **代码里的表错了**，开发期就该拦下，提示语是给开发者的
     · 运行时错误   = **跑着跑着出了意外**，提示语是给玩家的
   混成一张卡会让"表错了"看起来像"偶发崩溃"，两边都读不懂。

   三条纪律：
     · **只报一次**：同一个错误连环抛（每帧一次）时不要刷屏、不要叠一摞卡片
     · **不吞掉它**：仍然 `console.error` 打出完整栈，开发期要看得见
     · 给**可行动的**信息：哪一局哪一波、触发点、以及"刷新即可恢复"
       —— "游戏崩了"这句话对排查毫无用处

   它住在表现层（`view`）：只读会话状态用来写提示语，不改任何东西。
   无 DOM 环境（无头测试 / CLI）下自动降级成"只记 console"。
   ========================================================= */
import { Game } from './game.ts';

var Crash = {} as CrashApi;

Crash.shown = false;
/** 接了几个全局错误源（`hookedOnce` 保证只接一次：重复接会让同一错误走两遍） */
Crash.hooked = false;
Crash.count = 0;
Crash.last = '';

/** 组装提示语（**纯函数**：测试直接比字符串，不必碰 DOM） */
Crash.describe = function (err, from) {
  var msg = String((err && (err.stack || err.message)) || err || '（没有错误信息）');
  if (msg.length > 1200) msg = msg.slice(0, 1200) + '…';
  var where = '（会话不可读）';
  try {
    var sess = Game.getSession();
    where = '波次 ' + Game.wave + ' · 状态 ' + Game.state +
      (sess ? ' · 角色 ' + sess.charDef.id + ' · 层 ' + sess.floor : ' · 还没有开局');
  } catch (e) { /* 连状态都读不到：保留上面那句兜底 */ }
  return 'Bronana 出了点意外（这一局可能已经不可靠了）。\n\n' +
    where + '\n触发点：' + from + '\n\n' + msg +
    '\n\n刷新页面即可继续（存档里的一局会从最近一个商店恢复）。' +
    '\n如果反复出现，请把上面这段信息报上来 —— 它比"游戏崩了"有用得多。';
};

/**
 * 报一次运行时错误。
 * @returns 是否**新**弹了一张卡（已经弹过就返回 false —— 调用方据此不重复处理）
 */
Crash.report = function (err, from) {
  Crash.count++;
  Crash.last = String((err && (err.message || err)) || '') .slice(0, 200);
  try { console.error('[Bronana] 运行时错误（' + (from || '?') + '）', err); } catch (e) { }
  if (Crash.shown) return false;
  Crash.shown = true;
  try {
    if (typeof document === 'undefined' || !document.body) return false;
    var box = document.createElement('div');
    box.id = 'crash-fail';
    box.setAttribute('style',
      'position:fixed;left:0;right:0;bottom:0;max-height:46vh;overflow:auto;z-index:99998;' +
      'background:rgba(16,13,12,0.94);color:#f2e6c8;border-top:3px solid #e2564f;' +
      'font:12px/1.6 ui-monospace,Consolas,monospace;padding:14px 18px;white-space:pre-wrap');
    box.textContent = Crash.describe(err, from || '?');
    document.body.appendChild(box);
  } catch (e) { /* 连兜底都失败：console 那条已经发出去了 */ }
  return true;
};

/** 接上两个全局错误源。只接一次；无 window（无头 / CLI）时什么都不做 */
Crash.hook = function (win) {
  var w = win || (typeof window !== 'undefined' ? window : null);
  if (Crash.hooked || !w || !w.addEventListener) return false;
  Crash.hooked = true;
  w.addEventListener('error', function (ev) {
    Crash.report(ev && (ev.error || ev.message), 'window.error');
  });
  w.addEventListener('unhandledrejection', function (ev) {
    Crash.report(ev && ev.reason, 'unhandledrejection');
  });
  return true;
};

/** 复位"只报一次"的门（测试用；也方便调试时手动再看一次） */
Crash.reset = function () {
  Crash.shown = false; Crash.count = 0; Crash.last = '';
  return true;
};

export { Crash };
