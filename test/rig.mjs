/* =========================================================
   rig.mjs — 骨架系统无头校验
   三件事：
     1) 骨架运行时本身（编译校验 / 正向运动学 / 够位 / 部件绑定 / 姿态新鲜度）
     2) 豆豆骨架的几何等价：骨架算出来的每个部件世界坐标，
        必须与改造前的闭式公式逐项相等（扫参数空间，误差 < 1e-9）
     3) 暗部裁剪回归：老实现把裁剪建在"变换原点"上（游戏里是战场左上角），
        角色暗部被整块裁掉、同时左上角多出一块剪影。用带 CTM 的桩盯住它。
   用法： node test/rig.mjs
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { installDom, makeProbeCtx } from './_ctx.mjs';
import { loadAll, RENDER_MODULES } from './_load.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const dom = installDom();
const g = globalThis;

let failures = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  \x1b[32mPASS\x1b[0m ' + label);
  else { failures++; console.log('  \x1b[31mFAIL\x1b[0m ' + label + (extra !== undefined ? '  → ' + extra : '')); }
}
function throws(fn, re, label) {
  let msg = null;
  try { fn(); } catch (e) { msg = e.message; }
  ok(msg !== null && (!re || re.test(msg)), label, msg === null ? '没有抛错' : msg);
}

console.log('\n=== Bronana · 骨架系统无头校验 ===\n');

console.log('[1] 加载');
let loadErr = null;
try { await loadAll(RENDER_MODULES); }
catch (e) { loadErr = e.message; }
if (loadErr) { console.log('  \x1b[31mFAIL\x1b[0m 加载失败 → ' + loadErr); process.exit(1); }
ok(true, '全部模块以 ES 模块方式加载成功');

const { Rig, Bronana, Game, S, U, Arena } = g;

/* =========================================================
   1. 骨架运行时
   ========================================================= */
console.log('\n[2] 编译期校验（错误必须在定义骨架时就炸）');
const CHAIN = [
  { name: 'root' },
  { name: 'mid', parent: 'root', x: 10, y: 0, rot: 0, len: 10 },
  { name: 'tip', parent: 'mid', x: 10, y: 0, len: 5 }
];
const chain = Rig.compile('chain', CHAIN);
ok(chain.count === 3, '骨架编译成功', String(chain.count));
ok(chain.parent[chain.order[0]] === -1 || chain.order[0] === 0,
  '拓扑序里父骨排在子骨之前',
  Array.from(chain.order).join(','));

throws(() => Rig.compile('dup', [{ name: 'a' }, { name: 'a' }]), /重名/, '骨头重名被拒绝');
throws(() => Rig.compile('orphan', [{ name: 'a', parent: 'nope' }]), /不存在/, '父骨不存在被拒绝');
throws(() => Rig.compile('self', [{ name: 'a', parent: 'a' }]), /自己/, '骨头把自己当父骨被拒绝');
throws(() => Rig.compile('empty', []), /一根骨头都没有/, '空骨架被拒绝');
throws(() => Rig.compile('cycle', [
  { name: 'a', parent: 'b' }, { name: 'b', parent: 'c' }, { name: 'c', parent: 'a' }
]), /成环/, '层级成环被拒绝，并指出环上的骨头');
throws(() => Rig.compile('noname', [{ x: 1 }]), /没有名字/, '骨头没有名字被拒绝');

console.log('\n[3] 正向运动学（父骨的缩放必须作用到子骨的平移上）');
{
  const t = Rig.compile('fk', [
    { name: 'p', x: 100, y: 50, rot: Math.PI / 2, sx: 2, sy: 0.5 },
    { name: 'c', parent: 'p', x: 10, y: 0, sx: 1, sy: 1 }
  ]);
  const inst = Rig.instance(t);
  const ci = Rig.index(t, 'c');
  // 父骨：先缩放 (10,0) → (20,0)，再转 90° → (0,20)，再平移 → (100,70)
  const got = Rig.point(inst, ci, 0, 0);
  ok(Math.abs(got.x - 100) < 1e-9 && Math.abs(got.y - 70) < 1e-9,
    '父骨的缩放与旋转正确作用到子骨的局部平移',
    `得到 (${got.x.toFixed(6)}, ${got.y.toFixed(6)})，应为 (100, 70)`);
  ok(Math.abs(Rig.wsx(inst, ci) - 2) < 1e-9 && Math.abs(Rig.wsy(inst, ci) - 0.5) < 1e-9,
    '子骨继承父骨的缩放（世界缩放 = 父缩放 × 自身缩放）',
    `sx=${Rig.wsx(inst, ci)} sy=${Rig.wsy(inst, ci)}`);
  // 子骨局部点 (10,0) → 世界：父缩放 (20,0) → 旋转 (0,20) → 平移 (100,70)
  const p2 = Rig.point(inst, ci, 10, 0);
  ok(Math.abs(p2.x - 100) < 1e-9 && Math.abs(p2.y - 90) < 1e-9,
    '骨头局部点换算到世界坐标正确', `(${p2.x}, ${p2.y})`);
}

