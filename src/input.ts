/* =========================================================
   input.ts — 键鼠 + 手柄 + 触摸（八向移动 + 快捷键）

   无 DOM 时自动降级（无头测试可安全加载）。

   三个来源最终都汇成**同一个东西**：一个归一化的方向向量，
   外加"虚拟按键"（按钮被翻译成键名）。于是上层的热键分发与
   `moveVec()` 完全不需要知道玩家用的是键盘、手柄还是手指 ——
   换输入设备只是换来源，不是加一套分支。

   为什么手柄是轮询：Gamepad API 没有按键事件（只有 connect/disconnect），
   "按下的那一瞬间"必须每帧比对上一帧状态自己算出来。

   为什么摇杆是"浮动"的：拇指落点因人而异，固定位置的摇杆在手机上
   永远不对。按下处即圆心，拖动方向即方向，抬起即停。
   ========================================================= */
var hasDOM = (typeof window !== 'undefined') && typeof document !== 'undefined';

var Input = ({
  keys: Object.create(null),
  pressedOnce: Object.create(null),
  mouse: { x: 0, y: 0, down: false, rd: false, wheel: 0 },
  _slow: false,
  _pad: { x: 0, y: 0, active: false, connected: false, id: '' },
  _touch: { x: 0, y: 0, active: false, ox: 0, oy: 0, id: -1 },
  // 可改的键位（默认值与 settings.ts 的默认值必须一致，测试会核对）
  bind: { up: 'w', down: 's', left: 'a', right: 'd', pause: 'p' }
} as InputApi);

/* =========================================================
   0. 改键
   ========================================================= */
var _capture: ((key: string | null) => void) | null = null;

/** 请求"下一个按下的键"。回调收到键名，按 Esc 取消时收到 null。 */
Input.captureNext = function (cb) { _capture = cb; };
Input.capturing = function () { return !!_capture; };
Input.cancelCapture = function () { _capture = null; };

/** 设置项名 → Input.bind 的字段名。用表而不是 if 链：加一条可改键位只改这里一行 */
var BIND_FIELD: Record<string, string> = {
  keyUp: 'up', keyDown: 'down', keyLeft: 'left', keyRight: 'right', keyPause: 'pause'
};

/** 把绑定应用到 Input（settings → 行为 的唯一去处是调用方，这里只接收值） */
Input.setBind = function (key, value) {
  var f = BIND_FIELD[key];
  if (!f) return false;
  Input.bind[f] = value;
  return true;
};
Input.bindFields = function () { return BIND_FIELD; };

/* =========================================================
   1. 手柄
   ========================================================= */
/** 标准布局的按钮 → 虚拟键名。没列出的按钮不映射（上层也就看不见它） */
var PAD_BUTTONS: Record<number, string> = {
  0: 'enter',        // A / ✕
  1: 'esc',          // B / ○
  2: 'x',            // X / □（未占用）
  3: 'y',            // Y / △（未占用）
  9: 'esc',          // Start
  12: 'arrowup', 13: 'arrowdown', 14: 'arrowleft', 15: 'arrowright'
};
var PAD_DEAD = 0.3;

/** 手柄的键位单独存一份：与真实键盘共用同一个槽位会互相清掉
    （插着一个不动的柄，每帧都会把键盘按住的键写成"松开"） */
var _padKeys: Record<string, boolean> = Object.create(null);
var _padOnce: Record<string, boolean> = Object.create(null);
var _padPrev: boolean[] = [];
/** 上一帧有没有"手柄按住的键"。只在**从有到无**时清一次，避免每帧分配两个对象 */
var _padHeld = false;

function firstPad() {
  if (!hasDOM) return null;
  var n: any = (typeof navigator !== 'undefined') ? navigator : null;
  if (!n || typeof n.getGamepads !== 'function') return null;
  var list;
  try { list = n.getGamepads(); } catch (e) { return null; }
  if (!list) return null;
  for (var i = 0; i < list.length; i++) {
    if (list[i] && list[i].connected) return list[i];
  }
  return null;
}

