/* =========================================================
   arch-audit.cjs — 架构体检（模块规模 / 依赖方向 / 系统分层 / 死代码）

   它回答的是"这个项目是不是**按模块和系统**搭的"，而不是"跑不跑得起来"：
     [1] 模块规模与耦合（行数 / 扇入 / 扇出）
     [2] 依赖图（有没有环）
     [3] 类型字符串分支（开闭原则热点：新增一种就多一个分支）
     [4] 注册表 / 扩展点
     [5] 全局接口规模（接口隔离）
     [6] any 用量
     [7] 死接口 / 内部成员
     [8] **系统分层**：跨系统的依赖边与方向（模型在 tools/systems.cjs）

   用法： node tools/arch-audit.cjs          打印报告
          node tools/arch-audit.cjs --json   给脚本用

   `analyze()` 是导出的：`test/arch.mjs` 直接拿它的结果做断言 ——
   尤其是**尺子自己的精度**（见下面 `deadOf` 的注释：这一节曾经 6 条全错）。
   ========================================================= */
const fs = require('node:fs');
const path = require('node:path');
const { SYSTEMS, EXCEPTIONS, BY_ID, SYS_OF } = require('./systems.cjs');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

function read(p) { return fs.readFileSync(p, 'utf8'); }
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* ---------------- 1. 逐个模块扫描 ---------------- */
const files = fs.readdirSync(SRC).filter(f => f.endsWith('.ts') && f !== 'types.d.ts').sort();

