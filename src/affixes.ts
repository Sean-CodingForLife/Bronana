/* =========================================================
   affixes.ts — 词条系统（前缀 / 后缀）
   ---------------------------------------------------------
   问题（改造前）：武器与道具的加成是**写死的** —— 匕首永远是那把匕首，
   `data_weapons.ts` 里 23 行、`data_items.ts` 里 29 行，一眼看到底。
   Roguelite 的随机性全压在"这一波货架上有没有它"上，装备本身没有变量。
   于是"再刷一次"与"捡到的那把"之间没有质变，"货架"是唯一的信息来源。

   取材于三家（都只取它们**被验证过**的那一层，不抄它们的复杂度）：
     · **Diablo / PoE 的前缀+后缀**：两种词条家族各有槽位数上限，
       于是"三前缀"与"两前缀一后缀"是两种不同的东西 —— 词条本身成了取舍。
     · **Last Epoch 的档位阶梯**：每条词条有 1..N 档，档位有门槛（本作是**品级**），
       同一句话在不同档位上是不同量级 —— 于是"这件 T4 值不值"有答案。
     · **Brotato 的纪律**：不给永久属性。词条只加在**这一件**上，
       而且随装备一起被卖掉 / 被合成吃掉 —— 它是一条局内的随机轴，不是养成轴。

   三条刻意的取舍（都有理由）：
     1. **词条只加不减**。带代价的词条（PoE 的"腐化"那一类）在 2 条上限下
        会退化成"只要有代价就不装" —— 没有空间让它成为一个选择。
     2. **数值一律整数**（百分比按千分之一存）。折叠只有整数加法，
        浮点漂移为 0，于是**回放与存档逐位可复现**（这是本项目的老规矩）。
     3. **上限按品级**：T1 一条、T2 两条、T4 起三条。品级本来已经是
        "合成台阶"，现在它同时是"词条上限"—— 不再新增第二条强度轴。

   分工（与别的声明表完全一致，这也是"系统化而不是散落各处"的落地方式）：
     · **本文件**：声明表 + 纯函数（滚动 / 折叠 / 文案 / 审计）。不 import game.ts。
     · `comp.ts`：`AffixSet` 组件（武器与道具各挂一个）。
     · `game.ts`：`recalcStats` 里**一个折叠点**（属性进 stats、武器本地进 wmods），
       以及三个武器数值出口（damage / cd / reach）读 `w.wmods`。
     · `market.ts`：四个**生成点**（货架 / 道具包 / 制造 / 合成）。
     · `ui.ts`：一个渲染函数（`Affix.html`），不写第二份文案。
   于是"加一条词条" = 在 LIST 里加一行；"改一次上限" = 改 `rollCount` 一处。
   ========================================================= */

import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';
import { Stats } from './stats.ts';
import { U } from './utils.ts';
var Affixes = {} as AffixesApi;

/* =========================================================
   1. 绑定槽位：一条词条**能落在哪**
   ---------------------------------------------------------
   做法取自 PoE 的"词缀有装备类别白名单"，但本作没有十几个装备槽，
   只有两条线（武器 / 道具）。所以槽位是**声明式**的一小张表，
   外加一条细分规则 `base:tag`（`armor:heavy` = 只有重型那几件能吃）。
   为什么需要细分：不细分的话"重型护甲 +闪避"这种搭配会到处出现 ——
   而那正是让词条读起来像噪音的原因。
   ========================================================= */
var SLOTS = [
  { base: 'weapon', name: '武器', note: '任何武器；用 `weapon:近战 / 远程 / 工程` 再细分' },
  { base: 'armor', name: '护具', note: '头盔 / 护甲 / 斗篷 / 护符这类"穿在身上"的道具' },
  { base: 'trinket', name: '饰品', note: '幸运 / 拾取 / 收益这一路的小物件' },
  { base: 'gear', name: '工具', note: '工程与精度：护目镜 / 瞄准镜 / 部件' },
  { base: 'consumable', name: '补给', note: '药水 / 食物 / 一次性用品' }
];

/** 槽位细分标签的**唯一**声明（`armor:heavy` 里的 `heavy`）。
    标签从**装备自己**身上读（`WeaponDef.tags` / `ItemDef.tags`）——
    不从 `kind` / `special` 这类别的字段推断：那种推断会让"一件道具有什么标签"
    变成要读代码才知道的事，而它必须和武器/道具表写在一起。 */
var TAGS: Record<string, { name: string; note: string }> = {
  melee: { name: '近战', note: '近战武器（`WeaponDef.tags`）' },
  ranged: { name: '远程', note: '远程武器（`WeaponDef.tags`）' },
  engineering: { name: '工程', note: '工程系武器与工具（`tags: [\'engineering\']`）' },
  heavy: { name: '重型', note: '厚重那一档的护具（`ItemDef.tags`，笨重、护甲高）' }
};

/* =========================================================
   2. 效果键（`mod`）—— **唯一**的一张声明表
   ---------------------------------------------------------
   `scope` 决定这一条折到哪去：
     · 'stat'  并进属性表（和道具 / 升级 / 契约走**同一条**路）
     · 'weapon' 只作用于**这一把**武器（倍率与冷却），不进全局属性表
   `scale` 是"整数 → 真值"的分母（1000 = 千分比，1 = 原值）。
   `mul` 标记乘法键（折叠时相乘、缺省 1），其余是加法键（缺省 0）。

   纪律：属性类的键**必须真的在 Stats 表里**（自检守着）——
   写一个 `Stats` 不认识的键，表现是"词条说它加了护甲，玩家身上什么都没变"，
   而它不会报任何错。这一条与 boons.ts 是同一个坑，所以用同一道门。
   ========================================================= */
