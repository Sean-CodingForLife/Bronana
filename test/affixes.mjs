/* =========================================================
   affixes.mjs — 词条系统（前缀 / 后缀）
   ---------------------------------------------------------
   这一套测的是"系统"，不是"某一条词条"。五组：

     [1] 表与自检：声明表自洽；**审计真的能抓错**（人为把它改坏）
     [2] 生成规则：条数随品级、档位不看品级、槽位对得上、同种子逐位可复现
     [3] 折叠：空 = 恒等；属性进全局属性表；武器本地只作用于那一把
     [4] 接线：开局 / 货架 / 买 / 制造 / 宝箱 / 合成 —— 五个生成点都有词条
     [5] 存档：往返一致；坏档丢掉而不是抛；货架的词条不重滚
     [6] 界面：文案来自表（界面不写第二份）、颜色按家族分

   为什么每一组都要有：词条这个系统最贵的失败不是"崩了"，而是
   **某一条路径上没有词条**（玩家看不出来，作者也看不出来）。
   用法： node test/affixes.mjs
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { installDom } from './_ctx.mjs';
import { loadAll, SIM_MODULES, UI_MODULES, enterFightRoom, toShop } from './_load.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
installDom();
const g = globalThis;
await loadAll(UI_MODULES);

let failures = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  \x1b[32mPASS\x1b[0m ' + label);
  else { failures++; console.log('  \x1b[31mFAIL\x1b[0m ' + label + (extra !== undefined ? '  → ' + extra : '')); }
}
function throws(fn) {
  try { fn(); return null; } catch (e) { return e && e.message ? e.message : String(e); }
}

const { Affixes, Game, Items, Weapons, Stats, Comp, Tiers, Registry, U } = g;
const readSrc = f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');

console.log('\n=== Bronana · 词条系统 ===\n');

/* =========================================================
   [1] 表与自检
   ========================================================= */
console.log('[1] 声明表与自检');
{
  const v = Affixes.audit();
  ok(v.ok, '词条表自检通过（' + v.counts.affixes + ' 条：前缀 ' + v.counts.prefix + ' / 后缀 ' + v.counts.suffix + '）',
    v.problems.join(' | '));
  ok(v.counts.prefix >= 3 && v.counts.suffix >= 3, '两个家族都有足够条目（家族这一维不是装饰）',
    v.counts.prefix + '/' + v.counts.suffix);
  ok(Affixes.LIST.length === new Set(Affixes.LIST.map(d => d.id)).size, 'id 不重复');

  // 每一条的效果键都必须在声明表里，属性键必须真的在 Stats 表里
  const statKeys = Stats.base();
  const badMod = Affixes.LIST.filter(d => !Affixes.MODS[d.mod]);
  ok(badMod.length === 0, '每条词条的效果键都声明过', badMod.map(d => d.id).join(','));
  const badKey = Affixes.LIST.filter(d => {
    const m = Affixes.MODS[d.mod];
    return m.scope === 'stat' && !(m.key in statKeys);
  });
  ok(badKey.length === 0, '属性类的效果键都真的在属性表里（否则"加了也看不见"）',
    badKey.map(d => d.id).join(','));

  // 每一条都能落在至少一件**真实存在**的装备上（这是"死数据"的判据）
  const blank = Affixes._blankTargets();
  ok(blank.length === 0, '没有任何装备是"一条词条都滚不出来"的白板', blank.slice(0, 6).join(','));
  ok(Weapons.LIST.length > 0 && Items.LIST.length > 0, '两张表都交上来了（bindTables 没漏）',
    Weapons.LIST.length + '/' + Items.LIST.length);

  // 每一条**词条**都至少落得到一件真实装备上（反过来的一侧）
  const orphan = [];
  for (const d of Affixes.LIST) {
    const anyW = Weapons.LIST.some(w => Affixes.wrongReason(d, 'weapon', w) === '');
    const anyI = Items.LIST.some(i => Affixes.wrongReason(d, 'item', i) === '');
    if (!anyW && !anyI) orphan.push(d.id);
  }
  ok(orphan.length === 0, '每条词条都落得到至少一件真实装备上（没有死数据）', orphan.join(','));

  // ---- 审计真的能抓错：人为改坏，audit 必须报出来 ----
  const probe = Affixes.LIST[0];
  const keepMod = probe.mod;
  probe.mod = 'noSuchMod';
  const a1 = Affixes.audit();
  ok(!a1.ok && a1.problems.some(p => /效果键没声明/.test(p)),
    '把 mod 改成不存在的键 → 审计报出来（审计不是装饰）', a1.problems.slice(0, 2).join(' | '));
  probe.mod = keepMod;

  const keepSlot = probe.slots.slice();
  probe.slots = ['noSuchSlot'];
  const a2 = Affixes.audit();
  ok(!a2.ok && a2.problems.some(p => /槽位不存在/.test(p)), '把槽位写错 → 审计报出来',
    a2.problems.slice(0, 2).join(' | '));
  probe.slots = keepSlot;

  const keepPer = probe.per;
  probe.per = 0;
  const a3 = Affixes.audit();
  ok(!a3.ok && a3.problems.some(p => /每档增量是 0/.test(p)), '把每档增量改成 0 → 审计报出来',
    a3.problems.slice(0, 2).join(' | '));
  probe.per = keepPer;

  ok(Affixes.audit().ok, '改回来之后审计重新通过（探测没有留下痕迹）');

  // 家族重名 / 缺说明由 Registry 兜住（这里只确认两个家族都登记了）
  ok(Registry.has('affix') && Registry.has('affixMod') && Registry.has('affixSlot') &&
    Registry.has('affixTag') && Registry.has('affixFamily'),
    '五个词条家族都登记进了总账');
}

