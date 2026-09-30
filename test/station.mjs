/* =========================================================
   station.mjs — 大厅（站）：三道常开的门
   ---------------------------------------------------------
   守的是**设计上下文 v3 §4-规则2/3** 那两条：

     规则2 "玩家**任何时候可以去任何模块**…不做'不玩A就不能玩B'的锁。"
     规则3 "跳过某模块 → **撞墙**（那条路走不通），而不是被卡住
            （游戏不让你继续）。"

   ⚠ 这一版与上一版**正好相反**。上一版把门做成"花 40 材料盖经营门，
   花 60 + 前置盖养成门"，还专门有一条自检守"至少有一道门要花钱"
   （理由是"那样'先去哪个'才是决策"）。v3 把那个理由否掉了 ——
   收费的门是**卡住**：不玩战斗就没材料，连经营长什么样都看不到。

   撞墙应当发生在**模块内部**（缺核心素材 → 关键建筑升不上去），
   不是在门口。所以现在守的是：**每一道门都不许收费、不许有前置**。
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { loadAll, SIM_MODULES } from './_load.mjs';

await loadAll(SIM_MODULES);
const { Station, Ledger, Link } = globalThis;

let failures = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  \x1b[32mPASS\x1b[0m ' + label);
  else { failures++; console.log('  \x1b[31mFAIL\x1b[0m ' + label + (extra !== undefined ? '  → ' + extra : '')); }
}

console.log('\n=== Bronana · 大厅（站） ===\n');

/* =========================================================
   [1] 表本身
   ========================================================= */
console.log('[1] 站点表');
{
  const v = Station.audit();
  ok(v.ok, '大厅自检通过（' + v.counts.sites + ' 站点 / ' + v.counts.portals + ' 道门）',
    (v.problems || []).join(' | '));

  for (const sys of Object.keys(Ledger.SYSTEMS)) {
    const gate = Station.LIST.filter(s => s.kind === 'portal' && s.to === sys);
    ok(gate.length === 1,
      '模块「' + Ledger.SYSTEMS[sys].name + '」在大厅里有且只有一道门' +
      (gate.length ? '（' + gate[0].name + '）' : ' —— 到不了它'));
  }
}

/* =========================================================
   [2] 门常开：v3 §4-规则2（"玩家任何时候可以去任何模块"）
   ========================================================= */
console.log('\n[2] 三扇门全部常开（不是"要建成才能开"）');
{
  const portals = Station.LIST.filter(s => s.kind === 'portal');
  ok(portals.length === 3, '三道门（战斗 / 经营 / 养成）');

  for (const p of portals) {
    ok(p.cost === 0, '「' + p.name + '」不收费 —— 收费的门是**卡住**，不是撞墙');
    ok(p.req.length === 0, '「' + p.name + '」没有前置 —— v3 明确"不做不玩A就不能玩B的锁"');
  }

  /* 出生那一刻三门全通 —— "任何时候可以去任何模块" */
  const open = Station.defaultOpen();
  ok(Station.reachable({ 'gate-combat': true, 'gate-manage': true, 'gate-grow': true }).length === 3,
    '三道门开着时，三个模块都能去（"想去哪就去哪"）');
  ok(open.length >= 3, '出生时开着的站点 ≥ 3（三扇门 + 公告板都常开）', open.join(', '));

  /* 「一条路走到黑」必须从第一秒就通 */
  ok(open.indexOf('gate-combat') >= 0, '"一条路走到黑"成立：出生就能直接出击');

  /* 撞墙在**模块内部**：缺核心素材 → 那条路推不动。
     这里断言"墙"确实存在（否则"结构性依赖"就落空了）。 */
  const walls = Link.LIST.filter(l => l.consumedBy === 'manage' || l.consumedBy === 'grow');
  ok(walls.length >= 2, '至少两条模块内部的路会因为缺核心素材而推不动（撞墙在模块内）',
    walls.map(l => l.id).join(','));
}

/* =========================================================
   [3] 开门规则仍然可用（机制在，只是三道门都不需要它）
   ========================================================= */
console.log('\n[3] 开门规则（机制在）');
{
  const nothing = {};
  /* 门本身不收费，所以"能不能开"永远 ok；三种拒绝仍然分得清（给未来的子区域用） */
  ok(Station.canOpen(nothing, 'gate-manage', 0).ok, '不收费的门：没有材料也能开');
  const again = Station.canOpen({ 'gate-manage': true }, 'gate-manage', 999);
  ok(!again.ok && /已经开/.test(again.reason),
    '已经开过的门 → 报"已经开了"（不重复开）', again.reason);
  ok(!Station.canOpen(nothing, 'nope', 999).ok, '不存在的站点 → 拒绝（不炸）');
  ok(!Station.canOpen(nothing, 'board', 999).ok, '公告板不是门，不需要"开"');
}

