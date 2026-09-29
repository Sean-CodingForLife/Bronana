/* =========================================================
   desktop/launch.mjs — 桌面模式的启动器（由 `pnpm run desktop` 调用）

   为什么不直接把 `electron desktop/main.mjs` 写进 package.json：
   Electron 的二进制不在 npm 包里，要单独下载（~100MB，默认走 GitHub）。
   下不下来时，报错发生在 **electron 自己的 cli.js 里** —— 使用者看到的是一堆栈，
   而不是"该怎么办"。这里先自己确认二进制在不在，不在就打印可照做的步骤。

   用法：
     pnpm run desktop            → 生产：内置静态服务器 + dist/
     pnpm run desktop -- --dev   → 开发：加载 Vite 开发服务器
   ========================================================= */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');

function guidance(detail) {
  console.error('桌面模式还跑不起来：' + detail);
  console.error('');
  console.error('  Electron 的二进制不在包里，要单独下载（约 100MB，默认走 GitHub）。');
  console.error('  这个网络环境请指定镜像与缓存目录，然后重跑一次安装脚本：');
  console.error('');
  console.error('    $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"');
  console.error('    $env:ELECTRON_CACHE  = "$PWD\\.electron-cache"');
  console.error('    pnpm rebuild electron      # 只重跑 electron 的安装脚本，不重装全部依赖');
  console.error('    pnpm run desktop');
  console.error('');
  console.error('  （项目 .npmrc 里已经写好 electron_mirror / electron_cache，pnpm 会读；');
  console.error('    如果你用的是 npm/cnpm，就用上面的环境变量。）');
  console.error('');
  console.error('  只想现在就看游戏：pnpm run serve，然后浏览器打开它打印的地址 ——');
  console.error('  和桌面模式是同一份 dist、同一个内置静态服务器。');
  process.exit(1);
}

let bin = null;
try {
  // 包装好的 electron 包在"二进制缺失"时会抛，而不是返回路径
  const mod = await import('electron');
  bin = mod.default || mod;
} catch (e) {
  guidance(String((e && e.message) || e).split('\n')[0]);
}

if (typeof bin !== 'string' || !fs.existsSync(bin)) {
  guidance('二进制不存在：' + String(bin));
}

const child = spawn(bin, [path.join(import.meta.dirname, 'main.mjs')].concat(process.argv.slice(2)), {
  cwd: ROOT,
  stdio: 'inherit'
});
child.on('exit', function (code, signal) {
  process.exit(signal ? 1 : (code === null ? 1 : code));
});
child.on('error', function (e) {
  guidance('启动失败：' + e.message);
});
