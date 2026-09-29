/* =========================================================
   matrix.mjs — **矩阵体检**：把"一个数字"拆成一张表
   ---------------------------------------------------------
   `fun-audit.mjs` 报的是**一批随机局**的中位数（"典型体验"）。
   那回答不了三类问题：

     · 哪个角色被落下了？      —— 随机抽角色时，一个坏角色会被平均值盖住
     · 难度梯子是阶梯还是墙？  —— 难度 0~9 只有"名义倍数"，没有实测落点
     · 内容是不是偏的？        —— 上过货架 ≠ 被买走、也不代表活到终局

   所以这份工具按**维度**跑，每个维度用同一组种子（同一个 `runIndex`
   在不同角色/难度下是**同一个世界**：地图、商店、出怪都一样），于是可以逐列对比。

     [1] 角色维度   9 个角色 × N 个种子 —— 谁明显弱 / 强，离散度多大
     [2] 难度维度   难度 0~9 × N 个种子 —— 胜率与波次是不是单调阶梯
     [3] 波次维度   内部曲线（怪有多硬）与实机落点（打到这儿的玩家什么水平）对齐
     [4] 内容维度   武器 / 道具的"上过货架 → 被买走 → 活到终局"三级漏斗
     [5] 循环维度   每局的孢子 / 合金 / 核心材料产出（三模块循环的入口）

   **走位与商店决策走 `tools/_run.mjs`**（硬要求：另写一份 ="量的不是同一局游戏"）。
   货架 / 购买数据走**事件总线**（`market.ts` 只发事件，界面自己去订阅），
   不翻内部字段 —— 这样"工具看到的"与"界面看到的"是同一批事实。

   用法：
     node tools/matrix.mjs                    # 全跑（慢，几分钟）
     node tools/matrix.mjs --seeds 2          # 每格 2 个种子
     node tools/matrix.mjs --shard 3 --of 10 --out tools/.mx3.json   # 只跑一片，写 JSON
     node tools/matrix.mjs --merge a.json b.json ...                 # 合并若干片并出报告
   ========================================================= */
import { Game, Chars, Weapons, Items, Profile, playRun, setRunTick } from './_run.mjs';
import fs from 'node:fs';

const argv = process.argv.slice(2);
function argNum(name, def) {
  const i = argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = parseInt(argv[i + 1], 10);
  return isFinite(v) && v > 0 ? v : def;
}
const SEEDS = argNum('seeds', 4);
const SHARD = argNum('shard', 1) - 1;
const OF = argNum('of', 1);
const MAX_WAVE = argNum('maxWave', 40);
const SEED_BASE = 900000;
const DIM = (() => { const i = argv.indexOf('--dim'); return i >= 0 ? String(argv[i + 1] || '') : ''; })();
/** `--noHeal`：把"见血就补"改成"快死才补"（对照用，见 `_run.mjs` 里那段注释） */
const NO_HEAL = argv.indexOf('--noHeal') >= 0;
const OUT = (() => { const i = argv.indexOf('--out'); return i >= 0 ? argv[i + 1] : ''; })();
const MERGE = (() => {
  const i = argv.indexOf('--merge');
  if (i < 0) return [];
  return argv.slice(i + 1).filter(a => !a.startsWith('--'));
})();

const PAD = (s, n) => { s = String(s); return s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 127 ? 2 : 1), 0))); };
const PADL = (s, n) => ' '.repeat(Math.max(0, n - String(s).length)) + String(s);
const med = (a) => { const x = a.slice().sort((p, q) => p - q); return x.length ? x[Math.floor(x.length / 2)] : 0; };
const mean = (a) => a.length ? a.reduce((p, q) => p + q, 0) / a.length : 0;
const sd = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) * (v - m)))); };

