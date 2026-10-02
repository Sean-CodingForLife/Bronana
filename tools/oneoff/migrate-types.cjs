/* =========================================================
   migrate-types.js — 一次性迁移脚本（机械改动，可重复执行）
   把各模块的 "var X = {}" 模块对象标注成对应的接口类型，
   否则 TS 把它们推断成 {}，后面所有 X.prop = ... 都会报错。
   用法： node tools/migrate-types.cjs
   ========================================================= */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

/** 单行形式的模块对象：直接加 as 断言 */
const ONE_LINE = [
  ['utils.ts', 'var U = {};', 'var U = {} as UtilsApi;'],
  ['draw2d.ts', 'var D = {};', 'var D = {} as DrawApi;'],
  ['sprites.ts', 'var S = {};', 'var S = {} as SpritesApi;'],
  ['emit.ts', 'var Emit = {};', 'var Emit = {} as EmitApi;'],
  ['arena.ts', 'var Arena = {};', 'var Arena = {} as ArenaApi;'],
  ['data_weapons.ts', 'var W = {};', 'var W = {} as WeaponsApi;'],
  ['data_items.ts', 'var I = {};', 'var I = {} as ItemsApi;'],
  ['data_chars.ts', 'var C = {};', 'var C = {} as CharsApi;'],
  ['enemies.ts', 'var E = {};', 'var E = {} as EnemiesApi;']
];

/** 多行对象字面量：用括号包裹并加断言 —— 需要配平花括号 */
const BLOCK = [
  ['game.ts', 'var Game = {', 'GameApi'],
  ['render.ts', 'var R = {', 'RenderApi'],
  ['stats.ts', 'var Stats = {', 'StatsApi'],
  ['input.ts', 'var Input = {', 'InputApi'],
  ['audio.ts', 'var Sfx = {', 'SfxApi'],
  ['ui.ts', 'var UI = {', 'UIApi']
];

function findLiteralEnd(src, startIdx) {
  // startIdx 指向 "{"
  let depth = 0;
  for (let i = startIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;      // 返回闭合花括号的下标
    }
  }
  return -1;
}

let changed = 0;
for (const [file, from, to] of ONE_LINE) {
  const p = path.join(SRC, file);
  let s = fs.readFileSync(p, 'utf8');
  if (s.indexOf(to) >= 0) continue;                 // 已迁移
  if (s.indexOf(from) < 0) { console.log('  跳过（未找到）：' + file + ' ' + from); continue; }
  s = s.replace(from, to);
  fs.writeFileSync(p, s);
  changed++;
  console.log('  ' + file.padEnd(18) + ' 单行对象 → ' + to.replace('var ' + from.split(' ')[1] + ' = ', ''));
}

for (const [file, open, typeName] of BLOCK) {
  const p = path.join(SRC, file);
  let s = fs.readFileSync(p, 'utf8');
  const marker = open + ' as ' + typeName;
  if (s.indexOf(typeName + ');') >= 0 && s.indexOf(marker) >= 0) continue;
  const at = s.indexOf(open);
  if (at < 0) { console.log('  跳过（未找到）：' + file + ' ' + open); continue; }
  const braceIdx = s.indexOf('{', at);
  const end = findLiteralEnd(s, braceIdx);
  if (end < 0) { console.log('  【花括号未配平】' + file); continue; }
  // 形如： var X = { ... }   →   var X = ({ ... } as XApi)
  const head = s.slice(0, at).length;
  const before = s.slice(0, at);
  const body = s.slice(at + open.length, end);       // 花括号内容（不含 { }）
  const after = s.slice(end + 1);
  // 目标： var X = ({ ... } as XApi)
  const next = before + open.slice(0, -1) + '({' + body + '} as ' + typeName + ')' + after;
  fs.writeFileSync(p, next);
  changed++;
  console.log('  ' + file.padEnd(18) + ' 多行对象 → as ' + typeName);
}

console.log('\n共修改 ' + changed + ' 处');
