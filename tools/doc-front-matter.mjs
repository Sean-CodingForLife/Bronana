/* =========================================================
   doc-front-matter.mjs — **文档门**：每个 .md 都要有 front matter，且分类合法
   ---------------------------------------------------------
   为什么要有它：

   用户要求「**所有文档也要注意规范化，比如加上 front matter**」。
   我一次性给 24 个 `.md` 注入了 front matter —— 但**那是一次性动作**：
   下一篇文档加进来时没有人守，于是"规范化"会在几周内退化成"一部分有一部没有"。
   这与本项目反复栽的同一个坑一模一样（写死统计数字 / 加门忘了抄进 CI）——
   **凡是靠人记住的规范，都会漂。**

   所以这一道门把三件事钉住：

     1. **每个被跟踪的 `.md` 都有 front matter**（缺了就是红）
     2. **必填字段齐全**：`title` / `category` / `scope` / `source` / `links`
     3. **`category` 必须在**声明的分类集里 —— 分类就是"**这份文档写给谁看**"，
        随手的自由文本（"调研" 可以，但 "temp" / "note" 不行）会让索引失去意义

   ## `scope` 与 `source` 为什么要必填（不是形式主义）

     · `scope` 回答"**这份文档管什么、不管什么**"。缺了它，同一件事会在两处各写一份，
       然后两份漂开（本项目 `README` 的存量表就这么漂过）。
     · `source` 回答"**这些数字与结论从哪来**"。缺了它，读到的人无法判断
       该信到哪一步 —— 实测这条很要紧：本项目有过"工具报 ✔ 但实际是假阳"的记录。

   ## 新增分类怎么办

     往下面的 `CATEGORIES` 里加一条，**并在注释里写明这个分类写给谁看**。
     加分类是允许的（本次就新增了「调研」与「决定」两档）；
     但**必须是一次显式的动作**，不能是"随手写了别的词"。
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const JSON_OUT = process.argv.includes('--json');

/* 分类 = **写给谁看**。顺序按"读者从外到内"排 */
const CATEGORIES = {
  '门面': '第一次进来的人（仓库长什么样）',
  '变更史': '想知道"这版变了什么"的人',
  '协作': '要在这个仓库里动手的人',
  '安全': '关心威胁模型的人',
  '需求账本': '用户与 AGENT 之间的那本账',
  '决定': '要照着一个已拍板的结论施工的人',
  '调研': '要判断某个结论可不可信的人（取证，结论可能已作废）',
  '交付记录': '想知道"当时是怎么做的、踩了什么坑"的人',
  '外部参考': '要做设计决策的人',
  '自检': '想知道"本项目按行业判据缺什么"的人',
  '模板': '提 PR / 提 issue 的人'
};
const REQUIRED = ['title', 'category', 'scope', 'source', 'links', 'status'];

/* =========================================================
   `status` —— **文档的生命周期**（2026-10-02 加，取证见
   `docs/external-workspace-conventions.md` 的同批调研：ADR / MADR / PEP 1 / boxer / RFC）
   ---------------------------------------------------------
   为什么加它：这个仓库**已经在用手写作废横幅**了 ——
   `docs/techstack-upgrade-research.md` 顶部那句「⚠️ 已拍板：换 WebGL2」，
   而 `docs/README.md` 的索引里还专门备注了"结论不要再用，取证仍然有效"。
   也就是说：**意识有了，机制没有** —— 状态只住在**正文的一句话**里，
   **索引与门都看不见它**，于是"过期文档继续骗人"只靠人记得读开头。
   这一档把状态变成**字段**，并让门按状态**分别要求**别的东西。

   ⚠ **为什么不加 `last-reviewed`（本轮刻意不做，不是漏）**：
   调研（Grafana "Last reviewed" / boxer 的 `reviewed-date` / Homebrew）确实推荐它，
   但**给 30 份文档填一个"复核日期"，而其中大多数我并没有真复核** —— 那正是
   `owner` 字段被否掉的理由（"小团队会退化成永远同一个人的假信息"）。
   **宁可暂时不要这个字段，也不要一个靠伪造填满的字段。**
   等有**真实的复核节奏**（谁在什么时候按什么判据复核）再加，那时它才有信息量。
   ========================================================= */
const STATUS = {
  '草案': '还没定稿（**必须有可见横幅**，人一眼能看到"别照它施工"）',
  '现行': '当前有效（索引里默认读这一档）',
  '已取代': '被另一份取代（**必须写 `superseded-by`，且目标文件要存在** —— 抄 PEP 1 的 `Superseded-By`）',
  '已作废': '结论不成立了，且没有替代者（**必须有可见横幅**；与"已取代"的区别就是有没有接班人）'
};
/** 不是"现行"的状态，都必须有一眼可见的横幅（抄 boxer 的"横幅 iff draft"） */
const NEEDS_BANNER = ['草案', '已取代', '已作废'];

/* ---------------- 收集全部 .md（与 `eol-audit` 同一条路：不用 git，避开中文名的转义） ---------------- */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'research', '.tmp-npm-cache']);
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') && e.name !== '.github') continue;
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

const files = walk(ROOT).map(p => path.relative(ROOT, p).split(path.sep).join('/')).sort();
const problems = [];
const rows = [];
const statusRows = [];

