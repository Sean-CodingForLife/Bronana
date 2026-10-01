/* =========================================================
   engine-boundary.mjs — **引擎/内容边界门**（R55）
   ---------------------------------------------------------
   用户的原话：

   > 我认为是不是要考虑将**游戏引擎部分和游戏内容部分分离**呢，我的设想一直是
   > 通过开发一套**原生的自研游戏引擎**的基础上再去开发我现在提出的各种的游戏内容

   而"哪些模块是引擎、哪些是内容"**不能靠感觉分**。调研了 Unity（Assets/Packages +
   asmdef）· Godot（源码树分层）· Bevy（crate 分层）· Unreal（Engine/ 与 Game/ 模块）
   之后，判据压成一句话：

   > **先看边，再看词，最后看可替换性** —— 而"边"是唯一有机器可验证性的那条。

   所以这道门**只判"边"**（这一版），三件事：

     1. **引擎模块不许 import 内容模块**（依赖方向单向）
     2. **引擎模块不许 import 游戏数据表**（`data_*` / `eco_*` / `curves` / `enemies` …）
        —— 这是"能否在没有游戏数据的情况下测试"（Bevy 把 headless 无渲染
        明确设计成受支持形态）的机器可测版
     3. **引擎模块里不许出现游戏专有名词**（"词"这一条，用 `terms.ts` 的权威名当词表；
        这条比 1/2 弱，所以**先只报提示级**）

   ⚠ **分类表是数据、不是代码推论**（与 `tools/systems.cjs` 同一条纪律）：
     哪个模块属于引擎是**人的决定**，门只负责让这个决定**一致且可查**。
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');
const JSON_OUT = process.argv.includes('--json');
const STRICT = process.argv.includes('--strict');

/* =========================================================
   1. 边界的两侧
   ---------------------------------------------------------
   ⚠ **这一张表是"分类"，不是"分层"**。`tools/systems.cjs` 已经回答了
   "谁依赖谁"（9 系统 8 层）；这里回答的是**另一个问题**：
   "哪一块可以原样搬到另一个游戏去"。

   判据（报告 §8.6 的 c：能否原样发货给另一个游戏）：
     · **engine**：换个游戏照样用 —— 数学、容器、组件、绘制原语、音频合成引擎、
       存档信封、事件总线、空间网格、自检与总账机制
     · **content**：写着这个游戏的名字 —— 玩法规则、货币、怪物、道具、剧情、关卡、
       界面布局、数值曲线

   两侧之间**允许**的边是**单向的**：`content → engine`（内容用引擎）。
   反过来（引擎认识内容）就是越界 —— 那正是"引擎被游戏规则污染"的定义。
   ========================================================= */
const ENGINE = {
  /* --- 机制层：纯机制，不知道任何游戏概念 --- */
  'utils.ts': '数学 / 随机 / 格式 / 样式注入（含调色板 PAL —— 它是**引擎能力**，色值才是内容）',
  'registry.ts': '扩展点总账（引擎机制）',
  'selfcheck.ts': '启动期自检的唯一入口（引擎机制）',
  'fold.ts': '数值折叠：一张表四种折法（通用求值）',
  'containers.ts': '容器与对象管理（回收/上限/账目）',

  'collide.ts': '碰撞体形状与判定（纯数学）',
  /* ⚠ `draw2d.ts` **不在这里** —— 它是"混合"（原语是引擎，同一文件里夹带一个游戏名
     与一层表情语义）。第一版我把它同时写进两张表，门当场报"分类表自相矛盾" ——
     **门抓到了我的分类错误**。见 1b 的 `ENGINE_MIXED`。 */
  'depth.ts': 'Z 深度：层带 + 变换域 + 层内 y 排序 + 确定性 tie-break',
  'grid.ts': '空间网格（范围查询 —— 通用空间索引）',
  'rig.ts': '通用骨架运行时（骨头 + 姿态 —— 不知道豆豆是谁）',
  'world.ts': '世界系统（坐标 · 网格 · 区域）',
  'object.ts': '对象系统（身份 · 普查 · 分类账）',


  'storage.ts': '存储适配层（localStorage / Node 内存 / 将来任何后端）',
  'envelope.ts': '带版本与迁移链的存档信封（通用）',
  'i18n.ts': '本地化机制（表驱动 + 缺键可查 —— 文案是内容）',
  'terms.ts': '用词总账机制（权威名的声明与核对）',

  /* --- 表现层里属于引擎的那部分 --- */
  'art_spec.ts': '美术规范机制（命名/尺寸/图集/检查 —— 规范是引擎，素材是内容）',
  'art_shaders.ts': '2D 着色器库（效果怎么算出来的 —— 通用）',
  'art_tiles.ts': '瓦片集与自动规则瓦片（autotiling 是通用算法）',
  'art_parallax.ts': '分层视差机制（层数与速度是通用）'
};

