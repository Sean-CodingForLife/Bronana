/* =========================================================
   text.ts — **文字面**（引擎级的文字能力）
   ---------------------------------------------------------
   ## 为什么它必须存在（不是"看起来更整齐"）

   R49 的决定文档把**文本渲染**列为 Canvas2D→WebGL2 里**最大的技术风险**：
   `fillText` 自带**字体整形 / 字距 / 换行 / emoji / CJK 排版**，而 **GPU 没有文字原语**。
   所以迁 GL 必须单开一个阶段，而那个阶段的**前置条件**是回答两件事：

     ① 本作一共用到**哪些字符**、**哪些字号**？（字形图集要烘多少）
     ② 字体栈 / 字重 / 对齐 / 描边宽度这些**排版参数**由谁说了算？

   改造前这两个答案都散着：字体串硬编在 `draw2d.ts` 的 `D.text` 里
   （`(o.weight || 700) + ' ' + size + 'px "Microsoft YaHei","PingFang SC",sans-serif'`），
   而字号是**调用点随手传的数字**（普查实测 6 档，无一处声明）。
   ⇒ 换后端时要"把所有调用点找出来看看用了哪些字号"——**那是内容在定义引擎的面**。

   这一层把面收进引擎：**字体栈 / 字重档 / 字号档 / 对齐 / 描边规则 / 字符集** 都成为声明，
   而后端（Canvas2D 直接 `fillText`；GL 烘字形图集）从**同一份声明**取参数。

   ## 字符集：**声明 + 门**，不是硬编清单

   普查实测（`tools/text-census.mjs`，读的是**字符串字面量**、注释不算）：

       1513 个不同字符 = CJK + 全角 1422 · ASCII 可见 91
       6 个字号档（11 / 12 / 13 / 15 / 16 / 17 px）
       ⇒ 字形图集规模 **1513 × 6 = 9078 个字形**

   ⚠ 把 1513 个字抄进这个文件是**错的**做法（它随文案变，一抄就漂）。
   采用**声明 + 门**：这里只声明**范围与已知集合**，而
   `tools/text-census.mjs` 扫真源码、由门 `text-census` 判"**声明覆盖得住实际用到的**"——
   漏一个字符就是运行时烘不出来、显示豆腐块。

   ## emoji 是**另一条路**（普查的新发现）

   实测用到 **11 个 emoji**（⚠ ✗ 🙂 ❌ ⚔ ☠ ✳ ✓ ✔ ★ 💡）。它们
   **不能进字形图集**（彩色位图 + 系统字体，烘出来是黑白的或空的）⇒
   登记为"**要走位图**"，由后端各自决定（Canvas2D 直接交给系统字体；GL 单独贴位图）。
   ========================================================= */
import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';

var Text = {} as TextApi;

/* =========================================================
   1. 字体栈 —— **唯一出处**
   ---------------------------------------------------------
   改造前这一串住在 `draw2d.ts` 的 `D.text` 里。
   顺序有意义：先中文（本作界面是中文），再通用兜底。
   ⚠ `monospace` 那一档是给崩溃卡/诊断面板用的（等宽，读栈方便）——
   它走 **DOM** 而不是 canvas（`crash.ts` / `main.ts`），所以这里登记它**只是为了
   "字体栈只有一个出处"**，不代表它经 `draw2d`。
   ========================================================= */
var STACKS: TextStackDef[] = [
  {
    id: 'ui',
    note: '界面与游戏内文字（中文优先，再通用兜底）',
    css: '"Microsoft YaHei","PingFang SC",sans-serif',
    /* 为什么是这两个：Windows 上 YaHei / macOS+iOS 上 PingFang 是各自平台的
       默认中文黑体；本作是矢量绘制，不要求字形与任何一份素材对齐。 */
    usedBy: 'canvas'
  },
  {
    id: 'mono',
    note: '等宽：崩溃卡 / 诊断面板（读栈与对齐数字用）',
    css: 'ui-monospace,Consolas,monospace',
    usedBy: 'dom'
  }
];

