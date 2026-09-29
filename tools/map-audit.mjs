/* =========================================================
   map-audit.mjs — 地图体检（形状 / 选择 / 深度价值 / 密室）

   为什么要有它：地图是"手感的来源"，但它不像数值那样能被一局跑出来 ——
   "这张图有没有选择"必须**量很多层**才看得出来。这个工具就是那把尺子：
   240 个种子 × 3 层 = 720 层，只读 `Dungeon.genFloor`，不跑对局。

   它回答四个问题：
     1. 形状：每层几间、几个死路、几个岔口、有没有回路、最深几步
     2. 房型：特殊房的**落点**是不是常量（常量 = 玩家背下来就行 = 没有路线选择）
     3. 选择：直线冲关底要清几间、收齐要清几间、路上有几个"≥2 条岔路"的决策点
     4. 密室：几面可破墙、离入口几间

   用法： node tools/map-audit.mjs            （720 层）
          node tools/map-audit.mjs 60         （前 60 个种子，快速看一眼）
   ========================================================= */
import { loadAll, SIM_MODULES } from '../test/_load.mjs';

await loadAll(SIM_MODULES);
const { Dungeon } = globalThis;
console.error = function () { };

const N = Math.max(1, Math.floor(Number(process.argv[2]) || 240));
const SEEDS = [];
for (let i = 0; i < N; i++) SEEDS.push((i + 1) * 7919 % 1000003 + 1);

const SPECIALS = ['treasure', 'shop', 'camp', 'event'];
const VALUE = { treasure: 3, elite: 2, shop: 2, camp: 1, event: 1, rush: 1 };
const TYPE_ORDER = ['start', 'fight', 'elite', 'treasure', 'shop', 'camp', 'event', 'rush', 'boss', 'secret'];

const avg = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const f1 = n => (Math.round(n * 100) / 100).toFixed(2);

/** 从入口出发，每次走"最近的未清房"，直到踩到关底（或走完）。
 *  `untilBoss` = 踩到关底就停（模拟"直线冲关底"）；否则把整层收干净。 */
function walk(fl, byId, untilBoss) {
  let here = fl.start, steps = 0, choices = 0;
  const cleared = { [fl.start]: true };
  const todo = new Set(fl.rooms.filter(r => r.id !== fl.start && r.type !== 'secret').map(r => r.id));
  const got = {};
  let guard = 0;
  while (todo.size && guard++ < 400) {
    const prev = { [here]: null }, q = [here];
    let found = null;
    while (q.length && !found) {
      const c = q.shift();
      for (const nb of Dungeon.neighbours(fl, byId[c])) {
        if (prev[nb.id] !== undefined) continue;
        const lk = Dungeon.link(fl, byId[c], nb);
        if (!lk || !lk.door) continue;
        prev[nb.id] = c;
        if (todo.has(nb.id)) { found = nb.id; break; }
        q.push(nb.id);
      }
    }
    if (!found) break;
    const path = []; let c2 = found;
    while (c2) { path.unshift(c2); c2 = prev[c2]; }
    for (const id of path) {
      if (cleared[id]) continue;
      cleared[id] = true; todo.delete(id); steps++;
      const open = Dungeon.neighbours(fl, byId[id]).filter(n => !cleared[n.id] && todo.has(n.id)).length;
      if (open >= 2) choices++;
      const ty = byId[id].type;
      if (ty !== 'fight' && ty !== 'start') got[ty] = (got[ty] || 0) + 1;
    }
    here = found;
    if (untilBoss && byId[found].type === Dungeon.BOSS_TYPE) break;
  }
  return { steps, choices, got };
}

/* ---------------- 体检 ---------------- */
let rooms = 0, deadEnds = 0, junctions = 0, cycles = 0, maxDepth = 0, gridFill = 0;
let bossDeepest = 0, secretWalls = 0, secretDepth = 0, secrets = 0;
let toBoss = 0, toAll = 0, choicePts = 0, floors = 0;
let treasureDeepest = 0, treasureDeepestOld = 0;
const rankHist = [0, 0, 0, 0];
const deadRank = [];
const typeCount = {};
const depthRank = {};

