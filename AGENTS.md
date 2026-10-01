# AGENTS.md — 给 AI 编码助手的项目须知

> 这份文件写给**在这个仓库里干活的 AI**（以及任何"接手就得先知道规矩"的人）。
> 它只讲**怎么在这里正确地动手**，不重复讲玩法与设计 —— 那些在
> [`README.md`](README.md)（现在是什么样）、[`CONTRIBUTING.md`](CONTRIBUTING.md)（家法全文）、
> [`docs/requirements.md`](docs/requirements.md)（需求账本）里。
>
> 全部文档的索引在 [`docs/README.md`](docs/README.md)。
> **动手之前先读 `CONTRIBUTING.md`** —— 那份是正本，本文是它的"AI 快速上手版"。

---

## 一、这个项目是什么

**Bronana** —— 一个用 **TypeScript + 原生 ES 模块 + HTML5 Canvas** 写的独立肉鸽（roguelite）游戏。
致敬 Brotato 一类的实时动作生存玩法，但**不是**它的复刻：本作有战斗 / 经营 / 养成三条平级的
玩法轴（"模块"），靠"打 → 造 → 再打"闭环串起来。

| 事实 | 值 | 为什么要在意 |
| --- | --- | --- |
| 运行时依赖 | **零**（`dependencies` 为空） | 这是**设计约束**，不是巧合。加之前必须先讨论 |
| 素材文件 | **零**（无 `public/`、无 `assets/`） | 全部画面**程序化绘制**。擅自引入图片会牵动测试链路与调色板 |
| 代码规模 | `src/` 92 个模块 · 约 4.30 万行（另 `types.d.ts` 约 5.1 千行） | 是一个真项目，不是玩具，改动要按工程规矩来 |
| 模块格式 | 真 `import` / `export`（无 IIFE、无 `window.X`） | 依赖图能被静态校验，测试能直接 `import src/*.ts` |
| Node | **24+**（原生类型擦除直接跑 `.ts`，不经打包器） | 不需要"先编译再跑" |
| 包管理 | **pnpm 12.5.1**（`packageManager` 字段是唯一出处） | 不是 npm；`node_modules` 是链接布局 |
| 测试 | **62 套无头测试**（清单唯一出处：`test/suites.mjs`） | 全在 Node 里跑，没有真浏览器 |
| 验收门 | **17 道**（清单唯一出处：`tools/verify.mjs` 的 `GATES`） | "改对了" = 这些门全绿 |

三种运行形态共用同一份 `src/`：**web**（Vite）、**cli**（无头 `sim` / 静态 `serve`）、**desktop**（Electron 外壳）。

---

## 二、最短上手路径

```bash
pnpm i                 # 装依赖（只有 4 个 devDependencies）

pnpm verify --list     # **先跑这个**：列出 17 道门、每道在挡什么
pnpm verify --quick    # 迭代用（约 20 秒）：跳过测试套件，并明说跳了什么
pnpm verify            # 提交前跑这一条（约 60~90 秒）：全部 17 道门
```

> ⚠ **`pnpm verify` 是本项目的准绳。** 说"改好了"之前必须跑它，并附上真实输出。
> 只跑 `--quick` 不算 —— 它跳过的恰好是"行为与数值的唯一真相"（62 套测试）。

只跑某一道门时（门 = 命令 = 退出码，没有别的判据）：

| 门 | 命令 | 挡什么 |
| --- | --- | --- |
| 类型 | `pnpm typecheck` | tsc ×2（浏览器侧 `types: []` + Node 侧），必须 **0 错** |
| 测试 | `pnpm test` | 62 套无头套件的总入口 |
| 指纹 | `pnpm fingerprint` | 纯重构必须**逐位不变**（见第五节） |
| 分层 | `pnpm run audit` | 依赖环 / 死代码 / 未读字段 / 向上依赖未登记 |
| 守卫 | `pnpm run guards` | 每个家族的值域要么有自检、要么被跨表引用守着 |
| 漂移 | `pnpm run drift` | 盘上的工具与测试都登记进了总账 |

其余工具见 `package.json` 的 `scripts` —— **每一个都能单独跑**，不用猜怎么调。

