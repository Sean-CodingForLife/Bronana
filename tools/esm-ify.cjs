/* =========================================================
   esm-ify.js — 把 "IIFE + 挂 window" 的模块写法改成真正的 ES 模块
   规则：
     1) 摘掉 IIFE 外壳与 'use strict'（ES 模块天然严格）
     2) 删掉 var X = global.X 别名行（含跨行写法）
     3) 删掉文件末尾的 global.X = Y 导出赋值
     4) 剩下所有 global.<名字> 引用改写成模块裸名 / 浏览器全局
     5) 扫描文件里真正用到的模块名，生成 import（放在文件头注释之后）
     6) 末尾统一 export { ... }
   用法： node tools/esm-ify.cjs
   ========================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const SRC = path.resolve(__dirname, '..', 'src');

/** 模块名 → 所在文件（不带扩展名） */
const MOD_FILE = {
  U: 'utils', PAL: 'utils', Perf: 'utils',
  D: 'draw2d', draw2d: 'draw2d',
  Input: 'input',
  Sfx: 'audio',
  Stats: 'stats', CFG: 'stats',
  Weapons: 'data_weapons',
  Items: 'data_items',
  Chars: 'data_chars',
  Enemies: 'enemies',
  Arena: 'arena',
  S: 'sprites', Sprites: 'sprites',
  Emit: 'emit',
  Game: 'game',
  R: 'render',
  UI: 'ui'
};

/** 浏览器 / 宿主全局：不是模块，映射到真实表达式 */
const BROWSER = {
  window: 'window',
  document: 'document',
  location: 'window.location',
  console: 'console',
  performance: 'performance',
  devicePixelRatio: 'window.devicePixelRatio',
  innerWidth: 'window.innerWidth',
  innerHeight: 'window.innerHeight',
  requestAnimationFrame: 'requestAnimationFrame',
  setTimeout: 'setTimeout',
  clearTimeout: 'clearTimeout',
  AudioContext: 'window.AudioContext',
  __still: 'globalThis.__still',
  __diag: 'globalThis.__diag'
};

/**
 * 每个文件：
 *   self    — 本文件自己声明的模块对象名（不能从自己 import）
 *   exports — 文件末尾导出的写法
 */
const FILES = {
  'utils.ts':        { self: ['U', 'PAL', 'Perf'], exports: ['U', 'PAL', 'Perf'] },
  'draw2d.ts':       { self: ['D'], exports: ['D', 'D as draw2d'] },
  'input.ts':        { self: ['Input'], exports: ['Input'] },
  'audio.ts':        { self: ['Sfx'], exports: ['Sfx'] },
  'stats.ts':        { self: ['Stats', 'CFG'], exports: ['Stats', 'CFG'] },
  'data_weapons.ts': { self: ['W', 'Weapons'], exports: ['W as Weapons'] },
  'data_items.ts':   { self: ['I', 'Items'], exports: ['I as Items'] },
  'data_chars.ts':   { self: ['C', 'Chars'], exports: ['C as Chars'] },
  'enemies.ts':      { self: ['E', 'Enemies'], exports: ['E as Enemies'] },
  'arena.ts':        { self: ['Arena'], exports: ['Arena'] },
  'sprites.ts':      { self: ['S', 'Sprites'], exports: ['S', 'S as Sprites'] },
  'emit.ts':         { self: ['Emit'], exports: ['Emit'] },
  'game.ts':         { self: ['Game'], exports: ['Game'] },
  'render.ts':       { self: ['R'], exports: ['R'] },
  'ui.ts':           { self: ['UI'], exports: ['UI'] },
  'main.ts':         { self: [], exports: [] }
};

