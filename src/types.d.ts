/* =========================================================
   types.d.ts — 跨文件共享的类型契约（纯类型，无运行期内容）
   模块之间靠 import / export 互相引用，所以这里不再需要
   "把全局对象声明成变量"那一套（原 globals.d.ts 里的 20 个 declare var）。
   实体与数据仍然用接口描述 —— 这是迁移里最值钱的部分：
   字段拼错、把包装对象当 canvas 传、往已删除的字段上赋值，
   都会在编译期直接报错。
   ========================================================= */

/* ---------------- 属性 ---------------- */
type StatKey =
  | 'maxHp' | 'hpRegen' | 'lifesteal' | 'damage' | 'meleeDmg' | 'rangedDmg'
  | 'elementalDmg' | 'attackSpeed' | 'critChance' | 'armor' | 'dodge' | 'speed'
  | 'luck' | 'harvesting' | 'pickupRange' | 'range' | 'engineering'
  | 'consumable' | 'regen' | 'knockbackBonus';

/** 属性表：已知键被检查，同时允许动态下标访问 */
interface StatMap {
  [key: string]: number;
  maxHp: number; hpRegen: number; lifesteal: number; damage: number;
  meleeDmg: number; rangedDmg: number; elementalDmg: number; attackSpeed: number;
  critChance: number; armor: number; dodge: number; speed: number; luck: number;
  harvesting: number; pickupRange: number; range: number; engineering: number;
  consumable: number; regen: number; knockbackBonus: number;
}

interface StatDef {
  label: string; short: string; def: number;
  kind: 'flat' | 'pct'; icon?: string; per?: string;
}

interface StatLine {
  key: string; value: number; text: string; good: boolean; label: string;
}

/* ---------------- 数据定义 ---------------- */
/** 品级表的一行（data_tiers.ts）：档位、名字、界面 class、解锁波次、合成台阶 */
interface TierRow {
  tier: number; name: string; cls: string; wave: number;
  dmg: number; cd: number; knock: number; reach: number; pierce: number;
}
interface TiersApi {
  /** 一行一档（T1…T5），顺序即档位顺序 */
  LIST: TierRow[];
  BY: Record<number, TierRow>;
  /** 档位总数（从此不再有第二个"4"）。合成上限就是它 */
  MAX: number;
  clamp(t: unknown): number;
  rowOf(t: unknown): TierRow;
  nameOf(t: unknown): string;
  clsOf(t: unknown): string;
  /** 这一波随机池（商店/宝箱/道具包）最高能给到哪一档 */
  capFor(wave: number): number;
  /** 一批候选里**实际存在**的最高档（商店权重按它算，见 Tiers.topOf 注释） */
  topOf(list: Array<{ tier?: number }>, cap?: number): number;
  audit(): { ok: boolean; problems: string[]; counts: { tiers: number; top: number } };
}

interface WeaponDef {
  id: string; name: string; en?: string; tier: number;
  type: 'melee' | 'ranged'; price: number; basePrice?: number;
  dmg: number; cd: number; reach: number;
  arc?: number; knock?: number; kb?: number;
  speed?: number; pierce?: number; shots?: number; spread?: number;
  life?: number; blast?: number; kind: string; tints?: string[];
  icon?: string; desc?: string; element?: string; engineering?: boolean;
  /** 词条标签（`affixes.ts` 的 TAGS：engineering / heavy …）。
      从**武器表**读而不是从 `type` / `engineering` 推断：推断会让
      "这把武器有什么标签"变成要读代码才知道的事。 */
  tags?: string[];
}

/* =========================================================
   数值曲线（curves.ts）
   ---------------------------------------------------------
   一条曲线 = **形状**（`shape`，决定手感）+ **常量**（`p`，决定多长）。
   形状与常量分开，是为了让"换一种曲线"变成改一行声明，而不是去找公式里的常数。
   ========================================================= */
interface CurveDef {
  /** `<域>.<量>`（`enemy.hp` / `player.xp` / `spawn.budget`） */
  id: string;
  /** enemy = 怪物侧 · player = 角色侧 · spawn = 刷怪节奏 */
  domain: string;
  /** 单位（`倍率` / `经验` / `秒/只`）—— "×3.2"与"3.2 秒"是两回事 */
  unit: string;
  /** 形状名（必须登记在 `Curves.SHAPES` 里） */
  shape: string;
  /** 形状要的常量（键名由形状的 `params` 决定；`piecewise` 用 `at` / `values` 两个数组） */
  p: CurveParams;
  /** 它在回答哪个设计问题（没有 why 的曲线不该存在） */
  why: string;
  /** 自变量的下限（默认 1：房间号从 1 起）。**夹取只在 Curves.at 里做一次** */
  tMin: number;
}

/** 形状的常量：标量（`a` / `b` / `cap` …）与 `piecewise` 的两个数组 */
interface CurveParams {
  [key: string]: number | number[] | undefined;
}

interface CurveShapeDef {
  /** 这个形状需要哪些常量（按名字） */
  params: string[];
  note: string;
  /** 求值：`t` 已经从 `origin` 起算 */
  eval(t: number, p: CurveParams): number;
}

interface CurveRow { t: number; value: number; delta: number; ratio: number; }

interface CurvesApi {
  LIST: CurveDef[];
  BY_ID: Record<string, CurveDef>;
  SHAPES: Record<string, CurveShapeDef>;
  /** 求值：`t` 是原始自变量（房间号），`origin` 会自动减掉。可临时覆盖常量（实验用） */
  at(id: string, t: number, overrides?: CurveParams): number;
  shapeOf(id: string): string;
  paramsOf(id: string): CurveParams;
  /** 把一条曲线摊成里程碑表（形状对不对，要看值不能看公式） */
  table(id: string, points?: number[]): { id: string; shape: string; unit: string; why: string; params: CurveParams; rows: CurveRow[] } | null;
  /** **两边的对照表**：在给定的房间刻度上同时给出怪物侧与玩家侧的值 */
  checkpoint(points?: number[]): Array<{
    room: number; enemyHp: number; enemyDmg: number; enemySpeed: number;
    budget: number; eliteChance: number; xpToLevel: number; xpCumulative: number;
  }>;
  audit(): { ok: boolean; problems: string[]; counts: { curves: number; shapes: number; domains: number; legacy: number } };
}

/* =========================================================
   分层视差背景 + 状态动画（art_parallax.ts）
   ---------------------------------------------------------
   两样东西回答同一个问题："这一层在动，但它不参与玩法"。
   动的方式只有两种：跟着镜头动（视差）或跟着时间动（动画）。
   ========================================================= */
interface ParallaxLayerDef {
  id: string;
  name: string;
  /** 越远越大（1 = 最近）；必须与 `rate` 同向 */
  depth: number;
  /** 跟镜头的比例，必须严格落在 (0,1)；相邻层差 ≥ 0.05 */
  rate: number;
  /** 内容在世界坐标里重复的周期（像素） */
  repeat: number;
  note: string;
  /** 这一层画几道起伏 */
  bands: number;
}

/** 摊开之后的一份副本 */
interface ParallaxItem {
  layer: string; copy: number; x: number; y: number; seed: number; /** 0..1 的装饰性抖动 */ flick: number;
}

interface AnimKey { t: number; v: number; }

interface AnimClipDef {
  id: string;
  name: string;
  /** 作用在什么物件上（门 / 宝箱 / 神龛 / 断柱） */
  subject: string;
  /** 秒 */
  duration: number;
  note: string;
  keys: AnimKey[];
  /** 循环播放（持续旋转那种） */
  loop?: boolean;
}

interface ArtParallaxApi {
  LAYERS: ParallaxLayerDef[];
  BY_ID: Record<string, ParallaxLayerDef>;
  get(id: string): ParallaxLayerDef | null;
  /** 纯函数：镜头平移 → 这一层的偏移 */
  offsetOf(layerOrId: string | ParallaxLayerDef, camX: number, camY: number,
    viewW: number, viewH: number, arenaW: number, arenaH: number): { x: number; y: number };
  /** **算出来的**副本份数（少一份的表现是"走到某个角落背景断了"） */
  copiesOf(layerOrId: string | ParallaxLayerDef, viewW: number, viewH: number, arenaW: number, arenaH: number): number;
  /** 摊成绘制清单 */
  layout(layerOrId: string | ParallaxLayerDef, camX: number, camY: number, viewW: number, viewH: number,
    arenaW: number, arenaH: number, tick?: number): ParallaxItem[];
  /** 档位 → 稳定种子（同一份副本永远同一个值） */
  hashSeed(key: string, k: number): number;
  CLIPS: AnimClipDef[];
  CLIP_BY_ID: Record<string, AnimClipDef>;
  clip(id: string): AnimClipDef | null;
  /** 在进度 `t`（0..1）处取样 */
  sample(clipOrId: string | AnimClipDef, t: number): number;
  /** `elapsed` 秒 → 进度 0..1（`loop` 的取小数部分） */
  progress(clipOrId: string | AnimClipDef, elapsed: number): number;
  /** 读点走这一个：`elapsed` 秒之后这条 clip 到哪了 */
  valueAt(clipOrId: string | AnimClipDef, elapsed: number): number;
  audit(): { ok: boolean; problems: string[]; counts: { layers: number; clips: number; keys: number } };
}

/* =========================================================
   2D 着色器（art_shaders.ts）
   ---------------------------------------------------------
   一条 shader = 一串**可组合的合成步骤**（over / in / atop / add）。
   Canvas2D 没有 fragment shader，但"逐像素替换"这件事这四个合成模式
   已经能表达 —— 于是效果是数据，不是每个生成函数里的一个分支。
   ========================================================= */
interface ArtShaderOpDef { id: string; name: string; /** canvas 的 `globalCompositeOperation` */ canvas: string; note: string; }

interface ArtShaderStep {
  /** 合成操作 id（必须登记在 `ArtShaders.OPS` 里） */
  op: string;
  /** 声明式动作：`fill`/`ring`/`border`/`mask`/`offset`/`alpha` */
  paint: Record<string, string | number>;
}

interface ArtShaderDef {
  id: string;
  name: string;
  /** `sprite` = 作用于一张贴图；`screen` = 作用于整屏 */
  kind: 'sprite' | 'screen';
  /** 这条 shader 的主合成操作（步骤各自还有自己的） */
  op: string;
  note: string;
  /** 为什么需要它（没有理由的效果不该进库） */
  why: string;
  /** 参数名清单（步骤里引用的名字必须在这里） */
  params: string[];
  steps: ArtShaderStep[];
}

/** "这条效果先留着，等某个玩法出现再接"的登记 */
interface ArtShaderReservedDef { id: string; why: string; }

interface ArtShadersApi {
  OPS: ArtShaderOpDef[];
  OP_BY_ID: Record<string, ArtShaderOpDef>;
  canvasOp(id: string): string;
  LIST: ArtShaderDef[];
  BY_ID: Record<string, ArtShaderDef>;
  get(id: string): ArtShaderDef | null;
  /** 执行一条 shader（只翻译声明，不认识任何具体效果） */
  paint(x: any, id: string, w: number, h: number, p?: Record<string, unknown>): boolean;
  line(id: string): string;
  lineAll(): string[];
  /** shader id → 使用它的模块名 */
  USED_BY: Record<string, string[]>;
  noteUse(id: string, owner: string): boolean;
  usersOf(id: string): string[];
  /** 声明了却没有使用方的 shader（= 写着好玩的效果） */
  unused(): string[];
  /** 登记为"备用"的效果（没接线，但说清了等什么条件才用） */
  RESERVED: ArtShaderReservedDef[];
  RESERVED_BY_ID: Record<string, ArtShaderReservedDef>;
  /** 既没接线、也没登记为备用的 shader（= 真的漏了） */
  missingWiring(): string[];
  /** 是否把"接线状态"算进自检（加载时不算；测试与工具会打开） */
  requireWiring: boolean;
  audit(): {
    ok: boolean; problems: string[];
    counts: { shaders: number; ops: number; sprite: number; screen: number; used: number; reserved: number };
  };
}

/* =========================================================
   瓦片与自动规则瓦片（art_tiles.ts）
   ---------------------------------------------------------
   4 位掩码（上右下左）→ 16 种组合 → 一个瓦片 id。
   `mask` 表必须 16 格填满，且每格的形状要与掩码对得上 ——
   对不上的表现是"转角画成了直段"（只是有点怪，不报错）。
   ========================================================= */
interface ArtTileDef {
  /** 瓦片 id（**跨瓦片集唯一**：绘制分支按它分派） */
  id: string;
  /** 形状 id（必须登记在 `ArtTiles.SHAPES` 里；且必须与 mask 推出的形状一致） */
  shape: string;
  note: string;
}

interface ArtTilesetDef {
  id: string;
  name: string;
  note: string;
  /** 必须整除 `Art.SIZES.grid`，且与 `Art.SIZES.tile` 一致 */
  tileSize: number;
  tiles: ArtTileDef[];
  /** mask(0..15) → 瓦片 id；**必须 16 格填满** */
  mask: string[];
  /** 画法参数：只声明"结构"（色由环境给） */
  art: { edgeInset: number; bevel: boolean; seam: boolean };
  /** 生产这一套的模块（规范 → 内容的那条线） */
  owner: string;
}

/** 自动规则瓦片算出来的一格 */
interface ArtCell { x: number; y: number; gx: number; gy: number; mask: number; shape: string; tile: string; }

interface ArtShapeDef { id: string; name: string; note: string; }

interface ArtTilesApi {
  /** 方向顺序（上右下左，与 `Dungeon.DIRS` 同序） */
  DIRS: string[];
  BIT: Record<string, number>;
  BIT_OF_DIR: Record<string, number>;
  MASK_ALL: number;
  /** `[dx, dy]`，与 `DIRS` 同序 */
  OFFSETS: number[][];
  maskLabel(mask: number): string;
  SHAPES: ArtShapeDef[];
  SHAPE_BY_ID: Record<string, ArtShapeDef>;
  /** 16 格：mask → 形状 id */
  SHAPE_OF_MASK: string[];
  shapeOfMask(mask: number): string;
  TILESETS: ArtTilesetDef[];
  BY_ID: Record<string, ArtTilesetDef>;
  get(id: string): ArtTilesetDef | null;
  /** 某一格是不是本瓦片集的地形（越界 = 不是，于是边界自动收口） */
  solidAt(grid: number[][], x: number, y: number): boolean;
  /** 某一格的四邻掩码 */
  maskAt(grid: number[][], x: number, y: number): number;
  /** mask → 瓦片 id（规则表缺这一格时返回 ''） */
  tileFor(ts: ArtTilesetDef, mask: number): string;
  /** 纯函数：地形网格 → 绘制清单（`x/y` 已经是像素） */
  autotile(setOrId: string | ArtTilesetDef, grid: number[][], originX?: number, originY?: number): {
    set: ArtTilesetDef | null; tileSize: number; cells: ArtCell[]; counts: Record<string, number>;
  };
  blankGrid(w: number, h: number): number[][];
  fillRect(grid: number[][], x0: number, y0: number, x1: number, y1: number, v?: number): number[][];
  scatterBlobs(grid: number[][], w: number, h: number, count: number, rnd: () => number, sizeMin?: number, sizeMax?: number): number[][];
  audit(): { ok: boolean; problems: string[]; counts: { sets: number; shapes: number; tiles: number } };
}

/* =========================================================
   运行时错误兜底（crash.ts）
   ---------------------------------------------------------
   与"启动自检失败页"分开：那张是"代码里的表错了"（给开发者），
   这张是"跑着跑着出了意外"（给玩家）。
   ========================================================= */
interface CrashApi {
  /** 已经弹过卡片了吗（**只报一次**的门） */
  shown: boolean;
  /** 接过全局错误源了吗（重复接会让同一个错误走两遍） */
  hooked: boolean;
  /** 一共报过几次（连环抛时用它判断"是不是在刷屏"） */
  count: number;
  /** 最后一次的错误摘要 */
  last: string;
  /** 组装提示语（**纯函数**，测试不必碰 DOM） */
  describe(err: any, from: string): string;
  /** 报一次运行时错误；返回是否**新**弹了一张卡 */
  report(err: any, from: string): boolean;
  /** 接上 `error` 与 `unhandledrejection`；只接一次；无窗口时什么都不做 */
  hook(win?: any): boolean;
  reset(): boolean;
}

/* =========================================================
   背景音乐（music.ts）
   ---------------------------------------------------------
   音效是"事件驱动的一次性声音"，音乐是"状态驱动的持续层" ——
   生命周期与混音位置都不同，所以是独立的一层。
   没有音频素材也可以有音乐：按和弦 + 琶音 + 打击三层把它**算出来**。
   ========================================================= */
interface MusicLayerDef {
  /** 波形（`triangle` / `square` / `sawtooth`）；打击层不需要 */
  wave?: string;
  /** 这一层在混音里的增益（0 = 这一层不响） */
  gain: number;
  /** 16 格（一个十六分音符一格）：`-1` = 休止符，其它 = 半音偏移 */
  steps: number[];
}

interface MusicTrackDef {
  id: string;
  name: string;
  /** 它在说一句什么话（说不出场合的曲子不该进表） */
  note: string;
  bpm: number;
  /** 主音频率（半音偏移都相对它算） */
  root: number;
  /** 循环长度（小节数） */
  bars: number;
  gain: number;
  /** 结算那类**不循环**（放完就停） */
  loop?: boolean;
  layers: { bass: MusicLayerDef; arp: MusicLayerDef; perc: MusicLayerDef };
}

interface MusicApi {
  /** 小调五声：任意两音同响都不难听，所以"随机取几个音做琶音"不会出错 */
  SCALE: number[];
  freq(root: number, semis: number): number;
  TRACKS: MusicTrackDef[];
  BY_ID: Record<string, MusicTrackDef>;
  get(id: string): MusicTrackDef | null;
  /** 场景 → 曲目（空串 = 这个场景不放；**每个场景都要有一条**） */
  SCENE_TRACK: Record<string, string>;
  forScene(scene: string): string;
  /** 战斗那条的强度档：0 / 1 / 2 */
  intensityFor(wave: number, floor: number, boss: boolean): number;
  current: string;
  intensity: number;
  timer: any;
  step: number;
  enabled: boolean;
  stepDur(track: MusicTrackDef): number;
  schedule(ctx: any): void;
  tone(at: number, freq: number, dur: number, wave: string, peak: number, dest: any): void;
  hit(at: number, kind: string, peak: number, dest: any): void;
  /** 放一条曲子（同一首不重启） */
  play(id: string): boolean;
  stop(): boolean;
  /** **唯一的换曲入口**：按场景 + 强度决定放什么 */
  update(scene: string, intensity?: number): boolean;
  setEnabled(on: boolean): boolean;
  audit(): { ok: boolean; problems: string[]; counts: { tracks: number; scenes: number; layers: number } };
}

/* =========================================================
   美术规范（art_spec.ts）
   ---------------------------------------------------------
   TA 的那一半：命名 / 尺寸 / 图集 / 混合 / 锚点 / 管线 / 检查判据。
   这个项目**没有一张图片文件**（全部程序化绘制），所以"资源"的中间产物
   是离屏 canvas，而规范与检查与真实项目一一对应。
   ========================================================= */
interface ArtKindDef {
  id: string;
  /** 命名前缀（一个前缀只属于一个类别；`audit()` 强制一一对应） */
  prefix: string;
  name: string;
  note: string;
  /** 进哪个图集（`none` = 不进任何图集） */
  atlas: string;
  /** 默认混合模式（资源的 `blend` 写了就必须与它一致） */
  blend: string;
  /** 命名示例（规范不举例等于没写；示例本身必须过 `lintAsset`） */
  examples: string[];
}

interface ArtAtlasDef { id: string; name: string; note: string; /** 必须是 2 的幂，且 ≤ `SIZES.pow2Max` */ maxSize: number; }

interface ArtBlendDef { id: string; name: string; /** canvas 的 `globalCompositeOperation` */ canvas: string; note: string; }

interface ArtAnchorDef { id: string; name: string; note: string; }

interface ArtStageDef { id: string; name: string; product: string; check: string; }

interface ArtLintRuleDef { id: string; name: string; note: string; }

/** 一条美术资源的声明（各资源表用它过 `lintAsset`） */
interface ArtAssetDecl {
  /** 资源名：必须带类别前缀（`TILE_` / `PROP_` / `FX_` …） */
  name: string;
  /** 类别 id（必须登记在 `Art.KINDS` 里） */
  kind: string;
  w: number;
  h: number;
  /** 锚点 id（必须登记在 `Art.ANCHORS` 里；世界层贴地物件必须是 `foot`） */
  anchor: string;
  /** 可选：写了就必须与类别声明的混合模式一致 */
  blend?: string;
}

interface ArtAudit {
  ok: boolean;
  problems: string[];
  counts: {
    kinds: number; atlases: number; blends: number; anchors: number;
    stages: number; rules: number; owners: number; unowned: number;
  };
}

/** "这一类资源本项目刻意不做"的登记（没做是一种登记过的状态，不是沉默） */
interface ArtDeferredDef { kind: string; why: string; }

