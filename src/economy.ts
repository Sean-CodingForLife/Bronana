/* =========================================================
   economy.ts — 货币表（**唯一**的一张：五笔货币各自的层级、来源与去向）
   ---------------------------------------------------------
   问题（改造前）：五种货币各自散落在拥有它的那个模块里 ——
     · 材料        `game.ts`（局内随手加加减减，没有一处能回答"它一共从哪来"）
     · 建材        `camp.ts` 的 `POINTS_PER_WAVE`（**局内**货币，只在营地里花）
     · 孢子        `profile.ts` 的 `spores`
     · 合金        `profile.ts` 的 `alloy` + `forge.ts` 的解锁价
   于是三条循环的形状只能靠读完整局代码去拼，而且**没人能回答**：
   "这一笔资源该不该存在、它该从哪来、它该花在哪、它和别的货币能不能换"。

   ⚠ **建材那一笔已经被删掉了**（用户拍板"材料靠战斗获得，玩家自己花材料打造"）：
   它原先只服务于"局内营地"，而营地在同一轮里搬到了**经营场景**。
   两笔钱合并成一笔之后，"打 → 拿材料 → 造装备 → 再打"才是一条完整的循环 ——
   建材的六个来源（每波 +2 / 精英 / 宝箱 / 补给 / 密室 / 商店建材包）现在全部发**材料**。

   取材：一份公开的货币系统设计总结（[multiple currency types](https://github.com/raduacg/game-mechanics-optimizations/blob/main/I_46_multiple_currency_types.md) ·
   [temporary vs permanent resources](https://github.com/raduacg/game-mechanics-optimizations/blob/main/I_47_temporary_vs_permanent_resources.md) ·
   [resource conversion](https://github.com/raduacg/game-mechanics-optimizations/blob/main/I_48_resource_conversion.md)）。

   它把货币分成**四个层级**，而每一层解决一个不同的心理问题：

     层级        赚多少/局      花在哪              心理作用
     session     100~500       局内立刻变强          "现在就该花掉"（高风险）
     bridge      30~100        局外、跨局           "死了也没白打"（安全感）
     meta-rare   1~5           卡住**大块内容**     "这一局值了"（里程碑）
     ultra-rare  0.1~1         声望 / 解锁          "长期目标"

   于是本作的五笔钱各归其位（**这一张表就是三模块循环的骨架**）：

     废料      session   ← 战斗（刷怪 / 清间）           → 只在战斗场景里花
     材料      bridge    ← 战斗（刷怪 / 清间 / 房间）    → 经营：盖产线、**造装备**
     核心材料  meta-rare ← **只有 Boss 掉**（每层关底）   → 经营 + 养成（共同门槛）
     孢子      bridge    ← 战斗结算（打得越深越多）      → 只在养成里花
     合金      bridge    ← 回收装备                      → 只在养成里花

   而"它们各自花在哪"就是三个模块的分工：
     战斗（战斗场景）  花**废料**：局内商店 / 刷新（花完就没了）
     经营（经营场景）  花**材料 + 核心材料**：盖产线、造装备与道具
     养成（养成场景）  花**孢子 + 合金 + 核心材料**：长久成长与关键能力

   ⚠ 这三者不是"三个并列的菜单屏"，而是**同一个游戏进程里的三个阶段**
   （白天经营、夜里出战那种）：打完一轮回到经营场景，用这一轮打到的材料
   盖产线、造装备，再带着新装备打下一轮。所以"局内 / 局外"只是
   "战斗场景里 / 战斗场景外"的简称，别按字面当成两块分离的界面。

   ⚠ **这一次改动是用户拍板的方向**（原话："材料是能带得出去的，也不该是在局内消费的"），
   它同时改了三件事：
     · `废料`（新）接手"局内通用钱"那个位置，`材料` 让出它
     · `材料` 从 `session` 升成 `bridge` —— 于是"带出去建东西"第一次成立
     · `孢子` 的去向收窄成只有 `grow`，经营改花材料 —— 两个局外模块从此不共用钱包

   改之前，"经营花材料"是一句**写错的注释**（材料是 `session` 档、结算清零，
   买不了局外的东西）；现在它是真的，而且由 `audit()` 的文案判据盯着：
   说明里提到的每一笔钱都必须真的流向那个模块。
   三条纪律（每一条都能被审计）：
     1. **一笔钱只有一个"层级"**：层级决定它能不能带出局 —— `session` 类的钱
        结算时清零（这是"局内经济不穿到局外"的机制保证，不是纪律）。
     2. **来源与去向都要写出来**，而且必须是**已登记的系统名**（`战斗/经营/养成`）。
        一条"来源不明"的货币 = 谁也说不清它为什么会多出来。
     3. **兑换方向单向且稀有在上**（Brotato 没有兑换、Hades 的 Wretched Broker 是单向梯子）。
        本作**刻意没有兑换**：四笔钱各自对应一条独立的循环边，
        能互换就只剩一条曲线了（`data_items.ts` 里合金与孢子那句注释是同一个理由）。
   ========================================================= */
