/* =========================================================
   status.ts — 状态系统（R50 点名的第 10 条）
   ---------------------------------------------------------
   用户 2026-10-01 点名的十条系统里，这一条在清单上的原文是：

   > | 10 | **状态** | **没有独立模块**。相近物两处：`boons.ts`（层间契约，265 行）
   >   与 `game.ts` 里那些临时状态（无敌帧 / 狂暴 `rage` / 白闪） | 整个系统
   > | 待确认 ③ | **状态系统** —— 指的是可叠层、有持续时间的 buff / debuff 那一层吗？
   >   它与契约（层间一次选择）、与 `game.ts` 里那些临时状态怎么分工？

   ## 边界（这一节就是那个"待确认"的答案）

   | | 是什么 | 持续多久 | 谁给的 |
   | --- | --- | --- | --- |
   | **契约**（`boons.ts`） | 一层挑一次的**开局条件** | 整层（直到下一层） | 打完 Boss 挑 |
   | **状态**（本模块） | **可叠层、有秒数**的 debuff / buff | 秒 | 命中、技能、道具 |
   | 角色机制（`rage`）/ 受击无敌（`invuln`） | **角色与命中的固有规则** | 由各自的规则算 | 某角色 / 挨打那一刻 |

   ⚠ 后两者**刻意不进这张表**，理由写在下面第 4 节 —— 它们是"命中的一部分"，
     不是"挂在身上的一个状态"。

   ## 为什么需要它（改造前的实测）

   `burn`（灼烧）是**手写**的：`game.ts` 的 `applyBurn()` 里两个魔数
   （`2.2` 秒 / dps 由调用方给），计时散在 `updateEnemies` 的
   `if (e.burn > 0) { e.burn -= dt; … }` 里，而"一共有几种状态、各自多久、
   能不能叠"**没有任何一处能回答**。

   这正是 R35 普查里那一类"有机制、没账本"：加第二种状态时要照着 `burn`
   抄一遍三处（写入 / 计时 / 读数），而漏掉任何一处都不会报错 ——
   表现是"这个状态挂上去了但不会掉"或者"掉了但不生效"。

   现在：**一张表**（`LIST`）+ **一组收口**（`apply` / `tick` / 读数门面）
   + 自检 + 总账登记。加一种状态 = 表里一行。
   ========================================================= */

import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';

var Status = {} as StatusApi;

/* =========================================================
   1. 声明表
   ---------------------------------------------------------
   四种 `kind`（**这是"状态能干什么"的全部可能**）：

     · `dot`     —— 按秒扣血（灼烧）
     · `slow`    —— 乘移动速度（减速）
     · `haste`   —— 乘移速（加速）—— 与 `slow` 同一个读法，只是倍率 > 1
     · `regen`   —— 按秒回血

   ⚠ **倍率与 dps 都由"挂上去那一刻"定**，表里只写**时长与叠法**。
     为什么这么切：倍率是**来源**的属性（这把武器减速 40%、那只 Boss 减速 60%），
     而时长与叠法是**这套系统**的属性。把来源的数抄进表里，加一把武器就要改表 ——
     那就不是"一套系统"了（E13：要求加上的东西都是一套系统，不是个别部分用到的）。
   ========================================================= */
var LIST: StatusDef[] = [
  {
    id: 'burn', name: '灼烧', en: 'Burn', kind: 'dot',
    dur: 2.2, maxStacks: 1, refresh: 'max',
    note: '按秒扣血。火焰元素命中时挂上（`applyElement` 的 burn 那一支）'
  },
  {
    id: 'slow', name: '减速', en: 'Slow', kind: 'slow',
    dur: 1.8, maxStacks: 2, refresh: 'stack',
    note: '移动速度打折。霜冻元素与技能的 `slow` 载荷都挂它 —— **可叠两层**'
  },
  {
    id: 'stun', name: '定身', en: 'Stun', kind: 'stun',
    dur: 0.55, maxStacks: 1, refresh: 'max',
    note: '完全不能动。技能的 `stun` 载荷挂它 —— 短，但它是最强的那一种控制'
  }
];

var BY_ID: Record<string, StatusDef> = Object.create(null);
(function () { for (var i = 0; i < LIST.length; i++) BY_ID[LIST[i].id] = LIST[i]; })();

/** 四种 `kind` 的唯一出处 */
Status.KINDS = ['dot', 'slow', 'haste', 'regen', 'stun'];

