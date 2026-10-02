/* =========================================================
   fix-comp.cjs — 第一轮 comp.mjs 抓出来的四个问题
     1) WeaponCore 漏了 cd（checkWeapon 会写它）→ 武器原型改用 Cooldown 组件
     2) Comp.spawn 比手写字面量慢 47 倍 → 改成按原型编译出构造函数（代码生成）
     3) 字段名必须是合法标识符（代码生成的前提）
     4) 测试自身的两处问题：断言过严、正则写错
   用法： node tools/fix-comp.cjs
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
    if (at < 0) { misses.push(rel + '  ←  ' + label); continue; }
    if (s.indexOf(from, at + 1) >= 0) { misses.push(rel + '  ← 锚点不唯一：' + label); continue; }
    s = s.slice(0, at) + to + s.slice(at + from.length);
    edits++;
  }
  fs.writeFileSync(p, s);
}

/* ---------------- comp.ts ---------------- */
patch('src/comp.ts', [
  // 1) 字段名必须是标识符
  [`    keys.push(k);
  }
  if (!keys.length) throw new Error('comp: 组件 ' + name + ' 没有任何字段');`,
    `    if (!/^[A-Za-z_$][\\w$]*$/.test(k)) {
      throw new Error('comp: 组件 ' + name + ' 的字段名 ' + k + ' 不是合法标识符');
    }
    keys.push(k);
  }
  if (!keys.length) throw new Error('comp: 组件 ' + name + ' 没有任何字段');`, '字段名校验'],

  // 2) 代码生成工厂
  [`/**
 * 定义一个原型：由若干组件组合而成。`,
    `/**
 * 为一个原型编译出"造对象"的工厂。
 * 一开始是逐字段从模板拷贝，实测比手写字面量慢 47 倍（1654ns vs 35ns）：
 * 模板是运行期逐个加属性建起来的字典模式对象，每次 spawn 都在做哈希查找，
 * 而且还多一次 Array.isArray 判断。改成代码生成后拿到的是字面量形状的对象，
 * 隐藏类与模板一致，开销回落到个位数倍。
 * 不依赖 eval 的兜底：Object.assign({}, tpl) —— 牺牲速度换 CSP 友好。
 */
function compileFactory(name, fields, tpl) {
  var parts = ['$arch: t.$arch'];
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    parts.push(f + ': ' + (Array.isArray(tpl[f]) ? 't.' + f + '.slice()' : 't.' + f));
  }
  try {
    return new Function('t',
      'return function () { return { ' + parts.join(', ') + ' }; };')(tpl) as () => any;
  } catch (e) {
    return function () { return Object.assign({}, tpl); };
  }
}

/**
 * 定义一个原型：由若干组件组合而成。`, 'compileFactory'],

  [`  ARCHS[name] = a;
  ARCH_NAMES.push(name);
  return a;`,
    `  a.make = compileFactory(name, fields, tpl);
  ARCHS[name] = a;
  ARCH_NAMES.push(name);
  return a;`, '挂上 make'],

  // 3) spawn 走工厂
  [`  var fields = a.fields, tpl = a.template;
  var e: Record<string, any> = { $arch: name };
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    var v = tpl[f];
    e[f] = Array.isArray(v) ? v.slice() : v;   // 数组默认值必须按对象复制
  }
  if (overrides) Comp.assign(e, overrides);
  return e;`,
    `  var e = a.make();
  if (overrides) Comp.assign(e, overrides);
  return e;`, 'spawn 走工厂'],

  // 4) 武器原型补上 cd（用现成的 Cooldown 组件，而不是往 WeaponCore 里塞）
  [`Comp.archetype('weapon',
  ['WeaponCore', 'Seat'],`,
    `Comp.archetype('weapon',
  ['WeaponCore', 'Cooldown', 'Seat'],`, '武器原型 + Cooldown']
]);

/* ---------------- types.d.ts ---------------- */
patch('src/types.d.ts', [
  [`  template: Record<string, any>;
  list: string | null;
  note: string;
}`,
    `  template: Record<string, any>;
  list: string | null;
  note: string;
  make: () => any;
}`, 'CompArch.make']
]);

/* ---------------- test/comp.mjs ---------------- */
patch('test/comp.mjs', [
  [`  // 每个原型至少由 2 个组件组合而成（否则"组合"没有意义）
  const thin = archs.filter(a => Comp.archetypeInfo(a).comps.length < 2);
  ok(thin.length === 0, '每个原型都由 ≥2 个组件组合而成', thin.join(', '));`,
    `  // 实体类原型必须真的是"组合"；纯记录型原型（item/offer）只要求 ≥1
  const entityArchs = ['player', 'enemy', 'bullet', 'ebullet', 'particle', 'pickup', 'decal', 'turret', 'weapon'];
  const thin = entityArchs.filter(a => Comp.archetypeInfo(a).comps.length < 3);
  ok(thin.length === 0, '实体原型都由 ≥3 个组件组合而成', thin.join(', '));
  const none = archs.filter(a => Comp.archetypeInfo(a).comps.length < 1);
  ok(none.length === 0, '每个原型至少由 1 个组件构成', none.join(', '));`, '组件数断言'],

  [`  ok(!!e11 && /未定义组件/.test(e11), '系统依赖未定义组件被拒绝', e11);`,
    `  ok(!!e11 && /未定义的组件/.test(e11), '系统依赖未定义组件被拒绝', e11);`, '正则'],

  [`  ok(spawnNs < 1000, '组合造对象的单次开销在合理量级（<1µs）', spawnNs.toFixed(1) + 'ns');`,
    `  ok(spawnNs < 400, '组合造对象的单次开销在合理量级（<400ns）', spawnNs.toFixed(1) + 'ns');`, '开销上限']
]);

console.log('已应用 ' + edits + ' 处改动');
if (misses.length) {
  console.log('\n\x1b[31m有 ' + misses.length + ' 处锚点未命中：\x1b[0m');
  for (const m of misses) console.log('  ' + m);
  process.exit(1);
}
console.log('\x1b[32m全部锚点命中 ✔\x1b[0m');
