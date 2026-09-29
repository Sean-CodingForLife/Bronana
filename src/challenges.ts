/* =========================================================
   challenges.ts — 挑战表（"挑战 → 解锁"的声明式数据）

   形状参照 Brotato 的 Progress 表（那张表我读了全文）：分四组
     · 进程   打到第 N 波    → 解锁角色
     · 累计击杀 / 累计收集   → 解锁武器 / 道具
     · 极限   单局里达到某个属性或行为阈值 → 解锁武器 / 道具
     · 角色   用某个角色打到第 N 波        → 解锁武器 / 道具

   三条设计约束：
   1. **声明式**：每条只写"读哪个指标、至少多少、解锁什么"，不写函数。
      于是它可以被 registry.ts 审计（解锁目标必须真的存在），也能被界面直接列出来。
   2. **纯函数求值**：`evaluate(ctx, isDone)` 不碰存档、不碰 profile，只吃一个
      上下文对象。谁能发奖、发过没有，由调用方（profile.ts）决定 ——
      这样"挑战逻辑"可以脱离存档单独测。
   3. **指标必须是已经存在的数据**：累计值来自 records，本局值来自结算摘要，
      峰值由接线层在每次换波时采样。**不为挑战去改模拟层**。
   ========================================================= */

import { Registry } from './registry.ts';

var Challenges = {} as ChallengesApi;

/* =========================================================
   1. 可用指标（超集；每条挑战只用一个）
   ---------------------------------------------------------
   改名或删指标必须同步这张注释与 test/profile.mjs 的清单 ——
   指标名写错的表现是"挑战永远不完成"，最难查的一类静默故障。
   ========================================================= */
var METRICS: Record<string, string> = {
  // 累计（来自 records，已并入本局）
  runs: '总对局数',
  wins: '胜场',
  bestWave: '历史最高波次',
  bestKills: '单局最多击杀',
  bestLevel: '最高等级',
  totalKills: '累计击杀',
  totalMaterials: '累计收集材料',
  // 本局
  wave: '本局波次',
  level: '本局等级',
  kills: '本局击杀',
  materials: '本局废料',
  damage: '本局累计伤害',
  taken: '本局承受伤害',
  healed: '本局回复量',
  packs: '本局开出的道具包',
  // 本局峰值（接线层在换波时采样）
  maxHarvesting: '单局最高收获',
  maxLuck: '单局最高幸运',
  maxEngineering: '单局最高工程学',
  maxRangedDmg: '单局最高远程伤害',
  maxElementalDmg: '单局最高元素伤害',
  maxMeleeDmg: '单局最高近战伤害',
  maxRange: '单局最高攻击范围',
  maxHp: '单局最高生命上限',
  maxTurrets: '单局同屏最多炮塔',
  maxWeapons: '单局最多武器数',
  minHpWaveEnd: '换波时最低生命',
  // 每角色（带 char 的挑战读 profile.perChar，字段名必须与 PerCharRecord 一致 ——
  // 这层映射是显式的：写错的表现是"角色挑战永远不完成"，而界面上看不出来）
  charBestWave: '该角色最高波次',
  charRuns: '该角色对局数',
  charKills: '该角色累计击杀',
  charWins: '该角色胜场',
  /* ---- 跨局的"探索"指标（G5）：来自档案里的剧情进度 ----
     它们让"隐藏挑战"可以挂在**跨局**的事实上（发现过几间密室、集齐几片记录…），
     而不是只能看单局。喂进来的是 profile 的 story 计数（见 Profile.applyRun）。 */
  storySecrets: '累计发现密室数',
  storyFragments: '已收集记录碎片',
  storyEndings: '已解锁结局',
  storyBosses: '打倒过的器官种类',
  storyFloor: '到过的最深层'
};

/**
 * 角色挑战的指标名 → `PerCharRecord` 的字段名。
 * 不直接用字段名当指标名，是因为 `runs` / `bestWave` 这类名字在 flat 里也有同名项，
 * 两套混在一起后"这条挑战到底读哪里"就看不出来了。
 */
var CHAR_METRICS: Record<string, string> = {
  charBestWave: 'bestWave',
  charRuns: 'runs',
  charKills: 'kills',
  charWins: 'wins'
};

/* =========================================================
   2. 挑战表
   ========================================================= */
