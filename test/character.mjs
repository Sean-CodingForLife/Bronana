/* =========================================================
   character.mjs — 开局流程：选存档 → 选职业 → 捏人 → 大厅（R50）
   ---------------------------------------------------------
   这一套守的是**用户在 2026-10-01 点名的那条流程**：

   > 「点击开始游戏按钮，**选择存档**，进入游戏，第一个到的是大厅」
   > 「而如果是选择新存档，就会需要**捏人选择初始角色外观，选择初始角色职业**，
   >   然后就能确定这个角色的**初始技能，初始属性，初始天赋**等
   >   确定人物以后开始世界冒险」

   改造之前：没有"选存档"这一步（槽位只在设置里切），没有"这个档里的人"
   （选人是每局一次的动作、不进存档），外观写死在角色表里，也没有任何
   "开局三选"。所以这一套要守的东西分四层：

     [1] **存档角色**（`character.ts`）：归一 / 坏档防线 / 存在性判据
     [2] **外观系统**（`appearance.ts`）：三张表自洽 · 取色与取脸的唯一入口
     [3] **入门三选**（`openings.ts`）：每档都必须真的给东西 · 折叠进开局条件
     [4] **接进真游戏**：捏人挑的东西真的进了这一局（这是最容易断的那根线）
     [5] **槽位隔离**：一个槽 = 一份档 = 一个人（多存档的全部意义）

   ⚠ [4] 是这一套里最要紧的一节。R38 那次事故（技能系统从来没被传进任何一局）
   证明：**"系统本身完好"与"玩家看得到"是两件事**，而测试全绿不代表后者成立。
   ========================================================= */
import { installDom } from './_ctx.mjs';
import { loadAll, SIM_MODULES } from './_load.mjs';
import { T } from './_assert.mjs';

installDom();
await loadAll(SIM_MODULES);
const { Character, Appearance, Openings, Profile, Slots, Storage, Game, Chars, Stats } = globalThis;

console.log('\n=== Bronana · 开局流程（选存档 / 捏人 / 入门三选） ===\n');
Storage.wipe();
Slots.select(0);
Profile.load();

/* ---------------- [1] 存档角色 ---------------- */
T.section('1. 存档角色（"这个档里的那个人"）');
{
  T.ok(Character.audit().ok, '定义期自检通过', Character.audit().problems.join(' / '));

  const c = Character.create('mage', { name: '  测试  ', look: { palette: 'moss', face: 'angry', accessory: 'horns' } });
  T.eq(c.charId, 'mage', '职业写进去了');
  T.eq(c.name, '测试', '名字两头空白被去掉');
  T.eq(c.look.palette, 'moss', '色板写进去了');
  T.eq(c.look.face, 'angry', '脸型写进去了');
  T.eq(c.look.accessory, 'horns', '配件写进去了');

  /* **坏档防线**：传进来的东西就是 JSON.parse 的产物，逐字段夹取 */
  const bad = Character.normalize({ name: 'x\ny', look: { palette: '不存在', face: 123, accessory: null }, charId: 7 });
  T.eq(bad.look.palette, Appearance.DEFAULT_PALETTE, '坏色板落到缺省档（不是抛、也不是留着一个查不到的 id）');
  T.eq(bad.look.face, Appearance.DEFAULT_FACE, '坏脸型落到缺省档');
  T.eq(bad.look.accessory, Appearance.DEFAULT_ACCESSORY, '坏配件落到缺省档');
  T.ok(bad.name.indexOf('\n') < 0, '名字里的换行被去掉（它会把界面撑成两行）', JSON.stringify(bad.name));
  T.eq(bad.name.length <= Character.NAME_MAX, true, '名字不超过 ' + Character.NAME_MAX + ' 字');
  T.eq(Character.normalize({ name: '   ' }).name, Character.DEFAULT_NAME, '空名字落到缺省名（名牌不会是空的）');
  T.eq(Character.normalize({ name: 'x'.repeat(80) }).name.length, Character.NAME_MAX, '超长名字被截断');

  /* **"这个档里有没有人"是选存档那一步的判据** —— 两种坏输入都必须答"没有" */
  T.eq(Character.exists(null), false, 'null 答"没有人"');
  T.eq(Character.exists({}), false, '空对象答"没有人"');
  T.eq(Character.exists(Character.create('ranger')), true, '造出来的人答"有"');

  /* 渲染要的那三样：没捏过时必须**逐位等于改造前**（本色 + 职业脸 + 不戴） */
  const cd = Chars.BY_ID.ranger;
  const plain = Character.renderLook(null, cd);
  T.eq(plain.skin.base, cd.tint[0], '没人时退回职业本色（亮面）');
  T.eq(plain.skin.sh, cd.tint[1], '没人时退回职业本色（暗面）');
  T.eq(plain.eyeStyle, cd.face, '没人时退回职业脸型');
  T.eq(plain.accessory, Appearance.DEFAULT_ACCESSORY, '没人时不戴配件');
  /* 捏过之后必须真的**变**（否则捏人页是个摆设） */
  const dressed = Character.renderLook(Character.create('ranger', { look: { palette: 'frost', face: 'round', accessory: 'cap' } }), cd);
  T.eq(dressed.skin.base, Appearance.palette('frost').base, '挑的色板真的换了取色');
  T.eq(dressed.eyeStyle, 'round', '挑的脸型真的换了眼睛');
  T.eq(dressed.accessory, 'cap', '挑的配件真的戴上了');

  /* 随机外观必须**确定**：捏人页那枚按钮要能被测 */
  const r1 = Character.randomLook(20261001), r2 = Character.randomLook(20261001);
  T.eq(JSON.stringify(r1), JSON.stringify(r2), '同一个种子 → 同一套外观（可复现）');
  T.ok(Appearance.hasPalette(r1.palette) && Appearance.hasFace(r1.face) && Appearance.hasAccessory(r1.accessory),
    '随机出来的三样都在表里', JSON.stringify(r1));
}

