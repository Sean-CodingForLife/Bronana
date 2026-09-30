/* =========================================================
   art_spec.ts — **美术规范**（TA 的那一半：命名 / 尺寸 / 图集 / 管线 / 检查）
   ---------------------------------------------------------
   这个项目**没有一张图片文件**：全部视觉都是代码画出来的。
   于是"美术资源管线"在这里的含义变了，但变的只是**中间产物的形式**，
   每一道工序与每一步检查**一模一样**：

     真实项目                             本项目
     ─────────────────────────────────    ─────────────────────────────────
     PS/SAI 源文件                         生成函数（画法参数，写在数据表里）
     导出 PNG（尺寸/通道/压缩规范）          离屏 canvas（size / anchor / 通道语义）
     资源检查（尺寸超限/冗余图层/多余通道）    lint（名称 / 尺寸 / 锚点 / 图集分组）
     图集打包（SpriteAtlas）                贴图缓存分组 + 预算（sprites.ts 的 cache）
     引擎导入设置（TextureImporter）        缓存键与倍率（DPR / bake 倍率）
     材质 / Shader / 混合模式               blend / shader 段（draw2d 的合成状态）
     渲染层级（Sorting Layer + Order）      depth.ts 的层带 + 层内 y 排序
     DrawCall 预算                          每帧 blit 计数与预算（tools 的校验）

   **这个文件管的是"规范"，不是"内容"**：
     · 内容（有哪些资源）在各自的资源表里（sprites / dungeon / emit / ui / data_items）
     · 规范（资源该怎么命名、多大、进哪个图集、按什么顺序加工、被哪些校验拦）
       只在这里声明**一次**，并被三处读：
         `Art.lintAsset()`  —— 任何新资源都要过的那条校验
         `test/render-check.mjs` —— 运行时拦渐变 / 阴影（美术宪法）
         `tools/art-audit.*`     —— 资源总账与预算体检

   为什么值得单独一张表（与 data_elems.ts / data_tiers.ts 同一个理由）：
   改造前"尺寸是 64 还是 96""图标要不要按 2 的幂""这个前缀叫什么"
   散在十几处生成函数里，靠记忆保持一致。而**不一致不会报错**，只会让
   某一类资源悄悄变大（显存）或画出来差半个像素（锚点）。
   ========================================================= */
import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';

var Art = {} as ArtApi;

/* =========================================================
   1. 命名规范：一个前缀 = 一类资源
   ---------------------------------------------------------
   命名规范的真正作用不是"整齐"，而是让**文件名自己说明它是什么**：
   看到一个以 `FX_` 开头的资源，就知道它是特效贴图、会走 additive 混合、
   不进静态层烘焙。前缀与类别是**一一对应**的，`audit()` 会强制这一点。
   ========================================================= */
Art.KINDS = [
  {
    id: 'tileset', prefix: 'TILE_', name: '瓦片集', note: '可拼接的地形小块；自动规则瓦片由它派生',
    atlas: 'world', blend: 'normal', examples: ['TILE_FloorA', 'TILE_Wall_Edge']
  },
  {
    id: 'prop', prefix: 'PROP_', name: '场景物件', note: '树 / 岩石 / 白骨 / 箱子等独立静态物件',
    atlas: 'world', blend: 'normal', examples: ['PROP_Bone', 'PROP_Rock']
  },
  {
    id: 'bg', prefix: 'BG_', name: '背景层', note: '分层视差背景的每一层（远 / 中 / 近）',
    atlas: 'world', blend: 'normal', examples: ['BG_Far', 'BG_Mid']
  },
  {
    id: 'decal', prefix: 'DECAL_', name: '叠加装饰', note: '血迹 / 青苔 / 光斑这类叠在地上的贴图',
    atlas: 'world', blend: 'multiply', examples: ['DECAL_Blood', 'DECAL_Moss']
  },
  {
    id: 'icon', prefix: 'ICON_', name: '图标', note: '道具 / 材料 / 装备 / 词条的小图标',
    atlas: 'ui', blend: 'normal', examples: ['ICON_Bar', 'ICON_Arm']
  },
  {
    id: 'object', prefix: 'OBJ_', name: '交互物件', note: '可拾取物 / 罐子 / 门 / 开关 / 宝箱，含状态图',
    atlas: 'world', blend: 'normal', examples: ['OBJ_Chest', 'OBJ_Door']
  },
  {
    id: 'device', prefix: 'DEV_', name: '器械装置', note: '炮台 / 机关 / 投射物 / 载具的外观',
    atlas: 'world', blend: 'normal', examples: ['DEV_Turret', 'DEV_Bolt']
  },
  {
    id: 'ui', prefix: 'UI_', name: '界面素材', note: '面板 / 控件 / 边框 / 装饰 / 角标',
    atlas: 'ui', blend: 'normal', examples: ['UI_Panel', 'UI_Btn']
  },
  {
    id: 'fx', prefix: 'FX_', name: '特效贴图', note: '爆炸 / 冲击波 / 尾迹 / 光圈的序列帧与单帧',
    atlas: 'fx', blend: 'additive', examples: ['FX_Ring', 'FX_Spark']
  },
  {
    id: 'particle', prefix: 'PT_', name: '粒子贴图', note: '粒子系统直接调用的小图：光点 / 尘埃 / 碎片',
    atlas: 'fx', blend: 'additive', examples: ['PT_Dot', 'PT_Dust']
  },
  {
    id: 'anim', prefix: 'ANIM_', name: '物件动画', note: '非人物件的骨骼 / 序列帧：门开合、旗帜、齿轮',
    atlas: 'world', blend: 'normal', examples: ['ANIM_Gate', 'ANIM_Gear']
  },
  {
    id: 'promo', prefix: 'PROMO_', name: '宣传美术', note: '封面 / 商店页 / 启动页 / Loading 插画',
    atlas: 'none', blend: 'normal', examples: ['PROMO_Cover', 'PROMO_Banner']
  }
];

