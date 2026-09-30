/* =========================================================
   test/yaml.mjs — YAML 校验器自己的测试
   ---------------------------------------------------------
   为什么一个"校验器"还需要测试：**一条永远不会红的校验比没有校验更坏**
   （这个项目栽过五次同类跟头）。所以这里守两件事：
     · 它解析对了没有（好样本必须过、结构必须逐字段对）
     · 它**抓不抓得到**坏东西（每个坏样本都必须红，而且报的原因要对得上）
   第二件才是重点。
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { parse, selfTest, FIXTURES, RULES } from '../tools/yaml-check.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
let failures = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  \x1b[32mPASS\x1b[0m ' + label);
  else { failures++; console.log('  \x1b[31mFAIL\x1b[0m ' + label + (extra !== undefined ? '  → ' + extra : '')); }
}

console.log('\n=== Bronana · YAML 校验器 ===\n');

/* ---------------- 1. 解析：好样本必须过 ---------------- */
console.log('[1] 解析好样本');
{
  const r = parse([
    'name: CI',
    'on:',
    '  push:',
    '    branches: [main, dev]',
    'jobs:',
    '  verify:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - name: 取代码',
    '        uses: actions/checkout@v7',
    '      - run: |',
    '          echo 第一行',
    '          echo 第二行'
  ].join('\n'));
  ok(r.errors.length === 0, '没有解析错误', r.errors.map(e => e.msg).join('；'));
  ok(r.doc.name === 'CI', '顶层标量解析对了', r.doc.name);
  ok(Array.isArray(r.doc.on.push.branches) && r.doc.on.push.branches.length === 2,
    '内联数组解析成数组', JSON.stringify(r.doc.on && r.doc.on.push));
  ok(r.doc.jobs.verify['runs-on'] === 'ubuntu-latest', '嵌套映射的键解析对了');
  const steps = r.doc.jobs.verify.steps;
  ok(Array.isArray(steps) && steps.length === 2, 'steps 是长度 2 的序列', JSON.stringify(steps && steps.length));
  ok(steps[0].name === '取代码' && steps[0].uses === 'actions/checkout@v7',
    '序列项里的映射（`- name:` 起头，后续同缩进的键属于它）',
    JSON.stringify(steps[0]));
  ok(typeof steps[1].run === 'string' && steps[1].run.indexOf('第一行') >= 0 &&
    steps[1].run.indexOf('第二行') >= 0, '块标量 `|` 保留了多行内容', JSON.stringify(steps[1].run));
}

/* ---------------- 2. 解析：坏样本必须红 ---------------- */
console.log('\n[2] 坏样本必须被拒（**这是本文件最要紧的一节**）');
{
  ok(FIXTURES.bad.length >= 6, '坏样本语料够多（' + FIXTURES.bad.length + ' 条）');
  const missed = [];
  const wrongReason = [];
  for (const f of FIXTURES.bad) {
    const r = parse(f.text);
    if (!r.errors.length) { missed.push(f.name); continue; }
    const joined = r.errors.map(e => e.msg).join('；');
    if (f.must && !f.must.test(joined)) wrongReason.push(f.name + '（实际报：' + joined + '）');
  }
  ok(missed.length === 0, '每个坏样本都被拒了（' + FIXTURES.bad.length + ' 条）', missed.join(' | '));
  ok(wrongReason.length === 0, '拒的原因与预期对得上（不是"碰巧报了个别的错"）', wrongReason.join(' | '));
}

/* ---------------- 3. 解析器不瞎猜：不支持的语法要报错 ---------------- */
console.log('\n[3] 不支持的语法必须显式报错（不做"尽力而为"的解析）');
{
  const cases = [
    ['文档分隔符', '---\na: 1', /文档分隔符/],
    ['锚点', 'a: &x 1', /不支持的 YAML 语法|锚点/],
    ['多行内联数组', 'a: [1,\n 2]', /内联数组|跨行/],
    ['TAB 缩进', 'a:\n\tb: 1', /TAB/]
  ];
  for (const [name, text, re] of cases) {
    const r = parse(text);
    ok(r.errors.length > 0 && re.test(r.errors.map(e => e.msg).join('；')),
      '「' + name + '」被报出来', r.errors.map(e => e.msg).join('；') || '（没报）');
  }
}