var MODS: Record<string, { scope: 'stat' | 'weapon'; note: string; key?: StatKey; mul?: boolean; scale: number }> = {
  /* ---- 武器本地（只看这一把）---- */
  weaponDmgPct: { scope: 'weapon', note: '这把武器的伤害', mul: true, scale: 1000 },
  weaponCdPct: { scope: 'weapon', note: '这把武器的攻击间隔', mul: true, scale: 1000 },
  /* ---- 属性（进全局属性表）---- */
  damage: { scope: 'stat', note: '全局伤害', key: 'damage', scale: 1000 },
  attackSpeed: { scope: 'stat', note: '攻击速度', key: 'attackSpeed', scale: 1000 },
  critChance: { scope: 'stat', note: '暴击率', key: 'critChance', scale: 1000 },
  range: { scope: 'stat', note: '攻击范围', key: 'range', scale: 1000 },
  knockbackBonus: { scope: 'stat', note: '击退强度', key: 'knockbackBonus', scale: 1000 },
  maxHp: { scope: 'stat', note: '最大生命', key: 'maxHp', scale: 1 },
  armor: { scope: 'stat', note: '护甲', key: 'armor', scale: 1 },
  hpRegen: { scope: 'stat', note: '每秒回复', key: 'hpRegen', scale: 1 },
  dodge: { scope: 'stat', note: '闪避', key: 'dodge', scale: 1000 },
  speed: { scope: 'stat', note: '移动速度', key: 'speed', scale: 1000 },
  lifesteal: { scope: 'stat', note: '生命窃取', key: 'lifesteal', scale: 1000 },
  luck: { scope: 'stat', note: '幸运', key: 'luck', scale: 1 },
  pickupRange: { scope: 'stat', note: '拾取范围', key: 'pickupRange', scale: 1 },
  engineering: { scope: 'stat', note: '工程学', key: 'engineering', scale: 1 }
};

/* =========================================================
   3. 词条表
   ---------------------------------------------------------
   一行一条。读法是："这一条每高一档，多给 `per`；一档之内再在
   `per` 到 `per*cap` 之间取一个值。"（`cap` 就是 Last Epoch 那个
   "同一档里也分高低"的手感，不额外引入第二套档位表。）

   前缀 = 进攻（打得更疼 / 更快 / 更远 / 更能暴）
   后缀 = 防护与效用（活得下去 / 拾得更多 / 偷得回来）
   权重 `w` 只影响"滚出来的是哪一条"，不影响强弱 —— 稀有词条不是更强，
   只是更少见（与 Diablo 的 tier 权重同一套手感）。
   ========================================================= */
function pct(per1000: number) { return function (v: number) { return '+' + Math.round(v / 10) + '%'; }; }
function flat(v: number) { return '+' + v; }

