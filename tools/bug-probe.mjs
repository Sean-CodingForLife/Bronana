/* =========================================================
   bug-probe.mjs — **不变量随机探针**（找的是"逻辑上不该发生的事"）
   ---------------------------------------------------------
   它不是单元测试：单元测试验的是"我想到的路径"，而探针跑的是
   **有代表性的随机对局**，每一帧都对一整批不变量做断言。
   价值在于它抓到的 bug 大多不在任何人的清单上（历史上抓过：
   血量超上限、零武器软锁、读档多出道具、子弹分叉、状态机被非法参数打穿）。

   走位与商店决策在 `tools/_run.mjs`（与 `fun-audit.mjs` **共用一份**）：
   两份实现会给同一个种子两个答案，那比没有工具更糟。

   探针与体检的分工：
     · 这里问"**有没有不该发生的事**"（红了就是 bug）
     · `fun-audit.mjs` 问"**好不好玩**"（只报数字，判定在 README）

   用法： node tools/bug-probe.mjs [局数] [最大波次]
   ========================================================= */
import { Game, U, Containers, Dungeon, Weapons, Stats, playRun } from './_run.mjs';

const RUNS = Math.max(1, parseInt(process.argv[2] || '24', 10));
const MAX_WAVE = Math.max(1, parseInt(process.argv[3] || '40', 10));

const problems = new Map();
function report(kind, detail) {
  if (!problems.has(kind)) problems.set(kind, []);
  const arr = problems.get(kind);
  if (arr.length < 6) arr.push(detail);
}

/* ---------------- 不变量 ---------------- */
function badNum(v) { return typeof v === 'number' && !Number.isFinite(v); }

function checkSession(sess, where) {
  /* 1) 容器总账（上限 / 漏回收 / 重复对象） */
  const cp = Containers.check(sess);
  if (cp.length) report('容器不变量', where + ' → ' + cp.slice(0, 4).join(' ; '));

  const p = sess.player;

  /* 2) 玩家数值 */
  if (badNum(p.x) || badNum(p.y)) report('玩家坐标非有限', where + ' → (' + p.x + ',' + p.y + ')');
  if (badNum(p.hp)) report('玩家生命非有限', where + ' → hp=' + p.hp);
  else if (p.hp < 0) report('玩家生命为负', where + ' → hp=' + p.hp);
  else if (p.hp > sess.stats.maxHp + 1e-6) report('玩家生命超上限', where + ' → hp=' + p.hp + ' maxHp=' + sess.stats.maxHp);
  if (!(p.level >= 1) || badNum(p.level)) report('玩家等级非法', where + ' → level=' + p.level);
  if (badNum(p.scrap)) report('材料非有限', where + ' → materials=' + p.scrap);
  else if (p.scrap < 0) report('材料为负', where + ' → materials=' + p.scrap);
  if (badNum(p.xp) || p.xp < 0) report('经验非有限/负', where + ' → xp=' + p.xp);
  if (p.weapons.length > Game.cfg.maxWeapons) report('武器超过槽位', where + ' → ' + p.weapons.length);

  /* 3) 场上对象：坐标与生命必须有限 */
  const lists = [['enemies', sess.enemies], ['bullets', sess.bullets], ['ebullets', sess.ebullets],
    ['pickups', sess.pickups], ['turrets', sess.turrets]];
  for (const [name, list] of lists) {
    if (!Array.isArray(list)) { report('容器不是数组', where + ' → ' + name); continue; }
    for (const o of list) {
      if (!o) { report(name + ' 里有空对象', where); continue; }
      if (badNum(o.x) || badNum(o.y)) { report(name + ' 坐标非有限', where + ' → ' + JSON.stringify({ x: o.x, y: o.y, id: o.id })); break; }
      if (o.hp !== undefined && badNum(o.hp)) { report(name + ' 生命非有限', where + ' → hp=' + o.hp); break; }
    }
  }

  /* 4) 战斗统计只许涨（负增长说明扣错了地方） */
  const t = sess.stats_total;
  if (badNum(t.kills) || t.kills < 0) report('击杀统计非法', where + ' → ' + t.kills);
  if (badNum(t.dmg) || t.dmg < 0) report('伤害统计非法', where + ' → ' + t.dmg);

  /* 5) 波次与层号 */
  if (!(Game.wave >= 1) || badNum(Game.wave)) report('波次非法', where + ' → ' + Game.wave);
  if (!(sess.floor >= 1) || badNum(sess.floor)) report('层号非法', where + ' → ' + sess.floor);
  if (!sess.map) report('会话没有地图', where);

  /* 6) **至少一把武器**：零武器 = 这一间永远清不掉（"打完"的条件是场上清空）
        = 商店永不再开 = 再也买不回来。这一条是实测出来的硬软锁。 */
  if (['playing', 'shop', 'camp', 'levelup'].indexOf(Game.state) >= 0 && p.weapons.length < 1) {
    report('零武器（这一局再也清不掉）', where + ' → 状态=' + Game.state);
  }

  /* 7) **回收价不许超过你为它付过的钱**（data_weapons.ts 的 salvageOf）。
        过不了的话，"折扣叠满买光拆光"与"造了立刻拆"两条印钞路线就回来了。 */
  for (const w of p.weapons) {
    const paid = Math.floor(Number(w.paid) || 0);
    if (paid <= 0) continue;
    const back = Weapons.salvageOf(w, sess.salvageRate);
    if (back > paid) { report('回收价超过成交价（可以刷材料）', where + ' → ' + w.def.id + ' 买' + paid + '/拆' + back); break; }
  }

  /* 8) 这一间的房间效果与难度折叠都必须是有限数（读档会贴 roomFx / wmods） */
  const rf = sess.roomFx || {};
  for (const k of ['shopSlots', 'shopDiscount', 'fastMul', 'slowMul']) {
    if (badNum(rf[k])) { report('roomFx 非有限', where + ' → ' + k + '=' + rf[k]); break; }
  }
  /* 9) 属性公式的输出必须有限（护甲在 -14 曾经有一击必死的极点） */
  if (badNum(Stats.moveSpeed(sess.stats))) report('移速非有限', where + ' → ' + Stats.moveSpeed(sess.stats));
  if (badNum(Stats.damageTaken(sess.stats, 10))) report('受伤倍率非有限', where + ' → armor=' + sess.stats.armor);

  /* 10) **状态机不许被非法参数打穿**。
        实测过的那一条：`enterRoom(9)`（越界方向）会把状态从 shop 打回 playing，
        于是之后每一次买东西都被"当前不在商店界面"拒掉 —— 玩家看到的是
        "我明明还在商店里，怎么买不了了"。凡是"拒绝了"的操作都不许改状态，
        这条不变量把整类问题一次盖住。 */
  if (['shop', 'camp', 'levelup', 'end'].indexOf(Game.state) >= 0) {
    if (sess.enemies.length === 0 && !sess.waveEnding && sess.spawnQueue.length === 0) {
      const rm = sess.map ? sess.map.rooms.filter(r => r.id === sess.roomId)[0] : null;
      if (rm && !rm.cleared && Game.state === 'shop') {
        report('状态机异常（没清的房间却已经在商店）', where + ' → 房=' + rm.type);
      }
    }
  }
}

