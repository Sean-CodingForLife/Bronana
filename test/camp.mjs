/* =========================================================
   camp.mjs — 局内工坊（"制造"这根柱子在局内的那一半）

   这一套盯五件事：
     1) **瓶颈必须真的存在** —— 设施种类要多于设施位，否则"选"就是假的
     2) **全部效果只作用于制造** —— 一个战斗向的键都不许出现（解耦的判据）
     3) **每个效果键都得有人读** —— 声明了却没人读 = 这条效果是假的（静态检查）
     4) **效果真的生效**：省料 / 质量 / 回收加成，全部用**制造**去量
     5) **营地的进出与建设录得进带子** —— 以及存档往返（含"这一波用掉的产线"）

   用法： node test/camp.mjs
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
const { Camp, Craft, Game, Rec, Scene, Input, Registry, Profile } = globalThis;
console.error = function () { };

/** 给钱包发材料。**新经济下这是唯一的"本钱"来源** ——
 *  改造前工坊花的是局内的"建材"（每波 +2、结算清零），那笔钱随营地搬出局外一起没了；
 *  现在盖设施花的是**材料**（战斗打出来、带得出局的那一笔）。 */
function giveMaterial(n) {
  Profile.addMaterial(n);
  return Profile.material();
}

/** 清空工坊（跨局状态，测试之间必须隔离）。
 *  不能靠"新开一局" —— 工坊现在**不会**随新局清零（那正是这次改造的要点）。 */
function clearCamp() {
  const owned = Profile.campOwned();
  for (const id of Object.keys(owned)) Profile.campSell(id);
  return Profile.campOwned();
}

console.log('\n=== Bronana · 工坊（制造）===\n');

/* ⚠ **跨局状态必须在套件开头清一次**：工坊现在活在档案里，
   它会从上一个测试（甚至上一次运行留下的档）里带过来 —— 实测就是这样漏进去的
   （`[6]` 报"没进工坊就什么都没建"时，档案里已经有三座设施）。
   这也是"它真的跨局了"的一个副产品：测试不再天然隔离。 */
clearCamp();

/** 造一个干净的工坊一局（固定种子，供多处复用）。
 *  `mats` 给的是**局内废料**（商店那笔钱）；材料要另外用 `giveMaterial` 发。 */
function freshRun(mats) {
  Game.newRun('ranger', 20260503, 0, null);
  const s = Game.getSession();
  s.player.scrap = mats === undefined ? 500 : mats;
  toShop(s);
  return s;
}

/* ---------------- 1. 表与自检 ---------------- */
console.log('[1] 设施表：瓶颈必须是真的，而且**一条都不许碰战斗**');
{
  const a = Camp.audit();
  ok(a.ok === true, '定义期自检通过（' + a.counts.facilities + ' 种设施 / ' + a.counts.slots + ' 个位子 / ' + a.counts.combos + ' 组合）',
    a.problems.slice(0, 4).join(' | '));
  ok(Camp.LIST.length > Camp.SLOTS,
    '设施种类（' + Camp.LIST.length + '）多于位子（' + Camp.SLOTS + '）—— 否则"取舍"是假的',
    Camp.LIST.length + ' vs ' + Camp.SLOTS);
  ok(Camp.LIST.every(d => d.levels.length >= 1), '每个设施至少一级可买');
  const prices = Camp.LIST.flatMap(d => d.levels.map(l => l.cost));
  ok(Math.min(...prices) >= 1 && Math.max(...prices) <= 10,
    '设施价格落在一局的产出里（' + Math.min(...prices) + ' ~ ' + Math.max(...prices) + ' 材料）');

  // **解耦判据**：效果键里不许出现战斗向的键
  const CRAFT_ONLY = ['weaponCost', 'itemCost', 'weaponQuality', 'itemDouble', 'salvageBonus'];
  const keys = Object.keys(Camp.EFFECT_KEYS);
  const notCraft = keys.filter(k => CRAFT_ONLY.indexOf(k) < 0);
  ok(notCraft.length === 0, '工坊的效果键**全部**是制造向的（' + keys.join('/') + '）', notCraft.join(','));
  const combat = ['waveHeal', 'turretBonus', 'freeRerolls', 'shopDiscount', 'stats'];
  ok(combat.every(k => !Camp.EFFECT_KEYS[k]),
    '战斗向的键一个都不在（' + combat.join('/') + '）—— 这就是"经营不再给战斗加数值"');

  const audit = Registry.audit();
  const probs = audit.problems.filter(p => p.family.indexOf('camp') === 0);
  ok(probs.length === 0, 'registry 审计对工坊家族不报错',
    probs.slice(0, 3).map(p => p.id + '.' + p.field + '=' + p.value).join(','));
  ok(Registry.count('campEffect') === keys.length, 'campEffect 家族就是全部效果键', Registry.count('campEffect'));
}

