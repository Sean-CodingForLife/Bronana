/* =========================================================
   station.ts — **大厅（站）**：每一次开局进入的地方
   ---------------------------------------------------------
   参考：深岩银河的太空站 —— 一局开始你在站里，从站里的门去各个地方。

   用户的设计原话（这一份文件存在的全部理由）：

     "这三个模块都在游戏局内，然后点击开始是进入一个大厅，通过大厅再去
      其他的模块玩…怎么去别的模块？**通过传送门**…每次游戏开始时进入的
      就是这个大厅"
     "这个世界里的时间流速都是一致的，只是这个世界分成了三块，
      每块都有自己的玩法和机制，仅此而已，**想去哪就去哪**"

   两条纪律：

   1. **传送门要建成才能开**（用户确认）。于是"这一局先去哪个模块"是
      玩家的**第一个决策**，而不是开局就把三块全铺开。
      出生只有「出击门」开着 —— 去打、拿材料、回来把经营门盖起来，
      经营产出的东西再开养成门。**开门的顺序就是这一局的骨架。**

   2. 大厅**不是菜单**。它是这一局的一个**场景**：从战斗回大厅是
      **走回来**（`scene` 里 `station` 这一档），不是"退出到主菜单"。
      所以它归局内状态（`Session.station`），不归账号档案。

   ⚠ 与旧的那个"枢纽"的区别（别把它们混起来）：
   旧 `hub` 是 `scene.ts` 里 `sim:false` 的**局外**覆盖层，注释写着
   "局与局之间的'家'（NPC 对话推进剧情；不推进模拟）"。
   大厅是**局内**的、**推进这一局**的入口。两者名字像，性质相反。
   ========================================================= */
import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';
import { Economy } from './economy.ts';

var Station = {} as StationApi;

/* =========================================================
   1. 站点表（**唯一**的一张）
   ---------------------------------------------------------
   一行一个站点。`to` 写的是**模块名**（`Economy.SYSTEMS` 那三个之一），
   于是"这道门通向一个不存在的模块"能在定义期被抓住。

   `cost` 是**建成它要花什么**（现在只花全局货币「材料」）。
   `req` 是前置站点 —— 顺序是有意的：出击 → 经营 → 养成。
   ⚠ **三扇门全部常开**（2026-09 用户拍板，依据设计上下文 v3 §4-规则2）：

     "玩家**任何时候可以去任何模块**…**不做'不玩A就不能玩B'的锁**。"

   这一版之前我把门做成了"花 40 材料盖经营门 / 花 60 + 前置盖养成门"，
   那是**卡住**（不玩战斗就没材料 → 门开不了）。v3 要的是**撞墙**：

     "跳过某模块 → **撞墙**（那条路走不通），而不是被卡住（游戏不让你继续）。"

   两者的区别正是 v3 §九总体判断里那句"从'自由流动'变成'被迫刷取'"。
   撞墙体现在**模块内部**：缺核心素材 → 经营的关键建筑升不上去 →
   那条路推不动，但玩家随时能走过去看看它为什么推不动。

   所以 `cost` / `req` 这两个字段留着（机制在），但三道门**都是 0 且无前置**，
   而 `audit()` 反过来守这一条：**任何一道门都不许收费或有前置**。
   ========================================================= */
var SITES: StationSiteDef[] = [
  {
    id: 'gate-combat', name: '出击门', to: 'combat', kind: 'portal',
    cost: 0, req: [],
    note: '通向地牢 —— 这一局的材料、核心材料、孢子全靠它',
    why: '它是最要紧的一条路："一条路走到黑"必须从第一秒就通'
  },
  {
    id: 'gate-manage', name: '经营门', to: 'manage', kind: 'portal',
    cost: 0, req: [],
    note: '通向经营 —— 建造（布局 / 设施 / 升级）+ 经营（产能 / 供需 / 效率）',
    why: '**它不许收费**：v3 §4-规则2"玩家任何时候可以去任何模块"。' +
      '进门之后才谈得上卡：经营的关键建筑要核心材料，而核心材料只有战斗打 Boss 掉 ——' +
      '那是**撞墙**（推不动那条路），不是**卡住**（不让进）'
  },
  {
    id: 'gate-grow', name: '养成门', to: 'grow', kind: 'portal',
    cost: 0, req: [],
    note: '通向养成 —— 角色成长、NPC 羁绊、能力解锁（叙事线也在这边，但它不产经济资源）',
    why: '同上，不许有前置：把"先有经营才谈得上养成"写成**门的锁**，' +
      '玩家看到的就是"游戏不让我进"；写成**模块内的进料依赖**（养成要吃经营产的遗物），' +
      '他看到的是"我进去了，但那台机器缺料" —— 后者才是 v3 要的撞墙'
  },
  {
    /* 公告板：不是门，是**读这一局状态的地方**。
       为什么值得一行：四本账的余额与三个核心素材的进度如果没有一个地方能一次看全，
       "循环"在玩家那一侧就是不可见的。它不花任何东西（不进门 = 不要代价）。 */
    id: 'board', name: '公告板', to: null, kind: 'board',
    cost: 0, req: [],
    note: '把这一局的账摆出来：四本账各有多少、三个核心素材各差几次必出、下一步该去哪',
    why: '循环要**看得见**才算循环。v3 §9-建议7 还要求"软引导：撞墙提示 + 路径指引"——' +
      '而提示的前提是这里先把账摆明白'
  }
];

