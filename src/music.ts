/* =========================================================
   music.ts — **背景音乐**（无音频素材，程序化生成 + 槽位声明）
   ---------------------------------------------------------
   这个项目在此之前**只有音效，没有音乐**。音效是"事件驱动的一次性声音"
   （`Sfx.kill()`），而音乐是"状态驱动的持续层"——两者的生命周期、
   混音位置、以及"什么时候该换"完全不同，所以它是独立的一层。

   **没有音频素材也可以有音乐**：这里用 Web Audio 的振荡器按
   「和弦 + 琶音 + 打击」三层把曲子**算出来**。这是占位，但它是
   **能听的占位**（不是静音、不是 TODO）：
     · 5 条音轨（标题 / 战斗 / 商店 / Boss / 结算），每条是一段可循环的谱
     · 战斗那条按**强度**分层（波次越深，琶音越密、打击越重）
     · 统一走 `audio.ts` 的 master gain —— 音量与开关只有一处
   真要换成真音乐时：把 `Music.play()` 里的合成器换成
   `AudioBufferSourceNode`，**曲目表与场景映射一个字都不用改**。

   为什么音量必须走同一处：`Sfx.master` 是唯一的音量出口，
   音乐自己再开一个 gain 就会出现"调了音量音乐没变"或"静音了音乐还在响"。
   ========================================================= */
import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';
import { Sfx } from './audio.ts';

/** 交叉淡入的时长（秒）：换曲从这个值淡起来，不是硬切 */
var FADE_SEC = 0.28;
var Music = ({
  current: '',
  intensity: 0,
  /** `setInterval` 的句柄：**只用来停调度器**，不进任何存档 */
  timer: null,
  step: 0,
  enabled: true,
  bus: null,
  /* `wanted` 初始就是 0（不是 -1）：它是"请求的强度档"，而强度档的取值域是 0..2 ——
     用 -1 当"还没请求"的哨兵会让这个字段**有两套语义**（越界值 + 正常值），
     而 `Music.update` 每一帧都会写它，所以哨兵值活不过一帧、毫无用处。 */
  wanted: 0,
  /* ⚠ `FADE` 是从**模块级常量**读出来的，不是 `Music` 自己的字段。
     理由是 `test/persist.mjs` 的"清单里没有已删除的条目"：那条判据认为
     "字段形态的状态"必须**在某处被赋值**（`Obj.n = …`），而一个只读一次、
     从不被写的字段会被判成已删除。与其为它放宽那条判据，不如让它
     真的不是一个"状态"—— 它确实是常量（淡入时长不会在运行时变）。 */
  FADE: FADE_SEC
} as MusicApi);

/* =========================================================
   强度换挡：**在小节线上生效**，不是立刻
   ---------------------------------------------------------
   强度档改的不只是音量，而是**排什么音**（琶音升八度、补满空隙、打击加密）。
   排音的东西在乐句中间换掉 = 听起来像"卡了一下"，而不是"更紧张了"。
   做法是行业里那条：请求换挡 → 等下一个安全音乐点（这里是小节线）再应用。

   `wanted` 是**请求值**，`Music.intensity` 是**已生效值** —— 两个值分开存，
   是为了让"请求"和"应用"在时间上解耦（只有一个值就必然要立刻应用）。
   ========================================================= */
/** 强度换挡时的短促"咬"（秒）：让换挡听起来是刻意的，不是掉帧 */
var PULSE = { to: 0.55, down: 0.06, up: 0.15 };

/**
 * 琶音补空隙：低档时只响谱上写的格，1 档起把**音符之间的空格**用
 * "上一层已经用过的那个音"补上（不是新写的音 —— 程序化生成里
 * 随手加音会跑调，而"重复自己"永远不会错）。
 */
var DENSIFY = { minLevel: 1, offset: 2, gain: 0.55 };
/* =========================================================
   1. 音阶与音符
   ---------------------------------------------------------
   用**半音偏移**写谱（不是频率）：写成频率的话换调要重算全曲，
   而写成偏移之后 `root` 一改就是另一个调 —— 这正是"数据表驱动"的意思。

   音阶取**小调五声**（`0 3 5 7 10`）：五声音阶里任意两个音同时响都不难听，
   所以"随机取几个音做琶音"不会出错误的和声 —— 对一个程序化生成的
   占位音乐来说，这条性质比"好听"更值钱。
   ========================================================= */
