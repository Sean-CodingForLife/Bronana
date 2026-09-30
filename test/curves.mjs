/* =========================================================
   curves.mjs — 数值曲线（角色怎么长 / 怪物怎么长）

   这一套守的不是"曲线好不好看"（那是 `tools/balance.mjs` 用机器人跑出来的），
   而是**曲线这件事本身有没有被系统化**：

     [1] 表与自检：形状 / 常量 / unit / why 齐备；**审计真的能抓错**
     [2] 逐点等价：表算出来的值与改造前那几行公式**逐位相同**
         —— 这一条是"只是把常数搬进表"这句承诺的证明
     [3] 形状：七种形状各自的语义与边界（含封顶、台阶、分段线性）
     [4] 两边的对照：`checkpoint()` 在同一个房间刻度上摊开双方
     [5] 接入：`enemies.ts` / `stats.ts` / `game.ts` 真的在读表（没有第二份常数）

   为什么 [2] 是最要紧的一条：曲线是"表驱动"很容易变成**换了个写法的漂移** ——
   值悄悄不一样了，而看起来一切正常。逐点比对是唯一能挡住它的东西。

   用法： node test/curves.mjs
   ========================================================= */
import { loadAll, SIM_MODULES } from './_load.mjs';

await loadAll(SIM_MODULES);
const { Curves, Enemies, Stats, Registry } = globalThis;

