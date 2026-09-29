/* =========================================================
audio.ts — 程序化音效（无音频资源文件）
极简方波/噪声，风格克制；无 AudioContext 时静默降级
========================================================= */
import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';

var Sfx = ({
  ctx: null,
  master: null,
  /* 两条分组总线（init 里建）。**默认 1 = 与改造前完全同响度** ——*/
  sfxBus: null,
  musicBus: null,
  /* 相对比例：总音量由 `volume` 管，这两项只管两条总线之间怎么配比 */
  sfxVolume: 1,
  musicVolume: 1,
  /** 闪避系数（duckFor 用；1 = 不让路） */
  duck: 1,
  enabled: true,
  volume: 0.22
} as SfxApi);

Sfx.init = function () {
  if (Sfx.ctx) return;
  var AC = (typeof window !== 'undefined') && (window.AudioContext || (window as any).webkitAudioContext);
  if (!AC) { Sfx.enabled = false; return; }
  try {
    Sfx.ctx = new AC();
    Sfx.master = Sfx.ctx.createGain();
    Sfx.master.gain.value = Sfx.enabled ? gainOf(Sfx.volume) : 0;
    /* 主输出链：`master → limiter → destination`。
       改造前是 `gain → destination`，**中间一个节点都没有** —— 后果不是音质差
       而是**硬削波**：`explode` 一次就叠了 noise(0.5) + tone(0.34)，
       `waveClear` 是四个音以 95ms 间隔排出去，彼此重叠求和；求和超过 1.0 时
       浏览器**直接削平波形**。默认音量小所以听不出来，拉满就会撞上。
       压缩器当**安全网**（不是混音手段）：正常电平下它什么都不做。 */
    var lim = Sfx.ctx.createDynamicsCompressor();
    lim.threshold.value = -6;
    lim.ratio.value = 12;
    lim.knee.value = 6;
    lim.attack.value = 0.003;
    lim.release.value = 0.1;
    Sfx.master.connect(lim);
    lim.connect(Sfx.ctx.destination);

    /* =========================================================
       两条分组总线：`master ← { sfxBus, musicBus }`
       ---------------------------------------------------------
       改造前**只有一条 master**，音乐与音效共用它。那是"单一音量出口"这个
       正确决定的副产品：它保证了"调了音量音乐也变、静音了音乐也停"，
       但代价是**没有分组能力** —— 玩家想"音效大一点、音乐小一点"做不到。

       现在分成两条，但**单一出口这件事没有丢**：
         · `master` 仍然是唯一的**总音量**（玩家的 `volume` 落在它上面）
         · 两条总线各有自己的**相对比例**（默认 1 = 与改造前完全同响度）
         · 音乐仍然**没有**自己直连 `destination` 的路径 —— 这正是
           `test/audio.mjs` 那条断言要防的事，断言本身改成查这一点

       为什么要 fan-out 而不是串起来（`master → sfxBus → musicBus`）：
       串联会让两条总线的音量**相乘**，"音效 0.5、音乐 0.5"会变成音乐 0.25。
       并联（master 同时接到两条）语义才对：各自独立、最后在 master 汇总。 */
    Sfx.sfxBus = Sfx.ctx.createGain();
    Sfx.sfxBus.gain.value = gainOf(Sfx.sfxVolume);
    Sfx.sfxBus.connect(Sfx.master);

    Sfx.musicBus = Sfx.ctx.createGain();
    Sfx.musicBus.gain.value = gainOf(Sfx.musicVolume);
    Sfx.musicBus.connect(Sfx.master);
  } catch (e) { Sfx.enabled = false; }
};