/**
 * 丢掉手柄留下的"按住"状态。
 *
 * 为什么必须有这件事：`_padKeys` 只在**有柄的那一帧**被逐键重写，没有柄的帧
 * 既不重写也不清空；而 `Input.down()` 把它与键盘并起来、`moveVec()` 又拿
 * `arrowleft` 出方向向量。于是**按住 dpad 时把柄拔掉/让它休眠**，方向就永远停在
 * 那一格：实测 moveVec 恒为 (-1,0)，按键盘再松开也清不掉（键盘清的是 `keys`），
 * 只有把手柄插回来并松开那个键才复位。blur 那条路作者已经想到了，这条漏了。
 */
function clearPadKeys() {
  if (!_padHeld) return;                 // 没按过就不分配
  _padKeys = Object.create(null);
  _padOnce = Object.create(null);
  _padHeld = false;
}

/**
 * 每显示帧调一次（main.ts 的 frame 里，且在 hotkeys() 之前）。
 * 按钮边沿 → pressedOnce，按住 → keys 的**手柄副本**，左摇杆 → 方向向量。
 * @returns 是否有手柄连着
 */
Input.poll = function () {
  var pad = firstPad();
  Input._pad.connected = !!pad;
  Input._pad.id = pad ? String(pad.id || '') : '';
  if (!pad) {
    clearPadKeys();
    Input._pad.active = false;
    _padPrev.length = 0;
    return false;
  }
  var btns = pad.buttons || [];
  var anyDown = false;
  for (var i = 0; i < btns.length; i++) {
    var b = btns[i];
    var down = !!(b && (b.pressed || (typeof b.value === 'number' && b.value > 0.5)));
    var key = PAD_BUTTONS[i];
    if (key) {
      _padKeys[key] = down;
      if (down) anyDown = true;
      if (down && !_padPrev[i]) _padOnce[key] = true;
    }
    _padPrev[i] = down;
  }
  _padHeld = anyDown;
  // 左摇杆：只取方向，不取幅度 —— 与键盘的八向向量保持同一种输入形状，
  // 模拟层拿到的永远是单位向量（想加"模拟量速度"就得同时改键盘，那是另一件事）。
  var ax = (pad.axes && pad.axes.length > 0) ? pad.axes[0] : 0;
  var ay = (pad.axes && pad.axes.length > 1) ? pad.axes[1] : 0;
  var m = Math.sqrt(ax * ax + ay * ay);
  if (m > PAD_DEAD) {
    Input._pad.x = ax / m; Input._pad.y = ay / m; Input._pad.active = true;
  } else {
    Input._pad.active = false;
  }
  return true;
};

/** 供设置页显示"手柄已连接" */
Input.padInfo = function () {
  return { connected: Input._pad.connected, id: Input._pad.id };
};

/* =========================================================
   2. 触摸：浮动虚拟摇杆
   ========================================================= */
var TOUCH_MAX = 56;      // 摇杆最大半径（逻辑像素）
var TOUCH_START = 6;     // 小于这个位移视为"点了一下"，不算移动
var _stickEl: any = null;
var _knobEl: any = null;
var _stickReady = false;

function stickEls() {
  if (_stickReady) return;
  _stickReady = true;
  if (!hasDOM) return;
  _stickEl = document.getElementById('touch-stick');
  _knobEl = document.getElementById('touch-knob');
}

function stickShow(on, x, y, kx, ky) {
  stickEls();
  if (!_stickEl) return;
  _stickEl.style.display = on ? 'block' : 'none';
  if (!on) return;
  _stickEl.style.left = x + 'px';
  _stickEl.style.top = y + 'px';
  if (_knobEl) _knobEl.style.transform = 'translate(' + Math.round(kx) + 'px,' + Math.round(ky) + 'px)';
}

