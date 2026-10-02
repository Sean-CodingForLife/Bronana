/* =========================================================
   name-audit.mjs — **用词门**（R53-B 的判据实现）
   ---------------------------------------------------------
   三道判据，**每一道都对着一次实测到的真问题**：

     A）**跨表中文名唯一** —— 同名即红（照 2026-10 的实测）：
        「灵巧」既是词条又是契约 · 「熔炉」既是局内设施又是局外图纸 ·
        「护目镜」既是外观配件又是装备道具（连 `id` 都逐字相同 `goggles`）
        玩家会在图鉴 / 卡片上看到两条同名条目，而没有任何东西报错。

     B）**弃用词不许出现在面向玩家的字符串里**（注释豁免）：
        「建材」26 处 · 「合金」81 处 · 「天赋点」27 处 —— 而四笔钱的权威名
        （`eco_*.ts` 的 `id`/`name`）**早就存在**。异形词比权威名还多。

     C）**跨表 `id` 唯一** + 每个登记源必须**解析得到**：
        `bulwark` = 壁垒 / 厚壁 · `greedy` = 贪食 / 拾荒 —— 同名不同物、
        `id` 却一样，跨表引用会指错东西。

   ## 两条方法纪律（这个仓库栽过，所以写在这里）

   1. **判据 A / C 走运行时读表**（`loadAll` + `globalThis`），**不解析源码文本**。
      "用文本形状去猜语义"这件事在 `docs/history/03` 与 `05` 里各栽过一次。
   2. **判据 B 才需要读文本**（"这句话是不是给玩家看的"），而它按
      **"这一行有没有字符串字面量" + "注释里的不算"** 来判 ——
      因为"改造前叫建材"这类**历史叙述改了就是篡改历史**（账本 R53 执行边界 2）。
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { installDom } from '../test/_ctx.mjs';
import { loadAll, UI_MODULES } from '../test/_load.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');
const UPDATE = process.argv.includes('--update-baseline');
const BASELINE_FILE = path.join(ROOT, 'tools', 'name-baseline.json');

installDom();
await loadAll(UI_MODULES);

/* =========================================================
   0. 找出"有名字的表"
   ---------------------------------------------------------
   判据：`globalThis` 上某个导出对象带 `LIST` 数组，而数组里的元素有 `id` 与 `name`。
   **不写死表名** —— 写死就等于每次加表都要回来改这里（那正是"用词飘掉"的老路）。
   ========================================================= */
const SKIP_GLOBALS = new Set(['Game', 'U', 'D', 'PAL', 'Registry', 'SelfCheck', 'Comp', 'Math',
  'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Reflect', 'Promise']);

const tables = [];        // { mod, table, items }
const aliasGroups = [];   // 同一个实体在两个模块里各一份（登记在 baseline 里）
for (const mod of Object.keys(globalThis)) {
  if (SKIP_GLOBALS.has(mod)) continue;
  const api = globalThis[mod];
  if (!api || typeof api !== 'object') continue;
  let list = null;
  if (Array.isArray(api.LIST)) list = api.LIST;
  if (!list || !list.length) continue;
  const sample = list[0];
  if (!sample || typeof sample !== 'object') continue;
  if (!('id' in sample) || !('name' in sample)) continue;
  tables.push({ mod, items: list.filter(x => x && typeof x === 'object' && x.id && x.name) });
}

/* =========================================================
   1. 基线（**只能变小** —— 与 `hardcode` / `solid` 同一条规矩）
   ---------------------------------------------------------
   基线里存的都是"**刻意复用**"的：同一实体在两个模块里各一份
   （`data_elems.ts` 与 `elems.ts` 那种），或者同一 `id` 在两张表里
   指的**确实是**同一个东西。新增一条 = 红。
   ========================================================= */