/* =========================================================
   [4] 可达性
   ========================================================= */
console.log('\n[4] 可达性');
{
  ok(Station.reachable(null).length === 0, '一道门都没开 → 哪也去不了');
  const all = Station.reachable({ 'gate-combat': true, 'gate-manage': true, 'gate-grow': true });
  ok(all.length === 3, '三门全开 → 三个模块都能去', all.join());
  ok(Station.locked({ 'gate-combat': true }).length === 2, '还没开的门有 2 道（界面据此摆"下一条"）');
}

/* =========================================================
   [5] 反证：把表改坏，自检必须报
   ---------------------------------------------------------
   ⚠ 前两条与上一版**相反** —— 上一版守"至少一道门要花钱"，
   现在守"一道都不许花钱"。这是 v3 §4-规则2 直接推出来的。
   ========================================================= */
console.log('\n[5] 反证（每一条对应一个真实故障）');
{
  const SITES = Station.LIST;
  const restore = new Map(SITES.map(s => [s, { cost: s.cost, req: s.req.slice(), to: s.to }]));
  const put = () => { for (const [s, v] of restore) { s.cost = v.cost; s.req = v.req.slice(); s.to = v.to; } };

  /* ① 门通向一个不存在的模块 → 点下去什么也不发生 */
  const g1 = Station.BY_ID['gate-manage'];
  g1.to = 'noSuchModule';
  ok(!Station.audit().ok && Station.audit().problems.some(p => /不存在的模块/.test(p)),
    '门通向不存在的模块 → 自检报出来', Station.audit().problems[0]);
  put();

  /* ② 摘掉一扇门 → 那个模块这一局到不了 */
  const idx = SITES.findIndex(s => s.id === 'gate-grow');
  const g2 = SITES.splice(idx, 1)[0];
  ok(!Station.audit().ok && Station.audit().problems.some(p => /一道门都没有/.test(p)),
    '摘掉一扇门 → 自检报"那个模块到不了"', Station.audit().problems[0]);
  SITES.splice(idx, 0, g2);

  /* ③ **门收费** → 报（v3 §4-规则2："任何时候可以去任何模块"） */
  const g3 = Station.BY_ID['gate-manage'];
  const keepCost = g3.cost;
  g3.cost = 40;
  ok(!Station.audit().ok && Station.audit().problems.some(p => /要花 40 才能开/.test(p)),
    '门收费 → 自检报出来（那是**卡住**，不是撞墙）', Station.audit().problems[0]);
  g3.cost = keepCost;

  /* ④ **门有前置** → 报（那正是"不玩A就不能玩B"的锁） */
  const g4 = Station.BY_ID['gate-grow'];
  const keepReq = g4.req;
  g4.req = ['gate-manage'];
  ok(!Station.audit().ok && Station.audit().problems.some(p => /有前置/.test(p)),
    '门有前置 → 自检报出来（v3 明确不做这种锁）', Station.audit().problems[0]);
  g4.req = keepReq;

  put();
  ok(Station.audit().ok, '全部改回来之后自检重新通过', (Station.audit().problems || []).join(' | '));
}

/* =========================================================
   [6] 进总账
   ========================================================= */
console.log('\n[6] 总账');
{
  const R = globalThis.Registry;
  ok(R.has('stationSite'), '大厅站点进了扩展点总账（family: stationSite）');
  ok(R.ids('stationSite').length === Station.LIST.length,
    '总账里的站点数与表一致（' + R.ids('stationSite').length + '）');
  ok(R.audit().ok, '总账整体仍然自洽（门通向的模块名都真的存在）',
    (R.audit().missing || []).slice(0, 3).join(' | '));
}

/* =========================================================
   [7] 接线：三道门真的通到界面（"表是对的" ≠ "玩家点得到"）
   ---------------------------------------------------------
   前面六节验的是**表本身**。这一节验**线** —— 状态 / 场景 / 界面分散在
   三个文件里（game.ts / scene.ts / ui.ts + index.html），写错任何一边的表现
   都是"点了出发，游戏开局了，界面却还停在选人页"或"点了那扇门什么也没发生"：

     · 状态机里有 `station`，而且它与 `playing` **互通**（局内的来回）
     · 场景表把它登记成局内一屏（world:true / sim:false）
     · 模块 → 屏幕的翻译表（scene.ts 的 MODULE_SCREENS）三个都在
     · index.html 里有那一屏与三块内容（id 是界面契约的一部分）
     · ui.ts 里有渲染函数、两道门动作，以及"开局落在大厅"那一步
   ========================================================= */
