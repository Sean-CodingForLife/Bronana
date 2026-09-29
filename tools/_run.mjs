/* =========================================================
   _run.mjs — **像个玩家那样跑一局**（探针与对局体检的唯一实现）
   ---------------------------------------------------------
   为什么要有这个共享文件：`bug-probe.mjs`（找 bug）与
   `fun-audit.mjs`（量好不好玩）都需要"一个有代表性的自动玩家"。
   第一版各写一份，结果**同一个种子跑出完全不同的结果** ——
   它们量的根本不是同一局游戏。所以收成一份，两边共用。

   **循环结构：让游戏的状态机驱动，bot 只负责"在这个状态下做什么"。**
   这一点是踩了三次才对的：
     ① 一开始写成"见到已清的房间就进商店"—— 但"已清"是**模拟层**的事实，
        而买东西的守卫看的是**状态机**。两者不同步时 bot 会在 playing 状态下
        反复尝试买东西，全部被"当前不在商店界面"拒掉（实测一局试 77 次、成功 0 次）。
     ② 改成"先 step 一帧再处理"—— 于是模拟层和 `nextWave` **各推进了一格**，
        一局只走到第 1 波。
     ③ 现在：`playing` 就只负责走位与 step；`shop`/`camp` 就只负责做买卖与 nextWave。
        状态机自己会从 playing 走到 shop（`endWave`），bot 不越权替它跳。

   走位三种风格轮换（贴脸 / 绕圈 / 贴边）：全是"逃跑"的话近战武器
   一辈子打不到人，一局会卡在第 2 间房。
   两处刻意"像人"的地方：见血就补（0.3，目的是测**深度**而不是测 bot 能撑几波）；
   商店里**能买就买**（均匀随机会把买东西稀释到 1/22，实测 12 局一次都没买）。
   ========================================================= */
import { installDom } from '../test/_ctx.mjs';
import { loadAll, UI_MODULES } from '../test/_load.mjs';

installDom();
await loadAll(UI_MODULES);
const { Game, U, Camp, Chars, Profile, Weapons, Items, Enemies, Stats, Containers, Dungeon } = globalThis;
export { Game, U, Camp, Chars, Profile, Weapons, Items, Enemies, Stats, Containers, Dungeon };

export const FIXED_DT = Game.cfg.fixedDt;
export const HEAL_BELOW = 0.30;
/** `noHeal` 模式下"见血就补"的门槛：只在快死时才补，把"低血"这段留给角色机制 */
export const TRIAGE_BELOW = 0.10;
export const FRAME_LIMIT = 200000;

/* 每局开头的钩子：`tools/matrix.mjs` 要逐波采样。
   ⚠ **必须在 `newRun` 之前**装 —— 挂在 `waveStart` 上的采样器在
   "怪还没生成"的那一刻读 `sess.enemies`，读到的永远是 0 只（第一版就这么错的：
   实测怪血那一列全是空）。`onTick` 在玩家可操作的每一帧被调，
   调用方自己按波次节流。 */
let _onTick = null;
export function setRunTick(fn) { _onTick = fn; }