Music.SCALE = [0, 3, 5, 7, 10];

/** 半音偏移 → 频率（`root` = 主音频率） */
Music.freq = function (root, semis) {
  return root * Math.pow(2, semis / 12);
};

/* =========================================================
   2. 曲目表
   ---------------------------------------------------------
   一条曲目 = BPM + 主音 + 三层（贝斯 / 琶音 / 打击），每层是一串 step。
   step 是"十六分音符的第几格"，`-1` = 不发声（**休止符是数据**，
   不是"缺一项"—— 缺项会让"这一拍没安排"和"这一拍安排的休止"分不开）。

   `intensity` 是战斗那条的**分层**：每一档只改"琶音多密、打击多重"，
   不改和弦进行 —— 于是升级时听起来是"同一首曲子更紧张"，
   而不是"突然换了一首歌"。
   ========================================================= */
Music.TRACKS = [
  {
    id: 'title',
    name: '标题',
    note: '慢、空、只有贝斯与稀疏琶音 —— 它在说"还没开始"',
    bpm: 76,
    root: 110,                 // A2
    bars: 4,
    gain: 0.30,
    layers: {
      bass: { wave: 'triangle', gain: 0.5, steps: [0, -1, -1, -1, 8, -1, -1, -1, 5, -1, -1, -1, 3, -1, -1, -1] },
      arp: { wave: 'square', gain: 0.16, steps: [12, -1, -1, -1, -1, -1, 15, -1, -1, -1, 12, -1, -1, -1, -1, -1] },
      perc: { gain: 0.0, steps: [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1] }
    }
  },
  {
    id: 'combat',
    name: '战斗',
    note: '唯一一条**按强度分层**的曲子：波次越深，琶音越密、打击越重',
    bpm: 132,
    root: 130.81,              // C3
    bars: 4,
    gain: 0.34,
    layers: {
      bass: { wave: 'square', gain: 0.42, steps: [0, -1, 0, -1, 5, -1, 0, -1, 3, -1, 3, -1, 7, -1, 5, -1] },
      arp: { wave: 'triangle', gain: 0.20, steps: [12, 15, 12, 19, 12, 15, 12, 19, 15, 19, 15, 22, 15, 19, 15, 22] },
      perc: { gain: 0.30, steps: [1, -1, -1, -1, 1, -1, 1, -1, 1, -1, -1, -1, 1, -1, 1, 1] }
    }
  },
  {
    id: 'boss',
    name: 'Boss',
    note: '同调、更快、低音更重 —— 与战斗那条是同一首的"加压版"',
    bpm: 150,
    root: 98,                  // G2
    bars: 4,
    gain: 0.42,
    layers: {
      bass: { wave: 'sawtooth', gain: 0.5, steps: [0, 0, -1, 0, 5, -1, 5, -1, 3, 3, -1, 3, 7, -1, 5, -1] },
      arp: { wave: 'square', gain: 0.24, steps: [12, 15, 19, 15, 12, 15, 19, 22, 15, 19, 22, 19, 15, 19, 24, 22] },
      perc: { gain: 0.4, steps: [1, -1, 1, -1, 1, 1, -1, 1, 1, -1, 1, -1, 1, 1, 1, 1] }
    }
  },
  {
    id: 'shop',
    name: '商店',
    note: '慢一半、只留贝斯与稀疏琶音：这是"喘口气"的那一段',
    bpm: 92,
    root: 146.83,              // D3
    bars: 4,
    gain: 0.26,
    layers: {
      bass: { wave: 'triangle', gain: 0.40, steps: [0, -1, -1, -1, -1, -1, 3, -1, 5, -1, -1, -1, -1, -1, 3, -1] },
      arp: { wave: 'triangle', gain: 0.16, steps: [12, -1, 15, -1, -1, -1, 19, -1, 17, -1, 15, -1, -1, -1, 12, -1] },
      perc: { gain: 0.10, steps: [-1, -1, -1, 1, -1, -1, -1, -1, -1, -1, -1, 1, -1, -1, -1, -1] }
    }
  },
  {
    id: 'result',
    name: '结算',
    note: '通关 / 阵亡共用：短、收束、不循环（放完就停）',
    bpm: 96,
    root: 123.47,              // B2
    bars: 2,
    loop: false,
    gain: 0.32,
    layers: {
      bass: { wave: 'triangle', gain: 0.45, steps: [0, -1, -1, -1, 5, -1, -1, -1, 3, -1, -1, -1, 0, -1, -1, -1] },
      arp: { wave: 'square', gain: 0.20, steps: [12, -1, 15, -1, 19, -1, 15, -1, 17, -1, 12, -1, 12, -1, -1, -1] },
      perc: { gain: 0.0, steps: [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1] }
    }
  }
];

