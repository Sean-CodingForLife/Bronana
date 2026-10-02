/* =========================================================
   _tables.mjs — 登记表的**唯一读法**（给门与地图生成器共用）
   ---------------------------------------------------------
   为什么要有这个文件：**同一张表被两处各解析一遍 = 迟早漂开**。
   这条判据写在 `tools/systems.cjs` 的头注释里、也写在 `workspace-audit.mjs` 的头注释里
   （"同一个判据有两份实现 ⇒ 迟早漂开"）—— 本轮给门 `registration` 写第二遍表解析时，
   自己先犯了这条，于是抽出来。

   ## 两条纪律

   1. **能 import 的表就 import**（`tools/systems.cjs` 用 `createRequire`、
      `test/_load.mjs` 用 `import`）—— 那是**真表**，不会因为写法变化而解析失败。
      ⚠ 踩过：加载集是**派生**的（`RENDER = SIM + 1`），文本解析抓不到，
      照抄成正则就会假红。
   2. **只能文本解析的两处**（`tools/engine-boundary.mjs` 是门、import 即跑；
      `test/persist.mjs` / `test/arch.mjs` 是测试主体）**必须过下限自检** ——
      正则空手而归 = 假绿，要当场红。下限在 `FLOOR` 里。
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

/** 仓库根（本文件在 `tools/` 下，所以是上一级） */
export const ROOT = path.resolve(import.meta.dirname, '..');

/** 下限：解析到的条数少于它 ⇒ 表换了写法，读法没跟上（**空手而归必须红**） */
export const FLOOR = { systems: 50, boundary: 50, loadModules: 50, uiSet: 50, persistKeys: 20, archKeys: 3 };

export const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** 去掉注释后再解析。
 *  ⚠ 必须去注释：这些表的注释里**真的会提到文件名**（"改造前是 x.ts"），
 *  带着注释解析会把"注释里提过"当成"登记过" —— 那就是假绿。 */
export function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** 取一个**顶层声明块**：从 `const NAME = {` / `= [` 到**同缩进**的收尾行。
 *  用同缩进而不是"列 0"，是因为有的表写在函数里（缩进了一层）。 */
export function block(src, name) {
  const re = new RegExp('(?:^|\\n)([ \\t]*)(?:export\\s+)?(?:const|var|let)\\s+' + name + '\\s*=\\s*([\\{\\[])');
  const m = re.exec(src);
  if (!m) return null;
  const indent = m[1];
  const close = new RegExp('^' + indent + (m[2] === '{' ? '\\}' : '\\]') + '\\s*;?\\s*$');
  const lines = src.slice(m.index + m[0].length).split('\n');
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) if (close.test(lines[i])) { end = i; break; }
  return lines.slice(0, end).join('\n');
}

/** 块里所有 `'x.ts'` 形状的名字 */
export const tsIn = (text) => [...String(text).matchAll(/'([A-Za-z0-9_.\-]+\.ts)'/g)].map((m) => m[1]);

/** 块里所有 `'bare'` 形状的名字 */
export const bareIn = (text) => [...String(text).matchAll(/'([A-Za-z0-9_]+)'/g)].map((m) => m[1]);

/** 盘上的模块（**跨根**：引擎 src/ + 各工作区内容根；`types.d.ts` 不是模块 —— 它是全仓的类型声明）
 *  ⚠ E4 批次 1：**只扫 src/ 的写法在搬家那天会静默少看一半模块**（门照样全绿，因为它没看见）——
 *    统一走共享扫描器 `src-files.cjs`（它再转发 `roots.cjs`）。 */
export function diskModules() {
  const require = createRequire(import.meta.url);
  const srcFiles = require('./src-files.cjs');
  return srcFiles.list()
    .filter((f) => f.endsWith('.ts') && f !== 'types.d.ts').sort();
}

/** 分层表：`tools/systems.cjs`（**真表**，require） */
export function readSystems() {
  const require = createRequire(import.meta.url);
  const { SYSTEMS } = require('./systems.cjs');
  const flat = new Set();
  const layers = [];
  for (const s of SYSTEMS) {
    const mods = (s.modules || []).slice();
    for (const f of mods) flat.add(f);
    layers.push({ id: s.id, name: s.name, layer: s.layer, n: mods.length, modules: mods });
  }
  return { systems: flat, layers };
}

/** 引擎 / 内容分类：`tools/engine-boundary.mjs`（**是门**，import 即跑 ⇒ 只能文本解析） */
export function readBoundary() {
  const src = stripComments(read('tools/engine-boundary.mjs'));
  const ENGINE = new Set(tsIn(block(src, 'ENGINE')));
  const MIXED = new Set(tsIn(block(src, 'ENGINE_MIXED')));
  const CONTENT = new Set(tsIn(block(src, 'CONTENT')));
  const TABLES = new Set(tsIn(block(src, 'DATA_TABLES')));
  return { ENGINE, MIXED, CONTENT, TABLES, boundary: new Set([...ENGINE, ...MIXED, ...CONTENT, ...TABLES]) };
}

/** 测试加载器：`test/_load.mjs`（**无副作用 ⇒ import 真表**） */
export async function readLoader() {
  const m = await import('../test/_load.mjs');
  const loadModules = new Map(Object.entries(m.MODULES).map(([k, v]) => [k, String(v).replace(/^\.\.\/src\//, '')]));
  const loadSets = { sim: new Set(m.SIM_MODULES), render: new Set(m.RENDER_MODULES), ui: new Set(m.UI_MODULES) };
  return { loadModules, loadSets };
}

/** 测试主体里的清单键（`test/persist.mjs` / `test/arch.mjs` 是测试主体 ⇒ 只能文本解析） */
export function readTableKeys(rel, names) {
  const src = stripComments(read(rel));
  const out = new Set();
  for (const n of names) for (const f of tsIn(block(src, n))) out.add(f);
  return out;
}

/** 一个模块在哪些加载集里 */
export function setsOf(loadSets, key) {
  const out = [];
  for (const [name, set] of Object.entries(loadSets)) if (set.has(key)) out.push(name);
  return out;
}
