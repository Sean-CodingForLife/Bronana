/* =========================================================
   fold.ts — 数值折叠：一张表，四种折法
   ---------------------------------------------------------
   要解决的问题只有一句话：**"把一条修正折进一个数"这件事被写了五遍。**

     danger.ts:131      mul / add / min / or      四路
     game.ts:1428       mul / add / min           三路 + else 覆盖
     dungeon.ts:276     mul / add / min           三路 + else 覆盖
     boons.ts:89        只认 mul                   其余当 add
     data_items.ts:395  只认 add                   其余当 mul

   而 `how` 本身也被声明了**四份**（`danger.FOLD` / `boons.MOD_KEYS` /
   `dungeon.MOD_KEYS` / `data_items.COST_KINDS`），`types.d.ts` 里却写成裸 `string`。

   这四处不一致不是"风格问题"，是**能静默分叉**的：
   `game.ts:1456` 的注释写着"折法取自 `Danger.FOLD`（唯一来源），所以不会出现
   '两处各写一套怎么折'" —— 但 `boons.ts` 有自己的那一套，走的是自己的 `MOD_KEYS`。
   实测：把 `boons.MOD_KEYS.enemyHp` 从 `'mul'` 改成 `'add'`（`Danger.FOLD` 保持 `'mul'`），
   **17 道门全绿** —— 而 `boons.apply` 会做加法、`game.foldInto` 会做乘法。
   注释声称的"唯一来源"从来没成立过。

   所以这里只留一处实现：
     · `Fold.LIST`    —— 声明的**唯一**一张折法表（`Registry` 家族 `foldOp`）
     · `Fold.apply`   —— 唯一的分派（通用，返回 number | boolean）
     · `Fold.num`     —— 数值门面（`or` 退化成 0/1；只认识 × / + / min 的表用这个，类型不用 `any`）
     · `Fold.identity`/`Fold.numIdentity` —— 唯一"还没折过时的初值"

   一条纪律：**初值必须真的是该折法的恒等元**（`×` 用 1、`+` 用 0、`min` 用 Infinity、
   `or` 用假）。写错的后果是"第一次折就偏了"，而且它不会被任何断言抓到 ——
   除非把这条性质本身写成自检。`audit()` 就是这么做的（拿探针逐个验恒等元）。
   ========================================================= */
import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';

var Fold = {} as FoldApi;

/* =========================================================
   1. 表
   ---------------------------------------------------------
   `identity` 是**恒等元**，不是"默认值"：`apply(op, identity(op), v)` 必须等于 `v`。
   `sign` 说明这个折法把数值当什么看 —— 界面与审计都按它判读：
     ratio  = 倍率（乘出来的）
     amount = 数量（加出来 / 取小出来的）
     flag   = 开关（或出来的，可能不是数字）
   ========================================================= */
Fold.LIST = [
  {
    id: 'mul', name: '乘', sign: 'ratio', identity: 1,
    note: '叠乘 —— 倍率表用。初值必须是 1：写成 0 会把整条链乘没'
  },
  {
    id: 'add', name: '加', sign: 'amount', identity: 0,
    note: '叠加 —— 加成表用。初值必须是 0'
  },
  {
    id: 'min', name: '取小', sign: 'amount', identity: Infinity,
    note: '只会变小 —— "最多 / 最早"这类约束用（如"每 N 间房出 Boss"）。Infinity = 还没有约束'
  },
  {
    id: 'or', name: '或', sign: 'flag', identity: false,
    note: '出现过就为真 —— 结构开关用（如"Boss 来两只"）。初值必须是假'
  }
];

Fold.BY = (function () {
  var m: Record<string, FoldDef> = Object.create(null);
  for (var i = 0; i < Fold.LIST.length; i++) m[Fold.LIST[i].id] = Fold.LIST[i];
  return m;
})();

/** 认不出的折法返回 0（数值门面最安全的初值）；真派上用场说明审计漏了 */
Fold.identity = function (op) {
  var d = Fold.BY[op];
  return d ? d.identity : 0;
};

/** 数值版初值 —— 只认识 × / + / min 的表用它，省掉一层 `number | boolean` */
Fold.numIdentity = function (op) { return Number(Fold.identity(op)); };

/**
 * **唯一**的分派。`or` 返回布尔（`test/danger.mjs` 断言 `doubleBoss === true`），
 * 其余返回数。认不出的折法**原样返回**（不动）—— 静默不动比静默改成别的更安全，
 * 而"认不出"这件事由 `audit()` 与 `Registry` 在定义期就挡掉，运行期不该出现。
 */
