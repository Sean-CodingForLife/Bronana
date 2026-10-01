/* =========================================================
   naming.mjs — 门「**命名边界**」（引擎前缀 vs 内容前缀）
   ---------------------------------------------------------
   用户的正式决定（2026-10-01）：

     · 引擎叫 **Teapot Engine**（Teapot），**住在仓库根**
     · **Bronana 只指游戏内容**，是引擎的**工作区**（`workspace/Bronana/`）
     · **"不要混了"** —— 引擎侧标识符用 `teapot*`，内容侧用 `bronana*`

   所以判据是**一句话**：

   > **引擎模块里不许出现内容的名字。**

   ## 为什么这条门今天就要存在（而不是等改完再写）

   实测：引擎模块里 `bronana` 只剩 **1 个文件** —— `storage.ts`（4 个存储键
   `bronana.settings/run/records/profile` + 3 处注释引用它们，等 E3 第 2 小步）。
   **2026-10-01（E3 第 1 小步）已还清另三个**：`draw2d.ts` → `seedBlobPath` / `D.seedBlobPath` /
   `D.seedBlob` · `utils.ts` → `SKIN_DOT` / `DEEP` · `comp.ts` → 注释改中性。

   ⚠ **本句不写总数** —— 总数的**唯一出处是下面的 `DEBT` 表**（`Object.values(DEBT)` 求和）。
   这里曾经写的是"**13 处 / 2 个文件**"，而 `DEBT` 表**从建表那一刻起就是 17**
   （`36a96fc`：1 + 6 + 7 + 3）—— 两个数**从来没有对上过**，漂了很久没人发现。
   同一个坑门 `doc-num` 也踩过三次，治法是同一条：**数字要么从清单算，要么只引用出处**。
   删掉硬数字就是为了不再犯；要读今天有几处，跑 `node tools/naming.mjs`。

   ⚠⚠ **这条门不是改名清单的全部。** 它只扫 **23 个引擎模块**（清单唯一出处：门
   `engine-boundary` 的 `ENGINE` + `ENGINE_MIXED`），而 `src/` 有 **97 个** `.ts`。
   于是**宿主与入口**（`cli.ts` / `main.ts` / `crash.ts` / `storage_fs.ts` …）里的引擎自称、
   以及 `tools/` 与 git hook 里的横幅，**本门一个都不管**。
   改名清单的**完整口径（门内 + 门外六类）**写在 `docs/teapot-restructure.md` §六之一 ——
   **那才是 E3 的入口，不要只看这张 `DEBT` 表。**

   ⚠ **处置不是"豁免"，是"欠账"**：
   · 每一条都写进下面的 `DEBT` 表 —— **含文件、行号、原文、以及它欠的那一刀**；
   · **新增一处就红**（这是今天就在生效的判据）；
   · **欠账还清了也要红**（逼着把 `DEBT` 表删干净 —— 否则这张表会变成永久豁免）。

   ## 计划的还款（E3 批次，本文件是它的"欠条"）

   | 欠账 | 还法 |
   | --- | --- |
   | `bronanaPath` / `D.bronanaPath` / `D.bronana` | ✅ **已还清（E3 第 1 小步）**：改名 `seedBlobPath` / `D.seedBlobPath` / `D.seedBlob`。⚠ **原计划写的 `blobPath` / `D.blobPath` / `D.blob` 会撞名** —— **它画的是"一个 30 点、被种子调制的团形"，与豆豆无关**（`CHANGELOG.md` 已判过它是**引擎**） |
   | `storage.ts` 的 4 个键 | 键改为**由工作区注入命名空间**（`Storage.setNamespace`），内容名从工作区清单来 |

   ## 自证条件（这条门必须能红 —— 家法：一条不会失败的审计等于装饰）

   三种注入**都**会让它红，且都被 `test/naming-gate.mjs` 实测过：
     ① 往任一引擎模块写一个新 `bronana` ⇒ 红「新增了内容名」
     ② 删掉 `DEBT` 表里的一条（模拟"债还清了"）⇒ 红「欠账表与实测对不上」
     ③ 写一个**新文件** `src/bronana_x.ts` ⇒ 红「文件名带内容名」（与清单无关，**当场生效**）
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');
const JSON_OUT = process.argv.includes('--json');

/* ---------------- 引擎模块清单：**唯一出处**是门 `engine-boundary` ---------------- */
/* ⚠ 不自己再列一份 —— 否则"引擎有哪些模块"就有两份真相（家法）。 */
const boundarySrc = fs.readFileSync(path.join(ROOT, 'tools', 'engine-boundary.mjs'), 'utf8');
function tableOf(name) {
  const m = boundarySrc.match(new RegExp('const ' + name + ' = \\{([\\s\\S]*?)\\n\\};'));
  if (!m) return null;
  const out = [];
  for (const k of m[1].matchAll(/^\s*'([^']+\.ts)':/gm)) out.push(k[1]);
  return out;
}
const ENGINE = tableOf('ENGINE');
const MIXED = tableOf('ENGINE_MIXED');
if (!ENGINE || !MIXED) {
  console.error('✘ naming：读不到门 `engine-boundary` 的 ENGINE / ENGINE_MIXED 表 —— 那张表是唯一出处，读不到就不能判');
  process.exit(1);
}
const engineModules = [...ENGINE, ...MIXED];

/* ---------------- 判据 1：引擎模块里不许出现内容名 ---------------- */
const BANNED = /bronana/gi;

/* **欠账表**：每一条都写清"欠哪一刀"。格式 `模块` → 处数（实测值）。
   ⚠ 这张表**只许变短**（还清一条删一条）。
   ⚠ 判据是**大小写不敏感**的 —— 第一版我只搜小写，漏了 `utils.ts` 的
     `BRONANA_DOT` / `BRONANA_DEEP`（全大写），**是这条门当场抓出来的**。 */
