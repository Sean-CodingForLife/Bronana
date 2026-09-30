/* =========================================================
   debug.mjs — 引擎级工具三项的测试
     1) 存档迁移链：老档逐级升上来，而不是"拒绝"
     2) 录制 / 回放：同一条带子重放出逐位一致的对局
     3) 诊断面板：聚合的文本确实包含各系统的账目，且不参与玩法
   用法： node test/debug.mjs
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { loadAll, SIM_MODULES, RENDER_MODULES, UI_MODULES } from './_load.mjs';
import { installDom } from './_ctx.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
let failures = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  \x1b[32mPASS\x1b[0m ' + label);
  else { failures++; console.log('  \x1b[31mFAIL\x1b[0m ' + label + (extra !== undefined ? '  → ' + extra : '')); }
}
function throws(fn) { try { fn(); return null; } catch (e) { return e.message; } }

installDom();
const g = globalThis;

console.log('\n=== Bronana · 调试与工具三项 ===\n');
console.log('[1] 加载（含界面层：诊断面板要接上 DOM）');
let loadErr = null;
try { await loadAll(UI_MODULES); } catch (e) { loadErr = e.message; }
ok(!loadErr, '全部模块加载成功', loadErr);
if (loadErr) process.exit(1);

const { Save, Storage, Rec, Diag, Game, Registry, Containers, Depth, UI, Scene } = g;
const FIXED = Game.cfg.fixedDt;

/* ---------------- 1. 存档迁移链 ---------------- */
console.log('\n[2] 存档迁移链');
{
  ok(Save.VERSION >= 1 && Array.isArray(Save.migrationVersions()), '迁移链接口存在（当前 v' + Save.VERSION + '）');

  // 造一份"v0"的老档：只有 wave/char/level，且字段名是老的（hpMax → 现在叫 stats.maxHp 之类）
  Storage.use(Storage.memory());
  const oldRaw = {
    v: 0, at: 1, kind: 'run',
    data: { char: 'ranger', wave: 3, level: 2, hp: 40, scrap: 7, weapons: ['pistol'], items: [], kills: 12, seed: 4242 }
  };
  Storage.set(Storage.KEYS.run, JSON.stringify(oldRaw));
  Save.lastError();
  const rejected = Save.loadRun();
  ok(rejected === null, '没有迁移函数时，老档被拒绝（而不是崩）', String(rejected));
  ok(/迁移|版本/.test(Save.lastError() || ''), '拒绝原因说得清', Save.lastError());

  // 装一条 v0 → v1 的迁移（真实项目里这就是"字段改名 / 补默认值"）
  let migrated = 0;
  Save.migration(0, function (data) {
    migrated++;
    if (data.boom) throw new Error('故意炸');     // 用来验证"迁移抛错也被兜住"
    return {
      char: data.char, wave: data.wave, level: data.level,
      hp: data.hp, scrap: data.scrap,
      weapons: data.weapons, items: data.items || [],
      kills: data.kills, seed: data.seed,
      stats_total: { kills: data.kills || 0, scrap: data.scrap || 0 }
    };
  });
  ok(Save.migrationVersions().indexOf(0) >= 0, '迁移已登记', Save.migrationVersions().join(','));
  const e1 = throws(() => Save.migration(0, function () { return {}; }));
  ok(!!e1 && /已存在/.test(e1), '同一版本重复登记迁移被拒绝', e1);
  const e2 = throws(() => Save.migration(-5, null));
  ok(!!e2 && /必须是函数/.test(e2), '非法迁移函数被拒绝', e2);

  const sess = Save.loadRun();
  ok(!!sess && migrated === 1, '老档经迁移链升上来，能读出会话', migrated + ' 次迁移');
  ok(sess && sess.player && sess.player.level === 2, '迁移后的字段被还原', sess && String(sess.player.level));
  ok(sess && Game.wave === 3, '波次被还原', String(Game.wave));

  // 比当前版本还新的档（用户装回了旧客户端）必须拒绝
  Storage.set(Storage.KEYS.run, JSON.stringify({ v: Save.VERSION + 1, at: 1, kind: 'run', data: { char: 'ranger', wave: 2 } }));
  ok(Save.loadRun() === null && /版本不符/.test(Save.lastError() || ''),
    '比当前版本新的档被拒绝（说明原因）', Save.lastError());

  // 迁移抛错也不能让游戏起不来
  Storage.set(Storage.KEYS.run, JSON.stringify({ v: 0, at: 1, kind: 'run', data: { char: 'ranger', wave: 2, boom: true } }));
  const broken = Save.loadRun();
  ok(broken === null && /迁移失败/.test(Save.lastError() || ''), '迁移抛错被兜住并说明原因', Save.lastError());
}

