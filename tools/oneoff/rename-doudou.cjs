/* =========================================================
   rename-doudou.cjs — 中文里的「土豆」改为「豆豆」
   用法： node tools/rename-doudou.cjs [--dry]     （必须在 rename-bronana.cjs 之后跑）

   背景：rename-bronana.cjs 把中文的「土豆」也一起翻成了 Bronana，
   于是出现「Bronana形轮廓 / Bronana坑 / Bronana斑点 / 全能Bronana」这种别扭说法。
   这里只修中文语境的 30 处：把"指代那个角色/形状"的 Bronana 改回中文昵称「豆豆」。

   刻意不动：
     · 品牌与标识符（`# Bronana`、Logo、`bronana.ts`、`Bronana.PAINT`、测试横幅）
       —— 那些来自 土豆兄弟 / potato / spud，是要统一的英文名；
     · 随机种子字符串 'bronana' + seed（改了会让角色斑点重新随机一次）。

   替换用"带中文语境的整词"（Bronana角色 / Bronana坑 / Bronana形 …），
   而不是把裸的 Bronana 全换掉 —— 后者会把品牌名一起换掉。
   ========================================================= */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SELF = path.basename(__filename);
const DRY = process.argv.indexOf('--dry') >= 0;
const EXT = new Set(['.ts', '.mjs', '.cjs', '.js', '.md', '.json', '.html', '.css', '.txt']);
const SKIP_DIR = /(^|\\)(node_modules|\.npm-cache|dist|\.git|shots)(\\|$)/;
const SKIP_FILE = new Set(['test-run.txt', 'tsc-report.txt', SELF, 'rename-bronana.cjs']);

/* 只匹配"Bronana + 中文"或"中文 + Bronana"的既有说法 */
const RULES = [
  ['Bronana角色', '豆豆角色'],
  ['全能Bronana', '全能豆豆'],
  ['Bronana的骨架定义', '豆豆的骨架定义'],
  ['Bronana转交', '豆豆转交'],
  ['Bronana这个骨架', '豆豆这个骨架'],
  ['Bronana骨架', '豆豆骨架'],
  ['Bronana坑', '豆豆坑'],
  ['Bronana形', '豆豆形'],
  ['同一个Bronana', '同一个豆豆'],
  ['角色卡上的Bronana', '角色卡上的豆豆'],
  ['Bronana斑点', '豆豆斑点'],
  ['Bronana职业', '豆豆职业'],
  ['Bronana坐地感', '豆豆坐地感'],
  ['Bronana与怪物', '豆豆与怪物'],
  ['Bronana肖像', '豆豆肖像'],
  ['与Bronana同源', '与豆豆同源'],
  ['Bronana的骨头', '豆豆的骨头'],
  ['Bronana本体', '豆豆本体']
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

let changed = 0, total = 0;
const per = {};
for (const [from] of RULES) per[from] = 0;

for (const f of walk(ROOT, [])) {
  const src = fs.readFileSync(f, 'utf8');
  let out = src;
  for (const [from, to] of RULES) {
    if (out.indexOf(from) < 0) continue;
    const n = out.split(from).length - 1;
    per[from] += n; total += n;
    out = out.split(from).join(to);
  }
  if (out !== src) {
    changed++;
    if (!DRY) fs.writeFileSync(f, out);
    console.log((DRY ? '[dry] ' : '') + '改写 ' + path.relative(ROOT, f));
  }
}

console.log('\n改动文件 ' + changed + ' 个，替换 ' + total + ' 处');
for (const [from] of RULES) if (per[from]) console.log('  ' + from + ' → 豆豆 : ' + per[from]);
