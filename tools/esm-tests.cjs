/* =========================================================
   esm-tests.js — 把 CJS + vm.runInThisContext 的测试套件改成真正的 ESM
   规则：
     · require('fs'/'path') → import ... from 'node:fs'/'node:path'
     · __dirname → import.meta.dirname
     · "手写 FILES 列表 + vm 逐个求值" → await loadAll(...)（见 test/_load.mjs）
   用法： node tools/esm-tests.cjs
   ========================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const TEST = path.resolve(__dirname, '..', 'test');

const HEAD_OLD = "const fs = require('fs');\nconst path = require('path');\nconst vm = require('vm');";
const HEAD_NEW = [
  "import fs from 'node:fs';",
  "import path from 'node:path';",
  "import { loadAll, SIM, RENDER, UI } from './_load.mjs';"
].join('\n');

/** name -> { mods, cut: [正则, 替换] }  cut 用来摘掉原加载块 */
const JOBS = {
  'smoke.js': {
    mods: 'SIM',
    cut: [/\/\/ 模拟层文件（不含任何 DOM 依赖）\nconst FILES = \[[\s\S]*?\n\];\n/,
      "/* ---------------- 加载 ---------------- */\n" +
      "console.log('\\n=== Bronana · 无头冒烟测试 ===\\n');\n" +
      "console.log('[1] 加载模拟层');\n" +
      "let loadErr = null;\n" +
      "try { await loadAll(SIM); } catch (e) { loadErr = e.message; }\n" +
      "ok(!loadErr, '全部模拟层模块以 ES 模块方式加载成功', loadErr);\n" +
      "if (loadErr) process.exit(1);\n"]
  },
  'states.js': { mods: 'SIM' },
  'signals.js': { mods: 'SIM' },
  'particles.js': { mods: 'SIM' },
  'packs.js': { mods: 'SIM' },
  'perf.js': { mods: 'SIM' },
  'render-check.js': {
    mods: 'RENDER',
    cut: [/const FILES = \[[\s\S]*?if \(loadErr\) process\.exit\(1\);\n/,
      "let loadErr = null;\n" +
      "try { await loadAll(RENDER); } catch (e) { loadErr = e.message; }\n" +
      "ok(!loadErr, '渲染层以 ES 模块方式加载无异常', loadErr);\n" +
      "if (loadErr) process.exit(1);\n"]
  },
  'ui-check.js': {
    mods: 'UI',
    cut: [/const FILES = \[[\s\S]*?if \(loadErr\) \{ console\.log\('\\n\\x1b\[31m无法继续\\x1b\[0m\\n'\); process\.exit\(1\); \}\n/,
      "let loadErr = null;\n" +
      "try { await loadAll(UI); } catch (e) { loadErr = e.message; }\n" +
      "ok(!loadErr, '全部模块以 ES 模块方式加载无异常', loadErr);\n" +
      "if (loadErr) { console.log('\\n\\x1b[31m无法继续\\x1b[0m\\n'); process.exit(1); }\n"]
  }
};

const GENERIC_LOAD = /const FILES = \[[\s\S]*?\];\r?\nfor \(const f of FILES\) vm\.runInThisContext\(fs\.readFileSync\(path\.join\(ROOT, f\), 'utf8'\), \{ filename: f \}\);\r?\n/;

let n = 0;
for (const [src, job] of Object.entries(JOBS)) {
  const p = path.join(TEST, src);
  let s = fs.readFileSync(p, 'utf8');

  s = s.replace(/^'use strict';\r?\n\r?\n?/m, '');
  if (s.indexOf(HEAD_OLD) < 0) console.log('  【头未命中】' + src);
  s = s.replace(HEAD_OLD, HEAD_NEW);
  s = s.replace(/path\.resolve\(__dirname, '\.\.'\)/g, "path.resolve(import.meta.dirname, '..')");

  if (job.cut) {
    if (!job.cut[0].test(s)) console.log('  【加载块未命中】' + src);
    s = s.replace(job.cut[0], job.cut[1]);
  } else {
    if (!GENERIC_LOAD.test(s)) console.log('  【加载块未命中】' + src);
    s = s.replace(GENERIC_LOAD, 'await loadAll(' + job.mods + ');\n');
  }

  // 文件名里出现 js/xxx.js 的说明性注释一并更新
  s = s.replace(/js\/([a-z_0-9]+)\.js/g, 'src/$1.ts');

  fs.rmSync(p);
  fs.writeFileSync(path.join(TEST, src.replace(/\.js$/, '.mjs')), s);
  n++;
  console.log('  ' + src.padEnd(18) + '→ ' + src.replace(/\.js$/, '.mjs') + '   加载 ' + job.mods);
}
console.log('\n共转换 ' + n + ' 个套件');