interface ArtApi {
  KINDS: ArtKindDef[];
  KIND_BY_ID: Record<string, ArtKindDef>;
  KIND_BY_PREFIX: Record<string, ArtKindDef>;
  kindOf(id: string): ArtKindDef | null;
  /** 从名字的前缀反查类别（lint 用） */
  kindOfName(name: string): ArtKindDef | null;
  SIZES: {
    grid: number; tile: number; /** 外墙瓦片格距（= grid；改外墙时先看它） */ border: number;
    icon: number; bakeMax: number;
    pow2Min: number; pow2Max: number; assetMax: number;
  };
  sizeOk(w: number, h: number): boolean;
  tileDivides(size: number): boolean;
  isPow2(n: number): boolean;
  ANCHORS: ArtAnchorDef[];
  ANCHOR_BY_ID: Record<string, ArtAnchorDef>;
  /** 锚点的归一化偏移（`draw2d` 与缓存用它对齐） */
  anchorRatio(id: string): { x: number; y: number };
  /** 某类别默认用哪个锚点（示例与缺省用） */
  anchorFor(kindId: string): string;
  ATLASES: ArtAtlasDef[];
  ATLAS_BY_ID: Record<string, ArtAtlasDef>;
  BLENDS: ArtBlendDef[];
  BLEND_BY_ID: Record<string, ArtBlendDef>;
  compositeOf(id: string): string;
  PIPELINE: ArtStageDef[];
  PIPELINE_BY_ID: Record<string, ArtStageDef>;
  LINT_RULES: ArtLintRuleDef[];
  LINT_BY_ID: Record<string, ArtLintRuleDef>;
  BUDGET: { drawsPerFrame: number; cacheBytes: number; perAtlas: number; framesPerClip: number };
  /** 任何资源声明都要过的那把尺子 */
  lintAsset(a: ArtAssetDecl): { ok: boolean; problems: string[] };
  audit(): ArtAudit;
  /** 资源归属：类别 id → 生产它的模块名 */
  OWNERS: Record<string, string[]>;
  noteOwner(kind: string, owner: string): ArtKindDef;
  ownersOf(kind: string): string[];
  /** 规范里写了、项目里没有任何模块生产的类别 */
  unownedKinds(): string[];
  /** 明确登记为"这个项目不做"的类别（带理由） */
  DEFERRED: ArtDeferredDef[];
  DEFERRED_BY_KIND: Record<string, ArtDeferredDef>;
  /** 还没做、也没有登记理由的类别（= 真的漏了） */
  missingKinds(): string[];
  /** 是否把"资源归属"算进自检（加载时不算；测试与工具会打开） */
  requireOwners: boolean;
}

/* =========================================================
   货币与循环（economy.ts）
   ---------------------------------------------------------
   一笔货币 = **层级**（能不能带出局）+ **来源与去向**（循环的哪条边）。
   三个模块（战斗 / 经营 / 养成）靠这些边连成一条闭环 —— 于是
   "三模块怎么互相喂"是可查的数据，不是散文。
   ========================================================= */
interface CurrencyTierDef {
  name: string;
  note: string;
  /** `run` = 结算清零；`account` = 带得出去 */
  lifetime: 'run' | 'account';
}

interface SystemDef {
  name: string;
  note: string;
  where: 'in-run' | 'meta';
}

interface CurrencyDef {
  id: string;
  name: string;
  /** 层级（必须登记在 `Economy.TIERS` 里） */
  tier: string;
  /** 来源系统（**只有 `combat` 合法**：局外不许自己印钱） */
  from: string[];
  /** 去向系统 */
  to: string[];
  note: string;
  why: string;
}

/** 反哺边（局外 → 战斗）：不是货币，是"下一局的开局条件" */
interface BackflowDef {
  from: string;
  to: string;
  what: string;
  /** 怎么过去的（折成 kmods / fmods / opening） */
  via: string;
  /** 什么在限制它 —— 必须指向真的会被花掉的东西（白给的反哺不是循环的一环） */
  limit: string;
  /** 限制来自哪一种资源（`core` = 核心材料） */
  gate: string;
  note: string;
}

interface EconomyApi {
  LIST: CurrencyDef[];
  BY_ID: Record<string, CurrencyDef>;
  TIERS: Record<string, CurrencyTierDef>;
  SYSTEMS: Record<string, SystemDef>;
  /** 这笔钱结算时清不清零（层级决定，不是各处自己判） */
  isSession(id: string): boolean;
  /** 这笔钱能不能带出去 */
  isAccount(id: string): boolean;
  flowsFrom(id: string, sys: string): boolean;
  flowsTo(id: string, sys: string): boolean;
  byTier(tier: string): string[];
  /** 某一条循环边上有哪几笔钱（`combat → manage` …） */
  edge(from: string, to: string): string[];
  /** **循环图**：三个模块之间的边，以及每条边上流的是什么 */
  loop(): { systems: string[]; edges: Array<{ from: string; to: string; what: string[] }> };
  /**
   * **反哺边**（局外 → 战斗）：不是货币，是"下一局的开局条件"
   * （折成 `kmods` / `fmods` / `opening`，开局那一刻并进会话）。
   */
  BACKFLOW: BackflowDef[];
  /** 某个系统通过哪几条反哺边回到战斗（空 = 只进不出的死胡同） */
  backflowFrom(sys: string): BackflowDef[];
  /** **已知缺口**：循环里还没有的东西（现在是空的 —— 机制留着，数据空是**好消息**） */
  GAPS: Array<{ from: string; to: string; what: string; now: string; todo: string }>;
  /** 循环图里**还缺**的边（audit 与体检工具同一份判据） */
  missingEdges(): Array<{ from: string; to: string; what: string }>;
  audit(): {
    ok: boolean; problems: string[];
    counts: { currencies: number; tiers: number; systems: number; edges: number; backflow: number; gaps: number };
  };
}

/* ---------------- 元素（data_elems.ts） ---------------- */
/**
 * 一种元素。`effect` 是**机制**的名字（`burn` 灼烧 / `chain` 电弧；'' = 纯元素伤害），
 * 由 `game.ts` 的 `applyElement` 认领 —— 声明了却没人认领会被自检抓住。
 */
interface ElementDef {
  /** 武器表里写的那个字符串 */
  id: string;
  /** 跨模块引用用的键（`weapon:元素` 的家族 id） */
  uid: string;
  /** 界面名（**唯一**的一份；界面不再自己建映射表） */
  name: string;
  /** 给人看的一句说明（界面与图鉴复用） */
  note: string;
  /** 附带效果的机制名；'' = 只有元素伤害加成 */
  effect: string;
}

interface ElemsApi {
  LIST: ElementDef[];
  BY_ID: Record<string, ElementDef>;
  /** id → 定义（认不出的返回 null） */
  get(id: string | undefined): ElementDef | null;
  /** id → 界面名（认不出的回显原值：坏数据要看得见） */
  nameOf(id: string | undefined): string;
  /** id → 附带效果的机制名（'' = 没有效果） */
  effectOf(id: string | undefined): string;
  audit(): { ok: boolean; problems: string[]; counts: { elements: number; effects: number } };
}

/* =========================================================
   词条系统（affixes.ts）
   ---------------------------------------------------------
   一条词条 = **声明**（AffixDef）+ **实例**（AffixInst）。
     · 声明是静态表里的一行（名字、家族、能落在哪、每档加什么）；
     · 实例是"这件装备上真的有一条"，存的是 `id / t（第几档）/ v（数值，整数）`。
   为什么值存**整数**：百分比统一按千分之一存（80 = +8%），
   于是折叠时只有整数加法 —— 没有浮点漂移，回放与存档逐位可复现。
   ========================================================= */
interface AffixInst {
  /** 指向 AffixDef.id（存档里只认这个字符串） */
  id: string;
  /** 第几档（1 起） */
  t: number;
  /** 数值（整数：per=1000 的是千分比，per=1 的是原值） */
  v: number;
}

/** 一个绑定槽位**发生了哪一次**：把 `fighter` / `fighter:wand` 拆成基础槽 + 细分标签 */
interface AffixSlot {
  base: string;
  tag: string;
}

interface AffixDef {
  id: string;
  name: string;
  en: string;
  /** 'prefix' 进攻型（武器与进攻装）· 'suffix' 防护与效用型 */
  family: 'prefix' | 'suffix';
  /** 能落在哪些绑定槽位（base，或 `base:tag`） */
  slots: string[];
  /** 需要目标带上其中之一（空 = 不挑） */
  tags?: string[];
  /** 这一条改的是哪个属性/机制键（affixMod 家族） */
  mod: string;
  /** 每档的整数增量 */
  per: number;
  /** 一档的题目上限（数值从 per 到 per*cap 之间取） */
  cap: number;
  /** 折叠时把整数还原成真值的分母：1000 = 千分比，1 = 原值 */
  scale: number;
  /** 得高分的权重（相对） */
  w: number;
  /** 给人看的一句话（**文案的唯一出处**，界面不再写第二份） */
  text: (v: number) => string;
}

/** 一件装备身上的全部词条 */
interface AffixSet {
  list: AffixInst[];
  /** 合并 / 抬档时**允许保留的上限**（滚动生成时 = Affix.rollCount(tier)） */
  max: number;
}

interface AffixFold {
  /** 折进属性表的增量（**真实标度**，不是整数） */
  stats: Record<string, number>;
  /** 武器本地修正（只在武器上出现：倍率与冷却） */
  wmods: Record<string, number>;
}

interface AffixesApi {
  LIST: AffixDef[];
  BY_ID: Record<string, AffixDef>;
  FAMILIES: Record<string, { name: string; note: string }>;
  SLOTS: Array<{ base: string; name: string; note: string }>;
  TAGS: Record<string, { name: string; note: string }>;
  MODS: Record<string, { scope: 'stat' | 'weapon'; note: string; key?: StatKey; mul?: boolean; scale: number }>;
  /* 读点一律写成**方法签名**（`name(args): T`）而不是函数属性（`name: (args) => T`）：
     两者类型等价，但 `tools/arch-audit.cjs` 的 [5] 节按"方法 / 字段"给接口分类，
     函数属性会被数成**字段** —— 于是 `AffixesApi` 会显示成"0 个方法 / 30 个字段"，
     而它其实是一个纯函数模块。真按字段堆出来的接口是一个真实的坏味道，
     尺子不该因为写法不同就看不见它（也不该因为写法不同就误报）。 */
  /** 滚动生成时一件装备最多几条（按**品级**，T4 起 3 条） */
  rollCount(tier: number): number;
  /** 槽位字符串 → { base, tag } */
  parseSlot(slot: string): AffixSlot;
  /** 一件装备的绑定槽位（武器看标签，道具看槽位） */
  targetSlot(kind: 'weapon' | 'item', def: WeaponDef | ItemDef): string;
  /** 目标身上的标签（细分槽位与 `tags` 门槛都用它） */
  tagsOf(kind: 'weapon' | 'item', def: WeaponDef | ItemDef): Record<string, boolean>;
  /** 空集合（不是 null：`onSpawn` 与存档都写它，省一层判空） */
  empty(): AffixSet;
  /** 打包一条实例（钳档、算值）。`id` 认识才返回，否则 null */
  make(id: string, tier: number, rnd?: RngFn): AffixInst | null;
  /** 归一化一件装备身上的词条（读档 / 生成钩子共用；坏数据丢掉而不是抛） */
  normalize(set: AffixSet | null | undefined, kind: 'weapon' | 'item'): AffixSet;
  /** 这件装备为什么不能有这一条（'' = 可以） */
  wrongReason(def: AffixDef, kind: 'weapon' | 'item', target: WeaponDef | ItemDef): string;
  /** 这件装备现在能滚出哪几条 */
  pool(kind: 'weapon' | 'item', target: WeaponDef | ItemDef): AffixDef[];
  /** 为一件装备滚一套词条（**用调用方给的 rnd**，确定性归模拟层管） */
  roll(kind: 'weapon' | 'item', target: WeaponDef | ItemDef, tier: number, rnd: RngFn): AffixSet;
  /** 词条自己的随机流（从主随机流的状态派生：**不扰动主序列**，见实现处的说明） */
  rollStream(state: number | undefined, n: number): RngFn;
  /** 合并两套词条（合成/熔接：各取最好的一条，上限为 `max`） */
  merge(a: AffixSet | null, b: AffixSet | null, max: number): AffixSet;
  /** 一条实例 → 真值（整数 ÷ scale） */
  valueOf(inst: AffixInst): number;
  /** 一条词条 → 一句人话 */
  line(inst: AffixInst, opts?: { withName?: boolean }): string;
  /** 一条词条 → 一行 HTML（界面用；颜色按家族分） */
  html(inst: AffixInst): string;
  /** 一套词条的每一行 */
  lines(set: AffixSet | null): string[];
  /** 一套词条折成 { stats, wmods }（缺省 = 全零，**恒等**） */
  fold(set: AffixSet | null): AffixFold;
  /** 把一套词条折进一份属性表（就地累加；武器本地项走第二个出参） */
  applyStats(set: AffixSet | null, out: Record<string, number>): Record<string, number>;
  /** 这套词条够不够强（界面画星级/排序用）：数值按 scale 归一后求和 */
  power(set: AffixSet | null): number;
  /** 武器/道具表把**自己**交给词条系统（延迟绑定：直接 import 会成环） */
  bindTables(kind: 'weapon' | 'item', list: Array<WeaponDef | ItemDef>): void;
  /** 哪些装备一条词条都滚不出来（自检与测试共用同一份判据） */
  _blankTargets(): string[];
  /** 存档用：`[id, 档, 值]` 三元组的扁平数组（**唯一的**序列化形状） */
  toSave(set: AffixSet | null): Array<[string, number, number]>;
  /** 读档用：从 `toSave` 的产物还原（认不出的丢掉） */
  fromSave: (raw: unknown, kind: 'weapon' | 'item', target?: WeaponDef | ItemDef) => AffixSet;
  /** 定义期自检 */
  audit: () => { ok: boolean; problems: string[]; counts: Record<string, number> };
}

interface WeaponInst {
  id: string; def: WeaponDef; cd: number; swing: number;
  /** 挂点槽位号（Seat 组件）：模拟层与渲染层靠它取骨架上同一个挂点 */
  index?: number;
  /** 词条（AffixSet 组件）：这一把**自带**的随机加成 */
  affixes?: AffixSet | null;
  /** 词条里"武器本地"的那一份（伤害倍率 / 冷却倍率），每次重算属性时由 Affixes.fold 写 */
  wmods?: Record<string, number> | null;
  /** **当前**品级（1–5）。它与 `def.tier`（出身档）不同：合成把它抬上去 */
  tier?: number;
  /** 为它**付过多少材料**（0 = 捡到 / 开局自带 / 手工造的对象）。
      回收价不许超过它 —— 见 `data_weapons.ts` 的 salvageOf：这一条同时堵住
      "折扣叠满时买光拆光赚钱"与"质量抬档后拆掉赚钱"两个洞，而且不碰定价。 */
  paid?: number;
}

/** 一件道具的**代价**（"有得有失"的那一半）。
 *  `stat` 是属性型代价（并进属性表，与收益同一条路）；
 *  其余键是 `data_items.ts` 的 `COST_KINDS` 里登记过的效果键
 *  （材料 / 价格 / 敌人 / 规则）。写一个没登记的键 = 这条代价**永远不生效**，
 *  所以它由 audit + 总账两处守着。 */
interface ItemCost {
  stat?: Partial<StatMap>;
  [key: string]: number | Partial<StatMap> | undefined;
}

interface ItemDef {
  id: string; name: string; en?: string; tier: number; price: number;
  icon: string; tint?: string; stats?: Partial<StatMap>; special?: string; desc: string;
  /** 词条的绑定槽位（`affixes.ts` 的 SLOTS：armor / trinket / gear / consumable）。
      缺省按 `trinket` 算 —— 于是新增一件道具**不必**先想词条，也不会"什么都没有"。 */
  slot?: string;
  /** 词条标签（`affixes.ts` 的 TAGS：heavy …）：细分槽位 `armor:heavy` 靠它 */
  tags?: string[];
  /** **代价**：为了这一件你要付什么（见 ItemCost）。
   *  **属性型的代价写成负的 `stats`**（`{ armor: -3 }`）—— 属性只有一条折进属性表的路径；
   *  这里只放**属性表之外**的三类代价：经济（`matMul` …）/ 敌人（`enemyHp` …）/ 规则（`noHeal` …）。 */
  cost?: ItemCost;
  /** 白板：允许纯增益的**例外**，必须写 `plainNote` 说明理由，且只允许 T1/T2（有名额上限） */
  plain?: boolean;
  plainNote?: string;
}

/** 道具代价的折叠结果（`recalcStats` 折一次，模拟层只读结果） */
interface ItemCostFold {
  /** 乘性代价（缺省 1 = 恒等）：材料、商店价、敌人生命/伤害/移速、受伤倍率 */
  mul: Record<string, number>;
  /** 加性代价（缺省 0）：规则型标记（不能再免费刷新 / 结算不回血） */
  add: Record<string, number>;
}

interface ItemInst {
  def: ItemDef;
  /** 词条（AffixSet 组件）：这一件**自带**的随机加成 */
  affixes?: AffixSet | null;
}

interface CharDef {
  id: string; name: string; en: string; tag: string; desc: string;
  stats: Partial<StatMap>; startWeapons: string[]; tint: string[];
  face?: string; special?: string;
  /** 需要挑战解锁（界面门槛；模拟层不校验，测试与 CLI 仍可直接开局） */
  locked?: boolean;
  /** **隐藏角色**（G5）：没解锁之前连人带卡都不出现在选人页上 */
  hidden?: boolean;
}

interface EnemyDef {
  id: string; name: string; shape: string; color: string; dark: string;
  hp0: number; speed: number; dmg0: number; scale: number; cost: number;
  eyes?: number; mouth?: string; legs?: string; minWave: number;
  behavior?: string; atkCd?: number; projSpeed?: number; projDmg?: number;
  keepDist?: number; projColor?: string; pattern?: string;
  ringCount?: number; fanCount?: number; armorFlat?: number; boss?: boolean;
  splitInto?: { id: string; count: number };
  explodeOnDeath?: { dmg: number; radius: number };
  healAura?: { radius: number; hps: number };
  /* ---- G3：三位新 Boss 的专属参数 ---- */
  /** 扫射弧线的发数与张角（钟摆） */
  sweepCount?: number; sweepArc?: number;
  /** 召唤节拍 / 召唤谁 / 一次几只（母巢） */
  summonEvery?: number; summonIds?: string[]; summonCount?: number;
}

/* ---------------- 运行时实体 ---------------- */
/**
 * 预渲染贴图包装（注意：传给 drawImage 的必须是 .canvas）。
 * width/height 是**逻辑**尺寸（世界像素），canvas 是逻辑尺寸 × scale 的设备位图：
 * 渲染层一律按 width/height 画，倍率变化不会移动任何东西。
 */
interface Sprite {
  canvas: HTMLCanvasElement; width: number; height: number; scale?: number;
  /** 身体中心在画布里的 y（渲染层用它把贴图对准世界坐标） */
  bodyY?: number;
  /** 脚底距画布底边的距离 */
  foot?: number;
  /** 贴图上身体圆的半径（可见身体，比命中圈略大） */
  bodyR?: number;
}

/** 怪物贴图的逻辑盒子（脚底以上 up、以下 down） */
interface EnemyBox { R: number; up: number; down: number; w: number; h: number; }

/* ---------------- 诊断面板（diag.ts） ----------------
   只把各系统的 describe()/账目聚合成字符串，供 UI 显示；不参与任何模拟或渲染决策。 */
interface DiagApi {
  header(): string;
  frame(): string;
  containers(): string;
  depth(): string;
  registry(): string;
  cache(): string;
  lines(): string[];
  text(): string;
  full(): string;
}

/* ---------------- 录制 / 回放（record.ts） ----------------
   确定性已经由帧模型与种子化随机保证，所以回放只存"命令 + 逐帧输入"。 */
interface RecEvent { frame: number; cmd: string; args: any[]; seed: number; }
interface RecTape { v: number; frames: number; seed: number; events: RecEvent[]; inputs: number[][]; }
interface RecApi {
  start(): boolean;
  stop(): RecTape;
  isRecording(): boolean;
  /** 正在回放？（回放会真的推进模拟并触发 gameOver，接线层靠这个不落账） */
  replaying(): boolean;
  input(input: { x?: number; y?: number } | null): void;
  tape(): RecTape;
  play(tape: RecTape, step: (x: number, y: number, frame: number) => void): boolean;
  stats(): { recording: boolean; replaying: boolean; frames: number; events: number; seed: number };
  /** 会被录制的命令清单（只读；测试用它验"会改一局状态的命令一条都没漏"） */
  commands(): string[];
}

/* ---------------- 每日挑战（daily.ts） ---------------- */
interface DailyRule { key: string; seed: number; char: string; danger: number; }
interface DailyRecord {
  key: string; seed: number; char: string; danger: number;
  wave: number; kills: number; level: number; win: boolean; score: number;
  at: number; frames: number;
}
interface DailyApi {
  dateKey(now?: number | null): string;
  seedFor(key: string): number;
  charFor(key: string): string | null;
  of(key?: string): DailyRule;
  /** 成绩分：只读波次/击杀/等级/通关 —— 不做"越快越好"，本作没有那个语义 */
  scoreOf(run: { wave?: number; kills?: number; level?: number; win?: boolean } | null): number;
  /* "这一局是不是挑战局"的标记在 main.ts（每日与每周共用同一套流程）；
     本模块只管"今天是什么" */
  bestOf(profile: { daily?: Record<string, DailyRecord> } | null, key?: string): DailyRecord | null;
  pick(a: DailyRecord | null, b: DailyRecord | null): DailyRecord | null;
  /** 定义期自检（表自身的完整性；"某个字段有没有人读"是测试的活） */
  audit(): { ok: boolean; problems: string[] };
}