/* =========================================================
   1b. **混合模块**：机制是引擎的，但同一文件里夹带内容
   ---------------------------------------------------------
   这一档的存在是**实测推出来的**，不是我想加个例外：

     第一版我把 `draw2d.ts` 划进"引擎候选"，于是它同时在两张表里，
     门当场报 **"分类表自相矛盾：draw2d.ts 同时在引擎与候选里"** ——
     门自己抓到了我的分类错误。

     读源码之后的真相：`draw2d.ts` 的原语层（`rect` / `roundRect` / `circle` /
     `ellipse` / `poly` / `blob` / `arcRing` / `capsule` / `text` / `at`）**是引擎**；
     而 `D.seedBlob` 画的是一个 30 点的种子调制团形（`seedBlobPath`，**与豆豆无关** ——
     豆豆的骨架在 `bronana.ts`）、`D.eye` / `D.mouth` 画的是"有表情的小脸"。
     所以它是**两份东西写在一个文件里**，不是"纯内容"也不是"纯引擎"。

   ⚠ 判据对混合模块**与引擎同样严**（它照样不许 import 内容/数据表）——
     这一档只影响**报告口径**，不是放宽。混合模块**必须写明差哪一刀**。
   ========================================================= */
const ENGINE_MIXED = {
  'draw2d.ts': '**原语层是引擎，但它夹带了一个游戏名与一层表情语义**：`D.seedBlob` 画的是'
    + '30 点的种子调制团形（`seedBlobPath`，与豆豆无关），而 `D.eye` / `D.mouth` 是"有表情的小脸"。'
    + '差的一刀：**命名这一半 2026-10-01 已还清（E3 第 1 小步）** —— 实际改成 `seedBlob` / `seedBlobPath`；'
    + '计划里写的 `blobBase` / `body` / `blob` **都没用成**，因为 `D.blob` 与 `blobPath` 本来就已被占用。'
    + '**还差的只剩下一刀**：'
    + '并把"眼睛/嘴 = 表情"这层语义留给内容侧（`bronana.ts` 已经在做这件事）',

  /* =========================================================
     ⚠ 下面三条是**引擎能力缺口普查（E1）补进来的**。
     为什么第一版漏了：这一档的判据是"**机制是引擎、同一个文件里夹带内容**"，
     而门只判"**边**"（引擎不许 import 内容/数据表）—— 它抓得住"引擎 import 了内容"，
     **抓不住"同一个文件里有两种东西"**。于是 `draw2d.ts` 那一行是靠人工发现才进的表，
     而这三处按**同一条判据**早就够格。
     ⚠ 判据对混合模块**与引擎同样严**（照样不许 import 内容/数据表）——
     这一档只影响**报告口径**，不是放宽。
     ========================================================= */

  'comp.ts': '**组件式组合运行时是引擎**（`define` / `archetype` / `spawn` / `assign` / `query` / '
    + '`system` / `audit` —— 与另一个游戏照样能用），**但同一个文件里装着本作的全部内容**：'
    + '37 个组件（`Wallet{scrap}` / `EnemyCore` / `WeaponCore{paid,tier}` / `OfferCore` / '
    + '`AffixSet` / `CharCore{look,accessory}` …）、11 个原型（note 里写着"玩家子弹：穿透/暴击"'
    + '"地面掉落物：废料/回血/弹药"）、1 个系统（函数体里"飘字受重力"）。'
    + '差的一刀：**把 `:431` 往后的内容挪到一个内容模块**（例如 `content_comp.ts`），'
    + '由它调 `Comp.define/archetype/system` 注册 —— 运行时**已经**有这四个出口，'
    + '缺的只是"内容侧注册"这个位置。',

  'audio.ts': '**程序化合成引擎是引擎**（振荡器 / 噪声 / 包络 / 限幅 / 总线 / duck —— 通用），'
    + '**但它的公开 API 就是本作的玩法动词**：`Sfx.shoot / melee / kill / hurt / hit / '
    + 'levelUp / buy / deny / explode / waveStart / waveClear / click / pickup` 与 `Sfx.LIST`。'
    + '差的一刀：**把 `Sfx.*` 那一串挪成内容侧的"声源声明表"**（名字 + 合成参数 + 总线），'
    + '引擎只留"按参数合成一个音"与"总线"。',

  'music.ts': '**程序化音乐合成是引擎**（槽位 / 分层 / 总线 / 淡入淡出 —— 通用），'
    + '**但曲目 id 是本作的场合**：`title / combat / boss / shop / result` 与 `Music.forScene(scene)`。'
    + '差的一刀：与 `audio.ts` 同一刀 —— **把"哪首曲子对应哪个场合"挪到内容侧**，'
    + '引擎只留"按声明播一条轨"。'
};

