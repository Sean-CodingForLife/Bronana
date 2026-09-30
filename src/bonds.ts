/* =========================================================
   bonds.ts — **NPC 关系状态**（M3 第三块，2026-09）
   ---------------------------------------------------------
   设计上下文 v3 §8-3 要求养成模块建"角色/羁绊系统"，含两样东西：

     ① **共享关系状态**（好感 / 信任 / 关系阶段）
     ② **双轨** —— 叙事线**不产经济** / 养成线**产 `growth`**

   这个文件是 ①。②的两半分别落在：
     · **叙事线** → `story.ts`（台词按关系阶段开闸；它**一个铜板都不碰**）
     · **养成线** → `Game.talkTo`（相处 → 信任上升 → **到新阶段就产成长点**）

   ## 为什么"共享"这两个字要紧

   v3 §6 的说法是"NPC 关系与叙事**分轨、互不绑架**"。落到代码上就是：

     关系状态是**一份**（`S.bonds`），叙事与养成**都读它**，
     但**只有养成那一侧能改经济**。

   所以这个文件里没有一处碰 `growth` / `material` / 任何账本 ——
   它只回答"这个人现在跟玩家到哪一步了"。产钱那一句在 `game.ts`，
   而那正是"养成线"这个身份。

   ## 与 v3 §6.5 的关系

   §6.5 的硬约束是"NPC 互动**不能直接花战斗/经营模块代币**"。
   `Bonds` 里因此**没有任何代价字段** —— 相处**不花**战斗或经营的钱。
   它只**产**养成那一侧的东西（到达阶段给 `growth`）。
   ========================================================= */
import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';
import { Story } from './story.ts';

var Bonds = {} as BondsApi;

/* =========================================================
   关系阶段
   ---------------------------------------------------------
   `at` 是**信任门槛**（达到它就是这个阶段）。门槛递增，且第一级是 0 ——
   那样"生人"永远是初始态，不需要特判。

   `growth` 是**到达这个阶段时产多少养成代币**。0 表示"这一级不给"：
   第一次见面本来就不该发钱（`stranger` 是初始态，玩家没有"到达"过它）。
   ========================================================= */
Bonds.STAGES = [
  { id: 'stranger', name: '生人', at: 0, growth: 0, note: '刚认识。他只跟你谈天气' },
  { id: 'acquaintance', name: '相识', at: 3, growth: 4, note: '记得住你的名字了' },
  { id: 'trusted', name: '信赖', at: 7, growth: 9, note: '肯跟你说设施怎么用' },
  { id: 'bonded', name: '羁绊', at: 12, growth: 16, note: '把他的那件事讲给你听' }
];

Bonds.BY_STAGE = (function () {
  var m: Record<string, BondStageDef> = Object.create(null);
  for (var i = 0; i < Bonds.STAGES.length; i++) m[Bonds.STAGES[i].id] = Bonds.STAGES[i];
  return m;
})();

/** 每位 NPC 每次相处给多少信任 */
Bonds.TRUST_PER_TALK = 1;

/**
 * 每位 NPC 每波能相处几次。
 *
 * **模块内的时间感**（v3 §8-12）：与训练的"每波 3 次"、制造的"每波每条产线一次"
 * 同一个形状 —— 不是冷却计时器，是"这一波你只有这么多回合"。
 * 取 2 而不是 3：相处比训练更"重"（它推进剧情），慢一点才有分量。
 */
Bonds.TALK_PER_WAVE = 2;

/** 现在处于第几级（`trust` 决定，与"哪一位 NPC"无关） */
Bonds.stageIndex = function (trust) {
  var tv = Math.max(0, Math.floor(Number(trust) || 0));
  var idx = 0;
  for (var i = 0; i < Bonds.STAGES.length; i++) if (tv >= Bonds.STAGES[i].at) idx = i;
  return idx;
};

/** 现在处于哪个阶段（返回定义，不只是名字） */
Bonds.stageOf = function (trust) { return Bonds.STAGES[Bonds.stageIndex(trust)]; };

/** 与"某一位 NPC"的关系（名单来自 `story.ts` —— **共享**那一份，不另抄一份） */
Bonds.NPCS = function () {
  var out: Array<{ id: string; name: string }> = [];
  for (var i = 0; i < Story.NPCS.length; i++) {
    out.push({ id: Story.NPCS[i].id, name: Story.NPCS[i].name });
  }
  return out;
};