import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';

var Eco = {} as EconomyApi;

/* =========================================================
   1. 层级与系统（两张值域）
   ========================================================= */
var TIERS: Record<string, CurrencyTierDef> = {
  session: {
    name: '局内', note: '只有这一局能用，结算清零 —— 它买的是"现在"',
    lifetime: 'run'
  },
  bridge: {
    name: '跨局', note: '打完一局带得出去，安全感：死了也没白打',
    lifetime: 'account'
  },
  'meta-rare': {
    name: '关键', note: '每局只有几笔，卡住**大块内容**（设施 / 建筑 / 关键能力）',
    lifetime: 'account'
  }
};

/** 三个模块（战斗 / 经营 / 养成）。货币的来源与去向都必须是这三个之一 */
var SYSTEMS: Record<string, SystemDef> = {
  combat: { name: '战斗', note: '局内：刷怪、清间、打 Boss。**唯一**能产出的地方', where: 'in-run' },
  manage: {
    name: '经营', where: 'meta',
    note: '局外：花材料与核心材料盖设施与建筑 —— 产能与容量',
    /* 改造前这一行写的是"孢子与核心材料"，而用户的要求是**两个局外模块各花各的钱**：
       孢子归养成，经营改花**材料**（那笔钱现在真的带得出局了 —— 见 `Eco.LIST`
       里 `material` 的 tier：它从 `session` 改成了 `bridge`）。 */
  },
  grow: {
    name: '养成', where: 'meta',
    note: '局外：花孢子 / 合金 / 核心材料（天赋点另算）做长久成长与关键能力'
  }
};

/* =========================================================
   2. 货币表（**唯一**的一张）
   ---------------------------------------------------------
   一行一笔钱。`from` / `to` 写的是**系统名**（不是文件、不是函数）——
   于是"这条循环通不通"可以静态查：每笔钱都必须有来源、有去向，
   而且来源必须是 `combat`（只有战斗能产出）。
   ========================================================= */