/* =========================================================
   [2] 生成规则
   ========================================================= */
console.log('\n[2] 生成规则');
{
  const knife = Weapons.BY_ID['knife'];
  const cloak = Items.BY_ID['cloak'];
  const cloak2 = Items.BY_ID['cloak2'];

  const rnd = U.rng(12345);
  const t1 = Affixes.roll('weapon', knife, 1, rnd);
  const t4 = Affixes.roll('weapon', knife, 4, rnd);
  ok(t1.list.length === 1, 'T1 装备滚 1 条词条', t1.list.length);
  ok(t4.list.length === 3, 'T4 装备滚 3 条词条', t4.list.length);
  ok(Affixes.rollCount(2) === 2 && Affixes.rollCount(3) === 2 && Affixes.rollCount(5) === 3,
    '条数阶梯：T2=2 / T3=2 / T5=3');

  // 档位上限 = 品级（Last Epoch 的 item level）
  const caps = [];
  const usedTiers = new Set();
  for (let tier = 1; tier <= 5; tier++) {
    for (let n = 0; n < 400; n++) {
      for (const inst of Affixes.roll('weapon', knife, tier, rnd).list) {
        caps.push([tier, inst.t]);
        usedTiers.add(inst.t);
      }
    }
  }
  ok(caps.every(([tier, t]) => t <= tier), '词条档位不超过装备品级（高档看得到、低档拿不到）',
    caps.filter(([tier, t]) => t > tier).slice(0, 3).join(' '));
  /* 档位确实"跟着品级抬"：同一件装备在 T1 与 T4 上滚，能拿到的档位集合不同。
     （用集合比较而不是"T4 能滚出 T3"：T3 只有 `朴质` 一条能到，样本会飘。） */
  const topOfTier = t => {
    let top = 0;
    for (let n = 0; n < 400; n++) {
      for (const inst of Affixes.roll('weapon', knife, t, rnd).list) if (inst.t > top) top = inst.t;
    }
    return top;
  };
  const top1 = topOfTier(1), top4 = topOfTier(4);
  ok(top1 === 1 && top4 > top1, '品级抬高之后能滚到的档位也更高（T1 封顶 ' + top1 + ' / T4 能到 ' + top4 + '）');
  ok(usedTiers.has(1) && usedTiers.has(2), '低档词条仍然会出现在高档装备上（不是只有满档）',
    [...usedTiers].sort().join(','));

  // 同一条不许重复
  let dup = null;
  for (let n = 0; n < 200 && !dup; n++) {
    const s = Affixes.roll('weapon', knife, 5, rnd);
    const ids = s.list.map(x => x.id);
    if (ids.length !== new Set(ids).size) dup = ids.join(',');
  }
  ok(!dup, '同一件装备上不会出现两条同名（重复只会翻倍数值，读起来还是十行字）', dup);

  // 槽位：重型护具吃得到 armor:heavy，轻甲吃不到
  const heavyRoll = new Set();
  for (let n = 0; n < 300; n++) {
    for (const inst of Affixes.roll('item', cloak2, 3, rnd).list) heavyRoll.add(inst.id);
  }
  const lightRoll = new Set();
  for (let n = 0; n < 300; n++) {
    for (const inst of Affixes.roll('item', cloak, 3, rnd).list) lightRoll.add(inst.id);
  }
  ok(heavyRoll.has('bulwark'), '重型护具滚得出 armor:heavy 那一条', [...heavyRoll].join(','));
  ok(!lightRoll.has('bulwark'), '轻甲滚不出 armor:heavy 那一条（细分规则真的在生效）');

  // 武器槽位的细分：近战吃不到"精密"（tags: ['ranged']）
  const melee = new Set(), ranged = new Set();
  for (let n = 0; n < 300; n++) {
    for (const inst of Affixes.roll('weapon', knife, 3, rnd).list) melee.add(inst.id);
    for (const inst of Affixes.roll('weapon', Weapons.BY_ID['pistol'], 3, rnd).list) ranged.add(inst.id);
  }
  ok(ranged.has('sighted') && !melee.has('sighted'), '"精密"只落在远程武器上',
    'ranged=' + ranged.has('sighted') + ' melee=' + melee.has('sighted'));
  ok(melee.has('brutal') && !ranged.has('brutal'), '"残暴"只落在近战武器上');

  /* 每条词条的数值必须在**它自己那一档的合法区间**里 —— 区间定义与 `make` 同一个，
     这里只对着"值域"断言，不猜具体数字（猜数字的测试会在调平衡时全红）。 */
  const inRange = inst => {
    const def = Affixes.BY_ID[inst.id];
    const mag = Math.abs(def.per);
    const lo = mag * (inst.t - 1) + 1, hi = mag * inst.t;
    const av = Math.abs(inst.v);
    return Number.isInteger(inst.v) && av >= lo && av <= hi &&
      (def.per < 0 ? inst.v < 0 : inst.v > 0);
  };
  let outOfRange = null;
  for (let n = 0; n < 600; n++) {
    for (const inst of Affixes.roll('weapon', knife, 5, rnd).list) {
      if (!inRange(inst)) outOfRange = inst.id + ' t' + inst.t + ' v' + inst.v;
    }
  }
  ok(!outOfRange, '数值是整数、落在自己那一档的区间里、符号与 per 一致且不为 0', outOfRange);
  // 逐档枚举：每一档两端都在区间里（`make` 的边界，不是抽样）
  let badEdge = null;
  for (const def of Affixes.LIST) {
    for (let t = 1; t <= def.cap; t++) {
      for (const r of [0, 0.5, 0.999999]) {
        const inst = Affixes.make(def.id, t, () => r);
        if (!inRange(inst)) badEdge = def.id + ' t' + t + ' r' + r + ' v' + inst.v;
      }
    }
  }
  ok(!badEdge, '每一条词条的每一档、每一个取值都在合法区间里（边界也查）', badEdge);

  // 确定性：同种子同结果（回放与存档的前提）
  const r1 = U.rng(999), r2 = U.rng(999);
  const seq = s => {
    const out = [];
    for (let i = 0; i < 6; i++) {
      out.push(Affixes.roll('weapon', knife, 4, s).list.map(x => x.id + ':' + x.t + ':' + x.v).join('/'));
    }
    return out.join('|');
  };
  ok(seq(r1) === seq(r2), '同一个种子滚出逐位相同的结果（确定性的前提）');
  ok(Affixes.roll('weapon', knife, 4, null).list.length === 0,
    '不给随机源 → 不滚（不退化成 Math.random —— 那会让回放分叉）');

  // 池子：每种装备都有得滚
  ok(Weapons.LIST.every(w => Affixes.pool('weapon', w).length >= 2), '每把武器都至少有 2 条候选词条');
  ok(Items.LIST.every(i => Affixes.pool('item', i).length >= 2), '每件道具都至少有 2 条候选词条');
}

