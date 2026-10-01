/* =========================================================
   terms.ts — **用词总账**（R53-B）
   ---------------------------------------------------------
   改造前的事实（实测，2026-10-01）：

     · 四笔钱的**权威名**早就存在，而且各只有一处（`eco_*.ts` 的 `id` / `name`）：
         `scrap` = 废料 · `capacity` = 产能 · `growth` = 成长点 · `material` = 材料
     · 而**异形词比权威名还多**：成长点 43 处 vs 孢子 / 合金 165 处；
       材料 381 处 vs 建材 26 处
     · 后果不是"不好看"，是**界面在说谎**：同一屏页头写「材料」、按钮写「废料不够」，
       而扣费走的是 `material()`；天赋按钮拿 `=== '天赋点不够'` 去比
       `'成长点不够（需要 N）'`，那个分支**永不成立**

   ## 这个模块只做一件事：**声明"权威名是什么、它在哪"，不复制那些名字**

   ⚠ **它刻意不读别的模块的数据表。** 理由与家法第三节那条一致，而且更硬：
     `terms.ts` 坐在 L1，而 `eco_*.ts`（四本账）也在 L1 —— 启动期谁先加载不确定，
     读它们会得到空表（`trade.ts` 的加载期自检就是这么误报过 12 档报价的）。
     所以这里记的是**出处**（哪个文件、哪张表、哪个 id），
     而"那个出处真的有这个名字"由**门**（`tools/name-audit.mjs`）在**全部模块加载之后**去核。

   ## 四步齐全（家法第三节）
     1. 声明表 —— `CURRENCY` / `STAT` / `RETIRED` / `ALIAS` / `SOURCE`
     2. `BY_ID` —— 每张表一份无原型表
     3. 启动期自检 —— `Terms.audit()` + `SelfCheck.register`（**只查表自身**）
     4. 注册进总账 —— `Registry.family('term')` / `termRetired` / `termAlias`
   ========================================================= */

import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';

var Terms = {} as TermsApi;

/* =========================================================
   1. 权威名（**唯一**的一张）
   ---------------------------------------------------------
   `name` 是**玩家可见的那个词**，`id` 是代码里的键，`owner` 是**这个名字的出处**
   （门会去那里核对"表里真有这一条，且 name 就是它"）。
   ========================================================= */
var CURRENCY: TermCurrencyDef[] = [
  {
    id: 'scrap', name: '废料', owner: 'ledger',
    scope: '这一局的钱，结算清零',
    note: '战斗代币。买武器 / 道具 / 刷新货架'
  },
  {
    id: 'capacity', name: '产能', owner: 'ledger',
    scope: '经营自己运转出来的钱',
    note: '经营代币。盖设施 / 买目录'
  },
  {
    id: 'growth', name: '成长点', owner: 'ledger',
    scope: '带出局，跨局累积',
    note: '养成代币。天赋 / 洗点 / 图纸解锁。⚠ 别名「孢子」只许出现在剧情里'
  },
  {
    id: 'material', name: '材料', owner: 'ledger',
    scope: '带出局，行动成本',
    note: '全局货币。据点 / 制造 / 训练都花它'
  },
  {
    id: 'core', name: '核心材料', owner: 'coreLink',
    scope: 'meta-rare 那一档',
    note: '**只有关底 Boss 掉**。据点 3 级与图纸的共同门槛'
  },
  {
    id: 'relic', name: '遗物', owner: 'coreLink',
    scope: '核心素材 A',
    note: '经营 → 养成。据点的关键建筑产出'
  },
  {
    id: 'sigil', name: '徽记', owner: 'coreLink',
    scope: '核心素材 B',
    note: '养成 → 战斗。走通一条能力线产出，回到局内花'
  }
];

/* =========================================================
   1b. 属性名（与 `stats.ts` 的键对齐）
   ---------------------------------------------------------
   ⚠ 属性的**显示名**由 `stats.ts` 的界面映射负责（`Stats.KEYS` 的 20 个键）——
     这里只登记"中文名该怎么写"，供门与评审对照，**不重复它的值域**。
   ========================================================= */