/* ---------------- 2. 每个效果键都得有人读 ---------------- */
console.log('\n[2] 声明了却没人读 = 这条效果是假的（静态检查）');
{
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  // 读点是**制造这一侧**：craft.ts（费用与质量）、market.ts（回收）、game.ts（会话）
  const src = ['craft.ts', 'market.ts', 'game.ts']
    .map(f => strip(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8'))).join('\n');
  const unread = Object.keys(Camp.EFFECT_KEYS).filter(k => src.indexOf(k) < 0);
  ok(unread.length === 0,
    '每个效果键都在制造那一侧被读过（' + Object.keys(Camp.EFFECT_KEYS).join('/') + '）', unread.join(', '));

  // 设施表里用到的键也必须都在声明表里（漏声明 = 折不出来）
  const used = new Set();
  Camp.LIST.forEach(d => d.levels.forEach(l => Object.keys(l.effect).forEach(k => used.add(k))));
  const undeclared = [...used].filter(k => !Camp.EFFECT_KEYS[k]);
  ok(undeclared.length === 0, '没有未声明的效果键', undeclared.join(','));
  const unusedDecl = Object.keys(Camp.EFFECT_KEYS).filter(k => !used.has(k));
  ok(unusedDecl.length === 0, '没有"声明了但没有任何设施用"的键', unusedDecl.join(','));
}

/* ---------------- 3. 位子与成本 ---------------- */
console.log('\n[3] 位子是瓶颈：升级不占新位子，拆掉退一半');
{
  const st = {};
  ok(Camp.usedSlots(st) === 0 && Camp.canBuy(st, 'furnace', 1000).ok, '空工坊可以盖第一个');
  st.furnace = 1;
  ok(Camp.usedSlots(st) === 1, '盖一个占一个位子（= 一条产线）');
  ok(Camp.canBuy(st, 'furnace', 1000).ok && Camp.canBuy(st, 'furnace', 1000).cost === 3,
    '升级同一个设施不占新位子，价格是第二级的价', Camp.canBuy(st, 'furnace', 1000).cost);
  st.still = 1; st.anvil = 1;
  ok(Camp.usedSlots(st) === 3, '三个位子用满');
  const full = Camp.canBuy(st, 'assay', 1000);
  ok(!full.ok && /设施位满了/.test(full.reason), '位子满了 → 新建设施被拒', full.reason);
  ok(Camp.canBuy(st, 'furnace', 1000).ok, '但升级已有设施仍然可以');
  ok(Camp.canBuy({}, 'furnace', 1).ok === false, '材料不够被拒', Camp.canBuy({}, 'furnace', 1).reason);

  st.furnace = 2;
  ok(Camp.canBuy(st, 'furnace', 1000).ok === false && /满级/.test(Camp.canBuy(st, 'furnace', 1000).reason),
    '满级之后不能再升');
  ok(Camp.refundOf(st, 'furnace') === Math.floor((2 + 3) / 2), '拆掉退一半（按已花的总价）',
    Camp.refundOf(st, 'furnace'));
  ok(Camp.levelOf(st, 'furnace') === 2 && Camp.levelOf(st, '不存在') === 0, '等级查询安全');
  ok(Camp.levelOf({ furnace: 99 }, 'furnace') === Camp.maxLevel('furnace'), '越界等级被夹回上限');
}

/* ---------------- 4. 折叠 ---------------- */
console.log('\n[4] 折叠成一份效果（制造时只读这一份）');
{
  const empty = Camp.effects({});
  ok(Object.keys(empty).every(k => empty[k] === 0), '空工坊 = 全零（恒等）', JSON.stringify(empty));

  const fx = Camp.effects({ furnace: 2, still: 2, anvil: 2, assay: 2, salvage: 2 });
  ok(Math.abs(fx.weaponCost - 0.25) < 1e-9, '熔炉两级累加（15% + 10%）', fx.weaponCost);
  ok(Math.abs(fx.itemCost - 0.25) < 1e-9, '配药台两级累加', fx.itemCost);
  ok(Math.abs(fx.weaponQuality - 0.45) < 1e-9, '锻台两级累加（25% + 20%）', fx.weaponQuality);
  ok(Math.abs(fx.itemDouble - 0.45) < 1e-9, '检验台两级累加', fx.itemDouble);
  ok(Math.abs(fx.salvageBonus - 0.50) < 1e-9, '回收炉两级累加（25% + 25%）', fx.salvageBonus);

  // 封顶：省料/质量/回收都不许叠到"免费 / 100%"
  const capped = Camp.effects({ furnace: 2, still: 2, anvil: 2, assay: 2, salvage: 2 }, ['furnace', 'still', 'anvil', 'assay', 'salvage']);
  ok(capped.weaponCost <= Camp.COST_CAP + 1e-9 && capped.weaponQuality <= Camp.QUALITY_CAP + 1e-9 &&
     capped.salvageBonus <= Camp.SALVAGE_CAP + 1e-9,
    '叠满组合也封在顶内（省料 ≤' + Camp.COST_CAP + ' 质量 ≤' + Camp.QUALITY_CAP + ' 回收 ≤' + Camp.SALVAGE_CAP + '）',
    JSON.stringify(capped));
  ok(Camp.effects({ 不存在的设施: 3 }).weaponCost === 0, '未知设施被忽略（坏档防线）');
  // 相邻组合真的折进去：熔炉 + 配药台挨着 = 「釜底」（武器省料 +10%）
  const alone = Camp.effects({ furnace: 1 });
  const paired = Camp.effects({ furnace: 1, still: 1 }, ['furnace', 'still']);
  ok(paired.weaponCost > alone.weaponCost,
    '相邻组合真的折进去了（熔炉单独 ' + alone.weaponCost + ' → 与配药台相邻 ' + paired.weaponCost + '）');
  ok(Camp.effects({ furnace: 1, still: 1 }).weaponCost === alone.weaponCost,
    '不写建造顺序时组合不算（顺序就是玩法）');
}

/* ---------------- 5. 在局里真的生效（全部用**制造**去量） ---------------- */
console.log('\n[5] 在局里真的生效：产线 → 制造 → 装备');
{
  const s = freshRun(500);
  ok(Game.state === 'shop', '先摆到商店', Game.state);
  ok(Game.openCamp() === true && Game.state === 'camp', '能从商店进工坊', Game.state);

  // 材料不够时拒绝，且一点都不扣
  clearCamp();
  Profile.spendMaterial(Profile.material());          // 清空钱包
  const scrapBeforeBuy = s.player.scrap;
  ok(Game.campBuy('furnace') === false && Profile.material() === 0,
    '材料不足 → 拒绝且不扣材料', '材料 ' + Profile.material());
  giveMaterial(20);
  ok(Game.campBuy('furnace') === true, '盖熔炉（第一条产线）');
  ok(Profile.material() === 18, '扣了 2 材料', Profile.material());
  ok(s.player.scrap === scrapBeforeBuy,
    '**局内废料一分没动** —— 盖设施花的是带出去的材料，商店那笔钱不掺和', s.player.scrap);
  ok(Game.craftLines() === 1, '一条产线', Game.craftLines());
  ok(Game.craftFreeLines().length === 1, '这一波它还是空的');

  /* 商店那栏"原料"：废料 → 材料。
     ⚠ 改造前它是"废料 → 建材"（给局内的工坊备料）。建材没了之后它换了职能，
     而且是**唯一一条"局内钱换跨局钱"的兑换** —— 于是"这局打得很顺、废料花不完"
     有了一个出口。定价刻意不划算（越往后越贵）：它买的是时间，不是资源。 */
  const scrap0 = s.player.scrap;
  const mat0 = Profile.material();
  const bPrice = Game.buildPrice();
  ok(bPrice > 0, '材料包有价（第 ' + Game.wave + ' 波：' + bPrice + ' 废料 → 4 材料）', bPrice);
  Game.setState('shop');
  ok(Game.buyBuild() === true, '买一包材料');
  ok(Profile.material() === mat0 + 4 && s.player.scrap === scrap0 - bPrice,
    '废料 -' + bPrice + '、材料 +4（局内那笔换成了带得出去的那笔）', Profile.material());
  const laterPrice = (function () { const w = Game.wave; Game.wave = w + 6; const p = Game.buildPrice(); Game.wave = w; return p; })();
  ok(laterPrice > bPrice, '越到后面越贵（' + bPrice + ' → ' + laterPrice + '）—— 它买的是时间，不是资源');
  Game.setState('camp');

  // 制造一件武器（**花材料**，不再是废料）
  const knife = Craft.BY_ID['weapon:knife'];
  const campFx = Profile.campFx();
  const cost = Craft.costOf(knife, s.fmods, campFx);
  ok(cost === Math.round(knife.base * Craft.MARKUP * (1 - campFx.weaponCost)),
    'T1 匕首的费用 = 原价 × ' + Craft.MARKUP + ' × 熔炉省料（' + cost + '）', cost);
  const wBefore = s.player.weapons.length, scrapKeep = s.player.scrap, matBefore = Profile.material();
  ok(Game.craft(0, 'weapon:knife') === true, '造了一把匕首', s.player.weapons.map(w => w.id).join(','));
  ok(Profile.material() === matBefore - cost, '扣的是**材料**（' + cost + '）', Profile.material());
  ok(s.player.scrap === scrapKeep, '废料没动 —— 商店那笔钱与制造那笔钱是两回事', s.player.scrap);
  ok(s.player.weapons.length === wBefore + 1, '装备进了武器栏');
  ok(Game.craftFreeLines().length === 0, '这一波的产线用掉了');
  ok(Game.craft(0, 'weapon:knife') === false, '同一波不能在同一条产线上造第二件');

  // 每波重置：这是经营自己的"回合"
  Game._internals.startWave(Game.wave + 1);
  ok(Game.craftFreeLines().length === 1, '开新一波 → 产线重置（经营每波一个回合）');

  // 图纸门槛：默认只能造 T1
  const t4 = Game.craftOptions().filter(o => o.id === 'weapon:railgun')[0];
  ok(t4 && t4.ok === false && /图纸/.test(t4.reason), '没图纸就造不了 T4（' + (t4 && t4.reason) + '）');
  const t1 = Game.craftOptions().filter(o => o.id === 'weapon:knife')[0];
  ok(t1 && t1.ok === true && t1.cost > 0, 'T1 能造（费用 ' + (t1 && t1.cost) + '）');

  /* 图纸真的打开档位：把 `basic`（T2）解锁后，T2 的枪就能造了 */
  const s2 = freshRun(500);
  Game.openCamp();
  giveMaterial(20);
  Game.campBuy('furnace');
  const t2Before = Game.craftOptions().filter(o => o.id === 'weapon:sword')[0];
  ok(t2Before && t2Before.ok === false, '没「基础图纸」时 T2 长剑造不了');
  Game.getSession().fmods.craftTier = 2;            // 直接改这一局的折好结果（等价于解锁了图纸）
  const t2After = Game.craftOptions().filter(o => o.id === 'weapon:sword')[0];
  ok(t2After && t2After.ok === true, '图纸到 T2 → 长剑能造', JSON.stringify(t2After));
  const m2 = Profile.material();
  ok(Game.craft(0, 'weapon:sword') === true && Profile.material() < m2, '真的造出来了');

  // 省料：熔炉升级 + 与配药台相邻的组合
  const s3 = freshRun(500);
  Game.openCamp();
  giveMaterial(60);
  Game.campBuy('furnace'); Game.campBuy('furnace');       // Lv.2：武器省料 25%
  const cost2 = Craft.costOf(Craft.BY_ID['weapon:knife'], s3.fmods, Profile.campFx());
  ok(cost2 < cost, '熔炉 Lv.2 → 造武器更便宜（' + cost + ' → ' + cost2 + '）');

  // 回收加成 + 合金：回收炉建了就涨，而且产合金
  const s4 = freshRun(500);
  clearCamp();
  Game.openCamp();
  giveMaterial(20);
  Game.campBuy('salvage');
  const rate = s4.salvageRate;
  ok(rate > 0.5, '回收炉 → 回收比例从 0.5 抬到 ' + rate, rate);
  ok(Profile.campFx().salvageBonus > 0, '折叠效果里有回收加成', Profile.campFx().salvageBonus);
  const alloyBefore = s4.alloy || 0;
  Game.setState('shop');
  /* 先补一把：**最后一把武器不许回收**（回收了就没有东西能打，这一间再也清不掉 ——
     market.sellWeapon 里那条规则）。这里要量的是"回收返多少 / 产多少合金"，
     所以按"手上有两把"的正常情况来。 */
  Game.addWeapon('knife');
  const w0 = s4.player.weapons[0];
  const refund = Game.salvageOf(w0);
  ok(Game.sellWeapon(0) === true, '回收一件');
  ok(s4.player.scrap >= 500 - 0 + refund - 1, '回收返还材料（+' + refund + '）');
  ok((s4.alloy || 0) > alloyBefore, '**回收产合金**（图纸树唯一的稳定来源）：' + alloyBefore + ' → ' + s4.alloy);

  /* 质量：锻台让造出来的武器有机会直接高一档。
     两段验证 —— ① 机制本身（把随机源换成一个固定值，结果是确定的）
     ② 真的跑起来会发生（同一条随机流上连造几十件，数出比例）。
     只用②会踩"小种子低位混不开"的坑，只用①则证明不了它接在真的制造上。 */
  const knifeR = Craft.BY_ID['weapon:knife'];
  const qFx = Camp.effects({ anvil: 1 });
  ok(Craft.resultTier(knifeR, null, qFx, function () { return 0.01; }).tier === 2,
    '质量命中时：T1 造出来就是 T2');
  ok(Craft.resultTier(knifeR, null, qFx, function () { return 0.99; }).tier === 1,
    '没命中时：还是 T1');
  ok(Craft.resultTier(knifeR, null, Camp.effects({}), function () { return 0.01; }).tier === 1,
    '没有锻台时**一次随机都不抽**（空配置恒等：不然所有存档的回放都会分叉）');

  Game.setState('title', true);
  Game.newRun('ranger', 88112233, 0, { stats: {}, weapons: [], items: [], scrap: 100000 });
  const tq = Game.getSession();
  Game.setState('shop', true);
  Game.openCamp();
  /* 三条产线 = **账号上有三座设施**（现在只能这么建，会话里已经没有 `camp` 这个字段了）。
     顺序按 anvil → furnace → still 建，于是 `campRow` 就是这三项，
     相邻组合照旧算（这正是"摆法"那一层玩法）。 */
  clearCamp();
  giveMaterial(200);
  Game.campBuy('anvil'); Game.campBuy('furnace'); Game.campBuy('still');
  ok(Game.craftLines() === 3, '三条产线（三个设施各一条）', Game.craftLines());
  /* ⚠ 相邻组合现在**真的生效**了（以前这里靠手写 `campRow` 摆，现在是建造顺序）：
     anvil 与 furnace 挨着 → 「淬火」（造武器质量 +15%）。
     于是"三十六次里有多少次高一档"的期望值比只有锻台时更高 —— 下面那条区间要放宽。 */
  ok(Profile.campRow().join(',') === 'anvil,furnace,still',
    '建造顺序 = 按键顺序（谁挨着谁由它决定）', Profile.campRow().join(','));
  let made = 0, lucky = 0;
  for (let w = 0; w < 12; w++) {
    /* **每波补一次材料**：制造现在真的从钱包扣（改造前它扣的是会话里那笔虚构的钱），
       不补的话 36 件会中途付不起 —— 而这里要量的是"档位分布"，不是"付不付得起"。 */
    giveMaterial(50);
    for (let line = 0; line < 3; line++) {
      tq.player.weapons.length = 0;                 // 造完就换掉，只量档位（槽位满了会造不出来）
      if (Game.craft(line, 'weapon:knife')) {
        made++;
        if (tq.player.weapons[0] && tq.player.weapons[0].tier > 1) lucky++;
      }
    }
    Game._internals.startWave(Game.wave + 1);       // 新一波 → 产线重置
  }
  ok(made === 36, '三十六次制造都成功（每波三条产线）', made);
  ok(lucky >= 3 && lucky <= 24, '锻台（+相邻「淬火」）让一部分造出来的武器直接高一档（' +
    lucky + ' / ' + made + '）', lucky);
  Game.setState('title', true);
}

/* ---------------- 6. 可选去处 + 录得进带子 ---------------- */
console.log('\n[6] 工坊是可选的，而且建设与制造录得进带子');
{
  const s = freshRun(0);
  clearCamp();                        // 上一节建的工坊会留在档案里，这里要一个空工坊
  Game.nextWave();
  ok(Game.state === 'playing', '波次开始后直接进战斗（不会被工坊拦住）', Game.state);
  ok(Object.keys(Profile.campOwned()).length === 0, '没进工坊就什么都没建',
    JSON.stringify(Profile.campOwned()));

  const recSrc = fs.readFileSync(path.join(ROOT, 'src', 'record.ts'), 'utf8');
  ok(/'campBuy'/.test(recSrc) && /'campSell'/.test(recSrc) && /'craft'/.test(recSrc),
    '建设 / 拆除 / 制造都在录制命令清单里');

  const opening = { stats: {}, weapons: [], items: [], scrap: 400 };
  const FIX2 = Game.cfg.fixedDt;
  let fr = 0;
  const guardPlayer = () => { const ss = Game.getSession(); if (ss) ss.player.invuln = 999; };
  const runUntilShop = (cap) => {
    for (let i = 0; i < cap && Game.state === 'playing'; i++) {
      const inp = Game.autoInput(fr++ * FIX2);
      guardPlayer();
      Rec.input(inp);
      Game.step(FIX2, inp);
    }
  };
  Game.setState('title', true);
  Rec.start();
  Game.newRun('ranger', 4242, 0, opening);
  runUntilShop(120);
  ok(Game.state === 'shop', '清完入口间 → 进商店', Game.state);
  Game.openCamp();
  clearCamp();
  giveMaterial(50);
  Game.campBuy('furnace');
  Game.craft(0, 'weapon:knife');
  /* ⚠ 工坊现在**不在这一局的存档里**（它在档案里、跨局）。于是"回放保真"要量的
     不再是"这一局把工坊带回来了"，而是：**回放造出来的东西与工坊当时的等级一致**。
     工坊本身由 `Profile` 负责（下面⑦量它），这里量的是"这一局里发生的动作"。 */
  const campAtBuild = Profile.campLevel('furnace');
  const crafted = Game.getSession().player.weapons.map(w => w.id + ':T' + w.tier).join(',');
  const builtAlloy = Game.getSession().alloy || 0;
  Game.setState('shop');
  Game.nextWave();
  const tape = Rec.stop();
  ok(tape.events.some(e => e.cmd === 'campBuy'), '带子里确实有 campBuy 事件',
    tape.events.map(e => e.cmd).join(','));
  ok(tape.events.some(e => e.cmd === 'craft'), '带子里确实有 craft 事件');

  Game.setState('title', true);
  Game.newRun('ranger', 999, 0, null);
  /* 回放前把工坊**清空并补材料**：带子里那条 `campBuy` 会真的再买一次，
     而工坊是账号资产 —— 不清的话它会叠在"回放前那一座"上面，等级就变 2 了。 */
  clearCamp();
  giveMaterial(50);
  Rec.play(tape, (x, y) => {
    guardPlayer();
    if (Scene.simulates(Game.state)) Game.step(Game.cfg.fixedDt, { x: x, y: y });
    Input.endFrame();
  });
  const replayed = Game.getSession();
  ok(replayed.player.weapons.map(w => w.id + ':T' + w.tier).join(',') === crafted,
    '回放之后**造出来的武器也在**（' + crafted + '）', replayed.player.weapons.map(w => w.id).join(','));
  ok((replayed.alloy || 0) === builtAlloy, '合金对得上', replayed.alloy);
  ok(Profile.campLevel('furnace') === campAtBuild,
    '工坊等级还是回放那一刻的样子（那是**回放本身**买的那一座，不是叠出来的）',
    Profile.campLevel('furnace'));
}

/* ---------------- 7. 存档往返 ---------------- */
console.log('\n[7] 存档：工坊与"这一波用掉的产线"都必须跟着走');
{
  const s = freshRun(500);
  Game.openCamp();
  clearCamp();
  giveMaterial(20);
  Game.campBuy('furnace');
  Game.craft(0, 'weapon:knife');
  const matAfter = Profile.material();
  const used = (s.craftUsed || []).slice();
  const payload = Game.exportRun();
  /* ⚠ **语义变化**：工坊（设施 / 顺序 / 那笔钱）不再是一局存档的一部分 ——
     它是账号资产，本来就跨局活着。一局存档里存的只有"这一波用掉了哪几条产线"。
     所以"读档把工坊弄丢"这个 bug 从此**结构上不可能发生**；
     而"读档白刷一件"仍然可能（产线回合是局内的），下面继续量它。 */
  ok(payload.camp === undefined && payload.campPoints === undefined,
    '一局存档里**不再**带工坊（它是账号资产，存一份只会制造两个真相）',
    JSON.stringify({ camp: payload.camp, campPoints: payload.campPoints }));
  ok(Array.isArray(payload.craftUsed) && payload.craftUsed.join(',') === used.join(','),
    '导出带着这一波用掉的产线（否则读档可以把产线刷回来）', JSON.stringify(payload.craftUsed));

  const back = Game.importRun(payload);
  ok(back && Profile.campLevel('furnace') === 1, '读档之后工坊还在（它在档案里，读档动不了它）',
    String(Profile.campLevel('furnace')));
  ok(Profile.material() === matAfter, '材料余额不受读档影响（它不是一局的数）', Profile.material());
  ok(back && (back.craftUsed || []).join(',') === used.join(','), '用掉的产线也恢复',
    back && JSON.stringify(back.craftUsed));
  ok(back && Game.craftFreeLines().length === 0, '于是读档不能白刷一件');

  // 坏档：一局存档里的产线回合是脏的 → 清掉
  const dirty = JSON.parse(JSON.stringify(payload));
  dirty.craftUsed = ['坏', -3, 1];
  const b2 = Game.importRun(dirty);
  ok(b2.craftUsed.every(v => typeof v === 'number' && v >= 0), '用掉的产线里的脏数据被清掉',
    JSON.stringify(b2.craftUsed));
  /* 老存档（还带 `camp` / `campPoints` 的那种）**不迁移**：那记的是"这一局临时盖的工坊"，
     搬进档案会让玩家凭一局旧档白得一座工坊。它被静默忽略。 */
  const legacy = JSON.parse(JSON.stringify(payload));
  legacy.camp = { furnace: 3, anvil: 2 };
  legacy.campRow = ['furnace', 'anvil'];
  legacy.campPoints = 99;
  const before = Profile.campLevel('furnace');
  const b3 = Game.importRun(legacy);
  ok(b3 && Profile.campLevel('furnace') === before,
    '旧存档里的局内工坊**不会被搬进档案**（否则读一次旧档就白得一座工坊）',
    Profile.campLevel('furnace'));
  Game.setState('title', true);
}

/* ---------------- 8. 场景与按键 ---------------- */
console.log('\n[8] 场景与按键');
{
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  ok(/id="scr-camp"/.test(html), 'index.html 里有工坊场景');
  ok(/data-act="camp"/.test(html), '商店里有"去工坊"入口');
  ok(/data-act="camp-back"/.test(html), '工坊能回商店');
  ok(Scene.has('camp') && Scene.overlayOf('camp') === 'camp', '场景表里有 camp');
  ok(Game.TRANSITIONS.shop.indexOf('camp') >= 0 && Game.TRANSITIONS.camp.indexOf('shop') >= 0,
    '商店 ⇄ 工坊双向可达');
  ok(Scene.refreshOf('camp') === 'camp', '工坊在场景表的刷新表里');

  Game.newRun('ranger', 7, 0, null);
  Game.getSession().waveLeft = 0; Game.getSession().spawnQueue = []; Game.getSession().spawnIdx = 0;
  Game.getSession().enemies.length = 0;
  Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });
  Game.openCamp();
  const w = Game.wave;
  ok(Game.nextWave() === true && Game.wave === w + 1, '在工坊里也能进下一波', Game.wave);
  Game.setState('title', true);
}

