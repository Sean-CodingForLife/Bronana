/* =========================================================
   tools/rename-inventory.mjs — **改名清单**（Teapot 重构的第 0 步）
   ---------------------------------------------------------
   用户决定：引擎定名 **Teapot**，而 **Bronana 只指游戏内容**；两者前缀**严格分开**，
   且要有一条"**内容名不许出现在引擎代码里**"的机器判据。

   所以第一件事不是改，是**量清楚要改哪些、以及每一处属于哪一类**。
   分类判据（照本仓库的家法：**一条判据只能有一个理由**）：

     · **engine-code**   引擎模块里的标识符 ⇒ **必须改**（这是"耦合"的定义）
     · **engine-infra**  引擎的基础设施（包名 / 入口 / 配置 / 构建）⇒ **必须改**
     · **content**       内容侧的标识符（存档键 / CSS 类 / 测试名…）⇒ **保留**（它就叫这个名字）
     · **history**       `CHANGELOG.md` / `docs/history/` 里的历史叙述
                         ⇒ **不许改**（家法：篡改历史比漂移更坏）
     · **prose**         文档正文里的"Bronana"当**项目名**用时 ⇒ **要改**（现在它指引擎，
                         而定位变了）；但当**游戏名**用时 ⇒ **保留**，由人工判
     · **external**      外部取证里引用的名字（`docs/techstack-*` 的调研）
                         ⇒ **保留**（那是当时的事实）

   ⚠ 这个工具**只报告、不改**。改由 `tools/dev-edit.mjs` 或 `edit` 工具做，
     而且每一步都要过门（家法：改完跑 `pnpm verify`）。

   用法：node tools/rename-inventory.mjs [--json]
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const JSON_OUT = process.argv.includes('--json');

/* ---------------- 引擎模块清单：**唯一出处**是那个门 ---------------- */
/* 直接从 `tools/engine-boundary.mjs` 的源码里取三张表（ENGINE / ENGINE_MIXED / CONTENT），
   而不是自己再列一份 —— 否则"引擎有哪些模块"就有两份真相。 */
const boundarySrc = fs.readFileSync(path.join(ROOT, 'tools', 'engine-boundary.mjs'), 'utf8');
function tableOf(name) {
  const m = boundarySrc.match(new RegExp('const ' + name + ' = \\{([\\s\\S]*?)\\n\\};'));
  if (!m) return [];
  const out = [];
  for (const k of m[1].matchAll(/^\s*'([^']+\.ts)':/gm)) out.push(k[1]);
  return out;
}
const ENGINE = tableOf('ENGINE');
const MIXED = tableOf('ENGINE_MIXED');
const CONTENT = tableOf('CONTENT');
const DATA = tableOf('DATA_TABLES');
const engineSet = new Set([...ENGINE, ...MIXED]);

/* ---------------- 走盘（跳过外部与产物） ---------------- */
const SKIP = /(^|[\\/])(node_modules|\.git|dist|\.pnpm-store|research|ui-shots|\.agents)([\\/]|$)/;
const EXT = new Set(['.ts', '.mjs', '.cjs', '.json', '.md', '.yml', '.yaml', '.html', '.css', '.txt']);
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (SKIP.test(p)) continue;
    if (e.isDirectory()) walk(p, out);
    else if (EXT.has(path.extname(e.name))) out.push(p);
  }
  return out;
}

/* ---------------- 分类 ---------------- */
const WORD = /Bronana|bronana/g;
const rows = [];
for (const p of walk(ROOT)) {
  const rel = path.relative(ROOT, p).split(path.sep).join('/');
  const text = fs.readFileSync(p, 'utf8');
  const lines = text.split('\n');
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!WORD.test(line)) continue;
    WORD.lastIndex = 0;
    count++;
    /* 只看**非注释**的实质使用来判断类别；注释按所在文件的类别走 */
    const isComment = /^\s*(\/\/|\*|\/\*)/.test(line);
    let kind;
    const base = path.basename(rel);
    if (/^docs\/history\//.test(rel) || base === 'CHANGELOG.md') kind = 'history';
    else if (/^docs\/techstack-/.test(rel)) kind = 'external';
    else if (/^src\//.test(rel)) {
      const mod = path.basename(rel);
      kind = engineSet.has(mod) ? 'engine-code' : 'content';
      if (isComment) kind = engineSet.has(mod) ? 'engine-code' : 'content';
    } else if (/^(package\.json|index\.html|vite\.config\.ts|styles\.css|tsconfig.*\.json|\.github\/|desktop\/|server\/)/.test(rel)) {
      kind = 'engine-infra';
    } else if (/^(tools|test)\//.test(rel)) kind = 'tooling';
    else kind = 'prose';
    rows.push({ file: rel, line: i + 1, kind, comment: isComment, text: line.trim().slice(0, 110) });
  }
}

const byKind = {};
for (const r of rows) (byKind[r.kind] = byKind[r.kind] || []).push(r);

/* ---------------- 报告 ---------------- */
const ORDER = ['engine-code', 'engine-infra', 'tooling', 'content', 'prose', 'history', 'external'];
const WHY = {
  'engine-code': '引擎模块里的标识符 —— **必须改**（这就是"耦合"的定义）',
  'engine-infra': '引擎基础设施（包名/入口/配置/构建）—— **必须改**',
  'tooling': '工具与测试的**技术标识符**（名字/路径/参数）—— **必须改**；标题类文案看情况',
  'content': '内容侧的标识符（存档键/CSS 类/测试名）—— **保留**（它就叫这个名字）',
  'prose': '文档正文 —— 当**项目名**用时**要改**，当**游戏名**用时**保留**（需人工判）',
  'history': '历史叙述 —— **不许改**（家法：篡改历史比漂移更坏）',
  'external': '外部取证的当时事实 —— **保留**'
};

if (JSON_OUT) { console.log(JSON.stringify({ total: rows.length, byKind, engineModules: ENGINE.length, mixed: MIXED.length })); process.exit(0); }

console.log('\n=== Teapot 改名清单（只报告，不改）===\n');
console.log('  全仓命中 **' + rows.length + ' 处**，分布在 ' + new Set(rows.map(r => r.file)).size + ' 个文件');
console.log('  引擎分类的出处：门 `engine-boundary`（引擎 ' + ENGINE.length + ' · 混合 ' + MIXED.length +
  ' · 内容 ' + CONTENT.length + ' · 数据表 ' + DATA.length + '）\n');

for (const k of ORDER) {
  const list = byKind[k] || [];
  console.log('  【' + k + '】' + list.length + ' 处');
  console.log('      ' + WHY[k]);
  if (list.length) {
    const files = [...new Set(list.map(r => r.file))];
    console.log('      涉及 ' + files.length + ' 个文件' + (files.length <= 8 ? '：' + files.join('  ') : '，前 6 个：' + files.slice(0, 6).join('  ')));
    for (const r of list.slice(0, 3)) console.log('        · ' + r.file + ':' + r.line + '  ' + r.text);
    if (list.length > 3) console.log('        …… 还有 ' + (list.length - 3) + ' 处');
  }
  console.log('');
}

console.log('=== 判据（写进门的形状）===');
console.log('  ✅ **引擎代码里 bronana 出现 0 处**（engine-code 那一档归零）—— 这就是');
console.log('     "内容名不许出现在引擎代码里"的机器判据。');
console.log('  ✅ 引擎基础设施（包名 / 入口 / 配置）改为 Teapot。');
console.log('  ✅ 内容侧与历史叙述**原样保留**。');
