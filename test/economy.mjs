/* =========================================================
   economy.mjs — 货币与三模块循环（战斗 / 经营 / 养成）

   这一套守的是**循环的形状**，不是某笔钱的数值：

     [1] 表与自检：四笔钱各有层级、来源、去向、why；三档层级都有人在用
     [2] **只有战斗能产出**：局外系统不许自己印钱（那是"模块嵌合"的入口）
     [3] 局内 / 跨局的分界：局内货币必须有局内去向，跨局货币不许有
     [4] 循环连通：战斗 → 经营、战斗 → 养成两条边都有货币；
         三个系统每一个都既在产出、也在被投入（没有"不参与循环"的模块）
     [5] 核心材料（meta-rare）：**只有 Boss 掉**，而且经营与养成都要花它
         —— 一条只能在战斗里拿到、必须在两个局外模块里花的钱
     [6] 真的接上了：会话字段 / 存档往返 / 结算入档 / 不吃倍率

   用法： node test/economy.mjs
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { installDom } from './_ctx.mjs';
import { loadAll, SIM_MODULES, enterFightRoom } from './_load.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
installDom();
const g = globalThis;
await loadAll(SIM_MODULES);

let failures = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  \x1b[32mPASS\x1b[0m ' + label);
  else { failures++; console.log('  \x1b[31mFAIL\x1b[0m ' + label + (extra !== undefined ? '  → ' + extra : '')); }
}

const { Economy, Game, Profile, Enemies, Registry, Storage } = g;

console.log('\n=== Bronana · 货币与三模块循环 ===\n');

/* =========================================================
   [1] 表与自检
   ========================================================= */
console.log('[1] 货币表与三档层级');
{
  const v = Economy.audit();
  ok(v.ok, '货币表自检通过（' + v.counts.currencies + ' 笔 / ' + v.counts.tiers +
    ' 档层级 / ' + v.counts.systems + ' 个系统）', v.problems.join(' | '));
  ok(Economy.LIST.length >= 4, '至少四笔钱（材料 / 核心材料 / 孢子 / 合金）', Economy.LIST.length);
  ok(Economy.LIST.every(d => d.name && d.note && d.why), '每笔钱都写了名字、说明与 why');
  ok(Object.keys(Economy.SYSTEMS).length === 3, '循环正好三个模块（战斗 / 经营 / 养成）',
    Object.keys(Economy.SYSTEMS).join(','));

  // 审计真的能抓错
  const probe = Economy.BY_ID['spore'];
  const keepTier = probe.tier;
  probe.tier = 'noSuchTier';
  const a1 = Economy.audit();
  ok(!a1.ok && a1.problems.some(p => /层级没登记/.test(p)), '把层级写错 → 审计报出来（否则那笔钱被静默带出局）', a1.problems[0]);
  probe.tier = keepTier;

  const keepFrom = probe.from.slice();
  probe.from = ['manage'];
  const a2 = Economy.audit();
  ok(!a2.ok && a2.problems.some(p => /只有战斗能产出/.test(p)), '让经营"印钱" → 审计报出来', a2.problems[0]);
  probe.from = keepFrom;

  const keepTo = probe.to.slice();
  probe.to = [];
  const a3 = Economy.audit();
  ok(!a3.ok && a3.problems.some(p => /没有去向/.test(p)), '把去向删空 → 审计报出来（只能攒不能花）', a3.problems[0]);
  probe.to = keepTo;
  ok(Economy.audit().ok, '改回来之后审计重新通过');
}

/* =========================================================
   [2][3] 只有战斗能产出 / 局内外分界
   ========================================================= */
console.log('\n[2] 只有战斗能产出，且局内外不串');
{
  const bad = Economy.LIST.filter(d => d.from.some(f => f !== 'combat'));
  ok(bad.length === 0, '每笔钱的来源都只有战斗（局外不许自己印钱）',
    bad.map(d => d.id + '<-' + d.from.join('/')).join(','));

  for (const d of Economy.LIST) {
    const isSession = Economy.isSession(d.id);
    if (isSession) {
      ok(d.to.indexOf('combat') >= 0 && d.from.indexOf('combat') >= 0,
        '局内货币「' + d.name + '」只在战斗内部流转（进战斗、花在战斗）');
    } else {
      ok(d.to.indexOf('combat') < 0 && Economy.isAccount(d.id),
        '跨局货币「' + d.name + '」带得出去、且不在局内花');
      ok(d.to.some(t => t === 'manage' || t === 'grow'),
        '跨局货币「' + d.name + '」流向局外模块（' + d.to.join('/') + '）');
    }
  }
}

