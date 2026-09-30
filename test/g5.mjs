/* =========================================================
   g5.mjs — 深度层（B5）：限时房 · 层间契约 · 隐藏要素

   这三样都容易做成"写在表里、局里没有"：
     · 限时房：房型声明了，但时限没真的砍半 / 奖励没真的翻倍
     · 层间契约：候选抽出来了，但三组修正里有一组没人读 → 那条契约是假的
     · 隐藏要素：挑战声明了"隐藏"，但图鉴照样列出来 / 角色照样出现在选人页
   这一套逐条把"声明"和"实际发生的事"对上。

   用法： node test/g5.mjs
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
const { Game, Dungeon, Boons, Profile, Challenges, Chars, Enemies, Danger, Registry, Storage } = globalThis;
console.error = function () { };

console.log('\n=== Bronana · 深度层（限时房 / 层间契约 / 隐藏要素）===\n');

/* ---------------- 1. 限时房：时限真的砍半，奖励真的变档 ---------------- */
console.log('[1] 限时房：时限砍半 + 奖励变档');
{
  const fl = Dungeon.genFloor(4242, 1);
  const rushRoom = fl.rooms.find(r => r.type === 'rush');
  ok(!!rushRoom, '每层都有限时房');
  const at = Dungeon.modsFor(fl, rushRoom.id);
  ok(at.waveTime > 0 && at.waveTime < 1, '限时房把时限打折（waveTime = ' + at.waveTime + '）');
  ok(at.waveBudget > 1, '限时房的怪不比普通房少（预算 ×' + at.waveBudget + '）');

  // 真的开一间：时限 = 全局时限 × 折叠值（**同一波号**比，否则比的是基础时限的差）
  const s = Game.newRun('ranger', 4242, 0);
  const normal = s.map.rooms.find(r => r.type === 'fight');
  Game._internals.warpTo(normal.id);
  Game._internals.startWave(6);
  const normalLeft = s.waveLeft;
  Game._internals.warpTo(rushRoom.id);
  Game._internals.startWave(6);
  const rushLeft = s.waveLeft;
  ok(rushLeft < normalLeft, '限时房的时限真的更短（' + rushLeft.toFixed(1) + 's < ' + normalLeft.toFixed(1) + 's）');
  ok(Math.abs(rushLeft / normalLeft - 0.5) < 0.02, '正好砍半（比值 ' + (rushLeft / normalLeft).toFixed(2) + '）');

  /* `roomFx` 是**进房时**折的（applyRoomEntry），所以这里要真的走一趟门，
     不能用 warpTo+startWave 那种摆拍 —— 那样量到的是"没进门"。 */
  const walkIn = (type, seed) => {
    for (let t = 0; t < 30; t++) {
      Game.newRun('ranger', seed + t * 977, 0);
      const ss = Game.getSession();
      const room = ss.map.rooms.find(r => r.type === type);
      if (!room) continue;
      const nb = Dungeon.neighbours(ss.map, room)[0];
      if (!nb) continue;
      Game._internals.warpTo(nb.id);
      Game._internals.startWave(6);
      // 清掉邻居（合法路径：清空即过 → 商店），然后走门进去
      ss.spawnQueue = []; ss.spawnIdx = 0; ss.enemies.length = 0;
      Game.setState('playing', true);
      Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });
      let d = -1;
      for (let q = 0; q < 4; q++) {
        if (room.x === nb.x + Dungeon.DIRS[q][0] && room.y === nb.y + Dungeon.DIRS[q][1]) d = q;
      }
      if (d < 0 || !Game.enterRoom(d)) continue;
      if (ss.roomId !== room.id) continue;
      return ss;
    }
    return null;
  };
  /* 量"速清 vs 超时"两档的奖励。两条注意：
       · `Game.step` 只作用在**当前会话**上，所以必须"进完这一间立刻量" ——
         先建两个会话再回头量，量到的是第二个（实测：第一组永远是 0）
       · "超时"必须真的超时：场上得留一只怪，否则 step 看到"队列空了 + 场上空了"
         就直接结算（那条路是"清完了"，不是"超时了"），两档会量成一样 */
  const gain = (sess, fast) => {
    sess.spawnQueue = []; sess.spawnIdx = 0; sess.enemies.length = 0;
    const e = Game._internals.spawnEnemy('grub', sess.player.x + 420, sess.player.y, {});
    if (e) { e.spawnT = 0; e.hp = 1e9; e.maxHp = 1e9; }
    sess.waveEnding = false;
    sess.forceClear = false;
    sess.waveLeft = fast ? 5 : 0;
    Game.setState('playing', true);
    const m0 = sess.player.scrap;
    Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });      // 超时那一档在这一步触发
    const overran = sess.forceClear === true;
    sess.enemies.length = 0;                           // 清掉它 → 这一间结束
    Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });
    return { mats: sess.player.scrap - m0, overran: overran };
  };
  const rush = (() => {
    const sess = walkIn('rush', 100);
    if (!sess) return null;
    ok(sess.roomFx.fastMul > Game.cfg.clearBonus && sess.roomFx.slowMul < Game.cfg.overrunBonus,
      '限时房把"速清/超时"两档也换掉了（×' + sess.roomFx.fastMul + ' / ×' + sess.roomFx.slowMul + '）');
    const fast = gain(sess, true), slow = gain(sess, false);
    return { fast: fast, slow: slow, fx: sess.roomFx };
  })();
  const norm = (() => {
    const sess = walkIn('fight', 300);
    if (!sess) return null;
    const fast = gain(sess, true), slow = gain(sess, false);
    return { fast: fast, slow: slow, fx: sess.roomFx };
  })();
  ok(!!rush && !!norm, '两类房都走得进去并量到了两档');
  if (!rush || !norm) { /* 下面会红 */ }
  else {
    ok(!rush.fast.overran && rush.slow.overran, '速清/超时两条路都真的走到了',
      JSON.stringify([rush.fast.overran, rush.slow.overran]));
    const rushRatio = rush.fast.mats / Math.max(1, rush.slow.mats);
    const normRatio = norm.fast.mats / Math.max(1, norm.slow.mats);
    ok(rushRatio > normRatio,
      '限时房的"快 vs 慢"差距比普通房更大（×' + rushRatio.toFixed(2) + ' vs ×' + normRatio.toFixed(2) + '）');
    ok(Math.abs(rushRatio - rush.fx.fastMul / rush.fx.slowMul) < 0.35,
      '这个差距就是限时房声明的两个倍率之比（' + (rush.fx.fastMul / rush.fx.slowMul).toFixed(2) + '）');
  }
}

