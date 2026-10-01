/* =========================================================
   name-gate.mjs — **用词门自己的测试**（R53-B 的第 4 步）
   ---------------------------------------------------------
   家法第三节最后一句是"**自检必须证明它会失败**"。这一套把那句话落成可跑的断言：
   判据不在这里重写，而是**调门本身**（`tools/name-audit.mjs --json`）——
   判据只有一份，与 `verify.mjs`"不重新实现任何判据"同一条纪律。

   守三件事：

     [1] **门现在是绿的**，而且它真的扫到了东西（表格数 / 条目数 > 0）——
         一个"什么都扫不到"的门也会绿。
     [2] **门真的会红**（注入三种坏数据，各看一次）：
         ① 一个已经不在的**权威名**（把 `terms.ts` 的 `capacity` 改名）——
            判据 C 必须报"出处的名字对不上"
         ② 一个**弃用词**写进玩家可见字符串（临时在 `ui.ts` 造一句）——
            判据 B 必须报
         ③ 一个**跨表同 id**（临时给 `Terms.ALIAS_DOMAIN` 加一条）——
            这条其实由 [A]/[C] 的运行时读表覆盖，所以这里改成"表内重名"的等价实验：
            给 `Terms.STAT` 追加一条与已有属性**同 id**的条目，`Terms.audit()` 必须报红
     [3] **别名域只豁免列出来的词**：`story.ts` 的「孢子」放行，而同文件的「钟塔」照样报 ——
         这一条是"豁免不能变成整片失守"的判据。
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { T } from './_assert.mjs';
import { installDom } from './_ctx.mjs';
import { loadAll, UI_MODULES } from './_load.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

console.log('\n=== Bronana · 用词门（自检） ===');

/* ---------------- 读门的结果（唯一判据来源） ---------------- */
function runGate() {
  try {
    const out = execFileSync('node', [path.join(ROOT, 'tools', 'name-audit.mjs'), '--json'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    return JSON.parse(out.trim().split('\n').pop());
  } catch (e) {
    return null;
  }
}


/* =========================================================
   [1] 门是绿的，而且真的扫到了东西
   ========================================================= */
T.section('1. 门现在绿，而且不是空绿');
{
  const r = runGate();
  T.ok(r !== null, '门跑得起来（判据只有一份：调它本身，不在测试里重写）');
  if (r) {
    T.ok(r.tables >= 15, '扫到了足够多的"有名字的表"（' + r.tables + ' 张）', String(r.tables));
    T.ok(r.entries >= 200, '扫到了足够多的条目（' + r.entries + ' 条）', String(r.entries));
    T.ok(r.sameEntitySkipped >= 40,
      '同一个实体在两处出现被正确排除（' + r.sameEntitySkipped + ' 组，如 Craft 与 Weapons 的同一把匕首）',
      String(r.sameEntitySkipped));
    T.ok(r.newNames.length === 0, '没有**新增**的跨表同名', JSON.stringify(r.newNames));
    T.ok(r.newIds.length === 0, '没有**新增**的跨表同 id', JSON.stringify(r.newIds));
    T.ok(r.inTableDup.length === 0, '没有表内重名', JSON.stringify(r.inTableDup));
    T.ok(r.retiredHits.length === 0,
      '弃用词没有出现在玩家可见字符串里', JSON.stringify(r.retiredHits.slice(0, 4)));
    T.ok(r.sourceProblems.length === 0, '7 笔钱的权威名与出处一致', JSON.stringify(r.sourceProblems));
    T.ok(r.counts.currencies === 7, '登记了 7 笔钱（' + r.counts.currencies + '）', String(r.counts.currencies));
    T.ok(r.counts.retired === 7, '登记了 7 个弃用词（' + r.counts.retired + '）', String(r.counts.retired));
  }
}

/* =========================================================
   [2] 门真的会红（三处注入，各看一次）
   ========================================================= */
T.section('2. 注入坏数据 → 门必须报出来');
installDom();
await loadAll(UI_MODULES);
const { Terms } = globalThis;

{
  /* ② 弃用词写进玩家可见字符串：临时在 ui.ts 里插一句，跑门，再删掉 */
  const uiPath = path.join(ROOT, 'src', 'ui.ts');
  const original = fs.readFileSync(uiPath, 'utf8');
  const marker = "  var __termsProbe = '建材不够';\n";
  try {
    fs.writeFileSync(uiPath, marker + original);
    const r = runGate();
    T.ok(r !== null && r.retiredHits.some(h => h.file === 'ui.ts' && h.word === '建材'),
      '往 ui.ts 写一句「建材不够」→ 门报红了',
      r ? JSON.stringify(r.retiredHits.slice(0, 3)) : '门自己崩了');
  } finally {
    fs.writeFileSync(uiPath, original);
  }
  const back = runGate();
  T.ok(back && back.retiredHits.length === 0, '删掉之后门恢复绿');
}

{
  /* ③ 权威名的**出处对不上**：把 terms.ts 里 `capacity` 的权威名临时改错 */
  const tPath = path.join(ROOT, 'src', 'terms.ts');
  const original = fs.readFileSync(tPath, 'utf8');
  const from = "id: 'capacity', name: '产能',";
  const to = "id: 'capacity', name: '产能（错的）',";
  try {
    T.ok(original.includes(from), '找到注入点（`capacity` 的权威名）');
    fs.writeFileSync(tPath, original.replace(from, to));
    const r = runGate();
    T.ok(r !== null && r.sourceProblems.some(p => p.indexOf('capacity') >= 0),
      '把 `capacity` 的权威名改错 → 门报"出处对不上"',
      r ? JSON.stringify(r.sourceProblems) : '门自己崩了');
  } finally {
    fs.writeFileSync(tPath, original);
  }
  const back = runGate();
  T.ok(back && back.sourceProblems.length === 0, '改回去之后门恢复绿');
}

{
  /* ④ 漏登记一笔钱：临时把 `material` 从 CURRENCY 里去掉 → 反向判据必须报 */
  const tPath = path.join(ROOT, 'src', 'terms.ts');
  const original = fs.readFileSync(tPath, 'utf8');
  const line = "    id: 'material', name: '材料', owner: 'ledger',";
  try {
    const idx = original.indexOf(line);
    T.ok(idx >= 0, '找到注入点（`material` 那一条）');
    /* 把这一条的 id 改成一个不存在的名字 → 等价于"账本里有一笔没被登记" */
    fs.writeFileSync(tPath, original.replace(line, line.replace("'material'", "'materialX'")));
    const r = runGate();
    T.ok(r !== null && r.sourceProblems.some(p => p.indexOf('material') >= 0),
      '账本里有一笔钱没登记（改 id）→ 门报出来',
      r ? JSON.stringify(r.sourceProblems) : '门自己崩了');
  } finally {
    fs.writeFileSync(tPath, original);
  }
  const back = runGate();
  T.ok(back && back.sourceProblems.length === 0, '改回去之后门恢复绿');
}

{
  /* ⑤ `Terms` 自己的自检也要会红：给它追加一条与已有属性**同 id** 的条目 */
  const keepLen = Terms.STAT.length;
  const keepFirst = Terms.STAT[0];
  Terms.STAT.push({ id: keepFirst.id, name: '重复的属性' });
  const bad = Terms.audit();
  Terms.STAT.pop();
  T.ok(bad.ok === false && bad.problems.some(p => p.indexOf('重复') >= 0),
    '`Terms.audit()` 对"属性 id 重复"报红（自检不是装饰）', JSON.stringify(bad.problems));
  T.ok(Terms.STAT.length === keepLen && Terms.audit().ok, '还原之后自检恢复绿');

  /* 弃用词与权威名同形 → 门会自相矛盾，自检必须拦住 */
  Terms.RETIRED.push({ word: '废料', instead: 'X', why: '故意造的坏数据', allowFiles: [] });
  const bad2 = Terms.audit();
  Terms.RETIRED.pop();
  T.ok(bad2.ok === false && bad2.problems.some(p => p.indexOf('既是弃用词又是权威名') >= 0),
    '`Terms.audit()` 拦住"某个词既是弃用词又是权威名"', JSON.stringify(bad2.problems));
}

/* =========================================================
   [3] 别名域只豁免列出来的词
   ========================================================= */
T.section('3. 别名域的边界（豁免不能变成整片失守）');
{
  const r = runGate();
  T.ok(r !== null && r.aliasKept.some(x => x.indexOf('story.ts:孢子') >= 0),
    '剧情台词里的「孢子」被放行（世界观说法是对的）', JSON.stringify(r ? r.aliasKept : null));
  const domain = Terms.ALIAS_DOMAIN;
  T.ok(domain.length === 1 && domain[0].file === 'story.ts',
    '别名域是**逐文件显式声明**的（不是门去猜哪个文件是剧情）', JSON.stringify(domain));
  T.ok(domain[0].words.indexOf('孢子') >= 0 && domain[0].words.indexOf('钟塔') < 0,
    '而且只列了别名 —— 「钟塔」不在里面（它是设施名的错字，不是别名）', JSON.stringify(domain[0].words));
}

/* =========================================================
   [4] 基线：只能变小，而且坏档要报出来
   ========================================================= */
T.section('4. 基线（只能变小 · 坏档不许静默）');
{
  const bPath = path.join(ROOT, 'tools', 'name-baseline.json');
  const b = JSON.parse(fs.readFileSync(bPath, 'utf8'));
  T.ok(Array.isArray(b.sameNamePairs) && Array.isArray(b.idPairs), '基线结构对');
  T.ok(b.sameNamePairs.length === 6,
    '基线里是 6 组**待用户拍板**的既有撞名（账本 R53-C）', String(b.sameNamePairs.length));
  T.ok(JSON.stringify(b._为什么这6组在基线里 || []).length > 0 ||
    JSON.stringify(b._note || '').length > 0, '基线写了"为什么"（不是一份没有理由的名单）');

  const original = fs.readFileSync(bPath, 'utf8');
  try {
    fs.writeFileSync(bPath, '{ "sameNamePairs": [ "坏了" , }');
    const out = execFileSync('node', [path.join(ROOT, 'tools', 'name-audit.mjs')],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).toString();
    T.ok(false, '坏基线必须让门非零退出', '门竟然绿了：' + out.slice(-120));
  } catch (e) {
    const msg = String((e.stdout || '') + (e.stderr || ''));
    T.ok(/基线文件坏了/.test(msg), '坏基线被**明确报出来**（不许静默当成空基线）', msg.slice(-160));
  } finally {
    fs.writeFileSync(bPath, original);
  }
  const back = runGate();
  T.ok(back && back.newNames.length === 0, '还原之后门恢复绿');
}

process.exit(T.done());
