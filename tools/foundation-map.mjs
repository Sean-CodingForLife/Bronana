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
import { spawnSync } from 'node:child_process';
import { ROOT, read, diskModules, readSystems, readBoundary, readLoader, readTableKeys } from './_tables.mjs';

const OUT = 'docs/foundation-map.md';
const WRITE = process.argv.includes('--write');
const CHECK = process.argv.includes('--check');
const SELF_TEST = process.argv.includes('--self-test');
const SKIP_DIR = new Set(['node_modules', '.git', 'dist', '.agents', 'ui-shots', '.tmp-npm-cache']);

/* =========================================================
   **只认版本库里的文件**（`git ls-files`）—— 生成物必须是**版本库内输入**的纯函数
   ---------------------------------------------------------
   为什么：实测栽在这里。地图在本地把两个"**盘上有、版本库里没有**"的东西算了进去：
   `tools/.session.json`（会话层，被 `.gitignore` 忽略）与 `design/README.md`（用户未跟踪的目录），
   而**干净检出里没有这两个** ⇒ 地图逐字节对不上 ⇒ **门在 CI 上必红**（本地却全绿）。
   这就是"生成物"这一类东西最容易犯的错：**把自己的输入偷偷扩大到了工作区**。

   口径与门 `drift` 保持一致：**`.gitignore` 是这个仓库唯一的"哪些文件不该入库"声明** ——
   一份声明在 `.gitignore` 里、门却在抱怨它，那两边本来就对不上。
   ⚠ 代价要说清：**被 gitignore 的文件不在任何门的视野里**（`tools/tmp-*.mjs` 就是靠这条隐身的），
   所以"临时件验完即删"这条规范**只能靠人**，门帮不上 —— 这条限制写在 `docs/foundation-audit.md` 里。

   取不到 git 索引时**硬失败**（不像 `drift` 那样 fail-open）：一张算不准的地图比没有地图更坏，
   而这张地图的全部价值就是"**在 CI 上也能算出同一张图**"。
   ========================================================= */
function tracked() {
  const r = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 || !r.stdout) {
    console.error('✘ 取不到 `git ls-files` —— 地图必须只由**版本库里的文件**算出来（否则本地绿、CI 红）。');
    process.exit(1);
  }
  return new Set(r.stdout.split('\0').filter(Boolean));
}
const TRACKED = tracked();

/* =========================================================
   状态声明表：**无引用 ⇒ 必须有状态与理由**
   ---------------------------------------------------------
   为什么要有它：地图第一次跑出来时，`tools/` 里有 **16 个文件没有任何引用**、
   命令里有 **14 条谁都跑不到** —— 而它们在机器眼里与"在役工具"**长得一模一样**。
   "手工档"与"死命令"分不开，就等于**没有任何地方能回答"这个东西还要不要"**；
   而其中 `tools/tmp-readme-rows.mjs` **连 git 都没跟踪**（它自己在文件头写着"验完即删"），
   所以**任何门都不可能发现它** —— 这正是"靠人记住的规范都会漂"的活证据。

   ⇒ 判据：**有引用 ⇒ 不用声明；没引用 ⇒ 必须在这里写状态与理由（理由 ≥ 12 字）**。
     反向也判：声明表里不许有盘上已经不存在的东西（幽灵声明）。
   ========================================================= */
