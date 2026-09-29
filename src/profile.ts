/* =========================================================
   profile.ts — 账号级档案（局外成长的地基）

   为什么要有它：改造前持久层只有三把键 —— 设置 / 进行中的一局 / 战绩记录。
   前两个是"这一次会话"的，战绩是**只读的统计**。任何跨局的成长
   （解锁、图鉴、角色养成、据点经营）都缺一个能写的地方。

   它与 records 的分工：
     · `records` 是**只读统计**（最好波次、总击杀）—— 写法是"并入一局"。
     · `profile` 是**可写的账号状态**（解锁、图鉴、孢子、已完成挑战、每角色记录）。
   所以本模块**不自己算累计值**：`applyRun()` 由调用方喂进
   "这一局的观察值 + 并入后的 totals"（main.ts 的接线层负责取，
   与 Save.addRun 的顺序是：先并入 records，再喂给 profile）。

   版本与迁移：用自己的版本号与迁移链（envelope.ts 的工厂），
   只改档案格式时不必让 run/records 跟着跨版本。
   ========================================================= */

import { Challenges } from './challenges.ts';
import { Daily } from './daily.ts';
import { Danger } from './danger.ts';
import { Envelope } from './envelope.ts';
import { Forge } from './forge.ts';
import { Items } from './data_items.ts';
import { Offline } from './offline.ts';
import { Registry } from './registry.ts';
import { Season } from './season.ts';
import { Slots } from './slots.ts';
import { Tutorial } from './tutorial.ts';
import { Storage } from './storage.ts';
import { Story } from './story.ts';
import { Stronghold } from './stronghold.ts';
import { Talent } from './talents.ts';

var Profile = {} as ProfileApi;

var env = Envelope.create({ name: 'profile', version: 1 });

/* =========================================================
   1. 形状
   ========================================================= */
/** 图鉴的三态：见过 / 用过 / 满级过 */
var CODEX_SEEN = 1, CODEX_USED = 2, CODEX_MASTERED = 3;

function blank() {
  return {
    /* **钱包里的钱**（`wallet`）：这些是**跨局**的、并且**从局内带出来的**。
       为什么单独一个子对象而不是铺在顶层：顶层那三笔（spores / alloy / core）是
       "结算后按公式给的奖励"，而钱包里的这一笔是**玩家在局内攒的那个数**
       （`stats_total.scrap` 的累计）—— 它不是算出来的，是打出来的。
       分开之后，"带出去"这件事有一个明确的落点（`applyRun` 里一行），
       而不是散在各处各自加。 */
    wallet: { material: 0 },   // 材料：带出局，只在**经营**里花（盖设施 / 建筑 / 产线）
    spores: 0,          // 局外货币（"孢子"）：**只供养成**（天赋树与洗点）
    /* 局外第二种货币（"合金"）：来源只有**合成**这条链（局内合成 + 每次结算的基础产出），
       只用于图纸工坊。与孢子**互不兑换** —— 两条曲线一旦能互换，就只剩一条曲线了。 */
    alloy: 0,
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
    daily: {},          // 'YYYY-MM-DD' -> 当天最好的一局（见 daily.ts）
    season: {},         // 'YYYY-Www'   -> 当周最好的一局（见 season.ts）
    keep: {},           // 据点设施 -> 等级（跨局永久，花孢子）
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
  data.spores = Math.max(0, Math.floor(num(got.spores)));
  data.alloy = Math.max(0, Math.floor(num(got.alloy)));
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
      respecs: Math.max(0, Math.floor(num(pc[c] && pc[c].respecs)))
    };
  }
  // 每日 / 每周挑战记录：按时间键存"那一期最好的一局"（两者同形，共用一段读取逻辑）
  data.daily = readRunRecords(got.daily, /^\d{4}-\d{2}-\d{2}$/);
  data.season = readRunRecords(got.season, /^\d{4}-W\d{2}$/);

  // 据点：只收真实存在的设施，等级夹回合法范围
  var kp = (got.keep && typeof got.keep === 'object') ? got.keep : {};
  for (var kid in kp) {
    if (!Object.prototype.hasOwnProperty.call(kp, kid)) continue;
    if (!Stronghold.BY_ID[kid]) continue;
    var klv = Math.floor(num(kp[kid]));
    if (klv > 0) data.keep[kid] = Math.min(klv, Stronghold.maxLevel(kid));
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
  if (!r.loaded) Profile.save();      // 首次启动就把默认档案落盘
  return r;
};

