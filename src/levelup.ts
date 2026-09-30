/* =========================================================
   levelup.ts — **升级池**：哪些属性在池里、幅度与权重怎么随等级走
   ---------------------------------------------------------
   改造前这张表住在 `game.ts`（模拟内核）里，和 `rollLevelCards` / `checkLevelUp` /
   `takeLevelCard` 挤在同一节。它搬出来是因为**它本来就不属于内核**：

     · 它是一张**声明表**（"哪些属性可以被抽到、谁是防御向"），
       与 `data_weapons.ts` / `data_items.ts` 是同一类东西 —— 数据，不是逻辑。
     · 它的两条计算（幅度、权重）是**纯函数**：只读 `curves.ts` 与这条声明，
       不碰会话、不掷骰子、不推进时间。

   留在内核里的代价是"数值要在 4100 行里找"：想回答"一次升级能长多少"，
   得先知道有这张表、再找到 `cardAmtAt`、再去 `curves.ts` 查三条曲线。

   ## 与 `curves.ts` 的分工（**改数值去改曲线，改池子才改这张表**）

   幅度**与**权重都是等级的曲线，不是平表：

     · `player.cardAmt`  —— 卡的**幅度**倍率（1.0 → 3.4）
     · `player.cardPool` —— 池的**权重**：等级越高越偏向"站得住"

   为什么两样都要随等级走：改造前是一张固定幅度 + 固定权重的平表，
   于是第 1 级和第 40 级抽到的卡强度一模一样 —— "玩家每级长多少"是一条**平线**，
   而怪的生命是指数（第 39 间 ×27）。两边对不上，成长感全靠"多抽几张卡"。

   ## 掷骰子不在这里

   `rollLevelCards` 留在 `game.ts`：它要写会话（`S.levelCards`）、消费会话的
   随机流（`S.rnd`）、还要发事件（`Game.events.emit('levelCards')`）——
   那三件事都是模拟层的职责。本模块只回答"**有哪些候选、各自的幅度与权重是多少**"。
   ========================================================= */

import { Curves } from './curves.ts';
import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';

var Pool = {} as UpgradePoolApi;

/* =========================================================
   声明表：池里有哪些条目
   ---------------------------------------------------------
   `guard: true` = **防御向**（生命 / 护甲 / 闪避 / 回复 / 吸血）。
   这个标记只有一个作用：它的权重随等级抬（见 `weightAt`）——
   越到后期越该抽得到"站得住"的卡，否则高波次只有输出没有容错。
   ========================================================= */
var POOL: UpgradeEntryDef[] = [
  { key: 'maxHp', amt: 3, w: 10, guard: true },
  { key: 'maxHp', amt: 6, w: 4, guard: true },
  { key: 'hpRegen', amt: 1, w: 5, guard: true },
  { key: 'damage', amt: 0.05, w: 12 },
  { key: 'damage', amt: 0.10, w: 4 },
  { key: 'meleeDmg', amt: 3, w: 8 },
  { key: 'rangedDmg', amt: 3, w: 8 },
  { key: 'elementalDmg', amt: 3, w: 6 },
  { key: 'attackSpeed', amt: 0.08, w: 10 },
  { key: 'attackSpeed', amt: 0.16, w: 3 },
  { key: 'critChance', amt: 0.04, w: 8 },
  { key: 'armor', amt: 2, w: 8, guard: true },
  { key: 'dodge', amt: 0.03, w: 6, guard: true },
  { key: 'speed', amt: 0.06, w: 8 },
  { key: 'luck', amt: 4, w: 6 },
  { key: 'harvesting', amt: 4, w: 6 },
  { key: 'pickupRange', amt: 6, w: 6 },
  { key: 'range', amt: 0.06, w: 6 },
  { key: 'lifesteal', amt: 0.03, w: 5, guard: true },
  { key: 'engineering', amt: 4, w: 5 }
];
Pool.LIST = POOL;

/** 一张升级卡在**当前等级**下的实际幅度（唯一读法；界面与模拟都走它） */
Pool.amountAt = function (entry, level) {
  return entry.amt * Curves.at('player.cardAmt', level);
};

/** 一张升级卡在**当前等级**下的抽中权重（防御向的随等级抬） */
Pool.weightAt = function (entry, level) {
  return entry.guard ? entry.w * Curves.at('player.cardPool', level) : entry.w;
};

/**
 * 按当前等级摊平给"加权抽取"用的一层（`U.pickWeighted` 要的形状）。
 * 抽中之后要拿到原条目，所以这里把 `e` 一起带上 ——
 * 调用方拿 `{ w, e }`，用 `e` 去查 `amountAt`。
 */
Pool.weighted = function (level) {
  var out: Array<{ w: number; e: UpgradeEntryDef }> = [];
  for (var i = 0; i < POOL.length; i++) out.push({ w: Pool.weightAt(POOL[i], level), e: POOL[i] });
  return out;
};

/** 一把卡的**稳定标识**（同 key 同基准幅度算同一张；用来去重，不让一张卡出现两次） */
Pool.cardId = function (entry) { return entry.key + ':' + entry.amt; };

Pool.audit = function () {
  var problems: string[] = [];
  if (POOL.length < 8) problems.push('升级池太小（' + POOL.length + ' 条）：可选性不足');
  var seen: Record<string, boolean> = Object.create(null);
  var guards = 0;
  for (var i = 0; i < POOL.length; i++) {
    var e = POOL[i];
    var id = Pool.cardId(e);
    if (seen[id]) problems.push('升级池里有重复条目：' + id);
    seen[id] = true;
    if (!(e.amt > 0)) problems.push(id + ' 的幅度必须是正数（' + e.amt + '）');
    if (!(e.w > 0)) problems.push(id + ' 的权重必须是正数（' + e.w + '）');
    if (e.guard) guards++;
  }
  /* "防御向至少占五分之一"：这条不是平衡判据，是**这张表还在做它该做的事**的判据。
     全被改成非防御向时，`cardPool` 那条曲线会变成一条永远不动的校验 ——
     它还在表里、还被读，但不再影响任何结果（本项目把这种叫"无效开关"）。 */
  if (guards * 5 < POOL.length) {
    problems.push('防御向条目只有 ' + guards + ' / ' + POOL.length +
      '：`player.cardPool` 曲线会变成无效开关（它抬的就是这些条目的权重）');
  }
  return { ok: problems.length === 0, problems: problems, counts: { entries: POOL.length, guard: guards } };
};

/* ---- 后两步（自检 · 注册）：进必经之路 + 进总账 ----
   与 `data_items.ts` / `data_tiers.ts` / `skills.ts` 同一套写法。
   `Pool.audit` 无参、返回 `{ok, problems}`、且不读任何会话 ——
   所以它能进**启动期**（`SelfCheck.scan()` 在 boot 时跑一遍，不过就抛）。 */
var poolVerdict = Pool.audit();
if (!poolVerdict.ok) throw new Error('levelup.ts 升级池自检失败：\n' + poolVerdict.problems.join('\n'));
SelfCheck.register('UpgradePool', Pool.audit);

Registry.family('upgradeCard', {
  note: '升级池的条目（**幅度与权重都随等级走**，见 curves.ts 的 player.cardAmt / cardPool）',
  owner: 'levelup.ts',
  values: function () { return POOL.map(function (e) { return Pool.cardId(e); }); }
});

export { Pool };
