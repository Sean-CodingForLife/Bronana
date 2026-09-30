# 参与开发

先把最要紧的一件事说清楚：**这个项目"改对了"的定义不是"看起来能跑"，
而是"下面这些门全绿"**。它们都是可执行的命令，不是人工检查表。

```bash
pnpm i                 # 装依赖（只有 4 个 devDependencies，没有运行时依赖）
pnpm dev               # 起开发服务器 → http://127.0.0.1:5180

# —— 提交前跑这一条就够（它就是下面那些门的总和）——
pnpm verify            # 全部 17 道门，约 90 秒
pnpm verify --quick    # 迭代用的快档，约 20 秒（跳过测试套件，并明说跳了什么）
pnpm verify --list     # 只是列出有哪些门、每道门在挡什么

# —— 也可以单独跑某一道 ——
pnpm typecheck         # tsc ×2（src + node 两套配置），必须 0 错
pnpm test              # 60 套测试，必须全绿
pnpm fingerprint       # 行为指纹，必须逐位不变（除非你是有意改行为，见下）
pnpm run audit         # 分层 / 环 / 死代码 / 未读字段
pnpm run guards        # 家族与模块守卫
```

> ⚠ **加门的唯一去处是 `tools/verify.mjs` 的 `GATES` 表。**
> `.github/workflows/ci.yml` 每个门一个 step（失败时一眼看出是哪道），
> 而那张手抄的清单**已经漂过一次** —— 加 `solid` 时忘了往 CI 里抄一份，
> 于是 CI 比 `pnpm verify` 少跑一道门，**两边都显示绿色**。
> 现在 `verify.mjs` 自己对账：每个门的脚本名必须出现在 `ci.yml` 里，
> 漏一条当场变红。所以往 `GATES` 加门之后，**顺手往 `ci.yml` 加一个 step**。

其余体检工具见 [`README.md`](README.md) 的"全量测试"一节，或直接看 `package.json` 的
`scripts`（每一个都能单独跑）。

---

## 环境

| | 版本 | 说明 |
| --- | --- | --- |
| Node | **24+** | 项目用 Node 原生类型擦除直接跑 `.ts`，不经过打包器 |
| pnpm | **12.5.1** | 写在 `package.json` 的 `packageManager`；用 corepack 会自动对上 |
| 运行时依赖 | **零** | `dependencies` 是空的。这是设计约束，不是巧合 |
| 素材文件 | **零** | 所有画面程序化绘制。见下面"关于素材" |

`devDependencies` 只有四个：`typescript`、`vite`、`electron`、`@types/node`。
**加第 5 个之前请先看本文最后一节。**

---

## 家法：每个概念都要"四步（声明 · 注册 · 自检 · 测试）齐全"

这是这个仓库最核心的约定。任何一个新概念（一种货币、一种设施、一种粒子、一条难度修正…）
都要有下面四样，**缺任何一样都会被审计工具点名**：

| # | 件 | 长什么样 | 缺了会怎样 |
| --- | --- | --- | --- |
| 1 | **声明表** | `var LIST: XxxDef[] = [ … ]` | 数据散在 `if/else` 里，没人能回答"一共有哪些" |
| 2 | **`BY_ID`** | `var BY_ID = {}` + 循环填 | 每处查找各写一遍，键名写错就静默取到 `undefined` |
| 3 | **启动期自检** | `Xxx.audit()` + `SelfCheck.register('Xxx', Xxx.audit)` | 表写错了，程序照样能起，只是某条效果悄悄不生效 |
| 4 | **注册进总账** | `Registry.family('xxx', { note, owner, entries\|values })` | 跨表引用的值写错**没人查** |

`SelfCheck.register` 的约定要记牢：**函数必须无参、返回 `{ ok, problems }`**，
而且**不能在启动期读别的模块的家族**（那个模块可能还没加载 ——
要用 `Registry.has(name)` 先问在不在）。

