/* =========================================================
   settings.ts — 设置系统

   改造前"设置"根本不存在：音效开关是 `Sfx.enabled`、音量是 `Sfx.volume`、
   帧率叠加层只认 URL 参数 `?fps=1`、速度靠按一下 `f` ——
   四个散在不同模块里的可变量，改完刷新就没了，也没有任何一处能列出"有哪些设置"。

   现在：设置是**一张声明表**（键 / 类型 / 默认值 / 取值范围 / 中文名），
   值经过校验后写进 storage。本模块刻意**不 import 渲染层/玩法层**：
   它只负责"值是什么、合不合法、存到哪"，把值应用到具体模块是调用方的事
   （main.ts 通过 onChange 做）。这样 CLI 与无头测试也能读写设置，
   而不会因为 import 链把 canvas 拉进来。

   三条防御：
     · 越界/类型不对的值一律夹回合法范围（不是抛错 —— 坏设置不该让游戏起不来）
     · 存档里的未知键被丢弃，缺失键补默认值（版本升级时表变了也不会炸）
     · 写入失败（配额满/无痕）只记录，不影响本次会话内的生效
   ========================================================= */

import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';
import { Storage } from './storage.ts';

var Settings = {} as SettingsApi;

/* =========================================================
   1. 声明表
   ========================================================= */
var FIELDS: Record<string, SettingDef> = {
  sound: { type: 'bool', def: true, label: '音效', note: '总开关（音乐一起关）' },
  music: { type: 'bool', def: true, label: '背景音乐', note: '程序化生成的占位曲；关掉只留音效' },
  volume: { type: 'number', def: 0.22, min: 0, max: 1, step: 0.02, label: '总音量' },
  /* ---- 分组音量：音效与音乐各自的比例（乘在总音量之上） ----
     为什么默认 1 而不是 0.5：默认值必须让**升级前后响度完全一样**。
     老存档里没有这两个字段，取默认值 1 时与改造前（只有一条 master）
     同响度；给它们各写 0.5 会让所有老玩家一升级就"突然小声了一半"。 */
  sfxVolume: { type: 'number', def: 1, min: 0, max: 1, step: 0.05, label: '音效音量', note: '相对总音量的比例' },
  musicVolume: { type: 'number', def: 1, min: 0, max: 1, step: 0.05, label: '音乐音量', note: '相对总音量的比例；调到 0 = 只留音效' },
  speed: { type: 'enum', def: 1, values: [1, 2], label: '游戏速度' },
  fps: { type: 'bool', def: false, label: '帧率叠加层', note: '左上角显示 fps / 帧耗时 / 实体数' },
  shake: { type: 'number', def: 1, min: 0, max: 2, step: 0.1, label: '屏幕抖动' },
  autopause: { type: 'bool', def: true, label: '失焦自动暂停', note: '切到后台 / 窗口失去焦点时自动暂停' },
  damageNumbers: { type: 'bool', def: true, label: '伤害飘字', note: '关掉可以少一大片视觉噪声' },
  reduceMotion: { type: 'bool', def: false, label: '减少动效', note: '抖动归零 + 粒子抽稀（对玩法没有影响）' },
  /* ---- 命中定帧（hit-stop）----
     **默认 0 = 关**，理由不是"还没做"，而是它会**改模拟时序**（精英与 Boss
     被打中时怪物少走几步），于是默认打开就会改行为指纹 ——
     而"纯重构必须逐位不变"是这个项目的纪律。
     做成显式选项之后两边都成立：玩家想要更重的打击感就打开（那是有意改行为），
     而默认档下所有既有测试与指纹逐位不变。
     档位名写在这里、帧数住在 `Game.cfg.hitStop`（模拟层）—— 界面只认档位，
     模拟层只认帧数，两边不互相抄数字。 */
  hitStop: { type: 'enum', def: 0, values: [0, 2, 4, 7], label: '命中定帧', note: '0=关 2=轻 4=中 7=重（打在精英与 Boss 身上时的顿帧）' },
  /* ---- 这一轮补的三项（可访问性 + 本地化，见 README 的"游戏该有的东西"） ----
     为什么它们是**设置项**而不是各自散落的变量：
     设置表是"有哪些可调项"的**唯一**出处，界面控件由 `test/registry.mjs` 的
     `WIDGET_OF` 保证每一项都有按钮 —— 这一层守卫已经抓到过一次
     "有 apply 分支但界面上没控件"的漏项，所以新项走同一张表而不是新开一条路。 */
  locale: { type: 'string', def: 'zh', options: ['zh', 'en'], label: '语言', note: '语言名用母语写；缺译文时回退中文' },
  fontScale: { type: 'enum', def: 1, values: [1, 1.15, 1.3], label: '字号', note: '整屏 UI 缩放（小屏 / 视力受限）' },
  colourblind: { type: 'enum', def: 0, values: [0, 1, 2], label: '色弱模式', note: '0=关 1=红绿友好 2=高对比（危险物加形状标记）' },
  // 可改的键位。方向键永远额外有效，所以改键不会把自己改到"不能动"。
  keyUp: { type: 'key', def: 'w', label: '上' },
  keyDown: { type: 'key', def: 's', label: '下' },
  keyLeft: { type: 'key', def: 'a', label: '左' },
  keyRight: { type: 'key', def: 'd', label: '右' },
  keyPause: { type: 'key', def: 'p', label: '暂停' }
};

