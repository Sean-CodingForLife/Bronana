/* =========================================================
   data_tiers.ts — 品级表（**唯一**的一张，T1–T5）
   ---------------------------------------------------------
   为什么值得单独一张表：品级在合成系统落地后被写了 **6 遍** ——

     · data_weapons.ts  TIERS / TIER_MAX          （倍率）
     · data_weapons.ts  rollShop 的内联阶梯        （哪一档第几波进池）
     · data_items.ts    maxTierFor 的内联阶梯      （同一句话的第二份）
     · game.ts          宝箱房的内联阶梯 ×2        （第三、第四份）
     · ui.ts            tierName 数组 ×2           （'普通/精良/稀有/传说'）
     · styles.css       --tier1..4                （颜色）

   于是"加一档"要改六处，而且**漏掉任何一处都是静默的**：宝箱永远给不出新档、
   界面写着 T5 却没有颜色、合成到了 T5 却查不到台阶（会静默退化成 T1）。
   T5（神话 · 红）就是被这个结构绊住的那一档 —— 所以先把表立起来，再加档。

   一行一档，每列只有一个读点：
     name  → ui.ts 写卡片角标与提示
     cls   → ui.ts 拼 class（颜色在 styles.css 的 --tierN，由测试守住两边档数一致）
     wave  → capFor()：商店 / 宝箱 / 道具包"这一波最高能给到哪一档"
     dmg/cd/knock/reach/pierce → 合成台阶（data_weapons 的 mulFor / pierceBonus）

   一条纪律：**倍率是台阶，不是绝对值**。`mul(w,'dmg')` = 当前档 ÷ 出身档，
   所以 T1 匕首升到 T5 也追不平"出身就是 T5"的武器（现在没有这种武器），
   而每一级合成的收益都差不多 —— 这正是"要不要花两个格子换一档"的可作答形式。
   ========================================================= */
import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';

var Tiers = {} as TiersApi;

/* =========================================================
   1. 表
   ---------------------------------------------------------
   `wave` 是**解锁波次**：第 16 波起 T5 才算"进池"。
   现在没有 T5 的存量武器/道具（商店不会卖神话档），所以这一列此刻只影响
   `capFor(16+) = 5` 而池子里最高的仍是 T4 —— 换句话说 T5 只能靠**合成**（16 把同名）
   或**淬火**（图纸点开神话档）拿到。这不是漏配，是刻意的：顶档不该在货架上。
   ========================================================= */
Tiers.LIST = [
  {
    tier: 1, name: '普通', cls: 't1', wave: 1,
    dmg: 1.00, cd: 1.00, knock: 1.00, reach: 1.00, pierce: 0
  },
  {
    tier: 2, name: '精良', cls: 't2', wave: 3,
    dmg: 1.50, cd: 0.94, knock: 1.06, reach: 1.03, pierce: 0
  },
  {
    tier: 3, name: '稀有', cls: 't3', wave: 6,
    dmg: 2.10, cd: 0.90, knock: 1.15, reach: 1.06, pierce: 0
  },
  {
    /* T4 起额外给穿透（只对 pierce < 5 的远程生效 —— 喷火器/磁轨炮本来就"打穿一切"，
       再给它加只会把"传说"这两个字变成噪音）。近战拿的是 +10% 攻击半径。 */
    tier: 4, name: '传说', cls: 't4', wave: 10,
    dmg: 3.00, cd: 0.86, knock: 1.30, reach: 1.10, pierce: 1
  },
  {
    /* T5：顶档，红色。穿透给到 2（一发打穿三只）——这是"神话"与"传说"之间
       唯一一处**性质**上的差别，其余仍是台阶（伤害 +43%、冷却 ×0.95）。
       它同时是"成型速度"的刹车：顶档从 8 把同名（T4）变成 16 把（T5）。 */
    tier: 5, name: '神话', cls: 't5', wave: 16,
    dmg: 4.30, cd: 0.82, knock: 1.45, reach: 1.14, pierce: 2
  }
];

Tiers.MAX = Tiers.LIST.length;

Tiers.BY = (function () {
  var m: Record<number, TierRow> = Object.create(null);
  for (var i = 0; i < Tiers.LIST.length; i++) m[Tiers.LIST[i].tier] = Tiers.LIST[i];
  return m;
})();

/** 夹进表里的合法档位（越界一律夹到两端 —— 老存档 / 手写对象都得能活） */
Tiers.clamp = function (t) {
  var n = Math.floor(Number(t) || 0);
  if (!(n >= 1)) return 1;
  return n > Tiers.MAX ? Tiers.MAX : n;
};

Tiers.rowOf = function (t) { return Tiers.BY[Tiers.clamp(t)] || Tiers.LIST[0]; };
Tiers.nameOf = function (t) { return Tiers.rowOf(t).name; };
Tiers.clsOf = function (t) { return Tiers.rowOf(t).cls; };

/**
 * 这一波随机池（商店 / 宝箱 / 道具包）最高能给到哪一档。
 * **唯一**的一份阶梯：以前它在 data_weapons / data_items / game.ts 里各写了一遍。
 */
