import { defineConfig } from 'vite';

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
   ⚠ 长过预算只有两条路：**砍体积**，或者在 CHANGELOG 里写明为什么长 ——
   不许把这里的数默默调高（基线只能变小，与 hardcode-audit 同一条规矩）。
   ⚠ **三次写明理由的放宽**：未压缩 720 → 750（R41 第二批）·
     gzip 275 → 280（R41 第三批）· gzip 280 → **285**（R50 第 10 条：状态系统）。
     第三次的账：实测 273.8 kB（上一批 272.6），而那一轮加了 `status.ts`
     （约 400 行）并把它接进 `ai.ts` 的位置积分；**同一棵树上还有另一轮改动**
     （行尾规范化 + 27 个文件），所以那个读数不是单独一批的账。
     按前两批自己写下的规矩（"要再涨，先回来看这一节的理由还在不在"）：
     理由还在 —— 加的是**功能与系统**，不是依赖。
     未压缩那条（750 kB）没动，实测 744.2。
   ========================================================= */
export default defineConfig({
  root: '.',
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2020',
    /* 未压缩 JS 的上限（Vite 的单位是 kB=1000 字节）。当前实测 723.9 kB。
       ⚠ 这个数是**上限**，判据在 test/modes.mjs [9]，两处不许各写一个。 */
    chunkSizeWarningLimit: 750,
    /* sourcemap：默认**不发**。它在 dist/ 里是 2.75 MB —— 比整个游戏
       （html+css+js 共 0.73 MB）还大三倍，而玩家一个字节都用不到它。
       要用的时候（排查线上问题 / 读压缩后的原始数值）：
         PowerShell:  $env:BRONANA_SOURCEMAP='1'; pnpm run build
         bash:        BRONANA_SOURCEMAP=1 pnpm run build */
    sourcemap: process.env.BRONANA_SOURCEMAP === '1',
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