/* =========================================================
   [4] 循环连通
   ========================================================= */
console.log('\n[4] 循环连通：三个模块互相喂');
{
  const loop = Economy.loop();
  ok(loop.edges.length >= 2, '循环图有 ≥2 条边（' + loop.edges.length + ' 条）',
    loop.edges.map(e => e.from + '→' + e.to).join(' '));
  ok(Economy.edge('combat', 'manage').length > 0,
    '战斗 → 经营 这条边有货币：' + Economy.edge('combat', 'manage').join('/'));
  ok(Economy.edge('combat', 'grow').length > 0,
    '战斗 → 养成 这条边有货币：' + Economy.edge('combat', 'grow').join('/'));
  for (const s of Object.keys(Economy.SYSTEMS)) {
    const produce = Economy.LIST.some(d => d.from.indexOf(s) >= 0);
    const consume = Economy.LIST.some(d => d.to.indexOf(s) >= 0);
    ok(produce || consume, '系统「' + Economy.SYSTEMS[s].name + '」参与了货币流动');
    if (s !== 'combat') ok(consume, '局外模块「' + Economy.SYSTEMS[s].name + '」有投入（否则它没有存在理由）');
  }

  /* ---- 反哺边：局外 → 战斗（不是货币，是"下一局的开局条件"）----
     这两条边曾经登记在 `Eco.GAPS` 里当**缺口**，而它们其实一直在工作 ——
     那张缺口表因此会永远报"缺 2 条"，是一把会撒谎的尺子。
     现在它们是正面声明：每条都写清"谁提供 / 什么在限制它"。 */
  ok(Economy.BACKFLOW.length >= 2, '登记了 ≥2 条反哺边（' +
    Economy.BACKFLOW.map(b => b.from + '→' + b.to).join(' ') + '）');
  for (const s of Object.keys(Economy.SYSTEMS)) {
    if (s === 'combat') continue;
    ok(Economy.backflowFrom(s).length >= 1,
      '局外模块「' + Economy.SYSTEMS[s].name + '」有一条反哺边回到战斗（不是死胡同）');
  }
  ok(Economy.BACKFLOW.every(b => b.to === 'combat'), '每条反哺边的终点都是战斗');
  ok(Economy.BACKFLOW.every(b => /核心材料|孢子|合金|通关|波次/.test(b.limit)),
    '每条反哺边都写清了"什么在限制它"——**白给的反哺不是循环的一环**',
    Economy.BACKFLOW.map(b => b.limit).join(' | '));

  /* ---- 缺口清单：机制留在、数据为空 ----
     空不是"没做"，是"补完了"。反过来，一旦有东西登记进来，
     `audit` 会要求它带 todo（补它要做什么）。 */
  ok(Economy.GAPS.length === 0, '缺口清单是空的（两条反哺边已改成正面声明）',
    Economy.GAPS.map(g => g.from + '→' + g.to).join(','));
  ok(Economy.missingEdges().length === 0, '没有"还缺的边"');
  /* 反证：把一条反哺边摘掉，自检必须报出来（尺子不是装饰） */
  const savedBf = Economy.BACKFLOW.slice();
  Economy.BACKFLOW.length = 0;
  const broke = Economy.audit();
  Economy.BACKFLOW.push(...savedBf);
  ok(!broke.ok && broke.problems.some(p => /反哺边|死胡同/.test(p)),
    '摘掉全部反哺边 → 自检报"只进不出的死胡同"', broke.problems[0]);
  ok(Economy.audit().ok, '装回去之后重新通过');
}

/* =========================================================
   [5] 核心材料：meta-rare 那一档
   ========================================================= */
