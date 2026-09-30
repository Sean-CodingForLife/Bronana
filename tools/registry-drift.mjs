/* =========================================================
   registry-drift.mjs — **登记漂移**：工具与测试有没有"能调的入口"
   ---------------------------------------------------------
   ## 为什么需要这一条校验

   补 CI 与协作文档那一轮，顺手盘账时发现两类**真实**的漂移：

     | 漂移 | 症状 |
     | --- | --- |
     | `tools/score.mjs` / `draw-census.mjs` / `yaml-check.mjs` **存在但没有脚本** | 工具写得再好也没人能调 —— 它等于不存在 |
     | `test/arch.mjs` **在 49 套里跑，但没有 `test:*` 脚本** | 想单独跑一套时会发现"命令不存在" |
     | `tools/module-audit.mjs` **是 `guard-gaps` 的旧版、还在报假阳** | 两份工具同时存在 = 必然有一份是错的，而人不知道该信哪份 |

   这三条都不是"代码写错了"，而是**登记漂移**：东西在，但账上没有它。
   它不会让任何测试变红，只会让下一个人多花半小时找"那个工具怎么跑"。

   ## 判据（与 `guard-gaps` 同一条纪律：只认能当场验证的事实）

     A **每个 `tools/*.mjs|cjs` 要么有 npm 脚本、要么被别的文件 import**
       （一次性迁移脚本单独登记在 `ONE_SHOT` 里 —— 它们的归宿是删掉，不是给脚本）
     B **每个 `test/*.mjs` 要么在 `test/run-all.mjs` 的清单里、要么有 `test:*` 脚本**
       （`run-all.mjs` 自己是运行器，不算）
     C **两个方向的对照都为空**：有脚本没进套件、进套件没脚本，都报出来
     D **具名导入必须真的被导出** —— `tools/` 与 `test/` 不在任何 tsconfig 的
       include 里（`checkJs:false`），所以这一层没有 tsc 兜底。
       一次真实的静默故障：`curve-audit.mjs` 从 `balance.mjs` 取 `runAll`，
       而后者一个 export 都没有 → `if (!runAll)` 恒真 → 那一节**永远是死代码**。
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const JSON_OUT = process.argv.includes('--json');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const scripts = pkg.scripts || {};

/* 一次性迁移脚本：跑完就该删。它们**不该**有 npm 脚本（那是把已经用完的东西摆上货架）。 */
const ONE_SHOT = ['apply-comp', 'batch-close', 'batch-num', 'decal-decide', 'decal-hoist',
  'esm-ify', 'esm-tests', 'finalize-comp', 'fix-comp', 'fix-types', 'migrate-types',
  'rename-bronana', 'rename-doudou', 'rewrite-items', 'tsc-report', 'canvas-numbers'];

/* 被别的文件 import 的库（不是给人直接跑的命令） */
const LIBS = ['systems'];

/* **只在特定版本上才能成功的脚本**：夹具生成器要求在"当前存档版本 = 1"时
   才肯跑（跑在 v2 上会把夹具覆盖成新版，夹具就失去意义了）。
   它不该有 npm 脚本 —— 货架上的命令应该**始终**能跑成功，而这个脚本
   升版之后会**故意**拒绝自己。要跑它只能直接 `node tools/…`，
   那时你一定会先读到它的前置检查在说什么。 */
const VERSION_LOCKED = ['make-migration-fixture'];

/* ⚠ 只看**文件**：`test/` 下面现在有子目录（`fixtures/` 放迁移夹具），
   而 `readFileSync` 撞上目录会抛 EISDIR —— 那是"工具被数据目录绊倒"，
   不是"代码有问题"。第一版就是这么崩的。 */
const readDir = d => fs.readdirSync(path.join(ROOT, d))
  .filter(f => fs.statSync(path.join(ROOT, d, f)).isFile());

/* 一个文件名有没有被 repo 里任何文件 import / require。
   ⚠ 匹配的是**带引号的相对路径**（`'./_run.mjs'` / `'../test/_run.mjs'`），
   所以不能拿 `'文件名'` 去比整串 —— 第一版就是这么漏掉两个库的
   （`_run.mjs` 被 `'./_run.mjs'` 引用，字符串里根本没有 `'_run.mjs'`）。 */
function isImported(file, dirs) {
  const re = new RegExp('[\'"](\\.{1,2}/)*' + file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\'"]');
  for (const d of dirs) {
    for (const g of readDir(d)) {
      if (g === file) continue;
      if (re.test(fs.readFileSync(path.join(ROOT, d, g), 'utf8'))) return true;
    }
  }
  return false;
}

/* ---------------- A. 工具入口 ---------------- */
const toolFiles = readDir('tools').filter(f => /\.(mjs|cjs)$/.test(f)).sort();
const toolRows = toolFiles.map(f => {
  const base = f.replace(/\.(mjs|cjs)$/, '');
  const keys = Object.entries(scripts).filter(([, v]) => v.includes('tools/' + f)).map(([k]) => k);
  const oneShot = ONE_SHOT.indexOf(base) >= 0;
  const lib = LIBS.indexOf(base) >= 0 || isImported(f, ['tools', 'test']);
  const locked = VERSION_LOCKED.indexOf(base) >= 0;
  return { file: f, base, keys, oneShot, lib, locked, ok: keys.length > 0 || oneShot || lib || locked };
});
const toolsMissingEntry = toolRows.filter(r => !r.ok);