function scanModules() {
  const mods = {};
  for (const f of files) {
    const raw = read(path.join(SRC, f));
    const src = stripComments(raw);
    const deps = [...src.matchAll(/^import\s[^'"]*from\s*'\.\/([^']+)'/gm)].map(m => m[1]);
    mods[f] = {
      file: f,
      loc: raw.split('\n').length,
      code: src.split('\n').filter(l => l.trim()).length,
      deps: [...new Set(deps)],
      exports: [...src.matchAll(/^export\s+(?:const|function|class|interface|type|let|var)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]),
      stringBranches: [...src.matchAll(/(?:===|!==|case)\s*'([^']+)'/g)].map(m => m[1]),
      anyCount: [...src.matchAll(/:\s*any\b|as any\b/g)].length,
      registryCalls: [...src.matchAll(/([A-Za-z_$][\w$]*)\.(register|archetype|define|defineComponent|system|behaviour|behavior|pattern)\s*\(/g)].map(m => m[1] + '.' + m[2])
    };
  }
  return mods;
}

/* ---------------- 2. 依赖图：扇入 / 扇出 / 环 ---------------- */
function countFanIn(mods) {
  const fanIn = {};
  for (const f of files) fanIn[f] = 0;
  for (const f of files) for (const d of mods[f].deps) if (fanIn[d] !== undefined) fanIn[d]++;
  return fanIn;
}

function findCycles(mods) {
  const color = {}, stack = [], out = [];
  const visit = (f) => {
    color[f] = 1; stack.push(f);
    for (const d of mods[f].deps) {
      if (!mods[d]) continue;
      if (color[d] === 1) out.push(stack.slice(stack.indexOf(d)).concat(d).join(' → '));
      else if (!color[d]) visit(d);
    }
    stack.pop(); color[f] = 2;
  };
  files.forEach(f => { if (!color[f]) visit(f); });
  return out;
}

/* ---------------- 3. 死导出 / 死成员（文本近似） ----------------
   语料 = src + test + tools + desktop + server。注释不算引用。 */
const searchRoots = ['src', 'test', 'tools', 'desktop', 'server'];
function buildCorpus() {
  const corpus = [];
  for (const r of searchRoots) {
    const dir = path.join(ROOT, r);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isFile()) corpus.push({ p, text: stripComments(read(p)) });
    }
  }
  return corpus;
}
const corpus = buildCorpus();
const corpusTop = read(path.join(ROOT, 'index.html')) + read(path.join(ROOT, 'styles.css'));

function findUnusedExports(mods) {
  const dead = [], internal = [];
  for (const f of files) {
    const selfPath = path.resolve(path.join(SRC, f));
    for (const name of mods[f].exports) {
      let outside = 0, inside = 0;
      const re = new RegExp('\\b' + esc(name) + '\\b', 'g');
      for (const c of corpus) {
        const n = (c.text.match(re) || []).length;
        if (path.resolve(c.p) === selfPath) inside += n; else outside += n;
      }
      if (new RegExp('\\b' + esc(name) + '\\b').test(corpusTop)) outside++;
      /* 定义那一行不算"被用"。减掉它，`export function makeMarket` 才不会
         因为"自己提到了自己"而永远看起来像活代码。 */
      const defRe = new RegExp('(?:export\\s+)?(?:function|const|let|var|class|interface|type)\\s+' + esc(name) + '\\b', 'g');
      const selfText = read(path.join(SRC, f));
      const defs = (stripComments(selfText).match(defRe) || []).length;
      const usedInside = Math.max(0, inside - defs);
      if (outside === 0 && usedInside === 0) dead.push(f + ' → ' + name);
      else if (outside === 0) internal.push(f + ' → ' + name + '（本文件内用了 ' + usedInside + ' 次）');
    }
  }
  return { dead, internal };
}

/* 命名空间对象的成员（U.pick 这种导出的是 U，成员不在导出表里）：
   把 `X.name = function` 扫出来，再看全仓库有没有人用。 */
const nsOwners = {
  U: 'utils.ts', D: 'draw2d.ts', S: 'sprites.ts', Comp: 'comp.ts', Rig: 'rig.ts',
  Bronana: 'bronana.ts', Stats: 'stats.ts', Emit: 'emit.ts', Arena: 'arena.ts',
  W: 'data_weapons.ts', I: 'data_items.ts', C: 'data_chars.ts', E: 'enemies.ts',
  Settings: 'settings.ts', Save: 'save.ts', Storage: 'storage.ts', Scene: 'scene.ts',
  Game: 'game.ts', R: 'render.ts', UI: 'ui.ts', Col: 'collide.ts', Sfx: 'audio.ts',
  AI: 'ai.ts'
};

function membersOf(file, ns) {
  const p = path.join(SRC, file);
  if (!fs.existsSync(p)) return [];
  const s = stripComments(read(p));
  // 只认"函数成员"（本项目的命名空间 API 一律写成 `S.foo = function (…) {}`）。
  // 不认纯数据赋值（`R.phase = 'enemies'` 这种字段会被 probe 通过 holder 对象动态读，
  // 静态搜索看不到，会被误报成死代码）。
  const out = new Set();
  for (const m of s.matchAll(new RegExp('(?<![\\w$.])' + ns + '\\.([A-Za-z_$][\\w$]*)\\s*=\\s*function\\b', 'g'))) {
    out.add(m[1]);
  }
  return [...out];
}

/**
 * 模块 → 所有别名。
 *
 * 这里是**误报的主要来源**，历史上有三层：
 *   ① 本文件内部名（`Enemies` 在模块里叫 `E`）—— 已处理
 *   ② `export { X }` 与全仓库 `import { X as Y }` —— 已处理
 *   ③ **测试里的三种写法**（这一轮补上，之前全漏）：
 *        `globalThis.UI.actNames()`   ← 原来的左边界 `(?<![\w$.])` 把 `.` 挡掉了
 *        `const UIx = globalThis.UI`  ← 别名从没被登记
 *        `const g = globalThis` + `g.UI.x` ← 全局对象的别名
 *   漏掉的后果不是"少报"，而是**把活代码报成"真死，可删"**：
 *   实测这一节 6 条"真死"里 6 条是活的（精度 0%），而 `test/arch.mjs` 现在钉住了这一条。
 */
function namespaceAliases(mods) {
  const map = {};
  const add = (file, name) => {
    if (!name || !file) return;
    (map[file] = map[file] || new Set()).add(name);
  };
  for (const [ns, file] of Object.entries(nsOwners)) add(file, ns);

  const aliasToFile = {};
  const remember = (alias, file) => { if (alias && file) aliasToFile[alias] = file; };
  for (const [ns, file] of Object.entries(nsOwners)) remember(ns, file);

  // export { X } / export { X as Y }
  for (const f of files) {
    const s = stripComments(read(path.join(SRC, f)));
    for (const m of s.matchAll(/^export\s*\{([^}]*)\}/gm)) {
      m[1].split(',').forEach(n => add(f, n.trim().split(/\s+as\s+/).pop()));
    }
  }
  // 全仓库的 import { A, B as C } from '…/<mod>.ts'
  for (const c of corpus) {
    for (const m of c.text.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"][^'"]*\/([A-Za-z0-9_]+)\.ts['"]/g)) {
      const file = m[2] + '.ts';
      if (!(file in mods)) continue;
      m[1].split(',').forEach(part => {
        const local = part.trim().split(/\s+as\s+/).pop().trim();
        if (local) add(file, local);
      });
    }
  }
  /* 全局对象本身的别名：`const g = globalThis` / `const w = window` */
  const globals = new Set(['globalThis', 'window', 'global', 'self']);
  for (const c of corpus) {
    for (const m of c.text.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:globalThis|window|global|self)\b(?!\s*\.)/g)) {
      globals.add(m[1]);
    }
  }
  /* `const UIx = globalThis.UI` / `const UIx = g.UI` */
  const globRe = new RegExp('(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*([A-Za-z_$][\\w$]*)\\s*\\.\\s*([A-Za-z_$][\\w$]*)', 'g');
  for (const c of corpus) {
    for (const m of c.text.matchAll(globRe)) {
      if (!globals.has(m[2])) continue;
      const file = aliasToFile[m[3]];
      if (file) { add(file, m[1]); remember(m[1], file); }
    }
  }
  /* `const { Game, Scene } = globalThis`（也认 `{ Game: G }`） */
  const destrRe = new RegExp('(?:const|let|var)\\s*\\{([^}]*)\\}\\s*=\\s*([A-Za-z_$][\\w$]*)', 'g');
  for (const c of corpus) {
    for (const m of c.text.matchAll(destrRe)) {
      if (!globals.has(m[2])) continue;
      m[1].split(',').forEach(part => {
        const bits = part.split(':').map(x => x.trim()).filter(Boolean);
        if (!bits.length) return;
        const file = aliasToFile[bits[0]];
        if (file) { add(file, bits[bits.length - 1] || bits[0]); }
      });
    }
  }
  return map;
}