/* =========================================================
   [3] 折叠
   ========================================================= */
console.log('\n[3] 折叠：属性 / 武器本地');
{
  // 空 = 恒等
  const f0 = Affixes.fold(null);
  ok(Object.keys(f0.stats).length === 0, '没有词条 → 属性增量是空的（恒等）');
  ok(!f0.wmods.weaponDmgPct || f0.wmods.weaponDmgPct === 1, '没有词条 → 武器伤害倍率是恒等');

  /* 百分比：千分比整数 → 真值。取值用 `make` 的真实输出（不手写 v），
     因为"这一档到底给多少"是平衡参数，不是接口契约 —— 契约是"折叠按 scale 还原"。 */
  const honed = Affixes.make('honed', 2, () => 0.999999);   // 满档：60 + 60*0.999999 → 120? 见下
  const f1 = Affixes.fold({ list: [honed], max: 1 });
  ok(Math.abs(f1.wmods.weaponDmgPct - (1 + honed.v / 1000)) < 1e-9,
    '锋锐 T2 的 v=' + honed.v + ' → 这把武器伤害 ×' + f1.wmods.weaponDmgPct.toFixed(3));
  ok(Array.isArray(f1.wmods ? Object.keys(f1.wmods) : []) &&
    typeof f1.wmods.weaponCdPct === 'number',
    '武器本地那一份的形状是固定的（两个倍率键，缺省为 1）', JSON.stringify(f1.wmods));
  ok(!('weaponDmgPct' in f1.stats), '武器本地那一份**不进**全局属性表（否则 6 把枪各吃一遍）');

  const guarded = Affixes.make('guarded', 2, () => 0.999999);
  const f2 = Affixes.fold({ list: [guarded], max: 1 });
  ok(f2.stats.armor === guarded.v && guarded.v >= 3,
    '守御 T2 给 +' + guarded.v + ' 护甲（整数直接进属性表）', f2.stats.armor);

  const clocked = Affixes.make('clocked', 2, () => 0.999999);
  const f3 = Affixes.fold({ list: [clocked], max: 1 });
  ok(Math.abs(f3.stats.attackSpeed - clocked.v / 1000) < 1e-9,
    '加速 T2 → 攻速 +' + (clocked.v / 1000).toFixed(3), f3.stats.attackSpeed);

  const swift = Affixes.make('swift', 2, () => 0.999999);
  const f4 = Affixes.fold({ list: [swift], max: 1 });
  ok(swift.v < 0 && f4.wmods.weaponCdPct < 1,
    '负 per 的词条（迅捷）真的让冷却变短：v=' + swift.v + ' → ×' + f4.wmods.weaponCdPct.toFixed(3),
    f4.wmods.weaponCdPct);
  // 正负两侧逐位对称（这是"负 per 那条路有人走过"的实证）
  const swift1 = Affixes.make('swift', 1, () => 0.999999);
  const honed1 = Affixes.make('honed', 1, () => 0.999999);
  ok(Math.abs(swift1.v) === Math.abs(honed1.v) * (40 / 60),
    '正负两侧的幅值算法是同一个（迅捷 -' + Math.abs(swift1.v) + ' 对 锋锐 +' + honed1.v + '，比例 = per 之比）',
    swift1.v + '/' + honed1.v);

  // applyStats 就地累加
  const out = Stats.base();
  const before = out.armor;
  Affixes.applyStats({ list: [guarded, guarded], max: 2 }, out);
  ok(out.armor === before + guarded.v * 2, 'applyStats 就地累加（同一条出现两次就叠两次）', out.armor - before);

  // 文案来自表
  ok(Affixes.lines({ list: [honed], max: 1 })[0].indexOf('锋锐') === 0, '文案来自表（名字在行首）',
    Affixes.lines({ list: [honed], max: 1 })[0]);
  ok(/affix prefix/.test(Affixes.html(guarded)) === false && /affix suffix/.test(Affixes.html(guarded)),
    'HTML 带家族类名（颜色按前缀/后缀分）', Affixes.html(guarded));
}

