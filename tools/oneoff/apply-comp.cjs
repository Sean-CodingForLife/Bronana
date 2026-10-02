/* =========================================================
   apply-comp.cjs — 把各处的"手写对象字面量"改成 Comp.spawn(原型, 覆盖)
   一次性脚本（迁移用）。每个锚点都必须命中，否则直接抛错并列出全部
   未命中项 —— 静默跳过才是迁移脚本最危险的失败方式。
   用法： node tools/apply-comp.cjs
   ========================================================= */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const misses = [];
let edits = 0;

function patch(rel, pairs) {
  const p = path.join(ROOT, rel);
  let s = fs.readFileSync(p, 'utf8');
  for (const [from, to, label] of pairs) {
    const at = s.indexOf(from);
    if (at < 0) { misses.push(rel + '  ←  ' + (label || from.slice(0, 60))); continue; }
    if (s.indexOf(from, at + 1) >= 0) {
      misses.push(rel + '  ← 锚点不唯一：' + (label || from.slice(0, 60)));
      continue;
    }
    s = s.slice(0, at) + to + s.slice(at + from.length);
    edits++;
  }
  fs.writeFileSync(p, s);
}

/* ---------------- 1. comp.ts：倒序遍历 + 飘字判据 + offer 原型 ---------------- */
patch('src/comp.ts', [
  [
    "Comp.system = function (name, need, fn) {\n  if (SYSTEMS[name]) throw new Error('comp: 系统重名 ' + name);",
    "Comp.system = function (name, need, fn, opts) {\n  if (SYSTEMS[name]) throw new Error('comp: 系统重名 ' + name);\n  opts = opts || {};",
    'system 增加 opts'
  ],
  [
    "  SYSTEMS[name] = { name: name, need: need.slice(), fn: fn, _checked: false };",
    "  SYSTEMS[name] = { name: name, need: need.slice(), fn: fn, _checked: false, back: !!opts.back };",
    'system 记录 back'
  ],
  [
    "  var done = 0;\n  for (var k = 0; k < n; k++) {\n    if (sys.fn(list[k], dt, ctx) !== false) done++;\n  }\n  return done;",
    "  if (!ctx) ctx = sys._ctx || (sys._ctx = {});\n  var done = 0, k;\n  if (sys.back) {\n" +
    "    // 倒序 + 交换删除的集合必须倒着遍历（正序会把被搬到空位的元素跳过）\n" +
    "    for (k = n - 1; k >= 0; k--) {\n      ctx.i = k;\n      if (sys.fn(list[k], dt, ctx) !== false) done++;\n    }\n" +
    "  } else {\n    for (k = 0; k < n; k++) {\n      ctx.i = k;\n      if (sys.fn(list[k], dt, ctx) !== false) done++;\n    }\n  }\n  return done;",
    'run 支持倒序 + ctx.i'
  ],
  [
    "  if (p.life <= 0) { ctx.remove(p); return false; }",
    "  if (p.life <= 0) { ctx.remove(ctx.i); return false; }",
    'remove 传下标'
  ],
  [
    "  if (p.text) p.vy += 60 * dt;     // 飘字受重力\n  return true;\n});",
    "  if (p.kind === 'text') p.vy += 60 * dt;   // 飘字受重力\n  return true;\n}, { back: true });",
    'particleStep 倒序'
  ],
  [
    "Comp.define('BulletExtra', { element: '', knock: 0, blast: 0 });",
    "Comp.define('BulletExtra', { element: '', knock: 0, blast: 0 });\nComp.define('OfferCore', { type: '', def: null, sold: false, price: 0 });",
    'OfferCore 组件'
  ],
  [
    "Comp.archetype('item',\n  ['ItemCore'],",
    "Comp.archetype('offer',\n  ['OfferCore'],\n  { list: 'offers' });\n\nComp.archetype('item',\n  ['ItemCore'],",
    'offer 原型'
  ]
]);