Tiers.capFor = function (wave) {
  var w = Math.max(1, Math.floor(Number(wave) || 1));
  var out = 1;
  for (var i = 0; i < Tiers.LIST.length; i++) {
    if (Tiers.LIST[i].wave <= w) out = Tiers.LIST[i].tier;
  }
  return out;
};

/**
 * 一批候选里"实际存在的最高档"。
 * 为什么需要它：商店的权重规则是"离顶档多远"给的（顶档 1.0、次顶 1.5、其余 0.9），
 * 而**顶档必须按池子里真实存在的最高档算**，不能按 capFor ——
 * 否则第 16 波起 cap 变成 5、池子里却根本没有 T5，权重会整体平移
 * （T4 从 1.0 变 1.5、T1–T3 全掉到 0.9），"加一档"会偷偷改掉商店的货色分布。
 */
Tiers.topOf = function (list, cap) {
  var top = 0;
  var lim = cap === undefined ? Tiers.MAX : Tiers.clamp(cap);
  for (var i = 0; i < list.length; i++) {
    var t = Math.floor(Number(list[i] && list[i].tier) || 0);
    if (t >= 1 && t <= lim && t > top) top = t;
  }
  return top || lim;
};

/**
 * 定义期自检：一条抓不到错的审计等于装饰，所以它自己也被 SelfCheck 与测试盯着。
 * 查的都是"表被写坏"这类**静默**错误：
 *   · 档位不连续 / 重号（合成查不到台阶 → 静默退化成 T1）
 *   · 台阶不递增（"合了不如再买一把"）
 *   · 解锁波次不递增（后面的档先出现）
 *   · class 名与档位对不上（界面拿到一个不存在的 color 类）
 */
Tiers.audit = function () {
  var problems = [];
  var i;
  for (i = 0; i < Tiers.LIST.length; i++) {
    var d = Tiers.LIST[i];
    if (d.tier !== i + 1) problems.push('档位必须从 1 连续编号：第 ' + (i + 1) + ' 行写着 T' + d.tier);
    if (!d.name) problems.push('T' + d.tier + ' 没有名字');
    if (d.cls !== 't' + d.tier) problems.push('T' + d.tier + ' 的 class 名对不上：' + d.cls);
    if (!(d.dmg > 0 && d.cd > 0 && d.knock > 0 && d.reach > 0)) {
      problems.push('T' + d.tier + ' 的倍率里有非正数');
    }
    if (!(d.pierce >= 0)) problems.push('T' + d.tier + ' 的穿透是负数');
    if (!(d.wave >= 1)) problems.push('T' + d.tier + ' 的解锁波次不合法：' + d.wave);
    if (i > 0) {
      var p = Tiers.LIST[i - 1];
      if (!(d.dmg > p.dmg)) problems.push('T' + d.tier + ' 的伤害台阶没有抬高（' + p.dmg + ' → ' + d.dmg + '）');
      if (!(d.cd <= p.cd)) problems.push('T' + d.tier + ' 的冷却反而更慢（' + p.cd + ' → ' + d.cd + '）');
      if (!(d.reach >= p.reach)) problems.push('T' + d.tier + ' 的射程台阶倒挂');
      if (!(d.wave > p.wave)) problems.push('T' + d.tier + ' 的解锁波次没有往后挪（' + p.wave + ' → ' + d.wave + '）');
      if (!(d.pierce >= p.pierce)) problems.push('T' + d.tier + ' 的穿透反而更少');
    }
  }
  if (!(Tiers.MAX >= 4)) problems.push('品级少于 4 档：合成没有爬的余地');
  if (Tiers.capFor(1) !== 1) problems.push('第 1 波的档位上限应当只有 T1，实得 T' + Tiers.capFor(1));
  if (Tiers.capFor(1e6) !== Tiers.MAX) problems.push('很久之后的波次应当能到顶档');
  return {
    ok: problems.length === 0, problems: problems,
    counts: { tiers: Tiers.LIST.length, top: Tiers.MAX }
  };
};

var verdict = Tiers.audit();
if (!verdict.ok) throw new Error('data_tiers.ts 品级表自检失败：\n' + verdict.problems.join('\n'));
SelfCheck.register('Tiers', Tiers.audit);

/* =========================================================
   2. 登记到扩展点总账
   ---------------------------------------------------------
   以前的家族叫 `weaponTier` 且挂在 data_weapons.ts 上 —— 但品级不是"武器的事"：
   道具也用同一套档位（商店/道具包按 `tier` 分层），界面也要按它取名字与颜色。
   所以它现在有自己的表、自己的家族名 `tier`，武器/道具/界面三处都引用它。
   ========================================================= */
Registry.family('tier', {
  note: '品级阶梯（合成台阶 T1–T5；武器与道具共用同一套）', owner: 'data_tiers.ts',
  entries: function () {
    return Tiers.LIST.map(function (d) { return { id: 'T' + d.tier, refs: [] }; });
  }
});

export { Tiers };
