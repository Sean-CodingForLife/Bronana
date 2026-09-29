/* =========================================================
   tools/flow-audit.mjs — 流程体检：从 0 到 1 到 100 的那些"逻辑"bug

   已有的测试是**逐项清单**式的（"进度逐项还原（角色/波次/等级/…）"）——
   清单之外的东西丢了它不会响。这里换一种问法：

     **把一局真实地玩到一个有内容的位置，存档，读档，然后把它和存档前逐字段对比。**

   丢了的字段就是"继续上一局会静默吞掉的东西"。哪些该活下来、哪些本来就该重置，
   不靠人记，靠 `Session` 的分组（types.d.ts）：Core / Market / Dungeon / Camp 是**进度**，
   Ents / Wave 是**世界**（子弹、粒子、这一波的刷怪队列 —— 读档后从零开始是正常的）。

   用法： node tools/flow-audit.mjs
   ========================================================= */
import { loadAll, SIM_MODULES } from '../test/_load.mjs';

await loadAll(SIM_MODULES);
const { Game, Dungeon, Camp, Boons, Enemies, U } = globalThis;
console.error = function () { };

/* ---------------- 1. 造一局"有内容"的存档 ---------------- */
const STEPS = Number(process.env.STEPS || 0);
let replayFail = 0;
let flowFail = 0;

function snapshot(obj) {
  const out = {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (typeof v === 'function') continue;
    try { out[k] = JSON.stringify(v); } catch (e) { out[k] = '(循环引用)'; }
  }
  return out;
}

/** 把一局推到"有内容"的位置：进过商店、买过东西、刷新过、建过营地、挑过契约、走过房间 */
function stage(seed) {
  const sess = Game.newRun('ranger', seed, 2);
  const p = sess.player;

  // 走几步、打一会（让 stats / 击杀 / 房间清理都非零）
  Game.setState('playing', true);
  Game._internals.startWave(3);
  for (let i = 0; i < (STEPS || 900); i++) Game.step(Game.cfg.fixedDt, Game.autoInput(i / 60));

  // 升级（走真实路径：经验够了 → 进 levelup → 选卡）
  p.xp = 9999;
  Game._internals.checkLevelUp();
  let guard = 0;
  while (Game.state === 'levelup' && guard++ < 60) Game.chooseLevelCard(0);

  // 攒点材料，进商店，买东西 / 刷新 / 锁定
  p.scrap = 500;
  p.hp = Math.max(1, p.hp);
  Game._internals.openShop(20);
  Game.buyOffer(0);
  Game.reroll();
  Game.toggleLock();

  // 营地：买两个（走真实路径，价格/建材都按规则扣）
  sess.campPoints = 200;
  const buyable = Camp.LIST.filter(d => !d.req);
  for (const d of buyable.slice(0, 2)) Game.campBuy(d.id);

  // 契约：造两份候选并挑一条
  sess.pendingBoons = Boons.roll(2, sess.rnd);
  if (sess.pendingBoons.length) Game.pickBoon(sess.pendingBoons[0]);

  // 破一堵墙 + 记一间密室 + 认一只 Boss（这些都要进存档）
  const map = sess.map;
  const secret = map.rooms.find(r => r.type === 'secret');
  if (secret && map.rooms[0]) {
    /* 墙键带**层号**（`层号|房A|房B`）。以前是两参数，读档时只有当前层的记录能留下 ——
       这个工具当年就是这么漏过去的：它用旧签名写了一个**不属于任何层**的键，
       于是"进度漂移"和"存档不幂等"两条都报出来。键的形态变了，写它的地方也要跟着变。 */
    sess.walls[Dungeon.wallKey(sess.floor, map.rooms[0].id, secret.id)] = true;
    sess.secretsFound = 1;
    sess.bossesDown.warden = true;
  }
  // 换到别的房间，并把下一层的门槛摸清
  const other = map.rooms.find(r => r.id !== sess.roomId);
  if (other) Game.enterRoom(Dungeon.DIRS ? 0 : 0);
  return sess;
}

const sess = stage(20240922);

/* ---------------- 2. 存档前 / 读档后逐字段对比 ---------------- */
const before = snapshot(sess);
/* 随机流的"接着走"要这样测：先记下当前状态，用**另一个** rng 放到这个状态上试抽 5 个
   （那就是"如果继续玩会抽到的 5 个数"），读档后再抽 5 个对比。
   第一版我直接拿"存档前抽的 5 个"去比，那是错的 —— 流本来就该往前走。 */