参考样板：`src/economy.ts`（最完整的一份）、`src/danger.ts`（最小的一份）。

### 自检**必须证明它会失败**

写完 `audit()` 之后，**注入一个坏数据确认它真的报错**，再删掉临时脚本：

```bash
# 例：临时脚本放 tools/tmp-*.mjs，验证完立刻删
node tools/tmp-verify-xxx.mjs
```

一条不会失败的审计等于装饰。这条纪律来自反复踩坑 ——
本项目有多次"加了个看似合理的检查，实际它永远不会红"的记录，
都写在 `README.md` 里。

---

## 行为指纹：重构的安全绳

```bash
pnpm run fingerprint
```

它把三个固定种子跑到固定帧数，对模拟层状态取哈希。**基线**：

```
ranger    seed 20240922 wave 5  1800 帧  →  8b90ed4f
gladiator seed 777      wave 9  1800 帧  →  08205e33
engineer  seed 4242     wave 13 1200 帧  →  f4f27172
```

- **纯重构**：必须**逐位不变**。变了就说明你动了不该动的东西。
- **有意改行为**：变了是正常的，但必须**同时**做两件事 ——
  ① 更新 `test/smoke.mjs` 里的 `CASES` 基线；② 在 [`CHANGELOG.md`](CHANGELOG.md) 里
  写清"改了什么、为什么"。
- 这条纪律的价值有实证：`scrap` 改名那一轮，指纹从 `8b90ed4f` 漂到 `dc906cdb`，
  由此发现**5 个工具在无声地读已经不存在的字段**。

---

## 分层：边只能从高指向低

`tools/systems.cjs` 是**唯一出处**（8 个系统 + 层号）。允许的依赖方向只有"高层 → 低层"，
**向上依赖必须逐条登记在 `EXCEPTIONS` 里并写明理由**（现在只有 2 条）。

```
8 boot      main.ts / cli.ts / demo.ts
7 view      render.ts / ui.ts / input.ts / diag.ts / crash.ts
6 art       sprites.ts / bronana.ts / audio.ts / music.ts …
5 run       save.ts / score.ts
4 sim       game.ts / market.ts / emit.ts / scene.ts / record.ts
3 meta      据点 / 工坊 / 天赋 / 档案 / 难度 / 设置 …
2 dungeon   dungeon.ts / arena.ts / story.ts
1 data      各种 data_*.ts / economy.ts / curves.ts
0 mech      utils.ts / registry.ts / selfcheck.ts / comp.ts / draw2d.ts …
```

有一条**隐含的硬约束**：`sim` 与更低层**不许 import DOM**。
这不是风格问题 —— 它是"48 套测试能在 Node 里跑"的前提。
确实需要浏览器 API 时，走 `typeof document === 'undefined'` 的显式降级分支
（`sprites.ts` 里有 7 处，每处都有对应的兜底绘制路径）。

---

## 写测试

测试是**无头**的（Node 里跑，没有真浏览器）。共享加载器是 `test/_load.mjs`：

```js
import { loadAll, SIM_MODULES } from './_load.mjs';
await loadAll(SIM_MODULES);            // 模拟层（不含 render/ui）
const { Game, Profile } = globalThis;  // 各模块导出挂到 globalThis
```

三个加载集合，按"你需要的层"选：

| 集合 | 含什么 | 什么时候用 |
| --- | --- | --- |
| `SIM_MODULES` | 模拟层（无 DOM） | 玩法规则、数值、存档 |
| `RENDER_MODULES` | 上面 + `render` | 绘制调用与预算 |
| `UI_MODULES` | 上面 + `ui` | 界面 DOM 与动作分发 |

需要 DOM 桩时用 `test/_ctx.mjs` 的 `installDom()` —— 它提供**带真实变换矩阵**的
Canvas2D 桩（专门用来抓"先建路径后 translate"这类只有浏览器才暴露的问题）。
**不要去扩展它**（文件头写了原因），也不要在桩里加 `Image` 或 `AudioContext`：
无头环境没有它们，**那是刻意的**（代码必须能在两个环境里跑）。

