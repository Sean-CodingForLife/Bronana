/* =========================================================
   data-contract.mjs — **数据契约**：数据表上的每个字符串字段，值域都得有人守

   这一套守的是上一轮挖出来的那一类洞，它**结构上抓不到**：

     `CharDef.special` 在数据表里写了一个字符串（`'rage'`），模拟层按它分派，
     而"一共有几种角色机制、哪个机制没人读、拼错一个字母会怎样"——
     没有任何一处能回答。拼错的代价是**那个角色静默变成白板**，
     而选人页上照旧写着它的描述。同类还有 `WeaponDef.element`
     （写错 = 这份武器不吃元素加成、永不触发附带效果，界面却写着"元素：fir"）。

   已有的两条校验都够不到它：
     · `test/registry.mjs` 查的是**家族之间**的引用（某个字段写了值域之外的值）；
       而"这个字段**根本没有**值域"它看不见。
     · `test/arch.mjs` 查模块与分层，不认识数据表上的字段。

   于是这里补上那一问：**每个写成字符串的数据字段，要么有一个家族守着它，
   要么在下面的豁免清单里写明理由。** 漏一个就红。

   三组断言：
     [1] 覆盖：每张表上每个字符串字段都有家族或豁免（含"豁免清单不许过期"）
     [2] 一致：声明的家族必须真的存在；表里用到的值必须真的在家族里
     [3] 有效：往表里注入一个坏值，审计必须报出来（校验不是装饰）

   用法： node test/data-contract.mjs
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { installDom } from './_ctx.mjs';
import { loadAll, SIM_MODULES } from './_load.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
installDom();
const g = globalThis;
await loadAll(SIM_MODULES);

let failures = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  \x1b[32mPASS\x1b[0m ' + label);
  else { failures++; console.log('  \x1b[31mFAIL\x1b[0m ' + label + (extra !== undefined ? '  → ' + extra : '')); }
}

const { Registry, Weapons, Items, Chars, Enemies, Affixes, Elems } = g;
const TSRC = fs.readFileSync(path.join(ROOT, 'src', 'types.d.ts'), 'utf8');

/** 去掉注释：静态契约要在**代码**上查，而不是在散文说明里查
 *  （`game.ts` 的注释里正当地写着"改造前这里是裸比 `charDef.special === 'rage'`"）。 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

console.log('\n=== Bronana · 数据契约（字段 → 家族）===\n');

/* =========================================================
   要守的接口：**逐字**列出"哪些 *Def 是数据契约"
   ---------------------------------------------------------
   为什么不自动发现"所有 *Def"：`SavePayload` / `RecTape` 这类是**存档与协议**
   形状，它们的字符串字段（版本键、命令名）不属于"值域"这个概念 ——
   自动发现会把它们一起拖进来，然后逼出一长串豁免。显式列表更诚实：
   新加一张数据表时，人会看到这里少一条。
   ========================================================= */
const CONTRACTS = ['WeaponDef', 'ItemDef', 'CharDef', 'EnemyDef', 'AffixDef', 'ElementDef'];

/**
 * 豁免：这些字段是字符串，但**不是**值域。
 * 每条都要给理由 —— "文案 / 标识 / 视觉"三类是仅有的合法理由。
 */
const EXEMPT = {
  id: '标识（无原型表 BY_ID 直接查它，没有"合法取值集合"）',
  uid: '标识（与 id 同一个值；跨模块引用用的键）',
  name: '文案', en: '文案', desc: '文案', note: '文案',
  /* `plainNote`：写清"这件为什么可以是纯增益"的一句人话（与 `desc` 同类）。
     它不是值域 —— 它是**豁免名单的书面化**：`plain: true` 必须配一句理由。 */
  plainNote: '文案',
  color: '视觉', dark: '视觉', projColor: '视觉',
  /* 只有 `tint: string` 是**字符串字段**；`tints: string[]` 是它的数组形态，
     由上面那条"数组字段按单数形式判"的规则覆盖（所以这里不写 tints）。
     注意 `cost` / `stats` 这类**结构化表**不在这份清单里：它们的类型不是
     `string` 或字面量联合，扫描不会把它们当字符串字段 —— 它们的值域由自己的
     形状（`ItemCost` / `StatMap`）与各自的声明表（`COST_KINDS`）守着。 */
  tint: '视觉'
};

/**
 * 逐字从 `interface X { … }` 里取"字符串字段"的名字。
 *
 * 两种写法都算：`type: 'melee' | 'ranged'`（字面量联合，值域就写在类型里）
 * 与 `element?: string`（宽松的 string，值域**只能**靠家族守）。
 * 后者才是这一类洞的大头 —— 第一版扫描只认了前者，于是"守住的字段"数出来只有 2 个，
 * 而真相是大部分字符串字段的类型都写着 `string`（那正是它需要家族的原因）。
 */
