/* =========================================================
   camp.ts — 局内工坊（"制造"这根柱子在局内的那一半）
   ---------------------------------------------------------
   **这一版改了它的身份**：它以前是"给战斗加被动"的面板（回血 / 炮塔 / 折扣），
   那正是三根柱子耦合严重的地方 —— 经营没有自己的产物，只是战斗的修饰器。
   现在它是**局内的制造车间**：花材料、按图纸、每波每条产线造一件装备或道具。
   它自己的资源、自己的回合、自己的失败（材料花了、产线这一波就没了）都在这里。

   三条**保持不变**的东西（它们本来就对，只是挂错了产物）：
     · **瓶颈才是玩法**（Two Point Hospital / RimWorld）：设施位只有 3 个，设施有 5 种
     · **投入占用本局资源**（Monster Rancher 的工作/训练/休息三角）：花的材料
       就是商店同一笔钱 —— "这一波投产线还是投自己"是真取舍
     · **相邻组合**（Loop Hero）：设施按建造顺序排一行，挨着才生效 —— 摆法本身是玩法

   效果键是**枚举**的，每个键都得有人读（与 danger.ts 同一套纪律：
   声明了却没人读 = 这条修正是假的，test/camp.mjs 静态守着）。
   全部五个键都只影响**制造**，一个都不碰战斗数值 —— 这是"解耦"的落地判据。
   ========================================================= */

import { SelfCheck } from './selfcheck.ts';
import { Registry } from './registry.ts';
import { U } from './utils.ts';

var Camp = {} as CampApi;

/* =========================================================
   1. 效果键（**全部**只作用于制造）
   ---------------------------------------------------------
   每个键自己带说明与文案（`note` 给开发者、`text(v)` 给玩家）：
   改造前"营地效果怎么写给人看"散在四处，改一个键要改四处，现在只有这一处。
   ========================================================= */
interface CampEffectKeyDef { note: string; text: (v: any) => string[]; }
function ck(note: string, text: (v: any) => string[]): CampEffectKeyDef { return { note: note, text: text }; }

var EFFECT_KEYS: Record<string, CampEffectKeyDef> = {
  weaponCost: ck('制造**武器**的材料费用折扣（craft.ts costOf）',
    function (v) { return ['造武器省料 ' + U.pct(v) + '%']; }),
  itemCost: ck('制造**道具**的材料费用折扣（craft.ts costOf）',
    function (v) { return ['造道具省料 ' + U.pct(v) + '%']; }),
  weaponQuality: ck('造出来的武器直接高一档的概率（craft.ts resultTier）',
    function (v) { return ['造武器 ' + U.pct(v) + '% 概率高一档']; }),
  itemDouble: ck('造出来的道具多给一件的概率（craft.ts resultTier）',
    function (v) { return ['造道具 ' + U.pct(v) + '% 概率多给一件']; }),
  salvageBonus: ck('回收旧装备时返还的材料加成（market.ts sellWeapon）',
    function (v) { return ['回收多返还 ' + U.pct(v) + '%']; })
};

/* =========================================================
   2. 设施表（**每一条都是产线**）
   ---------------------------------------------------------
   每一级写的是"这一级加多少"（增量），不是"到这一级一共多少" ——
   写混了会静默双倍。test/camp.mjs 把每个设施的"两级合计"都钉住了。

   价格单位是**建材**（不是材料）：一局的预算 ≈ 波数 × 2。
   为什么制造花材料、建设花建材：这两笔钱必须分开，否则"先攒钱盖房"的路线
   会在材料雪球起步前自断一臂（tools/balance.mjs 三轮实测，见 git 历史）。
   建材由**出击**带来（每波固定到账 + 宝箱/密室/营地房的收获），
   这正是"出击 → 制造"那条接口。
   ========================================================= */
function lv(cost, effect) { return { cost: cost, effect: effect }; }

