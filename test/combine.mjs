/* =========================================================
   combine.mjs — 武器合成（战斗 × 经营的交点）

   这一套盯六件事：
     1) **台阶必须值得爬** —— 每一档的收益都要够大，否则"花两个格子换一档"是亏的
     2) **规则是纯数据**：谁能合、合完多强、值多少钱，全在 data_weapons.ts
     3) **合成真的改了会话状态**：槽位、品级、计数、结果落在靠前的格子（阵型不乱）
     4) **买武器的落位规则**（brotato 的两条原作细节）：
        空槽就装上；槽满了才合成；既没槽又合不了 → 明确拒绝
     5) **数值真的进了伤害公式**：对照实验 —— 同一颗种子、同一间房，T1 vs T2 vs T4 清怪
     6) **存档 / 回放**：品级与合成次数都不该在往返中蒸发

   用法： node test/combine.mjs
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { loadAll, SIM_MODULES, RENDER_MODULES, UI_MODULES } from './_load.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
let failures = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  \x1b[32mPASS\x1b[0m ' + label);
  else { failures++; console.log('  \x1b[31mFAIL\x1b[0m ' + label + (extra !== undefined ? '  → ' + extra : '')); }
}

await loadAll(SIM_MODULES.concat(RENDER_MODULES, UI_MODULES));
const { Game, Rec, Weapons, Input, Registry, Tiers } = globalThis;
const UIx = globalThis.UI, Scenex = globalThis.Scene;
console.error = function () { };

console.log('\n=== Bronana · 武器合成（T1–T4） ===\n');

/** 造一局并摆到商店；weapons 是**清空角色自带装备之后**要带的武器 id 列表
    （不清的话游侠那把初始手枪会挤进槽位号，断言就全歪了） */
function freshRun(weapons, mats) {
  Game.setState('title', true);
  Game.newRun('ranger', 20260601, 0,
    { stats: {}, weapons: [], items: [], scrap: mats === undefined ? 500 : mats });
  const s = Game.getSession();
  s.player.weapons.length = 0;
  (weapons || []).forEach(id => Game.addWeapon(id));
  toShop(s);
  return s;
}

/* ---------------- 1. 台阶表 ---------------- */
console.log('[1] 品级台阶：每一档都得值得爬');
{
  /* 档位表在 data_tiers.ts：这里只断言**它自洽**，并把"加一档"该发生的事说清楚。
     数量不再写死（以前是 `=== 4`，加一档就红），而是"表里的行数 = 上限"。 */
  ok(Tiers.MAX === Tiers.LIST.length && Tiers.MAX >= 4,
    '品级上限 = 台阶表的行数（' + Tiers.MAX + ' 档：' + Tiers.LIST.map(t => 'T' + t.tier + t.name).join(' ') + '）');
  ok(Weapons.TIER_MAX === Tiers.MAX && Weapons.TIERS === Tiers.LIST,
    'Weapons 读的是**同一份**表（不是副本）：加一档只需要改 data_tiers.ts');
  ok(Tiers.LIST.every((t, i) => t.tier === i + 1), '台阶表按 T1→T' + Tiers.MAX + ' 连续排列');
  ok(Tiers.LIST[Tiers.MAX - 1].name === '神话' && Tiers.LIST[Tiers.MAX - 1].cls === 't5',
    '顶档是 T5「神话」（红色：class t5）');
  ok(Tiers.audit().ok === true, '品级表自检通过（名字 / 颜色类 / 倍率 / 解锁波次 / 穿透都齐）',
    Tiers.audit().problems.join(' | '));

  // 出身档的倍率必须是恒等 1 —— 否则"没合成的武器"也会被算错
  let ident = true, mono = true, step = Infinity;
  for (const d of Weapons.LIST) {
    for (const k of ['dmg', 'cd', 'knock', 'reach']) {
      if (Math.abs(Weapons.mulFor(d, d.tier, k) - 1) > 1e-9) ident = false;
    }
    let prev = 0;
    for (let t = d.tier; t <= Weapons.TIER_MAX; t++) {
      const m = Weapons.mulFor(d, t, 'dmg');
      if (m < prev) mono = false;
      if (t > d.tier) step = Math.min(step, m / prev);
      prev = m;
    }
  }
  ok(ident, '出身档（def.tier）的倍率恒等 1：没合成的武器数值一分不变');
  ok(mono, '每个档位的伤害倍率单调不降');
  /* 这一步是**设计断言**，不是凑数：合成吃掉两个格子 + 一次购买机会，
     如果每档只有 +10%，理性玩家永远不会合。brotato 的台阶大致是 +50% 一档，
     这里取同一个量级。 */
  ok(step >= 1.3, '每一档的伤害台阶 ≥ 1.3（实测最小 ' + step.toFixed(3) + '）—— 否则"合了不如再买一把"');

  // 顶档的额外穿透只给"本来没打穿一切"的远程；逐档的数是品级表的 pierce 列
  const flame = { id: 'flame', def: Weapons.BY_ID['flame'], cd: 0, swing: 0, tier: Tiers.MAX };
  const shotgun = { id: 'shotgun', def: Weapons.BY_ID['shotgun'], cd: 0, swing: 0, tier: Tiers.MAX };
  const knife = { id: 'knife', def: Weapons.BY_ID['knife'], cd: 0, swing: 0, tier: Tiers.MAX };
  ok(Weapons.pierceBonus(flame) === 0, '喷火器（穿透 99）在顶档不再加穿透 —— 给了也只是噪音', Weapons.pierceBonus(flame));
  ok(Weapons.pierceBonus(shotgun) === Tiers.LIST[Tiers.MAX - 1].pierce,
    '霰弹枪在 T' + Tiers.MAX + ' 拿到 +' + Tiers.LIST[Tiers.MAX - 1].pierce + ' 穿透',
    String(Weapons.pierceBonus(shotgun)));
  ok(Weapons.pierceBonus(knife) === 0, '近战不拿穿透（拿的是射程）', Weapons.pierceBonus(knife));

  // 每一把武器的出身档都必须落在台阶表里（写 tier: 6 会让倍率静默退化成 T1）
  const badTier = Weapons.LIST.filter(d => !Weapons.TIER_BY[d.tier]);
  ok(badTier.length === 0, '每把武器的 def.tier 都在台阶表里（' + Weapons.LIST.length + ' 把）',
    badTier.map(d => d.id + ':' + d.tier).join(','));
  const probs = Registry.audit().problems.filter(p => p.family === 'tier' || p.family === 'weapon' || p.family === 'item');
  ok(probs.length === 0, 'registry 审计对武器 / 道具 / 品级三个家族不报错',
    probs.slice(0, 3).map(p => p.family + '.' + p.id + '.' + p.field).join(','));
  ok(Registry.count('tier') === Tiers.MAX, '品级表登记了 ' + Tiers.MAX + ' 条', Registry.count('tier'));

  /* ---------------- "统一管理"的守卫 ----------------
     这几句话以前在 **6 个文件**里各写了一遍（品级名数组 ×2、解锁阶梯 ×4、上限 ×1），
     加一档要改 6 处，漏任何一处都是**静默**的。所以这里静态扫一遍源码 ——
     而不是靠"记得改"。守卫自己也要能被证明有效（下面那条对照样本）。 */
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const BANNED = [
    [/'普通',\s*'精良'/, '档位名数组'],
    [/wave\s*<=\s*2\s*\?\s*1/, '解锁波次的内联阶梯'],
    [/TIER_MAX\s*=\s*\d/, '写死的档位上限']
  ];
  const dup = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.endsWith('.ts'))) {
    if (f === 'data_tiers.ts') continue;                 // 唯一允许写这些的地方
    const code = strip(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8'));
    for (const [re, what] of BANNED) if (re.test(code)) dup.push(f + ' 里还有' + what);
  }
  ok(dup.length === 0, '品级的三件事（名字 / 解锁阶梯 / 上限）只住在 data_tiers.ts', dup.join(' | '));
  ok(BANNED.some(([re]) => re.test('var x = wave <= 2 ? 1 : 2;')),
    '（对照）这套静态规则真的抓得到重复的阶梯 —— 否则守卫只是装饰');

  /* 颜色：一档一个变量 + 角标两处规则；**T2 以上**再加货架卡与"我的武器"小格。
     T1 是默认档（货架卡/小格不上色 = 最普通的那一档），所以它只需要变量与角标。 */
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const missCss = [];
  for (const t of Tiers.LIST) {
    if (!new RegExp('--tier' + t.tier + '\\s*:').test(css)) missCss.push('--tier' + t.tier);
    const sels = ['.tier.' + t.cls, '.wslot .pip.' + t.cls];
    if (t.tier > 1) sels.push('.card.' + t.cls, '.wbox.' + t.cls);
    for (const sel of sels) if (css.indexOf(sel + '{') < 0) missCss.push(sel);
  }
  ok(missCss.length === 0, Tiers.MAX + ' 档的颜色在 styles.css 里都齐（变量 + 角标' +
    (Tiers.MAX > 1 ? ' + T2 以上的卡片/小格' : '') + '）', missCss.join(', '));}

