/* =========================================================
   world.mjs — 世界系统（坐标 · 区域 · 网格）
   用户的要求（2026-10-01）：「没有游戏引擎里的坐标，没有网格……没有一套系统性的
   东西去支持」。

   这一套守五件事：
     1) 坐标契约存在且完整（原点左上 / y 向下 / 单位像素）
     2) 区域表是"这块地多大"的**唯一出处**：战场 / 大厅 / 枢纽三块地，
        软边界语义正确（夹取 / 判定都不越界）
     3) 尺寸**没有被别处抄第二遍** —— 这条只能静态查（源码里还有没有裸数字）
     4) 网格表：三套互不换算，格坐标按"向下取整"
     5) 区域与网格都登记进了扩展点总账（跨表引用查得到）
   用法： node test/world.mjs
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { loadAll, SIM_MODULES } from './_load.mjs';
import { T } from './_assert.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
/* 断言走共享库（`test/_assert.mjs`）：抛了继续跑，失败时两个值都打出来。
   新套件**不带**自己那份 `ok()` —— 那正是迁移预算（`registry-drift` 判据 K）在守的事。 */
const ok = T.ok;
function throws(fn) { try { fn(); return null; } catch (e) { return e.message; } }
const readSrc = f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
/** 去掉注释：判据只查**代码**，注释里写数字是允许的（而且常常是必要的说明） */
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

await loadAll(SIM_MODULES);
const g = globalThis;
const { World, Arena, Hall, Game, SelfCheck } = g;

console.log('\n=== Bronana · 世界系统（坐标 / 区域 / 网格）===\n');

/* ---------------- 1. 坐标契约 ---------------- */
T.section('坐标契约（改造前：全项目在用、却没有一处写下来）');
{
  const c = World.CONTRACT;
  ok(c.origin === '左上' && c.yAxis === '向下' && c.unit === 'px',
    '契约三要素：原点' + c.origin + ' · y 轴' + c.yAxis + ' · 单位 ' + c.unit, JSON.stringify(c));
  ok(typeof c.note === 'string' && c.note.length > 10, '契约带了"它是给谁看的"说明');
  ok(World.audit().ok, '世界系统自检通过', World.audit().problems.join(' | '));
  ok(SelfCheck.names().indexOf('World') >= 0, '自检登记进了启动期清单（不是只在测试里跑一遍）');
  ok(World.zones().length >= 3 && World.grids().length >= 3,
    '区域 ' + World.zones().length + ' 块 · 网格 ' + World.grids().length + ' 套',
    JSON.stringify(World.audit().counts));
}

/* ---------------- 2. 区域表 ---------------- */
T.section('区域表：三块地');
{
  const ids = World.zones().map(z => z.id);
  const need = ['arena', 'station', 'hub'];
  const missing = need.filter(n => ids.indexOf(n) < 0);
  ok(missing.length === 0, '战场 / 大厅 / 枢纽三块地都在（' + ids.join(' · ') + '）', missing.join(','));

  const err = throws(() => World.zone('没有这块地'));
  ok(!!err && /没有这块地/.test(err), '区域 id 写错即抛（不静默返回"尺寸为 0 的世界"）', err);
  ok(World.has('arena') && !World.has('不存在'), 'has 认得区域的存在性');

  const a = World.size('arena');
  ok(a.w === 1680 && a.h === 1260, '战场 1680×1260（战场没有墙，靠软边界关人）', a.w + '×' + a.h);
  ok(World.zone('arena').pad > 0, '战场的软边界 > 0', World.zone('arena').pad);
  ok(World.zone('station').pad === 0 && World.zone('hub').pad === 0,
    '大厅 / 枢纽的软边界是 0（它们四面是真墙 —— 两道边界不该叠在一起）');

  const st = World.size('station'), hub = World.size('hub');
  ok(st.w === hub.w && st.h === hub.h,
    '大厅与枢纽同房型（同一套墙坐标，尺寸必须一致）', st.w + '×' + st.h + ' vs ' + hub.w + '×' + hub.h);

  /* 软边界语义：半径 r 的圆必须整块在 pad 之内 */
  const cl = World.clampTo('arena', -100, 99999, 10);
  const pad = World.zone('arena').pad + 10;
  ok(cl.x === pad && cl.y === a.h - pad, 'clampTo 把人夹回可站范围', JSON.stringify(cl));
  ok(World.inside('arena', a.w / 2, a.h / 2, 10) && !World.inside('arena', 5, a.h / 2, 10),
    'inside 认得"整块圆在场地里"');
  ok(World.clampTo('station', -5, -5, 0).x === 0 && World.clampTo('station', -5, -5, 0).y === 0,
    '没有软边界的屋子从 (0,0) 起算（墙负责挡人）');
}