var LIST: AffixDef[] = [
  /* ---------------- 前缀（5）---------------- */
  {
    id: 'honed', name: '锋锐', en: 'Honed', family: 'prefix', slots: ['weapon'], mod: 'weaponDmgPct',
    per: 60, cap: 2, scale: 1000, w: 14, text: pct(60)
  },
  {
    id: 'sighted', name: '精密', en: 'Sighted', family: 'prefix', slots: ['weapon'], mod: 'weaponDmgPct',
    per: 80, cap: 2, scale: 1000, w: 12, tags: ['ranged'], text: pct(80)
  },
  {
    id: 'swift', name: '迅捷', en: 'Swift', family: 'prefix', slots: ['weapon'], mod: 'weaponCdPct',
    per: -40, cap: 2, scale: 1000, w: 12, text: function (v) { return '攻击间隔 ' + Math.round(v / 10) + '%'; }
  },
  {
    id: 'brutal', name: '残暴', en: 'Brutal', family: 'prefix', slots: ['weapon'], mod: 'damage',
    per: 40, cap: 2, scale: 1000, w: 11, tags: ['melee'], text: pct(40)
  },
  {
    id: 'focused', name: '专注', en: 'Focused', family: 'prefix', slots: ['weapon', 'gear'], mod: 'critChance',
    per: 30, cap: 2, scale: 1000, w: 10, text: pct(30)
  },
  /* 后缀那一档的"进攻"：射程与推力是**机制**而不是伤害，所以放在这里 */
  {
    id: 'far', name: '远见', en: 'Farsight', family: 'prefix', slots: ['weapon', 'gear'], mod: 'range',
    per: 60, cap: 2, scale: 1000, w: 9, text: pct(60)
  },
  {
    id: 'savage', name: '沉猛', en: 'Savage', family: 'prefix', slots: ['weapon'], mod: 'knockbackBonus',
    per: 120, cap: 2, scale: 1000, w: 8, text: pct(120)
  },
  {
    id: 'clocked', name: '加速', en: 'Clocked', family: 'prefix', slots: ['weapon', 'gear'], mod: 'attackSpeed',
    per: 60, cap: 2, scale: 1000, w: 12, text: pct(60)
  },
  {
    id: 'calibrated', name: '校准', en: 'Calibrated', family: 'prefix', slots: ['weapon', 'gear'], mod: 'engineering',
    per: 3, cap: 2, scale: 1, w: 8, tags: ['engineering'], text: flat
  },

  /* ---------------- 后缀（9）---------------- */
  {
    id: 'vigor', name: '强健', en: 'Vigor', family: 'suffix', slots: ['armor', 'trinket'], mod: 'maxHp',
    per: 3, cap: 2, scale: 1, w: 13, text: flat
  },
  {
    id: 'guarded', name: '守御', en: 'Guarded', family: 'suffix', slots: ['armor'], mod: 'armor',
    per: 2, cap: 2, scale: 1, w: 13, text: flat
  },
  {
    id: 'nimble', name: '灵巧', en: 'Nimble', family: 'suffix', slots: ['armor', 'trinket'], mod: 'dodge',
    per: 25, cap: 2, scale: 1000, w: 9, text: pct(25)
  },
  {
    id: 'fleet', name: '疾行', en: 'Fleet', family: 'suffix', slots: ['trinket'], mod: 'speed',
    per: 50, cap: 2, scale: 1000, w: 10, text: pct(50)
  },
  {
    id: 'mending', name: '疗愈', en: 'Mending', family: 'suffix', slots: ['armor', 'consumable'], mod: 'hpRegen',
    per: 1, cap: 2, scale: 1, w: 9, text: flat
  },
  {
    id: 'leech', name: '汲取', en: 'Leeching', family: 'suffix', slots: ['weapon', 'armor'], mod: 'lifesteal',
    per: 15, cap: 2, scale: 1000, w: 7, text: pct(15)
  },
  {
    id: 'lucky', name: '幸运', en: 'Lucky', family: 'suffix', slots: ['trinket'], mod: 'luck',
    per: 3, cap: 2, scale: 1, w: 10, text: flat
  },
  {
    id: 'greedy', name: '拾荒', en: 'Scavenging', family: 'suffix', slots: ['trinket', 'gear'], mod: 'pickupRange',
    per: 6, cap: 2, scale: 1, w: 8, text: flat
  },
  {
    id: 'stark', name: '朴质', en: 'Stark', family: 'suffix', slots: ['armor', 'consumable', 'gear'], mod: 'armor',
    per: 1, cap: 3, scale: 1, w: 7, text: flat
  },
  /* 一条**只落在重型护具**上的后缀。
     为什么值得单独有一条：`armor:heavy` 这个细分规则如果一条词条都不用它，
     那它就是装饰（自检会当场报"标签声明了却没人用"）。而它本身是本站最自然的
     一条：重型护甲本来就在减移速换护甲，"血更厚"是它唯一合理的延伸。 */
  {
    id: 'bulwark', name: '厚壁', en: 'Bulwark', family: 'suffix', slots: ['armor:heavy'], mod: 'maxHp',
    per: 4, cap: 2, scale: 1, w: 9, text: flat
  }
];

var BY_ID: Record<string, AffixDef> = Object.create(null);
for (var ai = 0; ai < LIST.length; ai++) BY_ID[LIST[ai].id] = LIST[ai];

/* 家族名（界面上把前缀/后缀说清楚；**文案的唯一出处**） */
Affixes.FAMILIES = {
  prefix: { name: '前缀', note: '进攻：打得更疼 / 更快 / 更远' },
  suffix: { name: '后缀', note: '防护与效用：活得下去 / 拿得更多' }
};

/* =========================================================
   4. 槽位与上限
   ========================================================= */
Affixes.SLOTS = SLOTS;
Affixes.MODS = MODS;

/** `armor:heavy` → `{ base: 'armor', tag: 'heavy' }` */
Affixes.parseSlot = function (slot) {
  var s = String(slot || '');
  var i = s.indexOf(':');
  if (i < 0) return { base: s, tag: '' };
  return { base: s.slice(0, i), tag: s.slice(i + 1) };
};

/** 道具的槽位：`data_items.ts` 的 `slot` 字段（缺省 trinket，见那里的说明） */
function itemBase(def) {
  var d = def as ItemDef;
  return d && d.slot ? String(d.slot) : 'trinket';
}

/**
 * 一件装备的绑定槽位。
 * 武器**不看** `kind`（那是造型），看 `type` / `engineering` ——
 * 与 synergy.ts 的家族是同一个理由：一个概念只声明一次。
 */
Affixes.targetSlot = function (kind, def) {
  if (kind === 'weapon') {
    var w = def as WeaponDef;
    if (w && w.engineering) return 'weapon:engineering';
    if (w && w.type === 'melee') return 'weapon:melee';
    if (w && w.type === 'ranged') return 'weapon:ranged';
    return 'weapon';
  }
  return itemBase(def);
};

/**
 * 目标身上的标签（细分槽位与 `tags` 门槛都用它）。
 * 武器：`tags` 声明 + `type` / `engineering` 这两个**玩法事实**（它们本来就在表里，
 * 而且 synergy.ts 的家族也读它们 —— 一个概念只声明一次）。
 * 道具：只读 `tags`（道具没有天然的玩法分类，见 synergy.ts 里道具套装那一段）。
 */
function tagsOf(kind, def) {
  var out: Record<string, boolean> = Object.create(null);
  if (!def) return out;
  var extra = (def as { tags?: string[] }).tags;
  if (extra) for (var i = 0; i < extra.length; i++) out[extra[i]] = true;
  if (kind === 'weapon') {
    var w = def as WeaponDef;
    if (w.type) out[w.type] = true;
    if (w.engineering) out.engineering = true;
  }
  return out;
}
Affixes.tagsOf = tagsOf;