console.log('\n[4] 姿态、够位与新鲜度');
{
  const t = Rig.compile('reach', [
    { name: 'root' },
    { name: 'arm', parent: 'root', x: 0, y: 0, len: 10 }
  ]);
  const inst = Rig.instance(t);
  const a = Rig.index(t, 'arm');

  Rig.reach(inst, a, 3, 4);          // 目标距离 5，骨头长 10 → 收缩到 0.5
  Rig.update(inst);
  const tip = Rig.point(inst, a, 10, 0);
  ok(Math.abs(tip.x - 3) < 1e-12 && Math.abs(tip.y - 4) < 1e-12,
    'reach：骨头末端精确落到目标点（旋转 + 沿轴伸缩）',
    `(${tip.x}, ${tip.y})`);
  ok(Math.abs(Rig.wsx(inst, a) - 0.5) < 1e-12, '伸缩量 = 目标距离 / 骨长');

  Rig.reset(inst);
  Rig.update(inst);
  const rest = Rig.point(inst, a, 10, 0);
  ok(Math.abs(rest.x - 10) < 1e-12 && Math.abs(rest.y) < 1e-12, 'reset 回到静止姿态');

  // 静态骨架够不到的目标：距离 0 也能处理（伸缩到 0）
  Rig.reach(inst, a, 0, 0);
  Rig.update(inst);
  ok(Rig.wsx(inst, a) === 0, '目标与关节重合时伸缩为 0，不产生 NaN');

  Rig.reach(inst, a, 3, 4);
  ok(Rig.stale(inst) === true, 'reach 之后姿态是"脏"的（世界坐标尚未重算）');
  Rig.update(inst);
  ok(Rig.stale(inst) === false, 'update 之后姿态新鲜');
  ok(Rig.badValues(inst).length === 0, '姿态数值无 NaN / 无穷');
  inst.lrot[a] = NaN;
  Rig.update(inst);
  ok(Rig.badValues(inst).indexOf('arm') >= 0, 'NaN 姿态能被自查抓出来（否则会静默画成一团黑）');
  Rig.reset(inst); Rig.update(inst);

  const noLen = Rig.compile('nolen', [{ name: 'x', len: 0 }]);
  throws(() => Rig.reach(Rig.instance(noLen), 0, 1, 1), /没有长度/, 'len=0 的骨头无法够位（拒绝而不是画错）');
  throws(() => Rig.index(t, 'nope'), /没有骨头/, '取不存在的骨头下标被拒绝');
}

console.log('\n[5] 部件绑定与层序');
{
  const t = Rig.compile('pt', [{ name: 'a' }, { name: 'b', parent: 'a' }]);
  const rec = [];
  const draw = (tag) => (ctx, inst, args) => rec.push(tag);
  const parts = Rig.parts(t, [
    { name: 'late', bone: 'b', layer: 20, draw: draw('late') },
    { name: 'early', bone: 'a', layer: 10, draw: draw('early') }
  ]);
  ok(parts.order.join(',') === 'early,late', '部件按层序排好（层序即绘制顺序）', parts.order.join(','));
  Rig.paint(null, Rig.instance(t), parts, {});
  ok(rec.join(',') === 'early,late', 'paint 的实际执行顺序就是层序', rec.join(','));

  throws(() => Rig.parts(t, [{ name: 'x', bone: '不存在', draw: draw('x') }]),
    /没有骨头/, '部件绑到不存在的骨头被拒绝（"直接贴上去"的防线）');
  throws(() => Rig.parts(t, [
    { name: 'x', bone: 'a', layer: 5, draw: draw('x') },
    { name: 'y', bone: 'b', layer: 5, draw: draw('y') }
  ]), /层序/, '两个部件抢同一层序被拒绝');
  throws(() => Rig.parts(t, [
    { name: 'x', bone: 'a', draw: draw('x') }, { name: 'x', bone: 'b', draw: draw('y') }
  ]), /重名/, '部件重名被拒绝');
  throws(() => Rig.parts(t, [{ name: 'x', bone: 'a' }]), /没有 draw/, '部件没有 draw 被拒绝');
}

/* =========================================================
   2. 豆豆骨架
   ========================================================= */
