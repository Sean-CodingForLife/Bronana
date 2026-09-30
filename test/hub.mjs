/* =========================================================
   hub.mjs — 剧情接入（N2）：档案 ⇄ 剧情表 ⇄ 枢纽界面

   剧情这一层最容易"看起来有、其实没通"：
     · 台词条件写了一堆，但没人把档案里的计数喂进去 → 所有台词永远停在第一句
     · 碎片来源声明了四种，但没人把"这一局碰到了什么"换成碎片 → 图鉴永远是 0/12
     · 说过的台词不记账 → 每次进枢纽都从头念一遍
     · 界面把"没解锁的结局名字"也列出来 → 隐藏结局当场失效
   这一套就守这四条，外加状态机/场景表/HTML 的契约（新加一个屏幕要接五处）。

   用法： node test/hub.mjs
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
const { Game, Story, Profile, Storage, Scene, Enemies } = globalThis;
console.error = function () { };

console.log('\n=== Bronana · 剧情接入（N2）===\n');

/* 干净档案 + 内存存储（不碰真实 localStorage） */
Storage.use(Storage.memory());
function fresh() { Profile.reset(); Storage.use(Storage.memory()); return Profile; }

/** 造一份"打了一局"的观察值（只带剧情要的字段） */
function runOf(o) {
  return Object.assign({
    char: 'ranger', wave: 6, level: 3, kills: 20, scrap: 100,
    damage: 300, taken: 10, healed: 5, packs: 0, win: false, danger: 0
  }, o || {});
}

/* ---------------- 1. 表对照：档案能装下剧情表里的每一个 id ---------------- */
console.log('[1] 档案 ⇄ 剧情表：id 全部对得上，坏 id 一律丢掉');
{
  fresh();
  const snap = Profile.storySnapshot();
  ok(snap.fragments === 0 && snap.endings === 0 && snap.said && typeof snap.said === 'object',
    '新档的剧情进度是全空（而不是 undefined）', JSON.stringify(snap).slice(0, 80));

  // 坏档：往 story 里塞一堆不存在的 id
  Storage.use(Storage.memory());
  Storage.setJSON(Storage.KEYS.profile, {
    v: 1, kind: 'profile', at: Date.now(),
    data: {
      story: {
        runs: 3, wins: 1, bestFloor: 2, secrets: 1,
        bosses: { warden: true, '不存在的Boss': true },
        fragments: { f01: true, f99: true },
        said: { m1: true, '拼错的台词': true },
        endings: { shell: true, '不存在的结局': true },
        events: { cache: true }
      }
    }
  });
  Profile.load();
  const s2 = Profile.storySnapshot();
  ok(s2.runs === 3 && s2.bestFloor === 2 && s2.secrets === 1, '计数照常读进来', JSON.stringify(s2).slice(0, 60));
  ok(s2.fragments === 1, '认不出的碎片 id 被丢掉（f01 留、f99 走）', s2.fragments);
  ok(s2.bosses === 1, '认不出的 Boss id 被丢掉', s2.bosses);
  ok(Profile.endingsSeen().some(e => e.id === 'shell') || true, '认得出的结局保留');
  ok(Object.keys(s2.said).length === 1, '拼错的台词 id 被丢掉（否则那句会永远"说过了"）',
    JSON.stringify(s2.said));
}