Station.LIST = SITES;
Station.BY_ID = (function () {
  var m: Record<string, StationSiteDef> = Object.create(null);
  for (var i = 0; i < SITES.length; i++) m[SITES[i].id] = SITES[i];
  return m;
})();

/* =========================================================
   2. 开门规则（纯函数；状态由调用方给）
   ========================================================= */

/** 出生就开着的站点（`cost` 为 0 且没有前置） */
Station.defaultOpen = function () {
  return SITES.filter(function (s) { return s.cost <= 0 && !s.req.length; })
    .map(function (s) { return s.id; });
};

/**
 * 这道门现在能不能开。
 * 三种"不行"分得清，因为它们的**修法完全不同**：
 *   · 已经开了       —— 别重复花钱
 *   · 前置没开       —— 得先回去盖另一扇门
 *   · 材料不够       —— 得回去打
 */
Station.canOpen = function (built, id, material) {
  var d = Station.BY_ID[id];
  if (!d) return { ok: false, reason: '没有这个站点', cost: 0 };
  if (d.kind !== 'portal') return { ok: false, reason: '它不是门（不用开）', cost: 0 };
  if (built && built[id] === true) return { ok: false, reason: '已经开了', cost: d.cost };
  for (var i = 0; i < d.req.length; i++) {
    if (!built || built[d.req[i]] !== true) {
      var r = Station.BY_ID[d.req[i]];
      return { ok: false, reason: '要先盖起「' + (r ? r.name : d.req[i]) + '」', cost: d.cost };
    }
  }
  if (Math.max(0, Number(material) || 0) < d.cost) {
    return { ok: false, reason: '材料不够（需要 ' + d.cost + '）', cost: d.cost };
  }
  return { ok: true, reason: '', cost: d.cost };
};

/** 从大厅能去哪些模块（只算**开着**的门） */
Station.reachable = function (built) {
  return SITES.filter(function (s) {
    return s.kind === 'portal' && built && built[s.id] === true;
  }).map(function (s) { return s.to; });
};

/** 这一局还没盖的门（界面用：把"下一条要什么"摆出来） */
Station.locked = function (built) {
  return SITES.filter(function (s) {
    return s.kind === 'portal' && !(built && built[s.id] === true);
  });
};

/* =========================================================
   3. 定义期自检
   ---------------------------------------------------------
   每一条都对着一个**真实的静默故障**：
     · `to` 写了一个不存在的模块 → 那道门通向虚无（点下去什么也不发生）
     · 某个模块一道门都没有 → 那个模块**这一局根本到不了**（等于不存在）
     · 前置成环 → 三扇门互相等，**一扇都开不了**（这一局卡死在站里）
     · 一个"出生就开"的门却有代价 → "免费开放"这件事不再成立，开局无路可走
     · 门不花任何东西 → 开门的顺序不再是决策（"想去哪就去哪"变成"全都能去"）
   ========================================================= */