Profile.loadedFrom = function () { return loadedFrom; };
Profile.lastError = function () { return env.lastError(); };
Profile.writeOk = function () { return writeOk; };
/** 只读快照（界面用；改状态请走下面的语义操作） */
Profile.snapshot = function () {
  return {
    spores: data.spores,
    alloy: data.alloy,
    core: data.core,
    forge: Object.keys(data.forge),
    unlocked: Object.keys(data.unlocked),
    codex: copyOf(data.codex),
    done: Object.keys(data.done),
    perChar: copyOf(data.perChar),
    daily: copyOf(data.daily),
    season: copyOf(data.season),
    keep: copyOf(data.keep),
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
 * 而不是"刷得快"；同时保留一点击杀与材料项，让不同打法都有收益。
 * 这是**局外货币**：不进局内经济，所以不会让某一局变简单。
 */
Profile.sporesForRun = function (run) {
  if (!run) return 0;
  var wave = Math.max(0, num(run.wave));
  var kills = Math.max(0, num(run.kills));
  var mats = Math.max(0, num(run.scrap));
  return Math.floor(wave * 2 + kills / 25 + mats / 40 + (run.win ? 25 : 0));
};
Profile.spores = function () { return data.spores; };

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
Profile.alloyForRun = function (run) {
  if (!run) return 0;
  var wave = Math.max(0, num(run.wave));
  var base = 3 + Math.floor(wave / 3);
  var fromCombine = Math.max(0, Math.round(num(run.alloy)));
  var mul = 1 + Math.max(0, num(Profile.forgeMods().alloyMul));
  return Math.round((base + fromCombine) * mul);
};
Profile.alloy = function () { return data.alloy; };
Profile.addAlloy = function (n) {
  var add = Math.max(0, Math.floor(num(n)));
  if (!add) return data.alloy;
  data.alloy += add;
  Profile.save();
  return data.alloy;
};

/* ---- 材料（`economy.ts` 的 bridge 那一档，**只供经营**）----
   它是**唯一**一笔"从局内带出来"的钱：局内刷怪攒下的那个数
   （`stats_total.scrap`）在结算时整笔进钱包，之后只在据点里花。

   为什么用 `wallet.material` 而不是顶层一个 `material`：
   顶层那三笔是"结算按公式给的奖励"，而这一笔是"玩家打出来的那个数" ——
   两者的来源性质不同，混在一起以后就说不清"这个数是怎么来的"。
   也正因为它是带出来的，它**不属于任何一局**：`applyRun` 负责入账，
   `keepBuy` 负责出账。 */
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
   拆出一个"只扣钱不保存"的方法只会多一次落盘。 */
Profile.core = function () { return data.core; };Profile.addCore = function (n) {
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
  return Forge.canUnlock(data.forge, id, data.alloy, data.core);
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
  data.alloy -= chk.cost;
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
Profile.addSpores = function (n) {
  var add = Math.max(0, Math.floor(num(n)));
  if (!add) return data.spores;
  data.spores += add;
  Profile.save();
  return data.spores;
};
/** 花孢子；不够就返回 false 且不改状态（调用方负责提示） */
Profile.spendSpores = function (n) {
  var cost = Math.max(0, Math.floor(num(n)));
  if (cost > data.spores) return false;
  data.spores -= cost;
  Profile.save();
  return true;
};

/* =========================================================
   6. 一局结束：并入档案（累计、图鉴、挑战、解锁）
   ========================================================= */
Profile.isDone = function (challengeId) { return data.done[challengeId] === true; };
Profile.doneIds = function () { return Object.keys(data.done); };
Profile.perChar = function (charId) {
  return data.perChar[charId] || {
    runs: 0, kills: 0, materials: 0, bestWave: 0, wins: 0, level: 0, danger: 0,
    points: 0, talents: [], respecs: 0
  };
};

/** 拿到（必要时创建）某角色的记录 —— 天赋那几个操作都要写它 */
function recordFor(charId) {
  return data.perChar[charId] || (data.perChar[charId] = {
    runs: 0, kills: 0, materials: 0, bestWave: 0, wins: 0, level: 0, danger: 0,
    points: 0, talents: [], respecs: 0
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
Profile.respecTalents = function (charId) {
  var pc = recordFor(charId);
  if (!pc.talents || !pc.talents.length) return { ok: false, reason: '还没点过天赋', cost: 0 };
  var cost = Profile.respecCostOf(charId);
  if (cost > 0 && Profile.material() < cost) {
    return { ok: false, reason: '材料不够（需要 ' + cost + '）', cost: cost };
  }
  if (cost > 0) Profile.spendMaterial(cost);
  pc.talents = [];
  pc.respecs = (pc.respecs || 0) + 1;
  Profile.save();
  return { ok: true, reason: '', cost: cost };
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
    spores: 0, alloy: 0, core: 0, material: 0, completed: [], unlocked: [], codex: [], dangerUnlocked: 0, pointsGained: 0,
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
     入账的是 `run.earned` —— 也就是玩家**在局内攒下的那个数**
     （`stats_total.scrap`），不是 `run.scrap`（那是结算时手里还剩多少）。
     这个区分是必须的：手里剩多少取决于他买了多少东西，而"带出去"应当是
     "打出来多少" —— 否则"少买东西"会变成一种攒钱手段，而那是反直觉的。

     **它不吃孢子那套倍率**：孢子代表"打得深"，而材料是"打了多少" ——
     两者混在一起会让经营也复利起来。 */
  var matGain = Math.max(0, Math.floor(num(run.earned)));
  if (matGain > 0) { Profile.addMaterial(matGain); report.material = matGain; }

  // 1) 每角色记录（挑战条件里有一类是"用某角色…"，它读的就是这里）
  var pc = recordFor(run.char);
  if (typeof pc.danger !== 'number') pc.danger = 0;
  if (typeof pc.points !== 'number') pc.points = 0;
  if (!pc.talents) pc.talents = [];
  pc.runs += 1;
  pc.kills += Math.max(0, num(run.kills));
  pc.materials += Math.max(0, num(run.scrap));
  pc.level = Math.max(pc.level, Math.max(0, num(run.level)));
  pc.bestWave = Math.max(pc.bestWave, Math.max(0, num(run.wave)));
  if (run.win) pc.wins += 1;
  if (typeof pc.danger !== 'number') pc.danger = 0;

  // 1a) 天赋点：通关给 2 + 难度级，另外每跨过 10/15/20 波各给一点
  //     （没通关也有一点进度，否则"打不过"会等于"零成长"）
  //     据点「档案馆」L3 在这里接上：每局额外多给一点（**据点 → 天赋**那条边）。
  //     刻意不做成"直接发一大笔点"—— 通关仍然必须是主要来源，
  //     否则"打通才给点"的稀缺性就没了（DD 的 Guild 也是先降本、再抬上限，不送等级）。
  var gained = Talent.pointsForRun(run) + (Profile.keepMods().bonusPoints || 0);
  if (gained > 0) { pc.points += gained; report.pointsGained = gained; }

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
  report.spores = Math.round(Profile.sporesForRun(run) * sporeMul);
  data.spores += report.spores;

  /* 3b) 合金：来源只有"合成"这条链（局内合成 + 基础产出），倍率来自熔炉。
       它**不**吃孢子那套倍率 —— 两条货币各有各的曲线，能互换就只剩一条了。 */
  report.alloy = Profile.alloyForRun(run);
  data.alloy += report.alloy;

  /* 4) 剧情进度：**先并进档案，再评挑战**。
     顺序不是随意的：隐藏挑战（G5）读的是**跨局的探索计数**
     （发现过几间密室 / 集齐几片记录 / 打倒过几个器官），
     如果先评挑战再并剧情，"这一局刚好凑够 6 间密室"就要等下一局才发奖 —— 差一拍。
     `report.story` 把这一局新拿到的东西交回接线层去弹提示（界面不认识 story 表）。 */
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
  // 结局：条件达成即收藏（每局重算一次；列表返回给接线层弹提示）
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
  flags.keepClocktower = Profile.keepLevel('clocktower') > 0;
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
 * @returns { spores, minutes, capped, reason, sporebed }
 */
Profile.settleOffline = function (now) {
  var t = isFinite(Number(now)) ? Number(now) : Date.now();
  /* 离线等级 = 据点「菌床」的折叠等级（`offlineLevel`）。
     读折叠值而不是设施等级：这样"离线产出"这条能力只有一个来源，
     设施表改了等级数也不会让这里悄悄失效（两边不同步的那种 bug 最难发现）。 */
  var level = Profile.keepMods().offlineLevel || 0;
  var seen = data.lastSeen;
  var out = { spores: 0, minutes: 0, minutesCounted: 0, capped: false, reason: '第一次见面', sporebed: level };
  if (seen > 0) {
    var r = Offline.settle(t - seen, level);
    out.spores = r.spores;
    out.minutes = r.minutes;
    out.minutesCounted = r.minutesCounted;
    out.capped = r.capped;
    out.reason = r.reason;
  }
  // 结算即前进：无论给没给，都把"上次见面"推到现在
  data.lastSeen = t;
  if (out.spores > 0) {
    data.spores += out.spores;
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
   7c. 跨局据点（模拟经营第二级，花孢子）
   ---------------------------------------------------------
   这里只做账：孢子扣减 + 等级落盘。
   "哪些设施、多少钱、折出什么修正"全在 stronghold.ts（纯数据 + 纯函数）。
   ========================================================= */
Profile.keepLevel = function (id) { return Stronghold.levelOf(data.keep, id); };
Profile.keepOwned = function () {
  var out: Record<string, number> = {};
  for (var k in data.keep) if (Object.prototype.hasOwnProperty.call(data.keep, k)) out[k] = data.keep[k];
  return out;
};
/** 据点的折叠修正（开局交给 Game.newRun） */
Profile.keepMods = function () { return Stronghold.modsFor(data.keep); };
Profile.keepInvested = function () { return Stronghold.invested(data.keep); };

/**
 * 买 / 升级一个据点设施（花孢子；高级等级还要**核心材料**）。
 *
 * 核心材料必须在这里真的扣 —— 它是全游戏最稀的一档
 * （一局最多 3 个，只有关底 Boss 掉）。这条线以前是断的：
 * `Profile.spendCore` 定义着但**没有任何调用点**，于是
 * "打 Boss 拿核心材料"在玩家那一侧是看得见摸不着的。
 * @returns { ok, reason, cost, core, toLevel }
 */
Profile.keepBuy = function (id) {
  /* ⚠ **改花材料**（用户拍板：经营与养成各花各的钱）。canBuy 的第一个资源参数
     现在接的是钱包里的材料，而不是孢子 —— 孢子从此只供养成。 */
  var chk = Stronghold.canBuy(data.keep, id, Profile.material(), data.core);
  if (!chk.ok) return chk;
  if (!Profile.spendMaterial(chk.cost)) {
    return { ok: false, reason: '材料不够（需要 ' + chk.cost + '）', cost: chk.cost, core: chk.core || 0, toLevel: 0 };
  }
  /* 两笔资源一起扣：`canBuy` 已经两边都验过，所以这里不会扣出负数。
     先扣材料再扣核心材料 —— 顺序无所谓，但**两笔必须都扣**。 */
  if (chk.core > 0) data.core -= chk.core;
  data.keep[id] = chk.toLevel;
  Profile.save();
  return { ok: true, reason: '', cost: chk.cost, core: chk.core || 0, toLevel: chk.toLevel };
};

/* =========================================================
   8. 清档（设置页的"清空存档"要连它一起清）
   ========================================================= */
Profile.clear = function () {
  data = blank();
  loadedFrom = 'defaults';
  return Slots.clear(Storage.KEYS.profile);
};
Profile.reset = function () {
  data = blank();
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
  values: function () {
    return ['spores', 'alloy', 'forge', 'unlocked', 'codex', 'done', 'perChar', 'daily', 'season', 'keep', 'story', 'lastSeen'];
  }
});
Registry.family('codexLevel', {
  note: '图鉴三态', owner: 'profile.ts',
  values: function () { return ['见过', '用过', '满级过']; }
});

export { Profile };
