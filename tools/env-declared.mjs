/* =========================================================
   env-declared.mjs — 门「**环境变量声明**」
   ---------------------------------------------------------
   判据一句话：**代码里读的每个环境变量，都要在 `.env.example` 里被声明过。**

   为什么需要它（这是本仓库反复栽过的同一个形状）：
     · 环境变量是**没有类型检查的输入**（`strict:false` 下写错名不会报，只是永远 undefined）；
     · 而这个仓库的代码里有 **11 个**这样的键，改造前**一个都没被声明过** ——
       没人能回答"这个项目到底认哪些环境变量"，只能 grep；
     · 更糟的是 `.gitignore` 里**没有 `.env`** ⇒ 谁建一个 `.env`，它就进版本库了
       （机器层的值泄漏进仓库）。那条已单独修掉，这里管的是"键有没有被声明"。

   ⚠ 与门 `doc-num` / 门 `naming` 同一条纪律：**数量与清单要对得上**。
     这里的两边是：**读点**（代码）↔ **声明表**（`.env.example`）。

   ## 自证（家法：一条不会失败的审计等于装饰）
   跑 `node tools/env-declared.mjs --self-test`：它会注入一个**假的未声明读点**，
   确认门**真的会红**，然后撤销。不用临时脚本、不留痕（`--self-test` 只动内存里的副本）。

   ⚠ **两种声明形态都认**：`KEY=` 与 `# KEY=`。模板刻意全部注释掉 ——
     因为 `KEY=`（空串）与"未设置"**不等价**，把 `.env.example` 原样复制成 `.env`
     会悄悄改行为（例：`TZ=` 可能被解释成 UTC）。
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const JSON_OUT = process.argv.includes('--json');
const EXAMPLE = '.env.example';

/* 这些是**系统/宿主**的键（不是本项目的契约），声明它们没有意义。
   ⚠ 判据只放行**这一张表**里列出的；新增一个"其实该声明"的键不许往这里塞。 */
const SYSTEM = new Set([
  'HOME', 'USERPROFILE', 'PATH', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA',
  'PROGRAMFILES', 'PROGRAMFILES(X86)', 'COMSPEC', 'SYSTEMROOT', 'SYSTEMDRIVE',
  'PATHEXT', 'USERNAME', 'USERDOMAIN', 'COMPUTERNAME', 'OS', 'LANG', 'LC_ALL',
  'TERM', 'CI', 'NODE_ENV', 'PWD', 'SHELL'
]);

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.pnpm-store', '.agents', 'ui-shots']);
const EXTS = ['.ts', '.mjs', '.cjs'];

function filesIn(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) filesIn(p, out);
    else if (EXTS.includes(path.extname(e.name))) out.push(p);
  }
  return out;
}

/** 声明表里出现过哪些键（`KEY=` 与 `# KEY=` 都认，且容忍写成 `# # KEY=` 的手滑） */
function declared() {
  const p = path.join(ROOT, EXAMPLE);
  if (!fs.existsSync(p)) return null;
  const set = new Set();
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = /^\s*(?:#\s*)*([A-Z][A-Z0-9_]{1,})\s*=/.exec(line);
    if (m) set.add(m[1]);
  }
  return set;
}