/* ---------------- 2. 谁能合 / 跟谁合（纯数据） ---------------- */
console.log('\n[2] 合成规则是纯数据：同名 + 同档 + 没到顶');
{
  const W = (id, tier) => ({ id, def: Weapons.BY_ID[id], cd: 0, swing: 0, tier });
  const knife1 = W('knife', 1), knife1b = W('knife', 1), knife2 = W('knife', 2), sword1 = W('sword', 1);
  ok(Weapons.canCombine(knife1) === true, 'T1 可以合');
  /* 顶档从 T4 变成 T5 之后，**T4 也变得可以合了** —— 这正是"成型变慢"的那一档：
     T4 不再是一局的终点，而 T5 要 16 把同名 T1（四轮合成）才够。 */
  ok(Weapons.canCombine(W('knife', Weapons.TIER_MAX)) === false,
    'T' + Weapons.TIER_MAX + '（' + Tiers.nameOf(Weapons.TIER_MAX) + '）到顶，不能再合');
  ok(Weapons.canCombine(W('knife', Weapons.TIER_MAX - 1)) === true,
    'T' + (Weapons.TIER_MAX - 1) + ' 还能再往上一档（顶档之下的都还在树上）');
  ok(Weapons.canCombine(W('hammer', Weapons.TIER_MAX - 1)) === true,
    '出身就是 T' + (Weapons.TIER_MAX - 1) + ' 的武器（战锤）也有合成路线了');
  ok(Weapons.canCombine(null) === false && Weapons.canCombine(undefined) === false, '空值安全');

  const list = [knife1, sword1, knife1b, knife2];
  ok(Weapons.partnerOf(list, knife1, 0) === 2, '找到第 3 格的同名同档匕首', Weapons.partnerOf(list, knife1, 0));
  ok(Weapons.partnerOf(list, knife1, 2) === 0, '换个视角找的是另一格（不会返回自己）');
  ok(Weapons.partnerOf(list, knife2, 3) === -1, '同名的 T2 匕首没有伙伴（档位不同不能合）');
  ok(Weapons.partnerOf(list, sword1, 1) === -1, '长剑没有伙伴');
  ok(Weapons.tierOf(knife2) === 2 && Weapons.tierOf(knife1) === 1, 'tierOf 读实例档位');
  ok(Weapons.tierOf({ id: 'knife', def: Weapons.BY_ID['knife'], cd: 0, swing: 0 }) === 1,
    '实例上没写 tier 时退回 def.tier（老存档 / 手工造的对象）');
}