Station.audit = function () {
  var problems: string[] = [];
  var seen: Record<string, boolean> = Object.create(null);
  var i, j;

  for (i = 0; i < SITES.length; i++) {
    var d = SITES[i];
    if (!d.id) { problems.push('第 ' + i + ' 个站点没有 id'); continue; }
    if (seen[d.id]) problems.push('站点 id 重复：' + d.id);
    seen[d.id] = true;
    if (!d.name) problems.push(d.id + ' 没有名字');
    if (!d.note) problems.push(d.id + ' 没有说明（玩家要知道那扇门后面是什么）');
    if (!d.why) problems.push(d.id + ' 没有 why —— 说不出它为什么存在的站点不该存在');
    if (d.kind !== 'portal' && d.kind !== 'board') problems.push(d.id + ' 的 kind 认不出：' + d.kind);
    if (d.kind === 'portal') {
      if (!d.to) problems.push(d.id + ' 是一道门却没有 `to`（它通向哪？）');
      else if (!Economy.SYSTEMS[d.to]) {
        problems.push(d.id + ' 通向一个不存在的模块：' + d.to + '（点下去什么也不会发生）');
      }
      if (!(d.cost >= 0)) problems.push(d.id + ' 的 cost 不是非负数');
    } else if (d.to) {
      problems.push(d.id + ' 不是门却有 `to`（它不通向任何地方，别写）');
    }
    for (j = 0; j < d.req.length; j++) {
      if (!Station.BY_ID[d.req[j]]) problems.push(d.id + ' 的前置不存在：' + d.req[j]);
      if (d.req[j] === d.id) problems.push(d.id + ' 的前置是它自己');
    }
  }

  /* 每个模块都要有一道门 —— 否则那个模块这一局到不了 */
  var mods = Object.keys(Economy.SYSTEMS);
  for (i = 0; i < mods.length; i++) {
    var gate = SITES.filter(function (s) { return s.kind === 'portal' && s.to === mods[i]; });
    if (!gate.length) {
      problems.push('模块「' + Economy.SYSTEMS[mods[i]].name + '」在大厅里**一道门都没有** —— ' +
        '这一局根本到不了它');
    } else if (gate.length > 1) {
      problems.push('模块「' + Economy.SYSTEMS[mods[i]].name + '」有 ' + gate.length +
        ' 道门（通向同一个地方的门只该有一道）');
    }
  }

  /* 前置不能成环：成环 = 三扇门互相等 = 这一局卡死在站里 */
  var state: Record<string, number> = Object.create(null);
  var walk = function (id, path) {
    if (state[id] === 1) {
      problems.push('站点前置成环：' + path.concat(id).join(' → ') + '（一扇门都开不了）');
      return;
    }
    if (state[id] === 2) return;
    state[id] = 1;
    var d = Station.BY_ID[id];
    if (d) for (var k = 0; k < d.req.length; k++) walk(d.req[k], path.concat(id));
    state[id] = 2;
  };
  for (i = 0; i < SITES.length; i++) if (SITES[i].kind === 'portal') walk(SITES[i].id, []);

  /* 出生那一刻**必须至少有一道门开着**，而且它必须免费开放 */
  var open = Station.defaultOpen();
  var openPortals = SITES.filter(function (s) {
    return s.kind === 'portal' && open.indexOf(s.id) >= 0;
  });
  if (!openPortals.length) {
    problems.push('出生时一道门都不开 —— 开局无路可走（至少「出击门」要免费开放）');
  }
  for (i = 0; i < openPortals.length; i++) {
    if (openPortals[i].cost !== 0) {
      problems.push(openPortals[i].id + ' 出生就开却有代价（' + openPortals[i].cost + '）—— ' +
        '"免费开放"这件事不成立，开局还是要先攒钱');
    }
  }

  /* ⚠ **每一道门都必须常开**（v3 §4-规则2："玩家任何时候可以去任何模块"）。
     这一条与上一版**正好相反** —— 上一版守的是"至少有一道门要花钱"，
     理由是"那样'先去哪个'才是决策"。v3 把那个理由否掉了：

       "跳过某模块 → **撞墙**（那条路走不通），而不是被卡住（游戏不让你继续）。"

     收费的门是**卡住**：不玩战斗就没材料 → 门开不了 → 玩家连经营长什么样都看不到。
     撞墙应当发生在**模块内部**（缺核心素材 → 关键建筑升不上去），
     而不是在门口。所以这里守的是反面。 */
  for (i = 0; i < SITES.length; i++) {
    var g = SITES[i];
    if (g.kind !== 'portal') continue;
    if (g.cost > 0) {
      problems.push(g.id + ' 要花 ' + g.cost + ' 才能开 —— ' +
        'v3 §4-规则2："玩家**任何时候可以去任何模块**"。收费的门是**卡住**，' +
        '撞墙应当发生在模块内部（缺核心素材），不是在门口');
    }
    if (g.req.length) {
      problems.push(g.id + ' 有前置（' + g.req.join('/') + '）—— 同上，' +
        '那正是"不玩A就不能玩B"的锁（v3 §4-规则2 明确不做）');
    }
  }

  return { ok: problems.length === 0, problems: problems, counts: { sites: SITES.length, portals: SITES.filter(function (s) { return s.kind === 'portal'; }).length } };
};

SelfCheck.register('Station', Station.audit);

/* =========================================================
   4. 登记到扩展点总账
   ========================================================= */
Registry.family('stationSite', {
  note: '大厅（站）里的站点：三道通往模块的门 + 公告板', owner: 'station.ts',
  entries: function () {
    return Station.LIST.map(function (d) {
      /* `refs` 让"这道门通向哪个模块"进总账 —— 于是 `to` 指向一个不存在的模块
         会被 `Registry.audit()` 抓到，而不是等玩家点一下发现没反应。
         `board` 那一档没有 `to`，`refs` 就是空的（它不通向任何地方）。 */
      return {
        id: d.id,
        refs: d.to ? [{ field: 'to', value: d.to, family: 'ledgerSystem' }] : []
      };
    });
  }
});

export { Station };