function onStickDown(e) {
  // 只认手指/笔：鼠标拖拽不该把角色拖走（桌面端本来就没有这个操作）
  if (e.pointerType === 'mouse') return;
  if (Input._touch.id !== -1) return;
  Input._touch.id = e.pointerId;
  Input._touch.ox = e.clientX; Input._touch.oy = e.clientY;
  Input._touch.x = 0; Input._touch.y = 0; Input._touch.active = false;
  if (e.target && e.target.setPointerCapture) {
    try { e.target.setPointerCapture(e.pointerId); } catch (err) { /* 捕获失败不影响拖动 */ }
  }
  stickShow(true, e.clientX, e.clientY, 0, 0);
  if (e.preventDefault) e.preventDefault();
}

function onStickMove(e) {
  if (e.pointerId !== Input._touch.id) return;
  var dx = e.clientX - Input._touch.ox;
  var dy = e.clientY - Input._touch.oy;
  var m = Math.sqrt(dx * dx + dy * dy);
  if (m < TOUCH_START) {
    Input._touch.active = false;
    Input._touch.x = 0; Input._touch.y = 0;
    stickShow(true, Input._touch.ox, Input._touch.oy, 0, 0);
    return;
  }
  var r = Math.min(m, TOUCH_MAX);
  Input._touch.x = dx / m; Input._touch.y = dy / m; Input._touch.active = true;
  stickShow(true, Input._touch.ox, Input._touch.oy, Input._touch.x * r, Input._touch.y * r);
  if (e.preventDefault) e.preventDefault();
}

function onStickUp(e) {
  if (e.pointerId !== Input._touch.id) return;
  Input._touch.id = -1;
  Input._touch.active = false;
  Input._touch.x = 0; Input._touch.y = 0;
  stickShow(false, 0, 0, 0, 0);
}

/** 触摸摇杆是否正在被推动（渲染/界面想画提示时用） */
Input.stick = function () { return Input._touch; };

/**
 * 把浮动摇杆彻底复位。
 *
 * 失焦（切标签、来电、系统弹窗）会**丢掉 pointer capture**，而浏览器不保证补一个
 * `pointercancel` —— 于是 `_touch.id` 停在旧指针上：新手指出不了摇杆
 * （`onStickDown` 的 `if (Input._touch.id !== -1) return` 直接拒掉），
 * `_touch.x/y` 还留着失焦前的方向，人物就一直朝那个方向走（实测：
 * 失焦后重新按下并拖动，moveVec 与 `_touch.id` 都还是失焦前那一份）。
 * 键盘与手柄的"按住"在同一时刻都被清了，触摸这条以前漏了。
 */
function resetStick() {
  Input._touch.id = -1;
  Input._touch.active = false;
  Input._touch.x = 0; Input._touch.y = 0;
  stickShow(false, 0, 0, 0, 0);
}

/* =========================================================
   3. 键盘与鼠标
   ========================================================= */
Input.init = function (canvas) {
  if (!hasDOM) return;
  Input._canvas = canvas || null;

  window.addEventListener('keydown', function (e) {
    var k = norm(e);
    // 改键：正在等一个键时，这个键只用来绑定，绝不能同时被当成游戏输入
    // （否则改"上"的时候角色会先往上走一步）
    if (_capture) {
      var cb = _capture;
      _capture = null;
      if (e.preventDefault) e.preventDefault();
      cb(k === 'esc' ? null : k);
      return;
    }
    if (!Input.keys[k]) Input.pressedOnce[k] = true;
    Input.keys[k] = true;
    // 阻止空格/方向键滚动页面
    if (k === 'space' || k.indexOf('arrow') === 0 || k === 'tab') e.preventDefault();
  }, { passive: false });

  window.addEventListener('keyup', function (e) {
    Input.keys[norm(e)] = false;
  });

  window.addEventListener('blur', function () {
    Input.keys = Object.create(null);
    // 失焦时手柄的"按住"也要清掉：否则回来时角色会朝一个方向一直走
    clearPadKeys();
    // 触摸摇杆同理（失焦会丢 pointer capture，浏览器不一定补 pointercancel）
    resetStick();
  });
  // 页面被隐藏（切标签 / 锁屏 / 切 App）不一定触发 blur，但同样会丢指针捕获
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) resetStick();
  });

  window.addEventListener('mousemove', function (e) {
    Input.mouse.x = e.clientX; Input.mouse.y = e.clientY;
  });
  window.addEventListener('mousedown', function (e) {
    if (e.button === 0) Input.mouse.down = true;
    if (e.button === 2) Input.mouse.rd = true;
  });
  window.addEventListener('mouseup', function (e) {
    if (e.button === 0) Input.mouse.down = false;
    if (e.button === 2) Input.mouse.rd = false;
  });
  window.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  window.addEventListener('wheel', function (e) {
    Input.mouse.wheel += Math.sign(e.deltaY);
  }, { passive: true });

  // 触摸摇杆绑在画布上：覆盖层是 pointer-events:none，事件本来就落到画布
  if (canvas && canvas.addEventListener) {
    canvas.addEventListener('pointerdown', onStickDown);
    canvas.addEventListener('pointermove', onStickMove);
    canvas.addEventListener('pointerup', onStickUp);
    canvas.addEventListener('pointercancel', onStickUp);
  }
  // 热插拔只用来更新"已连接"这个显示状态，输入本身靠轮询
  window.addEventListener('gamepadconnected', function () { Input._pad.connected = true; });
  // 断开时立刻清一次（轮询下一帧也会清，但断开这一瞬间不该还留着"按住"）
  window.addEventListener('gamepaddisconnected', function () {
    Input._pad.connected = false;
    Input._pad.active = false;
    clearPadKeys();
  });
};

