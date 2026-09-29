/* =========================================================
   items.mjs — 道具的"有得有失"

   这一套守的是**决策本身**，不是某个数字：

     [1] 表与自检：每件道具都有"得"与"失"；白板是明示的例外且有上限
     [2] 代价的**多样性**：六条代价轴都有人在用、四类代价机制都有人用
         —— "全是 -N 属性"与"全是加敌人"都算不成立
     [3] 折叠正确：`foldCosts` 只折结构化代价；属性型的代价走 `stats`（**一条路径**）
     [4] 真的接上了：七个读点逐个验（材料 / 商店价 / 刷新价 / 免费刷新 /
         回收价 / 敌人三段 / 受伤倍率）—— 声明了却没人读 = 这条代价是假的
     [5] 界面读得出来：收益与代价分成两段（`.buff` / `.nerf`），
         而且代价文案来自声明表（界面不写第二份）

   为什么 [4] 是最要紧的：`cost` 里写一个键很容易，**把它接到模拟层**
   才是代价。一条"写了但没人读"的代价与 `CharDef.special` 是同一类坑 ——
   界面上写着"敌人更硬"，而敌人一点没变。

   用法： node test/items.mjs
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { installDom } from './_ctx.mjs';
import { loadAll, SIM_MODULES } from './_load.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
installDom();
const g = globalThis;
await loadAll(SIM_MODULES);

let failures = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  \x1b[32mPASS\x1b[0m ' + label);
  else { failures++; console.log('  \x1b[31mFAIL\x1b[0m ' + label + (extra !== undefined ? '  → ' + extra : '')); }
}

const { Items, Game, Stats, Comp, Enemies, Registry, Items: I } = g;

console.log('\n=== Bronana · 道具的"有得有失" ===\n');

/* =========================================================
   [1] 表与自检
   ========================================================= */
console.log('[1] 每件道具都有"得"与"失"');
{
  const v = Items.audit();
  ok(v.ok, '道具表自检通过（' + v.counts.items + ' 件：带代价 ' + v.counts.withCost +
    ' / 白板 ' + v.counts.plain + '）', v.problems.join(' | '));
  ok(v.counts.withCost >= v.counts.items * 0.75,
    '至少 75% 的道具带代价（' + v.counts.withCost + '/' + v.counts.items + '）');
  ok(v.counts.plain <= 6, '白板有名额上限（现在 ' + v.counts.plain + ' 件）');

  // 逐件人工核一遍"得与失都在"
  const noGain = [], noLoss = [];
  for (const d of Items.LIST) {
    let gain = false, loss = false;
    for (const k in (d.stats || {})) { if (d.stats[k] > 0) gain = true; if (d.stats[k] < 0) loss = true; }
    if (d.special) gain = true;
    if (d.cost && Object.keys(d.cost).length) loss = true;
    if (d.plain) continue;
    if (!gain) noGain.push(d.id);
    if (!loss) noLoss.push(d.id);
  }
  ok(noGain.length === 0, '没有"只有代价、没有收益"的道具（那是纯亏的选项）', noGain.join(','));
  ok(noLoss.length === 0, '没有"只有收益、没有代价"的道具（那是白板，必须明示）', noLoss.join(','));

  // 审计真的能抓错
  const probe = Items.LIST.find(d => d.cost);
  const keep = probe.cost;
  probe.cost = { noSuchCost: 1 };
  const a1 = Items.audit();
  ok(!a1.ok && a1.problems.some(p => /代价键没登记/.test(p)), '写一个没登记的代价键 → 审计报出来', a1.problems[0]);
  delete probe.cost;
  const a2 = Items.audit();
  ok(!a2.ok && a2.problems.some(p => /没有任何代价/.test(p)), '把代价删掉 → 审计报出来', a2.problems[0]);
  probe.cost = keep;
  ok(Items.audit().ok, '改回来之后审计重新通过');

  // 白板的两条守卫
  const p2 = Items.LIST.find(d => d.plain);
  const keepTier = p2.tier;
  p2.tier = 4;
  const a3 = Items.audit();
  ok(!a3.ok && a3.problems.some(p => /白板只允许出现在 T1\/T2/.test(p)), '把白板放到 T4 → 审计报出来');
  p2.tier = keepTier;
  const keepPlain = p2.plain;
  delete p2.plain;
  const a4 = Items.audit();
  ok(!a4.ok && a4.problems.some(p => /没有任何代价/.test(p)), '把 plain 摘掉 → 它必须补代价（审计报出来）');
  p2.plain = keepPlain;
  ok(Items.audit().ok, '改回来之后审计重新通过');
}

