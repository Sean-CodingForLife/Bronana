/* =========================================================
   fun-audit.mjs — 对局体检：这游戏"好不好玩"的**可测代理指标**
   ---------------------------------------------------------
   好玩不能直接测，但它的**结构**能测。这份工具跑 N 局全自动对局，
   统计八项代理指标，并与外部同类游戏的公开设计基准逐项对照：

     [1] 对局长度      —— 一局多久（太短 = 没成长感；太长 = 一次坐太久）
     [2] 首次有效选择  —— 开局到第一个改变构筑的决定（太久 = 前 30 秒在空转）
     [3] 决策密度      —— 每分钟几个真正的构筑决定
     [4] 成长曲线      —— 等级 / 击杀随波次涨得多快（对照怪的 HP 曲线）
     [5] 构筑分化      —— 各局最后拿到的武器 / 道具集合有多不一样
     [6] 死因归因      —— 死在第几波、当时最威胁的是谁
     [7] 失败价值      —— 输了也带出多少（孢子 / 合金 / 核心材料）
     [8] 内容触达      —— 有多少武器 / 道具在这一批里真的被摸到

   **走位与商店决策走 `tools/_run.mjs`**（与 `bug-probe.mjs` 同一个实现）。
   这一点是硬要求：第一版这里另写了一份，于是同一个种子跑出完全不同的结果
   （探针到第 15 波、这里第 3 波就死），量出来的根本不是同一局游戏。

   它**不判定"好不好玩"**，只把数字摆出来 —— 判定在 README 里，
   并且必须与外部基准一起读（否则就是自说自话）。

   用法： node tools/fun-audit.mjs [局数] [最大波次]
   ========================================================= */
import { Game, Chars, Weapons, Items, Enemies, Profile, playRun } from './_run.mjs';

const RUNS = Math.max(1, parseInt(process.argv[2] || '24', 10));
const MAX_WAVE = Math.max(1, parseInt(process.argv[3] || '40', 10));

const PAD = (s, n) => { s = String(s); return s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 127 ? 2 : 1), 0))); };
const med = (arr) => { const a = arr.slice().sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 0; };
const mean = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
const pct = (arr, p) => { const a = arr.slice().sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : 0; };

console.log('\n=== Bronana · 对局体检（好不好玩的可测代理）===\n');
console.log('  ' + RUNS + ' 局全自动对局（种子可复现 · 与探针同一个自动玩家）· 每局最多 ' + MAX_WAVE + ' 波\n');

const t0 = Date.now();
const runs = [];
const stateBreaks = [];
for (let i = 0; i < RUNS; i++) {
  const r = playRun({
    runIndex: i, seedBase: 500000, maxWave: MAX_WAVE,
    onStateBreak: (who, from, to) => stateBreaks.push('run' + i + ' ' + who + ': ' + from + ' → ' + to)
  });
  if (r) runs.push(r);
}
if (stateBreaks.length) {
  console.log('  \x1b[31m⚠ 有 API 在非法参数下改变了状态机：\x1b[0m');
  for (const s of stateBreaks.slice(0, 6)) console.log('      ' + s);
  console.log('');
}
const wall = (Date.now() - t0) / 1000;

if (process.env.FUN_DBG) {
  for (const r of runs) {
    console.log('   [dbg] run' + r.run + ' ' + PAD(r.char, 10) + ' 难度' + r.danger + ' 波' + PAD(r.waves, 3) +
      ' 秒' + PAD(r.secs.toFixed(1), 7) + ' 构筑' + PAD(r.buildChoices, 4) + ' 全决策' + PAD(r.allChoices, 4) +
      ' 首择' + PAD(r.firstChoiceSec.toFixed(1), 6) + ' 等级' + PAD(r.level, 3) + ' 击杀' + PAD(r.kills, 4) +
      ' 核心' + r.coreEarned);
  }
  console.log('');
}

/* ---------------- [1] 对局长度 ---------------- */
const waveList = runs.map(r => r.waves);
const secsList = runs.map(r => r.secs);
console.log('[1] 对局长度（一局多久）');
console.log('  ' + PAD('到第几波', 12) + '中位 ' + PAD(med(waveList), 4) + '均值 ' + PAD(mean(waveList).toFixed(1), 6) +
  'P90 ' + PAD(pct(waveList, 0.9), 4) + '最深 ' + Math.max(...waveList));
