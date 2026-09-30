/* =========================================================
   danger.ts — 难度阶梯（逐级累加）

   形状取自 Slay the Spire 的 Ascension（那张表我读了全文）：
     · 修正**逐级累加** —— 第 N 级包含 1..N 的全部修正，不是互相替换
     · 前段是数值（更肉更疼），**后段换成结构**（敌人池提前、Boss 双份）
       —— 加数字的边际体验趋近于零，换招才是内容乘数
     · 进度**按角色独立**（存在 profile.perChar[char].danger），
       所以它同时就是"角色养成"的载体：每个角色一条自己的进度条
     · 已解锁的任意一级都能再选，不做"解锁了就必须变强"

   本模块是**纯数据 + 纯函数**：不碰存档、不碰模拟层。
   应用修正的地方在 game.ts，每一处都显式读一个键 ——
   某个键声明了却没人读，等于这条修正是假的（test/danger.mjs 静态守着）。
   ========================================================= */

import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';
import { Fold } from './fold.ts';

var Danger = {} as DangerApi;

/* =========================================================
   1. 修正键与折叠规则
   ========================================================= */
/**
 * 每个键的折叠方式。取值来自 `fold.ts` 的 `foldOp` 家族（`FoldOp` 联合类型）——
 * 写错一个字母当场编译不过，而不是等数值表现不对才被发现
 *（"表现不对"通常会被当成配平问题，这是这类错最难查的原因）。
 *
 * ⚠ 这张表**不是**全项目唯一的折法声明：`boons.MOD_KEYS` / `dungeon.MOD_KEYS` /
 * `data_items.COST_KINDS` 各自声明自己键集的折法。以前 `game.ts` 折 boons 的那一组时
 * 借用了这张表，于是同一个键有两份声明、改一份不会同步（实测：把 boons 的 enemyHp
 * 改成 add，17 道门全绿而两条路径一个加一个乘）。现在折谁的就读谁的表，
 * 重叠键的一致性由 `test/fold.mjs` 的跨表对账守着。
 */
var FOLD: Record<string, FoldOp> = {
  enemyHp: 'mul',
  enemyDmg: 'mul',
  enemySpeed: 'mul',
  waveBudget: 'mul',
  waveTime: 'mul',
  shopPrice: 'mul',
  rerollCost: 'mul',
  startHpFrac: 'mul',
  eliteChance: 'add',
  poolShift: 'add',
  offerCount: 'add',
  bossEvery: 'min',
  doubleBoss: 'or'
};

/**
 * 每个键的**方向**：'up' = 数值越大越难（默认），'down' = 越小越难。
 * 只有 waveTime 是 'down'，而且这不是"风格选择"，是房间制改造逼出来的：
 * 以前它是"这一波要撑多久"（越长越难受），现在是"这一间要在多久内打完"（越短越难受）。
 * 表在这里，所以 test/danger.mjs 的"难度只增不减"检查能按方向判，而不是把这条
 * 当成一次违规 —— 一条被静默忽略的签名反转，正是这类表最容易藏住的东西。
 */
var DIRECTION: Record<string, string> = {
  waveTime: 'down'
};

/** 基准（第 0 级）：全部为恒等值。任何键忘了给默认值都会让第 0 级不等于"没有修正" */
var BASE: DangerMods = {
  enemyHp: 1, enemyDmg: 1, enemySpeed: 1,
  waveBudget: 1, waveTime: 1,
  shopPrice: 1, rerollCost: 1,
  startHpFrac: 1,
  eliteChance: 0, poolShift: 0, offerCount: 0,
  bossEvery: 5,
  doubleBoss: false
};