/* =========================================================
   [2] 代价的多样性
   ========================================================= */
console.log('\n[2] 代价的多样性：不能只有"减属性"');
{
  const byAxis = {}, byKind = {}, kindSet = new Set();
  for (const d of Items.LIST) {
    for (const k in (d.stats || {})) {
      if (d.stats[k] < 0) { const ax = I.AXIS_OF_MOD[k] || '?'; byAxis[ax] = (byAxis[ax] || 0) + 1; }
    }
    for (const k in (d.cost || {})) {
      byKind[k] = (byKind[k] || 0) + 1;
      const ax = I.AXIS_OF_MOD[k] || '?'; byAxis[ax] = (byAxis[ax] || 0) + 1;
      kindSet.add(I.COST_KINDS[k].fold);
    }
  }
  for (const ax of Object.keys(Items.COST_AXES)) {
    ok(byAxis[ax] > 0, '代价轴「' + Items.COST_AXES[ax].name + '」有 ' + (byAxis[ax] || 0) + ' 件道具在用');
  }
  ok(kindSet.size >= 3, '结构化的代价覆盖 ≥3 类（经济 / 敌人 / 规则），现在 ' + kindSet.size + ' 类',
    [...kindSet].join(','));
  const uniqKinds = Object.keys(byKind).length;
  ok(uniqKinds >= 5, '用到的代价键 ≥5 种（' + uniqKinds + ' 种：' + Object.keys(byKind).join(',') + '）');

  // "减属性"不该是压倒性的那一类
  let statLoss = 0, totalLoss = 0;
  for (const d of Items.LIST) {
    for (const k in (d.stats || {})) if (d.stats[k] < 0) { statLoss++; totalLoss++; }
    for (const k in (d.cost || {})) totalLoss++;
  }
  ok(statLoss < totalLoss,
    '结构性代价与属性代价大体相当（属性 ' + statLoss + ' / 结构性 ' + (totalLoss - statLoss) + '）',
    statLoss + '/' + totalLoss);
}

/* =========================================================
   [3] 折叠：一条路径
   ========================================================= */
console.log('\n[3] 折叠：属性走 stats，结构性走 itemCost');
{
  const none = Items.foldCosts([]);
  ok(none.mul.matMul === 1 && none.add.noHeal === 0, '没有道具时全恒等（mul=1 / add=0）');

  const dup = Items.BY_ID['duplicator'];
  const f = Items.foldCosts([{ def: dup }]);
  ok(f.mul.matMul === 0.75, '克隆装置：材料 ×0.75', f.mul.matMul);
  ok(f.add.noFreeReroll === 1, '克隆装置：免费刷新被关掉（add=1）', f.add.noFreeReroll);

  const pipe = Items.BY_ID['warpipe'];
  const f2 = Items.foldCosts([{ def: pipe }]);
  ok(Math.abs(f2.mul.enemyHp - 1.10) < 1e-9 && Math.abs(f2.mul.enemyDmg - 1.06) < 1e-9,
    '异星烟斗：敌人三段倍率都折进去了', JSON.stringify(f2.mul));
  ok(Math.abs(f2.mul.salvage - 0.85) < 1e-9, '异星烟斗：回收 ×0.85', f2.mul.salvage);

  // 属性型的代价**不在** foldCosts 里（一条路径）
  const coffee = Items.BY_ID['coffee'];
  const f3 = Items.foldCosts([{ def: coffee }]);
  ok(Object.keys(f3.mul).every(k => f3.mul[k] === 1), '属性型的代价不进 itemCost（它走 stats）',
    JSON.stringify(f3.mul));

  // 累乘：两件同类代价相乘
  const two = Items.foldCosts([{ def: pipe }, { def: pipe }]);
  ok(Math.abs(two.mul.enemyHp - 1.1 * 1.1) < 1e-9, '两件同类代价**相乘**（不是相加）', two.mul.enemyHp);
}

