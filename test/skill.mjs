/* =========================================================
   skill.mjs — **技能 / 技能树 / 技能构筑 / 战斗模式**
   ---------------------------------------------------------
   这一套守的是这一轮新增的整块系统。它的判据分四层，每层问一个不同的问题：

     [1] **表立不立得住**：形 × 效 × 符文三张表自洽、技能的 owner 是真角色、
         每个角色至少两个专属技能、每张卡三选一、**每个角色都有树**。
     [2] **构筑折得对不对**：折叠是纯函数；符文真的改了参数（不是写了个没人读的键）；
         空构筑**恒等**（这是行为指纹不变的前提 —— 也是最要紧的一条）。
     [3] **模拟层真的会放**：自动模式冷却好了自己放、手动模式**不按不放**、
         能量不够时被拒、命中真的掉血、冷却与能量真的被扣。
     [4] **改默认档会不会动到既有行为**：`combatMode` 默认必须是 `auto`，
         空构筑必须一个技能槽都没有 —— 这两条一起保证"没点技能树的玩家"与改造前逐位相同。

   ⚠ [2] 的"符文真的生效"最容易被写成假判据：如果只验"折叠不抛错"，
   那么"符文写了个没人读的键"（自检说它在 `KNOWN_MODS` 里，但折叠函数忘了实现）
   会悄悄溜过去。所以这里**逐条比对折叠前后的参数**，而不是只看它没抛。

   用法： node test/skill.mjs
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { installDom } from './_ctx.mjs';
import { loadAll, SIM_MODULES, holdRoom } from './_load.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
let failures = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  \x1b[32mPASS\x1b[0m ' + label);
  else { failures++; console.log('  \x1b[31mFAIL\x1b[0m ' + label + (extra !== undefined ? '  → ' + extra : '')); }
}

installDom();
await loadAll(SIM_MODULES);
const { Skills, Chars, Game, Profile, Settings, Storage, Slots, Elems } = globalThis;

console.log('\n=== Bronana · 技能 / 技能树 / 战斗模式 ===\n');

/* =========================================================
   [1] 三张表立不立得住
   ========================================================= */
console.log('[1] 表：形 × 效 × 符文 × 每角色一张树');
{
  Skills.make({ chars: () => Chars.LIST });
  const v = Skills.audit();
  const extra = v.counts.skills + ' 技能 · ' + v.counts.forms + ' 形 · ' +
    v.counts.payloads + ' 效 · ' + v.counts.runes + ' 符文 · ' + v.counts.trees + ' 棵树';
  ok(v.ok, '注入角色表之后自检通过（' + extra + '）', v.problems.join(' | '));

  ok(v.counts.forms >= 4 && v.counts.payloads >= 5,
    '形与效都够多（' + v.counts.forms + '×' + v.counts.payloads +
    ' 的组合空间才是"构筑"而不是一条线）');
  ok(v.counts.skills >= 15, '技能数量够（' + v.counts.skills + ' 个）');

  /* 每个角色至少两个专属技能 —— "每个角色的技能都不一样"这句话的可验证形式 */
  const thin = [];
  for (const c of Chars.LIST) {
    const own = Skills.LIST.filter(s => s.owner === c.id);
    if (own.length < 2) thin.push(c.id + ':' + own.length);
  }
  ok(thin.length === 0, '每个角色都有至少两个**专属**技能（不是大家都用通用技能）', thin.join(','));

  /* 两个角色的技能集合不能一模一样 */
  const same = [];
  for (const a of Chars.LIST) {
    for (const b of Chars.LIST) {
      if (a.id >= b.id) continue;
      const sa = Skills.LIST.filter(s => s.owner === a.id).map(s => s.id).join(',');
      const sb = Skills.LIST.filter(s => s.owner === b.id).map(s => s.id).join(',');
      if (sa === sb) same.push(a.id + '=' + b.id);
    }
  }
  ok(same.length === 0, '没有两个角色的技能集合完全相同', same.join(','));

  /* 每张卡三选一，而且选项真的在表里 */
  const badCard = [];
  for (const c of Chars.LIST) {
    const t = Skills.treeFor(c.id);
    if (!t) { badCard.push(c.id + ':无树'); continue; }
    if (t.cards.length !== 2) badCard.push(c.id + ':卡数' + t.cards.length);
    for (const card of t.cards) {
      if (card.options.length !== 3) badCard.push(card.id + ':选项' + card.options.length);
      if (new Set(card.options).size !== card.options.length) badCard.push(card.id + ':重复选项');
    }
  }
  ok(badCard.length === 0, '每个角色两张卡、每张三选一（' + Chars.LIST.length + ' 个角色）', badCard.join(','));

  /* 技能卡里必须有**自己的**技能 —— 否则"角色身份"就没了 */
  const noOwn = [];
  for (const c of Chars.LIST) {
    const t = Skills.treeFor(c.id);
    const own = t.cards[0].options.filter(o => {
      const row = Skills.BY_ID[o];
      return row && row.owner === c.id;
    });
    if (!own.length) noOwn.push(c.id);
  }
  ok(noOwn.length === 0, '每个角色的技能卡里都至少有一个自己的技能', noOwn.join(','));

  /* 元素的引用必须是真的（写错一个字母 = 那个技能没有元素效果） */
  const badEl = Skills.LIST.filter(s => s.element && !Elems.BY_ID[s.element]).map(s => s.id);
  ok(badEl.length === 0, '技能引用的元素都在元素表里', badEl.join(','));
}

