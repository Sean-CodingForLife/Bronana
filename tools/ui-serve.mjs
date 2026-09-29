/* =========================================================
   tools/ui-serve.mjs — 量尺专用的小服务器（把 .ts 现转成 JS）
   ---------------------------------------------------------
   为什么不用 vite：两件事
     1) vite 构建要先跑一遍打包，"改一行 CSS 看一眼"变成"改一行 + 打包 + 截图"
     2) 它的 Windows 真实路径解析会 spawn 一个子进程，在沙箱下直接被拒（EPERM）
   这里只做量尺要的那一件事：按请求把 src/**.ts 用 TypeScript 的 transpileModule
   转成 ESM 发出去（**不做类型检查** —— 类型由 tsc 守，这里只求"页面能跑起来"）。
   顺带的好处：量的是**源码**那一份，与 dist 无关，改了立刻看得见。

   只在工具里用，不进任何产品路径。
   ========================================================= */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import ts from 'typescript';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

const TRANSPILE = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  sourceMap: false,
  inlineSourceMap: true,
  removeComments: false
};

/** 起一个"能把 .ts 直接发给浏览器"的静态服务器；返回 { url, close } */
export function startTsServer(root, port = 0) {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent((req.url || '/').split('?')[0]);
    if (rel === '/' || rel === '') rel = '/index.html';
    const full = path.resolve(root, '.' + rel);
    if (!full.startsWith(root)) { res.writeHead(403).end('forbidden'); return; }
    fs.readFile(full, (err, buf) => {
      if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found: ' + rel); return; }
      if (full.endsWith('.ts')) {
        const out = ts.transpileModule(buf.toString('utf8'), {
          compilerOptions: TRANSPILE, fileName: full
        });
        res.writeHead(200, { 'content-type': MIME['.ts'], 'cache-control': 'no-store' });
        res.end(out.outputText);
        return;
      }
      res.writeHead(200, {
        'content-type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store'
      });
      res.end(buf);
    });
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        url: 'http://127.0.0.1:' + addr.port + '/',
        close: () => server.close()
      });
    });
  });
}

/* 直接用 node 跑这个文件 = 起一个能看的预览（不是产品路径，只为量尺/自查） */
const asFile = (p) => path.resolve(String(p || '')).replace(/\\/g, '/').toLowerCase();
if (asFile(process.argv[1]) === asFile(import.meta.filename)) {
  const root = path.resolve(import.meta.dirname, '..');
  const s = await startTsServer(root, Number(process.env.PORT) || 5199);
  console.log('量尺预览：' + s.url + '（Ctrl+C 退出）');
}
