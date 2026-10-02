/* =========================================================
   arch.mjs — 架构：**系统分层**与依赖方向

   这一套测的不是"某个模块能不能 import 某个模块"（那些单点规则在
   test/ui-check.mjs 的 FORBID 表里，逐模块断言），而是**系统级**的三件事：

     1. 每个模块都属于某个系统（没有"无家可归"的模块）
     2. 跨系统的依赖**只能从高层指向低层**；向上的边必须逐条登记理由
     3. 世界状态的**写入者**是有名单的（模拟层的状态不许被界面/渲染偷偷改）

   外加一条最要紧的：**校验自己的精度**。
   tools/arch-audit.cjs 的 [7] 节曾经 6 条"无引用，可删"里 6 条是活的
   （精度 0%），而它的结论是"可删" —— 一条会叫人删活代码的校验比没有校验更糟。
   这里把那段历史钉成回归清单。

   用法： node test/arch.mjs
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');
const require = createRequire(import.meta.url);

let failures = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  \x1b[32mPASS\x1b[0m ' + label);
  else { failures++; console.log('  \x1b[31mFAIL\x1b[0m ' + label + (extra !== undefined ? '  → ' + extra : '')); }
}

const { analyze } = require('../tools/arch-audit.cjs');
const { SYSTEMS, EXCEPTIONS, BY_ID, SYS_OF } = require('../tools/systems.cjs');

console.log('\n=== Bronana · 架构 / 系统分层 ===\n');
const A = analyze();
const srcFiles = fs.readdirSync(SRC).filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'));

/* ---------------- 1. 系统模型本身要自洽 ---------------- */
console.log('[1] 系统模型');
{
  const ids = SYSTEMS.map(s => s.id);
  ok(ids.length === new Set(ids).size, '系统 id 不重复（' + ids.join(' / ') + '）');
  const levels = SYSTEMS.map(s => s.level);
  ok(new Set(levels).size === levels.length, '层号不重复（' + levels.join(' ') + '）');
  const sorted = levels.slice().sort((a, b) => a - b);
  ok(sorted[0] === 0 && sorted[sorted.length - 1] === sorted.length - 1,
    '层号从 0 连续到 ' + (sorted.length - 1) + '（不留空洞，否则"第几层"没有意义）');

  // 每个模块恰好属于一个系统
  const seen = {};
  const dup = [];
  for (const s of SYSTEMS) for (const m of s.modules) {
    if (seen[m]) dup.push(m + '（' + seen[m] + ' 与 ' + s.id + '）');
    seen[m] = s.id;
  }
  ok(dup.length === 0, '没有模块被两个系统同时认领', dup.join(', '));
  ok(A.systems.unassigned.length === 0,
    '全部 ' + srcFiles.length + ' 个模块都归了组（没有"无家可归"的模块）',
    A.systems.unassigned.join(', '));
  const ghost = SYSTEMS.flatMap(s => s.modules).filter(m => srcFiles.indexOf(m) < 0);
  ok(ghost.length === 0, '系统表里没有已经删掉的模块（表与实际文件一致）', ghost.join(', '));
  for (const s of SYSTEMS) {
    ok(typeof s.note === 'string' && s.note.length > 8, s.name + ' 写了"这个系统是干什么的"');
  }
}

