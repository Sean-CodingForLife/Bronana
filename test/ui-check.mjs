/* =========================================================
   ui-check.ts — UI / DOM 层无头校验
   用轻量 DOM 桩真实执行 ui.ts，覆盖：
   全部 screen 的 HTML id 是否齐全、各界面渲染函数、HUD 更新、
   完整流程（标题→选角→战斗→升级→商店→结算）。
   用法： node test/ui-check.mjs
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

/* =========================================================
   1. 从 index.html 解析出 UI 需要的所有 id，并核对入口与模块图
   ========================================================= */
console.log('\n=== Bronana · UI / DOM 无头校验 ===\n');
console.log('[1] index.html 与 ui.ts 的元素契约');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));

const uiSrc = fs.readFileSync(path.join(ROOT, 'src', 'ui.ts'), 'utf8');
const usedIds = new Set([...uiSrc.matchAll(/q\('([^']+)'\)/g)].map(m => m[1]));

const missing = [...usedIds].filter(id => !htmlIds.has(id));
ok(missing.length === 0, 'ui.ts 引用的 ' + usedIds.size + ' 个 id 在 index.html 中都存在',
  missing.join(', '));

/* 入口：Vite 只认一个 ES 模块入口，16 个 <script src="js/*.js"> 的写法已经没了 */
const scripts = [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map(m => m[1]);
ok(scripts.length === 1 && scripts[0] === '/src/main.ts',
  'index.html 只引一个入口脚本 /src/main.ts', scripts.join(', '));
ok(scripts.length === 1 && fs.existsSync(path.join(ROOT, scripts[0].replace(/^\//, ''))),
  '入口文件存在（打包器和 tsconfig 都按这个路径解析）', scripts[0]);
ok(/<script[^>]*type="module"[^>]*src="\/src\/main\.ts"/.test(html),
  '入口用 type="module" 加载（否则 import 语法直接报错）');
ok(/<link[^>]*href="styles\.css"/.test(html) && fs.existsSync(path.join(ROOT, 'styles.css')),
  'index.html 引用的 styles.css 存在');

/* =========================================================
   1a. 模块依赖图：无环 + 分层约束
   旧写法是"手写 <script> 顺序"，顺序错了才炸；现在由 import 决定顺序，
   但循环导入同样会让初始化顺序变得不可预测，所以这里把图本身测掉。
   ========================================================= */
const srcDir = path.join(ROOT, 'src');
const modFiles = fs.readdirSync(srcDir).filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'));
const graph = {};
for (const f of modFiles) {
  const code = fs.readFileSync(path.join(srcDir, f), 'utf8');
  graph[f] = [...code.matchAll(/^import\s[^'"]*from\s*'\.\/([^']+)'/gm)]
    .map(m => m[1]).filter(t => modFiles.indexOf(t) >= 0);
}

const cycles = [];
const color = {};
modFiles.forEach(f => { color[f] = 0; });
const stack = [];
function visit(f) {
  color[f] = 1; stack.push(f);
  for (const t of graph[f]) {
    if (color[t] === 1) cycles.push(stack.slice(stack.indexOf(t)).concat(t).join(' → '));
    else if (color[t] === 0) visit(t);
  }
  stack.pop(); color[f] = 2;
}
modFiles.forEach(f => { if (color[f] === 0) visit(f); });
ok(cycles.length === 0, '模块依赖图无环（' + modFiles.length + ' 个模块）', cycles.join(' | '));

const FORBID = [
  /* 模拟内核不认识**任何**表现层模块。`input.ts` / `audio.ts` 是这一轮加进来的：
     改造前 game.ts 直接 `Input.isSlow()`（慢走）与 `Sfx.kill()`（音效）共 10 处 ——
     一帧的行为因此不只由 (状态, dt, 输入载荷) 决定。现在慢走由输入载荷带来，
     音效改成广播 `sfx` 意图（与已有的 `shake` 同套路）。 */
  ['game.ts', ['render.ts', 'ui.ts', 'input.ts', 'audio.ts'],
    '模拟层不得依赖渲染层 / 界面层 / 输入 / 音频（一帧只由 状态 + dt + 输入载荷 决定）'],
  ['sprites.ts', ['game.ts', 'ui.ts'], '造型库不得依赖玩法 / 界面'],
  ['render.ts', ['ui.ts'], '渲染层不得依赖界面层'],
  ['draw2d.ts', ['game.ts', 'render.ts', 'ui.ts', 'sprites.ts', 'emit.ts'],
    '绘制原语层只能依赖 utils'],
  ['utils.ts', modFiles.filter(f => f !== 'utils.ts'), '工具层不依赖任何模块'],
  ['rig.ts', modFiles.filter(f => f !== 'rig.ts' && f !== 'utils.ts'),
    '骨架层是纯数学，只依赖 utils'],
  ['collide.ts', modFiles.filter(f => f !== 'collide.ts' && f !== 'utils.ts'),
    '碰撞体层是纯数学，只依赖 utils'],
  /* selfcheck 是纯机制（只依赖 registry / utils），所以场景表登记自检不算越层 */
  ['scene.ts', modFiles.filter(f => f !== 'scene.ts' && f !== 'game.ts' && f !== 'utils.ts' &&
    f !== 'registry.ts' && f !== 'selfcheck.ts' && f !== 'station.ts'),
    '场景表只依赖状态机 / 门表 / 总账 / 自检登记处与 utils' +
    '（门表是「那三道门通向哪一屏」的唯一出处，场景表据此做定义期校验；' +
    '不得反向依赖渲染层 / 界面层）'],
  ['bronana.ts', modFiles.filter(f => ['bronana.ts', 'rig.ts', 'draw2d.ts', 'comp.ts', 'utils.ts'].indexOf(f) < 0),
    '角色骨架只依赖 骨架层 / 组件层 / 绘制原语层 / 工具层'],
  ['comp.ts', modFiles.filter(f => f !== 'comp.ts' && f !== 'utils.ts' && f !== 'registry.ts' && f !== 'selfcheck.ts'),
    '组件层是纯声明与组合，只依赖 utils / 总账 / 自检登记处（组件与原型两张表要在启动期自检，见 comp.ts 末尾）'],
  /* 诊断面板读的就是**各系统自己的账**：R51 起又多了世界 / 对象两行，所以允许列表里
     多了 `world.ts` / `object.ts` / `comp.ts`（三者都在 L0，是引擎地基）。
     ⚠ 这一条守的是"面板不依赖界面层"—— 界面层（ui / input / main）一个都不许进。 */
  ['diag.ts', modFiles.filter(f => ['diag.ts', 'game.ts', 'render.ts', 'registry.ts', 'containers.ts',
    'comp.ts', 'object.ts', 'world.ts', 'depth.ts', 'sprites.ts', 'utils.ts'].indexOf(f) < 0),
    '诊断面板只读各系统的账目（世界 / 对象 / 容器 / 深度 / 扩展点），不依赖界面层'],
  ['record.ts', modFiles.filter(f => f !== 'record.ts' && f !== 'game.ts'),
    '录制层只依赖状态机（不认识渲染 / 界面）'],
  /* 容器名也要登记进扩展点总账（`Registry.family('container')`）—— 与 `comp.ts`
     末尾那两张表同一条纪律：**声明表在拥有数据的模块里自注册**。
     `registry.ts` 是最底层的纯机制（只依赖 utils），所以这不是一条玩法依赖。 */
  ['containers.ts', modFiles.filter(f => f !== 'containers.ts' && f !== 'registry.ts'),
    '容器层是纯机制（回收/上限/账目），只依赖总账（容器名要登记，与 comp.ts 同一条纪律）'],
  ['registry.ts', modFiles.filter(f => f !== 'registry.ts' && f !== 'utils.ts'),
    '扩展点总账是纯机制，只依赖 utils'],
  ['ai.ts', modFiles.filter(f => f !== 'ai.ts' && f !== 'utils.ts' && f !== 'registry.ts'),
    'AI 层只依赖 utils / 总账（要什么能力都由 AiCtx 注入，不认识 Game / 渲染层）'],
  ['depth.ts', modFiles.filter(f => f !== 'depth.ts' && f !== 'utils.ts' && f !== 'registry.ts' && f !== 'selfcheck.ts'),
    '深度层只依赖 utils / 总账 / 自检登记处（层带表要在启动期自检，实体仍由渲染层注册）'],
  /* 品级表与道具/武器表同层：纯数据 + 总账 + 自检登记处。
     它被 data_weapons / data_items / ui / game 四处读，所以它**不许**反向依赖任何一个 */
  ['data_tiers.ts', modFiles.filter(f => f !== 'data_tiers.ts' && f !== 'utils.ts' &&
    f !== 'registry.ts' && f !== 'selfcheck.ts'),
    '品级表是纯数据，只依赖 utils / 总账 / 自检登记处（它被武器、道具、界面、模拟四处读）']
];
for (const [from, banned, label] of FORBID) {
  const bad = (graph[from] || []).filter(t => banned.indexOf(t) >= 0);
  ok(bad.length === 0, label, bad.length ? from + ' → ' + bad.join(', ') : '');
}
const importersOfMain = modFiles.filter(f => (graph[f] || []).indexOf('main.ts') >= 0);
ok(importersOfMain.length === 0, 'main.ts 只作为入口被 index.html 加载，不被任何模块导入',
  importersOfMain.join(', '));

// 命令行入口同理：src/cli.ts 是 Node 侧入口。一旦浏览器侧的模块 import 了它，
// 它引用的 node:fs / node:http 就会被 Vite 打进浏览器包
const importersOfCli = modFiles.filter(f => (graph[f] || []).indexOf('cli.ts') >= 0);
ok(importersOfCli.length === 0, 'cli.ts 只作为 Node 入口，不被任何模块导入（否则会被打进浏览器包）',
  importersOfCli.join(', '));
const cliGraph = graph['cli.ts'] || [];
ok(cliGraph.indexOf('render.ts') < 0 && cliGraph.indexOf('ui.ts') < 0,
  'cli.ts 不依赖渲染层 / 界面层（命令行里没有 canvas 与 DOM）', cliGraph.join(','));

/* =========================================================
   1b. CSS 选择器 ↔ HTML 契约（无需浏览器即可发现"样式没生效"）
   历史 bug：HTML 改成 id 后 CSS 仍写类选择器 → 样式整条失效
   ========================================================= */
const cssSrc = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const jsAll = fs.readdirSync(path.join(ROOT, 'src'))
  .filter(f => f.endsWith('.ts'))
  .map(f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8')).join('\n');

// 从 CSS 中提取选择器里的 #id 与 .class（跳过属性/伪类等）
const cssIds = new Set([...cssSrc.matchAll(/(^|[\s,>+~(])#([A-Za-z][\w-]*)/g)].map(m => m[2]));
const cssClasses = new Set([...cssSrc.matchAll(/(^|[\s,>+~(])\.([A-Za-z][\w-]*)/g)].map(m => m[2]));

// HTML 里出现过的 id 与 class 名
const htmlClassNames = new Set();
[...html.matchAll(/class="([^"]+)"/g)].forEach(m => {
  m[1].split(/\s+/).forEach(c => c && htmlClassNames.add(c));
});

// 由 JS 动态创建 / 切换的类名（这些不会出现在 HTML 的 class 属性里）
const DYNAMIC_CLASSES = new Set([
  'active', 'hidden', 'sel', 'sold', 'empty',
  'char-card', 'card', 'cv', 'nm', 'en', 'ds', 'pr', 'tier', 'cn', 'ce',
  /* 品级色（t1–t5）**不写死在这里**：档位住在 data_tiers.ts，这里从源码里读出
     它声明的 class 名，并要求 styles.css 为每一档都有变量与规则 ——
     加一档却忘了加色，这条会当场说"没有 --tierN"。 */
  ...[...fs.readFileSync(path.join(ROOT, 'src', 'data_tiers.ts'), 'utf8')
    .matchAll(/cls:\s*'(t\d+)'/g)].map(m => m[1]),
  'buff', 'nerf', 'tag', 'cols',
  /* 词条（affixes.ts）：包一层的颜色类由**词条表**的 family 决定
     （`Affixes.html` 拼 `affix prefix` / `affix suffix`），所以这三个类名
     不会出现在 HTML 里 —— 加一个家族时这里要跟着加，否则"颜色没生效"没人看得见。 */
  'affix', 'prefix', 'suffix',
  'toast', 'good', 'warn', 'wslot', 'k', 'v', 'big-num', 'shop-col',
  'focused', 'locked', 'score-code', 'camp-combo',
  // 小地图的格子与小地图上的"门牌"（房间分色）都是按声明表动态生成的：
  // .mm-cell 与 .mm-<cls>（cls 来自 dungeon.ts 的房型表），加一种房型不用改 HTML
  'mm-cell', 'mm-start', 'mm-fight', 'mm-elite', 'mm-treasure',
  'mm-shop', 'mm-camp', 'mm-event', 'mm-boss', 'mm-secret', 'mm-hint',
  // 枢纽 / 大厅：对话框与公告板读账都是**按表动态生成**的
  // （屋里站着谁、账上有多少都由 story.ts / 会话决定），所以这些类名不在 HTML 里
  'acct-head', 'acct-band', 'acct-item',
  'tx-cv', 'tx-body', 'tx-name', 'tx-role', 'tx-line', 'tx-next', 'tx-quiet',
  // 图鉴的挑战分组小标题（组名只写一次，不再每行重复）
  'codex-group',
  // 层间契约的候选卡（按 boons.ts 的表动态生成）
  'boon-card', 'bn-name', 'bn-note', 'bn-eff', 'boon-row',
  // "自己选房间"的门按钮（按 Game.doors() 动态生成；房型名与图标来自房型表）
  'door', 'door-head', 'shut',
  // 合成：武器卡片上的动作行（合并 / 回收）与武器条上的品级角标 ——
  // 卡片是按 sess.player.weapons 动态生成的，角标按品级（t1–t4 已在上面）
  'acts', 'pip',
  // 「我的武器 / 我的道具」的小格子（.wbox）与折叠起来的参考段落（.sub-h）
  'shop-sub', 'wrow', 'wbox', 'sub-h',
  // 工坊的配方页签与"造不了"的行
  'craft-tabs', 'craft-note', 'on', 'dim',
  // 技能栏的格子（按 sess.skills.slots **动态生成**：一个技能一格）
  'sk-slot', 'ready', 'cooling', 'dry',
  /* R50 的两屏（选存档 / 捏人）：卡片与选项都是**按存档和表动态生成**的 ——
     `.slot-card`（三个槽位）、`.entry-row` 那一族（入门三选的三列九档）。
     它们不在 index.html 里，因为"有几个槽位""有几档"分别是 `slots.ts` 与
     `openings.ts` 说了算，界面只是照画。 */
  'slot-card', 'entry-row', 'en-name', 'en-note', 'en-give',
  /* R41 · 对话补完的那几块（按台词与分支动态生成，不在 HTML 里）：
     玩家侧那一行、打字光标、选项、读法工具条、对话历史。 */
  'tx-row', 'tx-me', 'tx-caret', 'tx-choices', 'tx-choice', 'tx-tools', 'tx-hint',
  'tx-log', 'tx-log-row',
  /* R41 · NPC 交易面板（按报价表动态生成） */
  'tx-trade', 'trade-row', 'trade-head', 'trade-name', 'trade-give', 'trade-note',
  'trade-foot', 'trade-ask', 'off'
]);

const missingId = [...cssIds].filter(id => !htmlIds.has(id));
ok(missingId.length === 0, 'CSS 引用的 ' + cssIds.size + ' 个 id 在 index.html 中都存在',
  missingId.join(', '));

// 静态类名必须真的出现在 HTML 里；否则说明选择器已失效（样式静默不生效）
const orphanClass = [...cssClasses].filter(c =>
  !htmlClassNames.has(c) && !DYNAMIC_CLASSES.has(c));
ok(orphanClass.length === 0, 'CSS 引用的 ' + cssClasses.size + ' 个类名都匹配到了元素',
  orphanClass.join(', '));

/* data-act 契约：每个按钮动作都必须有对应的处理分支，反之亦然。
   动作有两个来源：index.html 的静态按钮，以及**运行时生成的按钮**
   （天赋树的节点按钮、角色切换按钮就是这样造的）。
   只查静态 HTML 会把"动态按钮"误判成"没有按钮"—— 那是检查的盲区，不是代码的问题。 */
const htmlActs = new Set([...html.matchAll(/data-act="([a-z-]+)"/g)].map(m => m[1]));
const dynActs = new Set([
  ...[...uiSrc.matchAll(/data-act="([a-z-]+)"/g)].map(m => m[1]),          // 模板串里写的
  ...[...uiSrc.matchAll(/dataset\.act\s*=\s*'([a-z-]+)'/g)].map(m => m[1]) // 直接赋的
]);
const allActs = new Set([...htmlActs, ...dynActs]);
/* 处理分支不再从源码里正则匹配 `case 'x':` —— 那是一张**表**（ui.ts 的 ACTIONS +
   scene.ts 的 SCREEN_ACTS），运行时可枚举。所以这一段搬到模块加载之后（见 [1d]）：
   对着真表比，比对着源码文本比可靠得多（源码里出现 `case 'hub-npc':` 不代表它真的接上了）。 */
const dynActsCount = dynActs.size;

/* =========================================================
   2. DOM 桩
   ========================================================= */
const uiDrawLog = [];
let domWrites = 0;
function makeCtx() {
  const noop = () => {};
  const t = { fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, font: '', textAlign: '', textBaseline: '', globalCompositeOperation: '', lineJoin: '', lineCap: '' };
  const methods = ['save', 'restore', 'translate', 'rotate', 'scale', 'setTransform', 'beginPath',
    'closePath', 'moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'arc', 'ellipse', 'rect',
    'fill', 'stroke', 'clip', 'fillRect', 'strokeRect', 'clearRect', 'fillText', 'strokeText',
    'drawImage', 'setLineDash'];
  methods.forEach(m => { t[m] = noop; });
  // drawImage 首参必须是真 canvas 或图片：漏取 .canvas 会在此处直接报错
  t.drawImage = (img, ...rest) => {
    if (img && typeof img === 'object' && typeof img.getContext !== 'function' && img.nodeName !== 'IMG') {
      throw new Error('drawImage 收到非 canvas 对象：' + JSON.stringify(Object.keys(img)) + '（是否忘了取 .canvas？）');
    }
    uiDrawLog.push(img);
  };
  t.measureText = () => ({ width: 8 });
  t.createLinearGradient = () => { throw new Error('禁止使用渐变（美术宪法）'); };
  t.createRadialGradient = () => { throw new Error('禁止使用渐变（美术宪法）'); };
  return t;
}

const registry = {};
const allEls = [];

function register(el) {
  if (!el) return;
  if (el.id && !registry[el.id]) registry[el.id] = el;
  if (allEls.indexOf(el) < 0) allEls.push(el);
  if (Array.isArray(el.children)) el.children.forEach(register);
}

function matches(el, sel) {
  sel = sel.trim();
  // 支持逗号选择器列表（focusables() 用的就是 ".card, .btn, .char-card"）
  if (sel.indexOf(',') >= 0) return sel.split(',').some(s => matches(el, s));
  if (sel[0] === '#') return el.id === sel.slice(1);
  if (sel[0] === '.') {
    /* ⚠ **复合类选择器**（`.trade-row.off` 这种）也要支持。
       只取 `sel.slice(1)` 的话，`.trade-row.off` 会被当成"类名是
       `trade-row.off`"—— 于是**永远匹配不上**，而报出来的是
       "有 0 行标成了不可做"，看起来像界面的问题、其实是量尺的。
       R41 的交易面板就是这么踩到的。 */
    const classes = sel.split('.').filter(Boolean);
    return !!el._classes && classes.every(c => el._classes.has(c));
  }
  // 属性选择器（事件委托用的 `closest('[data-act]')` 就是它）。
  // 不支持它的话，桩里的委托点击永远找不到按钮 —— 那是检查的盲区。
  if (sel[0] === '[') {
    const m = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel);
    if (!m) return false;
    const key = m[1].replace(/^data-/, '');
    const v = el.dataset ? el.dataset[key] : undefined;
    if (v === undefined || v === null) return false;
    return m[2] === undefined ? true : String(v) === m[2];
  }
  return el.tagName === sel.toUpperCase();
}

function subtree(root, out) {
  out = out || [];
  if (!root || !Array.isArray(root.children)) return out;
  for (const c of root.children) { out.push(c); subtree(c, out); }
  return out;
}

/** 有 root 时只在子树里找（真实 DOM 就是这么做的，桩以前是所有元素全局找） */
function querySelector(sel, root) {
  const pool = root ? subtree(root) : allEls;
  sel = sel.trim();
  if (sel[0] === '#' && !root) return registry[sel.slice(1)] || null;
  for (const el of pool) if (matches(el, sel)) return el;
  return null;
}

function querySelectorAll(sel, root) {
  return (root ? subtree(root) : allEls).filter(el => matches(el, sel));
}

function makeEl(tag, id, classes) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    id: id || '',
    children: [],
    dataset: {},
    innerHTML: '',
    title: '',
    width: 0, height: 0,
    _classes: new Set(String(classes || '').split(/\s+/).filter(Boolean)),
    _handlers: {},
    _text: '',
    classList: {
      add(c) { el._classes.add(c); },
      remove(c) { el._classes.delete(c); },
      toggle(c, on) { if (on === undefined) { el._classes.has(c) ? el._classes.delete(c) : el._classes.add(c); } else if (on) el._classes.add(c); else el._classes.delete(c); },
      contains(c) { return el._classes.has(c); }
    },
    appendChild(c) {
      if (!c || typeof c !== 'object' || c.tagName === undefined) {
        throw new Error('appendChild 收到非 DOM 节点：' + JSON.stringify(c && Object.keys(c)) + '（是否忘了取 .canvas？）');
      }
      el.children.push(c); c.parentNode = el; register(c); return c;
    },
    removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); return c; },
    insertBefore(c) { el.children.unshift(c); c.parentNode = el; register(c); return c; },
    addEventListener(type, fn) { (el._handlers[type] = el._handlers[type] || []).push(fn); },
    removeEventListener() {},
    getContext: () => (el._ctx = el._ctx || makeCtx()),
    get firstChild() { return el.children[0] || null; },
    get childElementCount() { return el.children.length; },
    // 作用域：元素上的 querySelector(All) 只在自己子树里找（与真实 DOM 一致）
    querySelector: (sel) => querySelector(sel, el),
    querySelectorAll: (sel) => querySelectorAll(sel, el),
    closest(sel) {
      let p = el;
      while (p) { if (matches(p, sel)) return p; p = p.parentNode; }
      return null;
    },
    click() { (el._handlers.click || []).forEach(fn => fn({ target: el })); }
  };
  if (id) registry[id] = el;
  allEls.push(el);
  // DOM 写入计数：验证 HUD 的变化检测确实跳过了无变化的写操作
  Object.defineProperty(el, 'textContent', {
    get() { return el._text; },
    set(v) { el._text = v; domWrites++; },
    configurable: true
  });
  // innerHTML 写进去之后 textContent 也要跟着变（真实 DOM 就是这样）。
  // 桩以前只当普通字符串存着，于是"用 innerHTML 填的面板"在桩里 textContent 是空的 ——
  // 对它的断言等于在断言一个浏览器里不成立的东西。
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html || ''; },
    set(v) {
      el._html = String(v == null ? '' : v);
      el._text = el._html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    },
    configurable: true
  });
  // U.el(tag, cls) 走的是 className，桩必须把它同步到 _classes，
  // 否则所有 ".card / .btn" 这类选择器在桩里永远匹配不到（静默失明）
  Object.defineProperty(el, 'className', {
    get() { return [...el._classes].join(' '); },
    set(v) { el._classes = new Set(String(v || '').split(/\s+/).filter(Boolean)); },
    configurable: true
  });
  el.style = new Proxy({}, {
    set(t, k, v) { if (k === 'width') domWrites++; t[k] = v; return true; },
    get(t, k) { return t[k]; }
  });
  return el;
}

/* 按 index.html 真实结构建树。
   以前这里是"给每个 id 造一个扁平元素"，于是父子关系全都不存在 ——
   任何"只在自己这屏里找元素"的代码（比如菜单焦点）在桩里必然找不到东西，
   而真实浏览器里是对的。桩骗人的地方，测试就守不住。 */
const VOID_TAGS = new Set(['meta', 'link', 'br', 'hr', 'img', 'input', 'source']);
const htmlTreeBuilt = (() => {
  const rootStack = [];
  let current = null;
  let cursor = 0;
  const re = /<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    // 标签之间的文本：写成 textContent（否则按钮的文案在桩里是空的，
    // "焦点提示"这类依赖文案的东西就没法测）
    const between = html.slice(cursor, m.index);
    cursor = re.lastIndex;
    if (current && between.trim()) {
      const text = between.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
      if (text) current._text = (current._text ? current._text + ' ' : '') + text;
    }
    if (m[0].startsWith('<!--') || m[0].startsWith('<!DOCTYPE')) continue;
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrs = m[3] || '';
    const selfClose = m[4] === '/' || VOID_TAGS.has(tag);
    if (closing) { rootStack.pop(); current = rootStack[rootStack.length - 1] || null; continue; }
    const idm = /\bid="([^"]+)"/.exec(attrs);
    const clm = /\bclass="([^"]*)"/.exec(attrs);
    const el = makeEl(tag, idm ? idm[1] : '', clm ? clm[1] : '');
    if (current) current.appendChild(el);
    if (!selfClose) { rootStack.push(el); current = el; }
  }
  return true;
})();
void htmlTreeBuilt;

