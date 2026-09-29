/* =========================================================
   coverage.mjs — **真实覆盖率**（用 Node 自带的 V8 覆盖率，不装任何包）
   ---------------------------------------------------------
   这个项目有 45 套测试、13 把尺子，但一直回答不了最简单的一个问题：
   **"我到底测到了多少代码？"**

   为什么不用 c8 / nyc：这是零依赖项目（`devDependencies` 只有
   typescript / vite / electron / @types/node）。而 Node 自己就能导出
   V8 的精确覆盖率 —— `NODE_V8_COVERAGE=<目录> node ...`。
   本文件是那个 JSON 的读取器 + 合并器。

   **合并是必须的**：一次收集会产生几十个 JSON（每个子进程一个），
   同一个源文件在里面出现几十次。不去重合并的话，"命中率"取决于
   最后那个进程恰好跑了什么（第一版就是这样，读出来每个文件都"100%"）。

   怎么读它的结论：
     · 单位是**函数**：一个函数只要被调用过一次就算命中
     · `ranges[0].startOffset === 0` 的那条是**脚本包装**（`functionName === ''`），
       不是真函数 —— 必须排掉
     · `count === 0` 且**够大**（≥120 字节）的子区间 = 整块没跑过的代码，
       那才是要找的东西（小分支到处都是，报出来是噪声）
     · **不追 100%**：`cli.ts` 的 serve 模式、`desktop/` 的 Electron 外壳、
       `render.ts` 的少见绘制分支在无头环境里本来就不该跑到。
       要的是"**没有整块没被测过的核心逻辑**"。

   用法：
     node tools/coverage.mjs            # 跑探针 + 全套测试并汇总
     node tools/coverage.mjs --keep     # 保留原始 JSON 供细查
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, '.coverage');
const KEEP = process.argv.includes('--keep');
const RUNS = process.argv.includes('--quick') ? '4' : '8';

function run(args, env) {
  return spawnSync(process.execPath, args, {
    cwd: ROOT, stdio: 'ignore',
    env: Object.assign({}, process.env, env || {})
  });
}

fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) fs.rmSync(path.join(OUT, f), { recursive: true, force: true });

console.log('\n=== Bronana · 真实覆盖率（V8 原生）===\n');
console.log('  正在收集：不变量探针（' + RUNS + ' 局）+ 全套 45 套测试 …');

const env = { NODE_V8_COVERAGE: OUT };
const t0 = Date.now();
run(['tools/bug-probe.mjs', RUNS, '40'], env);
run(['test/run-all.mjs'], env);
const secs = (Date.now() - t0) / 1000;
console.log('  收集完成（' + secs.toFixed(0) + ' 秒）\n');

/* ---------------- 合并：同一个源文件在几十个 JSON 里各出现一次 ---------------- */
/** key = 源文件相对路径；value = { fns: Map<rootKey, {name, ranges}> } */
const files = new Map();

function bump(key, rootKey, name, ranges) {
  if (!files.has(key)) files.set(key, new Map());
  const m = files.get(key);
  if (!m.has(rootKey)) m.set(rootKey, { name, ranges: ranges.map(r => ({ s: r.startOffset, e: r.endOffset, c: 0 })) });
  const rec = m.get(rootKey);
  /* 合并"这一段有没有被执行过"：只关心 0 与非 0 的**并集**，
     所以对同名区间的 count 取逻辑或即可（用 1 标记"跑过"）。 */
  for (const r of ranges) {
    if (!(r.count > 0)) continue;
    for (const t of rec.ranges) {
      if (r.startOffset >= t.s && r.endOffset <= t.e) t.c = 1;
    }
  }
}

