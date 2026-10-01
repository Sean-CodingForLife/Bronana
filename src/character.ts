/* =========================================================
   character.ts — 存档角色（"这个档里的那个人"）
   ---------------------------------------------------------
   用户 2026-10-01 的原话：

   > 「点击开始游戏按钮，**选择存档**，进入游戏，第一个到的是大厅…」
   > 「而如果是选择新存档，就会需要**捏人选择初始角色外观，选择初始角色职业**，
   >   然后就能确定这个角色的**初始技能，初始属性，初始天赋**等确定人物以后
   >   开始世界冒险」

   改造之前**没有这个对象**。选人（`UI.selectedChar`）是**每局一次**的动作：
   · 它不进存档 —— 关掉浏览器再打开，上一次选的是谁没人记得
   · 它没有名字、没有外观 —— 外观是 `data_chars.ts` 里写死的 `tint` / `face`
   · `Profile` 是**账号级**的（`perChar` 是"每个角色一本账"），
     而"这一档的那个人是谁"这个概念一处都没有

   于是 `R50` 的待确认第 5 条问的正是这件事："存档里要不要存这个档的那个人"。
   本轮把它做出来了 —— 这条也顺带解决了"选择存档"那一步：
   **槽位里有没有角色** 就是"新档 / 老档"唯一可靠的判据
   （`Slots.used()` 只看有没有写进去过任何一份键，
    而设置里随便切一下槽位、随手写一次档案就会让它变真）。

   ⚠ **本模块只做形状与规则，不做落盘**。落盘归 `profile.ts`
   （`CharacterDef` 住在 `data.characters[slot]`，与 `perChar` 同一个存档）。
   这样拆的理由与 `slots.ts` 一样：本模块不认识存储，
   所以它不会因为存储层改形状而失效；反过来 `profile.ts` 只要"归一 + 夹取"。

   ⚠ **它不认识 `data_chars.ts`**（职业表）。校验"选中的职业存不存在"
   由**总账**做（`Registry.family('character')` 的 refs → `char` 家族）——
   直接 import 会让 meta 层依赖一张数据表，而那是一条没必要的边。
   ========================================================= */

import { Appearance } from './appearance.ts';
import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';

var Character = {} as CharacterApi;

/* =========================================================
   1. 常量
   ========================================================= */
/** 名字上限（界面上的输入框用 `maxlength` 取它，不写第二份） */
Character.NAME_MAX = 10;
/** 缺省名字：玩家留空时用它（不是"无名氏"这种占位符 —— 它是一句设定） */
Character.DEFAULT_NAME = '菌生者';

/* =========================================================
   2. 归一：一份**来自存档的**原始对象 → 一个可用的 CharacterDef
   ---------------------------------------------------------
   为什么输入类型是 `unknown` 而不是 `CharacterDef`：
   传进来的东西**就是**坏档（`JSON.parse` 的产物），
   把它标成 `CharacterDef` 只是把不安全藏进类型里。
   这里逐字段夹取，出来的才是 `CharacterDef`。

   逐字段夹取而不是"信它"的代价在 `profile.ts` 那里已经写清过一次
   （`perChar.__proto__` 那次实测）：坏档的字段**必须**在入口被摁死，
   否则它会一路走到渲染层，表现为"金币 NaN"那种与真实原因无关的现象。
   ========================================================= */
function normName(v: unknown): string {
  var s = String(v === undefined || v === null ? '' : v).trim();
  /* 控制字符与换行会破坏界面布局（名字只有一行）；
     它们不是"要报错"的输入，只是要夹掉的。 */
  s = s.replace(/[\u0000-\u001f\u007f]/g, '');
  if (!s) return Character.DEFAULT_NAME;
  return s.length > Character.NAME_MAX ? s.slice(0, Character.NAME_MAX) : s;
}