/* =========================================================
   [4] 接线：五个生成点
   ========================================================= */
console.log('\n[4] 接线：开局 / 货架 / 买 / 制造 / 宝箱 / 合成');
{
  const weaponDamage = Game._internals.weaponDamage || g.weaponDamage;

  Game.newRun('ranger', 4242);
  let sess = Game.getSession();
  ok(sess.player.weapons.every(w => w.affixes && w.affixes.list.length >= 1),
    '开局武器都带词条', sess.player.weapons.map(w => (w.affixes ? w.affixes.list.length : -1)).join(','));
  ok(sess.player.weapons.every(w => w.wmods && w.wmods.weaponDmgPct >= 1),
    'recalcStats 把武器本地那一份写进了 w.wmods');

  // ---- 武器本地修正真的进伤害公式 ----
  {
    const w = sess.player.weapons.find(x => x.def.type === 'melee') || sess.player.weapons[0];
    /* 这一把的伤害由两段组成：**武器本体**（`def.dmg × 品级台阶 × 全局伤害倍率`）
       与**属性加的那一段**（近战/远程/元素/工程）。词条只该放大前一段 ——
       后一段已经被属性系统算过一次了，再乘一遍就是同一份属性吃两次。
       为了让第二段非零，这里临时给 10 点近战/远程属性（测试的就是"它没被乘"）。 */
    const stats = sess.stats;
    stats.meleeDmg += 10;
    stats.rangedDmg += 10;
    const own = w.def.dmg * Weapons.mul(w, 'dmg') * Stats.damageMul(stats, w.def);
    w.wmods = { weaponDmgPct: 1, weaponCdPct: 1 };
    const base = weaponDamage(w);
    const statPart = base - own;
    ok(statPart > 0, '武器伤害里确实有"属性加的那一段"（' + statPart.toFixed(2) + '）');
    w.wmods = { weaponDmgPct: 1.5, weaponCdPct: 1 };
    const boosted = weaponDamage(w);
    ok(Math.abs(boosted - base - own * 0.5) < 1e-6,
      '词条放大的是**武器本体**（+' + (own * 0.5).toFixed(2) + '），不是整段伤害',
      (boosted - base).toFixed(3) + ' vs ' + (own * 0.5).toFixed(3));
    ok(Math.abs((boosted - base) / base - 0.5) > 1e-6,
      '也就是说它**不等于**"总伤害 ×1.5"（属性那一段不该被乘两次）',
      ((boosted - base) / base).toFixed(3));
    stats.meleeDmg -= 10;
    stats.rangedDmg -= 10;
    w.wmods = { weaponDmgPct: 1, weaponCdPct: 0.5 };
    ok(Math.abs(Game._internals.weaponCd(w) / (w.def.cd * Weapons.mul(w, 'cd') * Stats.cooldownMul(stats)) - 0.5) < 1e-6,
      '冷却倍率同样生效（×0.5）');
    // 坏值防线：NaN / 负数 / 0 一律退回恒等（而不是把伤害打成 NaN）
    const clean = weaponDamage(w);
    w.wmods = { weaponDmgPct: NaN, weaponCdPct: 0 };
    const safe = weaponDamage(w);
    ok(isFinite(safe) && safe > 0 && safe === clean, 'wmods 里的坏值退回恒等（不会打出 NaN 伤害）', safe);
  }

  // ---- 货架：每件货都带词条，条数跟着它自己的档位 ----
  toShop(sess);
  ok(sess.offers.length > 0, '货架有货（' + sess.offers.length + ' 件）');
  ok(sess.offers.every(o => o.affixes && o.affixes.list.length >= 1), '货架上每一件都带词条',
    sess.offers.filter(o => !o.affixes || !o.affixes.list.length).length + ' 件没有');
  {
    const bad = sess.offers.filter(o => {
      const tier = o.type === 'weapon' ? (o.tier || o.def.tier || 1) : (o.def.tier || 1);
      return o.affixes.list.length !== Affixes.rollCount(tier);
    });
    ok(bad.length === 0, '货架上的条数 = rollCount(它自己的档位)', bad.length + ' 件对不上');
  }

  // ---- 买：到手的就是货架上那一件（词条按值比对） ----
  {
    const idx = sess.offers.findIndex(o => o.type === 'weapon' && !o.sold);
    const before = sess.offers[idx];
    const want = JSON.stringify(Affixes.toSave(before.affixes));
    sess.player.scrap = 100000;
    const okBuy = Game.buyOffer(idx);
    const got = sess.player.weapons[sess.player.weapons.length - 1];
    ok(okBuy && got && got.def.id === before.def.id, '买到手的是货架上那一把');
    ok(got && JSON.stringify(Affixes.toSave(got.affixes)) === want,
      '买到手的词条与货架上显示的一模一样（不是重滚一套）',
      got ? JSON.stringify(Affixes.toSave(got.affixes)) : 'null');
  }

  // ---- 道具包 ----
  {
    sess.player.scrap = 100000;
    const n0 = sess.player.items.length;
    Game.buyPack('basic');
    ok(sess.player.items.length === n0 + 1, '道具包开出一件道具');
    const it = sess.player.items[sess.player.items.length - 1];
    ok(it.affixes && it.affixes.list.length >= 1, '开包出来的道具带词条');
  }

  // ---- 制造 ----
  {
    const r = g.Craft.LIST.filter(x => x.kind === 'item' && x.tier <= 2)[0];
    const n0 = sess.player.items.length;
    const made = Sessions_forceCraft(sess, r.id);
    const it = sess.player.items[sess.player.items.length - 1];
    ok(made && sess.player.items.length === n0 + 1 && it && it.def.id === r.refId,
      '造出来的就是配方那一件（' + r.id + '）', made + '/' + (it ? it.def.id : 'none'));
    ok(!!it && !!it.affixes && it.affixes.list.length >= 1, '造出来的道具带词条',
      it ? JSON.stringify(Affixes.toSave(it.affixes)) : 'none');
  }

  // ---- 合成：两把的词条各取更好的一条 ----
  {
    Game.newRun('ranger', 777);
    sess = Game.getSession();
    /* 合成只能在商店/营地里做（状态机的守卫）。用 `setState` 而不是 `toShop()`：
       后者会"把这一间打完"并开始下一波，而那会动武器栏的内容 ——
       这一段的断言需要"武器栏里恰好是我放的那两把"。 */
    Game.setState('shop', true);
    sess.player.weapons.length = 0;
    const a = Game.addWeapon('knife', 1);
    const b = Game.addWeapon('knife', 1);
    ok(!!a && !!b, '造出两把同名同档的匕首');
    /* 手工给两把不同的词条（一条更好），验证合并规则。
       合法区间是 `|per|*(t-1)+1 .. |per|*t`（锋锐 T2 = 61..120）——
       手写的 v 必须落在区间里，否则 `normalize` 会按档位重算
       （那正是它该做的事，但会让这个测试失效）。 */
    a.affixes = Affixes.normalize({ list: [{ id: 'honed', t: 2, v: 61 }], max: 1 }, 'weapon');
    b.affixes = Affixes.normalize({ list: [{ id: 'honed', t: 2, v: 120 }, { id: 'guarded', t: 1, v: 2 }], max: 2 }, 'weapon');
    const merged = Affixes.merge(a.affixes, b.affixes, 2);
    ok(merged.list.some(x => x.id === 'honed' && x.v === 120), '同名各取更好的那一条（61 → 120）',
      JSON.stringify(Affixes.toSave(merged)));
    ok(merged.list.some(x => x.id === 'guarded'), '另一把独有的那条也留下来了');
    ok(merged.list.length <= 2, '上限生效（max=2）', merged.list.length);

    // 走真实的合成路径（market.combine → game.ts 的 combine）
    a.affixes = Affixes.normalize({ list: [{ id: 'honed', t: 2, v: 61 }], max: 1 }, 'weapon');
    b.affixes = Affixes.normalize({ list: [{ id: 'guarded', t: 1, v: 2 }], max: 1 }, 'weapon');
    const combined = Game.combine(0, 1);
    ok(combined && sess.player.weapons.length === 1, '合成后只剩一把',
      combined + '/' + sess.player.weapons.length);
    const res = sess.player.weapons[0];
    ok(res && res.affixes && res.affixes.list.length >= 1,
      '合成结果保留了词条（燃料那一把的好词条不白瞎）',
      res && res.affixes ? JSON.stringify(Affixes.toSave(res.affixes)) : 'null');
    ok(res && res.affixes && res.affixes.list.some(x => x.id === 'guarded'),
      '燃料那一把**独有**的词条也留下来了（两把各取更好的）',
      res && res.affixes ? JSON.stringify(Affixes.toSave(res.affixes)) : 'null');
  }

  // ---- 白板对象（老存档 / 手工造）不炸 ----
  {
    const w = Comp.spawn('weapon', { id: 'knife', def: Weapons.BY_ID['knife'], cd: 0, swing: 0, tier: 1 });
    ok(w.affixes === null && w.wmods === null, '由原型造出来的武器词条缺省是 null（老对象能活）');
    Game.newRun('ranger', 31337);
    const s2 = Game.getSession();
    s2.player.weapons[0].affixes = null;
    s2.player.weapons[0].wmods = null;
    const msg = throws(() => Game.recalcStats());
    ok(!msg, '词条为 null 的武器照样能重算属性（折叠是恒等，不是崩）', msg);
  }
}