function stringFieldsOf(iface) {
  const m = new RegExp('interface ' + iface + ' \\{([\\s\\S]*?)\\n\\}').exec(TSRC);
  if (!m) return null;
  const out = new Set();
  for (const line of m[1].split('\n')) {
    // 去掉行内注释（`… ; // 说明` 这种写法很常见），再去掉行尾空白
    const code = line.replace(/\/\/.*$/, '').trim();
    // 一行可以有多个成员（`id: string; name: string;`），所以逐个匹配而不是只取第一个
    for (const mm of code.matchAll(/(?:^|[\s;{])([A-Za-z_]\w*)\??:\s*([^;]*?);/g)) {
      const type = mm[2].trim();
      const isString = type === 'string' || /^'[^']*'(\s*\|\s*'[^']*')*$/.test(type);
      TYPE_OF[iface + '.' + mm[1]] = type;
      if (isString) out.add(mm[1]);
    }
  }
  return [...out].sort();
}
/** `接口.字段` → 它的类型（数组字段的判据；顺带让报告能说清"为什么它算字符串字段"） */
const TYPE_OF = Object.create(null);

/* =========================================================
   [1] 覆盖：每个字符串字段都有家族或豁免
   ========================================================= */
console.log('[1] 覆盖：数据表上的每个字符串字段，值域都有人守');
{
  const fams = Registry.fieldFamilies();
  const unknownIface = CONTRACTS.filter(c => stringFieldsOf(c) === null);
  ok(unknownIface.length === 0, CONTRACTS.length + ' 个数据接口都在 types.d.ts 里找得到', unknownIface.join(','));

  const unguarded = [];
  const usedExempt = new Set();
  const guarded = [];
  for (const c of CONTRACTS) {
    for (const f of stringFieldsOf(c) || []) {
      if (fams[f]) { guarded.push(c + '.' + f + '→' + fams[f].join('/')); continue; }
      /* 豁免的判据有两条，都算"已经解释过"：
         · 字段名在清单里（文案 / 标识 / 视觉）；
         · 它是数组（`tints: string[]`）而它的单数形式在清单里 ——
           `string[]` 是**类型**层面的事实，靠列名字容易漏。 */
      const t = TYPE_OF[c + '.' + f];
      if (EXEMPT[f]) { usedExempt.add(f); continue; }
      if (t === 'string[]' && EXEMPT[f.replace(/s$/, '')]) { usedExempt.add(f); continue; }
      unguarded.push({ iface: c, field: f });
    }
  }
  ok(unguarded.length === 0,
    '每个字符串字段要么有家族要么有豁免（守住的 ' + guarded.length + ' 个·豁免 ' + usedExempt.size + ' 个）',
    unguarded.map(u => u.iface + '.' + u.field).join(', '));

  const stale = Object.keys(EXEMPT).filter(f => !usedExempt.has(f));
  ok(stale.length === 0, '豁免清单里没有过期的条目（豁免了却已经没有那个字段）', stale.join(', '));

  // 至少要有十几条真的在被守 —— 否则这一套是空转
  ok(guarded.length >= 15, '真正被家族守住的数据字段有 ' + guarded.length + ' 个（不是空转）');
}

/* =========================================================
   [2] 一致：家族存在、值在家族里
   ========================================================= */