---

## 关于素材：为什么现在一张图都没有

**这不是"还没做"，是一个有意的架构选择，而且它正在被讨论是否改变。**

- **好处（已被兑现）**：48 套测试能在纯 Node 里跑、能断言几何而不只是"没崩"、
  改一个数值全局生效、仓库只有源码。
- **代价**：任何画面调整都要改代码；美术无法独立于程序员工作。

**结论是"能接图片，但必须先补一层"**：全仓 **0 处图片加载代码**，
没有 `public/` 或 `assets/` 目录，没有预载 / 进度 / 失败降级。
贴图缓存层（`sprites.ts` 的 `cached()`）是现成的接缝 ——
但"资源加载阶段"这一层要从零建，并且要为无头环境设计替身。

在你**先和我们讨论之前，不要自己动手引入图片素材** ——
它不是"加几个 png"那么小，会牵动测试链路与调色板（`PAL.setMode` 的色盲换档
现在靠"改 4 个颜色键 + 清贴图缓存"生效，图片不参与调色）。

---

## 提交信息

用**中文**写，格式 `类型: 一句话说清"改了什么、为什么"`。
这个仓库的提交历史是有意写得能读的（`git log` 本身就是文档）：

```
feat: 营地搬出战斗场景 —— 建材并入材料，闭合"打 → 造 → 再打"
fix: 补上"清间给材料" —— 模拟玩一遍才发现循环是断的
```

好的提交信息回答**"为什么"**，而不只是"改了什么"。
如果一个改动推翻了之前的结论，就把"原来的结论错在哪"写进去 ——
这个仓库里最值钱的提交信息都是这一类。

---

## 加依赖之前

`dependencies: null` 是**设计约束**。加运行时依赖前请先想清楚：

1. 这一件事**能不能自己写**？本项目的程序化音频、UI、序列化、图集缓存都是自己写的。
2. 它进哪个层？会不会让 `sim` 以下层认识 DOM 或网络？
3. 它会不会让"克隆下来 `pnpm i` 就能跑"变成"还要配环境"？

devDependencies 宽松一些（构建期工具），但**加之前最好先开 issue 讨论**。

---

## 文档在哪

全部文档的索引在 [`docs/README.md`](docs/README.md)。按**读者**分：

| 文件 | 写什么 |
| --- | --- |
| [`README.md`](README.md) | **门面**。玩法 / 操作 / 引擎与架构参考 / 性能 / 已知取舍 —— **只讲现在是什么样、为什么是这样** |
| [`docs/history/`](docs/history/README.md) | **交付记录**。逐轮改了什么、踩了什么坑、量出了什么（README 从 6305 行瘦回 1800 行的原因在这里） |
| [`docs/requirements.md`](docs/requirements.md) | **需求账本**。每一条需求 + 现状 + 证据；讨论在这里留痕 |
| [`CHANGELOG.md`](CHANGELOG.md) | **变更史**。玩家可感知的变化（短，面向玩家） |
| [`docs/external-benchmarks.md`](docs/external-benchmarks.md) | **外部参考**。同类游戏的公开设计数字（带来源强度标注） |
| [`docs/skill-audit.md`](docs/skill-audit.md) | **自检**。按行业判据逐条体检本作 |
| [`SECURITY.md`](SECURITY.md) | 安全模型与漏洞报告 |
| [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) | 协作约定（含 AI 生成内容那一节） |

> `README.md` 现在有 **1800 行**，可以通读，开头有目录。
> **不要再往它里面追加交付记录** —— 新的一轮追加到 `docs/history/` 的末尾（或另起一卷）。
> 这条是硬约定：它曾经漂到 6305 行，其中 76.6% 都是逐轮的交付记录。