/* ---------------- 3. 合成真的改状态 ---------------- */
console.log('\n[3] 在局里：两把同名同档 → 一把高一档，落在靠前的格子');
{
  const s = freshRun(['knife', 'knife', 'sword']);
  ok(s.player.weapons.length === 3, '开局带了 3 把武器（角色的初始手枪被清掉了）', s.player.weapons.length);
  const plans = Game.combinePlans();
  /* 两把同名同档 → **两条**计划（第 1 格找第 2 格、第 2 格找第 1 格）。
     为什么要两条：界面要给**每一格**都画按钮（玩家可能想留下靠后的那一把）。 */
  ok(plans.length === 2 && plans[0].i === 0 && plans[0].j === 1 && plans[1].i === 1 && plans[1].j === 0,
    '两把 T1 匕首互相是对方的合成对象（两条计划）', JSON.stringify(plans));
  ok(Game.combinePlan(1) && Game.combinePlan(1).j === 0, '第 2 格也能合（找的是另一格）');
  ok(Game.combinePlan(2) === null, '长剑那一格没有合成对象');

  const before = s.player.weapons[0].def.dmg;
  ok(Game.combine(0, 1) === true, '合成成功');
  ok(s.player.weapons.length === 2, '两把变一把', s.player.weapons.length);
  ok(s.player.weapons[0].tier === 2 && s.player.weapons[0].id === 'knife',
    '结果**落在靠前的格子**且仍是匕首（阵型不乱、造型不变）',
    s.player.weapons[0].id + ' T' + s.player.weapons[0].tier);
  ok(s.player.weapons[0].def.dmg === before, '武器本身的数据没被改（品级是实例字段）');
  ok(Math.abs(Weapons.mul(s.player.weapons[0], 'dmg') - 1.5) < 1e-9,
    '伤害倍率 = 1.5（T1→T2 的台阶）', Weapons.mul(s.player.weapons[0], 'dmg'));
  ok(s.combineCount === 1, '合成次数记在会话里', s.combineCount);
  ok(String(s.player.weapons[1].id) === 'sword', '长剑那一格还在（只动了该动的两格）', s.player.weapons[1].id);
  ok(s.player.weapons.every((w, i) => w.index === i), '槽位号重新编号（挂点也跟着对）',
    s.player.weapons.map(w => w.index).join(','));

  /* 四把 T1 连合到 T3：每一步之后槽位号都必须合法（中间态不能出现空洞） */
  const s2 = freshRun(['knife', 'knife', 'knife', 'knife']);
  ok(Game.combine(0, 1) === true, '4 把 T1 → 三把（[T2, T1, T1]）',
    s2.player.weapons.map(w => 'T' + w.tier).join(','));
  ok(Game.combine(1, 2) === true, '再把剩下两把 T1 合掉 → [T2, T2]',
    s2.player.weapons.map(w => 'T' + w.tier).join(','));
  ok(Game.combine(0, 1) === true, '两把 T2 合成 → [T3]');
  ok(s2.player.weapons.length === 1 && s2.player.weapons[0].tier === 3,
    '最后只剩一把 T3 匕首', s2.player.weapons.length + ' 把 / T' + s2.player.weapons[0].tier);
  ok(s2.combineCount === 3, '三次合成都记了数', s2.combineCount);
  ok(Math.abs(Weapons.mul(s2.player.weapons[0], 'dmg') - 2.1) < 1e-9,
    'T3 的伤害倍率 2.1（四把匕首的投入换来的）', Weapons.mul(s2.player.weapons[0], 'dmg'));
  const s1 = freshRun(['knife']);
  ok(Game.combine(0, 0) === false && s1.player.weapons.length === 1, '只有一把时什么都合不了');

  /* 顶档的**代价**：T1→T5 要 16 把（四轮合成 = 15 次）+ 一张「神话图纸」。
     这一条是"成型速度"的定量说明 —— 以前 T4 是终点（8 把），现在到顶要多一倍，
     而且**最后一档归图纸**（不然 16 把同名在一局里硬攒就行了，养成那一侧没有位置）。
     16 把是**直接摆上去**的：`addWeapon` 会走"槽满就并档"的规则，
     摆 16 把同名 T1 的结果是当场并到 T4（那正是要量的那条规则，不能借它来搭台）。 */
  const stack = (sess, n, id, tier) => {
    for (let i = 0; i < n; i++) {
      const w = Weapons.instantiate(id, tier || 1);
      w.index = i;
      sess.player.weapons.push(w);
    }
    return sess;
  };
  const merge = sess => {
    let steps = 0;
    for (let guard = 0; guard < 60; guard++) {
      let did = false;
      for (let i = 0; i + 1 < sess.player.weapons.length; i++) {
        if (sess.player.weapons[i].tier === sess.player.weapons[i + 1].tier && Game.combine(i, i + 1)) {
          steps++; did = true; break;
        }
      }
      if (!did) break;
    }
    return steps;
  };
  /* ① 没有图纸：顶档锁着，两把 T4 合不动，而且理由是"要神话图纸" */
  const locked = stack(freshRun([]), 2, 'knife', Weapons.TIER_MAX - 1);
  let lockWhy = '';
  Game.events.on('deny', m => { lockWhy = m; });
  ok(Game.combine(0, 1) === false && /神话图纸/.test(lockWhy),
    '没有「神话图纸」时 T' + (Weapons.TIER_MAX - 1) + '+T' + (Weapons.TIER_MAX - 1) +
    ' 合不动，理由是"要先解锁神话图纸"', lockWhy);
  const lplans = Game.combinePlans();
  ok(lplans.length >= 1 && lplans.every(p => p.locked === true && /神话图纸/.test(p.why || '')),
    '界面拿得到"按不动 + 为什么"（不是把按钮悄悄藏掉）', JSON.stringify(lplans[0] || {}));

  /* ② 点开图纸：同样的操作走到顶 */
  const ladder = stack(freshRun([]), 16, 'knife', 1);
  ladder.fmods.craftTier = Weapons.TIER_MAX;
  const steps = merge(ladder);
  ok(ladder.player.weapons.length === 1 && ladder.player.weapons[0].tier === Weapons.TIER_MAX,
    '16 把同名 T1 → 一把 T' + Weapons.TIER_MAX + '（' + steps + ' 次合成走到顶）',
    ladder.player.weapons.length + ' 把 / ' + ladder.player.weapons.map(w => 'T' + w.tier).join(','));
  ok(Game.combine(0, 0) === false, '到了顶档就再也合不动了');
  Game.events.clear('deny');

  // 拒绝的几种情况：一条都不能静默成功
  const s3 = freshRun(['knife', 'knife', 'sword', 'hammer', 'hammer', 'hammer']);
  ok(Game.combine(0, 0) === false, '自己和自己合 → 拒绝');
  ok(Game.combine(0, 2) === false, '匕首 + 长剑 → 拒绝');
  ok(Game.combine(0, 99) === false && Game.combine(-1, 0) === false, '越界槽位 → 拒绝');
  ok((s3.combineCount || 0) === 0, '被拒的合成一次都没记数', String(s3.combineCount));
  /* 两把 T4 战锤：**没有图纸时合不动**（顶档锁着，理由见上），点开「神话图纸」才合得动。
     顶档不再是 T4 —— 这正是"成型变慢"的那一格。 */
  let why4 = '';
  Game.events.on('deny', m => { why4 = m; });
  ok(Game.combine(3, 4) === false && /神话图纸/.test(why4),
    '没有图纸：两把 T4 战锤合不动，理由是"要先解锁神话图纸"', why4);
  s3.fmods.craftTier = Weapons.TIER_MAX;
  ok(Game.combine(3, 4) === true &&
    s3.player.weapons.filter(w => w.tier === Weapons.TIER_MAX).length === 1 && s3.combineCount === 1,
    '点开图纸：两把 T4 战锤 → 一把 T' + Weapons.TIER_MAX + '，计数 +1', String(s3.combineCount));
  Game.events.clear('deny');

  // 状态守卫：不能在战斗中整理装备（合成是"商店 / 营地"的事）
  Game.setState('playing', true);
  ok(Game.combine(0, 1) === false, '战斗中不能合成（与买 / 卖 / 刷新同一道门）', Game.state);
  Game.setState('title', true);
}

