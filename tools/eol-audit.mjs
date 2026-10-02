/* =========================================================
   eol-audit.mjs — **行尾门**：仓库里每个被跟踪的文件都必须是 LF
   ---------------------------------------------------------
   为什么需要一道机器判据（而不是再靠"每轮手动转一遍"）：

   实测的踩坑史 —— 这个仓库**反复**在行尾上绕圈子：
     · `tools/registry-drift.mjs` 只加了 25 行，`git diff` 却是 **1616 行**，
       内容差异被行尾噪声淹掉，那一笔改动**没法被审**
     · 我（AGENT）连着几轮"发现脏 → 手动转一遍 → 下次又脏"，
       每次都要重新量一遍才明白为什么

   **根因（量清楚了的）**：`.gitattributes` 的 `eol` **只作用在签出过滤上**，
   它**不会重写已经存在的 blob**。而这个仓库的存量 blob 是 CRLF / LF **并存**的
   （实测：`git cat-file blob HEAD:src/camp.ts` 含 CRLF 393 行，
   `HEAD:src/game.ts` 含 0 行）。于是：
     · `git checkout -- .` **治不好**（只是把索引里那份原样吐回工作区）
     · 唯一有效的是 `git add --renormalize .`（它重写索引里的 blob）
     · ⚠ 而 `git ls-files --eol` 报的 `i/lf` 是**归一化后的视图**，不是原始字节 ——
       这条判据骗过好几轮，真正的判据是 `git cat-file blob`

   这一道门把"已经规范好的状态"钉住：**进程里读写一次，谁再写回 CRLF 就红**。

   ## 判据（三条，逐条对应上面的一次踩坑）

     1. **索引里的 blob 必须是 LF**（不是"工作区看起来是 LF"）——
        用 `git cat-file blob` 读原始字节判，**不信** `ls-files --eol` 的归一化视图
     2. **工作区必须是 LF** —— 否则下一次 `git diff` 又会整文件噪声
     3. **`.gitattributes` 必须把 `eol=lf` 写死** —— 它是唯一出处；
        少了它，新克隆在 `core.autocrlf=true` 的机器上又会变成 CRLF

   ⚠ **二进制 / 素材**按 `.gitattributes` 的 `binary` 规则跳过（它们不该被转）；
     `docs/` 与 `*.md` 同样在管辖内（文档一样要被审）。
   ========================================================= */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');

function git(args, allowFail) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  } catch (e) {
    if (allowFail) return null;
    throw e;
  }
}

/* 3) `.gitattributes` 必须宣布 eol=lf —— 没有它，这道门守的只是一台机器的状态 */
const attrPath = path.join(ROOT, '.gitattributes');
const attrText = fs.existsSync(attrPath) ? fs.readFileSync(attrPath, 'utf8') : '';
const attrOk = /\*\s+text=auto\s+eol=lf/.test(attrText);

/* 1) 索引里的 blob —— 用 cat-file 读**原始字节**（不信 ls-files --eol 的归一化视图） */
const tracked = git(['ls-files', '-z']).split('\0').filter(Boolean);
/* 二进制按 .gitattributes 的 binary 规则跳过；这里按扩展名判（与那份文件一致） */
const BINARY = /\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf|zip|gz|exe|dll|so|dylib|pdf|mp3|ogg|wav)$/i;
const files = tracked.filter(f => !BINARY.test(f));

