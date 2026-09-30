/* =========================================================
stats.ts — 属性系统
属性来源：角色初始值 + 升级词条 + 商店道具
========================================================= */

import { Curves } from './curves.ts';
import { U } from './utils.ts';
/** 属性字典：key -> 定义 */
var DEF = {
  maxHp:       { label: '最大生命',   short: '生命',   def: 20,   kind: 'flat',  icon: 'heart' },
  hpRegen:     { label: '生命回复',   short: '回复',   def: 0,    kind: 'flat',  icon: 'heart',  per: '/秒' },
  lifesteal:   { label: '生命窃取',   short: '吸血',   def: 0,    kind: 'pct',   icon: 'heart' },
  damage:      { label: '伤害百分比',     short: '伤害',   def: 0,    kind: 'pct',   icon: 'sword' },
  meleeDmg:    { label: '近战伤害',   short: '近战',   def: 0,    kind: 'flat',  icon: 'axe' },
  rangedDmg:   { label: '远程伤害',   short: '远程',   def: 0,    kind: 'flat',  icon: 'gun' },
  elementalDmg:{ label: '元素伤害',   short: '元素',   def: 0,    kind: 'flat',  icon: 'flame' },
  attackSpeed: { label: '攻击速度',   short: '攻速',   def: 0,    kind: 'pct',   icon: 'bolt' },
  critChance:  { label: '暴击率',     short: '暴击',   def: 0,    kind: 'pct',   icon: 'crit' },
  armor:       { label: '护甲',       short: '护甲',   def: 0,    kind: 'flat',  icon: 'shield' },
  dodge:       { label: '闪避',       short: '闪避',   def: 0,    kind: 'pct',   icon: 'dodge' },
  speed:       { label: '移动速度',   short: '移速',   def: 0,    kind: 'pct',   icon: 'boot' },
  luck:        { label: '幸运',       short: '幸运',   def: 0,    kind: 'flat',  icon: 'clover' },
  harvesting:  { label: '收获',       short: '收获',   def: 0,    kind: 'flat',  icon: 'wheat' },
  pickupRange: { label: '拾取范围',   short: '拾取',   def: 0,    kind: 'flat',  icon: 'magnet' },
  range:       { label: '攻击范围',   short: '范围',   def: 0,    kind: 'pct',   icon: 'scope' },
  engineering: { label: '工程学',     short: '工程',   def: 0,    kind: 'flat',  icon: 'gear' },
  knockbackBonus: { label: '击退强度', short: '击退',  def: 0,    kind: 'pct',   icon: 'glove' },
  consumable:  { label: '消耗品增益', short: '消耗',   def: 0,    kind: 'pct',   icon: 'potion' },
  regen:       { label: '再生',       short: '再生',   def: 0,    kind: 'flat',  icon: 'heart' }
};

var KEYS = Object.keys(DEF);

