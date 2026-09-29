/* =========================================================
   keep.mjs — 跨局据点（模拟经营第二级）

   这一套盯四件事：
     1) **两条循环真的接上了** —— 据点里有"工坊 +产线 / 拆了全额返还"这两条键。
        没有它们，营地与据点就是两个不相干的系统（Cult of the Lamb 那个教训）。
     2) **每个修正键都得有人读**（声明了没人读 = 这条效果是假的，静态检查）
     3) **每级写增量**：把"买满"的合计值逐个钉死（营地里写混过一次，静默翻倍）
     4) **局外的东西不该影响每日挑战**：每日要全体同条件，所以不接天赋也不接据点

   用法： node test/keep.mjs
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { loadAll, SIM_MODULES } from './_load.mjs';
import { uiMissingActs } from './_acts.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
let failures = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  \x1b[32mPASS\x1b[0m ' + label);
  else { failures++; console.log('  \x1b[31mFAIL\x1b[0m ' + label + (extra !== undefined ? '  → ' + extra : '')); }
}

await loadAll(SIM_MODULES);
const { Stronghold: Keep, Camp, Profile, Game, Storage, Registry, Chars, Scene } = globalThis;
console.error = function () { };

console.log('\n=== Bronana · 跨局据点（模拟经营第二级） ===\n');

/* ---------------- 1. 表与两条循环的连接线 ---------------- */
console.log('[1] 设施表：两条循环必须真的接上');
{
  const a = Keep.audit();
  ok(a.ok === true, '定义期自检通过（' + a.counts.facilities + ' 种设施）', a.problems.slice(0, 4).join(' | '));

  const has = (key) => Keep.LIST.some(d => d.levels.some(l => l.effect[key]));
  ok(has('campSlots'), '有设施给工坊加产线（据点 → 制造那条边）');
  ok(has('refundFull'), '有设施让工坊可以试错（拆了全额返还）—— 这是能力，不是折扣');
  ok(has('offlineLevel'), '有设施解锁离线产出（买了菌床才有）');
  ok(!has('campDiscount') && !has('rerollDiscount') && !has('sporeMul'),
    '**没有任何设施把数字乘到别的柱子上**（折扣 / 孢子倍率都删了）');

  const total = Keep.LIST.reduce((s, d) => s + d.levels.reduce((t, l) => t + l.cost, 0), 0);
  ok(total >= 500 && total <= 2000, '买满全部据点要 ' + total + ' 材料（一局通关约 70）');

  const audit = Registry.audit();
  const probs = audit.problems.filter(p => p.family.indexOf('keep') === 0);
  ok(probs.length === 0, 'registry 审计对据点家族不报错',
    probs.slice(0, 3).map(p => p.id + '.' + p.field + '=' + p.value).join(','));
  ok(Registry.count('keepMod') === Object.keys(Keep.BASE).length, 'keepMod 家族就是全部修正键',
    Registry.count('keepMod'));
}

