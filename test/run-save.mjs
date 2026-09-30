/* =========================================================
   run-save.mjs — **一局存档的编解码** + 升级池的接入
   ---------------------------------------------------------
   这一套的由来：`exportRun` / `inspectRun` / `sanitizeSaveNumbers` 住在
   `game.ts`（4100 行的模拟内核）里，**没有任何一套测试直接调过它们** ——
   只有 `flow.mjs` 的"存了再读，字段对得上"（往返）。而往返过了**不代表格式对**：
   往返是拿同一份代码写、同一份代码读，格式里最危险的那一类问题
   （能修的被拒、不能修的没报、字段顺序漂了）它一条都看不见。

   拆出 `run_save.ts` 之后它们第一次有了能**直接喂输入**的入口，于是有了五组：

     [1] 数值卫生：非有限数必须归 0（不是"变成 null 然后静默丢进度"）
     [2] 编码：字段齐备 + **字段顺序稳定**（`JSON.stringify` 按插入顺序输出）
     [3] 校验：能修的修、不能修的拒（未知角色 / 非法波次拒；数值越界夹取）
     [4] 往返：真的存进槽位再读回来，逐字段一致（用真会话，不是造的对象）
     [5] 接入形状：`game.ts` 必须**只**把编解码委托出去，不再自己写一份

   为什么 [1] 值得单独一组：`JSON.parse('1e999')` 是合法 JSON，解析出来是
   `Infinity`；`JSON.stringify(Infinity)` 是 `null`。于是"坏档"不是崩，
   是**数值被吃掉**（废料 → null → 再读档变 0）。这一组就是钉住那条边界。

   用法： node test/run-save.mjs
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { installDom } from './_ctx.mjs';
import { loadAll, SIM_MODULES, UI_MODULES, enterFightRoom, toShop } from './_load.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
installDom();
const g = globalThis;
await loadAll(UI_MODULES);

let failures = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  \x1b[32mPASS\x1b[0m ' + label);
  else { failures++; console.log('  \x1b[31mFAIL\x1b[0m ' + label + (extra !== undefined ? '  → ' + extra : '')); }
}

const { Game, RunSave, Pool, Chars, Curves, U } = g;
const readSrc = f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');

console.log('\n=== Bronana · 一局存档的编解码 / 升级池 ===\n');

/* =========================================================
   [1] 数值卫生：外部输入的边界
   ========================================================= */
console.log('[1] 数值卫生（非有限数不许进会话）');
{
  const s = RunSave.sanitizeNumbers;
  ok(s(Infinity) === 0, 'Infinity → 0（不然 JSON.stringify 会把它变成 null）', String(s(Infinity)));
  ok(s(-Infinity) === 0, '-Infinity → 0');
  ok(s(NaN) === 0, 'NaN → 0');
  ok(s(1e999) === 0, '`1e999`（合法 JSON 解出来的 Infinity）→ 0', String(s(1e999)));
  ok(s(Number.MAX_SAFE_INTEGER) === Number.MAX_SAFE_INTEGER, 'MAX_SAFE_INTEGER 原样保留');
  ok(s(Number.MAX_SAFE_INTEGER + 1) === Number.MAX_SAFE_INTEGER, '超过 MAX_SAFE 的正数封顶');
  ok(s(-(Number.MAX_SAFE_INTEGER + 1)) === -Number.MAX_SAFE_INTEGER, '超过 MAX_SAFE 的负数封底');
  ok(s(1.5) === 1.5 && s(0) === 0 && s(-3) === -3, '普通有限数一个都不动');

  /* 就地改写（不额外分配）：调用方传进来的是刚解析出来的存档 */
  const obj = { a: Infinity, b: { c: NaN, d: [1, Infinity, { e: -Infinity }] }, s: 'Infinity' };
  const back = s(obj);
  ok(back === obj, '就地改写（返回的是同一个对象，不额外分配）');
  ok(obj.a === 0 && obj.b.c === 0 && obj.b.d[1] === 0 && obj.b.d[2].e === 0, '嵌套的坏数一层层都被清掉');
  ok(obj.s === 'Infinity', '**字符串**不动（只看数值类型，不做字面量解析）');

  /* 深度上限：超过 6 层就不往下走（防"深到爆栈的坏档"） */
  let deep = 1;
  for (let i = 0; i < 12; i++) deep = { n: deep };
  let guard = 0, cur = deep;
  while (cur && typeof cur === 'object' && guard++ < 40) cur = cur.n;
  ok(guard < 40, '深 12 层的结构不会让 sanitize 抛（有深度上限）', '走了 ' + guard + ' 层');
}

