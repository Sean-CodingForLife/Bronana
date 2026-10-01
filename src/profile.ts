/* 技能表由**调用方注入**（`main.ts` 的 boot）——
   直接 import 会让本文件（meta 层）依赖 `skills.ts`（sim 层），
   那是一条**向上的依赖边**，架构门会红。

/* =========================================================
   profile.ts — 账号级档案（局外成长的地基）

   为什么要有它：改造前持久层只有三把键 —— 设置 / 进行中的一局 / 战绩记录。
   前两个是"这一次会话"的，战绩是**只读的统计**。任何跨局的成长
   （解锁、图鉴、角色养成、据点经营）都缺一个能写的地方。

   它与 records 的分工：
     · `records` 是**只读统计**（最好波次、总击杀）—— 写法是"并入一局"。
     · `profile` 是**可写的账号状态**（解锁、图鉴、孢子、已完成挑战、每角色记录）。
   所以本模块**不自己算累计值**：`applyRun()` 由调用方喂进
   "这一局的观察值 + 并入后的 totals"（main.ts 的接入层负责取，
   与 Save.addRun 的顺序是：先并入 records，再喂给 profile）。

   版本与迁移：用自己的版本号与迁移链（envelope.ts 的工厂），
   只改档案格式时不必让 run/records 跟着跨版本。
   ========================================================= */

import { Challenges } from './challenges.ts';
import { Chars } from './data_chars.ts';
import { Camp } from './camp.ts';
import { Craft } from './craft.ts';
import { Daily } from './daily.ts';
import { Danger } from './danger.ts';
import { Envelope } from './envelope.ts';
import { Character } from './character.ts';
import { Forge } from './forge.ts';
import { Items } from './data_items.ts';
import { Offline } from './offline.ts';
import { Openings } from './openings.ts';
import { Registry } from './registry.ts';
import { Season } from './season.ts';
import { SelfCheck } from './selfcheck.ts';
import { Slots } from './slots.ts';
import { Tutorial } from './tutorial.ts';
import { Storage } from './storage.ts';
import { Story } from './story.ts';
import { Stronghold } from './stronghold.ts';
import { Talent } from './talents.ts';

var Profile = {} as ProfileApi;

/* 技能表由**调用方注入**（`main.ts` 的 boot）——
   直接 import 会让本文件（meta 层）依赖 `skills.ts`（sim 层），
   那是一条**向上的依赖边**，架构门会红。
   注入之前技能构筑一律返回空：那个时点只可能是模块加载期，
   没有人会在那时候读技能（`data` 还没读盘）。 */
var SkillsRef: SkillsApi | null = null;
/** 接上技能表（返回值 = 有没有接上；启动期调用一次） */
Profile.useSkills = function (api) { SkillsRef = api || null; return !!SkillsRef; };

var env = Envelope.create({ name: 'profile', version: 1 });

/* =========================================================
   1. 形状
   ========================================================= */
/** 图鉴的三态：见过 / 用过 / 满级过 */
var CODEX_SEEN = 1, CODEX_USED = 2, CODEX_MASTERED = 3;

/* =========================================================
   0. 档案有哪些字段（**一份清单，两处读**）
   ---------------------------------------------------------
   这张清单原先只写在 `Registry.family('profileSection')` 的 `values()` 里，
   于是它**没有任何对照物** —— 漂了很久没人响。提成模块级常量之后，
   `values()` 与 `Profile.audit()` 读同一份，而 audit 拿 `blank()` 的真实键集合
   跟它对账。**这份自检第一次跑就抓出三个漏登记的字段**：

     | 漏的字段 | 为什么它该在清单里 |
     | --- | --- |
     | `wallet` | 材料钱包 —— 整条"带出局"的落点 |
     | `tutorialSeen` | 引导进度，换存档槽要跟着走 |
     | `core` | 核心材料（meta-rare 那一档），经营与养成的共同门槛 |
     | `createdAt` / `updatedAt` | 档案自身的元数据 |

   前四个是"漂掉了的跨局字段"，最后两个是"清单从来没管过的元数据"。
   ========================================================= */
var PROFILE_SECTIONS = [
  'wallet', 'growth', 'core',
  'forge', 'unlocked', 'codex', 'done', 'perChar',
  /* **存档角色**（R50）：槽位号 -> "这个档里的那个人"（名字 / 外观 / 初始职业 /
     入门三选）。它属于**这一份档**，所以住在档案里；"选择存档"那一步的
     "新档 / 老档"判据就是"这里有没有这个槽位的人"。 */
  'characters',
  'daily', 'season', 'keep', 'keepLast', 'camp', 'campRow', 'tutorialSeen',
  'story', 'lastSeen', 'createdAt', 'updatedAt'
];

function blank() {
  return {
    /* **钱包里的钱**（`wallet`）：这些是**跨局**的、并且**从局内带出来的**。
       为什么单独一个子对象而不是铺在顶层：顶层那三笔（spores / alloy / core）是
       "结算后按公式给的奖励"，而钱包里的这一笔是**玩家在局内攒的那个数**
       （`stats_total.scrap` 的累计）—— 它不是算出来的，是打出来的。
       分开之后，"带出去"这件事有一个明确的落点（`applyRun` 里一行），
       而不是散在各处各自加。 */
    wallet: { material: 0 },   // 材料：带出局，只在**经营**里花（盖设施 / 建筑 / 产线）
    /* =========================================================
       **养成代币：只有一笔**（R43，2026-09）
       ---------------------------------------------------------
       它以前叫两个名字 —— `孢子`（天赋树与洗点）与 `合金`（图纸工坊）。
       而 v3 §5.1 只允许 **3 个模块代币 + 1 个全局货币 + 3 个核心素材**；
       养成是**一个**模块（v3 §8-3："把 `talents`/`forge` 的成长接到 `growth` 上"），
       所以它只有**一个**代币。

       ⚠ 合并的另一个理由更硬：`合金` 的来源是**合成**（战斗动作），
       而 v3 §5.2 的三条边里**没有"战斗 → 养成"** —— 那条边只能走
       `核心素材 B`（遗物：经营 → 养成）。所以 `合金` 的**收入**本来就不合法，
       它的产出点要搬到**养成模块内部**（M3 的工作）。
       ========================================================= */
    growth: 0,
    /* **核心材料**（`economy.ts` 的 `meta-rare` 那一档）：来源**只有 Boss**。
       它是"这一局值了"的那一笔，也是经营（设施 / 建筑）与养成（关键能力）的**共同门槛** ——
       于是那两个模块争的是同一笔稀有资源，而不是各花各的钱。
       与孢子 / 合金一样**不参与兑换**：能换就只剩一条曲线了。 */
    core: 0,
    forge: {},          // 'master' -> true（图纸工坊已解锁的图纸）
    unlocked: {},       // 'char:brawler' -> true
    codex: {},          // 'weapon:axe' -> 1|2|3
    done: {},           // challengeId -> 1
    /* charId -> { runs, kills, materials, bestWave, wins, level, danger }。
       **无原型**（`Object.create(null)`）不是洁癖：坏档里写一个 `perChar.__proto__`
       就会在 `data.perChar[c] = {...}` 那一步**改掉 perChar 的原型**（JSON.parse 出来的
       `__proto__` 是自有属性，可 for-in 枚举得到，赋值走的却是 setter），
       于是整段逐字段夹取被整段跳过：实测 `Profile.perChar("runs")` 返回 12345、
       `Profile.snapshot().perChar` 又是空对象（自相矛盾）、`talentFree` 直接冒 NaN。
       无原型的表上没有那个 setter，`__proto__` 只是一个普通键。 */
    perChar: Object.create(null),
    /* **存档角色**（R50）：`槽位号 -> CharacterDef`。
       为什么键是槽位号而不是 `charId`：一份存档 = 一个槽位的一份档案 =
       一个人。一个人可以换职业（重捏），但一个槽位不会有两个人。
       **无原型**的理由与 `perChar` 完全相同（坏档里的 `__proto__`）
       —— 它同样是 `JSON.parse` 的产物直接进表。 */
    characters: Object.create(null) as Record<string, CharacterDef>,
    daily: {},          // 'YYYY-MM-DD' -> 当天最好的一局（见 daily.ts）
    season: {},         // 'YYYY-Www'   -> 当周最好的一局（见 season.ts）
    /* **上一局结束时的据点快照**（`{ 设施id: 等级 }`）。
       为什么需要它：**离线产出是局外机制**，而据点现在是局内的（`S.keep`）——
       局内状态在局外读不到。于是结算时记一份快照，离线按"上一局把菌床盖到几级"算。
       它不是"跨局成长"，而是**一个记录** —— 与 `daily` / `season` 同一性质。 */
    keepLast: {} as Record<string, number>,
    /* ⚠ **据点已经搬进局内**（M1 第二块，2026-09）：等级住在 `S.keep`、
       钱是 `S.material`。这个字段**只保留给老档迁移**（读一次、不再写）。
       判据 I（M1 迁移预算）盯着"还有多少地方直接读账号"。
       ⚠ 它**不是**"据点还在账号里"的证据 —— 只是旧档的落脚处。 */
    keep: {},
    /* **工坊（经营场景的产线）**：`{ 设施id: 等级 }` + 建造顺序。
       它原先住在**局内会话**里（`game.ts` 的 `S.camp`），每局从零开始盖 ——
       那是"经营只是个局内小游戏"的形状。搬到档案里之后：
         · 设施是**跨局资产**：盖一次，之后每一局都在
         · 造装备/道具花的是**材料**（那笔能带出局的钱），不再是局内的"建材"
         · 相邻组合的摆法是**长期**决定，不是每局重摆
       与 `keep` 的关系：据点给的是"容量与能力"（多一条产线、拆解全额返还），
       工坊给的是"**制造能力**本身"（省料 / 抬档 / 回收）。两者都不把数字
       乘到战斗的柱子上 —— 这是它们与战斗不嵌合的地方。 */
    camp: {},           // 工坊设施 -> 等级（跨局永久，花材料）
    campRow: [],        // 建造顺序（相邻组合靠它判定；升级不挪位置）
    /* 首局引导：说过哪几条提示（`tutorial.ts` 的 id -> true）。
       落在这里而不是 localStorage，是因为它属于**这一份档** ——
       换槽位 / 换设备之后提示行为要跟着那份档走，
       而不是"每开一次浏览器就重新新手一次"。 */
    tutorialSeen: Object.create(null),
    /* ---- 剧情进度（N2）----
       为什么放在档案而不是"一局里"：Hades 那套 —— **死亡也推进剧情**。
       台词说过就不再出现（`said`）、碎片是收藏（`fragments`）、结局是解锁（`endings`），
       另加几个**计数**（runs/wins/bestFloor/secrets/bosses）当台词条件的输入。
       本模块只做账：哪条台词该不该说、哪片碎片该给，全在 story.ts 的纯函数里。 */
    story: {
      runs: 0, wins: 0, bestFloor: 0, secrets: 0,
      bosses: {},       // bossId -> true（跨局累计：打赢过哪些器官）
      fragments: {},    // fragmentId -> true
      said: {},         // lineId -> true（once 的台词说过就不再出现）
      endings: {},      // endingId -> true
      events: {}        // 事件房见过的遭遇 id（图鉴用）
    },
    /** 上次"见面"的时间戳（离线产出按它与现在的间隔结算） */
    lastSeen: 0,
    createdAt: Date.now(),
    updatedAt: 0
  };
}

var data = blank();
var loadedFrom = 'defaults';
var writeOk = true;

function key(family, id) { return family + ':' + id; }

/* =========================================================
   2. 读写（只暴露语义操作，不暴露裸对象字段的写权限）
   ========================================================= */