Character.normalize = function (raw: unknown, fallbackCharId?: string): CharacterDef {
  var o = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
  var look = (o.look && typeof o.look === 'object') ? (o.look as Record<string, unknown>) : {};
  var init = (o.init && typeof o.init === 'object') ? (o.init as Record<string, unknown>) : {};
  var charId = String(o.charId || fallbackCharId || 'ranger');

  /* 三样外观：认不出就落到缺省档（**不是**抛）。
     坏档里一个不存在的色板 id 不该让这个档打不开 ——
     它只是回到"没捏过的样子"。 */
  var palette = Appearance.hasPalette(look.palette) ? String(look.palette) : Appearance.DEFAULT_PALETTE;
  var face = Appearance.hasFace(look.face) ? String(look.face) : Appearance.DEFAULT_FACE;
  var accessory = Appearance.hasAccessory(look.accessory)
    ? String(look.accessory) : Appearance.DEFAULT_ACCESSORY;

  /* 入门三选（初始技能 / 初始属性 / 初始天赋）的**登记**：
     它们是"确定性选择"（选了哪一项），不是数值 —— 数值怎么折在各自的数据表里。
     ⚠ 这里**只记 id**：本模块不认识 `skills.ts` / `talents.ts` / `stats.ts`，
       所以"这个 id 存不存在"由那张表自己守（`test/character.mjs` 逐条对账）。 */
  var entry = (init.entry && typeof init.entry === 'object')
    ? (init.entry as Record<string, unknown>) : {};

  /* ---- **交易换到的东西**（R41）：下一局的开局条件 ----
     与 `look` / `init` 同一套路：坏值**夹回来**而不是抛 ——
     一个认不出的武器 id 不该让这个档打不开，只该让它回到"没换过"。
     ⚠ "那个 id 存不存在"由**总账**查（下面 `character` 家族的 refs），
       本模块不认识 `data_weapons` / `data_items`（那会多一条到数据表的边）。 */
  var sw: string[] = [];
  var rawW = Array.isArray(o.starterWeapons) ? (o.starterWeapons as unknown[]) : [];
  for (var wi = 0; wi < rawW.length && sw.length < 8; wi++) {
    var wid = String(rawW[wi] || '');
    if (wid && sw.indexOf(wid) < 0) sw.push(wid);
  }
  var si: string[] = [];
  var rawI = Array.isArray(o.starterItems) ? (o.starterItems as unknown[]) : [];
  for (var ii = 0; ii < rawI.length && si.length < 8; ii++) {
    var iid = String(rawI[ii] || '');
    if (iid && si.indexOf(iid) < 0) si.push(iid);
  }
  var ss = Math.max(0, Math.floor(Number(o.starterScrap) || 0));
  if (ss > 9999) ss = 9999;

  return {
    charId: charId,
    name: normName(o.name),
    look: { palette: palette, face: face, accessory: accessory },
    starterWeapons: sw,
    starterItems: si,
    starterScrap: ss,
    init: {
      entry: {
        skill: String(entry.skill || ''),
        stat: String(entry.stat || ''),
        talent: String(entry.talent || '')
      }
    }
  };
};

/* =========================================================
   3. 造一个（新存档的捏人）
   ========================================================= */
/**
 * 一个全新的角色。
 *
 * @param charId  初始职业（`data_chars.ts` 的 id；存不存在由总账查）
 * @param raw     玩家在捏人页里挑的东西（可以缺省 —— 缺省 = 用职业本色）
 *
 * ⚠ 缺省的 `look` 是 `wheat` / `stern` / `none`，而 `wheat` 与 `none` 的语义是
 * **"用角色自己的本色"**（见 `Appearance.skinFor` / `sprites` 的画法表）。
 * 于是"没捏人"与"捏了一套和本色相同的外观"是**同一件事**，
 * 外观系统因此不会在没被使用的时候改变任何一个像素 —— 行为指纹不变的前提。
 */
Character.create = function (charId: string, raw?: unknown): CharacterDef {
  var c = Character.normalize(raw, charId);
  c.charId = String(charId || c.charId || 'ranger');
  return c;
};

/** 一次生成一套**确定性的**外观（捏人页的"随机"按钮走它，不看 `Math.random`） */
Character.randomLook = function (seed: number): CharacterLook {
  return {
    palette: Appearance.pick(Appearance.PALETTES.map(function (p) { return p.id; }), seed) ||
      Appearance.DEFAULT_PALETTE,
    face: Appearance.pick(Appearance.FACES.map(function (f) { return f.id; }), (seed || 0) + 7919) ||
      Appearance.DEFAULT_FACE,
    accessory: Appearance.pick(Appearance.ACCESSORIES.map(function (a) { return a.id; }), (seed || 0) + 104729) ||
      Appearance.DEFAULT_ACCESSORY
  };
};

/* =========================================================
   4. 问句（界面与接入层只走这几个口）
   ========================================================= */
/** 这一份"档里有没有人" —— **选择存档那一步唯一可靠的判据** */
Character.exists = function (c: CharacterDef | null | undefined): boolean {
  return !!(c && c.charId && c.name);
};

/** 他叫什么（界面上的名牌） */
Character.displayName = function (c: CharacterDef | null | undefined): string {
  return Character.exists(c) ? String(c.name) : '';
};

/** 他的职业 id */
Character.professionOf = function (c: CharacterDef | null | undefined): string {
  return Character.exists(c) ? String(c.charId) : '';
};

