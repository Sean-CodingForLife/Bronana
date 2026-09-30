/* =========================================================
enemies.ts — 异形小怪图鉴（诡异简约 / 粗线条卡通）
shape 字段决定程序化造型，统一浓黑描边 + 纯色平涂
========================================================= */

import { SelfCheck } from './selfcheck.ts';
import { Curves } from './curves.ts';
import { Danger } from './danger.ts';
import { Registry } from './registry.ts';
import { U } from './utils.ts';
var E = {} as EnemiesApi;

/**
 * hp0/dmg0 为第 1 波基准值，后续按波次成长
 *  hp = hp0 * (1 + 0.30*(wave-1) + 0.045*(wave-1)^2)
 *  dmg= dmg0 * (1 + 0.16*(wave-1))
 */
E.LIST = [
  {
    id: 'grub', name: '异形幼虫', shape: 'blob', color: '#8f6fae', dark: '#6b5086',
    hp0: 6, speed: 54, dmg0: 2, scale: 1.0, cost: 1, eyes: 1, mouth: 'none',
    legs: 'nub', minWave: 1, behavior: 'chase'
  },
  {
    id: 'spike', name: '尖刺兽', shape: 'spiky', color: '#4f9d69', dark: '#37734c',
    hp0: 9, speed: 88, dmg0: 3, scale: 0.95, cost: 2, eyes: 2, mouth: 'angry',
    legs: 'nub', minWave: 2, behavior: 'chase'
  },
  {
    id: 'spitter', name: '酸液喷射者', shape: 'jelly', color: '#5f8fc4', dark: '#426a97',
    hp0: 14, speed: 40, dmg0: 2, scale: 1.05, cost: 3, eyes: 3, mouth: 'open',
    legs: 'tentacle', minWave: 3, behavior: 'ranged', atkCd: 2.0, projSpeed: 240, projDmg: 4,
    keepDist: 200, projColor: '#8ab84f', pattern: 'single'
  },
  {
    id: 'brute', name: '重装巨块', shape: 'blob', color: '#b0603c', dark: '#83442a',
    hp0: 40, speed: 34, dmg0: 6, scale: 1.55, cost: 4, eyes: 2, mouth: 'wave',
    legs: 'thick', minWave: 4, behavior: 'chase', armorFlat: 5
  },
  {
    id: 'splitter', name: '分裂粘体', shape: 'blob', color: '#8ab84f', dark: '#5a7a2f',
    hp0: 20, speed: 46, dmg0: 3, scale: 1.25, cost: 3, eyes: 1, mouth: 'flat',
    legs: 'nub', minWave: 5, behavior: 'chase', splitInto: { id: 'splitling', count: 3 }
  },
  {
    id: 'splitling', name: '粘体碎块', shape: 'blob', color: '#a8cc6f', dark: '#7a9a45',
    hp0: 7, speed: 74, dmg0: 2, scale: 0.7, cost: 1, eyes: 1, mouth: 'none',
    legs: 'nub', minWave: 99, behavior: 'chase'
  },
  {
    id: 'orbiter', name: '浮游之眼', shape: 'eye', color: '#c96f9a', dark: '#9a4e73',
    hp0: 11, speed: 62, dmg0: 2, scale: 1.0, cost: 3, eyes: 1, mouth: 'none',
    legs: 'float', minWave: 4, behavior: 'ranged', atkCd: 2.4, projSpeed: 200, projDmg: 4,
    keepDist: 170, projColor: '#c96f9a', pattern: 'ring', ringCount: 6
  },
  {
    id: 'exploder', name: '爆裂菌', shape: 'spiky', color: '#d9a83c', dark: '#a87d24',
    hp0: 12, speed: 78, dmg0: 1, scale: 1.05, cost: 3, eyes: 2, mouth: 'open',
    legs: 'nub', minWave: 6, behavior: 'chase', explodeOnDeath: { dmg: 7, radius: 74 }
  },
  {
    id: 'shielder', name: '孢子牧者', shape: 'jelly', color: '#7d8a5a', dark: '#5a6440',
    hp0: 22, speed: 42, dmg0: 2, scale: 1.15, cost: 4, eyes: 2, mouth: 'flat',
    legs: 'tentacle', minWave: 7, behavior: 'chase', healAura: { radius: 130, hps: 2.2 }
  },
  /* ---- 四位 Boss（G3）----
     它们不是"同一只怪换数值"，而是四种**不同的应对方式**：
       荒原暴君 warden    —— 缓慢压上来 + 扇形弹幕（考走位）
       掘地者   digger    —— 钻地期间打不到、从脚下冒出来（考"什么时候该拉开"）
       母巢     brood     —— 不停召唤小怪 + 环形酸弹（考清场与集火）
       钟摆     pendulum  —— 按节拍扫射一整条弧线（考横移时机）
     id 与 story.ts 的碎片来源一一对应（boss:warden / digger / brood / pendulum）。 */
  {
    id: 'warden', name: '荒原暴君', shape: 'blob', color: '#4a423b', dark: '#2c2724',
    hp0: 420, speed: 32, dmg0: 10, scale: 3.0, cost: 30, eyes: 3, mouth: 'angry',
    legs: 'thick', minWave: 5, behavior: 'boss', atkCd: 2.2, projSpeed: 240, projDmg: 7,
    keepDist: 0, projColor: '#e2564f', pattern: 'fan', fanCount: 7, armorFlat: 8,
    boss: true
  },
  {
    id: 'digger', name: '掘地者', shape: 'spiky', color: '#7a5a3c', dark: '#4f3a26',
    hp0: 380, speed: 46, dmg0: 11, scale: 2.6, cost: 30, eyes: 1, mouth: 'angry',
    legs: 'thick', minWave: 5, behavior: 'burrow', atkCd: 2.0, projSpeed: 260, projDmg: 8,
    keepDist: 0, projColor: '#d9a83c', pattern: 'ring', ringCount: 8, armorFlat: 5,
    boss: true
  },
  {
    id: 'brood', name: '母巢', shape: 'jelly', color: '#6f8f4a', dark: '#4a6330',
    hp0: 460, speed: 26, dmg0: 9, scale: 2.9, cost: 30, eyes: 3, mouth: 'open',
    legs: 'tentacle', minWave: 5, behavior: 'summon', atkCd: 2.6, projSpeed: 190, projDmg: 6,
    keepDist: 90, projColor: '#8ab84f', pattern: 'ring', ringCount: 10,
    summonEvery: 3.4, summonIds: ['grub', 'spike'], summonCount: 2,
    boss: true
  },
  {
    id: 'pendulum', name: '钟摆', shape: 'eye', color: '#b08a3c', dark: '#7a5c22',
    hp0: 400, speed: 30, dmg0: 8, scale: 2.7, cost: 30, eyes: 1, mouth: 'none',
    legs: 'float', minWave: 5, behavior: 'metronome', atkCd: 1.35, projSpeed: 300, projDmg: 6,
    keepDist: 150, projColor: '#e8c24a', pattern: 'sweep', sweepCount: 9, sweepArc: 1.5,
    boss: true
  }
];