Profile.load = function () {
  /* ⚠ **槽位在这里生效**：`Slots.key()` 返回当前槽位的键
     （0 号槽就是原键名 —— 所以老存档天然在 0 号槽，不需要迁移）。
     读走 `Slots.readJSON`（它会退回备份并**记一笔**，界面据此提示玩家
     "档坏过、已回退"，而不是静默地把进度少一半当成"首次启动"）。 */
  var key = Slots.key(Storage.KEYS.profile);
  var raw = Slots.readJSON(key);
  // 「有档但读不出来」必须与「没有档」分开：解析失败返回的也是 null，
  // 只看它会把"档案损坏"静默报成"首次启动"，于是线上永远发现不了坏档。
  var present = Storage.get(key) !== null;
  var got = env.open(raw, 'profile');
  data = blank();
  loadedFrom = 'defaults';
  if (!got) {
    if (present) {
      loadedFrom = 'discarded';
      return { loaded: false, discarded: true, reason: env.lastError() || '档案无法解析' };
    }
    return { loaded: false, discarded: false, reason: null };
  }
  loadedFrom = 'storage';
  // 逐字段收紧：坏字段不该让整个档案作废（能修的修），值域一律夹回
  /* **养成代币只有一个余额**（R43）：`孢子` 与 `合金` 本来就是同一件事 ——
     都归养成模块（v3 §5.1 只有 3 个模块代币）。老档里它们是两个字段，
     这里**相加**并进来，不丢任何一笔。 */
  data.growth = Math.max(0, Math.floor(num(got.growth))) +
    Math.max(0, Math.floor(num(got.spores))) +
    Math.max(0, Math.floor(num(got.alloy)));
  data.core = Math.max(0, Math.floor(num(got.core)));
  /* 钱包（材料）：**老存档没有这个字段** —— 缺了就是 0，不做版本迁移。
     为什么可以用"缺省 0"代替一次迁移：新字段的缺省值是**唯一合理值**（没钱），
     而迁移链要处理的是"旧值需要换算成新形状"那种情况。这里没有换算，只有"从无到有"。 */
  data.wallet = { material: Math.max(0, Math.floor(num(got.wallet && got.wallet.material))) };
  data.forge = pick(got.forge, function (v) { return v === true; });
  data.createdAt = num(got.createdAt) || Date.now();
  data.updatedAt = num(got.updatedAt) || 0;
  data.unlocked = pick(got.unlocked, function (v) { return v === true; });
  data.done = pick(got.done, function (v) { return v === true; });
  data.codex = pick(got.codex, function (v) {
    var n = Math.floor(num(v));
    return n >= CODEX_SEEN && n <= CODEX_MASTERED ? n : false;
  });
  data.perChar = Object.create(null);
  var pc = (got.perChar && typeof got.perChar === 'object') ? got.perChar : {};
  for (var c in pc) {
    if (!Object.prototype.hasOwnProperty.call(pc, c)) continue;
    data.perChar[c] = {
      runs: Math.max(0, Math.floor(num(pc[c] && pc[c].runs))),
      kills: Math.max(0, Math.floor(num(pc[c] && pc[c].kills))),
      materials: Math.max(0, Math.floor(num(pc[c] && pc[c].materials))),
      bestWave: Math.max(0, Math.floor(num(pc[c] && pc[c].bestWave))),
      wins: Math.max(0, Math.floor(num(pc[c] && pc[c].wins))),
      level: Math.max(0, Math.floor(num(pc[c] && pc[c].level))),
      // 难度上限夹回合法范围：坏档里的 999 不该让玩家直接跳到最后一级
      danger: Math.max(0, Math.min(Danger.MAX, Math.floor(num(pc[c] && pc[c].danger)))),
      points: Math.max(0, Math.floor(num(pc[c] && pc[c].points))),
      // 已点天赋：只收"这个角色真的能点"的节点（换角色/改表之后残留的脏 id 一律丢掉）
      talents: cleanTalents(c, pc[c] && pc[c].talents),
      /* 技能构筑（技能树打过的卡）：与天赋同一套路，另外还要求
         "一张卡只留第一次"（见 `cleanSkillBuild`）。 */
      skillBuild: cleanSkillBuild(c, pc[c] && pc[c].skillBuild),
      respecs: Math.max(0, Math.floor(num(pc[c] && pc[c].respecs)))
    };
  }
  // 每日 / 每周挑战记录：按时间键存"那一期最好的一局"（两者同形，共用一段读取逻辑）
  data.daily = readRunRecords(got.daily, /^\d{4}-\d{2}-\d{2}$/);
  data.season = readRunRecords(got.season, /^\d{4}-W\d{2}$/);

  /* **存档角色**（R50）：键是槽位号。只收合法的槽位键，值逐个走
     `Character.normalize` —— 坏档里的坏色板 / 超长名字 / 换行都在那里被摁死。
     ⚠ 收口放在这里而不是 `Character` 里的理由与别处一样：
       `Character` 是纯形状（不 import 存储），读盘这一层归本模块。 */
  data.characters = Object.create(null) as Record<string, CharacterDef>;
  var chs = (got.characters && typeof got.characters === 'object') ? got.characters : {};
  for (var chk in chs) {
    if (!Object.prototype.hasOwnProperty.call(chs, chk)) continue;
    if (!/^\d+$/.test(chk)) continue;                       // 只认槽位号
    var slotN = Math.floor(num(chk));
    if (slotN < 0 || slotN >= Slots.COUNT) continue;         // 越界的槽位丢掉（加槽位之前的老档）
    var normed = Character.normalize(chs[chk]);
    if (normed && normed.charId) data.characters[String(slotN)] = normed;
  }

  // 据点：只收真实存在的设施，等级夹回合法范围
  var kp = (got.keep && typeof got.keep === 'object') ? got.keep : {};
  for (var kid in kp) {
    if (!Object.prototype.hasOwnProperty.call(kp, kid)) continue;
    if (!Stronghold.BY_ID[kid]) continue;
    var klv = Math.floor(num(kp[kid]));
    if (klv > 0) data.keep[kid] = Math.min(klv, Stronghold.maxLevel(kid));
  }
  /* **据点快照**（上一局盖到哪了）：与 `keep` 同一套夹取。
     为什么它需要自己的收口：读它的四个局外机制（离线产出 / 天赋点 /
     免费洗点 / 剧情 flag）**没有任何一道自己的防线** —— 脏数据漏进来，
     它们会各自安静地算错一个数。 */
  var klp = (got.keepLast && typeof got.keepLast === 'object') ? got.keepLast : {};
  for (var klk in klp) {
    if (!Object.prototype.hasOwnProperty.call(klp, klk)) continue;
    if (!Stronghold.BY_ID[klk]) continue;
    var kv = Math.floor(num(klp[klk]));
    if (kv > 0) data.keepLast[klk] = Math.min(kv, Stronghold.maxLevel(klk));
  }
  // 工坊（经营场景的产线）：与据点同一套夹取，但多一层 —— **建造顺序**也要恢复，
  // 因为相邻组合靠它判定。顺序丢了不是"少个字段"，而是**静默把组合拆了**：
  // 界面上设施都还在、等级也对，可「淬火」这类加成凭空消失。
  // 两道防线：① 只收真的建了的设施；② 每项只收一次（坏档里可能有重复）。
  var cg = (got.camp && typeof got.camp === 'object') ? got.camp : {};
  for (var cid in cg) {
    if (!Object.prototype.hasOwnProperty.call(cg, cid)) continue;
    if (!Camp.BY_ID[cid]) continue;
    var clv = Math.floor(num(cg[cid]));
    if (clv > 0) data.camp[cid] = Math.min(clv, Camp.maxLevel(cid));
  }
  var crow = Array.isArray(got.campRow) ? got.campRow : [];
  for (var cri = 0; cri < crow.length; cri++) {
    var rid = crow[cri];
    if (typeof rid !== 'string' || !data.camp[rid] || data.campRow.indexOf(rid) >= 0) continue;
    data.campRow.push(rid);
  }
  // 老档没有 campRow（或者顺序不全）：按设施表顺序补一份。
  // **补一份**而不是丢弃整座工坊 —— 组合会按声明表顺序重算，而不是静默消失。
  for (var cfid in data.camp) {
    if (Object.prototype.hasOwnProperty.call(data.camp, cfid) && data.campRow.indexOf(cfid) < 0) {
      data.campRow.push(cfid);
    }
  }
  // 剧情进度：**逐表校验**（认不出的 id 一律丢掉）
  // 这条防线比别的字段更要紧：`said` 里混进一个拼错的台词 id 会让"这句话说过了"
  // 永远不成立（或者反过来，把该说的吞掉），而界面上看不出任何异常。
  var sp = (got.story && typeof got.story === 'object') ? got.story : {};
  data.story = {
    runs: Math.max(0, Math.floor(num(sp.runs))),
    wins: Math.max(0, Math.floor(num(sp.wins))),
    bestFloor: Math.max(0, Math.floor(num(sp.bestFloor))),
    secrets: Math.max(0, Math.floor(num(sp.secrets))),
    bosses: onlyKnown(sp.bosses, Object.keys(Story.BOSS_FRAGMENT)),
    fragments: onlyKnown(sp.fragments, Story.FRAGMENTS.map(function (f) { return f.id; })),
    said: onlyKnown(sp.said, Story.LINES.map(function (l) { return l.id; })),
    endings: onlyKnown(sp.endings, Story.ENDINGS.map(function (e) { return e.id; })),
    events: pick(sp.events, function (v) { return v === true; })
  };

  // 首局引导：只收**表里真有的**提示 id（拼错的 id 会让"这条说过了"永远不成立，
  // 于是玩家每次开新档都再被同一句糊一次脸 —— 与 `said` 那条防线同一个理由）
  data.tutorialSeen = onlyKnown(got.tutorialSeen,
    Tutorial.LIST.map(function (h) { return h.id; }));
  Tutorial.hydrate(data.tutorialSeen);

  // 上次见面：夹在合理范围内（未来的时间戳一律当"刚刚"）
  var seen = num(got.lastSeen);
  data.lastSeen = (seen > 0 && seen <= Date.now() + 60000) ? Math.floor(seen) : 0;

  return { loaded: true, discarded: false, reason: null };
};

/** 读一批"按时间键存的一局最好成绩"（每日 / 每周共用；只收合法的键） */
function readRunRecords(src, keyRe) {
  var out: Record<string, any> = {};
  var dl = (src && typeof src === 'object') ? src : {};
  for (var dk in dl) {
    if (!Object.prototype.hasOwnProperty.call(dl, dk)) continue;
    if (!keyRe.test(dk)) continue;
    var dv = dl[dk];
    if (!dv || typeof dv !== 'object') continue;
    out[dk] = {
      key: dk,
      seed: num(dv.seed) >>> 0,
      char: typeof dv.char === 'string' ? dv.char : '',
      danger: Math.max(0, Math.min(Danger.MAX, Math.floor(num(dv.danger)))),
      wave: Math.max(0, Math.floor(num(dv.wave))),
      kills: Math.max(0, Math.floor(num(dv.kills))),
      level: Math.max(0, Math.floor(num(dv.level))),
      win: dv.win === true,
      score: Math.max(0, Math.floor(num(dv.score))),
      at: num(dv.at),
      frames: Math.max(0, Math.floor(num(dv.frames)))
    };
  }
  return out;
}

function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

/** 只保留"表里真有"的那些键（坏档防线；剧情那边尤其怕拼错的 id） */
function onlyKnown(bag, ids) {
  var out: Record<string, boolean> = {};
  if (!bag || typeof bag !== 'object') return out;
  var known: Record<string, boolean> = Object.create(null);
  for (var i = 0; i < ids.length; i++) known[ids[i]] = true;
  for (var k in bag) {
    if (!Object.prototype.hasOwnProperty.call(bag, k)) continue;
    if (bag[k] === true && known[k]) out[k] = true;
  }
  return out;
}

/**
 * 过滤技能构筑：只留下**这个角色真的能打**的卡与选项。
 * 与 `cleanTalents` 同一套路、同一理由 —— 坏档 / 改过技能表 / 换角色之后，
 * 残留的脏 id 会静默影响战斗（"这一局多了一个不存在的技能"）。
 * 额外的两条（技能构筑特有的）：
 *   · 一张卡只留**第一次**打过的那个。规则是"一张卡只打一次"，而坏档里可能有
 *     同一张卡的两条记录 —— 留着的话折叠取第一条、界面显示两条，
 *     玩家看到的与他实际拥有的不是一回事（这类"界面与实现不一致"最难查）
 *   · 判据走 `Skills.canPick`，**不在这里重写一遍**：两处判据迟早分叉，
 *     而分叉的表现是"界面允许打、折叠时忽略它"
 */
function cleanSkillBuild(charId, list) {
  var out = [];
  if (!list || !list.length) return out;
  if (!SkillsRef || !SkillsRef.treeFor(charId)) return out;
  var seenCard: Record<string, boolean> = Object.create(null);
  for (var i = 0; i < list.length; i++) {
    var row = list[i];
    if (!row || typeof row !== 'object') continue;
    var card = String(row.card || '');
    var opt = String(row.option || '');
    if (!card || !opt || seenCard[card]) continue;
    if (!SkillsRef.canPick(charId, card, opt, out).ok) continue;
    seenCard[card] = true;
    out.push({ card: card, option: opt });
  }
  return out;
}