/* =========================================================
   音量：滑杆值 → 感知响度（**不是线性增益**）
   ---------------------------------------------------------
   `settings.ts` 的 `volume` 是 0..1 的**滑杆位置**。把它直接写进
   `gain.value` 是错的，因为响度是**对数**感知的：
     · 线性增益 0.5 ≈ 只降 6dB，听起来还"挺响"
     · 于是滑杆从 1.0 拉到 0.5 几乎没变化，而 0.15 以下**整段都像静音**
   —— 玩家的体验是"这个滑杆不灵"，而不是"音量小"。

   用一条幂曲线把滑杆映到增益：`gain = volume^2.2`。
   这是行业里最常见的做法（也是 Godot/Unity 教程里 `linear_to_db` 的等价直觉：
   指针走一半，感知上大约响度减半）。

   ⚠ 为什么不用真正的 dB（`20*log10`）：0 是奇点（−∞ dB），
   要额外处理下限与静音跳变；而滑杆只有 51 档（step 0.02），
   幂曲线在这个分辨率下与 dB 曲线的差别**听不出来**，代码却短一半。

   这一条**只改听感、不改模拟** —— 行为指纹不含音频状态。 */
var VOLUME_CURVE = 2.2;
function gainOf(v) {
  var x = Math.max(0, Math.min(1, Number(v) || 0));
  return Math.pow(x, VOLUME_CURVE);
}
Sfx.gainOf = gainOf;

Sfx.resume = function () {
  if (!Sfx.ctx) Sfx.init();
  if (!Sfx.ctx) return false;
  if (Sfx.ctx.state === 'suspended') {
    /* `resume()` 返回 Promise 且**可能被拒**（浏览器认定"这不是有效手势"）。
       原先这里不看返回值，外面又是 `{once: true}` —— 于是一次失败就**永久无声**，
       而且没有任何地方知道这件事。现在返回成功与否，并记录 `blocked`，
       让界面能提示"点一下/按一下以开启声音"。 */
    try {
      var p = Sfx.ctx.resume();
      if (p && typeof p.then === 'function') {
        p.then(function () { Sfx.blocked = false; }, function () { Sfx.blocked = true; });
      }
    } catch (e) { Sfx.blocked = true; }
  }
  var running = Sfx.ctx.state === 'running';
  /* 有 ctx 但既不是 running 也不是 suspended（如 'closed'）= 不可用 */
  if (!running && Sfx.ctx.state !== 'suspended') Sfx.blocked = true;
  return running;
};
/** 音频是否被浏览器的自动播放策略拦住（界面据此提示"点一下"） */
Sfx.blocked = false;

Sfx.setEnabled = function (v) {
  Sfx.enabled = !!v;
  if (Sfx.master) Sfx.master.gain.value = Sfx.enabled ? gainOf(Sfx.volume) : 0;
};

/** 改音量（**唯一出口**：`main.ts` 的 applySetting 与初始化都走它）。
 *  为什么要有这个函数而不是让调用方自己写 `master.gain.value`：
 *  "滑杆 → 感知曲线"这件事必须只有一处实现，否则初始化与改设置会走两条不同的曲线
 *  （第一版就是这样：初始化时直接赋 `Sfx.volume`，拖动滑杆时才乘曲线）。 */
Sfx.setVolume = function (v) {
  Sfx.volume = Math.max(0, Math.min(1, Number(v) || 0));
  if (Sfx.master) Sfx.master.gain.value = Sfx.enabled ? gainOf(Sfx.volume) : 0;
  return Sfx.volume;
};

/* =========================================================
   分组音量：音乐与音效各自一条总线
   ---------------------------------------------------------
   总音量（`volume`）仍然落在 `master` 上，所以"调总音量两条一起变"
   这件事没有变。这两项只管**两条总线之间的配比**。
   默认 1 = 改造前完全同响度 —— 老存档没有这两个字段时取默认值，
   所以升级不会让任何人的响度变掉。
   ========================================================= */
/* 音乐侧的两个值（总线比例 / 闪避系数）改了就通知一声。
   **为什么是回调而不是直接调 `Music.refresh()`**：`audio.ts` 与 `music.ts`
   都在第 6 层（声音是同一层的两半），互相 import 会立刻构成循环依赖 ——
   而分层表会把这条边算成违规。回调把"谁听"变成注册制：
   `music.ts` 自己订阅，`audio.ts` 一个模块名都不用知道。 */