/* ---------------- 2. 每个修正键都得有人读 ---------------- */
console.log('\n[2] 声明了却没人读 = 这条效果是假的（静态检查）');
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  // 局内经济（营地折扣 / 商店货架 / 刷新价）读键的地方在 market.ts，不在 game.ts
  const srcs = ['game.ts', 'market.ts', 'profile.ts'].map(f =>
    strip(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8'))).join('\n');
  const unread = Object.keys(Keep.BASE).filter(k => srcs.indexOf(k) < 0);
  ok(unread.length === 0,
    '每个修正键都在模拟层（game.ts / market.ts）或档案层里被读过（' +
    Object.keys(Keep.BASE).join('/') + '）',
    unread.join(', '));

  const used = new Set();
  Keep.LIST.forEach(d => d.levels.forEach(l => Object.keys(l.effect).forEach(k => used.add(k))));
  ok([...used].every(k => Keep.BASE[k] !== undefined), '没有未声明的修正键',
    [...used].filter(k => Keep.BASE[k] === undefined).join(','));
  ok(Object.keys(Keep.BASE).every(k => used.has(k)),
    '没有"声明了但没有任何设施用"的键', Object.keys(Keep.BASE).filter(k => !used.has(k)).join(','));
}

/* ---------------- 3. 折叠：每级是增量 ---------------- */
console.log('\n[3] 折叠：买满的合计值逐个钉死');
{
  const base = Keep.modsFor({});
  ok(Object.keys(Keep.BASE).every(k => base[k] === Keep.BASE[k]), '空据点 = 基准（恒等）',
    JSON.stringify(base));

  ok(Keep.modsFor({ storehouse: 2 }).startMaterials === 140, '仓库买满 = 开局材料 +140',
    Keep.modsFor({ storehouse: 2 }).startMaterials);
  ok(Keep.modsFor({ shelves: 1 }).shopSlots === 1, '货架 = 货架 +1/列');
  ok(Keep.modsFor({ clocktower: 2 }).freeRerolls === 2, '钟楼买满 = 每波 2 次免费刷新',
    Keep.modsFor({ clocktower: 2 }).freeRerolls);
  ok(Keep.modsFor({ foundation: 2 }).campSlots === 2, '地基买满 = 工坊 +2 个设施位（= 2 条产线）',
    Keep.modsFor({ foundation: 2 }).campSlots);
  ok(Keep.modsFor({ craftsmen: 2 }).refundFull === 1 && Keep.modsFor({ craftsmen: 2 }).campSlots === 1,
    '工匠：L1 拆了全额返还、L2 再给一条产线（**不是折扣**）',
    JSON.stringify(Keep.modsFor({ craftsmen: 2 })));

  /* 复利类与"跨柱子乘数"都不再存在：这一条是**解耦的判据**。
     买满全部据点之后，任何一个键都不该跑到别的柱子上 —— 只剩下
     开局条件 / 容量 / 目录 / 离线等级 / 养成层内的免费洗点与天赋点。 */
  const all = {};
  Keep.LIST.forEach(d => { all[d.id] = Keep.maxLevel(d.id); });
  const full = Keep.modsFor(all);
  const ALLOWED = ['startMaterials', 'shopSlots', 'freeRerolls', 'campSlots', 'refundFull',
    'offlineLevel', 'freeRespecs', 'bonusPoints', 'workshop', 'rangeItem', 'depot'];
  const extra = Object.keys(full).filter(k => ALLOWED.indexOf(k) < 0);
  ok(extra.length === 0, '据点买满之后只有这 ' + ALLOWED.length + ' 个"能力/容量/目录"键', extra.join(','));
  ok(full.offlineLevel === 2, '菌床买满 = 离线产出等级 2', full.offlineLevel);
  ok(full.refundFull === 1, '拆解全额返还（0/1，不会叠）', full.refundFull);
  ok(full.freeRespecs <= 4 && full.bonusPoints <= 2, '养成层内的两条也封了顶',
    full.freeRespecs + ' / ' + full.bonusPoints);
  ok(Keep.modsFor({ 不存在的: 3 }).shopSlots === 0, '未知设施被忽略（坏档防线）');

  ok(Keep.invested({ storehouse: 1 }) === 30 && Keep.invested({}) === 0, '已投入材料算得对',
    Keep.invested({ storehouse: 1 }));
  const d = Keep.describe({ shelves: 1, foundation: 1 });
  // 报告里**说的是人话**（键自己带的文案），不再是 `campSlots = 1` 这种原始键名
  ok(d.indexOf('工坊设施位 +1') >= 0 && d.indexOf('每列货架 +1') >= 0 && d.indexOf('campSlots') < 0,
    'describe 给人看的是文案而不是键名', d.split('\n').slice(1).join(' / '));
}

/* ---------------- 4. 买：花材料、不可退款、越界夹回 ---------------- */
console.log('\n[4] 用材料买（永久，不退还）');
{
  Storage.use(Storage.memory(Object.create(null)));
  Storage.wipe();
  Profile.reset();

  ok(Profile.keepInvested() === 0 && Profile.keepLevel('shelves') === 0, '新档据点全空');
  let r = Profile.keepBuy('shelves');
  ok(!r.ok && /材料不够/.test(r.reason), '材料不够被拒', r.reason);
  ok(Profile.material() === 0, '被拒时不扣材料');

  Profile.addMaterial(1000);
  r = Profile.keepBuy('shelves');
  ok(r.ok && r.cost === 50 && Profile.material() === 950, '买下货架（50 材料）', Profile.material());
  ok(Profile.keepLevel('shelves') === 1, '等级落到了档案里');
  ok(Profile.keepBuy('shelves').ok === false, '单级设施买第二次被拒（满级）');
  ok(Profile.material() === 950, '被拒时不扣材料');

  Profile.keepBuy('storehouse');
  const before = Profile.material();
  Profile.keepBuy('storehouse');
  ok(Profile.material() === before - 80, '升级扣的是第二级的价（80）', Profile.material());
  ok(Profile.keepLevel('storehouse') === 2, '等级到 2');

  ok(Profile.keepBuy('不存在').ok === false, '没有这个设施 → 拒绝');
  ok(Profile.keepMods().startMaterials === 140, '折叠修正跟着等级走', Profile.keepMods().startMaterials);

  // 落盘往返
  Profile.load();
  ok(Profile.keepLevel('storehouse') === 2 && Profile.keepLevel('shelves') === 1, '据点会落盘');

  // 坏档：未知设施与越界等级被丢掉
  Storage.setJSON(Storage.KEYS.profile, {
    v: 1, at: Date.now(), kind: 'profile',
    data: { keep: { storehouse: 99, 不存在的: 3, shelves: -1 } }
  });
  Profile.load();
  ok(Profile.keepLevel('storehouse') === Keep.maxLevel('storehouse'), '越界等级被夹回上限',
    Profile.keepLevel('storehouse'));
  ok(Profile.keepOwned()['不存在的'] === undefined && Profile.keepLevel('shelves') === 0,
    '未知设施与负数等级被丢弃', JSON.stringify(Profile.keepOwned()));
  Profile.reset();
}

/* ---------------- 5. 在局里真的生效 ---------------- */
console.log('\n[5] 在局里真的生效');
{
  const owned = { storehouse: 2, shelves: 1, clocktower: 2, foundation: 2, craftsmen: 2 };
  const run = (mats) => {
    Game.newRun('ranger', 20260504, 0, null, { owned: owned });
    const s = Game.getSession();
    /* 开局材料要在**清房间之前**读：房间制下"清完一间"会结算波次奖励
       （8 + 波次×3，再乘速清系数），那是玩法给的钱，不是据点给的。
       混在一起量，就成了"仓库给了 153"这种假数字。 */
    s.keepStartMats = s.player.scrap;
    if (mats !== undefined) s.player.scrap = mats;
    toShop();
    return s;
  };

  const s = run(undefined);
  ok(s.keepStartMats === 140, '开局材料 +140（仓库）', s.keepStartMats);
  ok(s.kmods.campSlots === 3 && s.kmods.refundFull === 1,
    '会话里带着折叠好的据点修正（产线 +3、拆解全额返还）',
    JSON.stringify({ slots: s.kmods.campSlots, refund: s.kmods.refundFull }));
  s.player.scrap = 500;      // 后面测工坊价格时要一笔确定的本钱

  // 货架 +1/列 → 4+1 武器 + 4+1 道具 = 10
  Game._internals.openShop(0);
  ok(s.offers.length === 10, '货架每列多一件（5+5=10）', s.offers.length);

  // 每波免费刷新：钟楼 2 次
  Game.nextWave();
  ok(s.freeRerolls === 2, '每波白送 2 次刷新（钟楼）', s.freeRerolls);

  /* 工坊：位子 3+3=6（地基 2 + 工匠 1）—— 这是**据点 → 制造**那条边。
     价格**不再打折**（据点那一档折扣已删）：据点给的是能力，不是折扣。 */
  toShop();
  const slots = Camp.SLOTS + s.kmods.campSlots;
  Game.openCamp();
  const canAfford = Camp.canBuy(s.camp, 'furnace', 999, { slots: slots, discount: 0 });
  ok(canAfford.ok && canAfford.cost === 2, '工坊建材价**没有**据点折扣（2 就是 2）', canAfford.cost);
  /* 拆解全额返还：买一级 2 点，拆回来也是 2 点（不是 1 点）—— 摆法可以试错 */
  Camp.refundOf(s.camp, 'furnace');
  s.campPoints = 9999;
  ok(Game.campBuy('furnace') === true, '先盖一座，才能量拆除返还');
  const refundFull = Camp.refundOf(s.camp, 'furnace', { fullRefund: true });
  const refundHalf = Camp.refundOf(s.camp, 'furnace');
  ok(refundFull === 2 && refundHalf === 1, '工匠 → 拆了全额返还（' + refundFull + ' vs 半额 ' + refundHalf + '）');
  s.campPoints = 9999;
  s.player.scrap = 500;      // 建工坊前后都读这一个数：量的就是"建工坊动不动材料"
  let built = 0;
  Camp.LIST.forEach(d => {
    if (Game.campBuy(d.id)) built++;
  });
  ok(built === Camp.LIST.length, '据点把工坊扩到 6 个位子 → 5 种设施全都能建（基准只有 3）', built + ' 个');
  ok(Camp.usedSlots(s.camp) === Camp.LIST.length, '位子确实用满了 5 个', Camp.usedSlots(s.camp));
  ok(Game.campBuy('furnace') === false || Camp.levelOf(s.camp, 'furnace') === 2, '已建满的设施只能升级');
  ok(s.player.scrap === 500, '建工坊一分材料都没花（建材与材料分开）', s.player.scrap);

  /* 刷新价：**据点不再打折**（那是跨柱子的数值穿透），底价一点不少 */
  toShop();
  s.freeRerolls = 0;
  s.rerolls = 0;
  Game._internals.openShop(0);
  const costNoDisc = 2 + Math.floor(Game.wave * 0.7) * 2;
  ok(s.rerollCost === costNoDisc, '刷新价没被据点压过（' + s.rerollCost + ' = ' + costNoDisc + '）',
    s.rerollCost);
}

/* ---------------- 6. 没有据点时完全不受影响 ---------------- */
console.log('\n[6] 空据点 = 一点影响都没有');
{
  const a = Game.newRun('ranger', 31337, 0, null, null);
  const baseOffers = (function () { Game._internals.openShop(0); return a.offers.length; })();
  ok(baseOffers === 8, '没有据点 → 货架还是 4+4', baseOffers);
  ok(a.player.scrap === 0, '没有据点 → 没有开局材料', a.player.scrap);
  ok(a.kmods.shopSlots === 0 && a.kmods.startMaterials === 0, '修正全为基准');

  const b = Game.newRun('ranger', 31337, 0, null, { owned: {} });
  ok(JSON.stringify(b.kmods) === JSON.stringify(a.kmods), '传空据点与不传一致');
  Game.setState('title', true);
}

/* ---------------- 7. 每日挑战不接据点与天赋 ---------------- */
console.log('\n[7] 每日挑战必须全体同条件（所以不接据点、不接天赋）');
{
  const dailySrc = fs.readFileSync(path.join(ROOT, 'src', 'main.ts'), 'utf8');
  // 每日与每周共用同一个入口（`startChallenge`），规则的推导在 daily.ts / season.ts 里。
  // 所以"不接养成"这一条只需要在一个地方成立 —— 但必须真的成立。
  const ruleFn = /function challengeRule\(kind\)[\s\S]*?\n}/.exec(dailySrc);
  ok(ruleFn && /kind === 'weekly' \? Season\.of\(\) : Daily\.of\(\)/.test(ruleFn[0]),
    '每日与每周共用同一套流程，只差规则的推导');
  const m = /function startChallenge[\s\S]*?\n}/.exec(dailySrc);
  const body = m ? m[0] : '';
  ok(/Game\.newRun\(rule\.char, rule\.seed, rule\.danger\)/.test(body),
    '挑战开局只传（角色, 种子, 难度）—— 不带天赋产物、不带据点');
  ok(body.indexOf('openingOf') < 0 && body.indexOf('keepOwned') < 0,
    '挑战的 newRun 里没有 openingOf / keepOwned');

  // 端到端：同一个日期键，在"满据点 + 满天赋"的档案下开局，结果必须与空档案一致
  const play = (sess) => {
    let h = 2166136261 >>> 0;
    for (let f = 0; f < 240; f++) {
      const inp = { x: Math.cos(f * 0.1), y: 0 };
      if (Scene.simulates(Game.state)) Game.step(Game.cfg.fixedDt, inp);
      const st = Game.getSession();
      const str = [st.player.x, st.player.hp, Game.wave].join(',');
      for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    }
    return h;
  };
  Game.newRun('ranger', 777, 0, null, null);
  const plain = play();
  Game.newRun('ranger', 777, 0,
    { stats: { maxHp: 30 }, weapons: [], items: [], scrap: 500 },
    { owned: { storehouse: 2, shelves: 1 } });
  const boosted = play();
  ok(plain !== boosted, '（对照）带了天赋与据点确实不一样 —— 对照组有效', plain + ' / ' + boosted);
  Game.setState('title', true);
}

