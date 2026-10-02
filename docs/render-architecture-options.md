---
title: "渲染后端与 WASM：路线选项（等用户拍板）"
category: 决定
id: D-008
status: 草案
scope: "用户 2026-10-02 提的那封信（单仓库 vs 多仓库 · WASM 的两种交付 · RenderBackend 抽象 · 路线 A「wgpu-native Node addon」vs 路线 B「Tauri/WebView」· 2D/3D 统一管线 · 3DGS）的**可行性分析**与**待答选项**。**不管**：拍板之后的施工计划（那要另开一份）"
source: "用户 2026-10-02 的两段原文（架构建议 + 路线 A/B 取舍）；逐条对着仓库**已有文档**核过：`techstack-upgrade-decision.md`（D-003）· `src/rhi.ts`（R60）· `engine-first.md`（D-001）· `requirements.md` 的 3D-1~6 与「引擎能力缺口」表 · `workspace-spec.md`（D-004）· `AGENTS.md` 四条硬约束 · `editor-roadmap.md`（D-006）"
links: ["techstack-upgrade-decision.md", "engine-first.md", "requirements.md", "workspace-spec.md", "editor-roadmap.md", "workspace-migration.md"]
consequences: "**现在**：一条代码都不改（用户明说「先把现在的目标完成」= E4 搬家）—— 但这封信里的**每一条都会改架构**，所以它必须落成文档而不是留在会话里（会话会丢上下文，这正是本仓库反复吃过的亏）。**代价**：留着一份「草案」文档本身就是噪声；处置是**限定它的寿命** —— 用户拍板后立刻把结论搬进 `techstack-upgrade-decision.md`（或新开一份施工计划），本文件改成 `已取代` + `superseded-by`。"
confirmation: "无门（这是一份**待拍板**的选项表，没有可自动判的判据）—— 它的落点是拍板之后**变成**判据：路线定了要写进 `techstack-upgrade-decision.md` 的硬约束，WASM 三态要变成 `Engine.init` 的**声明 + 自检**，而「数值搬到 WASM 会改指纹」那一条必须按家法**同时**更新 `smoke.mjs` 基线与 CHANGELOG。"
---
# 渲染后端与 WASM：路线选项（**还没拍板**）

> ⚠ **草案 —— 别照它施工。** 这份文件是**用户想法的存档 + 待答选项**，
> 结论要等用户拍板；拍板后它会被 `superseded-by` 掉，结论搬进
> [`techstack-upgrade-decision.md`](techstack-upgrade-decision.md)。

**用户的排期口径**（原话）：「**先把现在的目标完成**，等差不多再开始问我，但你要记住我得想法。」
⇒ 现在的目标 = E4 搬家（[`workspace-migration.md`](workspace-migration.md) 批次 1~3）。
下面这些**不阻塞**它，但**顺序上有关**：渲染后端与 WASM 属于"引擎能力"，
而搬家属于"引擎与内容分家" —— 两者都要动 `src/`，**同时做会互相掩盖**。

---

## 一、可行性：先看仓库已经决定了什么（**不重复讨论已拍板的**）

| 那封信里的主张 | 仓库已有文档怎么说 | 判定 |
| --- | --- | --- |
| 渲染后端要抽象、多后端 | **已经有了第一层**：`src/rhi.ts`（R60）声明"引擎允许用哪些绘制成员"（35 个成员）， `draw2d.ts` 反过来 import 它（`test/rhi.mjs` 测的就是"`RHI.wrap()` 是透明的"） | ✅ 方向一致；信里的 `RenderBackend` = 把 `rhi.ts` 从**成员白名单**升级成**后端契约** |
| 升级到 WebGPU | **已拍板**：[`techstack-upgrade-decision.md`](techstack-upgrade-decision.md)（D-003）：**WebGL2（WebGPU 为目标态）**，含 R1~R4 四条硬约束与七阶段 | ✅ 一致；那封信只是把"目标态"说得更远 |
| 2D/3D 共享一套管线、2D 是 3D 的特例 | **已写死**：`engine-first.md`（D-001）§四之二「零 3D 是**项目**规范，不是**引擎**能力边界」；`requirements.md` 的 **3D-1~6 六条门槛**要求"每一层都留出 3D 的位" | ✅ 一致，而且**留着位子正是为了这一刻** |
| ECS 统一 2D/3D 实体 | 已有 `comp.ts`（组件式组合运行时：`define`/`archetype`/`spawn`/`query`/`system`/`audit`）+ `object.ts`（身份/普查/容器） | ⚠ 已有**自研** ECS；引入 `miniplex` = 加运行时依赖（见 §二 冲突 2） |
| Node 没有 GPU，要原生 addon | 仓库今天**没有**任何原生构建（`dependencies: {}`，Node 24 直接跑 `.ts`） | ⚠ 这是**新增一整条构建链**（见 §二 冲突 1、5） |

