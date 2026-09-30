/* =========================================================
   yaml-check.mjs — YAML 子集解析器 + GitHub 配置校验器
   ---------------------------------------------------------
   ## 为什么自己写一个

   起因很具体：要给仓库补 CI（`.github/workflows/ci.yml`）与 issue 模板，
   而本机**没有任何 YAML 解析器**（`node_modules` 里没有 `js-yaml` / `yaml`，
   本机的 python 也没装 `pyyaml`），项目又是**零运行时依赖**的——
   为一个校验器去装一个依赖，代价大于收益。

   更重要的理由：**"YAML 写错了"在这个项目里是一类真实故障**，
   而且它的症状特别差 —— GitHub 只会说"workflow 无效"，
   或者更糟：**它安静地不跑**。所以它值得一个能跑、能失败的校验，
   而不是"打开网页看一眼"。

   ## 它做什么

   1. **解析**：一个 YAML 子集（够覆盖 GitHub 的 workflow 与 issue 模板）。
      支持的语法写在 `SYNTAX` 那张表里，**不支持的会显式报错而不是猜** ——
      这条是刻意的：一个"默默解析成别的东西"的解析器比没有更危险。
   2. **校验**：一组带 id 的规则（`RULES`），每条都对着一类真实故障。
   3. **自证**：`FIXTURES` 是一批**必须被拒**的坏 YAML 加一批**必须通过**的好 YAML。
      每次运行都先跑它们。**如果坏 YAML 没被拒，工具自己就红** ——
      于是一条不会失败的校验不可能悄悄存在（这个项目栽过五次这种跟头）。
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const JSON_OUT = process.argv.includes('--json');

/* =========================================================
   1. 支持的语法（**写下来，因为"不支持的语法"要报错而不是猜**）
   ========================================================= */
const SYNTAX = [
  '`key: value` 与嵌套映射（靠缩进）',
  '`- item` 序列（`- ` 后可以跟 `key: value`，与下一行同缩进的键属于同一项）',
  '`|` / `|-` / `|+` / `>` 块标量（保留换行 / 折叠换行）',
  '`[a, b]` 单行内联数组（只收标量）',
  '`#` 行注释（整行或行尾，`#` 前必须有空白）',
  '`true` / `false` / `null` / `~` / 整数 / 小数 / 其余当字符串',
  '引号标量（`"..."` / `\'...\'`，其中引号内的 `#` 不当注释）'
];

/** 明确**不支持**的语法：碰到就报错，不做"尽力而为"的解析 */
const UNSUPPORTED = [
  '文档分隔符 `---` / `...`',
  '锚点与别名 `&a` / `*a`',
  '多行内联数组（跨行的 `[` … `]`）',
  '显式键 `? key`、标签 `!!str`、指令 `%YAML`'
];

/* =========================================================
   2. 解析
   ========================================================= */
function stripComment(s) {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    /* `#` 只在"前面是空白"时才是注释 —— 颜色码 `#fff` 不该被吃掉 */
    if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i);
  }
  return s;
}

function scalar(raw) {
  const t = raw.trim();
  if (t === '') return '';
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null' || t === '~') return null;
  if (/^-?\d+$/.test(t)) return parseInt(t, 10);
  if (/^-?\d*\.\d+$/.test(t)) return parseFloat(t);
  if (t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"') {
    return t.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"');
  }
  if (t.length >= 2 && t[0] === "'" && t[t.length - 1] === "'") return t.slice(1, -1).replace(/''/g, "'");
  if (t[0] === '[') {
    if (t[t.length - 1] !== ']') throw new Error('内联数组跨行（不支持）：' + t);
    const inner = t.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map(x => scalar(x));
  }
  return t;
}

/**
 * 解析一份 YAML。返回 `{ doc, errors }`（**不抛** —— 校验器要一次列全问题）。
 * 每个错误带 `line`（1 基）。
 */
