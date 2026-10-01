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
import { childEnv, isGpuFailure, parseArgs, signed32 } from './shell.mjs';

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

const entry = path.join(import.meta.dirname, 'main.mjs');

/* =========================================================
   命令行怎么切开：**Chromium 的开关必须排在脚本路径之前**
   ---------------------------------------------------------
   实测的教训：写成 `electron main.mjs --no-sandbox` 时，`--no-sandbox`
   会被当成**脚本的参数**（由 `main.mjs` 解析），Chromium 那侧**看不到它** ——
   于是"加了开关却一点没变"。正确形状是 `electron --no-sandbox main.mjs`。

   分工：
     · `shell.parseArgs` 认识壳自己的参数（`--dev` / `--port` / `--gpu` …）
       与透传的 Chromium 开关（`--no-sandbox` / `--disable-gpu-sandbox`…）；
     · 这里把它们**重新排序**：Chromium 开关在前，脚本路径，然后是壳自己的参数。
   ========================================================= */
/* Chromium 的开关只走 Chromium 那一侧；其余原样搬给 `main.mjs`。
   ⚠ `process.argv` 在**启动器**里是 `[node, launch.mjs, ...用户参数]`，
     所以从**下标 2** 切；而 `main.mjs` 里 `process.argv` 是
     `[electron, main.mjs, ...]` —— 它那边也从下标 2 切。两边对得上。 */
const opts = parseArgs(process.argv.slice(2));
const chromium = opts.chromium.slice();
const shellArgs = process.argv.slice(2).filter(function (a) { return chromium.indexOf(a) < 0; });

/* `ELECTRON_RUN_AS_NODE` **必须摘掉**（`shell.mjs` 的 `childEnv` 有完整说明）：
   它让 `electron.exe` 退化成纯 Node，于是窗口不存在、报错还指向错误的方向。 */
function run(extraChromium) {
  return new Promise(function (resolve) {
    const argv = chromium.concat(extraChromium || []).concat([entry]).concat(shellArgs);
    const child = spawn(bin, argv, {
      cwd: ROOT,
      stdio: 'inherit',
      env: childEnv(process.env)
    });
    child.on('exit', function (code, signal) {
      resolve({ code: signal ? 128 : (code === null ? 1 : code), signal: signal || null });
    });
    child.on('error', function (e) {
      guidance('启动失败：' + e.message);
      resolve({ code: null, signal: null, spawnError: true });
    });
  });
}

const first = await run([]);
if (first.signal) process.exit(128);
if (first.spawnError) process.exit(1);
if (first.code === 0) process.exit(0);

/* =========================================================
   `-2147483645` 是**启动阶段就死了**（Windows `STATUS_BREAKPOINT`）：
   Chromium 在"进程起不来"时是主动自杀，所以连一句自己的报错都来不及打。
   实测在两类环境里都会这样：GPU 进程起不来、或**沙箱起不来**。
   两种都只有 Chromium 自己的命令行开关能救，而壳给的是"照着做"的两步 ——
   `--no-sandbox` 与"先用浏览器"这两条**实测都能绕过**（见 CHANGELOG）。
   ========================================================= */
if (isGpuFailure(first.code)) {
  const code = signed32(first.code);
  const already = chromium.length > 0;
  console.error('');
  console.error('  桌面壳在**启动阶段**退出了（退出码 ' + code + '）。');
  console.error('  这个码是 Chromium 在"进程起不来"时的主动退出 —— 它发生在');
  console.error('  `desktop/main.mjs` 跑起来**之前**，所以窗口与日志都还没有。');
  console.error('  本壳默认已经关掉硬件加速，所以剩下的常见原因是**沙箱起不来**');
  console.error('  （受管策略 / 安全软件 / 某些远程会话）。两条实测都能通的路：');
  console.error('');
  console.error('    pnpm run desktop:nosandbox     # 加 Chromium 的 --no-sandbox 再起一次');
  console.error('    pnpm run serve                 # 用浏览器打开同一份 dist（同一个服务器）');
  console.error('');
  console.error('  ⚠ `--no-sandbox` 关掉的是 Chromium 的进程沙箱。本壳的窗口本来就只有');
  console.error('    `contextIsolation`、没有 Node 能力、只加载回环地址，所以风险面很小；');
  console.error('    但它仍然是一个安全开关，因此**默认不开**，要你显式要。');
  if (already) {
    console.error('');
    console.error('  （这一趟你已经带了开关：' + chromium.join(' ') + ' —— 都没能让它起来。）');
  }
  console.error('');
}

process.exit(signed32(first.code));