/** 这个成员名有没有以**字符串字面量**出现过（`record.ts` 的 `'autoExplore'` 那种表）。
 *  有 → 它可能被 `Game[name]` 动态派发，静态搜索**判不了**，绝不能报"可删"。 */
function appearsAsString(name) {
  const re = new RegExp('[\'"]' + esc(name) + '[\'"]');
  for (const c of corpus) if (re.test(c.text)) return true;
  return false;
}

function findDeadMembers(mods, aliasMap) {
  const dead = [], internal = [], dynamic = [];
  for (const [ns, file] of Object.entries(nsOwners)) {
    const aliases = [...(aliasMap[file] || new Set([ns]))];
    const selfPath = path.resolve(path.join(SRC, file));
    for (const name of membersOf(file, ns)) {
      let outside = 0, inside = 0;
      for (const c of corpus) {
        const isSelf = path.resolve(c.p) === selfPath;
        for (const a of aliases) {
          /* 左边界用 `(?<![\w$])`（**允许前面是 `.`**）：
             `globalThis.UI.actNames` 与 `g.UI.actNames` 都必须算引用。
             原来写的是 `(?<![\w$.])`，把这两种写法整片漏掉。 */
          const re = new RegExp('(?<![\\w$])' + esc(a) + '\\.' + esc(name) + '(?![\\w$])(?!\\s*=[^=])', 'g');
          const n = (c.text.match(re) || []).length;
          if (isSelf) inside += n; else outside += n;
        }
      }
      if (outside > 0) continue;
      /* 顺序要紧：**先看"本文件里用没用"**，再看字符串。
         反过来的话 `Settings.save` 会被算成"动态判不了" —— 因为 `'save'` 这个字符串
         在 envelope.ts 里当域名用过，于是"自己文件里调了 3 次"这个更硬的事实被盖住。
         字符串只应该救那些**确实没有静态引用**的名字（`Game[name]` 那种）。 */
      if (inside > 0) { internal.push(ns + '.' + name + '  (' + file + ')'); continue; }
      if (appearsAsString(name)) { dynamic.push(ns + '.' + name + '  (' + file + '，经字符串/动态派发引用)'); continue; }
      dead.push(ns + '.' + name + '  (' + file + ')');
    }
  }
  return { dead, internal, dynamic };
}