/* ---------------- 4. 买武器的落位规则 ---------------- */
console.log('\n[4] 买武器：空槽就装上，槽满了才合成（brotato 的两条原作细节）');
{
  /* ① 空槽直接装上 —— 这一条是原作细节，也是"同一局里能不能拿两把同型号的枪"的答案 */
  const s = freshRun(['knife'], 500);
  s.offers[0] = { type: 'weapon', def: Weapons.BY_ID['knife'], sold: false, price: 10, tier: 1 };
  s.player.scrap = 500;
  ok(Game.buyOffer(0) === true, '第 2 格空着 → 买下就装上');
  ok(s.player.weapons.length === 2 && s.player.weapons[1].tier === 1,
    '两把 T1 匕首并存（没有被自动合成）', s.player.weapons.length);

  /* ② 槽满了 + 有同名同档 → 买下即合成（这才是"格子满了"的出路） */
  const s2 = freshRun(['knife', 'knife', 'knife', 'knife', 'knife', 'knife'], 500);
  s2.offers[0] = { type: 'weapon', def: Weapons.BY_ID['knife'], sold: false, price: 10, tier: 1 };
  const mats0 = s2.player.scrap;
  ok(Game.buyOffer(0) === true, '六格全满 + 同名同档 → 买得进来（并进第 1 格）');
  ok(s2.player.weapons.length === 6, '还是 6 把（没有溢出，也没有被拒）', s2.player.weapons.length);
  ok(s2.player.weapons[0].tier === 2, '第 1 格抬到 T2', s2.player.weapons[0].tier);
  ok(s2.player.scrap === mats0 - 10, '钱照扣（合成不等于免费）', s2.player.scrap);

  /* ③ 槽满了又合不了 → 明确拒绝，并说清为什么 */
  const s3 = freshRun(['knife', 'sword', 'spear', 'axe', 'torch', 'taser'], 500);
  s3.offers[0] = { type: 'weapon', def: Weapons.BY_ID['pistol'], sold: false, price: 10, tier: 1 };
  const mats3 = s3.player.scrap;
  ok(Game.buyOffer(0) === false, '六格全满且没有同名同档 → 拒绝');
  ok(s3.player.scrap === mats3 && s3.offers[0].sold === false,
    '拒绝时**钱没扣、货没卖掉**', s3.player.scrap + '/' + s3.offers[0].sold);
  let why = '';
  Game.events.on('deny', m => { why = m; });
  Game.buyOffer(0);
  ok(/武器槽已满/.test(why) && /同名同档/.test(why), '拒绝理由说清了"要合并得先有同名同档的另一把"', why);

  /* ④ 顶档的同名武器：槽满了也进不来（到头了），理由是"满档"而不是"没伙伴"。
     顶档现在是 T5，所以要摆六把 T5 战锤（`addWeapon` 只会造出身档那一把 T4）。 */
  const s4 = freshRun([]);
  for (let i = 0; i < 6; i++) {
    const w = Weapons.instantiate('hammer', Weapons.TIER_MAX);
    w.index = i;
    s4.player.weapons.push(w);
  }
  s4.offers[0] = { type: 'weapon', def: Weapons.BY_ID['hammer'], sold: false, price: 10, tier: Weapons.TIER_MAX };
  why = '';
  ok(Game.buyOffer(0) === false && /满档/.test(why),
    'T' + Weapons.TIER_MAX + ' 战锤满格 + 同名 → 理由是"已经满档"', why);
  Game.setState('title', true);
}

