/* =========================================================
   verify.mjs — **一条命令跑全部门**（并说清每条门在验什么）
   ---------------------------------------------------------
   ## 为什么需要它

   项目的"改对了" = 六道门全绿（见 `CONTRIBUTING.md`）。但要跑齐它们，
   你得记住六个命令、按顺序敲、并且**自己判断哪个输出算失败**。
   实际后果是：人会只跑最快的那一两个，然后提交。

   这个工具把"六条命令 + 判读"压成一条：**`pnpm verify`**。

   ## 两档

     pnpm verify            全量（约 90 秒）：含全部无头测试套件（数量见 `test/suites.mjs`）
     pnpm verify --quick    快档（约 20 秒）：跳过测试套件，其余照跑

   `--quick` 是**给迭代用的**，它会明确告诉你"跳了什么、提交前还得跑什么" ——
   一个静默少跑东西的 verify 比没有更危险。

   ## 它自己不做判断

   每条门就是跑一个既有命令，看退出码。**不重新实现任何判据** ——
   尺子只有一份（在各工具里），这里只负责把它们串起来并汇总。
   ========================================================= */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const QUICK = process.argv.includes('--quick');

/* 测试套件数**不写死**：写死过一次，然后就漂了（门的名字写着 49 套、
   实际已经是 50 套）。单一出处是 `test/suites.mjs` 的 `SUITES`。
   ⚠ Windows 上 `import('C:/…')` 会报 ERR_UNSUPPORTED_ESM_URL_SCHEME ——
   绝对路径必须转成 `file://` URL（这一条在 Linux 上不会暴露）。 */
const SUITE_COUNT = (await import(pathToFileURL(path.join(ROOT, 'test', 'suites.mjs')).href)).SUITES.length;
const JSON_OUT = process.argv.includes('--json');
const LIST = process.argv.includes('--list');

/* =========================================================
   门的声明表（**每条都说清它挡的是什么**）
   ---------------------------------------------------------
   `slow: true` 的门在 `--quick` 下被跳过。
   ========================================================= */
