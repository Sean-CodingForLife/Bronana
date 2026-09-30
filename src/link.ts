/* =========================================================
   link.ts — **核心素材**（跨模块代币）
   ---------------------------------------------------------
   v3 §5.1：
     "**核心素材（跨模块代币）**：产出在模块 A，消费在模块 B。
      **不可兑换，不可替代**，只能通过指定路径获得。
      **有概率产出，不是必然掉落**。"
   v3 §5.2：战斗 → 经营 → 养成 → 战斗。
   v3 §5.4-错误2：
     "把核心素材当货币处理。核心素材一旦可兑换或流通，循环就散了。"

   ## 所以它为什么**不在 `ledger.ts` 的账本里**

   账本里的钱有一条共性：**可以换**（`Ledger.EXCHANGE` 就是干这个的）。
   核心素材恰好相反 —— 它**不可兑换、不可替代**，产出地与消费地**必须分开**。
   把它放进账本，就等于给了它一个可换的身份，循环当场就散了。

   它是**钥匙**，不是钱。

   ## 两条约束（v3 点名的风险与建议）

   §9-风险1："核心素材概率产出可能变成挫败源：概率太低反复刷，
             太高则依赖形同虚设。"
   §9-建议1："核心素材保底：概率掉落 + **保底计数** + 多路径获取。"
   §7-11：    "核心素材是否有保底机制？概率是否会导致反复刷取？
              → 需有保底或多路径。"

   于是每一个核心素材**必须**同时有两个数：
     · `chance` —— 每次尝试的掉率（有多"惊喜"）
     · `pity`   —— 连续 `pity` 次没出就**必出**（有多"不气人"）
   以及至少一条**多路径**（`paths`）：不靠反复刷同一个 Boss 也能拿到。
   `audit` 三条都查 —— 少了任何一条，它就是一个纯随机门，
   而纯随机门正是"自由流动"退化成"被迫刷取"的地方（v3 §九的总体判断）。
   ========================================================= */
import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';
import { Ledger } from './ledger.ts';

var Link = {} as LinkApi;

/**
 * 三个核心素材。**一条边一个**，而且是**单向**的：
 * `producedBy` 与 `consumedBy` 必须不同 —— 这一条是"循环"的定义本身。
 *
 * ⚠ `chance` 是**每次尝试**的掉率，不是"打了就有"。
 * 它必须配合 `pity`（保底计数）一起用 —— 见文件头。
 */
var LINKS: LinkDef[] = [
  {
    id: 'core', name: '核心材料',
    producedBy: 'combat', consumedBy: 'manage',
    source: '关底 Boss 掉落',
    chance: 0.35, pity: 3,
    /* 多路径：不靠反复刷同一个 Boss 也能拿到 */
    paths: ['关底 Boss（概率）', '保底：连续 3 次没出必出', '高波次的精英怪（低概率）'],
    note: '战斗打出来的东西，**只能**花在经营的关键建筑上',
    why: '它是链条的第一环，也是"打 Boss 值得"的那一笔。' +
      '它**不去养成** —— 那样一个来源两个去向，等于没锁路径'
  },
  {
    id: 'relic', name: '遗物',
    producedBy: 'manage', consumedBy: 'grow',
    source: '经营的关键建筑产出',
    chance: 0.6, pity: 2,
    paths: ['经营的关键建筑（概率）', '保底：连续 2 次没出必出', '经营的满级设施（低概率）'],
    note: '经营盖起关键建筑之后产出的东西，**只能**花在养成的关键能力上',
    why: '它是链条的第二环，也是"经营真的在产出"的证明：' +
      '在此之前经营只产出"能力/容量"，于是它在循环里只是个吸收端'
  },
  {
    id: 'sigil', name: '徽记',
    producedBy: 'grow', consumedBy: 'combat',
    source: '养成的关键能力产出',
    chance: 0.5, pity: 2,
    paths: ['养成的关键能力（概率）', '保底：连续 2 次没出必出', 'NPC 关系达到某个阶段'],
    note: '养成走通一条关键能力线之后产出的东西，**回到战斗里花**',
    why: '它是链条的第三环，闭合了循环。没有它，"养成 → 战斗"那条边' +
      '只剩"开局折一次"，成不了一条回路'
  }
];

Link.LIST = LINKS;
Link.BY_ID = (function () {
  var m: Record<string, LinkDef> = Object.create(null);
  for (var i = 0; i < LINKS.length; i++) m[LINKS[i].id] = LINKS[i];
  return m;
})();

/* =========================================================
   保底计数（v3 §9-建议1 的核心）
   ---------------------------------------------------------
   状态由调用方持有（它属于**这一局**的会话状态，不归本模块）——
   形态是一张 `{ [linkId]: 连续没出的次数 }`。
   ========================================================= */

/** 新的保底状态 */
Link.empty = function () { return { misses: {} as Record<string, number> }; };

