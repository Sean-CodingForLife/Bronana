/* =========================================================
   storage.ts — 存储适配层（浏览器 localStorage / Node 内存 / 将来任何后端）

   为什么要这一层：模拟层是零 DOM 的（`game.ts` 在纯 Node 里能跑完整对局），
   所以设置与存档**不能**直接碰 `localStorage` —— 那会把 DOM 依赖灌进模拟侧，
   也会让 CLI / 桌面外壳 / 无头测试没法用同一套代码。

   适配器只要三个方法（与 localStorage 同形，因此浏览器侧直接传 window.localStorage）：
       getItem(key) -> string | null
       setItem(key, value)
       removeItem(key)

   默认是**内存适配器**：没有显式接入时一切照常工作，只是不跨进程留存。
   写入一律包在 try/catch 里：无痕模式、配额满、被策略禁用都会抛，
   而"存不进去"绝不该让游戏崩 —— 返回 false 并把原因记下来。
   ========================================================= */

import { SelfCheck } from './selfcheck.ts';

var Storage = {} as StorageApi;

/* =========================================================
   存储命名空间 —— **由工作区注入**（引擎不认识任何具体游戏的名字）
   ---------------------------------------------------------
   用户 2026-10-01 的决定（原文与理由见 `docs/teapot-restructure.md` §一）：
   **引擎的名字与内容的名字必须分开** —— 内容叫什么、它的键用什么前缀，
   **引擎一个字节都不该知道**；而且「内容命名空间由**工作区**注入」
   （存储键与种子前缀同一条）。
   所以这四个键的**前缀不是引擎的知识** —— 引擎只给机制，值由宿主/工作区给：

       Storage.setNamespace('…')      ← main.ts / cli.ts / test/_load.mjs 在启动期调用

   ⚠ **不注入的后果是静默的**：键会写成裸名（`profile` 而不是 `『ns』.profile`），
     表现是"读不到旧档、像新玩家一样" —— 最难查的一类退化。所以下面有一条
     **启动期自检**，没注入就报问题，不让它悄悄跑。
   ⚠ **为什么引擎不自己带一个默认前缀**：那正是"引擎自称某个游戏"的耦合，
     也就是门 `naming` 与用户那句"不要混了"要拆掉的东西。
   ⚠ **E5（工作区系统）之后**这个值应当来自 `teapot.workspace.json`；
     今天它写在三个**宿主入口**里 —— 与 `Skills.make({ chars })` 的注入同一套做法
     （宿主决定"跑哪个工作区"，引擎不认识它）。
   ========================================================= */
var NS = '';
/** 逻辑键名：引擎侧只知道"有这四份东西"，不知道它们属于哪个游戏 */
var KEY_NAMES = ['settings', 'run', 'records', 'profile'];
var KEYS = {} as StorageApi['KEYS'];
function buildKeys() {
  for (var i = 0; i < KEY_NAMES.length; i++) {
    (KEYS as Record<string, string>)[KEY_NAMES[i]] = NS ? NS + '.' + KEY_NAMES[i] : KEY_NAMES[i];
  }
}
buildKeys();

/** 注入命名空间（**启动期必须调一次**，由宿主/工作区决定值）。尾部多余的 `.` 会被去掉 */
Storage.setNamespace = function (ns) {
  NS = String(ns || '').replace(/\.+$/, '');
  buildKeys();
};
Storage.namespace = function () { return NS; };

/* 启动期自检：没注入命名空间 ⇒ 键是裸名 ⇒ 会写到另一处去（静默读不到旧档）。 */
SelfCheck.register('storageNamespace', function () {
  var problems: string[] = [];
  if (!Storage.namespace()) {
    problems.push('存储命名空间没有注入：启动期必须调 Storage.setNamespace(工作区名)。' +
      '不注入的话键会写成裸名（' + KEY_NAMES.join(' / ') + '），' +
      '表现是"读不到旧档、像新玩家一样" —— 这是静默的，所以这里要拦。');
  }
  return { ok: problems.length === 0, problems: problems };
});

/** 内存适配器（默认；测试与 CLI 用这个） */
function memoryAdapter(map?: Record<string, string>): StorageAdapter {
  var m = map || Object.create(null);
  return {
    name: 'memory',
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
    setItem: function (k, v) { m[k] = String(v); },
    removeItem: function (k) { delete m[k]; }
  };
}

var current = memoryAdapter();
var lastError: string | null = null;

Storage.KEYS = KEYS;
Storage.memory = function (map?: Record<string, string>) { return memoryAdapter(map); };