/* =========================================================
   [5] 存档
   ========================================================= */
console.log('\n[5] 存档：往返 / 坏档 / 货架不重滚');
{
  Game.newRun('ranger', 20260101);
  let sess = Game.getSession();
  // 造一点带词条的装备：一把武器 + 两件道具
  sess.player.scrap = 100000;
  Game.addWeapon('axe', 3);
  g.Items.LIST.slice(0, 2).forEach(d => Game.addItem(d));
  const data = Game.exportRun();
  const wWant = data.weapons.map(w => JSON.stringify(w.a));
  const iWant = data.items.map(it => JSON.stringify(it.a));
  ok(data.weapons.every(w => Array.isArray(w.a)), '武器词条写进了存档（[id,档,值] 三元组）');
  ok(data.items.every(it => it && Array.isArray(it.a)), '道具词条同样进了存档');
  ok(wWant.some(s => s !== '[]'), '存档里真的有三元组（不是一串空数组）', wWant.join(' '));

  const sess2 = Game.importRun(JSON.parse(JSON.stringify(data)));
  ok(!!sess2, '读档成功');
  const wGot = sess2.player.weapons.map(w => JSON.stringify(Affixes.toSave(w.affixes)));
  const iGot = sess2.player.items.map(it => JSON.stringify(Affixes.toSave(it.affixes)));
  ok(wGot.join('|') === wWant.join('|'), '武器词条逐位往返一致', wGot.join(' ') + ' vs ' + wWant.join(' '));
  ok(iGot.join('|') === iWant.join('|'), '道具词条逐位往返一致', iGot.join(' ') + ' vs ' + iWant.join(' '));

  // 货架的词条也不能重滚
  toShop(sess2);
  const shelfWant = sess2.offers.map(o => JSON.stringify(Affixes.toSave(o.affixes)));
  const data2 = Game.exportRun();
  const sess3 = Game.importRun(JSON.parse(JSON.stringify(data2)));
  const shelfGot = sess3.offers.map(o => JSON.stringify(Affixes.toSave(o.affixes)));
  ok(shelfGot.join('|') === shelfWant.join('|'), '读档后货架上的词条**不重滚**（看着的货还是那件货）',
    shelfGot.slice(0, 2).join(' ') + ' vs ' + shelfWant.slice(0, 2).join(' '));

  // 老存档：`a` 缺失 → 补一套（"第一次被看见"），而不是崩
  const legacy = JSON.parse(JSON.stringify(data));
  delete legacy.offers;
  legacy.weapons = legacy.weapons.map(w => ({ id: w.id, t: w.t, p: w.p }));
  legacy.items = legacy.items.map(it => it.id);
  const sessL = Game.importRun(legacy);
  ok(!!sessL, '没有词条字段的老存档照样能读（能修的修）');
  ok(sessL.player.weapons.every(w => w.affixes && w.affixes.list.length >= 1),
    '老存档的武器补上了词条（而不是永远白板）');

  // 坏词条：认不出的 id / 越界数值 / 重复 —— 丢掉或重算，绝不抛
  ok(Affixes.fromSave([['noSuchAffix', 1, 5]], 'weapon').list.length === 0,
    '认不出的词条 id 被丢掉');
  ok(Affixes.fromSave([['honed', 1, 1e9]], 'weapon').list[0].v <= 60,
    '越界数值按档位重算（1e9 → 合法区间）',
    JSON.stringify(Affixes.fromSave([['honed', 1, 1e9]], 'weapon').list[0]));
  ok(Affixes.fromSave([['honed', 1, 30], ['honed', 2, 80]], 'weapon').list.length === 1,
    '同一 id 出现两次只留一条');
  ok(Affixes.fromSave([['guarded', 1, 2]], 'weapon', Weapons.BY_ID['knife']).list.length === 0,
    '槽位对不上的词条被丢掉（存档里塞了一件这件装备不可能有的词条）');
  ok(Affixes.fromSave(null, 'weapon').list.length === 0 && Affixes.fromSave('乱码', 'weapon').list.length === 0,
    'null / 乱码输入返回空集合（不抛）');

  // 存档里的怪数值：非有限数不许进会话
  const evil = JSON.parse(JSON.stringify(data));
  evil.weapons[0].a = [['honed', 2, 'NaN']];
  const sessE = Game.importRun(evil);
  ok(!!sessE && isFinite(sessE.player.weapons[0].affixes.list[0] ? sessE.player.weapons[0].affixes.list[0].v : 0),
    '存档里塞 NaN 也不进会话（按档位重算）');
}