/**
 * 过滤已点天赋：只留下**这个角色可见**且真实存在的节点，并去重。
 * 坏档 / 改过天赋表 / 换了角色之后，残留的脏 id 不该继续生效
 * （它们会静默影响开局条件 —— 那是最难查的一类问题）。
 */
function cleanTalents(charId, list) {
  var out = [];
  if (!list || !list.length) return out;
  var visible: Record<string, boolean> = Object.create(null);
  var vis = Talent.visibleFor(charId);
  for (var i = 0; i < vis.length; i++) visible[vis[i].id] = true;
  for (i = 0; i < list.length; i++) {
    var id = list[i];
    if (typeof id !== 'string' || !visible[id]) continue;
    if (out.indexOf(id) >= 0) continue;
    out.push(id);
  }
  return out;
}

/** 只保留通过 check 的键（未知键与坏值一律丢弃，而不是原样带进内存） */
function pick(obj, check) {
  var out: Record<string, any> = {};
  if (!obj || typeof obj !== 'object') return out;
  for (var k in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
    var v = check(obj[k]);
    if (v !== false) out[k] = v;
  }
  return out;
}

/** 存盘；返回是否成功（失败不影响内存里的状态） */
Profile.save = function () {
  data.updatedAt = Date.now();
  writeOk = Slots.writeJSON(Storage.KEYS.profile, env.wrap('profile', data)).ok;
  if (!writeOk) env.note('写入失败：' + Storage.lastError());
  return writeOk;
};

Profile.init = function () {
  var r = Profile.load();
  /* ⚠ **只有"真的没有档案"才写默认档**（`discarded:false` 那一支）。
     这一行原先是 `if (!r.loaded) Profile.save()` —— 把两种完全不同的情况当成一种：

       · 盘上没有档案（首次启动）      → 当然要落一份默认档
       · 盘上有档案但**被拒**（坏 JSON / 版本比当前客户端新）
                                       → **绝不能覆盖它**

     第二种情况的代价是**不可恢复的进度清零**：玩家用新版玩过之后回滚到旧客户端，
     旧客户端判定"版本太新"→ 立刻写一份空白档盖掉真档案。
     `.bak` 救不了这件事：`getJSONSafe` 只在 **JSON 解析失败**时回退
     （`storage.ts`），从不对"信封拒绝"回退；而 `.bak` 里是同版本的档，同样会被拒。
     结果是进度静默消失，只有 console 里一行字（玩家看不到）。

     现在被拒时**什么都不写**：盘上留着原档案，玩家升级回新版就能继续玩。
     调用方（`main.ts` 的 boot）会把 `reason` 抬到界面上。 */
  if (!r.loaded && !r.discarded) Profile.save();
  return r;
};

Profile.loadedFrom = function () { return loadedFrom; };
Profile.lastError = function () { return env.lastError(); };
Profile.writeOk = function () { return writeOk; };
/** 只读快照（界面用；改状态请走下面的语义操作） */
/* =========================================================
   技能构筑（**角色身份**，与天赋那份"局外成长"分开记账）
   ---------------------------------------------------------
   为什么不塞进 `talents` 那个数组：
     · 天赋是"点多点少"（一个扁平集合），技能构筑是"每张卡选了一个"
       （集合里还要记住选的是**哪一个**）—— 两种形状，硬塞会把两边都读得很难看
     · 两者的**重置代价**不同：技能构筑免费重打，天赋要洗点
   ========================================================= */
/** 某个角色的技能构筑（打过的卡） */
Profile.skillBuild = function (charId) {
  return Profile.perChar(charId).skillBuild || [];
};

/**
 * 打一张卡。
 * @returns { ok, reason }
 * 校验全在 `Skills.canPick` 里（模拟层与档案层共用同一份判据）——
 * 档案层只负责"记账"，规则仍然只有一处实现。
 */
Profile.pickSkillCard = function (charId, cardId, optionId) {
  if (!Chars.BY_ID[charId]) return { ok: false, reason: '没有这个角色' };
  var cur = Profile.skillBuild(charId);
  if (!SkillsRef) return { ok: false, reason: '技能表还没接上（启动顺序问题）' };
  var can = SkillsRef.canPick(charId, cardId, optionId, cur);
  if (!can.ok) return can;
  var rec = recordFor(charId);
  if (!rec.skillBuild) rec.skillBuild = [];
  rec.skillBuild.push({ card: cardId, option: optionId });
  data.updatedAt = Date.now();
  Profile.save();
  return { ok: true, reason: '' };
};

/**
 * 重打技能构筑（**免费**）。
 * 为什么免费而天赋要洗点：技能构筑管的是"这一局怎么打"，与数值成长无关；
 * 收钱只会让玩家不敢试 —— 而"试不同构筑"正是这个系统存在的意义。
 */
Profile.resetSkillBuild = function (charId) {
  if (!Chars.BY_ID[charId]) return false;
  var rec = recordFor(charId);
  rec.skillBuild = [];
  data.updatedAt = Date.now();
  Profile.save();
  return true;
};

/** 打过的卡 → 模拟层认识的技能载荷（**唯一出口**：界面与战斗都走它） */
Profile.skillsFor = function (charId) {
  if (!SkillsRef) return { slots: [], runes: [], mods: {}, char: String(charId || '') };
  return SkillsRef.fold(charId, Profile.skillBuild(charId));
};


/* =========================================================
   2b. **存档角色**（R50：选存档 / 捏人）
   ---------------------------------------------------------
   一份存档 = 一个槽位的一份档案 = **一个人**。所以键是槽位号：
     · `Slots.current()` 是唯一的那个槽位（它的键变换在 `slots.ts` 里）
     · 换槽位之后 `Profile.load()` 重读，`character()` 自然答的是那一档的人

   ⚠ **它是"选择存档"那一步唯一可靠的判据**：
   `Slots.used()` 只看"这个槽位有没有写过任何一份键"—— 而设置里随手切一下
   槽位、或某一局写到一半，它就会变真。所以界面不许用它判"这是新档吗"。
   ========================================================= */
function slotKeyOfCurrent() { return String(Slots.current()); }

/** 当前槽位的那个人（没有就是 null —— 这就是"新档 / 老档"的判据） */
Profile.character = function () {
  var k = slotKeyOfCurrent();
  var c = data.characters[k];
  return (c && c.charId) ? c : null;
};
Profile.hasCharacter = function () { return !!Profile.character(); };

/**
 * **把这个档里的人拿掉**（R50 的「返回」要撤回一个刚建起来、还没出发的人）。
 *
 * ⚠ 只删 `characters` 那一格、**不碰进度** —— 这是它与 `clear()` / `reset()`
 *   的根本区别：玩家点进捏人页看了看再退出来，不该顺手清掉这个档的孢子与图鉴。
 *
 * ⚠ 它**必须落盘**：`Profile.load()` 会拿存储里那一份覆盖内存，
 *   所以"只清内存"在换一次槽位之后会复活（实测踩过）。
 */
Profile.dropCharacter = function () {
  var k = slotKeyOfCurrent();
  if (!data.characters[k]) return false;
  delete data.characters[k];
  Profile.save();
  return true;
};

/**
 * 建一个人（捏人页的"确定"走它）。
 * @param charId 初始职业；缺省时用 `raw.charId`，再缺省用 `ranger`
 * @returns 归一之后的形状（写盘失败也返回它 —— 内存里玩家确实已经建好了人）
 */
Profile.saveCharacter = function (raw, charId) {
  var c = Character.create(charId || (raw && (raw as { charId?: string }).charId) || 'ranger', raw);
  data.characters[slotKeyOfCurrent()] = c;
  Profile.save();
  return c;
};

/**
 * 局部更新（名字 / 外观 / 职业 / 入门三选）。
 * `null` 或 `undefined` = **不改这一项**（与"改成空"是两件事：
 * 改名字传空串的语义是"落回缺省名"，由 `Character.normalize` 决定）。
 */
Profile.setCharacterMeta = function (patch) {
  var cur = Profile.character();
  if (!cur) return null;
  var p = patch || {};
  var raw: Record<string, unknown> = {
    charId: p.charId ? String(p.charId) : cur.charId,
    name: p.name === undefined || p.name === null ? cur.name : p.name,
    look: {
      palette: (p.look && p.look.palette) ? p.look.palette : cur.look.palette,
      face: (p.look && p.look.face) ? p.look.face : cur.look.face,
      accessory: (p.look && p.look.accessory) ? p.look.accessory : cur.look.accessory
    },
    init: {
      entry: {
        skill: (p.entry && p.entry.skill) ? p.entry.skill : cur.init.entry.skill,
        stat: (p.entry && p.entry.stat) ? p.entry.stat : cur.init.entry.stat,
        talent: (p.entry && p.entry.talent) ? p.entry.talent : cur.init.entry.talent
      }
    }
  };
  var next = Character.normalize(raw);
  data.characters[slotKeyOfCurrent()] = next;
  Profile.save();
  return next;
};

/** 存档角色 + 职业本色 → 渲染层要的三样（**外观唯一的分派处**）—— 渲染层唯一的取色口 */
Profile.renderLookOf = function (charDef) {
  return Character.renderLook(Profile.character(), charDef);
};

/**
 * **捏人页要画的三列**（技能 / 属性 / 天赋各一档，每档给什么、选中的是哪个）。
 *
 * 为什么不给界面 `Openings.COLS` 让它自己拼：那一列里"选中的是哪一档"要读
 * **当前存档角色**，而那是本模块的事。界面拿到的应当是一份**已经拼好的视图**
 * （与 `Profile.craftOptions` / `Profile.creationOptions` 同一个范式）。
 */
Profile.creationOptions = function () {
  var me = Profile.character();
  var picked = Openings.resolve(me && me.init ? me.init.entry : null);
  return Openings.COLS.map(function (c) {
    return {
      key: c.key, name: c.name, note: c.note,
      list: c.list.map(function (d) {
        return {
          id: d.id, name: d.name, note: d.note,
          lines: Openings.lines(d),
          picked: picked[c.key] === d.id
        };
      })
    };
  });
};

Profile.snapshot = function () {
  return {
    /** 养成代币（`孢子` 与 `合金` 合并之后的唯一余额） */
    growth: data.growth,
    core: data.core,
    forge: Object.keys(data.forge),
    unlocked: Object.keys(data.unlocked),
    codex: copyOf(data.codex),
    done: Object.keys(data.done),
    perChar: copyOf(data.perChar),
    /* **存档角色**（R50）：槽位号 -> "这个档那个人"。放进快照是因为界面
       （选存档那一屏）要一次读全三个槽位，而 `character()` 只答当前槽位。 */
    characters: copyOf(data.characters),
    daily: copyOf(data.daily),
    season: copyOf(data.season),
    keep: copyOf(data.keep),
    /* **据点快照**（上一局盖到哪了）—— 离线产出、天赋点、免费洗点、
       剧情 flag 都跟着它走（据点本身住在局内 `S.keep`）。 */
    keepLast: copyOf(data.keepLast),
    /* 首局引导的记录：**放进快照**是因为"哪些提示说过了"要能被界面与测试看见
       （`test/tutorial.mjs` 用它验"换档之后提示行为跟着哪份档走"）。
       快照是只读副本，改它不影响存档 —— 与其它字段同一个约定。 */
    tutorialSeen: copyOf(data.tutorialSeen),
    story: copyOf(data.story),
    lastSeen: data.lastSeen,
    updatedAt: data.updatedAt
  };
};
function copyOf(o) {
  var out: Record<string, any> = {};
  for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) out[k] = o[k];
  return out;
}

/* =========================================================
   3. 解锁
   ========================================================= */
Profile.isUnlocked = function (family, id) { return data.unlocked[key(family, id)] === true; };
/** 解锁；返回"这次真的解锁了"（重复调用不会重复报告，界面就不用去重） */
Profile.unlock = function (family, id) {
  var k = key(family, id);
  if (data.unlocked[k]) return false;
  data.unlocked[k] = true;
  Profile.save();
  return true;
};
/** 某个家族里已解锁的 id（商店/选人按它过滤） */
Profile.unlockedIds = function (family) {
  var pre = family + ':';
  var out = [];
  for (var k in data.unlocked) {
    if (Object.prototype.hasOwnProperty.call(data.unlocked, k) && k.indexOf(pre) === 0) {
      out.push(k.slice(pre.length));
    }
  }
  return out;
};

/* =========================================================
   4. 图鉴（三态）
   ========================================================= */