Music.BY_ID = (function () {
  var m: Record<string, MusicTrackDef> = Object.create(null);
  for (var i = 0; i < Music.TRACKS.length; i++) m[Music.TRACKS[i].id] = Music.TRACKS[i];
  return m;
})();

Music.get = function (id) { return id ? (Music.BY_ID[id] || null) : null; };

/* =========================================================
   3. 场景 → 曲目
   ---------------------------------------------------------
   **每一个场景都要有一条**（包括"这里没有音乐"那种 —— 写 `''`）。
   漏一个的表现是"进那个界面之后音乐停了"，而它不报错。
   `audit()` 会拿 `Scene.TABLE` 的键逐个对照。
   ========================================================= */
Music.SCENE_TRACK = {
  title: 'title',
  chars: 'title',
  playing: 'combat',
  levelup: 'combat',
  shop: 'shop',
  camp: 'shop',
  paused: '',                 // 暂停 = 静音（不是"换成另一首"）
  howto: 'title',
  settings: 'title',
  records: 'title',
  codex: 'title',
  talents: 'title',
  skills: 'title',
  keep: 'title',
  hub: 'title',
  end: 'result'
};

/** 某一场景该放哪条（空串 = 不放）。认不出的场景返回空串（不放） */
Music.forScene = function (scene) {
  if (!scene) return '';
  if (!Object.prototype.hasOwnProperty.call(Music.SCENE_TRACK, scene)) return '';
  return Music.SCENE_TRACK[scene] || '';
};

/**
 * 战斗那条的强度档：0 / 1 / 2。
 *
 * 自变量是 `波次 + (层-1)×4`（层本身也该让曲子更紧张，但它只是权值，
 * 真正的"深度"是两者合起来）。阈值对着**实测落点**定：体检里 bot 的
 * 中位落点是第 27 波 / 第 3 层（t≈35），所以
 *   0 档 = 第 1~4 波、第一层       —— 开局那几波该是安静的
 *   1 档 = 第 5~10 波，或第二层前期
 *   2 档 = 第 11 波起，或第三层    —— 后期与关底
 * 这样一局里三档都听得到。门槛定得太高会让 0 档几乎不出现，
 * "分层"就退化成只有两档。
 */
Music.intensityFor = function (wave, floor, boss) {
  if (boss) return 2;
  var t = (Number(wave) || 1) + ((Number(floor) || 1) - 1) * 5;
  if (t >= 11) return 2;
  if (t >= 5) return 1;
  return 0;
};

/* =========================================================
   4. 播放器
   ---------------------------------------------------------
   一个**前瞻式调度器**：每 100ms 醒来一次，把未来 300ms 内的音符排好。
   直接按帧调度会抖（`requestAnimationFrame` 的间隔不稳定），
   而按整段一次性排完又没法中途换曲。
   ========================================================= */
/* 播放状态（**纯表现**：不进存档、不该进会话 —— `test/persist.mjs` 的清单里登记着）。
   挂在同一个 `Music` 对象上而不是各写一个 `var`：这样"音乐有哪些播放状态"
   只在一处看得见（`var` 散在文件各处时，没人答得出"它一共有几个可变量"）。 */
Music.current = '';
Music.intensity = 0;
Music.timer = null;
Music.step = 0;
Music.enabled = true;

/** 一条曲目一拍（十六分音符）多长 */
Music.stepDur = function (track) {
  return 60 / Math.max(30, track.bpm) / 4;
};