/** 每个键的说明与它在哪被用掉（给人看，也给测试做静态对照） */
var NOTES: Record<string, string> = {
  enemyHp: '敌人生命倍率（game.ts spawnEnemy）',
  enemyDmg: '敌人伤害倍率（game.ts spawnEnemy）',
  enemySpeed: '敌人移速倍率（game.ts spawnEnemy）',
  waveBudget: '每波刷怪预算倍率（enemies.ts buildWave）',
  waveTime: '房间时限倍率（game.ts startWave）。注意方向：房间制下时限是"多久内打完"，所以**越小越难**',
  shopPrice: '商店售价倍率（market.ts shopRoll / packPrice）',
  rerollCost: '刷新售价倍率（market.ts shopRoll）',
  startHpFrac: '开局生命 = 生命上限 × 此比例（game.ts newSession）',
  eliteChance: '精英概率加成，加到基础公式上（enemies.ts buildWave）',
  poolShift: '怪物池按 wave+N 取（enemies.ts buildWave）。注意：非 Boss 怪在第 7 波就全解锁了，所以这条只在**前几波**有咬合力',
  offerCount: '商店货架件数增减（market.ts shopRoll）',
  bossEvery: '每 N 波出 Boss（与基准的每 5 波取**并集**，所以不会取消原有的 Boss 波；越小越频繁）',
  doubleBoss: 'Boss 波出现两只（enemies.ts buildWave，结构类）'
};

/* =========================================================
   2. 阶梯
   ========================================================= */
var LEVELS: DangerLevelDef[] = [
  { level: 0, name: '平静', note: '基准难度：没有任何修正', mods: {} },
  { level: 1, name: '起风', note: '敌人更耐打', mods: { enemyHp: 1.08 } },
  { level: 2, name: '硬壳', note: '再厚一层', mods: { enemyHp: 1.08 } },
  { level: 3, name: '拥挤', note: '每波刷得更多', mods: { waveBudget: 1.10 } },
  { level: 4, name: '精锐', note: '精英更常见', mods: { eliteChance: 0.03 } },
  { level: 5, name: '涨价', note: '商店与刷新更贵', mods: { shopPrice: 1.10, rerollCost: 1.15 } },
  /* 第 6 级的**方向调转过来了**：房间制之后 waveTime 的含义从"要撑多久"
     变成"多久内打完"。以前 ×1.08（更长 = 更难受）是对的，现在更长 = 更宽松（是福利）。
     所以改成 ×0.92（时限更紧 → 速清奖励更难拿、剩下的怪更容易狂暴），
     这样"迟滞"这一级的**意图**（施加时间压力）才没有被改造悄悄反转。
     这是改造后必须一起改的一处数值，不然后面几级里它会变成帮玩家的。 */
  { level: 6, name: '催命', note: '房间的时限更紧，速清奖励更难拿', mods: { waveTime: 0.92 } },
  { level: 7, name: '凶性', note: '敌人更疼也更快', mods: { enemyDmg: 1.12, enemySpeed: 1.05 } },
  { level: 8, name: '提前', note: '后期的怪提前出场 + Boss 更频繁（结构类：换的是对手，不是数字）', mods: { poolShift: 2, bossEvery: 4 } },
  { level: 9, name: '双王', note: 'Boss 双份 + 开局不满血 + 货架少一件（收尾三级一起压）', mods: { doubleBoss: true, startHpFrac: 0.85, offerCount: -1 } }
];

var BY_LEVEL: Record<number, DangerLevelDef> = Object.create(null);
for (var i = 0; i < LEVELS.length; i++) BY_LEVEL[LEVELS[i].level] = LEVELS[i];

Danger.LIST = LEVELS;
Danger.BY_LEVEL = BY_LEVEL;
Danger.MAX = LEVELS.length - 1;
Danger.BASE = BASE;
Danger.FOLD = FOLD;
Danger.NOTES = NOTES;
Danger.DIRECTION = DIRECTION;

/** 这个键"更难"是变大还是变小（界面与测试都要按它判读） */
Danger.harder = function (key) { return DIRECTION[key] === 'down' ? -1 : 1; };

/* =========================================================
   3. 折叠（纯函数）
   ========================================================= */
function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

/** 把 0..level 全部修正折叠成一份（第 0 级 = BASE，即"没有修正"） */
Danger.modsFor = function (level) {
  var out: any = {};
  for (var k in BASE) out[k] = BASE[k];
  var top = Math.max(0, Math.min(Danger.MAX, Math.floor(num(level))));
  for (var lv = 1; lv <= top; lv++) {
    var def = BY_LEVEL[lv];
    if (!def) continue;
    for (var key in def.mods) {
      if (!Object.prototype.hasOwnProperty.call(def.mods, key)) continue;
      /* 唯一的折法实现（fold.ts）。以前这里是手写的四路 if/else ——
         而同样的四路在 game / dungeon / boons / data_items 里各写了一遍。 */
      out[key] = Fold.apply(FOLD[key], out[key], def.mods[key]);
    }
  }
  return out;
};