Profile.codexLevel = function (family, id) { return data.codex[key(family, id)] || 0; };
/**
 * 点亮图鉴。**只升不降**：一局里先"用过"再"满级过"是正常的，
 * 而下一局只"见过"不该把记录打回去。
 */
Profile.markCodex = function (family, id, level) {
  var k = key(family, id);
  var cur = data.codex[k] || 0;
  var want = Math.max(CODEX_SEEN, Math.min(CODEX_MASTERED, Math.floor(num(level))));
  if (want <= cur) return false;
  data.codex[k] = want;
  return true;
};
/** 某家族的点亮进度，用于界面显示"23 件里点亮了几件" */
Profile.codexStats = function (family) {
  var ids = Registry.ids(family);
  var seen = 0, used = 0, mastered = 0;
  for (var i = 0; i < ids.length; i++) {
    var lv = Profile.codexLevel(family, ids[i]);
    if (lv >= CODEX_SEEN) seen++;
    if (lv >= CODEX_USED) used++;
    if (lv >= CODEX_MASTERED) mastered++;
  }
  return { total: ids.length, seen: seen, used: used, mastered: mastered };
};
Profile.CODEX_SEEN = CODEX_SEEN;
Profile.CODEX_USED = CODEX_USED;
Profile.CODEX_MASTERED = CODEX_MASTERED;

/* =========================================================
   5. 孢子（局外货币）
   ========================================================= */
/**
 * 一局折算多少孢子。刻意让"波次"是主项 —— 它奖励的是"打得更久"，
 * 而不是"刷得快"；同时保留一点击杀与两种货币项，让不同打法都有收益。
 * 这是**局外货币**：不进局内经济，所以不会让某一局变简单。
 *
 * ⚠ 这里原先只读 `run.scrap`（**废料**）—— 而它的旧注释、`economy.ts` 的
 * `spores` 那一档、以及 `talents.ts` 对 `waveIncome` 的说明都写着"材料"。
 * 两根线分开之后这个分叉变得要紧：材料是**制造业的本钱**、废料是**商店的本钱**，
 * 只读废料会让"经营流攒下的那一半收益"在结算里凭空消失
 * （它在 `RunSummary` 里叫 `materials`，早就报出来了，只是没人读）。
 * 现在两根线都算：废料 /40、材料 /**10** —— 材料更贵。这个系数（/10）是**实测定出来的**：
 * `tools/balance.mjs talents` 显示经济流的材料是战斗流的 1.1 倍（158.8 vs 144）
 * 而波次只有 0.64 倍（4.8 vs 7.5）。系数太小（原先 /20）时"打得更深"在结算里
 * 压过"打得更富"，于是**战斗流同时赢下战斗轴与局外轴** —— 那正是
 * "经营天赋树没有意义"的数学形式。定在 /10 时两边的局外产出落在同一档
 * （≈34 vs ≈34 孢子），两条轴各自有人赢。
 * 缺字段（旧档 / 别处造的 summary）按 0。
 */
/* =========================================================
   **养成代币的收入**（合并之后只剩一个公式，R43）
   ---------------------------------------------------------
   它以前是两条：`孢子`（打得深：波次 · 击杀 · 废料 · 材料）与
   `合金`（合成 + 每次结算的基础产出）。合并之后**相加** —— 少算任何一条
   都等于把玩家的一笔收入吞掉。

   ⚠ **两条来源都产在战斗动作上**，而 v3 §5.2 的三条边里**没有"战斗 → 养成"**：
   战斗只能喂经营（核心素材 A），经营再喂养成（核心素材 B）。
   所以这两个产出点**都需要搬进养成模块内部** —— 那是 **M3** 的工作。
   本轮只做"两笔钱合成一笔"，不动收入来源。
   ========================================================= */
/** 这一局进账多少养成代币（两条来源之和） */
Profile.growthForRun = function (run, mods) {
  return Profile.sporesForRun(run) + Profile.alloyForRun(run, mods);
};
Profile.sporesForRun = function (run) {
  if (!run) return 0;
  var wave = Math.max(0, num(run.wave));
  var kills = Math.max(0, num(run.kills));
  var scrap = Math.max(0, num(run.scrap));
  var mats = Math.max(0, num(run.materials));
  return Math.floor(wave * 2 + kills / 25 + scrap / 40 + mats / 10 + (run.win ? 25 : 0));
};


/* =========================================================
   合金与图纸工坊（局外第三条腿）
   ---------------------------------------------------------
   合金的**两个**来源都写在这里，别处不许再加：
     · 局内合成（`run.alloy`，在 game.ts 里按结果档位累加）
     · 每次结算的基础产出 `3 + 波次/3` —— 这一条是"够得着"的保证：
       一次都没合成的局也在推进，否则工坊对新手等于不存在
       （参照 Dead Cells：细胞每局都给，只是打得深给得多）。
   结算倍率（熔炉）只放大**结算总额**，所以"合得多"永远比"点熔炉"更划算。
   ========================================================= */
Profile.alloyForRun = function (run, mods) {
  if (!run) return 0;
  var wave = Math.max(0, num(run.wave));
  var base = 3 + Math.floor(wave / 3);
  var fromCombine = Math.max(0, Math.round(num(run.alloy)));
  /* ⚠ **图纸的修正当参数收**（家法）：图纸现在是**局内**的（M1），
     而 `Profile` 在 `game.ts` 下面、读不到会话。以前这里读 `Profile.forgeMods()`
     ——账号那一份现在是**空的**，于是"熔炉"的加成永远不生效（一个安静的失效）。 */
  var mul = 1 + Math.max(0, num(mods && mods.alloyMul));
  return Math.round((base + fromCombine) * mul);
};
/* =========================================================
   **养成代币（`growth`）：唯一的三个出口**
   ---------------------------------------------------------
   它以前是两笔钱（孢子 / 合金），各有一组三个出口。合并之后只剩这一组 ——
   见 `blank()` 里那段说明（v3 §5.1 只允许 3 个模块代币）。
   ========================================================= */
/** 现在的养成代币余额 */
Profile.growth = function () { return data.growth; };
/** 进养成代币；不够就**不扣**并返回 false（与 `spendCore` 同一纪律） */
Profile.spendGrowth = function (n) {
  var cost = Math.max(0, Math.floor(num(n)));
  if (cost <= 0) return true;
  if (data.growth < cost) return false;
  data.growth -= cost;
  Profile.save();
  return true;
};
Profile.addGrowth = function (n) {
  var add = Math.max(0, Math.floor(num(n)));
  if (!add) return data.growth;
  data.growth += add;
  Profile.save();
  return data.growth;
};

/* ---- 材料（`economy.ts` 的 bridge 那一档，**只供经营**）----
   它是**唯一**一笔"从局内带出来"的钱：局内刷怪攒下的那个数
   （`stats_total.scrap`）在结算时整笔进钱包，之后只在据点里花。

   为什么用 `wallet.material` 而不是顶层一个 `material`：
   顶层那三笔是"结算按公式给的奖励"，而这一笔是"玩家打出来的那个数" ——
   两者的来源性质不同，混在一起以后就说不清"这个数是怎么来的"。
   也正因为它是带出来的，它**不属于任何一局**：`applyRun` 负责入账，
   `keepBuy` 负责出账。 */
/* =========================================================
   **材料（全局货币）已经搬进局内**（M1，2026-09）
   ---------------------------------------------------------
   下面这三个出口只剩**一件事要做：给老档当迁移来源**。
   设计上下文 v3 §5.1 + §二：材料"三模块通用"且三个模块**全在局内**
   ⇒ 它是局内货币（`S.material`），**不跨局**。

   ⚠ 所以 `Profile.addMaterial` **没有任何生产调用点**了 —— 而门 `drift`
   的判据 J（入账只许一个出口）仍然盯着它：调用点一旦长回来就报红。
   判据 I（M1 迁移预算）则盯着"还有多少处直接读账号"。
   ========================================================= */
/** **只读**：账号里那一笔（老档的余额；新档永远是 0）。生产/消费都在局内。 */
Profile.material = function () { return num(data.wallet && data.wallet.material); };
Profile.addMaterial = function (n) {
  var add = Math.max(0, Math.floor(num(n)));
  if (!add) return Profile.material();
  if (!data.wallet) data.wallet = { material: 0 };
  data.wallet.material = Profile.material() + add;
  Profile.save();
  return data.wallet.material;
};
/** 花材料；不够就**不扣**并返回 false（调用方据此拒绝） */
Profile.spendMaterial = function (n) {
  var cost = Math.max(0, Math.floor(num(n)));
  if (cost <= 0) return true;
  if (Profile.material() < cost) return false;
  data.wallet.material -= cost;
  Profile.save();
  return true;
};

/* ---- 核心材料（`economy.ts` 的 meta-rare 那一档）----
   两个出口：**读**与**加**。
   **没有 `spendCore`**：它一度存在，但全仓一个调用点都没有 ——
   一个"花了核心材料"的公开方法躺在那里，而没有任何地方花过它，
   于是 `economy.ts` 里写的 `core → 经营 + 养成` 在玩家那一侧是**假的**
   （数字只涨不花）。现在两个花钱的点（`keepBuy` / `forgeNode`）各自
   在自己的账里扣 —— 它们本来就要一起 `Profile.save()`，
   现在那个"唯一的调用点"**真的出现了**：`Game.keepBuy` 在局内扣材料、
 而核心材料还住在账号里（它是战斗 → 经营的核心素材，M4 才搬进局内），
 所以那一笔只能从这里扣。方法加回来 —— 这次它**有**调用点。
 之前那句"没有 spendCore"的结论只在当时成立，不是永久结论。 */
Profile.core = function () { return data.core; };
/** 花核心材料；不够就**不扣**并返回 false（与 `spendMaterial` 同一纪律） */
Profile.spendCore = function (n) {
  var cost = Math.max(0, Math.floor(num(n)));
  if (cost <= 0) return true;
  if (data.core < cost) return false;
  data.core -= cost;
  Profile.save();
  return true;
};
Profile.addCore = function (n) {
  var add = Math.max(0, Math.floor(num(n)));
  if (!add) return data.core;
  data.core += add;
  Profile.save();
  return data.core;
};

/** 已解锁的图纸（**数组**：存档、开局修正、界面都用它） */
Profile.forgeOwned = function () {
  var out = [];
  for (var k in data.forge) if (Object.prototype.hasOwnProperty.call(data.forge, k) && data.forge[k] === true) out.push(k);
  return out;
};
Profile.isForged = function (id) { return data.forge[id] === true; };
Profile.canForge = function (id) {
  return Forge.canUnlock(data.forge, id, data.growth, data.core);
};
/**
 * 解锁一张图纸（花合金；顶档那张还要**核心材料**）。规则全在 forge.ts，这里只落账。
 *
 * 核心材料这条线以前是断的：`Profile.spendCore` 定义着但没有调用点，
 * 于是"打 Boss 拿核心材料"在玩家那一侧只涨不花。
 * 现在养成这一侧的落点是"神话图纸"（打开 T5）。
 */
Profile.forgeNode = function (id) {
  var chk = Profile.canForge(id);
  if (!chk.ok) return { ok: false, reason: chk.reason, cost: chk.cost, core: chk.core || 0 };
  data.growth -= chk.cost;
  if (chk.core > 0) data.core -= chk.core;
  data.forge[id] = true;
  Profile.save();
  return { ok: true, reason: '', cost: chk.cost, core: chk.core || 0 };
};
/** 图纸的折叠修正（开局交给 Game.newRun） */
Profile.forgeMods = function () { return Forge.modsFor(data.forge); };

/**
 * 孢子产出倍率的**总量**上限：据点"菌床"（+50% 封顶）与天赋经济节点相加后再封顶。
 * 相加而不是相乘，是让两条路互为**替代** —— 买了菌床，天赋里的孢子节点就便宜了价值，
 * 反过来也一样。这样"复利"不会因为两条线同时存在而失控。
 *
 * 为什么上限是 1.2（而不是更小）：实测（tools/balance.mjs，5 种子 × 无头机器人）里
 * **纯战力流在波次、材料、孢子上全都领先** —— 因为材料主要来自击杀，"更能打"本身就是最好的经济。
 * 所以经济扇区被刻意做成 **meta-forward**：它不承诺这局更强，而是承诺"少打两波、多拿四成孢子"
 * （参照 Dead Cells 的 Gold Reserves / Recycling：那两个节点也不让你更能打，只让你更富）。
 * 要让这条取舍成立，经济流的天赋就必须能在元收益上**超过**战力流 —— 于是上限抬到这里。
 * 它仍然是硬上限：天赋最多 +85%（商人 +25% + 商会 +60%），加据点的 +50% 后封在 1.2。
 */
