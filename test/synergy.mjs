/* =========================================================
   synergy.mjs — 武器联动（"组合"这一层）

   这一套里最值钱的两条不是"联动生效了"，而是：

     1. **每一条轴都真的够得着** —— 组合玩法最容易死在"阈值设得比资源上限还高"。
        改造前那版设计就是反面教材：想做"同名武器 N 把"，可 22 种造型里
        只有手枪有 2 把，阈值 ≥2 的轴永远触发不了。所以这里逐个家族、
        逐条轴去算"游戏里最多能凑到几件"，跟档位比。
     2. **一把武器时必须恒等** —— 没联动时不能偷偷加一点属性。
        这是行为指纹的前提：三段固定对局的开局都只有 1 把武器，
         只要"单武器 ≠ 恒等"，指纹立刻变。

   另外守着：每个 kind 都必须有家族（漏一个就是那把武器不参与任何联动）、
   档位递增不叠档、属性键真实、文案齐全、界面不自己重算规则。

   用法： node test/synergy.mjs
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
const { Synergy, Weapons, Items, Comp, Stats, Game, Scene, Input, Registry, Chars } = globalThis;
console.error = function () { };

console.log('\n=== Bronana · 武器联动 ===\n');

const defsOf = (ids) => ids.map(id => Weapons.BY_ID[id]).filter(Boolean);
const familyOf = (id) => Synergy.KIND_TO_FAMILY[Weapons.BY_ID[id].kind];

/* ---------------- 1. 家族表：每把武器都有归属 ---------------- */
console.log('[1] 家族表：每把武器都要参与联动');
{
  const a = Synergy.audit();
  ok(a.ok === true, '定义期自检通过（' + a.counts.families + ' 家族 / ' + a.counts.axes + ' 轴 / ' +
    a.counts.weapons + ' 武器）', a.problems.join(' | '));
  ok(a.counts.orphans === 0, '没有"不属于任何家族"的武器（漏一个 = 那把武器不参与联动）');

  // 家族容量：这是"组合玩法立不立得住"的硬指标
  console.log('    家族容量（游戏里最多能凑几把）：');
  const cap = {};
  Weapons.LIST.forEach(d => {
    const f = Synergy.KIND_TO_FAMILY[d.kind];
    cap[f] = (cap[f] || 0) + 1;
  });
  Object.keys(cap).forEach(f => {
    console.log('      ' + Synergy.FAMILY_BY_ID[f].name + '：' + cap[f] + ' 把');
  });
  const thin = Object.keys(cap).filter(f => cap[f] < 3);
  ok(thin.length === 0, '每个家族至少 3 把（否则只有"成对"一档，组合没有深度）',
    thin.map(f => Synergy.FAMILY_BY_ID[f].name + '=' + cap[f]).join(','));

  const audit = Registry.audit();
  const probs = audit.problems.filter(p => p.family === 'weaponFamily' || p.family === 'synergyAxis');
  ok(probs.length === 0, 'registry 审计对家族/轴不报错（kind 引用都落在武器 kind 表里）', probs.length);
}