Eco.LIST = [
  {
    id: 'scrap', name: '废料', tier: 'session',
    /* ⚠ **这一笔钱与 `material` 是两回事**，名字改了是因为它们曾经是同一笔：
       改造前"材料"既是局内的通用钱、又被写成经营的主币 —— 而它结算清零，
       于是"经营花材料"那句话从一开始就是假的。
       现在拆开：**废料**（局内，花完就没了）与**材料**（跨局，只供经营）。 */
    from: ['combat'], to: ['combat'],
    note: '击杀掉落 + 清间结算。**局内**的通用钱：买货架、造装备、刷新',
    why: '局内决策要有一个立刻能花的东西，否则"这一波打得好不好"没有即时反馈'
  },
  {
    id: 'material', name: '材料', tier: 'bridge',
    /* 用户原话："材料是能带得出去的，也不该是在局内消费的"。
       所以它现在是**跨局**档：战斗里刷怪攒下、带出局，只在**经营**里花
       （盖设施 / 建筑 / 产线）。它与孢子一样是 bridge 档，但**归属不同模块** ——
       这正是"两个局外模块各花各的钱"的实现方式。 */
    from: ['combat'], to: ['manage'],
    note: '刷怪 + 清间攒下、**带出局**（`Profile.addMaterial` → 经营钱包）。' +
      '只在经营里花：盖设施 / 建筑 / 产线',
    why: '它是"经营"的燃料：战斗打得越久攒得越多。**战斗场景里一分不花** ——' +
      '花它的地方是经营场景（盖产线、造装备），那正是"打 → 拿材料 → 造 → 再打"这条循环'
  },
  {
    id: 'core', name: '核心材料', tier: 'meta-rare',
    from: ['combat'], to: ['manage', 'grow'],
    note: '**只有每层关底的 Boss 掉**（`Enemies` 的 boss 标记 + `startWave` 的 Boss 波）',
    why: '它是"这一局值得"的那一笔。若它也能刷出来，局外那条线就退化成"多打几把"了。' +
      '**它是两个局外模块共同的稀缺门槛** —— 于是经营与养成争的是同一笔稀有资源'
  },
  {
    id: 'spore', name: '孢子', tier: 'bridge',
    /* ⚠ **去向改成只有 `grow`**。改造前它还流向 `manage`（据点设施花孢子），
       而用户的要求是"经营与养成各花各的钱" —— 于是孢子归**养成**，
       经营改花材料。这一行是那两个模块解耦的关键。 */
    from: ['combat'], to: ['grow'],
    note: '战斗结算按深度给（`Profile.sporesForRun`）—— 哪怕三四波就死也有。' +
      '**只供养成**（天赋树与洗点）',
    why: '安全感：坏的一局也在推进局外。这是"死了也没白打"的来源'
  },
  {
    id: 'alloy', name: '合金', tier: 'bridge',
    from: ['combat'], to: ['grow'],
    note: '**回收装备**产出（`market.sellWeapon` → 结算入账）。不掉落、不靠深度',
    why: '它奖励"舍"而不是"得"：把不要的装备拆掉换成长。给结算之外的第二条节奏'
  }
];

Eco.BY_ID = (function () {
  var m: Record<string, CurrencyDef> = Object.create(null);
  for (var i = 0; i < Eco.LIST.length; i++) m[Eco.LIST[i].id] = Eco.LIST[i];
  return m;
})();

Eco.TIERS = TIERS;
Eco.SYSTEMS = SYSTEMS;

/** 这笔钱在这一局结束时清不清零（层级决定，不是各处自己判） */
Eco.isSession = function (id) { var d = Eco.BY_ID[id]; return !!d && d.tier === 'session'; };
/** 这笔钱能不能带出去 */
Eco.isAccount = function (id) { var d = Eco.BY_ID[id]; return !!d && d.tier !== 'session'; };
/** 这笔钱的来源里有 `sys` 吗（`combat` / `manage` / `grow`） */
Eco.flowsFrom = function (id, sys) { var d = Eco.BY_ID[id]; return !!d && d.from.indexOf(sys) >= 0; };
Eco.flowsTo = function (id, sys) { var d = Eco.BY_ID[id]; return !!d && d.to.indexOf(sys) >= 0; };
/** 某一层级的全部货币 id */
Eco.byTier = function (tier) {
  return Eco.LIST.filter(function (d) { return d.tier === tier; }).map(function (d) { return d.id; });
};
/** 某一条循环边上的全部货币（`combat → manage` 这条边有哪几笔钱） */
Eco.edge = function (from, to) {
  return Eco.LIST.filter(function (d) { return d.from.indexOf(from) >= 0 && d.to.indexOf(to) >= 0; })
    .map(function (d) { return d.id; });
};