/* ---------------- 2. 录制 / 回放 ---------------- */
console.log('\n[3] 录制 / 回放');
{
  // 录制：只走**公开命令**（内部 API 不进带子 —— 这正是回放能对上的前提）
  Storage.use(Storage.memory());
  Rec.start();
  Game.newRun('ranger', 20240922);
  const drive = (frames) => {
    for (let i = 0; i < frames; i++) {
      /* 顺序必须与回放一字不差：**先这一帧的命令，再这一帧的输入，最后 step**
         （回放就是 `命令(frame ≤ f) → step(inputs[f])`）。
         老写法只在 playing 分支里记输入，"进商店/选卡"的那些帧没有输入，
         帧号与输入下标从此错位；更糟的是 `nextWave()` 之后状态已经变成 playing，
         老循环会在同一帧里再 step 一次 —— 而回放那一帧没得 step，于是回放与录制
         差一整帧（房间制让一局里进了十几次商店，这个错位立刻显形）。 */
      if (Game.state === 'levelup') Game.chooseLevelCard(0);   // 走 Game 的命令 → 被录进带子
      else if (Game.state === 'shop' || Game.state === 'camp') Game.nextWave();
      const inp = Game.state === 'playing' ? Game.autoInput(i * FIXED) : { x: 0, y: 0 };
      Rec.input(inp);
      if (Game.state === 'playing') Game.step(FIXED, inp);
      Game.getSession().player.hp = Game.getSession().stats.maxHp;
    }
  };
  drive(900);
  const tape = Rec.stop();
  const first = fingerprint();
  ok(tape.frames === 900 && tape.events.length >= 1,
    '带子记录了 ' + tape.frames + ' 帧输入与 ' + tape.events.length + ' 条命令', JSON.stringify(Rec.stats()));
  ok(tape.seed === 20240922, '带子里存了落定后的种子（不传种子时是随机的，必须记下来）', String(tape.seed));
  ok(tape.events.some(e => e.cmd === 'newRun'), '命令按帧号记录（newRun 在带子里）');

  // 回放：**不做任何决策**，只推进逻辑帧 —— 选卡/进波这些都由带子里的命令驱动
  Game.newRun('gladiator', 1);        // 故意先弄乱局面
  Game._internals.startWave(9);
  Rec.play(tape, function (x, y) {
    if (Game.state === 'playing') Game.step(FIXED, { x: x, y: y });
    Game.getSession().player.hp = Game.getSession().stats.maxHp;
  });
  const second = fingerprint();
  ok(first === second, '回放后的状态指纹与录制时逐位一致',
    first.slice(0, 60) + '… vs ' + second.slice(0, 60) + '…');
  ok(Rec.isRecording() === false, '回放期间不会把回放的命令再录一遍');

  // 带子可序列化（能存文件 / 传给 CLI）
  const json = JSON.stringify(tape);
  ok(json.length > 100 && JSON.parse(json).frames === 900, '带子可 JSON 序列化', json.length + ' 字节');
  const e1 = throws(() => Rec.play({ v: 99 }, function () {}));
  ok(!!e1 && /带子版本/.test(e1), '不认识的带子版本被拒绝', e1);
}

/* ---------------- 3. 诊断面板 ---------------- */
console.log('\n[4] 诊断面板');
{
  ok(UI.diagEnabled() === false, '默认关闭');
  const on = UI.setDiag(true);
  ok(on === true && UI.diagEnabled(), '可以打开', String(on));

  const text = Diag.text();
  ok(text.split('\n').length >= 5, '简报有多行', String(text.split('\n').length));
  ok(/状态|波次/.test(text), '含状态与波次');
  ok(/帧\s+FPS/.test(text), '含帧预算');
  ok(/容器/.test(text), '含容器账目');
  ok(/深度/.test(text), '含深度层带');
  ok(/总账/.test(text) && /审计通过/.test(text), '含扩展点总账与审计结论');
  ok(/贴图/.test(text), '含贴图缓存账目');

  const full = Diag.full();
  ok(full.indexOf('容器账目') >= 0 && full.indexOf('深度队列') >= 0 && full.indexOf('扩展点总账') >= 0,
    '展开档把三份 describe() 都放出来');

  // 面板写 DOM：节流到 4Hz。用"累加器有没有被吃掉"来观察（返回值就是证据）
  ok(UI.refreshDiag(true) === true, '强制刷新返回 true 并生成文本', UI.diagText().slice(0, 24));
  ok(UI.refreshDiag(false) === false, '刚刷新过 → 未到间隔不刷新');
  UI.tickDiag(0.3);
  ok(UI.refreshDiag(false) === false, 'tickDiag 累计到 0.25 秒后自动刷新（累加器被吃掉）');
  UI.tickDiag(0.1);
  ok(UI.refreshDiag(false) === false, '只累计 0.1 秒 → 仍在间隔内（累加器留着 0.1）');
  UI.tickDiag(0.2);
  ok(UI.refreshDiag(false) === false, '再累 0.2 秒（共 0.3）→ tickDiag 内部刷新了（累加器又被吃掉）');

  UI.setDiag(false);
  ok(UI.diagEnabled() === false && UI.refreshDiag(true) === false, '关掉之后不再刷新（零开销）');

  // 面板不参与玩法：diag.ts 不得依赖任何模拟写入接口
  const src = fs.readFileSync(path.join(ROOT, 'src', 'diag.ts'), 'utf8');
  ok(!/Game\.(step|newRun|setState|chooseLevelCard)/.test(src),
    'diag.ts 不调用任何"改变一局"的接口（只读）');
  ok(/(Registry|Containers|Depth)\./.test(src), '面板显示的就是那几个系统自己的账目');
}

/* ---------------- 汇总 ---------------- */
function fingerprint() {
  const s = Game.getSession();
  const parts = [
    Game.state, Game.wave, s.player.level, Math.round(s.player.xp), Math.round(s.player.hp),
    Math.round(s.player.scrap), s.stats_total.kills,
    s.enemies.length, s.bullets.length, s.ebullets.length, s.pickups.length, s.decals.length,
    s.player.weapons.map(w => w.id).join('+'),
    s.enemies.map(e => e.x.toFixed(2) + ',' + e.y.toFixed(2) + ',' + e.hp.toFixed(1)).join(';')
  ];
  return parts.join('|');
}

console.log('\n=== 结果 ===');
if (failures === 0) { console.log('\x1b[32m全部通过 ✔\x1b[0m'); process.exit(0); }
console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m');
process.exit(1);