/* ---------------- 2. 每一条轴都够得着 ---------------- */
console.log('\n[2] 够得着：每条轴的每一档，游戏里都真的凑得出来');
{
  const maxWeapons = Game.cfg.maxWeapons;          // 武器位上限（6）
  const worst = [];
  // 家族轴：容量 vs 最高档
  Weapons.LIST.forEach(() => {});
  const cap = {};
  Weapons.LIST.forEach(d => {
    const f = Synergy.KIND_TO_FAMILY[d.kind];
    cap[f] = (cap[f] || 0) + 1;
  });
  const famAxis = Synergy.AXES.find(a => a.id === 'family');
  Object.keys(cap).forEach(f => {
    const top = famAxis.tiers[famAxis.tiers.length - 1];
    // 你能同时带 6 把，所以"凑得出"的上限 = min(家族容量, 武器位)
    const reach = Math.min(cap[f], maxWeapons);
    if (reach < top.at) worst.push(Synergy.FAMILY_BY_ID[f].name + '：最多 ' + reach + ' < 最高档 ' + top.at);
  });
  ok(worst.length === 0, '每个家族都能靠"装满武器位"摸到最高档（' + maxWeapons + ' 个位子）', worst.join(' | '));

  // 同系轴：近战 / 远程各有多少把
  const byType = {};
  Weapons.LIST.forEach(d => { byType[d.type] = (byType[d.type] || 0) + 1; });
  const typeAxis = Synergy.AXES.find(a => a.id === 'type');
  const typeTop = typeAxis.tiers[typeAxis.tiers.length - 1];
  ok((byType.melee || 0) >= typeTop.at && (byType.ranged || 0) >= typeTop.at,
    '同系轴两个方向都够得着（近战 ' + byType.melee + ' / 远程 ' + byType.ranged + ' ≥ 最高档 ' + typeTop.at + '）');

  // 元素轴：每种元素有几把
  const byEl = {};
  Weapons.LIST.forEach(d => { if (d.element) byEl[d.element] = (byEl[d.element] || 0) + 1; });
  const elAxis = Synergy.AXES.find(a => a.id === 'element');
  const elTop = elAxis.tiers[elAxis.tiers.length - 1];
  const elOk = Object.keys(byEl).filter(e => byEl[e] >= elTop.at);
  ok(elOk.length >= 1, '至少有一种元素够得着最高档：' + Object.keys(byEl).map(e => e + '×' + byEl[e]).join(' / '),
    elOk.join(','));

  // 轴的数量与"够得着"要一起看：**砍掉够不着的轴**也是合格的修法
  // （曾经有一条"工程"轴，但全游戏只有 1 把工程武器 —— 自检把它报了出来）
  const eng = Weapons.LIST.filter(d => d.engineering).length;
  const engAxis = Synergy.AXES.find(a => a.id === 'engage');
  ok(!engAxis && eng < 2,
    '工程轴已经被删掉（工程系武器只有 ' + eng + ' 把，那条轴永远触发不了）—— 不留死轴');
  ok(Synergy.AXES.every(a => a.tiers[a.tiers.length - 1].at <= Game.cfg.maxWeapons),
    '每条轴的最高档都不超过武器位上限（' + Game.cfg.maxWeapons + '）',
    Synergy.AXES.map(a => a.id + ':' + a.tiers[a.tiers.length - 1].at).join(','));
}

/* ---------------- 3. 折叠：只取最高档、不叠档 ---------------- */
console.log('\n[3] 折叠：数件数 → 取达到的最高档（不叠档）');
{
  // 拿一个容量足够的家族做实验
  const fam = Synergy.FAMILIES.reduce((a, b) => (b.kinds.length > a.kinds.length ? b : a));
  const ids = Weapons.LIST.filter(d => Synergy.KIND_TO_FAMILY[d.kind] === fam.id).map(d => d.id);
  ok(ids.length >= 3, '实验家族「' + fam.name + '」有 ' + ids.length + ' 把可用', ids.join(','));

  const one = Synergy.of(defsOf(ids.slice(0, 1)));
  ok(Object.keys(one.stats).length === 0 && one.active.length === 0,
    '**1 把武器 → 恒等**（空 stats、没有命中任何档）—— 行为指纹靠这条');

  const two = Synergy.of(defsOf(ids.slice(0, 2)));
  const tier2 = fam && Synergy.AXES.find(a => a.id === 'family').tiers[0];
  ok(two.active.some(h => h.axis === 'family' && h.tier.at === tier2.at),
    '2 把同家族 → 「' + tier2.title + '」（' + tier2.text + '）',
    two.active.map(h => h.axis + ':' + h.tier.title).join(','));
  ok(Math.abs(two.stats.attackSpeed - tier2.stats.attackSpeed) < 1e-9,
    '属性就是这一档的值（攻速 +' + tier2.stats.attackSpeed + '）', JSON.stringify(two.stats));

  const three = Synergy.of(defsOf(ids.slice(0, 3)));
  const tier3 = Synergy.AXES.find(a => a.id === 'family').tiers[1];
  ok(three.active.some(h => h.axis === 'family' && h.tier.at === tier3.at),
    '3 把 → 「' + tier3.title + '」', three.active.map(h => h.tier.title).join(','));
  ok(Math.abs(three.stats.attackSpeed - tier3.stats.attackSpeed) < 1e-9 &&
     Math.abs(three.stats.attackSpeed - (tier2.stats.attackSpeed + tier3.stats.attackSpeed)) > 1e-9,
    '**不叠档**：3 把拿的是第 2 档的值，不是"1 档 + 2 档"',
    three.stats.attackSpeed + ' vs ' + (tier2.stats.attackSpeed + tier3.stats.attackSpeed));

  // 不同家族不该互相加成
  const otherFam = Synergy.FAMILIES.find(f => f.id !== fam.id);
  const otherId = Weapons.LIST.find(d => Synergy.KIND_TO_FAMILY[d.kind] === otherFam.id).id;
  const mix = Synergy.of(defsOf([ids[0], otherId]));
  ok(!mix.active.some(h => h.axis === 'family' && h.tier.at >= Synergy.AXES.find(a => a.id === 'family').tiers[1].at),
    '拿两个不同家族 → 不会凑出更高档（"什么都拿"没有联动）',
    mix.active.map(h => h.axis + ':' + h.value + '×' + h.count).join(','));

  // 顺序无关：同一套武器换个顺序，结果逐字节一致
  const shuffled = defsOf(ids.slice(0, 3)).slice().reverse();
  ok(JSON.stringify(Synergy.of(shuffled)) === JSON.stringify(three),
    '顺序无关（同一套武器换个摆放顺序，折出来的完全一样）');

  // progress 与 of 用同一份表：已达到的档必须一致
  const rows = Synergy.progress(defsOf(ids.slice(0, 3)));
  const famRow = rows.find(r => r.axis === 'family');
  ok(famRow && famRow.count === 3 && famRow.tier && famRow.tier.at === tier3.at && famRow.need >= 0,
    'progress 给出"这一组几件、达到哪档、还差几件到下一档"',
    famRow ? [famRow.count, famRow.tier && famRow.tier.title, famRow.need].join('/') : 'null');
}

