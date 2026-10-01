/* =========================================================
   env.mjs — **开工之前先看清：我先来的，还是有人已经在里面干活**
   ---------------------------------------------------------
   为什么要有这个文件（用户的原话）：

     用户会安排**多个 agent 同时干活**，但"用了几个 agent"这件事
     **只有用户知道，agent 不知道** —— 于是 agent 会在不知情的情况下
     重写别人未提交的改动。用户要的不是"强制约束"，而是
     **agent 在没人提醒时也能自己注意到这一点**。

   本项目**真的被这件事伤过一次**（账本 A09）：美术审查第 1 轮的改动
   被另一路会话的批量写入冲掉 —— 6 个文件同一秒被重写，
   `git diff HEAD` 显示与 HEAD 逐字节相同。那一轮的成果直接没了。

   ## ⚠ 判据的两次失败（都记下来，因为它们正是"假门"的两种长相）

   **失败一：拿"文件最近被动过"当并行迹象。**
     结果是**恒红** —— agent 自己刚写完的文件本来就是"几秒前动过"。

   **失败二：改成"排除我自己声明的文件"，并拿 mtime 与开工时刻比。**
     结果是**恒绿**，而且**实测确认过**：我故意改了 `src/depth.ts`
     并把 mtime 拨到开工前 10 分钟，工具仍然报"可以动"。
     根因是 mtime **根本区分不出"我现在写的"和"别人写的"** ——
     我写 `tools/env.mjs` 这一刻，它的 mtime 同样很新、同样早于某些判定。

   **结论：判据只认"开工那一刻的快照差"** —— 那是唯一能证明归属的东西：

     · `--start` 把**开工那一刻**的未跟踪文件清单与 HEAD 记进 `.session.json`
     · 之后**新增**的未跟踪文件 = 我建的；**开工就存在**的未跟踪文件 = **不是我的**
     · 别的 **worktree** 里有未提交改动 = 别的会话（那是另一个目录，我没写过）
     · `collab/claims.json` 里**别人的**认领 = 别人写的
     · **git 锁** = 另一个 git 进程正在跑

   这四条都**不可能由我造成**，所以不会恒红；它们又都**真的指得出别人**，
   所以不会恒绿。

   ## 用法

     node tools/env.mjs --start             记下"我从现在起开工"（快照）
     node tools/env.mjs --check <文件…>      开工前检查这几个文件
     node tools/env.mjs --mine <文件…>       声明"这些是我建的"（排除出并行迹象）
     node tools/env.mjs                     看当前环境
     node tools/env.mjs --json              给门用

   `--check` 退出码：0 = 没有可证明的冲突；1 = **有，先别写**。
   ⚠ 它**不阻止**任何操作 —— 它只负责"让你知道"。要不要继续是人的决定。
   ========================================================= */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const START = argv.includes('--start');
const MINE = takeAfter('--mine');
const CHECK_FILES = takeAfter('--check');
const MARKER = path.join(ROOT, 'tools', '.session.json');

