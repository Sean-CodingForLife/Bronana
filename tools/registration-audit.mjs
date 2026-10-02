/* =========================================================
   registration-audit.mjs — 门「**登记一致性**」（元门）
   ---------------------------------------------------------
   判据一句话：**盘上每个 `src/*.ts` 模块都要在登记表里留名，而且这些表
   一条都不许指向盘上不存在的文件。**

   ## 为什么要有这道"元门"

   实测数过：在 `src/` 下新增一个模块，需要登记的**会红的点有 15 处**，
   而**静默的点有 11 处** —— 也就是说，**有 11 件事可以永远不写下来而全门全绿**。
   最重的一条是**分类本身**：

     > 门 `engine-boundary` 的分类表**没有门守着**。一个新模块一个字都不写，
     > 只会进提示级「既不是引擎、也不在数据表清单里的模块 N 个」，
     > `problems` 为空、**退出码 0**。门自己的注释承认：批次 2 之前有 35 个内容模块
     > 一直处于这个状态。

   而"引擎 / 内容分离"恰恰是本阶段的目标 —— **这件事的判据本身竟然没有门**。

   第二个病是**发现方式**：漏登记不是"一道门告诉你全部缺什么"，
   而是"修一处、跑一遍、被下一道门再红一次" —— **每一道都要一次完整的验证**。
   这道元门把"清单"本身变成判据：**一次列出全部缺失**，不管它们分散在几张表里。

   ## 两条纪律

   **① 判据不重复。** 别人已经判过的一半，这里一个字都不重判：

     | 判据 | 谁判 |
     | --- | --- |
     | 分层表是否覆盖每个模块 | 门 `guards` |
     | `_load.mjs` 的 `MODULES` 是否覆盖每个非入口模块 / 有没有幻影条目 | `test/persist.mjs`（**它有 `main.ts` / `cli.ts` 两个入口的豁免**，本门如果自己再判一遍就会因为不认那两条豁免而**假红** —— 实测踩过） |
     | 模块级可变状态是否申报 / `any` 预算 | `test/persist.mjs` |
     | 家族是否都有 `note` / `owner` | `test/registry.mjs` |

     本门只判**别人没判的那一半**：分类覆盖 · 幽灵条目 · 加载集覆盖 · 清单键的尾巴。

   **② 表要 import，不要重新解析一遍。** 凡是被 import 安全的表（`tools/systems.cjs`、
   `test/_load.mjs`）一律 import —— 这正是 `workspace-audit.mjs` 的头注释写的同一个理由：
   **同一个判据有两份实现 ⇒ 迟早漂开**。只有**跑起来就有副作用**的两份
   （`test/persist.mjs` / `test/arch.mjs` 是测试主体）才退回文本解析，
   而且解析结果要过**下限自检**（正则空手而归 = 假绿，必须当场红）。

   ## 自证（家法：一条不会失败的审计等于装饰）

     `node tools/registration-audit.mjs --self-test`
     在**内存里**造一份坏数据（一个没登记的新模块、一条指向已删文件的幽灵、一个
     只在加载集里出现的野键），逐条确认每个判据都被点名。不写盘、不留痕。
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { MODULES, SIM_MODULES, RENDER_MODULES, UI_MODULES } from '../test/_load.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const JSON_OUT = process.argv.includes('--json');
const SELF_TEST = process.argv.includes('--self-test');

/* ---------------- 读表 ---------------- */
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** 去掉注释后再解析。
 *  ⚠ 为什么必须去注释：这几张表的注释里**真的会提到文件名**（"改造前是 x.ts"之类），
 *  带着注释解析会把"注释里提过"当成"登记过" —— 那就是假绿。 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** 取一个**顶层声明块**：从 `const NAME = {` / `= [` 到**同缩进**的收尾行。
 *  用同缩进而不是"列 0"，是因为有的表写在函数里（缩进了一层）。 */
