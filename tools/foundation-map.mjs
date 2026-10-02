/* =========================================================
   foundation-map.mjs — 地基地图（**生成物**，不是手写文档）
   ---------------------------------------------------------
   判据一句话：**盘上的地基地图必须与"现算"逐字节一致。**

   ## 为什么要有它

   本项目的协作者里有 AI：**它会丢上下文、注意力涣散、遗漏、偷懒**。
   对抗这件事的**唯一可靠办法不是"记住"，而是"从清单算出来"** ——
   所以这张地图是**生成的**，六个类别逐类点名，一个都不许静默跳过：

     工具链 · 命令链 · 框架（门 / 测试 / 家族）· 功能（家族声明表）· 模块 · 引擎

   它**只保证"没有东西被漏掉"**（枚举 · 归属 · **谁守它**），**不判断好坏** ——
   判断在 `docs/foundation-audit.md`（那是要人写的账本）。
   这条分工是刻意的：地图里出现一句"这个设计不好"，它就开始漂了。

   ## 用法

     node tools/foundation-map.mjs            # 印到 stdout（人读）
     node tools/foundation-map.mjs --write    # 刷新 docs/foundation-map.md
     node tools/foundation-map.mjs --check    # 门用：盘上副本 == 现算？不一致退出 1
     node tools/foundation-map.mjs --self-test # 注入一处改动，证明 --check 真的会红

   ## 它复用什么（**不自己解析第二遍**）

   表的读法全在 `tools/_tables.mjs`（门 `registration` 用的是同一份）——
   理由写在那份文件头上：**同一张表被两处各解析一遍 = 迟早漂开**。
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, read, diskModules, readSystems, readBoundary, readLoader, readTableKeys } from './_tables.mjs';

const OUT = 'docs/foundation-map.md';
const WRITE = process.argv.includes('--write');
const CHECK = process.argv.includes('--check');
const SELF_TEST = process.argv.includes('--self-test');
const SKIP_DIR = new Set(['node_modules', '.git', 'dist', '.agents', 'ui-shots', '.tmp-npm-cache']);

/* ---------------- 读各类清单 ---------------- */
const pkg = JSON.parse(read('package.json'));
const SCRIPTS = pkg.scripts || {};

