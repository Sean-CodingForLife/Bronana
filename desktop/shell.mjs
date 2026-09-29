/* =========================================================
   desktop/shell.mjs — 桌面外壳里"与环境无关"的那部分（纯逻辑，不 import electron）

   拆出来的原因：Electron 的窗口要有显示器才能验证，而这一层
   （参数解析 / dist 定位 / 窗口安全选项 / 该加载哪个 URL / 起静态服务器）
   全部可以在无头环境里断言。`desktop/main.mjs` 只剩"把 electron 接上"。

   关键决定：**窗口不加载 file://dist/index.html**。
   本作是真 ES 模块，Chromium 在 file:// 下会因 CORS 拒绝执行 module 脚本；
   所以外壳自己起一个只回环的静态服务器，窗口加载 http://127.0.0.1:<port>/。
   这也是 server/static.mjs 被"服务器模式"和"桌面模式"共用的原因。
   ========================================================= */

import fs from 'node:fs';
import path from 'node:path';
import { listen } from '../server/static.mjs';

export const DEFAULT_DEV_URL = 'http://127.0.0.1:5180/';

/** 解析命令行：node desktop/main.mjs [--dev] [--dev-url URL] [--port N] [--root DIR] */
export function parseArgs(argv) {
  const opts = { dev: false, devUrl: DEFAULT_DEV_URL, port: 0, root: null, errors: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dev') { opts.dev = true; continue; }
    if (a === '--dev-url') { opts.devUrl = argv[++i] || opts.devUrl; continue; }
    if (a === '--port') { opts.port = Number(argv[++i] || 0) || 0; continue; }
    if (a === '--root') { opts.root = argv[++i] || null; continue; }
    opts.errors.push('未知参数 ' + a);
  }
  return opts;
}

/**
 * 找到要提供的目录。
 * dist 不存在时给的是"能照着做"的错误，而不是一个空窗口。
 */
export function resolveDist(root, explicit) {
  const dir = path.resolve(root, explicit || 'dist');
  if (!fs.existsSync(dir)) {
    return { ok: false, dir, reason: '目录不存在：' + dir + '\n先构建一次：pnpm run build（或 pnpm run dev 用开发服务器）' };
  }
  const index = path.join(dir, 'index.html');
  if (!fs.existsSync(index)) {
    return { ok: false, dir, reason: '缺少入口：' + index + '\n先构建一次：pnpm run build' };
  }
  return { ok: true, dir, index };
}

/**
 * 窗口安全选项。
 * 一个纯 Canvas 游戏不需要任何 Node 能力，所以全部关掉：
 * 关掉 nodeIntegration / 开 contextIsolation + sandbox + webSecurity，
 * 并且不允许窗口自己导航去别处（没有外链，导航一律视为异常）。
 */
export function windowOptions(url) {
  return {
    width: 1280,
    height: 720,
    minWidth: 640,
    minHeight: 360,
    backgroundColor: '#141414',
    autoHideMenuBar: true,
    show: false,                       // 等 ready-to-show 再显示，避免白屏闪一下
    title: 'Bronana',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: false,
      devTools: true
    },
    url
  };
}

/** 决定窗口该加载哪个地址：--dev 用 Vite 开发服务器，否则用外壳自己起的静态服务器 */
export function chooseUrl(opts, serverUrl) {
  if (opts.dev) return opts.devUrl;
  return serverUrl;
}

/** 需要被拦下来的导航：任何离开本地地址的跳转都不允许 */
export function isNavigationAllowed(target, allowedBase) {
  if (!target) return false;
  try {
    const t = new URL(target);
    const a = new URL(allowedBase);
    return t.origin === a.origin;
  } catch (e) {
    return false;
  }
}

/** 起静态服务器（桌面外壳用它；生产模式下 port 传 0 让系统分配） */
export async function startServer(distDir, port, log) {
  return listen({ root: distDir, host: '127.0.0.1', port: port || 0, log: log || null });
}

/** 把一段启动信息整理成人能读的几行（main.mjs 与测试都用它） */
export function describeLaunch(opts, dist, url) {
  const lines = [];
  lines.push('Bronana 桌面外壳');
  lines.push('  模式    ' + (opts.dev ? '开发（Vite 开发服务器）' : '生产（内置静态服务器）'));
  lines.push('  目录    ' + dist);
  lines.push('  加载    ' + url);
  return lines.join('\n');
}