/* ---------------- 成绩码（score.ts） ---------------- */
interface ScoreClaims {
  key: string; char: string; danger: number; seed: number;
  wave: number; kills: number; level: number; win: boolean;
}
interface ScoreApi {
  VERSION: number;
  PREFIX: string;
  MAX_PACK_CHARS: number;
  hash(str: string): string;
  canonTape(tape: RecTape | null): string;
  hashTape(tape: RecTape | null): string;
  make(claims: Partial<ScoreClaims>, hash: string): string;
  parse(code: string): (ScoreClaims & { hash: string }) | null;
  describe(claims: Partial<ScoreClaims> | null): string;
  replayClaims(tape: RecTape, play: (x: number, y: number, frame: number) => void): ScoreClaims | null;
  verify(code: string, tape: RecTape | null, play: (x: number, y: number, frame: number) => void):
    { ok: boolean; reason: string; actual: ScoreClaims | null };
  pack(code: string, tape: RecTape | null): { ok: boolean; reason: string; text: string | null };
  unpack(text: string): { code: string; tape: RecTape | null } | null;
  /** 定义期自检（声明表与 make / parse / hash 三处代码是否还对得上） */
  audit(): { ok: boolean; problems: string[] };
}

/* ---------------- 容器与对象管理（containers.ts） ----------------
   每个容器在一处声明：装什么、多大、满了怎么办、怎么回收；回收/上限/账目/不变量共用一套机制。 */
interface ContainerDef {
  name: string;
  /** 会话上的字段名（也是 Comp.archetype 的 opts.list） */
  list: string;
  note: string;
  /** 上限（不设上限必须显式写 Infinity） */
  cap: number;
  /** swap 就地交换删除 | ring 环形缓冲（写满覆盖） | external 由属主回收（池化等） */
  policy: 'swap' | 'ring' | 'external';
  onFull: 'reject' | 'drop-oldest' | 'reclaim-farthest' | 'never';
  dead(ref: any): boolean;
  keep: ((ref: any) => boolean) | null;
}
interface ContainerStat {
  len: number; cap: number; dead: number; use: number;
  policy: string; onFull: string;
}
interface ContainersApi {
  declare(name: string, def: {
    list: string; note: string; cap: number;
    policy?: 'swap' | 'ring' | 'external';
    onFull?: 'reject' | 'drop-oldest' | 'reclaim-farthest' | 'never';
    dead?: (ref: any) => boolean;
    keep?: (ref: any) => boolean;
  }): ContainerDef;
  has(name: string): boolean;
  names(): string[];
  def(name: string): ContainerDef | null;
  table(): { name: string; list: string; note: string; cap: number; policy: string; onFull: string }[];
  of(sess: any, name: string): any[];
  add(sess: any, name: string, obj: any): any;
  slot(sess: any, name: string, seq: number): { index: number; list: any[]; cap: number };
  reap(sess: any, name: string): number;
  reapAll(sess: any): number;
  enforce(sess: any, name: string): number;
  enforceAll(sess: any): number;
  clear(sess: any, name: string): number;
  stats(sess: any): Record<string, ContainerStat>;
  check(sess: any): string[];
  describe(sess: any): string;
}

/* ---------------- 扩展点总账（registry.ts） ----------------
   所有"家族"（可扩展点）在拥有数据的模块里自注册，由 Registry.audit() 一次校验完
   家族内部（id 唯一）与家族之间（引用必须存在）的约束。 */
interface RegistryRef { field: string; value: any; family: string; }
interface RegistryEntry { id: string | number; refs?: RegistryRef[]; }
interface RegistryFamily {
  name: string;
  note: string;
  owner: string;
  entries: (() => RegistryEntry[]) | null;
  values: (() => any[]) | null;
}
interface RegistryProblem {
  family: string; id: string; field: string; value: any; target: string; reason: string;
}
interface RegistryApi {
  family(name: string, def: { note: string; owner?: string; entries?: () => RegistryEntry[]; values?: () => any[] }): RegistryFamily;
  has(name: string): boolean;
  names(): string[];
  info(name: string): { name: string; note: string; owner: string } | null;
  ids(name: string): string[];
  count(name: string): number;
  /** 声明"数据表上的这个字段，值属于哪个家族"（同一对重复调用是幂等的）。
   *  守卫（`test/data-contract.mjs`）据此要求：每个写成字符串的数据字段
   *  要么有一个家族守着它的值域，要么在豁免清单里写明理由。 */
  uses(field: string, family: string): string;
  /** 字段 → 家族的只读快照（一个字段可以有多个家族：`special` 在两个接口里语义不同） */
  fieldFamilies(): Record<string, string[]>;
  audit(): { ok: boolean; problems: RegistryProblem[]; counts: Record<string, number>; missing: string[] };
  describe(): string;
}

/* ---------------- Z 深度（depth.ts） ----------------
   层带 + 层内 y 排序 + 确定性 tie-break；sim 层不参与，实体由渲染层注册。 */
interface DepthActor {
  name: string;
  band: string;
  /** 层带号（排序主序） */
  z: number;
  y(ref: any): number;
  id(ref: any): number;
  seq(ref: any): number;
  cull: number | ((ref: any) => number);
  draw(ctx: any, ref: any, env: any): void;
}
interface DepthSlot { z: number; y: number; id: number; seq: number; kind: string; ref: any; }
interface DepthStats {
  pushed: number;
  actors: Record<string, number>;
  bands: Record<string, number>;
  slots: number;
  live: number;
}
interface DepthApi {
  /** 具名层带的 z 值（名字错即抛错） */
  band(name: string): number;
  bandNames(): string[];
  bandNote(name: string): string;
  bandTable(): { name: string; z: number; note: string }[];
  actor(name: string, def: { band: string; y: (ref: any) => number; id?: (ref: any) => number; seq?: (ref: any) => number; cull?: number | ((ref: any) => number); draw: (ctx: any, ref: any, env: any) => void }): DepthActor;
  cullRadius(name: string, ref: any): number;
  hasActor(name: string): boolean;
  actors(): string[];
  actorInfo(name: string): { name: string; band: string; z: number } | null;
  compare(a: DepthSlot, b: DepthSlot): number;
  reset(): void;
  push(name: string, ref: any): void;
  count(): number;
  flush(ctx: any, env: any): void;
  trace(fn: ((name: string, ref: any, order: number) => void) | null): boolean;
  stats(): DepthStats;
  describe(): string;
  /** 定义期自检（层带表的编号/派生表覆盖、每条实体的层带在场且 z 与表一致） */
  audit(): { ok: boolean; problems: string[] };
}

/* ---------------- 怪物 AI（ai.ts） ----------------
   AI 层不认识 Game / Session：它要的能力都由这个上下文提供（依赖倒置）。
   ctx 由模拟层复用同一个对象，实现方不得保存它。 */
interface AiCtx {
  dt: number;
  player: Player;
  /** 本帧"怪 → 玩家"的距离与单位方向（击退之前算好，行为读的就是它） */
  d: number; nx: number; ny: number;
  sfx: { shoot(kind: string): void } | null;
  /** 战场内查询（返回的是复用缓冲，用完即弃） */
  query(x: number, y: number, r: number): Enemy[];
  hurt(dmg: number): void;
  kill(e: Enemy): void;
  shoot(e: Enemy, angle: number, big: boolean): void;
  clamp(x: number, y: number, r: number): { x: number; y: number };
  rnd(): number;
  /** 召唤一只小怪（母巢用；由模拟层注入，AI 层不认识刷怪流程） */
  spawn?(id: string, x: number, y: number): Enemy | null;
  /** 请求镜头抖动（破土那一下；同样是注入的能力） */
  shake?(amount: number): void;
}

interface AiBehaviour {
  name: string;
  note: string;
  /** 速度意图（返回后模拟层会再叠加分离力并积分） */
  move(e: Enemy, ctx: AiCtx): void;
  contact: ((e: Enemy, ctx: AiCtx) => void) | null;
}

interface AiPattern {
  name: string;
  note: string;
  /** 该模式的子弹是否走"大弹"档（Boss 扇形弹） */
  big: boolean;
  /** 第三参是开火的那只怪（扫射的相位在它身上，不能在共享的 def 上） */
  angles(def: EnemyDef, base: number, e?: Enemy): number[];
}

interface AiApi {
  behaviour(name: string, def: { note?: string; move: (e: Enemy, ctx: AiCtx) => void; contact?: (e: Enemy, ctx: AiCtx) => void }): AiBehaviour;
  hasBehaviour(name: string): boolean;
  behaviours(): string[];
  behaviourInfo(name: string): { name: string; note: string; contact: boolean } | null;
  pattern(name: string, opts: { note?: string; big?: boolean }, angles: (def: EnemyDef, base: number, e?: Enemy) => number[]): AiPattern;
  hasPattern(name: string): boolean;
  patterns(): string[];
  patternInfo(name: string): { name: string; note: string; big: boolean } | null;
  /** 一个怪物的一步（击退 → 行为 → 分离 → 位移 → 光环 → 接触） */
  step(e: Enemy, ctx: AiCtx): void;
  /** 按模式开一次火（查表失败即抛错，未注册的模式不会静默变成单发） */
  shoot(e: Enemy, ctx: AiCtx): void;
}

/** 缓存账目（S.cacheStats / R.bakeStats 的返回） */
interface SpriteCacheStats {
  entries: number; px: number; bytes: number; scale: number;
  list: { key: string; w: number; h: number; scale: number; px: number; bytes: number }[];
}
interface BakeStats {
  ground: { baked: boolean; wave: number; theme: string; scale: number; px: number; bytes: number };
  props: { baked: boolean; wave: number; theme: string; scale: number; px: number; bytes: number };
  scale: number; maxPx: number; px: number; bytes: number;
}

interface Player {
  x: number; y: number; px: number; py: number; vx: number; vy: number; r: number;
  base: StatMap; upgrades: StatMap; items: ItemInst[]; weapons: WeaponInst[];
  hp: number; invuln: number; hitFlash: number; hurtFlash: number;
  level: number; xp: number; xpNeed: number; pendingLevels: number;
  aim: number; face: number;
  animT: number; moveBlend: number; moving: boolean;
  rage: number; scrap?: number; _regenAcc?: number;
  charDef: CharDef;
  /** 骨架实例（Skeleton 组件）：豆豆的骨头与武器挂点都在这里 */
  rig?: RigInstance | null;
}

interface Enemy {
  id: number; def: EnemyDef;
  x: number; y: number; px: number; py: number;
  vx: number; vy: number; kx: number; ky: number;
  r: number; maxHp: number; hp: number; dmg: number; speed: number;
  elite: boolean; dead: boolean;
  hitFlash: number; burn: number; burnDps: number;
  atkCd: number; windup: number; shootCd: number;
  phase: number; spawnT: number;
  /* AI 的两个计时器（钻地上浮/下潜、召唤节拍、扫射相位）与"钻地中"标记 */
  t1: number; t2: number; burrowed: number;
  armorFlat?: number; _shockTag?: number;
  /** 超时狂暴标记（渲染/调试可读） */
  enraged?: boolean;
  _spr?: Sprite; _fl?: Sprite;
}

interface Bullet {
  x: number; y: number; px: number; py: number; vx: number; vy: number; r: number;
  dmg: number; pierce: number; hitSet: Enemy[] | null;
  life: number; lifeMax: number;
  color: string; dark?: string; kind: string;
  element?: string; knock?: number; blast?: number;
  crit?: boolean; bigCrit?: boolean;
  fromX?: number; fromY?: number; tintA?: string;
}

interface EnemyBullet {
  x: number; y: number; px: number; py: number; vx: number; vy: number; r: number;
  dmg: number; color: string; life: number; kind: string;
}

interface Particle {
  kind: string; x: number; y: number;
  vx?: number; vy?: number; r?: number; color?: string;
  life: number; lifeMax: number;
  drag?: number; a?: number; arc?: number; rot?: number;
  r0?: number; r1?: number; w?: number;
  text?: string; size?: number;
}

interface Pickup {
  kind: 'mat' | 'heal';
  x: number; y: number; vx: number; vy: number;
  seed: number; value: number;
  /** 被捡走 = 该回收（containers 的**缺省 dead 判据**就是读这个字段） */
  dead?: boolean;
}

interface Decal {
  x: number; y: number; r: number; color: string; seq: number;
  a1: number; a2: number; d1: number; d2: number; s1: number; s2: number;
}

interface Turret {
  x: number; y: number; hp: number; maxHp: number;
  cd: number; aim: number; muzzle: number; r: number;
}

interface SpawnItem { id: string; at: number; elite: boolean; boss?: boolean; }
/* 一件货的 def 是**武器或道具之一**，不是两者皆是 ——
   以前写成交集（WeaponDef & ItemDef），那是在说"每件货都有 icon 也有 dmg"，
   与事实不符（于是"货架里塞武器"这种赋值连编译器都拦不住）。 */
interface Offer { type: 'weapon' | 'item'; def: WeaponDef | ItemDef; sold: boolean; price: number; /** 武器是**哪一档**（0 = 道具/不适用） */ tier?: number;
  /** 货架上**这一件**的词条（买到的就是它 —— 界面与到手的是同一份，见 market.ts 的 shopRoll） */
  affixes?: AffixSet | null; }
/** 升级池里的一条**声明**：`amt` 是基准幅度（会乘 `player.cardAmt` 曲线） */
interface UpgradeEntryDef {
  key: StatKey;
  /** 基准幅度（第 1 级的幅度；实际 = `amt × Curves.at('player.cardAmt', level)`） */
  amt: number;
  /** 基础抽中权重 */
  w: number;
  /** 防御向（生命 / 护甲 / 闪避 / 回复 / 吸血）：权重随等级抬（`player.cardPool`） */
  guard?: boolean;
}

/**
 * 发到玩家手上的一张升级卡。
 * `amt` 是**发卡那一刻按等级算好的**：界面与 `takeLevelCard` 都读它，
 * 于是"看到的幅度"与"选中的幅度"是同一个数（两处各算一次就会漂）。
 */
interface UpgradeCard {
  key: StatKey;
  /** 实际幅度（已乘 `player.cardAmt`） */
  amt: number;
  /** 基准幅度（`UPGRADE_POOL` 里写的那个） */
  base: number;
  /** 抽这张卡时的玩家等级 */
  level: number;
  /** 是不是防御向 */
  guard: boolean;
}

interface ArenaData {
  w: number; h: number; wave: number; seed: number;
  /** 这一间战场的环境 id（主题 id）—— 烘焙缓存按 (wave, theme) 失效 */
  theme: string;
  /** 这一间的地面配色（渲染层唯一的地面调色来源） */
  pal: ThemePal;
  /** 装饰物种类（与主题的 `prop` 同名字段） */
  prop: string;
  patches: Array<{
    x: number; y: number; rx: number; ry: number; rot: number;
    pts: number; bump: number; seed: number; tone: string; form: string;
  }>;
  pebbles: Array<{ x: number; y: number; r: number; tone: string; sq: number; rot: number }>;
  rocks: Array<{ x: number; y: number; r: number; pts: number[][]; seed: number; n: number; dark: boolean }>;
  cracks: Array<{ pts: number[][]; w: number }>;
  /** 场景装饰物（白骨 / 晶簇 / 菌伞 / 余烬 / 冰棱 —— 种类由主题决定） */
  props: Array<{ x: number; y: number; rot: number; s: number; kind: string }>;
}

/* =========================================================
   一局的状态（Session）
   ---------------------------------------------------------
   改造前它是一个**72 个字段的平铺大对象**：谁也说不清"哪些字段属于同一件事"，
   新增字段时也没有任何东西提醒你"它该不该进存档"。
   现在按子系统分成 6 组，`Session` 只是它们的并集 ——
   于是"这一局有哪些东西"在类型层面就有结构，`test/persist.mjs` 会守着
   "没有一个字段是散装的（既不属于任何组、也没被记录下来）"。
   组的划分与模块一一对应：core/profile 折叠 · camp/market/entities/dungeon/wave。
   ========================================================= */
interface SessionCore {
  rnd: RngFn;
  /** 本局的随机种子（存档需要它才能续玩时复现同一局的成长曲线） */
  seed?: number;
  /** 本局的难度等级（0..Danger.MAX） */
  danger: number;
  /** 本局折叠好的难度修正（开局算一次，模拟里不再回表） */
  dmods: DangerMods;
  /** 本局的开局条件（天赋产物）。模拟层只把它当"起始状态"，不认识天赋 */
  opening: OpeningLoadout;
  /** 天赋折出来的经济修正（开局算一次；与 dmods/kmods 同形，空开局 = 全 0 恒等） */
  omods: OpeningEcon;
  /** 据点设施等级（跨局永久；存档要带着它） */
  keep: Record<string, number>;
  /** 据点修正的折叠结果（开局算一次） */
  kmods: StrongholdMods;
  /** 已解锁的图纸（开局那一份；`{ id: true }`，归一过，见 Forge.toMap） */
  forge: Record<string, boolean>;
  /** 图纸工坊的折叠结果（开局算一次；只解锁**能力**，没有一条是属性） */
  fmods: ForgeMods;
  /** 道具**代价**的折叠结果（recalcStats 折一次）。
   *  与 `itemFx`（机制）分开：那一份是"这件道具改了什么机制"，
   *  这一份是"为了它你要付什么" —— `mul` 乘性（缺省 1）、`add` 加性（缺省 0）。
   *  折一次而不是每帧遍历道具：这是"高内聚"的落地方式（读点只读结果）。 */
  itemCost: ItemCostFold;
  /** 回收返还比例（工坊「废料回收」把它从 0.5 抬到 0.7）—— 开局折一次，模拟里只读 */
  salvageRate: number;
  /** 本局累积的**合金**（合成产出；局内不能花，结算时才入账） */
  alloy: number;
  /** 本局滚过的词条批数（`Affixes.rollStream` 的计数）。
   *  为什么要有它：词条用**自己的**随机流（由主随机流的状态派生），
   *  所以它不会扰动主序列 —— 这条计数保证"同一状态下的下一次派生是同一个数"
   *  （读档 / 回放逐位可复现），而它本身不进存档（主流的状态已经进存档了）。 */
  affixN: number;
  charDef: CharDef;
  /** 武器联动的折叠结果（**派生值**，每次 recalcStats 重算；界面直接读） */
  synergy: SynergyFold;
  /** 道具套装的折叠结果（与 synergy 同形，**分开存**：界面画"我的道具"要单独一份） */
  itemSets: SynergyFold | null;
  /** 道具**机制类**效果的折叠结果（`{ specialId: 件数 }`，recalcStats 折一次）——
   *  模拟层读 `itemFx.turret` / `itemFx.extraProjectile`，不再每帧扫道具找字符串 */
  itemFx: Record<string, number>;
  stats: StatMap;
  stats_total: { kills: number; scrap: number; dmg: number; taken: number; healed: number; waves: number };
}

/** 局内制造（**营地在局外之后，这里只剩"这一局的回合"与计数**）
 *
 * ⚠ 改造前这个接口叫 `SessionCamp`，装着 `camp` / `campRow` / `campPoints` / `campFx`
 * —— 也就是"这一局临时盖的工坊"。营地搬到经营场景之后那四个字段全部迁去档案
 * （`Profile.campOwned()` / `campRow()` / `wallet.material` / `campFx()`），
 * 留在会话里的只有这两个计数加一个回合列表。接口改名是为了让"这里还有没有营地状态"
 * 这个问题在类型层面就能回答：**没有**。 */
interface SessionCraft {
  /** 这一波已经用过的产线（每波重置：经营那一侧的"回合"） */
  craftUsed: number[];
  /** 本局造了几件（结算展示；进存档） */
  craftCount: number;
  /** 本局打到多少**材料**（`gainMaterial` 记账）。只用于展示 —— 材料是**当场进钱包**的
   *  （不等结算），所以它不是"待入账"的数，而是"这一局赚了多少"的数 */
  materialEarned: number;
  /** 每波白送的刷新次数（据点 / 事件给的） */
  freeRerolls: number;
}

/** 商店与道具包（局内经济；买卖都在 market.ts） */
interface SessionMarket {
  offers: Offer[];
  levelCards: UpgradeCard[];
  packsOpened: number;
  packSpent: number;
  shopLocked?: boolean;
  rerolls?: number;
  rerollCost?: number;
  shopBonus?: number;
  /** 本局合成了几次（结算展示；进存档，读档不该清零） */
  combineCount?: number;
}

/** 地牢：地图由种子长出来，只有进度进存档 */
interface SessionDungeon {
  /** 当前层号（1 起） */
  floor: number;
  /** 当前这一层的地图（Dungeon.genFloor 的产物；进房/翻层时重建） */
  map: DungeonFloor | null;
  /** 当前在哪一间房 */
  roomId: string;
  /** 破过的墙：Dungeon.wallKey → true */
  walls: Record<string, boolean>;
  /** 当前房间里还没打穿的暗门墙（子弹/近战/爆炸打的就这一小份） */
  wallsNow: DungeonWall[];
  /** 这一间的房间效果（商店货架/折扣…进门折一次） */
  roomFx: { shopSlots?: number; shopDiscount?: number; fastMul?: number; slowMul?: number };
  /** 这一间的奖励倍率（事件房会改它：代价与好处并存） */
  bonusMul: number;
  /** 这一局发现过几间密室 */
  secretsFound: number;
  /** 这一局打到的**核心材料**（Boss 掉落；结算时才入档）。
   *  它是 `economy.ts` 里 `meta-rare` 那一档唯一的来源，所以必须跟着存档走。 */
  coreEarned: number;
  /** 这一局通关了吗（成绩码回放按**事实**核对，不再按波次推断） */
  won: boolean;
  /** 当前这一间的 Boss id（只有 Boss 房有；由**层**决定） */
  bossId: string | null;
  /** 这一局打倒了哪些 Boss（剧情碎片的输入） */
  bossesDown: Record<string, boolean>;
  /** 这一局在事件房见过的遭遇 id */
  runEvents: string[];
  /** 层间契约：已挑的那条 id（'' = 没挑）与它折出来的三组修正 */
  boon: string;
  boonFold: BoonsFold | null;
  /** 还没挑的契约候选 */
  pendingBoons: string[];
  /** 难度 × 房型 × 层主题的折叠结果（进房算一次；敌人属性读它） */
  wmods: DangerMods | null;
  /** 钉住这一间不自动结束（测试/调试用） */
  roomHold: boolean;
}