/* ---------------- 0. 事件采集（三级漏斗的原料） ----------------
   `_run.mjs` 已经装好 DOM 并加载了模块，所以这里能直接订阅总线。
   ⚠ 事件名与字段以 `market.ts` 的 `emit` 为准 —— 抄错名字的表现是
   "漏斗第二级永远是 0"，而那种 0 会被误读成"玩家不买这些东西"。 */
const rec = { seeds: SEEDS, maxWave: MAX_WAVE, runs: [], offered: [], bought: {}, sold: {}, crafted: {} };
const offerSet = new Set();
/* ⚠ 事件里的名字是**中文显示名**（`market.ts` 的 `emit('buy', { name: o.def.name })`），
   而表里的键是 id（`knife` / `whetstone`）。第一版直接拿 name 当键，
   于是漏斗第二级永远是 0 —— 那个 0 会被误读成"玩家不买这些东西"。
   所以先建两张 名字 → id 的对照表。 */
const NAME2ID = (() => {
  const m = Object.create(null);
  for (const list of [Weapons.LIST, Items.LIST]) {
    for (const d of list) { if (d.name) m[d.name] = d.id; if (d.en) m[d.en] = d.id; }
  }
  return m;
})();
const asId = (s) => (s == null ? '' : (NAME2ID[s] || s));
function collectEvents() {
  if (!Game.events || typeof Game.events.on !== 'function') return false;
  Game.events.on('shopOpen', function () {
    const s = Game.getSession();
    for (const o of ((s && s.offers) || [])) {
      const id = o && o.def && o.def.id;
      if (id) offerSet.add(id);
    }
  });
  Game.events.on('buy', function (d) {
    const id = asId(d && (d.id || d.name));
    if (id) rec.bought[id] = (rec.bought[id] || 0) + 1;
  });
  Game.events.on('sell', function (d) {
    const id = asId(d && (d.id || d.name));
    if (id) rec.sold[id] = (rec.sold[id] || 0) + 1;
  });
  Game.events.on('craft', function (d) {
    if (!d) return;
    /* 配方 id 形如 `weapon:knife`（`craft.ts` 的 `buildRecipes`），
       和装备 id 不同一个命名空间 —— 所以合成单独记一桶，不掺进 `bought`。
       第一版把它们混在一起，于是"合成过几种"永远是 0。 */
    const id = d.refId || String(d.id || d.name || '').replace(/^(weapon|item):/, '');
    if (id) rec.crafted[id] = (rec.crafted[id] || 0) + 1;
  });
  /* 道具包开出来的东西也算"被拿到" —— 它不经商店，不采集的话
     "没被买走"那一行会把只能从包里出的道具全冤枉成死内容。
     包里的 grants 字段名各版本不同，所以两种都认。 */
  Game.events.on('packOpen', function (d) {
    for (const g of ((d && (d.grants || d.items)) || [])) {
      const raw = g && (g.id || g.def_id || (g.def && g.def.id) || g.name);
      const id = asId(raw);
      if (id) rec.bought[id] = (rec.bought[id] || 0) + 1;
    }
  });
  return true;
}
const eventsWired = collectEvents();

/* 逐波采样：**在玩家可操作的帧里**（`setRunTick`）按波节流，
   每一波的第一帧记下当下数值。
   ⚠ 两个踩过的坑：
     ① 挂在 `waveStart` 事件上采样 —— 那一刻怪还没生成，实测怪血永远是空；
     ② 拿**终局数值**回头去填"到第 N 波时什么水平" ——
        那批局的终局往往在更深的波次，于是第 10~39 波全是同一个数，
        看上去像"玩家到第 10 波就不长了"。那是采样错误，不是游戏现象。 */
