/* =========================================================
   forge.mjs — 图纸工坊（合金 → **能造什么**）

   这一步重排之后，图纸的职责只有一条：**解锁新装备与道具的制造**（+ 产能与回收）。
   所以这一套盯五件事：
     1) **只解锁能力，不给属性** —— 节点表里出现属性键就是破纪律（静态检查）
     2) 树本身合法：前置存在、不倒挂、不成环、每张图纸真的给出一条效果
     3) **每个修正键都有人读**（读点是制造那一侧：craft.ts / camp.ts / market.ts / game.ts）
     4) 合金的来源只有"回收 + 结算"：**合成不再产合金**
     5) 每条修正在**真的对局里**生效：档位门槛 / 回收加成 / 合金 / 产线 / 质量 / 异档熔接
     6) 存档往返：合金与图纸跟着档案走，一局的存档带的是**开局时**那一份

   用法： node test/forge.mjs
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
const { Game, Forge, Profile, Weapons, Craft, Camp, Registry, Save, Stats, Tiers } = globalThis;
console.error = function () { };

console.log('\n=== Bronana · 图纸工坊（合金 → 能造什么） ===\n');

/** 用指定的图纸集合开一局（不碰武器） */
function runWith(forgeIds, weapons, seed) {
  Game.setState('title', true);
  Game.newRun('ranger', seed === undefined ? 20260901 : seed, 0,
    { stats: {}, weapons: [], items: [], scrap: 1000 },
    { owned: {}, forge: forgeIds || [] });
  const s = Game.getSession();
  if (weapons) { s.player.weapons.length = 0; weapons.forEach(id => Game.addWeapon(id)); }
  toShop(s);
  return s;
}

/* ---------------- 1. 纪律：只解锁能力 ---------------- */
console.log('[1] 纪律：这张表里不许出现属性键');
{
  const STAT_KEYS = Object.keys(Stats.KEYS);
  const bad = Forge.LIST.filter(d => STAT_KEYS.indexOf(d.mod) >= 0);
  ok(bad.length === 0, '没有任何一张图纸直接加属性（' + STAT_KEYS.length + ' 个属性键都排除在外）',
    bad.map(d => d.id + '→' + d.mod).join(','));

  const src = fs.readFileSync(path.join(ROOT, 'src', 'forge.ts'), 'utf8');
  ok(!/damage|maxHp|attackSpeed|critChance/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')),
    'forge.ts 里连一个属性名都没出现（注释外的字面量也没有）');
  const cheats = Forge.LIST.filter(d => /伤害 \+|生命 \+|攻速 \+/.test(Forge.nodeText(d)));
  ok(cheats.length === 0, '没有一条图纸的文案在承诺属性', cheats.map(d => d.id).join(','));

  /* 图纸的职责是"解锁能造什么"：必须有**档位**那一条，否则工坊造不出新东西 */
  ok(Forge.LIST.some(d => d.mod === 'craftTier'),
    '图纸树里有"解锁档位"的节点（这就是"解锁新装备和道具"）');
  const tiers = Forge.LIST.filter(d => d.mod === 'craftTier').map(d => d.value);
  ok(tiers.indexOf(Tiers.MAX) >= 0,
    '最高能开到 T' + Tiers.MAX + '（全套图纸打通）', tiers.join(','));
  /* 跨表不变式：图纸能开到的最高档 = 品级表的顶档。
     加一档品级却忘了加图纸时，"顶档"在制造这一侧就不可达（只能靠合成）。 */
  ok(Math.max.apply(null, tiers) === Tiers.MAX,
    '图纸的最高档正好等于品级表的顶档（T' + Tiers.MAX + '）');
}

