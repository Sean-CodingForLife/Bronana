/* =========================================================
   skills.ts — **技能**：形（怎么送出去）× 效（打中了做什么）× 符文（怎么长）
   ---------------------------------------------------------
   为什么拆成三个正交的数据表，而不是"一个技能一行、里面塞满分支"：
   一行塞满分支的写法在加第 10 个技能时就会变成一条 if/else 长链，
   而"同一个形状换一种效果"这件事根本表达不出来 —— 可它恰恰是**构筑**的来源。
   分开之后：

     · **形**（`FORMS`）= 怎么把效果送到目标身上。bolt / cone / nova / beam / summon / buff
     · **效**（`PAYLOADS`）= 打中了做什么。damage / burn / slow / stun / knock / heal / leech
     · **技能**（`LIST`）= 一对 (形, 效) + 冷却 + 消耗 + 归属角色
     · **符文**（`RUNES`）= 挂在槽位上的改造器（更快 / 更大 / 穿透 / 双发 / 附元素 / 回蓝 / 增伤）
     · **树**（`TREES`）= **每个角色一张**，两张卡：选技能形态 → 选第二个符文

   于是"每个角色的技能与构筑都不一样"不是靠写 9 套代码，而是靠：
     · 每个角色的技能**形效组合不同**（`LIST` 的 owner）
     · 每个角色的两张卡**选项不同**（`TREES[charId]`）
     · 同一个技能在不同构筑下**行为不同**（符文折出来的参数）

   ## 与 `talents.ts` 的分工（两个都叫"树"，很容易混）
     · `talents.ts` = **局外成长**，只改**开局条件**（起始属性/武器/材料），
       一局之内不会变，全部角色共用一张大图。
     · `skills.ts` = **角色身份**，管的是"这个角色在战斗里能做什么"。
       技能树是**每个角色一张**，节点只在战斗中生效。
   两者都不碰模拟层的规则，模拟层只认识"折好的技能表"（`Skills.fold`）——
   它不认识"技能树"这个词。

   ## 技能的**唯一出口**是 `Skills.fold(charId, taken)`
   它产出 `SkillsFold`：每个槽位的形效参数 + 折进去的符文修正 + 冷却/消耗。
   模拟层拿它做一件事：`castSkill(loadout, slot, aim)`。没有第二个读点。

   ## 默认档必须可复现
   `Skills.fold(id, [])` 给的是**空构筑**：技能槽全空、符文空。
   战斗模式默认 `auto`、技能默认**不带**（要点出来才有）。
   于是"没点过技能树的角色"与改造前**逐位相同** —— 行为指纹靠这个。
   ========================================================= */

import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';
import { Elems } from './data_elems.ts';
import { U } from './utils.ts';

/** 调用方注入的角色信息（**本模块不认识 `data_chars.ts`**）。
 *  为什么不让它直接 import：`profile.ts` 在 meta 层、本模块在 sim 层，
 *  那一行 import 会构成一条**向上的依赖边**（低层认识高层），而架构门会红。
 *  改成注入之后依赖方向是调用方 → 本模块（向下），没有任何向上的边。
 *  ⚠ 注入的是**函数**而不是数组：角色表可能在测试里被替换成桩。 */
export interface SkillsCtx {
  chars(): Array<{ id: string; name?: string; tag?: string }>;
}

var Sk = {} as SkillsApi;

/* =========================================================
   1. 形（form）：怎么把效果送出去
   ---------------------------------------------------------
   每个形只描述**几何与投放方式**，不含任何伤害数值 ——
   数值属于"效"，增强属于"符文"。这三个分开之后，
   "同一个火球改成三连发"只是换一个符文，不是新写一个技能。
   ========================================================= */
var FORMS: Record<string, SkillFormDef> = {
  bolt: {
    note: '朝目标方向打出一发弹丸',
    params: ['speed', 'count', 'spread', 'radius', 'life', 'pierce'],
    def: { speed: 560, count: 1, spread: 0, radius: 6, life: 1.5, pierce: 0 }
  },
  cone: {
    note: '身前一个扇形范围，一次结算',
    params: ['range', 'arc'],
    def: { range: 130, arc: 90 }
  },
  nova: {
    note: '以自己为中心的一圈，一次结算',
    params: ['radius'],
    def: { radius: 150 }
  },
  beam: {
    note: '一条细长的直线，穿透路径上的一切',
    params: ['length', 'width'],
    def: { length: 420, width: 14 }
  },
  summon: {
    note: '放下一座会自己开火的装置（用已有的炮塔容器）',
    params: ['count', 'life', 'range'],
    def: { count: 1, life: 14, range: 260 }
  },
  buff: {
    note: '给自己上一层持续效果（不造成伤害）',
    params: ['life', 'dash'],
    def: { life: 6, dash: 0 }
  }
};

/* =========================================================
   2. 效（payload）：打中了做什么
   ---------------------------------------------------------
   `mul` 是相对武器面板伤害的倍率 —— 用倍率而不是绝对值，
   因为技能该随玩家的装备成长，否则中后期它们会变成摆设。
   ========================================================= */