/**
 * 滚动生成时一件装备最多几条。
 *
 * 为什么上限跟着**品级**：品级已经是本作唯一的强度阶梯（合成台阶），
 * 让它同时是"词条上限"就不必再引入第二条轴。
 * T4（传说）起给第三条 —— 三条是"能读到"的上限：再多，卡片一屏放不下，
 * 而且"1 条稀有 vs 1 条好词条"的取舍会被稀释成"数数谁多"。
 */
Affixes.rollCount = function (tier) {
  var t = Math.floor(Number(tier) || 0);
  if (t >= 4) return 3;
  if (t >= 2) return 2;
  return 1;
};

/* =========================================================
   5. 生成（纯函数，随机由调用方给）
   ========================================================= */
/** 空集合（`onSpawn` / 存档 / 老对象共用；**不是 null**，省一层判空） */
Affixes.empty = function () { return { list: [], max: 0 }; };

/** 整数夹取（坏数据防线：`1e999` 这种合法 JSON 也会走到这里） */
function clampInt(v, lo, hi) {
  var n = Math.floor(Number(v));
  if (!isFinite(n)) return lo;
  if (n < lo) return lo;
  return n > hi ? hi : n;
}

/** 打包一条实例：档位与数值都夹进合法范围（**唯一**的构造入口） */
Affixes.make = function (id, tier, rnd) {
  var def = BY_ID[id];
  if (!def) return null;
  var t = clampInt(tier, 1, def.cap);
  var r = (typeof rnd === 'function') ? rnd() : 0;
  if (!(r >= 0 && r < 1)) r = 0;                 // NaN / 1 → 取下限，绝不让 NaN 进数值
  /* 第 t 档的区间按**幅值**算：`|per|*(t-1)+1 .. |per|*t`，符号最后乘回去。
     为什么不写成 `per*(t-1) + (per*r)` 那种"带符号的区间"：
     负 `per` 时它会算出 `-1`（`per=-40, t=1, r≈0`）—— 一个"冷却 -0.1%"的词条，
     占着一个槽位却什么也没做，而且**高档不比低档强**这件事会变得看不出来。
     按幅值算之后，正负两侧的行为逐位对称：T1 拿到的是满幅值的一半左右，
     T2 是满幅值，`cap` 之上不再涨。
     `|per| >= 1` 由自检守着 —— 否则整段幅值算出来的值可能夹到 0。 */
  var mag = Math.abs(def.per);
  var magLo = mag * (t - 1) + 1, magHi = mag * t;
  var v = Math.round(magLo + (magHi - magLo) * r);
  if (v < magLo) v = magLo;
  if (v > magHi) v = magHi;
  return { id: def.id, t: t, v: def.per < 0 ? -v : v };
};

/**
 * 这件装备为什么不能有这一条（'' = 可以）。
 * 分三步说清楚，因为三种"不行"的修法完全不同：
 *   · 槽位不对（这条词条根本不属于这种装备）
 *   · 标签不对（属于这种装备，但这一档细分不要它，比如"重型护甲 +闪避"）
 *   · 已经有了（同一件上不许两条同名 —— 那只会让数值翻倍，读起来还是十行字）
 */
Affixes.wrongReason = function (def, kind, target) {
  if (!def) return '没有这条词条';
  var slot = Affixes.parseSlot(Affixes.targetSlot(kind, target));
  var tg = tagsOf(kind, target);
  var okSlot = false;
  for (var i = 0; i < def.slots.length; i++) {
    var s = Affixes.parseSlot(def.slots[i]);
    if (s.base !== slot.base) continue;
    if (s.tag && !tg[s.tag]) continue;
    okSlot = true;
    break;
  }
  if (!okSlot) return '这条词条落不到 ' + Affixes.targetSlot(kind, target) + ' 上';
  if (def.tags && def.tags.length) {
    for (var t = 0; t < def.tags.length; t++) if (!tg[def.tags[t]]) return '缺少标签 ' + def.tags[t];
  }
  return '';
};

/** 这件装备现在能滚出哪几条（顺序 = LIST 顺序，**这样子集是确定的**） */
Affixes.pool = function (kind, target) {
  var out: AffixDef[] = [];
  for (var i = 0; i < LIST.length; i++) {
    if (Affixes.wrongReason(LIST[i], kind, target) === '') out.push(LIST[i]);
  }
  return out;
};

/**
 * 为一件装备滚一套词条。
 * @param tier 这件装备**当前**的品级（决定条数，也决定每一档的题目上限）
 * @param rnd  调用方的随机源（**模拟层的** —— 与货架/选卡共用一条流）
 *
 * 注意 `rnd` 是**必填**的：不给就退化成 Math.random，回放会分叉。
 * 这是本项目的老规矩（见 utils.ts 里 pickWeighted 的那段说明）。
 */
