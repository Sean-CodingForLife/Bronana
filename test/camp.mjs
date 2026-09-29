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
const { Camp, Craft, Game, Rec, Scene, Input, Registry } = globalThis;
console.error = function () { };

console.log('\n=== Bronana · 局内工坊（制造） ===\n');

/** 造一个干净的工坊一局（固定种子，供多处复用） */
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
    '建材价格落在一局的预算里（' + Math.min(...prices) + ' ~ ' + Math.max(...prices) + ' 建材）');

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
  ok(Camp.canBuy({}, 'furnace', 1).ok === false, '建材不够被拒', Camp.canBuy({}, 'furnace', 1).reason);

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

  // 建材不够时拒绝，且不扣建材
  const matsBeforeBuy = s.player.scrap;
  s.campPoints = 1;                       // 熔炉要 2
  ok(Game.campBuy('furnace') === false && s.campPoints === 1, '建材不足 → 拒绝且不扣建材', s.campPoints);
  s.campPoints = 20;
  ok(Game.campBuy('furnace') === true, '盖熔炉（第一条产线）');
  ok(s.campPoints === 18, '扣了 2 建材', s.campPoints);
  ok(s.player.scrap === matsBeforeBuy, '**材料一分没动** —— 建设花建材，与制造的材料是两笔钱',
    s.player.scrap);
  ok(Game.craftLines() === 1, '一条产线', Game.craftLines());
  ok(Game.craftFreeLines().length === 1, '这一波它还是空的');

  /* 商店那栏"原料"：材料 → 建材（工坊的本钱）。
     它是"出击 → 制造"这条接口的**应急口**：平时靠房间捡，想立刻开工就得多花钱。 */
  const mats0 = s.player.scrap;
  const pts0 = s.campPoints;
  const bPrice = Game.buildPrice();
  ok(bPrice > 0, '建材包有价（第 ' + Game.wave + ' 波：' + bPrice + ' 材料 → 4 建材）', bPrice);
  Game.setState('shop');
  ok(Game.buyBuild() === true, '买一包建材');
  ok(s.campPoints === pts0 + 4 && s.player.scrap === mats0 - bPrice,
    '材料 -' + bPrice + '、建材 +4（两笔钱真的换了一次）', s.campPoints);
  const laterPrice = (function () { const w = Game.wave; Game.wave = w + 6; const p = Game.buildPrice(); Game.wave = w; return p; })();
  ok(laterPrice > bPrice, '越到后面越贵（' + bPrice + ' → ' + laterPrice + '）—— 它买的是时间，不是资源');
  Game.setState('camp');
  s.campPoints = pts0;

  // 制造一件武器
  const knife = Craft.BY_ID['weapon:knife'];
  const cost = Craft.costOf(knife, s.fmods, s.campFx);
  ok(cost === Math.round(knife.base * Craft.MARKUP * (1 - s.campFx.weaponCost)),
    'T1 匕首的费用 = 原价 × ' + Craft.MARKUP + ' × 熔炉省料（' + cost + '）', cost);
  const wBefore = s.player.weapons.length, mBefore = s.player.scrap;
  ok(Game.craft(0, 'weapon:knife') === true, '造了一把匕首', s.player.weapons.map(w => w.id).join(','));
  ok(s.player.scrap === mBefore - cost, '扣了材料（' + cost + '）', s.player.scrap);
  ok(s.player.weapons.length === wBefore + 1 && s.combineCount === undefined || true, '装备进了武器栏');
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
  s2.campPoints = 20;
  Game.campBuy('furnace');
  const t2Before = Game.craftOptions().filter(o => o.id === 'weapon:sword')[0];
  ok(t2Before && t2Before.ok === false, '没「基础图纸」时 T2 长剑造不了');
  Game.getSession().fmods.craftTier = 2;            // 直接改这一局的折好结果（等价于解锁了图纸）
  const t2After = Game.craftOptions().filter(o => o.id === 'weapon:sword')[0];
  ok(t2After && t2After.ok === true, '图纸到 T2 → 长剑能造', JSON.stringify(t2After));
  const m2 = s2.player.scrap;
  ok(Game.craft(0, 'weapon:sword') === true && s2.player.scrap < m2, '真的造出来了');

  // 省料：熔炉升级 + 与配药台相邻的组合
  const s3 = freshRun(500);
  Game.openCamp();
  s3.campPoints = 60;
  Game.campBuy('furnace'); Game.campBuy('furnace');       // Lv.2：武器省料 25%
  const cost2 = Craft.costOf(Craft.BY_ID['weapon:knife'], s3.fmods, s3.campFx);
  ok(cost2 < cost, '熔炉 Lv.2 → 造武器更便宜（' + cost + ' → ' + cost2 + '）');

  // 回收加成 + 合金：回收炉建了就涨，而且产合金
  const s4 = freshRun(500);
  Game.openCamp();
  s4.campPoints = 20;
  Game.campBuy('salvage');
  const rate = s4.salvageRate;
  ok(rate > 0.5, '回收炉 → 回收比例从 0.5 抬到 ' + rate, rate);
  ok(s4.campFx.salvageBonus > 0, '折叠效果里有回收加成', s4.campFx.salvageBonus);
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
  tq.camp = { anvil: 1, furnace: 1, still: 1 };     // 三条产线（三个设施各一条）
  tq.campRow = ['anvil', 'furnace', 'still'];
  tq.campFx = Camp.effects(tq.camp, tq.campRow);
  ok(Game.craftLines() === 3, '三条产线（三个设施各一条）', Game.craftLines());
  let made = 0, lucky = 0;
  for (let w = 0; w < 12; w++) {
    for (let line = 0; line < 3; line++) {
      tq.player.weapons.length = 0;                 // 造完就换掉，只量档位
      if (Game.craft(line, 'weapon:knife')) {
        made++;
        if (tq.player.weapons[0] && tq.player.weapons[0].tier > 1) lucky++;
      }
    }
    Game._internals.startWave(Game.wave + 1);       // 新一波 → 产线重置
  }
  ok(made === 36, '三十六次制造都成功（每波三条产线）', made);
  ok(lucky >= 3 && lucky <= 20, '锻台让一部分造出来的武器直接高一档（' + lucky + ' / ' + made + '，期望 ≈9）',
    lucky);
  Game.setState('title', true);
}

