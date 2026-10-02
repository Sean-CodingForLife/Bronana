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
   校验只有一份（在各工具里），这里只负责把它们串起来并汇总。
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
  },
  {
    id: 'name',
    name: '用词规范（权威名 · 弃用词 · 同名两物）',
    cmd: ['node', ['tools/name-audit.mjs']],
    why: '一个概念**只有一个名字**。四笔钱的权威名早就存在，而改造前**异形词比权威名还多**'
      + '（成长点 43 处 vs 孢子 / 合金 165 处；材料 381 vs 建材 26）—— 后果不是"不好看"，'
      + '是**界面在说谎**：同一屏页头写「材料」、按钮写「废料不够」，而扣费走的是材料。'
      + '这条扫三样：跨表中文名唯一 / 弃用词不许进玩家可见字符串 / 权威名的出处必须解析得到'
  },
  {
    id: 'eol',
    name: '行尾（索引与工作区都是 LF）',
    cmd: ['node', ['tools/eol-audit.mjs']],
    why: '.gitattributes 的 eol **只作用在签出过滤上**，不会重写已存在的 blob —— '
      + '所以存量 blob 里 CRLF / LF 并存，git checkout 治不好，只能 git add --renormalize。'
      + '实测代价：`registry-drift.mjs` 只加 25 行，diff 却有 **1616 行**，那一笔改动没法被审。'
      + '⚠ 判据必须是 git cat-file blob 的原始字节 —— git ls-files --eol 报的是归一化视图，会骗人'
  },
  {
    id: 'doc-num',
    name: '文档数字与清单一致（模块 / 套件 / 门 / 家族）',
    cmd: ['node', ['tools/doc-num-audit.mjs']],
    why: '文档里**手写**的统计数字一定会漂，而漂了没人知道（`readme` 门只管 README 的存量表）。'
      + '实测飘过至少三次（AGENTS.md 92/62 vs 93/63、README 91 个模块 vs 92、最新一次 93 vs 94）。'
      + '这条把四个数（模块 / 套件 / 门 / 家族）与清单对账；docs/history/** 与各批交付小结豁免'
  },
  {
    id: 'engine-boundary',
    name: '引擎 / 内容边界（R55）',
    cmd: ['node', ['tools/engine-boundary.mjs']],
    why: '用户的设想是"**先有一套自研引擎，再在它上面做游戏内容**"。而"哪些模块是引擎"**不能靠感觉分** —— '
      + '调研 Unity（Assets/Packages + asmdef）/ Godot（源码树分层）/ Bevy（crate 分层）/ Unreal（Engine vs Game）'
      + '之后，判据压成一句：**先看边，再看词，最后看可替换性**，而"边"是唯一有机器可验证性的那条。'
      + '这条门只判边：**引擎不许 import 内容或游戏数据表**（允许的边只有 content → engine），'
      + '外加"分类表不许自相矛盾、不许有幽灵条目"。'
      + '⚠ 引擎候选（混合模块）只报提示级，但**必须写明差哪一刀** —— 债要可见，不是偷偷放宽'
  },
  {
    id: 'doc-front',
    name: '文档 front matter（齐全 · 分类合法）',
    cmd: ['node', ['tools/doc-front-matter.mjs']],
    why: '用户要求「**所有文档也要注意规范化，比如加上 front matter**」。'
      + '一次性给 24 个 .md 注入 front matter **不是规范**，是**一次性动作** —— '
      + '下一篇文档加进来时没人守，"规范化"几周内就退化成"一部分有一部没有"。'
      + '这与本项目反复栽的同一个坑一模一样（写死统计数字 / 加门忘了抄 CI）：**靠人记住的规范都会漂**。'
      + '这条门钉三件事：每个 .md 有 front matter · 五个字段（title/category/scope/source/links）齐全 · '
      + '分类必须在声明的 11 档里（分类 = 这份文档**写给谁看**）'
  },
  {
    id: 'naming',
    name: '命名边界（引擎前缀 vs 内容前缀）',
    cmd: ['node', ['tools/naming.mjs']],
    why: '用户的正式决定：引擎叫 **Teapot**、**Bronana 只指游戏内容**，而且他说了 **"不要混了"**。'
      + '判据一句话：**引擎模块里不许出现内容的名字**。'
      + '这条信息一度住在四处（R51 的 21 行表 / §八点六 / engine-first §九 / teapot-restructure §四）——'
      + '所以这条门也顺手把"同一条信息有几份"这件事变成一个要处理的账。'
  },
  {
    id: 'workspace',
    name: '工作区清单（每份清单都要被引擎认下来）',
    cmd: ['node', ['tools/workspace-audit.mjs']],
    why: '用户 2026-10-02 的口径：「Bronana 已经在项目里**降级**了，它只能住在自己的工作区里，'
      + '由**引擎**去管理工作区」。这条门守的是**清单本身**：未知字段报错（抄 Cargo —— 它把'
      + '`workspace.metadata` 静默忽略、官方原文写着 will not be warned about）· 缺必填报错'
      + '（抄 pnpm —— 缺清单时它曾经 silently link no project at all）· `storage.namespace`'
      + '**必须等于 `id`**（这一步防的是 Godot 那个坑：它的 config/name 同时决定 user data 目录，'
      + '于是**改名 = 存档搬家**）· `schema` 不认识就停下。'
      + '⚠ 门**不自己写一套校验**，它 import `src/workspace.ts` 的 `Workspace.parse` —— '
      + '两份判据迟早漂开（`systems.cjs` 的头注释写着同一句话）。'
  },
  {
    id: 'doc-links',
    name: '文档链接与索引（链得到 · 找得到）',
    cmd: ['node', ['tools/doc-links.mjs']],
    why: '两条判据，理由都是实测的：'
      + '**[1] 文档指着一个不存在的文件 = 陈旧**（读的人去找，然后找不到）；'
      + '**[2] 索引与盘上必须两个方向都对得上** —— 实测教训：**最要紧的一份文档曾经不在索引里**'
      + '（`docs/teapot-restructure.md`，战略重构 + E3 的完整入口），而当时**没有任何门在看这件事**'
      + '（`doc-front` 只管 front matter 齐不齐）。方向二是"索引列了一份不存在的文档"—— 那是索引在骗人。'
      + '⚠ **不查外链**：受限沙箱里联网检查会因 DNS 假红（本仓库实测过）。'
  },
  {
    id: 'env',
    name: '环境变量声明（每个被读的键都在 .env.example 里）',
    cmd: ['node', ['tools/env-declared.mjs']],
    why: '环境变量是**没有类型检查的输入**（`strict:false` 下写错名不报，只是永远 undefined），'
      + '而这个仓库的代码里有 13 个这样的键，改造前**一个都没被声明过** —— '
      + '没人能回答"这个项目到底认哪些环境变量"，只能 grep。'
      + '判据：**读点 ↔ 声明的两边要对得上**（读到的都声明了 / 声明的都有人读）。'
      + '⚠ 同一批还补了一个真实的泄漏口：`.gitignore` 里原本**没有 `.env`** —— '
      + '谁建一个 `.env`，`git add -A` 就把它带进版本库（机器层的值进仓库）。'
  },
  {
    id: 'color',
    name: '颜色宪法（同一个值不许有第二个出处）',
    cmd: ['node', ['tools/color-audit.mjs']],
    why: '美术宪法第 3 条写着"全部颜色集中在 PAL，禁止散落硬编码颜色"，而**一直没有门守它** —— '
      + 'AGENTS.md 第十节第 7 条说"会被 hardcode 与 PAL 两道门抓"，实测**第二道门不存在**：'
      + 'hardcode-audit 的三条判据全是算术式/格式化配方，结构上匹配不到颜色字符串，'
      + '它还把 sprites.ts 那类渲染层整文件排除。于是一年下来攒了 379 处颜色字面量，'
      + '其中多处是 PAL 已有键的逐字节副本（照抄 = 把 PAL 变成第二份真相：改 PAL 时它不会跟着变）。'
      + '这条门判两件事：PAL 已有键的副本 · 跨文件的同一个值。'
      + '⚠ 允许清单里只放**内容色**（每个值属于某条数据：怪物本色 / 道具 tint / 主题色），'
      + '而"它是不是内容"要能一句话说清 —— 说不清就是散落的颜色'
  },
  {
    id: 'repro',
    name: '跨进程可复现性（同一份代码 + 同一个种子 ⇒ 结果相同）',
    cmd: ['node', ['tools/fp-repro.mjs']],
    why: '门 `fingerprint` 只跑**一遍**，所以它原理上看不见一类 bug：'
      + '**同一份代码、同一个种子，两次运行结果不同**。形态是遍历 Set/Map 时依赖插入顺序'
      + '（V8 的哈希种子每进程不同）、读 Date/performance 参与数值、模块级状态没在 newRun 时重置。'
      + '更要紧的是：单跑一遍的指纹**是自证的** —— 两次都只跟"记录下来的那个哈希"比，'
      + '而那个哈希就是它自己刚算出来的，所以它有一半概率碰巧通过。'
      + '这条门跑 **3 个独立进程**（不是同进程 3 遍：哈希种子与惰性初始化都是进程级的）再逐字节比对。'
      + '⚠ 它**不**记录也不校验基线哈希 —— 那是 smoke.mjs 的职责（一条判据只能有一个理由）；'
      + '所以**故意改行为时它不会红**，只有"结果不稳定"才红'
  },
  {
    id: 'registration',
    name: '登记一致性（元门：一次列全所有漏登记）',
    cmd: ['node', ['tools/registration-audit.mjs']],
    why: '在 `src/` 下新增一个模块，实测**会红的登记点有 15 处、静默的有 11 处** —— '
      + '也就是说有 11 件事可以**永远不写下来而全门全绿**。最重的一条是**分类本身**：'
      + '门 `engine-boundary` 的分类表以前没有门守着，一个新模块一个字都不写只进提示级，'
      + '`problems` 为空、退出码 0（门自己的注释承认：批次 2 之前有 35 个内容模块一直如此）—— '
      + '而"引擎 / 内容分离"正是本阶段的目标，**这件事的判据本身竟然没有门**。'
      + '第二个病是**发现方式**：漏登记是一道一道地被通知（修一处 → 跑一遍全量 → 被下一道门再红一次），'
      + '每一道都要一次完整的验证。这条门把"清单"本身变成判据：**一次列全**。'
      + '它**不重判**别人已判过的那一半（分层覆盖归 `guards`、`MODULES` 覆盖与可变状态归 `test/persist.mjs`），'
      + '只判没人判的：分类覆盖 · 幽灵条目 · 加载集覆盖 · 清单键的尾巴。'
      + '⚠ 两条纪律写在文件头，各对应一次真实假红：**判据不重复**（第一版把 persist 的判据又写了一遍，'
      + '因为不认它的 `main.ts` / `cli.ts` 入口豁免而假红 7 条 ⇒ 删掉）、'
      + '**表要 import 不要重解析**（加载集是派生的 `RENDER = SIM + 1`，文本解析抓不到 ⇒ 又一版假红）'
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
  console.log('\n\x1b[1m=== Teapot · 全门验证 ===\x1b[0m' + (QUICK ? '  \x1b[33m(--quick：跳过慢门)\x1b[0m' : ''));
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