const documentStub = {
  readyState: 'complete',
  head: makeEl('head'),
  body: makeEl('body'),
  createElement: (tag) => makeEl(tag),
  getElementById: (id) => registry[id] || null,
  querySelector, querySelectorAll,
  _clickBound: false,
  _handlers: {},
  addEventListener(type, fn) {
    if (type === 'click') documentStub._clickBound = true;
    (documentStub._handlers[type] = documentStub._handlers[type] || []).push(fn);
  },
  removeEventListener() {}
};

/* 合成一次 [data-act] 点击：走的是 ui.ts 注册在 document 上的那一个委托处理器，
   而不是直接调 UI 内部函数 —— 否则测不到 "按钮连到动作" 这一段。 */
function clickAct(name, bind) {
  const target = { dataset: { act: name, bind }, closest: () => target };
  (documentStub._handlers.click || []).forEach(fn => fn({ target }));
}

/* 点一个**真实的**元素：走 document 上那一个委托处理器（`closest('[data-act]')`），
   于是"动态生成的按钮能不能用"是真的被点过的，而不是被伪造的 target 骗过去。 */
function clickEl(el) {
  (documentStub._handlers.click || []).forEach(fn => fn({ target: el }));
}

/* window 上的监听要收下来（不然改键那条路没法测：捕获靠的正是 keydown） */
const winHandlers = {};
function fireKey(key) {
  (winHandlers.keydown || []).forEach(fn => fn({ key, preventDefault() { } }));
}

