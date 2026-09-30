/* =========================================================
   appearance.ts — 外观系统（R50 的第 9 条：**时装系统**）
   ---------------------------------------------------------
   用户 2026-10-01 的原话：

   > 「要有技能系统，角色系统，天赋系统，装备系统，武器系统，道具系统，
   >   能力系统，属性系统，**时装系统**，状态系统」
   > 「而如果是选择新存档，就会需要**捏人选择初始角色外观**」

   改造之前，外观**只有两个字段**，而且写死在角色表里：
   `data_chars.ts` 每个角色一行 `tint: [亮, 暗]` + `face: 'stern' | 'angry' | 'round'`，
   由 `sprites.ts` 读。玩家无处可改，也没有任何一处能回答
   "这个游戏一共有几种外观、它们分别长什么样"。

   ⚠ **与 B02 / R30 的硬约束对齐**：本项目是"零素材、100% 程序化美术"，
   所以时装**不许**是贴图或外部资源 —— 它只能是**配色与配件的程序化变体**。
   这条不是限制，是这套系统能成立的前提：外观 = 一份纯数据
   （一个色板 id + 一张脸 + 一件配件 id），交给 `sprites.ts` 画。

   本模块只做**声明与纯计算**，一行绘制代码都没有：
     · 色板 / 配件 / 脸型三张表（`Registry` 家族，写错一个 id 当场红）
     · `Appearance.eyesOf` —— **唯一**的"眼睛风格从哪来"分派处
       （改造前这个 `charDef.face || 'stern'` 在 `sprites.ts` 里抄了两遍）
     · `Appearance.pick(id, seed)` —— 从一张表里**确定性地**挑一个
       （捏人页的"随机"按钮走它；用种子而不是 `Math.random`，
        于是"随机出来的那套外观"可复现、可测）

   没有构建期的绘制依赖，所以它能待在 **meta 层**（与 `profile.ts` 同层）：
   `sprites.ts`（表现层）与 `character.ts`（meta 层）都能读它，两边都不会成环。
   ========================================================= */

import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';

var Appearance = {} as AppearanceApi;

/* =========================================================
   1. 色板（捏人页的"外观"主选项）
   ---------------------------------------------------------
   每个色板给三样东西：`base`（亮面）/`sh`（暗面）/`hi`（高光）。
   `hi` 拿白色是**美术宪法**（`draw2d.ts`）里那条"纯色平涂 + 粗黑描边"的产物：
   高光不做渐变，就一层更亮的平涂。

   ⚠ 色板是**角色表的缺省值之外的另一种可能**，不是"更好的"：
   `data_chars.ts` 的 `tint` 仍然是每个角色的本色，没捏人时逐位照旧 ——
   这是行为指纹不变的前提（外貌不进模拟，只进渲染的取色）。
   ========================================================= */
var PALETTES: AppearancePaletteDef[] = [
  { id: 'wheat', name: '麦色', note: '角色表里的本色，第一次上手看到的就是它（**没有自带颜色** —— 它就是这个意思）', base: '', sh: '', hi: '#fffdf2' },
  { id: 'sand', name: '沙褐', note: '偏暖的土色，与荒漠那一层的配色不打架', base: '#e6cfa4', sh: '#bda071', hi: '#fffaf0' },
  { id: 'ash', name: '灰烬', note: '接近灰白，在暗色房间里最显眼', base: '#cfc7bb', sh: '#9a9288', hi: '#fffdf6' },
  { id: 'moss', name: '苔绿', note: '与菌毯同一族的绿 —— 看着像"从这儿长出来的"', base: '#c2d0a8', sh: '#8b9a6f', hi: '#fbfff0' },
  { id: 'clay', name: '陶红', note: '烧结过的红土色', base: '#dcab90', sh: '#b07a5f', hi: '#fff5ee' },
  { id: 'frost', name: '霜蓝', note: '冷色，与熔渣裂谷那层的暖色反差最大', base: '#bcd2dc', sh: '#87a2b0', hi: '#f6fdff' },
  { id: 'plum', name: '梅紫', note: '菌母那一族的紫', base: '#d0b6d4', sh: '#9b7ea4', hi: '#fdf5ff' },
  { id: 'char', name: '炭黑', note: '最暗的一档，配亮配件最清楚', base: '#9c9490', sh: '#6d6663', hi: '#efeae6' }
];

/* =========================================================
   2. 脸型（眼睛的画法）
   ---------------------------------------------------------
   值域**复用 `enemyEye` 家族**（`enemies.ts` 登记）—— 角色的脸用的是
   怪物眼睛的画法，这不是巧合：两者共用同一套造型关键字。
   `data_chars.ts` 早就这么引用了（`Registry.uses('face', 'enemyEye')`），
   这里只是把"玩家能挑哪几种"也列出来。

   ⚠ **这个家族不在这里重新登记**（重名会抛）：它归 `enemies.ts`，
   本模块只**引用**它。写一个不在里面的值 → 总账当场报红。
   ========================================================= */
