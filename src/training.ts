/* =========================================================
   training.ts — **养成模块的第一个局内行动**（训练）
   ---------------------------------------------------------
   设计上下文 v3 §8-3 说养成模块的产出动作是：

     "训练、突破、与 NPC 相处到某个关系阶段、把一条能力线走通"

   这个文件实现**第一个**（训练）。它同时解决 R43 暴露出来的那个问题：

     ⚠ 合并之后 `growth` 的两条产出（打得深 / 合成）**都产在战斗动作上**，
       而 v3 §5.2 的三条边是 **战斗→经营→养成→战斗** ——
       **没有"战斗 → 养成"**。那两条产出必须搬进养成模块内部。

   ## 三个设计决定，依据都在需求里

   **① 它花 `material`（全局货币）**
     v3 §5.1：全局货币"更像'税'或'行动成本'，不是钱"。
     训练是一个**动作** ⇒ 它付的是行动成本 ⇒ `material`。✓

   **② 它产 `growth`（养成代币）**
     v3 §5.1：模块代币"产出在本模块、**消费在本模块**"。
     `growth` 的去处是天赋树与图纸 —— 两者都在养成模块里。✓

   **③ 每波限次 = 模块内的时间感**
     v3 §8-12："模块内时间感独立"。形状与制造的"**每波每条产线一次**"同一套
     （见 `craftUsed`）—— 不是冷却计时器，是**"这一波你只有这么多回合"**。

   ## 为什么每训练一次会变贵

   如果价格恒定，最优解永远是"先攒够材料再连点" —— 那就不存在取舍了。
   递增的代价让"这一波练几次"成为**真的决策**（与制造的产线位同一个形状）。
   ========================================================= */
import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';

var Train = {} as TrainingApi;

/* =========================================================
   参数（都写在这里，别处不许加）
   ---------------------------------------------------------
   为什么不用据点/图纸的修正去改它：那会让养成模块的产能被**经营**决定，
   而 v3 §5.4-错误4 点名的正是"直接花另一个模块的资源去买本模块的能力"。
   训练的代价只由 `material`（全局货币，三模块通用）与本表决定。
   ========================================================= */
Train.LIST = [
  {
    id: 'drill', name: '操练',
    cost: 4, gain: 3,
    note: '一次基础训练：把材料换成成长点',
    why: '它是养成模块**最基础的产出**，也是"不训练就没有成长点"的第一道墙'
  },
  {
    id: 'breakthrough', name: '突破',
    cost: 12, gain: 11,
    note: '一次高强度训练：代价大、收益也大',
    why: '有了它，"这一波练三次操练还是攒着突破一次"才是一个真的选择'
  }
];

Train.BY_ID = (function () {
  var m: Record<string, TrainingDef> = Object.create(null);
  for (var i = 0; i < Train.LIST.length; i++) m[Train.LIST[i].id] = Train.LIST[i];
  return m;
})();

/** 每波能做几次训练（**模块内的时间感**：不是冷却，是回合数） */
Train.PER_WAVE = 3;

/**
 * 第 `n` 次（从 0 数）训练某个科目要花多少材料。
 *
 * 递增：`cost + n × step`。`step` 取 `cost` 的三分之一 —— 第三次大约是两倍价。
 * ⚠ 递增是**刻意的**（见文件头）：价格恒定的话"连点"永远是最优解。
 */
Train.costOf = function (id, n) {
  var d = Train.BY_ID[id];
  if (!d) return 0;
  var step = Math.ceil(d.cost / 3);
  return d.cost + Math.max(0, Math.floor(Number(n) || 0)) * step;
};

/** 这一波还能训练几次 */
Train.left = function (used) {
  return Math.max(0, Train.PER_WAVE - Math.max(0, Math.floor(Number(used) || 0)));
};

/** 这一波训练了 `used` 次之后，各科目下一次的价钱（界面铺一屏要它） */
Train.options = function (used, material) {
  var mat = Math.max(0, Math.floor(Number(material) || 0));
  var out: Array<{ id: string; name: string; note: string; cost: number; gain: number; ok: boolean; reason: string }> = [];
  var left = Train.left(used);
  for (var i = 0; i < Train.LIST.length; i++) {
    var d = Train.LIST[i];
    var cost = Train.costOf(d.id, used);
    var ok = left > 0 && mat >= cost;
    var reason = '';
    if (left <= 0) reason = '这一波已经训练满了（' + Train.PER_WAVE + ' 次）';
    else if (mat < cost) reason = '材料不够（需要 ' + cost + '）';
    out.push({ id: d.id, name: d.name, note: d.note, cost: cost, gain: d.gain, ok: ok, reason: reason });
  }
  return out;
};

/* =========================================================
   自检
   ---------------------------------------------------------
   每一条对着一个真实故障：
     · 代价 0 或收益 0 → 那个科目是白送的，训练就不成为决策
     · 每波次数 ≤ 0 → 养成模块**产不出任何东西**（这个文件就没意义了）
     · 科目重名 / 缺说明 → 界面铺不出来
   ========================================================= */
Train.audit = function () {
  var problems: string[] = [];
  var seen: Record<string, boolean> = Object.create(null);
  for (var i = 0; i < Train.LIST.length; i++) {
    var d = Train.LIST[i];
    if (!d.id) { problems.push('第 ' + i + ' 个训练科目没有 id'); continue; }
    if (seen[d.id]) problems.push('训练科目 id 重复：' + d.id);
    seen[d.id] = true;
    if (!d.name) problems.push(d.id + ' 没有名字');
    if (!d.note) problems.push(d.id + ' 没有说明');
    if (!d.why) problems.push(d.id + ' 没有 why');
    if (!(d.cost > 0)) problems.push(d.id + ' 的代价是 ' + d.cost + ' —— 白送的训练不成为决策');
    if (!(d.gain > 0)) problems.push(d.id + ' 的收益是 ' + d.gain + ' —— 产不出成长点的训练没有意义');
    if (d.gain > d.cost) {
      problems.push(d.id + ' 的收益（' + d.gain + '）超过代价（' + d.cost + '）—— ' +
        '那样它会变成"材料换成长点"的印钞机，而材料是三模块通用的行动成本');
    }
  }
  if (!(Train.PER_WAVE > 0)) {
    problems.push('每波可训练次数是 ' + Train.PER_WAVE + ' —— 养成模块**产不出任何东西**');
  }
  /* 递增必须真的递增：不然"连点"永远最优 */
  for (var j = 0; j < Train.LIST.length; j++) {
    var id = Train.LIST[j].id;
    if (!(Train.costOf(id, 1) > Train.costOf(id, 0))) {
      problems.push(id + ' 的训练代价不递增（' + Train.costOf(id, 0) + ' → ' + Train.costOf(id, 1) + '）—— ' +
        '价格恒定的话"连点"永远是最优解');
    }
  }
  return { ok: problems.length === 0, problems: problems, counts: { drills: Train.LIST.length, perWave: Train.PER_WAVE } };
};

/* 定义期就炸：与其它表一个套路 */
var verdict = Train.audit();
if (!verdict.ok) throw new Error('training.ts 自检失败：\n' + verdict.problems.join('\n'));

SelfCheck.register('Training', Train.audit);

Registry.family('trainingDrill', {
  note: '养成模块的训练科目（局内行动：花全局货币换养成代币）',
  owner: 'training.ts',
  values: function () { return Train.LIST.map(function (d) { return d.id; }); }
});

export { Train };