/* ---------------- 4. 接进模拟层：真的进属性表，且没联动时不加 ---------------- */
console.log('\n[4] 接进模拟层：联动进属性表，且**没触发时恒等**');
{
  const famId = Synergy.FAMILIES.reduce((a, b) => (b.kinds.length > a.kinds.length ? b : a)).id;
  const ids = Weapons.LIST.filter(d => Synergy.KIND_TO_FAMILY[d.kind] === famId).map(d => d.id);

  const run = (weaponIds) => {
    Game.newRun('ranger', 4242, 0, null, null);
    const s = Game.getSession();
    s.player.weapons.length = 0;
    weaponIds.forEach(id => Game.addWeapon(id));
    Game.recalcStats();
    return s;
  };

  const base = run([]);
  const baseStats = JSON.stringify(base.stats);
  const oneW = run([ids[0]]);
  ok(oneW.synergy && oneW.synergy.active.length === 0, '1 把武器：会话里的 synergy 是空的', JSON.stringify(oneW.synergy));
  // 与"没有任何武器"比：差别只可能来自武器本身（这里只比对 synergy 那一份）
  ok(Object.keys(oneW.synergy.stats).length === 0, '1 把武器时联动增量为空');
  const twoW = run(ids.slice(0, 3));
  ok(twoW.stats.attackSpeed > oneW.stats.attackSpeed,
    '3 把同家族：攻速真的进属性表了（' + oneW.stats.attackSpeed + ' → ' + twoW.stats.attackSpeed + '）');
  ok(twoW.synergy.active.length >= 1, '会话里能读到触发了哪几条联动',
    twoW.synergy.active.map(h => h.axis + ':' + h.value).join(','));
  void baseStats;
  Game.setState('title', true);
}