let snaps = [];
function onTick(sess, wave) {
  if (!sess) return;
  let cur = snaps.length ? snaps[snaps.length - 1] : null;
  if (!cur || cur.wave !== wave) {
    cur = { wave: wave, level: 0, maxHp: 0, weapons: 0, items: 0, enemyHp: 0, enemies: 0, samples: 0 };
    snaps.push(cur);
  }
  /* ⚠ **不能只采第一帧**：`waveStart` 那一刻场上还没有怪（实测 `enemies: 0`），
     所以"实测怪血"整列会是空的。改成每一帧都更新，并各自取这一波的**最大值**：
       · 等级 / 血上限 / 装备数 —— 玩家这一波到过的最高水平
       · 场上怪的平均生命 —— 最多怪时的样本（`maxHp` 不随时间变，平均值也是常数）
     这样一条快照仍然只占一行，但它是"这一波的代表值"，不是"第一帧"。 */
  const s = sess.stats, p = sess.player;
  if (p.level > cur.level) cur.level = p.level;
  if (s.maxHp > cur.maxHp) cur.maxHp = Math.round(s.maxHp);
  const gear = p.weapons.length + p.items.length;
  if (gear > cur.weapons + cur.items) { cur.weapons = p.weapons.length; cur.items = p.items.length; }
  const en = sess.enemies.length;
  if (en > 0) {
    let ehp = 0;
    for (const e of sess.enemies) ehp += e.maxHp || 0;
    const avg = Math.round(ehp / en);
    if (avg > cur.enemyHp) cur.enemyHp = avg;      // 见上：这是"最多怪那一刻的平均"
    if (en > cur.enemies) cur.enemies = en;
  }
  cur.samples++;
}
setRunTick(onTick);

/* ---------------- 1. 跑（或合并） ---------------- */
function cell(job) {
  const out = [];
  for (let s = 0; s < SEEDS; s++) {
    const runIndex = runIndexFor(job, s);
    snaps = [];
    const r = playRun({ runIndex, seedBase: SEED_BASE, maxWave: MAX_WAVE, char: job.char, danger: job.danger, noHeal: NO_HEAL });
    if (r) { r.snaps = snaps; r.seedIdx = s; out.push(r); }
  }
  return out;
}

const JOBS = [];
if (!DIM || DIM === 'char') for (const c of Chars.LIST) for (let s = 0; s < SEEDS; s++) {
  JOBS.push({ dim: 'char', key: c.id, char: c.id, danger: undefined, base: 100 + s });
}
/* 难度维度：**难度必须与角色解耦**。
   第一版让角色随机（种子决定），于是 10 行里角色是变动的 ——
   量出来的"难度曲线"其实是"角色强弱"（实测 D0=5、D1=33、D2=5 的锯齿）。
   现在每个难度固定跑一组角色（每个角色一个种子），逐行角色集合一致；
   报告里再**按角色分别取中位、再跨角色取中位**，于是角色构成不参与比较。
   （`--dim danger` 可以只跑这一维：角色那一维的 runIndex 与它完全独立。） */
if (!DIM || DIM === 'danger') {
  const DANGER_CHARS = ['gladiator', 'engineer', 'mole'];
  for (let d = 0; d <= 9; d++) for (let s = 0; s < SEEDS; s++) {
    const c = DANGER_CHARS[s % DANGER_CHARS.length];
    JOBS.push({ dim: 'danger', key: String(d), char: c, danger: d, base: 3000 + s });
  }
}
/* runIndex **由 (维度, 键, 种子序号) 推导，不依赖分片数**：
   第一版用 `base + s*1000`，于是"分 24 片跑"与"分 12 片跑"落在不同的 runIndex 上 ——
   两次的结果不可比较，而且改分片数就会**重复采样同一个世界**
   （实测 ranger 因此拿到 16 局、别的角色 12 局）。
   ⚠ 这里用**哈希**而不是 `JOBS.indexOf(job)`：后者对 `MINE` 里的引用返回 -1
   （`JOBS` 上找不到时就变成"seeds 越大越晚开始"，实测把一整片跑成 0 局），
   而且它对作业顺序敏感 —— 顺序一改，同一个名字的世界就变了。 */
