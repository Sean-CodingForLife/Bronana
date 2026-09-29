/* =========================================================
   market.ts — 局内经济（商店 / 道具包 / 营地）
   ---------------------------------------------------------
   为什么把它从 game.ts 里切出来：这十几件事是**一个子系统**，不是"游戏主循环的一部分"：
     · 商店：报价（折扣的唯一算法）· 货架（含据点两个结构性解锁）· 刷新 · 锁定
     · 道具包：价格 = 概率表的期望价值 × 折扣
     · 营地：建材买卖（与废料彻底分开的第二种局内货币）
   它们的共同点是"**由界面驱动、只在 shop/camp 状态下发生**"，而 game.ts 的其余部分
   （step / 战斗 / 刷怪 / 地图）是每帧都在跑的模拟内核。切开之后 game.ts 少 ~270 行，
   而这些东西第一次可以被单独读懂。

   与 ai.ts 同一套路：**能力由 game.ts 注入**（`MarketCtx`），本模块不 import game.ts，
   于是依赖图仍然无环。ctx 只给 8 样东西，且都是"本模块确实需要的"：
     会说会话、当前波次、配置、事件总线、状态机、重算属性、状态校验、装配武器。

   纪律照旧：这里**不**自己写折叠（`S.kmods` / `S.omods` / `S.boonFold` / `S.campFx`
   都是别处折好的派生值），只读。
   ========================================================= */
import { Camp } from './camp.ts';
import { Affixes } from './affixes.ts';
import { Comp } from './comp.ts';
import { Craft } from './craft.ts';
import { Items } from './data_items.ts';
import { Weapons } from './data_weapons.ts';

/** game.ts 注入的能力（本模块不认识 Game） */
export interface MarketCtx {
  /** 当前会话（每次调用现取：换局之后对象就换了） */
  S(): Session;
  /** 当前波次（Game.wave 是可变字段，所以要现取） */
  wave(): number;
  cfg(): { maxWeapons: number };
  events(): Bus;
  setState(to: GameStateName): boolean;
  recalcStats(): void;
  requireState(state: string, what: string): boolean;
  /** 允许一组状态（商店与营地都能合成 —— 营地是"从商店过去的可选去处"） */
  requireStateIn(list: string[], what: string): boolean;
  /** 买武器时的落位规则（空槽装上 / 满槽合成），返回这一把最终变成了什么。
   *  `paid` = 这一把花了多少废料（回收价的上限，见 data_weapons.ts 的 salvageOf）
   *  `set`  = 货架上那一件的词条（**买的就是它**，不是重滚一套） */
  addWeaponOrCombine(id: string, tier?: number, paid?: number, set?: AffixSet | null): { ok: boolean; why: string; combined: boolean; tier: number; weapon: WeaponInst | null };
  /** 给玩家一件道具（**唯一的入口**：词条在这里定下来，见 game.ts 的 addItem）。
   *  市场不该自己 `Comp.spawn('item')` —— 那样"买来的道具没有词条"会成为一个
   *  只在某一条购买路径上出现的静默差异。 */
  addItem(def: ItemDef, set?: AffixSet | null): ItemInst | null;
  /** 取一个"本批词条"的随机流（由主随机流的状态派生，**不扰动主序列**）。
   *  货架一次要滚十几件，所以它必须自己能取流，而不是从 ctx 传一个 rnd 进来。 */
  affixRnd(): RngFn;
  /** 合成的**模拟实现**（本模块只做状态校验与事件） */
  combine(i: number, j: number): boolean;
  /** 回收价（含品级与**这一局的回收比例**：工坊「回收炉」会抬它） */
  salvageOf(w: WeaponInst): number;
  /** 回收一件装备顺带产出的合金（图纸树的唯一稳定来源） */
  salvageAlloy(w: WeaponInst): number;
  /** **道具代价**的读法（`S.itemCost` 折一次、只读结果）。单独一组而不是并进
   *  `econAdd`：它是**道具**那一层的东西，混在一起会让"这条降价是契约给的还是
   *  道具换来的"在界面上说不清。 */
  itemCostMul(key: string): number;
  itemCostFlag(key: string): boolean;
}