/* ---------------- 5. 数值真的进了伤害公式（木桩实验） ---------------- */
console.log('\n[5] 木桩实验：品级台阶真的接在伤害公式上');
{
  const pct = m => (m * 100 - 100).toFixed(0) + '%';

  /* (a) 公式本身：同一个武器实例，只把 tier 抬上去 —— 比值必须**正好**是台阶表。
      这是最干净的一条：没有随机、没有走位、没有暴击。 */
  const W = tier => ({ id: 'knife', def: Weapons.BY_ID['knife'], cd: 0, swing: 0, tier });
  const d1 = Game._internals.weaponDamage(W(1));
  const d2 = Game._internals.weaponDamage(W(2));
  const d4 = Game._internals.weaponDamage(W(4));
  ok(Math.abs(d2 / d1 - 1.5) < 1e-9, 'T2 的伤害正好是 T1 的 1.5 倍（' + d1.toFixed(2) + ' → ' + d2.toFixed(2) + '）',
    (d2 / d1).toFixed(4));
  ok(Math.abs(d4 / d1 - 3.0) < 1e-9, 'T4 的伤害正好是 T1 的 3 倍（' + d1.toFixed(2) + ' → ' + d4.toFixed(2) + '）',
    (d4 / d1).toFixed(4));
  const c1 = Game._internals.weaponCd(W(1)), c4 = Game._internals.weaponCd(W(4));
  ok(Math.abs(c4 / c1 - 0.86) < 1e-9, 'T4 的冷却 ×0.86（出手也更快）', (c4 / c1).toFixed(4));
  const r1 = Game._internals.weaponReach(W(1)), r4 = Game._internals.weaponReach(W(4));
  ok(r4 > r1, 'T4 的射程/范围更远（近战拿的那一份）', (r4 / r1).toFixed(3));

  /* (b) 端到端：一句"伤害更高"要能在**真的模拟里**量出来 ——
      否则上面那条只是在测一个没人调用的函数。做法是打木桩：
      玩家与敌人的位置每帧钉死、敌人血厚到打不死、玩家无敌，只让武器自己开火。 */
  function dummyTrial(tier, frames) {
    Game.setState('title', true);
    Game.newRun('ranger', 5150, 0, { stats: {}, weapons: [], items: [], scrap: 0 });
    const s = Game.getSession();
    s.player.weapons.length = 0;
    Game.addWeapon('knife', tier);
    s.player.invuln = 1e9;
    enterFightRoom(s);
    Game._internals.holdRoom(s);          // 别让"清空即过"把状态推走
    s.spawnQueue = []; s.spawnIdx = 0; s.waveLeft = 1e9; s.enemies.length = 0;
    const p = s.player;
    const e = Game._internals.spawnEnemy('grub', p.x + 40, p.y);
    e.hp = 1e9; e.maxHp = 1e9; e.speed = 0; e.dmg = 0;
    const x0 = p.x, y0 = p.y;
    for (let i = 0; i < frames; i++) {
      p.x = x0; p.y = y0;                 // 站桩（走位会引入另一条随机流）
      e.x = x0 + 40; e.y = y0;
      Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });
    }
    return s.stats_total.dmg;
  }
  const FRAMES = 1800;                    // 30 秒 ≈ 匕首 48 次出手：暴击的噪声被平均掉
  const m1 = dummyTrial(1, FRAMES), m2 = dummyTrial(2, FRAMES), m4 = dummyTrial(4, FRAMES);
  ok(m1 > 0, '基线：T1 匕首在木桩上真的打出了伤害（' + Math.round(m1) + '）', m1);
  ok(m4 > m2 && m2 > m1, '同一颗种子、同一段时间：伤害随品级单调上升（' +
    [m1, m2, m4].map(v => Math.round(v)).join(' → ') + '）');
  ok(m2 / m1 > 1.3, 'T2 实测 +' + pct(m2 / m1) + '（台阶 1.5、冷却还快一点）', (m2 / m1).toFixed(3));
  ok(m4 / m1 > 2.4, 'T4 实测 +' + pct(m4 / m1) + '（台阶 3.0 + 冷却 0.86 ≈ 3.5）', (m4 / m1).toFixed(3));
  console.log('       明细：30 秒木桩伤害 T1 ' + Math.round(m1) + ' / T2 ' + Math.round(m2) +
    ' / T4 ' + Math.round(m4) + '（×' + (m2 / m1).toFixed(2) + ' / ×' + (m4 / m1).toFixed(2) + '）');
  Game.setState('title', true);
}

/* ---------------- 6. 回收：含品级，而且没有套利 ---------------- */
console.log('\n[6] 回收价按**当前价值**算（含品级），并且不产生套利');
{
  const W = (id, tier) => ({ id, def: Weapons.BY_ID[id], cd: 0, swing: 0, tier });
  const t1 = W('knife', 1), t3 = W('knife', 3);
  ok(Weapons.salvageOf(t1) === Math.max(1, Math.round(Weapons.valueOf(t1) * 0.5)),
    'T1 回收 = 半价', Weapons.salvageOf(t1));
  ok(Weapons.valueOf(t3) === Weapons.valueOf(t1) * 4,
    'T3 的价值是 T1 的 4 倍（每一档吃掉两把 → ×2 一档）',
    Weapons.valueOf(t3) / Weapons.valueOf(t1) + '×');
  ok(Weapons.salvageOf(t3) > Weapons.salvageOf(t1) * 3,
    '于是回收一把 T3 不会按 T1 的价钱收走（老实现就是那样）', Weapons.salvageOf(t3));

  /* 无套利：合成前后"玩家手里的材料 + 回收价值"必须守恒或变少。
     这是防"买两把 → 合成 → 回收"刷材料的唯一硬约束。 */
  const s = freshRun(['knife', 'knife'], 500);
  const buyValue = 2 * Math.max(1, Math.round(Weapons.priceOf(Weapons.BY_ID['knife'], 0) * 0.5));
  Game.combine(0, 1);
  ok(Weapons.salvageOf(s.player.weapons[0]) <= buyValue + 1,
    '合成再回收 ≤ 直接回收两把（合成不产钱）',
    Weapons.salvageOf(s.player.weapons[0]) + ' ≤ ' + buyValue);
  const s2 = freshRun(['knife', 'knife', 'knife', 'knife'], 500);
  Game.combine(0, 1); Game.combine(2, 1);
  const four = 4 * Math.max(1, Math.round(Weapons.priceOf(Weapons.BY_ID['knife'], 0) * 0.5));
  ok(Weapons.salvageOf(s2.player.weapons[0]) <= four + 1,
    '连合两次（4 把 → T3）再回收也不产钱', Weapons.salvageOf(s2.player.weapons[0]) + ' ≤ ' + four);
  Game.setState('title', true);
}

/* ---------------- 6b. 最后一把武器不许回收（否则这一局就废了） ----------------
   这是实测出来的**硬软锁**：这一间"打完"的条件是**场上清空**
   （`step` 里的 `drained && enemies.length === 0`），超时只是让剩下的怪狂暴 + 停止再刷，
   它们不会自己消失。于是"手里一把武器都没有"= 这一间永远清不掉 = 商店永不再开
   = 再也买不回武器。实测（种子 20240922、ranger、回收掉唯一的手枪之后）：
   120 游戏秒 0 击杀、开着的门 0 扇、`nextWave()` 返回 false —— 只能从暂停菜单放弃本局。 */