let baseline = { sameNamePairs: [], idPairs: [] };
if (fs.existsSync(BASELINE_FILE)) {
  /* ⚠ **坏基线必须报出来，不许静默当成空基线**（实测踩到：我手写 JSON 时漏了一个转义，
     门把它读成空基线，于是 6 组已登记的撞名全被报成"新增"—— 一个静默的坏档
     表现成了"门变严了"，方向正好反了。这个仓库最忌讳的就是这类静默失败。） */
  try {
    baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  } catch (e) {
    console.log('\n=== Teapot · 用词门（R53-B）===\n');
    console.log('  ✘ 基线文件坏了，读不出来：' + BASELINE_FILE);
    console.log('    ' + String(e.message).split('\n')[0]);
    console.log('  ⚠ **不许把它当成空基线继续跑** —— 那会把已登记的条目报成"新增"，方向正好反了。');
    console.log('    修好 JSON，或跑 `node tools/name-audit.mjs --update-baseline` 重写一份。');
    process.exit(1);
  }
  if (!Array.isArray(baseline.sameNamePairs) || !Array.isArray(baseline.idPairs)) {
    console.log('\n=== Teapot · 用词门（R53-B）===\n');
    console.log('  ✘ 基线文件结构不对：`sameNamePairs` 与 `idPairs` 必须都是数组');
    process.exit(1);
  }
}
const baseNames = new Set(baseline.sameNamePairs || []);
const baseIds = new Set(baseline.idPairs || []);

/* =========================================================
   0b. 哪些"同名"**不算撞名**（判据是事实，不是感觉）
   ---------------------------------------------------------
   实测发现的两类**必须排除**，否则门会报 61 组假阳、真问题被淹掉：

     · **`Craft` 的配方本来就是照着武器 / 道具长出来的**（账本 R10 原话：
       "配方由已有的武器 + 道具长出来"）。它的条目带 `refId` **指向那张表的 `id`** ——
       也就是**同一个实体**在两处出现，不是两个东西同名。
       判据：**`id` 相同**即同一个实体（`匕首` 在两处都是 `knife`）。
       实测：61 组里有 55 组是这一类。

     · **同一条目被两张表各自登记一份**（`data_elems.ts` 与 `elems.ts` 那种）——
       同样按"`id` 相同"排除。

   ⚠ 剩下 6 组才是账本 R53-C 记的**真撞名**（两个不同的东西、`id` 也不同）：
     「灵巧」`nimble` vs 契约 · 「疾行」`fleet` vs `swift` · 「熔炉」局内设施 vs 局外图纸 ·
     「拾荒」词条 vs 天赋 · 「锐利」入门档 vs 天赋 · 「淬火」契约 vs 图纸。
   ========================================================= */
function isSameEntity(owners) {
  /* owners: [{mod, id}] —— 归一之后**全部相同** = 同一个实体。
     ⚠ 归一这一步是必须的：`Craft` 的 id 是 `weapon:knife` / `item:magnet`
       （`kind:` 前缀 + 真 id），而 `Weapons` / `Items` 里就是 `knife` / `magnet`。
       第一版直接比字符串，于是 **55 组"配方 vs 本体"被误报成撞名**，
       把真问题（6 组）淹掉了。 */
  const norm = (s) => String(s).replace(/^(weapon|item|talent|boon|camp|forge):/, '');
  const ids = [...new Set(owners.map(o => norm(o.id)))];
  return ids.length === 1;
}

/* =========================================================
   A）跨表中文名唯一
   ========================================================= */
const nameHits = new Map();       // name → [{mod, id}]
const idOwner = new Map();
for (const t of tables) {
  for (const it of t.items) {
    const n = String(it.name);
    if (!nameHits.has(n)) nameHits.set(n, []);
    nameHits.get(n).push({ mod: t.mod, id: String(it.id) });
    const i = String(it.id);
    if (!idOwner.has(i)) idOwner.set(i, []);
    idOwner.get(i).push(t.mod);
  }
}
const sameName = [];
const sameEntitySkipped = [];
for (const [n, owners] of nameHits) {
  const mods = [...new Set(owners.map(o => o.mod))].sort();
  if (mods.length < 2) continue;
  if (isSameEntity(owners)) { sameEntitySkipped.push(n); continue; }
  sameName.push({ name: n, where: mods.join('+'), ids: [...new Set(owners.map(o => o.id))].join('/') });
}
sameName.sort((a, b) => a.name.localeCompare(b.name, 'zh'));

/* 表**内部**重名：同一个表里两条叫同一个名字 —— 这一条没有任何豁免余地 */
const inTableDup = [];
for (const t of tables) {
  const seen = new Map();
  for (const it of t.items) {
    const n = String(it.name);
    if (seen.has(n)) inTableDup.push({ mod: t.mod, name: n, ids: seen.get(n) + '/' + it.id });
    else seen.set(n, it.id);
  }
}