/**
 * **声明了、但还没接入的核心素材**（已知欠账）。
 *
 * 范式与 `RUN_START` / `ONE_SHOT` / `VERSION_LOCKED` 一致：
 * **允许有欠账，不允许悄悄有欠账。**
 *
 * 门 `drift` 的判据 G 会去 `src/` 里找每个核心素材的**产出点**与**消费点**；
 * 找不到的必须登记在这里并写明理由，否则门当场报红。
 *
 * ⚠ `relic` 已经接上了（M4，2026-09）：**经营的关键建筑**（花 `core` 盖起来的那座）
 * 产出它，图纸「神话图纸」消费它 —— 会话层就位之后（M1）才落得下去。
 * 剩下 `sigil` 这一笔，理由见下面那一条。
 */
Link.PENDING = [
  /* **空**：三条核心素材现在都有产出点与消费点了（M4，2026-09）。
     `core` 战斗→经营 · `relic` 经营→养成 · `sigil` 养成→战斗。
     ⚠ 这个数组**留着**：它是"允许有欠账，不允许悄悄有欠账"的落点 ——
     下一次有素材接不上时，照样登记在这里，而不是悄悄少接一条边。 */
];

/**
 * 掷一次。
 * @param rnd 调用方给的随机源（**必填**：不给就退化成 Math.random，回放会分叉）
 * @returns `{ got, byPity, misses, until }`
 *   `until` = 还差几次必出（给界面用："再 2 次必出" —— 保底要**看得见**）
 */
Link.roll = function (id, state, rnd) {
  var l = Link.BY_ID[id];
  if (!l) return { got: false, byPity: false, misses: 0, until: 0, reason: '没有这个核心素材' };
  if (!state) state = Link.empty();
  if (!state.misses) state.misses = {};
  if (typeof rnd !== 'function') return { got: false, byPity: false, misses: 0, until: 0, reason: '没有随机源' };
  var miss = Math.max(0, Math.floor(Number(state.misses[id]) || 0));
  /* 保底先生效：连 `pity` 次没出，这一次**必出**（不给随机源任何机会） */
  if (miss + 1 >= l.pity) {
    state.misses[id] = 0;
    return { got: true, byPity: true, misses: 0, until: l.pity };
  }
  if (rnd() < l.chance) {
    state.misses[id] = 0;
    return { got: true, byPity: false, misses: 0, until: l.pity };
  }
  state.misses[id] = miss + 1;
  return {
    got: false, byPity: false,
    misses: state.misses[id],
    until: Math.max(0, l.pity - state.misses[id])
  };
};

/** 还差几次必出（界面读它；`0` = 下一次就是保底） */
Link.untilPity = function (id, state) {
  var l = Link.BY_ID[id];
  if (!l) return 0;
  var miss = (state && state.misses && state.misses[id]) || 0;
  return Math.max(0, l.pity - Math.max(0, miss));
};

/** 某个模块产出哪几个核心素材 */
Link.producedBy = function (sys) {
  return LINKS.filter(function (l) { return l.producedBy === sys; });
};
/** 某个模块消费哪几个核心素材 */
Link.consumedBy = function (sys) {
  return LINKS.filter(function (l) { return l.consumedBy === sys; });
};
/** 链条有没有闭合：每个模块**既产一个、又消费一个** */
Link.closed = function () {
  var out: Array<{ sys: string; produce: number; consume: number }> = [];
  for (var s in Ledger.SYSTEMS) {
    if (!Object.prototype.hasOwnProperty.call(Ledger.SYSTEMS, s)) continue;
    out.push({ sys: s, produce: Link.producedBy(s).length, consume: Link.consumedBy(s).length });
  }
  return out;
};

/* =========================================================
   定义期自检
   ---------------------------------------------------------
   每一条对着一个 v3 点名的**真实故障**：
     · `producedBy === consumedBy` → 它在自己模块里花，那就不叫跨模块，链条不存在
     · 某个模块**不产**核心素材 → 链条断一环（那个模块的产出流不出去）
     · 某个模块**不消费**核心素材 → 它没有进料，"结构性依赖"不存在
     · 没有 `chance` 或 `pity` → 纯随机门（v3 §9-风险1：挫败源）
     · `pity` 太大 → 保底形同虚设（§9-风险1 的另一半）
     · 没有多路径 → 只能反复刷同一个点（§7-11）
     · **进了账本** → v3 §5.4-错误2：当货币处理，循环会散
   ========================================================= */
var MIN_CHANCE = 0.15;      // 低于它就"太抠"，反复刷的挫败感盖过惊喜
var MAX_PITY = 5;           // 高于它就"保底形同虚设"