/* ---------------- 逐文件定点修补 ---------------- */
const FIXUPS = {
  'utils.ts': [
    // PAL 是一大张色表，本身带一堆未在 Palette 里逐条列出的键（HP/CREAM/PAPER…）。
    // 加上类型标注，导出的才是带索引签名的 Palette，而不是字面量类型。
    [/^([ \t]*)var PAL = \{/m, '$1var PAL: Palette = {']
  ],
  'stats.ts': [
    // CFG 原本是"全局上就地补一个共享配置对象"，改成模块自己的常量
    [/^[ \t]*global\.CFG = global\.CFG \|\| \(\{ moveSpeedPerPoint: 8 \} as CfgApi\);[ \t]*\r?\n/gm,
      '  var CFG = ({ moveSpeedPerPoint: 8 } as CfgApi);\n'],
    [/^[ \t]*global\.CFG\.moveSpeedPerPoint = 8;[ \t]*\r?\n/gm, '']
  ],
  'main.ts': [
    // 模块顶层不允许 return：改成"只在有 DOM 的宿主里启动"
    [/^[ \t]*if \(typeof document === 'undefined'\) return;[^\n]*\r?\n\r?\n?/m, ''],
    [/^([ \t]*)if \(document\.readyState === 'loading'\) \{\r?\n([ \t]*)document\.addEventListener\('DOMContentLoaded', boot\);\r?\n[ \t]*\} else \{\r?\n[ \t]*boot\(\);\r?\n[ \t]*\}/m,
      '$1if (typeof document !== \'undefined\') {\n' +
      '$1  if (document.readyState === \'loading\') {\n' +
      '$1    document.addEventListener(\'DOMContentLoaded\', boot);\n' +
      '$1  } else {\n' +
      '$1    boot();\n' +
      '$1  }\n' +
      '$1}']
  ]
};

/**
 * 去掉注释与字符串字面量，只留代码骨架。
 * 用途：判断"某个模块名是否真的被引用"。
 * 中文注释里出现 UI / R / S 这类单词是常态，直接拿全文扫描会造出一堆假导入。
 */
function codeOnly(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let state = 'code';
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (state === 'code') {
      if (c === '/' && d === '*') { state = 'block'; i += 2; out += '  '; continue; }
      if (c === '/' && d === '/') { state = 'line'; i += 2; out += '  '; continue; }
      if (c === "'" || c === '"' || c === '`') { state = c; i++; out += ' '; continue; }
      out += c; i++; continue;
    }
    if (state === 'block') {
      if (c === '*' && d === '/') { state = 'code'; i += 2; out += '  '; continue; }
      out += (c === '\n' ? '\n' : ' '); i++; continue;
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += '\n'; i++; continue; }
      out += ' '; i++; continue;
    }
    if (c === '\\') { out += '  '; i += 2; continue; }
    if (c === state) { state = 'code'; out += ' '; i++; continue; }
    out += (c === '\n' ? '\n' : ' '); i++;
  }
  return out;
}

/** 去掉 IIFE 留下的两格缩进，让顶层声明重新落在列 0 */
function dedent(body) {
  return body.split('\n').map(l => (l.slice(0, 2) === '  ' ? l.slice(2) : l)).join('\n');
}

/** 收集文件顶层声明的名字（列 0 起头的 var/let/const/function/class） */
function topLevelDecls(body) {
  const names = new Set();
  const stmtRe = /^(var|let|const|function|class)\s+([\s\S]*?)(?:;|\r?\n(?=\S)|$)/gm;
  let m;
  while ((m = stmtRe.exec(body))) {
    // 只取声明段的左侧标识符（到第一个 = 之前的逗号分隔项）
    const decl = m[2].split('=')[0];
    for (const part of decl.split(',')) {
      const id = part.trim().match(/^([A-Za-z_$][\w$]*)/);
      if (id) names.add(id[1]);
    }
    // 跨行 var 的续行（形如 "    Weapons = global.Weapons,"）也收进来
    const rest = m[0];
    const contRe = /(?:^|\n)[ \t]+([A-Za-z_$][\w$]*)\s*=/g;
    let c;
    while ((c = contRe.exec(rest))) names.add(c[1]);
  }
  return names;
}

const report = [];
let changed = 0;