/* ---------------- 2. 层间契约：三组修正都要真的被读到 ---------------- */
console.log('[2] 层间契约：三组修正各有一个真实读点');
{
  ok(Boons.audit().ok, '契约表自检通过', Boons.audit().problems.join(' | '));
  ok(Registry.has('boon') && Registry.has('boonMod'), '契约家族登记在总账里');
  ok(Boons.LIST.length >= 6, '契约够多（' + Boons.LIST.length + ' 条）：抽两条不会总是同一批');
  // enemy 组的键必须真的在 wmods 里（否则折进去也会被静默跳过）
  const missing = [];
  for (const id of Object.keys(Boons.BY_ID)) {
    const f = Boons.fold(id);
    for (const k of Object.keys(f.enemy)) if (!(k in Danger.BASE)) missing.push(id + ':' + k);
  }
  ok(missing.length === 0, '契约的"敌人组"键与 danger 同名（折进 wmods 才会生效）', missing.join(','));
  // 每一条都要能说出人话（界面不写第二份文案）
  const noText = Boons.LIST.filter(d => Boons.lines(d.id).length !== Object.keys(d.mods).length);
  ok(noText.length === 0, '每条契约的每个效果键都有自己的文案', noText.map(d => d.id).join(','));

  // 抽签：确定性 + 不重复
  const r1 = Boons.roll(2, globalThis.U.rng(7));
  const r2 = Boons.roll(2, globalThis.U.rng(7));
  ok(r1.join(',') === r2.join(','), '同一个随机数流 → 同一组候选', r1.join(','));
  ok(r1.length === 2 && r1[0] !== r1[1], '抽两条且不重复', r1.join(','));
}

