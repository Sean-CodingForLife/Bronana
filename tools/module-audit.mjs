/* =========================================================
   module-audit.mjs — **逐模块 / 逐家族合规表**
   ---------------------------------------------------------
   起因："把每一个功能都对照 *高内聚低耦合 + 数据表驱动 + 注册表 + 自检 +
   测试 + 审计尺子* 逐项检查（含 God object、死接口、扇形依赖、
   类型字符串分支热点），凡不达标的彻底改造。"

   `arch-audit.cjs` 已经答了一半（环 / 真死代码 / 未读字段 / 未用 import /
   分层方向 / 字符串分支热点）。这里补另一半：**逐个模块与逐个家族**回答
   "它有没有守卫"，以及"它是不是长成了 God object"。

   ## 第一版判错过一次，那次教训是这份工具的核心

   第一版的红线是"有 `Registry.family` 却没有 `X.audit`" —— 跑出 **9 个模块 ✘**。
   那是**假阳**：`SelfCheck.scan()` 的**最后一步就是 `Registry.audit()`**
   （`selfcheck.ts` 第 82~90 行），它守两件事：
     · 每个家族的 id **不空、不重复**
     · 每条**跨表引用**的值必须真的在目标家族里
   于是 —— **只要一个家族被别处引用，它就已经有了启动期的守卫**。
   在它之外再要求每个模块写自己的 audit，是在要求**重复的守卫**。

   判据因此改成问真正有用的那一句：
     **"这个家族有没有任何一处会在启动期检查它的值？"**

     | 守卫来源 | 判据 | 结论 |
     |---|---|---|
     | 模块自检 | 有 `X.audit` 且登记进 `SelfCheck` | 有 ✔ |
     | 跨表引用 | 别的模块在 `refs` 里引用了这个家族 | 有 ✔（`Registry.audit` 守） |
     | 两者都没有 | — | **真的没人守**（红） |

   一个谁都不引用的家族，值域写错了要等**玩家遇到那个 bug** 才发现 ——
   这才是值得修的洞。

   ## 两条纪律

     1. **不是所有模块都该六条齐全**。`utils.ts` 是纯函数，没有"表不自洽"
        这种失败模式；它没有 audit 是**正常**的。所以红线画在**家族**上，不画在模块上。
     2. **扇出高不等于 God object**。模拟内核本来就认识很多东西；
        要判的是"它**替别人做了决定**，还是把大家叫到一起" —— 那要读代码，
        不能靠数。所以扇出与分支数只**报数**，不判罪。
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');
const JSON_OUT = process.argv.includes('--json');

const files = fs.readdirSync(SRC).filter(f => f.endsWith('.ts') && f !== 'types.d.ts').sort();
const raw = Object.create(null);
for (const f of files) raw[f] = fs.readFileSync(path.join(SRC, f), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const code = Object.create(null);
for (const f of files) code[f] = strip(raw[f]);

const readAll = (dir) => {
  const out = Object.create(null);
  for (const f of fs.readdirSync(path.join(ROOT, dir))) {
    if (/\.(mjs|cjs)$/.test(f)) out[f] = fs.readFileSync(path.join(ROOT, dir, f), 'utf8');
  }
  return out;
};
const testSrc = readAll('test');
const toolSrc = readAll('tools');
const wordRe = (base) => new RegExp('\\b' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
const mentionTests = (base) => Object.keys(testSrc).filter(t => wordRe(base).test(testSrc[t]));
const mentionTools = (base) => Object.keys(toolSrc).filter(t => wordRe(base).test(toolSrc[t]));

/* ---------------- 1. 逐模块的事实 ---------------- */
const rows = [];
for (const f of files) {
  const s = raw[f], c = code[f];
  const base = f.replace(/\.ts$/, '');
  /* 声明表：`var NAME = [` / `var NAME: T[] = [`（**代码里**，注释不算）。
     只收全大写名 —— 那正是本项目的表命名约定，收小写会把普通数组也算进来。 */
  const tables = [...c.matchAll(/^\s*var\s+([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=\s*\[/gm)].map(m => m[1]);
  const declares = [...c.matchAll(/Registry\.family\(\s*'([^']+)'/g)].map(m => m[1]);
  const audits = [...c.matchAll(/([A-Za-z_$][\w$]*)\.audit\s*=\s*function/g)].map(m => m[1]);
  const registers = [...c.matchAll(/SelfCheck\.register\(\s*'([^']+)'/g)].map(m => m[1]);
  /* 跨表引用：`family: 'xxx'` 出现在 refs 里（也可能只是字段名，但那一栏也叫 family，
     所以按同一形状收，宁可多收也不漏 —— 多收只会让"有守卫"判得宽一点） */
  const refsTo = [...c.matchAll(/family:\s*'([^']+)'/g)].map(m => m[1]);
  const usesFields = [...c.matchAll(/Registry\.uses\(\s*'([^']+)'/g)].map(m => m[1]);
  const strLits = new Set([...c.matchAll(/[!=]==?\s*'([a-zA-Z][\w-]{1,20})'/g)].map(m => m[1]));
  const exp = /export\s*\{([^}]*)\}/.exec(c);
  const exportsN = exp ? exp[1].split(',').map(x => x.trim()).filter(Boolean).length : 0;
  rows.push({
    file: f, base, loc: s.split('\n').length, codeLoc: c.split('\n').filter(l => l.trim()).length,
    tables, declares, audits, registers, refsTo, usesFields,
    tests: mentionTests(base), tools: mentionTools(base),
    strBranches: strLits.size, exportsN
  });
}

/* ---------------- 2. 家族 → 它有几道启动期守卫 ---------------- */
/* 所有家族名：声明处 + 被引用的目标（引用目标可能声明在别处，也要收） */
const allFams = new Set();
for (const r of rows) { for (const d of r.declares) allFams.add(d); for (const t of r.refsTo) allFams.add(t); }
/* 哪些模块的 audit 登记进了 SelfCheck（那才是"启动期会跑"的守卫） */
const registeredAudits = new Set();
for (const r of rows) if (r.registers.length) for (const a of r.audits) registeredAudits.add(r.file + ':' + a);
/* 哪些模块有 audit（不论登记与否 —— 未登记的那一类单独报） */
const hasAnyAudit = new Set(rows.filter(r => r.audits.length).map(r => r.file));

const fams = [];
for (const name of [...allFams].sort()) {
  const declarers = rows.filter(r => r.declares.indexOf(name) >= 0);
  const referencedBy = rows.filter(r => r.refsTo.indexOf(name) >= 0 && r.declares.indexOf(name) < 0);
  const usesBy = rows.filter(r => r.usesFields.length && r.declares.some(d => d.indexOf(name) >= 0));
  const moduleAudit = declarers.filter(r => r.audits.length && r.registers.length).map(r => r.file);
  fams.push({
    name, declarers: declarers.map(r => r.file),
    moduleAudit, referencedBy: referencedBy.map(r => r.file),
    /* 两道门都算守卫：模块自检、或"被别处引用"（于是 Registry.audit 会查到它） */
    guarded: moduleAudit.length > 0 || referencedBy.length > 0,
    via: moduleAudit.length ? 'selfcheck' : (referencedBy.length ? 'crossref' : 'none')
  });
}

/* ---------------- 3. 判定 ---------------- */
const unguarded = fams.filter(f => !f.guarded);
const auditNotRegistered = rows.filter(r => r.audits.length && !r.registers.length);
const untested = rows.filter(r => !r.tests.length && !r.tools.length);
const tableNoFamily = rows.filter(r => r.tables.length > 0 && !r.declares.length);
const big = rows.filter(r => r.codeLoc > 700).sort((a, b) => b.codeLoc - a.codeLoc);
const branchy = rows.slice().sort((a, b) => b.strBranches - a.strBranches).filter(r => r.strBranches >= 10).slice(0, 8);

if (JSON_OUT) {
  console.log(JSON.stringify({
    rows, fams,
    unguarded: unguarded.map(f => f.name),
    auditNotRegistered: auditNotRegistered.map(r => r.file),
    untested: untested.map(r => r.file)
  }, null, 1));
  process.exit(0);
}

const PAD = (s, n) => { s = String(s); return s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 127 ? 2 : 1), 0))); };
const PADL = (s, n) => ' '.repeat(Math.max(0, n - String(s).length)) + String(s);

console.log('\n=== Bronana · 逐模块 / 逐家族合规表 ===\n');
console.log('  ' + rows.length + ' 个模块 · ' + fams.length + ' 个家族\n');

console.log('[1] 逐模块（表=数据表 · 家=声明家族 · 检=有 audit · 登=登记进 SelfCheck · 测=提到它的测试/工具）\n');
console.log('  ' + PAD('模块', 22) + PADL('代码行', 7) + PADL('表', 4) + PADL('家', 4) +
  PADL('检', 4) + PADL('登', 4) + PADL('测', 4) + PADL('导出', 6) + PADL('字符串分支', 11));
for (const r of rows) {
  /* 这里的标记只用来说明"这个模块自己有没有守卫"；**没守卫不等于不合规** ——
     红线画在家族上（见 [2]），因为家族才是"值域"的载体 */
  const warn = (r.audits.length && !r.registers.length) ? ' \x1b[33m!\x1b[0m' :
    (!r.tests.length && !r.tools.length) ? ' \x1b[33m?\x1b[0m' : '';
  console.log('  ' + PAD(r.file, 22) + PADL(r.codeLoc, 7) +
    PADL(r.tables.length || '—', 4) + PADL(r.declares.length || '—', 4) +
    PADL(r.audits.length || '—', 4) + PADL(r.registers.length || '—', 4) +
    PADL((r.tests.length + r.tools.length) || '—', 4) +
    PADL(r.exportsN || '—', 6) + PADL(r.strBranches || '—', 11) + warn);
}

console.log('\n[2] 家族守卫（**红线画在这里**：值域有没有人守）\n');
const byVia = { selfcheck: [], crossref: [], none: [] };
for (const f of fams) byVia[f.via].push(f);
console.log('  \x1b[32m✔ 模块自检守 : ' + byVia.selfcheck.length + ' 个\x1b[0m（' +
  byVia.selfcheck.slice(0, 8).map(f => f.name).join(' ') + (byVia.selfcheck.length > 8 ? ' …' : '') + '）');
console.log('  \x1b[32m✔ 跨表引用守 : ' + byVia.crossref.length + ' 个\x1b[0m（`Registry.audit` 在启动期查：' +
  '别的模块引用了它 ⇒ 值写错就抛）');
console.log('  ' + (byVia.none.length ? '\x1b[31m✘ 没人守     : ' + byVia.none.length + ' 个\x1b[0m' : '\x1b[32m✔ 没人守     : 0 个\x1b[0m'));
if (byVia.none.length) {
  console.log('');
  for (const f of byVia.none) {
    console.log('    \x1b[31m✘\x1b[0m ' + PAD(f.name, 18) + '声明于 ' + f.declarers.join(',') +
      ' —— 没有任何一处会在启动期检查它的值');
  }
  console.log('\n    修法二选一：① 给它写一个 `audit` 并登记进 `SelfCheck`；');
  console.log('                ② 让真正消费它的那张表用 `refs` 引用它（那样 `Registry.audit` 就守住了）。');
}

console.log('\n[3] 硬性不合规\n');
if (!auditNotRegistered.length) console.log('  \x1b[32m✔ 有 audit 却没登记进 SelfCheck 的模块：无\x1b[0m');
else for (const r of auditNotRegistered) console.log('  \x1b[31m✘ ' + r.file + '（audit ' + r.audits.join(',') + '）—— 守卫不在必经之路上\x1b[0m');
if (!untested.length) console.log('  \x1b[32m✔ 没有任何测试/工具提到的模块：无\x1b[0m');
else for (const r of untested) console.log('  \x1b[33m! ' + r.file + ' —— 改坏了没人知道\x1b[0m');
if (!tableNoFamily.length) console.log('  \x1b[32m✔ 有声明表却没进总账的模块：无\x1b[0m');
else for (const r of tableNoFamily) console.log('  \x1b[33m! ' + r.file + '（表 ' + r.tables.join(',') + '）—— 表有了、跨表引用查不到它\x1b[0m');

console.log('\n[4] 提示（**不是错**，要读代码才判得了的那几条）\n');
console.log('  规模 > 700 代码行（God object 的**候选**，不是判决）：');
for (const r of big) {
  console.log('    ' + PAD(r.file, 22) + PADL(r.codeLoc, 6) + ' 行 · 导出 ' + PADL(r.exportsN, 3) +
    ' · 家族 ' + PADL(r.declares.length, 3) + ' · 字符串分支 ' + r.strBranches);
}
console.log('\n  字符串分支最多的几个（开闭原则热点：新增一种就多一个分支）：');
for (const r of branchy) console.log('    ' + PAD(r.file, 22) + PADL(r.strBranches, 4) + ' 种字面量');

console.log('\n[5] 怎么读这张表\n');
console.log('  · 红线画在**家族**上，不画在模块上。理由：家族是"值域"的载体，');
console.log('    "值写错了会不会有人拦"才是真的洞；而"这个模块有没有自己的 audit"');
console.log('    只是实现细节 —— `utils.ts` 是纯函数，它没有失败模式。');
console.log('  · **扇出高不等于 God object**。模拟内核本来就认识很多东西；要判的是');
console.log('    "它替别人做了决定，还是把大家叫到一起" —— 那要读代码，不能靠数。');
console.log('  · 这张表的价值在"**改了有没有人拦**"：家族守卫 + 模块自检 + 测试 = 三道门；');
console.log('    缺一道都还能跑，只是坏了会晚很久才发现。\n');

const hard = unguarded.length + auditNotRegistered.length;
console.log('=== 结果 ===');
console.log('  没人守的家族：' + unguarded.length + ' · 未登记的 audit：' + auditNotRegistered.length +
  ' · 未被测试提到：' + untested.length + ' · God object 候选：' + big.length);
console.log('  硬性不合规：' + hard + (hard ? ' \x1b[31m✘\x1b[0m' : ' \x1b[32m✔\x1b[0m'));
console.log('');
process.exit(0);
