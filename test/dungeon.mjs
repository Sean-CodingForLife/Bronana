/* =========================================================
   dungeon.mjs — 地牢地图（随机楼层 + **隐藏要素**）

   地图生成是全项目最容易"偶尔生出一张坏图"的地方：
   99% 的种子看着都对，第 100 个种子长出两间 Boss 房、或者一间走不到的房。
   所以这一套的核心不是"生成出来的图长得对不对"，而是**几百个种子的性质**：

     · 连通：从入口出发，不破墙能走到的房间 = 除密室外的全部
     · **密室不可达**：不破墙绝对进不去（否则隐藏就不是隐藏）
     · 恰好一间 Boss 房，且在**最深的死路**上
     · 宝箱 / 商店 / 营地 各恰好一间
     · 密室与 ≥2 个房间相邻（以撒的秘密房规则），且每间密室都有可破的墙 + 一条线索种子
     · 同种子必得同图；地图里的坐标不重复、不越界
     · 房间数在区间内（太少没得走，太多一层能逛半小时）

   用法： node test/dungeon.mjs
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { loadAll, SIM_MODULES } from './_load.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
let failures = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  \x1b[32mPASS\x1b[0m ' + label);
  else { failures++; console.log('  \x1b[31mFAIL\x1b[0m ' + label + (extra !== undefined ? '  → ' + extra : '')); }
}

await loadAll(SIM_MODULES);
const { Dungeon, Registry, U } = globalThis;
console.error = function () { };

console.log('\n=== Bronana · 地牢地图（随机楼层 / 隐藏要素） ===\n');

const SEEDS = [];
for (let i = 0; i < 300; i++) SEEDS.push((i * 2654435761 + 12345) >>> 0);

/** 从入口出发、只走"通的"门（暗门不算通）能到达的房间 */
function reachable(fl) {
  const start = Dungeon.roomById(fl, fl.start);
  const seen = new Set([start.id]);
  const q = [start];
  while (q.length) {
    const cur = q.shift();
    for (const nb of Dungeon.neighbours(fl, cur)) {
      const lk = Dungeon.link(fl, cur, nb);
      if (!lk || lk.hidden) continue;          // 暗门不算通路
      if (seen.has(nb.id)) continue;
      seen.add(nb.id);
      q.push(nb);
    }
  }
  return seen;
}

/* ---------------- 1. 表自身 ---------------- */
console.log('[1] 房型表与主题表');
{
  const a = Dungeon.audit();
  ok(a.ok === true, '定义期自检通过（' + a.counts.types + ' 房型 / ' + a.counts.themes + ' 主题）',
    a.problems.join(' | '));
  const secret = Dungeon.TYPE_BY_ID.secret;
  ok(secret && secret.secret === true && secret.budgetMul === 0,
    '**隐藏房是一等公民**：房型表里显式标了 secret，而且不刷怪', JSON.stringify(secret));
  ok(Dungeon.TYPE_BY_ID.boss.budgetMul > Dungeon.TYPE_BY_ID.elite.budgetMul &&
     Dungeon.TYPE_BY_ID.elite.budgetMul > Dungeon.TYPE_BY_ID.fight.budgetMul,
    '预算倍率随难度递增（战斗 < 精英 < Boss）：' +
    [Dungeon.TYPE_BY_ID.fight.budgetMul, Dungeon.TYPE_BY_ID.elite.budgetMul, Dungeon.TYPE_BY_ID.boss.budgetMul].join(' < '));
  ok(Dungeon.THEMES.length >= Dungeon.FLOORS + 1,
    '主题数 ≥ 层数+1（多出来的那层是通关后的可选挑战）', Dungeon.THEMES.length);
  ok(Dungeon.THEMES.every(t => t.hpMul > 0 && t.dmgMul > 0), '主题倍率都是正数');

  const audit = Registry.audit();
  const probs = audit.problems.filter(p => p.family === 'roomType' || p.family === 'floorTheme');
  ok(probs.length === 0, 'registry 审计对房间/主题家族不报错', probs.length);
  ok(Registry.has('roomType') && Registry.has('floorTheme'), '两个家族都登记进了扩展点总账');
}