/* ---------------- 2. 树本身 ---------------- */
console.log('\n[2] 图纸树：前置、成本、自检');
{
  const a = Forge.audit();
  ok(a.ok === true, '定义期自检通过（' + a.counts.nodes + ' 张图纸 / ' + a.counts.keys + ' 个修正键）',
    a.problems.join(' | '));
  ok(Forge.LIST.length >= 9, '图纸够撑起"先点哪条"（' + Forge.LIST.length + ' 张）');
  const costs = Forge.LIST.map(d => d.cost);
  ok(Math.min(...costs) >= 2 && Math.max(...costs) <= 40,
    '成本落在"几局能点出来"的量级（' + Math.min(...costs) + ' ~ ' + Math.max(...costs) + ' 合金）');
  const byTier = Forge.TIERS.map(t => Math.min(...Forge.LIST.filter(d => d.tier === t.tier).map(d => d.cost)));
  ok(byTier.every((c, i) => i === 0 || byTier[i - 1] < c),
    '每一阶的最低成本严格递增（' + byTier.join(' < ') + '）');

  const saved = Forge.LIST.slice();
  Forge.LIST.push({ id: 'bad', tier: 1, cost: 0, req: ['不存在'], mod: '没这个键', value: 0, name: '坏', note: '' });
  ok(Forge.audit().ok === false, '塞一张坏图纸（成本 0 / 前置不存在 / 键没声明）→ 自检报错');
  Forge.LIST.length = 0; Forge.LIST.push.apply(Forge.LIST, saved);
  ok(Forge.audit().ok === true, '恢复之后自检重新通过');

  const probs = Registry.audit().problems.filter(p => p.family === 'forgeNode' || p.family === 'forgeMod');
  ok(probs.length === 0, 'registry 审计对图纸 / 修正键两个家族不报错',
    probs.slice(0, 3).map(p => p.family + '.' + p.id + '.' + p.field).join(','));
  ok(Registry.count('forgeNode') === Forge.LIST.length, '图纸表全在总账里', Registry.count('forgeNode'));
}