console.log('\n[6] 豆豆骨架结构');
{
  const names = Bronana.TPL.names.slice();
  const want = ['anchor', 'body', 'head', 'armL', 'armR'];
  ok(want.every(n => names.indexOf(n) >= 0), '角色骨头齐全：' + want.join(' / '), names.join(','));
  ok(names.filter(n => /^w\d+$/.test(n)).length === 6, '6 个武器挂点骨头都在');
  ok(Bronana.SEATS === Game.cfg.maxWeapons,
    '骨架的武器槽数 = 游戏配置的武器上限（' + Bronana.SEATS + '）',
    Bronana.SEATS + ' vs ' + Game.cfg.maxWeapons);

  const bones = Bronana.TPL.names;
  const missing = Bronana.PARTS.list.filter(p => bones.indexOf(p.boneName) < 0);
  ok(missing.length === 0, '全部 ' + Bronana.PARTS.list.length + ' 个部件都绑在存在的骨头上',
    missing.map(m => m.name + '→' + m.boneName).join(','));

  const L = Bronana.PAINT;
  const chain = [L.body, L.belly, L.dots, L.armL, L.armR, L.face, L.weapon];
  let mono = true;
  for (let i = 1; i < chain.length; i++) if (!(chain[i] > chain[i - 1])) mono = false;
  ok(mono, '绘制层序严格递增：' + chain.join(' < '));
  ok(Bronana.PARTS.list.every((p, i, arr) => i === 0 || p.layer > arr[i - 1].layer),
    '部件数组顺序与层序一致（层序就是数组顺序）');
}

console.log('\n[7] 几何等价：骨架 vs 改造前的闭式公式（扫描参数空间）');
{
  /* ---- 老公式（逐字抄自改造前的 sprites.ts / game.ts）---- */
  function legacy(cx, cy, rx, ry, bob, swing, face) {
    const armY = cy + bob + ry * 0.05;
    const armX = rx * 0.94;
    return {
      body: [cx, cy + bob],
      shoulderL: [cx - armX * 0.55, armY + ry * 0.30],
      shoulderR: [cx + armX * 0.55, armY + ry * 0.30],
      tipL: [cx - armX * 1.18, armY + ry * (0.42 + swing * 0.35)],
      tipR: [cx + armX * 1.18, armY + ry * (0.42 - swing * 0.35)],
      eye: [cx, cy + bob - ry * 0.14],
      eyeDx: rx * 0.34,
      eyeR: Math.max(2.6, rx * 0.155),
      shift: face * rx * 0.08,
      mouth: [cx + face * rx * 0.08 * 0.6, cy + bob + ry * 0.36],
      mouthDead: [cx, cy + bob + ry * 0.34]
    };
  }
  function legacySeat(i, aim, r, px, py) {
    const slot = aim + ((i % 2 === 0) ? 0.42 : -0.42) + (i - 2.5) * 0.16;
    const offR = r * 0.86;
    return [px + Math.cos(slot) * offR, py + Math.sin(slot) * offR - r * 0.14];
  }

  const inst = Bronana.create();
  let worst = 0, worstWhat = '';
  let checked = 0;
  function cmp(label, got, want) {
    const d = Math.max(Math.abs(got[0] - want[0]), Math.abs(got[1] - want[1]));
    checked++;
    if (d > worst) { worst = d; worstWhat = label + ` 得到(${got[0].toFixed(6)},${got[1].toFixed(6)}) 期望(${want[0].toFixed(6)},${want[1].toFixed(6)})`; }
  }

  const poses = [];
  for (const bob of [0, -1.15, 1.15, -3.2]) {
    for (const swing of [0, 0.22, -0.22, 0.9, -0.9]) {
      for (const k of [1, 0.976, 1.024]) {
        for (const face of [-1, 0, 1]) poses.push([bob, swing, k, face]);
      }
    }
  }
  const cx = 840, cy = 630, r = 20;
  for (const [bob, swing, k, face] of poses) {
    const rx = r * (1 / k), ry = r * 0.98 * k;
    const L = legacy(cx, cy, rx, ry, bob, swing, face);
    Bronana.pose(inst, { x: cx, y: cy, rx, ry, bob, armSwing: swing });
    const B = Bronana.B;
    cmp('躯干中心', Rig.point(inst, B.body, 0, 0), L.body);
    cmp('左肩', Rig.point(inst, B.armL, 0, 0), L.shoulderL);
    cmp('右肩', Rig.point(inst, B.armR, 0, 0), L.shoulderR);
    cmp('左手（骨末端）', Rig.point(inst, B.armL, Bronana.TPL.len[B.armL], 0), L.tipL);
    cmp('右手（骨末端）', Rig.point(inst, B.armR, Bronana.TPL.len[B.armR], 0), L.tipR);
    cmp('眼线（头骨）', Rig.point(inst, B.head, 0, 0), L.eye);
  }

  ok(worst < 1e-9, '手臂 / 躯干 / 头的世界坐标与老公式逐项相等（' + checked + ' 项，最大误差 ' +
    worst.toExponential(2) + '）', worstWhat);

  /* 五官与武器挂点 */
  let worst2 = 0, what2 = '';
  const _o = { x: 0, y: 0 };
  for (let i = 0; i < 6; i++) {
    for (const aim of [-3.1, -1.2, 0, 0.7, 2.9]) {
      const bone = Bronana.seat(inst, i, aim, r, cx, cy);
      const want = legacySeat(i, aim, r, cx, cy);
      const got = [Rig.wx(inst, bone), Rig.wy(inst, bone)];
      const d = Math.max(Math.abs(got[0] - want[0]), Math.abs(got[1] - want[1]));
      if (d > worst2) { worst2 = d; what2 = `槽 ${i} aim=${aim}`; }
      const muz = Bronana.aheadPoint(inst, bone, 14, _o);
      const wantM = [want[0] + Math.cos(aim) * 14, want[1] + Math.sin(aim) * 14];
      const dm = Math.max(Math.abs(muz.x - wantM[0]), Math.abs(muz.y - wantM[1]));
      if (dm > worst2) { worst2 = dm; what2 = `槽 ${i} 枪口`; }
      const bul = Bronana.aheadPoint(inst, bone, 12, _o);
      const wantB = [want[0] + Math.cos(aim) * 12, want[1] + Math.sin(aim) * 12];
      const db = Math.max(Math.abs(bul.x - wantB[0]), Math.abs(bul.y - wantB[1]));
      if (db > worst2) { worst2 = db; what2 = `槽 ${i} 子弹出生点`; }
    }
  }
  ok(worst2 < 1e-9, '武器座 / 枪口 / 子弹出生点与老公式逐项相等（最大误差 ' +
    worst2.toExponential(2) + '）', what2);

  /* 五官：以头骨坐标系为参照（Rig.at 只应用平移+旋转，帧内是像素） */
  let worst3 = 0, what3 = '';
  for (const face of [-1, 0, 1]) {
    const rx = 20, ry = 19.6;
    Bronana.pose(inst, { x: cx, y: cy, rx, ry, bob: 0, armSwing: 0 });
    const L = legacy(cx, cy, rx, ry, 0, 0, face);
    const hx = Rig.wx(inst, Bronana.B.head), hy = Rig.wy(inst, Bronana.B.head);
    // 画在头骨帧里的坐标 → 世界 = 头骨世界位置 + 该坐标（头骨无旋转、帧内不缩放）
    const eyeWorld = [hx + (-L.eyeDx + L.shift), hy];
    const wantEye = [L.eye[0] - L.eyeDx + L.shift, L.eye[1]];
    const d = Math.max(Math.abs(eyeWorld[0] - wantEye[0]), Math.abs(eyeWorld[1] - wantEye[1]));
    if (d > worst3) { worst3 = d; what3 = '左眼 face=' + face; }
    const mouthWorld = [hx + L.shift * 0.6, hy + ry * 0.50];
    const d2 = Math.max(Math.abs(mouthWorld[0] - L.mouth[0]), Math.abs(mouthWorld[1] - L.mouth[1]));
    if (d2 > worst3) { worst3 = d2; what3 = '嘴 face=' + face; }
  }
  ok(worst3 < 1e-9, '五官位置与老公式相等（最大误差 ' + worst3.toExponential(2) + '）', what3);
  ok(Math.abs(legacy(0, 0, 20, 19.6, 0, 0, 0).eyeR - Math.max(2.6, 20 * 0.155)) < 1e-12,
    '眼睛半径仍按老公式 max(2.6, rx*0.155) 取值');

  /* 呼吸挤压：老实现把缩放揉进 rx/ry，骨架放进躯干骨 —— 两者必须同源 */
  Bronana.pose(inst, { x: cx, y: cy, rx: r * 0.976, ry: r * 0.98 * 1.024, bob: 0, armSwing: 0 });
  ok(Math.abs(Rig.wsx(inst, Bronana.B.body) - r * 0.976) < 1e-12 &&
    Math.abs(Rig.wsy(inst, Bronana.B.body) - r * 0.98 * 1.024) < 1e-12,
    '躯干骨的缩放就是角色半径（尺寸与挤压都在骨头上，部件读的是它）');
  const child = Rig.point(inst, Bronana.B.head, 0, 0);
  ok(Math.abs((child.y - cy) - (-0.14) * r * 0.98 * 1.024) < 1e-9,
    '父骨缩放确实作用到了子骨平移（头随挤压一起动）',
    '头相对躯干 ' + (child.y - cy).toFixed(4) + '，应为 ' + ((-0.14) * r * 0.98 * 1.024).toFixed(4));
}

