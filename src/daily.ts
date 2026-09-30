/* =========================================================
   daily.ts — 每日挑战（共享种子）

   为什么这个几乎免费：模拟层已经是确定性的（固定 dt + 种子化随机 + `record.ts`），
   所以"同一天玩的人都拿到同一局"只需要两件事 —— **同一个种子**、**同一个角色**。
   不需要服务器：种子由日期算出来，谁算都一样。

   UTC 而不是本地时区：让"今天"在所有人那里指同一段时间。
   用本地时区会出现"我这边已经换天了，你那边还没"——同一天的两个人打的不是同一局。

   每日挑战**无视角色解锁门槛**：所有人必须用同一个角色才可比。
   顺带它也是一次"试吃"——没解锁的角色今天能用。

   本模块只管"今天是什么"，不碰模拟层，也不知道谁在打。
   ========================================================= */

import { Chars } from './data_chars.ts';
import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';
import { U } from './utils.ts';

var Daily = {} as DailyApi;

/**
 * 每日记录里**声明**的字段（登记为 `dailyField` 家族）。
 * 判据见文件末尾的 audit：它拿这张表去对 `Daily.of()` 的产出与 `dateKey` 的格式。
 * （"`scoreOf` / `main.ts` 到底读不读它"那种静态核对是 test/daily.mjs 的活 ——
 * 启动期跑在浏览器里，没有 fs。）
 */
var FIELDS: string[] = [
  'key', 'seed', 'char', 'danger', 'wave', 'kills', 'level', 'win', 'score', 'at', 'frames'
];

/* =========================================================
   1. 日期 → 当天的规则
   ========================================================= */
/** UTC 日期键 `YYYY-MM-DD`（补零，所以字符串序 = 时间序，可以直接当键排序） */
Daily.dateKey = function (now) {
  var d = (now === undefined || now === null) ? new Date() : new Date(now);
  var y = d.getUTCFullYear();
  var m = d.getUTCMonth() + 1;
  var day = d.getUTCDate();
  return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
};

/** 当天的种子。同一个日期键在任何地方都得到同一个数 */
Daily.seedFor = function (key) {
  // 前缀是"域分隔"：不加的话 'daily-2026-01-01' 与别处同名的字符串会撞种子
  return U.seedFromStr('bronana-daily-' + String(key)) >>> 0;
};

/** 当天的角色：按种子在角色表里轮换（全场一致，与个人解锁进度无关） */
Daily.charFor = function (key) {
  var list = Chars.LIST;
  if (!list.length) return null;
  return list[Daily.seedFor(key) % list.length].id;
};

/** 今天的规则 */
Daily.of = function (key) {
  var k = key || Daily.dateKey();
  var seed = Daily.seedFor(k);
  return { key: k, seed: seed, char: Daily.charFor(k), danger: 0 };
};

/* =========================================================
   2. 成绩
   ---------------------------------------------------------
   一个可解释的标量：波次是主项（推进才是本事），击杀与等级其次，
   通关另给一笔。**不用时间**：本作没有"越快越好"的语义。
   ========================================================= */
Daily.scoreOf = function (run) {
  if (!run) return 0;
  var wave = Math.max(0, num(run.wave));
  var kills = Math.max(0, num(run.kills));
  var level = Math.max(0, num(run.level));
  return Math.round(wave * 1000 + kills * 2 + level * 50 + (run.win ? 5000 : 0));
};
function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

/* =========================================================
   4. 本地最好成绩（存在 profile.daily[key] 里）
   ---------------------------------------------------------
   注意：**"这一局是不是挑战局"的标记不在这里** ——
   它属于接入层（main.ts），因为每日与每周共用同一套流程。
   本模块只管"今天是什么"。
   ========================================================= */
/** 今天是否已经打过了 */
Daily.bestOf = function (profile, key) {
  var k = key || Daily.dateKey();
  var d = profile && profile.daily ? profile.daily[k] : null;
  return d || null;
};

/** 比较并返回更好的那一个（分数相同保留先到的） */
Daily.pick = function (a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return (num(b.score) > num(a.score)) ? b : a;
};