/**
 * **循环图**：三个模块之间的边，以及每条边上流的是什么。
 * 这是这一张表真正的产物 —— 它把"三模块怎么互相喂"从散文变成数据。
 */
Eco.loop = function () {
  var edges: Array<{ from: string; to: string; what: string[] }> = [];
  var ids = Object.keys(SYSTEMS);
  for (var i = 0; i < ids.length; i++) {
    for (var j = 0; j < ids.length; j++) {
      if (i === j) continue;
      var what = Eco.edge(ids[i], ids[j]);
      if (what.length) edges.push({ from: ids[i], to: ids[j], what: what });
    }
  }
  return { systems: ids, edges: edges };
};

/**
 * **反哺边**（局外 → 战斗）：局外花掉资源买到的东西，
 * 在下一局开局那一刻折成一份修正并进会话。
 *
 * 这一档**不是货币**，是"开局条件"：`opening` / `kmods` / `fmods`
 * 在 `newSession` 里折一次，之后模拟层**不再回表**。
 * 这就是"三个模块不互相穿透"的实现方式 ——
 * 战斗那一侧永远只看到一份折好的初始条件，看不到"据点有几级"。
 *
 * 为什么从"缺口清单"改成了"正面声明"：
 * `Eco.GAPS` 曾经把这两条边登记成缺口，而它们其实一直在工作
 * （只是以效果而不是货币的形式）。那张表因此会**永远**报"缺 2 条"——
 * 一把会撒谎的尺子。现在每条边都写清"谁提供 / 什么在限制它"，
 * 而 `limit` 必须指向**真的花掉核心材料或稀有资源**的东西：
 * 白给的反哺不是循环的一环，是开场福利。
 */
Eco.BACKFLOW = [
  {
    from: 'manage', to: 'combat',
    what: '据点设施 → 下一局的开局条件',
    via: 'Stronghold.modsFor → kmods（开局折一次）',
    limit: 'archive Lv.3 要 2 个核心材料（只有关底 Boss 掉）',
    gate: 'core',
    note: '买到的都是"能力/容量/目录"（多一条产线、多一件货、拆解全额返还），' +
      '没有一条把数字乘到战斗的柱子上 —— 这正是它与战斗不嵌合的地方'
  },
  {
    from: 'grow', to: 'combat',
    what: '天赋与图纸 → 下一局的开局条件与能造什么',
    via: 'Talent.opening → opening；Forge.modsFor → fmods（开局折一次）',
    limit: 'myth 图纸要 2 个核心材料；天赋点按通关波次给',
    gate: 'core',
    note: '图纸给的是"能造到 T几"（解锁能力），不是"开局白送一把 T4" ——' +
      '后者是"养成直接给战斗数值"，正是要拆的耦合'
  }
];

/** 某个系统通过哪几条反哺边回到战斗（空 = 它只进不出，是条死胡同） */
Eco.backflowFrom = function (sys) {
  var out = [];
  for (var i = 0; i < Eco.BACKFLOW.length; i++) if (Eco.BACKFLOW[i].from === sys) out.push(Eco.BACKFLOW[i]);
  return out;
};

/**
 * **已知的缺口**：循环里还没有的东西。
 *
 * 这一节存在的意义是**诚实**：`audit()` 只能证明"表自洽"，
 * 证明不了"循环闭合"。所以这里登记"还缺什么"，`audit()` 会数出来、
 * `tools/loop-audit.mjs` 会打印出来 —— 而不是让人以为循环已经闭合了。
 *
 * **现在是空的**：两条反哺边已经改成正面声明（见 `Eco.BACKFLOW`），
 * 机制留着 —— "机制在、数据空"与"数据在、机制没做"是两件完全不同的事。
 */
Eco.GAPS = [];