/* =========================================================
   4. 淡入淡出（交叉淡入 / 换挡脉冲）
   ---------------------------------------------------------
   改造前**是硬切**：`Music.play` 先 `stop()` 再立刻排第一拍，于是
   换场景时上一首的音符被拦腰截断，而新一首从满音量开始 —— 两声"啪"。
   行业判据（audio-design 清单）：换曲用**立即交叉淡入**（0.2~0.5s），
   同一首曲子内部的强度变化用**更短的**淡入淡出，绝不能是台阶。

   为什么淡入淡出挂在**总线**（`Music.bus`）上而不是逐个音符：
   逐个音符写包络要改 `tone()`/`hit()` 两处、还要区分"新音符/旧音符"，
   而总线上只有一根曲线，且**天然把旧音符的尾巴也一起管住** ——
   旧音符的包络本来就只剩几十毫秒，新音符从 0 淡入，两者自然叠成交叉淡入。

   音量层级（三层相乘，各管各的，**不许互相代替**）：
     `master`     = 玩家总音量（`Sfx.volume`，唯一的那个滑杆）
     `musicBus`   = 音效/音乐配比（`Sfx.musicVolume`）× 闪避（`Sfx.duck`）
     `Music.bus`  = 曲目增益（`tr.gain`）× 淡入淡出包络（0..1，`Music.play` 建）
   `Music.targetGain()` 算的是**前两层**的乘积，也就是 `Music.bus` 的稳态值；
   淡入淡出在它上面乘一个 0..1 的包络。**曲目增益不乘进音符峰值** ——
   乘进去的话"换曲时按新曲子增益重建总线"就会双重缩放。

   为什么不用 `exponentialRamp`：目标可以是 0，而指数曲线到不了 0
   （`setTargetAtTime` 也是渐近）。线性再加一个下限才是可预测的。
   ========================================================= */
/** `Music.bus` 的稳态值 = 音乐总线的目标增益（不含淡入淡出包络） */
Music.targetGain = function () {
  var mv = Sfx.musicVolume === undefined ? 1 : Sfx.musicVolume;
  var duck = Sfx.duck === undefined ? 1 : Sfx.duck;
  return Sfx.gainOf(mv) * duck;
};

/**
 * 把 `Music.bus` 推到 `target`（**唯一**写入口：淡入淡出、脉冲、换曲都走它）。
 * @param target 目标增益（稳态值 = `Music.targetGain()`）
 * @param sec    淡入淡出时长（0 = 立刻跳）
 */
Music.setGain = function (target, sec) {
  if (!Sfx.ctx) return false;
  /* `Music.bus` 建不起来（极端环境）时退回 `musicBus`：
     宁可丢掉淡入淡出，也不能"没有声音"——淡入淡出是润色，出声是功能。 */
  var bus = Music.bus || Sfx.musicBus;
  if (!bus) return false;
  var t = Math.max(0, Number(target) || 0);
  var g = bus.gain;
  var now = Sfx.ctx.currentTime;
  try {
    g.cancelScheduledValues(now);
    if (!(sec > 0)) { g.setValueAtTime(t, now); return true; }
    /* 从**当前实际值**起步（不是从上一个目标值）：连续两次淡入淡出叠在一起时，
       从实际值起步才不会跳。自动化期间读到 `value` 就是当前插值。 */
    g.setValueAtTime(Math.max(0.0001, g.value), now);
    g.linearRampToValueAtTime(t, now + sec);
  } catch (e) { /* 音频不可用不该影响游戏 */ }
  return true;
};

/** 强度换挡的"咬"：短促压低再放回，让换挡听起来是刻意的（而不是掉帧） */
Music.pulse = function () {
  if (!Music.bus || !Sfx.ctx) return false;
  var base = Music.targetGain();
  var g = Music.bus.gain;
  var now = Sfx.ctx.currentTime;
  try {
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(0.0001, g.value), now);
    g.linearRampToValueAtTime(Math.max(0.0001, base * PULSE.to), now + PULSE.down);
    g.linearRampToValueAtTime(base, now + PULSE.down + PULSE.up);
  } catch (e) { /* 同上 */ }
  return true;
};

/**
 * 排一个十六分音符。
 * 强度分层：高档把琶音**升八度**、把空隙补满，低档只响谱上写的那些格。
 * 这是"同一首曲子更紧张"而不是"换了首歌"的实现方式。
 */