/* =========================================================
   [2] 折叠：纯函数 + 符文真的生效 + 空构筑恒等
   ========================================================= */
console.log('\n[2] 折叠：符文真的改了参数，空构筑恒等');
{
  ok(Skills.fold('ranger', []).slots.length === 0, '空构筑 → 0 个技能槽（**指纹不变的前提**）');
  ok(Skills.fold('no_such_char', []).slots.length === 0, '未知角色 → 0 个技能槽');
  ok(Skills.fold('mage', [{ card: '不存在', option: 'x' }]).slots.length === 0,
    '脏构筑（卡名不对）→ 0 个技能槽，而不是抛');

  /* 纯函数：同样的输入必须给同样的输出（折叠会被界面与模拟层各调一次） */
  const b = [{ card: 'mage_skill', option: 's_mage_fireball' }, { card: 'mage_rune', option: 'r_swift' }];
  const f1 = JSON.stringify(Skills.fold('mage', b));
  const f2 = JSON.stringify(Skills.fold('mage', b));
  ok(f1 === f2, '折叠是纯函数（同输入同输出）');

  const base = Skills.fold('mage', []).slots;
  const plain = Skills.fold('mage', [{ card: 'mage_skill', option: 's_mage_fireball' }]).slots[0];
  const swift = Skills.fold('mage', b).slots[0];
  ok(base.length === 0 && quick(plain), '只打技能卡 → 有一个技能', JSON.stringify(plain && plain.id));
  ok(quick(swift), '再打符文卡 → 还是那一个技能（符文不改"是什么"）');
  /* **逐条比对**：`r_swift` 的说明是"冷却 −25%" */
  ok(swift.cd < plain.cd, '「速吟」真的把冷却降低了（' + plain.cd + 's → ' + swift.cd + 's）');

  const multi = Skills.fold('mage', [
    { card: 'mage_skill', option: 's_mage_fireball' },
    { card: 'mage_rune', option: 'r_multi' }]).slots[0];
  ok(multi.params.count === plain.params.count + 2,
    '「连发」真的加了弹丸数（' + plain.params.count + ' → ' + multi.params.count + '）');

  /* 每个符文的说明都对应一个**真的会被写进去**的变化：
     逐个符文试一遍，要求"折叠出来的技能与不带符文时不同"。 */
  const noEffect = [];
  for (const r of Skills.RUNES) {
    /* 找一个能装它的角色（通用符文谁都能装） */
    const host = r.owner || 'ranger';
    const card = Skills.treeFor(host).cards[0];
    const skillOpt = card.options[0];
    const withR = Skills.fold(host, [{ card: card.id, option: skillOpt }, { card: card.id + '_x', option: r.id }]);
    /* 卡名不对时上面的 fold 会忽略符文 —— 所以直接构造正确的卡名 */
    const runeCard = Skills.treeFor(host).cards[1].id;
    const foldW = Skills.fold(host, [{ card: card.id, option: skillOpt }]);
    const foldR = Skills.fold(host, [{ card: card.id, option: skillOpt }, { card: runeCard, option: r.id }]);
    const wrongSlots = foldW.slots, rightSlots = foldR.slots;
    if (!rightSlots.length) continue;
    /* 符文不在这个角色的卡上时 fold 会忽略它，跳过 */
    const listed = Skills.treeFor(host).cards[1].options.indexOf(r.id) >= 0;
    if (!listed) continue;
    /* 两类符文要**分开比**：
         · 数值型（速吟/连发/增伤…）改的是**槽位参数** → 比 `params`
         · 机制型（狂怒/附魔/贪婪/掘进）改的是 **`mods` 原始表** →
           模拟层直接读它（见 `skillDamage` / `hurtWithSkill`），所以那一项
           `params` 不会变 —— 只比 params 会把它们误报成"写了个没人读的键"。 */
    const paramsChanged = JSON.stringify(wrongSlots) !== JSON.stringify(rightSlots);
    const modsChanged = JSON.stringify(foldR.mods || {}) !== JSON.stringify(foldW.mods || {});
    if (!paramsChanged && !modsChanged) noEffect.push(r.id);
    void withR;
  }
  ok(noEffect.length === 0,
    '每个符文都真的改变了折叠结果（不是写了个没人读的键）', noEffect.join(','));

  function quick(s) { return !!s && s.cd > 0 && s.cost >= 0 && typeof s.params === 'object'; }
}