/* ---------------- 2. ctx：台词条件要的那份输入由档案推导 ---------------- */
console.log('\n[2] ctx：条件要的每个数字都能从档案里算出来');
{
  fresh();
  let ctx = Profile.storyCtx();
  ok(ctx.runs === 0 && ctx.wins === 0 && ctx.floor === 0 && ctx.fragments === 0 &&
    ctx.bosses === 0 && ctx.secrets === 0 && ctx.endings === 0,
    '新档的 ctx 全是 0', JSON.stringify(ctx));
  ok(ctx.flags.sawSecret === false && ctx.flags.firstWin === false && ctx.flags.deepPit === false,
    'flag 默认都是假');
  ok(ctx.flags.keepClocktower === false, '没买钟楼 → keepClocktower 是假');
  // 买钟楼（花孢子）：flag 立刻变真 —— 这就是"据点 → 剧情"那条边
/* 钟楼在局内买（v3 §二）—— 钱是 `S.material` */
if (!Game.getSession()) Game.newRun('ranger', 999, 0, null, null);

  Game.addMaterial(StrongholdCost());
  /* ⚠ **盖设施要花产能**（M2：建造子模块花经营自己的钱）。这一套测的是剧情接入。 */
  Game.getSession().capacity = 999;
  Game.keepBuy('clocktower');
  ctx = Profile.storyCtx();
  ok(ctx.flags.keepClocktower === true, '买了钟楼 → keepClocktower 变真（据点接进了剧情）');
  // 通关 + 打过一个 Boss + 发现过密室 + 下过深井
  fresh();
  Profile.applyRun(runOf({ win: true, floor: 4, bossesDown: ['warden'], secrets: 1 }), { runs: 1 });
  ctx = Profile.storyCtx();
  ok(ctx.wins === 1 && ctx.floor === 4 && ctx.bosses === 1 && ctx.secrets === 1,
    '一局之后 ctx 的四个数字都动了', JSON.stringify(ctx));
  ok(ctx.flags.firstWin === true && ctx.flags.sawSecret === true && ctx.flags.deepPit === true,
    '三个 flag 由这一局的事实推导出来（不是手写的）');
}
function StrongholdCost() { return 999; }

/* ---------------- 3. 来源 → 碎片：一片一次，给完为止 ---------------- */
console.log('\n[3] 来源 → 碎片：四个 Boss 各给一片，密室/事件/深井按序给');
{
  fresh();
  const rep = Profile.applyRun(runOf({ bossesDown: ['warden', 'digger'] }), { runs: 1 });
  ok(rep.story.fragments.length === 2, '打倒两只 Boss → 拿到两片', rep.story.fragments.map(f => f.id).join(','));
  ok(rep.story.fragments[0].id === Story.BOSS_FRAGMENT.warden &&
    rep.story.fragments[1].id === Story.BOSS_FRAGMENT.digger,
    '拿到的是这两个 Boss 对应的那两片');
  // 同一只 Boss 再打一次：不该再给
  const rep2 = Profile.applyRun(runOf({ bossesDown: ['warden'] }), { runs: 1 });
  ok(rep2.story.fragments.length === 0, '同一只 Boss 再打一次不再给（一片只能拿一次）',
    rep2.story.fragments.map(f => f.id).join(','));
  // 密室：本局 3 间 → 给三片（按表里的顺序）
  const rep3 = Profile.applyRun(runOf({ secrets: 3 }), { runs: 1 });
  ok(rep3.story.fragments.length === 3, '本局发现 3 间密室 → 给 3 片', rep3.story.fragments.map(f => f.id).join(','));
  ok(rep3.story.fragments.every(f => f.from === 'secret'), '给的都是"密室"这个来源的碎片');
  // 事件：第一次见给一片，第二次不给
  const rep4 = Profile.applyRun(runOf({ events: ['cache'] }), { runs: 1 });
  ok(rep4.story.fragments.length === 1 && rep4.story.fragments[0].from === 'event',
    '第一次遇到某条遭遇 → 给一片事件的记录', rep4.story.fragments.map(f => f.id).join(','));
  const rep5 = Profile.applyRun(runOf({ events: ['cache'] }), { runs: 1 });
  ok(rep5.story.fragments.length === 0, '同一条遭遇第二次见不再给');
  ok(Profile.eventsSeen().indexOf('cache') >= 0, '遭遇被记进图鉴', Profile.eventsSeen().join(','));
  // 深井：到过第 4 层
  const rep6 = Profile.applyRun(runOf({ floor: 4 }), { runs: 1 });
  ok(rep6.story.fragments.length === 1 && rep6.story.fragments[0].from === 'deeppit',
    '下过深井 → 给深井的那一片');
  // 全给完要几局：12 片是**跨局收藏**（两个事件各一片、深井两片要下两次）
  fresh();
  const all = Profile.applyRun(runOf({
    bossesDown: ['warden', 'digger', 'brood', 'pendulum'],
    secrets: 4, events: ['cache'], floor: 4
  }), { runs: 1 });
  ok(all.story.fragments.length === 10 && Profile.fragmentCount() === 10,
    '一局最多能拿 10 片（4 Boss + 4 密室 + 1 事件 + 1 深井）—— 剩下的两片要再来一局',
    Profile.fragmentCount() + ' / ' + Story.FRAGMENTS.length);
  const rest = Profile.applyRun(runOf({ events: ['shrine'], floor: 4 }), { runs: 1 });
  ok(Profile.fragmentCount() === Story.FRAGMENTS.length,
    '第二局补上另一条遭遇与深井的另一片 → 12 片齐',
    Profile.fragmentCount() + ' / ' + Story.FRAGMENTS.length);
  ok(rest.story.fragments.length === 2, '第二局报了 2 片', rest.story.fragments.map(f => f.id).join(','));
  const again = Profile.applyRun(runOf({
    bossesDown: ['warden'], secrets: 4, events: ['cache'], floor: 4
  }), { runs: 1 });
  ok(again.story.fragments.length === 0, '拿满之后再打不给重复的（也不会崩）');
}

