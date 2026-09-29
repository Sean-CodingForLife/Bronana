/* =========================================================
   rig.ts — 通用骨架运行时
   角色不是"把形状贴在坐标上"，而是"骨头 + 绑在骨头上的部件"：
     · Rig.compile(名字, 骨头表)   —— 纯数据，定义骨架的层级与静止姿态
     · Rig.instance(模板)          —— 每个实体一份姿态存储（定长数组，零分配）
     · Rig.set / Rig.update        —— 写局部姿态 → 正向运动学算出世界变换
     · Rig.point / Rig.at          —— 取骨头的世界坐标 / 在骨头坐标系里绘制
     · Rig.reach                   —— 让骨头的末端精确落到父骨坐标系里的某个点（肢体够位）
     · Rig.parts                   —— 部件表：绑定到骨头、带绘制层序，绑定错直接抛错

   定义期就抛错的情况（宁可启动即炸，也不要跑起来才画歪）：
     骨头重名 / 父骨不存在 / 层级成环 / 两根骨头重名 / 部件绑到不存在的骨头 /
     部件层序号重复（层序就是绘制顺序，重复等于顺序不确定）。

   ── 两个刻意的设计决定 ──────────────────────────────────

   1) 骨头带完整 TRS，父骨的缩放会作用到子骨的局部平移（矩阵复合的自然结果）。
      因此"呼吸挤压"这种整体形变放在躯干骨上就够了：头、手臂、挂点的世界位置
      自动跟着变，不需要每个部件各自乘一遍缩放。

   2) Rig.at 只应用【平移 + 旋转】，刻意不应用缩放。
      本作的美术宪法是"粗黑外轮廓"，外轮廓统一 3px。如果让缩放进 ctx 变换，
      非等比缩放会把 3px 描边变成各向异性的椭圆描边（横竖不一样粗），
      这与"线条边缘锐利、粗细一致"的观感直接冲突。
      需要缩放几何的部件改用 Rig.point（完整矩阵）自己算世界坐标，
      于是描边宽度仍由调用方给定，不被变换污染。
      这也解释了 Rig.at 帧内的绘制坐标是"像素"而不是"归一化单位"。
   ========================================================= */


var Rig = {} as RigApi;

/* ---------------- 2D 仿射矩阵 [a, b, c, d, e, f] ----------------
   x' = a·x + c·y + e
   y' = b·x + d·y + f                                        */
function matMul(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5]
  ];
}

/* =========================================================
   1. 编译骨架
   ========================================================= */