function runIndexFor(job, s) {
  return 71000 + s * 1000 + (hash(job.dim + '|' + job.key + '|' + job.char + '|' + job.danger) % 900);
}
/* 分片要**打散**：第一版按 JOBS 顺序切片，于是某一刀全是 D0/D1（慢），
   另一刀全是 D9（快）—— 并行度再高也被最慢的那一片卡住。
   ⚠ 哈希的输入**必须包含种子序号**（`job.base`）：只用 `dim|key` 的话，
   同一个角色的所有种子哈希相同，于是 `--shard 1 --of 8` 会一片空白
   （实测把一整片跑成 0 局）。 */
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const MINE = JOBS.filter(j => hash(j.dim + '|' + j.key + '|' + j.base) % OF === SHARD);

if (MERGE.length) {
  const offerAll = new Set();
  for (const f of MERGE) {
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      for (const r of (j.runs || [])) rec.runs.push(r);
      for (const id of (j.offered || [])) offerAll.add(id);
      for (const k of Object.keys(j.bought || {})) rec.bought[k] = (rec.bought[k] || 0) + j.bought[k];
      for (const k of Object.keys(j.sold || {})) rec.sold[k] = (rec.sold[k] || 0) + j.sold[k];
      for (const k of Object.keys(j.crafted || {})) rec.crafted[k] = (rec.crafted[k] || 0) + j.crafted[k];
    } catch (e) { console.log('  读不了 ' + f + '：' + e.message); }
  }
  rec.offered = [...offerAll];
  console.log('  合并了 ' + MERGE.length + ' 片 · ' + rec.runs.length + ' 局');
} else {
  const t0 = Date.now();
  let done = 0;
  for (const job of MINE) {
    for (const r of cell(job)) {
      rec.runs.push({
        dim: job.dim, key: job.key, char: r.char, danger: r.danger, waves: r.waves, floor: r.floor,
        level: r.level, kills: r.kills, won: r.won, hpAtEnd: r.hpAtEnd, maxHp: r.maxHp,
        materials: r.materials, alloy: r.alloy, coreEarned: r.coreEarned, healed: r.healed,
        weapons: r.weapons, items: r.items, secs: r.secs, state: r.state,
        buildChoices: r.buildChoices, buysOk: r.buysOk, buysTried: r.buysTried,
        snaps: r.snaps || []
      });
    }
    done++;
    if (process.env.MX_VERBOSE) {
      console.log('  [' + done + '/' + MINE.length + '] ' + job.dim + ' ' + job.key +
        ' · ' + ((Date.now() - t0) / 1000).toFixed(0) + 's');
    }
  }
  console.log('  本片跑完：' + rec.runs.length + ' 局 · ' + ((Date.now() - t0) / 1000).toFixed(0) +
    ' 秒 · 货架 ' + offerSet.size + ' 件');
}

if (OUT) {
  rec.offered = [...offerSet];
  rec.seeds = SEEDS;
  rec.maxWave = MAX_WAVE;
  fs.writeFileSync(OUT, JSON.stringify(rec));
  console.log('  写入 ' + OUT + '（' + rec.runs.length + ' 局 · 货架 ' + rec.offered.length + ' 件）');
  process.exit(0);
}

/* ---------------- 2. 报告 ---------------- */
const runs = rec.runs;
/* 合并模式下 `SEEDS` / `MAX_WAVE` 来自**命令行**而不是数据 ——
   不带 `--seeds 4` 去合并就会打出"每格 4 个种子 · 每局最多 40 波"，
   而实际可能完全不是（跑的时候是 `--maxWave 8`）。
   这些数字会被人当结论读，所以以**数据里记的**为准。 */
const SEEDS_SHOWN = rec.seeds || SEEDS;
const MAXWAVE_SHOWN = rec.maxWave || MAX_WAVE;
/* 每波快照只服务 [3] 那一节，而它让 JSON 大一圈（284 局约 3 MB）。
   跑到 [3] 之前**不能**丢 —— 第一版把这一行放在这里，于是
   「实测怪血 / 玩家等级」整列变成 `—`，看着像"玩家不长了"。 */