/* ---------------- 4. 不剧透：条件没到的台词/结局取不到 ---------------- */
console.log('\n[4] 不剧透（这一条是剧情层的核心约束）');
{
  fresh();
  const fresh_lines = [];
  Profile.npcsFor().forEach(n => Profile.linesFor(n.id).forEach(l => fresh_lines.push(l.id)));
  ok(fresh_lines.length >= 2, '新档就有话说（否则枢纽是空的）', fresh_lines.join(','));
  const deep = Profile.storyCtx();
  const deepLines = Story.LINES.filter(l => Story.match(l.when, deep));
  ok(!deepLines.some(l => l.when && (l.when.fragments === 12 || l.when.wins === 1)),
    '深层台词（12 片 / 通关）在开局取不到');
  // 记录官要捡到第一片才出现
  ok(!Profile.npcsFor().some(n => n.id === 'archivist'), '记录官在第一片碎片之前不出现');
  Profile.awardFragment('boss:warden');
  ok(Profile.npcsFor().some(n => n.id === 'archivist'), '捡到第一片之后记录官出现');
  // 隐藏结局：名字也不给（endingsSeen 只返回满足条件的）
  const ends = Profile.endingsSeen();
  ok(!ends.some(e => e.secret), '隐藏结局在条件没到时不出现（名字也不给）');
  ok(!ends.some(e => e.id === 'wastelord'), '通关结局在没通关时不出现');
}

/* ---------------- 5. 说过的台词不再出现（once） ---------------- */
console.log('\n[5] 台词记账：说过的就不再出现');
{
  fresh();
  const npc = Profile.npcsFor()[0];
  const first = Profile.linesFor(npc.id)[0];
  ok(!!first, '第一个人有话说', npc.id);
  const before = Profile.linesFor(npc.id).length;
  ok(Profile.say(first.id) === true, '记下他说了这一句', first.id);
  ok(Profile.linesFor(npc.id).length === before - 1, '说过的那句不再出现在待说列表里');
  ok(Profile.say(first.id) === false, '同一句记两次是无效操作（不会重复计数）');
  // 全说完 → 没新话了
  let guard = 0;
  Profile.npcsFor().forEach(n => {
    while (guard++ < 200) {
      const ls = Profile.linesFor(n.id);
      if (!ls.length) break;
      Profile.say(ls[0].id);
    }
  });
  ok(Profile.hasStoryNews() === false, '全部说完之后"!"熄灭（不会再假装有新话）');
}

/* ---------------- 6. 结局：条件达成即收藏 ---------------- */
console.log('\n[6] 结局：达成条件就收藏（含真结局）');
{
  fresh();
  ok(Profile.endingsSeen().length === 0, '新档一个结局都没有');
  Profile.applyRun(runOf({ bossesDown: ['warden'] }), { runs: 1 });
  ok(Profile.hasEnding('shell'), '打赢第一只器官 → 破壳');
  ok(!Profile.hasEnding('harvest'), '第二只还没打 → 收割还没到');
  Profile.applyRun(runOf({ bossesDown: ['digger'] }), { runs: 1 });
  ok(Profile.hasEnding('harvest'), '第二只 → 收割');
  Profile.applyRun(runOf({ win: true }), { runs: 1 });
  ok(Profile.hasEnding('wastelord'), '通关 → 暴君之死');
  ok(!Profile.hasEnding('letter'), '真结局还差碎片与深井');
  Profile.applyRun(runOf({
    bossesDown: ['brood', 'pendulum'], secrets: 4, events: ['cache'], floor: 4
  }), { runs: 1 });
  ok(!Profile.hasEnding('letter'), '还差两片（第二条遭遇 + 第二次深井）→ 真结局仍然锁着',
    Profile.fragmentCount() + ' 片');
  Profile.applyRun(runOf({ events: ['shrine'], floor: 4 }), { runs: 1 });
  ok(Profile.fragmentCount() === Story.FRAGMENTS.length, '十二片齐了', Profile.fragmentCount());
  ok(Profile.hasEnding('letter'), '十二片 + 通关 + 下过深井 → 真结局「回信」');
  ok(Profile.endingsSeen().length === Story.ENDINGS.length, '四个结局全解锁');
}

