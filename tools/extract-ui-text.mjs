/* =========================================================
   extract-ui-text.mjs — 从 HTML + 源码里**抽出**要翻译的文案
   ---------------------------------------------------------
   为什么要有这个工具（而不是手抄一份文案表）：
   手抄的文案表**一定会漂** —— 改了界面文案，表里还是旧的；
   而"表里有、界面没有"的键比缺键更坏（它会让人以为那句已经在界面上）。

   这里反过来做：**界面是唯一真相**，表是它的产物。
     · HTML：抽出可见文本节点（跳过 <canvas>/<script>/注释）
     · 源码：抽出 `U.el('div','cls','文案')` / `setText('key', node, '文案')`
       这类**明显的字面量文案**（只收含中文的，避免把 id/类名也收进来）
   输出一份 `{ "中文原文": { "en": "", "note": "" } }` 的骨架，
   交给 `src/i18n.ts` 当键用（zh 就是键本身，en 留空 → 回退到中文）。

   用法：
     node tools/extract-ui-text.mjs            # 打印清单
     node tools/extract-ui-text.mjs --json     # 打成 JSON（给 i18n 表用）
     node tools/extract-ui-text.mjs --check    # 校对 i18n 表：报"表中孤儿"（真缺陷，非 0 退出）
                                               #   和"待翻译存量"（工作清单，只报数）

   ⚠ `--check` 的第一版把"没翻译"报成了"缺键"（2692 条），是错的：
   键就是中文原文、默认语言故意没有表，所以对默认语言而言一切天然全覆盖。
   详见下面 `--check` 那一段的注释。
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const HAS_CJK = /[\u4e00-\u9fff]/;
const JSON_OUT = process.argv.includes('--json');
const CHECK = process.argv.includes('--check');

/* ---------------- 1. HTML 可见文本 ---------------- */
function fromHtml() {
  const raw = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  /* 去掉注释、script、canvas（画布里的字是画出来的，不进文案表） */
  const body = raw
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<canvas[\s\S]*?<\/canvas>/gi, '')
    .replace(/<canvas[^>]*>/gi, '');
  const out = [];
  /* 只取"元素里只有文字"的那种 leaf：`<tag ...>文本</tag>`，文本里不含 `<`。
     这条限制是刻意的：`<div><span>x</span> 句尾</div>` 的混合结构
     用正则拆不安全，而那几种在 index.html 里是少数（下面 report 会报出来）。 */
  const re = /<([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>([^<>]+)<\/\1>/g;
  let m;
  while ((m = re.exec(body))) {
    const tag = m[1].toLowerCase();
    if (tag === 'style' || tag === 'title') continue;
    const text = m[3].replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text || !HAS_CJK.test(text)) continue;
    out.push(text);
  }
  return out;
}

/* ---------------- 2. 源码里的字面量文案 ---------------- */
function fromSrc() {
  const dir = path.join(ROOT, 'src');
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.ts') || f === 'types.d.ts') continue;
    let s = fs.readFileSync(path.join(dir, f), 'utf8');
    s = s.replace(/\/\*[\s\S]*?\*\//g, '');           // 块注释不算文案
    const lines = s.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*(\/\/|\*)/.test(line)) continue;        // 行注释不算
      /* `U.el(...,'...')` 的第三参、`setText(...,'...')` 这类字面量。
         ⚠ 这里原来有个 `{1,40}` 的字数上限，理由是"只收短串，免得把长句也收进来"。
         那条限制是错的，而且**报出的错更难发现**：教程里那句
         `血量过半了 —— 血到 0 就是这一局结束，但打到的材料会带出局（那是经营的本钱）`
         是 41 个字，于是它抽不到自己，`--check` 反过来把 i18n 表里**正确的**键
         报成"表中孤儿"。上限删掉 —— 单引号已经天然隔离了边界
         （`[^'\\]` 不跨引号），长度不是安全属性。 */
      const re = /'((?:[^'\\]|\\.)*)'/g;
      let m;
      while ((m = re.exec(line))) {
        const t = m[1];
        if (!HAS_CJK.test(t)) continue;
        out.push({ text: t, file: f, line: i + 1 });
      }
    }
  }
  /* 去重：同一句文案在多处出现只报一次，但留下第一条位置（便于去改） */
  const seen = new Map();
  for (const o of out) if (!seen.has(o.text)) seen.set(o.text, o);
  return [...seen.values()];
}

const htmlTexts = fromHtml();
const srcTexts = fromSrc();