/* ---------------- 5. 道具套装（F 的另一半） ---------------- */
console.log('\n[5] 道具套装：每件道具都有归属、每档都够得着、件数为 0 时恒等');
{
  const sets = Synergy.ITEM_SETS;
  ok(sets.length >= 3, '套装表至少有 3 套（' + sets.length + ' 套）');
  const bad = [];
  for (const s of sets) {
    if (!s.name || !s.note) bad.push(s.id + ' 缺名字/说明');
    if (!s.items.length) bad.push(s.id + ' 没有成员');
    const top = s.tiers[s.tiers.length - 1].at;
    if (s.items.length < top) bad.push(s.id + ' 只有 ' + s.items.length + ' 件，但最高档要 ' + top);
  }
  ok(bad.length === 0, '每套都有名字/说明，而且成员数够到最高档', bad.join(' | '));

  // **每件道具都必须有套装**（漏一件 = 那件不参与套装，玩家看不出来）
  const noSet = Items.LIST.filter(d => !sets.some(s => s.items.indexOf(d.id) >= 0)).map(d => d.id);
  ok(noSet.length === 0, '全部 ' + Items.LIST.length + ' 件道具都归属了某一套', noSet.join(','));
  // 不能重复归属（一件道具同时进两套 → 加成会重复计）
  const dup = [];
  const owner = {};
  for (const s of sets) {
    for (const id of s.items) {
      if (owner[id]) dup.push(id + '(' + owner[id] + '/' + s.id + ')');
      owner[id] = s.id;
    }
  }
  ok(dup.length === 0, '没有一件道具同时属于两套', dup.join(','));

  // 折叠：恒等 / 取最高档 / 顺序无关
  const set = sets.reduce((a, b) => (b.items.length > a.items.length ? b : a));
  const defs = set.items.map(id => Items.BY_ID[id]);
  const none = Synergy.ofItems([]);
  ok(Object.keys(none.stats).length === 0 && none.active.length === 0, '一件道具都没有 → 恒等');
  const one = Synergy.ofItems(defs.slice(0, 1));
  ok(Object.keys(one.stats).length === 0 && one.near && one.near.need === set.tiers[0].at - 1,
    '1 件 → 恒等，但给出"再拿几件"的提示', JSON.stringify(one.near));
  const atTop = Synergy.ofItems(defs.slice(0, set.tiers[set.tiers.length - 1].at));
  ok(atTop.active.length === 1 && atTop.active[0].tier.at === set.tiers[set.tiers.length - 1].at,
    '凑到最高档 → 拿到的是最高那档（' + set.name + ' ×' + atTop.active[0].count + '）');
  ok(Object.keys(atTop.stats).length > 0, '最高档真的给属性', JSON.stringify(atTop.stats));
  const shuffled = Synergy.ofItems(defs.slice(0, set.tiers[0].at).reverse());
  ok(JSON.stringify(shuffled.stats) === JSON.stringify(Synergy.ofItems(defs.slice(0, set.tiers[0].at)).stats),
    '顺序无关（换个摆放顺序折出来一样）');
  // 进模拟层：件数够时属性真的变了
  Game.newRun('ranger', 4242, 0);
  const s = Game.getSession();
  const before = s.stats.armor + s.stats.attackSpeed + s.stats.damage + s.stats.harvesting;
  s.player.items.length = 0;
  const plating = sets.find(x => x.id === 'plating') || set;
  plating.items.slice(0, plating.tiers[0].at).forEach(id => {
    s.player.items.push(Comp.spawn('item', { def: Items.BY_ID[id] }));
  });
  Game.recalcStats();
  ok(s.itemSets && s.itemSets.active.length >= 1, '道具套装进了会话（itemSets 有命中）',
    s.itemSets ? s.itemSets.active.map(h => h.value).join(',') : 'null');
  void before;
  // 套装进的是属性表（不是"只记了个标记"）
  const withSet = JSON.stringify(s.stats);
  s.player.items.length = 0;
  Game.recalcStats();
  ok(JSON.stringify(s.stats) !== withSet, '卸掉之后属性确实变了（说明真的并进了属性表）');
  const rows = Synergy.setProgress([]);
  ok(rows.length === sets.length && rows.every(r => r.count === 0 && r.next),
    'setProgress 把 0 件的套装也列出来（否则玩家不知道有这几套）', rows.length + ' 行');
  Game.setState('title', true);
}

/* ---------------- 6. 界面：不自己算规则、也不列键名 ---------------- */
console.log('\n[6] 界面契约：规则只在 synergy.ts，界面只翻译');
{
  const uiSrc = fs.readFileSync(path.join(ROOT, 'src', 'ui.ts'), 'utf8');
  ok(/Synergy\.progress\(/.test(uiSrc), '商店里的联动面板用的是模块给的 progress()');
  ok(/Synergy\.setProgress\(/.test(uiSrc), '道具套装那一块用的是 setProgress()（界面不自己数件数）');
  ok(!/KIND_TO_FAMILY|kind === 'knife'|axis === 'family'|ITEM_SETS\[/.test(uiSrc),
    '界面不碰家族表 / 不自己判断轴 / 不自己遍历套装表');
  const synSrc = fs.readFileSync(path.join(ROOT, 'src', 'synergy.ts'), 'utf8');
  ok(!/U\.rng|Math\.random|Date\.now/.test(synSrc), 'synergy.ts 里没有随机与时间（纯函数）');
  ok(!/from '\.\/game\.ts'/.test(synSrc), 'synergy.ts 不依赖模拟层（只吃武器/道具定义）');
  ok(/Registry\.family\('itemSet'/.test(synSrc), '套装表登记进了扩展点总账（成员引用会一起被审计）');

  // 模拟层只读它折出来的 stats，不重复实现规则
  const gameSrc = fs.readFileSync(path.join(ROOT, 'src', 'game.ts'), 'utf8');
  ok(/Synergy\.of\(/.test(gameSrc) && /Synergy\.ofItems\(/.test(gameSrc) && !/KIND_TO_FAMILY/.test(gameSrc),
    'game.ts 只调用 Synergy.of() / ofItems()，不认识家族表与套装表');
}

console.log('\n=== 结果 ===');
if (failures === 0) { console.log('\x1b[32m全部通过 ✔\x1b[0m\n'); process.exit(0); }
console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m\n');
process.exit(1);