Art.KIND_BY_ID = (function () {
  var m: Record<string, ArtKindDef> = Object.create(null);
  for (var i = 0; i < Art.KINDS.length; i++) m[Art.KINDS[i].id] = Art.KINDS[i];
  return m;
})();

/** id → 类别定义（认不出的返回 null；读点一律走它） */
Art.kindOf = function (id) { return id ? (Art.KIND_BY_ID[id] || null) : null; };

/** 前缀 → 类别定义（lint 用：从名字反查它该是哪一类） */
Art.KIND_BY_PREFIX = (function () {
  var m: Record<string, ArtKindDef> = Object.create(null);
  for (var i = 0; i < Art.KINDS.length; i++) m[Art.KINDS[i].prefix] = Art.KINDS[i];
  return m;
})();

/** 一个资源名属于哪一类（按前缀判断；认不出的前缀返回 null） */
Art.kindOfName = function (name) {
  var s = String(name || '');
  var cut = s.indexOf('_');
  if (cut <= 0) return null;
  return Art.KIND_BY_PREFIX[s.slice(0, cut + 1)] || null;
};

/* =========================================================
   2. 尺寸规范
   ---------------------------------------------------------
   两条硬约束，分别对应两个真实的代价：

     · `grid` / `tile` = **16** —— 瓦片必须整除绘制网格，否则拼接处会出现
       半像素缝（复古平涂里最刺眼的一种瑕疵）。16 不是随便挑的：
       战场是 `Arena.W × Arena.H` = 1680 × 1260，而 1680 / 16 = 105、
       1260 / 16 = 78.75 —— 后者不整除，所以**外墙的瓦片按 14px 厚、
       格距 16px 摆**（两端的余数吸进外扩里）。这个数字写在这里，
       是因为它同时被 `render.ts`（外墙）与 `art_tiles.ts`（规则）读。
     · `icon` = 32 的**整数倍**口径 —— 图标在商店 / 背包 / 悬浮提示三处
       以三种尺寸出现，非整数倍缩放会让 3px 描边糊成 2px 或 4px，
       而"唯一外轮廓色 3px"是写进美术宪法的硬约束（README）。

   `POW2_*` 是**图集画布**的规范（不是单个资源的规范）：
   贴图缓存把同类资源拼进一张离屏画布，画布尺寸取 2 的幂可以避免
   某些 GPU 上的重采样与 mipmap 退化 —— 在这个项目里它只影响
   `bake` 那一层（设备倍率烘焙），单张资源本身不必是 2 的幂。
   ========================================================= */
Art.SIZES = {
  /** 世界层绘制网格：瓦片与物件的锚点都按它对齐 */
  grid: 16,
  /** 瓦片边长（必须整除 grid） */
  tile: 16,
  /** 外墙用的瓦片格距（= grid；单独给个名字，因为改外墙时会先看它） */
  border: 16,
  /** 图标基准边长（商店 / 背包 / 提示三处都从这里派生） */
  icon: 32,
  /** 静态层烘焙画布的尺寸上限（超过就分片，与"大背景图分片"同一条规矩） */
  bakeMax: 2048,
  /** 图集画布只许取 2 的幂（≥ 这个值） */
  pow2Min: 256,
  pow2Max: 4096,
  /** 单张资源的最大边长：超过它说明该拆图而不是放大 */
  assetMax: 1024
};

/** 尺寸是否落在合规区间（非有限数 / 负数 / 0 都不合规） */
Art.sizeOk = function (w, h) {
  var a = Number(w), b = Number(h);
  if (!isFinite(a) || !isFinite(b) || a <= 0 || b <= 0) return false;
  if (a > Art.SIZES.assetMax || b > Art.SIZES.assetMax) return false;
  return true;
};