## 二、与仓库**四条硬约束**的冲突（这是可行性分析的重点，不是礼貌性提醒）

| # | 信里的主张 | 撞上的家法 | 我的读法 |
| --- | --- | --- | --- |
| 1 | WASM / Rust addon ⇒ 一条构建流水线 | `AGENTS.md` §一：**无构建步**（原生类型擦除直接跑 `.ts`）；§四之四：**会改行为必须显式选择** | **不是不能做，是要分层**：`core-ts` 保持零构建；WASM 作为**可选后端**，以"预编译产物 + 可复现构建 + 版本锁定"的形式进库（否则"换台机器构建不出来"就是新的静默失效） |
| 2 | `gl-matrix` / `miniplex` / `rapier` | `AGENTS.md` §一：**零运行时依赖**（设计约束，加之前必须讨论） | 数学与 ECS 仓库**已经自研**（`utils.ts` / `comp.ts`）。要引这三个 = 改一条**宪法**，得单独立项，不许混在别的改动里 |
| 3 | 建议目录 `packages/*` + `pnpm-workspace.yaml` | ⚠ **术语冲突**：本仓库的「**工作区**」已经指 `workspace/<Name>/`（D-004 · D-007）—— 而 pnpm 的 workspace 是**另一件事**。门 `name` 的纪律是"一个概念只有一个名字" | **最要紧的一条**：直接引 `packages/` 会让仓库里出现**两套"工作区"语义**。要么不动（保持 `src/` + `workspace/<Name>/`），要么**同时改名**（例如 pnpm 那层叫 `packages/`、我们的那层改叫 `projects/`） |
| 4 | 数值挪进 WASM | `AGENTS.md` §五：`f32` 与 `f64` 不是一个东西 ⇒ **行为指纹会变**；换基线要"改一处 + 写一段" | 做的时候**必须**同时更新 `smoke.mjs` 的 `CASES` 与 `CHANGELOG.md` —— 这条不是阻碍，是**有记录的变更** |
| 5 | 路线 A：wgpu-native Node addon（要维护 Windows/macOS/Linux 预编译） | 本仓库**单人维护**；`desktop/` 今天是 Electron 外壳 | ⚠ 路线 A 的真实成本不在代码，在**跨平台预编译分发的长期维护**。这一点用户那封信自己也承认了 |

## 三、与**编辑器**那条线的关系（D-006 的前置清单）

[`editor-roadmap.md`](editor-roadmap.md) 的前置清单里，**只有两条**与渲染后端强相关：
「**资产能力**」与「**热重载 / 增量**」；其余（数据可回写 · 模块加载器 · 场景格式 · 命令层 · 编辑器产物判据）
都**不依赖**渲染后端选型。⇒ **两件事可以并行推进，但不要同时开工**（见 §一 末尾）。

---

## 四、**待答选项**（用户拍板用；每题都给了 AGENT 倾向与理由）

> ⚠ 只是**选项**。用户答完之前，仓库一行都不按它们改。

### Q1 · 渲染后端的**目标态**（最重的一题）

| 选项 | 含义 | 代价 |
| --- | --- | --- |
| **A** | 按 D-003 走：WebGL2 先落地 → WebGPU 为目标态；**桌面继续 Electron/WebView**（同一份 Web 代码） | 桌面端上限 = 浏览器 WebGPU（可接受，且今天 `desktop/` 就是这样） |
| **B** | 直接以 **WebGPU 为唯一目标态**，桌面走 WebView（Tauri 之类） | 放弃旧设备；`WebGL2` 降级后端不写 ⇒ 覆盖面变窄 |
| **C** | **路线 A**：wgpu-native Node addon，桌面**裸原生窗口**，Web 与桌面**共用一套 WGSL** | 新增 Rust 工具链 + 三平台预编译分发（单人维护的真实负担） |
| **D**（**AGENT 倾向**） | **架构按 C 的抽象设计，落地按 A/B 的顺序**：先把 `rhi.ts` 升级成"后端契约"，第一个非 Canvas 后端做 **WebGL2**（浏览器内可验），等玩法稳定再决定要不要 C | 抽象层要**一次设计对**（改它比改后端贵）；好处是**保留 C 的可能，且不被它卡住** |