/**
 * 存档角色 → 渲染层要的三样（皮肤 / 眼睛 / 配件）。
 *
 * 这是**外观唯一的分派处**：`render.ts` 与 `sprites.ts` 都走它，
 * 于是"玩家捏的那张脸"与"角色表里写的那张脸"不可能在两个地方各算一遍。
 *
 * @param charDef 职业定义（拿它的 `tint` / `face` 当本色）
 */
Character.renderLook = function (c: CharacterDef | null | undefined, charDef: CharDef | null | undefined): CharacterRenderLook {
  var look = (c && c.look) ? c.look : null;
  var tint = (charDef && charDef.tint) ? charDef.tint : null;
  var paletteId = (look && look.palette) ? look.palette : Appearance.DEFAULT_PALETTE;
  return {
    skin: Appearance.skinFor(paletteId, tint, null),
    eyeStyle: Appearance.eyesOf(charDef, look ? look.face : ''),
    accessory: (look && look.accessory) ? look.accessory : Appearance.DEFAULT_ACCESSORY
  };
};

/** 一行行给人看（标题页 / 档位卡 / 调试共用） */
Character.describe = function (c: CharacterDef | null | undefined): string {
  if (!Character.exists(c)) return '空存档';
  var p = Appearance.palette(c.look.palette);
  var a = Appearance.accessory(c.look.accessory);
  return c.name + ' · ' + c.charId +
    ' · ' + (p ? p.name : c.look.palette) +
    ' · ' + c.look.face +
    ' · ' + (a ? a.name : c.look.accessory);
};

/* =========================================================
   5. 定义期自检
   ========================================================= */
Character.audit = function () {
  var problems = [];
  var i;

  /* 名字：空 → 缺省；超长 → 截断；控制字符 → 去掉。
     这三条都是"玩家/坏档真的会给的输入"，所以逐条量。 */
  if (Character.normalize({ name: '   ' }).name !== Character.DEFAULT_NAME) {
    problems.push('空名字没有落到缺省名（名牌会是空的）');
  }
  var long = 'x'.repeat(Character.NAME_MAX + 20);
  if (Character.normalize({ name: long }).name.length !== Character.NAME_MAX) {
    problems.push('超长名字没有被截到 ' + Character.NAME_MAX + ' 字');
  }
  if (/\n/.test(Character.normalize({ name: 'a\nb' }).name)) {
    problems.push('名字里的换行没有被去掉（会把界面撑成两行）');
  }

  /* 外观：三个坏 id 都要落到缺省档，而不是抛、也不是留着一个查不到的 id */
  var bad = Character.normalize({ name: 'x', look: { palette: '不存在', face: '不存在', accessory: '不存在' } });
  if (bad.look.palette !== Appearance.DEFAULT_PALETTE) problems.push('坏色板没有落到缺省');
  if (bad.look.face !== Appearance.DEFAULT_FACE) problems.push('坏脸型没有落到缺省');
  if (bad.look.accessory !== Appearance.DEFAULT_ACCESSORY) problems.push('坏配件没有落到缺省');

  /* "有没有人"这条判据必须**两种坏输入都答否** ——
     它是"新档 / 老档"的分叉口，答错一次就是"老档被当成新档重捏"（丢人）。 */
  if (Character.exists(null) || Character.exists(undefined)) problems.push('exists 对空值答了是');
  if (Character.exists({} as CharacterDef)) problems.push('exists 对空对象答了是');
  if (Character.exists(Character.create('ranger')) !== true) problems.push('exists 对造出来的角色答了否');

  /* `create` 必须尊重传进来的职业，而不是永远落在缺省职业上 */
  var made = Character.create('mage', { name: '试', look: { palette: 'moss' } });
  if (made.charId !== 'mage') problems.push('create 丢掉了传进来的职业');
  if (made.look.palette !== 'moss') problems.push('create 丢掉了传进来的色板');
  if (made.look.face !== Appearance.DEFAULT_FACE) problems.push('create 没给缺省脸型');

  /* `randomLook` 必须确定 —— 同一个种子两次不同 = 界面上"随机"按钮不可测 */
  var r1 = Character.randomLook(42), r2 = Character.randomLook(42), r3 = Character.randomLook(43);
  if (r1.palette !== r2.palette || r1.face !== r2.face || r1.accessory !== r2.accessory) {
    problems.push('randomLook 同一个种子给出了不同的结果（不可复现）');
  }
  if (r1.palette === r3.palette && r1.face === r3.face && r1.accessory === r3.accessory) {
    problems.push('randomLook 对两个不同的种子给出了完全相同的一套（"随机"按钮看着是坏的）');
  }
  /* 随机出来的三样都必须在表里（否则一按随机就落到坏档那一支） */
  var vals = [r1.palette, r1.face, r1.accessory];
  if (!Appearance.hasPalette(vals[0]) || !Appearance.hasFace(vals[1]) || !Appearance.hasAccessory(vals[2])) {
    problems.push('randomLook 返回了表外的 id：' + vals.join('/'));
  }

  /* `renderLook` 的缺省必须**等于**改造前的那一套（本色 + 职业脸 + 不戴配件）——
     这是"外观系统没有在没人用它的时候改变任何像素"的可判定形式。 */
  var cd = { id: 'x', name: 'n', en: 'n', tag: 't', desc: 'd', stats: {}, startWeapons: [], tint: ['#aaaaaa', '#555555'], face: 'round' } as CharDef;
  var rl = Character.renderLook(null, cd);
  if (rl.skin.base !== '#aaaaaa' || rl.skin.sh !== '#555555') {
    problems.push('renderLook 在没有存档角色时没有退回职业本色');
  }
  if (rl.eyeStyle !== 'round') problems.push('renderLook 在没有存档角色时没有退回职业脸型');
  if (rl.accessory !== Appearance.DEFAULT_ACCESSORY) problems.push('renderLook 的缺省配件不对');

  /* 捏过之后必须真的变（否则捏人页是个摆设） */
  var rl2 = Character.renderLook(Character.create('x', { look: { palette: 'frost', face: 'angry', accessory: 'horns' } }), cd);
  if (rl2.skin.base !== Appearance.palette('frost').base) problems.push('renderLook 没有用玩家挑的色板');
  if (rl2.eyeStyle !== 'angry') problems.push('renderLook 没有用玩家挑的脸型');
  if (rl2.accessory !== 'horns') problems.push('renderLook 没有用玩家挑的配件');

  /* 入门三选的**键**必须是这三个 —— 加一个键要同时改归一与界面，
     而"归一漏了一个键"的表现是"玩家选的东西没进档"，不报错。 */
  var keys = Object.keys(Character.create('ranger').init.entry).sort().join(',');
  if (keys !== 'skill,stat,talent') problems.push('入门三选的键变了：' + keys + '（归一、界面、测试要一起改）');

  return {
    ok: problems.length === 0, problems: problems,
    counts: { nameMax: Character.NAME_MAX, entryKeys: 3 }
  };
};

