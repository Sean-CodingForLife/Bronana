/* =========================================================
   fix-types.js — 迁移期的定向修复（可重复执行）
   两类改动：
     1) 补齐/纠正 globals.d.ts 里我漏写的契约字段
     2) 修掉 tsc 抓出来的真实缺陷（字段名不符、var 复用、可选参数、死代码）
   用法： node tools/fix-types.cjs
   ========================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

let n = 0;
function patch(file, from, to, label) {
  const p = path.join(SRC, file);
  let s = fs.readFileSync(p, 'utf8');
  if (s.indexOf(to) >= 0 && s.indexOf(from) < 0) return;   // 已修
  if (s.indexOf(from) < 0) { console.log('  【未匹配】' + file + '  ' + (label || from.slice(0, 50))); return; }
  s = s.split(from).join(to);
  fs.writeFileSync(p, s);
  n++;
  console.log('  ' + file.padEnd(16) + (label || from.slice(0, 60)));
}

/* ---------------- 1. globals.d.ts：补齐契约 ---------------- */
patch('globals.d.ts',
  '  enabled: boolean; volume: number;\n  init(): void; resume(): void; setEnabled(v: boolean): void;',
  '  enabled: boolean; volume: number;\n  ctx: AudioContext | null; master: GainNode | null;\n  init(): void; resume(): void; setEnabled(v: boolean): void;',
  'SfxApi 补 ctx / master');

patch('globals.d.ts',
  '  init(canvas?: any): void;',
  '  _canvas?: HTMLCanvasElement | null;\n  _slow: boolean;\n  init(canvas?: any): void;',
  'InputApi 补 _canvas / _slow');

patch('globals.d.ts',
  '  inView(x: number, y: number, r?: number): boolean;',
  '  inView(x: number, y: number, r?: number): boolean;\n  toWorld(sx: number, sy: number): { x: number; y: number };',
  'RenderApi 补 toWorld');

patch('globals.d.ts',
  '  state: GameStateName;\n  STATES: GameStateName[];',
  '  state: GameStateName;\n  _pauseFrom?: GameStateName;\n  _input?: { x: number; y: number };\n  STATES: GameStateName[];',
  'GameApi 补 _pauseFrom / _input');

patch('globals.d.ts',
  '  outline?: string | null;',
  '  outline?: string | null | false;',
  'DrawOptions.outline 允许 false');

patch('globals.d.ts',
  '  cloneObj<T>(o: T): T;',
  '  cloneObj(o: any): any;',
  'cloneObj 签名与实现一致（浅拷贝任意对象）');

/* ---------------- 2. 真实缺陷与签名修正 ---------------- */
// 元素伤害加成：字段名写错，导致该加成从未生效
patch('stats.ts',
  'if (weapon.elemental) mul += s.elementalDmg * 0.12;',
  'if (weapon.element) mul += s.elementalDmg * 0.12;',
  '★ 元素伤害加成失效（elemental → element）');

// 同一函数里 var m 先数字后字符串
patch('sprites.ts',
  'for (var m = -1; m <= 1; m++) {',
  'for (var mi = -1; mi <= 1; mi++) {',
  '★ var m 复用（循环变量改名）');
patch('sprites.ts',
  'D.poly(x, [\n            [cx + m * R * 0.46 - R * 0.12, cy + R * 0.55],\n            [cx + m * R * 0.46 + R * 0.12, cy + R * 0.55],\n            [cx + m * R * 0.46, cy + R * (1.0 + 0.12 * (m === 0 ? -1 : 1))]\n          ], def.dark, { outline: PAL.INK, outlineWidth: 2 });',
  'D.poly(x, [\n            [cx + mi * R * 0.46 - R * 0.12, cy + R * 0.55],\n            [cx + mi * R * 0.46 + R * 0.12, cy + R * 0.55],\n            [cx + mi * R * 0.46, cy + R * (1.0 + 0.12 * (mi === 0 ? -1 : 1))]\n          ], def.dark, { outline: PAL.INK, outlineWidth: 2 });',
  '同步循环体里的 m');