/* ---------------- 2. 300 个种子的性质 ---------------- */
console.log('\n[2] 300 个种子 × 3 层：地图必须是"能走通的图"，不能赌运气');
{
  const bad = { unreachable: [], secretReachable: [], bossCount: [], bossNotDeepest: [],
    specials: [], secretNeighbours: [], dup: [], outOfGrid: [], size: [], noClue: [],
    fewDeadEnds: [] };
  /* 特殊房落点的统计（见下面那两条断言）：
     ① 死路数 —— "≥5 个死路"是生成器的意图，而密室会把邻居从死路变成走廊
     ② 四间特殊房的深度名次 —— 宝箱永远是"四间里最深的那支"就是一条**背下来就行**的规则 */
  let deadEndTotal = 0, floors = 0, deadEndLow = 0, deepestIsTreasure = 0;
  const treasureRank = [0, 0, 0, 0];
  const SPEC4 = ['treasure', 'shop', 'camp', 'event'];
  for (const seed of SEEDS) {
    for (let floor = 1; floor <= Dungeon.FLOORS; floor++) {
      const fl = Dungeon.genFloor(seed, floor);
      const tag = seed + '/F' + floor;
      const reach = reachable(fl);
      const normals = fl.rooms.filter(r => r.type !== 'secret');
      for (const r of normals) if (!reach.has(r.id)) bad.unreachable.push(tag + ':' + r.id);
      // 密室不许被"走"到
      for (const id of fl.secrets) if (reach.has(id)) bad.secretReachable.push(tag + ':' + id);
      // 恰好一间 Boss，且在**最深的死路**上。
      // "死路"的准确定义：**非暗门的邻居恰好一个** —— 密室可以挨着 Boss 房
      // （以撒也这样），那时它多出来的那面是暗门，不算通路。
      const bosses = fl.rooms.filter(r => r.type === 'boss');
      if (bosses.length !== 1) bad.bossCount.push(tag + '=' + bosses.length);
      if (bosses.length === 1) {
        const b = bosses[0];
        const normalNeighbours = Dungeon.neighbours(fl, b)
          .filter(n => { const lk = Dungeon.link(fl, b, n); return lk && !lk.hidden; });
        if (normalNeighbours.length !== 1) bad.bossNotDeepest.push(tag + ':正常门 ' + normalNeighbours.length + ' 扇');
        const deadDepths = fl.rooms
          .filter(r => r !== Dungeon.roomById(fl, fl.start) && r.type !== 'secret' &&
            Dungeon.neighbours(fl, r).filter(n => { const lk = Dungeon.link(fl, r, n); return lk && !lk.hidden; }).length === 1)
          .map(r => r.depth);
        if (b.depth !== Math.max(...deadDepths)) {
          bad.bossNotDeepest.push(tag + ':' + b.depth + '<最深死路 ' + Math.max(...deadDepths));
        }
        if (b.depth < 2) bad.bossNotDeepest.push(tag + ':Boss 离入口只有 ' + b.depth + ' 步');
      }
      /* 特殊房：**每层恰好 4 间**（宝箱/商店/补给/事件这四类里挑），
         而"四类各至少一次"是**一局**的保证（见下面的 runPlan 断言）。
         改造前是"每层四类各一间"—— 于是三层一模一样，楼层之间没有区别。 */
      {
        const four = fl.rooms.filter(r => (Dungeon.RUN_SPECIALS || []).indexOf(r.type) >= 0);
        if (four.length !== 4) bad.specials.push(tag + ':特殊房 ' + four.length + ' 间（应为 4）');
      }
      /* 限时房也要**恰好一间**：它是一种玩法（抢时间），按概率出现的话
          某些层会完全没有它 —— 玩家就学不会"这一间要抢"。 */
      {
        const c = fl.rooms.filter(r => r.type === 'rush').length;
        if (c !== 1) bad.specials.push(tag + ':rush=' + c);
      }
      // 密室规则：与 ≥2 个房间相邻 + 有可破的墙 + 有线索种子
      for (const id of fl.secrets) {
        const sec = Dungeon.roomById(fl, id);
        const nb = Dungeon.neighbours(fl, sec);
        if (nb.length < 2) bad.secretNeighbours.push(tag + ':' + id + '=' + nb.length);
        if (Dungeon.breakables(fl, id).length < 1) bad.secretNeighbours.push(tag + ':没有可破的墙');
        if (!(sec.clueSeed > 0)) bad.noClue.push(tag + ':' + id);
        if (sec.seen !== false) bad.noClue.push(tag + ':密室一开始就是"已发现"');
      }
      // 坐标不重复、不越界
      const cells = new Set();
      for (const r of fl.rooms) {
        const k = r.x + ',' + r.y;
        if (cells.has(k)) bad.dup.push(tag + ':' + k);
        cells.add(k);
        if (Math.abs(r.x) > Dungeon.GRID || Math.abs(r.y) > Dungeon.GRID) bad.outOfGrid.push(tag + ':' + k);
      }
      if (fl.count < 6 || fl.count > 20) bad.size.push(tag + '=' + fl.count);
      /* 死路（非暗门邻居恰好一个）：它是"可选的分支"，也是特殊房的座位。
         实测：修"密室把死路吃成 3.06 个"之前，这个数长期低于生成器自己写的下限 5。 */
      {
        const des = fl.rooms.filter(r => r !== Dungeon.roomById(fl, fl.start) && r.type !== 'secret' &&
          Dungeon.neighbours(fl, r).filter(n => { const lk = Dungeon.link(fl, r, n); return lk && !lk.hidden; }).length === 1);
        deadEndTotal += des.length;
        floors++;
        if (des.length < 3) deadEndLow++;
      }
      /* 四间特殊房里"最深的那支"是谁 —— 这条以前是常量（宝箱：实测 68~79%），
         于是"往最深的一簇钻"永远是最优解，地图就没有路线选择可言。
         现在落点洗牌，四个名次都该出现（每条 ≥10%）。 */
      {
        const four = fl.rooms.filter(r => SPEC4.indexOf(r.type) >= 0).sort((a, b) => b.depth - a.depth);
        if (four.length === SPEC4.length) {
          const ti = four.findIndex(r => r.type === 'treasure');
          treasureRank[ti]++;
          if (ti === 0) deepestIsTreasure++;
        }
      }
    }
  }
  const total = SEEDS.length * Dungeon.FLOORS;
  ok(bad.unreachable.length === 0, '不破墙能走到每一间普通房（' + total + ' 层全过）',
    bad.unreachable.slice(0, 3).join(', '));
  ok(bad.secretReachable.length === 0, '**密室不破墙绝对进不去**（隐藏才是隐藏）',
    bad.secretReachable.slice(0, 3).join(', '));
  ok(bad.bossCount.length === 0, '每层恰好一间 Boss 房', bad.bossCount.slice(0, 3).join(', '));
  ok(bad.bossNotDeepest.length === 0,
    'Boss 房是最深的死路、且离入口至少 2 步（"越走越深"是真的）',
    bad.bossNotDeepest.slice(0, 3).join(', '));
  ok(bad.specials.length === 0, '每层恰好 4 间特殊房（宝箱/商店/补给/事件里挑）+ 1 间限时',
    bad.specials.slice(0, 3).join(', '));
  /* 一局的分配：四类在**这一局的三层里**必须都出现过（表里有、局里没有 = 死内容），
     而"哪一层有什么"是可以变的 —— 那正是"这一层没商店，钱留不留到二层"的来源。
     同时验证总产出**一点没变**：每类恰好 3 次/局（改造前是每层各一间 = 3 次/局）。 */
  {
    const badPlan = [];
    let floorsWithMissing = 0, runCount = 0;
    for (const seed of SEEDS.slice(0, 120)) {
      const plan = Dungeon.runPlan(seed);
      const flat = plan.reduce((a, b) => a.concat(b), []);
      for (const t of Dungeon.RUN_SPECIALS) {
        const c = flat.filter(x => x === t).length;
        if (c !== 3) badPlan.push(seed + ':' + t + '=' + c);
      }
      if (plan.length !== Dungeon.FLOORS || plan.some(f => f.length !== 4)) badPlan.push(seed + ':层数/每层票数不对');
      runCount++;
      if (plan.some(f => Dungeon.RUN_SPECIALS.some(t => f.indexOf(t) < 0))) floorsWithMissing++;
      // 同一份分配必须可重复（地图要能按（种子, 层号）单独重建）
      if (JSON.stringify(Dungeon.runPlan(seed)) !== JSON.stringify(plan)) badPlan.push(seed + ':分配不可重复');
    }
    ok(badPlan.length === 0, '每类特殊房在本局恰好 3 次（总产出与改造前相同）', badPlan.slice(0, 3).join(', '));
    const share = floorsWithMissing / Math.max(1, runCount * Dungeon.FLOORS);
    ok(share > 0.1 && share < 0.6,
      '楼层之间有区别：' + (100 * share).toFixed(0) + '% 的层缺了四类里的某一类' +
      '（0% = 每层一模一样，100% = 乱套）');
  }
  ok(bad.secretNeighbours.length === 0, '密室与 ≥2 个房间相邻，且每间都有可破的墙',
    bad.secretNeighbours.slice(0, 3).join(', '));
  ok(bad.noClue.length === 0, '每间密室都有线索种子，且初始状态是"未发现"',
    bad.noClue.slice(0, 3).join(', '));
  ok(bad.dup.length === 0 && bad.outOfGrid.length === 0, '房间坐标不重复、不越界',
    bad.dup.concat(bad.outOfGrid).slice(0, 3).join(', '));
  ok(bad.size.length === 0, '房间数落在 6~20 之间（太少没得走、太多逛不完）',
    bad.size.slice(0, 3).join(', '));
  ok(deadEndLow / Math.max(1, floors) <= 0.05,
    '每层至少 3 个死路（"可选的分支"）的楼层 ≥95%：实测平均 ' +
    (deadEndTotal / Math.max(1, floors)).toFixed(2) + ' 个 · 少于 3 个的有 ' + deadEndLow + '/' + floors +
    ' 层 —— 修掉"密室把死路吃成 3.06"之前，生成器自己写的下限 5 从来没达到过',
    (100 * deadEndLow / Math.max(1, floors)).toFixed(1) + '% 的层死路 <3');
  /* 这一条是**反记忆**断言：特殊房的落点洗过牌之后，"最深的那支是谁"不该再是常量。
     以前宝箱有 68~79% 的概率霸占最深的那一支 —— 那等于告诉玩家"往最深钻就行"。 */
  {
    const tot = treasureRank.reduce((a, b) => a + b, 0);
    const share = treasureRank.map(n => n / Math.max(1, tot));
    ok(deepestIsTreasure / Math.max(1, tot) < 0.6 && share.every(s => s > 0.1),
      '四间特殊房的深度名次是随机的（宝箱在最深那支的比例 ' +
      (100 * deepestIsTreasure / Math.max(1, tot)).toFixed(0) + '%，四个名次各 ≥10%：' +
      share.map(s => (100 * s).toFixed(0) + '%').join('/') + '）',
      '最深=' + deepestIsTreasure + '/' + tot);
  }
}

