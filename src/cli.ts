/* =========================================================
   cli.ts — 命令行入口（服务器模式 / 无头模式）

     node src/cli.ts sim   [--char ranger] [--wave 1] [--seconds 60] [--seed 1234] [--json]
     node src/cli.ts serve [--root dist] [--port 5180] [--host 127.0.0.1]
     node src/cli.ts help

   sim：在 Node 里无头跑一整局并打印报告（平衡调参用，也用来验证"模拟层不依赖 DOM"）。
   serve：把 dist/ 用 HTTP 提供出去 —— 本作的 ES 模块在 file:// 下会被 CORS 拦掉，
          所以这是"怎么把游戏跑起来"的正解，也是桌面外壳内部复用的那一个。

   这个文件只依赖模拟层，**不 import 渲染层 / 界面层**，因此在纯 Node 下可直接运行。
   ========================================================= */

import { SelfCheck } from './selfcheck.ts';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { Chars } from './data_chars.ts';
import { Game } from './game.ts';
import { Stats } from './stats.ts';
import { U } from './utils.ts';
import { createHandler, listen } from '../server/static.mjs';
/* ⚠ **CLI 是三种形态里唯一没有持久化的**（web / desktop 都走 Chromium 的
   localStorage，它落在 `userData` 里，本来就持久）。接上文件后端之后，
   `pnpm cli` 的设置与账号档案才会留下来。 */
import { fileAdapter, defaultSaveDir } from './storage_fs.ts';
/* ⚠ 必须**显式 import** `Storage` —— 浏览器环境有一个同名的
   全局 `Storage`（Web Storage API），不 import 的话 TypeScript 会解析到那个，
   于是 `.use` 报错。 */
import { Storage } from './storage.ts';

/* =========================================================
   参数解析（纯函数，测试直接调）
   ========================================================= */
var SPEC = {
  sim: {
    char: { type: 'string', def: 'gladiator', desc: '角色 id' },
    wave: { type: 'int', def: 1, desc: '从第几波开始' },
    seconds: { type: 'number', def: 60, desc: '模拟多少秒游戏时间' },
    seed: { type: 'int', def: 12345, desc: '随机种子（同种子结果完全一致）' },
    auto: { type: 'bool', def: true, desc: '自动买商店货 / 选升级卡' },
    json: { type: 'bool', def: false, desc: '输出 JSON 而不是表格' }
  },
  serve: {
    root: { type: 'string', def: 'dist', desc: '要提供的目录' },
    port: { type: 'int', def: 5180, desc: '端口（0 = 让系统分配）' },
    host: { type: 'string', def: '127.0.0.1', desc: '监听地址（默认只回环）' },
    quiet: { type: 'bool', def: false, desc: '不打印请求日志' }
  }
};

/** @returns {{cmd:string, opts:any, errors:string[]}} */
export function parseArgs(argv) {
  var errors = [];
  var cmd = 'help';
  var rest = [];
  var i;
  if (argv.length && argv[0].charAt(0) !== '-') { cmd = argv[0]; rest = argv.slice(1); }
  else rest = argv.slice();

  if (cmd !== 'help' && !SPEC[cmd]) {
    errors.push('未知子命令「' + cmd + '」（可用：sim / serve / help）');
    return { cmd: 'help', opts: {}, errors: errors };
  }

  /* 选项值就是字符串/布尔/数字三种，用 unknown 逼调用方各自收窄（以前这里是 any） */
  var opts: Record<string, unknown> = {};
  var spec = SPEC[cmd] || {};
  for (var k in spec) opts[k] = spec[k].def;

  for (i = 0; i < rest.length; i++) {
    var a = rest[i];
    if (a === '--help' || a === '-h') { cmd = 'help'; break; }
    if (a.slice(0, 2) !== '--') { errors.push('看不懂的参数「' + a + '」（选项一律 --name value）'); continue; }
    var body = a.slice(2);
    var eq = body.indexOf('=');
    var name = eq >= 0 ? body.slice(0, eq) : body;
    var val = eq >= 0 ? body.slice(eq + 1) : null;
    // --no-xxx：布尔选项的"关掉"写法（用法里写了 --no-auto，就得真的支持）
    if (val === null && name.slice(0, 3) === 'no-') {
      var off = spec[name.slice(3)];
      if (off && off.type === 'bool') { opts[name.slice(3)] = false; continue; }
      errors.push('未知选项 --' + name);
      continue;
    }
    var s = spec[name];
    if (!s) { errors.push('未知选项 --' + name); continue; }
    if (s.type === 'bool') {
      opts[name] = val === null ? true : (val !== 'false' && val !== '0');
      continue;
    }
    if (val === null) {
      val = rest[++i];
      if (val === undefined) { errors.push('--' + name + ' 缺少取值'); continue; }
    }
    if (s.type === 'int' || s.type === 'number') {
      var num = Number(val);
      if (!isFinite(num)) { errors.push('--' + name + ' 需要数值，收到「' + val + '」'); continue; }
      opts[name] = s.type === 'int' ? Math.round(num) : num;
    } else {
      opts[name] = val;
    }
  }

  if (cmd === 'sim' && opts.char && !Chars.BY_ID[String(opts.char)]) {
    errors.push('未知角色「' + opts.char + '」（可用：' + Object.keys(Chars.BY_ID).join(', ') + '）');
  }
  return { cmd: cmd, opts: opts, errors: errors };
}