/**
 * 瓦片尺寸必须是**绘制网格的整数倍**（含 1 倍）。
 *
 * 为什么不是"整除网格"：那一条在数值上等价（16 的约数里只有 16 与 8…），
 * 但语义反了 —— 瓦片是**网格的整数倍**，于是每一块瓦片都覆盖整数个格子，
 * 拼接处落在格线上。写成"瓦片整除网格"会让 32 的瓦片被判非法，
 * 而 32 只是"粗一档的地砖"（`ruinFloor` 就是）。
 * 「整数倍」与「整除」在这个网格上数值相同、含义相反，这是最容易写错的一条。
 */
Art.tileDivides = function (size) {
  var s = Number(size), g = Art.SIZES.grid;
  return isFinite(s) && s > 0 && Math.abs(s / g - Math.round(s / g)) < 1e-9;
};

/** 2 的幂（图集画布用） */
Art.isPow2 = function (n) {
  var v = Number(n);
  return isFinite(v) && v > 0 && (v & (v - 1)) === 0;
};

/* =========================================================
   3. 锚点规范
   ---------------------------------------------------------
   锚点决定"这个资源以哪里为原点画出去"。它**必须写下来**，
   因为深度排序（`depth.ts` 的层内 y 排序）用的是**脚底**：
   一个以中心为锚点的树，在玩家从它前面走过去时排序是错的。
   ========================================================= */
Art.ANCHORS = [
  { id: 'foot', name: '脚底', note: '物件贴地的位置（默认；深度排序按它）—— 树 / 岩石 / 箱子 / 怪' },
  { id: 'center', name: '中心', note: '与地面无关的东西 —— 图标 / 面板 / 控件 / 特效环' },
  { id: 'top', name: '顶边', note: '从上方垂下来的东西 —— 旗帜 / 藤蔓 / 吊灯' },
  { id: 'tile', name: '格心', note: '瓦片专用：对齐 grid 的格子中心' }
];

Art.ANCHOR_BY_ID = (function () {
  var m: Record<string, ArtAnchorDef> = Object.create(null);
  for (var i = 0; i < Art.ANCHORS.length; i++) m[Art.ANCHORS[i].id] = Art.ANCHORS[i];
  return m;
})();

/** 锚点的归一化偏移（0..1 的画布比例）：`draw2d` 与缓存都用它对齐 */
Art.anchorRatio = function (id) {
  if (id === 'foot') return { x: 0.5, y: 1 };
  if (id === 'top') return { x: 0.5, y: 0 };
  return { x: 0.5, y: 0.5 };      // center / tile
};

/* =========================================================
   4. 图集分组
   ---------------------------------------------------------
   分组的唯一依据是**渲染时会不会被同一次绘制批处理**：
     同组 = 同一张离屏画布 = 一次 blit；
     跨组 = 纹理切换 = 一次 DrawCall 断点。
   所以"按资源种类分组"是错的（图标与面板同属界面），
   "按它在屏幕上出现的场合分组"才是对的。
   ========================================================= */
Art.ATLASES = [
  { id: 'world', name: '世界图集', note: '地形 / 物件 / 器械 / 装饰：同一帧里大量出现，必须同组', maxSize: 2048 },
  { id: 'ui', name: '界面图集', note: '图标 / 面板 / 控件：只在界面状态出现，与世界层不同批', maxSize: 2048 },
  { id: 'fx', name: '特效图集', note: '序列帧 / 粒子：additive 混合，与普通贴图不能同批', maxSize: 1024 }
];

Art.ATLAS_BY_ID = (function () {
  var m: Record<string, ArtAtlasDef> = Object.create(null);
  for (var i = 0; i < Art.ATLASES.length; i++) m[Art.ATLASES[i].id] = Art.ATLASES[i];
  return m;
})();

/* =========================================================
   5. 混合模式（"材质"在 2D 里其实就只有这一件事）
   =========================================================
   切混合模式与切纹理一样会打断绘制批处理，所以它也必须是**声明**：
   一个资源属于哪种混合，由它的类别定，而不是在画的地方各写一次。
   `normal` 用 `source-over`，`additive` 用 `lighter`，
   `multiply` 用 `multiply` —— 恰好是 Canvas 的原生三者。
   ========================================================= */
Art.BLENDS = [
  { id: 'normal', name: '正常', canvas: 'source-over', note: '默认；不透明与正常透明都走它' },
  { id: 'additive', name: '加色', canvas: 'lighter', note: '光 / 火 / 爆炸：叠亮，永远不发暗' },
  { id: 'multiply', name: '正片叠底', canvas: 'multiply', note: '污渍 / 血 / 影：只压暗，不改色相' }
];

Art.BLEND_BY_ID = (function () {
  var m: Record<string, ArtBlendDef> = Object.create(null);
  for (var i = 0; i < Art.BLENDS.length; i++) m[Art.BLENDS[i].id] = Art.BLENDS[i];
  return m;
})();

/** 混合 id → canvas 的 globalCompositeOperation（认不出的回退 normal） */
Art.compositeOf = function (id) {
  var d = Art.BLEND_BY_ID[id];
  return d ? d.canvas : 'source-over';
};

