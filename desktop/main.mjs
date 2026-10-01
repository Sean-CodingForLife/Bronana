/* =========================================================
   desktop/main.mjs — Electron 主进程（桌面模式的入口）

     pnpm run desktop            # 生产：起内置静态服务器 + 加载 dist/
     pnpm run desktop -- --dev   # 开发：加载 Vite 开发服务器（http://127.0.0.1:5180）

   为什么这么绕（起服务器再加载 http://127.0.0.1）：本作是真 ES 模块，
   Chromium 在 file:// 下会因 CORS 拒绝执行 module 脚本 —— 直接
   loadFile('dist/index.html') 会得到一个白窗口。所以窗口加载的是
   内置静态服务器（与"服务器模式"共用 server/static.mjs）的地址。

   Electron 不在依赖里也能跑这一条：没装就给一句"该怎么办"，而不是一堆栈。
   ========================================================= */

import path from 'node:path';
import process from 'node:process';
import { chooseUrl, describeLaunch, gpuMode, isNavigationAllowed, isRendererLaunchFailure, parseArgs, resolveDist, shellArgsOf, startServer, windowOptions } from './shell.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

/* 三种"跑不起来"的情况都要给人话，而不是一个栈：
     1) 没装 electron 包
     2) 装了包但二进制没下下来（受限网络/沙箱：@electron/get 默认写到 %LOCALAPPDATA%）
     3) 用普通 node 直接跑这个文件（此时 import('electron') 返回的是二进制路径字符串） */
let electron = null;
let notReady = '';
try {
  electron = await import('electron');
} catch (e) {
  notReady = String((e && e.message) || e);
}
if (!notReady && (!electron || !electron.app || !electron.BrowserWindow)) {
  notReady = 'electron 模块没给出 app/BrowserWindow（当前是被普通 node 加载的，不是 electron 主进程）';
}

if (notReady) {
  console.error('桌面模式还跑不起来：' + notReady);
  console.error('');
  console.error('  1) 装依赖：      pnpm add -D electron');
  console.error('  2) 首次安装要下 ~100MB 的 Electron 二进制；受限网络下它会因为');
  console.error('     往 %LOCALAPPDATA%\\electron 写缓存而失败，可以指定镜像/缓存目录：');
  console.error('       $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"');
  console.error('       $env:ELECTRON_CACHE  = "$PWD\\.electron-cache"');
  console.error('     pnpm 默认不跑依赖的安装脚本，所以装完还要放行一次：');
  console.error('       pnpm approve-builds && pnpm rebuild electron');
  console.error('  3) 只想现在就看游戏的话：pnpm run serve，用浏览器打开打印出来的地址');
  console.error('     （和桌面模式是同一份 dist、同一个内置静态服务器）');
  process.exit(1);
}

const { app, BrowserWindow, dialog } = electron;

/* ⚠ 用 `shellArgsOf` 而不是 `process.argv.slice(2)`：Electron 会把 Chromium 的
   开关放在脚本路径**之前**（`electron --no-sandbox main.mjs`），
   于是主进程里 `argv` 是 `[electron, '--no-sandbox', 'main.mjs']` ——
   朴素切片会把脚本路径自己当成参数并报"未知参数"（实测踩到）。
   完整说明在 `shell.mjs` 的 `shellArgsOf` 上面。 */
const opts = parseArgs(shellArgsOf(process.argv));
if (opts.errors.length) {
  console.error(opts.errors.join('\n'));
  process.exit(1);
}

/* **GPU 那一档必须在 `app.whenReady()` 之前定下来** ——
   `disableHardwareAcceleration()` 只在这之前调用才有效（之后就晚了）。
   默认关的理由与实测的报错原文写在 `shell.mjs` 的 `gpuMode` 上面那一节。 */
const gpu = gpuMode(opts, process.env);
if (!gpu.accel) app.disableHardwareAcceleration();
console.log('  显示    ' + (gpu.accel ? '硬件加速' : '软件合成（默认）') + ' —— ' + gpu.why);

let server = null;
let win = null;