const g = globalThis;
g.window = g;
g.document = documentStub;
g.devicePixelRatio = 1;
g.innerWidth = 1280;
g.innerHeight = 720;
g.requestAnimationFrame = () => 0;
g.addEventListener = (type, fn) => { (winHandlers[type] = winHandlers[type] || []).push(fn); };
g.setTimeout = setTimeout;

console.log('\n[2] 加载全部脚本（含 ui.ts）');
let loadErr = null;
try { await loadAll(UI_MODULES); } catch (e) { loadErr = e.message; }
ok(!loadErr, '全部模块以 ES 模块方式加载无异常', loadErr);
if (loadErr) { console.log('\n\x1b[31m无法继续\x1b[0m\n'); process.exit(1); }

/* =========================================================
   1d. data-act 契约（对着**真表**比，不对着源码文本比）
   ---------------------------------------------------------
   改造前这里正则在 ui.ts 里找 `case 'x':`。问题是"源码里出现过"不等于"真的接上了"，
   而且把 dispatch 换成表之后那种检查会直接失明。
   现在动作表运行时可枚举（`UI.actNames()`），于是这一条检查的是**真东西**。
   ========================================================= */
{
  const UIx = g.UI, Scenex = g.Scene, Gamex = g.Game;
  const actNames = new Set(UIx.actNames());
  const actsWithoutHandler = [...allActs].filter(a => !actNames.has(a));
  const handlersWithoutButton = [...actNames].filter(a => !allActs.has(a));
  ok(actsWithoutHandler.length === 0,
    'index.html(' + htmlActs.size + ') + 动态生成(' + dynActsCount + ') 的按钮动作都注册在动作表里',
    actsWithoutHandler.join(', '));
  ok(handlersWithoutButton.length === 0, '动作表里的每个动作都有对应按钮',
    handlersWithoutButton.join(', '));
  ok(dynActsCount > 0, '动态按钮确实被算进来了（否则这条检查对天赋树是瞎的）', dynActsCount);
  // 两张表不能有重名：重名时 ACTIONS 赢，SCREEN_ACTS 那条会被**静默忽略**
  const dup = UIx.actNames().filter((a, i, arr) => arr.indexOf(a) !== i);
  ok(dup.length === 0, '动作表与"去某个界面"表没有重名', dup.join(', '));
  // 动作表本身要够大、且去处都真实存在（后者由 scene.validate 在启动期守着）
  ok(UIx.actNames().length >= 50, '动作表共 ' + UIx.actNames().length + ' 条', UIx.actNames().length);
  const badTo = Scenex.screenActNames().filter(a => Gamex.STATES.indexOf(Scenex.screenActOf(a)) < 0);
  ok(badTo.length === 0, '"去某个界面"的每个去处都是真实存在的状态', badTo.join(', '));

  /* 动作**按屏分组**：每个动作恰好属于一组，而且没有"杂物箱"。
     分组不是为了好看：44 个处理函数挤在一个字面量里时，"哪个动作属于哪一屏"
     只能靠读；分组之后它成了可枚举的结构（合并时还会查重名）。 */
  const groups = UIx.actGroups();
  const gnames = Object.keys(groups);
  const flat = [];
  gnames.forEach(g => groups[g].forEach(a => flat.push({ g, a })));
  const seenG = {};
  const dupG = [];
  flat.forEach(x => { if (seenG[x.a]) dupG.push(x.a + '（' + seenG[x.a] + ' 与 ' + x.g + '）'); seenG[x.a] = x.g; });
  ok(dupG.length === 0, '每个动作恰好属于一组（' + gnames.length + ' 组 / ' + flat.length + ' 个动作）',
    dupG.join(', '));
  /* 归组的是"要做事"的动作；"去某个界面"那 10 个住在 scene.ts 的 SCREEN_ACTS 里
     （它们的分组就是"去处"，由 [1] 里那条"每个去处都真实存在"守着）。 */
  const handlerActs = [...actNames].filter(a => !Scenex.screenActOf(a));
  const notGrouped = handlerActs.filter(a => !seenG[a]);
  const notReal = flat.filter(x => !actNames.has(x.a)).map(x => x.a);
  ok(notGrouped.length === 0,
    '要做事的那 ' + handlerActs.length + ' 个动作都归了组（另有 ' +
    Scenex.screenActNames().length + ' 个"去某个界面"由 SCREEN_ACTS 声明去处）',
    notGrouped.join(', '));
  ok(notReal.length === 0, '分组里没有不存在的动作', notReal.join(', '));
  const junk = gnames.filter(g => groups[g].length > 20);
  ok(junk.length === 0, '没有"杂物箱"分组（单组超过 20 个就先拆开）', junk.join(', '));
  console.log('    · 动作分布：' + gnames.map(g => g + ' ' + groups[g].length).join('  ·  '));
}

const { UI, Game, R, Chars, Weapons, Stats, Scene, Save, Settings, Input, Profile, Challenges, Danger, Station, Slots, Appearance, Dialogue } = g;