function usage() {
  return [
    'Bronana 命令行',
    '',
    '  node src/cli.ts sim   [--char 角色] [--wave N] [--seconds S] [--seed N] [--no-auto] [--json]',
    '      无头跑一局并打印报告（不会开窗口、不碰 canvas）',
    '      默认：gladiator · 第 1 波 · 60 秒 · 种子 12345 · 自动买卖',
    '',
    '  node src/cli.ts serve [--root 目录] [--port 端口] [--host 地址] [--quiet]',
    '      静态服务器（默认 dist/ + 5180 + 只回环）',
    '',
    '  退出码：0 正常 · 1 参数错误 · 2 运行期错误 / 定义期自检未通过'
  ].join('\n');
}

/* =========================================================
   sim：无头跑局
   ========================================================= */
function percentile(sorted, p) {
  if (!sorted.length) return 0;
  var i = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)));
  return sorted[i];
}

/**
 * CLI 自己的自动操作：**按武器射程保持距离**（太近就跑、太远就靠，并带一点切向绕圈）。
 *
 * 为什么不直接用 `Game.autoInput`：那个是给无头测试做代码覆盖用的，它的策略是
 * "远离最近的怪" —— 实测从第 8 波跑 45 秒只打死 2 只、几乎不开火，报告没有参考价值。
 * 这里的策略更接近真人（贴射程边缘输出），而且只依赖局面状态 + 时间，
 * 所以同种子仍然完全可复现。
 */
export function cliInput(sess, t) {
  var p = sess.player;
  var i, e, d2;
  var reach = 0;
  for (i = 0; i < p.weapons.length; i++) reach += p.weapons[i].def.reach;
  reach = p.weapons.length ? (reach / p.weapons.length) * Stats.rangeMul(sess.stats) : 140;
  var want = Math.max(48, reach * 0.75);

  var best = null, bd = Infinity;
  for (i = 0; i < sess.enemies.length; i++) {
    e = sess.enemies[i];
    d2 = U.dist2(p.x, p.y, e.x, e.y);
    if (d2 < bd) { bd = d2; best = e; }
  }
  if (!best) return { x: Math.cos(t * 0.7), y: Math.sin(t * 0.7) };

  var d = Math.sqrt(bd) || 1;
  var ax = (p.x - best.x) / d, ay = (p.y - best.y) / d;     // 远离怪的方向
  var radial = d < want * 0.7 ? 1 : (d > want * 1.3 ? -1 : 0);
  var tx = -ay, ty = ax;                                     // 切向：绕圈而不是原地站桩
  var vx = ax * radial * 0.9 + tx * 0.55;
  var vy = ay * radial * 0.9 + ty * 0.55;
  var l = Math.sqrt(vx * vx + vy * vy) || 1;
  return { x: vx / l, y: vy / l };
}

/**
 * 跑一局无头对战，返回一份报告（不打印）。
 * 自动选升级卡 + 自动进下一波 + （默认）自动买最便宜的货，
 * 这样"从第 1 波开始"也能跑出接近真实的一局。
 */