/* ---------------- 3. 打完 Boss 才有候选，挑完不可改 ---------------- */
console.log('\n[3] 打完 Boss 给候选，挑一条之后不可改');
{
  const s = Game.newRun('ranger', 606, 0);
  s.roomId = s.map.boss;
  s.spawnQueue = []; s.spawnIdx = 0; s.enemies.length = 0;
  Game.setState('playing', true);
  let offered = null;
  Game.events.on('boonOffer', d => { offered = d; });
  Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });
  ok(Game.state === 'shop' && s.floor === 2, '打完 Boss 进商店并翻层', Game.state + ' / ' + s.floor);
  ok(!!offered && offered.choices.length === Game.cfg.boonChoices,
    '给出了候选（' + (offered ? offered.choices.join(',') : '无') + '）');
  ok(Game.boonChoices().length === Game.cfg.boonChoices, '会话上查得到候选');
  ok(Game.boonId() === '', '还没挑');

  const pick = s.pendingBoons[0];
  const hpBefore = s.stats.maxHp;
  const fold = Boons.fold(pick);
  ok(Game.pickBoon(pick) === true, '挑定一条：' + pick);
  ok(Game.boonId() === pick, '会话记下了这一条');
  ok(Game.boonChoices().length === 0, '候选清空（不可改）');
  ok(Game.pickBoon(pick) === false, '再挑一次被拒（不可撤销）');
  // stats 组立刻生效
  if (fold.stats.maxHp) {
    ok(s.stats.maxHp !== hpBefore, '属性组立刻生效（生命上限 ' + hpBefore + ' → ' + s.stats.maxHp + '）');
  } else ok(true, '（这条契约没有属性组，跳过即时生效检查）');

  // 敌人组在下一次开波时折进 wmods
  const enemyChoice = Boons.LIST.find(d => Object.keys(Boons.fold(d.id).enemy).length) || Boons.LIST[0];
  Game._internals.setBoon(enemyChoice.id);
  Game._internals.warpTo(Game.getSession().map.rooms.find(r => r.type === 'fight').id);
  Game._internals.startWave(9);
  const fold2 = Boons.fold(enemyChoice.id);
  const k = Object.keys(fold2.enemy)[0];
  const base = Dungeon.foldMods(Game.getSession().dmods, Game.getSession().map, Game.getSession().roomId);
  const expect = fold2.enemy[k] >= 1 ? base[k] * fold2.enemy[k] : base[k] + fold2.enemy[k];
  ok(Math.abs(Game.getSession().wmods[k] - expect) < 1e-9,
    '敌人组折进了 wmods（' + k + '：' + base[k].toFixed(3) + ' → ' + Game.getSession().wmods[k].toFixed(3) + '）');

  // 经济组：拿"材料收集"那条验一次真实收益
  const bounty = Boons.LIST.find(d => d.mods.materialMul);
  if (bounty) {
    const mats = (setBoon) => {
      Game.newRun('ranger', 31, 0);
      const ss = Game.getSession();
      if (setBoon) Game._internals.setBoon(setBoon);
      Game._internals.warpTo(ss.map.rooms.find(r => r.type === 'fight').id);
      Game._internals.startWave(4);
      ss.spawnQueue = []; ss.spawnIdx = 0; ss.enemies.length = 0;
      const m0 = ss.player.scrap;
      // 直接走一次拾取（killEnemy → collect 的路径太长，这里用真实掉落物）
      Game._internals.spawnEnemy('grub', ss.player.x + 10, ss.player.y, {});
      const e = ss.enemies[0];
      Game.damageEnemy(e, 99999, { fromX: ss.player.x, fromY: ss.player.y });
      for (let i = 0; i < 60; i++) Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });
      return ss.player.scrap - m0;
    };
    const a = mats(null), b = mats(bounty.id);
    ok(b >= a, '带"材料收集"契约时捡到的不比没有时少（' + a + ' → ' + b + '）');
  }

  // 存档往返：契约与候选都跟着走，坏 id 被丢掉
  Game.newRun('ranger', 909, 0);
  const s2 = Game.getSession();
  Game._internals.setBoon('bounty');
  s2.pendingBoons = ['armory', 'swift'];
  const p = Game.exportRun();
  ok(p.boon === 'bounty' && p.pendingBoons.length === 2, '契约与候选都进了存档');
  const back = Game.importRun(p);
  ok(back.boon === 'bounty' && back.pendingBoons.length === 2, '读档之后还在');
  const bad = Game.importRun(Object.assign({}, p, { boon: '不存在', pendingBoons: ['也不存在', 'bounty'] }));
  ok(bad.boon === '' && bad.pendingBoons.join(',') === 'bounty', '坏档里认不出的契约被丢掉',
    bad.boon + ' / ' + bad.pendingBoons.join(','));
}

