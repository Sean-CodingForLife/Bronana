/* =========================================================
   run_save.ts — **一局存档的编解码**（纯数据，不含任何模拟逻辑）
   ---------------------------------------------------------
   ## 为什么它是单独一个模块

   改造前这三件事挤在 `game.ts`（模拟内核，4100 行）里：

     · `sanitizeSaveNumbers` —— 外部输入的**数值卫生边界**
     · `exportRun`            —— 会话 → 纯数据的**编码**
     · `inspectRun`           —— 一份存档能不能用的**校验**

   它们有一个共同点，而这个共同点就是拆出来的理由：
   **三者都不需要跑模拟。** 它们是"数据 ↔ 数据"的变换，不是"推进一帧"。

   留在内核里的代价很具体：
     · 存档格式是**对外契约**（玩家盘上有旧档），却是最不容易单独读的一处 ——
       要读它得先翻过 3400 行模拟代码；
     · 它**没法被单独测试**：改造前没有任何一套测试直接调 `sanitizeSaveNumbers` /
       `exportRun` / `inspectRun`，只有 `flow.mjs` 的往返（往返过了不代表格式对）。
   搬出来之后这三件事各自有了一个能直接喂输入的入口，判据写在 `test/run-save.mjs`。

   ## 边界：本模块**不认识 `Game`、不认识会话的运行时形状**

   它读的是一份**输入载荷**（`RunSaveInput`）—— 由 `game.ts` 在调用点摊平
   （`waves` / `speed` / `cleared` / `seen` / `keep` / `forge` …）。
   于是依赖方向是**单向的**：`game.ts`（L4）→ `run_save.ts`（L0）。
   反过来（本模块 import `game.ts`）会构成一条向上的依赖边，架构门会红。

   为什么不干脆把会话对象整个传进来：那会让本模块隐式认识 `GameSess` 的
   **78 个字段里的哪几个属于存档** —— 而"哪几个属于存档"正是这里最该看清楚的
   一件事。摊平之后，`RunSaveInput` 的字段表**就是**那个答案。

   ## 字段顺序是**契约的一部分**

   `JSON.stringify` 按插入顺序输出，而这个对象会被 `Save` 写进槽位。
   所以 `serialize` 里各个键的**书写顺序与原 `exportRun` 逐字一致** ——
   换顺序不会改变语义，但会让"存档字节完全一致"这条判据（以及行为指纹里
   任何依赖它的东西）失效。要动顺序，请当成一次**格式变更**来看待。

   ## 与 `save.ts` / `envelope.ts` 的分工（三个名字很像的东西）

     · `envelope.ts`（L0）—— 给**任何**东西套上 `{name, version, data}` 并管迁移链
     · `run_save.ts`（L0，本模块）—— **一局**存什么、怎么夹取、怎么校验
     · `save.ts`（L5）—— 槽位、自动存档、备份、导出串（用上面两个）
   ========================================================= */

import { Affixes } from './affixes.ts';
import { Weapons } from './data_weapons.ts';
import { U } from './utils.ts';

var MAX_SAFE = Number.MAX_SAFE_INTEGER;

var RunSave = {} as RunSaveApi;

/* =========================================================
   1. 数值卫生：外部输入的第一道（也是唯一一道）闸
   ---------------------------------------------------------
   为什么必须在**入口一次**做掉：`JSON.parse('1e999')` 是合法 JSON，解析出来就是
   `Infinity`；而每个字段各自只写了 `Math.max(0, …)` 这种**单侧**夹取，Infinity
   一路穿过去，然后 `JSON.stringify(Infinity)` 是 `null` ——
   数值在**下一次存档时被悄悄吃掉**（废料 → null → 再读档变 0，静默丢进度）。
   更狠的是 `wave: 1e308`：它会进 `endWave` 的奖励公式 `(8 + wave*3) * …`，
   一次结算就把 scrap / campPoints / 总统计全变成 Infinity（然后同样被存成 null）。

   写在一处而不是散在十几个 `Math.max` 旁边：这是"**外部输入**的边界"，
   不是某个字段自己的语义 —— 字段自己的语义由各处的 `Math.max` 管。

   就地改写调用方传进来的那份（都是刚解析出来的存档），不额外分配。
   ========================================================= */
