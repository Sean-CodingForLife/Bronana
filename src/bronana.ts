/* =========================================================
   bronana.ts — 豆豆角色的骨架定义（骨头表 + 部件绑定 + 武器挂点）
   改造前：sprites.drawBronana 直接把形状画在 (cx, cy) 的偏移上 ——
   手臂是"肩点 + 一段按摆动量上下平移的终点"，武器座是 game.ts 与
   render.ts 各自抄了一份的三角函数。角色与"骨头"没有关系。

   现在：角色 = 一个骨架 + 一批绑在骨头上的部件。
     anchor ─┬─ body ─┬─ head      （五官绑在头上）
             │        ├─ armL     （手臂是骨头，末端够到既有的手部轨迹）
             │        └─ armR
             └─ w0…w5             （6 个武器挂点，随瞄准角排开）

   骨头的局部平移用【父骨单位】（会被父骨缩放放大），躯干骨的缩放就是
   角色半径 —— 所以"呼吸挤压"改的是躯干骨，头与手臂的世界位置自动跟着走；
   而部件在 Rig.at 帧内是用像素画的（外轮廓宽度不受缩放污染，见 rig.ts）。

   武器挂点挂在 anchor（不是 body）下，是为了保持既有手感：武器座目前
   不随呼吸上下浮动。想让武器跟着身体起伏，把 parent 改成 'body' 即可。
   ========================================================= */

import { Comp } from './comp.ts';
import { D } from './draw2d.ts';
import { Rig } from './rig.ts';
import { PAL, U } from './utils.ts';

var Bronana = {} as BronanaApi;

/** 没有骨架实例就立刻给出可读的错误，而不是在 Rig 里炸出一个 TypeError */
function needRig(inst) {
  if (!inst) {
    throw new Error('bronana: 没有骨架实例 —— player 原型的 Skeleton 组件里 rig 为空' +
      '（正常路径由 Comp.onSpawn 生成，手工 Comp.spawn 后不要把它清掉）');
  }
  return inst;
}

/* =========================================================
   1. 几何常数（全部来自既有画法，逐项标注对应的老公式）
   ========================================================= */
var RY_RATIO = 0.98;          // 老：ry 传参 = r*0.98*sy
var ARM_X = 0.94;             // 老：armX = rx*0.94
var SHOULDER_U = 0.55;        // 老：肩点 x = ∓armX*0.55
var SHOULDER_V = 0.30;        // 老：肩点 y = armY + ry*0.30
var ARM_LIFT = 0.05;          // 老：armY = cy + bob + ry*0.05
var TIP_U = 1.18;             // 老：手 x = ∓armX*1.18
var TIP_V = 0.42;             // 老：手 y = armY + ry*(0.42 ∓ swing*0.35)
var TIP_V_SWING = 0.35;
var HEAD_V = -0.14;           // 老：眼线 y = cy + bob - ry*0.14
var MOUTH_DEAD_V = 0.34;      // 老：死亡嘴 y = cy + bob + ry*0.34（相对躯干）

/** 武器座（老公式：game.ts / render.ts 各抄了一份） */
var SEATS = 6;                // 与 Game.cfg.maxWeapons 一致（测试里断言）
var SEAT_OFF_R = 0.86;        // 老：offR = r*0.86
var SEAT_DY = 0.14;           // 老：wy = ... - r*0.14
var SEAT_EVEN = 0.42;         // 老：(index%2===0) ? 0.42 : -0.42
var SEAT_SPREAD = 0.16;       // 老：(index - 2.5)*0.16
var SEAT_MID = 2.5;
var MUZZLE_AHEAD = 14;        // 老：Emit.muzzle(wx + cos(ang)*14, ...)
var BULLET_AHEAD = 12;        // 老：子弹出生点 x = wx + cos(ang)*12

/* 手臂静止姿态由上面几个常数推出来（不写死数字，改常数时自动一致） */
var SH_U = ARM_X * SHOULDER_U;          // 0.517
var SH_V = ARM_LIFT + SHOULDER_V;       // 0.35
var TIP_U0 = ARM_X * TIP_U;             // 1.1092
var TIP_V0 = ARM_LIFT + TIP_V;          // 0.47
var ARM_DU = TIP_U0 - SH_U;
var ARM_DV = TIP_V0 - SH_V;
var ARM_LEN = Math.sqrt(ARM_DU * ARM_DU + ARM_DV * ARM_DV);
var ARM_ROT_R = Math.atan2(ARM_DV, ARM_DU);
var ARM_ROT_L = Math.atan2(ARM_DV, -ARM_DU);

