/* =========================================================
   story.mjs — 剧情（枢纽对话 / 记录碎片 / 结局）

   剧情这种东西最容易出的问题不是"写得不好"，而是**结构性的错**：
     · 台词挂在不存在的东西上（NPC / 条件键拼错 → 永远说不出来）
     · **剧透**：一条没有条件的台词，第一次进城就把底交了
     · 碎片来源对不上（密室给的碎片在表里不存在 → 密室变空房）
     · 结局要求的数量超过游戏能给的上限（永远解锁不了，等于没有）
     · 隐藏结局没有 flag 守卫（白送）

   所以这一套验的是这些性质，不是文案好不好。

   用法： node test/story.mjs
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { loadAll, SIM_MODULES } from './_load.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
let failures = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  \x1b[32mPASS\x1b[0m ' + label);
  else { failures++; console.log('  \x1b[31mFAIL\x1b[0m ' + label + (extra !== undefined ? '  → ' + extra : '')); }
}

await loadAll(SIM_MODULES);
const { Story, Chars, Dungeon, Registry } = globalThis;
console.error = function () { };

console.log('\n=== Bronana · 剧情（枢纽 / 碎片 / 结局） ===\n');

/** 造一个条件上下文：只给需要的字段，其它按 0 */
const ctxOf = (o) => Object.assign({
  runs: 0, wins: 0, floor: 1, fragments: 0, bosses: 0, secrets: 0, endings: 0, flags: {}
}, o || {});

/* ---------------- 1. 表自身 ---------------- */
console.log('[1] 表的结构：台词、碎片、结局都得挂在真东西上');
{
  const a = Story.audit();
  ok(a.ok === true, '定义期自检通过（' + a.counts.npcs + ' NPC / ' + a.counts.lines + ' 台词 / ' +
    a.counts.fragments + ' 碎片 / ' + a.counts.endings + ' 结局）', a.problems.join(' | '));

  // 枢纽 NPC 是对**已有设施**的拟人化 —— 编号对不上就说明剧情在自说自话
  const facilities = ['菌床', '拾荒堆', '钟楼', '图鉴'];
  const roles = Story.NPCS.map(n => n.role);
  ok(roles.every(r => facilities.indexOf(r) >= 0),
    '每位 NPC 的职责都对应一个游戏里已有的东西：' + roles.join('/'), roles.join('/'));
  ok(new Set(roles).size === roles.length, '职责不重复（一位 NPC 一个设施）');

  // 每个 NPC 都有台词，且条件里的键都是合法的
  const KEY = ['runs', 'wins', 'floor', 'fragments', 'bosses', 'secrets', 'endings', 'flag'];
  let badWhen = [];
  for (const l of Story.LINES) {
    for (const k of Object.keys(l.when || {})) if (KEY.indexOf(k) < 0) badWhen.push(l.id + '.' + k);
  }
  ok(badWhen.length === 0, '台词条件只用了合法的键', badWhen.join(','));
  ok(Story.NPCS.every(n => Story.LINES.some(l => l.npc === n.id)), '每个 NPC 至少有一条台词');

  // 角色"过去"必须挂在真实角色上
  const badChar = Story.PASTS.filter(p => !Chars.BY_ID[p.char]).map(p => p.char);
  ok(badChar.length === 0, '每个角色的"过去"都挂在真实角色上', badChar.join(','));
  ok(Story.PASTS.length === Chars.LIST.length,
    '八个角色各有一段过去（' + Story.PASTS.length + '/' + Chars.LIST.length + '）');

  const audit = Registry.audit();
  const probs = audit.problems.filter(p => p.family.indexOf('story') === 0);
  ok(probs.length === 0, 'registry 审计对剧情家族不报错', probs.length);
}

/* ---------------- 2. 不许剧透 ---------------- */
console.log('\n[2] 不许剧透：新档开局不该听到任何"后面才该知道的事"');
{
  const fresh = ctxOf({});
  const said = {};
  let lines = [];
  for (const n of Story.npcsFor(fresh)) lines = lines.concat(Story.linesFor(n.id, fresh, said));
  ok(lines.length === Story.npcsFor(fresh).length,
    '全新档案每位 NPC 只有一句开场白（' + lines.length + ' 位 / ' + lines.length + ' 句）', lines.length);
  ok(new Set(lines.map(l => l.npc)).size === lines.length, '开场白一人一句，没有 NPC 抢话');

  // 深层设定（菌毯/器官/深井）在开局绝不该出现
  const spoilers = ['菌毯', '器官', '深井', '十二片', '第四片'];
  const early = lines.map(l => l.text).join('');
  ok(spoilers.every(s => early.indexOf(s) < 0), '开局台词里没有任何深层设定', early);

  // 台词必须是"说了就不再出现"的（否则枢纽永远停在同一句）
  ok(Story.LINES.filter(l => !l.once).length === 0, '所有台词都是"说过就不再出现"（枢纽有清空进度）');
  ok(Story.hasNews(fresh, said) === true, '新档有话说（枢纽上该有"!"）');

  // 说过之后就不再出现
  const first = lines[0];
  const said2 = {}; said2[first.id] = true;
  const after = Story.linesFor(first.npc, fresh, said2);
  ok(after.every(l => l.id !== first.id), '说过的那条不再出现');
}

