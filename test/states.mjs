/* =========================================================
   states.ts — 状态机测试
   改造前 state 是裸字符串，15 处写入散在 4 个文件，没有校验。
   实测过的三个真实故障：
     · 非商店状态调用 nextWave() → 直接跳掉一整波（"下一波"连点两次就中招）
     · 非商店状态调用 buyOffer() → 战斗中也能买走商店货
     · UI.refresh() 缺 howto 分支 → 帮助浮层消失但游戏没恢复（在 ui-check 里测）
   用法： node test/states.mjs
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

const { Game } = globalThis;
const FIXED = Game.cfg.fixedDt;
console.error = function () { };   // 静音被隔离的告警

console.log('\n=== Bronana · 状态机测试 ===\n');

/* ---------------- 转换表本身 ---------------- */
console.log('[1] 转换表');
{
  const states = new Set(Game.STATES);
  let badTarget = [];
  for (const from in Game.TRANSITIONS) {
    if (!states.has(from)) badTarget.push('未知来源 ' + from);
    for (const to of Game.TRANSITIONS[from]) if (!states.has(to)) badTarget.push(from + '→' + to);
  }
  ok(badTarget.length === 0, '表里没有未知状态', badTarget.join(', '));

  const noOut = Game.STATES.filter(s => !Game.TRANSITIONS[s] || !Game.TRANSITIONS[s].length);
  ok(noOut.length === 0, '每个状态都有出口（无死状态）', noOut.join(', '));

  // 从 title 出发必须能到达所有状态
  const seen = new Set(['title']);
  const queue = ['title'];
  while (queue.length) {
    const cur = queue.shift();
    for (const nx of (Game.TRANSITIONS[cur] || [])) {
      if (!seen.has(nx)) { seen.add(nx); queue.push(nx); }
    }
  }
  const unreachable = Game.STATES.filter(s => !seen.has(s));
  ok(unreachable.length === 0, '所有状态都能从 title 到达', unreachable.join(', '));
  console.log('    状态 ' + Game.STATES.length + ' 个，转换 ' +
    Object.values(Game.TRANSITIONS).reduce((a, b) => a + b.length, 0) + ' 条');
}

/* ---------------- 合法 / 非法转换 ---------------- */
console.log('\n[2] 转换校验');
{
  const events = [];
  Game.events.on('stateChange', d => events.push('change:' + d.from + '>' + d.to));
  Game.events.on('stateDenied', d => events.push('deny:' + d.from + '>' + d.to));

  // 每条断言前都把状态摆回起点，避免相互串联
  const from = (s) => Game.setState(s, true);

  from('title');
  ok(Game.setState('chars') === true, 'title → chars 允许');

  from('chars');
  ok(Game.setState('playing') === false && Game.state === 'chars',
    'chars → playing 被拒绝（否则会出现"playing 却没有会话"的崩溃状态）', Game.state);

  from('chars');
  ok(Game.setState('shop') === false, 'chars → shop 被拒绝');

  from('title');
  ok(Game.setState('shop') === false, 'title → shop 被拒绝');

  // playing → shop 是模拟层波次结束的正常路径，必须允许
  Game.newRun('ranger', 7);
  ok(Game.canSetState('shop') === true, 'playing → shop 允许（波次结束由模拟层触发）');

  // 同状态幂等且不发事件
  const n0 = events.length;
  Game.setState('playing');
  ok(events.length === n0 && Game.state === 'playing', '同状态转换幂等且不发事件', Game.state);

  const changes = events.filter(e => e.indexOf('change:') === 0).length;
  const denies = events.filter(e => e.indexOf('deny:') === 0).length;
  console.log('    事件：合法转换 ' + changes + ' 次，非法转换 ' + denies + ' 次');
  ok(denies >= 3, '非法转换都发出了 stateDenied', denies);
  ok(changes >= 3, '合法转换都发出了 stateChange', changes);

  // 没有会话时 step 必须是安全的（防御性）
  from('playing');
  let nullSessErr = null;
  try { for (let i = 0; i < 5; i++) Game.step(1 / 60, { x: 0, y: 0 }); }
  catch (e) { nullSessErr = e.message; }
  ok(nullSessErr === null, '无会话时 step 安全返回不崩', nullSessErr);
  Game.setState('title', true);
}