var STAT: TermStatDef[] = [
  { id: 'maxHp', name: '生命上限' },
  { id: 'hpRegen', name: '生命再生' },
  { id: 'lifesteal', name: '吸血' },
  { id: 'damage', name: '伤害' },
  { id: 'meleeDmg', name: '近战伤害' },
  { id: 'rangedDmg', name: '远程伤害' },
  { id: 'elementalDmg', name: '元素伤害' },
  { id: 'attackSpeed', name: '攻击速度' },
  { id: 'critChance', name: '暴击率' },
  { id: 'armor', name: '护甲' },
  { id: 'dodge', name: '闪避' },
  { id: 'speed', name: '移动速度' },
  { id: 'luck', name: '幸运' },
  { id: 'harvesting', name: '收获' },
  { id: 'pickupRange', name: '拾取范围' },
  { id: 'range', name: '射程' },
  { id: 'engineering', name: '工程' },
  { id: 'knockbackBonus', name: '击退' },
  { id: 'consumable', name: '消耗品效果' },
  { id: 'regen', name: '回复' }
];

/* =========================================================
   2. 弃用词（说得清"为什么弃用"才算登记）
   ---------------------------------------------------------
   `allowFiles` 是**逐文件的豁免**（不是逐行）—— 只在"这个文件必须提到它"时用，
   例如改名的迁移代码、或记录历史的文档。
   ⚠ **注释豁免**由门处理：门只看**面向玩家的字符串**，不看注释
     （因为"改造前叫建材"这类历史叙述改了就是篡改历史，见账本 R53 执行边界 2）。
   ========================================================= */
var RETIRED: TermRetiredDef[] = [
  {
    word: '建材', instead: '材料', why: 'M3 之前"每波到账的局内货币"，已并入材料',
    /* `terms.ts` 自己必须**提到**这些词（它就是那张声明表）——
       与"某个文件必须提到它"是同一类豁免，写在这里而不是让门去特判文件名 */
    allowFiles: ['terms.ts']
  },
  {
    word: '合金', instead: '成长点', why: '与「孢子」是同一笔钱的两个名字，R43 已合并',
    allowFiles: ['terms.ts']
  },
  {
    word: '天赋点', instead: '成长点', why: '天赋只是**花**它的地方之一，不是它的名字',
    allowFiles: ['terms.ts']
  },
  {
    word: '孢子', instead: '成长点', why: '**世界观别名**，只许出现在剧情 / 怪物 / 场景命名里，不能当货币名',
    allowFiles: ['terms.ts'],
    /* ⚠ **合法的复合专有名词**：这两个是场景 / 怪物的名字，里面的"孢子"不是货币名。
       实测全仓只有这两个（其余 `孢子/分`、`多少孢子` 都是货币名用法 → 该红）。 */
    allowWords: ['孢子神龛', '孢子牧者']
  },
  {
    word: '金币', instead: '废料', why: '更早的名字，已在改名那一轮清掉',
    allowFiles: ['terms.ts']
  },
  {
    word: '旧币', instead: '废料', why: '更早的名字',
    /* ⚠ 例外：`trade.ts` 有一条**道具**就叫「一串旧币」—— 那是道具名不是货币名 */
    allowFiles: ['terms.ts', 'trade.ts'],
    allowWords: ['一串旧币']
  },
  {
    word: '钟塔', instead: '钟楼', why: '设施名是「钟楼」；`story.ts` 的台词里曾写成钟塔',
    allowFiles: ['terms.ts']
  }
];

/* =========================================================
   3. 别名（世界观说法 → 权威名）
   ---------------------------------------------------------
   别名**不是错**，是"同一个东西在世界观里的叫法"。允许，但**按域限制**：
   `domain` 说清它能出现在哪，门据此判"有没有跑到货币名该在的地方"。
   ========================================================= */