/* ---------------- 3. 确定性：同种子必得同图 ---------------- */
console.log('\n[3] 确定性（成绩码与"共享种子=共享地牢"都靠它）');
{
  const a = JSON.stringify(Dungeon.genFloor(123456, 2));
  const b = JSON.stringify(Dungeon.genFloor(123456, 2));
  ok(a === b, '同一个（种子, 层号）长出完全一样的地图（逐字节相同）');
  const c = JSON.stringify(Dungeon.genFloor(123457, 2));
  ok(a !== c, '换个种子 → 换张图');
  const other = JSON.stringify(Dungeon.genFloor(123456, 3));
  ok(a !== other, '同种子不同层 → 不同图（层号也进种子）');
  // 生成器不能污染全局随机：连生 50 张之后，同一张图仍然一样
  for (let i = 0; i < 50; i++) Dungeon.genFloor(i, 1);
  ok(JSON.stringify(Dungeon.genFloor(123456, 2)) === a, '连生 50 张地图之后再生成，结果不变（没有全局状态）');
}

/* ---------------- 4. 隐藏要素：能不能被发现 ---------------- */
console.log('\n[4] 隐藏要素：线索、破墙、以及"没发现就不该看见"');
{
  const fl = Dungeon.genFloor(20260503, 1);
  ok(fl.secrets.length >= 1, '第一层就有密室（' + fl.secrets.length + ' 间）', fl.secrets.length);
  const sec = Dungeon.roomById(fl, fl.secrets[0]);
  ok(sec && sec.type === 'secret', '密室在房型上是 secret', sec && sec.type);
  /* 迷雾：**只画见过的**。新长出来的一层谁都没见过 → 小地图是空的；
     看见一间之后只多出那一间。密室的规则不变（`seen` 为假谁也画不出来）。 */
  ok(Dungeon.visible(fl).length === 0,
    '刚长出来的一层：小地图上什么都没有（迷雾 —— 见过才画）',
    Dungeon.visible(fl).length + ' 间可见');
  const someRoom = fl.rooms.filter(r => r.id !== sec.id)[0];
  someRoom.seen = true;
  ok(Dungeon.visible(fl).length === 1 && Dungeon.visible(fl)[0].id === someRoom.id,
    '看见一间就只多出那一间', Dungeon.visible(fl).length + ' 间可见');
  someRoom.seen = false;
  ok(Dungeon.visible(fl).indexOf(sec) < 0,
    '**没发现 → 小地图上看不到它**（' + Dungeon.visible(fl).length + '/' + fl.rooms.length + ' 间可见）');
  sec.seen = true;
  ok(Dungeon.visible(fl).indexOf(sec) >= 0, '发现之后才出现在小地图上');
  sec.seen = false;

  // 相邻房间与它之间是"暗门"：门在数据上有，但不算通路
  const nb = Dungeon.neighbours(fl, sec)[0];
  const lk = Dungeon.link(fl, nb, sec);
  ok(lk && lk.door === true && lk.hidden === true,
    '相邻房间与密室之间是**暗门**（数据上有门、但要走通必须先破墙）', JSON.stringify(lk));
  const br = Dungeon.breakables(fl, sec.id);
  ok(br.length >= 2, '可以从好几面墙破进去（破哪面都行）：' + br.length + ' 面', br.length);
  ok(br.every(b => b.to === sec.id), '可破墙都指向这间密室');

  // 门的对称性：A 说通往 B，B 也必须说通往 A（不然地图会"单向门"）
  let asym = 0;
  for (const r of fl.rooms) {
    for (const n of Dungeon.neighbours(fl, r)) {
      const l1 = Dungeon.link(fl, r, n), l2 = Dungeon.link(fl, n, r);
      if (!l1 !== !l2) asym++;
      if (l1 && l2 && l1.hidden !== l2.hidden) asym++;
    }
  }
  ok(asym === 0, '门是对称的（没有单向门）', asym);

  // describe 是给人看的，但**默认不许泄露隐藏房**（界面会复用它）
  const d = Dungeon.describe(fl);
  ok(/第 1 层/.test(d) && d.indexOf('密室') < 0, 'describe 默认不泄露密室（界面复用也不会剧透）',
    d.split('\n')[0]);
  const d2 = Dungeon.describe(fl, true);
  ok(d2.indexOf('密室') >= 0, '调试模式（reveal）才给出密室数量', d2.split('\n')[0]);
}