/* =========================================================
   2. 收口三件事：挂上 / 计时 / 读数
   ---------------------------------------------------------
   运行时**不另开字段**：状态就存在它作用的那个对象上（敌人 `e.burn` / `e.slow`），
   宿主对象由 `comp.ts` 的原型声明（`Burn` / `Slow` 两个组件）。

   为什么不做成 `e.status: { burn: {…} }` 这样一个字典：那会让**每次读**都多一层
   间接（热路径上是每帧每怪），而组件系统本来就已经把字段声明清楚了。
   字典那一版还有个更贵的代价：坏档 / 池化复用时的残留字段会藏在子对象里，
   而 `Comp` 的字段校验只看顶层。
   ========================================================= */

/** 这个状态的定义（认不出的返回 null） */
Status.byId = function (id) { return BY_ID[String(id || '')] || null; };
/** 这个状态最多挂几层（认不出的按 1 层 —— 坏数据不该让对象挂上无限层） */
Status.maxStacksOf = function (id) {
  var d = BY_ID[String(id || '')];
  return d ? Math.max(1, Math.floor(Number(d.maxStacks) || 1)) : 1;
};

/** 把时长夹回合法区间（NaN / 负数 / 无穷一律按表里的时长） */
function normDur(def, dur) {
  var v = Number(dur);
  if (!isFinite(v) || v <= 0) v = def.dur;
  return Math.max(0.05, Math.min(60, v));
}

/**
 * 挂一个状态上去。
 *
 * @param host 宿主对象（敌人 / 玩家）—— 状态就写在它身上
 * @param id   状态 id（表里没有的**不挂**，返回 0）
 * @param opt  `{ dur, mul, dps }`
 *             · `dur` 覆盖时长（缺省用表里的）
 *             · `mul` `slow` / `haste` 的倍率（0.6 = 慢 40%）
 *             · `dps` `dot` / `regen` 的每秒量
 * @returns 挂上之后的**层数**（0 = 没挂上）
 *
 * 每个状态在宿主上占**三个字段**（命名从 id 推出来，不另开映射表）：
 *
 *   | 字段 | 是什么 |
 *   | --- | --- |
 *   | `e.<id>` | 剩余秒数（计时归零就掉） |
 *   | `e.<id>N` | **层数**（1..maxStacks） |
 *   | `e.<id>Dps` 或 `e.<id>Mul` | 强度：按秒量（dot/regen）或倍率（slow/haste/stun） |
 *
 * ⚠ 层数**必须显式存**（第一版想从"已消耗的时长"反推，那是错的）：
 *   满层的剩余时长是 `maxStacks × dur`，而"刚挂上的 1 层"与"满层的 2 层"
 *   在剩余时长上**可以相等**（后者被夹到上限时）—— 反推于是分不开这两种情况。
 *   自检当场抓住了它（"slow 叠了第二层而层数还是 1"）。
 */
Status.apply = function (host, id, opt) {
  if (!host) return 0;
  var def = BY_ID[String(id || '')];
  if (!def) return 0;
  var o = opt || ({} as StatusApplyOpt);
  var cap = Math.max(1, Math.floor(Number(def.maxStacks) || 1));
  var full = normDur(def, o.dur);
  var cur = Math.max(0, Number(host[def.id]) || 0);
  var curN = Math.max(0, Math.floor(Number(host[def.id + 'N']) || 0));

  var stacks: number;
  var left: number;
  if (def.refresh === 'stack') {
    /* 叠层：层数 +1（夹到上限），时长按**这一层自己的** `full` 补上去 */
    stacks = Math.min(cap, curN + 1);
    left = Math.min(cap * full, cur + full);
  } else {
    /* 不叠：层数保持（至少 1），时长取较长的那个 */
    stacks = Math.max(1, Math.min(cap, curN || 1));
    left = Math.max(cur, full);
  }
  host[def.id] = left;
  host[def.id + 'N'] = stacks;

  /* 强度：`dot` / `regen` 用 `*Dps`，其余用 `*Mul`。取**较大**的那个 ——
     弱的重复命中不该把强的那一层盖成弱的（那是"打着打着不疼了"的经典 bug）。 */
  var strengthKey = def.id + (def.kind === 'dot' || def.kind === 'regen' ? 'Dps' : 'Mul');
  var want = Number(o.dps !== undefined ? o.dps : o.mul);
  if (isFinite(want) && want > 0) {
    var had = Number(host[strengthKey]) || 0;
    host[strengthKey] = Math.max(had, want);
  }
  return stacks;
};

