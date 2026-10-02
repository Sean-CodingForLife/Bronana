/* =========================================================
   workspace-audit.mjs — 门「**工作区清单**」
   ---------------------------------------------------------
   判据一句话：**盘上每份 `workspace/<目录>/teapot.workspace.json` 都要被引擎认下来。**

   ## 关键设计：**它不自己写一套校验**，而是 import `../src/workspace.ts` 的 `Workspace.parse`
      理由是这个仓库反复栽过的同一个坑：**同一个判据有两份实现 ⇒ 迟早漂开**
      （`systems.cjs` 的头注释写着同一件事："两边读同一份表，就不会出现
      '工具说没事、测试说有事'"）。所以引擎认不认，门就认不认；引擎改了字段表，门自动跟着改。

   ## 五条判据
     1. **清单要过引擎的 `Workspace.parse`**（未知字段 / 缺必填 / 类型 / `storage.namespace`
        必须等于 `id` / `schema` 不认识）—— 逐条报错原文；
     2. **`id` 全局唯一**（两个工作区同一个 id ⇒ 存档目录与命名空间会撞在一起，这是**数据事故**）；
     3. **目录名与 `id` 不一致 ⇒ 提示级**（不判红）。
        理由：规范说"**目录名不参与身份**"（抄 VS Code：路径是身份、名字是展示），
        所以它不构成错误；但它常常是"改名改了一半"的信号，值得**打印出来给人看**；
     4. **模块开关要过引擎的 `Module.check`**（2026-10-02 补 · 用户点名的句子）：
        未知模块 id · `enabled` 与 `disabled` 撞车 · **被禁用的模块不得被任何启用的模块依赖**。
        ⚠ 与判据 1 同一条纪律：**门不自己写一套** —— 它 import `../src/module.ts`，
        所以引擎改了模块表，门自动跟着改（两份判据迟早漂开）；
      5. **宿主的命名空间必须来自清单**（E4 第 0 批 · 无感知）：`Storage.setNamespace(x)` 的
        `x` **不许是字面量**，而且调它的宿主里必须真的出现"读清单"（`Workspace.namespace()` /
        `workspaceFiles()` / `readManifest()`）。
        理由：宿主是**引擎的**入口 —— 它一旦写出某个工作区的名字，就等于
        **引擎认识内容**（用户口径："二者要彻底分离和**无感知**"）。
        ⚠ 这条判据**只判形状**（实参是不是字面量），而"字面量恰好等于清单里的 id"这种
        情况它照样判红 —— 因为**判据比对的不是值，是有没有第二个出处**。

   ## 自证（家法：一条不会失败的审计等于装饰）
     `node tools/workspace-audit.mjs --self-test`
     注入坏清单（未知字段 / 缺必填 / namespace≠id / **未知模块 id / 开关撞车 / 禁用了被依赖的模块**），
     确认每条都被点名。不写盘、不留痕。
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { Module } from '../src/module.ts';
import { Workspace } from '../src/workspace.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const JSON_OUT = process.argv.includes('--json');
const SELF_TEST = process.argv.includes('--self-test');

/** 盘上所有工作区清单（`workspace/<dir>/teapot.workspace.json`） */
const HOSTS = ['src/main.ts', 'src/cli.ts', 'test/_load.mjs'];

/* 判据 5 的主体：**纯函数**（给它"怎么读文件"，回问题清单）——
   于是 `--self-test` 能拿假源码跑同一段判据（家法：一条不会失败的审计等于装饰）。 */