export function parse(text) {
  const errors = [];
  const raw = text.replace(/\r\n?/g, '\n').split('\n');

  /* 预处理：去掉整行注释与空行，但保留行号；块标量在解析时另行处理 */
  const lines = [];
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i];
    if (/^\t|^ *\t/.test(line)) {
      errors.push({ line: i + 1, msg: '缩进里用了 TAB（YAML 只允许空格）' });
      continue;
    }
    const noComment = stripComment(line);
    if (!noComment.trim()) continue;
    if (/^---\s*$|^\.\.\.\s*$/.test(noComment.trim())) {
      errors.push({ line: i + 1, msg: '看到文档分隔符（不支持多文档 YAML）' });
      continue;
    }
    lines.push({ n: i + 1, indent: noComment.length - noComment.trimStart().length, text: noComment.trim() });
  }
  if (!lines.length) return { doc: null, errors };

  /* 递归下降。`pos` 用闭包游标 */
  let pos = 0;
  const peek = () => (pos < lines.length ? lines[pos] : null);

  function parseBlock(indent) {
    const first = peek();
    if (!first) return null;
    if (first.text.startsWith('- ') || first.text === '-') return parseSeq(indent);
    return parseMap(indent);
  }

  function parseSeq(indent) {
    const out = [];
    while (true) {
      const ln = peek();
      if (!ln || ln.indent < indent) break;
      if (ln.indent > indent && out.length) {
        errors.push({ line: ln.n, msg: '序列项的缩进比上一行深（同层项必须对齐）：' + ln.text });
        break;
      }
      if (!(ln.text.startsWith('- ') || ln.text === '-')) break;
      pos++;
      const rest = ln.text === '-' ? '' : ln.text.slice(2).trim();
      if (rest === '') {
        const next = peek();
        out.push(next && next.indent > indent ? parseBlock(next.indent) : null);
        continue;
      }
      /* `- key: value` 起一个映射项 */
      const m = rest.match(/^([^:\s][^:]*):(\s|$)/);
      if (m) {
        const itemIndent = indent + 2;
        /* 把这一行"还原"成映射的一行，交给 parseMap 处理（含它后续同缩进的兄弟键） */
        lines[pos - 1] = { n: ln.n, indent: itemIndent, text: rest };
        pos--;                                  // 退回去让 parseMap 读它
        out.push(parseMap(itemIndent));
        continue;
      }
      out.push(parseValueScalarOrBlock(rest, ln, indent));
    }
    return out;
  }

  function parseMap(indent) {
    const out = {};
    while (true) {
      const ln = peek();
      if (!ln || ln.indent < indent) break;
      if (ln.indent > indent) {
        errors.push({ line: ln.n, msg: '这一行的缩进比同级深，但上一行没有可以容纳它的键：' + ln.text });
        break;
      }
      if (ln.text.startsWith('- ')) break;
      const m = ln.text.match(/^([^:\s][^:]*):(\s|$)/);
      if (!m) { errors.push({ line: ln.n, msg: '不是 `key: value` 也不是序列项：' + ln.text }); break; }
      const key = m[1].trim();
      pos++;
      const afterColon = ln.text.slice(m[0].length).trim();
      if (Object.prototype.hasOwnProperty.call(out, key)) {
        errors.push({ line: ln.n, msg: '同一个映射里键重复：' + key });
      }
      if (afterColon === '') {
        const next = peek();
        out[key] = next && next.indent > indent ? parseBlock(next.indent) : null;
        continue;
      }
      out[key] = parseValueScalarOrBlock(afterColon, ln, indent);
    }
    return out;
  }

  /** 一个值：块标量（`|` / `>`）或普通标量 */
  function parseValueScalarOrBlock(text, ln, indent) {
    if (text === '|' || text === '|-' || text === '|+' || text === '>' || text === '>-' || text === '>+') {
      const fold = text[0] === '>';
      const chomp = text[1] === '-' ? 'strip' : (text[1] === '+' ? 'keep' : 'clip');
      const buf = [];
      let blockIndent = -1;
      while (pos < lines.length && lines[pos].indent > indent) {
        const b = lines[pos];
        if (blockIndent < 0) blockIndent = b.indent;
        buf.push(' '.repeat(b.indent - blockIndent) + b.text);
        pos++;
      }
      let s = fold ? buf.join(' ') : buf.join('\n');
      if (chomp === 'strip') s = s.replace(/\n+$/, '');
      else if (chomp === 'clip') s = s.replace(/\n+$/, '') + '\n';
      return s;
    }
    if (/^[&*]|^!!|^%/.test(text)) {
      errors.push({ line: ln.n, msg: '不支持的 YAML 语法（锚点/别名/标签/指令）：' + text });
      return null;
    }
    try { return scalar(text); }
    catch (e) { errors.push({ line: ln.n, msg: e.message }); return null; }
  }

  const doc = parseBlock(lines[0].indent);
  if (pos < lines.length) {
    errors.push({ line: lines[pos].n, msg: '解析结束后还有没被吃掉的行（多半是缩进不齐）：' + lines[pos].text });
  }
  return { doc, errors };
}

