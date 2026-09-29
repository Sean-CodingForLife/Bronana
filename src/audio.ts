/* =========================================================
audio.ts — 程序化音效（无音频资源文件）
极简方波/噪声，风格克制；无 AudioContext 时静默降级
========================================================= */
var Sfx = ({
  ctx: null,
  master: null,
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
    Sfx.master.gain.value = Sfx.volume;
    Sfx.master.connect(Sfx.ctx.destination);
  } catch (e) { Sfx.enabled = false; }
};

Sfx.resume = function () {
  if (!Sfx.ctx) Sfx.init();
  if (Sfx.ctx && Sfx.ctx.state === 'suspended') Sfx.ctx.resume();
};

Sfx.setEnabled = function (v) {
  Sfx.enabled = !!v;
  if (Sfx.master) Sfx.master.gain.value = Sfx.enabled ? Sfx.volume : 0;
};

function env(node, t0, a, d, peak) {
  var g = node.gain;
  g.cancelScheduledValues(t0);
  g.setValueAtTime(0.0001, t0);
  g.exponentialRampToValueAtTime(peak, t0 + a);
  g.exponentialRampToValueAtTime(0.0001, t0 + a + d);
}

function tone(freq, dur, type, peak, slideTo?) {
  if (!Sfx.enabled) return;
  Sfx.init();
  if (!Sfx.ctx) return;
  var t0 = Sfx.ctx.currentTime;
  var osc = Sfx.ctx.createOscillator();
  var g = Sfx.ctx.createGain();
  osc.type = type || 'square';
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
  env(g, t0, 0.006, dur, peak === undefined ? 0.5 : peak);
  osc.connect(g); g.connect(Sfx.master);
  osc.start(t0); osc.stop(t0 + dur + 0.04);
}

function noise(dur, peak, filterHz, q?) {
  if (!Sfx.enabled) return;
  Sfx.init();
  if (!Sfx.ctx) return;
  var ctx = Sfx.ctx, t0 = ctx.currentTime;
  var n = Math.floor(ctx.sampleRate * dur);
  var buf = ctx.createBuffer(1, Math.max(1, n), ctx.sampleRate);
  var d = buf.getChannelData(0);
  for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  var src = ctx.createBufferSource(); src.buffer = buf;
  var f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = filterHz || 1400; f.Q.value = q || 1;
  var g = ctx.createGain();
  env(g, t0, 0.004, dur, peak === undefined ? 0.4 : peak);
  src.connect(f); f.connect(g); g.connect(Sfx.master);
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

Sfx.shoot = function (kind) {
  if (!throttle('shoot', 45)) return;
  if (kind === 'laser') tone(880, 0.07, 'sawtooth', 0.26, 200);
  else if (kind === 'shotgun') { noise(0.12, 0.42, 1100); tone(180, 0.09, 'square', 0.22, 70); }
  else if (kind === 'sniper') tone(300, 0.16, 'square', 0.34, 90);
  else tone(520, 0.055, 'square', 0.2, 300);
};
Sfx.melee = function () { if (throttle('melee', 60)) noise(0.07, 0.26, 2600, 2); };
Sfx.kill = function () { if (throttle('kill', 55)) { noise(0.1, 0.34, 900); tone(150, 0.09, 'triangle', 0.22, 60); } };
Sfx.hurt = function () { tone(220, 0.16, 'square', 0.4, 90); };
Sfx.levelUp = function () { tone(520, 0.1, 'square', 0.3); setTimeout(function () { tone(700, 0.1, 'square', 0.3); }, 90); setTimeout(function () { tone(950, 0.16, 'square', 0.3); }, 180); };
Sfx.buy = function () { tone(700, 0.07, 'square', 0.28, 900); };
Sfx.deny = function () { tone(160, 0.12, 'square', 0.3, 110); };
Sfx.explode = function () { noise(0.32, 0.5, 700, 0.6); tone(90, 0.3, 'triangle', 0.34, 40); };
Sfx.waveStart = function () { tone(320, 0.14, 'square', 0.3); setTimeout(function () { tone(480, 0.2, 'square', 0.3); }, 140); };
Sfx.waveClear = function () { [440, 590, 740, 990].forEach(function (f, i) { setTimeout(function () { tone(f, 0.13, 'square', 0.26); }, i * 95); }); };
Sfx.click = function () { tone(420, 0.04, 'square', 0.2, 560); };
Sfx.pickup = function () { if (throttle('pickup', 60)) tone(1400, 0.04, 'square', 0.12, 1800); };

export { Sfx };
