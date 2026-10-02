/* =========================================================
   banner-audit.mjs — 门「**引擎启动横幅**」
   ---------------------------------------------------------
   判据一句话：**引擎打的横幅，必须与生成器写出的 `.txt` 是同一份东西。**

   ## 为什么要有这道门

   横幅有两个载体，而它们是**同一份产物**：
     · `design/banner-*.txt`  ← `python design/banner.py`
     · `src/banner_data.ts`   ← 同一个脚本（**引擎读这一份**：三种宿主共用，且不破"零素材"）

   两个载体各写各的，"改了横幅只改一半"就是必然会发生的 —— 而它的症状极隐蔽：
   引擎打的横幅与 `design/` 里那些**看着都对**，只是**不一样**（少一行、差一个空格、
   某个变体还挂着旧版本号）。这一类差异不会让任何别的东西变红。

   ## 四条判据（每条都由 `--self-test` 注入坏数据证明**会红**）
     1. **逐字节对账**：`lines` 拼回来必须与 `design/<file>` **完全相等**；
     2. **1:1**：声明表里的每一份都要在盘上；盘上也不许有没被认领的 `banner-*.txt`
        （孤儿文件 = 生成器写了而引擎看不见，或者反过来）；
     3. **引擎自己的判据照报**：本门**不重写** `Banners.audit()`（行数 / 列宽 / 降级档 /
        版本号 / 矩阵两个方向 / 降级链落地）—— 同一个判据两份实现迟早漂开
        （`systems.cjs` 头注释写着同一句话："两边读同一份表，就不会出现
        工具说没事、测试说有事"）；
     4. **选择器的行为逐条钉死**：四档 × 四种能力的具体选档结果量出来。
        "装不下就降级"这件事只有量出来才算数（宽度算错的表现是框线右边补不齐）。

   ⚠ **不需要 Python**：生成器是**人**手上的唯一真相；门判的是"已提交的这批产物彼此自洽"，
     这在 Node 里判得完。Node 拿不到 Unicode 的 `East_Asian_Width`，所以宽度表由
     `banner.ts` **声明**，而**表外的字符一律报错**（不许猜 —— 猜错就是框线错位）。
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { Banners } from '../src/banner.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const DESIGN = path.join(ROOT, 'design');
const SELF_TEST = process.argv.includes('--self-test');
const JSON_OUT = process.argv.includes('--json');

/** 盘上所有 `banner-*.txt`（判据 2 的右边） */
function diskFiles() {
  return fs.readdirSync(DESIGN).filter(f => /^banner-.*\.txt$/.test(f)).sort();
}

/** 读一份载体（**注入进来**，自证才能拿假数据跑判据） */
function readDesign(file) {
  return fs.readFileSync(path.join(DESIGN, file), 'utf8');
}

/* =========================================================
   判据 1 / 2：两个载体必须逐字节一致，而且一一对应
   ---------------------------------------------------------
   **纯函数**：数据与"怎么读盘"都是参数 —— 于是 `--self-test` 能拿假数据跑同一段判据
   （家法：一条不会失败的审计等于装饰）。
   ========================================================= */
