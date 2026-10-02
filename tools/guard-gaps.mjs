/* =========================================================
   guard-gaps.mjs — 家族与模块的守卫（**判据只有两条，都能验证**）
   ---------------------------------------------------------
   ## 这段失败史比结论更值得读

   要回答的问题："每个家族的值域，有没有人守？" 我写了四版，前三版都判错：

     | 版本 | 做法 | 错在哪 |
     |---|---|---|
     | 1 | 红线 = "有 `Registry.family` 却没 `X.audit`" | 假阳 —— `Registry.audit()` 本来就守跨表引用 |
     | 2 | 守卫限定成"属性名恰好叫 `.audit`" | 假阳 —— `Comp.selfCheck` 等守卫不叫这名 |
     | 3 | 用 family 的 `owner`**模块名**匹配 `SelfCheck.names()` | 45/101 判错 —— 家族名与自检名不是一对一 |
     | 4（本版） | **只认两条能验证的规则** | —— |

   四版里有三版是**同一个病**：用文本形状或名字去猜运行时的语义。
   本版把判据收窄到两条，每条都能当场验证：

     **规则 A（模块自检）**：模块里有 `X.audit` **且** `SelfCheck.register`。
       验证方式：`SelfCheck.names()` 里能看到它的名字（运行时权威读数）。

     **规则 B（跨表引用）**：别的模块的 `entries()` 里 `refs` 指向这个家族。
       验证方式：`Registry.audit()` 会去 `Registry.ids(目标家族)` 里查那个值 ——
       所以**值写错就在启动期抛**。这是"被引用 ⇔ 被守"的真正机制。

   ⚠ 规则 B 有一个**必须写明的限度**：它只验"引用的值**存在**"，
   不验"表里每个条目的**其它字段**都有人读"。后者是 `data-contract` 的活
   （`test/data-contract.mjs` 扫"数据里被写成字符串的字段有没有家族"）。
   两道门各管一段，不要用其中一道的通过去代替另一道。
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import srcFiles from './src-files.cjs';
import { createRequire } from 'node:module';
const require2 = createRequire(import.meta.url);
const { SYSTEMS: SYSTEMS_FOR_PARITY } = require2('./systems.cjs');

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');
const JSON_OUT = process.argv.includes('--json');
/* `--strict`：把提示级（没人守的家族）也当成拦截条件。
   默认只拦缺陷级 —— 理由见文件末尾"结果"那一节。 */
const STRICT = process.argv.includes('--strict');

/* ⚠ 用共享扫描器（`tools/src-files.cjs`）而不是 `readdirSync(SRC)`：
   后者假定 `src/` 是平铺的 —— 一旦目录化，**子目录里的模块会被静默漏掉**，
   而本工具照样全绿。见 `src-files.cjs` 文件头的说明。 */
const relFiles = srcFiles.list().filter(f => !f.endsWith('.d.ts'));
/** 完整路径 → 裸文件名（本工具通篇按模块名讲话，报告里写 `game.ts` 更可读） */
const files = relFiles.map(srcFiles.relName);
const raw = Object.create(null);
const code = Object.create(null);
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
for (let i = 0; i < relFiles.length; i++) {
  const text = fs.readFileSync(path.join(SRC, relFiles[i]), 'utf8');
  raw[files[i]] = text;
  code[files[i]] = strip(text);
}

