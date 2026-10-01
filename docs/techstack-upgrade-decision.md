---
title: "决定：渲染后端升级到 WebGL2（WebGPU 为目标态）"
category: 决定
scope: "用户 2026-10-01 拍板 —— **换 WebGL2，shader 是一等能力，不是可选收益**；引擎与内容分离为硬约束"
source: "用户原话（本轮）＋ 仓库现场实测（`test/modes.mjs` / `src/draw2d.ts` / `src/*.ts` 的 `D.*` 普查）"
links: ["docs/techstack-upgrade-research.md", "docs/requirements.md", "AGENTS.md"]
---

# 决定：换 WebGL2

> **本文件是拍板记录（决策与施工判据），不是调研。** 取证与来源在
> [`techstack-upgrade-research.md`](techstack-upgrade-research.md)；
> 需求账本要改的地方见本文第六节。

---

## 一、决定（用户拍板，2026-10-01）

> 「**shader 是一定要的**，因为我说了我是自研游戏引擎，游戏引擎该有的我的项目一个不少，
> 原因不止是因为我需要 shader 而是 **canvas 不适合再承载我未来的游戏引擎的开发工作了**，
> 我这是提前预判为未来铺路」
>
> 「如果一直是采用 canvas，**很容易把 html 和这个项目绑定死**，这不是我想看到的结果，
> 而且 **webgl 是更现代的更专业的计算机图形学的选择方案**，我没有理由不用他」
>
> 「**现有引擎再有内容**，这个一定要重视……**引擎和内容是两个不同的东西，
> 引擎就是游戏引擎，而内容就是通过游戏引擎开发得到的游戏本身**，他们是不同的东西，**有关系但不能耦合**」

**决定的内容**：

1. **渲染后端升级到 WebGL2。** 目标态是 **WebGPU**（接口现在就要按能容纳它来设计）。
2. **shader 是引擎的一等能力**，不是"有更好"的效果项。引擎必须拥有：
   shader 编译与 program 管理、材质/效果注册、渲染目标（pass / FBO）、后处理管线。
3. **Canvas2D 从"唯一渲染后端"降级为"其中一种后端"** —— 它继续存在，但要往后让位。
4. **引擎与内容必须分离，且不许耦合。** 引擎不认字（不认识本作的任何玩法名词），
   内容是"用这套引擎做出来的这一款游戏"。

### 1.1 我上一轮的框架错在哪（必须记下来，否则下次还会错）

我上一轮把问题建构成"**要不要 WebGL = 值不值（性能收益 ≥ 迁移代价）**"，
于是"shader"被降级成"收益清单里的第 2 项"，再由"本作目前没有全屏后处理需求"推回"暂不换"。

**这个框架是错的**，错在三处：

| # | 我的框架 | 实际 |
| --- | --- | --- |
| 1 | shader 是**收益项**（可要可不要） | shader 是**引擎的能力项**。一个"游戏引擎"没有可编程管线，不是"少个功能"，是**能力缺一档** |
| 2 | 换栈的判据是**性能阈值**（调用数 ≥ 900 或帧时间） | 用户的判据是**架构自主性与前瞻性** —— "**提前预判为未来铺路**"。这类判据**不是性能数字能表达的，也不该被性能数字否决** |
| 3 | 代价是"三块已建成资产"（我把它们当成沉没成本的**阻力**） | 同一批资产在"引擎化"视角下是**要被抽象掉的东西** —— `draw2d.ts` 直接写 Canvas2D，正是"引擎绑死在 HTML 上"的证据，**是待办不是资产** |

**用户第 2 条理由（"容易把 html 和这个项目绑定死"）我上一轮完全没考虑。** 它是本次决定里
**技术含量最高的一条**：`src/draw2d.ts` 的函数体直接操作 `CanvasRenderingContext2D`
（`strokeStyle` / `lineWidth` / `beginPath` / `moveTo` / `quadraticCurveTo` …），
`src/render.ts:40` 是 `canvas.getContext('2d')`。**这台引擎的"渲染能力"目前就是 HTML Canvas API 的一个薄包装** ——
换后端不是"优化"，是**把这层绑定解开**。

---

## 二、复核：我上一轮说重了的代价，和说轻了的代价

**本次复核实跑的命令与读数**（不是回忆）：

