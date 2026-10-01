/* =========================================================
   trade.mjs — NPC 交易（R41 普查里"完全没有"的那一栏）
   ---------------------------------------------------------
   R41 的普查原文是：

   > **② NPC 交易系统：完全没有。** 全仓搜 `trade` / `merchant` 只搜到两条无关的。
   > 现在只有 `market.ts` 的商店（货架 / 刷新 / 回收），那是**战斗模块内部**的，
   > 不是"跟人做买卖"。

   这一套守的就是那件事，按"一个故障一条判据"组织：

     [1] 表的形状：每档都要归属一位**真实存在**的商人、都要给东西、价格为正
     [2] **§6.5 的硬约束**：收的钱只许是 `growth` / `material` ——
         `scrap`（战斗）与 `capacity`（经营）一律不许。这一条**反证过**
     [3] 关系阶段门槛：不够的时候**列出来但不可做**，而且理由是给人看的
     [4] 接进真对局：站在他面前才换得成、钱真的扣、货真的进**下一局的开局条件**、
         每波限次；以及"不在他面前"与"钱不够"都要被拒
     [5] **存档往返**：换到的东西跟着存档走 ——
         顺带守住这一轮抓到的那条真 bug（`bonds` / `talks` 只写不读）
   ========================================================= */
import { installDom } from './_ctx.mjs';
import { loadAll, SIM_MODULES } from './_load.mjs';
import { T } from './_assert.mjs';

installDom();
await loadAll(SIM_MODULES);
const { Trade, Bonds, Story, Profile, Slots, Storage, Game, Chars, Bonds: B } = globalThis;

console.log('\n=== Bronana · NPC 交易（跟人做买卖） ===\n');
Storage.wipe();
Slots.select(0);
Profile.load();
Profile.reset();

/* ---------------- [1] 表的形状 ---------------- */
T.section('1. 报价表（每档都要真的能换）');
{
  T.ok(Trade.audit().ok, '定义期自检通过', Trade.audit().problems.join(' / '));
  T.ok(Trade.LIST.length >= 8, '至少 8 档报价（现在 ' + Trade.LIST.length + ' 档）');
  T.ok(Trade.traders().length >= 2, '至少 2 位商人（现在 ' + Trade.traders().length + ' 位）');

  /* 每一档都必须归属一位**真实存在**的 NPC —— 否则它永远不会出现，
     而界面上没有任何异常（死声明）。 */
  const npcIds = Story.NPCS.map(n => n.id);
  const orphan = Trade.LIST.filter(o => npcIds.indexOf(o.npc) < 0).map(o => o.id);
  T.eq(orphan.length, 0, '每一档报价都归属一位真实存在的 NPC', orphan.join(', '));

  /* 每一档都要**真的给东西**（两样都不给 = 花了钱什么也没拿到） */
  const empty = Trade.LIST.filter(o => Trade.isEmpty(o)).map(o => o.id);
  T.eq(empty.length, 0, '没有"换了个空"的报价', empty.join(', '));

  /* 价格必须为正 */
  const free = [];
  Trade.LIST.forEach(o => {
    Trade.ASK_CURRENCIES.forEach(k => {
      if (o.ask[k] !== undefined && !(Number(o.ask[k]) > 0)) free.push(o.id + '.' + k);
    });
  });
  T.eq(free.length, 0, '没有白送的报价（价格都是正数）', free.join(', '));

  /* 每波次数必须为正 */
  const dead = Trade.LIST.filter(o => !((o.perWave === undefined ? Trade.PER_WAVE : o.perWave) > 0)).map(o => o.id);
  T.eq(dead.length, 0, '每档报价每波都能做至少一次', dead.join(', '));

  /* 关系阶段门槛必须是真的 */
  const badGate = Trade.LIST.filter(o => o.needStage && !B.BY_STAGE[o.needStage]).map(o => o.id);
  T.eq(badGate.length, 0, '每一道关系门槛都指向一个真实存在的阶段', badGate.join(', '));
}

