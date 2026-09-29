/* =========================================================
   extras.mjs — 两个可选的额外内容（离线产出 + 每周挑战）

   这不是"运营"，是单机里的两块**附加内容**：一个离线也能攒一点，
   一个每周换一套固定条件。两者都能整个摘掉，不影响正常游玩。

   所以这一套除了验功能，还要验**边界**：
     · 离线产出**要买菌床才开**、额度小、单次封顶、**结算即前进**
       （否则反复刷新就能刷孢子 —— 这是放置类最经典的漏洞）
     · 每周挑战用 **UTC 的 ISO 周**（本地时区会让"这一周"在两个人那里错开）
     · 两者都**不接天赋与据点**（挑战要全体同条件）

   用法： node test/extras.mjs
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadAll, SIM_MODULES } from './_load.mjs';
import { uiMissingActs } from './_acts.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
let failures = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  \x1b[32mPASS\x1b[0m ' + label);
  else { failures++; console.log('  \x1b[31mFAIL\x1b[0m ' + label + (extra !== undefined ? '  → ' + extra : '')); }
}
const HOUR = 3600000, MIN = 60000;

await loadAll(SIM_MODULES);
const { Offline, Season, Profile, Storage, Danger, Chars, Game, Scene, Input, Registry, Stronghold } = globalThis;
console.error = function () { };

console.log('\n=== Bronana · 附加内容（离线产出 / 每周挑战） ===\n');

/* ---------------- 1. 离线产出：纯函数那一层 ---------------- */
console.log('[1] 离线产出：速率、门槛、封顶');
{
  ok(Offline.rateAt(0) === 0, '没买菌床 → 速率为 0（这是"开关"）', Offline.rateAt(0));
  ok(Offline.rateAt(1) > 0 && Offline.rateAt(2) > Offline.rateAt(1), '买了才产出，等级越高越多',
    Offline.rateAt(1) + ' → ' + Offline.rateAt(2));
  ok(Offline.rateAt(99) === Offline.rateAt(Offline.MAX_LEVEL), '越界等级夹回上限');
  // 速率表必须把每一级都写全、且单调不降（加一级时最容易忘的就是补表）
  let allLevels = true, mono = true, prev = -1;
  for (let l = 0; l <= Offline.MAX_LEVEL; l++) {
    const r = Offline.RATE_PER_MIN[l];
    if (typeof r !== 'number' || !isFinite(r)) allLevels = false;
    if (r < prev) mono = false;
    prev = r;
  }
  ok(allLevels, '0 到 MAX_LEVEL(' + Offline.MAX_LEVEL + ') 每一级都在速率表里', Object.keys(Offline.RATE_PER_MIN).join(','));
  ok(mono, '速率随等级单调不降（升级不会变差）');

  const short = Offline.settle(3 * MIN, 1);
  ok(short.spores === 0 && /太短/.test(short.reason), '低于门槛不结算', short.reason);
  const just = Offline.settle(Offline.MIN_MINUTES * MIN, 1);
  ok(just.spores >= 1, '刚好到门槛就有产出（' + just.spores + '）', just.spores);

  const eight = Offline.settle(Offline.MAX_HOURS * HOUR, 2);
  ok(eight.spores === Math.floor(Offline.MAX_HOURS * 60 * Offline.rateAt(2)) && !eight.capped,
    '满 8 小时正好拿满额（' + eight.spores + '）', eight.spores);
  const over = Offline.settle(48 * HOUR, 2);
  ok(over.spores === eight.spores && over.capped === true, '超过 8 小时按 8 小时算（封顶）',
    over.spores + ' / capped=' + over.capped);
  ok(eight.spores < 100, '拉满 8 小时 = ' + eight.spores + ' 孢子，仍在一局通关（约 93）的一倍以内 —— 挂机是补充，不是替代');

  ok(Offline.settle(-5000, 2).spores === 0 && Offline.settle(NaN, 2).spores === 0, '负数 / NaN 安全');

  // 挂机收益不该超过"打一局"：这是设计红线
  const perRun = Profile.sporesForRun({ wave: 20, kills: 200, scrap: 800, win: true });
  ok(eight.spores <= perRun * 1.5, '满额离线 ≤ 一局通关的 1.5 倍（' + eight.spores + ' vs ' + perRun + '）');
}