/* 无原型表 —— 与 data_chars / data_items / data_weapons 同一条理由：
   存档里的 `bossesDown` 等字段按 id 查这张表，原型键不该被认成真怪物 */
E.BY_ID = Object.create(null);
for (var i = 0; i < E.LIST.length; i++) E.BY_ID[E.LIST[i].id] = E.LIST[i];

/* ---------------- 波次成长（**值住在 `curves.ts`**） ----------------
   **"一步"的含义变了，所以曲线必须摊开**：
   改造前一步 = 一波（20~60 秒），一局约 20 波就通关；
   房间制之后一步 = 一间房（十几秒），一局 3 层 × 十几间 ≈ 40 步。
   曲线形状不动，只把自变量按 PACE 拉长：`equivWave` 回答"第 N 间房等效于旧设计的第几波"。
   PACE = 0.55 时第 39 间 ≈ 旧第 22 波（也就是"一局通关"的水平）。
   为什么不能让怪按原始房间数成长：同一个机器人改造前一局能到第 12 波，
   改造后第 4~5 间就阵亡 —— 曲线一个字没改，步数却翻倍，等于难度陡增一倍。
   这个数是 tools/balance.mjs 的 `pacing` 实验量出来的（见 README）。
   注意 `equivWave` 是**1 起**的：第 1 间必须等于旧第 1 波，
   否则公式里的常数项（13 + 9w …）会整体缩水，早期房间会突然变空。

   改造后这些式子的**常数搬到了 `src/curves.ts`**：那里一张表同时装着
   角色与怪物两边的成长（以及每条曲线的形状与 why），于是"玩家跟不跟得上"
   第一次能在同一张表上对照。这里只留读法，值与形状都在表里。
   `Curves.audit()` 启动期逐点比对"表算出来的值"与**上面这段注释所记的原式**，
   对不上就抛 —— 所以"搬进表"这件事是可验证的，不靠自觉。 */