/* ---------------- 3. 条件随进度解锁（死亡也推进剧情） ---------------- */
console.log('\n[3] 进度解锁：死亡、层数、Boss、密室、碎片各自解锁不同的台词');
{
  const at = (o) => {
    const c = ctxOf(o), said = {};
    let out = [];
    for (const n of Story.npcsFor(c)) out = out.concat(Story.linesFor(n.id, c, said));
    return out.map(l => l.id);
  };
  const fresh = at({});
  const ran3 = at({ runs: 3 });
  const floor2 = at({ runs: 3, floor: 2 });
  const boss1 = at({ runs: 3, floor: 2, bosses: 1 });
  const frag12 = at({ runs: 9, wins: 1, floor: 4, fragments: 12, bosses: 4, secrets: 2, endings: 4,
    flags: { deepPit: true, keepClocktower: true, sawSecret: true, firstWin: true } });

  ok(ran3.length > fresh.length, '多打几局 → 新台词（' + fresh.length + ' → ' + ran3.length + '）');
  ok(floor2.length > ran3.length, '下到第 2 层 → 新台词（' + ran3.length + ' → ' + floor2.length + '）');
  ok(boss1.length > floor2.length, '打赢一个 Boss → 新台词（' + floor2.length + ' → ' + boss1.length + '）');
  ok(frag12.length > boss1.length, '捡齐碎片 + 通关 → 更多新台词（' + boss1.length + ' → ' + frag12.length + '）');
  ok(frag12.length === Story.LINES.length,
    '走到最后一共能听到全部 ' + Story.LINES.length + ' 条（没有永远取不到的台词）', frag12.length);

  // flag 声明表：**拼错一个字母，台词就永远取不到，而界面上毫无异常** —— 必须结构上守住
  const flagKeys = Object.keys(Story.FLAGS);
  ok(flagKeys.length >= 3, '声明了 ' + flagKeys.length + ' 个剧情 flag：' + flagKeys.join('/'));
  const usedFlags = new Set();
  for (const l of Story.LINES) if (l.when && l.when.flag) usedFlags.add(l.when.flag);
  for (const e of Story.ENDINGS) if (e.when && e.when.flag) usedFlags.add(e.when.flag);
  const undeclared = [...usedFlags].filter(f => flagKeys.indexOf(f) < 0);
  ok(undeclared.length === 0, '台词/结局用到的 flag 全部已声明（没有 typo 就静默失效的那种）',
    undeclared.join(','));
  ok(flagKeys.every(f => usedFlags.has(f)), '每个声明过的 flag 都真的被某条台词用上');
  // 只满足一半 flag 时，那些台词仍然要锁着
  const half = at({ runs: 9, wins: 1, floor: 4, fragments: 12, bosses: 4, flags: { deepPit: true } });
  ok(half.length < Story.LINES.length, 'flag 没凑齐时确实还有台词锁着（flag 是真卫兵）',
    half.length + '/' + Story.LINES.length);

  // 记录官要在捡到第一片碎片之后才出现
  ok(Story.npcsFor(ctxOf({})).length === 3, '开局枢纽里 3 位 NPC（记录官还没来）');
  ok(Story.npcsFor(ctxOf({ fragments: 1 })).length === 4, '捡到第一片碎片 → 记录官出现');
}