console.log('\n[5] 核心材料：只有 Boss 掉，两个局外模块都要花');
{
  const core = Economy.BY_ID['core'];
  ok(!!core && core.tier === 'meta-rare', '核心材料是 meta-rare 那一档（每局只有几笔）');
  ok(Economy.byTier('meta-rare').length >= 1, 'meta-rare 这一档不是空的');
  ok(core.to.indexOf('manage') >= 0 && core.to.indexOf('grow') >= 0,
    '经营与养成**都**要花核心材料（于是它们争的是同一笔稀有资源）',
    core.to.join('/'));
  ok(!Economy.isSession('core'), '核心材料不进局内经济（它是局外的钱）');

  const src = fs.readFileSync(path.join(ROOT, 'src', 'game.ts'), 'utf8');
  ok(/CORE_PER_BOSS/.test(src), 'game.ts 里有 CORE_PER_BOSS 这个常量');
  const inBoss = /if \(e\.def\.boss\) \{[\s\S]{0,700}?coreEarned/.test(src);
  ok(inBoss, '核心材料**只在 Boss 死亡那一支**里加（普通怪不掉）');
  const normal = /e\.elite \? 2 : 0[\s\S]{0,200}?coreEarned/.test(src);
  ok(!normal, '普通掉落那一段里没有核心材料（否则它就退化成"多打几把"）');
}

/* =========================================================
   [6] 接线：字段 / 存档 / 结算
   ========================================================= */
console.log('\n[6] 接线：会话字段 · 存档往返 · 结算入档');
{
  Storage.use(Storage.memory(Object.create(null)));
  Storage.wipe();

  Game.newRun('ranger', 4242);
  const sess = Game.getSession();
  ok(sess.coreEarned === 0, '开局这一局的核心材料是 0');
  sess.coreEarned = 2;
  const data = Game.exportRun();
  ok(data.coreEarned === 2, '核心材料进了存档（不存就能靠读档刷 Boss）', String(data.coreEarned));
  const s2 = Game.importRun(JSON.parse(JSON.stringify(data)));
  ok(s2 && s2.coreEarned === 2, '读档还原核心材料', s2 ? String(s2.coreEarned) : 'null');

  // 结算入档
  const before = Profile.core();
  const rep = Profile.applyRun({
    char: 'ranger', wave: 5, level: 6, kills: 40, scrap: 120, damage: 900,
    taken: 30, healed: 0, packs: 0, coreEarned: 3
  }, null);
  ok(rep.core === 3, '结算报告里带出这一局拿到的核心材料', String(rep.core));
  ok(Profile.core() === before + 3, '核心材料入档了（' + before + ' → ' + Profile.core() + '）');

  /* **不吃倍率**：孢子有倍率（打得深更多），核心材料没有（固定几笔）。
     这一条守着"meta-rare 那一档不被 bridge 那一档的复利吃掉"。 */
  const p2 = Profile.core();
  Profile.applyRun({
    char: 'ranger', wave: 40, level: 20, kills: 900, scrap: 9000, damage: 99999,
    taken: 0, healed: 0, packs: 9, coreEarned: 2
  }, null);
  ok(Profile.core() === p2 + 2, '深局的核心材料也是"打几个 Boss 给几笔"（不吃深度倍率）');

  // 存档卫生：坏值不许进档
  const evil = JSON.parse(JSON.stringify(data));
  evil.coreEarned = 1e9;
  const s3 = Game.importRun(evil);
  ok(s3 && s3.coreEarned >= 0 && isFinite(s3.coreEarned), '坏档里的巨额核心材料被夹回', s3 ? String(s3.coreEarned) : 'null');

  // 总账登记
  ok(Registry.has('currency') && Registry.has('currencyTier') && Registry.has('loopSystem'),
    '三个货币家族都登记进了扩展点总账');
  ok(Registry.ids('currency').length === Economy.LIST.length, '总账里的货币数与表一致');
  ok(Registry.ids('currencyTier').join(',') === Object.keys(Economy.TIERS).join(','),
    '层级家族就是层级表本身');
}

console.log('\n=== 结果 ===');
if (failures === 0) console.log('\x1b[32m全部通过 ✔\x1b[0m');
else console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m');
process.exit(failures ? 1 : 0);
