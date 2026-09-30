/* =========================================================
   balance.mjs — 平衡体检（无头机器人跑完整局）

   为什么要有它：这一轮加的四个系统（天赋经营扇区 / 营地组合 / 档案馆 / 货栈）
   都是"数值与取舍"的东西，**测试只能验它们生效，验不了它们合不合适**。
   "合不合适"要回答三个具体问题：

     1. 有没有**支配性策略**？（某个配置在所有指标上都赢 → 那就没有选择了）
     2. 有没有**死选项**？（某个节点/设施在任何策略下都不值得买 → 等于不存在）
     3. 差距有多大？（差距太小 = 感觉不到；太大 = 只有一条路可走）

   做法：一个**确定性**机器人（同样的种子必得同样的结果）——
     · 走位：绕圈（固定相位）
     · 升级：按固定优先级挑卡（所有配置用**同一套**在局内的策略，
       这样跑出来的差异只能归因于开局条件，不能归因于"机器人偏向经济流"）
     · 商店：买得起就买最便宜的、有免费刷新就刷、材料富余就去营地盖最便宜的
     · 一直到死/通关/帧数上限

   用法：
     node tools/balance.mjs talents      # 天赋：战斗流 vs 经济流 vs 混合
     node tools/balance.mjs camp         # 营地：无组合 vs 各种组合
     node tools/balance.mjs all
   ========================================================= */
import { loadAll, SIM_MODULES } from '../test/_load.mjs';

await loadAll(SIM_MODULES);
const { Game, Scene, Input, Talent, Camp, Profile, Stronghold, Storage, Chars, Arena, Weapons, Tiers, Craft } = globalThis;
console.error = function () { };

let FRAME_CAP = 24000;            // ≈ 6.7 分钟游戏时间（约 10~14 波）
/* 种子数：12 个。原来 5 个时，同一个摆法在两轮之间能差 ±1 波 ——
   那不是"配置差异"，那是种子噪声。**先把噪声压下去再谈平衡**。 */
const SEEDS = [20240922, 777, 4242, 31337, 20260501, 11, 2222, 99999, 123456, 5150, 8675309, 424242];
/** 两种测量模式：
 *  survive —— 真实生命，测"能撑到第几波"（生存）
 *  clear   —— 玩家免伤，测"同样时间能推多远 / 杀多少"（输出与经济）
 *  为什么要两种：机器人是个平庸的玩家（4~5 波就死），单看生存的话
 *  种子噪声会把配置差异淹没；免伤模式把时间轴拉长，让经济流的复利显形。 */
const MODE = (process.argv.indexOf('--mode') >= 0)
  ? process.argv[process.argv.indexOf('--mode') + 1] : 'survive';
/** 营地策略：never 永不投 / cheap 先盖便宜的 / combo 按组合顺序盖。
    默认 never —— 天赋实验里营地是"噪声变量"，要单独测。 */
let CAMP_POLICY = (process.argv.indexOf('--camp') >= 0)  ? process.argv[process.argv.indexOf('--camp') + 1] : 'never';
function setCampPolicy(p) { CAMP_POLICY = p; }
/** 制造策略：smart 先买后造（默认）/ first 先造后买 / only 只造不买 / none 从不制造。
 *  为什么要它：这一步之前机器人**只盖工坊不会用**，于是"经营这一根柱子值不值"
 *  在实验台上根本量不出来（第一次跑出来全是 +0.0）。 */
let CRAFT_POLICY = 'smart';
function setCraftPolicy(p) { CRAFT_POLICY = p; }
/** 购买策略：greedy 买得起里最贵的（默认）/ merge 优先买**身上已有同名**的那件。
 *  为什么要 merge：加 T5（神话）之后"成型速度"第一次成为一个要量的问题 ——
 *  而默认机器人是"随缘拿货"，它永远攒不齐同名武器，也就永远走不到顶档。
 *  合成流的动作是"盯着一个名字买"，所以必须有第二种机器人。 */
let BUY_POLICY = (process.argv.indexOf('--buy') >= 0) ? process.argv[process.argv.indexOf('--buy') + 1] : 'greedy';
function setBuyPolicy(p) { BUY_POLICY = p; }

/* ---------------- 确定性机器人 ----------------
   走位策略是自己写的"风筝"：躲最近的敌人 + **切向绕圈**（直线后退会被追上）
   + 离墙留余量（否则会被逼到角落打死）。
   为什么不用 Game.autoInput：它只做"直线远离最近的敌人"，实测第一波就死 ——
   机器人太弱时所有配置都撞在"必死"这面墙上，测出来的差异全是噪声。
   （autoInput 仍然保留为 `--policy auto` 的对照组。） */
const CARD_ORDER = ['damage', 'attackSpeed', 'critChance', 'maxHp', 'harvesting', 'luck', 'armor', 'speed', 'range', 'hpRegen'];
/** 一整套"经济玩法"的选卡顺序（天赋 + 选卡 + 购物都偏经济）——
    只测天赋那 5 点时，经济流在局内根本不会去拿收获卡，等于只测了半个策略。 */
const CARD_ORDER_ECON = ['harvesting', 'luck', 'pickupRange', 'maxHp', 'damage', 'attackSpeed', 'armor', 'speed', 'critChance', 'range'];
const POLICY = (process.argv.indexOf('--policy') >= 0)
  ? process.argv[process.argv.indexOf('--policy') + 1] : 'kite';

let WON = false;                  // 通关标记（Game.summary() 强制 win:true，不能用它）
Game.events.on('runWin', function () { WON = true; });

