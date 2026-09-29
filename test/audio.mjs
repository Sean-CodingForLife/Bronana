/* =========================================================
   audio.mjs — 背景音乐（music.ts）与运行时错误兜底（crash.ts）

   这一套守的是两块**以前完全没有的东西**：

     [1] 音乐：曲目表 / 场景映射 / 强度分层 / 唯一的音量出口
         —— 没有音频素材也可以有音乐，但**表的形状**必须是对的
     [2] 崩溃兜底：只报一次 / 不吞错误 / 提示语里有"我在干什么"

   为什么"表立得住"比"好不好听"重要：占位音乐将来会被真音乐替换，
   而**曲目表与场景映射一个字都不该改** —— 它们才是这一层真正的产物。

   用法： node test/audio.mjs
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { installDom } from './_ctx.mjs';
import { loadAll, UI_MODULES } from './_load.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
let failures = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  \x1b[32mPASS\x1b[0m ' + label);
  else { failures++; console.log('  \x1b[31mFAIL\x1b[0m ' + label + (extra !== undefined ? '  → ' + extra : '')); }
}

installDom();
await loadAll(UI_MODULES);
const { Music, Crash, Sfx, Scene, Game, Settings } = globalThis;

console.log('\n=== Bronana · 背景音乐与错误兜底 ===\n');

/* =========================================================
   [1] 音乐：曲目表与场景映射
   ========================================================= */
