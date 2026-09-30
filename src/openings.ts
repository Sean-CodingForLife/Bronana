/* =========================================================
   openings.ts — 入门三选（捏人最后一步：初始技能 / 初始属性 / 初始天赋）
   ---------------------------------------------------------
   用户 2026-10-01 的原话：

   > 「而如果是选择新存档，就会需要捏人选择初始角色外观，选择初始角色职业，
   >   然后就能确定这个角色的**初始技能，初始属性，初始天赋**等
   >   确定人物以后开始世界冒险」

   "初始技能 / 初始属性 / 初始天赋"这三样**在游戏里都已经有**了 ——
   `skills.ts` 的技能树、`stats.ts` 的属性表、`talents.ts` 的天赋树。
   缺的不是三个系统，而是**开局那一刻的一次选择**：改造前，
   属性来自职业（写死）、技能来自图鉴里打过的卡（要先玩）、天赋来自攒下的点数（要先赢）。
   新档的第一局是**三样全都空**的。

   所以这一模块做的是**一次开局选择**，不是第四套成长系统：
     · 三张表（技能 / 属性 / 天赋各一列），每列**三选一**
     · 一次折叠 `Openings.fold(charId, entry)` → 一份 `OpeningLoadout`
     · 那份载荷**由 `Game.newRun` 的实参传进去** —— 于是
       "捏人时挑的这三样"是**开局条件**（回放能重建），不是运行期的隐藏加成

   ⚠ **为什么不是"每个角色一套"**：那等于把设计工作量乘 9，而收益只有在
   玩家玩到第 9 个角色时才出现。三列各三档 = 3×3×3 = 27 种开局，
   对"第一次进游戏"这件事已经足够；真要按角色分化，加档位是纯数据工作。
   （与 R24"天赋树的节点数量与形状"同一个道理：加什么要有设计意图。）

   ⚠ **三层归属**（这是本模块唯一需要想清楚的事）：
     · 属性直接进 `OpeningLoadout.stats`（`Stats.KEYS` 的键，单位与属性表一致）
     · 技能进 `weapons` / `items` —— 那是**模拟层认识的起始携带**；
       技能的完整形态（技能槽 / 符文）仍然归 `skills.ts` 的技能树，
       这一档给的是"开局就带一件与它配套的东西"，不抢技能树的活
     · 天赋进 `scrap` / `material` —— 同上：天赋树的节点仍然归 `talents.ts`，
       这一档给的是"开局那点本钱"
   这样切的好处是**一行新的模拟层代码都不需要**：三样最终都落在
   已经存在的 `OpeningLoadout` 上，而它已经有回放、存档、对账三套守卫。
   ========================================================= */

import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';
import { Stats } from './stats.ts';

var Openings = {} as OpeningsApi;

/* =========================================================
   1. 三张表
   ---------------------------------------------------------
   每一档只写**它给什么**，不写"它有多强" —— 强度是折叠出来的那个数。
   三档必须**不同向**（一档偏攻、一档偏守、一档偏资源），
   否则这就是一个"哪个数字大选哪个"的假选择。
   ========================================================= */
var SKILLS: OpeningChoiceDef[] = [
  {
    id: 'sk_blade', name: '先行者', note: '开局多带一把近战武器 —— 第一间房就能站住脚',
    weapons: ['knife']
  },
  {
    id: 'sk_shot', name: '哨兵', note: '开局多带一把远程武器 —— 靠距离解决问题',
    weapons: ['slingshot']
  },
  {
    id: 'sk_supply', name: '随行者', note: '开局多带一件道具（咖啡）—— 少一件武器，多一层底子',
    items: ['coffee']
  }
];

var ATTRIBUTES: OpeningChoiceDef[] = [
  {
    id: 'at_tough', name: '厚实', note: '生命 +6 · 护甲 +1 —— 容错换不了一点输出',
    stats: { maxHp: 6, armor: 1 }
  },
  {
    id: 'at_swift', name: '轻捷', note: '移速 +0.10 · 攻速 +0.06 —— 靠走位与频率吃饭',
    stats: { speed: 0.10, attackSpeed: 0.06 }
  },
  {
    id: 'at_sharp', name: '锐利', note: '伤害 +8% · 暴击 +4% —— 打得动，但挨不起',
    stats: { damage: 0.08, critChance: 0.04 }
  }
];

