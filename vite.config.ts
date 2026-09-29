import { defineConfig } from 'vite';

/* =========================================================
   Vite 配置
   · dev：原生 ESM 直接跑 src/*.ts（esbuild 只做类型擦除，不做打包）
   · build：Rollup 输出 dist/，入口就是 index.html 里的 /src/main.ts
   · base 用相对路径，dist/ 放到任意子目录都能打开
   ========================================================= */
export default defineConfig({
  root: '.',
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2020',
    sourcemap: true,
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