/* =========================================================
   2. 字重档（`D.text` 的 `o.weight`）
   ---------------------------------------------------------
   改造前是 `o.weight || 700` —— **默认值住在调用表达式里**，于是
   "本作一共几档字重"没有任何地方能回答。这里声明出来。
   ========================================================= */
var WEIGHTS: TextWeightDef[] = [
  { id: 'regular', value: 400, note: '正文/次要说明（诊断面板、伤害日志的后续行）' },
  { id: 'bold', value: 700, note: '**默认**：HUD / 标题 / 按钮（`D.text` 的缺省字重）' }
];
var DEFAULT_WEIGHT = 700;

/* =========================================================
   3. 字号档 —— **普查实测的那 6 档**
   ---------------------------------------------------------
   改造前字号是调用点随手传的数字（实测 6 档）。声明出来之后：
     · 字形图集知道要烘几套；
     · "随手加一个新字号"会被门 `text-census` 报出来（它是新档、没声明过）。
   ========================================================= */
var SIZES: TextSizeDef[] = [
  { px: 11, note: '最小号：伤害日志 / 图鉴的次要行' },
  { px: 12, note: '小号：诊断面板 / 提示' },
  { px: 13, note: '小号 +：崩溃卡附近（DOM 侧）' },
  { px: 15, note: '中号：HUD 常规 / 按钮' },
  { px: 16, note: '中号 +：标题行' },
  { px: 17, note: '大号：界面主标题' }
];

/* =========================================================
   4. 字符集：**范围 + 已知集合**（清单本体由门去对账）
   ========================================================= */
var CHARSETS: TextCharsetDef[] = [
  {
    id: 'cjk',
    note: '中日韩统一汉字 + 全角标点（**本作界面是中文，这一档最大**）',
    /* 声明的是**覆盖范围**而不是逐个字符：逐个抄会随文案漂。 */
    ranges: ['\u3000-\u303f', '\u3400-\u4dbf', '\u4e00-\u9fff', '\uf900-\ufaff', '\uff00-\uffef'],
    raster: 'glyphAtlas',
    census: { count: 1422 }
  },
  {
    id: 'ascii',
    note: 'ASCII 可见字符（数字 / 英文名 / 符号 / 标点）',
    ranges: ['\u0021-\u007e'],
    raster: 'glyphAtlas',
    census: { count: 91 }
  },
  {
    id: 'emoji',
    note: '⚠ **必须走位图**：彩色字形由系统字体提供，烘进字形图集会是黑白的或空的。'
      + '普查实测 11 个（⚠ ✗ 🙂 ❌ ⚔ ☠ ✳ ✓ ✔ ★ 💡）',
    ranges: ['\u2600-\u27bf', '\u{1f300}-\u{1f9ff}'],
    raster: 'bitmap',
    census: { count: 11 }
  }
];

/** 缺省排版参数 —— 改造前它们**散在 `D.text` 的表达式里**，现在收成一处 */
var LAYOUT = {
  /** 对齐缺省 */
  align: 'center' as string,
  /** 基线缺省 */
  baseline: 'middle' as string,
  /** 描边宽度：`max(2, size * 0.16)` —— **3px 基线那个家族**的一部分 */
  outlineMinPx: 2,
  outlineRatio: 0.16,
  /** 字距：本作**不做**手动字距（`fillText` 自带），登记为 0 以免下一个人以为漏了 */
  letterSpacingPx: 0,
  /** 换行：本作**不做**自动换行（所有文案都是短标签）；长文本走 DOM */
  autoWrap: false
};

/* =========================================================
   5. API：后端与调用点从这里取参数（**不自己拼字体串**）
   ========================================================= */
