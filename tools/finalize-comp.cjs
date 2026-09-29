/* =========================================================
   finalize-comp.cjs — 收尾
     1) comp.mjs 里一句已经过时的注释（说的还是"逐字段拷贝"）
     2) ui-check 的模块图检查补上 comp.ts 的分层约束
     3) README 增补"组件式组合"一节
   用法： node tools/finalize-comp.cjs
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

/* ---------------- 1. 过时注释 ---------------- */
patch('test/comp.mjs', [
  [`  console.log('    注：子弹/粒子这类每帧大量创建的对象，热路径用 Comp.spawn(原型) 单次分配，');
  console.log('        不做 overrides 合并；比手写字面量多的是"逐字段从模板拷贝"。');`,
    `  console.log('    注：spawn 走的是按原型"代码生成"出来的构造函数（一次字面量构造），');
  console.log('        不是逐字段拷贝 —— 第一版逐字段拷贝实测是 47×，代码生成后回落到 6× 上下。');`,
    '过时注释']
]);

/* ---------------- 2. 模块图补 comp.ts ---------------- */
patch('test/ui-check.mjs', [
  [`  ['utils.ts', modFiles.filter(f => f !== 'utils.ts'), '工具层不依赖任何模块']
];`,
    `  ['utils.ts', modFiles.filter(f => f !== 'utils.ts'), '工具层不依赖任何模块'],
  ['comp.ts', modFiles.filter(f => f !== 'comp.ts' && f !== 'utils.ts'),
    '组件层是纯声明与组合，只依赖 utils']
];`, 'comp.ts 分层规则']
]);

/* ---------------- 3. README ---------------- */
const README_SECTION = `### 组件式组合：所有对象都由组件拼出来

改造前每种对象都是手写对象字面量，而且存在"用到才挂上去"的字段：

| 症状 | 后果 |
| --- | --- |
| \`w.dup\` 只在一局里有多把同名武器时才赋值；\`e._spr\` / \`e._fl\` 首次绘制才挂上 | 同类型的对象在运行期长出不同形状（V8 隐藏类分叉），属性访问退化到慢路径 |
| \`addStain\` 先 \`d = {}\` 再逐个赋值 | 同上 |
| 字段齐不齐只能靠人读代码 | \`weapon\` 少写一个 \`cd\`，要等跑到 \`checkWeapon\` 才炸 |

现在所有游戏对象都是 \`Comp.archetype(原型, [组件...])\` 组合出来的：

\`\`\`js
Comp.define('Cooldown', { cd: 0 });
Comp.archetype('weapon', ['WeaponCore', 'Cooldown', 'Seat'], { list: 'weapons' });
const w = Comp.spawn('weapon', { id: 'sword', def: def });
\`\`\`

- **34 个组件 / 11 个原型**：player、enemy、bullet、ebullet、particle、pickup、decal、turret、weapon、item、offer。
- 造出来的对象**字段齐全、形状一致**；数组默认值按对象复制，不会两个对象共用一个数组。
- \`Comp.assign\` 写一个原型没声明的字段**直接抛错** —— 这是"漏声明组件"的主要入口。
- \`Comp.query(sess, 'enemy')\` 取集合，\`Comp.run('particleStep', list, dt)\` 跑系统；
  系统声明自己需要哪些组件，首次运行时校验集合里的原型确实具备（\`particleStep\` 声明 \`Lifetime + Motion\`）。
- \`Comp.audit(obj)\` 找游离字段。\`test/comp.mjs\` 会打一场真实对局，把场上**每一个对象**都审一遍：
  原型正确、无游离字段、无缺字段、同类对象形状一致。

实测（都是量出来的，不是估计）：

| 指标 | 改造前 | 改造后 |
| --- | --- | --- |
| 真实波次截尾均值 | 0.172ms/步 | 0.175ms/步（噪声内） |
| 300 怪压力场景截尾均值 | 0.637ms/步 | 0.643ms/步（噪声内） |
| \`Comp.spawn('bullet')\` vs 手写字面量 | — | 213ns vs 35ns（**6.1×**） |

最后一行值得展开：第一版 \`spawn\` 是"逐字段从模板拷贝"，实测慢 **47 倍** ——
模板是运行期逐个加属性建起来的字典模式对象，每次 spawn 都在做哈希查找。
改成**按原型代码生成构造函数**（拿到字面量形状的对象）后回落到 6×。
这个坑是 \`test/comp.mjs\` 里的开销断言抓出来的，不是我先验就知道的。

刻意**没有**做成原型的：升级词条（直接引用 \`UPGRADE_POOL\` 里的共享定义）、刷怪表
（\`Enemies.buildWave\` 的产物）、事件载荷与 \`RunSummary\`。它们是共享定义 / 每波一次的记录 /
跨层数据包，不是每帧实体；把它们克隆成组合对象只会改变共享语义，没有收益。这条边界也写在测试输出里。

`;

patch('README.md', [
  ['### 关键架构决策：模拟层与渲染层严格分离', README_SECTION + '### 关键架构决策：模拟层与渲染层严格分离', 'README 组件一节']
]);

console.log('已应用 ' + edits + ' 处改动');
if (misses.length) {
  console.log('\n\x1b[31m有 ' + misses.length + ' 处锚点未命中：\x1b[0m');
  for (const m of misses) console.log('  ' + m);
  process.exit(1);
}
console.log('\x1b[32m全部锚点命中 ✔\x1b[0m');