/* ---------------- 4. 全局接口的方法数（接口隔离） ---------------- */
function apiSizes() {
  const typesSrc = read(path.join(SRC, 'types.d.ts'));
  const out = [];
  for (const m of typesSrc.matchAll(/^interface\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const name = m[1], body = m[2];
    const methods = (body.match(/^\s{2}[A-Za-z_$][\w$]*\s*\(/gm) || []).length;
    const fields = (body.match(/^\s{2}[A-Za-z_$][\w$]*\s*[:?]/gm) || []).length;
    if (methods + fields >= 8) out.push({ name, methods, fields, total: methods + fields });
  }
  out.sort((a, b) => b.total - a.total);
  return out;
}

/* ---------------- 5. 注册表 / 数据表规模 ----------------
   数组字面量的条目数用括号配平来数，不用"往后扫 20000 字符"那种近似 ——
   近似会把文件里其它 `id:` 一起数进来（第一版把 10 种怪物数成了 12 种）。 */
function listSize(file, marker) {
  const s = stripComments(read(path.join(SRC, file)));
  const at = s.indexOf(marker);
  if (at < 0) return null;
  const open = s.indexOf('[', at);
  if (open < 0) return null;
  let depth = 0, i = open, entries = 0;
  for (; i < s.length; i++) {
    const ch = s[i];
    if (ch === '[' || ch === '{') { if (depth === 1 && ch === '{') entries++; depth++; }
    else if (ch === ']' || ch === '}') { depth--; if (depth === 0) break; }
  }
  return entries;
}

/* ---------------- 6. 系统分层：跨系统的依赖边 ---------------- */
/**
 * @returns { edges, violations, unassigned, inner }
 *   `edges`      系统 → 系统 的边（含具体模块对）
 *   `violations` **方向向上**的边（低层认识高层）。它必须逐条出现在
 *                `tools/systems.cjs` 的 EXCEPTIONS 里，否则 test/arch.mjs 会红。
 */
function systemEdges(mods) {
  const unassigned = files.filter(f => !SYS_OF[f]);
  const edges = {};
  for (const f of files) {
    const a = SYS_OF[f];
    if (!a) continue;
    for (const d of mods[f].deps) {
      const b = SYS_OF[d];
      if (!b || a === b) continue;
      const k = a + ' → ' + b;
      (edges[k] = edges[k] || { from: a, to: b, list: [] }).list.push(f + '→' + d);
    }
  }
  const violations = [];
  for (const e of Object.values(edges)) {
    if (BY_ID[e.to].level > BY_ID[e.from].level) violations.push(e);
  }
  violations.sort((x, y) => y.list.length - x.list.length);
  return { edges, violations, unassigned };
}

/* ---------------- 未使用的具名 import ----------------
   为什么值得单独量：`import { X } from './y.ts'` 是一句**声明**，而声明了不用的
   后果不是"少点优雅"，是三条真代价：
     ① 它是一条**假的依赖边**（`[1]` 的扇入扇出与 `[8]` 的分层把它当真的算）；
     ② 它把"这个模块认识那个模块"写在纸面上，而下一个人会照着它去加新用法；
     ③ 它让 `test/arch.mjs` 的例外清单失去精度（一条已经没人用的边会一直挂着理由）。
   实测：这一节第一次跑就抓出 8 处（`main.ts` 的 `Stats`/`PAL`、四个模块的 `U`…）。
   判据是**注释之外**出现这个标识符 —— 注释里提到不算引用
   （本项目注释极多，用整文件搜索会把它们全漏掉）。 */
function findUnusedImports(mods) {
  const out = [];
  for (const f of files) {
    const raw = read(path.join(SRC, f));
    const lines = raw.split('\n');
    for (const m of raw.matchAll(/^import\s*\{([^}]+)\}\s*from\s*'\.\/[\w.]+\.ts';/gm)) {
      const head = lines[m.index === 0 ? 0 : raw.slice(0, m.index).split('\n').length - 1].trim();
      if (/^import\s+type\b/.test(head)) continue;
      const body = raw.replace(m[0], '');
      const codeOnly = stripComments(body);
      for (const part of m[1].split(',')) {
        const t = part.trim();
        if (!t || /^type\s/.test(t)) continue;
        const local = (t.split(/\s+as\s+/).pop() || t).trim();
        const re = new RegExp('\\b' + esc(local) + '\\b');
        // 名字只出现在 import 里 → 声明了没人用
        if (!re.test(codeOnly)) out.push(f + ' → ' + local);
      }
    }
  }
  return out.sort();
}

/* ---------------- 数据表字段：声明了却没有任何读点 ----------------
   数据表上写着 `pickTier: 3` 而全仓库没有一处读它 —— 那是**无声的谎**：
   作者以为自己在标注掉落档位，而那条标注从来没有生效过。
   本项目已经有一条同类的纪律（"声明了却没人读 = 这条效果是假的"），
   但它只覆盖**注册表家族内部**的键（`boons.ts` 的 mods、`items.ts` 的 specials）；
   数据表上的普通字段没人管。

   判据与 `[7]` 一致（文本近似），而且**只在全仓库一次都没出现时**才报：
   用法是 `x.field` / `field:`（同一张表里的其它行）/ 任何位置的 `field` 标识符。
   所以误报的模式是"只用字符串拼出字段名"（本项目没有这种写法）。 */
function findUnreadFields() {
  const code = {};
  for (const f of files) code[f] = stripComments(read(path.join(SRC, f)));
  const typesSrc = stripComments(read(path.join(SRC, 'types.d.ts')));
  const countIn = (src, k) => (src.match(new RegExp('\\b' + esc(k) + '\\b', 'g')) || []).length;
  const out = [];
  for (const [file, marker] of [['data_weapons.ts', 'W.LIST'], ['data_items.ts', 'I.LIST'],
    ['data_chars.ts', 'C.LIST'], ['enemies.ts', 'E.LIST'], ['affixes.ts', 'var LIST']]) {
    const src = read(path.join(SRC, file));
    const i = src.indexOf(marker);
    if (i < 0) continue;
    /* **只扫这张表的字面量**：从赋值处开始括号配平，遇到与表同级的 `];` 就停。
       为什么要配平 —— 第一版从 `var LIST = [` 一路扫到文件末尾，把函数体里的
       局部变量（`wmul` / `cands` / `slotBases` …）全当成了"表字段"，
       [9] 于是报了 9 条假警报（而 `test/arch.mjs` 会要求这一节为空）。 */
    const open = src.indexOf('[', i);
    if (open < 0) continue;
    let depth = 0, end = -1;
    for (let p = open; p < src.length; p++) {
      const ch = src[p];
      if (ch === '[' || ch === '{') depth++;
      else if (ch === ']' || ch === '}') { depth--; if (depth === 0) { end = p; break; } }
    }
    if (end < 0) continue;
    const body = src.slice(open, end + 1);
    const keys = new Set();
    // 表里的字段名（`字段:` 出现在对象里，且必须不是标识符的一部分）
    for (const mm of body.matchAll(/(?:^|[\s{,])([A-Za-z_]\w*)\s*:/gm)) keys.add(mm[1]);
    for (const k of keys) {
      if (EXEMPT_FIELDS.has(k)) continue;
      // 读数 = 全仓库（除声明它的那张表之外）的出现次数。0 = 没人读。
      let elsewhere = countIn(typesSrc, k);
      for (const f of files) if (f !== file) elsewhere += countIn(code[f], k);
      if (elsewhere === 0) out.push(file + ' → ' + k + '（这张表声明了它，全仓库没有第二处引用）');
    }
  }
  return [...new Set(out)].sort();
}
/* 豁免：身份与文案字段天然只在表里出现 */
const EXEMPT_FIELDS = new Set(['id', 'name', 'en', 'desc', 'note', 'text', 'read', 'color', 'dark', 'projColor']);

/* ---------------- 汇总 ---------------- */
function analyze() {
  const mods = scanModules();
  const fanIn = countFanIn(mods);
  const cycles = findCycles(mods);
  const unused = findUnusedExports(mods);
  const aliasMap = namespaceAliases(mods);
  const members = findDeadMembers(mods, aliasMap);
  const typesLines = read(path.join(SRC, 'types.d.ts')).split('\n').length;

  return {
    files, mods, fanIn, cycles, aliasMap, members, typesLines,
    unusedImports: findUnusedImports(mods),
    unreadFields: findUnreadFields(),
    unused, apiSizes: apiSizes(),
    totalLoc: files.reduce((a, f) => a + mods[f].loc, 0),
    dataSizes: {
      weapons: listSize('data_weapons.ts', 'W.LIST ='),
      items: listSize('data_items.ts', 'I.LIST ='),
      chars: listSize('data_chars.ts', 'C.LIST ='),
      enemies: listSize('enemies.ts', 'E.LIST =')
    },
    systems: systemEdges(mods)
  };
}

/* ---------------- 输出 ---------------- */
function main() {
  const A = analyze();
  const { mods, fanIn, cycles, files: F } = A;

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({
      mods, fanIn, cycles, unused: A.unused,
      apiSizes: A.apiSizes,
      dead: A.members.dead,
      systems: Object.fromEntries(Object.entries(A.systems.edges)
        .map(([k, v]) => [k, v.list])),
      violations: A.systems.violations.map(v => v.from + ' → ' + v.to)
    }, null, 2));
    return;
  }

  console.log('=== Bronana · 架构体检 ===\n');
  console.log('[1] 模块规模与耦合（按代码行倒序）\n');
  console.log('  ' + '模块'.padEnd(16) + '行数'.padStart(6) + '代码行'.padStart(8) +
    '扇入'.padStart(6) + '扇出'.padStart(6) + '  依赖 →');
  for (const f of F.slice().sort((a, b) => mods[b].loc - mods[a].loc)) {
    const m = mods[f];
    console.log('  ' + f.padEnd(16) + String(m.loc).padStart(6) + String(m.code).padStart(8) +
      String(fanIn[f]).padStart(6) + String(m.deps.length).padStart(6) + '  ' + m.deps.join(', '));
  }
  console.log('\n  合计 ' + A.totalLoc + ' 行 / ' + F.length + ' 个模块；types.d.ts ' + A.typesLines + ' 行');
  const big = F.filter(f => mods[f].loc > 700).map(f => f + '(' + mods[f].loc + ')');
  console.log('  超过 700 行的模块：' + (big.length ? big.join('、') : '无'));
  const hub = F.filter(f => fanIn[f] >= 8).map(f => f + '(' + fanIn[f] + ')');
  console.log('  被 ≥8 个模块依赖的（扇入≥8）：' + (hub.length ? hub.join('、') : '无'));

  console.log('\n[2] 依赖图\n');
  console.log('  环：' + (cycles.length ? cycles.join(' | ') : '无 ✔'));

  const hotspots = F.map(f => ({ f, n: mods[f].stringBranches.length }))
    .filter(x => x.n > 0).sort((a, b) => b.n - a.n);
  console.log('\n[3] 类型字符串分支（开闭原则热点：新增一种就多一个分支）\n');
  for (const h of hotspots) {
    const kinds = [...new Set(mods[h.f].stringBranches)];
    console.log('  ' + h.f.padEnd(16) + String(h.n).padStart(4) + ' 处   ' + kinds.slice(0, 14).join(' '));
  }

  console.log('\n[4] 注册表 / 扩展点\n');
  const extCount = {};
  for (const f of F) for (const r of mods[f].registryCalls) extCount[r] = (extCount[r] || 0) + 1;
  console.log('  扩展点调用次数：' + Object.entries(extCount).map(([k, v]) => k + ' ×' + v).join('  ·  '));
  console.log('  数据表规模：武器 ' + A.dataSizes.weapons + ' 件 · 道具 ' + A.dataSizes.items +
    ' 件 · 角色 ' + A.dataSizes.chars + ' 种 · 怪物 ' + A.dataSizes.enemies + ' 种');

  console.log('\n[5] 全局接口规模（接口隔离体检，方法+字段 ≥8 的）\n');
  for (const a of A.apiSizes.slice(0, 14)) {
    console.log('  ' + a.name.padEnd(22) + '方法 ' + String(a.methods).padStart(3) +
      '  字段 ' + String(a.fields).padStart(3));
  }

  console.log('\n[6] `any` 用量（类型安全漏洞位置）\n');
  const anyRank = F.map(f => ({ f, n: mods[f].anyCount })).filter(x => x.n > 0).sort((a, b) => b.n - a.n);
  console.log('  ' + (anyRank.length ? anyRank.map(x => x.f + ' ' + x.n).join('  ·  ') : '无'));

  console.log('\n[7] 死接口 / 内部成员（文本近似：全仓库没人按名字引用）\n');
  const deadAll = A.unused.dead.concat(A.members.dead);
  console.log('  【真死，可删】' + (deadAll.length ? '' : ' 无 ✔'));
  if (deadAll.length) console.log(deadAll.map(u => '    ' + u).join('\n'));
  const internals = A.unused.internal.concat(A.members.internal);
  console.log('  【只在本文件内用】' + internals.length + ' 个（不算死，只是不必对外声明）');
  if (internals.length) console.log('    ' + internals.join('  ·  '));
  console.log('  【静态判不了：经字符串 / 动态派发引用】' + A.members.dynamic.length + ' 个');
  if (A.members.dynamic.length) console.log('    ' + A.members.dynamic.join('  ·  '));

  /* [8] 系统分层 —— 这一节回答的是"项目有没有按系统搭" */
  console.log('\n[8] 系统分层（模型在 tools/systems.cjs；只允许 高层 → 低层）\n');
  console.log('  层 系统                  模块  代码行  依赖的系统');
  for (const s of SYSTEMS) {
    const code = s.modules.reduce((a, m) => a + (mods[m] ? mods[m].code : 0), 0);
    const to = Object.values(A.systems.edges).filter(e => e.from === s.id)
      .sort((a, b) => BY_ID[b.to].level - BY_ID[a.to].level);
    console.log('  ' + String(s.level).padStart(2) + ' ' + s.name.padEnd(18) +
      String(s.modules.length).padStart(5) + String(code).padStart(8) + '  ' +
      (to.map(e => e.to + '(' + e.list.length + ')').join(' ') || '—'));
  }
  const inner = [];
  for (const s of SYSTEMS) {
    let n = 0;
    for (const m of s.modules) for (const d of (mods[m] ? mods[m].deps : [])) if (SYS_OF[d] === s.id) n++;
    inner.push(s.id + ' ' + n);
  }
  console.log('\n  组内边：' + inner.join(' · ') + '（组内是系统的内部结构，不算跨系统耦合）');
  if (A.systems.unassigned.length) {
    console.log('  ⚠ 没归组的模块：' + A.systems.unassigned.join(', '));
  }
  console.log('\n  向上的边（低层认识高层）—— 必须逐条登记理由：');
  if (!A.systems.violations.length) console.log('    无 ✔');
  for (const v of A.systems.violations) {
    const ex = EXCEPTIONS.find(e => e.from === v.from && e.to === v.to);
    console.log('    ' + BY_ID[v.from].name + ' → ' + BY_ID[v.to].name + '  ' + v.list.join(' '));
    console.log('      ' + (ex ? '已登记：' + ex.why : '⚠ **未登记**（test/arch.mjs 会红）'));
  }
  const unusedEx = EXCEPTIONS.filter(e =>
    !A.systems.violations.some(v => v.from === e.from && v.to === e.to));
  if (unusedEx.length) {
    console.log('  已登记但当前并不存在的例外（可以删了）：' +
      unusedEx.map(e => e.from + '→' + e.to).join(', '));
  }

  /* [9] 声明了却没人用 —— 数据表字段与 import
     这一节补的是前八节都够不到的两类**无声的谎**：
       · 数据表上写着一个字段，全仓库没有一处读它（`pickTier` 曾经 13 条）
       · `import { X }` 而 X 从没被用过（一条假的依赖边 + 一份假的"我认识它"） */
  console.log('\n[9] 声明了却没人用（数据表字段 / import）\n');
  console.log('  数据表字段：' + (A.unreadFields.length ? '' : '无 ✔'));
  for (const u of A.unreadFields) console.log('    ✗ ' + u);
  console.log('  未使用的具名 import：' + (A.unusedImports.length ? '' : '无 ✔'));
  for (const u of A.unusedImports) console.log('    ✗ ' + u);
  console.log('');
}

module.exports = { analyze, SYSTEMS, EXCEPTIONS, BY_ID, SYS_OF };

if (require.main === module) main();