/** 可复现的随机流（不吃游戏自己的 `S.rnd`） */
export function rngOf(seed) {
  let s = (seed >>> 0) || 1;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const CHAR_IDS = Chars.LIST.map(c => c.id);

/**
 * 跑一局。
 * @param opts `{ runIndex, seedBase?, maxWave?, char?, danger?, onFrame?, onEvent?, roundTrip? }`
 *   `char` / `danger` 缺省时由种子决定（探针与体检要的就是"随机角色、随机难度"）；
 *   给了就按给的来 —— 矩阵体检（每个角色 × 每级难度）要能点名。
 *   ⚠ **两次 `rnd()` 照抽不误**：bot 的走位抖动、买哪件都吃这条流，
 *   提前返回会让"点名的 runIndex"与"随机的 runIndex"跑出完全不同的走位，
 *   于是两个工具的数字没法互相印证。 */
export function playRun(opts) {
  const o = opts || {};
  const runIndex = o.runIndex || 0;
  const seed = (o.seedBase === undefined ? 100000 : o.seedBase) + runIndex * 7919;
  const rnd = rngOf(seed);
  const rollChar = CHAR_IDS[Math.floor(rnd() * CHAR_IDS.length)];
  const rollDanger = Math.floor(rnd() * 6);
  const char = o.char && CHAR_IDS.indexOf(o.char) >= 0 ? o.char : rollChar;
  const danger = o.danger === undefined ? rollDanger : Math.max(0, Math.min(9, o.danger | 0));
  const maxWave = o.maxWave || 40;

  Game.newRun(char, seed, danger);
  let sess = Game.getSession();
  if (!sess) return null;

  const st = {
    run: runIndex, seed, char, danger,
    frames: 0, waves: 1, level: 1, kills: 0, state: 'playing', floor: 1,
    won: false, secs: 0, guard: 0, stepError: '',
    firstChoiceSec: -1, buildChoices: 0, allChoices: 0,
    shopVisits: 0, offersSeen: 0, buysTried: 0, buysOk: 0,
    weapons: [], items: [], coreEarned: 0, materials: 0, alloy: 0, healed: 0,
    hpAtEnd: 0, maxHp: 0, lastThreatName: ''
  };

  const emit = (kind, isBuild) => {
    st.allChoices++;
    if (isBuild) {
      st.buildChoices++;
      if (st.firstChoiceSec < 0) st.firstChoiceSec = st.frames / 60;
    }
    if (o.onEvent) o.onEvent(kind, st, st.frames);
  };

  let t = 0, guard = 0, shopSeq = 0;

  /* ---------------- 商店 / 营地里的一个回合 ---------------- */
  function shopTurn() {
    st.shopVisits++;
    st.offersSeen += sess.offers.length;

    /* 挑契约（改变构筑） */
    if (sess.pendingBoons.length && rnd() < 0.9) {
      try { Game.pickBoon(sess.pendingBoons[Math.floor(rnd() * sess.pendingBoons.length)]); emit('boon', true); } catch (e) { }
    }
    /* 非法参数：公开 API 的边界（只许返回 false，不许抛）。
       ⚠ 这一段**必须在买卖之前**跑，而且它自己不许改变状态 ——
       实测它会把状态从 shop 打回 playing（于是后面每一次购买都被
       "当前不在商店界面"拒掉）。原因记在下面那行断言里。 */
    const hostile = [
      () => Game.buyOffer(99), () => Game.buyOffer(-1), () => Game.sellWeapon(99),
      () => Game.craft(99, 'weapon:knife'), () => Game.craft(0, ''),
      () => Game.enterRoom(9), () => Game.pickBoon('nope'),
      () => Game.campBuy('nope'), () => Game.campSell('nope'), () => Game.combine(0, 0)
    ];
    for (let hi = 0; hi < hostile.length; hi++) {
      const before = Game.state;
      try { hostile[hi](); } catch (e) { }
      if (Game.state !== before && o.onStateBreak) {
        o.onStateBreak('hostile#' + hi, before, Game.state);
      }
    }

    /* 动作清单。`build` = 这个动作会改变构筑。 */
    const acts = [];
    for (let i = 0; i < sess.offers.length; i++) acts.push({ kind: 'buy', build: true, fn: () => Game.buyOffer(i) });
    acts.push({ kind: 'reroll', build: false, fn: () => Game.reroll() });
    for (let i = 0; i < sess.player.weapons.length; i++) acts.push({ kind: 'sell', build: false, fn: () => Game.sellWeapon(i) });
    for (let i = 0; i + 1 < sess.player.weapons.length; i++) acts.push({ kind: 'combine', build: true, fn: () => Game.combine(i, i + 1) });
    for (let i = 0; i < Game.craftLines(); i++) {
      const line = i;
      for (const c of (Game.craftOptions(i) || [])) acts.push({ kind: 'craft', build: true, fn: () => Game.craft(line, c.id) });
    }
    acts.push({ kind: 'pack', build: true, fn: () => Game.buyPack('basic') });
    acts.push({ kind: 'pack', build: true, fn: () => Game.buyPack('deluxe') });
    acts.push({ kind: 'build', build: false, fn: () => Game.buyBuild() });
    for (const id of (Camp.LIST ? Camp.LIST.map(c => c.id) : [])) {
      acts.push({ kind: 'campBuy', build: true, fn: () => Game.campBuy(id) });
      acts.push({ kind: 'campSell', build: false, fn: () => Game.campSell(id) });
    }
    for (const d of Game.doors()) acts.push({ kind: 'door', build: false, fn: () => Game.enterRoom(d.dir) });

    /* **能买就买**：真实玩家进商店第一件事是看买不买得起。
       均匀随机会把"买东西"稀释到 1/22（实测 12 局一次都没买到）。 */
    const picks = acts.filter(a => a.kind === 'buy' || a.kind === 'craft' || a.kind === 'pack');
    const rest = acts.filter(a => a.kind !== 'buy' && a.kind !== 'craft' && a.kind !== 'pack');

    const turns = 1 + Math.floor(rnd() * 5);
    for (let k = 0; k < turns; k++) {
      let a;
      if (picks.length && rnd() < 0.7) a = picks[Math.floor(rnd() * picks.length)];
      else if (rest.length) a = rest[Math.floor(rnd() * rest.length)];
      else a = acts[Math.floor(rnd() * acts.length)];
      if (!a) break;

      /* 判"真的改变了构筑"看**返回值与资源消耗**，不能只看装备数量：
         槽位没满时买武器、开包、营地买设施都不改变数量。 */
      const matsBefore = sess.player.scrap || 0;
      const bagBefore = sess.player.weapons.length + sess.player.items.length;
      const mixedBefore = (sess.alloy || 0) + (sess.campPoints || 0);
      if (a.kind === 'buy') st.buysTried++;
      let ret = false;
      if (a.kind === 'buy') {
        let deny = '';
        const onDeny = (m) => { deny = String(m); };
        Game.events.on('deny', onDeny);
        st.lastDenyState = Game.state;
        st.lastDenyMats = Math.round(sess.player.scrap || 0);
        st.lastDenyPrice = sess.offers.map(o => o.sold ? 'x' : o.price);
        try { ret = a.fn(); } catch (e) { ret = false; }
        if (ret !== true) st.lastDeny = deny;
      } else {
        try { ret = a.fn(); } catch (e) { ret = false; }
      }
      if (a.kind === 'buy' && ret === true) st.buysOk++;
      const spent = (sess.player.scrap || 0) < matsBefore;
      const bagGrew = (sess.player.weapons.length + sess.player.items.length) !== bagBefore;
      const mixed = ((sess.alloy || 0) + (sess.campPoints || 0)) !== mixedBefore;
      if (a.build && (ret === true || spent || bagGrew || mixed)) emit(a.kind, true);

      /* 走门走了就离开商店了 */
      if (Game.state !== 'shop' && Game.state !== 'camp') return true;
    }

    /* 进营地看一眼（可选去处） */
    if (Game.state === 'shop' && rnd() < 0.35) {
      try { Game.openCamp(); } catch (e) { }
      if (Game.state === 'camp') {
        for (let k = 0; k < 2; k++) {
          const c = Camp.LIST ? Camp.LIST[Math.floor(rnd() * Camp.LIST.length)] : null;
          if (!c) break;
          const bagBefore = sess.player.weapons.length + sess.player.items.length;
          const ptsBefore = sess.campPoints || 0;
          let ret2 = false;
          try { ret2 = Game.campBuy(c.id); Game.campSell(c.id); } catch (e) { break; }
          if (ret2 === true || (sess.player.weapons.length + sess.player.items.length) !== bagBefore ||
            (sess.campPoints || 0) !== ptsBefore) emit('camp', true);
        }
        Game.setState('shop', true);
      }
    }

    /* 存档往返（每 3 次商店来一次）：探针用它验"导出→导入→导出逐字段一致" */
    if (Game.state === 'shop' && (shopSeq++ % 3 === 0) && o.roundTrip) {
      const s2 = o.roundTrip(sess);
      if (s2) sess = s2;
    }

    /* 走下一波；走不动就从开着的门里挑一扇 */
    let ok = false;
    try { ok = Game.nextWave() !== false; } catch (e) { ok = false; }
    if (ok) return true;
    for (const d of Game.doors().filter(x => x.open)) {
      try { if (Game.enterRoom(d.dir)) return true; } catch (e) { }
    }
    return false;
  }

  /* ---------------- 主循环：状态机驱动 ---------------- */
  while (Game.state !== 'end' && Game.wave <= maxWave && guard++ < FRAME_LIMIT) {
    const state = Game.state;
    if (state === 'playing') {
      let inp;
      const style = (st.frames / 900 | 0) % 3;
      if (style === 0) {
        let best = null, bd = Infinity;
        for (const e of sess.enemies) {
          const d = U.dist2(sess.player.x, sess.player.y, e.x, e.y);
          if (d < bd) { bd = d; best = e; }
        }
        if (best) {
          const dd = Math.sqrt(bd);
          const a = Math.atan2(best.y - sess.player.y, best.x - sess.player.x);
          const sgn = dd > 46 ? 1 : -1;                       // 太近就退一点，免得贴脸暴毙
          inp = { x: Math.cos(a) * sgn, y: Math.sin(a) * sgn };
        } else inp = Game.autoInput(t);
      } else if (style === 1) inp = { x: Math.cos(t * 0.9), y: Math.sin(t * 0.9) };
      else inp = { x: Math.cos(t * 2.3) > 0 ? 1 : -1, y: Math.sin(t * 1.7) > 0 ? -1 : 1 };

      /* 归因：低血时离得最近的那只怪 —— 界面上玩家看到的是同一件事 */
      if (sess.player.hp < sess.stats.maxHp * 0.35 && sess.enemies.length) {
        let near = null, nd = Infinity;
        for (const e of sess.enemies) {
          const d = U.dist2(sess.player.x, sess.player.y, e.x, e.y);
          if (d < nd) { nd = d; near = e; }
        }
        if (near) st.lastThreatName = near.def.name || near.def.id;
      }

      try { Game.step(FIXED_DT, inp); } catch (e) {
        st.stepError = e.message;
        if (o.onError) o.onError(e, st);
        break;
      }
      t += FIXED_DT; st.frames++;
      if (_onTick) _onTick(sess, Game.wave, st.frames);
      if (o.onFrame) o.onFrame(sess, st.frames, st);
      /* 见血就补：目的是**深度覆盖**，不是"这个 bot 能撑几波"。
         `noHeal` 是给"靠低血变强 / 靠挨打"的角色留的对照：
         一直补血会让「受虐狂」的 rage（低血才触发）几乎永远不生效，
         于是那一局量的其实是"白板受虐狂"，而不是那个角色。
         ⚠ 这**不是**在给弱角色找台阶：它是一次可检验的对照 ——
         如果换个打法它就上来了，那结论是"bot 的打法盖住了设计"；
         如果换了还是一样，那才是角色本身弱。 */
      const lowMark = o.noHeal ? TRIAGE_BELOW : HEAL_BELOW;
      if (sess.player.hp < sess.stats.maxHp * lowMark) Game.healPlayer(sess.stats.maxHp);
    } else if (state === 'levelup') {
      const n = sess.levelCards.length;
      try { Game.chooseLevelCard(n ? Math.floor(rnd() * n) : 0); } catch (e) { if (o.onError) o.onError(e, st); break; }
      emit('levelCard', false);
    } else if (state === 'shop' || state === 'camp') {
      if (!shopTurn()) break;
    } else if (state === 'paused') {
      Game.resume();
    } else break;
  }

  st.state = Game.state;
  st.waves = Game.wave;
  st.floor = sess.floor;
  st.level = sess.player.level;
  st.kills = sess.stats_total.kills;
  st.won = !!sess.won;
  st.secs = st.frames / 60;
  st.guard = guard;
  st.hpAtEnd = Math.round(sess.player.hp);
  st.maxHp = sess.stats.maxHp;
  st.weapons = sess.player.weapons.map(w => w.def.id + ':T' + w.tier);
  st.items = sess.player.items.map(i => i.def.id);
  st.coreEarned = sess.coreEarned || 0;
  st.materials = Math.round(sess.player.scrap || 0);
  st.alloy = Math.round(sess.alloy || 0);
  st.healed = Math.round(sess.stats_total.healed || 0);
  return st;
}
