/* =========================================================
   install-hooks.mjs — 装 git hooks（**幂等、可卸载**）
   ---------------------------------------------------------
   ## 为什么要有这个东西

   这个项目的"改对了" = 全门绿。而它的历史里有**反复**的同一类事故：
   提交之后才发现某条门本来会红（`scaffold` 改名导致 5 个工具静默读空字段、
   `profileSection` 清单漂了 5 个字段、一个旧工具在报假阳…）。
   每一次的代价都是"事后翻账"。

   所以把最快的那道门挂到 `pre-commit` 上。**注意挂的是快档**：

     pnpm verify --quick     约 18 秒（跳过 49 套测试）

   为什么不挂全量：49 套测试约 60 秒，挂在每次提交上会让人开始用 `--no-verify`，
   而**一个被习惯性绕过的 hook 比没有 hook 更坏** —— 它会让人以为"有守卫"。
   全量留给 CI（见 `.github/workflows/ci.yml`）。

   紧急跳过：`git commit --no-verify`（这是你的权利，但请知道你在跳什么）。

   ## 用法

     node tools/install-hooks.mjs           装（幂等：重复跑不会叠加）
     node tools/install-hooks.mjs --remove  卸
     node tools/install-hooks.mjs --status  看现在装了什么

   ⚠ 它只写 `.git/hooks/pre-commit`（**不进版本库** —— `.git/` 本来就不进）。
   所以新克隆的人要自己跑一次；CI 不依赖它（CI 有自己的 job）。
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const HOOKS = path.join(ROOT, '.git', 'hooks');
const HOOK = path.join(HOOKS, 'pre-commit');
const MARK = '# >>> teapot pre-commit（由 tools/install-hooks.mjs 安装）>>>';
/* ⚠ **改名兼容**（E3 第 3 小步）：引擎还叫 Bronana 时装的 hook 里写着旧标记。
   要能**认出来并替换**，而不是把它当成「别人写的 hook」拒绝覆盖 ——
   否则已经装过的人会卡在「已有一个 pre-commit，而且不是本工具写的」（实测这就是不改的后果）。 */
const OLD_MARK = '# >>> bronana pre-commit';
const isOurs = (t) => !!t && (t.includes(MARK) || t.includes(OLD_MARK));

const SCRIPT = `#!/bin/sh
${MARK}
# 快档验证（约 18 秒）：类型 / 指纹 / 分层 / 守卫 / 漂移 / YAML / 内容账单。
# 跳过 49 套测试 —— 那一条留给 CI，理由见 tools/install-hooks.mjs 的文件头。
#
# 这文件**不进版本库**（.git/ 本来就不进），新克隆要跑：
#     node tools/install-hooks.mjs
#
# 紧急跳过：git commit --no-verify
#
# 如果 pnpm 不可用就退回 node 直接跑（少一层包装）。
if command -v pnpm >/dev/null 2>&1; then
  pnpm run verify:quick
else
  node tools/verify.mjs --quick
fi
status=$?
if [ $status -ne 0 ]; then
  echo ""
  echo "  ✘ pre-commit 没过 —— 提交被拦下了（不是 git 坏了）。"
  echo "    上面每一条失败的门都贴了它自己的输出末尾。"
  echo "    只想看某一条门在验什么：node tools/verify.mjs --list"
  echo "    确实要跳过这一次：git commit --no-verify"
  echo ""
fi
exit $status
# <<< teapot pre-commit <<<
`;

const mode = process.argv.includes('--remove') ? 'remove'
  : process.argv.includes('--status') ? 'status' : 'install';

function readHook() {
  try { return fs.readFileSync(HOOK, 'utf8'); } catch (e) { return null; }
}

if (!fs.existsSync(HOOKS)) {
  console.error('✘ 找不到 .git/hooks —— 这个目录不在一个 git 仓库里？');
  console.error('  （这个脚本只装本地 hook；CI 有自己的 job，不依赖它。）');
  process.exit(1);
}

if (mode === 'status') {
  const cur = readHook();
  if (cur === null) console.log('\n  pre-commit：\x1b[90m未安装\x1b[0m\n');
  else if (isOurs(cur)) console.log('\n  pre-commit：\x1b[32m已安装\x1b[0m（由本工具写入）\n');
  else console.log('\n  pre-commit：\x1b[33m存在，但不是本工具写的\x1b[0m —— 不动它\n');
  process.exit(0);
}

if (mode === 'remove') {
  const cur = readHook();
  if (cur === null) { console.log('\n  本来就没装。\n'); process.exit(0); }
  if (!isOurs(cur)) {
    console.log('\n  \x1b[33m这个 pre-commit 不是本工具写的，不删它。\x1b[0m');
    console.log('  要删请自己处理：' + HOOK + '\n');
    process.exit(1);
  }
  fs.unlinkSync(HOOK);
  console.log('\n  \x1b[32m✔ 已卸载\x1b[0m pre-commit\n');
  process.exit(0);
}

/* install */
const cur = readHook();
if (cur !== null && !isOurs(cur)) {
  console.error('\n  \x1b[31m✘ 已有一个 pre-commit，而且不是本工具写的。\x1b[0m');
  console.error('  我不会覆盖别人的 hook。请你合并，或者先把它挪走：');
  console.error('    ' + HOOK + '\n');
  process.exit(1);
}

fs.writeFileSync(HOOK, SCRIPT, 'utf8');
try { fs.chmodSync(HOOK, 0o755); } catch (e) { /* Windows 上 chmod 基本是空操作，git 自己会处理 */ }

console.log('\n  \x1b[32m✔ 已安装 pre-commit\x1b[0m');
console.log('    跑：\x1b[36mpnpm verify:quick\x1b[0m（约 18 秒；跳过 49 套测试，那条留给 CI）');
console.log('    跳过这一次：\x1b[36mgit commit --no-verify\x1b[0m');
console.log('    卸载：\x1b[36mnode tools/install-hooks.mjs --remove\x1b[0m');
console.log('    看状态：\x1b[36mnode tools/install-hooks.mjs --status\x1b[0m\n');