console.log('\n[2] 一致：声明的家族真实存在，且数据里的值都在里面');
{
  const fams = Registry.fieldFamilies();
  const ghost = [];
  for (const f of Object.keys(fams)) {
    for (const fam of fams[f]) if (!Registry.has(fam)) ghost.push(f + ' → ' + fam);
  }
  ok(ghost.length === 0, '声明的家族都真实登记过（写错家族名不会静默失效）', ghost.join(', '));

  ok(Registry.ids('element').join(',') === Elems.LIST.map(e => e.uid).join(','),
    '元素家族就是元素表本身（' + Elems.LIST.length + ' 种）', Registry.ids('element').join(','));
  ok(Registry.ids('charSpecial').join(',') === Object.keys(Chars.SPECIALS).join(','),
    '角色机制家族就是声明表本身', Registry.ids('charSpecial').join(','));

  // 表里用到的每个值都在它的家族里（这是"值域"这个词的实际含义）
  const probes = [
    ['weapon.element', Weapons.LIST.map(d => d.element), 'element'],
    ['weapon.kind', Weapons.LIST.map(d => d.kind), 'weaponKind'],
    ['weapon.type', Weapons.LIST.map(d => d.type), 'weaponType'],
    ['item.icon', Items.LIST.map(d => d.icon), 'itemIcon'],
    ['item.special', Items.LIST.map(d => d.special), 'itemSpecial'],
    ['item.slot', Items.LIST.map(d => d.slot), 'affixSlot'],
    ['char.special', Chars.LIST.map(d => d.special), 'charSpecial'],
    ['char.tag', Chars.LIST.map(d => d.tag), 'charTag'],
    ['char.face', Chars.LIST.map(d => d.face), 'enemyEye'],
    ['enemy.behavior', Enemies.LIST.map(d => d.behavior), 'aiBehaviour'],
    ['enemy.shape', Enemies.LIST.map(d => d.shape), 'enemyShape'],
    ['affix.family', Affixes.LIST.map(d => d.family), 'affixFamily'],
    ['affix.mod', Affixes.LIST.map(d => d.mod), 'affixMod'],
    ['element.effect', Elems.LIST.map(d => d.effect), 'elementEffect']
  ];
  for (const [label, values, family] of probes) {
    const ids = Registry.ids(family);
    const bad = [...new Set(values.filter(v => v !== undefined && v !== null && v !== '' && ids.indexOf(String(v)) < 0))];
    ok(bad.length === 0, label + ' 的每个值都在 ' + family + ' 里（' + ids.length + ' 个合法值）', bad.join(','));
  }
}

/* =========================================================
   [3] 有效：审计真的能抓到"写错一个字母"
   ========================================================= */
console.log('\n[3] 有效：往表里注入坏值，审计必须报出来（校验不是装饰）');
{
  // 元素：把一把武器的 element 改成不存在的值
  const w = Weapons.LIST.find(d => d.element);
  const keep = w.element;
  w.element = 'fir';
  const a1 = Registry.audit();
  ok(!a1.ok && a1.problems.some(p => p.field === 'element' && p.value === 'fir'),
    '武器写了表外的元素 → 审计报出来（否则这把武器静默不再吃元素加成）',
    a1.problems.slice(0, 2).map(p => p.family + '.' + p.id + '.' + p.field + '=' + p.value).join(' | '));
  w.element = keep;
  ok(Registry.audit().ok, '改回去之后审计重新通过');

  // 角色：把 special 改成不存在的机制名
  const c = Chars.LIST.find(d => d.special);
  const keepS = c.special;
  c.special = 'ragee';
  const a2 = Registry.audit();
  ok(!a2.ok && a2.problems.some(p => p.field === 'special' && p.value === 'ragee'),
    '角色写了表外的机制 → 审计报出来（否则这个角色静默变成白板）',
    a2.problems.slice(0, 2).map(p => p.family + '.' + p.id + '.' + p.field + '=' + p.value).join(' | '));
  // 定义期自检也要抓（启动期把门，而不是只靠测试）
  ok(!Chars.audit().ok, '角色表自己的 audit 也会报（两处都守）');
  c.special = keepS;
  ok(Registry.audit().ok && Chars.audit().ok, '改回去之后两处都重新通过');
}

/* =========================================================
   [4] 读点：声明了机制/元素，就必须有人认领
   ========================================================= */
console.log('\n[4] 读点：机制与元素都被真的认领了');
{
  /* 「谁读它」不是一句注释：`SPECIALS` 的 `read` 指向真实文件，
     而 game.ts 里必须真的出现 `Chars.specialOf(...)`。
     这一条与 `data_items.ts` 的 SPECIALS 同一个套路 —— 声明了没人读 = 界面上写着效果的假话。 */
  const gameSrc = stripComments(fs.readFileSync(path.join(ROOT, 'src', 'game.ts'), 'utf8'));
  for (const k of Object.keys(Chars.SPECIALS)) {
    ok(gameSrc.indexOf("'" + k + "'") >= 0, '角色机制 ' + k + ' 在模拟层有读点', Chars.SPECIALS[k].read);
  }
  const bareChar = /charDef\.special\s*===/.test(gameSrc);
  ok(!bareChar, '模拟层不再裸比 `charDef.special`（一处改名要改全部读点的写法已经消失）');

  for (const e of Elems.LIST.filter(x => x.effect)) {
    ok(gameSrc.indexOf("case '" + e.effect + "'") >= 0,
      '元素 ' + e.id + ' 的附带效果 ' + e.effect + ' 在模拟层被认领');
  }
}

console.log('\n=== 结果 ===');
if (failures === 0) console.log('\x1b[32m全部通过 ✔\x1b[0m');
else console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m');
process.exit(failures ? 1 : 0);