var musicListeners: Array<() => void> = [];
Sfx.onMusicVolume = function (fn) {
  if (typeof fn === 'function' && musicListeners.indexOf(fn) < 0) musicListeners.push(fn);
  return musicListeners.length;
};

/** 把音乐总线的增益推一遍（比例 × 闪避），并通知订阅者 */
function refreshMusicBus() {
  if (Sfx.musicBus) Sfx.musicBus.gain.value = gainOf(Sfx.musicVolume) * (Sfx.duck || 1);
  for (var i = 0; i < musicListeners.length; i++) {
    /* 订阅者（`music.ts`）要在**它自己那条曲目总线**上把同样的值再走一遍曲线，
       所以它自己读 `Sfx.musicVolume` / `Sfx.duck`，这里不传参。 */
    try { musicListeners[i](); } catch (e) { /* 订阅者出错不该影响发声 */ }
  }
}
Sfx.refreshMusic = refreshMusicBus;

Sfx.setBusVolume = function (which, v) {
  var x = Math.max(0, Math.min(1, Number(v) || 0));
  if (which === 'music') {
    Sfx.musicVolume = x;
    refreshMusicBus();
  } else {
    Sfx.sfxVolume = x;
    if (Sfx.sfxBus) Sfx.sfxBus.gain.value = gainOf(x);
  }
  return x;
};

/* =========================================================
   闪避（ducking）：重要音效响起时**把音乐压低**再放回来
   ---------------------------------------------------------
   行业判据（audio-design 清单）：结算/升级/爆炸这类"该被听见"的音，
   不该和背景音乐平分注意力。做法不是把音效调响（那会让耳朵累），
   而是**让音乐暂时让路**。

   为什么现在才做：它需要一条**独立的音乐总线**（上面的 `musicBus`）——
   在"只有一条 master"的结构下无从下手，因为压低音乐必然也压低音效。

   实现刻意从简：`duck` 是一个 0..1 的系数，乘在音乐总线上；
   `duckFor()` 把它压到 `DUCK_LEVEL` 并在 `ms` 后按 `setTimeout` 放回。
   没有用侧链压缩器：那需要把 sfxBus 接到压缩器的 sidechain 上，
   而 Web Audio 的 `DynamicsCompressor` **没有** sidechain 输入
   （要做真侧链得自己搭 `AudioWorklet`）。对"结算音"这种**离散事件**
   来说，定时包络完全够用，且行为可预测、可测。
   ========================================================= */
var DUCK_LEVEL = 0.35;        // 压到 35%（约 -9dB）—— 听得出让路，但不至于"音乐停了"
Sfx.DUCK_LEVEL = DUCK_LEVEL;
var duckTimer = null;
/** 让音乐让路 `ms` 毫秒（重复调用会重置计时，不会叠加压低） */
Sfx.duckFor = function (ms) { return beginDuck(ms); };

function env(node, t0, a, d, peak) {
  var g = node.gain;
  g.cancelScheduledValues(t0);
  g.setValueAtTime(0.0001, t0);
  g.exponentialRampToValueAtTime(peak, t0 + a);
  g.exponentialRampToValueAtTime(0.0001, t0 + a + d);
}

/** 一个音符。`when` = 起音相对现在的小延迟（毫秒级抖动用；省略=立刻） */
function tone(freq, dur, type, peak, slideTo?, when?) {
  if (!Sfx.enabled) return;
  Sfx.init();
  if (!Sfx.ctx) return;
  var t0 = Sfx.ctx.currentTime + (when || 0);
  var osc = Sfx.ctx.createOscillator();
  var g = Sfx.ctx.createGain();
  osc.type = type || 'square';
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
  env(g, t0, 0.006, dur, peak === undefined ? 0.5 : peak);
  osc.connect(g); g.connect(Sfx.sfxBus);
  osc.start(t0); osc.stop(t0 + dur + 0.04);
}

