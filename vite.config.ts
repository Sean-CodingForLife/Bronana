import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

/* =========================================================
   **工作区清单的发现**（E4 第 0 批 · 无感知）
   ---------------------------------------------------------
   浏览器**读不到磁盘**，所以 web 形态的"宿主"在**构建机上**：
   把清单找出来、`define` 进包里，由 `src/main.ts` 交给引擎的 `Workspace.parse` 认
   （与 `cli.ts` 的"发现 → 读 → 交给引擎认"是同一条纪律，只是盘在哪一头）。

   ⚠ **两种边界都不许静默**：
     · `workspace/` 下**多份**清单 ⇒ 报错。一个构建只能绑一个工作区，
       "挑一份"是猜 —— 而猜错的表现是"读不到旧档"（静默、最难查）。
     · **一份都没有** ⇒ **不注入**（define 成 `null`），于是 `main.ts` 走**可见的失败**
       （崩溃卡），而不是悄悄退回某个写死的工作区。
   ========================================================= */
function workspaceDefine(): Record<string, string> {
  const base = path.join(import.meta.dirname, 'workspace');
  const files = fs.existsSync(base)
    ? fs.readdirSync(base, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => path.join(base, e.name, 'teapot.workspace.json'))
        .filter((p) => fs.existsSync(p))
        .sort()
    : [];
  if (files.length > 1) {
    throw new Error('workspace/ 下有 ' + files.length + ' 份清单（' + files.join(' · ') + '）：' +
      '一个构建只能绑一个工作区 —— 要么删掉多余的，要么显式指定（见 docs/workspace-migration.md）');
  }
  const value = files.length ? JSON.parse(fs.readFileSync(files[0], 'utf8')) : null;
  return { __TEAPOT_WORKSPACE__: JSON.stringify(value) };
}

/* =========================================================
   Vite 配置
   · dev：原生 ESM 直接跑 src/*.ts（esbuild 只做类型擦除，不做打包）
   · build：Rollup 输出 dist/，入口就是 index.html 里的 /src/main.ts
   · base 用相对路径，dist/ 放到任意子目录都能打开
   ---------------------------------------------------------
   ⚠ 关于 `pnpm build` 那条 "Some chunks are larger than 500 kB"：
   查过之后它不是错，是 Vite/Rollup 的**默认阈值**（按**未压缩**体积算，
   对"库"有信息量，对"单入口的整包游戏"没有）：

     · 本仓库 **0 个运行时依赖** —— 91 个被转换的模块全是自己写的 src/*.ts，
       没有第三方库可以拆出去（拆 vendor 这种操作在这里没有对象）
     · 拆成多 chunk 只会把**同一份要下载的字节**切成两次请求：
       浏览器启动时 registry / sprites / render / game / ui 全都要，
       拆不掉的启动路径，拆了反而多一轮往返
     · 所以这里把阈值换成**我们自己的预算**（与判据同源，见下）

   真正说话的数在 `test/modes.mjs` 的 [9] 一节：它量 `dist/` 里
   **gzip 之后**的体积（玩家真正要下载的那一份），并按这里的数字判超标。
   ⚠ **两个数、两件事，别混**（2026-10-01 用户拍板改的口径）：
     · **产品判据 = 玩家要下载多少** —— 那是 **gzip 之后**的体积，判据在 `test/modes.mjs` [9]。
     · **事故探测器 = 解析/编译要花多少** —— 那是这里的**未压缩**上限。
       它**不是** gzip 那条的副本：高度可压缩的巨型数据表（本仓库全是程序化数据表）
       gzip 之后可能仍然合规，而未压缩体积已经失控 —— 那一类**只有这条抓得住**。
   ⚠ 口径改过一次（理由见下面第五次那一条）：这两个数按**"做完时会有多大"**设，
   不按"今天有多大"挤 —— 这个项目的体量只会继续长，而每一次正常增长都不该变成一次仪式。
   但**仍然不许默默改**：改就必须在 `CHANGELOG.md` 写明理由（前四次放宽都留了账）。
   ⚠ **五次写明理由的调整**：未压缩 720 → 750（R41 第二批）·
     gzip 275 → 280（R41 第三批）· gzip 280 → **285**（R50 第 10 条：状态系统）·
     未压缩 750 → **760**（R59 / A07 / R57 第 1 步：引擎侧新增的三个门与它们的说明）。
     第四次的账（**必须记"多少 kB 是引擎"** —— 这是 R49 决定文档里写明的纪律）：
     实测 **753.1 kB**（超 3.1 kB），而**增量全部来自引擎** ——
     `viewport.ts` 是新模块、`grid.ts` 重写时把"为什么这么改"写进了注释、
     `U.pickWeighted` 收口成必填参数（"默认值破坏可复现性"那个坑）。
     **没有新增任何内容**（不是新武器 / 新怪 / 新系统）。
     **gzip 那一档仍有余量**（277.5 / 285），而 gzip 才是玩家真正下载的量。
     ⇒ 未来"内容"把它撑上去时，可以拿这一笔当对照基线，别让放宽变成滑梯。
     第三次的账：实测 273.8 kB（上一批 272.6），而那一轮加了 `status.ts`
     （约 400 行）并把它接进 `ai.ts` 的位置积分；**同一棵树上还有另一轮改动**
     （行尾规范化 + 27 个文件），所以那个读数不是单独一批的账。
     按前两批自己写下的规矩（"要再涨，先回来看这一节的理由还在不在"）：
     理由还在 —— 加的是**功能与系统**，不是依赖。
     未压缩那条（750 kB）没动，实测 744.2。
     **第五次（2026-10-01，用户改的是口径、不是数字）**：未压缩 **760 → 50000**。
     账：实测 **763.7 kB**（超 3.7 kB），而超出的部分**全部来自引擎** ——
     `viewport.ts` 新模块 · `grid.ts` 重写 · `U.pickWeighted` 收口 · RHI 与引擎侧三个门；
     **没有新增内容、没有新增依赖**。gzip 那一档仍有余量（282.2 / 285）。
     ⇒ **这一次不只是放宽，是换尺度**。用户的话：
     「我这个项目的体量只会不断地增长，应该**直接先预判最终大小**再去检查和重新设置」。
     按"今天 + 3 kB"设的阈值会让**每一次正常增长都变成一次仪式**，
     于是真正的信号（趋势）反而被噪音淹掉。
     所以：**未压缩这一档改成事故探测器**（50 MB —— 抓解析失控与 gzip 看不见的可压缩巨物），
     **产品判据单独留在 gzip 那一档**（`test/modes.mjs` [9]，按最终体量规划）。
     ⚠ 同日查出的另一个洞：这条判据读的是 `dist/`，而 `dist/` 是**构建产物** ——
     CI 从 #51 起连红 8 轮，本地却一直"全绿"，因为本地量的是**上一次构建的旧包**。
     已修：`test/modes.mjs` [9] **自己保证新鲜**（产物旧了就先构建）。
     ⚠ 记住这一条：**判据的结论不许取决于一个陈旧产物** —— 那与"一条不会失败的审计"
     是同一个形状，只是方向反了（它不会**失败**，而不是不会成功）。
   ========================================================= */