/** 验收门：解析 `tools/verify.mjs` 的 `GATES`（**门 = 命令 = 退出码**，没有别的判据） */
function readGates() {
  const src = read('tools/verify.mjs');
  const start = src.indexOf('const GATES');
  const body = src.slice(start, src.indexOf('\n];', start));
  return body.split(/\n  \{\n/).slice(1).map((c) => ({
    id: (c.match(/id:\s*'([^']+)'/) || [])[1],
    script: (c.match(/cmd:\s*\['node',\s*\[\s*'([^']+)'/) || [])[1] || '(非 node 脚本)',
    slow: /slow:\s*true/.test(c)
  })).filter((g) => g.id);
}

/** 测试套件：`test/suites.mjs` 的 `SUITES`（清单唯一出处） */
function readSuites() {
  const src = read('test/suites.mjs');
  return [...src.matchAll(/\['([^']+)',\s*'([^']+)'\]/g)].map((m) => ({ label: m[1], file: m[2] }));
}

/** 所有 `.md`（**排除生成物自己** —— 见下面那条自指陷阱） */
function walkMd(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.has(e.name) || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkMd(p, out);
    /* ⚠ **自指陷阱**：地图里有一行"文档体系 —— N 份 .md"，而地图**自己**就是一份 .md。
       不排除它 ⇒ `--write` 之后 `--check` 立刻不一致（写一次涨一份）—— 生成物自己把自己弄漂。
       实测踩过：写出来 39 份，再算就是 40 份。 */
    else if (e.name.endsWith('.md') && path.relative(ROOT, p).split(path.sep).join('/') !== OUT) out.push(path.relative(ROOT, p).split(path.sep).join('/'));
  }
  return out.sort();
}

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const lines = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').split('\n').length;

/* ---------------- 算地图 ---------------- */
async function build() {
  const gates = readGates();
  const suites = readSuites();
  const systems = readSystems();
  const boundary = readBoundary();
  const loader = await readLoader();
  const disk = diskModules();
  const persistKeys = readTableKeys('test/persist.mjs', ['ALLOWED', 'BUDGET']);
  const archKeys = readTableKeys('test/arch.mjs', ['ALLOWED']);

  /* 家族（**功能**的声明表）：要真加载引擎 —— 期间把 stdout 按住，免得模块的打印混进生成物 */
  let families = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  try {
    process.stdout.write = () => true;
    const { loadAll, SIM_MODULES } = await import('../test/_load.mjs');
    await loadAll(SIM_MODULES);
    families = globalThis.Registry.names().slice().sort();
  } catch (e) {
    families = ['（加载失败：' + e.message + '）'];
  } finally {
    process.stdout.write = origWrite;
  }

  /* 工具：谁引用它 + 有没有自证 */
  const toolFiles = fs.readdirSync(path.join(ROOT, 'tools'), { withFileTypes: true })
    .filter((e) => e.isFile()).map((e) => e.name).sort();
  const ciText = fs.readdirSync(path.join(ROOT, '.github', 'workflows'))
    .map((f) => fs.readFileSync(path.join(ROOT, '.github', 'workflows', f), 'utf8')).join('\n');
  const toolTexts = new Map(toolFiles.map((f) => [f, f.endsWith('.mjs') || f.endsWith('.cjs') ? read('tools/' + f) : '']));
  const gatesByScript = new Map(gates.map((g) => [g.script, g.id]));

  const tools = toolFiles.map((f) => {
    const refs = [];
    const g = gatesByScript.get('tools/' + f);
    if (g) refs.push('门 `' + g + '`');
    for (const [n, cmd] of Object.entries(SCRIPTS)) if (String(cmd).includes('tools/' + f)) refs.push('脚本 `' + n + '`');
    for (const [other, txt] of toolTexts) if (other !== f && txt.includes(f)) refs.push('`tools/' + other + '`');
    if (ciText.includes(f)) refs.push('CI');
    const selfTest = (toolTexts.get(f) || '').includes('--self-test');
    const role = g ? '门' : f.startsWith('_') ? '库（共用）' : f.startsWith('tmp-') ? '⚠ 临时件（不该留在盘上）'
      : f.endsWith('.cjs') || f === 'systems.cjs' || f === 'src-files.cjs' ? '声明表'
        : f.startsWith('dev-') ? '开发工具' : '普查 / 其他';
    return { f, role, refs: [...new Set(refs)], selfTest };
  });

  const suiteFiles = new Set(suites.map((s) => 'test/' + s.file));
  const commands = Object.entries(SCRIPTS).map(([name, cmd]) => {
    const target = (String(cmd).match(/((?:tools|test|src)\/[\w.\-]+)/) || [])[1] || '(内联命令)';
    const gate = gates.find((x) => String(cmd).includes(x.script));
    const isTest = /^test:/.test(name) || /test\//.test(String(cmd));
    const kind = gate ? '门' : isTest ? '测试' : '工具 / 其他';
    const inCi = new RegExp('pnpm (?:run )?' + name.replace(/[:]/g, '\\:') + '\\b').test(ciText);
    const inDocs = ['AGENTS.md', 'CONTRIBUTING.md', 'README.md'].some((d) => read(d).includes(name));
    /* **可达性**：门由 `pnpm verify` 跑到；套件由 `pnpm test`（`test/suites.mjs`）跑到；
       其余要么进 CI、要么只被文档提到。这样"孤儿命令"才是真的孤儿
       （第一版没算"套件"这一路，于是 60 条正常的 `test:*` 快捷方式全被报成孤儿 —— 判据要算全）。 */
    const reach = gate ? '门' : suiteFiles.has(target) ? '套件（`pnpm test`）' : inCi ? 'CI' : inDocs ? '文档' : '';
    return { name, cmd: String(cmd), target, kind, gate: gate ? gate.id : '', inCi, inDocs, reach };
  });

  const docs = walkMd(ROOT).map((f) => {
    const head = fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').slice(0, 12).join('\n');
    const status = (head.match(/^status:\s*"?([^"\n]+)"?/m) || [])[1] || '⚠ 没有 front matter';
    const cat = (head.match(/^category:\s*"?([^"\n]+)"?/m) || [])[1] || '（无）';
    return { f, cat, status, lines: lines(f) };
  });
  const indexText = read('docs/README.md');
  for (const d of docs) d.inIndex = d.f.startsWith('docs/') && !d.f.startsWith('docs/history/') ? indexText.includes(path.basename(d.f)) : null;

  const workspaces = fs.existsSync(path.join(ROOT, 'workspace'))
    ? fs.readdirSync(path.join(ROOT, 'workspace'), { withFileTypes: true }).filter((e) => e.isDirectory())
      .map((e) => {
        const p = 'workspace/' + e.name + '/teapot.workspace.json';
        if (!fs.existsSync(path.join(ROOT, p))) return { dir: e.name, id: '⚠ 没有清单', engine: '' };
        const m = JSON.parse(read(p));
        return { dir: e.name, id: m.id, engine: m.engine };
      })
    : [];

  const ciSteps = [];
  for (const f of fs.readdirSync(path.join(ROOT, '.github', 'workflows'))) {
    const txt = fs.readFileSync(path.join(ROOT, '.github', 'workflows', f), 'utf8');
    let cur = null;
    for (const line of txt.split('\n')) {
      const n = line.match(/^\s*-\s*name:\s*(.+)$/);
      const r = line.match(/^\s*run:\s*(.+)$/);
      if (n) { cur = { file: f, name: n[1].trim(), run: '' }; ciSteps.push(cur); }
      else if (r && cur && !cur.run) cur.run = r[1].trim();
    }
  }

  return { gates, suites, systems, boundary, loader, disk, persistKeys, archKeys, families, tools, commands, docs, workspaces, ciSteps };
}

/* ---------------- 渲成 Markdown ---------------- */
function render(m) {
  const L = [];
  const p = (s = '') => L.push(s);
  p('---');
  p('title: "地基地图（生成物）"');
  p('category: 协作');
  p('status: 现行');
  p('scope: "六个类别（工具链 · 命令链 · 框架 · 功能 · 模块 · 引擎）的**逐项清单 + 归属 + 谁守它**；由 `tools/foundation-map.mjs` 生成，门 `foundation` 校验它不漂"');
  p('source: "`node tools/foundation-map.mjs --write` —— **不要手改本文件**，改了就会被门判红"');
  p('links: ["README.md", "../AGENTS.md"]');
  p('---');
  p('# 地基地图（生成物）');
  p();
  p('> ⚠ **这是生成的**，不是手写的：`node tools/foundation-map.mjs --write` 刷新，');
  p('> 门 `foundation` 校验"盘上副本 == 现算"。');
  p('>');
  p('> 🔴 **本文件里不许出现日期、时间、随机数** —— 那是"生成物"最容易自己把自己弄漂的地方');
  p('> （加一个时间戳，`--check` 第二天就红）。要新鲜度就用"内容对账"，不要用时间戳。');
  p('>');
  p('> 它**只保证"没有东西被漏掉"**（枚举 · 归属 · 谁守它），**不判断好坏** ——');
  p('> 判断与缺口账本在 [`foundation-audit.md`](foundation-audit.md)。');
  p('> 为什么地图要生成：本项目的协作者里有 AI，**它会丢上下文、遗漏、偷懒**；');
  p('> 对抗这件事的唯一可靠办法是"**从清单算**"，而不是"记住"。');
  p();

  /* 一、命令链 */
  p('## 一、命令链（`package.json` 的 scripts）—— ' + m.commands.length + ' 条');
  p();
  p('| 脚本 | 指向 | 类别 | 门 | 在 CI | 被文档提到 |');
  p('| --- | --- | --- | --- | --- | --- |');
  for (const c of m.commands) {
    p('| `' + c.name + '` | `' + c.target + '` | ' + c.kind + ' | ' + (c.gate ? '`' + c.gate + '`' : '') +
      ' | ' + (c.inCi ? '✔' : '') + ' | ' + (c.inDocs ? '✔' : '⚠') + ' |');
  }
  const orphanCmd = m.commands.filter((c) => !c.reach);
  const byReach = (r) => m.commands.filter((c) => c.reach === r).length;
  p();
  p('> **可达性**（谁真的会跑到它）：门 ' + byReach('门') + ' · 套件（`pnpm test`）' + byReach('套件（`pnpm test`）') +
    ' · CI ' + byReach('CI') + ' · 仅文档 ' + byReach('文档') + ' · **谁都跑不到 ' + orphanCmd.length + '**');
  p('>');
  p('> ⚠ **谁都跑不到的命令**（' + orphanCmd.length + ' 条）：' +
    (orphanCmd.length ? orphanCmd.map((c) => '`' + c.name + '`').join(' · ') : '（无）'));
  p();

  /* 二、工具链 */
  p('## 二、工具链（`tools/`）—— ' + m.tools.length + ' 个文件');
  p();
  p('| 文件 | 角色 | 谁引用它 | `--self-test` |');
  p('| --- | --- | --- | --- |');
  for (const t of m.tools) p('| `' + t.f + '` | ' + t.role + ' | ' + (t.refs.join(' · ') || '⚠ 没人引用') + ' | ' + (t.selfTest ? '✔' : '') + ' |');
  const orphanTool = m.tools.filter((t) => !t.refs.length);
  p();
  p('> ⚠ **没有任何引用的工具**（' + orphanTool.length + ' 个）：' + (orphanTool.length ? orphanTool.map((t) => '`' + t.f + '`').join(' · ') : '（无）'));
  p();

  /* 三、门与测试 */
  p('## 三、验收门与测试（框架的判据层）');
  p();
  p('### 门 —— ' + m.gates.length + ' 道（清单唯一出处：`tools/verify.mjs` 的 `GATES`）');
  p();
  p('| # | 门 | 脚本 | `--quick` 跳过 |');
  p('| --- | --- | --- | --- |');
  m.gates.forEach((g, i) => p('| ' + (i + 1) + ' | `' + g.id + '` | `' + g.script + '` | ' + (g.slow ? '✔（慢）' : '') + ' |'));
  p();
  p('### 测试 —— ' + m.suites.length + ' 套（清单唯一出处：`test/suites.mjs`）');
  p();
  p(m.suites.map((s) => '`' + s.label + '`').join(' · '));
  p();

  /* 四、功能 = 家族声明表 */
  p('## 四、功能（`Registry` 家族 —— 扩展点的总账）—— ' + m.families.length + ' 个');
  p();
  p(m.families.map((f) => '`' + f + '`').join(' · '));
  p();
  p('> 家族数是**运行时算出来的**（真加载模拟层后读 `Registry.names()`），不是抄的。');
  p();

  /* 五、模块 */
  p('## 五、模块与分层（`src/`）—— ' + m.disk.length + ' 个模块 · ' + m.systems.layers.length + ' 层');
  p();
  p('| 层 | 系统 | 模块数 | 模块 |');
  p('| --- | --- | --- | --- |');
  for (const l of m.systems.layers) p('| ' + l.layer + ' | ' + l.name + ' | ' + l.n + ' | ' + l.modules.map((x) => '`' + x + '`').join(' ') + ' |');
  p();
  p('**引擎 / 内容分类**（门 `engine-boundary`）：引擎 ' + m.boundary.ENGINE.size + ' · 混合 ' + m.boundary.MIXED.size +
    ' · 显式内容 ' + m.boundary.CONTENT.size + ' · 数据表 ' + m.boundary.TABLES.size +
    ' · **未认领 ' + m.disk.filter((f) => !m.boundary.boundary.has(f)).length + '**');
  p();
  p('**测试加载集**：`MODULES` ' + m.loader.loadModules.size + ' 个键 · SIM ' + m.loader.loadSets.sim.size +
    ' · RENDER ' + m.loader.loadSets.render.size + ' · UI ' + m.loader.loadSets.ui.size +
    ' · 清单键（persist/arch）' + new Set([...m.persistKeys, ...m.archKeys]).size + ' 个');
  p();

  /* 六、文档 */
  p('## 六、文档体系 —— ' + m.docs.length + ' 份 `.md`');
  p();
  p('| 文件 | 分类 | 状态 | 行数 | 在主索引 |');
  p('| --- | --- | --- | --- | --- |');
  for (const d of m.docs) p('| `' + d.f + '` | ' + d.cat + ' | ' + d.status + ' | ' + d.lines + ' | ' + (d.inIndex === null ? '—（分卷）' : d.inIndex ? '✔' : '⚠ 不在') + ' |');
  p();

  /* 七、工作区 */
  p('## 七、工作区清单 —— ' + m.workspaces.length + ' 份');
  p();
  if (!m.workspaces.length) p('（还没有工作区）');
  else {
    p('| 目录 | `id` | `engine` |');
    p('| --- | --- | --- |');
    for (const w of m.workspaces) p('| `workspace/' + w.dir + '/` | `' + w.id + '` | `' + w.engine + '` |');
  }
  p();

  /* 八、CI */
  p('## 八、CI 步骤 —— ' + m.ciSteps.length + ' 步');
  p();
  p('| 工作流 | 步骤 | 跑什么 |');
  p('| --- | --- | --- |');
  for (const s of m.ciSteps) p('| `' + s.file + '` | ' + s.name + ' | `' + s.run + '` |');
  p();
  return L.join('\n') + '\n';
}

/* ---------------- 跑 ---------------- */
const text = render(await build());
const abs = path.join(ROOT, OUT);

if (SELF_TEST) {
  /* 自证：改一个字，`--check` 的判据必须能发现 */
  const altered = text.replace('## 一、命令链', '## 一、命令链（被篡改过）');
  const caught = altered !== text;
  const floored = ['命令链', '工具链'].length > 0 && text.length > 2000;
  console.log('\n=== foundation-map --self-test ===\n');
  console.log('  ' + (caught ? '✔' : '✘') + ' 文件被改一个字 ⇒ 比较判据能发现（**地图不会漂**）');
  console.log('  ' + (floored ? '✔' : '✘') + ' 生成物非空（' + text.length + ' 字节 / ' +
    String(text).split('\n').length + ' 行）—— 空手而归必须红');
  process.exit(caught && floored ? 0 : 1);
}

if (WRITE) {
  fs.writeFileSync(abs, text, 'utf8');
  console.log('✔ 已刷新 ' + OUT + '（' + text.split('\n').length + ' 行 / ' + text.length + ' 字节）');
  process.exit(0);
}

if (CHECK) {
  if (!fs.existsSync(abs)) {
    console.log('✘ ' + OUT + ' 不存在 —— 先跑 `node tools/foundation-map.mjs --write`');
    process.exit(1);
  }
  const onDisk = fs.readFileSync(abs, 'utf8');
  if (onDisk === text) { console.log('✔ ' + OUT + ' 与现算一致（' + text.split('\n').length + ' 行）'); process.exit(0); }
  const a = onDisk.split('\n'), b = text.split('\n');
  const i = a.findIndex((x, k) => x !== b[k]);
  console.log('✘ ' + OUT + ' 与**现算**不一致 —— 盘上是旧的（或有人手改了它）');
  console.log('    第 ' + (i + 1) + ' 行：盘上 `' + String(a[i]).slice(0, 100) + '`');
  console.log('    ' + ' '.repeat(String(i + 1).length) + '      现算 `' + String(b[i]).slice(0, 100) + '`');
  console.log('  修法：`node tools/foundation-map.mjs --write`（**不要手改生成物**）');
  process.exit(1);
}

process.stdout.write(text);
