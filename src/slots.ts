/* =========================================================
   slots.ts — 存档槽位与档案搬运（换设备 / 备份 / 多存档）
   ---------------------------------------------------------
   三件事合成一个模块，因为它们回答的是同一个问题：
   **"这一份进度存在哪里"**。

     1. **槽位**：3 个槽位，每个都是独立的账号档案 + 战绩 + 战绩记录。
        实现上**只改键名，不改数据形状**（`Storage.slotKey`）——
        0 号槽就是原来的键名，所以老玩家的存档**天然在 0 号槽**，
        不需要任何迁移链。加槽位 = 一次键重定向。
     2. **导出 / 导入**：把当前槽位编成一段**带校验和的文本**，
        可以复制去别处（换设备、备份、贴给朋友）。
        为什么要有校验和：纯 base64 的文本**看起来都合法**，
        被聊天软件截断一段也照样能解出"半份存档" —— 那种档导入之后
        表现是"金币变成 NaN"，而报错信息只会说"格式不对"。
        校验和让"这份文本是完整的"变成可判定的。
     3. **回退**：`Storage` 那一层每写一次都留 `.bak`（见 storage.ts），
        这里提供"读坏了就回退"的**可观测**入口（`Slots.lastRecovery()`），
        界面据此告诉玩家"档坏过、已回退"，而不是静默地少了一半进度。

   ⚠ 本模块**不做 IO 之外的事**：它不认识"账号档案里有什么"，
   只认识"键名与一段文本"。所以它不会因为 profile 改字段而失效。
   ========================================================= */
import { Storage } from './storage.ts';
import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';

var Slots = {} as SaveSlotApi;

/* =========================================================
   1. 槽位（**当前槽位是可变状态**，`test/persist.mjs` 的 ALLOWED 里登记着它）
   ========================================================= */
var currentSlot = 0;
var listeners: Array<(slot: number) => void> = [];
/** 最近一次"读档时发现坏档并回退"的记录（界面要用它提示玩家） */
var lastRecovery: { key: string; slot: number; reason: string; at: number } | null = null;

Slots.COUNT = Storage.SLOTS;
Slots.current = function () { return currentSlot; };
Slots.lastRecovery = function () { return lastRecovery; };
Slots.clearRecovery = function () { lastRecovery = null; };

/** 槽位的键（0 号槽 = 原键名） */
Slots.key = function (base, slot) {
  return Storage.slotKey(base, slot === undefined ? currentSlot : slot);
};

/** 这个槽位有没有东西（有任何一份档案就算有） */
Slots.used = function (slot) {
  var s = slot === undefined ? currentSlot : slot;
  return Storage.get(Storage.slotKey(Storage.KEYS.profile, s)) !== null ||
    Storage.get(Storage.slotKey(Storage.KEYS.records, s)) !== null;
};

/** 槽位概览（界面显示"槽位 2 · 有档"用） */
Slots.list = function () {
  var out = [];
  for (var i = 0; i < Slots.COUNT; i++) out.push({ slot: i, used: Slots.used(i) });
  return out;
};

/**
 * 切槽位。
 * @returns 槽位号**是否变了**（同一个槽位返回 false）
 *
 * ⚠ **即使槽位号没变也要通知一遍**：调用方的意思是"用这个槽位"，
 * 而"这个槽位"可能刚被外部改过（测试里 `Storage.wipe()` / `Slots.reset()` 之后
 * 内存里那份 `Profile` 还是旧的）。第一版只在槽位号变化时通知，于是
 * "重置之后再 select 同一个槽位"读到的是**内存里的旧档** ——
 * 实测（`test/slots.mjs`）表现是"清了 0 号槽之后它还有 123 孢子"。
 * 通知一次是幂等的（`Profile.load()` 读的就是当前槽位的键），代价可以忽略。
 */
Slots.select = function (slot) {
  var n = Math.max(0, Math.min(Slots.COUNT - 1, Math.floor(Number(slot) || 0)));
  var changed = n !== currentSlot;
  currentSlot = n;
  for (var i = 0; i < listeners.length; i++) {
    try { listeners[i](n); } catch (e) { /* 一个监听器抛错不影响别的 */ }
  }
  return changed;
};
/** 下一槽（循环）；界面上的"＋"按钮走它 */
Slots.next = function () { return Slots.select((currentSlot + 1) % Slots.COUNT); };
Slots.prev = function () { return Slots.select((currentSlot + Slots.COUNT - 1) % Slots.COUNT); };
Slots.onChange = function (fn) { listeners.push(fn); return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; };

/* =========================================================
   2. 读档回退（**唯一**的"读坏档"入口，且它会被记下来）
   ========================================================= */
/**
 * 读一份 JSON，坏档时回退到备份并**记一笔**（界面据此提示玩家）。
 * 调用方用它替代 `Storage.getJSON`。
 */