var LIST: CampFacilityDef[] = [
  {
    id: 'furnace', name: '熔炉', note: '武器产线：造武器省料',
    levels: [
      lv(2, { weaponCost: 0.15 }),
      lv(3, { weaponCost: 0.10 })
    ]
  },
  {
    id: 'still', name: '配药台', note: '道具产线：造道具省料',
    levels: [
      lv(2, { itemCost: 0.15 }),
      lv(3, { itemCost: 0.10 })
    ]
  },
  {
    id: 'anvil', name: '锻台', note: '武器产线：造出来有机会直接高一档',
    levels: [
      lv(3, { weaponQuality: 0.25 }),
      lv(4, { weaponQuality: 0.20 })
    ]
  },
  {
    id: 'assay', name: '检验台', note: '道具产线：造出来有机会多给一件',
    levels: [
      lv(3, { itemDouble: 0.25 }),
      lv(4, { itemDouble: 0.20 })
    ]
  },
  {
    id: 'salvage', name: '回收炉', note: '拆掉不要的装备，把材料捞回来',
    levels: [
      lv(2, { salvageBonus: 0.25 }),
      lv(3, { salvageBonus: 0.25 })
    ]
  }
];
/** 每波到账的建材（出击带回来的一部分）。一局 ≈ 波数 × 2 点 */
var POINTS_PER_WAVE = 2;
Camp.POINTS_PER_WAVE = POINTS_PER_WAVE;

var BY_ID: Record<string, CampFacilityDef> = Object.create(null);
for (var i = 0; i < LIST.length; i++) BY_ID[LIST[i].id] = LIST[i];

/** 设施位：**这是瓶颈**。5 种设施只能塞 3 个位子，升级不占新位子 */
Camp.SLOTS = 3;
Camp.LIST = LIST;
Camp.BY_ID = BY_ID;
Camp.EFFECT_KEYS = EFFECT_KEYS;

/* =========================================================
   2b. 相邻组合（摆法本身是玩法）
   ---------------------------------------------------------
   设施按**建造顺序**排成一行，紧挨着的两个命中组合表就额外生效。
   一行 3 个位子最多同时挂 2 个组合 —— 于是"先建谁、再建谁"是真决策，
   而卖掉落单会拆掉组合（拆除也是决策）。
   ========================================================= */
var COMBOS: CampComboDef[] = [
  { a: 'furnace', b: 'anvil', name: '淬火', note: '炉子边打铁，成色更好', effect: { weaponQuality: 0.15 } },
  { a: 'anvil', b: 'assay', name: '流水线', note: '两班倒，省料', effect: { weaponCost: 0.05, itemCost: 0.05 } },
  { a: 'assay', b: 'salvage', name: '回炉', note: '验不过的直接回炉，试制更狠', effect: { itemDouble: 0.15 } },
  { a: 'salvage', b: 'still', name: '熬炼', note: '废料里熬出来的药', effect: { itemCost: 0.10 } },
  { a: 'still', b: 'furnace', name: '釜底', note: '炉火共用，省料', effect: { weaponCost: 0.10 } }
];
Camp.COMBOS = COMBOS;

/** 这一行里生效的组合（`row` = 按建造顺序排的设施 id） */
Camp.combosFor = function (row) {
  var out = [];
  var r = row || [];
  for (var i = 0; i + 1 < r.length; i++) {
    for (var c = 0; c < COMBOS.length; c++) {
      var k = COMBOS[c];
      if ((k.a === r[i] && k.b === r[i + 1]) || (k.b === r[i] && k.a === r[i + 1])) out.push(k);
    }
  }
  return out;
};

/** 给界面用：某两个设施之间有没有组合（有就返回它） */
Camp.comboOf = function (a, b) {
  for (var c = 0; c < COMBOS.length; c++) {
    var k = COMBOS[c];
    if ((k.a === a && k.b === b) || (k.b === a && k.a === b)) return k;
  }
  return null;
};

/* =========================================================
   3. 查询（纯函数）
   ========================================================= */