/* ---------------- [2] 外观系统 ---------------- */
T.section('2. 外观系统（R50 第 9 条：时装）');
{
  T.ok(Appearance.audit().ok, '定义期自检通过', Appearance.audit().problems.join(' / '));
  T.ok(Appearance.PALETTES.length >= 4, '色板至少 4 档（' + Appearance.PALETTES.length + ' 档）');
  T.ok(Appearance.FACES.length >= 2, '脸型至少 2 档（' + Appearance.FACES.length + ' 档）');
  T.ok(Appearance.ACCESSORIES.length >= 2, '配件至少 2 档（' + Appearance.ACCESSORIES.length + ' 档）');

  /* ⚠ **表与画法必须一一对应** —— 表里多一件而画法少一支 = 玩家选中一件
     什么也看不见，而界面上照样写着"已选择"。这是最坏的一种假声明。 */
  const miss = Appearance.ACCESSORIES.filter(a => typeof globalThis.S.drawAccessory !== 'function');
  T.eq(miss.length, 0, '配件表每一档都有一支画法（sprites.ts 的 drawAccessory）');
  /* 缺省档的语义是"不戴" —— 它必须真的什么都不画 */
  T.eq(Appearance.accessoryShape(Appearance.DEFAULT_ACCESSORY).id, 'none', '缺省配件是"不戴"');
  T.eq(Appearance.accessoryShape('这不是配件'), null, '认不出的配件返回 null（画法据此不画，而不是抛）');

  /* **唯一取色入口**：缺省色板必须退回角色本色（否则"没捏"与"捏了"就没差别了） */
  const s = Appearance.skinFor(Appearance.DEFAULT_PALETTE, ['#111111', '#222222'], null);
  T.eq(s.base, '#111111', '缺省色板退回角色本色（亮面）');
  T.eq(s.sh, '#222222', '缺省色板退回角色本色（暗面）');
  const s2 = Appearance.skinFor('frost', ['#111111', '#222222'], null);
  T.eq(s2.base, Appearance.palette('frost').base, '挑了色板就不再用本色');

  /* **唯一取脸入口**：三级优先（玩家挑的 > 角色本色 > stern） */
  T.eq(Appearance.eyesOf(Chars.BY_ID.mage, 'round'), 'round', '玩家挑的脸优先');
  T.eq(Appearance.eyesOf(Chars.BY_ID.mage, ''), Chars.BY_ID.mage.face, '没挑就退回角色本色');
  T.eq(Appearance.eyesOf({}, ''), 'stern', '角色表也没写就兜到 stern');

  /* 取色与取脸的**实现只有一处** —— 源码里不许再有第二份 `charDef.tint[0]` */
  const fs = await import('node:fs');
  const path = await import('node:path');
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const roots = ['sprites.ts', 'render.ts', 'ui.ts'];
  const dup = roots.filter(f => {
    const src = strip(fs.readFileSync(path.join(process.cwd(), 'src', f), 'utf8'));
    return /charDef\.tint\s*&&\s*charDef\.tint\[0\]|charDef\.face\s*\|\|\s*'stern'/.test(src);
  });
  T.eq(dup.length, 0, '源码里没有第二份"取本色 / 取脸型"的抄写', dup.join(', '));
}

