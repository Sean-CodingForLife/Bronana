/* =========================================================
   systems.cjs — **系统分层模型**（唯一出处）
   ---------------------------------------------------------
   为什么要有这个文件：项目已经有二十多条"某个模块只能依赖 X"的单点规则
   （test/ui-check.mjs 的 FORBID 表），但那些规则是**逐模块**的 ——
   它们能拦住"draw2d 不许认识 game"，却回答不了"这个项目一共有几个系统、
   谁在谁上面、哪条边是横着穿过去的"。

   这里把**事实**写下来（52 个模块 → 8 个系统 + 层号），并声明：
     · 允许的依赖方向：**只能从高层指向低层**（层号大的可以依赖层号小的）
     · 不允许的边必须逐条登记（`EXCEPTIONS`），每条都要写清"为什么它必须存在"
   于是"新加一条向上的边"这件事从"没人会注意到"变成"自检会红"。

   它同时被两边读（**单一出处**）：
     · `tools/arch-audit.cjs` —— 打印跨系统依赖矩阵
     · `test/arch.mjs` —— 断言方向与例外清单
   两边读同一份表，就不会出现"工具说没事、测试说有事"。

   分组依据是**职责**，不是文件大小：一个系统 = 一批共同拥有某种状态的模块。
   层号由依赖方向反推（低层不认识高层），不是先定架构再去凑。
   ========================================================= */

/** 层号越小越"底层"。允许的边：高层 → 低层（数值大 → 数值小） */
const SYSTEMS = [
  {
    id: 'mech', name: '工具与机制', level: 0,
    note: '纯机制：不认识任何玩法概念，被所有人依赖。它们之间也是单向的（总账/自检登记处最底）',
    modules: ['utils.ts', 'registry.ts', 'selfcheck.ts', 'containers.ts', 'envelope.ts',
      'comp.ts', 'collide.ts', 'rig.ts', 'draw2d.ts', 'depth.ts', 'ai.ts']
  },
  {
    id: 'data', name: '数据表', level: 1,
    note: '纯数据 + 总账登记 + 自检；被模拟 / 界面 / 元进度三处读，自己不认识玩法',
    modules: ['data_tiers.ts', 'data_elems.ts', 'curves.ts', 'economy.ts', 'art_spec.ts', 'affixes.ts', 'data_weapons.ts', 'data_items.ts', 'data_chars.ts',
      'enemies.ts', 'stats.ts',
      /* 升级池：一张声明表（哪些属性在池里、谁是防御向）+ 两条随等级走的纯计算。
         它和 `data_weapons.ts` 是同一类东西 —— 数据，不是逻辑；掷骰子仍在 game.ts。 */
      'levelup.ts',
      /* `run_save.ts`（一局存档的编解码）挂在**数据层**，与 `affixes.ts` 同层的理由：
         它是"数据 ↔ 数据"的变换，不推进任何状态、不认识模拟内核。
         ⚠ 我第一版把它放到了 **L0**（想着"它不推进状态，所以最底"），
         而它 import 了 `affixes.ts` / `data_weapons.ts`（都是 L1）——
         于是架构门当场报出**两条新的向上边 `mech→data`**。
         这条尺子在这件事上是对的：决定一个模块坐哪的**不是它的性质，是它的依赖**。
         放 L1 之后 `game.ts`（L4）→ 它（L1）仍然是一条向下的边。 */
      'run_save.ts']
  },
  {
    id: 'dungeon', name: '地牢与内容', level: 2,
    note: '地图与叙事是**纯函数**（同种子必得同图），所以能脱离对局单测',
    modules: ['dungeon.ts', 'art_tiles.ts', 'arena.ts', 'story.ts']
  },
  {
    id: 'meta', name: '局外成长（元进度）', level: 3,
    note: '营地 / 据点 / 工坊 / 天赋 / 契约 / 图纸 / 难度 / 档案 / 每日。' +
      '它们的修正**在开局时折成普通对象**（campFx / fmods / dmods / kmods…），' +
      '模拟层跑起来之后不再回表 —— 这是"经营与战斗不互相穿透"的实现方式',
    modules: ['camp.ts', 'stronghold.ts', 'forge.ts', 'craft.ts', 'talents.ts', 'boons.ts',
      'synergy.ts', 'challenges.ts', 'profile.ts', 'daily.ts', 'season.ts', 'danger.ts',
      'offline.ts', 'settings.ts', 'storage.ts',
      /* `slots.ts` 与 `storage.ts` 同层：它只认识"键名与一段文本"，
         不认识账号档案里有什么字段 —— 所以 profile / save 都能用它做键重定向，
         而它不会因为档案改字段而失效。 */
      'slots.ts',
      /* `i18n.ts` 是**文案表**：与其它数据表同性质（注册表 + 自检 + 一张表），
         但它比 `data` 层（1）更"上层"一点 —— 因为它的表键是**界面原文**，
         改界面文案就会影响它。放在 meta 层是取"它被界面读、它不认识玩法"这个事实。 */
      'i18n.ts',
      /* 首局引导：**一张声明表 + 一个时机判据**，与 i18n 同性质（表 + 建议 + 自检）。
         它被界面读（什么时候说），自己不认识玩法。 */
      'tutorial.ts']
  },
  {
    id: 'sim', name: '模拟内核', level: 4,
    note: '每帧都在跑的那一层：纯逻辑、无 DOM、无 canvas。它**只读折好的派生值**，' +
      '不重算元进度；`game.ts` 自己不再写全部 78 个会话字段 —— ' +
      '位置（floor/map/roomId）归 chamber.ts，世界状态的其余部分仍在 game.ts 与 market.ts',
    modules: ['game.ts', 'market.ts', 'emit.ts', 'scene.ts', 'record.ts', 'grid.ts', 'chamber.ts', 'impact.ts', 'skills.ts']
  },
  {
    id: 'run', name: '一局的进出', level: 5,
    note: '序列化与结算：一局怎么存、怎么算分。它们**必须**读模拟层（这是它们的职责），' +
      '所以它们坐在模拟层之上，而不是混在元进度里',
    modules: ['save.ts', 'score.ts']
  },
  {
    id: 'art', name: '造型与声音', level: 6,
    note: '角色骨架、贴图缓存、程序化音效。三者都不认识玩法状态',
    modules: ['bronana.ts', 'art_parallax.ts', 'art_shaders.ts', 'sprites.ts', 'audio.ts', 'music.ts']
  },
  {
    id: 'view', name: '表现与界面', level: 7,
    note: '渲染 / 界面 / 输入 / 诊断。**只读**模拟层：它们可以写自己那份展示状态' +
      '（如 shake），但不得改一局的状态',
    modules: ['render.ts', 'ui.ts', 'input.ts', 'diag.ts', 'crash.ts']
  },
  {
    id: 'boot', name: '入口', level: 8,
    note: 'web 入口 / 命令行入口 / 调试舞台。唯有它们可以"什么都知道"',
    modules: ['main.ts', 'cli.ts', 'demo.ts']
  }
];