var verdict = Character.audit();
if (!verdict.ok) throw new Error('character.ts 自检失败：\n' + verdict.problems.join('\n'));
SelfCheck.register('Character', Character.audit);

/* =========================================================
   6. 登记进扩展点总账
   ---------------------------------------------------------
   ⚠ 这里**不枚举存档里的角色**（存档是玩家数据，不是声明表）——
   登记的是"这个形状由哪些字段组成、每个字段的值属于哪个家族"。
   写错职业 id 的表现是"开局那一瞬间才崩"（`Game.newRun` 找不到职业），
   而它在这张表里是**一眼可见的引用**。
   ========================================================= */
Registry.family('character', {
  note: '存档角色的形状（名字 / 外观 / 初始职业 / 入门三选）—— 字段的值域在这里对账',
  owner: 'character.ts',
  entries: function () {
    return [{
      id: 'fields',
      refs: [
        { field: 'charId', value: 'ranger', family: 'char' },
        { field: 'look.palette', value: Appearance.DEFAULT_PALETTE, family: 'lookPalette' },
        { field: 'look.face', value: Appearance.DEFAULT_FACE, family: 'lookFace' },
        { field: 'look.accessory', value: Appearance.DEFAULT_ACCESSORY, family: 'lookAccessory' },
        /* **交易换到的东西也在这里对账**（R41）：`starter*` 是**走完一局之后**
           才写进档的，所以"那个 id 存不存在"不能靠写入那一刻查 ——
           `Profile.applyRun` 在结算里，而那时不该再 import 武器表。
           放在这里的意思是：**任何**一条进档的 starter id 都必须是真实存在的。 */
        { field: 'starterWeapons[0]', value: 'knife', family: 'weapon' },
        { field: 'starterItems[0]', value: 'coffee', family: 'item' }
      ]
    }];
  }
});

/* ⚠ 刻意**不写** `Registry.uses('name', 'character')` 这类声明：
   `Registry.uses` 的语义是"数据表上的这个**字符串字段**的值属于哪个家族"，
   而 `name` 是自由文本、`look` / `init` 是子对象 —— 三个都不该进那份对应表。
   把自由文本塞进家族会逼出一张"所有可能的玩家名字"的表，那是荒唐的。
   `CharacterDef` 的字段值域由上面那个 `character` 家族的 refs 表达：
   一个一个**具体的**字段（`charId` / `look.palette` / ...）指向它该在的家族。 */

export { Character };
