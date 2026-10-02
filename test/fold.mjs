/* =========================================================
   fold.mjs — 数值折叠：一张表、四种折法、**四张声明表之间不许打架**

   这一套存在的唯一理由是一个实测过的静默故障：

     改造前 `how`（把一条修正折进一个数的方式）是裸 `string`，
     并且在**四个文件**里各声明了一遍 ——

       danger.FOLD        （14 个键）
       boons.MOD_KEYS     （14 个键）
       dungeon.MOD_KEYS   （ 8 个键）
       data_items.COST_KINDS（11 个键）

     分派也手写了五遍，取值集合互不一致（四路 / 三路 + else 覆盖 / 只认 mul / 只认 add）。
     实测：把 `boons.MOD_KEYS.enemyHp` 从 `'mul'` 改成 `'add'`
     （`danger.FOLD.enemyHp` 保持 `'mul'`），**17 道门全绿** ——
     而此刻 `boons.apply` 会做加法、`game.foldInto` 会做乘法。
     同一个键，两条路径两种算法，没有任何东西会响。

   所以这套盯四件事：
     1) 表本身合法（每种折法都有名字、说明、方向；恒等元**实测**是恒等元）
     2) `Fold.apply` 的语义（四种折法各自算什么；认不出的折法**原样不动**）
     3) **跨表对账** —— 同一个键被多张表声明时，折法必须一致（这条守死上面那个故障）
     4) 四张表里每个 `how` 都在 `foldOp` 家族里（写错一个字母要报出来）

   用法： node test/fold.mjs
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
/* ⚠ **跨根枚举**（E4 批次 1）：只扫 `src/` 的断言在搬家后会"看着全绿、其实没看那些模块" */
import srcScan from '../tools/src-files.cjs';
import { loadAll, SIM_MODULES } from './_load.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
let failures = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  \x1b[32mPASS\x1b[0m ' + label);
  else { failures++; console.log('  \x1b[31mFAIL\x1b[0m ' + label + (extra !== undefined ? '  → ' + extra : '')); }
}

await loadAll(SIM_MODULES);
const { Fold, Danger, Boons, Dungeon, Items, Registry, SelfCheck } = globalThis;
console.error = function () { };

console.log('\n=== Bronana · 数值折叠 ===\n');

/* ---------------- 1. 表本身 ---------------- */
console.log('[1] 折法表');
{
  ok(Array.isArray(Fold.LIST) && Fold.LIST.length >= 4,
    '声明表里有四种折法（现在 ' + Fold.LIST.length + ' 种）', String(Fold.LIST && Fold.LIST.length));
  const ids = Fold.LIST.map((d) => d.id);
  ok(ids.join(',') === 'mul,add,min,or',
    '四种折法是 mul / add / min / or（顺序即声明的顺序）', ids.join(','));

  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  ok(dupes.length === 0, '没有重号的折法', dupes.join(','));

  let bad = [];
  for (const d of Fold.LIST) {
    if (!d.name) bad.push(d.id + ' 没名字');
    if (!d.note) bad.push(d.id + ' 没说明');
    if (['ratio', 'amount', 'flag'].indexOf(d.sign) < 0) bad.push(d.id + ' 的 sign 不认识：' + d.sign);
    if (Fold.BY[d.id] !== d) bad.push(d.id + ' 不在 BY 里（或指错了对象）');
  }
  ok(bad.length === 0, '每一项都有名字 / 说明 / 合法 sign，且 BY 指得对', bad.join(' | '));

  /* 恒等元**实测**：不是"字段非空就算过"。写错的后果是"第一次折就偏了"。 */
  const idBad = [];
  for (const d of Fold.LIST) {
    const probes = d.sign === 'flag' ? [true, false] : [3, 0.5, 7];
    for (const p of probes) {
      const got = Fold.apply(d.id, d.identity, p);
      const want = d.id === 'or' ? !!p : p;
      if (got !== want) idBad.push(d.id + '(' + String(d.identity) + ',' + String(p) + ')→' + String(got));
    }
  }
  ok(idBad.length === 0, '每种折法的恒等元**实测**是恒等元（apply(op, 恒等元, v) === v）', idBad.join(' | '));

  ok(Fold.BY['mul'].identity === 1 && Fold.BY['add'].identity === 0,
    '× 的恒等元是 1、+ 的恒等元是 0（写反会把整条链乘没 / 加飞）',
    'mul=' + Fold.BY['mul'].identity + ' add=' + Fold.BY['add'].identity);
  ok(Fold.BY['min'].identity === Infinity,
    '取小的恒等元是 Infinity（还没有约束），不是 0（那会把一切都压到 0）',
    String(Fold.BY['min'].identity));
  ok(Fold.BY['or'].identity === false,
    '或的恒等元是假（还没出现过）', String(Fold.BY['or'].identity));
}

/* ---------------- 2. apply 的语义 ---------------- */
console.log('\n[2] 四种折法各自算什么');
{
  ok(Fold.apply('mul', 2, 3) === 6, '× ：2 × 3 = 6', String(Fold.apply('mul', 2, 3)));
  ok(Fold.apply('add', 2, 3) === 5, '+ ：2 + 3 = 5', String(Fold.apply('add', 2, 3)));
  ok(Fold.apply('min', 5, 3) === 3, '取小：min(5, 3) = 3', String(Fold.apply('min', 5, 3)));
  ok(Fold.apply('min', 3, 5) === 3, '取小：只变小，不变大（min(3, 5) = 3）', String(Fold.apply('min', 3, 5)));
  ok(Fold.apply('or', false, true) === true, '或：假 ∨ 真 = 真', String(Fold.apply('or', false, true)));
  ok(Fold.apply('or', true, false) === true, '或：真 ∨ 假 = 真（它记的是"出现过"）', String(Fold.apply('or', true, false)));
  ok(Fold.apply('or', false, false) === false, '或：假 ∨ 假 = 假', String(Fold.apply('or', false, false)));

  /* `or` 必须返回**布尔**：`DangerMods.doubleBoss: boolean`，而 test/danger.mjs
     断言的是 `l9.doubleBoss === true`（严格相等）。返回 1 会在那里红。 */
  ok(typeof Fold.apply('or', false, true) === 'boolean',
    '或返回的是布尔而不是 1 —— `doubleBoss === true` 那条断言吃这个类型',
    typeof Fold.apply('or', false, true));

  /* 认不出的折法：**原样返回**（不动）。
     为什么不是"当 add"：静默不动至少不会把值改成另一个数量级；
     而"认不出"这件事由 audit + 家族 + 联合类型在定义期就挡掉了。 */
  ok(Fold.apply('没这个折法', 42, 3) === 42,
    '认不出的折法原样返回（不动），不会静默改成加法或覆盖',
    String(Fold.apply('没这个折法', 42, 3)));
  ok(Fold.identity('没这个折法') === 0, '认不出折法的初值是 0（最安全的数值初值）');

  ok(Fold.num('mul', 2, 3) === 6 && Fold.num('or', 0, 1) === 1,
    '数值门面 `num` 与 `apply` 同源（或退化成 0/1，类型不传染 number | boolean）',
    Fold.num('mul', 2, 3) + ' / ' + Fold.num('or', 0, 1));
  ok(Fold.numIdentity('mul') === 1 && Fold.numIdentity('add') === 0 && Fold.numIdentity('min') === Infinity,
    '数值门面的初值与表一致', [Fold.numIdentity('mul'), Fold.numIdentity('add'), Fold.numIdentity('min')].join(','));
}

/* ---------------- 3. 跨表对账（这套的重点） ---------------- */
console.log('\n[3] 四张声明表之间不许打架');
{
  /* 每张表：名字 → 键 → 折法。收集成"键 → [{表, 折法}]"，然后看有没有同键不同折法。 */
  const tables = [
    { name: 'danger.FOLD', get: (k) => Danger.FOLD[k], keys: () => Object.keys(Danger.FOLD) },
    { name: 'boons.MOD_KEYS', get: (k) => { const d = Boons.MOD_KEYS[k]; return d && d.how; }, keys: () => Object.keys(Boons.MOD_KEYS) },
    { name: 'dungeon.MOD_KEYS', get: (k) => { const d = Dungeon.MOD_KEYS[k]; return d && d.how; }, keys: () => Object.keys(Dungeon.MOD_KEYS) },
    { name: 'items.COST_KINDS', get: (k) => { const d = Items.COST_KINDS[k]; return d && d.how; }, keys: () => Object.keys(Items.COST_KINDS) }
  ];

  const byKey = new Map();
  for (const t of tables) {
    for (const k of t.keys()) {
      const how = t.get(k);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push({ table: t.name, how: how });
    }
  }
  const shared = [...byKey.entries()].filter(([, v]) => v.length > 1);
  ok(shared.length > 0, '确实有键被多张表同时声明（否则这条检查是空转）',
    '重叠键 ' + shared.length + ' 个');

  const conflicts = [];
  for (const [k, list] of shared) {
    const uniq = [...new Set(list.map((x) => String(x.how)))];
    if (uniq.length > 1) {
      conflicts.push(k + '：' + list.map((x) => x.table + '=' + x.how).join(' vs '));
    }
  }
  ok(conflicts.length === 0,
    '重叠键的折法在四张表之间一致（' + shared.length + ' 个重叠键逐一对账）',
    conflicts.join(' | '));

  /* 把重叠键的名字打出来 —— 这是"哪些键有两份声明"的事实清单，
     下次有人想改其中一个折法时，这份清单就是他要看的东西。 */
  console.log('      重叠键（' + shared.length + ' 个）：' +
    shared.map(([k, v]) => k + '×' + v.length).join(' · '));
}

/* ---------------- 4. 每个 how 都在家族里 ---------------- */
console.log('\n[4] 声明表里的折法都在 `foldOp` 家族里');
{
  const legal = Registry.ids('foldOp');
  ok(legal.join(',') === 'mul,add,min,or',
    '总账里的 foldOp 家族就是折法表本身（' + legal.length + ' 种）', legal.join(','));

  const tables = [
    { name: 'danger.FOLD', pairs: () => Object.keys(Danger.FOLD).map((k) => [k, Danger.FOLD[k]]) },
    { name: 'boons.MOD_KEYS', pairs: () => Object.keys(Boons.MOD_KEYS).map((k) => [k, Boons.MOD_KEYS[k].how]) },
    { name: 'dungeon.MOD_KEYS', pairs: () => Object.keys(Dungeon.MOD_KEYS).map((k) => [k, Dungeon.MOD_KEYS[k].how]) },
    { name: 'items.COST_KINDS', pairs: () => Object.keys(Items.COST_KINDS).map((k) => [k, Items.COST_KINDS[k].how]) }
  ];
  const bad = [];
  let total = 0;
  for (const t of tables) {
    for (const [k, how] of t.pairs()) {
      total++;
      if (!how) bad.push(t.name + '.' + k + ' 没有折法');
      else if (legal.indexOf(how) < 0) bad.push(t.name + '.' + k + ' 的折法是 ' + how + '（不在家族里）');
    }
  }
  ok(bad.length === 0, '四张表共 ' + total + ' 条折法声明，取值全部合法', bad.join(' | '));

  /* 代价的折法只能落在分桶子集里 —— `foldCosts` 只分了两个桶，
     写一个 min 进来会被静默折进 mul 桶（这是隐式假设，现在显式声明）。 */
  const bucketBad = [];
  for (const k of Object.keys(Items.COST_KINDS)) {
    const how = Items.COST_KINDS[k].how;
    if (Fold.BUCKET_OPS.indexOf(how) < 0) bucketBad.push(k + '=' + how);
  }
  ok(bucketBad.length === 0,
    '代价键的折法都在分桶子集里（' + Fold.BUCKET_OPS.join('/') + '）', bucketBad.join(' | '));

  /* 自检登记：模块级 audit 必须进了 SelfCheck，不然定义期那道闸是空的 */
  const names = SelfCheck.names();
  ok(names.indexOf('Fold') >= 0,
    'fold.ts 的自检已登记进 SelfCheck（audit 是定义期那道闸）', names.join(','));
}

/* ---------------- 5. 折法实现只有一处 ---------------- */
console.log('\n[5] 折法实现只有一处');
{
  const src = path.join(ROOT, 'src');
  const sites = ['danger.ts', 'boons.ts', 'dungeon.ts', 'data_items.ts', 'game.ts'];
  const missing = [];
  for (const f of sites) {
    const t = fs.readFileSync(path.join(src, f), 'utf8');
    if (t.indexOf('Fold.') < 0) missing.push(f);
  }
  ok(missing.length === 0,
    '五个原来的分派点都改走 `Fold`（' + sites.length + ' 个文件）', missing.join(', '));

  /* `Fold.apply` 的**定义**只该有一处。
     ⚠ 这里刻意**不去**扫描"`=== 'mul')` 后跟算术"那种模式：读 `how` 的地方不止折法 ——
     `ui.ts` 按它决定显示 ×还是只显示文案、`boons.ts` 的审计按它判"倍率必须是正数"、
     `effectText` 按它选 ×/+ 号。那些是**读数**，不是第二份折法实现。
     一条分不清这两者的检查会把对的写法判成错的（第一版就是，误报了 ui.ts:2315），
     所以这里只钉真正不可替代的那条：定义只有一份。 */
  let defs = 0;
  const where = [];
  for (const { base: f, code: t } of srcScan.sources(m => m.rel.endsWith('.ts'))) {
    const n = (t.match(/Fold\.apply\s*=\s*function/g) || []).length;
    if (n) { defs += n; where.push(f + '×' + n); }
  }
  ok(defs === 1 && where[0] === 'fold.ts×1',
    '`Fold.apply` 的定义在全仓库只有一处（在 fold.ts 里）', where.join(', '));

  /* 四个折法分支的**语义**也只该在一处出现 —— 拿一个"每种折法都算一遍"的探针，
     结果必须与 `Fold.apply` 逐个相等。这条不依赖文本形状，所以不会误报。 */
  const probes = [['mul', 2, 3, 6], ['add', 2, 3, 5], ['min', 5, 3, 3], ['or', false, true, true]];
  const wrong = probes.filter(([op, a, b, want]) => Fold.apply(op, a, b) !== want)
    .map(([op]) => op);
  ok(wrong.length === 0, '四种折法的语义与声明一致（逐种实测，不依赖文本形状）', wrong.join(','));
}

/* ---------------- 汇总 ---------------- */
console.log('\n=== 结果 ===');
if (failures === 0) {
  console.log('\x1b[32m全部通过 ✔\x1b[0m\n');
  process.exit(0);
} else {
  console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m\n');
  process.exit(1);
}