/* =========================================================
   [3] 模拟层：两种模式真的不一样
   ========================================================= */
console.log('\n[3] 模拟层：自动会放，手动不按不放');
{
  const build = [
    { card: 'mage_skill', option: 's_mage_fireball' },
    { card: 'mage_rune', option: 'r_swift' }
  ];
  const stage = (mode) => {
    Game.cfg.combatMode = mode;
    const s = Game.newRun('mage', 4242, 1, null, null, build);
    enterFightRoom(s);
    Game._internals.startWave(3);
    s.spawnQueue.length = 0;
    s.enemies.length = 0;
    for (let i = 0; i < 4; i++) {
      const e = Game._internals.spawnEnemy('grub', s.player.x + 160 + i * 18, s.player.y, {});
      e.hp = 1e9; e.spawnT = 0;
    }
    return s;
  };

  /* ---- 自动模式 ----
     ⚠ **先给无敌**：`stage()` 把 4 只怪放在 160px 外、血量 1e9 —— 它们打不死，
     而玩家会被它们贴脸打死（实测第 238 帧 `hp=0` → `state='end'`）。
     一旦走了 'end'，后面的 `step` 就不再推进模拟，于是"冷却有没有在走"
     这件事**根本没被测到**。无敌是这里唯一能让判据落到正确对象上的办法。 */
  const A = stage('auto');
  A.player.invuln = 1e9;
  let castsA = 0;
  const hA = (e) => { castsA++; void e; };
  Game.events.on('skillCast', hA);
  for (let i = 0; i < 300; i++) {
    A.player.invuln = 1e9;                 // 受击会把它减掉，逐帧续上
    Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });
  }
  ok(castsA > 0, '自动模式：300 帧里自己放了 ' + castsA + ' 次技能');
  ok(A.energy < A.energyMax, '放技能真的扣了能量（' + Math.round(A.energy) + '/100）');

  /* ---- 自动模式：**会一直放**，不是只放第一发 ----
     这条判据问的是"冷却走完之后会不会再放"。写它的时候连着踩了三个坑，
     每一个都会让下一个写这条判据的人再踩一次，所以都记在这里：

       ① 这一间会自己结束（`drained && enemies.length === 0` → `endWave`）
          → 后面的 `step` 不再推进模拟。用 `holdRoom()` 封住。
       ② 玩家会被贴脸的怪打死（血量归零直接 `setState('end')`，
          `roomHold` **管不着** —— 它管的是"别换房"）。用逐帧续的无敌封住。
       ③ 怪被打死会让这一间清空 → 又回到 ①。上一节已经把它们的血设成 1e9。

     判据落在**时间关系**上而不是次数上：r_swift 把火球压到 1.8s 冷却，
     600 帧 = 10s，所以至少该放 4 次。只放 1 次说明冷却没有递减。 */
  const held = Game.getSession();
  holdRoom(held);
  held.waveLeft = 9999;
  const before = castsA;
  for (let i = 0; i < 600; i++) {
    held.player.invuln = 1e9;
    Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });
  }
  const repeat = castsA - before;
  ok(repeat >= 4, '自动模式：**冷却走完之后会接着放**（后 600 帧又放了 ' + repeat + ' 次，冷却 1.8s）',
    'casts=' + castsA + ' state=' + Game.state + ' hp=' + Math.round(held.player.hp));

  /* ---- 手动模式：不按 ---- */
  const B = stage('manual');
  let castsB = 0;
  const hB = () => { castsB++; };
  Game.events.on('skillCast', hB);
  const bullets0 = B.bullets.length;
  for (let i = 0; i < 300; i++) Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });
  ok(castsB === 0, '手动模式：不按键**一次都不放**（这是"手动"的定义）', String(castsB));
  ok(B.bullets.length === bullets0, '手动模式：不按键**一枪都不开**', String(B.bullets.length - bullets0));

  /* ---- 手动模式：按了 ----
     ⚠ **要新开一局**：上面那一局在自动模式那一段里已经放过技能了
     （能量 73、冷却没走完），拿它继续测会得出"按了也没放"的假结论。
     这是我这套判据自己踩的坑，写在这里免得下次再踩。 */
  const C = stage('manual');
  let castsC = 0;
  const hC = () => { castsC++; };
  Game.events.on('skillCast', hC);
  const bulletsC = C.bullets.length;
  for (let i = 0; i < 120; i++) {
    Game.step(Game.cfg.fixedDt, { x: 0, y: 0, fire: true, aimX: 1, aimY: 0, cast: true, slot: 0 });
  }
  /* 技能是**边沿触发**，而这个循环每帧都塞 `cast:true` —— 那等于"玩家每帧都按一下"。
     120 帧（2 秒）里放两次是对的：冷却 1.35s、能量也够第二发。
     所以判据不落在次数上，而落在"**它真的放了**"（冷却被重置）。 */
  ok(castsC >= 1 && C.skills.slots[0].cd > 0,
    '手动模式：按了技能键就放（放了 ' + castsC + ' 次，冷却被重置）',
    'casts=' + castsC + ' cd=' + C.skills.slots[0].cd);
  /* 开火正确性的判据是"**冷却被重置过**"，不是"子弹还在飞"：
     怪就在 160px 处，射出去的子弹会打中并消失 —— 第一版就是拿
     "子弹变多了吗"当判据，于是把正确行为判成了 bug。 */
  ok(C.player.weapons[0].cd > 0,
    '手动模式：按了开火就真的开了枪（武器冷却被重置：' + C.player.weapons[0].cd.toFixed(2) + 's）');
  ok(C.bullets.length + C.stats_total.kills >= bulletsC,
    '（并且确实有东西被打出去过 —— 子弹在飞或已经打掉了）',
    'bullets=' + C.bullets.length + ' kills=' + C.stats_total.kills);
  Game.events.off && Game.events.off('skillCast', hA);
  Game.events.off && Game.events.off('skillCast', hB);
  Game.events.off && Game.events.off('skillCast', hC);

  /* ---- 命中真的掉血 ---- */
  Game.cfg.combatMode = 'auto';
  const D = Game.newRun('mage', 4242, 1, null, null, build);
  enterFightRoom(D);
  Game._internals.startWave(3);
  D.spawnQueue.length = 0;
  D.enemies.length = 0;
  const victim = Game._internals.spawnEnemy('grub', D.player.x + 60, D.player.y);
  victim.hp = 1e9; victim.maxHp = 1e9; victim.spawnT = 0;
  const hp0 = victim.hp;
  for (let i = 0; i < 240; i++) Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });
  ok(victim.hp < hp0, '技能真的打掉了血（' + Math.round(hp0 - victim.hp) + ' 点）');

  Game.cfg.combatMode = 'auto';
}