/* ---------------- 2. 离线产出：状态与"结算即前进" ---------------- */
console.log('\n[2] 状态：结算即前进（反复刷新不能刷孢子）');
{
  Storage.use(Storage.memory(Object.create(null)));
  Storage.wipe();
  Profile.reset();

  const t0 = 1700000000000;
  let r = Profile.settleOffline(t0);
  ok(r.spores === 0 && r.reason === '第一次见面', '第一次见面不给（没有间隔）', r.reason);
  ok(Profile.lastSeen() === t0, '"上次见面"被设成现在');

  // 没买菌床
  r = Profile.settleOffline(t0 + 5 * HOUR);
  ok(r.spores === 0 && /菌床/.test(r.reason), '没买菌床 → 挂 5 小时也不给', r.reason);
  ok(Profile.lastSeen() === t0 + 5 * HOUR, '但"上次见面"仍然前进（否则买了之后会一次性补发）');

  // 买菌床（**注意前置链**：菌床要求「仓库」Lv.1 —— 先有地方放，才谈得上产出）
  Profile.addMaterial(1000);
  const matsBefore = Profile.material();
  ok(Profile.keepBuy('sporebed').ok === false, '前置没满足时买不了菌床（先要有仓库）');
  ok(Profile.keepBuy('storehouse').ok === true, '先买仓库 Lv.1');
  ok(Profile.keepBuy('sporebed').ok === true, '仓库到位 → 买下菌床 Lv.1');
  ok(Profile.keepLevel('sporebed') === 1, '菌床 Lv.1 落到了档案里');
  const spentOnKeep = matsBefore - Profile.material();
  ok(spentOnKeep === Stronghold.BY_ID.storehouse.levels[0].cost + Stronghold.BY_ID.sporebed.levels[0].cost,
    '解锁离线产出一共花了 ' + spentOnKeep + ' 材料（仓库 ' + Stronghold.BY_ID.storehouse.levels[0].cost +
    ' + 菌床 ' + Stronghold.BY_ID.sporebed.levels[0].cost + '）', spentOnKeep);

  r = Profile.settleOffline(t0 + 5 * HOUR + 2 * HOUR);
  const want = Math.floor(2 * 60 * Offline.rateAt(1));
  ok(r.spores === want, '挂 2 小时 = ' + want + ' 孢子', r.spores);
  ok(Profile.spores() === want, '孢子加进了档案', Profile.spores());
  ok(Profile.material() === matsBefore - spentOnKeep, '材料被据点花掉（孢子不再参与经营）', Profile.material());

  // 关键：马上再结算一次，什么都没有
  const after = Profile.spores();
  r = Profile.settleOffline(t0 + 5 * HOUR + 2 * HOUR);
  ok(r.spores === 0 && Profile.spores() === after, '同一时刻再结算 → 一点不给（结算即前进）', r.spores);
  r = Profile.settleOffline(t0 + 5 * HOUR + 2 * HOUR + 1 * MIN);
  ok(r.spores === 0 && /太短/.test(r.reason), '隔 1 分钟再结算 → 也在门槛之下', r.reason);

  // 封顶：挂 100 小时也只给 8 小时的量
  r = Profile.settleOffline(t0 + 5 * HOUR + 3 * HOUR + 100 * HOUR);
  ok(r.capped === true && r.spores === Math.floor(Offline.MAX_HOURS * 60 * Offline.rateAt(1)),
    '挂 100 小时按封顶算（' + r.spores + '）', r.spores);

  // 升到 Lv.2 之后同样的间隔必须给更多 —— 证明"档案把菌床等级真的传下去了"
  ok(Profile.keepBuy('sporebed').toLevel === 2, '再买一级升到 Lv.2');
  r = Profile.settleOffline(t0 + 5 * HOUR + 3 * HOUR + 100 * HOUR + 2 * HOUR);
  ok(r.spores === Math.floor(2 * 60 * Offline.rateAt(2)) && r.spores > Math.floor(2 * 60 * Offline.rateAt(1)),
    'Lv.2 同样的 2 小时拿得更多（' + r.spores + ' > ' + Math.floor(2 * 60 * Offline.rateAt(1)) + '）', r.spores);

  // 落盘往返
  const seen = Profile.lastSeen();
  Profile.load();
  ok(Profile.lastSeen() === seen, '"上次见面"会落盘', Profile.lastSeen());

  // 坏档：未来的时间戳当"刚刚"（改系统时间往前跳不会白拿）
  Storage.setJSON(Storage.KEYS.profile, {
    v: 1, at: Date.now(), kind: 'profile',
    data: { spores: 5, keep: { sporebed: 2 }, lastSeen: Date.now() + 10 * 365 * 24 * HOUR }
  });
  Profile.load();
  ok(Profile.lastSeen() === 0, '未来的"上次见面"被丢弃（当第一次见面）', Profile.lastSeen());
  Profile.reset();
}

