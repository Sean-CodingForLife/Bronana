/* =========================================================
   verify.mjs — **一条命令跑全部门**（并说清每条门在验什么）
   ---------------------------------------------------------
   ## 为什么需要它

   项目的"改对了" = 六道门全绿（见 `CONTRIBUTING.md`）。但要跑齐它们，
   你得记住六个命令、按顺序敲、并且**自己判断哪个输出算失败**。
   实际后果是：人会只跑最快的那一两个，然后提交。

   这个工具把"六条命令 + 判读"压成一条：**`pnpm verify`**。

   ## 两档

     pnpm verify            全量（约 90 秒）：含 49 套测试
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

const ROOT = path.resolve(import.meta.dirname, '..');
const QUICK = process.argv.includes('--quick');
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
    name: '49 套测试',
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
  }
];

if (LIST) {
  console.log('\n=== `pnpm verify` 会跑的门 ===\n');
  for (const g of GATES) {
    console.log('  ' + g.id.padEnd(14) + (g.slow ? '\x1b[33m[慢：--quick 跳过]\x1b[0m ' : '') + g.name);
    console.log('  ' + ' '.repeat(14) + '\x1b[90m' + g.why + '\x1b[0m');
  }
  console.log('\n  共 ' + GATES.length + ' 条 · 全量约 90s · --quick 约 20s\n');
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