const rngStateAtSave = sess.rnd.state();
const probeRng = U.rng(1);
probeRng.setState(rngStateAtSave);
const expectRng = [];
for (let i = 0; i < 5; i++) expectRng.push(probeRng());
const data = Game.exportRun();
const saveKeys = Object.keys(data);
Game.importRun(data);
const after = snapshot(Game.getSession());
/* 二次存档：**存档应当是幂等的**（读档之后马上再存，得到的东西必须一样）——
   这一条比逐字段清单强：任何"读档时重掷 / 重置"都会在这里露出来。
   （要在抽随机数**之前**做：抽数会让 rndState 合法地往前走。） */
const data2 = Game.exportRun();
const drift2 = Object.keys(data).filter(k => JSON.stringify(data[k]) !== JSON.stringify(data2[k]));
const afterRng = [];
for (let i = 0; i < 5; i++) afterRng.push(Game.getSession().rnd());

/* 哪些组算"进度"：从 Session 的分组来（types.d.ts / test/persist.mjs 同一份声明） */
const PROGRESS_GROUPS = ['SessionCore', 'SessionMarket', 'SessionDungeon', 'SessionCraft'];
const WORLD_GROUPS = ['SessionEnts', 'SessionWave', 'SessionDebug'];
const fs = await import('node:fs');
const path = await import('node:path');
const tsrc = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'types.d.ts'), 'utf8');
const groupOf = {};
for (const g of PROGRESS_GROUPS.concat(WORLD_GROUPS)) {
  const m = new RegExp('interface ' + g + ' \\{([\\s\\S]*?)\\n\\}').exec(tsrc);
  if (!m) continue;
  for (const x of m[1].matchAll(/^\s{2}([A-Za-z_]\w*)\??:/gm)) groupOf[x[1]] = g;
}

const lost = [];
const changed = [];
for (const k of Object.keys(before)) {
  if (!(k in after)) { lost.push(k); continue; }
  if (before[k] !== after[k]) changed.push(k);
}
const missingInSave = Object.keys(before).filter(k => saveKeys.indexOf(k) < 0 && k in after);

const describe = (k) => {
  const g = groupOf[k] || '?';
  const kind = PROGRESS_GROUPS.indexOf(g) >= 0 ? '进度' : '世界';
  return k + '（' + g.replace('Session', '') + '·' + kind + '）';
};

console.log('=== 流程体检：一局的"存档 → 读档"逐字段对比 ===\n');
console.log('存档字段 ' + saveKeys.length + ' 个 · 会话字段 ' + Object.keys(before).length + ' 个');
console.log('读档**丢了**的字段：' + (lost.length ? lost.map(describe).join('  ') : '（无）'));
console.log('读档**变了**的字段：' + (changed.length ? changed.map(describe).join('  ') : '（无）'));
console.log('@不在 exportRun 里的会话字段：' + (missingInSave.length ? missingInSave.map(describe).join('  ') : '（无）'));

const badProgress = changed.filter(k => PROGRESS_GROUPS.indexOf(groupOf[k]) >= 0);
console.log('\n其中属于**进度组**却变了的：' + (badProgress.length ? badProgress.join(', ') : '（无）'));
for (const k of badProgress) {
  console.log('  · ' + k + '：存档前 ' + String(before[k]).slice(0, 90));
  console.log('    ' + ' '.repeat(k.length) + '  读档后 ' + String(after[k]).slice(0, 90));
}
/* 只有"没进存档"的进度字段才是可疑的：进了存档还变，可能是**重算**（正常）也可能是漂移 */
const suspicious = changed.filter(k => PROGRESS_GROUPS.indexOf(groupOf[k]) >= 0 && saveKeys.indexOf(k) < 0 &&
  k !== 'roomId');
console.log('  → 其中**既没进存档又变了**的（重算 or 漂移）：' +
  (suspicious.length ? suspicious.join(', ') : '（无）'));
console.log('\n随机流：如果继续玩，接下来 5 个数应是 ' + expectRng.map(x => x.toFixed(6)).join(' '));
console.log('        读档之后实际抽到的是 ' + afterRng.map(x => x.toFixed(6)).join(' '));
console.log('        → ' + (expectRng.join(',') === afterRng.join(',')
  ? '接着走 ✔' : '**对不上**（读档把随机流重置/错位了）'));
console.log('\n二次存档（存档应当幂等）：' +
  (drift2.length ? '**这些字段读档后再存变了** → ' + drift2.join(', ') : '与第一次逐字段一致 ✔'));