console.log('\n[6b] 最后一把武器不许回收（可玩性下限）');
{
  const s = freshRun(['knife'], 500);
  ok(s.player.weapons.length === 1, '手上只有一把武器', s.player.weapons.length);
  const m0 = s.player.scrap;
  ok(Game.sellWeapon(0) === false, '回收**最后一把**被拒（否则这一间再也清不掉）');
  ok(s.player.weapons.length === 1 && s.player.scrap === m0,
    '被拒之后武器与材料都没有变化', s.player.weapons.length + ' 把 / ' + s.player.scrap);

  Game.addWeapon('knife');
  ok(Game.sellWeapon(0) === true, '有两把时照常能回收');
  ok(Game.sellWeapon(0) === false, '再卖回最后一把又被拒（规则跟着数量走，不是一次性的）');

  /* 坏档 / 老档防线：零武器的存档读进来就是个死局，必须**修**（能修的修）
     —— 游戏本身已经卖不出最后一把，所以这只会来自坏档或"武器 id 全认不出"的老档。 */
  const dump = Game.exportRun();
  const zero = JSON.parse(JSON.stringify(dump));
  zero.weapons = [];
  const back = Game.importRun(zero);
  ok(back && back.player.weapons.length === 1,
    '零武器的存档读档时把角色的起始武器还回来（不是读出一个死局）',
    back && back.player.weapons.map(w => w.id).join(','));
  Game.setState('title', true);
}

/* ---------------- 6c. 极端折扣下也没有套利：回收价封顶在"你付过的钱" ----------------
   两个上限各自独立时会撞车：商店折扣封顶 0.6、回收比例封顶 0.9，
   而 `1.6 × (1-0.6) × (1-0.30) = 0.448 < 0.9` —— 于是折扣叠满时
   **货架上每一位都是净赚**（实测：T2 触手 18 买 / 25 拆、T4 转轮机枪 43 买 / 58 拆，
   一圈买光拆光白拿 66 材料 + 10 合金，而合金是图纸树唯一的稳定来源；
   每波 `S.rerolls` 还会重置，所以每波都能再来一次）。
   修法**不是**去改定价（那会把折扣本身抵消掉），而是给回收价一道上限：
   不许超过你为它付过的钱（`Weapons.salvageOf` 读实例上的 `w.paid`）。
   这一节就从"玩家能做的动作"出发量它 —— 不是查一个数，是真的买光再拆光。 */
console.log('\n[6c] 折扣叠满时"买光 → 拆光"不能赚钱');
{
  const s = freshRun(['knife'], 500);
  const p = s.player;
  p.scrap = 100000;
  /* 折扣叠满：天赋（omods）+ 商店房（roomFx）+ 契约（boonFold.econ），三者相加封顶 0.6；
     回收比例拉满 0.9（工坊「回收炉」那一档）；幸运拉满把 def 价再压 30%。 */
  s.omods.shopDiscount = 0.3;
  s.roomFx.shopDiscount = 0.2;
  s.boonFold = { enemy: {}, econ: { shopDiscount: 0.1 }, stats: {} };
  s.salvageRate = 0.9;
  s.stats.luck = 25;
  Game._internals.openShop(0);
  const weapons = s.offers.filter(o => o.type === 'weapon');
  ok(weapons.length > 0, '货架上有武器可测（' + weapons.length + ' 件）');

  // 真动作：买光（槽满自动合成 / 拒绝），再拆到只剩一把
  const m0 = p.scrap;
  for (let i = 0; i < s.offers.length; i++) Game.buyOffer(i);
  const bought = p.weapons.filter(w => w.paid > 0);
  ok(bought.length >= 2, '真的买进来几把（' + bought.length + ' 把带成本）');
  const over = bought.filter(w => Weapons.salvageOf(w, s.salvageRate) > w.paid);
  ok(over.length === 0, '每一把的回收价都 ≤ 它的成交价（回收价上限 = 你付过的钱）',
    over.map(w => w.def.id + ' 买' + w.paid + '/拆' + Weapons.salvageOf(w, s.salvageRate)).join(', '));

  let guard = 0;
  while (p.weapons.length > 1 && guard++ < 30) Game.sellWeapon(1);
  ok(p.scrap < m0,
    '买光再拆光**材料只减不增**（' + m0 + ' → ' + p.scrap + '）—— 这是"买两把再回收永远是白干"那条不变量的商店一侧',
    p.scrap);
  /* 合金当然还是有的（"回收产合金"是它唯一的稳定来源，这条设计没动），
     但它是**用材料换来的** —— 每件净付 ≥1，所以不是白拿。 */
  ok(s.alloy > 0 && s.alloy <= 30,
    '合金照旧产出，但代价是材料（每件净付 ≥1，不再是免费的）', s.alloy);
  Game.setState('title', true);
}

/* ---------------- 7. 存档往返 ---------------- */
console.log('\n[7] 存档：品级与合成次数都不该蒸发');
{
  const s = freshRun(['knife', 'knife', 'sword'], 500);
  Game.combine(0, 1);
  const dump = Game.exportRun();
  ok(Array.isArray(dump.weapons) && typeof dump.weapons[0] === 'object' && dump.weapons[0].t === 2,
    '导出的武器带品级（{ id, t }）', JSON.stringify(dump.weapons));
  ok(dump.combineCount === 1, '合成次数也进存档', dump.combineCount);

  Game.setState('title', true);
  const back = Game.importRun(dump);
  ok(back && back.player.weapons.length === 2, '读档后还是 2 把', back && back.player.weapons.length);
  ok(back.player.weapons[0].tier === 2 && Weapons.tierOf(back.player.weapons[0]) === 2,
    'T2 匕首的品级被还原（不是退回 T1）', back && back.player.weapons[0].tier);
  ok(back.combineCount === 1, '合成次数还原', back && back.combineCount);

  /* 老存档（武器是字符串）必须还能读：退回出身档，而不是整局丢掉 */
  const old = JSON.parse(JSON.stringify(dump));
  old.weapons = ['knife', 'sword'];
  delete old.combineCount;
  const b2 = Game.importRun(old);
  ok(b2 && b2.player.weapons.length === 2 && b2.player.weapons[0].tier === 1,
    '老存档的字符串武器照样读得进来（退回出身档）',
    b2 && b2.player.weapons.map(w => w.id + ':T' + w.tier).join(','));
  ok(b2.combineCount === 0, '老存档没有合成次数 → 0，而不是 NaN', b2 && b2.combineCount);

  /* 坏档：越界 / 低于出身档的档位都被夹回去，未知 id 丢掉 */
  const bad = JSON.parse(JSON.stringify(dump));
  bad.weapons = [{ id: 'knife', t: 99 }, { id: 'hammer', t: 1 }, { id: '不存在', t: 4 }, 42];
  const b3 = Game.importRun(bad);
  ok(b3 && b3.player.weapons.length === 2, '坏档里未知 id 与非对象被丢掉', b3 && b3.player.weapons.length);
  ok(b3.player.weapons[0].tier === Weapons.TIER_MAX && b3.player.weapons[1].tier === 4,
    '越界档位夹回 T' + Weapons.TIER_MAX + '；低于出身档的档位抬回出身档（战锤永远 ≥ T4）',
    b3.player.weapons.map(w => w.id + ':T' + w.tier).join(','));

  /* 存档幂等：导出 → 导入 → 再导出，两份必须一模一样（少一个字段就会被逮住） */
  Game.setState('title', true);
  const again = Game.importRun(dump) && Game.exportRun();
  ok(JSON.stringify(again.weapons) === JSON.stringify(dump.weapons) &&
     again.combineCount === dump.combineCount,
    '导出 → 导入 → 再导出，武器与合成计数逐字一致');
  Game.setState('title', true);
}

