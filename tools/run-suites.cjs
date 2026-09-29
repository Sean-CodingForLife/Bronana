/* =========================================================
   run-suites.cjs — 把整套测试的输出写进文件
   沙箱里 node 的 stdout 不能走 PowerShell 管道（会报
   "StandardOutputEncoding is only supported when standard output is redirected"），
   而整套测试的输出很长、控制台只留尾部，失败行会被截掉。
   这里用文件描述符直接接管子进程的 stdout/stderr。

   用法： node tools/run-suites.cjs [输出文件]   （默认 test-run.txt）
   ========================================================= */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const out = path.resolve(root, process.argv[2] || 'test-run.txt');
const fd = fs.openSync(out, 'w');
const r = spawnSync(process.execPath, [path.join(root, 'test', 'run-all.mjs')], {
  cwd: root, stdio: ['ignore', fd, fd]
});
fs.closeSync(fd);

const text = fs.readFileSync(out, 'utf8');
const fails = text.split(/\r?\n/).filter(l => l.includes('FAIL') || l.includes('套件失败'));
console.log('输出已写入 ' + out + '（' + text.split(/\r?\n/).length + ' 行）');
console.log('FAIL 行 ' + fails.length + ' 条');
for (const f of fails.slice(0, 40)) console.log(f.replace(/\u001b\[\d+m/g, ''));
process.exit(r.status === null ? 1 : r.status);