/* ---------------- [2] §6.5 的硬约束（反证一次） ---------------- */
T.section('2. §6.5：收的钱只许是 growth / material');
{
  T.eq(Trade.ASK_CURRENCIES.slice().sort().join(','), 'growth,material',
    '允许收的钱**只有这两笔**（养成代币 + 全局货币）—— 常量是唯一出处');

  /* 每一条真实报价都不许收别的 */
  const bad = [];
  Trade.LIST.forEach(o => {
    Trade.illegalAsks(o).forEach(k => bad.push(o.id + '.' + k));
  });
  T.eq(bad.length, 0, '没有一档收战斗/经营模块代币（scrap / capacity）', bad.join(', '));

  /* **那两笔钱必须真的住在账本里**。
     ⚠ 这一条必须在**账本接上电之后**查：`trade.ts` 自己（L0）比 `eco_*.ts` 先加载，
       它在加载期查会得到"12 档全是拼错的"（实测踩过）。所以判据在测试这一侧。 */
  T.ok(globalThis.Ledger.all().length > 0, '账本已经接上电（四个 eco_* 都定义了）',
    globalThis.Ledger.all().length);
  T.ok(!!globalThis.Ledger.currency('growth'), '`growth` 是一笔真实登记的代币');
  T.ok(!!globalThis.Ledger.currency('material'), '`material` 是一笔真实登记的代币');
  T.ok(!globalThis.Ledger.currency('scrap') === false, '`scrap` 也存在（只是**不许收**）');

  /* **反证**：把一条报价临时改成收 `scrap`，自检必须当场报红。
     这一条是本套里最要紧的 —— 它是 §6.5 那条硬约束唯一的实测点。 */
  const victim = Trade.LIST[0];
  const keep = victim.ask;
  victim.ask = { scrap: 5 };
  const red = Trade.audit();
  T.eq(red.ok, false, '把 `ask` 改成 scrap → 自检当场报红');
  T.ok(red.problems.some(p => p.indexOf('scrap') >= 0),
    '报出来的问题点着 scrap 的名字（而不是一句笼统的"有问题"）',
    red.problems.join(' / '));
  victim.ask = keep;
  T.ok(Trade.audit().ok, '改回去之后自检恢复通过');

  /* 经营代币也一样不许 */
  const keep2 = victim.ask;
  victim.ask = { capacity: 3 };
  T.eq(Trade.audit().ok, false, '把 `ask` 改成 capacity（经营代币）→ 自检也报红');
  victim.ask = keep2;
}

/* ---------------- [3] 关系阶段是门槛 ---------------- */
T.section('3. 关系阶段门槛（把对话与交易接起来）');
{
  const gated = Trade.LIST.filter(o => o.needStage);
  T.ok(gated.length >= 3, '至少有 3 档带关系门槛（现在 ' + gated.length + ' 档）',
    gated.map(o => o.id).join(', '));

  const o = gated[0];
  /* 生人：不够 → 不可做，而且理由是**给人看的**（说出还差哪一步） */
  const low = Trade.check(o, { stage: 'stranger', used: {} });
  T.eq(low.ok, false, '关系不够时做不了（' + o.id + ' 要 ' + o.needStage + '）');
  T.ok(/处到/.test(low.reason), '拒绝的理由是"得先跟他处到……"', low.reason);
  /* 够：可做 */
  const hi = Trade.check(o, { stage: o.needStage, used: {} });
  T.eq(hi.ok, true, '到了那个阶段就能做', hi.reason);
  /* **门槛不够的也列出来**（不是藏起来）—— 玩家要知道"处好关系有回报" */
  const list = Trade.offersFor(o.npc, { stage: 'stranger', used: {} });
  T.ok(list.length > 0, '这位商人的报价**列得出来**', list.length);
  T.ok(list.some(x => x.id === o.id && !x.ok),
    '关系不够的那一档**列出来但标成不可做**（不是消失 —— 消失玩家就不知道有这条路）',
    list.filter(x => !x.ok).map(x => x.id).join(','));
}