RunSave.sanitizeNumbers = function (v, depth?) {
  var d = Number(depth) || 0;
  if (typeof v === 'number') {
    if (!isFinite(v)) return 0;
    return v > MAX_SAFE ? MAX_SAFE : (v < -MAX_SAFE ? -MAX_SAFE : v);
  }
  if (!v || typeof v !== 'object' || d > 6) return v;
  if (Array.isArray(v)) {
    for (var i = 0; i < v.length; i++) v[i] = RunSave.sanitizeNumbers(v[i], d + 1);
    return v;
  }
  for (var k in v) {
    if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
    v[k] = RunSave.sanitizeNumbers(v[k], d + 1);
  }
  return v;
};

/* =========================================================
   2. 编码：会话 → 纯数据
   ---------------------------------------------------------
   只存"进度"，不存场上实体（怪/子弹/粒子/贴花）：那些是派生状态，
   恢复时由 `startWave` 重新铺开即可。代价是**随机数流不会接着原来的走** ——
   恢复的是进度，不是"同一局的未来"（那需要整局重放）。

   ⚠ 每个字段**为什么必须进存档**都写在下面的行内注释里 ——
   那不是注解，是"删掉它会发生什么"的记录，本项目已经栽过多次
   （读档静默降级、读档刷词条、读档把成本洗掉…）。
   ========================================================= */