Fold.apply = function (op, cur, v) {
  if (op === 'mul') return (cur as number) * (v as number);
  if (op === 'add') return (cur as number) + (v as number);
  if (op === 'min') return Math.min(cur as number, v as number);
  if (op === 'or') return (cur as boolean) || !!v;
  return cur;
};

/** 数值门面：给"键集里只可能出现 × / + / min"的表用（敌人修正 / 代价折算 / 层间契约） */
Fold.num = function (op, cur, v) { return Number(Fold.apply(op, cur, v)); };

/**
 * 只支持"倍率 / 加成"的折法子集。
 * `data_items.foldCosts` 按折法**分桶**（乘的进 mul、加的进 add）交给消费方 —
 * 那是代价的性质决定的（代价只有"翻倍"和"加固定量"两种），不是漏了另两种。
 * 把它写成一张显式的子集，而不是散在 if 里的隐式假设。
 */
Fold.BUCKET_OPS = ['mul', 'add'];

/**
 * 定义期自检。查两件事：
 *   · 表被写坏（重号 / 缺字段 / 恒等元对它自己不是恒等元）
 *   · 分桶子集里的名字在表里存在
 * 恒等元那一条是**拿探针实测**的（不是"字段非空就算过"）——
 * 一条抓不到错的审计等于装饰。
 */
Fold.audit = function () {
  var problems: string[] = [];
  var i;
  var seen: Record<string, boolean> = Object.create(null);
  for (i = 0; i < Fold.LIST.length; i++) {
    var d = Fold.LIST[i];
    if (!d.id) { problems.push('第 ' + (i + 1) + ' 行没有 id'); continue; }
    if (seen[d.id]) problems.push('折法重号：' + d.id);
    seen[d.id] = true;
    if (!d.name) problems.push(d.id + ' 没有名字');
    if (!d.note) problems.push(d.id + ' 没有说明');
    if (['ratio', 'amount', 'flag'].indexOf(d.sign) < 0) problems.push(d.id + ' 的 sign 不认识：' + d.sign);
    /* 恒等元实测：拿两个"跨过恒等元两侧"的探针各验一次 */
    var probes: FoldValue[] = d.sign === 'flag' ? [true, false] : [3, 0.5];
    for (var p = 0; p < probes.length; p++) {
      var got = Fold.apply(d.id, d.identity, probes[p]);
      var want = d.id === 'or' ? !!probes[p] : probes[p];
      if (got !== want) {
        problems.push(d.id + ' 的恒等元不是恒等元：apply(' + d.id + ', ' + String(d.identity) +
          ', ' + String(probes[p]) + ') = ' + String(got) + '，应为 ' + String(want));
        break;
      }
    }
  }
  for (i = 0; i < Fold.BUCKET_OPS.length; i++) {
    if (!Fold.BY[Fold.BUCKET_OPS[i]]) problems.push('分桶子集里的折法不在表里：' + Fold.BUCKET_OPS[i]);
  }
  /* `or` 必须是布尔折法 —— `DangerMods.doubleBoss: boolean` 与 test/danger.mjs 都吃这个 */
  if (Fold.BY['or'] && Fold.BY['or'].sign !== 'flag') {
    problems.push('or 的 sign 应当是 flag（它的返回值是布尔，不是数）');
  }
  return {
    ok: problems.length === 0, problems: problems,
    counts: { ops: Fold.LIST.length, buckets: Fold.BUCKET_OPS.length }
  };
};

var foldVerdict = Fold.audit();
if (!foldVerdict.ok) throw new Error('fold.ts 折法表自检失败：\n' + foldVerdict.problems.join('\n'));
SelfCheck.register('Fold', Fold.audit);

/* =========================================================
   2. 登记到扩展点总账
   ---------------------------------------------------------
   为什么它该进总账：`how` 的**合法取值**是一件事，四张表（danger / boons / dungeon /
   data_items）都在写它。不进总账就没有任何东西能回答"这个折法写错了没有" ——
   改造前正是如此：`how` 在 `types.d.ts` 里是裸 `string`，写错一个字母要等
   数值表现不对才被发现（而"表现不对"通常被当成配平问题）。
   ========================================================= */
Registry.family('foldOp', {
  note: '数值折叠方式（把一条修正折进一个数：× / + / 取小 / 或）', owner: 'fold.ts',
  entries: function () {
    return Fold.LIST.map(function (d) { return { id: d.id, refs: [] }; });
  }
});

export { Fold };