Link.audit = function () {
  var problems: string[] = [];
  var seen: Record<string, boolean> = Object.create(null);
  var i, j;

  for (i = 0; i < LINKS.length; i++) {
    var l = LINKS[i];
    if (!l.id) { problems.push('第 ' + i + ' 个核心素材没有 id'); continue; }
    if (seen[l.id]) problems.push('核心素材 id 重复：' + l.id);
    seen[l.id] = true;
    if (!l.name) problems.push(l.id + ' 没有名字');
    if (!l.note) problems.push(l.id + ' 没有说明');
    if (!l.why) problems.push(l.id + ' 没有 why');
    if (!l.source) problems.push(l.id + ' 没有写它从哪来（`source`）');

    if (!Ledger.SYSTEMS[l.producedBy]) problems.push(l.id + ' 的产出地不是已登记的模块：' + l.producedBy);
    if (!Ledger.SYSTEMS[l.consumedBy]) problems.push(l.id + ' 的消费地不是已登记的模块：' + l.consumedBy);
    if (l.producedBy === l.consumedBy) {
      problems.push(l.id + ' 的产出地与消费地**是同一个模块** —— ' +
        '那就是"在自己模块里花"，链条根本不存在（v3 §5.2：产出地和消费地必须分开）');
    }

    /* ⚠ 这一条是 v3 §5.4-错误2 的守卫：核心素材**不许进账本** */
    if (Ledger.currency(l.id)) {
      problems.push('核心素材 ' + l.id + ' **进了账本**（' + Ledger.currency(l.id).ledger + '）—— ' +
        '账本里的钱可以兑换，而核心素材一旦可兑换，循环就散了（v3 §5.4-错误2）');
    }

    /* 概率 + 保底：v3 §9-建议1 的两半，缺一不可 */
    if (!(l.chance > 0 && l.chance < 1)) {
      problems.push(l.id + ' 的 `chance` 必须在 (0,1) —— 必掉就不是"概率产出"（v3 §5.1）');
    } else if (l.chance < MIN_CHANCE) {
      problems.push(l.id + ' 的掉率 ' + l.chance + ' 太抠（低于 ' + MIN_CHANCE + '）—— ' +
        'v3 §9-风险1：概率太低会变成反复刷的挫败源');
    }
    if (!(l.pity >= 1)) {
      problems.push(l.id + ' 没有保底计数（`pity`）—— v3 §7-11 要求"需有保底或多路径"');
    } else if (l.pity > MAX_PITY) {
      problems.push(l.id + ' 的保底 ' + l.pity + ' 次太长（超过 ' + MAX_PITY + '）—— ' +
        'v3 §9-风险1：保底形同虚设');
    }
    if (!l.paths || l.paths.length < 2) {
      problems.push(l.id + ' 只有一条获取路径 —— v3 §7-11 要求"需有保底或**多路径**"');
    }
  }

  /* **链条必须闭合**：每个模块既产一个、又消费一个（v3 §5.2） */
  var rows = Link.closed();
  for (i = 0; i < rows.length; i++) {
    var r = rows[i];
    var nm = Ledger.SYSTEMS[r.sys] ? Ledger.SYSTEMS[r.sys].name : r.sys;
    if (r.produce !== 1) {
      problems.push('模块「' + nm + '」产出 ' + r.produce + ' 个核心素材（应当**恰好 1 个**）—— ' +
        '少了链条断一环，多了就说不清它该给谁');
    }
    if (r.consume !== 1) {
      problems.push('模块「' + nm + '」消费 ' + r.consume + ' 个核心素材（应当**恰好 1 个**）—— ' +
        '不消费它就没有进料，"结构性依赖"不存在');
    }
  }
  /* 而且每对模块之间只能有一条边（两条就是"两个去向"，等于没锁） */
  for (i = 0; i < LINKS.length; i++) {
    for (j = i + 1; j < LINKS.length; j++) {
      if (LINKS[i].producedBy === LINKS[j].producedBy) {
        problems.push('模块「' + LINKS[i].producedBy + '」产出了两个核心素材（' +
          LINKS[i].id + ' / ' + LINKS[j].id + '）—— 它的产出该给谁就不确定了');
      }
      if (LINKS[i].consumedBy === LINKS[j].consumedBy) {
        problems.push('模块「' + LINKS[i].consumedBy + '」消费两个核心素材（' +
          LINKS[i].id + ' / ' + LINKS[j].id + '）—— 那就有两条进料，依赖不唯一');
      }
    }
  }

  return {
    ok: problems.length === 0, problems: problems,
    counts: { links: LINKS.length, closed: rows.every(function (r) { return r.produce === 1 && r.consume === 1; }) }
  };
};

SelfCheck.register('Link', Link.audit);

Registry.family('coreLink', {
  note: '核心素材（跨模块代币）：产在 A、**只能在 B 花**，不可兑换 —— 链条靠它成立',
  owner: 'link.ts',
  entries: function () {
    return LINKS.map(function (l) {
      return {
        id: l.id,
        refs: [
          { field: 'producedBy', value: l.producedBy, family: 'ledgerSystem' },
          { field: 'consumedBy', value: l.consumedBy, family: 'ledgerSystem' }
        ]
      };
    });
  }
});

export { Link };
