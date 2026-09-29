/* =========================================================
   envelope.ts — 带版本与迁移链的存档信封（机制只有一份）

   改造前这套东西只有 save.ts 里有，而且**版本号是全局共享的**：
   run / records 共用一个 `Save.VERSION` 与一条迁移链，于是"只改了档案格式"
   也必须让 run 与 records 一起跨版本 —— 迁移函数拿到 data 却不知道自己
   在处理哪一种，只能写成"对谁都安全"的样子，迟早出事。

   这里把它抽成一个**工厂**：每个域（存档 / 账号档案 / 将来别的）各拿一份
   独立的版本号与迁移链，但信封、校验、损坏兜底、报错风格只有一套。

   约定：`migration(from, fn)` 把 from 版的 data 改成 from+1 版并返回新 data。
   打开信封时从存档版本一路链式升到当前版本；任何一级缺失或抛错 → 拒绝并说明
   原因（绝不让游戏起不来）。比当前版本还新的档（用户装回了旧客户端）只能拒绝。

   本模块**不做 IO**：`wrap` / `open` 只处理对象，读写留给调用方。
   ========================================================= */

var Envelope = {} as EnvelopeFactoryApi;

/**
 * 造一个域。
 * @param opts.name    域的名字（报错时指路用，如 'save' / 'profile'）
 * @param opts.version 当前版本号（正整数，从 1 起）
 */
Envelope.create = function (opts) {
  var name = String(opts.name || 'envelope');
  var VERSION = Number(opts.version) || 1;
  var MIGRATIONS: Record<number, (data: any) => any> = Object.create(null);
  var FROM: number[] = [];
  var lastNote: string | null = null;

  function note(msg) { lastNote = msg; }

  /** 把任意旧版本 data 逐级升到当前版本；升不上来返回 null（并记原因） */
  function migrate(data, from) {
    var v = from;
    while (v !== VERSION) {
      var step = MIGRATIONS[v];
      if (!step) { note(name + ': 缺少 v' + v + ' → v' + (v + 1) + ' 的迁移（档是 v' + from + '）'); return null; }
      try {
        data = step(data);
      } catch (e) {
        note(name + ': v' + v + ' → v' + (v + 1) + ' 的迁移失败：' + ((e && e.message) || e));
        return null;
      }
      if (!data || typeof data !== 'object') { note(name + ': v' + v + ' 的迁移没有返回对象'); return null; }
      v++;
    }
    return data;
  }

  var api = {
    name: name,
    VERSION: VERSION,

    /** 注册一级迁移；同一级重复注册直接抛错（迁移链断裂是最难查的一类 bug） */
    migration: function (fromVersion, fn) {
      if (MIGRATIONS[fromVersion]) throw new Error(name + ': v' + fromVersion + ' 的迁移已存在');
      if (typeof fn !== 'function') throw new Error(name + ': 迁移必须是函数');
      MIGRATIONS[fromVersion] = fn;
      FROM.push(fromVersion);
      return fromVersion;
    },
    migrationVersions: function () { return FROM.slice(); },

    /** 装信封 */
    wrap: function (kind, data) {
      return { v: VERSION, at: Date.now(), kind: kind, data: data };
    },

    /** 拆信封并校验（含版本迁移）；不合格返回 null（不抛） */
    open: function (raw, kind) {
      if (!raw || typeof raw !== 'object') return null;
      if (raw.kind !== kind) { note(name + ': 类型不符：档是 ' + raw.kind + '，期望 ' + kind); return null; }
      if (!raw.data || typeof raw.data !== 'object') { note(name + ': data 不是对象'); return null; }
      if (raw.v === VERSION) return raw.data;
      if (typeof raw.v !== 'number' || raw.v < 0 || raw.v > VERSION) {
        note(name + ': 版本不符：档 v=' + raw.v + '，当前 v=' + VERSION);
        return null;
      }
      return migrate(raw.data, raw.v);
    },

    lastError: function () { return lastNote; },
    /** 调用方（各域自己）也能记原因：写盘失败、内容不可用之类不归信封管 */
    note: note
  };
  return api;
};

export { Envelope };