/**
 * 走 `dt` 秒，返回**到期的那几个**（调用方据此做收尾，例如清掉倍率字段）。
 *
 * ⚠ 它**只倒计时**，不算伤害 —— 伤害是模拟层的事，而本模块不认识"血"。
 *   这样切的好处：同一套计时能被"每帧跑一次"与"读档后补算"两条路复用。
 */
Status.tick = function (host, dt) {
  var expired: string[] = [];
  if (!host) return expired;
  var step = Number(dt);
  if (!isFinite(step) || step <= 0) return expired;
  for (var i = 0; i < LIST.length; i++) {
    var def = LIST[i];
    var cur = Number(host[def.id]) || 0;
    if (cur <= 0) continue;
    var next = cur - step;
    if (next <= 0) {
      host[def.id] = 0;
      host[def.id + 'N'] = 0;
      /* 强度字段也要清：留着它等于"下一个人接到上一只怪的火"（池化复用） */
      host[def.id + (def.kind === 'dot' || def.kind === 'regen' ? 'Dps' : 'Mul')] = 0;
      expired.push(def.id);
    } else {
      host[def.id] = next;
    }
  }
  return expired;
};

/** 还剩多少秒（没有就是 0） */
Status.leftOf = function (host, id) {
  return host ? Math.max(0, Number(host[String(id || '')]) || 0) : 0;
};

/** 现在挂了几层（0 = 没挂）—— **显式存的**，见 `apply` 里那段说明 */
Status.stacksOf = function (host, id) {
  var def = BY_ID[String(id || '')];
  if (!def || !host) return 0;
  if ((Number(host[def.id]) || 0) <= 0) return 0;
  var n = Math.max(1, Math.floor(Number(host[def.id + 'N']) || 1));
  return Math.min(Math.max(1, Math.floor(Number(def.maxStacks) || 1)), n);
};

/**
 * **移动倍率**（`slow` / `haste` / `stun` 的唯一读法）。
 *
 * 多个状态同时挂着时**相乘**（慢 40% 再慢 40% = ×0.36）；
 * **`stun` 直接归零** —— 它是"不能动"，不是"慢一点"，
 * 所以它不该与别的减速去做乘法（×0.55×0.55 会得到一个"还在挪"的怪物）。
 */
Status.moveMul = function (host) {
  var m = 1;
  if (!host) return m;
  var stunned = false;
  for (var i = 0; i < LIST.length; i++) {
    var d = LIST[i];
    if ((Number(host[d.id]) || 0) <= 0) continue;
    if (d.kind === 'stun') { stunned = true; continue; }
    if (d.kind !== 'slow' && d.kind !== 'haste') continue;
    var v = Number(host[d.id + 'Mul']) || 0;
    if (isFinite(v) && v > 0) m *= v;
  }
  if (stunned) return 0;
  return Math.max(0.05, Math.min(6, m));
};

/** **每秒扣/回多少血**（`dot` / `regen` 的唯一读法；按层数乘） */
Status.rateOf = function (host, id) {
  var def = BY_ID[String(id || '')];
  if (!def || (def.kind !== 'dot' && def.kind !== 'regen') || !host) return 0;
  var per = Number(host[def.id + 'Dps']) || 0;
  if (!isFinite(per) || per <= 0) return 0;
  return per * Status.stacksOf(host, def.id);
};

/** 一行行给人看（诊断面板 / 调试） */
Status.describe = function () {
  return '状态：' + LIST.length + ' 种（' + LIST.map(function (d) {
    return d.name + ' ' + d.dur + 's×' + d.maxStacks;
  }).join(' · ') + '）';
};

/**
 * **把移动倍率作用到速度上**（唯一的施加处）。
 *
 * 为什么要有这一个函数，而不是让调用方写 `e.vx *= Status.moveMul(e)`：
 * "哪些速度要打折"这件事必须**只有一处**说了算 —— 一只怪身上有两套速度：
 *   · `vx` / `vy` —— AI 算出来的追击速度（`ai.ts` 的 `beh.move`）
 *   · `kx` / `ky` —— **击退**的残余速度（`ai.ts` 的 `e.x += e.kx * dt`）
 *
 * ⚠ 只打第一套是本模块第一版的错：定身期间怪被**击退推着走**
 *   （实测 20 帧漂了 17.79 px，而断言写的是"一步都不该动"）。
 *   击退是"被推"，定身是"自己不能动" —— 两者都要按住，否则"定身"在玩家眼里
 *   只是"它不打我了"，而它还在滑。
 */
