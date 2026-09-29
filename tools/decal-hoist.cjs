/* =========================================================
   decal-hoist.cjs — 贴花循环里每个贴花各存一次画布状态栈
   每个贴花： save + 3×(beginPath+arc+fill) + restore = 11 次调用
   其中 save/restore 是每帧 2×N 的纯多余开销（循环中间没有任何别的绘制）。
   提到循环外只改 globalAlpha，画的还是同样三笔 —— 像素完全一致。
   用法： node tools/decal-hoist.cjs
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

patch('src/render.ts', [
  [`  var list = sess.decals;
  for (var i = 0; i < list.length; i++) {
    var d = list[i];
    if (!R.inView(d.x, d.y, d.r * 2)) continue;
    var a = R.decalAlpha(d, sess);
    if (a < 0.03) continue;              // 已经淡到看不见
    x.save();
    x.globalAlpha = a;
    D.circle(x, d.x, d.y, d.r, d.color, D.O.none);
    // 溅射：角度/距离/半径都在生成时随机过，每个血迹形状不同
    D.circle(x, d.x + Math.cos(d.a1) * d.r * d.d1, d.y + Math.sin(d.a1) * d.r * d.d1 * 0.7,
      d.r * d.s1, d.color, D.O.none);
    D.circle(x, d.x + Math.cos(d.a2) * d.r * d.d2, d.y + Math.sin(d.a2) * d.r * d.d2 * 0.7,
      d.r * d.s2, d.color, D.O.none);
    x.restore();
  }
}`,
    `  var list = sess.decals;
  // save/restore 提到循环外：循环中间没有任何别的绘制，每帧唯一的可变状态就是
  // globalAlpha。逐条 save/restore 在密集场景是 2×N 次纯多余调用（N≈55 → 110 次），
  // 提出来之后画的还是同样三笔，像素完全一致。
  x.save();
  for (var i = 0; i < list.length; i++) {
    var d = list[i];
    if (!R.inView(d.x, d.y, d.r * 2)) continue;
    var a = R.decalAlpha(d, sess);
    if (a < 0.03) continue;              // 已经淡到看不见
    x.globalAlpha = a;
    D.circle(x, d.x, d.y, d.r, d.color, D.O.none);
    // 溅射：角度/距离/半径都在生成时随机过，每个血迹形状不同
    D.circle(x, d.x + Math.cos(d.a1) * d.r * d.d1, d.y + Math.sin(d.a1) * d.r * d.d1 * 0.7,
      d.r * d.s1, d.color, D.O.none);
    D.circle(x, d.x + Math.cos(d.a2) * d.r * d.d2, d.y + Math.sin(d.a2) * d.r * d.d2 * 0.7,
      d.r * d.s2, d.color, D.O.none);
  }
  x.restore();
}`, 'drawDecals 提 save/restore']
]);

console.log('已应用 ' + edits + ' 处改动');
if (misses.length) {
  console.log('\n\x1b[31m有 ' + misses.length + ' 处锚点未命中：\x1b[0m');
  for (const m of misses) console.log('  ' + m);
  process.exit(1);
}
console.log('\x1b[32m全部锚点命中 ✔\x1b[0m');