function noise(dur, peak, filterHz, q?, when?) {
  if (!Sfx.enabled) return;
  Sfx.init();
  if (!Sfx.ctx) return;
  var ctx = Sfx.ctx, t0 = ctx.currentTime + (when || 0);
  var n = Math.floor(ctx.sampleRate * dur);
  var buf = ctx.createBuffer(1, Math.max(1, n), ctx.sampleRate);
  var d = buf.getChannelData(0);
  /* 白噪本身就要随机 —— 这是本文件里 `Math.random()` 最早的一处用法，
     与上面 `vary()` 是同一个理由：音频是表现层，不影响模拟的可复现性。 */
  for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  var src = ctx.createBufferSource(); src.buffer = buf;
  var f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = filterHz || 1400; f.Q.value = q || 1;
  var g = ctx.createGain();
  env(g, t0, 0.004, dur, peak === undefined ? 0.4 : peak);
  src.connect(f); f.connect(g); g.connect(Sfx.sfxBus);
  src.start(t0);
}

/* ---------------- 具体音效 ---------------- */
var lastSfx = Object.create(null);
function throttle(name, ms) {
  var now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  if (lastSfx[name] && now - lastSfx[name] < ms) return false;
  lastSfx[name] = now;
  return true;
}

/* =========================================================
   音效变化：同一件事重复发生时不听成一模一样
   ---------------------------------------------------------
   行业判据（audio-design 清单）：连打同一个音效是"机器枪"——
   玩家在 3 秒内听 40 次完全相同的波形，耳朵会把它识别成**噪音**而不是事件。
   做法是给每次播放加极小的随机偏移：
     · 音高 ±6%（pitch）：人耳对音高差异的容忍度比音量高，±6% 听不出"跑调"
     · 音量 ±8%（peak）：避免密集触发时叠成一条直线
     · 起音时刻 ±3ms：让同帧里的多次触发不完全对齐（相位不叠加=不削波）

   ⚠ **为什么可以用 `Math.random()`**：音频是表现层，
   与模拟层的 `S.rnd`（那个必须是种子化的、可回放的）**完全无关**。
   它不进任何存档、不进行为指纹。这与 `noise()` 里早就在用
   `Math.random()` 造白噪是同一个道理。
   ⚠ **幅度刻意很小**：这不是"每个音效都做成变体"，
   只是让重复不至于僵死。听得出"每次不一样"就过头了。
   ========================================================= */
var JITTER = { pitch: 0.06, peak: 0.08, when: 0.003 };
/** 给一次播放算三个抖动系数（无参调用 = 每次播放都不同） */
function vary() {
  return {
    pitch: 1 + (Math.random() * 2 - 1) * JITTER.pitch,
    peak: 1 + (Math.random() * 2 - 1) * JITTER.peak,
    when: Math.random() * JITTER.when
  };
}
Sfx.JITTER = JITTER;

/* =========================================================
   哪几个音效要**让音乐让路**（闪避）—— 这是数据，不是散在各处的调用
   ---------------------------------------------------------
   为什么是一张表而不是在 `game.ts` 里逐个手写 `Sfx.duckFor(...)`：
     1. `game.ts` 是模拟层（第 4 层），让它去管"混音策略"是把表现层的决定
        塞进模拟层 —— 而且每加一个"该被听见"的音效就要回去改 `game.ts`；
     2. 表在这里可以被自检直接验（id 必须真实存在、时长必须合理），
        散在调用点就只能靠人眼。
   只有**低频且重要**的音效进这张表：爆炸、升级、清波、买入、受伤。
   命中和开火**不进** —— 它们每秒响十几次，闪避会变成持续的抖动（"抽气"），
   那正是 audio-design 清单里警告的 pumping。
   ========================================================= */
var DUCK_FOR = {
  explode: 420,
  levelUp: 520,
  waveClear: 600,
  waveStart: 320,
  hurt: 260,
  buy: 200
};
Sfx.DUCK_FOR = DUCK_FOR;