for (const seed of SEEDS) {
  for (let f = 1; f <= Dungeon.FLOORS; f++) {
    const fl = Dungeon.genFloor(seed, f);
    const byId = {}; fl.rooms.forEach(r => byId[r.id] = r);
    floors++;
    rooms += fl.rooms.length;
    gridFill += fl.rooms.length / ((Dungeon.GRID * 2 + 1) ** 2);

    let edges = 0;
    for (const r of fl.rooms) {
      const normal = Dungeon.neighbours(fl, r)
        .filter(n => { const lk = Dungeon.link(fl, r, n); return lk && !lk.hidden; });
      edges += Dungeon.neighbours(fl, r).length;
      if (r.type !== 'start' && r.type !== 'secret' && normal.length === 1) deadEnds++;
      if (Dungeon.neighbours(fl, r).length >= 3) junctions++;
      if (r.depth > maxDepth) maxDepth = r.depth;
      typeCount[r.type] = (typeCount[r.type] || 0) + 1;
    }
    cycles += edges / 2 - fl.rooms.length + 1;

    // 特殊房在**深度**上的名次（1.00 = 最深的那间）
    const sorted = fl.rooms.slice().sort((a, b) => b.depth - a.depth);
    sorted.forEach((r, i) => {
      const pct = 1 - i / Math.max(1, sorted.length - 1);
      if (r.type !== 'secret' && r.type !== 'start' && r.type !== 'fight') {
        (depthRank[r.type] = depthRank[r.type] || []).push(pct);
      }
      if (r.id === fl.boss) bossDeepest += pct;
      if (r.type !== 'start' && r.type !== 'secret' &&
        Dungeon.neighbours(fl, r).filter(n => { const lk = Dungeon.link(fl, r, n); return lk && !lk.hidden; }).length === 1) {
        deadRank.push(pct);
      }
    });

    // 选择：直线冲关底 vs 收齐整层
    const a = walk(fl, byId, true), b = walk(fl, byId, false);
    toBoss += a.steps; toAll += b.steps; choicePts += b.choices;

    // 密室
    for (const sid of fl.secrets) {
      secrets++;
      const bs = Dungeon.breakables(fl, sid);
      secretWalls += bs.length;
      let near = 99;
      for (const x of bs) {
        const p = Dungeon.path(fl, fl.start, x.from, null);
        if (p.length) near = Math.min(near, p.length - 1);
      }
      if (near < 99) secretDepth += near;
    }

    /* 特殊房与深度的对应关系：现在 vs "按深度固定顺序"的旧规则（精确重建）。
       旧规则能背下来（宝箱永远在四间里最深的那支）→ 地图没有路线选择可言。 */
    const four = fl.rooms.filter(r => SPECIALS.indexOf(r.type) >= 0).sort((x, y) => y.depth - x.depth);
    if (four.length === SPECIALS.length) {
      const ti = four.findIndex(r => r.type === 'treasure');
      rankHist[ti]++;
      if (ti === 0) treasureDeepest++;
    }
    const clone = fl.rooms.map(r => ({ ...r, doors: r.doors.slice() }));
    const cById = {}; clone.forEach(r => cById[r.id] = r);
    clone.forEach(r => { if (r.type !== 'start' && r.type !== 'secret') r.type = 'fight'; });
    const de = clone.filter(r => r.id !== fl.start &&
      Dungeon.neighbours({ rooms: clone }, r).filter(n => cById[n.id]).length === 1)
      .sort((x, y) => y.depth - x.depth);
    const usedOld = {};
    if (de.length) { cById[de[0].id].type = 'boss'; usedOld[de[0].id] = true; }
    for (const t of SPECIALS) {
      let cand = de.filter(r => !usedOld[r.id])[0];
      if (!cand) cand = clone.filter(r => !usedOld[r.id] && r.type === 'fight').sort((x, y) => y.depth - x.depth)[0];
      if (!cand) break;
      cand.type = t; usedOld[cand.id] = true;
    }
    const fourOld = clone.filter(r => SPECIALS.indexOf(r.type) >= 0).sort((x, y) => y.depth - x.depth);
    if (fourOld.length === SPECIALS.length && fourOld[0].type === 'treasure') treasureDeepestOld++;
  }
}

console.log('=== 地图体检：' + SEEDS.length + ' 种子 × ' + Dungeon.FLOORS + ' 层 = ' + floors + ' 层 ===\n');
console.log('形状');
console.log('  每层房间  ' + f1(rooms / floors) + '（含密室）· 网格占用 ' +
  (100 * gridFill / floors).toFixed(0) + '%（GRID=' + Dungeon.GRID + ' → ' + ((Dungeon.GRID * 2 + 1) ** 2) + ' 格）');
console.log('  死路/层   ' + f1(deadEnds / floors) + ' · 岔口(≥3 门)/层 ' + f1(junctions / floors));
console.log('  环数/层   ' + f1(cycles / floors) + '（0 = 一棵树：没有捷径、没有回路）');
console.log('  最大深度  ' + maxDepth + ' 步');