/** 循环图里**还缺**的边（`audit` 与体检工具都读它，同一份判据） */
Eco.missingEdges = function () {
  var out: Array<{ from: string; to: string; what: string }> = [];
  for (var i = 0; i < Eco.GAPS.length; i++) {
    var g = Eco.GAPS[i];
    if (!Eco.edge(g.from, g.to).length) out.push({ from: g.from, to: g.to, what: g.what });
  }
  return out;
};

/* =========================================================
   3. 定义期自检
   ---------------------------------------------------------
   每一条都对着一个**真实的静默故障**：
     · 层级不认识 → `isSession` 返回 false → 那笔钱会被**静默带出局**
     · `from` 里出现非 `combat` 的系统 → "局外能自己印钱"（循环断了一边）
     · 某笔钱没有去向 → 它是一笔只能攒不能花的死钱
     · 某个系统没有任何货币流经它 → 那个模块**不参与循环**（等于不存在）
     · 层级少了一档 / 没有 meta-rare → 循环缺一层，"里程碑"那一档消失
   ========================================================= */
Eco.audit = function () {
  var problems: string[] = [];
  var seen: Record<string, boolean> = Object.create(null);
  var tierUsed: Record<string, number> = Object.create(null);
  var sysAsFrom: Record<string, number> = Object.create(null);
  var sysAsTo: Record<string, number> = Object.create(null);
  var i, j;

  for (i = 0; i < Eco.LIST.length; i++) {
    var d = Eco.LIST[i];
    if (!d.id) problems.push('第 ' + i + ' 笔货币没有 id');
    if (seen[d.id]) problems.push('货币 id 重复：' + d.id);
    seen[d.id] = true;
    if (!d.name) problems.push(d.id + ' 没有中文名（界面要显示它）');
    if (!d.note) problems.push(d.id + ' 没有说明（"从哪来、花在哪"要写出来）');
    if (!d.why) problems.push(d.id + ' 没有 why —— 说不出它为什么存在的货币不该存在');
    if (!TIERS[d.tier]) { problems.push(d.id + ' 的层级没登记：' + d.tier); continue; }
    tierUsed[d.tier] = (tierUsed[d.tier] || 0) + 1;

    if (!d.from || !d.from.length) problems.push(d.id + ' 没有来源（它是从哪冒出来的？）');
    if (!d.to || !d.to.length) problems.push(d.id + ' 没有去向（一笔只能攒不能花的死钱）');
    for (j = 0; j < (d.from || []).length; j++) {
      var f = d.from[j];
      if (!SYSTEMS[f]) problems.push(d.id + ' 的来源不是已登记的系统：' + f);
      else {
        sysAsFrom[f] = (sysAsFrom[f] || 0) + 1;
        /* **只有战斗能产出**。局外能印钱 = 它自己就是一条循环，
           战斗那一侧就变成可选的了（那正是"三个模块互相嵌合"的反面）。 */
        if (f !== 'combat') problems.push(d.id + ' 的来源是 ' + SYSTEMS[f].name + ' —— 只有战斗能产出货币');
      }
    }
    for (j = 0; j < (d.to || []).length; j++) {
      var t = d.to[j];
      if (!SYSTEMS[t]) problems.push(d.id + ' 的去向不是已登记的系统：' + t);
      else sysAsTo[t] = (sysAsTo[t] || 0) + 1;
    }
    /* 局内货币必须**有**局内去向；跨局货币必须**没有**局内去向
       （否则"这一局的钱能买局外的东西"，两条经济就串了） */
    if (d.tier === 'session' && d.to.indexOf('combat') < 0) {
      problems.push(d.id + ' 是局内货币却没有局内去向');
    }
    if (d.tier !== 'session' && d.to.indexOf('combat') >= 0) {
      problems.push(d.id + ' 是跨局货币却有局内去向（局外的东西不该用局内的钱买）');
    }
  }

  var tierNames = Object.keys(TIERS);
  for (i = 0; i < tierNames.length; i++) {
    if (!tierUsed[tierNames[i]]) problems.push('层级 ' + TIERS[tierNames[i]].name + ' 一笔货币都没有 —— 这一档是装饰');
  }
  if (!tierUsed['meta-rare']) problems.push('没有 meta-rare 那一档：循环缺"里程碑"这一层');
  if (Eco.LIST.length < 3) problems.push('货币少于 3 笔：三条循环边立不住');

  var sysNames = Object.keys(SYSTEMS);
  for (i = 0; i < sysNames.length; i++) {
    var s = sysNames[i];
    if (!sysAsFrom[s] && !sysAsTo[s]) {
      problems.push('系统「' + SYSTEMS[s].name + '」不参与任何货币流动 —— 它不在循环里');
    }
    if (s !== 'combat' && !sysAsTo[s]) {
      problems.push('系统「' + SYSTEMS[s].name + '」没有任何货币流向它 —— 它没有投入');
    }
  }
  /* **模块说明文案不许撒谎**（这条是踩出来的）：
     `SYSTEMS.manage.note` 曾经写着"花材料与核心材料盖设施"，而 `Profile.keepBuy`
     扣的是 `data.spores` 与 `data.core` —— 材料是 `session` 档，结算清零，
     **根本买不了局外设施**。一句错注释的代价是下一个人据此去读 `materials`。
     判据取"这句话里提到的每一笔钱，都得真的流进这个模块"：
     提到却没流向它的货币名 → 报错。于是文案再也漂不走。 */
  for (i = 0; i < sysNames.length; i++) {
    var nm = SYSTEMS[sysNames[i]].name;
    var note = SYSTEMS[sysNames[i]].note || '';
    for (j = 0; j < Eco.LIST.length; j++) {
      var cur = Eco.LIST[j];
      if (note.indexOf(cur.name) < 0) continue;
      if (cur.to.indexOf(sysNames[i]) >= 0) continue;
      /* ⚠ 「核心材料」里含「材料」——**子串命中不算命中**。
         否则"花孢子与核心材料"这句话会因为"材料不流向经营"被误报。
         判据：只有当**没有任何更长**的货币名包含它、且更长者确实流向本系统时才放过。 */
      var covered = false;
      for (var q = 0; q < Eco.LIST.length; q++) {
        var other = Eco.LIST[q];
        if (other === cur || other.name.length <= cur.name.length) continue;
        if (other.name.indexOf(cur.name) < 0) continue;
        if (other.to.indexOf(sysNames[i]) >= 0) { covered = true; break; }
      }
      if (covered) continue;
      problems.push('系统「' + nm + '」的说明里提到了「' + cur.name +
        '」，但那笔钱并不流向它（说明写错了，或者货币表漏了一笔）');
    }
  }
  /* 循环图至少要有一条边把战斗连到两个局外模块上（各一条） */
  if (!Eco.edge('combat', 'manage').length) problems.push('战斗 → 经营 这条边没有货币');
  if (!Eco.edge('combat', 'grow').length) problems.push('战斗 → 养成 这条边没有货币');

  /* **已知缺口**也必须"登记得上"：`GAPS` 里写的每条边，
     要么真的缺（那是有意记下的待办），要么已经被补上（那就该删掉这条登记）。
     一条"已经补上了却还挂在缺口清单里"的记录会让体检工具永远报假警。 */
  for (var gi = 0; gi < Eco.GAPS.length; gi++) {
    var gap = Eco.GAPS[gi];
    if (!SYSTEMS[gap.from] || !SYSTEMS[gap.to]) {
      problems.push('缺口登记 ' + gap.from + '→' + gap.to + ' 里有未登记的系统');
    }
    if (Eco.edge(gap.from, gap.to).length) {
      problems.push('缺口 ' + SYSTEMS[gap.from].name + ' → ' + SYSTEMS[gap.to].name +
        ' 已经有货币在走了 —— 这条缺口登记该删了');
    }
    if (!gap.todo) problems.push('缺口 ' + gap.from + '→' + gap.to + ' 没写 todo（补它要做什么）');
  }

  /* ---- 反哺边：每个非战斗系统都必须有一条回到战斗的路 ----
     否则那个模块是**死胡同**：玩家在它身上花掉的一切永远回不到下一局，
     它就从"循环的一环"退化成"结算界面旁边的一堆按钮"。 */
  var sysIds = Object.keys(SYSTEMS);
  for (i = 0; i < sysIds.length; i++) {
    if (sysIds[i] === 'combat') continue;
    if (!Eco.backflowFrom(sysIds[i]).length) {
      problems.push(SYSTEMS[sysIds[i]].name + ' 没有任何反哺边回到战斗（只进不出 = 死胡同）');
    }
  }
  for (i = 0; i < Eco.BACKFLOW.length; i++) {
    var bf = Eco.BACKFLOW[i];
    if (!SYSTEMS[bf.from] || !SYSTEMS[bf.to]) { problems.push('反哺边的系统不认识：' + bf.from + ' → ' + bf.to); continue; }
    if (bf.to !== 'combat') problems.push('反哺边的终点必须是战斗：' + bf.to);
    if (!bf.what || !bf.via || !bf.limit) problems.push('反哺边写不全（what / via / limit 三样都要有）：' + bf.from);
    /* `limit` 必须说清"什么在限制它"：**白给的反哺不是循环的一环，是开场福利**。
       判据是它必须提到一个真的会被花掉的东西（资源或门槛）。 */
    if (bf.limit && !/核心材料|孢子|合金|通关|波次/.test(bf.limit)) {
      problems.push('反哺边「' + bf.from + ' → ' + bf.to + '」的 limit 没指明限制来自哪种资源/门槛：' + bf.limit);
    }
  }

  return {
    ok: problems.length === 0, problems: problems,
    counts: {
      currencies: Eco.LIST.length, tiers: tierNames.length,
      systems: sysNames.length, edges: Eco.loop().edges.length,
      backflow: Eco.BACKFLOW.length,
      gaps: Eco.GAPS.length
    }
  };
};