var PAYLOADS: Record<string, SkillPayloadDef> = {
  damage: { note: '纯伤害', params: ['mul'], def: { mul: 1.6 } },
  burn: { note: '命中后持续灼烧', params: ['mul', 'burn'], def: { mul: 1.1, burn: 7 } },
  shock: { note: '命中后电弧跳到附近的怪身上', params: ['mul'], def: { mul: 1.2 } },
  slow: { note: '减速（降低目标移速）', params: ['mul', 'slow', 'life'], def: { mul: 0.9, slow: 0.45, life: 3 } },
  stun: { note: '打断并定住一小会儿', params: ['mul', 'stun'], def: { mul: 1.0, stun: 0.55 } },
  knock: { note: '重击：伤害 + 大幅击退', params: ['mul', 'knock'], def: { mul: 1.3, knock: 320 } },
  heal: { note: '只回血，不造成伤害', params: ['heal'], def: { heal: 6 } },
  leech: { note: '按造成的伤害回血', params: ['mul', 'leech'], def: { mul: 1.4, leech: 0.18 } }
};

/* =========================================================
   3. 技能表
   ---------------------------------------------------------
   `owner` 是**角色 id**（每个角色的技能不一样），`null` = 通用。
   `cost` 是"这一发要花几成能量"（能量见模拟层：不是新货币，
   而是每帧回充、施法扣除的一个 0..100 的条）——
   为什么不用冷却就够：只有冷却时，"两个技能谁先放"没有取舍；
   有能量之后"这一发火球还是留着放大招"变成了真选择。

   `target`：`nearest` = 自动找最近的目标；`aim` = 玩家朝的方向；`self` = 自己身上。
   手动模式下 `aim` 用玩家输入的方向，自动模式下用最近目标的方向 —— **同一个技能**，
   两种模式的区别只在"方向从哪来"。
   ========================================================= */
interface SkillRow {
  id: string; name: string; note: string;
  owner: string | null;
  /** **归属角色的 id**（与 `owner` 同值，但它是**必填**的字符串）。
   *  为什么要两个：`owner` 的 `null` 表达「通用」，而这一列表达
   *  「这一行属于哪一扇区」，建树靠它分组 —— 没有它就得 import 角色表。 */
  ch: string;
  form: string; payload: string;
  cd: number; cost: number; target: 'aim' | 'self';
  /** 形与效的参数覆盖（不写就用 `FORMS`/`PAYLOADS` 的默认值） */
  form_?: Record<string, number>;
  payload_?: Record<string, number>;
  element?: string;
}

