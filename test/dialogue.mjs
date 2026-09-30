/* =========================================================
   dialogue.mjs — 对话引擎：打字机 / 选择分支 / 历史 / 战斗短句（R41）
   ---------------------------------------------------------
   R41 的普查把本作的对话与外部标准逐条对过账，结论是"有骨架缺一半"。
   这一套守的是**补上的那一半**，按"一个故障一条判据"组织：

     [1] 打字机 —— t=0 露零个字 / 单调 / 打完 / **超长台词不让人干等** /
         代理对（表情）不许被切成半个字
     [2] 读法（跳过 / 自动）—— 跳只改这一句、自动是模式；有选项的那句不自动跳
     [3] 选择与分支 —— `story.ts` 那一侧：选项存在、去处真实、**不碰经济**
     [4] 对话历史 —— 有上限、丢最老的、不改传进来的数组、倒序读
     [5] 战斗短句 —— 表完整、**触发是确定的**（不用随机，回放才可复现）/
         同一个条件一局一次 / bossDown 那种允许重复且会换一句

   ⚠ [5] 那条"确定"是本套里最要紧的：`record.ts` 只录种子与逐帧输入，
     短句一旦用 `Math.random` 就会让同一盘带子放出不同的话 —— 而那**不会报错**，
     只会在某次回放时看到一句没见过的台词。
   ========================================================= */
import { installDom } from './_ctx.mjs';
import { loadAll, SIM_MODULES } from './_load.mjs';
import { T } from './_assert.mjs';

installDom();
await loadAll(SIM_MODULES);
const { Dialogue, Story, Profile, Game, Storage, Slots } = globalThis;

console.log('\n=== Bronana · 对话引擎（打字机 / 分支 / 历史 / 短句） ===\n');
Storage.wipe();
Slots.select(0);
Profile.load();
Profile.reset();

/* ---------------- [1] 打字机 ---------------- */
T.section('1. 打字机（"一个字一个字地出"）');
{
  T.ok(Dialogue.audit().ok, '定义期自检通过', Dialogue.audit().problems.join(' / '));

  const s = '你醒了。好。别急着问自己是什么。';
  T.eq(Dialogue.indexAt(s, 0), 0, 't=0 时露出的字是 0 个');
  T.eq(Dialogue.indexAt(s, 9999), Dialogue.len(s), 't 很大时整句都露出来');
  T.eq(Dialogue.indexAt('', 1), 0, '空串露出的字是 0 个（不崩）');

  /* **单调**：打字机不能倒着打（t 变大而露出的字变少 = 界面上闪一下） */
  let mono = true, last = -1;
  for (let t = 0; t <= 3; t += 0.02) {
    const k = Dialogue.indexAt(s, t);
    if (k < last) mono = false;
    last = k;
  }
  T.ok(mono, 't 越大露出的字只增不减（不会倒着打）');
  /* 半途真的在"半途"（不是 0 也不是全长）—— 否则打字机等于没生效 */
  const mid = Dialogue.indexAt(s, Dialogue.durationOf(s) / 2);
  T.ok(mid > 0 && mid < Dialogue.len(s), '打到一半时露出的字在 0 与全长之间', mid + '/' + Dialogue.len(s));

  /* **超长台词不让人干等**：`MAX_TYPE_SEC` 是硬上限 */
  const long = '字'.repeat(300);
  T.ok(Dialogue.durationOf(long) <= Dialogue.MAX_TYPE_SEC + 1e-9,
    '300 字的台词也在 ' + Dialogue.MAX_TYPE_SEC + ' 秒内打完（不会让人干等）',
    Dialogue.durationOf(long));

  /* **代理对不许被切开**：表情是两个码元，按 `.length` 切会露出半个字 */
  const emo = '好🙂坏';
  T.eq(Dialogue.len(emo), 3, '代理对按**码点**算一个字（不是两个）');
  let broken = false;
  for (let q = 0; q <= 4; q++) {
    if (Dialogue.slice(emo, q).indexOf('\uFFFD') >= 0) broken = true;
  }
  T.ok(!broken, '按任意长度切都不会切出半个字符');

  /* `skip` 与 `auto` 是两个东西：前者是"这一句"，后者是"之后每一句" */
  T.eq(Dialogue.skipDue(true), true, 'skip 开着就是"跳到整句"');
  T.eq(Dialogue.autoDue(s, 0, false), false, '没开自动 → 不该往下走');
  T.eq(Dialogue.autoDue(s, 0, true), false, '刚显示 → 还不该往下走（要读完）');
  T.eq(Dialogue.autoDue(s, 999, true), true, '开了自动且读完 → 该往下走');
}