/* =========================================================
   2. 骨头表
   ========================================================= */
var DEFS: RigBoneDef[] = [
  { name: 'anchor', note: '角色摆位（世界坐标）' },
  { name: 'body', parent: 'anchor', note: '躯干：缩放 = 角色半径（含呼吸挤压）' },
  { name: 'head', parent: 'body', x: 0, y: HEAD_V, note: '五官挂点（眼线）' },
  { name: 'armL', parent: 'body', x: -SH_U, y: SH_V, rot: ARM_ROT_L, len: ARM_LEN, note: '左臂：末端=手' },
  { name: 'armR', parent: 'body', x: SH_U, y: SH_V, rot: ARM_ROT_R, len: ARM_LEN, note: '右臂：末端=手' }
];
for (var si = 0; si < SEATS; si++) {
  DEFS.push({ name: 'w' + si, parent: 'anchor', note: '武器挂点 ' + si });
}

var TPL = Rig.compile('bronana', DEFS);

/** 骨头下标（编译期解析一次；绑错名字会在这里直接抛错） */
var B = {
  anchor: Rig.index(TPL, 'anchor'),
  body: Rig.index(TPL, 'body'),
  head: Rig.index(TPL, 'head'),
  armL: Rig.index(TPL, 'armL'),
  armR: Rig.index(TPL, 'armR')
};
var W: number[] = [];
for (var wi = 0; wi < SEATS; wi++) W.push(Rig.index(TPL, 'w' + wi));

/* =========================================================
   3. 部件（层序即绘制顺序；绑到不存在的骨头会抛错）
   ========================================================= */
/** 绘制层序：集中在一处，测试会断言它单调递增且与数组顺序一致 */
var PAINT = {
  body: 10,      // 躯干本体
  belly: 12,     // 暗部 / 高光（裁剪在躯干轮廓内）
  dots: 14,      // 豆豆坑
  armL: 30,      // 手臂画在躯干之上
  armR: 32,
  face: 40,      // 五官在最上
  weapon: 50     // 武器由 render 画在最外层（需要武器列表与挥击进度）
};

/* 共享选项对象：D.seedBlob 的 o 参数每帧新建一个字面量就是一次分配。
   这里复用同一个对象、只改 seed 字段（同步读取，读完即失效）。 */
var _bronanaOpt = { seed: 0, outline: PAL.INK, outlineWidth: D.OUT };

function drawBody(ctx, inst, a) {
  var rx = Rig.wsx(inst, B.body), ry = Rig.wsy(inst, B.body);
  _bronanaOpt.seed = a.seed;
  _bronanaOpt.outlineWidth = a.outlineWidth || D.OUT;
  Rig.at(ctx, inst, B.body, function (g) {
    D.seedBlob(g, 0, 0, rx, ry, a.skin.base, _bronanaOpt);
  });
}

/**
 * 平涂暗部：把躯干轮廓当裁剪区，往里压一块同色系暗部 + 一块高光。
 * 这里曾经有个只有浏览器才暴露的 bug —— 老代码是
 *     x.save(); D.seedBlobPath(x, ...); x.translate(cx, cy+bob); x.clip();
 * Canvas2D 的路径在加入时就被当时的变换映射到设备空间，之后 translate
 * 不会移动已经建好的路径。于是裁剪区留在了"变换原点"（游戏里就是战场
 * 左上角），躯干的暗部与高光被整块裁掉，同时左上角被多填了一块豆豆形
 * 剪影。现在路径建在躯干骨坐标系里，顺序上不可能再写错。
 */
function drawBelly(ctx, inst, a) {
  var rx = Rig.wsx(inst, B.body), ry = Rig.wsy(inst, B.body);
  Rig.at(ctx, inst, B.body, function (g) {
    g.save();
    D.seedBlobPath(g, rx, ry, a.seed);
    g.clip();
    D.fill(g, a.skin.sh);
    g.beginPath();
    g.ellipse(rx * 0.18, ry * 0.62, rx * 0.62, ry * 0.5, 0, 0, U.TAU);
    g.fill();
    D.fill(g, a.skin.hi);
    g.beginPath();
    g.ellipse(-rx * 0.30, -ry * 0.46, rx * 0.40, ry * 0.30, -0.4, 0, U.TAU);
    g.fill();
    g.restore();
  });
}