/** 工坊状态是 `{ 设施id: 等级 }`；等级从 1 起 */
Camp.levelOf = function (state, id) {
  var v = state ? Number(state[id]) : 0;
  return isFinite(v) ? Math.max(0, Math.min(Camp.maxLevel(id), Math.floor(v))) : 0;
};
Camp.maxLevel = function (id) {
  var d = BY_ID[id];
  return d ? d.levels.length : 0;
};
/** 已经占用了几个设施位（升级不算新占）= **几条产线** */
Camp.usedSlots = function (state) {
  var n = 0;
  for (var id in (state || {})) {
    if (!Object.prototype.hasOwnProperty.call(state, id)) continue;
    if (Camp.levelOf(state, id) > 0) n++;
  }
  return n;
};

/**
 * 能不能盖 / 升级。
 * @param points 手里的**建材**（不是材料 —— 这两笔钱刻意分开，理由见文件头）
 * @param opts.slots    设施位上限（据点"地基"可以把它抬高；缺省 = 基准）
 * @param opts.discount 价格折扣（据点"工匠"与天赋「商会」给的；缺省 = 不打折）
 * @returns { ok, reason, cost, toLevel }
 */
Camp.canBuy = function (state, id, points, opts) {
  var d = BY_ID[id];
  if (!d) return { ok: false, reason: '没有这个设施', cost: 0, toLevel: 0 };
  var slots = (opts && opts.slots > 0) ? Math.floor(opts.slots) : Camp.SLOTS;
  var disc = (opts && opts.discount > 0) ? Math.min(0.6, opts.discount) : 0;
  var cur = Camp.levelOf(state, id);
  if (cur >= d.levels.length) return { ok: false, reason: '已经满级', cost: 0, toLevel: cur };
  var next = cur + 1;
  if (cur === 0 && Camp.usedSlots(state) >= slots) {
    return { ok: false, reason: '设施位满了（' + slots + ' 个）—— 先拆一个或升级已有的', cost: 0, toLevel: next };
  }
  var cost = Math.max(1, Math.round(d.levels[cur].cost * (1 - disc)));
  if (Math.max(0, Number(points) || 0) < cost) {
    return { ok: false, reason: '建材不够（需要 ' + cost + '，出击每波带回 +' + POINTS_PER_WAVE + '）', cost: cost, toLevel: next };
  }
  return { ok: true, reason: '', cost: cost, toLevel: next };
};

/**
 * 拆掉时退多少：按**实际付过的**价格算（打折买的不该按原价退）。
 * `opts.fullRefund`（据点「工匠」）让拆除**全额**返还 —— 那是一条能力：
 * 摆法可以试错，而不是"建错了就亏一半"。
 */
Camp.refundOf = function (state, id, opts) {
  var lvl = Camp.levelOf(state, id);
  if (!lvl) return 0;
  var disc = (opts && opts.discount > 0) ? Math.min(0.6, opts.discount) : 0;
  var spent = 0;
  for (var i = 0; i < lvl; i++) {
    spent += Math.max(1, Math.round(BY_ID[id].levels[i].cost * (1 - disc)));
  }
  return (opts && opts.fullRefund) ? spent : Math.floor(spent / 2);
};

/* =========================================================
   4. 折叠：工坊状态 → 一份效果（制造时只读这份）
   ========================================================= */
/**
 * 把 `{ 设施id: 等级 }` + 建造顺序折成一份效果。
 * 与 danger.ts 同一个套路：**折叠只做一次**（买东西时），别处不再回表。
 */