var LIST: SkillRow[] = [
  /* ---- 通用（谁都能用；技能树上的"通用"那一支）---- */
  { id: 's_shot', name: '过载弹', note: '朝面前打一发重弹',
    owner: null, ch: 'shared', form: 'bolt', payload: 'damage', cd: 1.6, cost: 12, target: 'aim' },
  { id: 's_ring', name: '冲击环', note: '以自己为中心震开一圈',
    owner: null, ch: 'shared', form: 'nova', payload: 'knock', cd: 4.2, cost: 20, target: 'self' },

  /* ---- 全能人：均衡，能攻能守 ---- */
  { id: 's_ranger_volley', name: '三连射', note: '一次打出三发，散得很开',
    owner: 'ranger', ch: 'ranger', form: 'bolt', payload: 'damage', cd: 2.2, cost: 16, target: 'aim',
    form_: { count: 3, spread: 0.34, radius: 5, speed: 620 } },
  { id: 's_ranger_mend', name: '均衡术', note: '回一口血，顺手清掉身上的灼烧',
    owner: 'ranger', ch: 'ranger', form: 'buff', payload: 'heal', cd: 9, cost: 26, target: 'self' },

  /* ---- 狂战士：近身、重击、以伤换伤 ---- */
  { id: 's_brawler_cleave', name: '横扫', note: '身前一大片，击退极强',
    owner: 'brawler', ch: 'brawler', form: 'cone', payload: 'knock', cd: 3.0, cost: 18, target: 'aim',
    form_: { range: 165, arc: 150 }, payload_: { mul: 1.5, knock: 420 } },
  { id: 's_brawler_roar', name: '战吼', note: '一圈定住，然后自己回一口',
    owner: 'brawler', ch: 'brawler', form: 'nova', payload: 'stun', cd: 7.5, cost: 30, target: 'self',
    form_: { radius: 130 } },

  /* ---- 元素法师：远程、元素、薄皮 ---- */
  { id: 's_mage_fireball', name: '火球', note: '命中后持续灼烧',
    owner: 'mage', ch: 'mage', form: 'bolt', payload: 'burn', cd: 2.4, cost: 20, target: 'aim',
    form_: { speed: 460, radius: 9, life: 1.8 }, element: 'fire' },
  { id: 's_mage_frost', name: '霜噬', note: '一圈减速，范围很大',
    owner: 'mage', ch: 'mage', form: 'nova', payload: 'slow', cd: 6.5, cost: 28, target: 'self',
    form_: { radius: 190 }, payload_: { mul: 0.8, slow: 0.55, life: 4 }, element: 'magic' },

  /* ---- 工程师：装置、远程、工程学 ---- */
  { id: 's_eng_turret', name: '部署炮塔', note: '放下一座会自己开火的炮塔',
    owner: 'engineer', ch: 'engineer', form: 'summon', payload: 'damage', cd: 12, cost: 34, target: 'self',
    form_: { count: 1, life: 16, range: 280 } },
  { id: 's_eng_lance', name: '工程长矛', note: '一条穿透直线，打穿一排',
    owner: 'engineer', ch: 'engineer', form: 'beam', payload: 'damage', cd: 3.4, cost: 22, target: 'aim',
    form_: { length: 460, width: 12 }, payload_: { mul: 1.9 } },

  /* ---- 受虐狂：越疼越强，技能和"血"绑定 ---- */
  { id: 's_maso_lash', name: '血鞭', note: '抽一发，按已失生命加伤',
    owner: 'masochist', ch: 'masochist', form: 'cone', payload: 'leech', cd: 2.8, cost: 16, target: 'aim',
    form_: { range: 140, arc: 110 } },
  { id: 's_maso_burst', name: '血爆', note: '以自己为中心炸一圈，命中回血',
    owner: 'masochist', ch: 'masochist', form: 'nova', payload: 'leech', cd: 6.0, cost: 26, target: 'self',
    form_: { radius: 165 }, payload_: { mul: 1.6, leech: 0.25 } },

  /* ---- 角斗士：双持、连击、突进 ---- */
  { id: 's_glad_dash', name: '突刺', note: '向前冲一段，撞到的都吃伤害',
    owner: 'gladiator', ch: 'gladiator', form: 'buff', payload: 'damage', cd: 3.2, cost: 18, target: 'aim',
    form_: { dash: 210, life: 0.22 }, payload_: { mul: 1.35 } },
  { id: 's_glad_cross', name: '十字斩', note: '两段扇形，前后各一下',
    owner: 'gladiator', ch: 'gladiator', form: 'cone', payload: 'damage', cd: 4.4, cost: 24, target: 'aim',
    form_: { range: 150, arc: 260 }, payload_: { mul: 1.5 } },

  /* ---- 收藏家：滚雪球，靠拾取与幸运 ---- */
  { id: 's_col_shower', name: '撒币', note: '一圈弹丸，数量多但单发轻',
    owner: 'collector', ch: 'collector', form: 'nova', payload: 'damage', cd: 3.6, cost: 20, target: 'self',
    form_: { radius: 150 }, payload_: { mul: 1.0 } },
  { id: 's_col_luck', name: '转运', note: '回血 + 一圈击退（保命用）',
    owner: 'collector', ch: 'collector', form: 'nova', payload: 'heal', cd: 10, cost: 30, target: 'self',
    form_: { radius: 120 }, payload_: { heal: 9 } },

  /* ---- 疾行者：机动、风筝、闪避 ---- */
  { id: 's_spr_blink', name: '闪步', note: '瞬间位移一段，并震开落点',
    owner: 'sprinter', ch: 'sprinter', form: 'buff', payload: 'knock', cd: 2.6, cost: 14, target: 'aim',
    form_: { dash: 260, life: 0.18 } },
  { id: 's_spr_gale', name: '疾风', note: '身后拉一道减速带',
    owner: 'sprinter', ch: 'sprinter', form: 'cone', payload: 'slow', cd: 5.5, cost: 24, target: 'aim',
    form_: { range: 200, arc: 80 } },

  /* ---- 掘进者：破墙、重锤、慢 ---- */
  { id: 's_mole_quake', name: '裂地', note: '一圈重击，顺手震碎附近暗门墙',
    owner: 'mole', ch: 'mole', form: 'nova', payload: 'knock', cd: 5.0, cost: 26, target: 'self',
    form_: { radius: 175 }, payload_: { mul: 1.7, knock: 380 } },
  { id: 's_mole_drill', name: '钻击', note: '一条穿透直线，专治成排的怪',
    owner: 'mole', ch: 'mole', form: 'beam', payload: 'stun', cd: 6.0, cost: 28, target: 'aim',
    form_: { length: 380, width: 18 } }
];

var BY_ID: Record<string, SkillRow> = Object.create(null);
for (var i = 0; i < LIST.length; i++) BY_ID[LIST[i].id] = LIST[i];

/* =========================================================
   4. 符文：挂在技能槽上的改造器
   ---------------------------------------------------------
   符文**不改技能是什么**，只改它"多快 / 多大 / 几发 / 附带什么"。
   这是构筑的第二个维度：同一个火球，装了「连发」就是三连火球，
   装了「附魔」就多一层电击 —— 而它们占的是同一张卡。
   ========================================================= */
interface RuneRow {
  id: string; name: string; note: string;
  /** 它改哪些键；值的含义由 `apply` 决定 */
  mods: Record<string, number>;
  /** 归属角色；`null` = 谁都能装 */
  owner: string | null;
}

var RUNES: RuneRow[] = [
  /* ---- 通用 ---- */
  { id: 'r_swift', name: '速吟', note: '冷却 −25%', owner: null, mods: { cdMul: 0.75 } },
  { id: 'r_wide', name: '扩散', note: '范围 +30%、射程 +20%', owner: null, mods: { radiusMul: 1.3, rangeMul: 1.2 } },
  { id: 'r_pierce', name: '贯穿', note: '穿透 +2（弹丸）/ 宽度 +6（光束）', owner: null, mods: { pierceAdd: 2, widthAdd: 6 } },
  { id: 'r_multi', name: '连发', note: '弹丸 +2、扇形更散', owner: null, mods: { countAdd: 2, spreadAdd: 0.18 } },
  { id: 'r_power', name: '增伤', note: '技能伤害 +35%', owner: null, mods: { mulMul: 1.35 } },
  { id: 'r_thrift', name: '节流', note: '能量消耗 −30%', owner: null, mods: { costMul: 0.7 } },
  { id: 'r_focus', name: '凝神', note: '冷却 −18%、伤害 +12%', owner: null, mods: { cdMul: 0.82, mulMul: 1.12 } },
  { id: 'r_reach', name: '远投', note: '射程 +35%、弹速 +20%', owner: null, mods: { rangeMul: 1.35, speedMul: 1.2 } },

  /* ---- 角色专属符文：它们把"这个角色该怎么打"写进构筑里 ---- */
  { id: 'r_rage', name: '狂怒', note: '伤害随已失生命提高（最多 +60%）', owner: 'masochist', mods: { rageScale: 0.6 } },
  { id: 'r_element', name: '附魔', note: '技能附带一层电击', owner: 'mage', mods: { addElement: 1 } },
  { id: 'r_overload', name: '过载', note: '范围 +45%，但冷却 +20%', owner: 'engineer', mods: { radiusMul: 1.45, cdMul: 1.2 } },
  { id: 'r_dual', name: '双持', note: '弹丸 +1，近战扇形收窄但更深', owner: 'gladiator', mods: { countAdd: 1, arcMul: 0.8, rangeMul: 1.15 } },
  { id: 'r_greed', name: '贪婪', note: '技能命中额外产出废料（按伤害折算）', owner: 'collector', mods: { scrapOnHit: 1 } },
  { id: 'r_slip', name: '疾影', note: '位移距离 +45%', owner: 'sprinter', mods: { dashMul: 1.45 } },
  { id: 'r_dig', name: '掘进', note: '技能也能砸暗门墙（伤害照算）', owner: 'mole', mods: { hitsWalls: 1 } }
];