/** 一次闪避的启动（`duckFor` 的同步部分）—— 建 `musicBus` 之前不生效 */
function beginDuck(ms) {
  if (!Sfx.musicBus) return false;
  Sfx.duck = DUCK_LEVEL;
  refreshMusicBus();
  if (duckTimer) clearTimeout(duckTimer);
  duckTimer = setTimeout(function () {
    duckTimer = null;
    Sfx.duck = 1;
    refreshMusicBus();
  }, Math.max(0, Number(ms) || 0));
  return true;
}
/** 一个音效播完之后，按表决定要不要压低音乐 */
function duckIfLoud(id) {
  var ms = DUCK_FOR[id];
  if (ms) beginDuck(ms);
}

Sfx.shoot = function (kind) {
  if (!throttle('shoot', 45)) return;
  var j = vary();
  if (kind === 'laser') tone(880 * j.pitch, 0.07, 'sawtooth', 0.26 * j.peak, 200 * j.pitch, j.when);
  else if (kind === 'shotgun') { noise(0.12, 0.42 * j.peak, 1100, undefined, j.when); tone(180 * j.pitch, 0.09, 'square', 0.22 * j.peak, 70 * j.pitch, j.when); }
  else if (kind === 'sniper') tone(300 * j.pitch, 0.16, 'square', 0.34 * j.peak, 90 * j.pitch, j.when);
  else tone(520 * j.pitch, 0.055, 'square', 0.2 * j.peak, 300 * j.pitch, j.when);
};
Sfx.melee = function () { if (throttle('melee', 60)) { var j = vary(); noise(0.07, 0.26 * j.peak, 2600 * j.pitch, 2, j.when); } };
Sfx.kill = function () {
  if (!throttle('kill', 55)) return;
  var j = vary();
  noise(0.1, 0.34 * j.peak, 900 * j.pitch, undefined, j.when);
  tone(150 * j.pitch, 0.09, 'triangle', 0.22 * j.peak, 60 * j.pitch, j.when);
};
Sfx.hurt = function () { duckIfLoud('hurt'); var j = vary(); tone(220 * j.pitch, 0.16, 'square', 0.4 * j.peak, 90 * j.pitch, j.when); };
/* **命中音**：改造前"开火有声、命中无声" —— 而玩家真正想听见的是"打着了"。
   音色刻意做得比 `kill` 短、比 `deny` 高：它是**最高频的反馈**（每秒可能十几次），
   必须轻、必须短，否则会盖住别的音。
   与 `kill` 的分工：`hit` = "打到了但没死"，`kill` = "打死了"（更低、更闷）。 */
Sfx.hit = function () { if (throttle('hit', 40)) { var j = vary(); tone(760 * j.pitch, 0.045, 'square', 0.15 * j.peak, 520 * j.pitch, j.when); } };
Sfx.levelUp = function () { duckIfLoud('levelUp'); tone(520, 0.1, 'square', 0.3); setTimeout(function () { tone(700, 0.1, 'square', 0.3); }, 90); setTimeout(function () { tone(950, 0.16, 'square', 0.3); }, 180); };
Sfx.buy = function () { duckIfLoud('buy'); var j = vary(); tone(700 * j.pitch, 0.07, 'square', 0.28 * j.peak, 900 * j.pitch, j.when); };
Sfx.deny = function () { tone(160, 0.12, 'square', 0.3, 110); };
Sfx.explode = function () { duckIfLoud('explode'); var j = vary(); noise(0.32, 0.5 * j.peak, 700 * j.pitch, 0.6, j.when); tone(90 * j.pitch, 0.3, 'triangle', 0.34 * j.peak, 40 * j.pitch, j.when); };
Sfx.waveStart = function () { duckIfLoud('waveStart'); tone(320, 0.14, 'square', 0.3); setTimeout(function () { tone(480, 0.2, 'square', 0.3); }, 140); };
Sfx.waveClear = function () { duckIfLoud('waveClear'); [440, 590, 740, 990].forEach(function (f, i) { setTimeout(function () { tone(f, 0.13, 'square', 0.26); }, i * 95); }); };
Sfx.click = function () { var j = vary(); tone(420 * j.pitch, 0.04, 'square', 0.2 * j.peak, 560 * j.pitch, j.when); };
Sfx.pickup = function () { if (throttle('pickup', 60)) { var j = vary(); tone(1400 * j.pitch, 0.04, 'square', 0.12 * j.peak, 1800 * j.pitch, j.when); } };

