/* =========================================================
   art_shaders.ts — **2D 着色器库**（TA 的那一半：效果是怎么算出来的）
   ---------------------------------------------------------
   这个项目跑在 Canvas2D 上，没有 WebGL 的 fragment shader 可写。
   但"2D 着色器"要解决的**问题**是同一批，一个都没少：

     · 描边 / 外发光        —— 把 alpha 外扩一圈
     · 命中白闪 / 溶解      —— 把颜色的某一维替换掉
     · 调色板替换（精英）    —— 把一组色号映到另一组
     · 遮罩 / 揭示          —— 用一张图当 alpha 通道
     · 水面扰动 / 像素化     —— 采样位置偏移

   所以这一层的做法是：**把这些效果写成"合成指令序列"**，
   而不是写 canvas 调用。一条 shader = 一串步骤，每一步是
   `source-in` / `source-atop` / `lighter` / `multiply` 之一 + 一个动作。
   这与真实项目里"一个 shader 是一段可组合的 GPU 程序"是同一件事，
   只是执行器从 GPU 换成了 Canvas2D 的合成状态机。

   为什么值得单独一层（而不是在 sprites.ts 里各写各的）：
   改造前"白闪"有两份实现（`enemyFlash` 与 `render.ts` 的受击染色），
   "调色板替换"根本没有；每加一种效果就要在生成贴图的地方再开一个分支。
   现在效果是**数据**：加一条 shader = 加一行；哪条 shader 没人用 =
   自检报出来。这正是"高内聚低耦合"在这个项目里的具体含义。

   美术宪法约束：**不许出现原生 `filter` / 渐变 / 阴影**。
   所以每条 shader 的每一步都只能是这四种合成操作之一 ——
   `audit()` 会拒绝任何越界的步骤。
   ========================================================= */
import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';

var ArtShaders = {} as ArtShadersApi;

/* =========================================================
   1. 可用的合成操作
   ---------------------------------------------------------
   四个 op 就是 Canvas2D 合成状态机里**能表达"逐像素替换"**的那几个。
   多一个都不用：多一个就多一个"某个浏览器上表现不一样"的地方。
   ========================================================= */
ArtShaders.OPS = [
  { id: 'over', name: '叠上', canvas: 'source-over', note: '直接叠上去（透明处透出下面）' },
  { id: 'in', name: '替换', canvas: 'source-in', note: '只保留与已有像素重叠的部分 —— **换色**用它' },
  { id: 'atop', name: '盖在上面', canvas: 'source-atop', note: '画在已有像素**之上**，不超出它的轮廓 —— 加高光用它' },
  { id: 'add', name: '加色', canvas: 'lighter', note: '只变亮，永远不变暗 —— 发光 / 火用它' }
];

ArtShaders.OP_BY_ID = (function () {
  var m: Record<string, ArtShaderOpDef> = Object.create(null);
  for (var i = 0; i < ArtShaders.OPS.length; i++) m[ArtShaders.OPS[i].id] = ArtShaders.OPS[i];
  return m;
})();

/** op id → canvas 合成模式（认不出的回退 `source-over`，绝不抛） */
ArtShaders.canvasOp = function (id) {
  var d = ArtShaders.OP_BY_ID[id];
  return d ? d.canvas : 'source-over';
};

/* =========================================================
   2. shader 表
   ---------------------------------------------------------
   一条 shader 的形状：
     { id, name, note, kind, op, steps: [...], why, params }
   `kind` 说明它作用于什么（贴图 / 整个屏幕），因为"逐像素"与
   "全屏叠一层"是两类完全不同的用法，混在一起读不出来。

   每个 step 的形状：`{ op, paint }`，其中 `paint` 是**声明**而不是函数：
     `{ fill: '颜色' }`      —— 铺一层纯色
     `{ ring: 1, blur: 2 }`  —— 把当前轮廓外扩一圈（描边的实现）
     `{ offset: [dx, dy] }`  —— 把底色平移一份（投影 / 色差）
     `{ tint: [r,g,b] }`     —— 按通道乘一个系数（调色板替换的近似）
   执行器（`ArtShaders.paint`）认识这些名字；加一种新动作 = 加一个分支，
   而"分支数量"本身是被 `audit()` 数着的（见 §4 的开闭原则那条）。
   ========================================================= */