var RUNE_BY: Record<string, RuneRow> = Object.create(null);
for (i = 0; i < RUNES.length; i++) RUNE_BY[RUNES[i].id] = RUNES[i];
Sk.RUNE_BY = RUNE_BY;

/* =========================================================
   5. 技能树：**每个角色一张**，两张卡
   ---------------------------------------------------------
   卡 1（`form`）选"用哪个技能"：三个选项里挑一个。
   卡 2（`rune`）选"给它挂什么符文"：三个选项里挑一个。
   **候选里包含别的角色的技能吗？不含** —— 角色的身份靠"你能挑的技能"
   来体现；如果人人都能挑火球，法师就只剩数值差异了。
   每个角色能给 5 个候选（自己 2 个专属 + 3 个通用），所以两张卡各三选一，
   组合数是 3×3 = 9 种构筑 —— 对 9 个角色来说足够不同，又不会多到没法比较。
   ========================================================= */
interface TreeCardDef {
  id: string; name: string; note: string;
  kind: 'skill' | 'rune';
  /** 候选（技能 id 或符文 id），**按顺序**；3 个 */
  options: string[];
}

/* 通用候选池：**没写专属技能的角色**也能看到的两个（它们是「如果你想稳一点」的退路）。
   为什么是"没写专属技能的角色"而不是"所有人"：每个角色本来就有两个专属技能，
   通用技能只在**建树时凑候选**用（见下面的卡 2）。 */
var COMMON_SKILLS = ['s_shot', 's_ring'];

/* =========================================================
   技能树：**按技能表的 `ch` 分组**生成（不遍历角色表）
   ---------------------------------------------------------
   为什么不遍历角色表：那需要 `import data_chars.ts`，而 `profile.ts`（meta 层）
   读本模块 —— 于是会形成一条**向上的依赖边**（sim 认识 meta），架构门会红。
   按 `ch` 分组之后，扇区就是技能表自己的结构，本模块不需要认识"角色"这个概念。
   代价：**漏掉一个角色**（一个技能都没有）不会在这里被发现 —— 所以
   `audit()` 拿注入的角色清单做覆盖判据（见下面的"技能树覆盖"那一条）。
   ========================================================= */
var TREES: Record<string, { name: string; note: string; cards: TreeCardDef[] }> = {};
var _charList: Array<{ id: string; name: string; tag: string }> = [];

function buildTrees(chars: Array<{ id: string; name?: string; tag?: string }>) {
  TREES = {};
  _charList = [];
  var byChar: Record<string, { skills: string[]; runes: string[]; name: string; tag: string }> = {};
  var i, id;
  /* 扇区从**技能表**里长出来（`ch` 就是扇区 id） */
  for (i = 0; i < LIST.length; i++) {
    id = LIST[i].ch;
    if (id === 'shared') continue;                 // 通用技能不属于任何扇区
    if (!byChar[id]) byChar[id] = { skills: [], runes: [], name: id, tag: '' };
    byChar[id].skills.push(LIST[i].id);
  }
  for (i = 0; i < RUNES.length; i++) {
    id = RUNES[i].owner;
    if (!id) continue;
    if (!byChar[id]) byChar[id] = { skills: [], runes: [], name: id, tag: '' };
    byChar[id].runes.push(RUNES[i].id);
  }
  /* 角色的展示名与定位由调用方给（本模块不认识角色表） */
  for (i = 0; i < chars.length; i++) {
    id = chars[i].id;
    if (!byChar[id]) byChar[id] = { skills: [], runes: [], name: id, tag: '' };
    byChar[id].name = chars[i].name || id;
    byChar[id].tag = chars[i].tag || '';
    _charList.push({ id: id, name: byChar[id].name, tag: byChar[id].tag });
  }
  for (var cid in byChar) {
    if (!Object.prototype.hasOwnProperty.call(byChar, cid)) continue;
    var b = byChar[cid];
    /* 卡 1：自己的两个技能 + 一个通用（三选一）。
       为什么是"自己的两个"而不是"自己的全部"：候选与最终技能数要拉开差距，
       否则这张卡只是"把已经会的东西再写一遍"。 */
    var skillOpts = b.skills.concat([COMMON_SKILLS[b.skills.length % COMMON_SKILLS.length]]);
    /* 卡 2：自己的专属符文（如果有，排第一 = 默认推荐走本职）+ 通用符文。
       候选池给足五个是为了让**没有专属符文**的角色也能凑出三选一 ——
       卡上不足三个选项时它就不是选择题（自检会红）。 */
    var runeOpts = b.runes.concat(['r_focus', 'r_reach', 'r_power', 'r_swift', 'r_wide']);
    TREES[cid] = {
      name: b.name,
      note: b.tag,
      cards: [
        { id: cid + '_skill', name: '战斗方式', kind: 'skill',
          note: '你这一局主用哪一个技能', options: skillOpts.slice(0, 3) },
        { id: cid + '_rune', name: '改造', kind: 'rune',
          note: '给主技能挂一个改造器（它决定这个技能长什么样）', options: runeOpts.slice(0, 3) }
      ]
    };
  }
}

