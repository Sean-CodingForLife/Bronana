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

var Danger = {} as DangerApi;

/* =========================================================
   1. 修正键与折叠规则
   ========================================================= */
/** 每个键的折叠方式：mul 相乘 / add 相加 / or 取真 */
var FOLD: Record<string, string> = {
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
      var how = FOLD[key];
      if (how === 'mul') out[key] = out[key] * def.mods[key];
      else if (how === 'add') out[key] = out[key] + def.mods[key];
      else if (how === 'min') out[key] = Math.min(out[key], def.mods[key]);
      else if (how === 'or') out[key] = out[key] || !!def.mods[key];
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
   4. 登记进扩展点总账
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
