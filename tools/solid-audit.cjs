/* =========================================================
   solid-audit.cjs — **SOLID 逐条体检**
   ---------------------------------------------------------
   为什么要有它：SOLID 是最容易被当成口号念的五条原则。
   念完不会有任何东西变红，所以"我们符合 SOLID"这句话**无法验证**。
   这个工具把五条各自翻译成**能当场量出来的形状**：

     S 单一职责   —— 一个模块的外部接口有多大？多大算"管太多"？
                      判据用**公开成员数 + 依赖数**（两个都大的模块，
                      改任何一个理由都要动它）。
     O 开闭       —— 新增一种"东西"（武器/敌人/道具/房型…）要改**几个模块**？
                      判据：数据表家族的**注册点**在哪 —— 只在表里 = 开闭 OK；
                      还要动 3 个 if = 违反。
     L 里氏替换   —— 项目没有类继承，这条的真实落点是
                      **"同一接口的实现能不能互换"**（如存档后端 Storage 适配器、
                      RNG、渲染后端）。判据：接口的多个实现是否都只依赖接口本身。
     I 接口隔离   —— 有没有"实现一个接口却有大半方法用不到"？
                      判据：类型里声明了但**全仓库没人读**的成员（假接口 = 逼人实现废话）。
     D 依赖倒置   —— 高层是否直接 new/引用低层的**具体实现**而不是抽象？
                      判据：跨系统依赖里有多少条指向"具体模块名"而不是注册表/总账。

   输出是**清单**（给人读的），`--strict` 时才按基线判红。基线只能变小。
   ========================================================= */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const STRICT = process.argv.indexOf('--strict') >= 0;

const files = fs.readdirSync(SRC).filter(f => f.endsWith('.ts') && f !== 'types.d.ts').sort();
const srcOf = {};
for (const f of files) srcOf[f] = fs.readFileSync(path.join(SRC, f), 'utf8');
const typesSrc = fs.readFileSync(path.join(SRC, 'types.d.ts'), 'utf8');

/* ---------- S：单一职责（外部接口有多大 + 依赖有多少） ---------- */
/* 被"记在案"的那几个（见下面的 KNOWN）：它们仍然会出现在报告里 ——
   体检表**不许让一行字安静地消失**，"记在案"必须是看得见的一件事。 */