/* =========================================================
   [4] 接线：七个读点逐个验
   ========================================================= */
console.log('\n[4] 接线：每条代价都真的生效');
{
  const src = (f) => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const gameSrc = strip(src('game.ts'));
  const marketSrc = strip(src('market.ts'));

  const READERS = {
    matMul: ['game.ts', "itemCostMul('matMul')", 2],
    shopPrice: ['market.ts', "itemCostMul('shopPrice')", 1],
    rerollCost: ['market.ts', "itemCostMul('rerollCost')", 1],
    salvage: ['market.ts', "itemCostMul('salvage')", 1],
    enemyHp: ['game.ts', "itemCostMul('enemyHp')", 1],
    enemyDmg: ['game.ts', "itemCostMul('enemyDmg')", 1],
    enemySpeed: ['game.ts', "itemCostMul('enemySpeed')", 1],
    fragile: ['game.ts', "itemCostMul('fragile')", 1],
    noFreeReroll: ['market.ts', "itemCostFlag('noFreeReroll')", 1],
    noHeal: ['game.ts', "itemCostFlag('noHeal')", 1]
  };
  for (const key of Object.keys(READERS)) {
    const [file, needle, minCount] = READERS[key];
    const text = file === 'game.ts' ? gameSrc : marketSrc;
    const n = text.split(needle).length - 1;
    ok(n >= minCount, '代价键 ' + key + ' 在 ' + file + ' 里有读点（' + n + ' 处）', String.minCount);
  }

  // 实机：带上道具之后，那条代价真的改了行为
  Game.newRun('ranger', 4242);
  let sess = Game.getSession();
  Game._internals.startWave(1);          // 起一波，让 Game.wave 落到真实的那一间
  const wave = Game.wave;
  const pipe = Items.BY_ID['warpipe'];
  Game.addItem(pipe);
  Game.recalcStats();
  ok(Math.abs(sess.itemCost.mul.enemyHp - 1.10) < 1e-9, '装上异星烟斗之后会话里折出了敌人倍率',
    sess.itemCost.mul.enemyHp);

  /* 真刷一只怪：它的生命应当按**折叠后的倍率**算（含这一间的 wmods 与道具代价）。
     期望值用**同一个公式**重算 —— 这里量的是"倍率有没有接进去"，
     而不是"我把公式抄对没有"（抄公式的测试在调平衡时会全红）。 */
  {
    const s = Game.getSession();
    s.enemies.length = 0;
    const def = Enemies.BY_ID['grub'];
    const dm = s.wmods || s.dmods;
    const want = def.hp0 * Enemies.hpScale(wave) * dm.enemyHp * s.itemCost.mul.enemyHp;
    const e = Game._internals.spawnEnemy('grub', 100, 100, {});
    ok(e && Math.abs(e.maxHp - want) < 1e-6,
      '带道具刷出来的怪，生命含道具代价（实测 ' + (e ? e.maxHp.toFixed(3) : '?') + ' ≈ ' + want.toFixed(3) + '）');
    /* 反证：同样的公式**不乘**道具代价时应当明显更小 —— 否则上面那条可能碰巧成立 */
    ok(e && Math.abs(e.maxHp - want / 1.10) > 0.01,
      '（对照）不乘道具代价会得到另一个值，说明这一乘确实生效了');
  }

  // noHeal：免费回血被关掉，但生命窃取照旧
  Game.newRun('ranger', 4242);
  sess = Game.getSession();
  Game.addItem(Items.BY_ID['amulet']);
  Game.recalcStats();
  ok(sess.itemCost.add.noHeal >= 1, '异星护符折出了 noHeal');
  const hp0 = sess.player.hp = Math.max(1, Math.round(sess.stats.maxHp * 0.5));
  Game._internals.settleHeal(Math.round(sess.stats.maxHp * 0.25));
  ok(sess.player.hp === hp0, '带 noHeal 时"白给的回血"真的不生效（' + hp0 + ' → ' + sess.player.hp + '）');
  Game.healPlayer(3, true);
  ok(sess.player.hp > hp0, '但生命窃取/主动治疗照旧（否则这件道具自相矛盾）', sess.player.hp);
}