function ch(id, group, name, desc, metric, atLeast, unlock, char?) {
  return { id: id, group: group, name: name, desc: desc, metric: metric, atLeast: atLeast, unlock: unlock, char: char || null };
}

/**
 * 隐藏挑战：**没完成之前不在图鉴里出现**（完成了才现身，并留下"你找到过这个"的痕迹）。
 * 它与普通挑战走同一套求值，只是多一个 `secret` 标记 —— 界面按它决定要不要列出来。
 */
function secretCh(id, name, desc, metric, atLeast, unlock) {
  var d: ChallengeDef = ch(id, '隐藏', name, desc, metric, atLeast, unlock);
  d.secret = true;
  return d;
}

var LIST: ChallengeDef[] = [
  /* ---- 进程：打到第 N 波 → 解锁角色 ---- */
  ch('reach_w2', '进程', '站稳脚跟', '一局里打到第 2 波', 'wave', 2, [{ family: 'char', id: 'brawler' }]),
  ch('reach_w4', '进程', '初具规模', '一局里打到第 4 波', 'wave', 4, [{ family: 'char', id: 'mage' }]),
  ch('reach_w6', '进程', '工程思维', '一局里打到第 6 波', 'wave', 6, [{ family: 'char', id: 'engineer' }]),
  ch('reach_w9', '进程', '身法', '一局里打到第 9 波', 'wave', 9, [{ family: 'char', id: 'sprinter' }]),
  ch('reach_w12', '进程', '囤积癖', '一局里打到第 12 波', 'wave', 12, [{ family: 'char', id: 'collector' }]),
  ch('reach_w15', '进程', '双持之道', '一局里打到第 15 波', 'wave', 15, [{ family: 'char', id: 'gladiator' }]),
  ch('reach_w18', '进程', '以痛为食', '一局里打到第 18 波', 'wave', 18, [{ family: 'char', id: 'masochist' }]),

  /* ---- 累计击杀 → 解锁武器 ---- */
  ch('kill_300', '累计击杀', '收割者 I', '累计击杀 300 个怪物', 'totalKills', 300, [{ family: 'weapon', id: 'axe' }]),
  ch('kill_2000', '累计击杀', '收割者 II', '累计击杀 2000 个怪物', 'totalKills', 2000, [{ family: 'weapon', id: 'shotgun' }]),
  ch('kill_5000', '累计击杀', '收割者 III', '累计击杀 5000 个怪物', 'totalKills', 5000, [{ family: 'weapon', id: 'railgun' }]),
  ch('kill_20000', '累计击杀', '收割者 IV', '累计击杀 20000 个怪物', 'totalKills', 20000, [{ family: 'weapon', id: 'minigun' }]),

  /* ---- 累计收集 → 解锁道具 ---- */
  ch('gather_300', '累计收集', '采集者 I', '累计收集 300 材料', 'totalMaterials', 300, [{ family: 'item', id: 'whetstone' }]),
  ch('gather_2000', '累计收集', '采集者 II', '累计收集 2000 材料', 'totalMaterials', 2000, [{ family: 'item', id: 'bionic' }]),
  ch('gather_5000', '累计收集', '采集者 III', '累计收集 5000 材料', 'totalMaterials', 5000, [{ family: 'item', id: 'exo' }]),
  ch('gather_10000', '累计收集', '采集者 IV', '累计收集 10000 材料', 'totalMaterials', 10000, [{ family: 'item', id: 'duplicator' }]),

  /* ---- 极限：单局阈值 ---- */
  ch('extrem_harvest', '极限', '农业', '单局把收获堆到 120', 'maxHarvesting', 120, [{ family: 'item', id: 'treadmill' }]),
  ch('extrem_turrets', '极限', '施工队', '单局同时存在 4 座炮塔', 'maxTurrets', 4, [{ family: 'item', id: 'turretitem' }]),
  ch('extrem_full', '极限', '满配', '单局把 6 个武器槽全部填满', 'maxWeapons', 6, [{ family: 'weapon', id: 'plasma' }]),
  ch('extrem_luck', '极限', '走运', '单局把幸运堆到 40', 'maxLuck', 40, [{ family: 'item', id: 'amulet' }]),
  ch('extrem_packs', '极限', '开箱狂', '单局开出 5 个道具包', 'packs', 5, [{ family: 'item', id: 'nano' }]),
  ch('extrem_1hp', '极限', '险胜', '只剩 1 点生命时结束一波', 'minHpWaveEnd', 1, [{ family: 'item', id: 'berserk' }]),

  /* ---- 角色 ---- */
  ch('char_brawler', '角色', '狂战士的功课', '用狂战士打到第 8 波', 'charBestWave', 8, [{ family: 'weapon', id: 'hammer' }], 'brawler'),
  ch('char_mage', '角色', '法师的功课', '用元素法师打到第 10 波', 'charBestWave', 10, [{ family: 'item', id: 'lens' }], 'mage'),
  ch('char_engineer', '角色', '工程师的功课', '用工程师打到第 10 波', 'charBestWave', 10, [{ family: 'weapon', id: 'mutantgun' }], 'engineer'),
  ch('char_sprinter', '角色', '疾行者的功课', '用疾行者打到第 10 波', 'charBestWave', 10, [{ family: 'item', id: 'scanner' }], 'sprinter'),
  ch('char_collector', '角色', '收藏家的功课', '用收藏家打到第 12 波', 'charBestWave', 12, [{ family: 'item', id: 'charcoal' }], 'collector'),

  /* ---- 隐藏：跨局的探索（G5）——没做完之前图鉴里根本看不到它们 ----
     它们奖励的不是"更能打"，而是"去看了不该看的地方"：
     破墙、集齐记录、打通全部器官。 */
  secretCh('hidden_wall', '墙里有什么', '累计发现 6 间密室', 'storySecrets', 6,
    [{ family: 'char', id: 'mole' }]),
  secretCh('hidden_organs', '四个器官', '把四个器官都打下来过', 'storyBosses', 4,
    [{ family: 'weapon', id: 'quake' }]),
  secretCh('hidden_letter', '收信人', '解锁真结局「回信」', 'storyEndings', 4,
    [{ family: 'item', id: 'ripper' }])
];