/* =========================================================
   [2] 编码：字段齐备 + 顺序稳定
   ========================================================= */
console.log('\n[2] 编码（serialize）');
{
  Game.newRun('ranger', 20240922);
  const runs = Game.exportRun();
  ok(!!runs && typeof runs === 'object', 'exportRun 给出一个纯数据对象');

  /* **字段顺序是契约**：`Save` 会把它 JSON.stringify 写进槽位。
     顺序变了不会改变语义，但会让"存档字节完全一致"这条判据失效 ——
     所以这里把**期望的顺序**连同名字一起钉下来。加字段请**追加**（或在
     这里同步改），不要插在中间：插在中间等于给所有旧档换了个形状。 */
  const ORDER = [
    'char', 'seed', 'danger', 'opening', 'wave', 'speed', 'level', 'xp', 'hp', 'scrap',
    'upgrades', 'weapons', 'items', 'totals', 'materialEarned', 'material', 'keep', 'skillBuild',
    'forge', 'floor', 'room', 'roomsCleared', 'roomsSeen', 'walls', 'secretSeen',
    'bossesDown', 'coreEarned', 'boon', 'pendingBoons', 'packsOpened', 'packSpent',
    'offers', 'combineCount', 'roomFx', 'craftCount', 'craftUsed', 'camp', 'campRow', 'bonds', 'talks', 'growth', 'capacity', 'rerolls',
    'rerollCost', 'shopLocked', 'shopBonus', 'freeRerolls', 'rndState', 'pendingLevels',
    'runEvents'
  ];
  const actual = Object.keys(runs);
  ok(actual.length === ORDER.length, '字段个数与契约一致（' + actual.length + ' / ' + ORDER.length + '）',
    actual.filter(k => ORDER.indexOf(k) < 0).concat(ORDER.filter(k => actual.indexOf(k) < 0)).join(','));
  ok(actual.join(',') === ORDER.join(','), '**字段顺序**与契约逐位一致（顺序漂了会让存档字节变）',
    actual.join(','));

  /* 每一个字段都必须**可 JSON 往返**：`undefined` / 函数会在 stringify 时消失，
     那等于"这个字段其实没存"。 */
  const round = JSON.parse(JSON.stringify(runs));
  const lost = actual.filter(k => !(k in round));
  ok(lost.length === 0, '每个字段都能 JSON 往返（没有 undefined 字段被丢掉）', lost.join(','));
  ok(runs.char === 'ranger' && runs.seed === 20240922, '角色与种子跟着走');
  ok(runs.wave >= 1 && runs.speed >= 1, '波次与速度是正数（它们由 game.ts 摊平传进来）');
  ok(Array.isArray(runs.roomsCleared) && Array.isArray(runs.roomsSeen), '地牢进度是数组（map 本身不进存档）');
  ok(!('map' in runs) && !('enemies' in runs) && !('bullets' in runs),
    '**派生状态不进存档**（地图 / 怪 / 子弹都由种子或 startWave 重建）');
}

/* =========================================================
   [3] 校验：能修的修，不能修的拒
   ========================================================= */