/* =========================================================
   2. **显式内容**（机制与数据都写着这个游戏的名字）
   ---------------------------------------------------------
   与"数据表"分开列，因为性质不同：数据表是**数据**，这些是**机制**。
   判据仍是同一条（能否原样发货给另一个游戏）。

   ⚠ 这一张的存在本身是**判定的产物**，不是"收容所"：
     一个模块进这里，就意味着它**换游戏要改** —— 那是一个可陈述的事实，
     不是分类者的妥协。
   ========================================================= */
const CONTENT = {
  'record.ts': '输入录制/回放：它把**这个游戏的 COMMANDS 表**逐条包一层（`Game[name] = wrapper`），换游戏要换命令表',
  'ai.ts': '怪物行为：`AI.behaviour(chase, …)` 把本作行为直接注册进去（控制流里带着游戏规则，搬走等于重写）'
};

/* =========================================================
   3. 游戏数据表（判据 e：引擎碰了它们就不是引擎了）
   ========================================================= */
const DATA_TABLES = [
  'data_chars.ts', 'data_elems.ts', 'data_items.ts', 'data_tiers.ts', 'data_weapons.ts',
  'curves.ts', 'enemies.ts', 'challenges.ts', 'dungeon.ts', 'boons.ts', 'affixes.ts',
  'eco_combat.ts', 'eco_global.ts', 'eco_grow.ts', 'eco_manage.ts', 'economy.ts',
  'ledger.ts', 'link.ts', 'exchange.ts', 'levelup.ts', 'openings.ts', 'skills.ts',
  'talents.ts', 'story.ts', 'synergy.ts', 'forge.ts', 'stronghold.ts', 'trade.ts',
  'craft.ts', 'camp.ts', 'market.ts'
];

/* ---------------- 读源码 ---------------- */
const files = fs.readdirSync(SRC).filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'));
const source = {};
for (const f of files) source[f] = fs.readFileSync(path.join(SRC, f), 'utf8');

/** 取一个模块 import 的**同目录模块名**（相对 import） */
function importsOf(text) {
  const out = [];
  for (const m of text.matchAll(/^import\s[\s\S]*?from\s*'\.\/([^']+)'/gm)) out.push(m[1]);
  for (const m of text.matchAll(/^\s*import\s*'\.\/([^']+)'/gm)) out.push(m[1]);
  return out;
}

const engineNames = Object.keys(ENGINE);
const dataSet = new Set(DATA_TABLES);
const problems = [];
const notes = [];

/* ---------------- 判据 1：引擎不许 import 内容 ---------------- */
const edges = [];
for (const f of engineNames) {
  if (!source[f]) { problems.push('登记为引擎的 ' + f + ' 在 src/ 里不存在（分类表漂了）'); continue; }
  for (const imp of importsOf(source[f])) {
    if (ENGINE[imp]) { edges.push({ from: f, to: imp }); continue; }   /* 引擎 → 引擎：可以 */
    if (CONTENT[imp]) {
      problems.push(f + ' 是**引擎**，却 import 了**内容**模块 ' + imp + '（' + CONTENT[imp] + '）');
    } else if (dataSet.has(imp)) {
      problems.push(f + ' 是**引擎**，却 import 了游戏数据表 ' + imp +
        '（判据 e：引擎要在没有游戏数据的情况下也能测；"改一个平衡数字要不要动它"是这里的反例）');
    } else if (source[imp]) {
      /* 既不是引擎也不是数据表 = 内容模块 */
      problems.push(f + ' 是**引擎**，却 import 了**内容**模块 ' + imp +
        '（方向反了：允许的边只有 content → engine）');
    }
  }
}