Affixes.roll = function (kind, target, tier, rnd) {
  var set: AffixSet = { list: [], max: 0 };
  if (typeof rnd !== 'function') return set;
  var want = Affixes.rollCount(tier);
  var cap = Math.floor(Number(tier) || 1);          // 档位上限 = 品级（Last Epoch 的 item level）
  if (cap < 1) cap = 1;
  set.max = want;
  var pool = Affixes.pool(kind, target);
  for (var n = 0; n < want && pool.length; n++) {
    // 家族约束：同一条词条不能重复（Python 那种"同族多条"在本作只会变成数值叠加）
    var cands: Array<{ w: number; def: AffixDef }> = [];
    for (var i = 0; i < pool.length; i++) cands.push({ w: pool[i].w, def: pool[i] });
    if (!cands.length) break;
    var pick = U.pickWeighted(cands, rnd).def;
    var t = cap > pick.cap ? pick.cap : cap;
    var inst = Affixes.make(pick.id, t, rnd);
    if (inst) set.list.push(inst);
    // 从池子里摘掉这一条（同名不重复）
    for (var j = pool.length - 1; j >= 0; j--) if (pool[j].id === pick.id) pool.splice(j, 1);
  }
  return set;
};

/**
 * **词条自己的随机流**（从主随机流的状态派生）。
 *
 * 为什么不直接用主随机流：那样"每件货滚几条词条"会**扰动主序列** ——
 * 于是加一条词条就能改变商店卖什么、接下来刷什么怪、升级卡是哪四张。
 * 对玩家来说这不算 bug（同一颗种子仍然完全可复现），但它让"这一局的内容"
 * 与"词条系统是否改动"绑在一起：调一次词条表就要重跑一堆与词条无关的
 * 行为指纹与对照用例，而那些用例本来在验证别的东西。
 * 派生之后两边解耦：词条由 (主状态, 计数) 唯一决定，主序列一步不动。
 *
 * @param state 主随机流当前的状态（`S.rnd.state()`），没有就退化成固定值
 * @param n     本局第几批（`S.affixN`）。**不连续会变**（不存进存档），
 *              但它是"同一状态下的第 n 批"，所以读档 / 回放逐位可复现。
 */
Affixes.rollStream = function (state, n) {
  var s = (((Number(state) || 0) >>> 0) ^ U.seedFromStr('affix#' + (Number(n) || 0))) >>> 0;
  return U.rng(s || 1);
};

/**
 * 合并两套词条（合成 / 熔接 / 读档合并都用它）。
 * 规则：**各取更好的一条**，然后按 `max` 截断。
 * 为什么不是"两边都留下"：两条同名词条只会让数值翻倍，读起来还是十行字 ——
 * 而"取更好的那一条"让合成有**保底**（副手那把的好词条不会白瞎）。
 */
Affixes.merge = function (a, b, max) {
  var out: AffixSet = { list: [], max: Math.max(0, Math.floor(Number(max) || 0)) };
  var la = (a && a.list) ? a.list : [];
  var lb = (b && b.list) ? b.list : [];
  function put(inst) {
    if (!inst) return;
    for (var i = 0; i < out.list.length; i++) {
      if (out.list[i].id !== inst.id) continue;
      if (inst.v > out.list[i].v) out.list[i] = inst;
      return;
    }
    out.list.push(inst);
  }
  for (var i = 0; i < la.length; i++) put(la[i]);
  for (var j = 0; j < lb.length; j++) put(lb[j]);
  // 排序保证**确定性**（同 id 集合永远同样顺序 → 存档逐位可比）
  out.list.sort(function (x, y) { return x.id < y.id ? -1 : (x.id > y.id ? 1 : 0); });
  var lim = out.max || Math.max(la.length, lb.length);
  if (out.max <= 0) out.max = lim;
  while (out.list.length > lim) out.list.pop();     // 排序后从尾巴截：确定性的
  return out;
};

/**
 * 归一化一件装备身上的词条（读档 / 生成钩子 / 老对象共用）。
 * **认不出的丢掉、坏数值夹回去、超出上限的截掉** —— 与存档层同一条纪律：
 * 能修的修，不能修的丢，绝不因为一条坏词条丢掉整件装备。
 */
Affixes.normalize = function (set, kind) {
  var out: AffixSet = { list: [], max: 0 };
  if (!set || !set.list || !set.list.length) {
    out.max = clampInt(set && set.max, 0, 3);
    return out;
  }
  var seen: Record<string, boolean> = Object.create(null);
  for (var i = 0; i < set.list.length; i++) {
    var raw = set.list[i] as unknown as Record<string, unknown>;
    var id = raw && typeof raw.id === 'string' ? raw.id : '';
    var def = BY_ID[id];
    if (!def || seen[id]) continue;
    seen[id] = true;
    var t = clampInt(raw.t, 1, def.cap);
    var v = Math.floor(Number(raw.v));
    /* 数值必须落在这一档的**合法区间**里（与 `make` 用同一个区间定义）：
       `v` 是外部输入（存档），而它直接进玩家属性 —— 1e9 的 v 等于一枪打穿整个游戏。
       越界一律**按档位重算（取满档）**，而不是夹到边界：
       夹取会给一个"看着像刚好合法"的假值，重算至少是这一档真实的强度。
       区间按幅值算、符号单独还原（与 `make` 一致，见那里的说明）。 */
    var mag = Math.abs(def.per);
    var magLo = mag * (t - 1) + 1, magHi = mag * t;
    var av = Math.abs(v);
    if (!isFinite(v) || av < magLo || av > magHi) av = magHi;
    v = def.per < 0 ? -av : av;
    out.list.push({ id: id, t: t, v: v });
  }
  out.max = clampInt(set.max, out.list.length, 3);
  if (out.max < out.list.length) out.max = out.list.length;
  return out;
};

/* =========================================================
   6. 折叠与文案（纯函数）
   --------------------------------------------------------- */