```
$ node test/modes.mjs
产物：js 744.8 kB（gzip 273.9）· css 28.2 kB（gzip 6.2）· html 32.9 kB（gzip 9.9）
      · **全站 gzip 290 kB**
PASS gzip 后的 JS ≤ 285 kB（现在 273.9）      ← 余量 11.1 kB
PASS 全站 gzip ≤ 300 kB —— 玩家真正下载的那一份（现在 290）      ← 余量 10 kB
```

```
$ D.* 调用点普查（src/*.ts）
总计 1900 处，但 99% 集中在少数文件：
  sprites.ts 630 · render.ts 191 · ui.ts 162 · forge.ts 64 · affixes.ts 54
  · station.ts 53 · data_items.ts 52 · stronghold.ts 48 · openings.ts 44 …
src/draw2d.ts 本身 382 行，D.* 约 25 个函数
```

### 2.1 我说重了的：「1,900 个调用点要改」——**不用改**

**上一轮我把"`D.*` 调用点"与"要改的代码"混在了一起。** 实际是：

> **`D.*` 的签名不变 ⇒ 1,900 个调用点一处都不用动。**
> 要重写的是 **`draw2d.ts` 里那约 25 个函数体（382 行）**。

这是本项目最有利的一条事实：**`draw2d.ts` 已经是一个"绘制原语唯一入口"**，
所以它**天然就是后端插点**（调研报告 §13.1 的判断成立，而它比我上一轮估计的**便宜得多**）。
`sprites.ts` / `render.ts` / `ui.ts` 那 983 处调用**全部不用改**。

**修正后的迁移量**：不是"1,900 处"，是 **`draw2d.ts` 382 行 + `render.ts` 的 ctx 建立处 + 若干烘焙路径**。

### 2.2 我说重了的：「三块已建成资产会被换掉」

- **`test/_ctx.mjs`（CTM 追踪桩）不必重写。** 因为 `D.*` 是唯一入口，
  桩可以继续服务 Canvas2D 后端；WebGL2 后端需要**自己的**调用记录桩（新写），
  但**不是"同一批断言换一套地基"** —— 两套桩**并存**，各测各的后端。
  调研报告 §13.3 阶段 2 的判据 ④（"`_ctx.mjs` 一行不改"）就是这个意思。
- **矢量造型的图集管线不用废弃。** 姿态图集（56 张 ≈ 0.57MB）**本来就是位图**，
  搬到 GL 就是"canvas → `texImage2D` 一次上传"。**烘焙流程不变，只多一步上传。**

### 2.3 我说轻了的（这三条才是真风险，必须写进施工判据）

| # | 风险 | 为什么我上一轮说轻了 | 现在怎么处理 |
| --- | --- | --- | --- |
| **1** | **文本渲染** | 我在调研报告里只写了"官方说 text 很贵"，**把"GL 没有文字原语"这件事漏了**。而 `D.text` 是**最高频的原语之一**（伤害飘字、HUD、图鉴、所有界面文案），且 Canvas2D 的 `fillText` **自带字体整形、字距、换行、emoji、CJK 排版** | **架构上不绕**（见第四节：目标/混合目标模型），**工程上必须单开一项**。三条路线见 4.3 |
| **2** | **3px 外轮廓 ≠ `lineWidth = 3`** | 我按 Canvas2D 的思维写了"线条边缘锐利"，**没想到 GL 的线宽被驱动钳制**。WebGL2 的 `lineWidth` 实际最大常常是 **1.0**（`ALIASED_LINE_WIDTH_RANGE` 由驱动给，多数只到 1） | **美术宪法第 1 条（3px 基线）要求走"三角形扩张描边"** —— 自己把线扩成三角带、自己算 join/cap。这不只是"能画粗线"，它还**更接近 Canvas2D 现有观感**（现有 `draw2d.ts` 用 `lineJoin='round'` / `lineCap='round'`，三角扩张能一比一复刻）。**这是本决定最大的一块新工作量** |
| **3** | **Y 轴约定** | 我把它当成"Phaser 的八卦"。**它是本项目的实例风险**：`world.ts` 的坐标契约写明"**原点是左上、y 朝下、单位是像素**" | **世界坐标一律不动（保持左上原点 / y 向下）**，只在投影矩阵里翻一次。**绝不允许 GL 的 y 向上约定渗透进 `world.ts` / `depth.ts` / `rig.ts`** —— 那正是 Phaser 4 花代价重压纹理的原因 |

### 2.4 预算：**11.1 kB 撑不住，必须走"写明理由的放宽"**

预算门（`test/modes.mjs` [9]）自己写着两条路：
> "**超预算只有两条路：砍体积，或者在 CHANGELOG 里写明为什么长。**"
> 放宽史：未压缩 720 → 750（R41 第二批）· gzip 275 → 280（R41 第三批）· 280 → 285（R50 第 10 条）