Slots.readJSON = function (key) {
  var r = Storage.getJSONSafe(key);
  if (r.recovered) {
    lastRecovery = { key: key, slot: Storage.slotOf(key), reason: r.reason, at: Date.now() };
  }
  return r.value;
};

/** 带备份的写（存档都走它）。
 *
 *  ⚠ **参数是"基键"，不是最终键** —— 槽位重定向在这里面做。
 *  第一版把它写成 `Storage.setJSONSafe(key, …)`（直接用传进来的键），
 *  于是调用方（`Profile.save`）传 `Storage.KEYS.profile`，写下去的就是
 *  **0 号槽的键**：换槽位之后**写永远落在同一个键上**，
 *  而读走的是 `Slots.readJSON`（它做重定向）。
 *  表现是"切到 2 号槽，2 号槽读到了 0 号槽的档" —— 而且不报任何错。
 *  读 / 写两个方向的键变换必须**成对**，这条是实测踩出来的。 */
Slots.writeJSON = function (key, value) {
  return Storage.setJSONSafe(Slots.key(key), value);
};

/* =========================================================
   3. 导出 / 导入（一段带校验和的文本）
   ---------------------------------------------------------
   格式：`BRNA1.<payload>.<checksum>`
     · `BRNA1` 是格式标记与版本（将来换格式时能明确拒绝而不是猜）
     · payload = base64(JSON)，JSON 里**只放三份存档的原值**，不放时间戳之类
       （时间戳会让"同一份存档导出两次"得到不同的文本，没法比对）
     · checksum = 自己算的 32 位 FNV（**不用 crypto** —— 它在 Node/浏览器/
       Electron 里三套接口，而这里只需要"能发现截断与手改"）
   ========================================================= */
var PREFIX = 'BRNA1';