/* =========================================================
   声明表 + 定义期自检（**这个模块原先三样都没有**）
   ---------------------------------------------------------
   在此之前 `audio.ts` 是唯一"没有 audit、没有 SelfCheck.register、
   没有 Registry.family"的模块 —— 而 `music.ts` 三样齐全。
   代价很具体：**一个音效悄悄没了不会有人发现**。
   它的调用点分散在 `main.ts`（经 `sfx` 意图桥接）与 `ui.ts`，
   少一个只会表现成"那件事没声音"，而没声音是**最难注意到**的一类退化
   （玩家会以为是自己没开音量）。

   判据只验能当场验证的事：**声明表里的每个 id 都真的挂了一个函数**。
   "每个音效都有调用点"是检查期的活（要扫源码），本模块不方便做 ——
   那一条由 `Sfx.audit` 之外的静态检查负责（见下面的分工说明）。
   ========================================================= */
Sfx.LIST = [
  { id: 'shoot', label: '开火', note: '按武器类型分四种音色（laser/shotgun/sniper/默认）' },
  { id: 'melee', label: '近战挥击', note: '短噪声，60ms 节流' },
  { id: 'kill', label: '击杀', note: '噪声 + 低频下滑，55ms 节流' },
  { id: 'hurt', label: '受伤', note: '方波下滑，最响的一个（0.4）' },
  { id: 'hit', label: '命中', note: '打到但没死。**最高频的反馈**（每秒十几次），所以刻意最短最轻' },
  { id: 'levelUp', label: '升级', note: '三音上行；用 setTimeout 串（不走音频时钟）' },
  { id: 'buy', label: '购买', note: '短上扬' },
  { id: 'deny', label: '被拒绝', note: '低沉下滑 —— 与 buy 形成对比，玩家不用看文字就知道成没成' },
  { id: 'explode', label: '爆炸', note: '长噪声 + 极低频，唯一 0.3s 级别的' },
  { id: 'waveStart', label: '波次开始', note: '两音上行' },
  { id: 'waveClear', label: '波次清完', note: '四音琶音上行 —— 奖励感的来源' },
  { id: 'click', label: '界面点击', note: '极短，最高频（1400Hz 级），只听得到"哒"' },
  { id: 'pickup', label: '拾取', note: '短促上扬，60ms 节流' }
];

