/* =========================================================
   rename-bronana.cjs — 把项目里"土豆 / potato / spud / brotato"统一改名为 Bronana
   用法： node tools/rename-bronana.cjs [--dry]

   做两件事：
     1) 少量"显式替换"：盲替换会让几处品牌文案变成重复词
        （例如标题会成为 "Bronana · BRONANA-LIKE"），这些逐条写清楚。
     2) 机械替换：土豆兄弟 → Bronana、土豆 → Bronana、
        potato/Potato/POTATO → bronana/Bronana/BRONANA、
        spud/Spud/SPUD → bronana/Bronana/BRONANA（含文件名 potato.ts → bronana.ts）。

   刻意不处理的目录：node_modules / .npm-cache / dist（重新构建即可）、
   test-run.txt（测试输出，会被覆盖）、以及本脚本自身。
   ========================================================= */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SELF = path.basename(__filename);
const DRY = process.argv.indexOf('--dry') >= 0;
const EXT = new Set(['.ts', '.mjs', '.cjs', '.js', '.md', '.json', '.html', '.css', '.txt']);
const SKIP_DIR = /(^|\\)(node_modules|\.npm-cache|dist|\.git|shots)(\\|$)/;
const SKIP_FILE = new Set(['test-run.txt', 'tsc-report.txt', SELF]);

/* ---- 1. 显式替换：先做，避免盲替换造出重复词 ---- */
const EXPLICIT = [
  ['# 土豆兄弟 · BRONANA-LIKE', '# Bronana'],
  ['<title>土豆兄弟 · BRONANA 风格 Roguelite</title>', '<title>Bronana · Roguelite Survivor</title>'],
  /* 副题现在只画在 `#title-logo` 那张画布里（`sprites.ts` 的 `S.EMBLEMS`），
     DOM 里不再有 `.logo-sub` —— 所以这一条替换目标不存在了，留着只会让人以为还在。 */
  ['"description": "《Bronana 土豆兄弟》风格的纯 Canvas 独立肉鸽游戏 —— ',
    '"description": "Bronana · 纯 Canvas 独立肉鸽游戏 —— '],
  ['写成的《Bronana 土豆兄弟》风格独立肉鸽游戏。', '写成的独立肉鸽游戏（Bronana）。']
];

/* ---- 2. 机械替换（顺序：先长后短，避免"土豆兄弟"被"土豆"先吃掉）---- */
const TOKENS = [
  ['土豆兄弟', 'Bronana'],
  ['土豆', 'Bronana'],
  ['potato', 'bronana'],
  ['Potato', 'Bronana'],
  ['POTATO', 'BRONANA'],
  ['spud', 'bronana'],
  ['Spud', 'Bronana'],
  ['SPUD', 'BRONANA']
];

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (SKIP_DIR.test(p)) continue;
    if (e.isDirectory()) walk(p, out);
    else if (EXT.has(path.extname(e.name).toLowerCase()) && !SKIP_FILE.has(e.name)) out.push(p);
  }
  return out;
}

const files = walk(ROOT, []);
let changed = 0, total = 0;
const perToken = {};
for (const t of TOKENS) perToken[t[0]] = 0;
let explicitHits = 0;

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  let out = src;
  for (const [from, to] of EXPLICIT) {
    if (out.indexOf(from) < 0) continue;
    const n = out.split(from).length - 1;
    explicitHits += n;
    out = out.split(from).join(to);
  }
  for (const [from, to] of TOKENS) {
    if (out.indexOf(from) < 0) continue;
    const n = out.split(from).length - 1;
    perToken[from] += n;
    total += n;
    out = out.split(from).join(to);
  }
  if (out !== src) {
    changed++;
    if (!DRY) fs.writeFileSync(f, out);
    console.log((DRY ? '[dry] ' : '') + '改写 ' + path.relative(ROOT, f));
  }
}

/* ---- 3. 文件改名 ---- */
const oldFile = path.join(ROOT, 'src', 'potato.ts');
const newFile = path.join(ROOT, 'src', 'bronana.ts');
if (fs.existsSync(oldFile)) {
  if (!DRY) fs.renameSync(oldFile, newFile);
  console.log((DRY ? '[dry] ' : '') + '改名 src/potato.ts → src/bronana.ts');
} else {
  console.log('（src/potato.ts 不存在，跳过改名）');
}

console.log('\n改动文件 ' + changed + ' 个，机械替换 ' + total + ' 处，显式替换 ' + explicitHits + ' 处');
for (const t of TOKENS) if (perToken[t[0]]) console.log('  ' + t[0] + ' → ' + t[1] + ' : ' + perToken[t[0]]);