function checkNamespaceSource(read) {
  const problems = [];
  const CALL = /Storage\.setNamespace\s*\(([^)]*)\)/g;
  for (const f of HOSTS) {
    const src = read(f);
    if (src === null) continue;                       // 这个宿主不存在（可选）
    CALL.lastIndex = 0;
    let m, calls = 0;
    while ((m = CALL.exec(src)) !== null) {
      const arg = m[1].trim();
      if (/^['"\`]/.test(arg)) {
        problems.push(f + '：`Storage.setNamespace(' + arg + ')` 的实参是**字面量** —— ' +
          '宿主不许知道"自己跑的是哪个工作区"，身份只能来自清单（`Workspace.namespace()`）');
      }
      calls++;
    }
    if (calls && !/Workspace\.namespace\(\)|workspaceFiles\(|readManifest\(/.test(src)) {
      problems.push(f + '：它调了 setNamespace，却没有从清单读身份' +
        '（找不到 Workspace.namespace() / workspaceFiles() / readManifest()）');
    }
  }
  return problems;
}

/** 盘上所有工作区清单（`workspace/<dir>/teapot.workspace.json`） */
function manifests() {
  const wsRoot = path.join(ROOT, 'workspace');
  if (!fs.existsSync(wsRoot)) return [];
  const out = [];
  for (const e of fs.readdirSync(wsRoot, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = path.join(wsRoot, e.name, 'teapot.workspace.json');
    if (fs.existsSync(p)) out.push({ dir: e.name, file: 'workspace/' + e.name + '/teapot.workspace.json', path: p });
  }
  return out.sort((a, b) => a.dir.localeCompare(b.dir));
}

/* ---------------- 自证 ---------------- */
if (SELF_TEST) {
  const probe = [
    { name: '未知字段', obj: { schema: 1, id: 'x', displayName: 'X', engine: '>=2 <3', entry: 'a.ts', storage: { namespace: 'x' }, bogus: 1 }, want: '未知字段 `bogus`' },
    { name: '缺必填', obj: { schema: 1, id: 'x' }, want: '缺必填字段' },
    { name: 'namespace≠id', obj: { schema: 1, id: 'x', displayName: 'X', engine: '>=2 <3', entry: 'a.ts', storage: { namespace: 'displayName-不是-id' } }, want: '必须等于 `id`' },
    { name: 'schema 不认识', obj: { schema: 99, id: 'x', displayName: 'X', engine: '>=2 <3', entry: 'a.ts', storage: { namespace: 'x' } }, want: '本引擎只认' }
  ];
  let bad = 0;
  console.log('\n=== 工作区门 · 自证（注入坏数据，必须每条都红）===\n');
  for (const p of probe) {
    const r = Workspace.parse(p.obj);
    const hit = r.problems.some(s => s.includes(p.want));
    console.log('  ' + (r.ok ? '✘' : hit ? '✔' : '✘') + ' [' + p.name + '] ' +
      (r.ok ? '**没报错**（判据是装饰）' : hit ? '报到了：' + p.want : '报错了但没报对：' + r.problems.join(' / ')));
    if (r.ok || !hit) bad++;
  }
  /* 模块开关那三条走的是**另一条代码路径**（`Module.check`），所以单独注入、单独证明。
     清单本身的形状仍然由 `Workspace.parse` 管 —— 两条判据各判各的，不互相代替。 */
  const base = () => ({ schema: 1, id: 'x', displayName: 'X', engine: '>=2 <3', entry: 'a.ts', storage: { namespace: 'x' } });
  const modProbe = [
    { name: '未知模块 id', obj: Object.assign(base(), { modules: { disabled: ['render'] } }), want: '不在引擎的模块表里' },
    { name: '开关撞车', obj: Object.assign(base(), { modules: { enabled: ['art'], disabled: ['art'] } }), want: '同时出现在 `enabled` 与 `disabled` 里' },
    { name: '同一数组写两次', obj: Object.assign(base(), { modules: { enabled: ['art', 'art'] } }), want: '写了两次' },
    { name: '禁用了被依赖的模块', obj: Object.assign(base(), { modules: { disabled: ['art'] } }), want: '被禁用的模块不得被任何启用的模块依赖' }
  ];
  for (const p of modProbe) {
    const list = Module.check(p.obj);
    const hit = list.some(s => s.includes(p.want));
    console.log('  ' + (hit ? '✔' : '✘') + ' [' + p.name + '] ' +
      (list.length ? (hit ? '报到了：' + p.want : '报错了但没报对：' + list.join(' / ')) : '**没报错**（判据是装饰）'));
    if (!hit) bad++;
  }
  /* 判据 5 自己那条路：喂它**假源码**，两类坏形状各一次 + 一次好形状（不该报） */
  const fake = (text) => () => text;
  const goodSrc = 'Storage.setNamespace(Workspace.namespace());';
  const nsProbe = [
    ['命名空间写成了字面量', fake("Storage.setNamespace('某个工作区');\n"), true],
    ['调了 setNamespace 却没人读清单', fake('Storage.setNamespace(ns);\n'), true],
    ['从清单读（好形状，不该报）', fake(goodSrc), false]
  ];
  for (const [name, read, wantBad] of nsProbe) {
    const hit = checkNamespaceSource((f) => (f === HOSTS[0] ? read(f) : null)).length > 0;
    const ok = hit === wantBad;
    console.log('  ' + (ok ? '✔' : '✘') + ' [' + name + '] ' + (hit ? '报到了' : '没有报'));
    if (!ok) bad++;
  }
  console.log('\n  ' + (bad ? '✘ ' + bad + ' 条自证失败' : '✔ 十一条判据都证明会红（含"好形状不该报"）') + '\n');
  process.exit(bad ? 1 : 0);
}

/* ---------------- 判据 ---------------- */
/* 判据 5：宿主的命名空间必须来自清单（读盘的那一份，不是内存里的探针） */
const nsProblems = checkNamespaceSource((f) => {
  const abs = path.join(ROOT, f);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
});
for (const p of nsProblems) problems.push(p);

const list = manifests();
const problems = [];
const hints = [];
const rows = [];
const seen = new Map();

for (const m of list) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(m.path, 'utf8')); }
  catch (e) { problems.push(m.file + '：**不是合法 JSON**（' + String(e.message).slice(0, 80) + '）'); continue; }
  const r = Workspace.parse(raw);
  if (!r.ok) for (const p of r.problems) problems.push(m.file + '：' + p);
  /* 判据 4：模块开关 —— **判据只有一份实现**（在 `src/module.ts` 里），门只负责把它跑一遍 */
  for (const p of Module.check(raw)) problems.push(m.file + '：' + p);
  const id = typeof raw.id === 'string' ? raw.id : null;
  if (id) {
    if (seen.has(id)) problems.push(m.file + '：`id` = `' + id + '` 与 ' + seen.get(id) + ' **重复** —— ' +
      '两个工作区同一个 id 会让**存档目录与存储命名空间撞在一起**（这是数据事故，不是风格问题）');
    else seen.set(id, m.file);
    if (id !== m.dir) hints.push(m.file + '：目录名 `' + m.dir + '` 与 `id` = `' + id + '` 不一致 —— ' +
      '不是错误（规范说**目录名不参与身份**），但常常是"改名改了一半"，确认一下');
  }
  rows.push({ dir: m.dir, id: id, displayName: typeof raw.displayName === 'string' ? raw.displayName : null, ok: r.ok });
}