// 内部辅助函数的可选参数
patch('game.ts', 'function queryCircle(x, y, r, out) {', 'function queryCircle(x, y, r, out?) {', 'queryCircle 的 out 可选');
patch('game.ts', 'function nearestEnemy(x, y, maxDist, exclude) {', 'function nearestEnemy(x, y, maxDist, exclude?) {', 'nearestEnemy 的 exclude 可选');
patch('game.ts', 'function killEnemy(e, opt) {', 'function killEnemy(e, opt?) {', 'killEnemy 的 opt 可选');
patch('game.ts', 'function pushEnemyBullet(e, a, boss) {', 'function pushEnemyBullet(e, a, boss?) {', 'pushEnemyBullet 的 boss 可选');
patch('game.ts', 'function hurtPlayer(raw) {', 'function hurtPlayer(raw) {', 'noop');
// 生命窃取本意是不弹回血飘字，但实现忽略了第二个参数
patch('game.ts',
  'function healPlayer(amount) {\n    var p = S.player;\n    var before = p.hp;\n    p.hp = Math.min(S.stats.maxHp, p.hp + amount);\n    var got = p.hp - before;\n    if (got > 0) {\n      S.stats_total.healed += got;\n      Emit.heal(p.x, p.y - 34, got);\n    }\n  }',
  'function healPlayer(amount, silent?) {\n    var p = S.player;\n    var before = p.hp;\n    p.hp = Math.min(S.stats.maxHp, p.hp + amount);\n    var got = p.hp - before;\n    if (got > 0) {\n      S.stats_total.healed += got;\n      // 生命窃取每帧都在回血，弹字会刷屏 —— silent 用来抑制（调用方本来就传了 false）\n      if (!silent) Emit.heal(p.x, p.y - 34, got);\n    }\n  }',
  '★ healPlayer 支持 silent（生命窃取不再刷回血飘字）');

// 死代码：setInput/_input 从未被读取
patch('game.ts',
  '  Game.setInput = function (v) { Game._input = v; };\n\n',
  '',
  '★ 删除死代码 Game.setInput / _input');

// Bus 内部：clear / listenerCount 的参数应可选（stats() 里就是无参调用）
patch('utils.ts', 'clear: function (evt) {', 'clear: function (evt?) {', 'Bus.clear 参数可选');
patch('utils.ts', 'listenerCount: function (evt) {', 'listenerCount: function (evt?) {', 'Bus.listenerCount 参数可选');

// CFG 兜底值的类型
patch('stats.ts',
  "global.CFG = global.CFG || {};",
  "global.CFG = global.CFG || ({ moveSpeedPerPoint: 8 } as CfgApi);",
  'CFG 兜底对象带类型');

// register：把可选 cullR 归一化成一个确定值再存
patch('sprites.ts',
  '  S.register = function (kind, def) {\n    def.cullR = def.cullR === undefined ? 16 : def.cullR;\n    S.kinds[kind] = def;\n    return def;\n  };',
  '  S.register = function (kind, def) {\n    // 归一化成"一定有 cullR"的形状，避免可选字段在存进注册表后仍然是可选\n    var entry = {\n      cullR: def.cullR === undefined ? 16 : def.cullR,\n      draw: def.draw\n    };\n    S.kinds[kind] = entry;\n    return entry;\n  };',
  'register 归一化 cullR');

// 音频：末尾参数可选
patch('audio.ts', 'function tone(freq, dur, type, peak, slideTo) {', 'function tone(freq, dur, type, peak, slideTo?) {', 'tone 的 slideTo 可选');
patch('audio.ts', 'function noise(dur, peak, filterHz, q) {', 'function noise(dur, peak, filterHz, q?) {', 'noise 的 q 可选');
patch('audio.ts',
  "var AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);",
  "var AC = (typeof window !== 'undefined') && (window.AudioContext || (window as any).webkitAudioContext);",
  'webkitAudioContext 兼容访问');

// UI：el 是 DOM 引用集合，用 Record<string, any> 而不是推断成 {}
patch('ui.ts', 'var el = {};', 'var el: Record<string, any> = {};', 'el 对象显式类型');
// UI：event.target 需要窄化成 Element 才能用 closest
patch('ui.ts',
  "var t = e.target.closest ? e.target.closest('[data-act]') : null;",
  "var target = e.target as Element | null;\n      var t = target && target.closest ? target.closest('[data-act]') : null;",
  'event.target 窄化为 Element');
// UI：结算兜底对象补齐字段
patch('ui.ts',
  "var sum = qs ? Game.summary() : { wave: 1, level: 1, kills: 0, materials: 0, damage: 0, taken: 0, healed: 0, win: false };",
  "var sum: RunSummary = qs ? Game.summary() : ({\n            win: false, wave: 1, level: 1, kills: 0, materials: 0,\n            damage: 0, taken: 0, healed: 0, charName: '', weapons: [], items: [],\n            stats: null, packs: 0, packSpent: 0\n          } as RunSummary);",
  '结算兜底对象补齐 RunSummary 字段');

// main：canvas 查询与测试场景元组
patch('main.ts',
  "var canvas = document.getElementById('game');",
  "var canvas = document.getElementById('game') as HTMLCanvasElement;",
  'getElementById 窄化为 canvas');
patch('main.ts',
  'var spots = [',
  'var spots: Array<[string, number, number]> = [',
  'spots 标注为元组数组');

console.log('\n共修复 ' + n + ' 处');