async function boot() {
  const dist = resolveDist(ROOT, opts.root);
  if (!dist.ok && !opts.dev) {
    console.error(dist.reason);
    // 有窗口之前也要让用户看到原因（Electron 在无控制台时只显示 GUI）
    try { dialog.showErrorBox('Teapot Engine 启动失败', dist.reason); } catch (e) { /* headless */ }
    app.exit(1);
    return;
  }

  let base = opts.devUrl;
  if (!opts.dev) {
    server = await startServer(dist.dir, opts.port, function (line) { console.log('  ' + line); });
    base = server.url;
  }
  const url = chooseUrl(opts, base);
  console.log(describeLaunch(opts, opts.dev ? '(用开发服务器，不读 dist)' : dist.dir, url));

  win = new BrowserWindow(windowOptions(url));

  // 白屏闪一下很难看：等内容准备好再显示
  win.once('ready-to-show', function () { win.show(); });
  win.on('closed', function () { win = null; });

  // 这个游戏没有任何外链，所以窗口里的任何跳转/新窗口都当作异常拦下来。
  // （渲染进程是纯 canvas + DOM，不需要导航能力，也不需要往系统浏览器丢东西。）
  win.webContents.on('will-navigate', function (evt, target) {
    if (!isNavigationAllowed(target, url)) {
      evt.preventDefault();
      console.warn('已拦截窗口内导航：' + target);
    }
  });
  win.webContents.setWindowOpenHandler(function (details) {
    console.warn('已拦截新窗口：' + details.url);
    return { action: 'deny' };
  });
  win.webContents.on('render-process-gone', function (evt, d) {
    const reason = (d && d.reason) || '(未给出原因)';
    console.error('渲染进程结束：' + reason);
    /* `launch-failed` 是"它根本没起来"，而不是"跑着跑着崩了" ——
       这两件事的下一步完全不同，所以分开说。实测踩到过：Chromium 的
       **GPU 进程**起不来时，渲染进程会直接 `launch-failed`，而日志里
       只有一串 `gpu_process_host.cc` —— 不点明的话，用户会去查前端代码。 */
    if (isRendererLaunchFailure(reason)) {
      console.error('');
      console.error('  这一条的含义是"渲染进程没能起来"，而不是"页面里的代码报错"。');
      console.error('  最常见的两个原因：');
      console.error('    1) GPU 进程起不来（日志里会有 gpu_process_host.cc 的 ERROR）——');
      console.error('       本壳默认已经关掉硬件加速；若你显式加过 --gpu，去掉它再试一次。');
      console.error('    2) 安全软件 / 受管环境拦住了渲染进程的沙箱 ——');
      console.error('       先跑 `pnpm run serve` 用浏览器打开同一份 dist，确认那份是好的。');
      console.error('');
    }
  });

  /* ⚠ `loadURL` **会失败**，而它的拒绝如果不接住，Electron 会当成
     `UnhandledPromiseRejectionWarning` 打出来并结束进程（实测：
     磁盘缓存写不进去时 Chromium 报 `ERR_FAILED (-2) loading …`，
     窗口已经开好了，却因为这个拒绝被带走）。
     接住它 → 打印"哪一步失败 + 下一步做什么"，然后**让窗口与服务器继续活着**，
     用户至少看得到那个窗口（而不是什么提示都没有就没了）。 */
  try {
    await win.loadURL(url);
  } catch (e) {
    const msg = String((e && e.message) || e);
    console.error('加载失败：' + msg);
    console.error('');
    console.error('  窗口已经开好了，但这一趟没能把页面读进来。');
    console.error('  日志里若有 `disk_cache` / `Unable to move the cache` / `拒绝访问`，');
    console.error('  说明 Chromium 写不了它的用户数据目录 —— 那是**系统层面**的拦截。');
    console.error('  ⚠ 实测过：`--user-data-dir=<可写目录>` 并不总能绕过它（试过，仍被拒）。');
    console.error('  所以先走这一条，它用的是同一份 dist：');
    console.error('    pnpm run serve        # 用浏览器打开它打印的地址');
    /* 窗口关掉时进程自然结束；这里**不再抛**，让用户看见这一幕 */
  }
}

app.whenReady().then(boot);

app.on('window-all-closed', function () {
  if (server) server.close();
  app.quit();
});

app.on('activate', function () {
  if (BrowserWindow.getAllWindows().length === 0) boot();
});

// 关服务器：不留孤儿端口
app.on('before-quit', function () {
  if (server) { server.close(); server = null; }
});