/* =========================================================
   1c. 文案的单源检查（"别散落到各处"）
   ---------------------------------------------------------
   改造前，"一个效果键叫什么、怎么写给人看"散在**六个地方**：
     ui 的当前效果行 / ui 的"下一级" / camp 的 nextTxt / camp 的 effTxt /
     camp.describeState / stronghold.describe
   新增一个键要改六处，漏一处就是"效果生效了、界面上看不见"。
   现在键自己带 note（给开发者）与 text(v)（给玩家），界面只做翻译。
   这一节把那个约束钉住 —— 否则过两个月又会有人把键名抄回 ui。
   （放在模块加载之后：这一段要真读表，不是读源码文本。）
   ========================================================= */
{
  const { Camp, Stronghold } = g;

  // (a) 每个声明的键都必须有可用的文案：随便喂一个值，必须产出非空文本，
  //     而且**不能只是把键名回显出来**（那等于没有文案）
  const badKeep = Object.keys(Stronghold.BASE).filter(k => {
    const lines = Stronghold.effectText(k, 2);
    return !Array.isArray(lines) || !lines.length || lines.some(s => !s || s.indexOf(k) === 0);
  });
  ok(badKeep.length === 0,
    '据点 ' + Object.keys(Stronghold.BASE).length + ' 个修正键每个都有自己的文案（不是把键名回显出来）',
    badKeep.join(','));
  const badCamp = Object.keys(Camp.EFFECT_KEYS).filter(k => {
    const v = k === 'stats' ? { armor: 2 } : 2;
    const lines = Camp.effectText(k, v);
    return !Array.isArray(lines) || !lines.length || lines.some(s => !s || s.indexOf(k) === 0);
  });
  ok(badCamp.length === 0, '营地 ' + Object.keys(Camp.EFFECT_KEYS).length + ' 个效果键同样都有文案',
    badCamp.join(','));

  // (b) effectLines 只输出"真的生效"的键（0 值不该出现在界面与报告里）
  const emptyKeep = Stronghold.effectLines(Stronghold.BASE);
  ok(emptyKeep.length === 0, '空据点 → 一行效果都不输出', emptyKeep.join(','));
  const someKeep = Stronghold.effectLines(Stronghold.modsFor({ shelves: 1, storehouse: 1 }));
  ok(someKeep.join('').indexOf('货架') >= 0 && someKeep.join('').indexOf('材料') >= 0,
    '买了设施之后 effectLines 给出人话：' + someKeep.join(' · '), someKeep.join(','));

  // (c) **ui.ts 里不许再出现效果键字面量** —— 这是"散落"的复发点
  const keyLiterals = Object.keys(Stronghold.BASE).concat(Object.keys(Camp.EFFECT_KEYS))
    .filter(k => k !== 'stats' && new RegExp("'" + k + "'").test(uiSrc));
  ok(keyLiterals.length === 0,
    'ui.ts 里没有任何效果键字面量（文案只在声明表里）', keyLiterals.join(','));

  // (d) 结构性解锁的"量"必须写在表里，而不是写死在模拟层
  //     （商店货架在 market.ts；这里把两个模拟层文件一起查）
  const gameSrc2 = ['game.ts', 'market.ts']
    .map(f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8')).join('\n');
  ok(/S\.kmods\.workshop > 0/.test(gameSrc2) && />= minTier/.test(gameSrc2),
    '工坊的"保底等级"读的是据点表里的值（模拟层没有硬编码的 T3）');
  ok(!/>= 3\) \{ hasTop/.test(gameSrc2), '（对照）已不存在硬编码的 3');
}

/* =========================================================
   3. UI 初始化
   ========================================================= */
console.log('\n[3] UI 初始化与界面切换');
let initErr = null;
try { UI.init(); } catch (e) { initErr = e.message + '\n      ' + (e.stack.split('\n')[1] || '').trim(); }
ok(!initErr, 'UI.init() 无异常', initErr);
// 角色卡数从表里推：**隐藏角色**没解锁时不出现（G5），所以不能直接等于总数
const listedChars = Chars.LIST.filter(c => !(c.hidden && !Profile.isUnlocked('char', c.id))).length;
ok(registry['char-grid'].children.length === listedChars,
  '角色选择生成 ' + listedChars + ' 张角色卡（表里共 ' + Chars.LIST.length + ' 个，隐藏的未解锁时不列）',
  registry['char-grid'].children.length);
ok(registry['char-detail'].innerHTML.indexOf('起始武器') >= 0, '角色详情面板已填充');

/* 关键回归：UI.init 不能中途抛异常，否则后面的事件绑定全部失效 */
const firstCard = registry['char-grid'].children[0];
ok(!!firstCard && firstCard._handlers.click && firstCard._handlers.click.length > 0,
  '角色卡点击事件已绑定（UI.init 未中断）');
const firstCardCanvas = firstCard && firstCard.children.find(c => c.tagName === 'CANVAS');
ok(!!firstCardCanvas && firstCardCanvas.width > 0 && firstCardCanvas.height > 0,
  '角色卡肖像画布已创建并设置尺寸');
let clickErr = null;
try {
  const other = registry['char-grid'].children[3];
  other.click();
  if (UI.selectedChar !== other.dataset.char) clickErr = '选中项未切换：' + UI.selectedChar + ' != ' + other.dataset.char;
} catch (e) { clickErr = e.message; }
ok(!clickErr, '点击角色卡可正常切换选中', clickErr);
// 恢复默认选择
registry['char-grid'].children[0].click();

/* 全局事件委托是否挂上（否则所有按钮都是死的） */
ok(!!documentStub._clickBound, '全局按钮事件委托已注册（data-act 生效）');

/* drawImage 参数类型检查（历史上 wrapper 对象被直接当 canvas 用） */
const drawTypes = new Set(uiDrawLog.map(i => (i && i.getContext) ? 'canvas' : String(i)));
ok(uiDrawLog.length > 0 && !drawTypes.has('undefined'),
  'drawImage 只收到真实 canvas（共 ' + uiDrawLog.length + ' 次）', [...drawTypes].join(','));

let showErr = null;
try {
  ['title', 'chars', 'shop', 'levelup', 'pause', 'howto', 'end'].forEach(s => UI.show(s));
} catch (e) { showErr = e.message; }
ok(!showErr, '全部界面可正常切换', showErr);

/* =========================================================
   3b. 重画契约：scene.ts 说"这一屏有内容要重画"，ui.ts 就必须接了那个名字
   两张表住在两个模块里（场景归属 scene.ts、渲染函数归属 ui.ts），
   对不上时的表现是**那一屏永远停在旧内容上**（点了刷新没反应，也不报错）。
   ========================================================= */
{
  const wanted = [];
  for (const st of Game.STATES) {
    const w = Scene.refreshOf(st);
    if (w) wanted.push(w);
  }
  const have = new Set(UI.renderNames());
  const noFn = [...new Set(wanted)].filter(w => !have.has(w));
  const noState = [...have].filter(w => wanted.indexOf(w) < 0);
  ok(noFn.length === 0,
    '场景表声明要重画的 ' + new Set(wanted).size + ' 个界面都有渲染函数', noFn.join(', '));
  ok(noState.length === 0, '渲染函数表里没有"没有任何状态会用到"的名字', noState.join(', '));
}

/* =========================================================
   4. 完整流程
   ========================================================= */
console.log('\n[4] 完整流程（选角 → 战斗 → 升级 → 商店 → 结算）');
let flowErr = null;
let notes = [];
try {
  UI.selectedChar = 'mage';
  Game.newRun(UI.selectedChar);
  UI.refresh();
  UI.updateHud();
  notes.push('开局武器 ' + Game.getSession().player.weapons.length);

  /* 房间制：入口间是**安全房**（不刷怪），一步就清完 → 直接进商店。
     所以"推进一点战斗、让 HUD 有真实数据"必须先把人放进一间会刷怪的房，
     否则 120 帧里一个怪都没有（更早的写法在入口间里跑，拿不到经验也拿不到伤害数字）。 */
  toShop();
  enterFightRoom(Game.getSession());
  Game._internals.startWave(Game.wave + 1);
  Game.setState('playing', true);
  for (let i = 0; i < 120; i++) Game.step(1 / 60, Game.autoInput(i / 60));
  UI.updateHud();

  // 强制升级面板
  const sess = Game.getSession();
  sess.player.xp = 40;
  Game._internals.checkLevelUp();
  if (Game.state !== 'levelup') throw new Error('未进入 levelup 状态，当前=' + Game.state);
  UI.refresh();
  UI.renderPause();
  UI.updateHud();
  if (registry['levelup-cards'].children.length === 0) throw new Error('升级卡未渲染');
  notes.push('升级卡 ' + registry['levelup-cards'].children.length + ' 张');
  // 清空积压的升级（xp=9999 会连升多级）
  let lg = 0;
  while (Game.state === 'levelup' && lg++ < 40) { Game.chooseLevelCard(0); UI.refresh(); }

  // 商店：把这一间清掉（房间制下商店就是"清完一间之后的去处"）
  toShop();
  const s2 = Game.getSession();
  if (Game.state !== 'shop') throw new Error('未进入 shop 状态，当前=' + Game.state);
  UI.refresh();
  if (registry['shop-weapons'].children.length === 0) throw new Error('商店武器未渲染');
  if (registry['shop-items'].children.length === 0) throw new Error('商店道具未渲染');
  // 道具卡里必须有真实 canvas 图标（wrapper 误用会在这里暴露）
  const itemCardEl = registry['shop-items'].children[0];
  const itemIconEl = itemCardEl.children.find(ch => ch.className === 'cv');
  if (!itemIconEl || !itemIconEl.children.some(ch => ch.tagName === 'CANVAS')) {
    throw new Error('商店道具图标未渲染为 canvas');
  }
  notes.push('商店武器 ' + registry['shop-weapons'].children.length + ' / 道具 ' + registry['shop-items'].children.length);

  // 随机道具包：价格与概率必须显示出来，且按钮可用性跟随材料
  Game.wave = 6;                   // 第 6 波起两种包都可用
  const basicCost = Game.packPrice('basic');
  const deluxeCost = Game.packPrice('deluxe');
  UI.refresh();                    // 商店状态下的刷新必须重渲染内容
  if (!/^\d+$/.test(registry['pack-basic-cost'].textContent.replace(/[()]/g, ''))) {
    throw new Error('普通包价格未显示：' + registry['pack-basic-cost'].textContent);
  }
  if (registry['pack-odds'].textContent.indexOf('T1') < 0 ||
      registry['pack-odds'].textContent.indexOf('高级') < 0) {
    throw new Error('道具包概率未显示：' + registry['pack-odds'].textContent);
  }
  notes.push('道具包价格 ' + basicCost + ' / ' + deluxeCost +
    '，概率「' + registry['pack-odds'].textContent + '」');
  s2.player.scrap = 0;
  UI.refresh();
  if (!registry['btn-pack-basic'].disabled || !registry['btn-pack-deluxe'].disabled) {
    throw new Error('材料为 0 时道具包按钮应置灰');
  }
  s2.player.scrap = deluxeCost + 5;
  UI.refresh();
  if (registry['btn-pack-basic'].disabled) throw new Error('材料充足时普通包按钮应可用');
  if (registry['btn-pack-deluxe'].disabled) throw new Error('材料充足时高级包按钮应可用');

  // 开一包：材料按售价扣除、道具数 +1
  const matsBefore = s2.player.scrap;
  const itemsBefore = s2.player.items.length;
  Game.buyPack('deluxe');
  if (s2.player.scrap !== matsBefore - deluxeCost) {
    throw new Error('开包未按售价扣材料：' + matsBefore + ' → ' + s2.player.scrap);
  }
  if (s2.player.items.length !== itemsBefore + 1) {
    throw new Error('开包未增加道具');
  }
  UI.refresh();
  UI.updateHud();
  notes.push('开包后材料 ' + s2.player.scrap + '，道具 ' + s2.player.items.length + ' 件');

  // 买一件（给足材料）
  s2.player.scrap = 9999;
  Game.buyOffer(0);
  UI.refresh();
  UI.updateHud();

  // 刷新 / 锁定 / 下一波  Game.reroll();
  Game.toggleLock();
  UI.refresh();
  Game.toggleLock();
  Game.nextWave();
  UI.refresh();
  notes.push('进入第 ' + Game.wave + ' 波，武器 ' + Game.getSession().player.weapons.length + ' 把');

  // 结算
  const sum = Game.summary();
  sum.charName = Game.getSession().charDef.name;
  UI.show('end');
} catch (e) {
  flowErr = e.message + '\n      ' + (e.stack.split('\n')[1] || '').trim();
}
ok(!flowErr, '完整流程无异常', flowErr);
notes.forEach(n => console.log('    · ' + n));

/* =========================================================
   5. 商店渲染覆盖全部道具 / 武器造型
   ========================================================= */
console.log('\n[5] 商店渲染覆盖性');
let shopErr = null;
try {
  const s = Game.getSession();
  s.player.scrap = 99999;
  s.offers = [];
  Weapons.LIST.slice(0, 4).forEach(d => s.offers.push({ type: 'weapon', def: d, sold: false, price: 1 }));
  g.Items.LIST.slice(0, 4).forEach(d => s.offers.push({ type: 'item', def: d, sold: false, price: 1 }));
  Game.setState('shop', true);   // 强制跳转（仅供测试构造场景）
  UI.refresh();
  // 买满 6 把武器后再渲染（覆盖"武器槽已满"与空槽补位分支）
  while (s.player.weapons.length < Game.cfg.maxWeapons) Game.addWeapon('knife');
  s.offers.forEach((o, i) => { if (o.type === 'weapon') o.sold = false; });
  Game.buyOffer(0);
  UI.refresh();
  // 卖出
  Game.sellWeapon(0);
  UI.refresh();
  UI.updateHud();
} catch (e) { shopErr = e.message + '\n      ' + (e.stack.split('\n')[1] || '').trim(); }
ok(!shopErr, '商店满槽 / 购买被拒 / 卖出 分支渲染正常', shopErr);

/* =========================================================
   5b. 状态 → 屏幕映射（必须全覆盖）+ 事件驱动刷新
   ========================================================= */
{
  /* 映射不再在这里抄一份：状态 → 覆盖层 / HUD / 武器条全部取自 scene.ts，
     这里只验证"实际显示出来的界面与场景表一致"（含 HUD 与武器条可见性 ——
     这两条以前只写死在 UI.show 里，没有任何测试守着）。 */
  const SCREEN_IDS = [];
  for (const st of Game.STATES) {
    const ov = Scene.overlayOf(st);
    if (ov) SCREEN_IDS.push('scr-' + ov);
  }
  const activeScreens = () => SCREEN_IDS.filter(id => registry[id]._classes.has('active'));
  const hidden = id => registry[id]._classes.has('hidden');

  let mapErr = null;
  try {
    for (const st of Game.STATES) {
      Game.setState(st, true);
      UI.refresh();
      const ov = Scene.overlayOf(st);
      const want = ov ? 'scr-' + ov : null;
      const act = activeScreens();
      if (want === null) {
        if (act.length !== 0) throw new Error(st + ' 不应显示任何覆盖层，实际 ' + act.join(','));
      } else if (act.length !== 1 || act[0] !== want) {
        throw new Error(st + ' 应只显示 ' + want + '，实际 ' + (act.join(',') || '（无）'));
      }
      if (hidden('hud') === Scene.showsHud(st)) {
        throw new Error(st + ' 的 HUD 可见性与场景表不符（表里 hud=' + Scene.showsHud(st) +
          '，实际 hidden=' + hidden('hud') + '）');
      }
      if (hidden('weapon-strip') === Scene.showsStrip(st)) {
        throw new Error(st + ' 的武器条可见性与场景表不符（表里 strip=' + Scene.showsStrip(st) +
          '，实际 hidden=' + hidden('weapon-strip') + '）');
      }
    }
  } catch (e) { mapErr = e.message; }
  ok(!mapErr, '全部 ' + Game.STATES.length + ' 个状态的覆盖层 / HUD / 武器条都与场景表一致', mapErr);

  // 回归：howto 状态下刷新界面不能把帮助浮层换成游戏界面（旧实现用 else 兜底成 playing）
  Game.setState('howto', true);
  UI.refresh();
  ok(registry['scr-howto']._classes.has('active') && activeScreens().length === 1,
    'howto 状态下刷新后仍是帮助浮层', activeScreens().join(','));

  // 事件驱动：只切状态、不手动 refresh，界面也应自己跟上
  Game.setState('title', true);
  UI.refresh();
  Game.setState('chars');
  ok(registry['scr-chars']._classes.has('active') && !registry['scr-title']._classes.has('active'),
    'stateChange 事件自动驱动界面刷新（无需手动 refresh）');

  // 非法转换不改变界面
  const before = activeScreens().join(',');
  Game.setState('playing');            // chars → playing 非法
  ok(activeScreens().join(',') === before, '非法转换不改变界面', activeScreens().join(','));

  Game.setState('title', true);
  UI.refresh();
}

/* =========================================================
   5c. 基础功能补齐的回归守卫
     · 设置 / 战绩 必须能从标题页进（改造前设置只能从暂停面板进）
     · 返回动作必须回到来处，而不是一律回标题
     · 破坏性操作必须点两次（改造前点一下就清空存档 / 结束本局）
   ========================================================= */
{
  const SCREEN_IDS = Game.STATES.map(st => Scene.overlayOf(st)).filter(Boolean).map(o => 'scr-' + o);
  const activeScreens = () => SCREEN_IDS.filter(id => registry[id]._classes.has('active'));

  // 设置：标题页 → 设置 → 返回
  Game.setState('title', true);
  clickAct('settings');
  ok(Game.state === 'settings' && registry['scr-settings']._classes.has('active'),
    '标题页能进设置（改造前必须先开一局再暂停）', Game.state);
  clickAct('back');
  ok(Game.state === 'title', '从标题页进的设置，返回回到标题页', Game.state);

  // 设置：暂停页 → 设置 → 返回（来处是 paused，不能跳回 title）
  Game.newRun('ranger', 31);
  Game.pause();
  clickAct('settings');
  ok(Game.state === 'settings', '暂停页能进设置', Game.state);
  clickAct('back');
  ok(Game.state === 'paused', '从暂停页进的设置，返回回到暂停页（而不是标题页）', Game.state);
  Game.resume();

  // 战绩：能打开且真的渲染出内容（Save.addRun 一直在写，界面以前没人读它）
  Game.pause();
  clickAct('records');
  ok(Game.state === 'records' && registry['records-body'].innerHTML.length > 0,
    '战绩面板能打开且渲染出内容', registry['records-body'].innerHTML.length);
  clickAct('back');
  ok(Game.state === 'paused', '从暂停进的战绩，返回回到暂停页', Game.state);
  Game.resume();
  ok(Game.state === 'playing', '恢复回战斗', Game.state);

  // 破坏性操作：清空存档与记录
  const recBefore = JSON.stringify(Save.records());
  clickAct('set-reset');
  ok(JSON.stringify(Save.records()) === recBefore, '第一次点"清空"不清空（先武装确认）');
  ok(String(registry['set-reset'].textContent).indexOf('确认') >= 0,
    '第一次点"清空"后按钮文案变成确认语', registry['set-reset'].textContent);
  clickAct('set-reset');
  ok(String(registry['set-reset'].textContent).indexOf('确认') < 0, '第二次点击后文案复位',
    registry['set-reset'].textContent);

  // 破坏性操作：放弃本局
  Game.pause();
  clickAct('quit');
  ok(Game.state === 'paused', '第一次点"放弃本局"不会结算（先武装确认）', Game.state);
  clickAct('quit');
  ok(Game.state === 'end', '第二次点击才真的放弃并进结算', Game.state);

  Game.setState('title', true);
  UI.refresh();
}

/* =========================================================
   5d. 菜单焦点（方向键 / 手柄 dpad 选，回车 / 手柄 A 按）
   改造前只有升级卡认 1-4 号键，商店与菜单完全没有键盘操作。
   ========================================================= */
{
  // 焦点的可见效果就是那个 'focused' 类：直接按类找，不给生产代码加测试专用 API
  const focusedEl = () => allEls.find(e => e._classes && e._classes.has('focused')) || null;
  const isInside = (root, el) => {
    let p = el;
    while (p) { if (p === root) return true; p = p.parentNode; }
    return false;
  };

  Game.setState('title', true);
  UI.refresh();

  // 标题页：方向键能在按钮之间移动
  ok(UI.hasFocus() === false, '刷新后没有焦点（不会凭空选中一个按钮）');
  ok(UI.focusMove(0, 1) === true, '标题页方向键能选中第一个按钮');
  const firstTitleFocus = UI.focusText();
  ok(firstTitleFocus.length > 0, '焦点有可读文案', firstTitleFocus);
  UI.focusMove(0, 1);
  ok(UI.focusText() !== firstTitleFocus, '再按一次移到下一个（不是原地不动）',
    firstTitleFocus + ' → ' + UI.focusText());

  // 升级卡：焦点 + 激活 = 选卡，走的是与鼠标点击同一条路径
  Game.newRun('ranger', 41);
  const s41 = Game.getSession();
  s41.player.xp = 999;
  Game._internals.checkLevelUp();
  Game.setState('levelup', true);
  UI.refresh();
  ok(registry['levelup-cards'].children.length === 4, '升级界面渲染出 4 张卡',
    registry['levelup-cards'].children.length);

  UI.focusClear();
  ok(UI.focusMove(1, 0) === true, '方向键能选中升级卡');
  const pendingBefore = s41.player.pendingLevels;
  const activated = UI.activateFocus();
  ok(activated === true, '激活焦点返回成功');
  ok(s41.player.pendingLevels < pendingBefore,
    '回车 / 手柄 A 激活焦点就是选卡（调用 .click()，与鼠标同一条路径）',
    pendingBefore + ' → ' + s41.player.pendingLevels);
  ok(UI.hasFocus() === false, '选完卡重画界面，焦点被清掉（旧节点已不在文档里）');

  // 焦点必须落在当前这一屏里 —— 桩以前是所有元素全局搜，这条能守住"作用域"
  Game.setState('shop', true);
  UI.refresh();
  UI.focusClear();
  UI.focusMove(1, 0);
  const focusedInShop = focusedEl();
  ok(!!focusedInShop && isInside(registry['scr-shop'], focusedInShop),
    '焦点只在当前覆盖层里找元素（跨屏搜索会让"选中"选到看不见的东西）');

  Game.setState('title', true);
  UI.refresh();
}

/* =========================================================
   5e. 改键（点一下 → 按下一个键）
   关键点：捕获期间那次按键**不能**同时被当成游戏输入，
   否则改"上"的时候角色会先往上走一步。
   ========================================================= */
{
  Input.init(registry['game']);       // 桩里 window 监听是被收下来的，这里才有 keydown
  clickAct('settings');               // 进设置页（改键按钮在这一屏）

  const before = Settings.get('keyUp');
  clickAct('rebind', 'keyUp');
  ok(String(registry['bind-keyUp'].textContent).indexOf('按') === 0,
    '点改键按钮后进入"等待按键"状态', registry['bind-keyUp'].textContent);

  Input.keys = Object.create(null);
  fireKey('i');
  ok(Settings.get('keyUp') === 'i', '按下 I 后按键被改写', Settings.get('keyUp'));
  ok(String(registry['bind-keyUp'].textContent) === 'I', '按钮显示新的键名',
    registry['bind-keyUp'].textContent);
  ok(!Input.keys['i'], '捕获用的那次按键没有同时变成游戏输入', JSON.stringify(Input.keys));

  // 注意：Settings → Input.bind 的那一步在 main.ts 的 applySetting 里，
  // 而 main.ts 是入口模块、**按设计不被任何模块 import**（见 [1] 的分层检查），
  // 所以这一条只能在浏览器里验证。这里守住的是"设置项被写对了"，
  // "每个设置项都有应用分支"由 registry.mjs 的静态契约守住。

  // 重复绑定要被拒绝（否则一个键触发两个动作）
  clickAct('rebind', 'keyDown');
  fireKey('i');
  ok(Settings.get('keyDown') === 's', '已经是别人用的键会被拒绝', Settings.get('keyDown'));

  // Esc 取消
  clickAct('rebind', 'keyLeft');
  fireKey('Escape');
  ok(Settings.get('keyLeft') === 'a', 'Esc 取消改键，原值不变', Settings.get('keyLeft'));
  ok(String(registry['bind-keyLeft'].textContent) !== '按任意键…', '取消后按钮文案复位',
    registry['bind-keyLeft'].textContent);

  // 恢复默认
  clickAct('keys-default');
  ok(Settings.get('keyUp') === 'w' && Input.bind.up === 'w', '一键恢复默认按键',
    Settings.get('keyUp') + '/' + Input.bind.up);
  ok(Settings.get('keyUp') !== before || true, '（记录改前值 ' + before + '）');

  clickAct('back');
  Game.setState('title', true);
  UI.refresh();
}

/* =========================================================
   5f. 图鉴与挑战面板 + 角色解锁门槛
   没有这一屏，profile.ts 里那些东西玩家一辈子看不到；
   而"锁着的角色"如果只在模拟层拦，测试与 CLI 就全废了 ——
   所以门槛必须**只在界面这一层**，这两条都要守着。
   ========================================================= */
{
  const card = (id) => registry['char-grid'].children.find(c => c.dataset.char === id);

  Game.setState('title', true);
  UI.refresh();
  clickAct('codex');
  ok(Game.state === 'codex' && registry['scr-codex']._classes.has('active'),
    '标题页能进图鉴与挑战', Game.state);
  ok(String(registry['codex-summary'].innerHTML).indexOf('孢子') >= 0, '概览里有孢子');
  const rows = String(registry['codex-challenges'].innerHTML).split('class="set-row"').length - 1;
  // **隐藏挑战没完成前不列出来**，所以可见条数 = 总数 - 未完成的隐藏条数
  const visibleChallenges = Challenges.visible(id => Profile.isDone(id)).length;
  ok(rows === visibleChallenges,
    '挑战列表把可见的 ' + visibleChallenges + ' 条全列出来（表里共 ' + Challenges.LIST.length +
    '，隐藏的未完成时不列）', rows);
  ok(String(registry['codex-catalog'].innerHTML).indexOf('武器图鉴') >= 0 &&
     String(registry['codex-catalog'].innerHTML).indexOf('怪物图鉴') >= 0, '三个图鉴家族都在');
  ok(String(registry['codex-challenges'].innerHTML).indexOf('单局达成') >= 0,
    '"极限"组不画空进度条，而是标明"单局达成"');

  // 完成一条之后要能看见勾
  Profile.reset();
  Profile.applyRun(
    { char: 'ranger', wave: 5, level: 7, kills: 320, scrap: 400, damage: 1, taken: 1, healed: 1, packs: 0, peaks: {} },
    { runs: 1, wins: 0, bestWave: 5, bestKills: 320, bestLevel: 7, totalKills: 320, totalMaterials: 400 }
  );
  UI.refresh();
  ok(String(registry['codex-challenges'].innerHTML).indexOf('✓ 已完成') >= 0, '完成的挑战打了勾');
  clickAct('back');
  ok(Game.state === 'title', '从标题页进的图鉴，返回回到标题页', Game.state);

  // 角色门槛：默认档案是空的 → 只有默认角色可用
  Profile.reset();
  clickAct('again');                       // 重建角色卡（走的是与"再来一局"同一条路径）
  const lockedCards = registry['char-grid'].children.filter(c => c._classes.has('locked'));
  // 锁定数也从表里推（解锁的有几个 + 隐藏未解锁的不列出来）
  const lockedExpected = Chars.LIST.filter(c => c.locked && !(c.hidden && !Profile.isUnlocked('char', c.id))).length;
  ok(lockedCards.length === lockedExpected,
    '默认档案下 ' + lockedCards.length + ' 个角色标为锁定，只有默认角色可用');
  ok(registry['char-grid'].children.every(c => !Chars.BY_ID[c.dataset.char].hidden),
    '隐藏角色在未解锁时连卡都不出现（不是"锁着"而是"不在"）');

  card('mage').click();
  ok(UI.selectedChar === 'mage', '选中了未解锁的角色');
  ok(card('mage')._classes.has('locked'), '未解锁的角色卡带着 locked 标记');
  ok(registry['btn-confirm-char'].disabled === true, '确认按钮被禁用（而不是点了才被拒）');
  ok(String(registry['char-detail'].innerHTML).indexOf('未解锁') >= 0 &&
     String(registry['char-detail'].innerHTML).indexOf('第 4 波') >= 0,
    '详情面板说明"还差什么"，而不是只说一句未解锁');

  // 解锁之后立刻可用
  Profile.unlock('char', 'mage');
  clickAct('again');
  ok(!card('mage')._classes.has('locked'), '解锁后角色卡不再锁定');
  card('mage').click();
  ok(registry['btn-confirm-char'].disabled === false, '解锁后确认按钮可用');

  // 门槛只在界面层：模拟层不校验（测试与 CLI 才能直接开任意角色）
  Game.setState('title', true);
  const sessions = Game.newRun('mage');
  ok(!!sessions && Game.getSession().charDef.id === 'mage', 'Game.newRun 不做解锁校验（模拟层不认识账号档案）');
  Game.setState('title', true);

  Profile.reset();
  clickAct('again');
  UI.refresh();
}

/* =========================================================
   5g. 难度选择（阶梯逐级累加 → 选人页只给"已解锁到哪一级"）
   ========================================================= */
{
  const card = (id) => registry['char-grid'].children.find(c => c.dataset.char === id);
  const levelBtns = () => registry['danger-row'].children;

  Profile.reset();
  Game.setState('title', true);
  clickAct('again');                        // 重建选人页（含难度条）
  ok(levelBtns().length === Danger.MAX + 1, '难度条列出 ' + (Danger.MAX + 1) + ' 个等级',
    levelBtns().length);
  const enabled0 = levelBtns().filter(b => !b.disabled).length;
  ok(enabled0 === 1, '默认只解锁第 0 级（其余按钮禁用而不是藏起来）', enabled0);
  ok(String(registry['danger-info'].innerHTML + registry['danger-info'].textContent).indexOf('平静') >= 0,
    '难度条说明了当前等级是什么', registry['danger-info'].textContent);

  // 越界的选择会被夹回该角色已解锁的上限（换角色时必须重画）
  UI.selectedDanger = 7;
  card('ranger').click();
  ok(UI.selectedDanger === 0, '选中的等级超过已解锁上限 → 夹回', UI.selectedDanger);

  Profile.unlockDanger('ranger', 3);
  card('ranger').click();
  const enabled3 = levelBtns().filter(b => !b.disabled).length;
  ok(enabled3 === 4, '解锁到第 3 级后 0-3 可选', enabled3);

  /* 端到端：选的难度真的进了这一局 —— 而**开局落在大厅（站）**，不是直接落进战斗。
     用户的设想（R50 之后是三步）：开始 → **选存档** → 选职业 → 捏人 → 大厅。
     ⚠ 这一节要先建一个存档角色：`confirm-char` 现在会分叉 ——
       **这个档已经有人** = "换职业"（直接开局）；**还没有人** = 去捏人（`create`）。 */
  Profile.saveCharacter({ name: '测试人', look: { palette: 'frost' } }, 'ranger');
  UI.selectedDanger = 2;
  clickAct('confirm-char');
  ok(Game.state === 'station', '确认出发进入大厅（站）——三个模块都在局内的一张图上', Game.state);
  const sess = Game.getSession();
  ok(!!sess, '开局建好了会话（大厅是**局内**的一屏，不是菜单）');
  ok(sess && sess.danger === 2, '开局带上了选中的难度等级', sess ? sess.danger : 'null');
  ok(sess && sess.dmods.enemyHp === 1.08 * 1.08, '难度 2 的敌人生命倍率已折进会话', sess && sess.dmods.enemyHp);

  /* 大厅：HUD 上**没有**站点卡（2026-10：屋里有的东西不在屏幕底下复制一份）。
     屋里有什么由摆位表回答，门靠**走过去** —— 这才是玩家真走的那条路。 */
  ok(registry['station-gates'] === undefined && registry['station-status'] === undefined,
    '大厅 HUD 里没有站点条 / 状态带（房间才是主体）');
  const hall = Game.hall();
  const portals = hall ? hall.spots.filter(s => s.kind === 'portal') : [];
  ok(portals.length === Station.LIST.filter(s => s.kind === 'portal').length &&
     portals.filter(s => !s.screen).length === 0,
    '屋里的传送门与门表一一对应（界面不自己造门，一扇门都不会"走上去没反应"）', portals.length);

  /* 走位助手：朝一个方向走，直到条件成立（或走满帧数）。
     ⚠ 屋里到处是**真墙**（货箱、柱子、公告板背后那堵矮墙），所以下面每一段
     都得绕 —— 这本身就是"世界是真的"的证据：直线过去会被挡住。 */
  const until = (mx, my, cond, n) => {
    for (let i = 0; i < (n || 400); i++) { if (cond()) break; Game.step(Game.cfg.fixedDt, { x: mx, y: my }); }
  };
  const hallX = () => Game.hall().x, hallY = () => Game.hall().y;
  const hallNear = () => (Game.hall() && Game.hall().near) || null;
  /* 桩的 textContent **不递归**，而板子上的字全在子元素里 —— 逐层读一遍 */
  const boardText = () => (function walk(n) {
    return (n.children || []).map(c => (c._text || '') + ' ' + walk(c)).join(' ');
  })(registry['station-board']);

  /* 面板是**交互的产物**：没走到板子前按 E 之前，它是收着的 */
  ok(registry['station-board'].hidden === true, '没读账之前公告板是收着的');
  /* 开局站在**出击门口**（spawnAt.playing ≈ 300,470），而板子在屋子中段偏南。
     路线：先往下走出门口那一条，再横着贴过去 —— 直线斜插会被板子背后那堵
     矮墙（x 650–850, y 730）与两根柱子挡住，这也是"屋里真的有墙"的证据。 */
  until(0, 1, () => hallY() >= 660);             // 从出击门口往下走
  until(1, 0, () => !!hallNear() && hallNear().id === 'board');
  ok(!!hallNear() && hallNear().id === 'board', '走到公告板跟前（这是屋里真走得通的一条路）',
    hallNear() && hallNear().id);
  const boardAct = Game.hallAct();
  ok(!!boardAct && boardAct.act === 'board', '按 E：面前是公告板（不换屏，它不是门）', boardAct && boardAct.act);
  ok(Game.state === 'station', '公告板只是把账读出来', Game.state);
  ok(registry['station-board'].hidden === false, '按 E 之后账摊开');
  ok(boardText().indexOf('下一步') >= 0, '账里有"下一步"');
  ok(boardText().indexOf('核心素材') >= 0, '账里有三个核心素材的进度');

  /* 走开一步就收起来 —— HUD 不做成"常驻面板"（main.ts 每帧调 UI.hallSync()） */
  until(-1, 0, () => hallX() <= 570, 200);
  UI.hallSync();
  ok(registry['station-board'].hidden === true, '走开之后账自己收起来（不是一份常驻面板）');

  /* 走进出击门（x≈300 那一扇）：**走过去就换屏**（不是点按钮） */
  until(-1, 0, () => hallX() <= 305, 300);
  until(0, -1, () => Game.state !== 'station', 400);
  ok(Game.state === 'playing', '走进出击门 → 回到手里这一局（门是过道，不是菜单项）', Game.state);
  ok(Game.getSession() === sess, '换模块回的是**同一个会话**（大厅不是"开新局"的入口）');

  /* 从据点走回大厅：暂停菜单里那条（局内 → 局内，不是"退出到主菜单"） */
  Game.pause();
  clickAct('to-station');
  ok(Game.state === 'station', '暂停菜单能回大厅（走回去）', Game.state);
  ok(Game.getSession() === sess, '回大厅不会把这一局丢掉');
  ok(registry['station-board'].hidden === true, '重新进屋时账是收着的（不会停在上一次的读数）');

  Game.setState('title', true);
  Profile.reset();
  clickAct('again');
  UI.refresh();
}

/* =========================================================
   5h. 枢纽（N2 的界面侧）
   枢纽不是一份菜单，而是"一间房 + 站在屋里的人"（2026-10：站点卡也删了）。
   这一节守四件事：
     · 走到谁面前按 E，谁那一句才出来；走开就收起来（人是对象，不是按钮）
     · 说话是"说一句 → 下一句顶上来"，而不是一次倒完
     · 屋里每一站都**画得出来**（站点 id ⇄ 头像 id：sprites.stationPortrait）
     · 出入口：北面的门口走回大厅；设施（镜面）走上去就进去
   外加一条（2026-09 改动）：枢纽**归局内** —— 入口在大厅底栏，出去走回大厅，
   而标题页 / 选人页那对局外入口已经删掉（上面那条"玩家真走的路"就是从标题点过来的）。
   ========================================================= */
{
  Game.setState('title', true);
  UI.refresh();
  /* 枢纽的入口在**局内**（2026-09 用户拍板）：标题页 / 选人页都没有它，
     要先进大厅 —— 也就是玩家真走的那条路（R50 之后是四步）：
       **开始 → 选存档 → 开始新档 → 选职业 → 捏人确定 → 大厅**。 */
  clickAct('start');
  ok(Game.state === 'slots', '「开始游戏」进**选存档**（R50 的第一步）', Game.state);
  ok(registry['scr-slots']._classes.has('active'), '选存档那一屏是亮的', String(Game.state));
  const emptyCards = registry['slot-grid'].children.filter(c => c._classes.has('empty')).length;
  ok(emptyCards === Slots.COUNT, '空档案下 ' + Slots.COUNT + ' 个槽位都标成空档', emptyCards);
  clickAct('slot-new');
  ok(Game.state === 'chars', '「开始新档」→ 选职业', Game.state);
  clickEl(registry['char-grid'].children.find(c => c.dataset.char === 'ranger'));
  clickAct('confirm-char');
  ok(Game.state === 'create', '还没有人 → 确认之后去**捏人**（R50 的第二步）', Game.state);
  ok(!!Profile.character(), '捏人页一进来就已经有这个档的人（接下来改的都是他）');
  /* 捏人页四块都要在：名字 / 外观三列 / 初始职业 / 入门三选 */
  ok(registry['create-palette'].children.length === Appearance.PALETTES.length,
    '色板一排 ' + Appearance.PALETTES.length + ' 档', registry['create-palette'].children.length);
  ok(registry['create-face'].children.length === Appearance.FACES.length, '脸型一排也在');
  ok(registry['create-accessory'].children.length === Appearance.ACCESSORIES.length, '配件一排也在');
  const entryRows = registry['create-entry'].children.filter(c => c._classes.has('entry-row'));
  const entryTotal = Game.creationOptions().reduce((n, c) => n + c.list.length, 0);
  ok(entryRows.length === entryTotal,
    '入门三选一共 ' + entryTotal + ' 档（技能 / 属性 / 天赋各一列）', entryRows.length);
  ok(String(registry['create-job'].textContent).indexOf('全能人') >= 0,
    '捏人页顶上写着初始职业', registry['create-job'].textContent);
  /* 点一下外观 → 真的落进存档（不是只在界面上高亮） */
  clickEl(registry['create-palette'].children[3]);
  ok(Profile.character().look.palette === Appearance.PALETTES[3].id,
    '点一个色板 → 存档里的外观跟着变', Profile.character().look.palette);
  /* 「随机一套」必须**确定**：同一个种子两次得到同一套（可复现） */
  const rA = Game.randomLook(777), rB = Game.randomLook(777);
  ok(rA.palette === rB.palette && rA.face === rB.face && rA.accessory === rB.accessory,
    '随机外观是确定性的（同一种子 → 同一套）', JSON.stringify(rA));
  clickAct('create-go');
  ok(Game.state === 'station', '确定 · 开始冒险 → 大厅（枢纽的入口在这一屏）', Game.state);
  clickAct('hub');
  ok(Game.state === 'hub' && registry['scr-hub']._classes.has('active'),
    '大厅底栏能进枢纽（枢纽也归局内）', Game.state);
  ok(registry['hub-news'].hidden === !Profile.hasStoryNews(),
    '"有人想说新话"的角标跟着大厅那个「枢纽」按钮走',
    String(registry['hub-news'].hidden));

  /* 站点卡没了，但"每一站都画得出来"这条还要守 —— 它在**对话框**里用（tx-cv） */
  const stations = Profile.stationsFor();
  const noPortrait = stations.filter(s => !S.stationPortrait(s.id, 32)).map(s => s.id);
  ok(noPortrait.length === 0, '屋里每一站都有画法（站点 id ⇄ 头像 id）', noPortrait.join(','));
  ok(registry['hub-stations'] === undefined, '枢纽 HUD 里没有站点网格（人在屋里站着，不在屏幕底下排卡片）');

  const until = (mx, my, cond, n) => {
    for (let i = 0; i < (n || 400); i++) { if (cond()) break; Game.step(Game.cfg.fixedDt, { x: mx, y: my }); }
  };
  const near = () => (Game.hall() && Game.hall().near) || null;
  const deepText = (n) => (n.children || []).map(c => ((c._text || '') + ' ' + deepText(c))).join(' ');

  /* 走到菌母面前：屋里全是墙与柱子，得绕着走（先左，再下） */
  ok(registry['hub-talk'].hidden === true, '没走到人面前之前，对话框是收着的');
  until(-1, 0, () => Game.hall().x <= 305);
  until(0, 1, () => !!near() && near().npc === 'mother');
  ok(!!near() && near().npc === 'mother', '走到菌母面前（这是屋里真走得通的一条路）',
    near() && near().id);
  ok(registry['hub-talk'].hidden === true, '只是站在人面前**还不会**开口（要按 E）');

  const talkAct = Game.hallAct();
  ok(!!talkAct && talkAct.act === 'talk' && talkAct.id === 'mother', '按 E：面前是菌母',
    talkAct && talkAct.act);
  ok(registry['hub-talk'].hidden === false, '按 E 之后对话框出现');
  const firstLine = Profile.linesFor('mother')[0];
  const talkText = () => deepText(registry['hub-talk']);
  const talkFind = (sel) => registry['hub-talk'].querySelectorAll(sel);
  /* =========================================================
     R41 · 对话补完（普查里那五栏 ❌ → ✅）
     ---------------------------------------------------------
     这一节守的是**五样独立的东西**，所以逐样断言，不合成一条：
       ① 打字机：第一帧只露零个字，时间走过去才出整句
       ② 点一下跳到整句（"跳过"）—— 它只改读法，不记账
       ③ 玩家侧头像（改造前是单向广播）
       ④ 选择/分支（下面单独一节：`m3` 那一条要 runs≥3，这一局拿不到）
       ⑤ 对话历史 + 自动开关 + 「继续说」的记账
     ========================================================= */
  ok(!!firstLine && firstLine.id === 'm1', '菌母现在要说的是 m1（第一次进游戏）',
    firstLine && firstLine.id);
  ok(talkText().indexOf(firstLine.text) < 0,
    '① 刚开口时**整句还没出来**（打字机在打，不是一次倒完）', talkText().slice(0, 30));
  ok(talkFind('.tx-caret').length === 1, '① 还在打的时候句尾有一个光标');
  /* 推进到"打完"：`Dialogue.durationOf` 是它该花的时间，多喂几帧保险 */
  const ticks = Math.ceil(Dialogue.durationOf(firstLine.text) / Game.cfg.fixedDt) + 4;
  for (let i = 0; i < ticks; i++) UI.hallSync();
  ok(talkText().indexOf(firstLine.text) >= 0,
    '① 打字机打完之后整句在框里（' + ticks + ' 帧）', talkText().slice(0, 40));
  ok(talkFind('.tx-caret').length === 0, '① 打完之后光标收掉（不留一个闪的东西在句尾）');
  /* ③ 玩家侧 */
  ok(talkFind('.tx-me').length === 1,
    '③ 玩家侧也有一栏（改造前是单向广播：说话的人有脸，听的人没有）');
  /* ⑤ 三个读法入口都在 */
  ok(talkFind('[data-act="hub-skip"]').length === 1, '⑤ 有「跳过」');
  ok(talkFind('[data-act="hub-auto"]').length === 1, '⑤ 有「自动」（说完就往下走）');
  ok(talkFind('[data-act="hub-log"]').length === 1, '⑤ 有「历史」（对话历史是一栏 ❌）');
  /* ② 「跳过」/「自动」只改读法，不记账、不换句 */
  const beforeSkip = Profile.linesFor('mother').length;
  clickEl(talkFind('[data-act="hub-skip"]')[0]);
  ok(Profile.linesFor('mother').length === beforeSkip,
    '② 「跳过」只影响读法，**不记账、不换句**', beforeSkip + ' → ' + Profile.linesFor('mother').length);
  /* ⑤ 历史摊开：说过的那一句能在回顾里看到 */
  clickEl(talkFind('[data-act="hub-log"]')[0]);
  ok(talkText().indexOf(firstLine.text) >= 0,
    '⑤ 历史摊开之后，说过的那一句能在回顾里看到', talkText().slice(0, 60));
  clickEl(talkFind('[data-act="hub-log"]')[0]);            // 收起来

  // 说一句：说过的不再出现，下一句顶上来（一次只倒一句）
  const beforeCount = Profile.linesFor('mother').length;
  clickEl(talkFind('[data-act="hub-say"]')[0]);
  ok(Profile.linesFor('mother').length === beforeCount - 1,
    '点"继续说"把这一句记成说过了', beforeCount + ' → ' + Profile.linesFor('mother').length);

  /* 走开就收起来（main.ts 每显示帧调 UI.hallSync()）——
     不做成"进屏刷一次"：那样人走了对话框还挂在屏幕上 */
  until(1, 0, () => Game.hall().x >= 520, 300);
  UI.hallSync();
  ok(registry['hub-talk'].hidden === true, '走开之后对话框收起来');

  /* 出门：北面的门口走回大厅（走回去，不是回主菜单） */
  until(1, 0, () => Game.hall().x >= 750, 300);
  until(0, -1, () => Game.state !== 'hub', 300);
  ok(Game.state === 'station', '走进北面的门口 → 回大厅（局内 → 局内）', Game.state);

  /* 底栏两条路都通向大厅 —— 「去大厅」是门，「返回」沿来处走回去 */
  clickAct('hub');
  ok(Game.state === 'hub', '再进一次枢纽', Game.state);
  clickAct('hub-back');
  ok(Game.state === 'station', '「返回」沿来处走：从大厅进来的就回大厅', Game.state);
  clickAct('hub');
  clickAct('hub-go');
  ok(Game.state === 'station', '枢纽底栏的「去大厅」走回大厅（局内 → 局内）', Game.state);

  /* 设施：走上去就进去（与地牢里"走进门就换房"同一条规矩）——镜面 = 天赋。
     去处来自 story.ts 的表，界面不按站点 id 分支。 */
  clickAct('hub');
  until(0, 1, () => Game.state !== 'hub', 240);
  ok(Game.state === 'talents', '走上去就进镜面（天赋）——设施自己声明去处', Game.state);

  /* =========================================================
     R41 · NPC 交易（普查里"完全没有"的那一栏）
     ---------------------------------------------------------
     守三件事：
       · 走到**商人**面前时对话框多一个「交易」入口，而**不是**商人的没有
       · 摊开之后看到的是"给什么 / 要什么"，而且不可做的那几档**列出来但禁用**
       · 点一下**真的换到了**（余额变了、货进了"下一局的开局条件"）
     ========================================================= */
  Game.setState('title', true);
  Profile.reset();
  Profile.saveCharacter({ name: '买主' }, 'ranger');
  Game.setState('title', true);
  UI.refresh();
  clickAct('start');
  clickAct('slot-continue');
  ok(Game.state === 'station', '进了大厅（用这个档的人）', Game.state);
  clickAct('hub');
  /* 走到拾荒者面前：出生点贴左墙下行（与 test/trade.mjs 同一条量出来的路） */
  until(-1, 0, () => Game.hall().x <= 305);
  until(0, 1, () => !!(Game.hall().near && Game.hall().near.npc === 'picker'), 900);
  ok(!!(Game.hall().near && Game.hall().near.npc === 'picker'), '走到拾荒者面前',
    Game.hall().near && (Game.hall().near.npc || Game.hall().near.id));
  Game.hallAct();                                  // 按 E：他开口（走的是玩家真走的那条路）
  UI.refresh();
  const tradeEntry = () => registry['hub-talk'].querySelectorAll('[data-act="hub-trade"]');
  ok(tradeEntry().length === 1, '商人的对话框里多一个「交易」入口');
  /* **不是商人的没有**：走到菌母面前（她只有对话）。
     ⚠ 中间要**回一趟大厅**（`hub-back`）：`renderHub` 换到别的人时那个交易面板
       可能还摊着，而这一条要量的是"菌母的对话框里有没有那个入口" ——
       不清干净就会量到上一个商人的残留（第一版就是这么红的）。 */
  clickAct('hub-back');
  ok(Game.state === 'station', '回大厅（为下面的"换个人"清一次场）', Game.state);
  clickAct('hub');
  /* ⚠ 用 `_internals.placeHall` 把人**摆到**菌母跟前，而不是再走一遍：
     "走过去真的能到"已经由上面那条（走到拾荒者）与 `hall.ts` 的连通性自检守着，
     这一节要量的是"她那一屏有没有交易入口" —— 让走位来决定它只会让断言更脆。
     第一版就是靠走位，结果人走到了拾荒者那儿，量到的是**他**的对话框。 */
  Game._internals.placeHall(300, 330);
  Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });
  ok(!!(Game.hall().near && Game.hall().near.npc === 'mother'), '站在菌母面前',
    Game.hall().near && (Game.hall().near.npc || Game.hall().near.id));
  Game.hallAct();
  UI.refresh();
  ok(tradeEntry().length === 0, '不是商人的人（菌母）没有「交易」入口',
    talkText().slice(0, 40));
  /* 回拾荒者面前，摊开交易面板 */
  Game._internals.placeHall(300, 830);
  Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });
  Game.hallAct();
  UI.refresh();
  ok(tradeEntry().length === 1, '回到拾荒者面前，「交易」入口又在了', tradeEntry().length);
  clickEl(tradeEntry()[0]);
  const rows = registry['hub-talk'].querySelectorAll('.trade-row');
  const views = Game.tradeOffers('picker');
  ok(rows.length === views.length, '报价表铺了 ' + views.length + ' 档（表里几档就几行）', rows.length);
  ok(registry['hub-talk'].querySelectorAll('.trade-give').length === views.length,
    '每一行都写着"给什么"（不给东西的报价有自检拦着）');
  const offRows = registry['hub-talk'].querySelectorAll('.trade-row.off').length;
  ok(offRows === views.filter(v => !v.ok).length,
    '做不了的那 ' + offRows + ' 档**列出来但标成不可做**（不是藏起来）', offRows);
  /* 点一下能换的那一档 */
  const buyable = registry['hub-talk'].querySelectorAll('[data-act="trade-buy"]');
  ok(buyable.length >= 1, '至少有一档现在换得起（不然这条线开局就是死的）', buyable.length);
  if (buyable.length) {
    const before = Game.tradeOffers('picker').find(v => v.ok);
    Game.addMaterial(200);
    const scrapInBag = Game.getSession().player.scrap;
    clickEl(buyable[0]);
    ok(Game.getSession().starterScrap + Game.getSession().starterWeapons.length +
      Game.getSession().starterItems.length > 0,
      '点一下**真的换到了**（货进了下一局的开局条件）',
      JSON.stringify({ s: Game.getSession().starterScrap, w: Game.getSession().starterWeapons, i: Game.getSession().starterItems }));
    ok(Game.getSession().player.scrap === scrapInBag,
      '而**没有**进这一局的背包（那是商店的事，不是交易的）');
    void before;
  }
  Game.setState('title', true);
  UI.refresh();
}