/**
 * 哪些键允许被绑定。
 * 只收单字符与几个具名键 —— 挡掉 'control' / 'meta' 这类本身要配合别的键的修饰键，
 * 以及 'dead' / 'unidentified' 这类来自输入法的伪键名（绑上去就是"这个键没反应"）。
 */
var NAMED_KEYS = ['space', 'shift', 'enter', 'tab', 'esc',
  'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
Settings.isBindableKey = function (k) {
  if (typeof k !== 'string') return false;
  if (NAMED_KEYS.indexOf(k) >= 0) return true;
  return /^[a-z0-9]$/.test(k);
};

var values: Record<string, any> = {};
var listeners: Array<(key: string, value: any, source: string) => void> = [];
var loadedFrom: string = 'defaults';

/* =========================================================
   2. 取值与校验
   ========================================================= */
function coerce(key, raw) {
  var f = FIELDS[key];
  if (!f) return undefined;
  if (f.type === 'bool') {
    if (typeof raw === 'boolean') return raw;
    if (raw === 'true' || raw === 1 || raw === '1') return true;
    if (raw === 'false' || raw === 0 || raw === '0') return false;
    return undefined;
  }
  if (f.type === 'enum') {
    var n = Number(raw);
    return f.values.indexOf(n) >= 0 ? n : undefined;
  }
  if (f.type === 'key') {
    // 不认识的键名一律拒绝（而不是存下来 —— 存下来只会表现成"这个键没反应"）
    var kk = (typeof raw === 'string') ? raw.toLowerCase() : '';
    return Settings.isBindableKey(kk) ? kk : undefined;
  }
  if (f.type === 'string') {
    /* 字符串型**只收 options 里列出的值**（语言 id 这类）。
       不收任意字符串的理由与 key 型一样：一个不认识的语言 id 存下去，
       界面就会一直显示"缺译文"，而没人知道是键写错了。 */
    var s = (typeof raw === 'string') ? raw : '';
    return (f.options && f.options.indexOf(s) >= 0) ? s : undefined;
  }
  // number：非数值/NaN 一律拒绝，越界夹回范围
  var v = Number(raw);
  if (!isFinite(v)) return undefined;
  if (f.min !== undefined && v < f.min) v = f.min;
  if (f.max !== undefined && v > f.max) v = f.max;
  return v;
}

function defaults() {
  var out: Record<string, any> = {};
  for (var k in FIELDS) out[k] = FIELDS[k].def;
  return out;
}

/* =========================================================
   3. 加载 / 保存
   ========================================================= */
/**
 * 从存储加载并补齐缺失项。
 * @returns {{ loaded: boolean, dropped: string[], repaired: string[] }}
 */
Settings.load = function () {
  var dropped = [], repaired = [];
  var saved = Storage.getJSON(Storage.KEYS.settings);
  values = defaults();
  loadedFrom = 'defaults';

  if (saved && saved.v === Settings.VERSION && saved.values && typeof saved.values === 'object') {
    loadedFrom = 'storage';
    for (var k in saved.values) {
      if (!FIELDS[k]) { dropped.push(k); continue; }
      var v = coerce(k, saved.values[k]);
      if (v === undefined) { repaired.push(k); continue; }
      if (v !== saved.values[k]) repaired.push(k);
      values[k] = v;
    }
    // 表里新增、存档里没有的键：保持默认值（不报错）
    for (k in FIELDS) if (!(k in saved.values)) repaired.push(k + '(补默认)');
  } else if (saved) {
    // 版本不符或结构不对：丢弃，用默认值（并保留现场，下次保存会覆盖）
    dropped.push('整个存档(v=' + (saved && saved.v) + ')');
  }
  return { loaded: loadedFrom === 'storage', dropped: dropped, repaired: repaired };
};

/** 写回存储；返回是否成功（失败不影响内存里的值） */
Settings.save = function () {
  return Storage.setJSON(Storage.KEYS.settings, {
    v: Settings.VERSION,
    at: Date.now(),
    values: values
  });
};

/** 加载 + 保存 + 通知（启动时调一次；调用方随后自行 applyAll） */
Settings.init = function () {
  var r = Settings.load();
  Settings.save();
  return r;
};

/* =========================================================
   4. 读写
   ========================================================= */
Settings.get = function (key) { return values[key]; };
Settings.all = function () {
  var out: Record<string, any> = {};
  for (var k in FIELDS) out[k] = values[k];
  return out;
};
Settings.keys = function () { return Object.keys(FIELDS); };
Settings.def = function (key) { return FIELDS[key]; };
Settings.loadedFrom = function () { return loadedFrom; };

/**
 * 改一个设置。非法值被夹回范围而不是拒绝（返回实际生效的值）。
 * @param source 'user' | 'code' | 'storage'（用于区分"玩家改的"和"代码设的"）
 */
Settings.set = function (key, raw, source) {
  if (!FIELDS[key]) throw new Error('settings: 没有这个设置项 ' + key);
  var v = coerce(key, raw);
  if (v === undefined) throw new Error('settings: ' + key + ' 的取值不合法：' + raw);
  if (values[key] === v) return v;
  values[key] = v;
  Settings.save();
  Settings.emit(key, v, source || 'code');
  return v;
};

/** 全部设置调回默认值 */
Settings.resetAll = function () {
  values = defaults();
  Settings.save();
  for (var k in FIELDS) Settings.emit(k, values[k], 'code');
  return Settings.all();
};

/* =========================================================
   5. 变更通知（应用值的唯一入口在调用方：main.ts）
   ========================================================= */
Settings.emit = function (key, value, source) {
  for (var i = 0; i < listeners.length; i++) {
    try { listeners[i](key, value, source); }
    catch (e) { /* 一个监听器抛错不该影响其它 */ }
  }
};

/** 订阅变更；返回退订函数 */
Settings.onChange = function (fn) {
  listeners.push(fn);
  return function () {
    var i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
};

Settings.VERSION = 1;

/* =========================================================
   6. 定义期自检（**这个家族原来没人守**）
   ---------------------------------------------------------
   `setting` 是"设置项名"的值域。它写错的表现极其安静：
   `main.ts` 的 `applySetting` 是一个 `if/else if` 链 ——
   **键名写错一个字母，那一项就永远不生效**（能存、能读、能点，只有效果没有）。
   而 `test/registry.mjs` 守的是"每一项都有界面控件"，
   `test/persist.mjs` 守的是"落盘与恢复"——**没有一处守"这个名字本身对不对"**。

   这里补上那一处。查四件事：
     · 每个字段有 type / label / def
     · enum 型必须有非空 values，且 def 在里面
     · string 型必须有非空 options，且 def 在里面
     · number 型的 min/max 合法且 def 落在区间内
     · `coerce` 对**每项的默认值**都必须返回非 undefined（否则存档里那一项会被丢掉）
     · 键名不与 `Object.prototype` 上的东西重名（`__proto__` / `constructor` 这类）
   ========================================================= */
Settings.audit = function () {
  var problems: string[] = [];
  var keys = Object.keys(FIELDS);
  if (!keys.length) problems.push('一张设置项都没有');
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var f = FIELDS[k];
    if (!k || k !== k.trim()) problems.push('设置项名有空白：' + JSON.stringify(k));
    if (Object.prototype.hasOwnProperty.call({}, k)) {
      problems.push(k + ' 与 Object.prototype 上的名字撞了（存取会走原型链）');
    }
    if (!f) { problems.push(k + ' 没有声明'); continue; }
    if (!f.label) problems.push(k + ' 没有中文名（界面要显示它）');
    if (['bool', 'number', 'enum', 'key', 'string'].indexOf(f.type) < 0) {
      problems.push(k + ' 的类型不认识：' + f.type);
      continue;
    }
    if (f.def === undefined || f.def === null) problems.push(k + ' 没有默认值');
    if (f.type === 'enum') {
      if (!f.values || !f.values.length) problems.push(k + ' 是 enum 却没有 values');
      else if (f.values.indexOf(f.def) < 0) problems.push(k + ' 的默认值 ' + f.def + ' 不在 values 里');
    }
    if (f.type === 'string') {
      if (!f.options || !f.options.length) problems.push(k + ' 是 string 却没有 options');
      else if (f.options.indexOf(f.def) < 0) problems.push(k + ' 的默认值 ' + f.def + ' 不在 options 里');
    }
    if (f.type === 'number') {
      if (f.min !== undefined && f.max !== undefined && !(f.min < f.max)) {
        problems.push(k + ' 的 min/max 不成立：' + f.min + ' / ' + f.max);
      }
      if (f.min !== undefined && f.def < f.min) problems.push(k + ' 的默认值小于 min');
      if (f.max !== undefined && f.def > f.max) problems.push(k + ' 的默认值大于 max');
    }
    /* **最要紧的一条**：默认值必须能过 `coerce`。
       过不了的表现是"首次启动就把这一项丢掉"，而界面上只看到它一直是默认值。 */
    if (coerce(k, f.def) === undefined) {
      problems.push(k + ' 的默认值过不了自己的校验（coerce 返回 undefined）—— 首次启动就会丢掉它');
    }
  }
  return { ok: problems.length === 0, problems: problems, counts: { settings: keys.length } };
};

if (!Settings.audit().ok) throw new Error('settings.ts 设置表自检失败：\n' + Settings.audit().problems.join('\n'));
SelfCheck.register('Settings', Settings.audit);

/* 登记到扩展点总账：设置项是家族（每一项都有中文名与范围，见 FIELDS） */
Registry.family('setting', {
  note: '设置项（声明表 + 校验 + 持久化）', owner: 'settings.ts',
  values: function () { return Settings.keys(); }
});
export { Settings };