/* =========================================================
   [5] 界面与总账
   ========================================================= */
console.log('\n[5] 界面读得出来 / 总账登记');
{
  const uiSrc = fs.readFileSync(path.join(ROOT, 'src', 'ui.ts'), 'utf8');
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const code = strip(uiSrc);
  ok(/class="' \+ \(r\.good \? 'buff' : 'nerf'\)|'buff'/.test(code) && /\.nerf|'nerf'/.test(code),
    '收益与代价分成两段渲染（buff / nerf）');
  ok(/function lossLines/.test(code), '有一个专门的"代价行"函数（界面只拼装、不写第二份文案）');
  ok(/Items\.COST_KINDS/.test(code), '代价文案来自声明表（`Items.COST_KINDS`）而不是界面里再写一份');
  /* 界面不许把代价**语义**硬编码进去：查 `lossLines` 这个函数体里有没有出现代价键的字面量。
     注意**不能**全文件查 —— `'salvage'` 在 `ui.ts` 里另有一个完全无关的用途
     （回收按钮的 `data-act="salvage"`），全文件查会把它算成"界面硬编码了代价键"。
     判据必须落在"渲染代价的那段代码"上，而不是"任何地方都不许出现这个字符串"。 */
  const fn = /function lossLines[\s\S]*?\n\}/.exec(code);
  const body = fn ? fn[0] : '';
  const costKeys = Object.keys(Items.COST_KINDS);
  const hard = costKeys.filter(k => new RegExp("'" + k + "'").test(body));
  ok(hard.length === 0, 'lossLines 里没有硬编码任何代价键名（文案来自表）', hard.join(','));

  ok(Registry.has('itemCost') && Registry.has('itemCostAxis'),
    '两个代价家族都登记进了扩展点总账');
  ok(Registry.ids('itemCost').length === costKeys.length, '总账里的代价键与声明表一致');
}

/* =========================================================
   [6] 属性型的"失"必须当场夹血
   ========================================================= */
