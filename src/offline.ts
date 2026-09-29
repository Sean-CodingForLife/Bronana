/* =========================================================
   offline.ts — 离线产出（可选档，小额度）

   参照放置/增量类（Melvor Idle / NGU 那一类）的"回来收菜"。
   那是手游里最强的留存手段，而本作是个**离线单机游戏** ——
   所以这里是**反着抄**的：做成一小块可选的附加内容，而不是一条默认存在的产出管道。
   四条自我约束：

   1. **要买才开**：产物只来自据点里的「菌床」。没买就没有离线产出 ——
      它是"你选的一档"，不是"人人都有的日常补贴"。
   2. **额度小**：满级菌床挂满 8 小时也只有 86 孢子，
      而通关一局约 93。也就是说挂机永远追不上真打。
   3. **单次封顶 + 结算即前进**：每次结算最多算 8 小时，
      而且**结算后立刻把"上次见面"推到当下** ——
      所以反复刷新页面不会多拿（每次都要有真实的间隔）。
   4. **诚实地说清楚**：本地时间是玩家能改的，单机里这只能靠额度与封顶兜住。
      成绩码那条线根本不读时间，所以改时钟只坑自己。

   本模块是纯函数：只吃"过了多少毫秒 + 菌床等级"，吐"该给多少孢子"。
   状态（上次见面时间）在 profile.ts，接线在 main.ts。
   ========================================================= */

import { Registry } from './registry.ts';

var Offline = {} as OfflineApi;

/** 每分钟产出（孢子/分钟）—— 按菌床等级给。故意小：挂满 8 小时 ≈ 一局通关的量级 */
var RATE_PER_MIN: Record<number, number> = { 0: 0, 1: 0.10, 2: 0.18 };

/** 单次结算的时间上限（小时） */
Offline.MAX_HOURS = 8;
/** 低于这个间隔不结算：避免每次刷新都弹一条"离线收益" */
Offline.MIN_MINUTES = 10;
/** 菌床等级上限（与据点表一致；这里再夹一次是防御坏档） */
Offline.MAX_LEVEL = 2;

Offline.RATE_PER_MIN = RATE_PER_MIN;

/** 某个菌床等级的产出速率（孢子/分钟） */
Offline.rateAt = function (level) {
  var lv = Math.max(0, Math.min(Offline.MAX_LEVEL, Math.floor(Number(level) || 0)));
  return RATE_PER_MIN[lv] || 0;
};

/**
 * 结算一次离线产出。
 * @param elapsedMs 距上次结算过了多少毫秒（负数/NaN 一律当 0）
 * @param sporebedLevel 菌床等级（0 = 没买 → 不产出）
 * @returns { spores, minutes, minutesCounted, capped, reason }
 *          spores 为 0 时 reason 说明为什么（界面据此决定要不要提示）
 */
Offline.settle = function (elapsedMs, sporebedLevel) {
  var lv = Math.max(0, Math.min(Offline.MAX_LEVEL, Math.floor(Number(sporebedLevel) || 0)));
  var rate = Offline.rateAt(lv);
  var ms = Number(elapsedMs);
  if (!isFinite(ms) || ms <= 0) {
    return { spores: 0, minutes: 0, minutesCounted: 0, capped: false, reason: '没有有效的间隔' };
  }
  var minutes = ms / 60000;
  if (rate <= 0) {
    return { spores: 0, minutes: minutes, minutesCounted: 0, capped: false, reason: '还没买菌床' };
  }
  if (minutes < Offline.MIN_MINUTES) {
    return { spores: 0, minutes: minutes, minutesCounted: 0, capped: false, reason: '间隔太短' };
  }
  var maxMin = Offline.MAX_HOURS * 60;
  var counted = Math.min(minutes, maxMin);
  var spores = Math.floor(counted * rate);
  if (spores <= 0) {
    return { spores: 0, minutes: minutes, minutesCounted: counted, capped: minutes > maxMin, reason: '产出不足 1 点' };
  }
  return {
    spores: spores,
    minutes: minutes,
    minutesCounted: counted,
    capped: minutes > maxMin,
    reason: ''
  };
};

/** 一行行给人看（界面与调试） */
Offline.describe = function () {
  var lines = ['离线产出：菌床等级 1 → ' + Offline.rateAt(1) + ' 孢子/分；等级 2 → ' + Offline.rateAt(2) + ' 孢子/分'];
  lines.push('  单次封顶 ' + Offline.MAX_HOURS + ' 小时（满级满额 = ' +
    Math.floor(Offline.MAX_HOURS * 60 * Offline.rateAt(2)) + ' 孢子，一局通关约 70）');
  lines.push('  低于 ' + Offline.MIN_MINUTES + ' 分钟不结算；结算后立即把"上次见面"推到现在');
  return lines.join('\n');
};

Registry.family('offlineRate', {
  note: '离线产出速率表（按菌床等级）', owner: 'offline.ts',
  values: function () { return Object.keys(RATE_PER_MIN).map(String); }
});

export { Offline };