const crlfInIndex = [];
const crlfInWork = [];
const missingInWork = [];
for (const f of files) {
  /* --- 索引（blob）---
     ⚠ **必须读索引（`:path`），不能读 HEAD（`HEAD:path`）** —— 实测栽过：
     `git mv` 之后新路径在**索引**里、在 **HEAD** 里还不存在，于是 `HEAD:path` 直接抛，
     于是这道门在"**重命名已暂存、尚未提交**"时**必然红** —— 它冤枉了一个完全合法的操作，
     而且逼出一种古怪的顺序（"先提交再验"）。而它的注释本来写的就是"**索引里的 blob**"：
     **判据一直是对的，读错了源。** 读索引之后它比的是"索引 ↔ 工作区"，两者都是当下状态。 */
  let buf = null;
  try {
    buf = execFileSync('git', ['cat-file', 'blob', ':' + f], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    /* 索引里没有这个路径（`ls-files` 与索引短暂不同步）—— 跳过它；
       "被跟踪但工作区里不存在"那一条判据会兜住真正的问题。 */
    buf = null;
  }
  if (buf) {
    let crlf = 0, lf = 0;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] !== 10) continue;
      if (i > 0 && buf[i - 1] === 13) crlf++; else lf++;
    }
    if (crlf > 0) crlfInIndex.push({ file: f, crlf, lf });
  }

  /* --- 工作区 --- */
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) { missingInWork.push(f); continue; }
  const wb = fs.readFileSync(p);
  let wcrlf = 0;
  for (let i = 1; i < wb.length; i++) if (wb[i] === 10 && wb[i - 1] === 13) wcrlf++;
  if (wcrlf > 0) crlfInWork.push({ file: f, crlf: wcrlf });
}

const problems = [];
if (!attrOk) problems.push('.gitattributes 里没有 `* text=auto eol=lf` —— 行尾没有唯一出处（新克隆会跟着机器的 core.autocrlf 走）');
if (crlfInIndex.length) problems.push('索引里有 ' + crlfInIndex.length + ' 个文件是 CRLF（用 `git add --renormalize .` 修）');
if (crlfInWork.length) problems.push('工作区里有 ' + crlfInWork.length + ' 个文件是 CRLF（下一次 git diff 会整文件噪声）');
if (missingInWork.length) problems.push('有 ' + missingInWork.length + ' 个被跟踪的文件在工作区里不存在');

const result = {
  tracked: tracked.length, checked: files.length,
  attrOk, crlfInIndex, crlfInWork, missingInWork, problems
};

if (JSON_OUT) { console.log(JSON.stringify(result)); process.exit(problems.length ? 1 : 0); }

console.log('\n=== Teapot · 行尾门（LF 是唯一形状）===\n');
console.log('  被跟踪文件 ' + tracked.length + ' 个（跳过二进制 ' + (tracked.length - files.length) + ' 个）');
console.log('  .gitattributes 宣布 `* text=auto eol=lf`：' + (attrOk ? '✔' : '✘'));

console.log('\n[1] 索引里的 blob（`git cat-file blob` 的**原始字节**）');
if (!crlfInIndex.length) console.log('    ✔ 全部 LF');
else {
  console.log('    ✘ ' + crlfInIndex.length + ' 个文件在索引里是 CRLF：');
  for (const x of crlfInIndex.slice(0, 20)) console.log('      ' + x.file + '  （CRLF ' + x.crlf + ' 行 / LF ' + x.lf + ' 行）');
  if (crlfInIndex.length > 20) console.log('      …… 还有 ' + (crlfInIndex.length - 20) + ' 个');
  console.log('    ⚠ 修法只有一条：`git add --renormalize .` ——');
  console.log('      `git checkout` 与 `.gitattributes` **都不能**重写已存在的 blob（实测）。');
}

console.log('\n[2] 工作区');
if (!crlfInWork.length) console.log('    ✔ 全部 LF');
else {
  console.log('    ✘ ' + crlfInWork.length + ' 个文件在工作区里是 CRLF：');
  for (const x of crlfInWork.slice(0, 20)) console.log('      ' + x.file + '  （CRLF ' + x.crlf + ' 行）');
  if (crlfInWork.length > 20) console.log('      …… 还有 ' + (crlfInWork.length - 20) + ' 个');
}
if (missingInWork.length) {
  console.log('    ✘ 缺失 ' + missingInWork.length + ' 个：' + missingInWork.slice(0, 5).join(' '));
}

console.log('\n=== 结果 ===');
if (problems.length) {
  console.log('  ✘ 行尾不规范 ' + problems.length + ' 处');
  for (const p of problems) console.log('    · ' + p);
  process.exit(1);
}
console.log('  ✔ 索引与工作区都是 LF，且唯一出处（.gitattributes）在位');