Profile.SPORE_MUL_CAP = 1.2;
/* addSpores / spendSpores 已经收进 `addGrowth` / `spendGrowth`（R43）。 */

/* =========================================================
   6. 一局结束：并入档案（累计、图鉴、挑战、解锁）
   ========================================================= */
Profile.isDone = function (challengeId) { return data.done[challengeId] === true; };
Profile.doneIds = function () { return Object.keys(data.done); };
Profile.perChar = function (charId) {
  return data.perChar[charId] || {
    runs: 0, kills: 0, materials: 0, bestWave: 0, wins: 0, level: 0, danger: 0,
    points: 0, talents: [], skillBuild: [], respecs: 0
  };
};

/** 拿到（必要时创建）某角色的记录 —— 天赋与技能构筑那几个操作都要写它 */
function recordFor(charId) {
  return data.perChar[charId] || (data.perChar[charId] = {
    runs: 0, kills: 0, materials: 0, bestWave: 0, wins: 0, level: 0, danger: 0,
    points: 0, talents: [], skillBuild: [], respecs: 0
  });
}

/* =========================================================
   3b. 天赋（角色养成）
   ---------------------------------------------------------
   这里只做**账**：累计点数、已点节点、洗点次数。
   "哪些节点合法、成本多少、互斥怎么算"全在 talents.ts（纯数据 + 纯函数），
   开局条件的折叠也在那边 —— profile 不重复实现规则。
   ========================================================= */
Profile.talentPoints = function (charId) { return recordFor(charId).points; };
Profile.talentsOf = function (charId) { return (recordFor(charId).talents || []).slice(); };
Profile.talentSpent = function (charId) {
  var pc = recordFor(charId);
  return Talent.spentOn(pc.talents || [], charId);
};
Profile.talentFree = function (charId) {
  var pc = recordFor(charId);
  return Math.max(0, pc.points - Talent.spentOn(pc.talents || [], charId));
};
/**
 * 开局条件 = 天赋的产物 **+** 据点「靶场」给的那件轮换道具。
 *
 * 为什么"轮换"而不是随机：开局条件要在**建会话之前**算好，而这时还没有本局种子；
 * 用"这个角色打过多少局"当索引，于是：
 *   · 完全确定（同一局的档案算出来永远一样，回放/读档都对得上）
 *   · 但又每局不一样（你不会永远拿到同一件）
 * 拿到的是**已解锁**道具（图鉴里"见过"的）—— 没解锁的东西凭空出现会很出戏。
 */
Profile.openingOf = function (charId) {
  var pc = recordFor(charId);
  var out = Talent.openingFor(charId, pc.talents || []);
  /* **捏人的"入门三选"并进来**（R50）。
     它必须走**这一个**出口，而不是让界面把两份开局条件各传一半 ——
     `Game.newRun` 只收一份 `OpeningLoadout`，而"两份拼起来"正是 R38 那一类
     "同一处开局写了两份"的老毛病。
     折叠规则与天赋同一套：`stats` 相加、`weapons`/`items` 追加、`scrap`/`material` 相加。
     ⚠ 没有存档角色时（老档 / 挑战 / 无头测试）这一节**整个不发生** ——
       于是那些路径的开局条件逐位照旧（行为指纹不变的前提）。 */
  var me = Profile.character();
  if (me && me.charId === charId) {
    var ent = Openings.fold(charId, me.init && me.init.entry);
    var k;
    for (k in ent.stats) {
      if (Object.prototype.hasOwnProperty.call(ent.stats, k)) {
        out.stats[k] = (out.stats[k] || 0) + ent.stats[k];
      }
    }
    for (var w = 0; w < ent.weapons.length; w++) out.weapons.push(ent.weapons[w]);
    for (var it = 0; it < ent.items.length; it++) out.items.push(ent.items[it]);
    out.scrap += ent.scrap;
    out.material = Math.max(0, Math.round((out.material || 0) + (ent.material || 0)));
    /* **交易换到的开局条件**（R41）：与入门三选**同一个出口** ——
       两个都改"开局带什么"，走两条路就是 R38 那种"同一处开局写了两份"。
       它们是上一次结算 `applyRun` 记在这个档里的（见那里的一段说明）。 */
    var sw = me.starterWeapons || [];
    for (var tw = 0; tw < sw.length; tw++) {
      if (out.weapons.indexOf(sw[tw]) < 0) out.weapons.push(sw[tw]);
    }
    var si = me.starterItems || [];
    for (var ti = 0; ti < si.length; ti++) {
      if (out.items.indexOf(si[ti]) < 0) out.items.push(si[ti]);
    }
    out.scrap += Math.max(0, Math.floor(Number(me.starterScrap) || 0));
  }
  var km = Profile.keepMods();
  // 「靶场」：多带 N 件（N 来自据点表）。**按局数轮换**，不掷骰子：
  // 开局条件要在建会话之前算好，那时还没有本局种子。
  var extra = Math.max(0, Math.floor(km.rangeItem || 0));
  if (extra > 0) {
    var pool = Items.LIST.filter(function (d) { return Profile.codexLevel('item', d.id) >= CODEX_SEEN; });
    if (!pool.length) pool = Items.LIST.slice();          // 一件都没见过时退回全表（别让"靶场"变空）
    for (var i = 0; i < extra; i++) {
      var pick = pool[(pc.runs + i) % pool.length];
      if (pick && out.items.indexOf(pick.id) < 0) out.items.push(pick.id);
    }
  }
  return out;
};

Profile.takeTalent = function (charId, nodeId) {
  var pc = recordFor(charId);
  if (!pc.talents) pc.talents = [];
  var chk = Talent.canTake(charId, nodeId, pc.talents, pc.points || 0);
  if (!chk.ok) return chk;
  pc.talents.push(nodeId);
  Profile.save();
  return { ok: true, reason: '', cost: chk.cost };
};

/** 撤销最后点的一个（**免费**）：误点不该被罚，换流派才走洗点 */
Profile.undoTalent = function (charId) {
  var pc = recordFor(charId);
  if (!pc.talents || !pc.talents.length) return false;
  pc.talents.pop();
  Profile.save();
  return true;
};

/**
 * 现在洗一次点要花多少孢子。
 * **UI 与实际扣费必须共用这一个算法** —— 否则「档案馆」加了免费次数之后，
 * 界面还按旧数字显示，玩家看到的和真正扣的对不上（这类错最难查：它不报错）。
 * 据点的贡献是**免费次数**（能力），不是折扣（那是跨柱子的数值穿透，已删）。
 */
Profile.respecCostOf = function (charId) {
  var pc = recordFor(charId);
  var km = Profile.keepMods();
  return Talent.respecCost(pc.respecs || 0, {
    free: Talent.FREE_RESPECS + (km.freeRespecs || 0),
    discount: 0
  });
};

/**
 * 洗点：清空该角色的天赋，把点数还回去。
 * 前几次免费，之后花孢子（"有成本但不痛"—— PoE 社区的结论）。
 *
 * 「档案馆」这条边在这里接上（据点 → 天赋）：
 *   · L1 让洗点**变便宜**（respecDiscount）
 *   · L2 给你更多**免费次数**（freeRespecs）
 * 读的是据点折叠出来的修正，所以天赋那一侧完全不需要认识"据点"。
 * @returns { ok, reason, cost }（cost 是这次花的**材料**）
 *
 * ⚠ **收材料而不是孢子**（用户拍板：经营与养成各花各的钱）。
 * 洗点属于"养成"里的动作，但它的花费落在**材料**上 —— 因为它是
 * "推翻已建好的东西"，而经营正是负责"建"的那一半。这样孢子那笔钱
 * 只剩一个去处（点天赋），两个局外模块不再共用钱包。
 */
Profile.respecTalents = function (charId, mat) {
  var pc = recordFor(charId);
  if (!pc.talents || !pc.talents.length) return { ok: false, reason: '还没点过天赋', cost: 0 };
  var cost = Profile.respecCostOf(charId);
  /* **材料是局内余额**（`S.material`）—— 本模块在 `game.ts` 之下，不能反向 import，
     所以按本仓范式收参数；扣钱在调用方 `Game.respecTalents`。 */
  if (cost > 0 && Math.max(0, Math.floor(Number(mat) || 0)) < cost) {
    return { ok: false, reason: '材料不够（需要 ' + cost + '）', cost: cost };
  }
  pc.talents = [];
  pc.respecs = (pc.respecs || 0) + 1;
  Profile.save();
  return { ok: true, reason: '', cost: cost };
};

/* =========================================================
   **据点快照**（`keepLast`）：账号记一份"据点盖到哪了"
   ---------------------------------------------------------
   为什么需要它：据点住在**局内**（`S.keep`），而有两处**局外**机制要读它：
     · 离线产出（菌床等级）—— `settleOffline`
     · 剧情 flag（`keepClocktower`）—— 施建接进了叙事
   两者都**不允许**反向 import `game.ts`（本模块在它之下），所以由调用方喂进来。

   ⚠ 为什么不只在结算时记：玩家盖完钟楼、**同一局**走到 NPC
   面前就该看到反应 —— 等到结算才变会让"刚盖的东西没人提"。
   所以 `Game.keepBuy` 每买一次就记一次（与 `story.said` 同类：
   账号记录一个成就，不是写回局内状态）。结算时再记一次是保险。
   ========================================================= */
/** 记一份据点快照（只读它的那两处在上面）。空的也记："这一局没盖"也是一个事实。 */
Profile.noteKeep = function (keep) {
  if (!keep || typeof keep !== 'object') return;
  /* **坏档防线**（它以前在 `Profile.keepOwned` 那一侧 —— 据点搬走之后挪到这里）：
     越界等级夹回上限、未知设施丢掉、非正数丢掉。
     为什么必须在这里：快照是**局外机制唯一读得到的据点**，
     脏数据从这里进去，离线产出与天赋点就会跟着算错。 */
  var clean: Record<string, number> = {};
  for (var k in keep) {
    if (!Object.prototype.hasOwnProperty.call(keep, k)) continue;
    var max = Stronghold.maxLevel(k);
    if (!(max > 0)) continue;                       // 未知设施：丢掉
    var v = Math.floor(Number(keep[k]));
    if (!isFinite(v) || v <= 0) continue;           // 负数 / 0 / NaN：丢掉
    clean[k] = Math.min(max, v);                    // 越界：夹回上限
  }
  data.keepLast = clean;
  Profile.save();
};

/** 这个角色现在有几次免费洗点（据点「档案馆」L2 会加） */
Profile.freeRespecsOf = function (charId) {
  void charId;
  return Talent.FREE_RESPECS + (Profile.keepMods().freeRespecs || 0);
};

/** 加天赋点（通关 / 里程碑给的），返回加了多少 */
Profile.addTalentPoints = function (charId, n) {
  var add = Math.max(0, Math.floor(num(n)));
  if (!add || !charId) return 0;
  var pc = recordFor(charId);
  pc.points = Math.max(0, Math.floor(num(pc.points))) + add;
  Profile.save();
  return add;
};

/** 该角色已解锁的最高难度等级（0 = 只有基准难度） */
Profile.dangerOf = function (charId) {
  var pc = data.perChar[charId];
  return pc ? Math.max(0, Math.min(Danger.MAX, Math.floor(num(pc.danger)))) : 0;
};

/** 提高某角色的难度上限；只升不降，超范围夹回。返回是否真的变了 */
Profile.unlockDanger = function (charId, level) {
  if (!charId) return false;
  var pc = data.perChar[charId] || (data.perChar[charId] = {
    runs: 0, kills: 0, materials: 0, bestWave: 0, wins: 0, level: 0, danger: 0
  });
  var want = Math.max(0, Math.min(Danger.MAX, Math.floor(num(level))));
  if (want <= pc.danger) return false;
  pc.danger = want;
  Profile.save();
  return true;
};

/**
 * @param run    本局观察值：{ char, wave, level, kills, materials, damage, taken, healed, packs, win, peaks? }
 * @param totals 并入本局之后的累计（Save.records() 的产物）
 * @returns { spores, completed:[挑战定义], unlocked:[{family,id}], codex }
 */