Music.schedule = function (ctx) {
  var tr = Music.get(Music.current);
  if (!tr) return;
  /* 走**音乐总线**这一个出口（`master ← musicBus`）：音乐自己再开一个 gain
     就会出现"调了音量音乐没变"或"静音了音乐还在响"。
     `master` 仍是总音量，`musicBus` 只是"音效与音乐之间怎么配比"。 */
  var bus = Music.bus;
  if (!bus) return;
  var total = tr.bars * 16;
  var step = Music.step % total;

  /* **不循环的曲子放完就停**（`loop: false` 的读点）。
     之前 `loop` 只是表里一个没人读的字段 —— 声明了却不生效的字段
     比没有这个字段更糟：它让人以为"结算曲放一遍就停"已经实现了。 */
  if (!tr.loop && Music.step > 0 && Music.step % total === 0) {
    Music.stop();
    return;
  }

  var dur = Music.stepDur(tr);
  var at = ctx.currentTime + 0.02;
  var root = tr.root;
  var lv = Music.intensity;

  for (var li = 0; li < 3; li++) {
    var name = li === 0 ? 'bass' : (li === 1 ? 'arp' : 'perc');
    var layer = tr.layers[name];
    if (!layer || !(layer.gain > 0)) continue;
    var arr = layer.steps;
    var semi = arr[step % arr.length];
    if (semi < 0) {
      /* **琶音补空隙**：低档时"谱上没写"就是休止，1 档起改用上一层
         已经用过的那个音补上（`DENSIFY.offset` 格之前的音）。
         为什么是"重复自己"而不是新写一个音：程序化生成里随手加音会跑调，
         而"把刚才那个音再响一次"在小调五声里**不可能出错**。 */
      if (name !== 'arp' || lv < DENSIFY.minLevel || arr.length < 2) continue;
      var back = arr[(step - DENSIFY.offset + arr.length * 2) % arr.length];
      if (!(back >= 0)) continue;
      Music.tone(at, Music.freq(root, back), dur * 0.45, layer.wave,
        layer.gain * DENSIFY.gain, bus);
      continue;
    }
    if (name === 'perc') {
      /* 打击层：step 的值当"用哪一种" —— 1 = 底鼓，>1 = 镲 */
      if (lv === 0 && step % 8 !== 0) continue;
      Music.hit(at, semi > 1 ? 'hat' : 'kick', layer.gain * (lv >= 2 ? 1.2 : 1), bus);
      continue;
    }
    var oct = (name === 'arp' && lv >= 2) ? 12 : 0;
    Music.tone(at, Music.freq(root, semi + oct), dur * (name === 'bass' ? 0.9 : 0.55),
      layer.wave, layer.gain * (name === 'arp' && lv >= 2 ? 1.15 : 1), bus);
  }
  Music.step++;

  /* ---- 强度换挡：只在小节线上生效（见上面 `Music.wanted` 的说明） ---- */
  if (Music.step % 16 === 0 && Music.wanted !== Music.intensity) {
    Music.intensity = Music.wanted;
    Music.pulse();
  }
};

/** 一个音符（与 `audio.ts` 的 `tone` 同一手法，但**按绝对时间**排程） */
Music.tone = function (at, freq, dur, wave, peak, dest) {
  var ctx = Sfx.ctx;
  if (!ctx || !dest) return;
  try {
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = (wave || 'triangle') as OscillatorType;
    osc.frequency.setValueAtTime(Math.max(20, freq), at);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g); g.connect(dest);
    osc.start(at); osc.stop(at + dur + 0.03);
  } catch (e) { /* 音频不可用不该影响游戏 */ }
};

