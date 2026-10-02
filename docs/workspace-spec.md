---
title: "工作区规范（workspace spec）—— 一个项目怎么被引擎认出来、名字归谁、改名要改几处"
category: 决定
status: 现行
scope: "引擎与工作区的关系 · `teapot.workspace.json` 的最小字段集 · 三条硬规范（改名=改一处清单 / 注册表只放派生数据 / 两套机制只许多一套发现）· 「编排」的两个口径 · 命令面 · **逐条可执行判据**"
source: "用户 2026-10-01~02 的要求（「内容命名空间由工作区注入」·「让这类改名问题变得更简单」·「编排都可以加上」）＋ 三路联网调研（见 external-workspace-conventions.md，每条规范在那里有出处与强度）"
id: D-004
consequences: "代价：引擎启动处不得再硬编码内容名（`Storage.setNamespace` 那一批已还清），改名改成「改一处清单」；收益：同一台引擎能认多个工作区"
confirmation: "门 `workspace`（每份清单都要被引擎认下来）· 门 `registration`（表与盘两个方向都对得上）。三条硬规范里「注册表只放派生数据」**无门**，靠评审"
links: ["external-workspace-conventions.md", "teapot-restructure.md", "engine-first.md", "requirements.md"]
---
# 工作区规范

> **这份文件是"要施工的人"看的**：规范短、可执行、每条能指向出处。
> 取证在 [`external-workspace-conventions.md`](external-workspace-conventions.md)（含 URL 与强度）。
> 战略背景在 [`teapot-restructure.md`](teapot-restructure.md)（E4/E5 批次）。

---

## 一、三个词先说死（**模块 ≠ 插件 ≠ 工作区**）

| 词 | 定义 | 谁写 | 住哪 |
| --- | --- | --- | --- |
| **模块**（Module） | 引擎**原生**的功能单元；引擎自己就是一堆模块 | 引擎作者 | `src/modules/<id>/` |
| **插件**（Plugin） | **开发者**写的自定义模块，**走与原生模块同一套加载器** | 引擎使用者 | `plugins/<id>/` |
| **工作区**（Workspace） | 引擎管理的**一个项目**（内容是它的输入与产物） | 引擎使用者 | `workspace/<Name>/` |

> 抄的是 **Bevy「引擎功能全是 Plugin」+ libGDX「同一机制 + 归属标签」**，
> **不抄 Godot 的"两套机制"**（C++ module 要重编引擎 vs addon 不用 —— 代价是两套 API、两套构建、两套文档）。
> 出处见 external-workspace-conventions.md §二.4。
>
> ⚠ **与 `AGENTS.md` 的术语纪律对齐**：那一节说的"**模块** = 用户定义游戏机制与玩法的方式
> （战斗 / 经营 / 养成）"是**内容侧**的那一类；本节的"模块"是**功能单元**这个**上位词**——
> 引擎原生的、插件、内容侧的，**都是模块**。两者不冲突，但**写的时候要带限定词**
> （「引擎模块」/「玩法模块」），否则读者会猜。出处：`AGENTS.md` §八 末尾那条术语纪律。

## 二、四层归属（**谁进版本库**，一层都不能混）

| 层 | 进版本库 | 住哪 | 装什么 |
| --- | --- | --- | --- |
| **引擎仓库层** | ✅ | 仓库根 `src/` `tools/` `docs/` … | 引擎本体 + 它的规范 |
| **工作区层** | ✅（**它自己是一个项目**） | `workspace/<Name>/` 的 `teapot.workspace.json` + 内容源码 | **项目的身份与配置** |
| **机器层** | ❌ | `.env`（值）· `~/.gitconfig`（git 自己那份，如代理）· `%APPDATA%/Teapot/recent.json` | 这台机器的值 |
| **会话层** | ❌ | `tools/.session.json` | 并行会话快照（见 `tools/env.mjs`） |

**判据（与 `AGENTS.md` §三 那条同级）**：任何一句环境/配置断言，都必须能回答"**属于哪一层**"；
答不出来的，后面一定会出现"两个地方两个真相"。

## 三、`teapot.workspace.json`：**最小字段集**

