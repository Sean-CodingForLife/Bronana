/* =========================================================
   readme-stats.cjs — 把 README 的"仓库存量"表按**实测值**刷新
   ---------------------------------------------------------
   为什么要有它：这张表**漂过**（写着 `game.ts` 3446 行 / 55 个模块，
   而实际是别的数）。**漂了的统计比没有统计更糟** —— 它看起来是量过的，
   于是没人再去看真正的数字。

   它只改"能当场算准"的行：
     · 模块数 / 总行数 / `types.d.ts` 行数（数文件）
     · 超过 700 行的模块清单（排序取阈值）
     · 扇入最高 / 依赖最重（**从 `arch-audit` 读**，不在这里猜）
   其余行（依赖环 / 死接口 / 向上的边 / 扩展点）各有自己的门在守，这里不碰。

   用法： node tools/readme-stats.cjs
   它同时是 `pnpm verify` 的一条门（`readme-stats --check`）：
   对不上就报出"表里写的是什么、实测是什么"，而不是默默改掉。
   ========================================================= */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const CHECK = process.argv.indexOf('--check') >= 0;

/* ---- 1. 数文件 ---- */
const files = fs.readdirSync(SRC).filter(f => f.endsWith('.ts') && f !== 'types.d.ts');
let total = 0;
const rows = [];
for (const f of files) {
  const n = fs.readFileSync(path.join(SRC, f), 'utf8').split('\n').length;
  total += n; rows.push([f, n]);
}
rows.sort((a, b) => b[1] - a[1]);
const dts = fs.readFileSync(path.join(SRC, 'types.d.ts'), 'utf8').split('\n').length;
const big = rows.filter(r => r[1] > 700).map(r => '`' + r[0] + '` ' + r[1]).join(' · ');

/* ---- 2. 从 arch-audit 读真实的扇入扇出 ---- */
function auditStat() {
  const out = execFileSync(process.execPath, [path.join(__dirname, 'arch-audit.cjs')],
    { encoding: 'utf8', maxBuffer: 1 << 24 });
  const fanIn = {}, fanOut = {};
  for (const line of out.split('\n')) {
    /* 表格行：`  模块名  行数  代码行  扇入  扇出  依赖 → …` */
    const m = /^ {2}(\S+\.ts)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s/.exec(line);
    if (m) { fanIn[m[1]] = Number(m[4]); fanOut[m[1]] = Number(m[5]); }
  }
  const top = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);
  return { fanIn: top(fanIn, 3), fanOut: top(fanOut, 3) };
}
const stat = auditStat();
const fanInTxt = stat.fanIn.map(([f, n]) => '`' + f + '` ' + n).join(' · ');
const fanOutTxt = stat.fanOut.map(([f, n]) => '`' + f + '` ' + n).join(' · ');

/* ---- 3. 改（或校验）README ---- */
const f = path.join(ROOT, 'README.md');
const lines = fs.readFileSync(f, 'utf8').split('\n');

/** 表里每一行的期望值：`键 → 整行文本`（缩进统一 0，模板里本来就没有缩进） */
const WANT = {
  '模块': '| 模块 | ' + files.length + ' 个 · ' + total + ' 行（另有 `types.d.ts` ' + dts + ' 行） |',
  '扇入最高的模块': '| 扇入最高的模块 | ' + fanInTxt + ' |',
  '依赖最重的模块': '| 依赖最重的模块 | ' + fanOutTxt + ' |',
  '超过 700 行的模块': '| 超过 700 行的模块 | ' + big + ' |'
};
const bad = [];
for (const key of Object.keys(WANT)) {
  const re = new RegExp('^\\s*\\|\\s*' + key + '\\s*\\|');
  const i = lines.findIndex(l => re.test(l));
  if (i < 0) { bad.push(key + '（README 里没有这一行）'); continue; }
  /* 整行规范化：表里其余行都是**顶格**的，所以改写时也顶格 ——
     留两格缩进的话，"哪几行是被脚本改过的"会从排版上一眼看出，
     而下一轮的人会以为那几行有特殊含义。 */
  const want = WANT[key];
  if (lines[i].trim() === want) { if (lines[i] !== want) lines[i] = want; continue; }
  if (CHECK) { bad.push(key + '\n      README: ' + lines[i].trim() + '\n      实测:   ' + want); continue; }
  lines[i] = want;
}
if (CHECK) {
  if (bad.length) {
    console.error('[readme-stats] README 的存量表与实际不符：');
    for (const b of bad) console.error('  ✘ ' + b);
    console.error('  跑 `node tools/readme-stats.cjs` 刷新它。');
    process.exit(1);
  }
  console.log('[readme-stats] 一致：' + files.length + ' 个模块 · ' + total + ' 行 · 超 700 行 ' +
    rows.filter(r => r[1] > 700).length + ' 个');
  process.exit(0);
}
fs.writeFileSync(f, lines.join('\n'));
console.log('模块 ' + files.length + ' 个 · ' + total + ' 行 · types.d.ts ' + dts + ' 行');
console.log('扇入最高：' + fanInTxt);
console.log('依赖最重：' + fanOutTxt);
console.log('超 700 行：' + big);