console.log('\n[7] 接线（状态 → 场景 → 界面）');
{
  const ROOT = path.resolve(import.meta.dirname, '..');
  const { Game, Scene } = globalThis;

  ok(Game.STATES.indexOf('station') >= 0, '状态机里有 station（大厅是状态机里的一等公民）');
  ok(Scene.has('station'), '场景表里有 station（缺了它 Scene.of 会抛错）');
  ok(Scene.refreshOf('station') === 'station',
    'station 登记了重画（不登记 = 进站第二眼看到的是上一次的账）');
  /* ⚠ 2026-10："大厅是一间能走的房"之后，sim 从 false 改成 true ——
     推进的是**屋里的人**（Game.step 走 stepHall），**不碰波次**。 */
  ok(Scene.of('station').world === true && Scene.of('station').sim === true,
    'station 归**局内**：画世界，而且真的在走（sim:true —— 逻辑帧推进的是屋里的人）');
  ok(Scene.of('station').keys === 'hall',
    '大厅的按键组是 hall（方向键 = 走路，不是菜单焦点）');
  ok(Station.BY_ID['gate-combat'].screen === 'playing',
    '门表自己写着去处（screen 从 scene.ts 搬回了门表这一边）',
    Station.BY_ID['gate-combat'].screen);
  ok(Scene.of('station').overlay === 'station', 'station 的覆盖层是它自己');

  /* 模块 → 屏幕：三道门的翻译表（写错一个字母 = 那扇门点下去没反应） */
  const SCREENS = { combat: 'playing', manage: 'keep', grow: 'talents' };
  for (const mod of Object.keys(SCREENS)) {
    ok(Scene.moduleScreenOf(mod) === SCREENS[mod],
      '门「' + mod + '」通向 ' + SCREENS[mod], Scene.moduleScreenOf(mod));
  }
  ok(Scene.moduleScreenOf('noSuchModule') === null, '未知模块 → null（调用方不许瞎猜）');

  /* 转换：大厅 ↔ 战斗是**局内**的来回；选人页仍然进不去大厅 */
  Game.newRun('ranger', 99);
  ok(Game.state === 'playing', 'newRun 仍然落 playing（大厅是界面层的设计，不绑架模拟层）', Game.state);
  ok(Game.canSetState('station') === true, 'playing → station 合法（开局落在大厅 / 从暂停回大厅）');
  Game.setState('station', true);
  ok(Game.state === 'station', '切进大厅成功');
  ok(Game.canSetState('playing') === true, 'station → playing 合法（出击门回到手里这一局）');
  ok(Game.canSetState('keep') === true && Game.canSetState('talents') === true,
    'station → keep / talents 合法（经营门 / 养成门）');
  ok(Game.canSetState('chars') === false,
    'station → chars 被拒（回选人页 = 开新局，那条路只有 newRun 一条）');

  /* ---- 这一节真正要证明的事：大厅不是"一排按钮"，是一间**能走的房** ----
     用户的原话是"我需要真实可以玩可以探索的世界，而不是给我几个按钮和选项"。
     所以这里不满足于"表里有三道门"，而是真的推输入走两步：
       · 推输入 → 位置真的变（房间不是背景图）
       · 撞墙   → 停住，再推也不穿、也不抖（墙不是画上去的）
       · 走进门 → 真的换屏（门是过道，不是卡片上的字） */
  ok(!!Game.hall() && Game.hall().room === 'station',
    '进屋就有一份"走到哪"的状态（Game.hall()，而不是菜单焦点）');
  const hall = Game.hall();
  const hx = hall.x, hy = hall.y;
  ok(Math.abs(hx - 300) < 1,
    '从 playing 回来站在出击门口（spawnAt 按"从哪来"落点）', hx);
  for (let i = 0; i < 30; i++) Game.step(Game.cfg.fixedDt, { x: 1, y: 0 });
  ok(hall.x > hx + 20,
    '按住"右"真的会走（30 帧位移 ' + Math.round(hall.x - hx) + 'px）');
  ok(Math.abs(hall.y - hy) < 1, '横着走不会漂到另一条轴上');
  for (let i = 0; i < 240; i++) Game.step(Game.cfg.fixedDt, { x: 0, y: -1 });
  const wallStop = hall.y;
  ok(Math.abs(wallStop - 245) < 2,
    '撞上控制台真的会停住（y=' + Math.round(wallStop) + '；墙的下沿在 230）');
  for (let i = 0; i < 30; i++) Game.step(Game.cfg.fixedDt, { x: 0, y: -1 });
  ok(Math.abs(hall.y - wallStop) < 0.5, '贴着墙继续推不会穿过去、也不会抖');
  /* 重新落在出击门口，往上走：门心 (300,320) r=46，走进去 = 换屏 */
  Game._internals.enterHall('station', 'playing');
  let wentOut = false;
  for (let i = 0; i < 120; i++) {
    Game.step(Game.cfg.fixedDt, { x: 0, y: -1 });
    if (Game.state === 'playing') { wentOut = true; break; }
  }
  ok(wentOut, '走进出击门真的换屏（回到手里这一局）', Game.state);
  ok(Game.hall() === null, '离开屋就把"走到哪"丢掉（下次按来处重新落点）');
  /* 枢纽门在南墙中间：从大厅走回枢纽也是"走过去"，不是点菜单 */
  Game.setState('station', true);
  Game._internals.enterHall('station', 'hub');
  let wentHub = false;
  for (let i = 0; i < 120; i++) {
    Game.step(Game.cfg.fixedDt, { x: 0, y: 1 });
    if (Game.state === 'hub') { wentHub = true; break; }
  }
  ok(wentHub && !!Game.hall() && Game.hall().room === 'hub',
    '穿过南墙的门洞真的走进枢纽（局内 → 局内，不是回主菜单）', Game.state);
  Game.setState('title', true);

  /* 界面：房间是主体，HUD 只剩底栏那两个按钮（提示也删了，见下一条） */
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const id of ['scr-station', 'station-board', 'hub-news']) {
    ok(html.indexOf('id="' + id + '"') >= 0, 'index.html 里有 #' + id);
  }
  /* ⚠ 站点卡**不许长回来**（2026-10：用户把整块底栏圈红说"完全没必要再显示这个了"）：
      屋里摆着三道门与公告板，屏幕底下不许再复制一份一模一样的按钮列表。
      账归公告板 —— 走到跟前按 E 才摊开（`hallBoard` → `renderBoard`）。
      ⚠ 常驻控制提示也**不许长回来**（用户第二轮："底部只剩一行操作提示 不需要"）：
      "按 E 读账 / 走进那扇门"由 render.ts 写在**那件东西头上**（`drawHallPrompt`），
      屏幕底下不再解释一遍。 */
  ok(html.indexOf('id="station-gates"') < 0 && html.indexOf('id="station-status"') < 0,
    '大厅 HUD 里没有站点条 / 状态带（屋里有的东西不在屏幕底下复制一份）');
  ok(html.indexOf('id="station-hint"') < 0,
    '大厅 HUD 里也没有常驻的控制提示（操作提示归画面里，不归屏幕底下那行字）');
  ok(html.indexOf('data-act="to-station"') >= 0,
    '暂停菜单里有「回大厅」按钮（局内 → 局内那条路）');

  const uiSrc = fs.readFileSync(path.join(ROOT, 'src', 'ui.ts'), 'utf8');
  ok(uiSrc.indexOf('function renderStation') >= 0, 'ui.ts 里有 renderStation（那一屏真的画得出来）');
  ok(/station:\s*function \(\) \{ renderStation\(\); \}/.test(uiSrc),
    '渲染表把 scene.ts 要的重画名（station）接上了');
  ok(uiSrc.indexOf("G.on('hallBoard'") >= 0 && /function renderBoard\(\)/.test(uiSrc),
    '公告板的账走"按 E"那条路（hallBoard 事件 → renderBoard）');
  ok(!/station-gate'/.test(uiSrc) && uiSrc.indexOf('function hallSync') >= 0,
    '大厅没有"点一下就去某个模块"的动作了；账与对话框靠 hallSync 跟着位置收放');
  const startM = /UI\.startRun = function[\s\S]*?\n};/.exec(uiSrc);
  ok(!!startM && /Game\.setState\('station'\)/.test(startM[0]),
    'UI.startRun 把开局落在**大厅**（而不是直接落进战斗）');
}

console.log(failures ? '\n  \x1b[31m' + failures + ' 项失败 ✘\x1b[0m' : '\n  全部通过 ✔');
process.exit(failures ? 1 : 0);