/** 一条实例 → 真值（整数 ÷ scale） */
function valueOf(inst) {
  var def = BY_ID[inst && inst.id];
  if (!def) return 0;
  return Number(inst.v) / (def.scale || 1);
}
Affixes.valueOf = valueOf;

/** 一条词条 → 一句人话（`withName` 时带上名字与档位） */
Affixes.line = function (inst, opts) {
  var def = BY_ID[inst && inst.id];
  if (!def) return '（认不出的词条）';
  var body = def.text(valueOf(inst));
  if (opts && opts.withName) {
    return def.name + ' T' + clampInt(inst.t, 1, def.cap) + '：' + body;
  }
  return body;
};

/**
 * 一条词条 → 一行 HTML（界面用）。
 * 文案**全部来自表**（`text`）—— 界面只负责包一层颜色，
 * 于是"加一条词条"不需要动 ui.ts 一行。
 */
Affixes.html = function (inst) {
  var def = BY_ID[inst && inst.id];
  if (!def) return '';
  var fam = Affixes.FAMILIES[def.family] ? Affixes.FAMILIES[def.family].name : def.family;
  return '<div class="affix ' + def.family + '" title="' + def.name + ' · ' + fam + ' T' +
    clampInt(inst.t, 1, def.cap) + '">' + def.name + ' ' + def.text(valueOf(inst)) + '</div>';
};

/** 一套词条 → 每一行（纯文本；调试与日志用） */
Affixes.lines = function (set) {
  var out: string[] = [];
  var list = (set && set.list) ? set.list : [];
  for (var i = 0; i < list.length; i++) {
    var def = BY_ID[list[i].id];
    if (def) out.push(def.name + ' ' + def.text(valueOf(list[i])));
  }
  return out;
};

Affixes.fold = function (set) {
  var out: AffixFold = { stats: {}, wmods: {} };
  var list = (set && set.list) ? set.list : [];
  if (!list.length) return out;
  var wmul: Record<string, number> = {};
  for (var i = 0; i < list.length; i++) {
    var def = BY_ID[list[i].id];
    if (!def) continue;
    var meta = MODS[def.mod];
    if (!meta) continue;
    var v = valueOf(list[i]);
    if (meta.scope === 'weapon') {
      wmul[def.mod] = (wmul[def.mod] === undefined ? 1 : wmul[def.mod]) * (1 + v);
    } else if (meta.key) {
      var key = meta.key;
      if (meta.mul) out.stats[key] = (out.stats[key] === undefined ? 1 : out.stats[key]) * (1 + v);
      else out.stats[key] = (out.stats[key] || 0) + v;
    }
  }
  /* 武器本地那一份收进一个固定形状的对象（缺省 = 恒等值）：
     recalcStats 把它整体写在 `w.wmods` 上，武器数值出口直接读 —— 不每帧重新折叠。 */
  out.wmods.weaponDmgPct = wmul.weaponDmgPct === undefined ? 1 : wmul.weaponDmgPct;
  out.wmods.weaponCdPct = wmul.weaponCdPct === undefined ? 1 : wmul.weaponCdPct;
  return out;
};

/** 把一套词条折进一份属性表（就地累加） */
Affixes.applyStats = function (set, out) {
  var f = Affixes.fold(set);
  for (var k in f.stats) {
    if (!Object.prototype.hasOwnProperty.call(f.stats, k)) continue;
    out[k] = (out[k] || 0) + f.stats[k];
  }
  return out;
};

/** 强度（界面排序 / 测试用）：按 mod 归一，只用来比较，不参与玩法 */
Affixes.power = function (set) {
  var list = (set && set.list) ? set.list : [];
  var sum = 0;
  for (var i = 0; i < list.length; i++) {
    var def = BY_ID[list[i].id];
    if (!def) continue;
    sum += (def.scale || 1) * Number(list[i].v);
  }
  return sum;
};

/* =========================================================
   7. 存档形状（**唯一**的序列化处）
   ---------------------------------------------------------
   `[id, 档, 值]` 三元组：比对象省一半体积，而且**没有字段名可以拼错**。
   读档时由 `fromSave` 还原（认不出的 id 丢掉、越界数值按档位重算）——
   与武器/道具的坏档防线完全一致。
   ========================================================= */
Affixes.toSave = function (set) {
  var list = (set && set.list) ? set.list : [];
  var out: Array<[string, number, number]> = [];
  for (var i = 0; i < list.length; i++) out.push([list[i].id, list[i].t, list[i].v]);
  return out;
};

Affixes.fromSave = function (raw, kind, target) {
  var out: AffixSet = { list: [], max: 0 };
  var arr = Array.isArray(raw) ? raw : [];
  for (var i = 0; i < arr.length; i++) {
    var e = arr[i];
    var id = '', t = 1, v = 0;
    if (Array.isArray(e)) { id = String(e[0]); t = Number(e[1]); v = Number(e[2]); }
    else if (e && typeof e === 'object') {
      var o = e as Record<string, unknown>;
      id = typeof o.id === 'string' ? o.id : '';
      t = Number(o.t); v = Number(o.v);
    }
    if (!id) continue;
    out.list.push({ id: id, t: t, v: v });
  }
  var clean = Affixes.normalize(out, kind);
  /* 槽位复核：存档里可能塞了一条"这件装备根本不可能有"的词条
     （改过表 / 手改过档）。丢掉它 —— 留着会让界面显示出这件装备不该有的加成。 */
  if (target) {
    var kept: AffixInst[] = [];
    for (var k = 0; k < clean.list.length; k++) {
      var def = BY_ID[clean.list[k].id];
      if (def && Affixes.wrongReason(def, kind, target) === '') kept.push(clean.list[k]);
    }
    clean.list = kept;
    if (clean.max > 3) clean.max = 3;
  }
  return clean;
};

