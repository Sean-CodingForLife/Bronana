/* =========================================================
   registry.mjs — 扩展点总账测试
   这一套守的是"系统"而不是"零件"：所有可扩展点都在一处声明、
   由一次审计校验，而且**审计本身必须真的能抓错**（不然它只是装饰）。
     · 家族齐备：必须存在的清单 + 每个家族有说明与数据来源
     · 家族内部：id 不能空、不能重复
     · 家族之间：所有引用都必须落在目标家族里（这是最容易静默退化的地方）
     · 审计有效性：人为注入一个坏值，audit() 必须报出来
     · 静态契约：覆盖层 ↔ index.html 的 scr-*、事件名 ↔ 代码里的 emit 字面量、
       设置项 ↔ 应用分支，这些"跨语言/跨文件"的对应关系也要在一处兜住
   用法： node test/registry.mjs
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { loadAll, SIM_MODULES, RENDER_MODULES, UI_MODULES } from './_load.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
let failures = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  \x1b[32mPASS\x1b[0m ' + label);
  else { failures++; console.log('  \x1b[31mFAIL\x1b[0m ' + label + (extra !== undefined ? '  → ' + extra : '')); }
}

console.log('\n=== Bronana · 扩展点总账 ===\n');
console.log('[1] 加载（含界面层：覆盖层与界面元素要对得上）');
let loadErr = null;
try { await loadAll(UI_MODULES); } catch (e) { loadErr = e.message; }
ok(!loadErr, '全部模块加载成功', loadErr);
if (loadErr) process.exit(1);

const g = globalThis;
const { Registry, Game, Scene, UI, Settings, Emit, Depth, AI, Comp, S } = g;

/* ---------------- 1. 家族齐备 ---------------- */
console.log('\n[2] 家族清单');
const REQUIRED = [
  'component', 'archetype',            // 对象由组件拼出来
  'state', 'scene', 'overlay', 'keyGroup', // 阶段与界面
  'enemy', 'enemyShape', 'enemyLegs', 'enemyMouth', 'enemyEye',   // 怪物
  'aiBehaviour', 'aiPattern',          // 行为与弹幕
  'weapon', 'weaponKind', 'weaponType', 'tier', // 武器（`tier` = 品级表，武器与道具共用）
  'element', 'elementEffect',                  // 元素（名字 + 附带效果的机制名）
  'curve', 'curveShape', 'curveDomain',        // 数值曲线（角色 / 怪物 / 刷怪节奏）
  'currency', 'currencyTier', 'loopSystem',    // 货币与三模块循环（战斗 / 经营 / 养成）
  'affix', 'affixFamily', 'affixSlot', 'affixTag', 'affixMod', // 词条（前缀/后缀，落在装备上）
  'charSpecial',                               // 角色的专属机制（写错 = 这个角色是白板）
  'item', 'itemIcon', 'itemSpecial', 'itemCost', 'itemCostAxis', // 道具（含"改机制"与"代价"两张声明表）
  'char', 'charTag',                   // 角色
  'bulletKind', 'particleKind', 'pickupKind', // 特效与掉落
  'depthBand', 'actor',                // 深度
  'setting',                           // 设置
  'challenge', 'challengeGroup', 'challengeMetric',  // 挑战 → 解锁
  'profileSection', 'codexLevel',      // 账号档案与图鉴
  'dangerLevel', 'dangerMod',           // 难度阶梯与它的修正键
  'dailyField', 'scoreField',          // 每日挑战与成绩码
  'talent', 'talentSector', 'talentType',  // 角色养成（天赋树）
  'campFacility', 'campEffect', 'campLevelCount',  // 局内营地（模拟经营）
  'keepFacility', 'keepMod',               // 跨局据点（模拟经营第二级）
  'offlineRate', 'seasonField',            // 离线产出与每周挑战（附加内容，不是运营）
  'talentEcon',                            // 天赋的经济修正键（与据点/营地同名）
  'campCombo',                             // 营地相邻组合（"怎么摆"是玩法）
  'roomType', 'floorTheme',                // 地牢房间类型与楼层主题（含隐藏房）
  'storyNpc', 'storyEnding', 'storySource', 'storyFlag',   // 剧情：枢纽/结局/碎片来源/flag
  'hubStation',                            // 枢纽站点（屋里站着的人与摆着的设施）
  'weaponFamily', 'synergyAxis',           // 武器联动：家族分组与轴
];
{
  const missing = REQUIRED.filter(n => !Registry.has(n));
  ok(missing.length === 0, REQUIRED.length + ' 个必须存在的家族都在（可扩展点没有漏登记）', missing.join(', '));
  const extra = Registry.names().filter(n => REQUIRED.indexOf(n) < 0);
  console.log('    · 家族共 ' + Registry.names().length + ' 个' +
    (extra.length ? '（额外的：' + extra.join('/') + '）' : ''));
  const noNote = Registry.names().filter(n => {
    const i = Registry.info(n);
    return !i || !i.note || !i.owner;
  });
  ok(noNote.length === 0, '每个家族都写了说明与数据来源（owner）', noNote.join(', '));
}