/** 打击：底鼓用滑音，镲用一段噪声 */
Music.hit = function (at, kind, peak, dest) {
  var ctx = Sfx.ctx;
  if (!ctx || !dest) return;
  try {
    if (kind === 'kick') {
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(120, at);
      osc.frequency.exponentialRampToValueAtTime(45, at + 0.10);
      g.gain.setValueAtTime(Math.max(0.0002, peak), at);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
      osc.connect(g); g.connect(dest);
      osc.start(at); osc.stop(at + 0.15);
    } else {
      var n = Math.floor(ctx.sampleRate * 0.05);
      var buf = ctx.createBuffer(1, Math.max(1, n), ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      var src = ctx.createBufferSource(); src.buffer = buf;
      var f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 5000;
      var g2 = ctx.createGain();
      g2.gain.setValueAtTime(Math.max(0.0002, peak * 0.5), at);
      g2.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
      src.connect(f); f.connect(g2); g2.connect(dest);
      src.start(at);
    }
  } catch (e) { /* 同上：音频失败不冒泡 */ }
};

/**
 * 放一条曲子。同一首**不重启**（否则每帧调用都会把曲子掐回第一拍）。
 *
 * 换曲时**新建一条总线并从 0 淡入**（`Music.FADE` 秒）。旧曲子的音符
 * 已经被排进了 Web Audio 的时间轴，会自己把包络走完（几十毫秒），
 * 于是听感上就是旧尾音淡出、新曲子淡入 —— 交叉淡入，不是硬切。
 */
Music.play = function (id) {
  var want = id || '';
  if (want === Music.current && Music.timer) return false;
  Music.stop();
  Music.current = want;
  if (!want) return true;
  if (!Music.enabled) return false;
  Sfx.init();
  if (!Sfx.ctx) return false;
  if (Sfx.ctx.state === 'suspended') { try { Sfx.ctx.resume(); } catch (e) { } }

  /* 每首曲子一条自己的总线（增益 = 曲目表里的 `gain`）。
     按曲子重建而不复用同一条，是因为"曲目增益"本来就属于曲子；
     复用就得每次手动改 gain，而那条曲线还会和淡入淡出打架。 */
  var tr = Music.get(want);
  try {
    var bus = Sfx.ctx.createGain();
    bus.gain.value = 0;                          // 从静音起步，下面淡入
    bus.connect(Sfx.musicBus || Sfx.master || Sfx.ctx.destination);
    Music.bus = bus;
  } catch (e) { Music.bus = null; }
  Music.setGain(Music.targetGain() * (tr ? tr.gain : 1), Music.FADE);

  Music.step = 0;
  Music.wanted = Music.intensity;                // 新曲子从当前档开始，不排队换挡
  Music.schedule(Sfx.ctx);                       // 立刻排第一拍（不然开头有 100ms 空）
  Music.timer = setInterval(function () {
    if (!Music.enabled) return;
    Music.schedule(Sfx.ctx);
  }, 100);
  return true;
};

/**
 * 停调度器（并让总线立刻静音）。
 * 已经在音频时间轴上排出去的音符**不会**被撤销 —— 它们会自己走完包络。
 * 这正是交叉淡入需要的行为（旧尾音自然收掉），所以这里不强行砍。
 */
Music.stop = function () {
  if (Music.timer) { clearInterval(Music.timer); Music.timer = null; }
  Music.current = '';
  /* 立刻断开总线：`setInterval` 停了，但**已排程**的音符要几拍才排完，
     不压总线就会出现"停了之后还剩半秒音乐"（换场景时最明显）。 */
  Music.setGain(0, 0);
  Music.bus = null;
  return true;
};

/**
 * 每个逻辑帧调一次：按场景决定放什么。
 * **唯一的换曲入口** —— 界面/主循环都不自己调 `play`，
 * 否则"哪个界面放哪首"会散到各处（改一次要改五处）。
 *
 * 强度只写进 `Music.wanted`（**请求值**）：真正的换挡发生在小节线上
 * （`Music.schedule` 里那一处），不然排音方式会在乐句中间变掉。
 */
Music.update = function (scene, intensity) {
  if (!Music.enabled) { Music.stop(); return false; }
  var want = Music.forScene(scene);
  var lv = Math.max(0, Math.min(2, Math.round(Number(intensity) || 0)));
  Music.wanted = lv;
  /* 没有曲子在放的时候没有"小节线"可等，直接把请求应用掉
     （否则第一帧的档位会拖到第二小节才生效）。 */
  if (!Music.timer && Music.current === '') Music.intensity = lv;
  if (want === Music.current) return false;
  return Music.play(want);
};

Music.setEnabled = function (on) {
  Music.enabled = !!on;
  if (!Music.enabled) Music.stop();
  return Music.enabled;
};

/* 音乐总线比例 / 闪避改变时，把**正在放的那首**的总线增益跟上。
   为什么必须在这里跟：`Music.bus` 是 `Music.play` 建的，设置面板改配比时
   曲子可能已经放了十分钟 —— 没有这一段，滑杆要等到**下一首曲子**才生效。 */
Music.refresh = function () {
  if (!Music.bus || !Music.current) return false;
  var tr = Music.get(Music.current);
  return Music.setGain(Music.targetGain() * (tr ? tr.gain : 1), 0.12);
};
/* 订阅音乐总线比例 / 闪避的变化：设置面板一改，**正在放的那首**立刻跟上
   （不用等下一首曲子才生效）。这就是 `audio.ts` 那个回调的用处 ——
   两边都不用 import 对方，也就不会形成第 6 层的循环依赖。 */
if (Sfx.onMusicVolume) Sfx.onMusicVolume(Music.refresh);

/* =========================================================
   5. 定义期自检
   ========================================================= */
Music.audit = function () {
  var problems: string[] = [];

  /* ---- 曲目 ---- */
  var seen: Record<string, boolean> = Object.create(null);
  for (var i = 0; i < Music.TRACKS.length; i++) {
    var t = Music.TRACKS[i];
    if (!t.id) problems.push('第 ' + i + ' 条曲目没有 id');
    if (seen[t.id]) problems.push('曲目 id 重复：' + t.id);
    seen[t.id] = true;
    if (!t.name || !t.note) problems.push(t.id + ' 缺少名字或说明');
    if (!(t.bpm >= 30 && t.bpm <= 300)) problems.push(t.id + ' 的 bpm 不合理：' + t.bpm);
    if (!(t.root > 20 && t.root < 2000)) problems.push(t.id + ' 的主音不是可听的频率：' + t.root);
    if (!(t.bars >= 1 && t.bars === Math.floor(t.bars))) problems.push(t.id + ' 的小节数必须是正整数');
    if (!(t.gain > 0 && t.gain <= 1)) problems.push(t.id + ' 的增益必须落在 (0,1]：' + t.gain);
    /* 声部数组只有 16 格 = 一小节，所以 `bars > 1` 的曲子**是小节级重复**
       （同一个 16 格模式连放 `bars` 遍），不是 `bars` 小节不重复的谱。
       这是当前占位音乐的真实能力，写在这里是为了**别让人以为 `bars` 在变奏**。 */
    if (t.loop === false && t.layers && t.layers.arp) {
      var arpSteps = t.layers.arp.steps || [];
      if (arpSteps[arpSteps.length - 1] >= 0) {
        problems.push(t.id + ' 声明了 loop:false（放完就停），最后一个琶音格却是实音 —— ' +
          '不循环的曲子要以**收束**结尾（末格休止），否则听起来像被掐断');
      }
    }
    if (!t.layers) { problems.push(t.id + ' 没有声部'); continue; }
    var names = ['bass', 'arp', 'perc'];
    var sounding = 0;
    for (var li = 0; li < names.length; li++) {
      var L = t.layers[names[li]];
      if (!L) { problems.push(t.id + ' 缺声部：' + names[li]); continue; }
      if (!(L.gain >= 0 && L.gain <= 1)) problems.push(t.id + '.' + names[li] + ' 的增益越界：' + L.gain);
      if (!L.steps || L.steps.length !== 16) {
        problems.push(t.id + '.' + names[li] + ' 必须是 16 格（一个十六分音符一格）：' +
          (L.steps ? L.steps.length : 0));
      } else {
        /* **休止符是数据**：`-1`。其它负数是无意义的（写 -2 会被当成休止，
           而写的人以为它和 -1 不一样）。 */
        for (var s = 0; s < L.steps.length; s++) {
          var v = L.steps[s];
          if (typeof v !== 'number' || !isFinite(v)) problems.push(t.id + '.' + names[li] + ' 第 ' + s + ' 格不是数');
          else if (v < -1) problems.push(t.id + '.' + names[li] + ' 第 ' + s + ' 格是 ' + v + '（休止只许写 -1）');
          else if (v >= 0) sounding++;
        }
      }
      if (L.gain > 0 && names[li] !== 'perc' && !L.wave) problems.push(t.id + '.' + names[li] + ' 有声但没写波形');
    }
    if (sounding === 0) problems.push(t.id + ' 整条曲子都是休止符（那就是静音，不该进表）');
  }
  if (Music.TRACKS.length < 3) problems.push('曲目少于 3 条：一款游戏至少要有"标题 / 游玩 / 结算"三种场合的音乐');

  /* ---- 场景映射：**每个场景都要有一条** ---- */
  var scenes = Object.keys(Music.SCENE_TRACK);
  if (!scenes.length) problems.push('场景 → 曲目的映射是空的');
  for (var si = 0; si < scenes.length; si++) {
    var want = Music.SCENE_TRACK[scenes[si]];
    if (want && !Music.BY_ID[want]) problems.push('场景 ' + scenes[si] + ' 指向了不存在的曲目：' + want);
  }
  /* 与场景表对照：场景表里有的，映射表里必须也有（漏一个 = 那个界面静音，
     而它不报错）。`Scene.TABLE` 是场景的**唯一出处**。 */
  var T = (globalThis as any).Scene;
  if (T && T.TABLE) {
    var keys = Object.keys(T.TABLE);
    for (var k = 0; k < keys.length; k++) {
      if (!Object.prototype.hasOwnProperty.call(Music.SCENE_TRACK, keys[k])) {
        problems.push('场景「' + keys[k] + '」没有声明放什么音乐（漏一个界面就会静音）');
      }
    }
    for (var m = 0; m < scenes.length; m++) {
      if (!T.TABLE[scenes[m]]) problems.push('映射表里的「' + scenes[m] + '」不是一个真实场景');
    }
  }

  /* ---- 强度分层：必须真的分得开 ---- */
  if (!(Music.intensityFor(1, 1, false) < Music.intensityFor(20, 1, false))) {
    problems.push('战斗强度分不出低档与高档（`intensityFor` 的阈值不对）');
  }
  if (Music.intensityFor(1, 1, true) !== 2) problems.push('Boss 那一档必须是最高强度');

  /* ---- 淡入淡出 / 换挡：**不许是台阶** ---- */
  if (!(Music.FADE > 0.05 && Music.FADE <= 1)) {
    problems.push('交叉淡入时长不合理：' + Music.FADE + '（硬切就是因为这个值是 0）');
  }
  if (!(PULSE.to > 0 && PULSE.to < 1)) problems.push('换挡脉冲的压低比例必须落在 (0,1)：' + PULSE.to);
  if (!(PULSE.down > 0 && PULSE.up > 0)) problems.push('换挡脉冲的两段时长必须是正数');
  /* 强度换挡必须**只在小节线上**发生。这条判据落在**行为**上而不是源码文本上
     （"函数体里有没有那两行字"是能骗过去的：换个写法就匹配不到），
     验证在 `test/audio.mjs` 的 [1c] 一节里，它真的按 16 格走一遍调度器。 */
  if (!(Music.wanted >= 0)) problems.push('`Music.wanted` 不是一个有效的强度档：' + Music.wanted);

  /* ---- 琶音补空隙：得真的补得动（不是死分支） ---- */
  if (!(DENSIFY.minLevel >= 0 && DENSIFY.minLevel <= 2)) {
    problems.push('补空隙的起始档必须落在 0..2：' + DENSIFY.minLevel);
  }
  var combat = Music.BY_ID['combat'];
  if (combat) {
    /* 战斗那条的琶音**本来就没有空格**（16 格全响）—— 所以"补空隙"对它无事可做。
       这是数据本身的事实，不是缺陷；但**如果哪天它有了空格**，这条会跟着变，
       而下面这条检查保证"补空隙"在有空格的曲子上确实有效。 */
    var title = Music.BY_ID['title'];
    if (title) {
      var tarp = title.layers.arp.steps;
      var tgaps = 0;
      for (var q = 0; q < tarp.length; q++) if (tarp[q] < 0) tgaps++;
      if (tgaps === 0) problems.push('没有一条曲子的琶音有空隙 —— "补空隙"成了没机会执行的死代码');
    }
  }

  return {
    ok: problems.length === 0, problems: problems,
    counts: { tracks: Music.TRACKS.length, scenes: scenes.length, layers: Music.TRACKS.length * 3 }
  };
};

var verdict = Music.audit();
if (!verdict.ok) throw new Error('music.ts 背景音乐表自检失败：\n' + verdict.problems.join('\n'));
SelfCheck.register('Music', Music.audit);

/* 登记到扩展点总账：曲目是一个家族（场景映射的取值域就是它） */
Registry.family('musicTrack', {
  note: '背景音乐曲目（程序化生成的占位；换成真音乐时曲目表不动）', owner: 'music.ts',
  entries: function () {
    return Music.TRACKS.map(function (d) { return { id: d.id, refs: [] }; });
  }
});

export { Music };