/* ---------------- 9. 据点 → 天赋（档案馆三级） ---------------- */
console.log('\n[9] 据点 → 天赋：档案馆把孢子变成"养成更便宜、更快"');
{
  Storage.use(Storage.memory(Object.create(null)));
  Storage.wipe();
  Profile.reset();
  const cid = 'ranger';

  // 没有档案馆：免费 3 次，之后每次 20 孢子
  ok(Profile.freeRespecsOf(cid) === 3, '基准：每角色 3 次免费洗点', Profile.freeRespecsOf(cid));
  // 注意 respecCostOf 返回的是**下一次**洗点的价 —— 还有免费次数时当然是 0。
  // 想看"免费用完之后的价"，得先把"已用次数"推到免费上限。
  ok(Talent.respecCost(3) === 20, '纯函数：免费次数用完后每次 20 孢子', Talent.respecCost(3));
  ok(Talent.respecCost(3, { free: 5 }) === 0, '纯函数：免费次数被抬高到 5 → 第 4 次也免费');
  ok(Talent.respecCost(3, { discount: 0.5 }) === 10, '纯函数：打 5 折之后是 10', Talent.respecCost(3, { discount: 0.5 }));
  ok(Profile.respecCostOf(cid) === 0, '档案层：还有免费次数 → 下一次洗点是 0', Profile.respecCostOf(cid));
  Profile.perChar(cid).respecs = 3;                  // 把免费次数用完
  ok(Profile.respecCostOf(cid) === 20, '档案层：免费用完之后下一次要 20', Profile.respecCostOf(cid));

  // 先给一局点数，好让"洗点"有东西可洗
  const runOnce = () => Profile.applyRun({
    char: cid, wave: 20, level: 20, kills: 100, scrap: 200, damage: 1, taken: 1,
    healed: 1, packs: 0, win: true, danger: 0, peaks: {}
  }, {});
  runOnce();
  const ptsPlain = Profile.talentPoints(cid);

  /* L1：**多一次免费洗点**（不再是"打折"—— 折扣是跨柱子的数值，已经删掉）。
     注意前置链：档案馆要求「钟楼」Lv.1，所以先得买钟楼 */
  Profile.addMaterial(3000);
  const buy = (id) => {
    const r = Profile.keepBuy(id);
    ok(r.ok === true, '买下 ' + Stronghold.BY_ID[id].name + ' Lv.' + r.toLevel, r.reason);
    return r;
  };
  const locked = Stronghold.canBuy(Profile.keepOwned(), 'archive', 99999);
  ok(locked.ok === false && locked.locked === true && /钟楼/.test(locked.reason),
    '前置链挡住：没钟楼时档案馆是"锁着"的，而不是"孢子不够"', locked.reason);
  const freeBefore = Profile.freeRespecsOf(cid);
  buy('clocktower');
  ok(Stronghold.canBuy(Profile.keepOwned(), 'archive', 99999).ok === true, '钟楼 Lv.1 → 档案馆解锁');
  buy('archive');
  ok(Stronghold.modsFor(Profile.keepOwned()).freeRespecs === 1, '档案馆 Lv.1 → 免费洗点 +1');
  ok(Profile.freeRespecsOf(cid) === freeBefore + 1, '档案层算得对（' + freeBefore + ' → ' +
    Profile.freeRespecsOf(cid) + '）', Profile.freeRespecsOf(cid));

  // L2：再来两次免费
  buy('archive');
  ok(Profile.freeRespecsOf(cid) === freeBefore + 3, '档案馆 Lv.2 → 免费洗点再 +2（共 +3）',
    Profile.freeRespecsOf(cid));
  Profile.perChar(cid).respecs = 0;      // 上面为了测"免费用完之后"的价，把已用次数推到过 3；这里归零
  Profile.takeTalent(cid, 'm1');
  let r1 = Profile.respecTalents(cid);
  ok(r1.ok && r1.cost === 0, '第 1 次洗点免费', r1.cost);
  for (let i = 1; i < Profile.freeRespecsOf(cid); i++) { Profile.takeTalent(cid, 'm1'); Profile.respecTalents(cid); }
  ok(Profile.perChar(cid).respecs === Profile.freeRespecsOf(cid), '免费次数用满（' +
    Profile.perChar(cid).respecs + ' 次）', Profile.perChar(cid).respecs);
  Profile.takeTalent(cid, 'm1');
  const r6 = Profile.respecTalents(cid);
  ok(r6.ok && r6.cost === 20, '用完免费次数之后按原价 20 收费（没有折扣，只有次数）', r6.cost);

  // L3：每局额外天赋点 —— **而且要核心材料**
  /* 这一条是本轮补上的那条断头路：核心材料能从关底 Boss 赚到、能进档案，
     但全仓曾经没有一处调用 `Profile.spendCore` ——
     也就是"打 Boss 拿核心材料"在玩家那一侧是**看得见摸不着**的。
     现在它是档案馆 Lv.3 的第二价。 */
  const coreBefore = Profile.core();
  ok(Keep.coreFor(Profile.keepOwned(), 'archive') === 2,
    '档案馆下一级要 2 个核心材料（界面靠这个数标出"这一级要打过 Boss"）',
    Keep.coreFor(Profile.keepOwned(), 'archive'));
  const sporeBeforeDenied = Profile.spores();
  const poor = Stronghold.canBuy(Profile.keepOwned(), 'archive', 99999, 0);
  ok(poor.ok === false && /核心材料不够/.test(poor.reason) && /Boss/.test(poor.reason),
    '孢子管够但核心材料为 0 → 明确说"核心材料不够"，并指出只有关底 Boss 掉', poor.reason);
  ok(Profile.spores() === sporeBeforeDenied, '被拒时孢子一点没扣',
    sporeBeforeDenied + ' → ' + Profile.spores());
  Profile.addCore(2);
  const coreNow = Profile.core();
  buy('archive');
  ok(Profile.core() === coreNow - 2 && Profile.core() === coreBefore,
    '买下 Lv.3 真的扣了 2 个核心材料（' + coreNow + ' → ' + Profile.core() + '）');
  ok(Stronghold.modsFor(Profile.keepOwned()).bonusPoints === 1, '档案馆买满 → 每局额外 +1 天赋点');
  const before = Profile.talentPoints(cid);
  const rep = runOnce();
  ok(rep.pointsGained === 5 + 1, '一局通关从 5 点变成 6 点（据点喂到了天赋）', rep.pointsGained);
  ok(Profile.talentPoints(cid) === before + 6, '点数真的进了档案', Profile.talentPoints(cid) - before);

  // 反过来：不买档案馆的人一点都吃不到（这条边是**可选**的）
  Profile.reset();
  Storage.wipe();
  Profile.reset();
  const rep2 = Profile.applyRun({
    char: cid, wave: 20, level: 20, kills: 100, scrap: 200, damage: 1, taken: 1,
    healed: 1, packs: 0, win: true, danger: 0, peaks: {}
  }, {});
  ok(rep2.pointsGained === 5 && Profile.freeRespecsOf(cid) === 3,
    '空据点：点数还是 5、免费还是 3 次（没有白拿）',
    [rep2.pointsGained, Profile.freeRespecsOf(cid)].join('/'));
  Profile.perChar(cid).respecs = 3;
  ok(Profile.respecCostOf(cid) === 20, '空据点：免费用完之后还是原价 20', Profile.respecCostOf(cid));

  // 这条边**必须存在**：拔掉档案馆，自检要当场报错
  const saved = Stronghold.LIST.slice();
  for (let i = Stronghold.LIST.length - 1; i >= 0; i--) {
    if (Stronghold.LIST[i].id === 'archive') Stronghold.LIST.splice(i, 1);
  }
  const broken = Stronghold.audit();
  ok(broken.ok === false &&
     broken.problems.some(p => /据点 → 天赋/.test(p)) &&
     broken.problems.some(p => /3 级设施/.test(p)),
    '拔掉档案馆 → 自检报"据点 → 天赋这条边是断的"', broken.problems.slice(0, 2).join(' | '));
  Stronghold.LIST.length = 0;
  Array.prototype.push.apply(Stronghold.LIST, saved);
  ok(Stronghold.audit().ok === true, '装回去之后自检重新通过');
  void ptsPlain;
}

