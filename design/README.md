---
title: "Teapot Engine 终端启动横幅"
category: 决定
id: D-005
status: 现行
scope: "横幅十一份产物分别对应哪一类终端场合（深底 / 浅底 / 无颜色 / 纯 ASCII）· 生成器 `banner.py` 的用法与四条自检 · 色值与版本号的声明处 · 引擎侧怎么用（`src/banner.ts` 的 `pick` / `text`）· 三种宿主各自接在哪一步。**不管**：`src/banner.ts` 的实现细节（那是代码自己的注释与门 `banner` 的事）"
source: "数字由 `python design/banner.py` 打印；四条自检由该脚本每次生成后自动跑；门 `banner` 在 CI 里逐字节对账两个载体"
links: ["banner.py", "banner-hero.txt", "../src/banner.ts", "../src/banner_data.ts", "../tools/banner-audit.mjs", "../docs/teapot-restructure.md", "../docs/workspace-spec.md"]
consequences: "**正**：横幅从「设计物料」变成**引擎能力** —— web / cli / desktop 三种宿主共用同一份产物，而且不破「零素材」（它是代码，不是资源文件）；改横幅只改生成器一处，十一份产物与引擎数据一起动。**负**：`src/banner_data.ts` 是**生成物**（手改会被下一次生成覆盖 ⇒ 只能靠门 `banner` 逐字节对账）；`design/` 从「未跟踪的用户草稿目录」变成**版本库里的决定文档**，它的 front matter 从此要按决定文档补编号 / 代价 / 落点（这条 D-005 自己就是第一个例子）。**未竟**：`desktop/shell.mjs` 的 stdout 没接（理由见 §五）。"
confirmation: "门 `banner`（`tools/banner-audit.mjs`）：两个载体**逐字节**对账 · 盘上与声明表一一对应 · 选档判据（含「一档都装不下」与「没传能力」）· 自证五种注入都会红；引擎侧 `Banners.audit()` 由 `SelfCheck` 在启动期跑（行数 / 列宽 / 降级档 / 版本号 / 矩阵两个方向 / 降级链落地）；门 `naming` 守「引擎模块里不许出现内容的名字」。"
---
# Teapot Engine — 终端启动横幅

> **引擎的**启动画面物料 —— 它讲引擎自己（版本 / 零运行时依赖 / 零素材 / 三种宿主），
> 一个字都不提游戏内容。
>
> **2026-10-02**：本目录进版本库；横幅同时被接成**引擎能力**（`../src/banner.ts`）
> 与**三种宿主**的启动输出（见 §五）。

---

## 一、文件清单

十一份 `.txt` 是同一份结构的降级产物，**不是十一套设计**。
数字由 `banner.py` 生成时打印，下表是**快照**（漂了以脚本输出为准）。

| 文件 | 行 | 列 | 真彩转义 | 非 ASCII | 用在哪 |
| --- | --- | --- | --- | --- | --- |
| `banner-hero.txt` | 12 | 39 | 有 | 有 | **深底**终端主横幅 |
| `banner-hero-light.txt` | 12 | 39 | 有 | 有 | **浅底**终端（字色换深） |
| `banner-hero-nocolor.txt` | 12 | 39 | 无 | 有 | 输出重定向 / `NO_COLOR` |
| `banner-hero-ascii.txt` | 12 | 51 | 无 | **无** | 老终端 / Windows 旧代码页 |
| `banner-framed.txt` | 15 | 66 | 有 | 有 | 卡框版 |
| `banner-framed-nocolor.txt` | 15 | 66 | 无 | 有 | 同上，无颜色 |
| `banner-framed-ascii.txt` | 15 | 66 | 无 | **无** | 同上，纯 ASCII |
| `banner-compact.txt` | 3 | 51 | 有 | 有 | 滚了几屏之后的脚本末尾 |
| `banner-compact-ascii.txt` | 3 | 67 | 无 | **无** | 同上，纯 ASCII |
| `banner-badge.txt` | 1 | 40 | 有 | 有 | 脚本 / CI 日志的单行徽标 |
| `banner-badge-ascii.txt` | 1 | 40 | 无 | **无** | 同上，纯 ASCII |