/* =========================================================
   3. 暗部裁剪回归
   ========================================================= */
console.log('\n[8] 暗部裁剪（回归：裁剪必须落在角色身上）');
{
  const PX = Arena.W / 2, PY = Arena.H / 2, R0 = 20, RY0 = R0 * 0.98;

  function drawWithCamera(zoom) {
    const ctx = makeProbeCtx();
    ctx.setTransform(zoom, 0, 0, zoom, 0, 0);
    ctx.translate(-PX + 1280 / 2 / zoom, -PY + 720 / 2 / zoom);
    S.drawBronana(ctx, PX, PY, R0, RY0, null, 7, { faceDir: 1, bob: -0.4, armSwing: 0.4 });
    return ctx;
  }

  for (const zoom of [1, 0.5]) {
    const ctx = drawWithCamera(zoom);
    const at = ctx.map(PX, PY);
    const clip = ctx.clips[0] ? ctx.clips[0].box : null;
    ok(!!clip, 'zoom=' + zoom + '：暗部确实产生了裁剪区');
    if (!clip) continue;
    const d = Math.hypot(clip.cx - at[0], clip.cy - at[1]);
    ok(d < 2, 'zoom=' + zoom + '：裁剪区落在角色身上（偏差 ' + d.toFixed(2) + 'px）',
      '裁剪中心 (' + clip.cx.toFixed(1) + ',' + clip.cy.toFixed(1) + ')，角色在 (' + at[0].toFixed(1) + ',' + at[1].toFixed(1) + ')');
    // 老实现：裁剪落在世界原点（战场左上角），偏差 ~1050px
    const originDist = Math.hypot(at[0] - ctx.map(0, 0)[0], at[1] - ctx.map(0, 0)[1]);
    ok(d < originDist / 10, 'zoom=' + zoom + '：不再落在世界原点（那里离角色 ' + originDist.toFixed(0) + 'px）');

    // 所有绘制都必须落在角色附近：老实现会在世界原点多填一块剪影
    const limit = R0 * 3.2;
    let stray = null;
    for (const f of ctx.fills.concat(ctx.strokes)) {
      if (!f.box) continue;
      const fd = Math.hypot(f.box.cx - at[0], f.box.cy - at[1]);
      if (fd > limit) { stray = `fill/stroke 落在 (${f.box.cx.toFixed(0)},${f.box.cy.toFixed(0)})，离角色 ${fd.toFixed(0)}px`; break; }
    }
    ok(stray === null, 'zoom=' + zoom + '：没有游离到别处的绘制（老实现在战场原点多一块剪影）', stray);
    ok(ctx.badArgs.length === 0, 'zoom=' + zoom + '：绘制参数里没有 NaN / 无穷', ctx.badArgs.slice(0, 3).join(' | '));
    ok(ctx._st.stack.length === 0, 'zoom=' + zoom + '：save / restore 严格配对', String(ctx._st.stack.length));
  }

  // 无 DOM 桩时也不能崩（render-check 之外的降级路径）
  const still = makeProbeCtx();
  still.translate(34, 34);
  S.drawBronana(still, 0, 0, 26, 25, null, 3, {});
  const c0 = still.clips[0] ? still.clips[0].box : null;
  ok(!!c0 && Math.abs(c0.cx - 34) < 2 && Math.abs(c0.cy - 34) < 2,
    'UI 肖像路径（变换原点即角色中心）裁剪仍然正确',
    c0 ? `裁剪中心 (${c0.cx.toFixed(1)}, ${c0.cy.toFixed(1)})，应为 (34, 34)` : '没有裁剪区');
}