/* ---------------- 2. 依赖方向：只许从高层指向低层 ---------------- */
console.log('\n[2] 跨系统依赖方向（只允许 高层 → 低层）');
{
  /* analyze() 的 violations 是"低层认识高层"。它必须与 EXCEPTIONS 一一对应：
     多一条 = 有人新加了一条向上依赖（要么改掉，要么去 systems.cjs 写清理由）；
     少一条 = 登记过期了，该删。 */
  const key = v => v.from + '→' + v.to;
  const actual = A.systems.violations.map(key);
  const declared = EXCEPTIONS.map(e => e.from + '→' + e.to);
  const undeclared = actual.filter(k => declared.indexOf(k) < 0);
  const stale = declared.filter(k => actual.indexOf(k) < 0);
  ok(undeclared.length === 0,
    '没有任何**未登记**的向上依赖（' + actual.length + ' 条向上边，全部有理由）',
    undeclared.map(k => { const v = A.systems.violations.find(x => key(x) === k); return k + ' ' + v.list.join(' '); }).join(' | '));
  ok(stale.length === 0, 'EXCEPTIONS 里没有过期登记（登记了但边已经不在了）', stale.join(', '));
  for (const e of EXCEPTIONS) {
    ok(typeof e.why === 'string' && e.why.length > 20, '例外 ' + e.edge + ' 写清了理由');
    const norm = t => String(t).replace(/\s+/g, '');
    const v = A.systems.violations.find(x => key(x) === e.from + '→' + e.to);
    ok(!!v && v.list.map(norm).indexOf(norm(e.edge)) >= 0,
      '例外 ' + e.edge + ' 与实测的边对得上（不是写个名字就算）',
      v ? v.list.join(',') : '（这条边不存在）');
  }

  /* 三条最要紧的方向，单独点名（它们错了就是架构塌了，不该只靠"没登记"兜底） */
  const has = (from, to) => A.systems.violations.some(v => v.from === from && v.to === to);
  ok(!has('sim', 'view'), '模拟内核**不认识**表现/界面层（一帧的行为只由 (状态, dt, 输入载荷) 决定）');
  ok(!has('view', 'boot') && !has('art', 'boot'), '表现层与造型层都不依赖入口');
  ok(!has('mech', 'data') && !has('mech', 'sim'), '工具与机制层不认识任何玩法概念（它在最底下）');

  const gameDeps = A.mods['game.ts'].deps;
  ok(gameDeps.indexOf('input.ts') < 0, 'game.ts 不 import input.ts（慢走由输入载荷带进来）', gameDeps.join(','));
  ok(gameDeps.indexOf('audio.ts') < 0, 'game.ts 不 import audio.ts（音效改为广播 `sfx` 意图）', gameDeps.join(','));
  ok(gameDeps.indexOf('ui.ts') < 0 && gameDeps.indexOf('render.ts') < 0,
    'game.ts 不认识渲染层与界面层（这一条 ui-check 也守着，这里从系统级再看一次）');
}