/* ---------------- 3. 已有的 i18n 表（--check 用） ---------------- */
let tableKeys = null;
try {
  const t = fs.readFileSync(path.join(ROOT, 'src', 'i18n.ts'), 'utf8');
  const i = t.indexOf('var MESSAGES');
  if (i >= 0) {
    tableKeys = new Set([...t.slice(i).matchAll(/^\s{2}'((?:[^'\\]|\\.)*)'\s*:/gm)].map(m => m[1]));
  }
} catch (e) { /* 还没有 i18n.ts 就是 null */ }

if (CHECK) {
  /* ---------------- 口径要对齐应用，别自己发明 ----------------
     ⚠ 这一节原来报的是"界面里有、`MESSAGES.en` 里没有"→ **2692 条**。
     那个数字是假的，而且假得很有害：它把"没翻译"说成了"缺键"。
     本项目的设计是 **键 = 中文原文，默认语言（zh）故意没有表**
     （`src/i18n.ts` 顶部注释），所以对默认语言**不存在"缺键"这个概念** ——
     界面上的字天然就是自己的译文。`I18n.missingKeys('zh')` 正是因此明确返回 `[]`。

     于是这里把两件事分开，各自有自己的名字：
       · **待翻译存量**（只报数，不是缺陷）：界面/源码里的中文有 N 条，
         其中 M 条 `MESSAGES.en` 里已有译文 → 剩下 N−M 条是还没翻的。
         它是**工作清单**，清到 0 才叫翻译完成，但没清完不是 bug。
       · **表中孤儿**（这是真缺陷，非 0 才失败）：`MESSAGES.en` 里的键在界面和
         源码里**都不存在**。改文案时漏改表就会留下它，而它比缺键更坏 ——
         它会让人以为"那句已经翻译过了"。 */
  const presented = new Map();                  // 文案 → 出处
  for (const t of htmlTexts) presented.set(t, 'index.html');
  for (const o of srcTexts) if (!presented.has(o.text)) presented.set(o.text, o.file + ':' + o.line);

  const orphans = tableKeys ? [...tableKeys].filter(k => !presented.has(k)) : [];
  const translated = tableKeys ? [...presented.keys()].filter(k => tableKeys.has(k)).length : 0;
  const untranslated = presented.size - translated;

  console.log('\n=== i18n 校对（键 = 中文原文；默认语言故意没有表）===\n');
  if (!tableKeys) {
    console.log('  还没有 src/i18n.ts —— 界面文案一共 ' + presented.size + ' 条带中文的字面量');
    console.log('  （HTML ' + htmlTexts.length + ' 条 · 源码 ' + srcTexts.length + ' 条）\n');
  } else {
    console.log('  界面与源码里带中文的文案：' + presented.size + ' 条');
    console.log('  `MESSAGES.en` 里的键      ：' + tableKeys.size + ' 条');
    console.log('  ├─ 其中已对上界面/源码    ：' + translated + ' 条');
    console.log('  └─ 表中孤儿（真缺陷）      ：\x1b[' + (orphans.length ? '31' : '32') + 'm' + orphans.length + '\x1b[0m 条');
    console.log('  待翻译存量（工作清单，不是缺陷）：\x1b[33m' + untranslated + '\x1b[0m 条' +
      '（占 ' + (presented.size ? Math.round(untranslated / presented.size * 100) : 0) + '%）');
    if (orphans.length) {
      console.log('\n  表中孤儿 —— 改了文案却漏改 i18n 表，删掉或改成新文案：');
      for (const k of orphans.slice(0, 20)) console.log('    \x1b[31m✘\x1b[0m ' + JSON.stringify(k));
      if (orphans.length > 20) console.log('    …（共 ' + orphans.length + ' 条）');
    }
  }
  console.log('');
  /* 只有"表中孤儿"才让门变红：它是确凿的不一致，不是待办。 */
  process.exit(orphans.length ? 1 : 0);
}

if (JSON_OUT) {
  const obj = Object.create(null);
  for (const t of htmlTexts) obj[t] = { en: '', src: 'index.html' };
  for (const o of srcTexts) if (!obj[o.text]) obj[o.text] = { en: '', src: o.file + ':' + o.line };
  console.log(JSON.stringify(obj, null, 1));
  process.exit(0);
}

console.log('\n=== 界面文案抽取（界面是唯一真相，表是它的产物）===\n');
console.log('  HTML 可见文本（含中文）：' + htmlTexts.length + ' 条');
console.log('  源码里的中文字面量（去重）：' + srcTexts.length + ' 条');
console.log('');
console.log('  ── HTML（前 40 条）──');
for (const t of htmlTexts.slice(0, 40)) console.log('    ' + t);
console.log('');
console.log('  ── 源码（前 40 条，带位置）──');
for (const o of srcTexts.slice(0, 40)) console.log('    ' + o.text + '   ← ' + o.file + ':' + o.line);
console.log('');
console.log('  用 --json 出表骨架；用 --check 报"界面里有、表里没有"的键。\n');