/** 当前这一波（刷怪队列与波次计时） */
interface SessionWave {
  waveT: number;
  waveLeft: number;
  waveScrap: number;
  waveEnding: boolean;
  forceClear: boolean;
  spawnQueue: SpawnItem[];
  spawnIdx: number;
}

/** 场上活着的东西（容器账目见 containers.ts；游标是环形缓冲的位置） */
interface SessionEnts {
  player: Player;
  weapons: WeaponInst[];
  enemies: Enemy[];
  bullets: Bullet[];
  ebullets: EnemyBullet[];
  pickups: Pickup[];
  particles: Particle[];
  textParticles: Particle[];
  freeParticles: Particle[];
  freeTextParticles: Particle[];
  visCursor: number;
  textCursor: number;
  decals: Decal[];
  decalSeq: number;
  decalCursor: number;
  stainBudget: number;
  turrets: Turret[];
  /** 空间网格（每帧重建；只用于查询，不进存档） */
  grid: { cell: number; map: Record<string, Enemy[]> };
  /** 实体 id 计数器（子弹/飘字/贴花都用它取号；只增不减） */
  nextId: number;
}

/** 只有调试 / 测试 / 演示会碰的字段 */
interface SessionDebug {
  time?: number;
  /** 开火计数：生产代码只写不读，测试用它验证"每把武器都能开火" */
  shots?: number;
  arena?: ArenaData;
}

interface Session extends SessionCore, SessionCraft, SessionMarket, SessionDungeon, SessionWave, SessionEnts, SessionDebug {}

/** 一种房型的"进门内容"（game.ts 的 ROOM_FX 表） */
interface RoomFxDef {
  /** 给人看的说明（界面复用；**不得**在 ui.ts 里再写一份房型文案） */
  note: string;
  /** 进门时的一次性效果；返回给人看的一句（没有就返回 null） */
  enter?: (p: Player, room: DungeonRoom) => string | null;
  /** 在这一间里开的商店：多几件货 / 打几折 */
  shopSlots?: number;
  shopDiscount?: number;
  /** 这一间把"速清/超时"两档奖励换成什么（限时房用；0 = 用全局配置） */
  fastMul?: number;
  slowMul?: number;
}

/** 事件房的一次遭遇（代价与好处并存） */
interface RoomEventDef {
  id: string;
  name: string;
  note: string;
  apply(p: Player, room: DungeonRoom): string;
}

/* ---------------- 层间契约（boons.ts） ---------------- */
interface BoonDef {
  id: string;
  name: string;
  note: string;
  /** 效果键 → 值（键必须在 boonMod 家族里声明过） */
  mods: Record<string, number>;
}
interface BoonsModKey {
  /** 折到哪一组：enemy 进 wmods / econ 模拟层各读一次 / stats 并进属性表 */
  group: string;
  how: string;
  note: string;
}
interface BoonsFold {
  id: string;
  enemy: Record<string, number>;
  econ: Record<string, number>;
  stats: Record<string, number>;
}
interface BoonsApi {
  LIST: BoonDef[];
  BY_ID: Record<string, BoonDef>;
  MOD_KEYS: Record<string, BoonsModKey>;
  /** 把一条契约折成三组（缺省 = 恒等） */
  fold(id: string | BoonDef | null): BoonsFold;
  /** 一条契约的一行行说明（键自带文案） */
  lines(id: string | BoonDef | null): string[];
  effectText(key: string, v: number): string;
  describe(id: string | BoonDef | null): string;
  /** 抽 n 条不重复的候选（用调用方给的 rnd） */
  roll(n: number, rnd: () => number): string[];
  audit(): { ok: boolean; problems: string[]; counts: any };
}

interface RunSummary {
  win: boolean; wave: number; level: number;
  kills: number; scrap: number; damage: number; taken: number; healed: number;
  /** **带出去的材料**：局内攒下的累计（`stats_total.scrap`），不是手里剩的那个数 */
  earned?: number;
  charName: string; weapons: string[]; items: string[];
  stats: StatMap; packs: number; packSpent: number; quit?: boolean;
  /** 本局难度等级（0 = 基准） */
  danger: number;
  /** 角色 id（挑战里的"用某角色…"要靠它，charName 只是给人看的） */
  char: string;
  /** 本局带过的武器 / 道具 id（图鉴"用过"）与其中到顶层的（"满级过"） */
  weaponIds: string[]; itemIds: string[];
  masteredWeaponIds: string[]; masteredItemIds: string[];
  /* ---- 剧情要的"这一局碰到了什么来源" ---- */
  /** 打到第几层 */
  floor: number;
  /** 这一局打赢的 Boss id */
  bossesDown: string[];
  /** 这一局发现了几间密室 */
  secrets: number;
  /** 这一局在事件房见过的遭遇 id */
  events: string[];
}

interface BusStats {
  emits: number; calls: number; errors: number; refused: number;
  lastError: Error | null; listeners: number;
}

interface Bus {
  name: string;
  on(evt: string, fn: (payload?: any) => void): (payload?: any) => void;
  once(evt: string, fn: (payload?: any) => void): (payload?: any) => void;
  off(evt: string, fn: (payload?: any) => void): Bus;
  clear(evt?: string): Bus;
  listenerCount(evt?: string): number;
  events(): string[];
  stats(): BusStats;
  emit(evt: string, payload?: any): Bus;
}

/* ---------------- 各模块的公开 API ---------------- */
/** 种子化随机的函数（带状态读写：存档要它才能"接着走"，见 utils.ts 的 U.rng） */
interface RngFn {
  (): number;
  state(): number;
  setState(v: number): RngFn;
}

interface UtilsApi {
  TAU: number;
  clamp(v: number, a: number, b: number): number;
  lerp(a: number, b: number, t: number): number;
  dist2(ax: number, ay: number, bx: number, by: number): number;
  dist(ax: number, ay: number, bx: number, by: number): number;
  angle(ax: number, ay: number, bx: number, by: number): number;
  round2(v: number): number;
  approach(cur: number, target: number, maxStep: number): number;
  /**
   * 种子化随机（xorshift32）。返回的函数**带着状态读写**：
   * `state()` 取当前状态、`setState(v)` 放回去 —— 存档要它才能"接着走"，
   * 否则读档会把随机流重置回种子起点（实测过：读档后 5 个数完全不同）。
   * 两个方法都不改变序列本身（指纹不受影响）。
   */
  rng(seed?: number): RngFn;
  seedFromStr(str: string): number;
  plus(v: number): string;
  fmtNum(v: number): string;
  pickWeighted<T extends { w: number }>(entries: T[], rnd?: () => number): T;
  cloneObj<T>(o: T): T;
  $(sel: string, root?: ParentNode): HTMLElement | null;
  $$(sel: string, root?: ParentNode): HTMLElement[];
  /* 返回 **HTMLElement** 而不是 any：这一条 any 是界面层所有 `var b: any = U.el(...)`
     的源头。写清楚了，调用方就不必再自己贴一遍 any。 */
  el(tag: string, cls?: string, html?: string): HTMLElement;
  clear(node: ParentNode | null): void;
  fullscreenSupported(): boolean;
  isFullscreen(): boolean;
  toggleFullscreen(): boolean;
  Bus(name?: string): Bus;
  injectCSS(id: string, text: string): void;
  injectBaseCSS(): void;
  /** 复制文本到剪贴板（**不抛**；失败返回 false，调用方据此给提示） */
  copyText(text: string): boolean;
  /** 读剪贴板（异步；读不到给空串） */
  readClipboard(cb: (text: string) => void): boolean;
}

interface DrawOptions {
  outline?: string | null | false;
  outlineWidth?: number;
  alpha?: number;
  fillColor?: string;
  rot?: number;
  seed?: number;
  bump?: number;
  close?: boolean;
  slope?: number;
  white?: boolean;
  weight?: number;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  x?: number; y?: number; ox?: number; oy?: number;
  clipTo?: (x: any) => void;
}

interface DrawApi {
  OUT: number;
  O: Record<string, DrawOptions>;
  ink(x: any, color?: string, width?: number): void;
  fill(x: any, color?: string): void;
  bronanaPath(x: any, rx: number, ry: number, seed?: number, bump?: number): void;
  starPath(x: any, spikes: number, rOut: number, rIn: number, rot: number): void;
  rect(c: any, x0: number, y0: number, w: number, h: number, color?: string | null, o?: DrawOptions): void;
  roundRect(c: any, x0: number, y0: number, w: number, h: number, r: number, color?: string | null, o?: DrawOptions): void;
  circle(c: any, cx: number, cy: number, r: number, color?: string | null, o?: DrawOptions): void;
  ellipse(c: any, cx: number, cy: number, rx: number, ry: number, rot: number, color?: string | null, o?: DrawOptions): void;
  poly(c: any, pts: number[][], color?: string | null, o?: DrawOptions): void;
  blob(c: any, pts: number[][], r: number, color?: string | null, o?: DrawOptions): void;
  bronana(c: any, cx: number, cy: number, rx: number, ry: number, color?: string | null, o?: DrawOptions): void;
  arcRing(c: any, cx: number, cy: number, r: number, a0: number, a1: number, width: number, color: string, o?: DrawOptions): void;
  capsule(c: any, x0: number, y0: number, x1: number, y1: number, w: number, color: string, o?: DrawOptions): void;
  eye(c: any, cx: number, cy: number, r: number, style: string, o?: DrawOptions): void;
  mouth(c: any, cx: number, cy: number, w: number, style: string, color?: string): void;
  dots(c: any, cx: number, cy: number, r: number, n: number, seedStr?: string, color?: string, size?: number): void;
  ditherBand(x: any, x0: number, x1: number, y: number, h: number, cA: string, cB: string, seedStr?: string, density?: number): void;
  text(c: any, str: string, x0: number, y0: number, size: number, color?: string, o?: DrawOptions): void;
  at(c: any, x0: number, y0: number, rot: number, fn: (g: any) => void): void;
}

/** 宣传美术件（标题字 / 徽记）：逐字画而不是 `fillText`，于是宽度是算出来的 */
interface EmblemDef {
  id: string;
  /** 逐字画：字符 + 基线偏移（进深靠它错落） */
  glyphs: Array<{ ch: string; dy?: number }>;
  /** 副题（小一号、字距拉开） */
  sub: string;
  /** 逻辑尺寸（画布按设备倍率放大） */
  w: number;
  h: number;
  note: string;
}

interface SpritesApi {
  kinds: Record<string, { cullR: number | ((o: any) => number); draw: (x: any, o: any) => void }>;
  register(kind: string, def: { cullR?: number | ((o: any) => number); draw: (x: any, o: any) => void }): any;
  cullRadius(obj: { kind: string }): number;
  drawObj(x: any, obj: { kind: string }): void;
  bulletCullR(b: { kind: string }): number;
  reset(): void;
  setScale(scale: number): boolean;
  scale(): number;
  cacheStats(): SpriteCacheStats;
  domCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; width: number; height: number; scale: number } | null;
  drawBronana(x: any, cx: number, cy: number, rx: number, ry: number, skin: any, seed?: number, opts?: any): void;
  bronanaPortrait(size: number, charDef: CharDef): Sprite | null;
  /** 枢纽"站点"的头像（NPC 与设施各一张；未知 id 走兜底牌） */
  stationPortrait(id: string, size?: number): Sprite | null;
  warmPlayerAtlas(charDef: CharDef, opts?: { r?: number; sy?: number; minSy?: number; maxSy?: number; skin?: any; seed?: number; eyeStyle?: string }): number;
  playerBodySprite(charDef: CharDef, opts: { r?: number; sy?: number; skin?: any; seed?: number; face?: number; mood?: string; eyeStyle?: string; mouthStyle?: string; dots?: boolean }): Sprite | null;
  enemySprite(def: EnemyDef): Sprite | null;
  enemyBox(def: EnemyDef): EnemyBox;
  enemyFlash(def: EnemyDef): Sprite | null;
  drawEnemy(x: any, e: Enemy, time: number, ox?: number, oy?: number): void;
  weaponSprite(kind: string, tints: string[] | undefined, scale?: number, swing?: number): Sprite | null;
  WEAPON_SWING_SHAPED: Record<string, boolean>;
  drawWeapon(x: any, kind: string, rot: number, tints: string[] | undefined, swing: number, scale: number): void;
  itemIcon(icon: string, tint: string | undefined, size?: number): Sprite | null;
  drawBullet(x: any, b: Bullet, ox?: number, oy?: number): void;
  pickupSprite(kind: string): Sprite | null;
  drawPickup(x: any, p: Pickup, time: number): void;
  drawTurret(x: any, t: Turret, time: number): void;
  /** 瓦片画法：`art_tiles.ts` 的形状 → 像素。接缝方向由 `mask` 决定 */
  drawTile(x: any, def: ArtTilesetDef, tileId: string, mask: number,
    px: number, py: number, size: number,
    col: { fill?: string; lit?: string; dark?: string; seam?: string; inset?: number; bevel?: boolean }): boolean;
  drawEnemyBullet(x: any, b: EnemyBullet, time: number, ox?: number, oy?: number): void;
  /** 宣传美术件（标题字 / 徽记） */
  EMBLEMS: EmblemDef[];
  EMBLEM_BY_ID: Record<string, EmblemDef>;
  drawEmblem(x: any, emblem: string | EmblemDef, scale: number): boolean;
  /** 把一枚宣传美术件烘成缓存贴图（界面把它塞进 `<canvas>`） */
  emblemSprite(id: string): Sprite | null;
  /** 定义期自检：粒子注册表每一项都能画（`S.drawObj` 会静默跳过没有 draw 的） */
  audit(): { ok: boolean; problems: string[]; counts?: Record<string, number> };
}