/* =========================================================
   6. 管线：资源从"画法"到"屏幕上一点"要过的六道工序
   ---------------------------------------------------------
   每一道工序都有**唯一的产物形式**与**唯一的检查**。
   这样"某类资源缺了检查"就变成结构性的不可能 ——
   而不是靠人记得。`lintAsset` 把第 ④ 道接了出来。
   ========================================================= */
Art.PIPELINE = [
  { id: 'paint', name: '画法', product: '一段程序化画法（无文件）', check: '美术宪法：不许渐变 / 阴影 / 模糊（运行时拦截，见 render-check）' },
  { id: 'lint', name: '资源检查', product: '通过 / 问题清单', check: 'Art.lintAsset：名称 / 类别 / 尺寸 / 锚点 / 图集 / 混合' },
  { id: 'bake', name: '烘焙', product: '离屏 canvas（含设备倍率）', check: '缓存命中 + 条目/字节有界（见 test/cache.mjs）' },
  { id: 'atlas', name: '图集', product: '按组归拢的绘制批次', check: '同组一次 blit；跨组计一次 DrawCall 断点' },
  { id: 'place', name: '摆放', product: '世界坐标 + 层带 + 层内 y 排序', check: 'depth.ts：层带必须存在，物件锚点必须是 foot' },
  { id: 'draw', name: '合成', product: '屏幕像素', check: '混合模式来自类别声明；每帧绘制数在预算内' }
];

Art.PIPELINE_BY_ID = (function () {
  var m: Record<string, ArtStageDef> = Object.create(null);
  for (var i = 0; i < Art.PIPELINE.length; i++) m[Art.PIPELINE[i].id] = Art.PIPELINE[i];
  return m;
})();

/* =========================================================
   7. 资源检查的判据清单（TA 的"资源检查"那一格）
   ---------------------------------------------------------
   每一条判据都必须**能被一个函数表达**，于是它就能被测试。
   列在这里是为了：`lintAsset` 报出的每一条问题都指得出它是哪条判据。
   ========================================================= */
Art.LINT_RULES = [
  { id: 'name', name: '命名', note: '必须有类别前缀（TILE_/PROP_/…），前缀与声明的类别一致，且不含空格 / 中文 / 大写之外的分隔符' },
  { id: 'kind', name: '类别', note: '类别必须在 KINDS 里，且该类别必须声明了图集与混合模式' },
  { id: 'size', name: '尺寸', note: '宽高有限且 > 0，且不超过 assetMax；瓦片必须整除 grid' },
  { id: 'anchor', name: '锚点', note: '锚点必须在 ANCHORS 里；世界层贴地的物件必须是 foot（深度排序按脚底）' },
  { id: 'atlas', name: '图集', note: '图集必须在 ATLASES 里；宣传美术声明为 none（不进任何图集）' },
  { id: 'blend', name: '混合', note: '混合模式必须在 BLENDS 里，且与类别声明一致（跨组混合会打断批处理）' },
  { id: 'budget', name: '预算', note: '单个图集的资源数不超过预算（超出说明该拆图集而不是继续塞）' }
];

Art.LINT_BY_ID = (function () {
  var m: Record<string, ArtLintRuleDef> = Object.create(null);
  for (var i = 0; i < Art.LINT_RULES.length; i++) m[Art.LINT_RULES[i].id] = Art.LINT_RULES[i];
  return m;
})();

/* =========================================================
   8. 预算（"性能优化"那一格的数字出处）
   ---------------------------------------------------------
   这些数字不是拍脑袋：绘制预算是 60fps 下留出渲染时间的量，
   与 `test/perf.mjs` 的帧预算同源；纹理预算是贴图缓存的字节上限，
   与 `test/cache.mjs` 的断言同源。**两处读同一个数**，才不会
   "工具说没事、测试说有事"。
   ========================================================= */
Art.BUDGET = {
  /** 单帧绘制/blit 数量上限（性能预算的一半，另一半留给刷新逻辑） */
  drawsPerFrame: 1200,
  /** 贴图缓存字节上限（16MB：低端移动端也安全的量级） */
  cacheBytes: 16 * 1024 * 1024,
  /** 一个图集里最多多少条资源（超过就拆图集，而不是无限塞） */
  perAtlas: 256,
  /** 一组序列帧最多多少帧（整段动画的长度上限） */
  framesPerClip: 16
};

/* =========================================================
   9. 一条校验：任何资源声明都过这里
   ---------------------------------------------------------
   返回 `{ ok, problems }`。`problems` 里每一条都会写明**是哪条判据**，
   于是"为什么被拦"不需要再解释一遍。
   ========================================================= */
