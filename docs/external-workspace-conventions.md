---
title: "外部参考 · 工作区与项目清单 —— 主流引擎/构建系统怎么定义「一个项目」并管理它"
category: 调研
status: 现行
scope: "Unity / Godot / Unreal / Bevy+Cargo / npm+pnpm / VS Code 六家的：清单文件 · 名字归属 · 发现与枚举 · 共享与隔离 · 改名与迁移；每条附出处与**强度**；末尾是「Teapot 能抄什么 / 不能抄什么」"
source: "三路联网调研（2026-10-01/02，web_search + web_fetch 取原始页面与官方仓库源码）—— 每条结论附 URL 与强度（官方文档/官方仓库=**高**；官方博客/issue 追踪器=**中**；论坛/个人博客=**低**）。本文件是**唯一新增文件**，未改任何源码"
links: ["workspace-spec.md", "teapot-restructure.md", "requirements.md"]
---
# 外部参考 · 工作区与项目清单

> **这份文件的用途**：[`workspace-spec.md`](workspace-spec.md) 里每条规范都要能指向这里的出处。
> 规范要**短、要能执行**；取证放这里。
>
> ⚠ **未取得的一律写明"未取得"，不许用记忆补**（这是本仓库对联网调研的硬要求）。
> 本次的三条取证障碍：`docs.unity.com`（Unity Hub 现役文档站）与部分 Epic 5.x 页是**客户端渲染**，
> `web_fetch` 只拿到空壳；`raw.githubusercontent.com` 在本环境 DNS 失败，GitHub 源码改走 jsDelivr；
> 因此凡涉及源码逐字的结论，都以**官方仓库文件**为凭并标注取到的方式。

## 一、对照总表

| 维度 | Unity | Godot | Unreal | Cargo / Bevy | npm / pnpm | VS Code |
| --- | --- | --- | --- | --- | --- | --- |
| **清单文件** | `Packages/manifest.json`（**依赖清单**）· `ProjectSettings/*.asset`（YAML）· `ProjectSettings/ProjectVersion.txt` | `project.godot`（INI 风格，`config_version=5`） | `*.uproject`（JSON = `FProjectDescriptor`） | `Cargo.toml` 的 `[workspace]` + 各成员 `[package]` | `package.json#workspaces`（npm）/ **`pnpm-workspace.yaml#packages`**（pnpm） | `<name>.code-workspace`（JSON） |
| **项目名在哪** | `ProjectSettings.asset` 的 `productName` **＋ Hub 列表里的 `title` ＋ 目录名 ＋ `productGUID`**（**四处**） | **`application/config/name`（唯一一处）** | **`.uproject` 里没有 name 字段** ⇒ 名 = **文件名**；另加 `Modules[].Name` | `[package] name` —— **唯一必填字段**，且是**依赖解析键**；workspace 本身无名 | 各包 `package.json#name`；**workspace 无名** | `folders[].name`（**纯显示层覆盖**）；**路径才是身份** |
| **怎么发现/枚举** | Unity Hub：`%APPDATA%/UnityHub/projects-v1.json`（用户目录，**缓存**） | 用户目录 `projects.cfg`：section key=**绝对路径**，值**只有 `favorite`**，名字每次从 `project.godot` **重读**；另有**扫盘**兜底 | 用户目录 `EditorSettings.ini` 的 `CreatedProjectPaths=` | 从当前目录**向上找**带 `[workspace]` 的 `Cargo.toml` | pnpm 只读**仓库根**的 `pnpm-workspace.yaml` | 无全局注册表，只有 Open Recent |
| **共享什么** | Package 缓存 · Unity 安装 | 无跨项目共享；**user data 目录按 `config/name` 分** | `Engine/` · 引擎插件 | **`Cargo.lock`（根）· `target/`（根）· `workspace.package/dependencies/lints`（可继承）** | 默认单 lock + 单 `node_modules`（符号链接） | `.code-workspace` 的 settings/tasks |
| **隔离什么** | `Library/` `Temp/` `Logs/` `obj/` | （user data 按名字分） | 项目 `Binaries/` `Intermediate/` `Saved/` `Content/` | 各成员自己的 `[dependencies]` | 包只能访问**自己声明**的依赖 | 各 folder 的 `.vscode/` **覆盖** workspace |
| **改名** | 官方**无**"改项目名会发生什么"的说明；`productName` 只管运行期身份与产物名 | **内置 Rename**：写回 `config/name`，**明确不动文件夹** | 无改名文档；`EngineAssociation` 改版本是已知坑 | `name` 是依赖键 ⇒ 改名=**断链**，无兼容机制 | pnpm v12.7.0 **有迁移**：无 yaml 时按 `package.json#workspaces` 生成；**已存在永不改**；不一致**只告警** | 无（`folders[].name` 纯显示） |