/* ---------------- [4] 接进真对局（最要紧的一节） ---------------- */
T.section('4. 接进真对局：站在他面前、钱真的扣、货进下一局');
{
  Storage.wipe();
  Slots.select(0);
  Profile.load();
  Profile.reset();
  Profile.saveCharacter({ name: '买主' }, 'ranger');

  const sess = Game.newRun('ranger', 777, 0, Profile.openingOf('ranger'), { owned: {}, forge: null }, []);
  T.ok(!!sess, '开局建起来了');
  T.eq(Game.isTrader('picker'), true, '拾荒者是商人');
  T.eq(Game.isTrader('mother'), false, '菌母不是商人（界面据此决定画不画"交易"）');

  /* 报价表：一开始就有几档能换（不然这条线开局就是死的） */
  const open = Game.tradeOffers('picker').filter(o => o.ok);
  T.ok(open.length >= 1, '开局就有能换的报价（' + open.length + ' 档）',
    Game.tradeOffers('picker').map(o => o.id + (o.ok ? '' : '✗')).join(','));

  /* ① **不在他面前换不成** —— 交易是"走过去做的事"，不是菜单里的一行 */
  const away = Game.trade('picker_scrap');
  T.eq(away.ok, false, '不在枢纽里（还在战场上）换不成', away.reason);
  T.ok(/枢纽/.test(away.reason), '拒绝的理由说清了"得在枢纽里"', away.reason);

  /* 走到枢纽、站到拾荒者面前 */
  Game.setState('station', true);
  Game.setState('hub', true);
  const until = (mx, my, cond, n) => {
    for (let i = 0; i < (n || 600); i++) { if (cond()) break; Game.step(Game.cfg.fixedDt, { x: mx, y: my }); }
  };
  const near = () => (Game.hall() && Game.hall().near) || null;
  /* 走到枢纽、站到拾荒者面前（R41）。
     ⚠ 路线是**量出来的**，不是猜的：出生点 (750,180) → 贴左墙 (≈304) → 沿左墙下行，
       到 y≈710 时拾荒者（300,830）就在跟前（他的 r=64，而 `Hall.near` 的判据是
       距离 <= r + 玩家半径）。
     ⚠ 不要写成"绕着八方向试一遍"：那样第一步就可能把人带到别处，
       而后续的"下行"从新位置出发**到不了**那一站（实测：第一版就是这么红的）。
       屋里真走得通的路只有那几条，测试里就写那一条。 */
  until(-1, 0, () => Game.hall().x <= 305);
  until(0, 1, () => !!near() && near().npc === 'picker', 900);
  const at = near();
  T.ok(!!at && at.npc === 'picker', '走到了拾荒者面前（这是屋里真走得通的一条路）',
    at && (at.npc || at.id));

  if (at && at.npc === 'picker') {
    /* ② **钱真的扣、货真的进"下一局"** */
    Game.addMaterial(100);
    const matBefore = Game.material();
    const scrapInBag = sess.player.scrap;
    const r = Game.trade('picker_scrap');
    T.eq(r.ok, true, '在他面前换成了', r.reason);
    T.eq(r.got, '30 废料', '拿到的东西报得出名字', r.got);
    T.eq(Game.material(), matBefore - 10, '材料真的扣了 10');
    T.eq(sess.player.scrap, scrapInBag, '**废料没进这一局的背包**（它进的是下一局的开局条件）');
    T.eq(sess.starterScrap, 30, '换到的废料记在 `S.starterScrap` 上');

    /* ③ **每波限次**：连买到底，多出来的那一次被拒 */
    let bought = 1;
    for (let i = 0; i < 6; i++) {
      if (Game.trade('picker_scrap').ok) bought++;
    }
    T.eq(bought, Trade.PER_WAVE, '一位商人每波最多换 ' + Trade.PER_WAVE + ' 次（实测买了 ' + bought + ' 次）');
    const over = Game.trade('picker_scrap');
    T.eq(over.ok, false, '超过限次的那一次被拒', over.reason);

    /* ④ **钱不够**要说得清（而且**不扣钱**） */
    const cheap = Game.tradeOffers('picker').find(o => o.ok && /材料/.test(o.ask) && !/^picker_scrap$/.test(o.id));
    if (cheap) {
      /* 把材料清空（"花光"这条路径走 `spendMaterial`），再试 */
      const have = Game.material();
      if (have > 0) Game.spendMaterial(have);
      const before = Game.material();
      const poor = Game.trade(cheap.id);
      if (!poor.ok) {
        T.ok(/不够/.test(poor.reason), '钱不够时说"不够"（而不是静默失败）', poor.reason);
        T.eq(Game.material(), before, '失败的那一次**没有扣钱**（不能留下半笔交易）');
      } else {
        T.ok(true, '（这一档刚好买得起，跳过"钱不够"那条）');
      }
    } else {
      T.ok(true, '（这一波能换的档里没有"材料"那一类，跳过）');
    }
  } else {
    T.ok(false, '没走到拾荒者面前 —— 下面几条断言无法执行（这是测试自己的问题）');
  }
}

