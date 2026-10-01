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
    modules: ['utils.ts', 'registry.ts', 'selfcheck.ts',
      /* `viewport.ts`（**窗口 / 视口 / 相机**，R56）坐在 L0 的理由：
         它只 import `registry.ts` / `selfcheck.ts`（都是 L0），
         而且它是**纯几何**：窗口多大 → 取景多大 → 两条互逆的变换。
         它不认识 Game、不认识渲染层、不认识界面 —— 渲染层反过来 import 它。
         ⚠ 三件事（Window / Viewport / Camera）改造前压缩在 `render.ts` 的
           `R.cam` 里，而相机**属于 Viewport**（行业通行模型
           `Window ⊃ Viewport ⊃ Layer ⊃ Item`）—— 所以它坐这里而不是 L7。 */
      'viewport.ts',
      /* `fold.ts`（数值折叠：一张表四种折法）坐在 L0 的理由：它只 import
         `registry.ts` / `selfcheck.ts`（都是 L0），不认识任何一个玩法概念 ——
         而 data（1）/ dungeon（2）/ meta（3）/ sim（4）四层都要用它的折法。
         ⚠ 与 `run_save.ts` 那次不同：那个第一版放 L0 会多出 `mech→data` 的向上边，
         因为**它的依赖**在 L1。决定一个模块坐哪的不是它的性质，是它的依赖。 */
      'fold.ts',
      'containers.ts', 'envelope.ts',
      'comp.ts', 'collide.ts', 'rig.ts', 'draw2d.ts', 'depth.ts', 'ai.ts',
      /* =========================================================
         **引擎的两条地基系统**（R51，2026-10-01）：
           `world.ts`  世界系统 —— 坐标契约 / 区域表（战场·大厅·枢纽）/ 网格表，
                       只 import `registry` / `selfcheck`
           `object.ts` 对象系统 —— 身份（`$id`）· 原型普查 · 容器对账，
                       只 import `comp` / `containers` / `registry` / `selfcheck`
         两者都坐在 L0 的理由与 `fold.ts` 同一条：**决定一个模块坐哪的不是
         它的性质，是它的依赖** —— 它们一个玩法概念都不认识（不认识会话、
         不认识渲染、不认识对局），而 data(1) / dungeon(2) / sim(4) /
         view(7) 四层都要读它们。
         ⚠ `world.ts` 是"尺寸的唯一出处"：`arena.ts` / `hall.ts` /
         `game.ts` / `render.ts` / `art_spec.ts` 的尺寸与格边长都从它读，
         这一条由 `test/world.mjs` [3] 的静态检查守着（谁也别再抄一遍）。
         ========================================================= */
      'world.ts', 'object.ts',
      /* =========================================================
         **R50：外观（时装）· 入门三选 · 存档角色**
           `appearance.ts` 外观系统（色板 / 脸型 / 配件三张表 + 纯取色），
                          只 import `registry` / `selfcheck`
           `openings.ts`   入门三选（捏人最后一步：初始技能 / 属性 / 天赋），
                          多读一个 `stats`（校验属性键真的存在）
           `character.ts`  存档角色的形状（归一 / 存在性 / 渲染要的那三样），
                          只 import `appearance` / `registry` / `selfcheck`
         三者的共同点与 `world.ts` / `object.ts` 完全一样：**一张声明表 + 几条纯函数**，
         一个玩法数值都不认识（不认识会话、不认识模拟、不认识界面）。
         它们被 `profile`（meta）与 `sprites` / `render` / `ui`（art、view）四处读，
         所以坐在最底下 —— 决定一个模块坐哪的不是它的性质，是它的依赖。
         ========================================================= */
      'appearance.ts', 'openings.ts', 'character.ts',
      /* `dialogue.ts`（对话引擎，R41）：打字机 / 自动 / 对话历史 / 战斗短句 ——
         全是**时间的纯函数**，只 import `registry` / `selfcheck`，
         不认识 DOM（`t` 由调用方喂）、不认识会话。所以它与上面三个同层。 */
      'dialogue.ts',
      /* `status.ts`（状态系统，R50 第 10 条）：一张声明表（状态 × 时长 × 叠法）
         + 一组收口（挂上 / 计时 / 读数）。只 import `registry` / `selfcheck`，
         不认识会话、不认识渲染、**也不认识谁在挨打**（宿主对象由调用方传进来）——
         所以它与 `dialogue.ts` 同层。 */
      'status.ts',
      /* =========================================================
         **`curves.ts` 与 `stats.ts` 降到 L0**（R50 顺手做的一次纠正）
         ---------------------------------------------------------
         两者的依赖面只有 `registry` / `selfcheck` / `utils`（都是 L0）——
         `curves` 是数值曲线表，`stats` 是属性字典 + 几条纯公式，
         **一个玩法概念都不认识**（不认识会话、不认识对局、不认识界面）。

         为什么以前它们在 L1：L1 那一组是"数据表"，它们**看起来**像数据表。
         而这正是那份分层模型自己写在注释里的那条纪律的**反例**：
         "决定一个模块坐哪的**不是它的性质，是它的依赖**"
         （`run_save.ts` 那次就是这么写的）。

         这一轮把它们搬下来，是因为 `openings.ts`（入门三选）要读 `Stats.KEYS`
         校验属性键真的存在 —— 它在 L0，而 `stats` 在 L1，于是架构门当场报出
         **一条未登记的向上边 `mech→data`**。摆在面前的两条路：
           · 去 `EXCEPTIONS` 里登记一条理由（那份清单的注释写着"它越短越好"）
           · 或者承认这两个模块本来就该在底下
         选后者：登记一条只在两个纯函数表之间存在的"向上依赖"，
         等于为了让文件待在旧的抽屉里而给架构加一条假边。
         `test/arch.mjs` 的 [2] 节仍然从系统级盯着 `mech` 不认识玩法概念。
         ========================================================= */
      'curves.ts', 'stats.ts']
  },
  {
    id: 'data', name: '数据表', level: 1,
    note: '纯数据 + 总账登记 + 自检；被模拟 / 界面 / 元进度三处读，自己不认识玩法',
    modules: ['data_tiers.ts', 'data_elems.ts',
      /* =========================================================
         **账本拆成四本**（设计上下文 v3 §5.4-错误1 点名禁止的正是
         旧版"统一 `economy.ts` 定义五六种货币互相兑换"）。
         这一组全在 L1（数据层）：它们是"声明表 + 几条纯规则"，
         只 import `registry` / `selfcheck`（L0），不认识模拟内核也不认识界面。

           `ledger.ts`      账本机制（**连一笔代币 id 都不含**）
           `eco_combat.ts`  战斗账本（`scrap`）
           `eco_manage.ts`  经营账本（`capacity`）—— 建造 + 经营两子模块共用
           `eco_grow.ts`    养成账本（`growth`）—— 角色成长 + NPC羁绊 + 能力解锁共用
           `eco_global.ts`  全局货币（`material`）—— 行动成本，单独一本
           `link.ts`        核心素材（三个）—— **在账本之外**，它是钥匙不是钱

         `economy.ts` **降级成只读聚合**：它靠副作用 import 把四本账接上电，
         自己一笔代币都不定义（判据 H 守这条）。所以它排在这一组的最后。
         ========================================================= */
      'ledger.ts', 'eco_combat.ts', 'eco_manage.ts', 'eco_grow.ts', 'eco_global.ts',
      'link.ts', 'economy.ts',
      /* `terms.ts`（**用词总账**，R53-B）：权威名的声明与出处。
         ⚠ 它坐 **L1** 而不是 L0，而且**刻意不 import 上面那五本账** ——
           同一个组里谁先加载不确定，读它们会拿到空表并把好数据误报成"拼错了"
           （`trade.ts` 的加载期自检栽过这一次）。所以它只 import
           `registry` / `selfcheck`，而"出处真的有那个名字"由
           `tools/name-audit.mjs` 在**全部模块加载之后**核。 */
      'terms.ts',
      /* `station.ts`（大厅：三道通往模块的门 + 开门规则）与 `economy.ts` 同层：
         它是"一张站点表 + 几条纯规则"，只 import `registry` / `selfcheck` / `economy`
         （都是 L0/L1），不认识模拟内核，也不认识界面。
         它跟 `scene.ts`（界面层的场景表）**不是一回事** —— 那是"屏幕怎么切"，
         这是"这一局能去哪里"。 */
      'station.ts',
      'art_spec.ts', 'affixes.ts', 'data_weapons.ts', 'data_items.ts', 'data_chars.ts',
      'enemies.ts',
      /* 升级池：一张声明表（哪些属性在池里、谁是防御向）+ 两条随等级走的纯计算。
         它和 `data_weapons.ts` 是同一类东西 —— 数据，不是逻辑；掷骰子仍在 game.ts。 */
      'levelup.ts',
      /* `run_save.ts`（一局存档的编解码）挂在**数据层**，与 `affixes.ts` 同层的理由：
         它是"数据 ↔ 数据"的变换，不推进任何状态、不认识模拟内核。
         ⚠ 我第一版把它放到了 **L0**（想着"它不推进状态，所以最底"），
         而它 import 了 `affixes.ts` / `data_weapons.ts`（都是 L1）——
         于是架构门当场报出**两条新的向上边 `mech→data`**。
         这条校验在这件事上是对的：决定一个模块坐哪的**不是它的性质，是它的依赖**。
         放 L1 之后 `game.ts`（L4）→ 它（L1）仍然是一条向下的边。 */
      'run_save.ts']
  },
  {
    id: 'dungeon', name: '地牢与内容', level: 2,
    note: '地图与叙事是**纯函数**（同种子必得同图），所以能脱离对局单测',
    /* `hall.ts`（大厅/枢纽两间能走的房）与 `arena.ts` 同类：手写地图数据 +
       纯几何/纯函数，只 import registry / selfcheck / station / story / utils，
       不认识对局内核也不认识界面 —— 所以它坐在地牢层，不是界面层。 */
    modules: ['dungeon.ts', 'art_tiles.ts', 'arena.ts', 'story.ts', 'hall.ts']
  },
  {
    id: 'meta', name: '局外成长（元进度）', level: 3,
    note: '营地 / 据点 / 工坊 / 天赋 / 契约 / 图纸 / 难度 / 档案 / 每日。' +
      '它们的修正**在开局时折成普通对象**（campFx / fmods / dmods / kmods…），' +
      '模拟层跑起来之后不再回表 —— 这是"经营与战斗不互相穿透"的实现方式',
    modules: ['camp.ts', 'stronghold.ts', 'forge.ts', 'craft.ts', 'talents.ts', 'training.ts',
        'bonds.ts', 'exchange.ts', 'guide.ts', 'boons.ts',
      'synergy.ts', 'challenges.ts', 'profile.ts', 'daily.ts', 'season.ts', 'danger.ts',
      'offline.ts', 'settings.ts', 'storage.ts',
      /* `trade.ts`（NPC 交易，R41）：一张报价表 + 几条纯判定。
         ⚠ 它**没坐在 L0**，虽然它"看起来像一张数据表"：它 import `bonds.ts`
           （关系阶段门槛）与 `ledger.ts`（收的钱是不是一笔真代币）——
           两者都在这里。决定一个模块坐哪的**不是它的性质，是它的依赖**
           （`run_save.ts` 与 `stats.ts` 那两次都是这条）。
           放 L0 会多出 `mech→meta` 与 `mech→data` 两条向上边，
           架构门当场抓住（实测：它报的就是这一条）。 */
      'trade.ts',
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
    modules: ['main.ts', 'cli.ts', 'demo.ts',
      /* **文件存储后端**（Node 专用）。放 L8 而不是 `storage.ts` 那一层，
         理由很硬：它 import `node:fs`，而 `storage.ts` 是**浏览器也 import** 的；
         一旦进了那条链，`vite build` 就会失败。只有 `cli.ts` import 它。 */
      'storage_fs.ts']
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