function fnv1a(str) {
  var h = 2166136261;
  for (var i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/* base64 只有在**两端都按 UTF-8 走**时才是无损的：
   `btoa` 只接受 Latin-1（传中文会抛），`atob` 返回的也是 Latin-1 字节串
   （中文会解成乱码）。所以两端都套一层 `encodeURIComponent` / `decodeURIComponent`
   把 UTF-8 字节搬过去。`Buffer` 是**兜底**（有些宿主没有 btoa/atob，
   而它天然按 UTF-8）—— 但主路径不用它，因为 `src/` 是浏览器侧代码。 */
function b64encode(s) {
  var utf8 = s;
  try {
    if (typeof btoa === 'function') return btoa(unescape(encodeURIComponent(utf8)));
  } catch (e) { /* 落到 Buffer */ }
  /* `Buffer` 是**宿主兜底**：有些环境没有 btoa/atob（老 Node、某些嵌入宿主），
     而它天然按 UTF-8。用 `globalThis` 上的可选形状拿它 ——
     `src/` 是浏览器侧代码，直接写 `Buffer` 会因为缺 @types/node 而编译不过
     （实测：tsc 报 TS2591，而本项目的类型检查是零容忍的）。 */
  var B = (globalThis as { Buffer?: { from(a: string, enc: string): { toString(enc: string): string } } }).Buffer;
  if (B) return B.from(utf8, 'utf8').toString('base64');
  return '';
}
function b64decode(s) {
  try {
    if (typeof atob === 'function') return decodeURIComponent(escape(atob(s)));
  } catch (e) { /* 落到 Buffer */ }
  var B = (globalThis as { Buffer?: { from(a: string, enc: string): { toString(enc: string): string } } }).Buffer;
  if (B) return B.from(s, 'base64').toString('utf8');
  return '';
}

/** 要搬运的三份档案（**原值**，不是重新序列化过的 —— 免得引入第二份形状）
 *
 *  ⚠ **按需算，不许在模块顶层快照**（E3 第 2 小步改的）：存储键的**命名空间是
 *  启动期注入**的（`Storage.setNamespace`），而模块顶层的这次赋值发生在 **import 期** ——
 *  那时命名空间可能还没注入，于是这里会**冻住裸键名**，而其余读写用的是带前缀的键。
 *  后果是静默的：导出 / 搬运 / 重置会操作到**另一批键**上（「搬运了但什么都没搬」）。
 *  键名既然是启动期可变的，任何模块级快照都会过期。 */
function carried() { return [Storage.KEYS.profile, Storage.KEYS.records, Storage.KEYS.run]; }

Slots.exportText = function (slot) {
  var s = slot === undefined ? currentSlot : slot;
  var pack = { keys: {}, at: 0 };
  var keys = carried();
  for (var i = 0; i < keys.length; i++) {
    var raw = Storage.get(Storage.slotKey(keys[i], s));
    if (raw !== null) pack.keys[keys[i]] = raw;
  }
  var body = JSON.stringify(pack);
  var payload = b64encode(body);
  return PREFIX + '.' + payload + '.' + fnv1a(payload).toString(36);
};

/**
 * 导入一段文本。
 * @returns {{ ok: boolean, reason: string, keys: number }}
 *
 * 判据顺序是刻意的：**先看格式，再看校验和，最后才解析 payload**。
 * 反过来的话，一段被截断的 base64 会先去 JSON.parse 抛错，
 * 而报出来的原因会是"JSON 解析失败"—— 那对玩家毫无意义。
 */
Slots.importText = function (text, slot) {
  var s = slot === undefined ? currentSlot : slot;
  var t = String(text || '').trim();
  var parts = t.split('.');
  if (parts.length !== 3) return { ok: false, reason: '不是存档文本（缺少分隔段）', keys: 0 };
  if (parts[0] !== PREFIX) return { ok: false, reason: '格式不认识：' + parts[0], keys: 0 };
  if (fnv1a(parts[1]).toString(36) !== parts[2]) {
    return { ok: false, reason: '校验和不符（文本被改动或截断过）', keys: 0 };
  }
  var body;
  try { body = b64decode(parts[1]); }
  catch (e) { return { ok: false, reason: '内容不是合法的 base64', keys: 0 }; }
  var pack;
  try { pack = JSON.parse(body); }
  catch (e) { return { ok: false, reason: '内容不是合法的 JSON', keys: 0 }; }
  if (!pack || typeof pack !== 'object' || !pack.keys || typeof pack.keys !== 'object') {
    return { ok: false, reason: '结构不对（缺少 keys）', keys: 0 };
  }
  var n = 0;
  var carryKeys = carried();
  for (var i = 0; i < carryKeys.length; i++) {
    var k = carryKeys[i];
    if (typeof pack.keys[k] !== 'string') continue;
    /* 写进去之前**先验证它是 JSON**：导入一份坏文本不该把好档换掉 */
    try {
      var v = JSON.parse(pack.keys[k]);
      if (!v || typeof v !== 'object') continue;
    } catch (e) { continue; }
    if (Storage.set(Storage.slotKey(k, s), pack.keys[k])) n++;
  }
  if (!n) return { ok: false, reason: '这份存档里没有任何一份可用的档案', keys: 0 };
  return { ok: true, reason: '', keys: n };
};

/** 重置一个槽位（**只碰这个槽位的键**，不动别的槽位） */
Slots.reset = function (slot) {
  var s = slot === undefined ? currentSlot : slot;
  var n = 0;
  var carryKeys = carried();
  for (var i = 0; i < carryKeys.length; i++) {
    /* 走 `Storage.removeAll`：**主 + 备份一起删**。
       只删主键的话 `Slots.readJSON` 会把备份写回去，
       表现是"重置了但进度还在" —— 这条是实测踩出来的。 */
    if (Storage.removeAll(Storage.slotKey(carryKeys[i], s))) n++;
  }
  return n;
};

/** 清掉某一个基键（当前槽位）—— `Save.clearRun` / `clearRecords` 走它 */
Slots.clear = function (base) {
  return Storage.removeAll(Slots.key(base));
};

/* =========================================================
   4. 定义期自检
   ========================================================= */
Slots.audit = function () {
  var problems = [];
  if (!(Slots.COUNT >= 1 && Slots.COUNT <= 9)) problems.push('槽位数要在 1~9（现在 ' + Slots.COUNT + '）');
  if (Storage.slotKey(Storage.KEYS.profile, 0) !== Storage.KEYS.profile) {
    problems.push('0 号槽必须等于原键名 —— 否则老存档会被当成"没档"');
  }
  if (Storage.slotKey(Storage.KEYS.profile, 1) === Storage.KEYS.profile) {
    problems.push('1 号槽与原键名相同 —— 切槽位会覆盖同一份档');
  }
  /* 校验和必须真的能发现改动（拿一份改过的文本验一次） */
  var probe = b64encode('{"keys":{}}');
  var good = fnv1a(probe).toString(36);
  if (good === fnv1a(probe + 'x').toString(36)) problems.push('校验和发现不了改动');
  if (carried().length < 3) problems.push('要搬运的档案少于 3 份（一局 / 战绩 / 档案）');
  return { ok: problems.length === 0, problems: problems, counts: { slots: Slots.COUNT, carried: carried().length } };
};

if (!Slots.audit().ok) throw new Error('slots 自检失败：\n' + Slots.audit().problems.join('\n'));
SelfCheck.register('Slots', Slots.audit);

/* =========================================================
   5. 登记进扩展点总账
   ========================================================= */
Registry.family('saveSlot', {
  note: '存档槽位（0 号槽 = 原键名，老存档天然在 0 号槽）', owner: 'slots.ts',
  values: function () {
    var out = [];
    for (var i = 0; i < Slots.COUNT; i++) out.push('slot' + i);
    return out;
  }
});

export { Slots };