Status.applyMove = function (host) {
  if (!host) return 1;
  var m = Status.moveMul(host);
  if (m === 1) return 1;
  if (typeof host.vx === 'number') host.vx *= m;
  if (typeof host.vy === 'number') host.vy *= m;
  if (typeof host.kx === 'number') host.kx *= m;
  if (typeof host.ky === 'number') host.ky *= m;
  return m;
};

Status.LIST = LIST;
Status.BY_ID = BY_ID;

/* =========================================================
   3. 自检
   ---------------------------------------------------------
   每一条对着一个真实故障：
     · `kind` 不认识 → 那个状态的读数没有任何一处会认它（挂了等于没挂）
     · `maxStacks < 1` → 反推层数时会除零 / 永远挂不上
     · `dur <= 0` → 挂上去立刻掉（界面上表现为"这个状态从来不显示"）
     · 同一个 id 两行 → `BY_ID` 里后一条静默盖掉前一条
     · **`apply` 之后必须真的挂上、且读得出来** —— 这条是"自检要证明它会失败"
       的同一条纪律：一个挂不上去的状态表等于装饰
   ========================================================= */
Status.audit = function () {
  var problems: string[] = [];
  var seen: Record<string, boolean> = Object.create(null);
  var i;

  if (!LIST.length) problems.push('一种状态都没有（"状态系统"这一栏还是空的）');
  for (i = 0; i < LIST.length; i++) {
    var d = LIST[i];
    if (!d.id) { problems.push('第 ' + i + ' 条状态没有 id'); continue; }
    if (seen[d.id]) problems.push('状态 id 重复：' + d.id);
    seen[d.id] = true;
    if (!d.name) problems.push(d.id + ' 没有名字（界面上是个空标签）');
    if (!d.note) problems.push(d.id + ' 没有说明（玩家不知道它是什么）');
    if (Status.KINDS.indexOf(d.kind) < 0) {
      problems.push(d.id + ' 的 kind 不认识：' + d.kind +
        '（读数门面不会认它 —— 挂了等于没挂）');
    }
    if (!(Number(d.dur) > 0)) problems.push(d.id + ' 的时长不是正数（挂上去立刻掉）');
    if (!(Number(d.maxStacks) >= 1)) problems.push(d.id + ' 的最多层数不是正数');
    if (['max', 'stack'].indexOf(d.refresh) < 0) {
      problems.push(d.id + ' 的 refresh 不认识：' + d.refresh + '（只能是 max / stack）');
    }
    /* ⚠ `stack` 而且只有一层 = 那句话是空话（叠不起来） */
    if (d.refresh === 'stack' && !(Number(d.maxStacks) > 1)) {
      problems.push(d.id + ' 声明了"可叠"却只许 1 层 —— 那它叠不起来');
    }
    /* 字段名不能和已有的撞（`burn` / `slow` 是写进宿主对象的键） */
    if (/^[A-Za-z_$][\w$]*$/.test(d.id) === false) {
      problems.push(d.id + ' 不是合法的字段名（它会被写到宿主对象上）');
    }
  }

  /* **实测一遍**：挂上 → 读得出来 → 走完时长 → 自己掉 */
  var probe: Record<string, number> = Object.create(null);
  for (i = 0; i < LIST.length; i++) {
    var def = LIST[i];
    var got = Status.apply(probe, def.id, { dur: def.dur, mul: 0.5, dps: 7 });
    if (got < 1) { problems.push(def.id + ' 挂不上去（`apply` 返回 ' + got + '）'); continue; }
    if (Status.leftOf(probe, def.id) <= 0) problems.push(def.id + ' 挂上之后读不到剩余时长');
    if (Status.stacksOf(probe, def.id) !== got) {
      problems.push(def.id + ' 的层数读数与 `apply` 的返回值不一致（' +
        Status.stacksOf(probe, def.id) + ' vs ' + got + '）');
    }
    /* 走完时长（多喂一点保险）之后必须自己掉干净，连**层数与强度**一起 */
    Status.tick(probe, Number(def.dur) + 0.2);
    if (Status.leftOf(probe, def.id) !== 0) problems.push(def.id + ' 走完时长之后没有掉');
    var key = def.id + (def.kind === 'dot' || def.kind === 'regen' ? 'Dps' : 'Mul');
    if ((Number(probe[key]) || 0) !== 0) {
      problems.push(def.id + ' 掉了之后强度字段还留着（池化复用会把它带给下一个对象）');
    }
    if ((Number(probe[def.id + 'N']) || 0) !== 0) {
      problems.push(def.id + ' 掉了之后层数还留着（池化复用会把它带给下一个对象）');
    }
  }

  /* **可叠的那个真能叠**：连挂两层，层数与时长都要涨 */
  for (i = 0; i < LIST.length; i++) {
    var sd = LIST[i];
    if (sd.refresh !== 'stack') continue;
    var two: Record<string, number> = Object.create(null);
    Status.apply(two, sd.id, { dur: sd.dur, mul: 0.6 });
    var oneLeft = Status.leftOf(two, sd.id);
    Status.apply(two, sd.id, { dur: sd.dur, mul: 0.6 });
    if (!(Status.leftOf(two, sd.id) > oneLeft)) {
      problems.push(sd.id + ' 声明了可叠，而叠第二层时长没有涨（' + oneLeft + ' → ' + Status.leftOf(two, sd.id) + '）');
    }
    if (Status.stacksOf(two, sd.id) < 2) {
      problems.push(sd.id + ' 叠了第二层而层数还是 ' + Status.stacksOf(two, sd.id));
    }
  }

  /* **弱的不会盖掉强的** —— 这是"打着打着不疼了"那一类 bug 的唯一防线 */
  var weak: Record<string, number> = Object.create(null);
  Status.apply(weak, 'burn', { dps: 20 });
  Status.apply(weak, 'burn', { dps: 3 });
  if (Status.rateOf(weak, 'burn') < 20) {
    problems.push('弱的那一次把强的盖掉了（每秒伤害 20 → ' + Status.rateOf(weak, 'burn') + '）');
  }

  /* `moveMul` 的三条边界：没挂 = 1；慢 = <1；认不出的 id 不影响 */
  var mv: Record<string, number> = Object.create(null);
  if (Status.moveMul(mv) !== 1) problems.push('什么都没挂时移动倍率不是 1');
  Status.apply(mv, 'slow', { mul: 0.6 });
  var after = Status.moveMul(mv);
  if (!(after < 1 && after > 0.5)) problems.push('挂了减速之后倍率是 ' + after + '（应当约 0.6）');
  if (Status.apply(mv, '不存在', { mul: 0.1 }) !== 0) problems.push('认不出的状态 id 竟然挂上去了');
  if (Status.moveMul(mv) !== after) problems.push('认不出的 id 影响了移动倍率');

  return {
    ok: problems.length === 0, problems: problems,
    counts: { statuses: LIST.length, kinds: Status.KINDS.length }
  };
};