/* ---------------- [3] 入门三选 + 折叠 ---------------- */
T.section('3. 入门三选（初始技能 / 初始属性 / 初始天赋）');
{
  T.ok(Openings.audit().ok, '定义期自检通过', Openings.audit().problems.join(' / '));
  T.eq(Openings.COLS.length, 3, '三列：技能 / 属性 / 天赋');
  T.eq(Openings.COL_KEYS.join(','), 'skill,stat,talent',
    '列键与 `CharacterDef.init.entry` 的字段一一对应（改一个要一起改）');

  /* **本模块最要紧的一条判据**：选中一档必须真的发生点什么。
     空效果的一档在界面上照样显示"已选择" —— 那是最难查的一类错。 */
  const empty = Openings.LIST.filter(d => Openings.lines(d).length === 0);
  T.eq(empty.length, 0, '每一档都真的给东西（没有"选了等于没选"的档）', empty.map(d => d.id).join(', '));

  /* 同一列里两档不许给出同一份效果（那就是两个一样的按钮） */
  let same = [];
  Openings.COLS.forEach(col => {
    for (let i = 0; i < col.list.length; i++) {
      for (let j = i + 1; j < col.list.length; j++) {
        if (Openings.lines(col.list[i]).join('|') === Openings.lines(col.list[j]).join('|')) {
          same.push(col.key + ':' + col.list[i].id + '=' + col.list[j].id);
        }
      }
    }
  });
  T.eq(same.length, 0, '同一列里没有两档给出一模一样的效果', same.join(', '));

  /* 属性的键必须真的在属性表里 —— 写错一个的表现是"并进了一个没人读的位置" */
  const badKeys = [];
  Openings.col('stat').forEach(d => {
    Object.keys(d.stats || {}).forEach(k => { if (Stats.KEYS.indexOf(k) < 0) badKeys.push(d.id + '.' + k); });
  });
  T.eq(badKeys.length, 0, '属性档用的键都在 `Stats.KEYS` 里（写错会静默无效）', badKeys.join(', '));

  /* 折叠：三档各挑一个 → 三样都出现在同一份载荷里 */
  const fold = Openings.fold('ranger', { skill: 'sk_blade', stat: 'at_tough', talent: 'ta_coin' });
  T.ok(fold.weapons.indexOf('knife') >= 0, '初始技能折进"起始携带"', JSON.stringify(fold.weapons));
  T.eq(fold.stats.maxHp, 6, '初始属性折进"起始属性"');
  T.eq(fold.stats.armor, 1, '初始属性两项都在');
  T.eq(fold.scrap, 45, '初始天赋折进"起始废料"');
  /* 认不出的输入落第一档（与外观同一条纪律：坏档不该让这个档打不开） */
  const res = Openings.resolve({ skill: '不存在', stat: null, talent: 42 });
  T.eq(res.skill, Openings.col('skill')[0].id, '坏输入落到该列第一档');
  T.eq(res.talent, Openings.col('talent')[0].id, '每一列都落第一档');
  /* 折叠**不做随机、不看时间** —— 同一份输入永远同一份输出（回放能重建） */
  const a = JSON.stringify(Openings.fold('mage', { skill: 'sk_shot', stat: 'at_swift', talent: 'ta_mats' }));
  const b = JSON.stringify(Openings.fold('mage', { skill: 'sk_shot', stat: 'at_swift', talent: 'ta_mats' }));
  T.eq(a, b, '折叠是纯函数（同一份三选 → 同一份开局条件）');
}