### Q2 · 抽象放哪一层

| 选项 | 含义 |
| --- | --- |
| **A**（AGENTS 倾向） | **升级 `src/rhi.ts`**：它已经是"引擎允许用哪些绘制成员"的声明，把"成员白名单"扩成"后端契约"（buffer/texture/pipeline/renderPass），`draw2d` 继续只认它 |
| **B** | 新开 `src/render_backend.ts` 作为契约，`rhi.ts` 降级为它的实现细节之一 |
| 判据 | 两条都要满足：**`sim` 层不许碰它**（它是 view 层的面）· **`test/rhi.mjs` 的"透明性"承诺不许破** |

### Q3 · WASM 的**定位与交付**

| 选项 | 含义 |
| --- | --- |
| **A** | **暂不引入** —— 保持零构建 / 零依赖；GPU 密集的部分先交给 WebGPU compute |
| **B**（AGENT 倾向） | **只做可选后端**：预编译 `.wasm` 进库 + `Engine.init({ wasm: 'auto' \| 'inline' \| { url } })` **三态**（与用户信里的建议一致），且**三态都要有判据**（`auto` 的失败回退不许静默） |
| **C** | WASM **内嵌**进 JS（单文件分发，+33% 体积、无法流式编译）—— 作为 B 的 `inline` 那一档即可，不单独选 |
| **D** | 只把**最重的计算**（数学 / 物理 / 剔除 / 动画采样）放进 WASM，渲染调用全留 TS（用户信里也是这个分工 ✓） |

### Q4 · 仓库形态（**与 E4 搬家直接冲突的一题，建议搬家收尾后再定**）

| 选项 | 含义 |
| --- | --- |
| **i**（AGENT 倾向） | **保持单仓库、不引 `packages/`**：分层用目录（引擎 `src/` + 项目 `workspace/<Name>/`）—— 与 D-004/D-007 一致，**不引入第二套"工作区"语义** |
| **ii** | 引 pnpm workspace 的 `packages/*`，**同时**把 Teapot 的"工作区"改名（如 `projects/`）—— 两套机制、一次改名，代价是账本/文档/门一起动 |
| **iii** | 拆多仓库（只在"WASM 核心要被别的非引擎项目复用"时才值得 —— 用户信里也这么说） |

### Q5 · 依赖策略（要动"宪法"，独立立项）

| 选项 | 含义 |
| --- | --- |
| **A**（AGENT 倾向） | **坚持零运行时依赖**：数学/ECS 继续自研（已有 `utils.ts` / `comp.ts`），只允许**构建期**依赖（今天 4 个 devDependencies 已是上限） |
| **B** | 允许"**纯函数、无副作用**"的运行时依赖（`gl-matrix` 这类）：要写清"为什么自研不划算"，并**加一道门**（依赖清单必须显式登记） |
| **C** | 放开运行时依赖（`rapier` / `miniplex` 都引）：与"自研引擎"的目标直接冲突，AGENT 不建议 |

---

## 五、拍板之后要落成什么（先说好，免得拍完就没下文）

1. 结论进 [`techstack-upgrade-decision.md`](techstack-upgrade-decision.md)（或新开一份施工计划），本文件标 `已取代` + `superseded-by`。
2. **每条硬约束变成判据**：后端契约的成员面（扩 `rhi.ts` 的现有机制）· WASM 三态的自检 ·
   依赖清单门（若选 Q5-B）· `f32/f64` 那一条按家法更新 `smoke.mjs` 基线与 `CHANGELOG`。
3. 与 E4 搬家的**顺序**：搬家收尾（批次 3）之后再开工渲染后端 —— 理由与"先无感知再搬目录"同一条：
   **两件都要动 `src/` 的事混在一起做，红的门说不清是哪一件的错。**
