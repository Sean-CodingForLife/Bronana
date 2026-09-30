/* =========================================================
   bonds.mjs — NPC 关系状态（`src/bonds.ts`）与养成线的产出
   ---------------------------------------------------------
   它盯的是 v3 §8-3 的两半：
     · **共享关系状态**（信任 → 关系阶段）
     · **双轨** —— 相处（养成线）**跨阶段就产成长点**；
       而叙事线（`story.ts`）一个字都不碰经济（那条在判据 J 的双轨守卫里）
   ========================================================= */
import { loadAll, SIM_MODULES } from './_load.mjs';
import { T } from './_assert.mjs';

const { Bonds, Game, Profile, Storage, Story } = await loadAll(SIM_MODULES).then(() => globalThis);
console.error = function () { };

console.log('\n=== Bronana · NPC 关系（养成线的产出） ===');
Storage.use(Storage.memory(Object.create(null)));

T.section('关系阶段表');
T.ok(Bonds.STAGES.length >= 2, '至少两级（否则"阶段"这个词没有意义）');
T.eq(Bonds.STAGES[0].at, 0, '第一级门槛是 0（初始态不需要特判）');
T.eq(Bonds.STAGES[0].growth, 0, '初始级不给成长点（玩家没"到达"过它）');
T.ok(Bonds.STAGES.every((s, i) => i === 0 || s.at > Bonds.STAGES[i - 1].at),
  '门槛严格递增（否则高级阶段不可达）');
T.ok(Bonds.STAGES.slice(1).every(s => s.growth > 0),
  '除初始级外每一级都产成长点（不然养成线在这里断了）');
T.eq(Bonds.stageOf(0).id, Bonds.STAGES[0].id, '信任 0 → 第一阶段');
T.eq(Bonds.stageOf(999).id, Bonds.STAGES[Bonds.STAGES.length - 1].id, '信任拉满 → 最后阶段');

T.section('名单与叙事同源');
const npcs = Bonds.NPCS();
T.ok(npcs.length > 0, '有 NPC（' + npcs.length + ' 位）');
T.eq(npcs.map(n => n.id).join(','), Story.NPCS.map(n => n.id).join(','),
  '名单**就是** `story.ts` 那一份（不另抄一份）');

T.section('相处 = 养成线的产出（跨阶段才给）');
Storage.wipe(); Profile.reset();
Game.newRun('brawler', 20260930, 0, null, null);
const npc = npcs[0].id;
/* ⚠ **相处有每波上限**（`Bonds.TALK_PER_WAVE`，模块内的时间感），所以够到第 1 道
   门槛要**跨波**。这里用"清空这一波的计数"来模拟进波 —— 那正是 `startWave` 做的事。 */
const nextWave = () => { Game.getSession().talks = {}; };
const need = Bonds.STAGES[1].at;
let gained = 0, crossed = { ok: false, gain: 0 };
for (let i = 0; i < need; i++) {
  const r = Game.talkTo(npc);
  gained += r.gain;
  if (!r.ok) { console.log("    （第 " + (i + 1) + " 次被拒：" + r.reason + "）"); break; }
  crossed = r;
  if (i + 1 < need) nextWave();
}
T.eq(gained, Bonds.STAGES[1].growth, '跨阶段之前不给、跨过去正好给那一笔');
T.ok(crossed.ok && crossed.gain === Bonds.STAGES[1].growth,
  '跨过第一道门槛 → 产 ' + Bonds.STAGES[1].growth + ' 成长点', crossed.gain);
T.eq(Game.bondView ? 0 : Game.bondsAll()[0].stage, Bonds.STAGES[1].id, '阶段确实进了一级');
T.eq(Game.growth(), Bonds.STAGES[1].growth, '成长点余额就是跨阶段那一笔');

T.section('相处不花钱（v3 §6.5 的硬约束）');
const mats = Game.material();
Game.addMaterial(100);
Game.newRun('brawler', 20260930, 0, null, null);
T.eq(Game.material(), 0, '新一局材料从 0 开始');
Game.talkTo(npc);
T.eq(Game.material(), 0, '相处**一点材料都没花**（NPC 互动不花战斗/经营的钱）');

T.section('每波限次（模块内的时间感）');
for (let i = 0; i < Bonds.TALK_PER_WAVE + 3; i++) Game.talkTo(npc);
const b = Game.bondsAll().find(x => x.id === npc);
T.eq(b.left, 0, '这一波聊满了');
T.ok(Game.talkTo(npc).ok === false, '再聊被拒（每波 ' + Bonds.TALK_PER_WAVE + ' 次）');

T.section('边界');
T.ok(Game.talkTo('不存在的人').ok === false, '不认识的人相处被拒');
T.eq(Bonds.toNext(Bonds.STAGES[Bonds.STAGES.length - 1].at), 0, '满级之后 `toNext` 是 0（不是负数）');

process.exit(T.done());
