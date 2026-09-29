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
import { U } from './utils.ts';

var Daily = {} as DailyApi;

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
   它属于接线层（main.ts），因为每日与每周共用同一套流程。
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
   5. 登记进扩展点总账
   ========================================================= */
Registry.family('dailyField', {
  note: '每日挑战记录的字段', owner: 'daily.ts',
  values: function () { return ['key', 'seed', 'char', 'danger', 'wave', 'kills', 'level', 'win', 'score', 'at', 'frames']; }
});

export { Daily };