Art.lintAsset = function (a) {
  var problems: string[] = [];
  if (!a || typeof a !== 'object') return { ok: false, problems: ['资源声明不是对象'] };

  var name = String(a.name || '');
  if (!name) problems.push('[name] 没有名字');

  /* ---- 命名 / 类别 ---- */
  var kind = Art.kindOf(a.kind);
  if (!kind) problems.push('[kind] 类别不认识：' + String(a.kind));
  var byPrefix = Art.kindOfName(name);
  if (!byPrefix) {
    problems.push('[name] 名字没有类别前缀（应为 ' + (kind ? kind.prefix : 'KIND_') + ' 之类）：' + name);
  } else if (kind && byPrefix.id !== kind.id) {
    problems.push('[name] 前缀属于「' + byPrefix.name + '」而声明的是「' + kind.name + '」：' + name);
  }
  if (/[\u4e00-\u9fa5\s]/.test(name)) problems.push('[name] 名字里有中文或空格（跨平台文件名规范）：' + name);
  /* 命名形状：`大写前缀_词`（词可以是 PascalCase，可多段）。
     为什么允许 `PROP_Bone` 而不逼成全大写：前缀负责"这是哪一类"，
     词负责"这是哪一个" —— 词用 PascalCase 才读得出词边界（`PROP_BoneRock`
     一眼两段，`PROP_BONEROCK` 不是）。拦的是"没有前缀""有空格""有中文"
     这类**真的会跨平台出问题**的形状，不是大小写洁癖。 */
  if (name && !/^[A-Z][A-Z0-9]*_[A-Za-z0-9]+(_[A-Za-z0-9]+)*$/.test(name)) {
    problems.push('[name] 名字形状必须是「大写前缀_Pascal词」（如 PROP_Bone / TILE_FloorA）：' + name);
  }

  /* ---- 尺寸 ---- */
  if (!Art.sizeOk(a.w, a.h)) {
    problems.push('[size] 尺寸非法（须为 (0, ' + Art.SIZES.assetMax + '] 内的有限数）：' + a.w + '×' + a.h);
  }
  if (kind && kind.id === 'tileset' && !Art.tileDivides(a.w)) {
    problems.push('[size] 瓦片边长必须是绘制网格 ' + Art.SIZES.grid + ' 的整数倍（否则拼接处落不到格线上）：' + a.w);
  }

  /* ---- 锚点 ---- */
  if (!Art.ANCHOR_BY_ID[a.anchor]) {
    problems.push('[anchor] 锚点不认识：' + String(a.anchor));
  } else if (kind && kind.atlas === 'world' && kind.id !== 'tileset' && kind.id !== 'bg' &&
    kind.id !== 'anim' && a.anchor !== 'foot') {
    /* 世界层的**贴地**物件必须是脚底锚点：深度排序按脚底，
       用中心锚点的树会在玩家从它前面走过时排错。 */
    problems.push('[anchor] 世界层贴地物件的锚点必须是 foot（深度排序按脚底）：' + name + ' → ' + a.anchor);
  }

  /* ---- 图集 / 混合 ---- */
  if (kind) {
    if (kind.atlas !== 'none' && !Art.ATLAS_BY_ID[kind.atlas]) {
      problems.push('[atlas] 类别声明的图集不存在：' + kind.atlas);
    }
    var blend = a.blend === undefined ? (kind ? kind.blend : '') : a.blend;
    if (!Art.BLEND_BY_ID[blend]) problems.push('[blend] 混合模式不认识：' + String(blend));
    else if (kind && blend !== kind.blend) {
      problems.push('[blend] 混合模式与类别声明不一致（跨组混合会打断批处理）：' +
        name + ' → ' + blend + '，类别要求 ' + kind.blend);
    }
  }
  return { ok: problems.length === 0, problems: problems };
};

/* =========================================================
   10. 总账体检：规范自身对不对（与资源无关的那一半）
   ========================================================= */