/* =========================================================
   3. 自证语料：**必须被拒的**与**必须通过的**
   ---------------------------------------------------------
   这是整个工具最重要的部分。每条坏样本都对应一类真实故障，
   而它会在**每次运行**时被验一遍 —— 所以"这条校验还灵不灵"是自动的。
   ========================================================= */
const FIXTURES = {
  /* --- 必须解析成功 --- */
  good: [
    { name: '嵌套映射 + 序列 + 块标量 + 内联数组', text: [
      'name: CI',
      'on:',
      '  push:',
      '    branches: [main]',
      'jobs:',
      '  verify:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - name: 取代码',
      '        uses: actions/checkout@v7',
      '      - name: 说明',
      '        run: |',
      '          echo 第一行',
      '          echo 第二行'
    ].join('\n') },
    { name: 'issue 模板那种 `- type:` 序列', text: [
      'name: 报告 Bug',
      'body:',
      '  - type: markdown',
      '    attributes:',
      '      value: |',
      '        第一段',
      '',
      '        第二段',
      '  - type: input',
      '    id: seed',
      '    validations:',
      '      required: true'
    ].join('\n') },
    { name: '行尾注释与引号里的 # 不算注释', text: [
      'a: 1 # 注释',
      'b: "值里有 # 号"',
      "c: '单引号 # 也是'",
      'd: "#8a6a4a"'
    ].join('\n') },
    { name: '空值（键后面什么都没有）', text: 'a:\nb: 2' },
    { name: '序列项里带映射（`- key: value`）', text: [
      'items:',
      '  - id: a',
      '    v: 1',
      '  - id: b',
      '    v: 2'
    ].join('\n') }
  ],

  /* --- 必须被拒（每条都要能指出问题所在） --- */
  bad: [
    { name: 'TAB 缩进', text: 'a:\n\tb: 1', must: /TAB/ },
    { name: '文档分隔符', text: '---\na: 1', must: /文档分隔符/ },
    { name: '锚点', text: 'a: &x 1\nb: *x', must: /不支持的 YAML 语法|锚点/ },
    { name: '内联数组跨行', text: 'a: [1,\n  2]', must: /内联数组|跨行/ },
    { name: '同一映射里键重复', text: 'a: 1\na: 2', must: /键重复/ },
    { name: '不是 key: value 的行', text: 'a: 1\n这不是键值对', must: /不是 `key: value`/ },
    { name: '同级缩进不齐', text: 'a:\n  b: 1\n   c: 2', must: /缩进|容纳/ },
    { name: '中文冒号被当成键分隔', text: 'a：1', must: /不是 `key: value`/ }
  ]
};

/**
 * 跑一遍自证语料。返回 `{ ok, problems }`。
 * 坏样本没被拒 / 好样本被拒，都算问题。
 */
export function selfTest() {
  const problems = [];
  for (const f of FIXTURES.good) {
    const r = parse(f.text);
    if (r.errors.length) {
      problems.push('好样本被误判为坏：【' + f.name + '】' + r.errors.map(e => '第' + e.line + '行 ' + e.msg).join('；'));
    }
  }
  for (const f of FIXTURES.bad) {
    const r = parse(f.text);
    const joined = r.errors.map(e => e.msg).join('；');
    if (!r.errors.length) problems.push('坏样本没被拒：【' + f.name + '】');
    else if (f.must && !f.must.test(joined)) {
      problems.push('坏样本被拒了，但报的原因不对：【' + f.name + '】期望匹配 ' + f.must + '，实际：' + joined);
    }
  }
  return { ok: problems.length === 0, problems, counts: { good: FIXTURES.good.length, bad: FIXTURES.bad.length } };
}

/* =========================================================
   4. 校验规则
   ---------------------------------------------------------
   每条规则带 id 与一句"它对着一类什么故障"。这样报错能说人话，
   而不是只丢一个"YAML 无效"。
   ========================================================= */
const ACTION_RE = /^[A-Za-z0-9_.\-]+\/[A-Za-z0-9_.\-]+(@[A-Za-z0-9_.\-]+)?$/;
/** 第三方 action 允许固定到 tag（`@v7`）或 SHA（40 位十六进制），不许指向分支 */
const OK_PIN = /@v\d+(\.\d+)*$|@[0-9a-f]{40}$/;