/* 曲线那一边（内部声明）单独取一份：`_run.mjs` 已经装好 DOM 并加载了模块，
   所以这里直接动态 import `curves.ts` —— 与游戏运行的是**同一份**表。 */
let curveRows = null;
try {
  const C = (await import('../src/curves.ts')).Curves;
  curveRows = C.checkpoint([1, 3, 6, 10, 15, 20, 25, 30, 39]);
} catch (e) { curveRows = null; }

console.log('\n=== Bronana · 矩阵体检 ===\n');
console.log('  ' + runs.length + ' 局 · 每格 ' + SEEDS_SHOWN + ' 个种子 · 每局最多 ' + MAXWAVE_SHOWN + ' 波' +
  ' · 同一个 runIndex = 同一个世界\n');

/* ---- [1] 角色维度 ---- */
console.log('[1] 角色维度（每个角色 × ' + SEEDS + ' 个种子）');
console.log('  ' + PAD('角色', 14) + PADL('波次中位', 9) + PADL('均值', 7) + PADL('离散', 7) +
  PADL('等级', 6) + PADL('击杀', 7) + PADL('终局血', 8) + PADL('材料', 7) + PADL('核心', 6) +
  PADL('通关', 7) + ' 构筑决策');
const charRows = [];
for (const c of Chars.LIST) {
  const rs = runs.filter(r => r.dim === 'char' && r.key === c.id);
  if (!rs.length) continue;
  const w = rs.map(r => r.waves);
  charRows.push({ id: c.id, name: c.name, med: med(w) });
  console.log('  ' + PAD(c.name + '(' + c.id + ')', 14) +
    PADL(med(w), 9) + PADL(mean(w).toFixed(1), 7) + PADL(sd(w).toFixed(1), 7) +
    PADL(med(rs.map(r => r.level)), 6) + PADL(med(rs.map(r => r.kills)), 7) +
    PADL(med(rs.map(r => r.maxHp)), 8) + PADL(med(rs.map(r => r.materials)), 7) +
    PADL(med(rs.map(r => r.coreEarned)), 6) +
    PADL(rs.filter(r => r.won).length + '/' + rs.length, 7) +
    ' ' + med(rs.map(r => r.buildChoices)));
}
{
  if (charRows.length < 2) {
    console.log('  （角色维度需要至少两个角色的样本才谈得上强弱对比）');
  } else {
    const all = charRows.map(r => r.med);
    const hi = charRows.slice().sort((a, b) => b.med - a.med)[0];
    const lo = charRows.slice().sort((a, b) => a.med - b.med)[0];
    const spread = Math.max(...all) / Math.max(1, Math.min(...all));
    console.log('  ' + PAD('最强/最弱', 14) + hi.name + ' ' + hi.med + ' 波  vs  ' + lo.name + ' ' + lo.med +
      ' 波 · 倍差 ' + spread.toFixed(2) + '×' +
      (spread > 2.0 ? '  \x1b[31m（>2×：有一个角色被落下了）\x1b[0m'
        : (spread > 1.6 ? '  \x1b[33m（偏大，值得看一眼）\x1b[0m' : '  \x1b[32m（在 1.6× 以内）\x1b[0m')));
  }
}
console.log('');

/* ---- [2] 难度维度 ----
   口径：**先按角色分别取中位，再跨角色取中位**。
   直接把一个难度下所有局混在一起取中位是不行的 —— 每个角色被分到的
   种子数不一样时，行与行的差距里就混进了"这一行恰好摊到更强的角色"。 */
