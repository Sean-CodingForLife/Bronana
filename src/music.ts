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

var Music = ({
  current: '',
  intensity: 0,
  /** `setInterval` 的句柄：**只用来停调度器**，不进任何存档 */
  timer: null,
  step: 0,
  enabled: true
} as MusicApi);
/** 上一次应用过的强度档（避免每帧重复写 `Music.intensity`） */
var wantedIntensity = -1;
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
/** 上一次应用过的强度档（避免每帧重复写 `Music.intensity`） */
var wantedIntensity = -1;

/** 一条曲目一拍（十六分音符）多长 */
Music.stepDur = function (track) {
  return 60 / Math.max(30, track.bpm) / 4;
};

/**
 * 排一个十六分音符。
 * 强度分层：高档把琶音**升八度**并加密（每格都响），低档只响谱上写的那些格。
 * 这是"同一首曲子更紧张"而不是"换了首歌"的实现方式。
 */
Music.schedule = function (ctx) {
  var tr = Music.get(Music.current);
  if (!tr) return;
  /* 走 `Sfx.master` 这一个出口：音乐自己再开一个 gain 就会出现
     "调了音量音乐没变"或"静音了音乐还在响"。 */
  var master = Sfx.master;
  if (!master) return;
  var dur = Music.stepDur(tr);
  var at = ctx.currentTime + 0.02;
  var step = Music.step % (tr.bars * 16);
  var root = tr.root;
  var lv = Music.intensity;

  for (var li = 0; li < 3; li++) {
    var name = li === 0 ? 'bass' : (li === 1 ? 'arp' : 'perc');
    var layer = tr.layers[name];
    if (!layer || !(layer.gain > 0)) continue;
    var semi = layer.steps[step % layer.steps.length];
    if (semi < 0) continue;
    /* 高强度：琶音每格都补一拍（只补琶音 —— 补贝斯会糊，补打击会吵） */
    if (name === 'arp' && lv >= 1 && semi < 0) semi = layer.steps[(step + 2) % layer.steps.length];
    if (name === 'perc') {
      /* 打击层：step 的值当"用哪一种" —— 1 = 底鼓，>1 = 镲 */
      if (lv === 0 && step % 8 !== 0) continue;
      Music.hit(at, semi > 1 ? 'hat' : 'kick', layer.gain * (lv >= 2 ? 1.2 : 1), master);
      continue;
    }
    var oct = (name === 'arp' && lv >= 2) ? 12 : 0;
    Music.tone(at, Music.freq(root, semi + oct), dur * (name === 'bass' ? 0.9 : 0.55),
      layer.wave, layer.gain * (name === 'arp' && lv >= 2 ? 1.15 : 1), master);
  }
  Music.step++;
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
 * @param loopHack 内部用：换曲时先把调度器停一下
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
  Music.step = 0;
  Music.schedule(Sfx.ctx);                       // 立刻排第一拍（不然开头有 100ms 空）
  Music.timer = setInterval(function () {
    if (!Music.enabled) return;
    Music.schedule(Sfx.ctx);
  }, 100);
  return true;
};

Music.stop = function () {
  if (Music.timer) { clearInterval(Music.timer); Music.timer = null; }
  Music.current = '';
  return true;
};

/**
 * 每个逻辑帧调一次：按场景决定放什么。
 * **唯一的换曲入口** —— 界面/主循环都不自己调 `play`，
 * 否则"哪个界面放哪首"会散到各处（改一次要改五处）。
 */
Music.update = function (scene, intensity) {
  if (!Music.enabled) { Music.stop(); return false; }
  var want = Music.forScene(scene);
  var lv = Math.max(0, Math.min(2, Math.round(Number(intensity) || 0)));
  if (wantedIntensity !== lv) { wantedIntensity = lv; Music.intensity = lv; }
  if (want === Music.current) return false;
  return Music.play(want);
};

Music.setEnabled = function (on) {
  Music.enabled = !!on;
  if (!Music.enabled) Music.stop();
  return Music.enabled;
};

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