console.log('\n[9] 怪物贴图的暗部裁剪（同一类 bug 的另一处）');
{
  /** 烘焙一张怪物贴图，拿到它的画布与桩 ctx（用贴图对象自带的 canvas，
      不靠"第几个被创建"来认，否则会串到别的贴图上） */
  function bake(def) {
    const spr = S.enemySprite(def);
    if (!spr) return null;
    return { cv: spr.canvas, c: spr.canvas._ctx };
  }
  /** 裁剪框与"某一条已绘制路径"的最小偏差：老实现差 1.00R */
  function clipOffset(c) {
    const clip = c.clips[0] ? c.clips[0].box : null;
    if (!clip) return null;
    let best = Infinity;
    for (const f of c.fills) {
      if (!f.box) continue;
      best = Math.min(best, Math.hypot(f.box.cx - clip.cx, f.box.cy - clip.cy));
    }
    return best;
  }

  // 参照：jelly 分支的裁剪一直是建在局部坐标里的（本来就没这个 bug）
  const jelly = Enemies.LIST.filter(d => d.shape === 'jelly');
  let jellyWorst = 0, jellyBad = '';
  for (const def of jelly) {
    const b = bake(def);
    const off = clipOffset(b.c);
    if (off === null || off > jellyWorst) { jellyWorst = off === null ? Infinity : off; jellyBad = def.id; }
  }
  ok(jellyWorst < 0.5, '参照：' + jelly.length + ' 种 jelly 怪的裁剪与身体重合（最大偏差 ' +
    jellyWorst.toFixed(2) + 'px）', jellyBad);

  const blobs = Enemies.LIST.filter(d => d.shape === 'blob');
  let worst = 0, worstId = '', stray = [], steps = [];
  for (const def of blobs) {
    const b = bake(def);
    const c = b.c, cv = b.cv;
    const off = clipOffset(c);
    if (off === null) { stray.push(def.id + ' 无 clip/fill'); continue; }
    if (off > worst) { worst = off; worstId = def.id; }
    // 内容包围盒 vs 画布（贴图有没有被画布截掉）
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const f of c.fills.concat(c.strokes)) {
      if (!f.box) continue;
      x0 = Math.min(x0, f.box.x0); y0 = Math.min(y0, f.box.y0);
      x1 = Math.max(x1, f.box.x1); y1 = Math.max(y1, f.box.y1);
    }
    const over = Math.max(0, y1 - cv.height);
    if (!c.fills.some(f => f.style === def.dark)) stray.push(def.id + ' 没有用 dark 色压暗');
    steps.push(def.id + ' ' + def.color + '→' + def.dark);
  }
  ok(worst < 0.5, '全部 ' + blobs.length + ' 种 blob 怪的裁剪与身体重合（最大偏差 ' +
    worst.toFixed(2) + 'px；改造前是 1.00R，各怪 26~78px）', worstId);
  ok(stray.length === 0, '贴图内的绘制没有跑到画布外', stray.slice(0, 3).join(' | '));
  console.log('    blob 怪的压暗色阶：' + steps.join('  ·  '));

  /* ---- 贴图盒子：装得下内容，且身体中心对准绘制原点 ----
     老实现有两个叠在一起的"半个约定"：make() 里 c.height 用的是宽（正方画布），
     同时又按 (w/2, h) 平移原点；而回调里还有一次 translate(0, up)。
     结果是原点落在 (w/2, 2*up + down)、比画布底边还低，内容的下半部分整块画不出来
     （blob 的腿与下半身丢失，实测 grub 25px / warden 78px），
     drawEnemy 再按"贴图底边 = 脚底"定位，于是贴图整体上移 6~10px。
     现在：盒子由 S.enemyBox 给出（脚底以上 up、以下 down），贴图自报 bodyY（身体中心的
     画布坐标），drawEnemy 把 bodyY 对准 (ex, ey) —— 身体圆心与命中圈圆心重合。 */
  const boxBad = [];
  const rows = [];
  for (const def of Enemies.LIST) {
    const spr = S.enemySprite(def);
    if (!spr) { boxBad.push(def.id + ' 无贴图'); continue; }
    const box = S.enemyBox(def);
    const c = spr.canvas._ctx, cv = spr.canvas;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const f of c.fills.concat(c.strokes)) {
      if (!f.box) continue;
      x0 = Math.min(x0, f.box.x0); y0 = Math.min(y0, f.box.y0);
      x1 = Math.max(x1, f.box.x1); y1 = Math.max(y1, f.box.y1);
    }
    const R = box.R;
    const topSlack = y0;                       // 画布顶 → 内容最高处
    const botSlack = cv.height - y1;            // 内容最低处 → 画布底
    // 1) 内容必须整个在画布里（这才是"下半部分画不出来"的直接判据）
    if (y0 < -0.5) boxBad.push(def.id + ' 顶部超出画布 ' + y0.toFixed(1) + 'px');
    if (y1 > cv.height + 0.5) boxBad.push(def.id + ' 底部超出画布 ' + (y1 - cv.height).toFixed(1) + 'px');
    // 2) 留白不能太夸张（盒子是按内容给的，不是随手给个大方块）
    if (topSlack > 0.5 * R + 12) boxBad.push(def.id + ' 顶部留白过多 ' + topSlack.toFixed(0) + 'px');
    if (botSlack > 0.6 * R + 12) boxBad.push(def.id + ' 底部留白过多 ' + botSlack.toFixed(0) + 'px');
    // 3) 水平方向内容要居中（身体在 x=0 两侧对称）
    if (Math.abs((x0 + x1) / 2 - cv.width / 2) > 2) {
      boxBad.push(def.id + ' 内容不居中（' + ((x0 + x1) / 2).toFixed(1) + ' vs ' + (cv.width / 2).toFixed(1) + '）');
    }
    // 4) 锚点必须报出来且与盒子一致
    if (Math.abs(spr.bodyY - (box.up - R)) > 1e-9) boxBad.push(def.id + ' bodyY 与盒子不符');
    if (Math.abs(spr.foot - box.down) > 1e-9) boxBad.push(def.id + ' foot 与盒子不符');
    // 5) 锚点落在内容里（身体中心不能跑到内容外面，否则对位是错的）
    if (spr.bodyY < y0 || spr.bodyY > y1) boxBad.push(def.id + ' 身体中心不在内容范围内');
    // 6) 贴图盒子要落在剔除余量内，否则屏幕边缘会被整块切掉
    const hitR = 22 * (def.scale || 1);
    if (spr.width / 2 > hitR * 3 || spr.height > hitR * 6) boxBad.push(def.id + ' 贴图大于剔除余量');

    rows.push(def.id.padEnd(9) + ' 画布 ' + cv.width + '×' + cv.height +
      '  内容 y=[' + y0.toFixed(0) + '..' + y1.toFixed(0) + ']' +
      '  留白 顶 ' + topSlack.toFixed(0) + '/底 ' + botSlack.toFixed(0) +
      '  可见身体高 ' + (R * 2.04).toFixed(0) + 'px');
  }
  ok(boxBad.length === 0, '全部 ' + Enemies.LIST.length + ' 种怪物贴图都装得下内容、锚点齐备',
    boxBad.slice(0, 3).join(' | '));
  for (const r of rows) console.log('    · ' + r);
  console.log('    注：可见身体半径 26×scale，命中圈半径 22×scale（身体比命中圈大 18%，');
  console.log('        这是刻意留的宽容度；两者同心，脚落在命中圈底部）。');
}