function norm(e) {
  var k = (e.key || '').toLowerCase();
  if (k === ' ') k = 'space';
  if (k === 'escape') k = 'esc';
  if (k === 'shift') k = 'shift';
  return k;
}

/** 按住：键盘与手柄各查一次 */
Input.down = function (k) { return !!Input.keys[k] || !!_padKeys[k]; };

/** 单次触发（读取后清除） */
Input.once = function (k) {
  if (Input.pressedOnce[k]) { Input.pressedOnce[k] = false; return true; }
  if (_padOnce[k]) { _padOnce[k] = false; return true; }
  return false;
};

Input.endFrame = function () {
  Input.pressedOnce = Object.create(null);
  _padOnce = Object.create(null);
  Input.mouse.wheel = 0;
};

/**
 * 移动方向（归一化，恒为单位向量）
 * 可改键位 + **方向键永远额外有效**（改键不会把自己改到不能动）；
 * Shift 慢走；手柄左摇杆；触摸浮动摇杆。
 * 优先级：键盘 > 手柄 > 触摸。手柄插着而手还在键盘上很常见，所以键盘优先；
 * 三者同时输入不可能是本意，选一个总比叠加好。
 */
Input.moveVec = function () {
  var b = Input.bind;
  var x = 0, y = 0;
  if (Input.down(b.left) || Input.down('arrowleft')) x -= 1;
  if (Input.down(b.right) || Input.down('arrowright')) x += 1;
  if (Input.down(b.up) || Input.down('arrowup')) y -= 1;
  if (Input.down(b.down) || Input.down('arrowdown')) y += 1;
  var len = Math.sqrt(x * x + y * y);
  if (len > 0) { x /= len; y /= len; }
  Input._slow = Input.down('shift');
  /* `slow` 跟着**输入载荷**一起交给模拟层 —— 这是这一层唯一需要知道"慢走"的地方。
     改造前模拟层自己 `import { Input }` 然后问 `Input.isSlow()`：那是模拟 → 界面的
     反向依赖（全项目唯一一条），意味着"一帧的输入"不再只由参数决定，
     而是取决于输入单例的当前状态。**输入层负责解释设备，模拟层只消费载荷。** */
  var slow = !!Input._slow;
  if (len > 0) return { x: x, y: y, len: 1, slow: slow };
  if (Input._pad.active) return { x: Input._pad.x, y: Input._pad.y, len: 1, slow: slow };
  if (Input._touch.active) return { x: Input._touch.x, y: Input._touch.y, len: 1, slow: slow };
  return { x: 0, y: 0, len: 0, slow: slow };
};

Input.isSlow = function () { return !!Input._slow; };

export { Input };