/* ---------------- [4] 接进真游戏（最要紧的一节） ---------------- */
T.section('4. 接进真游戏：捏人挑的东西真的进了这一局');
{
  Storage.wipe();
  Slots.select(0);
  Profile.load();
  Profile.reset();

  /* 空档 → `character()` 答"没有人"（界面据此决定"开始新档"） */
  T.eq(Profile.character(), null, '空档里没有人（这就是"选存档"那一步的判据）');
  T.eq(Profile.hasCharacter(), false, 'hasCharacter 与它一致');

  /* 捏一个人 —— 三样都挑一个**与缺省不同**的档，于是"传没传进这一局"看得出来 */
  Profile.saveCharacter({
    name: '测试人',
    look: { palette: 'frost', face: 'round', accessory: 'horns' },
    init: { entry: { skill: 'sk_blade', stat: 'at_tough', talent: 'ta_coin' } }
  }, 'ranger');
  const me = Profile.character();
  T.ok(!!me, '存档里有这个人了');
  T.eq(me.name, '测试人', '名字存下来了');
  T.eq(me.look.palette, 'frost', '外观存下来了');

  /* ① **存档往返**：换档位再切回来，人还在（这是"存档角色"的底线） */
  Slots.select(1); Profile.load();
  T.eq(Profile.character(), null, '另一个槽位里没有人（一个槽 = 一份档 = 一个人）');
  Slots.select(0); Profile.load();
  T.eq(Profile.character().name, '测试人', '切回 0 号槽，那个人还在');

  /* ② **开局条件**：三选折进了 `openingOf` —— 而这是 `Game.newRun` 吃的唯一一份 */
  const open = Profile.openingOf('ranger');
  T.ok(open.weapons.indexOf('knife') >= 0, '初始技能出现在开局条件的起始武器里', JSON.stringify(open.weapons));
  T.ok(open.scrap >= 45, '初始天赋出现在开局条件的起始废料里', open.scrap);
  T.ok((open.stats.maxHp || 0) >= 6, '初始属性出现在开局条件的起始属性里', JSON.stringify(open.stats));

  /* ③ **真的进这一局**：跑起一局，检查那个人的外观与开局条件都在会话里 */
  const sess = Game.newRun('ranger', 12345, 0, open, { owned: {}, forge: null }, Profile.skillBuild('ranger'));
  T.ok(!!sess, '开局建起来了');
  const p = sess.player;
  T.ok(!!p.look, '玩家对象上带着外观（渲染层每帧读它，不现算）');
  T.eq(p.look.skin.base, Appearance.palette('frost').base, '这一局用的就是捏人挑的色板');
  T.eq(p.accessory, 'horns', '配件也带进去了');
  T.ok((p.scrap || 0) >= 45, '开局废料真的给到了（初始天赋生效）', p.scrap);
  T.ok(p.base.maxHp >= Stats.base().maxHp + 6, '开局生命真的加上去了（初始属性生效）',
    p.base.maxHp + ' vs ' + Stats.base().maxHp);
  T.ok(p.weapons.length >= 2, '开局武器多了一把（初始技能生效）', p.weapons.length);

  /* ④ **没捏人的那条路逐位照旧**：`p.look` 是 null → 渲染层退回本色。
     这是行为指纹不变的前提（挑战 / CLI / 无头测试都走那条路）。 */
  Slots.select(1); Profile.load(); Profile.reset();
  const sess2 = Game.newRun('ranger', 12345);
  T.eq(sess2.player.look, null, '没有存档角色时 `look` 是 null（渲染层退回本色 —— 与改造前逐位相同）');
  T.eq(sess2.player.accessory, '', '没有存档角色时不戴配件');
  T.eq(sess2.player.scrap, sess2.player.scrap, '开局废料是职业默认那一个');
  T.ok(sess2.player.scrap < 45, '没有"初始天赋"那一笔（它只在捏过之后才有）', sess2.player.scrap);

  /* 清理：回到 0 号槽 */
  Slots.select(0); Profile.load();
}