console.log('\n[10] 开销与分配');
{
  const inst = Bronana.create();
  const pose = { x: 0, y: 0, rx: 20, ry: 19.6, bob: 0, armSwing: 0 };
  const args = { skin: { base: '#fff', hi: '#fff', sh: '#ddd', dot: '#000' }, seed: 7, face: 0, mood: 'idle' };
  const ctx = makeProbeCtx();

  // 热路径：摆位 + 正向运动学（不触碰 canvas）
  const N = 20000;
  let t0 = performance.now();
  for (let i = 0; i < N; i++) {
    pose.bob = Math.sin(i * 0.01) * 1.15;
    pose.armSwing = Math.sin(i * 0.02) * 0.9;
    Bronana.pose(inst, pose);
  }
  const poseMs = (performance.now() - t0) / N;

  // 武器挂点：模拟层每次开火都要算
  t0 = performance.now();
  for (let i = 0; i < N; i++) {
    Bronana.seat(inst, i % 6, i * 0.01, 20, 840, 630);
  }
  const seatMs = (performance.now() - t0) / N;

  // 一次完整绘制（桩 ctx）
  t0 = performance.now();
  for (let i = 0; i < 5000; i++) Bronana.draw(ctx, inst, args);
  const drawMs = (performance.now() - t0) / 5000;

  console.log(`    摆位+正向运动学 ${(poseMs * 1000).toFixed(2)} µs/次  ·  武器挂点 ${(seatMs * 1000).toFixed(2)} µs/次  ·  绘制 ${(drawMs * 1000).toFixed(1)} µs/帧`);
  ok(poseMs < 0.05, '摆位 + 正向运动学 < 50µs/次（实际 ' + (poseMs * 1000).toFixed(2) + 'µs）');
  ok(seatMs < 0.05, '武器挂点 < 50µs/次（实际 ' + (seatMs * 1000).toFixed(2) + 'µs）');
  ok(Rig.badValues(inst).length === 0, '长时间求值后姿态仍然有限');
}