/* ---------------- 2. types.d.ts：组件系统的类型 ---------------- */
patch('src/types.d.ts', [
  [
    '/* ---------------- 宿主注入的调试开关 ----------------',
    `/* ---------------- 组件式组合（comp.ts） ---------------- */
interface CompDef {
  name: string;
  fields: Record<string, any>;
  keys: string[];
  hooks: { reset?: (e: any) => void } | null;
}

interface CompArch {
  name: string;
  comps: string[];
  fields: string[];
  owner: Record<string, string>;
  has: Record<string, boolean>;
  template: Record<string, any>;
  list: string | null;
  note: string;
}

interface CompSystem {
  name: string;
  need: string[];
  fn: (e: any, dt: number, ctx: any) => boolean | void;
  _checked: boolean;
  back?: boolean;
  _ctx?: any;
}

interface CompApi {
  define(name: string, fields: Record<string, any>, hooks?: any): CompDef;
  defineComponent(name: string, fields: Record<string, any>, hooks?: any): CompDef;
  hasComponent(name: string): boolean;
  components(): string[];
  componentKeys(name: string): string[] | null;
  componentHooks(name: string): any;
  archetype(name: string, comps: string[], opts?: { list?: string; note?: string }): CompArch;
  defineArchetype(name: string, comps: string[], opts?: { list?: string; note?: string }): CompArch;
  hasArchetype(name: string): boolean;
  archetypes(): string[];
  archetypeInfo(name: string): { name: string; comps: string[]; fields: string[]; list: string | null; note: string } | null;
  spawn(name: string, overrides?: Record<string, any>): any;
  assign(e: any, overrides: Record<string, any>): any;
  archOf(e: any): string | null;
  has(e: any, comp: string): boolean;
  unknownFields(e: any): string[] | null;
  audit(e: any): { arch: string | null; unknown: string[]; missing: string[] };
  selfCheck(): string[];
  query(sess: any, archName: string): any[];
  system(name: string, need: string[], fn: (e: any, dt: number, ctx: any) => any, opts?: { back?: boolean }): CompSystem;
  systems(): string[];
  systemInfo(name: string): { name: string; need: string[] } | null;
  run(name: string, list: any[], dt: number, ctx?: any): number;
  stats(): { components: number; archetypes: number; systems: number };
}

/* ---------------- 宿主注入的调试开关 ----------------`,
    'CompApi 类型'
  ]
]);