Sfx.audit = function () {
  var problems: string[] = [];
  var seen: Record<string, boolean> = Object.create(null);
  /* 把 `Sfx` 当**字符串索引的对象**来看：自检要按 id 查函数，
     而 id 是运行期字符串。用 `Record<string, unknown>` 而不是 `any` ——
     这个文件的 `any` 预算只有 1 处（留给 webkit 前缀 API），
     而"类型漏洞不许长回来"是被测试钉住的（`test/persist.mjs` 的 2c 节）。 */
  var bag = Sfx as unknown as Record<string, unknown>;
  for (var i = 0; i < Sfx.LIST.length; i++) {
    var d = Sfx.LIST[i];
    if (!d.id) { problems.push('第 ' + i + ' 条音效没有 id'); continue; }
    if (seen[d.id]) problems.push('音效 id 重复：' + d.id);
    seen[d.id] = true;
    if (!d.label || !d.note) problems.push(d.id + ' 缺名字或说明');
    /* 这一条是**真判据**：声明了却没挂函数 = 那个音效静默消失 */
    if (typeof bag[d.id] !== 'function') {
      problems.push('音效 ' + d.id + ' 在声明表里，但 Sfx.' + d.id + ' 不是函数（它不会响）');
    }
  }
  /* 反向：挂了函数但没进声明表 = 清单会漂（下次有人照着清单改，会漏掉它）。
     豁免的是**混音控制**（不是"会响的音":音量旋钮、总线配比、闪避、
     订阅）——它们不发声，进 `LIST` 会让"音效清单"变成"成员清单"。 */
  var SKIP: Record<string, boolean> = {
    init: true, resume: true, setEnabled: true, setVolume: true, gainOf: true,
    audit: true, LIST: true, JITTER: true, blocked: true,
    setBusVolume: true, duckFor: true, refreshMusic: true, onMusicVolume: true
  };
  for (var k in bag) {
    if (SKIP[k]) continue;
    if (typeof bag[k] === 'function' && !seen[k]) {
      problems.push('Sfx.' + k + ' 是一个音效函数，但没登记进 Sfx.LIST（清单会漂）');
    }
  }
  /* 音量曲线必须真的把低端压下去（与线性赋值区分开） */
  if (!(Sfx.gainOf(0.5) < 0.3)) {
    problems.push('音量曲线看起来是线性的（gainOf(0.5) = ' + Sfx.gainOf(0.5) + '）—— 滑杆在低端会"不灵"');
  }
  if (Sfx.gainOf(0) !== 0 || Sfx.gainOf(1) !== 1) problems.push('音量曲线的两端必须正好是 0 与 1');

  /* ---- 闪避表：id 必须真实存在，时长必须合理 ---- */
  if (!(DUCK_LEVEL > 0 && DUCK_LEVEL < 1)) {
    problems.push('闪避系数必须落在 (0,1)：' + DUCK_LEVEL + '（0 = 音乐直接消失，1 = 没让路）');
  }
  for (var dk in DUCK_FOR) {
    var ms = DUCK_FOR[dk];
    if (typeof bag[dk] !== 'function') {
      problems.push('闪避表里的 ' + dk + ' 不是一个真实音效（那一行永远不会触发）');
    }
    if (!(ms >= 100 && ms <= 2000)) {
      problems.push(dk + ' 的闪避时长不合理：' + ms + 'ms（太短听不出让路，太长像音乐被掐了）');
    }
  }
  /* **高频音效不许进闪避表**：每秒响十几次的音一让路，音乐就会被反复抽气
     （audio-design 清单里的 pumping）。这条是判据，不是注释。 */
  var highFreq = ['shoot', 'hit', 'melee', 'click', 'pickup', 'kill'];
  for (var hf = 0; hf < highFreq.length; hf++) {
    if (DUCK_FOR[highFreq[hf]]) {
      problems.push(highFreq[hf] + ' 是高频音效，不该进闪避表 —— 会把音乐抽成"呼吸"（pumping）');
    }
  }

  for (var j in JITTER) {
    if (!(JITTER[j] > 0 && JITTER[j] < 0.2)) {
      problems.push('抖动幅度 ' + j + '=' + JITTER[j] + ' 不在 (0, 0.2) 内（听得出"跑调"或等于没变化）');
    }
  }
  return {
    ok: problems.length === 0, problems: problems,
    counts: { sfx: Sfx.LIST.length, jitter: Object.keys(JITTER).length }
  };
};

var sfxVerdict = Sfx.audit();
if (!sfxVerdict.ok) throw new Error('audio.ts 音效表自检失败：\n' + sfxVerdict.problems.join('\n'));
SelfCheck.register('Sfx', Sfx.audit);

Registry.family('soundEffect', {
  note: '音效（**全部程序化合成**，无音频文件；声明了却没挂函数 = 那个音效静默消失）',
  owner: 'audio.ts',
  values: function () { return Sfx.LIST.map(function (d) { return d.id; }); }
});

export { Sfx };