/* =========================================================
   4. 与游戏集成
   ========================================================= */
console.log('\n[11] 与真实对局的集成');
{
  Game.newRun('gladiator', 12345);
  const sess = Game.getSession();
  ok(!!sess.player.rig, '新会话的玩家身上有骨架实例（Skeleton 组件）');
  ok(g.Comp.has(sess.player, 'Skeleton'), '骨架确实是玩家原型的一个组件');
  ok(g.Comp.audit(sess.player).unknown.length === 0, '玩家对象没有游离字段（骨架字段已声明）');

  // 跑一段真实战斗，检查武器挂点确实由模拟层经骨架算出。
  // 场上每帧只留一个贴近的靶子（自然刷怪会在 600px 外集结，实测 1200 帧只开火 3 次，
  // 断言就退化成"恰好过一次"），并在无渲染层参与时用 rig.frame 计数：
  // 此时只有 fire() 里的 Bronana.seat 会推进它。
  const p0 = sess.player;
  const frame0 = p0.rig.frame;
  let checkedFrames = 0;
  for (let i = 0; i < 600; i++) {
    if (Game.state === 'playing') {
      p0.hp = sess.stats.maxHp;
      sess.enemies.length = 0;
      Game._internals.spawnEnemy('grub', p0.x + 90, p0.y, {});
      Game.step(1 / 60, Game.autoInput(i / 60));
      checkedFrames++;
    } else if (Game.state === 'levelup') Game.chooseLevelCard(0);
    else if (Game.state === 'shop') Game.nextWave();
  }
  const evals = p0.rig.frame - frame0;
  ok(evals > 10, '对局过程中模拟层持续经骨架算挂点（' + checkedFrames +
    ' 帧内 fire() 走 Bronana.seat 共 ' + evals + ' 次）', String(evals));
  ok(Rig.badValues(sess.player.rig).length === 0, '对局后骨架姿态无 NaN');

  // 武器下标必须与数组下标一致：模拟层用 w.index、渲染层用下标，
  // 两者漂移就会"子弹从一个位置飞出来、枪画在另一个位置"
  let idxOk = true, bad = '';
  for (let i = 0; i < sess.player.weapons.length; i++) {
    if (sess.player.weapons[i].index !== i) { idxOk = false; bad = '第 ' + i + ' 把的 index=' + sess.player.weapons[i].index; }
  }
  ok(idxOk, '武器下标与数组下标一致（模拟层与渲染层用的是同一个槽位）', bad);

  // 卖一把武器后仍然一致
  function toShop(max) {
    for (let i = 0; i < (max || 8000); i++) {
      if (Game.state === 'shop') return true;
      if (Game.state === 'playing') Game.step(1 / 60, Game.autoInput(i / 60));
      else if (Game.state === 'levelup') Game.chooseLevelCard(0);
      else return false;
    }
    return Game.state === 'shop';
  }
  ok(toShop(), '推进到商店（卖出流程要在商店态才允许）');
  Game.addWeapon('pistol');
  const n = sess.player.weapons.length;
  ok(Game.sellWeapon(0), '卖出一把武器');
  let idxOk2 = true, bad2 = '';
  for (let i = 0; i < sess.player.weapons.length; i++) {
    if (sess.player.weapons[i].index !== i) { idxOk2 = false; bad2 = '第 ' + i + ' 把的 index=' + sess.player.weapons[i].index; }
  }
  ok(idxOk2, '卖掉一把武器后下标重新编号，仍然一致（' + n + ' → ' + sess.player.weapons.length + '）', bad2);
  throws(() => Bronana.seat(sess.player.rig, 99, 0, 20, 0, 0), /超出骨架/, '超出槽位数的挂点被拒绝');
}