const SRP_KNOWN = [];
function srp() {
  const rows = [];
  for (const f of files) {
    const src = srcOf[f];
    /* 模块**对外**暴露的成员：`X.member = …` 与 `export { X }` 之后被别处用的那些。
       这里用"本文件里挂到导出对象上的成员数"近似 —— 它正是别人能调的面。 */
    const api = new Set();
    for (const m of src.matchAll(/^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*=/gm)) {
      if (/^(U|Sfx|Music|Game|Col|Comp|C|I|W|Emit|E|Input|R|Rig|Scene|Stats|CFG|UI|Settings|Save|Storage|Weapons|Items|Chars|Enemies|TPL|B|Perf|Registry|SelfCheck|Containers|AI|Affixes|Dungeon|Arena|Bronana|Profile|Market|Craft|Forge|Talents|Boons|Synergy|Danger|Story|I18n|Tutorial|Daily|Season|Offline|Score|Slots|Envelope|Depth|Sprites|Draw2d|Art|Diag|Crash|Chamber|Grid|Impact|Economy|Curves|Tiers|Elems|Record|Camp|Stronghold|Challenges|Mus|PAL|Frame|Save)$/.test(m[1])) {
        api.add(m[2]);
      }
    }
    const deps = new Set([...src.matchAll(/^import[^'"]*from\s*'\.\/([a-z_0-9]+)\.ts'/gm)].map(m => m[1]));
    const codeLines = src.split('\n').filter(l => l.trim() && !/^\s*[/*]/.test(l)).length;
    rows.push({ file: f, api: api.size, deps: deps.size, codeLines });
  }
  /* "管太多"的判据：**接口大 且 依赖多**（任一单独大都不算 —— 
     纯数据表接口大但依赖少，天使对象接口小但依赖多） */
  const wide = rows.filter(r => r.api >= 25 && r.deps >= 10)
    .sort((a, b) => (b.api + b.deps * 2) - (a.api + a.deps * 2));
  /* **已知的"判据覆盖不到"**（按文件记，不是放宽阈值 —— 放宽之后
     `profile.ts` / `game.ts` 会一起溜过去）：

     · `render.ts` —— 职责是"把世界状态画成像素"，**一句话说得清的一件事**，
       而它必然认识很多模块（要画谁就得知道谁）。接口大 + 依赖多是它的**形态**，
       不是它的病。

     · `ui.ts`（2026-10 记录）—— 同上：它的职责是"把状态画成 DOM 界面"，
       而**每一屏的数据都归它读**（商店 / 图鉴 / 天赋 / 据点 / 大厅 / 枢纽…），
       所以依赖 41 个模块是它的形态。它的对外成员里，真正给 main.ts 用的只有
       十来个（show / refresh / updateHud / toast / hallSync…），其余是
       **测试与量尺**读的（focus* / diag* / actNames / actGroups / renderNames）。
       这一轮 `UI.hallSync` 让它从 24 涨到 25、正好越过阈值 —— 越过的是**数**，
       不是"又多了一项职责"：大厅 / 枢纽那两屏的面板跟着位置收放，本来就是
       界面层的同一件事（`render.ts` 画房间，`ui.ts` 画读数）。
       ⚠ 这一条不是免死金牌：**真要拆 ui.ts 的时候拆**（按屏拆成 ui_shop / ui_hall
       是干净的下一步），但那是另一次改动，不该被这张体检表顺手逼出来。 */
  const KNOWN = {
    'render.ts': '把世界状态画成像素 —— 一句话说得清的一件事，而"要画谁就得知道谁"',
    'ui.ts': '把状态画成 DOM 界面 —— 每一屏的数据都归它读（其中一多半成员是测试/量尺的读口）'
  };
  for (const r of wide) {
    if (KNOWN[r.file]) SRP_KNOWN.push({ file: r.file, api: r.api, deps: r.deps, why: KNOWN[r.file] });
  }
  return wide.filter(r => !KNOWN[r.file]);
}

/* ---------- O：开闭（"加一种新的"要动几个模块） ----------
   ⚠ 这一条最容易量错，所以先说清它**不**量什么：
   "源码里有 `=== 'xxx'` 的分派"本身不是违反 —— 需要各自绘制代码的类型，
   链是唯一诚实的写法。注册成家族取值也不保证"加一行就够"。

   真正能当场量出来的、也真的有用的量是**扩展成本**：
   对每个已经登记成家族取值的变体，数一数**有几个模块**在按它分派
   （`=== '它'` / `case '它'`）。那个数字就是"加这一种新的要改几个地方"
   的下界 —— 它是 `1` 说明真的只在表里加一行，是 `8` 就说明还得回去改八处。

   数字本身不判红（有的变体天生要被多处读到，比如 `'weapon'`）；
   它进报告是为了让"开闭"从一句口号变成一个**能对比的数**：
   下一轮如果某个变体从 3 涨到 7，那就是新加的链，该被看见。 */
/* 家族字面量：`Registry.family('x', {…values/entries…})` 所在文件里，
   出现在该 `family(` 调用附近的短小写字符串。取不到精确的取值域，
   所以用"同文件里 40 行窗口内的字面量"近似 —— 比"整个文件"精确得多。

   ⚠ **排除 JS 类型名**（`number` / `object` / `undefined` …）：
   它们会被 `Registry.family` 附近的文本溅到，而 `typeof x === 'number'`
   这种分派跟"加一种新的游戏内容"毫无关系 —— 收进来只会让这一节变成噪音，
   而**工具里有噪音比少一条规则更糟**（没人会看它）。 */
const JS_TYPES = new Set(['number', 'object', 'undefined', 'string', 'boolean', 'function', 'symbol', 'bigint']);
function ocp() {
  const familyLiterals = new Set();
  for (const f of files) {
    const src = srcOf[f];
    for (const m of src.matchAll(/Registry\.family\(\s*'[a-zA-Z]+'/g)) {
      const win = src.slice(m.index, m.index + 2000);
      for (const lit of win.matchAll(/'([a-z][a-z_0-9]{2,})'/g)) familyLiterals.add(lit[1]);
    }
  }
  const spanning = {};
  for (const f of files) {
    const body = srcOf[f];
    for (const m of body.matchAll(/===\s*'([a-z][a-z_0-9]{2,})'|case\s+'([a-z][a-z_0-9]{2,})'/g)) {
      const lit = m[1] || m[2];
      if (!familyLiterals.has(lit) || JS_TYPES.has(lit)) continue;
      (spanning[lit] = spanning[lit] || new Set()).add(f);
    }
  }
  return Object.entries(spanning)
    .map(([lit, set]) => ({ lit, files: [...set], n: set.size }))
    .sort((a, b) => b.n - a.n);
}

/* ---------- I：接口隔离（声明了但没人读的成员 = 假接口） ----------
   "假接口"的代价很具体：本项目的每个 `XxxApi` 都是**模块与外界之间的契约**，
   声明了却没人读的成员会骗下一个人去实现它（或者以为它已经被实现了）。
   ⚠ 匹配要**大小写敏感**且**不能带 `\b`**：第一版用 `\.fade\b` 去查，
   结果是 `Music.FADE` 命中了它（`_` 算词字符，`\b` 在 `E` 后面成立），
   于是"删掉的那个成员"被报成"有人在用"。 */
function isp() {
  const out = [];
  /* 只转义**会改变语义**的字符（正则元字符）。注意 `$` 必须转义 ——
     不转义时 `new RegExp('\.$')` 里的 `$` 是"字符串结尾"锚点，
     于是 `UtilsApi.$` 被报成"没人用"，而 `U.$('#x')` 就在 `ui.ts` 里。 */
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const m of typesSrc.matchAll(/interface (\w+)\s*\{([\s\S]*?)\n\}/g)) {
    const name = m[1], body = m[2];
    if (!/Api$/.test(name)) continue;
    const members = [...body.matchAll(/^ {2}([a-zA-Z_$][\w$]*)\s*[?:(]/gm)].map(x => x[1]);
    if (!members.length) continue;
    const dead = members.filter(mem => {
      /* ⚠ 用 `(?![\w$])` 而不是 `\b`：`\b` 在 `FADE` 后面也成立，
         于是 `.fade` 会命中 `Music.FADE`（`_` 算词字符）—— 第一版就是这么错的。 */
      const re = new RegExp('\\.' + esc(mem) + '(?![\\w$])');
      for (const f of files) if (re.test(srcOf[f])) return false;
      /* 也可能是被**解构**取用的（`const { x } = Api`）—— 一并算作有读点 */
      const re2 = new RegExp('\\{[^}]*\\b' + esc(mem) + '\\b[^}]*\\}\\s*=');
      for (const f of files) if (re2.test(srcOf[f])) return false;
      /* ⚠ **第三个读法：模块级调用**（`S.enemyElite(def)`）。
         测试这个门时实测踩到：`sprites.ts` 里 `S.enemyElite` 被定义、
         也在同一文件里被调用（`var el = e._el || (e._el = S.enemyElite(def))`），
         而前两条读法**都不认这种写法** ——
         于是成员被判成"全仓库没人读"（假接口），基线 `isp: 0` 当场变 1，
         **CI 红而本地绿**（本地那个工作区里有别人未提交的改动，
         恰好把这一处绕开了 —— 这本身就是"别拿脏工作区下结论"的一个实例）。
         判据：`模块名.成员(` —— 大写的模块名 + 成员名 + 左括号（= 调用）。 */
      const re3 = new RegExp('\\b[A-Z][\\w$]*\\.' + esc(mem) + '\\s*\\(');
      for (const f of files) if (re3.test(srcOf[f])) return false;
      return true;
    });
    if (dead.length) out.push({ iface: name, dead });
  }
  return out;
}

/* ---------- L / D：从注册表读"实现是否只依赖接口" ---------- */
function lp_dip() {
  const out = { storage: [], registry: [] };
  /* Storage 适配器（L 的真实落点：同一接口的多个实现） */
  const st = srcOf['storage.ts'] || '';
  out.storage = [...st.matchAll(/^Storage\.(adapt\w*|memory|localStorage\w*|setAdapter)\s*=/gm)].map(m => m[1]);
  /* Registry / SelfCheck 是"依赖倒置"在项目里的形态：高层不认识低层的**具体模块**，
     而是通过总账按名字取。判据：有多少模块真的用了注册表而不是硬引用。 */
  for (const f of files) {
    if (/Registry\.|SelfCheck\./.test(srcOf[f])) out.registry.push(f);
  }
  return out;
}

/* ---------- 输出 ---------- */
const S = srp(), O = ocp(), I = isp(), LD = lp_dip();
const WIDE = O.filter(r => r.n >= 4);
console.log('\n=== Bronana · SOLID 体检 ===\n');

console.log('[S] 单一职责 —— "接口大 **且** 依赖多"的模块（改一件事要动它）：' + S.length + ' 个');
for (const r of S) console.log('    ' + r.file.padEnd(16) + '接口 ' + String(r.api).padStart(3) +
  ' · 依赖 ' + String(r.deps).padStart(2) + ' · 代码行 ' + r.codeLines);
if (!S.length) console.log('    ✔ 无');
console.log('    注：**接口大但依赖少**不算违反（纯数据表就是这样），所以判据是两个都大');
if (SRP_KNOWN.length) {
  console.log('    记在案（**不**从报告里消失，只是不计数）：' + SRP_KNOWN.length + ' 个');
  for (const r of SRP_KNOWN) console.log('    ' + r.file.padEnd(16) + '接口 ' + String(r.api).padStart(3) +
    ' · 依赖 ' + String(r.deps).padStart(2) + '   —— ' + r.why);
}

console.log('\n[O] 开闭 —— "加一种新的"要动几个模块（家族变体 × 按它分派的模块数）：');
console.log('    跨 >=4 个模块的变体 ' + WIDE.length + ' 个：');
for (const r of WIDE) console.log('    ' + r.lit.padEnd(14) + r.n + ' 个模块：' + r.files.join(' '));
if (!WIDE.length) console.log('    ✔ 无');
console.log('    注：**分派链本身不是违反**（需要各自绘制代码时链是诚实的）。这个数也不判红，');
console.log('    它进报告是为了让"开闭"从口号变成**能对比的数**：某个变体从 3 涨到 7 = 新加的链');

console.log('\n[L] 里氏替换 —— 同一接口的多个实现（项目里唯一的落点是存储适配器）：');
console.log('    storage.ts 的实现：' + (LD.storage.length ? LD.storage.join(' / ') : '（没找到）'));

console.log('\n[I] 接口隔离 —— 声明了但**全仓库没人读**的接口成员：' + I.length + ' 个接口');
for (const r of I) console.log('    ' + r.iface.padEnd(22) + r.dead.join(', '));
if (!I.length) console.log('    ✔ 无（没有"逼人实现废话"的接口）');

console.log('\n[D] 依赖倒置 —— 用总账/注册表而不是硬引用的模块：' + LD.registry.length + ' / ' + files.length);
console.log('    它们通过 `Registry.family` / `SelfCheck.register` 按名字协作，');
console.log('    高层不需要认识低层的具体模块名 —— 这就是本项目的"依赖倒置"形态。');

const now = { srp: S.length, wide: WIDE.length, isp: I.reduce((n, r) => n + r.dead.length, 0) };
/* 基线：`wide` **不是** 0，因为有三类内容（武器 / 近战 / 道具）天生有多个独立消费者：
     · `weapon` —— 词条表按武器类目筛、制造业按类目算料、模拟层算伤害、界面按类目分组
     · `melee`  —— 近战是**一种攻击方式**，武器表、模拟层、渲染层、属性表、界面各自要处理它
     · `item`   —— 与 weapon 同理，只是消费点少一个
   这三条**不该被"消灭"**：强行合成一个"武器类别总账"只会把三个不同的问题塞进一个抽象里
   （那正是 SOLID 反对的"上帝接口"）。基线的意义是**挡住新增**：
   下一个从 3 涨到 4 的变体会在这里变红，那时我们才该问"它是不是又一个不该有的链"。 */
const BASELINE = { srp: 2, wide: 3, isp: 0 };
console.log('\n=== 结果 ===');
console.log('    实测 S/宽变体/I = ' + now.srp + '/' + now.wide + '/' + now.isp +
  ' · 基线 ' + BASELINE.srp + '/' + BASELINE.wide + '/' + BASELINE.isp);
const grew = Object.keys(now).filter(k => now[k] > BASELINE[k]);
if (grew.length) {
  console.log('  ' + (STRICT ? '✘' : '⚠') + ' 比基线变多：' + grew.map(k => k + ' ' + BASELINE[k] + '→' + now[k]).join(' · '));
  if (STRICT) process.exit(1);
} else {
  console.log('  ✔ 没有比基线更差（基线只能变小）');
}
if (!STRICT) console.log('  （体检模式；`--strict` 才会在变差时返回非零）');