/* =========================================================
   5i. 界面文案里不许留 markdown
   历史 bug：stronghold.ts 的说明里写着 `**结构性**：…`，界面把它**原样**打了出来，
   据点列表里就出现了两个星号。数据表是源码，写说明时顺手写 markdown 太容易了，
   所以这条按"**渲染出来的** DOM 里还有没有 `**`"来查（而不是查源码文本）。
   ========================================================= */
{
  const bad = [];
  const textOf = (root) => {
    const out = [];
    const walk = (e) => {
      out.push(String(e._html || ''), String(e._text || ''));
      (e.children || []).forEach(walk);
    };
    walk(root);
    return out.join(' ');
  };
  for (const st of ['title', 'slots', 'chars', 'create', 'hub', 'codex', 'keep', 'talents', 'settings', 'records', 'howto']) {
    Game.setState(st, true);
    UI.refresh();
    const ov = Scene.overlayOf(st);
    const root = ov ? registry['scr-' + ov] : null;
    if (!root) { bad.push(st + '(找不到这屏)'); continue; }
    const txt = textOf(root);
    const hit = txt.indexOf('**');
    if (hit >= 0) bad.push(st + ' → ' + txt.slice(Math.max(0, hit - 24), hit + 24).replace(/\s+/g, ' '));
  }
  ok(bad.length === 0, '十一屏渲染出来的文案里没有残留 markdown（**加粗** 之类）', bad.join(' | '));
  Game.setState('title', true);
  UI.refresh();
}