### ⚠ 沙箱里的一条实操陷阱

`tools/verify.mjs` 用 `spawnSync` + **管道**收集各门的输出。在某些受限沙箱里
"程序通过管道捕获另一个程序的输出"会被拒（Windows 上表现为 EPERM），
于是 `pnpm verify` 会**每道门都在 2~7ms 内失败、且没有任何输出**。

**这是环境限制，不是项目坏了。** 判据：单跑一条门（如 `node tools/fingerprint.mjs`）
能正常出结果并 `exit=0`。遇到这种情况就**逐条单跑**各门，而不是去改 `verify.mjs`。

---

## 三、家法：新概念必须"四步齐全"

这是这个仓库**最核心的约定**。任何一个新概念（一种货币、一种设施、一种粒子、一条难度修正…）
都要有下面四样，**缺任何一样都会被审计工具点名**：

| # | 件 | 长什么样 | 缺了会怎样 |
| --- | --- | --- | --- |
| 1 | **声明表** | `var LIST: XxxDef[] = [ … ]` | 数据散在 `if/else` 里，没人能回答"一共有哪些" |
| 2 | **`BY_ID`** | `var BY_ID = {}` + 循环填 | 每处查找各写一遍，键名写错就静默取到 `undefined` |
| 3 | **启动期自检** | `Xxx.audit()` + `SelfCheck.register('Xxx', Xxx.audit)` | 表写错了程序照样能起，只是某条效果悄悄不生效 |
| 4 | **注册进总账** | `Registry.family('xxx', { note, owner, entries\|values })` | 跨表引用的值写错**没人查** |

约束细节：

- `SelfCheck.register` 的函数必须**无参、返回 `{ ok, problems }`**；
- **启动期不得读别的模块的家族**（那个模块可能还没加载）—— 先用 `Registry.has(name)` 问在不在；
- 参考样板：`src/economy.ts`（最完整的一份）、`src/danger.ts`（最小的一份）。

### 自检必须**证明它会失败**

写完 `audit()` 之后，**注入一个坏数据确认它真的报错**，再删掉临时脚本
（临时脚本放 `tools/tmp-*.mjs`，验完立刻删）。

> **一条不会失败的审计等于装饰。** 这个项目有多次"加了个看似合理的检查、
> 实际它永远不会红"的记录，都写在 `README.md` 里。

---

## 四、改动前必须知道的四条硬约束

### 1. 分层：边只能从高层指向低层

`tools/systems.cjs` 是**唯一出处**（9 个系统 / 层号 / 例外清单）。**向上依赖必须逐条登记**
在 `EXCEPTIONS` 里并写明理由 —— 现在**只有 2 条**，这个清单**不该再变长**。

| 层 | 系统 | 典型模块 |
| --- | --- | --- |
| 8 | boot 入口 | `main.ts` / `cli.ts` / `demo.ts` / `storage_fs.ts` |
| 7 | view 表现与界面 | `render.ts` / `ui.ts` / `input.ts` / `diag.ts` / `crash.ts` |
| 6 | art 造型与声音 | `sprites.ts` / `bronana.ts` / `audio.ts` / `music.ts` / `art_*.ts` |
| 5 | run 一局的进出 | `save.ts` / `score.ts` |
| 4 | sim 模拟内核 | `game.ts` / `market.ts` / `emit.ts` / `scene.ts` / `record.ts` / `grid.ts` / `chamber.ts` / `impact.ts` / `skills.ts` |
| 3 | meta 局外成长 | `camp.ts` / `stronghold.ts` / `talents.ts` / `profile.ts` / `danger.ts` / `trade.ts` / `settings.ts` … |
| 2 | dungeon 地牢与内容 | `dungeon.ts` / `arena.ts` / `story.ts` / `hall.ts` / `art_tiles.ts` |
| 1 | data 数据表 | `data_*.ts` / `curves.ts` / `economy.ts` + 四本账本 `eco_*.ts` / `link.ts` |
| 0 | mech 工具与机制 | `utils.ts` / `registry.ts` / `selfcheck.ts` / `fold.ts` / `containers.ts` / `comp.ts` / `collide.ts` / `draw2d.ts` / `depth.ts` / `ai.ts` / `rig.ts` / `world.ts` / `object.ts` |