let jsonCount = 0;
for (const f of fs.readdirSync(OUT)) {
  if (!f.endsWith('.json')) continue;
  let data = null;
  try { data = JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')); } catch (e) { continue; }
  jsonCount++;
  for (const script of (data.result || [])) {
    const url = script.url || '';
    if (url.indexOf('/src/') < 0 && url.indexOf('/tools/') < 0) continue;
    let p = url.replace(/^file:\/\/\//, '').replace(/\//g, path.sep);
    try { p = decodeURIComponent(p); } catch (e) { }
    if (p.indexOf(ROOT) !== 0) continue;
    const key = path.relative(ROOT, p);
    for (const fn of (script.functions || [])) {
      const root = fn.rootRange || (fn.ranges && fn.ranges[0]);
      if (!root) continue;
      /* 排掉"脚本包装"：它的 range 是整个文件、名字是空的 */
      if (root.startOffset === 0 && (!fn.functionName || fn.functionName === '')) continue;
      if (!fn.ranges || !fn.ranges.length) continue;
      bump(key, root.startOffset + ':' + root.endOffset, fn.functionName || '(anonymous)', fn.ranges);
    }
  }
}

if (!files.size) {
  console.log('  \x1b[31m没读到任何覆盖率数据（' + jsonCount + ' 个 JSON）—— NODE_V8_COVERAGE 没生效？\x1b[0m\n');
  process.exit(1);
}

/* ---------------- 汇总 ---------------- */
const PAD = (s, n) => { s = String(s); return s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 127 ? 2 : 1), 0))); };
const rows = [];
for (const [k, m] of files) {
  if (k.indexOf('node_modules') >= 0) continue;
  let fns = 0, called = 0, dead = 0;
  for (const rec of m.values()) {
    fns++;
    if (rec.ranges.some(r => r.c > 0)) called++;
    for (const r of rec.ranges) if (r.c === 0 && (r.e - r.s) >= 120) dead++;
  }
  rows.push({ file: k, fns, called, pct: fns ? called / fns : 1, dead });
}
rows.sort((a, b) => a.pct - b.pct || b.fns - a.fns);
const srcRows = rows.filter(r => r.file.startsWith('src' + path.sep));
const toolRows = rows.filter(r => !r.file.startsWith('src' + path.sep));

function table(title, list) {
  console.log(title);
  console.log('  ' + PAD('文件', 24) + PAD('函数', 6) + PAD('命中', 6) + PAD('fn%', 6) + '没跑过的大块');
  for (const r of list) {
    const mark = r.pct < 0.5 ? '\x1b[31m' : (r.pct < 0.8 ? '\x1b[33m' : '\x1b[32m');
    console.log('  ' + PAD(r.file, 24) + PAD(r.fns, 6) + PAD(r.called, 6) +
      mark + PAD((r.pct * 100).toFixed(0) + '%', 6) + '\x1b[0m' + (r.dead || ''));
  }
  const fns = list.reduce((a, b) => a + b.fns, 0);
  const called = list.reduce((a, b) => a + b.called, 0);
  console.log('  ' + PAD('合计', 24) + PAD(fns, 6) + PAD(called, 6) +
    ((called / Math.max(1, fns)) * 100).toFixed(0) + '%');
  console.log('');
}

table('[1] src/ —— 游戏本体', srcRows);
table('[2] tools/ —— 工具', toolRows);

/* ---------------- 核心模块的短板 ---------------- */
const CORE = ['game.ts', 'market.ts', 'dungeon.ts', 'profile.ts', 'ui.ts', 'render.ts',
  'sprites.ts', 'enemies.ts', 'stats.ts', 'camp.ts', 'stronghold.ts', 'forge.ts', 'craft.ts', 'music.ts'];
console.log('[3] 核心模块里"命中函数最少的"（<80% 就值得看一眼）');
let any = false;
for (const r of srcRows) {
  if (CORE.indexOf(path.basename(r.file)) < 0) continue;
  if (r.pct < 0.8) {
    any = true;
    console.log('  \x1b[33m' + PAD(r.file, 24) + (r.pct * 100).toFixed(0) + '%\x1b[0m  只有 ' +
      r.called + '/' + r.fns + ' 个函数被调用过');
  }
}
if (!any) console.log('  \x1b[32m核心模块全部 ≥80% ✔\x1b[0m');
console.log('');

/* ---------------- 结论 ---------------- */
const srcFns = srcRows.reduce((a, b) => a + b.fns, 0);
const srcCalled = srcRows.reduce((a, b) => a + b.called, 0);
console.log('=== 结果 ===');
console.log('  合并了 ' + jsonCount + ' 个 V8 JSON · src/ 函数级覆盖：' +
  srcCalled + ' / ' + srcFns + ' = \x1b[1m' + ((srcCalled / Math.max(1, srcFns)) * 100).toFixed(1) + '%\x1b[0m');
console.log('  最低的六个：' + srcRows.slice(0, 6).map(r => path.basename(r.file) + ' ' + (r.pct * 100).toFixed(0) + '%').join(' · '));
console.log('  最高的六个：' + srcRows.slice(-6).map(r => path.basename(r.file) + ' ' + (r.pct * 100).toFixed(0) + '%').join(' · '));
console.log('  （不追 100%：`cli.ts` 的 serve、`desktop/` 的 Electron 外壳、');
console.log('    `render.ts` 的少见绘制分支在无头环境里本来就不该跑到。）');
if (!KEEP) { try { fs.rmSync(OUT, { recursive: true, force: true }); } catch (e) { } }
console.log('');