var ALIAS: TermAliasDef[] = [
  {
    word: '孢子', canonical: '成长点', domain: '剧情 / 怪物 / 场景命名',
    why: '世界观里成长点是从菌类身上长出来的 —— 台词与图鉴这么写是**对的**'
  },
  {
    word: '菌床', canonical: '(设施名)', domain: '场景与设施命名',
    why: '离线产出那件设施的名字，不是货币名'
  }
];

/* =========================================================
   4. 玩家可见名字的**来源清单**（名字住在哪个文件 → 谁读它）
   ---------------------------------------------------------
   这一张的用途与 `Registry` 的跨表引用同源：**"这个名字是从哪来的"要能追**。
   改造前的教训是"同一个余额在四个界面上有四个名字"，而没有任何一处能回答
   "谁的才是对的"。

   ⚠ **名字实际住在 `eco_*.ts`，但可核对的那一份在 `ledger.ts` 的 `Ledger.all()`**
     （实测：`EcoCombat` 这类**根本没有导出**，`Ledger.all()[i].currencies` 才是
     带 `id` / `name` 的那一份）。而核心素材三笔在 `Economy.LINKS` /
     `Registry.family('coreLink')`。
     所以 `owner` 写的是**路由名**（`ledger` / `coreLink` / `stats`），
     门按路由取表核对（见 `tools/name-audit.mjs` 的判据 C）。
   ========================================================= */
var SOURCE: TermSourceDef[] = [
  {
    owner: 'ledger', fields: ['id', 'name'],
    readsBy: ['eco_combat.ts', 'eco_manage.ts', 'eco_grow.ts', 'eco_global.ts', 'economy.ts', 'ui.ts']
  },
  {
    owner: 'coreLink', fields: ['id', 'name'],
    readsBy: ['link.ts', 'economy.ts', 'ui.ts', 'stronghold.ts', 'forge.ts']
  },
  { owner: 'stats', fields: ['KEYS'], readsBy: ['stats.ts', 'ui.ts', 'levelup.ts', 'affixes.ts'] }
];

/* ---------------- BY_ID（无原型表，理由与 data_chars.ts 那张一样）---------------- */
Terms.CURRENCY = CURRENCY;
Terms.STAT = STAT;
Terms.RETIRED = RETIRED;
Terms.ALIAS = ALIAS;
Terms.SOURCE = SOURCE;

/**
 * **别名域**：允许出现世界观别名的文件（逐文件的显式声明，不是靠门去猜）。
 *
 * 判据是"这个文件里的文字**是谁在说**"：
 *   · `story.ts` 是**剧情台词** —— 那里角色说「孢子」是**对的**（世界观说法）
 *   · 而同一个文件里的**结构性字符串**（`role:` 那种标签）仍然要用权威名 ——
 *     所以本表的豁免**只对 `ALIAS` 里列的词生效**，`RETIRED` 里非别名的词
 *     （建材 / 合金 / 天赋点 / 金币 / 旧币 / 钟塔）在这个文件里**照样报红**。
 */
var ALIAS_DOMAIN: TermAliasDomainDef[] = [
  {
    file: 'story.ts', words: ['孢子'],
    why: '剧情台词 —— 角色说「孢子」是世界观说法；而 `role` 这类**结构标签**仍用权威名'
  }
];
Terms.ALIAS_DOMAIN = ALIAS_DOMAIN;

Terms.CURRENCY_BY_ID = (function () {
  var m: Record<string, TermCurrencyDef> = Object.create(null);
  for (var i = 0; i < CURRENCY.length; i++) m[CURRENCY[i].id] = CURRENCY[i];
  return m;
})();
Terms.RETIRED_BY_WORD = (function () {
  var m: Record<string, TermRetiredDef> = Object.create(null);
  for (var i = 0; i < RETIRED.length; i++) m[RETIRED[i].word] = RETIRED[i];
  return m;
})();