```jsonc
{
  "schema": 1,                    // 清单格式版本（**不是**引擎版本）—— 迁移判据靠它
  "id": "bronana",                // ✅ **稳定 id**：目录名、存档目录、命名空间都由它派生；**改它 = 迁移**
  "displayName": "Bronana",       // ✅ **纯显示名**：界面/窗口标题用；**改它零风险、不动任何路径**
  "engine": ">=0.1 <1",           // 要求的引擎区间（对应 Unreal 的 EngineAssociation，但**可判**）
  "entry": "src/main.ts",         // 从哪进
  "storage": { "namespace": "bronana" },   // E3 第 2 小步注入的那个命名空间，**出处就是这一行**
  "modules":  { "enabled": [], "disabled": [] },   // 原生模块的开/关（每工作区一份）
  "plugins":  { "enabled": [] },                   // 插件（与原生同一套加载器）
  "content":  { "src": "src" }                     // 内容源码根
}
```

### 🔴 两条**必须分开**的字段：`displayName` 与 `id`

**这是本次调研里唯一一条"改名会造成用户数据丢失"的机制**（出处见 external-workspace-conventions.md §三.4）：

> Godot 的 `application/config/name` **同时**决定 user data 目录（`app_userdata/<safe name>`）——
> 于是**改名 = 存档目录搬家，旧档不自动迁移**。成因只是**复用了一个字段**。

⇒ **Teapot 规范（硬）**：
1. **存档路径 / 存储命名空间 / 构建产物名，一律由 `id` 派生**（稳定，几乎不改）；
2. **`displayName` 只出现在给人看的地方**（窗口标题、项目管理器列表、`--help` 里的项目名）；
3. **改 `displayName` 必须零副作用**（不许影响任何路径）—— 这条要有判据。

## 四、三条硬规范

### 规范 1：**改名 = 改一处清单**（用户点名的原则）

- 任何"属于某个工作区的名字"**只许出现在 `teapot.workspace.json` 里**；
  代码、构建脚本、CI 里**不许**出现工作区的名字（引擎侧尤其不许 —— 那是门 `naming` 的判据）。
- 由此派生：**目录名不参与身份**（抄 VS Code 的 `folders[].name`：路径是身份，名字是展示）。
- 反例警告（抄 Unreal）：**不许把名字做成文件名/宏/构建脚本里的字符串** ——
  那边改名要动 ≥7 处，且所有存过路径的地方不会跟着动。
- **`teapot ws rename` 的职责不是"全仓搜索替换"，而是"改清单里那一行 + 校验"**：
  它调用已有的 `tools/rename-inventory.mjs` 去**证明**没有别的出处，而不是靠人记得搜。

### 规范 2：**注册表只放派生数据**，且搬家要一次性迁移函数

- 最近项目列表（`%APPDATA%/Teapot/recent.json`）**只放派生数据与元数据**（路径、最后打开时间、
  `favorite`）—— **绝不放名字与版本这类"项目自己知道的事"**（抄 Godot `projects.cfg`：只存 `favorite`，
  名字每次重读）。
- 判据：**能被项目自己改变的字段，就不能被当成真相。**
- **允许两套发现，不允许多一套真相**（缺省两套都不做）。
- 注册表格式要搬家时，**照抄 Godot `_migrate_config()` 的形状**：幂等（目标存在即返回）→ 逐条搬 →
  删旧键 → 保存。

### 规范 3：**清单不一致必须告警**（不许静默无操作）

- 抄 pnpm 官方自认的最坏失败模式：根清单与工作区清单不一致时，它曾经「**silently link no project
  at all**」；现在**只告警**，且迁移形状是"**无文件才生成 · 已存在永不覆盖 · 不一致告警**"。
- 抄 Cargo 的教训：`[patch]/[profile]` **只在根生效、成员写了被静默忽略** ——
  Teapot 里"**成员写了根不认**"必须**报错**，不许静默（那正是本仓库最忌的一类）。

## 五、「编排」的**两个口径都写**（用户已拍板「都可以加上」）

| 口径 | 是什么 | 落在哪 | 判据 |
| --- | --- | --- | --- |
| **模块 / 任务编排** | 把多个模块/作业**按声明的依赖与顺序**跑起来 | 模块注册顺序由**依赖拓扑排序**决定（不是 import 顺序）；`Jobs.submit/wait` 的作业图 | 环 ⇒ 启动期报错并指出环在哪；"两个模块互相 require"必红 |
| **场景编排** | 像 Unity **Timeline/Sequencer** 那样在**时间轴**上摆内容（关键帧 / 轨道 / 混合） | 引擎的**动画与时间轴**能力（属 E8 的"动画时间轴"一档） | 时间轴数据是**声明**（可序列化）+ 播放是**纯函数**（同输入同输出） |

> ⚠ 这两件事**不是同一个词的两个说法**：前者是"启动顺序"，后者是"时间轴"。写文档时必须分开写，
> 否则下一个人会把"编排 = 装配顺序"当成"编排 = 时间轴"。

