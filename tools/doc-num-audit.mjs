/* =========================================================
   doc-num-audit.mjs — **文档数字门**：文档里写的仓库数字必须与清单一致
   ---------------------------------------------------------
   为什么需要它（这是一次**反复发生**的教训，不是我一次疏忽）：

   实测踩到过至少三次 —— 文档里手写的数字与实际情况对不上：
     · `AGENTS.md` 写「92 个模块 / 62 套 / 17 道门」，实际 93 / 63 / 17
     · `README.md` 写「91 个模块 · 42k 行」，实际 92 / 43k
     · 而**最新一次**是「93 个模块 / 63 套 / 17 道门」vs 实际的 94 / 63 / 17

   根因有两层，**两层都要治**：
     ① 人在文档里**手写**统计数字 —— 数字一旦手写就一定会漂
     ② 而这些数字**没有判据**，所以漂了没人知道（`readme` 门只覆盖 README 的存量表，
        管不到 `AGENTS.md` / `CONTRIBUTING.md` 里散落的同一批数）

   ⚠ **判据只查"该跟着清单走的文档"**，而且**跳过交付记录**：
     `docs/history/**` 是**当时**的快照（它的开头就写着"当时的数字"），
     拿今天的值去比它是错的 —— 那是篡改历史。
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const JSON_OUT = process.argv.includes('--json');

/* ---------------- 真值（全部从清单算，不手写） ---------------- */
const suitesMod = await import(pathToFileURL(path.join(ROOT, 'test', 'suites.mjs')).href);
const SUITES = suitesMod.SUITES.length;
const verifySrc = fs.readFileSync(path.join(ROOT, 'tools', 'verify.mjs'), 'utf8');
const GATES = (verifySrc.match(/GATES\s*=\s*\[([\s\S]*?)\n\];/)[1].match(/id:\s*'/g) || []).length;
const srcFiles = fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'));
const MODULES = srcFiles.length;
/* 家族数要**加载之后**才准 —— 走与 `test/_load.mjs` 同一条路 */
let FAMILIES = null;
try {
  const { installDom } = await import(pathToFileURL(path.join(ROOT, 'test', '_ctx.mjs')).href);
  const load = await import(pathToFileURL(path.join(ROOT, 'test', '_load.mjs')).href);
  installDom();
  await load.loadAll(load.UI_MODULES);
  FAMILIES = globalThis.Registry.names().length;
} catch (e) { /* 加载失败就不判家族那一条（其它判据照跑） */ }

/* ---------------- 该跟着清单走的文档（交付记录豁免） ----------------
   ⚠ 判据**只认"当前状态"那几行的形状**，不做宽泛扫描 —— 实测教训：
     第一版用宽正则（任意"N 套"），抓出 15 处不一致，其中一大半是
     docs/requirements.md 里**各批交付记录**的数字（"这一批之后是 57 套"）。
     那些和 docs/history 一样是**当时快照** —— 拿今天的值去比它是错的，
     等于篡改历史。
   **所以锚点必须是"基线行"的完整形状**（表头 + 列名），不是随便一个"N 套"。 */
const DOCS = ['AGENTS.md', 'README.md', 'CONTRIBUTING.md', 'docs/README.md', 'docs/requirements.md'];

/* 每个数字都有**精确锚点**：锚点是那一整行的形状，于是"当时快照"与"当前状态"不会混 */
const CHECKS = [
  {
    what: '模块数',
    value: MODULES,
    /* `| 代码规模 | \`src/\` 94 个模块 · 约 4.40 万行 …` 与 `| 模块 | **94 个 · 44002 行** …` */
    re: /\|\s*代码规模\s*\|\s*`src\/`\s*(\d+)\s*个模块|\|\s*模块\s*\|\s*\*\*(\d+)\s*个/g,
    hint: '模块数从 `ls src/*.ts`（去掉 `types.d.ts`）算'
  },
  {
    what: '测试套件数',
    value: SUITES,
    /* `| 测试 | **63 套无头测试**（清单…` · `| 测试套件 | **63 套**（清单…` · `pnpm test  # 63 套测试，必须全绿` */
    re: /\|\s*测试\s*\|\s*\*\*(\d+)\s*套无头测试|\|\s*测试套件\s*\|\s*\*\*(\d+)\s*套\*\*|pnpm test\s+#\s*(\d+)\s*套测试/g,
    hint: '套件数从 `test/suites.mjs` 的 `SUITES` 算'
  },
  {
    what: '验收门数',
    value: GATES,
    /* `| 验收门 | **17 道**（清单…` · `| 门 | **17 道**，全绿…` · `pnpm verify  # 全部 17 道门` */
    re: /\|\s*验收门\s*\|\s*\*\*(\d+)\s*道\*\*|\|\s*门\s*\|\s*\*\*(\d+)\s*道\*\*[，,]\s*全绿|pnpm verify\s+#\s*全部\s*(\d+)\s*道门/g,
    hint: '门数从 `tools/verify.mjs` 的 `GATES` 算'
  },
  {
    what: '家族数',
    value: FAMILIES,
    /* ⚠ 只认**基线行**那种写法（括号里是"0 个没人守"，不是 "+N：…" 的增量快照）。
       实测：`docs/requirements.md` 里有 4 处 `家族（扩展点总账）` 是**各批交付的小结**
       （`**134 个**（+4：\`bark\` …）`）—— 那是当时快照，不该跟今天的值比。 */
    re: /\|\s*家族（扩展点总账）\s*\|\s*\*\*(\d+)\s*个\*\*[，,]\s*0\s*个没人守/g,
    hint: '家族数从 `Registry.names().length` 算（要加载全部模块）'
  }
];

const problems = [];
const checked = [];
for (const f of DOCS) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  const text = fs.readFileSync(p, 'utf8');
  for (const c of CHECKS) {
    if (c.value === null) continue;
    for (const m of text.matchAll(c.re)) {
      /* 取正则里第一个捕获到数字的组 */
      const num = Number(m.slice(1).find(x => x !== undefined));
      if (!Number.isFinite(num)) continue;
      checked.push({ file: f, what: c.what, got: num, want: c.value });
      if (num !== c.value) {
        problems.push({
          file: f, what: c.what, got: num, want: c.value,
          at: m[0].trim().slice(0, 60), hint: c.hint
        });
      }
    }
  }
}

const result = { truth: { modules: MODULES, suites: SUITES, gates: GATES, families: FAMILIES }, checked: checked.length, problems };

if (JSON_OUT) { console.log(JSON.stringify(result)); process.exit(problems.length ? 1 : 0); }

console.log('\n=== Teapot · 文档数字门 ===\n');
console.log('  真值（全部从清单算）：模块 ' + MODULES + ' · 套件 ' + SUITES + ' · 门 ' + GATES +
  ' · 家族 ' + (FAMILIES === null ? '(未取到)' : FAMILIES));
console.log('  被检查的文档：' + DOCS.join(' · '));
console.log('  豁免：`docs/history/**`（那是**当时**的快照，拿今天的值比它是篡改历史）');
console.log('\n  扫到 ' + checked.length + ' 处数字声明');

if (problems.length) {
  console.log('\n  ✘ ' + problems.length + ' 处与清单不一致：');
  for (const p of problems) {
    console.log('    ' + p.file + '  ' + p.what + '：写的 ' + p.got + '，实际 ' + p.want + '   「' + p.at + '」');
  }
  console.log('\n  ⚠ 修法**不是**把数字改一遍就算完 —— 手写的数字一定会再漂。');
  console.log('    能算的都改成"从清单算"（README 的存量表由 `pnpm run readme:stats` 刷新；');
  console.log('    别处引用时写清出处，不要抄第二份数）。');
  process.exit(1);
}
console.log('\n  ✔ 文档里的数字与清单一致');