const RULES = [
  {
    id: 'workflow.top',
    /* ⚠ **规则必须声明它管哪类文件** —— 第一版没声明，于是它把 issue 模板
       也判成"顶层缺 on:/jobs:"（模板当然没有）。一个作用域没写清的规则
       会把自己的假阳当成真问题报出来，而"修"它的错误方式是把规则删掉。
       `for` 里的取值：`workflow` / `template` / `any`。 */
    for: 'workflow',
    note: '顶层缺 `name` / `on` / `jobs` 的工作流会被 GitHub 拒绝或**静默不触发**',
    check(file, doc, problems) {
      for (const k of ['name', 'on', 'jobs']) {
        if (!doc || !(k in doc)) problems.push(file + '：顶层缺 `' + k + ':`（GitHub 会拒绝或静默不触发）');
      }
    }
  },
  {
    id: 'workflow.runsOn',
    for: 'workflow',
    note: 'job 缺 `runs-on` 会直接报错；写错 runner 名字会永远排队',
    check(file, doc, problems) {
      const jobs = doc && doc.jobs;
      if (!jobs || typeof jobs !== 'object') return;
      for (const [id, job] of Object.entries(jobs)) {
        if (!job || typeof job !== 'object') { problems.push(file + '：job `' + id + '` 不是映射'); continue; }
        if (!job['runs-on']) problems.push(file + '：job `' + id + '` 缺 `runs-on`');
      }
    }
  },
  {
    id: 'workflow.actionPin',
    for: 'workflow',
    note: '`uses:` 指向分支（@main/@master）会在上游改动时**无预兆地改变行为**；写错仓库名则 CI 直接失败',
    check(file, doc, problems) {
      const jobs = (doc && doc.jobs) || {};
      for (const [id, job] of Object.entries(jobs)) {
        const steps = (job && job.steps) || [];
        if (!Array.isArray(steps)) continue;
        steps.forEach((s, i) => {
          if (!s || typeof s !== 'object' || !s.uses) return;
          const u = String(s.uses);
          if (!ACTION_RE.test(u)) { problems.push(file + '：job `' + id + '` 第 ' + (i + 1) + ' 步的 uses 不像一个 action 引用：' + u); return; }
          if (!u.includes('@')) { problems.push(file + '：uses 没写版本（' + u + '）—— 上游一改你就变'); return; }
          const pin = u.slice(u.indexOf('@'));
          if (!pin.startsWith('@./') && !OK_PIN.test(pin)) {
            problems.push(file + '：uses ' + u + ' 没固定到版本/SHA（分支会漂；40 位 SHA 最稳）');
          }
        });
      }
    }
  },
  {
    id: 'workflow.stepsIsList',
    for: 'workflow',
    note: '`steps:` 写成映射（漏了 `- `）会让 workflow 无效',
    check(file, doc, problems) {
      const jobs = (doc && doc.jobs) || {};
      for (const [id, job] of Object.entries(jobs)) {
        if (job && job.steps !== undefined && !Array.isArray(job.steps)) {
          problems.push(file + '：job `' + id + '` 的 steps 不是序列（每个步骤前面要有 `- `）');
        }
      }
    }
  },
  {
    id: 'issueTemplate.body',
    for: 'template',
    note: 'issue 模板缺 `body` 或某项缺 `type` 会在 GitHub 上**渲染失败**（模板列表里看不见它）',
    check(file, doc, problems) {
      if (!doc || !('name' in doc)) problems.push(file + '：issue 模板缺 `name`');
      if (!Array.isArray(doc && doc.body)) { problems.push(file + '：issue 模板缺 `body`（或它不是序列）'); return; }
      doc.body.forEach((el, i) => {
        if (!el || typeof el !== 'object') { problems.push(file + '：body 第 ' + (i + 1) + ' 项不是映射'); return; }
        if (!el.type) { problems.push(file + '：body 第 ' + (i + 1) + ' 项缺 `type`'); return; }
        if (!el.attributes || typeof el.attributes !== 'object') {
          problems.push(file + '：body 第 ' + (i + 1) + ' 项（' + el.type + '）缺 `attributes`');
        }
        if (el.type === 'textarea' && el.attributes && el.id === undefined && el.attributes.label === undefined) {
          problems.push(file + '：body 第 ' + (i + 1) + ' 项的 textarea 既没有 id 也没有 label');
        }
      });
    }
  }
];

