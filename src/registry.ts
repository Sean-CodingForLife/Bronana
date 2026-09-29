/* =========================================================
   registry.ts — 扩展点总账（所有"家族"在一处声明与校验）
   ---------------------------------------------------------
   这个项目已经有 7 个注册表：组件与原型、粒子种类、AI 行为与弹幕模式、
   深度层带与可视实体、场景表、设置表、武器/道具/怪物数据。问题是它们
   **各自为政**：
     · 每个表有自己的校验方式与报错风格；
     · 表与表之间的引用没人管 —— `Enemies.LIST[].behavior` 有没有实现、
       `item.icon` 有没有画法、`weapon.kind` / 子弹 `kind` 是否画得出来、
       `def.shape` / `def.legs` 写错了会不会静默换形状；
     · 没有任何一处能回答"这个游戏由哪些可扩展点组成、各自多少条、有没有断链"。

   于是这里做两件事（机制只有一份，所有家族复用）：

   1. **声明**：每个家族在**拥有数据的那个模块里**自注册（`Registry.family`），
      给出名字、说明、条目枚举、以及条目对**别的家族**的引用。
      自注册而不是集中登记，是为了避免"总账模块反过来依赖所有模块"的循环。
   2. **审计**：`Registry.audit()` 一次跑完所有引用检查，返回结构化的
      "哪个家族、哪一条、哪个字段、指向哪个家族、值是什么" ——
      报错风格统一，新增一个家族不用再写一套测试。

   刻意不做的事：不做运行期校验（每帧查表太贵），也不做动态发现 ——
   家族是显式声明的，漏登记由 test/registry.mjs 的"必须存在的家族"清单兜住。
   ========================================================= */

var Registry = {} as RegistryApi;

/* =========================================================
   家族声明
   ========================================================= */
var FAMILIES: Record<string, RegistryFamily> = Object.create(null);
var NAMES: string[] = [];

/**
 * 声明一个可扩展点。
 * @param name   家族名（如 'enemy'、'aiBehaviour'）—— 引用它的字段就写这个名字
 * @param def.note     这个家族是什么
 * @param def.owner    数据在哪个模块（便于报错时指路）
 * @param def.entries  枚举条目：() => { id, refs?: [{field, value, family}] }[]
 * @param def.values   可选：把家族看成"允许值的集合"（画法分派这类没有显式条目）
 */
Registry.family = function (name, def) {
  if (FAMILIES[name]) throw new Error('registry: 家族重名 ' + name);
  if (!def || typeof def.note !== 'string' || !def.note) {
    throw new Error('registry: 家族 ' + name + ' 缺少说明（note）');
  }
  if (typeof def.entries !== 'function' && typeof def.values !== 'function') {
    throw new Error('registry: 家族 ' + name + ' 既没有 entries() 也没有 values()');
  }
  FAMILIES[name] = {
    name: name,
    note: def.note,
    owner: def.owner || '',
    entries: def.entries || null,
    values: def.values || null
  };
  NAMES.push(name);
  return FAMILIES[name];
};
Registry.has = function (name) { return !!FAMILIES[name]; };
Registry.names = function () { return NAMES.slice(); };
Registry.info = function (name) {
  var f = FAMILIES[name];
  return f ? { name: f.name, note: f.note, owner: f.owner } : null;
};

/* =========================================================
   字段 → 家族的声明（`Registry.uses`）
   ---------------------------------------------------------
   为什么还需要这一层：家族是"值域"，而**数据表上的字段名**是另一回事。
   `EnemyDef.behavior` 的值属于 `aiBehaviour` 家族 —— 这个对应关系以前
   只存在于 `enemies.ts` 的 `entries()` 里（也就是"顺手写对了"），
   谁也没法从外部回答"`behavior` 这个字段对应哪个家族"。

   于是有一类洞**结构上查不出来**：一份数据表上写了个字符串字段
   （`CharDef.special: 'rage'`），模拟层里按它分派，而它：
     · 不在任何家族里 → 值域没人守（写错一个字母 = 那段机制永远不生效）
     · 没有任何自检 → "一共有几种机制、谁没人读"没有一处能回答
   实测就是这样：`CharDef.special` 在数据表里活了很久，直到这一轮才被发现
   （`data_items.ts` 的 SPECIALS 是同一个坑早已被修过一次的地方）。

   所以这里把**字段 → 家族**的对应也变成声明，由 `test/data-contract.mjs`
   做一次扫描：每个在数据里被写成字符串的 `*Def` 字段，要么声明了家族，
   要么在豁免清单里写明理由（文案 / 复合值 / 存档字段）。漏一个就红 ——
   于是"新加一个机制族却忘了立表"从"没人会注意到"变成"自检会红"。

   两条刻意的宽松：
     · **同一个字段可以有多个家族**。`special` 在 `ItemDef` 里是 `itemSpecial`
       （道具机制），在 `CharDef` 里是 `charSpecial`（角色机制）—— 同名不同域是
       **事实**，硬要求"一个字段一个家族"只会逼人给其中一个改个不诚实的名字。
     · **重复声明同一对是幂等的**。同一张表分散在武器/道具/词条三个模块里
       （`tier` / `kind` / `icon` / `tags` 都被多处引用），
       要求"只许声明一次"等于逼人挑一个模块当"主人"，而那并不是设计上的事实。
   ========================================================= */
