/* =========================================================
   tsc-report.js — 跑 tsc 并把诊断汇总成可读清单
   （沙箱禁止管道捕获子进程输出，所以用文件描述符而不是 pipe）
   用法： node tools/tsc-report.cjs [--emit]
   ========================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CANDIDATES = [
  process.env.TSC_BIN,
  path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
  path.join(ROOT, '..', 'deepseek-harness', 'node_modules', 'typescript', 'bin', 'tsc'),
  'C:/Users/Administrator/Desktop/deepseek-harness/node_modules/typescript/bin/tsc'
].filter(Boolean);

const tsc = CANDIDATES.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
if (!tsc) {
  console.error('找不到 tsc。请先 `pnpm add -D typescript`，或用 TSC_BIN 指定路径。');
  process.exit(2);
}

const emit = process.argv.indexOf('--emit') >= 0;
const logPath = path.join(ROOT, 'tsc-report.txt');
const fd = fs.openSync(logPath, 'w');

const args = [tsc, '--pretty', 'false', '-p', path.join(ROOT, 'tsconfig.json')];
if (!emit) args.splice(1, 0, '--noEmit');

const started = Date.now();
const r = spawnSync(process.execPath, args, {
  cwd: ROOT,
  stdio: ['ignore', fd, fd]      // 文件描述符：不是管道，不受沙箱限制
});
fs.closeSync(fd);

const txt = fs.readFileSync(logPath, 'utf8');
const lines = txt.split(/\r?\n/).filter(l => l.indexOf('error TS') >= 0);

console.log('tsc ' + (emit ? '(emit)' : '(--noEmit)') + '  用时 ' + (Date.now() - started) + 'ms  退出码 ' + r.status);
console.log('诊断条数：' + lines.length);

if (!lines.length) {
  console.log('\n\x1b[32m类型检查通过 ✔\x1b[0m');
  process.exit(r.status === 0 ? 0 : 1);
}

// 按错误码与文件聚合
const byCode = {};
const byFile = {};
for (const l of lines) {
  const m = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(l);
  if (!m) continue;
  const file = path.relative(ROOT, m[1]).replace(/\\/g, '/');
  byCode[m[4]] = (byCode[m[4]] || 0) + 1;
  byFile[file] = (byFile[file] || 0) + 1;
}

const top = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);
console.log('\n按错误码：');
for (const [code, n] of top(byCode, 12)) {
  const sample = lines.find(l => l.indexOf(code) >= 0);
  const msg = sample ? sample.replace(/^.*error TS\d+: /, '') : '';
  console.log('  ' + code.padEnd(9) + String(n).padStart(4) + '  ' + msg.slice(0, 70));
}
console.log('\n按文件：');
for (const [f, n] of top(byFile, 20)) console.log('  ' + f.padEnd(22) + String(n).padStart(4));

console.log('\n前 25 条明细：');
for (const l of lines.slice(0, 25)) console.log('  ' + l.replace(ROOT + path.sep, '').replace(/\\/g, '/'));
console.log('\n完整清单：' + path.relative(ROOT, logPath));
process.exit(1);