/* ---------------- 3. 每个键都有人读 ---------------- */
console.log('\n[3] 声明了却没人读 = 这条文案是假的');
{
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  // 读点全在**制造那一侧**：craft.ts（档位/质量）、camp.ts（产线）、market.ts（回收）、
  // game.ts（会话与存档）、profile.ts（结算）
  const src = ['craft.ts', 'camp.ts', 'market.ts', 'game.ts', 'profile.ts']
    .map(f => strip(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8'))).join('\n');
  const unread = Object.keys(Forge.MOD_KEYS).filter(k => src.indexOf(k) < 0);
  ok(unread.length === 0, '每个修正键都在制造那一侧被读过（' + Object.keys(Forge.MOD_KEYS).length + ' 个）',
    unread.join(', '));

  const none = Forge.modsFor([]);
  ok(Object.keys(none).every(k => none[k] === 0), '空图纸 = 全 0（恒等，指纹不变的前提）',
    JSON.stringify(none));
  ok(Forge.modsFor(['basic', 'craft', 'master']).craftTier === 4,
    '三张档位图纸取**最高**（T2/T3/T4 → 4）', Forge.modsFor(['basic', 'craft', 'master']).craftTier);
  ok(Forge.modsFor(['recycle', 'extract']).salvageBonus === 0.2 &&
     Forge.modsFor(['recycle', 'extract']).alloyPerSalvage === 1,
    'add 语义相加（回收加成 0.2 / 合金 +1）', JSON.stringify(Forge.modsFor(['recycle', 'extract'])));
  ok(Forge.modsFor(['不存在']).salvageBonus === 0, '未知图纸被忽略（坏档防线）');
}

/* ---------------- 4. 合金：只由"回收 + 结算"来 ---------------- */
console.log('\n[4] 合金的来源：回收旧装备 + 结算基础产出（**合成不产**）');
{
  // (a) 合成不产合金了
  const s = runWith([], ['knife', 'knife']);
  ok(Game.growthEarned() === 0, '开局没有合金', Game.growthEarned());
  Game.combine(0, 1);
  ok(Game.growthEarned() === 0, '合一次**不再产合金**（这条改动是刻意的：合成只是加工，不产新东西）',
    Game.growthEarned());

  // (b) 回收产合金（数量随装备价值与图纸加成）
  Game.setState('shop');
  const t = runWith(['extract'], ['knife', 'knife'], 61);
  const before = t.growth || 0;
  Game.setState('shop');
  Game.sellWeapon(0);
  ok((t.growth || 0) > before, '回收一件 → 产合金（' + before + ' → ' + t.growth + '）');
  const plain = runWith([], ['knife', 'knife'], 61);
  Game.setState('shop');
  const a1 = plain.growth || 0;
  Game.sellWeapon(0);
  const gainPlain = (plain.growth || 0) - a1;
  const t2 = runWith(['extract'], ['knife', 'knife'], 61);
  Game.setState('shop');
  const a2 = t2.growth || 0;
  Game.sellWeapon(0);
  const gainExtract = (t2.growth || 0) - a2;
  ok(gainExtract === gainPlain + 1, '「合金萃取」每次回收多给 1（' + gainPlain + ' → ' + gainExtract + '）');

  // (c) 结算：基础产出 + 局内回收来的那一份，再乘熔炉
  const run = { char: 'ranger', wave: 12, level: 5, kills: 0, scrap: 0, damage: 0, taken: 0, healed: 0, packs: 0, alloy: 7 };
  const base = Profile.growthForRun(run);
  /* ⚠ **合并之后是两条来源之和**（R43）："打得深"那条 + "合成与基础产出"那条。 */
  const fromDepth = Profile.sporesForRun(run);
  const fromCombine = 3 + Math.floor(12 / 3) + 7;
  ok(base === fromDepth + fromCombine,
    '结算 = 打得深(' + fromDepth + ') + 合成与基础产出(' + fromCombine + ')', base);
  Profile.clear();
  Profile.addGrowth(0);
  const rep = Profile.applyRun(run, {});
  /* ⚠ **语义反转**（M3）：结算不再发养成代币 —— 产出点在 `Game.train`。 */
  ok(rep.growth === 0 && Profile.growth() === 0, '结算**不发**养成代币（产出点已搬进训练）', rep.growth + '/' + Profile.growth());

  Profile.addGrowth(999);
  const order = ['basic', 'recycle', 'extract', 'craft', 'fuse', 'quench', 'master', 'mass', 'furnace', 'myth'];
  /* 「神话图纸」是**唯一**要核心材料的那一张（养成那一侧的关键产出）。
     这条断头路是本轮补上的：核心材料能从关底 Boss 赚到、能进档案，
     但全仓曾经没有一处调用 `Profile.spendCore` —— 数字只涨不花。
     每个 id 只点**一次**（`forgeNode` 第二次会返回"已经解锁"，
     把它算成失败会让这条断言变成假的）。 */
  const firstFail = [];
  for (const id of order) {
    if (!Profile.forgeNode(id).ok) firstFail.push(id);
  }
  ok(firstFail.length === 1 && firstFail[0] === 'myth',
    '没有核心材料时只有「神话图纸」点不了（其余 9 张照常）', firstFail.join(','));
  const mythChk = Profile.canForge('myth');
  ok(mythChk.ok === false && mythChk.core === 2 && /核心材料/.test(mythChk.reason) && /Boss/.test(mythChk.reason),
    '「神话图纸」明确报"核心材料不够"，并指出只有关底 Boss 掉', mythChk.reason);
  Profile.addCore(2);
  const coreNow = Profile.core();
  const fails = ['myth'].filter(id => !Profile.forgeNode(id).ok);
  ok(fails.length === 0 && Profile.isForged('myth'), '给了核心材料之后「神话图纸」解锁成功', fails.join(','));
  ok(Profile.core() === coreNow - 2 && Profile.core() === 0,
    '点「神话图纸」真的扣了 2 个核心材料（' + coreNow + ' → ' + Profile.core() + '）');
  const allForged = order.filter(id => !Profile.isForged(id));
  ok(allForged.length === 0, '全套 ' + order.length + ' 张图纸都在档案里', allForged.join(','));
  /* ⚠ **合并之后（R43）「熔炉」的 +25% 只作用于"合成与基础产出"那一段** ——
     "打得深"那一段不吃它（它只吃天赋的 `sporeMul`）。所以期望是
     `打得深 + round(合成 × 1.25)`，不是 `总数 × 1.25`。 */
  const combineBase = 3 + Math.floor(12 / 3) + 7;
  ok(Profile.growthForRun(run) === fromDepth + Math.round(combineBase * 1.25),
    '「熔炉」把**合成那条** +25%（' + base + ' → ' + Profile.growthForRun(run) + '）', Profile.growthForRun(run));

  const perRun = 3 + 4 + 7;                       // 12 波 + 回收攒 7，不含熔炉
  const runs = Math.ceil(Forge.totalCost() / perRun);
  ok(runs <= 12, '点满整棵树 ≈ ' + runs + ' 局（每局约 ' + perRun + ' 合金）—— 太长就没人看得见它');
  Profile.clear();
}

/* ---------------- 5. 每条修正在对局里真的生效 ---------------- */
console.log('\n[5] 在局里：档位 / 质量 / 产线 / 回收 / 异档熔接');
{
  // (a) 档位门槛：图纸决定"能造什么"
  const none = runWith([], []);
  const t1 = none && Game.craftOptions().filter(o => o.id === 'weapon:knife')[0];
  const t3 = none && Game.craftOptions().filter(o => o.id === 'weapon:shotgun')[0];
  ok(t1 && t1.ok === true, '没图纸也能造 T1（起步不至于无从下手）');
  ok(t3 && t3.ok === false, '没图纸造不了 T3（' + (t3 && t3.reason) + '）');

  const withBasic = runWith(['basic'], []);
  const t2 = Game.craftOptions().filter(o => o.id === 'weapon:sword')[0];
  ok(t2 && t2.ok === true, '「基础图纸」→ T2 能造');
  const t3b = Game.craftOptions().filter(o => o.id === 'weapon:shotgun')[0];
  ok(t3b && t3b.ok === false, '但 T3 还锁着（图纸要一张一张开）');

  const withCraft = runWith(['basic', 'craft'], []);
  const t3c = Game.craftOptions().filter(o => o.id === 'weapon:shotgun')[0];
  ok(t3c && t3c.ok === true, '「工艺图纸」→ T3 能造');
  const t4 = Game.craftOptions().filter(o => o.id === 'weapon:railgun')[0];
  ok(t4 && t4.ok === false, 'T4 仍然锁着');

  const withMaster = runWith(['basic', 'craft', 'master'], []);
  const t4b = Game.craftOptions().filter(o => o.id === 'weapon:railgun')[0];
  ok(t4b && t4b.ok === true, '「大师图纸」→ T4 能造');

  // (b) 产线：图纸「量产线」不占设施位
  /* ⚠ 工坊现在是**跨局资产**：它不会随 `runWith` 开新局而清零，
     所以每次量"图纸给的名额"之前都要先清空、再补材料、再建一座。 */
  const clearCampF = () => {
    const owned = Game.campOwned();
    for (const id of Object.keys(owned)) Game.campSell(id);
    Game.addMaterial(50);
  };
  const s0 = runWith(['basic'], []);
  Game.openCamp();
  clearCampF();
  Game.campBuy('furnace');
  ok(Game.craftLines() === 1, '一建设施 = 一条产线', Game.craftLines());
  const s1 = runWith(['basic', 'fuse', 'mass'], []);
  Game.openCamp();
  clearCampF();
  Game.campBuy('furnace');
  ok(Game.craftLines() === 2, '「量产线」让产线 +1（不占设施位）', Game.craftLines());

  // (c) 回收加成：图纸与工坊相加
  const s2 = runWith(['recycle'], []);
  ok(s2.salvageRate > 0.5, '「废料回收」抬回收比例（0.5 → ' + s2.salvageRate + '）', s2.salvageRate);
  const s3 = runWith([], []);
  Game.openCamp();
  clearCampF();
  Game.campBuy('salvage');
  const both = Weapons.salvageRate + Forge.modsFor(['recycle']).salvageBonus + Game.campFx().salvageBonus;
  ok(Math.abs((Weapons.salvageRate + 0.2 + 0.25) - both) < 1e-9,
    '图纸与工坊的回收加成**相加**（0.5 + 0.2 + 0.25）', both);

  // (d) 质量：图纸「淬火」与工坊「锻台」相加
  const knife = Craft.BY_ID['weapon:knife'];
  const q1 = Forge.modsFor(['quench']).craftQuality;
  ok(q1 > 0, '「淬火」给出制造质量 +' + q1);
  ok(Craft.resultTier(knife, { craftQuality: q1 }, null, () => 0.01).tier === 2,
    '淬火命中 → 造出来直接高一档');

  // (e) 异档熔接：开了之后 T1+T3 也能合
  const f = runWith(['fuse'], ['knife', 'knife']);
  f.player.weapons[1].tier = 3;
  ok(Game.combinePlan(0) !== null, '「异档熔接」→ T1 与 T3 能配成一对');
  ok(Game.combine(0, 1) === true && f.player.weapons[0].tier === 4, 'T1 + T3 → T4',
    f.player.weapons[0] && f.player.weapons[0].tier);
  const g = runWith([], ['knife', 'knife']);
  g.player.weapons[1].tier = 3;
  ok(Game.combine(0, 1) === false, '没有这张图纸时，异档合成被拒（规则是解锁出来的）');

  // 空修正不许消耗随机流：与随机无关的图纸不改变货架
  const r1 = runWith([], [], 777), r2 = runWith(['recycle'], [], 777);
  ok(JSON.stringify(r1.offers.map(o => o.def.id + ':' + o.price)) ===
     JSON.stringify(r2.offers.map(o => o.def.id + ':' + o.price)),
    '与随机无关的图纸（回收）不改变货架 —— 修正必须精确地只动它该动的东西');
  Game.setState('title', true);
}

/* ---------------- 6. 存档：合金与图纸 ---------------- */
console.log('\n[6] 存档：合金与图纸跟着档案走，一局的存档带的是开局那一份');
{
  Profile.clear();
  Profile.addGrowth(40);
  const r = Profile.forgeNode('basic');
  ok(r.ok === true && r.cost === 3 && Profile.growth() === 37, '解锁一张图纸扣合金（40 → 37）', Profile.growth());
  ok(Profile.isForged('basic') && Profile.forgeOwned().indexOf('basic') >= 0, '图纸记在档案里');
  ok(Profile.forgeMods().craftTier === 2, '折叠结果跟着变（能造到 T2）', Profile.forgeMods().craftTier);

  const locked = Profile.canForge('master');
  ok(locked.ok === false && locked.locked === true && /前置/.test(locked.reason),
    '前置没解锁时是"锁着"，理由说清缺哪张', locked.reason);
  Profile.addGrowth(100);
  ok(Profile.canForge('master').ok === false && Profile.canForge('master').locked === true,
    '合金再多也点不了前置没解锁的图纸（顺序是决策）');
  Profile.forgeNode('craft');
  ok(Profile.canForge('master').ok === true, '前置齐了就能点');
  ok(Profile.forgeNode('master').ok === true && Profile.forgeMods().craftTier === 4, '点了之后能造到 T4');

  const snap = Profile.snapshot();
  ok(Array.isArray(snap.forge) && snap.forge.indexOf('master') >= 0, '快照里带着图纸列表', JSON.stringify(snap.forge));
  ok(snap.growth === Profile.growth(), '快照里带着合金', snap.growth);

  // 一局的存档：带的是**开局时**的图纸那一份
  const s = runWith(Profile.forgeOwned(), ['knife', 'knife'], 515);
  const dump = Game.exportRun();
  const wanted = Profile.forgeOwned().sort().join(',');
  ok(Array.isArray(dump.forge) && dump.forge.slice().sort().join(',') === wanted,
    '一局的存档带着开局时的图纸集合（' + wanted + '）', JSON.stringify(dump.forge));
  Game.setState('shop');
  Game.sellWeapon(0);
  const dump2 = Game.exportRun();
  ok(dump2.growth > 0, '回收之后一局的合金 > 0（' + dump2.growth + '）', dump2.growth);

  Game.setState('title', true);
  const back = Game.importRun(dump2);
  ok(back && back.growth === dump2.growth, '读档后合金还在', back && back.growth);
  ok(back && back.fmods.craftTier === 4 && back.salvageRate === Weapons.salvageRate,
    '读档后图纸修正在（能造到 T4；没点回收那张，所以回收比例还是底价）', JSON.stringify(back && back.fmods));

  const dump3 = JSON.parse(JSON.stringify(dump2));
  dump3.forge = [];
  Game.setState('title', true);
  const noForge = Game.importRun(dump3);
  ok(noForge.fmods.craftTier === 0 && noForge.salvageRate === 0.5,
    '存档里没有图纸时那一局就没有图纸修正（存的是开局那一份，不是"现在的档案"）',
    JSON.stringify(noForge.fmods));
  ok(Game.craftOptions().filter(o => o.ok).every(o => o.tier === 1),
    '于是那一局只能造 T1（图纸门槛跟着存档走，不是跟着现在的档案）');

  Save.flush && Save.flush();
  Profile.clear();
  ok(Profile.growth() === 0 && Profile.forgeOwned().length === 0, 'clear() 之后合金与图纸都清空');
  Game.setState('title', true);
}

console.log('\n=== 结果 ===');
if (failures === 0) { console.log('\x1b[32m全部通过 ✔\x1b[0m\n'); process.exit(0); }
console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m\n');
process.exit(1);