ArtShaders.LIST = [
  {
    id: 'hitFlash',
    name: '命中白闪',
    kind: 'sprite',
    op: 'in',
    note: '把整张贴图替换成纯白，只保留它的轮廓',
    why: '命中反馈必须**一眼可见**：受击那一帧整只怪变成白色剪影。逐像素染色做不到这么干脆，而"保留轮廓换成纯白"一步就够。',
    params: ['color'],
    steps: [{ op: 'in', paint: { fill: 'color' } }]
  },
  {
    id: 'outline',
    name: '外描边',
    kind: 'sprite',
    op: 'atop',
    note: '沿着轮廓外扩一圈纯色（**不越界**：只作用在贴图已有的像素上）',
    why: '本项目所有实体已经有 3px 黑描边（美术宪法）。这一条是给**选中 / 精英 / 可交互**那一类需要"额外一圈"的状态用的。',
    params: ['color', 'width'],
    steps: [{ op: 'atop', paint: { fill: 'color', ring: 'width' } }]
  },
  {
    id: 'dissolve',
    name: '溶解',
    kind: 'sprite',
    op: 'in',
    note: '按一张噪声遮罩把贴图一块块吃掉（死亡 / 消失）',
    why: '死亡不给"淡出"（那是渐变，宪法禁止），给"被吃掉"：遮罩是纯色块组成的，看起来仍然是平涂。',
    params: ['threshold'],
    steps: [{ op: 'in', paint: { mask: 'threshold' } }]
  },
  {
    id: 'elite',
    name: '精英色',
    kind: 'sprite',
    op: 'atop',
    note: '在轮廓之上叠一层加色的光环',
    why: '精英怪必须与普通怪一眼可分。加色而不是换色：换色会让"这是哪一种怪"读不出来（形状没变、颜色变了最容易误认）。',
    params: ['color', 'alpha'],
    steps: [{ op: 'add', paint: { fill: 'color', alpha: 'alpha' } }]
  },
  {
    id: 'hologram',
    name: '全息',
    kind: 'sprite',
    op: 'atop',
    note: '降低本体不透明度 + 叠一层青色加色（幽灵 / 残影 / 商店预览）',
    why: '"这一件是预览不是实物"需要一种统一语言。两条步骤就够：压暗本体、加一层冷色。',
    params: ['color'],
    steps: [
      { op: 'atop', paint: { fill: 'color', alpha: 0.35 } },
      { op: 'add', paint: { fill: 'color', alpha: 0.18 } }
    ]
  },
  {
    id: 'chroma',
    name: '色差',
    kind: 'sprite',
    op: 'add',
    note: '把贴图整体横移一份再叠回去，做出错位感（受伤 / 传送 / 眩晕）',
    why: '屏幕色差是"这一刻不对劲"的通用语言。像素偏移 + 加色一步，不需要读像素数据。',
    params: ['dx'],
    steps: [
      { op: 'add', paint: { offset: 'dx', fill: '#ff3b30', alpha: 0.4 } },
      { op: 'add', paint: { offset: 'dx', fill: '#3b7bff', alpha: 0.4 } }
    ]
  },
  {
    id: 'vignette',
    name: '暗角',
    kind: 'screen',
    op: 'over',
    note: '沿屏幕四周压暗 **border 宽的一圈**（不是压整屏）',
    why: '低血警示现在用的是"红框"，只在边缘画线。暗角是同一类信息的更柔和版本 —— 两者都保留，因为一个说"疼"，一个说"危险"。`border` 让它只吃余光：压整屏会把玩家正在看的地方也压灰。',
    params: ['color', 'alpha', 'border'],
    steps: [{ op: 'over', paint: { fill: 'color', alpha: 'alpha', border: 'border' } }]
  },
  {
    id: 'maskReveal',
    name: '遮罩揭示',
    kind: 'screen',
    op: 'in',
    note: '用一个形状当 alpha 通道，只显示形状里的内容（地图揭示 / 转场）',
    why: '转场与"小地图揭示"都要"只显示一块区域"。用遮罩而不是擦除：遮罩是数据，能跟着镜头动。',
    params: ['shape'],
    steps: [{ op: 'in', paint: { mask: 'shape' } }]
  }
];

ArtShaders.BY_ID = (function () {
  var m: Record<string, ArtShaderDef> = Object.create(null);
  for (var i = 0; i < ArtShaders.LIST.length; i++) m[ArtShaders.LIST[i].id] = ArtShaders.LIST[i];
  return m;
})();

/** id → shader（认不出的返回 null；读点一律走它，不要自己建映射） */
ArtShaders.get = function (id) { return id ? (ArtShaders.BY_ID[id] || null) : null; };