function checkCarriers(entries, read, list) {
  const problems = [];
  const claimed = new Set();
  for (const e of entries) {
    if (!e || !e.file) { problems.push('有一份产物没有 `file` 字段：' + JSON.stringify(e && e.id)); continue; }
    if (claimed.has(e.file)) problems.push('两份产物指向同一个载体：' + e.file);
    claimed.add(e.file);
    let got = null;
    try { got = read(e.file); }
    catch (err) { problems.push(e.id + '：载件 design/' + e.file + ' 读不到（' + String(err.message).slice(0, 60) + '）'); continue; }
    const want = e.lines.join('\n') + '\n';
    if (got !== want) {
      problems.push(e.id + '：`src/banner_data.ts` 里的内容与 `design/' + e.file + '` **不一致** —— ' +
        '同一份产物的两个载体漂开了（.txt ' + Buffer.byteLength(got, 'utf8') + ' 字节 · TS ' +
        Buffer.byteLength(want, 'utf8') + ' 字节）。处置：`python design/banner.py` 重新生成，' +
        '**不要**只手改其中一边');
      continue;
    }
    /* 逐行定位第一处差异（只说"不一致"等于没给线索 —— 与 `dev-edit` 的 P2 同一条纪律） */
    const a = got.split('\n'), b = want.split('\n');
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) { problems.push('    第一处差异在第 ' + (i + 1) + ' 行'); break; }
    }
  }
  for (const f of list()) {
    if (!claimed.has(f)) {
      problems.push('design/' + f + ' **没有任何产物认领它** —— 盘上有、引擎看不见' +
        '（生成器写了但 `products()` 里没有它，或者反过来）');
    }
  }
  return problems;
}

/* =========================================================
   判据 4：选择器的行为（**能力**，不只是数据）
   ---------------------------------------------------------
   每一条都写着"为什么是这个答案" —— 因为这里最容易出的错是
   "降级链写得看着对，实际取到 undefined 或选了装不下的那一档"。
   ========================================================= */
const PICKS = [
  ['深底 100 列', { tier: 'hero', cols: 100 }, 'hero-color', '默认档：有颜色、装得下'],
  ['无颜色', { tier: 'hero', color: false, cols: 100 }, 'hero-nocolor', '把颜色关掉 ⇒ 无转义档，**不是** ascii'],
  ['浅底终端', { tier: 'hero', light: true, cols: 100 }, 'hero-light', '字标在浅底上要换深色那一支'],
  ['纯 ASCII 终端', { tier: 'hero', ascii: true, cols: 100 }, 'hero-ascii', 'ascii 优先级最高（它与颜色无关）'],
  ['主横幅 39 列', { tier: 'hero', cols: 39 }, 'hero-color', '刚好装下（边界值不算装不下）'],
  ['纯 ASCII + 45 列', { tier: 'hero', ascii: true, cols: 45 }, 'badge-ascii',
    'ascii 档里 39 不存在（hero-ascii 是 51 列）⇒ 一路退到 40 列的徽标'],
  ['徽标 + 无颜色', { tier: 'badge', color: false, cols: 80 }, 'badge-ascii',
    '徽标**没有** nocolor 档 ⇒ 按替补链退到 ascii'],
  ['紧凑 + 无颜色', { tier: 'compact', color: false, cols: 80 }, 'compact-ascii', '同上（紧凑也没有 nocolor）'],
  ['卡框 + 浅底', { tier: 'framed', light: true, cols: 100 }, 'framed-nocolor',
    '浅底只有主横幅有 ⇒ 退到无颜色（**不许**给白字，那在浅底上是白写白）'],
  ['卡框 45 列', { tier: 'framed', cols: 45 }, 'hero-color', '卡框要 66 列 ⇒ 降级到 39 列的主横幅'],
  ['30 列（一档都装不下）', { tier: 'hero', cols: 30 }, 'hero-color',
    '**宁可挤，也不能什么都不打**：给最窄的那一份（39 列）'],
  ['没传能力', {}, 'hero-color', '缺省就是主横幅（宿主什么都不说时的行为要说得清）']
];

function checkPicks(pick) {
  const problems = [];
  for (const [name, env, want, why] of PICKS) {
    let got = null;
    try { got = pick(env); } catch (err) { problems.push(name + '：选档抛了（' + String(err.message).slice(0, 60) + '）'); continue; }
    const id = got ? got.id : '(空)';
    if (id !== want) problems.push(name + '：选出来是 ' + id + '，应当是 ' + want + '（' + why + '）');
  }
  return problems;
}