/* ---------------- 5. 层数与环境：越往下越狠，但"长什么样"每局不同 ---------------- */
console.log('\n[5] 层数与环境（越深越狠；同一层每局长得不一样）');
{
  const f1 = Dungeon.THEME_BY_ID[Dungeon.genFloor(7, 1).theme];
  const f3 = Dungeon.THEME_BY_ID[Dungeon.genFloor(7, 3).theme];
  ok(f1 && f3 && f1.id !== f3.id, '不同层用不同环境：' + f1.id + ' → ' + f3.id);
  ok(f3.hpMul > f1.hpMul && f3.dmgMul > f1.dmgMul && f3.poolShift > f1.poolShift,
    '更深层的环境更狠（生命 ×' + f3.hpMul + '、伤害 ×' + f3.dmgMul + '、怪物池偏移 +' + f3.poolShift + '）');
  const deep = Dungeon.THEME_BY_ID.abyss;
  ok(deep && deep.hpMul >= 1.3, '最后一档环境是通关后的可选挑战（' + deep.name + ' ×' + deep.hpMul + '）');

  // 层数越多，房间越多（但不能爆炸）
  const sizes = [1, 2, 3].map(f => Dungeon.genFloor(99, f).count);
  ok(sizes[2] >= sizes[0], '越深的层房间不少于浅层：' + sizes.join(' / '));
}