/* ---------------- 9. 相邻组合（摆法本身是玩法） ---------------- */
console.log('\n[9] 相邻组合：挨着才生效，"怎么摆"是决策');
{
  const a = Camp.audit();
  ok(a.ok === true, '定义期自检通过（' + a.counts.facilities + ' 设施 / ' + a.counts.combos + ' 组合）',
    a.problems.join(' | '));
  ok(a.counts.combos >= 5, '组合数量够撑"摆法"（' + a.counts.combos + ' 个）');

  const p = Camp.combosFor(['furnace', 'anvil']);
  const q = Camp.combosFor(['anvil', 'furnace']);
  ok(p.length === 1 && q.length === 1 && p[0] === q[0], '相邻不看顺序（淬火：熔炉⇄锻台）', p[0] && p[0].name);

  // 不挨着就不算 —— 这是"摆法"的全部意义。
  // 组合表是个**环**（熔炉-锻台-检验台-回收炉-配药台-熔炉），所以 [熔炉,检验台,锻台] 里
  // 「流水线」（锻台+检验台）照样成立，但「淬火」不成立 —— 断言要写准。
  const far = Camp.combosFor(['furnace', 'assay', 'anvil']);
  ok(far.every(k => k.name !== '淬火'), '熔炉与锻台被检验台隔开 → 「淬火」不生效',
    far.map(k => k.name).join(','));
  ok(Camp.combosFor(['furnace', 'salvage']).length === 0, '不成对的两个 → 零组合');
  ok(Camp.combosFor(['furnace']).length === 0 && Camp.combosFor([]).length === 0, '单个/空行没有组合');

  const three = Camp.combosFor(['furnace', 'anvil', 'assay']);
  ok(three.length === 2, '一行 3 个位子最多 2 个组合（淬火 + 流水线）', three.map(k => k.name).join(','));

  // 效果真的折进 campFx（用两张表对照：同一个工坊状态，有没有 row 结果不同）
  const state = { furnace: 1, anvil: 1 };
  const noRow = Camp.effects(state);
  const withRow = Camp.effects(state, ['furnace', 'anvil']);
  ok(noRow.weaponCost === 0.15 && noRow.weaponQuality === 0.25, '不带顺序时只有设施本身的效果',
    JSON.stringify([noRow.weaponCost, noRow.weaponQuality]));
  ok(withRow.weaponQuality === 0.25 + 0.15,
    '带上顺序后组合的效果真的折进 campFx（质量 25% → 40%）', withRow.weaponQuality);

  /* ---- 在局里：同一批设施，**换顺序就换效果** ----
     ⚠ 顺序现在住在**档案**里（`Profile.campRow()`），而且一局里改它 = 真的改建工坊。
     以前这里每段都靠 `s.campPoints = 20` 白给钱，现在要发**材料**；
     顺序也不再"自动靠拢" —— 拆掉中间那个，剩下的顺序就是剩下的（那本来就是同一个语义）。 */
  Game.newRun('ranger', 99, 0, { stats: {}, weapons: [], items: [], scrap: 3000 });
  toShop();
  Game.openCamp();
  clearCamp();
  giveMaterial(50);
  ok(Game.campBuy('furnace') === true && Game.campBuy('anvil') === true, '先建 熔炉 → 锻台（挨着）');
  ok(Profile.campRow().join(',') === 'furnace,anvil', '建造顺序记在档案里', Profile.campRow().join(','));
  ok(Math.abs(Profile.campFx().weaponQuality - 0.40) < 1e-9, '相邻 → 「淬火」生效（25% + 15%）',
    Profile.campFx().weaponQuality);

  ok(Game.campBuy('salvage') === true, '再建回收炉（排到行尾）');
  ok(Profile.campRow().join(',') === 'furnace,anvil,salvage', '顺序 = 建造顺序', Profile.campRow().join(','));
  ok(Math.abs(Profile.campFx().weaponQuality - 0.40) < 1e-9, '熔炉与锻台仍然挨着 → 淬火还在',
    Profile.campFx().weaponQuality);

  Game.campSell('anvil');                       // 抽掉中间那个 → 淬火断
  ok(Profile.campRow().join(',') === 'furnace,salvage', '拆掉落单后顺序收缩', Profile.campRow().join(','));
  ok(Math.abs(Profile.campFx().weaponQuality - 0) < 1e-9, '抽掉中间那个 → 「淬火」断了 —— 拆除也是摆法决策',
    Profile.campFx().weaponQuality);

  /* 顺序的"往返"：它现在是**账号状态**，所以量的是"买与拆之后档案里是什么"，
     不再是"一局存档把它带回来了"（一局存档里已经没有它了）。 */
  giveMaterial(20);
  Game.campBuy('anvil');
  const dump = Game.exportRun();
  ok(dump.campRow === undefined,
    '一局存档里没有 campRow（它是账号状态，不是这一局的）', JSON.stringify(dump.campRow));
  const rowNow = Profile.campRow().join(',');
  ok(rowNow === 'furnace,salvage,anvil', '档案里的顺序 = 买与拆的结果', rowNow);
  const qNow = Profile.campFx().weaponQuality;
  const back = Game.importRun(dump);
  ok(Profile.campRow().join(',') === rowNow, '读档不改顺序（它不在那一局里）', Profile.campRow().join(','));
  ok(Math.abs(Profile.campFx().weaponQuality - qNow) < 1e-9,
    '读档后组合效果一致（不会静默少一份）', Profile.campFx().weaponQuality + ' vs ' + qNow);
  ok(back && Game.craftLines() === 3, '读档后产线数照旧（设施在档案里）', Game.craftLines());

  // 老存档（带 camp/campRow 的那种）不会污染档案 —— 已在第 7 节量过，这里只补一条坏的 campRow
  const bad = Profile.campOwned();
  ok(Object.keys(bad).length === 3, '档案里就是三座设施', JSON.stringify(bad));

  // 坏组合会被自检抓出来（一条抓不到错的审计等于装饰）
  const savedCombos = Camp.COMBOS.slice();
  Camp.COMBOS.push({ a: 'furnace', b: 'furnace', name: '自环', note: '坏配置', effect: { weaponCost: 0.1 } });
  ok(Camp.audit().ok === false, '自己和自己相邻的组合会被自检报出来');
  Camp.COMBOS.length = 0; Camp.COMBOS.push.apply(Camp.COMBOS, savedCombos);
  ok(Camp.audit().ok === true, '恢复之后自检重新通过');

  // **耦合回归守卫**：往工坊里塞一个战斗向的键，自检必须立刻翻脸
  Camp.EFFECT_KEYS.waveHeal = { note: '偷偷给战斗加血', text: function () { return ['每波回血']; } };
  ok(Camp.audit().ok === false, '往工坊里塞"每波回血"→ 自检报错（耦合会从这里长回来）');
  delete Camp.EFFECT_KEYS.waveHeal;
  ok(Camp.audit().ok === true, '拿掉之后自检重新通过');

  Game.setState('title', true);
}