Rig.compile = function (name, defs) {
  if (!defs || !defs.length) throw new Error('rig: 骨架 ' + name + ' 一根骨头都没有');
  var n = defs.length, i;

  var names: string[] = [];
  var indexOf: Record<string, number> = Object.create(null);
  for (i = 0; i < n; i++) {
    var d = defs[i];
    if (!d || !d.name) throw new Error('rig: 骨架 ' + name + ' 第 ' + i + ' 根骨头没有名字');
    if (indexOf[d.name] !== undefined) {
      throw new Error('rig: 骨架 ' + name + ' 骨头重名 ' + d.name);
    }
    indexOf[d.name] = i;
    names.push(d.name);
  }

  var parent = new Int32Array(n);
  for (i = 0; i < n; i++) {
    var pn = defs[i].parent;
    if (pn === undefined || pn === null || pn === '') { parent[i] = -1; continue; }
    var pi = indexOf[pn];
    if (pi === undefined) {
      throw new Error('rig: 骨头 ' + names[i] + ' 的父骨 ' + pn + ' 不存在');
    }
    if (pi === i) throw new Error('rig: 骨头 ' + names[i] + ' 的父骨是它自己');
    parent[i] = pi;
  }

  // 拓扑序（Kahn）：必须父在子前，否则正向运动学读到的是上一帧的父骨
  var children: number[][] = [];
  for (i = 0; i < n; i++) children.push([]);
  var indeg = new Int32Array(n);
  for (i = 0; i < n; i++) {
    if (parent[i] >= 0) { indeg[i] = 1; children[parent[i]].push(i); }
  }
  var order: number[] = [], queue: number[] = [];
  for (i = 0; i < n; i++) if (indeg[i] === 0) queue.push(i);
  for (var q = 0; q < queue.length; q++) {
    var cur = queue[q];
    order.push(cur);
    var ch = children[cur];
    for (var c = 0; c < ch.length; c++) { indeg[ch[c]] = 0; queue.push(ch[c]); }
  }
  if (order.length !== n) {
    var stuck: string[] = [];
    for (i = 0; i < n; i++) if (order.indexOf(i) < 0) stuck.push(names[i]);
    throw new Error('rig: 骨架 ' + name + ' 的层级成环，环上的骨头：' + stuck.join(' → '));
  }

  var restX = new Float64Array(n), restY = new Float64Array(n);
  var restRot = new Float64Array(n), restSx = new Float64Array(n), restSy = new Float64Array(n);
  var len = new Float64Array(n);
  for (i = 0; i < n; i++) {
    var dd = defs[i];
    restX[i] = dd.x || 0;
    restY[i] = dd.y || 0;
    restRot[i] = dd.rot || 0;
    restSx[i] = dd.sx === undefined ? 1 : dd.sx;
    restSy[i] = dd.sy === undefined ? 1 : dd.sy;
    len[i] = dd.len === undefined ? 1 : dd.len;
  }

  return {
    rig: true, name: name, count: n, names: names, indexOf: indexOf,
    parent: parent, order: Int32Array.from(order), len: len,
    restX: restX, restY: restY, restRot: restRot, restSx: restSx, restSy: restSy
  };
};

/** 骨头下标（做一次、存下来，热路径上不要再查字符串） */
Rig.index = function (tpl, boneName) {
  var i = tpl.indexOf[boneName];
  if (i === undefined) {
    throw new Error('rig: 骨架 ' + tpl.name + ' 没有骨头 ' + boneName +
      '（现有：' + tpl.names.join(', ') + '）');
  }
  return i;
};

/* =========================================================
   2. 实例：姿态存储
   ========================================================= */
/** 每个实体一份。全部定长 Float64Array —— 姿态求值零分配 */
Rig.instance = function (tpl) {
  var n = tpl.count;
  var inst = {
    tpl: tpl, count: n, frame: 0,
    lx: new Float64Array(n), ly: new Float64Array(n), lrot: new Float64Array(n),
    lsx: new Float64Array(n), lsy: new Float64Array(n),
    wa: new Float64Array(n), wb: new Float64Array(n),
    wc: new Float64Array(n), wd: new Float64Array(n),
    we: new Float64Array(n), wf: new Float64Array(n),
    wrot: new Float64Array(n), wsx: new Float64Array(n), wsy: new Float64Array(n),
    _dirty: true
  };
  Rig.reset(inst);
  // 建好就把世界坐标算一遍：否则第一次 Rig.point/wx 读到的是全 0
  Rig.update(inst);
  return inst;
};

Rig.reset = function (inst) {
  var t = inst.tpl, n = t.count;
  for (var i = 0; i < n; i++) {
    inst.lx[i] = t.restX[i]; inst.ly[i] = t.restY[i]; inst.lrot[i] = t.restRot[i];
    inst.lsx[i] = t.restSx[i]; inst.lsy[i] = t.restSy[i];
  }
  inst._dirty = true;
};

/** 写一根骨头的局部姿态（在父骨坐标系里） */
Rig.set = function (inst, i, x, y, rot, sx, sy) {
  inst.lx[i] = x; inst.ly[i] = y; inst.lrot[i] = rot;
  inst.lsx[i] = sx === undefined ? 1 : sx;
  inst.lsy[i] = sy === undefined ? 1 : sy;
  inst._dirty = true;
  return inst;
};

/* =========================================================
   3. 正向运动学
   ========================================================= */
/**
 * 从局部姿态算出每根骨头的世界矩阵。
 * 局部矩阵 L = T(x,y)·R(rot)·S(sx,sy)，世界矩阵 W = W(父)·L。
 * 于是父骨的缩放自然作用到子骨的平移上 —— 躯干挤压时四肢跟着走。
 */