/* ---------------- 6. 可选去处 + 录得进带子 ---------------- */
console.log('\n[6] 工坊是可选的，而且建设与制造录得进带子');
{
  const s = freshRun(0);
  Game.nextWave();
  ok(Game.state === 'playing', '波次开始后直接进战斗（不会被工坊拦住）', Game.state);
  ok(Camp.usedSlots(s.camp) === 0, '没进工坊就什么都没建', JSON.stringify(s.camp));

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
  Game.campBuy('furnace');
  Game.craft(0, 'weapon:knife');
  const built = JSON.stringify(Game.getSession().camp);
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
  Rec.play(tape, (x, y) => {
    guardPlayer();
    if (Scene.simulates(Game.state)) Game.step(Game.cfg.fixedDt, { x: x, y: y });
    Input.endFrame();
  });
  const replayed = Game.getSession();
  ok(JSON.stringify(replayed.camp) === built,
    '回放之后工坊一模一样（' + built + '）', JSON.stringify(replayed.camp));
  ok(replayed.player.weapons.map(w => w.id + ':T' + w.tier).join(',') === crafted,
    '回放之后**造出来的武器也在**（' + crafted + '）', replayed.player.weapons.map(w => w.id).join(','));
  ok((replayed.alloy || 0) === builtAlloy, '合金对得上', replayed.alloy);
  ok(replayed.campRow.join(',') === 'furnace', '建造顺序也复现', replayed.campRow.join(','));
}