**WebGL2 后端 + 三角扩张描边 + shader 管理 + 纹理上传 + 后处理管线，净增必然超过 11.1 kB。**
所以这条**按既有流程走**：在 `CHANGELOG.md` 写明"为什么长"（本次是**引擎能力扩容**，
是 R41/R50 那几次"加内容"之外的**新类别**，值得单独写清），然后改 `test/modes.mjs` [9]
与 `vite.config.ts` 的注释。**这是流程内的动作，不是阻塞项。**

**但要守一条**：**放宽只许为"引擎能力"放宽一次，不许变成"每次加东西都放宽"的滑梯。**
建议放宽时**同时记下"其中多少 kB 是引擎、多少 kB 是内容"**，给未来一条对照基线。

### 2.5 `ui.ts` 的 162 处 `D.*` 说明一件事：**"后端"不是全局开关**

复核发现：`ui.ts` 里有 162 处 `D.*`，**另有 11 处 `getContext('2d')`** ——
它们画的是 **DOM 覆盖层里的辅助 canvas**（头像 / 图标 / 小图），**不是游戏主画布**。
`render.ts:40` 才是游戏主画布的 `getContext('2d')`。

**结论：一帧之内会同时存在两类绘制目标** —— 游戏世界（要迁到 GL）
与 UI 辅助 canvas（继续用 Canvas2D 更划算）。所以接口**不能设计成"一个全局后端开关"**，
必须设计成"**按目标（target）选择后端的 pass**"。**这一点改变了接口设计**，见第四节。

---

## 三、决定后的方向（不再是"要不要"，而是"怎么做对"）

### 3.1 目标态

```
                        ┌─────────────────────────────────────────┐
   内容（game）          │ 世界 / 玩法 / 美术造型 / 数据表 / UI     │
                        │ —— 只调用引擎的能力，不知道底层是什么 API │
                        └────────────────┬────────────────────────┘
                                         │  只许这一个方向：content → engine
                        ┌────────────────▼────────────────────────┐
   引擎（engine）        │  绘制原语 D.*  ← 1,900 个调用点的唯一入口 │
                        │  ├ 造型语言（path / stroke / fill / blend）│
                        │  ├ shader 管理（编译 / program / uniform） │
                        │  ├ 材质与效果注册表                        │
                        │  ├ pass / 渲染目标（屏幕 / 离屏 / 辅助 canvas）│
                        │  └ 后处理管线                              │
                        └────────────────┬────────────────────────┘
                                         │  后端是可替换的实现
              ┌──────────────────────────┼──────────────────────────┐
              ▼                          ▼                          ▼
        rhi_webgl2                  rhi_webgpu                 rhi_canvas2d
        （主后端，先做）              （目标态，后做）             （辅助目标 / 过渡期 / 无头）
```

**四条硬约束**：

- **R1** 引擎不得 import 内容（含"引擎源码里出现本作玩法名词"）。
- **R2** 引擎不得 import 数据表（`data_*` / `eco_*` / `curves` / `enemies` / `terms` …）。
- **R3** 引擎**不得出现 `CanvasRenderingContext2D` 类型**（这是"与 HTML 绑死"的机器判据）。
- **R4** 世界坐标契约（左上原点 / y 向下 / 像素）**只由 `world.ts` 声明**，
  后端不得反向定义它（Y 轴只在投影矩阵里翻一次）。

### 3.2 顺序：**先接口，再后端；但"先接口"不等于"慢慢来"**

用户要的是"**提前预判为未来铺路**"，所以**先铺路**是对的，而且铺路的成本比上一轮估的低得多（2.1）。
但**铺路的形状必须一次定对**，否则铺完还得拆。因此：

1. **第一步就把接口的形状定成"能容纳 WebGL2 + WebGPU + Canvas2D 三种后端、且按 target 多 pass"**
   （第四节），**而不是先做个"能跑起来就行"的薄壳**。
2. **第一步就用 WebGL2 后端去撞真实的硬骨头**（三角扩张描边、文本、混合模式映射），
   因为**这四件事决定了接口形状**；等接口定完再撞，接口就得改。
3. **Canvas2D 后端不是"过渡期的临时垃圾"**：它是**无头测试**（`rhi_null`）、
   **UI 辅助 canvas**、以及**低端回退**的载体 —— 它要留，但它的定位从"唯一"变成"其一"。