/* ---------------- 3. 尺寸只有一个出处（静态查） ---------------- */
T.section('尺寸只有一处出处（静态检查：谁还在源码里抄了一遍）');
{
  /* 判据是"**代码**里还有没有那个裸数字"，注释不算。
     这一条是整套测试里最值钱的一条：抄第二遍不会报错，
     只会在"改了世界尺寸"之后让某一处悄悄对不上。 */
  /* 每条 = [文件, "又抄了一遍"的形状, 它应该长什么样, 说的是哪件事]。
     ⚠ 形状必须**精确**：`x: 1120` 是某个 NPC 站的位置（合法内容），
     不是房间尺寸 —— 用 `1120` 一刀切会把内容数据误判成尺寸漂移。 */
  const cases = [
    ['arena.ts', /Arena\.(W|H|PAD)\s*=\s*[0-9]/, /World\.(size|zone)\('arena'\)/, '战场尺寸'],
    ['hall.ts', /\bvar\s+W\s*=\s*[0-9]|\b(w|h):\s*(1500|1120)\b/, /World\.zone\('station'\)/, '大厅 / 枢纽尺寸'],
    ['hall.ts', /CELL\s*=\s*[0-9]/, /World\.grid\('walk'\)/, '行走网格的格边长'],
    ['game.ts', /cell:\s*[0-9]/, /World\.grid\('spatial'\)/, '空间网格的格边长'],
    ['art_spec.ts', /\b(grid|tile|border):\s*[0-9]/, /World\.grid\('tile'\)/, '瓦片网格的格边长']
  ];
  const bad = [];
  for (const [f, drift, want, what] of cases) {
    const src = strip(readSrc(f));
    if (drift.test(src)) bad.push(f + ' 里还有' + what + '的裸数字');
    else if (!want.test(src)) bad.push(f + ' 没有读世界系统（想读什么？' + what + '）');
  }
  ok(bad.length === 0, '五个存量读点都不再自带尺寸 / 格边长（全部读世界系统）', bad.join(' | '));

  /* 反向自证：这些模块读到的确实是同一份数 */
  ok(Arena.W === World.size('arena').w && Arena.H === World.size('arena').h &&
    Arena.PAD === World.zone('arena').pad,
    '战场读到的尺寸与区域表逐项一致', Arena.W + '×' + Arena.H + ' pad ' + Arena.PAD);
  const rooms = Hall.ROOMS;
  const roomBad = rooms.filter(r => {
    const z = World.zone(r.id);
    return r.w !== z.w || r.h !== z.h;
  });
  ok(roomBad.length === 0, '大厅 / 枢纽两间房的尺寸与世界区域表一致',
    roomBad.map(r => r.id).join(','));

  Game.newRun('ranger', 4242);
  const sess = Game.getSession();
  ok(sess.grid.cell === World.grid('spatial'),
    '会话里的空间网格格边长 = 世界网格表（' + sess.grid.cell + '）', sess.grid.cell);
  ok(Hall.gridKey(25, 25) === Math.floor(25 / World.grid('walk')) + ':' + Math.floor(25 / World.grid('walk')),
    '行走网格的格键真的按 12 分格', Hall.gridKey(25, 25));
}

/* ---------------- 4. 网格表 ---------------- */
T.section('网格表：三套互不换算');
{
  const grids = World.grids();
  ok(grids.length === 3, '三套网格：空间查询 / 行走连通 / 美术瓦片',
    grids.map(x => x.id + ' ' + x.cell).join(' · '));
  const spatial = World.grid('spatial'), walk = World.grid('walk'), tile = World.grid('tile');
  ok(spatial === 68 && walk === 12 && tile === 16, '三套格边长与实测一致（68 / 12 / 16）',
    [spatial, walk, tile].join(' / '));
  const err = throws(() => World.grid('没有这套网格'));
  ok(!!err && /没有这套网格/.test(err), '网格 id 写错即抛', err);

  /* 互不换算：三者的比不是整数倍 —— 这正是"不许混用"的数值依据 */
  ok(spatial / walk !== Math.floor(spatial / walk) && tile / walk !== Math.floor(tile / walk) &&
    spatial / tile !== Math.floor(spatial / tile),
    '"三套互不换算"不是口号：68/12、16/12、68/16 都不是整数倍');

  const c = World.cell('tile', 17, -1);
  ok(c.cx === 1 && c.cy === -1, '世界坐标 → 格坐标是向下取整（负坐标落在负格，不夹取）',
    JSON.stringify(c));
  ok(World.cell('spatial', 0, 0).cx === 0 && World.cell('spatial', 67, 67).cx === 0 &&
    World.cell('spatial', 68, 0).cx === 1, '格边界归属明确（0~67 在第 0 格）');

  /* 网格边长必须落在审计区间内（太小 = 建表爆炸；太大 = 查询退化） */
  const outOfRange = grids.filter(x => !(x.cell >= 8 && x.cell <= 128));
  ok(outOfRange.length === 0, '每套网格的格边长都在审计区间 8~128 内',
    outOfRange.map(x => x.id + ' ' + x.cell).join(','));
}

/* ---------------- 5. 登记的家族 ---------------- */
T.section('扩展点总账');
{
  const { Registry } = g;
  ok(Registry.has('worldZone') && Registry.has('worldGrid'),
    '区域与网格都登记成了家族（跨表引用能查它们）');
  const a = Registry.audit();
  const mine = ['worldZone', 'worldGrid'].filter(n => a.missing.indexOf(n) >= 0);
  ok(mine.length === 0, '两个家族都被注册进总账（没有断链）', mine.join(','));
  ok(a.counts.worldZone === World.zones().length && a.counts.worldGrid === World.grids().length,
    '总账里的条数与世界系统自己的表一致',
    a.counts.worldZone + ' / ' + a.counts.worldGrid);
}

console.log('\n=== 结果 ===');
process.exit(T.done());