function nearestEnemy(s) {
  const p = s.player;
  let best = null, bd = Infinity;
  for (const e of s.enemies) {
    const d = (e.x - p.x) * (e.x - p.x) + (e.y - p.y) * (e.y - p.y);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function kiteInput(s, t) {
  const p = s.player, W = Arena.W, H = Arena.H;
  let ax = 0, ay = 0;
  for (const e of s.enemies) {
    const dx = p.x - e.x, dy = p.y - e.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > 320 * 320) continue;
    const d = Math.sqrt(d2) || 1;
    const w = 1 / Math.max(1, d / 45);          // 越近推得越狠
    ax += (dx / d) * w; ay += (dy / d) * w;
  }
  const m = 100;                                 // 离墙余量
  if (p.x < m) ax += ((m - p.x) / m) * 2.2; else if (p.x > W - m) ax -= ((p.x - (W - m)) / m) * 2.2;
  if (p.y < m) ay += ((m - p.y) / m) * 2.2; else if (p.y > H - m) ay -= ((p.y - (H - m)) / m) * 2.2;
  const n = nearestEnemy(s);
  if (n) {                                       // 切向：绕着最近的敌人转
    const dx = p.x - n.x, dy = p.y - n.y;
    const d = Math.hypot(dx, dy) || 1;
    ax += (-dy / d) * 0.7; ay += (dx / d) * 0.7;
  }
  if (!ax && !ay) return { x: Math.cos(t * 0.7), y: Math.sin(t * 0.7) };
  const len = Math.hypot(ax, ay) || 1;
  return { x: ax / len, y: ay / len };
}

function pickCard(order) {
  const cards = Game.getSession().levelCards || [];
  for (const want of (order || CARD_ORDER)) {
    const i = cards.findIndex(c => c && c.key === want);
    if (i >= 0) return i;
  }
  return 0;
}

/** 商店回合：买得起里**最贵**的那件（真人不会只捡最便宜的），
    免费刷新用掉；投营地时**先留出钱**再买装备（否则贪心买法永远攒不到盖房的钱）。 */
function shopTurn(log) {
  const mats = () => Game.getSession().player.scrap || 0;
  /* 「先造后买」与「只造不买」两种策略：制造与购买**抢同一笔材料**，
     先后顺序不一样，结果就不一样 —— 这正是"造得起的比买便宜"这句话该被量一次的地方。 */
  if (CRAFT_POLICY === 'first') craftTurn(log);          // 内部会把状态还回来
  // 装备：买得起里最贵的。⚠ 工坊现在也花材料，所以这里**要留钱**给工坊（见 campWish）
  if (CRAFT_POLICY !== 'only') {
    for (let guard = 0; guard < 30; guard++) {
      const pool = Game.getSession().offers
        .map((o, i) => ({ o, i }))
        .filter(({ o }) => o && !o.sold && o.price <= mats());
      /* merge 流：先挑"身上已经有同名"的那件（那是合成的燃料），没有才退回买最贵的。
         同价时买更便宜的 —— 合成要的是**数量**，不是单价。 */
      const held = Game.getSession().player.weapons.map(w => w.id);
      const cand = (BUY_POLICY === 'merge'
        ? (pool.filter(({ o }) => o.type === 'weapon' && held.indexOf(o.def.id) >= 0)
          .sort((a, b) => a.o.price - b.o.price)[0] || pool.sort((a, b) => b.o.price - a.o.price)[0])
        : pool.sort((a, b) => b.o.price - a.o.price)[0]);
      if (!cand) break;
      if (!Game.buyOffer(cand.i)) break;
      log.buys++;
    }
  }
  // 免费刷新：刷一次再收一轮（只刷一次，避免"无限刷"把材料烧光）
  if (Game.getSession().freeRerolls > 0 && log.rerolls < 2) { Game.reroll(); log.rerolls++; return shopTurn(log); }
  // 工坊：材料够了就按策略盖。它现在与装备**抢同一笔钱**（材料），取舍是真的
  const wanted = campWish(Game.getSession());
  if (wanted && Game.openCamp()) {
    if (Game.campBuy(wanted.id)) log.campBuys.push(wanted.id);
  }
  if (CRAFT_POLICY !== 'first') craftTurn(log);
  if (Game.state === 'camp') Game.setState('shop', true);
  Game.nextWave();
}

/** 制造回合：能用空产线造得起里**最贵**的一件（与买装备同一条贪心规则）。
 *  武器优先（它们决定输出），其次道具；一件都造不起就空着 ——
 *  空着的产线就是浪费，这正是经营自己的失败状态。
 *  策略见 `CRAFT_POLICY`：none 从不制造（对照）/ only 只造不买 / first 先造后买 / smart 先买后造。 */
function craftTurn(log) {
  if (CRAFT_POLICY === 'none') return;
  /* **借用**营地态做事，做完把它还给调用方 —— 这一条是踩出来的：
     制造要求"在商店或工坊"，而 `openCamp()` 会把状态切到 camp；
     于是"先造后买"里的买货架会被 `requireState('shop')` 静默拒掉（商店件 0.0）。
     实验台自己的副作用不该改调用方的世界，所以在这里收尾。 */
  const back = Game.state;
  if (!Game.openCamp()) return;
  const wanted = CRAFT_POLICY === 'item' ? 'item' : 'weapon';
  const opts = Game.craftOptions().filter(o => o.ok && o.affordable && o.kind === wanted);
  if (opts.length) {
    const lines = Game.craftFreeLines();
    if (lines.length) {
      opts.sort((a, b) => b.cost - a.cost);
      for (const o of opts) {
        const line = Game.craftFreeLines();
        if (!line.length) break;
        if (Game.craft(line[0], o.id)) log.crafts = (log.crafts || 0) + 1;
        else break;
      }
    }
  }
  if (back === 'shop' || back === 'camp') Game.setState(back, true);
}

/** 当前工坊策略下"下一座想盖的设施"（没有就返回 null）。
    ⚠ 口径变了：改造前工坊花的是**局内的"建材"**（每波 +2、与材料分开），
    所以那时候这里只问"想盖哪个、买不买得起"；现在花的是**材料**（带得出局的那一笔），
    于是"盖工坊"与"造装备"开始**抢同一笔钱** —— 那正是用户要的那条取舍，也是这个校验
    现在必须量到的东西。 */
function campWish(s) {
  if (CAMP_POLICY === 'never') return null;
  const camp = Profile.campOwned();
  const opts = Game.campOpts();
  if (Object.keys(camp).length >= opts.slots) return null;
  const pts = Profile.material();
  const prefs = CAMP_POLICY === 'combo' ? ['furnace', 'anvil', 'salvage', 'still', 'assay']
    : CAMP_POLICY === 'struct' ? ['anvil', 'furnace', 'still', 'salvage', 'assay']
      : Camp.LIST.map(d => d.id).sort((x, y) => Camp.BY_ID[x].levels[0].cost - Camp.BY_ID[y].levels[0].cost);
  for (const id of prefs) {
    const chk = Camp.canBuy(camp, id, pts, opts);
    if (chk.ok) return { id, chk };
  }
  return null;
}

/** 跑一局。返回本局的观察值（不落账到档案） */
function runOnce(opts) {
  const { char = 'ranger', seed, danger = 0, opening = null, smods = null, camp = null, cardOrder = null, boon = null } = opts;
  WON = false;
  Game.newRun(char, seed, danger, opening, smods);
  const sess = Game.getSession();
  /* 层间契约：正常路径是"打完 Boss 抽签再挑"，短局里机器人走不到那儿，
     所以实验台直接摆上（与营地那次"预建营地"同一个套路，也同一个理由：
     要量的是"这一条值不值"，不是"能不能抽到它"）。 */
  if (boon) Game._internals.setBoon(boon);
  if (camp && camp.length) {
    // 直接盖好（实验用）：**借道**商店态进营地，盖完立刻回到 playing。
    //
    // 这里踩过一个坑，值得写在代码里：第一版盖完把状态**留在 shop**，
    // 于是机器人的循环看到 shop 就立刻做了一次商店回合 → 里面会 `nextWave()`，
    // 结果所有"有营地"的配置都**把第 1 波整波跳掉了**，一开始就面对第 2 波的强度。
    // 表现是"连只加每波回血 3 点的营火都让成绩变差 −1.3 波"——
    // 一个纯增益不可能有害，这本身就是"实验台坏了"的信号，而不是游戏的平衡问题。
    const back = Game.state;
    /* ⚠ 工坊是**跨局资产**，所以每一次实验前必须**清空**它 ——
       否则上一轮预建的设施会留下来，位子被占满，下一轮 `campBuy` 直接失败
       （实测就是这样炸的）。清空之后"预建这几座"才是一个可控的实验变量。 */
    for (const owned of Object.keys(Profile.campOwned())) Profile.campSell(owned, Game.campOpts());
    /* 预建工坊要**先给材料**：它花的是带出去的那笔钱，而实验台跑的是短局，
       机器人打不出足够材料。给足之后"预建几座"才是可控的实验变量。 */
    Profile.addMaterial(9999);
    Game.setState('shop', true);
    if (!Game.openCamp()) throw new Error('openCamp 失败：实验参数不对');
    for (const id of camp) {
      if (!Game.campBuy(id)) throw new Error('campBuy 失败：' + id);
    }
    Game.setState(back, true);              // 原样回到 playing（第 1 波还没打完）
    // 防复发：预建营地**不许推进波次**。第一版就是因为盖完留在 shop 态，
    // 让机器人多做了一次 nextWave → 跳掉第 1 波 → 所有营地配置被冤枉成"有害"。
    if (Game.wave !== 1) throw new Error('实验台坏了：预建营地推进到了第 ' + Game.wave + ' 波');
  }
  const log = { buys: 0, rerolls: 0, saves: 0, campBuys: [] };
  /* 成型节奏：每个商店回合记一次"当前武器最高档"，并记下**第一次**到每一档的波次。
     为什么在商店回合采样：装备变化只发生在商店/营地，战斗里档位不会动。 */
  const fit = { first: {}, top: 0, samples: [] };
  let f = 0;
  for (; f < FRAME_CAP; f++) {
    const st = Game.state;
    if (st === 'end') break;
    if (st === 'levelup') { Game.chooseLevelCard(pickCard(cardOrder)); Input.endFrame(); continue; }
    if (st === 'shop') {
      let top = 0;
      for (const w of Game.getSession().player.weapons) top = Math.max(top, Weapons.tierOf(w));
      for (let t = 1; t <= Tiers.MAX; t++) if (top >= t && !fit.first[t]) fit.first[t] = Game.wave;
      fit.top = Math.max(fit.top, top);
      fit.samples.push(top);
      /* 每波的材料收入（实测）：后面"制造流成型节奏"要用它当收入曲线 */
      (fit.income = fit.income || []).push(Game.getSession().materialEarned || 0);
      shopTurn(log);
      Input.endFrame();
      continue;
    }
    if (st === 'camp') { Game.setState('shop', true); Input.endFrame(); continue; }
    if (Scene.simulates(st)) {
      if (MODE === 'clear') Game.getSession().player.invuln = 1e9;   // 免伤：只测输出与经济
      Game.step(Game.cfg.fixedDt, POLICY === 'auto'
        ? Game.autoInput(f * Game.cfg.fixedDt)
        : kiteInput(Game.getSession(), f * Game.cfg.fixedDt));
    }
    Input.endFrame();
  }
  const s2 = Game.getSession();
  const t = s2.stats_total;
  const row = {
    wave: Game.wave, kills: Math.round(t.kills), materials: Math.round(s2.materialEarned || 0),
    level: s2.player.level, win: WON, frames: f, buys: log.buys, camp: log.campBuys.slice(),
    campCount: log.campBuys.length, saves: log.saves, crafts: log.crafts || 0,
    items: s2.player.items.length, weapons: s2.player.weapons.length,
    fit: fit
  };
  row.kpm = row.kills / Math.max(1, f / 1000);          // 每千帧击杀（输出代理）
  row.mpm = row.materials / Math.max(1, f / 1000);      // 每千帧材料（经济代理）
  row.growth = Math.round(Profile.growthForRun({
    wave: row.wave, kills: row.kills, materials: row.materials, win: row.win
  }) * (1 + Math.min(Profile.SPORE_MUL_CAP,
    ((s2.kmods && s2.kmods.sporeMul) || 0) + ((s2.omods && s2.omods.sporeMul) || 0))));
  return row;
}

/** 一批配置跑多个种子，取平均 */
function bench(label, opts) {
  const rows = SEEDS.map(seed => runOnce(Object.assign({ seed }, opts)));
  const avg = k => rows.reduce((a, r) => a + r[k], 0) / rows.length;
  return {
    label, rows,
    wave: avg('wave'), kills: avg('kills'), materials: avg('materials'),
    level: avg('level'), buys: avg('buys'), spores: avg('spores'), crafts: avg('crafts'),
    kpm: avg('kpm'), mpm: avg('mpm'), items: avg('items'), frames: avg('frames'),
    weapons: avg('weapons'),
    campCount: avg('campCount'), saves: avg('saves'),
    wins: rows.filter(r => r.win).length
  };
}

const f1 = n => (Math.round(n * 10) / 10).toFixed(1);
const f0 = n => String(Math.round(n));

function table(title, results) {
  console.log('\n' + title);
  console.log('  配置'.padEnd(22) + '波次   击杀/千帧  材料/千帧  材料   商店件  制造   建产线  孢子   通关');
  for (const r of results) {
    console.log('  ' + r.label.padEnd(20) +
      f1(r.wave).padStart(5) + f1(r.kpm).padStart(10) + f1(r.mpm).padStart(11) +
      f0(r.materials).padStart(8) + f1(r.buys).padStart(8) + f1(r.crafts).padStart(7) +
      f1(r.campCount).padStart(7) +
      f0(r.growth).padStart(7) + ('   ' + r.wins + '/' + r.rows.length));
  }
}

/* =========================================================
   实验一：天赋经济扇区（批次 A）
   ========================================================= */
function expTalents() {
  console.log('\n================ 天赋：战斗流 vs 经济流 vs 混合 ================');
  console.log('  （同一套局内策略、同一种子；5 点 = 一局通关的量）');
  const open = taken => Talent.openingFor('ranger', taken);
  const res = [
    bench('无天赋（对照）', { opening: open([]) }),
    // 每个流派都挑**自己最强的 5 点**（拿范围/移速这些非战力节点去当"战斗流"是不公平的）
    bench('战斗流 5 点', { opening: open(['r3', 'r4', 'r1']) }),
    bench('经济流 5 点', { opening: open(['g1', 'g2', 'g3', 'g6']) }),
    bench('混合 5 点', { opening: open(['r3', 'g3', 'g2']) }),
    bench('经济流 + 商会基石', { opening: open(['g1', 'g2', 'g5']) }),
    bench('整套经济玩法', { opening: open(['g1', 'g2', 'g3', 'g6']), cardOrder: CARD_ORDER_ECON }),
    bench('整套经济 + 商会', { opening: open(['g1', 'g2', 'g5']), cardOrder: CARD_ORDER_ECON }),
    bench('贪婪流（双孢子节点）', { opening: open(['g4', 'g5']), cardOrder: CARD_ORDER_ECON })
  ];
  table('结果（' + SEEDS.length + ' 个种子平均 · 模式 ' + MODE + '）', res);

    /* 判定：**按轴**比较，不是跨轴支配。
       ---------------------------------------------------------
       原来的判据是"在所有指标上都不弱于所有其他配置"—— 但"波次"是战斗轴的
       度量、"材料"是经营轴的度量，两个流派**本该各自在自己的轴上赢**。
       实测里战斗流永远赢波次（它就是为了赢波次），于是这条判据长期报 ⚠，
       而那个 ⚠ 掩盖了真正该看的东西：**有没有哪一条轴是没人赢的**。

       现在按轴比：
         · 战斗轴 = 波次（打得深）
         · 经营轴 = 材料（打得富）—— 折扣与收获的兑现形式就是它
         · 局外轴 = 孢子（养成进度）
       判据两条：
         (a) 每条轴都要有人赢（否则那条轴上的节点是死的，没人会点）
         (b) 没有任何配置在所有轴上都不弱于他人（**那**才叫"没有选择"） */
    const AXES = {
      '战斗轴（打得深）': { get: r => r.wave, eps: 0.15, unit: '波' },
      '经营轴（打得富）': { get: r => r.materials, eps: 15, unit: '材料' },
      '局外轴（养成进度）': { get: r => r.growth, eps: 2, unit: '孢子' }
    };
    const names = Object.keys(AXES);
    console.log('\n  逐轴最强（**按轴比**，不跨轴 —— 跨轴支配是错的判据，见代码注释）');
    const leaders = {};
    for (const ax of names) {
      const A = AXES[ax];
      const best = res.reduce((a, b) => (A.get(b) > A.get(a) ? b : a));
      const second = res.filter(r => r !== best).reduce((a, b) => (A.get(b) > A.get(a) ? b : a));
      leaders[ax] = best;
      const lead = Math.abs(A.get(best) - A.get(second));
      console.log('    ' + ax.padEnd(16) + best.label.padEnd(22) +
        f1(A.get(best)) + ' ' + A.unit + '（领先第二名 ' + f1(lead) + '）' +
        (lead <= A.eps ? '  \x1b[33m⚠ 与噪声同量级\x1b[0m' : ''));
    }
    /* (b) 跨轴支配仍然查一次，但作为"真·没有选择"的告警 —— 不是判据错，是设计真的退化 */
    const METRICS = ['wave', 'materials', 'spores'];
    const EPS = { wave: 0.15, materials: 15, spores: 2 };
    const geq = (a, b, k) => a[k] >= b[k] - EPS[k];
    const dominators = res.filter(r => res.every(o => o === r || METRICS.every(k => geq(r, o, k))));
    console.log('  跨轴支配（三个轴都不弱于所有对手）：' + (dominators.length
      ? '\x1b[33m⚠ ' + dominators.map(r => r.label).join('、') + ' —— 这一次是真的"没有选择"，' +
        '不是判据错了：查一下别的流派有没有自己的轴\x1b[0m'
      : '\x1b[32m✔ 没有任何配置在三个轴上都压过对手\x1b[0m'));
    const distinct = new Set(names.map(ax => leaders[ax].label));
    console.log('  轴的多样性：' + distinct.size + '/' + names.length + ' 条轴由不同配置领先（' +
      names.map(ax => ax.split('（')[0] + '=' + leaders[ax].label).join(' · ') + '）');}

/* =========================================================
   实验二：营地组合（批次 D）
   ========================================================= */
function expCamp() {
  console.log('\n================ 工坊一：**白送**产线的摆法对比 ================');
  console.log('  （成本为 0，只回答"摆法有没有差别"；**不代表该不该建** —— 下面还有一张要花钱的表）');
  /* 与 expCampCost 同一个理由：工坊的实验必须在"真的在用产线"的策略下量
     （默认的"买优先"会让产线空转，量到的其实是货架）。 */
  setCraftPolicy('first');
  const pairs = [
    ['（无工坊）', []],
    ['熔炉+锻台（淬火）', ['furnace', 'anvil']],
    ['锻台+熔炉（同组合倒序）', ['anvil', 'furnace']],
    ['检验台+回收炉（回炉）', ['assay', 'salvage']],
    ['熔炉+检验台（无组合）', ['furnace', 'assay']],
    ['熔炉/检验台/锻台（隔开）', ['furnace', 'assay', 'anvil']],
    ['熔炉/锻台/检验台（两个组合）', ['furnace', 'anvil', 'assay']]
  ];
  const res = pairs.map(([label, camp]) => bench(label, { camp: camp.length ? camp : null }));
  table('结果（' + SEEDS.length + ' 个种子平均 · 模式 ' + MODE + '）', res);
  const base = res[0];
  console.log('\n  相对"无营地"：');
  for (const r of res.slice(1)) {
    console.log('    ' + r.label.padEnd(18) + '波次 ' + (r.wave - base.wave >= 0 ? '+' : '') + f1(r.wave - base.wave) +
      '   材料 ' + (r.materials - base.materials >= 0 ? '+' : '') + f0(r.materials - base.materials));
  }
  const best = res.slice(1).reduce((a, b) => (b.wave > a.wave ? b : a));
  console.log('  最强摆法：' + best.label + '（' + f1(best.wave) + ' 波 / ' + f0(best.growth) + ' 孢子）');
  const sameThree = res.filter(r => r.label.indexOf('三个') >= 0 || r.label.indexOf('/') >= 0);
  if (sameThree.length === 2) {
    console.log('  同样三个设施、只是顺序不同：' + sameThree.map(r => r.label + '=' + f1(r.wave) + '波').join(' vs ') +
      ' → 差 ' + f1(Math.abs(sameThree[0].wave - sameThree[1].wave)) + ' 波（这就是"摆哪儿"的价格）');
  }
  setCraftPolicy('smart');
}

function expCampAblate() {
  console.log('\n================ 工坊三：单体产线消融（查"白送为什么还更差"） ================');
  console.log('  （只建**一个**设施，12 种子 × clear 模式；工坊免费，所以任何差异都是设施本身造成的）');
  setCraftPolicy('first');
  const configs = [
    ['（无工坊）', []],
    ['只有熔炉', ['furnace']],
    ['只有配药台', ['still']],
    ['只有锻台', ['anvil']],
    ['只有检验台', ['assay']],
    ['只有回收炉', ['salvage']],
    ['熔炉+锻台（淬火）', ['furnace', 'anvil']]
  ];
  const res = configs.map(([label, camp]) => {
    const b = bench(label, { camp: camp.length ? camp : null });
    // mats/kill：**每次击杀真正被捡回来的材料**。
    // 炮塔在远处打死怪 → 掉落物落在远处 → 玩家没走过去 → 这个比值会掉下来。
    b.matsPerKill = b.materials / Math.max(1, b.kills);
    return b;
  });
  table('结果（' + SEEDS.length + ' 个种子平均 · 模式 ' + MODE + '）', res);
  const base = res[0];
  console.log('\n  相对"无营地"：');
  for (const r of res.slice(1)) {
    console.log('    ' + r.label.padEnd(18) +
      '波次 ' + (r.wave - base.wave >= 0 ? '+' : '') + f1(r.wave - base.wave) +
      '   材料 ' + (r.materials - base.materials >= 0 ? '+' : '') + f0(r.materials - base.materials) +
      '   每杀捡回 ' + r.matsPerKill.toFixed(2) + '（对照 ' + base.matsPerKill.toFixed(2) + '）' +
      '   击杀 ' + (r.kills - base.kills >= 0 ? '+' : '') + f0(r.kills - base.kills));
  }
  console.log('  读法：**每杀捡回**掉得越多，说明掉落物越没被捡回来 ——');
  console.log('  炮塔是"在远处击杀"的来源，而材料要玩家走过去才收得到。');
  setCraftPolicy('smart');
}

function expCampCost() {
  console.log('\n================ 工坊二：怎么花**材料** ================');
  console.log('  （材料是带出局的那一笔；盖设施与造装备抢同一笔钱 —— 这里比的是"盖哪几座、怎么摆"）');
  /* **造优先**：工坊的实验必须在"真的在用产线"的策略下量。
     第一版用的是默认的"买优先"，于是产线几乎空转（0.4 件/局）——
     那一版表格量到的是"买装备"，不是"工坊"，这也是 expCraft 才发现的。 */
  setCraftPolicy('first');
  const res = ['never', 'cheap', 'struct', 'combo'].map(p => {
    setCampPolicy(p);
    return bench('投工坊策略：' + ({ never: '从不投', cheap: '先盖便宜', struct: '只盖结构性', combo: '按组合顺序' })[p], {});
  });
  setCampPolicy('never');
  setCraftPolicy('smart');
  table('结果（' + SEEDS.length + ' 个种子平均 · 模式 ' + MODE + '）', res);
  const never = res[0];
  for (const r of res.slice(1)) {
    console.log('    ' + r.label.padEnd(22) + '波次 ' + (r.wave - never.wave >= 0 ? '+' : '') + f1(r.wave - never.wave) +
      '   材料 ' + (r.materials - never.materials >= 0 ? '+' : '') + f0(r.materials - never.materials) +
      '   孢子 ' + (r.growth - never.growth >= 0 ? '+' : '') + f0(r.growth - never.growth));
  }
}

/* =========================================================
   实验三：据点（批次 B/C 用）
   ========================================================= */
function expKeep() {
  console.log('\n================ 据点：三条线（经济 / 营地 / 天赋） ================');
  const owned = o => ({ owned: o });
  const res = [
    bench('（无据点）', {}),
    bench('仓库满级', { smods: owned({ storehouse: 2 }) }),
    bench('地基+工匠', { smods: owned({ foundation: 2, craftsmen: 2 }) }),
    bench('菌床满级', { smods: owned({ storehouse: 1, sporebed: 2 }) }),
    bench('结构性三项', { smods: owned({ shelves: 1, workshop: 1, range: 1, depot: 1, storehouse: 2, craftsmen: 2 }) }),
    bench('全部满级', {
      smods: owned({
        storehouse: 2, shelves: 1, clocktower: 2, foundation: 2, craftsmen: 2,
        sporebed: 2, archive: 3, workshop: 1, range: 1, depot: 2
      })
    })
  ];
  table('结果（' + SEEDS.length + ' 个种子平均 · 模式 ' + MODE + '）', res);
  const none = res[0];
  for (const r of res.slice(1)) {
    console.log('    ' + r.label.padEnd(16) +
      '波次 ' + (r.wave - none.wave >= 0 ? '+' : '') + f1(r.wave - none.wave) +
      '   材料 ' + (r.materials - none.materials >= 0 ? '+' : '') + f0(r.materials - none.materials) +
      '   商店件 ' + (r.buys - none.buys >= 0 ? '+' : '') + f1(r.buys - none.buys) +
      '   孢子 ' + (r.growth - none.growth >= 0 ? '+' : '') + f0(r.growth - none.growth));
  }
  console.log('  读法：**商店件**这一列是结构性解锁（工坊/货栈/货架）的直接证据 ——');
  console.log('  它们不改数值，改的是"你买得到什么"。');
}

/* =========================================================
   实验四：房间制的成长节奏（G4 用）
   ---------------------------------------------------------
   房间制把"一步"从一波变成了**一间房**：改造前一局约 20 步通关，
   现在 3 层 × 十几间 ≈ 40 步。曲线形状不该动，动的是"每步摊多少"。
   这个实验就是量它：同一个机器人在不同 PACE 下能走多少间。
   判据不是"越大越好"，而是**机器人能走到第几层**：
   一局的目标长度 ~39 间（三层），太早死 = 曲线太陡，太晚死/通关太轻松 = 太软。
   ========================================================= */
function expPacing() {
  console.log('\n================ 成长节奏：每步摊到多少间房 ================');
  const vals = (process.argv.indexOf('--paces') >= 0)
    ? process.argv[process.argv.indexOf('--paces') + 1].split(',').map(Number)
    : [1.0, 0.7, 0.55, 0.45];
  const res = vals.map(p => {
    Enemies.PACE = p;
    const b = bench('PACE ' + p.toFixed(2), {});
    const ws = b.rows.map(r => r.wave).sort((a, x) => a - x);
    b.pace = p;
    b.median = ws[Math.floor(ws.length / 2)];
    b.p90 = ws[Math.min(ws.length - 1, Math.floor(ws.length * 0.9))];
    b.reach20 = b.rows.filter(r => r.wave >= 20).length;
    b.reach30 = b.rows.filter(r => r.wave >= 30).length;
    return b;
  });
  Enemies.PACE = 0.55;
  table('结果（' + SEEDS.length + ' 个种子平均 · 模式 ' + MODE + '）', res);
  console.log('\n  每步摊多少（3 层 ≈ 39 间；一局的目标长度就是这么长）');
  console.log('  PACE   等效旧波次(第39间)  中位间数  P90   到 20 间  到 30 间  平均击杀');
  for (const r of res) {
    console.log('  ' + r.pace.toFixed(2).padEnd(6) +
      f1(1 + 38 * r.pace).padStart(16) +                          // 该 PACE 下第 39 间的等效旧波次
      String(r.median).padStart(9) + String(r.p90).padStart(6) +
      String(r.reach20 + '/' + r.rows.length).padStart(10) +
      String(r.reach30 + '/' + r.rows.length).padStart(10) +
      f0(r.kills).padStart(10));
  }
  console.log('  读法：中位间数应当落在"走完一层多、够不到通关"那一带（12~28 间）——');
  console.log('  太低说明曲线太陡（玩家见不到后面的房间类型），太高说明怪追不上玩家的成长。');
}

/* =========================================================
   实验五：层间契约（G5）
   ---------------------------------------------------------
   契约是**层与层之间那一次不可撤销的选择**，所以它必须满足两条：
     · 没有哪一条在所有指标上都不弱于其他所有条（否则抽到它就是答案）
     · 也没有哪一条比"不挑"还差（那就是死选项）
   这里把每条单独摆上，与"不挑"对照跑 12 个种子。
   ========================================================= */
function expBoons() {
  console.log('\n================ 层间契约：哪一条值多少（对照 = 不挑） ================');
  const Boons = globalThis.Boons;
  const res = [bench('（不挑）', {})];
  for (const d of Boons.LIST) res.push(bench(d.name, { boon: d.id }));
  table('结果（' + SEEDS.length + ' 个种子平均 · 模式 ' + MODE + '）', res);
  const base = res[0];
  console.log('\n  相对"不挑"：');
  for (const r of res.slice(1)) {
    console.log('    ' + r.label.padEnd(14) +
      '波次 ' + (r.wave - base.wave >= 0 ? '+' : '') + f1(r.wave - base.wave) +
      '   材料 ' + (r.materials - base.materials >= 0 ? '+' : '') + f0(r.materials - base.materials) +
      '   商店件 ' + (r.buys - base.buys >= 0 ? '+' : '') + f1(r.buys - base.buys) +
      '   孢子 ' + (r.growth - base.growth >= 0 ? '+' : '') + f0(r.growth - base.growth));
  }
  const METRICS = ['wave', 'materials', 'spores'];
  const EPS = { wave: 0.15, materials: 15, spores: 2 };
  const geq = (a, b, k) => a[k] >= b[k] - EPS[k];
  const dominators = res.filter(r => res.every(o => o === r || METRICS.every(k => geq(r, o, k))));
  const dead = res.slice(1).filter(r => METRICS.every(k => r[k] <= base[k] + EPS[k]) &&
    METRICS.some(k => r[k] < base[k] - EPS[k]));
  console.log('  支配性检查（容差 波次±0.15 / 材料±15 / 孢子±2）：' + (dominators.length
    ? '⚠ ' + dominators.map(r => r.label).join('、') + ' 在所有指标上都不弱于其他所有配置'
    : '✔ 没有任何契约在所有指标上都不弱于其他配置（抽到哪条要看你现在缺什么）'));
  console.log('  死选项检查：' + (dead.length
    ? '⚠ ' + dead.map(r => r.label).join('、') + ' 在三个指标上都不如"不挑"（那它等于不存在）'
    : '✔ 每一条都至少在某个指标上不输给"不挑"'));
}

/* =========================================================
   实验六：道具套装（F 的后半）
   ---------------------------------------------------------
   套装与武器联动一样是"组合"这一层，但它量的方式不同：
   道具可以无限叠，所以不能像营地那样"白送一组"。
   这里做的是**同价位对照**：四件同套道具 vs 四件不同套道具（件数相同、档次相近）。
   两者唯一的差别就是"有没有凑成一套"，所以差值就是套装的份量。
   ========================================================= */
function expItemSets() {
  console.log('\n================ 道具套装：同价位对照（四件同套 vs 四件不同套） ================');
  const open = items => ({ items: items });
  const offSet = ['helmet', 'snack', 'coffee', 'medicine'];   // 四件各属不同套（凑不成）
  const configs = [
    ['（不带道具）', null],
    ['四件不同套（对照）', offSet],
    ['拾荒 ×4', ['clover', 'magnet', 'sneaker', 'beret']],
    ['装甲 ×4', ['helmet', 'snack', 'cloak', 'charm']],
    ['兴奋剂 ×4', ['coffee', 'medicine', 'tattoo', 'coffee2']],
    ['工具 ×4', ['whetstone', 'scopeitem', 'glove', 'lens']],
    /* 更干净的一对：**同样的三件**，第 4 件一个在套里、一个不在。
       差值 = 跨档的增量 + 那两件道具本身的属性差（前者的份量更大，但不是全部）。 */
    ['装甲 3 + 同套第 4 件', ['helmet', 'snack', 'cloak', 'charm']],
    ['装甲 3 + 异套第 4 件', ['helmet', 'snack', 'cloak', 'coffee']]
  ];
  const res = configs.map(([label, items]) => bench(label, { opening: items ? open(items) : null }));
  table('结果（' + SEEDS.length + ' 个种子平均 · 模式 ' + MODE + '）', res);
  const ctrl = res[1];       // 与"四件不同套"比，隔离出"套装的份量"
  console.log('\n  相对"四件不同套"（件数一样，只差有没有凑成一套）：');
  for (const r of res.slice(2)) {
    console.log('    ' + r.label.padEnd(16) +
      '波次 ' + (r.wave - ctrl.wave >= 0 ? '+' : '') + f1(r.wave - ctrl.wave) +
      '   材料 ' + (r.materials - ctrl.materials >= 0 ? '+' : '') + f0(r.materials - ctrl.materials) +
      '   孢子 ' + (r.growth - ctrl.growth >= 0 ? '+' : '') + f0(r.growth - ctrl.growth));
  }
  console.log('  读法：机器人是**随机喂装备**的，它不会为了凑套装去挑货 ——');
  console.log('  所以这里的差值只说明"套装一旦凑成值多少"，不说明"值不值得为它挑装备"。');
  const a = res.find(r => r.label.indexOf('同套第 4 件') >= 0);
  const b2 = res.find(r => r.label.indexOf('异套第 4 件') >= 0);
  if (a && b2) {
    console.log('  最干净的一对（同样三件，第 4 件在套里 / 不在套里）：' +
      '波次 ' + f1(a.wave) + ' vs ' + f1(b2.wave) + '（' +
      (a.wave - b2.wave >= 0 ? '+' : '') + f1(a.wave - b2.wave) + '）' +
      '，材料 ' + f0(a.materials) + ' vs ' + f0(b2.materials) +
      '（' + (a.materials - b2.materials >= 0 ? '+' : '') + f0(a.materials - b2.materials) + '）');
  }
}

/* =========================================================
   实验七：制造 vs 买（"造得起的比买便宜"这句话的验证）
   ---------------------------------------------------------
   这一步之前机器人**只盖工坊不会用**，所以工坊在实验台上永远是 +0.0。
   现在它能造了，于是可以正面回答三件事：
     ① 只制造（不买货架）能不能替代购买？
     ② 材料有限时，"先造后买"与"先买后造"哪个更好？
     ③ 只造武器 vs 只造道具（道具对"只靠走位"的机器人有没有用）？
   对照必须先跑一局**满载的货架**（货架价已含 ×1.6 应急溢价），这是"买"这一侧的真实成本。
   ========================================================= */
function expCraft() {
  console.log('\n================ 制造 vs 买：货架的应急价 vs 产线的便宜价 ================');
  console.log('  （12 种子 · ' + MODE + ' 模式；工坊按便宜优先盖，三种制造策略各跑一遍）');
  const run = (label, craft, camp) => {
    setCraftPolicy(craft);
    const r = bench(label, { camp: camp || null });
    return r;
  };
  const res = [
    run('① 从不制造（对照）', 'none', ['furnace', 'anvil']),
    run('② 只制造（不买货架）', 'only', ['furnace', 'anvil']),
    run('③ 先造后买', 'first', ['furnace', 'anvil']),
    run('④ 先买后造（默认）', 'smart', ['furnace', 'anvil']),
    run('⑤ 只造道具', 'item', ['still', 'assay']),
    run('⑥ 无产线（凭空对照）', 'smart', null)
  ];
  setCraftPolicy('smart');
  table('结果（' + SEEDS.length + ' 个种子平均 · 模式 ' + MODE + '）', res);
  const base = res[0], only = res[1], mixed = res[3];
  console.log('\n  相对"从不制造"（同样两个设施、同样种子）：');
  for (const r of res.slice(1)) {
    console.log('    ' + r.label.padEnd(20) +
      '波次 ' + (r.wave - base.wave >= 0 ? '+' : '') + f1(r.wave - base.wave) +
      '   材料 ' + (r.materials - base.materials >= 0 ? '+' : '') + f0(r.materials - base.materials) +
      '   制造 ' + f1(r.crafts) + ' 件');
  }
  console.log('  读法：第 ① 行与第 ② 行的差 = **制造能不能替代购买**；' +
    '第 ③ / ④ 行的差 = 材料先后顺序值多少。');
  if (only.wave >= base.wave) {
    console.log('  → 只制造不买：波次不输给"从不制造"（' + f1(only.wave) + ' vs ' + f1(base.wave) + '）——' +
      ' 说明产线真的接上了装备栏，而不是一个好看的菜单。');
  } else {
    console.log('  → ⚠ 只制造**打不过**从不制造（' + f1(only.wave) + ' vs ' + f1(base.wave) + '）：' +
      '产线这条路的产出还跟不上货架，下一步该调的是制造费用或产能。');
  }
  void mixed;
}

/* =========================================================
   实验八：成型节奏（"顶档要几波"）
   ---------------------------------------------------------
   加 T5（神话）之后，"成型速度"第一次变成一个要量的东西 ——
   而默认机器人是**随缘拿货**，它永远攒不齐同名武器，也就永远走不到顶档。
   所以这里跑两种购买策略：
     ① 买最贵（默认）：真实但分散，档位基本跟着"商店解锁到哪一档"走
     ② 攒同名（--buy merge）：合成流的动作 —— 盯着一个名字买，逼出合成路径
   指标：第一次到 T2/T3/T4/T5 的波次（只统计**到了**的局，并给出到达率）。
   读法：T4 的波次基本由"商店第 10 波开卖 T4"决定；T5 则完全由合成/淬火决定 ——
   T5 那一列才是这一档新加的刹车，它离 T4 越远，"成型"就越慢。
   ========================================================= */
function expTiers() {
  console.log('\n================ 成型节奏：到 T2/T3/T4/T5 各要几波 ================');
  console.log('  （' + SEEDS.length + ' 种子 · ' + MODE + ' 模式；只统计到达的局，括号里是到达率）');
  /* 这一段**故意把节奏放软**：默认 PACE 0.55 下这个机器人只活 ~7 波，
     根本见不到"商店第 10 波开卖 T4"那一刻，量出来只会是"机器人的寿命"。
     所以把 PACE 放到 0.35、帧上限翻倍 —— 给它足够长的局去够顶档。
     这样得到的 T5 到达率是**上界**：真人玩得比这个机器人好，也只会更接近它。 */
  const savedCap = FRAME_CAP, savedPace = Enemies.PACE;
  FRAME_CAP = 60000; Enemies.PACE = 0.35;
  console.log('   测量条件：PACE 0.35（比默认 0.55 软）+ 帧上限 60000（约 17 分钟游戏时间）');
  const rows = [];
  for (const pol of ['greedy', 'merge']) {
    setBuyPolicy(pol);
    const r = bench(pol === 'merge' ? '攒同名（合成流）' : '买最贵（随缘）', {});
    rows.push(r);
  }
  setBuyPolicy('greedy');
  FRAME_CAP = savedCap; Enemies.PACE = savedPace;
  console.log('\n  策略'.padEnd(20) + Array.from({ length: Tiers.MAX }, (_, i) =>
    ('T' + (i + 1)).padStart(9)).join('') + '   终局最高档   武器   道具    波次');
  for (const r of rows) {
    let line = '  ' + r.label.padEnd(18);
    for (let t = 1; t <= Tiers.MAX; t++) {
      const got = r.rows.map(x => x.fit.first[t]).filter(v => v !== undefined);
      const pct = Math.round(got.length / r.rows.length * 100);
      const avg = got.reduce((a, b) => a + b, 0) / Math.max(1, got.length);
      line += (got.length ? f1(avg) + '波(' + pct + '%)' : '—').padStart(9);
    }
    line += f1(r.rows.reduce((a, x) => a + x.fit.top, 0) / r.rows.length).padStart(12) +
      f1(r.weapons).padStart(7) + f1(r.items).padStart(7) + f1(r.wave).padStart(8);
    console.log(line);
  }
  const g = rows[0], m = rows[1];
  console.log('\n  读法：');
  console.log('    · 买最贵那一行的 T2/T3/T4 只反映**商店解锁档位**（第 3/6/10 波开卖）——' +
    '它说明"成型快"有一半来自货架，而不是来自合成。');
  const mFirst = m.rows.map(x => x.fit.first[Tiers.MAX]).filter(v => v !== undefined);
  console.log('    · 攒同名那一行的 T' + Tiers.MAX + ' 才是这一档新加的刹车：到顶要 ' +
    (1 << (Tiers.MAX - 1)) + ' 把同名 T1（T4 是 ' + (1 << (Tiers.MAX - 2)) + ' 把）。');
  if (mFirst.length) {
    const avg = mFirst.reduce((a, b) => a + b, 0) / mFirst.length;
    console.log('      → 合成流实测：' + mFirst.length + '/' + m.rows.length + ' 局摸到 T' + Tiers.MAX +
      '，平均第 ' + f1(avg) + ' 波（存活到第 ' + f1(m.wave) + ' 波）——' +
      (avg < m.wave ? ' 顶档在**这一局的寿命之内**够得着，' : ' 顶档比一局的寿命还长，'));
    console.log(avg < m.wave
      ? '        说明它是一条"看得见、要专门去攒"的路，而不是遥不可及。'
      : '        说明它更像跨局的长期目标：一局通常拿不到。');
  } else {
    console.log('      → 合成流在这一轮里**一次都没摸到 T' + Tiers.MAX + '**。');
  }

  /* ---------------- 顶档的两条路：货架 vs 产线 ----------------
     机器人量不出 T4/T5（它活不到 10 间以上，而货架第 10 波才开卖 T4），
     所以这一段不靠它，直接算两条路各要多少"燃料"：
       · 货架路：同名武器的出货率（用真实的 rollShop 抽 20 万次量）
       · 产线路：3 条产线盯着一把刀造（材料收入用上面实测的每波到手材料）
     这样"成型速度"有数可依，而不是"感觉快了"。 */
  console.log('\n  —— 顶档要多少燃料（不靠机器人：它活不到那儿） ——');
  {
    const per = [];                                   // 各波"单次货架里同名武器"的期望件数
    for (let w = 1; w <= 14; w++) {
      const s = Game.newRun('ranger', 909090 + w);
      let target = null, hits = 0, rolls = 0;
      for (let i = 0; i < 20000; i++) {
        const def = Weapons.rollShop(w, () => s.rnd());
        if (!target) target = def.id;
        rolls++;
        if (def.id === target) hits++;
      }
      per.push({ w: w, p: hits / rolls });
    }
    const at = w => (per[Math.min(per.length - 1, Math.max(0, w - 1))] || per[per.length - 1]);
    console.log('    货架：4 格/间 · 目标名（T1）在单格里的概率');
    console.log('      第 1 波 ' + (at(1).p * 100).toFixed(1) + '%  ·  第 6 波 ' +
      (at(6).p * 100).toFixed(1) + '%  ·  第 10 波 ' + (at(10).p * 100).toFixed(1) +
      '%  → 每间商店期望 ' + (at(10).p * 4).toFixed(2) + ' 件同名（第 10 波起）');
    const gain = at(10).p * 4;
    console.log('      → 靠货架攒 ' + (1 << (Tiers.MAX - 1)) + ' 把同名要 **' +
      Math.round((1 << (Tiers.MAX - 1)) / Math.max(0.001, gain)) + ' 间商店**（一局只有 30~40 间）');

    const incomes = [];
    for (const r of rows) for (const v of (r.rows[0] && r.rows[0].fit.income) || []) incomes.push(v);
    incomes.sort((a, b) => a - b);
    const income = incomes.length ? incomes[Math.floor(incomes.length / 2)] : 0;
    const knife = Craft.BY_ID['weapon:knife'];
    const cost = Craft.costOf(knife, null, null);
    const LINES = 3;
    let mats = 0, have = 0, gotT4 = 0, gotT5 = 0;
    for (let w = 1; w <= 40; w++) {
      mats += income;
      for (let lane = 0; lane < LINES; lane++) {
        if (mats < cost) break;
        mats -= cost; have++;
      }
      if (!gotT4 && have >= (1 << (Tiers.MAX - 2))) gotT4 = w;
      if (!gotT5 && have >= (1 << (Tiers.MAX - 1))) gotT5 = w;
    }
    console.log('    产线：3 条产线盯着一把刀造（每波材料收入取实测中位数 ' + f0(income) +
      ' · 一把刀 ' + cost + ' 材料）');
    console.log('      → 第 ' + (gotT4 || '—') + ' 波够 ' + (1 << (Tiers.MAX - 2)) + ' 把（T4），第 ' +
      (gotT5 || '—') + ' 波够 ' + (1 << (Tiers.MAX - 1)) + ' 把（T' + Tiers.MAX + '）');
    console.log('      读法：**产线才是顶档的真实瓶颈**（每波固定产几件），货架只是补充。' +
      '所以"成型快不快"取决于产线数与材料收入，而不是档位表本身 —— ' +
      '这正是把 T5 加在合成树上（而不是货架上）的原因。');
  }
}

const which = process.argv[2] || 'all';if (which === 'probe') {
  // 只看机器人本身够不够强（够强才有分辨率去比较配置）。用 --policy auto 换策略再跑一次即可对照。
  const open = taken => Talent.openingFor('ranger', taken);
  console.log('\n策略 ' + POLICY + '（每格 = 波次 / 存活帧数 / 材料）');
  for (const cfg of [['无天赋', []], ['战斗流 5 点', ['r1', 'r2', 'r3', 'r6']], ['经济流 5 点', ['g1', 'g2', 'g3', 'g6']]]) {
    const rows = SEEDS.map(seed => runOnce({ seed, opening: open(cfg[1]) }));
    console.log('  ' + cfg[0].padEnd(14) + rows.map(r => r.wave + '/' + r.frames + '/' + r.materials).join('   '));
  }
} else {
  if (which === 'talents' || which === 'all') expTalents();
  if (which === 'camp' || which === 'all') { expCamp(); expCampAblate(); expCampCost(); }
  if (which === 'keep' || which === 'all') expKeep();
  if (which === 'pacing' || which === 'all') expPacing();
  if (which === 'boons' || which === 'all') expBoons();
  if (which === 'sets' || which === 'all') expItemSets();
  if (which === 'craft' || which === 'all') expCraft();
  if (which === 'tiers' || which === 'all') expTiers();
}
console.log('');