**决定一个模块坐哪里的不是它的性质，是它的依赖。** 这一点在 `trade.ts` / `run_save.ts` /
`stats.ts` 上都栽过 —— 它们"看起来像数据表"，但依赖在 L3，放 L0 会当场多出向上的边。

### 2. `sim` 层及以下**不许碰 DOM，也不许碰 Node**

这不是风格问题，是**"62 套测试能在 Node 里跑"的前提**，而且被两道机器守着：

- `tsconfig.json` 刻意 `types: []` → `src/` 里误用 `process` / `fs` / `Buffer` 直接**编译报错**；
- `test/ui-check.mjs` 解析整张 import 图并断言：无环、模拟层不得依赖渲染/界面/输入/音频、
  造型库不得依赖玩法、渲染层不得依赖界面层、绘制原语层只能依赖 `utils`、`main.ts` 不被任何模块导入。

确实需要浏览器 API 时，走 `typeof document === 'undefined'` 的**显式降级分支**
（`sprites.ts` 里有 7 处，每处都有对应的兜底绘制路径）。**不要**给测试桩加 `Image` 或
`AudioContext` —— 无头环境没有它们是**刻意的**。

### 3. 美术宪法（写在代码里的硬约束）

1. 唯一外轮廓色 `#100d0c`（3px 基线），没有第二种描边色；
2. `draw2d.ts` **不提供**渐变 / 阴影 / 模糊 / 贴图 API（有意为之），体积感靠硬边色块；
3. 全部颜色集中在 `utils.ts` 的 `PAL`，**禁止散落硬编码颜色**；
4. 地面用有序抖动（dither）做色带过渡，不是渐变；
5. 零 3D / 零写实 / 零景深。

`test/render-check.mjs` 会在运行时**拦截渐变与阴影 API 调用**，破坏宪法当场变红。

> **不要自行引入图片素材**（见 `CONTRIBUTING.md` 末节）。没有 `public/` / `assets/`、
> 没有加载 / 预载 / 失败降级那一层，而且 `PAL.setMode` 的色盲换档现在靠"改 4 个颜色键 +
> 清贴图缓存"生效 —— **图片不参与调色**。先讨论，再动手。

### 4. 会改行为的东西**必须显式选择**

默认档永远保持可复现（行为指纹逐位不变）。新特性做成**设置项或新入口**。
例：命中定帧（`hitStop` 默认 0）、技能构筑（空构筑 = 0 槽位）、手动战斗模式
（不改时序、不加"手感补偿"）都是这么落地的。

---

## 五、行为指纹：重构的安全绳

```bash
pnpm fingerprint
```

它把三个固定种子跑到固定帧数，对模拟层状态取哈希。当前基线：

```
ranger    seed 20240922 wave 5  1800 帧  →  622d6ebf
gladiator seed 777      wave 9  1800 帧  →  a9c2902b
engineer  seed 4242     wave 13 1200 帧  →  354cc83c
```

> 上面这三个值是**实测值**（本仓库当前状态）。唯一出处是 `tools/fingerprint.mjs`
> 的输出与 `test/smoke.mjs` 的 `CASES` —— 以那两处为准，不要相信任何文档里抄来的副本
> （包括本文件，如果它漂了就以命令输出为准）。

| 你做的事 | 指纹应该 | 变了怎么办 |
| --- | --- | --- |
| **纯重构** | **逐位不变** | 变了 = 你动了不该动的东西，去查，不要改基线 |
| **有意改行为** | 会变，正常 | 必须**同时**：① 更新 `test/smoke.mjs` 的 `CASES` 基线；② 在 [`CHANGELOG.md`](CHANGELOG.md) 写清改了什么、为什么 |

这条纪律有实证价值：`scrap` 改名那一轮指纹漂移，由此查出**5 个工具在无声地读
已经不存在的字段**。

---

## 六、写测试