export function runSim(o) {
  var fixedDt = Game.cfg.fixedDt;
  var sess = Game.newRun(o.char, o.seed);
  if (o.wave > 1) Game._internals.startWave(o.wave);

  var steps = Math.max(1, Math.round(o.seconds / fixedDt));
  var samples = new Float64Array(steps);
  var n = 0, levels = 0, shops = 0, buys = 0, deaths = 0;
  /* 为什么停了 —— 报告里必须说清楚，否则"跑了 1129 步"这种数字没法判读：
     是时间到了，还是**阵亡/通关**了。房间制之后一局的结束变快了
     （一间打完就进商店、怪按房间数成长），没有这一项就没法区分"跑满"与"打到死"。 */
  var stop = 'time';
  var peak = { enemies: 0, bullets: 0, pickups: 0, decals: 0, particles: 0 };
  var wall0 = process.hrtime.bigint();

  for (var i = 0; i < steps; i++) {
    if (Game.state === 'levelup') {
      levels++;
      if (o.auto) Game.chooseLevelCard(0);
      else { stop = 'levelup'; break; }
      continue;
    }
    if (Game.state === 'shop') {
      shops++;
      if (o.auto) {
        // 反复买"当前能买得起的最便宜货"，直到买不动为止
        for (var guard = 0; guard < 40; guard++) {
          var best = -1, bestPrice = Infinity;
          for (var k = 0; k < sess.offers.length; k++) {
            var off = sess.offers[k];
            if (off.sold) continue;
            if (off.price <= sess.player.scrap && off.price < bestPrice) { bestPrice = off.price; best = k; }
          }
          if (best < 0) break;
          if (!Game.buyOffer(best)) break;
          buys++;
        }
      }
      if (!Game.nextWave()) { stop = 'stuck'; break; }
      continue;
    }
    if (Game.state !== 'playing') { deaths++; stop = 'ended'; break; }   // end：阵亡或通关

    var t0 = process.hrtime.bigint();
    Game.step(fixedDt, o.auto ? cliInput(sess, i * fixedDt) : Game.autoInput(i * fixedDt));
    samples[n++] = Number(process.hrtime.bigint() - t0) / 1e6;

    if (sess.enemies.length > peak.enemies) peak.enemies = sess.enemies.length;
    if (sess.bullets.length > peak.bullets) peak.bullets = sess.bullets.length;
    if (sess.pickups.length > peak.pickups) peak.pickups = sess.pickups.length;
    if (sess.decalSeq > peak.decals) peak.decals = sess.decalSeq;
    if (sess.particles.length > peak.particles) peak.particles = sess.particles.length;
  }
  var wallMs = Number(process.hrtime.bigint() - wall0) / 1e6;

  var used = Array.prototype.slice.call(samples, 0, n).sort(function (a, b) { return a - b; });
  var sum = 0;
  for (var j = 0; j < used.length; j++) sum += used[j];
  var keep = Math.max(1, Math.floor(used.length * 0.99));
  var trimmed = 0;
  for (var q = 0; q < keep; q++) trimmed += used[q];
  trimmed /= keep;

  var p = sess.player;
  return {
    char: o.char,
    charName: sess.charDef.name,
    seed: o.seed,
    startWave: o.wave,
    waveReached: Game.wave,
    survived: deaths === 0,
    /** 为什么停了：time（跑满）/ ended（阵亡或通关）/ levelup（等选卡）/ stuck（走不动了） */
    stopReason: stop,
    simSeconds: +(n * fixedDt).toFixed(2),
    steps: n,
    wallMs: +wallMs.toFixed(1),
    realtimeFactor: +(n * fixedDt / (wallMs / 1000)).toFixed(1),
    kills: sess.stats_total.kills,
    scrap: Math.round(sess.stats_total.scrap),
    damage: Math.round(sess.stats_total.dmg),
    taken: Math.round(sess.stats_total.taken),
    healed: Math.round(sess.stats_total.healed),
    level: p.level,
    hp: Math.round(p.hp),
    maxHp: Math.round(sess.stats.maxHp),
    weapons: p.weapons.map(function (w) { return w.def.name; }),
    items: p.items.length,
    levelsGained: levels,
    shops: shops,
    buys: buys,
    peak: peak,
    step: {
      medianMs: +percentile(used, 0.5).toFixed(4),
      p95Ms: +percentile(used, 0.95).toFixed(4),
      trimmedMeanMs: +trimmed.toFixed(4),
      budgetPct: +(trimmed / (1000 / 60) * 100).toFixed(1)
    }
  };
}