/* 默认按**技能表里出现过的扇区**建树（角色名就是 id）。
   测试与工具直接 import 本模块时走这一份；带角色名的正式建树由 `Skills.make` 覆盖。 */
buildTrees([]);
Sk.TREES = TREES;
Sk.FORMS = FORMS;
Sk.PAYLOADS = PAYLOADS;
Sk.LIST = LIST;
Sk.BY_ID = BY_ID;
Sk.RUNES = RUNES;

/** 这个角色能看到的两张卡 */
Sk.treeFor = function (charId) {
  return TREES[charId] || null;
};

/**
 * 能不能打这张卡。
 * @returns { ok, reason }
 * 判据只有两条（都能当场验证）：
 *   · 卡存在，候选里有这一个
 *   · 还没打过这张卡（一张卡只打一次 —— 打完就定下来了，这才是"构筑"）
 */
Sk.canPick = function (charId, cardId, optionId, taken) {
  var t = TREES[charId];
  if (!t) return { ok: false, reason: '这个角色没有技能树' };
  var card = null;
  for (var i = 0; i < t.cards.length; i++) if (t.cards[i].id === cardId) card = t.cards[i];
  if (!card) return { ok: false, reason: '没有这张卡' };
  if (card.options.indexOf(optionId) < 0) return { ok: false, reason: '这不是这张卡上的选项' };
  var list = taken || [];
  for (var j = 0; j < list.length; j++) {
    if (list[j] && list[j].card === cardId) return { ok: false, reason: '这张卡已经打过了' };
  }
  return { ok: true, reason: '' };
};

/** 打过的卡里，某一张选的是什么（没打过返回空串） */
Sk.pickedOn = function (taken, cardId) {
  var list = taken || [];
  for (var i = 0; i < list.length; i++) if (list[i] && list[i].card === cardId) return String(list[i].option || '');
  return '';
};

/* =========================================================
   6. 折叠：构筑 → 模拟层认识的那一份（**唯一出口**）
   ========================================================= */
/**
 * 把构筑折成技能载荷。
 *
 * @param charId 角色 id
 * @param taken  打过的卡：`[{ card, option }]`
 * @returns `SkillsFold`：
 *   · `slots`  —— 折叠后的技能（含符文修正），最多两个
 *   · `runes`  —— 装了哪些符文（界面显示用）
 *   · `empty`  —— 空构筑（一个技能都没有）
 *
 * ⚠ **空构筑必须是恒等**：模拟层看到 `slots.length === 0` 时什么都不做，
 * 于是"没点过技能树"与改造前逐位相同（行为指纹靠这个）。
 */