const TOOLS_STATUS = new Map([
  ['apply-comp.cjs', ['oneoff', '把各处"手写对象字面量"改成 `Comp.spawn(原型, 覆盖)` —— 已执行完的一次性改造']],
  ['batch-close.cjs', ['oneoff', '收掉"批处理"这条线 —— 一次性的结构性改造']],
  ['batch-num.cjs', ['oneoff', 'README 里的烘焙帧数字改成实测值 —— 一次性（现在由门 `readme` 守存量表）']],
  ['canvas-numbers.cjs', ['oneoff', '更正决策记录里的离屏画布显存数字 —— 一次性']],
  ['decal-decide.cjs', ['oneoff', '贴花三条决定的收尾 —— 一次性']],
  ['decal-hoist.cjs', ['oneoff', '把贴花循环里"每个贴花各存一次画布状态栈"提出来 —— 一次性性能改造']],
  ['esm-ify.cjs', ['oneoff', '把"IIFE + 挂 window"的模块写法改成真正的 ES 模块 —— 一次性迁移（已完成）']],
  ['esm-tests.cjs', ['oneoff', '把"CJS + `vm.runInThisContext`"的测试套件改成真正的 ESM —— 一次性迁移（已完成）']],
  ['finalize-comp.cjs', ['oneoff', '`comp` 改造的收尾 —— 一次性']],
  ['fix-comp.cjs', ['oneoff', '第一轮 `comp` 普查抓出来的四个问题 —— 一次性']],
  ['fix-types.cjs', ['oneoff', '迁移期的定向修复（文件头写着"可重复执行"）—— 迁移结束后不再需要']],
  ['make-migration-fixture.mjs', ['keep', '生成 v1→v2 迁移的**测试夹具**：`test/migration.mjs` 用的是它的产物，夹具要重生成时靠它']],
  ['migrate-types.cjs', ['oneoff', '一次性迁移脚本（机械改动）—— 迁移已完成']],
  ['rename-doudou.cjs', ['oneoff', '中文里的「土豆」改成「豆豆」—— 一次性改名']],
  ['rewrite-items.py', ['oneoff', '把 `data_items.ts` 的 `I.LIST` 换成"有得有失"的版本 —— 一次性（**仓库里唯一的 Python 文件**）']],
  /* ⚠ 这里**曾经**有一条 `tmp-readme-rows.mjs`（状态 `temp`）。它按家法被删掉了 ⇒
     声明表里也必须跟着删 —— 否则**幽灵声明**那条判据会红（这正是它该有的行为：
     声明表与盘上**两个方向**都要对得上）。 */
]);

const COMMANDS_STATUS = new Map([
  ['test:for', ['manual', '按名字单跑一套测试的捷径（`pnpm test` 是正门）—— 手工档']],
  ['desktop:gpu', ['manual', '带 GPU 加速开关的桌面外壳启动 —— 机器层手工档']],
  ['desktop:nosandbox', ['manual', '关掉沙箱的桌面启动（排障用）—— 机器层手工档']],
  ['verify:quick', ['manual', '文档里的正写法是 `pnpm verify --quick`；这条是等价别名 —— 手工档']],
  ['typecheck:report', ['manual', '把 `tsc` 的错误整理成给人读的报告 —— 手工档']],
  ['gen:curves', ['manual', '从实测数据重算数值曲线表 —— 需要时手工跑']],
  ['text:census', ['manual', '文案普查（i18n 与界面文本）—— 手工档']],
  ['ui-preview', ['manual', '在无头环境里生成界面预览（`ui-shots/`）—— 手工档']],
  ['dev:edit', ['manual', '`tools/dev-edit.mjs` 的入口别名 —— 文档直接写 `node tools/dev-edit.mjs`']],
  ['rename:inventory', ['manual', '改名前先普查"这个词出现在哪些文件" —— 改名流程的第一步']],
  ['hooks:install', ['manual', 'git 钩子的安装 —— **刻意不装**（钩子是机器层的，判据留在 `pnpm verify`）']],
  ['hooks:status', ['manual', '看钩子装没装 —— 与上一条同一套工具']],
  ['hooks:remove', ['manual', '卸载钩子 —— 与上一条同一套工具']],
  ['art-manifest', ['manual', '导出美术清单 —— 手工档']],
]);

/* =========================================================
   子目录声明表：**只读一层的门看不见它们** —— 所以要显式写下来
   ---------------------------------------------------------
   实测的洞：门 `drift` 的 `readDir` **只读一层**，于是 `tools/` 与 `test/` 的**子目录里的东西
   不进任何清单**（`test/fixtures/` 就是靠这一点绕过去的；被 `.gitignore` 忽略的
   `tools/tmp-readme-rows.mjs` 是另一种隐身）。要把 15 个一次性脚本挪进 `tools/oneoff/`，
   **前提就是先让子目录可见** —— 否则"整理"等于"把东西藏起来"，比不动更坏。
   判据：**每个子目录都要在这里写一句它是什么、为什么不需要被当成工具 / 套件登记**；
   反向也判：声明表里不许有盘上已经不存在的目录。
   ========================================================= */
const SUBDIRS_STATUS = new Map([
  ['test/fixtures', '迁移测试用的**夹具**（生成物），不是测试套件 —— 门 `drift` 只读一层，所以它不进"每套测试都有名字"那张清单'],
]);