const DEBT = {
  /* ⚠ 2026-10-01（E3 第 1 小步）已还清三条并**当场删掉**：
       `comp.ts`(1) → 注释改中性 · `draw2d.ts`(6) → `seedBlobPath` / `D.seedBlob` ·
       `utils.ts`(3) → `SKIN_DOT` / `DEEP`。
     这张表**只许变短**，而且判据是**双向的**：还清了不删也红（不许留成永久豁免）。 */
  'storage.ts': 7     // 4 个存储键 bronana.settings/run/records/profile + 3 处注释引用了它们（E3 第 2 小步）
};

/* ⚠ 两个不同的东西，**必须分开记**：
     · `hits`      —— 命中的每一处（用来给报告列出位置）
     · `mismatch`  —— **表与实测对不上**（这才是要判红的）
   第一版把两者塞进同一个数组，于是"17 处已豁免的欠账"被报告成"17 处新增" ——
   **报告口径错了，判据本身没错。** 判据是"实测 != 表"，不是"有命中"。 */
const hits = [];
const mismatch = [];
for (const mod of engineModules) {
  const p = path.join(SRC, mod);
  if (!fs.existsSync(p)) continue;
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    BANNED.lastIndex = 0;
    if (!BANNED.test(lines[i])) continue;
    n++;
    hits.push({ file: mod, line: i + 1, text: lines[i].trim().slice(0, 100) });
  }
  if (n !== (DEBT[mod] || 0)) {
    mismatch.push({
      file: mod, actual: n, debt: DEBT[mod] || 0,
      text: '实测 ' + n + ' 处，欠账表写的是 ' + (DEBT[mod] || 0) + ' 处' +
        (n > (DEBT[mod] || 0) ? ' —— **有人加了新内容名**' : ' —— **债还清了，请删掉表里那一条**')
    });
  }
}
/* 只报**超出欠账**的那些命中（那才是"新增"） */
const overDebt = {};
for (const m of mismatch) if (m.actual > m.debt) overDebt[m.file] = m.actual - m.debt;
const fresh = hits.filter(h => {
  /* 同文件内，前 `debt` 处算欠账，其余算新增 —— 位置会随编辑漂，所以按数量算 */
  if (!(h.file in overDebt)) return false;
  const same = hits.filter(x => x.file === h.file);
  return same.indexOf(h) >= (DEBT[h.file] || 0);
});
/* 欠账表里列了、但实际已经不存在的模块 */
for (const mod of Object.keys(DEBT)) {
  if (!engineModules.includes(mod)) {
    mismatch.push({ file: mod, actual: 0, debt: DEBT[mod], text: '欠账表里有它，但它已经不在引擎模块清单里了（表漂了）' });
  }
}

/* ---------------- 判据 2：**文件名不许带内容名**（这一条当场生效，无需欠账） ---------------- */
const badNames = fs.readdirSync(SRC)
  .filter(f => /bronana/i.test(f))
  .filter(f => engineModules.includes(f))
  .map(f => ({ file: f, why: '它在引擎模块清单里，而文件名带内容名' }));

/* ---------------- 报告 ---------------- */
const debtTotal = Object.values(DEBT).reduce((a, b) => a + b, 0);

if (JSON_OUT) {
  console.log(JSON.stringify({ engineModules: engineModules.length, hits: hits.length, debtTotal, mismatch, fresh, badNames, DEBT }));
  process.exit(fresh.length || mismatch.length || badNames.length ? 1 : 0);
}

console.log('\n=== 门 naming：引擎前缀 vs 内容前缀 ===\n');
console.log('  引擎模块 ' + engineModules.length + ' 个（清单出处：门 `engine-boundary`）');
console.log('  判据：**引擎模块里不许出现内容的名字** `bronana`（大小写不敏感）');
console.log('  实测命中 **' + hits.length + '** 处 · 欠账表记 **' + debtTotal + '** 处\n');

if (!fresh.length && !mismatch.length && !badNames.length) {
  console.log('  ✔ 命中的每一处都在欠账表里，**没有新增**');
  console.log('  ✔ 没有引擎模块的文件名带内容名\n');
  console.log('  欠账（E3 批次还清 —— 这张表**只许变短**）：');
  for (const k of Object.keys(DEBT)) console.log('    · ' + k + ' → ' + DEBT[k] + ' 处');
  console.log('');
  process.exit(0);
}

if (fresh.length) {
  console.log('  【新增了内容名】—— 判据是"引擎模块里不许出现内容的名字"：');
  for (const v of fresh) console.log('    · ' + v.file + ':' + v.line + '  ' + v.text);
  console.log('');
  console.log('    处置：**不要在欠账表里加一条就完事** —— 要么改成中性名（例如 `blobPath`），');
  console.log('    要么把内容名交给**工作区**注入（`storage.ts` 的计划）。');
  console.log('    判据出处：`docs/teapot-restructure.md` §一。\n');
}

if (mismatch.length) {
  console.log('  【欠账表与实测对不上】—— 表是**欠条**，不是豁免：');
  for (const m of mismatch) console.log('    · ' + m.file + '  ' + m.text);
  console.log('');
}

if (badNames.length) {
  console.log('  【引擎模块的文件名带内容名】—— 这一条**当场生效**，没有欠账：');
  for (const b of badNames) console.log('    · src/' + b.file + '  ' + b.why);
  console.log('');
  console.log('    ⚠ 但注意：**内容模块**叫 `bronana.ts` 是**对的**（它是豆豆的骨架定义）。');
  console.log('      这一条只对"引擎模块清单里"的文件生效。\n');
}

process.exit(1);