## 二、逐条要点与出处

### 1. 清单文件里**到底装了什么**（决定"它是不是项目身份"）

- **Unity（高）** <https://docs.unity3d.com/6000.0/Documentation/Manual/upm-manifestPrj.html>：
  原文「You can find the project manifest file, called `manifest.json`, in the `Packages` folder…」
  「**All properties are optional.**」字段只有 `dependencies` / `enableLockFile` / `resolutionStrategy` /
  `scopedRegistries` / `testables` ⇒ **`manifest.json` 里没有项目名**，它是**依赖清单**，不是项目身份。
- **Godot（高）** 官方 `project.godot` 形状：`config_version=5` · `[application] config/name="…"` ·
  `run/main_scene="res://main.tscn"` · `config/features=PackedStringArray("4.3","Forward Plus")`。
  引擎读取点在官方仓库 `editor/project_manager/project_list.cpp`：
  `cf->get_value("application","config/name","")`、`get_value("","config_version",0)`，
  缺失时显示 `TTR("Unnamed Project")`，`config_version` 更高时**把该项目置灰**。
- **Unreal（高）** `FProjectDescriptor` 官方 Remark 逐字段核对：
  `EngineAssociation`「The engine to open this project with」· `Modules`「List of all modules associated
  with this project」· `Plugins`「List of plugins … (may be enabled/disabled)」· `Category` ·
  `Description` · `FileVersion` · `EpicSampleNameHash` —— **没有任何 name 字段**。
- **Cargo（高）** <https://doc.rust-lang.org/cargo/reference/workspaces.html>：
  「A *workspace* is a collection of one or more packages, called *workspace members*, that are managed
  together.」「All packages share a common `Cargo.lock`…」「All packages share a common output directory,
  which defaults to … `target` in the *workspace root*.」
- **pnpm（高）** <https://pnpm.io/settings>：「**pnpm reads the workspace from `pnpm-workspace.yaml`,
  not from the `workspaces` field of the root `package.json`.**」
- **VS Code（高）** <https://code.visualstudio.com/docs/editing/workspaces/multi-root-workspaces>：
  「an array of folders with either absolute or relative paths. **Relative paths are better when you want
  to share Workspace files.**」「You can override the display name of your folders with the `name` attribute」

### 2. 名字归属：**一处** vs **多处**（这一条直接决定"改名要改几处"）

| | 出处 | 强度 | 改名代价 |
| --- | --- | --- | --- |
| **Godot**：`config/name` **唯一一处** | 官方源码 `project_dialog.cpp` 的 Rename 分支 —— **只改 `project.godot` 一行**，且 `MODE_RENAME` 下**路径输入框锁死** | 高 | **1 处**（且**明确不动文件夹**） |
| **Unity**：四处（`productName` / Hub `title` / 目录名 / `productGUID`） | `PlayerSettings.productName` 官方原文：「The name of your product.」「…**`PlayerSettings.productName` is also used to locate the preferences file and define file names for the built Player.**」 | 高（字段语义）／**低**（"改名会发生什么"无官方说明） | **≥2 处，且官方不给迁移说明** |
| **Unreal**：文件系统身份 | 官方目录示例本身就是证据：`MyProject.uproject` · `Source/MyProject.Target.cs` · `Source/MyProjectEditor.Target.cs` · `Source/MyProject/` · `MyProject.Build.cs` ＋ `.uproject` 的 `Modules[].Name` ＋ C++ 宏 `IMPLEMENT_MODULE(...)` | 高 | **≥7 处** |
| **VS Code**：显示名与身份分离 | `folders[].name` 是**覆盖显示**，`path` 才是身份 | 高 | **0**（纯展示层） |

