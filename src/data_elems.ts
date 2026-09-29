/* =========================================================
   data_elems.ts — 元素表（**唯一**的一张）
   ---------------------------------------------------------
   为什么值得单独一张表：武器表里 `element` 这一列有四个值
   （fire / shock / magic / laser），而它们的**名字与含义**在改造前
   散在三处、谁也不认识谁：
     · `game.ts`  `if (opt.element === 'fire') applyBurn(…)`
                  `if (opt.element === 'shock') shockChain(…)`
     · `stats.ts` `if (weapon.element) mul += s.elementalDmg * 0.12`
     · `ui.ts`    `({ fire: '火焰', shock: '电击', magic: '奥术', laser: '能量' }[d.element])`
     · `synergy.ts` 按 element 分组（同元素是一条联动轴）
   于是"魔法"与"能量"在玩法上其实是**同一个东西**（都只吃元素伤害加成、没有
   附带效果），而界面给它们起了两个名字 —— 这不是设计，是四份字面量各自演化的结果。
   更贵的是那一类**静默**故障：把某把武器的 `element` 写成 `'fir'`，
   界面会显示 `元素：fir`，伤害里不再吃元素加成，也永远不会触发灼烧 ——
   三处都不报错，而三处本来都"知道"元素是什么。

   现在这里做两件事：
     1. **声明**：元素的名字、顺序、以及它有没有附带效果（`effect`）。
        界面拿 `name`，模拟层拿 `effect` —— 谁都不再写第二份字面量。
     2. **登记**：`Registry.family('element')`，于是武器表里写一个表外的
        元素名会被启动期自检当场抓住（与 `weaponKind` / `itemIcon` 同一个套路）。

   纪律：`effect` 是**机制**的名字（`burn` 灼烧 / `chain` 电弧），
   不是属性名。加一种带新机制的武器元素，要同时在这里加一行、
   并在 `game.ts` 的 `applyElement` 里认领那个 effect（自检会要求"声明的键有人读"）。
   ========================================================= */
import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';

var Elems = {} as ElemsApi;

/**
 * 元素表。`uid` 是**跨模块引用用的键**（`weapon:元素`），
 * `id` 是武器表里写的那个字符串。两者分开是因为现实里会有两个元素同名不同类的可能，
 * 而现在没有 —— 所以它们是同一个值，但读点只认 `uid`（一处改名不用改全部读点）。
 */
Elems.LIST = [
  {
    id: 'fire', uid: 'fire', name: '火焰', note: '命中后持续灼烧',
    /** 'burn' = `game.ts` 的 applyBurn；'' = 只有元素伤害加成，没有附带效果 */
    effect: 'burn'
  },
  {
    id: 'shock', uid: 'shock', name: '电击', note: '命中后电弧连锁到附近敌人',
    effect: 'chain'
  },
  {
    id: 'magic', uid: 'magic', name: '奥术', note: '纯元素伤害，没有附带效果',
    effect: ''
  },
  {
    id: 'laser', uid: 'laser', name: '能量', note: '纯元素伤害，没有附带效果',
    effect: ''
  }
];

Elems.BY_ID = (function () {
  var m: Record<string, ElementDef> = Object.create(null);
  for (var i = 0; i < Elems.LIST.length; i++) m[Elems.LIST[i].id] = Elems.LIST[i];
  return m;
})();

/** id → 定义（认不出的返回 null；**读点一律走它**，不要自己建映射） */
Elems.get = function (id) { return id ? (Elems.BY_ID[id] || null) : null; };

/** id → 界面名（认不出的回显原值：坏数据要看得见，而不是显示成"未知"） */
Elems.nameOf = function (id) { var d = Elems.get(id); return d ? d.name : String(id || ''); };

/** id → 附带效果的机制名（'' = 没有效果；认不出的也返回 ''，于是只是"没有附带效果"） */
Elems.effectOf = function (id) { var d = Elems.get(id); return d ? d.effect : ''; };

/* =========================================================
 * 定义期自检：对着两个真实的静默故障
 *   · 某个元素声明了 `effect` 却没人认领 → 界面上写着"持续灼烧"而实际上没有
 *     （这一条与 `data_items.ts` 的 SPECIALS 是同一个坑，用同一套判据）
 *   · 某个元素 id 重复 → `BY_ID` 里后一条会静默盖掉前一条
 *   · id 与 uid 不一致 → 跨模块引用会指到别的东西上
 * ========================================================= */
Elems.audit = function () {
  var problems: string[] = [];
  var seen: Record<string, boolean> = Object.create(null);
  var seenUid: Record<string, boolean> = Object.create(null);
  var effects: Record<string, string> = Object.create(null);
  for (var i = 0; i < Elems.LIST.length; i++) {
    var d = Elems.LIST[i];
    if (!d.id) problems.push('第 ' + i + ' 条元素没有 id');
    if (seen[d.id]) problems.push('元素 id 重复：' + d.id);
    seen[d.id] = true;
    if (d.uid !== d.id) problems.push(d.id + ' 的 uid 与 id 不一致（跨模块引用会指错）：' + d.uid);
    if (seenUid[d.uid]) problems.push('元素 uid 重复：' + d.uid);
    seenUid[d.uid] = true;
    if (!d.name) problems.push(d.id + ' 没有界面名（界面会回显英文 id）');
    if (!d.note) problems.push(d.id + ' 没有说明（界面与图鉴要显示它）');
    if (typeof d.effect !== 'string') problems.push(d.id + ' 的 effect 不是字符串');
    if (d.effect) {
      if (effects[d.effect]) problems.push('同一个机制被两个元素认领：' + d.effect + '（' + effects[d.effect] + ' / ' + d.id + '）');
      effects[d.effect] = d.id;
    }
  }
  if (Elems.LIST.length < 2) problems.push('元素少于 2 种：同元素联动轴立不住');
  return {
    ok: problems.length === 0, problems: problems,
    counts: { elements: Elems.LIST.length, effects: Object.keys(effects).length }
  };
};

var verdict = Elems.audit();
if (!verdict.ok) throw new Error('data_elems.ts 元素表自检失败：\n' + verdict.problems.join('\n'));
SelfCheck.register('Elems', Elems.audit);

/* 登记到扩展点总账：武器表的 `element` 必须落在这一张表里。
   写错一个字母的表现是"这把武器不再吃元素加成、也永远不会触发附带效果"，
   而界面上它照样写着"元素：fir" —— 三处读点没有一个会报错。 */
Registry.family('element', {
  note: '元素（名字 + 附带效果的机制名；武器表的 element 必须在这里）', owner: 'data_elems.ts',
  entries: function () {
    return Elems.LIST.map(function (d) { return { id: d.uid, refs: [] }; });
  }
});
Registry.family('elementEffect', {
  note: '元素的附带效果机制（声明了却没人认领 = 界面上写着效果而实际上没有）', owner: 'data_elems.ts',
  values: function () { return Elems.LIST.map(function (d) { return d.effect; }).filter(function (e) { return !!e; }); }
});

export { Elems };
/* 字段 → 家族的声明（守卫读它，见 test/data-contract.mjs）。 */
Registry.uses('effect', 'elementEffect');