- 测试是**无头**的（Node 里跑，没有真浏览器），共享加载器是 `test/_load.mjs`：

  ```js
  import { loadAll, SIM_MODULES } from './_load.mjs';
  await loadAll(SIM_MODULES);            // 模拟层（不含 render/ui）
  const { Game, Profile } = globalThis;  // 各模块导出挂到 globalThis
  ```

- 三个加载集合，按"你需要的层"选：`SIM_MODULES`（玩法/数值/存档）、
  `RENDER_MODULES`（+`render`）、`UI_MODULES`（+`ui`）。
- 需要 DOM 桩时用 `test/_ctx.mjs` 的 `installDom()` —— 它提供**带真实变换矩阵的**
  Canvas2D 桩（专抓"先建路径后 translate"这类只有浏览器才暴露的问题）。
  **不要扩展它**（文件头写了原因）。
- 加一套测试要改的地方**只有一处**：`test/suites.mjs` 的 `SUITES` 数组。
  `tools/registry-drift.mjs` 会检查"盘上每个 `test/*.mjs` 都在清单里"，漏登会被抓。
- 测试输出太大时用 `pnpm run suites`（写文件）—— 受限沙箱里 node 的 stdout 不能走管道。

---

## 七、加门 / 加登记：三处必须同步

1. **加门的唯一去处是 `tools/verify.mjs` 的 `GATES` 表。** 加完**顺手往
   `.github/workflows/ci.yml` 加一个 step**（每个门一个 step，失败时一眼看出是哪道）。
2. `verify.mjs` 会自己对账：每个门的脚本名必须出现在 `ci.yml` 里，漏一条**当场变红**。
   —— 这条来自一次真实事故：加 `solid` 时忘了抄进 CI，于是 **CI 比 `pnpm verify` 少跑一道门，
   两边都显示绿色**。
3. **不要在文档或 CI 里写死统计数字**（"49 套测试""13 道门"）。它们漂过不止一次，
   而且**漂了的统计比没有统计更糟** —— 它看起来是量过的。数量一律从清单算出来
   （`test/suites.mjs` / `tools/verify.mjs` 的 `GATES`）。

---

## 八、文档：写在哪一份里

| 文件 | 写什么 | 什么时候更新 |
| --- | --- | --- |
| [`README.md`](README.md) | **门面**。玩法 / 操作 / 引擎与架构参考 / 性能 / 已知取舍 —— **只讲"现在是什么样、为什么是这样"** | 系统变动时 |
| [`CHANGELOG.md`](CHANGELOG.md) | 玩家可感知的变化（短，面向玩家） | 每次改行为 / 发版 |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | **家法正本**：声明 · 注册 · 自检 · 测试 · 行为指纹 · 分层纪律 | 规则变时 |
| [`docs/requirements.md`](docs/requirements.md) | **需求账本**：每条需求 + 现状 + 证据，讨论在这里留痕 | 每次讨论 |
| [`docs/history/`](docs/history/README.md) | **交付记录**：逐轮改了什么、踩了什么坑、量出了什么 | **每轮追加到这里** |
| [`docs/scaling-benchmarks.md`](docs/scaling-benchmarks.md) | 七款同类游戏的曲线对照 | 调数值前必读 |
| [`docs/external-game-mechanics.md`](docs/external-game-mechanics.md) | **20 款外部游戏的机制档案**（核心循环 / 操作 / 分段 / 成长 / 失败代价 / 张力 / 取舍 / 独有机制 / 褒贬）+ 按三条轴的横向综合 + 来源强度分级 | **做设计决策前必读**（要数字看上面两份，要机制看这一份） |
| [`docs/external-benchmarks.md`](docs/external-benchmarks.md) | 同类游戏的公开设计数字（带来源强度标注） | 做设计决策前 |

**三条硬约定：**

1. **不要再往 `README.md` 里追加交付记录。** 它曾经漂到 6305 行、其中 76.6% 是逐轮记录，
   瘦回 1800 行的原因就在 `docs/history/`。新的一轮追加到 `docs/history/`。
2. 本文与 `README.md` 里的数字若与命令输出不一致，**以命令输出为准**，并顺手修正文档。
3. `pnpm run readme:check` 会校验 README 的存量表与实测一致 —— 这张表**真的漂过**。