/* ---------------- 存储 / 设置 / 存档 ---------------- */
/** 与 localStorage 同形的存储适配器（浏览器直接传 window.localStorage） */
interface StorageAdapter {
  name?: string;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface StorageApi {
  KEYS: { settings: string; run: string; records: string; profile: string };
  MAX_BYTES: number;
  memory(map?: Record<string, string>): StorageAdapter;
  use(adapter: StorageAdapter | null): boolean;
  adapterName(): string;
  get(key: string): string | null;
  set(key: string, value: string): boolean;
  remove(key: string): boolean;
  getJSON(key: string): any;
  setJSON(key: string, value: any): boolean;
  lastError(): string | null;
  /**
   * 清空全部键。
   * **同时通知持有内存副本的模块**（`Profile` / `Settings`）——
   * 只删键不通知的表现是"点了清空，数值还在"（那些模块的内存副本还活着）。
   * `opts.silent` 只删键、不发通知（测试里想观察"没有通知时会怎样"时用）。
   */
  wipe(opts?: { silent?: boolean }): void;
  /** 订阅"存储被清空"（谁持有内存副本谁订阅） */
  onWipe(fn: () => void): () => void;
  emitWipe(): void;
  /** 备份键名（`key + '.bak'`） */
  BAK_SUFFIX: string;
  backupKey(key: string): string;
  /** 写入并留下上一版备份（崩溃安全） */
  setJSONSafe(key: string, value: any): { ok: boolean; backedUp: boolean; reason: string };
  /** 读 JSON，坏档时自动回退到备份 */
  getJSONSafe(key: string): { value: any; recovered: boolean; reason: string };
  /** 彻底删掉一个键（主 + 备份）—— 清档/重置必须走它 */
  removeAll(key: string): boolean;
  /** 存档槽位数 */
  SLOTS: number;
  /** 槽位键名（0 号槽就是原键名 —— 老存档天然在 0 号槽，不需要迁移链） */
  slotKey(key: string, slot: number): string;
  slotOf(key: string): number;
}

interface SettingDef {
  type: 'bool' | 'number' | 'enum' | 'key' | 'string';
  def: any;
  min?: number; max?: number; step?: number;
  values?: number[];
  /** `type:'string'` 的合法取值（枚举式字符串，如语言 id / 动效档位） */
  options?: string[];
  label: string;
  note?: string;
}

/* ---------------- 首局引导（tutorial.ts） ---------------- */
interface TutorialHintDef {
  id: string;
  /** 触发时机（`Tutorial.WHEN` 里的名字，声明式 —— 于是能被一条条数出来） */
  when: string;
  /** 文案：中文原文同时是 i18n 的键 */
  text: string;
  /** 为什么要有这条提示 */
  note: string;
}
interface TutorialApi {
  LIST: TutorialHintDef[];
  BY_ID: Record<string, TutorialHintDef>;
  WHEN: Record<string, string>;
  whenNames(): string[];
  /** 载入"已经说过的"（由 Profile 在 load 之后灌进来） */
  hydrate(record: any): number;
  snapshot(): Record<string, boolean>;
  seenCount(): number;
  isSeen(id: string): boolean;
  setEnabled(on: boolean): boolean;
  enabled(): boolean;
  /** 清空记录（设置页"再看一遍引导"） */
  forget(): boolean;
  /** 这个时机该不该说点什么（**不改状态**，标记由 mark 显式做） */
  pending(when: string, opts?: { force?: boolean }): TutorialHintDef[];
  mark(id: string): boolean;
  /** 记录变更通知（谁负责落盘谁订阅 —— tutorial 不认识账号档案） */
  onChanged(fn: () => void): () => void;
  emitChanged(): void;
  audit(): { ok: boolean; problems: string[]; counts: { hints: number; whens: number } };
}

/* ---------------- 存档槽位与档案搬运（slots.ts） ---------------- */
interface SaveSlotApi {
  COUNT: number;
  current(): number;
  /** 最近一次"读档发现坏档并回退"的记录（界面据此提示玩家，不是静默丢进度） */
  lastRecovery(): { key: string; slot: number; reason: string; at: number } | null;
  clearRecovery(): void;
  key(base: string, slot?: number): string;
  used(slot?: number): boolean;
  list(): Array<{ slot: number; used: boolean }>;
  select(slot: number): boolean;
  next(): boolean;
  prev(): boolean;
  onChange(fn: (slot: number) => void): () => void;
  readJSON(key: string): any;
  writeJSON(key: string, value: any): { ok: boolean; backedUp: boolean; reason: string };
  exportText(slot?: number): string;
  importText(text: string, slot?: number): { ok: boolean; reason: string; keys: number };
  reset(slot?: number): number;
  /** 清掉当前槽位上的一个基键（主 + 备份一起删） */
  clear(base: string): boolean;
  audit(): { ok: boolean; problems: string[]; counts: { slots: number; carried: number } };
}

/* ---------------- 本地化（i18n.ts） ---------------- */
interface LocaleDef {
  id: string;
  /** **母语名**：界面永远按这个名字显示语言（一个只懂中文的玩家要能在英文界面里找回中文） */
  name: string;
  en: string;
  dir: 'ltr' | 'rtl';
  default: boolean;
}
interface I18nCoverage {
  total: number; translated: number; missing: number; ratio: number;
}
interface I18nApi {
  LOCALES: LocaleDef[];
  DEFAULT: string;
  has(id: string): boolean;
  current(): string;
  /** 切语言；只认清单里的 id（不认识就保持原样并返回 false）。root 可选，只重写子树 */
  set(id: string, root?: any): boolean;
  /** 取译文。键 = 中文原文；查不到回退到键本身（也就是回退到中文） */
  t(key: string, vars?: Record<string, any>): string;
  /** 绑定：把 DOM 里的中文原文记下来（只记一次） */
  bindDom(root?: any): number;
  /** 应用：按当前语言写回绑过的节点 */
  applyDom(root?: any): number;
  coverage(id?: string): I18nCoverage;
  missingKeys(id?: string): string[];
  audit(): { ok: boolean; problems: string[]; counts: { locales: number; keys: number } };
}

interface SettingsApi {
  VERSION: number;
  /** 键位类设置项的合法键名（挡掉修饰键与输入法伪键名） */
  isBindableKey(k: any): boolean;
  init(): { loaded: boolean; dropped: string[]; repaired: string[] };
  load(): { loaded: boolean; dropped: string[]; repaired: string[] };
  save(): boolean;
  get(key: string): any;
  all(): Record<string, any>;
  keys(): string[];
  def(key: string): SettingDef;
  loadedFrom(): string;
  set(key: string, raw: any, source?: string): any;
  resetAll(): Record<string, any>;
  /** 设置表自检：键名 / 类型 / 默认值能不能过自己的校验 */
  audit(): { ok: boolean; problems: string[]; counts: { settings: number } };
  emit(key: string, value: any, source: string): void;
  onChange(fn: (key: string, value: any, source: string) => void): () => void;
}

interface SaveApi {
  VERSION: number;
  /** 版本迁移链：MIGRATIONS[from] 把 from 版升到 from+1 版 */
  migration(fromVersion: number, fn: (data: any) => any): number;
  migrationVersions(): number[];
  lastError(): string | null;
  saveRun(): boolean;
  hasRun(): boolean;
  peekRun(): { wave: number; char: string; charName: string; level: number; at: number } | null;
  loadRun(): Session | null;
  clearRun(): boolean;
  records(): Record<string, number>;
  addRun(summary: RunSummary | null): Record<string, number> | null;
  clearRecords(): boolean;
  resetAll(): void;
}

/* ---------------- 信封与迁移链（envelope.ts） ----------------
   机制只有一份，各域（存档 / 账号档案 / 将来别的）各拿一份
   独立的版本号与迁移链。 */
interface EnvelopeApi {
  name: string;
  VERSION: number;
  /** 注册一级迁移；同一级重复注册直接抛错 */
  migration(fromVersion: number, fn: (data: any) => any): number;
  migrationVersions(): number[];
  wrap(kind: string, data: any): { v: number; at: number; kind: string; data: any };
  open(raw: any, kind: string): any;
  lastError(): string | null;
  /** 调用方也能记原因（写盘失败、内容不可用之类不归信封管） */
  note(msg: string): void;
  clearError(): void;
}
interface EnvelopeFactoryApi {
  create(opts: { name: string; version: number }): EnvelopeApi;
}

/* ---------------- 账号档案（profile.ts） ---------------- */
interface PerCharRecord {
  runs: number; kills: number; scrap: number; bestWave: number; wins: number; level: number;
  /** 该角色**已解锁**的最高难度等级（StS 式：打赢第 N 级才解锁 N+1） */
  danger: number;
  /** 累计获得的天赋点（花掉的部分由已点节点反推） */
  points: number;
  /** 已点天赋的节点 id */
  talents: string[];
  /** 已经用掉几次洗点（前几次免费） */
  respecs: number;
}
interface ProfileSnapshot {
  spores: number;
  /** 局外第二种货币：**合金**（只由"合成"这条链产出，只用于图纸工坊） */
  alloy: number;
  /** 已解锁的图纸 id */
  forge: string[];
  unlocked: string[];
  codex: Record<string, number>;
  done: string[];
  perChar: Record<string, PerCharRecord>;
  daily: Record<string, DailyRecord>;
  /** 每周挑战：'YYYY-Www' -> 当周最好的一局 */
  season: Record<string, DailyRecord>;
  /** 据点设施 -> 等级 */
  keep: Record<string, number>;
  /** 上次"见面"的时间戳（离线产出按它结算） */
  lastSeen: number;
  updatedAt: number;
}
/** 一局结束后的并入报告：界面用它做提示 */
interface ProfileRunReport {
  spores: number;
  /** 这一局结算到的合金（合成链的产出） */
  alloy: number;
  /** 这一局打到的**核心材料**（Boss 掉落；`economy.ts` 的 meta-rare 那一档） */
  core: number;
  /** 这一局带出去的**材料**（`economy.ts` 的 bridge 那一档，只供经营） */
  material: number;
  completed: ChallengeDef[];
  unlocked: Array<{ family: string; id: string; amount?: number }>;
  codex: string[];
  /** 通关解锁的下一级难度（0 = 没解锁新的） */
  dangerUnlocked: number;
  /** 这一局获得的天赋点（0 = 没有） */
  pointsGained: number;
  /** 这一局推进的剧情（接线层据此弹提示；界面不认识 story 表） */
  story: ProfileStoryReport;
}

/** 一局之后剧情那边发生了什么（都只是"新拿到的东西"） */
interface ProfileStoryReport {
  /** 新入手的记录碎片（StoryFragmentDef 的数组） */
  fragments: StoryFragmentDef[];
  /** 当前已解锁的全部结局（按 order 排） */
  endings: StoryEndingDef[];
  /** 这一局第一次打赢的 Boss */
  newBosses: string[];
  /** 这一局发现了几间密室 */
  secrets: number;
  /** 这一局打到第几层 */
  floor: number;
}

/** 剧情进度（跨局；与 story.ts 的表一一对应） */
interface ProfileStoryState {
  runs: number; wins: number; bestFloor: number; secrets: number;
  bosses: Record<string, boolean>;
  fragments: Record<string, boolean>;
  said: Record<string, boolean>;
  endings: Record<string, boolean>;
  events: Record<string, boolean>;
}

/** 台词条件要的那份输入（story.ts 的 match 只认这几个键） */
interface StoryCtx {
  runs: number; wins: number; floor: number;
  fragments: number; bosses: number; secrets: number; endings: number;
  flags: Record<string, boolean>;
}
/** applyRun 的入参：本局观察值（peaks 由接线层在换波时采样） */
interface ProfileRunInput {
  char: string; wave: number; level: number;
  kills: number; scrap: number; damage: number; taken: number; healed: number;
  /** **带出去的材料**：局内攒下的累计（`stats_total.scrap`），不是手里剩的那个数 */
  earned?: number;
  packs: number; win?: boolean;
  /** 本局难度等级（通关时按它解锁下一级） */
  danger?: number;
  /** 本局的据点修正（只读 sporeMul：孢子产出倍率） */
  kmods?: StrongholdMods | null;
  /** 天赋折出来的经济修正（接线层从会话上取，与 kmods 同一条路径） */
  omods?: OpeningEcon | null;
  /** 本局累积的合金（合成产出；见 Profile.alloyForRun） */
  alloy?: number;
  /** 本局打到的核心材料（Boss 掉落；见 game.ts 的 CORE_PER_BOSS） */
  coreEarned?: number;
  weaponIds?: string[]; itemIds?: string[];
  masteredWeaponIds?: string[]; masteredItemIds?: string[];
  seenWeaponIds?: string[]; seenItemIds?: string[];
  peaks?: Record<string, number>;
  /* ---- 剧情（N2）：这一局碰到了哪些"来源" ---- */
  /** 打到第几层（深井判定用它） */
  floor?: number;
  /** 这一局打赢了哪几只 Boss（boss id） */
  bossesDown?: string[];
  /** 这一局发现了几间密室 */
  secrets?: number;
  /** 这一局见到的所有事件房遭遇 id */
  events?: string[];
}
interface ProfileApi {
  CODEX_SEEN: number; CODEX_USED: number; CODEX_MASTERED: number;
  init(): { loaded: boolean; discarded: boolean; reason: string | null };
  load(): { loaded: boolean; discarded: boolean; reason: string | null };
  save(): boolean;
  loadedFrom(): string;
  lastError(): string | null;
  writeOk(): boolean;
  snapshot(): ProfileSnapshot;
  isUnlocked(family: string, id: string): boolean;
  unlock(family: string, id: string): boolean;
  unlockedIds(family: string): string[];
  codexLevel(family: string, id: string): number;
  markCodex(family: string, id: string, level: number): boolean;
  codexStats(family: string): { total: number; seen: number; used: number; mastered: number };
  spores(): number;
  /** 孢子产出倍率的**总量**上限（据点"菌床" + 天赋经济节点，相加后封顶） */
  SPORE_MUL_CAP: number;
  sporesForRun(run: ProfileRunInput | null): number;
  addSpores(n: number): number;
  spendSpores(n: number): boolean;
  isDone(challengeId: string): boolean;
  doneIds(): string[];
  perChar(charId: string): PerCharRecord;
  /** 该角色已解锁的最高难度等级（0 = 只有基础难度） */
  dangerOf(charId: string): number;
  /** 提高某角色的难度上限；只升不降。返回是否真的变了 */
  unlockDanger(charId: string, level: number): boolean;
  applyRun(run: ProfileRunInput | null, totals: Record<string, number>): ProfileRunReport;
  /* ---- 剧情进度（N2）：判定在 story.ts，落账在这里 ---- */
  /** 台词条件要的那份输入 */
  storyCtx(): StoryCtx;
  fragmentCount(): number;
  hasFragment(id: string): boolean;
  /** 已收集的碎片（按表里的顺序） */
  fragmentsSeen(): StoryFragmentDef[];
  /** 已解锁的结局（条件达成即收藏，不回收） */
  endingsSeen(): StoryEndingDef[];
  hasEnding(id: string): boolean;
  /** 现在能出现的枢纽 NPC */
  npcsFor(): StoryNpcDef[];
  stationsFor(): StoryStationDef[];
  /** 某个 NPC 现在能说的话（说过的已被过滤） */
  linesFor(npcId: string): StoryLineDef[];
  /** 他说了这一句（once 的从此不再出现） */
  say(lineId: string): boolean;
  hasStoryNews(): boolean;
  /** 每个 NPC 各有几句新话（界面画"!"） */
  newsByNpc(): Record<string, number>;
  /** 把一个"来源"换成碎片（同一来源只给没拿过的那一片） */
  awardFragment(source: string): StoryFragmentDef | null;
  markEvent(id: string): boolean;
  eventsSeen(): string[];
  pastOf(charId: string): StoryPastDef | null;
  storySnapshot(): {
    runs: number; wins: number; bestFloor: number; secrets: number;
    fragments: number; bosses: number; endings: number;
    said: Record<string, boolean>; events: string[];
  };
  /** 每日挑战：当天最好的一局 */
  dailyOf(key: string): DailyRecord | null;
  recordDaily(rec: DailyRecord): { improved: boolean; best: DailyRecord | null; prev: DailyRecord | null };
  dailyKeys(): string[];
  /* ---- 每周挑战 ---- */
  seasonOf(week: string): DailyRecord | null;
  recordSeason(rec: DailyRecord): { improved: boolean; best: DailyRecord | null; prev: DailyRecord | null };
  seasonKeys(): string[];
  /* ---- 离线产出 ---- */
  lastSeen(): number;
  /** 结算离线产出（结算即把"上次见面"推到现在） */
  settleOffline(now?: number): { spores: number; minutes: number; minutesCounted: number; capped: boolean; reason: string; sporebed: number };
  /** 只把"上次见面"推到现在（不结算） */
  touchSeen(now?: number): number;
  /* ---- 天赋（角色养成） ---- */
  /** 累计获得的天赋点 */
  talentPoints(charId: string): number;
  /** 已花掉的点数（按该角色的扇区折扣算） */
  talentSpent(charId: string): number;
  /** 还能点多少 */
  talentFree(charId: string): number;
  /** 已点节点 id */
  talentsOf(charId: string): string[];
  /** 点一条天赋；返回是否可以（附原因） */
  takeTalent(charId: string, nodeId: string): { ok: boolean; reason: string; cost: number };
  /** 撤销最后一点（免费） */
  undoTalent(charId: string): boolean;
  /** 洗点：清空该角色的天赋，返回花了多少孢子（-1 = 孢子不够） */
  respecTalents(charId: string): { ok: boolean; reason: string; cost: number };
  /** 该角色开局条件的汇总（界面显示与开局都用它） */
  openingOf(charId: string): OpeningLoadout;
  /** 加天赋点（通关 / 里程碑给的），返回加了多少 */
  addTalentPoints(charId: string, n: number): number;
  /** 这个角色现在有几次免费洗点（据点「档案馆」L2 会加） */
  freeRespecsOf(charId: string): number;
  /** 现在洗一次点要花多少孢子（UI 与实际扣费共用这一个算法） */
  respecCostOf(charId: string): number;
  /* ---- 跨局据点 ---- */
  keepLevel(id: string): number;
  keepOwned(): Record<string, number>;
  /** 据点的折叠修正（开局交给 Game.newRun） */
  keepMods(): StrongholdMods;
  keepInvested(): number;
  /** 买 / 升级一个据点设施（花材料） */
  keepBuy(id: string): { ok: boolean; reason: string; cost: number; toLevel: number };
  /* ---- 跨局工坊（经营场景的产线）----
     改造前它在**局内会话**里（每局从零盖）；现在是账号资产。 */
  campLevel(id: string): number;
  campOwned(): Record<string, number>;
  /** 建造顺序（相邻组合靠它判定；升级不挪位置） */
  campRow(): string[];
  /** 顺序里剔除"不是真的建了"的设施（坏档防线） */
  campRowClean(): string[];
  /** 工坊效果的折叠（省料 / 抬档 / 回收） */
  campFx(): CampEffects;
  /** 这一局有几条产线（= 已建设施数；图纸名额由 craft.ts 另加） */
  campLines(): number;
  /** 买 / 升级一个工坊设施（花材料） */
  campBuy(id: string, opts?: { slots?: number; discount?: number; fullRefund?: boolean }):
    { ok: boolean; reason: string; cost: number; toLevel: number };
  /** 拆掉一个工坊设施（退一半材料；`fullRefund` 时全额） */
  campSell(id: string, opts?: { slots?: number; discount?: number; fullRefund?: boolean }):
    { ok: boolean; reason: string; refund: number };
  /** 界面铺一屏配方（费用 / 能不能造 / 造不造得起）—— **不写规则** */
  craftOptions(mods: ForgeMods): Array<{
    id: string; kind: 'weapon' | 'item'; refId: string; name: string; tier: number;
    cost: number; ok: boolean; reason: string; affordable: boolean;
  }>;
  /** 定义期自检：`blank()` 的键集合与 profileSection 清单互为镜像 */
  audit(): { ok: boolean; problems: string[]; counts?: Record<string, number> };
  /* ---- 图纸工坊（局外第三条腿：只解锁能力）---- */
  /** 现有合金 */
  alloy(): number;
  /** **核心材料**（economy.ts 的 meta-rare 那一档）：只有 Boss 掉。
   *  **没有 `spendCore`** —— 花钱的点各自在自己的账里扣（`keepBuy` / `forgeNode`
   *  本来就要一起落盘）；一个"只扣钱不保存"的公开方法只会多一次落盘，
   *  而且它曾经躺在那里一个调用点都没有（`core → 经营/养成` 因此是假边）。 */
  core(): number;
  addCore(n: number): number;
  /** 加合金（结算入账），返回加完的余额 */
  addAlloy(n: number): number;
  /** 钱包里的**材料**（跨局、从局内带出来、只供经营） */
  material(): number;
  /** 加材料（结算入账），返回加完的余额 */
  addMaterial(n: number): number;
  /** 花材料；不够就**不扣**并返回 false（调用方据此拒绝） */
  spendMaterial(n: number): boolean;
  /** 这一局能结算多少合金（基础产出 + 局内合成 + 熔炉加成） */
  alloyForRun(run: ProfileRunInput | null): number;
  /** 已解锁的图纸 id 列表 */
  forgeOwned(): string[];
  isForged(id: string): boolean;
  /** 能不能解锁这张图纸（前置、合金、核心材料三者分开说） */
  canForge(id: string): { ok: boolean; reason: string; cost: number; core: number; locked: boolean };
  /** 解锁一张图纸（花合金；顶档那张还要核心材料） */
  forgeNode(id: string): { ok: boolean; reason: string; cost: number; core: number };
  /** 图纸的折叠修正（开局交给 Game.newRun） */
  forgeMods(): ForgeMods;
  clear(): boolean;
  reset(): ProfileSnapshot;
}

/* ---------------- 离线产出（offline.ts） ---------------- */
interface OfflineResult {
  spores: number; minutes: number; minutesCounted: number; capped: boolean; reason: string;
}
interface OfflineApi {
  MAX_HOURS: number;
  MIN_MINUTES: number;
  MAX_LEVEL: number;
  RATE_PER_MIN: Record<number, number>;
  rateAt(level: number): number;
  settle(elapsedMs: number, sporebedLevel: number): OfflineResult;
  describe(): string;
  /** 定义期自检（速率表是否覆盖 0..MAX_LEVEL、单调、门槛与封顶自洽） */
  audit(): { ok: boolean; problems: string[] };
}

/* ---------------- 每周挑战（season.ts） ---------------- */
interface WeeklyRule { key: string; seed: number; char: string; danger: number; }
interface SeasonApi {
  weekKey(now?: number | null): string;
  seedFor(week: string): number;
  charFor(week: string): string | null;
  dangerFor(week: string): number;
  of(week?: string): WeeklyRule;
  bestOf(profile: { season?: Record<string, DailyRecord> } | null, week?: string): DailyRecord | null;
  pick(a: DailyRecord | null, b: DailyRecord | null): DailyRecord | null;
  audit(): { ok: boolean; problems: string[]; counts: any };
}

/* ---------------- 制造（craft.ts：经营这根柱子的核心） ----------------
   配方**不是手写的第三张表**：每一件已存在的装备/道具就是一条配方，
   费用由它自己的价格算出来。 */
interface CraftRecipe {
  /** `weapon:knife` / `item:coffee` —— 与存档、界面按钮同构 */
  id: string;
  kind: 'weapon' | 'item';
  refId: string;
  name: string;
  tier: number;
  /** 原价（费用 = 原价 × MARKUP × 各种省料） */
  base: number;
  def: WeaponDef | ItemDef;
}
interface CraftResult { tier: number; lucky: boolean; double: boolean; }
interface CraftAudit { ok: boolean; problems: string[]; counts: { recipes: number; weapons: number; items: number; tiers: number }; }
interface CraftApi {
  MARKUP: number;
  /** 商店那一边的"应急成品"溢价（market.ts 读它） */
  EMERGENCY_MARKUP: number;
  LIST: CraftRecipe[];
  BY_ID: Record<string, CraftRecipe>;
  /** 能不能造（门槛 = 图纸档位上限 `mods.craftTier`） */
  canMake(r: CraftRecipe | null, mods: ForgeMods | null): { ok: boolean; reason: string };
  /** 实际材料费用（原价 × MARKUP × 省料，封顶 60%） */
  costOf(r: CraftRecipe | null, mods: ForgeMods | null, campFx: CampEffects | null): number;
  /** 现在能造的配方（界面铺一屏） */
  available(mods: ForgeMods | null): CraftRecipe[];
  /** 这一次造出来是哪一档（营地的质量 + 图纸的质量；**没有加成时不抽随机数**） */
  resultTier(r: CraftRecipe, mods: ForgeMods | null, campFx: CampEffects | null, rnd?: () => number): CraftResult;
  /** 这条产线这一波还能不能用 */
  lineFree(used: number[] | null, line: number): boolean;
  /** 产线数 = 已建设施数 + 图纸给的名额 */
  linesOf(builtCount: number, mods: ForgeMods | null): number;
  audit(): CraftAudit;
}

/* ---------------- 图纸工坊（forge.ts） ----------------
   纪律：只解锁**能力**，没有一条是属性。键名与模拟层读的名字一致（没有改名层）。 */
interface ForgeMods {
  /** 图纸档位上限：能造到 T 几（工坊的主体 —— "解锁新装备和道具"就是这一条） */
  craftTier: number;
  /** 回收旧装备的返还加成 */
  salvageBonus: number;
  /** 回收旧装备额外产出的合金（合金**唯一**的稳定来源） */
  alloyPerSalvage: number;
  /** 同名不同档也能合成（0/1） */
  fuseDiff: number;
  /** 造出来的武器高一档的概率 */
  craftQuality: number;
  /** 额外产线（不占设施位） */
  lines: number;
  /** 结算合金倍率加成 */
  alloyMul: number;
}
interface ForgeNodeDef {  id: string; tier: number; cost: number; req: string[];
  /** 可选的第二价：**核心材料**（只有关底 Boss 掉，一局最多 3 个） */
  core?: number;
  mod: keyof ForgeMods; value: number; name: string; note: string;
}
interface ForgeAudit { ok: boolean; problems: string[]; counts: { nodes: number; keys: number }; }
interface ForgeApi {
  LIST: ForgeNodeDef[];
  BY_ID: Record<string, ForgeNodeDef>;
  MOD_KEYS: Record<string, { kind: 'add' | 'max'; text(v: number): string }>;
  TIER_NAME: Record<number, string>;
  /** 图纸树自己的"阶"（只是分组名：入门/工艺/大师/神话） */
  TIERS: Array<{ tier: number; name: string; note: string }>;
  emptyMods(): ForgeMods;
  /** 已解锁集合的唯一读法（数组或映射都收） */
  holds(owned: unknown, id: string): boolean;
  /** 归一成 `{ id: true }` 映射（数组与映射在项目里都真实存在） */
  toMap(owned: unknown): Record<string, boolean>;
  modsFor(owned: unknown): ForgeMods;
  reqsMet(owned: unknown, d: ForgeNodeDef): boolean;
  /** `core` 单列出来：两种资源都不够时要分得清"去打 Boss"和"多拆几件装备" */
  canUnlock(owned: unknown, id: string, alloy: number, core?: number):
    { ok: boolean; reason: string; cost: number; core: number; locked: boolean };
  nodeText(d: ForgeNodeDef): string;
  effectLines(mods: ForgeMods | null | undefined): string[];
  totalCost(): number;
  audit(): ForgeAudit;
}

/* ---------------- 跨局据点（stronghold.ts） ---------------- */
interface StrongholdMods {
  /** 开局材料（**开局条件**，不是局内数值） */
  startMaterials: number;
  /** 商店每列多几件货 */
  shopSlots: number;
  /** 每波白送的刷新次数 */
  freeRerolls: number;
  /** 工坊设施位上限（= 产线条数）—— 据点 → 制造那条边 */
  campSlots: number;
  /** 拆工坊设施全额返还（0/1）—— 能力，不是折扣 */
  refundFull: number;
  /** 离线产出等级（0 = 没买菌床就没有离线产出） */
  offlineLevel: number;
  /** 据点 → 天赋（「档案馆」）：额外免费洗点 / 每局额外天赋点 */
  freeRespecs: number;
  bonusPoints: number;
  /** **结构性解锁**（不是加数值）：刷新保 T3 / 开局多带一件道具 / 商店必出在用的武器类别 */
  workshop: number;
  rangeItem: number;
  depot: number;
}
/** 前置：想盖这个设施，得先把 `id` 盖到 `level` */
interface KeepReqDef { id: string; level: number; }
interface KeepLevelDef {
  cost: number;
  /** 可选的第二价：**核心材料**（只有关底 Boss 掉，一局最多 3 个） */
  core?: number;
  effect: Partial<StrongholdMods>;
}
interface KeepFacilityDef {
  id: string; name: string; note: string; levels: KeepLevelDef[];
  /** 前置链（没有就是基础设施） */
  req?: KeepReqDef;
}
interface StrongholdApi {
  LIST: KeepFacilityDef[];
  BY_ID: Record<string, KeepFacilityDef>;
  MOD_KEYS: Record<string, { note: string; text: (v: number) => string[] }>;
  /** 折叠修正 → 给人看的一行行（**文案的唯一实现**，界面与 describe 共用） */
  effectLines(mods: StrongholdMods | null): string[];
  effectText(key: string, value: number): string[];
  BASE: StrongholdMods;
  SPORE_MUL_CAP: number;
  maxLevel(id: string): number;
  levelOf(owned: Record<string, number> | null, id: string): number;
  /** `core` 单列出来：两种资源都不够时要分得清"去打 Boss"和"再打两把攒孢子" */
  canBuy(owned: Record<string, number> | null, id: string, spores: number, core?: number):
    { ok: boolean; reason: string; cost: number; core: number; toLevel: number; locked: boolean };
  /** 下一级要几个核心材料（界面用它标出"这一级要打过 Boss"） */
  coreFor(owned: Record<string, number> | null, id: string): number;
  /** 还差哪个前置（都满足就是 null） */
  missingReq(owned: Record<string, number> | null, id: string): KeepReqDef | null;
  /** 前置链的拓扑序（自检用它验"没有环"） */
  buildOrder(): string[];
  invested(owned: Record<string, number> | null): number;
  modsFor(owned: Record<string, number> | null): StrongholdMods;
  describe(owned: Record<string, number> | null): string;
  audit(): { ok: boolean; problems: string[]; counts: any };
}

/* ---------------- 武器联动（synergy.ts） ---------------- */
/** 武器家族：把"造型关键字"归成**玩法分组**（组合玩法靠它才有足够件数） */
interface SynergyFamilyDef {
  id: string; name: string; note: string;
  /** 属于这个家族的武器 kind（每个 kind 只能属于一个家族） */
  kinds: string[];
}
/** 一档联动：件数达到 `at` 时给 `stats`（**只取达到的最高一档**，不叠档） */
interface SynergyTierDef {
  at: number; title: string; text: string; stats: Record<string, number>;
  /** 少数档位还给一条**经济**修正（道具套装用；与天赋 econ 同一条路） */
  econ?: Record<string, number> | null;
}
/** 道具套装（F 的后半：道具没有"天生"分组，所以成员是显式声明的） */
interface SynergyItemSetDef {
  id: string; name: string; note: string;
  items: string[];
  tiers: SynergyTierDef[];
}
interface SynergyAxisDef {
  id: string; name: string; note: string;
  /** 按什么分组（fold 里唯一的 switch；表里不放函数，便于静态检查） */
  group: string;
  tiers: SynergyTierDef[];
}
/** 触发的一条联动 */
interface SynergyHit {
  axis: string; axisName: string; value: string; count: number; tier: SynergyTierDef;
}
/** 折叠结果：`stats` 是增量（没触发任何档时是空对象 = 恒等） */
interface SynergyFold {
  stats: Record<string, number>;
  active: SynergyHit[];
  /** 道具套装折出来的经济修正（只有道具那一条路会给；键与触发它的档一致） */
  econ?: Record<string, number>;
  /** 最接近触发的那条（界面用来提示"再拿一件就联动"） */
  near: { axis: string; axisName: string; value: string; count: number; need: number; next: SynergyTierDef } | null;
}
/** 一条轴上的一个分组（界面用来画进度） */
interface SynergyRow {
  axis: string; axisName: string; value: string; valueName: string; count: number;
  /** 已达成的最高档（没达成是 null） */
  tier: SynergyTierDef | null;
  /** 下一档（没有了是 null） */
  next: SynergyTierDef | null;
  /** 离下一档还差几件 */
  need: number;
}
interface SynergyApi {
  FAMILIES: SynergyFamilyDef[];
  FAMILY_BY_ID: Record<string, SynergyFamilyDef>;
  KIND_TO_FAMILY: Record<string, string>;
  AXES: SynergyAxisDef[];
  of(defs: WeaponDef[] | null): SynergyFold;
  familyName(id: string): string;
  valueName(axisId: string, value: string): string;
  /** 四条轴各自的进度（与 of() 共用同一张表，界面不自己算） */
  progress(defs: WeaponDef[] | null): SynergyRow[];
  /* ---- 道具套装（F 的后半） ---- */
  ITEM_SETS: SynergyItemSetDef[];
  /** 把一套**道具**折成套装加成（与 of() 同构：数件数 → 取最高档） */
  ofItems(defs: ItemDef[] | null): SynergyFold;
  /** 每一套的进度（件数为 0 的也列出来，否则玩家不知道有这几套） */
  setProgress(defs: ItemDef[] | null): SynergyRow[];
  setName(id: string): string;
  audit(): { ok: boolean; problems: string[]; counts: any };
}

/* ---------------- 剧情（story.ts） ---------------- */
/** 触发条件：都是"至少到过多少"的阈值 + 布尔 flag（纯数据，测试验它引用的东西存在） */
interface StoryWhen {
  runs?: number; wins?: number; floor?: number; fragments?: number;
  bosses?: number; secrets?: number; endings?: number; flag?: string;
}
interface StoryNpcDef {
  id: string; name: string; role: string; at: string; note: string;
  /** 解锁条件（null = 一开始就在） */
  unlock: StoryWhen | null;
}
interface StoryLineDef {
  npc: string; id: string; text: string; when: StoryWhen;
  /** 说过就不再出现（枢纽对话要有"清空"的进度感） */
  once: boolean;
}
/**
 * 枢纽里的一个**站点**（"家"里站着的人，或者摆着的一件设施）。
 * 站点的 `id` 同时是 `sprites.ts` 里那张头像的 id —— 于是"哪一站画成什么样"
 * 只有一处（加一站要同时加表和画法，总账会查出来）。
 */
interface StoryStationDef {
  id: string;
  name: string;
  /** 职能（界面上那一行小字：菌床 / 天赋 / 据点…） */
  role: string;
  /** 这一站是哪位 NPC 站在那儿（没解锁就不出现；设施站没有） */
  npc?: string;
  /** 走上去进入哪个界面（状态名；门口是 'chars'） */
  screen?: string;
}
interface StoryFragmentDef { id: string; from: string; title: string; text: string; }
interface StoryEndingDef {
  id: string; name: string; order: number; when: StoryWhen; text: string;
  /** 隐藏结局（条件里带 flag） */
  secret?: boolean;
}
interface StoryPastDef { char: string; line: string; epilogue: string; }
/** 层间旁白（翻层时打在横幅上的那一句；不带条件，所以不剧透） */
interface StoryNarrationDef { floor: number; text: string; }
/** 剧情条件上下文（接线层从档案里算出来喂给纯函数） */
interface StoryCtx {
  runs: number; wins: number; floor: number; fragments: number;
  bosses: number; secrets: number; endings: number;
  flags: Record<string, boolean>;
}
interface StoryApi {
  NPCS: StoryNpcDef[];
  /** 枢纽站点（4 位 NPC + 4 件设施）—— 枢纽界面的**唯一**数据来源 */
  STATIONS: StoryStationDef[];
  LINES: StoryLineDef[];
  /** flag 声明表（台词条件里能用的布尔量） */
  FLAGS: Record<string, string>;
  FRAGMENTS: StoryFragmentDef[];
  ENDINGS: StoryEndingDef[];
  PASTS: StoryPastDef[];
  BOSS_FRAGMENT: Record<string, string>;
  SOURCE_POOLS: Record<string, string[]>;
  match(when: StoryWhen | null, ctx: StoryCtx | null): boolean;
  lineAvailable(line: StoryLineDef, ctx: StoryCtx | null, said: Record<string, boolean> | null): boolean;
  linesFor(npcId: string, ctx: StoryCtx | null, said: Record<string, boolean> | null): StoryLineDef[];
  npcsFor(ctx: StoryCtx | null): StoryNpcDef[];
  /** 枢纽里该出现哪些站点（NPC 站按解锁条件；设施站一直在） */
  stationsFor(ctx: StoryCtx | null): StoryStationDef[];
  hasNews(ctx: StoryCtx | null, said: Record<string, boolean> | null): boolean;
  endingsFor(ctx: StoryCtx | null): StoryEndingDef[];
  fragmentFrom(source: string, have: string[] | null): string | null;
  fragment(id: string): StoryFragmentDef | null;
  /** 这一层的旁白（翻层横幅用；不带条件，不剧透） */
  narration(floor: number): string | null;
  NARRATION: StoryNarrationDef[];
  describe(): string;
  audit(): { ok: boolean; problems: string[]; counts: any };
}

/* ---------------- 地牢地图（dungeon.ts） ---------------- */
/** 房间类型（战斗/精英/宝箱/商店/营地/事件/Boss/密室…） */
interface DungeonRoomTypeDef {
  id: string;
  name: string;
  icon: string;
  /** 这一类的敌人预算倍率（0 = 不刷怪） */
  budgetMul: number;
  note: string;
  /** 精英房：这一批会整体精英化 */
  elite?: boolean;
  /** **隐藏房**：不显示在小地图上，墙上有裂纹，打穿才进得去 */
  secret?: boolean;
  /** 这类房自带的修正（键必须是 roomMod 家族声明过的，与 danger.ts 同名） */
  mods?: Record<string, number>;
  /** 小地图上的样式类（界面**不得**自己按房型 id 分支：分类属于数据） */
  cls: string;
}
/** 地牢修正键的折法（与 danger.ts 同构） */
interface DungeonModKey { how: string; note: string }
/** 一套环境配色（**看得见的那一半**：地面/碎石/岩石/裂纹/装饰物）
 *
 *  为什么配色属于"数据"而不是"渲染层的一堆 if"：
 *  地牢必须能脱离浏览器单测（test/dungeon.mjs 跑几百个种子），
 *  而"这一层是什么环境"是地图数据的一部分 —— 与门开在哪一面同理。
 *  渲染层只负责把这份配色画出来，不负责决定它。 */
interface ThemePal {
  /** 地面基色（整块平涂） */
  base: string;
  /** 纵向五条带的色调，**由深到浅**（与 render.ts 的 bandTone 同序） */
  tones: string[];
  pebble: string;
  pebbleHi: string;
  rock: string;
  rockHi: string;
  rockDark: string;
  /** 地面裂纹（细线） */
  crack: string;
  /** 装饰物的主色与暗色 */
  propA: string;
  propB: string;
}

/** 一层的主题（环境；**同一带里抽签**，层数越高越狠） */
interface FloorThemeDef {
  id: string;
  name: string;
  note: string;
  /** 难度带（1..4）。层号决定**带**，带内的主题由种子抽 —— 所以"多难"是层决定的，
   *  "长什么样"是这一局决定的 */
  band: number;
  /** 敌人池偏移（越大越容易出后面的怪） */
  poolShift: number;
  /** 生命/伤害的额外倍率 */
  hpMul: number;
  dmgMul: number;
  /** 装饰物种类（render.ts 的 PROP_DRAW 认得的那几个 id） */
  prop: string;
  /** 这一带环境的地面/装饰配色 */
  pal: ThemePal;
}
/** 一堵暗门墙（当前房间里还没打穿的那些） */
interface DungeonWall {
  from: string;
  to: string;
  /** 它在哪一面（0..3，与 doors 同序） */
  dir: number;
  /** 墙在战场上的像素位置 */
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** 刚被打中的闪烁（渲染用） */
  flash?: number;
}

/** 地图上的一个格子（房间）。x/y 是格子坐标，不是像素 */
interface DungeonRoom {  id: string;
  x: number;
  y: number;
  type: string;
  /** 从起点走几步到这里（用来定难度与"哪个死路当 Boss 房"） */
  depth: number;
  /** 四面墙：[上, 右, 下, 左]，1 = 有门 */
  doors: number[];
  /** 与哪几个邻居之间的门是**暗门**（要打穿墙），键是邻居 id */
  hiddenDoors?: Record<string, boolean>;
  /** 墙上的裂纹种子（渲染层据此画"可疑的墙"；没有暗门时为 0） */
  clueSeed?: number;
  /** 这一间是不是已经清干净了（模拟层用；地图生成时是 false） */
  cleared?: boolean;
  /** 有没有被玩家发现过（隐藏房专用：没发现就不画在小地图上） */
  seen?: boolean;
}
interface DungeonFloor {
  /** 这一层的唯一键：`F<层号>-<种子>`，用来给装饰烘焙当缓存键 */
  key: string;
  seed: number;
  floor: number;
  theme: string;
  rooms: DungeonRoom[];
  start: string;
  boss: string;
  secrets: string[];
  /** 房间数（不含密室） */
  count: number;
}
interface DungeonApi {
  FLOORS: number;
  GRID: number;
  TYPES: DungeonRoomTypeDef[];
  TYPE_BY_ID: Record<string, DungeonRoomTypeDef>;
  THEMES: FloorThemeDef[];
  THEME_BY_ID: Record<string, FloorThemeDef>;
  /** 带号 → 这一带的环境表（抽签从它里面挑） */
  THEME_BY_BAND: Record<number, FloorThemeDef[]>;
  /** 难度带数（= 环境档数）。层号决定**带**，带内的主题由种子抽 */
  BANDS: number;
  /** 每一带的难度中心（**就是改造前那一档的值**，所以抽签不改难度，只改环境） */
  BAND_CENTER: Record<number, { hp: number; dmg: number; shift: number }>;
  /** 装饰物种类的唯一出处（render.ts 必须认得每一个；声明了却没人画 = 它不存在） */
  PROP_KINDS: string[];
  /** 某一层属于哪一带（1..BANDS） */
  bandOf(floor: number): number;
  /** 某一层这一局是什么环境 —— **纯函数 (种子, 层号)**，不吃地图的随机流 */
  themeFor(seed: number, floor: number): FloorThemeDef;
  genFloor(seed: number, floor: number): DungeonFloor;
  /** 四类特殊房（宝箱 / 商店 / 补给 / 事件）——一局的分配就由它们组成 */
  RUN_SPECIALS: string[];
  /** 一局的特殊房分配：`[层][4]`。纯函数（同种子必得同分配），保证每类本局至少出现一次 */
  runPlan(seed: number): string[][];
  roomById(fl: DungeonFloor, id: string): DungeonRoom | null;
  at(fl: DungeonFloor, x: number, y: number): DungeonRoom | null;
  neighbours(fl: DungeonFloor, room: DungeonRoom): DungeonRoom[];
  /** 这一间有没有通往 to 的门（暗门也算"有"，但要先破墙） */
  link(fl: DungeonFloor, room: DungeonRoom, to: DungeonRoom): { door: boolean; hidden: boolean } | null;
  /** 密室相邻的可破墙（破哪一面都行） */
  breakables(fl: DungeonFloor, secretId: string): { from: string; to: string }[];
  /** 门的开口中心（**归一化** 0..1；乘 Arena.W/H 才是像素） */
  doorFrac(dir: number): { fx: number; fy: number };
  /** 开口半宽（归一化）与暗门墙的血量 */
  DOOR_HALF: number;
  WALL_HP: number;
  /** 一面墙的唯一键（无向；**键里带层号**，否则读档会静默丢掉别的层的记录） */
  wallKey(fl: number, a: string, b: string): string;
  /** 这面墙破了吗（`fl` = 哪一层） */
  wallOpen(walls: Record<string, boolean> | null, fl: number, a: string, b: string): boolean;
  /** 最短路径（房间 id 数组，含两端）。暗门默认不算通路，破过的才算 */
  path(fl: DungeonFloor, fromId: string, toId: string, walls?: Record<string, boolean> | null): string[];
  /** 这一层这一间房贡献的修正（恒等起算） */
  modsFor(fl: DungeonFloor | null, roomId: string | null): Record<string, number>;
  /** 把难度那套折叠结果与地牢的合成一份（只认 base 已有的键） */
  foldMods(base: any, fl: DungeonFloor | null, roomId: string | null): any;
  themeLines(fl: DungeonFloor | null): string[];
  roomText(room: DungeonRoom | null): string;
  MOD_KEYS: Record<string, DungeonModKey>;
  MOD_BASE: Record<string, number>;
  /** 四方向步长：[上, 右, 下, 左] */
  DIRS: number[][];
  /** 关键房型 id 的唯一出处（界面/模拟层判"这是不是关底"时读它） */
  BOSS_TYPE: string;
  START_TYPE: string;
  SECRET_TYPE: string;
  /** 玩家在地图上"应该看得见"的房间（隐藏房要发现过才显示） */
  visible(fl: DungeonFloor): DungeonRoom[];
  /** 一行行给人看；**默认不泄露隐藏房**，调试用 reveal=true */
  describe(fl: DungeonFloor, reveal?: boolean): string;
  audit(): { ok: boolean; problems: string[]; counts: any };
}

/* ---------------- 局内工坊（camp.ts：制造这根柱子在局内的那一半） ----------------
   **五个键全部只作用于制造** —— 一个都不碰战斗数值。
   这是"三根柱子解耦"的落地判据，camp.ts 的自检会拒绝任何战斗向的键。 */
interface CampEffects {
  /** 造武器的材料折扣 */
  weaponCost: number;
  /** 造道具的材料折扣 */
  itemCost: number;
  /** 造出的武器高一档的概率 */
  weaponQuality: number;
  /** 造出的道具多给一件的概率 */
  itemDouble: number;
  /** 回收返还加成 */
  salvageBonus: number;
}
interface CampLevelDef { cost: number; effect: Partial<CampEffects>; }
interface CampFacilityDef {
  id: string; name: string; note: string;
  levels: CampLevelDef[];
}
/** 相邻组合：两个设施**挨着**（建造顺序相邻）时额外生效 */
interface CampComboDef {
  a: string; b: string; name: string; note: string;
  effect: Partial<CampEffects>;
}
interface CampApi {
  SLOTS: number;
  /** 每波到账的建材（出击带回来的那一份） */
  POINTS_PER_WAVE: number;
  /** 三个封顶值：省料 / 质量 / 回收，防止叠到免费或 100% */
  COST_CAP: number;
  QUALITY_CAP: number;
  SALVAGE_CAP: number;
  LIST: CampFacilityDef[];
  BY_ID: Record<string, CampFacilityDef>;
  EFFECT_KEYS: Record<string, { note: string; text: (v: any) => string[] }>;
  /** 折叠效果 → 给人看的一行行（**文案的唯一实现**，界面与 describe 共用） */
  effectLines(fx: CampEffects | null): string[];
  effectText(key: string, value: any): string[];
  COMBOS: CampComboDef[];
  levelOf(state: Record<string, number> | null, id: string): number;
  maxLevel(id: string): number;
  /** 已建设施数 = **产线条数** */
  usedSlots(state: Record<string, number> | null): number;
  /** opts 让调用方带入据点给的好处（位子更多、价格更便宜），默认就是基准值 */
  canBuy(state: Record<string, number> | null, id: string, scrap: number, opts?: { slots?: number; discount?: number }): { ok: boolean; reason: string; cost: number; toLevel: number };
  refundOf(state: Record<string, number> | null, id: string, opts?: { discount?: number; fullRefund?: boolean }): number;
  /** 这一行里生效的组合（row = 按建造顺序排的设施 id） */
  combosFor(row: string[] | null): CampComboDef[];
  /** 这两个设施之间有没有组合 */
  comboOf(a: string, b: string): CampComboDef | null;
  effects(state: Record<string, number> | null, row?: string[] | null): CampEffects;
  describeState(state: Record<string, number> | null, row?: string[] | null): string;
  audit(): { ok: boolean; problems: string[]; counts: any };
}

/* ---------------- 天赋树（talents.ts） ---------------- */
/**
 * 经济修正（天赋"经营扇区"的产物）。
 * 键名与据点 / 营地的修正键**完全一致**（没有改名层）——
 * 这样"声明了却没人读"能被静态检查一眼看穿。
 */
interface OpeningEcon {
  shopDiscount: number;
  campDiscount: number;
  rerollDiscount: number;
  sporeMul: number;
  /** 每波到账的材料（与击杀脱钩的固定产出 —— 经济流能立住的原因） */
  waveIncome: number;
}
/** 开局条件：天赋唯一能改的东西（起始属性 / 起始携带 / 起始材料 / 经济修正） */
interface OpeningLoadout {
  stats: Record<string, number>;
  weapons: string[];
  items: string[];
  scrap: number;
  econ?: OpeningEcon;
}
interface TalentTypeDef { label: string; cost: number; note: string; }
interface TalentNodeDef {
  id: string;
  sector: string;
  type: string;
  name: string;
  desc: string;
  effects: { stats?: Record<string, number>; weapons?: string[]; items?: string[]; scrap?: number; econ?: Partial<OpeningEcon> };
  /** 精通 / 本职归属：'offense' 之类是精通类别；'char:xxx' 是本职子树归属 */
  mastery: string | null;
}
interface TalentApi {
  LIST: TalentNodeDef[];
  BY_ID: Record<string, TalentNodeDef>;
  TYPES: Record<string, TalentTypeDef>;
  SECTORS: Record<string, { name: string; note: string }>;
  AFFINITY: Record<string, string>;
  OWNER: Record<string, string>;
  FREE_RESPECS: number;
  RESPEC_COST: number;
  /** 经济修正的键（**唯一声明**：每个键都必须真的被读到，静态检查守着） */
  ECON_KEYS: Record<string, string>;
  ECON_DEFAULTS: OpeningEcon;
  /** 每个经济键的单项上限（折扣 0.6 / 复利倍率 0.5，与据点同一套） */
  ECON_CAP: Record<string, number>;
  costFor(node: TalentNodeDef, charId: string): number;
  visibleFor(charId: string): TalentNodeDef[];
  canTake(charId: string, nodeId: string, taken: string[], earned: number): { ok: boolean; reason: string; cost: number };
  spentOn(taken: string[], charId: string): number;
  openingFor(charId: string, taken: string[]): OpeningLoadout;
  pointsForRun(run: { win?: boolean; wave?: number; danger?: number } | null): number;
  respecCost(usedFree: number, opts?: { free?: number; discount?: number }): number;
  audit(): { ok: boolean; problems: string[]; counts: any };
  describe(): string;
}

/* ---------------- 难度阶梯（danger.ts） ---------------- */
/** 折叠后的修正（第 0 级全部是恒等值） */
interface DangerMods {
  enemyHp: number; enemyDmg: number; enemySpeed: number;
  waveBudget: number; waveTime: number;
  shopPrice: number; rerollCost: number;
  startHpFrac: number;
  eliteChance: number; poolShift: number; offerCount: number;
  /** 每 N 波出 Boss（基准 5；越小越频繁） */
  bossEvery: number;
  doubleBoss: boolean;
}
interface DangerLevelDef {
  level: number; name: string; note: string;
  mods: Partial<DangerMods>;
}
interface DangerApi {
  LIST: DangerLevelDef[];
  BY_LEVEL: Record<number, DangerLevelDef>;
  MAX: number;
  BASE: DangerMods;
  FOLD: Record<string, string>;
  NOTES: Record<string, string>;
  /** 每个键的难度方向：'down' = 越小越难（只有 waveTime） */
  DIRECTION: Record<string, string>;
  /** 这个键"更难"是变大(+1)还是变小(-1) */
  harder(key: string): number;
  /** 0..level 的全部修正折叠成一份 */
  modsFor(level: number): DangerMods;
  name(level: number): string;
  note(level: number): string;
  /** 这一级新增了什么 */
  deltaOf(level: number): Array<{ key: string; value: any; how: string }>;
  /** 到这一级为止偏离基准的全部修正 */
  activeOf(level: number): Array<{ key: string; value: any; base: any; how: string }>;
  describe(level: number): string;
  /** 定义期自检（表自身的完整性；"键有没有人读"是测试的活） */
  audit(): { ok: boolean; problems: string[]; counts?: Record<string, number> };
}

/* ---------------- 挑战表（challenges.ts） ---------------- */
interface ChallengeUnlock { family: string; id: string; amount?: number; }
interface ChallengeDef {
  id: string; group: string; name: string; desc: string;
  /** 读哪个指标（见 Challenges.METRICS；写错的表现是"永远不完成"） */
  metric: string;
  atLeast: number;
  /** 非空表示"这个指标读 profile.perChar[char]" */
  char: string | null;
  unlock: ChallengeUnlock[];
  /** **隐藏挑战**：没完成之前不列在图鉴里（G5） */
  secret?: boolean;
}
interface ChallengeContext {
  flat: Record<string, number>;
  perChar: Record<string, PerCharRecord>;
  char: string;
}
/** 跨局探索进度（喂给挑战求值；来自档案里的剧情计数） */
interface ChallengeStoryInput {
  secrets: number; fragments: number; endings: number; bosses: number; bestFloor: number;
}
interface ChallengesApi {
  LIST: ChallengeDef[];
  BY_ID: Record<string, ChallengeDef>;
  METRICS: Record<string, string>;
  /** 角色挑战的指标名 → PerCharRecord 的字段名（两层名字不直接复用，免得读哪里看不出来） */
  CHAR_METRICS: Record<string, string>;
  /** 进度怎么显示：account（累计，可显示进度）/ char（该角色记录）/ run（单局达成） */
  progressKind(def: ChallengeDef): 'account' | 'char' | 'run';
  context(
    run: ProfileRunInput | null,
    totals: Record<string, number>,
    perChar: Record<string, PerCharRecord>,
    story?: ChallengeStoryInput | null
  ): ChallengeContext;
  valueOf(def: ChallengeDef, ctx: ChallengeContext): number;
  progress(def: ChallengeDef, ctx: ChallengeContext, isDone?: (id: string) => boolean): { value: number; atLeast: number; done: boolean };
  evaluate(ctx: ChallengeContext, isDone?: (id: string) => boolean): ChallengeDef[];
  /** 图鉴里该列出来的（隐藏的没完成就不列） */
  visible(isDone?: (id: string) => boolean): ChallengeDef[];
  groups(): string[];
  describe(): string;
  /** 定义期自检（id / 指标 / 分组 / 阈值 / 解锁目标 —— 写错的表现是"永远不完成"） */
  audit(): { ok: boolean; problems: string[] };
}

/* ---------------- 启动期自检（selfcheck.ts） ---------------- */
/**
 * 定义期自检的登记处：各模块 `register` 自己的表检查（而不是自己算完丢掉），
 * 入口（main.ts / cli.ts）在启动时 `run()` —— 不过就抛，**一次列全**。
 */
interface SelfCheckApi {
  register(name: string, fn: () => { ok: boolean; problems: string[] }): SelfCheckApi;
  /** 全部自检名（登记的 + 内置的 `registry`）—— 测试用它验"有 audit 的模块都注册了" */
  names(): string[];
  /**
   * 跑完但**不抛**（返回全部问题，方便自己决定怎么报）。
   * `registry`：`'full'`（默认，浏览器与测试）/ `'partial'`（只有模拟层的入口）/ `'off'`
   * —— 为什么这个开关是必要的，见 selfcheck.ts。
   */
  scan(opts?: { registry?: 'full' | 'partial' | 'off' }): { ok: boolean; problems: string[]; ran: string[] };
  /** 启动期把门：不过就抛（一次列全）；返回跑过的自检名 */
  run(opts?: { registry?: 'full' | 'partial' | 'off' }): string[];
}

/* ---------------- 场景表（scene.ts） ---------------- */
interface SceneDef {
  /** DOM 覆盖层名字（元素 id 为 `scr-<overlay>`）；null = 不显示覆盖层 */
  overlay: string | null;
  /** 是否推进逻辑帧（Game.step 的闸门） */
  sim: boolean;
  /** 画世界还是画待机背景 */
  world: boolean;
  /** HUD 是否可见 / 需要更新 */
  hud: boolean;
  /** 武器条是否可见 */
  strip: boolean;
  /** 按键组：main.ts 按它派发热键 */
  keys: 'menu' | 'start' | 'battle' | 'cards' | 'shop' | 'camp' | 'pause' | 'back' | 'none';
  note: string;
}

interface SceneApi {
  TABLE: Record<string, SceneDef>;
  /** 定义期校验：返回 `{ok, problems}`（与其它模块的 audit 同形；本模块自己在加载时抛） */
  validate(): { ok: boolean; problems: string[] };  of(state: string): SceneDef;
  has(state: string): boolean;
  overlayOf(state: string): string | null;
  refreshOf(state: string): string | null;
  simulates(state: string): boolean;
  drawsWorld(state: string): boolean;
  showsHud(state: string): boolean;
  showsStrip(state: string): boolean;
  keyGroup(state: string): string;
  /** 按钮动作 → 界面（"去某个界面"那一半动作是数据，不是代码） */
  SCREEN_ACTS: Record<string, GameStateName>;
  screenActOf(act: string): GameStateName | null;
  screenActNames(): string[];
  overlayNames(): string[];
  describe(): string;
}

/* ---------------- 开发用测试场景（demo.ts） ---------------- */
interface DemoApi {
  /** 把新会话推进到"第 wave 波、满配"的状态 */
  /** `themeId` 可选：钉住这一层的环境（环境是每局抽签的，不钉住就量不到指定的那个） */
  stage(charId: string, wave: number, themeId?: string): { sess: Session; p: Player };
  /** ?test=demo 的密集团战现场 */
  scene(sess: Session): Session;
  /** ?test=arena 的"只为量地面"场景（无升级弹窗、无贴花，环境看得清） */
  arena(sess: Session): Session;
  /** ?test=combine 的合成舞台：一局里同时摆出"可合成的一对"与几个不同品级 */
  combine(sess: Session): Session;
}

interface ColApi {  /** 两圆是否重叠（切点算重叠） */
  circle(ax: number, ay: number, ar: number, bx: number, by: number, br: number): boolean;
  /** 点是否在圆内 */
  point(px: number, py: number, cx: number, cy: number, r: number): boolean;
  /**
   * 线段 A→B 与圆的首次接触。
   * @returns 插值 t ∈ [0,1]（起点已在圆内返回 0）；不相交返回 -1
   */
  segCircle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, r: number): number;
  /** 覆盖线段的包围圆（把线段查询退化成一次网格圆查询） */
  segBounds(ax: number, ay: number, bx: number, by: number, pad: number, out?: any): { x: number; y: number; r: number };
}