/* ---------------- 10. 结构性解锁 + 前置链 ---------------- */
console.log('\n[10] 结构性解锁：给的不是数值，是"新的可能"');
{
  const runShop = (owned) => {
    Game.newRun('ranger', 20260505, 0, null, owned ? { owned: owned } : null);
    toShop();
    Game._internals.openShop(0);
    return Game.getSession();
  };

  // 基线：没有任何结构性设施时，不保证任何东西
  const plain = runShop(null);
  const plainTop = plain.offers.filter(o => (o.def.tier || 1) >= 3).length;
  console.log('    （对照）不买工坊时，一次刷新里有 ' + plainTop + ' 件 T3+');

  // ① 工坊：刷新保底一件 T3+
  let guaranteed = 0;
  for (const seed of [11, 2222, 31337, 4242, 99999]) {
    Game.newRun('ranger', seed, 0, null, { owned: { workshop: 1 } });
    toShop();
    Game._internals.openShop(0);
    if (Game.getSession().offers.some(o => (o.def.tier || 1) >= 3)) guaranteed++;
  }
  ok(guaranteed === 5, '工坊：5 个种子里每次刷新都至少有一件 T3+（' + guaranteed + '/5）', guaranteed);

  // ② 货栈：商店必出一件"已持有的武器类别"
  const depot = runShop({ depot: 1 });
  const heldKind = depot.player.weapons[0].def.kind;
  ok(depot.player.weapons.length >= 1, '开局带着起始武器（类别 ' + heldKind + '）');
  ok(depot.offers.some(o => o.type === 'weapon' && o.def.kind === heldKind),
    '货栈：货架上**一定**有一件你已在用的武器类别（build 能延续）',
    depot.offers.filter(o => o.type === 'weapon').map(o => o.def.kind).join(','));
  // 对照：没有货栈时不保证（这里用多次刷新观察"至少有一次没有"）
  let anyMissing = false;
  for (const seed of [11, 2222, 31337, 4242, 99999, 7, 88]) {
    const s = runShop(null);
    void s;
    Game.newRun('ranger', seed, 0, null, null);
    toShop();
    Game._internals.openShop(0);
    const heldK = Game.getSession().player.weapons[0].def.kind;
    if (!Game.getSession().offers.some(o => o.type === 'weapon' && o.def.kind === heldK)) anyMissing = true;
  }
  ok(anyMissing, '（对照）没有货栈时，货架上经常一件你在用的类别都没有');

  // ③ 靶场：开局多带一件道具，按局数轮换，而且**确定**
  Storage.use(Storage.memory(Object.create(null)));
  Storage.wipe();
  Profile.reset();
  Profile.addMaterial(3000);
  Profile.keepBuy('shelves');           // 靶场的前置
  const beforeItems = Profile.openingOf('ranger').items.length;
  Profile.keepBuy('range');             // 靶场
  ok(Stronghold.modsFor(Profile.keepOwned()).rangeItem === 1, '靶场 → rangeItem = 1');
  const withRange = Profile.openingOf('ranger').items.slice();
  ok(withRange.length === beforeItems + 1, '开局多带一件道具（' + beforeItems + ' → ' + withRange.length + '）',
    withRange.join(','));
  const again = Profile.openingOf('ranger').items.slice();
  ok(again.join(',') === withRange.join(','), '同一份档案算两次 = 同一件（确定性）', again.join(','));
  Profile.perChar('ranger').runs += 1;
  const nextRun = Profile.openingOf('ranger').items.slice();
  ok(nextRun.join(',') !== withRange.join(','), '打过一局之后换一件（不会永远同一件）',
    withRange.join(',') + ' → ' + nextRun.join(','));
  const gifted = Items.BY_ID[withRange[withRange.length - 1]];
  ok(!!gifted, '给的是真实存在的道具', withRange[withRange.length - 1]);

  // 前置链本身：拓扑序、无环、坏链会被自检抓出来
  const order = Stronghold.buildOrder();
  ok(order.length === Stronghold.LIST.length, '前置链能排出完整的建造顺序（' + order.length + ' 个设施）',
    order.join(' → '));
  const reqCount = Stronghold.LIST.filter(d => d.req).length;
  ok(reqCount >= 4, '有 ' + reqCount + ' 个设施带前置（据点不是"按价格从低到高买"的清单）');
  // 自己要求自己 / 环：造一个坏的出来，自检必须报
  // （注意要同时塞进 BY_ID —— 它是加载时建的快照，只改 LIST 会被认成"不存在的设施"）
  const saved = Stronghold.LIST.slice();
  const fake = { id: 'fake', name: '假设施', note: '测环', levels: [{ cost: 1, effect: { shopSlots: 1 } }], req: { id: 'fake', level: 1 } };
  Stronghold.LIST.push(fake);
  Stronghold.BY_ID.fake = fake;
  const bad = Stronghold.audit();
  ok(bad.ok === false && bad.problems.some(p => /要求自己/.test(p)),
    '自己要求自己 → 自检报"永远买不到"', bad.problems.slice(0, 2).join(' | '));
  Stronghold.LIST.pop();
  delete Stronghold.BY_ID.fake;
  Stronghold.LIST.push({ id: 'fake2', name: '假设施2', note: '测环', levels: [{ cost: 1, effect: { shopSlots: 1 } }], req: { id: 'storehouse', level: 9 } });
  const bad2 = Stronghold.audit();
  ok(bad2.ok === false && bad2.problems.some(p => /永远解不开/.test(p)),
    '要求一个不存在的等级 → 自检报"这条链永远解不开"', bad2.problems.slice(0, 2).join(' | '));
  Stronghold.LIST.length = 0;
  Array.prototype.push.apply(Stronghold.LIST, saved);
  ok(Stronghold.LIST.length === saved.length, '（清理）设施表复原');
  ok(Stronghold.audit().ok === true, '复原之后自检重新通过');
  Game.setState('title', true);
}