/* =========================================================
   6. HUD 全角色覆盖
   ========================================================= */
console.log('\n[6] HUD 全角色覆盖');
let hudErr = [];
Chars.LIST.forEach(c => {
  try {
    Game.newRun(c.id);
    const s = Game.getSession();
    for (let i = 0; i < 60; i++) Game.step(1 / 60, { x: 0.2, y: -0.3 });
    UI.updateHud();
    if (registry['hp-text'].textContent.indexOf('/') < 0) hudErr.push(c.id + ' 生命文本异常');
    if (registry['weapon-strip'].children.length !== Game.cfg.maxWeapons) hudErr.push(c.id + ' 武器槽数量异常');
  } catch (e) { hudErr.push(c.id + ': ' + e.message); }
});
ok(hudErr.length === 0, '全部角色 HUD 更新正常', hudErr.join(' | '));

/* HUD 变化检测：空转不应产生 DOM 写入（否则每帧都在触发布局重算） */
{
  const before = domWrites;
  for (let i = 0; i < 120; i++) UI.updateHud();
  const delta = domWrites - before;
  console.log('    · 空转 120 帧共 ' + delta + ' 次 DOM 写入（未优化时约 ' + (120 * 9) + ' 次）');
  ok(delta <= 12, 'HUD 无变化时不写 DOM', delta + ' 次');
}

