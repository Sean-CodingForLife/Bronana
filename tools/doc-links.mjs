/* =========================================================
   doc-links.mjs — 门「**文档链接与索引**」
   ---------------------------------------------------------
   两条判据，各自的理由都是**实测过的**：

   **[1] 文档里指的路径必须真的存在。**
     文档指着一个不存在的文件 = **陈旧**（读的人会去找，然后找不到）。
     来源：boxer 的 DL007「仓库内链接必须解析到存在文件」、lychee 的 `--offline`。
     ⚠ **不查外链** —— 受限沙箱里 `pnpm verify` 连"管道捕获子进程输出"都会被拒，
       联网检查更不可靠（本仓库实测过 CI 因网络 DSN 失败而假红）。

   **[2] `docs/README.md` 的索引与盘上的文档必须对得上（两个方向）。**
     实测教训：**最要紧的一份文档曾经不在索引里** ——
     `docs/teapot-restructure.md`（战略重构 + E3 的完整入口）没人能从索引找到它，
     而**当时没有任何门在看这件事**（`doc-front` 只管 front matter 齐不齐）。
     方向二同样要紧：索引列了一份**已经不存在**的文档，说明索引在骗人。

   ## 判据的边界（说清楚，免得以为它在管更多）
     · 它只管 `.md` 里**写出来的链接**（`[..](path)` 与 front matter 的 `links:`）；
       正文里"顺口提到"的路径名**不查** —— 那种启发式太吵（第一版把纯文本里的
       `game.ts` 也当成路径，误报一片）。
     · `docs/history/**` 只要求出现在 **`docs/history/README.md`** 里（分卷索引），
       不要求进主索引。
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const JSON_OUT = process.argv.includes('--json');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'research', '.tmp-npm-cache']);
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') && e.name !== '.github') continue;
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}
const rel = p => path.relative(ROOT, p).split(path.sep).join('/');
const files = walk(ROOT).map(rel).sort();

/* 网址/锚点/邮件：不是仓库内路径 */
const isExternal = t => /^(https?:|mailto:|#)/i.test(t) || /^[a-z0-9.-]+\.(com|org|io|dev|net|ai|sh)\//i.test(t);

const problems = [];
const linkStats = { checked: 0, files: 0 };

/* ---------------- [1] 链接 ---------------- */
for (const f of files) {
  const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const targets = new Map();          // 目标 → 出现处（行号）
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/\]\(([^)\s]+)\)/g)) targets.set(m[1], i + 1);
  });
  /* front matter 的 `links:` —— 它是"这份文档依赖谁"的声明，尤其要准 */
  const fm = lines.slice(0, lines.indexOf('---', 1)).join('\n');
  const lm = /^links:\s*\[(.*)\]\s*$/m.exec(fm);
  if (lm) {
    for (const raw of lm[1].split(',')) {
      const t = raw.trim().replace(/^["']|["']$/g, '');
      if (t) targets.set(t, 1);
    }
  }
  let n = 0;
  for (const [t, ln] of targets) {
    let clean = t.split('#')[0].split('?')[0].trim();
    if (!clean || isExternal(t)) continue;
    n++; linkStats.checked++;
    /* 两种解析都试：相对**本文档**（`../README.md`）与相对**仓库根**（`tools/x.mjs`）。
       只试一种会把对的判成缺的 —— 第一版就栽在这。 */
    const fromDoc = path.resolve(path.dirname(path.join(ROOT, f)), clean);
    const fromRoot = path.join(ROOT, clean);
    if (!fs.existsSync(fromDoc) && !fs.existsSync(fromRoot)) {
      problems.push(f + ':' + ln + ' 链接指向不存在的文件：`' + t + '`');
    }
  }
  if (n) linkStats.files++;
}

/* ---------------- [2] 索引 ↔ 盘上（两个方向） ---------------- */
const mentions = (indexFile, target) => {
  const p = path.join(ROOT, indexFile);
  if (!fs.existsSync(p)) return false;
  return fs.readFileSync(p, 'utf8').includes(target);
};

const MAIN = 'docs/README.md';
const docsTop = files.filter(f => /^docs\/[^/]+\.md$/.test(f) && f !== MAIN);
for (const f of docsTop) {
  const base = f.slice('docs/'.length);
  if (!mentions(MAIN, base)) {
    problems.push(f + ' **不在索引里** —— ' + MAIN + ' 必须能让人找到它（孤儿文档 = 找不到 = 等于没有）');
  }
}
/* 方向二：索引里写了的 `.md` 都要真的在 */
const idxText = fs.existsSync(path.join(ROOT, MAIN)) ? fs.readFileSync(path.join(ROOT, MAIN), 'utf8') : '';
for (const m of idxText.matchAll(/\]\(([^)\s]+\.md)\)/g)) {
  const t = m[1];
  if (isExternal(t)) continue;
  const fromIdx = path.resolve(path.join(ROOT, 'docs'), t);
  const fromRoot = path.join(ROOT, t);
  if (!fs.existsSync(fromIdx) && !fs.existsSync(fromRoot)) {
    problems.push(MAIN + ' 的索引列了一份**不存在**的文档：`' + t + '`');
  }
}
/* docs/history 分卷：必须各自出现在分卷索引里 */
const HIST = 'docs/history/README.md';
for (const f of files.filter(f => /^docs\/history\/[^/]+\.md$/.test(f) && f !== HIST)) {
  const base = f.slice('docs/history/'.length);
  if (!mentions(HIST, base)) problems.push(f + ' **不在分卷索引里**（' + HIST + '）');
}

const result = {
  docs: files.length, linksChecked: linkStats.checked, linkFiles: linkStats.files,
  problems
};
if (JSON_OUT) { console.log(JSON.stringify(result)); process.exit(problems.length ? 1 : 0); }

console.log('\n=== Teapot · 文档链接与索引门 ===\n');
console.log('  .md 共 ' + files.length + ' 份 · 查了 ' + linkStats.checked + ' 条仓库内链接（' +
  linkStats.files + ' 份文档里有链接）');
console.log('  判据：[1] 链接指向的文件必须存在 · [2] docs 索引与盘上**两个方向**都对得上');
console.log('  ⚠ 不查外链（受限沙箱里联网检查会因 DNS 假红 —— 本仓库实测过）\n');

if (!problems.length) {
  console.log('  ✔ 所有仓库内链接都能解析到存在的文件');
  console.log('  ✔ 索引与盘上一致（没有孤儿文档，也没有指向空处的索引项）\n');
  process.exit(0);
}
console.log('  ✘ ' + problems.length + ' 处：\n');
for (const p of problems) console.log('    · ' + p);
console.log('\n  ⚠ 处置：**修链接，或者把文档加进索引** —— 不许把索引之外的文档留在盘上。\n');
process.exit(1);