Camp.effects = function (state, row) {
  var fx: CampEffects = {
    weaponCost: 0, itemCost: 0, weaponQuality: 0, itemDouble: 0, salvageBonus: 0
  };
  function fold(e) {
    if (!e) return;
    if (e.weaponCost) fx.weaponCost += e.weaponCost;
    if (e.itemCost) fx.itemCost += e.itemCost;
    if (e.weaponQuality) fx.weaponQuality += e.weaponQuality;
    if (e.itemDouble) fx.itemDouble += e.itemDouble;
    if (e.salvageBonus) fx.salvageBonus += e.salvageBonus;
  }
  for (var id in (state || {})) {
    if (!Object.prototype.hasOwnProperty.call(state, id)) continue;
    var d = BY_ID[id];
    if (!d) continue;
    var lvl = Camp.levelOf(state, id);
    for (var i = 0; i < lvl; i++) fold(d.levels[i].effect);
  }
  // 相邻组合：只有**真的挨着**才算（卖掉落单会拆掉组合）
  var active = Camp.combosFor(row);
  for (var c = 0; c < active.length; c++) fold(active[c].effect);
  // 每个键都封顶：省料叠到免费 = 材料经济整条消失；质量叠到 100% = 品级系统失效
  fx.weaponCost = Math.max(0, Math.min(Camp.COST_CAP, fx.weaponCost));
  fx.itemCost = Math.max(0, Math.min(Camp.COST_CAP, fx.itemCost));
  fx.weaponQuality = Math.max(0, Math.min(Camp.QUALITY_CAP, fx.weaponQuality));
  fx.itemDouble = Math.max(0, Math.min(Camp.QUALITY_CAP, fx.itemDouble));
  fx.salvageBonus = Math.max(0, Math.min(Camp.SALVAGE_CAP, fx.salvageBonus));
  return fx;
};

/** 三个封顶值（与据点 / 图纸相加后再由 craft.ts / market.ts 统一夹一次） */
Camp.COST_CAP = 0.45;
Camp.QUALITY_CAP = 0.6;
Camp.SALVAGE_CAP = 0.5;

/** 一行行给人看（界面与 describe 都用它 —— **文案只有一份**） */
Camp.effectLines = function (fx) {
  var out = [];
  for (var k in EFFECT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(EFFECT_KEYS, k)) continue;
    var v = fx ? fx[k] : null;
    if (!v) continue;
    var key = EFFECT_KEYS[k];
    if (key && typeof key.text === 'function') out.push.apply(out, key.text(v));
    else out.push(k + ' +' + v);
  }
  return out;
};
/** 单个键的文案（levels 里"下一级给什么"用） */
Camp.effectText = function (k, v) {
  var key = EFFECT_KEYS[k];
  return (key && typeof key.text === 'function') ? key.text(v) : [k + ' +' + v];
};

Camp.describeState = function (state, row) {
  var lines = ['工坊：' + Camp.usedSlots(state) + '/' + Camp.SLOTS + ' 条产线'];
  var any = false;
  for (var id in (state || {})) {
    if (!Object.prototype.hasOwnProperty.call(state, id)) continue;
    var lvl = Camp.levelOf(state, id);
    if (!lvl) continue;
    any = true;
    lines.push('  ' + BY_ID[id].name + ' Lv.' + lvl + '  ' + BY_ID[id].note);
  }
  if (!any) lines.push('  （空）');
  var active = Camp.combosFor(row);
  if (active.length) {
    lines.push('  相邻组合：' + active.map(function (k) { return k.name + '（' + k.note + '）'; }).join(' · '));
  }
  var eff = Camp.effectLines(Camp.effects(state, row));
  for (var e = 0; e < eff.length; e++) lines.push('  ' + eff[e]);
  return lines.join('\n');
};

/* =========================================================
   5. 自检
   ========================================================= */