export interface MarketApi {
  openShop(bonus: number): void;
  shopRoll(): void;
  buyOffer(index: number): boolean;
  sellWeapon(index: number): boolean;
  /** 合成两把同名同档的武器（brotato 的规则：规则在 data_weapons.ts，这里只管状态） */
  combine(i: number, j: number): boolean;
  reroll(): boolean;
  toggleLock(): boolean;
  packPrice(kind: string): number;
  buyPack(kind: string): boolean;
  /** 建材包：花废料买建材（商店的"原料"那一栏） */
  buildPrice(): number;
  buyBuild(): boolean;
  campBuy(id: string): boolean;
  campSell(id: string): boolean;
  recalcCampFx(): void;
  /** 「议价」那类经济修正的读取语义（add 键，没有就是 0） */
  omod(key: string): number;
  econAdd(key: string): number;
  /** **道具代价**的读法（`S.itemCost` 折一次、只读结果）。与 `econAdd` 同一套路，
   *  但它是**道具**那一层的，所以单独一组 —— 混在一起会让"这条降价是契约给的
   *  还是道具换来的"在界面上说不清。 */
  itemCostMul(key: string): number;
  itemCostFlag(key: string): boolean;
}

export function makeMarket(C: MarketCtx): MarketApi {
  /* =========================================================
     1. 经济修正的读取语义（**唯一**一处）
     ---------------------------------------------------------
     `mul` 键没有就是 1（乘上去恒等）、`add` 键没有就是 0 —— 四种读点以前各写一套默认值。
     ========================================================= */
  function omod(key: string) { var S = C.S(); return (S.omods && S.omods[key]) || 0; }
  function econAdd(key: string) {
    var S = C.S();
    return (S.boonFold && S.boonFold.econ && S.boonFold.econ[key]) || 0;
  }

  /**
   * 商店价格折扣的**唯一**算法：营地工作台（本局）+ 天赋议价（永久）+ 这一间房（商店房），
   * 加法叠加后封顶 60%。写在一处，是因为它以前在 shopRoll 与 packPrice 里各写了一遍 ——
   * 那种重复的代价是"改了货架价、忘了道具包价"，而两处都看不出对方存在。
   */
  /**
   * 商店价格折扣的**唯一**算法：天赋议价（永久）+ 这一间房（商店房）+ 契约的经济组。
   * **工坊不在这里了**（这一步解耦）：它以前靠"工作台"给商店打折，
   * 那是"经营直接改战斗经济"。现在工坊只造东西 —— 想让商店便宜就去点天赋。
   * 写在一处是因为它以前在 shopRoll 与 packPrice 里各写了一遍。
   */
  function shopDiscount() {
    var S = C.S();
    return Math.min(0.6,
      omod('shopDiscount') +
      ((S.roomFx && S.roomFx.shopDiscount) || 0) + econAdd('shopDiscount'));
  }

  /* =========================================================
     2. 商店货架
     ========================================================= */
  /** 货架上**武器**的标价（单一出处：折扣 × 应急溢价 × 幸运价） */
  function weaponPrice(def, tier, priceMul, emg) {
    var S = C.S();
    return Math.max(1, Math.round(Weapons.priceOf(def, S.stats.luck) * priceMul * emg));
  }

  function shopRoll() {
    var S = C.S();
    var wave = C.wave();
    var dm = S.dmods;
    var rfx = S.roomFx || {};
    /* 道具代价 `shopPrice`：货架更贵（一个乘性代价）。它乘在**折扣之后** ——
       于是"你堆了多少折扣"与"你带了几件更贵的东西"是两个独立的问题。 */
    var priceMul = dm.shopPrice * (1 - shopDiscount()) * C.itemCostMul('shopPrice');
    var offers: Offer[] = [];
    /* 货架上的货带**词条**（"这一件是哪一件"在商店里就定下来）。
       为什么不是在买到手时才滚：玩家是**看着词条**决定买不买的 ——
       如果买到手才滚，那界面上的词条就是假的（或者干脆看不到）。
       于是"这件 T2 匕首值不值这个价"第一次真的有一个答案。 */
    function affixOffer(o: Offer) {
      var kind = (o.type === 'weapon' ? 'weapon' : 'item') as 'weapon' | 'item';
      var tier = kind === 'weapon' ? (o.tier || (o.def as WeaponDef).tier || 1) : ((o.def as ItemDef).tier || 1);
      o.affixes = Affixes.roll(kind, o.def, tier, C.affixRnd());
      return o;
    }
    // 货架件数：难度修正 + 据点"货架" + 这一间房（商店房 +2）；都可以是 0 = 原样
    var n = Math.max(1, 4 + dm.offerCount + (S.kmods ? S.kmods.shopSlots : 0) + (rfx.shopSlots || 0) + econAdd('shopSlots')), i;
    /* **货架上的成品是"应急价"**（这一步改的角色）：
       装备与道具的主要来源是**制造**（craft.ts），货架只负责"这一波我就是要、
       等不了产线"的情况，所以统一加一层溢价。货架同时还是**回收站**
       （sellWeapon → 废料 + 合金）与刷新/锁定的地方 —— 它不再是"购物中心"。
       溢价让"能买为什么要造"有了答案：造得起的一律比买便宜。 */
    var emg = Craft.EMERGENCY_MARKUP;
    for (i = 0; i < n; i++) {
      var def = Weapons.rollShop(wave, S.rnd);
      offers.push(Comp.spawn('offer', {
        type: 'weapon', def: def, tier: def.tier,
        price: weaponPrice(def, def.tier, priceMul, emg)
      }));
    }
    for (i = 0; i < n; i++) {
      var d = Items.rollShop(wave, S.rnd);
      offers.push(Comp.spawn('offer', {
        type: 'item', def: d,
        price: Math.max(1, Math.round(Items.priceOf(d, S.stats.luck) * priceMul * emg))
      }));
    }
    S.offers = offers;

    /* ---- 据点的两个**结构性解锁**（改的是"能买到什么"，不是"便宜多少"）----
       它们的**量**写在据点表里（`workshop: 3` = 保底 T3+，`depot: 1` = 必出 1 件），
       这里只读、不写死 —— 改造前 shopRoll 里藏着一个硬编码的 3。 */
    if (S.kmods && S.kmods.depot > 0 && S.player.weapons.length) {
      var kinds: Record<string, boolean> = Object.create(null);
      for (var w = 0; w < S.player.weapons.length; w++) kinds[S.player.weapons[w].def.kind] = true;
      var pool = Weapons.LIST.filter(function (d) { return kinds[d.kind]; });
      /* ① 「货栈」：每列必出 N 件"你已经持有的武器类别"。
         为什么这是结构而不是数值：它保证你的 build **能延续**——
         没有它，你可能整局都在被随机喂不相干的武器；有了它，
         "我这把长矛还能不能升级"变成了一个可以规划的问题。
         用**已持有的类别**（而不是"你想要的类别"）是刻意的：它奖励确定方向，而不是直接给答案。 */
      for (var g = 0; g < Math.min(S.kmods.depot, offers.length) && pool.length; g++) {
        var pick = pool[Math.floor(S.rnd() * pool.length)];
        offers[g].type = 'weapon';
        offers[g].def = pick;
        offers[g].tier = pick.tier;
        offers[g].price = weaponPrice(pick, pick.tier, priceMul, emg);
      }
    }
    /* ② 「工坊」：每次刷新**至少保证一件"这个等级及以上"的货**（等级读 kmods.workshop）。
       它把"刷新"从"再赌一次"变成"保底一次像样的" —— 于是刷新这个动作
       在后期仍然值得点（否则高级货一多，刷新就只是在稀释货架）。 */
    if (S.kmods && S.kmods.workshop > 0) {
      var minTier = S.kmods.workshop;
      var hasTop = false;
      for (var t2 = 0; t2 < offers.length; t2++) {
        if ((offers[t2].def.tier || 1) >= minTier) { hasTop = true; break; }
      }
      if (!hasTop) {
        // 把"最便宜的那件"换成一件够档的道具：位置由价格决定 → 结果可复现
        var cheapIdx = 0;
        for (var c2 = 1; c2 < offers.length; c2++) {
          if (offers[c2].price < offers[cheapIdx].price) cheapIdx = c2;
        }
        var hiItems = Items.LIST.filter(function (d) { return (d.tier || 1) >= minTier; });
        if (hiItems.length) {
          var hiItem = hiItems[Math.floor(S.rnd() * hiItems.length)];
          offers[cheapIdx].type = 'item';
          offers[cheapIdx].def = hiItem;
          offers[cheapIdx].tier = 0;
          offers[cheapIdx].price = Math.max(1, Math.round(Items.priceOf(hiItem, S.stats.luck) * priceMul * emg));
        }
      }
    }
    // 刷新价：**只有天赋「议价」**在压它（据点那一档折扣已经删掉 —— 那是"据点数值穿透"）
    var rrOff = Math.min(0.6, omod('rerollDiscount'));
    S.rerollCost = Math.max(0, Math.round(
      (2 + Math.floor(wave * 0.7) * 2 + (S.rerolls || 0) * 2) * dm.rerollCost *
      (1 - rrOff) * C.itemCostMul('rerollCost')));
    S.rerolls = (S.rerolls || 0) + 1;
    /* 词条在**最后**统一滚一次：上面两处结构性解锁会把某几个格子换成别的货
       （`offers[g].def = pick`），如果在循环里滚就会留下一套"上一件货"的词条 ——
       那是一件**静默**的错（界面上那件武器带着另一件武器的词条）。
       放在末尾，读点是唯一的：**每个格子滚它自己现在那一件**。 */
    for (i = 0; i < offers.length; i++) affixOffer(offers[i]);
  }

  function openShop(bonus: number) {
    var S = C.S();
    if (!S.shopLocked) shopRoll();
    S.shopLocked = false;
    S.shopBonus = bonus || 0;
    C.setState('shop');
    C.events().emit('shopOpen', { bonus: bonus });
  }

  /* =========================================================
     3. 局内营地（模拟经营的第一级）
     ---------------------------------------------------------
     花的是**建材**（营地自己的局内货币，每波固定到账），
     与商店的**废料**彻底分开 —— 为什么必须分开，见 camp.ts 文件头那三轮实测：
     废料会滚雪球，任何"先攒钱盖房"的路线都在雪球起步前自断一臂。
     设施与效果在 camp.ts 里声明；这里只做四件事：
     发建材、收建材、重算折叠效果、在枚举好的那几个点读它。
     ========================================================= */
  /** 营地买卖时要带上的据点/天赋好处（位子更多、价格更便宜） */
  function campOpts() {
    var S = C.S();
    return {
      slots: Camp.SLOTS + ((S.kmods && S.kmods.campSlots) || 0),
      // 工坊价格：**只有天赋「商会」**在压它（据点那一档折扣已删）
      discount: Math.min(0.6, omod('campDiscount')),
      // 据点「工匠」：拆了全额返还（能力，不是折扣）
      fullRefund: !!((S.kmods && S.kmods.refundFull) || 0)
    };
  }

  /** 盖 / 升级一个设施（花**建材**） */
  function campBuy(id: string) {
    var S = C.S();
    if (!C.requireState('camp', 'campBuy')) return false;
    var chk = Camp.canBuy(S.camp, id, S.campPoints, campOpts());
    if (!chk.ok) { C.events().emit('deny', chk.reason); return false; }
    S.campPoints -= chk.cost;
    var isNew = Camp.levelOf(S.camp, id) === 0;
    S.camp[id] = chk.toLevel;
    // 新建设施排到行尾（升级不挪位置）——「谁挨着谁」由建造顺序决定
    if (isNew && S.campRow.indexOf(id) < 0) S.campRow.push(id);
    recalcCampFx();
    C.events().emit('campBuy', { id: id, level: chk.toLevel, cost: chk.cost });
    return true;
  }

  /** 拆掉一个设施（退还一半建材）—— 让"选错"不至于毁掉一局；同时会拆掉它参与的组合 */
  function campSell(id: string) {
    var S = C.S();
    if (!C.requireState('camp', 'campSell')) return false;
    var lvl = Camp.levelOf(S.camp, id);
    if (!lvl) return false;
    var back = Camp.refundOf(S.camp, id, campOpts());
    S.campPoints += back;
    delete S.camp[id];
    var at = S.campRow.indexOf(id);
    if (at >= 0) S.campRow.splice(at, 1);
    recalcCampFx();
    C.events().emit('campSell', { id: id, refund: back });
    return true;
  }

  /** 重算折叠效果。**只在买卖时算一次**，别处不再回表（与难度修正同一个套路） */
  function recalcCampFx() {
    var S = C.S();
    S.campFx = Camp.effects(S.camp, S.campRow);
    /* 回收比例跟着重算：工坊「回收炉」是**买/拆了就变**的东西，
       冻结在开局那一份会让"建了回收炉却不涨回收价"。 */
    S.salvageRate = Math.min(0.9,
      Weapons.salvageRate + ((S.fmods && S.fmods.salvageBonus) || 0) + (S.campFx.salvageBonus || 0));
    C.recalcStats();
  }

  /* =========================================================
     4. 道具包与买 / 卖 / 刷新
     ========================================================= */
  /**
   * 随机道具包：花钱赌一件随机道具。
   * 价格 = 当前概率表的期望价值 × 折扣（见 data_items.ts），
   * 所以"标价"和"概率"永远自洽；幸运既压价又把权重往高层搬。
   */
  function packPrice(kind: string) {
    var S = C.S();
    var mul = S.dmods.shopPrice * (1 - shopDiscount());
    return Math.max(1, Math.round(Items.packPrice(C.wave(), S.stats.luck || 0, kind) * mul));
  }

  function buyPack(kind: string) {
    if (!C.requireState('shop', 'buyPack')) return false;
    var S = C.S();
    var p = S.player;
    if (!Items.packAvailable(C.wave(), kind)) {
      C.events().emit('deny', '高级道具包需要第 3 波后才有货');
      return false;
    }
    var price = packPrice(kind);
    if ((p.scrap || 0) < price) {
      C.events().emit('deny', '废料不足');
      return false;
    }
    p.scrap -= price;
    var def = Items.rollPack(C.wave(), S.stats.luck || 0, S.rnd, kind);
    C.addItem(def);
    C.recalcStats();
    p.hp = Math.min(p.hp, S.stats.maxHp);
    S.packsOpened = (S.packsOpened || 0) + 1;
    S.packSpent = (S.packSpent || 0) + price;
    C.events().emit('packOpen', {
      def: def, price: price, kind: kind,
      delta: def.price - price        // 赚了还是亏了（用来决定提示语气）
    });
    return true;
  }

  /**
   * **建材包**：花废料买建材（商店那一栏"原料"）。
   * 为什么它必须存在：建材是工坊的本钱，而它主要靠**出击**去捡（每波 +2、宝箱/补给/密室）
   * —— 那是"出击 → 制造"那条接口。可当你这一波就是想开工时，总得有个应急口，
   * 否则"我这局想练制造"只能靠运气遇到补给房。
   * 定价刻意**不划算**（越到后面越贵）：它买的是时间，不是资源。
   */
  var BuildPack = { amount: 4, base: 8, perWave: 2 };
  function buildPrice() {
    var S = C.S();
    return Math.max(1, Math.round((BuildPack.base + C.wave() * BuildPack.perWave) * S.dmods.shopPrice));
  }
  function buyBuild() {
    if (!C.requireState('shop', 'buyBuild')) return false;
    var S = C.S();
    var p = S.player;
    var price = buildPrice();
    if ((p.scrap || 0) < price) { C.events().emit('deny', '废料不足'); return false; }
    p.scrap -= price;
    S.campPoints += BuildPack.amount;
    C.events().emit('buyBuild', { price: price, amount: BuildPack.amount });
    return true;
  }

  function buyOffer(index: number) {
    if (!C.requireState('shop', 'buyOffer')) return false;
    var S = C.S();
    var o = S.offers[index];
    if (!o || o.sold) return false;
    var p = S.player;
    var mats = p.scrap || 0;
    if (mats < o.price) { C.events().emit('deny', '废料不足'); return false; }

    if (o.type === 'weapon') {
      /* 落位规则交给模拟层（addWeaponOrCombine）——这里**不**再自己判断"槽满没满"，
         因为那个判断现在是"满了能不能合成"这一整条规则的一部分（brotato 的原作细节）。
         先扣钱再落位是安全的：落位失败时它会明确说为什么，而钱还没动。
         `o.affixes` = 货架上那一件的词条：**买到手就是它**（不是重滚一套）——
         否则"看着它买"与"到手的那把"是两件东西。 */
      var res = C.addWeaponOrCombine(o.def.id, o.tier || o.def.tier, o.price, o.affixes || null);
      if (!res.ok) { C.events().emit('deny', res.why); return false; }
      p.scrap -= o.price;
      o.sold = true;
      if (res.combined) {
        // 合成与"买到手"是两件事：前者同时改变了两把武器的命运，值得单独一条事件
        C.events().emit('combine', { name: o.def.name, tier: res.tier, bought: true });
        C.events().emit('buy', { type: 'weapon', name: o.def.name, combined: true });
      } else {
        C.events().emit('buy', { type: 'weapon', name: o.def.name });
      }
    } else {
      p.scrap -= o.price;
      /* 道具同理：把货架上那一件的词条一起交过去 */
      C.addItem(o.def as ItemDef, o.affixes || null);
      o.sold = true;
      C.recalcStats();
      p.hp = Math.min(p.hp, S.stats.maxHp);
      C.events().emit('buy', { type: 'item', name: o.def.name });
    }
    C.recalcStats();
    return true;
  }

  /**
   * 回收一件武器（低价卖回）+ **产合金**。返还比例含品级
   * （`Weapons.valueOf`：每合成抬一档就翻一倍，因为它吃掉的是两把）。
   * 合金是图纸树唯一的稳定来源 —— 所以"回收"不是清垃圾，是**探索→解锁**那条链的入口。
   *
   * **最后一把不许回收**（实测的软锁）：这一间"打完"的条件是**场上清空**
   * （`step` 的 `drained && enemies.length === 0`），超时也只是让剩下的怪狂暴 +
   * 停止再刷，它们不会自己消失。于是"手里一把武器都没有"= 这一间永远清不掉 =
   * 商店永远不再开 = 再也买不回武器。实测：种子 20240922、ranger、回收掉唯一的
   * 手枪后，120 游戏秒 0 击杀、门一把都不开、`nextWave()` 返回 false ——
   * 只能从暂停菜单"放弃本局"。所以这条规则不是平衡，是**可玩性下限**。
   * 界面把那颗按钮画成按不动的（理由写在按钮上），与「合并（需图纸）」同一个做法。
   */
  function sellWeapon(index: number) {    if (!C.requireState('shop', 'sellWeapon')) return false;
    var S = C.S();
    var p = S.player;
    if (p.weapons.length <= 1) {
      /* 一把都不剩也一样拒（`<= 1` 已经含 0 把的情形），理由与"最后一把"同一条 */
      C.events().emit('deny', '这是最后一把武器 —— 回收掉就没有东西能打，这一间再也清不掉');
      return false;
    }
    if (index < 0 || index >= p.weapons.length) return false;
    var w = p.weapons[index];
    /* 回收价再乘**道具代价 `salvage`**（异星烟斗那类"拆东西更亏"）。
       乘在 `salvageOf` 之后：那个函数管的是"这把武器值多少 × 这一局的回收比例"，
       而这条代价管的是"你这个人拆东西的手艺"—— 两者是独立的。 */
    var refund = Math.max(1, Math.round(C.salvageOf(w) * C.itemCostMul('salvage')));
    var alloy = C.salvageAlloy(w);
    p.weapons.splice(index, 1);
    p.scrap = (p.scrap || 0) + refund;
    S.alloy = (S.alloy || 0) + alloy;
    for (var i = 0; i < p.weapons.length; i++) p.weapons[i].index = i;
    C.events().emit('sell', { name: w.def.name, refund: refund, alloy: alloy, tier: Weapons.tierOf(w) });
    return true;
  }

  /**
   * 合成（战斗 × 经营的交点）：两把同名同档的武器 → 一把高一档的，不占新格子。
   * 允许在**商店与营地**里做（营地是"从商店过去的可选去处"，两边都该能整理装备）。
   * 规则与数值全在 data_weapons.ts / game.ts，这里只回答"现在能不能点"。
   */
  function combine(i: number, j: number) {
    if (!C.requireStateIn(['shop', 'camp'], 'combine')) return false;
    /* 失败理由**由模拟层给**（它才知道是"没同名同档"还是"顶档要图纸"）。
       以前这里兜一句"这两把武器不能合成"，会把那条有用的理由盖掉 ——
       于是"要先解锁神话图纸"这种话永远显示不出来。 */
    return C.combine(i, j);
  }

  function reroll() {
    if (!C.requireState('shop', 'reroll')) return false;
    var S = C.S();
    var p = S.player;
    /* 营地祭坛送的免费刷新先花掉（不影响废料）。
       道具代价 `noFreeReroll` 直接**吃掉**这一档：带着它就没有免费刷新了。
       为什么在这里判而不是在回收免费次数的地方：那是**唯一**的消费点，
       写在一处才不会出现"某条路径还能白刷"（这正是"同一件事两个执行点"的老坑）。 */
    if (S.freeRerolls > 0 && !C.itemCostFlag('noFreeReroll')) {
      S.freeRerolls--;
      shopRoll();
      C.events().emit('reroll', 0);
      return true;
    }
    var cost = S.rerollCost;
    if ((p.scrap || 0) < cost) { C.events().emit('deny', '废料不足'); return false; }
    p.scrap -= cost;
    shopRoll();
    C.events().emit('reroll', cost);
    return true;
  }

  function toggleLock() {
    if (!C.requireState('shop', 'toggleLock')) return false;
    var S = C.S();
    S.shopLocked = !S.shopLocked;
    C.events().emit('lock', S.shopLocked);
    return true;
  }

  return {
    openShop: openShop, shopRoll: shopRoll,
    buyOffer: buyOffer, sellWeapon: sellWeapon, combine: combine,
    reroll: reroll, toggleLock: toggleLock,
    packPrice: packPrice, buyPack: buyPack,
    buildPrice: buildPrice, buyBuild: buyBuild,
    campBuy: campBuy, campSell: campSell, recalcCampFx: recalcCampFx,
    omod: omod, econAdd: econAdd,
    itemCostMul: C.itemCostMul, itemCostFlag: C.itemCostFlag
  };
}

/* 与其它模块同一形状：导出**一个对象**（能力由 game.ts 通过 make 注入） */
const Market = { make: makeMarket };
export { Market };