/* ---------------- 自证 ---------------- */
if (SELF_TEST) {
  console.log('\n=== 门 banner · 自证（注入坏数据，逐条必须红）===\n');
  const real = Banners.LIST;
  const file = real[0].file;
  const probe = [
    ['载体漂开（TS 里多一行）',
      () => checkCarriers([{ ...real[0], lines: real[0].lines.concat(['多出来的一行']) }],
        (f) => (f === file ? readDesign(f) : ''), () => [file])],
    ['载体缺了（盘上读不到）',
      () => checkCarriers(real, () => { throw new Error('ENOENT'); }, () => [])],
    ['盘上有孤儿载体',
      () => checkCarriers(real, readDesign, () => diskFiles().concat(['banner-幽灵.txt']))],
    ['两份产物指向同一个载体',
      () => checkCarriers([real[0], { ...real[1], file: real[0].file }], readDesign, () => [real[0].file])],
    ['选档选错（装不下也硬给）',
      () => checkPicks(() => Banners.BY_ID['framed-color'])],
  ];
  let bad = 0;
  for (const [name, run] of probe) {
    const p = run();
    const ok = p.length > 0;
    console.log('  ' + (ok ? '✔' : '✘') + ' [' + name + '] ' +
      (ok ? '报到了：' + p[0].split('\n')[0].slice(0, 90) : '**没报错**（判据是装饰）'));
    if (!ok) bad++;
  }
  console.log('\n  ' + (bad ? '✘ ' + bad + ' 条自证失败' : '✔ ' + probe.length + ' 条注入都证明会红') + '\n');
  process.exit(bad ? 1 : 0);
}

/* ---------------- 判据 ---------------- */
const problems = [];
const engineVerdict = Banners.audit();
for (const p of engineVerdict.problems) problems.push('[引擎自检] ' + p);
for (const p of checkCarriers(Banners.LIST, readDesign, diskFiles)) problems.push(p);
for (const p of checkPicks(Banners.pick)) problems.push(p);

const byTier = {};
for (const e of Banners.LIST) byTier[e.tier] = (byTier[e.tier] || 0) + 1;
const result = {
  version: Banners.VERSION,
  entries: Banners.LIST.length,
  byTier: byTier,
  files: diskFiles().length,
  picks: PICKS.length,
  problems: problems
};

if (JSON_OUT) { console.log(JSON.stringify(result)); process.exit(problems.length ? 1 : 0); }

console.log('\n=== Teapot · 引擎启动横幅门 ===\n');
console.log('  判据：**引擎打的横幅与生成器写出的 `.txt` 是同一份产物**（逐字节）');
console.log('  唯一真相：`design/banner.py` · 引擎读 `src/banner_data.ts`（三种宿主共用 · 零素材）');
console.log('  产物 ' + Banners.LIST.length + ' 份 · 版本 v' + Banners.VERSION + ' · 盘上 .txt ' +
  diskFiles().length + ' 份 · 选档判据 ' + PICKS.length + ' 条');
console.log('  版式分布：' + Object.keys(byTier).map(t => t + ' ' + byTier[t]).join(' · ') + '\n');

if (!problems.length) {
  console.log('  ✔ 两个载体逐字节一致；盘上与声明表一一对应');
  console.log('  ✔ 引擎自检（行数 / 列宽 / 降级档 / 版本号 / 矩阵 / 降级链）全过');
  console.log('  ✔ 选档判据 ' + PICKS.length + ' 条（含"一档都装不下"与"没传能力"）全过');
  console.log('  ✔ 自证：`node tools/banner-audit.mjs --self-test` 注入五种坏数据，逐条确认会红\n');
  process.exit(0);
}
console.log('  ✘ ' + problems.length + ' 处：\n');
for (const p of problems) console.log('    · ' + p);
console.log('\n  ⚠ 处置：**改生成器**（`design/banner.py`）然后 `python design/banner.py` 重新生成 ——' +
  '\n     `.txt` 与 `banner_data.ts` 是同一份产物的两个载体，手改其中一边必然漂开。\n');
process.exit(1);