Rig.update = function (inst) {
  var t = inst.tpl, n = t.count, parent = t.parent, order = t.order;
  for (var k = 0; k < n; k++) {
    var i = order[k], pi = parent[i];
    var cr = Math.cos(inst.lrot[i]), sr = Math.sin(inst.lrot[i]);
    var la = cr * inst.lsx[i], lb = sr * inst.lsx[i];
    var lc = -sr * inst.lsy[i], ld = cr * inst.lsy[i];
    var le = inst.lx[i], lf = inst.ly[i];
    var a, b, c, d, e, f, sx, sy;
    if (pi < 0) {
      a = la; b = lb; c = lc; d = ld; e = le; f = lf;
      sx = Math.abs(inst.lsx[i]); sy = Math.abs(inst.lsy[i]);
    } else {
      var pa = inst.wa[pi], pb = inst.wb[pi], pc = inst.wc[pi], pd = inst.wd[pi];
      var pe = inst.we[pi], pf = inst.wf[pi];
      a = pa * la + pc * lb;
      b = pb * la + pd * lb;
      c = pa * lc + pc * ld;
      d = pb * lc + pd * ld;
      e = pa * le + pc * lf + pe;
      f = pb * le + pd * lf + pf;
      sx = Math.sqrt(a * a + b * b);
      sy = sx > 0 ? (a * d - b * c) / sx : 0;
    }
    inst.wa[i] = a; inst.wb[i] = b; inst.wc[i] = c;
    inst.wd[i] = d; inst.we[i] = e; inst.wf[i] = f;
    inst.wrot[i] = Math.atan2(b, a);
    inst.wsx[i] = sx; inst.wsy[i] = sy;
  }
  inst._dirty = false;
  inst.frame++;
  return inst;
};

/** 世界位置（骨头原点）。position 已包含父骨缩放对平移的作用 */
Rig.wx = function (inst, i) { return inst.we[i]; };
Rig.wy = function (inst, i) { return inst.wf[i]; };
Rig.wsx = function (inst, i) { return inst.wsx[i]; };
Rig.wsy = function (inst, i) { return inst.wsy[i]; };

/** 骨头局部坐标 → 世界坐标（完整矩阵，含缩放） */
Rig.point = function (inst, i, ux, uy, out) {
  var x = inst.wa[i] * ux + inst.wc[i] * uy + inst.we[i];
  var y = inst.wb[i] * ux + inst.wd[i] * uy + inst.wf[i];
  if (out) { out.x = x; out.y = y; return out; }
  return { x: x, y: y };
};

/**
 * 让骨头末端（局部 (len,0) 处）精确落到【父骨坐标系】里的 (tx,ty)。
 * 两自由度：绕关节旋转 + 沿骨轴伸缩。
 * 单根刚体骨头只有一个旋转自由度，够不到任意点；这里保留伸缩这一自由度，
 * 是为了让"手要落在某个点上"这类既有轨迹能被原样复现，而不是被逼近。
 * 目标用父骨坐标给，是因为姿态本来就是按"在躯干坐标系里手在 (u,v)"这种
 * 方式写出来的。
 */
Rig.reach = function (inst, i, tx, ty) {
  var t = inst.tpl;
  var dx = tx - inst.lx[i], dy = ty - inst.ly[i];
  var dist = Math.sqrt(dx * dx + dy * dy);
  var length = t.len[i];
  if (!length) throw new Error('rig: 骨头 ' + t.names[i] + ' 没有长度（len=0），无法够位');
  inst.lrot[i] = Math.atan2(dy, dx);
  inst.lsx[i] = dist / length;
  inst._dirty = true;
  return inst;
};

/**
 * 在骨头坐标系里绘制。
 * 只应用平移 + 旋转（见文件头"设计决定 2"）：3px 外轮廓不被缩放拉成椭圆描边。
 * 因此帧内坐标是像素；骨头的局部平移才是受父骨缩放影响的"父骨单位"。
 */