Profile.applyRun = function (run, totals) {
  var report: ProfileRunReport = {
    /** **养成代币**：角色成长 / NPC 羁绊 / 能力解锁共用这一笔（v3 §5.1） */
    growth: 0, core: 0, material: 0, completed: [], unlocked: [], codex: [], dangerUnlocked: 0, pointsGained: 0,
    story: { fragments: [], endings: [], newBosses: [], secrets: 0, floor: 0 }
  };
  if (!run || !run.char) return report;

  /* **核心材料入档**：这一局打倒了几个 Boss 就给几笔（`game.ts` 的 `CORE_PER_BOSS`）。
     它**不吃孢子倍率**：那一档的设计意图是"每局只有固定几笔"，
     而孢子倍率是"打得深就更多" —— 两者混在一起会让这一档也复利起来。
     （对照：Hades 的 Titan Blood 只能靠"首次通关某个武器"拿，不吃任何加成。） */
  var coreGain = Math.max(0, Math.floor(num(run.coreEarned)));
  if (coreGain > 0) { data.core += coreGain; report.core = coreGain; }

  /* **材料入账**（`economy.ts` 的 bridge 那一档，只供经营）。
     入账的是 `run.materials` = 这一局**真正打到多少材料**
     （`S.materialEarned`，由 `gainMaterial` 一笔笔记的），不是 `run.scrap`。

     ⚠ **这里以前会再加一遍钱 —— 那是一个静默的双重入账，2026-09 修掉。**
     材料在局内 `gainMaterial`（`game.ts` 那个**唯一出口**）里已经
     `Profile.addMaterial(v)` 当场进钱包了，同时还累加 `S.materialEarned`。
     而 `run.materials` **取的就是** `S.materialEarned`（`game.ts:3417`）——
     于是这里再 `addMaterial(matGain)` 等于**每一笔材料都进两次钱包**。
     它不报错、不进任何断言，症状只是"材料总是比打到的多"。

     为什么一直没被发现：**同一个字段名 `materials` 有两套含义** ——
     `challenges.ts` 里 `materials: '本局废料'`（读 `r.scrap`），
     而这里读的是材料。两个含义共用一个名字，谁都没看出它对不上。

     现在这一节**只报数、不入账**（`report.material` 给界面显示"这局带出多少"），
     钱由 `gainMaterial` 一处管。 */
  /* **据点快照**（离线产出读它，见 `blank()` 里 `keepLast` 的说明）。
     截的是"这一局结束时据点盖到哪了"。 */
  if (run.keep && typeof run.keep === 'object') data.keepLast = copyOf(run.keep);   // 同 noteKeep

  /* ---- **NPC 交易换到的东西**（R41）：它们是"下一局的开局条件" ----
     住在这个档的 `CharacterDef.starter*` 里（一份存档 = 一个槽位 = 一个人）。
     与 `keepLast` 同一个位置、同一条理由：结算那一刻是"这一局结束"的边界，
     而这些东西**跨局**。`S.starter*` 每次结算**覆盖**（不是累加）——
     玩家换到的就是"下一局带这些"，打完那一局之后它们已经用掉了。 */
  var meChar = Profile.character();
  if (meChar) {
    var sw = Array.isArray(run.starterWeapons)
      ? run.starterWeapons.filter(function (x) { return typeof x === 'string'; }).slice(0, 8) : [];
    var si = Array.isArray(run.starterItems)
      ? run.starterItems.filter(function (x) { return typeof x === 'string'; }).slice(0, 8) : [];
    var ss = Math.max(0, Math.floor(num(run.starterScrap)));
    /* 只有真的换了东西才动它 —— 没交易过的一局不该把上一次换的清掉 */
    if (sw.length || si.length || ss > 0) {
      data.characters[slotKeyOfCurrent()] = Character.normalize({
        charId: meChar.charId, name: meChar.name, look: meChar.look,
        init: meChar.init, starterWeapons: sw, starterItems: si, starterScrap: ss
      });
    }
  }

  var matGain = Math.max(0, Math.floor(num(run.materials)));
  if (matGain > 0) { report.material = matGain; }

  // 1) 每角色记录（挑战条件里有一类是"用某角色…"，它读的就是这里）
  var pc = recordFor(run.char);
  if (typeof pc.danger !== 'number') pc.danger = 0;
  if (typeof pc.points !== 'number') pc.points = 0;
  if (!pc.talents) pc.talents = [];
  pc.runs += 1;
  pc.kills += Math.max(0, num(run.kills));
  pc.materials += Math.max(0, num(run.materials));
  pc.level = Math.max(pc.level, Math.max(0, num(run.level)));
  pc.bestWave = Math.max(pc.bestWave, Math.max(0, num(run.wave)));
  if (run.win) pc.wins += 1;
  if (typeof pc.danger !== 'number') pc.danger = 0;

  // 1a) 天赋点：通关给 2 + 难度级，另外每跨过 10/15/20 波各给一点
  //     （没通关也有一点进度，否则"打不过"会等于"零成长"）
  //     据点「档案馆」L3 在这里接上：每局额外多给一点（**据点 → 天赋**那条边）。
  //     刻意不做成"直接发一大笔点"—— 通关仍然必须是主要来源，
  //     否则"打通才给点"的稀缺性就没了（DD 的 Guild 也是先降本、再抬上限，不送等级）。
  /* ⚠ **结算不再发天赋点**（M3，2026-09）：它与 `growth` 是**同一个违规** ——
     天赋点的产出也挂在战斗动作上（按通关 / 波次给），而 v3 §5.2 没有
     "战斗 → 养成"这条边。现在天赋**花成长点**（`Game.takeTalent` 走 `growth` 余额），
     而成长点由训练产（`Game.train`）—— 与 v3 §8-3"把 talents 的成长接到 growth 上"一致。
     `Talent.pointsForRun` 留着：它是"这一局打了多少"的度量，平衡工具还在读。 */
  report.pointsGained = 0;

  // 1b) 通关 → 解锁下一级难度（StS 的规则：打赢第 N 级才解锁 N+1）
  if (run.win) {
    var next = Math.min(Danger.MAX, Math.max(0, Math.floor(num(run.danger))) + 1);
    if (next > pc.danger) { pc.danger = next; report.dangerUnlocked = next; }
  }

  // 2) 图鉴（本局用过/满级过的东西）
  var c;
  for (c = 0; c < (run.weaponIds || []).length; c++) {
    if (Profile.markCodex('weapon', run.weaponIds[c], CODEX_USED)) report.codex.push('weapon:' + run.weaponIds[c]);
  }
  for (c = 0; c < (run.itemIds || []).length; c++) {
    if (Profile.markCodex('item', run.itemIds[c], CODEX_USED)) report.codex.push('item:' + run.itemIds[c]);
  }
  for (c = 0; c < (run.masteredWeaponIds || []).length; c++) {
    if (Profile.markCodex('weapon', run.masteredWeaponIds[c], CODEX_MASTERED)) report.codex.push('weapon:' + run.masteredWeaponIds[c]);
  }
  for (c = 0; c < (run.seenItemIds || []).length; c++) {
    if (Profile.markCodex('item', run.seenItemIds[c], CODEX_SEEN)) report.codex.push('item:' + run.seenItemIds[c]);
  }

  /* 3) 孢子。两个来源：**天赋**「商人 / 商会」的经济节点，以及**离线产出**（菌床）。
     据点不再乘孢子了（「菌床」现在只负责"解锁离线产出 + 抬高它的等级"）——
     那一条乘数正是"据点数值穿透"，删掉之后孢子只有一条曲线：打得深 / 点经济天赋。 */
  var talentMul = (run.omods && run.omods.sporeMul) || 0;
  var sporeMul = 1 + Math.min(Profile.SPORE_MUL_CAP, Math.max(0, talentMul));
  /* =========================================================
     **结算不再发养成代币**（M3，2026-09）
     ---------------------------------------------------------
     它以前在这里发两笔：`孢子`（打得深）与 `合金`（合成 + 基础产出）。
     而那两条**都产在战斗动作上** —— v3 §5.2 的三条边是
     **战斗→经营→养成→战斗**，**没有"战斗 → 养成"**。

     现在产出点在 `Game.train`（`training.ts`）：
     **花 `material`（全局货币 = 行动成本）换 `growth`**，在养成模块内部。

     ⚠ 这就是 v3 要的**撞墙**：不训练 → 没有养成代币 → 图纸与天赋都动不了，
       但游戏**没有不让玩家继续**（战斗照打、经营照盖）—— 只是那两条路推不动。

     上面那两条公式（`sporesForRun` / `alloyForRun`）**留着**：它们是"这一局打了多少"的
     度量，结算展示与平衡工具还在读。只是**不再直接发钱**。
     ========================================================= */
  report.growth = 0;

  /* 3b) 合金：来源只有"合成"这条链（局内合成 + 基础产出），倍率来自熔炉。
       它**不**吃孢子那套倍率 —— 两条货币各有各的曲线，能互换就只剩一条了。 */
  /* （合金那条收入已经在上面并进 `report.growth` 了） */

  /* 4) 剧情进度：**先并进档案，再评挑战**。
     顺序不是随意的：隐藏挑战（G5）读的是**跨局的探索计数**
     （发现过几间密室 / 集齐几片记录 / 打倒过几个器官），
     如果先评挑战再并剧情，"这一局刚好凑够 6 间密室"就要等下一局才发奖 —— 差一拍。
     `report.story` 把这一局新拿到的东西交回接入层去弹提示（界面不认识 story 表）。 */
  report.story = foldRunIntoStory(run);

  // 5) 挑战：评估 → 发奖。评估是纯函数（challenges.ts），这里只负责落账
  var storyFlat = {
    secrets: data.story.secrets,
    fragments: Profile.fragmentCount(),
    endings: Profile.endingsSeen().length,
    bosses: Object.keys(data.story.bosses).length,
    bestFloor: data.story.bestFloor
  };
  var ctx = Challenges.context(run, totals || {}, data.perChar, storyFlat);
  var fresh = Challenges.evaluate(ctx, function (id) { return Profile.isDone(id); });
  for (var i = 0; i < fresh.length; i++) {
    data.done[fresh[i].id] = true;
    report.completed.push(fresh[i]);
    for (var u = 0; u < fresh[i].unlock.length; u++) {
      var t = fresh[i].unlock[u];
      if (Profile.unlock(t.family, t.id)) report.unlocked.push({ family: t.family, id: t.id, amount: t.amount });
    }
  }

  Profile.save();
  return report;
};

/**
 * 把一局的观察值并进剧情进度，并把"这一局的来源"换成碎片。
 *
 * 来源与碎片是**多对一**的（story.ts 的 SOURCE_POOLS）：一个来源可以给好几片，
 * 但每片只能给一次 —— 所以"打完四个 Boss"必然给 f01~f04，
 * 而"检查密室"会一片一片地给 f05~f08。深井是通关之后才有的来源。
 */
function foldRunIntoStory(run) {
  var out: ProfileStoryReport = { fragments: [], endings: [], newBosses: [], secrets: 0, floor: 0 };
  var st = data.story;
  st.runs += 1;
  if (run.win) st.wins += 1;
  var fl = Math.max(0, Math.floor(num(run.floor)));
  if (fl > st.bestFloor) st.bestFloor = fl;
  out.floor = fl;

  // (a) Boss：打赢哪一只就给那一片（四个器官各有自己那一片）
  var down = Array.isArray(run.bossesDown) ? run.bossesDown : [];
  for (var i = 0; i < down.length; i++) {
    var bid = down[i];
    if (!Story.BOSS_FRAGMENT[bid]) continue;
    if (st.bosses[bid] !== true) { st.bosses[bid] = true; out.newBosses.push(bid); }
    var fr = Profile.awardFragment('boss:' + bid);
    if (fr) out.fragments.push(fr);
  }
  // (b) 密室：本局发现过几间就换几片（同一来源可以给多片，一片一次）
  var secrets = Math.max(0, Math.floor(num(run.secrets)));
  out.secrets = secrets;
  st.secrets += secrets;
  for (var s = 0; s < secrets; s++) {
    var fs = Profile.awardFragment('secret');
    if (fs) out.fragments.push(fs);
  }
  // (c) 事件房：每个遭遇都算一个来源（见过的记进图鉴；没见过的换一片记录）
  var evs = Array.isArray(run.events) ? run.events : [];
  for (var e = 0; e < evs.length; e++) {
    if (Profile.markEvent(evs[e])) {
      var fe = Profile.awardFragment('event');
      if (fe) out.fragments.push(fe);
    }
  }
  // (d) 深井：到过第 4 层就是"下过深井"（真结局的 flag）
  if (fl > DungeonFloors) {
    var fp = Profile.awardFragment('deeppit');
    if (fp) out.fragments.push(fp);
  }
  // 结局：条件达成即收藏（每局重算一次；列表返回给接入层弹提示）
  out.endings = Profile.endingsSeen();
  return out;
}