function block(src, name) {
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
const tsIn = (text) => [...String(text).matchAll(/'([A-Za-z0-9_.\-]+\.ts)'/g)].map((m) => m[1]);

/** 盘上 `src/` 的模块（`types.d.ts` 不是模块 —— 它是全仓的类型声明） */
function diskModules() {
  return fs.readdirSync(path.join(ROOT, 'src'))
    .filter((f) => f.endsWith('.ts') && f !== 'types.d.ts').sort();
}

/** 读齐各张表 */
function parse() {
  const require = createRequire(import.meta.url);
  const { SYSTEMS } = require('../tools/systems.cjs');
  const systems = new Set();
  for (const s of SYSTEMS) for (const f of (s.modules || [])) systems.add(f);

  /* `engine-boundary.mjs` 是**门**：import 它会直接跑那道门并 process.exit ⇒ 只能文本解析 */
  const boundSrc = stripComments(read('tools/engine-boundary.mjs'));
  const ENGINE = new Set(tsIn(block(boundSrc, 'ENGINE')));
  const MIXED = new Set(tsIn(block(boundSrc, 'ENGINE_MIXED')));
  const CONTENT = new Set(tsIn(block(boundSrc, 'CONTENT')));
  const TABLES = new Set(tsIn(block(boundSrc, 'DATA_TABLES')));
  const boundary = new Set([...ENGINE, ...MIXED, ...CONTENT, ...TABLES]);

  /* 加载器：**import 真表**（它无副作用）。加载集是**派生的**（RENDER = SIM + 1），
     所以谁都不能靠文本解析它们 —— 这是本门第一版真踩过的假红。 */
  const loadModules = new Map(Object.entries(MODULES).map(([k, v]) => [k, String(v).replace(/^\.\.\/src\//, '')]));
  const loadSets = { sim: new Set(SIM_MODULES), render: new Set(RENDER_MODULES), ui: new Set(UI_MODULES) };

  /* 这两份是**测试主体**（import 即执行断言）⇒ 只能文本解析 */
  const persistSrc = stripComments(read('test/persist.mjs'));
  const archSrc = stripComments(read('test/arch.mjs'));
  const persistKeys = new Set([...tsIn(block(persistSrc, 'ALLOWED')), ...tsIn(block(persistSrc, 'BUDGET'))]);
  const archKeys = new Set(tsIn(block(archSrc, 'ALLOWED')));

  return { ENGINE, MIXED, CONTENT, TABLES, boundary, loadModules, loadSets, systems, persistKeys, archKeys,
    parsed: { systems: systems.size, boundary: boundary.size, loadModules: loadModules.size,
      uiSet: loadSets.ui.size, persistKeys: persistKeys.size, archKeys: archKeys.size } };
}

/* 允许"进了 MODULES、但故意不在任何一个加载集里"的模块 —— **必须写理由**（写了没理由会被下面点名） */
const LOAD_SET_EXEMPT = new Map([
  // ['foo', '为什么它不该被加载'],
]);

/* ---------------- 判据（纯函数，便于自证） ---------------- */
function checks(d) {
  const disk = new Set(d.disk);
  const out = [];
  const add = (id, note, problems) => out.push({ id, note, problems });

  add('boundary-cover', '每个模块都在 engine-boundary 的分类表里（引擎 / 混合 / 内容 / 数据表 四选一）',
    d.disk.filter((f) => !d.boundary.has(f)));

  add('boundary-ghost', 'engine-boundary 的分类表里不许有盘上不存在的模块',
    [...d.boundary].filter((f) => !disk.has(f)).sort());

  add('systems-ghost', '分层表（`tools/systems.cjs`）里不许有盘上不存在的模块',
    [...d.systems].filter((f) => !disk.has(f)).sort());

  const allSets = new Set([...d.loadSets.sim, ...d.loadSets.render, ...d.loadSets.ui]);
  add('load-set-cover', '`MODULES` 的每个键都在某个加载集里（SIM / RENDER / UI）—— 只加一处的漏登记**以前没有门**',
    [...d.loadModules.keys()].filter((k) => !allSets.has(k) && !d.exempt.has(k)).sort());

  add('load-set-ghost', '加载集里不许有 `MODULES` 里没有的键（改名后最容易留的尾巴）',
    [...allSets].filter((k) => !d.loadModules.has(k)).sort());

  add('key-ghost', '`persist` / `arch` 的清单键指向的模块必须还在盘上',
    [...new Set([...d.persistKeys, ...d.archKeys])].filter((f) => !disk.has(f)).sort());

  return out;
}

/* ---------------- 跑 ---------------- */
const d = parse();
const disk = diskModules();
d.disk = disk;
d.exempt = LOAD_SET_EXEMPT;

/* ⚠ 解析自检：任何一张表**空手而归**都必须当场红 —— 否则这道门会永远"全绿" */
const floor = { systems: 50, boundary: 50, loadModules: 50, uiSet: 50, persistKeys: 20, archKeys: 3 };
const shapeProblems = [];
for (const [k, min] of Object.entries(floor)) {
  if (d.parsed[k] < min) shapeProblems.push(k + '：只解析到 ' + d.parsed[k] + ' 条（少于 ' + min + '）—— 表换了写法，本门的读法没跟上');
}
for (const [k, why] of LOAD_SET_EXEMPT) {
  if (!why || why.length < 8) shapeProblems.push('LOAD_SET_EXEMPT 里的 ' + k + ' 没写清理由');
}

if (SELF_TEST) {
  /* 内存里造坏数据：一个没登记的新模块 + 一条指向已删文件的幽灵 + 一个只活在加载集里的野键 */
  const broken = {
    ...d,
    disk: [...d.disk, 'zzz_brand_new.ts'],
    boundary: new Set([...d.boundary, 'ghost_gone.ts']),
    systems: new Set([...d.systems, 'ghost_gone.ts']),
    loadModules: new Map([...d.loadModules, ['zzz_brand_new', 'zzz_brand_new.ts']]),
    loadSets: { sim: new Set([...d.loadSets.sim, 'ghost_key_not_in_modules']), render: new Set(d.loadSets.render), ui: new Set(d.loadSets.ui) },
    persistKeys: new Set([...d.persistKeys, 'ghost_gone.ts']),
    archKeys: new Set([...d.archKeys, 'ghost_gone.ts'])
  };
  const got = checks(broken);
  const mustFire = ['boundary-cover', 'boundary-ghost', 'systems-ghost', 'load-set-cover', 'load-set-ghost', 'key-ghost'];
  console.log('\n=== registration-audit --self-test ===\n');
  let bad = 0;
  for (const id of mustFire) {
    const r = got.find((x) => x.id === id);
    const fired = !!(r && r.problems.length);
    if (!fired) bad++;
    console.log('  ' + (fired ? '✔' : '✘') + ' 注入坏数据后 ' + id.padEnd(17) +
      (fired ? ' 被点名（' + r.problems.length + ' 条）' : ' **没红** —— 这条判据是装饰'));
  }
  /* 解析下限那条也要能红：把一张表清空 */
  const blind = checks({ ...broken, disk: d.disk, boundary: new Set() });
  const blindFired = blind.find((x) => x.id === 'boundary-cover').problems.length > 0;
  if (!blindFired) bad++;
  console.log('  ' + (blindFired ? '✔' : '✘') + ' 表被清空时 boundary-cover 会红（空手而归 = 假绿的解药）');
  console.log('\n  ' + (bad ? bad + ' 条判据在坏数据下**没红**' : '全部判据在坏数据下都会红 ✔'));
  process.exit(bad ? 1 : 0);
}

const problems = [
  ...(shapeProblems.length ? [{ id: 'shape', note: '读表自检（表被清空 / 换了写法时必须红）', problems: shapeProblems }] : []),
  ...checks(d).filter((r) => r.problems.length)
];
const total = problems.reduce((n, r) => n + r.problems.length, 0);

if (JSON_OUT) {
  console.log(JSON.stringify({ parsed: d.parsed, problems, total }));
  process.exit(total ? 1 : 0);
}

console.log('\n=== 门「登记一致性」（元门）===\n');
console.log('  盘上 src 模块 ' + disk.length + ' 个 · 读到的表：' +
  Object.entries(d.parsed).map(([k, v]) => k + ' ' + v).join(' · '));
for (const r of checks(d)) {
  console.log('  ' + (r.problems.length ? '✘' : '✔') + ' ' + r.id.padEnd(17) + ' ' +
    (r.problems.length ? r.problems.length + ' 处' : '一致').padEnd(6) + ' ' + r.note);
  for (const p of r.problems.slice(0, 12)) console.log('        · ' + p);
  if (r.problems.length > 12) console.log('        … 另有 ' + (r.problems.length - 12) + ' 处');
}
console.log('\n=== 结果 ===');
if (!total) {
  console.log('  ✔ 登记表互相一致，且没有指向不存在文件的条目。');
} else {
  console.log('  ✘ ' + total + ' 处登记不一致 —— **一次列全**，不用等下一道门再告诉你剩下的。');
  console.log('    修法：按上面的清单逐条补（下一版会由 `tools/register-module.mjs` 代劳）。');
}
process.exit(total ? 1 : 0);