另有：

| 路径 | 性质 |
| --- | --- |
| `banner.py` | **手写 · 生成器**（唯一真相，见 §三） |
| `png/banner-sheet.png` · `png/banner-hero-dark.png` · `png/banner-hero-light.png` | 光栅预览（给人看的，**不是交付源**）—— 它们在 `.gitignore` 里（`design/png/`），理由见 §三 第 4 条 |

**这些列数不是装饰**：引擎侧 `Banners.pick()` 拿它判断"装不装得下"，
而 `Banners.audit()` 会用**另一套实现**（`src/banner.ts` 里声明的宽度表）重算一遍 ——
两边对不上就红。宽度算错的表现是**框线右边补不齐**，那是横幅唯一真正在做的事。

---

## 二、四档降级

四类终端场合各要一档：

| 档 | 什么时候用 | 不留会怎样 |
| --- | --- | --- |
| 深底（默认） | 绝大多数终端 | —— |
| **浅底** | 浅色主题终端 / 浅底文档截图 | 字标是白色，浅底上"白写白"，读不出来 |
| **无颜色** | `> out.txt` 重定向、CI 日志、`NO_COLOR=1` | 文件里塞满 `\x1b[38;2;…m`，读不了 |
| **纯 ASCII** | Windows 旧代码页、某些 SSH 客户端 | 吐豆腐块；框线错位 |

⚠ 四档**不是每种版式都有**：`light` 只有主横幅有，`nocolor` 只有主横幅与卡框有。
缺的那一档由引擎按**替补链**退（`compact` + 无颜色 ⇒ `compact-ascii`；
`framed` + 浅底 ⇒ `framed-nocolor` —— 浅底上宁可不上色，也不能给白字）。

---

## 三、怎么重新生成

```bash
python design/banner.py
```

**要改横幅就改这个脚本** —— `.txt` 与 `src/banner_data.ts` **都会**被覆盖。

脚本一次写出**两个载体**，它们是**同一份产物**的两种写法：

| 载体 | 给谁 | 为什么存在 |
| --- | --- | --- |
| `design/banner-*.txt`（十一份） | 给人看、给脚本贴 | 可以直接 `cat` 进终端、贴进文档 |
| `../src/banner_data.ts` | **引擎读**（`../src/banner.ts`） | 三种宿主共用；而且浏览器侧读不到磁盘，所以必须编进代码（也正因此**不破"零素材"**：横幅是代码，不是资源文件） |

脚本每次生成后会自己跑四条自检（`selfcheck()`），exit 0 才算过：

| 自检 | 判据 |
| --- | --- |
| **色值只有一个声明处** | 代码里出现的每个 `#rrggbb` 字面量都必须在文件顶部那份声明里 |
| **纯 ASCII 档真的是纯 ASCII** | 四个 `-ascii.txt` 里 `ord(c) > 127` 一处都不许有 |
| **两个载体是同一份东西** | 刚写出的 `.txt` 与 `banner_data.ts` 里那一条**逐字节一致** |
| **版本号只有一个声明处** | 十一份里不许出现第二个版本字面量（改版本最容易只改一半） |

第二条不跑脚本时也能单独查：

```bash
python -c "import os;print([(f,sorted({c for c in open('design/'+f,encoding='utf-8').read() if ord(c)>127})) for f in os.listdir('design') if f.endswith('-ascii.txt')])"
```

**另外四条实现细节**：

1. **CJK 必须按 2 列算**（脚本里的 `dw()`）。中文与 `·` 是双宽，直接用 `len()`
   会让居中偏左、框线右边补不齐。
2. 色值的四个绿是四个角色（主体 / 强调 / 次要 / 分隔线），
   顶部的声明块里逐个写明了用途。
3. **版本号刻意不从 `package.json` 读**：那是**两条轴** —— `package.json` 的 `version`
   跟着**工作区内容**走，横幅上的 `v0.1.0-alpha` 跟着**引擎能力**走。
   把它俩焊成一条，会让"引擎在没有任何游戏内容的仓库里也能报出自己的版本"这件事做不到。