console.log('\n房型（每层平均件数）');
TYPE_ORDER.forEach(t => console.log('  ' + t.padEnd(9) + f1((typeCount[t] || 0) / floors)));

/* 一局的分配：四类特殊房在**本局**各恰好 3 次（总产出不变），但分在哪几层是会变的。
   这里量的是"楼层之间到底有没有区别" —— 0% = 每层一模一样（改造前就是那样）。 */
{
  let lack = 0, runs = 0;
  const perFloor = {};        // 层号 → 该层各类的平均件数
  for (const seed of SEEDS) {
    const plan = Dungeon.runPlan(seed);
    runs++;
    for (let f = 0; f < plan.length; f++) {
      perFloor[f] = perFloor[f] || {};
      for (const t of Dungeon.RUN_SPECIALS) {
        const c = plan[f].filter(x => x === t).length;
        perFloor[f][t] = (perFloor[f][t] || 0) + c / SEEDS.length;
      }
      if (Dungeon.RUN_SPECIALS.some(t => plan[f].indexOf(t) < 0)) lack++;
    }
  }
  console.log('\n一局的特殊房分配（' + runs + ' 局 · 每类仍是 3 次/局，变的是分布）');
  console.log('  层     ' + Dungeon.RUN_SPECIALS.map(t => t.padStart(9)).join(''));
  Object.keys(perFloor).forEach(f => {
    console.log('  第' + (Number(f) + 1) + '层  ' +
      Dungeon.RUN_SPECIALS.map(t => f1(perFloor[f][t]).padStart(9)).join(''));
  });
  const share = 100 * lack / Math.max(1, runs * Dungeon.FLOORS);
  console.log('  → ' + share.toFixed(0) + '% 的层**缺**四类里的某一类（改造前恒为 0%：每层一模一样）');
}

console.log('\n特殊房在**深度**上的位置（1.00 = 永远是最深的那一间）');
TYPE_ORDER.filter(t => t !== 'start' && t !== 'fight' && t !== 'secret').forEach(t => {
  const a = depthRank[t] || [];
  if (a.length) console.log('  ' + t.padEnd(9) + f1(avg(a)) + '（' + a.length + ' 次）');
});
console.log('  死路整体  ' + f1(avg(deadRank)));

console.log('\n选择');
console.log('  直线冲关底最少清 ' + f1(toBoss / floors) + ' 间');
console.log('  收齐整层要清     ' + f1(toAll / floors) + ' 间');
console.log('  → 可跳过 ' + f1(rooms / floors - toAll / floors) + ' 间 = 全层的 ' +
  (100 * (1 - toAll / rooms)).toFixed(0) + '%');
console.log('  路线里"≥2 个未清邻居"的决策点 ' + f1(choicePts / floors) + ' 次/层');

console.log('\n密室');
console.log('  可破墙 ' + f1(secretWalls / Math.max(1, secrets)) + ' 面/间（' + secrets + ' 间）');
console.log('  从入口到最近一面可破墙 ' + f1(secretDepth / Math.max(1, secrets)) + ' 间');

console.log('\n特殊房 ↔ 深度的对应关系（旧规则 = 按深度固定顺序，可精确重建）');
console.log('  "四间特殊房里最深的那支是宝箱"：旧 ' + (100 * treasureDeepestOld / floors).toFixed(0) +
  '% → 现在 ' + (100 * treasureDeepest / floors).toFixed(0) + '%');
console.log('  宝箱在四间里的深度名次（0 = 最深）：' +
  rankHist.map((n, i) => i + '→' + (100 * n / Math.max(1, rankHist.reduce((x, y) => x + y, 0))).toFixed(0) + '%').join('  '));