/* ---------------- 3. game.ts ---------------- */
patch('src/game.ts', [
  ["import { Sfx } from './audio.ts';",
    "import { Sfx } from './audio.ts';\nimport { Comp } from './comp.ts';", 'import Comp'],

  // 玩家
  [`  var p: Player = {
    charDef: charDef,
    x: Arena.W / 2, y: Arena.H / 2,
    vx: 0, vy: 0,
    r: 20,
    face: 1,
    animT: 0, moveBlend: 0, moving: false,
    base: Stats.base(),
    upgrades: Stats.empty(),
    items: [],
    weapons: [],
    hp: 0, invuln: 0, hitFlash: 0,
    level: 1, xp: 0, xpNeed: Stats.xpNeeded(1),
    pendingLevels: 0,
    aim: 0, hurtFlash: 0,
    rage: 0
  };`,
    `  // 玩家也走原型：字段由组件声明，不再手写字面量
  var p: Player = Comp.spawn('player', {
    charDef: charDef,
    x: Arena.W / 2, y: Arena.H / 2,
    r: 20,
    face: 1,
    base: Stats.base(),
    upgrades: Stats.empty(),
    xpNeed: Stats.xpNeeded(1)
  });`, '玩家原型'],

  // 炮塔
  [`    S.turrets.push({
      x: p.x + Math.cos(ang) * 90, y: p.y + Math.sin(ang) * 90,
      hp: 40 + S.stats.engineering * 3, maxHp: 40 + S.stats.engineering * 3,
      cd: 0, aim: 0, muzzle: 0, r: 18
    });`,
    `    S.turrets.push(Comp.spawn('turret', {
      x: p.x + Math.cos(ang) * 90, y: p.y + Math.sin(ang) * 90,
      hp: 40 + S.stats.engineering * 3, maxHp: 40 + S.stats.engineering * 3,
      r: 18
    }));`, '炮塔原型'],

  // 商店货架
  ["    offers.push({ type: 'weapon', def: def, sold: false, price: Weapons.priceOf(def, S.stats.luck) });",
    "    offers.push(Comp.spawn('offer', { type: 'weapon', def: def, price: Weapons.priceOf(def, S.stats.luck) }));", 'offer(weapon)'],
  ["    offers.push({ type: 'item', def: d, sold: false, price: Items.priceOf(d, S.stats.luck) });",
    "    offers.push(Comp.spawn('offer', { type: 'item', def: d, price: Items.priceOf(d, S.stats.luck) }));", 'offer(item)'],

  // 道具实例
  ['  p.items.push({ def: def });', "  p.items.push(Comp.spawn('item', { def: def }));", 'item(pack)'],
  ['    p.items.push({ def: o.def });', "    p.items.push(Comp.spawn('item', { def: o.def }));", 'item(buy)'],

  // 血迹贴花：原来 d = {} 之后再逐字段赋值（隐藏类会分叉）
  ['    d = {};', "    d = Comp.spawn('decal');", 'decal'],

  // 掉落
  [`    S.pickups.push({
      kind: 'mat', x: e.x, y: e.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
      seed: S.rnd() * 10, value: 1 + (e.elite ? 1 : 0)
    });`,
    `    S.pickups.push(Comp.spawn('pickup', {
      kind: 'mat', x: e.x, y: e.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
      seed: S.rnd() * 10, value: 1 + (e.elite ? 1 : 0)
    }));`, 'pickup(mat)'],
  ["    S.pickups.push({ kind: 'heal', x: e.x, y: e.y, vx: 0, vy: 0, seed: S.rnd() * 10, value: 2 + Math.round(S.stats.maxHp * 0.06) });",
    "    S.pickups.push(Comp.spawn('pickup', { kind: 'heal', x: e.x, y: e.y, seed: S.rnd() * 10, value: 2 + Math.round(S.stats.maxHp * 0.06) }));", 'pickup(heal)'],

  // 怪物
  ['  var e = {\n    id: S.nextId++,', "  var e = Comp.spawn('enemy', {\n    id: S.nextId++,", 'enemy 头'],
  ['    spawnT: 0.35,\n    _shockTag: -1\n  };', '    spawnT: 0.35,\n    _shockTag: -1\n  });', 'enemy 尾'],

  // 玩家子弹（开火）
  ['      var b = {\n        x: wx + Math.cos(ang) * 12,', "      var b = Comp.spawn('bullet', {\n        x: wx + Math.cos(ang) * 12,", 'bullet 头'],
  ['      };\n      if (b.pierce > 0) b.hitSet = [];', '      });\n      if (b.pierce > 0) b.hitSet = [];', 'bullet 尾'],

  // 炮塔子弹
  [`    S.bullets.push({
      x: t.x, y: t.y, vx: Math.cos(t.aim) * spd, vy: Math.sin(t.aim) * spd,
      r: 5, dmg: dmg, pierce: 0, hitSet: null, life: 1.2, lifeMax: 1.2,
      color: PAL.STEEL, dark: PAL.DARK, kind: 'shot', knock: 26, blast: 0,
      fromX: t.x, fromY: t.y
    });`,
    `    S.bullets.push(Comp.spawn('bullet', {
      x: t.x, y: t.y, vx: Math.cos(t.aim) * spd, vy: Math.sin(t.aim) * spd,
      r: 5, dmg: dmg, life: 1.2, lifeMax: 1.2,
      color: PAL.STEEL, dark: PAL.DARK, kind: 'shot', knock: 26,
      fromX: t.x, fromY: t.y
    }));`, 'bullet(炮塔)'],

  // 敌人子弹
  [`  S.ebullets.push({
    x: e.x + Math.cos(a) * (e.r + 4),
    y: e.y + Math.sin(a) * (e.r + 4),
    vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
    r: e.def.boss ? 10 : 7,
    dmg: (def.projDmg || 3) * Enemies.dmgScale(Game.wave) * (e.elite ? ELITE_DMG : 1),
    color: def.projColor || PAL.E2,
    life: 3.2, kind: boss ? 'bossball' : 'ball'
  });`,
    `  S.ebullets.push(Comp.spawn('ebullet', {
    x: e.x + Math.cos(a) * (e.r + 4),
    y: e.y + Math.sin(a) * (e.r + 4),
    vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
    r: e.def.boss ? 10 : 7,
    dmg: (def.projDmg || 3) * Enemies.dmgScale(Game.wave) * (e.elite ? ELITE_DMG : 1),
    color: def.projColor || PAL.E2,
    life: 3.2, kind: boss ? 'bossball' : 'ball'
  }));`, 'ebullet']
]);

