/* =========================================================
   eco_manage.ts — **经营账本**（含建造子模块 + 经营子模块）
   ---------------------------------------------------------
   v3 §二-3：
     "经营模块 = **建造子模块 + 经营子模块**，对外仍是一个模块、
      **一套经营代币账本**。"
   v3 §三-2：
     "建造子模块：**布局、设施、升级、解锁、空间规划**。
      经营子模块：**资源、生产、供需、效率、市场、人员、时间**。
      经营模块内部子模块**可共享经营代币**，但不得让建造机制承载
      战斗或养成的成长。"

   于是这本账只有**一笔**代币，而两个子模块**共用**它 ——
   "共用"正是"它们同属一个模块"的判据（外部子模块不共用）。

   ⚠ 子模块**不各记一本账**：那样它们就成了两个模块，而 v3 说
   "对外是一个模块、一套账本"。所以这里只有一笔钱，子模块的区别
   体现在**它花在哪**（建造花在设施/布局；经营花在产能/效率），
   不体现在"用哪种钱"。
   ========================================================= */
import { Ledger } from './ledger.ts';
import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';

var Manage = {} as ManageApi;

Ledger.define({
  id: 'manage',
  owner: 'manage',
  name: '经营账本（建造 + 经营共用）',
  note: '经营模块内部的账：建造子模块与经营子模块共用这一笔代币',
  currencies: [
    {
      id: 'capacity', name: '产能',
      note: '经营模块运转出来的东西：设施产出、订单结算、效率提升的结余。' +
        '**建造子模块**用它盖设施 / 排布局 / 解锁空间，' +
        '**经营子模块**用它扩产能 / 提效率 / 雇人 / 调供需',
      why: '它是"经营"自己的成绩单：只有**把经营做**好才产得出来。' +
        '若它也能从战斗直接买来，经营就退化成战斗的附属窗口 —— ' +
        'v3 §5.4-错误1 点名的正是这条路'
    }
  ]
});

/* =========================================================
   两个子模块
   ---------------------------------------------------------
   `scope` 逐条抄自 v3 §三-2（那是**需求原文**，不是自己编的清单）——
   抄进来的好处是：以后有人想动这份清单，得先面对"它与需求原文不一致"
   这件事，而不是悄悄少一个子领域。

   `money` 说的是**这一子模块在产能这笔钱上扮演哪一边**：
     · `spend`   —— 它花产能（建造：盖设施）
     · `produce` —— 它产能（经营：生产与效率的结余）
   一个模块的钱要转起来，两边都得有人 —— 只有一边就是死水。
   ========================================================= */
Manage.SUBMODES = [
  {
    id: 'build', name: '建造',
    scope: ['布局', '设施', '升级', '解锁', '空间规划'],
    owner: 'stronghold.ts',
    money: 'spend',
    note: '盖设施、排布局、解锁新位置 —— 决定**经营能长到多大**',
    why: '它只花不产：如果建造自己能把产能变多，那"把经营做好"就退化成' +
      '"多点几次建造"，而这正是 v3 §三-2 那句"不得让建造机制承载其它模块的成长"要防的'
  },
  {
    id: 'ops', name: '经营',
    scope: ['资源', '生产', '供需', '效率', '市场', '人员', '时间'],
    owner: 'craft.ts',
    money: 'produce',
    note: '让设施**真的运转起来** —— 产线、效率、供需，产能从这里出来',
    why: '它只产不花：经营的成绩单在建造那边兑现（盖得更大），' +
      '如果它自己也能花，就成了"用产能换产能"的空转'
  }
];

Manage.BY_ID = (function () {
  var m: Record<string, ManageSubDef> = Object.create(null);
  for (var i = 0; i < Manage.SUBMODES.length; i++) m[Manage.SUBMODES[i].id] = Manage.SUBMODES[i];
  return m;
})();