RunSave.serialize = function (input) {
  var sess = input.sess;
  var p = sess.player;
  return {
    char: sess.charDef.id,
    seed: sess.seed,
    danger: sess.danger,          // 续玩必须带着难度，否则读档会静默降级成第 0 级
    opening: sess.opening,        // 天赋产物同理：不带着它，读档就把养成静默丢了
    wave: input.waves,
    speed: input.speed,
    level: p.level,
    xp: p.xp,
    hp: Math.max(1, Math.round(p.hp)),
    scrap: Math.round(p.scrap || 0),
    upgrades: U.cloneObj(p.upgrades),
    /* `p` = 为这一把付过多少废料（回收价的上限，见 data_weapons.ts 的 salvageOf）。
       它必须进存档：不进的话"买一把 → 存档 → 读档 → 回收"就能把成本洗掉，
       套利换个入口又回来了。老存档没有这个字段 → 0（当作捡来的，不受限）。
       `a` = 词条（`Affixes.toSave` 的 `[id, 档, 值]` 三元组）—— 它同样是**这一局的
       随机产物**：不存的话，读档会让每件装备的词条重滚一遍（玩家看着的装备变了，
       而且"读档刷词条"会变成一条稳定的刷法）。 */
    weapons: p.weapons.map(function (w) {
      return { id: w.id, t: Weapons.tierOf(w), p: Math.floor(Number(w.paid) || 0), a: Affixes.toSave(w.affixes) };
    }),
    items: p.items.map(function (it) { return { id: it.def.id, a: Affixes.toSave(it.affixes) }; }),
    totals: {
      kills: sess.stats_total.kills, scrap: Math.round(sess.stats_total.scrap),
      dmg: Math.round(sess.stats_total.dmg), taken: Math.round(sess.stats_total.taken),
      healed: Math.round(sess.stats_total.healed), waves: sess.stats_total.waves
    },
    /* **营地不在一局存档里了**：设施 / 建造顺序 / 那笔钱现在都是**账号资产**
       （`Profile.campOwned()` / `Profile.campRow()` / `Profile.wallet.material`），
       它们本来就跨局活着，一局存档再存一份只会制造两个真相。
       会话里与制造有关的只剩 `craftUsed`（这一波用过哪几条产线），见下面。 */
    /* 本局打到多少材料（**只用于展示**；材料是即时进余额的，不靠结算再发） */
    materialEarned: Math.round(sess.materialEarned || 0),
    /* **材料余额（局内的全局货币）** —— v3 §5.1 + §二：三个模块全在局内，
       所以它是**这一局的钱**。不带它读档，玩家会静默丢掉自己攒的材料
       （界面上的数会跳回 0，而他刚在工坊里看到过那个数）。
       ⚠ 它以前住在账号钱包（`Profile.wallet.material`），M1 搬到这里。 */
    material: Math.max(0, Math.round(sess.material || 0)),
    // 据点等级同理：它是开局修正的来源，不带着读档会静默降级成"没有据点"
    keep: input.keep,
    /* **技能构筑**：与 keep/forge 同一理由 —— 存的是"这一局开局时的那一份"。
       不带它，读档会把"我这一局带了什么技能"静默丢掉（技能栏空着，
       而玩家记得自己点过）。 */
    skillBuild: (sess.skillBuildSource || []).slice(),
    /** 图纸：同样是一局开局修正的来源（存的是**开局时**那一份，见 `importRun`） */
    /* **图纸 = 局内状态**（M1 第四块，2026-09）：不带它，读档会把这一局解锁的图纸丢掉。 */
    forge: Object.keys(sess.forge || {}),
    /* ---- 地牢进度 ----
       地图**不进存档**（它由种子长出来，同一个种子必然同一张图），
       存的是"走到哪了"：层号 / 当前房 / 打过的房 / 破过的墙 / 发现过几间密室。
       这样存档小、且回放与成绩码仍然只需要种子。 */
    floor: sess.floor,
    room: sess.roomId,
    roomsCleared: input.cleared,
    roomsSeen: input.seen,
    walls: input.walls,
    secretSeen: sess.secretsFound || 0,
    /** 打倒过哪几只 Boss（剧情碎片按 id 认；坏档里认不出的会在读档时丢掉） */
    bossesDown: input.bossesDown,
    coreEarned: Math.max(0, Math.round(sess.coreEarned || 0)),
    /** 层间契约：已挑的那条 + 还没挑的候选（都是本局状态） */
    boon: sess.boon,
    pendingBoons: sess.pendingBoons.slice(),
    packsOpened: sess.packsOpened || 0,
    packSpent: sess.packSpent || 0,
    /* ---- 商店的"此刻"（存档点就在商店里，所以这些必须跟着走）----
       以前这些都不进存档，读档时 `openShop` 会**重掷一次货架**：
       你看着的货变了、刷新价跌回最低（可以反复存读刷便宜刷新）、锁定的商店自己解锁。 */
    offers: sess.offers.map(function (o) {
      return { t: o.type, id: o.def.id, price: o.price, sold: !!o.sold, tier: o.tier || 0,
        /* 货架上的词条也要存：不存的话读档会把这一屏货**重滚一遍** ——
           玩家看着的那件带"锋锐 T2"的匕首变成了别的词条（与"读档换货"同一类问题，
           而这一条更隐蔽：货名、价格、档位全都没变）。 */
        a: Affixes.toSave(o.affixes || null) };
    }),
    /** 合成了几次（本局统计 / 结算展示；读档不该把它清零） */
    combineCount: sess.combineCount || 0,
    /** 这一间的房间效果（折出来的那一份）：商店房的「货架 +2 / 九折」就是它。
        为什么不重算而是存下来 —— 房间内容里带着**一次性**的进门效果（回血/给废料），
        读档时再跑一遍等于白送（`applyRoomEntry` 只在真进门时调用）。 */
    roomFx: {
      shopSlots: (sess.roomFx && sess.roomFx.shopSlots) || 0,
      shopDiscount: (sess.roomFx && sess.roomFx.shopDiscount) || 0,
      fastMul: (sess.roomFx && sess.roomFx.fastMul) || 0,
      slowMul: (sess.roomFx && sess.roomFx.slowMul) || 0
    },
    /** 造了几件（同上） */
    craftCount: sess.craftCount || 0,
    /** 这一波用掉的产线（存档点在商店里，所以它必须跟着走 —— 否则读档可以把产线刷回来） */
    craftUsed: (sess.craftUsed || []).slice(),
    /* **工坊 = 局内状态**（M1 第三块，2026-09）：等级与建造顺序都在会话里，
       不带它们读档会静默丢掉这一局盖的工坊。
       ⚠ **顺序必须一起存**：相邻组合靠它判定，只存等级会让组合凭空消失
       （界面上设施都在、等级也对，可「淬火」那类加成没了）。 */
    camp: (function () {
      var src = sess.camp || {}, out: Record<string, number> = {};
      for (var k in src) {
        if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
        var v = Math.max(0, Math.round(Number(src[k]) || 0));
        if (v > 0) out[k] = v;
      }
      return out;
    })(),
    campRow: (sess.campRow || []).filter(function (x) { return typeof x === 'string'; }).slice(0, 16),
    /* **NPC 关系 = 局内状态**（M3 第三块）：与 `growth` 同一组 —— 它们都是
       养成模块在这一局里的账。不带的话，读档会把聊出来的关系丢掉。 */
    bonds: sess.bonds || {},
    talks: sess.talks || {},
    /** 本局累积的合金（合成产出；结算入账，**读档不该丢**） */
    growth: sess.growth || 0,
    /* **产能**（M2）：局内的经营代币。与 `growth` 同一组 —— 不带它，读档会让
       玩家刚在据点界面看到的那笔钱**静默归零**（`flow` 门会当场报"进度漂移"）。 */
    capacity: sess.capacity || 0,
    /* **核心素材**（M4）：跨模块，但**住在局内**（v3 §二）。
       不带它们，读档会让玩家刚赚到的遗物/徽记静默归零 ——
       与 `capacity` 那次同一个坑（`flow` 门会报"存档不幂等"）。 */
    relic: sess.relic || 0,
    sigil: sess.sigil || 0,
    /* 已经为哪几个扇区发过徽记 —— 丢掉它，"再点一个别的节点"会**重发**一次徽记。 */
    sigilSectors: (sess.sigilSectors || []).filter(function (x) { return typeof x === 'string'; }),
    rerolls: sess.rerolls || 0,
    rerollCost: sess.rerollCost,
    shopLocked: !!sess.shopLocked,
    shopBonus: sess.shopBonus || 0,
    freeRerolls: sess.freeRerolls || 0,
    /** 随机流的状态：不带着它，读档后所有掷骰从种子起点重来 */
    rndState: (sess.rnd && sess.rnd.state) ? sess.rnd.state() : undefined,
    /** 还没选的升级（存档点若正好压着一次升级，丢了就是白丢一级） */
    pendingLevels: p.pendingLevels || 0,
    /** 这一局在事件房见过的遭遇（剧情碎片按它记账） */
    runEvents: (sess.runEvents || []).slice()
  };
};

/* =========================================================
   3. 校验：只看不取
   ---------------------------------------------------------
   给"继续上一局"按钮判断用（也是 `importRun` 的第一道门）。
   `charId` 由调用方给（本模块**不认识角色表** —— 认识它就要 import
   `data_chars.ts`，而那是"谁是合法角色"这条规则的出处，该由调用方持有）。
   ========================================================= */
RunSave.inspect = function (data, charOf) {
  if (!data || typeof data !== 'object') return null;
  var ch = String(data.char || '');
  var cname = charOf ? charOf(ch) : '';
  if (!cname) return null;
  var wave = Math.floor(Number(data.wave));
  if (!isFinite(wave) || wave < 1) return null;
  /* 上界不是"平衡"而是**数值卫生**：波次进 `endWave` 的 `(8 + wave*3)` 与难度插值，
     1e308 这种"合法 JSON 的巨数"会把废料打成 Infinity（见 `sanitizeNumbers`）。 */
  if (wave > 9999) wave = 9999;
  var lvl = Math.floor(Number(data.level));
  if (!isFinite(lvl) || lvl < 1) lvl = 1;
  if (lvl > 9999) lvl = 9999;
  return { char: ch, charName: cname, wave: wave, level: lvl };
};

export { RunSave };