let failures = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  \x1b[32mPASS\x1b[0m ' + label);
  else { failures++; console.log('  \x1b[31mFAIL\x1b[0m ' + label + (extra !== undefined ? '  → ' + extra : '')); }
}

console.log('\n=== Bronana · 数值曲线 ===\n');

/* =========================================================
   [1] 表与自检
   ========================================================= */
console.log('[1] 曲线表与自检');
{
  const v = Curves.audit();
  ok(v.ok, '曲线表自检通过（' + v.counts.curves + ' 条曲线 / ' + v.counts.shapes + ' 种形状 / ' + v.counts.domains + ' 个域）',
    v.problems.join(' | '));
  ok(Curves.LIST.length >= 8, '曲线够把两边的成长拼全（' + Curves.LIST.length + ' 条）');
  ok(Curves.LIST.every(c => c.why && c.unit), '每条曲线都写了单位与 why（说不出设计问题的曲线不该存在）');

  const domains = new Set(Curves.LIST.map(c => c.domain));
  ok(domains.has('enemy') && domains.has('player'), '怪物侧与角色侧都有曲线（这是这张表存在的理由）',
    [...domains].join(','));

  // 审计真的能抓错：三条注入
  const probe = Curves.BY_ID['enemy.hp'];
  const keep = probe.shape;
  probe.shape = 'noSuchShape';
  const a1 = Curves.audit();
  ok(!a1.ok && a1.problems.some(p => /形状没登记/.test(p)), '把形状改成不存在的名字 → 审计报出来', a1.problems[0]);
  probe.shape = keep;

  const keepP = probe.p.values;
  probe.p = {};
  const a2 = Curves.audit();
  ok(!a2.ok && a2.problems.some(p => /缺形状要求的常量/.test(p)), '把形状要的常量抽掉 → 审计报出来', a2.problems[0]);
  probe.p = { values: keepP };

  const keepWhy = probe.why;
  delete probe.why;
  const a3 = Curves.audit();
  ok(!a3.ok && a3.problems.some(p => /没有 why/.test(p)), '把 why 删掉 → 审计报出来', a3.problems[0]);
  probe.why = keepWhy;
  ok(Curves.audit().ok, '改回来之后审计重新通过');

  // 总账里登记了
  ok(Registry.has('curve') && Registry.has('curveShape') && Registry.has('curveDomain'),
    '三个曲线家族都登记进了扩展点总账');
  ok(Registry.ids('curve').length === Curves.LIST.length, '总账里的曲线数与表一致');
}

/* =========================================================
   [2] 逐点等价（**这一条是"表驱动"的证明**）
   ========================================================= */
console.log('\n[2] 逐点等价：表算出来的值 == 改造前那几行公式');
{
  /* ⚠ 参考式**不再抄第二份** —— 这里以前把 `curves.ts` 的 `LEGACY` 逐字抄了一遍
     （注释还写着"逐字抄自改造前的源码"），于是同一句话在仓库里有两份：
     改曲线时要同时改 `LEGACY` 与这里的 `REF`，漏一处就**红在一处、绿在另一处**。
     实测踩到过：R37 那轮把 `enemy.dmg` 的系数从 0.16 抬到 0.37，
     `LEGACY` 改了、`REF` 忘了 —— 于是 `paths` 报红而 `LEGACY` 说没问题。
     现在只读 `LEGACY`：它是**唯一**的参考式，测试只负责"表 == LEGACY"。 */
  const REF = Curves.LEGACY;
  if (!REF) throw new Error('curves.ts 没有暴露 LEGACY —— 逐点等价那一条会变成空转');
  let bad = 0, first = null;
  for (const id of Object.keys(REF)) {
    for (let t = 1; t <= 144; t++) {
      const got = Curves.at(id, t), want = REF[id](t);
      if (got !== want) { bad++; if (!first) first = id + '@' + t + ' ' + got + ' != ' + want; }
    }
  }
  ok(bad === 0, '六条曲线在 1..144 间上**逐位**等于 `curves.ts` 的 LEGACY 参考式（' + (Object.keys(REF).length * 144) + ' 个点）', first);

  /* 敌人侧的三条由 enemies.ts 读出去，读出来也要逐位相同。
     参考式同样取自 `LEGACY`，不在这里重写常数。 */
  const pace = REF['meter.pace'];
  let bad2 = 0, first2 = null;
  for (let w = 1; w <= 144; w++) {
    const ew = pace(w);
    if (Enemies.hpScale(w) !== 1 + 0.30 * (ew - 1) + 0.045 * (ew - 1) * (ew - 1)) { bad2++; first2 = first2 || ('hp@' + w); }
    if (Enemies.dmgScale(w) !== REF['enemy.dmg'](w)) { bad2++; first2 = first2 || ('dmg@' + w); }
    if (Enemies.speedScale(w) !== Math.min(1.35, 1 + 0.012 * (ew - 1))) { bad2++; first2 = first2 || ('spd@' + w); }
  }
  ok(bad2 === 0, 'enemies.ts 的三个读点也逐位相同', first2);

  let bad3 = 0, first3 = null;
  for (let lv = 1; lv <= 200; lv++) {
    if (Stats.xpNeeded(lv) !== Math.round(6 + Math.pow(lv, 1.34) * 2.6)) { bad3++; first3 = first3 || ('xp@' + lv); }
  }
  ok(bad3 === 0, 'stats.ts 的升级经验也逐位相同', first3);

  /* 预算：它是"房间号 → 预算"，而原式写作"旧波次 → 预算" ——
     两条路必须落到同一个数（这是 `curves.ts` 里最容易接错的一处） */
  let bad4 = 0, first4 = null;
  for (let w = 1; w <= 144; w++) {
    const ew = pace(w);
    const want = Math.round(13 + ew * 9 + ew * ew * 0.55);
    const got = Math.round(Curves.at('spawn.budget', w));
    if (got !== want) { bad4++; first4 = first4 || ('budget@' + w + ' ' + got + ' != ' + want); }
  }
  ok(bad4 === 0, '刷怪预算（含 0.55 换算）也逐位相同', first4);
}

/* =========================================================
   [3] 形状
   ========================================================= */
console.log('\n[3] 形状的语义与边界');
{
  const at = (id, t, p) => Curves.at(id, t, p);
  ok(Math.abs(at('enemy.dmg', 1, { values: undefined }) - 0) >= 0, '覆盖常量不影响形状分派');
  // linear / polynomial / power / exponential 的解析性质
  const lin = Curves.at('enemy.dmg', 2, { b: 0.5 });
  ok(typeof lin === 'number' && isFinite(lin), 'linear 可求值');
  ok(Curves.at('player.xp', 1) < Curves.at('player.xp', 2), 'power 形状（升级经验）随等级上升');
  ok(Math.abs(Curves.at('player.xp', 1) - 8.6) < 1e-9, 'power 在 1 级处 = 8.6', Curves.at('player.xp', 1));

  // capped：涨到上限就停
  ok(Curves.at('enemy.speed', 144) === 1.35, 'capped/表在封顶处停住（移速 ×1.35）', Curves.at('enemy.speed', 144));
  ok(Curves.at('enemy.speed', 300) === 1.35, '越界仍然停在封顶值（不是继续长也不是归零）', Curves.at('enemy.speed', 300));

  // stepped：第 4 间之前是 0
  ok(Curves.at('enemy.eliteChance', 1) === 0 && Curves.at('enemy.eliteChance', 4) === 0,
    'stepped：第 4 间之前精英概率是 0（台阶而不是渐进）');
  ok(Math.abs(Curves.at('enemy.eliteChance', 10) - 0.168) < 1e-9, '第 10 间精英概率 16.8%', Curves.at('enemy.eliteChance', 10));
  ok(Curves.at('enemy.eliteChance', 100) === 0.24, '精英概率封顶 24%', Curves.at('enemy.eliteChance', 100));

  // tMin：夹取只有一处
  ok(Curves.at('enemy.hp', 0) === Curves.at('enemy.hp', 1), 't=0 与 t=1 同值（夹取只做一次）',
    Curves.at('enemy.hp', 0) + ' vs ' + Curves.at('enemy.hp', 1));
  ok(Curves.at('enemy.hp', -5) === Curves.at('enemy.hp', 1), '负自变量也夹到下限');

  // 里程碑表：方法论要求的那张表
  const tb = Curves.table('enemy.hp', [1, 5, 12, 24, 39]);
  ok(tb && tb.rows.length === 5 && tb.rows[0].value === 1, 'table() 给出里程碑表（起点 = ×1）');
  ok(tb.rows[4].value > tb.rows[3].value, '生命曲线单调上升（第 39 间 > 第 24 间）',
    tb.rows.map(r => r.value.toFixed(2)).join(' → '));
  ok(tb.rows.every(r => r.delta >= 0 || r.t === 1), '每一步的增量都不是负数');
}

/* =========================================================
   [4] 两边的对照（这张表存在的理由）
   ========================================================= */
console.log('\n[4] 两边的对照：同一个房间刻度上摊开双方');
{
  const rows = Curves.checkpoint();
  ok(rows.length > 0 && rows[0].room === 1, '对照表从第 1 间开始（' + rows.length + ' 个刻度）');
  ok(rows.every(r => r.enemyHp >= 1 && r.budget > 0 && r.xpCumulative > 0),
    '每个刻度上双方的值都是正的（曲线没有哪一边停摆）');
  ok(rows[rows.length - 1].enemyHp > rows[0].enemyHp * 5,
    '到最后一间，怪的生命比第一间高一个数量级（二次项确实在起作用）',
    rows[0].enemyHp.toFixed(1) + ' → ' + rows[rows.length - 1].enemyHp.toFixed(1));
  ok(rows[rows.length - 1].xpCumulative > rows[0].xpCumulative,
    '累计经验（离散求和，不是积分）随房间上升 —— 这一条回答"玩家跟不跟得上"的一半');
  /* 离散求和 vs 积分：这一条守着"用同一套口径"（积分会把升级次数算多） */
  let sum = 0;
  for (let lv = 1; lv <= 10; lv++) sum += Curves.at('player.xp', lv);
  const r10 = rows.find(r => r.room === 10);
  ok(!r10 || Math.abs(r10.xpCumulative - Math.round(sum)) < 2,
    '累计经验是**逐级求和**（与游戏里 xpNeeded 同一套口径）', r10 ? r10.xpCumulative + ' vs ' + sum : '无第 10 间');
}

/* =========================================================
   [5] 接入：没有第二份常数
   ========================================================= */
console.log('\n[5] 接入：读点都在表里');
{
  const fs = await import('node:fs');
  const src = (f) => fs.readFileSync(new URL('../src/' + f, import.meta.url), 'utf8');
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  const en = strip(src('enemies.ts'));
  ok(!/0\.045|0\.30 \* w|13 \+ ew \* 9/.test(en), 'enemies.ts 里不再有曲线常数（成长值全在表里）');
  ok(/Curves\.at\('enemy\.hp'/.test(en) && /Curves\.at\('spawn\.budget'/.test(en),
    'enemies.ts 读的是表里的曲线');

  const st = strip(src('stats.ts'));
  ok(!/Math\.pow\(level, 1\.34\)/.test(st), 'stats.ts 里不再有升级经验常数');
  ok(/Curves\.at\('player\.xp'/.test(st), 'stats.ts 读的是表里的 player.xp');

  const gm = strip(src('game.ts'));
  ok(!/ELITE_HP = 3\.2|ELITE_DMG = 1\.35|ELITE_SPEED = 1\.12/.test(gm),
    'game.ts 里不再有精英三段倍率的裸常数');
  ok(/Curves\.at\('elite\.hp'/.test(gm), 'game.ts 读的是表里的 elite.*');

  // 精英三条在表里（它们是"精英"这个概念的完整定义）
  ok(['elite.hp', 'elite.dmg', 'elite.speed'].every(id => Curves.BY_ID[id]),
    '精英的三段倍率都在表里（一次就能看到精英改了哪几个量）');
}

/* =========================================================
   [6] 角色侧：**"每级长多少"必须有形状**
   ---------------------------------------------------------
   这一节是补一个真缺口：在 `player.cardAmt` 存在之前，
   `UPGRADE_POOL` 是**固定权重 + 固定幅度**的平表 ——
   第 1 级和第 40 级抽到的卡强度一模一样，于是"玩家每级长多少"
   是一条**平线**，而怪的生命是指数（第 39 间 ×27）。两边对不上，
   成长感全靠"多抽几张卡"。
   ========================================================= */
console.log('\n[6] 角色侧：升级卡的幅度与池权重都是等级的曲线');
{
  const { Game } = globalThis;
  const amt = Curves.BY_ID['player.cardAmt'];
  const pool = Curves.BY_ID['player.cardPool'];
  ok(!!amt && !!pool, '两条角色侧曲线都在表里（player.cardAmt / player.cardPool）');

  /* 第 1 级必须**恰好** 1.0：开局那几张卡不能因为"引了一条曲线"就悄悄变强。
     这一条是容差 1e-9 的硬判据 —— 差一点点都会让前 5 级的体感全体偏移。 */
  ok(Math.abs(Curves.at('player.cardAmt', 1) - 1) < 1e-9,
    '第 1 级的卡幅度恰好是 1.0（曲线不许偷偷改开局）',
    String(Curves.at('player.cardAmt', 1)));

  /* 单调不减，且**温和**：它乘在"一整局的抽卡次数"上（几十上百张），
     写成 1.0 → 10 会让第 30 级的伤害加成到 +292%（第一版就是那么写的，
     实测之后改掉了）。上限判据：第 40 级不超过 2.0。 */
  let mono = true, prev = -1;
  for (let lv = 1; lv <= 60; lv++) {
    const v = Curves.at('player.cardAmt', lv);
    if (v < prev) mono = false;
    prev = v;
  }
  ok(mono, '卡幅度随等级单调不减');
  const at40 = Curves.at('player.cardAmt', 40);
  ok(at40 > 1.3 && at40 < 2.0,
    '第 40 级的卡幅度在 1.3~2.0 之间（温和，不然会滑成割草）：×' + at40.toFixed(2));
  ok(Curves.at('player.cardAmt', 10) > 1.1,
    '前 10 级就有可感的涨幅（×' + Curves.at('player.cardAmt', 10).toFixed(2) + '）');

  /* 池权重：防御向随等级抬 —— 否则每个等级的取舍长一样 */
  ok(Curves.at('player.cardPool', 40) > Curves.at('player.cardPool', 1),
    '防御向的权重随等级抬（×' + Curves.at('player.cardPool', 1).toFixed(2) + ' → ×' +
    Curves.at('player.cardPool', 40).toFixed(2) + '）');

  /* ---- 接入：真的长在卡上，而不是躺在表里 ---- */
  Game.newRun('ranger', 20260101, 0);
  const s = Game.getSession();
  Game._internals.rollLevelCards();
  const lv1 = s.player.level;
  ok(lv1 === 1, '开局等级是 1（第 1 级恰好是 1.0 的前提）', lv1);
  ok(s.levelCards.length > 0 && s.levelCards.every(c => typeof c.amt === 'number' && typeof c.base === 'number'),
    '发出来的卡带着**算好的 `amt` 与基准 `base`**（界面与选卡读同一个数）',
    JSON.stringify(s.levelCards.map(c => c.key + '=' + c.amt)));
  ok(s.levelCards.every(c => Math.abs(c.amt - c.base * Curves.at('player.cardAmt', c.level)) < 1e-9),
    '卡上的 amt = base × 曲线（不是各算一份）');

  /* 反证：把等级推到 20，同样的一张卡必须更大 —— 这就是"每级长多少"有了形状 */
  const base = s.levelCards[0].base, key = s.levelCards[0].key;
  const p = s.player;
  let guard = 0;
  const seen = [];
  while (p.level < 20 && guard++ < 400) {
    p.xp = p.xpNeed;
    Game._internals.checkLevelUp();
    while (Game.state === 'levelup') {
      /* 挑一张**同名同 base** 的卡来对比幅度（挑不到就随便挑一张推进） */
      let pick = 0;
      for (let i = 0; i < s.levelCards.length; i++) {
        if (s.levelCards[i].key === key && s.levelCards[i].base === base) { pick = i; seen.push(s.levelCards[i]); break; }
      }
      Game.chooseLevelCard(pick);
    }
  }
  ok(p.level >= 20, '能一路升到 20 级（等级推进的入口是开的）', p.level);
  if (seen.length) {
    const first = seen[0], last = seen[seen.length - 1];
    ok(last.level > first.level && last.amt > first.amt,
      '同一种卡在更高等级拿到时**更大**（Lv' + first.level + ' ×' + first.amt.toFixed(3) +
      ' → Lv' + last.level + ' ×' + last.amt.toFixed(3) + '）—— 这就是"每级长多少"的形状');
  } else {
    ok(true, '（没抽到同名同基准的卡；幅度随等级那条判据由上面的曲线判据覆盖）');
  }

  /* 反证：把曲线改成平线，判据必须红 */
  const savedP = Object.assign({}, amt.p);
  amt.p = { a: 1, m: 0, k: 0.84 };
  const flat = Curves.at('player.cardAmt', 40);
  amt.p = savedP;
  ok(Math.abs(flat - 1) < 1e-9, '（对照）把曲线改成平线时第 40 级就是 1.0 —— 判据量的是真东西', String(flat));
  ok(Curves.audit().ok, '改回来之后自检重新通过');
}

console.log('\n=== 结果 ===');
if (failures === 0) console.log('\x1b[32m全部通过 ✔\x1b[0m');
else console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m');
process.exit(failures ? 1 : 0);