for (const f of files) {
  const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const lines = text.split('\n');
  if (lines[0].trim() !== '---') {
    problems.push(f + '：**没有 front matter**（首行不是 `---`）');
    continue;
  }
  const end = lines.indexOf('---', 1);
  if (end < 0) { problems.push(f + '：front matter 没有结束标记 `---`'); continue; }
  const block = lines.slice(1, end).join('\n');
  const fields = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (m) fields[m[1]] = m[2].trim();
  }
  for (const k of REQUIRED) {
    if (!fields[k] || !fields[k].length) problems.push(f + '：front matter 缺字段 `' + k + '`');
  }
  if (fields.category) {
    const cat = fields.category.replace(/^["']|["']$/g, '');
    if (!CATEGORIES[cat]) {
      problems.push(f + '：`category: ' + cat + '` 不在合法分类里（合法：' +
        Object.keys(CATEGORIES).join(' / ') + '）');
    } else {
      rows.push({ file: f, category: cat });
    }
  }

  /* ---- 状态机（不是"值合法"就完事：状态**决定**别的东西必须怎么写）---- */
  const st = fields.status ? fields.status.replace(/^["']|["']$/g, '') : '';
  if (st && !STATUS[st]) {
    problems.push(f + '：`status: ' + st + '` 不在合法状态里（合法：' +
      Object.keys(STATUS).join(' / ') + '）');
  } else if (st) {
    /* ① 已取代 ⇒ 必须写接班人，且**接班人真的在**（单向会漏，这是 PEP 1 的判据） */
    if (st === '已取代') {
      const sb = (fields['superseded-by'] || '').replace(/^["']|["']$/g, '');
      if (!sb) {
        problems.push(f + '：状态是「已取代」却**没写 `superseded-by`** —— ' +
          '没有接班人的话该是「已作废」（这两档的区别就是这个）');
      } else {
        const fromDoc = path.resolve(path.dirname(path.join(ROOT, f)), sb);
        if (!fs.existsSync(fromDoc) && !fs.existsSync(path.join(ROOT, sb))) {
          problems.push(f + '：`superseded-by: ' + sb + '` **指向的文件不存在** —— ' +
            '指针指空比没有指针更糟（读的人会以为有人接手了）');
        }
      }
    }
    /* ② 不是"现行"的 ⇒ 必须有一眼可见的横幅（正文前 25 行里以 `>` 开头且含 ⚠ 的行） */
    if (NEEDS_BANNER.includes(st)) {
      const body = lines.slice(end + 1, end + 26);
      const hasBanner = body.some(l => /^\s*>/.test(l) && l.includes('⚠'));
      if (!hasBanner) {
        problems.push(f + '：状态是「' + st + '」却**没有可见横幅** —— ' +
          '正文前 25 行里要有一行以 `>` 开头且含 ⚠（人扫一眼就知道"别照它施工"）');
      }
    }
    statusRows.push({ file: f, status: st });
  }
}

/* 分类分布 —— 顺带回答"索引是不是真的按读者分了" */
const byCat = {};
for (const r of rows) (byCat[r.category] = byCat[r.category] || []).push(r.file);

const result = { total: files.length, ok: rows.length, categories: Object.keys(CATEGORIES).length, byCat, problems };
if (JSON_OUT) { console.log(JSON.stringify(result)); process.exit(problems.length ? 1 : 0); }

console.log('\n=== Bronana · 文档门（front matter）===\n');
console.log('  .md 共 ' + files.length + ' 个 · front matter 齐全 ' + rows.length +
  ' 个 · 合法分类 ' + Object.keys(CATEGORIES).length + ' 档');

console.log('\n[1] 每个 .md 都要有 front matter，且五个字段齐全 + 分类合法');
if (!problems.length) console.log('    ✔ 全部合规');
else {
  console.log('    ✘ ' + problems.length + ' 处：');
  for (const p of problems) console.log('      · ' + p);
}

console.log('\n[2] 分类分布（分类 = **这份文档写给谁看**）');
for (const cat of Object.keys(CATEGORIES)) {
  const list = byCat[cat] || [];
  if (!list.length) continue;
  console.log('    ' + cat.padEnd(6) + ' ×' + String(list.length).padEnd(3) + ' ' + CATEGORIES[cat]);
}

console.log('\n[3] 状态分布（**状态决定还能不能照它施工**）');
for (const st of Object.keys(STATUS)) {
  const list = statusRows.filter(r => r.status === st).map(r => r.file);
  if (!list.length) continue;
  console.log('    ' + st.padEnd(4) + ' ×' + String(list.length).padEnd(3) + ' ' + STATUS[st]);
  if (st !== '现行') for (const f of list) console.log('         · ' + f);
}
console.log('    ⚠ `last-reviewed` **本轮刻意没加** —— 理由写在 `tools/doc-front-matter.mjs` 的注释里：' +
  '\n      宁可暂时不要，也不填一堆我没真复核过的日期（那与 `owner` 被否掉是同一个理由）。');

console.log('\n=== 结果 ===');
if (problems.length) {
  console.log('  ✘ ' + problems.length + ' 处不合规');
  console.log('    处置：补 front matter（`title` / `category` / `scope` / `source` / `links`）。');
  console.log('    分类不合法时，**要么改成已有分类，要么显式往 `CATEGORIES` 里加一档**');
  console.log('    并写明它写给谁看 —— 不要在文档里随手写一个词。');
  process.exit(1);
}
console.log('  ✔ 文档规范化（front matter 齐全 · 分类合法）');
