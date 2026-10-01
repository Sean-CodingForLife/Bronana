---
title: "技术栈升级调研 —— Canvas2D → WebGL/WebGPU · 渲染抽象层 · 引擎与内容分离"
category: 调研
status: 已取代
superseded-by: techstack-upgrade-decision.md
scope: "对「要不要上 WebGL / 要不要把引擎与内容分开」的联网取证 + 可核对的数字 + 分阶段建议"
source: "联网调研（web_search / web_fetch）＋ 仓库现场读数（本次调研**未改任何源码**；本文件是唯一新增文件）"
links: ["README.md", "AGENTS.md", "docs/requirements.md"]
---

# 技术栈升级调研

> ## ⚠️ 已拍板：换 WebGL2（2026-10-01）
>
> **本报告的"暂不换"结论已被用户的决定取代。** 决定与施工判据在
> [`techstack-upgrade-decision.md`](techstack-upgrade-decision.md)。
>
> **为什么本报告的结论被推翻**（记在这里，免得下一个人照着它劝回去）：
> 本报告把问题建构成"要不要 WebGL = 值不值（性能收益 ≥ 迁移代价）"，
> 于是 **shader 被降级成"收益清单里的第 2 项"**，再由"目前没有全屏后处理需求"推回"暂不换"。
> 用户的判据是**引擎能力完整性 / 架构自主性 / 前瞻性**（"提前预判为未来铺路"、
> "canvas 容易把 html 和这个项目绑定死"）——**这类判据不该被性能数字否决**。
>
> **本报告仍然有效的部分**：第二~九节的**取证与来源**（Canvas2D/WebGL/WebGPU 的能力边界、
> RHI 的工业做法、引擎/内容分离的判据、2D 技术栈现状）、第十五节的 **26 项「未取得」**、
> 第十四节的 **11 项「需要实测才能定」** —— 施工时这些是背景资料，不是结论。
>
> **本报告已被修正的部分**：§十三.4 的五条触发条件**作废**（决定不建立在触发条件上）；
> §13.1 的接口形状**被 decision 文档的第四节取代**（原版是"一个全局后端"，
> 不足以表达"一帧之内两类绘制目标"）；§12.1 的"40~50 个模块"与
> "1,900 个调用点要改"**说重了** —— 实测 `D.*` 调用点**一处不用改**，
> 要重写的是 `draw2d.ts` 那 382 行（复核见 decision 文档 §2.1）。

