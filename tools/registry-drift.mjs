/* =========================================================
   registry-drift.mjs — **登记漂移**：工具与测试有没有"能调的入口"
   ---------------------------------------------------------
   ## 为什么需要这一把尺子

   补 CI 与协作文档那一轮，顺手盘账时发现两类**真实**的漂移：

     | 漂移 | 症状 |
     | --- | --- |
     | `tools/score.mjs` / `draw-census.mjs` / `yaml-check.mjs` **存在但没有脚本** | 工具写得再好也没人能调 —— 它等于不存在 |
     | `test/arch.mjs` **在 49 套里跑，但没有 `test:*` 脚本** | 想单独跑一套时会发现"命令不存在" |
     | `tools/module-audit.mjs` **是 `guard-gaps` 的旧版、还在报假阳** | 两份工具同时存在 = 必然有一份撒谎，而人不知道该信哪份 |

   这三条都不是"代码写错了"，而是**登记漂移**：东西在，但账上没有它。
   它不会让任何测试变红，只会让下一个人多花半小时找"那个工具怎么跑"。

   ## 判据（与 `guard-gaps` 同一条纪律：只认能当场验证的事实）

     A **每个 `tools/*.mjs|cjs` 要么有 npm 脚本、要么被别的文件 import**
       （一次性迁移脚本单独登记在 `ONE_SHOT` 里 —— 它们的归宿是删掉，不是给脚本）
     B **每个 `test/*.mjs` 要么在 `test/run-all.mjs` 的清单里、要么有 `test:*` 脚本**
       （`run-all.mjs` 自己是运行器，不算）
     C **两个方向的对照都为空**：有脚本没进套件、进套件没脚本，都报出来
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const JSON_OUT = process.argv.includes('--json');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const scripts = pkg.scripts || {};

/* 一次性迁移脚本：跑完就该删。它们**不该**有 npm 脚本（那是把已经用完的东西摆上货架）。 */
const ONE_SHOT = ['apply-comp', 'batch-close', 'batch-num', 'decal-decide', 'decal-hoist',
  'esm-ify', 'esm-tests', 'finalize-comp', 'fix-comp', 'fix-types', 'migrate-types',
  'rename-bronana', 'rename-doudou', 'rewrite-items', 'tsc-report', 'canvas-numbers'];

/* 被别的文件 import 的库（不是给人直接跑的命令） */
const LIBS = ['systems'];

const readDir = d => fs.readdirSync(path.join(ROOT, d));

/* 一个文件名有没有被 repo 里任何文件 import / require。
   ⚠ 匹配的是**带引号的相对路径**（`'./_run.mjs'` / `'../test/_run.mjs'`），
   所以不能拿 `'文件名'` 去比整串 —— 第一版就是这么漏掉两个库的
   （`_run.mjs` 被 `'./_run.mjs'` 引用，字符串里根本没有 `'_run.mjs'`）。 */
function isImported(file, dirs) {
  const re = new RegExp('[\'"](\\.{1,2}/)*' + file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\'"]');
  for (const d of dirs) {
    for (const g of readDir(d)) {
      if (g === file) continue;
      if (re.test(fs.readFileSync(path.join(ROOT, d, g), 'utf8'))) return true;
    }
  }
  return false;
}

/* ---------------- A. 工具入口 ---------------- */
const toolFiles = readDir('tools').filter(f => /\.(mjs|cjs)$/.test(f)).sort();
const toolRows = toolFiles.map(f => {
  const base = f.replace(/\.(mjs|cjs)$/, '');
  const keys = Object.entries(scripts).filter(([, v]) => v.includes('tools/' + f)).map(([k]) => k);
  const oneShot = ONE_SHOT.indexOf(base) >= 0;
  const lib = LIBS.indexOf(base) >= 0 || isImported(f, ['tools', 'test']);
  return { file: f, base, keys, oneShot, lib, ok: keys.length > 0 || oneShot || lib };
});
const toolsMissingEntry = toolRows.filter(r => !r.ok);