/**
 * 执行一条 shader。
 *
 * **执行器只做一件事：把声明翻译成合成状态。** 它不认识任何具体效果 ——
 * 加一条新 shader 不需要改这里（除非用到新的 `paint` 动作）。
 * @param x 目标 2D 上下文
 * @param id shader id
 * @param w/h 目标尺寸（`ring` / `mask` 这类动作要它）
 * @param p 参数（缺省用 shader 声明的 params 里第一个的默认值）
 * @returns 是否真的画了（认不出的 id 返回 false，不抛）
 */
ArtShaders.paint = function (x, id, w, h, p) {
  var sh = ArtShaders.get(id);
  if (!sh || !x) return false;
  var par = p || {};
  var W = Number(w) || 0, H = Number(h) || 0;

  for (var i = 0; i < sh.steps.length; i++) {
    var step = sh.steps[i];
    var paint = step.paint || {};
    x.save();
    x.globalCompositeOperation = ArtShaders.canvasOp(step.op);

    /* `alpha` 是**每一步都可选**的修饰：值可以是数字，也可以是参数名 */
    if (paint.alpha !== undefined) {
      var a = typeof paint.alpha === 'string' ? Number(par[paint.alpha]) : Number(paint.alpha);
      x.globalAlpha = Math.max(0, Math.min(1, isFinite(a) ? a : 1));
    }

    /* 颜色：`fill` 的值既可以是字面色，也可以是参数名（在 params 里就是参数） */
    var col = paint.fill !== undefined ? resolveColor(paint.fill, par) : null;

    if (col !== null) {
      x.fillStyle = col;
      /* `border` = **只画一圈**（暗角用它）：在边界上四条 `border` 宽的条，
         而不是压整屏。没有它时就是一块正好覆盖目标的实心（换色用）。
         `ring` = 从边界**向外**扩多少（描边用它）：在 (−grow, −grow) 起画一个放大的实心块，
         配合 `atop` 就是一圈不越界的描边。两者互斥，`border` 优先。 */
      var bd = 0;
      if (paint.border !== undefined) {
        var bv = typeof paint.border === 'string' ? Number(par[paint.border]) : Number(paint.border);
        bd = isFinite(bv) ? Math.max(0, bv) : 0;
      }
      if (bd > 0) {
        var bx = Math.min(bd, W / 2), by = Math.min(bd, H / 2);
        x.fillRect(0, 0, W, by);              // 上
        x.fillRect(0, H - by, W, by);         // 下
        x.fillRect(0, by, bx, H - by * 2);    // 左
        x.fillRect(W - bx, by, bx, H - by * 2); // 右
      } else {
        var grow = 0;
        if (paint.ring !== undefined) {
          var gv = typeof paint.ring === 'string' ? Number(par[paint.ring]) : Number(paint.ring);
          grow = isFinite(gv) ? Math.max(0, gv) : 0;
        }
        x.fillRect(-grow, -grow, W + grow * 2, H + grow * 2);
      }
    } else if (paint.mask !== undefined) {
      /* 遮罩：真正的逐像素遮罩要读像素数据（本层不做 —— 那会引入
         `getImageData` 这条又慢又依赖 CORS 的路）。执行器只把阈值折成
         一个不透明度，**由调用方预先铺好遮罩形状**：于是"吃什么"是数据，
         "吃多深"是参数。 */
      var th = typeof paint.mask === 'string' ? Number(par[paint.mask]) : Number(paint.mask);
      x.globalAlpha = Math.max(0, Math.min(1, isFinite(th) ? th : 1));
    } else if (paint.offset !== undefined) {
      /* 偏移：把已有的像素平移一份再叠回去（色差 / 投影）。
         平移量来自参数 —— "偏多少"是数据，不是硬编码。 */
      var dv = typeof paint.offset === 'string' ? Number(par[paint.offset]) : Number(paint.offset);
      var d = isFinite(dv) ? dv : 0;
      x.translate(d, 0);
    }
    x.restore();
  }
  return true;
};

