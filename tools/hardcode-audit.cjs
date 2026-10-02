/* =========================================================
   hardcode-audit.cjs — **同一个概念被写了几遍**？
   ---------------------------------------------------------
   这个工具存在的理由，是"硬编码"这个词太宽 —— 一提到它，第一反应是去数
   "源码里出现了几个数字"，而那个数**毫无意义**：`sprites.ts` 里
   `6 / 8 / 12 / 16` 各出现几十次，因为它们是像素几何量，本来就在那里。
   数出来只会得到一份没人看的清单。

   真正有害的是另一件事：**同一个概念的值在两个以上的地方各写了一遍**。
   它不会报错，只会让它们慢慢漂开 —— 而漂开的表现是
   "同一个数值在工坊里显示 25%、在属性面板里显示 25.0%"、
   "回收率的缺省值在 game.ts 是 0.5、在 ui.ts 里写着 0.5"。

   所以这个工具只查三种**可判定**的形状：

     [A] 同一个算术表达式在同一文件里重复 >=3 次
         （该抽成具名常量 —— 改一处忘一处是最常见的一种漂）
     [B] 同一个"语义算式"（把数字换成 `#` 之后的形状）出现在 >=3 个
         玩法文件里（该进数据表；渲染层的几何量已排除）
     [C] 同一段"格式化配方"（如 `Math.round(x * 100) + '%'`）出现在
         >=2 个文件里（该走 `U.pct` 这类唯一实现）

   ⚠ 这是**体检**不是门：它输出给人读的清单，`--strict` 才在数量超过
   基线时返回非零。基线写在本文件里 —— 数字**只能变小**，
   变大时要在这里改基线并说明为什么。
   ========================================================= */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const STRICT = process.argv.indexOf('--strict') >= 0;

/* 最近一轮实测的基线（改小 = 好；改大要写理由）。
   剩下的 3 处各自是**正确**的、不该动的：
     · `audio.ts` 的 `0.34*j.peak` / `90*j.pitch` —— 三个音效的配方里
       恰好同值，而不是同一个概念被抄了三份（改其中一个不会让另两个变错）
     · `offline.ts` 的 `Offline.MAX_HOURS*60` —— 常量名已经在里面了，
       它读的就是离线表里那个唯一的封顶值
   "同一文件里同样的算式出现 >=3 次"能筛出真正的问题，但筛不干净 ——
   基线就是"已经人眼确认过、这些不是问题"的清单。 */
const BASELINE = { sameFile: 3, crossFile: 0, formatRecipe: 0 };

/* 渲染层排除：那里的数字是**几何**（像素、比例、形状），
   同一个数字出现几十次是正常的，把它算进"重复"只会淹没真正的信号。 */
const RENDER = /^(sprites|render|draw2d|art_[a-z]+)\.ts$/;

/* ⚠ **跨根**（E4 批次 1）：枚举走共享扫描器（搬家那天只扫 src/ 会**静默漏掉一半模块**）；
   读取用 abs —— 旧写法拿裸名拼回 src/，第二个根 / 子目录里会读不到。 */
const srcScan = require('./src-files.cjs');
const entries = srcScan.entries().filter(m => m.rel.endsWith('.ts') && m.rel !== 'types.d.ts');
const files = entries.map(m => m.base).sort();

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const srcOf = {};
for (const m of entries) srcOf[m.base] = strip(fs.readFileSync(m.abs, 'utf8'));
const lineOf = (src, i) => src.slice(0, i).split('\n').length;

/* ---- [A] 同一文件里重复 >=3 次的算术表达式 ---- */
function sameFile() {
  const out = [];
  for (const f of files) {
    if (RENDER.test(f)) continue;
    const src = srcOf[f];
    const hits = {};
    const add = (key, i) => (hits[key] = hits[key] || []).push(i);
    for (const m of src.matchAll(/(?<![\w.$])(\d+(?:\.\d+)?)\s*([*\/])\s*([A-Za-z_$][\w$.]*)/g)) add(m[1] + m[2] + m[3], m.index);
    for (const m of src.matchAll(/(?<![\w.$])([A-Za-z_$][\w$.]*)\s*([*\/])\s*(\d+(?:\.\d+)?)/g)) add(m[1] + m[2] + m[3], m.index);
    for (const [key, list] of Object.entries(hits)) {
      const lines = [...new Set(list.map(i => lineOf(src, i)))];
      /* 散在不同行才算"写了两遍"（同一行的 `a*2 + b*2` 是一次表达） */
      if (lines.length >= 3) out.push({ file: f, key, count: list.length, lines });
    }
  }
  return out.sort((a, b) => b.count - a.count);
}

