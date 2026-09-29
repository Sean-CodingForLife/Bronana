/* =========================================================
   server/static.mjs — 零依赖静态文件服务器（服务器模式 / 桌面外壳共用）

   为什么需要它：本作的 ES 模块在 `file://` 下会被 CORS 拦掉，
   所以 `dist/` 必须经 HTTP 打开（README「已知取舍」里那条）。
   于是「服务器模式」和「桌面外壳」都需要一个静态服务器 —— 就写一份。

   安全上的三条（都不是可选项）：
     1) 路径穿越防护：解析后的绝对路径必须仍在 root 之内（`..`、编码过的 `%2e%2e`、
        绝对路径、Windows 盘符都要挡住）
     2) 只监听 127.0.0.1（不回环以外的地址），并且只允许 GET / HEAD
     3) `X-Content-Type-Options: nosniff`，避免浏览器按内容猜类型

   纯 ESM、零依赖：Node 直接跑，Electron 的 ESM 主进程也能直接 import
   （Electron 自带的 Node 不支持类型擦除，所以这一份刻意不写成 TS）。
   ========================================================= */

import fs from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm'
};

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  if (body !== undefined && body !== null) res.end(body);
  else res.end();
}

/** 把请求路径映射成 root 之内的绝对路径；越界返回 null */
export function resolveInside(root, urlPath) {
  let p = String(urlPath || '/');
  const q = p.search(/[?#]/);
  if (q >= 0) p = p.slice(0, q);
  try {
    p = decodeURIComponent(p);
  } catch (e) {
    return null;                    // 非法百分号编码
  }
  p = p.replace(/\\/g, '/');        // Windows 反斜杠一律当分隔符
  if (p.indexOf('\0') >= 0) return null;
  // 显式拒绝含 `..` 段的请求。
  // 下面那句 posix.normalize('/' + p) 其实已经把 `..` 夹在 root 边界内了
  // （前导 `//../x` 会被折叠成 `/x`），但"依赖规范化的边界行为"读代码时很难确认、
  // 也没法直接测；显式拒绝既好读，也能被工具直接验证。
  if (/(^|\/)\.\.(\/|$)/.test(p)) return null;
  // 去掉盘符 / UNC 前缀，再按 POSIX 规范化
  const norm = path.posix.normalize('/' + p.replace(/^[A-Za-z]:/, ''));
  const abs = path.resolve(root, '.' + norm);
  const rootAbs = path.resolve(root);
  const rel = path.relative(rootAbs, abs);
  if (rel === '') return rootAbs;                                   // 就是 root 本身
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;     // 兜底：仍然不许越界
  return abs;
}

/**
 * 造一个请求处理器。root 之外的任何东西都取不到。
 * @returns {(req, res) => void}
 */
export function createHandler(opts) {
  const root = path.resolve((opts && opts.root) || 'dist');
  const onLog = (opts && opts.log) || null;

  return function handler(req, res) {
    const method = (req.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      send(res, 405, { 'Allow': 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' }, 'Method Not Allowed\n');
      return;
    }

    const urlPath = (req.url || '/').split('?')[0];
    let file = resolveInside(root, urlPath);
    if (file === null) {
      if (onLog) onLog('403 ' + urlPath);
      send(res, 403, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Forbidden\n');
      return;
    }

    let st = null;
    try {
      st = fs.statSync(file);
      if (st.isDirectory()) {
        const idx = path.join(file, 'index.html');
        if (fs.existsSync(idx)) { file = idx; st = fs.statSync(idx); }
        else { st = null; }
      }
    } catch (e) {
      st = null;
    }

    if (!st || !st.isFile()) {
      if (onLog) onLog('404 ' + urlPath);
      send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not Found\n');
      return;
    }

    const ext = path.extname(file).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': String(st.size),
      'X-Content-Type-Options': 'nosniff',
      // 带 hash 的构建产物可以长缓存；其余（html / 未打包的源码）必须每次校验，
      // 否则改完代码刷新看到的还是旧的 —— 开发时这种坑很难查
      'Cache-Control': /(^|[\\/])assets[\\/]/.test(file)
        ? 'public, max-age=31536000, immutable'
        : 'no-cache'
    };

    if (method === 'HEAD') {
      send(res, 200, headers);
      return;
    }
    if (onLog) onLog('200 ' + urlPath);
    res.writeHead(200, headers);
    const stream = fs.createReadStream(file);
    stream.on('error', function () {
      // 头部已经发出去了，只能中断连接
      try { res.destroy(); } catch (e) { /* ignore */ }
    });
    stream.pipe(res);
  };
}

/**
 * 监听。port 传 0 表示让系统分配一个空闲端口（桌面外壳用这个）。
 * @returns {Promise<{server:any, port:number, url:string, close:()=>Promise<void>}>}
 */
export function listen(opts) {
  const o = opts || {};
  const root = path.resolve(o.root || 'dist');
  const host = o.host || '127.0.0.1';       // 只回环：不要暴露到局域网
  const port = o.port === undefined ? 5180 : o.port;
  const handler = createHandler({ root: root, log: o.log });

  return new Promise(function (resolve, reject) {
    // 动态 import：Electron 主进程里 node:http 同样可用
    import('node:http').then(function (http) {
      const server = http.createServer(handler);
      server.on('error', reject);
      server.listen(port, host, function () {
        const actual = server.address().port;
        resolve({
          server: server,
          port: actual,
          url: 'http://' + host + ':' + actual + '/',
          close: function () {
            return new Promise(function (r) { server.close(function () { r(); }); });
          }
        });
      });
    }).catch(reject);
  });
}
