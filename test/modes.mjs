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
  ok(help.status === 0 && /Teapot 命令行/.test(help.out), 'help 退出码 0 且打印用法',
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

/* =========================================================
   桌面外壳：**起不来那件事**（实测踩到的三次，每次的判据都不一样）
   =========================================================
   背景：用户机器上 `pnpm run desktop` 报
     GPU process launch failed: error_code=18
     GPU process isn't usable. Goodbye.
     [ELIFECYCLE] Command failed with exit code -2147483645
   下面四条守的就是"这一类崩溃以后能被认出来 / 能绕过去"。
   ========================================================= */
console.log('\n[7b] 桌面外壳：启动失败的三条判据与两个开关');
{
  /* ① 退出码要按**有符号 32 位**比。
     ⚠ 实测踩到：Windows 上 Node 给的退出码是**无符号**的 ——
     `STATUS_BREAKPOINT`（0x80000003）拿到手是 `2147483651`，
     而 PowerShell 打的是 `-2147483645`。第一版拿负数去比，于是
     "解释了半天的提示一句都不打"，而崩溃照旧。 */
  ok(shell.GPU_CRASH_CODE === -2147483645, '崩溃码是 Windows 的 STATUS_BREAKPOINT',
    String(shell.GPU_CRASH_CODE));
  ok(shell.isGpuFailure(-2147483645) === true, '有符号写法认得出来');
  ok(shell.isGpuFailure(2147483651) === true,
    '**无符号写法也认得出来**（Node 在 Windows 上给的就是这个）', String(2147483651));
  ok(shell.isGpuFailure(0) === false && shell.isGpuFailure(1) === false, '正常退出码不误判');
  ok(shell.signed32(2147483651) === -2147483645, 'signed32 把无符号归一成有符号');
  ok(shell.signed32(-2147483645) === -2147483645, 'signed32 对有符号是恒等');
  ok(shell.signed32(0) === 0 && shell.signed32(1) === 1, 'signed32 不动小正数');

  /* ② 渲染进程"没能起来"要和"跑着跑着崩了"分开 */
  ok(shell.isRendererLaunchFailure('launch-failed') === true, '认得 launch-failed');
  ok(shell.isRendererLaunchFailure('crashed') === false, 'crashed 不算 launch-failed');
  ok(shell.isRendererLaunchFailure('') === false && shell.isRendererLaunchFailure(null) === false,
    '空 / null 不误判');

  /* ③ `ELECTRON_RUN_AS_NODE` 必须被摘掉。
     不摘的话 electron.exe 退化成纯 Node —— 窗口不存在，而报错会把人指向
     "electron 没装 / 二进制没下下来"这个**错误的方向**。 */
  const cleaned = shell.childEnv({ PATH: 'x', ELECTRON_RUN_AS_NODE: '1' });
  ok(cleaned.ELECTRON_RUN_AS_NODE === undefined, 'childEnv 摘掉 ELECTRON_RUN_AS_NODE');
  ok(cleaned.PATH === 'x', 'childEnv 保留其余环境变量');
  ok(shell.childEnv({ ELECTRON_RUN_AS_NODE: '1' }).ELECTRON_RUN_AS_NODE === undefined &&
    ({ ELECTRON_RUN_AS_NODE: '1' }).ELECTRON_RUN_AS_NODE === '1',
    'childEnv 不改动传入的那个对象（不改调用方的环境）');

  /* ④ 命令行切开：**Chromium 开关排在脚本路径之前**。
     不切的话 `--no-sandbox` 会被当成脚本参数（Chromium 看不到它，于是
     "加了开关却一点没变"）；反过来，`main.mjs` 里朴素切片会把**脚本路径自己**
     当成参数并报"未知参数 …\desktop\main.mjs"（这两条都实测踩到过）。 */
  const o1 = shell.parseArgs(['--no-sandbox']);
  ok(o1.chromium.length === 1 && o1.chromium[0] === '--no-sandbox' && !o1.errors.length,
    '--no-sandbox 被认成透传开关，而不是"未知参数"', JSON.stringify(o1.errors));
  ok(shell.parseArgs(['--no-sandbox', '--disable-gpu']).chromium.length === 2, '多个透传开关都收');
  ok(shell.parseArgs(['--wat']).errors.length > 0, '真正不认识的参数仍然报错（不是静默放过）');
  const udd = shell.parseArgs(['--user-data-dir', 'C:\\tmp\\x']);
  ok(udd.chromium.length === 2 && udd.chromium[1] === 'C:\\tmp\\x',
    '--user-data-dir 的**取值**也收进来（否则 Chromium 拿不到目录）', JSON.stringify(udd.chromium));
  const udd2 = shell.parseArgs(['--user-data-dir=C:\\tmp\\x']);
  ok(udd2.chromium.length === 1 && udd2.chromium[0] === '--user-data-dir=C:\\tmp\\x',
    '--user-data-dir=… 这种带等号的写法也收');

  /* `shellArgsOf`：丢脚本路径与 Chromium 开关，只留壳自己的参数 */
  ok(shell.shellArgsOf(['e.exe', '--no-sandbox', 'm.mjs']).length === 0,
    'shellArgsOf 丢掉脚本路径与 Chromium 开关（不留下来变成"未知参数"）',
    JSON.stringify(shell.shellArgsOf(['e.exe', '--no-sandbox', 'm.mjs'])));
  const sa = shell.shellArgsOf(['e.exe', '--dev', '--port', '5200', 'm.mjs']);
  ok(sa.join(' ') === '--dev --port 5200', 'shellArgsOf 保住壳自己的参数（含取值）', sa.join(' '));
  ok(shell.shellArgsOf(['e.exe', '--gpu', 'm.mjs']).join(' ') === '--gpu', 'shellArgsOf 保住 --gpu');

  /* ⑤ GPU 那一档：默认**关**硬加速，要另一档必须显式说 */
  ok(shell.gpuMode({}, {}).accel === false, '默认不启用硬件加速（GPU 起不来时它会让整个应用起不来）');
  ok(shell.gpuMode({ gpu: true }, {}).accel === true, '命令行 --gpu 才启用');
  /* ⚠ **改名（R62/E2）之后这一条要验两件事**，不是一件：
     ① 新名 TEAPOT_DESKTOP_GPU 生效；
     ② **旧名 BRONANA_DESKTOP_GPU 仍然生效** —— 那是"改名只改一半"那一类坑的机器判据
        （已经设过旧变量的人不该**静默失效**）。而且 `why` 里要说清读的是哪一个名字。 */
  ok(shell.gpuMode({}, { TEAPOT_DESKTOP_GPU: '1' }).accel === true, '新环境变量名 TEAPOT_DESKTOP_GPU 也能启用');
  ok(shell.gpuMode({}, { TEAPOT_DESKTOP_GPU: '0' }).accel === false, '新名给 0 不算启用');
  ok(shell.gpuMode({}, { BRONANA_DESKTOP_GPU: '1' }).accel === true,
    '**旧环境变量名 BRONANA_DESKTOP_GPU 仍然生效**（改名兼容 —— 不许静默失效）');
  ok(shell.gpuMode({}, { BRONANA_DESKTOP_GPU: '0' }).accel === false, '旧名给 0 也不算启用');
  ok(/TEAPOT_DESKTOP_GPU/.test(shell.gpuMode({}, { TEAPOT_DESKTOP_GPU: '1' }).why),
    '`why` 里说清读的是**新名**（"我明明设了变量"这类困惑就出在没说清）');
  ok(/BRONANA_DESKTOP_GPU/.test(shell.gpuMode({}, { BRONANA_DESKTOP_GPU: '1' }).why),
    '`why` 里说清读的是**旧名**');
  ok(/默认/.test(shell.gpuMode({}, {}).why), '默认那一档给得出理由（会印在启动横幅里）',
    shell.gpuMode({}, {}).why);

  /* ⑥ 主进程里那两处接线（静态判据：它们在无头环境里跑不到） */
  const mainSrc2 = readCode('desktop/main.mjs');
  ok(/shellArgsOf\(process\.argv\)/.test(mainSrc2),
    '主进程用 shellArgsOf 解析（不是朴素的 process.argv.slice(2)）');
  ok(/disableHardwareAcceleration\(\)/.test(mainSrc2),
    '主进程在 whenReady 之前关掉硬加速');
  ok(/try\s*\{[\s\S]*?await win\.loadURL\(url\)[\s\S]*?\}\s*catch/.test(mainSrc2),
    'loadURL 的拒绝被接住（不接住时 Electron 会以"未处理的拒绝"结束进程 —— 实测）');
  ok(/isRendererLaunchFailure/.test(mainSrc2), '渲染进程 launch-failed 有专门的提示');
  const launchSrc = readCode('desktop/launch.mjs');
  ok(/childEnv\(process\.env\)/.test(launchSrc), '启动器给子进程用 childEnv（摘掉 RUN_AS_NODE）');
  ok(/isGpuFailure/.test(launchSrc), '启动器认得"启动阶段就死了"那个码并给人话');
  ok(/PASSTHROUGH|parseArgs/.test(launchSrc), '启动器复用 shell 的参数解析（不自己再切一遍）');
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
     而玩家一个字节都用不到。要它必须**显式**开（TEAPOT_SOURCEMAP=1）。
     ⚠ **改名（E2）之后要验两条**：新名在、**旧名也还在**（改名兼容，不许静默失效）。 */
  ok(/sourcemap:\s*\(process\.env\.TEAPOT_SOURCEMAP \|\| process\.env\.BRONANA_SOURCEMAP\)/.test(cfg),
    'sourcemap 默认不发（要它得显式开 TEAPOT_SOURCEMAP=1），且**旧名 BRONANA_SOURCEMAP 仍被读**');

  /* ⚠ **判据必须量「新鲜构建」**（2026-10-01 查出的洞）：
     `dist/` 是 gitignore 的**构建产物**，而这条判据读的正是它 —— 于是
     **本地量到的是上一次构建留下的旧包**（绿），**CI 先 `pnpm run build` 再跑测试**（红）。
     实测后果：CI 从 #51 起连红 8 轮，本地却一路"全绿"，没人发现体积早就超了。
     ⇒ 这里**自己保证新鲜**：产物比任一输入旧（或根本不在）就先构建一次。
     **判据的结论不许取决于一个陈旧产物** —— 那与"一条不会失败的审计"是同一个形状，
     只是方向反了：它不会**失败**，而不是不会成功。 */
  const newestMtime = (p) => {
    const s = fs.statSync(p);
    if (!s.isDirectory()) return s.mtimeMs;
    let t = 0;
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      t = Math.max(t, newestMtime(path.join(p, e.name)));
    }
    return t;
  };
  const inputs = ['src', 'server', 'desktop', 'index.html', 'styles.css', 'vite.config.ts',
    'package.json'].map(p => path.join(ROOT, p)).filter(p => fs.existsSync(p));
  const inputsNewest = Math.max.apply(null, inputs.map(newestMtime));
  const assetsDir = path.join(DIST, 'assets');
  const jsOnDisk = fs.existsSync(assetsDir)
    ? fs.readdirSync(assetsDir).find(f => f.endsWith('.js')) : null;
  const distTime = jsOnDisk ? fs.statSync(path.join(assetsDir, jsOnDisk)).mtimeMs : 0;
  if (distTime < inputsNewest) {
    console.log('      （产物不新鲜或缺失 —— 先构建一次；**判据只认新鲜构建**）');
    const vitePkg = JSON.parse(readSrc('node_modules/vite/package.json'));
    const binRel = typeof vitePkg.bin === 'string' ? vitePkg.bin : vitePkg.bin.vite;
    const b = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', binRel), 'build'],
      { cwd: ROOT, encoding: 'utf8' });
    if (b.status !== 0) console.log('      构建失败：' + String(b.stderr || b.stdout || '').slice(-400));
  }
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
      '未压缩 JS 在事故探测器之内（' + kb(js.length) + ' kB ≤ 上限 ' + kb(rawCap * 1000) + ' kB）');
    /* 真正要紧的那一条。**275 是 R41 第二批钉的数，第三批动到 280，
       这一轮（R50 第 10 条：状态系统）动到 285** ——
       实测 273.8（上一批是 272.6），而这一轮加了 `status.ts`
       （约 400 行：一张表 + 三个读点收口）并把它接进 `ai.ts` 的位置积分。
       ⚠ 这一轮**同一棵树上还有另一轮改动**（行尾规范化 + 27 个文件），
       所以这个读数不是本批单独的账 —— 两边都写在 CHANGELOG 的同一节里。
       按前两批自己写下的规矩（"要再涨，先回来看这一节的理由还在不在"）：
       **理由还在** —— 加的是功能与系统，不是依赖。 */
    /* ⚠ **2026-10-01 用户改的是口径**：上面那几笔是"贴着实测 +几 kB"调的，
       而用户的要求是「**直接先预判最终大小**再去检查和重新设置」—— 体量只会继续长。
       所以这两条改成**按最终体量的容量规划值**：
         · gzip JS ≤ **3 MB** · 全站 gzip ≤ **4 MB**（今天实测 282.2 / 298.2，约 13 倍余量）
       为什么仍然看 gzip：**玩家下载的就是这一份**；
       而"解析 / 编译要花多少"由 `vite.config.ts` 那个**未压缩事故探测器**管
       （它同时抓 gzip 看不见的那一类：高度可压缩的巨物，gzip 后合规而未压缩已爆）。
       ⚠ 读数**每一次都打印**（上面那行"产物："）—— "长没长"始终看得见；
         这两条判据管的是"**有没有越过预判的最终体量**"。 */
    ok(gz(js) <= 3 * 1000 * 1000,
      'gzip 后的 JS 在容量规划内（现在 ' + kb(gz(js)) + ' kB / 上限 3 MB）');
    ok(gzAll <= 4 * 1000 * 1000,
      '全站 gzip 在容量规划内（现在 ' + kb(gzAll) + ' kB / 上限 4 MB）—— 玩家真正下载的那一份');
  }
}

console.log('\n=== 结果 ===');
if (failures === 0) console.log('\x1b[32m全部通过 ✔\x1b[0m');
else console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m');
process.exit(failures ? 1 : 0);
