/* =========================================================
   decal-decide.cjs — 贴花三条决定的收尾
     1) render-check 增加贴花层专项断言（605→497 的回归护栏）
     2) README 增加"血迹贴花的三个取舍（拍板记录）"
   用法： node tools/decal-decide.cjs
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

/* ---------------- 1. 贴花层断言 ---------------- */
patch('test/render-check.mjs', [
  [`  console.log('    密集场景分层：' + dense.map(([k, v]) => k + ' ' + v).join('  ·  '));
  ok(cut > 15, '剔除显著降低绘制调用（300 怪铺满战场）', cut.toFixed(1) + '%');`,
    `  console.log('    密集场景分层：' + dense.map(([k, v]) => k + ' ' + v).join('  ·  '));

  /* 贴花层专项：它是密集场景第二大开销，也是"要不要上烘焙层"这个决定的依据。
     save/restore 提到循环外之后 605 → 497（每帧省 2×已画贴花数）。
     阈值取 560：改造前是 605，会红；现在 497，余量足够。 */
  const decalCalls = phaseCalls.decals || 0;
  const denseTotal = dense.reduce((a, b) => a + b[1], 0);
  console.log('    贴花层 ' + decalCalls + ' 次/帧（密集场景占比 ' +
    (decalCalls / Math.max(1, denseTotal) * 100).toFixed(1) + '%，改造前 605）');
  ok(decalCalls < 560, '贴花层每帧调用受控（save/restore 已提到循环外）', decalCalls + ' 次/帧');
  ok(cut > 15, '剔除显著降低绘制调用（300 怪铺满战场）', cut.toFixed(1) + '%');`, '贴花层断言']
]);

/* ---------------- 2. README ---------------- */
const SECTION = `## 血迹贴花的三个取舍（拍板记录）

三件事都"可以改"，但每一件都有代价。决定和依据留在这里，而不是留在聊天记录里。

### 1. 褪色 —— 保留

现在是环形缓冲 90 条，透明度按"新旧排名"从 0.55 线性淡到 0：最旧的正好淡到 0 时才被覆盖，
所以环形覆盖看不出跳变。代价是**褪色速度由击杀速度决定，而不是时间**：

- 密集对局实测约 64 次贴花写入/秒 → 整个窗口 90/64 ≈ **1.4 秒**换一遍。
- 换波时清空（"进入新一波时血迹清空"），所以观感是"这一波最近 90 次击杀的血"。

改成常数透明度（原版 Bronana：血迹不褪）能拿到永久血迹，但容量一到**就会有一条突然消失**；
要不跳变就只能不设上限，那样贴花层在密集场景会无限增长 —— 而 80 条时它已经是第二大开销。

把容量从 90 提到 140 只能延长约 55% 的留存，代价是贴花层每帧调用从 ~497 涨到约 940（+90%）。
**用 +90% 的绘制调用换 0.8 秒留存，不划算，拒绝。**

### 2. 颜色 —— 保留本色

怪物用各自本色（绿怪绿血、紫怪紫汁），玩家用 \`PAL.BLOOD\`。这是可读性设计：
一眼看出刚打死的是哪一类怪，也符合"异形"设定与低饱和平涂的美术宪法。**这是设定，不是遗漏。**

### 3. 贴花烘焙层 —— 不做，理由是可算的

"每帧 1 次 drawImage"看着很美，但它和现行的褪色规则**在数学上不兼容**。四条路都算过：

| 方案 | 每帧调用（密集场景） | 代价 |
| --- | --- | --- |
| 现状：逐条褪色 | **497** | — |
| 常数透明度 + 烘焙层 | ~2 | 容量一到就"啪"地消失一条血迹 |
| 烘焙层 + 每帧整层重烤 | ~165 | 密集对局几乎每帧都有击杀 → 重烤 = 每帧重画全部贴花，只快 3 倍，还多一块 4.3MB 离屏画布 |
| 按透明度分桶烘焙 | ~8 | 需要**每个桶一块战场大小的画布**：6 桶约 30MB 显存，且褪色变成 6 级台阶（可见色阶） |

根因一句话：**透明度是"排名"的函数，任何一次击杀都会改变所有贴花的透明度**，
整层永远处于"刚失效"状态，缓存无从谈起。

所以保持现状，只做了**零视觉代价**的那部分：把每个贴花各自的 \`save/restore\` 改成整个循环共用一次。
密集场景贴花层 **605 → 497 次/帧（−18%）**，总调用 3370 → 3262，像素完全一致。
\`render-check.mjs\` 加了这条断言守着（>560 就红）。

> 真要上烘焙层，得先把"逐条褪色"换成"整层淡出"（新旧血同浓度），或者再拆一层"新鲜层 / 陈旧层"。
> 那是肉眼可见的手感变化，而我看不到画面，所以不擅自做 —— 改动集中在一个函数里，你说一声就动。

`;

patch('README.md', [
  ['## 实现要点', SECTION + '## 实现要点', 'README 贴花取舍一节']
]);

console.log('已应用 ' + edits + ' 处改动');
if (misses.length) {
  console.log('\n\x1b[31m有 ' + misses.length + ' 处锚点未命中：\x1b[0m');
  for (const m of misses) console.log('  ' + m);
  process.exit(1);
}
console.log('\x1b[32m全部锚点命中 ✔\x1b[0m');