/* ---------------- 3. 每周挑战：周键 ---------------- */
console.log('[3] 每周挑战：UTC 的 ISO 周');
{
  const a = Season.audit();
  ok(a.ok === true, '周次自检通过', a.problems.join(' | '));

  ok(/^\d{4}-W\d{2}$/.test(Season.weekKey(Date.UTC(2026, 4, 1))), '周键格式 YYYY-Www（补零，字符串序=时间序）',
    Season.weekKey(Date.UTC(2026, 4, 1)));
  // 2026-05-01 是周五；同周的周一(4-27)与周日(5-3)必须同键
  const fri = Season.weekKey(Date.UTC(2026, 4, 1, 12));
  ok(Season.weekKey(Date.UTC(2026, 3, 27, 12)) === fri, '同一周的周一是同一个键', fri);
  ok(Season.weekKey(Date.UTC(2026, 4, 3, 12)) === fri, '同一周的周日是同一个键');
  ok(Season.weekKey(Date.UTC(2026, 4, 4, 12)) !== fri, '下一周的周一是新的键',
    Season.weekKey(Date.UTC(2026, 4, 4, 12)));

  /* 时区无关。⚠ 上一版是"设 process.env.TZ 再算一遍、断言相等" ——
     那条判据在 **glibc 上恒真**（Node 用过 Date 之后时区就缓存了，
     Linux 常常不再重读）。所以它看着在守时区无关、其实什么都没验。
     现在两条一起做：**真的在新时区的子进程里算**（TZ 在进程启动前设好）+ 
     源码里不许出现本地时间读取。 */
  const seasonSrc = fs.readFileSync(path.join(ROOT, 'src', 'season.ts'), 'utf8');
  /* ⚠ 只查"**本地时间分量**"的读取（`getHours` / `getDate` …）。
     `getTime()` **不算** —— 它返回的是 epoch 毫秒，与时区无关
     （第一版把它也报出来了，那会逼着人把正确的写法改掉）。 */
  const localCalls = [...seasonSrc.matchAll(
    /\bget(?:FullYear|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds|TimezoneOffset)\(/g)].map(m => m[0]);
  ok(localCalls.length === 0,
    'season.ts 里一次本地时间读取都没有（只有 getUTC*；与平台无关）', localCalls.join(','));
  const tzProbe = (tz) => {
    const code = 'import("./src/season.ts").then(m=>{' +
      'process.stdout.write(m.Season.weekKey(Date.UTC(2026,4,1,12)))' +
      '}).catch(e=>{console.error(e.message);process.exit(1)})';
    const r = spawnSync(process.execPath, ['-e', code], {
      cwd: ROOT, encoding: 'utf8', env: { ...process.env, TZ: tz }
    });
    return (r.stdout || '').trim() || ('ERR:' + (r.stderr || '').trim().split('\n')[0]);
  };
  const before = Season.weekKey(Date.UTC(2026, 4, 1, 12));
  const kiritimati = tzProbe('Pacific/Kiritimati');     // UTC+14
  const tahiti = tzProbe('Pacific/Tahiti');             // UTC-10
  ok(kiritimati === before,
    '**在真的 UTC+14 进程里**周键不变（这才叫"改时区不影响"）', before + ' / ' + kiritimati);
  ok(tahiti === before,
    '**在真的 UTC-10 进程里**周键也不变', before + ' / ' + tahiti);

  // ISO 跨年：2027-01-01（周五）属于 2026 年第 53 周
  ok(Season.weekKey(Date.UTC(2027, 0, 1, 12)) === '2026-W53',
    'ISO 跨年规则正确（2027-01-01 属于 2026-W53）', Season.weekKey(Date.UTC(2027, 0, 1, 12)));

  const w = Season.of('2026-W18');
  ok(w.seed === Season.seedFor('2026-W18') && Chars.BY_ID[w.char], '当周规则：种子与角色都定得下来',
    JSON.stringify(w));
  ok(w.danger >= 1 && w.danger <= Danger.MAX, '每周难度轮换在第 1 级到最高级之间（不是 0）', w.danger);
  const dangers = new Set();
  for (let i = 0; i < 12; i++) dangers.add(Season.dangerFor('2026-W' + (i + 1)));
  ok(dangers.size >= 2, '不同周的难度确实在轮换（12 周里出现 ' + dangers.size + ' 种）');

  const chars = new Set();
  for (let i = 0; i < 40; i++) chars.add(Season.charFor('2026-W' + (i + 1)));
  ok(chars.size >= 4, '角色也在轮换（40 周里出现 ' + chars.size + ' 个）');
}

/* ---------------- 4. 每周记录 ---------------- */
console.log('\n[4] 每周记录：只留当周更好的那一局');
{
  Storage.use(Storage.memory(Object.create(null)));
  Storage.wipe();
  Profile.reset();
  const mk = (score, wave) => ({
    key: '2026-W18', seed: 1, char: 'ranger', danger: 2,
    wave: wave, kills: 10, level: 3, win: false, score: score, at: Date.now(), frames: 10
  });
  ok(Profile.seasonOf('2026-W18') === null, '还没打过 → null');
  ok(Profile.recordSeason(mk(100, 3)).improved === true, '第一次记录算提升');
  ok(Profile.recordSeason(mk(50, 1)).improved === false && Profile.seasonOf('2026-W18').score === 100,
    '更差的不留', Profile.seasonOf('2026-W18').score);
  Profile.recordSeason({ ...mk(300, 6), key: '2026-W19' });
  ok(Profile.seasonKeys().join(',') === '2026-W18,2026-W19', '按周分档存（可回看历史）',
    Profile.seasonKeys().join(','));

  Storage.setJSON(Storage.KEYS.profile, {
    v: 1, at: Date.now(), kind: 'profile',
    data: { season: { '不是周键': { score: 1 }, '2026-W20': { score: 'abc', danger: 99 } } }
  });
  Profile.load();
  ok(Profile.seasonOf('不是周键') === null, '非法周键被丢弃');
  ok(Profile.seasonOf('2026-W20') && Profile.seasonOf('2026-W20').danger === Danger.MAX,
    '越界难度被夹回', Profile.seasonOf('2026-W20').danger);
  Profile.reset();
}

/* ---------------- 5. 挑战不接养成 ---------------- */
console.log('\n[5] 每日与每周都不接天赋 / 据点（全体同条件）');
{
  // main.ts 里两个挑战入口共用 startChallenge，里面只传（角色, 种子, 难度）
  const mainSrc = fs.readFileSync(path.join(ROOT, 'src', 'main.ts'), 'utf8');
  const m = /function startChallenge[\s\S]*?\n}/.exec(mainSrc);
  const body = m ? m[0] : '';
  ok(/Game\.newRun\(rule\.char, rule\.seed, rule\.danger\)/.test(body),
    'startChallenge 只传（角色, 种子, 难度）');
  ok(body.indexOf('openingOf') < 0 && body.indexOf('keepOwned') < 0,
    '挑战入口里没有 openingOf / keepOwned（这是"公平"的全部实现）');
  ok(/kind === 'weekly' \? Season\.of\(\) : Daily\.of\(\)/.test(mainSrc),
    '每日 / 每周共用一套流程，只差规则的推导');

  // 反过来：普通模式**必须**接养成，否则天赋与据点就是白买的
  const uiSrc0 = fs.readFileSync(path.join(ROOT, 'src', 'ui.ts'), 'utf8');
  ok(/Game\.newRun\(UI\.selectedChar, undefined, UI\.selectedDanger,\s*\n?\s*Profile\.openingOf\(UI\.selectedChar\),\s*\n?\s*\{ owned: Profile\.keepOwned\(\), forge: Profile\.forgeOwned\(\) \}\)/
    .test(uiSrc0),
    '（对照）普通开局把天赋产物、据点等级与图纸一起传下去 —— 所以"挑战不传"是有意为之，不是漏了');

  // 端到端：同一份开局参数必须逐帧一致；多带一份养成必须真的不一样
  const play = (opening, smods) => {
    Game.newRun(
      Season.of('2026-W18').char, Season.of('2026-W18').seed, Season.of('2026-W18').danger,
      opening, smods);
    let h = 2166136261 >>> 0;
    const mix = (v) => { const s = String(v); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } };
    for (let f = 0; f < 240; f++) {
      const inp = { x: Math.cos(f * 0.05), y: Math.sin(f * 0.05) };
      if (Scene.simulates(Game.state)) Game.step(Game.cfg.fixedDt, inp);
      Input.endFrame();
      const st = Game.getSession();
      mix(Math.round(st.player.x * 1000));
      mix(Math.round(st.player.hp * 100));
      mix(st.player.scrap | 0);
      mix(Game.wave);
    }
    return h;
  };
  const opening = { stats: { maxHp: 40 }, weapons: [], items: [], scrap: 900 };
  const smods = { owned: { storehouse: 2, shelves: 1 } };
  const plain = play(undefined, undefined);
  ok(play(undefined, undefined) === plain, '同样参数跑两遍逐帧一致（确定性）', plain);
  const boosted = play(opening, smods);
  ok(plain !== boosted, '（对照）带养成确实不一样 —— 所以挑战入口必须坚持不传它们',
    plain + ' / ' + boosted);
  Game.setState('title', true);
}