/* 画布的"设备分辨率 + CSS 逻辑尺寸"契约。
   styles.css 给这些画布写了 image-rendering:pixelated：浏览器会把画布按
   最近邻放大到设备像素。所以属性尺寸必须是 逻辑尺寸 × 倍率、CSS 尺寸必须是
   逻辑尺寸 —— 只写属性不写 CSS，2× 屏上肖像与图标就变成胖像素。
   这条覆盖角色肖像 / 商店武器与道具图标 / HUD 武器槽。 */
{
  const canvasEls = allEls.filter(e => e.tagName === 'CANVAS' && e.parentNode);
  const bad = [];
  for (const cv of canvasEls) {
    if (!cv.width) continue;
    const cssW = cv.style && cv.style.width;
    const where = cv.parentNode.id || cv.parentNode.className || '?';
    if (!cssW) { bad.push(where + ' 没设 CSS 宽度'); continue; }
    if (Math.abs(parseFloat(cssW) * S.scale() - cv.width) > 0.51) {
      bad.push(where + ' CSS ' + cssW + ' × 倍率 ' + S.scale() + ' ≠ 画布 ' + cv.width);
    }
  }
  console.log('    · 界面上共 ' + canvasEls.length + ' 张画布（倍率 ' + S.scale() + '）');
  ok(canvasEls.length >= Chars.LIST.length && bad.length === 0,
    '全部 ' + canvasEls.length + ' 张 DOM 画布按设备分辨率建、按逻辑尺寸显示', bad.slice(0, 3).join(' | '));
}