/**
 * 已存在的、**方向向上**的依赖边（低层认识高层）。
 * 每一条都必须给出理由 —— 这个清单的作用不是"允许向上"，而是：
 *   · 向上依赖必须是**被解释过的**
 *   · 新加一条向上依赖时，自检会红，逼人回来看这一节
 * 所以它越短越好，而且不该再变长。
 */
const EXCEPTIONS = [
  {
    from: 'data', to: 'meta', edge: 'enemies.ts → danger.ts',
    why: '怪物表要一份"恒等修正"作为缺省（`Danger.BASE`）。修正键的**恒等值只有一处出处**，' +
      '复制一份到怪物表正是要避免的事（`Dungeon.audit` 会拿两边的键名互相对照）'
  },
  {
    from: 'sim', to: 'art', edge: 'game.ts → bronana.ts',
    why: '子弹的出生点是**角色骨架上的枪口位置**（`Bronana.seat / aheadPoint / MUZZLE_AHEAD`），' +
      '这是玩法几何而不是装饰。代价是模拟层传递地依赖 draw2d —— ' +
      '功能上无害（渲染层本来就要加载它），概念上不干净；' +
      '彻底的解法是把"枪口几何"从 bronana.ts 里拆出来，见 README 的"没做的"'
  }
];

/** 系统 id → 定义 */
const BY_ID = {};
for (const s of SYSTEMS) BY_ID[s.id] = s;

/** 模块文件名 → 系统 id */
const SYS_OF = {};
for (const s of SYSTEMS) for (const m of s.modules) SYS_OF[m] = s.id;

module.exports = { SYSTEMS, EXCEPTIONS, BY_ID, SYS_OF };