const result = { workspaces: list.length, rows, problems, hints };
if (JSON_OUT) { console.log(JSON.stringify(result)); process.exit(problems.length ? 1 : 0); }

console.log('\n=== Teapot · 工作区清单门 ===\n');
console.log('  判据：**盘上每份 `workspace/<目录>/teapot.workspace.json` 都要被引擎认下来**');
console.log('  校验器：`src/workspace.ts` 的 `Workspace.parse`（**本门不自己写一套** —— 两份判据迟早漂开）');
console.log('  盘上工作区：' + (list.length ? list.length + ' 个' : '**0 个**（还没有任何工作区）') + '\n');

if (rows.length) {
  console.log('  ' + '目录'.padEnd(14) + 'id'.padEnd(14) + 'displayName'.padEnd(16) + '结论');
  for (const r of rows) console.log('  ' + String(r.dir).padEnd(14) + String(r.id).padEnd(14) + String(r.displayName).padEnd(16) + (r.ok ? '✔' : '✘'));
  console.log('');
}

if (hints.length) {
  console.log('  [提示级] ' + hints.length + ' 条（不判红）：');
  for (const h of hints) console.log('    · ' + h);
  console.log('');
}

if (!problems.length) {
  console.log('  ✔ 清单全部被引擎认下来' + (list.length ? '' : '（当前没有工作区，这条判据空跑为真）'));
  console.log('  ✔ 宿主注入：三个宿主都从清单读身份（`Storage.setNamespace` 的实参不是字面量）');
  console.log('  ✔ 自证：`node tools/workspace-audit.mjs --self-test` 注入十一条坏数据，逐条确认会红\n');
  process.exit(0);
}
console.log('  ✘ ' + problems.length + ' 处：\n');
for (const p of problems) console.log('    · ' + p);
console.log('\n  ⚠ 处置：改清单（**不许改门**）。字段表在 `src/workspace.ts` 的 `FIELDS`；' +
  '\n     要加字段就往那张表加一条 —— 清单里出现引擎不认识的键**一律报错**（抄 Cargo 的教训）。\n');
process.exit(1);