> **这份文件是调研报告，不是决定。** 建议与路线图在
> [第十六节](#十六给-bronana-的建议)；需求账本里对应的条目仍是 **R49**（技术栈）
> 与 **R51**（引擎化）。
>
> **取证纪律**：每一条关键结论后面跟来源链接，并标来源强度
> （**高** = 官方规范 / 厂商官方文档 / 官方源码；**中** = 官方博客 / 工程博客 / 学术论文；
> **低** = 论坛 / 社区整理 / 搜索片段）。凡本次拿不到原始出处的，写 **未取得** ——
> 不拿量级猜数、不拿记忆补数。
>
> **一条必须先说的取证限制**：本次调研中 `raw.githubusercontent.com` 在本机 DNS 解析失败
> （`getaddrinfo ENOENT`），`web.dev` 主域、`caniuse.com` 部分页面、construct.net
> 在主抓取通道被拒（403 / 前置壳层）；涉及这些站点的结论已注明获取途径。
> 另有 **26 项**明确 **未取得**，集中列在 [第十五节](#十五本次明确未取得的东西)。

---

## 零、先说结论（给不想读长文的人）

| 问题 | 结论（⚠ **前两行已被 2026-10-01 的决定取代**） | 置信度 |
| --- | --- | --- |
| ~~现在该不该把渲染换成 WebGL2~~ | 🔴 **本报告当时的答案："不该现在换"。已被推翻** —— 用户拍板**换**，判据是引擎能力完整性 / 架构自主性 / 前瞻性，不是性能阈值 | — |
| ~~该不该上 WebGPU~~ | 🔴 **本报告当时的答案："更不该"。已修正为："先做 WebGL2，WebGPU 是目标态"** | — |
| 该不该把引擎与内容分成两个目录 | **方向上对，但不要搬目录。** 用**声明表 + 机器门**表达边界，与本仓库既有的 `systems.cjs` / `Registry` 同一套路 | 中高 |
| 迁移代价有多大 | 若走"后端接口 + 门"路线：**新增 3~4 个模块、改 1 个消费方（`draw2d.ts` 出口）、加 2 道门**；若走"搬目录"路线：**L0+L1 共 40 个模块的 import 路径 + 全部门与工具的文件清单** | 中（见 [第十四节](#十四不确定与需要实测才能定的部分)） |
| 最硬的约束是什么 | **gzip 预算只剩 11.1 kB**（实测 js gzip 273.9 / 预算 285；全站 290 / 300，见 `test/modes.mjs` [9]）。任何"顺便引个库"的方案在这里直接出局 | 高 |

---

## 一、Bronana 的现场读数（本节的数字全部来自仓库，是后面所有推论的基准）

### 1.1 渲染现状

| 维度 | 实测 | 出处 |
| --- | --- | --- |
| 稳态每帧绘制调用（中位） | **290 次**（门的上界 **< 900**） | `docs/requirements.md` R49 证据表；`test/render-check.mjs:255` |
| 模拟层每步耗时（三场景最差 P95） | **0.151 ~ 1.284 ms**，占 60fps 预算 **0.9% ~ 7.7%** | `README.md` 性能节；`docs/requirements.md` R49 |
| 最密场景（300 怪） | enemies 1300 · underlay 788 · particles 440 · decals 299 ≈ **3000 次/帧** | `docs/requirements.md` R49 |
| 换波烘焙那一帧 | **51,096 次调用**（ground 抖动 47,835，占 93.6%），每波**一次** | `test/render-check.mjs:514`（上界 60000） |
| 每帧新建选项对象 | **0.0 个**（改造前 37/帧 ≈ 2247 次/秒） | `docs/requirements.md` R49 |
| 已建成的批处理资产 | 角色姿态图集 56 张 ≈ **0.57 MB**；静态地面/岩石/白骨烘进离屏 canvas | `README.md` 绘制批处理节 |
| 缓存的画布内存 | 两层已占 **18.0 MB** | `README.md` 绘制批处理节 |
| 运行时依赖 | **0** | `docs/requirements.md` 当前基线 |
| 素材文件 | **0**（无 `public/`、无 `assets/`） | 同上 |
| 构建产物 | JS **744.68 kB**（gzip **275.63**）· CSS 28.2 kB · HTML 33.5 kB · 全站 gzip **290.0 kB** | `docs/requirements.md` 当前基线 |
| 预算与余量 | JS gzip ≤ **285** → **只剩 9.4 kB** | `test/modes.mjs` [9] |
| 模块规模 | **94 个模块 · 43,973 行**（另有 `types.d.ts` 5,224 行） | `docs/requirements.md` 当前基线 |
| 门 / 测试 | **20 道门 · 64 套无头测试** | `tools/verify.mjs` 的 `GATES` / `test/suites.mjs` |
| 依赖环 / 向上的边 | **0 / 2 条**（都已逐条登记理由） | `tools/systems.cjs` 的 `EXCEPTIONS` |

### 1.2 分层现状（`tools/systems.cjs` 是唯一出处）

| 层 | 系统 | 模块数 | 典型模块 |
| --- | --- | --- | --- |
| **L0** | mech 工具与机制 | **21** | `utils` `registry` `selfcheck` `fold` `containers` `envelope` `comp` `collide` `rig` **`draw2d`** `depth` `ai` `world` `object` `appearance` `openings` `character` `dialogue` `status` `curves` `stats` |
| **L1** | data 数据表 | **19** | `data_tiers` `data_elems` `ledger` `eco_*` `link` `economy` `terms` `station` `art_spec` `affixes` `data_weapons` `data_items` `data_chars` `enemies` `levelup` `run_save` |
| L2 | dungeon 地牢与内容 | 5 | `dungeon` `art_tiles` `arena` `story` `hall` |
| L3 | meta 局外成长 | 23 | `camp` `stronghold` `forge` `craft` `talents` `profile` … |
| L4 | sim 模拟内核 | 9 | `game` `market` `emit` `scene` `record` `grid` `chamber` `impact` `skills` |
| L5 | run 一局的进出 | 2 | `save` `score` |
| L6 | art 造型与声音 | 6 | `bronana` `art_parallax` `art_shaders` `sprites` `audio` `music` |
| L7 | view 表现与界面 | 5 | `render` `ui` `input` `diag` `crash` |
| L8 | boot 入口 | 4 | `main` `cli` `demo` `storage_fs` |

**这张表本身已经是一份"引擎 / 内容"的雏形**：L0 的 21 个模块里有相当一部分一个玩法概念都不认识
（`utils` / `registry` / `selfcheck` / `fold` / `containers` / `collide` / `rig` / `draw2d` /
`depth` / `world` / `object` / `dialogue` / `status`）。**本仓库的家法已经写着同一句话**：

> **决定一个模块坐哪里的不是它的性质，是它的依赖。**

（`AGENTS.md` 第四节；`tools/systems.cjs` 里 `fold.ts` / `world.ts` / `object.ts` 的注释逐条复述了这条。
这不是从外部抄来的，是这个仓库自己量出来的。）

### 1.3 一条必须先摆上桌的约束

**A07 颜色门还不存在**（`tools/color-audit.mjs` 经 `Test-Path` 核实为 **False**），
所以"美术宪法"里"颜色只能来自 `PAL`"这一条**目前只靠人和评审看着**
（`AGENTS.md` 第十节第 7 条、`docs/requirements.md` A07/A13）。
这件事与本调研的关系是：**换渲染后端会让颜色/绘制路径的断言整体换地基**，
而颜色那一条现在恰好是最薄的一环 —— 顺序应当是"先把便宜的门建起来，再动渲染后端"。

---

## 二、Canvas2D 的能力与性能边界

### 2.1 瓶颈的性质：不是像素吞吐，是**每次调用的固定开销**

这是本次取证中最有价值的一条官方定性。WHATWG 官方 wiki 的提案页
（标题即 "Canvas Batch drawImage"）明确写道：当每动画帧调用 `drawImage` 数百至数千次时，
**API 绑定开销（bindings overhead）与单次绘制的内部记账成本成为显著性能瓶颈**〔高〕
（[WHATWG: Canvas Batch drawImage](https://wiki.whatwg.org/wiki/Canvas_Batch_drawImage)）。

同一页给出的唯一一组 draw-call 级具体数字：

> Nexus 7 上，**原生 canvas 实现在同时绘制 1000 个 sprite 时可达 60fps**；
> 同样 demo 跑在 **Chromium 36 中约 9fps**。〔高〕
> （[WHATWG wiki](https://wiki.whatwg.org/wiki/Canvas_Batch_drawImage)）

**这条数据的边界必须写清楚**：它来自 2014 年前后的 Chromium 36 与当时的移动硬件，
**不能外推到现代浏览器**。它确立的是瓶颈**性质**，不是阈值。

同一页还解释了为什么 Canvas2D **默认救不了自己**：

> 有些实现已经能识别批处理机会，在更低的图形栈层面对连续的 `drawImage` 做批处理
> （例如 Blink 里 **skia 的 drawBitmap**）。这种自动检测**确实改善了光栅化性能，
> 但并没有消除绑定开销**……〔高〕
> （[WHATWG wiki](https://wiki.whatwg.org/wiki/Canvas_Batch_drawImage)）

而 WebGL 之所以快，是因为 "**batching sprite draws is possible thanks to vertex buffers**"
〔高〕（同上）。

**给本项目的直接含义**：本作稳态 290 次/帧**远在这条性质的下方** ——
它的代价在这一档基本被"静态层烘焙 + 图集 + 剔除"吃掉了（见 1.1）。

### 2.2 官方点名的昂贵操作

MDN 官方的 Canvas 优化页给出的昂贵 / 易错清单〔高〕
（[MDN: Optimizing canvas](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas)）：
重复绘制相同图元应**预渲染到离屏 canvas**；**浮点坐标**会迫使浏览器"做额外计算来生成抗锯齿效果"；
在 `drawImage` 里缩放应改为预缓存；复杂场景应用**多层 canvas**；大背景图应改用 CSS `background`；
缩放 canvas 应尽量别做（"CSS transforms are faster since they **use the GPU**"）；
不需要 alpha 时用 `{ alpha: false }`；以及两条原则："**Batch canvas calls together**" /
"**Avoid unnecessary canvas state changes**"。

web.dev 官方的 Canvas 性能文（Boris Smus）另给了三条更具体的〔高〕
（[web.dev: Improving HTML5 Canvas performance](https://web.dev/articles/canvas-performance)）：

- canvas 实现于一个**状态机**之上，操作这个状态机本身有开销，所以**按颜色而不是按位置渲染**；
- 有一整节标题就叫 **"Avoid shadowBlur"**，原文称该操作 "**very expensive**"；
- **文本**："a good example of this is **text rendering, which is a very expensive operation**"。

> **对 Bronana 的映射（这是本节最有实操价值的一条）**：本作的
> **美术宪法第 2 条恰好禁掉了 `shadowBlur`、渐变与模糊**（`draw2d.ts` 不提供这些 API，
> `test/render-check.mjs` 还会在运行时拦截），颜色又集中在 `PAL`。
> 也就是说，**官方点名的三大昂贵项，这个项目主动放弃了两个半**。
> 剩下那半个是**文本** —— 而本作已经用"伤害飘字并发上限 26 条"处理过它（`README.md` 性能节）。
> 结论：**本作的美术宪法本身就是一份 Canvas2D 性能优化方案**，这不是巧合，是它跑得动的原因。

### 2.3 填充率 / overdraw：**未取得通用数字**

本次取证只拿到一条**有机制解释**的权威陈述，而不是填充率上限：预渲染到离屏 canvas 时，
**离屏 canvas 必须紧贴所画内容**，否则"离屏渲染的性能收益会**被把一张大 canvas 拷到另一张上的
性能损失抵消掉**（该损失随源/目标尺寸变化）"；官方给的对照实验是 `100×40`（紧）vs `300×100`（松），
后者更差〔高〕（[web.dev](https://web.dev/articles/canvas-performance)）。

**"在多少 draw call 或多少填充率时开始掉帧"的通用阈值：未取得。**
没有找到任何官方或学术来源给出可跨项目迁移的固定阈值。**这本身就是结论之一**：
**阈值是硬件与实现相关的，不存在一个"1200 draw call 就掉帧"的统一数字。**
（这正是 [第十六节](#十六给-bronana-的建议) 里触发条件必须写成"实测"而不是"某个常数"的原因。）

### 2.4 Canvas2D 是 CPU 受限还是 GPU 加速？—— **两者都对，而且这才是风险**

- **API 层面没有硬件加速保证**：MDN 只说 WebGL "draws **hardware-accelerated** 2D and 3D graphics"，
  描述 Canvas API 时不含这个保证〔高〕（[MDN: Canvas API](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API)）。
- **官方承认实现差异会改变结论**：web.dev 原文称，随着各浏览器实现 canvas **GPU 加速**，
  文中列出的某些优化手段"会变得不那么重要"；并承认**无法知道测试运行时是否真的走了硬件加速**，
  判据是 Chrome 的 `about:gpu`〔高〕（[web.dev](https://web.dev/articles/canvas-performance)）。
- **历史上的移动端是纯 CPU**：web.dev 原文（写作时点）称只有 iOS 5.0 beta / Safari 5.1
  有 GPU 加速的移动 canvas 实现，"没有 GPU 加速时，移动浏览器一般没有强到能跑现代 canvas 应用的 CPU"，
  并称同一测试在移动端差**一个数量级**〔高，但为历史时点陈述〕（同上）。

**给架构决策的含义（推断，非引用）**：Canvas2D 的性能画像**不可预测** ——
同一份代码在 Chrome/Windows（GPU 路径）与某台低端 Android（可能走 CPU 或走低效 GPU 路径）
之间可能差一个数量级。**这是"文本/阴影/渐变之外"的架构级风险。**

---

## 三、Canvas2D 相对 WebGL 缺了什么（公平对照）

### 3.1 缺失项

| 能力 | Canvas2D | WebGL | 出处 |
| --- | --- | --- | --- |
| **自定义 shader（顶点 / 片元）** | ❌ 完全没有 | ✅ `createShader` / `createProgram` / `linkProgram` / `useProgram` | 〔高〕[Khronos WebGL 1.0 规范](https://registry.khronos.org/webgl/specs/latest/1.0/) |
| **顶点效果** | ❌ | ✅ 同上 | 〔高〕同上 |
| **实例化** | ❌ | ✅ `ANGLE_instanced_arrays` 被 MDN 列为普遍支持的扩展 | 〔高〕[MDN: WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices) |
| **渲染到纹理（FBO）** | 只能"画到另一张 canvas"（非 GPU 级 FBO） | ✅ `createFramebuffer` / `framebufferTexture2D` | 〔高〕[Khronos 规范](https://registry.khronos.org/webgl/specs/latest/1.0/) |
| **mipmap** | ❌ | ✅ `generateMipmap` | 〔高〕[MDN best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices) |
| **各向异性过滤** | ❌ | ✅ 扩展 `EXT_texture_filter_anisotropic` | **未取得**该扩展页原文 |
| **MSAA** | 由浏览器隐式抗锯齿，**应用无法控制** | ✅ `antialias` 上下文属性 + `sampleCoverage` | 〔高〕[Khronos 规范](https://registry.khronos.org/webgl/specs/latest/1.0/) |
| **混合方程可控** | ❌ 只有固定枚举 | ✅ `blendEquation(Separate)` / `blendFunc(Separate)` | 〔高〕同上 |
| **深度 / stencil 缓冲** | ❌ 无 | ✅ 绘图缓冲默认含 16 位整型 depth | 〔高〕同上 |
| **GPGPU / compute** | ❌ | WebGL1 弱；**WebGPU 有一等公民支持** | 〔高〕[MDN: WebGPU API](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API) |

### 3.2 公平对照：Canvas2D **确实有**的东西（不能拿"没有混合模式"当论据）

**`globalCompositeOperation` 有 26 个值，比 WebGL 的原生混合模式多得多。**
MDN 完整列出 `source-over`（默认）到 `luminosity` 共 26 个〔高〕
（[MDN: globalCompositeOperation](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/globalCompositeOperation)）。

Phaser 4 官方迁移文档亲口承认这个取舍：

> "Canvas retains one advantage: **27 blend modes vs WebGL's 4 native modes**
> (NORMAL, ADD, MULTIPLY, SCREEN). In v4, the new `Blend` filter can recreate all Canvas
> blend modes in WebGL, though **it requires indirection through a `CaptureFrame`,
> `DynamicTexture`, or similar**."〔高〕
> （[Phaser v3→v4 迁移指南](https://cdn.jsdelivr.net/npm/phaser@4.1.0/skills/v3-to-v4-migration/SKILL.md)）

> **注意**：Phaser 说 27、MDN 列 26，**差异来源未取得**。这个不一致本身值得一提 ——
> 引用"混合模式数量"这类数字时要标出处，两家官方自己就对不上。

**`ctx.filter` 确实存在**（`blur()` / `brightness()` / `contrast()` / `drop-shadow()` /
`grayscale()` / `hue-rotate()` / `invert()` / `opacity()` / `saturate()` / `sepia()` / `url()`）
〔高〕（[MDN: filter](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/filter)）。
**但基线状态要标**：MDN 对它标 **"Limited availability — not Baseline"**〔高〕（同上），
**不是可以无条件依赖的东西**。

**`OffscreenCanvas` 让 Canvas2D 也能离开主线程**，MDN 标为 **Baseline "Widely available"，
自 2023 年 3 月起跨浏览器可用**〔高〕（[MDN: OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas)）。
它**还带 `contextlost` / `contextrestored` 事件**〔高〕（同上）——
**这一条很重要：上下文丢失不是 WebGL 独有的税**，R49 触发条件第 4 条（离屏/Worker 渲染）
在"不换栈"的前提下也有风险要处理。

### 3.3 全屏后处理到底能不能做

**严格答案：本次未取得任何权威来源同时讨论 Canvas2D 与"全屏后处理"的可行性。**
以下是基于已取证事实的**推断**：

- Canvas2D **能拼出近似**：`ctx.filter = "blur(...)"` 给高斯模糊，
  `globalCompositeOperation = "lighter"` 给加法混合，`shadowBlur` 给发光〔高，各 API 官方页〕
  （[MDN: filter](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/filter)）。
- **但 `shadowBlur` 被官方明确要求"避免"，理由就是 expensive**〔高〕
  （[web.dev](https://web.dev/articles/canvas-performance)）——
  **拿它做全屏 bloom 在性能上自相矛盾**。
- 真正的自定义后处理（色差位移、屏幕空间光照、任意片元运算）需要**每像素可编程**，
  而 Canvas2D **没有任何 shader 接口**（`createShader` 等只存在于 `WebGLRenderingContext`）
  〔高〕（[Khronos 规范](https://registry.khronos.org/webgl/specs/latest/1.0/)）。

**一条比"有没有 shader"更有价值的工程事实**：Godot 官方 renderer 对照表里，
**Compatibility（OpenGL 路径）也有 shader，但依然缺** MSAA 2D、compute shader、
`CompositorEffects` 自定义后处理、SSR/SSIL/SDFGI〔高〕
（[Godot: Overview of renderers](https://docs.godotengine.org/en/stable/tutorials/rendering/renderers.html)）。
→ **后处理不是"有没有 shader"的二值问题，是一条能力阶梯。**

### 3.4 WebGL 的"未来"：官方口径

MDN 对 WebGPU 的页面里有一句直接判了 WebGL 的未来：

> "**There are no more updates planned to OpenGL (and therefore WebGL)**, so it won't get any
> of these new features."〔高〕（[MDN: WebGPU API](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API)）

同页列出了 WebGPU 补上的、与 2D 后处理直接相关的能力：

> "**Rendering of individual objects is significantly cheaper on the CPU side**, and it supports
> modern GPU rendering features such as **compute-based particles and post-processing filters
> like color effects, sharpening, and depth-of-field simulation**."〔高〕（同上）

**这条对本次决策的含义**：如果有一天要换，"直接上 WebGPU"是一个**逻辑上更省一次迁移**的选项 ——
但代价见第八节。

---

## 四、WebGL2 做 2D 的真实成本

### 4.1 API 形态：为什么"画 1000 个 sprite"不是 1000 次调用

WebGL2 Fundamentals（权威教学站）用了一个极好的类比〔高〕
（[WebGL2 Fundamentals: Drawing multiple things](https://webgl2fundamentals.org/webgl/lessons/webgl-drawing-multiple-things.html)）：

> "WebGL is like having a function someone wrote where instead of passing lots of parameters to
> the function you instead have a **single function that draws stuff and 70+ functions that set up
> the state for that one function**."

它给出的 **init-time / render-time 两步结构**就是"样板代码"的确切内容〔高〕（同上）：

- **Init time**：创建 shader / program 并查 location；创建 buffer 并上传顶点数据；
  **为每个要画的东西创建一个 vertex array**（每个 attribute 都要
  `bindBuffer` + `vertexAttribPointer` + `enableVertexAttribArray`）；
  绑定索引到 `ELEMENT_ARRAY_BUFFER`；创建纹理并上传。
- **Render time**：清屏、设 viewport 与全局状态；**对每个要画的东西**：
  `useProgram` → `bindVertexArray` → 设 uniform → `drawArrays` / `drawElements`。

**可量化的收益与官方结论**〔高〕（同上）：

> "In WebGL1 **without vertex arrays, drawing a single object will often take 9 to 16 calls to
> setup the attributes** to draw the object. In WebGL2 all of that happens at init time by setting
> up a vertex array per object and then at render time it's **a single call to `gl.bindVertexArray`
> per object**."

> "The optimizations mentioned in the section above are unlikely to make the difference between
> performant and not performant. Rather, **to get performance requires reducing the number of draw
> calls, for example by using instancing**."

> "It's just important to be aware **WebGL is super low level so there's a ton of work for you to do
> if you want to do it yourself** and that often includes **writing a shader generator** since
> different features often require different shaders."

### 4.2 矩阵数学：官方给的是"你得自己带"

MDN 的 "WebGL model view projection" 整页**就是**"矩阵要自己搞定"的证据：它讲 model / view /
projection 矩阵、clip space（**2 单位宽、从 (-1,-1,-1) 到 (1,1,1) 的立方体**，即 NDC）、齐次坐标、
除以 W、视锥体，并直接给出需要手写或引入的实现：`multiplyMatrixAndPoint`、`multiplyMatrices`、
`multiplyArrayOfMatrices`、`translate`、`scale`、`rotateX/Y/Z`〔高〕
（[MDN: WebGL model view projection](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_model_view_projection)）。

**给 2D 的特化观察（推断）**：2D sprite 只需 3×3 仿射（`a,b,c,d,e,f`）而非 4×4，
不需要投影与视锥。**但"纹理坐标 + 顶点缓冲 + 批次提交"的骨架完全一样。**

### 4.3 上下文丢失：这是**架构级**要求，不是补丁

- `webglcontextlost` 事件在浏览器检测到 drawing buffer 丢失时触发；MDN 标 **Baseline，
  自 2015 年 7 月起跨浏览器可用**〔高〕
  （[MDN: webglcontextlost](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/webglcontextlost_event)）。
- 规范定义了 `webgl context lost flag` 与 `isContextLost()`，以及 `CONTEXT_LOST_WEBGL` 枚举〔高〕
  （[Khronos 规范](https://registry.khronos.org/webgl/specs/latest/1.0/)）。
- MDN 最佳实践一句话定性：**"The _only_ errors a well-formed page generates are
  `OUT_OF_MEMORY` and `CONTEXT_LOST`."**〔高〕
  （[MDN: WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)）
  —— 即：**上下文丢失不是异常路径，是正常路径。**
- 另有 2D 常忽略但必需的一项：**`preserveDrawingBuffer` 默认 false**，
  规范警告 "it **can cause significant performance loss on some platforms**"〔高〕
  （[Khronos 规范](https://registry.khronos.org/webgl/specs/latest/1.0/)）。
- 测试手段：`gl.getExtension("WEBGL_lose_context").loseContext()`〔高〕
  （[MDN: webglcontextlost](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/webglcontextlost_event)）。

**成本性质（推断）**：处理上下文丢失要求**所有 GPU 资源（纹理、buffer、program、FBO）都可重建**，
即渲染层必须有一份**可重放的资源描述**。**这是架构级要求，不是补丁。**
（这一条对本项目的意义：它和 `test/_ctx.mjs` 现有的"带 CTM 追踪的 Canvas2D 桩"是同一类东西 ——
都是"把绘制变成可记录、可重放的描述"，所以**先做后端接口，等于把这件事提前做了一半**。）

### 4.4 最小 2D WebGL 渲染器的 LOC —— **未取得**

**本次取证未能取得任何来自官方文档、论文或可核对仓库的 LOC / KB 数字。** 具体说明：

- `twgl.js`（WebGL Fundamentals 官方推荐的 helper）在 unpkg 的文件列举返回 **"0 files"**〔低，抓取失败〕
  （[app.unpkg.com/twgl.js](https://app.unpkg.com/twgl.js)）；
- `raw.githubusercontent.com` 在本环境**不可达**，无法直取任何最小实现的源码行数。

**因此本小节结论：未取得。** 只给出**可核验的结构性下界**（"必须存在哪些部件"，
部件清单引自 4.1 的两步结构 + 4.2 的矩阵函数清单 + 4.3 的资源重建要求）。

**若一定要一个量级判断，那是推断而非取证**：官方说"无 VAO 时单物体 9~16 次属性设置调用"、
"要性能必须减少 draw call（如 instancing）"。**这说明最小可用 2D 批渲染器的复杂度由
"批处理 / 图集 / 状态排序"决定，而不是由数学库决定。**
任何"800 行就能搞定 2D WebGL"的说法，都必须按"是否含纹理图集管理、批次切分、
上下文丢失恢复、文本渲染"分档讨论 —— **分档后的具体数字：未取得。**

---

## 五、WebGPU 的浏览器支持现状（可核对）

### 5.1 首发的官方口径（含确切平台边界）

Chromium 官方博客原文〔高〕（[Chrome: WebGPU release](https://developer.chrome.com/blog/webgpu-release)）：

> "WebGPU is now available by default in **Chrome 113**"
>
> "This initial release of WebGPU is available in **Chrome 113 on ChromeOS devices with Vulkan
> support, Windows devices with Direct3D 12 support, and macOS. Linux, Android, and expanded
> support for existing platforms will come soon.**"
>
> "WebGPU is a **work-in-progress in Firefox and Safari**, in addition to the initial implementation
> in Chrome."

该页**自报最后更新日期为 `2023-04-06 UTC`**，即当时 Chrome 113 尚在 Beta 通道〔高〕（同上）。
**Chrome 113 进入 Stable 的确切日期：未取得**（Chromium Dash API 本次抓取失败）。

### 5.2 逐版本支持表

**数据自报月份：August, 2026**；全局用量 **85.72% + 1.63% = 87.35%**；规范状态 **WD（W3C Working Draft）**
〔中，caniuse 为社区维护的特性支持表〕（[caniuse.com/webgpu](https://caniuse.com/webgpu)）。

| 浏览器 | 支持情况 |
| --- | --- |
| **Chrome** | 80–112 **Disabled by default**；**113–143 Supported**；144–157 Supported |
| **Edge** | 80–112 Disabled by default；**113–153 Supported**；154 Supported |
| **Safari** | 15–17.3 **Not supported**；17.4–18.7 Disabled by default；**26.0–26.6 Partial**；27 及以后 Partial |
| **Firefox** | **63–160 全部为 "Disabled by default"**（含 141–144、145–156、157、158–160），**没有任何 Supported 区间** |
| **Opera** | 73–98 Disabled by default；**99–134 Supported** |
| **Chrome for Android** | **154 Supported**（此前无 Supported 区间） |
| **Safari on iOS** | 17.4–18.7 Disabled by default；**26.0–27.2 Supported** |
| **Samsung Internet** | **24–30 Supported** |
| **Firefox for Android** | **157 Disabled by default** |
| **Android Browser** | 154 **Not supported** |
| Opera Mini / UC / QQ / Baidu / KaiOS | 均不支持 |

〔全部来源强度：中〕（[caniuse.com/webgpu](https://caniuse.com/webgpu)）

> **必须标注的矛盾**：caniuse 的 Firefox 行**全部是 "Disabled by default"**，
> 与"Firefox 141 起可用"的常见说法**不一致**。**本报告无法解释这一差异**
> （可能 caniuse 以"默认开启"为判据，而 Firefox 是按平台分阶段开启）。
> **"Firefox 在哪个平台、哪个版本真正默认开启 WebGPU"：未取得可核对的官方公告原文**
> （Mozilla 发布说明本次未抓取成功）。**这条矛盾请在使用 caniuse 数字时一并引用。**

**MDN 的独立判据（与 caniuse 无关）**：MDN 对 WebGPU API 标
**"Limited availability — This feature is not Baseline because it does not work in some of the
most widely-used browsers."**，且为 **Secure context only（HTTPS）**〔高〕
（[MDN: WebGPU API](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API)）。

**Safari 的 "Partial support" 具体缺哪些子特性：未取得**〔中〕（[caniuse](https://caniuse.com/webgpu)）。

### 5.3 官方实现状态 wiki

`https://github.com/gpuweb/gpuweb/wiki/Implementation-Status` 返回 HTTP 200，
但抓取结果**只含 GitHub 的导航壳层，正文表格未被返回**。
**因此该 wiki 的具体实现状态表：未取得**〔低，抓取不完整〕
（[gpuweb wiki](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status)）。

### 5.4 对决策的净结论

**格局是"Chrome / Edge / Opera / Samsung + Safari 26+ 可用，Firefox 待定"**
〔中〕（[caniuse](https://caniuse.com/webgpu)）＋〔高〕（[MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API)）。

加上 PixiJS 官方的实测经验 —— **WebGPU 不自动等于更快**〔中〕
（[PixiJS v8 launches](https://pixijs.com/blog/pixi-v8-launches)）：

> "it's important to note that **WebGPU does not automatically guarantee improved performance over
> WebGL in all scenarios**, as PixiJS often encounters **more limitations on the CPU side** than the
> GPU. **However, for scenes with numerous batch breaks, such as filters, masks, and blend modes,
> WebGPU may offer better performance**"

**这是本节对"要不要上 WebGPU"最重要的一条**：收益出现在 **batch break 多**的场景
（滤镜 / 遮罩 / 混合模式），**而不是"2D 通用提速"**。
而 Bronana 的绘制恰恰是**同色、不透明、无描边、少切换**的那一类
（它的批处理结论就建立在"不透明 → 随便合并；alpha < 1 → 一律不合并"这条规则上，见 `README.md`）。

---

## 六、案例研究：渲染后端演进的实际代价

### 6.1 PixiJS：Canvas 后端是怎么被移除的

时间线（可核对）：

1. **起点就是"先 WebGL、失败退回 Canvas"**：官方 v8 Beta 博客回忆，
   "**PixiJS's standout feature was its ability to first attempt rendering with WebGL and then
   fall back to Canvas as a Plan B.**"〔中〕（[PixiJS v8 beta](https://pixijs.com/blog/pixi-v8-beta)）
2. **v7 起两个后端被"分包"**：v7 迁移指南写 "Browser builds have been removed for all packages,
   with the exception of `pixi.js` and **`pixi.js-legacy`**"〔中〕
   （[PixiJS v7 迁移](https://pixijs.com/8.x/guides/migrations/v7)）——
   **`pixi.js-legacy` 就是 Canvas 后端的载体**。v7 指南正文未提移除 Canvas。
3. **v8 的动机之一是 WebGPU，并明确沿用同样的 fallback 策略**〔中〕
   （[PixiJS v8 beta](https://pixijs.com/blog/pixi-v8-beta)）。
4. **v8 只剩 WebGL 与 WebGPU 两个后端**：官方 API `autoDetectRenderer()`，
   文档注释写 "will return a WebGL or WebGPU renderer"〔中〕（同上）；发布公告亦称
   "We only load the one backend that your user is using."〔中〕（[v8 launches](https://pixijs.com/blog/pixi-v8-launches)）
5. **社区侧的处置发生在 issue/discussion 里**：GitHub Discussion
   **"Canvas Renderer Support in v8" #10682**〔中〕（[pixijs/pixijs#10682](https://github.com/pixijs/pixijs/discussions/10682)）。
   **该 discussion 正文与结论：未取得**（抓取只返回导航壳层）。
   **"PixiJS 在哪个具体版本、以什么官方措辞移除 Canvas 渲染器"的确切出处：未取得。**
6. **v8 迁移指南本身没有 "Canvas renderer removed" 条目** —— 其 Breaking Changes 覆盖包结构、
   异步初始化、Texture 体系、Graphics API、Extension 体系，**未列 Canvas 移除**〔中〕
   （[PixiJS v8 迁移](https://pixijs.com/8.x/guides/migrations/v8)）。
   **这是一个可验证的文档缺口：移除发生在 v8，迁移指南没有为它单列一节。**

**官方 Bunnymark 基准（v7 vs v8）**〔中〕（[PixiJS v8 launches](https://pixijs.com/blog/pixi-v8-launches)）：

| 场景（10 万 sprite） | V7 CPU | V8 CPU | V7 GPU | V8 GPU |
| --- | --- | --- | --- | --- |
| 全都在动 | ~50ms | ~15ms | ~9ms | ~2ms |
| 全都不动 | ~21ms | **~0.12ms** | ~9ms | ~0.5ms |
| 场景结构变化 | ~50ms | ~24ms | ~9ms | ~2ms |

**代价（官方原文）**〔中〕（[PixiJS v8 迁移](https://pixijs.com/8.x/guides/migrations/v8)）：

- **API 破坏性变更**：Graphics 全面改写（`beginFill/drawRect/endFill` → `rect().fill()`）、
  `BaseTexture` 移除改为 TextureSource 体系、`Application` 必须 `await app.init()`
  （**异步初始化是 WebGPU 引入的强制要求**："With the introduction of the WebGPU renderer
  PixiJS will now need to be awaited before being used"）；
- **生态滞后**：v8 发布时 React / Spine 仍在迁移中，Pixi Layers 计划"不迁移、直接并入 v8"；
- **高级混合模式要额外引包**：`import 'pixi.js/advanced-blend-modes'`（21 种），
  且官方警告 "these are essentially filters at the core, so it's advisable not to overuse them
  to avoid potential slowdowns"〔中〕（[v8 launches](https://pixijs.com/blog/pixi-v8-launches)）。

### 6.2 Phaser 4：Canvas 还在，但官方判为 deprecated

Phaser 4 的官方迁移指南有独立一节 **"2. Canvas Renderer Deprecated"**〔高〕
（[Phaser v3→v4 迁移指南](https://cdn.jsdelivr.net/npm/phaser@4.1.0/skills/v3-to-v4-migration/SKILL.md)）：

> "**The Canvas renderer is still available but should be considered deprecated.** Canvas rendering
> **does not support any of the WebGL techniques used in v4's advanced rendering features**. As
> WebGL support is effectively baseline today, **we recommend WebGL for all new projects.**"

**Phaser 4 重写 WebGL 后端的破坏面（官方自陈）**〔高〕（同上）：

- **整个 v3 Pipeline 系统被删除**，换成 `RenderNode`。原因是架构性的：
  "Pipelines frequently held multiple responsibilities... and **each had to manage WebGL state
  independently, leading to conflicts where one pipeline could break another's assumptions.**"
- **所有自定义 WebGL pipeline 必须重写**；
- **禁止直接调用 `gl`**："Do not make direct WebGL `gl` calls in a Phaser v4 game. This can change
  the WebGL state without updating the internal `WebGLGlobalWrapper`, causing unpredictable behavior."
- **纹理坐标约定翻转**：v3 用 top-left，v4 全程改用 GL 约定（Y=0 在底部）。
  **后果：压缩纹理必须重新压缩（需要 "flip Y"），自定义 shader 的 UV 语义全部改变**；
- **`Math.TAU` 的值变了**（v3 是 PI/2，v4 是 2π）；
- `Mesh` / `Plane` 移除、`BitmapMask` 移除、`roundPixels` 默认值翻转、全部 legacy polyfill 移除。

**可迁移到本项目的教训**：**"改渲染后端"的破坏面远大于"改渲染后端"本身。**
坐标约定翻转会连带波及**纹理资产管线**与**所有自定义 shader**；
`Math.TAU` 这种"数学常量改值"会在静默情况下产出错误图像。
**这些都不是性能问题，是正确性事故。**

### 6.3 Godot：Compatibility vs Forward+ —— "保留一条低端路径"的代价清单

Godot 4 有三个 renderer〔高〕
（[Godot: Overview of renderers](https://docs.godotengine.org/en/stable/tutorials/rendering/renderers.html)）：
**Forward+**（最先进，仅桌面，Vulkan/D3D12/Metal，RenderingDevice 后端）、
**Mobile**（移动端默认，同 RenderingDevice 后端）、
**Compatibility**（最不先进，**Web 平台默认**，**OpenGL** 驱动）。

**官方选择建议里有一条直接针对 2D**：

> "Choose **Compatibility** if: … You are developing a **2D game** … You want the best performance
> possible on all devices and don't need advanced rendering features."〔高〕（同上）

**但官方同时留了反例**："you might want to use the Forward+ renderer for a 2D game,
**so you can use advanced features like compute shaders**."〔高〕（同上）

**Compatibility 的能力代价（官方对比表摘录）**〔高〕（同上）：

| 能力 | Compatibility | Mobile | Forward+ |
| --- | --- | --- | --- |
| **2D 渲染特性** | ✔️ Yes | ✔️ Yes | ✔️ Yes |
| **MSAA 2D** | **❌ Not supported** | ✔️ | ✔️ |
| FXAA / SMAA / TAA / FSR2 | ❌ 全不支持 | 部分 | 全部 |
| **Compute shaders** | **❌ Not supported** | ⚠️ | ✔️ |
| 自定义后处理（fullscreen quad） | ✔️ | ✔️ | ✔️ |
| 自定义后处理（CompositorEffects） | **❌ Not supported** | ✔️ | ✔️ |
| SSR / SSIL / SDFGI / 体积雾 | ❌ | ❌ | ✔️ |
| Glow / Tonemapping | ✔️ | ✔️ | ✔️ |
| SSAO | ✔️ | **❌** | ✔️ |
| 新的渲染特性 | ⚠️ **最后才加**（"Features are added after Mobile and Forward+"） | 通常同步 | ✔️ 最先 |
| 渲染成本 | **低基础成本，但高扩展成本** | 中/中 | 最高基础，低扩展 |
| **Web** | ✔️ | ❌ | ❌ |

**回退机制（4.4 起）**：Vulkan 不支持则回退 D3D12（反之亦然），
两者都不支持再回退 Compatibility〔高〕（同上）。

**代价的官方定性**：

> "**Switching between renderers may require some manual tweaks to your scene, lighting, and
> environment, since each renderer is different.** … switching between the Compatibility renderer
> and the Forward+ or Mobile renderers [requires more adjustments]."〔高〕（同上）

**这是"要不要维护两条后端"最有力的官方证据**：
**官方自己承认跨 renderer 的迁移成本真实且不对称，而且 Compatibility 会永久性地"最后拿到新特性"。**
即：**保留一条低端路径 = 承诺永久承担一条能力落后的分支及其迁移成本。**

### 6.4 独立开发者的 Canvas→WebGL 移植复盘：**未取得**

**本次取证未能取得任何可核对的独立（非引擎厂商）Canvas→WebGL 移植复盘文章。**
尝试与结果：搜索返回的候选多为**无法确认真实作者、原始出处与数据可靠性**的内容农场转载
（已明确排除、不予引用）；唯一取得正文的社区线程是 HTML5GameDevs 的
"Performance out of canvas"〔低〕（[HTML5GameDevs](https://www.html5gamedevs.com/topic/22383-performance-out-of-canvas/)），
但它是**提问求助帖**（三层 canvas + 页面 `text-shadow` 标题导致卡顿），**不是移植复盘、无量化数据**。

**结论：本小节为未取得。** 这本身是对报告可信度的诚实交代 ——
**"有没有人这么干过"这个问题，本次没有拿到可信答案，所以 [第十六节](#十六给-bronana-的建议)
的触发条件不建立在"别人的先例"上，只建立在本项目自己的实测上。**

### 6.5 三条案例的横向教训（综合，标为推断）

1. **三家（PixiJS / Phaser / Godot）无一例外都保留了不止一条路径，或到某个版本才合并**：
   PixiJS 从"WebGL + Canvas 双路"→ v8 收敛到"WebGL + WebGPU 双路"；
   Phaser 4 保留 Canvas 但标 deprecated；Godot 保留三条 renderer 并明说 Compatibility 最后拿新特性。
   **没有一家是"只留一条路"的。**
2. **收敛的动机是"新 API 的能力"，不是"旧 API 太慢"**：
   PixiJS v8 的驱动因素是 WebGPU（"not as an add-on to our existing WebGL renderer but as a
   **core paradigm**"）〔中〕（[v8 launches](https://pixijs.com/blog/pixi-v8-launches)）；
   Phaser 4 是"新 WebGL renderer + Filter 体系统一"；Godot 是 Vulkan/D3D12/Metal 的新特性。
   **性能是副产品，能力才是主线。**
3. **每次收敛的代价都落在"资产管线"和"自定义扩展"上，而不是落在游戏逻辑上**。
   **对本项目的直接映射**：`render.ts` / `sprites.ts` / `draw2d.ts` / `art_*.ts` / `bronana.ts`
   属于会被波及的层，而 **L4 及以下（sim 层）不受影响** ——
   **这正是本仓库"`sim` 层不许碰 DOM"这条纪律在架构决策上的价值：
   换渲染后端不会动到 64 套无头测试。**

---

## 七、零依赖自研引擎的渲染抽象层该长什么样

### 7.1 工业界的真实做法（可核对）

**Godot：RenderingServer / RenderingDevice 两层。** Forward+ 与 Mobile 都跑在
**RenderingDevice** 后端上，Compatibility 用 OpenGL〔高〕
（[Godot: Overview of renderers](https://docs.godotengine.org/en/stable/tutorials/rendering/renderers.html)）。
官方对层的定义：*rendering driver* 用某个图形 API 告诉 GPU 做什么；
**RenderingDevice 是 renderer 与 rendering driver 之间的抽象层**，
**其抽象层级与 WebGPU 相近**〔高〕
（[Godot: Internal rendering architecture](https://docs.godotengine.org/en/stable/engine_details/architecture/internal_rendering_architecture.html)）。
**关键细节：OpenGL driver 不使用 RenderingDevice 抽象** —— 也就是**为了多一个后端，
Godot 必须接受一条平行代码路径**〔高〕（同上）。

RenderingDevice 的 API 表面就是"抽象层里有什么"的实证：`texture_create`、
`vertex_buffer_create`、`index_buffer_create`、`shader_create_from_spirv`、
`render_pipeline_create`、`uniform_set_create`、`framebuffer_create`、
`draw_list_begin` / `draw_list_end`，资源以 **RID** 句柄表示并用 `free_rid()` 释放〔高〕
（[Godot: RenderingDevice](https://docs.godotengine.org/en/stable/classes/class_renderingdevice.html)）。
**同一时刻只能有一个活跃的 draw list**，必须先 `draw_list_end()`〔高〕（同上）。

**再上一层 RenderingServer 的定位（这句最重要）**：

> "The rendering server is the API backend for everything visible. The rendering server is
> completely opaque: the internals are entirely implementation-specific and cannot be accessed.
> The rendering server **can be used to bypass the scene/Node system entirely**."〔高〕
> （[Godot: RenderingServer](https://docs.godotengine.org/en/stable/classes/class_renderingserver.html)）

→ **渲染服务器与场景/节点系统是两件事，后者可以被完全绕过。**

**Unreal：RHI 与 RHI Thread。** Epic 官方：渲染线程把命令入队到命令列表，
"a new thread, the RHI Thread, translates (executes) them via the appropriate graphics API on the
backend"；RHI 是 "**our cross-platform interface into the different graphics APIs**"〔高〕
（[Unreal: Parallel Rendering Overview](https://dev.epicgames.com/documentation/en-us/unreal-engine/parallel-rendering-overview-for-unreal-engine)）。
接口实体是 `FDynamicRHI`（"The interface which is implemented by the dynamically bound RHI"），
派生类包括 `ID3D12DynamicRHI`、`IVulkanDynamicRHI`〔高〕
（[Unreal API: FDynamicRHI](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/RHI/FDynamicRHI)）。
`r.RHIThread.Enable` 可以把"命令记录 / 命令翻译 / 直调"三种路径都做成开关〔高〕（同上）。

**bgfx：9 个后端 + "Bring Your Own Engine"。** 自我定位为
"Cross-platform, graphics API agnostic, 'Bring Your Own Engine/Framework' style rendering library"，
后端共 **9 个**：D3D11、D3D12、GNM、Metal、OpenGL 4.3+、OpenGL ES 3.0+、Vulkan、WebGL 2.0、
WebGPU（仅 Dawn Native）〔高〕（[bgfx README](https://github.com/bkaradzic/bgfx)）。

**sokol_gfx：最典型的"最小后端抽象"样本。** 它自我描述为
"**simple, modern wrapper around GLES3/WebGL2, GL3.3, D3D11, Metal, and WebGPU**"，
提供 **buffers、images、shaders、pipeline-state-objects 与 render-passes**〔高〕
（[sokol README](https://github.com/floooh/sokol)）。后端编译期以宏选定，共 6 个真实后端 + 1 个 dummy
（`SOKOL_GLCORE` / `SOKOL_GLES3` / `SOKOL_D3D11` / `SOKOL_METAL` / `SOKOL_WGPU` / `SOKOL_VULKAN` /
`SOKOL_DUMMY_BACKEND`）〔高〕（[sokol_gfx.h](https://github.com/floooh/sokol/blob/master/sokol_gfx.h)）。

**它明确声明"不做什么"** —— 这是本节最有价值的一段原文，`sokol_gfx DOES NOT`：
**不创建 window / swapchain / context-device**（必须在初始化 sokol_gfx 之前自己做好并把 device 指针传进来）、
**不 present 渲染结果**、**不提供统一 shader 语言**（必须给 API 专属的 shader 源码或字节码）〔高〕（同上）。

**另一个对本项目极其实用的细节**：**dummy backend 用空 stub 替换平台后端代码，
"useful for writing tests that need to run on the command line"**〔高〕（同上）——
**这正是"零依赖、能在 Node 里跑无头测试"的项目应该抄的思路。**

sokol 作者本人的设计文补充：pipeline 对象把**约 25 项渲染状态**一次性绑定，
因此"没有游离的 render state"，GL 后端自带状态缓存、只做最少次数的 GL 调用；
资源池大小在 `sg_setup` 时固定，**之后不能扩容**〔中〕
（[A Tour of sokol_gfx.h](https://floooh.github.io/2017/07/29/sokol-gfx-tour.html)）。

**wgpu：句柄化资源 + 能力协商。** "a cross-platform, safe, pure-Rust graphics API. It runs natively
on Vulkan, Metal, D3D12, and OpenGL; and on top of WebGL2 and WebGPU on wasm"，
API **基于 WebGPU 标准**〔高〕（[wgpu README](https://github.com/gfx-rs/wgpu)）。
资源创建全是"设备方法返回资源句柄"的形状：`create_buffer` / `create_texture` /
`create_render_pipeline` / `create_command_encoder` / `create_bind_group`〔高〕
（[wgpu::Device](https://docs.rs/wgpu/latest/wgpu/struct.Device.html)）。
W3C 规范把句柄语义讲得更清楚：**"A handle object is returned immediately, but actual pipeline
creation is not synchronous."**〔高〕（[W3C WebGPU spec](https://www.w3.org/TR/webgpu/)）。
平台支持表分成 First Class 与 Downlevel/Best Effort 两档，并明确：macOS/iOS 的 Vulkan 需要
**MoltenVK**、Windows/macOS 的 GL 需要 **ANGLE**〔高〕（[wgpu README](https://github.com/gfx-rs/wgpu)）。

**three.js：工业代码里"共用基类 + 可替换 backend"到底怎么写。** `WebGPURenderer` 源码注释：

> "This renderer is the new alternative of `WebGLRenderer`. `WebGPURenderer` has the ability to
> target different backends. By default, the renderer tries to use a WebGPU backend if the browser
> supports WebGPU. If not, `WebGPURenderer` falls back to a WebGL 2 backend."〔高〕
> （[three.js WebGPURenderer.js](https://github.com/mrdoob/three.js/blob/dev/src/renderers/webgpu/WebGPURenderer.js)）

实现是 `class WebGPURenderer extends Renderer`，构造时按 `forceWebGL` 选 `WebGLBackend` 或
`WebGPUBackend`，并为后者安装 `getFallback()`〔高〕（同上）。
**代价也随之写进官方迁移指南**：WebGPU 导入改 `three/webgpu` 入口；`WebGPURenderer` **必须先 init**；
`WebGLCubeRenderTarget` **不能再与它同用**；节点材质**只能**配 `WebGPURenderer`；
`WebGLRenderer` 不再支持 WebGL 1〔高〕
（[three.js Migration Guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide)）。
**这两份来源合起来就是"特性泄漏"的一手证据。**

**PixiJS：与 2D 项目最接近的形状。**

> "PixiJS renderers are responsible for drawing your scene to a canvas using either WebGL/WebGL2 or
> WebGPU"；"All PixiJS renderers **inherit from a common base**, which provides consistent methods
> such as `.render()`, `.resize()`, and `.clear()`, as well as shared systems for managing the
> canvas, texture GC, events, and more."〔高〕
> （[PixiJS: Renderers](https://pixijs.com/8.x/guides/components/renderers)）

三档后端是 `WebGLRenderer`（默认、稳定、推荐）、`WebGPURenderer`（"still maturing"、实验）、
`CanvasRenderer`（**尚未提供**）〔高〕（同上）。并明确警告：

> "inconsistencies in browser implementations may lead to unexpected behavior.
> **It is recommended to use the WebGL renderer for production applications.**"〔高〕（同上）

**注意其分层**：renderer 基类管 render/resize/clear + canvas/纹理 GC/事件，
而**场景图（`Container`/`Sprite`/`Application.stage`）是另一套子系统**〔高〕（同上）。

**SDL3 的 SDL_GPU：当代"刻意最小 + 刻意最低公分母"的官方设计。** 对象是 `SDL_GPUDevice`、
`SDL_GPUBuffer`、`SDL_GPUTexture`、`SDL_GPUShader`、`SDL_GPUGraphicsPipeline`、
`SDL_GPUCommandBuffer`、`SDL_GPURenderPass`〔高〕（[SDL3 CategoryGPU](https://wiki.libsdl.org/SDL3/CategoryGPU)）。
设计目标原文：

> "The GPU API targets a feature set with a wide range of hardware support and ease of portability.
> **It is designed so that the app won't have to branch itself by querying feature support.**
> If you need cutting-edge features with limited hardware support, this API is probably not for you."〔高〕（同上）

性能铁律对抽象层设计者极其关键：**开一个新 render pass 相对昂贵，尽量少开；尽量减少状态切换；
不要反复创建销毁资源**（"Don't churn resources"），黄金法则是
"doing things is more expensive than not doing things. **Don't Touch The Driver!**"〔高〕（同上）。

SDL 官方 wiki 收录的 SIGGRAPH 2025 圆桌把动机讲得最直白：小团队长期维护
DX12 + Vulkan + Metal 三套渲染器 "not reasonable"，多数团队没有全职图形工程师；
设计目标是 "**there should only be one way to do something**"；
**故意不支持**统一内存架构上的"瞬间拷贝"这类特性，因为那会迫使应用写两条代码路径；
bindless 被以"会出现两种做事方式、更复杂、更容易崩、更难调试"为由拒绝；
mesh shader 的准入门槛是"99% 现存硬件支持"，而当时只有约 30%；
对运行时的态度是 "**We don't expose any of the internals.**"〔高〕
（[SDL SIGGRAPH 2025 Panel Transcript](https://github.com/libsdl-org/sdlwiki/blob/main/SDL3/SIGGRAPH2025PanelTranscript.md)）

### 7.2 横向对照（全部由上面已引来源合成）

| 项目 | 后端数 | 抽象层名 | 自建 command buffer | 管窗口 / context |
| --- | --- | --- | --- | --- |
| Godot | 4 driver / 3 renderer〔高〕 | RenderingDevice〔高〕 | 是（draw_list / compute_list）〔高〕 | 引擎自管 |
| Unreal | 各平台 RHI 实现〔高〕 | RHI / FDynamicRHI | 是（FRHICommandList + RHI Thread）〔高〕 | 引擎自管 |
| bgfx | 9〔高〕 | bgfx API | 内部机制**未取得** | 由使用者（BYOE）〔高〕 |
| **sokol_gfx** | 6 + dummy〔高〕 | sokol_gfx | **否**（pass/apply/draw 即时提交）〔高〕 | **否**〔高〕 |
| wgpu | Vulkan/Metal/DX12/GL/WebGPU〔高〕 | wgpu（基于 WebGPU 标准） | 是（CommandEncoder）〔高〕 | 否（由 winit 等承担） |
| three.js | WebGL2 / WebGPU〔高〕 | `Renderer` 基类 + backend | **否**（renderer.render 即时提交）〔高〕 | 由 renderer 管 canvas |
| PixiJS | WebGL2 / WebGPU（+ 规划中的 Canvas）〔高〕 | `AbstractRenderer` 基类 | 否 | 由 renderer 管 canvas〔高〕 |
| SDL_GPU | Vulkan / Metal / D3D12〔中〕 | SDL_GPU | 是（`SDL_GPUCommandBuffer`）〔高〕 | **否**（可无窗口）〔高〕 |

**读法**：**"最像本项目的那两个"（sokol_gfx、PixiJS）都没有自建 command buffer。**
自建 command buffer 是给"要并行录制、要跨帧复用"的吞吐型渲染器准备的
（NVRHI / Diligent / Unreal 都是这个档次），**290~3000 次/帧的 2D 项目用不上（推断）。**

### 7.3 抽象层的代价：最低公分母是**被设计出来的**，不是意外

- **SDL_GPU 的最低公分母是明写的**：目标就是"特性集覆盖广、可移植"，
  官方直接写"如果你要有限硬件支持的前沿特性，这个 API 大概不适合你"；
  光追与 mesh shader 没有近期计划；bindless 被拒绝〔高〕
  （[SDL3 CategoryGPU](https://wiki.libsdl.org/SDL3/CategoryGPU)、
  [SIGGRAPH 2025 Panel](https://github.com/libsdl-org/sdlwiki/blob/main/SDL3/SIGGRAPH2025PanelTranscript.md)）。
- **Godot 的最低公分母是以 renderer 分层呈现的**：官方给出 Forward+/Mobile/Compatibility
  的特性对照表，并声明"这不是完整清单"；Compatibility 明确 "least advanced"，
  且 **Web 平台唯一可选**〔高〕（[Godot: Overview of renderers](https://docs.godotengine.org/en/stable/tutorials/rendering/renderers.html)）。

**特性泄漏（feature leak）是双向的：**

- **向下泄漏（抽象层挡不住底层差异）**：NVRHI 的编程指南里有一条硬事实 ——
  "**local binding layouts and sets are not supported on Vulkan because Vulkan does not have a
  concept of local bindings**"〔高〕
  （[NVRHI ProgrammingGuide](https://github.com/NVIDIAGameWorks/nvrhi/blob/main/doc/ProgrammingGuide.md)）。
  SDL 侧的一手说明更狠："creating pipeline objects contains backend-specific quirks. For example,
  in most APIs compute shader workgroup size is provided in the shader bytecode. **On Metal, the
  client is expected to provide this information at dispatch time.** Devising a singular interface
  that can accommodate all these discrepancies has been a **significant challenge**."〔中〕
  （[Layers All The Way Down](https://moonside.games/posts/layers-all-the-way-down/)）
- **向上泄漏（抽象层挡不住上层代码差异）**：Godot 官方承认切换 renderer 要改场景/光照/环境〔高〕
  （[Overview of renderers](https://docs.godotengine.org/en/stable/tutorials/rendering/renderers.html)）；
  three.js 迁移指南列了一批"只在某一个后端可用"的东西〔高〕
  （[Migration Guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide)）。
- **"统一抽象"这个承诺本身在着色器上就破产了**：SDL 的 shader 创建必须同时给出**格式与代码**，
  格式枚举包含 SPIRV / HLSL / DXBC / DXIL / MSL / METALLIB，即**每个后端要各自的格式**〔中〕
  （[Layers All The Way Down](https://moonside.games/posts/layers-all-the-way-down/)）。
  作者自己的结论："You could argue that having to provide different shader formats for different
  backends means that the API isn't truly portable - **but a solution that doesn't exist is the least
  portable of all.**"〔中〕（同上）

**间接层与"自建句柄"的代价**〔高〕：

- **必须自己设计句柄与生命周期**：Godot 用 RID 并要显式 `free_rid()`；wgpu 的资源就是
  句柄对象；WebGPU 明确"句柄立即返回、真实创建不同步"（三处来源见 7.1）。
- **NVRHI 的命令列表在 DX12/Vulkan 上不与 GAPI 命令列表 1:1 对应**：
  一个 NVRHI 命令列表通常持有多个 GAPI 命令列表并轮转使用；
  上传 / scratch 管理器**从不缩小工作集**，想释放内存只能销毁并重建该命令列表〔高〕
  （[NVRHI ProgrammingGuide](https://github.com/NVIDIAGameWorks/nvrhi/blob/main/doc/ProgrammingGuide.md)）。

**"抽象层到底多慢"的具体数字：未取得。** 只找到定性表述（NVRHI 自称
"little runtime overhead"、SDL 自称 "relatively thin layer"）〔高〕（两处来源同上）。

### 7.4 什么该进抽象、什么绝对不能进

**该进（有来源支撑）：**

| 职责 | 证据 |
| --- | --- |
| **资源：buffer / texture** | Godot `vertex_buffer_create` / `texture_create`〔高〕；wgpu `create_buffer` / `create_texture`〔高〕；sokol "buffers, images"〔高〕 |
| **pipeline / render state 对象** | sokol 的 pipeline 打包约 25 项状态〔中〕；Godot `render_pipeline_create`〔高〕；wgpu `create_render_pipeline`〔高〕 |
| **shader 对象** | Godot `shader_create_from_spirv`〔高〕；SDL 必填 shader 格式〔高〕；WebGL `createShader` / `createProgram`〔高〕 |
| **绑定组 / uniform 集合** | Godot `uniform_set_create`〔高〕；wgpu `create_bind_group`〔高〕；NVRHI binding layout/set〔高〕 |
| **render target / framebuffer** | Godot `framebuffer_create`〔高〕；WebGL `createFramebuffer`〔高〕 |
| **command list / pass 的 begin-end** | Godot `draw_list_begin`/`end`〔高〕；wgpu `create_command_encoder`〔高〕；NVRHI `open()`/`close()`〔高〕；sokol `sg_begin_pass`〔高〕 |
| **draw 提交** | sokol `sg_draw(0,3,1)`〔高〕；WebGL `drawArrays`/`drawElements`〔高〕 |
| **资源生命周期与释放** | Godot `free_rid()`〔高〕；NVRHI 自动生命周期 + 延迟销毁〔高〕 |
| **能力 / 限制查询** | WebGPU 规范定义 features/limits〔高〕；wgpu 支持表分 First Class 与 Downlevel〔高〕 |
| 多线程 / 并行录制（**可选**） | NVRHI、Diligent、Unreal 都有〔高〕；**但 2D / 300 draw call 用不上（推断）** |

**绝对不能进（有来源支撑）：**

- **场景图 / 节点系统**：Godot 明确 RenderingServer "**can be used to bypass the scene/Node system
  entirely**"〔高〕（[RenderingServer](https://docs.godotengine.org/en/stable/classes/class_renderingserver.html)）；
  PixiJS 的 renderer 基类只提供 render/resize/clear 与 canvas、纹理 GC、事件〔高〕
  （[PixiJS: Renderers](https://pixijs.com/8.x/guides/components/renderers)）。
- **可见性剔除 / 排序 / 材质 / 序列化**：gfx-rs 的架构讨论里这些被明确划为"设备抽象之上的另一层"——
  "I don't think it should get much higher level than a graphics device abstraction.
  **The next step is to build on top of gfx.**"〔低〕（[gfx-rs#125](https://github.com/gfx-rs/gfx/issues/125)）
- **批次化策略**：MDN 的批次 / 图集建议是**应用侧**优化手段〔高〕
  （[MDN best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)）。
  **"因此它属于上层"这一步是推断。**
- **资源格式 / 资产管线**：SDL 把"shader 即内容"作为立场，编译与转换交给构建期工具〔高/中〕
  （[SDL3 CategoryGPU](https://wiki.libsdl.org/SDL3/CategoryGPU)、[Layers All The Way Down](https://moonside.games/posts/layers-all-the-way-down/)）。
- **模拟 / 玩法状态**：本次检索范围内**没有任何来源**主张把它放进渲染抽象 ——
  **这条属常识性边界，标记为未取得（无来源支持也无来源反驳）。**

**一条 MDN 的硬约束（与"300 draw call / 帧"直接相关）**：
"**If you have 1000 sprites to paint, try to do it as a single `drawArrays()` or `drawElements()`
call**"；用 **texture atlasing** 减少批次切换；静态 VAO 复用比反复改同一个 VAO 快
（浏览器可缓存 fetch limits，改 VAO 要重新校验）〔高〕
（[MDN: WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)）。

**结论（推断）**：**批次化策略必须留在抽象层之上，抽象层只负责"不要把批次化变得不可能"**
（例如允许同一 pipeline / 同一纹理连续多次 draw、不要在每个 draw 之间强制 flush 或重建绑定）。

### 7.5 【关键交付物】零依赖项目的最小可行渲染抽象

**前提（本项目实况）**：纯 TypeScript + 原生 ES 模块，无 gl-matrix / 无 PixiJS，
手写 WebGL2 或 Canvas2D，接口坐在 **290~3000 次 draw/帧** 的调用方与后端之间。

**七条设计立场（每条对应上面已成来源的结论）：**

1. **句柄化资源，不暴露 GL 对象** ← Godot RID / wgpu handle / WebGPU spec〔高〕
2. **显式 pass / draw 序列** ← sokol `sg_begin_pass → apply_pipeline → apply_bindings → draw`〔高〕
3. **不创建 context、不 present** ← sokol `DOES NOT` 清单 / NVRHI device 由应用创建〔高〕
4. **pipeline 打包全部渲染状态** ← sokol 约 25 项状态、无游离 render state〔中〕；
   **状态切换成本要在抽象层内部被脏检查缓存掉** ← SDL "Minimize the amount of state changes"〔高〕
5. **shader 由后端专属代码提供，不做跨翻译** ← sokol / SDL〔高/中〕
6. **批次化、剔除、材质、场景图全部在上层** ← Godot RenderingServer / gfx-rs#125〔高/低〕
7. **dummy / 无头后端** ← sokol dummy backend〔高〕

**接口清单**（**以下命名与签名是 推断 / 无直接来源的合成**；每一组的*职责*有 7.4 节的来源）：

```ts
// ============ 句柄与描述符（推断） ============
export type Handle = number;                 // 0 保留为 INVALID，句柄由后端分配
export type BufferUsage  = 'vertex' | 'index' | 'uniform';
export type TextureUsage = 'sample' | 'render';
export type IndexFormat  = 'u16' | 'u32';
export type BlendMode    = 'none' | 'alpha' | 'add';   // 2D 项目只需这三种
export type Primitive    = 'triangles' | 'lines';

export interface Caps {
  readonly backendName: 'webgl2' | 'canvas2d' | 'null';
  readonly maxTextureSize: number;
  readonly maxTextureUnits: number;
  readonly supportsUint32Index: boolean;
  readonly supportsInstancing: boolean;
  readonly supportsVertexArrayObject: boolean;
}

export interface BufferDesc      { usage: BufferUsage; sizeBytes: number; data?: ArrayBufferView; dynamic?: boolean; }
export interface TextureDesc     { width: number; height: number; usage: TextureUsage; pixels?: ImageData | null; nearest?: boolean; }
export interface RenderTargetDesc{ width: number; height: number; withDepth?: boolean; }
export interface ShaderDesc      { vertex: string; fragment: string; attributes: string[]; uniformNames: string[]; }
export interface PipelineDesc    {
  shader: Handle;
  attributeFormats: Array<'f32' | 'f32x2' | 'f32x3' | 'f32x4' | 'u8x4'>;
  primitive: Primitive;
  blend: BlendMode;
  depthTest?: boolean;
}
export interface PassDesc        { clearColor?: readonly [number, number, number, number]; viewport?: readonly [number, number, number, number]; }
export interface DrawDesc        { first: number; count: number; instances?: number; }
export interface DrawIndexedDesc { indexCount: number; firstIndex?: number; baseVertex?: number; instances?: number; }

// ============ 设备与帧（推断） ============
export interface Rhi {
  // --- 生命周期 / 能力：抽象层**不**创建 window 或 GL context ---
  init(gl: WebGL2RenderingContext | null, capsOverride?: Partial<Caps>): void;
  readonly caps: Caps;
  resize(pixelWidth: number, pixelHeight: number): void;
  dispose(): void;

  // --- 帧：唯一允许提交的窗口 ---
  beginFrame(): void;
  endFrame(): void;

  // --- pass / render target ---
  createRenderTarget(d: RenderTargetDesc): Handle;
  beginPass(target: Handle | 0 /* 0 = 屏幕 */, d?: PassDesc): void;
  endPass(): void;

  // --- 资源 ---
  createBuffer(d: BufferDesc): Handle;
  writeBuffer(h: Handle, byteOffset: number, data: ArrayBufferView): void;
  createTexture(d: TextureDesc): Handle;
  createShader(d: ShaderDesc): Handle;
  createPipeline(d: PipelineDesc): Handle;
  destroy(h: Handle): void;                 // 统一释放入口，替代 Godot 的 free_rid

  // --- 绑定与状态（内部做脏检查缓存） ---
  bindPipeline(h: Handle): void;
  bindVertexBuffer(slot: number, h: Handle, byteOffset?: number): void;
  bindIndexBuffer(h: Handle, format: IndexFormat): void;
  bindTexture(slot: number, h: Handle): void;
  setUniform1f(name: string, v: number): void;
  setUniform2f(name: string, x: number, y: number): void;
  setUniform4f(name: string, x: number, y: number, z: number, w: number): void;
  setUniformMatrix3(name: string, m: Float32Array): void;
  setScissor(x: number, y: number, w: number, h: number): void;

  // --- 提交 ---
  draw(d: DrawDesc): void;
  drawIndexed(d: DrawIndexedDesc): void;

  // --- 读回（可选，主要给快照 / 测试） ---
  readPixels?(x: number, y: number, w: number, h: number, out: Uint8Array): void;
}
```

**方法总数约 25 个**，与 sokol_gfx 的"buffers / images / shaders / pipelines / passes"
五类资源 + 少量动词同量级〔高〕（[sokol README](https://github.com/floooh/sokol)）。

**Canvas2D 后端怎么落（推断，无直接来源）**：按同一接口实现时**只能在语义上兼容、
不能指望行为一致** —— `createBuffer` / `createPipeline` 退化为记录元数据的空操作；
`beginPass` / `endPass` 变成设裁剪与清屏；`draw` / `drawIndexed` 退化为按当前纹理/顶点数据的即时填充；
`createShader` 直接报错（Canvas2D 无 shader）。

> ⚠ **本次检索没有找到任何"用同一 RHI 接口同时支撑 WebGL2 与 Canvas2D"的权威先例。**
> PixiJS 的 `CanvasRenderer` 在官方文档中标为 "Coming-soon"〔高〕
> （[PixiJS: Renderers](https://pixijs.com/8.x/guides/components/renderers)）；
> three.js 早已移除 `CanvasRenderer`〔高〕（[Migration Guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide)）。
> **这条属于纯合成建议，[第十六节](#十六给-bronana-的建议) 会据此把它从"双后端"降级为"单后端 + 可换"** ——
> 这是本次调研**推翻我自己初始设想**的一处。

---

## 八、引擎与游戏内容分离：主流做法

### 8.1 Unity：Assets / Packages + Assembly Definitions

| 项 | 内容 | 来源 |
| --- | --- | --- |
| 包内代码必须显式汇编 | "the Editor **ignores scripts inside the `Packages` folder unless they're part of an assembly definition**" | 〔高〕[Unity: cus-asmdef](https://docs.unity3d.com/Manual/cus-asmdef.html) |
| 包内代码必须分汇编 | "Any code in your package must be organized into one or more assemblies using assembly definition files (`.asmdef` assets)." | 〔高〕[Unity: Package development workflow](https://docs.unity3d.com/Manual/CustomPackages.html) |
| **Unity 明文禁止的引用** | ① 用 asmdef 建的自定义汇编**不能**引用 predefined assemblies；② predefined assemblies **不能**做显式引用；③ 禁止**循环引用** | 〔高〕[Unity: Referencing assemblies](https://docs.unity3d.com/Manual/assembly-definitions-referencing.html) |
| 依赖方向 | "Unity doesn't allow … **References from custom assemblies created with an Assembly Definition to the predefined assemblies.**"；且 **Runtime 代码不得引用 Editor 代码**，包内 Editor 汇编**必须**显式引用 Runtime 汇编，反向不行 | 〔高〕[Referencing assemblies](https://docs.unity3d.com/Manual/assembly-definitions-referencing.html) |
| 依赖方向的可读性 | "因为 Main 引用 Stuff 而不是反过来，所以你知道对 Main 代码的改动不可能影响 Stuff 里的代码" | 〔高〕[Introduction to assemblies](https://docs.unity3d.com/Manual/assembly-definitions-introduction.html) |
| 编译顺序 | 由依赖决定，**不可手工指定** | 〔高〕同上 |
| 「何时该做 package」的判据 | **未取得**（官方页只给工作流与前置条件） | 〔高〕[CustomPackages](https://docs.unity3d.com/Manual/CustomPackages.html) |

**小结（推断）**：Unity 的分层不靠目录约定，靠**汇编 + 单向引用声明**强制。
「引擎 vs 内容」在 Unity 里最接近的硬边界是 **predefined assemblies 只能被引用、不能引用别人** ——
即"**后建的（game）可以知道先建的，反之不行**"。

### 8.2 Godot：源码树分层（以及它的**反面教材**）

| 层 | 职责 |
| --- | --- |
| `/core` | 基础数据结构与算法、核心 API、内建类型、Object/Reference/Resource、ClassDB 与反射、脚本、网络、IO |
| `/servers` | 低层高性能接口与实现（渲染、物理、音频、窗口、导航、相机、XR），线程化 |
| `/scene` | 使用 `/core` 与 `/servers` 的高层游戏框架：SceneTree、Node/Node2D/Spatial |
| `/main` | 通用平台操作、启动与主循环、命令行参数 |
| `/editor` | 一个 C++ 写的"特权 Godot 游戏"；**只许依赖 Core，不许引用 `/modules`** |
| `/modules` | 可选功能，编译期加/减；`main` 依赖几乎所有东西 |

〔中，社区整理〕（[Godot Repository Organization](https://github.com/willnationsdev/deconstructing-godot/blob/master/repo_organization.md)）

**"core 不得依赖 scene"这条规则的官方成文出处：未取得**
（`docs.godotengine.org` 相关页 404 / 正文被导航淹没）。但拿到了一条**更有价值的反面证据** ——
Godot 官方 issue：

> "Pretty much everything uses code from core/；**core/ depends on code from scene/, servers/, main/,
> and modules/**；servers/ depends on scene/ and modules/；scene/ depends on modules/；
> main/ depends on pretty much everything"〔高〕
> （[godotengine/godot#108429 "Circular dependencies between core libraries"](https://github.com/godotengine/godot/issues/108429)）

该 issue 是 bug 标签、2025-07-09 开、至今 open，并明说
"**The circular dependencies means that there is no correct way to list these libraries in a correct
order on the command line**"〔高〕（同上）—— 即**环形依赖已经在链接期造成真实构建失败**。

**这是本次调研对 Bronana 最重要的一条外部证据**：
**一个用户数以百万计的引擎，在没有机器门守着分层的地方，照样长出了环形依赖。**
本仓库现在"**依赖环 0、向上的边 2 条（都已登记理由）**"是靠 `tools/systems.cjs` +
`test/arch.mjs` **守着**才有的。**结论：分层不是写一次文档就成立的，是有门才成立的。**

**modules 的依赖纪律（可操作）**〔中〕（[repo_organization.md](https://github.com/willnationsdev/deconstructing-godot/blob/master/repo_organization.md)）：
"If a module needs Editor, wrap in `#ifdef TOOLS_ENABLED`；If a module needs module,
refactor to submodules"。

### 8.3 Bevy：crate 级分层

| 项 | 内容 | 来源 |
| --- | --- | --- |
| 顶层是容器 crate | "The `bevy` crate is a **container crate** that makes it easier to consume Bevy subcrates."；根模块除 prelude 外，每个模块就是 crates.io 上的 `bevy_` + 模块名 | 〔高〕[docs.rs/bevy](https://docs.rs/bevy/latest/bevy/) |
| 层名（节选） | `bevy_ecs`、`bevy_app`（"everything concerning the **highest-level, application layer**"）、`bevy_math`、`bevy_asset`、`bevy_render`、`bevy_sprite`、`bevy_ui`、`bevy_audio`、`bevy_input`、`bevy_window`、`bevy_scene`、`bevy_state`、`bevy_transform`、`bevy_time` | 〔高〕同上 |
| 依赖方向怎么编码 | 每层是独立 crate，方向由 **Cargo 依赖声明**决定；更有说服力的是**裁剪方式**：`default-features = false` 按 crate 组开关，`default_app` = "The core pieces that most apps need … also useful as a baseline for **headless apps** (ex: command line tools, servers)"，且 `common_api` "does not include an actual renderer" | 〔高〕同上 |
| **引擎与游戏同构** | "**All Bevy engine features are implemented as plugins** … but **games themselves are also implemented as plugins!**"；"Don't need a UI? Don't register the `UiPlugin`. Want to build a headless server? Don't register the `RenderPlugin`." | 〔高〕[Bevy: Plugins](https://bevy.org/learn/quick-start/getting-started/plugins/) |
| 分层的最强表述 | 渲染侧被切成 **Main App** 与 **Render App**（各有独立 ECS World 与 Schedule），并规定 "drawing hard lines between 'app logic' and 'render logic', with a fixed synchronization point (which we call the **'extract' step**)" | 〔高〕[Bevy 0.6](https://bevy.org/news/bevy-0-6/) |
| 设计目标 | "**Modular**: Use only what you need. Replace what you don't like." | 〔高〕[Bevy: Introduction](https://bevy.org/learn/quick-start/introduction/) |

**小结（来源）**：Bevy 用"**每个方向一个 crate**"把依赖方向写进了 `Cargo.toml`；
`bevy_app` 是 highest-level application layer，`bevy_ecs`/`bevy_math` 在下、`bevy_render` 在中；
且**"引擎功能"与"游戏"在类型系统里没有区别 —— 都是 `Plugin`**。

### 8.4 Unreal：Engine/ 与 Game/ 模块

| 项 | 内容 | 来源 |
| --- | --- | --- |
| Module 是什么 | "**Modules** are the basic building block of Unreal Engine's software architecture … each game is made up of one or more **gameplay modules**" | 〔高〕[Unreal: Modules](https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-engine-modules) |
| 依赖声明在哪 | 每个模块根目录必须有 `[ModuleName].Build.cs`，用 `PrivateDependencyModuleNames` / `PublicDependencyModuleNames` 声明；UBT **不看 IDE solution** | 〔高〕同上 |
| Public/Private 语义 | `Private/` 的头文件**不暴露**给模块外；`Public/` 对所有依赖该模块者可见；**"your game's primary module, which will likely be at the end of the dependency chain"** | 〔高〕同上 |
| 引擎 vs 游戏的依赖方向 | 游戏模块把 `Core`/`CoreUObject`/`Engine` 加进自己的依赖，再由**项目主模块**把新模块加进 `PublicDependencyModuleNames` | 〔高〕[Creating a Gameplay Module](https://dev.epicgames.com/documentation/en-us/unreal-engine/how-to-make-a-gameplay-module-in-unreal-engine) |
| **「引擎不得依赖游戏」的明文禁令** | **未取得。** 官方只给机制（单向声明 + 依赖链裁剪 + 主模块在末端），**没有成文禁令**；官方反而承认支持交叉依赖："We do support creating modules that are cross-dependent … but this is not ideal for compile-times and may sometimes cause problems with static initialization" | 〔高〕[Gameplay Modules](https://dev.epicgames.com/documentation/en-us/unreal-engine/gameplay-modules-in-unreal-engine) |

**小结（推断）**：Unreal 给的是**机制**，不是禁令；
「引擎不依赖游戏」在 Unreal 里是**约定**，不是编译器强制，且有官方承认的反例。

### 8.5 「引擎不该知道游戏规则」这句话的来源

| 出处 | 抓到的原话 | 来源 |
| --- | --- | --- |
| Game Programming Patterns：Decoupling Patterns 章 | "A powerful tool we have for making change easier is **decoupling**. When we say two pieces of code are 'decoupled', we mean a change in one usually doesn't require a change in the other."；本章三模式：Component / Event Queue / Service Locator | 〔高〕[decoupling-patterns.html](https://gameprogrammingpatterns.com/decoupling-patterns.html) |
| 同上：Component | Intent: "**Allow a single entity to span multiple domains without coupling the domains to each other.**"；"As much as possible, we don't want **AI, physics, rendering, sound** and other domains to know about each other" | 〔高〕[component.html](https://gameprogrammingpatterns.com/component.html) |
| 同上：Service Locator | Intent: "Provide a global point of access to a service **without coupling users to the concrete class that implements it**"；"The technique this uses is called **dependency injection**" | 〔高〕[service-locator.html](https://gameprogrammingpatterns.com/service-locator.html) |
| Bevy 官方 | "All Bevy engine features are implemented as plugins … **but games themselves are also implemented as plugins!**" —— 即**引擎只定义"可被注册的能力"，游戏反向注册进引擎** | 〔高〕[Bevy: Plugins](https://bevy.org/learn/quick-start/getting-started/plugins/) |
| Bevy 官方（渲染分层） | "It is a good rule of thumb to **extract only the minimum amount of data needed for rendering**" | 〔高〕[Bevy 0.6](https://bevy.org/news/bevy-0-6/) |
| Bevy 官方（ECS） | "The ECS pattern encourages **clean, decoupled designs** by forcing you to break up your app data and logic into its core components." | 〔高〕[Introducing Bevy 0.1](https://bevy.org/news/introducing-bevy/) |

**必须点明的缺口**：

1. **bevyengine.org 上的 "What is a Game Engine?" 一文：未取得。**
   抓取 [bevy.org/learn/](https://bevy.org/learn/) 索引页，只有 Quick Start / Migration Guides /
   API Docs / Contributing / Examples / Assets / Web Examples / Errors / FAQ 九个入口，
   **没有该标题的文章**。
2. **Jason Gregory《Game Engine Architecture》正文：未取得。**
   尝试的两个 PDF（密歇根镜像、GBV 目录）分别 `fetch failed` 与 **HTTP 429**，
   未能抓到任何正文；**本报告不使用其任何内容。**
3. 因此，「**引擎不得知道游戏规则**」这句**作为名言的原始出处：未取得**。
   能提供的是**同义且可抓取**的表述：Component 的 intent（域之间互不知道）+
   Service Locator 的依赖注入 + Bevy「游戏也是插件」。

### 8.6 【可操作判据】一个模块属于引擎还是内容

> 本节是**综合（synthesis）**：把 8.1~8.5 的机制与原则转成可执行检查项。
> 每条标**来源**（有页面直接支持）或**推断**。

| # | 判据 | 判定 | 性质 |
| --- | --- | --- | --- |
| **a** | **依赖方向**：被更高层 import 而自身不反向 import 上层 → 偏引擎/更底层 | 引擎 | **来源**：Godot 依赖树〔中〕；Unreal "primary game module … at the **end** of the dependency chain"〔高〕 |
| **a′** | **反向边出现即告警**：低层 → 高层的边会让依赖图退化成环，**Godot 的实例证明它会在链接期爆炸** | 架构缺陷 | **来源**〔高〕[godot#108429](https://github.com/godotengine/godot/issues/108429) |
| **a″** | **向上依赖必须逐条登记**（本仓库 `systems.cjs` 的 `EXCEPTIONS` 做法） | 工程实践 | **推断**（本仓库既有约定） |
| **b** | **模块里是否出现游戏专有名词 / ID / 表**（具体货币名、具体物品 id、具体敌种名） | 出现即越界 | **推断**（可由 Component 的 intent 直接推出）〔高〕[component.html](https://gameprogrammingpatterns.com/component.html) |
| **c** | **能否原样发货给另一个游戏**：能 → 偏引擎；要改 → 偏内容 | 引擎 / 内容 | **推断**；与 Unity "package 可给多个工程甚至社区用" 一致〔高〕[CustomPackages](https://docs.unity3d.com/Manual/CustomPackages.html) |
| **d** | **改一个平衡数字是否要动它**：要动 ⇒ 它是内容 / 数据表 | 内容 | **推断** |
| **e** | **是否 import 游戏数据表**（`data_*` / 曲线表）：import 了 ⇒ 它坐在数据表之上 | 非引擎层 | **推断** |
| **f** | **能否在没有游戏数据的情况下测试**：Bevy 把"headless 且无渲染"明确设计成受支持形态；Unreal 有 `bCompileAgainstEngine`（"Disabled only when building standalone apps that only link with Core"） | 能无游戏数据测试是引擎层的**设计目标** | **来源**〔高〕[docs.rs/bevy](https://docs.rs/bevy/latest/bevy/)、[UBT Target Reference](https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-engine-build-tool-target-reference) |
| **g** | **模块名是否以体裁 / 机制命名** | 内容 | **推断** |
| **h** | **是否位于游戏入口点之下**：入口在依赖链末端，"被入口依赖"是**必要不充分** | 只是必要条件 | **来源**（末端）＋**推断**（不等价） |
| **i** | **Godot 式硬边界**：想可选编译 → 做成 module，且模块内不得引用 Editor（需 Editor 要 `#ifdef TOOLS_ENABLED`） | 可选层 | **来源**〔中〕[repo_organization.md](https://github.com/willnationsdev/deconstructing-godot/blob/master/repo_organization.md) |
| **j** | **Unity 式硬边界**：若是"包"，必须有 `.asmdef`，不得引用 predefined assemblies、不得循环引用 | 包内层 | **来源**〔高〕[cus-asmdef](https://docs.unity3d.com/Manual/cus-asmdef.html)、[Referencing assemblies](https://docs.unity3d.com/Manual/assembly-definitions-referencing.html) |
| **k** | **Unreal 式暴露边界**：`Private/` 对模块外不可见 | 暴露面 = 依赖面 | **来源**〔高〕[Unreal: Modules](https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-engine-modules) |

**压成一句话（推断，Synthesis）**：**「先看边，再看词，最后看可替换性」**

1. **边**决定层次（a、a′、h、i、j、k）—— **这是唯一有机器可验证性的判据，四个引擎都用它**；
2. **词**暴露内容（b、g）—— 引擎层出现游戏名词就是越界；
3. **可替换性 / 可测性**决定它值不值得当引擎（c、d、e、f）。

其中 **d（平衡改数要不要动它）与 f（能否无游戏数据测试）是最便宜的两个判据**：
前者一次 diff 就能看出，后者一次 test 就能看出 —— **这两条不需要任何新工具就能用**。

---

## 九、像素 / 2D 游戏的技术栈现状（2024–2025）

### 9.1 独立开发者实际用什么：Gamedev.js Survey 2024（本主题最强一手数据）

Gamedev.js Survey 2024 于 2024-12-04 ~ 12-20 开放、**2025-01-29 发布报告**，共 **620** 份答卷；
「技术 / API」题（581 人作答）〔中〕（[Gamedev.js Survey 2024](https://gamedevjs.com/survey/2024/)）：

| 技术 | 占比 |
| --- | --- |
| **Canvas** | **56.1%** |
| **WebGL** | **55.6%** |
| Local Storage | 47.3% |
| Web Audio | 29.4% |
| WebSocket | 28.4% |
| **WebGPU** | **14.6%**（上年 11.7%） |
| WebTransport | 2.9% |

同一调查「框架 / 引擎」题：**Phaser 29.3%**、Three.js 21.4%、GDevelop 21.3%、
Unity 20.9%、Godot 20.6%、**自研 / 内部 16.2%**〔中〕（同上）。

> **读法**：**Canvas 与 WebGL 基本并列**（56.1% vs 55.6%，差值在误差量级内），
> **WebGPU 仍是少数派**。注意样本是自选的、业余开发者占 62.3%，
> **它支持"Canvas 与 WebGL 并列、WebGPU 仍边缘"，但不支持"多数独立 2D Web 游戏已转 WebGL"这类强论断。**

### 9.2 npm 下载量（API 实际返回，区间 2026-09-23 ~ 09-29）

| 包 | 最近一周下载量 | 来源 |
| --- | --- | --- |
| three | **21,474,300** | 〔高〕[npm API](https://api.npmjs.org/downloads/point/last-week/three) |
| pixi.js | **1,293,687** | 〔高〕[npm API](https://api.npmjs.org/downloads/point/last-week/pixi.js) |
| phaser | **482,266** | 〔高〕[npm API](https://api.npmjs.org/downloads/point/last-week/phaser) |
| kaplay | 9,829 | 〔高〕[npm API](https://api.npmjs.org/downloads/point/last-week/kaplay) |
| excalibur | 8,975 | 〔高〕[npm API](https://api.npmjs.org/downloads/point/last-week/excalibur) |
| kaboom | 2,220 | 〔高〕[npm API](https://api.npmjs.org/downloads/point/last-week/kaboom) |
| melonjs | 1,955 | 〔高〕[npm API](https://api.npmjs.org/downloads/point/last-week/melonjs) |
| littlejsengine | 1,144 | 〔高〕[npm API](https://api.npmjs.org/downloads/point/last-week/littlejsengine) |

**注意**：区间是抓取当日 API 实际返回的"最近一周"（**2026-09 区间**），**不是 2024–2025 数字**。
它证明的是**量级关系**：three 比 pixi.js 高一个数量级，pixi.js 比 phaser 高约 2.7 倍，
而"有 Canvas2D 回退"的那几个（melonjs / littlejsengine / kaboom）都在**千级**。

### 9.3 主要库的渲染后端与 Canvas2D 回退矩阵

| 库 / 引擎（版本） | 渲染后端 | Canvas2D 回退 | 许可 | 运行时依赖 | min+gzip | 目标受众 |
| --- | --- | --- | --- | --- | --- | --- |
| **PixiJS 8.21.0** | WebGL/WebGL2（推荐）+ WebGPU（**实验**）〔高〕[doc](https://pixijs.com/8.x/guides/components/renderers) | **否**（CanvasRenderer 标 "Coming-soon"）〔高〕同上 | MIT | 10 | **261.0 KB** | 纯 2D 渲染库，玩法层自建 |
| **Phaser 4.2.1** | 全新 WebGL 渲染器（RenderNode 取代 v3 Pipeline）〔高〕[mig](https://cdn.jsdelivr.net/npm/phaser@4.1.0/skills/v3-to-v4-migration/SKILL.md) | **有但已弃用**〔高〕同上 | MIT | 1 | **355.7 KB** | 全栈 2D 框架（物理/输入/场景） |
| **three.js 0.186.1** | 仅 WebGL 与 WebGPU（SVG/CSS3D 为 addon）〔高〕[README](https://github.com/mrdoob/three.js) | **否**〔高〕同上 | MIT | 0 | **184.9 KB** | 通用 3D，2D 需自行搭 |
| Excalibur 0.32.0 | 默认 WebGL | **是**（手动或低帧率自动降级）〔高〕[doc](https://excaliburjs.com/docs/graphics-context/) | BSD-2-Clause | 0 | 145.3 KB | TypeScript 优先的 2D ECS 引擎 |
| Kaplay 3001.0.19 | WebGL（canvas 即 framebuffer texture）〔高〕[doc](https://kaplayjs.com/docs/guides/canvas/) | 文档未声明 | MIT | 0 | 66.7 KB | 初学者 / Game Jam |
| melonJS 20.7.0 | **WebGPU → WebGL2 → Canvas2D 自动降级**〔高〕[README](https://github.com/melonjs/melonJS) | **是**〔高〕同上 | MIT | 0 | 262.2 KB | 独立开发者，2.5D / Tiled |
| **LittleJS 1.21.0** | **"WebGL2 + Canvas2D hybrid"**〔高〕[README](https://github.com/KilledByAPixel/LittleJS) | **是**〔高〕同上 | MIT | 0 | **102.4 KB** | 体积极限 / Game Jam / js13k |

（体积与依赖数据来自 Bundlephobia API 与各包 registry，抓取时间为本次调研当日。）

**给 Bronana 的直接对照**：**LittleJS 是这一格里最像的样本** ——
MIT、**零依赖**、"WebGL2 + Canvas2D hybrid"、自述 littlejs.min.js 约 100KB gzip、
**小 2D 游戏经 tree-shaking 后约 26KB gzip**〔高〕
（[LittleJS README](https://github.com/KilledByAPixel/LittleJS)）。
**即便有它，本项目的 gzip 预算只剩 9.4 kB**（见 1.1）——
**所以"引库"这条路在本项目里是预算上就不成立的，不是偏好问题。**

### 9.4 像素美术在 Web 上的实务：关键不是后端，是**关掉一切插值**

- **Canvas2D 侧**：`imageSmoothingEnabled` 默认为 `true`，放大时默认算法会模糊像素；
  MDN 明确"对使用像素画（pixel art）的游戏与应用有用……**设为 `false` 以保持像素锐利**"，
  并有 `imageSmoothingQuality`〔高〕
  （[MDN: imageSmoothingEnabled](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/imageSmoothingEnabled)）。
- **CSS 侧**：`image-rendering` 取 `auto / smooth / crisp-edges / pixelated`；
  `pixelated` 的定义是**先按最近整数倍做最近邻、再用平滑插值到目标尺寸** ——
  **这正是"整数缩放 + 末段平滑"的官方描述**〔高〕
  （[MDN: image-rendering](https://developer.mozilla.org/en-US/docs/Web/CSS/image-rendering)）。
- **WebGL 侧**：`TEXTURE_MAG_FILTER` 默认 `gl.LINEAR`，可设 `gl.NEAREST`〔高〕
  （[MDN: texParameter](https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/texParameter)）。
  → **像素画必须显式把 MAG/MIN 都设为 NEAREST 并关闭 mipmap，否则默认线性过滤会糊。**
  **这一条对 Bronana 是个提醒**：本项目**零素材、全程序化绘制**，
  所以"纹理过滤"这一整类问题**目前根本不存在**；
  而一旦为了 WebGL 把矢量造型烘成纹理（现在的姿态图集已经这么做了一次），
  **就自己把这个问题引进来了**（`README.md` 已经因为"旋转重采样会让粗黑轮廓发虚"
  明确拒绝烘焙武器贴图 —— 那是同一个问题在 Canvas2D 下的版本）。
- **亚像素坐标**：web.dev 指出 Canvas 支持亚像素渲染且**无法关闭**，非整数坐标会自动抗锯齿；
  用 `Math.floor` / `Math.round` 取整明显更快〔高〕
  （[web.dev](https://web.dev/articles/canvas-performance)）。

**WebGPU 现在对 2D 像素游戏值不值**：现有可核实证据偏向"还不值" ——
PixiJS 官方把 WebGPU 标为 Experimental 并**建议生产用 WebGL**〔高〕
（[PixiJS: Renderers](https://pixijs.com/8.x/guides/components/renderers)）；
melonJS 也只是把它放在 `AUTO` 首位、失败即降级〔高〕（[README](https://github.com/melonjs/melonJS)）；
社区采用率 WebGPU 14.6% vs WebGL 55.6%〔中〕（[Gamedev.js Survey 2024](https://gamedevjs.com/survey/2024/)）。
**没有找到 2024–2025 专门论证"2D 像素游戏是否值得上 WebGPU"的文章（未取得）。**

### 9.5 已发布的性能比较与厂商指引

**跨 13 个库的 10,000 精灵 FPS 对比**〔中〕
（[js-game-rendering-benchmark](https://github.com/Shirajuki/js-game-rendering-benchmark)）：
**Babylon.js 56 FPS > Pixi.js 47 FPS > Phaser 43 FPS**；Kontra 显示 60 FPS 但用固定 dt；
**Kaboom/Kaplay 仅 3 FPS**。测试机 Windows 11 / Ryzen 5 4500U / 8GB / **Edge 109**
（≈ 2023 初，故**并非严格 2024–2025**）。该 README **自己提示**：
WebGL 主要为 3D 设计，"**在 2D 场景下相对 Canvas 未必带来显著性能提升**"，
且 Canvas vs WebGL 的 2D 对比本身可能有偏〔中〕（同上）。

**厂商指引**：MDN 把 WebGL 描述为"用于渲染高性能交互式 3D 与 **2D** 图形"的 API，
通过 `<canvas>` 使用并利用硬件加速，同时指出 `<canvas>` 也被 Canvas API 用于 2D 图形〔高〕
（[MDN: WebGL API](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API)）。
**web.dev 的 Canvas 优化文（2.2 节）仍是 Google 侧最完整的一份 Canvas 2D 优化指引**〔高〕
（[web.dev](https://web.dev/articles/canvas-performance)）。

---

## 十、横向综合：本次调研推翻/确认了哪些初始设想

| 初始设想 | 调研结论 | 依据 |
| --- | --- | --- |
| "上 WebGL 能让 2D 快很多" | **不成立（对 2D 普遍而言）**。收益出现在批次数与 batch break 上，而本作是"同色不透明填充"那一类；连 benchmark 作者都提示"2D 下 WebGL 未必更快" | 2.1、5.4、9.5 |
| "Canvas2D 缺混合模式，所以效果做不出来" | **不成立**。Canvas2D 有 26 种混合；反而比 WebGL 的 4 种**更多**。真正缺的是**可编程着色器**与 **FBO / MSAA 控制** | 3.1、3.2 |
| "做双后端（Canvas2D + WebGL2）是稳妥的中间态" | **没有权威先例**，且三家主流库的走向**全是收紧 Canvas2D**（PixiJS 未提供、Phaser 弃用、three.js 完全没有）。**建议降级为"单后端 + 可替换接口"** | 7.5、8.6、9.3 |
| "引擎与内容分离 = 建两个目录" | **方向上对，做法上不是本仓库的路**。四个引擎全部靠**机制**（asmdef / Build.cs / Cargo / crate）**强制**，而不是靠目录约定；本仓库对应的机制是 `systems.cjs` + `Registry` + 门 | 8.1~8.6 |
| "分层是设计问题，写清楚就行" | **不成立**。Godot 有环形依赖 issue，链接期爆炸。**分层是"有门才成立"的工程问题** | 8.2 |
| "换栈的代价主要在渲染代码" | **代价主要在资产管线与自定义扩展，且会溢出到正确性**（Phaser 4 的 UV 翻转要重压纹理、`Math.TAU` 改值） | 6.2、6.5 |
| "引个成熟库来托管渲染是最省事的路" | **在本项目预算上不成立**：gzip 只剩 9.4 kB，而最轻的 LittleJS 也要 ~26KB gzip（tree-shaken 后） | 1.1、9.3 |
| "该做的是对象池 / 批处理" | **已经做完并且量过**（图集 −60%、静态层烘焙 898→1、剔除 −21%）。剩下的批处理候选"只值 2%"或"属美术决定" | 1.1、`README.md` 绘制批处理节 |

---

---

## 十一、换栈的账：收益、代价，以及 Bronana 的真实边界在哪

### 11.1 收益（诚实版，只列本项目能兑现的部分）

| 收益 | 对本项目是否成立 | 说明 |
| --- | --- | --- |
| **绘制调用掉一个数量级** | ⚠️ **暂时用不上** | 本作稳态 **290 次/帧**，门的上界 900 都还没碰到（1.1）。要等它长到几千才有意义 |
| **解锁 Canvas2D 写不出来的东西**（全屏后处理） | ✅ **成立，而且是唯一硬成立的收益** | 见 3.3：自定义后处理需要每像素可编程，Canvas2D 没有任何 shader 接口〔高〕 |
| **离屏 / Worker 渲染** | ❌ **不再是理由** | `OffscreenCanvas` 对 Canvas2D 也可用，MDN 标 Baseline "Widely available"（2023-03 起）〔高〕（[MDN](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas)）。**这是把 R49 触发条件第 4 条降级的事实依据** |
| **更便宜的 CPU 侧对象绘制**（WebGPU 独有） | ❌ 用不上 | MDN 说的是"**individual objects** significantly cheaper on the CPU side"〔高〕，而本作 CPU 侧不是瓶颈（模拟层占 0.9%~7.7%） |

> ⚠ **一条必须写清楚的澄清**：`src/art_shaders.ts` 里的 "shader" **不是 GLSL** ——
> 它是 Canvas2D 的合成状态机（`globalCompositeOperation`），文件头就写着
> "这个项目跑在 Canvas2D 上，没有 fragment shader 可写"。
> **"有那个玩法"不等于"有 GPU"**，这条区分在讨论"要不要换栈"时最容易被含混过去。

### 11.2 代价（三块**已经建成的资产**）

| 资产 | 现在是什么 | 换栈要付什么 |
| --- | --- | --- |
| **渲染审计基建** | `test/_ctx.mjs` 是**带 CTM 追踪的 Canvas2D 桩**：层带 / y 排序 / 剔除 / 绘制预算 / 变换不变量 / 半透明叠色顺序，全靠它量（门 `art` / `test` / `solid` 都吃这口） | GL 的调用记录桩要重写一遍 —— **不是不可能，是"同一批断言换一套地基"** |
| **美术产出面** | `sprites.ts`（1598 行）/ `art_tiles.ts` / `art_spec.ts` 把矢量造型烘成离屏 canvas 位图（角色姿态图集 56 张 ≈ 0.57MB） | 位图要变成**纹理上传 + 自己写批处理管线**。而且会把 9.4 节那个"**纹理过滤**"的问题主动引进来（现在零素材，不存在这个问题） |
| **零依赖 + 单入口的形态** | 94 模块 · 0 运行时依赖 · `index.html` 一个入口 · web / cli / desktop 三形态共用 | GL 管线是**新的状态机**（上下文丢失、贴图上传、绘制顺序），**必须进 `verify` 的某道门才算"改完"**（见 4.3：context loss 是架构级要求） |

**外加一条 3 家案例反复证明的代价（6.5）**：**破坏面会溢出到正确性** ——
Phaser 4 的 UV 约定翻转要求**重新压缩所有压缩纹理**、`Math.TAU` 改值会静默产出错误图像〔高〕。
本项目的对应风险点是 **`depth.ts` 的层带 / y 排序（435 行）与 `R.alpha` 插值** ——
GL 的坐标系（Y 向下 vs 向上）与 Canvas2D **不一致**，而本项目的绘制原点与锚点
（`S.enemyBox`、贴图 `bodyY`、`rig.mjs` 的包围盒基线）**全部是按 Canvas2D 的 Y 向下约定的**。

### 11.3 一个必须说清的概念区分：**「L0」不等于「引擎」**

这是本次调研在本仓库里**最有价值的一处澄清**，也是我自己初始设想的修正。

`tools/systems.cjs` 里 L0 的 21 个模块，按**依赖方向**坐在最底下；
但按 8.6 节的判据 **b（是否出现游戏专有名词）** 逐个过一遍，结论是分裂的：

| L0 模块 | 行数 | 按判据 b 是引擎吗 | 理由 |
| --- | --- | --- | --- |
| `utils.ts` | 410 | ⚠️ **一半是** | 数学 / 随机是引擎；但 **`PAL`（调色板）+ 事件总线（信号）+ 色盲换档**是**本作的美术宪法**，不是通用设施 |
| `registry.ts` | 186 | ✅ 是 | 扩展点总账，一个玩法概念都不认识 |
| `selfcheck.ts` | 108 | ✅ 是 | 自检登记处 |
| `fold.ts` | 150 | ✅ 是 | "一张表四种折法"，通用 |
| `containers.ts` | 259 | ✅ 是 | 容器上限 / 回收策略，通用 |
| `envelope.ts` | 78 | ✅ 是 | 信封 + 版本 + 迁移链，通用 |
| `collide.ts` | 58 | ✅ 是 | 圆 / 扫掠线段，纯数学 |
| `depth.ts` | 435 | ✅ 是 | 层带 + 排序 + 确定性 tie-break |
| `rig.ts` | 308 | ✅ 是 | 骨架运行时（层级 / 正向运动学 / 够位 / 部件绑定） |
| `comp.ts` | 586 | ✅ 是 | 组件系统（原型 / 字段并集 / 生成工厂） |
| **`draw2d.ts`** | **351** | ❌ **不是** | API 表面是 `bronana` / `bronanaPath` / `mouth` / `eye` / `dots` / `ditherBand` —— **这是"豆豆"的画法库，是内容** |
| **`world.ts`** | 178 | ❌ **不是** | 它声明的是"战场 / 大厅 / 枢纽"这三块地 —— 那是**这一款游戏的世界契约**，不是通用世界系统 |
| **`object.ts`** | 305 | ⚠️ 一半 | 身份 `$id` 是引擎；**"11 类原型普查"里那 11 类是内容** |
| **`ai.ts`** | 304 | ❌ **不是** | 怪物行为与弹幕模式（注册表驱动），**"怪物"与"弹幕"就是玩法名词** |
| `appearance.ts` | — | ❌ 不是 | 8 色板 × 3 脸型 × 5 配件，纯内容 |
| `openings.ts` / `character.ts` | — | ❌ 不是 | 入门三选 / 存档角色形状 |
| `dialogue.ts` | 275 | ✅ 是 | 打字机 / 自动 / 历史 / 短句，**全是时间的纯函数**，不认识 DOM 与会话 |
| `status.ts` | 377 | ⚠️ 一半 | "可叠层带秒数的 buff/debuff"是引擎；**那 3 种状态 × 5 种 kind 是内容** |
| `curves.ts` / `stats.ts` | — | ❌ 不是 | 数值曲线表 / 属性派生公式 —— 判据 **d**：改一个平衡数字就要动它 |

**结论（这是建议的地基）**：

> **按依赖方向能拿到 21 个"最底层模块"，但按领域判据只能拿到 9~11 个"引擎模块"。**
> 两者**不是同一个集合**，而本仓库的家法本来就写着"决定层次的是依赖不是性质"（1.2）。
> **因此"引擎 / 内容分离"在本项目里不是"把 L0 搬出去"，而是"在 L0 内部再做一次领域切割"。**

这也顺带说明了为什么**不能靠搬目录**：搬目录按的是**目录**，
而本项目的层次按的是**依赖**——两者的口径不同，搬完会出现"目录说它是引擎、
依赖说它在 L0、领域说它是内容"的三方打架。

---

## 十二、迁移代价的真实估计

### 12.1 两条路线与它们的实际工作量

**路线 A：声明表 + 门（推荐）**

| 项 | 数量 | 风险 |
| --- | --- | --- |
| 新增模块 | **0** | — |
| 修改模块 | **1**（`tools/systems.cjs` 加一个可选字段）＋ **1**（新工具 `tools/engine-audit.mjs`）＋ **1**（`tools/verify.mjs` 的 `GATES` +`.github/workflows/ci.yml` 各一处） | 低 |
| 搬文件 / 改 import | **0** | — |
| 行为指纹 | **必须逐位不变** | 低（不动 `src/`） |
| 门 | **+1**（引擎边界门） | 中：**门必须证明它会失败**（家法第三节） |

**路线 B：真搬目录（`src/engine/**` + `src/game/**`）**

| 项 | 数量 | 风险 |
| --- | --- | --- |
| 移动模块 | **40 个**（L0 的 **21** + L1 的 **19**；共 94 个模块中的 40 个），且按 11.3 还要再切 5 个模块 | **高** |
| 改 import 路径 | **全部消费方**（`ui.ts` 3875 行 / `game.ts` 5042 行 / `sprites.ts` / `render.ts` / `hall.ts` 680 行 …） | **高** |
| 同步改的清单 | `tools/systems.cjs`（模块名 → 层号的表）· `test/_load.mjs` 的三个加载集合 · `test/suites.mjs` · `test/ui-check.mjs` 的 `FORBID` 表 · `tools/registry-drift.mjs` / `arch-audit.cjs` / `hardcode-audit.cjs` / `solid-audit.cjs` 等按 `src/` 文件名扫的工具 | **高**（`AGENTS.md` 第七节第 3 条："不要在文档或 CI 里写死统计数字"，同理，写死文件清单的地方也漂） |
| 行为指纹 | 应当不变（纯搬移） | 中：**只要有一处 import 漏改，症状是"某模块静默取到 undefined"**，而不是编译错误（`strict: false`，见 `AGENTS.md` 第十节坑 2 的真实案例） |

**结论**：**路线 B 的收益（"目录好看"）不抵它的风险（静默 undefined + 十几个工具的清单同步）。**
本项目有一条现成的经验支持这个判断：`docs/history/08` 记着
"**并行会话把未提交的改动整文件冲掉**"那次事故 —— 大范围移动文件在这里是**已知的高危动作**。

### 12.2 若要动 `src/`，真正会痛的三个点

1. **`ui.ts`（3875 行）与 `game.ts`（5042 行）** —— 它们 import 面最宽。
   `game.ts` 是 `solid` 门点名的对象（"接口大**且**依赖多"，113 个接口成员）。
   **任何"引擎化"如果顺手去动这两个文件，风险会盖过收益。**
2. **`test/_load.mjs` 的三个加载集合**（`SIM_MODULES` / `RENDER_MODULES` / `UI_MODULES`）——
   64 套测试全部经它加载。**搬目录 = 三个集合一起改 = 64 套测试同时受影响。**
3. **`draw2d.ts` 的出口** —— 它是"绘制原语唯一入口"（`D.*` 约 20 个函数）。
   **好消息**：这正是后端接口唯一的插点（见 13.1）；**坏消息**：它同时是
   `test/_ctx.mjs` 的 CTM 断言所依赖的那一层，所以"插一层的代价"与"断言换地基的代价"是同一笔。

---

## 十三、建议的落地方案（最小可行）

### 13.1 渲染后端：**一处插点、单后端、可替换**

**唯一的插点**：`src/draw2d.ts` 的出口。它已经是"绘制原语唯一入口"，所以
**不需要新建一个"渲染器"模块去包住整个 `render.ts`** —— 那是把插点放在错的地方
（`render.ts` 是 1578 行的场景编排，它属于上层）。

**做法（分两步，第一步零风险）**：

```
第 1 步（纯重构，指纹必须逐位不变）
  src/rhi.ts                  新增：接口 + 句柄 + Caps（7.5 节那份清单，约 25 个方法）
  src/rhi_null.ts             新增：无头后端（照抄 sokol 的 dummy backend 思路，全空实现）
  src/rhi_canvas2d.ts         新增：把现有 draw2d 的实现搬进来，一字不改逻辑
  src/draw2d.ts               改：D.* 变成"转发给当前后端"的薄壳（函数体一行）

第 2 步（仍不改行为）
  test/rhi.mjs                新增：断言每个后端都实现了接口的全部方法
                                    （遍历方法名 + typeof === 'function'）
```

**为什么这仍然是"零风险"**：`D.*` 的函数签名与语义**一个字节都不变**，
只是把函数体从 `draw2d.ts` 搬到 `rhi_canvas2d.ts`。
`test/_ctx.mjs`（CTM 桩）、`test/render-check.mjs`（绘制预算 / 美术宪法 / NaN）、
`test/art.mjs` 全部照旧工作 —— **因为 ctx 层面看到的东西完全一样**。

**关键约束（写进注释，免得后人绕过去）**：

- `rhi.ts` **不创建 context、不 present**（sokol 的 `DOES NOT` 清单〔高〕）；
- `rhi.ts` **不认识 `PAL`、不认识 `scene`、不认识任何 `D.*` 的形状语义**；
- **`draw2d.ts` 里的 `bronana` / `mouth` / `eye` / `dots` / `ditherBand` 不进引擎**（11.3 的判据 b）——
  它们留在 `draw2d.ts`（或迁到内容侧），只由引擎提供底层原语（`rect` / `circle` / `poly` / `path`）。

### 13.2 引擎 / 内容边界：**在 `systems.cjs` 里加一个字段，而不是搬目录**

**具体怎么写**（不改任何既有字段，纯增量）：

```js
/* tools/systems.cjs —— 每个系统加一个可选字段 domain */
{
  id: 'mech', name: '工具与机制', level: 0,
  /* domain: 'engine' | 'framework' | 'game' | 'mixed'
     —— engine   = 与具体游戏无关，换一款游戏可原样带走（判据 c）
     —— framework= 通用机制、但配置/表是本作的（判据 b 通过、e 通过、c 不通过）
     —— game     = 认识本作的玩法名词（判据 b 不通过）
     —— mixed    = 当前混在一起，**必须拆**（这就是待办清单） */
  domain: 'mixed',
  modules: [ ... ],
  /* 逐模块的领域（只有 mixed 的系统才需要写）：
     engineModules: ['registry.ts','selfcheck.ts','fold.ts','containers.ts',
                     'envelope.ts','collide.ts','depth.ts','rig.ts','comp.ts'],
     gameModules:   ['draw2d.ts','world.ts','ai.ts','appearance.ts','openings.ts',
                     'character.ts','curves.ts','stats.ts','dialogue.ts','status.ts',
                     'utils.ts'],
     note: 'utils.ts 是 mixed：数学/随机是 engine，PAL 与信号总线是 game —— 拆它是一张独立的待办',
  */
}
```

**依赖方向规则（新门的判据，只有三条，都能机械判）**：

| 判据 | 内容 | 挡什么 |
| --- | --- | --- |
| **R1** | **`domain: 'engine'` 的模块不得 import `domain: 'game'` 的模块** | 引擎反向依赖内容 |
| **R2** | **`domain: 'engine'` 的模块不得 import L1 及以上任何模块** | 引擎依赖数据表（判据 e），与 `systems.cjs` 现有的层规则**同向，但更严** |
| **R3** | **`domain: 'game'` 的模块可以 import 任何东西**（除非违反层规则） | 不制造新的禁令 |

**为什么只有三条、而且必须这么少**：
Godot 的教训（8.2）是"**没有门守着的地方会长出环形依赖**"，
而 Bronana 现在 **0 环 + 2 条已登记的向上边** 是**靠门守出来的**。
规则一多就会出现"这条边到底该不该登记"的扯皮，**三门是可维护的上限**。

**为什么"引擎不该知道游戏规则"在这里有了可执行的形态**：
它就是 **R1 + 判据 b**（引擎层源码里不许出现玩法名词）。
**判据 b 的自动化程度要标清楚**：它只能做成"词表检查"（类似现有的 `name` 门 / `hardcode-audit`），
**必然有假阳性**，所以第一版应当**只做 R1 / R2 两条机器判据，判据 b 只作为评审清单**（推断）。

### 13.3 路径：**六个阶段 + 每阶段的验收判据**

> 验收判据一律用本项目现成的东西：**门（`tools/verify.mjs` 的 `GATES`）+ 行为指纹**
> （`pnpm fingerprint` 的三个值：`622d6ebf` / `a9c2902b` / `354cc83c`）。
> 每个阶段都必须能回答"**这一阶段如果做错了，哪道门会红**"。

#### 阶段 0 · 补上最薄的一环（**先做，因为它与渲染无关但与"换栈"强相关**）

| | |
| --- | --- |
| 做什么 | 落 **A07 颜色门**（`tools/color-audit.mjs` + `GATES` + `ci.yml` 三处同步）—— 这是需求账本上已经登记、但**至今不存在**的那道门（本次 `Test-Path` 核实为 False） |
| 验收判据 | ① 门存在且 `pnpm verify` 含它；② **注入一处硬编码颜色，门必须变红**（家法：不会失败的审计是装饰）；③ `ci.yml` 有对应 step（否则 CI 比本地少跑一道门 —— 这是本项目踩过的真实事故）；④ **`src/` 零改动，指纹逐位不变** |
| 为什么排第一 | `AGENTS.md` 第十节第 7 条与 A13 都记着"文档说了一道不存在的门"。**在换渲染地基之前，先把颜色这条断言补上**，否则换栈之后连"颜色有没有走 `PAL`"都无从机器核对 |

#### 阶段 1 · 把"引擎 / 内容"的边界**声明出来**（不动 `src/`）

| | |
| --- | --- |
| 做什么 | `tools/systems.cjs` 加 `domain` / `engineModules` / `gameModules`（13.2 的形状）；新增 `tools/engine-audit.mjs` 实现 **R1 / R2**；登记进 `GATES` + `ci.yml` |
| 验收判据 | ① 新门绿；② **R1 注入一次违规（让一个 engine 模块 import 一个 game 模块），门必须红**；③ **R2 注入一次违规（让 `registry.ts` import `data_tiers.ts`），门必须红**；④ **`src/` 零改动，指纹逐位不变**；⑤ `pnpm verify` 全 21 道门绿 |
| 产物 | 一份**可核对的"哪些是引擎"清单**（现在是散文式的判断，之后是表） |

#### 阶段 2 · 渲染后端接口 + Canvas2D 后端（**净重构**）

| | |
| --- | --- |
| 做什么 | 13.1 的第 1 步：`rhi.ts` / `rhi_null.ts` / `rhi_canvas2d.ts`，`draw2d.ts` 变薄壳 |
| 验收判据 | ① **行为指纹逐位不变**（`622d6ebf` / `a9c2902b` / `354cc83c`）—— 这是本阶段**唯一**的硬判据；② `test/render-check.mjs` 的绘制调用中位数与**逐层明细**与改造前一致（290 次/帧那一档）；③ `test/art.mjs` / `test/rig.mjs` 的包围盒与锚点断言不改一条；④ `test/_ctx.mjs` **一行不改**（改了说明接口位置选错了）；⑤ 门 `solid` / `hardcode` 不红 |
| 风险 | **中**。这一阶段最容易滑向"顺手重构 `render.ts`"——**不许**。判据 ④ 就是为这个准备的：`_ctx.mjs` 若需要改，说明这一层暴露了它不该暴露的东西 |
| 这阶段的真实价值 | 它把"**换栈要付的第一笔钱**"提前付掉了：`4.3` 说的"资源必须可重建"与这里是同一件事 |

#### 阶段 3 · 让接口**可验证**（无头 / 录制后端）

| | |
| --- | --- |
| 做什么 | 用 `rhi_null.ts` 跑一帧真实渲染，断言"通过的调用序列"**稳定且逐位可复现**（等价于给渲染层加一份"行为指纹"）；把 `test/_ctx.mjs` 的 CTM 断言**逐步**迁到这个后端上 |
| 验收判据 | ① `rhi_null` 下**渲染一帧不抛异常、无 NaN 参数**（对应现在 `render-check` 抓 NaN 的那条）；② 同一帧两次跑出的调用序列**逐位相同**（确定性）；③ 新增断言数 ≥ 5，且**每一条都证明过会失败**；④ 指纹不变 |
| 为什么重要 | 这一阶段之后，"**换后端**"这件事才第一次变成**可测**的。没有它，阶段 5 是在盲改 |

#### 阶段 4 · 离屏 / Worker 渲染（**这条与换栈无关，先做它**）

| | |
| --- | --- |
| 做什么 | 把渲染搬到 `OffscreenCanvas`（Canvas2D 已经支持，MDN 标 Baseline Widely available〔高〕），主线程让给模拟与 UI |
| 验收判据 | ① 帧耗时（`test/perf.mjs`）与绘制调用（`render-check`）**不劣化**；② 输入延迟不明显变差（R49 早就提示"会和输入/UI 的同步打架"）；③ 可选：Worker 不可用时**有显式降级分支**（照 `sprites.ts` 那 7 处 `typeof document === 'undefined'` 的写法）；④ 门 `modes` 仍然绿（三种运行形态共用 `src/`） |
| 为什么排在换栈**之前** | 因为它是 R49 触发条件第 4 条。**先做便宜的、且不换栈就能做的那条**，做完再回头看"到底还需不需要换栈" —— 顺序反了就会为一个可能消失的原因去换整个渲染层 |

#### 阶段 5 · WebGL2 后端（**只在触发条件满足时才做**）

| | |
| --- | --- |
| 前置 | 十三.4 的五条触发条件中**至少一条成立**，且阶段 0~4 已完成 |
| 做什么 | 在同一份 `rhi.ts` 之后加 `rhi_webgl2.ts`；**不删 Canvas2D 后端**（它不是"旧代码"，它是**无头测试与低端回退的载体**） |
| 验收判据 | ① 两个后端下 `render-check` 的**逐层绘制调用明细**都能打出来；② **视觉等价性**有判据（同一 `?still=1` 帧、同一 seed，像素差在声明的阈值内 —— **阈值多少需要实测才能定**，见第十四节）；③ 上下文丢失有**可复现的测试**（`WEBGL_lose_context` 触发后能自恢复到同一帧）；④ gzip 全站 **≤ 300 kB**（现在 290.0）；⑤ 门 `art` / `test` / `solid` 全绿且 `test/_ctx.mjs` **仍然服务 Canvas2D 后端** |

### 13.4 触发条件（**要动手就满足任一条；在那之前，阶段 0~4 是更便宜的台阶**）

> **原 R49 的四条我建议改成下面五条。** 改动理由都写在表里，**没有一条是凭感觉松紧**。

| # | 触发条件（**满足任一条**） | 与 R49 原文的差异与理由 |
| --- | --- | --- |
| **1** | **目标机器上 60fps 守不住**，且 `render-check` 的**分层明细**指向**绘制**而不是模拟（模拟层读 `test/perf.mjs`） | 保留。**但判据要写死**：模拟层 P95 ≥ **4 ms**（占 60fps 预算 24%）时先查模拟层，**不许拿渲染层去治模拟层的病** |
| **2** | **稳态绘制调用中位数 ≥ 900，且持续至少 3 次独立测量**（门的上界就是 900，越界门会红），**且**阶段 1~3 做完仍不够 | 保留。**加"持续 3 次"是为了防机器噪声**：本项目实测过同一份代码单步 0.186 / 0.245 / 0.288ms，甚至 37.97ms 的尖峰（`README.md` 基准节）。**单次越界不构成触发** |
| **3** | **要加真正的全屏后处理**（泛光 / 扭曲 / 屏幕级光照 / 色差）—— 这条 Canvas2D **无论如何做不到**（3.3） | 保留，**并且升为最硬的一条**：它是本次调研里**唯一"换栈必然解锁、且无替代"**的收益（11.1） |
| **4** | ~~离屏 / Worker 渲染~~ → **改为"阶段 4 完成后仍不达标"** | **改**。`OffscreenCanvas` 对 Canvas2D 也可用（〔高〕[MDN](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas)），所以"要做离屏渲染"**本身不再是换栈的理由**；它变成阶段 4 的一次实验，**实验做完如果还不够，才回来算这条** |
| **5**（**新增**） | **需要逐像素的模糊 / 扭曲 / 遮罩级效果**（例如"贴图层 shader"要做出 Canvas2D 合成状态机表达不了的算子），且已确认 **`ctx.filter` 的 Limited availability 不可接受**（3.2） | 新增。R49 原文没有这一条，但 3.3 与 6.1（`pixi.js/advanced-blend-modes` 官方警告"本质是 filter，别过度用"）都指向"**高级合成是 Canvas2D 的真实天花板**" |

⚠ **"暂不换"≠"永不换"** —— 上面五条都是可判定的；满足哪一条就重新开一轮，
那时第十三节的阶段 5 就是施工说明的起点。

⚠ **每条触发条件都必须先经过阶段 1~3 的接口**。理由很实际：
**在接口做出来之前，`render-check` 的调用计数把"一次 `fill`"与"一次状态切换"算作同一件事**
（`README.md` 的"绘制批处理实测与更正"已经量过：合并路径**并不减少调用数**，
9,100 个 `fillRect` 换成 `rect`+`fill` 是 **9,101 而不是 1**）。
**接口化的过程本身会把"哪些调用是 GL 能合的、哪些不能"标出来** ——
在那之前引用的任何"调用数"都偏高，据此换栈会换错。

---

## 十四、不确定与需要实测才能定的部分

| # | 项 | 现状 | 怎么定 |
| --- | --- | --- | --- |
| 1 | **视觉等价阈值**（Canvas2D 与 WebGL2 渲同一帧的像素差上限） | **未取得任何权威数字**（3/13 节） | **只能实测**：先用 `?still=1` 冻结同一帧，跑两个后端，量差异直方图，再定阈值。**在此之前不许承诺"换栈画面不变"** |
| 2 | **Canvas2D 掉帧的通用阈值** | **未取得**（2.3） | 不存在可迁移数字。**本项目只能用门的上界（900）与实测帧时间当判据**，不能引用外部的"N 次调用" |
| 3 | **最小 2D WebGL 渲染器的 LOC** | **未取得**（4.4） | 阶段 5 开工时**自己量**，并且在 `docs/history/` 里留下第一版的行数；**不要引用任何"X 行搞定"的说法** |
| 4 | **抽象层的 CPU 开销** | 只有定性（"little runtime overhead" / "relatively thin layer"）；**具体数字未取得**（7.3） | 阶段 2 完成后用 `test/perf.mjs` 量"接口化前后"的帧耗时差（本项目的基准方法已经处理了机器噪声：三轮取最好一轮 + 抖动断言） |
| 5 | **`test/_ctx.mjs` 需要改多少** | 未知 | 阶段 2 的判据 ④ 就是量它的：**若"一行不改"成立，说明插点选对了**；否则阶段 2 的代价要重估 |
| 6 | **Firefox 默认开启 WebGPU 的版本与平台** | **矛盾未解释**（5.2） | 发版前重新核 caniuse 与 Mozilla 发布说明；**在那之前，任何"WebGPU 已可用"的表述都要带上 Firefox 这个例外** |
| 7 | **Phaser 的 27 vs MDN 的 26 个混合模式** | **差异来源未取得**（3.2） | 引用混合模式数量时必须带出处；**不要写成一个确定数字** |
| 8 | **PixiJS 移除 Canvas 渲染器的确切版本与措辞** | **未取得**（6.1） | 只有间接证据（v8 的 `autoDetectRenderer` 注释）。**"v8 移除了 Canvas"这句话目前不应写成事实** |
| 9 | **独立开发者的 Canvas→WebGL 移植复盘** | **未取得**（6.4） | 若后续找到可信来源，应补进本文件；**目前不建议把"别人这么干过"当作决策依据** |
| 10 | **`utils.ts` 该不该拆** | 未定（11.3） | **需要单独一轮**：拆 `PAL` / 信号总线出 `utils.ts` 会动 L0 的扇入中心。**判据**：拆完后 `test/persist.mjs` 的模块级可变状态清单与门 `audit` 的扇入扇出都要重新核对 |
| 11 | **阶段 4 的实际收益** | 未测 | 这是**唯一"不换栈也可能解决一半问题"**的路线（11.1）。**先量再谈阶段 5** |

---

## 十五、本次明确【未取得】的东西

> 列在这里是为了让下一个人不必重走一遍，也为了**防止这些数字日后被"回忆"出来**。

| # | 未能取得的项 | 尝试过的方式与失败原因 |
| --- | --- | --- |
| 1 | **Canvas2D 开始掉帧的通用 draw-call 阈值** | 无任何官方 / 学术来源给出该数字。仅得单机单版本数据（WHATWG wiki：Nexus 7 / Chromium 36 / 1000 sprite ≈ 9fps） |
| 2 | **Canvas2D 的填充率 / overdraw 上限数字** | MDN 与 web.dev 只给定性机制（大 canvas 拷贝成本随尺寸增长），无上限数值 |
| 3 | **渐变（gradient）单独的实测成本** | 官方页未单独量测；论坛仅泛称 "gradients, shadows, opacity" 有成本 |
| 4 | **Koski 论文（LUT）的完整测试条件** | `web_fetch` 拒绝 PDF；PowerShell 下载仅得 4448 字节非 PDF 内容。故搜索片段里的 "960 / 2520 sprites" 这组数字的**测试前提无法核验**，本报告**未采信** |
| 5 | **construct.net "HTML5 2D gaming performance analysis" 正文数字** | Cloudflare 拦截，HTTP 403 |
| 6 | **最小 2D WebGL 渲染器的 LOC / KB 实测数字** | `twgl.js` 在 unpkg 的列举返回 "0 files"；`raw.githubusercontent.com` 不可达 |
| 7 | **`EXT_texture_filter_anisotropic` 扩展页原文** | 本次未抓取该扩展页 |
| 8 | **Chrome 113 进入 Stable 的确切日期** | Chromium Dash API 抓取失败；官方博客仅自报 `Last updated 2023-04-06` 且当时处于 Beta |
| 9 | **Firefox 默认开启 WebGPU 的确切版本与平台** | caniuse 的 Firefox 行**全部为 Disabled by default**，与常见说法矛盾；Mozilla 官方发布说明未抓取成功。**该矛盾未能解释** |
| 10 | **Safari "Partial support" 具体缺哪些子特性** | caniuse 仅标 ◐，无子特性明细 |
| 11 | **gpuweb Implementation-Status wiki 的实现状态表** | 抓取 HTTP 200 但正文被截断为 GitHub 导航壳层 |
| 12 | **PixiJS 移除 Canvas 渲染器的确切版本号与官方措辞** | v8 迁移指南未列该条目；Discussion #10682 正文抓取只返回导航壳层 |
| 13 | **独立开发者的 Canvas→WebGL 移植复盘（含量化数据）** | 搜索结果仅为无法核实出处的内容农场转载（**已明确排除，不予引用**）；唯一取得正文的社区帖是**提问求助帖**而非复盘 |
| 14 | **Phaser "27 blend modes" 与 MDN "26 个 `globalCompositeOperation`" 的差异来源** | 两者数字不一致，未找到解释该差异的出处 |
| 15 | **抽象层 / RHI 的量化 CPU 开销（每 draw call 多少 ns 或百分比）** | 只找到定性表述（NVRHI "little runtime overhead"、SDL "relatively thin layer"） |
| 16 | **专门论证"引擎不该抽象图形 API、应只选一个"的权威文档** | 未找到官方 / 标准级来源；只有 2014 年的 gfx-rs issue 讨论与 SDL 工程师的口述 |
| 17 | **sokol 明确宣称"它不是场景图 / 渲染器"的原文** | 在抓取到的 sokol README 与 `sokol_gfx.h` 全文中检索 `scene` **均为 0 命中**；只有 `DOES NOT` 清单与 "simple 3D API wrapper" 的定位。**因此本报告不使用该表述** |
| 18 | **Godot 官方文档中"core 不得依赖 scene"的成文规则** | 相关页 404 或正文被导航淹没；改用社区整理 + `godot#108429` 作为替代证据（**已在 8.2 标明强度**） |
| 19 | **Unity 官方"何时该做 package"的判据页** | 相关页 404；`CustomPackages.html` 只有工作流与前置条件 |
| 20 | **Unreal 官方"引擎不得依赖游戏"的成文禁令** | 三页官方文档均无此禁令；Gameplay Modules 反而承认支持交叉依赖 |
| 21 | **bevyengine.org 的 "What is a Game Engine?" 一文** | 站内 Learn 索引无此条目 |
| 22 | **Jason Gregory《Game Engine Architecture》任何可抓取正文** | 两个 PDF 分别 `fetch failed` 与 HTTP 429（"Zu viele Zugriffe"）。**本报告不使用其任何内容** |
| 23 | **State of JS / State of HTML 2024 中 Canvas/WebGL/WebGPU 的使用数字** | 无对应条目；canvas 特性页 404 |
| 24 | **js13kGames 2024 的渲染后端占比统计** | 官方页为 SPA 只返回标题；未找到第三方统计 |
| 25 | **明确标注为 2024–2025 的 2D Web 引擎性能对比** | 找到的基准（Edge 109）约 2023 初 |
| 26 | **2024–2025 专门论证"2D 像素游戏是否值得上 WebGPU"的文章** | 未找到 |

**两条取证环境的硬限制（供复核者参考）**：
`raw.githubusercontent.com` 在本机 **DNS 失败**（`getaddrinfo ENOENT`）；
`web.dev` 主域、`caniuse.com` 部分页、construct.net 在主抓取通道被拒
（部分经 PowerShell 直取成功，涉及该站点的结论已注明途径）。

---

## 十六、给 Bronana 的建议（⚠ **本节已被决定取代，见顶部横幅**）

> 🔴 **本节是"暂不换"结论下的产物，已作废。** 它保留在这里是因为其中的**分析**仍然有用，
> 但**结论不要再用**。逐条去向：
>
> | 本节的哪一块 | 现状 |
> | --- | --- |
> | 16.1「**不上 WebGL2，更不上 WebGPU**」的站队 | ❌ **作废** —— 已拍板换成 WebGL2（目标态 WebGPU） |
> | 16.1 的**五条触发条件** | ❌ **作废** —— 决定不建立在触发条件上。**但 13.4 里"必须先经过接口再引用调用数"那条方法学仍然有效**（README 已量过合并路径不减少调用数） |
> | 16.1 对 **WebGPU 的"先等 Firefox"** | ✅ **部分保留** —— 作为"**先做 WebGL2、目标态放 WebGPU**"的**排序依据**（不是"不做 WebGPU"） |
> | 16.2 引擎/内容分离的**最小落地方案** | ✅ **保留**，已并入决定文档（含 R1/R2/R3，并**新增 R3：引擎不得出现 `CanvasRenderingContext2D` 类型**、**R4：世界坐标契约只由 `world.ts` 声明**） |
> | 16.2 的**迁移代价表** | ⚠️ **已修正** —— `D.*` 调用点**一处不用改**；要重写的是 `draw2d.ts` 的 382 行（复核见决定文档 §2.1） |
> | 16.2 的**风险点清单**（`utils.ts` 混合体 / `ui.ts` 与 `game.ts` 别碰 / 颜色门不存在 / 预算只剩 9.4 kB） | ✅ **保留**，其中"颜色门不存在"与"预算"升级为**阶段 0 的阻塞项** |
> | 16.3 的**六阶段路线图** | 🔄 **被决定文档第五节的七阶段路线图取代**（新增"shader 作为一等能力"与"文本"两个独立阶段） |
>
> 👉 **看结论请去 [`techstack-upgrade-decision.md`](techstack-upgrade-decision.md)。**

### 16.1 现在该不该上 WebGL —— **明确站队：现在不上；但把"换得起"这件事现在就做掉**

**站队（不含糊）**：

> **不上 WebGL2，更不上 WebGPU。要做的是阶段 1~3（声明边界 + 后端接口 + 可验证后端），
> 而不是换渲染层。**

三条支撑（每条都在上面有出处）：

1. **收益侧不成立**：本作稳态 **290 次/帧**（门的上界 900 都还没碰到），
   而 WebGL 的收益要等调用数长到几千；唯一"必然解锁且无替代"的收益是**全屏后处理**（11.1）。
2. **代价侧已经量过**：三块已建成的资产（`test/_ctx.mjs` 的 CTM 桩、矢量造型的图集管线、
   零依赖单入口的三形态形态）＋ 一次 **gzip 预算只剩 9.4 kB** 的现实（1.1、11.2）。
3. **外部证据不站在"换"这一边**：三家主流 2D 库全部**收紧** Canvas2D；
   连 benchmark 作者都自己提示"2D 下 WebGL 未必更快"；
   而**独立开发者的成功移植复盘本次未能取得**（6.4）—— **没有先例可抄**。

**可验证的触发条件（五条，满足任一条再动手）** —— 完整表格在 **13.4**，
这里给出可直接照着测的版本：

| # | 判据（可验证） | 怎么测 |
| --- | --- | --- |
| **1** | **`render-check` 的分层明细指向绘制、且帧时间守不住 60fps**；同时 **`perf.mjs` 的模拟层 P95 < 4ms**（排除是模拟层的病） | `node test/render-check.mjs` + `node test/perf.mjs` |
| **2** | **稳态绘制调用中位数 ≥ 900，持续 3 次独立测量**（门的上界就是 900，越界本身会红），且阶段 1~3 已做完 | `node test/render-check.mjs` 连跑 3 次 |
| **3** | **要加真正的全屏后处理**（泛光 / 扭曲 / 屏幕光照 / 色差）—— Canvas2D 做不到 | 需求侧判定（无需测量） |
| **4** | **阶段 4（OffscreenCanvas）做完后仍不达标** | 阶段 4 的验收数据 |
| **5** | **需要逐像素的模糊 / 扭曲 / 遮罩级效果**，且已确认 `ctx.filter` 的 Limited availability 不可接受 | MDN 的 Baseline 状态 + 效果需求 |

**每条都必须先经过阶段 1~3 的接口** —— 理由在 13.4 末尾：
现在的"绘制调用数"把"一次 `fill`"与"一次状态切换"算作同一件事，
**没接口化之前引用的调用数偏高**，据此换栈会换错。

**对 WebGPU 的额外一句**：**先等 Firefox**（5.2 的 caniuse 行全是 "Disabled by default"，
MDN 标 "not Baseline"）。它不是 WebGL 的提速版，**收益出现在 batch break 多的场景**（5.4），
而本作恰恰是"同色、不透明、少切换"那一类。

### 16.2 引擎 / 内容分离的最小落地方案

**目录与依赖方向怎么写 —— 答案是：不搬目录，只加声明与门。**

```
现在的样子（保持）                     要加的东西（增量）
─────────────────────────────         ──────────────────────────────────────────
src/                                  tools/systems.cjs
  94 个模块，平铺                       └ + domain / engineModules / gameModules 字段
  依赖方向由 systems.cjs 表 + 门守         （13.2 的形状，纯增量，不改既有字段）
                                          
tools/systems.cjs（唯一出处）            tools/engine-audit.mjs  （新增）
  SYSTEMS: 9 个系统 × 层号                ├ R1: engine 模块不得 import game 模块
  EXCEPTIONS: 2 条已登记的向上边          ├ R2: engine 模块不得 import L1 及以上模块
                                        └ R3: game 模块不受新增限制
                                        tools/verify.mjs 的 GATES  +1
                                        .github/workflows/ci.yml +1 step
```

**依赖方向的写法（三条规则，只有三条）**：见 **13.2 的 R1 / R2 / R3**。

**最关键的落地细节**：**边界靠"依赖 + 领域"两条正交判据共同定义**，
不能只用其中一条：

- **只用依赖方向**（现在的 `systems.cjs`）→ 得到 21 个"最底层模块"，
  但其中 **`draw2d` / `world` / `ai` 明明是内容**（11.3）；
- **只用领域判据**（"有没有玩法名词"）→ 无法机械验证，且会漏掉"依赖方向错了但名词没露出来"的情况；
- **两条一起用** → R1 / R2 可机器判，**而"`draw2d.ts` 不是引擎"这件事由 R1 自动暴露出来**
  （因为它一旦被声明为 engine，它 import 的 `utils.PAL` 就会把它拖进 game 侧）。

**迁移代价的真实估计**（详见第十二节）：

| 路线 | 涉及模块 | 风险点 |
| --- | --- | --- |
| **A · 声明表 + 门（推荐）** | **新增 0**；改 3 个文件（`systems.cjs` / `verify.mjs` / `ci.yml`）＋新增 1 个工具 | 低。**`src/` 零改动 ⇒ 指纹必须逐位不变，这是最硬的验收判据** |
| B · 真搬目录 | **移动 40 个模块（L0 21 + L1 19）**，改 `ui.ts`(3875 行) / `game.ts`(5042 行) / `sprites.ts` / `render.ts` / `hall.ts` 等全部 import | **高**：① 十几个按 `src/` 文件名扫的工具要同步（`_load.mjs` 的三个加载集合 / `suites.mjs` / `ui-check.mjs` 的 `FORBID` / `registry-drift` / `arch-audit` / `hardcode` / `solid`）；② 漏改一处的症状是**静默 `undefined`** 而不是编译错（`strict: false`，本项目有真实先例）；③ 本项目记过"**并行会话把未提交改动整文件冲掉**"的事故，大范围移动文件在这里是已知高危动作 |

**风险点清单（若一定要动 `src/`）**：

1. **`utils.ts` 是混合体**：数学/随机是引擎，**`PAL` + 信号总线 + 色盲换档是内容**（11.3）。
   它是 L0 的扇入中心，**拆它要单开一轮**（判据：拆完 `test/persist.mjs` 的模块级可变状态清单
   与门 `audit` 的扇入扇出都要重新核对）。
2. **`ui.ts`（3875 行）与 `game.ts`（5042 行）** 是 import 面最宽的两个文件，
   且 `game.ts` 是门 `solid` 点名的对象（113 个接口成员）。
   **引擎化的第一步不要碰它们。**
3. **`types.d.ts`（5108 行）是全局类型**，它本身不在任何层里；
   **新概念的类型声明要先想清楚放哪**（家法：四步齐全的第 1 步是"声明表"，类型在表之前）。
4. **颜色门（A07）现在不存在** —— 换渲染地基之前把它补上（阶段 0）。
5. **构建预算**：gzip 只剩 **9.4 kB**。任何方案若净增超过这个数，
   **要么改预算（那要写清为什么），要么改方案**。

### 16.3 分阶段路线图（每阶段都有"门 + 行为指纹"验收）

| 阶段 | 做什么 | 验收判据（**必须可机械判定**） | 若做错了哪道门会红 |
| --- | --- | --- | --- |
| **0 · 颜色门** | 落 A07（`tools/color-audit.mjs` + `GATES` + `ci.yml`） | ① 门存在且 `verify` 跑它；② **注入硬编码颜色，门必红**；③ `ci.yml` 有同名 step；④ `src/` 零改动，**指纹逐位不变** | `verify`（新门）/ `yaml`（ci.yml）/ `fingerprint` |
| **1 · 声明边界** | `systems.cjs` 加 `domain` 字段；新增 `tools/engine-audit.mjs`（R1/R2）；登记进 `GATES` + `ci.yml` | ① 新门绿；② **注入 R1 违规 → 必红**；③ **注入 R2 违规 → 必红**；④ `src/` 零改动，**指纹逐位不变**；⑤ `pnpm verify` 全绿 | 新门 / `fingerprint` / `drift`（新工具未登记会被抓） |
| **2 · 后端接口（净重构）** | `rhi.ts` / `rhi_null.ts` / `rhi_canvas2d.ts`；`draw2d.ts` 变薄壳 | ① **指纹逐位不变**（唯一硬判据）；② `render-check` 的调用中位数与**逐层明细**与改造前一致；③ `test/art.mjs` / `rig.mjs` 的包围盒断言**一条不改**；④ **`test/_ctx.mjs` 一行不改**；⑤ 门 `solid` / `hardcode` 绿 | `fingerprint` / `test` / `art` / `solid` |
| **3 · 可验证后端** | `rhi_null` 跑真实一帧；把 CTM 断言逐步迁过去 | ① 一帧无异常、**无 NaN 参数**；② 同帧两次调用序列**逐位相同**；③ 新增断言 ≥ 5，**每条都证明过会失败**；④ 指纹不变 | `test` / `art` / `render-check` |
| **4 · 离屏渲染** | `OffscreenCanvas`（Canvas2D 已支持） | ① `perf.mjs` 帧耗时与 `render-check` 调用数**不劣化**；② 输入延迟无明显变差；③ Worker 不可用时有**显式降级分支**；④ 门 `modes` 绿（三形态共用 `src/`） | `test`（perf / modes）/ `fingerprint` |
| **5 · WebGL2 后端**（**仅触发后**） | 在同一份 `rhi.ts` 后加 `rhi_webgl2.ts`；**不删 Canvas2D 后端** | ① 两后端的逐层调用明细都可打；② `?still=1` 同帧同 seed 的**像素差在声明阈值内**（阈值需实测，见第十四节）；③ 上下文丢失有**可复现测试**（`WEBGL_lose_context` 后能自恢复到同一帧）；④ 全站 gzip **≤ 300 kB**；⑤ 门 `art`/`test`/`solid` 全绿 | `test` / `art` / `solid` / `modes`（预算） |

**三条贯穿全路线的纪律**：

1. **阶段 0~4 全部要求"指纹逐位不变"** —— 因为它们**都不改行为**。
   这是本仓库现成的安全绳（`AGENTS.md` 第五节），也是"引擎化"最容易被做歪的地方：
   **一旦指纹变了，就说明"重构"变成了"改玩法"，应当立刻停手去查。**
2. **每一道新门都必须证明它会失败**（家法第三节：一条不会失败的审计等于装饰）。
   阶段 0 与阶段 1 的验收判据里都写死了"注入坏数据 → 必红"。
3. **加门必须三处同步**：`tools/verify.mjs` 的 `GATES` + `.github/workflows/ci.yml`
   + 让 `verify.mjs` 的自我对账绿（本项目踩过"CI 比本地少跑一道门、两边都绿"的真实事故）。

**最后一条务实提醒**：本路线的**阶段 1~3 加起来不引入任何新依赖、不改任何玩法、
不搬家任何文件**，它买到的是"**换栈这件事从"不敢碰"变成"有接口、有判据、有回退"**"。
这正是本项目一贯的做法 —— 先把尺子做出来，再改东西。
**"引擎与内容分离"在本项目里不是一次搬迁，而是一次**声明**；
**"要不要上 WebGL"不是一次赌博，而是五条可测的触发条件。**

---

## 十七、交叉核对：本报告与并行落地的 `tools/engine-boundary.mjs`

> **这一节是在本报告写完一半时补的**：本仓库里出现了一份**并行产出** ——
> `tools/engine-boundary.mjs`（R55，**本次调研之外的另一路工作**）。
> 它把同一批外部证据（Unity asmdef · Godot 源码树 · Bevy crate · Unreal Engine/Game）
> 压成了**同一句判据**："**先看边，再看词，最后看可替换性**"，
> 并**已经实现了 13.2 建议的 R1 / R2**（外加一条"词"的提示级检查）。
>
> **一句话结论：两边的原则完全一致，分类有 2 处需要人拍板的差异。** 记录在此备核。

### 17.1 一致的部分（这说明结论是稳的）

| 项 | 本报告 | `engine-boundary.mjs` |
| --- | --- | --- |
| 核心判据 | **先看边，再看词，最后看可替换性**（8.6） | 同一句，写在文件头 |
| 允许的边 | 只有 **content → engine** 单向（R1） | "允许的边只有一条：**content → engine**（内容用引擎；反过来就是越界）" |
| 引擎不得依赖数据表（R2） | 建议实现 | 已实现：`DATA_TABLES` 清单 + 引擎 import 数据表即报红 |
| "词"这一条要弱处理 | 判据 b **第一版只作评审清单**（13.2 推断） | **只报提示级** —— 与建议一致 |
| 分类表是**数据不是推论** | 13.2 的形状 | "分类表是数据、不是代码推论（与 `tools/systems.cjs` 同一条纪律）" |
| 需要一份"候选/待拆"清单 | 阶段 1 的 R1/R2 + `domain: 'mixed'` | 有 `ENGINE_CANDIDATE`：`record.ts` / `crash.ts`（**两者都因为 import 了 `game.ts`** 被划出引擎，且写明了"差的那一刀"） |

**尤其值得记的一条**：`engine-boundary.mjs` 把 `storage.ts` / `terms.ts` / `art_spec.ts` /
`art_tiles.ts` / `art_parallax.ts` / `audio.ts` / `music.ts` 划为引擎，
用的是一个**比我 11.3 更细的区分**：「**机制是引擎，表/音色/素材是内容**」——
例如 "含调色板 `PAL` —— 它是**引擎能力**，色值才是内容"、"具体音色表才是内容"。
**这个区分比我的更可操作**，我在 11.3 对 `utils.ts` 写"一半是"，它给出了那一刀该切在哪。
**13.2 的 `domain: 'mixed'` 建议应当据此改写为"机制 / 数据分别归属"。**

### 17.2 不一致的部分（**需要拍板，我不擅自改别人的门**）

| 模块 | 本报告 11.3 的判定 | `engine-boundary.mjs` 的判定 | 事实核对（已读源码） |
| --- | --- | --- | --- |
| **`world.ts`** | ❌ **不是引擎**（"它声明的是**战场 / 大厅 / 枢纽**这三块地 —— 那是这一款游戏的世界契约"） | ✅ **是引擎**（"世界系统（坐标 · 网格 · 区域）"） | **两边都对了一半**：坐标契约（原点左上 / y 向下 / 像素）**是引擎**；但 `ZONES` 的 `w:1680 h:1260 pad:26`、`w:1500 h:1120 pad:0` ×2 与 `GRIDS` 的 `cell:68` / `cell:12` / `cell:16` **全是写在本模块里的字面量**（`src/world.ts:61,66,71,124-126`） |
| **`object.ts`** | ⚠️ **一半**（"身份 `$id` 是引擎；11 类原型普查里那 11 类是内容"） | ✅ **是引擎**（"对象系统（身份 · 普查 · 分类账）"） | 同一形状：身份/普查/分类账**是引擎机制**，被普查的那 11 类原型**是本作的概念** |
| `ai.ts` | ❌ 不是（"怪物行为与弹幕模式 …… 就是玩法名词"） | 未列入 `ENGINE`，也**未列入** `DATA_TABLES` / `ENGINE_CANDIDATE` ⇒ 落在"其余"（内容侧） | **一致**。补充事实：`ai.ts` 的**机制**（注册表 + 未知名字当场抛错 + 依赖倒置到 `AiCtx`）其实是通用的，但**它在本模块里 `AI.behaviour('chase', …)` / `('ranged', …)` 直接注册了本作的行为**（`src/ai.ts:185,210`）—— 与 `world.ts` 的"数据写在同一模块里"**是同一个形状** |
| `draw2d.ts` | ❌ 不是（"API 表面是 `bronana` / `mouth` / `eye` / `dots` / `ditherBand`"） | 未列入 `ENGINE` ⇒ 内容侧 | **一致**（已核对 `src/draw2d.ts` 的 API 表面确有这几个名字） |

### 17.3 这次不一致的真正价值：一条**可判定的**分类规则

把 `world.ts`（判为引擎）与 `ai.ts`（判为内容）放在一起看，会发现**它们是同一个形状**：
**两者都是"通用机制 + 写在同一模块里的本作数据"**。
`engine-boundary.mjs` 对前者放行、对后者视为内容 —— 这**不是一个错误**，
但它暴露了那条判据还缺一个可判定的形式。建议补上（**推断，供拍板**）：

> **分类规则（推断，供拍板）**：一个模块是引擎，当且仅当
> ① 它 import 的东西全在引擎侧（R1/R2 通过），**且**
> ② 它里面的"本作数据"能在**不改变任何函数体**的前提下被集中到一张表里搬到内容侧 ——
> 即**数据与机制之间只隔着赋值，不隔着控制流**。

按这条规则重新过一遍：

| 模块 | 本作数据 | 数据与机制之间隔着什么 | 结论 |
| --- | --- | --- | --- |
| `world.ts` | `ZONES` / `GRIDS` 的字面量 | **只隔着赋值**（补一个导出/注入点即可搬走） | ✅ 引擎（**但要补那个注入点**） |
| `object.ts` | 11 类原型的普查项 | 同上 | ✅ 引擎（同上） |
| `ai.ts` | `AI.behaviour('chase', fn)` / `('ranged', fn)` | **隔着函数体** —— 搬走等于重写这两个行为 | ❌ 内容（机制可抽，但**抽出来要单开一轮**） |
| `draw2d.ts` | `bronana` / `mouth` / `eye` / `dots` | **隔着函数体**（画法就是函数体） | ❌ 内容 |
| `utils.ts` | `PAL` 的色值 | **只隔着赋值**（机制是取色能力，色值是表） | 机制 ✅ / 值 ❌ —— **与 `engine-boundary.mjs` 的写法一致** |

**这条规则的用法**：它把"我觉得它是引擎"变成**一次 diff 就能回答的问题** ——
"把这张表搬到内容侧，要不要改任何一行函数体？"
**这正是 8.6 判据 d（改平衡数字要不要动它）的同一条思路**，只是问的对象从"数值"换成了"表"。

### 17.4 对路线图的影响：**没有影响，只是阶段 1 变成"已完成一半 + 补两处"**

| 阶段 | 本报告原建议 | 现状 |
| --- | --- | --- |
| 阶段 0（颜色门 A07） | 新增 `tools/color-audit.mjs` | **仍未落地**（本次 `Test-Path` 核实为 False）—— **建议不变** |
| 阶段 1（声明边界） | `systems.cjs` 加 `domain`；新增 `tools/engine-audit.mjs`（R1/R2） | **R1/R2 已由 `tools/engine-boundary.mjs` 实现。** 剩下的两件事：① **把它登记进 `GATES` + `ci.yml`**（否则不算"改完"，家法第七节三处同步）；② 决定 17.2 那两处分类（`world.ts` / `object.ts`）算不算引擎 —— **按 17.3 的规则，算，但要补注入点** |
| 阶段 2~5 | 渲染后端接口 → 可验证后端 → 离屏 → WebGL2 | **完全不受影响**（与 `src/` 的领域分类正交） |

⚠ **一条提醒（家法第七节第 3 条）—— 这条已经实测红了**：
`engine-boundary.mjs` 到目前为止是**未登记**的（`git status` 显示为 `??`）。
**本次调研实跑了 `node tools/registry-drift.mjs`，退出码 `1`，报的就是这一条**：

```
=== 结果 ===
  ✘ 1 处漂移：
    · tools/engine-boundary.mjs 既没有 npm 脚本、也没有被 import —— 写好了没人能调
```

**未登记的工具不算"改完"** —— `tools/registry-drift.mjs` 就是为这件事存在的。
**这条必须补**（加 npm 脚本 或 被某处 import），否则它会像加 `solid` 门那次一样：
**两边都显示绿色，而 CI 比本地少跑一道门**。

> ⚠ **诚实标注**：这次 `drift` 变红**不是本报告造成的** ——
> 本报告只新增了 `docs/` 下的一个 `.md`（`registry-drift` 只扫 `tools/` / `test/` / `src/`，不看 `docs/`）。
> 它是**并行落地的那份工具自己的欠账**，列在这里是因为**它挡在阶段 1 的路上**：
> 阶段 1 的验收判据里写着"`pnpm verify` 全绿"，而在补登记之前**它不可能全绿**。