var BY_ID: Record<string, any> = Object.create(null);
for (var i = 0; i < LIST.length; i++) BY_ID[LIST[i].id] = LIST[i];

Challenges.LIST = LIST;
Challenges.BY_ID = BY_ID;
Challenges.METRICS = METRICS;
Challenges.CHAR_METRICS = CHAR_METRICS;

/* =========================================================
   3. 求值（纯函数：不碰存档、不碰 profile）
   ========================================================= */
/**
 * 把"一局的观察值 + 累计 + 每角色记录"摊平成一张指标表。
 * @param run     { char, wave, level, kills, scrap, damage, taken, healed, packs, win, peaks? }
 * @param totals  Save.records()（已并入本局）
 * @param perChar profile 的每角色记录
 */
Challenges.context = function (run, totals, perChar, story) {
  var r: ProfileRunInput = run || ({} as ProfileRunInput);
  var t: Record<string, number> = totals || {};
  var peaks: Record<string, number> = r.peaks || {};
  var st = (story || {}) as ChallengeStoryInput;
  var flat: Record<string, number> = {
    runs: n(t.runs), wins: n(t.wins), bestWave: n(t.bestWave), bestKills: n(t.bestKills),
    bestLevel: n(t.bestLevel), totalKills: n(t.totalKills), totalMaterials: n(t.totalMaterials),
    wave: n(r.wave), level: n(r.level), kills: n(r.kills), materials: n(r.scrap),
    damage: n(r.damage), taken: n(r.taken), healed: n(r.healed), packs: n(r.packs),
    // 跨局的探索进度（G5 的隐藏挑战读它们；没有档案时全是 0）
    storySecrets: n(st.secrets), storyFragments: n(st.fragments), storyEndings: n(st.endings),
    storyBosses: n(st.bosses), storyFloor: n(st.bestFloor)
  };
  for (var m in METRICS) {
    if (Object.prototype.hasOwnProperty.call(flat, m)) continue;
    flat[m] = n(peaks[m]);
  }
  // 一次都没采样到换波生命时，"只剩 1 点生命"不该被空值满足
  if (!isFinite(Number(peaks.minHpWaveEnd))) flat.minHpWaveEnd = 0;
  return { flat: flat, perChar: perChar || {}, char: r.char || '' };
};

function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }

/** 某条挑战当前的指标读数 */
Challenges.valueOf = function (def, ctx) {
  if (!def || !ctx) return 0;
  if (def.char) {
    // 角色挑战：指标名先过一层映射，再读该角色的记录
    var field = CHAR_METRICS[def.metric];
    if (!field) return 0;
    var pc = ctx.perChar && ctx.perChar[def.char];
    return pc ? n(pc[field]) : 0;
  }
  return n(ctx.flat && ctx.flat[def.metric]);
};

/** 界面的进度条用：{ value, atLeast, done } */
Challenges.progress = function (def, ctx, isDone) {
  var v = Challenges.valueOf(def, ctx);
  return { value: v, atLeast: def.atLeast, done: !!(isDone && isDone(def.id) || v >= def.atLeast) };
};

/**
 * 求值：返回**这次新完成**的挑战定义（已完成的由 isDone 过滤掉）。
 * @param isDone (challengeId) => boolean
 */
Challenges.evaluate = function (ctx, isDone) {
  var out = [];
  for (var i = 0; i < LIST.length; i++) {
    var d = LIST[i];
    if (isDone && isDone(d.id)) continue;
    if (Challenges.valueOf(d, ctx) >= d.atLeast) out.push(d);
  }
  return out;
};

/** 分组清单（界面按它分区显示；顺序即表里的出现顺序） */
Challenges.groups = function () {
  var out = [];
  for (var i = 0; i < LIST.length; i++) {
    if (out.indexOf(LIST[i].group) < 0) out.push(LIST[i].group);
  }
  return out;
};

/**
 * 图鉴里**该列出来**的挑战：隐藏的那几条在没完成之前不出现
 * （完成了才现身 —— 于是"图鉴里突然多了一条"本身就是一次发现）。
 * @param isDone (id) => boolean
 */
Challenges.visible = function (isDone) {
  var out = [];
  for (var i = 0; i < LIST.length; i++) {
    if (LIST[i].secret && !(isDone && isDone(LIST[i].id))) continue;
    out.push(LIST[i]);
  }
  return out;
};

/** 累计类指标：局外就能显示进度条（其余指标只在单局里才有意义） */
var ACCOUNT_METRICS: Record<string, boolean> = {
  runs: true, wins: true, bestWave: true, bestKills: true, bestLevel: true,
  totalKills: true, totalMaterials: true
};

/**
 * 这条挑战的进度该怎么显示。
 * 局外面板上，"累计击杀 320/2000"有意义，而"单局把收获堆到 120"在局外永远是 0 ——
 * 给后者画一个空进度条等于撒谎，所以这里把两类分开。
 * @returns 'account'（累计，可显示进度） | 'char'（该角色记录，可显示进度） | 'run'（单局达成）
 */
Challenges.progressKind = function (def) {
  if (!def) return 'run';
  if (def.char) return 'char';
  return ACCOUNT_METRICS[def.metric] ? 'account' : 'run';
};

Challenges.describe = function () {
  var lines = ['挑战表：' + LIST.length + ' 条（' + Challenges.groups().join(' / ') + '）'];
  for (var i = 0; i < LIST.length; i++) {
    var d = LIST[i];
    var who = d.char ? '[' + d.char + '] ' : '';
    var gives = d.unlock.map(function (u) { return u.family + ':' + u.id; }).join(',');
    lines.push('  ' + d.id.padEnd(16) + d.metric.padEnd(16) + '≥' + String(d.atLeast).padEnd(7) +
      who + '→ ' + gives);
  }
  return lines.join('\n');
};

/* =========================================================
   4. 登记进扩展点总账
   ========================================================= */
Registry.family('challenge', {
  note: '挑战 → 解锁（声明式：指标 + 阈值 + 解锁目标）', owner: 'challenges.ts',
  entries: function () {
    return LIST.map(function (d) {
      return {
        id: d.id,
        refs: d.unlock.map(function (u) {
          return { field: 'unlock', value: u.id, family: u.family };
        })
      };
    });
  }
});
Registry.family('challengeGroup', {
  note: '挑战分组', owner: 'challenges.ts',
  values: function () { return Challenges.groups(); }
});
Registry.family('challengeMetric', {
  note: '挑战可用的指标（写错指标名的表现是"永远不完成"）', owner: 'challenges.ts',
  values: function () { return Object.keys(METRICS); }
});

export { Challenges };