Sk.fold = function (charId, taken) {
  var out: SkillsFold = { slots: [], runes: [], char: String(charId || '') };
  var t = TREES[charId];
  if (!t) return out;

  var skillId = Sk.pickedOn(taken, t.cards[0].id);
  var runeId = Sk.pickedOn(taken, t.cards[1].id);

  /* 符文先折成一份"修正表"：它作用于该角色**所有**技能槽（现在只有一个，
     但写成"作用于整份载荷"是为了以后加第二个技能槽时不必改折叠逻辑）。 */
  var mods: Record<string, number> = {};
  var rune = runeId ? RUNE_BY[runeId] : null;
  if (rune) {
    out.runes.push(rune.id);
    for (var k in rune.mods) {
      if (!Object.prototype.hasOwnProperty.call(rune.mods, k)) continue;
      mods[k] = (mods[k] || 0) + rune.mods[k];
    }
  }
  out.mods = mods;

  if (!skillId) return out;                       // 只打了符文没打技能 = 没有技能
  var row = BY_ID[skillId];
  if (!row) return out;

  var form = FORMS[row.form];
  var pay = PAYLOADS[row.payload];
  var params: Record<string, number> = {};
  var key;
  /* 1) 形的默认值 */
  for (key in form.def) params[key] = form.def[key];
  /* 2) 效的默认值（与形同名时**效优先** —— 效是"这次要做什么"，
        形只是"怎么送"，同名键以效为准更符合直觉） */
  for (key in pay.def) params[key] = pay.def[key];
  /* 3) 技能自己的覆盖 */
  if (row.form_) for (key in row.form_) params[key] = row.form_[key];
  if (row.payload_) for (key in row.payload_) params[key] = row.payload_[key];
  /* 4) 符文的乘/加修正。
     ⚠ 这里刻意写成一个**表**而不是一长串 if：`mulMul` 作用在 `mul` 上、
     `cdMul` 作用在 `cd` 上…… 每一条都是"修正键 → 它作用于哪个载荷键"。
     写成表之后，加一种修正 = 加一行；写成 if 链的话，
     加一种修正要同时改三处（折叠、自检的 `KNOWN_MODS`、说明），漏一处就静默失效。 */
  var MUL_TARGET: Record<string, string> = {
    cdMul: 'cd', radiusMul: 'radius', rangeMul: 'range', arcMul: 'arc',
    dashMul: 'dash', mulMul: 'mul', costMul: 'cost', speedMul: 'speed'
  };
  var ADD_TARGET: Record<string, string> = {
    pierceAdd: 'pierce', widthAdd: 'width', countAdd: 'count', spreadAdd: 'spread'
  };
  /* 作用在技能表上的两个（不在 params 里） */
  var cd0 = row.cd, cost0 = row.cost;
  for (key in mods) {
    if (!Object.prototype.hasOwnProperty.call(mods, key)) continue;
    var v = mods[key];
    if (ADD_TARGET[key]) {
      var ak = ADD_TARGET[key];
      params[ak] = (params[ak] || 0) + v;
    } else if (MUL_TARGET[key]) {
      var mk2 = MUL_TARGET[key];
      /* `cd` / `cost` 住技能表上，其余住在参数里 —— 两处都要乘 */
      if (mk2 === 'cd') cd0 = cd0 * v;
      else if (mk2 === 'cost') cost0 = cost0 * v;
      else params[mk2] = (params[mk2] || 0) * v;
    }
    /* 其余修正键（rageScale / addElement / scrapOnHit / hitsWalls）不是数值修正，
       它们由模拟层直接读 `mods`，所以这里不做任何事 —— 但自检会保证
       每一个键都在 KNOWN_MODS 里，所以"写了却没人读"不可能发生。 */
  }
  /* 冷却与消耗：在乘完之后夹一个下限（符文叠满也不该到 0）。
     冷却走 `U.round2` —— 与别处显示的小数同一个舍入；直接写 `Math.round(x*100)/100`
     会被硬编码体检报成"同一段配方出现了第二遍"。 */
  var cd = Math.max(0.25, U.round2(cd0));
  /* 能量是整数：它是 0..100 的条，不需要小数 */
  var cost = Math.max(0, Math.round(cost0));
  /* 伤害之类的小数保持三位（`U.round3`）：符文连乘之后不留一串浮点尾巴 */
  for (var pk in params) {
    if (!Object.prototype.hasOwnProperty.call(params, pk)) continue;
    if (typeof params[pk] === 'number') params[pk] = U.round3(params[pk]);
  }

  out.slots.push({
    id: row.id, name: row.name, note: row.note,
    form: row.form, payload: row.payload,
    target: row.target,
    element: row.element || '',
    cd: cd, cost: cost, params: params
  });
  return out;
};

/** 符文/技能的一行说明（界面用；键自带 note，界面不写第二份） */
Sk.describe = function (id) {
  var row = BY_ID[id] || RUNE_BY[id];
  return row ? row.note : '';
};
Sk.nameOf = function (id) {
  var row = BY_ID[id] || RUNE_BY[id];
  return row ? row.name : id;
};

/* =========================================================
   7. 定义期自检
   ========================================================= */