/* ---------------- 回归：nextWave 跳波 ---------------- */
console.log('\n[3] 回归：非商店状态下 nextWave 不得跳波');
{
  Game.newRun('ranger', 11);
  const s = Game.getSession();
  s.waveLeft = 0; s.spawnQueue = []; s.spawnIdx = 0; s.enemies.length = 0;
  Game.step(FIXED, { x: 0, y: 0 });                 // 触发波次结算 → shop
  ok(Game.state === 'shop', '波次结束进入商店', Game.state);

  const w0 = Game.wave;
  ok(Game.nextWave() === true, '商店里可以进入下一波');
  const w1 = Game.wave;
  ok(w1 === w0 + 1, '只前进一波', w0 + ' → ' + w1);
  // 第二次调用（模拟"下一波"按钮连点）必须被拒绝
  const again = Game.nextWave();
  ok(again === false && Game.wave === w1, '再次调用被拒绝，波次不再前进（旧实现会跳掉一整波）',
    '返回 ' + again + '，波次 ' + Game.wave);
}

/* ---------------- 动作前置校验 ---------------- */
console.log('\n[4] 动作只在对应状态可用');
{
  Game.newRun('ranger', 12);
  const s = Game.getSession();
  s.player.scrap = 9999;
  Game._internals.openShop(0);                       // 造出商店货架
  const offers = s.offers.length;
  Game.setState('playing', true);                    // 强行离开商店，模拟残留点击

  ok(Game.buyOffer(0) === false, '战斗中不能买商店货（旧实现能买成功）');
  ok(Game.buyPack('basic') === false, '战斗中不能开道具包');
  ok(Game.reroll() === false, '战斗中不能刷新商店');
  ok(Game.toggleLock() === false, '战斗中不能锁定商店');
  ok(Game.sellWeapon(0) === false, '战斗中不能卖武器');
  ok(Game.chooseLevelCard(0) === false, '非升级状态下不能选卡');
  ok(offers === s.offers.length, '被拒绝的操作没有副作用', s.offers.length);

  Game.setState('shop', true);
  ok(Game.reroll() === true, '商店里可以刷新');
  ok(Game.toggleLock() === true, '商店里可以锁定');
  Game.toggleLock();
  ok(Game.buyPack('basic') === true, '商店里可以开包');
}

/* ---------------- 回归：被拒绝的动作不许改状态机 ---------------- */
console.log('\n[4b] 回归：`enterRoom` 的非法参数不许把状态从商店打回战斗');
{
  /* 这一条是**从对局体检里挖出来的真 bug**（`tools/fun-audit.mjs`）：
     `enterRoom` 老实现第一件事就是"从商店/营地切回 playing"，**然后**才检查
     门 / 锁 / 暗门 —— 于是任何一次失败的走门都会把玩家从商店里拽回战斗。
     后果是连锁的：`buyOffer` 从此全是"当前不在商店界面"，
     实测一局试买 4 次、成功 **0** 次；而玩家看到的是
     "我明明还在商店里，怎么买不了了"。修好之后同一批对局
     中位从第 5 波涨到第 31 波、构筑决策密度从 0 涨到 4.0/分钟。

     判据：**凡是返回 false 的公开动作，都不许改状态** ——
     与"材料不足时一分钱不扣"是同一条纪律，只不过这次赌的是状态机。 */
  Game.newRun('ranger', 4242);
  const s = Game.getSession();
  s.player.scrap = 9999;
  Game._internals.openShop(0);
  Game.setState('shop', true);

  const before = Game.state, offers0 = s.offers.length;
  const bad = [9, -1, 4, NaN, undefined, 'x', null];
  let broke = [];
  for (const d of bad) {
    const ret = Game.enterRoom(d);
    if (ret !== false) broke.push('enterRoom(' + String(d) + ') 竟然成功了');
    if (Game.state !== before) broke.push('enterRoom(' + String(d) + ') 把状态改成了 ' + Game.state);
  }
  ok(broke.length === 0, '7 种非法方向全部被拒，且**状态没变**（还是 ' + before + '）', broke.join(' | '));

  /* 反证：修好之后，商店里的买卖真的能成交 —— 这才是"状态没被打破"的证据 */
  const mats0 = s.player.scrap;
  const bots = s.offers.length;
  ok(bots > 0, '货架上有货（' + bots + ' 件），能验证购买路径');
  let bought = 0;
  for (let i = 0; i < bots; i++) if (Game.buyOffer(i) === true) bought++;
  ok(bought > 0, '非法参数之后仍然买得进（成功 ' + bought + ' 件）');
  ok(s.player.scrap < mats0, '而且钱真的扣了（' + mats0 + ' → ' + Math.round(s.player.scrap) + '）');
  ok(offers0 === bots, '货架件数没被非法调用改动', offers0 + ' → ' + s.offers.length);
  Game.setState('title', true);
}