var FACES: AppearanceFaceDef[] = [
  { id: 'stern', name: '沉静', note: '平直的嘴 + 收窄的眼，最中性的一张脸' },
  { id: 'angry', name: '凶悍', note: '压低的眉 + 上翘的嘴，看着就不好惹' },
  { id: 'round', name: '圆钝', note: '圆眼 + 小嘴，与"厚实"的角色搭' }
];

/* =========================================================
   3. 配件（时装的那一半：头上顶一件东西）
   ---------------------------------------------------------
   ⚠ **三件，不是三十件** —— 这是刻意的。配件每一件都要在 `sprites.ts` 里
   有一支画法（程序化，零素材），所以"这个表有多长"= "有多少支画法"。
   表长而画法少 = 玩家选中一件什么也看不见，那是最坏的一种假声明。
   于是两者由同一条守卫对齐：`sprites.ts` 的画法表必须与本表**逐一对应**
   （`test/appearance.mjs` 的静态扫描 + `Registry.family('lookAccessory')`）。

   `dy` 是"相对头顶往上多少倍身体半径" —— 配件要跟着角色的呼吸与体型走，
   写死像素的话换个角色就会陷进头里或飘在半空。0 = 贴着头顶。
   ========================================================= */
var ACCESSORIES: AppearanceAccessoryDef[] = [
  { id: 'none', name: '不戴', note: '空着 —— 默认档，与改造前逐位相同', dy: 0 },
  { id: 'cap', name: '帽檐', note: '一顶扁帽子 + 一条横檐', dy: 0.22 },
  { id: 'horns', name: '双角', note: '两根弯角，从头顶两侧长出来', dy: 0.10 },
  { id: 'antenna', name: '触须', note: '一根细须 + 顶端一个亮点（菌类的样子）', dy: 0.06 },
  { id: 'goggles', name: '护目镜', note: '一条横带 + 两个圆镜片，架在眼睛那一线', dy: -0.10 }
];

var PALETTE_BY_ID: Record<string, AppearancePaletteDef> = Object.create(null);
var FACE_BY_ID: Record<string, AppearanceFaceDef> = Object.create(null);
var ACCESSORY_BY_ID: Record<string, AppearanceAccessoryDef> = Object.create(null);
(function index() {
  var i;
  for (i = 0; i < PALETTES.length; i++) PALETTE_BY_ID[PALETTES[i].id] = PALETTES[i];
  for (i = 0; i < FACES.length; i++) FACE_BY_ID[FACES[i].id] = FACES[i];
  for (i = 0; i < ACCESSORIES.length; i++) ACCESSORY_BY_ID[ACCESSORIES[i].id] = ACCESSORIES[i];
})();

/* =========================================================
   4. 纯函数
   ========================================================= */
Appearance.PALETTES = PALETTES;
Appearance.FACES = FACES;
Appearance.ACCESSORIES = ACCESSORIES;
Appearance.DEFAULT_PALETTE = 'wheat';
Appearance.DEFAULT_FACE = 'stern';
Appearance.DEFAULT_ACCESSORY = 'none';

/** 这张色板在不在表里（界面拿它决定"出生就要不要落到某个缺省"） */
Appearance.hasPalette = function (id) { return !!PALETTE_BY_ID[String(id || '')]; };
Appearance.hasFace = function (id) { return !!FACE_BY_ID[String(id || '')]; };
Appearance.hasAccessory = function (id) { return !!ACCESSORY_BY_ID[String(id || '')]; };
Appearance.palette = function (id) { return PALETTE_BY_ID[String(id || '')] || null; };
Appearance.accessory = function (id) { return ACCESSORY_BY_ID[String(id || '')] || null; };

/**
 * 一件配件的**形状参数**（画法读它，而不是自己写死数字）。
 * 认不出的 id 返回 null —— 画法据此"什么也不画"，而不是抛。
 */
Appearance.accessoryShape = function (id) {
  var a = ACCESSORY_BY_ID[String(id || '')];
  return a ? { id: a.id, dy: a.dy } : null;
};

/**
 * 一张色板折成 `drawBronana` 认识的皮肤对象。
 * `charDefTint` = 角色表里的本色（缺省档走它，于是没捏人时逐位照旧）。
 *
 * ⚠ `dp`（暗部）与 `sh` 同色是**原实现的行为**（`sprites.ts` 的
 * `bronanaPortrait` 就是 `dp: tint[1]`），不是这里抄错。
 */