/* =========================================================
   7b0. 剧情进度（N2）
   ---------------------------------------------------------
   分工与别的系统一致：**判定在 story.ts（纯函数），落账在这里**。
     · `ctx()` 把档案里的计数与 flag 组成台词条件要的那份输入
     · `linesFor()` / `say()` 保证 once 的台词说过就不再说
     · `award(source)` 把"这一局碰到的来源（Boss / 密室 / 事件 / 深井）"
       换成碎片：**同一个来源只给没拿过的那一片**，给完为止（纯函数挑片）
     · `unlockEndings()` 每次按 ctx 重算结局（结局是"条件达成即收藏"，
       不需要额外记"解锁过"，但记下来界面才好显示"新"）
   ========================================================= */
/** 台词条件要的那份输入（数字 + flag） */
Profile.storyCtx = function () {
  var flags: Record<string, boolean> = Object.create(null);
  /* ⚠ 据点已经搬进局内（`S.keep`），而**叙事 flag 是局外记录**（它跨局）。
     所以读的是"上一局结束时的据点快照" `keepLast` —— 与离线产出同一个来源。
     语义仍然对：玩家"曾经把钟楼盖起来过"，故事就往下走。 */
  flags.keepClocktower = !!(data.keepLast && data.keepLast['clocktower'] > 0);
  flags.sawSecret = data.story.secrets > 0;
  flags.firstWin = data.story.wins > 0;
  flags.deepPit = data.story.bestFloor > DungeonFloors;
  var bosses = 0;
  for (var b in data.story.bosses) if (Object.prototype.hasOwnProperty.call(data.story.bosses, b)) bosses++;
  /* `endings` 读的是**已经记下来的**那几个，而不是现场重算的列表 ——
     重算要走 endingsSeen()，而 endingsSeen() 又需要 ctx，那就成了自递归
     （实测：界面第一次刷新就 Maximum call stack size exceeded）。
     新达成的结局在 applyRun / endingsSeen 里落账，下一句话就能看到它。 */
  var endings = 0;
  for (var e in data.story.endings) if (Object.prototype.hasOwnProperty.call(data.story.endings, e)) endings++;
  return {
    runs: data.story.runs,
    wins: data.story.wins,
    floor: data.story.bestFloor,
    fragments: Profile.fragmentCount(),
    bosses: bosses,
    secrets: data.story.secrets,
    endings: endings,
    flags: flags
  };
};
/** 主线有几层（"下过深井"= 到过比它更深的一层） */
var DungeonFloors = 3;

Profile.fragmentCount = function () {
  var n = 0;
  for (var k in data.story.fragments) if (Object.prototype.hasOwnProperty.call(data.story.fragments, k)) n++;
  return n;
};
Profile.hasFragment = function (id) { return data.story.fragments[id] === true; };
/** 已收集的碎片（按表里的顺序 —— 界面上就是"墙上的第几片"） */
Profile.fragmentsSeen = function () {
  return Story.FRAGMENTS.filter(function (f) { return data.story.fragments[f.id] === true; });
};
/** 已解锁的结局（把"记下来的"与"现在就该给的"合起来，按 order 排） */
Profile.endingsSeen = function () {
  var ctx = Profile.storyCtx();
  var unlocked = Story.endingsFor(ctx);
  var out = [];
  for (var i = 0; i < unlocked.length; i++) {
    if (data.story.endings[unlocked[i].id] !== true) data.story.endings[unlocked[i].id] = true;
    out.push(unlocked[i]);
  }
  // 也把之前记过、但现在条件不满足的（比如 bestFloor 被清过）带出来 —— 收藏不回收
  for (var k in data.story.endings) {
    if (!Object.prototype.hasOwnProperty.call(data.story.endings, k)) continue;
    if (out.some(function (e) { return e.id === k; })) continue;
    var def = null;
    for (var j = 0; j < Story.ENDINGS.length; j++) if (Story.ENDINGS[j].id === k) def = Story.ENDINGS[j];
    if (def) out.push(def);
  }
  return out.sort(function (a, b) { return a.order - b.order; });
};
Profile.hasEnding = function (id) { return data.story.endings[id] === true; };

/** 枢纽：现在能出现的 NPC（没解锁的不出现，而不是灰着） */
Profile.npcsFor = function () { return Story.npcsFor(Profile.storyCtx()); };
/** 枢纽里该出现哪些站点（设施站一直在，NPC 站按解锁） */
Profile.stationsFor = function () { return Story.stationsFor(Profile.storyCtx()); };
/** 某个 NPC 现在能说的话（`said` 过滤掉说过的） */
Profile.linesFor = function (npcId) { return Story.linesFor(npcId, Profile.storyCtx(), data.story.said); };
/** 他说了这一句（once 的从此不再出现） */
Profile.say = function (lineId) {
  if (!lineId || data.story.said[lineId]) return false;
  data.story.said[lineId] = true;
  Profile.save();
  return true;
};
/** 枢纽上有没有"新话"（标题页那个"!"） */
Profile.hasStoryNews = function () { return Story.hasNews(Profile.storyCtx(), data.story.said); };

/* ---- 对话的分支（R41：改造前只有"▽ 继续说"）----
   判定全在 `story.ts`（纯函数：这一句能选哪几个、选完去哪一句），
   这里只把**当前那份 ctx 与 said** 喂进去 —— 与 `linesFor` 同一条纪律。 */
/** 这一句现在能选哪几个（条件不满足的**不出现**） */
Profile.choicesFor = function (line) {
  return Story.choicesOf(line, Profile.storyCtx(), data.story.said);
};
/** 挑了一条选项之后该看哪一句（null = 这次对话结束） */
Profile.branchOf = function (line, choiceId) {
  return Story.branchOf(line, choiceId);
};
/** 这一条台词有没有分支（界面据此决定"继续说"还是"列选项"） */
Profile.hasChoices = function (line) { return Story.hasChoices(line); };

/** 每个 NPC 各有几句新话（界面按它决定要不要画"!"） */
Profile.newsByNpc = function () {
  var out: Record<string, number> = {};
  var list = Profile.npcsFor();
  for (var i = 0; i < list.length; i++) out[list[i].id] = Profile.linesFor(list[i].id).length;
  return out;
};

/**
 * 把一个"来源"换成碎片。**同一个来源只给没拿过的那一片**（纯函数挑片），
 * 拿满了就返回 null —— 于是"检查过的密室一定给东西"与"不会给重复的"同时成立。
 * @returns 拿到的碎片（没得给就 null）
 */
Profile.awardFragment = function (source) {
  var have: string[] = [];
  for (var k in data.story.fragments) if (Object.prototype.hasOwnProperty.call(data.story.fragments, k)) have.push(k);
  var id = Story.fragmentFrom(source, have);
  if (!id) return null;
  data.story.fragments[id] = true;
  // 拿下最后一片 → 真结局条件里的那个数字到了，结局在下次 ctx 重算时自动收藏
  Profile.endingsSeen();
  Profile.save();
  return Story.fragment(id);
};
/** 事件房的遭遇：只记"见过"（图鉴用），重复见不算新 */
Profile.markEvent = function (id) {
  if (!id || data.story.events[id]) return false;
  data.story.events[id] = true;
  Profile.save();
  return true;
};
Profile.eventsSeen = function () {
  var out = [];
  for (var k in data.story.events) if (Object.prototype.hasOwnProperty.call(data.story.events, k)) out.push(k);
  return out.sort();
};
/** 角色那一段"过去"（挺进地牢那套；没写过的角色返回 null） */
Profile.pastOf = function (charId) {
  for (var i = 0; i < Story.PASTS.length; i++) if (Story.PASTS[i].char === charId) return Story.PASTS[i];
  return null;
};
Profile.storySnapshot = function () {
  return {
    runs: data.story.runs, wins: data.story.wins, bestFloor: data.story.bestFloor,
    secrets: data.story.secrets, fragments: Profile.fragmentCount(),
    bosses: Object.keys(data.story.bosses).length,
    endings: Profile.endingsSeen().length,
    said: copyOf(data.story.said), events: Profile.eventsSeen()
  };
};

/* =========================================================
   7b. 每日挑战（当天最好的一局）
   ========================================================= */
Profile.dailyOf = function (key) { return data.daily[key] || null; };
/**
 * 记一局每日挑战的成绩。**只保留当天更好的那一个**：
 * 每日挑战的乐趣是"刷新自己的记录"，而不是"多打几次攒分"。
 * @returns { improved, best, prev }
 */
Profile.recordDaily = function (rec) {
  if (!rec || !rec.key) return { improved: false, best: null, prev: null };
  var prev = data.daily[rec.key] || null;
  var best = Daily.pick(prev, rec);
  var improved = !prev || best !== prev;
  if (improved) {
    data.daily[rec.key] = best;
    Profile.save();
  }
  return { improved: improved, best: best, prev: prev };
};
Profile.dailyKeys = function () { return Object.keys(data.daily).sort(); };

/* =========================================================
   7b2. 每周挑战（与每日同形，只是键是周次）
   ========================================================= */
Profile.seasonOf = function (week) { return data.season[week] || null; };
Profile.recordSeason = function (rec) {
  if (!rec || !rec.key) return { improved: false, best: null, prev: null };
  var prev = data.season[rec.key] || null;
  var best = Season.pick(prev, rec);
  var improved = !prev || best !== prev;
  if (improved) {
    data.season[rec.key] = best;
    Profile.save();
  }
  return { improved: improved, best: best, prev: prev };
};
Profile.seasonKeys = function () { return Object.keys(data.season).sort(); };

/* =========================================================
   7b3. 离线产出（可选档）
   ---------------------------------------------------------
   状态只有"上次见面"一个时间戳；该给多少由 offline.ts 的纯函数算。
   两条自我约束写在这里：
     · **结算即前进** —— 结算时立刻把 lastSeen 推到现在，
       所以反复刷新页面不会多拿（每次都要有真实的间隔）
     · 只有买了菌床才有产出（rate 为 0 时直接不给）
   ========================================================= */
Profile.lastSeen = function () { return data.lastSeen; };

/**
 * 结算离线产出。
 * @param now 现在的时间戳（默认 Date.now()；测试要可控）
 * @returns { growth, minutes, capped, reason, sporebed }
 */
Profile.settleOffline = function (now) {
  var t = isFinite(Number(now)) ? Number(now) : Date.now();
  /* 离线等级 = 据点「菌床」的折叠等级（`offlineLevel`）。
     读折叠值而不是设施等级：这样"离线产出"这条能力只有一个来源，
     设施表改了等级数也不会让这里悄悄失效（两边不同步的那种 bug 最难发现）。 */
  /* ⚠ **离线产出按"上一局结束时的据点"算**（M1 第二块，2026-09 —— 见下）。
     据点搬进局内（`S.keep`）之后，`data.keep` 不再被写了，
     所以这里再读 `Profile.keepMods()` 会**永远是 0**（挂多久都不产出）。
     离线产出是**局外**机制，它需要一个局外的来源 —— 那就是 `data.keepLast`：
     每局结算时把这一局的据点快照记下来。 */
  var level = Profile.keepMods().offlineLevel || 0;
  var seen = data.lastSeen;
  var out = { growth: 0, minutes: 0, minutesCounted: 0, capped: false, reason: '第一次见面', sporebed: level };
  if (seen > 0) {
    var r = Offline.settle(t - seen, level);
    out.growth = r.growth;
    out.minutes = r.minutes;
    out.minutesCounted = r.minutesCounted;
    out.capped = r.capped;
    out.reason = r.reason;
  }
  // 结算即前进：无论给没给，都把"上次见面"推到现在
  data.lastSeen = t;
  if (out.growth > 0) {
    data.growth += out.growth;
    Profile.save();
  } else {
    Profile.save();
  }
  return out;
};

/** 手动把"上次见面"推到现在（切后台 / 一局结束时调；不结算） */
Profile.touchSeen = function (now) {
  data.lastSeen = isFinite(Number(now)) ? Number(now) : Date.now();
  Profile.save();
  return data.lastSeen;
};