4. **`png/` 那三张光栅预览不进版本库**（`.gitignore` 的 `design/png/`）。
   理由：横幅的**交付形态是文本**（`banner-*.txt` + `banner_data.ts`），预览图只是"给人看一眼"；
   而它是**二进制**，进了库就每次改版都多出一份只能整份替换的差异。
   ⚠ 连带一条纪律：front matter 的 `links` **不许**列它 —— 门 `doc-links` 判的是"链到的文件必须存在"，
   一列就会在**干净检出**里变红（本地有、仓库没有，正是本项目记过的"本地绿、CI 红"那一类）。

---

## 四、横向范围：横幅只做"字对齐 + 上色"

横幅不出图形。字符格是 1×2 的分辨率，细线造型在 30~40 列宽下无法保持可读，
所以图形不归横幅管 —— 横幅的职责就是**字对齐与上色**这两件它真正擅长的事。
需要图形时用图形物料，不要塞进文本横幅。

---

## 五、接进引擎与三种宿主（**2026-10-02 已落地**）

| # | 接在哪 | 现状 | 说明 |
| --- | --- | --- | --- |
| 0 | `../src/banner.ts`（引擎侧能力） | ✅ | 声明表 + `BY_ID` + `audit()` + `Registry.family`（四步齐全）；对外只有 `pick(env)` / `text(env)` —— **引擎不认识 Node / DOM，也不读环境变量**，能力由宿主算好传进来 |
| 1 | `../src/cli.ts` | ✅ | `help` 打**主横幅**；`sim` / `serve` 打**单行徽标**；`--no-color` / `NO_COLOR` / 输出重定向 ⇒ 无颜色档；`TEAPOT_BANNER_ASCII=1` ⇒ 纯 ASCII 档；**`--json` 一律不打**（机器可读输出里不掺装饰）；参数写错时也不打（那一屏的主角是"你哪里写错了"） |
| 2 | `../src/main.ts`（**web 与桌面共用这一份页面**） | ✅ | 定义期自检通过后往控制台打一条**徽标**；用**无颜色**档 —— 浏览器控制台不认识真彩转义，打出来是一堆 `[38;2;…]` 噪声 |
| 3 | `desktop/shell.mjs` 的 stdout | ❌ **刻意不做** | 理由见下 |

**第 3 条为什么不做**：桌面外壳的 stdout 在 `desktop/shell.mjs`，而它是**纯 `.mjs`**（Electron 主进程用）。
让它 `import '../src/banner.ts'` 就等于把「Electron 的 Node 能不能原生擦除 `.ts`」变成一条
**没验过的前提** —— 而本项目**没有能起真 Electron 的验收环境**（`pnpm shot` 是人工工具，
CI 里没有图形环境）。规矩是"没有跑过验收门就不说完成"，所以先不接。
真要接的时候，判据是**在真 Electron 里起一次并看到那行徽标**，不是"代码看着对"。

---

## 六、宿主怎么用（三行）

```js
import { Banners } from './banner.ts';          // 宿主侧（cli / main）
const env = { color: process.stdout.isTTY, cols: process.stdout.columns, tier: 'badge' };
console.log(Banners.text(env));                 // 选档 + 拼文本，一步到位
```

- `pick(env)` 回**一份产物**（`{ id, tier, variant, cols, rows, lines }`）；`text(env)` 直接回文本。
- `env` 的每个键就是"这个终端能干什么"：`color` / `light` / `ascii` / `cols` / `tier`。
  **缺省是主横幅、80 列、有颜色** —— 宿主什么都不说时的行为也说得清。
- **装不下由引擎降级**（`FALLBACK` 表），调用点不写 `if`；一档都装不下时给**最窄的那一份**
  （宁可挤一点，也不能什么都不打）。

---

## 七、已知缺陷

| # | 缺陷 | 影响 |
| --- | --- | --- |
| 1 | **未在真实终端渲染器里验过** | `png/` 下的预览图是用 Pillow 逐字符贴出来的，与真实终端可能有差别（尤其 box-drawing 字符的宽度）。要在 Windows Terminal / iTerm / VS Code 终端各截一张才算数 |
| 2 | `desktop/shell.mjs` 的 stdout 没有徽标 | 见 §五 第 3 条（**刻意**不接，附理由与验收判据） |
