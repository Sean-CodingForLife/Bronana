/* =========================================================
   input.mjs — 输入层：键盘 / 手柄 / 触摸三条来源，一个向量

   为什么单独一个套件：input.ts 以前完全没有测试，而它是"玩家和游戏之间
   唯一的那条线"。补手柄与触摸时最危险的不是"读不到摇杆"，而是
   **插着一个不动的手柄会把键盘按住的键每帧清成"松开"**，
   以及**鼠标拖拽被当成触摸把角色拖走** —— 这两条都在下面守着。

   用法： node test/input.mjs
   ========================================================= */
import { loadAll } from './_load.mjs';

let failures = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  \x1b[32mPASS\x1b[0m ' + label);
  else { failures++; console.log('  \x1b[31mFAIL\x1b[0m ' + label + (extra !== undefined ? '  → ' + extra : '')); }
}

/* =========================================================
   DOM 桩（必须在 loadAll 之前装好）
   input.ts 在模块顶层就探测 window / document，所以顺序不能反。
   ========================================================= */
const winHandlers = {};
const docHandlers = {};
const canvasHandlers = {};
const stickEl = { id: 'touch-stick', style: {} };
const knobEl = { id: 'touch-knob', style: {} };
let pads = [];

globalThis.window = {
  addEventListener(t, f) { (winHandlers[t] = winHandlers[t] || []).push(f); }
};
globalThis.document = {
  getElementById(id) {
    if (id === 'touch-stick') return stickEl;
    if (id === 'touch-knob') return knobEl;
    return null;
  },
  addEventListener(t, f) { (docHandlers[t] = docHandlers[t] || []).push(f); },
  hidden: false
};
// Node 24 的 globalThis.navigator 只有 getter，直接赋值会抛 TypeError
Object.defineProperty(globalThis, 'navigator', {
  value: { getGamepads: () => pads }, configurable: true, writable: true
});
const canvas = {
  addEventListener(t, f) { (canvasHandlers[t] = canvasHandlers[t] || []).push(f); }
};

await loadAll(['input']);
const { Input } = globalThis;
Input.init(canvas);

console.log('\n=== Bronana · 输入层（键鼠 / 手柄 / 触摸） ===\n');

/** 造一个"标准布局"的手柄：pressedIdx 那个按钮按下，左摇杆为 stick */
function mkPad(pressedIdx, stick) {
  const buttons = [];
  for (let i = 0; i < 16; i++) buttons.push({ pressed: i === pressedIdx, value: i === pressedIdx ? 1 : 0 });
  return { connected: true, id: 'Test Pad', buttons, axes: stick || [0, 0] };
}
function fire(type, ev) { (canvasHandlers[type] || []).forEach(f => f(ev)); }
function touch(type, id, x, y) {
  fire(type, { pointerType: 'touch', pointerId: id, clientX: x, clientY: y, target: canvas, preventDefault() { } });
}
function mouse(type, id, x, y) {
  fire(type, { pointerType: 'mouse', pointerId: id, clientX: x, clientY: y, target: canvas, preventDefault() { } });
}
function resetKeys() { Input.keys = Object.create(null); }

/* ---------------- 键盘 ---------------- */
console.log('[1] 键盘');
{
  resetKeys();
  Input.keys['d'] = true;
  let v = Input.moveVec();
  ok(v.x === 1 && v.y === 0 && v.len === 1, 'D → 向右的单位向量', JSON.stringify(v));

  resetKeys();
  Input.keys['w'] = true; Input.keys['d'] = true;
  v = Input.moveVec();
  ok(Math.abs(v.x - Math.SQRT1_2) < 1e-9 && Math.abs(v.y + Math.SQRT1_2) < 1e-9,
    '右上是对角的单位向量（不是 (1,1)，否则斜着走更快）', JSON.stringify(v));

  resetKeys();
  Input.keys['shift'] = true;
  Input.moveVec();
  ok(Input.isSlow() === true, 'Shift = 慢走');
  resetKeys();
  Input.moveVec();
  ok(Input.isSlow() === false, '松开 Shift 恢复');
}

/* ---------------- 手柄：按钮 → 虚拟键 ---------------- */
console.log('\n[2] 手柄：按钮映射与边沿检测');
{
  resetKeys();
  pads = [mkPad(0, [0, 0])];
  ok(Input.poll() === true, '检测到手柄');
  ok(Input.down('enter') === true, '手柄 A → enter 按下');
  ok(Input.once('enter') === true, '第一次读 once 拿到边沿');
  ok(Input.once('enter') === false, '同一帧再读就没有了（边沿只报一次）');

  Input.poll();
  ok(Input.once('enter') === false, '按住不放不会每帧重复触发');

  padRelease();
  function padRelease() { pads = [mkPad(-1, [0, 0])]; }
  Input.poll();
  ok(Input.down('enter') === false, '松开后不再是按下状态');

  pads = [mkPad(9, [0, 0])]; Input.poll();
  ok(Input.once('esc') === true, '手柄 Start → esc（暂停）');

  pads = [mkPad(1, [0, 0])]; Input.poll();
  ok(Input.once('esc') === true, '手柄 B → esc（返回）');

  pads = [mkPad(14, [0, 0])]; Input.poll();
  ok(Input.down('arrowleft') === true, '手柄十字键左 → arrowleft（菜单焦点用得上）');

  pads = [mkPad(0, [0, 0])]; Input.poll(); Input.endFrame();
  ok(Input.once('enter') === false, 'endFrame 清掉手柄的边沿标记');
}

/* ---------------- 回归：手柄不得清掉键盘 ---------------- */
console.log('\n[3] 回归：插着一个不动的手柄，不能把键盘的按键清掉');
{
  resetKeys();
  Input.keys['enter'] = true;
  pads = [mkPad(-1, [0, 0])];       // 手柄连着，但没有任何按钮按下
  Input.poll();
  ok(Input.down('enter') === true,
    '键盘按住回车 + 手柄闲置 → 仍然是按下（旧写法共用一张键位表，会被每帧清成松开）');
  resetKeys();
  Input.poll();
}

/* ---------------- 手柄：左摇杆 ---------------- */
console.log('\n[4] 手柄：左摇杆与死区');
{
  resetKeys();
  pads = [mkPad(-1, [0.8, 0.6])];
  Input.poll();
  let v = Input.moveVec();
  ok(Math.abs(v.x - 0.8) < 1e-9 && Math.abs(v.y - 0.6) < 1e-9,
    '摇杆方向与推杆方向一致', JSON.stringify(v));
  ok(Math.abs(Math.sqrt(v.x * v.x + v.y * v.y) - 1) < 1e-9,
    '推杆幅度不进模拟层：与键盘一样是单位向量', Math.sqrt(v.x * v.x + v.y * v.y));

  pads = [mkPad(-1, [0.1, 0.08])];
  Input.poll();
  ok(Input._pad.active === false, '死区内的漂移不当作输入');
  ok(Input.moveVec().len === 0, '死区内不移动');
}

/* ---------------- 优先级：键盘 > 手柄 ---------------- */
console.log('\n[5] 优先级：键盘 > 手柄 > 触摸');
{
  resetKeys();
  pads = [mkPad(-1, [1, 0])];       // 手柄推向右
  Input.poll();
  Input.keys['a'] = true;           // 键盘按左
  const v = Input.moveVec();
  ok(v.x === -1 && v.y === 0, '两处同时有输入时以键盘为准', JSON.stringify(v));
  resetKeys();
  pads = [mkPad(-1, [0, 0])];
  Input.poll();
}

/* ---------------- 触摸：浮动摇杆 ---------------- */
console.log('\n[6] 触摸：浮动摇杆');
{
  resetKeys();
  touch('pointerdown', 1, 100, 100);
  ok(stickEl.style.display === 'block', '按下即显示摇杆（在按下的位置）');
  ok(stickEl.style.left === '100px' && stickEl.style.top === '100px',
    '摇杆圆心就是按下点', stickEl.style.left + ',' + stickEl.style.top);
  ok(Input.moveVec().len === 0, '只按下还没拖动 → 不移动');

  touch('pointermove', 1, 100, 140);
  let v = Input.moveVec();
  ok(v.x === 0 && v.y === 1 && v.len === 1, '向下拖 → 向下移动', JSON.stringify(v));

  touch('pointermove', 1, 60, 100);
  v = Input.moveVec();
  ok(v.x === -1 && v.y === 0, '改成向左拖 → 立刻改向左（方向是每帧重算的）', JSON.stringify(v));

  touch('pointerup', 1, 60, 100);
  ok(Input.moveVec().len === 0, '抬手即停');
  ok(stickEl.style.display === 'none', '抬手后摇杆隐藏');
}

/* ---------------- 回归：鼠标拖拽不算触摸 ---------------- */
console.log('\n[7] 回归：鼠标拖拽不能把角色拖走');
{
  resetKeys();
  mouse('pointerdown', 2, 10, 10);
  mouse('pointermove', 2, 90, 90);
  ok(Input.moveVec().len === 0, '鼠标拖动不产生移动（触摸才算）',
    JSON.stringify(Input.moveVec()));
  ok(Input._touch.id === -1, '鼠标不会被记成触摸指针', Input._touch.id);
}

/* ---------------- 安全降级 ---------------- */
console.log('\n[8] 边界');
{
  resetKeys();
  pads = [];
  ok(Input.poll() === false, '没有手柄时 poll 返回 false（而不是抛错）');
  ok(Input.moveVec().len === 0, '什么输入都没有时是零向量');
  ok(Input.padInfo().connected === false, 'padInfo 报告未连接');

  // 触摸中途掉帧/丢指针：pointercancel 也要收尾
  touch('pointerdown', 7, 200, 200);
  touch('pointermove', 7, 240, 200);
  ok(Input.moveVec().len === 1, '拖动中确实有输入');
  touch('pointercancel', 7, 240, 200);
  ok(Input.moveVec().len === 0, 'pointercancel 也能收尾（否则角色会一直朝一个方向走）');
  ok(stickEl.style.display === 'none', 'pointercancel 后摇杆隐藏');
}

/* ---------------- 改键 ---------------- */
console.log('\n[9] 改键（设置 → 输入层）');
{
  function fireKey(key) {
    (winHandlers.keydown || []).forEach(f => f({ key, preventDefault() { } }));
  }

  resetKeys();
  // 默认：WASD
  Input.keys['w'] = true;
  ok(Input.moveVec().y === -1, '默认 W 向上');
  resetKeys();

  Input.setBind('keyUp', 'i');
  Input.keys['i'] = true;
  ok(Input.moveVec().y === -1, '改键后 I 向上');
  resetKeys();
  Input.keys['w'] = true;
  ok(Input.moveVec().len === 0, '改键后原来的 W 不再响应（是替换，不是追加）');
  resetKeys();

  // 方向键永远额外有效：改键不会把自己改到不能动
  Input.keys['arrowup'] = true;
  ok(Input.moveVec().y === -1, '方向键始终有效（改键不会把人锁死）');
  resetKeys();

  // 捕获：正在等一个键时，这个键不能同时变成游戏输入
  let captured = '未回调';
  Input.captureNext(k => { captured = k; });
  ok(Input.capturing() === true, '进入捕获状态');
  Input.keys = Object.create(null);
  fireKey('k');
  ok(captured === 'k', '捕获到按下的键', captured);
  ok(!Input.keys['k'], '捕获用的那次按键没有写进键位表（否则改"上"时角色会先走一步）');
  ok(Input.capturing() === false, '捕获一次后自动退出');

  // Esc 取消
  let cancelled = '未回调';
  Input.captureNext(k => { cancelled = k; });
  fireKey('Escape');
  ok(cancelled === null, 'Esc 取消改键（回调收到 null）', String(cancelled));

  // 恢复默认，避免影响后面的断言
  Input.setBind('keyUp', 'w');
  Input.setBind('keyDown', 's');
  Input.setBind('keyLeft', 'a');
  Input.setBind('keyRight', 'd');
  Input.setBind('keyPause', 'p');
  resetKeys();
}

/* ---------------- 设置默认值 ↔ 输入层默认值 ---------------- */
console.log('\n[10] 默认键位与设置表必须一致');
{
  const { Settings } = globalThis;
  let loaded = true;
  try { await loadAll(['settings']); } catch (e) { loaded = false; }
  ok(loaded, '设置模块可加载');
  const pairs = [['keyUp', 'up'], ['keyDown', 'down'], ['keyLeft', 'left'], ['keyRight', 'right'], ['keyPause', 'pause']];
  const bad = pairs.filter(([sk, bk]) => Settings && Settings.def(sk).def !== Input.bind[bk]);
  ok(bad.length === 0,
    '五条默认键位与 settings 表一致（两处写死，迟早会漂）',
    bad.map(([sk, bk]) => sk + '=' + Settings.def(sk).def + ' vs ' + Input.bind[bk]).join(', '));
}

/* ---------------- 回归：设备"消失"必须清掉它留下的按住态 ----------------
   这一组守的是一个真踩到的洞：`_padKeys` / `_touch` 只在"设备还在"的帧里被重写，
   设备没了（拔线、休眠、切标签丢掉 pointer capture）就永远停在最后一帧的"按住" ——
   表现是**人物朝一个方向永久走**，键盘怎么按都清不掉（键盘清的是另一张表）。 */
console.log('\n[11] 回归：手柄拔掉 / 窗口失焦之后不许留下"按住"');
{
  function fireWin(type) { (winHandlers[type] || []).forEach(f => f({})); }
  function fireDoc(type) { (docHandlers[type] || []).forEach(f => f({})); }

  // (a) 按住 dpad-left 时把柄拔掉
  resetKeys();
  pads = [mkPad(14, [0, 0])];
  Input.poll();
  ok(Input.down('arrowleft') === true, '按住十字键左：确实在按下状态');
  pads = [];                                  // 拔掉（USB / 休眠 / 浏览器返回 null 都一样）
  Input.poll();
  const v = Input.moveVec();
  ok(v.len === 0 && v.x === 0 && v.y === 0,
    '柄没了之后方向归零（以前会永远停在这一格）', JSON.stringify(v));
  ok(Input.down('arrowleft') === false, '那次"按住"没有留在手柄键位表里');
  ok(Input.padInfo().connected === false, 'padInfo 报告未连接');

  // (b) gamepaddisconnected 这一瞬间就要清（不能等下一帧轮询）
  resetKeys();
  pads = [mkPad(14, [0, 0])];
  Input.poll();
  fireWin('gamepaddisconnected');
  ok(Input.down('arrowleft') === false, '收到断开事件立刻清掉手柄键位');
  pads = [];

  // (c) 拖动触摸摇杆时窗口失焦：失焦会丢 pointer capture，浏览器不一定补 pointercancel
  resetKeys();
  touch('pointerdown', 11, 300, 300);
  touch('pointermove', 11, 260, 300);
  ok(Input.moveVec().len === 1, '拖动中确实有输入');
  fireWin('blur');
  ok(Input.moveVec().len === 0, '失焦后触摸摇杆归零（以前角色会一直朝那个方向走）');
  ok(Input._touch.id === -1, '失焦后释放了触摸指针（否则新手指出不了摇杆）', Input._touch.id);
  ok(stickEl.style.display === 'none', '失焦后摇杆隐藏');
  touch('pointerdown', 12, 400, 400);
  touch('pointermove', 12, 400, 360);
  ok(Input.moveVec().y === -1, '失焦后新的手指仍然能操作摇杆（指针没被锁死）');
  touch('pointerup', 12, 400, 360);
  ok(Input.moveVec().len === 0, '收尾干净');

  // (d) 页面被隐藏（切标签 / 锁屏）走的是另一条事件，同样要清
  touch('pointerdown', 13, 300, 300);
  touch('pointermove', 13, 340, 300);
  globalThis.document.hidden = true;
  fireDoc('visibilitychange');
  ok(Input.moveVec().len === 0, 'visibilitychange → hidden 也清掉摇杆（不一定先触发 blur）');
  ok(Input._touch.id === -1, '指针同样被释放');
  globalThis.document.hidden = false;
  resetKeys();
}

console.log('\n=== 结果 ===');
if (failures === 0) { console.log('\x1b[32m全部通过 ✔\x1b[0m\n'); process.exit(0); }
console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m\n');
process.exit(1);