/* ---------------- 3. 状态所有权：谁在写世界状态 ---------------- */
console.log('\n[3] 世界状态（会话 S）的写入者');
{
  /* 光看 `S.<字段> = …` 是不够的：`S` 这个字母在不同模块里是**不同的东西** ——
     在 sprites.ts 里它是贴图命名空间的自身字段（`S.kinds = {}`、`S.setScale = …`）。
     所以先取出"会话真正的字段名"（types.d.ts 里 7 个 Session* 接口的字段），
     只有写到这些字段才算写世界状态。
     改造前的粗测把 sprites.ts 的 27 个 API 定义算成了 27 次状态写入。 */
  const typesSrc = fs.readFileSync(path.join(SRC, 'types.d.ts'), 'utf8');
  const sessionFields = new Set();
  for (const m of typesSrc.matchAll(/^interface (Session\w*)\s*\{([\s\S]*?)^\}/gm)) {
    for (const f of m[2].matchAll(/^\s{2}([A-Za-z_$][\w$]*)\s*[:?]/gm)) sessionFields.add(f[1]);
  }
  ok(sessionFields.size >= 60, '会话字段名从 types.d.ts 取到（' + sessionFields.size + ' 个）');

  /* 允许写世界状态的名单。**按字段**给，而不是按文件给：
     emit.ts 是粒子池那套机制，池子存在会话上（`S.particles` 等），
     所以它只许写池子那 6 个字段，不许碰别的。
     main.ts / demo.ts 是**摆场景的实验台**（`?test=` / `?still=` / 截图与测试夹具），
     它们本来就在"人为构造一个状态"，所以按字段放出它们真正写的那几个。 */
  const ALLOWED = {
    'game.ts': '*',
    'market.ts': '*',
    /* 房间层（从 `game.ts` 拆出来的）：它写的是**位置**——
       `floor` / `map` / `roomId`（翻层、进门、迷雾标记）。
       这三个字段本来就该由"玩家在这一层走到哪了"那一层写：
       留在 `game.ts` 里时它们是"上帝对象的一角"，拆出来之后它们是
       **一个模块的全部职责**。写在这里而不是放宽判据，是因为
       "谁可以写世界状态"这张名单本身就是这份架构的声明。 */
    'chamber.ts': ['floor', 'map', 'roomId'],
    /* 打中痕迹（从 `game.ts` 拆出来的）：它写的是**贴花缓冲自己的游标与预算**——
       `decalCursor`（环形缓冲写到哪了）与 `stainBudget`（这一秒还能溅几块）。
       这两个字段**只有它读**，但它们是会话字段（要跟着存档重置），所以不能
       变成模块级变量 —— 那样换局时它们不会归零。 */
    'impact.ts': ['decalCursor', 'stainBudget'],
    'emit.ts': ['particles', 'textParticles', 'freeParticles', 'freeTextParticles', 'visCursor', 'textCursor'],
    // 实验台：把这一间清空 / 直接改统计，好让某一屏拍得出来（不是玩法路径）
    'demo.ts': ['combineCount'],
    'main.ts': ['waveLeft', 'spawnQueue', 'spawnIdx', 'enemies']
  };
  const writers = {};
  for (const f of srcFiles) {
    const s = fs.readFileSync(path.join(SRC, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    /* 会话的**别名**也算：以前这里只认字面量 `S.`，于是 render.ts 里的
       `sess.bannerT = …` / `sess.bannerText = …`（渲染层在写世界状态）
       从来没被这条规则看见 —— 报出来的永远是"渲染只读"，而它在写。
       别名从源码里学（`= Game.getSession()` / `= Game.newRun(`），另加 `sess`
       这个约定俗成的会话参数名（**函数参数学不出来**，所以显式列上）。
       残留的盲区写在门禁输出里：换个新名字当会话别名的写法会漏。 */
    const ids = new Set(['S', 'sess']);
    for (const m of s.matchAll(/(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*Game\.(?:getSession|newRun)\s*\(/g)) ids.add(m[1]);
    const re = new RegExp('(^|[^A-Za-z0-9_.$])(?:' + [...ids].join('|') +
      ')\\.([A-Za-z_][A-Za-z0-9_]*)\\s*(=[^=]|\\+\\+|--|\\+=|-=|\\*=)', 'g');
    const hit = new Set();
    for (const m of s.matchAll(re)) {
      if (!sessionFields.has(m[2])) continue;              // 不是会话字段 → 是别的同名变量
      const after = s.slice(m.index + m[0].length, m.index + m[0].length + 9);
      if (/^\s*function/.test(after)) continue;            // `S.foo = function` 是 API 定义
      hit.add(m[2]);
    }
    if (hit.size) writers[f] = [...hit];
  }
  const intruders = Object.keys(writers).filter(f => !ALLOWED[f]);
  ok(intruders.length === 0,
    '写世界状态的只有 ' + Object.keys(ALLOWED).join(' / ') + '（' +
    Object.entries(writers).map(([f, v]) => f + ' ' + v.length + ' 字段').join(' · ') +
    '）—— 渲染 / 界面 / 元进度都只读（别名写法：S / sess / Game.getSession() 赋值的名字）',
    intruders.map(f => f + ' ' + writers[f].join(',')).join(' | '));
  const overreach = [];
  for (const [f, fields] of Object.entries(writers)) {
    const allow = ALLOWED[f];
    if (!allow || allow === '*') continue;
    for (const k of fields) if (allow.indexOf(k) < 0) overreach.push(f + '.' + k);
  }
  ok(overreach.length === 0, '被允许的写入者也没有越界写别人的字段', overreach.join(', '));
  ok(writers['game.ts'] && writers['game.ts'].length >= 40,
    '模拟内核确实是世界状态的主要持有者（game.ts 写了 ' +
    (writers['game.ts'] ? writers['game.ts'].length : 0) + ' 个字段）');
}

/* ---------------- 4. 音效意图：模拟广播 ⇄ 入口接入 ---------------- */
console.log('\n[4] 跨系统的"契约"：模拟广播的音效意图');
{
  const gameSrc = fs.readFileSync(path.join(SRC, 'game.ts'), 'utf8');
  const mainSrc = fs.readFileSync(path.join(SRC, 'main.ts'), 'utf8');
  const emitted = new Set([...gameSrc.matchAll(/\bsfx\(\s*'([a-z]+)'/g)].map(m => m[1]));
  const table = /var SFX_BY_INTENT[^{]*\{([\s\S]*?)\n\};/.exec(mainSrc);
  const wired = new Set(table ? [...table[1].matchAll(/^\s{2}([a-z]+)\s*:/gm)].map(m => m[1]) : []);
  const missing = [...emitted].filter(k => !wired.has(k));
  const deadKey = [...wired].filter(k => !emitted.has(k));
  ok(emitted.size > 0, '模拟层确实在广播音效（' + [...emitted].join('/') + '）');
  ok(missing.length === 0,
    '模拟广播的每一种音效意图，入口都接上了（写错一个名字的表现是"那个音不响"，无声无息）',
    missing.join(','));
  ok(deadKey.length === 0, '接入表里没有模拟永远不会发的死键', deadKey.join(','));
}

/* ---------------- 4b. 入口的按键分发：调试热键不许吃掉玩家的绑定键 ---------------- */
console.log('\n[4b] 热键：绑定键优先（`Input.once` 读一次就清边沿）');
{
  const mainCode = fs.readFileSync(path.join(SRC, 'main.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  /* 实测过的 bug：默认暂停键是 `p`，而"结束录制"那条**裸读** `Input.once('p')` ——
     一次 keydown(p) 的边沿在那一行就被消费掉，`pauseKeyPressed()` 读到的永远是 false，
     于是**默认暂停键从来没生效过**（当时只测了 Esc，所以没发现）。
     规则：第三个暂停键（可改的那个）必须在 `hotkeys()` **最前面**先读一次，
     剩下的裸读只许是"刻意复用为菜单导航"的 wasd。
     默认键位取自 input.ts / settings.ts（`test/input.mjs [10]` 另有断言钉住两边一致）。 */
  const DEFAULTS = ['w', 's', 'a', 'd', 'p'];
  const MENU_REUSE = ['w', 'a', 's', 'd'];   // 非战斗场景里方向键的替补（刻意复用移动键）
  const bare = [...mainCode.matchAll(/(?<![\w$.])Input\.once\(\s*'([^']+)'\s*\)/g)].map(m => m[1]);
  const stolen = bare.filter(k => DEFAULTS.indexOf(k) >= 0 && MENU_REUSE.indexOf(k) < 0);
  ok(stolen.length === 0,
    '入口没有裸读"可改的暂停键"（裸读 = 把这一帧的边沿抢走，玩家的键就变死键）',
    stolen.join(',') + '（裸读的全部：' + [...new Set(bare)].join(' ') + '）');
  ok(/var pauseThird\s*=\s*[^;]*Input\.once\(pauseBind\)/.test(mainCode) &&
    /pauseKeyPressed\(pauseThird\)/.test(mainCode) && !/pauseKeyPressed\(\s*\)/.test(mainCode),
    '第三个暂停键在 hotkeys() 最前面先读一次（谁先读谁拿到边沿；排在它前面的裸读会把它吃掉）');
  ok(/function debugKey\(k\)\s*\{[\s\S]{0,300}isBoundKey\(k\)[\s\S]{0,80}Input\.once\(k\)/.test(mainCode),
    '调试热键走 `debugKey`（先判"这是不是玩家的绑定键"，再读边沿）');
}

/* ---------------- 5. 校验自己的精度（回归清单） ---------------- */
console.log('\n[5] 架构校验的精度（它曾经 6 条全错，且结论是"可删"）');
{
  /* 这 6 条曾经被 [7] 节报成「无引用，可删」。三个原因：
       · `globalThis.UI.actNames()` —— 成员正则的左边界 `(?<![\w$.])` 把 `.` 挡掉了
       · `const UIx = globalThis.UI` —— 别名从没被登记
       · `record.ts` 的 `'autoExplore'` 字符串 → `Game[name]` 动态派发
     现在它们必须出现在"活"或"静态判不了"里，不许再出现在"无引用"里。

     **名字要拼出来写**：语料是**全仓库**的，如果这个文件里直接写一个
     `Game.autoExplore` 字面量，校验就会把它当成一处真实引用 —— 于是这条断言
     永远通过，而它守的东西可能早就坏了（第一版就是这样自我实现的）。
     下面 `LIVE_GOLDEN` 用数组拼装，就是为了不在语料里留下这些名字。 */
  const LIVE_GOLDEN = [
    ['Game', 'auto' + 'Explore'],
    ['UI', 'act' + 'Groups'],
    ['UI', 'act' + 'Names'],
    ['market.ts', 'Market' + 'Ctx'],
    ['market.ts', 'Market' + 'Api'],
    ['market.ts', 'make' + 'Market']
  ];
  /* 自我实现的检查：语料是**去掉注释之后**的文本（tools/arch-audit.cjs 的 stripComments），
     所以这里也必须先剥注释再比 —— 否则"注释里提到了这个名字"会被误判成污染。 */
  const selfSrc = fs.readFileSync(new URL(import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const polluting = LIVE_GOLDEN.filter(([a, b]) =>
    selfSrc.indexOf(a.indexOf('.ts') > 0 ? a + ' → ' + b : a + '.' + b) >= 0);
  ok(polluting.length === 0,
    '这条守卫没有在语料里留下它要守的名字（否则它会自我实现：校验把守卫的字面量当成引用）',
    polluting.map(x => x.join('.')).join(','));

  const deadText = A.unused.dead.concat(A.members.dead).join(' | ');
  const wrongly = LIVE_GOLDEN.filter(([, b]) => deadText.indexOf(b) >= 0);
  ok(wrongly.length === 0,
    '历史误报的 6 条已知活代码，一条都没有再被判成"无引用"', wrongly.map(x => x.join('.')).join(','));
  const internals = A.unused.internal.concat(A.members.internal);
  ok(A.members.dead.length === 0 && A.unused.dead.length === 0,
    '本次扫描：**"无引用，可删"为空**（' + internals.length + ' 条只在本文件内用 · ' +
    A.members.dynamic.length + ' 条静态判不了）',
    A.unused.dead.concat(A.members.dead).join(', '));

  /* 校验必须能看见那三种测试写法 —— 拿两条**只被测试/字符串引用**的活成员反证。
     注意：**标签文字里也不能出现这些名字**（有一个"污染"断言专门守这件事）。 */
  const actNames = LIVE_GOLDEN[2][0] + '.' + LIVE_GOLDEN[2][1];
  ok(!A.members.dead.some(x => x.indexOf(LIVE_GOLDEN[2][1]) >= 0),
    '只被测试以 globalThis / 别名两种写法引用的那个成员，没有被判死（' + actNames + '）');

  /* 动态派发那一条必须走"静态判不了"这一档，而不是被悄悄算成"活"：
     它只出现在录制层的命令字符串表里，靠 `Game[cmd]` 才被调到。 */
  ok(A.members.dynamic.some(x => x.indexOf(LIVE_GOLDEN[0][1]) >= 0),
    '只经字符串表 + 动态派发引用的那个成员，落在"静态判不了"里，没有冒充"活"',
    A.members.dynamic.join(', '));
  ok(!A.members.internal.some(x => x.indexOf(LIVE_GOLDEN[0][1]) >= 0),
    '它也没有被误判成"只在本文件内用"（它连本文件都没调用）');
}

/* ---------------- 6. 依赖图无环 ---------------- */
console.log('\n[6] 依赖图');
{
  ok(A.cycles.length === 0, srcFiles.length + ' 个模块的依赖图无环（初始化顺序可预测）', A.cycles.join(' | '));
  const selfLoop = srcFiles.filter(f => A.mods[f].deps.indexOf(f) >= 0);
  ok(selfLoop.length === 0, '没有模块 import 自己', selfLoop.join(','));
  const layered = SYSTEMS.slice().sort((a, b) => a.level - b.level);
  let up = 0, down = 0;
  for (const s of layered) {
    for (const e of Object.values(A.systems.edges)) {
      if (e.from !== s.id) continue;
      if (BY_ID[e.to].level < s.level) down += e.list.length; else up += e.list.length;
    }
  }
  ok(down > up * 5,
    '依赖方向压倒性地向下（顺层 ' + down + ' 条 vs 向上 ' + up + ' 条，比例 ' +
    (down / Math.max(1, up)).toFixed(1) + ':1）');
}

/* ---------------- 7. 引擎的模块表 ↔ 审计的系统表 ↔ 真实的 import 图 ---------------- */
console.log('\n[7] 模块表（`src/module.ts`）与系统表（`tools/systems.cjs`）对账');
{
  /* 为什么需要这一节：**同一个事实有两张表，而它们谁也读不到谁** ——
       · `tools/systems.cjs` —— **审计视角**（9 个系统 · 层号 · 例外清单），住在 `tools/`；
       · `src/module.ts`     —— **引擎视角**（引擎有哪 9 块 · 自己声明依赖），住在 `src/`。
     `src/` 不许 import `tools/`（那是宿主侧的东西），所以"两份真相"只能靠**对账**消掉：
     这里拿**真实的 import 图**当裁判，把两张表钉在一起。

     判据的主体写成**纯函数** `auditTables()`（给表、回问题）—— 于是本节的最后一段能
     **注入坏数据跑同一段判据**，证明它真的会红（家法：一条不会失败的审计等于装饰）。 */
  const { Module } = await import('../src/module.ts');
  const lvl = {};
  for (const s of SYSTEMS) lvl[s.id] = s.level;

  /* 真实依赖：系统级的**直接**边（含向上的那些 —— 向上的必须逐条登记） */
  const real = {};
  for (const s of SYSTEMS) real[s.id] = [];
  for (const e of Object.values(A.systems.edges)) real[e.from].push(e.to);
  for (const k of Object.keys(real)) real[k] = [...new Set(real[k])].sort();

  const clone = () => Module.LIST.map(m => ({
    id: m.id, note: m.note,
    requires: (m.requires || []).slice(), alsoNeeds: (m.alsoNeeds || []).slice()
  }));

  function auditTables(mods, realDeps, systems, exceptions) {
    const p = [];
    const lv = {}; for (const s of systems) lv[s.id] = s.level;
    const sysIds = systems.map(s => s.id).slice().sort();
    const modIds = mods.map(m => m.id).slice().sort();
    if (modIds.join(',') !== sysIds.join(',')) {
      p.push('id 集合不一致：模块表 [' + modIds.join(' ') + '] vs 系统表 [' + sysIds.join(' ') + ']');
    }
    for (const m of mods) {
      const req = (m.requires || []).slice().sort();
      const up = (m.alsoNeeds || []).slice().sort();
      for (const r of req) {
        if (lv[r] === undefined) p.push(m.id + '：`requires` 指向一个不存在的模块 ' + r);
        else if (!(lv[r] < lv[m.id])) {
          p.push(m.id + '（L' + lv[m.id] + '）：`requires` 必须指向**严格更低层**，而 ' +
            r + ' 是 L' + lv[r] + ' —— 向上的依赖只能写进 `alsoNeeds` 并登记例外');
        }
      }
      for (const u of up) {
        if (lv[u] === undefined) p.push(m.id + '：`alsoNeeds` 指向一个不存在的模块 ' + u);
        else if (!(lv[u] > lv[m.id])) {
          p.push(m.id + '（L' + lv[m.id] + '）：`alsoNeeds` 是**向上**的例外，而 ' + u + ' 是 L' + lv[u]);
        }
      }
      const want = req.concat(up).sort().join(' ');
      const got = (realDeps[m.id] || []).slice().sort().join(' ');
      if (want !== got) {
        p.push(m.id + '：**声明与真实的 import 图对不上** —— 声明 [' + want + '] vs 真实 [' + got + ']');
      }
    }
    /* 向上的真实边必须**逐条**登记在 EXCEPTIONS 里（与门 `audit` 那条纪律同一个出处） */
    const reg = exceptions.map(e => e.from + '→' + e.to).sort();
    const realUp = [];
    for (const m of mods) {
      for (const d of (realDeps[m.id] || [])) if (lv[d] > lv[m.id]) realUp.push(m.id + '→' + d);
    }
    realUp.sort();
    if (realUp.join(' ') !== reg.join(' ')) {
      p.push('向上的真实边 [' + realUp.join(' ') + '] 与 EXCEPTIONS [' + reg.join(' ') + '] 对不上');
    }
    return p;
  }

  const bad = auditTables(clone(), real, SYSTEMS, EXCEPTIONS);
  ok(bad.length === 0,
    '模块表 · 系统表 · **真实 import 图** 三者一致（id 集合 / requires 向下 / alsoNeeds 向上 / 例外逐条登记）',
    bad.join(' | '));

  /* 顺序：拓扑序必须真的满足 `requires`，而且**确定**（同一份表跑两次一样） */
  const order = Module.order();
  ok(order.length === Module.LIST.length, '拓扑序排出了全部 ' + Module.LIST.length + ' 个模块', order.join(' '));
  const pos = {}; order.forEach((id, i) => { pos[id] = i; });
  const late = Module.LIST.filter(m => (m.requires || []).some(r => pos[r] > pos[m.id]));
  ok(late.length === 0, '每个模块都排在它 `requires` 的后面（顺序不是 import 顺序，是算出来的）',
    late.map(m => m.id).join(','));
  ok(Module.order().join(',') === order.join(','), '拓扑序是**确定**的（同层按 id 字典序，跑两次一样）');
  ok(Module.audit().ok, '引擎自己的 `Module.audit()` 通过（表自洽 + 当前清单的开关成立）',
    Module.audit().problems.join(' | '));

  /* 开关判据**真的接在真实图上**：禁用 X 时报出的模块，必须恰好是真实依赖 X 的那些 */
  const wrong = [];
  for (const X of Module.LIST.map(m => m.id)) {
    const reported = Module.check({ modules: { disabled: [X] } })
      .map(s => (/^`([a-z]+)` 是启用的/.exec(s) || [])[1]).filter(Boolean).sort();
    const dependents = Module.LIST.map(m => m.id).filter(id => (real[id] || []).indexOf(X) >= 0).sort();
    if (reported.join(',') !== dependents.join(',')) {
      wrong.push(X + '：报出 [' + reported.join(' ') + '] vs 真实依赖者 [' + dependents.join(' ') + ']');
    }
  }
  ok(wrong.length === 0,
    '「被禁用的模块不得被任何启用的模块依赖」在 9 个模块上逐一与**真实图**对齐',
    wrong.join(' | '));

  /* ---- 注入坏数据：证明上面这段判据会红（四条，各对应一类真错）---- */
  const injections = [
    ['声明漏了一条依赖（删掉 data 的 mech）', () => {
      const c = clone(); c.find(m => m.id === 'data').requires = [];
      return auditTables(c, real, SYSTEMS, EXCEPTIONS);
    }],
    ['依赖写了个不存在的模块', () => {
      const c = clone(); c.find(m => m.id === 'art').requires.push('ghost');
      return auditTables(c, real, SYSTEMS, EXCEPTIONS);
    }],
    ['把一条**向上**的依赖写成 `requires`（该进 alsoNeeds 的）', () => {
      const c = clone(); c.find(m => m.id === 'art').requires.push('view');
      return auditTables(c, real, SYSTEMS, EXCEPTIONS);
    }],
    ['example 例外没登记（清掉 sim 的 alsoNeeds）', () => {
      const c = clone(); c.find(m => m.id === 'sim').alsoNeeds = [];
      return auditTables(c, real, SYSTEMS, EXCEPTIONS);
    }],
    ['两张表的 id 集合漂了（系统表少一个）', () => auditTables(clone(), real, SYSTEMS.slice(1), EXCEPTIONS)]
  ];
  const missed = injections.filter(([, run]) => run().length === 0).map(([name]) => name);
  ok(missed.length === 0,
    '五种注入（漏依赖 / 幽灵依赖 / 向上写成 requires / 例外没登记 / 两表漂开）**都会红**',
    missed.join(' | '));
}

console.log('\n=== 结果 ===');
if (failures === 0) { console.log('\x1b[32m全部通过 ✔\x1b[0m\n'); process.exit(0); }
console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m\n');
process.exit(1);
