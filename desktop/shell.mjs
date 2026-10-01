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

/* =========================================================
   透传给 Chromium 的开关
   ---------------------------------------------------------
   有些"起不来"只有 Chromium 自己的开关能救，而它们必须出现在
   **命令行上**（不是 `appendSwitch`，因为出问题的是 bootstrap 阶段，
   主进程代码还没跑）。所以这一层认识的开关里留了两个透传位：

     · `--no-sandbox` —— **实测有效的那个**。在起不来沙箱的环境里
       （受管策略 / 安全软件 / 某些远程会话），不加它 Electron 会在
       `app.whenReady()` **之前**就死掉，退出码 `-2147483645`
       （Windows `STATUS_BREAKPOINT`）—— 于是连"报个错"的机会都没有。
       本壳的窗口本来就只有 `contextIsolation` + 无 Node 能力 + 只加载回环
       地址，所以这个开关的风险面**已经很小**；但它仍然是一个安全开关，
       所以**不默认打开**，只在你显式要求时开（见 `main.mjs` 的提示）。
     · `--disable-gpu-sandbox` —— 保留 GPU 沙箱之外的硬加速（比整个关掉温和）。

   ⚠ 这一批开关**原样透传**，壳不认识它们；认不出的（`--wat`）仍然报错 ——
     否则打错一个字母会静默变成"什么都没发生"。 */
const PASSTHROUGH = ['--no-sandbox', '--disable-gpu-sandbox', '--disable-gpu',
  '--in-process-gpu', '--disable-gpu-compositing', '--disable-software-rasterizer',
  /* Chromium 的用户数据目录：写不进去时它会报 `disk_cache` 错并让 `loadURL` 失败
     （实测），而受限环境里默认那个位置常常写不了 —— 于是留一个可指定的出口。 */
  '--user-data-dir'];

/** 透传开关里**要跟一个取值**的那些（`--user-data-dir=C:\x` 或 `--user-data-dir C:\x`） */
const PASSTHROUGH_TAKES_VALUE = ['--user-data-dir'];

/** 解析命令行：node desktop/main.mjs [--dev] [--dev-url URL] [--port N] [--root DIR] [--gpu] [chromium 开关…] */
export function parseArgs(argv) {
  const opts = { dev: false, devUrl: DEFAULT_DEV_URL, port: 0, root: null, gpu: false, chromium: [], errors: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dev') { opts.dev = true; continue; }
    if (a === '--dev-url') { opts.devUrl = argv[++i] || opts.devUrl; continue; }
    if (a === '--port') { opts.port = Number(argv[++i] || 0) || 0; continue; }
    if (a === '--root') { opts.root = argv[++i] || null; continue; }
    /* 走硬件加速（默认是**关**的，见下面的 `gpuMode`） */
    if (a === '--gpu') { opts.gpu = true; continue; }
    if (PASSTHROUGH.indexOf(a) >= 0) {
      opts.chromium.push(a);
      /* `--user-data-dir=C:\x` 与 `--user-data-dir C:\x` 两种写法都收 */
      if (a.indexOf('=') < 0 && PASSTHROUGH_TAKES_VALUE.indexOf(a) >= 0 && i + 1 < argv.length) {
        opts.chromium.push(argv[++i]);
      }
      continue;
    }
    /* `--user-data-dir=C:\x` 这种带等号的整串进来时，前缀认得就行 */
    if (/^--(user-data-dir)=/.test(a)) { opts.chromium.push(a); continue; }
    opts.errors.push('未知参数 ' + a);
  }
  return opts;
}

/** 壳自己认识的参数（**不含**透传的 Chromium 开关与脚本路径） */
const OWN_FLAGS = ['--dev', '--dev-url', '--port', '--root', '--gpu'];
const OWN_TAKES_VALUE = ['--dev-url', '--port', '--root'];

/**
 * 从 `process.argv` 里挑出**壳自己的参数**（丢掉脚本路径与 Chromium 开关）。
 *
 * ⚠ 为什么需要它（实测踩到）：Electron 把开关放在脚本路径**之前**
 * （`electron --no-sandbox main.mjs`），而它在主进程里给出的 `process.argv`
 * 是 `[electron, '--no-sandbox', 'main.mjs']` —— 于是 `main.mjs` 里
 * 那句朴素的 `process.argv.slice(2)` 会把**脚本路径自己**当成一个参数，
 * 于是报 `未知参数 C:\…\desktop\main.mjs`。
 * 判据只能是"**认得出来的才留**"，因为这一层不认识 Chromium 的开关全集。
 */
export function shellArgsOf(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (OWN_FLAGS.indexOf(a) < 0) continue;          // 脚本路径 / Chromium 开关 / 不认识的，一律丢
    out.push(a);
    if (OWN_TAKES_VALUE.indexOf(a) >= 0 && i + 1 < argv.length) out.push(argv[++i]);
  }
  return out;
}