Danger.name = function (level) {
  var def = BY_LEVEL[Math.max(0, Math.min(Danger.MAX, Math.floor(num(level))))];
  return def ? def.name : '?';
};
Danger.note = function (level) {
  var def = BY_LEVEL[Math.max(0, Math.min(Danger.MAX, Math.floor(num(level))))];
  return def ? def.note : '';
};

/** 这一级**新增**了什么（界面用：让玩家看清"升这一级会多什么"） */
Danger.deltaOf = function (level) {
  var def = BY_LEVEL[Math.floor(num(level))];
  if (!def) return [];
  var out = [];
  for (var key in def.mods) {
    if (!Object.prototype.hasOwnProperty.call(def.mods, key)) continue;
    out.push({ key: key, value: def.mods[key], how: FOLD[key] || 'add' });
  }
  return out;
};

/** 到这一级为止的**全部**修正（界面用：显示累计效果，而不是只看增量） */
Danger.activeOf = function (level) {
  var mods = Danger.modsFor(level);
  var out = [];
  for (var key in BASE) {
    if (!Object.prototype.hasOwnProperty.call(BASE, key)) continue;
    if (mods[key] === BASE[key]) continue;
    out.push({ key: key, value: mods[key], base: BASE[key], how: FOLD[key] || 'add' });
  }
  return out;
};

/** 一行行给人看的说明 */
Danger.describe = function (level) {
  var lv = Math.max(0, Math.min(Danger.MAX, Math.floor(num(level))));
  var lines = ['难度 ' + lv + ' · ' + Danger.name(lv) + '（' + Danger.note(lv) + '）'];
  var act = Danger.activeOf(lv);
  if (!act.length) lines.push('  没有修正');
  for (var i = 0; i < act.length; i++) {
    var a = act[i];
    lines.push('  ' + a.key.padEnd(14) + (a.how === 'mul' ? '×' + a.value.toFixed(2) : String(a.value)) +
      '   ' + (NOTES[a.key] || ''));
  }
  return lines.join('\n');
};

/* =========================================================
   4. 定义期自检
   ---------------------------------------------------------
   这些判据原先**只存在于 `test/danger.mjs` 里**（40 多条断言）。
   问题不是"没检查"，而是"**只在测试里检查、启动期不跑**" ——
   也就是护栏存在但不在必经之路上：改坏一张表，跑测试才发现得到。

   搬进来的只有**表自身**能验的那些。分界要写清楚：
     · `audit()` 能验：等级连续、键有折叠方式、说明与方向表对得上、没有死键
     · `audit()` **验不了**："这个键有没有人读" —— 那要 `fs.readFileSync` 扫源码，
       是**检查期**的活，留在 `test/danger.mjs` 第 5 节。
   两条校验各管一段，谁都不能替谁。

   每一条都对着一个真实的静默故障：
     · 等级号跳号 → `BY_LEVEL[lv]` 取不到 → 那一级**整个不生效**且不报错
     · 键漏了 `FOLD` → `Fold.apply` 认不出折法、**原样返回**，于是一个本该相乘的
       倍率静默停在基准上（这一级的修正是白写的）—— 数值表里最难查的一类错。
       ⚠ 这条注释以前写的是"`else` 分支按 add 处理"：**代码里从来没有那个 else**，
       漏 `FOLD` 的实际后果是"什么都不做"。注释与实现不符，一并改对了。
     · 键漏了 `NOTES` → 界面那一行说明变成空白，玩家看不到这一级加了什么
     · `DIRECTION` 写了不存在的键 → 那行方向声明永远读不到（形同注释）
     · 某个键没有任何一级用它 → 死配置：它永远等于基准值
   ========================================================= */
var FOLD_KINDS = Fold.LIST.map(function (d) { return d.id; });
var DIRECTIONS = ['up', 'down'];