console.log('[2] 难度维度（难度 0~9，每个难度 × ' + SEEDS + ' 个种子；中位是先分角色再跨角色）');
console.log('  ' + PAD('难度', 8) + PADL('波次中位', 9) + PADL('均值', 7) + PADL('通关率', 8) +
  PADL('等级', 6) + PADL('击杀', 7) + PADL('材料', 7) + PADL('核心', 6) +
  PADL('gladiator', 11) + PADL('engineer', 10) + PADL('mole', 7));
const dangerRows = [];
for (let d = 0; d <= 9; d++) {
  const rs = runs.filter(r => r.dim === 'danger' && r.key === String(d));
  if (!rs.length) continue;
  const byChar = Object.create(null);
  for (const r of rs) (byChar[r.char] = byChar[r.char] || []).push(r);
  const perCharMed = Object.keys(byChar).map(c => med(byChar[c].map(r => r.waves)));
  const perCharWin = Object.keys(byChar).map(c => byChar[c].filter(r => r.won).length / byChar[c].length);
  dangerRows.push({ d, med: med(perCharMed), win: mean(perCharWin) });
  const pc = (id) => (byChar[id] ? med(byChar[id].map(r => r.waves)) : '—');
  console.log('  ' + PAD('D' + d, 8) + PADL(med(perCharMed), 9) + PADL(mean(rs.map(r => r.waves)).toFixed(1), 7) +
    PADL((mean(perCharWin) * 100).toFixed(0) + '%', 8) +
    PADL(med(rs.map(r => r.level)), 6) + PADL(med(rs.map(r => r.kills)), 7) +
    PADL(med(rs.map(r => r.materials)), 7) + PADL(med(rs.map(r => r.coreEarned)), 6) +
    PADL(pc('gladiator'), 11) + PADL(pc('engineer'), 10) + PADL(pc('mole'), 7));
}
{
  const bad = [];
  for (let i = 1; i < dangerRows.length; i++) {
    if (dangerRows[i].med > dangerRows[i - 1].med + 1) {
      bad.push('D' + dangerRows[i - 1].d + '→D' + dangerRows[i].d + ' 反而更高');
    }
  }
  console.log('  ' + PAD('单调性', 8) + (bad.length ? '\x1b[33m' + bad.join(' · ') + '\x1b[0m'
    : '\x1b[32m波次随难度单调不升 ✔\x1b[0m'));
  const first = dangerRows[0], last = dangerRows[dangerRows.length - 1];
  if (first && last) {
    console.log('  ' + PAD('D0→D9', 8) + '波次中位 ' + first.med + ' → ' + last.med +
      '（差 ' + (first.med - last.med) + ' 波）· 通关率 ' + (first.win * 100).toFixed(0) + '% → ' +
      (last.win * 100).toFixed(0) + '% —— 这就是"难度"实际换来的东西');
  }
  if (bad.length) {
    console.log('  ' + PAD('', 8) + '（难度不是"一条数值曲线"：D1/D2 只抬怪血、D4 抬精英率、' +
      'D5 抬物价、D6 收紧时限、D8 提前对手、D9 双 Boss —— 每级改的东西不同，' +
      '所以"波次"这一列本来就不该是平滑的）');
  }
}
console.log('');