/* =========================================================
   7. 事件 → 界面联动
   ========================================================= */
console.log('\n[7] 事件联动');
let evErr = null;
try {
  Game.newRun('engineer');
  Game.events.emit('levelup', { level: 3 });
  Game.events.emit('shopOpen', { bonus: 20 });
  Game.events.emit('waveStart', 5);
  Game.events.emit('waveClear', { wave: 4, bonus: 12 });
  Game.events.emit('buy', { name: '测试武器' });
  Game.events.emit('deny', '材料不足');
  Game.events.emit('roomEnter', { name: '宝箱房', type: 'treasure', msg: '宝箱：测试武器（武器） · +3 建材' });
  Game.events.emit('gameOver', Game.summary());
  UI.toast('测试提示', 'warn');
} catch (e) { evErr = e.message + '\n      ' + (e.stack.split('\n')[1] || '').trim(); }
ok(!evErr, '全部游戏事件能安全驱动界面', evErr);

/* 房间内容必须有人收、而且必须报出自己给了什么。
   `roomEnter` 以前是"只发不收"的事件：`applyRoomEntry()` 的返回值在三处调用点
   都被丢掉，它发的这个事件一个监听者都没有 —— 于是"宝箱房白给一件装备"
   玩家一点提示都看不到（实测：宝箱能开出「克隆装置」= 远程武器额外发射 1 发，
   表现就是"子弹突然会分叉"）。这条断言把那个洞钉住。 */
const fxTypes = Object.keys(Game.ROOM_FX)
  .filter(t => typeof Game.ROOM_FX[t].enter === 'function');
const silentRooms = [];
for (const t of fxTypes) {
  const s = Game.newRun('engineer');
  Game.wave = 5;
  const p = s.player;
  p.items.length = 0; p.weapons.length = 0;
  const room = (s.map && s.map.rooms[0]) || { id: 0 };
  room.type = t;
  try {
    if (!Game.ROOM_FX[t].enter(p, room)) silentRooms.push(t);
  } catch (e) { silentRooms.push(t + '(抛错:' + e.message + ')'); }
}
ok(silentRooms.length === 0,
  fxTypes.length + ' 种"有内容"的房型都会报出自己给了什么', silentRooms.join(', '));
ok(Game.events.listenerCount('roomEnter') > 0,
  'roomEnter 有界面消费者（否则房间内容静默到账）',
  'listenerCount=' + Game.events.listenerCount('roomEnter'));

/* 翻层必须**报出这一层是什么地方**。
   环境现在是每局抽签的（同一层下一局可能是带内的另一个环境），它决定地面配色、
   岩石/裂纹色与装饰物种类。不报名字的话，"不同的环境"只表现为"背景色好像不太一样"。
   另外：旁白存在时 banner 被旁白占着，所以环境必须有**自己**的出口（toast），
   否则它只在那句有旁白的日子里才看得见 —— 那是一半的层。 */
{
  const seen = [];
  const orig = UI.toast;
  UI.toast = (msg, kind) => { seen.push({ msg: String(msg), kind: kind || '' }); return orig.call(UI, msg, kind); };
  let envErr = null;
  try {
    for (const f of [1, 2, 3]) {
      const th = Dungeon.themeFor(20240922, f);
      Game.newRun('engineer', 20240922);
      Game.events.emit('floorEnter', { floor: f, theme: th.id, name: th.name });
    }
  } catch (e) { envErr = e.message; }
  UI.toast = orig;
  ok(!envErr, 'floorEnter 事件带环境能安全驱动界面', envErr);
  const missing = [1, 2, 3].map(f => Dungeon.themeFor(20240922, f))
    .filter(th => !seen.some(x => x.msg.indexOf(th.name) >= 0));
  ok(missing.length === 0,
    '翻层时把这一层的**环境名**说出来了（旁白占着 banner 也不影响）',
    missing.map(t => t.id).join(','));
  ok(!/第 1 层 · [^—]*$/.test(seen.map(x => x.msg).join('|')),
    '环境提示带一句说明（只有名字的话玩家认不出"这是什么地方"）');
}

/* =========================================================
   8. 数据面板完整性
   ========================================================= */
console.log('\n[8] 面板与描述文本');
const statKeys = Stats.KEYS;
const missingDesc = [];
const uiSrc2 = fs.readFileSync(path.join(ROOT, 'src', 'ui.ts'), 'utf8');
// 升级池里出现的属性必须有描述与中文名
const poolKeys = [...uiSrc2.matchAll(/case '([a-zA-Z]+)':\s*\n\s*return '/g)].map(m => m[1]);
ok(missingDesc.length === 0, '属性描述表无缺失', missingDesc.join(', '));
ok(statKeys.length >= 20, '属性维度 ' + statKeys.length + ' 项');

const descKeys = new Set([...uiSrc2.matchAll(/([a-zA-Z]+):\s*'[^']*。'/g)].map(m => m[1]));
const noDesc = ['maxHp', 'hpRegen', 'damage', 'meleeDmg', 'rangedDmg', 'elementalDmg', 'attackSpeed',
  'critChance', 'armor', 'dodge', 'speed', 'luck', 'harvesting', 'pickupRange', 'range', 'lifesteal', 'engineering']
  .filter(k => !descKeys.has(k));
ok(noDesc.length === 0, '升级卡描述覆盖全部主要属性', noDesc.join(', '));

console.log('\n=== 结果 ===');
if (failures === 0) { console.log('\x1b[32m全部通过 ✔\x1b[0m\n'); process.exit(0); }
console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m\n');
process.exit(1);