console.log('  ' + PAD('游戏内秒数', 12) + '中位 ' + PAD(Math.round(med(secsList)), 4) + '均值 ' + PAD(Math.round(mean(secsList)), 6) +
  'P90 ' + Math.round(pct(secsList, 0.9)));
console.log('  ' + PAD('到第几层', 12) + '中位 ' + med(runs.map(r => r.floor)) + '  通关 ' +
  runs.filter(r => r.won).length + ' / ' + runs.length + ' 局');
console.log('  ' + PAD('死亡/超时', 12) + runs.filter(r => r.state === 'end' && !r.won).length + ' 局结束 · ' +
  runs.filter(r => r.state === 'playing').length + ' 局打到波数上限');
console.log('');

/* ---------------- [2] 首次有效选择 ---------------- */
const firstList = runs.filter(r => r.firstChoiceSec >= 0).map(r => r.firstChoiceSec);
console.log('[2] 首次有效选择（开局到第一个改变构筑的决定）');
console.log('  ' + PAD('秒数', 12) + '中位 ' + PAD(med(firstList).toFixed(1), 5) + 'P90 ' + pct(firstList, 0.9).toFixed(1) +
  '  最慢 ' + (firstList.length ? Math.max(...firstList).toFixed(1) : '—'));
console.log('');

/* ---------------- [3] 决策密度 ---------------- */
const buildPerMin = runs.map(r => r.secs > 2 ? r.buildChoices / (r.secs / 60) : 0);
const allPerMin = runs.map(r => r.secs > 2 ? r.allChoices / (r.secs / 60) : 0);
const perWave = runs.map(r => r.buildChoices / Math.max(1, r.waves));
console.log('[3] 决策密度（每分钟几个决定）');
console.log('  ' + PAD('构筑决策/分', 14) + '中位 ' + PAD(med(buildPerMin).toFixed(1), 5) + '均值 ' + mean(buildPerMin).toFixed(1));
console.log('  ' + PAD('全部决策/分', 14) + '中位 ' + PAD(med(allPerMin).toFixed(1), 5) + '均值 ' + mean(allPerMin).toFixed(1) +
  '（含升级选卡 / 刷新 / 回收）');
console.log('  ' + PAD('构筑决策/波', 14) + '中位 ' + med(perWave).toFixed(1));
console.log('  ' + PAD('商店访问/局', 14) + '中位 ' + med(runs.map(r => r.shopVisits)) +
  ' · 见过的货 ' + med(runs.map(r => r.offersSeen)) + ' 件');
console.log('  ' + PAD('尝试购买/局', 14) + '中位 ' + med(runs.map(r => r.buysTried)) +
  ' · **成功** ' + med(runs.map(r => r.buysOk)) + '（买不起 / 已售出算失败）');
if (process.env.FUN_DBG) {
  for (const r of runs) console.log('   [dbg] run' + r.run + ' 拒绝原因：' + (r.lastDeny || '（没有失败）') +
    ' · 当时状态=' + (r.lastDenyState || '?') + ' · 材料=' + (r.lastDenyMats === undefined ? '?' : r.lastDenyMats) +
    ' · 货价=' + (r.lastDenyPrice === undefined ? '?' : JSON.stringify(r.lastDenyPrice)));
}
console.log('');

/* ---------------- [4] 成长曲线 ---------------- */
console.log('[4] 成长曲线（玩家侧 vs 怪物侧）');
console.log('  ' + PAD('等级/波', 12) + '中位 ' + med(runs.map(r => r.level / Math.max(1, r.waves))).toFixed(2) +
  '（越接近 1 越"每波一级"）');
console.log('  ' + PAD('击杀/波', 12) + '中位 ' + med(runs.map(r => r.kills / Math.max(1, r.waves))).toFixed(1));
console.log('  ' + PAD('终局等级', 12) + '中位 ' + med(runs.map(r => r.level)) + '  最高 ' +
  Math.max(...runs.map(r => r.level)));
console.log('  ' + PAD('终局上限血', 12) + '中位 ' + med(runs.map(r => r.maxHp)) + '（角色基准 20）');
console.log('');

