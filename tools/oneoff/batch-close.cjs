/* =========================================================
   batch-close.cjs — 收掉"批处理"这条线
     1) render-check：把换波那一帧（地面烘焙）单独测出来 + 上下限断言
     2) README：更正"纯填充批处理"的两处说法，并给出三个候选的最终结论
   用法： node tools/batch-close.cjs
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

/* ---------------- 1. 换波烘焙帧专项 ---------------- */
patch('test/render-check.mjs', [
  [`  // 精度校验：视野内 5 只 + 视野外 5 只 → 恰好画 5 张身体贴图`,
    `  /* 换波那一帧：地面烘焙是全游戏最重的单帧。把它单独测出来，而不是让一个
     "峰值 4.9 万" 的数字孤零零印在日志里 —— 这是已知并接受的每波一次尖峰，
     但它的上限要有人守（有人在静态层里加重活就会红）。 */
  {
    R.ground.wave = -1;                       // 强制重新烘焙
    for (const k in phaseCalls) delete phaseCalls[k];
    const c0 = drawCalls.count;
    R.draw(1 / 60);
    const bakeCalls = drawCalls.count - c0;
    const bakeSplit = Object.entries(phaseCalls).map(([k, v]) => k + ' ' + v).sort()
      .filter(s => !/ (0|1|4|9|10)$/.test(s)).join('  ·  ');
    console.log('    换波烘焙帧 ' + bakeCalls + ' 次调用（' + bakeSplit + '）');
    ok(bakeCalls > 20000, '地面烘焙确实是最重的单帧（4.5 万次 fillRect 的抖动）', bakeCalls);
    ok(bakeCalls < 60000, '烘焙帧上限被守住（>60000 说明静态层里被加了重活）', bakeCalls);
  }

  // 精度校验：视野内 5 只 + 视野外 5 只 → 恰好画 5 张身体贴图`, '烘焙帧专项']
]);

/* ---------------- 2. README ---------------- */
const SECTION = `### 命令缓冲批处理 —— 更正与结论

上一轮我说过"纯填充批处理只在『同色 + 无描边 + **不重叠**』时严格成立"。
**这句话错了一半**，而且错的那一半正是让这个方向显得值得做的原因。

**更正 1：『不重叠』这个条件是多余的。** 只要填充**不透明**且同色，重叠与否都逐像素等价 ——
两次同色不透明填充，重叠处的颜色还是那个颜色；合成一条路径填一次，重叠处也还是那个颜色。
连抗锯齿边缘都等价，因为两者算的是同一个覆盖率：设两次覆盖率 α、β，
分开画得到 \`(α+β−αβ)·C + (1−α)(1−β)·bg\`，合并画得到同一个式子。
规则应当写作：**不透明 → 随便合并；alpha < 1 → 一律不合并**。

**更正 2（这条才致命）：合并路径并不减少绘制调用。** 每个子路径（\`rect\` / \`arc\` / \`ellipse\`）
**本身就是一次 canvas 调用**。把 9,100 个 \`fillRect\` 换成 9,100 个 \`rect\` + 1 个 \`fill\`，
调用数是 **9,101 而不是 1** —— 省掉的是"每笔各自走一趟光栅化"，不是调用次数。
而 \`render-check.mjs\` 记录、我一直在引用的那个指标，恰恰就是调用次数。

把规则套回三个候选：

| 候选 | 同色 | 无描边 | 能合并 | 调用数变化 | 结论 |
| --- | --- | --- | --- | --- | --- |
| 地面抖动（每波烘焙 4.5 万次 \`fillRect\`） | 是 | 是 | 是（不透明） | **9,100 → 9,101（没省）** | 放弃 |
| 豆豆斑点 \`D.dots\` | 是 | 是 | 是（不透明） | 18 → 8 次/帧 | 能做，但只值 ~2% |
| 贴花 3 个圆 | 是 | 是 | **否**（alpha 0.03~0.55） | — | 不能碰 |

要动"每波一次的 4.9 万次调用尖峰"，唯一真正的办法是**改画法**：要么降低抖动密度（视觉变化），
要么改用 \`createImageData\` / \`putImageData\` 把整块地面按像素写出来
（8.5MB 缓冲 + 210 万次 JS 迭代，多半是把 4.5 万次 canvas 调用换成 210 万次 JS 循环，不是净赚）。
两个都不划算，**保持现状**。

\`render-check.mjs\` 现在会把换波那一帧单独测出来并给出分层明细：它确实是全游戏最重的单帧
（约 4.9 万次调用，其中绝大多数是抖动），这是**已知且接受**的每波一次尖峰。
测试同时守住它的上下限 —— 上界 60000，有人在静态层里加重活就会红。

**三个候选的最终结论**：贴花烘焙层不做（透明度的"排名"语义让整层永远处于刚失效状态，
每次击杀都要整层重烤，只快 3 倍还多一块 4.3MB 画布）；纯填充批处理不做（省不了调用次数）；
豆豆斑点能做但只值 2%，为它引入一个有状态的批处理 API、外加"忘了 \`end\` 就静默画错"的陷阱，
不划算。**批处理这条线到此为止**，除非哪天换成 WebGL/离屏合成重写渲染层。

`;

patch('README.md', [
  ['## 实现要点', SECTION + '## 实现要点', 'README 批处理结论']
]);

console.log('已应用 ' + edits + ' 处改动');
if (misses.length) {
  console.log('\n\x1b[31m有 ' + misses.length + ' 处锚点未命中：\x1b[0m');
  for (const m of misses) console.log('  ' + m);
  process.exit(1);
}
console.log('\x1b[32m全部锚点命中 ✔\x1b[0m');