var verdict = Status.audit();
if (!verdict.ok) throw new Error('status.ts 自检失败：\n' + verdict.problems.join('\n'));
SelfCheck.register('Status', Status.audit);

/* =========================================================
   4. 刻意不进这张表的东西（写清理由，免得下次被当成"漏了"）
   ---------------------------------------------------------
   `rage`（受虐狂的角色机制）与 `invuln`（受击无敌）**不是状态**：

     · 它们**没有"挂上去 / 掉下来"这回事** —— `rage` 由当前生命**推出来**
       （`recalcStats` 每帧按已失生命算），`invuln` 由"挨打那一刻"置位。
       把它们塞进这张表，等于给两件**本来就是派生值**的东西加一层生命周期，
       而那一层生命周期没有第二个读者。
     · 它们是**命中的一部分**，不是"挂在身上的一个状态"：判据是
       "如果删掉这张表，它们还成立吗" —— 成立，而且更好读。

   ⚠ 这一栏是**有意的**，与 §九「刻意不做」同一套写法。
   ========================================================= */

/* =========================================================
   5. 登记进扩展点总账
   ========================================================= */
Registry.family('status', {
  note: '状态（可叠层、有秒数的 debuff / buff：灼烧 / 减速 …）—— ' +
    '与契约（层间一次选择）和角色机制（rage / invuln）的分工见 status.ts 的头注释',
  owner: 'status.ts',
  entries: function () {
    return LIST.map(function (d) {
      return { id: d.id, refs: [{ field: 'kind', value: d.kind, family: 'statusKind' }] };
    });
  }
});
Registry.family('statusKind', {
  note: '状态能干什么（按秒扣血 / 减速 / 加速 / 按秒回血）—— 四种，就这些',
  owner: 'status.ts',
  values: function () { return Status.KINDS.slice(); }
});
Registry.uses('kind', 'statusKind');

export { Status };