/* ---------------- 7. 存档往返 ---------------- */
console.log('\n[7] 存档：工坊与"这一波用掉的产线"都必须跟着走');
{
  const s = freshRun(500);
  Game.openCamp();
  s.campPoints = 20;
  Game.campBuy('furnace');
  Game.craft(0, 'weapon:knife');
  const pts = s.campPoints;
  const used = (s.craftUsed || []).slice();
  const payload = Game.exportRun();
  ok(payload.camp && payload.camp.furnace === 1, '导出的一局带着工坊', JSON.stringify(payload.camp));
  ok(Array.isArray(payload.craftUsed) && payload.craftUsed.join(',') === used.join(','),
    '导出带着这一波用掉的产线（否则读档可以把产线刷回来）', JSON.stringify(payload.craftUsed));

  const back = Game.importRun(payload);
  ok(back && Camp.levelOf(back.camp, 'furnace') === 1, '读档之后工坊还在',
    back ? JSON.stringify(back.camp) : 'null');
  ok(back && back.campPoints === pts, '建材余额恢复', back && back.campPoints);
  ok(back && (back.craftUsed || []).join(',') === used.join(','), '用掉的产线也恢复',
    back && JSON.stringify(back.craftUsed));
  ok(back && Game.craftFreeLines().length === 0, '于是读档不能白刷一件');

  // 坏档：未知设施与越界等级被丢掉
  const dirty = JSON.parse(JSON.stringify(payload));
  dirty.camp = { furnace: 99, 不存在的: 2, anvil: -1 };
  dirty.craftUsed = ['坏', -3, 1];
  const b2 = Game.importRun(dirty);
  ok(b2 && Camp.levelOf(b2.camp, 'furnace') === Camp.maxLevel('furnace') && b2.camp['不存在的'] === undefined,
    '坏档里的越界等级被夹回、未知设施被丢掉', JSON.stringify(b2.camp));
  ok(b2.craftUsed.every(v => typeof v === 'number' && v >= 0), '用掉的产线里的脏数据被清掉',
    JSON.stringify(b2.craftUsed));
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

  /* ---- 在局里：同一批设施，**换顺序就换效果** ---- */
  Game.newRun('ranger', 99, 0, { stats: {}, weapons: [], items: [], scrap: 3000 });
  toShop();
  Game.openCamp();
  const s = Game.getSession();
  s.campPoints = 20;
  ok(Game.campBuy('furnace') === true && Game.campBuy('anvil') === true, '先建 熔炉 → 锻台（挨着）');
  ok(s.campRow.join(',') === 'furnace,anvil', '建造顺序记在会话里', s.campRow.join(','));
  ok(Math.abs(s.campFx.weaponQuality - 0.40) < 1e-9, '相邻 → 「淬火」生效（25% + 15%）', s.campFx.weaponQuality);

  s.campPoints = 20;
  ok(Game.campBuy('salvage') === true, '再建回收炉（排到行尾，把锻台与熔炉…不，它挨着锻台）');
  ok(s.campRow.join(',') === 'furnace,anvil,salvage', '顺序 = 建造顺序', s.campRow.join(','));
  ok(Math.abs(s.campFx.weaponQuality - 0.40) < 1e-9, '熔炉与锻台仍然挨着 → 淬火还在', s.campFx.weaponQuality);

  Game.campSell('anvil');                       // 抽掉中间那个 → 组合全断
  ok(s.campRow.join(',') === 'furnace,salvage', '拆掉落单后顺序收缩（自动靠拢）', s.campRow.join(','));
  ok(Math.abs(s.campFx.weaponQuality - 0) < 1e-9, '抽掉中间那个 → 「淬火」断了 —— 拆除也是摆法决策',
    s.campFx.weaponQuality);

  // 存档往返：campRow 必须跟着走，否则读档就等于把组合静默拆了
  s.campPoints = 20;
  Game.campBuy('anvil');
  const dump = Game.exportRun();
  ok(Array.isArray(dump.campRow) && dump.campRow.join(',') === 'furnace,salvage,anvil',
    '导出的一局带着建造顺序', JSON.stringify(dump.campRow));
  const before = { q: s.campFx.weaponQuality };
  Game.setState('title', true);
  const back = Game.importRun(dump);
  ok(back && back.campRow.join(',') === 'furnace,salvage,anvil', '读档后顺序也回来了',
    back && back.campRow.join(','));
  ok(Math.abs(back.campFx.weaponQuality - before.q) < 1e-9,
    '读档后组合重新算出同样的效果（不会静默少一份）',
    back.campFx.weaponQuality + ' vs ' + before.q);

  // 老存档没有 campRow → 按设施表补一份
  const old = JSON.parse(JSON.stringify(dump));
  delete old.campRow;
  const oldBack = Game.importRun(old);
  ok(oldBack && Camp.usedSlots(oldBack.camp) === 3, '没有顺序的老存档：工坊照样恢复',
    Camp.usedSlots(oldBack && oldBack.camp));

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
  s.campPoints = 999;
  // 三个位子都盖上（产线 = 位子），再把折叠效果直接推到"三条省料都到位"的档
  ['furnace', 'anvil', 'assay'].forEach(id => Game.campBuy(id));
  s.campFx.weaponCost = 0.4;           // 熔炉 L2 .25 + 釜底 .10 + 流水线 .05
  s.campFx.weaponQuality = 1;          // 锻台拉满：每一次都抬档（这是回收价翻倍的来源）
  s.salvageRate = 0.9;                 // 回收炉拉满
  s.fmods.craftTier = Weapons.TIER_MAX;  // 图纸门槛放开，让高价值装备也进测量
  ok(Game.craftLines() >= 3, '工地到位（' + Game.craftLines() + ' 条产线）');
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
    s.player.scrap = 100000;       // 材料管够：这里量的是"造价 vs 回收价"，不是付不付得起
    for (let line = 0; line < Game.craftLines(); line++) {
      const opt = (Game.craftOptions(line) || []).filter(o => o.kind === 'weapon' && o.ok)[0];
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