var Stats = ({
  DEF: DEF,
  KEYS: KEYS,

  /** 空属性表 */
  empty: function () {
    var s = {};
    for (var i = 0; i < KEYS.length; i++) s[KEYS[i]] = 0;
    return s;
  },

  /** 角色基础属性表 */
  base: function () {
    var s = {};
    for (var i = 0; i < KEYS.length; i++) s[KEYS[i]] = DEF[KEYS[i]].def;
    return s;
  },

  pretty: function (key, value) {
    var d = DEF[key];
    if (!d) return U.plus(U.round2(value));
    if (d.kind === 'pct') return U.plusPct(value);
    return U.plus(U.round2(value)) + (d.per || '');
  },

  label: function (key) { return (DEF[key] && DEF[key].label) || key; },
  short: function (key) { return (DEF[key] && DEF[key].short) || key; },

  /** 把属性差异转成可读句子数组 */
  describe: function (map) {
    var out = [];
    for (var k in map) {
      if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
      var v = map[k];
      if (!v) continue;
      out.push({
        key: k,
        value: v,
        text: Stats.pretty(k, v),
        good: v > 0,
        label: Stats.short(k)
      });
    }
    return out;
  },

  /* ---------------- 派生公式 ---------------- */
  /** 实际冷却 = 基础 / (1 + 攻速)，攻速上限 +120% */
  cooldownMul: function (s) {
    return 1 / (1 + Math.max(-0.85, Math.min(1.2, s.attackSpeed)));
  },

  /** 伤害倍率（通用 + 类型特化） */
  damageMul: function (s, weapon) {
    var mul = 1 + s.damage;
    if (weapon) {
      if (weapon.type === 'melee') mul += s.meleeDmg * 0.12;
      else mul += s.rangedDmg * 0.12;
      if (weapon.element) mul += s.elementalDmg * 0.12;
      if (weapon.engineering) mul += s.engineering * 0.12;
    }
    return Math.max(0.1, mul);
  },

  /** 攻击范围倍率 */
  rangeMul: function (s) { return 1 + Math.max(-0.5, s.range); },

  /**
   * 移动速度（像素/秒）：速度加成平方根递减，防止后期快到失控。
   *
   * **负 speed 也要走这条路**（以前是 `var bonus = Math.max(0, s.speed)`：
   * 那让 `Math.sqrt(bonus)` 对任何负数都等于 0，于是 `Math.sign(...)` 那个因子
   * 永远只乘到 0 —— 整条负速分支是死代码）。代价不小：掘进者 -12%、工程师 -5%、
   * 基石「不退」-10% / 「钢铁洪流」-12%、契约「淬火」-8%、装甲套装 -4%/-10%、
   * 厚重护甲 -6% 全都**一点效果都没有**，而界面照样写着"移速 -12%"。
   * 现在按幅值开方、符号照旧 —— 量级很小（-12% ≈ -0.94 px/s），
   * 但"写着减了、其实没减"是数据在说谎，不是平衡。
   */
  moveSpeed: function (s) {
    var bonus = Math.abs(s.speed || 0);
    var eff = Math.sign(s.speed || 0) * Math.min(2.0, Math.sqrt(bonus) * 0.34);
    var base = 205 + CFG.moveSpeedPerPoint * eff;
    return U.clamp(base, 90, 460);
  },

  /**
   * 护甲倍率（**两侧共用**）：`armor` 点的护甲把一击乘成几倍。
   *
   * 为什么必须共用：敌人侧以前是 `dmg = dmg − armorFlat`（每击减**固定值**），
   * 与这里不是同一条公式。固定减伤对**低单击武器是惩罚、对高单击几乎无效**：
   * 第一层 Boss（`warden`，`armorFlat` 3）在房间 5，而开局武器单击只有 3~5 点
   * （`smg` 3 / `turretgun` 4 / `knife` 4 / `pistol` 5）——
   * `max(1, 3−3) = 1` 把 smg「高射速低单击」的定位整个抹掉（单击 −67%），
   * 而同一场里的 `quake`（20 点）只被削 15%。**同一个词条，两种命运。**
   *
   * 危害还不止当下：这个偏差随玩家成长**自己会消失**（后期单击几十点，
   * 3 点减免变 5%~10%），方向正好和"难度递增"相反 ——
   * 早期最狠、后期无感，而护甲本来是拿来表达"这东西很硬"的。
   *
   * 外部依据：Isaac 的护甲是**百分比 + 9% 伤害下限**；Dead Cells 玩家护甲也是百分比。
   * 本作玩家侧本来就是百分比，所以这条只是让敌人侧回到同一个世界观。
   */
  armorMul: function (armor) {
    var a = Number(armor);
    if (!isFinite(a)) a = 0;                              // NaN / ±∞ 的护甲按 0 算，绝不放行 ∞
    return Math.max(0, 1 - Math.min(0.78, a / (Math.abs(a) + 14)));
  },

  /**
   * 护甲减伤：护甲越高收益递减。
   *
   * `armor / (armor + 14)` 在 `armor = -14` 处有一个**极点**：分母跨 0 →
   * `-Infinity` → 倍率 `+Infinity` → `hp -= Infinity` 一击必死（护甲是整数，
   * -14 是能凑出来的：天赋 -5 + 3 件狂战士之心各 -3）。而 `Math.min(0.78, red)`
   * 只封了正侧，于是 -14 以下还**反了**（分子分母同时为负 → red 翻正 →
   * 护甲更差反而更不疼）。只在 -14 那一侧补个夹取是把极点挪个位置，不是修好。
   *
   * 所以分母取 `|armor| + 14`：**正侧逐位不变**（a ≥ 0 时 |a| = a，与改造前同一条公式），
   * 负侧变成一条**单调、有界、无极点**的曲线（-3 → ×1.18、-14 → ×1.5、-∞ → ×1.74）。
   * 语义没变（护甲越低越疼），只是不再爆炸。
   *
   * ⚠ 公式本体已抽到 `armorMul`（敌人侧也要用同一条）—— 这里逐位保持原样：
   * `raw × (1 − red)` 与 `raw × armorMul(a)` 的浮点结果完全相同。
   */
  damageTaken: function (s, raw) {
    return Math.max(1, raw * Stats.armorMul(s.armor));
  },

  critChance: function (s) { return U.clamp(s.critChance, 0, 1); },
  critMul: function () { return 1.85; },

  pickupRadius: function (s) { return 62 + s.pickupRange * 7; },

  /**
   * 升到第 `level` 级要多少经验。
   * **值在 `curves.ts` 的 `player.xp` 里**（power 形状：`6 + 2.6·level^1.34`）。
   * 为什么把它算成"曲线"：它决定**一局能升几级**，而"几级"又决定玩家拿到多少张卡 ——
   * 于是它的一半在 `curves.ts`、另一半在升级卡池（`game.ts` 的 `UPGRADE_POOL`）。
   * 把它放进表里，是为了让"玩家成长"与"怪物成长"能在同一张对照表上比。
   */
  xpNeeded: function (level) {
    return Math.round(Curves.at('player.xp', level));
  }
} as StatsApi);

var CFG = ({ moveSpeedPerPoint: 8 } as CfgApi);

export { Stats, CFG };