/* 一层之内的深度收益（game.ts 的 depthBonus）：浅房略少、深房略多，整层平均不变。
   这里只量**梯度有多大**（具体的材料数在 rooms.mjs 的断言语境里）。 */
{
  let rel = [];
  for (const seed of SEEDS.slice(0, 20)) {
    for (let f = 1; f <= Dungeon.FLOORS; f++) {
      const fl = Dungeon.genFloor(seed, f);
      let sum = 0;
      for (const r of fl.rooms) sum += r.depth;
      const mean = sum / Math.max(1, fl.rooms.length);
      for (const r of fl.rooms) rel.push((r.depth - mean) * 0.10);
    }
  }
  const lo = Math.min(...rel), hi = Math.max(...rel), mid = avg(rel);
  console.log('\n一层之内的深度收益（以本层平均深度为基准，每步 10%）');
  console.log('  浅端 ' + (100 * lo).toFixed(0) + '% · 深端 +' + (100 * hi).toFixed(0) +
    '% · 整层平均 ' + (100 * mid).toFixed(1) + '%（≈0 = 梯度，不是通胀）');
}
/* 环境（层主题）：这一局的三层分别"长什么样"。
   改造前层号**直接查表**（`THEMES[f-1]`），所以一百局都是同一条序列，
   而且 `theme` 在渲染层一次都没被读过 —— 环境只是小地图标题上的两个字。
   这里量的是：同一层到底有几种可能、这一局抽到的是哪一条序列。 */
{
  const perFloor = {};          // 层号 → { 主题id: 次数 }
  const bandStat = {};          // 带号 → { hp:[], dmg:[], ids:Set }
  const chainCount = {};        // '一层的环境 → 二层 → 三层' 出现次数
  const propCount = {};
  for (const seed of SEEDS) {
    const chain = [];
    for (let f = 1; f <= Dungeon.FLOORS; f++) {
      const th = Dungeon.THEME_BY_ID[Dungeon.genFloor(seed, f).theme];
      chain.push(th.id);
      (perFloor[f] = perFloor[f] || {})[th.id] = (perFloor[f][th.id] || 0) + 1;
      const b = bandStat[th.band] = bandStat[th.band] || { hp: [], dmg: [], ids: new Set(), shift: th.poolShift };
      b.hp.push(th.hpMul); b.dmg.push(th.dmgMul); b.ids.add(th.id);
      propCount[th.prop] = (propCount[th.prop] || 0) + 1;
    }
    const k = chain.join(' → ');
    chainCount[k] = (chainCount[k] || 0) + 1;
  }
  const chains = Object.keys(chainCount);
  const top = chains.slice().sort((a, b) => chainCount[b] - chainCount[a])[0];
  const possible = Object.values(bandStat).reduce((n, b) => n * b.ids.size, 1);

  console.log('\n环境（层主题）：' + Dungeon.THEMES.length + ' 种，按难度分 ' + Dungeon.BANDS + ' 带，同带内抽签');
  console.log('  层    本层出现过的环境数   分布');
  Object.keys(perFloor).forEach(f => {
    const dist = perFloor[f];
    const ids = Object.keys(dist).sort((a, b) => dist[b] - dist[a]);
    console.log('  第' + f + '层  ' + String(ids.length).padStart(2) + ' 种' + ' '.repeat(14) +
      ids.map(id => Dungeon.THEME_BY_ID[id].name + ' ' + (100 * dist[id] / SEEDS.length).toFixed(0) + '%').join(' · '));
  });
  console.log('  带的构成');
  Object.keys(bandStat).sort().forEach(b => {
    const s = bandStat[b], c = Dungeon.BAND_CENTER[b];
    console.log('  第' + b + '带  ' + s.ids.size + ' 种（' + [...s.ids].join('/') + '）· 生命均值 ' +
      f1(avg(s.hp)) + '（带心 ' + c.hp.toFixed(2) + '）· 伤害均值 ' + f1(avg(s.dmg)) +
      '（带心 ' + c.dmg.toFixed(2) + '）· 怪物池 +' + s.shift);
  });
  console.log('  → 本批 ' + SEEDS.length + ' 局里出现过 ' + chains.length + ' 条不同的"三层环境序列"（理论上限 ' + possible + '）');
  console.log('     最常见的一条占 ' + (100 * chainCount[top] / SEEDS.length).toFixed(0) + '%：' + top +
    '（改造前是 100%）');
  console.log('  装饰物种类（' + Dungeon.PROP_KINDS.length + ' 种）分布：' +
    Dungeon.PROP_KINDS.map(k => k + ' ' + (100 * (propCount[k] || 0) / (SEEDS.length * Dungeon.FLOORS)).toFixed(0) + '%').join(' · '));
}
console.log('\n读法：旧规则下"往最深的那一簇钻"永远是最优解（宝箱 68~79% 在最深那支），');
console.log('      那是**背下来就行**的规则、不是选择；现在四个名次接近均匀。');
console.log('      座位本身没变（还是那几条最深的死路）：试过"座位也随机"，实测绕路压力被抹掉，');
console.log('      所以只洗牌、不动座位。');
console.log('      环境那一节里的"带心"就是改造前那一档的数值 —— 抽签只改长相，不改难度。');
void VALUE;