/* ---------------- 8. 回放：combine 是会改状态的命令 ---------------- */
console.log('\n[8] 录制与回放：合成必须进带子');
{
  const recSrc = fs.readFileSync(path.join(ROOT, 'src', 'record.ts'), 'utf8');
  ok(/'combine'/.test(recSrc), 'combine 在录制命令清单里（否则回放会少一把武器、低一档）');
  ok(Rec.commands().indexOf('combine') >= 0, 'Rec.commands() 能枚举到它');
  ok(typeof Game.combine === 'function', '清单里的名字对应真的方法（persist 的清单守卫也查这条）');

  // 真录一小段：商店里合一次，回放后品级必须一样
  Game.setState('title', true);
  Rec.start();
  /* 只用**被录制的命令**来搭这一局：开局携带走 newRun 的 opening（整份参数都在带子里），
     而不是录完之后直接改 session —— 直接改状态是不可回放的，那样测出来的"回放一致"
     只是因为两边都错得一样。 */
  Game.newRun('ranger', 3131, 0, { stats: {}, weapons: ['knife', 'knife'], items: [], scrap: 300 });
  toShop();
  Game.combine(1, 2);
  const built = Game.getSession().player.weapons.map(w => w.id + ':T' + Weapons.tierOf(w)).join(',');
  const tape = Rec.stop();
  ok(built === 'pistol:T1,knife:T2', '原局：初始手枪不动，两把匕首合成一把 T2', built);
  ok(tape.events.some(e => e.cmd === 'combine'), '带子里有 combine 事件',
    tape.events.map(e => e.cmd).join(','));

  Game.setState('title', true);
  Game.newRun('ranger', 9999, 0, null);
  Rec.play(tape, (x, y) => {
    if (Scenex.simulates(Game.state)) Game.step(Game.cfg.fixedDt, { x: x, y: y });
    globalThis.Input.endFrame();
  });
  const replayed = Game.getSession().player.weapons.map(w => w.id + ':T' + Weapons.tierOf(w)).join(',');
  ok(replayed === built, '回放出来的武器与品级与原局一致（' + built + '）', replayed);
  ok(Game.getSession().combineCount === 1, '合成次数也复现', Game.getSession().combineCount);
  Game.setState('title', true);
}