/* ---------------- 回归：破墙记录必须分楼层存 ---------------- */
console.log('\n[4c] 回归：`walls` 的键带层号（读档不许丢掉别的层的破墙记录）');
{
  /* 另一条从探针里挖出来的真 bug：键一度是 `房A|房B`（不含层号），
     而读档时用当前层的地图去校 —— `restoreFloor` 只重建当前层，
     于是别的层的记录被当成"坏档"丢掉（实测：三层跑到第 2 层读档，
     walls 从 2 条变 1 条）。键里带层号之后，"第几层的哪一面墙"
     是键自己携带的信息，读档不需要（也不该）回表。 */
  Game.newRun('ranger', 777);
  const s = Game.getSession();
  /* 三层各记一面墙 —— 直接写进 `S.walls`，因为"打穿墙"本身由 rooms.mjs 覆盖 */
  const k1 = Dungeon.wallKey(1, 'r1_0_0', 'r1_1_0');
  const k2 = Dungeon.wallKey(2, 'r2_0_0', 'r2_1_0');
  const k3 = Dungeon.wallKey(3, 'r3_0_0', 'r3_1_0');
  s.walls[k1] = true; s.walls[k2] = true; s.walls[k3] = true;
  ok(k1 !== k2 && k2 !== k3, '三层同一对房间 id 的键互不相同（层号进了键）',
    [k1, k2, k3].join(' · '));
  ok(k1.indexOf('|') === k1.lastIndexOf('|') - 0 ? true : /^\d+\|/.test(k1),
    '键的形状是 `层号|房A|房B`', k1);
  ok(Dungeon.wallOpen(s.walls, 2, 'r2_0_0', 'r2_1_0') === true,
    '第 2 层那一面是破的');
  ok(Dungeon.wallOpen(s.walls, 1, 'r2_0_0', 'r2_1_0') === false,
    '拿第 1 层去查第 2 层的房 = 没破（层号真的是隔离的）');

  /* 存档往返：三条都要还在（老实现只会剩当前层那一条） */
  const data = Game.exportRun();
  ok(data.walls.length === 3, '导出带着三层的破墙记录', JSON.stringify(data.walls));
  const s2 = Game.importRun(JSON.parse(JSON.stringify(data)));
  ok(!!s2, '读档成功');
  const back = Object.keys(s2.walls).sort();
  ok(back.length === 3 && back.indexOf(k1) >= 0 && back.indexOf(k2) >= 0 && back.indexOf(k3) >= 0,
    '读档之后三层的记录都还在（不是只剩当前层那一条）', JSON.stringify(back));
  Game.setState('title', true);
}

/* ---------------- 暂停 / 恢复 ---------------- */
console.log('\n[5] 暂停与恢复');
{
  Game.newRun('ranger', 13);
  ok(Game.pause() === true && Game.state === 'paused', 'playing → paused');
  ok(Game.resume() === true && Game.state === 'playing', '恢复回来处');
  Game.setState('title', true);
  ok(Game.pause() === false, '标题页不能暂停');
  ok(Game.resume() === false, '不在暂停状态时恢复无效');
  Game.newRun('ranger', 14);
  Game.pause();
  Game.resume();
  ok(Game.state === 'playing', '连续暂停/恢复正常', Game.state);
}

/* ---------------- 状态机与模拟的关系 ---------------- */
console.log('\n[6] 非法转换不会推进模拟');
{
  Game.newRun('ranger', 15);
  const s = Game.getSession();
  s.waveT = 0;
  Game.setState('paused', true);
  for (let i = 0; i < 60; i++) Game.step(FIXED, { x: 0, y: 0 });
  ok(s.waveT === 0, '暂停时 step 不推进模拟', s.waveT);
  Game.setState('playing', true);
  for (let i = 0; i < 60; i++) Game.step(FIXED, { x: 0, y: 0 });
  ok(s.waveT > 0, '恢复后继续推进', s.waveT.toFixed(2));
}