/* =========================================================
   8. 定义期自检
   ---------------------------------------------------------
   一条抓不到错的审计等于装饰，所以这里每一条都对着一个**真实的静默故障**：
     · `mod` 写错 / 属性键不在 Stats 表里 → 词条写着"护甲 +2"而玩家身上什么都没变
     · `per == 0` / `cap == 0` → 一条什么也不加的词条
     · 槽位写了不存在的 base / tag → 这条词条**永远滚不出来**（玩家看不到，
       作者也看不到：`pool()` 会静默把它过滤掉）
     · 同一个槽位一条词条都没有 → 那种装备永远滚不出词条（"这事不发生"）
     · 某件装备一条词条都滚不出来 → 它**永远是一把白板**，而界面上它
       和别的装备长得一模一样（只是从来没有词条）。这一条要靠武器/道具表，
       所以那两张表在自己的模块末尾用 `Affixes.bindTables` 交进来 ——
       延迟绑定而不是 `import`：顶层 import 会成环
       （data_weapons → affixes → data_weapons）。
   ========================================================= */
var TABLES: Array<{ kind: 'weapon' | 'item'; list: Array<WeaponDef | ItemDef> }> = [];

/** 哪些装备**滚不出词条**（自检与 test/affixes.mjs 共用同一份判据） */
Affixes._blankTargets = function () {
  var out: string[] = [];
  for (var t = 0; t < TABLES.length; t++) {
    var kind = TABLES[t].kind, list = TABLES[t].list;
    for (var i = 0; i < list.length; i++) {
      if (!Affixes.pool(kind, list[i]).length) out.push(kind + ':' + (list[i] as WeaponDef).id);
    }
  }
  return out;
};

/** 把武器/道具表交给词条系统（**单向**：表认识词条，词条不认识表） */
Affixes.bindTables = function (kind, list) {
  for (var i = 0; i < TABLES.length; i++) {
    if (TABLES[i].kind === kind) { TABLES[i].list = list; return; }
  }
  TABLES.push({ kind: kind, list: list });
};

Affixes.audit = function () {
  var problems: string[] = [];
  var seen: Record<string, boolean> = Object.create(null);
  var usedMod: Record<string, boolean> = Object.create(null);
  var usedSlot: Record<string, boolean> = Object.create(null);
  var usedTag: Record<string, boolean> = Object.create(null);
  var statKeys = Stats.base();
  var slotBases: Record<string, boolean> = Object.create(null);
  var i, j, k;
  for (i = 0; i < SLOTS.length; i++) slotBases[SLOTS[i].base] = true;

  for (i = 0; i < LIST.length; i++) {
    var d = LIST[i];
    if (!d.id || seen[d.id]) problems.push('词条 id 重复或为空：' + d.id);
    seen[d.id] = true;
    if (!d.name || !d.en) problems.push(d.id + ' 缺名字（中文/英文都要有，界面与图鉴分别用）');
    if (!Affixes.FAMILIES[d.family]) problems.push(d.id + ' 的家族不存在：' + d.family);
    if (typeof d.text !== 'function') problems.push(d.id + ' 没有文案函数（界面就没有第二份文案可用）');
    var meta = MODS[d.mod];
    if (!meta) { problems.push(d.id + ' 的效果键没声明：' + d.mod); continue; }
    usedMod[d.mod] = true;
    if (meta.scope === 'stat') {
      if (!meta.key || !(meta.key in statKeys)) {
        problems.push(d.id + ' 的属性键 ' + String(meta.key) + ' 不在属性表里（加了也看不见）');
      }
    }
    if (!isFinite(d.per) || d.per === 0) problems.push(d.id + ' 的每档增量是 0（这条什么也不加）');
    /* `|per| >= 1`：取值按幅值算（见 `make`），`per = 0.5` 会让整段区间的整数
       部分塌成 0 —— 那时 `make` 与 `normalize` 会互相打架（一个给 1、一个判 0 越界）。 */
    else if (Math.abs(d.per) < 1) problems.push(d.id + ' 的每档增量小于 1（整数取值会塌成 0）：' + d.per);
    if (!(d.cap >= 1)) problems.push(d.id + ' 的档位上限不合法：' + d.cap);
    if (!isFinite(d.scale) || d.scale <= 0) problems.push(d.id + ' 的还原分母不合法：' + d.scale);
    if (!(d.w > 0)) problems.push(d.id + ' 的权重不是正数');
    if (!d.slots || !d.slots.length) problems.push(d.id + ' 没有绑定槽位');
    for (j = 0; j < (d.slots || []).length; j++) {
      var s = Affixes.parseSlot(d.slots[j]);
      if (!slotBases[s.base]) problems.push(d.id + ' 的槽位不存在：' + d.slots[j]);
      if (s.tag) {
        if (!TAGS[s.tag]) problems.push(d.id + ' 的槽位细分标签不存在：' + s.tag);
        usedTag[s.tag] = true;
      }
      usedSlot[s.base] = true;
    }
    for (k = 0; k < (d.tags || []).length; k++) {
      if (!TAGS[d.tags[k]]) problems.push(d.id + ' 用了未声明的标签：' + d.tags[k]);
      usedTag[d.tags[k]] = true;
    }
  }
  // 每个声明的键都得有人用（声明了没人用 = 界面上永远不出现的那一行）
  for (var mk in MODS) {
    if (Object.prototype.hasOwnProperty.call(MODS, mk) && !usedMod[mk]) {
      problems.push('效果键声明了却没有词条用它：' + mk);
    }
  }
  /* 每个槽位都要有词条 —— 否则"那种装备永远滚不出词条"这件事**不发生**，
     玩家看不到，作者也看不到（`pool()` 会静默返回空数组）。 */
  for (i = 0; i < SLOTS.length; i++) {
    if (!usedSlot[SLOTS[i].base]) problems.push('槽位 ' + SLOTS[i].base + ' 一条词条都没有（那种装备滚不出词条）');
  }
  /* 每个标签也要有人用：声明了没人用 = 那条细分规则是装饰。 */
  for (var tk in TAGS) {
    if (Object.prototype.hasOwnProperty.call(TAGS, tk) && !usedTag[tk]) {
      problems.push('标签声明了却没有任何词条用它：' + tk);
    }
  }
  var nPre = LIST.filter(function (x) { return x.family === 'prefix'; }).length;
  var nSuf = LIST.filter(function (x) { return x.family === 'suffix'; }).length;
  if (nPre < 3) problems.push('前缀太少（' + nPre + '）："三前缀"这种构筑立不住');
  if (nSuf < 3) problems.push('后缀太少（' + nSuf + '）');
  if (LIST.length < 12) problems.push('词条太少（' + LIST.length + '）：同一条会反复见到');
  if (Affixes.rollCount(5) > LIST.length) {
    problems.push('T5 要 ' + Affixes.rollCount(5) + ' 条，但词条只有 ' + LIST.length + ' 条');
  }
  var blank = Affixes._blankTargets();
  for (i = 0; i < blank.length; i++) {
    problems.push(blank[i] + ' 一条词条都滚不出来（槽位或标签写错了）');
  }
  return {
    ok: problems.length === 0, problems: problems,
    counts: { affixes: LIST.length, prefix: nPre, suffix: nSuf, slots: SLOTS.length, tags: Object.keys(TAGS).length, mods: Object.keys(MODS).length }
  };
};