/* ---------------- 5b. 环境：**每局抽签**（改造前是层号直接查表） ----------------
   改造前 `THEMES[min(len-1, f-1)]` 把环境钉死在层号上：一百局都是同一条序列，
   而"这一层是什么地方"在一局开始前就知道了。更要紧的是 `theme` 在渲染层
   **一次都没被读过**，所以两层不同的"环境"在战场上像素完全一样。
   这一节守两件事：它**真的在变**，以及它**变成什么样都不改难度**。 */
console.log('\n[5b] 环境：同一层每局长得不一样，但难度不变');
{
  const SEEDS = [];
  for (let i = 0; i < 400; i++) SEEDS.push((i + 1) * 7919 % 1000003 + 1);

  // (a) 真的在变：每层都要出现本带**全部**环境，且没有哪一条序列垄断
  const perFloor = {}, chain = {}, seqs = new Set();
  for (const seed of SEEDS) {
    const ids = [];
    for (let f = 1; f <= Dungeon.FLOORS; f++) {
      const th = Dungeon.themeFor(seed, f);
      ids.push(th.id);
      (perFloor[f] = perFloor[f] || {})[th.id] = (perFloor[f][th.id] || 0) + 1;
    }
    seqs.add(ids.join('→'));
    chain[ids.join('→')] = (chain[ids.join('→')] || 0) + 1;
  }
  let starved = [];
  for (let f = 1; f <= Dungeon.FLOORS; f++) {
    const band = Dungeon.THEME_BY_BAND[Dungeon.bandOf(f)];
    for (const th of band) if (!perFloor[f][th.id]) starved.push('第' + f + '层 ' + th.id);
  }
  ok(starved.length === 0, '每一带的每个环境在 ' + SEEDS.length + ' 个种子里都出现过（没有环境被抽签饿死）',
    starved.join(', '));
  const maxShare = Math.max(...Object.values(chain)) / SEEDS.length;
  ok(seqs.size >= 20 && maxShare <= 0.5,
    '三层的环境序列有 ' + seqs.size + ' 种，最常见的一种占 ' + (100 * maxShare).toFixed(0) +
    '%（改造前 1 种 / 100%）');

  // (b) 同一层至少 2 种 → "这层是什么地方"不是一个常量
  for (let f = 1; f <= Dungeon.FLOORS; f++) {
    const n = Object.keys(perFloor[f]).length;
    ok(n >= 2, '第 ' + f + ' 层的环境不止一种（实测 ' + n + ' 种）',
      Object.keys(perFloor[f]).join('/'));
  }

  // (c) 纯函数 + 不吃地图的随机流：同 (种子, 层号) 必得同一环境，且地图逐位不变
  ok(Dungeon.themeFor(12345, 2).id === Dungeon.themeFor(12345, 2).id, '同种子同层必得同一环境（可复算）');
  const floorSrc = fs.readFileSync(path.join(ROOT, 'src', 'dungeon.ts'), 'utf8');
  const themeFn = /function themeFor\(([\s\S]*?)\n}/.exec(floorSrc);
  ok(!!themeFn && !/\brnd\s*\(/.test(themeFn[0]),
    'themeFor 里没有出现地图那一串 rnd（换环境不会把房间布局也挪掉）');
  const srcReplay = (seed, f) => JSON.stringify(Dungeon.genFloor(seed, f));
  const s1 = srcReplay(4242, 2);
  Dungeon.themeFor(999, 1); Dungeon.themeFor(31337, 3);     // 中间乱抽几次
  ok(srcReplay(4242, 2) === s1, '抽签不会污染地图生成（中间抽别的种子/层，同参数地图逐字段不变）');

  // (d) **抽签不改难度**：带内均值 = 带心（带心就是改造前那一档的值）
  for (let b = 1; b <= Dungeon.BANDS; b++) {
    const list = Dungeon.THEME_BY_BAND[b], c = Dungeon.BAND_CENTER[b];
    const mh = list.reduce((s, t) => s + t.hpMul, 0) / list.length;
    const md = list.reduce((s, t) => s + t.dmgMul, 0) / list.length;
    ok(Math.abs(mh - c.hp) <= 0.02 && Math.abs(md - c.dmg) <= 0.02 &&
      list.every(t => t.poolShift === c.shift),
      '第 ' + b + ' 带（' + list.length + ' 种）的难度均值 = 带心：生命 ' + mh.toFixed(3) +
      ' vs ' + c.hp.toFixed(2) + ' · 伤害 ' + md.toFixed(3) + ' vs ' + c.dmg.toFixed(2) +
      ' · 怪物池 +' + c.shift);
  }
  const bands = [];
  for (let b = 1; b <= Dungeon.BANDS; b++) bands.push(Dungeon.BAND_CENTER[b].hp);
  ok(bands.every((v, i) => i === 0 || v > bands[i - 1]), '带心逐带递增（越深越狠）：' + bands.join(' → '));

  // (e) 配色与装饰物：**看得见的那一半**必须有料，而且界面/渲染层真的认得
  const palKeys = ['base', 'pebble', 'pebbleHi', 'rock', 'rockHi', 'rockDark', 'crack', 'propA', 'propB'];
  const badPal = Dungeon.THEMES.filter(t => !t.pal || !t.pal.tones || t.pal.tones.length !== 5 ||
    palKeys.some(k => !/^#[0-9a-f]{6}$/i.test(String(t.pal[k]))) ||
    t.pal.tones.some(c => !/^#[0-9a-f]{6}$/i.test(String(c))));
  ok(badPal.length === 0, '每个环境都有完整的配色（5 条纵向带 + 9 个色号）', badPal.map(t => t.id).join(','));
  const bases = new Set(Dungeon.THEMES.map(t => t.pal.base));
  ok(bases.size === Dungeon.THEMES.length,
    '每个环境的地面基色都不同（' + bases.size + '/' + Dungeon.THEMES.length + '）—— 环境不是同一个色调换个名字');

  const renderSrc = fs.readFileSync(path.join(ROOT, 'src', 'render.ts'), 'utf8');
  const propTable = /var PROP_DRAW[\s\S]*?\n};/.exec(renderSrc);
  ok(!!propTable, 'render.ts 里有装饰物画法表 PROP_DRAW');
  const declared = Dungeon.PROP_KINDS, drawn = [...propTable[0].matchAll(/^\s{2}(\w+):\s*function/gm)].map(m => m[1]);
  const missing = declared.filter(k => drawn.indexOf(k) < 0);
  const orphan = drawn.filter(k => declared.indexOf(k) < 0);
  ok(missing.length === 0, '声明的装饰物种类每一个都有人画（声明了却没人画 = 它不存在）', missing.join(','));
  ok(orphan.length === 0, 'PROP_DRAW 里没有未声明的种类（画了却没登记 = 界面/自检看不见它）', orphan.join(','));
  ok(/pal\.base/.test(renderSrc) && /pal\.tones/.test(renderSrc) && /a\.pal/.test(renderSrc),
    'render.ts 的地面**真的读了环境配色**（改造前 theme 在渲染层 0 处引用）');
  const arenaSrc = fs.readFileSync(path.join(ROOT, 'src', 'arena.ts'), 'utf8');
  ok(/Arena\.build = function \(wave, themeId\)/.test(arenaSrc) && /THEME_BY_ID\[themeId\]/.test(arenaSrc),
    'arena.ts 按环境 id 取配色（战场确实是"另一个地方"而不只是换个标题）');
  ok(/arena-wave-/.test(arenaSrc) && /U\.rng\(U\.seedFromStr\('arena-wave-' \+ wave\)\)/.test(arenaSrc),
    '战场的随机流仍然只吃波次（环境只管色号/形状，不管摆在哪）');

  // (f) 三个消费端：地图数据、界面标题、战场数据都带着环境 id
  /* ⚠ "模拟层"现在是**两份文件**：`game.ts` 与从它拆出去的 `chamber.ts`
     （房间层：地图状态 / 迷雾 / 门 / 暗门墙 / 翻层）。
     `enterFloor` 与那条 `floorEnter` 事件住在 `chamber.ts` 里，
     所以这两条判据必须读**合并后的源码** —— 只读 `game.ts` 会在拆分的那一刻
     变成"检查一个已经不存在的实现"，而它当时**确实**报红了（这正是它该做的）。 */
  const gameSrc = [path.join(ROOT, 'src', 'game.ts'), path.join(ROOT, 'src', 'chamber.ts')]
    .map(f => fs.readFileSync(f, 'utf8')).join('\n');
  ok(/S\.arena = Arena\.build\(n, S\.map \? S\.map\.theme : null\)/.test(gameSrc),
    'game.ts 把这一层的环境交给了战场生成');
  ok(/Dungeon\.THEME_BY_ID\[S\.map\.theme\]/.test(gameSrc), '进门事件带着环境名（界面能显示"这是哪儿"）');
}

/* ---------------- 6. 接线：地图 → 模拟层（G2 落地后从"待接线哨兵"改成双向依赖检查） ---------------- */
console.log('\n[6] 接线：模拟层用上了地图，地图层不反向依赖模拟层');
{
  /* 这一节的来历：G2 之前它是一个**待接线哨兵**（"没有任何模块 import 这个模块"），
     故意写成"一旦接上就变红"，逼着接完就来删它。
     改造完成后它换成了**两个方向**的依赖检查：
       · 上层（模拟层）必须真的用它 —— 否则地图只是"长出来了"
       · 它自己**不得反过来认识**模拟层/渲染层 —— 地图是纯数据，纯数据才能脱离对局单测，
         也才能让"同种子=同地图"在浏览器、Node、成绩码复算三处都成立 */
  const srcDir = path.join(ROOT, 'src');
  const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.ts') && f !== 'types.d.ts' && f !== 'dungeon.ts');
  const importers = files.filter(f => /from '\.\/dungeon\.ts'/.test(fs.readFileSync(path.join(srcDir, f), 'utf8')));
  ok(importers.indexOf('game.ts') >= 0, '模拟层真的接上了地图（game.ts import 它）', importers.join(','));

  const dungeonSrc = fs.readFileSync(path.join(srcDir, 'dungeon.ts'), 'utf8');
  const backDeps = ['game.ts', 'render.ts', 'ui.ts', 'main.ts', 'scene.ts', 'save.ts', 'profile.ts']
    .filter(f => dungeonSrc.indexOf("'./" + f + "'") >= 0);
  ok(backDeps.length === 0, '地图层不反向依赖模拟/渲染/存档（纯数据才能脱离对局单测）', backDeps.join(','));

  /* 修正键的**跨模块**对照：地牢给的那几个键必须能在 danger.ts 里找到同名同折法的，
     否则"地牢说它加了多少血"根本落不到怪身上（键名一致性是这一层的命根子）。 */
  const dangerSrc = fs.readFileSync(path.join(srcDir, 'danger.ts'), 'utf8');
  const badFold = [];
  for (const k of Object.keys(Dungeon.MOD_KEYS)) {
    if (!(k in Danger.BASE)) { badFold.push(k + ' 不在 danger 的基准里'); continue; }
    if (Danger.FOLD[k] !== Dungeon.MOD_KEYS[k].how) badFold.push(k + ' 的折法不一致（' + Danger.FOLD[k] + ' vs ' + Dungeon.MOD_KEYS[k].how + '）');
    if (!new RegExp('\\b' + k + '\\b').test(dangerSrc)) badFold.push(k + ' 在 danger.ts 里没有声明');
  }
  ok(badFold.length === 0, '地牢给的修正键与 danger 同名同折法（声明了 = 真的会生效）', badFold.join(' | '));
  ok(Object.keys(Dungeon.MOD_BASE).every(k => k in Dungeon.MOD_KEYS),
    '恒等值表里的每个键都有折法声明');
  ok(Object.keys(Dungeon.MOD_KEYS).every(k => k in Dungeon.MOD_BASE),
    '每个折法声明都有恒等值（否则"没有修正的房间"会算成 NaN）');

  // 地图层自己的"量"确实被上层读走了（不是摆设）
  /* 同上：`Dungeon.genFloor` 的调用点搬到了 `chamber.ts`（`enterFloor`），
     所以这里读的是"模拟层的两份文件"而不是只有 `game.ts`。 */
  const gameSrc = [path.join(srcDir, 'game.ts'), path.join(srcDir, 'chamber.ts')]
    .map(f => fs.readFileSync(f, 'utf8')).join('\n');
  ok(/Dungeon\.foldMods\(/.test(gameSrc), 'game.ts 把地牢修正折进了刷怪用的那一份（房型 + 层主题真的生效）');
  ok(/Dungeon\.genFloor\(/.test(gameSrc), '模拟层用种子长地图（同种子 = 同地牢）');
  ok(/Dungeon\.path\(/.test(gameSrc), '自动探索用 path() 找路（暗门默认不算通路）');
}

/* ---------------- 7. 随机 Boss 池（G3 的落点） ---------------- */
console.log('\n[7] Boss：每一层都有，而且是"关底房"里的那只');
{
  // G3 之后 Boss 是一池四只、由层决定出哪一只；这里只钉结构（哪一间是关底房），
  // 但"Boss 一定出现在 Boss 房"这条结构已经被 [2] 守着，这里再钉一次"数据上可查"
  const fl = Dungeon.genFloor(1234, 1);
  const boss = Dungeon.roomById(fl, fl.boss);
  ok(!!boss && boss.type === 'boss', 'Boss 房在数据里查得到', fl.boss);
  ok(Dungeon.modsFor(fl, fl.boss).bossEvery === 1, 'Boss 房保证出 Boss（bossEvery=1）');
  ok(Dungeon.modsFor(fl, fl.start).waveBudget === 0, '入口间不刷怪（waveBudget=0）');
}

console.log('\n=== 结果 ===');
if (failures === 0) { console.log('\x1b[32m全部通过 ✔\x1b[0m\n'); process.exit(0); }
console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m\n');
process.exit(1);