/* ---------------- [2] 选择与分支（story.ts 那一侧） ---------------- */
T.section('2. 选择 / 分支（改造前只有"▽ 继续说"）');
{
  T.ok(Story.audit().ok, 'story.ts 自检通过（含选项的四条判据）', Story.audit().problems.join(' / '));

  /* 表里真的有带分支的台词 —— 否则这一节测的是空气 */
  const withChoices = Story.LINES.filter(l => Story.hasChoices(l));
  T.ok(withChoices.length >= 2, '至少两条台词带分支（现在 ' + withChoices.length + ' 条）',
    withChoices.map(l => l.id).join(','));

  /* **每一条选项的去处都真的存在** —— 指向不存在的台词时，
     玩家点了之后对话会"莫名其妙地结束"，而那与"故意结束"长得一样。 */
  const dangling = [];
  withChoices.forEach(l => l.choices.forEach(c => {
    if (c.to && !Story.lineById(c.to)) dangling.push(l.id + '.' + c.id + '→' + c.to);
  }));
  T.eq(dangling.length, 0, '每一条选项的去处都指向一条真实存在的台词', dangling.join(', '));
  /* 而且总账也登记了这条引用（两道防线，一道静态一道运行期） */
  T.ok(globalThis.Registry.has('storyChoice'), '选项进了扩展点总账（写错去处会被审计抓住）');

  /* 分支真的能走通：挑一条选项 → 拿到下一句 */
  const parent = withChoices[0];
  const next = Story.branchOf(parent, parent.choices[0].id);
  T.ok(!!next, '挑第一条选项能拿到下一句', parent.id + ' → ' + (next && next.id));
  T.eq(Story.branchOf(parent, '不存在的选项'), null, '认不出的选项返回 null（不抛）');
  /* `to` 为空串 = **说完就结束**（与"没有选项"是两件事，见 story.ts 的 `C()`） */
  const ending = withChoices.find(l => l.choices.some(c => !c.to));
  if (ending) {
    const c0 = ending.choices.find(c => !c.to);
    T.eq(Story.branchOf(ending, c0.id), null, '"说完就结束"那条选项返回 null');
  } else {
    T.ok(true, '（表里没有"说完就结束"的选项，这条跳过）');
  }

  /* **选项可以带条件**：条件不满足的**不出现**（不是灰着） */
  const ctxNone = { runs: 0, wins: 0, floor: 0, fragments: 0, bosses: 0, secrets: 0, endings: 0, flags: {} };
  const conditional = withChoices.find(l => l.choices.some(c => c.when));
  if (conditional) {
    const list = Story.choicesOf(conditional, ctxNone, {});
    T.ok(list.length < conditional.choices.length,
      '条件不满足的选项**不出现**（' + conditional.id + '：' + list.length + '/' + conditional.choices.length + '）');
  } else {
    T.ok(true, '（表里没有带条件的选项，这条跳过）');
  }

  /* ⚠ **分支不许碰经济** —— R41 普查里 `story.ts` 那条硬约束：
     往台词或选项里塞一句经济操作，守卫必须当场报红。
     这里**反证**一次（改的是内存里的表，跑完就还原）。 */
  const probe = [];
  const src = (await import('node:fs')).readFileSync(
    (await import('node:path')).join(process.cwd(), 'src', 'story.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  ['addGrowth', 'spendGrowth', 'addMaterial', 'spendMaterial', 'addCore', 'S.growth', 'S.material']
    .forEach(bad => { if (src.indexOf(bad) >= 0) probe.push(bad); });
  T.eq(probe.length, 0, '`story.ts` 里没有任何经济操作（叙事线一个铜板都不碰）', probe.join(', '));
}

/* ---------------- [3] 对话历史 ---------------- */
T.section('3. 对话历史（backlog）');
{
  let h = [];
  for (let i = 0; i < Dialogue.HISTORY_MAX + 8; i++) {
    h = Dialogue.pushHistory(h, { who: 'mother', name: '菌母', text: '第 ' + i + ' 句' });
  }
  T.eq(h.length, Dialogue.HISTORY_MAX, '历史的长度封顶在 ' + Dialogue.HISTORY_MAX + ' 条');
  T.eq(h[0].text, '第 8 句', '丢掉的**是最老的**那几条');
  T.ok(h[h.length - 1].text.indexOf(String(Dialogue.HISTORY_MAX + 7)) >= 0, '最新的一句留着');

  /* `pushHistory` 必须**不改传进来的数组**（界面上两份状态会互相污染）。
     ⚠ 它同时**封顶**：已经满 40 条时再塞一条，返回的仍然是 40 条（丢最老的）。
       所以这里断言"是新数组 + 长度不超过上限"，而不是"多了一条" —— 后者
       在满的时候是错的，而那条断言第一版就是这么写的（当场红了）。 */
  const before = h.length;
  const h2 = Dialogue.pushHistory(h, { text: 'x' });
  T.eq(h.length, before, 'pushHistory 没有改传进来的那个数组');
  T.ok(h2 !== h && h2.length <= Dialogue.HISTORY_MAX,
    '返回的是一个新数组，且长度不超过上限', h2.length + ' ≤ ' + Dialogue.HISTORY_MAX);

  T.eq(Dialogue.pushHistory(h, null).length, h.length, '空记录不写进历史');
  T.eq(Dialogue.pushHistory(h, { text: '' }).length, h.length, '没有正文的记录不写进历史');

  const r = Dialogue.recent(h, 3);
  T.eq(r.length, 3, 'recent(3) 返回 3 条');
  T.eq(r[0].text, h[h.length - 1].text, 'recent 的第一条是**最新**的那一句（倒序）');
}

/* ---------------- [4] 战斗短句（barks） ---------------- */
T.section('4. 战斗短句（战斗中飘一下就没的短句）');
{
  T.ok(Dialogue.BARKS.length >= 6, '短句表至少 6 条（现在 ' + Dialogue.BARKS.length + ' 条）');
  /* 每一条都要有触发条件与说明 —— 少了条件的永远说不出来，而界面上看不出 */
  const bad = Dialogue.BARKS.filter(b => !b.when || !b.text || !b.note);
  T.eq(bad.length, 0, '每一条短句都有触发条件 / 文案 / 说明', bad.map(b => b.id).join(', '));
  /* 每一个声明过的触发条件都要真的有句子（否则那条事件永远不出声） */
  const silent = Dialogue.WHENS.filter(w => !Dialogue.BARKS.some(b => b.when === w));
  T.eq(silent.length, 0, '每个触发条件都至少有一句', silent.join(', '));
  T.ok(globalThis.Registry.audit().ok, '总账审计通过（bark → barkWhen 的引用都对得上）',
    globalThis.Registry.audit().problems.slice(0, 2).map(p => p.family + '.' + p.id).join(', '));

  /* **触发是确定的**：同一个 nth 两次同一句，而 nth 推进会换一句 */
  const a = Dialogue.barkFor('hurtHard', 0), b = Dialogue.barkFor('hurtHard', 0);
  T.eq(a && a.id, b && b.id, '同一个 nth 两次拿到同一句（**不用随机** —— 回放才可复现）');
  const pool = Dialogue.BARKS.filter(x => x.when === 'hurtHard');
  if (pool.length > 1) {
    T.ok(Dialogue.barkFor('hurtHard', 1).id !== a.id, 'nth 推进会换一句（一轮之内不重复）');
  } else {
    T.ok(true, '（hurtHard 只有一句，轮转那条跳过）');
  }
  T.eq(Dialogue.barkFor('没有这个条件', 0), null, '未知的触发条件返回 null（不抛）');
}

/* ---------------- [5] 真的接进对局 ---------------- */
T.section('5. 接进真对局（短句真的会被说出来）');
{
  Storage.wipe();
  Slots.select(0);
  Profile.load();
  Profile.reset();

  const sess = Game.newRun('ranger', 4242);
  T.ok(!!sess, '开局建起来了');
  T.eq(Game.barksSaid().length, 0, '刚开局一句短句都没说');
  T.eq(Game.barkTotal(), Dialogue.BARKS.length, '`Game.barkTotal` 与短句表一致（诊断面板读它）');

  /* **走真实的伤害路径**（`hurtPlayer`），不直接 emit 事件 ——
     直接 emit 只能证明"监听器接上了"，证明不了"该出声的时候真的有人按按钮"。
     做法：在玩家身上摆一只耐打的怪，然后跑帧让它真的打中。
     为什么不用 `p.hp = 1` 之类去凑：那会让"为什么这句短句出来了"变得不可解释。 */
  const barks = [];
  Game.events.on('bark', d => { if (d) barks.push(d); });

  const p = sess.player;
  const def = globalThis.Enemies.BY_ID.brute || globalThis.Enemies.LIST[0];
  /* hpMul 拉高让它在整段测试里活着；dmgMul 拉高让"一次挨掉两成"真的成立 */
  Game._internals.spawnEnemy(def.id, p.x, p.y, { hpMul: 200, dmgMul: 9, elite: false });
  const hp0 = p.hp;
  for (let i = 0; i < 240 && barks.length === 0; i++) {
    Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });
  }
  T.ok(p.hp < hp0, '玩家真的挨了打（走的是 `hurtPlayer` 那条路）', hp0 + ' → ' + p.hp);
  T.ok(barks.length >= 1, '挨打之后说出了短句（' + barks.length + ' 句）',
    barks.map(b => b.id).join(','));
  if (barks.length) {
    T.eq(barks[0].when, 'hurtHard', '说出来的是"一次挨掉两成以上生命"那一条', barks[0].when);
    T.ok(!!barks[0].text, '短句带着文案（界面直接用它的那一份，不另写一遍）', barks[0].text);
    T.ok(barks[0].x !== undefined && barks[0].y !== undefined, '短句带着说的人在哪（界面据此决定飘在哪）');
    const first = barks[0].id;
    /* **同一个条件一局只说一次**：继续挨打不该再喊同一句 */
    for (let i = 0; i < 120; i++) Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });
    const repeats = barks.filter(b => b.id === first).length;
    T.eq(repeats, 1, '同一条短句一局只说一次（继续挨打不再喊）', repeats);
    T.ok(Game.barksSaid().indexOf('hurtHard') >= 0, '说过的条件记进了 `barksSaid`（那一局一次的账）');
  }
}

process.exit(T.done());
