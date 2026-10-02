/* =========================================================
   roots.cjs — **模块根**的唯一声明（引擎的 `src/` + 每个工作区的内容根）
   ---------------------------------------------------------
   为什么要有它：E4 要把内容搬进 `workspace/Bronana/src/`（`docs/workspace-migration.md`），
   而**今天全仓有 25 处各自 `readdirSync('src')`**（工具 16 · 测试 9）。
   搬家那一天，其中每一处都会**静默地少看一半文件** —— 门照样全绿，因为它根本没看见那些模块。
   这个仓库对这一类失效有名字：「**校验没坏，只是读漏了**」，而且栽过多次。

   所以"根"这件事**只许在这里说一次**：
     · 引擎根 `src/`（永远在）
     · 每个工作区的内容根 —— 从 `workspace/<目录>/teapot.workspace.json` 的 `content.src` 读
       （**清单是唯一出处**；用户口径："引擎不认识任何具体项目"）

   ⚠ **过渡态去重**（今天就是）：清单里 `content.src: "../../src"` ⇒ 内容根**就是**引擎根。
   那时**不许枚举两遍**（否则每个模块都被数两次，而"数量一律从清单算"会当场变假）。
   判断方式是**解析后的绝对路径相同** —— 不是比字符串（`../../src` 与 `src` 是同一个地方）。

   ## 自证
     `node tools/roots.cjs --self-test`
     在**临时目录**里造一个"第二根"的工作区，证明：① 它会被枚举到（不是静默漏掉）；
     ② 指向引擎根的那份清单会被**去重**（不是数两遍）。不碰仓库、不留痕。
   ========================================================= */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_REL = 'src';

/** 把一个目录下的 `.ts` 递归收成相对该根的路径（`sim/game.ts`）—— **只认正斜杠** */
function walkTs(dir, prefix, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return out; }                        // 根不存在 = 空根（不是错：工作区可能还没有 src/）
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkTs(p, prefix + e.name + '/', out);
    else if (e.name.endsWith('.ts')) out.push(prefix + e.name);
  }
  return out;
}

/**
 * 从某个仓库根算出全部模块根。
 * @param {string} base 仓库根（默认：本文件上一级）
 * @returns {{ id: string, kind: 'engine'|'workspace', dir: string, abs: string, note?: string }[]}
 */