/** 这个文件属于哪一类（决定哪些规则跑在它上面） */
function kindOf(rel) {
  if (/^\.github\/ISSUE_TEMPLATE\//.test(rel)) return 'template';
  if (/^\.github\/workflows\//.test(rel)) return 'workflow';
  return 'any';
}

export { FIXTURES, RULES, SYNTAX, UNSUPPORTED, kindOf };

/* =========================================================
   5. 跑：先自证，再校验仓库里的 YAML
   ---------------------------------------------------------
   ⚠ 这一段只在**直接运行本文件时**执行（末尾有主模块判定）。
   这样 `test/yaml.mjs` 才能 import 上面的解析器与语料而不触发 CLI ——
   否则"工具"与"库"混在一起，测试一 import 就会 process.exit。
   ========================================================= */
function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.ya?ml$/.test(e.name)) out.push(p);
  }
  return out;
}

function main() {
  const targets = walk(path.join(ROOT, '.github'), []);
  const self = selfTest();
  const problems = [];
  const perFile = [];

  for (const abs of targets) {
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    const kind = kindOf(rel);
    const text = fs.readFileSync(abs, 'utf8');
    const { doc, errors } = parse(text);
    const fileProblems = [];
    for (const e of errors) fileProblems.push(rel + ':' + e.line + ' ' + e.msg);
    /* 只跑**适用**的规则：作用域在规则里声明（见 RULES 里 workflow.top 的注释） */
    for (const r of RULES) {
      if (r.for !== 'any' && r.for !== kind) continue;
      r.check(rel, doc, fileProblems);
    }
    perFile.push({ file: rel, kind: kind, problems: fileProblems, ok: fileProblems.length === 0 });
    problems.push.apply(problems, fileProblems);
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ selfTest: self, files: perFile, syntax: SYNTAX, unsupported: UNSUPPORTED }, null, 1));
    process.exit(self.ok && problems.length === 0 ? 0 : 1);
  }

  const PAD = (s, n) => { s = String(s); let w = 0; for (const c of s) w += c.charCodeAt(0) > 127 ? 2 : 1; return s + ' '.repeat(Math.max(0, n - w)); };

  console.log('\n=== Bronana · YAML 校验（GitHub 配置）===\n');
  console.log('  支持的语法：');
  for (const s of SYNTAX) console.log('    · ' + s);
  console.log('  明确不支持（碰到就报错，不做"尽力而为"）：');
  for (const s of UNSUPPORTED) console.log('    · ' + s);

  console.log('\n[1] 自证语料（这条校验还灵不灵）');
  console.log('  ' + self.counts.good + ' 个好样本必须解析成功 · ' + self.counts.bad + ' 个坏样本必须被拒');
  if (!self.ok) {
    for (const p of self.problems) console.log('  \x1b[31m✘\x1b[0m ' + p);
  } else {
    console.log('  \x1b[32m✔ 全部符合预期\x1b[0m（坏样本都被拒，且报的原因对得上）');
  }

  console.log('\n[2] 仓库里的 YAML（' + targets.length + ' 个文件）');
  if (!targets.length) console.log('  \x1b[33m!\x1b[0m 一个都没找到 —— `.github/` 下没有 yml/yaml');
  for (const f of perFile) {
    console.log('  ' + (f.ok ? '\x1b[32m✔\x1b[0m' : '\x1b[31m✘\x1b[0m') + ' ' + PAD(f.file, 44) +
      (f.ok ? '' : f.problems.length + ' 个问题'));
    for (const p of f.problems) console.log('      ' + p);
  }

  console.log('\n[3] 规则（每条对着一类真实故障）');
  for (const r of RULES) console.log('  ' + PAD(r.id, 24) + '[' + r.for + '] ' + r.note);

  console.log('\n=== 结果 ===');
  console.log('  自证：' + (self.ok ? '\x1b[32m通过\x1b[0m' : '\x1b[31m失败\x1b[0m') +
    ' · 文件：' + perFile.filter(f => f.ok).length + '/' + perFile.length + ' 通过' +
    ' · 问题合计 ' + problems.length);
  console.log('');
  process.exit(self.ok && problems.length === 0 ? 0 : 1);
}

const invokedDirectly = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename || '');
if (invokedDirectly) main();