### 需求怎么走（五步，缺一步不算完）

`1 提出（用户）→ 2 复述（AGENT：指认它属于哪个模块、跟已有的谁是同一类）→
3 讨论 → 4 动手（代码 + 测试 + 四步齐全）→ 5 验证（17 道门全绿 + 行为指纹）`，
状态与证据都记在 `docs/requirements.md`。

> 术语纪律：**模块 ≠ 系统**。**模块**是用户定义游戏机制与玩法的方式（战斗 / 经营 / 养成）；
> **系统**是全局都生效的能力层（技能 / 角色 / 天赋 / 装备 / 武器 / 道具 / 能力 / 属性 / 时装 / 状态）。
> 两者不能互相代替。该文件不使用第一/第二人称代词 —— 一律写「用户」与「AGENT」。

---

## 九、提交信息

用**中文**，格式 `类型: 一句话说清"改了什么、为什么"`：

```
feat: 营地搬出战斗场景 —— 建材并入材料，闭合"打 → 造 → 再打"
fix: 补上"清间给材料" —— 模拟玩一遍才发现循环是断的
```

- 好的提交信息回答**"为什么"**，而不只是"改了什么"。
- 如果一个改动推翻了之前的结论，**把"原来的结论错在哪"写进去** ——
  这个仓库最值钱的提交信息都是这一类。
- `git log` 本身被当成文档在维护，别写 `wip` / `fix bug`。

---

## 十、十条最容易踩的坑（都是这个项目真实踩过的）

1. **写死统计数字**（套件数 / 门数 / 模块数）→ 一定会漂，且漂了没人知道。从清单算。
2. **加门忘了抄进 `ci.yml`** → CI 比本地少跑一道门，两边都绿。
3. **写完 `audit()` 却从不验证它会失败** → 装饰品。必须注入坏数据证明它红。
4. **纯重构改了行为指纹却去改基线** → 掩盖真 bug。先查为什么变。
5. **把"看起来像数据表"的模块放 L0** → 多出向上的边，架构门当场红。看它的**依赖**定层。
6. **`sim` 层引入 DOM / Node API** → 测试与 `cli` 直接失去无头能力。写降级分支。
7. **手写硬编码颜色 / 同一个概念写两遍** → `hardcode` 与 `PAL` 两道门会抓；
   跨文件同一语义算式也在 `hardcode-audit` 的范围内。
8. **改界面文案漏改 i18n 表** → 表中孤儿比缺键更坏（让人以为那句翻译过了）。
9. **擅自引入图片素材或运行时依赖** → 动的是架构约束，先开讨论。
10. **在受限沙箱里因为 `pnpm verify` 全红就以为项目坏了** → 先单跑一条门验证；
    这是"管道捕获子进程输出被拒"的环境限制（第二节末尾）。

---

## 十一、给 AI 的务实提醒

本项目**大量使用 AI 辅助，这不被禁止、也不需要隐瞒**（见
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)）。但有两条要求写在那里，值得抄在这里：

1. **你必须验证你提交的东西。** AI 会写出"看起来合理但事实错误"的注释与文档 ——
   本项目的 `README.md` 专门记过多次"工具报 ✔ 但实际是假阳"的案例，其中一些就是这类产物。
   **没有跑过验收门就说"完成了"是这里最严重的错误。**
2. **先读文档，再提问 / 再动手。** 不要生成"建议添加 X"而没读过 X 是否已经登记
   （`tools/game-kit.mjs`、`Registry` 家族表、`docs/requirements.md` 的"刻意不做"一节）。

具体到干活时的取舍：

- **改动尽量小、可解释。** 这个仓库的每一处设计几乎都有写在注释里的理由 ——
  大范围重写会撞上大量你不知道的约束。
- **优先级：跑通验收门 > 解释清楚 > 改得漂亮。**
- 不确定某件事该不该做时，**先查 `docs/requirements.md` 的"刻意不做"一节** ——
  它可能就是被有意否掉的，并且写明了理由。
- 报告结论时**附上真实命令输出**（尤其是指纹与门的通过情况），不要只给结论。