interface InputApi {
  keys: Record<string, boolean>;
  pressedOnce: Record<string, boolean>;
  mouse: { x: number; y: number; down: boolean; rd: boolean; wheel: number };
  _canvas?: HTMLCanvasElement | null;
  _slow: boolean;
  /** 手柄：左摇杆方向 + 连接状态（键位另有内部副本，见 input.ts） */
  _pad: { x: number; y: number; active: boolean; connected: boolean; id: string };
  /** **手柄的第一次按键**的回调（入口把它接到音频解锁上）。
   *  为什么需要它：Gamepad API 是轮询的、**不派发 DOM 事件**，
   *  而浏览器的自动播放策略只认 DOM 用户手势 —— 不接这一条，
   *  纯手柄玩家的 `AudioContext` 会永远 suspended（全程无声）。 */
  onPadGesture?: (() => void) | null;
  /** 触摸浮动摇杆：圆心 (ox,oy) 与当前方向 */
  _touch: { x: number; y: number; active: boolean; ox: number; oy: number; id: number };
  /** 可改键位（默认值必须与 settings.ts 的默认值一致） */
  bind: { up: string; down: string; left: string; right: string; pause: string };
  init(canvas?: any): void;
  /** 每显示帧一次：轮询手柄（Gamepad API 没有按键事件） */
  poll(): boolean;
  padInfo(): { connected: boolean; id: string };
  stick(): InputApi['_touch'];
  /** 改键：请求"下一个按下的键"（Esc 取消时回调收到 null） */
  captureNext(cb: (key: string | null) => void): void;
  capturing(): boolean;
  cancelCapture(): void;
  setBind(settingKey: string, value: string): boolean;
  /** 设置项名 → bind 字段名（扩展一份可改键位只需要在这里加一行） */
  bindFields(): Record<string, string>;
  down(k: string): boolean;
  once(k: string): boolean;
  endFrame(): void;
  /** `slow` 是**输入载荷**的一部分：模拟层只消费载荷，不反过来问输入层 */
  moveVec(): { x: number; y: number; len: number; slow: boolean };
  /** 输入层自己的查询（供输入层测试用；模拟层读载荷里的 `slow`） */
  isSlow(): boolean;
}