Art.audit = function () {
  var problems: string[] = [];

  /* ---- 前缀 / 类别一一对应 ---- */
  var seenPrefix: Record<string, string> = Object.create(null);
  var seenId: Record<string, boolean> = Object.create(null);
  for (var i = 0; i < Art.KINDS.length; i++) {
    var d = Art.KINDS[i];
    if (!d.id) problems.push('第 ' + i + ' 个类别没有 id');
    if (seenId[d.id]) problems.push('类别 id 重复：' + d.id);
    seenId[d.id] = true;
    if (!d.prefix || d.prefix.indexOf('_') < 0) problems.push(d.id + ' 的前缀不合规（应为 XXX_）：' + d.prefix);
    if (seenPrefix[d.prefix]) {
      problems.push('同一个前缀被两个类别占用：' + d.prefix + '（' + seenPrefix[d.prefix] + ' / ' + d.id + '）');
    }
    seenPrefix[d.prefix] = d.id;
    if (!d.name || !d.note) problems.push(d.id + ' 缺少名字或说明（界面与文档要显示它）');
    if (!Art.ATLAS_BY_ID[d.atlas] && d.atlas !== 'none') problems.push(d.id + ' 声明的图集不存在：' + d.atlas);
    if (!Art.BLEND_BY_ID[d.blend]) problems.push(d.id + ' 声明的混合模式不存在：' + d.blend);
    if (!d.examples || !d.examples.length) problems.push(d.id + ' 没有给命名示例（规范不举例等于没写）');
    /* 示例必须真的过 lint —— 规范自己写错示例是最容易发生的一件事 */
    for (var e = 0; e < (d.examples || []).length; e++) {
      var v = Art.lintAsset({ name: d.examples[e], kind: d.id, w: Art.SIZES.tile, h: Art.SIZES.tile, anchor: Art.anchorFor(d.id) });
      if (!v.ok) problems.push('示例名过不了自己的检查：' + d.examples[e] + ' → ' + v.problems.join(' / '));
    }
  }
  if (Art.KINDS.length < 8) problems.push('类别少于 8 种：一套 2D 资源体系至少覆盖 地形/物件/背景/装饰/图标/交互/器械/界面/特效/粒子/动画');

  /* ---- 每一类都必须被"资源检查"覆盖 ---- */
  for (var k = 0; k < Art.KINDS.length; k++) {
    var kk = Art.KINDS[k];
    if (!kk.atlas || !kk.blend || !kk.prefix) problems.push(kk.id + ' 的分类不完整（前缀 / 图集 / 混合三样都要有）');
  }

  /* ---- 图集 ---- */
  var seenAtlas: Record<string, boolean> = Object.create(null);
  for (var a = 0; a < Art.ATLASES.length; a++) {
    var at = Art.ATLASES[a];
    if (seenAtlas[at.id]) problems.push('图集 id 重复：' + at.id);
    seenAtlas[at.id] = true;
    if (!Art.isPow2(at.maxSize)) problems.push(at.id + ' 的尺寸上限不是 2 的幂：' + at.maxSize);
    if (at.maxSize > Art.SIZES.pow2Max) problems.push(at.id + ' 的尺寸上限超过规范上限 ' + Art.SIZES.pow2Max);
    if (!at.name || !at.note) problems.push(at.id + ' 缺少名字或说明');
  }
  /* 每个图集至少要被一个类别用到（空图集 = 白占一个绘制批次） */
  for (var t = 0; t < Art.ATLASES.length; t++) {
    var used = false;
    for (var z = 0; z < Art.KINDS.length; z++) if (Art.KINDS[z].atlas === Art.ATLASES[t].id) used = true;
    if (!used) problems.push('图集没有任何类别在用（白占一个绘制批次）：' + Art.ATLASES[t].id);
  }

  /* ---- 混合 / 锚点 ---- */
  for (var b = 0; b < Art.BLENDS.length; b++) {
    if (!Art.BLENDS[b].canvas) problems.push(Art.BLENDS[b].id + ' 没有对应的 canvas 合成模式');
  }
  var seenBlend: Record<string, boolean> = Object.create(null);
  for (var b2 = 0; b2 < Art.BLENDS.length; b2++) {
    if (seenBlend[Art.BLENDS[b2].id]) problems.push('混合 id 重复：' + Art.BLENDS[b2].id);
    seenBlend[Art.BLENDS[b2].id] = true;
  }
  for (var an = 0; an < Art.ANCHORS.length; an++) {
    if (!Art.ANCHORS[an].name || !Art.ANCHORS[an].note) problems.push(Art.ANCHORS[an].id + ' 缺少名字或说明');
  }
  if (!Art.ANCHORS.length) problems.push('没有任何锚点：贴图不知道该以哪里为原点');

  /* ---- 管线：顺序固定、每道都有产物与检查 ---- */
  var order = ['paint', 'lint', 'bake', 'atlas', 'place', 'draw'];
  for (var p = 0; p < order.length; p++) {
    var st = Art.PIPELINE[p];
    if (!st || st.id !== order[p]) problems.push('管线第 ' + (p + 1) + ' 道应当是 ' + order[p]);
    else if (!st.product || !st.check) problems.push(st.id + ' 缺少产物形式或检查（有了检查才叫工序）');
  }
  if (Art.PIPELINE.length !== order.length) problems.push('管线道数与规范不符：' + Art.PIPELINE.length);

  /* ---- 检查判据：每条都要有说明，且 lintAsset 真的会用到它 ---- */
  var usedRule: Record<string, boolean> = Object.create(null);
  /* 把规范自身当资源过一遍 lint，看看哪几条判据真的会被触发（至少能被触发） */
  var probe = Art.lintAsset({ name: 'BAD name', kind: 'nope', w: 0, h: -1, anchor: 'nope' });
  for (var pr = 0; pr < probe.problems.length; pr++) {
    var mm = /^\[(\w+)\]/.exec(probe.problems[pr]);
    if (mm) usedRule[mm[1]] = true;
  }
  /* 这一探针必然触发这五条；其余判据由"示例名必须过 lint"与各资源表在使用中覆盖 */
  var mustUse = ['name', 'kind', 'size', 'anchor'];
  for (var m2 = 0; m2 < mustUse.length; m2++) {
    if (!usedRule[mustUse[m2]]) problems.push('判据「' + mustUse[m2] + '」在 lintAsset 里没有出口');
  }
  for (var r = 0; r < Art.LINT_RULES.length; r++) {
    if (!Art.LINT_RULES[r].name || !Art.LINT_RULES[r].note) problems.push(Art.LINT_RULES[r].id + ' 缺少名字或说明');
    if (!Art.LINT_BY_ID[Art.LINT_RULES[r].id]) problems.push('判据表自相矛盾：' + Art.LINT_RULES[r].id);
  }
  if (Art.LINT_RULES.length < 6) problems.push('资源检查的判据少于 6 条：命名/类别/尺寸/锚点/图集/混合/预算是最低要求');

  /* ---- 尺寸规范自洽 ---- */
  if (!Art.tileDivides(Art.SIZES.tile)) problems.push('瓦片尺寸不是绘制网格的整数倍：' + Art.SIZES.tile + ' vs ' + Art.SIZES.grid);
  if (Art.SIZES.icon % Art.SIZES.tile !== 0 && Art.SIZES.tile % Art.SIZES.icon !== 0) {
    problems.push('图标基准与瓦片基准互不整除（三处缩放会糊掉 3px 描边）');
  }
  if (!Art.isPow2(Art.SIZES.pow2Min) || !Art.isPow2(Art.SIZES.pow2Max)) problems.push('图集尺寸区间不是 2 的幂');
  if (Art.SIZES.pow2Min > Art.SIZES.pow2Max) problems.push('图集尺寸区间反了');
  if (Art.SIZES.bakeMax > Art.SIZES.pow2Max) problems.push('烘焙画布上限超过图集上限（分片规则会失效）');

  /* ---- 预算 ---- */
  if (!(Art.BUDGET.drawsPerFrame > 0)) problems.push('绘制预算必须是正数');
  if (!(Art.BUDGET.cacheBytes > 0)) problems.push('纹理预算必须是正数');
  if (!(Art.BUDGET.perAtlas > 0)) problems.push('图集条目预算必须是正数');
  if (!(Art.BUDGET.framesPerClip > 0)) problems.push('序列帧长度预算必须是正数');

  /* ---- 资源归属：规范里有几类，就必须说清"谁做"或"为什么不做" ----
     这一条**故意不放在加载时**（各生产模块的登记在它们自己加载时才发生），
     它由 `pnpm run art` 与 `test/art.mjs` 在**全部模块加载完之后**调用。
     加载时那一跑会看到 `owners: 0`，那是正常的 —— 不是"没人做"。 */
  if (Art.requireOwners) {
    var missing = Art.missingKinds();
    if (missing.length) {
      problems.push('这些类别既没有生产模块、也没有登记"推迟做"的理由：' + missing.join(', '));
    }
    for (var dk = 0; dk < Art.DEFERRED.length; dk++) {
      var df = Art.DEFERRED[dk];
      if (!Art.kindOf(df.kind)) problems.push('推迟清单里有一个不存在的类别：' + df.kind);
      else if (!df.why) problems.push(df.kind + ' 登记了推迟，但没有写理由');
      else if (Art.ownersOf(df.kind).length) {
        problems.push(df.kind + ' 已经在推迟清单里，却已经有模块在生产它（' + Art.ownersOf(df.kind).join(',') + '）—— 该从推迟清单里拿掉');
      }
    }
  }

  /* ---- 汇总：类别里的资源数（由各资源表登记，见 Art.noteOwner） ---- */
  return {
    ok: problems.length === 0, problems: problems,
    counts: {
      kinds: Art.KINDS.length, atlases: Art.ATLASES.length, blends: Art.BLENDS.length,
      anchors: Art.ANCHORS.length, stages: Art.PIPELINE.length, rules: Art.LINT_RULES.length,
      owners: Object.keys(Art.OWNERS).length,
      unowned: Art.unownedKinds().length
    }
  };
};