/** v3 §三-2 的两份清单（**原文**，用来对账 —— 少一个子领域要有人解释） */
Manage.SCOPE_OF = {
  build: ['布局', '设施', '升级', '解锁', '空间规划'],
  ops: ['资源', '生产', '供需', '效率', '市场', '人员', '时间']
};

/* =========================================================
   自检
   ---------------------------------------------------------
   每一条对着一个真实故障：
     · 子领域与 v3 §三-2 的原文对不上 → 有人悄悄少写了一个（那是需求漂移）
     · 两边不是"一产一花" → 钱要么是死水（都花），要么是印钞机（都产）
     · 只声明了一个子模块 → 那就不叫"拆出两个子模块"了
   ========================================================= */
Manage.audit = function () {
  var problems: string[] = [];
  if (Manage.SUBMODES.length !== 2) {
    problems.push('子模式应当是**两个**（建造 + 经营，v3 §二-3），现在是 ' + Manage.SUBMODES.length + ' 个');
  }
  var seen: Record<string, boolean> = Object.create(null);
  for (var i = 0; i < Manage.SUBMODES.length; i++) {
    var s = Manage.SUBMODES[i];
    if (!s.id) { problems.push('第 ' + i + ' 个子模块没有 id'); continue; }
    if (seen[s.id]) problems.push('子模块 id 重复：' + s.id);
    seen[s.id] = true;
    if (!s.name) problems.push(s.id + ' 没有名字');
    if (!s.note) problems.push(s.id + ' 没有说明');
    if (!s.why) problems.push(s.id + ' 没有 why');
    if (!s.owner) problems.push(s.id + ' 没说清由哪个文件承载');
    if (s.money !== 'produce' && s.money !== 'spend') {
      problems.push(s.id + ' 的 `money` 是 ' + s.money + ' —— 只能是 produce 或 spend');
    }
    if (!s.scope.length) problems.push(s.id + ' 没有子领域 —— 那它就不是一个子模块');
    /* 子领域逐条对账 v3 §三-2 的**原文** */
    var want = Manage.SCOPE_OF[s.id];
    if (!want) { problems.push(s.id + ' 不在 v3 §三-2 的清单里'); continue; }
    for (var j = 0; j < want.length; j++) {
      if (s.scope.indexOf(want[j]) < 0) {
        problems.push('「' + s.name + '」少了子领域「' + want[j] + '」—— v3 §三-2 的原文里有它');
      }
    }
    for (var k = 0; k < s.scope.length; k++) {
      if (want.indexOf(s.scope[k]) < 0) {
        problems.push('「' + s.name + '」多了一个 v3 §三-2 里没有的子领域「' + s.scope[k] + '」');
      }
    }
  }
  /* 一产一花：两边都得有人，否则钱不转 */
  var prod = Manage.SUBMODES.filter(function (s) { return s.money === 'produce'; }).length;
  var spen = Manage.SUBMODES.filter(function (s) { return s.money === 'spend'; }).length;
  if (prod !== 1 || spen !== 1) {
    problems.push('两个子模块应当**一产一花**（现在 produce=' + prod + ' spend=' + spen + '）—— ' +
      '都花是死水，都产是印钞机，而 v3 §5.1 说模块代币"产出在本模块、消费在本模块"');
  }
  return { ok: problems.length === 0, problems: problems, counts: { subs: Manage.SUBMODES.length, scopes: Manage.SCOPE_OF.build.length + Manage.SCOPE_OF.ops.length } };
};

var verdict = Manage.audit();
if (!verdict.ok) throw new Error('eco_manage.ts 自检失败：\n' + verdict.problems.join('\n'));

SelfCheck.register('Manage', Manage.audit);

Registry.family('manageSubMode', {
  note: '经营模块的两个子模块（建造 / 经营）；子领域逐条对账 v3 §三-2 的原文',
  owner: 'eco_manage.ts',
  values: function () { return Manage.SUBMODES.map(function (s) { return s.id; }); }
});

export { Manage };