var verdict = Affixes.audit();
if (!verdict.ok) {
  // 定义期就炸（与其它表一个套路：坏表不该等到玩家滚出来才发现）
  throw new Error('affixes.ts 词条表自检失败：\n' + verdict.problems.join('\n'));
}
SelfCheck.register('Affixes', Affixes.audit);

/* =========================================================
   9. 登记到扩展点总账
   ---------------------------------------------------------
   四件跨表引用，每一件漏掉都是**静默**的：
     · `mod` 拼错 → 词条什么也不加（但有文案，看起来像在生效）
     · `slots` 写了不存在的槽位 → 这条词条永远滚不出来
     · `tags` 写了不存在的标签 → 同上
     · 属性键不在 Stats 表里 → 与第一条同类，但更隐蔽（键名看着对）
   ========================================================= */
Affixes.LIST = LIST;
Affixes.BY_ID = BY_ID;
Affixes.TAGS = TAGS;

Registry.family('affix', {
  note: '词条（前缀/后缀，落在装备上的随机加成）', owner: 'affixes.ts',
  entries: function () {
    return LIST.map(function (d) {
      var refs = [
        { field: 'family', value: d.family, family: 'affixFamily' },
        { field: 'mod', value: d.mod, family: 'affixMod' }
      ];
      for (var i = 0; i < (d.slots || []).length; i++) {
        var s = Affixes.parseSlot(d.slots[i]);
        refs.push({ field: 'slots[' + i + ']', value: s.base, family: 'affixSlot' });
        if (s.tag) refs.push({ field: 'slots[' + i + '].tag', value: s.tag, family: 'affixTag' });
      }
      for (var t = 0; t < (d.tags || []).length; t++) {
        refs.push({ field: 'tags[' + t + ']', value: d.tags[t], family: 'affixTag' });
      }
      return { id: d.id, refs: refs };
    });
  }
});
Registry.family('affixFamily', {
  note: '词条家族（前缀 = 进攻 / 后缀 = 防护与效用）', owner: 'affixes.ts',
  values: function () { return Object.keys(Affixes.FAMILIES); }
});
Registry.family('affixSlot', {
  note: '词条的绑定槽位（武器 / 护具 / 饰品 / 工具 / 补给）', owner: 'affixes.ts',
  values: function () { return SLOTS.map(function (s) { return s.base; }); }
});
Registry.family('affixTag', {
  note: '槽位细分与标签门槛（近战 / 远程 / 工程 / 重型）', owner: 'affixes.ts',
  values: function () { return Object.keys(TAGS); }
});
Registry.family('affixMod', {
  note: '词条的效果键（写错 = 这条词条什么也不加，但界面上写着效果）', owner: 'affixes.ts',
  values: function () { return Object.keys(MODS); }
});

export { Affixes };
/* 字段 → 家族的声明（守卫读它，见 test/data-contract.mjs）。 */
Registry.uses('family', 'affixFamily');
Registry.uses('mod', 'affixMod');
Registry.uses('slots', 'affixSlot');
Registry.uses('tags', 'affixTag');