/* ---------------- 6. 界面与入口 ---------------- */
console.log('\n[6] 界面与入口');
{
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  ok(/data-act="weekly"/.test(html), '标题页有每周挑战入口');
  ok(/id="btn-weekly"/.test(html), '每周入口有 id（与每日对称）');
  const uiSrc = fs.readFileSync(path.join(ROOT, 'src', 'ui.ts'), 'utf8');
  ok((await uiMissingActs(['weekly'])).length === 0, 'weekly 动作注册在界面动作表里');
  ok(/UI\.weeklyStart/.test(uiSrc), '每周挑战由 main.ts 注入的实现发起（界面层不知道周次算法）');
  ok(/本周角色 \/ 难度/.test(uiSrc) && /离线产出/.test(uiSrc), '图鉴面板里能看到本周与离线产出的状态');
  const audit = Registry.audit();
  const probs = audit.problems.filter(p => p.family === 'offlineRate' || p.family === 'seasonField');
  ok(probs.length === 0, 'registry 审计对两个新家族不报错', probs.length);
  ok(Registry.has('offlineRate') && Registry.has('seasonField'), '两个新家族都登记进了扩展点总账');
  const sections = Registry.ids('profileSection');
  ok(sections.indexOf('season') >= 0 && sections.indexOf('lastSeen') >= 0,
    'profileSection 里登记了 season / lastSeen（新增跨局状态要显式登记）', sections.join(','));
}

console.log('\n=== 结果 ===');
if (failures === 0) { console.log('\x1b[32m全部通过 ✔\x1b[0m\n'); process.exit(0); }
console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m\n');
process.exit(1);