const sameId = [];
const sameIdSameEntity = [];
for (const [i, owners] of idOwner) {
  const uniq = [...new Set(owners)].sort();
  if (uniq.length < 2) continue;
  /* `id` 相同、而且指向同一张主表（如 Craft 的 refId 用法）→ 同一个实体，不算撞 */
  const viaRef = tables.filter(t => uniq.indexOf(t.mod) >= 0)
    .every(t => t.items.some(x => String(x.id) === i && (x.refId === undefined || String(x.refId) === i)));
  if (uniq.indexOf('Craft') >= 0 && uniq.length <= 2) { sameIdSameEntity.push(i); continue; }
  if (viaRef) { sameIdSameEntity.push(i); continue; }
  sameId.push({ id: i, where: uniq.join('+') });
}
sameId.sort((a, b) => a.id.localeCompare(b.id));

const newNames = sameName.filter(x => !baseNames.has(x.name + '|' + x.where));
const newIds = sameId.filter(x => !baseIds.has(x.id + '|' + x.where));

/* =========================================================
   B）弃用词不许出现在面向玩家的字符串里
   ---------------------------------------------------------
   ⚠ "面向玩家"的判据：这一行**去掉注释之后**仍有字符串字面量。
     注释里的历史叙述**是允许的**（"改造前叫建材"改了就是篡改历史）。
   ========================================================= */
/** 去掉块注释与行注释，但**保留字符串**（判据就是"字符串里有没有它"）。
   ⚠ 三个坑（第一版全踩了，一次报了 78 处、其中一多半是假阳）：
     ① **块注释是跨行的** —— 只看本行有没有结束标记，会把整个多行注释当成代码；
     ② **Markdown 的反引号不是 JS 模板字符串** —— 注释里的行内代码被当成了代码；
     ③ 注释与代码**混在同一行**时（赋值后跟一句注释）也要正确切掉尾巴。
   返回逐行的"代码部分"。 */
function codeLinesOf(text) {
  const out = [];
  let inBlock = false;
  for (const line of text.split(/\r?\n/)) {
    let res = '', i = 0, inStr = null;
    while (i < line.length) {
      const c = line[i], n = line[i + 1];
      if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i += 2; continue; } i++; continue; }
      if (inStr) {
        res += c;
        if (c === '\\') { res += n || ''; i += 2; continue; }
        if (c === inStr) inStr = null;
        i++; continue;
      }
      if (c === '/' && n === '/') break;
      if (c === '/' && n === '*') { inBlock = true; i += 2; continue; }
      if (c === '"' || c === "'") { inStr = c; res += c; i++; continue; }
      res += c; i++;
    }
    out.push(res);
  }
  return out;
}

const TermsRef = globalThis.Terms;
const RETIRED = TermsRef ? TermsRef.RETIRED : [];
const ALIAS_WORDS = TermsRef ? TermsRef.ALIAS.map(a => a.word) : [];
/** 别名域：`文件 → 该文件里允许的别名词`（**只豁免列出来的词**，别的弃用词照样红） */
const aliasDomain = new Map();
if (TermsRef) for (const d of (TermsRef.ALIAS_DOMAIN || [])) aliasDomain.set(d.file, new Set(d.words));
const srcFiles = fs.readdirSync(SRC).filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'));

const retiredHits = [];
const aliasKept = [];
for (const f of srcFiles) {
  const lines = codeLinesOf(fs.readFileSync(path.join(SRC, f), 'utf8'));
  lines.forEach((code, i) => {
    /* 只认**单 / 双引号**：反引号在本仓库大量用于"文档里的代码片段"，
       而模板字符串几乎都出现在注释或工具里 —— 认它会把注释里的 `` `合金` `` 报成违规 */
    const strs = code.match(/'[^'\n]*'|"[^"\n]*"/g) || [];
    for (const r of RETIRED) {
      if (!r || !r.word) continue;
      if ((r.allowFiles || []).indexOf(f) >= 0) continue;
      for (const s of strs) {
        if (s.indexOf(r.word) < 0) continue;
        /* **合法的复合专有名词**不算违规**：把白名单词先抠掉，看还剩不剩下违规用法 */
        let probe = s;
        for (const ok of (r.allowWords || [])) probe = probe.split(ok).join('');
        if (probe.indexOf(r.word) < 0) continue;
        /* **别名域**：剧情台词里用世界观说法是**对的** */
        const dom = aliasDomain.get(f);
        if (dom && ALIAS_WORDS.indexOf(r.word) >= 0 && dom.has(r.word)) {
          aliasKept.push({ file: f, line: i + 1, word: r.word });
          continue;
        }
        retiredHits.push({ file: f, line: i + 1, word: r.word, instead: r.instead, text: s.slice(0, 60) });
      }
    }
  });
}

