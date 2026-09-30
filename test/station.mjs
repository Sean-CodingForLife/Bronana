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

console.log(failures ? '\n  \x1b[31m' + failures + ' 项失败 ✘\x1b[0m' : '\n  全部通过 ✔');
process.exit(failures ? 1 : 0);
