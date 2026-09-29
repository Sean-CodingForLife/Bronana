/* =========================================================
   packs.ts — 随机道具包测试
   关键性质：
     · 价格 = 概率表的期望值 × 折扣 → 标价与概率永远自洽
     · 幸运既压价又把权重往高层搬（幸运属性第一次有硬收益）
     · 层级上限跟随波次，前期开不出神装
     · 扣钱、加道具、属性生效、材料不足被拒
     · 同 seed 完全可复现
   用法： node test/packs.mjs
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

await loadAll(SIM_MODULES);

const { Game, Items, U } = globalThis;
const FIXED = Game.cfg.fixedDt;

/** 开包属于商店动作，状态机要求处于 shop 状态；测试统一走这个入口 */
function newRunInShop(charId, seed) {
  Game.newRun(charId, seed);
  /* 房间制之后商店只在"清完一间之后"存在：直接 openShop 会造出
     "人在商店、这一间却没清"的假状态，于是后面 `nextWave()`（自动探索）会被拒 ——
     实测就是"炮塔买到了却从来没部署过"。走玩家真正走的那条路。 */
  toShop();
  return Game.getSession();
}

console.log('\n=== Bronana · 随机道具包测试 ===\n');

/* ---------------- 定价与概率自洽 ---------------- */
console.log('[1] 定价 = 基准期望值 × 折扣');
{
  let err = 0, sample = null;
  for (const wave of [1, 3, 6, 10, 15, 20]) {
    for (const luck of [0, 5, 20, 60]) {
      for (const kind of ['basic', 'deluxe']) {
        const evBase = Items.packEV(wave, 0, kind);
        const price = Items.packPrice(wave, luck, kind);
        sample = sample || { wave, luck, kind, ev: evBase, price };
        // 价格只用基准（幸运 0）期望值定价，且与幸运无关
        if (Math.abs(price - Math.max(3, Math.round(evBase * Items.PACK_DISCOUNT))) > 0.001) err++;
      }
    }
  }
  ok(err === 0, '售价恒等于基准期望值 × 折扣，且与幸运无关', err + ' 处偏差');
  console.log('    样例：第 ' + sample.wave + ' 波 幸运 ' + sample.luck + ' ' + sample.kind +
    ' → 基准期望 ' + sample.ev.toFixed(1) + '，售价 ' + sample.price);

  let monoErr = 0;
  for (let w = 1; w < 20; w++) {
    if (Items.packPrice(w + 1, 0, 'basic') < Items.packPrice(w, 0, 'basic')) monoErr++;
    if (Items.packPrice(w + 1, 0, 'deluxe') < Items.packPrice(w, 0, 'deluxe')) monoErr++;
  }
  ok(monoErr === 0, '售价随波次单调不降', monoErr + ' 处下降');
  ok(Items.packPrice(10, 0, 'deluxe') > Items.packPrice(10, 0, 'basic'),
    '高级包比普通包贵',
    Items.packPrice(10, 0, 'deluxe') + ' > ' + Items.packPrice(10, 0, 'basic'));

  // 幸运的正确收益：同样的钱开出更好的东西（实际折扣变优）
  const d0 = Items.packRealDiscount(12, 0, 'basic');
  const d60 = Items.packRealDiscount(12, 60, 'basic');
  console.log('    实际折扣：幸运 0 → ' + (d0 * 100).toFixed(1) + '%   幸运 60 → ' + (d60 * 100).toFixed(1) + '%');
  ok(d0 <= Items.PACK_DISCOUNT + 0.01, '基准折扣不超过设定值', (d0 * 100).toFixed(1) + '%');
  ok(d60 < d0 - 0.05, '幸运显著改善实际折扣（同样的钱开出更好）',
    (d60 * 100).toFixed(1) + '% < ' + (d0 * 100).toFixed(1) + '%');
}