/* =========================================================
   C）出处的名字必须**解析得到**（这是 `terms.ts` 存在的意义）
   ---------------------------------------------------------
   `terms.ts` 断言"权威名是 X，出处走哪条路由"；这里去那条路由里核。
   ⚠ 必须在**全部模块加载之后**跑 —— 这正是 `terms.ts` 自己不做这件事的原因
     （与 `eco_*.ts` 同层，启动期谁先加载不确定）。

   三条路由（实测出来的，不是猜的）：
     · `ledger`   → `Ledger.all()[*].currencies`（`eco_*.ts` 里**没有导出**！
                    `EcoCombat` 这类名字在 `globalThis` 上根本不存在 ——
                    第一版按文件名去 `globalThis` 找，于是 7 笔全报"出处对不上"）
     · `coreLink` → `Economy.LINKS`（`core` / `relic` / `sigil`）
     · `stats`    → `Stats.KEYS`（属性名由 `stats.ts` 的界面映射负责）
   ========================================================= */
const sourceProblems = [];
if (TermsRef) {
  const { Ledger, Economy, Stats } = globalThis;
  const rowsOf = (route) => {
    if (route === 'ledger') {
      const out = [];
      if (Ledger && Ledger.all) for (const b of Ledger.all()) for (const c of (b.currencies || [])) out.push(c);
      return out.length ? out : null;
    }
    if (route === 'coreLink') return (Economy && Economy.LINKS) || null;
    if (route === 'stats') return (Stats && Stats.KEYS) ? Stats.KEYS.map(k => ({ id: k, name: k })) : null;
    return null;
  };
  for (const c of TermsRef.CURRENCY) {
    const rows = rowsOf(c.owner);
    if (!rows) { sourceProblems.push(c.id + ' 的出处路由 ' + c.owner + ' 取不到表'); continue; }
    const hit = rows.find(x => x && x.id === c.id);
    if (!hit) { sourceProblems.push(c.id + ' 在路由 ' + c.owner + ' 里找不到'); continue; }
    /* `stats` 路由只核对"这个键存在"（中文名由 `stats.ts` 的界面映射负责） */
    if (c.owner === 'stats') continue;
    if (hit.name !== c.name) {
      sourceProblems.push(c.id + ' 的权威名在 ' + c.owner + ' 里是「' + hit.name + '」，而 terms.ts 写的是「' + c.name + '」');
    }
  }
  /* 反向：路由里有、而 `terms.ts` 没登记的 —— 那才是"漏了一笔钱" */
  const ledgerRows = rowsOf('ledger') || [];
  for (const row of ledgerRows) {
    if (!TermsRef.CURRENCY.some(c => c.id === row.id)) {
      sourceProblems.push('账本里有 ' + row.id + '（' + row.name + '）而 terms.ts 没登记它');
    }
  }
}

/* =========================================================
   输出与判绿
   ========================================================= */
console.log('\n=== Teapot · 用词门（R53-B）===\n');
console.log('[A] 跨表中文名唯一 —— 扫了 ' + tables.length + ' 张有名字的表（' +
  tables.reduce((n, t) => n + t.items.length, 0) + ' 条条目）');
console.log('    同一个实体在两处出现（`refId` / 同 `id`）按**不是撞名**处理：' +
  sameEntitySkipped.length + ' 组（如「匕首」在 `Craft` 与 `Weapons` 里是同一个 `knife`）');