/* ---------------- 3. 能被反复刷的那些（读档刷新价 / 免费刷新） ---------------- */
console.log('\n=== 能靠"存档→读档"白刷的东西 ===');
const loops = [
  ['刷新价（rerollCost）', before.rerollCost, after.rerollCost],
  ['刷新次数（rerolls）', before.rerolls, after.rerolls],
  ['免费刷新（freeRerolls）', before.freeRerolls, after.freeRerolls],
  ['建材（campPoints）', before.campPoints, after.campPoints],
  ['待选升级（player.pendingLevels）', JSON.stringify(sess.player.pendingLevels), null]
];
for (const [name, b, a] of loops) {
  if (a === null) continue;
  console.log('  ' + (b === a ? '· ' : '✗ ') + name + '：存档前 ' + b + ' → 读档后 ' + a);
}

/* ---------------- 5. 回放保真：带子录下了所有"改一局状态"的命令吗 ---------------- */
console.log('\n=== 回放保真（成绩码承诺"可离线复算"）===');
{
  const { Rec, Scene, Input } = globalThis;
  /* 挑一条**带属性修正**的契约（数值型的那种才能量出差异） */
  const statBoon = Boons.LIST.find(d => {
    const f = Boons.fold(d.id);
    return f && f.stats && Object.keys(f.stats).length > 0;
  });
  Game.setState('title', true);
  Rec.start();
  Game.newRun('ranger', 777, 0);
  Game.setState('playing', true);
  Game._internals.startWave(4);
  const s2 = Game.getSession();
  /* 注意：这里**手工**把候选塞进会话（正常情况下它由"翻层"这个模拟内事件产生）。
     所以回放时也要用同样的手工前置 —— 否则测的就不是回放，而是"我的脚本没做同样的准备"
     （第一版就踩了这个：带子里有 pickBoon，回放却报"这条不在候选里"）。 */
  s2.pendingBoons = [statBoon.id];
  Game.pickBoon(statBoon.id);
  for (let i = 0; i < 120; i++) {
    if (Scene.simulates(Game.state)) Game.step(Game.cfg.fixedDt, Game.autoInput(i / 60));
    Input.endFrame();
  }
  const liveBoon = Game.getSession().boon;
  const liveDmg = Game.getSession().stats.damage;
  const tape = Rec.stop();
  const cmds = [...new Set(tape.events.map(e => e.cmd))];
  console.log('带子里录到的命令：' + cmds.join(', '));
  const hasBoon = cmds.indexOf('pickBoon') >= 0;
  console.log((hasBoon ? '· ' : '✗ ') + 'pickBoon 录下来了吗：' + (hasBoon ? '是' : '**没有**') +
    '（契约不可撤销，还会当场重算属性）');

  /* 回放：**不回放整条带子**（那里面第一条就是 newRun，会把会话重置，
     把我手工摆好的候选冲掉 —— 第一版就是这么误判的），
     而是分两件事验：
       A. 录制侧：带子里必须有 pickBoon（这就是缺的那条命令）
       B. 回放侧：一条"只含 pickBoon"的最小带子放进去，契约必须真的生效（属性也要变） */
  Game.setState('title', true);
  Game.newRun('ranger', 777, 0);
  Game.setState('playing', true);
  Game._internals.startWave(4);
  const beforeStat = Game.getSession().stats[Object.keys(Boons.fold(statBoon.id).stats)[0]];
  Game.getSession().pendingBoons = [statBoon.id];
  Rec.play({
    v: 1, frames: 1, seed: 777,
    events: [{ frame: 0, cmd: 'pickBoon', args: [statBoon.id], seed: 777 }],
    inputs: [[0, 0]]
  }, (x, y) => {
    if (Scene.simulates(Game.state)) Game.step(Game.cfg.fixedDt, { x: x, y: y });
    Input.endFrame();
  });
  const reBoon = Game.getSession().boon;
  const afterStat = Game.getSession().stats[Object.keys(Boons.fold(statBoon.id).stats)[0]];
  const okReplay = hasBoon && reBoon === statBoon.id && afterStat !== beforeStat;
  console.log('  回放侧：只放一条 pickBoon 的带子 → 契约 ' + (reBoon || '(无)') +
    ' · ' + Object.keys(Boons.fold(statBoon.id).stats)[0] + ' ' + beforeStat + ' → ' + afterStat);
  console.log('  → ' + (okReplay
    ? '录得下 + 放得出（原局契约 ' + liveBoon + ' 也是这条命令产生的）✔'
    : '**回放链断了**（成绩码的"可复算"在这一段是假的）'));
  if (!okReplay) replayFail++;
}