---

## 四、接口形状（本决定的技术核心）

> **与上一轮调研报告 §7.5 的差异**：那一版是"一个全局 `Rhi`，`beginPass(target)` 里 target 多为 0"，
> **不足以表达 2.5 节发现的"一帧之内两类目标"**。本版把它改成**目标先于后端**。

### 4.1 关键改动：`Target` 是一等对象，`Pass` 绑定后端

```ts
export type Handle = number;            // 0 = INVALID
export type Backend = 'webgl2' | 'webgpu' | 'canvas2d' | 'null';

/* 目标（画到哪）—— 决定用哪个后端 */
export interface TargetDesc {
  kind: 'screen' | 'canvas' | 'offscreen';
  backend: Backend;          // 'screen' 通常是 webgl2；'canvas' 是 UI 辅助 canvas
  canvas?: HTMLCanvasElement | OffscreenCanvas;   // kind==='canvas' 时给出
  width?: number; height?: number;                 // kind==='offscreen'
  nearest?: boolean;                                // 像素美术：NEAREST / imageSmoothingEnabled=false
}

/* 引擎对外只暴露"能力"，不暴露 API 类型（R3） */
export interface Rhi {
  init(opts: { screen: HTMLCanvasElement; prefer?: Backend[] }): void;
  readonly caps: Caps;                     // backendName / maxTextureSize / lineWidthMax / …
  resize(w: number, h: number): void;
  dispose(): void;

  /* 目标（不是"后端"） */
  createTarget(d: TargetDesc): Handle;
  destroyTarget(h: Handle): void;

  /* 帧与 pass：**pass 决定这一刻用哪个后端** */
  beginFrame(): void;
  beginPass(target: Handle, d?: PassDesc): void;   // 清屏 / viewport / scissor
  endPass(): void;
  endFrame(): void;

  /* 资源 */
  createTexture(d: TextureDesc): Handle;           // 位图（含"从 canvas 上传"）
  createShader(d: ShaderDesc): Handle;             // GLSL（后端专属，不跨翻译）
  createPipeline(d: PipelineDesc): Handle;         // 打包全部渲染状态
  destroy(h: Handle): void;

  /* 绑定与状态（内部脏检查缓存） */
  bindPipeline(h: Handle): void;
  bindTexture(slot: number, h: Handle): void;
  setUniform1f/2f/4f/Matrix3(...): void;
  setBlend(m: BlendMode): void;                    // 见 4.2 的映射表

  /* 提交 */
  draw(d: DrawDesc): void;                         // 三角带（描边已扩张成三角形）
  drawIndexed(d: DrawIndexedDesc): void;

  /* 引擎自己实现的高级件（不是后端的事） */
  // → 路径填充 / 三角扩张描边 / 文本 / 图集：都在引擎侧，用上面的原语拼出来
}
```

**为什么 `Target` 要带 `backend`**：`ui.ts` 的 11 处辅助 canvas 继续走 Canvas2D，
游戏世界走 GL。**同一个接口、同一帧、两种后端并存** —— 这才是"不切断既有 UI"的关键。

**为什么 shader 不走跨翻译**：sokol 与 SDL 都明确不做（调研报告 §7.3）。
引擎提供的是**"shader 的管理与注册"**，不是"一种语言编译到所有后端"。
WebGPU 的 WGSL 到那时**另写一份**（与 SDL 的"每后端一份格式"同一立场）。

### 4.2 三块必须一次定对的东西

**(a) 描边：三角扩张（替代 `lineWidth`）**

美术宪法第 1 条要求 **3px 基线外轮廓**，而 GL 的 `lineWidth` 常被钳到 **1.0**。
引擎必须自己实现：

- 把路径（含 `blobPath` 的**钝圆多边形** —— 二次曲线倒圆）转成**折线**；
- 用**三角带**把折线扩张成指定宽度的带（miter / bevel / round join）+
  **圆头 cap**（对应现有 `lineCap='round'`）；
- `fill` 走三角剖分（现有 `polyPath` / `blobPath` 都是凸/近凸多边形，可先用扇形三角化）。

**判据**：`test/rig.mjs` 的**包围盒断言**（CTM 桩能报每次 fill/stroke 的画布 bbox）
必须在 GL 后端下**也能量出来**，且与外扩量的设计值一致。**这是"描边对不对"的机器判据。**

**(b) 混合模式：26 → 可表达的子集 + shader 兜底**