export function formatReport(r) {
  var L = [];
  L.push('=== Bronana 无头跑局 ===');
  L.push('  角色      ' + r.charName + '（' + r.char + '） · 种子 ' + r.seed +
    (r.startWave > 1 ? ' · 从第 ' + r.startWave + ' 波开始' : ''));
  L.push('  结果      ' + (r.survived ? '撑过 ' + r.simSeconds + ' 秒没死' : '阵亡') +
    ' · 打到第 ' + r.waveReached + ' 波' +
    (r.stopReason === 'time' ? '' : ' · 提前结束（' + r.stopReason + '）'));
  L.push('  战绩      击杀 ' + r.kills + ' · 伤害 ' + r.damage + ' · 承受 ' + r.taken + ' · 治疗 ' + r.healed);
  L.push('  成长      等级 ' + r.level + '（升级 ' + r.levelsGained + ' 次） · 生命 ' + r.hp + '/' + r.maxHp +
    ' · 道具 ' + r.items + ' 件');
  L.push('  商店      进入 ' + r.shops + ' 次 · 购买 ' + r.buys + ' 件');
  L.push('  武器      ' + (r.weapons.length ? r.weapons.join(' / ') : '（无）'));
  L.push('  峰值      怪 ' + r.peak.enemies + ' · 子弹 ' + r.peak.bullets + ' · 掉落 ' + r.peak.pickups +
    ' · 粒子 ' + r.peak.particles);
  L.push('  性能      中位 ' + r.step.medianMs + 'ms · P95 ' + r.step.p95Ms + 'ms · 截尾均值 ' +
    r.step.trimmedMeanMs + 'ms（占 60fps 预算 ' + r.step.budgetPct + '%）');
  L.push('  吞吐      ' + r.steps + ' 步 / ' + r.wallMs + 'ms 真实时间 = ' + r.realtimeFactor + '× 实时');
  return L.join('\n');
}

/* =========================================================
   serve：静态服务器
   ========================================================= */
export async function runServe(o) {
  var root = path.resolve(o.root);
  var quiet = o.quiet;
  var s = await listen({
    root: root,
    host: o.host,
    port: o.port,
    log: quiet ? null : function (line) { console.log('  ' + line); }
  });
  console.log('静态服务器已启动：' + s.url);
  console.log('  目录  ' + root);
  console.log('  提示  ES 模块在 file:// 下会被 CORS 拦掉，所以要用这个地址打开，' +
    '或者用 `pnpm run preview`（Vite 自带预览）');
  console.log('  停止  Ctrl+C');
  var stop = function () {
    console.log('\n正在关闭…');
    s.close().then(function () { process.exit(0); });
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  return s;
}

/* =========================================================
   入口
   ========================================================= */
export async function main(argv) {
  /* 定义期自检先跑：命令行是自动化入口，表坏掉时**应该立刻非零退出**，
     而不是先跑完一局再给一份没人看得懂的报告。
     `registry: 'partial'`：命令行是"只有模拟层"的构建，渲染层家族
     （怪物造型 / 道具图标 / 武器造型，由 sprites.ts 注册）根本没加载，
     全量查会报上百条假警报（实测 147 条）；已注册家族里的坏值仍然会报。 */
  try {
    SelfCheck.run({ registry: 'partial' });
  } catch (e) {
    console.error(String((e && e.message) || e));
    return 2;
  }
  var parsed = parseArgs(argv);
  var errs = parsed.errors;
  if (errs.length) {
    for (var i = 0; i < errs.length; i++) console.error('参数错误：' + errs[i]);
    console.error('\n' + usage());
    return 1;
  }
  if (parsed.cmd === 'help') { console.log(usage()); return 0; }

  /* **接存储**：在这一步之后 `Settings` / `Profile` 的读写才会落盘。
     放在参数校验**之后**：参数写错了不该顺手在用户家里建目录。
     环境变量 `BRONANA_HOME` 改目录（测试与"想开两份档"要用）。
     接不上就退回内存适配器 —— "存不进去"绝不该让命令行崩（与 `storage.ts` 同一条纪律）。 */
  Storage.use(fileAdapter({
    dir: defaultSaveDir(),
    onError: function (m) { console.error('[storage] ' + m); }
  }));

  try {
    if (parsed.cmd === 'sim') {
      var r = runSim(parsed.opts);
      if (parsed.opts.json) console.log(JSON.stringify(r, null, 2));
      else console.log(formatReport(r));
      return 0;
    }
    if (parsed.cmd === 'serve') {
      await runServe(parsed.opts);
      return 0;                 // 进程靠 server 保持存活
    }
  } catch (e) {
    console.error('运行出错：' + (e && e.stack ? e.stack : e));
    return 2;
  }
  return 1;
}

/* 只有被当作入口直接运行时才跑（测试 import 本文件不应产生副作用） */
var invoked = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === invoked) {
  main(process.argv.slice(2)).then(function (code) {
    if (code) process.exitCode = code;
  });
}