function rootsFrom(base) {
  const out = [{
    id: 'engine', kind: 'engine', dir: SRC_REL,
    abs: path.join(base, SRC_REL), note: '引擎自己的模块根'
  }];
  const wsDir = path.join(base, 'workspace');
  if (!fs.existsSync(wsDir)) return out;
  const dirs = fs.readdirSync(wsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name).sort();
  for (const name of dirs) {
    const mf = path.join(wsDir, name, 'teapot.workspace.json');
    if (!fs.existsSync(mf)) continue;
    let m;
    /* ⚠ 坏清单**不在这里报**（那是门 `workspace` 的活）——这里只回答"内容根在哪" */
    try { m = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch { continue; }
    const src = (m && m.content && typeof m.content.src === 'string') ? m.content.src : 'src';
    const abs = path.resolve(path.join(wsDir, name), src);
    if (abs === out[0].abs) {
      /* 过渡态：内容根就是引擎根（`content.src: "../../src"`）⇒ **去重**，只标一个备注 */
      out[0].note = '引擎自己的模块根（⚠ 工作区 `' + name + '` 的 `content.src` 暂时指向这里 —— 搬家前是过渡态，**不重复枚举**）';
      continue;
    }
    out.push({
      id: 'ws:' + (m && m.id ? m.id : name), kind: 'workspace',
      dir: path.posix.join('workspace', name, String(src).replace(/\\/g, '/')),
      abs, note: '工作区 ' + name + ' 的内容根（出处：该工作区清单的 `content.src`）'
    });
  }
  return out;
}

/** 盘上的模块根（**唯一出口**） */
function roots() { return rootsFrom(ROOT); }

/**
 * 全部模块（每个根下递归的 `.ts`）。
 * @returns {{ rel: string, base: string, root: string, kind: string, abs: string }[]}
 *   `rel` 是**相对它自己那个根**的路径（分层表用的是裸名，所以还要 `base`）
 */
function list() {
  const out = [];
  for (const r of roots()) {
    for (const rel of walkTs(r.abs, '', []).sort()) {
      out.push({
        rel, base: rel.split('/').pop(), root: r.id, kind: r.kind,
        abs: path.join(r.abs, rel)
      });
    }
  }
  return out;
}

/* ---------------- 自证（家法：一条不会失败的审计等于装饰） ---------------- */
function selfTest() {
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'teapot-roots-'));
  let bad = 0;
  const say = (ok, label, extra) => {
    console.log('  ' + (ok ? '✔' : '✘') + ' ' + label + (ok || extra === undefined ? '' : '  → ' + extra));
    if (!ok) bad++;
  };
  try {
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'engine_only.ts'), 'export var a = 1;\n');
    /* ① 第二根：一个正常的工作区（自己的 src/） */
    fs.mkdirSync(path.join(tmp, 'workspace', 'Probe', 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'workspace', 'Probe', 'teapot.workspace.json'),
      JSON.stringify({ schema: 1, id: 'probe', displayName: 'Probe', engine: '>=1', entry: 'src/main.ts', storage: { namespace: 'probe' }, content: { src: 'src' } }));
    fs.writeFileSync(path.join(tmp, 'workspace', 'Probe', 'src', 'probe_mod.ts'), 'export var b = 2;\n');
    /* ② 过渡态：另一份清单的 content.src 指向引擎根（必须去重）。
       ⚠ 路径是**相对该清单所在目录**：清单在 `workspace/Shadow/`，引擎根在仓库根的 `src/`
       ⇒ 要往上两级（`../../src`）。第一版这里写的是 `../src`（少一级），**自证当场抓住了**
       —— 它会把 `workspace/src` 当成一个"新根"，于是同一份内容被枚举两遍。 */
    fs.mkdirSync(path.join(tmp, 'workspace', 'Shadow'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'workspace', 'Shadow', 'teapot.workspace.json'),
      JSON.stringify({ schema: 1, id: 'shadow', displayName: 'Shadow', engine: '>=1', entry: 'a.ts', storage: { namespace: 'shadow' }, content: { src: '../../src' } }));
    fs.writeFileSync(path.join(tmp, 'workspace', 'Shadow', 'src.ts'), 'export var c = 3;\n');

    const rs = rootsFrom(tmp);
    const all = (function from(base) {
      const out = [];
      for (const r of rs) for (const rel of walkTs(r.abs, '', [])) out.push(r.id + ':' + rel);
      return out;
    })();
    say(rs.length === 2, '两个根（引擎 + 工作区 Probe），Shadow 那份指向引擎根**已去重**', JSON.stringify(rs.map((r) => r.id)));
    say(all.indexOf('ws:probe:probe_mod.ts') >= 0, '第二根里的模块**被枚举到了**（不是静默漏掉）', all.join(' '));
    say(all.filter((x) => x.endsWith('engine_only.ts')).length === 1,
      '引擎根的文件只被数**一次**（去重真的生效）', String(all.filter((x) => x.endsWith('engine_only.ts')).length));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log('\n  ' + (bad ? '✘ ' + bad + ' 条自证失败' : '✔ 三条自证都过') + '\n');
  process.exit(bad ? 1 : 0);
}

module.exports = { ROOT, SRC_REL, roots, rootsFrom, list, walkTs };

if (require.main === module) {
  if (process.argv.includes('--self-test')) selfTest();
  else {
    for (const r of roots()) {
      console.log(r.id.padEnd(14) + r.kind.padEnd(11) + (r.dir + '/').padEnd(34) + r.note);
    }
    const all = list();
    console.log('\n  模块 ' + all.length + ' 个（' +
      roots().map((r) => r.id + ' ' + all.filter((m) => m.root === r.id).length).join(' · ') + '）');
  }
}
