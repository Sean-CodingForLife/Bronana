---
title: "工作区搬家（E4）—— 把所有 Bronana 的东西搬进 Bronana 自己的工作区"
category: 决定
id: D-007
status: 现行
scope: "**搬家的执行计划**：目标布局 · 要搬什么（清单从门 `engine-boundary` 现算）· **无感知**的两条硬要求 · 分批（每批的判据与回滚点）· 工具链要改哪几处 · 刻意不做。**不管**：工作区规范的字段集（那是 `workspace-spec.md`）· 批次表本身（`teapot-restructure.md`）"
source: "用户 2026-10-02 的口径：「所有和 Bronana 有关系的统统移动到 Bronana 自己的工作区里去，二者要彻底分离和无感知」；布局对照 Unreal（`Engine/` vs 项目文件夹）· Unity（Packages vs Assets）· Godot（引擎源码 vs 项目目录）—— 出处与强度见 `external-workspace-conventions.md`"
links: ["workspace-spec.md", "teapot-restructure.md", "external-workspace-conventions.md", "engine-first.md", "requirements.md", "../workspace/Bronana/teapot.workspace.json"]
consequences: "**正**：`git mv` 之后，"引擎"与"内容"在**目录上**就分开了 —— 于是"引擎有没有偷偷认识 Bronana"变成一个能一眼看出、也能用门判的事实（今天是靠分类表与人工认领）。**负**：这是一次**不可逆的目录大搬迁**（70 个内容模块 + 内容侧测试 + 宿主人参），中间态必然打破那 30 道门；所以它**必须分批**，每批都要"能跑 + 门绿 + 可回滚"。**代价**：搬迁期间 `src/` 的路径会在文档、注释、门里成批漂移（这正是要一次做完、不许拖成马拉松的原因）。"
confirmation: "每批的判据写在下面的批次表里（第一批还带一条**新的门**：引擎侧不许出现工作区的 id/displayName）。⚠ 搬完之后**现有的门会大面积失效**（它们写死了 `src/`），所以"工具链双根"必须**先于** `git mv` —— 顺序反了就是用一堆红门掩盖真问题。"
---
# 工作区搬家（E4）

> **用户口径**：「所有和 Bronana 有关系的统统移动到 Bronana 自己的工作区里去，二者要**彻底分离和无感知**。」
> 这条在账本里欠了很久（§十三 批次 ③④），`workspace/Bronana/teapot.workspace.json` 里那句
> `note`（"内容**还没有搬进工作区** —— `entry` 与 `content.src` 暂时指向仓库根的 `src/`"）就是欠条。

**外部对照**（用户让我查，确实如此 —— 这是主流引擎的共同形状）：