/* ---------------- 4. 隐藏挑战：没完成之前不列出来 ---------------- */
console.log('\n[4] 隐藏挑战与隐藏角色');
{
  Storage.use(Storage.memory());
  Profile.reset();
  const secrets = Challenges.LIST.filter(c => c.secret);
  ok(secrets.length >= 2, '表里有隐藏挑战（' + secrets.length + ' 条：' + secrets.map(c => c.name).join(' / ') + '）');
  const vis0 = Challenges.visible(() => false);
  ok(vis0.every(c => !c.secret), '没完成时一条隐藏挑战都不列出来');
  ok(Challenges.visible(id => id === secrets[0].id).some(c => c.id === secrets[0].id),
    '完成了的那条才现身');
  ok(Registry.ids('challenge').length === Challenges.LIST.length, '总账里的挑战数与表一致');

  // 隐藏角色的门槛：藏在哪条挑战后面
  const mole = Chars.BY_ID['mole'];
  ok(!!mole && mole.hidden === true && mole.locked === true, '有一个隐藏角色（' + (mole ? mole.name : '?') + '）');
  const gate = Challenges.LIST.find(c => c.unlock.some(u => u.family === 'char' && u.id === 'mole'));
  ok(!!gate && gate.secret === true, '它挂在一条**隐藏**挑战后面（而不是明面上的进程挑战）');
  ok(!Profile.isUnlocked('char', 'mole'), '新档里它是锁着的');

  // 条件达成 → 挑战完成 → 角色解锁（跨局计数驱动）
  const run = (o) => Profile.applyRun(Object.assign({
    char: 'ranger', wave: 6, level: 3, kills: 10, scrap: 50,
    damage: 1, taken: 1, healed: 1, packs: 0, win: false, danger: 0
  }, o), { runs: 1 });
  let unlockedAt = -1;
  for (let i = 1; i <= 6; i++) {
    const rep = run({ secrets: 1 });
    if (rep.unlocked.some(u => u.family === 'char' && u.id === 'mole')) { unlockedAt = i; break; }
  }
  ok(unlockedAt === 6, '累计发现 6 间密室时解锁（第 ' + unlockedAt + ' 局）');
  ok(Profile.isUnlocked('char', 'mole'), '隐藏角色解锁了');
  ok(Profile.isDone('hidden_wall'), '隐藏挑战也记成已完成（图鉴里从此现身）');
  ok(Challenges.visible(id => Profile.isDone(id)).some(c => c.id === 'hidden_wall'),
    '它现在出现在图鉴里');
  // 隐藏角色能真的开局（模拟层不校验门槛，但至少数据要完整）
  const sess = Game.newRun('mole', 1, 0);
  ok(!!sess && sess.charDef.id === 'mole' && sess.player.weapons.length === 1,
    '隐藏角色能开局且带着自己的起始武器（' + sess.player.weapons[0].def.name + '）');
  const past = Profile.pastOf('mole');
  ok(!!past && /掘进者/.test(past.line), '隐藏角色也有一段"过去"（剧情那层不留空）');
  Profile.reset();
}

/* ---------------- 5. 界面接入 ---------------- */
console.log('\n[5] 界面接入');
{
  const ui = fs.readFileSync(path.join(ROOT, 'src', 'ui.ts'), 'utf8');
  ok(/renderBoonPick\(/.test(ui) && (await uiMissingActs(['boon-pick'])).length === 0,
    'ui.ts 渲染契约候选并处理挑选（动作表里查得到 boon-pick）');
  ok(/Challenges\.visible\(/.test(ui), '图鉴用的是"可见的那一份"（隐藏挑战自动过滤）');
  ok(/isCharListed\(/.test(ui), '选人页对隐藏角色做过滤');
  ok(!/Boons\.BY_ID\[[^\]]*\]\.mods/.test(ui), 'ui.ts 不直接读契约的 mods（文案来自 Boons.lines）');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  ok(html.indexOf('id="shop-boons"') >= 0, '商店里有层间契约的容器');
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  ok(/\.boon-card/.test(css) && /\.mm-cell\.mm-rush/.test(css), '契约卡与限时房的配色都有样式');
}

console.log('\n=== 结果 ===');
if (failures === 0) { console.log('\x1b[32m全部通过 ✔\x1b[0m\n'); process.exit(0); }
console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m\n');
process.exit(1);