interface SfxApi {
  enabled: boolean; volume: number;
  ctx: AudioContext | null; master: GainNode | null;
  init(): void; /** 尝试解锁音频；返回是否已 running（被浏览器拦住时 false） */ resume(): boolean; setEnabled(v: boolean): void;
  /** 音频被自动播放策略拦住（界面据此提示玩家点一下） */ blocked: boolean;
  /** 滑杆值 → 感知增益（`volume^2.2`）。**唯一一处实现**，别处不许自己写 gain */
  gainOf(v: number): number;
  /** 改音量的唯一出口（初始化与 applySetting 都走它，保证同一条曲线） */
  setVolume(v: number): number;
  /** 每次播放的抖动幅度（音高/音量/起音时刻）—— 只在自检与测试里读 */
  JITTER: { pitch: number; peak: number; when: number };
  /** 音效声明表（自检与文档用；**唯一出处**，不是另抄一份） */
  LIST: Array<{ id: string; label: string; note: string }>;
  /** 定义期自检：声明表与实现是否一一对应（漏一个 = 那个音效悄悄没了） */
  audit(): { ok: boolean; problems: string[]; counts?: Record<string, number> };
  shoot(kind?: string): void; melee(): void; kill(): void; hurt(): void;
  levelUp(): void; buy(): void; deny(): void; explode(): void; hit(): void;
  waveStart(): void; waveClear(): void; click(): void; pickup(): void;
}

interface PerfApi {
  fps: number; ms: number; acc: number; frames: number;
  sample(dt: number): void;
}

interface StatsApi {
  DEF: Record<StatKey, StatDef>;
  KEYS: StatKey[];
  empty(): StatMap;
  base(): StatMap;
  pretty(key: string, value: number): string;
  label(key: string): string;
  short(key: string): string;
  describe(map: Partial<StatMap>): StatLine[];
  cooldownMul(s: StatMap): number;
  damageMul(s: StatMap, weapon?: WeaponDef | null): number;
  rangeMul(s: StatMap): number;
  moveSpeed(s: StatMap): number;
  damageTaken(s: StatMap, raw: number): number;
  critChance(s: { critChance: number }): number;
  critMul(): number;
  pickupRadius(s: StatMap): number;
  xpNeeded(level: number): number;
}

interface WeaponsApi {
  LIST: WeaponDef[];
  BY_ID: Record<string, WeaponDef>;
  /** 品级上限（合成到这一档为止）= `Tiers.MAX`，值本身只住在品级表里 */
  TIER_MAX: number;
  /** 合成台阶表（**就是** data_tiers 的品级表：同一份引用，不是副本） */
  TIERS: TierRow[];
  TIER_BY: Record<number, TierRow>;
  clampTier(t: unknown): number;
  /** 这把武器**当前**的品级（1–5） */
  tierOf(w: WeaponInst | null | undefined): number;
  /** 相对武器出身档的倍率：'dmg' | 'cd' | 'knock' | 'reach' */
  mulFor(def: WeaponDef | null | undefined, tier: number, key: string): number;
  mul(w: WeaponInst | null | undefined, key: string): number;
  /** 顶档及以上的额外穿透（远程且原本不是"打穿一切"的才吃；逐档来自品级表） */
  pierceBonus(w: WeaponInst | null | undefined): number;
  canCombine(w: WeaponInst | null | undefined): boolean;
  /** 同名同档的另一格（-1 = 没有）；allowDiff = 工坊「异档熔接」放宽到同名任意档 */  partnerOf(list: WeaponInst[], w: WeaponInst, skipIndex: number, allowDiff?: boolean): number;
  /** 当前价值（含品级：每抬一档翻一倍，因为那一档吃掉的是两把） */
  valueOf(w: WeaponInst | null | undefined): number;
  /** 回收返还比例（**默认值**；实际那一局的数在 `S.salvageRate`，由工坊抬） */
  salvageRate: number;
  /** 回收价 = min(当前价值 × 比例, 你为它付过的钱 − 1)（`rate` 缺省用 W.salvageRate） */
  salvageOf(w: WeaponInst | null | undefined, rate?: number | null): number;
  priceOf(def: WeaponDef, luck?: number): number;
  instantiate(id: string, tier?: number, paid?: number): WeaponInst | null;
  rollShop(wave: number, rnd: () => number): WeaponDef;
}

interface ItemsApi {
  LIST: ItemDef[];
  BY_ID: Record<string, ItemDef>;
  PACK_DISCOUNT: number;
  /** 每个包种**一项一档**的基础权重（长度必须等于品级表的档数，见 I.audit） */
  PACK_BASE: Record<string, number[]>;
  /** 道具的机制类效果（"改机制不是改数值"那一类）的声明表 */
  SPECIALS: Record<string, { note: string; read: string }>;
  /** 把一串道具折成 `{ special: 件数 }`（recalcStats 折一次，模拟层只读结果） */
  foldSpecials(items: ItemInst[]): Record<string, number>;
  /* ---- 道具的"代价"那一层（**机制在、数据留白**，见 data_items.ts 的 COST_DATA_READY）----
     声明表 + 折叠出口是完整的：`COST_KINDS` 里写清每个代价键怎么折（属性 / 经济 /
     敌人 / 规则），写错一个键会被自检当场抓住。但 29 件道具此刻**还没有填 cost** ——
     那是一次平衡改版，不该藏在架构复查里。 */
  /** 代价键的声明表（`fold` 决定它折到哪里去） */
  COST_KINDS: Record<string, { fold: 'stat' | 'econ' | 'enemy' | 'flag'; note: string; how?: string }>;
  /** 代价**轴**（界面上按它分类；也是"取舍要有种类"的守卫依据） */
  COST_AXES: Record<string, { name: string; note: string }>;
  /** 效果键 → 代价轴（审计用它回答"这件在换什么"） */
  AXIS_OF_MOD: Record<string, string>;
  /** 把一串道具折成"代价那一份"：`{ mul, add }`（缺省 = 全恒等） */
  foldCosts(items: ItemInst[]): ItemCostFold;
  audit(): {
    ok: boolean; problems: string[];
    counts: { items: number; specials: number; withCost: number; plain: number; gains: number; axes: number; kinds: number };
  };
  maxTierFor(wave: number): number;
  tierAvgPrice: number[];
  priceOf(def: ItemDef, luck?: number): number;
  rollShop(wave: number, rnd: () => number): ItemDef;
  packWeights(wave: number, luck: number, kind: string): number[];
  packAvailable(wave: number, kind: string): boolean;
  rollPack(wave: number, luck: number, rnd: () => number, kind: string): ItemDef;
  packEV(wave: number, luck: number, kind: string): number;
  packPrice(wave: number, luck: number, kind: string): number;
  packRealDiscount(wave: number, luck: number, kind: string): number;
  packOddsText(wave: number, luck: number, kind: string): string;
}

interface CharsApi {
  LIST: CharDef[];
  BY_ID: Record<string, CharDef>;
  /** 角色专属机制的**声明表**（`rage` …）+ 谁读它。
   *  与 `data_items.ts` 的 SPECIALS 同一个套路：读点用 `specialOf` 查，
   *  写错一个字母由自检当场报（否则那个角色**静默变成白板**，
   *  而选人页上照旧写着它的描述）。 */
  SPECIALS: Record<string, { note: string; read: string }>;
  /** 这个角色有没有 `name` 这条机制（认不出的 role / 未登记的 name 都是 false） */
  specialOf(charId: string | undefined, name: string): boolean;
  audit(): { ok: boolean; problems: string[]; counts: { chars: number; specials: number } };
}

interface EnemiesApi {
  LIST: EnemyDef[];
  BY_ID: Record<string, EnemyDef>;
  PACE: number;
  /** 第 N 间房等效于旧设计的第几波（1 起） */
  equivWave(wave: number): number;
  /* 三条成长曲线与精英三段倍率：**值住在 `curves.ts`**（一张表同时装角色与怪物两边），
     这里只留读法。`Curves.audit()` 逐点比对"表算出来的值"与改造前的式子。 */
  hpScale(wave: number): number;
  dmgScale(wave: number): number;
  speedScale(wave: number): number;
  poolFor(wave: number): EnemyDef[];
  /**
   * 第三参是折叠好的难度修正（键名与 danger.ts 一致）；缺省 = Danger.BASE = 恒等。
   * 第四参是**这一层的 Boss id**（由 game.ts 按层算好传进来）——
   * 缺省时退回池里第一只，所以老调用点（测试/工具）行为不变。
   */
  buildWave(wave: number, rnd: () => number, mods?: DangerMods, boss?: string | null): SpawnItem[];
  describeWave(wave: number): string;
  /** Boss 池（G3）：每层由种子决定出哪一只 */
  BOSSES: { id: string; name: string; note: string }[];
  bossFor(seed: number, floor: number): string;
  audit(): { ok: boolean; problems: string[]; counts: any };
}

interface ArenaApi {
  W: number; H: number; PAD: number;
  /** `themeId` 缺省 = 默认环境（无会话/无头测试的降级路径） */
  build(wave: number, themeId?: string): ArenaData;
  clampPos(x: number, y: number, r?: number): { x: number; y: number };
  inside(x: number, y: number, r?: number): boolean;
}

interface EmitApi {
  VIS_CAP: number; TEXT_CAP: number;
  /** 视觉强度（"减少动效"调低）：只影响画面，且**不得**消耗模拟随机数 */
  visScale: number;
  /** 伤害飘字开关 */
  showDamage: boolean;
  bind(sess: Session): EmitApi;
  clear(): void;
  spawn(props: Partial<Particle> & { kind: string }): Particle;
  text(x: number, y: number, str: string, color: string, size: number, priority?: boolean): Particle | null;
  deathSparks(e: Enemy): void;
  blood(x: number, y: number, n?: number): void;
  ember(e: Enemy): void;
  slash(x: number, y: number, r: number, a: number, arc: number): Particle;
  muzzle(x: number, y: number, ang: number, big?: boolean): Particle;
  shockRing(x: number, y: number): Particle;
  bulletExplosion(x: number, y: number, radius: number, crit?: boolean): void;
  deathExplosion(x: number, y: number, radius: number): void;
  /** 打墙碎屑（暗门）：与命中怪物的特效在形状/颜色上分得开 */
  wallHit(x: number, y: number, n?: number): void;
  /** 墙塌了一面 */
  wallBreak(x: number, y: number): void;
  damage(x: number, y: number, amount: number, crit?: boolean): Particle | null;
  heal(x: number, y: number, amount: number): Particle | null;
  dodge(x: number, y: number): Particle | null;
  playerHurt(x: number, y: number, dmg: number): Particle | null;
  update(dt: number): void;
  stats(): { vis: number; text: number; freeVis: number; freeText: number };
  audit(): { duplicates: number; tracked: number };
}