/* ---- [3] 波次维度：内部曲线 vs 实机落点 ---- */
console.log('[3] 波次维度：内部曲线（怪有多硬）vs 实机落点（到这一波时的水平）');
console.log('  ' + PAD('波', 5) + PADL('怪生命', 9) + PADL('怪伤害', 9) + PADL('怪移速', 9) +
  PADL('精英率', 8) + PADL('实测怪血', 10) + PADL('玩家等级', 10) + PADL('血上限', 9) +
  PADL('装备数', 9) + PADL('样本', 6));
{
  /* 实机落点取 `waveStart` 那一刻的**当场数值**（见 `waveSnaps` 的注释：
     拿终局数值回头填会把"到第 10 波就不长了"这种假象造出来）。 */
  const at = (cp, f) => {
    const v = [];
    for (const r of runs) for (const s of (r.snaps || [])) if (s.wave === cp) v.push(f(s));
    return v.length ? med(v) : '—';
  };
  const n = (cp) => runs.reduce((a, r) => a + (r.snaps || []).filter(s => s.wave === cp).length, 0);
  const CP = [1, 3, 6, 10, 15, 20, 25, 30, 39];
  const byWave = Object.create(null);
  if (curveRows) for (const r of curveRows) byWave[r.room] = r;
  for (const cp of CP) {
    const c = byWave[cp];
    console.log('  ' + PAD(cp, 5) +
      (c ? PADL(c.enemyHp.toFixed(1), 9) + PADL(c.enemyDmg.toFixed(2), 9) + PADL(c.enemySpeed.toFixed(3), 9) +
        PADL((c.eliteChance * 100).toFixed(0) + '%', 8) : PADL('—', 9) + PADL('—', 9) + PADL('—', 9) + PADL('—', 8)) +
      PADL(at(cp, s => s.enemyHp) || '—', 10) + PADL(at(cp, s => s.level), 10) +
      PADL(at(cp, s => s.maxHp), 9) +
      PADL(at(cp, s => s.weapons + s.items), 9) + PADL(n(cp), 6));
  }
  console.log('  怎么读：左边四列是**声明**（`curves.ts`：怪每一波长多硬），');
  console.log('  「实测怪血」是到这一波时场上怪的平均生命（与左边第二列同量纲，可对读）。');
  console.log('  右边三列是**玩家那一边的实时水平** —— 它必须随波次往上走；');
  console.log('  如果它在中段就平了，那说明成长跟不上难度（或者工具用错了口径）。');
}
console.log('');

/* ---- [4] 内容维度：三级漏斗 ---- */
  console.log('[4] 内容维度：武器 / 道具的三级漏斗（上过货架 → 被买走 → 活到终局）');
  if (!runs.length) {
    console.log('  （这一片没有对局：换一个 --shard，或去掉 --dim 限制跑全维度）');
    console.log('');
  }

/* ---- [4] 内容维度：三级漏斗 ---- */
/* 每波快照只服务 [3] 那一节，而它让 JSON 大一圈（284 局约 3 MB）。
   跑到这里就丢 —— 但**必须在 [3] 之后**丢（第一版放在最前面，
   于是 [3] 的「实测怪血 / 玩家等级」整列变成 `—`，看着像"玩家不长"。） */