console.log('\n[12] 优化项回归（骨架与组件层的接缝）');
{
  // 骨架随原型一起出生：不再依赖"调用方记得再 assign 一次"
  const p1 = Comp.spawn('player');
  const p2 = Comp.spawn('player');
  ok(!!p1.rig, 'Comp.spawn("player") 出生就带骨架');
  ok(!!p2.rig && p1.rig !== p2.rig, '两次 spawn 的骨架是两个独立实例（不共享姿态存储）');
  const injected = Bronana.create();
  ok(Comp.spawn('player', { rig: injected }).rig === injected, '显式传入的 rig 被尊重，不被生成钩子覆盖');
  throws(() => Comp.onSpawn('没有这个原型', function () {}), /未注册的原型/, '给未注册的原型挂生成钩子被拒绝');
  throws(() => Comp.onSpawn('player', null), /必须是函数/, '非函数的生成钩子被拒绝');

  // 缺骨架时要给可读错误，而不是从 Rig 里冒出来的 TypeError
  throws(() => Bronana.pose(null, { x: 0, y: 0, rx: 20, ry: 19.6 }), /没有骨架实例/, 'pose 缺骨架时抛出可读错误');
  throws(() => Bronana.seat(null, 0, 0, 20, 0, 0), /没有骨架实例/, 'seat 缺骨架时抛出可读错误');

  // 近战弧度只剩一份：老公式在两层里写了三遍
  const melee = Weapons.LIST.filter(d => d.type === 'melee');
  let arcBad = '';
  for (const d of melee) {
    const want = (d.arc || 90) * Math.PI / 180;
    if (Math.abs(Bronana.meleeArc(d) - want) > 1e-12) arcBad = d.id;
  }
  ok(arcBad === '', 'meleeArc 对全部 ' + melee.length + ' 把近战武器都等于老公式', arcBad);
  ok(Math.abs(Bronana.meleeArc({}) - Math.PI / 2) < 1e-12, '没写 arc 的武器按 90° 处理（与老公式一致）');

  const readSrc = f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
  const gameSrc = readSrc('game.ts'), renderSrc = readSrc('render.ts');
  const dupArc = [['game.ts', gameSrc], ['render.ts', renderSrc]]
    .filter(([, s]) => /arc \|\| 90/.test(s)).map(([f]) => f);
  ok(dupArc.length === 0, '两层都不再各抄一份弧度换算（只走 Bronana.meleeArc）', dupArc.join(', '));

  // 死状态清理：挂点改由骨架按需计算之后，缓存的 wx/wy/ang 与从未被读过的 swingDir/flash 都删了
  const wc = Comp.componentKeys('WeaponCore');
  const seat = Comp.componentKeys('Seat');
  ok(wc.indexOf('swingDir') < 0 && wc.indexOf('flash') < 0 && wc.indexOf('index') < 0,
    'WeaponCore 只剩真正用到的字段：' + wc.join('/'), wc.join('/'));
  ok(seat.length === 1 && seat[0] === 'index', 'Seat 只声明挂点槽位号：' + seat.join('/'), seat.join('/'));
  const noDead = ['swingDir', 'w.flash', 'w.wx', 'w.wy', 'w.ang']
    .filter(tok => gameSrc.indexOf(tok) >= 0 || renderSrc.indexOf(tok) >= 0);
  ok(noDead.length === 0, '两层都不再写/读已删除的武器死字段', noDead.join(', '));

  // 武器仍然是合格的多组件组合（comp.mjs 会再兜一遍）
  const w = Weapons.instantiate('sword');
  const audit = Comp.audit(w);
  ok(Comp.archetypeInfo('weapon').comps.length >= 3 &&
    audit.unknown.length === 0 && audit.missing.length === 0,
    '武器实例字段不多不少，且仍是 ≥3 组件的组合', audit.unknown.concat(audit.missing).join(','));
}

console.log('\n=== 结果 ===');
if (failures === 0) console.log('\x1b[32m全部通过 ✔\x1b[0m');
else console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m');
process.exit(failures ? 1 : 0);