/* ---- [B] 同一"语义算式"出现在 >=3 个玩法文件里 ---- */
function crossFile() {
  const span = {};
  for (const f of files) {
    if (RENDER.test(f)) continue;
    const seen = new Set();
    for (const m of srcOf[f].matchAll(/(?<![\w.$])\d+(?:\.\d+)?\s*([*\/])\s*([A-Za-z_$][\w$.]*)/g)) {
      /* 标识符太短（如 `t` / `y`）时形状没有信息量，跳过 */
      if (m[2].length < 3) continue;
      seen.add('# ' + m[1] + ' ' + m[2]);
    }
    for (const s of seen) (span[s] = span[s] || []).push(f);
  }
  return Object.entries(span).filter(([, l]) => l.length >= 3)
    .map(([key, l]) => ({ key, files: l })).sort((a, b) => b.files.length - a.files.length);
}

/* ---- [C] 同一段"格式化配方"出现在 >=2 个文件里 ---- */
const RECIPES = [
  { id: '百分比（round）', re: /Math\.round\([^)]*\*\s*100\)\s*\+\s*'%'/ },
  { id: '百分比（toFixed）', re: /\([^()]*\*\s*100\)\.toFixed\(/ },
  { id: '取两位小数', re: /Math\.round\([^)]*\*\s*100\)\s*\/\s*100/ }
  /* ⚠ 刻意**不**收 `[arr.length - 1]`：那是 JS 取末项的唯一写法，
     不是"同一个概念写了两遍" —— 收了它只会让这一节变成噪音，
     而"工具里有噪音"比"工具里少一条规则"更糟（没人会看它）。
     要收的判据是"这段配方**可以**被换成一处唯一的实现"，
     数组末项没有这样的替代品。 */
];
function formatRecipe() {
  const out = [];
  for (const r of RECIPES) {
    const where = files.filter(f => r.re.test(srcOf[f]));
    if (where.length >= 2) out.push({ id: r.id, files: where });
  }
  return out;
}

/* ---- 输出 ---- */
const A = sameFile(), B = crossFile(), C = formatRecipe();
console.log('\n=== Teapot · 硬编码体检（同一个概念写了几遍）===');
console.log('  排除渲染层 ' + files.filter(f => RENDER.test(f)).join(' / ') + '（那里的数字是几何）\n');

console.log('[A] 同一文件里重复 >=3 次的算术表达式：' + A.length + ' 处');
for (const h of A) console.log('    ' + h.file.padEnd(14) + h.key.padEnd(18) + '×' + h.count + '  行 ' + h.lines.join(','));
if (!A.length) console.log('    ✔ 无');

console.log('\n[B] 同一"语义算式"出现在 >=3 个玩法文件里：' + B.length + ' 处');
for (const h of B) console.log('    ' + h.key.padEnd(24) + h.files.join(' '));
if (!B.length) console.log('    ✔ 无');

console.log('\n[C] 同一段格式化配方出现在 >=2 个文件里：' + C.length + ' 处');
for (const h of C) console.log('    ' + h.id.padEnd(18) + h.files.join(' '));
if (!C.length) console.log('    ✔ 无');

const now = { sameFile: A.length, crossFile: B.length, formatRecipe: C.length };
const grew = Object.keys(now).filter(k => now[k] > BASELINE[k]);
console.log('\n=== 结果 ===');
console.log('  实测 A/B/C = ' + now.sameFile + '/' + now.crossFile + '/' + now.formatRecipe +
  ' · 基线 ' + BASELINE.sameFile + '/' + BASELINE.crossFile + '/' + BASELINE.formatRecipe);
if (grew.length) {
  console.log('  ' + (STRICT ? '✘' : '⚠') + ' 有类别比基线变多：' + grew.map(k => k + ' ' + BASELINE[k] + '→' + now[k]).join(' · '));
  console.log('    变多 = 又有一个概念被写了第二遍。要么抽出来，要么在 BASELINE 里写清为什么。');
  process.exit(STRICT ? 1 : 0);
}
console.log('  ✔ 没有比基线更差（基线只能变小）');
if (!STRICT) console.log('  （体检模式；`--strict` 才会在变差时返回非零）');