var FIELD_FAMILY: Record<string, string[]> = Object.create(null);

/**
 * 声明"数据表上的这个字段，值属于哪个家族"。
 * @param field  字段名（`behavior` / `special` / `element` …）
 * @param family 家族名（必须已登记；两边对不上由 `test/data-contract.mjs` 报出来）
 */
Registry.uses = function (field, family) {
  if (!field || typeof field !== 'string') throw new Error('registry: uses 需要字段名');
  if (!family || typeof family !== 'string') throw new Error('registry: uses 需要家族名');
  var list = FIELD_FAMILY[field] || (FIELD_FAMILY[field] = []);
  if (list.indexOf(family) < 0) list.push(family);
  return family;
};

/** 字段 → 家族的只读快照（守卫与报告都读它） */
Registry.fieldFamilies = function () {
  var out: Record<string, string[]> = {};
  for (var k in FIELD_FAMILY) {
    if (Object.prototype.hasOwnProperty.call(FIELD_FAMILY, k)) out[k] = FIELD_FAMILY[k].slice();
  }
  return out;
};

/* =========================================================
   条目 / 取值
   ========================================================= */
/** 家族的全部条目 id（有 entries 用 id，否则用 values） */
Registry.ids = function (name) {
  var f = FAMILIES[name];
  if (!f) throw new Error('registry: 未注册的家族 ' + name);
  if (f.entries) return f.entries().map(function (e) { return String(e.id); });
  return (f.values ? f.values() : []).map(String);
};
Registry.count = function (name) { return Registry.ids(name).length; };

/* =========================================================
   审计：一次跑完所有交叉引用
   ========================================================= */
/**
 * @returns {{ok, problems: {family,id,field,value,target,reason}[], counts, missing}}
 */
Registry.audit = function () {
  var problems = [];
  var counts: Record<string, number> = {};
  var missing: string[] = [];

  for (var ni = 0; ni < NAMES.length; ni++) {
    var name = NAMES[ni];
    var f = FAMILIES[name];
    var list = f.entries ? f.entries() : [];
    counts[name] = f.entries ? list.length : (f.values ? f.values().length : 0);

    // 条目自身：id 不能空、不能重复
    var seen: Record<string, boolean> = Object.create(null);
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (!e || e.id === undefined || e.id === null || e.id === '') {
        problems.push({ family: name, id: '(空)', field: 'id', value: '', target: name, reason: 'id 缺失' });
        continue;
      }
      var id = String(e.id);
      if (seen[id]) {
        problems.push({ family: name, id: id, field: 'id', value: id, target: name, reason: 'id 重复' });
      }
      seen[id] = true;

      // 交叉引用：值必须在目标家族里
      var refs = e.refs || [];
      for (var r = 0; r < refs.length; r++) {
        var ref = refs[r];
        if (ref.value === undefined || ref.value === null) continue;   // 缺省值由目标家族定
        var vals = String(ref.value);
        if (!FAMILIES[ref.family]) {
          missing.push(name + '.' + id + '.' + ref.field + ' → ' + ref.family);
          continue;
        }
        if (Registry.ids(ref.family).indexOf(vals) < 0) {
          problems.push({
            family: name, id: id, field: ref.field, value: vals,
            target: ref.family, reason: '目标家族里没有这个值'
          });
        }
      }
    }
  }
  return { ok: problems.length === 0 && missing.length === 0, problems: problems, counts: counts, missing: missing };
};

/** 审计结果转成人话（失败信息 / 启动日志都用它） */
Registry.describe = function () {
  var a = Registry.audit();
  var lines = ['扩展点总账：' + NAMES.length + ' 个家族'];
  for (var i = 0; i < NAMES.length; i++) {
    var f = FAMILIES[NAMES[i]];
    lines.push('  ' + NAMES[i].padEnd(14) + String(a.counts[NAMES[i]]).padStart(4) + ' 条   ' +
      f.note + (f.owner ? '（' + f.owner + '）' : ''));
  }
  if (!a.ok) {
    lines.push('  审计未通过：');
    for (var p = 0; p < a.problems.length; p++) {
      var x = a.problems[p];
      lines.push('    ✗ ' + x.family + '.' + x.id + '.' + x.field + ' = ' + x.value +
        ' 不在 ' + x.target + ' 里（' + x.reason + '）');
    }
    for (var m = 0; m < a.missing.length; m++) lines.push('    ✗ 引用了未注册的家族：' + a.missing[m]);
  }
  return lines.join('\n');
};

export { Registry };