/** 这笔钱的权威名（认不出的回显 id：坏数据要看得见，而不是显示成"未知"） */
Terms.currencyName = function (id) {
  var d = Terms.CURRENCY_BY_ID[String(id || '')];
  return d ? d.name : String(id || '');
};
/** 这个词是不是弃用词（是就返回它的登记，否则 null） */
Terms.retiredOf = function (word) { return Terms.RETIRED_BY_WORD[String(word || '')] || null; };
/** 这个别名指向哪个权威名（不是别名就返回 null） */
Terms.canonicalOf = function (word) {
  for (var i = 0; i < ALIAS.length; i++) if (ALIAS[i].word === word) return ALIAS[i].canonical;
  return null;
};

/* =========================================================
   5. 启动期自检（**只查表自身**）
   ---------------------------------------------------------
   ⚠ 它**不读别的模块**：`eco_*.ts` 与它同层，启动期谁先加载不确定 ——
     读了会得到空表并把好数据误报成"拼错了"（`trade.ts` 栽过这一次）。
     "出处真的有这个名字"由门在**全部模块加载之后**核（见 `tools/name-audit.mjs`）。
   ========================================================= */
Terms.audit = function () {
  var problems: string[] = [];
  var i, seen: Record<string, boolean>;

  if (!CURRENCY.length) problems.push('一笔钱都没登记（用词总账是空的）');
  seen = Object.create(null);
  for (i = 0; i < CURRENCY.length; i++) {
    var c = CURRENCY[i];
    if (!c.id) { problems.push('第 ' + i + ' 笔钱没有 id'); continue; }
    if (seen[c.id]) problems.push('货币 id 重复：' + c.id);
    seen[c.id] = true;
    if (!c.name) problems.push(c.id + ' 没有权威名（界面上会回显英文 id）');
    if (!c.owner) problems.push(c.id + ' 没写出处（门没法核对它在哪）');
    if (!c.note) problems.push(c.id + ' 没有说明（玩家 / 评审看不懂它是什么）');
    if (!c.scope) problems.push(c.id + ' 没写作用域（这一局的钱还是带出局的钱）');
  }

  /* **权威名之间不许撞**：两笔钱叫同一个名字 = 界面上分不出谁是谁 */
  var nameSeen: Record<string, string> = Object.create(null);
  for (i = 0; i < CURRENCY.length; i++) {
    var c2 = CURRENCY[i];
    if (!c2.name) continue;
    if (nameSeen[c2.name]) problems.push('两笔钱叫同一个名字：' + c2.name + '（' + nameSeen[c2.name] + ' / ' + c2.id + '）');
    nameSeen[c2.name] = c2.id;
  }

  /* **属性名不许撞**，而且 id 必须是 `stats.ts` 的真键 */
  var statSeen: Record<string, string> = Object.create(null);
  for (i = 0; i < STAT.length; i++) {
    var s = STAT[i];
    if (!s.id) { problems.push('第 ' + i + ' 条属性没有 id'); continue; }
    if (statSeen[s.id]) problems.push('属性 id 重复：' + s.id);
    statSeen[s.id] = s.id;
    if (!s.name) problems.push('属性 ' + s.id + ' 没有中文名');
  }
  var statNames: Record<string, string> = Object.create(null);
  for (i = 0; i < STAT.length; i++) {
    if (!STAT[i].name) continue;
    if (statNames[STAT[i].name]) problems.push('两条属性叫同一个名字：' + STAT[i].name);
    statNames[STAT[i].name] = STAT[i].id;
  }
  if (STAT.length < 10) problems.push('属性少于 10 条：多半是漏登记了（`stats.ts` 的 KEYS 有 20 个）');

  /* 弃用词：每条都要说清"换成什么"与"为什么" */
  seen = Object.create(null);
  for (i = 0; i < RETIRED.length; i++) {
    var r = RETIRED[i];
    if (!r.word) { problems.push('第 ' + i + ' 条弃用词没有词'); continue; }
    if (seen[r.word]) problems.push('弃用词重复：' + r.word);
    seen[r.word] = true;
    if (!r.instead) problems.push(r.word + ' 没写"该换成什么"（下一个 AGENT 会不知道该用什么）');
    if (!r.why) problems.push(r.word + ' 没写"为什么弃用"');
    if (!(r.allowFiles instanceof Array)) problems.push(r.word + ' 的 allowFiles 不是数组');
    /* **弃用词不许与权威名同形**：那会让门自己判自己 */
    if (nameSeen[r.word]) problems.push(r.word + ' 既是弃用词又是权威名（门会自相矛盾）');
  }

  /* 别名：必须指向一个**存在的**权威名（或明确标注它不是货币，如 `(设施名)`） */
  seen = Object.create(null);
  for (i = 0; i < ALIAS.length; i++) {
    var a = ALIAS[i];
    if (!a.word) { problems.push('第 ' + i + ' 条别名没有词'); continue; }
    if (seen[a.word]) problems.push('别名重复：' + a.word);
    seen[a.word] = true;
    if (!a.domain) problems.push('别名 ' + a.word + ' 没写"允许出现在哪些域"');
    if (!a.why) problems.push('别名 ' + a.word + ' 没写理由');
    var ok = false;
    for (var k = 0; k < CURRENCY.length; k++) if (CURRENCY[k].name === a.canonical) ok = true;
    if (/^\(.*\)$/.test(String(a.canonical || ''))) ok = true;      // `(设施名)` 这类显式"不是货币"
    if (!ok) problems.push('别名 ' + a.word + ' 指向的权威名不存在：' + a.canonical);
  }

  /* 来源清单：每个出处都要有字段与读点，而且**不许与权威名的出处打架** */
  var ownerSeen: Record<string, boolean> = Object.create(null);
  for (i = 0; i < SOURCE.length; i++) {
    var src = SOURCE[i];
    if (!src.owner) { problems.push('第 ' + i + ' 条来源没有 owner'); continue; }
    if (ownerSeen[src.owner]) problems.push('来源重复登记：' + src.owner);
    ownerSeen[src.owner] = true;
    if (!src.fields || !src.fields.length) problems.push(src.owner + ' 没写读了哪些字段');
    if (!src.readsBy || !src.readsBy.length) problems.push(src.owner + ' 没写谁读它');
  }
  for (i = 0; i < CURRENCY.length; i++) {
    var own = CURRENCY[i].owner;
    if (own && !ownerSeen[own]) {
      problems.push('货币 ' + CURRENCY[i].id + ' 的出处 ' + own + ' 不在来源清单里（追不到名字是从哪来的）');
    }
  }

  return {
    ok: problems.length === 0, problems: problems,
    counts: { currencies: CURRENCY.length, stats: STAT.length, retired: RETIRED.length, aliases: ALIAS.length }
  };
};

var verdict = Terms.audit();
if (!verdict.ok) throw new Error('terms.ts 用词总账自检失败：\n' + verdict.problems.join('\n'));
SelfCheck.register('Terms', Terms.audit);

/* =========================================================
   6. 注册进扩展点总账
   ========================================================= */
Registry.family('term', {
  note: '货币的**权威名**（一个概念只有一个名字；玩家的界面与文案都该用它）',
  owner: 'terms.ts',
  entries: function () { return CURRENCY.map(function (c) { return { id: c.id, refs: [] }; }); }
});
Registry.family('termRetired', {
  note: '弃用词（写进玩家可见字符串即红）—— 每个都要说清"换成什么"与"为什么"',
  owner: 'terms.ts',
  values: function () { return RETIRED.map(function (r) { return r.word; }); }
});
Registry.family('termAlias', {
  note: '世界观别名（允许，但只在剧情 / 命名域里；`domain` 说清能出现在哪）',
  owner: 'terms.ts',
  values: function () { return ALIAS.map(function (a) { return a.word; }); }
});

export { Terms };