var TALENTS: OpeningChoiceDef[] = [
  {
    id: 'ta_coin', name: '有余', note: '开局废料 +45 —— 第一间商店能真的买东西',
    scrap: 45
  },
  {
    id: 'ta_mats', name: '存货', note: '开局材料 +12 —— 经营那一半能早点起步',
    material: 12
  },
  {
    id: 'ta_gear', name: '旧物', note: '开局多一件道具（旧球鞋）—— 拿"选择"换"起点"',
    items: ['sneaker']
  }
];

var COLS: OpeningColumnDef[] = [
  { key: 'skill', name: '初始技能', note: '开局多带什么（技能树仍然在局内自己点）', list: SKILLS },
  { key: 'stat', name: '初始属性', note: '开局那一层底子（与职业属性相加）', list: ATTRIBUTES },
  { key: 'talent', name: '初始天赋', note: '开局那点本钱（天赋树仍然靠成长点自己点）', list: TALENTS }
];

/* 列键 → 表（`Character.audit` 会拿 `Object.keys(entry)` 与它对账） */
var BY_COL: Record<string, OpeningChoiceDef[]> = Object.create(null);
var BY_ID: Record<string, OpeningChoiceDef> = Object.create(null);
(function index() {
  for (var i = 0; i < COLS.length; i++) BY_COL[COLS[i].key] = COLS[i].list;
  for (var c = 0; c < COLS.length; c++) {
    for (var j = 0; j < COLS[c].list.length; j++) {
      BY_ID[COLS[c].key + ':' + COLS[c].list[j].id] = COLS[c].list[j];
    }
  }
})();

/* =========================================================
   2. 问句
   ========================================================= */
Openings.COLS = COLS;
/** 三列的键（`skill` / `stat` / `talent`）—— **唯一出处**，
    `Character` 的归一表与界面都读它，不各写一份。 */
Openings.COL_KEYS = COLS.map(function (c) { return c.key; });
Openings.LIST = SKILLS.concat(ATTRIBUTES, TALENTS);
Openings.DEFAULT_ENTRY = { skill: SKILLS[0].id, stat: ATTRIBUTES[0].id, talent: TALENTS[0].id };

Openings.col = function (key) {
  return BY_COL[String(key || '')] || null;
};
Openings.has = function (col, id) {
  var list = BY_COL[String(col || '')];
  if (!list) return false;
  var want = String(id || '');
  for (var i = 0; i < list.length; i++) if (list[i].id === want) return true;
  return false;
};
Openings.byId = function (col, id) {
  var list = BY_COL[String(col || '')];
  if (!list) return null;
  var want = String(id || '');
  for (var i = 0; i < list.length; i++) if (list[i].id === want) return list[i];
  return null;
};

/**
 * 一份入门三选 → 每一列**该显示哪一档**。
 *
 * 认不出的（空串 / 坏档 / 换了表之后的旧 id）落到该列**第一档**，
 * 与 `appearance.ts` 的"坏 id 落缺省档"同一条纪律：
 * 坏档不该让这个档打不开，只该让它回到"没选过"的样子。
 */
Openings.resolve = function (entry: Partial<CharacterEntryPick> | null | undefined): CharacterEntryPick {
  var e = (entry && typeof entry === 'object') ? entry : {};
  var out = {} as CharacterEntryPick;
  for (var i = 0; i < COLS.length; i++) {
    var k = COLS[i].key;
    var want = String((e as Record<string, unknown>)[k] || '');
    out[k] = Openings.has(k, want) ? want : COLS[i].list[0].id;
  }
  return out;
};

/**
 * **折叠**：三选 → 一份 `OpeningLoadout`（交给 `Game.newRun` 当开局条件）。
 *
 * @param charId 初始职业。现在三张表**不按角色分化**（见文件头），
 *               参数留着是因为"按角色加档"是纯数据工作，届时它就在手边 ——
 *               而不是等到那时才去改每一处调用点的签名。
 *
 * 折叠规则（与 `talents.ts` 的 `openingFor` 同一套）：
 *   · `stats` 相加 · `weapons` / `items` 顺序追加 · `scrap` / `material` 相加
 *   · **全空 = 全 0**（这是行为指纹不变的前提：没捏人的路径逐位照旧）
 */