### 3. 注册表：**缓存 vs 真相**

- **Godot（高，官方源码 `project_list.cpp`）**：`projects.cfg` 的每一项**只存 `favorite`**；
  名字每次都从 `project.godot` **重新读**；另有扫盘兜底 —— 判据就是一行
  `n == "project.godot"`。源码里还留着**注册表搬家**的完整先例 `_migrate_config()`：
  **目标文件存在即 `return`（幂等）→ 逐条搬 → 删旧键 → 保存**。
- **Unity Hub（低，个人博客 + 可复现实验）**：`projects-v1.json` 条目含 `title` / `version` /
  `localProjectId`（== 项目内 `productGUID`）；实测**光改 Hub 清单里的版本不生效**，
  Hub 仍回读项目 —— 原文「**UnityHub reads the information from the project instead**」。
  ⇒ **注册表是缓存，不是权威。**
- **Unreal（中）**：最近列表在用户目录 `EditorSettings.ini` 的 `CreatedProjectPaths=`；
  社区多处复现"删行→列表空"。**字段级说明未取得。**

### 4. 模块 / 插件：**一套机制 + 一个来源字段**，还是**两套机制**

- **Bevy（高）** <https://bevy.org/learn/quick-start/getting-started/plugins/>：
  「**All Bevy engine features are implemented as plugins**… This includes internal features like the
  renderer, but games themselves are also implemented as plugins!」`Plugin` 的唯一必需方法是
  `build(&self, app: &mut App)`；官方称 `Cargo.toml` 就是 *"your project file"* ⇒
  **引擎侧没有 workspace 概念**，工作区交给 Cargo。
- **Godot（高）**：两个抽屉，代价写死在文档里 —— `addons/`：「**you don't need to create C++ code nor
  recompile the engine**」；`modules/`：「Modules are located in the `modules/` subdirectory of the build
  system」，且「you must also **recompile every export template** you plan to use」。
- **Unreal（高）**：**两层搜索路径** —— Engine `[Engine]/Plugins/[Name]/` 与 Game
  `[Project]/Plugins/[Name]/`；`.uplugin` 是 JSON（`FileVersion` 是唯一必需字段，另有
  `FriendlyName`/`EnabledByDefault`/`Modules[]{Name,Type,LoadingPhase}`，`Type` 有 7 个取值）；
  且插件依赖**分层**：「can only depend on other Plugins or Modules at the same level or higher」。

### 5. 厂商**自认**的最坏失败模式（这条最值得贴在墙上）

- **pnpm（高）** <https://pnpm.io/workspaces>：v12.4.1 之前，根 `package.json` 声明了 `workspaces`
  而仓库**没有** `pnpm-workspace.yaml` 时，安装会「**silently link no project at all**」——
  官方为此加了告警。v12.7.0 的迁移形状：**无 yaml 时生成一份；已存在的永不改；不一致只告警**。
- **Cargo（高）**：`[patch]` / `[replace]` / `[profile.*]` 「are **only recognized in the *root* manifest,
  and ignored in member crates' manifests**」——**成员写了**不生效、**也不报错**。
  而 `workspace.package` / `workspace.dependencies` / `workspace.lints` 是**可继承**的（成员写
  `xxx.workspace = true`）；`workspace.metadata`「**ignored by Cargo and will not be warned about**」。
- **Godot 的项目升级（高）**：官方弹窗原文警告
  「**Make a full backup of your project** before upgrading! The project upgrade tool will
  **not** perform any backups」，且 CLI 有**干跑**开关 `--validate-conversion-3to4` → `--convert-3to4`。

## 三、Teapot 能抄什么 / 不能抄什么

**能抄（每条附"为什么"）**