Appearance.skinFor = function (paletteId, charDefTint, charHi) {
  var p = PALETTE_BY_ID[String(paletteId || '')];
  var tint = charDefTint && charDefTint.length ? charDefTint : null;
  /* 缺省档（`wheat`）**没有自带颜色** —— 它的意思就是"用角色自己的本色"。
     这样"没捏人"与"捏了一套与本角色相同的色"不是两件事，只有一件。 */
  var base = (p && p.base) ? p.base : (tint ? tint[0] : null);
  var sh = (p && p.sh) ? p.sh : (tint ? tint[1] : null);
  return { base: base, hi: (p && p.hi) || charHi || '#fffdf2', sh: sh, dp: sh };
};

/**
 * **唯一的**"眼睛风格从哪来"分派处。
 *
 * 改造前这行 `charDef.face || 'stern'` 在 `sprites.ts` 里出现了**两次**
 * （`playerBodySprite` 的预热与绘制），`render.ts` 里又一次 ——
 * 三处各自写一遍，加一种脸型就等于要改三处而漏改不报错。
 *
 * 优先级：捏人挑的那一张 > 角色表里的本色 > `stern`（构造期的安全缺省）。
 */
Appearance.eyesOf = function (charDef, face) {
  var f = String(face || '');
  if (FACE_BY_ID[f]) return f;
  var own = charDef && charDef.face ? String(charDef.face) : '';
  return own || Appearance.DEFAULT_FACE;
};

/**
 * 从一张表里**确定性地**挑一个 id（捏人页的"随机"按钮走它）。
 *
 * 为什么不用 `Math.random`：捏人页要能被测试"点一下、看到什么、断言什么"。
 * 种子化的挑选还有一个附带好处 —— 同一个种子 + 同一次点击永远是同一套外观，
 * 于是"我觉得随机出来的这套好看，再点两下找回来"在版本之间也复现得出来。
 *
 * @param ids  候选（一般是某一列的 id 数组）
 * @param seed 任意整数（界面传 `U.rng` 的产物或一个计数器）
 */
Appearance.pick = function (ids, seed) {
  var list = ids && ids.length ? ids : [];
  if (!list.length) return '';
  var s = (Math.floor(Number(seed) || 0) >>> 0);
  /* xorshift 的一步足够 —— 这里要的是"确定且分布不差"，不是密码学强度 */
  s ^= s << 13; s >>>= 0;
  s ^= s >> 17;
  s ^= s << 5; s >>>= 0;
  return String(list[s % list.length]);
};

/** 一行行给人看（调试 / 图鉴共用） */
Appearance.describe = function () {
  return '外观：' + PALETTES.length + ' 色板 · ' + FACES.length + ' 脸型 · ' +
    ACCESSORIES.length + ' 配件（全部程序化，零素材）';
};

/* =========================================================
   5. 定义期自检
   ========================================================= */