for (const r of runs) delete r.snaps;
console.log('[4] 内容维度：武器 / 道具的三级漏斗（上过货架 → 被买走 → 活到终局）');
{
  const offered = new Set(rec.offered || []);
  const bought = new Set(Object.keys(rec.bought || {}));
  const kept = new Set();
  for (const r of runs) {
    for (const w of r.weapons) kept.add(w.split(':')[0]);
    for (const it of r.items) kept.add(it);
  }
  const stage = (list, label) => {
    const total = Math.max(1, list.length);
    const o = list.filter(x => offered.has(x.id)).length;
    const b = list.filter(x => bought.has(x.id)).length;
    const k = list.filter(x => kept.has(x.id)).length;
    console.log('  ' + PAD(label, 8) + '共 ' + PADL(list.length, 3) + ' 件 · 上过货架 ' + PADL(o, 3) +
      ' · 被买走 ' + PADL(b, 3) + ' · 活到终局 ' + PADL(k, 3) +
      '   （' + (o / total * 100).toFixed(0) + '% → ' + (b / total * 100).toFixed(0) +
      '% → ' + (k / total * 100).toFixed(0) + '%）');
    return list;
  };
  const allW = stage(Weapons.LIST, '武器');
  const allI = stage(Items.LIST, '道具');
  const never = allW.filter(x => !bought.has(x.id)).map(x => x.id)
    .concat(allI.filter(x => !bought.has(x.id)).map(x => x.id));
  console.log('  ' + PAD('没被买走', 8) + (never.length ? never.slice(0, 14).join(', ') +
    (never.length > 14 ? ' …（共 ' + never.length + '）' : '') : '（全被买走过）'));
  const cnt = rec.bought || {};
  const ids = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]);
  const tot = Math.max(1, ids.reduce((a, k) => a + cnt[k], 0));
  if (ids.length) {
    console.log('  ' + PAD('最常见', 8) + ids.slice(0, 6).map(k => k + '×' + cnt[k]).join(' · '));
    console.log('  ' + PAD('偏斜', 8) + '最常见一件占 ' + (cnt[ids[0]] / tot * 100).toFixed(1) + '%' +
      ' · 前五占 ' + (ids.slice(0, 5).reduce((a, k) => a + cnt[k], 0) / tot * 100).toFixed(0) + '%');
  }
  console.log('  ' + PAD('回收/合成', 8) + Object.keys(rec.sold || {}).length + ' 种被卖过 · ' +
    Object.keys(rec.crafted || {}).length + ' 种被合成过' +
    (Object.keys(rec.crafted || {}).length ? '（' +
      Object.keys(rec.crafted).sort((a, b) => rec.crafted[b] - rec.crafted[a]).slice(0, 6)
        .map(k => k + '×' + rec.crafted[k]).join(' · ') + '）' : '') +
    ' —— 合金只从"舍"里来，这两个数字是那条循环的入口');
  console.log('  怎么读：第一级是"抽得到吗"，第三级是"值不值得留"。');
  console.log('  **第二级掉得厉害**才是内容问题（摆着但没人买）；只有第三级低是正常的');
  console.log('  （终局只有几个格子）。三级全是 0 的那几件是真没被触达。');
}
console.log('');

/* ---- [5] 循环维度 ---- */
console.log('[5] 循环维度：三模块的入口产出（每局带出多少）');
{
  const mk = (r) => ({
    char: r.char, wave: r.waves, level: r.level, kills: r.kills, materials: r.materials,
    damage: 0, taken: 0, healed: r.healed, packs: 0, win: r.won, danger: r.danger,
    alloy: r.alloy, coreEarned: r.coreEarned
  });
  const spores = runs.map(r => { try { return Profile.sporesForRun(mk(r)) || 0; } catch (e) { return 0; } });
  const alloy = runs.map(r => { try { return Profile.alloyForRun(mk(r)) || 0; } catch (e) { return 0; } });
  console.log('  ' + PAD('孢子', 8) + '中位 ' + PADL(med(spores), 5) + ' 合计 ' +
    spores.reduce((a, b) => a + b, 0) + '（经营与养成的通用燃料）');
  console.log('  ' + PAD('合金', 8) + '中位 ' + PADL(med(alloy), 5) + ' 合计 ' +
    alloy.reduce((a, b) => a + b, 0) + '（只从"回收装备"来）');
  console.log('  ' + PAD('核心', 8) + '中位 ' + PADL(med(runs.map(r => r.coreEarned)), 5) + ' 合计 ' +
    runs.reduce((a, r) => a + r.coreEarned, 0) + '（只有关底 Boss 掉；据点 L3 与神话图纸各要 2）');
  const noCore = runs.filter(r => r.coreEarned <= 0).length;
  console.log('  ' + PAD('零核心局', 8) + noCore + ' / ' + runs.length + '（' +
    (noCore / runs.length * 100).toFixed(0) + '%）—— 这些局对"关键产出"没有推进');
  console.log('  怎么读：三笔钱的**来源**必须都回到战斗（`economy.ts` 的循环图），');
  console.log('  而"花在哪里"的落点是据点 / 图纸 / 商店 —— `pnpm run loop` 打那张图。');
}
console.log('');

console.log('  怎么读：这张表是**维度切片**，不是结论。判定要与 `pnpm run fun`（典型体验）');
console.log('  和 README 里那张外部对照表一起读 —— 单个维度的数字很容易被种子数骗。\n');