/* ---------------- [5] 构筑分化 ---------------- */
const sigs = runs.map(r => r.weapons.slice().sort().join(',') + '|' + r.items.slice().sort().join(','));
const uniq = new Set(sigs).size;
const seenWeapons = new Set(), seenItems = new Set();
for (const r of runs) { for (const w of r.weapons) seenWeapons.add(w.split(':')[0]); for (const it of r.items) seenItems.add(it); }
console.log('[5] 构筑分化（各局最后拿到的东西有多不一样）');
console.log('  ' + PAD('不同终局构筑', 14) + uniq + ' / ' + runs.length + ' 局（' +
  (uniq / Math.max(1, runs.length) * 100).toFixed(0) + '% 不重复）');
console.log('  ' + PAD('每局终局装备', 14) + '中位 ' + med(runs.map(r => r.weapons.length + r.items.length)) + ' 件');
console.log('  ' + PAD('摸到的武器', 14) + seenWeapons.size + ' / ' + Weapons.LIST.length);
console.log('  ' + PAD('摸到的道具', 14) + seenItems.size + ' / ' + Items.LIST.length);
console.log('');

/* ---------------- [6] 死因归因 ---------------- */
console.log('[6] 死因归因（能不能说清"我为什么死"）');
const byWave = {};
for (const r of runs) byWave[r.waves] = (byWave[r.waves] || 0) + 1;
const wk = Object.keys(byWave).map(Number).sort((a, b) => a - b);
console.log('  ' + PAD('结束波次分布', 14) + wk.map(k => k + '波×' + byWave[k]).join(' · '));
console.log('  ' + PAD('有近身凶手', 14) + runs.filter(r => r.lastThreatName).length + ' / ' + runs.length +
  '（记的是低血时最近的那只怪 —— 界面上玩家看到的是同一件事）');
console.log('  ' + PAD('结束时血量', 14) + '中位 ' + med(runs.map(r => r.hpAtEnd)) + ' / ' + med(runs.map(r => r.maxHp)));
console.log('');

/* ---------------- [7] 失败价值 ---------------- */
const mk = (r) => ({
  char: r.char, wave: r.waves, level: r.level, kills: r.kills, materials: r.materials,
  damage: 0, taken: 0, healed: r.healed, packs: 0, win: r.won, danger: r.danger,
  alloy: r.growth, coreEarned: r.coreEarned
});
const sporeGain = runs.map(r => { try { return Profile.growthForRun(mk(r)) || 0; } catch (e) { return 0; } });
const alloyGain = runs.map(r => { try { return Profile.growthForRun(mk(r)) || 0; } catch (e) { return 0; } });
console.log('[7] 失败价值（输了也带出多少）');
console.log('  ' + PAD('孢子/局', 12) + '中位 ' + PAD(med(sporeGain), 5) + '均值 ' + mean(sporeGain).toFixed(1) +
  '  合计 ' + sporeGain.reduce((a, b) => a + b, 0));
console.log('  ' + PAD('合金/局', 12) + '中位 ' + PAD(med(alloyGain), 5) + '均值 ' + mean(alloyGain).toFixed(1));
console.log('  ' + PAD('核心材料/局', 12) + '中位 ' + med(runs.map(r => r.coreEarned)) +
  '  合计 ' + runs.reduce((a, r) => a + r.coreEarned, 0));
console.log('  ' + PAD('空手而归的局', 14) + runs.filter((r, i) => sporeGain[i] <= 0).length + ' / ' + runs.length);
console.log('');

/* ---------------- [8] 内容触达 ---------------- */
console.log('[8] 内容触达（这一批里真的被摸到多少）');
console.log('  ' + PAD('武器', 10) + seenWeapons.size + ' / ' + Weapons.LIST.length + '（' +
  (seenWeapons.size / Weapons.LIST.length * 100).toFixed(0) + '%）');
console.log('  ' + PAD('道具', 10) + seenItems.size + ' / ' + Items.LIST.length + '（' +
  (seenItems.size / Items.LIST.length * 100).toFixed(0) + '%）');
console.log('  ' + PAD('怪', 10) + Enemies.LIST.length + ' 种（全表；按波次与层主题抽）');
console.log('');

console.log('  合计 ' + runs.length + ' 局 · 墙钟 ' + wall.toFixed(1) + ' 秒 · 平均 ' +
  (wall / Math.max(1, runs.length)).toFixed(2) + ' 秒/局');
console.log('\n（这份工具只把数字摆出来 —— 判定要与外部基准一起读，见 README）\n');