/** 是否把"资源归属"算进自检。加载时的那一跑不算（生产模块还没登记），
 *  `test/art.mjs` 与 `pnpm run art` 会打开它再跑一次。 */
Art.requireOwners = false;

/** 类别 → 给"世界层贴地物件"派的锚点（示例与默认值用） */
Art.anchorFor = function (kindId) {
  var k = Art.kindOf(kindId);
  if (!k) return 'center';
  if (k.id === 'tileset') return 'tile';
  if (k.atlas === 'world' && k.id !== 'bg' && k.id !== 'anim') return 'foot';
  return 'center';
};

/* =========================================================
   11. 资源归属：谁生产了哪一类资源
   ---------------------------------------------------------
   "规范"与"内容"之间需要一个**连接点**，否则规范只是文档。
   每个资源表在加载时登记自己产出的类别，`Art.audit()` 于是能回答
   "哪一类资源一个生产模块都没有" —— 那正是漏做的一类。
   ========================================================= */
Art.OWNERS = Object.create(null) as Record<string, string[]>;

/**
 * 登记"本模块产出这一类资源"。
 * @param kind 类别 id（必须在 KINDS 里）
 * @param owner 模块名（如 'sprites.ts'）
 */
Art.noteOwner = function (kind, owner) {
  var k = Art.kindOf(kind);
  if (!k) throw new Error('art_spec: 未知类别 ' + kind);
  if (!Art.OWNERS[kind]) Art.OWNERS[kind] = [];
  if (Art.OWNERS[kind].indexOf(owner) < 0) Art.OWNERS[kind].push(owner);
  return k;
};