Sk.audit = function () {
  var problems: string[] = [];

  /* ---- 形与效：参数表要与默认值对得上 ---- */
  /* 形与效的形状**是同一件事**（note + params + def），所以用一个结构类型收两边的参数，
     而不是给其中一边 `as any` —— 那样就绕过了"参数必须有默认值"这条判据本身。 */
  type ParamTable = Record<string, { params: string[]; def: Record<string, number> }>;
  var checkParams = (label: string, table: ParamTable) => {
    for (var id in table) {
      if (!Object.prototype.hasOwnProperty.call(table, id)) continue;
      var t = table[id];
      if (!t.params || !t.params.length) { problems.push(label + ' ' + id + ' 没声明参数'); continue; }
      for (var i = 0; i < t.params.length; i++) {
        if (!(t.params[i] in t.def)) {
          problems.push(label + ' ' + id + ' 声明的参数「' + t.params[i] + '」没有默认值（会在模板里变成 undefined）');
        }
      }
      for (var k in t.def) {
        if (!Object.prototype.hasOwnProperty.call(t.def, k)) continue;
        if (t.params.indexOf(k) < 0) {
          problems.push(label + ' ' + id + ' 的默认值有「' + k + '」但没声明成参数');
        }
      }
    }
  };
  checkParams('形', FORMS);
  checkParams('效', PAYLOADS);

  /* ---- 技能：形/效必须存在、owner 必须是真角色、id 不重复 ---- */
  var seen: Record<string, boolean> = Object.create(null);
  var charIds: Record<string, boolean> = Object.create(null);
  /* **有没有角色清单**：模块加载的那一刻它是空的（清单由调用方注入）——
     空集合会让下面每一条「owner 不是角色」都误报，所以那几条只在有清单时查。
     ⚠ 两条自己踩过的坑，写在这里免得下次再踩：
       1. 不能把这个判断缓存成局部变量（`audit()` 会被跑两次，缓存的是加载期那个值）
       2. `charIds` 必须**在这里**用当前清单填一遍 —— 上一版是从别的分支里挪过来的，
          于是 `_charList` 明明有 9 个角色、`charIds` 却是空的（26 条误报）。
     现在每一处都直接问 `_charList.length`，而 `charIds` 就在它下面现填。 */
  for (i = 0; i < _charList.length; i++) charIds[_charList[i].id] = true;
  for (i = 0; i < LIST.length; i++) {
    var s = LIST[i];
    if (!s.id) { problems.push('第 ' + i + ' 个技能没有 id'); continue; }
    if (seen[s.id]) problems.push('技能 id 重复：' + s.id);
    seen[s.id] = true;
    if (!s.name || !s.note) problems.push(s.id + ' 缺名字或说明');
    if (!FORMS[s.form]) problems.push(s.id + ' 的形不存在：' + s.form + '（它会静默地什么都不做）');
    if (!PAYLOADS[s.payload]) problems.push(s.id + ' 的效不存在：' + s.payload);
    if (_charList.length && s.owner !== null && !charIds[s.owner]) {
      problems.push(s.id + ' 的 owner 不是角色：' + s.owner + '（这个技能永远不会出现在任何人的树上）');
    }
    if (!(s.cd > 0)) problems.push(s.id + ' 的冷却必须是正数：' + s.cd);
    if (!(s.cost >= 0)) problems.push(s.id + ' 的消耗不能是负数：' + s.cost);
    if (s.element && !Elems.BY_ID[s.element]) {
      problems.push(s.id + ' 的元素不存在：' + s.element);
    }
    /* 覆盖值必须也是**声明的参数** —— 写错一个键名不会报错，只会静默失效 */
    var formDef = FORMS[s.form];
    var payDef = PAYLOADS[s.payload];
    if (formDef && s.form_) {
      for (var fk in s.form_) {
        if (!Object.prototype.hasOwnProperty.call(s.form_, fk)) continue;
        if (formDef.params.indexOf(fk) < 0 && !payDef) {
          problems.push(s.id + ' 覆盖了形参数「' + fk + '」，但形 ' + s.form + ' 没这个参数');
        }
      }
    }
  }

  /* ---- 符文：mods 的键必须在**折叠函数认识的那一组**里 ---- */
  var KNOWN_MODS = ['cdMul', 'radiusMul', 'rangeMul', 'arcMul', 'dashMul', 'mulMul', 'costMul', 'speedMul',
    'pierceAdd', 'widthAdd', 'countAdd', 'spreadAdd',
    'rageScale', 'addElement', 'scrapOnHit', 'hitsWalls'];
  for (i = 0; i < RUNES.length; i++) {
    var r = RUNES[i];
    if (!r.id || !r.name || !r.note) { problems.push('符文缺少 id/名字/说明：' + (r.id || i)); continue; }
    if (seen[r.id]) problems.push('id 重复（技能与符文共用一个名字空间）：' + r.id);
    seen[r.id] = true;
    if (_charList.length && r.owner !== null && !charIds[r.owner]) problems.push(r.id + ' 的 owner 不是角色：' + r.owner);
    var used = false;
    for (var mk in r.mods) {
      if (!Object.prototype.hasOwnProperty.call(r.mods, mk)) continue;
      used = true;
      if (KNOWN_MODS.indexOf(mk) < 0) {
        problems.push(r.id + ' 的修正「' + mk + '」不在折叠函数认识的那一组里（它会静默失效）');
      }
    }
    if (!used) problems.push(r.id + ' 什么都没改（它装在槽位上等于浪费一张卡）');
  }

  /* ---- 技能树：每个角色一张、两张卡、每张卡三个候选 ---- */
  var chars = Object.keys(TREES);
  /* 覆盖判据用**注入的角色清单**（`_charList`）：
     没注入时它是空的，于是这一条自动跳过（工具直接 import 本模块时就是这种情况 ——
     而那时它也不该报"少了某个角色"，因为根本没人告诉它有哪些角色）。 */
  if (_charList.length && chars.length !== _charList.length) {
    problems.push('技能树覆盖了 ' + chars.length + ' / ' + _charList.length + ' 个角色（漏掉的角色点不出技能）');
  }
  for (var ci = 0; ci < _charList.length; ci++) {
    var id2 = _charList[ci].id;
    var tree = TREES[id2];
    if (!tree) { problems.push(id2 + ' 没有技能树'); continue; }
    if (tree.cards.length !== 2) problems.push(id2 + ' 的卡不是两张：' + tree.cards.length);
    for (var cj = 0; cj < tree.cards.length; cj++) {
      var card = tree.cards[cj];
      if (card.options.length !== 3) problems.push(id2 + ' 的卡「' + card.name + '」不是三选一：' + card.options.length);
      var dup = {};
      for (var ok2 = 0; ok2 < card.options.length; ok2++) {
        var opt = card.options[ok2];
        if (dup[opt]) problems.push(id2 + ' 的卡「' + card.name + '」里有重复选项：' + opt);
        dup[opt] = true;
        if (card.kind === 'skill' && !BY_ID[opt]) problems.push(id2 + ' 的卡指向不存在的技能：' + opt);
        if (card.kind === 'rune' && !RUNE_BY[opt]) problems.push(id2 + ' 的卡指向不存在的符文：' + opt);
      }
    }
    /* **角色的技能必须是自己的**：卡 1 里至少要有一个 owner === 这个角色的技能，
       否则"每个角色的技能不一样"这句话就是假的（大家都用通用技能）。 */
    var ownOnCard = 0;
    for (var oi = 0; oi < tree.cards[0].options.length; oi++) {
      var ro = BY_ID[tree.cards[0].options[oi]];
      if (ro && ro.owner === id2) ownOnCard++;
    }
    if (ownOnCard === 0) {
      problems.push(id2 + ' 的技能卡里一个自己的技能都没有（角色之间就没有区别了）');
    }
    /* 自己那两个技能必须真的存在且 owner 对 */
    var ownTotal = 0;
    for (var li = 0; li < LIST.length; li++) if (LIST[li].owner === id2) ownTotal++;
    if (ownTotal < 2) problems.push(id2 + ' 只有 ' + ownTotal + ' 个专属技能（每个角色至少两个）');
  }

  /* ---- 空构筑恒等：折叠必须给出空载荷，且它不消耗任何东西 ---- */
  var emptyFold = Sk.fold('ranger', []);
  if (emptyFold.slots.length !== 0) {
    problems.push('空构筑折出了 ' + emptyFold.slots.length + ' 个技能（默认必须没有技能 —— 否则行为指纹会变）');
  }
  var noChar = Sk.fold('no_such_char', []);
  if (noChar.slots.length !== 0) problems.push('未知角色折出了技能（它应该什么都没有）');

  var skillCount = LIST.length;
  return {
    ok: problems.length === 0, problems: problems,
    counts: {
      skills: skillCount, forms: Object.keys(FORMS).length,
      payloads: Object.keys(PAYLOADS).length, runes: RUNES.length,
      trees: chars.length, chars: _charList.length
    }
  };
};