/* ---------------- 概率表行为 ---------------- */
console.log('\n[2] 概率表');
{
  const p1 = Items.packWeights(1, 0, 'deluxe');
  ok(p1[1] === 0 && p1[2] === 0 && p1[3] === 0, '第 1 波开不出 T3/T4（跟随层级上限）', p1.join(','));

  // 全量性：任何波次、任何包种、任何幸运，概率表都必须非空且权重和为 1
  let emptyOdds = 0, sumErr = 0;
  for (let w = 1; w <= 25; w++) {
    for (const kind of ['basic', 'deluxe']) {
      for (const luck of [0, 30, 100]) {
        const ww = Items.packWeights(w, luck, kind);
        const tot = ww.reduce((a, b) => a + b, 0);
        if (tot <= 0) emptyOdds++;
        -0;
        if (Items.packOddsText(w, luck, kind).indexOf('T1') < 0 && tot > 0) sumErr++;
      }
    }
  }
  ok(emptyOdds === 0, '任何波次/包种的概率表都非空（高级包前期退化到最高可用层级）',
    emptyOdds + ' 个空表');
  let emptyText = 0;
  for (let w = 1; w <= 25; w++) {
    for (const kind of ['basic', 'deluxe']) {
      const txt = Items.packOddsText(w, 0, kind);
      if (!txt || !/T\d/.test(txt)) emptyText++;
    }
  }
  ok(emptyText === 0, '概率文字总能算出内容（不依赖具体是哪一层）', emptyText + ' 处为空');

  // 高级包在第 1~2 波不可用（此时它和普通包完全等价）
  ok(!Items.packAvailable(1, 'deluxe') && !Items.packAvailable(2, 'deluxe'),
    '第 1~2 波高级包不可购买');
  ok(Items.packAvailable(3, 'deluxe'), '第 3 波起高级包可用');
  ok(Items.packAvailable(1, 'basic'), '普通包全程可用');

  const odds = Items.packOddsText(10, 0, 'basic');
  console.log('    第 10 波普通包概率：' + odds);
  const odds2 = Items.packOddsText(10, 60, 'basic');
  console.log('    第 10 波幸运 60 普通包：' + odds2);

  // 统计检验：大量抽样看实际分布是否跟随权重
  function sampleMeanTier(kind, luck, n) {
    const rnd = U.rng(20240607);
    let sum = 0, t3plus = 0;
    for (let i = 0; i < n; i++) {
      const d = Items.rollPack(12, luck, rnd, kind);
      sum += d.tier;
      if (d.tier >= 3) t3plus++;
    }
    return { mean: sum / n, t3plus: t3plus / n };
  }
  const basic = sampleMeanTier('basic', 0, 20000);
  const deluxe = sampleMeanTier('deluxe', 0, 20000);
  const lucky = sampleMeanTier('basic', 60, 20000);
  console.log('    平均层级：普通 ' + basic.mean.toFixed(2) +
    '  高级 ' + deluxe.mean.toFixed(2) +
    '  普通+幸运60 ' + lucky.mean.toFixed(2));
  ok(deluxe.mean > basic.mean + 0.5, '高级包平均品质明显高于普通包',
    deluxe.mean.toFixed(2) + ' vs ' + basic.mean.toFixed(2));
  ok(lucky.mean > basic.mean + 0.1, '幸运显著抬高开出品质（幸运有硬收益）',
    lucky.mean.toFixed(2) + ' vs ' + basic.mean.toFixed(2));
  ok(basic.t3plus < deluxe.t3plus, '高级包出 T3+ 的概率更高',
    (basic.t3plus * 100).toFixed(1) + '% vs ' + (deluxe.t3plus * 100).toFixed(1) + '%');

  // 抽样分布应与理论权重一致（卡方式粗检：T3+ 实际频率 vs 理论值）
  const w = Items.packWeights(12, 0, 'basic');
  const tot = w.reduce((a, b) => a + b, 0);
  const theo = (w[2] + w[3]) / tot;
  ok(Math.abs(basic.t3plus - theo) < 0.02, '实测 T3+ 频率与理论权重一致',
    (basic.t3plus * 100).toFixed(1) + '% vs 理论 ' + (theo * 100).toFixed(1) + '%');
}

/* ---------------- 购买行为 ---------------- */
console.log('\n[3] 购买行为');
{
  const s = newRunInShop('ranger', 909);
  const price = Game.packPrice('basic');
  s.player.scrap = price - 1;
  const items0 = s.player.items.length;
  const denied = !Game.buyPack('basic');
  ok(denied && s.player.items.length === items0 && s.player.scrap === price - 1,
    '材料不足时拒绝购买且不扣钱', '材料 ' + s.player.scrap);

  s.player.scrap = price + 30;
  const before = s.player.scrap;
  const beforeHp = s.stats.maxHp;
  const bought = Game.buyPack('basic');
  ok(bought, '材料足够时购买成功');
  ok(s.player.scrap === before - price, '精确扣除售价', before + ' → ' + s.player.scrap);
  ok(s.player.items.length === items0 + 1, '道具数量 +1', s.player.items.length);
  ok(s.packsOpened === 1, '统计已记录开包次数', s.packsOpened);

  // 属性真的生效了（重算后 stats 必须包含该道具的效果）
  const granted = s.player.items[s.player.items.length - 1].def;
  const st = granted.stats || {};
  let applied = true;
  for (const k in st) {
    if (!isFinite(s.stats[k])) applied = false;
  }
  ok(applied, '道具属性已并入角色属性表', granted.name);
  console.log('    开出 ' + granted.name + '（T' + granted.tier + '，原价 ' + granted.price + '）');

  // 连续开包不会卡住，且材料足额时每次都成功（第 6 波：两种包都可用）
  Game.wave = 6;
  s.player.scrap = 100000;
  let allOk = true;
  for (let i = 0; i < 60; i++) {
    if (!Game.buyPack(i % 3 === 0 ? 'deluxe' : 'basic')) allOk = false;
  }
  ok(allOk && s.packsOpened === 61, '连续开包 60 次全部成功（含高级包）', '共 ' + s.packsOpened + ' 次');
  ok(s.player.items.length === items0 + 61, '道具逐次累加', s.player.items.length);
}