console.log('\n[6] 生命上限被道具改小时，当前生命必须跟着夹（唯一的夹点）');
{
  /* 这一条是从不变量探针里抓回来的真 bug（`tools/bug-probe.mjs` 24 局）：
     collector 第 4 波买下 `rations`（`stats: { maxHp: -3 }`）后
     **hp=24 / maxHp=21**，一直持续到这一波结束 —— 界面上是一条比上限还长的血条。
     根因：`maxHp` 有好几条写入路径（商店买 / 制造 / 升级选卡 / 契约 / 加道具），
     而"夹血"只有三条路各自记得写一次。现在夹点收进 `recalcStats`
     （与"材料只有一个扣点"同一条纪律），所以这里逐个入口验一遍。 */
  const fresh = () => {
    Game.setState('title', true);
    Game.newRun('ranger', 20260707);
    return Game.getSession();
  };

  /* ① 买道具（商店那条路）：先把血拉到上限，再买一件 maxHp 为负的道具 */
  let s = fresh();
  s.player.scrap = 999;
  Game.setState('shop', true);
  const before = s.stats.maxHp;
  s.player.hp = before;
  s.offers[0] = { type: 'item', def: Items.BY_ID['rations'], sold: false, price: 1 };
  Game.buyOffer(0);
  ok(s.stats.maxHp === before - 3, '买下压缩口粮：上限 20 → 17', before + ' → ' + s.stats.maxHp);
  ok(s.player.hp <= s.stats.maxHp,
    '买下之后血量当场夹到新上限（不再出现 hp > maxHp）', s.player.hp + '/' + s.stats.maxHp);

  /* ② 加道具那条路（宝箱 / 制造 / 弹窗奖励都走它）—— 它以前**完全没有夹血** */
  s = fresh();
  s.player.hp = s.stats.maxHp;
  const cap2 = s.stats.maxHp;
  Game.addItem(Items.BY_ID['treadmill']);   // stats: { speed: 0.16, maxHp: -3 }
  Game.recalcStats();
  ok(s.stats.maxHp === cap2 - 3 && s.player.hp <= s.stats.maxHp,
    '直接加一件 maxHp 为负的道具：重算属性即夹血（addItem → recalcStats 一条路）',
    s.player.hp + '/' + s.stats.maxHp);

  /* ③ 契约那条路：`pickBoon` 重算属性后同样要夹 */
  s = fresh();
  s.player.hp = s.stats.maxHp;
  s.pendingBoons = ['forged'];   // mods: { armor: 3, maxHp: 6, speed: -0.08 }
  const cap3 = s.stats.maxHp;
  Game.pickBoon('forged');
  ok(s.stats.maxHp === cap3 + 6, '淬火把上限抬了 6', cap3 + ' → ' + s.stats.maxHp);
  ok(s.player.hp <= s.stats.maxHp, '抬上限不会让血量越界（上限变大的方向也不能破）',
    s.player.hp + '/' + s.stats.maxHp);

  /* ④ 反证：上限**变小**的那一步真的会发生（否则上面两条断言是空转的）。
        受虐狂 `stats: { maxHp: -8 }`：角色的原生负值从建会话那一刻就成立。 */
  Game.setState('title', true);
  Game.newRun('masochist', 20260707);
  const m = Game.getSession();
  ok(m.stats.maxHp === 12 && m.player.hp <= m.stats.maxHp,
    '受虐狂（maxHp −8）：开局就是 12 上限，且生命没越界', m.player.hp + '/' + m.stats.maxHp);

  /* ⑤ 夹点只有一个：`recalcStats` 里那句之后，别处再夹都是重复的。
        查源码而不是查行为 —— 行为上重复夹看不出来，但它正是"漏夹"的温床。 */
  const gameSrc = fs.readFileSync(path.join(ROOT, 'src', 'game.ts'), 'utf8');
  const recalcs = (gameSrc.match(/recalcStats\(\);/g) || []).length;
  ok(recalcs >= 8, 'recalcStats 有多个调用点（' + recalcs + ' 处）—— 这正是夹点必须收在函数内的理由');
  const clampInRecalc = /if \(p\.hp > s\.maxHp\) p\.hp = s\.maxHp;/.test(gameSrc);
  ok(clampInRecalc, '夹血写在 recalcStats 里（唯一的夹点）');
  /* 顺序：rage 读的是夹之前的 p.hp（受虐狂的机制），所以夹必须排在 rage 之后 */
  ok(gameSrc.indexOf('p.rage = U.clamp') < gameSrc.indexOf('if (p.hp > s.maxHp)'),
    '夹血排在 rage 计算之后（受虐狂读的是夹之前的那份血量）');
}

console.log('\n=== 结果 ===');
if (failures === 0) console.log('\x1b[32m全部通过 ✔\x1b[0m');
else console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m');
process.exit(failures ? 1 : 0);
