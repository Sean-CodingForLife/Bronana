/* =========================================================
   daily.mjs — 每日挑战（共享种子）与成绩码（可离线互验）

   这一套的重点是**把"可复算"从一句话变成证据**：
   录一局真跑 → 出成绩码 → 重放 → 逐项对上；然后改一个数字 / 改带子 → 必须验不过。

   同时守着三个容易出错的地方：
     · 日期键必须是 UTC（本地时区会让"今天"在两个人那里指不同的一天）
     · 成绩码的字段顺序 = 字符串里的位置（改了顺序就是另一个格式，版本号要动）
     · **回放期间不能落账**（回放会真的跑到 gameOver，不拦住就往存档里写假数据）

   用法： node test/daily.mjs
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadAll, SIM_MODULES } from './_load.mjs';
import { uiMissingActs } from './_acts.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
/* 源码文本：用来做"与平台无关"的静态判据（不许出现本地时间读取） */
const DAILY_SRC = fs.readFileSync(path.join(ROOT, 'src', 'daily.ts'), 'utf8');
let failures = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  \x1b[32mPASS\x1b[0m ' + label);
  else { failures++; console.log('  \x1b[31mFAIL\x1b[0m ' + label + (extra !== undefined ? '  → ' + extra : '')); }
}

await loadAll(SIM_MODULES);
const { Daily, Score, Rec, Game, Profile, Chars, Scene, Input, U, Registry, Save, Storage } = globalThis;
console.error = function () { };

console.log('\n=== Bronana · 每日挑战 / 成绩码 ===\n');

/* ---------------- 1. 日期键与共享种子 ---------------- */
console.log('[1] 日期键（UTC）与共享种子');
{
  // 2026-05-01T23:30:00Z 与 2026-05-02T00:30:00Z 是两天；同一时刻在不同时区必须得到同一个键
  const a = Date.UTC(2026, 4, 1, 23, 30);
  const b = Date.UTC(2026, 4, 2, 0, 30);
  ok(Daily.dateKey(a) === '2026-05-01', 'UTC 日期的边界正确（前半段）', Daily.dateKey(a));
  ok(Daily.dateKey(b) === '2026-05-02', 'UTC 日期的边界正确（后半段）', Daily.dateKey(b));
  ok(/^\d{4}-\d{2}-\d{2}$/.test(Daily.dateKey(0)), '零填充（字符串序 = 时间序）', Daily.dateKey(0));
  ok(Daily.dateKey(a) === Daily.dateKey(a + 1000), '同一秒内稳定');

  /* UTC 而不是本地时区：换一个本地区域设置也必须得到同一个键。
     ------------------------------------------------------------------
     ⚠ **改 `process.env.TZ` 在 glibc 上不生效**：Node 一旦用过 `Date`，
       时区就被缓存了（Windows/ICU 会重新读，Linux/glibc 常常不会）。
       所以"设一下 TZ、再算一次、断言相等"这条判据在 Linux 上**恒真** ——
       它看着在守时区无关，其实什么都没验（这才是它"本机过、CI 也过"的原因，
       不是因为它真的验到了）。正确做法有两条，两条都做：

         (a) 真的在新时区里跑：起一个子进程，`TZ` 在**进程启动前**就设好
         (b) 静态判据：源码里不许出现本地时间读取（`getHours` / `getDate` …）
       只做 (b) 会被"用了 getUTC* 但拼错一个字段"骗过；只做 (a) 会让
       这套测试依赖平台能不能重读时区。两条一起才是稳的。 */
  /* ⚠ 只查"**本地时间分量**"的读取（`getHours` / `getDate` …）。
     `getTime()` **不算** —— 它返回 epoch 毫秒，与时区无关
     （第一版用 `get(?!UTC)` 把 `getTime` 也报了出来，那会逼着人把正确的写法改掉）。 */
  const localTimeCalls = [...DAILY_SRC.matchAll(
    /\bget(?:FullYear|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds|TimezoneOffset)\(/g)].map(m => m[0]);
  ok(localTimeCalls.length === 0,
    'daily.ts 里**一次本地时间读取都没有**（只有 getUTC*；这条与平台无关）',
    localTimeCalls.join(','));
  const tzProbe = (tz) => {
    const code = 'import("./src/daily.ts").then(m=>{' +
      'process.stdout.write(m.Daily.dateKey(Date.UTC(2026,4,1,23,30)))' +
      '}).catch(e=>{console.error(e.message);process.exit(1)})';
    const r = spawnSync(process.execPath, ['-e', code], {
      cwd: ROOT, encoding: 'utf8', env: { ...process.env, TZ: tz }
    });
    return (r.stdout || '').trim() || ('ERR:' + (r.stderr || '').trim().split('\n')[0]);
  };
  const utcKey = tzProbe('UTC');
  const kiritimatiKey = tzProbe('Pacific/Kiritimati');   // UTC+14
  const tahitiKey = tzProbe('Pacific/Tahiti');           // UTC-10
  ok(utcKey === '2026-05-01',
    '（子进程·TZ=UTC）日期键正确', utcKey);
  ok(kiritimatiKey === utcKey,
    '**在真的 UTC+14 进程里**日期键不变（这才叫"改时区不影响"）',
    utcKey + ' vs ' + kiritimatiKey);
  ok(tahitiKey === utcKey,
    '**在真的 UTC-10 进程里**日期键也不变', utcKey + ' vs ' + tahitiKey);

  ok(Daily.seedFor('2026-05-01') === Daily.seedFor('2026-05-01'), '同一天同一种子');
  ok(Daily.seedFor('2026-05-01') !== Daily.seedFor('2026-05-02'), '不同天不同种子');
  ok(Daily.seedFor('2026-05-01') === U.seedFromStr('bronana-daily-2026-05-01'),
    '种子就是日期键的哈希（谁算都一样）');
  ok(Daily.charFor('2026-05-01') && Chars.BY_ID[Daily.charFor('2026-05-01')],
    '当天角色在角色表里', Daily.charFor('2026-05-01'));

  const rule = Daily.of('2026-05-01');
  ok(rule.key === '2026-05-01' && rule.danger === 0, '每日固定第 0 级难度（所有人同一条件）',
    JSON.stringify(rule));

  // 角色轮换：一年 365 天里应该出现多个不同角色（而不是永远同一个）
  const seen = new Set();
  for (let i = 0; i < 60; i++) seen.add(Daily.charFor(Daily.dateKey(Date.UTC(2026, 0, 1 + i))));
  ok(seen.size >= 4, '角色按天轮换（60 天里出现 ' + seen.size + ' 个不同角色）');
}

/* ---------------- 2. 成绩分 ---------------- */
console.log('\n[2] 成绩分（可解释、不用时间）');
{
  ok(Daily.scoreOf({ wave: 10, kills: 100, level: 10 }) === 10000 + 200 + 500,
    '波次是主项 + 击杀 + 等级', Daily.scoreOf({ wave: 10, kills: 100, level: 10 }));
  ok(Daily.scoreOf({ wave: 20, kills: 0, level: 0, win: true }) === 25000,
    '通关另给一笔', Daily.scoreOf({ wave: 20, kills: 0, level: 0, win: true }));
  ok(Daily.scoreOf({ wave: 10 }) > Daily.scoreOf({ wave: 9, kills: 400 }),
    '一波 ≥ 500 击杀才抵得上一波推进 → 现实中波次是主项（实测每波约 50 击杀）',
    Daily.scoreOf({ wave: 10 }) + ' vs ' + Daily.scoreOf({ wave: 9, kills: 400 }));
  ok(Daily.scoreOf({ wave: 10 }) < Daily.scoreOf({ wave: 9, kills: 600 }),
    '但极端刷怪局不可能只靠推进就拿高分（比值是明写在公式里的）',
    Daily.scoreOf({ wave: 10 }) + ' vs ' + Daily.scoreOf({ wave: 9, kills: 600 }));
  ok(Daily.scoreOf(null) === 0 && Daily.scoreOf({}) === 0, '空输入安全');
  ok(Daily.scoreOf({ wave: -5, kills: -100 }) === 0, '负数归零');

  const better = Daily.pick({ score: 10 }, { score: 20 });
  const keep = Daily.pick({ score: 20 }, { score: 10 });
  ok(better.score === 20 && keep.score === 20, '取更高的那一个');
  ok(Daily.pick(null, { score: 5 }).score === 5 && Daily.pick({ score: 5 }, null).score === 5,
    '有一边为空时取另一边');
}

/* ---------------- 3. 成绩码：格式 ---------------- */
console.log('\n[3] 成绩码格式');
{
  const claims = { key: '2026-05-01', char: 'ranger', danger: 2, seed: 123456, wave: 12, kills: 540, level: 18, win: false };
  const code = Score.make(claims, 'a1b2c3d4');
  ok(code.split('|').length === 10, '十个字段', code.split('|').length);
  ok(code.indexOf('BR1|2026-05-01|ranger|2|123456|12|540|18|0|a1b2c3d4') === 0, '字段顺序固定', code);

  const back = Score.parse(code);
  ok(back && back.char === 'ranger' && back.wave === 12 && back.kills === 540 && back.hash === 'a1b2c3d4',
    '解析回来一致', JSON.stringify(back));
  ok(Score.parse('BR1|坏|ranger|0|1|1|1|1|0|a1b2c3d4') === null, '坏日期键被拒');
  ok(Score.parse('BR1|free|nope|0|1|1|1|1|0|a1b2c3d4') === null, '不存在的角色被拒');
  ok(Score.parse('BR1|free|ranger|0|1|1|1|1|0|zzzzzzzz') === null, '哈希格式不对被拒');
  ok(Score.parse('') === null && Score.parse(null) === null, '空输入返回 null 而不是抛');
  ok(Score.parse('BR2|free|ranger|0|1|1|1|1|0|a1b2c3d4') === null, '版本前缀不同 → 拒绝（格式变了就该拒）');

  ok(Score.describe(claims).indexOf('第 12 波') >= 0 && Score.describe(claims).indexOf('难度 2') >= 0,
    '给人看的一行摘要', Score.describe(claims));

  // 顺序即位置：字段挪位会解析成完全不同的东西 —— 这正是"改格式必须动版本号"的原因
  const swapped = Score.make({ ...claims, wave: 18, level: 12 }, 'a1b2c3d4');
  ok(Score.parse(swapped).wave === 18 && Score.parse(swapped).level === 12,
    'make/parse 是同一份顺序（互换两个值仍然自洽 —— 自洽不等于正确，所以有版本前缀兜底）');
}

/* ---------------- 4. 哈希与带子 ---------------- */
console.log('\n[4] 哈希（同一份带子必须永远同一个值）');
{
  const t1 = { v: 1, frames: 3, seed: 42, events: [{ frame: 0, cmd: 'newRun', args: ['ranger', undefined, 0], seed: 42 }], inputs: [[1, 0], [0, 1], [0, 0]] };
  const t2 = JSON.parse(JSON.stringify(t1));
  ok(Score.hashTape(t1) === Score.hashTape(t2),
    '带子经过 JSON 往返后哈希不变（分享串就是这么传的：undefined 会变成 null）',
    Score.hashTape(t1) + ' / ' + Score.hashTape(t2));
  const t2b = JSON.parse(JSON.stringify({ ...t1, events: [{ frame: 0, cmd: 'newRun', args: ['ranger', null, 0], seed: 42 }] }));
  ok(Score.hashTape(t1) === Score.hashTape(t2b), 'undefined 与 null 归一成同一个（都是"缺省"）');
  ok(/^[0-9a-f]{8}$/.test(Score.hashTape(t1)), '哈希是 8 位十六进制', Score.hashTape(t1));

  const t3 = JSON.parse(JSON.stringify(t1)); t3.inputs[1] = [0, 0.9999];
  ok(Score.hashTape(t1) !== Score.hashTape(t3), '改一帧输入 → 哈希变（浮点也算得出来）');
  const t4 = JSON.parse(JSON.stringify(t1)); t4.seed = 43;
  ok(Score.hashTape(t1) !== Score.hashTape(t4), '改种子 → 哈希变');
  const t5 = JSON.parse(JSON.stringify(t1)); t5.events[0].args[2] = 3;
  ok(Score.hashTape(t1) !== Score.hashTape(t5), '改命令参数（难度）→ 哈希变');
  ok(Score.hashTape(null) === Score.hash('') && Score.hash('') === '811c9dc5',
    '空输入的哈希是 FNV 的偏移基（不是随机值）', Score.hash(''));

  const packed = Score.pack(Score.make({ key: 'free', char: 'ranger', seed: 1 }, Score.hashTape(t1)), t1);
  ok(packed.ok && packed.text, '分享串可以打包');
  const un = Score.unpack(packed.text);
  ok(un && un.code === packed.text.indexOf('BR1') >= 0 ? true : !!un.code, '打包后能解回来');
  ok(Score.unpack('不是 json') === null && Score.unpack('') === null, '坏分享串返回 null');
  const huge = { v: 1, frames: 1, seed: 1, events: [], inputs: [] };
  huge.events = [{ frame: 0, cmd: 'x'.repeat(Score.MAX_PACK_CHARS), args: [], seed: 1 }];
  const tooBig = Score.pack('BR1|free|ranger|0|1|1|1|1|0|a1b2c3d4', huge);
  ok(!tooBig.ok && /太长/.test(tooBig.reason), '超长拒绝而不是截断（截断的后果是对方验证失败）',
    tooBig.reason.slice(0, 40));
}

/* ---------------- 5. 端到端：真的录一局，然后重放验证 ---------------- */
console.log('\n[5] 端到端：录一局 → 出码 → 重放验证（这就是"可复算"）');
{
  const replayStep = (x, y) => {
    if (Scene.simulates(Game.state)) Game.step(Game.cfg.fixedDt, { x: x, y: y });
    Input.endFrame();
  };

  // 用确定的方式录一小局：固定种子 + 每帧一个确定的方向
  const char = 'ranger', seed = 20260501;
  Rec.start();
  Game.newRun(char, seed, 0);
  const N = 600;
  for (let f = 0; f < N; f++) {
    const ang = f * 0.03;
    const inp = { x: Math.cos(ang), y: Math.sin(ang) };
    Rec.input(inp);
    if (Scene.simulates(Game.state)) Game.step(Game.cfg.fixedDt, inp);
    Input.endFrame();
  }
  const tape = Rec.stop();
  const live = Game.getSession();
  const liveWave = Game.wave;
  const liveKills = Math.round(live.stats_total.kills);
  const liveLevel = live.player.level;
  ok(tape.frames === N, '带子记了 ' + N + ' 帧', tape.frames);

  const claims = {
    key: '2026-05-01', char: char, danger: 0, seed: seed,
    wave: liveWave, kills: liveKills, level: liveLevel, win: false
  };
  const code = Score.make(claims, Score.hashTape(tape));
  ok(Score.parse(code) !== null, '成绩码可解析', code);

  // 重放验证：必须逐项对上
  const res = Score.verify(code, tape, replayStep);
  ok(res.ok === true, '重放验证通过：' + res.reason,
    res.actual ? JSON.stringify(res.actual) : '（无结果）');
  ok(res.actual && res.actual.wave === liveWave && res.actual.kills === liveKills && res.actual.level === liveLevel,
    '重放出来的波次/击杀/等级与原局一致',
    res.actual ? [res.actual.wave, res.actual.kills, res.actual.level].join('/') : '');

  /* ---- 改成绩码里的数字：哈希还对得上（哈希是带子的），但重放结果对不上 ---- */
  const tampered = code.split('|');
  tampered[5] = String(Number(tampered[5]) + 5);        // 波次 +5
  const r1 = Score.verify(tampered.join('|'), tape, replayStep);
  ok(!r1.ok && /不符/.test(r1.reason),
    '虚报成绩码（哈希仍匹配带子）→ 重放结果不符，验不过', r1.reason);

  /* ---- 改带子：哈希对不上 ---- */
  const badTape = JSON.parse(JSON.stringify(tape));
  badTape.inputs[10] = [0.5, -0.5];
  const r2 = Score.verify(code, badTape, replayStep);
  ok(!r2.ok && /不匹配/.test(r2.reason), '改带子 → 哈希对不上，验不过', r2.reason);

  /* ---- 哈希对得上但成绩是假的：重放结果不符 ---- */
  const fakeClaims = { ...claims, wave: claims.wave + 3 };   // 声称多打了 3 波
  const fakeCode = Score.make(fakeClaims, Score.hashTape(tape));
  const r3 = Score.verify(fakeCode, tape, replayStep);
  ok(!r3.ok && /不符/.test(r3.reason),
    '哈希对得上但成绩虚报 → 重放结果不符，照样验不过', r3.reason);

  /* ---- 同一份带子重放两次结果一致（确定性） ---- */
  const again = Score.verify(code, tape, replayStep);
  ok(again.ok && again.actual.wave === res.actual.wave && again.actual.kills === res.actual.kills,
    '同一份带子重放两次结果完全一致',
    [again.actual.wave, again.actual.kills].join('/'));

  ok(Rec.replaying() === false, '重放结束后标记复位');
}

/* ---------------- 6. 回放期间不落账 ---------------- */
console.log('\n[6] 回放期间不能往存档/档案里写假数据');
{
  Storage.use(Storage.memory(Object.create(null)));
  Storage.wipe();
  Profile.init();
  Save.addRun(null);

  // 模拟接入层的判断：main.ts 在 gameOver 时会先问 Rec.replaying()
  // 这里直接验证"回放期间 Rec.replaying() 为真"这个契约（接入层就是靠它）
  let sawReplayingDuringPlay = null;
  const tape = { v: 1, frames: 2, seed: 5, events: [{ frame: 0, cmd: 'newRun', args: ['ranger', 5, 0], seed: 5 }], inputs: [[0, 0], [0, 0]] };
  Rec.play(tape, (x, y) => {
    if (sawReplayingDuringPlay === null) sawReplayingDuringPlay = Rec.replaying();
    if (Scene.simulates(Game.state)) Game.step(Game.cfg.fixedDt, { x: x, y: y });
    Input.endFrame();
  });
  ok(sawReplayingDuringPlay === true, '回放进行中 Rec.replaying() 为真（接入层据此不落账）',
    String(sawReplayingDuringPlay));
  // 代码里的接入必须真的用了它
  const mainSrc = fs.readFileSync(path.join(ROOT, 'src', 'main.ts'), 'utf8');
  const guarded = (mainSrc.match(/Rec\.replaying\(\)/g) || []).length;
  ok(guarded >= 4, 'main.ts 的四个落账点（换波/商店/开局/结算）都问了 Rec.replaying()', guarded + ' 处');
}

/* ---------------- 6b. 带子里有"进商店 + 下一波"时也要能复算 ---------------- */
console.log('\n[6b] 回归：带子里有一次"下一波"（nextWave 的嵌套 setState 曾经让回放卡住）');
{
  // 这条是真实抓到的 bug：`nextWave()` 内部会 `Game.setState('playing')`，
  // 而 setState 也被录制 → 带子里多出一条**排在 nextWave 之前**的 setState，
  // 回放时先切到 playing，nextWave 就不再满足"必须在 shop/camp"而被拒 ——
  // 表现是**回放永远卡在原来那一波**。因为每次进商店之后玩家都会点"下一波"，
  // 所以任何完整局的成绩码都验不过。旧用例活得太短、从没走到商店，所以没抓到。
  const replayStep = (x, y) => {
    if (Scene.simulates(Game.state)) Game.step(Game.cfg.fixedDt, { x: x, y: y });
    Input.endFrame();
  };
  const char = 'ranger', seed = 20260502;
  Rec.start();
  Game.newRun(char, seed, 0);
  // 直接把这一波判完 → 进商店 → 下一波（这两步都在带子里）
  const hook = () => {
    const s = Game.getSession();
    s.waveLeft = 0; s.spawnQueue = []; s.spawnIdx = 0; s.enemies.length = 0;
  };
  hook();
  for (let f = 0; f < 40; f++) { Rec.input({ x: 0, y: 0 }); if (Scene.simulates(Game.state)) Game.step(Game.cfg.fixedDt, { x: 0, y: 0 }); Input.endFrame(); }
  ok(Game.state === 'shop', '先走到商店', Game.state);
  const waveBefore = Game.wave;
  Game.nextWave();
  ok(Game.wave === waveBefore + 1, '点了"下一波"（wave ' + waveBefore + ' → ' + Game.wave + '）', Game.wave);
  for (let f = 0; f < 40; f++) { Rec.input({ x: 0, y: 0 }); if (Scene.simulates(Game.state)) Game.step(Game.cfg.fixedDt, { x: 0, y: 0 }); Input.endFrame(); }
  const tape2 = Rec.stop();
  const live = Game.getSession();
  const claims2 = {
    key: '2026-05-02', char: char, danger: 0, seed: seed,
    wave: Game.wave, kills: Math.round(live.stats_total.kills), level: live.player.level, win: false
  };
  const code2 = Score.make(claims2, Score.hashTape(tape2));
  const res2 = Score.verify(code2, tape2, replayStep);
  ok(res2.ok === true, '带子里有"商店 + 下一波"时，重放验证仍然通过：' + res2.reason,
    res2.actual ? JSON.stringify(res2.actual) : '');
  ok(res2.actual && res2.actual.wave === Game.wave,
    '重放出来的波次与原局一致（' + Game.wave + '）', res2.actual && res2.actual.wave);
  ok(tape2.events.filter(e => e.cmd === 'setState').length < tape2.events.length,
    '带子里只剩外层命令（嵌套的 setState 不再被当成独立命令）',
    tape2.events.map(e => e.cmd).join(','));
}

/* ---------------- 7. 每日记录（profile） ---------------- */
console.log('\n[7] 每日记录：只保留当天更好的那一局');
{
  Storage.use(Storage.memory(Object.create(null)));
  Storage.wipe();
  Profile.reset();
  const mk = (score, wave) => ({
    key: '2026-05-01', seed: 1, char: 'ranger', danger: 0,
    wave: wave, kills: 10, level: 3, win: false, score: score, at: Date.now(), frames: 100
  });

  ok(Profile.dailyOf('2026-05-01') === null, '还没打过 → null');
  let r = Profile.recordDaily(mk(1000, 5));
  ok(r.improved === true && r.best.score === 1000, '第一次记录算提升');
  r = Profile.recordDaily(mk(500, 3));
  ok(r.improved === false && Profile.dailyOf('2026-05-01').score === 1000,
    '更差的一局不留（每日挑战刷的是自己的记录，不是多打几次攒分）',
    Profile.dailyOf('2026-05-01').score);
  r = Profile.recordDaily(mk(2000, 8));
  ok(r.improved === true && Profile.dailyOf('2026-05-01').wave === 8, '更好的一局覆盖');

  Profile.recordDaily({ ...mk(3000, 9), key: '2026-05-02' });
  ok(Profile.dailyKeys().join(',') === '2026-05-01,2026-05-02', '按日期分天存（可回看历史）',
    Profile.dailyKeys().join(','));

  // 落盘往返
  Profile.load();
  ok(Profile.dailyOf('2026-05-02') && Profile.dailyOf('2026-05-02').score === 3000, '每日记录会落盘');

  // 坏档：非法日期键与非数值被丢掉
  Storage.setJSON(Storage.KEYS.profile, {
    v: 1, at: Date.now(), kind: 'profile',
    data: { daily: { '不是日期': { score: 1 }, '2026-05-03': { score: 'abc', wave: 2, char: 'ranger' } } }
  });
  Profile.load();
  ok(Profile.dailyOf('不是日期') === null, '非法日期键被丢弃');
  ok(Profile.dailyOf('2026-05-03') && Profile.dailyOf('2026-05-03').score === 0,
    '非数值分数归零（这一条仍然保留）', JSON.stringify(Profile.dailyOf('2026-05-03')));
  Profile.reset();
}

/* ---------------- 8. 总账与接入 ---------------- */
console.log('\n[8] 总账与接入');
{
  const a = Registry.audit();
  const probs = a.problems.filter(p => p.family === 'dailyField' || p.family === 'scoreField');
  ok(probs.length === 0, 'registry 审计对每日/成绩家族不报错', probs.length);
  ok(Registry.has('dailyField') && Registry.has('scoreField'), '两个家族都登记了');
  const prof = Registry.ids('profileSection');
  ok(prof.indexOf('daily') >= 0, 'profileSection 里登记了 daily（新增跨局状态要显式登记）', prof.join(','));

  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  ok(/data-act="daily"/.test(html), 'index.html 里有每日挑战入口');
  const uiSrc = fs.readFileSync(path.join(ROOT, 'src', 'ui.ts'), 'utf8');
  ok((await uiMissingActs(['daily'])).length === 0, 'daily 动作注册在界面动作表里（不再靠源码里找 case）');
  ok(/UI\.dailyStart/.test(uiSrc), '界面层通过注入的钩子发起每日挑战（不认识"今天是什么种子"）');
}

console.log('\n=== 结果 ===');
if (failures === 0) { console.log('\x1b[32m全部通过 ✔\x1b[0m\n'); process.exit(0); }
console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m\n');
process.exit(1);