function takeAfter(flag) {
  const i = argv.indexOf(flag);
  if (i < 0) return [];
  const out = [];
  for (let j = i + 1; j < argv.length; j++) { if (argv[j].startsWith('--')) break; out.push(norm(argv[j])); }
  return out;
}
function norm(p) { return p.replace(/^"|"$/g, '').replace(/\\/g, '/'); }
function git(args, cwd, allowFail) {
  try { return execFileSync('git', args, { cwd: cwd || ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim(); }
  catch (e) { if (allowFail) return ''; throw e; }
}

/**
 * ⚠ **解析 `git status --porcelain` 必须用原始输出，不能用上面那个 `git()`** ——
 * 实测踩到的坑：`git()` 末尾有 `.trim()`，而 porcelain 的行首**可能是一个空格**
 * （`" M README.md"` 表示"工作区改了、索引没动"）。`trim()` 把那个空格吃掉之后
 * `slice(3)` 就从第 4 个字符开始切，文件名首字母被砍掉 ——
 * 实测表现是 `dirty=["EADME.md"]`，于是**冲突判据永远匹配不上**（恒绿）。
 *
 * 一行的形状是固定的：`XY <path>`（X=索引状态，Y=工作区状态，第 3 个字符是分隔空格）。
 * 所以正确做法是：**只去掉行尾的换行**，然后 `slice(3)`。
 */
function statusOf(cwd) {
  const raw = (() => {
    try { return execFileSync('git', ['status', '--porcelain'], { cwd: cwd || ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
    catch (e) { return ''; }
  })();
  const tracked = []; const untracked = [];
  for (const line of raw.split('\n')) {
    if (!line.replace(/\r$/, '').length) continue;
    const L = line.replace(/\r$/, '');
    const code = L.slice(0, 2).trim();            /* XY */
    const file = norm(L.slice(3));                 /* 第 3 个字符是分隔空格 */
    if (!file) continue;
    (code === '??' ? untracked : tracked).push({ code, file });
  }
  return { tracked, untracked };
}

const ws = statusOf(ROOT);
const head = git(['rev-parse', 'HEAD'], ROOT, true);

/* ---------------- 开工标记：快照"这一刻就存在的东西" ---------------- */
let session = null;
if (START) {
  session = {
    startedAt: Date.now(),
    startedHead: head,
    /* **这是判据的核心**：开工那一刻就已经存在的未跟踪文件 = 不是我建的 */
    untrackedAtStart: ws.untracked.map(d => d.file),
    trackedDirtyAtStart: ws.tracked.map(d => d.file),
    note: '由 tools/env.mjs --start 写下：快照"开工那一刻就存在的东西"'
  };
  fs.writeFileSync(MARKER, JSON.stringify(session, null, 2) + '\n');
} else if (fs.existsSync(MARKER)) {
  try { session = JSON.parse(fs.readFileSync(MARKER, 'utf8')); }
  /* ⚠ 坏档必须报出来，不许静默当成"没有标记" —— 那会让判据失效
     （与门 name 的坏基线是同一类错误，本项目栽过）。 */
  catch (e) { session = { broken: String(e.message).split('\n')[0] }; }
}

const mineSet = new Set(MINE);
const checkSet = new Set(CHECK_FILES);
const atStart = new Set(session && !session.broken ? (session.untrackedAtStart || []) : []);

/** **不是我建的新文件** = 开工时就存在的未跟踪文件（且我没声明是我的） */
const foreignUntracked = session && !session.broken
  ? ws.untracked.filter(d => atStart.has(d.file) && !mineSet.has(d.file))
  : [];
/** 我开工之后新建的（用于报告，不参与判红） */
const newlyCreated = session && !session.broken
  ? ws.untracked.filter(d => !atStart.has(d.file))
  : ws.untracked;

/* ---------------- 别的 worktree ---------------- */
const worktrees = git(['worktree', 'list', '--porcelain'], ROOT, true).split('\n\n').filter(Boolean).map(block => {
  const o = {};
  for (const line of block.split('\n')) {
    const i = line.indexOf(' '); if (i < 0) o[line] = true; else o[line.slice(0, i)] = line.slice(i + 1);
  }
  return { path: o.worktree, head: o.head, branch: o.branch || '(detached)' };
});
const otherTrees = worktrees.filter(w => path.resolve(w.path) !== ROOT).map(w => {
  if (!fs.existsSync(w.path)) return { ...w, dirty: [], gone: true };
  const s = statusOf(w.path);
  return { ...w, dirty: [...s.tracked, ...s.untracked].map(d => d.file) };
});

/* ---------------- 认领记录 ---------------- */
const CLAIMS = path.join(ROOT, 'collab', 'claims.json');
let claims = null; let claimsBroken = '';
if (fs.existsSync(CLAIMS)) {
  try { claims = JSON.parse(fs.readFileSync(CLAIMS, 'utf8')); }
  catch (e) { claimsBroken = String(e.message).split('\n')[0]; }
}
const batches = claims && Array.isArray(claims.batches) ? claims.batches : [];

/* ---------------- 锁 ---------------- */
const locks = [];
const gitDir = path.join(ROOT, '.git');
if (fs.existsSync(gitDir)) for (const f of fs.readdirSync(gitDir)) if (f.endsWith('.lock')) locks.push('.git/' + f);

/* ---------------- 冲突判定：只认四条"不可能由我造成"的信号 ---------------- */
const conflicts = [];
if (checkSet.size) {
  for (const d of foreignUntracked) if (checkSet.has(d.file)) conflicts.push({ kind: 'foreign-file', file: d.file });
  for (const b of batches) {
    const by = b.agent || b.id;
    if (by === 'me') continue;
    const overlap = (b.files || []).map(norm).filter(f => checkSet.has(f));
    if (overlap.length) conflicts.push({ kind: 'claimed', by, files: overlap });
  }
  for (const w of otherTrees) {
    const overlap = w.dirty.filter(f => checkSet.has(f));
    if (overlap.length) conflicts.push({ kind: 'worktree', tree: w.path, branch: w.branch, files: overlap });
  }
  if (claimsBroken) conflicts.push({ kind: 'claims-broken', detail: claimsBroken });
  if (locks.length) conflicts.push({ kind: 'locked', files: locks });
}

const result = {
  cwd: ROOT, branch: git(['rev-parse', '--abbrev-ref', 'HEAD'], ROOT, true), head: head.slice(0, 7),
  session, trackedDirty: ws.tracked.length, untrackedNew: ws.untracked.length,
  foreignUntracked, newlyCreated, otherTrees, claimsBroken, claimBatches: batches.length,
  locks, checked: [...checkSet], conflicts,
  parallelSignals: foreignUntracked.length + otherTrees.filter(w => w.dirty.length).length +
    (claimsBroken ? 1 : 0) + locks.length
};

if (JSON_OUT) { console.log(JSON.stringify(result)); process.exit(conflicts.length ? 1 : 0); }

/* ---------------- 人读输出 ---------------- */
console.log('\n=== Bronana · 环境与并行会话 ===\n');
console.log('  仓库     ' + ROOT);
console.log('  分支     ' + result.branch + ' @ ' + result.head);
console.log('  开工标记 ' + (session === null
  ? '**没有** —— 跑 `node tools/env.mjs --start` 才能区分"哪些新文件不是我建的"'
  : session.broken ? '✘ 坏档：' + session.broken
  : new Date(session.startedAt).toLocaleString() + ' @ ' + String(session.startedHead).slice(0, 7)));

console.log('\n[1] 工作区');
console.log('    已跟踪改动 ' + ws.tracked.length + ' 个 · 未跟踪文件 ' + ws.untracked.length + ' 个');
for (const d of ws.tracked.slice(0, 10)) console.log('      ' + d.code + '  ' + d.file);
if (ws.tracked.length > 10) console.log('      …… 还有 ' + (ws.tracked.length - 10) + ' 个');
if (foreignUntracked.length) {
  console.log('    ⚠ **不是我建的新文件** ' + foreignUntracked.length + ' 个（开工时就存在）：');
  for (const d of foreignUntracked.slice(0, 10)) console.log('        ' + d.file);
  if (foreignUntracked.length > 10) console.log('        …… 还有 ' + (foreignUntracked.length - 10) + ' 个');
}
if (newlyCreated.length) {
  console.log('    · 我开工后新建的 ' + newlyCreated.length + ' 个：' +
    newlyCreated.slice(0, 6).map(d => d.file).join(' '));
}

console.log('\n[2] git worktree');
if (!otherTrees.length) console.log('    ✔ 只有这一个工作树');
else for (const w of otherTrees) {
  console.log('    ' + w.branch.padEnd(24) + w.path +
    (w.gone ? '   （目录不存在，登记残留）' : w.dirty.length ? '   ⚠ ' + w.dirty.length + ' 个未提交改动' : '   （干净）'));
}

console.log('\n[3] 认领记录（collab/claims.json，可选）');
if (claimsBroken) console.log('    ✘ **坏档**：' + claimsBroken + '（不许当成"没有认领"）');
else if (!claims) console.log('    · 没有这份文件（没人在用认领表 —— 不是错，只是少一层保险）');
else console.log('    ' + batches.length + ' 批认领');

console.log('\n[4] 锁');
console.log(locks.length ? '    ⚠ ' + locks.join(' ') : '    ✔ 没有 git 锁文件');

if (checkSet.size) {
  console.log('\n[5] 开工前检查 ' + checkSet.size + ' 个目标文件');
  if (!conflicts.length) console.log('    ✔ 没有**可证明**的冲突迹象 —— 可以动');
  else {
    console.log('    ✘ **' + conflicts.length + ' 条冲突迹象，先别写**：');
    for (const c of conflicts) {
      if (c.kind === 'foreign-file') console.log('      · ' + c.file + ' 在我开工前就存在（不是我建的）');
      else if (c.kind === 'claimed') console.log('      · ' + c.by + ' 已认领：' + c.files.join(' '));
      else if (c.kind === 'worktree') console.log('      · worktree ' + c.branch + ' 有未提交改动：' + c.files.join(' '));
      else if (c.kind === 'claims-broken') console.log('      · 认领表坏档：' + c.detail);
      else console.log('      · 存在锁：' + c.files.join(' '));
    }
  }
}

console.log('\n=== 结果 ===');
if (conflicts.length) {
  console.log('  ✘ ' + conflicts.length + ' 条可证明的冲突迹象 —— **不要直接覆盖**。');
  console.log('    处置（见 `AGENTS.md` 的并行协作一节）：① 先把自己的改动提交；');
  console.log('    ② 别人的文件只在 `git worktree` 里动；③ 只 `git add` 自己那几个文件。');
  process.exit(1);
}
console.log(result.parallelSignals
  ? '  · 没有针对目标文件的冲突，但有并行迹象（' + result.parallelSignals + ' 条）—— 改完立刻单独提交'
  : '  ✔ 干净');
