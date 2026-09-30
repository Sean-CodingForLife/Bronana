/* =========================================================
   test-for.mjs — **改了哪个模块，该跑哪几套测试**
   ---------------------------------------------------------
   要解决的问题（用户提的）：现在每次改一行都要跑 57 套（约 40 秒），
   而其中大部分与这次改动无关；失败时又只能一套一套去看。

   做法是**静态推导**，不给 57 套逐一加声明：
     · `test/_load.mjs` 的 `MODULES` 已经写着「名字 → src 文件」
       （测试通过 `globalThis.<名字>` 拿到模块）
     · `tools/systems.cjs` 已经写着「模块 → 系统」
   于是「某个 src 文件被哪些套件用到」可以算出来，不必人工维护。

   用法：
     node tools/test-for.mjs src/profile.ts     # 只跑受影响的
     node tools/test-for.mjs src/profile.ts -v  # 连"为什么"一起打印
     node tools/test-for.mjs --all              # 列全部
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const ROOT = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const { SYSTEMS } = require('./systems.cjs');

/* ---- 1. 名字 → src 文件（来自 _load.mjs 的 MODULES）---- */
const loadSrc = fs.readFileSync(path.join(ROOT, 'test', '_load.mjs'), 'utf8');
const modBlock = /const MODULES = \{([\s\S]*?)\n\};/.exec(loadSrc);
const NAME_TO_FILE = Object.create(null);
if (modBlock) {
  for (const m of modBlock[1].matchAll(/^\s*(\w+):\s*'\.\.\/src\/([\w.]+)'/gm)) {
    NAME_TO_FILE[m[1]] = m[2];
  }
}

/* ---- 2. src 文件 → 系统（来自 systems.cjs）---- */
const FILE_TO_SYS = Object.create(null);
for (const sys of SYSTEMS) {
  for (const f of sys.modules || []) FILE_TO_SYS[f] = sys.id;
}

/* ---- 3. 每个套件用到哪些名字 ----
   ⚠ 只看**真的当对象用**的地方（`Name.`），不是注释里的提及。
   注释先去干净，否则"注释里举的例子"会被算成依赖。 */
const stripComments = (t) => t
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const suitesSrc = fs.readFileSync(path.join(ROOT, 'test', 'suites.mjs'), 'utf8');
const SUITES = [...suitesSrc.matchAll(/\['([^']*)',\s*'([\w.-]+)'\]/g)].map((m) => ({ label: m[1], file: m[2] }));

const suiteUses = [];   // { file, label, files: Set, systems: Set }
for (const s of SUITES) {
  const p = path.join(ROOT, 'test', s.file);
  if (!fs.existsSync(p)) continue;
  const t = stripComments(fs.readFileSync(p, 'utf8'));
  const files = new Set();
  const systems = new Set();
  for (const name of Object.keys(NAME_TO_FILE)) {
    if (new RegExp('\\b' + name + '\\s*[.[(]').test(t) || new RegExp('\\b' + name + '\\b').test(t.split('\n').slice(0, 30).join('\n'))) {
      const f = NAME_TO_FILE[name];
      files.add(f);
      if (FILE_TO_SYS[f]) systems.add(FILE_TO_SYS[f]);
    }
  }
  suiteUses.push({ file: s.file, label: s.label, files, systems });
}

/* ---- 4. 反查：某個 src 文件被哪些套件用到 ---- */
function suitesFor(target) {
  const base = path.basename(target);
  const hit = suiteUses.filter((s) => s.files.has(base));
  /* 用同一系统的套件也算上：同一个系统里的模块常常一起被改动影响 */
  const sys = FILE_TO_SYS[base];
  const sameSys = sys ? suiteUses.filter((s) => s.systems.has(sys)) : [];
  const set = new Map();
  for (const s of hit) set.set(s.file, '直接用到 ' + base);
  for (const s of sameSys) if (!set.has(s.file)) set.set(s.file, '同系统（' + sys + '）');
  return set;
}

const args = process.argv.slice(2);
const verbose = args.includes('-v');
const targets = args.filter((a) => !a.startsWith('-'));

if (!targets.length || args.includes('--all')) {
  console.log('\n=== 每个 src 文件 → 受影响的套件数 ===\n');
  const rows = [];
  for (const f of Object.keys(FILE_TO_SYS)) {
    const n = suitesFor(f).size;
    if (n) rows.push({ f, n, sys: FILE_TO_SYS[f] });
  }
  rows.sort((a, b) => b.n - a.n);
  for (const r of rows) console.log('  ' + r.f.padEnd(22) + ('[' + r.sys + ']').padEnd(12) + r.n + ' 套');
  console.log('\n  共 ' + SUITES.length + ' 套 · 用法：node tools/test-for.mjs <src 文件>');
  process.exit(0);
}

/* ---- 5. 跑起来 ---- */
const all = new Map();
for (const t of targets) for (const [f, why] of suitesFor(t)) if (!all.has(f)) all.set(f, why);

console.log('\n=== 受影响 ' + all.size + ' / ' + SUITES.length + ' 套（改了 ' + targets.join(' ') + '）===\n');
for (const [f, why] of all) console.log('  ' + f.padEnd(22) + (verbose ? why : ''));
console.log('');

if (!all.size) { console.log('  （没有套件用到它 —— 该模块可能只被 src 内部使用）\n'); process.exit(0); }

let failed = 0;
const t0 = Date.now();
for (const f of all.keys()) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'test', f)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log('\n' + (failed ? '\x1b[31m' + failed + ' 套失败 ✘\x1b[0m' : '\x1b[32m' + all.size + ' 套全过 ✔\x1b[0m') + '  用时 ' + secs + 's');
process.exit(failed ? 1 : 0);