/* =========================================================
   [4] 默认档：不许改到既有行为
   ========================================================= */
console.log('\n[4] 默认档：既有行为逐位不变的前提');
{
  ok(Game.cfg.combatMode === 'auto', '战斗模式默认 auto（行为指纹跑的就是它）',
    String(Game.cfg.combatMode));
  ok(Settings.def('combatMode').def === 'auto',
    '设置表里的默认值也是 auto（两处必须一致，否则"设置里是自动、实际是手动"）',
    String(Settings.def('combatMode').def));
  ok(Settings.def('combatMode').options.join(',') === 'auto,manual',
    '只有两种模式（四个半成品状态比两个可验证的状态糟）');

  /* 默认开局（不传 skillBuild）必须一个技能槽都没有 */
  const s = Game.newRun('mage', 4242, 1, null, null);
  ok(s.skills && s.skills.slots.length === 0,
    '不传构筑时开局没有技能槽（' + (s.skills ? s.skills.slots.length : '?') + ' 个）');
  ok(s.energy === s.energyMax, '能量从满开始（开局就能放一个技能）');

  /* 构筑存进存档并跟着走 */
  const withSkills = Game.newRun('mage', 4242, 1, null, null,
    [{ card: 'mage_skill', option: 's_mage_fireball' }]);
  const payload = Game.exportRun();
  ok(Array.isArray(payload.skillBuild) && payload.skillBuild.length === 1,
    '`exportRun` 带上了技能构筑（' + JSON.stringify(payload.skillBuild) + '）');
  const back = Game.importRun(payload);
  ok(back && back.skills.slots.length === 1 && back.skills.slots[0].skill.id === 's_mage_fireball',
    '读档之后技能还在（不带它的话技能栏会空着，而玩家记得自己点过）',
    back && JSON.stringify(back.skills.slots.map(x => x.skill.id)));
  void withSkills;

  /* 老存档没有 skillBuild 字段 → 空构筑，而不是抛 */
  const legacy = JSON.parse(JSON.stringify(payload));
  delete legacy.skillBuild;
  const old = Game.importRun(legacy);
  ok(old && old.skills && old.skills.slots.length === 0,
    '老存档（没有 skillBuild 字段）读出来是空构筑，不抛',
    old && JSON.stringify(old.skills.slots.length));
}