`D.*` 现在用的 `globalCompositeOperation`（含 `source-in` 用于受击白闪剪影）
需要一张**显式映射表**：能映射到 GL `blendFunc/Equation` 的走映射，
映射不了的走 **shader 兜底**（采样目标 + 自算，即 Phaser 4 的 `Blend` filter 那条路）。
**表必须是声明表 + 自检**（家法第三节），不许散在 `if/else` 里。

**(c) 文本：架构上不绕，工程上单开一项**

这是最大的技术风险（2.3）。**不支持在引擎里放弃文本原语**，因为 `D.text` 是最高频原语之一。
三条路线与我的建议：

| 路线 | 做法 | 代价 | 评价 |
| --- | --- | --- | --- |
| **A · GL 内烘字形图集**（推荐） | 用离线的一个 2D canvas 把需要的字符集烘成图集，GL 里当精灵画 | 需要处理字号档位（本作 UI 字号是有限几种，**可枚举**）、CJK 子集（本作文案是中文）、字距 | **最符合"引擎自主"**；字号档位有限 ⇒ 可行性高 |
| B · 混合目标 | 文本走一个 Canvas2D 目标，叠在 GL 输出之上 | 需要合成两次、层序要小心 | **与 2.5 节的 Target 模型天然兼容**，可作为 A 的过渡或 A 的补充（长文本走 B、短文本走 A） |
| C · 保留 DOM 做文本 | HUD 文案全走 DOM | 与"与 HTML 绑死"的初衷**部分矛盾** | **只适合 UI 覆盖层**，不适合世界内的绘制文本（伤害飘字） |

**建议：A 为主，B 兜底**。并且**必须先把"本作到底用到哪些字符集与字号"普查出来**
（这是可枚举的，`tools/` 里加一个普查脚本即可，与既有 `draw-census` / `audio-census` 同一套路）。

---

## 五、分阶段施工（每阶段：门 + 行为指纹）

> 验收纪律不变：**每阶段都必须能回答"这一阶段做错了，哪道门会红"**。
> **纯重构阶段指纹必须逐位（`622d6ebf` / `a9c2902b` / `354cc83c`）不变。**

| 阶段 | 做什么 | 验收判据 | 若做错了哪道门会红 |
| --- | --- | --- | --- |
| **0 · 引擎边界门登记 + 颜色门** | ① 把 `tools/engine-boundary.mjs` **登记进 `GATES` + `ci.yml` + npm 脚本**（现在 `drift` **实测红**，见 6.3）；② 落 A07 颜色门（**`Test-Path tools/color-audit.mjs` = False，至今不存在**） | ① `drift` 转绿；② 两道新门**各注入一次坏数据必须变红**；③ `src/` 零改动，指纹不变 | `drift` / `yaml` / 新门 / `fingerprint` |
| **1 · 接口定型（`rhi.ts` + `rhi_null.ts` + `rhi_canvas2d.ts`）** | 按第四节定接口；Canvas2D 后端承载现有 `draw2d.ts` 逻辑（**一字不改语义**） | ① **指纹逐位不变**（唯一硬判据）；② **`test/_ctx.mjs` 一行不改**；③ `render-check` 逐层明细与改造前一致；④ **R3 检查**：`src/rhi*.ts` 与引擎侧不出现 `CanvasRenderingContext2D` 类型 | `fingerprint` / `test` / `art` / 新边界门 |
| **2 · 撞硬骨头（WebGL2 后端）** | `rhi_webgl2.ts`：context 建立、纹理上传、pipeline、**三角扩张描边**、`D.*` 逐个实现 | ① 两个后端下 `render-check` 的**逐层调用明细都能打出来**；② **`rig.mjs` 的包围盒断言在 GL 后端下也通过**（描边的机器判据）；③ 上下文丢失（`WEBGL_lose_context`）**可复现测试**；④ gzip 预算按 2.4 走流程放宽并记账 | `art` / `test` / `modes`（预算）/ `fingerprint` |
| **3 · shader 作为一等能力** | `createShader` / `createPipeline` / 材质与效果**注册表**（声明表 + `BY_ID` + 自检 + 进总账 —— 家法四步齐全）；后处理 pass | ① shader 家族在 `Registry` 里，且**有 `audit()`**；② **注入一个坏 shader / 坏 uniform 名，必须红**；③ 一条真实后处理（如全屏泛光）跑通且有测试 | `registry` / `guards` / `reconcile` / 新门 |
| **4 · 文本** | 按 4.3 的 A 为主 + B 兜底；先做**字符集与字号普查** | ① 普查脚本登记进 `tools/` 且 `drift` 绿；② 中文字形在 GL 下与 Canvas2D **像素差在声明阈值内**；③ 字号档位可枚举且有断言 | `drift` / `art` / `test` |
| **5 · 内容层切换到 GL 目标** | `render.ts` 主画布改 GL；`ui.ts` 辅助 canvas **按需**保留 Canvas2D | ① 三种形态（web / cli / desktop）都能起；② **`ui.ts` 的辅助 canvas 若保留，必须有显式声明的理由**；③ `modes` 门绿 | `test` / `modes` / `ui-check` |
| **6 · WebGPU 后端（目标态）** | 同一接口后接 `rhi_webgpu.ts`（WGSL 另写一份） | ① 与 WebGL2 后端**同帧同 seed 的像素差在声明阈值内**；② 不支持 WebGPU 的浏览器**自动降级**（`prefer: ['webgpu','webgl2','canvas2d']`） | `test` / `modes` |