Appearance.audit = function () {
  var problems = [];
  var i, k;
  var seen: Record<string, boolean> = Object.create(null);

  function checkTable(tag, list) {
    var local: Record<string, boolean> = Object.create(null);
    for (var j = 0; j < list.length; j++) {
      var d = list[j];
      if (!d.id) { problems.push(tag + ' 第 ' + j + ' 项没有 id'); continue; }
      if (local[d.id]) problems.push(tag + ' id 重复：' + d.id);
      local[d.id] = true;
      if (seen[tag + ':' + d.id]) problems.push(tag + ' id 重复（跨表）：' + d.id);
      seen[tag + ':' + d.id] = true;
      if (!d.name) problems.push(tag + ' ' + d.id + ' 没有名字（界面上会是个空按钮）');
      if (!d.note) problems.push(tag + ' ' + d.id + ' 没有说明（捏人页写不出它是什么）');
    }
    if (!list.length) problems.push(tag + ' 是空表（玩家没有任何可选的外观）');
    return local;
  }
  var pal = checkTable('色板', PALETTES);
  checkTable('脸型', FACES);
  var acc = checkTable('配件', ACCESSORIES);

  /* 缺省档必须真实存在 —— 否则"没捏人"会落到一个查不到的 id 上，
     表现是角色变成默认皮肤而**没有任何一处报错**。 */
  if (!pal[Appearance.DEFAULT_PALETTE]) {
    problems.push('默认色板 ' + Appearance.DEFAULT_PALETTE + ' 不在表里');
  }
  if (!acc[Appearance.DEFAULT_ACCESSORY]) {
    problems.push('默认配件 ' + Appearance.DEFAULT_ACCESSORY + ' 不在表里');
  }
  /* 脸型的值域归 `enemyEye`（enemies.ts）。两边对不上的表现是
     "选了一张脸，画出来却是另一张" —— 这里只查**结构**，
     值域那条由总账的 `Registry.family('lookFace')` 引用查。 */
  if (!FACES.some(function (f) { return f.id === Appearance.DEFAULT_FACE; })) {
    problems.push('默认脸型 ' + Appearance.DEFAULT_FACE + ' 不在表里');
  }
  /* 色板必须真的有颜色（除了缺省那一档 —— 它的意思是"用角色本色"） */
  for (i = 0; i < PALETTES.length; i++) {
    if (PALETTES[i].id === Appearance.DEFAULT_PALETTE) continue;
    if (!PALETTES[i].base || !PALETTES[i].sh) {
      problems.push('色板 ' + PALETTES[i].id + ' 缺 base/sh（画出来会是没有颜色的）');
    }
  }
  /* `pick` 必须真的与种子有关，而且**永远返回表里的东西** */
  var probe = PALETTES.map(function (p) { return p.id; });
  var a = Appearance.pick(probe, 1), b = Appearance.pick(probe, 2);
  if (probe.indexOf(a) < 0 || probe.indexOf(b) < 0) problems.push('pick 返回了表外的 id');
  if (a === b) problems.push('pick 对两个不同的种子返回了同一个值（"随机"按钮会像是坏的）');
  if (Appearance.pick([], 1) !== '') problems.push('pick 空表必须返回空串（不是 undefined）');

  /* `eyesOf` 的三级优先必须真的成立 —— 它是三处抄写的收口处。
     传的是**半份** CharDef（只需要 `face` 那一个字段），所以逐条断言而不是走类型：
     本模块不该为了自检把 `CharDef` 的 8 个必填字段全造一遍。 */
  var fake = { face: 'angry' } as CharDef;
  if (Appearance.eyesOf(fake, 'round') !== 'round') problems.push('eyesOf 没有优先用玩家挑的脸');
  if (Appearance.eyesOf(fake, '') !== 'angry') problems.push('eyesOf 没有退回角色本色');
  if (Appearance.eyesOf({} as CharDef, '') !== 'stern') problems.push('eyesOf 没有兜到 stern');

  /* `skinFor` 的缺省档必须**退回角色本色**（否则没捏人的角色会全部变一个色，
     而"没捏人"与"捏了"的差别就此消失） */
  var sk = Appearance.skinFor(Appearance.DEFAULT_PALETTE, ['#111111', '#222222'], '#ffffff');
  if (sk.base !== '#111111' || sk.sh !== '#222222') {
    problems.push('skinFor 的缺省色板没有退回角色本色（' + sk.base + '/' + sk.sh + '）');
  }
  /* 配件形状：认不出的 id 返回 null（画法据此不画），而不是抛 */
  if (Appearance.accessoryShape('这不是配件') !== null) problems.push('accessoryShape 对未知 id 没有返回 null');
  if (!Appearance.accessoryShape('cap')) problems.push('accessoryShape 认不出 cap');

  return {
    ok: problems.length === 0, problems: problems,
    counts: { palettes: PALETTES.length, faces: FACES.length, accessories: ACCESSORIES.length }
  };
};

var verdict = Appearance.audit();
if (!verdict.ok) throw new Error('appearance.ts 自检失败：\n' + verdict.problems.join('\n'));
SelfCheck.register('Appearance', Appearance.audit);

/* =========================================================
   6. 登记进扩展点总账
   ---------------------------------------------------------
   三张表各一个家族，外加一条**字段 → 家族**的声明：
   `CharacterDef.look.*` 里的 `palette` / `accessory` 就是这两张表的 id。
   ========================================================= */
Registry.family('lookPalette', {
  note: '外观色板（捏人页的"外观"主选项；全部程序化，零素材）', owner: 'appearance.ts',
  values: function () { return PALETTES.map(function (p) { return p.id; }); }
});
Registry.family('lookFace', {
  note: '外观脸型（眼睛的画法；值域与 `enemyEye` 同源 —— 角色的脸用的就是怪物眼睛那套关键字）',
  owner: 'appearance.ts',
  entries: function () {
    return FACES.map(function (f) {
      return { id: f.id, refs: [{ field: 'id', value: f.id, family: 'enemyEye' }] };
    });
  }
});
Registry.family('lookAccessory', {
  note: '外观配件（时装的那一半：头上顶一件东西；每一件都要有一支画法）',
  owner: 'appearance.ts',
  values: function () { return ACCESSORIES.map(function (a) { return a.id; }); }
});

Registry.uses('palette', 'lookPalette');
Registry.uses('accessory', 'lookAccessory');

export { Appearance };