/* ---------------- 4. 碎片：来源对得上、12 片不重不漏 ---------------- */
console.log('\n[4] 记录碎片：每一片都有可靠的来源');
{
  ok(Story.FRAGMENTS.length === 12, '12 片记录', Story.FRAGMENTS.length);
  const ids = Story.FRAGMENTS.map(f => f.id);
  ok(new Set(ids).size === ids.length, '碎片 id 不重复');

  // 四个 Boss 各掉一片
  const bossSources = Object.keys(Story.BOSS_FRAGMENT);
  ok(bossSources.length === 4, '4 个 Boss 各对应一片记录：' + bossSources.join('/'), bossSources.length);
  ok(bossSources.every(b => Story.fragment(Story.BOSS_FRAGMENT[b])),
    'Boss 对应的碎片都真实存在');

  // 用"捡"的循环走一遍：把每个来源都捡空，看能不能捡齐 12 片
  const have = [];
  const sources = bossSources.map(b => 'boss:' + b).concat(Object.keys(Story.SOURCE_POOLS));
  let guard = 0;
  while (have.length < 12 && guard++ < 100) {
    let got = false;
    for (const src of sources) {
      const f = Story.fragmentFrom(src, have);
      if (f) { have.push(f); got = true; }
    }
    if (!got) break;
  }
  ok(have.length === 12, '把每个来源都捡空 → 集齐 12 片（实际 ' + have.length + '）', have.length);
  ok(new Set(have).size === 12, '捡的过程中没有重复给同一片');
  ok(Story.fragmentFrom('boss:warden', have) === null, '已经拿过的来源不再给（不会白刷）');
  ok(Story.fragmentFrom('secret', []) === 'f05', '密室按表里的顺序给下一片（不用随机 → 复算不会分叉）');

  // 碎片来源都必须在房型/渠道里有影子（密室、事件、深井、Boss）
  const named = Object.keys(Story.SOURCE_POOLS);
  ok(named.indexOf('secret') >= 0 && named.indexOf('event') >= 0 && named.indexOf('deeppit') >= 0,
    '来源覆盖 密室 / 事件 / 深井：' + named.join('/'), named.join('/'));
  ok(Dungeon.TYPE_BY_ID.secret && Dungeon.TYPE_BY_ID.event,
    '（对照）密室与事件房确实在地牢房型表里 —— 碎片有地方放');
}

/* ---------------- 5. 结局：可解锁的收藏，真结局有卫兵 ---------------- */
console.log('\n[5] 结局：普通结局按进度，真结局必须"藏得住"');
{
  const e0 = Story.endingsFor(ctxOf({}));
  ok(e0.length === 0, '新档没有任何结局', e0.length);
  const e1 = Story.endingsFor(ctxOf({ bosses: 1 }));
  ok(e1.length === 1 && e1[0].id === 'shell', '打赢第一个 Boss → 「破壳」', e1.map(e => e.id).join(','));
  const e3 = Story.endingsFor(ctxOf({ wins: 1 }));
  ok(e3.some(e => e.id === 'wastelord'), '通关 → 「暴君之死」');
  ok(!e3.some(e => e.secret), '通关**不等于**真结局（隐藏那层还得自己找）');

  const near = Story.endingsFor(ctxOf({ wins: 1, fragments: 12 }));
  ok(!near.some(e => e.secret), '集齐 12 片但没下深井 → 真结局仍然锁着（flag 卫兵有效）');
  const truth = Story.endingsFor(ctxOf({ wins: 1, fragments: 12, flags: { deepPit: true } }));
  const secretEnd = truth.filter(e => e.secret);
  ok(secretEnd.length === 1 && secretEnd[0].id === 'letter', '通关 + 12 片 + 下过深井 → 「回信」');
  ok(truth.every((e, i, arr) => i === 0 || e.order >= arr[i - 1].order), '结局按 order 排好（图鉴里按顺序摆）');

  // 结局的阈值不能超过游戏能给的上限（否则永远解锁不了）
  for (const e of Story.ENDINGS) {
    if (e.when.bosses !== undefined) {
      ok(e.when.bosses <= 4, '结局「' + e.name + '」要求的 Boss 数 ≤ 4', e.when.bosses);
    }
  }
}

/* ---------------- 6. 接线契约（剧情不进模拟层） ---------------- */
console.log('\n[6] 接线契约：剧情不碰模拟层');
{
  const storySrc = fs.readFileSync(path.join(ROOT, 'src', 'story.ts'), 'utf8');
  const imports = [...storySrc.matchAll(/import \{[^}]*\} from '\.\/([\w.]+)'/g)].map(m => m[1]);
  ok(imports.indexOf('game.ts') < 0 && imports.indexOf('record.ts') < 0,
    'story.ts 不 import 模拟层/录制层（对话不进带子）→ 不会影响确定性与指纹', imports.join(','));
  ok(imports.indexOf('registry.ts') >= 0, '登记进扩展点总账（imports: ' + imports.join(',') + '）');
  ok(!/U\.rng|Math\.random/.test(storySrc), 'story.ts 里没有任何随机 —— 选台词不靠掷骰子');

  // 模拟层不许认识"剧情"
  const gameSrc = fs.readFileSync(path.join(ROOT, 'src', 'game.ts'), 'utf8');
  ok(!/Story|story\.ts/.test(gameSrc), 'game.ts 里连一个 Story 都没有（模拟层不认识剧情）');

  console.log('    ' + Story.describe().split('\n').join('\n    '));
}

console.log('\n=== 结果 ===');
if (failures === 0) { console.log('\x1b[32m全部通过 ✔\x1b[0m\n'); process.exit(0); }
console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m\n');
process.exit(1);