**阶段 0 必须先做**，理由很实际：**边界门没登记之前 `drift` 是红的**，
而后面每个阶段的验收判据都写着"`pnpm verify` 全绿"。

---

## 六、需求账本要改的地方（**本文件不改，留给拍板后统一改**）

以下四处现在写的是"**暂不换**"，与本决定冲突，**必须改**（否则文档在说谎）：

| 位置 | 现在写的 | 要改成 |
| --- | --- | --- |
| `docs/requirements.md:1331` | R49「已盘点，**建议暂不换** —— 实测还有 2~3 倍余量……」 | R49 状态改为「**已拍板：换 WebGL2（目标态 WebGPU）**」；保留原盘点作为**背景**，把"暂不换"改为"**当时的结论，已被 2026-10-01 的架构决定取代**」 |
| `docs/requirements.md:1787-1846`（§十 R49） | 整节结论是"现在不换"+ 四条触发条件 | **不要删**（家法：注释与历史叙述不许改）。**追加一节「R49 结论变更」**，写明：① 用户 2026-10-01 的决定；② **为什么原来的判据不适用**（本文 1.1 的三条）；③ 新路线指向 `docs/techstack-upgrade-decision.md` |
| `docs/requirements.md:1991`（引擎清单第 19 项 GPU 渲染） | 「R49 已盘点：**暂不换**，四条触发条件……」 | 「**已拍板要做**（R49 结论变更）」 |
| `README.md:1704` | 「批处理这条线到此为止，**除非哪天换成 WebGL/离屏合成重写渲染层**」 | 「**换成 WebGL 已是决定**（见 `docs/techstack-upgrade-decision.md`）；批处理这条线到那时重新开」 |

**另外一条**（不是"暂不换"的冲突，但同样是欠账）：

| 位置 | 问题 | 要做什么 |
| --- | --- | --- |
| `tools/engine-boundary.mjs` | **实测 `drift` 红**：`既没有 npm 脚本、也没有被 import —— 写好了没人能调` | 加 npm 脚本 **且** 登记进 `GATES` + `ci.yml`（家法第七节：三处同步） |

### 6.3 一条必须重复的实测事实

```
$ node tools/registry-drift.mjs
=== 结果 ===
  ✘ 1 处漂移：
    · tools/engine-boundary.mjs 既没有 npm 脚本、也没有被 import —— 写好了没人能调
[exit=1]
```

**这是本次决定路上唯一一条"现在就是红"的东西。** 它不属于本决定的技术内容，
但**它挡在阶段 0**。**建议第一件事就是把它补绿** —— 否则后面每一阶段的
"`pnpm verify` 全绿"都无法达成，会变成"红着往下做"，那正是本项目最防的事。

---

## 七、结论

**我撤回上一轮的"暂不换"建议。** 用户的判据（引擎能力完整性 / 架构自主性 / 前瞻性）
**优先级高于"性能阈值"**，而我上一轮用后者否定了前者，这是**框架错误**。

**修正后的建议（一句话）**：

> **换，而且按"引擎先行"的顺序换** —— 先把 `draw2d.ts` 这层 HTML 绑定解开
> （接口要按能容纳 WebGL2 + WebGPU + Canvas2D **三种后端、多目标并存**来定），
> 再用 WebGL2 去撞三块真硬骨头（**三角扩张描边 / 文本 / 混合模式映射**），
> 最后才动 `render.ts` 与 `ui.ts` 的接线。
> **引擎不认识内容，内容只用引擎的能力** —— 这条是硬约束，由机器门守着。