/* ---------------- 存档往返（在**自然存档点**：商店里） ---------------- */
function makeRoundTrip(where) {
  return function (sess) {
    let before = null, data = null;
    try { before = Game.exportRun(); data = JSON.parse(JSON.stringify(before)); }
    catch (e) { report('存档不可 JSON 化', where('存档') + ' → ' + e.message); return null; }
    let s2 = null;
    try { s2 = Game.importRun(data); }
    catch (e) { report('读档抛异常', where('读档') + ' → ' + e.message); return null; }
    if (!s2) { report('读档返回空', where('读档')); return null; }
    checkSession(s2, where('读档后'));
    let after = null;
    try { after = Game.exportRun(); } catch (e) { report('再存档抛异常', where('再存档') + ' → ' + e.message); return s2; }
    for (const k of Object.keys(before)) {
      if (k === 'rndState') continue;                    // 随机流接着走，本来就不同
      const a = JSON.stringify(before[k]), b = JSON.stringify(after[k]);
      if (a !== b) report('读档往返丢了东西', where('往返') + ' → ' + k + '：' + a + ' → ' + b);
    }
    for (const k of Object.keys(after)) {
      if (k !== 'rndState' && !(k in before)) report('读档往返多出字段', where('往返') + ' → ' + k);
    }
    return s2;
  };
}

/* ---------------- 跑 ---------------- */
console.log('\n=== Teapot · 不变量随机探针 ===');
console.log('  ' + RUNS + ' 局 · 每局最多 ' + MAX_WAVE + ' 波\n');

const t0 = Date.now();
let totalFrames = 0;
const reached = [];
const tails = [];
for (let i = 0; i < RUNS; i++) {
  const st = playRun({
    runIndex: i, seedBase: 100000, maxWave: MAX_WAVE,
    onFrame: (sess, frames) => {
      const where = (tag) => '局' + i + ' 种子' + sess.seed + ' ' + sess.charDef.id + ' 第' + Game.wave + '波 ' + tag;
      checkSession(sess, where('帧' + frames));
    },
    roundTrip: makeRoundTrip((tag) => '局' + i + ' 种子' + Game.seed + ' ' + tag),
    onError: (e) => { report('step 抛异常', '局' + i + ' → ' + e.message); }
  });
  if (!st) { report('开局失败', '局' + i); continue; }
  totalFrames += st.frames;
  reached.push(st.waves);
  tails.push('  第' + String(st.waves).padStart(2) + '波 层' + st.floor + ' Lv' + String(st.level).padStart(2) +
    ' 击杀' + String(st.kills).padStart(4) + ' 结束于 ' + st.state + (st.stepError ? '（' + st.stepError + '）' : ''));
  if ((i + 1) % 4 === 0) console.log('  … 已跑 ' + (i + 1) + ' 局 / ' + totalFrames + ' 帧');
}
const secs = (Date.now() - t0) / 1000;

console.log('\n  每局落点：');
for (const l of tails) console.log(l);
console.log('\n  合计 ' + totalFrames + ' 帧 · ' + secs.toFixed(1) + ' 秒 · 最深到第 ' + Math.max.apply(null, reached) + ' 波');

if (problems.size === 0) {
  console.log('\n  \x1b[32m不变量全部成立 —— 没找到问题\x1b[0m\n');
  process.exit(0);
}
console.log('\n  \x1b[31m发现 ' + problems.size + ' 类可疑\x1b[0m\n');
for (const [kind, arr] of problems) {
  console.log('  【' + kind + '】');
  for (const a of arr) console.log('      ' + a);
  console.log('');
}
process.exit(1);