/* =========================================================
   [5] 档案层：技能构筑存在账号里（与天赋同一套路）
   ========================================================= */
console.log('\n[5] 档案层：技能构筑存在账号里');
{
  Storage.use(Storage.memory());
  Profile.load();
  const before = Profile.skillBuild('mage').length;
  const r1 = Profile.pickSkillCard('mage', 'mage_skill', 's_mage_fireball');
  ok(r1.ok, '打第一张卡成功', r1.reason);
  const r2 = Profile.pickSkillCard('mage', 'mage_skill', 's_mage_frost');
  ok(!r2.ok, '同一张卡**不能打两次**（打完就定下来了，那才是构筑）', r2.reason);
  const r3 = Profile.pickSkillCard('mage', 'mage_rune', '不存在的符文');
  ok(!r3.ok, '卡上没这个选项 → 被拒', r3.reason);
  ok(Profile.skillBuild('mage').length === before + 1,
    '档案里记下来了一张（' + Profile.skillBuild('mage').length + ' 张）');

  /* 换角色：别的角色的卡打不上 */
  const r4 = Profile.pickSkillCard('ranger', 'mage_skill', 's_mage_fireball');
  ok(!r4.ok, '别的角色的卡打不上（那会让"每个角色不一样"变成一句空话）', r4.reason);

  /* 重打（免费） */
  ok(Profile.resetSkillBuild('mage') === true && Profile.skillBuild('mage').length === 0,
    '重打是免费的，而且真的清空了');

  /* 折出来的载荷与 `Skills.fold` 一致（档案层不另写一份规则） */
  Profile.pickSkillCard('mage', 'mage_skill', 's_mage_fireball');
  const a = JSON.stringify(Profile.skillsFor('mage'));
  const b = JSON.stringify(Skills.fold('mage', Profile.skillBuild('mage')));
  ok(a === b, '档案层的载荷与 `Skills.fold` **同一份**（没有第二套规则）');

  /* 坏档：全是不存在的卡 → 读盘时被过滤成空。
     ⚠ 要**先写进存储再读回来**：直接改内存里的 `perChar` 然后 `Profile.load()`，
     读的是存储里那一份（没被我改过），于是判据恒真 —— 第一版就是这么写的。 */
  Profile.perChar('mage').skillBuild = [{ card: 'x', option: 'y' }, null, { card: 'mage_skill', option: '不存在' }];
  Profile.save();
  Profile.load();
  ok(Profile.skillBuild('mage').length === 0,
    '坏档里的脏卡在读盘时被丢掉（否则它们会静默影响战斗）',
    JSON.stringify(Profile.skillBuild('mage')));
  void Slots;
}