/**
 * 接入一个适配器。
 * @returns 是否接入成功（形状不对就保持原样并返回 false，免得后面每处都要判空）
 */
Storage.use = function (adapter) {
  if (!adapter || typeof adapter.getItem !== 'function' ||
    typeof adapter.setItem !== 'function' || typeof adapter.removeItem !== 'function') {
    return false;
  }
  current = adapter;
  return true;
};
Storage.adapterName = function () { return current.name || 'custom'; };

/** 读原始字符串；任何异常都当成"没有" */
Storage.get = function (key) {
  try {
    var v = current.getItem(key);
    return typeof v === 'string' ? v : null;
  } catch (e) {
    lastError = 'read ' + key + ': ' + e.message;
    return null;
  }
};

/** 写原始字符串；返回是否成功 */
Storage.set = function (key, value) {
  try {
    current.setItem(key, String(value));
    return true;
  } catch (e) {
    // 配额满 / 无痕模式都会走到这里。不抛：调用方按"这次没存上"处理
    lastError = 'write ' + key + ': ' + e.message;
    return false;
  }
};

Storage.remove = function (key) {
  try { current.removeItem(key); return true; }
  catch (e) { lastError = 'remove ' + key + ': ' + e.message; return false; }
};

/* ---- JSON 值：解析失败一律返回 null（损坏的数据不该让游戏起不来）---- */
Storage.getJSON = function (key) {
  var raw = Storage.get(key);
  if (raw === null) return null;
  try {
    var v = JSON.parse(raw);
    return (v === null || typeof v !== 'object') ? null : v;
  } catch (e) {
    lastError = 'parse ' + key + ': ' + e.message;
    return null;
  }
};

Storage.setJSON = function (key, value) {
  var text;
  try { text = JSON.stringify(value); }
  catch (e) { lastError = 'stringify ' + key + ': ' + e.message; return false; }
  if (text.length > Storage.MAX_BYTES) {
    lastError = 'payload ' + key + ' 太大：' + text.length + ' 字节';
    return false;
  }
  return Storage.set(key, text);
};

/** 单个存档项的大小上限（防御性：一条坏数据不该把整个存储配额吃光） */
Storage.MAX_BYTES = 256 * 1024;

/* =========================================================
   备份与回退（**崩溃安全**：写坏了还能回到上一份好档）
   ---------------------------------------------------------
   为什么要这一层：`HTML5 localStorage` 的单键写入本身是原子的，
   所以"写到一半断电留下半截 JSON"在浏览器上不会发生 —— 
   但**在 Windows 上不是**（`save-systems` 技能明确写了：
   "在 Windows 上 rename 替换不保证原子"），而本作有 Electron 桌面外壳。
   更现实的一类损坏是：**代码 bug 写进去了一份结构合法的错数据**
   （比如把所有字段写成 0），那种档解析得动、但内容已经是垃圾。

   所以这里的策略是**每一份都留一份上一版**：
     · `setJSONSafe(key, value)`：先读旧值 → 写进 `key + '.bak'` → 再写新值
     · `getJSONSafe(key)`：读 key；解析失败或结构不对 → 回退读 `.bak`
   代价是每次写入多一次读 + 一次写（存档不是每帧都写，可接受）。
   ========================================================= */
Storage.BAK_SUFFIX = '.bak';
Storage.backupKey = function (key) { return key + Storage.BAK_SUFFIX; };

/**
 * 写入并留下上一版备份。
 * @returns {{ ok: boolean, backedUp: boolean, reason: string }}
 */
Storage.setJSONSafe = function (key, value) {
  var prev = Storage.get(key);
  var backedUp = false;
  if (prev !== null) backedUp = Storage.set(Storage.backupKey(key), prev);
  var ok = Storage.setJSON(key, value);
  if (!ok) {
    /* 新值没写进去：把备份还原回主键 —— 否则会因为"主键还是旧的、
       备份也是旧的"而看起来正常，但下一次读会读到半新半旧的状态。 */
    if (backedUp) Storage.set(key, prev);
    return { ok: false, backedUp: backedUp, reason: lastError || '未知写入失败' };
  }
  return { ok: true, backedUp: backedUp, reason: '' };
};

/**
 * 读 JSON，坏档时自动回退到备份。
 * @returns {{ value: any, recovered: boolean, reason: string }}
 */
