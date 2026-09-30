/* =========================================================
   guide.ts — **软引导：撞墙提示 + 路径指引**（v3 §8-15 / §9-建议7，M5）
   ---------------------------------------------------------
   v3 §9-建议7：
     "软引导：**撞墙提示 + 路径指引**。"

   `station.ts` 的公告板写着它该显示什么：
     "把这一局的账摆出来：四本账各有多少、三个核心素材各差几次必出、
      **下一步该去哪**"

   前两样是**读数**（`Game.material/capacity/growth` + `Link.untilPity`），
   第三样是**判断** —— 就是这个文件。

   ## 为什么是一张规则表而不是一串 if

   软引导最怕的事是"它开始胡说"：条件写漏一种状态，玩家就会在
   **循环已经转起来**的时候被指回第一步。规则表让每条都带 `when`（什么时候说）、
   `to`（指去哪）、`text`（说什么）、`why`（为什么这么说），于是：

     · 覆盖不全 → `audit` 报"有些状态没人管"
     · 指向不存在的地方 → `audit` 报"指去一个不存在的站"
     · 一条都不匹配 → 返回 `null`，界面说"循环转起来了，随便挑"

   ## 顺序就是**优先级**

   `next()` 返回**第一条**满足的规则。所以表是从"最卡"排到"最顺"：
   先解决"没材料"，再解决"有材料但不知道去哪"。
   ========================================================= */
import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';

var Guide = {} as GuideApi;

/* =========================================================
   规则表
   ---------------------------------------------------------
   `state` 里的字段全部由 `game.ts` 折好传进来 —— 这个文件**不认识会话**
   （与 `talents.ts` / `stronghold.ts` / `craft.ts` 同一形状）。
   ========================================================= */
Guide.RULES = [
  {
    id: 'need-material',
    when: function (s) { return s.material < 10; },
    to: 'gate-combat',
    text: '材料见底了 —— 出击打一波。它是三个模块共同的动作成本。',
    why: '材料是**全局货币**（v3 §5.1），训练 / 盖设施 / 造东西都要花它。' +
      '它见底时先说这一条：别的建议都推不动，因为**没有行动成本**。'
  },
  {
    id: 'need-core',
    when: function (s) { return s.core === 0 && s.keyBuilding === 0; },
    to: 'gate-combat',
    text: '还没有核心材料 —— 它只有关底 Boss 掉。去打穿一关。',
    why: '这是链条的第一环（战斗 → 经营）。没有它，经营的关键建筑升不上去，' +
      '而后面的遗物、图纸、徽记**全都不会动**。'
  },
  {
    id: 'build-key',
    when: function (s) { return s.core > 0 && s.keyBuilding === 0; },
    to: 'gate-manage',
    text: '有核心材料了 —— 去经营把那座关键建筑盖起来。它产遗物。',
    why: '核心材料花掉才变成**经营自己的东西**（v3 §5.2 的 core → relic）。' +
      '攒着不花，那条边就是断的。'
  },
  {
    id: 'spend-relic',
    when: function (s) { return s.relic > 0 && !s.mythForged; },
    to: 'gate-grow',
    text: '有遗物了 —— 去养成点「神话图纸」（它是图纸树最后一张）。',
    why: '遗物花在养成那边才算走完 **经营 → 养成**（v3 §5.2）。' +
      '这是那条边在玩家那一侧的出口。'
  },
  {
    id: 'walk-a-line',
    when: function (s) { return s.growth >= 20 && s.sigil === 0; },
    to: 'gate-grow',
    text: '成长点攒够了 —— 去点满一条天赋线，它产徽记。',
    why: '徽记是 **养成 → 战斗** 那条边的通货，而它的产出点是"走通一条能力线"。' +
      '不点满，循环就缺最后那一跳。'
  },
  {
    id: 'use-sigil',
    when: function (s) { return s.sigil > 0; },
    to: 'gate-combat',
    text: '有徽记了 —— 回战斗的商店里用掉（可以拿它刷新一次货架）。',
    why: '徽记花掉，三环才闭合（v3 §5.2 的 sigil 回到战斗）。' +
      '留着的徽记不产生任何东西 —— 它是**回程票**，不是存款。'
  }
];

Guide.BY_ID = (function () {
  var m: Record<string, GuideRuleDef> = Object.create(null);
  for (var i = 0; i < Guide.RULES.length; i++) m[Guide.RULES[i].id] = Guide.RULES[i];
  return m;
})();