/* =========================================================
   [6] 接入：入口真的接了技能屏与两种模式
   ========================================================= */
console.log('\n[6] 接入（源码形状：这些是"漏了就静默失效"的地方）');
{
  const mainSrc = fs.readFileSync(path.join(ROOT, 'src', 'main.ts'), 'utf8');
  const uiSrc = fs.readFileSync(path.join(ROOT, 'src', 'ui.ts'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const gameSrc = fs.readFileSync(path.join(ROOT, 'src', 'game.ts'), 'utf8');

  ok(/key === 'combatMode'\)\s*Game\.cfg\.combatMode/.test(mainSrc),
    '`applySetting` 把战斗模式写进 `Game.cfg`（值 → 行为的唯一去处）');
  ok(/data-act="set-combat"/.test(html) && /'set-combat':/.test(uiSrc),
    '设置页有战斗模式的按钮与处理函数');
  ok(/data-act="skills"/.test(html) && /id="scr-skills"/.test(html),
    '技能构筑屏有入口按钮与覆盖层');
  ok(/function renderSkills\(\)/.test(uiSrc) && /skills: function \(\) \{ renderSkills\(\); \}/.test(uiSrc),
    '场景切到 skills 时会重画它');
  ok(/'skill-pick':/.test(uiSrc) && /'skill-reset':/.test(uiSrc),
    '打卡与重打都有处理函数');

  /* `Skills.make` 之后必须**立刻** audit（skills.ts 刻意不注册启动期自检 ——
     注册了会在模块加载期误报，因为那时角色清单还没注入）。
     这一条是**源码形状**判据：没有它，"忘了跑 audit"就永远查不出来。 */
  const mk = mainSrc.indexOf('Skills.make(');
  const au = mainSrc.indexOf('skVerdict = skillsRef.audit()');
  ok(mk >= 0 && au > mk, '`Skills.make` 之后立刻跑了 audit（顺序反了就等于没查）',
    'make@' + mk + ' audit@' + au);

  /* 手动模式的两条路径都在 step 里分岔，且**共用** `fire` */
  ok(/updateWeaponsManual\(dt, input\)/.test(gameSrc) && /else updateWeapons\(dt\)/.test(gameSrc),
    '`step` 里按模式分派攻击（自动 / 手动各一条）');
  const manualBody = /function updateWeaponsManual[\s\S]*?\n\}/.exec(gameSrc);
  ok(manualBody && /fire\(/.test(manualBody[0]),
    '手动模式复用同一条 `fire(w, target)`（另写一条开火路径 = 两种模式手感会分叉）');
}

console.log('\n=== 结果 ===');
if (failures === 0) console.log('\x1b[32m全部通过 ✔\x1b[0m');
else console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m');
process.exit(failures ? 1 : 0);