Danger.audit = function () {
  var problems: string[] = [];
  var i, k;

  /* ---- 等级：连续、有名字、非 0 级都要真的加一条 ---- */
  for (i = 0; i < LEVELS.length; i++) {
    var d = LEVELS[i];
    if (d.level !== i) problems.push('第 ' + i + ' 项的等级号是 ' + d.level + '（必须连续从 0 开始，否则这一级永远取不到）');
    if (!d.name || !d.note) problems.push('第 ' + d.level + ' 级缺名字或说明');
    if (d.level > 0 && !Object.keys(d.mods || {}).length) problems.push('第 ' + d.level + ' 级一条修正都没有（它等于白升一级）');
    for (k in (d.mods || {})) {
      if (!Object.prototype.hasOwnProperty.call(BASE, k)) problems.push('第 ' + d.level + ' 级用了没有基准值的键：' + k);
    }
  }
  if (LEVELS.length < 5) problems.push('阶梯少于 5 级（现在 ' + LEVELS.length + '）：难度曲线立不住');
  if (Object.keys((LEVELS[0] && LEVELS[0].mods) || {}).length) problems.push('第 0 级不是恒等（它带了修正）—— 第 0 级必须等于"没有修正"');
  if (BY_LEVEL[Danger.MAX] !== LEVELS[LEVELS.length - 1]) problems.push('BY_LEVEL 没有覆盖到最高级');

  /* ---- 折叠规则：漏一个就静默不动 ---- */
  for (k in BASE) {
    if (!Object.prototype.hasOwnProperty.call(BASE, k)) continue;
    if (!FOLD[k]) {
      problems.push('修正键 ' + k + ' 没有折叠方式（漏了它这一级的修正**静默不生效**' +
        '—— 四个分支一个都不匹配，值停在基准上）');
    } else if (FOLD_KINDS.indexOf(FOLD[k]) < 0) problems.push('修正键 ' + k + ' 的折叠方式不认识：' + FOLD[k]);
    if (!NOTES[k]) problems.push('修正键 ' + k + ' 没有说明（界面上那一行会是空白）');
  }
  for (k in FOLD) {
    if (!Object.prototype.hasOwnProperty.call(BASE, k)) problems.push('折叠规则里有多余的键：' + k + '（它不在基准里，永远不会被用到）');
  }

  /* ---- 方向：写错了不会有任何症状（界面按它判读"更难"） ---- */
  for (k in DIRECTION) {
    if (!Object.prototype.hasOwnProperty.call(BASE, k)) problems.push('DIRECTION 里的键不存在：' + k);
    else if (DIRECTIONS.indexOf(DIRECTION[k]) < 0) problems.push('DIRECTION[' + k + '] 只能是 up / down，现在是 ' + DIRECTION[k]);
  }

  /* ---- 死键：没有任何一级用它的键永远等于基准 ---- */
  var declared: Record<string, boolean> = Object.create(null);
  for (i = 0; i < LEVELS.length; i++) {
    for (k in (LEVELS[i].mods || {})) declared[k] = true;
  }
  for (k in BASE) {
    if (!Object.prototype.hasOwnProperty.call(BASE, k)) continue;
    if (!declared[k]) problems.push('修正键 ' + k + ' 没有任何一级用到它（死配置：它永远等于基准值）');
  }

  return {
    ok: problems.length === 0, problems: problems,
    counts: { levels: LEVELS.length, mods: Object.keys(BASE).length, folds: Object.keys(FOLD).length }
  };
};

var dangerVerdict = Danger.audit();
if (!dangerVerdict.ok) throw new Error('danger.ts 难度表自检失败：\n' + dangerVerdict.problems.join('\n'));
SelfCheck.register('Danger', Danger.audit);

/* =========================================================
   5. 登记进扩展点总账
   ========================================================= */
Registry.family('dangerLevel', {
  note: '难度阶梯（逐级累加）', owner: 'danger.ts',
  entries: function () {
    return LEVELS.map(function (d) {
      var refs = [];
      for (var k in d.mods) refs.push({ field: 'mods.' + k, value: k, family: 'dangerMod' });
      return { id: String(d.level), refs: refs };
    });
  }
});
Registry.family('dangerMod', {
  note: '难度修正键（声明了却没人读 = 这条修正是假的）', owner: 'danger.ts',
  values: function () { return Object.keys(BASE); }
});

export { Danger };