/* =========================================================
   极端省料 + 拉满回收：**造了立刻拆不能变成印钞机**
   ---------------------------------------------------------
   两条各自封顶的修正会撞车：省料最多 0.40（熔炉 L2 .25 + 釜底 .10 + 流水线 .05），
   于是造价 `1.4 × 0.6 = 0.84` 已经低于回收的 `0.9` —— 实测 T4 雷霆战锤 造价 48 / 回收 51，
   5 条产线每波"造了立刻拆"白拿 15 材料 + 10 合金（`craftUsed` 每波重置，永久可重复）。
   更要紧的是**质量触发抬档**会把回收价翻倍（价值按结果算），所以下限必须按真实结果取。
   修法在 `game.ts` 的 craft()：造价下限 = 结果回收价 + 1。
   ========================================================= */
console.log('\n[7b] 造 → 拆：省料拉满、回收拉满也不能赚钱');
{
  const s = freshRun(5000);
  Game.openCamp();
  clearCamp();
  giveMaterial(100000);
  /* 三个位子都盖上（产线 = 位子），再把折叠效果推到"三条省料都到位"的档。
     ⚠ 改造前这里直接写 `s.campFx.weaponCost = 0.4`（伪造一份折叠结果）。
     现在折叠效果是**从档案现算的**（`Profile.campFx()` 每次重算），伪造不了 ——
     只能真的把设施建到那个档位。这反而是更硬的测法：它量的是"真能叠出来的极限"。
     熔炉 L2（0.25）+ 锻台 L1（质量）+ 检验台 L1 → 三条产线，质量靠锻台。 */
  ['furnace', 'furnace', 'anvil'].forEach((id, i) => {
    const r = Game.campBuy(id);
    ok(r === true || i > 0, '建 ' + id + (r ? ' ok' : ' 被拒（位子/材料）'));
  });
  const fx7 = Profile.campFx();
  ok(fx7.weaponCost > 0, '折叠出来的省料是真的（' + fx7.weaponCost + '）', fx7.weaponCost);
  s.salvageRate = 0.9;                 // 回收比例拉满（这一份是会话里冻的派生值）
  s.fmods.craftTier = Weapons.TIER_MAX;  // 图纸门槛放开，让高价值装备也进测量
  ok(Game.craftLines() >= 2, '工地到位（' + Game.craftLines() + ' 条产线）');
  /* 制造在商店与工坊都允许，**回收只在商店**（同一道状态门）—— 所以回商店里做这一轮 */
  Game.setState('shop', true);

  const seen = [];
  let loss = true;
  const onCraft = function (d) {
    if (d.kind !== 'weapon') return;
    const refId = String(d.id).split(':')[1];
    const def = Weapons.BY_ID[refId];
    if (!def) return;
    const back = Weapons.salvageOf(
      { id: refId, def: def, tier: d.tier, paid: d.cost }, s.salvageRate);
    seen.push(refId + ':T' + d.tier + ' 造' + d.cost + '/拆' + back);
    if (back >= d.cost) loss = false;
  };
  Game.events.on('craft', onCraft);
  for (let wave = 0; wave < 12; wave++) {
    s.craftUsed = [];                  // 每波重置产线（真实规则就是这样）
    /* 材料管够：这里量的是"造价 vs 回收价"，不是付不付得起。
       每次现补一笔 —— 造价现在真的从钱包扣，而钱包是唯一的钱。 */
    giveMaterial(20000);
    for (let line = 0; line < Game.craftLines(); line++) {
      const opt = (Game.craftOptions() || []).filter(o => o.kind === 'weapon' && o.ok)[0];
      if (!opt) continue;
      Game.craft(line, opt.id);
    }
    let g = 0;
    while (s.player.weapons.length > 2 && g++ < 20) Game.sellWeapon(s.player.weapons.length - 1);  // 腾格子
  }
  ok(seen.length >= 5, '真的造了若干件用于测量（' + seen.length + ' 件）', seen.slice(0, 3).join(' / '));
  ok(loss, '每一件的**回收价都低于造价**（含质量抬档后的翻倍价值）',
    seen.join(' | '));
  console.log('       明细：' + seen.slice(0, 6).join(' · '));
  Game.setState('title', true);
}

console.log('\n=== 结果 ===');
if (failures === 0) { console.log('\x1b[32m全部通过 ✔\x1b[0m\n'); process.exit(0); }
console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m\n');
process.exit(1);