1. **身份字段只放清单一处（抄 Godot，不抄 Unity）** —— 前提是同时规定"**目录名不参与身份**"。
   `config/name` 的 Rename 就是"写回一行"，这是唯一让"改名=改一处"成立的结构。
2. **注册表只放派生数据 + 元数据，绝不放真相（抄 `projects.cfg` 的形状）** ——
   判据：**能被项目自己改变的字段，就不能被当成真相**。
3. **注册表搬家要一次性迁移函数（抄 `_migrate_config()`）** —— 幂等（存在即返回）→ 逐条搬 → 删旧键。
   几十行，比以后"永久兼容读两个位置"便宜得多。
4. **区分"可继承"与"只在根生效"，但把静默项改成报错** —— Cargo 的 `workspace.package/dependencies`
   可继承是好设计；`[patch]/[profile]` 被**静默忽略**是坑。Teapot 里"成员写了根不认"**必须报错**。
5. **清单不一致必须告警，不许静默无操作**（抄 pnpm 那次官方自认的最坏失败）。
6. **迁移形状照抄 pnpm v12.7.0**：只在目标不存在时生成 · 永不覆盖已有 · 不一致告警。
7. **显示名与身份分离（抄 VS Code `folders[].name`）** —— 显示名纯展示层 ⇒ 改名零风险。
8. **"一个文件名就是项目的存在证明"（抄 Godot 扫盘判据）** —— `project.godot` 一行判定；
   配合"目录名不进身份"，把项目拷进来就会被发现。

**不能抄 / 要付代价**

1. **不抄 Unity 的多处身份**：四份身份互不同步，官方只解释一份，"改名要改几处"只有社区答案（低强度）。
2. **不抄 Unreal 的"名字=文件名"**：改名=文件系统重命名，所有存过路径的地方不会跟着动
   （官方论坛"项目从 Recent Projects 消失"就是这个结构的下游症状）。
3. **不抄 Cargo 的隐式成员**："workspace 目录下所有 path 依赖自动成为成员"在 Rust 里成立是因为
   path 依赖本身显式；Teapot 若"存在即成员"就会出现**没人声明过却在构建里**的东西 ——
   直接违反本仓库"**数量一律从清单算**"。
4. 🔴 **要付代价的一条（本次唯一"会造成用户数据丢失"的机制）**：Godot 的 `config/name`
   **同时决定 user data 目录**（`app_userdata/<safe name>`，见 `data_paths` 官方页）⇒
   **改名 = 存档目录搬家、旧档不自动迁移**。**Teapot 有存盘，所以必须一开始就把"显示名"与
   "用户数据目录键"分成两个字段**（存档路径用**稳定 id**，不用项目名）。
5. **两套机制的代价不对称**：Godot（`projects.cfg` + 扫盘）= **两套发现、一套真相**（便宜）；
   Unity（Hub 清单 + 项目内设置）= **两套真相**（贵，且只在一个方向有官方裁决）。
   ⇒ **Teapot 判据：缺省不做两套；不得已做两套时，只允许"多一套发现/缓存"，绝不允许"多一套真相"。**

## 四、未取得（**不要当结论**）

| 想查的 | 结果 |
| --- | --- |
| Unity 官方"项目目录结构 / 改项目名会发生什么"的集中页 | `unity-project-structure.html` **404** |
| Unity Hub 的项目操作逐字 UI（Add from disk / Remove / Show in Explorer / Duplicate / Rename） | `docs.unity.com` 客户端渲染，**正文未取得**（仅从 Unity Manual 升级流程页补到部分标签） |
| Unity Hub `projects-v1.json` 的**官方**说明 | 未取得（结论来自个人博客 + 可复现实验，强度低） |
| Unreal 5.x Project Browser 新建面板细节 · UBT/AT 逐字参数表 | Epic 页面 `application_version` 空壳，**未取得** |
| Unreal"最近项目落在哪个 ini 键" | 配置体系与用户级路径为高，**字段级未取得** |
| Cargo 官方的**改名/迁移机制** | **未取得**（文档里没有） |
| Godot 最近项目在 `editor_settings-4.tres` 里的确切键名 | 中（issue 标题 + 源码片段），未逐字核验 |