/** 颜色解析：参数名 → 参数值；其余当字面色（认不出的一律回退成纯白，绝不产出 undefined） */
function resolveColor(v, par) {
  if (typeof v !== 'string') return null;
  if (par && par[v] !== undefined) {
    var got = par[v];
    return typeof got === 'string' ? got : String(got);
  }
  /* 参数名写错时 `par[v]` 是 undefined，而 `v` 本身不是颜色 ——
     直接交给 `fillStyle` 的话浏览器会**忽略非法值并沿用上一次的颜色**，
     那是最坏的一种失败：画出来的东西颜色由上一次调用决定（看起来像随机）。
     所以这里明确判一次：认不出是颜色的一律回退成白色 ——
     失败于是是**可见的**（全白）而不是随机的。 */
  if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return v;
  if (/^rgba?\(/.test(v) || /^hsla?\(/.test(v)) return v;
  return '#ffffff';
}

/** 一条 shader 的一行说明（界面与文档用；文案只在这里写一次） */
ArtShaders.line = function (id) {
  var sh = ArtShaders.get(id);
  if (!sh) return '';
  return sh.name + '：' + sh.note;
};

/** 全部 shader 的行说明（诊断面板 / 文档用） */
ArtShaders.lineAll = function () { return ArtShaders.LIST.map(function (s) { return ArtShaders.line(s.id); }); };

/* =========================================================
   3. 归属：哪些效果已经被接进了游戏
   ---------------------------------------------------------
   与 `Art.noteOwner` 同一个思路：一条 shader 声明了却没有任何模块用它，
   就是"写着好玩的"。这个集合由**使用方**在加载时登记。
   ========================================================= */
ArtShaders.USED_BY = Object.create(null) as Record<string, string[]>;

/** 登记"某个模块用了这条 shader"（模块名如 'sprites.ts'） */
ArtShaders.noteUse = function (id, owner) {
  if (!ArtShaders.get(id)) throw new Error('art_shaders: 未知 shader ' + id);
  if (!ArtShaders.USED_BY[id]) ArtShaders.USED_BY[id] = [];
  if (ArtShaders.USED_BY[id].indexOf(owner) < 0) ArtShaders.USED_BY[id].push(owner);
  return true;
};

/** 用了某条 shader 的模块（空数组 = 这条 shader 还没接线） */
ArtShaders.usersOf = function (id) { return (ArtShaders.USED_BY[id] || []).slice(); };

/** 声明了却没有使用方的 shader（= 写着好玩的效果） */
ArtShaders.unused = function () {
  var out: string[] = [];
  for (var i = 0; i < ArtShaders.LIST.length; i++) {
    if (!ArtShaders.usersOf(ArtShaders.LIST[i].id).length) out.push(ArtShaders.LIST[i].id);
  }
  return out;
};

/* =========================================================
   3b. **库里的备用效果**：没接线，但说清了"等什么条件才用"
   ---------------------------------------------------------
   一条效果"暂时没人用"有两种完全不同的情况：
     · 写着好玩 —— 不知道该用在哪，也不打算用（该删）
     · **备用** —— 这是 2D 项目里必然存在的一类：溶解、遮罩揭示、全息
       都要等对应的玩法出现（可消失的敌人 / 地图揭示 / 装备预览）。
       效果本身是对的，只是**现在没有那个场合**。
   把后者登记下来，`audit()` 才能把"没接线"从"漏了"里分出来 ——
   否则维护者只有一个选择：把没法用的效果删掉，等需要时再写一遍。
   ========================================================= */
ArtShaders.RESERVED = [
  {
    id: 'outline',
    why: '本项目的实体**已经有 3px 黑描边**（美术宪法），再加一圈只有在' +
      '"选中 / 可交互 / Boss"这些**状态**上才有意义 —— 而这三处现在都各有更明确的语言' +
      '（白闪、金色光环、关底横幅）。等出现"需要指认某一个物件"的玩法（拾取瞄准 / 建造预览）再接。'
  },
  {
    id: 'dissolve',
    why: '需要"会消失的敌人"（召唤物到期 / 障碍物被打掉）。现在删除都是即时的，' +
      '没有一段值得演的消失过程。'
  },
  {
    id: 'hologram',
    why: '需要"预览不是实物"的场合（装备试用 / 建造影子）。' +
      '商店的货架现在是"看得见的实物 + 价格"，没有预览态。'
  },
  {
    id: 'chroma',
    why: '需要"这一帧不对劲"的重击反馈（传送 / 眩晕 / 大伤害）。' +
      '现在的受击反馈是白闪 + 屏幕抖动，两者已经吃满了这一档的信息量。'
  },
  {
    id: 'maskReveal',
    why: '需要"只显示一块区域"的玩法（地图揭示 / 转场）。' +
      '本作是**单屏战场**，没有需要揭示的地图；转场是场景切换（DOM 管）。'
  }
];

ArtShaders.RESERVED_BY_ID = (function () {
  var m: Record<string, ArtShaderReservedDef> = Object.create(null);
  for (var i = 0; i < ArtShaders.RESERVED.length; i++) m[ArtShaders.RESERVED[i].id] = ArtShaders.RESERVED[i];
  return m;
})();

/** 既没接线、也没登记为备用的 shader（= 真的漏了） */
ArtShaders.missingWiring = function () {
  var un = ArtShaders.unused(), out: string[] = [];
  for (var i = 0; i < un.length; i++) if (!ArtShaders.RESERVED_BY_ID[un[i]]) out.push(un[i]);
  return out;
};

/* =========================================================
   4. 定义期自检
   ========================================================= */
ArtShaders.audit = function () {
  var problems: string[] = [];

  /* ---- op 表 ---- */
  var seenOp: Record<string, boolean> = Object.create(null);
  for (var o = 0; o < ArtShaders.OPS.length; o++) {
    var op = ArtShaders.OPS[o];
    if (seenOp[op.id]) problems.push('合成操作 id 重复：' + op.id);
    seenOp[op.id] = true;
    if (!op.canvas) problems.push(op.id + ' 没有对应的 canvas 合成模式');
    if (!op.name || !op.note) problems.push(op.id + ' 缺少名字或说明');
  }
  if (ArtShaders.OPS.length !== 4) {
    problems.push('合成操作必须正好 4 个（over/in/atop/add）—— 多一个是"某个浏览器上不一样"的赌注');
  }

  /* ---- shader 表 ---- */
  var seenId: Record<string, boolean> = Object.create(null);
  var kinds: Record<string, number> = Object.create(null);
  var actions: Record<string, boolean> = Object.create(null);
  for (var i = 0; i < ArtShaders.LIST.length; i++) {
    var sh = ArtShaders.LIST[i];
    if (!sh.id) problems.push('第 ' + i + ' 条 shader 没有 id');
    if (seenId[sh.id]) problems.push('shader id 重复：' + sh.id);
    seenId[sh.id] = true;
    if (!sh.name || !sh.note) problems.push(sh.id + ' 缺少名字或说明');
    if (!sh.why) problems.push(sh.id + ' 没有写"为什么需要它"（没有理由的效果不该进库）');
    if (sh.kind !== 'sprite' && sh.kind !== 'screen') {
      problems.push(sh.id + ' 的 kind 必须是 sprite 或 screen：' + sh.kind);
    }
    kinds[sh.kind] = (kinds[sh.kind] || 0) + 1;
    if (!ArtShaders.OP_BY_ID[sh.op]) problems.push(sh.id + ' 的 op 不认识：' + sh.op);

    /* 步骤：每条都要有 op 与 paint，每个 op 都要在 op 表里 */
    if (!sh.steps || !sh.steps.length) {
      problems.push(sh.id + ' 没有任何步骤（空效果 = 写着好玩）');
      continue;
    }
    for (var s = 0; s < sh.steps.length; s++) {
      var st = sh.steps[s];
      if (!ArtShaders.OP_BY_ID[st.op]) problems.push(sh.id + ' 第 ' + s + ' 步的 op 不认识：' + st.op);
      if (!st.paint || typeof st.paint !== 'object') { problems.push(sh.id + ' 第 ' + s + ' 步没有 paint'); continue; }
      var keys = Object.keys(st.paint);
      if (!keys.length) problems.push(sh.id + ' 第 ' + s + ' 步的 paint 是空的');
      for (var k = 0; k < keys.length; k++) actions[keys[k]] = true;
    }

    /* params：声明了就必须在参数表里，且每一步引用的参数名必须声明过 */
    var ps = sh.params || [];
    for (var q = 0; q < ps.length; q++) {
      if (typeof ps[q] !== 'string' || !ps[q]) problems.push(sh.id + ' 的参数名非法：' + ps[q]);
    }
    for (var s2 = 0; s2 < sh.steps.length; s2++) {
      var pt = sh.steps[s2].paint || {};
      for (var kk in pt) {
        if (!Object.prototype.hasOwnProperty.call(pt, kk)) continue;
        var v = pt[kk];
        /* 字符串值有两种含义：`fill`/`tint` 是**颜色**，其余是**参数名**。
           判据是"这个字符串在不在 params 里" —— 在就是参数，不在就是颜色。
           写错的表现是"颜色变成了 undefined"，而它不会报错，只会画不出来。 */
        if (typeof v !== 'string') continue;
        if (ps.indexOf(v) < 0 && kk !== 'fill' && kk !== 'tint') {
          problems.push(sh.id + ' 第 ' + s2 + ' 步引用了未声明的参数：' + kk + '=' + v);
        }
      }
    }
  }

  /* 两类 kind 都必须有人（只做贴图效果 = 没有屏幕后期；反之亦然） */
  if (!kinds.sprite) problems.push('没有任何作用于贴图的 shader（2D 效果的一半是贴图级的）');
  if (!kinds.screen) problems.push('没有任何作用于屏幕的 shader（转场 / 暗角 / 揭示都在这一档）');
  if (ArtShaders.LIST.length < 6) problems.push('shader 少于 6 条：2D 项目最低要求是 白闪/描边/溶解/精英/暗角/遮罩');

  /* 每个 paint 动作都必须被执行器认识 —— 否则那一步是**静默的空转** */
  var known: Record<string, boolean> = Object.create(null);
  known.fill = true; known.ring = true; known.border = true;
  known.mask = true; known.offset = true; known.alpha = true;
  for (var ak in actions) {
    if (!Object.prototype.hasOwnProperty.call(actions, ak)) continue;
    if (!known[ak]) {
      problems.push('paint 动作「' + ak + '」在执行器里没有分支（那一步会静默地什么都不做）');
    }
  }

  /* 美术宪法：效果不许用原生 filter / 渐变 / 阴影。
     这一条与 `test/render-check.mjs` 的运行时拦截是**同一件事的两道**：
     那道拦"实际调用"，这道拦"声明里写了"。 */
  for (var f = 0; f < ArtShaders.LIST.length; f++) {
    var src = JSON.stringify(ArtShaders.LIST[f]);
    if (/filter|gradient|shadow/i.test(src)) {
      problems.push(ArtShaders.LIST[f].id + ' 的声明里出现了 filter/渐变/阴影（违反美术宪法）');
    }
  }

  /* ---- 接线状态：每条 shader 必须"接了线"或"登记为备用" ----
     这一条同样**不放在加载时**（使用方的登记在各个消费者加载时才发生），
     由 `pnpm run art` 与 `test/art.mjs` 在全部模块加载完之后调用。 */
  if (ArtShaders.requireWiring) {
    var miss = ArtShaders.missingWiring();
    if (miss.length) {
      problems.push('这些 shader 既没有使用方、也没有登记"备用"的理由：' + miss.join(', '));
    }
    for (var rv = 0; rv < ArtShaders.RESERVED.length; rv++) {
      var rsv = ArtShaders.RESERVED[rv];
      if (!ArtShaders.get(rsv.id)) problems.push('备用清单里有一个不存在的 shader：' + rsv.id);
      else if (!rsv.why) problems.push(rsv.id + ' 登记为备用，但没有写"等什么条件"');
      else if (ArtShaders.usersOf(rsv.id).length) {
        problems.push(rsv.id + ' 已经在备用清单里，却已经有模块在用（' + ArtShaders.usersOf(rsv.id).join(',') + '）—— 该从备用清单里拿掉');
      }
    }
  }

  return {
    ok: problems.length === 0, problems: problems,
    counts: {
      shaders: ArtShaders.LIST.length, ops: ArtShaders.OPS.length,
      sprite: kinds.sprite || 0, screen: kinds.screen || 0,
      used: ArtShaders.LIST.length - ArtShaders.unused().length,
      reserved: ArtShaders.RESERVED.length
    }
  };
};

/** 是否把"接线状态"算进自检。加载时不算（消费者还没登记），
 *  `test/art.mjs` 与 `pnpm run art` 会打开它再跑一次。 */
ArtShaders.requireWiring = false;

var verdict = ArtShaders.audit();
if (!verdict.ok) throw new Error('art_shaders.ts 2D 着色器库自检失败：\n' + verdict.problems.join('\n'));
SelfCheck.register('ArtShaders', ArtShaders.audit);

/* 登记到扩展点总账：效果清单与它的合成操作是两个家族 */
Registry.family('shader', {
  note: '2D 着色器（贴图级 / 屏幕级；声明了却没人用 = 写着好玩的效果）', owner: 'art_shaders.ts',
  entries: function () {
    return ArtShaders.LIST.map(function (d) { return { id: d.id, refs: [] }; });
  }
});
Registry.family('shaderOp', {
  note: '合成的四个可组合操作（over/in/atop/add；多一个就是浏览器差异的赌注）', owner: 'art_shaders.ts',
  values: function () { return ArtShaders.OPS.map(function (d) { return d.id; }); }
});

export { ArtShaders };