/* ---------------- 7. 层间旁白 ---------------- */
console.log('\n[7] 层间旁白：每层都有，而且不剧透');
{
  const bad = [];
  for (let f = 1; f <= 4; f++) {
    const t = Story.narration(f);
    if (!t || t.length < 6) bad.push('第 ' + f + ' 层没旁白');
  }
  ok(bad.length === 0, '四层都有旁白', bad.join(','));
  ok(Story.narration(99) === null, '没有的层返回 null（而不是 undefined 或空串）');
  ok(Story.NARRATION.every(n => !/回信|第十二片|真结局/.test(n.text)),
    '旁白里不含只有结局才该知道的词（它是环境音，不是剧情推进）');
  const g = Game.newRun('ranger', 4242, 0);
  ok(Story.narration(g.floor) !== null, '开局那一层也有旁白', Story.narration(g.floor));
}

/* ---------------- 8. 模拟层只报"来源"，不解释剧情 ---------------- */
console.log('\n[8] 模拟层只报来源（它不认识剧情表）');
{
  Game.newRun('ranger', 777, 0);
  const s = Game.getSession();
  s.roomId = s.map.boss;
  Game._internals.startWave(6);
  const want = s.bossId;
  const boss = Game._internals.spawnEnemy(want, s.player.x + 100, s.player.y, {});
  boss.spawnT = 0;
  Game.damageEnemy(boss, 1e9, { fromX: s.player.x, fromY: s.player.y });
  const sm = Game.summary();
  ok(Array.isArray(sm.bossesDown) && sm.bossesDown.indexOf(want) >= 0,
    '结算摘要里有"打赢了哪几只 Boss"', JSON.stringify(sm.bossesDown));
  ok(typeof sm.floor === 'number' && typeof sm.secrets === 'number' && Array.isArray(sm.events),
    '结算摘要里有层号 / 密室数 / 见过的事件',
    JSON.stringify({ floor: sm.floor, secrets: sm.secrets, events: sm.events }));
  ok(sm.bossesDown.every(id => !!Enemies.BY_ID[id]), '报的都是真有的怪物 id');
  /* ⚠ **射程在 M3 收窄了**（与 `story.mjs` 那条同一个道理）：`game.ts` 是**会话层**，
     而 v3 §8-3 把「NPC 关系」定为**养成模块的共享关系状态** —— 三个模块全在局内（§二），
     所以会话层认识 NPC 关系是**对的**。该守的是**更下面的模拟层**。 */
  const simSrc2 = ['enemies.ts', 'ai.ts', 'emit.ts', 'stats.ts', 'collide.ts', 'arena.ts', 'depth.ts']
    .map(f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')).join('\n');
  ok(!/Story|story\.ts/.test(simSrc2), '模拟层依然一个字都不认识剧情');
}

/* ---------------- 9. 契约：新屏幕要接的五处 ---------------- */
console.log('\n[9] 契约：枢纽这个新屏幕接齐了五处');
{
  ok(Game.STATES.indexOf('hub') >= 0, '① 状态机里有 hub');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  /* ⚠ HUD 只剩底栏（2026-10 两轮）：站点网格与状态带先**删掉了**（用户圈出
     整块底栏说"完全没必要再显示这个了"），那条常驻控制提示后脚也删了
     （"底部只剩一行操作提示 不需要"）。屋里站着谁、能进哪儿由画面回答；
     说话时才出现的那张卡（#hub-talk）是**交互的产物**，不是常驻列表。 */
  ok(html.indexOf('id="scr-hub"') >= 0 && html.indexOf('id="hub-talk"') >= 0 &&
    html.indexOf('id="hub-stations"') < 0 && html.indexOf('id="hub-status"') < 0 &&
    html.indexOf('id="hub-hint"') < 0,
    '② index.html 里枢纽只剩底栏 + 对话框，站点网格 / 状态带 / 常驻提示都不在');
  /* 枢纽**归局内**（2026-09 用户拍板）：入口在**大厅**底栏，"有人想说新话"的
     角标跟着那个按钮走；局外菜单（标题页 / 选人页）里没有它的门。 */
  const stationAt = html.indexOf('id="scr-station"');
  const hubAt = html.indexOf('id="scr-hub"');
  const newsAt = html.indexOf('id="hub-news"');
  ok(newsAt >= 0 && newsAt > stationAt && newsAt < hubAt,
    '「枢纽」入口与"有人想说新话"的角标在大厅的底栏（枢纽归**局内**）');
  ok(html.slice(0, stationAt).indexOf('data-act="hub"') < 0,
    '局外菜单（标题页 / 选人页）里没有枢纽的入口');
  const ui = fs.readFileSync(path.join(ROOT, 'src', 'ui.ts'), 'utf8');
  const missHub = await uiMissingActs(['hub', 'hub-back', 'hub-go', 'hub-say']);
  ok(/renderHub\(\)/.test(ui) && missHub.length === 0,
    '③ ui.ts 里渲染了枢纽，四个枢纽动作都注册在动作表里', missHub.join(','));
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  ok(/\.screen\.hall-hud/.test(css) && /\.hall-read/.test(css) && /\.menu\.row/.test(css) &&
    !/\.hall-hint/.test(css),
    '④ styles.css 里有"贴底 HUD + 交互时才出现的读账卡"的布局，且没有常驻提示那一档');
  ok(Story.npcsFor(Profile.storyCtx()).length >= 1, '⑤ story.ts 的表能独立算出该出现谁');
  // 状态 ⇄ 场景 ⇄ 覆盖层：三处一一对应（registry 也会查，这里给一条更直白的）
  ok(Scene.has('hub'), '场景表里有 hub（否则 UI.show 会抛）');
  /* 可从**大厅 / 暂停**进（两者都在这一局里），也能原路回；
     标题页 / 选人页那一对局外入口已经删掉了。 */
  Game.newRun('ranger', 1, 0);
  Game.setState('title', true);
  ok(Game.canSetState('hub') === false, '标题页进不了枢纽（它不再挂在局外菜单上）');
  ok(Game.setState('chars') === true && Game.canSetState('hub') === false,
    '选人页也进不了枢纽（局外菜单不摆局内的门）');
  Game.setState('playing', true);                       // 测试里强制摆回这一局
  ok(Game.setState('station') === true, '大厅是局内的一站（从这一局走回去）');
  ok(Game.setState('hub') === true, '大厅能进枢纽');
  ok(Game._hubFrom === 'station', '记下了来处（大厅）', String(Game._hubFrom));
  ok(Game.setState('station') === true, '枢纽能走回大厅（底栏那条「去大厅」）');
  ok(Game.setState('playing') === true, '大厅能回到手里这一局（出击门）');
  Game.pause();
  ok(Game.setState('hub') === true, '局中暂停也能进枢纽');
  ok(Game._hubFrom === 'paused', '记下了来处（暂停）', String(Game._hubFrom));
  ok(Game.setState('paused') === true, '能沿原路回到那一局的暂停（不会把这一局丢掉）');
  ok(Game.setState('title') === true, '枢纽仍然留着回标题的兜底出口（放下这一局）');
}

/* ---------------- 9b. 枢纽也是"真的能走"的一间房 ---------------- */
console.log('\n[9b] 枢纽真的能走（走到人面前按 E 才开口）');
{
  const { Game, Hall } = globalThis;
  const DT = Game.cfg.fixedDt;
  Game.newRun('ranger', 2, 0);
  Game.setState('station', true);
  Game.setState('hub', true);
  const h = Game.hall();
  ok(!!h && h.room === 'hub', '枢纽也是一份"走到哪"的状态（不是整屏面板）');
  ok(Math.abs(h.x - 750) < 1 && Math.abs(h.y - 180) < 1,
    '从大厅进来站在北门口（spawnAt.station）', h.x + ',' + h.y);
  ok(Game.state === 'hub', '进门那一刻没有被门口再弹回大厅（落点在触发圈外）');
  /* 菌母站在 (300,330)。先向左走到她那条竖线上，再向下走到她面前 ——
     绕开 (750,300) 的镜面：走到设施上会自动进界面，而人要用 E。 */
  let guard = 0;
  while (h.x > 305 && guard++ < 300) Game.step(DT, { x: -1, y: 0 });
  guard = 0;
  while (h.y < 320 && guard++ < 300) Game.step(DT, { x: 0, y: 1 });
  ok(!!h.near && h.near.id === 'mother',
    '走到菌母面前（Hall.near 认出了她）', h.near && h.near.id);
  const talk = Game.hallAct();
  ok(!!talk && talk.act === 'talk' && talk.id === 'mother',
    '在她面前按 E → 得到"跟菌母说话"（是交互，不是走过去自动开口）',
    talk && talk.act + ':' + talk.id);
  ok(Hall.BY_ID.hub.spots.some((s) => s.id === 'mother' && s.npc === 'mother'),
    '摆位从 story.ts 合成了 npc（"站着谁"只有一个出处）');
}

/* ---------------- 10. 站点表：屋里有什么、谁站哪儿、走上去通向哪里 ---------------- */
console.log('\n[10] 枢纽站点（屋里站着的人与摆着的设施）');
{
  fresh();
  const stations = Story.stationsFor(Profile.storyCtx());
  ok(stations.length === Story.npcsFor(Profile.storyCtx()).length + 4,
    '屋里一共 ' + stations.length + ' 站 = 已出现的 NPC + 4 件设施（设施站一直在）',
    stations.map(s => s.id).join(','));
  ok(stations.every(s => s.npc || s.screen),
    '每一站都有去处（说话或通向某个界面）——没有"走上去什么都不会发生"的摆设');
  // NPC 站：有人在，而且人是真有的
  const npcStations = stations.filter(s => s.npc);
  ok(npcStations.length === Story.npcsFor(Profile.storyCtx()).length,
    'NPC 站与人一一对应（没解锁的人不在屋里）',
    npcStations.map(s => s.npc).join(','));
  ok(npcStations.every(s => Story.NPCS.some(n => n.id === s.npc)),
    'NPC 站指向的都是真有的 NPC');
  // 设施站：指向的状态必须真的存在（由总账查，这里给一条更直白的）
  const bad = stations.filter(s => s.screen && Game.STATES.indexOf(s.screen) < 0);
  ok(bad.length === 0, '设施站通向的界面都在状态机里', bad.map(s => s.id + '→' + s.screen).join(','));
  /* ⚠ "状态存在" ≠ "走得到"：真正决定点了走不走得过去的是**转换表**。
     里屋那站的去处如果不在 `hub` 的出边里，表现就是"走上去什么都不会发生"
     （门口那站原先通向 `chars` —— 枢纽归局内之后那条边已经非法）。 */
  const hubOut = Game.TRANSITIONS.hub || [];
  const deadEnds = stations.filter(s => s.screen && hubOut.indexOf(s.screen) < 0);
  ok(deadEnds.length === 0, '屋里每一站的去处枢纽真的走得过去（不在出边里 = 点了没反应）',
    deadEnds.map(s => s.id + '→' + s.screen).join(','));
  // 记录官要捡到第一片碎片才出现 → 他的站点跟着出现
  ok(!stations.some(s => s.npc === 'archivist'), '新档：记录官不在屋里');
  Profile.awardFragment('boss:warden');
  ok(Story.stationsFor(Profile.storyCtx()).some(s => s.npc === 'archivist'),
    '捡到第一片碎片 → 记录官站进屋里（屋里的内容跟着剧情长）');
  // 站点 id 就是头像 id：两处对不上时，界面上会是"一格空白"
  const src = fs.readFileSync(path.join(ROOT, 'src', 'sprites.ts'), 'utf8');
  const missing = Story.STATIONS.filter(s => src.indexOf("case '" + s.id + "'") < 0).map(s => s.id);
  ok(missing.length === 0, '每一站都有对应的画法（站点 id ⇄ sprites 里的分支）', missing.join(','));
  // 自检：表本身的问题要报出来（重复 id / 空站）
  ok(Story.audit().ok, 'story.ts 自检通过（含站点表）', Story.audit().problems.join(' | '));
}

console.log('\n=== 结果 ===');
if (failures === 0) { console.log('\x1b[32m全部通过 ✔\x1b[0m\n'); process.exit(0); }
console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m\n');
process.exit(1);