E.PACE = 0.55;
/** 第 N 间房等效于旧设计的第几波（1 起）。
 *  **自变量换算只有这一处**：三条成长曲线与刷怪预算都以它为输入，
 *  而 `E.PACE` 本身的值住在 `curves.ts` 的 `meter.pace` 里（表驱动）。 */
E.equivWave = function (wave) { return Curves.at('meter.pace', wave); };
/* 三条成长曲线与刷怪预算：**值住在 `curves.ts`**（一张表里能同时看到角色与怪物两边），
   这里只保留"读法"。每一条的 why 都写在表里 —— 那是它存在的理由。
   `Curves.audit()` 会在启动期逐点比对"表算出来的值"与"改造前那条式子"，
   所以下面这些读点的行为与硬编码时期**逐位相同**。 */
E.hpScale = function (wave) { return Curves.at('enemy.hp', wave); };
E.dmgScale = function (wave) { return Curves.at('enemy.dmg', wave); };
E.speedScale = function (wave) { return Curves.at('enemy.speed', wave); };


/** 本波可用怪物池（按 minWave 解锁） */
E.poolFor = function (wave) {
  var out = [];
  for (var i = 0; i < E.LIST.length; i++) {
    var d = E.LIST[i];
    if (d.boss) continue;
    if (d.id === 'splitling') continue;
    if (d.minWave > wave) continue;
    out.push(d);
  }
  return out;
};

/**
 * 构建一波的刷怪队列
 *
 * 第三个参数是**折叠好的难度修正**（danger.ts 的 DangerMods），键名与 danger.ts 完全一致 ——
 * 故意不做"重命名成 opts.budgetMul 之类"的映射层：那样"声明了却没人读"就只能靠人眼查。
 * 现在键名 = 读取名，静态检查可以逐个确认它在哪被用掉。
 *
 * `mods` 缺省时用 `Danger.BASE`（全是恒等值），所以**不加参数的结果与加参数之前逐位一致**：
 * 预算不变、随机数消耗次数不变、不多刷 Boss。第 0 级必须是恒等，否则行为指纹会当场变。
 *
 * @returns {Array<{id, at, elite, boss?}>}
 */