/**
 * 造一份技能系统（**工厂**：角色信息由调用方注入）。
 * @param ctx.chars 角色清单（只需要 id/name/tag 三个字段）
 *
 * 为什么要工厂而不是模块级初始化：见 `SkillsCtx` 的注释 ——
 * 直接 import 角色表会构成一条向上的依赖边。
 */
Sk.make = function (ctx: SkillsCtx) {
  buildTrees(ctx && ctx.chars ? ctx.chars() : []);
  return Sk;
};

/* ⚠ 模块级**不**跑 audit（会误报，见下面），但**登记进 SelfCheck**。
   ---------------------------------------------------------
   两件事必须分开看，第一版把它们当成一件，于是白丢了一道门：

     · **不能在模块加载时跑** —— `audit()` 里那几条「owner 是不是真角色」的判据
       要「角色清单已注入」，而模块加载的那一刻还没注入（清单由调用方给，见 `SkillsCtx`）。
     · **但可以登记** —— `SelfCheck.scan()` 在 **boot 的最后**才跑，
       而 `main.ts` 的 boot 里 `Skills.make({chars})` 排在它之前。
       所以轮到 `audit()` 时清单**已经注入了**，那几条判据是有意义的。

   而且就算顺序变了也不会炸出假阳：`audit()` 里每一处 owner 判据都夹着
   `_charList.length &&`（没有清单**就跳过**，而不是报"owner 不是角色"）。
   这条守卫是**当初**为了让"模块加载时跑一遍"不误报而加的，
   现在它同时保证了"注册进启动期"是安全的 —— 代价是**清单没注入时它会静默通过**，
   所以 `test/skill.mjs` 里另有一条判据：注入之后 audit 必须过、且必须真的查到问题
   （喂一份假的坏表进去，它得报出来）。

   剩下的那条纪律仍然靠源码形状守：`main.ts` 的 boot 里
   `Skills.make(...)` 必须排在 `skillsRef.audit()` 之前 —— `test/skill.mjs` 会读源码对。 */

/* =========================================================
   8. 登记进扩展点总账
   ========================================================= */
Registry.family('skill', {
  note: '技能（每个角色各不相同；形 × 效的组合）', owner: 'skills.ts',
  entries: function () {
    return LIST.map(function (s) {
      var refs = [
        { field: 'form', value: s.form, family: 'skillForm' },
        { field: 'payload', value: s.payload, family: 'skillPayload' }
      ];
      if (s.owner) refs.push({ field: 'owner', value: s.owner, family: 'char' });
      if (s.element) refs.push({ field: 'element', value: s.element, family: 'element' });
      return { id: s.id, refs: refs };
    });
  }
});
Registry.family('skillForm', {
  note: '技能的形（怎么把效果送出去）', owner: 'skills.ts',
  values: function () { return Object.keys(FORMS); }
});
Registry.family('skillPayload', {
  note: '技能的效（打中了做什么）', owner: 'skills.ts',
  values: function () { return Object.keys(PAYLOADS); }
});
Registry.family('skillRune', {
  note: '符文（挂在技能槽上的改造器；决定同一个技能长什么样）', owner: 'skills.ts',
  entries: function () {
    return RUNES.map(function (r) {
      return { id: r.id, refs: r.owner ? [{ field: 'owner', value: r.owner, family: 'char' }] : [] };
    });
  }
});
Registry.family('skillTreeCard', {
  note: '技能树的卡（每个角色两张，每张三选一）', owner: 'skills.ts',
  values: function () {
    var out: string[] = [];
    for (var c in TREES) {
      if (!Object.prototype.hasOwnProperty.call(TREES, c)) continue;
      for (var i2 = 0; i2 < TREES[c].cards.length; i2++) out.push(TREES[c].cards[i2].id);
    }
    return out;
  }
});

/* 字段 → 家族的声明（守卫读它，见 test/data-contract.mjs） */
Registry.uses('form', 'skillForm');
Registry.uses('payload', 'skillPayload');

/* 进**必经之路**：boot 时 `SelfCheck.scan()` 会跑它一遍（不过就抛）。
   上面那段注释说清了"为什么加载时不跑、但登记是安全的"。 */
SelfCheck.register('Skills', Sk.audit);

export { Sk as Skills };