/* =========================================================
  /* =========================================================
   7c. 据点：**账号侧只剩一个快照视图**（M1 第二块，2026-09）
   ---------------------------------------------------------
   ⚠ 据点本身**已经搬进局内**（`S.keep`，见 `game.ts` 的 `refreshKeepFx`）：
   等级、买入、折叠修正都在会话里，钱是 `S.material`。
   本模块在 `game.ts` **之下**，读不到会话 —— 而下面这几个是**局外**机制：
     · 离线产出（菌床等级 `offlineLevel`）
     · 天赋点数（档案馆 `bonusPoints`）
     · 免费洗点（档案馆 `freeRespecs`）
     · 剧情 flag（钟楼）
   它们真正想问的都是同一个问题：**"上一局把据点盖到哪了"**。
   所以这里统一读 `data.keepLast`（快照），而不是 `data.keep`（那个字段
   从据点搬走之后**再也不被写**，读它只会得到"永远全空"）。
   ========================================================= */
/** 上一局结束时的据点（**快照**；新档是空的） */
Profile.keepLast = function () { return data.keepLast || {}; };
Profile.keepLevel = function (id) { return Stronghold.levelOf(data.keepLast || {}, id); };
Profile.keepOwned = function () {
  var out: Record<string, number> = {};
  var src = data.keepLast || {};
  for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k];
  return out;
};
/** 上一局据点的折叠修正（离线产出 / 天赋点 / 免费洗点 / 剧情 flag 读它） */
Profile.keepMods = function () { return Stronghold.modsFor(data.keepLast || {}); };
Profile.keepInvested = function () { return Stronghold.invested(data.keepLast || {}); };

/* =========================================================
   6b. 工坊（经营场景的产线）—— **跨局**
   ---------------------------------------------------------
   改造前这一整块在**局内会话**里（`game.ts` 的 `S.camp` / `S.campRow` /
   `S.campPoints`），每局从零盖一遍；用户拍板的方向是"营地从局内搬出去"，
   也就是：**设施是账号资产，不是一局的临时工事**。

   三处随之改变的地方，都要说清楚：
     · **钱换了**：从局内的"建材"（每波 +2，结算清零）换成**材料**
       （带得出局的那一笔）。于是"打 → 拿材料 → 造 → 再打"这条循环闭合，
       而材料在**战斗场景里**依然一分不花（花它的地方是经营场景）。
     · **"产线"的含义收了**：改造前一条产线 = "这一波还能再买一次建设"；
       现在 = "**这一局能造几件**"。每波重置（`S.craftUsed` 是局内的）。
     · **摆法不再每局重来**：`campRow` 是长期决定，相邻组合跟着它走。

   规则（售价 / 等级 / 组合 / 折叠 / 封顶）全在 `camp.ts`。
   ⚠ **下面这些访问器已经删掉了**（M1 第三块，2026-09）—— 见紧随其后的说明。
   ========================================================= */
/* =========================================================
   ⚠ **工坊的访问器与买卖已经删掉了**（M1 第三块，2026-09）。
   ---------------------------------------------------------
   它们以前读 `data.camp` / `data.campRow`（账号档案）。
   现在工坊整个搬进了局内（v3 §二："三个模块全在局内"）：
     · 等级与建造顺序住在 `S.camp` / `S.campRow`（会话）
     · 规则仍然是纯函数 `Camp.canBuy/refundOf/effects`（它们本来就收 state）
     · 入口是 `Game.campBuy/campSell`，读出口是 `Game.campOwned/campRow/campFx`

   `data.camp` / `data.campRow` 只保留给**旧档读取**（见 `Profile.load` 里的收口），
   不再被写入。门 `drift` 的判据 I（M1 迁移预算）盯着它不许长回来。
   ========================================================= */

/**
 * 界面要铺的那一屏：每条配方的费用 / 能不能造 / 造不造得起。
 * **不写任何规则** —— 规则全在 `craft.ts`（费用与档位）与 `camp.ts`（省料与抬档）。
 * @param mods 图纸给的制造修正（`Forge.modsFor` 那一份）
 */
Profile.craftOptions = function (mods, mat, fx) {
  /* ⚠ `fx`（工坊折叠效果）与 `mat`（局内材料余额）都是**收进来的**：
     工坊已经搬进局内会话，而本模块在 `game.ts` 之下，读不到它。 */
  fx = fx || Camp.effects({}, []);
  /* 显式标注：`var out = []` 会被推断成 `any[]`，于是这个函数的返回类型丢掉，
     调用方（`game.ts` 的 `craftOptions`）就会拿不到 `kind` 的字面量类型。 */
  var out: Array<{
    id: string; kind: 'weapon' | 'item'; refId: string; name: string; tier: number;
    cost: number; ok: boolean; reason: string; affordable: boolean;
  }> = [];
  for (var i = 0; i < Craft.LIST.length; i++) {
    var r = Craft.LIST[i];
    var chk = Craft.canMake(r, mods);
    var cost = Craft.costOf(r, mods, fx);
    out.push({
      id: r.id, kind: r.kind, refId: r.refId, name: r.name, tier: r.tier,
      cost: cost, ok: chk.ok, reason: chk.reason, affordable: mat >= cost
    });
  }
  return out;
};

/* =========================================================
   ⚠ `Profile.keepBuy` **已经删掉了**（M1 第二块，2026-09）。
   ---------------------------------------------------------
   它以前是"买据点"的唯一入口，而它读的是**账号钱包**里的材料。
   现在据点整个搬进了局内（v3 §二："三个模块全在局内"）：
     · 等级住在 `S.keep`（会话），花的是 `S.material`（局内材料）
     · 规则仍然是纯函数 `Stronghold.canBuy(owned, id, material, core)`
     · 入口是 `Game.keepBuy`（它在 `game.ts`，本模块之上）
     · 核心材料暂时仍从 `data.core` 扣（它还没搬进局内 —— M4 的事）

   为什么**删掉**而不是留着：留一个"还能花账号钱包买据点"的口子，
   就等于留了第二个真相 —— 而那正是这次迁移要拆的东西。
   门 `drift` 的判据 I（M1 迁移预算）会盯着它不许长回来。
   ========================================================= */
/* =========================================================
   8. 清档（设置页的"清空存档"要连它一起清）
   ========================================================= */
/**
 * @param opts.keepCharacter 保留"这个档的那个人"（R50）。
 *
 * ⚠ 为什么需要这个开关：**"清空存档"与"这个档是谁"是两件事**。
 *   `Profile.clear` / `reset` 的语义是"把进度清零、从头开始" ——
 *   玩家的第一直觉里，那个人不是"进度"，是"我建的那个人物"。
 *   改造前没有这个区别，因为**那时候存档里没有人**（选人是每局一次的动作）。
 *
 * ⚠ 更要紧的是**读盘 > 内存**这条纪律：`Profile.load()` 会拿存储里那一份
 *   覆盖内存，所以"清掉内存里的 characters"在换一次槽位之后会**复活**
 *   （那份档的键还在）。要真的清掉，只能像这里一样**清内存 → 立刻落盘**。
 *   实测踩过这个坑：界面上"返回"清掉了内存里的人，切一下槽位他又回来了。
 */
Profile.clear = function (opts) {
  var keep = !!(opts && (opts as { keepCharacter?: boolean }).keepCharacter);
  var keepChar = keep ? copyOf(data.characters) : null;
  data = blank();
  if (keepChar) data.characters = keepChar as Record<string, CharacterDef>;
  loadedFrom = 'defaults';
  return Slots.clear(Storage.KEYS.profile);
};
Profile.reset = function (opts) {
  var keep = !!(opts && (opts as { keepCharacter?: boolean }).keepCharacter);
  var keepChar = keep ? copyOf(data.characters) : null;
  /* ⚠ **先回 0 号槽**：`reset` 的语义是"从头开始"，而它现在会**写盘** ——
     停在 5 号槽上按下它，写出来的就是 5 号槽的空档，而 0 号槽那位玩家的
     进度一点没动（他看到的却是"重置成功"）。这不报错，所以必须显式钉住。
     ⚠ `Slots.select` 会通知订阅者（界面那一份会跟着重读），所以这一句要
       在 `data = blank()` **之前** —— 否则界面读回的是我们已经清掉的那一份。 */
  Slots.select(0);
  data = blank();
  if (keepChar) data.characters = keepChar as Record<string, CharacterDef>;
  Profile.save();
  return Profile.snapshot();
};

/* 首局引导的记录由 Profile 负责落盘（`tutorial.ts` 只发"记录变了"的通知）——
   于是"看完提示"这件事会跟着这一份档走，而不是每开一次浏览器重来一遍。 */
Tutorial.onChanged(function () {
  data.tutorialSeen = Tutorial.snapshot();
  Profile.save();
});

/* =========================================================
   8. 登记进扩展点总账
   ========================================================= */
Registry.family('profileSection', {
  note: '账号档案的字段（哪些是跨局成长）', owner: 'profile.ts',
  values: function () { return PROFILE_SECTIONS.slice(); }
});
Registry.family('codexLevel', {
  note: '图鉴三态', owner: 'profile.ts',
  values: function () { return ['见过', '用过', '满级过']; }
});

/* =========================================================
   9. 定义期自检
   ---------------------------------------------------------
   改造前 `profile.ts` **没有 audit**（据点 / 工坊 / 天赋 / 挑战都各有一条，
   唯独"账号档案本身"没有）。这有真实的代价：`profileSection` 那份清单
   可以随便漂，没有第二处会响 —— 而它正是"哪些字段是跨局的"的**唯一声明**。

   判据只验**表自身**能验的：清单与 `blank()` 的键集合互为镜像。
   "落盘往返对不对"是测试的活（`test/profile.mjs` / `persist.mjs`）。
   ========================================================= */
Profile.audit = function () {
  var problems: string[] = [];
  var declared: Record<string, boolean> = Object.create(null);
  var i;
  /* 与 `Registry.family('profileSection')` 读的是**同一份常量**。
     不从总账读回来：`Registry.info()` 只给 note/owner，**不暴露 values** ——
     想读就得给总账加一个"取家族值域"的 API，那是为了一处自检去动公共接口。 */
  for (i = 0; i < PROFILE_SECTIONS.length; i++) declared[PROFILE_SECTIONS[i]] = true;

  var real = Object.keys(blank());
  for (i = 0; i < real.length; i++) {
    if (!declared[real[i]]) problems.push('字段 ' + real[i] + ' 在档案里，但没登记进 profileSection（清单漏了它）');
  }
  for (i = 0; i < PROFILE_SECTIONS.length; i++) {
    if (real.indexOf(PROFILE_SECTIONS[i]) < 0) problems.push('profileSection 声明了 ' + PROFILE_SECTIONS[i] + '，但档案里没有这个字段（清单写错了）');
  }
  /* 顺序表与状态表不能脱节：`campRow` 里出现没建的设施 → 组合判定会读到幽灵 */
  /* 这是**旧档字段**的自检（`data.camp` / `data.campRow` 现在只用于旧档读取）。
     工坊本身已经搬进局内，它的坏档防线在 `game.ts` 的 `campRow()` 里。 */
  var ghost = (function () {
    var out: string[] = [];
    for (var i = 0; i < data.campRow.length; i++) {
      var id = data.campRow[i];
      if (data.camp[id] > 0 && out.indexOf(id) < 0) out.push(id);
    }
    return out;
  })();
  if (ghost.length !== data.campRow.length) {
    problems.push('campRow 里有 ' + (data.campRow.length - ghost.length) + ' 项不是"真的建了"的设施（相邻组合会按幽灵位置判定）');
  }
  /* **存档角色**（R50）：表里的每一项都必须是"这个档真的有人"，
     而且**必须落在合法槽位内** —— 越界的键永远读不到（`character()` 只查当前槽位），
     于是它会以一个"悄悄占了存档体积、界面上不存在的人"的形式烂在那里。 */
  for (var ck in data.characters) {
    if (!Object.prototype.hasOwnProperty.call(data.characters, ck)) continue;
    var cc = data.characters[ck];
    if (!/^\d+$/.test(ck) || Number(ck) >= Slots.COUNT) {
      problems.push('characters 里有越界的槽位键：' + ck + '（那份档里的人永远读不到）');
    }
    if (!cc || !cc.charId) problems.push('characters.' + ck + ' 没有职业 id（开局会崩在找职业那一步）');
    if (!cc || !cc.name) problems.push('characters.' + ck + ' 没有名字（名牌会是空的）');
    if (cc && (!cc.look || !cc.init || !cc.init.entry)) {
      problems.push('characters.' + ck + ' 缺 look / init（捏人页读到一半会返回 undefined）');
    }
  }
  return {
    ok: problems.length === 0, problems: problems,
    counts: { sections: real.length, campFacilities: Object.keys(data.camp).length, characters: Object.keys(data.characters).length }
  };
};
SelfCheck.register('Profile', Profile.audit);

export { Profile };