function drawDots(ctx, inst, a) {
  if (a.dots === false) return;
  var rx = Rig.wsx(inst, B.body), ry = Rig.wsy(inst, B.body);
  var r = Math.min(rx, ry) * 0.92;
  Rig.at(ctx, inst, B.body, function (g) {
    D.dots(g, 0, 0, r, 6, 'bronana' + a.seed, a.skin.dot, Math.max(1.4, rx * 0.055));
  });
}

/** 手臂：肩点与手都用骨骼世界坐标算，粗细取自躯干半径（与老代码同式） */
var _p0 = { x: 0, y: 0 }, _p1 = { x: 0, y: 0 };
function armPart(boneIdx) {
  return function (ctx, inst, a) {
    Rig.point(inst, boneIdx, 0, 0, _p0);
    Rig.point(inst, boneIdx, TPL.len[boneIdx], 0, _p1);
    D.capsule(ctx, _p0.x, _p0.y, _p1.x, _p1.y,
      Math.max(7, Rig.wsx(inst, B.body) * 0.34), a.skin.sh, D.O.ink25);
  };
}

function drawFace(ctx, inst, a) {
  var rx = Rig.wsx(inst, B.body), ry = Rig.wsy(inst, B.body);
  var eyeDx = rx * 0.34;
  var eyeR = Math.max(2.6, rx * 0.155);
  var shift = (a.face || 0) * rx * 0.08;
  var style = a.eyeStyle || 'stern';
  Rig.at(ctx, inst, B.head, function (g) {
    if (a.mood === 'dead') {
      D.eye(g, -eyeDx, 0, eyeR, 'dead');
      D.eye(g, eyeDx, 0, eyeR, 'dead');
      D.mouth(g, 0, ry * (MOUTH_DEAD_V - HEAD_V), rx * 0.24, 'wave');
      return;
    }
    var eo = style === 'angry' ? D.O.slopeAngry : D.O.slopeStern;
    D.eye(g, -eyeDx + shift, 0, eyeR, style, eo);
    D.eye(g, eyeDx + shift, 0, eyeR, style, eo);
    D.mouth(g, shift * 0.6, ry * (0.36 - HEAD_V), rx * 0.22,
      a.mood === 'hurt' ? 'open' : (a.mouthStyle || 'flat'));
  });
}

var PARTS = Rig.parts(TPL, [
  { name: 'body', bone: 'body', layer: PAINT.body, draw: drawBody, note: '躯干本体' },
  { name: 'belly', bone: 'body', layer: PAINT.belly, draw: drawBelly, note: '暗部/高光（裁剪在躯干内）' },
  { name: 'dots', bone: 'body', layer: PAINT.dots, draw: drawDots },
  { name: 'armL', bone: 'armL', layer: PAINT.armL, draw: armPart(B.armL) },
  { name: 'armR', bone: 'armR', layer: PAINT.armR, draw: armPart(B.armR) },
  { name: 'face', bone: 'head', layer: PAINT.face, draw: drawFace }
]);

/* =========================================================
   4. 姿态
   ========================================================= */
Bronana.TPL = TPL;
Bronana.B = B;
Bronana.SEATS = SEATS;
Bronana.PAINT = PAINT;
Bronana.PARTS = PARTS;

/** 新建一份骨架实例（每个角色一份） */
Bronana.create = function () { return Rig.instance(TPL); };

/**
 * 玩家原型出生即带骨架。
 * 骨架实例是对象/函数类型，写不进组件的默认值（define 会拒绝，避免隐式共享），
 * 所以挂在生成钩子上：`Comp.spawn('player')` 拿到的对象一定带着可用的骨架，
 * 而不是"调用方记得再 assign 一次"。显式传入的 rig 会被尊重（测试注入用）。
 */
Comp.onSpawn('player', function (p) {
  if (!p.rig) p.rig = Bronana.create();
});

/**
 * 摆位。rx/ry 是"最终半径"（含呼吸挤压），与老 S.drawBronana 的入参同一含义，
 * 因此调用点的算式不变。
 * @param o {x,y,rx,ry,bob,armSwing}
 */
Bronana.pose = function (inst, o) {
  needRig(inst);
  Rig.set(inst, B.anchor, o.x, o.y, 0, 1, 1);
  Rig.set(inst, B.body, 0, o.bob || 0, 0, o.rx, o.ry);
  Rig.set(inst, B.head, 0, HEAD_V, 0, 1, 1);
  var sw = o.armSwing || 0;
  // 手的目标点在躯干坐标系里（这正是动画本来的写法），够位后自动得到肩→手的骨头
  Rig.set(inst, B.armL, -SH_U, SH_V, ARM_ROT_L, 1, 1);
  Rig.set(inst, B.armR, SH_U, SH_V, ARM_ROT_R, 1, 1);
  Rig.reach(inst, B.armL, -TIP_U0, TIP_V0 + sw * TIP_V_SWING);
  Rig.reach(inst, B.armR, TIP_U0, TIP_V0 - sw * TIP_V_SWING);
  Rig.update(inst);
  return inst;
};