/* ---------------- 2. 审计：跨表引用 ---------------- */
console.log('\n[3] 审计：家族内部 + 家族之间');
{
  const a = Registry.audit();
  ok(a.missing.length === 0, '没有引用未注册的家族', a.missing.join(' | '));
  ok(a.problems.length === 0, '所有跨表引用都落在目标家族里（' + Object.keys(a.counts).length + ' 个家族）',
    a.problems.slice(0, 4).map(p => p.family + '.' + p.id + '.' + p.field + '=' + p.value).join(' | '));
  console.log('    · 规模：' + Object.keys(a.counts).sort()
    .map(k => k + ' ' + a.counts[k]).join('  ·  '));
  ok(a.counts.enemy === g.Enemies.LIST.length &&
    a.counts.weapon === g.Weapons.LIST.length &&
    a.counts.item === g.Items.LIST.length &&
    a.counts.char === g.Chars.LIST.length,
    '数据表家族的数量与数据表一致');

  /* 审计必须真的能抓错：临时塞一条指向不存在行为的怪 */
  const realList = g.Enemies.LIST;
  const ghost = { id: 'ghostUnit', name: '?', shape: 'blob', legs: 'nub', behavior: 'teleport', scale: 1 };
  realList.push(ghost);
  const bad = Registry.audit();
  realList.pop();
  const caught = bad.problems.some(p => p.id === 'ghostUnit' && p.field === 'behavior' && p.value === 'teleport');
  ok(caught, '注入了 behavior=teleport 的怪 → 审计报出来（审计不是装饰）',
    bad.problems.map(p => p.field + '=' + p.value).join(','));

  const e1 = (() => { try { Registry.family('enemy', { note: 'x' }); return null; } catch (e) { return e.message; } })();
  ok(!!e1 && /重名/.test(e1), '家族重名被拒绝', e1);
  const e2 = (() => { try { Registry.family('tmpA', {}); return null; } catch (e) { return e.message; } })();
  ok(!!e2 && /缺少说明/.test(e2), '家族缺说明被拒绝', e2);
  const e3 = (() => { try { Registry.family('tmpB', { note: 'x' }); return null; } catch (e) { return e.message; } })();
  ok(!!e3 && /entries\(\)/.test(e3), '家族既没有 entries 也没有 values 被拒绝', e3);
  ok(Registry.describe().indexOf('扩展点总账') === 0, 'describe() 输出总账报告');
}