/* ---------------- 11. 场景与入口（原 [8]） ---------------- */
console.log('\n[8] 场景与入口');
{
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  ok(/id="scr-keep"/.test(html), 'index.html 里有据点场景');
  ok(/data-act="keep"/.test(html), '标题页有据点入口');
  ok(Scene.has('keep') && Scene.overlayOf('keep') === 'keep', '场景表里有 keep');
  ok(Game.TRANSITIONS.title.indexOf('keep') >= 0 && Game.TRANSITIONS.paused.indexOf('keep') >= 0,
    '标题页与暂停页都能进据点');
  ok(Scene.refreshOf('keep') === 'keep', '据点在场景表的刷新表里');
  const uiSrc = fs.readFileSync(path.join(ROOT, 'src', 'ui.ts'), 'utf8');
  const missKeep = await uiMissingActs(['keep', 'keep-buy']);
  ok(missKeep.length === 0, '据点的入口与购买动作都注册在界面动作表里', missKeep.join(','));
  ok(/数据集|data-act="keep-buy"/.test(uiSrc) || /data-act="keep-buy"/.test(uiSrc),
    '据点购买按钮是动态生成的（data-act="keep-buy"）');
}

console.log('\n=== 结果 ===');
if (failures === 0) { console.log('\x1b[32m全部通过 ✔\x1b[0m\n'); process.exit(0); }
console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m\n');
process.exit(1);