E.buildWave = function (wave, rnd, mods, boss) {
  var m = mods || Danger.BASE;
  var ew = E.equivWave(wave);
  var poolWave = wave + (Math.max(0, m.poolShift | 0));
  /* 刷怪预算与精英概率：同样来自 `curves.ts`（`spawn.budget` / `enemy.eliteChance`）。
     预算的自变量是 `meter.pace` 换算出来的**旧波次** `ew`（见 `curves.ts` 里那条的 why）。
     脚本末尾的输出顺序与随机数消费次数必须与改造前**逐位一致** ——
     两条曲线都是纯函数、不消费随机数，所以换读法不会动随机流。 */
  var budget = Math.round(Curves.at('spawn.budget', wave) * m.waveBudget);
  var pool = E.poolFor(poolWave);
  var queue = [];
  var t = 0;
  var guard = 0;

  while (budget > 0 && guard++ < 4000) {
    var entries = pool.map(function (d) {
      var w = 1 / d.cost;
      if (d.minWave >= wave - 2) w *= 1.25;           // 新解锁的怪多刷一点
      if (d.cost >= 4) w *= Math.min(1.6, 0.5 + wave * 0.09);
      return { w: w, def: d };
    });
    var def = U.pickWeighted(entries, rnd).def;
    if (def.cost > budget + 2) break;
    budget -= def.cost;
    /* 出怪间隔：三个数全在表里（基值 / 随机幅度 / 收紧系数）。
       表达式形状不变 —— 一变就会动浮点尾数，而这一条是 `rnd()` 的下游。 */
    t += (Curves.at('spawn.gapBase', wave) + rnd() * Curves.at('spawn.gapRand', wave)) *
      Curves.at('spawn.gapTighten', wave);
    queue.push({ id: def.id, at: t, elite: false });
  }

  // 精英化：波次越靠后越容易出现。基础概率与上限保持**原样**，难度加成另加一项 ——
  // 直接抬高上限会静默改掉第 0 级的精英概率（行为指纹会当场变），
  // 所以恒等性靠"加成默认为 0"，而不是靠"新上限恰好不生效"。
  var eliteBase = Curves.at('enemy.eliteChance', wave);
  var eliteChance = eliteBase + m.eliteChance;
  for (var i = 0; i < queue.length; i++) {
    if (rnd() < eliteChance) queue[i].elite = true;
  }

  // Boss 波：基准每 5 波一只；难度可以把间隔压小 —— 但这里是**并集**，
  // 不是替换。用替换会把第 5/10/15/20 波里不满足新间隔的那几波**取消**掉 Boss，
  // 于是"更难"反而少了 Boss（实测踩到过：把间隔改成 4 之后第 10 波没有 Boss 了）。
  //
  // 前面那道 `m.waveBudget > 0` 是房间制之后补的：不刷怪的房（入口/宝箱/商店/营地/事件）
  // 预算为 0，但如果那一"波"正好是 5 的倍数，这条规则会往**空房间**里塞一只 Boss ——
  // 实测：第 5 波的宝箱房刷出了一只 Boss。预算为 0 就是"这一间没有遭遇"，不许例外。
  var isBossWave = m.waveBudget > 0 &&
    ((wave % 5 === 0) || (m.bossEvery > 0 && wave % m.bossEvery === 0));
  if (isBossWave) {
    /* 出哪一只由**层**决定（`game.ts` 传进来），而不是这里随机挑：
       同一层永远是同一只 —— 地图、Boss、剧情碎片三者才不会各说各话。 */
    var bossId = boss || E.BOSSES[0].id;
    var bossAt = Math.max(2, t * 0.35);
    queue.push({ id: bossId, at: bossAt, elite: false, boss: true });
    // "双王"是结构类修正：不是把 Boss 变肉，而是让玩家同时面对两只
    if (m.doubleBoss) queue.push({ id: bossId, at: bossAt, elite: false, boss: true });
  }

  queue.sort(function (a, b) { return a.at - b.at; });
  return queue;
};

/** 每波之间的额外属性成长（用于显示预估） */
E.describeWave = function (wave) {
  return '生命 ×' + E.hpScale(wave).toFixed(1) + ' · 伤害 ×' + E.dmgScale(wave).toFixed(1);
};

/* =========================================================
   Boss 池（G3）
   ---------------------------------------------------------
   "随机 Boss"是这一层的目标，但**随机必须落在一层上**，不能每波掷一次骰子：
     · 同一层的 Boss 永远是同一只 → 地图、Boss、剧情碎片三者一致，
       玩家在层间休息时就能知道"下一层守着谁"
     · 由 (种子, 层号) 纯函数决定 → 同种子 = 同一串 Boss（成绩码可复算、每日挑战可比）
   `doubleBoss`（难度 9）给的是"同一只来两份"，不是"两只不同的" ——
   两条规则叠在一起会让难度 9 变成"随机性更强"，那不是它想表达的东西。
   ========================================================= */
E.BOSSES = E.LIST.filter(function (d) { return !!d.boss; }).map(function (d) {
  return { id: d.id, name: d.name, note: d.name + '（' + d.behavior + ' / ' + (d.pattern || 'single') + '）' };
});