/** 拼 `ctx.font` —— **唯一出处**。改造前这行写在 `D.text` 里 */
Text.font = function (size, weight) {
  var st = STACKS[0];
  var w = weight === undefined || weight === null ? DEFAULT_WEIGHT : weight;
  return w + ' ' + size + 'px ' + st.css;
};

/** 按用途取字体栈（`mono` 那档走 DOM） */
Text.stack = function (id) {
  for (var i = 0; i < STACKS.length; i++) if (STACKS[i].id === id) return STACKS[i];
  return null;
};
Text.stacks = function () { return STACKS.slice(); };
Text.weights = function () { return WEIGHTS.slice(); };
Text.sizes = function () { return SIZES.map(function (s) { return s.px; }); };
Text.sizeTable = function () { return SIZES.slice(); };
Text.charsets = function () {
  return CHARSETS.map(function (c) {
    return { id: c.id, note: c.note, raster: c.raster, ranges: c.ranges.slice(), census: c.census.count };
  });
};
Text.layout = function () { return {
  align: LAYOUT.align, baseline: LAYOUT.baseline,
  outlineMinPx: LAYOUT.outlineMinPx, outlineRatio: LAYOUT.outlineRatio,
  letterSpacingPx: LAYOUT.letterSpacingPx, autoWrap: LAYOUT.autoWrap
}; };

/** 描边宽度 —— 与 `D.text` 改造前的表达式**逐位一致**（零行为变化的判据） */
Text.outlineWidth = function (size, given) {
  if (given !== undefined && given !== null) return given;
  return Math.max(LAYOUT.outlineMinPx, size * LAYOUT.outlineRatio);
};

/** **能烘多少个字形**（字形图集的规模）—— R49 阶段 4 直接要这个数 */
Text.atlasBudget = function () {
  var glyphChars = 0, bitmapChars = 0;
  for (var i = 0; i < CHARSETS.length; i++) {
    if (CHARSETS[i].raster === 'glyphAtlas') glyphChars += CHARSETS[i].census.count;
    else bitmapChars += CHARSETS[i].census.count;
  }
  return { glyphChars: glyphChars, bitmapChars: bitmapChars, sizes: SIZES.length, glyphs: glyphChars * SIZES.length };
};

/** 一个字符走哪条路（后端用它决定"喂字形图集还是贴位图"） */
Text.rasterOf = function (ch) {
  var cp = ch.codePointAt(0);
  for (var i = 0; i < CHARSETS.length; i++) {
    var cs = CHARSETS[i];
    var range = cs.ranges[0].split('-');
    /* ⚠ 只按第一段范围做快速判断是不够的 —— 这里逐段比对（范围数很少） */
    for (var r = 0; r < cs.ranges.length; r++) {
      var seg = cs.ranges[r].split('-');
      var lo = seg[0].codePointAt(0);
      var hi = seg.length > 1 ? seg[1].codePointAt(0) : lo;
      if (cp >= lo && cp <= hi) return cs.raster;
    }
    void range;
  }
  return 'glyphAtlas';   /* 未知字符按字形走（宁可烘一张空图，也不要漏） */
};

/* =========================================================
   6. 定义期自检 + 总账
   ========================================================= */