Storage.getJSONSafe = function (key) {
  var raw = Storage.get(key);
  var v = decode(raw);
  if (v !== null) return { value: v, recovered: false, reason: '' };
  var bakRaw = Storage.get(Storage.backupKey(key));
  var bak = decode(bakRaw);
  if (bak !== null) {
    /* 备份能读：**用它**，并且把它写回主键（下一次读就干净了）。
       注意这里不算"成功"—— 调用方应当据此提示玩家"档坏过、已回退"。 */
    Storage.set(key, bakRaw);
    return { value: bak, recovered: true, reason: raw === null ? '主键缺失' : '主键解析失败' };
  }
  return { value: null, recovered: false, reason: raw === null ? '' : '主键与备份都不可用' };
};

function decode(raw) {
  if (raw === null) return null;
  try {
    var v = JSON.parse(raw);
    return (v === null || typeof v !== 'object') ? null : v;
  } catch (e) { return null; }
}

/**
 * 彻底删掉一个键（主 + 备份）。
 * **清档/重置必须走它** —— 只删主键的话，`getJSONSafe` 会把备份写回去。
 * @returns 真的删掉了主键吗
 */
Storage.removeAll = function (key) {
  var had = Storage.get(key) !== null;
  Storage.remove(key);
  Storage.remove(Storage.backupKey(key));
  return had;
};

/* =========================================================
   槽位（多份存档）
   ---------------------------------------------------------
   槽位**只改键名，不改数据形状**：`<命名空间>.profile` 是 0 号槽，
   其余槽位是 `<命名空间>.profile#1`、`#2`……
   这样"加槽位"是一次**键重定向**，不是一次数据迁移 ——
   老玩家那一份存档天然就是 0 号槽，不需要迁移链。
   ========================================================= */
Storage.SLOTS = 3;
Storage.slotKey = function (key, slot) {
  var n = Math.max(0, Math.min(Storage.SLOTS - 1, Math.floor(Number(slot) || 0)));
  return n === 0 ? key : key + '#' + n;
};
/** 从任意键名里取回槽位号（侧栏/列表用） */
Storage.slotOf = function (key) {
  var m = /#(\d+)$/.exec(String(key));
  return m ? Math.max(0, Math.min(Storage.SLOTS - 1, parseInt(m[1], 10))) : 0;
};

Storage.lastError = function () { return lastError; };
/**
 * 把所有键清掉。
 *
 * ⚠ **它必须连各模块的内存副本一起作废** —— 这条是踩出来的：
 * `test/slots.mjs` 里"清空存储之后 select 同一个槽位"读到的还是**上一段的孢子**
 * （`Profile` 的内存 `data` 只在 `load()` 时才换）。
 * 所以这里在删键之后**发一个事件**，让持有内存副本的模块自己重读；
 * 谁持有副本由谁负责订阅 —— storage 不认识 profile 的字段（那是它不该知道的事）。
 *
 * @param opts.silent 只删键、不发通知（测试里想观察"没有通知时会怎样"时用）
 */
Storage.wipe = function (opts) {
  /* ⚠ **连每一个槽位一起清**（R50 修正）。
     改造前这里只删 0 号槽那三个键 + 它们的备份 ——
     而那正是"槽位 = 键重定向"这条设计的漏洞：`<命名空间>.profile#1` / `#2`
     **活过了 wipe**。表现是"清空之后切到 1 号槽，上一段测试（或者上一局）
     留下的档还在" —— 实测：`test/character.mjs` 里 wipe 之后
      `Slots.select(1)` 读出了**别的用例写过的一份档**，
     而这条不报错，只是让后面的断言以一个说不清的原因失败。
     `Storage.SLOTS` 是槽位数的**唯一出处**（`Slots.COUNT` 读它），
     所以遍历它不会与"加一个槽位"脱节。 */
  var bases = [KEYS.settings, KEYS.run, KEYS.records, KEYS.profile];
  for (var s = 0; s < Storage.SLOTS; s++) {
    for (var b = 0; b < bases.length; b++) {
      Storage.removeAll(Storage.slotKey(bases[b], s));
    }
  }
  if (!(opts && opts.silent)) Storage.emitWipe();
};

/* =========================================================
   清空通知（谁持有内存副本谁订阅）
   ========================================================= */
var wipeListeners: Array<() => void> = [];
Storage.onWipe = function (fn) {
  wipeListeners.push(fn);
  return function () { var i = wipeListeners.indexOf(fn); if (i >= 0) wipeListeners.splice(i, 1); };
};
Storage.emitWipe = function () {
  for (var i = 0; i < wipeListeners.length; i++) {
    try { wipeListeners[i](); } catch (e) { /* 一个订阅者抛错不影响别的 */ }
  }
};

export { Storage };