/** 第 floor 层守着谁（纯函数：同种子同层必然同 Boss） */
E.bossFor = function (seed, floor) {
  var rnd = U.rng(U.seedFromStr('boss:' + ((Number(seed) || 0) >>> 0) + ':' + (Math.max(1, Math.floor(Number(floor) || 1)))));
  var i = Math.floor(rnd() * E.BOSSES.length);
  if (i >= E.BOSSES.length) i = E.BOSSES.length - 1;
  return E.BOSSES[i].id;
};

E.audit = function () {
  var problems = [];
  if (E.BOSSES.length < 3) problems.push('Boss 池太浅（' + E.BOSSES.length + ' 只）—— "随机 Boss"会变成同一只反复出现');
  for (var i = 0; i < E.BOSSES.length; i++) {
    var d = E.BY_ID[E.BOSSES[i].id];
    if (!d) { problems.push('Boss 池里的 ' + E.BOSSES[i].id + ' 不在怪物表里'); continue; }
    if (!d.boss) problems.push(d.id + ' 在 Boss 池里却没标 boss');
    if (d.minWave > 5) problems.push(d.id + ' 的解锁波次太晚（' + d.minWave + '）—— 第一层就可能是 Boss 房');
  }
  // 四只 Boss 的应对方式必须**两两不同**，否则"随机"只是换皮
  var sigs: Record<string, boolean> = Object.create(null);
  for (i = 0; i < E.BOSSES.length; i++) {
    var b = E.BY_ID[E.BOSSES[i].id];
    if (!b) continue;
    var sig = (b.behavior || 'chase') + '/' + (b.pattern || 'single');
    if (sigs[sig]) problems.push('两只 Boss 的应对方式完全一样：' + sig);
    sigs[sig] = true;
  }
  return { ok: problems.length === 0, problems: problems, counts: { bosses: E.BOSSES.length } };
};
SelfCheck.register('E', E.audit);

Registry.family('boss', {
  note: 'Boss 池（随机 Boss 的名单；每层由种子决定出哪一只）', owner: 'enemies.ts',
  entries: function () {
    return E.BOSSES.map(function (b) {
      var d = E.BY_ID[b.id] as EnemyDef;
      return {
        id: b.id,
        refs: [
          { field: 'behavior', value: d.behavior || 'chase', family: 'aiBehaviour' },
          { field: 'pattern', value: d.pattern || 'single', family: 'aiPattern' }
        ]
      };
    });
  }
});

/* 登记到扩展点总账：每条怪的 behavior / pattern / shape / legs / mouth 都必须有实现。
   以前 behavior 或 shape 写错只会静默退化（走路但不咬人 / 变成普通 blob），
   现在由 Registry.audit() 一次查出来（见 test/registry.mjs）。 */
Registry.family('enemy', {
  note: '怪物图鉴（数据表）', owner: 'enemies.ts',
  entries: function () {
    return E.LIST.map(function (d) {
      return {
        id: d.id,
        refs: [
          { field: 'behavior', value: d.behavior || 'chase', family: 'aiBehaviour' },
          { field: 'pattern', value: d.pattern || 'single', family: 'aiPattern' },
          { field: 'shape', value: d.shape || 'blob', family: 'enemyShape' },
          { field: 'legs', value: d.legs || 'nub', family: 'enemyLegs' },
          { field: 'mouth', value: d.mouth || 'flat', family: 'enemyMouth' }
        ]
      };
    });
  }
});

export { E as Enemies };
/* 字段 → 家族的声明（守卫读它，见 test/data-contract.mjs）：怪物表是**字段最多**的一张，
   而且每个字段都直接决定"它长什么样 / 怎么动 / 打什么弹幕"。 */
Registry.uses('shape', 'enemyShape');
Registry.uses('legs', 'enemyLegs');
Registry.uses('mouth', 'enemyMouth');
Registry.uses('eyes', 'enemyEye');
Registry.uses('behavior', 'aiBehaviour');
Registry.uses('pattern', 'aiPattern');
Registry.uses('splitInto', 'enemy');
Registry.uses('summonIds', 'enemy');