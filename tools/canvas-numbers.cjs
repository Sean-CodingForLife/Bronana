/* =========================================================
   canvas-numbers.cjs — 更正决策记录里的离屏画布显存数字
   我把"一屏"当成了"战场"：战场是 1680×1260，烘焙画布还要外扩 40px，
   即 1760×1340×4B = 9.0MB / 层，而不是我写的 4.3MB。
   实测口径：
     单层战场画布        9.0 MB
     现有 地面 + 岩石    18.0 MB
     再加贴花层          27.0 MB
     6 桶方案            54.0 MB
   用法： node tools/canvas-numbers.cjs
   ========================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const misses = [];
let edits = 0;

function patch(rel, pairs) {
  const p = path.join(ROOT, rel);
  let s = fs.readFileSync(p, 'utf8');
  for (const [from, to, label] of pairs) {
    const at = s.indexOf(from);
    if (at < 0) { misses.push(rel + '  ←  ' + label); continue; }
    if (s.indexOf(from, at + 1) >= 0) { misses.push(rel + '  ← 锚点不唯一：' + label); continue; }
    s = s.slice(0, at) + to + s.slice(at + from.length);
    edits++;
  }
  fs.writeFileSync(p, s);
}

patch('README.md', [
  ['只快 3 倍，还多一块 4.3MB 离屏画布 |',
    '只快 3 倍，还多一块 **9.0MB** 的战场大小离屏画布（现有地面 / 岩石两层已经占了 18.0MB） |',
    '重烤方案画布体积'],
  ['需要**每个桶一块战场大小的画布**：6 桶约 30MB 显存，且褪色变成 6 级台阶（可见色阶） |',
    '需要**每个桶一块战场大小的画布**：6 桶约 **54MB**，且褪色变成 6 级台阶（可见色阶） |',
    '分桶方案画布体积'],
  ['每次击杀都要整层重烤，只快 3 倍还多一块 4.3MB 画布）；',
    '每次击杀都要整层重烤，只快 3 倍还多一块 9.0MB 画布，而现有两层已占 18.0MB）；',
    '结论段画布体积']
]);

console.log('已应用 ' + edits + ' 处改动');
if (misses.length) {
  console.log('\n\x1b[31m有 ' + misses.length + ' 处锚点未命中：\x1b[0m');
  for (const m of misses) console.log('  ' + m);
  process.exit(1);
}
console.log('\x1b[32m全部锚点命中 ✔\x1b[0m');