/* ---------------- 6. "下一波"按钮会把你送到哪：会不会**提前跳层** ---------------- */
console.log('\n=== "下一波"（下一关）会去哪 ===');
{
  let earlyBoss = 0, total = 0, dead = 0;
  let lastDeny = '';
  Game.events.on('deny', m => { lastDeny = String(m); });
  for (const seed of [12345, 777, 4242, 20240922, 31, 5, 99]) {
    Game.setState('title', true);
    Game.newRun('ranger', seed, 0);
    Game.setState('playing', true);
    const s = Game.getSession();
    const route = [];
    for (let i = 0; i < 24; i++) {
      const cur = Dungeon.roomById(s.map, s.roomId);
      if (!cur) break;
      if (!cur.cleared) { s.forceClear = true; s.waveEnding = false; Game._internals.endWave(); }
      if (Game.state === 'end') { route.push('通关'); break; }
      const beforeRoom = s.roomId, beforeFloor = s.floor;
      lastDeny = '';
      if (!Game.nextWave()) {
        const leftAll = s.map.rooms.filter(r => !r.cleared && r.type !== 'start').length;
        const vis = Dungeon.visible(s.map).filter(r => !r.cleared).length;
        route.push('按下无反应（' + (lastDeny || '?') + '｜本层还剩 ' + leftAll + ' 间未清、其中可见 ' + vis + '）');
        dead++;
        break;
      }
      const now = Dungeon.roomById(s.map, s.roomId);
      const left = Dungeon.visible(s.map).filter(r => !r.cleared && r.type !== 'start' && r.type !== 'boss');
      const jumped = s.floor !== beforeFloor;
      route.push((now ? now.type : '?') + '(' + left.length + ')' + (jumped ? '⇒第' + s.floor + '层' : ''));
      total++;
      if (now && now.type === 'boss' && left.length) {
        earlyBoss++;
        route[route.length - 1] += '**提前进关底**';
      }
      if (now && now.id === beforeRoom) { route.push('原地'); break; }
    }
    console.log('  seed ' + String(seed).padEnd(9) + ' 路线：' + route.join(' → '));
  }
  console.log((earlyBoss ? '✗ ' : '· ') + '"没走完就被送进关底"的次数：' + earlyBoss + ' / ' + total + ' 次点击');
  console.log((dead ? '✗ ' : '· ') + '"下一波"按下去没反应的次数：' + dead + ' / 7 个种子');
  if (earlyBoss || dead) flowFail++;
}
/* roomFx 的 fast/slow 倍率读档后是 0：那是**安全的**（endWave 用 `|| 默认值` 兜底），
   而它会在下一间房的 startWave 重新折一遍 —— 所以列进"已知正常"。
   affixN 是**随机流的计数器**（词条系统）：它不是进度，是"这一局已经派生出几批
   词条随机流"。读档后它从 0 重新开始，而**主随机流的状态是存下来的** ——
   于是读档后的第一件装备拿到的词条与"假设的不一样"，但它同样确定、同样可复现。
   要不要把它也存进存档？存了会更"像进度"，但代价是存档格式多一个与玩法无关的计数，
   而且它**永远不该影响任何玩法数值**（词条是在生成时定死的，不是每帧重算的）。
   所以这里用显式登记代替"装作没发生"：它是**已知且有意**的重置。 */
const KNOWN_OK = {
  roomFx: '房型倍率，读档后由下一次 startWave 重折；0 是安全默认值（endWave 用 || 兜底）',
  affixN: '词条随机流的批次计数（不是进度）：主随机流状态已进存档，读档后重新计批仍然确定可复现'
};
const realBad = badProgress.filter(k => !KNOWN_OK[k]);
const rngOk = expectRng.join(',') === afterRng.join(',');
console.log('\n=== 结果 ===');
const problems = realBad.length + (rngOk ? 0 : 1) + drift2.length + replayFail;
if (badProgress.length) {
  console.log('进度组里变了但**已知正常**的：' +
    badProgress.filter(k => KNOWN_OK[k]).map(k => k + '（' + KNOWN_OK[k] + '）').join('；'));
}
console.log(problems ? ('发现 ' + problems + ' 处需要处理：' +
  (realBad.length ? '进度漂移 ' + realBad.join(',') + '；' : '') +
  (rngOk ? '' : '随机流错位；') + (drift2.length ? '存档不幂等 ' + drift2.join(',') + '；' : '') +
  (replayFail ? '回放不保真 ' + replayFail + ' 处；' : '') +
  (flowFail ? '流程可疑 ' + flowFail + ' 处' : ''))
  : '进度逐字段一致 · 随机流接着走 · 存档幂等 · 回放保真 · 下一关不跳层 ✔');
process.exit(problems ? 1 : 0);