Rig.at = function (ctx, inst, i, fn) {
  ctx.save();
  ctx.translate(inst.we[i], inst.wf[i]);
  ctx.rotate(inst.wrot[i]);
  fn(ctx);
  ctx.restore();
};

/* =========================================================
   4. 部件表
   ========================================================= */
/**
 * 声明"哪些部件绑在哪根骨头上、按什么层序画"。
 * 绑定到不存在的骨头 → 当场抛错（这正是"部件被直接贴上去"的防线）。
 * layer 就是绘制顺序（小的先画），重复即抛错。
 */
Rig.parts = function (tpl, defs) {
  if (!defs || !defs.length) throw new Error('rig: 骨架 ' + tpl.name + ' 没有声明任何部件');
  var seen: Record<string, boolean> = Object.create(null);
  var layers: Record<string, string> = Object.create(null);
  var byName: Record<string, any> = Object.create(null);
  var list: any[] = [];
  for (var i = 0; i < defs.length; i++) {
    var d = defs[i];
    if (!d || !d.name) throw new Error('rig: 骨架 ' + tpl.name + ' 第 ' + i + ' 个部件没有名字');
    if (seen[d.name]) throw new Error('rig: 骨架 ' + tpl.name + ' 部件重名 ' + d.name);
    seen[d.name] = true;
    if (typeof d.draw !== 'function') {
      throw new Error('rig: 部件 ' + d.name + ' 没有 draw 函数');
    }
    var layer = d.layer === undefined ? 0 : d.layer;
    if (layers[layer]) {
      throw new Error('rig: 骨架 ' + tpl.name + ' 的层序 ' + layer + ' 被 ' +
        layers[layer] + ' 与 ' + d.name + ' 同时占用（层序即绘制顺序，不能并列）');
    }
    layers[layer] = d.name;
    var bone = Rig.index(tpl, d.bone);      // 绑到不存在的骨头 → 抛错
    var part = { name: d.name, bone: bone, boneName: d.bone, layer: layer, draw: d.draw, note: d.note || '' };
    byName[d.name] = part;
    list.push(part);
  }
  list.sort(function (a, b) { return a.layer - b.layer; });
  return { rig: tpl.name, list: list, byName: byName, order: list.map(function (p) { return p.name; }) };
};

/**
 * 按层序把部件画一遍（args 是共享的、预先建好的参数对象：不产生每帧分配）。
 * @param skip 可选：`{部件名: true}` 跳过哪些部件 —— 图集烘焙要用它把
 *   "不随动作变化的部分"（躯干/暗部/斑点/五官）单独烘成一张贴图，
 *   手臂与武器仍然逐帧矢量绘制（它们每帧都在转，烘不了）。
 */
Rig.paint = function (ctx, inst, parts, args, skip) {
  var list = parts.list;
  var n = 0;
  for (var i = 0; i < list.length; i++) {
    if (skip && skip[list[i].name]) continue;
    list[i].draw(ctx, inst, args);
    n++;
  }
  return n;
};

/* =========================================================
   5. 自查
   ========================================================= */
/**
 * 写过姿态但还没跑正向运动学 → 真。
 * 读到的是上一帧的世界坐标，是骨架系统最典型的静默错误（画出来的东西
 * 永远慢一帧，且只有快速运动时才看得出来），所以留一个可断言的标志位。
 */
Rig.stale = function (inst) { return !!inst._dirty; };

/** 姿态求值后有没有 NaN / 无穷（数值错误最容易被静默画成一团黑） */
Rig.badValues = function (inst) {
  var t = inst.tpl, bad: string[] = [];
  for (var i = 0; i < t.count; i++) {
    var vals = [inst.lx[i], inst.ly[i], inst.lrot[i], inst.lsx[i], inst.lsy[i],
      inst.we[i], inst.wf[i], inst.wrot[i], inst.wsx[i], inst.wsy[i]];
    for (var k = 0; k < vals.length; k++) {
      if (!isFinite(vals[k])) { bad.push(t.names[i]); break; }
    }
  }
  return bad;
};

export { Rig };