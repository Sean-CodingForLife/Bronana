/* =========================================================
   batch-num.cjs — README 里的烘焙帧数字改成实测值
   用法： node tools/batch-num.cjs
   ========================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const p = path.join(ROOT, 'README.md');
let s = fs.readFileSync(p, 'utf8');
const from = '`render-check.mjs` 现在会把换波那一帧单独测出来并给出分层明细：它确实是全游戏最重的单帧\n（约 4.9 万次调用，其中绝大多数是抖动），这是**已知且接受**的每波一次尖峰。';
const to = '`render-check.mjs` 现在会把换波那一帧单独测出来并给出分层明细。密集场景下实测\n**51,096 次调用，其中 ground（抖动）47,835 次，占 93.6%** —— 这就是全游戏最重的单帧，\n且基本全是抖动。这是**已知且接受**的每波一次尖峰。';
if (s.indexOf(from) < 0) { console.log('\x1b[31m锚点未命中\x1b[0m'); process.exit(1); }
fs.writeFileSync(p, s.replace(from, to));
console.log('\x1b[32mREADME 数字已更新为实测值 ✔\x1b[0m');