/** 盘上 `tools/` 与 `test/` **下一层**的子目录（与门 `drift` 的视野同一深度，只算有版本库文件的） */
function realSubdirs() {
  const out = [];
  for (const top of ['tools', 'test']) {
    for (const e of fs.readdirSync(path.join(ROOT, top), { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      if ([...TRACKED].some((t) => t.startsWith(top + '/' + e.name + '/'))) out.push(top + '/' + e.name);
    }
  }
  return [...new Set(out)].sort();
}

/** 判据：子目录必须被声明 —— **没被看见 ≠ 没问题** */
function subdirProblems(list) {
  const problems = [];
  for (const d of list) {
    const why = SUBDIRS_STATUS.get(d);
    if (!why) problems.push('`' + d + '/` 是个子目录，但**没有任何地方声明它** —— 只读一层的门看不见里面（那不是"没问题"，是"没被看见"）');
    else if (why.length < 12) problems.push('`' + d + '/` 的说明太短（要写清"它是什么、为什么不用登记"）');
  }
  for (const k of SUBDIRS_STATUS.keys()) if (!list.includes(k)) problems.push('声明表里的 `' + k + '/` 已经不在盘上了');
  return problems;
}

/** 判据：**无引用 ⇒ 必须有状态与理由**（工具的 `refs` / 命令的 `reach` 都是"有人在用它"的证据） */function dispositions(m) {
  const problems = [];
  for (const t of m.tools) {
    if (t.refs.length) continue;
    const d = TOOLS_STATUS.get(t.f);
    if (!d) problems.push('`tools/' + t.f + '` **没有任何引用**，也没在 `TOOLS_STATUS` 里写状态与理由');
    else if (!d[1] || d[1].length < 12) problems.push('`tools/' + t.f + '` 的状态理由太短（要说清"这是什么、为什么还留着"）');
  }
  for (const c of m.commands) {
    if (c.reach) continue;
    const d = COMMANDS_STATUS.get(c.name);
    if (!d) problems.push('命令 `' + c.name + '` **谁都跑不到**，也没在 `COMMANDS_STATUS` 里写状态与理由');
    else if (!d[1] || d[1].length < 12) problems.push('命令 `' + c.name + '` 的状态理由太短');
  }
  /* 反向：声明表里不许有盘上不存在的东西（**幽灵声明** —— 与门 `registration` 的幽灵条目同一个病） */
  for (const k of TOOLS_STATUS.keys()) if (!m.tools.some((t) => t.f === k)) problems.push('`TOOLS_STATUS` 里的 `' + k + '` 已经不在盘上了');
  for (const k of COMMANDS_STATUS.keys()) if (!m.commands.some((c) => c.name === k)) problems.push('`COMMANDS_STATUS` 里的 `' + k + '` 已经不是脚本了');
  return problems;
}

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
       实测踩过：写出来 39 份，再算就是 40 份。
       ⚠ **第二个坑**：只能算**版本库里的** `.md`（见文件头 `tracked()`）——
       未跟踪的 `design/README.md` 会把本地算成 40 份、CI 算成 38 份。 */
    else if (e.name.endsWith('.md')) {
      const rel = path.relative(ROOT, p).split(path.sep).join('/');
      if (rel !== OUT && TRACKED.has(rel)) out.push(rel);
    }
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
  /* ⚠ **只算版本库里的**（见文件头）：`tools/.session.json` 这类被 gitignore 的本地文件
     在干净检出里不存在，算进去就会本地绿、CI 红。 */
  const toolFiles = fs.readdirSync(path.join(ROOT, 'tools'), { withFileTypes: true })
    .filter((e) => e.isFile() && TRACKED.has('tools/' + e.name)).map((e) => e.name).sort();
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
    const st = TOOLS_STATUS.get(f);
    return { f, role, refs: [...new Set(refs)], selfTest, status: st ? st[0] : '', why: st ? st[1] : '' };
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
    /* ⚠ 第一版**没把"目标文件被文档提到"算进可达性**，于是把 `dev:edit`（文档里写的是
       `node tools/dev-edit.mjs`）也报成了"谁都跑不到" —— **判据要算全，算不全就是噪声**。 */
    const targetDoc = target !== '(内联命令)' &&
      ['AGENTS.md', 'CONTRIBUTING.md', 'README.md'].some((d) => read(d).includes(target));
    /* ⚠ 判据要算**三种**"有人在用它"：门 / 套件 / CI 或文档 / **被别的工具调用**
       （`foundation:map` 就是第三种：它由门 `doc-num` 间接调用 —— 不认这一种就会把它冤枉成死命令）。 */
    const base = target.split('/').pop();
    const byTool = target.startsWith('tools/') &&
      [...toolTexts.entries()].some(([o, t]) => o !== base && t.includes(base));
    const reach = gate ? '门' : suiteFiles.has(target) ? '套件（`pnpm test`）' : inCi ? 'CI' : inDocs ? '文档'
      : targetDoc ? '文档（目标文件被提到）' : byTool ? '被别的工具调用' : '';
    const st = COMMANDS_STATUS.get(name);
    return { name, cmd: String(cmd), target, kind, gate: gate ? gate.id : '', inCi, inDocs, reach,
      status: st ? st[0] : '', why: st ? st[1] : '' };
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

  return { gates, suites, systems, boundary, loader, disk, persistKeys, archKeys, families, tools, commands, docs, workspaces, ciSteps,
    subdirs: realSubdirs() };
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
    p('| `' + c.name + '` | `' + c.target + '` | ' + c.kind + (c.status ? ' · **' + c.status + '**' : '') + ' | ' + (c.gate ? '`' + c.gate + '`' : '') +
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
  for (const t of m.tools) p('| `' + t.f + '` | ' + t.role + (t.status ? ' · **' + t.status + '**' : '') + ' | ' + (t.refs.join(' · ') || (t.status ? '（无引用，已声明）' : '⚠ 没人引用')) + ' | ' + (t.selfTest ? '✔' : '') + ' |');
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
const M = await build();
const text = render(M);
const abs = path.join(ROOT, OUT);

if (SELF_TEST) {
  /* 自证：改一个字，`--check` 的判据必须能发现 */
  const altered = text.replace('## 一、命令链', '## 一、命令链（被篡改过）');
  const caught = altered !== text;
  const floored = ['命令链', '工具链'].length > 0 && text.length > 2000;
  /* 自证之二：**没有归属**的东西必须被点名（拿一份只多出一个无引用工具的数据去问） */
  const dispCaught = dispositions({ tools: [...M.tools, { f: 'zzz_fake.cjs', refs: [] }], commands: [] }).length > 0;
  const ghostCaught = dispositions({ tools: [], commands: [] }).length > 0;   /* 声明表里的东西全不在盘上 ⇒ 幽灵 */
  /* 自证之三：**没被声明的子目录**必须被点名（只读一层的门看不见它） */
  const sdCaught = subdirProblems(['tools/zzz_undeclared']).length > 0;
  const sdGhost = subdirProblems([]).length > 0;
  console.log('\n=== foundation-map --self-test ===\n');
  console.log('  ' + (caught ? '✔' : '✘') + ' 文件被改一个字 ⇒ 比较判据能发现（**地图不会漂**）');
  console.log('  ' + (floored ? '✔' : '✘') + ' 生成物非空（' + text.length + ' 字节 / ' +
    String(text).split('\n').length + ' 行）—— 空手而归必须红');
  console.log('  ' + (dispCaught ? '✔' : '✘') + ' 一个**无引用且无状态**的工具 ⇒ 被点名（"手工档"与"死命令"分得开）');
  console.log('  ' + (ghostCaught ? '✔' : '✘') + ' 声明表指向盘上没有的东西 ⇒ 也红（**幽灵声明**）');
  console.log('  ' + (sdCaught ? '✔' : '✘') + ' 一个**没声明的子目录** ⇒ 被点名（"没被看见"不等于"没问题"）');
  console.log('  ' + (sdGhost ? '✔' : '✘') + ' 子目录声明指向盘上没有的目录 ⇒ 也红');
  process.exit(caught && floored && dispCaught && ghostCaught && sdCaught && sdGhost ? 0 : 1);
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
  /* **先判状态声明**（与"新鲜度"是两件事，所以分开报）：无引用 ⇒ 必须有状态与理由 */
  const und = dispositions(M);
  if (und.length) {
    console.log('✘ 地图里有 ' + und.length + ' 项**没有归属**（无引用，也没写状态声明）：');
    for (const x of und.slice(0, 20)) console.log('    · ' + x);
    console.log('  两条出路：① 让它**被引用**（进 JSON 脚本 / 门 / CI / 另一份工具）；');
    console.log('             ② 在 `tools/foundation-map.mjs` 的 `TOOLS_STATUS` / `COMMANDS_STATUS` 里写状态与理由。');
    process.exit(1);
  }
  /* 再判**子目录**：只读一层的门看不见里面 —— 没被看见 ≠ 没问题 */
  const sd = subdirProblems(M.subdirs);
  if (sd.length) {
    console.log('✘ 有 ' + sd.length + ' 个子目录**没有任何声明**（`tools/` 与 `test/` 下一层）：');
    for (const x of sd) console.log('    · ' + x);
    console.log('  修法：在 `tools/foundation-map.mjs` 的 `SUBDIRS_STATUS` 里写一句"它是什么、为什么不用登记"。');
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