/* ---------------- 判据 3（提示级）：引擎里不许出现游戏专有名词 ---------------- */
const WORD_SOURCES = ['data_weapons.ts', 'data_items.ts', 'enemies.ts', 'data_chars.ts'];
for (const f of engineNames) {
  if (!source[f]) continue;
  /* 只扫**中文字符串字面量**（注释里的历史叙述与举例是允许的） */
  const strs = (source[f].match(/'[^'\n]*'|"[^"\n]*"/g) || []).join('\u0000');
  for (const d of WORD_SOURCES) {
    if (!source[d]) continue;
    const names = [...source[d].matchAll(/name:\s*'([^']{2,10})'/g)].map(m => m[1]);
    /* ⚠ 2 个字的"名字"假阳极多（实测抓到"规则"这种**通用词**）——
       短名只报"可能"，不列进提示级（否则提示级会被噪声淹掉，等于没有）。 */
    const hit = names.filter(n => n.length >= 3 && strs.indexOf(n) >= 0);
    if (hit.length) notes.push(f + ' 里出现了 ' + d + ' 的名字：' + hit.slice(0, 4).join(' '));
  }
}

/* ---------------- 判据 0：分类表本身要自洽 ---------------- */
for (const f of files) {
  if (ENGINE[f] && dataSet.has(f)) problems.push('分类表自相矛盾：' + f + ' 同时被当成引擎与数据表');
  if (ENGINE[f] && ENGINE_MIXED[f]) problems.push('分类表自相矛盾：' + f + ' 同时在引擎与混合里');
  if (ENGINE[f] && CONTENT[f]) problems.push('分类表自相矛盾：' + f + ' 同时在引擎与内容里');
}
/* **幽灵条目**：表里写了盘上没有的模块 —— 这一条抓到过一次真事故：
   我凭印象把事件总线写成 `signals.ts`，而**根本没有这个模块**
   （总线住在 `game.ts` 里，`test/signals.mjs` 测的是 `Game` 的事件）。
   分类表里留着幽灵条目，等于门有一格永远查不到东西。 */
for (const f of Object.keys(ENGINE)) {
  if (!source[f]) problems.push('分类表里的幽灵条目：' + f + ' 在 src/ 里不存在（凭印象写的模块名）');
}
for (const f of Object.keys(ENGINE_MIXED)) {
  if (!source[f]) problems.push('候选表里的幽灵条目：' + f + ' 在 src/ 里不存在');
}
const unclassified = files.filter(f => !ENGINE[f] && !dataSet.has(f) && !CONTENT[f] && !ENGINE_MIXED[f]);
notes.push('既不是引擎、也不在数据表清单里的模块 ' + unclassified.length + ' 个（它们算内容，但**没有显式认领**）');

const result = {
  engineCount: engineNames.length, dataCount: DATA_TABLES.length,
  mixedCount: Object.keys(ENGINE_MIXED).length,
  total: files.length, unclassified: unclassified.length,
  engineEdges: edges.length, problems, notes
};

if (JSON_OUT) { console.log(JSON.stringify(result)); process.exit(problems.length ? 1 : 0); }

console.log('\n=== Bronana · 引擎 / 内容边界门（R55）===\n');
console.log('  src/ 模块 ' + files.length + ' 个：引擎 ' + engineNames.length +
  ' · 混合 ' + result.mixedCount + ' · 显式内容 ' + Object.keys(CONTENT).length +
  ' · 数据表 ' + DATA_TABLES.length +
  ' · 未显式认领 ' + unclassified.length);
console.log('  允许的边只有一条：**content → engine**（内容用引擎；反过来就是越界）');

console.log('\n[1] 引擎模块不许 import 内容 / 数据表');
if (!problems.length) console.log('    ✔ 没有越界');
else {
  console.log('    ✘ ' + problems.length + ' 处：');
  for (const p of problems) console.log('      · ' + p);
}

console.log('\n[2] 混合模块（机制是引擎，同文件里夹带内容 —— **必须写明差哪一刀**）');
const cand = Object.keys(ENGINE_MIXED);
if (!cand.length) console.log('    ✔ 没有混合模块 —— 边界是干净的');
else for (const f of cand) console.log('    · ' + f + '：' + ENGINE_MIXED[f]);

console.log('\n[3] 引擎内部的边（引擎 → 引擎，应当是一个有向无环的小世界）');
const seen = new Set();
for (const e of edges) seen.add(e.from + '>' + e.to);
console.log('    ' + seen.size + ' 条：' + [...seen].slice(0, 10).join('  ') + (seen.size > 10 ? ' …' : ''));

console.log('\n[4] 提示级（不判红）');
for (const n of notes) console.log('    · ' + n);
if (unclassified.length) {
  console.log('    未显式认领的 ' + unclassified.length + ' 个（它们**算内容**，但没写进分类表）：');
  console.log('      ' + unclassified.slice(0, 14).join(' ') + (unclassified.length > 14 ? ' …' : ''));
}

console.log('\n=== 结果 ===');
if (problems.length) {
  console.log('  ✘ 边界被越过了 ' + problems.length + ' 处');
  console.log('    处置：要么把这个模块从"引擎"划到"内容"（或"候选"并写清差哪一刀），');
  console.log('    要么切断那条边。**不要**为了让门变绿而把判据放宽 —— 那等于把边界删掉。');
  process.exit(1);
}
console.log('  ✔ 引擎没有 import 内容；分类表自洽（无幽灵条目、无自相矛盾）');