/* ---------------- 4. data_weapons.ts：武器实例 ---------------- */
patch('src/data_weapons.ts', [
  ["import { U } from './utils.ts';", "import { Comp } from './comp.ts';\nimport { U } from './utils.ts';", 'import Comp'],
  [`  return {
    id: def.id,
    def: def,
    cd: 0,
    swing: 0,       // 近战挥击动画进度 1→0
    swingDir: 1,
    flash: 0
  };`,
    `  // index / dup / wx / wy / ang 以前是"用到才挂上去"，会让同类型武器形状分叉；
  // 现在全部由 WeaponCore + Seat 组件声明，出生即齐全
  return Comp.spawn('weapon', { id: def.id, def: def });`, '武器原型']
]);

/* ---------------- 5. emit.ts：粒子由原型产出 + 步进走系统 ---------------- */
patch('src/emit.ts', [
  ["import { U } from './utils.ts';", "import { Comp } from './comp.ts';\nimport { U } from './utils.ts';", 'import Comp'],
  ["    function () { return resetVis({}); }, resetVis);",
    "    function () { return Comp.spawn('particle'); }, resetVis);", '粒子工厂'],
  ["    function () { return resetText({}); }, resetText);",
    "    function () { return Comp.spawn('particle'); }, resetText);", '飘字工厂'],
  [`  function stepList(list, free, dt) {
    // 倒序遍历 + 交换移除：已处理过的末尾元素被搬到空位，不会漏更新
    for (var i = list.length - 1; i >= 0; i--) {
      var p = list[i];
      p.life -= dt;
      if (p.life <= 0) { removeSwap(list, i, free); continue; }
      if (p.vx !== undefined) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.drag) {
          p.vx *= Math.max(0, 1 - dt * p.drag);
          p.vy *= Math.max(0, 1 - dt * p.drag);
        }
        if (p.kind === 'text') p.vy += 60 * dt;
      }
    }
  }`,
    `  // 步进逻辑登记为组件系统（comp.ts 的 particleStep）：
  // "它需要 Lifetime + Motion"从此是被校验的声明，而不是注释。
  var STEP_CTX = {
    list: null as any[], free: null as any[],
    i: 0,
    remove: function (i) { removeSwap(STEP_CTX.list, i, STEP_CTX.free); }
  };
  function stepList(list, free, dt) {
    if (!list.length) return;
    STEP_CTX.list = list; STEP_CTX.free = free;
    Comp.run('particleStep', list, dt, STEP_CTX);
  }`, 'stepList → 系统']
]);

/* ---------------- 6. 测试装配 ---------------- */
patch('test/_load.mjs', [
  ["  utils:   '../src/utils.ts',", "  utils:   '../src/utils.ts',\n  comp:    '../src/comp.ts',", 'comp 模块'],
  ["  'utils', 'draw2d', 'input', 'audio', 'stats', 'weapons', 'items',",
    "  'utils', 'comp', 'draw2d', 'input', 'audio', 'stats', 'weapons', 'items',", 'SIM 列表']
]);

patch('test/run-all.mjs', [
  ["  ['模拟层 / 战斗循环', 'smoke.mjs'],",
    "  ['模拟层 / 战斗循环', 'smoke.mjs'],\n  ['组件系统 / 组合与校验', 'comp.mjs'],", '新套件']
]);

/* ---------------- 汇总 ---------------- */
console.log('已应用 ' + edits + ' 处改动');
if (misses.length) {
  console.log('\n\x1b[31m有 ' + misses.length + ' 处锚点未命中：\x1b[0m');
  for (const m of misses) console.log('  ' + m);
  process.exit(1);
}
console.log('\x1b[32m全部锚点命中 ✔\x1b[0m');