console.log('[1] 背景音乐：曲目表 / 场景映射 / 强度分层');
{
  const v = Music.audit();
  ok(v.ok, '曲目表自检通过（' + v.counts.tracks + ' 条曲目 · ' + v.counts.scenes + ' 个场景 · ' +
    v.counts.layers + ' 个声部）', v.problems.join(' | '));

  /* ---- 每一首的结构 ---- */
  for (const t of Music.TRACKS) {
    const layers = ['bass', 'arp', 'perc'];
    const sounding = layers.filter(n => t.layers[n].gain > 0);
    ok(sounding.length >= 2, t.id + ' 至少有 2 个声部在响（只有一个声部 = 一条旋律线，不是曲子）',
      sounding.join(','));
    ok(layers.every(n => t.layers[n].steps.length === 16),
      t.id + ' 的三个声部都是 16 格（一个十六分音符一格）');
    /* **休止符是数据**：`-1`。别的负数说明写的人以为它和 -1 不一样 */
    const bad = [];
    for (const n of layers) for (const s of t.layers[n].steps) if (s < -1) bad.push(n + ':' + s);
    ok(bad.length === 0, t.id + ' 里没有 "-2 这样的休止符"（休止只许写 -1）', bad.join(','));
  }

  /* ---- 场景映射：**每个场景都要有一条**（漏一个 = 那个界面静音，且不报错） ---- */
  const sceneKeys = Object.keys(Scene.TABLE);
  const mapped = Object.keys(Music.SCENE_TRACK);
  const missing = sceneKeys.filter(k => mapped.indexOf(k) < 0);
  ok(missing.length === 0, '场景表里的 ' + sceneKeys.length + ' 个场景全部声明了音乐（含"这里不放"）',
    missing.join(','));
  ok(mapped.every(k => !!Scene.TABLE[k]), '映射表里没有不存在的场景');
  ok(Music.forScene('playing') === 'combat' && Music.forScene('shop') === 'shop' &&
    Music.forScene('end') === 'result' && Music.forScene('title') === 'title',
    '关键场景映射到对的曲子（战斗 / 商店 / 结算 / 标题）');
  ok(Music.forScene('paused') === '', '暂停 = 静音（写空串，而不是"换成另一首"）');
  ok(Music.forScene('nope') === '' && Music.forScene('') === '', '未知场景/空串返回空（不放）');

  /* ---- 强度分层：同一首曲子更紧张，而不是换歌 ---- */
  /* 自变量是 `波次 + (层-1)×4`：开局那几波该是安静的，后期与关底最紧。
     阈值对着**实测落点**定（体检里中位是第 27 波 / 第 3 层），
     所以一局里三档都听得到 —— 门槛定太高会让 0 档几乎不出现，
     "分层"就退化成两档（第一版就是那么定的）。 */
  ok(Music.intensityFor(1, 1, false) === 0, '第一层开局是最低档（安静的）',
    String(Music.intensityFor(1, 1, false)));
  ok(Music.intensityFor(11, 1, false) === 2, '第一层打到第 11 波是最高档');
  ok(Music.intensityFor(6, 1, false) === 1, '中间那一段是 1 档（三档都听得到）',
    String(Music.intensityFor(6, 1, false)));
  ok(Music.intensityFor(1, 3, false) === 2,
    '第三层开局就已经是最高档（深层的敌人不该配安静的音乐）',
    String(Music.intensityFor(1, 3, false)));
  ok(Music.intensityFor(1, 1, true) === 2, 'Boss 那一间恒为最高档');
  let mono = true;
  for (let w = 1; w < 40; w++) if (Music.intensityFor(w, 1, false) > Music.intensityFor(w + 1, 1, false)) mono = false;
  ok(mono, '强度随波次单调不减（不会"打到后面反而安静了"）');

  /* ---- 频率换算：写成半音偏移，换调不用重算全曲 ---- */
  ok(Math.abs(Music.freq(440, 0) - 440) < 1e-9 &&
    Math.abs(Music.freq(440, 12) - 880) < 1e-9 &&
    Math.abs(Music.freq(440, -12) - 220) < 1e-9,
    '半音偏移换算正确（+12 = 高八度、-12 = 低八度）');
  ok(Music.SCALE.length === 5 && Music.SCALE.every(s => s >= 0 && s < 12),
    '音阶是小调五声（' + Music.SCALE.join('/') + '）—— 任意两音同响都不难听，所以琶音可以随机取');

  /* ---- 音量：**分组总线**，但只有一个总出口 ---- */
  const src = fs.readFileSync(path.join(ROOT, 'src', 'music.ts'), 'utf8');
  const sfxSrc = fs.readFileSync(path.join(ROOT, 'src', 'audio.ts'), 'utf8');
  ok(/Sfx\.musicBus/.test(src) && !/connect\(Sfx\.(master|ctx\.destination)\)/.test(src),
    '音乐走 `Sfx.musicBus`（不是自己直连 destination，也不是绕过分组直接接 master）');
  ok(/Sfx\.onMusicVolume/.test(src),
    '音乐订阅了「配比/闪避变了」——改滑杆时**正在放的那首**立刻跟上（不用等下一首）');
  ok(/master\.connect\(lim\)/.test(sfxSrc) && /lim\.connect\(Sfx\.ctx\.destination\)/.test(sfxSrc),
    '主输出链是 `master → limiter → destination`（限幅器是安全网，防叠加削波）');
  ok(/sfxBus\.connect\(Sfx\.master\)/.test(sfxSrc) && /musicBus\.connect\(Sfx\.master\)/.test(sfxSrc),
    '两条总线**并联**挂在 master 上（串联会让两边的音量相乘）');
  ok(/Registry\.family\('musicTrack'/.test(src), '曲目登记进了扩展点总账');
  ok(RegistryHas('musicTrack'), '总账里真的能按名字找到这个家族');

  /* ---- 换曲：**交叉淡入**，不是硬切 ---- */
  ok(/Music\.FADE/.test(src) && /linearRampToValueAtTime/.test(src),
    '换曲走淡入淡出（`linearRampToValueAtTime`）——硬切会"啪"一声');
  ok(/Music\.setGain\(0, 0\)/.test(src),
    '`stop()` 会把总线压到 0（否则停了之后还剩半秒在响）');
  /* 强度换挡**只在小节线上**生效 —— 这条的判据在 [1c]，那里真的驱动调度器
     按 16 格走了一遍（源码文本检查拦不住"换了个写法"的情况）。 */
  const result = Music.BY_ID['result'];
  ok(!!result && result.loop === false, '结算曲声明了 `loop: false`（放完就停）');
  ok(/if \(!tr\.loop &&/.test(src), '`loop` 真的被读了（声明了却不生效的字段比没有更糟）');
  /* 补空隙不是死分支：至少有一条曲子的琶音真的有空隙可补 */
  const gappy = Music.TRACKS.filter(t => t.layers.arp.steps.some(s => s < 0));
  ok(gappy.length > 0, gappy.length + ' 条曲子的琶音有空格，「补空隙」不是死代码',
    gappy.map(t => t.id).join(','));

  /* ---- 无音频环境下的降级：不抛、不崩 ---- */
  let err = null;
  try {
    Music.setEnabled(false);
    Music.update('playing', 1);
    Music.setEnabled(true);
    Music.update('title', 0);
    Music.stop();
    Music.play('nope');      // 未知曲目：只许返回 false
  } catch (e) { err = e.message; }
  ok(err === null, '无 AudioContext 时播放/停止/未知曲目都不抛', err);
  ok(Music.play('nope') === true || Music.play('nope') === false,
    '未知曲目返回布尔值而不是抛（`play` 的契约）');

  function RegistryHas(name) {
    const R2 = globalThis.Registry;
    return !!(R2 && R2.has && R2.has(name));
  }
}

/* =========================================================
   [1b] 混音：分组总线 / 闪避 / 换曲淡入
   ---------------------------------------------------------
   这三样都是"**听得出来但看不出来**"的东西：坏了不会报错，
   只会让玩家觉得"哪里不对"。所以判据只能落在可验证的形状上：
     · 总线拓扑（谁接谁）、闪避表的**取值域与例外**、换曲是不是硬切
   ========================================================= */
/* =========================================================
   [1b] 混音：分组总线 / 闪避 / 换曲淡入
   ---------------------------------------------------------
   这三样都是"**听得出来但看不出来**"的东西：坏了不会报错，
   只会让玩家觉得"哪里不对"。所以判据只能落在可验证的形状上：
     · 总线拓扑（谁接谁）、闪避表的**取值域与例外**、换曲是不是硬切
   ========================================================= */
console.log('\n[1b] 混音：分组总线 / 闪避 / 换曲淡入');
{
  /* ---- 闪避表：让路的是"低频且重要"的，不是高频的 ---- */
  const table = Sfx.DUCK_FOR;
  ok(table && typeof table === 'object', '闪避表存在（哪些音要让音乐让路是一张数据表）');
  const ids = Object.keys(table || {});
  const sfxIds = Sfx.LIST.map(d => d.id);
  const ghost = ids.filter(k => sfxIds.indexOf(k) < 0);
  ok(ghost.length === 0, '闪避表里没有不存在的音效（那一行永远不会触发）', ghost.join(','));
  ok(ids.indexOf('explode') >= 0 && ids.indexOf('levelUp') >= 0 && ids.indexOf('waveClear') >= 0,
    '爆炸 / 升级 / 清波都在表里（这三件最该被听见）', ids.join(','));
  const highFreq = ['shoot', 'hit', 'melee', 'click', 'pickup', 'kill'];
  const bad = highFreq.filter(k => table[k]);
  ok(bad.length === 0, '高频音效**不在**闪避表里（每秒十几次的一让路，音乐会被抽成呼吸）', bad.join(','));
  ok(ids.every(k => table[k] >= 100 && table[k] <= 2000),
    '所有闪避时长都在 100~2000ms（太短听不出、太长像被掐了）');
  ok(Sfx.DUCK_LEVEL > 0 && Sfx.DUCK_LEVEL < 1,
    '闪避系数在 (0,1)：' + Sfx.DUCK_LEVEL + '（0 = 音乐消失，1 = 没让路）');

  /* ---- 分组总线：默认 1，两处曲线必须同源 ---- */
  ok(Sfx.sfxVolume === 1 && Sfx.musicVolume === 1,
    '两条总线的默认比例都是 1（老存档没有这两个字段 → 升级前后同响度）',
    'sfx=' + Sfx.sfxVolume + ' music=' + Sfx.musicVolume);
  const set = Sfx.setBusVolume('music', 0.5);
  ok(set === 0.5 && Sfx.musicVolume === 0.5, '`setBusVolume` 会写进状态并返回新值');
  Sfx.setBusVolume('music', 1);
  ok(Sfx.setVolume(0.22) === 0.22 && Sfx.gainOf(0.5) < 0.3,
    '总音量与分组音量走的是**同一条感知曲线**（`gainOf` 只有一处实现）');

  /* ---- 无音频环境：闪避必须安全地失败，而不是抛 ---- */
  let derr = null;
  try { Sfx.duckFor(300); Sfx.refreshMusic(); Sfx.onMusicVolume(() => { }); } catch (e) { derr = e.message; }
  ok(derr === null, '没有 AudioContext 时闪避 / 刷新 / 订阅都不抛', derr);
}

/* =========================================================
   [1c] 排音行为：**真的**补空隙、**真的**等到小节线
   ---------------------------------------------------------
   上面 [1b] 查的是数据与源码形状，这一节**驱动调度器**看它排了什么音。
   为什么非得驱动一遍：上一版那两件事（"高强度把琶音加密"、"强度分层"）
   在源码里**看着是对的**，但一个是不可达分支、另一个连读点都没有 ——
   文本检查全过，功能一个都没生效。判据只有落在"排了哪些音"上才拦得住。

   做法：`Music.tone` / `Music.hit` 换成计数器（**不碰** `Sfx.ctx` ——
   无头环境没有 AudioContext，我们只验"要排哪些音"这个决定）。
   ========================================================= */
console.log('\n[1c] 排音行为：补空隙 / 小节线换挡（驱动真实调度器）');
{
  /* 假总线：`setGain` / `pulse` 需要一个带 `gain` 参数的对象 */
  const stages = [];
  const fakeGain = {
    value: 1,
    cancelScheduledValues: () => { }, setValueAtTime: () => { },
    linearRampToValueAtTime: () => { }, setTargetAtTime: () => { },
    exponentialRampToValueAtTime: () => { }
  };
  const fakeBus = { gain: fakeGain, connect: () => { } };
  const realTone = Music.tone, realHit = Music.hit, realPulse = Music.pulse;
  const realBus = Music.bus, realCur = Music.current, realStep = Music.step;
  const realInt = Music.intensity, realWanted = Music.wanted;
  const notes = [];
  Music.tone = (at, freq, dur, wave, peak, dest) => {
    notes.push({ freq, peak, dest }); return realTone.call(Music, 9999, freq, dur, wave, 0.001, null);
  };
  Music.hit = (at, kind, peak, dest) => {
    notes.push({ kind, peak, dest }); return realHit.call(Music, 9999, kind, 0.001, null);
  };
  Music.pulse = () => { stages.push('pulse'); return true; };
  Music.bus = fakeBus;
  /* 无头环境没有 `Sfx.ctx` —— `schedule` 会提前返回。这里给它一个只有 `currentTime`
     的最小桩：**只够排程判断用**，真正的发声路径仍然是没有的（所以没验"出声"）。 */
  const hadCtx = Sfx.ctx;
  Sfx.ctx = { currentTime: 0 };

  try {
    /* ---- ① 补空隙：低档只排谱上的音，1 档起把空格补上 ---- */
    Music.current = 'title';
    Music.intensity = 0; Music.wanted = 0;
    Music.step = 0;
    notes.length = 0;
    for (let i = 0; i < 16; i++) Music.schedule(Sfx.ctx);
    const low = notes.length;

    Music.current = 'title';
    Music.intensity = 1; Music.wanted = 1;
    Music.step = 0;
    notes.length = 0;
    for (let i = 0; i < 16; i++) Music.schedule(Sfx.ctx);
    const high = notes.length;

    ok(low > 0 && high > low,
      '低档排 ' + low + ' 个音，1 档排 ' + high + ' 个（**补空隙真的发生了**，不是死分支）');
    ok(notes.every(n => n.freq > 20 && n.freq < 8000),
      '补出来的音都在可听频率内（`freq` 换算没算错）',
      JSON.stringify(notes.filter(n => !(n.freq > 20 && n.freq < 8000)).slice(0, 3)));

    /* ---- ② 换挡等小节线：请求了**不会**立刻生效 ---- */
    Music.current = 'combat';
    Music.intensity = 0; Music.wanted = 2;
    Music.step = 0;
    stages.length = 0;
    Music.schedule(Sfx.ctx);                       // step 0 → 1
    ok(Music.intensity === 0,
      '第 1 格就请求换到最高档，**这一格不换**（换挡不切在乐句中间）',
      'intensity=' + Music.intensity);
    for (let i = 0; i < 15; i++) Music.schedule(Sfx.ctx);   // 走到 step 16
    ok(Music.intensity === 2,
      '走满 16 格（一小节）之后换挡生效',
      'intensity=' + Music.intensity + ' step=' + Music.step);
    ok(stages.indexOf('pulse') >= 0,
      '换挡时给了一次短促的"咬"（`pulse`）—— 换挡是刻意的，不是掉帧');

    /* ---- ③ 打击层真的分档：低档只在每 8 格响，2 档基本每格响 ---- */
    const percAt = (lv) => {
      Music.current = 'combat';
      Music.intensity = lv; Music.wanted = lv;
      Music.step = 0;
      notes.length = 0;
      for (let i = 0; i < 16; i++) Music.schedule(Sfx.ctx);
      return notes.filter(n => n.kind === 'kick' || n.kind === 'hat').length;
    };
    const p0 = percAt(0), p2 = percAt(2);
    ok(p0 > 0 && p2 > p0,
      '打击层分档：低档 ' + p0 + ' 下 · 2 档 ' + p2 + ' 下（越深越重）');
  } finally {
    Music.tone = realTone; Music.hit = realHit; Music.pulse = realPulse;
    Music.bus = realBus; Music.current = realCur; Music.step = realStep;
    Music.intensity = realInt; Music.wanted = realWanted;
    Sfx.ctx = hadCtx;
  }
}

/* =========================================================
   [2] 设置：音乐开关 + 分组音量
   ========================================================= */
console.log('\n[2] 设置：音乐开关与分组音量');
{
  ok(Settings.keys().indexOf('music') >= 0, '设置表里有「背景音乐」这一项', Settings.keys().join(','));
  ok(Settings.def('music').type === 'bool' && Settings.def('music').def === true,
    '「背景音乐」是默认打开的布尔项');
  ok(!!Settings.def('music').note, '它写清了"关掉会怎样"（程序化生成的占位曲）');
  /* ---- 分组音量真的是一项设置（不是只住在 `audio.ts` 里的字段） ---- */
  ok(Settings.keys().indexOf('sfxVolume') >= 0 && Settings.keys().indexOf('musicVolume') >= 0,
    '「音效音量 / 音乐音量」都在设置表里', Settings.keys().join(','));
  ok(Settings.def('sfxVolume').def === 1 && Settings.def('musicVolume').def === 1,
    '两项默认都是 1（乘在总音量上，所以升级不会让人"突然小声一半"）');
  ok(Settings.def('sfxVolume').type === 'number' && Settings.def('sfxVolume').min === 0 &&
    Settings.def('sfxVolume').max === 1,
    '它们是 0..1 的数值项（能被滑杆/按钮扫过全域）');
  const mainSrc2 = fs.readFileSync(path.join(ROOT, 'src', 'main.ts'), 'utf8');
  ok(/key === 'sfxVolume'\)\s*Sfx\.setBusVolume\('sfx'/.test(mainSrc2) &&
    /key === 'musicVolume'\)\s*Sfx\.setBusVolume\('music'/.test(mainSrc2),
    '`applySetting` 里两项都接到了 `setBusVolume`（值 → 行为的唯一去处）');
  ok(/id="set-sfxvol-up"/.test(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')) &&
    /'set-musvol-up'/.test(fs.readFileSync(path.join(ROOT, 'src', 'ui.ts'), 'utf8')),
    '设置页里两项都**有按钮**（声明了却没有控件 = 玩家调不到）');
  Music.setEnabled(false);
  ok(Music.enabled === false && Music.current === '', '关掉音乐时立刻停掉当前曲目');
  Music.setEnabled(true);
  ok(Music.enabled === true, '重新打开后 enabled 为真');
  const mainSrc = fs.readFileSync(path.join(ROOT, 'src', 'main.ts'), 'utf8');
  ok(/key === 'music'\)\s*Music\.setEnabled/.test(mainSrc), '设置的应用分支接到了 Music');
  ok(/key === 'sound'\)\s*\{\s*Sfx\.setEnabled\(!!value\);\s*Music\.setEnabled/.test(mainSrc),
    '「音效」总开关**同时**关掉音乐（两个开关不能各管一半）');
  ok(/Music\.update\(Game\.state/.test(mainSrc), '主循环每个显示帧调一次 Music.update（唯一的换曲入口）');
}

/* =========================================================
   [3] 错误兜底
   ========================================================= */
console.log('\n[3] 运行时错误兜底');
{
  ok(typeof Crash.report === 'function' && typeof Crash.hook === 'function',
    '兜底模块装上了（report / hook）');

  /* 提示语是纯函数：不碰 DOM 也能验 */
  const text = Crash.describe(new Error('测试用的假错误'), 'window.error');
  ok(/Bronana 出了点意外/.test(text), '提示语说清了"出了意外"');
  ok(/触发点：window\.error/.test(text), '提示语里有触发点');
  ok(/测试用的假错误/.test(text), '提示语里有原始的错信息');
  ok(/波次|还没有开局/.test(text), '提示语里有**会话摘要**（"我在干什么"比栈更常被需要）');
  ok(/刷新页面/.test(text), '提示语给了可行动的一步');

  /* **只报一次**：连环抛（每帧一次）不许刷屏 */
  Crash.reset();
  const hasDom = typeof document !== 'undefined' && !!document.body;
  const first = Crash.report(new Error('第一次'), 'test');
  const second = Crash.report(new Error('第二次'), 'test');
  ok(Crash.count === 2 && Crash.last.indexOf('第二次') >= 0, '两次都记了账（count / last 更新）');
  ok(hasDom ? (first === true && second === false) : (first === false && second === false),
    hasDom ? '第一张卡弹出来、第二张被"只报一次"拦住'
      : '无 DOM 时不弹卡（但账还是记了）', 'first=' + first + ' second=' + second);
  Crash.reset();
  ok(Crash.shown === false && Crash.count === 0, '复位之后可以再弹一次（调试用）');

  /* 只接一次：重复接会让同一个错误走两遍 */
  const fake = { addEventListener() { } };
  let added = 0;
  const fake2 = { addEventListener() { added++; } };
  Crash.hooked = false;
  const h1 = Crash.hook(fake2);
  const h2 = Crash.hook(fake2);
  ok(h1 === true && h2 === false && added === 2, '`hook` 只接一次（两个事件源各一次）',
    'h1=' + h1 + ' h2=' + h2 + ' 注册数=' + added);
  Crash.hooked = false;
  ok(Crash.hook(null) === false, '没有窗口时返回 false（无头 / CLI 环境）');

  /* 空值不许炸 */
  let err = null;
  try { Crash.describe(null, 'x'); Crash.describe(undefined, ''); Crash.report(null, 'x'); } catch (e) { err = e.message; }
  ok(err === null, '空错误 / 空触发点都不抛', err);

  const mainSrc = fs.readFileSync(path.join(ROOT, 'src', 'main.ts'), 'utf8');
  ok(/Crash\.hook\(\)/.test(mainSrc), '入口在 boot 一开始就接上兜底');
}

console.log('\n=== 结果 ===');
if (failures === 0) console.log('\x1b[32m全部通过 ✔\x1b[0m');
else console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m');
process.exit(failures ? 1 : 0);