for (const [file, meta] of Object.entries(FILES)) {
  const p = path.join(SRC, file);
  let s = fs.readFileSync(p, 'utf8');
  if (s.indexOf('(function (global)') < 0) { console.log('  跳过（已是 ESM）：' + file); continue; }

  // ---- 定点修补（在通用改写之前） ----
  for (const [re, to] of (FIXUPS[file] || [])) {
    if (!re.test(s)) console.log('  【补丁未命中】' + file + ' → ' + re);
    s = s.replace(re, to);
  }

  // ---- 1) 摘掉 IIFE 外壳 ----
  const head = /\(function \(global\) \{\r?\n[ \t]*'use strict';\r?\n\r?\n?/;
  const tail = /\r?\n\}\)\(typeof window !== 'undefined' \? window : globalThis\);[ \t]*\r?\n?$/;
  if (!head.test(s)) console.log('  【IIFE 头未命中】' + file);
  if (!tail.test(s)) console.log('  【IIFE 尾未命中】' + file);
  s = dedent(s.replace(head, '').replace(tail, '\n'));

  // ---- 2) 删掉纯别名行（含跨行） ----
  // 注意：必须是"左右同名"的别名（var U = global.U）才能整条删掉。
  // 形如 var w = global.innerWidth, h = global.innerHeight; 是把浏览器全局
  // 取到本地短名，属于真实声明，删掉会让后面的代码找不到 w/h。
  s = s.replace(
    /^[ \t]*var\s+([A-Za-z_$][\w$]*\s*=\s*global\.[A-Za-z_$][\w$]*)(?:\s*,\s*[A-Za-z_$][\w$]*\s*=\s*global\.[A-Za-z_$][\w$]*)*\s*;[ \t]*\r?\n/gm,
    (stmt) => {
      const kept = stmt.trim().replace(/;\s*$/, '').replace(/^var\s+/, '').split(',')
        .map(c => c.trim())
        .filter(c => {
          const m = /^([A-Za-z_$][\w$]*)\s*=\s*global\.([A-Za-z_$][\w$]*)$/.exec(c);
          return !(m && m[1] === m[2]);
        });
      return kept.length ? 'var ' + kept.join(', ') + ';\n' : '';
    });

  // ---- 3) 删掉导出赋值 global.X = Y; ----
  s = s.replace(/^[ \t]*global\.[A-Za-z_$][\w$]*\s*=\s*[A-Za-z_$][\w$]*;[ \t]*\r?\n/gm, '');

  // ---- 4) 剩下的 global.<名字> 全部改写 ----
  const unknown = new Set();
  s = s.replace(/global\.([A-Za-z_$][\w$]*)/g, (whole, name) => {
    if (MOD_FILE[name]) return name;
    if (BROWSER[name]) return BROWSER[name];
    unknown.add(name);
    return whole;
  });

  // ---- 5) 扫出真正用到的模块，生成 import ----
  const decls = topLevelDecls(s);
  const code = codeOnly(s);
  const needed = new Map();          // file -> Set(names)
  for (const name of Object.keys(MOD_FILE)) {
    const from = MOD_FILE[name];
    if (from === file.replace(/\.ts$/, '')) continue;     // 自己
    if (meta.self.indexOf(name) >= 0) continue;           // 自己的模块对象
    if (decls.has(name)) continue;                        // 顶层同名变量（如 emit/game 里的会话 S）
    // 函数体内还可能有同名局部变量（sprites.js 里的 var R = 26 * sc 就是）
    // 一律不导入，宁可由 tsc 报 "Cannot find name" 再补，也不要造出假依赖 / 循环依赖
    if (new RegExp('\\b(?:var|let|const|function|class)\\s+' + name + '\\b').test(code)) continue;
    if (!new RegExp('(?<![\\w$.])' + name + '\\b').test(code)) continue;
    if (!needed.has(from)) needed.set(from, new Set());
    needed.get(from).add(name);
  }
  const importLines = [...needed.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([f, names]) => "import { " + [...names].sort().join(', ') + " } from './" + f + ".ts';")
    .join('\n');

  // ---- 6) 拼装：import 插在文件头注释之后，export 放最后 ----
  s = s.replace(/[ \t]+$/, '');
  // 头部注释跟着 dedent 一起缩进错位，这里把首块注释恢复成顶格
  s = s.replace(/^\/\*[\s\S]*?\*\//, m => m.replace(/^ +/gm, ''));
  const cm = s.match(/^\/\*[\s\S]*?\*\/\r?\n/);
  if (importLines) {
    if (cm) s = cm[0] + '\n' + importLines + '\n' + s.slice(cm[0].length);
    else s = importLines + '\n\n' + s;
  }
  const exportLine = meta.exports.length ? '\n\nexport { ' + meta.exports.join(', ') + ' };\n' : '\n';
  s = s.replace(/\s*$/, '') + exportLine;

  fs.writeFileSync(p, s);
  changed++;
  report.push({
    file: file,
    imports: [...needed.entries()].map(([f, n]) => f + ':' + [...n].join('/')).join(' ') || '（无）',
    exports: meta.exports.join(', ') || '（无）',
    unknown: [...unknown].join(', ')
  });
}

console.log('\n共转换 ' + changed + ' 个文件\n');
for (const r of report) {
  console.log('  ' + r.file.padEnd(17) + 'import  ' + r.imports);
  console.log('  ' + ' '.repeat(17) + 'export  ' + r.exports +
    (r.unknown ? '   【未知全局】' + r.unknown : ''));
}