/** 下一级还要多少信任（已满级返回 0） */
Bonds.toNext = function (trust) {
  var idx = Bonds.stageIndex(trust);
  if (idx >= Bonds.STAGES.length - 1) return 0;
  return Math.max(0, Bonds.STAGES[idx + 1].at - Math.max(0, Math.floor(Number(trust) || 0)));
};

/** 界面铺一屏要的那些数（一处算清，界面不自己推） */
Bonds.view = function (npcId, trust, talksUsed) {
  var idx = Bonds.stageIndex(trust);
  var st = Bonds.STAGES[idx];
  return {
    id: String(npcId || ''),
    trust: Math.max(0, Math.floor(Number(trust) || 0)),
    stage: st.id,
    stageName: st.name,
    note: st.note,
    toNext: Bonds.toNext(trust),
    nextName: idx < Bonds.STAGES.length - 1 ? Bonds.STAGES[idx + 1].name : '',
    left: Math.max(0, Bonds.TALK_PER_WAVE - Math.max(0, Math.floor(Number(talksUsed) || 0)))
  };
};

/* =========================================================
   自检
   ---------------------------------------------------------
   每一条对着一个真实故障：
     · 第一级门槛不是 0 → "生人"就要特判，而且 `stageIndex` 会有空档
     · 门槛不递增 → 高级阶段永远不可达（`stageIndex` 只认最后一个满足的）
     · 初始阶段给钱 → 一进游戏就白拿（玩家还没"到达"过它）
     · NPC 名单与 `story.ts` 对不上 → 玩家能相处一个根本不在场的人
   ========================================================= */
Bonds.audit = function () {
  var problems: string[] = [];
  var seen: Record<string, boolean> = Object.create(null);
  for (var i = 0; i < Bonds.STAGES.length; i++) {
    var s = Bonds.STAGES[i];
    if (!s.id) { problems.push('第 ' + i + ' 个关系阶段没有 id'); continue; }
    if (seen[s.id]) problems.push('关系阶段 id 重复：' + s.id);
    seen[s.id] = true;
    if (!s.name) problems.push(s.id + ' 没有名字');
    if (!s.note) problems.push(s.id + ' 没有说明');
    if (i === 0 && s.at !== 0) {
      problems.push('第一级「' + s.id + '」的门槛是 ' + s.at + ' —— 必须是 0，' +
        '否则初始态要特判，而且 `stageIndex` 会有一段够不着的区间');
    }
    if (i > 0 && !(s.at > Bonds.STAGES[i - 1].at)) {
      problems.push('「' + s.id + '」的门槛（' + s.at + '）没有高过上一级（' +
        Bonds.STAGES[i - 1].at + '）—— 那样它永远不可达');
    }
    if (i === 0 && s.growth > 0) {
      problems.push('初始阶段「' + s.id + '」给 ' + s.growth + ' 成长点 —— ' +
        '玩家没有"到达"过初始态，那是白送');
    }
    if (i > 0 && !(s.growth > 0)) {
      problems.push('「' + s.id + '」到阶段不给成长点 —— 那它就只是一句文案，' +
        '养成线（"与 NPC 相处到某个关系阶段"）在这里断了');
    }
  }
  if (!(Bonds.TRUST_PER_TALK > 0)) problems.push('每次相处给的信任是 0 —— 关系永远推不动');
  if (!(Bonds.TALK_PER_WAVE > 0)) problems.push('每波相处次数是 0 —— NPC 这条线完全动不了');
  /* 名单必须与叙事那一份**同源**：不然玩家能跟一个不在场的人相处 */
  var npcs = Bonds.NPCS();
  if (!npcs.length) problems.push('NPC 名单是空的（`Story.NPCS` 没给出人来）');
  for (var j = 0; j < npcs.length; j++) if (!npcs[j].id) problems.push('第 ' + j + ' 位 NPC 没有 id');
  return { ok: problems.length === 0, problems: problems, counts: { stages: Bonds.STAGES.length, npcs: npcs.length, perWave: Bonds.TALK_PER_WAVE } };
};

var verdict = Bonds.audit();
if (!verdict.ok) throw new Error('bonds.ts 自检失败：\n' + verdict.problems.join('\n'));

SelfCheck.register('Bonds', Bonds.audit);

Registry.family('bondStage', {
  note: 'NPC 关系阶段（信任门槛 → 阶段 → 到阶段产的成长点）',
  owner: 'bonds.ts',
  values: function () { return Bonds.STAGES.map(function (s) { return s.id; }); }
});

export { Bonds };