Openings.fold = function (charId: string, entry: Partial<CharacterEntryPick> | null | undefined): OpeningLoadout {
  void charId;
  var pick = Openings.resolve(entry);
  var out: OpeningLoadout = { stats: {}, weapons: [], items: [], scrap: 0, material: 0 };
  for (var i = 0; i < COLS.length; i++) {
    var d = Openings.byId(COLS[i].key, pick[COLS[i].key]);
    if (!d) continue;
    var k;
    if (d.stats) {
      for (k in d.stats) {
        if (!Object.prototype.hasOwnProperty.call(d.stats, k)) continue;
        out.stats[k] = (out.stats[k] || 0) + d.stats[k];
      }
    }
    if (d.weapons) for (k = 0; k < d.weapons.length; k++) out.weapons.push(d.weapons[k]);
    if (d.items) for (k = 0; k < d.items.length; k++) out.items.push(d.items[k]);
    if (d.scrap) out.scrap += d.scrap;
    if (d.material) out.material = (out.material || 0) + d.material;
  }
  out.scrap = Math.max(0, Math.round(out.scrap));
  out.material = Math.max(0, Math.round(out.material || 0));
  return out;
};

/** 三档各自给人的一行（界面画选项卡用它，不在这里写文案的第二份） */
Openings.lines = function (d: OpeningChoiceDef | null): string[] {
  if (!d) return [];
  var out: string[] = [];
  if (d.stats) {
    for (var k in d.stats) {
      if (!Object.prototype.hasOwnProperty.call(d.stats, k)) continue;
      out.push(Stats.short(k) + ' ' + Stats.pretty(k, d.stats[k]));
    }
  }
  if (d.weapons) for (var w = 0; w < d.weapons.length; w++) out.push('武器 ' + d.weapons[w]);
  if (d.items) for (var it = 0; it < d.items.length; it++) out.push('道具 ' + d.items[it]);
  if (d.scrap) out.push('废料 +' + d.scrap);
  if (d.material) out.push('材料 +' + d.material);
  return out;
};

/** 一行行给人看（捏人页 / 调试共用） */
Openings.describe = function () {
  return '入门三选：' + COLS.map(function (c) { return c.name + ' ' + c.list.length + ' 档'; }).join(' · ');
};

/* =========================================================
   3. 定义期自检
   ---------------------------------------------------------
   这一张表最容易出的错**不会报错**：某一档忘了写效果（`{}`），
   玩家选中它之后**什么也不会发生** —— 界面上照样显示"已选择"。
   所以判据里最要紧的一条是"每一档都必须真的给东西"。
   ========================================================= */