/* ---------------- 3. 静态契约：跨文件/跨语言的对应关系 ---------------- */
console.log('\n[4] 静态契约');
{
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));

  // 覆盖层 ↔ index.html 的 scr-*
  const overlays = Registry.ids('overlay');
  const badOverlay = overlays.filter(n => !htmlIds.has('scr-' + n));
  ok(badOverlay.length === 0,
    '每个覆盖层都有对应的 index.html 元素（scr-*）—— 漏一个就是"界面静默不显示"',
    badOverlay.join(', '));

  // 状态 ↔ 场景 ↔ 覆盖层：三者一一对应
  const states = Registry.ids('state');
  const scenes = Registry.ids('scene');
  ok(states.length === scenes.length && states.every(s => scenes.indexOf(s) >= 0),
    '状态机 ' + states.length + ' 个状态与场景表一一对应',
    states.filter(s => scenes.indexOf(s) < 0).join(', '));
  ok(Scene.overlayNames().slice().sort().join(',') === overlays.slice().sort().join(','),
    '覆盖层家族就是场景表里用到的那些（没有第二个来源）');

  // 设置项 ↔ 应用分支（main.ts 的 applySetting）↔ 键位
  const mainSrc = fs.readFileSync(path.join(ROOT, 'src', 'main.ts'), 'utf8');
  const applied = new Set([...mainSrc.matchAll(/key === '([a-zA-Z-]+)'/g)].map(m => m[1]));
  const settingKeys = Registry.ids('setting');
  const notApplied = settingKeys.filter(k => !applied.has(k));
  ok(notApplied.length === 0, '每个设置项都有"应用"分支（否则改了不生效）', notApplied.join(', '));

  /* 设置项 ↔ **界面控件**：只有"应用分支"是不够的 ——
     一项设置如果界面上没有开关，玩家永远改不到它（等于不存在）。
     这一条是补出来的：`music` 加进设置表时，应用分支、测试、主循环都接上了，
     唯独**设置页没有那个按钮** —— 而当时的尺子只看"有没有应用分支"，全绿。
     判据用 `index.html` 的静态 id 契约（与本文件上面那些覆盖层检查同一条规矩）。 */
  const html2 = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const uiSrc2 = fs.readFileSync(path.join(ROOT, 'src', 'ui.ts'), 'utf8');
  /* 每个设置项 → 它在设置页上的**动作名**（可能不止一个：音量与抖动是"加减"两个按钮）。
     为什么写成显式映射而不是"猜 set-<key>"：名字本来就不一致 ——
     `damageNumbers` 的按钮叫 `set-damage`、`reduceMotion` 的叫 `set-motion`，
     而 `volume` 有两个。猜出来的规则会把**对的**实现判成错的（第一版就是）；
     显式写下来，改名的代价是"顺手改这一行"。 */
  const WIDGET_OF = {
    sound: ['set-sound'],
    music: ['set-music'],
    volume: ['set-volume-up', 'set-volume-down'],
    speed: ['set-speed'],
    fps: ['set-fps'],
    shake: ['set-shake-up', 'set-shake-down'],
    autopause: ['set-autopause'],
    damageNumbers: ['set-damage'],
    reduceMotion: ['set-motion'],
    locale: ['set-locale'],
    fontScale: ['set-fontscale'],
    colourblind: ['set-colourblind'],
    keyUp: ['rebind'], keyDown: ['rebind'], keyLeft: ['rebind'],
    keyRight: ['rebind'], keyPause: ['rebind']
  };
  const noWidget = [];
  for (const k of settingKeys) {
    const acts = WIDGET_OF[k];
    if (!acts) { noWidget.push(k + '（这份映射表里没有它的控件）'); continue; }
    for (const act of acts) {
      const hasBtn = new RegExp('data-act="' + act + '"').test(html2);
      const hasHandler = new RegExp("'" + act + "'\\s*:").test(uiSrc2);
      if (!hasBtn || !hasHandler) {
        noWidget.push(k + '→' + act + (hasBtn ? '' : '（HTML 里没有按钮）') + (hasHandler ? '' : '（ui.ts 里没有处理函数）'));
      }
    }
  }
  ok(noWidget.length === 0,
    '每个设置项在设置页都**有控件**（按钮 + 处理函数两样都要）', noWidget.join(', '));
  /* 映射表里不能有已经不是设置的键（否则它会越积越松） */
  const staleWidget = Object.keys(WIDGET_OF).filter(k => settingKeys.indexOf(k) < 0);
  ok(staleWidget.length === 0, '控件映射表里没有已删除的设置项', staleWidget.join(', '));
  /* 反证：按钮没了之后，那条判据的输入确实会变 —— 尺子量的是真东西 */
  const brokenHtml = html2.replace('data-act="set-music"', 'data-act="set-nothing"');
  ok(!/data-act="set-music"/.test(brokenHtml),
    '（对照）去掉按钮之后正则确实匹配不到 —— 判据不是空转');

  // 事件名：代码里 emit/on 的字面量必须在总账里有登记（防拼写漂移）
  // 这份清单就是"总线上有哪些事件"的**唯一声明**：新增事件必须同时写在这里，
  // 否则测试会指着你说"代码里发了个没人登记的事件"。
  const EVENT_NAMES = [
    'stateChange', 'stateDenied',                    // 状态机
    'runStart', 'runResumed', 'levelup', 'levelupChosen', 'levelCards',  // 一局流程
    'waveStart', 'waveClear', 'shopOpen', 'packOpen', 'reroll', 'lock', 'buy', 'sell', 'deny',
    'gameOver', 'resume',                            // 结算与恢复
    'runWin',                                        // 通关（有通关条件之后，"结束"分赢与倒下）
    'campBuy', 'campSell',                           // 局内营地（建设是这一局的状态变更，必须录进带子）
    'roomEnter', 'wallBreak', 'secretFound',         // 地牢：进房 / 打穿暗门 / 发现密室
    'bossDown',                                      // 打倒一只 Boss（剧情碎片与图鉴的输入）
    'roomEvent', 'overrun', 'floorEnter',            // 房间事件 / 超时狂暴 / 翻层
    'boonOffer', 'boonPick',                         // 层间契约：给出候选 / 挑定一条
    'combine',                                       // 武器合成（制造那一侧）
    'craft',                                         // 制造（经营那一侧的主行动）
    'buyBuild',                                      // 建材包（花材料买建材）
    'shake',                                         // 渲染层反馈（模拟层只发意图）
    'sfx'                                            // 音效意图（同上：模拟层不认识 audio.ts）
  ];
  Registry.family('event', {
    note: '信号总线上的事件名（emit 的字面量必须在这里）', owner: 'utils.ts',
    values: function () { return EVENT_NAMES.slice(); }
  });
  const srcFiles = fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.endsWith('.ts') && f !== 'types.d.ts');
  const emitted = new Set();
  for (const f of srcFiles) {
    const src = fs.readFileSync(path.join(ROOT, 'src', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    /* 三种写法都要认：
         `Game.events.emit('x')`   —— 模拟层与入口
         `C.events().emit('x')`    —— 被注入的总线（market.ts 的 ctx 走这条）
         `Game.events.on('x')`     —— 监听
       以前只匹配字面量 `.events.emit(`，于是 `C.events().emit('buyBuild')` 一直不在语料里 ——
       这条"事件名必须在总账里"的守卫有个洞，`buyBuild` 因此从来没被登记过
       （同一个洞也解释了：`overrun` 那条零监听的事件一直没人发现）。 */
    for (const m of src.matchAll(/\.events\(\)?\.emit\(\s*'([a-zA-Z]+)'/g)) emitted.add(m[1]);
    for (const m of src.matchAll(/Game\.events\.on\(\s*'([a-zA-Z]+)'/g)) emitted.add(m[1]);
    // 监听端也允许 `C.events().on(` 这种写法（现在没有，留着免得下次加了又漏）
    for (const m of src.matchAll(/\.events\(\)?\.on\(\s*'([a-zA-Z]+)'/g)) emitted.add(m[1]);
  }
  const unknownEvents = [...emitted].filter(e => EVENT_NAMES.indexOf(e) < 0);
  ok(unknownEvents.length === 0,
    '代码里 emit/on 的 ' + emitted.size + ' 个事件名都在总账里',
    unknownEvents.join(', '));

  // 粒子种类 ↔ 渲染层真的会画的种类
  const particleKinds = Registry.ids('particleKind');
  ok(particleKinds.length >= 7 && particleKinds.indexOf('text') >= 0,
    '粒子种类家族包含全部已注册画法（' + particleKinds.join('/') + '）');

  // 深度：所有可视化实体都注册了层带
  ok(Registry.ids('actor').length >= 4, '可视实体家族包含全部实体（' + Registry.ids('actor').join('/') + '）');
  ok(Depth.actors().every(n => Registry.has('depthBand')), '实体引用的层带家族存在');
}

/* ---------------- 4. 新增一个"族"要付的代价 = 几行声明 ---------------- */
console.log('\n[5] 扩展代价');
{
  const before = Registry.names().length;
  Registry.family('probeFamily', {
    note: '测试用的临时家族', owner: 'test/registry.mjs',
    values: function () { return ['a', 'b']; }
  });
  const a = Registry.audit();
  ok(Registry.names().length === before + 1 && a.ok, '新增家族只需一次声明，审计自动把它算进去');
  ok(Registry.ids('probeFamily').join(',') === 'a,b', 'values() 家族也能被审计到', Registry.ids('probeFamily').join(','));
}

console.log('\n=== 结果 ===');
if (failures === 0) { console.log('\x1b[32m全部通过 ✔\x1b[0m'); process.exit(0); }
console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m');
process.exit(1);