/* ---------------- [5] 槽位隔离与落盘 ---------------- */
T.section('5. 槽位隔离 / 落盘往返 / 坏档防线');
{
  Storage.wipe();
  Profile.reset();
  Slots.select(0); Profile.load(); Profile.reset();
  Slots.select(1); Profile.load(); Profile.reset();

  Profile.saveCharacter({ name: '甲', look: { palette: 'moss' } }, 'ranger');
  Slots.select(1); Profile.load();
  Profile.saveCharacter({ name: '乙', look: { palette: 'clay' } }, 'mage');
  T.eq(Profile.character().name, '乙', '1 号槽是"乙"');
  Slots.select(0); Profile.load();
  T.eq(Profile.character().name, '甲', '0 号槽还是"甲"（两档互不影响）');

  /* **落盘往返**：`Profile.load()` 从存储重读之后，那个人必须一模一样 */
  const before = JSON.stringify(Profile.character());
  Slots.select(1); Profile.load(); Slots.select(0); Profile.load();
  T.eq(JSON.stringify(Profile.character()), before, '切档来回一趟，那个人的每一个字段都没变');

  /* **坏档防线**：手写一份带坏槽位键与坏外观的档案，读回来不许崩、不许留下查不到的 id */
  const key = Slots.key(Storage.KEYS.profile);
  Storage.set(key, JSON.stringify({
    v: 1, at: Date.now(), kind: 'profile', data: {
      characters: {
        '0': { charId: 'mage', name: '坏名前' + '\u0000', look: { palette: '不存在', face: '不存在', accessory: '不存在' } },
        '99': { charId: 'ranger', name: '越界槽位' },
        'abc': { charId: 'ranger', name: '不是槽位号' }
      }
    }
  }));
  Profile.load();
  const fixed = Profile.character();
  T.ok(!!fixed, '坏档也读出了一个可用的人（而不是 null 让这个档打不开）',
    JSON.stringify(Profile.snapshot().characters));
  T.eq(fixed.look.palette, Appearance.DEFAULT_PALETTE, '坏色板被夹回缺省档');
  T.eq(fixed.name, '坏名前', '名字里的控制字符被去掉');
  T.ok(Profile.audit().ok, '读完之后档案自检仍然通过', Profile.audit().problems.join(' / '));
  const snap = Profile.snapshot().characters;
  T.eq(snap['99'], undefined, '越界的槽位键被丢掉（那份档里的人永远读不到，留着只会占体积）');
  T.eq(snap['abc'], undefined, '不是槽位号的键被丢掉');

  /* ---- 「返回」撤回：**只拿掉人，不碰进度**（R50 的捏人页退出那条路） ---- */
  Storage.wipe();
  Slots.select(0); Profile.load(); Profile.reset({ keepCharacter: false });
  Profile.addGrowth(321);
  Profile.saveCharacter({ name: '临时人' }, 'ranger');
  T.ok(Profile.hasCharacter(), '这个人建起来了');
  T.eq(Profile.dropCharacter(), true, '撤回成功（返回"真的拿掉了"）');
  T.eq(Profile.character(), null, '内存里没有他了');
  T.eq(Profile.growth(), 321, '**进度一点没动**（撤回只碰 characters 那一格）');
  /* 关键：换一次槽位再回来，他不能复活（只清内存的话会） */
  Slots.select(1); Profile.load();
  Slots.select(0); Profile.load();
  T.eq(Profile.character(), null, '切档来回一趟，他**没有复活**（撤回真的落了盘）');
  T.eq(Profile.growth(), 321, '进度也还在（两件事互不影响）');
  T.eq(Profile.dropCharacter(), false, '本来就没人是 false（幂等）');

  Storage.wipe();
  Slots.select(0);
  Profile.load();
}

process.exit(T.done());