Openings.audit = function () {
  var problems = [];
  var i, j, k;
  var seenId: Record<string, boolean> = Object.create(null);

  if (COLS.length < 3) problems.push('入门三选少于三列（用户点名的是技能 / 属性 / 天赋三样）');
  for (i = 0; i < COLS.length; i++) {
    var c = COLS[i];
    if (!c.key || !c.name || !c.note) problems.push('第 ' + i + ' 列缺 key / name / note');
    if (!c.list || c.list.length < 2) {
      problems.push('列 ' + c.key + ' 少于 2 档 —— 那不叫"选择"');
      continue;
    }
    /* 每一列里 id 唯一；跨列也唯一（`BY_ID` 是 `列:id` 复合键，
       但两列里出现同一个 id 说明有人复制粘贴忘了改） */
    var local: Record<string, boolean> = Object.create(null);
    for (j = 0; j < c.list.length; j++) {
      var d = c.list[j];
      if (!d.id) { problems.push('列 ' + c.key + ' 第 ' + j + ' 档没有 id'); continue; }
      if (local[d.id]) problems.push('列 ' + c.key + ' 的 id 重复：' + d.id);
      local[d.id] = true;
      if (seenId[d.id]) problems.push('跨列的档位 id 重复：' + d.id);
      seenId[d.id] = true;
      if (!d.name || !d.note) problems.push(d.id + ' 缺 name / note（界面上会是个空选项）');
      /* **这一条是本模块的核心判据**：选了它必须真的发生点什么 */
      if (!Openings.lines(d).length) {
        problems.push(d.id + ' 没有任何效果（选中它什么也不会发生，而界面上照样写着"已选择"）');
      }
    }
    /* 同一列里两档**不许给出同一份效果**（那就是两个一样的按钮） */
    for (j = 0; j < c.list.length; j++) {
      for (k = j + 1; k < c.list.length; k++) {
        var a = Openings.lines(c.list[j]).join('|');
        var b = Openings.lines(c.list[k]).join('|');
        if (a === b) problems.push('列 ' + c.key + ' 的 ' + c.list[j].id + ' 与 ' + c.list[k].id + ' 效果完全相同');
      }
    }
  }

  /* 属性的键必须真的在属性表里 —— 写错一个键的表现是
     `applyOpening` 把它并进 `p.base` 的一个**没人读**的位置上（静默无效）。 */
  for (i = 0; i < ATTRIBUTES.length; i++) {
    var st = ATTRIBUTES[i].stats || {};
    for (var sk in st) {
      if (!Object.prototype.hasOwnProperty.call(st, sk)) continue;
      if (Stats.KEYS.indexOf(sk as StatKey) < 0) {
        problems.push(ATTRIBUTES[i].id + ' 用了属性表里没有的键：' + sk + '（它会静默无效）');
      }
      if (!isFinite(Number(st[sk])) || Number(st[sk]) === 0) {
        problems.push(ATTRIBUTES[i].id + ' 的 ' + sk + ' 不是有效数字');
      }
    }
  }

  /* 折叠：缺省档必须给出**非空**的载荷（否则"捏人"这一步是空转），
     而**空三选**必须落到各列第一档（那才是界面上"没选过"的样子）。 */
  var def = Openings.fold('ranger', Openings.DEFAULT_ENTRY);
  var emptyPick = Openings.resolve({ skill: '', stat: '', talent: '' });
  if (!Openings.lines(Openings.byId('skill', def.weapons.length ? 'sk_blade' : 'sk_supply'))) {
    problems.push('缺省档折不出任何东西');
  }
  /* 折出来的属性键必须都是真属性 */
  for (var fk in def.stats) {
    if (!Object.prototype.hasOwnProperty.call(def.stats, fk)) continue;
    if (Stats.KEYS.indexOf(fk as StatKey) < 0) problems.push('折叠结果里有属性表里没有的键：' + fk);
  }
  var wantFirst = COLS.every(function (c) { return emptyPick[c.key] === c.list[0].id; });
  if (!wantFirst) problems.push('resolve 对空输入没有落到各列第一档（界面会显示"没选中任何一档"）');

  /* `resolve` 对**坏档**也要落到第一档，而不是返回空串 */
  var bad = Openings.resolve({ skill: '不存在', stat: 42 as unknown as string, talent: null });
  for (i = 0; i < COLS.length; i++) {
    if (bad[COLS[i].key] !== COLS[i].list[0].id) {
      problems.push('resolve 对坏输入 ' + COLS[i].key + ' 没有落到第一档');
    }
  }

  return {
    ok: problems.length === 0, problems: problems,
    counts: { cols: COLS.length, choices: Openings.LIST.length }
  };
};

var verdict = Openings.audit();
if (!verdict.ok) throw new Error('openings.ts 自检失败：\n' + verdict.problems.join('\n'));
SelfCheck.register('Openings', Openings.audit);

/* =========================================================
   4. 登记进扩展点总账
   ---------------------------------------------------------
   ⚠ `weapons` / `items` 要由**总账**查（本模块不 import 那两张表 ——
   那是一条"meta 层依赖数据表"的边，而它换来的只是把一个查表动作提前了）。
   ========================================================= */
Registry.family('openingChoice', {
  note: '入门三选（捏人最后一步：初始技能 / 初始属性 / 初始天赋各一档）', owner: 'openings.ts',
  entries: function () {
    var out: RegistryEntry[] = [];
    for (var i = 0; i < COLS.length; i++) {
      for (var j = 0; j < COLS[i].list.length; j++) {
        var d = COLS[i].list[j];
        var refs: RegistryRef[] = [];
        for (var w = 0; w < (d.weapons || []).length; w++) {
          refs.push({ field: 'weapons[' + w + ']', value: (d.weapons as string[])[w], family: 'weapon' });
        }
        for (var it = 0; it < (d.items || []).length; it++) {
          refs.push({ field: 'items[' + it + ']', value: (d.items as string[])[it], family: 'item' });
        }
        out.push({ id: COLS[i].key + ':' + d.id, refs: refs });
      }
    }
    return out;
  }
});
Registry.family('openingColumn', {
  note: '入门三选的三列（键名与 `CharacterDef.init.entry` 的字段一一对应）', owner: 'openings.ts',
  values: function () { return Openings.COL_KEYS.slice(); }
});

export { Openings };