Text.audit = function () {
  var problems: string[] = [];

  /* 字体栈：至少一档 canvas、id 唯一、每档写用途与宿主 */
  var seen: Record<string, boolean> = Object.create(null);
  var canvasStacks = 0;
  for (var i = 0; i < STACKS.length; i++) {
    var s = STACKS[i];
    if (!s.id) problems.push('字体栈第 ' + i + ' 档没有 id');
    else if (seen[s.id]) problems.push('字体栈 id 重复：' + s.id);
    else seen[s.id] = true;
    if (!s.css) problems.push('字体栈 `' + s.id + '` 没有 css 串');
    if (!s.note) problems.push('字体栈 `' + s.id + '` 没写用途');
    if (s.usedBy !== 'canvas' && s.usedBy !== 'dom') problems.push('字体栈 `' + s.id + '` 的 usedBy 只能是 canvas / dom');
    if (s.usedBy === 'canvas') canvasStacks++;
  }
  if (!canvasStacks) problems.push('没有任何一档字体栈标了 usedBy=canvas —— 那 `Text.font()` 就没有来源');

  /* 字重：默认那个必须在表里 */
  var haveDefault = false;
  for (var w = 0; w < WEIGHTS.length; w++) if (WEIGHTS[w].value === DEFAULT_WEIGHT) haveDefault = true;
  if (!haveDefault) problems.push('缺省字重 ' + DEFAULT_WEIGHT + ' 不在字重表里（那它就没有名字与用途）');

  /* 字号：升序、无重复、至少一档 */
  if (!SIZES.length) problems.push('字号表是空的');
  for (var k = 1; k < SIZES.length; k++) {
    if (SIZES[k].px <= SIZES[k - 1].px) problems.push('字号表必须**升序且不重复**，实得 ' + SIZES[k - 1].px + ' → ' + SIZES[k].px);
  }
  for (var z = 0; z < SIZES.length; z++) if (!SIZES[z].note) problems.push('字号 ' + SIZES[z].px + 'px 没写用途（不写用途的档位会被随手加）');

  /* 字符集：每档要么 glyphAtlas 要么 bitmap，且必须声明覆盖范围 */
  for (var c = 0; c < CHARSETS.length; c++) {
    var cs = CHARSETS[c];
    if (cs.raster !== 'glyphAtlas' && cs.raster !== 'bitmap') {
      problems.push('字符集 `' + cs.id + '` 的 raster 只能是 glyphAtlas / bitmap');
    }
    if (!cs.ranges || !cs.ranges.length) problems.push('字符集 `' + cs.id + '` 没声明覆盖范围');
    if (!cs.note) problems.push('字符集 `' + cs.id + '` 没写用途');
    if (!cs.census || typeof cs.census.count !== 'number') {
      problems.push('字符集 `' + cs.id + '` 没写普查读数 —— 那门 `text-census` 就没有对照基线');
    }
  }
  /* 至少要有一档走字形图集（否则 atlasBudget 的 glyphs 会是 0，等于没有文字能力） */
  var hasAtlas = CHARSETS.filter(function (x) { return x.raster === 'glyphAtlas'; }).length > 0;
  if (!hasAtlas) problems.push('没有任何字符集走字形图集 —— 那样 GL 后端一个字形都烘不出来');

  return { ok: problems.length === 0, problems: problems };
};

Registry.family('textSurface', {
  note: '文字面：字体栈 / 字重档 / 字号档 / 字符集（含 emoji 走位图）/ 排版缺省。'
    + '**字形图集的规模由它算出来**（R49 阶段 4 的前置数据）',
  owner: 'text.ts',
  entries: function () {
    var out: { id: string; name: string; note: string }[] = [];
    for (var i = 0; i < STACKS.length; i++) out.push({ id: 'stack:' + STACKS[i].id, name: STACKS[i].id, note: STACKS[i].note });
    for (var w = 0; w < WEIGHTS.length; w++) out.push({ id: 'weight:' + WEIGHTS[w].id, name: String(WEIGHTS[w].value), note: WEIGHTS[w].note });
    for (var s = 0; s < SIZES.length; s++) out.push({ id: 'size:' + SIZES[s].px, name: SIZES[s].px + 'px', note: SIZES[s].note });
    for (var c = 0; c < CHARSETS.length; c++) out.push({ id: 'charset:' + CHARSETS[c].id, name: CHARSETS[c].id + '（' + CHARSETS[c].census.count + '）', note: CHARSETS[c].note });
    return out;
  }
});

var verdict = Text.audit();
if (!verdict.ok) {
  throw new Error('text.ts 文字面自检失败：\n' + verdict.problems.join('\n'));
}
SelfCheck.register('Text', Text.audit);

export { Text };
