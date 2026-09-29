/* =========================================================
   run-all.mjs — 依次执行全部无头测试（**执行器**；清单在 suites.mjs）
   用法： node test/run-all.mjs
   ---------------------------------------------------------
   清单与执行分开的理由：`tools/verify.mjs` 的门名字里要写"共几套测试"，
   而那个数字写死了就会漂（真实漂过一次：门写着 49、实际 50）。
   它必须能**只 import 清单**，所以清单不能住在"一 import 就跑测试"的文件里。
   ========================================================= */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { SUITES } from './suites.mjs';

let failed = 0;
for (const [label, file] of SUITES) {
  const r = spawnSync(process.execPath, [path.join(import.meta.dirname, file)], { stdio: 'inherit' });
  if (r.status !== 0) { failed++; console.log('\x1b[31m套件失败：' + label + '\x1b[0m\n'); }
}

console.log('=========================================');
if (failed === 0) {
  console.log('\x1b[32m全部 ' + SUITES.length + ' 套测试通过 ✔\x1b[0m');
  process.exit(0);
} else {
  console.log('\x1b[31m' + failed + ' 套测试失败 ✘\x1b[0m');
  process.exit(1);
}