/** 代码里读了哪些键（`process.env` 的**点号直读** + `e.X` 注入式读取的显式登记见下） */
function reads(extraSelfTest) {
  const hits = new Map();          // 键 → [文件:行 …]
  /* ⚠ **从仓库根开始走**（实测：第一版只手扫子目录，漏了 `vite.config.ts` 这类根文件 ——
     于是门反过来抱怨"声明了没人读"。**判据自己扫不全，却把错报在内容上** ——
     本仓库记过的同一类口径错：数对了，量错了对象。） */
  const dirs = [ROOT];
  for (const d of dirs) {
    for (const f of filesIn(d)) {
      /* ⚠ **门不许扫自己**（实测踩过）：本文件的头注释里举例写了「process.env 的读法」，
         于是门把自己那行注释当成了一个"未声明的键 X"。自称的扫描器扫到自己，
         这一类假阳性会让门看起来在乱报 —— 人就会去关掉它。 */
      if (path.resolve(f) === path.resolve(import.meta.filename)) continue;
      const rel = path.relative(ROOT, f).replace(/\\/g, '/');
      const lines = fs.readFileSync(f, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        for (const m of lines[i].matchAll(/process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
          const k = m[1];
          if (!hits.has(k)) hits.set(k, []);
          hits.get(k).push(rel + ':' + (i + 1));
        }
      }
    }
  }
  /* 注入式读取（`gpuMode(env)` 那种收的是对象而不是 process.env）不方便静态认出，
     所以**由被测方显式登记**在这里 —— 登记的键必须真的在代码里能找到字符串，
     否则这条登记本身就是假的（下一条判据会抓）。 */
  for (const k of INJECTED) {
    if (!hits.has(k)) hits.set(k, []);
    hits.get(k).push('（注入式读取，见 tools/env-declared.mjs 的 INJECTED）');
  }
  if (extraSelfTest) {
    if (!hits.has(extraSelfTest)) hits.set(extraSelfTest, []);
    hits.get(extraSelfTest).push('（--self-test 注入的假读点）');
  }
  return hits;
}

/** 注入式读取的环境变量（**显式登记**：它们不写 `process.env.X`，静态抓不到） */
const INJECTED = ['TEAPOT_DESKTOP_GPU', 'BRONANA_DESKTOP_GPU'];

/* ---------------- 判据 ---------------- */
const problems = [];
const decl = declared();
if (decl === null) {
  problems.push({ what: '缺声明表', detail: '找不到 ' + EXAMPLE + ' —— 它是这些键的**唯一出处**，读不到就不能判' });
}
const hits = reads(process.argv.includes('--self-test') ? 'SELF_TEST_UNDECLARED_KEY' : null);

const undeclared = [];
const unusedDecl = [];
if (decl) {
  for (const [k, where] of [...hits.entries()].sort()) {
    if (SYSTEM.has(k)) continue;
    if (!decl.has(k)) undeclared.push({ key: k, where });
  }
  for (const k of [...decl].sort()) {
    if (SYSTEM.has(k)) continue;
    if (!hits.has(k)) unusedDecl.push(k);
  }
  if (undeclared.length) {
    problems.push({
      what: '读了但没声明',
      detail: undeclared.map(u => u.key + '（' + u.where[0] + '）').join(' · ') +
        ' —— 处置：在 ' + EXAMPLE + ' 里声明这个键（谁读它 / 默认值 / 作用），' +
        '**不是**把它塞进 SYSTEM 允许清单'
    });
  }
  if (unusedDecl.length) {
    problems.push({
      what: '声明了但没人读',
      detail: unusedDecl.join(' · ') + ' —— 表是**声明**不是许愿池：没人读的键要删掉（它会让下一个人以为那个开关有用）'
    });
  }
}

const result = {
  declared: decl ? [...decl].sort() : null,
  readKeys: [...hits.keys()].sort(),
  checkedFiles: ['src', 'tools', 'test', 'desktop', 'server'].filter(d => fs.existsSync(path.join(ROOT, d))).length,
  problems
};

if (JSON_OUT) {
  console.log(JSON.stringify(result));
  process.exit(problems.length ? 1 : 0);
}

console.log('\n=== Teapot · 环境变量声明门 ===\n');
console.log('  判据：**代码里读的每个环境变量，都要在 ' + EXAMPLE + ' 里被声明过**');
console.log('  声明表 ' + (decl ? decl.size + ' 个键' : '(读不到)') + ' · 代码里读到 ' + hits.size + ' 个键\n');

if (!problems.length) {
  console.log('  ✔ 两边对得上：读到的都声明了，声明的都有人读');
  console.log('  ✔ 系统键走允许清单（HOME / PATH / TEMP … —— 它们不是本项目的契约）\n');
  process.exit(0);
}

for (const p of problems) console.log('  ✘ 【' + p.what + '】' + p.detail + '\n');
process.exit(1);