/* =========================================================
   GPU：**默认关掉硬件加速**，而且这件事有实测的理由
   ---------------------------------------------------------
   现象（用户机器上实测，Electron 44.4.3 / Windows）：

     [ERROR:gpu_process_host.cc] GPU process launch failed: error_code=18
     [FATAL:gpu_data_manager_impl_private.cc] GPU process isn't usable. Goodbye.
     [ELIFECYCLE] Command failed with exit code -2147483645

   注意**这不是白窗口、也不是渲染层的错**：Electron 主进程已经起来了
   （端口与地址都打出来了），崩的是 Chromium 的 **GPU 进程**。而 `-2147483645`
   就是 Windows 的 `STATUS_BREAKPOINT`（`0x80000003`）—— Chromium 在
   "GPU 不可用"时是**主动自杀**，不是异常退出。

   为什么默认关是**对**的，而不是"绕过问题"：
     · 本作是 **Canvas2D**（`draw2d.ts` 是唯一的绘制原语层，零 WebGL / 零 3D）——
       GPU 合成的收益本来就很小；
     · 而代价很实在：一个起不来的 GPU 进程会让**整个应用起不来**。
   所以默认走软件合成。要看 GPU 那条路（比如怀疑某台机器的帧率被软件合成拖了），
   显式加 `--gpu`（或 `pnpm run desktop:gpu`）。

   ⚠ 与项目里"**会改行为的东西必须显式选择**"同一条纪律：默认档选最稳的那一档，
     要另一档就显式说。这里"另一档"指的是快一点，而"默认档"指的是能起来。
   ========================================================= */
/**
 * 这一趟要不要硬件加速。
 * 三个来源，优先级从高到低：命令行 `--gpu` → 环境变量 `BRONANA_DESKTOP_GPU=1` → 默认关。
 * @returns `{ accel: boolean, why: string }` —— `why` 是给人看的一句话（启动横幅里会印）
 */
export function gpuMode(opts, env) {
  const e = env || {};
  const forced = !!(opts && opts.gpu);
  const fromEnv = String(e.BRONANA_DESKTOP_GPU || '') === '1';
  if (forced) return { accel: true, why: '命令行 --gpu 要求硬件加速' };
  if (fromEnv) return { accel: true, why: '环境变量 BRONANA_DESKTOP_GPU=1 要求硬件加速' };
  return { accel: false, why: '默认关（GPU 进程起不来的机器上，硬加速会让整个应用起不来）' };
}

/* =========================================================
   子进程的环境变量：**必须摘掉 `ELECTRON_RUN_AS_NODE`**
   ---------------------------------------------------------
   实测踩到的（本项目的工作环境里它是被设上的）：
   `ELECTRON_RUN_AS_NODE=1` 会让 `electron.exe` **退化成纯 Node** ——
   窗口、`app`、`BrowserWindow` 一个都不存在，`desktop/main.mjs` 那句
   "electron 模块没给出 app/BrowserWindow" 会把人指向**错误的排查方向**
   （以为是 electron 没装／二进制没下下来），而真相是环境变量。

   ⚠ 为什么在这里（启动器）摘而不是在 `main.mjs` 里：**已经晚了** ——
     那个变量是在**进程启动那一刻**被 Electron 读的，主进程代码还没跑，
     行为就已经定了。所以只能在 spawn 的时候清掉。
   ========================================================= */
/** 给 electron 子进程用的环境变量（`ELECTRON_RUN_AS_NODE` 一律摘掉） */
export function childEnv(env) {
  const out = Object.assign({}, env || {});
  delete out.ELECTRON_RUN_AS_NODE;
  return out;
}

/* =========================================================
   两种"起不来"要以人话报出来（否则用户只看到一堆 Chromium 日志）
   ========================================================= */
/** Chromium 在"GPU 不可用 / 沙箱起不来"时的自杀码：Windows `STATUS_BREAKPOINT`（`0x80000003`） */
export const GPU_CRASH_CODE = -2147483645;
/** 渲染进程没能起来时 Electron 给的 reason（`render-process-gone` 的 `details.reason`） */
export const RENDERER_LAUNCH_FAILED = 'launch-failed';

/**
 * 把子进程给的退出码**归一成 32 位有符号**。
 *
 * ⚠ 这一步是必须的，而且只有实测才会发现：**Node 在 Windows 上给出的退出码是无符号的** ——
 *   `STATUS_BREAKPOINT`（`0x80000003`）拿到手是 `2147483651`，而 PowerShell 的
 *   `$LASTEXITCODE` 打印的是 `-2147483645`。于是同一个崩溃，两边看起来是两个数。
 *   `isGpuFailure` 第一版就是拿 `-2147483645` 去比，结果**永远为假** ——
 *   表现是"解释了半天的提示一句都不打"，而崩溃照旧。
 */
export function signed32(code) {
  const n = Number(code);
  if (!isFinite(n)) return n;
  return n > 2147483647 ? n - 4294967296 : n;
}

/** 这个退出码是不是"进程起不来"（GPU 或沙箱）—— 两边都按有符号比 */
export function isGpuFailure(code) { return signed32(code) === GPU_CRASH_CODE; }
/** 这个 `render-process-gone` 的 reason 是不是"渲染进程没能起来" */
export function isRendererLaunchFailure(reason) { return String(reason || '') === RENDERER_LAUNCH_FAILED; }


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
