/* =========================================================
   talents.mjs — 角色天赋树（多级永久养成）

   这一轮的验收在这套里，而且它是一条**可执行**的断言：
     **天赋只能改"开局条件"。**
   落实成三条：
     1) 效果只认四种形态（起始属性 / 起始武器 / 起始道具 / 起始材料）——
        出现第五种就说明有人想往模拟层伸手
     2) `game.ts` 只在**建会话**时读 opening（静态检查：读它的位置只有那两处）
     3) 同一份（角色 + 种子 + 难度 + 天赋）逐位可复现；换天赋则确实不同
        —— 也就是"天赋是开局输入的一部分"，而不是"运行期的隐藏加成"

   另外守着：四级节点齐全、成本与扇区折扣、精通同类互斥、基石只能带一个、
   点数账目（点/撤销/洗点）、坏档里的脏天赋 id 被丢掉。

   用法： node test/talents.mjs
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { loadAll, SIM_MODULES } from './_load.mjs';
import { uiMissingActs } from './_acts.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
let failures = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  \x1b[32mPASS\x1b[0m ' + label);
  else { failures++; console.log('  \x1b[31mFAIL\x1b[0m ' + label + (extra !== undefined ? '  → ' + extra : '')); }
}

await loadAll(SIM_MODULES);
const { Talent, Profile, Game, Chars, Stats, Weapons, Items, Scene, Input, Storage, Registry, U } = globalThis;
console.error = function () { };

console.log('\n=== Bronana · 角色天赋树 ===\n');

/* ---------------- 1. 表自身 ---------------- */
console.log('[1] 天赋表的三层结构与自检');
{
  const a = Talent.audit();
  ok(a.ok === true, '定义期自检通过（' + a.counts.total + ' 条）', a.problems.slice(0, 4).join(' | '));

  ok(Object.keys(Talent.TYPES).length === 4, '四级节点齐全：' + Object.keys(Talent.TYPES).join('/'));
  ok(Talent.TYPES.minor.cost < Talent.TYPES.notable.cost &&
     Talent.TYPES.notable.cost <= Talent.TYPES.mastery.cost &&
     Talent.TYPES.mastery.cost < Talent.TYPES.keystone.cost,
    '成本随层级递增（' + ['minor', 'notable', 'mastery', 'keystone'].map(t => Talent.TYPES[t].cost).join('<') + '）');

  ok(Object.keys(Talent.SECTORS).length === 5, '五个共享扇区（四个战斗 + 一个经营）', Object.keys(Talent.SECTORS).join(','));
  const econNodes = Talent.LIST.filter(d => d.sector === 'economy');
  ok(econNodes.length === 6, '经营扇区 6 条节点', econNodes.length);
  ok(econNodes.every(d => d.effects.econ || d.effects.scrap ||
    (d.effects.stats && (d.effects.stats.harvesting || d.effects.stats.luck))),
    '经营扇区的每一条都在动"换钱效率"（折扣/收获/幸运/材料/孢子），而不是纯战力',
    econNodes.filter(d => !(d.effects.econ || d.effects.scrap ||
      (d.effects.stats && (d.effects.stats.harvesting || d.effects.stats.luck)))).map(d => d.id).join(','));
  const keystones = Talent.LIST.filter(d => d.type === 'keystone').length;
  ok(keystones >= 8, '基石数量够撑取舍（' + keystones + ' 个）');
  const masteries = Talent.LIST.filter(d => d.type === 'mastery');
  ok(masteries.every(d => d.mastery), '每条精通都有类别（否则互斥规则会失效）');
  const cats = new Set(masteries.map(d => d.mastery));
  ok(cats.size >= 3, '精通类别至少 3 类（才能互斥出选择）：' + [...cats].join(','));

  // 效果只认五种形态 —— 出现第六种就是有人想往模拟层伸手。
  // 2026-05 新增第五种 `econ`（经济修正）：它仍然是**开局条件的一部分**
  // （和 dmods/kmods 一样在建会话时折成一份、模拟里不回表），
  // 唯一的例外是 sporeMul —— 那个由档案层从会话上读，模拟层不认识它。
  const KINDS = ['stats', 'weapons', 'items', 'scrap', 'econ'];
  const badKind = [];
  Talent.LIST.forEach(d => {
    for (const k in d.effects) if (KINDS.indexOf(k) < 0) badKind.push(d.id + '.' + k);
  });
  ok(badKind.length === 0,
    '效果只有五种形态（起始属性/武器/道具/材料/经济修正）—— 这就是"只改开局条件"的边界',
    badKind.join(', '));

  // 经济修正的键**唯一声明**在 Talent.ECON_KEYS 里，且每个键都必须在代码里被真的读到。
  // "声明了却没人读" = 这条效果是假的（和据点那条同样的检查）。
  const econKeys = Object.keys(Talent.ECON_KEYS);
  // 读这些键的地方不止 game.ts：局内经济（商店/道具包/营地）已经在 market.ts 里
  const gameSrc = ['game.ts', 'market.ts']
    .map(f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8')).join('\n');
  const profSrc = fs.readFileSync(path.join(ROOT, 'src', 'profile.ts'), 'utf8');
  const unread = econKeys.filter(k =>
    gameSrc.indexOf("omod('" + k + "')") < 0 && gameSrc.indexOf('omods.' + k) < 0 &&
    profSrc.indexOf('omods.' + k) < 0 && profSrc.indexOf("omod('" + k + "')") < 0);
  ok(unread.length === 0,
    '每个经济键都在模拟层（game.ts / market.ts）或档案层里被读过（' + econKeys.join('/') + '）',
    unread.join(','));
  const badEcon = [];
  Talent.LIST.forEach(d => {
    for (const k in (d.effects.econ || {})) if (econKeys.indexOf(k) < 0) badEcon.push(d.id + '.' + k);
  });
  ok(badEcon.length === 0, '没有未登记的经济键', badEcon.join(', '));
  ok(econKeys.every(k => typeof Talent.ECON_CAP[k] === 'number'),
    '每个经济键都有上限（复利类不封顶会失控）');

  // 效果引用的东西必须存在
  const badRef = [];
  Talent.LIST.forEach(d => {
    (d.effects.weapons || []).forEach(id => { if (!Weapons.BY_ID[id]) badRef.push(d.id + '→weapon:' + id); });
    (d.effects.items || []).forEach(id => { if (!Items.BY_ID[id]) badRef.push(d.id + '→item:' + id); });
    for (const k in (d.effects.stats || {})) if (Stats.KEYS.indexOf(k) < 0) badRef.push(d.id + '→stat:' + k);
  });
  ok(badRef.length === 0, '效果引用的武器/道具/属性键都真实存在', badRef.join(', '));

  const audit = Registry.audit();
  const probs = audit.problems.filter(p => p.family === 'talent');
  ok(probs.length === 0, 'registry 审计对天赋家族不报错',
    probs.slice(0, 3).map(p => p.id + '.' + p.field + '=' + p.value).join(','));

  // 每个角色都有自己的本职子树，且看得到共享全图
  let noOwn = [], visBad = [];
  Chars.LIST.forEach(c => {
    const vis = Talent.visibleFor(c.id);
    if (!vis.some(d => Talent.OWNER[d.id] === c.id)) noOwn.push(c.id);
    if (!vis.some(d => !Talent.OWNER[d.id])) visBad.push(c.id);
    // 看不到别人的本职节点
    if (vis.some(d => Talent.OWNER[d.id] && Talent.OWNER[d.id] !== c.id)) visBad.push(c.id + '(串了)');
  });
  ok(noOwn.length === 0, '每个角色都有本职子树', noOwn.join(','));
  ok(visBad.length === 0, '每个角色都看得到共享全图、且看不到别人的本职节点', visBad.join(','));
}

/* ---------------- 2. 成本与扇区差价 ---------------- */
console.log('\n[2] 成本：跨扇区更贵，且层级序不能被压平');
{
  const m1 = Talent.BY_ID['m1'];      // 近战微点
  const r1 = Talent.BY_ID['r1'];      // 远程微点
  const brawler = 'brawler';          // 本命近战
  const sprinter = 'sprinter';        // 本命远程
  const ranger = 'ranger';            // 无本命

  ok(Talent.costFor(m1, brawler) === 1 && Talent.costFor(r1, brawler) === 2,
    '狂战士点近战是基准价、点远程 +1（' + Talent.costFor(m1, brawler) + ' / ' + Talent.costFor(r1, brawler) + '）');
  ok(Talent.costFor(r1, sprinter) === 1 && Talent.costFor(m1, sprinter) === 2, '疾行者反过来');
  ok(Talent.costFor(m1, ranger) === 1 && Talent.costFor(r1, ranger) === 1 &&
     Talent.costFor(Talent.BY_ID['m5'], ranger) === 3,
    '全能人没有本命扇区：所有扇区同价（不便宜也不贵）');
  ok(Talent.costFor(Talent.BY_ID['c_brawler'], brawler) === Talent.costFor(Talent.BY_ID['c_brawler'], ranger),
    '本职子树不参与扇区差价（它本来就是"你自己的"）');

  // 这条是实测抓到过的设计缺陷：本扇区 −1 会让显著点与微点同价，层级序被压平
  const inHome = ['m1', 'm3', 'm4', 'm5'].map(id => Talent.costFor(Talent.BY_ID[id], brawler));
  ok(inHome[0] < inHome[1] && inHome[1] === inHome[2] && inHome[2] < inHome[3],
    '本扇区内的层级序仍然成立：微点 < 显著点 = 精通 < 基石（' + inHome.join(' < ') + '）');
  const off = ['r1', 'r3', 'r4', 'r5'].map(id => Talent.costFor(Talent.BY_ID[id], brawler));
  ok(off[0] < off[1] && off[3] > off[0], '跨扇区同样保持层级序（' + off.join(' < ') + '）');
  ok(Talent.costFor(Talent.BY_ID['m5'], brawler) === 3,
    '基石在本扇区仍是 3 点（不会被折成白菜价）', Talent.costFor(Talent.BY_ID['m5'], brawler));
}

/* ---------------- 3. 互斥规则 ---------------- */
console.log('\n[3] 互斥：精通同类只能选一次、基石只能带一个');
{
  const cid = 'brawler';
  const earned = 30;
  // 先点一个近战精通
  let taken = ['m4'];
  let chk = Talent.canTake(cid, 'r4', taken, earned);
  ok(!chk.ok && /这一类/.test(chk.reason), '同类精通不能选第二次（m4 已选，r4 被拒）', chk.reason);
  // 不同类别的精通可以
  chk = Talent.canTake(cid, 'e4', taken, earned);
  ok(chk.ok, '不同类别的精通可以选（offense 已选，economy 仍可）', chk.reason);
  // 基石只能带一个
  taken = ['m5'];
  chk = Talent.canTake(cid, 'r5', taken, earned);
  ok(!chk.ok && /基石/.test(chk.reason), '已经带了一个基石 → 第二个被拒', chk.reason);
  taken = [];
  chk = Talent.canTake(cid, 'm5', taken, earned);
  ok(chk.ok, '洗掉之后可以换另一个基石');
  // 点数不够
  chk = Talent.canTake(cid, 'm5', [], 1);
  ok(!chk.ok && /不够/.test(chk.reason), '点数不够被拒', chk.reason);
  // 别人的本职天赋
  chk = Talent.canTake('brawler', 'c_mage', [], 30);
  ok(!chk.ok && /别的角色/.test(chk.reason), '别的角色的本职天赋点不了', chk.reason);
  // 重复
  chk = Talent.canTake(cid, 'm1', ['m1'], 30);
  ok(!chk.ok && /已经点过/.test(chk.reason), '同一条不能点两次', chk.reason);
  // 成本按角色算
  ok(Talent.spentOn(['m1', 'm5'], 'brawler') === 1 + 3, '已花点数按该角色的成本算（微点1 + 基石3）',
    Talent.spentOn(['m1', 'm5'], 'brawler'));
  ok(Talent.spentOn(['r1', 'r5'], 'brawler') === 2 + 4, '跨扇区更贵（远程微点2 + 远程基石4）',
    Talent.spentOn(['r1', 'r5'], 'brawler'));
}

/* ---------------- 4. 开局条件的折叠 ---------------- */
console.log('\n[4] 折叠成开局条件（天赋唯一的出口）');
{
  const opening = Talent.openingFor('brawler', ['m1', 'm2', 'm5', 'c_brawler', 'k_brawler']);
  ok(opening.stats.maxHp === 5 - 4, '属性增量相加（厚皮 +5、狂徒 −4）', opening.stats.maxHp);
  ok(opening.stats.armor === 2 + 1, '多个节点的同一属性会累加', opening.stats.armor);
  ok(Math.abs(opening.stats.damage - 0.25) < 1e-9, '百分比类用小数', opening.stats.damage);
  ok(opening.scrap === 0 && opening.weapons.length === 0, '没带武器/材料就是空的');

  const eng = Talent.openingFor('engineer', ['e5', 'k_engineer', 'e2']);
  ok(eng.items.indexOf('turretitem') >= 0, '基石可以给起始道具', eng.items.join(','));
  ok(eng.weapons.indexOf('turretgun') >= 0, '基石可以给起始武器', eng.weapons.join(','));
  ok(eng.scrap === 30, '微点可以给起始废料', eng.scrap);

  // 别人的本职天赋不生效（脏数据防线）
  const dirty = Talent.openingFor('brawler', ['c_mage', 'm1']);
  ok(dirty.stats.elementalDmg === undefined && dirty.stats.maxHp === 5,
    '别人的本职天赋折进来也不生效', JSON.stringify(dirty.stats));

  ok(Talent.openingFor('ranger', []).scrap === 0, '空天赋 = 空开局条件');
}

/* ---------------- 5. 点数来源 ---------------- */
console.log('\n[5] 天赋点从哪来');
{
  ok(Talent.pointsForRun({ win: true, wave: 20, danger: 0 }) === 2 + 3,
    '通关第 0 级：2+0 点，加上 10/15/20 波里程碑 3 点 = ' + Talent.pointsForRun({ win: true, wave: 20, danger: 0 }),
    Talent.pointsForRun({ win: true, wave: 20, danger: 0 }));
  ok(Talent.pointsForRun({ win: true, wave: 20, danger: 5 }) > Talent.pointsForRun({ win: true, wave: 20, danger: 0 }),
    '难度越高给得越多（鼓励爬梯）');
  ok(Talent.pointsForRun({ win: false, wave: 5 }) === 0, '没到第 10 波且没通关 → 0 点');
  ok(Talent.pointsForRun({ win: false, wave: 12 }) === 1, '打到第 10 波也给 1 点（打不过不等于零成长）');
  ok(Talent.pointsForRun({ win: false, wave: 20 }) === 3, '打到第 20 波给 3 点');
  ok(Talent.pointsForRun(null) === 0, '空输入安全');
}

/* ---------------- 6. 账目（训练产点 / 点 / 撤销 / 洗点） ---------------- */
console.log('\n[6] 账目：训练产成长点、点天赋、撤销、洗点');
{
  Storage.use(Storage.memory(Object.create(null)));
  Storage.wipe();
  Profile.reset();
  const cid = 'brawler';

  /* ⚠ **语义反转**（M3，2026-09）：天赋与成长点都**住在局内**了。
     它们以前是账号级的 —— 结算是唯一的产出（通关给点），点是"累计预算"。
     现在：① 产出走**训练**（`Game.train`：花材料换成长点）
           ② 天赋**花成长点余额**（`Talent.canTake` 的 `balance` 语义）
     所以这一块必须**先起一局**才有状态可测。 */
  Game.newRun(cid, 4242, 0, null, null);
  Game.addMaterial(1000);
  ok(Game.talentsOf().length === 0 && Game.growth() === 0, '开局没有天赋、也没有成长点');

  /* 产出：训练三次「突破」（每波上限 3 次） */
  const gains = [Game.train('breakthrough'), Game.train('breakthrough'), Game.train('breakthrough')];
  ok(gains.every(g => g.ok), '三次训练都成功（材料足够）');
  ok(Game.train('breakthrough').ok === false, '每波训练次数有上限（第 4 次被拒）');
  const earned = Game.growth();
  ok(earned === gains.reduce((s, g) => s + g.gain, 0), '成长点 = 三次训练的产出之和（' + earned + '）', earned);

  /* 点天赋：花成长点余额 */
  let r = Game.takeTalent('m1');
  const afterOne = Game.growth();
  ok(r.ok && r.cost === 1 && afterOne === earned - 1, '点一条扣 1 点成长（' + earned + ' → ' + afterOne + '）', afterOne);
  ok(Game.talentsOf().join(',') === 'm1', '记到了**这一局**里');
  ok(Game.takeTalent('m1').ok === false, '重复点被拒');

  /* 成本按节点档位累加（微点 1 + 微点 1 + 显著点 2） */
  Game.takeTalent('m2');
  Game.takeTalent('m3');
  const spentNow = Talent.spentOn(Game.talentsOf(), cid);
  const free2 = Game.talentFree();
  ok(free2 === earned - spentNow && spentNow === 1 + 1 + 2,
    '成本累计正确（微点1 + 微点1 + 显著点2）', free2 + ' / 已花 ' + spentNow);

  /* 撤销免费，且只撤最后一个，**成长点退回来** */
  const before = Game.talentFree();
  ok(Game.undoTalent() === true && Game.talentFree() === before + 2, '撤销上一点把成长点还回来',
    before + ' → ' + Game.talentFree());
  ok(Game.talentsOf().join(',') === 'm1,m2', '撤掉的是最后一条', Game.talentsOf().join(','));

  /* 洗点：前几次免费 */
  ok(Game.respecTalents(cid).cost === 0, '第一次洗点免费');
  ok(Game.talentsOf().length === 0 && Game.talentFree() === earned, '洗点把成长点全还回来');
  ok(Game.respecTalents(cid).ok === false, '没点过天赋时洗点被拒');

  /* 免费次数用完 → 开始花材料 */
  for (let i = 0; i < Talent.FREE_RESPECS; i++) { Game.takeTalent('m1'); Game.respecTalents(cid); }
  Game.takeTalent('m1');
  const cost = Game.respecTalents(cid).cost;
  ok(cost === Talent.RESPEC_COST, '免费次数用完 → 洗点要花材料（' + cost + '）', cost);
  ok(Game.respecTalents(cid).ok === false, '材料不够时洗点被拒（此时已洗过，无天赋可洗）');
  Game.addMaterial(100);
  Game.takeTalent('m1');
  const matsBefore = Game.material();
  const paid = Game.respecTalents(cid);
  ok(paid.ok && paid.cost === Talent.RESPEC_COST && Game.material() === matsBefore - Talent.RESPEC_COST,
    '材料够 → 扣掉并洗成功', matsBefore + ' → ' + Game.material());

  /* 洗点把成长点退回来 —— 余额语义与原来'累计预算'语义的分界点：
     不退的话那些成长点就凭空消失了。 */
  ok(paid.refund === Talent.spentOn(['m1'], cid), '洗点退还的数额 = 已投进天赋的那一份', paid.refund);
}
console.log('\n[7] 验收：天赋是"开局输入的一部分"，不是运行期隐藏加成');
{
  // (a) 静态：game.ts 只在建会话时读 opening
  const gameSrc = fs.readFileSync(path.join(ROOT, 'src', 'game.ts'), 'utf8');
  /* **先剥注释再数**：这条测的是"代码在哪里碰 opening"，而注释里提一句
     `Game.newRun(…, data.opening)` 会把计数推上去 —— 于是它变成一条
     "谁的说明文字多谁违规"的规则（和 arch-audit 那条校验踩过的坑是同一个）。 */
  const gameCode = gameSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const openingUse = (gameCode.match(/opening/g) || []).length;
  ok(openingUse > 0 && openingUse < 20,
    'game.ts 里 opening 只出现在少数几处（应用开局条件那一段），共 ' + openingUse + ' 处');
  const inNewSession = /function newSession\(charDef, seed, danger, opening/.test(gameSrc);
  ok(inNewSession, 'newSession 把 opening 作为入口参数（后面还可以有别的开局来源）');
  ok(/function applyOpening\(p, opening\)/.test(gameSrc) && /function applyOpeningExtras\(p, opening\)/.test(gameSrc),
    '应用集中在两个小函数里（属性 / 携带）');
  // 模拟层不认识"天赋"这个词。**先去掉注释再查** ——
  // 否则"这个对象由 talents.ts 折出来"这类说明会误报成反向依赖。
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    /* ⚠ **射程在 M3 收窄了**：`game.ts` 是**会话层**，而 v3 §二 说三个模块
     （战斗 / 经营 / 养成）**全在局内** —— 所以会话层认识 `Talent` 是**对的**。
     该守的是**更下面的模拟层**（敌人 / AI / 数值 / 碰撞 / 竞技场）：
     那一层不该知道'天赋'这个概念，否则就成了'运行期的隐藏加成'（E43 的原意）。 */
  const simFiles = ['enemies.ts', 'ai.ts', 'emit.ts', 'stats.ts', 'collide.ts', 'arena.ts', 'depth.ts'];
  const leak = [];
  simFiles.forEach(f => {
    const src = strip(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8'));
    if (/\bTalent\b|talents\.ts|perChar/.test(src)) leak.push(f);
  });
  ok(leak.length === 0, '模拟层不认识 Talent / talents.ts / perChar（没有反向依赖）', leak.join(','));

  // (b) 同一份（角色+种子+难度+天赋）逐位可复现
  const replayStep = (x, y) => {
    if (Scene.simulates(Game.state)) Game.step(Game.cfg.fixedDt, { x: x, y: y });
    Input.endFrame();
  };
  const fingerprint = (opening) => {
    Game.newRun('brawler', 20260502, 0, opening);
    let h = 2166136261 >>> 0;
    for (let f = 0; f < 500; f++) {
      const inp = { x: Math.cos(f * 0.05), y: Math.sin(f * 0.05) };
      if (Scene.simulates(Game.state)) Game.step(Game.cfg.fixedDt, inp);
      Input.endFrame();
      const s = Game.getSession();
      const str = [s.player.x, s.player.y, s.player.hp, Game.wave].join(',');
      for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    }
    return h;
  };
  const noTalents = Talent.openingFor('brawler', []);
  const buildA = Talent.openingFor('brawler', ['m1', 'm3']);
  const buildB = Talent.openingFor('brawler', ['m5', 'k_brawler']);

  const f1 = fingerprint(noTalents);
  const f2 = fingerprint(noTalents);
  ok(f1 === f2, '同一份开局条件跑两次 → 逐位一致（确定性没被破坏）', f1 + ' / ' + f2);

  const fa = fingerprint(buildA);
  const fb = fingerprint(buildB);
  ok(fa !== f1 && fb !== f1 && fa !== fb,
    '换天赋 → 对局确实不同（天赋真的生效，而且不同流派不一样）',
    [f1, fa, fb].join(' / '));

  // 反过来：不传 opening 与传"空 opening"必须一致（否则没点天赋的人也被改了）
  ok(fingerprint(undefined) === fingerprint({ stats: {}, weapons: [], items: [], scrap: 0 }),
    '不传 opening 与传空 opening 逐位一致（没点天赋的人完全不受影响）');

  // (c) 开局条件真的落到了会话里
  Game.newRun('brawler', 1, 0, Talent.openingFor('brawler', ['m1', 'm2', 'c_brawler']));
  const s = Game.getSession();
  const expectHp = Stats.base().maxHp + (Chars.BY_ID['brawler'].stats.maxHp || 0) + 5;
  ok(s.player.base.maxHp === expectHp, '起始属性并进了 base（' + expectHp + '）', s.player.base.maxHp);
  ok(s.opening && s.opening.stats.maxHp === 5, '会话里留着开局条件（存档续玩要带着它）',
    JSON.stringify(s.opening.stats));

  // 存档往返：天赋不能丢
  const payload = Game.exportRun();
  ok(payload.opening && payload.opening.stats.maxHp === 5, '导出的一局带着开局条件');
  const back = Game.importRun(payload);
  ok(back && back.player.base.maxHp === expectHp, '读档之后天赋仍然生效（不会静默丢养成）',
    back ? back.player.base.maxHp : 'null');
  Game.setState('title', true);
}

/* ---------------- 8. 坏档防线 ---------------- */
console.log('\n[8] 坏档：脏天赋 id 被丢掉');
{
  Storage.use(Storage.memory(Object.create(null)));
  Storage.wipe();
  Storage.setJSON(Storage.KEYS.profile, {
    v: 1, at: Date.now(), kind: 'profile',
    data: {
      perChar: {
        brawler: { runs: 1, points: 10, talents: ['m1', 'c_mage', '不存在的节点', 'm1', 42] }
      }
    }
  });
  Profile.load();
  const t = Profile.talentsOf('brawler');
  ok(t.join(',') === 'm1', '只留下这个角色可见且真实存在的节点（去重、去掉别人的与不存在的）',
    t.join(','));
  ok(Profile.talentSpent('brawler') === 1, '脏数据不会虚增已花点数', Profile.talentSpent('brawler'));
  const points = Profile.talentPoints('brawler');
  ok(points === 10, '累计点数保留', points);
}

/* ---------------- 9. 界面契约 ---------------- */
console.log('\n[9] 界面与场景');
{
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  ok(/id="scr-talents"/.test(html), 'index.html 里有天赋场景');
  ok(/data-act="talents"/.test(html) && /data-act="talent-take"/.test(html) === false,
    '入口按钮在（天赋节点按钮是动态生成的）');
  ok(/data-act="talent-respec"/.test(html) && /data-act="talent-undo"/.test(html), '洗点与撤销按钮在');
  ok(Scene.has('talents') && Scene.overlayOf('talents') === 'talents', '场景表里有 talents');
  ok(Game.TRANSITIONS.chars.indexOf('talents') >= 0, '选人页能进天赋页');
  ok(Scene.refreshOf('talents') === 'talents', '天赋页在场景表的刷新表里');
  const uiSrc = fs.readFileSync(path.join(ROOT, 'src', 'ui.ts'), 'utf8');
  const missing = await uiMissingActs(['talent-take', 'talent-undo', 'talent-respec', 'talent-char']);
  ok(missing.length === 0, '天赋的四个动作都注册在界面动作表里（不再靠源码里找 case）',
    missing.join(','));
  ok(/data-act="talent-take"/.test(uiSrc), '天赋节点按钮带着 data-act="talent-take"');
}

/* ---------------- 10. 经营扇区（养成 → 经营 那条边） ---------------- */
console.log('\n[10] 经营扇区：折扣与孢子真的生效，且"空开局"是恒等');
{
  Storage.use(Storage.memory(Object.create(null)));
  Storage.wipe();
  Profile.reset();

  // 折叠：加法 + 单项封顶
  const op = Talent.openingFor('ranger', ['g3', 'g5']);
  ok(Math.abs(op.econ.shopDiscount - (0.08 + 0.12)) < 1e-9, '同一键的多个来源相加（议价 8% + 商会 12%）',
    op.econ.shopDiscount);
  ok(Math.abs(op.econ.sporeMul - 0.60) < 1e-9, '孢子倍率来自基石（+60%）', op.econ.sporeMul);
  ok(Talent.openingFor('ranger', []).econ.sporeMul === 0, '空天赋 → 经济修正全 0（恒等）');
  ok(Object.keys(Talent.openingFor('ranger', []).econ).length === Object.keys(Talent.ECON_KEYS).length,
    '折出来的对象把每个键都写全（不缺键，就不需要读的时候兜底）');
  // 越界输入被夹回上限，而且**上限只有一份真值**（sanitizeOpening 里的表 vs Talent.ECON_CAP）
  const wild = { stats: {}, weapons: [], items: [], scrap: 0, econ: {} };
  Object.keys(Talent.ECON_KEYS).forEach(k => { wild.econ[k] = 99; });
  Game.newRun('ranger', 4242, 0, wild, null);
  const wom = Game.getSession().omods;
  const capBad = Object.keys(Talent.ECON_KEYS).filter(k => Math.abs(wom[k] - Talent.ECON_CAP[k]) > 1e-9);
  ok(capBad.length === 0,
    '模拟层里的夹取上限与 Talent.ECON_CAP 逐个一致（两份数值不许漂移）',
    capBad.map(k => k + ':' + wom[k] + '≠' + Talent.ECON_CAP[k]).join(','));
  ok(Talent.ECON_CAP.shopDiscount === 0.6, '折扣上限 0.6（与据点/营地同一套）');
  ok(Talent.ECON_CAP.sporeMul === 0.85, '孢子倍率的单项上限 = 两个孢子节点叠满（+85%）');

  /* ---- 每波**材料**（waveIncome）：与击杀脱钩的那一半，靠它经济流才立得住 ----
     ⚠ 这里曾经断言 `player.scrap`（废料）—— 而键名、天赋文案（"每波 +8 材料"）
     与 `talents.ts` 的键说明三处说的都是**材料**，模拟层实现的却是废料。
     键名与实现分叉 4 个字段、3 份文档，谁都没红。它只在 `tools/balance.mjs`
     上显形：经济流换个货币变富，于是"战斗流在所有指标上都不弱于他人"。
     现在断言落在**材料**上 —— 那才是这个键名承诺的东西。 */
  /* ⚠ **材料是局内余额**（M1）：起新一局会**重置**它，
     所以不能拿上一局的余额当基线 —— 基线就是"开局"，而开局是 0。 */
  Game.newRun('ranger', 4242, 0, { stats: {}, weapons: [], items: [], scrap: 0, econ: { waveIncome: 20 } }, null);
  const si = Game.getSession();
    ok(Game.material() === 20,
      '开局第一波就到账的是**材料**（每波 +20 → 材料 20）',
      String(Game.material()));
  ok(si.materialEarned === 20,
    '并且记进了这一局的"打到多少材料"（结算与界面展示读它）', String(si.materialEarned));
  ok(si.player.scrap === 0 && si.stats_total.scrap === 0,
    '**一废料都不给**（材料与废料是两种货币，不能互换）',
    'p.scrap=' + si.player.scrap + ' total=' + si.stats_total.scrap);

    /* 材料是**局内余额**：`newRun` 一开就把上一局的数重置掉，
     所以基线只能是「开局 0」，而 `newRun` 里第一波已经产了 6。 */
  Game.newRun('ranger', 4242, 0, Talent.openingFor('ranger', ['g6']), null);
  ok(Game.material() === 6,
    '「库存」每波 +6 材料', String(Game.material()));

  /* 空开局 = 材料 0（恒等）—— 基线同样是「这一局」，不是上一局。 */
  Game.newRun('ranger', 4242, 0, null, null);
  ok(Game.material() === 0 && Game.getSession().materialEarned === 0,
    '空开局 → 一分不给（恒等，这是行为指纹不受影响的前提）',
    String(Game.material()));

  // 互斥：经营扇区的精通与工程扇区的「经济精通」是同一类 → 只能选一个
  const both = ['e4', 'g4'];
  ok(Talent.canTake('engineer', 'g4', ['e4'], 99).ok === false,
    '「经济精通」与「商人」同类互斥（同类精通全树只能选一次）',
    Talent.canTake('engineer', 'g4', ['e4'], 99).reason);
  ok(Talent.canTake('engineer', 'g4', [], 99).ok === true, '没选过同类时可选');
  void both;

  /* ---- 端到端：折扣在局里真的落到价格上 ---- */
  // 商店的滚动发生在 openShop()（换波结束时），所以这里显式调它 —— 与 camp.mjs 同一手法
  const priceWith = (taken, what) => {
    Game.newRun('ranger', 4242, 0, Talent.openingFor('ranger', taken), null);
    Game.setState('shop', true);
    Game._internals.openShop(0);
    const sess = Game.getSession();
    if (what === 'shop') return sess.offers[0].price;
    if (what === 'reroll') return sess.rerollCost;
    return Game.packPrice('normal');
  };
  const luck = () => Game.getSession().stats.luck;
  const base = priceWith([], 'shop');
  const cheap = priceWith(['g3', 'g5'], 'shop');
  const raw = () => {
    const s = Game.getSession();
    // 货架价 = 基础价 × 难度修正 × **应急溢价**（装备主要靠制造，货架是应急）
    return globalThis.Weapons.priceOf(s.offers[0].def, s.stats.luck) * globalThis.Craft.EMERGENCY_MARKUP;
  };
  priceWith([], 'shop');
  const rawBase = raw();
  priceWith(['g3', 'g5'], 'shop');
  const rawCheap = raw();
  ok(cheap < base, '商店价被天赋压低了（' + base + ' → ' + cheap + '）', base + ' → ' + cheap);
  ok(cheap === Math.max(1, Math.round(rawCheap * (1 - 0.20))),
    '折扣是加法的 20%，不是两级相乘（' + cheap + '）', cheap);
  ok(rawCheap === rawBase, '（对照）压的是折扣而不是改了基础价', rawBase + ' / ' + rawCheap);
  void priceWith;

  // 刷新价：第 1 波底价只有 2，12% 的折扣会被四舍五入吃掉（0.24 → 0），
  // 所以这里在第 6 波上验 —— 顺便说明"折扣在小额上天然不显眼"这件事是真的。
  const rerollAt = (taken) => {
    Game.newRun('ranger', 4242, 0, Talent.openingFor('ranger', taken), null);
    Game.wave = 6;
    Game.setState('shop', true);
    Game._internals.openShop(0);
    return Game.getSession().rerollCost;
  };
  const rrBase = rerollAt([]), rrCheap = rerollAt(['g3']);
  ok(rrCheap < rrBase, '刷新价被「议价」压低（第 6 波：' + rrBase + ' → ' + rrCheap + '）');
  ok(rrCheap === Math.max(0, Math.round(rrBase * (1 - 0.12))),
    '刷新折扣按 12% 算（' + rrBase + ' × 0.88 → ' + rrCheap + '）');
  Game.newRun('ranger', 4242, 0, Talent.openingFor('ranger', ['g3']), null);
  Game.setState('shop', true);
  Game._internals.openShop(0);
  ok(Game.getSession().rerollCost === 2, '（已知）第 1 波底价太小，12% 被取整吃掉（2 → 2）');

  const pkBase = priceWith([], 'pack'), pkCheap = priceWith(['g3', 'g5'], 'pack');
  ok(pkCheap < pkBase, '道具包价同样吃折扣（' + pkBase + ' → ' + pkCheap + '）');

  // 营地价格：天赋「商会」也要作用在 campOpts 上
  Game.newRun('ranger', 4242, 0, Talent.openingFor('ranger', ['g5']), null);
  const s5 = Game.getSession();
  ok(Math.abs(s5.omods.campDiscount - 0.25) < 1e-9, '会话里带着折叠好的经济修正（omods）');

  /* ---- 空开局 = 一点影响都没有（行为指纹靠这条） ---- */
  Game.newRun('ranger', 4242, 0, null, null);
  const none = Game.getSession();
  ok(none.omods.shopDiscount === 0 && none.omods.campDiscount === 0 &&
    none.omods.rerollDiscount === 0 && none.omods.sporeMul === 0,
    '不传开局 → omods 全 0');
  const noOpenPrice = priceWith([], 'shop');
  Game.newRun('ranger', 4242, 0, { stats: {}, weapons: [], items: [], scrap: 0 }, null);
  Game.setState('shop', true);
  Game._internals.openShop(0);
  ok(Game.getSession().offers[0].price === noOpenPrice,
    '不传开局 与 传"空开局对象" 价格逐位一致（恒等）');

  /* ---- 产出倍率：**现在量的是"训练"**（M3 把养成代币的产出搬进了养成端）----

/* ⚠ **语义反转**（M3，2026-09）：结算**不再发**养成代币。
   它以前在这里发两笔（打得深 + 合成），而那两条都产在**战斗动作**上 ——
   v3 §5.2 的边是 战斗→经营→养成→战斗，**没有"战斗 → 养成"**。
   现在产出点在 `Game.train`（养成模块内部：花材料换成长点）。
   所以天赋的 `sporeMul` 也从"乘结算"改指到"乘训练产出"上 ——
   指到结算上的话，那两条天赋节点会**完全没有作用**。 */
const trainOnce = (omods) => {
  Storage.wipe(); Profile.reset();
  Game.newRun('ranger', 4321, 0, { stats: {}, weapons: [], items: [], scrap: 0, econ: omods }, null);
  Game.addMaterial(100);
  const before = Game.growth();
  const r = Game.train('drill');
  return { gain: Game.growth() - before, ok: r.ok, reason: r.reason };
};
const plain = trainOnce(null);
ok(plain.ok && plain.gain === Train.BY_ID['drill'].gain, '不点天赋时训练拿基础产出（' + plain.gain + '）');
const withTalent = trainOnce({ sporeMul: 0.15 });
ok(withTalent.gain === Math.round(Train.BY_ID['drill'].gain * 1.15),
  '天赋产出节点按倍率生效（' + plain.gain + ' → ' + withTalent.gain + '）', withTalent.gain);
const withMax = trainOnce({ sporeMul: Talent.ECON_CAP.sporeMul });
ok(withMax.gain === Math.round(Train.BY_ID['drill'].gain * (1 + Talent.ECON_CAP.sporeMul)),
  '两个节点叠满 = +' + Math.round(Talent.ECON_CAP.sporeMul * 100) + '%（' + withMax.gain + '）', withMax.gain);
/* 据点**不再**乘这条曲线了（那一条是"据点数值穿透"，已删）：
   把 `kmods.sporeMul` 硬塞进来也不该变 —— 这条断言守的就是"删干净了"。 */
const withFakeKeep = (() => {
  Storage.wipe(); Profile.reset();
  Game.newRun('ranger', 4321, 0, { stats: {}, weapons: [], items: [], scrap: 0, econ: { sporeMul: Talent.ECON_CAP.sporeMul } }, null);
  Game.getSession().kmods.sporeMul = 0.5;      // 已经不存在这一条：假的修正不该生效
  Game.addMaterial(100);
  const before = Game.growth();
  Game.train('drill');
  return Game.growth() - before;
})();
ok(withFakeKeep === Math.round(Train.BY_ID['drill'].gain * (1 + Talent.ECON_CAP.sporeMul)),
  '据点不再影响这条产出（只剩天赋那一份：' + withFakeKeep + '）', withFakeKeep);
  ok(Profile.SPORE_MUL_CAP >= Talent.ECON_CAP.sporeMul,
    '天赋的上限仍在（' + Profile.SPORE_MUL_CAP + ' ≥ ' + Talent.ECON_CAP.sporeMul + '）');
  Profile.reset();
}

console.log('\n=== 结果 ===');
if (failures === 0) { console.log('\x1b[32m全部通过 ✔\x1b[0m\n'); process.exit(0); }
console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m\n');
process.exit(1);