/* ---------------- B/C. 测试登记 ---------------- */
const runAllSrc = fs.readFileSync(path.join(ROOT, 'test', 'suites.mjs'), 'utf8');
const listed = [...runAllSrc.matchAll(/\[\s*'[^']*'\s*,\s*'([^']+\.mjs)'\s*\]/g)].map(m => m[1]);
const testScripts = Object.entries(scripts)
  .filter(([k, v]) => k.indexOf('test:') === 0 && v.indexOf('test/') >= 0)
  .map(([k, v]) => ({ key: k, file: v.trim().replace(/^node\s+/, '').replace(/^test\//, '') }));

const listedSet = new Set(listed);
const scriptedSet = new Set(testScripts.map(s => s.file));
/* `run-all.mjs` 是运行器本身，`suites.mjs` 是**清单数据** —— 两者都不是测试套件。
   （清单从运行器里拆出来的理由是：`verify.mjs` 的门名字要按清单算套件数，
   而那个数字写死了就漂。见 `test/suites.mjs` 的头注释。） */
const runnerOnly = ['run-all.mjs', 'suites.mjs'];
const testFiles = readDir('test').filter(f => f.endsWith('.mjs') && f.charAt(0) !== '_' && runnerOnly.indexOf(f) < 0);

const inSuiteNoScript = listed.filter(f => !scriptedSet.has(f));
const scriptedNoSuite = testScripts.filter(s => !listedSet.has(s.file)).map(s => s.file);
const testOrphans = testFiles.filter(f => !listedSet.has(f) && !scriptedSet.has(f));

/* ---------------- D. 具名导入 ↔ 导出对账 ----------------
   为什么需要这一条（一次真实的静默故障）：

     `tools/curve-audit.mjs` 写着
       const { runAll } = await import('./balance.mjs').catch(() => ({ runAll: null }));
     而 `tools/balance.mjs` **一个 export 都没有** —— 于是 `runAll` 恒为 `undefined`，
     `if (!runAll)` 恒为真，那一节**永远打印"跳过"**，`else` 分支是死代码。
     而那一节的注释写着"**这一半才是"平衡"的证据**" —— 它从来没跑过。

   这类错在 `src/` 会被 `tsc` 当场抓住，但 **`tools/` 与 `test/` 不在任何 tsconfig 的
   include 里**（`tsconfig.node.json` 是 `checkJs:false` + 只收 `cli.ts`），
   所以那一层**完全没有类型检查** —— 只能靠这条校验。

   宽容处理（宁可漏报，不可误报）：目标文件里出现 `export *`、或解析不了，就跳过。 */

const exportCache = Object.create(null);
/** 去注释再扫 —— 否则"头注释里举的那个 bug 例子"本身会被当成一处漂移（实测过）。
    ⚠ 块注释要**保留它占的换行**：第一版直接换成 ' '，于是后面所有报出来的行号
    都指向"去注释之后"的位置，指错地方比不指还糟。 */
const stripComments = (t) => t
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

function exportsOf(abs) {
  if (abs in exportCache) return exportCache[abs];
  let names = null;
  try {
    const t = stripComments(fs.readFileSync(abs, 'utf8'));
    /* `export * from` 会让"导出了什么"算不清 —— 直接放弃这个文件 */
    if (/export\s*\*\s*from/.test(t)) { exportCache[abs] = null; return null; }
    names = new Set();
    for (const m of t.matchAll(/export\s*\{([^}]*)\}/g)) {
      for (const part of m[1].split(',')) {
        const seg = part.trim();
        if (!seg) continue;
        const name = seg.split(/\s+as\s+/).pop().trim();
        if (name && name !== 'default') names.add(name);
      }
    }
    /* ⚠ `export async function foo` 要能抓到 `foo`。
       第一版写成 `/export\s+(?:const|function|class|let|var|async)\s+(NAME)/`，
       对 `export async function loadAll` 会把 `function` 当成名字捕获 ——
       于是 `loadAll` 被判成"没导出"，一次跑出 74 处假阳性。 */
    for (const m of t.matchAll(/export\s+(?:async\s+)?(?:const|function|class|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
      if (m[1] !== 'function' && m[1] !== 'async') names.add(m[1]);
    }
    if (/export\s+default\b/.test(t)) names.add('default');
    for (const m of t.matchAll(/module\.exports\s*=\s*\{([^}]*)\}/g)) {
      for (const part of m[1].split(',')) {
        const name = part.trim().split(':')[0].trim();
        if (name) names.add(name);
      }
    }
    for (const m of t.matchAll(/exports\.([A-Za-z_$][\w$]*)\s*=/g)) names.add(m[1]);
  } catch (e) {
    names = null;
  }
  exportCache[abs] = names;
  return names;
}

const badImports = [];
for (const dir of ['tools', 'test']) {
  for (const f of readDir(dir)) {
    if (!/\.(mjs|cjs)$/.test(f)) continue;
    const abs = path.join(ROOT, dir, f);
    const t = stripComments(fs.readFileSync(abs, 'utf8'));
    const specs = [];
    for (const m of t.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) specs.push({ names: m[1], spec: m[2] });
    for (const m of t.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:await\s+)?import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push({ names: m[1], spec: m[2] });
    for (const m of t.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push({ names: m[1], spec: m[2] });
    for (const s of specs) {
      if (!/^\.{1,2}\//.test(s.spec)) continue;
      const target = path.resolve(path.dirname(abs), s.spec);
      if (!fs.existsSync(target)) continue;
      const have = exportsOf(target);
      if (!have) continue;
      for (const part of s.names.split(',')) {
        const seg = part.trim();
        if (!seg) continue;
        const name = seg.split(/\s+as\s+/)[0].trim();
        if (!name) continue;
        if (!have.has(name)) {
          badImports.push(dir + '/' + f + ' 从 `' + s.spec + '` 取了 `' + name +
            '`，但那个文件没有导出它（取值恒为 undefined）');
        }
      }
    }
  }
}

/* ---------------- E. 开局入口不许漏参数 ----------------
   为什么需要这一条（一次真实的"测试全绿、功能为零"）：

     `Game.newRun(charId, seed, danger, opening, smods, skillBuild)` 有 6 个参数，
     而"一局该带哪些局外状态"分散在这 6 个上。改造前 `src/` 里有**两份**开局写法，
     两份都漏：

       · `ui.ts` 的选人页「出发」传了 opening 与 smods，**漏了 skillBuild**；
       · `main.ts` 标题页的回车只传了角色，opening / smods / skillBuild **全漏**。

     漏 `skillBuild` 的后果不是"少一点手感"，而是**整个技能系统在正式游戏里从不发生**：
     `applySkillBuild(S, charId, skillBuild || [])` → 空构筑 → 0 个技能槽 →
     `updateSkills` 第一行就 return。实测：走选人页出发，技能槽 = 0；
     把构筑显式传进去，技能槽 = 1，6 局释放 2044 次、命中 6129 次。

     而 `test/skill.mjs` 全程用 `Game.newRun(…, null, null, build)` 六参数形式 ——
     它验的是模拟层，**恰好绕过了这根线**。所以测试全绿、玩家看不到技能。

   判据：`src/` 里每个 `Game.newRun(` 调用点都要登记在 `RUN_START` 表里，
   并写明它**故意**不带哪些东西；没登记的、或登记为"完整"却没传满 6 个参数的，都报出来。 */

/* 刻意**不**带局外状态的开局入口：它们要的是可复现的固定场景，不是玩家的一局。
   `full: false` 的意思就是"它少传参数是故意的" —— 但**必须写下来**，
   不然下一个人分不清"故意"和"忘了"（这正是这一条存在的理由）。 */
const RUN_START = {
  'ui.ts': { full: true, why: '玩家点「出发」——**唯一**的完整入口，见 UI.startRun' },
  'main.ts': { full: false, why: '演示态（mode=loading/end）与挑战赛开局，用固定场景/固定规则，刻意不吃局外状态' },
  'demo.ts': { full: false, why: '演示台：要的是固定场景' },
  'cli.ts': { full: false, why: '无头 CLI：要的是可复现的固定对局（不读账号档案）' },
  'game.ts': { full: false, why: '读档（continueRun / importRun）：局外状态从存档里回来，不再从档案读' },
  'data_chars.ts': { full: false, why: '注释里提到的签名，不是调用' }
};

function argCount(text) {
  /* 数顶层逗号：从 `(` 后开始，括号/方括号/花括号深度回到 0 时遇到逗号才算一个分隔符 */
  let depth = 0, n = 0, any = false;
  for (const ch of text) {
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') { if (depth === 0) break; depth--; }
    else if (ch === ',' && depth === 0) n++;
    if (!/\s/.test(ch)) any = true;
  }
  return any ? n + 1 : 0;
}

const runStartProblems = [];
const runStartSeen = [];
for (const f of readDir('src')) {
  if (!f.endsWith('.ts')) continue;
  const t = stripComments(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8'));
  let i = -1;
  while ((i = t.indexOf('Game.newRun(', i + 1)) >= 0) {
    const start = i + 'Game.newRun('.length;
    const text = t.slice(start, start + 400);
    const n = argCount(text);
    const line = t.slice(0, i).split('\n').length;
    const reg = RUN_START[f];
    runStartSeen.push({ f, line, n });
    if (!reg) {
      runStartProblems.push('src/' + f + ':' + line + ' 有 `Game.newRun(` 调用点但没登记在 RUN_START 表里' +
        '（开局漏参数是静默的：功能会整个不发生）');
    } else if (reg.full && n < 6) {
      runStartProblems.push('src/' + f + ':' + line + ' 登记为"完整开局"却只传了 ' + n + ' 个参数' +
        '（opening / smods / skillBuild 一个都不能漏）');
    }
  }
}

/* =========================================================
   判据 F：**代币只能在自己模块里花**（调用点 ↔ 货币表对账）
   ---------------------------------------------------------
   用户的设计："每个模块的货币都必须只能是在自己的模块内使用，
   绝对不能出现什么，用商店买建材这种事。"

   为什么光有货币表不够（这是这一条存在的全部理由）：
   `market.buyBuild` 花 `scrap`（战斗局内、结算清零）换 `material`（全局），
   而它在货币表上**两边都合法** —— 战斗产 material ✓、scrap 在战斗花 ✓。
   于是 `economy.audit()` 绿、`loop` 门绿、货币表自洽，而这笔违规**一直在跑**。
   **表自洽 ≠ 调用点听话。** 中间那一层以前没有任何东西在看。

   判据：扫 `src/`，把每个函数体里**扣掉的**代币集合与**加上的**代币集合取出来；
   任何 `A → B`（A ≠ B）必须登记在 `Economy.EXCHANGE` 里。
   同一笔代币的"退回"（材料→材料）不算转换，直接放过 —— 那是失败回滚，不是兑换。
   ========================================================= */
const CURRENCY_API = {
  scrap: { debit: /\.scrap\s*-=/, credit: /\.scrap\s*\+=|addScrap\(/ },
  material: { debit: /spendMaterial\(/, credit: /addMaterial\(/ },
  core: { debit: /\.core\s*-=|spendCore\(/, credit: /addCore\(/ },
  spore: { debit: /spendSpores\(/, credit: /addSpores\(/ },
  alloy: { debit: /\.growth\s*-=/, credit: /addAlloy\(/ }
};
const currencyConversionProblems = [];
let currencyCallSites = 0;
try {
  const { loadAll, SIM_MODULES } = await import('../test/_load.mjs');
  await loadAll(SIM_MODULES);
  const Eco = globalThis.Economy;
  const declared = new Set((Eco.EXCHANGE || []).map(e => e.from + '>' + e.to));
  /* 把 `function name(...) {` 到配对的收尾括号截出来。
     ⚠ **必须把嵌套的内层函数挖掉**：`makeMarket()` 是工厂函数，它把整个文件里
     所有 `function` 都包住了 —— 于是它"花 scrap 得 material"（其实是内层的
     `buyBuild` 干的）。第一版就是这么误报的：一条真违规报成了两条。
     判据只认**这个函数自己写的**那几行，不认它包住的东西。 */
  const ranges = (text) => {
    const out = [];
    const re = /(?:^|\n)\s*(?:export\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
    let m;
    while ((m = re.exec(text))) {
      const i = text.indexOf('{', m.index + m[0].length - 1);
      if (i < 0) continue;
      let d = 0, j = i;
      for (; j < text.length; j++) {
        const c = text[j];
        if (c === '{') d++;
        else if (c === '}') { d--; if (!d) break; }
      }
      out.push({ name: m[1], start: i, end: j + 1, line: text.slice(0, m.index).split('\n').length });
    }
    return out;
  };
  /** 一个函数**自己**的正文：挖掉所有严格嵌在它里面的函数 */
  const ownBody = (text, fn, all) => {
    const inner = all
      .filter(o => o !== fn && o.start > fn.start && o.end < fn.end)
      .sort((a, b) => a.start - b.start);
    if (!inner.length) return text.slice(fn.start, fn.end);
    let out = '', cur = fn.start;
    for (const o of inner) {
      if (o.start < cur) continue;                    // 已经被更外层的内层盖住了
      out += text.slice(cur, o.start);
      cur = o.end;
    }
    return out + text.slice(cur, fn.end);
  };
  for (const f of readDir('src')) {
    if (!f.endsWith('.ts')) continue;
    const text = stripComments(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8'));
    const all = ranges(text);
    for (const fn of all) {
      const body = ownBody(text, fn, all);
      const debits = [], credits = [];
      for (const [id, pat] of Object.entries(CURRENCY_API)) {
        if (pat.debit.test(body)) debits.push(id);
        if (pat.credit.test(body)) credits.push(id);
      }
      for (const a of debits) {
        for (const b of credits) {
          if (a === b) continue;                       // 同一笔的退回 = 失败回滚，不是兑换
          currencyCallSites++;
          if (!declared.has(a + '>' + b)) {
            currencyConversionProblems.push('src/' + f + ':' + fn.line + ' 函数 `' + fn.name +
              '()` 花 **' + a + '** 得 **' + b + '** —— 这个组合不在 `Economy.EXCHANGE` 里' +
              '（跨模块直花：用户在商店里拿废料买到经营的材料，就是这么漏过去的）');
          }
        }
      }
    }
  }
} catch (e) {
  currencyConversionProblems.push('判据 F 没能跑起来：' + (e && e.message ? e.message : e));
}

/* =========================================================
   判据 G：**核心素材必须真的接上了**（读调用点，不是读表）
   ---------------------------------------------------------
   这一条是**自己全量复查时抓出来的那个坑**的补丁，值得把经过写下来：

   `relic` / `sigil` 在 `economy.ts` 的表里声明得漂漂亮亮，于是
   `Economy.audit()` 报"链条闭合 ✔" —— 而它们在 `src/` 里
   **一处调用点都没有**（实测：产出 0 处 · 消费 0 处）。
   那道自检**证明了"表自洽"，却报成了"循环闭合"**。

   这与 `curve-audit` 的死代码、`test/skill.mjs` 绕过开局入口、
   `loop-audit` 只画声明图是**同一个病**：拿"声明"当"实现"。
   所以这一条必须去读 **`src/` 里的调用点**，表说什么都不算数。

   判据：每个 `chain:` 代币要有**产出点**（`addX(` / `xForRun(` / `.x +=`）
   与**消费点**（`data.x -=` / `spendX(`）。
   找不到就得登记在 `Economy.PENDING_CHAIN` 里写明理由 ——
   允许有欠账，不允许**悄悄**有欠账。
   ========================================================= */
const chainWiringProblems = [];
let chainChecked = 0, chainPending = 0;
try {
  const { loadAll, SIM_MODULES } = await import('../test/_load.mjs');
  await loadAll(SIM_MODULES);
  const Eco = globalThis.Economy;
  const Link = globalThis.Link;
  /* ⚠ 核心素材现在住在 `Link`（**不在账本里**）—— 判据 G 跟着搬过来。
     这一条比以前更硬：`Link.audit()` 会独立地查"产出地 ≠ 消费地"与保底，
     而这里查的是**代码里到底有没有那么一处调用点**。 */
  const sources = readDir('src')
    .filter(f => f.endsWith('.ts') && f !== 'link.ts' && f !== 'types.d.ts' &&
      f.indexOf('eco_') !== 0 && f !== 'economy.ts')
    .map(f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8'))
    .join('\n');
  const pend = new Set((Link.PENDING || []).map(p => p.id));
  for (const l of Link.LIST) {
    chainChecked++;
    if (pend.has(l.id)) { chainPending++; continue; }
    const cap = l.id.charAt(0).toUpperCase() + l.id.slice(1);
    const nProd = (sources.match(new RegExp('add' + cap + 's?\\(|' + l.id + 's?ForRun\\(|\\.' + l.id + 's? \\+=', 'g')) || []).length;
    const nCons = (sources.match(new RegExp('data\\.' + l.id + 's? -=|spend' + cap + 's?\\(', 'g')) || []).length;
    if (!nProd || !nCons) {
      chainWiringProblems.push('核心素材「' + l.name + '」（' + l.id + '）在 `link.ts` 里声明了，' +
        '但代码里' + (nProd ? '' : ' **没有产出点**') + (nCons ? '' : ' **没有消费点**') +
        ' —— 声明 ≠ 那条链真的存在');
    }
  }
} catch (e) {
  chainWiringProblems.push('判据 G 没能跑起来：' + (e && e.message ? e.message : e));
}

/* ---------------- 判定 ---------------- */
const problems = [];
for (const r of toolsMissingEntry) {
  problems.push('tools/' + r.file + ' 既没有 npm 脚本、也没有被 import —— 写好了没人能调');
}
for (const f of inSuiteNoScript) problems.push('test/' + f + ' 在套件里跑，但没有 `test:*` 脚本（想单独跑时命令不存在）');
for (const f of scriptedNoSuite) problems.push('test/' + f + ' 有 `test:*` 脚本，但不在 suites.mjs 的套件清单里');
for (const f of testOrphans) problems.push('test/' + f + ' 既不在套件里、也没有脚本 —— 它从来没被任何东西跑过');
for (const b of badImports) problems.push(b);
for (const p of runStartProblems) problems.push(p);
for (const p of currencyConversionProblems) problems.push(p);
for (const p of chainWiringProblems) problems.push(p);

if (JSON_OUT) {
  console.log(JSON.stringify({
    tools: toolRows, testFiles, inSuiteNoScript, scriptedNoSuite, testOrphans, badImports, problems
  }, null, 1));
  process.exit(problems.length ? 1 : 0);
}

const PAD = (s, n) => { s = String(s); let w = 0; for (const c of s) w += c.charCodeAt(0) > 127 ? 2 : 1; return s + ' '.repeat(Math.max(0, n - w)); };

console.log('\n=== Bronana · 登记漂移（工具与测试有没有入口）===\n');
console.log('  这条校验量的是"东西在不在账上"，不是"代码写得好不好"。');
console.log('  症状很轻（不会让任何测试变红），代价很具体：下一个人找不到怎么跑它。\n');

console.log('[1] 工具入口（' + toolFiles.length + ' 个文件）');
console.log('  ' + PAD('文件', 26) + PAD('npm 脚本', 24) + '状态');
for (const r of toolRows) {
  let st;
  if (r.keys.length) st = '';
  else if (r.oneShot) st = '\x1b[90m一次性迁移脚本（跑完就该删）\x1b[0m';
  else if (r.lib) st = '\x1b[36m库 / 被 import（无需脚本）\x1b[0m';
  else st = '\x1b[31m✘ 没有入口\x1b[0m';
  console.log('  ' + PAD(r.file, 26) + PAD(r.keys.join(',') || '—', 24) + st);
}

console.log('\n[2] 测试登记（套件 ' + listed.length + ' 套 · 脚本 ' + testScripts.length + ' 个）');
console.log('  仅在套件里：' + (inSuiteNoScript.length ? '\x1b[33m' + inSuiteNoScript.join(', ') + '\x1b[0m' : '\x1b[32m无\x1b[0m'));
console.log('  仅有脚本　：' + (scriptedNoSuite.length ? '\x1b[33m' + scriptedNoSuite.join(', ') + '\x1b[0m' : '\x1b[32m无\x1b[0m'));
console.log('  两处都没有：' + (testOrphans.length ? '\x1b[31m' + testOrphans.join(', ') + '\x1b[0m' : '\x1b[32m无\x1b[0m'));

console.log('\n[3] 具名导入 ↔ 导出对账（`tools/` 与 `test/` 没有 tsc 覆盖，只能靠这条）');
if (!badImports.length) console.log('  \x1b[32m✔ 每个具名导入都真的被导出了\x1b[0m');
else {
  console.log('  \x1b[31m✘ ' + badImports.length + ' 处对不上：\x1b[0m');
  for (const b of badImports) console.log('    · ' + b);
  console.log('    \x1b[90m（取值会是 undefined —— 而 `if (!x)` 这类守卫会把"结构错了"包装成"良性跳过"）\x1b[0m');
}

console.log('\n[4] 开局入口（`Game.newRun` 的 6 个参数一个都不能漏）');
console.log('  ' + PAD('文件', 16) + PAD('行', 6) + PAD('参数个数', 10) + '说明');
for (const r of runStartSeen) {
  const reg = RUN_START[r.f];
  const tag = !reg ? '\x1b[31m✘ 没登记\x1b[0m' : (reg.full ? '\x1b[32m完整开局\x1b[0m' : '\x1b[90m刻意不带局外状态\x1b[0m');
  console.log('  ' + PAD('src/' + r.f, 16) + PAD(String(r.line), 6) + PAD(String(r.n), 10) + tag +
    (reg && !reg.full ? '  \x1b[90m' + reg.why + '\x1b[0m' : ''));
}
if (!runStartProblems.length) console.log('  \x1b[32m✔ 每个开局入口都登记在案\x1b[0m');

console.log('\n[5] 代币只在自家模块花（调用点 ↔ 货币表对账）');
if (!currencyConversionProblems.length) {
  console.log('  \x1b[32m✔ ' + currencyCallSites + ' 处跨币转换全部登记在 `Economy.EXCHANGE` 里\x1b[0m');
  if (!currencyCallSites) {
    console.log('  \x1b[90m（一处都没有：当前没有任何"花 A 得 B"的合法兑换）\x1b[0m');
  }
} else {
  console.log('  \x1b[31m✘ ' + currencyConversionProblems.length + ' 处跨模块直花：\x1b[0m');
  for (const p of currencyConversionProblems) console.log('    · ' + p);
  console.log('    \x1b[90m（表自洽 ≠ 调用点听话 —— 这一层以前没有任何东西在看）\x1b[0m');
}

console.log('\n[6] 核心素材真的接上了吗（读**调用点**，不是读 `link.ts`）');
if (!chainWiringProblems.length) {
  const tag = chainPending
    ? '\x1b[33m' + chainPending + ' 个是**登记过的欠账**\x1b[0m\x1b[32m'
    : '\x1b[32m0 个欠账';
  console.log('  \x1b[32m✔ ' + chainChecked + ' 个核心素材：接入齐了（' + tag + '）\x1b[0m');
  for (const p of (globalThis.Link && globalThis.Link.PENDING) || []) {
    console.log('    \x1b[90m· ' + p.id + '：' + p.why.slice(0, 62) + '…\x1b[0m');
  }
} else {
  console.log('  \x1b[31m✘ ' + chainWiringProblems.length + ' 个核心素材"声明了没接入"：\x1b[0m');
  for (const p of chainWiringProblems) console.log('    · ' + p);
  console.log('    \x1b[90m（声明 ≠ 那条链真的存在。`Link.audit` 只证明"表里说得通"）\x1b[0m');
}

/* =========================================================
   判据 H：**禁止统一 `economy.ts`**（v3 §8-7 点名要的守卫）
   ---------------------------------------------------------
   设计上下文 v3 §5.4-错误1：
     "把三个模块的货币压成一套。**禁止统一 `economy.ts`
      定义五六种货币互相兑换。**"
   §8-工作重点7：
     "守卫：**禁止统一 `economy.ts`**，禁止核心素材入货币表，
      禁止跨模块直接消费。"

   判据 F 守的是"调用点不许跨模块直花"，判据 G 守的是"核心素材要接入"，
   这一条守的是**货币定义的位置**：`economy.ts` 只许是**只读聚合**。

   怎么判"它在读还是在定义"（只认能当场验证的事实）：
     · 定义一笔代币的最小形态是 `id: 'xxx'` —— 聚合视图里不会有这个字面量
       （它从 `Ledger.currencies()` 读出来）
     · 定义一张兑换表的最小形态是 `EXCHANGE = [` —— 聚合只做转发
   两条都不许出现。这是**文本级**的判据，故意做得笨：它要能拦住
   "我就加一笔、顺手再给它定个汇率"那个瞬间。
   ========================================================= */
const economyUnifyProblems = [];
try {
  const src = stripComments(fs.readFileSync(path.join(ROOT, 'src', 'economy.ts'), 'utf8'));
  const defs = src.match(/\bid:\s*'[a-z_]+'/g) || [];
  if (defs.length) {
    economyUnifyProblems.push('src/economy.ts 里出现了 ' + defs.length + ' 处代币定义（' +
      defs.slice(0, 4).join(', ') + '）—— 它只许是**只读聚合**，' +
      '定义要放回 eco_combat / eco_manage / eco_grow / eco_global（v3 §5.4-错误1）');
  }
  if (/EXCHANGE\s*=\s*\[/.test(src)) {
    economyUnifyProblems.push('src/economy.ts 里定义了兑换表 —— ' +
      '它只许转发 `Ledger.EXCHANGE`（v3 §8-7：禁止统一 economy.ts）');
  }
} catch (e) {
  economyUnifyProblems.push('判据 H 没能跑起来：' + (e && e.message ? e.message : e));
}

console.log('\n[7] 禁止统一 `economy.ts`（v3 §8-7）');
if (!economyUnifyProblems.length) {
  console.log('  \x1b[32m✔ economy.ts 是只读聚合：里面没有一笔代币定义、也没有兑换表\x1b[0m');
  console.log('    \x1b[90m（定义分在 ledger / eco_combat / eco_manage / eco_grow / eco_global / link）\x1b[0m');
} else {
  console.log('  \x1b[31m✘ ' + economyUnifyProblems.length + ' 处：\x1b[0m');
  for (const p of economyUnifyProblems) console.log('    · ' + p);
}
for (const p of economyUnifyProblems) problems.push(p);

/* =========================================================
   判据 I：**M1 迁移预算**（只许降，不许升）
   ---------------------------------------------------------
   背景：设计上下文 v3 §8 列的头号未完成项是

     "三个模块的机制被内嵌、耦合" + §8-1 "拆开三个模块"

   而根因是一个具体的事实：**据点 / 天赋 / 图纸 / 那几笔钱住在 `Profile`
   （账号档案 = 局外）**，于是战斗模块（`game.ts`）要花材料就得**直接读账号**。
   `run_save.ts` 里那段注释自己写着："营地不在一局存档里了…它们本来就跨局活着"。

   v3 §二 说的相反：三个模块**全在局内**。所以这些状态要搬进 `Session`。

   ## 为什么做成棘轮

   这是一次**跨多轮**的迁移（光 `game.ts` 就 10 处，`ui.ts` 22 处）。
   一次改完不现实，而"改到一半"最容易发生的事是**又长回去**。
   所以这里不要求"必须是 0"，只要求**不许比登记值更大**：
   每搬走一处就把预算调小，想加回来就会被这道门挡住。

   ⚠ 只统计**越界读**（按文件归属分）：`profile.ts` 是这些出口的家，不算。
   ========================================================= */
/* ⚠ **这份清单必须写全** —— 它定义"什么算一次越界读"。
   2026-09 修过一次漏数：旧清单没有 `talentsOf` / `talentFree` / `talentSpent` /
   `keepInvested` / `campRowClean` / `campLevel` / `campFx` / `forgeMods` /
   `takeTalent` / `undoTalent`，于是 `ui.ts` 的 22 处被报成 19 处。
   **校验漏数 = 校验撒谎**：它会报"搬完了"而实际还有十处直接读账号。
   按"状态族"分组，每一族都是 v3 §二 说的"该住在局内"的东西：
     keep   据点（等级 / 已建 / 折叠修正 / 已投入 / 购买）
     camp   工坊（等级 / 已建 / 建造顺序 / 折叠效果 / 产线数 / 买卖）
     forge  图纸（已解锁 / 是否解锁 / 能不能造 / 节点 / 折叠修正）
     talent 天赋（已点 / 免费次数 / 已花 / 点数 / 点 / 撤 / 洗点）
     money  四笔钱（材料 / 孢子 / 合金 / 核心材料） */
const M1_ACCOUNT_RE = /Profile\.(keepLevel|keepOwned|keepMods|keepInvested|keepBuy|campLevel|campOwned|campRow|campRowClean|campFx|campLines|campBuy|campSell|forgeOwned|isForged|canForge|forgeNode|forgeMods|talentsOf|talentFree|talentSpent|talentPoints|takeTalent|undoTalent|respecTalents|spores|alloy|core|material|addSpores|spendSpores|addAlloy|addCore|addMaterial|spendMaterial)\(/g;
/* 每个文件归哪个模块（v3 §二：战斗 / 经营 / 养成；其余是层与界面） */
const M1_OWNER = {
  'game.ts': 'combat', 'market.ts': 'combat',
  'stronghold.ts': 'manage', 'camp.ts': 'manage', 'craft.ts': 'manage', 'forge.ts': 'manage',
  'talents.ts': 'grow', 'story.ts': 'grow', 'skills.ts': 'grow',
  'profile.ts': 'layer', 'ui.ts': 'view', 'main.ts': 'boot', 'run_save.ts': 'save'
};
/* **登记值**：2026-09 的实测数（`stripComments` 之后 —— 注释里的提及不算越界）。

   ⚠ **这份预算被修正过一次，经过值得记下来。**
   第一版用的是**漏数的校验**（出口清单少了 10 个），于是报「29 → 22」，
   看起来已经搬走四分之一。把清单写全之后真实数是 **41**（game 9 · ui 31 · main 1）。
   材料那一块的进展是**真的**（全量校验下 48 → 41），错的是基线 ——
   而「基线报低」比「没进展」更危险：它会让人以为快搬完了。

   每搬走一批就调小它。

   ⚠ **M1 第四块（图纸）让 `game.ts` 从 3 涨到 8 —— 这是诚实的结果，不是回退。**
   图纸的解锁集合搬进了局内（`S.forge`），但它的**花费**是 `合金` + `核心材料`，
   而这两笔都还没有局内的家：
     · `核心材料` 是 v3 §5.2 的**核心素材**（战斗 → 经营），**归 M4**
     · `合金` **不在 v3 的货币模型里**（v3 只有 3 个模块代币 + 1 个全局货币
       + 3 个核心素材）—— 它的归属是**设计决定**，等用户拍板
   所以 `Game.forgeNode` 暂时只能从账号读那两笔。M4 与那个决定落地之后，
   这个数会自己降回去。**把理由写在这里，而不是把预算偷偷改大。**

   本轮净效果：合计 26 → 25（`ui.ts` 22 → 16 搬走 6 处）。 */
const M1_BUDGET = { 'game.ts': 8, 'ui.ts': 16, 'main.ts': 1 };
const m1Now = {};
try {
  for (const f of readDir('src')) {
    if (!f.endsWith('.ts') || f === 'types.d.ts' || f === 'profile.ts') continue;
    const n = (stripComments(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8')).match(M1_ACCOUNT_RE) || []).length;
    if (n) m1Now[f] = n;
  }
} catch (e) {
  m1Now['<读不到>'] = -1;
}
const m1Regressed = [];
for (const f of Object.keys(m1Now)) {
  const was = M1_BUDGET[f] || 0;
  if (m1Now[f] > was) {
    m1Regressed.push('src/' + f + ' 直接读账号状态的处数 **长回去了**（' + was + ' → ' + m1Now[f] + '）—— ' +
      'M1 是把这些状态搬进 `Session`（v3 §二：三个模块全在局内），只许降');
  }
}
const m1Total = Object.keys(m1Now).reduce((s, f) => s + Math.max(0, m1Now[f]), 0);
const m1Was = Object.keys(M1_BUDGET).reduce((s, f) => s + M1_BUDGET[f], 0);
for (const p of m1Regressed) problems.push(p);

console.log('\n[8] M1 迁移预算（把账号状态搬进局内，**只许降**）');
console.log('  ' + PAD('文件', 18) + PAD('模块', 10) + PAD('现在', 6) + '登记值');
for (const f of Object.keys(M1_BUDGET).sort()) {
  const now = m1Now[f] || 0;
  const was = M1_BUDGET[f];
  const tag = now < was ? '\x1b[32m↓ 已搬走 ' + (was - now) + '\x1b[0m' : (now > was ? '\x1b[31m↑ 长回去了\x1b[0m' : '\x1b[90m—\x1b[0m');
  console.log('  ' + PAD(f, 18) + PAD(M1_OWNER[f] || '?', 10) + PAD(String(now), 6) + was + '  ' + tag);
}
console.log('  ' + PAD('合计', 28) + PAD(String(m1Total), 6) + m1Was +
  (m1Total < m1Was ? '  \x1b[32m已搬走 ' + (m1Was - m1Total) + ' 处\x1b[0m' : ''));
console.log('  \x1b[90m（`profile.ts` 是这些出口的家，不算越界；`talents/stronghold/craft` 是 0 —— 它们收参数，架构已经对了）\x1b[0m');
if (m1Regressed.length) {
  console.log('  \x1b[31m✘ ' + m1Regressed.length + ' 个文件长回去了\x1b[0m');
}

/* =========================================================
   判据 J：**入账只许有一个出口**（防双重入账）
   ---------------------------------------------------------
   这一条来自 2026-09 全量复查里抓到的一个**真 bug**：

     材料在局内 `gainMaterial`（`game.ts` 的"唯一出口"）里已经
     `Profile.addMaterial(v)` 当场进钱包，**同时**累加 `S.materialEarned`。
     而 `run.materials` **取的就是** `S.materialEarned`（`game.ts:3417`）——
     于是 `applyRun` 里那句 `Profile.addMaterial(run.materials)`
     等于**每一笔材料都进两次钱包**。

   它不报错、不进任何断言，症状只是"材料总是比打到的多"。
   实测过：一局赚 178、花 13、退 6，修之前会入账 184 + 178 − 13 = 349。

   为什么一直没被发现：**同一个字段名 `materials` 有两套含义** ——
   `challenges.ts` 里 `materials: '本局废料'`（读 `r.scrap`），
   而 `applyRun` 读的是材料。两个含义共用一个名字。

   ## 判据

     · 每个 `Profile.addMaterial(` 调用点必须登记在 `MATERIAL_SOURCES` 里，
       并标明它是**产出**还是**退款**
     · **产出只许一处**（多了就是两条入账路径 = 双计的形状）
     · **`applyRun` 里不许出现 `addMaterial`** —— 结算不该再发一遍
       已经在局内发过的东西（这正是那次 bug 的形态）
   ========================================================= */
/* 登记表：`文件:行` → 这是什么。
   ⚠ 行号会漂，所以键用**函数名 + 序号**这种稳一点的形式不好维护；
   这里改用"文件 + 角色"的粒度：一个文件里同一角色只许出现登记的次数。 */
/* ⚠ **`growth` 与材料同一类纪律**：R43 合并那一次踩的坑就是"每一笔收入加了两遍" ——
   结算里写成 `growthForRun(run) + growthForRun(run)`（前者已经是两段之和）。
   所以两个余额用同一份登记表守着。 */
const GROWTH_SOURCES = {
  'profile.ts': { income: 3, refund: 0, why: '三个**合法**入口：`addGrowth` 的定义体 · `applyRun` 的结算 · `settleOffline` 的离线产出' }
};

const MATERIAL_SOURCES = {
  'game.ts': { income: 1, refund: 1, why: '产出走 `gainMaterial`（唯一出口）；退款走 `craft` 放入失败的回滚' },
  'profile.ts': { income: 0, refund: 1, why: '`campBuy` 的退还；**不许有产出**（产出只在 game.ts 的 gainMaterial）' }
};
const materialProblems = [];
try {
  const rows = {};
  for (const f of readDir('src')) {
    if (!f.endsWith('.ts') || f === 'types.d.ts') continue;
    const t = stripComments(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8'));
    const n = (t.match(/Profile\.addMaterial\(/g) || []).length;
    if (n) rows[f] = n;
  }
  const budget = Object.keys(MATERIAL_SOURCES).reduce((s, f) => s + MATERIAL_SOURCES[f].income + MATERIAL_SOURCES[f].refund, 0);
  const now = Object.keys(rows).reduce((s, f) => s + rows[f], 0);
  if (now > budget) {
    materialProblems.push('`Profile.addMaterial` 的调用点从 ' + budget + ' 处涨到 ' + now +
      ' 处（' + Object.keys(rows).map(f => f + '=' + rows[f]).join(' ') + '）—— ' +
      '入账只许有一个出口，多出来那条就是**双重入账**的形状');
  }
  /* ⚠ **`growth` 用同一份纪律**：R43 合并那一次，结算里写成了
     `growthForRun(run) + growthForRun(run)` —— 而前者**已经是两段之和**，
     于是每一笔养成代币都进账两遍（实测 65 → 130）。这一类错误在
     `number` 上看不出来。

   ⚠ **这条判据守得住"多一个入账出口"，但守不住"同一个表达式里调了两次"。**
   R43 那次翻倍正是后者（`growthForRun(run) + growthForRun(run)`，而前者已是两段之和）。
   那一种由**值断言**守：`test/talents.mjs` 与 `test/forge.mjs` 现在写的是
   `round(depth × 倍率) + combine` 这种**按段拆开**的期望 —— 总数错了它们当场红。
   两类守卫各有各的射程，不要指望一条判据包打天下。 */
  const growthRows = {};
  for (const f of readDir('src')) {
    if (!f.endsWith('.ts') || f === 'types.d.ts') continue;
    const t = stripComments(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8'));
    /* 只数**真正进余额**的那一处；`Profile.addGrowth` 的定义体不算（它在 profile.ts） */
    const n = (t.match(/data\.growth \+=/g) || []).length;
    if (n) growthRows[f] = n;
  }
  const gBudget = Object.keys(GROWTH_SOURCES).reduce((s, f) => s + GROWTH_SOURCES[f].income + GROWTH_SOURCES[f].refund, 0);
  const gNow = Object.keys(growthRows).reduce((s, f) => s + growthRows[f], 0);
  if (gNow > gBudget) {
    materialProblems.push('`data.growth +=` 的出现次数从 ' + gBudget + ' 处涨到 ' + gNow +
      ' 处（' + Object.keys(growthRows).map(f => f + '=' + growthRows[f]).join(' ') + '）—— ' +
      '养成代币也只许有一个入账出口（R43 那次翻倍就是这里漏的）');
  }
  /* =========================================================
     **每个模块代币都必须同时有产出点与消费点**（M2 的守卫）
     ---------------------------------------------------------
     v3 §5.1 说模块代币"产出在本模块、**消费在本模块**"。
     这一条最容易变成一句空话：`capacity` 声明了整整一轮，
     而它在全仓**一处读写都没有**（0/0）—— 账本上有一笔钱，游戏里没有。

     为什么是**登记表**而不是命名约定：战斗代币 `scrap` 是散着写的
     （`S.player.scrap += m` 出现在好几处），并不走 `addScrap` 那样的出口。
     约定会漏掉它，登记表不会 —— 表里没有的币**当场报红**。
   ========================================================= */
  const TOKEN_SITES = {
    scrap:    { produce: ['S.player.scrap +=', 'p.scrap +='],  consume: ['p.scrap -=', '.scrap -='],
                note: '战斗代币：局内刷怪掉、商店与合成花' },
    capacity: { produce: ['addCapacity('],   consume: ['spendCapacity('],
                note: '经营代币：每波据点运转产出、盖设施花' },
    growth:   { produce: ['addGrowth('],     consume: ['spendGrowth('],
                note: '养成代币：训练与 NPC 相处产出、天赋与图纸花' }
  };
  const allSrc = readDir('src').filter(f => f.endsWith('.ts') && f !== 'types.d.ts')
    .map(f => stripComments(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8'))).join('\n');
  /* ① 登记表里的每一笔都**真的**有产出与消费 */
  for (const id of Object.keys(TOKEN_SITES)) {
    const spec = TOKEN_SITES[id];
    const hitP = spec.produce.filter(s => allSrc.includes(s));
    const hitC = spec.consume.filter(s => allSrc.includes(s));
    if (!hitP.length) {
      materialProblems.push('模块代币 `' + id + '` **没有产出点**——账本上有它，游戏里产不出来（v3 §5.1）。' +
        '登记表里的候选：' + spec.produce.join(' / '));
    }
    if (!hitC.length) {
      materialProblems.push('模块代币 `' + id + '` **没有消费点**——产得出来但花不掉，' +
        '它就不是一笔钱而是一个计数器（v3 §5.1）。登记表里的候选：' + spec.consume.join(' / '));
    }
  }
  /* ② 账本里声明的模块代币，登记表里一个都不许漏 */
  /* ⚠ **只扫 `currencies: [` 块内**：`eco_manage.ts` 现在还有两个**子模块**，
     它们的 `id: 'build', name: '建造'` 与货币声明**同形** ——
     第一版没分块，于是子模块被当成"没登记的货币"，报了两条假警报。 */
  const declared = [];
  for (const f of readDir('src').filter(x => /^eco_(combat|manage|grow)\.ts$/.test(x))) {
    const src = fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
    const at = src.indexOf('currencies: [');
    if (at < 0) continue;
    /* 从 `currencies: [` 到**同缩进的 `]`** 之间才算货币 */
    const tail = src.slice(at);
    const end = tail.search(/\n\s*\]\s*\n/);
    const block = end >= 0 ? tail.slice(0, end) : tail;
    for (const m of block.matchAll(/id: '([a-z]+)', name:/g)) declared.push(m[1]);
  }
  for (const id of declared) {
    if (!TOKEN_SITES[id]) materialProblems.push('模块代币 `' + id + '` 没有登记产出点与消费点 —— ' +
      '新加一笔模块代币时，要在 `TOKEN_SITES` 里说清它产在哪、花在哪（否则它会变成下一个 0/0）');
  }

  /* =========================================================
     **建造不得承载战斗或养成的成长**（v3 §三-2 末尾那句）
     ---------------------------------------------------------
     「经营模块内部子模块可共享经营代币，但**不得让建造机制承载
       战斗或养成的成长**。」

     这一条是被**真的违反过**才加进来的：据点「档案馆」原有一个
     `bonusPoints`（每局额外给天赋点），后来改指到"训练产出"上 ——
     看着像修好了，其实仍然是**建造机制在承载养成的成长**，只是换了个动作。
     它现在指到产能上（建造 → 经营，**同一模块内**），那才是合法的那条路。
   ========================================================= */
  const buildSrc = stripComments(fs.readFileSync(path.join(ROOT, 'src', 'stronghold.ts'), 'utf8'));
  /* 建造能碰的：材料（全局货币=行动成本）、产能（同模块的兄弟）、核心材料（经营→养成那条边的入口） */
  const FORBIDDEN = /addGrowth|spendGrowth|S\.growth|data\.growth|S\.talents|Talent\.|\.scrap|S\.player\.scrap|addScrap|spendScrap/;
  if (FORBIDDEN.test(buildSrc)) {
    materialProblems.push('`stronghold.ts`（**建造子模块**）里出现了战斗或养成的成长 —— ' +
      'v3 §三-2 明令禁止「让建造机制承载战斗或养成的成长」。' +
      '建造要影响别的模块，只能走**核心素材**那条合法的边。');
  }

  /* =========================================================
     **核心素材的欠账只许缩**（M4 的棘轮）
     ---------------------------------------------------------
     `Link.PENDING` 是「允许有欠账，不允许**悄悄**有欠账」的落点。
     三条边（战斗→经营→养成→战斗）在 M4 全部接上了，所以它现在是**空的** ——
     而「空」这件事本身要被守住：新加一条核心素材却先登记进 PENDING，
     等于把那条边**合法地**留成断的。

     棘轮与迁移预算（判据 I）同一个套路：**只许缩，涨要有人解释**。
   ========================================================= */
  const pendingBudget = 0;
  const linkSrc = fs.readFileSync(path.join(ROOT, 'src', 'link.ts'), 'utf8');
  const pendBlock = /Link\.PENDING = \[([\s\S]*?)\];/.exec(linkSrc);
  if (!pendBlock) {
    materialProblems.push('找不到 Link.PENDING —— 那个数组是「欠账要登记」的落点，不许改名或删掉');
  } else {
    const pendIds = pendBlock[1].match(/id: '[a-z]+'/g) || [];
    if (pendIds.length > pendingBudget) {
      materialProblems.push('核心素材的欠账从 ' + pendingBudget + ' 条涨到 ' + pendIds.length + ' 条（' +
        pendIds.join(', ') + '）—— 每一条欠账都是**一条断掉的边**。' +
        '要么把它接上，要么在提交信息里说清为什么先欠着。');
    }
  }

  /* =========================================================
     **软引导指向的站必须真实存在**（v3 §8-15）
     ---------------------------------------------------------
     `guide.ts` 的每条规则都有一个 `to`（指去哪），而那是**另一个文件**
     （`station.ts`）里的 id —— 两边靠字符串对上，**没有任何类型能拦**。

     指错的后果不是崩溃，是**玩家点过去发现那里什么都没有**：
     软引导最怕的就是"它开始胡说"，而胡说里最难查的一种是"地址写错了"。
   ========================================================= */
  const guideSrc = stripComments(fs.readFileSync(path.join(ROOT, 'src', 'guide.ts'), 'utf8'));
  const stationSrc = stripComments(fs.readFileSync(path.join(ROOT, 'src', 'station.ts'), 'utf8'));
  const stationIds = new Set((stationSrc.match(/id: '[a-z-]+'/g) || []).map(s => s.slice(5, -1)));
  const targets = (guideSrc.match(/to: '[a-z-]+'/g) || []).map(s => s.slice(5, -1));
  for (const to of targets) {
    if (!stationIds.has(to)) {
      materialProblems.push('软引导指向一个不存在的站：`' + to + '` —— ' +
        '玩家点过去会发现那里什么都没有（`guide.ts` 的 `to` 与 `station.ts` 的 id 靠字符串对上）');
    }
  }
  if (!targets.length) materialProblems.push('`guide.ts` 里一条 `to` 都没有 —— 软引导指不了路');

  /* =========================================================
     **双轨守卫**（v3 §8-3）：叙事线**不产经济**
     ---------------------------------------------------------
     `story.ts` 只管「哪句话说得出」，它**一个铜板都不该碰**。
     这一条最容易被下一次改动破坏，而且破了**不会报错** —— 玩家只是发现钱变多了。
   ========================================================= */
  const storySrc = stripComments(fs.readFileSync(path.join(ROOT, 'src', 'story.ts'), 'utf8'));
  const ECON = /addGrowth|spendGrowth|addMaterial|spendMaterial|Profile\.wallet|data\.growth|S\.growth|Ledger\.|Eco\./;
  if (ECON.test(storySrc)) {
    materialProblems.push('`story.ts` 里出现了经济操作 —— 双轨规定：叙事线**不产经济**（v3 §8-3）。' +
      '钱只该由养成线（`Game.talkTo`）与其它模块的动作产生；叙事只负责「哪句话说得出」。');
  }
  /* 反过来：关系表那一份也**只回答关系**，产钱那一句在会话层 */
  const bondsSrc = stripComments(fs.readFileSync(path.join(ROOT, 'src', 'bonds.ts'), 'utf8'));
  if (ECON.test(bondsSrc)) {
    materialProblems.push('`bonds.ts` 里出现了经济操作 —— 它只该回答「关系到哪一步了」，' +
      '产钱那一句在 `game.ts` 的 `Game.talkTo`（那才是「养成线」这个身份）。');
  }

  /* 最锋利的一条：结算里不许再发一遍 */
  const prof = stripComments(fs.readFileSync(path.join(ROOT, 'src', 'profile.ts'), 'utf8'));
  const ap = prof.indexOf('Profile.applyRun = function');
  if (ap >= 0) {
    /* 取 `applyRun` 的函数体（到下一个顶层 `Profile.xxx = function` 为止） */
    const rest = prof.slice(ap + 10);
    const nextTop = rest.search(/\nProfile\.[a-zA-Z]+ = function/);
    const bodyText = nextTop > 0 ? rest.slice(0, nextTop) : rest;
    if (/Profile\.addMaterial\(/.test(bodyText)) {
      materialProblems.push('`Profile.applyRun`（结算）里又出现了 `Profile.addMaterial` —— ' +
        '材料在局内 `gainMaterial` 已经当场入账，这里再发一遍就是**双计**' +
        '（2026-09 实测过：一局赚 178 会入成 356）');
    }
  }
} catch (e) {
  materialProblems.push('判据 J 没能跑起来：' + (e && e.message ? e.message : e));
}
for (const p of materialProblems) problems.push(p);

console.log('\n[9] 入账只许有一个出口（防双重入账）');
if (!materialProblems.length) {
  console.log('  \x1b[32m✔ `Profile.addMaterial` 的调用点在登记内，且 `applyRun` 里没有它\x1b[0m');
  for (const f of Object.keys(MATERIAL_SOURCES)) {
    console.log('    \x1b[90m' + f + '：产出 ' + MATERIAL_SOURCES[f].income +
      ' / 退款 ' + MATERIAL_SOURCES[f].refund + ' —— ' + MATERIAL_SOURCES[f].why + '\x1b[0m');
  }
} else {
  console.log('  \x1b[31m✘ ' + materialProblems.length + ' 处：\x1b[0m');
  for (const p of materialProblems) console.log('    · ' + p);
}

/* =========================================================
   判据 K：**断言库的迁移预算**（只许降）
   ---------------------------------------------------------
   问题（用户提的"试错成本很大"）：原本 **55 套各自复制了一份 `ok()`**。
   56 份副本带来两件坏事：
     · 改一处要改 56 遍
     · 失败只打一行、两个值要作者手拼；而且**一条断言抛异常就炸掉整套**
       —— 它后面的几十条一条都不跑，只能一条一条解锁

   共享库 `test/_assert.mjs` 解决这三件（`T.eq` 打出两个值、
   `T.try` 抛了继续跑、`T.done()` 给出带分节的失败清单）。

   这是一次**逐套迁移**，所以做成预算：数字只许降。
   搬完一套就调小 `ASSERT_BUDGET`；**再抄一份 `ok()` 会被当场拦下**。
   ========================================================= */
const ASSERT_BUDGET = 54;   // 2026-09：55 套 - 已迁移的 craft.mjs
const assertProblems = [];
let assertsOwn = 0;
try {
  for (const f of fs.readdirSync(path.join(ROOT, 'test'))) {
    if (!f.endsWith('.mjs') || f.startsWith('_')) continue;
    const src = fs.readFileSync(path.join(ROOT, 'test', f), 'utf8');
    if (/^function ok\(/m.test(src)) assertsOwn++;
  }
  if (assertsOwn > ASSERT_BUDGET) {
    assertProblems.push('自带 `ok()` 的套件从 ' + ASSERT_BUDGET + ' 套涨到 ' + assertsOwn +
      ' 套 —— 新套件请用 `test/_assert.mjs` 的 `T`，不要再抄一份');
  }
} catch (e) { assertProblems.push('判据 K 没能跑起来：' + (e && e.message ? e.message : e)); }
for (const p2 of assertProblems) problems.push(p2);

console.log('\n[10] 断言库的迁移预算（只许降）');
if (!assertProblems.length) {
  console.log('  \x1b[32m✔ ' + assertsOwn + ' / ' + ASSERT_BUDGET + ' 套还自带 `ok()`（已迁移 ' +
    (ASSERT_BUDGET - assertsOwn + (55 - ASSERT_BUDGET)) + ' 套）\x1b[0m');
  console.log('    \x1b[90m共享库：test/_assert.mjs —— T.eq 打两个值 · T.try 抛了继续 \u00b7 T.done 带分节汇总\x1b[0m');
} else {
  console.log('  \x1b[31m✘ ' + assertProblems.length + ' 处\x1b[0m');
  for (const p3 of assertProblems) console.log('    · ' + p3);
}

console.log('\n=== 结果 ===');
if (!problems.length) console.log('  \x1b[32m✔ 无漂移：每个工具都能被调到，每套测试都有名字\x1b[0m');
else {
  console.log('  \x1b[31m✘ ' + problems.length + ' 处漂移：\x1b[0m');
  for (const p of problems) console.log('    · ' + p);
}
console.log('');
process.exit(problems.length ? 1 : 0);