if (!sameName.length) console.log('    ✔ 没有同名两物');
else {
  console.log('    **真撞名** ' + sameName.length + ' 组（两个不同的东西）。' +
    (newNames.length ? '其中**新出现** ' + newNames.length + ' 组（红）' : '全在基线里（账本 R53-C 待用户拍板）'));
  for (const x of sameName) {
    const isNew = newNames.some(y => y.name === x.name && y.where === x.where);
    console.log('    ' + (isNew ? '✗' : '·') + ' 「' + x.name + '」 ' + x.where + '   id=' + x.ids);
  }
}
if (inTableDup.length) {
  console.log('    ✗ **表内重名** ' + inTableDup.length + ' 处（这一条没有豁免）：');
  for (const d of inTableDup) console.log('      ' + d.mod + ' 「' + d.name + '」 ' + d.ids);
} else {
  console.log('    ✔ 没有表内重名（同一张表里两条叫同一个名字）');
}

console.log('\n[B] 弃用词不许出现在面向玩家的字符串里 —— ' + RETIRED.length + ' 个弃用词');
console.log('    （判据：**单 / 双引号里的**才算"给玩家看的"；注释豁免 ——' +
  ' "改造前叫建材"这类历史叙述改了就是篡改历史）');
if (aliasKept.length) {
  console.log('    别名域放行 ' + aliasKept.length + ' 处（剧情台词用世界观说法是**对的**）：' +
    [...new Set(aliasKept.map(x => x.file + '「' + x.word + '」'))].join(' '));
}
if (!retiredHits.length) console.log('    ✔ 没有命中');
else {
  console.log('    ✗ ' + retiredHits.length + ' 处：');
  for (const h of retiredHits.slice(0, 40)) {
    console.log('    ' + h.file + ':' + h.line + '  「' + h.word + '」→「' + h.instead + '」  ' + h.text);
  }
  if (retiredHits.length > 40) console.log('    …… 还有 ' + (retiredHits.length - 40) + ' 处');
}

console.log('\n[C] 跨表 id 唯一 + 出处可解析');
if (!sameId.length) console.log('    ✔ 没有跨表同 id');
else {
  console.log('    同 id ' + sameId.length + ' 组（其中**新出现** ' + newIds.length + ' 组）：');
  for (const x of sameId) {
    const isNew = newIds.some(y => y.id === x.id && y.where === x.where);
    console.log('    ' + (isNew ? '✗' : '·') + ' `' + x.id + '` ' + x.where);
  }
}
if (sourceProblems.length) {
  console.log('    ✗ 出处对不上（terms.ts 的断言 vs 真实表）：');
  for (const p of sourceProblems) console.log('      ' + p);
} else {
  console.log('    ✔ ' + (TermsRef ? TermsRef.CURRENCY.length : 0) + ' 笔钱的权威名与它们的出处处处一致');
}

if (UPDATE) {
  fs.writeFileSync(BASELINE_FILE, JSON.stringify({
    note: '刻意复用的同名 / 同 id（**只能变小**）。新增一条会被门判红 —— 要么改名，要么把理由写进账本 R53 再登记到这里。',
    sameNamePairs: sameName.map(x => x.name + '|' + x.where),
    idPairs: sameId.map(x => x.id + '|' + x.where)
  }, null, 2) + '\n');
  console.log('\n（--update-baseline：基线已重写）');
}

/* `--json`：给 `test/name-gate.mjs` 用 —— 测试要断言"门真的抓到了什么"，
   而不是把门再写一遍（判据只有一份，与 `verify.mjs` 的纪律一致）。 */
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({
    tables: tables.length, entries: tables.reduce((n, t) => n + t.items.length, 0),
    sameEntitySkipped: sameEntitySkipped.length,
    sameName: sameName.map(x => ({ name: x.name, where: x.where, ids: x.ids })),
    newNames, inTableDup, sameId, newIds,
    retiredHits, aliasKept: [...new Set(aliasKept.map(x => x.file + ':' + x.word))],
    sourceProblems,
    counts: { retired: RETIRED.length, currencies: TermsRef ? TermsRef.CURRENCY.length : 0 }
  }));
  process.exit(0);
}

console.log('\n=== 结果 ===');
const bad = newNames.length + newIds.length + retiredHits.length + sourceProblems.length + inTableDup.length;
console.log('    新增同名 ' + newNames.length + ' · 新增同 id ' + newIds.length +
  ' · 表内重名 ' + inTableDup.length +
  ' · 弃用词 ' + retiredHits.length + ' · 出处不符 ' + sourceProblems.length);
if (bad) { console.log('  ✘ 用词不规范 ' + bad + ' 处'); process.exit(1); }
console.log('  ✔ 用词规范（基线只能变小）');