/* =========================================================
   5. 定义期自检（`dailyField` 的守卫）
   ---------------------------------------------------------
   `dailyField` 是一张**声明表**（每日记录里有哪些字段）。它自己不会出错，
   出错的是"它与真实代码脱节"—— 而那种错没有任何症状：
   档案里那一格空了 / 分数恒为 0 / 同一天的两个人打出不同的局。
   所以这一份 audit 的每一条都拿声明表去对**真实代码的产出与读取**。

     · `of()` 产出的字段不在表里 → 存档与界面按这张表列字段，那个值静默消失
       （新加"连胜数"这种字段时最容易发生：`of()` 加了，表忘了加）
     · 表里声明的核心四键（key/seed/char/danger）没被 `of()` 产出 →
       每日记录里那一格永远是空的（难度/种子丢了，成绩码也就无从验证）
     · 角色不是已登记角色 → 挑战开局直接炸（或 `charFor` 给回 null）
     · 同一个日期键两次拿到不同的规则（种子/角色依赖了时间或随机数）→
       "同一天玩的人都拿到同一局"这条前提没了：成绩码互验全对不上，而且不可复现
     · 日期键没补零 → 字符串序不再等于时间序（模块顶部就是靠这条才能把键直接排序）

   ⚠ 这一份**没有**"某个字段有没有人读"这类判据：那要扫源码，是 test/daily.mjs 的活。
   ========================================================= */
Daily.audit = function () {
  var problems: string[] = [];
  var seen: Record<string, boolean> = Object.create(null);
  var i;
  for (i = 0; i < FIELDS.length; i++) {
    if (seen[FIELDS[i]]) problems.push('字段在 dailyField 里声明了两次：' + FIELDS[i]);
    seen[FIELDS[i]] = true;
  }
  /* 日期键：补零是"字符串序 = 时间序"的全部实现（档案里 daily 是一张按键排的表） */
  var probe = Daily.dateKey(Date.UTC(2026, 0, 5));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(probe)) {
    problems.push('dateKey 不是补零的 YYYY-MM-DD：' + probe + '（字符串序不再等于时间序，档案里的日期键会乱序）');
  }
  var rule = Daily.of('2026-01-05');
  var keys = Object.keys(rule);
  for (i = 0; i < keys.length; i++) {
    if (FIELDS.indexOf(keys[i]) < 0) {
      problems.push('of() 产出的字段 ' + keys[i] + ' 不在 dailyField 里（存档与界面按那张表列字段，这个值会静默丢掉）');
    }
  }
  var core = ['key', 'seed', 'char', 'danger'];
  for (i = 0; i < core.length; i++) {
    if (keys.indexOf(core[i]) < 0) problems.push('of() 没有产出 ' + core[i] + '（每日记录的这一格永远是空的）');
  }
  if (!(rule.char && Chars.BY_ID[rule.char])) {
    problems.push('of() 给的角色不是已登记角色：' + String(rule.char) + '（每日挑战开局会拿不到角色）');
  }
  var again = Daily.of('2026-01-05');
  if (again.seed !== rule.seed || again.char !== rule.char) {
    problems.push('同一个日期键两次得到的规则不同（种子/角色依赖了时间或随机数）—— ' +
      '"同一天的人打同一局"这条前提没了');
  }
  return { ok: problems.length === 0, problems: problems };
};

/* =========================================================
   6. 登记进扩展点总账
   ========================================================= */
Registry.family('dailyField', {
  note: '每日挑战记录的字段', owner: 'daily.ts',
  values: function () { return FIELDS.slice(); }
});

/* 定义期自检：不过就抛。它只读本模块的表与自己的纯函数（Chars 是直接 import，
   求值顺序由 ES 模块保证：daily.ts 的模块体一定在 data_chars.ts 之后跑），
   所以加载期跑是安全的。 */
var dailyVerdict = Daily.audit();
if (!dailyVerdict.ok) {
  throw new Error('daily.ts 每日挑战自检失败：\n' + dailyVerdict.problems.join('\n'));
}
SelfCheck.register('Daily', Daily.audit);

export { Daily };
