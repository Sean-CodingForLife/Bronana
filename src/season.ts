/* =========================================================
   season.ts — 每周挑战（"赛季"在这个单机游戏里的诚实版本）

   先说清楚它能是什么、不能是什么：
     · PoE 那种"赛季"= 新机制 + 全新经济 + 内容生产线，那是联网运营的做法。
        本作是离线单机，既做不到、也不该硬做（做出来只是换个名字的每周挑战）。
     · 能诚实做到的是**每周一套固定的共享条件**：同一周同一局，
        轮换角色与难度，成绩记在本地。种子由周次算出来，所以不需要服务器，
        也不需要你按时回来 —— 那一周的局永远在那儿，什么时候打都行。

   与每日挑战的分工：
     · 每日：难度固定第 0 级，用来"哪天想打就打个固定局"
     · 每周：**难度轮换**，用来"这周换一套条件再打一遍"
   两者的种子/角色都从日期/周次算出来，谁都算得一样。

   周次用 **UTC 的 ISO 周**（周一为一周之始）。
   与每日一样用 UTC：本地时区会让"这一周"在两个人那里错开。
   ========================================================= */

import { SelfCheck } from './selfcheck.ts';
import { Chars } from './data_chars.ts';
import { Danger } from './danger.ts';
import { Registry } from './registry.ts';
import { U } from './utils.ts';

var Season = {} as SeasonApi;

/* =========================================================
   1. 周次
   ========================================================= */
/**
 * UTC 的 ISO 周键 `YYYY-Www`（补零，所以字符串序 = 时间序）。
 * ISO 规则：包含周四的那一周属于新的一年 —— 跨年时"第 1 周"不会算错。
 */
Season.weekKey = function (now) {
  var d = (now === undefined || now === null) ? new Date() : new Date(now);
  var t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  var day = new Date(t).getUTCDay();                 // 0=周日
  var isoDay = day === 0 ? 7 : day;                  // 1=周一 … 7=周日
  // 挪到这一周的周四，那一年的年份就是 ISO 年
  var thursday = new Date(t + (4 - isoDay) * 86400000);
  var year = thursday.getUTCFullYear();
  var jan1 = Date.UTC(year, 0, 1);
  var week = Math.floor((thursday.getTime() - jan1) / (7 * 86400000)) + 1;
  return year + '-W' + (week < 10 ? '0' : '') + week;
};

/** 当周种子：同一个周键在任何地方都得到同一个数 */
Season.seedFor = function (week) {
  return U.seedFromStr('bronana-week-' + String(week)) >>> 0;
};

/** 当周角色：按种子轮换（全场一致，与个人解锁进度无关） */
Season.charFor = function (week) {
  var list = Chars.LIST;
  if (!list.length) return null;
  return list[Season.seedFor(week) % list.length].id;
};

/**
 * 当周难度：**轮换**（这是"赛季"在这里唯一能提供的花样）。
 * 从第 1 级起轮换，不轮换第 0 级 —— 每周挑战总该比日常紧一点。
 */
Season.dangerFor = function (week) {
  var pool = Danger.MAX;                 // 可用的最高级
  if (pool <= 0) return 0;
  var lv = 1 + (Season.seedFor(week) % Math.min(pool, 5));
  return Math.max(0, Math.min(Danger.MAX, lv));
};

/** 这一周的规则 */
Season.of = function (week) {
  var w = week || Season.weekKey();
  return {
    key: w,
    seed: Season.seedFor(w),
    char: Season.charFor(w),
    danger: Season.dangerFor(w)
  };
};

/* =========================================================
   2. 本地记录（复用 DailyRecord 的形状）
   ========================================================= */
Season.bestOf = function (profile, week) {
  var w = week || Season.weekKey();
  var s = profile && profile.season ? profile.season[w] : null;
  return s || null;
};
Season.pick = function (a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return (Number(b.score) || 0) > (Number(a.score) || 0) ? b : a;
};

/* =========================================================
   3. 自检
   ========================================================= */
Season.audit = function () {
  var problems = [];
  if (!/^\d{4}-W\d{2}$/.test(Season.weekKey(Date.UTC(2026, 4, 1)))) {
    problems.push('周键格式不对：' + Season.weekKey(Date.UTC(2026, 4, 1)));
  }
  // 相邻两天落在同一周（除跨周那一刻）
  var a = Season.weekKey(Date.UTC(2026, 4, 1, 12));
  var b = Season.weekKey(Date.UTC(2026, 4, 2, 12));
  if (a !== b && new Date(Date.UTC(2026, 4, 1, 12)).getUTCDay() !== 0) {
    problems.push('周内两天算出了不同的周键');
  }
  if (Season.dangerFor(Season.weekKey()) < 1) problems.push('每周挑战的难度应该 ≥ 1');
  var c = Season.charFor(Season.weekKey());
  if (!c || !Chars.BY_ID[c]) problems.push('每周角色不在角色表里：' + c);
  return { ok: problems.length === 0, problems: problems, counts: { maxDanger: Danger.MAX } };
};

SelfCheck.register('Season', Season.audit);

Registry.family('seasonField', {
  note: '每周挑战记录的字段（与每日同形）', owner: 'season.ts',
  values: function () { return ['week', 'seed', 'char', 'danger', 'wave', 'kills', 'level', 'win', 'score', 'at']; }
});

export { Season };