/* ---------------- B/C. 测试登记 ---------------- */
const runAllSrc = fs.readFileSync(path.join(ROOT, 'test', 'suites.mjs'), 'utf8');
const listed = [...runAllSrc.matchAll(/\[\s*'[^']*'\s*,\s*'([^']+\.mjs)'\s*\]/g)].map(m => m[1]);
const testScripts = Object.entries(scripts)
  .filter(([k, v]) => k.indexOf('test:') === 0 && v.indexOf('test/') >= 0)
  .map(([k, v]) => ({ key: k, file: v.trim().replace(/^node\s+/, '').replace(/^test\//, '') }));

const listedSet = new Set(listed);
const scriptedSet = new Set(testScripts.map(s => s.file));
/* `run-all.mjs` 是运行器本身，`suites.mjs` 是**清单数据** —— 两者都不是测试套件。
   （清单从运行器里拆出来的理由是：`verify.mjs` 的门名字要按清单算套件数，
   而那个数字写死了就漂。见 `test/suites.mjs` 的头注释。） */
const runnerOnly = ['run-all.mjs', 'suites.mjs'];
const testFiles = readDir('test').filter(f => f.endsWith('.mjs') && f.charAt(0) !== '_' && runnerOnly.indexOf(f) < 0);

const inSuiteNoScript = listed.filter(f => !scriptedSet.has(f));
const scriptedNoSuite = testScripts.filter(s => !listedSet.has(s.file)).map(s => s.file);
const testOrphans = testFiles.filter(f => !listedSet.has(f) && !scriptedSet.has(f));

/* ---------------- 判定 ---------------- */
const problems = [];
for (const r of toolsMissingEntry) {
  problems.push('tools/' + r.file + ' 既没有 npm 脚本、也没有被 import —— 写好了没人能调');
}
for (const f of inSuiteNoScript) problems.push('test/' + f + ' 在套件里跑，但没有 `test:*` 脚本（想单独跑时命令不存在）');
for (const f of scriptedNoSuite) problems.push('test/' + f + ' 有 `test:*` 脚本，但不在 suites.mjs 的套件清单里');
for (const f of testOrphans) problems.push('test/' + f + ' 既不在套件里、也没有脚本 —— 它从来没被任何东西跑过');

if (JSON_OUT) {
  console.log(JSON.stringify({
    tools: toolRows, testFiles, inSuiteNoScript, scriptedNoSuite, testOrphans, problems
  }, null, 1));
  process.exit(problems.length ? 1 : 0);
}

const PAD = (s, n) => { s = String(s); let w = 0; for (const c of s) w += c.charCodeAt(0) > 127 ? 2 : 1; return s + ' '.repeat(Math.max(0, n - w)); };

console.log('\n=== Bronana · 登记漂移（工具与测试有没有入口）===\n');
console.log('  这条尺子量的是"东西在不在账上"，不是"代码写得好不好"。');
console.log('  症状很轻（不会让任何测试变红），代价很具体：下一个人找不到怎么跑它。\n');

console.log('[1] 工具入口（' + toolFiles.length + ' 个文件）');
console.log('  ' + PAD('文件', 26) + PAD('npm 脚本', 24) + '状态');
for (const r of toolRows) {
  let st;
  if (r.keys.length) st = '';
  else if (r.oneShot) st = '\x1b[90m一次性迁移脚本（跑完就该删）\x1b[0m';
  else if (r.lib) st = '\x1b[36m库 / 被 import（无需脚本）\x1b[0m';
  else st = '\x1b[31m✘ 没有入口\x1b[0m';
  console.log('  ' + PAD(r.file, 26) + PAD(r.keys.join(',') || '—', 24) + st);
}

console.log('\n[2] 测试登记（套件 ' + listed.length + ' 套 · 脚本 ' + testScripts.length + ' 个）');
console.log('  仅在套件里：' + (inSuiteNoScript.length ? '\x1b[33m' + inSuiteNoScript.join(', ') + '\x1b[0m' : '\x1b[32m无\x1b[0m'));
console.log('  仅有脚本　：' + (scriptedNoSuite.length ? '\x1b[33m' + scriptedNoSuite.join(', ') + '\x1b[0m' : '\x1b[32m无\x1b[0m'));
console.log('  两处都没有：' + (testOrphans.length ? '\x1b[31m' + testOrphans.join(', ') + '\x1b[0m' : '\x1b[32m无\x1b[0m'));

console.log('\n=== 结果 ===');
if (!problems.length) console.log('  \x1b[32m✔ 无漂移：每个工具都能被调到，每套测试都有名字\x1b[0m');
else {
  console.log('  \x1b[31m✘ ' + problems.length + ' 处漂移：\x1b[0m');
  for (const p of problems) console.log('    · ' + p);
}
console.log('');
process.exit(problems.length ? 1 : 0);