/** 该去哪、为什么 —— 返回**第一条**满足的规则（顺序就是优先级） */
Guide.next = function (state) {
  var s = state || {};
  for (var i = 0; i < Guide.RULES.length; i++) {
    var r = Guide.RULES[i];
    var hit = false;
    try { hit = (r.when as (x: GuideState) => boolean)(s as GuideState) === true; } catch (e) { hit = false; }
    if (hit) return { id: r.id, to: r.to, text: r.text, why: r.why };
  }
  /* 一条都不匹配 = **循环转起来了**。返回 null 而不是硬编一句安慰话： */
  return null;
};

/* =========================================================
   自检
   ---------------------------------------------------------
   每一条对着一次"它开始胡说"：
     · 指向一个不存在的站 → 玩家点过去发现那里什么都没有
     · 缺 `when` / `text` / `why` → 要么永远不触发，要么触发了说不出所以然
     · 三个模块**一个都没被指到** → 那条边在引导里是隐形的
     · 规则顺序与"从最卡到最顺"相反 → 循环转起来了还被指回第一步
   ========================================================= */
Guide.audit = function (sites) {
  var problems: string[] = [];
  if (!Guide.RULES.length) problems.push('一条规则都没有 —— 公告板上的"下一步该去哪"就永远是空的');
  var seen: Record<string, boolean> = Object.create(null);
  var targets: Record<string, boolean> = Object.create(null);
  for (var i = 0; i < Guide.RULES.length; i++) {
    var r = Guide.RULES[i];
    if (!r.id) { problems.push('第 ' + i + ' 条规则没有 id'); continue; }
    if (seen[r.id]) problems.push('规则 id 重复：' + r.id);
    seen[r.id] = true;
    if (typeof r.when !== 'function') problems.push(r.id + ' 没有 `when` —— 那它永远不触发');
    if (!r.text) problems.push(r.id + ' 没有 `text` —— 触发了也说不出该干什么');
    if (!r.why) problems.push(r.id + ' 没有 `why` —— 说不出为什么，下一个人就会随手改顺序');
    if (!r.to) problems.push(r.id + ' 没说去哪');
    else {
      targets[r.to] = true;
      if (sites && sites.length && !sites.some(function (x) { return x.id === r.to; })) {
        problems.push(r.id + ' 指向一个不存在的站：' + r.to + '（玩家点过去会发现那里什么都没有）');
      }
    }
    /* `when` 不许抛：抛了会被 `next` 吞掉，于是那条规则**静默失效** */
    try { r.when({ material: 0, core: 0, growth: 0, relic: 0, sigil: 0, capacity: 0, keyBuilding: 0, mythForged: false }); }
    catch (e) { problems.push(r.id + ' 的 `when` 在空状态上抛了：' + (e && e.message ? e.message : e)); }
  }
  /* 三个模块都要在引导里露面，否则那条边是隐形的 */
  if (sites && sites.length) {
    var mods = ['combat', 'manage', 'grow'];
    for (var m = 0; m < mods.length; m++) {
      var any = Guide.RULES.some(function (r) {
        var st = null;
        for (var k = 0; k < sites.length; k++) if (sites[k].id === r.to) st = sites[k];
        return st && st.to === mods[m];
      });
      if (!any) problems.push('没有任何一条规则指向**' + mods[m] + '** —— 那条边在引导里是隐形的');
    }
  }
  /* 顺序：材料那一条必须在最前（没有行动成本时，别的建议都推不动） */
  if (Guide.RULES.length && Guide.RULES[0].id !== 'need-material') {
    problems.push('第一条规则不是 `need-material` —— 材料见底时先说别的建议，' +
      '玩家会发现"你说的那件事我做不了，因为我没有行动成本"');
  }
  return { ok: problems.length === 0, problems: problems, counts: { rules: Guide.RULES.length } };
};

/* 定义期就炸（与其它表一个套路）。`sites` 由 `station.ts` 那边传进来对账 —— */
/* 这里先跑一次不带 sites 的版本，跨表那一条由 `registry-drift` 的判据查。 */
var verdict = Guide.audit(null);
if (!verdict.ok) throw new Error('guide.ts 自检失败：\n' + verdict.problems.join('\n'));

SelfCheck.register('Guide', function () { return Guide.audit(null); });

Registry.family('guideRule', {
  note: '软引导规则（撞墙提示 + 路径指引）；顺序就是优先级',
  owner: 'guide.ts',
  values: function () { return Guide.RULES.map(function (r) { return r.id; }); }
});

export { Guide };