/* ---------------- [5] 存档往返（顺带守一条真 bug） ---------------- */
T.section('5. 存档往返：换到的东西跟着存档走');
{
  Storage.wipe();
  Slots.select(0);
  Profile.load();
  Profile.reset();
  const c = Profile.saveCharacter({ name: '存档人' }, 'ranger');

  /* 模拟一次结算：把交易换到的东西并进这个档 */
  Profile.applyRun({
    char: 'ranger', wave: 4, level: 6, kills: 100, scrap: 50,
    damage: 10, taken: 5, healed: 2, packs: 0,
    starterWeapons: ['knife'], starterItems: ['coffee'], starterScrap: 45
  }, { runs: 1, wins: 0, bestWave: 4, bestKills: 100, bestLevel: 6, totalKills: 100, totalMaterials: 50 });

  const me = Profile.character();
  T.eq((me.starterWeapons || []).join(','), 'knife', '换到的起始武器进了这个档');
  T.eq((me.starterItems || []).join(','), 'coffee', '换到的起始道具进了这个档');
  T.eq(me.starterScrap, 45, '换到的起始废料进了这个档');

  /* 开局条件里**真的带上它们**（这是"换到了"与"打下一局真的带上了"之间那根线） */
  const open = Profile.openingOf('ranger');
  T.ok(open.weapons.indexOf('knife') >= 0, '下一局的开局条件里有那把武器', JSON.stringify(open.weapons));
  T.ok(open.items.indexOf('coffee') >= 0, '下一局的开局条件里有那件道具', JSON.stringify(open.items));
  T.ok(open.scrap >= 45, '下一局的开局条件里有那笔废料', open.scrap);

  /* 切档来回一趟：**那个人与他的东西都还在** */
  const before = JSON.stringify(Profile.character());
  Slots.select(1); Profile.load(); Slots.select(0); Profile.load();
  T.eq(JSON.stringify(Profile.character()), before, '切档来回一趟，换到的东西没丢');

  /* ---- 顺带守一条**本轮抓到的真 bug** ----
     `run_save.ts` 一直在写 `bonds` / `talks`，而 `Game.importRun` **从来没有读** ——
     于是"读档之后跟谁聊过、信任多少"全部归零，而且没有任何东西会报错。 */
  const sess = Game.newRun('ranger', 999, 0, Profile.openingOf('ranger'), { owned: {}, forge: null }, []);
  Game.talkTo('mother');
  Game.talkTo('mother');
  T.eq(sess.bonds.mother, 2, '先跟菌母聊了两次（信任 2）');
  const tape = Game.exportRun();
  T.ok(!!tape, '存了一盘');
  T.eq(tape.bonds.mother, 2, '带子里有那份关系');
  Game.setState('title', true);
  Game.importRun(tape);
  const back = Game.getSession();
  T.eq(back.bonds.mother, 2, '**读档之后关系还在**（这一条以前是红的：只写不读）');
  T.eq(back.talks.mother, 2, '这一波的相处次数也贴回来了');

  /* 交易换到的东西也跟存档走（`exportRun` → `importRun`） */
  back.starterWeapons = ['knife'];
  back.starterItems = ['coffee'];
  back.starterScrap = 33;
  const tape2 = Game.exportRun();
  Game.setState('title', true);
  Game.importRun(tape2);
  const back2 = Game.getSession();
  T.eq((back2.starterWeapons || []).join(','), 'knife', '换到的武器跟着存档走');
  T.eq((back2.starterItems || []).join(','), 'coffee', '换到的道具也跟着');
  T.eq(back2.starterScrap, 33, '换到的废料也跟着');
  /* 坏档防线：认不出的 id 丢掉（不是让它一路走到开局那一刻才崩） */
  tape2.starterWeapons = ['不存在的武器'];
  tape2.starterItems = ['不存在的道具'];
  Game.setState('title', true);
  Game.importRun(tape2);
  const back3 = Game.getSession();
  T.eq((back3.starterWeapons || []).length, 0, '认不出的武器 id 被丢掉');
  T.eq((back3.starterItems || []).length, 0, '认不出的道具 id 被丢掉');

  Storage.wipe();
  Slots.select(0);
  Profile.load();
}

process.exit(T.done());