/* 默认皮肤与空参数对象（保持老 S.drawBronana 的调用习惯） */
var DEFAULT_SKIN = {
  base: PAL.SKIN, hi: PAL.SKIN_HI, sh: PAL.SKIN_SH, dp: PAL.SKIN_DP, dot: PAL.SKIN_DOT
};
var EMPTY = { skin: DEFAULT_SKIN, seed: 1, face: 0, mood: 'idle' };

/**
 * 按层序画一遍。a 是调用方复用的参数对象（draw 内不保存它）：
 *   {skin, seed, face, mood, eyeStyle, mouthStyle, dots, outlineWidth}
 */
Bronana.draw = function (ctx, inst, a, skip) {
  var args = a || EMPTY;
  if (!args.skin) args.skin = DEFAULT_SKIN;
  return Rig.paint(ctx, inst, PARTS, args, skip);
};

/** 图集烘焙用：哪些部件"不随动作变化"（躯干/暗部/斑点/五官），哪些每帧都变（手臂） */
Bronana.BAKED_PARTS = { body: true, belly: true, dots: true, face: true };
Bronana.LIVE_PARTS = { armL: true, armR: true };

/* =========================================================
   5. 武器挂点（模拟层与渲染层共用同一份公式与同一根骨头）
   ========================================================= */
/**
 * 把第 index 个武器槽摆到瞄准角 aim 上。
 * 同时把 anchor 摆到 (px, py)，因此即使不先调用 pose，读到的世界坐标也是对的。
 * @returns 该挂点的骨头下标
 */
Bronana.seat = function (inst, index, aim, r, px, py) {
  needRig(inst);
  if (!(index >= 0 && index < SEATS)) {
    throw new Error('bronana: 武器槽 ' + index + ' 超出骨架（共 ' + SEATS + ' 个）');
  }
  var bi = W[index];
  var slot = Bronana.seatAngle(index, aim);
  var offR = r * SEAT_OFF_R;
  Rig.set(inst, B.anchor, px, py, 0, 1, 1);
  Rig.set(inst, bi, Math.cos(slot) * offR, Math.sin(slot) * offR - r * SEAT_DY, aim, 1, 1);
  Rig.update(inst);
  return bi;
};

/** 槽位角（武器扇形的唯一一份公式：模拟层与渲染层都经由 seat 用它） */
Bronana.seatAngle = function (index, aim) {
  return aim + ((index % 2 === 0) ? SEAT_EVEN : -SEAT_EVEN) + (index - SEAT_MID) * SEAT_SPREAD;
};

/**
 * 近战弧度（弧度制，含默认 90°）。
 * 以前这个换算在 game.ts 里写了两遍（命中锥 + 挥击特效）、render.ts 又写了一遍，
 * 三处都靠"记得同步改"，现在只剩这一份。
 */
/** 没写 arc 的武器按多少度算（**唯一一处字面量** —— 技能那边也读它）。
 *  提到具名常量是因为新代码（技能的扇形）也要这个默认值，
 *  而再写一遍 90 就是「同一件事两份副本」：test/rig.mjs 有判据专门盯着它。 */
var DEFAULT_ARC = 90;
Bronana.DEFAULT_ARC = DEFAULT_ARC;
Bronana.meleeArc = function (def) {
  return (def.arc || DEFAULT_ARC) * Math.PI / 180;
};

/** 武器座的世界坐标（写入 out，不分配） */
Bronana.seatPoint = function (inst, boneIdx, out) {
  return Rig.point(inst, boneIdx, 0, 0, out);
};

/**
 * 武器座沿瞄准方向前移 dist 的世界坐标：
 * 挂点的局部 +x 就是瞄准方向（Rig.set 时把 aim 写成了它的旋转）。
 */
Bronana.aheadPoint = function (inst, boneIdx, dist, out) {
  return Rig.point(inst, boneIdx, dist, 0, out);
};

Bronana.MUZZLE_AHEAD = MUZZLE_AHEAD;
Bronana.BULLET_AHEAD = BULLET_AHEAD;
Bronana.RY_RATIO = RY_RATIO;

export { Bronana };