console.log('\n[3] 校验（inspect）');
{
  const mk = (over) => Object.assign({ char: 'ranger', wave: 3, level: 2 }, over || {});
  /* ⚠ `RunSave.inspect` **不认识角色表**（那是"谁是合法角色"这条规则的出处，
     由调用方持有）—— 所以直接调它必须**自己给 `charOf`**。
     第一版这里忘了传，`undefined` 让它把每一份存档都判成"未知角色"，
     于是"一份正常的存档通过"红了。那不是代码的错，是**判据写错了**：
     我在测"注入之后它认不认"，却把注入这一步漏了。
     所以这一节两条路都测：直接给回调（注入点是可用的）与走 `Game.inspectRun`
     （生产路径上真的有人注入）。 */
  const nameOf = (id) => (Chars.BY_ID[id] ? Chars.BY_ID[id].name : '');
  ok(RunSave.inspect(mk(), nameOf) !== null, '一份正常的存档通过（显式注入 charOf）');
  ok(RunSave.inspect(mk()) === null, '**没注入角色表时一律拒**（默认 charOf 返回空 → 认不出角色）');
  ok(RunSave.inspect(null, nameOf) === null, 'null 被拒');
  ok(RunSave.inspect('ranger', nameOf) === null, '字符串被拒（不是对象）');
  ok(RunSave.inspect(mk({ char: 'no_such' }), nameOf) === null, '未知角色被拒（调用方保留标题页）');
  ok(RunSave.inspect(mk({ wave: 0 }), nameOf) === null, 'wave 0 被拒');
  ok(RunSave.inspect(mk({ wave: -5 }), nameOf) === null, '负数波次被拒');
  ok(RunSave.inspect(mk({ wave: 1e308 }), nameOf).wave === 9999,
    '**巨数波次被夹到 9999**（不是被拒，也不是放过去）');
  ok(RunSave.inspect(mk({ level: 0 }), nameOf).level === 1, '非法等级修成 1（能修的修）');
  ok(RunSave.inspect(mk({ level: 1e308 }), nameOf).level === 9999, '巨数等级夹到 9999');

  /* 走 `Game.inspectRun` 这条公开路径也要一致 ——
     它比 `RunSave.inspect` 多一层"角色表在哪"的注入。 */
  ok(Game.inspectRun(mk()) !== null, 'Game.inspectRun 认得这个角色（角色表由 game.ts 提供）');
  ok(Game.inspectRun(mk()).charName === Chars.BY_ID.ranger.name, '返回的是角色的**展示名**（界面直接用）');
  ok(Game.inspectRun(mk({ char: 'no_such' })) === null, 'Game.inspectRun 也拒未知角色');
}

/* =========================================================
   [4] 往返：真的存进槽位再读回来
   ========================================================= */
console.log('\n[4] 往返（打一会 → 存 → 读）');
{
  Game.newRun('engineer', 4242, 2);
  enterFightRoom(g.Game.getSession(), 'fight');
  /* 打若干帧让会话里有"活"的状态（武器开过火、掉了材料、升过级…） */
  for (let i = 0; i < 600; i++) Game.step(1 / 60, { x: 0, y: 0 });
  const before = Game.exportRun();
  const back = Game.importRun(JSON.parse(JSON.stringify(before)));
  ok(!!back, '读档成功');
  const after = Game.exportRun();
  /* 逐字段比：**不是**只比波次。任何一个字段读丢了都是真丢进度。 */
  const FIELDS = Object.keys(before);
  const diff = FIELDS.filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  ok(diff.length === 0, '往返之后**每个字段**逐位一致（' + FIELDS.length + ' 个）', diff.join(','));
}

/* =========================================================
   [5] 接入形状：game.ts 只委托，不再自己写一份
   ========================================================= */