export default defineConfig({
  root: '.',
  base: './',
  /* 工作区清单（构建期发现）⇒ 打进包；`src/main.ts` 用它拿命名空间与入口身份 */
  define: workspaceDefine(),
  build: {
    outDir: 'dist',
    target: 'es2020',
    /* 未压缩 JS 的**事故探测器**（Vite 的单位是 kB=1000 字节）。
       ⚠ 这是**容量规划值**，不是"贴着今天"的预算 —— 账在文件头第五次那一条。
       实测 763.7 kB（2026-10-01），离这里还很远：它的职责是抓**解析/编译失控**，
       以及 **gzip 看不见的那一类**（高度可压缩的巨物：gzip 后仍合规、未压缩已经爆了）。
       真正的**产品判据是 gzip 那一档**（`test/modes.mjs` [9]）。
       ⚠ 上限只有**这一处**（判据读它）—— 两处不许各写一个。 */
    chunkSizeWarningLimit: 50000,
    /* sourcemap：默认**不发**。它在 dist/ 里是 2.75 MB —— 比整个游戏
       （html+css+js 共 0.73 MB）还大三倍，而玩家一个字节都用不到它。
       要用的时候（排查线上问题 / 读压缩后的原始数值）：
         PowerShell:  $env:TEAPOT_SOURCEMAP='1'; pnpm run build
         bash:        TEAPOT_SOURCEMAP=1 pnpm run build
       ⚠ **改名兼容**：这个变量原来叫 BRONANA_SOURCEMAP（引擎当时还叫 Bronana）。
         两个名字**都读**，新的优先 —— 否则已经设过旧变量的人会**静默失效**
         （家法里"改名只改一半"那一类坑）。旧名保留到下一个大版本再删，
         删的时候要在 CHANGELOG 写明。 */
    sourcemap: (process.env.TEAPOT_SOURCEMAP || process.env.BRONANA_SOURCEMAP) === '1',
    emptyOutDir: true,
    assetsInlineLimit: 0
  },
  server: {
    host: '127.0.0.1',
    port: 5180,
    strictPort: false,
    open: false
  },
  preview: {
    host: '127.0.0.1',
    port: 5180,
    open: false
  }
});