## 六、命令面（最小集，每条注「抄自谁」）

| 命令 | 抄自谁 | 为什么 |
| --- | --- | --- |
| `teapot ws list [--json] [--recent]` | Godot 列表 + Unity Hub Recent + pnpm `--filter` | 列表是**用户级**的；`--json` 给机器读 |
| `teapot ws new <id> [--display-name <n>] [--template <t>]` | Godot Create（**名称与目录分开填**）+ Unity `-createProject`/`-cloneFromTemplate` | `id` 与 `displayName` **分开填**，正是规范 §三 那两条 |
| `teapot ws add <path>` / `ws remove <id> [--delete-files]` | Godot Import + Unreal 社区痛点"Remove Without Deleting" | 默认**只从列表移除**，删盘必须显式 |
| `teapot ws open <id> [-e]` / `ws run <id>` | Godot `-e` vs 不带 `-e` 的语义差 | 一次说清"开编辑器"与"直接跑" |
| `teapot ws rename <id> --display-name <n>` | **Godot（一处清单 + 不动文件夹）** | 落实规范 1；改的是 `displayName`，路径不动 |
| `teapot ws upgrade <id> --to <ver> [--dry-run]` | **Godot**：`--validate-conversion-3to4`（干跑）→ `--convert-3to4` | ① 升级必须显式；② **必须有干跑**；③ 警告照抄 Godot 那句"**不会替你备份**" |
| `teapot ws doctor <id>` | Unity 的 Non-Matching Editor 检测面 | 把"清单里的版本 vs 引擎版本不一致"做成一条可跑命令 |
| `teapot module list [--json]` / `module enable\|disable <id>` | Unreal Plugin Browser（分类 + Enabled 列） | 用户要能一眼回答"一共哪些、哪些开着" |
| `teapot module why <id>` | pnpm `why` | 插件系统唯一的调试入口："它为什么被启用" |
| `teapot env --where`（**已实现**为 `pnpm run where`） | —— | 机器层的读数（见 `tools/where.mjs`） |

> **不要发明第二套工作区语义**：Teapot 的宿主栈是 pnpm，`-r` / 拓扑序 / `--filter` 照 pnpm 抄，
> 别造一个新词。

## 七、**可执行判据**（规范不落到门上就一定会漂）

| # | 判据 | 形状 | 现状 |
| --- | --- | --- | --- |
| 1 | **工作区名只出现在清单里** | 引擎侧任何文件（`src/` `tools/` `test/` `desktop/`）不许出现某个工作区的 `id`/`displayName` | 部分已由门 `naming` 覆盖（它只管 `src/` 的 23 个引擎模块）；**其余待建** |
| 2 | **`displayName` 零副作用** | 改清单里的 `displayName` 后，`git status` 在**内容与产物路径**上必须无变化；存档路径/命名空间/产物名都由 `id` 派生 | **待建**（E5 一起） |
| 3 | **清单规范化** | `teapot.workspace.json` 的字段集 = 上表；未知字段**报错**（不许静默忽略 —— 抄 Cargo 的教训） | **待建** |
| 4 | **两套清单不许有两个真相** | 若同时存在"注册表"与"清单"，**只有清单是真相**；注册表只能有派生字段 | **待建** |
| 5 | **成员写了根不认 ⇒ 报错** | 工作区里写引擎级只读键（如构建开关）必须报错 | **待建** |
| 6 | **`id` 唯一且稳定** | 两个工作区不许同 `id`；`id` 改了要有一条迁移（不是静默） | **待建** |

> 家法（`AGENTS.md` §三）：**每加一条判据，必须注入坏数据证明它会红**；不加门的规范只是散文。

## 八、与其它文档的分工 · 未决

- **本文件**：工作区**规范**（怎么定义、名字归谁、命令面、判据）。
- `external-workspace-conventions.md`：**取证**（六家怎么做 + 出处 + 强度 + 未取得）。
- `teapot-restructure.md`：**批次**（E4 内容搬进工作区 · E5 工作区系统 · E6 模块 · E7 插件）。
- `engine-first.md`：**判据的分层原则**（"零 X"要问是引擎还是项目）。

**未决（要用户拍板）**：
1. `schema` 版本要与**引擎版本**分开到什么程度？（本文只定了"分开"，没定兼容策略）
2. 工作区是否允许**嵌套**工作区（子项目）？（本文按"不嵌套"写；Unreal/Godot 都支持嵌套 `Plugins/`，代价是搜索路径翻倍）
3. `recent.json` 要不要**加密/脱敏**路径？（本文按不加密写 —— 它是派生数据，删了可重建）