/** 某一类资源的生产模块（可能多个；空数组 = 这一类没人生产） */
Art.ownersOf = function (kind) { return (Art.OWNERS[kind] || []).slice(); };

/** 没有任何生产模块的类别（= 规范里写了、项目里没做） */
Art.unownedKinds = function () {
  var out: string[] = [];
  for (var i = 0; i < Art.KINDS.length; i++) {
    if (!Art.ownersOf(Art.KINDS[i].id).length) out.push(Art.KINDS[i].id);
  }
  return out;
};

/* =========================================================
   11b. 明确推迟的类别
   ---------------------------------------------------------
   规范是"一类游戏需要的全部资源"。这个项目**不必**每一类都做 ——
   但它必须知道**哪几类没做、为什么**。
   不写下来就会发生两种烂事：① 有人以为做了；② 有人做了却没人知道该登记。
   所以"没做"是一种**登记过的状态**，而不是沉默。

   **现在是空的**：12 类全部有主（`pnpm run art` 会打印"在做 12 类"）。
   这张表留着，因为它是"沉默 = 漏做"这条规矩的落点 ——
   机制在、数据空，与"数据在、机制没做"是两件完全不同的事。
   ========================================================= */
Art.DEFERRED = [];

Art.DEFERRED_BY_KIND = (function () {
  var m: Record<string, ArtDeferredDef> = Object.create(null);
  for (var i = 0; i < Art.DEFERRED.length; i++) m[Art.DEFERRED[i].kind] = Art.DEFERRED[i];
  return m;
})();

/** 还没做、也没有登记理由的类别（= 真的漏了） */
Art.missingKinds = function () {
  var out: string[] = [];
  var un = Art.unownedKinds();
  for (var i = 0; i < un.length; i++) if (!Art.DEFERRED_BY_KIND[un[i]]) out.push(un[i]);
  return out;
};

var verdict = Art.audit();
if (!verdict.ok) throw new Error('art_spec.ts 美术规范自检失败：\n' + verdict.problems.join('\n'));
SelfCheck.register('Art', Art.audit);

/* 登记到扩展点总账：别的表要引用"美术类别 / 图集 / 混合 / 锚点"时走这四个家族，
   写错一个名字会被启动期自检当场抓住（与 element / weaponKind 同一个套路）。 */
Registry.family('artKind', {
  note: '美术资源类别（前缀 = 类别；命名规范的唯一出处）', owner: 'art_spec.ts',
  entries: function () {
    return Art.KINDS.map(function (d) { return { id: d.id, refs: [] }; });
  }
});
Registry.family('artAtlas', {
  note: '图集分组（同组一次 blit；跨组一次 DrawCall 断点）', owner: 'art_spec.ts',
  values: function () { return Art.ATLASES.map(function (d) { return d.id; }); }
});
Registry.family('artBlend', {
  note: '混合模式（等同于 2D 的"材质"）', owner: 'art_spec.ts',
  values: function () { return Art.BLENDS.map(function (d) { return d.id; }); }
});
Registry.family('artAnchor', {
  note: '锚点（深度排序按脚底；写错的表现是排序错而不是报错）', owner: 'art_spec.ts',
  values: function () { return Art.ANCHORS.map(function (d) { return d.id; }); }
});
Registry.family('artStage', {
  note: '资源管线工序（顺序固定：画法→检查→烘焙→图集→摆放→合成）', owner: 'art_spec.ts',
  values: function () { return Art.PIPELINE.map(function (d) { return d.id; }); }
});

export { Art };
/* 说明：这里**没有** `Registry.uses('kind', 'artKind')` 这类字段→家族声明。
   理由：那四句的语义是"**某张数据表里有一个叫 `kind` 的字段，它的取值域是这个家族**"，
   而此刻项目的资源表还各自用自己的词（`sprites.ts` 用 `shape`、`dungeon.ts` 用 `themeProp`）——
   给一个不存在的字段登记取值域，正是 `tools/arch-audit.cjs` 第 [9] 节要抓的那种"声明了却没人用"。
   等各资源表迁到这份规范上（`kind` / `anchor` / `atlas` / `blend` 四个字段真的出现），
   那四句就该补在这里。规范已经通过 `Art.lintAsset` 被**闭包检查**（见 §9/§10），
   所以此刻它不是文档，是一条在用着的校验。 */