var verdict = Eco.audit();
if (!verdict.ok) throw new Error('economy.ts 货币表自检失败：\n' + verdict.problems.join('\n'));
SelfCheck.register('Economy', Eco.audit);

/* =========================================================
   4. 登记到扩展点总账
   ---------------------------------------------------------
   层级与系统都是值域：写错一个（`meta_rare` / `management`）会让
   `isSession` 静默返回 false —— 那笔钱会被**静默带出局**。
   ========================================================= */
Registry.family('currency', {
  note: '货币（四笔钱：材料 / 核心材料 / 孢子 / 合金）', owner: 'economy.ts',
  entries: function () {
    return Eco.LIST.map(function (d) {
      var refs = [{ field: 'tier', value: d.tier, family: 'currencyTier' }];
      for (var i = 0; i < d.from.length; i++) refs.push({ field: 'from[' + i + ']', value: d.from[i], family: 'loopSystem' });
      for (var j = 0; j < d.to.length; j++) refs.push({ field: 'to[' + j + ']', value: d.to[j], family: 'loopSystem' });
      return { id: d.id, refs: refs };
    });
  }
});
Registry.family('currencyTier', {
  note: '货币层级（局内 / 跨局 / 关键）—— 层级决定它能不能带出局', owner: 'economy.ts',
  values: function () { return Object.keys(TIERS); }
});
Registry.family('loopSystem', {
  note: '循环的三个模块（战斗 / 经营 / 养成）—— 货币的来源与去向都写它们', owner: 'economy.ts',
  values: function () { return Object.keys(SYSTEMS); }
});

Registry.uses('tier', 'currencyTier');

export { Eco as Economy };