Camp.audit = function () {
  var problems: string[] = [];
  var seen: Record<string, boolean> = Object.create(null);
  for (var i = 0; i < LIST.length; i++) {
    var d = LIST[i];
    if (seen[d.id]) problems.push('设施 id 重复：' + d.id);
    seen[d.id] = true;
    if (!d.name || !d.note) problems.push(d.id + ' 缺名字或说明');
    if (!d.levels || !d.levels.length) { problems.push(d.id + ' 没有等级'); continue; }
    var lastCost = 0;
    for (var l = 0; l < d.levels.length; l++) {
      var step = d.levels[l];
      if (!(step.cost > 0)) problems.push(d.id + ' 第 ' + (l + 1) + ' 级没有价格');
      if (step.cost <= lastCost) problems.push(d.id + ' 的价格没有随等级上涨');
      lastCost = step.cost;
      var e = step.effect || {};
      var keys = Object.keys(e);
      if (!keys.length) problems.push(d.id + ' 第 ' + (l + 1) + ' 级没有任何效果');
      for (var k = 0; k < keys.length; k++) {
        if (!EFFECT_KEYS[keys[k]]) problems.push(d.id + ' 用了未声明的效果键：' + keys[k]);
      }
    }
  }
  // 瓶颈必须真的存在：设施种类要**多于**位子，否则"选"就不存在
  if (LIST.length <= Camp.SLOTS) {
    problems.push('设施种类（' + LIST.length + '）不比位子（' + Camp.SLOTS + '）多，"取舍"就是假的');
  }
  if (Camp.SLOTS < 2) problems.push('位子少于 2 个 → 任何"相邻组合"都不可能生效');
  var pairs: Record<string, boolean> = Object.create(null);
  for (var c = 0; c < COMBOS.length; c++) {
    var kk: CampComboDef = COMBOS[c];
    if (!BY_ID[kk.a]) problems.push('组合 ' + kk.name + ' 的 a 不是真实设施：' + kk.a);
    if (!BY_ID[kk.b]) problems.push('组合 ' + kk.name + ' 的 b 不是真实设施：' + kk.b);
    if (kk.a === kk.b) problems.push('组合 ' + kk.name + ' 的两个设施是同一个（自己和自己相邻没有意义）');
    if (!kk.name || !kk.note) problems.push('组合 ' + (kk.name || c) + ' 缺名字或说明');
    var key = [kk.a, kk.b].sort().join('+');
    if (pairs[key]) problems.push('组合重复（同一对设施写了两遍）：' + key);
    pairs[key] = true;
    if (!kk.effect || !Object.keys(kk.effect).length) problems.push('组合 ' + kk.name + ' 没有任何效果');
    else {
      for (var ck2 in kk.effect) {
        if (!EFFECT_KEYS[ck2]) problems.push('组合 ' + kk.name + ' 用了未声明的效果键：' + ck2);
      }
    }
  }
  /* 这一条是**这一步重构的判据**：工坊的每个键都必须只作用于制造。
     写进自检是因为"顺手给个战斗加成"是最容易复发的那种退化 —— 代码上只要
     往 levels 里加一行就会发生，而它正是"三根柱子耦合"的来源。 */
  var NON_CRAFT = ['waveHeal', 'turretBonus', 'freeRerolls', 'shopDiscount', 'stats'];
  for (var ni = 0; ni < NON_CRAFT.length; ni++) {
    if (EFFECT_KEYS[NON_CRAFT[ni]]) problems.push('工坊里出现了战斗向的键：' + NON_CRAFT[ni] + '（耦合会从这里长回来）');
  }
  return {
    ok: problems.length === 0, problems: problems,
    counts: { facilities: LIST.length, slots: Camp.SLOTS, combos: COMBOS.length }
  };
};

SelfCheck.register('Camp', Camp.audit);

/* =========================================================
   6. 登记进扩展点总账
   ========================================================= */
Registry.family('campFacility', {
  note: '局内工坊设施（每条产线一座，花建材，结算清零）', owner: 'camp.ts',
  entries: function () {
    return LIST.map(function (d) {
      var refs = [{ field: 'levels', value: String(d.levels.length), family: 'campLevelCount' }];
      return { id: d.id, refs: refs };
    });
  }
});
Registry.family('campEffect', {
  note: '工坊效果键（全部只作用于制造；声明了却没人读 = 这条效果是假的）', owner: 'camp.ts',
  values: function () { return Object.keys(EFFECT_KEYS); }
});
Registry.family('campLevelCount', {
  note: '工坊设施的等级数（1 到 3）', owner: 'camp.ts',
  values: function () { return ['1', '2', '3']; }
});
Registry.family('campCombo', {
  note: '工坊相邻组合（两个设施挨着才生效）', owner: 'camp.ts',
  entries: function () {
    return COMBOS.map(function (k) {
      return {
        id: k.name,
        refs: [
          { field: 'a', value: k.a, family: 'campFacility' },
          { field: 'b', value: k.b, family: 'campFacility' }
        ]
      };
    });
  }
});

export { Camp };
