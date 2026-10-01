/* =========================================================
   text-census.mjs — **文字面普查**（R49 阶段 4 的第一步）
   ---------------------------------------------------------
   为什么要有它（这是 R49 决定文档写明的**前置条件**）：

   文本渲染是 Canvas2D→WebGL2 里**最大的技术风险** —— `fillText` 自带
   **字体整形 / 字距 / 换行 / emoji / CJK 排版**，而 GPU **没有文字原语**。
   所以要迁 GL，**必须先知道要烘多少字形**：烘字形图集的第一步就是
   "本作一共用到哪些字符、哪些字号"。

   这一份是**引擎能力**（不是内容）：任何 2D 引擎做文字后端都要能回答它。
   输出给两个消费者：
     · **字集**：字形图集要烘的字符集合（去重、可枚举）
     · **字号档**：要烘几档（每档一套字形）

   ⚠ 判据：宁可多报（把 UI 文案也算进来），**不要漏** ——
   漏一个字符就是运行时烘不出来、显示豆腐块。
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');
const JSON_OUT = process.argv.includes('--json');

/* ---------------- 扫源码：字符串字面量里的"人读得懂的字" ---------------- */
/* 只收 CJK / 全角标点 / ASCII 可见字符。**不收** emoji —— 若有，单独报出来
   （emoji 要走位图而不是字形图集，是另一条路）。 */
const CJK = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;
const EMOJI = /[\u{1f300}-\u{1f9ff}\u{2600}-\u{27bf}]/u;

/* 字符串字面量：单/双引号 + 模板串。**排除注释**（注释里的中文不是玩家看到的） */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')      // 块注释
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // 行注释（`://` 不误伤）
}

const chars = new Map();      // 字符 → 出现次数
const emojis = new Map();     // emoji → 出现次数
const files = fs.readdirSync(SRC).filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'));

for (const f of files) {
  const src = stripComments(fs.readFileSync(path.join(SRC, f), 'utf8'));
  for (const m of src.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"|`([^`\\]*)`/g)) {
    const s = m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3]);
    if (!s) continue;
    for (const ch of s) {
      if (EMOJI.test(ch)) { emojis.set(ch, (emojis.get(ch) || 0) + 1); continue; }
      if (CJK.test(ch) || (ch >= '!' && ch <= '~')) {
        chars.set(ch, (chars.get(ch) || 0) + 1);
      }
    }
  }
}

/* ---------------- 字号档：`D.text(...)` 的 size 实参 ---------------- */
const sizes = new Map();
for (const f of files) {
  const src = stripComments(fs.readFileSync(path.join(SRC, f), 'utf8'));
  /* 形状：D.text(目标, 串, x, y, <size>, ...) —— 只认字面量数字 */
  for (const m of src.matchAll(/D\.text\([^,]+,[^,]+,[^,]+,[^,]+,\s*(\d+(?:\.\d+)?)\s*,/g)) {
    const v = Number(m[1]);
    sizes.set(v, (sizes.get(v) || 0) + 1);
  }
  /* 描边文字的另一个出口：o.font 那类（`ui.ts` / `render.ts` 里的字号） */
  for (const m of src.matchAll(/font\s*:\s*(?:'\d+\s+|"?)?(\d+(?:\.\d+)?)px/g)) {
    const v = Number(m[1]);
    sizes.set(v, (sizes.get(v) || 0) + 1);
  }
}

const sorted = [...chars.keys()].sort();
const cjkChars = sorted.filter(c => CJK.test(c));
const asciiChars = sorted.filter(c => !CJK.test(c));

const result = {
  total: sorted.length,
  cjk: cjkChars.length,
  ascii: asciiChars.length,
  emoji: emojis.size,
  sizes: [...sizes.entries()].sort((a, b) => a[0] - b[0]).map(([px, n]) => ({ px, n })),
  chars: sorted.join(''),
  emojiList: [...emojis.keys()]
};

if (JSON_OUT) { console.log(JSON.stringify(result)); process.exit(0); }

console.log('\n=== Bronana · 文字面普查（R49 阶段 4 的前置数据）===\n');
console.log('  扫了 ' + files.length + ' 个模块的**字符串字面量**（注释不算 —— 注释里的中文不显示给玩家）');
console.log('\n  【字符集】一共 ' + result.total + ' 个不同字符');
console.log('    · 中日韩 + 全角标点：**' + result.cjk + '** 个');
console.log('    · ASCII 可见字符：  **' + result.ascii + '** 个');
console.log('    · emoji：           ' + result.emoji + ' 个' + (result.emoji ? '（**要走位图，不是字形图集**）' : ''));

console.log('\n  【字号档】' + result.sizes.length + ' 档：');
for (const s of result.sizes) console.log('    ' + String(s.px).padStart(5) + 'px  ×' + s.n);
if (!result.sizes.length) console.log('    （一个都没扫到 —— 检查 D.text 的实参形状）');

console.log('\n  【字形图集的规模推算】');
console.log('    一个字档一套图 ⇒ ' + result.total + ' 字符 × ' + Math.max(1, result.sizes.length) +
  ' 档 = **' + (result.total * Math.max(1, result.sizes.length)) + ' 个字形**');
console.log('    （这就是"迁 GL 要先知道的事" —— 可直接喂给阶段 4 的烘焙器）');

if (result.emoji) {
  console.log('\n  【emoji 清单】' + result.emojiList.join(' '));
}
console.log('\n  前 80 个字符：' + sorted.slice(0, 80).join(''));