/* ---------------- 9. 界面契约 ---------------- */
console.log('\n[9] 界面：动作与品级一眼可见');
{
  const acts = new Set(UIx.actNames());
  ok(acts.has('combine') && acts.has('salvage'), '合成 / 回收两个动作都接上了处理分支',
    [...acts].filter(a => /combin|salv/.test(a)).join(','));
  /* 这两个动作**不换屏**（它们是商店里的小动作），所以按项目的分组规则，
     它们必须住在某一张 ACT_* 表里（"去某个界面"那类才住 scene.ts 的 SCREEN_ACTS）。 */
  const groups = UIx.actGroups();
  const inShop = (groups.shop || []).indexOf('combine') >= 0 && (groups.shop || []).indexOf('salvage') >= 0;
  ok(inShop, '两个动作都归在商店那一组里（不换屏的动作要归组，ui-check 的 [1d] 查这条）',
    Object.keys(groups).map(k => k + ':' + groups[k].length).join(' '));
  ok(!Scenex.screenActOf('combine') && !Scenex.screenActOf('salvage'),
    '它们**不是**换屏动作（合成 / 回收留在商店，不该被当成"去某个界面"）');

  const uiSrc = fs.readFileSync(path.join(ROOT, 'src', 'ui.ts'), 'utf8');
  ok(/dataset\.act = 'combine'/.test(uiSrc) && /dataset\.act = 'salvage'/.test(uiSrc),
    '武器卡片上真的画了这两个按钮（data-act 字面量，ui-check 的契约靠它对上）');
  ok(/'合成：'/.test(uiSrc), '合成有明确的提示语（"发生了什么"要看得见）');
  ok(/U\.el\('i', 'pip ' \+ Tiers\.clsOf\(/.test(uiSrc),
    '武器条上有品级角标（战斗里也看得出品级），颜色类来自品级表而不是字面量');
  ok(/Weapons\.mul\(w, 'dmg'\)/.test(uiSrc), '卡片上显示的是**折算后**的伤害（否则 T4 匕首写着"伤害 4"）');

  /* 数值出口只有一处：三处读武器数值的地方都必须过台阶。
     静态检查（与 camp.mjs 的"效果键必须有人读"同一个套路）：
     漏掉任何一处，"合成变强了"就只是界面上的话。 */
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const gameSrc = strip(fs.readFileSync(path.join(ROOT, 'src', 'game.ts'), 'utf8'));
  const needed = ["Weapons.mul(w, 'dmg')", "Weapons.mul(w, 'cd')", "Weapons.mul(w, 'reach')", "Weapons.mul(w, 'knock')"];
  const missing = needed.filter(s => gameSrc.indexOf(s) < 0);
  ok(missing.length === 0, '伤害 / 冷却 / 射程 / 击退四处都乘了品级台阶', missing.join(','));
  ok(gameSrc.indexOf('w.dup') < 0, '旧字段 w.dup（同名多打一发）已经彻底删掉 —— 那个位置归合成');
  const compSrc = fs.readFileSync(path.join(ROOT, 'src', 'comp.ts'), 'utf8');
  ok(/WeaponCore'[^)]*tier/.test(compSrc), 'WeaponCore 声明了 tier（组件校验不会把它当游离字段）');
  ok(/WeaponCore'[^)]*dup/.test(compSrc) === false, 'WeaponCore 里不再有 dup');
}

/* ---------------- 10. 多发弹丸（"子弹分叉"的唯一来源） ----------------
   "子弹会分叉"在代码里只有一个来源：**一次扣板机产出多于一发**。只有两种可能：
     · 武器自己声明了 `shots`（霰弹枪 5 发 / 变异手枪 2 发）
     · 身上有道具「克隆装置」（`special: extraProjectile`，+1 发）
   两把武器各打各的**不算** —— 那是两个枪口。
   这一节把"每次开火到底出几发"钉住：它既是"分叉"的唯一解释，
   也是"宝箱房静默给出一件改变手感的装备"这条反馈缺口的另一半。 */
console.log('\n[10] 多发弹丸：一次开火出几发、散开多少度');
{
  /** 只取"刚扣完板机那一帧"的弹丸（玩家与木桩都钉住，排除走位干扰） */
  function shotBullets(wid, itemIds) {
    Game.setState('title', true);
    Game.newRun('ranger', 4242, 0, { stats: {}, weapons: [], items: [], scrap: 0 });
    const s = Game.getSession();
    holdRoom(s);
    enterFightRoom(s);
    Game._internals.startWave(Game.wave + 1);
    const p = s.player;
    p.weapons.length = 0;
    Game.addWeapon(wid);
    for (const id of itemIds || []) p.items.push(Comp.spawn('item', { def: Items.BY_ID[id] }));
    Game.recalcStats();
    const e = Game._internals.spawnEnemy('grub', p.x + 260, p.y, {});
    e.hp = e.maxHp = 1e9; e.speed = 0; e.dmg = 0;
    const px = p.x, py = p.y;
    for (let i = 0; i < 600; i++) {
      p.x = px; p.y = py; e.x = px + 260; e.y = py;
      const before = s.shots || 0;
      Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });
      if ((s.shots || 0) > before) return { list: s.bullets.slice(), aim: p.aim };
    }
    return { list: [], aim: 0 };
  }
  const count = (wid, items) => shotBullets(wid, items).list.length;

  const ranged = Weapons.LIST.filter(w => w.type === 'ranged');
  const wrong = [];
  for (const w of ranged) {
    const n = count(w.id);
    const want = w.shots || 1;
    if (n !== want) wrong.push(w.id + ' 声明 ' + want + ' 实测 ' + n);
  }
  ok(wrong.length === 0, ranged.length + ' 把远程武器：一次开火 = 它声明的发数', wrong.join(', '));
  ok(count('pistol') === 1 && count('pistol', ['duplicator']) === 2,
    '手枪 1 发 → 带「克隆装置」2 发（这就是"分叉"）');
  ok(count('shotgun', ['duplicator']) === 6, '霰弹枪 5 发 → 带克隆装置 6 发',
    String(count('shotgun', ['duplicator'])));

  const specials = Items.LIST.filter(d => d.special === 'extraProjectile');
  ok(specials.length === 1 && specials[0].id === 'duplicator',
    '全游戏只有「克隆装置」一件加弹丸数的道具', specials.map(d => d.name).join(','));

  /* 张角：以**瞄准方向**为正中对称散开，总张角 = 2 × 声明值
     （`spread` 是半角，fire() 里那一处 ×2 不是笔误）。
     角度要按圆形量：扇形跨过 ±180° 时 naive 的 max−min 会得到 345° 这种假值。 */
  function cone(wid, items) {
    const r = shotBullets(wid, items);
    let sx = 0, sy = 0;
    for (const b of r.list) { sx += b.vx; sy += b.vy; }
    const c = Math.atan2(sy, sx);                       // 圆形平均角 = 扇形的中心
    const norm = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
    const rel = r.list.map(b => norm(Math.atan2(b.vy, b.vx) - c) * 180 / Math.PI);
    return {
      total: rel.length > 1 ? Math.max(...rel) - Math.min(...rel) : 0,
      offAim: norm(c - r.aim) * 180 / Math.PI             // 扇形中心与瞄准方向的夹角
    };
  }
  const sg = cone('shotgun');
  const sh = Weapons.BY_ID.shotgun;
  ok(Math.abs(sg.total - 2 * sh.spread) < 1.5,
    '霰弹枪张角 = 2 × 声明的 ' + sh.spread + '°（实测 ' + sg.total.toFixed(1) + '°）',
    sg.total.toFixed(1) + '°');
  ok(Math.abs(sg.offAim) < 0.6, '扇形以瞄准方向为中心（不是偏在一侧）', sg.offAim.toFixed(2) + '°');
  /* 没声明 spread 的武器靠"±0.06 弧度"的那条兜底散开 —— 这就是手枪带克隆装置时
     那 6.9° 的来源：单发时看不见，变成两发就看得出来。 */
  const dup = cone('pistol', ['duplicator']);
  ok(Math.abs(dup.total - 6.9) < 0.5 && Math.abs(dup.offAim) < 0.6,
    '手枪 + 克隆装置：张角 6.9°（没声明 spread 的兜底值），居中 ' + dup.offAim.toFixed(2) + '°',
    dup.total.toFixed(1) + '° / ' + dup.offAim.toFixed(2) + '°');
}

console.log('\n=== 结果 ===');
if (failures === 0) { console.log('\x1b[32m全部通过 ✔\x1b[0m\n'); process.exit(0); }
console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m\n');
process.exit(1);