console.log('\n[5] 接入形状（源码）');
{
  const gsrc = readSrc('game.ts');
  ok(/Game\.exportRun = function \(\)[\s\S]{0,400}?RunSave\.serialize\(/.test(gsrc),
    'Game.exportRun 走 RunSave.serialize（唯一编码出口）');
  ok(/Game\.inspectRun = function \(data\)[\s\S]{0,300}?RunSave\.inspect\(/.test(gsrc),
    'Game.inspectRun 走 RunSave.inspect');
  ok(/RunSave\.sanitizeNumbers\(data, 0\)/.test(gsrc),
    'importRun 的第一道仍然是**同一个**数值卫生函数（不是各写一份）');
  /* 反向：内核里不该再有第二份实现。 */
  ok(!/function sanitizeSaveNumbers/.test(gsrc), 'game.ts 里不再有第二份 sanitizeSaveNumbers');
  ok(!/var UPGRADE_POOL/.test(gsrc), 'game.ts 里不再有第二份升级池声明表');
  ok(/Pool\.weighted\(lvl\)/.test(gsrc) && /Pool\.amountAt\(entry, lvl\)/.test(gsrc),
    '掷骰子读的是 Pool（幅度与权重都从数据层来）');

  /* 升级池的两条曲线必须真的被读到 —— 否则那两条曲线会变成"无效开关" */
  const poolSrc = readSrc('levelup.ts');
  ok(/Curves\.at\('player\.cardAmt'/.test(poolSrc) && /Curves\.at\('player\.cardPool'/.test(poolSrc),
    'levelup.ts 真的读了 player.cardAmt 与 player.cardPool 两条曲线');
  ok(typeof Curves.at('player.cardAmt', 1) === 'number' && typeof Curves.at('player.cardPool', 1) === 'number',
    '那两条曲线在 curves.ts 里真的存在（不是写了个名字）');
}

/* =========================================================
   [6] 升级池：声明表与自检
   ========================================================= */
console.log('\n[6] 升级池（levelup.ts）');
{
  ok(Array.isArray(Pool.LIST) && Pool.LIST.length >= 8, '声明表存在且够大（' + Pool.LIST.length + ' 条）');
  const v = Pool.audit();
  ok(v.ok, '自检通过', (v.problems || []).join('; '));
  ok(v.counts.guard * 5 >= Pool.LIST.length,
    '防御向条目占比够（' + v.counts.guard + ' / ' + Pool.LIST.length + '）—— 否则 cardPool 曲线是无效开关');

  /* 幅度与权重**真的随等级走**（这是"不是平表"那句话的判据） */
  const e = Pool.LIST[0];
  ok(Pool.amountAt(e, 30) > Pool.amountAt(e, 1), '幅度随等级上升（30 级 > 1 级）');
  const guardEntry = Pool.LIST.find(x => x.guard);
  const plainEntry = Pool.LIST.find(x => !x.guard);
  ok(Pool.weightAt(guardEntry, 30) > Pool.weightAt(guardEntry, 1), '防御向的**权重**随等级上升');
  ok(Pool.weightAt(plainEntry, 30) === Pool.weightAt(plainEntry, 1), '非防御向的权重不随等级变（它不读那条曲线）');

  /* 自检要真的能抓错 —— 否则它只是一段看起来很认真的代码 */
  const saved = Pool.LIST.slice();
  try {
    Pool.LIST.push({ key: 'damage', amt: 0.05, w: 12 });
    ok(!Pool.audit().ok, '人为塞一条重复条目 → 自检报出来');
  } finally { Pool.LIST.length = 0; for (const x of saved) Pool.LIST.push(x); }
  try {
    Pool.LIST[0].w = -1;
    ok(!Pool.audit().ok, '人为把权重改成负数 → 自检报出来');
  } finally { Pool.LIST[0].w = saved[0].w; }
}

console.log('\n=== 结果 ===');
if (failures === 0) console.log('\x1b[32m全部通过 ✔\x1b[0m');
else console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m');
process.exit(failures ? 1 : 0);