| 引擎 | 引擎侧 | 内容侧 | 出处 |
| --- | --- | --- | --- |
| Unreal | `Engine/` 源码树 | **项目文件夹**（`.uproject` + `Source/` + `Content/`） | [Directory Structure](https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-engine-directory-structure) |
| Unity | `Packages/`（引擎与包提供） | **`Assets/`**（这个项目的东西） | [Differences between package types](https://docs.unity3d.com/6000.5/Documentation/Manual//upm-package-types.html) |
| Godot | 引擎源码树 | **项目目录**（`project.godot` + `res://`） | 见 `external-workspace-conventions.md` §二 |

⚠ 一个**关键差别**：那三家是"引擎源码 vs 项目"两个**仓库/进程**；本仓库只有一个 git 仓库
（单人维护），所以"分离"落到**目录 + 判据**上，而不是两个包。`workspace-spec.md` §二 的
"四层归属"说的就是这件事。

---

## 一、目标布局

```
teapot/                        ← 引擎仓库根（引擎本体 + 它的规范与工具链）
├── src/                       ← **只留引擎**：mech · data · dungeon · meta · sim · run · art · view · boot
├── tools/  test/  docs/  design/  server/  desktop/
├── workspace/
│   └── Bronana/               ← **这个项目的一切**
│       ├── teapot.workspace.json    （身份 + entry + content.src + storage.namespace）
│       └── src/                     ← 内容：战斗 / 经营 / 养成的玩法、数值、界面、造型
└── ...
```

**判据（说死，免得含糊）**：搬完之后，**引擎侧任何文件都不许出现**这个工作区的
`id` / `displayName` / 内容模块名 —— 而"引擎侧"的**唯一出处**是门 `engine-boundary` 的分类表
（`ENGINE` / `ENGINE_MIXED`），"工作区名"的唯一出处是清单里的 `id`。

---

## 二、要搬什么（**清单从门 `engine-boundary` 现算，不抄进本文**）

`node tools/engine-boundary.mjs` 每次都会打印当天的分类，`--json` 给机器读。
2026-10-02 的实测是：**引擎 26 · 混合 4 · 显式内容 39 · 数据表 31 · 未认领 0**
（`src/` 共 101 个文件，含 `types.d.ts`）。

| 搬 | 不搬（引擎留） |
| --- | --- |
| **显式内容 39 个**（`game.ts` / `ui.ts` / `render.ts` / `sprites.ts` / `profile.ts` …） | **引擎 26 个**（`utils` / `registry` / `selfcheck` / `module` / `banner` / `workspace` / `fold` / `containers` / `rhi` / `viewport` / `text` / `world` / `object` / `art_spec` …） |
| **数据表 31 个**（`data_*.ts` / `curves` / `eco_*` / `economy` / `enemies` / `camp` / `talents` …） | `types.d.ts`（**形状**是引擎的；内容自己的类型将来归工作区） |
| **内容侧测试**（`test/*.mjs` 里跑玩法的那一批） | 引擎侧测试（`arch` / `ui-check` / `persist` / `registry` / `dev-edit` / `yaml` / `name-gate` …） |
| 宿主人参：`index.html` 的入口、`src/main.ts`（web/桌面共用的那一个页面） | `src/cli.ts` / `server/` / `desktop/`（**通用宿主**，它们只该读清单） |
| 游戏门面文档（`README.md` 的玩法部分 · `CHANGELOG.md` · 内容侧 `docs/`） | 引擎规范（`AGENTS.md` / `CONTRIBUTING.md` / `docs/workspace-spec.md` / 工具链文档） |

⚠ **混合档 4 个**（`draw2d` / `comp` / `audio` / `music` —— 机制是引擎的、同一文件里夹带内容）
是这次搬家的**真正边界**：它们要**先切干净**（内容那一半搬走、机制那一半留下），
否则"内容侧"这个词就永远有一个模糊地带。**这一刀不做完，搬家就只是把模糊地带挪了个位置。**

---

## 三、无感知的两条硬要求（比 `git mv` 更本质）

| # | 要求 | 今天的现状 | 判据 |
| --- | --- | --- | --- |
| 1 | **引擎侧不许出现工作区的名字** | ⚠ 还有：`src/main.ts` / `src/cli.ts` 的 `Storage.setNamespace('bronana')`、`src/storage_fs.ts` 的默认目录名、`test/_load.mjs` 的同一句 | 新门（第一批的交付物）：**引擎侧任何文件里的字符串字面量/路径不许出现清单里的 `id`/`displayName`**（豁免：注释里的历史叙述按家法不动） |
| 2 | **宿主只从清单读**（命名空间 / 入口 / 内容根 / 模块开关） | ⚠ 宿主还没读清单：`Workspace.set()` 只有门在调 | 门 `workspace` + 一条**新判据**："`teapot.workspace.json` 里的 `storage.namespace` == 宿主实际用的命名空间"（今天两边都是硬编码的 `'bronana'`，所以看起来对 —— 要改成"只有一处写它"） |

**这两条做完，"无感知"才是真的**：否则搬完目录，引擎里仍然写着 `'bronana'` ——
那只是把内容挪走，**没有把认知挪走**。

---

## 四、批次（每批：能跑 · 门绿 · 可回滚 · 一条判据）

| 批 | 做什么 | 判据（做完了怎么知道） | 回滚 |
| --- | --- | --- | --- |
| **0 · 无感知** | 宿主改从清单读：`Storage.setNamespace` 的来源改成 `Workspace.namespace()`，`storage_fs` 的默认目录从 `id` 派生，`test/_load.mjs` 同理；加**门 `names`**（引擎侧不许出现工作区名） | ✅ **已交付（2026-10-02 · `docs/history/21`）** —— 落点与计划略有出入，**照实测写**：判据不是新开一道门，而是**门 `workspace` 的第 5 条**（`Storage.setNamespace(x)` 的 `x` 不许是字面量 + 宿主里必须真的读清单；自证 11 条，含一条"好形状不该报"）。web 侧由 `vite.config.ts` 构建期发现并 `define` 注入 | 单文件回退 |
| **1 · 工具链双根** | tsconfig / vite / `test/_load.mjs` / `systems.cjs` / `arch-audit` / `engine-boundary` / `foundation-map` / `readme-stats` / `doc-num` 全部改成**认两个根**（引擎 `src/` + `workspace/*/src/`）；先让**空的** `workspace/Bronana/src/` 被工具链认下来 | 🚧 **进行中 · 切片 1a 已交付（2026-10-02）**：新增 `tools/roots.cjs`（**根的唯一声明**：引擎根 + 各工作区清单的 `content.src`，含**过渡态去重** —— `content.src` 指向引擎根时不许数两遍；`--self-test` 在临时目录里造第二根，证明"会被看见 / 会去重"，并**当场抓出了自证夹具自己的路径错**）· `tools/src-files.cjs` 改为转发它（`list()` / `entries()` / `rootsAll()`），**4 个既有消费者**（`arch-audit` / `guard-gaps` / `game-kit` / `audio-census`）自动跨根 · `test/arch.mjs` 新增 **[8] 根枚举**（拿临时假布局永久证明这三件事）<br>⚠ **还剩 9 个文件 / 10 处**（全在测试侧）：`test/arch.mjs`（2）· `combine` · `dungeon` · `fold` · `registry` · `signals` · `states` · `status` · `storage-fs`。它们读 `src/` 做断言（有的只是注释里提到旧写法，**逐处确认**）。迁移方式与工具侧同一条：**枚举走共享扫描器、读字节用 `abs`**（旧代码习惯拿裸名拼回 `src/`，搬家后读漏）。<br>✅ **切片 1b 已交付**：工具侧 **12 个文件**全部改完 —— `_tables` · `engine-boundary` · `color` · `doc-num` · `extract-ui-text` · `name-audit` · `naming` · `text-census` · `hardcode` · `readme-stats` · `solid` · `src-files`（另加 `roots`）；测试侧 `persist`（4 处）与 `ui-check`（2 处，含**依赖名按所在目录解析**）。`src-files.sources()` 是给文本类审计用的**只改循环头**的形状（循环体不动 ⇒ 搬家只发生一次、而且看得见）<br>✅ **切片 1c 已交付 ⇒ 批次 1 的枚举侧清零**：测试侧另外 **8 个文件**（`arch` · `combine` · `dungeon` · `fold` · `registry` · `signals` · `states` · `status`）也全改完。**判据**：`grep -n "readdirSync('src')"` 在 `tools/` 与 `test/` 里只剩**注释**（讲历史那两处）。<br>⚠ **一类刻意留到批次 2 的（不是漏）**：**按名字直接读某个模块**的地方（`fs.readFileSync(path.join(ROOT,'src','x.ts'))`，如 `dungeon.mjs` 那 6 处）—— 它们是 **LOUD**：搬家那天会**当场抛**并指着那一行，而枚举漏了才会全绿。**静默的必须先修，会响的可以跟着搬家一起收。** | 回退这批的改动 |
| **2 · 搬内容（`git mv`）** | 按 §二 的清单搬：先**混合档那 4 个切干净**，再搬显式内容与数据表；宿主/入口跟着改 | 门 `engine-boundary` 的分类表更新后仍**未认领 0**；30 道门全绿；`pnpm cli sim` 能跑出同一份报告；行为指纹逐位不变 | `git mv` 反向 + 回退分类表（**这一批必须一次做完、单独一个提交**） |
| **3 · 测试与文档** | 内容侧测试搬进 `workspace/Bronana/test/`（测试清单分家：引擎的归引擎、内容的归内容）；门面文档分家（游戏的 README 归工作区） | 两边的测试各自能跑；`registry-drift` 认两个测试目录；文档索引分家后 `doc-links` 绿 | 同上 |

**为什么 1 必须在 2 之前**：30 道门里有 **22 道**依赖 `src/**`（这是上一轮实测的数字）。
先搬文件、再改工具链，会让"门红"与"真问题"混在一起 —— 而那正是这个仓库最忌的
"看不见的失败"。

---

## 五、刻意不做

- **不把引擎拆成两个 git 仓库**：单人维护，拆仓库的收益（独立发布）今天不存在，
  代价（两个仓库的门/CI/版本对齐）立刻存在。用户要的是**分离**，不是**分家**。
- **不搬 `docs/history/**`**：那是**当时**的快照（按家法不动）。搬家会在**新的一卷**里记。
- **不一次搬完**：中间态必须能跑 —— 见上面的四批。
- **不为了搬家改判据的宽严**：门 `engine-boundary` 的判据不动；变的只是**文件在哪**。