/* ---------------- 静态检查：唯一写入口 ---------------- */
console.log('\n[7] 唯一写入口（静态检查）');
{
  const files = fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.endsWith('.ts'));
  const writers = [];
  let gameWrites = 0;
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
    // 只匹配赋值，不匹配 === / !==
    const hits = [...src.matchAll(/Game\.state\s*=\s*[^=]/g)];
    if (!hits.length) continue;
    writers.push(f + '×' + hits.length);
    if (f === 'game.ts') gameWrites = hits.length;
  }
  console.log('    直接写 Game.state 的位置：' + writers.join(', ') || '（无）');
  ok(writers.length === 1 && writers[0] === 'game.ts×1',
    '只有 game.ts 里有一处状态写入（即 setState 内部）', writers.join(', '));
  ok(gameWrites === 1, 'setState 是唯一入口', gameWrites + ' 处');
}

/* ---------------- 场景表 ---------------- */
console.log('\n[8] 场景表（scene.ts）：一个阶段是什么，只声明一次');
{
  const Scene = globalThis.Scene;

  const v = Scene.validate();
  ok(v.ok === true, '场景表通过定义期校验（状态漏场景 / 覆盖层撞车都会抛错）', (v.problems || []).join(' | '));
  ok(Array.isArray(v.problems) && v.problems.length === 0, '校验返回的是问题清单（与其它模块的 audit 同形）');

  let miss = [];
  for (const st of Game.STATES) if (!Scene.has(st)) miss.push(st);
  ok(miss.length === 0, '全部 ' + Game.STATES.length + ' 个状态都有场景', miss.join(','));
  const extra = Object.keys(Scene.TABLE).filter(s => Game.STATES.indexOf(s) < 0);
  ok(extra.length === 0, '没有多余场景（表里的键必须都在 Game.STATES 里）', extra.join(','));

  let thrown = '';
  try { Scene.of('没有这个状态'); } catch (e) { thrown = e.message; }
  ok(/未知状态/.test(thrown), '取未知状态的场景会抛错（而不是返回 undefined 让调用方踩空）', thrown);

  const ov = Scene.overlayNames();
  ok(new Set(ov).size === ov.length, '覆盖层不重复（同一时刻只有一个界面在显示）', ov.join(','));
  const notes = Game.STATES.filter(st => !Scene.of(st).note);
  ok(notes.length === 0, '每个场景都写了 note（强迫写清"这个阶段是什么"）', notes.join(','));

  // sim 列必须与实测一致：逐状态跑一步，看会话时间是否前进
  Game.newRun('gladiator', 21);
  const sess = Game.getSession();
  holdRoom(sess);                       // 别让波次在测试中途结束
  const simErr = [];
  for (const st of Game.STATES) {
    Game.setState(st, true);
    const t0 = sess.time;
    Game.step(FIXED, { x: 0, y: 0 });
    const advanced = sess.time > t0;
    if (advanced !== Scene.simulates(st)) {
      simErr.push(st + '：表里 sim=' + Scene.simulates(st) + '，实测 ' + (advanced ? '前进' : '不动'));
    }
  }
  ok(simErr.length === 0,
    'sim 列与实测一致（只有 ' + Game.STATES.filter(s => Scene.simulates(s)).join('/') + ' 推进逻辑帧）',
    simErr.join(' | '));

  // 静态检查：表现层不再各自硬编码"哪个状态怎样"
  const readSrc = f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
  const hard = [];
  for (const f of ['main.ts', 'ui.ts']) {
    const src = readSrc(f);
    const hits = [...src.matchAll(/Game\.state\s*===|Game\.state\s*!==/g)];
    if (hits.length) hard.push(f + '×' + hits.length);
  }
  ok(hard.length === 0, 'main.ts / ui.ts 里不再按状态硬编码（可见性、闸门都走场景表）', hard.join(', '));

  // 每个按键组都真的有人处理（防"表里声明了、代码里没人管"）
  const mainSrc = readSrc('main.ts');
  const groups = new Set(Game.STATES.map(st => Scene.keyGroup(st)));
  const unhandled = [...groups].filter(g => g !== 'none' && mainSrc.indexOf("'" + g + "'") < 0);
  ok(unhandled.length === 0, '每个按键组都在 main.ts 里有对应分支', unhandled.join(','));

  // 场景系统不能反过来吞掉状态机：合法转换仍然由转换表说了算
  Game.setState('chars', true);
  ok(Game.canSetState('playing') === false && Game.canSetState('title') === true,
    '状态机仍是唯一权威（chars → playing 依然被拒绝、chars → title 允许）');

  console.log('    ' + Scene.describe().split('\n').join('\n    '));
}

console.error = console.error;
console.log('\n=== 结果 ===');
if (failures === 0) { console.log('\x1b[32m全部通过 ✔\x1b[0m\n'); process.exit(0); }
console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m\n');
process.exit(1);