const GATES = [
  {
    id: 'typecheck',
    name: '类型（tsc ×2：浏览器侧 + Node 侧）',
    cmd: ['node', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--noEmit']],
    then: ['node', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.node.json', '--noEmit']],
    why: '浏览器侧刻意 `types: []` —— 它挡的是"模拟层误用 process/fs"这类只在浏览器里才炸的错'
  },
  {
    id: 'test',
    name: SUITE_COUNT + ' 套测试',
    cmd: ['node', ['test/run-all.mjs']],
    slow: true,
    why: '行为与数值的唯一真相。含性能帧预算、渲染绘制预算、存档往返、回放保真'
  },
  {
    id: 'fingerprint',
    name: '行为指纹',
    cmd: ['node', ['tools/fingerprint.mjs']],
    why: '纯重构必须逐位不变。变了 = 要么有 bug，要么是**有意改行为**（那要更新基线并写 CHANGELOG）'
  },
  {
    id: 'audit',
    name: '分层 / 环 / 死代码 / 未读字段',
    cmd: ['node', ['tools/arch-audit.cjs']],
    why: '边只能从高层指向低层（向上依赖要在 EXCEPTIONS 里逐条解释）'
  },
  {
    id: 'guards',
    name: '家族与模块守卫',
    cmd: ['node', ['tools/guard-gaps.mjs']],
    why: '每个家族的值域要么有自检、要么被跨表引用守着 —— 两者都没有 = 写错了等玩家遇到才发现'
  },
  {
    id: 'drift',
    name: '登记漂移（工具与测试的入口）',
    cmd: ['node', ['tools/registry-drift.mjs']],
    why: '东西在但账上没有它 = 写好了没人能调。这条不会让别的测试变红，所以单独一条门'
  },
  {
    id: 'yaml',
    name: 'YAML（CI 与 issue 模板本身）',
    cmd: ['node', ['tools/yaml-check.mjs']],
    why: 'YAML 写错的症状是"GitHub 安静地不跑" —— 比报错更难发现'
  },
  {
    id: 'art',
    name: '美术规范与资源归属',
    cmd: ['node', ['tools/art-audit.mjs']],
    why: '每一类美术资源都要有"生产模块"；登记为备用的效果不算缺口，但没登记的算'
  },
  {
    id: 'audio',
    name: '音效调用普查（该响的时候有没有人按按钮）',
    cmd: ['node', ['tools/audio-census.mjs']],
    why: '`Sfx.audit()` 只验"声明过的都挂了函数"，它验不了另一半：**声明了却没有任何调用点** —— ' +
      '表现是"那件事没声音"，而**无声是最难注意到的一类退化**（玩家会以为自己没开音量）。' +
      '这条同时对齐"模拟层广播的意图 ↔ 入口接的线"，并抓 `Sfx.xxx` 写错字母'
  },
  {
    id: 'reconcile',
    name: '声明表 ↔ 运行时读点对账',
    cmd: ['node', ['tools/reconcile.mjs']],
    why: '"表里有、局里没有"的死内容；一张表一个出口都没被调用过就是漏了读点'
  },
  {
    id: 'ui-text',
    name: 'i18n 表（表中孤儿）',
    cmd: ['node', ['tools/extract-ui-text.mjs', '--check']],
    why: '改了界面文案却漏改 i18n 表 —— 表中孤儿比缺键更坏（它会让人以为那句翻译过了）'
  },
  {
    id: 'curves',
    name: '数值曲线体检',
    cmd: ['node', ['tools/curve-audit.mjs']],
    why: '曲线表与数据表逐点等价、且改曲线要显式认领"这是行为变更"'
  },
  {
    id: 'loop',
    name: '三模块循环体检',
    cmd: ['node', ['tools/loop-audit.mjs']],
    why: '战斗 / 经营 / 养成三条边真的接上了，而且没有断头路'
  },
  {
    id: 'flow',
    name: '局内进度字段一致性',
    cmd: ['node', ['tools/flow-audit.mjs']],
    why: '存档往返后每个进度字段逐一对得上（"读档静默少一半进度"是最难查的一类）'
  },
  {
    id: 'readme',
    name: 'README 存量表与实测一致',
    cmd: ['node', ['tools/readme-stats.cjs', '--check']],
    why: '**漂了的统计比没有统计更糟** —— 它看起来是量过的（这张表真的漂过）'
  },
  {
    id: 'hardcode',
    name: '硬编码体检（同一个概念写了几遍）',
    cmd: ['node', ['tools/hardcode-audit.cjs', '--strict']],
    why: '不数"有几个数字"（渲染几何量毫无意义），只抓**同一个概念被写了第二遍**：' +
      '同一文件里重复的算式 / 跨文件的同一语义算式 / 重复的格式化配方。基线只能变小'
  },
  {
    id: 'solid',
    name: 'SOLID 体检（五条各自量成一个数）',
    cmd: ['node', ['tools/solid-audit.cjs', '--strict']],
    why: 'SOLID 是最容易被当口号念的五条 —— 念完不会有东西变红。这条把它们各自' +
      '翻译成能当场量出来的形状（接口大小 × 依赖数 / 扩展成本 / 假接口成员 / 存储适配器）'
  }
];

/* =========================================================
   自检：**CI 的步骤清单必须与这张表对得上**
   ---------------------------------------------------------
   为什么把这件事放进 `verify.mjs` 自己身上，而不是再写一个工具：
   它验的是"**这张表**有没有被别处如实照抄"，判据只依赖这个文件里的
   `GATES` 与 `ci.yml` 的文本 —— 换任何别的文件来管都得先把 `GATES` 读出去。

   ## 这段失败史：它已经漂过一次，而且漂得静默

   `.github/workflows/ci.yml` 是一份**手抄**的步骤清单（每个门一个 step，
   这样失败时一眼看出是哪道门）。手抄的清单会漂，而且漂了没人知道：
   加 `solid` 那条门的时候忘了往 `ci.yml` 里抄一份 ——
   于是 **CI 比 `pnpm verify` 少跑一道门**，而两边都显示绿色。
   这与 `README` 那张存量表是同一个病（"漂了的统计比没有统计更糟"），
   只是这次漂的是**门本身**：你以为 CI 守住了，它没有。

   判据只认一条能当场验证的事实：**每个门的 npm 脚本名都出现在 ci.yml 里**。
   不比对顺序、不比对 step 名字（那些可以自由写）—— 只要求"这一步真的跑了"。
   反向不查：CI 可以跑 verify 之外的东西（构建 `dist/` 就是必须的，
   而它不在门的清单里）。
   ========================================================= */
function ciDrift() {
  const ciPath = path.join(ROOT, '.github', 'workflows', 'ci.yml');
  if (!fs.existsSync(ciPath)) return { ok: true, missing: [], note: '（没有 ci.yml，跳过）' };
  /* 每个门在 package.json 里对应的脚本名：`cmd[1]` 里那个 `tools/xxx` 或 `test/xxx` 的文件名 */
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const scripts = pkg.scripts || {};
  const ci = fs.readFileSync(ciPath, 'utf8');
  /* ci.yml 里出现过的所有 `pnpm run <name>` / `pnpm <name>` 与 `node tools/xxx` */
  const used = new Set();
  for (const m of ci.matchAll(/pnpm (?:run )?([a-zA-Z0-9:_-]+)/g)) used.add(m[1]);
  const missing = [];
  for (const g of GATES) {
    /* 这个门的命令指向哪个工具/测试文件 → 找出所有指向它的脚本名（可能不止一个） */
    const target = (g.cmd[1] || []).find(a => /^(tools|test)\//.test(String(a)));
    if (!target) continue;
    const names = Object.keys(scripts).filter(k => String(scripts[k]).includes(target));
    if (!names.length) continue;                      // 没有脚本名就无从比对（门自己没登记）
    if (!names.some(n => used.has(n))) missing.push({ gate: g.id, file: target, as: names.join(' / ') });
  }
  return { ok: missing.length === 0, missing };
}
const CI_DRIFT = ciDrift();
if (!CI_DRIFT.ok) {
  console.log('\n\x1b[31m✘ CI 比这张表少跑门（手抄的清单漂了）\x1b[0m');
  for (const m of CI_DRIFT.missing) {
    console.log('    · 门 `' + m.gate + '`（' + m.file + '）在 ci.yml 里找不到（脚本名：' + m.as + '）');
  }
  console.log('\n  修法：往 `.github/workflows/ci.yml` 加一个 step 跑它。');
  console.log('  \x1b[90m这与 README 那张存量表是同一个病：清单看起来是量过的，其实漏了。\x1b[0m\n');
  process.exit(1);
}

if (LIST) {
  console.log('\n=== `pnpm verify` 会跑的门 ===\n');
  for (const g of GATES) {
    console.log('  ' + g.id.padEnd(14) + (g.slow ? '\x1b[33m[慢：--quick 跳过]\x1b[0m ' : '') + g.name);
    console.log('  ' + ' '.repeat(14) + '\x1b[90m' + g.why + '\x1b[0m');
  }
  console.log('\n  共 ' + GATES.length + ' 条 · 全量约 90s · --quick 约 20s');
  console.log('  与 `ci.yml` 的步骤清单对账：' +
    (CI_DRIFT.note ? CI_DRIFT.note : (CI_DRIFT.ok ? '\x1b[32m✔ 每条门都在 CI 里\x1b[0m' : '\x1b[31m✘ 有门没进 CI\x1b[0m')) + '\n');
  process.exit(0);
}

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' });
  return {
    code: r.status === null ? -1 : r.status,
    out: (r.stdout || '') + (r.stderr || '')
  };
};

const results = [];
const t0 = Date.now();

if (!JSON_OUT) {
  console.log('\n\x1b[1m=== Bronana · 全门验证 ===\x1b[0m' + (QUICK ? '  \x1b[33m(--quick：跳过慢门)\x1b[0m' : ''));
  console.log('');
}

for (const g of GATES) {
  if (QUICK && g.slow) {
    results.push({ id: g.id, name: g.name, skipped: true, why: g.why });
    if (!JSON_OUT) console.log('  \x1b[90m—\x1b[0m ' + g.id.padEnd(14) + '\x1b[90m跳过（--quick）\x1b[0m');
    continue;
  }
  const sw = Date.now();
  let r = run(g.cmd[0], g.cmd[1]);
  /* 少数门是"两条命令都要过"（typecheck 两份配置） */
  if (r.code === 0 && g.then) r = run(g.then[0], g.then[1]);
  const ms = Date.now() - sw;
  results.push({ id: g.id, name: g.name, code: r.code, ms: ms, why: g.why, out: r.out });
  if (!JSON_OUT) {
    const okv = r.code === 0;
    console.log('  ' + (okv ? '\x1b[32m✔\x1b[0m' : '\x1b[31m✘\x1b[0m') + ' ' +
      g.id.padEnd(14) + String(ms + 'ms').padStart(7) + '  ' + g.name);
    if (!okv) {
      /* 失败时**立刻**把它自己的输出贴出来（否则人还要再跑一遍才知道错在哪） */
      const lines = r.out.split('\n').filter(l => l.trim()).slice(-25);
      console.log('\n\x1b[31m──── ' + g.id + ' 的输出（末尾 25 行）────\x1b[0m');
      for (const l of lines) console.log('    ' + l);
      console.log('\x1b[31m' + '─'.repeat(46) + '\x1b[0m\n');
    }
  }
}

const failed = results.filter(r => !r.skipped && r.code !== 0);
const skipped = results.filter(r => r.skipped);
const totalMs = Date.now() - t0;

if (JSON_OUT) {
  console.log(JSON.stringify({ quick: QUICK, totalMs, failed: failed.map(f => f.id), skipped: skipped.map(s => s.id), results: results.map(r => ({ id: r.id, code: r.code, ms: r.ms, skipped: !!r.skipped })) }, null, 1));
  process.exit(failed.length ? 1 : 0);
}

console.log('\n\x1b[1m=== 结果 ===\x1b[0m');
console.log('  通过 ' + (results.length - failed.length - skipped.length) + ' / ' + (results.length - skipped.length) +
  ' 条门 · 用时 ' + (totalMs / 1000).toFixed(1) + 's');

if (skipped.length) {
  console.log('\n  \x1b[33m⚠ --quick 跳过了 ' + skipped.length + ' 条门，**提交前请跑一次全量**：\x1b[0m');
  for (const s of skipped) console.log('      · ' + s.id + '　' + s.name);
  console.log('    \x1b[33m跳过的那条恰好是"行为与数值的唯一真相"，它是最不该省的一条。\x1b[0m');
}

if (failed.length) {
  console.log('\n  \x1b[31m✘ 失败的门：\x1b[0m');
  for (const f of failed) console.log('      · ' + f.id + '　' + f.name);
  console.log('\n  修完再跑一次 `pnpm verify`。每条门在验什么，见 `pnpm verify --list`。\n');
  process.exit(1);
}

console.log('\n  \x1b[32m✔ 全绿。可以提交了。\x1b[0m');
if (!QUICK) console.log('    （提示：`pnpm verify --quick` 是迭代用的快档，约 20 秒。）');
console.log('');
process.exit(0);
