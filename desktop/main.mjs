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
import { chooseUrl, describeLaunch, isNavigationAllowed, parseArgs, resolveDist, startServer, windowOptions } from './shell.mjs';

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

const opts = parseArgs(process.argv.slice(2));
if (opts.errors.length) {
  console.error(opts.errors.join('\n'));
  process.exit(1);
}

let server = null;
let win = null;

async function boot() {
  const dist = resolveDist(ROOT, opts.root);
  if (!dist.ok && !opts.dev) {
    console.error(dist.reason);
    // 有窗口之前也要让用户看到原因（Electron 在无控制台时只显示 GUI）
    try { dialog.showErrorBox('Bronana 启动失败', dist.reason); } catch (e) { /* headless */ }
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
    console.error('渲染进程结束：' + (d && d.reason));
  });

  await win.loadURL(url);
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