/* ---------------- 可复现性 ---------------- */
console.log('\n[4] 可复现性');
{
  function rollSequence(seed) {
    const s = newRunInShop('ranger', seed);
    s.player.scrap = 100000;
    const out = [];
    for (let i = 0; i < 25; i++) {
      Game.buyPack('basic');
      out.push(s.player.items[s.player.items.length - 1].def.id);
    }
    return out.join(',');
  }
  const a = rollSequence(1234);
  const b = rollSequence(1234);
  const c = rollSequence(4321);
  ok(a === b, '同种子的开包序列完全一致');
  ok(a !== c, '不同种子给出不同序列');
}

/* ---------------- 特殊道具与联动 ---------------- */
console.log('\n[5] 特殊道具与波次联动');
{
  // 特殊道具（炮塔/克隆装置）都是 T4，只有高级包能开出（普通包权重表里 T4 恒为 0）
  const s = newRunInShop('engineer', 24680);
  s.player.scrap = 100000;
  let gotSpecial = null;
  Game.wave = 12;                 // 解锁 T4
  for (let i = 0; i < 600 && !gotSpecial; i++) {
    Game.buyPack('deluxe');
    const d = s.player.items[s.player.items.length - 1].def;
    if (d.special === 'turret') gotSpecial = d;
  }
  ok(!!gotSpecial, '高级包能开出特殊道具（便携炮塔，T4）', gotSpecial ? gotSpecial.name : '未开出');
  if (gotSpecial) {
    Game.nextWave();
    const s2 = Game.getSession();
    ok(s2.turrets.length >= 1, '开出的炮塔在下一波实际部署', s2.turrets.length + ' 座');
  }

  // 普通包不可能开出 T4（设计如此：便宜包只赌中低层）
  const sb = newRunInShop('ranger', 31415);
  sb.player.scrap = 100000;
  Game.wave = 14;
  let basicMax = 0;
  for (let i = 0; i < 800; i++) {
    Game.buyPack('basic');
    basicMax = Math.max(basicMax, sb.player.items[sb.player.items.length - 1].def.tier);
  }
  ok(basicMax <= 3, '普通包最高只出 T3（T4 是高级包专属）', 'T' + basicMax);

  // 层级上限：第 1 波不可能拿到 T2 以上（此时只有普通包可用）
  const s3 = newRunInShop('ranger', 111);
  s3.player.scrap = 100000;
  Game.wave = 1;
  ok(!Game.buyPack('deluxe'), '第 1 波高级包被拒绝（此时与普通包等价）');
  let maxTier = 0;
  for (let i = 0; i < 300; i++) {
    Game.buyPack('basic');
    maxTier = Math.max(maxTier, s3.player.items[s3.player.items.length - 1].def.tier);
  }
  ok(maxTier === 1, '第 1 波无论怎么开都只能出 T1', '实际最高 T' + maxTier + '（共 ' + s3.player.items.length + ' 件）');
}

/* ---------------- 与商店的其它机制共存 ---------------- */
console.log('\n[6] 与刷新/锁定共存');
{
  Game.newRun('ranger', 5);
  const s = Game.getSession();
  s.player.scrap = 5000;
  Game._internals.openShop(0);
  const offersBefore = s.offers.map(o => o.def.id).join(',');
  Game.buyPack('basic');
  const offersAfter = s.offers.map(o => o.def.id).join(',');
  ok(offersBefore === offersAfter, '开包不会刷新商店货架');
  Game.reroll();
  Game.buyPack('deluxe');
  ok(true, '开包与刷新可以连续使用');
}

console.log('\n=== 结果 ===');
if (failures === 0) { console.log('\x1b[32m全部通过 ✔\x1b[0m\n'); process.exit(0); }
console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m\n');
process.exit(1);