/* ---------------- 4. 自证语料本身没漂 ---------------- */
console.log('\n[4] 自证（工具每次运行都会跑的那一遍）');
{
  const s = selfTest();
  ok(s.ok, '自证通过（' + s.counts.good + ' 好 / ' + s.counts.bad + ' 坏）', s.problems.join(' | '));
}

/* ---------------- 5. 真实仓库文件 ---------------- */
console.log('\n[5] 仓库里真实的 GitHub 配置');
{
  const ci = path.join(ROOT, '.github', 'workflows', 'ci.yml');
  ok(fs.existsSync(ci), '.github/workflows/ci.yml 存在');
  const r = parse(fs.readFileSync(ci, 'utf8'));
  ok(r.errors.length === 0, 'CI 工作流解析无错', r.errors.map(e => e.msg).join('；'));
  ok(r.doc && r.doc.name === 'CI', 'CI 的名字是 CI', r.doc && r.doc.name);
  /* ⚠ YAML 1.1 里裸 `on` 会被当成布尔 true —— GitHub 按 YAML 1.2 处理，
     所以它确实是字符串键 `"on"`。这里把它钉住，免得哪天换解析器踩坑。 */
  ok(!!r.doc.on && typeof r.doc.on === 'object', '`on:` 是字符串键（不是布尔 true）',
    JSON.stringify(r.doc && r.doc.on));
  const steps = r.doc.jobs.verify.steps;
  ok(Array.isArray(steps) && steps.length >= 8, 'CI 的 steps 是序列且有 ' + (steps && steps.length) + ' 步');
  const uses = steps.filter(s => s.uses).map(s => s.uses);
  ok(uses.length === 3, '三个 action 步骤', JSON.stringify(uses));
  for (const u of uses) {
    ok(/@v\d+$/.test(u), 'uses 固定在 major 版本：' + u, u);
  }
  ok(steps.every(s => !s.uses || s.uses !== 'actions/checkout@main'),
    '没有指向分支的 uses（分支会漂）');

  /* issue 模板 */
  for (const f of ['bug_report.yml', 'feature_request.yml']) {
    const p = path.join(ROOT, '.github', 'ISSUE_TEMPLATE', f);
    ok(fs.existsSync(p), 'ISSUE_TEMPLATE/' + f + ' 存在');
    const rr = parse(fs.readFileSync(p, 'utf8'));
    ok(rr.errors.length === 0, f + ' 解析无错', rr.errors.map(e => e.msg).join('；'));
    ok(!!(rr.doc && rr.doc.name), f + ' 有 name');
    ok(Array.isArray(rr.doc && rr.doc.body), f + ' 的 body 是序列');
    const bad = (rr.doc.body || []).filter(el => !el || !el.type || !el.attributes);
    ok(bad.length === 0, f + ' 的每一项都有 type 与 attributes', JSON.stringify(bad));
  }
}

/* ---------------- 6. 规则表本身 ---------------- */
console.log('\n[6] 规则表');
{
  ok(RULES.length >= 4, '规则数量够（' + RULES.length + ' 条）');
  const ids = RULES.map(r => r.id);
  ok(new Set(ids).size === ids.length, '规则 id 不重复', ids.join(','));
  ok(RULES.every(r => r.note && r.note.length > 10), '每条规则都写了它对着哪类故障');
  /* 作用域：漏写 `for` 会让规则跑到不该跑的文件上（第一版就踩过） */
  ok(RULES.every(r => r.for === 'workflow' || r.for === 'template' || r.for === 'any'),
    '每条规则都声明了作用域（for）', RULES.map(r => r.id + '=' + r.for).join(','));
}

console.log('\n=== 结果 ===');
if (failures) { console.log(failures + ' 项失败 ✘\n'); process.exit(1); }
console.log('全部通过 ✔\n');