interface RenderApi {
  cam: { x: number; y: number; w: number; h: number; zoom: number; shakeX: number; shakeY: number };
  dpr: number;
  canvas: HTMLCanvasElement | null;
  ctx: CanvasRenderingContext2D | null;
  showFps: boolean;
  /** 深度叠层（?z=1）：显示层带与排序队列账目 */
  showDepth: boolean;
  cullEnabled: boolean;
  phase: string;
  culled: number;
  /** 上一次烘焙里铺了多少格瓦片（静态层开销的主要项，要能被量） */
  terrain: { tiles: number; cells: number; set: string };
  /** 这一帧画了多少视差层与副本（视差最容易悄悄变贵的一层） */
  parallax: { layers: number; items: number };
  /**
   * 门闩抬升量（1 = 压住缺口，0 = 抬到底）。
   * `dt` 推进计时；同一间房的状态一变就重播（`art_parallax.ts` 的 doorOpen）。
   */
  doorBoltLift(dt: number, roomId: string, cleared: boolean): number;
  /** 显示帧插值系数：0 = 停在上一逻辑帧，1 = 当前逻辑帧（缺省 1） */
  alpha: number;
  /** 上一次逻辑帧位置 → 本帧要画的位置 */
  lerpPos(prev: number, cur: number): number;
  /** 按自身 x/y 绘制的部件用的亚帧偏移（drawn = x + off） */
  posOffset(prev: number, cur: number): number;
  view: { x0: number; y0: number; x1: number; y1: number; on: boolean };
  shake: { trauma: number; t: number; x: number; y: number; seed: number };
  SHAKE_MAX_PX: number;
  ground: { canvas: HTMLCanvasElement | null; wave: number; theme: string; scale: number };
  props: { canvas: HTMLCanvasElement | null; wave: number; theme: string; scale: number };
  invalidateBakes(): void;
  bakeStats(): BakeStats;
  perfs?: any;
  init(canvas: HTMLCanvasElement): void;
  resize(): void;
  draw(dt: number): void;
  drawIdle(dt: number): void;
  tick(dt: number): void;
  banner(text: string, dur?: number): void;
  inView(x: number, y: number, r?: number): boolean;
  addTrauma(a: number): void;
  /** 屏幕抖动倍率（设置项 shake） */
  shakeScale: number;
  resetShake(): void;
  playerAnim(p: Player): { bob: number; sx: number; sy: number; armSwing: number };
  decalAlpha(d: Decal, sess: Session): number;
}

interface UIApi {
  selectedChar: string;
  /** 选人页选的难度等级（受 Profile.dangerOf(char) 限制） */
  selectedDanger: number;
  /** 天赋页当前查看的角色 */
  talentChar: string;
  /** 商店里"武器联动"那一段是否铺开（默认折叠：参考资料不该占掉买 / 合 / 卖的地方） */
  showSyn: boolean;
  /** 商店里"道具套装"那一段是否铺开 */
  showSet: boolean;
  /** 工坊的配方页签（武器 / 道具） */
  craftTab: string;
  /** 诊断面板（?diag=1）：true = 展开三份 describe() */
  diagFull: boolean;
  diagEnabled(): boolean;
  setDiag(on: boolean): boolean;
  refreshDiag(force?: boolean): boolean;
  tickDiag(dt: number): void;
  diagText(): string;
  init(): void;
  show(name: string | null): void;
  refresh(): void;
  updateHud(): void;
  toast(msg: string, kind?: string): void;
  renderPause(): void;
  /** 说一次某个时机的提示（规则在 tutorial.ts）；返回说了几条 */
  say(when: string): number;
  /** 按 settings 表填设置面板的值 */
  renderSettings(): void;
  /** 换存档槽位之后：重读档案 + 刷新依赖它的界面（一处显式清单，见 ui.ts） */
  afterSlotChange(): void;
  /** 按存档有无显示/隐藏标题页的"继续上一局" */
  refreshContinueButton(): void;
  /** 菜单焦点（方向键 / 手柄 dpad 选，回车 / 手柄 A 按） */
  focusMove(dx: number, dy: number): boolean;
  focusClear(): void;
  hasFocus(): boolean;
  focusText(): string;
  activateFocus(): boolean;
  /** 全部已注册的按钮动作名（动作表运行时可枚举 —— 契约测试读它，不再正则匹配源码） */
  actNames(): string[];
  /** 按屏分组的动作名（每个动作恰好一组；用来验"没有杂物箱"与打印分布） */
  actGroups(): Record<string, string[]>;
  /** 已注册的"重画"名（对着 scene.ts 的 REFRESH 表比一遍） */
  renderNames(): string[];
  /** 由 main.ts 注入的接线（每日挑战与回放都属于"接线"这一层，不属于界面层） */
  dailyStart?: (rule?: any) => any;
  weeklyStart?: (rule?: any) => any;
  dailyResult?: () => any;
  replayStep?: (x: number, y: number, frame: number) => void;
}

type GameStateName = 'title' | 'chars' | 'playing' | 'levelup' | 'shop' | 'camp' | 'paused' | 'howto' | 'settings' | 'records' | 'codex' | 'talents' | 'keep' | 'hub' | 'end';

/** 这一间的一扇门（"玩家自己选房间"的数据来源，见 Game.doors()） */
interface DoorInfo {
  dir: number;
  roomId: string;
  type: string;
  name: string;
  icon: string;
  open: boolean;
  /** 走不了的原因（界面直接显示，不自己编文案） */
  why: string;
}

interface GameApi {
  state: GameStateName;
  _pauseFrom?: GameStateName;
  /** 枢纽（N2）的来处：从暂停过来时要能沿原路回到那一局 */
  _hubFrom?: GameStateName;
  /** 可返回覆盖层（howto/settings/records）的来处 */
  _returnFrom: Record<string, GameStateName>;
  /** 覆盖层的返回目标（来处不可达时退回 title） */
  returnFrom(state: string): GameStateName;
  _input?: { x: number; y: number };
  STATES: GameStateName[];
  TRANSITIONS: Record<GameStateName, GameStateName[]>;
  time: number;
  speed: number;
  wave: number;
  events: Bus;
  cfg: {
    maxWeapons: number;
    /** 这一间的时限（秒）：**多久内打完**，不是"要撑多久" */
    waveTime(w: number): number;
    /** 时限内清完的奖励倍率 / 超时的惩罚倍率 */
    clearBonus: number;
    overrunBonus: number;
    /** 超时后场上剩下的怪（一次性）：移速 / 伤害倍率 */
    overrun: { speed: number; dmg: number };
    /** 打完 Boss 给下一层挑几条契约（抽签候选数） */
    boonChoices: number;
    enemyCap: number;
    decalCap: number;
    stainPerSec: number;
    stainBurst: number;
    /** 逻辑帧 / 物理帧的固定步长（模拟层唯一的 dt 来源） */
    fixedDt: number;
    /** 一次渲染最多补几步（超过丢弃积压） */
    maxSteps: number;
    /** 单帧 dt 上限（切后台防跳帧） */
    maxFrameDt: number;
  };
  canSetState(to: GameStateName): boolean;
  setState(to: GameStateName, force?: boolean): boolean;
  newRun(charId: string, seed?: number, danger?: number, opening?: OpeningLoadout | null, smods?: { owned?: Record<string, number>; forge?: string[] | Record<string, unknown> | null } | null): Session;
  step(dt: number, input: { x: number; y: number }): void;
  getSession(): Session | null;
  chooseLevelCard(i: number): boolean;
  buyOffer(i: number): boolean;
  buyPack(kind: string): boolean;
  /** 建材包：花材料买建材（商店那一栏"原料"） */
  buildPrice(): number;
  buyBuild(): boolean;
  packPrice(kind: string): number;
  packOdds(kind: string): string;
  sellWeapon(i: number): boolean;
  reroll(): boolean;
  toggleLock(): boolean;
  nextWave(): boolean;
  /* ---- 地牢（换房间 / 自动探索 / 房间内容） ---- */
  /** 走门（唯一换房间的公开入口；从商店/营地也能走） */
  enterRoom(dir: number): boolean;
  /** 这一间有哪些门、通向哪、现在能不能走（"自己选房间"的唯一数据来源） */
  doors(): DoorInfo[];
  /** 自动选下一间（"下一波"的默认路径，也留给"自动前进"用） */
  autoExplore(): boolean;
  /** 这一种房型的说明文案（界面**不得**自己硬编码房型文案） */
  roomFxNote(type: string): string;
  /* ---- 层间契约（boons.ts） ---- */
  /** 挑一条契约（不可撤销；只能从候选里挑） */
  pickBoon(id: string): boolean;
  /** 还没挑的候选（空数组 = 没有可挑的） */
  boonChoices(): string[];
  /** 已挑的那一条（空串 = 没挑过） */
  boonId(): string;
  ROOM_FX: Record<string, RoomFxDef>;
  ROOM_EVENTS: RoomEventDef[];
  /* ---- 工坊（跨局；账在 profile.ts，这里只带上会话的开局修正并刷新派生值） ---- */
  campBuy(id: string): boolean;
  campSell(id: string): boolean;
  /** 界面铺一屏工坊（费用 / 能不能盖 / 退款）—— 不含规则 */
  campFacilities(): Array<{
    id: string; name: string; note: string; level: number; maxLevel: number;
    cost: number; toLevel: number; ok: boolean; reason: string; refund: number;
  }>;
  /** 买卖要带的开局修正（据点容量 / 天赋折扣 / 工匠全额返还） */
  campOpts(): { slots: number; discount: number; fullRefund: boolean };
  openCamp(): boolean;
  addWeapon(id: string, tier?: number, paid?: number): WeaponInst | null;
  /** 给玩家一件道具（**唯一的入口**：词条在这里定下来，见 game.ts 的 addItem） */
  addItem(def: ItemDef, set?: AffixSet | null): ItemInst | null;
  /** 词条的随机流（**只给演示舞台与测试**：正常路径由 addWeapon / addItem 自己取） */
  affixRnd(): RngFn;
  /** 这一局能带几把武器（唯一的读点；现在等于配置值，见 game.ts 的说明） */
  maxWeapons(): number;
  /** 回收价（含品级与**这一局的**回收比例：工坊「废料回收」会抬它） */
  salvageOf(w: WeaponInst): number;
  /** 本局累积的合金（合成产出；结算入账） */
  alloyEarned(): number;
  /** 本局的工坊修正（界面提示"合一次给多少合金"要读它） */
  forgeMods(): ForgeMods;
  /* ---- 制造（经营那一侧的主行动） ---- */
  /** 造一件：用哪条产线（这一波还没用过的）+ 配方 id（`weapon:knife`） */
  craft(line: number, id: string): boolean;
  /** 能造的配方 + 费用 + 能不能造（界面铺一屏用它；规则不在界面里） */
  craftOptions(): Array<{ id: string; kind: 'weapon' | 'item'; refId: string; name: string; tier: number; cost: number; ok: boolean; reason: string; affordable: boolean }>;
  /** 这一局有几条产线（已建设施 + 图纸名额） */
  craftLines(): number;
  /** 这一波还空着的产线号（界面按它画按钮） */
  craftFreeLines(): number[];
  /** 买武器时的落位规则（空槽装上 / 满槽同名同档就合成） */
  addWeaponOrCombine(id: string, tier?: number, paid?: number): { ok: boolean; why: string; combined: boolean; tier: number; weapon: WeaponInst | null };
  /** 合成两把同名同档的武器（状态校验在 market.ts） */
  combine(i: number, j: number): boolean;
  /** 所有能合成的格子（界面按它画"合并"按钮） */
  /** 可合成的格子与结果；`locked` = 顶档还锁着（界面画禁用按钮 + why 里的理由） */
  combinePlans(): Array<{ i: number; j: number; id: string; name: string; from: number; to: number; partnerTier: number; dmgMul: number; locked?: boolean; why?: string }>;
  /** 第 i 格能不能合、跟谁合（没有就是 null） */
  combinePlan(i: number): { i: number; j: number; id: string; name: string; from: number; to: number; partnerTier: number; dmgMul: number } | null;
  recalcStats(): void;
  summary(): RunSummary;
  healPlayer(amount: number): void;
  damageEnemy(e: Enemy, amount: number, opt?: any): number;
  pause(): boolean;
  resume(): boolean;
  autoInput(t: number): { x: number; y: number };
  _internals: {
    spawnEnemy(id: string, x: number, y: number, opt?: any): Enemy | null;
    startWave(n: number): void;
    /** 直接翻到某一层（测试/实验台用：层的深度回报与主题倍率都在它里面算） */
    enterFloor(f: number, opt?: { silent?: boolean }): void;
    endWave(): void;
    openShop(bonus: number): void;
    checkLevelUp(): void;
    rollLevelCards(): void;
    addStain(x: number, y: number, r: number, color: string): Decal;
    /** 打墙（子弹/近战/爆炸内部都在用；测试直接调它来开密室） */
    hitWalls(x0: number, y0: number, x1: number, y1: number, r: number, dmg: number): boolean;
    breakWall(from: string, to: string, x?: number, y?: number): boolean;
    /** 直接挪到某一间房（测试用：房间制下"哪一间"决定了刷什么怪、有没有门） */
    warpTo(roomId: string): boolean;
    /** 直接设一条契约（只给实验台与测试用；正常路径是打完 Boss 抽签再挑） */
    setBoon(id: string): boolean;
    /** 钉住这一间不自动结束（测试用） */
    holdRoom(sess?: Session | null): void;
    /* 武器数值的三个出口（只给实验台与测试用）：品级台阶是不是真的接在伤害公式上，
       要能直接量，而不是靠"打桩打了一段时间差不多更多"去猜。 */
    weaponDamage(w: WeaponInst): number;
    weaponCd(w: WeaponInst): number;
    weaponReach(w: WeaponInst): number;
    /** "白给的回血"那一道门（道具代价 `noHeal` 要取消的就是它；只给测试用） */
    settleHeal(amount: number): number;
    /**
     * **等级推进的唯一入口**（只给测试与实验台）。
     * `checkLevelUp` 平时只在"吃到材料"时跑（经验跟着材料走），
     * 所以"玩家的成长曲线长什么样"在无头环境里没法直接量 —— 没有掉落物可吃。
     */
    checkLevelUp(): void;
  };
  /* ---- 存档：一局的序列化由玩法层自己负责 ---- */
  exportRun(): any | null;
  inspectRun(data: any): { char: string; charName: string; wave: number; level: number } | null;
  importRun(data: any): Session | null;
}

interface CfgApi { moveSpeedPerPoint: number; }

interface Palette {
  [key: string]: any;
  INK: string; G1: string; G2: string; G3: string; G4: string; G5: string; G6: string;
  SKIN: string; SKIN_HI: string; SKIN_SH: string; SKIN_DP: string; BRONANA_DOT: string;
  WHITE: string; BONE: string; GREY: string; DARK: string;
  BLOOD: string; MUZZLE: string; XP: string; MAT: string; GOLD: string; HEAL: string;
  /** 当前色弱档（0 = 原色，1 = 红绿友好，2 = 高对比） */
  mode(): number;
  /** 切档；真的换了返回 true（换档必须作废贴图缓存，见 main.ts 的 applyColourblind） */
  setMode(m: number): boolean;
  /** 某一档下这个键是什么色（体检与测试读它，避免各写一份表） */
  at(key: string, mode?: number): string;
  /** 哪几个键会随色弱档变化 */
  KEYS_IN_MODES: string[];
  /** 第 0 档的原值 */
  BASE: Record<string, string>;
}


/* ---------------- 组件式组合（comp.ts） ---------------- */
interface CompDef {
  name: string;
  fields: Record<string, any>;
  keys: string[];
  hooks: { reset?: (e: any) => void } | null;
}

interface CompArch {
  name: string;
  comps: string[];
  fields: string[];
  owner: Record<string, string>;
  has: Record<string, boolean>;
  template: Record<string, any>;
  list: string | null;
  note: string;
  /** 生成钩子：spawn 之后补齐写不进默认值的字段（如骨架实例），没有则为 null */
  hooks: Array<(e: any) => void> | null;
  /** 该原型是否带 Transform 的 px/py（出生时自动与 x/y 对齐） */
  seedPrev: boolean;
  make?: () => any;
}

interface CompSystem {
  name: string;
  need: string[];
  fn: (e: any, dt: number, ctx: any) => boolean | void;
  _checked: boolean;
  back?: boolean;
  _ctx?: any;
}

interface CompApi {
  define(name: string, fields: Record<string, any>, hooks?: any): CompDef;
  componentKeys(name: string): string[] | null;
  archetype(name: string, comps: string[], opts?: { list?: string; note?: string }): CompArch;
  hasArchetype(name: string): boolean;
  archetypes(): string[];
  archetypeInfo(name: string): { name: string; comps: string[]; fields: string[]; list: string | null; note: string } | null;
  spawn(name: string, overrides?: Record<string, any>): any;
  onSpawn(archName: string, fn: (e: any) => void): CompArch;
  assign(e: any, overrides: Record<string, any>): any;
  archOf(e: any): string | null;
  has(e: any, comp: string): boolean;
  unknownFields(e: any): string[] | null;
  audit(e: any): { arch: string | null; unknown: string[]; missing: string[] };
  /** 定义期启动期自检：全部原型逐字段齐全、默认值与模板一致（登记进 SelfCheck） */
  selfCheck(): { ok: boolean; problems: string[] };
  query(sess: any, archName: string): any[];
  system(name: string, need: string[], fn: (e: any, dt: number, ctx: any) => any, opts?: { back?: boolean }): CompSystem;
  run(name: string, list: any[], dt: number, ctx?: any): number;
  stats(): { components: number; archetypes: number; systems: number };
}

/* ---------------- 骨架系统（rig.ts / bronana.ts） ---------------- */
interface RigBoneDef {
  name: string;
  parent?: string;
  x?: number; y?: number; rot?: number; sx?: number; sy?: number;
  /** 骨头长度（沿 +x），reach / 肢体末端用它 */
  len?: number;
  note?: string;
}

interface RigTemplate {
  rig: true;
  name: string;
  count: number;
  names: string[];
  indexOf: Record<string, number>;
  parent: Int32Array;
  order: Int32Array;
  len: Float64Array;
  restX: Float64Array; restY: Float64Array; restRot: Float64Array;
  restSx: Float64Array; restSy: Float64Array;
}

interface RigInstance {
  tpl: RigTemplate;
  count: number;
  frame: number;
  lx: Float64Array; ly: Float64Array; lrot: Float64Array;
  lsx: Float64Array; lsy: Float64Array;
  wa: Float64Array; wb: Float64Array; wc: Float64Array;
  wd: Float64Array; we: Float64Array; wf: Float64Array;
  wrot: Float64Array; wsx: Float64Array; wsy: Float64Array;
  _dirty: boolean;
}

interface RigPart {
  name: string;
  bone: number;
  boneName: string;
  layer: number;
  draw: (ctx: any, inst: RigInstance, args: any) => void;
  note: string;
}

interface RigParts {
  rig: string;
  list: RigPart[];
  byName: Record<string, RigPart>;
  order: string[];
}

interface RigApi {
  compile(name: string, defs: RigBoneDef[]): RigTemplate;
  index(tpl: RigTemplate, boneName: string): number;
  instance(tpl: RigTemplate): RigInstance;
  reset(inst: RigInstance): void;
  set(inst: RigInstance, i: number, x: number, y: number, rot: number, sx?: number, sy?: number): RigInstance;
  update(inst: RigInstance): RigInstance;
  wx(inst: RigInstance, i: number): number;
  wy(inst: RigInstance, i: number): number;
  wsx(inst: RigInstance, i: number): number;
  wsy(inst: RigInstance, i: number): number;
  point(inst: RigInstance, i: number, ux: number, uy: number, out?: any): any;
  reach(inst: RigInstance, i: number, tx: number, ty: number): RigInstance;
  at(ctx: any, inst: RigInstance, i: number, fn: (g: any) => void): void;
  parts(tpl: RigTemplate, defs: Array<{ name: string; bone: string; layer?: number; draw: (ctx: any, inst: RigInstance, args: any) => void; note?: string }>): RigParts;
  paint(ctx: any, inst: RigInstance, parts: RigParts, args: any, skip?: Record<string, boolean>): number;
  stale(inst: RigInstance): boolean;
  badValues(inst: RigInstance): string[];
}

interface BronanaPose {
  x: number; y: number; rx: number; ry: number;
  bob?: number; armSwing?: number;
}

interface BronanaApi {
  TPL: RigTemplate;
  B: { anchor: number; body: number; head: number; armL: number; armR: number };
  SEATS: number;
  PAINT: { body: number; belly: number; dots: number; armL: number; armR: number; face: number; weapon: number };
  PARTS: RigParts;
  MUZZLE_AHEAD: number;
  BULLET_AHEAD: number;
  RY_RATIO: number;
  /** 图集烘焙：哪些部件不随动作变化 / 哪些每帧都变 */
  BAKED_PARTS: Record<string, boolean>;
  LIVE_PARTS: Record<string, boolean>;
  create(): RigInstance;
  pose(inst: RigInstance, o: BronanaPose): RigInstance;
  draw(ctx: any, inst: RigInstance, a?: any, skip?: Record<string, boolean>): number;
  seat(inst: RigInstance, index: number, aim: number, r: number, px: number, py: number): number;
  seatAngle(index: number, aim: number): number;
  meleeArc(def: WeaponDef): number;
  seatPoint(inst: RigInstance, boneIdx: number, out?: any): any;
  aheadPoint(inst: RigInstance, boneIdx: number, dist: number, out?: any): any;
}

/* ---------------- 宿主注入的调试开关 ----------------
   ESM 化之后模块对象一律走 import，不再有 window.X 这一层，
   所以这里只保留真正需要挂在宿主上的两个名字。 */
declare var __still: boolean | undefined;
declare var __diag: ((msg: string) => void) | undefined;
