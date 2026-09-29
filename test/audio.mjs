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

  /* ---- 音量只有**一个出口** ---- */
  const src = fs.readFileSync(path.join(ROOT, 'src', 'music.ts'), 'utf8');
  ok(!/createGain\(\)\s*;?\s*\/\/\s*master/.test(src) && /Sfx\.master/.test(src),
    '音乐走 `Sfx.master` 这一个音量出口（自己再开一个 gain 会出现"静音了音乐还在响"）');
  ok(/Registry\.family\('musicTrack'/.test(src), '曲目登记进了扩展点总账');
  ok(RegistryHas('musicTrack'), '总账里真的能按名字找到这个家族');

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
   [2] 设置：音乐开关真的接上了
   ========================================================= */
console.log('\n[2] 设置：音乐开关');
{
  ok(Settings.keys().indexOf('music') >= 0, '设置表里有「背景音乐」这一项', Settings.keys().join(','));
  ok(Settings.def('music').type === 'bool' && Settings.def('music').def === true,
    '「背景音乐」是默认打开的布尔项');
  ok(!!Settings.def('music').note, '它写清了"关掉会怎样"（程序化生成的占位曲）');
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