const readDir = (d) => {
  const o = Object.create(null);
  for (const f of fs.readdirSync(path.join(ROOT, d))) {
    if (/\.(mjs|cjs)$/.test(f)) o[f] = fs.readFileSync(path.join(ROOT, d, f), 'utf8');
  }
  return o;
};
const testSrc = readDir('test');
const toolSrc = readDir('tools');
const re = (b) => new RegExp('\\b' + b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');

/* ---------------- 逐模块 ---------------- */
const mods = [];
for (const f of files) {
  const c = code[f], base = f.replace(/\.ts$/, '');
  const declares = [...c.matchAll(/Registry\.family\(\s*'([^']+)'/g)].map(m => m[1]);
  /* ⚠ **守卫函数的名字不止 `.audit` 一种** —— 这是本工具的**第四处**同类错误：
     `scene.ts` 登记的是 `Scene.validate`、`comp.ts` 提供的是 `Comp.selfCheck`。
     只认 `.audit` 会把"已经有人守"判成"没人守"（假阴）。
     现在认这四种名字：`audit` / `validate` / `selfCheck` / `check`。
     仍然认不出的（比如自定义名）会落到规则 B（跨表引用）或如实报"没人守"。 */
  const GUARD_NAMES = 'audit|validate|selfCheck|check';
  const guardRe = new RegExp('([A-Za-z_$][\\w$]*)\\.(' + GUARD_NAMES + ')\\s*=\\s*function', 'g');
  const guards = [...c.matchAll(guardRe)].map(m => m[1] + '.' + m[2]);
  const audits = guards;
  const registers = [...c.matchAll(/SelfCheck\.register\(\s*'([^']+)'/g)].map(m => m[1]);
  /* 规则 B 的输入：这个模块的 entries 指向了哪些家族 */
  const refsTo = [...c.matchAll(/family:\s*'([^']+)'/g)].map(m => m[1]);
  const tables = [...c.matchAll(/^\s*var\s+([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=\s*\[/gm)].map(m => m[1]);
  mods.push({
    file: f, base, declares, audits, registers, refsTo, tables,
    codeLoc: c.split('\n').filter(l => l.trim()).length,
    tests: Object.keys(testSrc).filter(t => re(base).test(testSrc[t])),
    tools: Object.keys(toolSrc).filter(t => re(base).test(toolSrc[t])),
    /* 规则 A：有守卫函数且登记（**两个都要** —— 只写不登记等于不在必经之路上） */
    selfGuarded: audits.length > 0 && registers.length > 0
  });
}

/* ---------------- 逐家族 ---------------- */
const fams = new Set();
for (const m of mods) { for (const d of m.declares) fams.add(d); for (const t of m.refsTo) fams.add(t); }
const famRows = [...fams].sort().map(name => {
  const declarers = mods.filter(m => m.declares.indexOf(name) >= 0);
  const referencers = mods.filter(m => m.refsTo.indexOf(name) >= 0 && m.declares.indexOf(name) < 0);
  /* 规则 A：声明它的模块做了模块级自检 */
  const byAudit = declarers.filter(m => m.selfGuarded).map(m => m.file);
  /* 规则 B：被别的模块引用 → Registry.audit 在启动期查它的值 */
  const byRef = referencers.map(m => m.file);
  return {
    name, declarers: declarers.map(m => m.file), byAudit, byRef,
    guarded: byAudit.length > 0 || byRef.length > 0,
    how: byAudit.length && byRef.length ? '自检+引用' : (byAudit.length ? '自检' : (byRef.length ? '引用' : '—'))
  };
});

/* ---------------- 硬性缺陷与"运行期检查"的分界 ----------------
   ⚠ 这一节改过五次，前四次都是**同一个病**：用签名（"有没有参数"）去猜运行期语义。

     | 版本 | 判据 | 错在哪 |
     |---|---|---|
     | 1 | 有 audit 却没登记 = 缺陷 | 把 4 个模块报成红的 |
     | 2 | 按"第一个参数是否为空"分 | `Emit.audit()` 无参、却读模块级会话 `S` |
     | 3 | ……上面两版都只看了签名 | —— |
     | 4（本版）| **看函数体的两条结构事实** | —— |

   "无参"**只是必要条件**，不是充分条件。要真的能进启动期，还得满足两条，
   而这两条都能当场从源码里读出来：

     ① **返回 `{ok, problems}`**。`SelfCheck.scan()` 的约定是这个形状
        （`selfcheck.ts` 第 27 行的类型）：它只读 `r.ok`，所以
        `Emit.audit()` 返回的 `{duplicates, tracked}` 会被**静默当成通过**
        （`r.ok` 是 `undefined`）—— 登记它等于登记一道永远绿灯的假门。
     ② **无会话时能安全返回**（函数体开头有 `if (!S) return` 这类守卫）。
        `Emit.audit()` 直接读 `S.particles`，启动期 `S` 是 `undefined`，
        真登记进去会抛（`scan` 会把它catch成"自检本身抛了异常"）。

   两条都满足才是"能进启动期却没登记"的真缺陷。 */
const guardMeta = [];
/** 函数体开头（前 200 字符）里有没有"无会话就提前返回"的守卫 */
const hasBootGuard = (body) => /^\s*(if\s*\([^)]*!\s*[A-Za-z_$][\w$.]*[^)]*\)\s*(return|\{[\s\S]{0,80}?return)|if\s*\([^)]*==\s*null[^)]*\)\s*return)/.test(body.slice(0, 200));
/** 返回的是不是 `SelfCheck.scan()` 约定的 `{ok, problems}` */
const hasRightShape = (body) => /\bok\s*:/.test(body) && /\bproblems\s*:/.test(body);
for (const f of files) {
  const c = code[f];
  const reG = /([A-Za-z_$][\w$]*)\.(audit|validate|selfCheck|check)\s*=\s*function\s*\(([^)]*)\)\s*\{/g;
  let m;
  while ((m = reG.exec(c))) {
    const params = m[3].trim();
    /* 取函数体：从 `{` 起按花括号配平（跳过字符串里的括号足够用 —— 判据只看开头） */
    let depth = 1, i = reG.lastIndex, body = '';
    while (i < c.length && depth > 0) {
      const ch = c[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      if (depth > 0) body += ch;
      i++;
    }
    const shape = hasRightShape(body), safe = hasBootGuard(body);
    guardMeta.push({
      file: f, name: m[1] + '.' + m[2],
      noArgs: params === '',
      rightShape: shape,
      bootSafe: safe,
      /* 能进启动期 = 三条全中：无参 且 形状对 且 无会话时安全 */
      bootable: params === '' && shape && safe,
      /* 诊断用：说清楚它因为哪一条被排除 */
      why: params !== '' ? '带参数'
        : !shape ? '返回的不是 {ok, problems}（scan 会静默当成通过）'
          : '没有无会话时的提前返回（启动期会抛）'
    });
  }
}
/* 逐条写理由的豁免表。**空的** —— 有豁免就说明判据还不够准，
   宁可让它是红的让人来读，也不要用一张表把红压成绿。 */
const GUARD_EXEMPT = Object.create(null);
const notRegistered = [];
const runtimeOnly = [];
/* `registry.ts` 是**内置**自检：`SelfCheck.scan()` 的最后一步就是调 `Registry.audit()`
   （`selfcheck.ts` 第 82~90 行），所以它不需要也不该再 `SelfCheck.register`
   （`SelfCheck.BUILTIN` 里明确占着 'registry' 这个名字，重复登记会抛）。
   把它排除掉，这一栏才只剩真问题。 */
const BUILTIN_CHECKS = ['registry.ts'];
for (const f of files) {
  if (BUILTIN_CHECKS.indexOf(f) >= 0) continue;
  const c = code[f];
  const hasRegister = /SelfCheck\.register\(/.test(c);
  const my = guardMeta.filter(x => x.file === f);
  if (!my.length) continue;
  if (hasRegister) continue;
  const bootable = my.filter(x => x.bootable && !GUARD_EXEMPT[f + '::' + x.name]).map(x => x.name);
  const runtime = my.filter(x => !x.bootable).map(x => x.name + '（' + x.why + '）');
  if (bootable.length) notRegistered.push({ file: f, bootable });
  if (runtime.length) runtimeOnly.push({ file: f, names: runtime });
}
/* 黄：没有任何测试/工具提到（改坏了没人知道） */
const unguarded = famRows.filter(f => !f.guarded);
const untested = mods.filter(m => !m.tests.length && !m.tools.length);
/* 提示：有声明表但没进总账 */
const tableNoFamily = mods.filter(m => m.tables.length && !m.declares.length);
const big = mods.filter(m => m.codeLoc > 700).sort((a, b) => b.codeLoc - a.codeLoc);
/* 盘上的模块 vs 分层表（**每个文件都必须有人认领**）。
   算在这里而不是打印时 —— 它进"缺陷级"，所以必须在算 DEFECTS 之前就有值。
   这条是"目录化分层"的前置守卫：新文件放进子目录而忘了写进分层表，
   它就永远不会被"边只能高→低"覆盖。 */
const parity = srcFiles.parity(SYSTEMS_FOR_PARITY);
/* **缺陷级**：① 无参、能进启动期、却没登记（写了守卫但没接上必经之路）
   ② 盘上有文件没人认领 / 表里有模块盘上没有。
   `unguarded` 是提示级，理由见文件末尾。 */
const DEFECTS = notRegistered.length + parity.problems.length;

if (JSON_OUT) {
  console.log(JSON.stringify({ fams: famRows, unguarded: unguarded.map(f => f.name), notRegistered: notRegistered.map(m => m.file), untested: untested.map(m => m.file) }, null, 1));
  process.exit(0);
}

const PAD = (s, n) => { s = String(s); return s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 127 ? 2 : 1), 0))); };
const PADL = (s, n) => ' '.repeat(Math.max(0, n - String(s).length)) + String(s);

console.log('\n=== Teapot · 家族与模块守卫 ===\n');
console.log('  判据只有两条（都能当场验证）：');
console.log('    A 模块自检：模块里有 `X.audit` **且** `SelfCheck.register` 登记了它');
console.log('    B 跨表引用：别的模块的 `refs` 指向这个家族 ⇒ `Registry.audit()` 在启动期查它的值\n');
console.log('  ' + mods.length + ' 个模块 · ' + famRows.length + ' 个家族');
console.log('  守住的家族：' + (famRows.length - unguarded.length) + ' / ' + famRows.length +
  '（自检 ' + famRows.filter(f => f.how === '自检').length +
  ' · 引用 ' + famRows.filter(f => f.how === '引用').length +
  ' · 两道都有 ' + famRows.filter(f => f.how === '自检+引用').length + '）\n');

/* =========================================================
   [0] 盘上的模块 vs 分层表（**每个文件都必须有人认领**）
   ---------------------------------------------------------
   这条是"目录化分层"的前置守卫。此前没人对账过，于是有一个文件
   一直漂在体系外而没人发现：`types.d.ts`（盘上 66 个、表里 65 个）。
   它不算运行时模块，但**必须被明确登记为"不算"** ——
   否则下一次"盘上多一个文件"也会以同样的方式悄悄溜过去。

   目录化之后这条更重要：新文件放进 `src/sim/` 而忘了写进分层表，
   它就永远不会被分层检查覆盖（"边只能高→低"对它不成立）。
   ========================================================= */
console.log('[0] 模块与分层表对账（盘上 ' + parity.files.length + ' 个 .ts · 表里 ' +
  Object.keys(parity.declared).length + ' 个 · 明确不算的 ' +
  Object.keys(srcFiles.UNAFFILIATED).length + ' 个）\n');
if (parity.ok) console.log('  \x1b[32m✔ 每个文件都被认领了（在分层表里，或明确登记为"不算运行时模块"）\x1b[0m');
else for (const p of parity.problems) console.log('  \x1b[31m✘\x1b[0m ' + p);

console.log('\n[1] 没人守的家族（值域写错要等玩家遇到才发现）\n');
if (!unguarded.length) console.log('  \x1b[32m✔ 无\x1b[0m');
else {
  console.log('  ' + PAD('家族', 20) + PAD('声明于', 20) + '说明');
  for (const f of unguarded) console.log('  \x1b[31m✘\x1b[0m ' + PAD(f.name, 20) + PAD(f.declarers.join(','), 20) + '');
  console.log('');
  console.log('  修法二选一：① 给声明它的模块写 `audit` 并 `SelfCheck.register`；');
  console.log('              ② 让真正消费它的那张表用 `refs` 引用它（那样 Registry.audit 就守住了）。');
}

/* =========================================================
   [1b] 逐模块表（从已删除的 `module-audit.mjs` 并过来的）
   ---------------------------------------------------------
   那一份工具是这一份的**前一版**，判据是错的：它把
   `scene.ts` 的 4 个家族判成"没人守"（其实 `Scene.validate` + `SelfCheck.register`
   守着），把 `registry.ts` 判成"守卫不在必经之路上"（其实它是
   `SelfCheck.scan()` 的内置最后一步，重复登记会抛）。
   两份工具同时存在 = 必然有一份是错的，而人不知道该信哪一份。
   所以那一份**删掉了**，只把这里这张"逐模块速查表"并过来 ——
   它是那一份唯一不重复的价值。
   ========================================================= */
console.log('\n[1b] 逐模块速查（表=声明表 · 家=声明家族 · 检=有守卫函数 · 登=登记进 SelfCheck · 测=提到它的测试/工具）\n');
{
  console.log('  ' + PAD('模块', 22) + PADL('表', 4) + PADL('家', 4) + PADL('检', 4) + PADL('登', 4) + PADL('测', 4) +
    PADL('代码行', 7));
  const rows = mods.slice().sort((a, b) => (b.tables.length + b.declares.length) - (a.tables.length + a.declares.length));
  for (const m of rows) {
    if (!m.tables.length && !m.declares.length) continue;   // 只列"有表或家族"的
    const noGuard = !m.selfGuarded && m.declares.length;
    console.log('  ' + PAD(m.file, 22) +
      PADL(m.tables.length, 4) + PADL(m.declares.length, 4) + PADL(m.audits.length, 4) +
      PADL(m.registers.length, 4) + PADL(m.tests.length + m.tools.length, 4) + PADL(m.codeLoc, 7) +
      (noGuard ? '  \x1b[33m（有家族但模块级自检没登记 —— 靠引用守护）\x1b[0m' : ''));
  }
  console.log('  \x1b[90m注：「检」是守卫函数个数（audit/validate/selfCheck/check），' +
    '「登」是 SelfCheck.register 次数。\x1b[0m');
  console.log('  \x1b[90m    两者都为 0 但「家」>0 的模块，靠别的模块用 `refs` 引用它来守（见 [1] 的修法②）。\x1b[0m');
}


console.log('\n[2] 硬性缺陷\n');
if (!notRegistered.length) console.log('  \x1b[32m✔ 无参的守卫却没登记进 SelfCheck 的模块：无\x1b[0m');
else for (const m of notRegistered) console.log('  \x1b[31m✘ ' + m.file + '（' + m.bootable.join(',') + '）—— 无参、能进启动期，但没登记\x1b[0m');
if (runtimeOnly.length) {
  console.log('  ' + '\x1b[36m○ 运行期检查 —— 不登记是对的，理由逐条给出：\x1b[0m');
  for (const m of runtimeOnly) {
    console.log('      \x1b[36m' + m.file + '\x1b[0m ' + m.names.join(' · '));
  }
}
/* 还有一类：模块里既有能进启动期的无参守卫、也有运行期守卫（`comp.ts` 两个都有）——
   上面已经把它按"无参那个没登记"报了出来，这里只把运行期那部分补一行说明。 */
{
  const runtimeInFlagged = notRegistered.filter(x => (runtimeOnly.find(y => y.file === x.file)));
  if (runtimeInFlagged.length) {
    console.log('  \x1b[36m  （其中这些模块同时还有运行期守卫，那部分不登记是对的：' +
      runtimeInFlagged.map(x => x.file).join(',') + '）\x1b[0m');
  }
}
if (!untested.length) console.log('  \x1b[32m✔ 没有任何测试/工具提到的模块：无\x1b[0m');
else for (const m of untested) console.log('  \x1b[33m! ' + m.file + ' —— 改坏了没人知道\x1b[0m');
if (!tableNoFamily.length) console.log('  \x1b[32m✔ 有声明表却没进总账的模块：无\x1b[0m');
else for (const m of tableNoFamily) console.log('  \x1b[33m! ' + m.file + '（表 ' + m.tables.join(',') + '）');

console.log('\n[3] 提示：God object 候选（**只报数，不判罪**）\n');
for (const m of big) {
  console.log('  ' + PAD(m.file, 22) + PADL(m.codeLoc, 6) + ' 代码行 · 家族 ' + PADL(m.declares.length, 3) +
    ' · 扇出见 `pnpm run audit`');
}
console.log('  ⚠ 扇出高不等于 God object：要判的是"它**替别人做了决定**，还是**把大家叫到一起**" ——');
console.log('    那要读代码。`game.ts` 是模拟内核，认识 27 个模块是它的职责，不是它的罪。');

console.log('\n=== 结果 ===');
console.log('  \x1b[36m提示级\x1b[0m：没人守的家族 ' + unguarded.length +
  ' · 未被测试提到 ' + untested.length + ' · 有表没进总账 ' + tableNoFamily.length);
/* ⚠ 这里原先把"没人守的家族"和"未登记的启动期自检"**相加**成"硬性缺陷：19"。
   那是把两类东西混成一个数字：前者上一节自己用的是黄字 `!`（提示），
   后者才是红的。混起来以后，这个总数既不等于红也不等于黄，谁也没法据此行动。
   现在分开算，并且**让退出码真的跟着红走**。 */
console.log('  \x1b[31m缺陷级\x1b[0m：无参却未登记的启动期自检 ' + notRegistered.length + ' 个 · 没被认领的文件 ' + parity.problems.length + ' 个' +
  (DEFECTS ? ' \x1b[31m✘\x1b[0m' : ' \x1b[32m✔\x1b[0m'));
if (unguarded.length) {
  console.log('  ⚠ ' + unguarded.length + ' 个家族没人守，但**这不一定该修**：');
  console.log('    家族只要没人跨表引用，`Registry.audit()` 本来就不查它；');
  console.log('    给纯声明表硬加 audit 只会得到一堆同义反复。要判的是"值写错时有没有人喊"，');
  console.log('    不是"有没有一个叫 audit 的函数"。修法见 [1] 那两条。');
}
console.log('');
console.log('  门：`pnpm run guards` 只在**缺陷级**非 0；提示级要拦下来加 `--strict`。');
console.log('');
process.exit(DEFECTS > 0 ? 1 : (STRICT && unguarded.length > 0 ? 1 : 0));