/* =========================================================
   [6] 界面与静态契约
   ========================================================= */
console.log('\n[6] 界面');
{
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  ok(/\.affix\.prefix/.test(css) && /\.affix\.suffix/.test(css),
    '前缀与后缀各有自己的颜色类（家族在界面上分得开）');

  const html = Affixes.html(Affixes.make('honed', 2, () => 0));
  ok(/class="affix prefix"/.test(html) && /锋锐/.test(html), '前缀渲染成暖色那一类', html);
  const html2 = Affixes.html(Affixes.make('guarded', 1, () => 0));
  ok(/class="affix suffix"/.test(html2), '后缀渲染成冷色那一类', html2);
  ok(Affixes.html({ id: 'nope', t: 1, v: 0 }) === '', '认不出的词条渲染成空串（界面不炸）');

  // 界面**不写第二份文案**：所有词条文字都出自表里的 text 函数
  const uiSrc = readSrc('ui.ts');
  const uiCode = stripComments(uiSrc);
  /* 排除与**属性名**撞车的那几个（词条 `幸运` 与属性 `幸运` 是同一个词）：
     界面显示 Stats 的标签是它自己的事，不算"第二份词条文案"。 */
  const statLabels = new Set(Object.values(Stats.DEF).flatMap(d => [d.label, d.short]));
  const clash = Affixes.LIST.map(d => d.name).filter(n => !statLabels.has(n) && uiCode.indexOf(n) >= 0);
  ok(clash.length === 0, 'ui.ts 里没有硬编码任何词条名（文案唯一出处在表里）', clash.join(','));
  ok(/Affixes\.html\(/.test(uiCode), 'ui.ts 走 Affixes.html 渲染词条');

  // 模拟层不认识界面：affixes.ts 不许 import 任何表现层
  const affSrc = stripComments(readSrc('affixes.ts'));
  const imports = [...affSrc.matchAll(/from\s+'\.\/([\w.]+\.ts)'/g)].map(m => m[1]);
  const allowed = ['registry.ts', 'selfcheck.ts', 'stats.ts', 'utils.ts'];
  const extra = imports.filter(f => allowed.indexOf(f) < 0);
  ok(extra.length === 0, 'affixes.ts 只依赖 工具 / 总账 / 自检 / 属性表（数据层，不认识模拟与表现）',
    extra.join(','));
  ok(imports.indexOf('game.ts') < 0 && imports.indexOf('ui.ts') < 0,
    'affixes.ts 不 import game.ts / ui.ts（依赖方向：数据 ← 模拟 ← 界面）', imports.join(','));
}

console.log('\n=== 结果 ===');
if (failures === 0) console.log('\x1b[32m全部通过 ✔\x1b[0m');
else console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m');
process.exit(failures ? 1 : 0);

/* ---------------- 小工具 ---------------- */
/** 去掉注释（静态契约要在**代码**上查，而不是在散文说明里查 ——
 *  `affixes.ts` 的文件头正当地提到了 game.ts / ui.ts，那不是依赖）。 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** 把会话推到商店状态并给一条产线，然后造一件。
 *  为什么用 `setState('shop')` 而不是 `toShop()`：`toShop` 会把这一间"打完"
 *  （开始下一波），而后面的合成用例需要"武器栏里**恰好**是我放的那两把"。 */
function Sessions_forceCraft(sess, recipeId) {
  const S = g.Game.getSession();
  g.Game.setState('shop', true);
  // 产线来自营地设施；直接给一座「熔炉」，绕开"先攒建材"那一段（那是营地测试的事）
  S.camp = S.camp || {};
  S.camp['furnace'] = 1;
  S.craftUsed = [];
  g.Game.recalcStats();
  const lines = g.Game.craftFreeLines();
  const line = lines.length ? lines[0] : 0;
  S.player.scrap = 100000;
  return g.Game.craft(line, recipeId);
}
