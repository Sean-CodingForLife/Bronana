/* =========================================================
   modes.mjs — 三种运行形态的契约测试（web / cli 服务器模式 / desktop）

   这一套不测玩法，测的是"怎么把游戏跑起来"这件事本身：
     · 模拟层在没有 DOM 的 Node 进程里能 import 并跑完（CLI 模式的地基）
     · 静态服务器：用途、MIME、缓存头、路径穿越防护、方法限制
     · CLI：参数解析、报告结构、退出码、可复现性
     · 桌面外壳的纯逻辑：参数、dist 定位、窗口安全选项、导航白名单
     · 三种模式共用同一份入口（index.html / dist），不各写一套
   用法： node test/modes.mjs
   ========================================================= */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { Writable } from 'node:stream';
import zlib from 'node:zlib';
import { installDom } from './_ctx.mjs';
import { loadAll, SIM_MODULES } from './_load.mjs';
import { createHandler, resolveInside, listen } from '../server/static.mjs';
import * as shell from '../desktop/shell.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
installDom();
const g = globalThis;
await loadAll(SIM_MODULES);      // 本进程也把模拟层挂到 globalThis（cliInput 那段要用）

let failures = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  \x1b[32mPASS\x1b[0m ' + label);
  else { failures++; console.log('  \x1b[31mFAIL\x1b[0m ' + label + (extra !== undefined ? '  → ' + extra : '')); }
}
const readSrc = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
/** 去掉注释再做源码断言：否则"解释为什么不用 file://"的注释本身会被当成违规 */
const stripComments = s => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const readCode = p => stripComments(readSrc(p));
const SPAWN_OUT = path.join(ROOT, '.modes-child-out.txt');

/* =========================================================
   构建产物：**缺了就自己构建一次**（这一条是 CI 教我的）
   ---------------------------------------------------------
   `[3]` 与 `[4]` 两节要读 `dist/`（静态服务器的 MIME / 缓存头 / 路径穿越
   都要有真文件才测得动）。原先它们**假定 `dist/` 已经存在** ——
   本地开发机上一直留着上次构建的产物，所以从来没暴露；
   而 CI 上从不执行 `pnpm run build`，于是：

     fs.readdirSync(path.join(root, 'assets'))
     → ENOENT → **整套测试崩在这里**，后面一节都不跑。

   表现是"本地全绿、CI 必红"，而红的地方看起来与改动毫无关系。
   现在缺了就现场构建：这套测试因此在任何干净环境里都能自足跑完。
   构建失败不抛（那会让报错变成构建器的报错），而是记下来让下面的
   `ok(...)` 如实报"缺产物"。 */
const DIST = path.join(ROOT, 'dist');
let buildNote = '';
if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.log('  \x1b[33m[setup] dist/ 不存在或没有 index.html —— 先构建一次（要几秒）…\x1b[0m');
  const b = spawnSync('npx', ['vite', 'build'], { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' });
  if (b.status !== 0 || !fs.existsSync(path.join(DIST, 'index.html'))) {
    buildNote = '自动构建失败（请手动 pnpm run build）：' +
      String((b.stderr || b.stdout || '').split('\n').filter(l => l.trim()).slice(-3).join(' / ')).slice(0, 300);
    console.log('  \x1b[31m[setup] ' + buildNote + '\x1b[0m');
  } else {
    console.log('  \x1b[32m[setup] 构建完成\x1b[0m');
  }
}

/**
 * 起一个子进程并把它的 stdout+stderr 收进文件。
 * 不用管道：本沙箱下"用管道抓子进程输出"是被拒的（named pipe 不允许），
 * 用文件描述符则两边都能跑。tools/run-suites.cjs 出于同样原因也是这么做的。
 */
function runNode(args, timeout) {
  const fd = fs.openSync(SPAWN_OUT, 'w');
  const r = spawnSync(process.execPath, args, {
    cwd: ROOT, stdio: ['ignore', fd, fd], timeout: timeout || 180000
  });
  fs.closeSync(fd);
  const out = fs.existsSync(SPAWN_OUT) ? fs.readFileSync(SPAWN_OUT, 'utf8') : '';
  try { fs.unlinkSync(SPAWN_OUT); } catch (e) { /* ignore */ }
  return { status: r.status, out: out, err: r.error ? r.error.message : '' };
}

/** 假的 ServerResponse：必须是可写流，因为处理器用 createReadStream().pipe(res) */
class FakeRes extends Writable {
  constructor() {
    super();
    this.statusCode = 0;
    this.headers = null;
    this.chunks = [];
    this.done = new Promise(resolve => { this._resolve = resolve; });
    this.on('finish', () => this._resolve(this));
  }
  _write(chunk, enc, cb) { this.chunks.push(chunk); cb(); }
  writeHead(code, headers) { this.statusCode = code; this.headers = headers || {}; return this; }
  get body() { return Buffer.concat(this.chunks).toString('utf8'); }
  /** 头部发出后被打断的连接（流读取出错） */
  destroy(err) { this._resolve(this); return super.destroy ? super.destroy(err) : this; }
}

console.log('\n=== Bronana · 三种运行形态（web / cli / desktop） ===\n');

console.log('[1] 模拟层必须能在没有 DOM 的进程里加载（CLI 模式的地基）');
{
  // 关键：不要用本进程（它装了 DOM 桩），而是另起一个干净进程。
  // `-e` 默认按 CJS 求值，所以这里显式 --input-type=module 才能用顶层 await。
  const script = [
    'const { Game } = await import("./src/game.ts");',
    'console.log("nodom=" + (typeof window === "undefined" && typeof document === "undefined"));',
    'const s = Game.newRun("gladiator", 7);',
    'Game._internals.startWave(3);',
    'for (let i = 0; i < 300; i++) { if (Game.state === "playing") Game.step(Game.cfg.fixedDt, { x: 0, y: 0 }); }',
    'console.log("ran wave=" + Game.wave + " enemies=" + s.enemies.length);'
  ].join('\n');
  const r2 = runNode(['--input-type=module', '-e', script]);
  const out = r2.out;
  ok(/nodom=true/.test(out), '干净进程里确实没有 window / document',
    (out.split('\n')[0] || '（没有输出）') + ' ' + r2.err);
  ok(/ran wave=3/.test(out), '并且真的能无头推进一局（第 3 波、场上 ' +
    ((out.match(/enemies=(\d+)/) || [])[1] || '?') + ' 只怪）', out.split('\n').slice(-2).join(' '));
}

/* =========================================================
   静态服务器（服务器模式 / 桌面模式共用）
   ========================================================= */
console.log('\n[2] 静态服务器：路径解析（穿越防护）');
{
  const root = path.join(ROOT, 'dist');
  ok(resolveInside(root, '/') === path.resolve(root), '根路径解析到 root 本身');
  ok(resolveInside(root, '/index.html') === path.join(root, 'index.html'), '普通文件路径正确');
  ok(resolveInside(root, '/a/b/c.js') === path.join(root, 'a', 'b', 'c.js'), '多级路径正确');
  ok(resolveInside(root, '/index.html?v=1#x') === path.join(root, 'index.html'), '查询串与 hash 被剥掉');
  ok(resolveInside(root, '/%69ndex.html') === path.join(root, 'index.html'), '百分号编码被解码');

  const escapes = [
    '/../package.json', '/..%2fpackage.json', '/%2e%2e/package.json',
    '/assets/../../package.json', '/a/b/../../../x', '//../x',
    '/..\\package.json', '/%2e%2e%5cpackage.json', '/\u0000x'
  ];
  const leaked = escapes.filter(p => resolveInside(root, p) !== null);
  ok(leaked.length === 0, '全部 ' + escapes.length + ' 种越界写法都被拒绝（含编码、反斜杠、NUL）',
    leaked.join(' , '));
  ok(resolveInside(root, '/%zz') === null, '非法百分号编码被拒绝');
  const c = resolveInside(root, '/C:/Windows/system32/drivers/etc/hosts');
  ok(c === null || c.startsWith(path.resolve(root)), '带盘符的路径不会逃出 root', String(c));
}

console.log('\n[3] 静态服务器：请求处理（假 req/res，不占端口）');
{
  const root = path.join(ROOT, 'dist');
  const handler = createHandler({ root });

  /** 同步路径（404/403/405/HEAD）——这些处理器直接 end() */
  function call(method, url) {
    const res = new FakeRes();
    handler({ method, url, headers: {} }, res);
    return res;
  }
  /** 走流的分支要等 finish */
  async function callAsync(method, url) {
    const res = new FakeRes();
    handler({ method, url, headers: {} }, res);
    return await res.done;
  }

  const r404 = call('GET', '/nope.js');
  ok(r404.statusCode === 404, '不存在的文件 → 404', String(r404.statusCode));
  const r403 = call('GET', '/../package.json');
  ok(r403.statusCode === 403, '越界路径 → 403（不是 404，说明是被主动拒绝的）', String(r403.statusCode));
  const r405 = call('POST', '/index.html');
  ok(r405.statusCode === 405 && r405.headers.Allow === 'GET, HEAD',
    '非 GET/HEAD → 405 且给出 Allow', r405.statusCode + ' ' + r405.headers.Allow);
  const rHead = call('HEAD', '/index.html');
  ok(rHead.statusCode === 200 && rHead.chunks.length === 0, 'HEAD → 200 但无响应体');

  const idx = await callAsync('GET', '/');
  ok(idx.statusCode === 200, 'GET / → 200');
  ok(/text\/html/.test(idx.headers['Content-Type'] || ''), 'index.html 的 Content-Type 正确',
    idx.headers['Content-Type']);
  ok(/^no-cache/.test(idx.headers['Cache-Control'] || ''), 'html 用 no-cache（改完刷新立刻生效）',
    idx.headers['Cache-Control']);
  ok(idx.headers['X-Content-Type-Options'] === 'nosniff', '带 nosniff');
  ok(Number(idx.headers['Content-Length']) > 0, '给出 Content-Length');
  ok(idx.body.length > 100, '响应体真的是流式写出来的（' + idx.body.length + ' 字节）');

  /* ⚠ 这里**不能直接 readdirSync**：`dist/assets/` 不存在时它会抛，
     而抛异常 = 整套测试崩在这里、后面一节都不跑（CI 上就是这样）。
     缺产物要**如实报成一条失败**，而不是让测试死掉。 */
  const assetsDir = path.join(root, 'assets');
  if (!fs.existsSync(assetsDir)) {
    ok(false, 'dist/assets 存在（缺产物）', buildNote || '先跑 pnpm run build');
  } else {
    const assets = fs.readdirSync(assetsDir);
    const js = assets.find(f => f.endsWith('.js'));
    ok(!!js, 'dist/assets 里有构建产物（否则先 pnpm run build）', assets.join(','));
    if (js) {
      const a = await callAsync('GET', '/assets/' + js);
      ok(a.statusCode === 200 && /javascript/.test(a.headers['Content-Type'] || ''),
        '构建产物可下载且类型正确', a.statusCode + ' ' + a.headers['Content-Type']);
      ok(/immutable/.test(a.headers['Cache-Control'] || ''),
        '带 hash 的产物用 immutable 长缓存', a.headers['Cache-Control']);
      ok(a.body.length > 1000, '产物内容非空（' + a.body.length + ' 字节）');
    }
  }
}

console.log('\n[4] 静态服务器：真实监听 + 裸 socket 穿越请求');
{
  let srv = null;
  try {
    srv = await listen({ root: path.join(ROOT, 'dist'), port: 0 });
  } catch (e) {
    ok(false, '能在 127.0.0.1 上监听（沙箱若禁网会失败）', e.message);
  }
  if (srv) {
    ok(srv.port > 0 && /^http:\/\/127\.0\.0\.1:\d+\/$/.test(srv.url),
      '自动分配端口并给出可用地址（' + srv.url + '）');
    const res = await fetch(srv.url);
    ok(res.status === 200, 'HTTP 取回 index.html', String(res.status));
    const html = await res.text();
    ok(/<script[^>]+src=/.test(html), 'index.html 里有入口脚本');

    // fetch/浏览器会在客户端把 /../ 规范化掉 —— 必须用裸 socket 才测得到服务器自己
    const raw = p => new Promise(resolve => {
      const s = net.connect(srv.port, '127.0.0.1', () => {
        s.write('GET ' + p + ' HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n');
      });
      let buf = '';
      s.on('data', d => { buf += d.toString('latin1'); });
      s.on('close', () => resolve(buf));
      s.on('error', e => resolve('ERR ' + e.message));
    });
    const bad = [];
    for (const p of ['/../package.json', '/%2e%2e/package.json', '/assets/../../package.json', '/..%2fpackage.json']) {
      const r = await raw(p);
      const code = (r.match(/^HTTP\/1\.1 (\d+)/) || [])[1];
      if (code !== '403' && code !== '404') bad.push(p + '→' + code);
      if (r.indexOf('"devDependencies"') >= 0 || r.indexOf('"scripts"') >= 0) bad.push(p + ' 泄漏了内容');
    }
    ok(bad.length === 0, '裸 socket 的 4 种穿越写法都拿不到 dist 之外的文件', bad.join(' , '));
    const good = await raw('/index.html');
    ok(/^HTTP\/1\.1 200/.test(good), '裸 socket 请求正常文件仍是 200');
    await srv.close();
    ok(true, '服务器可以关掉（不留孤儿端口）');
  }
}

/* =========================================================
   CLI
   ========================================================= */
console.log('\n[5] CLI：参数解析与报告');
{
  const cli = await import('../src/cli.ts');

  const bad = cli.parseArgs(['sim', '--char', 'nope']);
  ok(bad.errors.length > 0, '未知角色被拒绝', bad.errors.join(' '));
  const unknown = cli.parseArgs(['frobnicate']);
  ok(unknown.errors.length > 0 && unknown.cmd === 'help', '未知子命令被拒绝并退化成 help');
  const opt = cli.parseArgs(['sim', '--char', 'ranger', '--wave=5', '--seconds', '12', '--seed', '99', '--json']);
  ok(opt.cmd === 'sim' && opt.opts.char === 'ranger' && opt.opts.wave === 5 &&
    opt.opts.seconds === 12 && opt.opts.seed === 99 && opt.opts.json === true,
    '--key value 与 --key=value 都能解析', JSON.stringify(opt.opts));
  ok(cli.parseArgs(['sim', '--seconds', 'abc']).errors.length > 0, '非数值参数被拒绝');
  ok(cli.parseArgs(['sim', '--seconds']).errors.length > 0, '缺取值的参数被拒绝');
  ok(cli.parseArgs(['sim', '--no-auto']).opts.auto === false, '布尔选项可用 --no-xxx 关掉');
  ok(cli.parseArgs(['serve']).opts.root === 'dist' && cli.parseArgs(['serve']).opts.host === '127.0.0.1',
    'serve 的默认值：dist + 只回环');

  const r = cli.runSim({ char: 'gladiator', wave: 1, seconds: 20, seed: 4242, auto: true });
  /* 房间制之后"跑满 20 秒"不再是必然：一间打完就进商店、怪按房间数成长，
     所以 20 秒里可能已经打到第 4 间并且**阵亡**（实测这个种子就是这样）。
     判定改成"跑够步数 + 说清为什么停"，而不是假定一定能撑满。 */
  ok(r.steps > 500 && (r.stopReason === 'time' || r.stopReason === 'ended'),
    'sim 真的跑了 ' + r.steps + ' 步（' + r.simSeconds + ' 秒游戏时间 · 停止原因 ' + r.stopReason + '）');
  ok(r.simSeconds > 8, '跑出了有意义的时长', r.simSeconds + ' 秒');
  ok(typeof r.kills === 'number' && Array.isArray(r.weapons) && r.step.trimmedMeanMs > 0,
    '报告字段齐全', Object.keys(r).join(','));
  ok(r.charName === '角斗士' && r.seed === 4242, '报告带角色名与种子');
  const txt = cli.formatReport(r);
  ok(txt.split('\n').length >= 8 && txt.indexOf('性能') >= 0, '表格报告可读（' + txt.split('\n').length + ' 行）');

  // 同种子可复现：CLI 的自动操作只依赖局面 + 时间
  const r2 = cli.runSim({ char: 'gladiator', wave: 1, seconds: 20, seed: 4242, auto: true });
  ok(r.kills === r2.kills && r.damage === r2.damage && r.waveReached === r2.waveReached,
    '同种子结果完全一致（可复现）', r.kills + ' vs ' + r2.kills);
  const r3 = cli.runSim({ char: 'gladiator', wave: 1, seconds: 20, seed: 4243, auto: true });
  ok(r3.kills !== r.kills || r3.waveReached !== r.waveReached || r3.damage !== r.damage,
    '换种子结果不同（不是假的可复现）');

  // 自动操作与无头测试用的 autoInput 不是同一套（后者只为覆盖代码路径）
  const sess = g.Game.newRun('gladiator', 1);
  const mine = cli.cliInput(sess, 0);
  const theirs = g.Game.autoInput(0);
  ok(Math.abs(mine.x) <= 1 && Math.abs(mine.y) <= 1, 'CLI 自动操作输出归一化方向向量',
    JSON.stringify(mine));
  ok(typeof theirs.x === 'number', 'Game.autoInput 仍然可用（测试依赖它）');
}

console.log('\n[6] CLI 入口：真起进程（退出码 + 输出）');
{
  const help = runNode(['src/cli.ts', 'help']);
  ok(help.status === 0 && /Bronana 命令行/.test(help.out), 'help 退出码 0 且打印用法',
    String(help.status) + ' ' + help.err);
  const sim = runNode(['src/cli.ts', 'sim', '--seconds', '8', '--json']);
  ok(sim.status === 0, 'sim --json 退出码 0', String(sim.status) + ' ' + sim.out.slice(0, 200));
  let parsed = null;
  try { parsed = JSON.parse(sim.out.slice(sim.out.indexOf('{'))); } catch (e) { /* 下面断言 */ }
  ok(parsed && parsed.steps > 0, '--json 输出可被机器解析', sim.out.slice(0, 160));
  const bad = runNode(['src/cli.ts', 'sim', '--char', 'nope']);
  ok(bad.status === 1 && /参数错误/.test(bad.out), '参数错误退出码 1', String(bad.status));
  const unknown = runNode(['src/cli.ts', 'nope']);
  ok(unknown.status === 1, '未知子命令退出码 1', String(unknown.status));
  const table = runNode(['src/cli.ts', 'sim', '--seconds', '6']);
  ok(table.status === 0 && /无头跑局/.test(table.out) && /性能/.test(table.out),
    '默认输出是表格报告（不是 JSON）');
}

/* =========================================================
   桌面外壳（纯逻辑，不需要显示器）
   ========================================================= */
console.log('\n[7] 桌面外壳：纯逻辑与安全默认值');
{
  const o = shell.parseArgs(['--dev', '--port', '5200']);
  ok(o.dev === true && o.port === 5200, '桌面参数解析', JSON.stringify(o));
  ok(shell.parseArgs(['--wat']).errors.length > 0, '未知参数被拒绝');

  const dist = shell.resolveDist(ROOT, null);
  ok(dist.ok && fs.existsSync(dist.index), '找到 dist/index.html', dist.dir);
  const missing = shell.resolveDist(ROOT, 'no-such-dir');
  ok(!missing.ok && /pnpm run build/.test(missing.reason),
    'dist 缺失时给出"该怎么办"而不是空窗口', missing.reason.split('\n')[1]);

  const wo = shell.windowOptions('http://127.0.0.1:1/');
  const wp = wo.webPreferences;
  ok(wp.nodeIntegration === false && wp.contextIsolation === true && wp.sandbox === true,
    '窗口关掉 Node 能力（nodeIntegration=false / contextIsolation / sandbox）', JSON.stringify(wp));
  ok(wp.webSecurity === true && wp.allowRunningInsecureContent === false, '不放开 webSecurity');
  ok(wo.show === false, '等 ready-to-show 再显示（不闪白屏）');

  ok(shell.isNavigationAllowed('http://127.0.0.1:1234/a', 'http://127.0.0.1:1234/'), '同源导航放行');
  ok(!shell.isNavigationAllowed('https://evil.example/', 'http://127.0.0.1:1234/'), '跨源导航拒绝');
  ok(!shell.isNavigationAllowed('file:///etc/passwd', 'http://127.0.0.1:1234/'), 'file:// 导航拒绝');

  ok(shell.chooseUrl({ dev: false, devUrl: 'x' }, 'http://127.0.0.1:9/') === 'http://127.0.0.1:9/',
    '生产模式加载内置服务器地址');
  ok(shell.chooseUrl({ dev: true, devUrl: shell.DEFAULT_DEV_URL }, 'http://127.0.0.1:9/') === shell.DEFAULT_DEV_URL,
    '--dev 模式加载 Vite 开发服务器');

  // 桌面不允许用 file:// 打开 dist（ES 模块会被 CORS 拦掉）
  const mainCode = readCode('desktop/main.mjs');
  ok(!/win\.loadFile\(|loadURL\(\s*['"]file:/.test(mainCode),
    '桌面主进程不加载 file://（否则白窗口）', 'main.mjs 里真的有 file:// 加载调用');
  ok(!/server\/static\.mjs/.test(mainCode) && /\.\/shell\.mjs/.test(mainCode),
    '主进程只接 electron，服务器相关都在 shell.mjs 里');
  const shellSrc = readSrc('desktop/shell.mjs');
  ok(/server\/static\.mjs/.test(shellSrc), '外壳复用服务器模式的同一个静态服务器模块');
  ok(/127\.0\.0\.1/.test(shellSrc), '只监听回环地址');
}

console.log('\n[8] 三种形态共用一个入口（不各写一套）');
{
  const html = readSrc('index.html');
  const entries = html.match(/<script[^>]*src=/g) || [];
  ok(entries.length === 1, 'index.html 只有一个入口脚本', String(entries.length));
  ok(/src="\/src\/main\.ts"/.test(html), '入口就是 /src/main.ts（web / cli / desktop 都用它）');
  const vite = readSrc('vite.config.ts');
  ok(/base:\s*'\.\/'/.test(vite), 'vite base 是相对路径（dist 可放子目录/被外壳加载）');
  ok(!/open:\s*true/.test(vite), 'dev/preview 不会自动开浏览器（我这边不能被拉起浏览器）');
  const htmlInner = readSrc('index.html');
  ok(!/electron|nodeIntegration/i.test(htmlInner), 'index.html 里没有桌面/Node 相关分支');
}

console.log('\n[9] 构建产物的体积预算（玩家真正要下载的那一份）');
{
  /* 为什么要有这一节：`pnpm build` 会打印一条 Vite 的默认警告
     "Some chunks are larger than 500 kB"。那条阈值说明不了任何事 ——
     它按**未压缩**算，也不知道这个仓库有没有依赖（0 个运行时依赖，
     87 个被转换的模块全是自己写的 src/*.ts，没有能拆出去的 vendor）。
     真正该守住的是**玩家下载的字节**：gzip 之后的 html + css + js。

     ⚠ 上限只有**一处**：`vite.config.ts` 的 `chunkSizeWarningLimit`
       （未压缩 JS）。这里把它读出来当判据 —— 两边各写一个数就迟早对不上。
     ⚠ 超预算只有两条路：砍体积，或者在 CHANGELOG 里写明为什么长。 */
  const cfg = readSrc('vite.config.ts');
  const capM = /chunkSizeWarningLimit:\s*(\d+)/.exec(cfg);
  const rawCap = capM ? Number(capM[1]) : 0;
  ok(rawCap > 0, 'vite.config.ts 里写着我们自己的 chunk 上限（不再吃 Vite 默认的 500 kB）',
    String(rawCap));
  /* sourcemap 是一条"体积承诺"，不是口味问题：它在 dist/ 里比整个游戏还大，
     而玩家一个字节都用不到。要它必须**显式**开（BRONANA_SOURCEMAP=1）。 */
  ok(/sourcemap:\s*process\.env\.BRONANA_SOURCEMAP/.test(cfg),
    'sourcemap 默认不发（要它得显式开 BRONANA_SOURCEMAP=1）');

  const assetsDir = path.join(DIST, 'assets');
  const files = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir) : [];
  const jsName = files.find(f => f.endsWith('.js'));
  const cssName = files.find(f => f.endsWith('.css'));
  if (!jsName) {
    ok(false, 'dist/assets 里有 JS 产物（先跑 pnpm run build）', buildNote);
  } else {
    /* 单位与 Vite 的报表一致：kB = 1000 字节（不是 KiB） */
    const kb = n => Math.round(n / 100) / 10;
    const gz = buf => zlib.gzipSync(buf).length;
    const js = fs.readFileSync(path.join(assetsDir, jsName));
    const css = cssName ? fs.readFileSync(path.join(assetsDir, cssName)) : Buffer.alloc(0);
    const html = fs.readFileSync(path.join(DIST, 'index.html'));
    const gzAll = gz(js) + gz(css) + gz(html);
    console.log('      产物：js ' + kb(js.length) + ' kB（gzip ' + kb(gz(js)) + '）· css ' +
      kb(css.length) + ' kB（gzip ' + kb(gz(css)) + '）· html ' + kb(html.length) +
      ' kB（gzip ' + kb(gz(html)) + '）· **全站 gzip ' + kb(gzAll) + ' kB**');
    ok(js.length <= rawCap * 1000,
      '未压缩 JS 在配置的上限内（' + kb(js.length) + ' ≤ ' + rawCap + ' kB）');
    ok(gz(js) <= 270 * 1000, 'gzip 后的 JS ≤ 270 kB（现在 ' + kb(gz(js)) + '）');
    ok(gzAll <= 300 * 1000,
      '全站 gzip ≤ 300 kB —— 玩家真正下载的那一份（现在 ' + kb(gzAll) + '）');
  }
}

console.log('\n=== 结果 ===');
if (failures === 0) console.log('\x1b[32m全部通过 ✔\x1b[0m');
else console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m');
process.exit(failures ? 1 : 0);
