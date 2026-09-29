/* =========================================================
   persist.mjs — 全局状态 / 公共常量 / 设置系统 / 存档系统

   1) 全局状态盘点：模块级可变状态必须在清单里（新增一个要显式加白名单才通过）
   2) 公共常量：可调数值集中在哪、有没有重复定义（跨模块一致性）
   3) 设置系统：默认值 / 校验夹取 / 变更通知 / 持久化 / 坏数据兜底
   4) 存档系统：一局存档往返 / 版本不符 / 损坏数据 / 未知 id 修复 / 记录累计
   用法： node test/persist.mjs
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
const readSrc = f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');

const { Game, Settings, Save, Storage, Stats, Chars, Weapons, Items } = g;
const FIXED = Game.cfg.fixedDt;

console.log('\n=== Bronana · 全局状态 / 常量 / 设置 / 存档 ===\n');

/* =========================================================
   1. 全局状态盘点
   ========================================================= */
console.log('[1] 全局状态盘点：模块级可变状态必须在清单里');
{
  /* 顶层 `var` 分两类：
       · 常量（声明后从不重新赋值）—— 不算状态，自动豁免
       · 可变状态 —— 必须显式写进白名单，强制作者回答"它属于设置/会话/缓存/复用缓冲 哪一类"
     所以这里先做"是不是真的会被改"的静态判定（只看声明行以外的赋值），
     否则每加一个常量都要来改白名单，白名单很快就会变成噪音。 */
  function topLevelVars(src) {
    const out = [];
    for (const m of src.matchAll(/^var\s+([^;\n]+);/gm)) {
      let depth = 0, cur = '';
      const parts = [];
      for (const ch of m[1]) {
        if ('([{'.indexOf(ch) >= 0) depth++;
        else if (')]}'.indexOf(ch) >= 0) depth--;
        if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
        cur += ch;
      }
      parts.push(cur);
      for (const p of parts) {
        // 去掉类型注解：`var x: T = ...` 以前整个名字都匹配不上标识符正则，
        // 于是**带类型注解的模块级可变状态对这份盘点完全隐形**（补齐基础功能时
        // 新加的 _capture / _padKeys / _stickEl 就是这么漏过去的）。这里补上。
        const raw = p.trim();
        const eq = raw.indexOf('=');
        const colon = raw.indexOf(':');
        let name = (colon >= 0 && (eq < 0 || colon < eq)) ? raw.slice(0, colon) : raw.split('=')[0];
        name = name.trim();
        if (/^[A-Za-z_$][\w$]*$/.test(name)) out.push(name);
      }
    }
    return out;
  }
  /** 声明之后还被赋值 → 可变 */
  function isMutable(src, name) {
    const re = new RegExp('(^|[^.\\w$])' + name + '\\s*=(?!=)', 'gm');
    for (const m of src.matchAll(re)) {
      const lineStart = src.lastIndexOf('\n', m.index) + 1;
      const line = src.slice(lineStart, m.index + m[0].length);
      // 声明行整体跳过：`var A = 1, B = 2;` 里 B 的赋值也在这行上，
      // 不能因为"B 前面不是 var"就把它算成"被重新赋值"
      if (/^\s*var\s/.test(line)) continue;
      if (/[+\-*/%&|^<>]=\s*$/.test(line)) continue;      // += 之类
      return true;
    }
    return false;
  }

  const ALLOWED = {
    'game.ts': ['S', '_seat', '_cand', '_candT', '_candRaw', '_segQ'],    'emit.ts': ['S', 'STEP_CTX'],
    'render.ts': ['w', 'h', '_skin', '_pose', '_parts', '_seat', '_flashOpt', 'pf', '_atlasWarm',
      // 横幅（"第 N 间 · 房型"）的文本与倒计时：**纯表现**，所以它住在渲染层而不是会话上
      'banner'],
    'depth.ts': ['pool', 'live', 'used', 'frameSeq', 'counts', 'bandCounts', 'pushes', 'TRACE'],
    /* music.ts 的播放状态：**纯表现**（不进存档、不该进会话）。
       它同时暴露了这份盘点的一个盲点：`topLevelVars` 只认 `var x = …`，
       而挂在导出对象上的字段（`Music.current = ''`）**不是** `var` ——
       于是它们既被 `isMutable` 判成"可变"，又不在"当前存在的可变状态"清单里，
       白名单一登记就成了"已删除的条目"。下面的孤儿检查按**属性名**判，
       整类"对象字段型的可变状态"从此都能正常登记。 */
    'music.ts': ['current', 'intensity', 'timer', 'step', 'enabled',
      // 交叉淡入用的**曲目总线**与**请求但还没生效**的强度档
      // （`wanted` 与 `intensity` 分开存，是"换挡走小节线"的实现方式）
      'bus', 'wanted'],
    /* i18n 的当前语言：**纯偏好**（它自己落盘在 settings 里，不进存档）。
       `slots.ts` 的两项是"当前槽位"与"最近一次坏档回退的记录" ——
       前者是**偏好性质的会话状态**（该由界面决定何时切，不参与模拟），
       后者是一条**诊断信息**（读一次给玩家看，看完了就清），
       两者都不该进存档：槽位本身就是"读哪个存档"的选择器。 */
    'i18n.ts': ['current'],
    'slots.ts': ['currentSlot', 'lastRecovery'],
    /* `PAL_MODE` 是色弱档：**纯表现**（颜色）。它与 `settings.colourblind`
       是"同一条信息的两个副本" —— 保留它是因为调色板要能在**不改设置**时
       被测试直接切档（`PAL.setMode`），而设置项那条路要经 localStorage。 */
    'utils.ts': ['PAL_MODE'],
    'sprites.ts': ['cache', 'CACHE_SCALE', '_scratchRig', '_bronanaArgs', 'ATLAS_ARGS', '_atlasRig'],
    'ui.ts': ['el', 'inited', '_diagAcc', '_diagOn', '_diagLast', '_lowHpSaid',
      // 菜单焦点：当前聚焦的元素（界面重画即清空）
      '_focusEl',
      // 破坏性操作的"待确认"态：键名 + 3 秒倒计时句柄
      '_armedKey', '_armedTimer',
      // 正在等待按键的那条改键目标
      '_rebindKey',
      // 小地图的内容签名：只有它变了才重建 DOM（HUD 每帧被调用，小地图几乎不变）
      '_mmSig',
      // 关底血条的名字签名（只在换 Boss / 钻地状态变化时写文本）
      '_bossSig',
      // 枢纽里当前选中的 NPC（界面状态；不进档案 —— "上次跟谁说话"不该被持久化）
      '_hubNpc',
      // 图鉴当前翻到哪一页（同上：翻页是界面状态）
      '_codexTab'],
    // 惰性解析出来的摇杆 DOM 引用（缓存）+ 手柄按键的复用缓冲 + 改键回调 + 一次性的"已解析"标记
    // `_padHeld`：上一帧手柄有没有按住键（只在"有→无"时清一次缓冲，避免每帧分配两个对象）
    'input.ts': ['hasDOM', '_capture', '_padKeys', '_padOnce', '_padHeld', '_stickEl', '_knobEl', '_stickReady'],
    /* `lastSfx` = 节流表（纯表现：同一音效的时间戳）。
       `duckTimer` = 闪避的放回定时器 —— 它也是纯表现，而且**必须**登记：
       一个没被放回的定时器会让音乐永远小声，而这件事没有任何别的尺子看得见。 */
    'audio.ts': ['lastSfx', 'duckTimer'],
    /* 手动模式的输入层状态（**纯表现性质**：它们只影响"这一帧的输入长什么样"，
       不进存档、不进模拟 —— `_padAim` 是手柄右摇杆方向、`_mouseSeen` 是
       "鼠标有没有动过"、`_aimOrigin` 是玩家在屏幕上的位置）。
       ⚠ `_mouseSeen` 必须登记：它是"没动过鼠标就别乱瞄"这条行为的**唯一开关**，
       而这类"一个布尔量决定一段行为"的东西最容易在重构里被顺手删掉。 */
    'input.ts': ['_padAim', '_mouseSeen', '_aimOrigin', '_capture', '_padKeys', '_padOnce',
      '_padHeld', '_stickEl', '_knobEl', '_stickReady'],
    'draw2d.ts': [],
    'utils.ts': ['Perf', 'PAL_MODE'],
    /* 首局引导：`seen`（说过哪几条）与 `enabled`（开关）都是**纯偏好** ——
       `seen` 真正的落盘在账号档案的 `tutorialSeen` 里（profile 订阅了 onChanged），
       这里只是它的内存副本。`ui.ts` 的 `_lowHpSaid` 是"低血那条提示说过没有"，
       同样属于表现层（它不该进存档：进存档的话换档会带着上一档的记忆）。 */
    'tutorial.ts': ['seen', 'enabled'],
    'registry.ts': ['FAMILIES', 'NAMES'],
    'containers.ts': ['DEFS', 'NAMES'],
    'record.ts': ['rec', 'events', 'inputs', 'seedOfRun', 'wrapped', 't0',
      // 回放中标记：回放会真的跑到 gameOver，接线层靠它不往存档里写假数据
      'replaying'],
    'diag.ts': [],
    'comp.ts': ['DEFS', 'DEF_NAMES', 'ARCHS', 'ARCH_NAMES', 'SYSTEMS', 'SYS_NAMES'],
    'scene.ts': ['TABLE'],
    'ai.ts': ['BEHS', 'BEH_NAMES', 'PATS', 'PAT_NAMES'],
    'bronana.ts': ['W'],
    'storage.ts': ['current', 'lastError'],
    'settings.ts': ['values', 'listeners', 'loadedFrom'],
    'save.ts': [],
    // autoPauseEnabled = "失焦自动暂停"设置的镜像；runPeaks = 本局峰值（挑战"极限"组读它）
    // lastDaily = 最近一局每日挑战的成绩码（结算页与图鉴面板要显示它）
    // challenge = "这一局是挑战局"的标记（每日 / 每周共用；属于接线层，模拟层不认识它）
    'main.ts': ['acc', 'last', 'running', 'testModeApplied', 'stepOnce', 'lastTape', 'autoPauseEnabled', 'runPeaks', 'lastDaily', 'challenge'],
    // 信封是工厂：状态全在闭包里，模块级没有可变状态
    'envelope.ts': [],
    // 账号档案（跨局成长）：内存里的那一份 + 来源标记 + 写盘结果
    /* `SkillsRef` = 注入进来的技能表引用（让档案层不必 import skills.ts ——
       那是向上的依赖边）。它是一个**会被写**的模块级引用，所以要登记。 */
    'profile.ts': ['data', 'loadedFrom', 'writeOk', 'SkillsRef'],
    // 挑战表：LIST 是常量（从不重新赋值），BY_ID 与 METRICS 同理
    'challenges.ts': [],
    // 难度阶梯：一张声明表 + 折叠规则，全是常量；BY_LEVEL 只做属性写入
    'danger.ts': [],
    // 每日挑战：规则是纯函数（"这一局是不是挑战"的标记已挪到 main.ts 的接线层）
    'daily.ts': [],
    // 每周挑战：同上
    'season.ts': [],
    // 离线产出：速率表 + 纯函数
    'offline.ts': [],
    // 地牢地图：纯数据 + 纯函数（种子进、地图出，模块级没有可变状态）
    'dungeon.ts': [],
    // 成长节奏旋钮 Enemies.PACE 挂在 API 容器对象上（与 Emit.visScale 同类），
    // 不属于"模块级 var 状态"，所以这里没有条目 —— 有的话这条自检会报"清单里有已删除的条目"
    'enemies.ts': [],
    // 剧情：表 + 纯函数（台词/碎片/结局都声明在表里，没有模块级可变状态）
    'story.ts': [],
    // 武器联动：家族表 + 轴表 + 纯函数
    'synergy.ts': [],
    // 成绩码：纯函数 + 常量
    'score.ts': [],
    // 天赋树：一张声明表 + 纯函数；OWNER/BY_ID 只做属性写入
    'talents.ts': [],
    // 局内营地：设施表 + 折叠函数，全是常量与纯函数
    'camp.ts': [],
    // 跨局据点：同上
    'stronghold.ts': [],
    // 这些文件里没有模块级可变状态
    'collide.ts': [], 'rig.ts': [],
    /* 技能表：`TREES` 是**建树结果**（`Skills.make` 按注入的角色清单重建），
       `_charList` 是那一份注入的清单本身。两者都是"从数据算出来的"，
       但它们**会被重建**，所以按这份盘点自己的规则必须登记。 */
    'skills.ts': ['TREES', '_charList'],
    /* 注入进来的技能表引用：它让档案层不必 import skills.ts（那是向上的依赖边），
       代价是"有一个可变的模块级引用"—— 正是这份盘点要看见的那类东西。 */
  };
  // API 容器（只挂函数/数据的命名空间对象）不算可变状态
  const API_CONTAINERS = ['Arena', 'Sfx', 'Bronana', 'Col', 'Comp', 'C', 'I', 'W', 'Demo', 'D', 'O',
    'Emit', 'E', 'Game', 'Input', 'R', 'Rig', 'Scene', 'S', 'Stats', 'CFG', 'UI', 'U', 'Perf',
    'Settings', 'Save', 'Storage', 'Weapons', 'Items', 'Chars', 'Enemies', 'TPL', 'B', 'PAINT',
    'PARTS', 'PUBLIC_KEYS'];

  const files = fs.readdirSync(path.join(ROOT, 'src'))
    .filter(f => f.endsWith('.ts') && f !== 'types.d.ts' && f !== 'cli.ts');
  const unexpected = [];
  let mutableCount = 0, constCount = 0;
  for (const f of files) {
    const src = readSrc(f);
    const allow = ALLOWED[f] || [];
    for (const n of topLevelVars(src)) {
      if (API_CONTAINERS.indexOf(n) >= 0) continue;
      if (!isMutable(src, n)) { constCount++; continue; }
      mutableCount++;
      if (allow.indexOf(n) < 0) unexpected.push(f + ':' + n);
    }
  }
  ok(unexpected.length === 0,
    '模块级可变状态全部在清单里（' + mutableCount + ' 个状态 / ' + constCount + ' 个常量已豁免）' +
    ' —— 新增状态必须显式登记', unexpected.join(', '));

  // 清单里不能有已删除的条目（否则白名单只会越积越松）
  const stale = [];
  for (const f in ALLOWED) {
    const src = fs.existsSync(path.join(ROOT, 'src', f)) ? readSrc(f) : '';
    for (const n of ALLOWED[f]) {
      /* 两种形态都算"还存在"：
         ① 顶层 `var n = …`（多数模块）
         ② 挂在导出对象上的字段 `Obj.n = …`（music.ts 的播放状态就是这一种）。
         只认 ① 的话，字段型的可变状态一登记就被判成"已删除" ——
         而它明明是这份清单最该允许的一种（"这个字段会被改，但它不进存档"）。 */
      const asVar = new RegExp('^var\\s+[^;\\n]*\\b' + n + '\\b', 'm').test(src);
      const asField = new RegExp('[A-Za-z_$][\\w$]*\\.' + n + '\\s*=(?!=)', 'm').test(src);
      if (!asVar && !asField) stale.push(f + ':' + n);
    }
  }
  ok(stale.length === 0, '清单里没有已删除的条目（不会越积越松）', stale.join(', '));

  // ESM 纪律：应用不得往 window 上挂东西
  const globals = [];
  for (const f of files) {
    const src = readSrc(f);
    for (const m of src.matchAll(/(?:window|globalThis)\.([A-Za-z_$][\w$]*)\s*=[^=]/g)) {
      globals.push(f + '.' + m[1]);
    }
  }
  ok(globals.length === 0, '没有任何模块往 window / globalThis 上挂全局（ESM 化之后只留 __still / __diag）',
    globals.join(', '));
}

/* =========================================================
   2. 公共常量
   ========================================================= */
console.log('\n[2] 公共常量：可调数值有没有重复定义 / 漂移');
{
  // 同一份名单在两处各写一遍 = 迟早漂移（这也是骨架那轮消掉武器挂点公式的理由）
  const c1 = fs.readFileSync(path.join(ROOT, 'test', '_load.mjs'), 'utf8');
  const modsInLoader = [...c1.matchAll(/^\s{2}(\w+):\s+'\.\.\/src\/([\w.]+)'/gm)].map(m => m[2]);
  // main.ts 是浏览器入口、cli.ts 是 Node 入口：都刻意不被测试加载（导入即执行副作用），
  // 其余每个模块都必须被加载到，漏一个就等于没测
  const ENTRIES = ['main.ts', 'cli.ts'];
  const filesOnDisk = fs.readdirSync(path.join(ROOT, 'src'))
    .filter(f => f.endsWith('.ts') && f !== 'types.d.ts' && ENTRIES.indexOf(f) < 0);
  const notLoaded = filesOnDisk.filter(f => modsInLoader.indexOf(f) < 0);
  ok(notLoaded.length === 0, '测试加载器覆盖了全部 ' + filesOnDisk.length + ' 个非入口模块（漏一个就没被测到）',
    notLoaded.join(','));
  const phantom = modsInLoader.filter(f => !fs.existsSync(path.join(ROOT, 'src', f)));
  ok(phantom.length === 0, '加载器里没有指向不存在文件的条目', phantom.join(','));

  ok(g.Emit.VIS_CAP === 420 && g.Emit.TEXT_CAP === 28,
    '粒子上限是具名常量（不在代码里散落魔数）', g.Emit.VIS_CAP + '/' + g.Emit.TEXT_CAP);  ok(g.Bronana.SEATS === Game.cfg.maxWeapons,
    '骨架武器槽数 = 配置的武器上限（跨模块一致性由测试守着）',
    g.Bronana.SEATS + ' vs ' + Game.cfg.maxWeapons);

  // 帧模型常量只有一份来源，且 main.ts 不自己写死
  ok(Game.cfg.fixedDt === 1 / 60 && Game.cfg.maxSteps > 0 && Game.cfg.maxFrameDt > 0,
    '帧模型常量集中在 Game.cfg');
  const mainSrc = readSrc('main.ts');
  ok(!/1\s*\/\s*60|0\.25|maxSteps\s*=\s*6/.test(mainSrc.replace(/\/\*[\s\S]*?\*\//g, '')),
    'main.ts 里没有重复写死的帧常量');

  // 设置项的表就是"哪些是可调设置"的唯一清单
  ok(Settings.keys().length >= 5 && Settings.keys().indexOf('volume') >= 0,
    '设置项是一张声明表：' + Settings.keys().join('/'));
  const badDef = Settings.keys().filter(k => {
    const d = Settings.def(k);
    return !d.label || (d.type === 'number' && (d.min === undefined || d.max === undefined));
  });
  ok(badDef.length === 0, '每个设置项都有中文名与合法范围（number 必须有 min/max）', badDef.join(','));
}

/* =========================================================
   2b. Session 的字段必须**全都归了组**
   ---------------------------------------------------------
   改造前 `interface Session` 是一个 72 个字段的平铺大对象：谁也说不清
   "哪些字段属于同一件事"，新增字段时也没有东西提醒你"它要不要进存档"。
   现在它按子系统分成 7 个组（SessionCore / SessionCraft / SessionMarket /
   SessionDungeon / SessionWave / SessionEnts / SessionDebug），`Session` 只是并集。
   这一节守三件事：
     · 没有一个字段是**散装**的（直接写在 Session 里，不属于任何组）
     · 没有一个字段被**两组同时**声明（改一处忘了另一处）
     · 运行时的会话字段都在组里（新加的字段必须进组，不能只在 newSession 里冒出来）
   ========================================================= */
console.log('\n[2b] Session 的字段分组：不许有散装字段');
{
  const tsrc = fs.readFileSync(path.join(ROOT, 'src', 'types.d.ts'), 'utf8');
  const GROUPS = ['SessionCore', 'SessionCraft', 'SessionMarket', 'SessionDungeon',
    'SessionWave', 'SessionEnts', 'SessionDebug'];
  const fieldsOf = {};
  for (const gname of GROUPS) {
    const re = new RegExp('interface ' + gname + ' \\{([\\s\\S]*?)\\n\\}');
    const m = re.exec(tsrc);
    fieldsOf[gname] = m ? [...m[1].matchAll(/^\s{2}([A-Za-z_]\w*)\??:/gm)].map(x => x[1]) : null;
  }
  const missingGroups = GROUPS.filter(g => !fieldsOf[g]);
  ok(missingGroups.length === 0, GROUPS.length + ' 个字段组都在 types.d.ts 里', missingGroups.join(','));

  const all = [];
  GROUPS.forEach(g => (fieldsOf[g] || []).forEach(f => all.push({ g, f })));
  const seen = {};
  const dup = [];
  all.forEach(x => { if (seen[x.f]) dup.push(x.f + '（' + seen[x.f] + ' 与 ' + x.g + '）'); seen[x.f] = x.g; });
  ok(dup.length === 0, '没有一个字段被两组同时声明', dup.join(', '));

  // Session 自己必须是**空的并集**：字段只能住在组里
  const sm = /interface Session extends ([^{]+)\{\}/.exec(tsrc);
  ok(!!sm, 'Session 是各组的并集（而不是自己又列一遍字段）');
  const listed = sm ? sm[1].split(',').map(s => s.trim()) : [];
  const notListed = GROUPS.filter(g => listed.indexOf(g) < 0);
  const extraListed = listed.filter(g => GROUPS.indexOf(g) < 0);
  ok(notListed.length === 0 && extraListed.length === 0,
    'Session extends 的组清单与上面 ' + GROUPS.length + ' 个组一致',
    notListed.concat(extraListed).join(','));
  ok(all.length >= 60, '分组一共覆盖 ' + all.length + ' 个字段', all.length);

  // 运行时：真开一局，看看有没有"只在 newSession 里冒出来、不属于任何组"的字段
  const sess = Game.newRun('ranger', 4242, 0);
  const runtimeKeys = Object.keys(sess);
  const unknown = runtimeKeys.filter(k => !seen[k]);
  ok(unknown.length === 0, '运行时会话的 ' + runtimeKeys.length + ' 个字段都在分组里', unknown.join(','));
  // 反过来：分组里声明的字段必须真的被 newSession 写出来（可选的运行期字段除外）
  const OPTIONAL = ['time', 'shots', 'arena',
    'shopLocked', 'rerolls', 'rerollCost', 'shopBonus'];
  const ghost = Object.keys(seen).filter(k => runtimeKeys.indexOf(k) < 0 && OPTIONAL.indexOf(k) < 0);
  ok(ghost.length === 0, '分组里的字段都是 newSession 真的会写出来的（可选的运行期字段除外）',
    ghost.join(','));

  /* ---- [2b-2] `S.xxx` 的**字段名**必须真的在分组里声明过 ----
     `game.ts` 的 `S` 以前是 `var S = null`（隐式 any），那个 3100 行的模拟内核里
     所有 `S.` 的读取都不受 tsc 检查；实测抓到过 `S.fmods.bonusTier`（图纸改版时删掉的键）
     一直静默读到 undefined、恒等于 0，而 `tsc` 全绿 —— 这类 bug 不会崩，只会让代码说谎。
     现在 `S` 已经带上 `Session` 注解（编译器管这一层），这一条作为**第二道网**留着：
     它对着**分组声明**比、编译器对着**类型**比 —— 同一个来源，两条不同的路。 */
  {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'game.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const reads = new Set([...src.matchAll(/\bS\.([A-Za-z_]\w*)/g)].map(m => m[1]));
    const bad = [...reads].filter(k => !seen[k]);
    ok(reads.size >= 50, 'game.ts 里真的读了 ' + reads.size + ' 个不同的会话字段', reads.size);
    ok(bad.length === 0,
      '这 ' + reads.size + ' 个字段都在分组里声明过（S 现在带 Session 注解，这条是第二道网）', bad.join(','));
  }
}

/* =========================================================
   2c. `any` 预算：类型漏洞不许长回来
   ---------------------------------------------------------
   架构体检（tools/arch-audit.cjs [6]）会数每个文件里 `any` 出现几次。
   数出来没人管，它就只是个数字 —— 所以这里给它一个**上限**：
   改造前 45 处（ui.ts 一家 15 处，全是 `U.el` 返回 any 生出来的下游）；
   现在 30 处，且都是**有理由的**那几类（见下面的说明）。
   上限只许降不许升：想加一个 any，得先把这条测试改掉 —— 那一步就是评审。
   ========================================================= */
console.log('\n[2c] any 预算：类型漏洞不许长回来');
{
  /* 剩下的这些各有理由：
     · utils/audio/main 里的 `as any` 是 **webkit 前缀 API**（老 Safari 只有带前缀的）
     · comp/emit/rig/sprites 里的是**动态字段表**（组件系统的本质就是运行时字段集合）
     · camp/stronghold 里的是**效果键的取值**（数字或对象，两种形态）
     · story/danger/depth/envelope/containers/settings/input 各 1 处，都是"外部数据边界" */
  const BUDGET = {
    'main.ts': 4, 'utils.ts': 4, 'comp.ts': 3, 'input.ts': 3, 'stronghold.ts': 3,
    'camp.ts': 2, 'emit.ts': 2, 'sprites.ts': 2, 'music.ts': 1,
    'audio.ts': 1, 'containers.ts': 1, 'danger.ts': 1, 'depth.ts': 1,
    'envelope.ts': 1, 'rig.ts': 1, 'settings.ts': 1, 'story.ts': 1
  };
  const srcDir = path.join(ROOT, 'src');
  // 与 tools/arch-audit.cjs 同一口径：**先去掉注释**再数（注释里提到 any 不算漏洞）
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const over = [];
  let total = 0;
  for (const f of fs.readdirSync(srcDir).filter(x => x.endsWith('.ts') && x !== 'types.d.ts')) {
    const code = stripComments(fs.readFileSync(path.join(srcDir, f), 'utf8'));
    const n = [...code.matchAll(/:\s*any\b|as any\b/g)].length;
    total += n;
    const cap = BUDGET[f] === undefined ? 0 : BUDGET[f];
    if (n > cap) over.push(f + ' ' + n + ' > ' + cap);
  }
  ok(over.length === 0, 'src/ 里 `any` 共 ' + total + ' 处，没有一个文件超出预算', over.join(', '));
  /* 总数上限 = 各文件预算之和（不是另写一个魔数）：于是"预算表"就是唯一声明处，
     想放宽总数必须先放宽某个文件 —— 那一步就是要评审的地方。 */
  const capTotal = Object.keys(BUDGET).reduce((s, k) => s + BUDGET[k], 0);
  ok(total <= capTotal, '`any` 总数不超过预算之和 ' + capTotal + '（改造前 45）', total);
  const uiAny = [...stripComments(fs.readFileSync(path.join(srcDir, 'ui.ts'), 'utf8'))
    .matchAll(/:\s*any\b|as any\b/g)].length;
  ok(uiAny === 0, '界面层一处 any 都没有（改造前 15 处，全是 U.el: any 的下游）', uiAny);
}

/* =========================================================
   2d. 启动期自检的门：写了 audit 就得登记，登记了就得真跑
   ---------------------------------------------------------
   改造前：9 个模块在加载时调 `X.audit()` 然后**把结果丢掉**，只有 scene.ts 会抛。
   于是"表写错了"不会让程序起不来，只会让测试变红 —— 护栏存在，但不在必经之路上。
   现在各模块 `SelfCheck.register(名字, audit)`，入口（main.ts / cli.ts）启动时 `run()`。
   这一节守三件事：
     · 有 `audit =` 的模块**都**登记了（漏一个 = 那个模块的表没人把门）
     · 登记的名字没有重复、且都真能跑出结果
     · 现在这一批自检**全过**（过不了的话上面那条 Error 会带着问题清单）
   ========================================================= */
console.log('\n[2d] 启动期自检：写了 audit 就得登记');
{
  const SC = g.SelfCheck;
  /* 三类"看着像 audit 但不是定义期表检查"的，明确列出来（而不是让正则去猜）：
       · comp.ts   `Comp.audit(e)` 是对**单个对象**的字段自检（有参数）
       · emit.ts   `Emit.audit()` 查的是**当前会话**的池里有没有重复引用（运行期）
       · registry.ts `Registry.audit()` 是跨表引用，由 SelfCheck.run() 内置最后跑
       新增一个"表自检"却忘了登记，上面这条断言就会红。 */
  const NOT_TABLE_CHECK = {
    'comp.ts': 'Comp.audit(e) 对单个对象',
    'emit.ts': 'Emit.audit() 查运行期池',
    'registry.ts': 'Registry.audit() 是内置的跨表引用',
      'skills.ts': 'Skills.audit() 要「角色清单已注入」才查得准 —— 模块加载期清单还是空的，' +
        '注册进启动期自检会**误报**（玩家看到报错页而表其实是对的）。' +
        '所以它由 main.ts 在 Skills.make 之后显式跑一次，失败就抛。' +
        '代价是「没人替我们记得跑它」—— test/skill.mjs 有一条判据盯着 boot 里那两行的顺序。'
  };
  const srcDir = path.join(ROOT, 'src');
  const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.ts') && f !== 'types.d.ts');
  const hasAudit = [];
  for (const f of files) {
    const code = fs.readFileSync(path.join(srcDir, f), 'utf8');
    /* 定义期表检查的形态：**零参数**的 `X.audit = function ()`（或 scene 的 validate） */
    if (/\.audit\s*=\s*function\s*\(\s*\)/.test(code) || /\.validate\s*=\s*function\s*\(\s*\)/.test(code)) {
      hasAudit.push(f);
    }
  }
  const registered = new Set(SC.names());
  const byModule = {};
  for (const f of files) {
    const code = fs.readFileSync(path.join(srcDir, f), 'utf8');
    const m = [...code.matchAll(/SelfCheck\.register\(\s*'([\w]+)'/g)].map(x => x[1]);
    if (m.length) byModule[f] = m;
  }
  const noReg = hasAudit.filter(f => {
    if (NOT_TABLE_CHECK[f]) return false;
    return !byModule[f] || !byModule[f].some(n => registered.has(n));
  });
  ok(noReg.length === 0,
    '有定义期自检的 ' + (hasAudit.length - Object.keys(NOT_TABLE_CHECK).length) + ' 个模块都登记了' +
    '（另 ' + Object.keys(NOT_TABLE_CHECK).length + ' 个不是表检查，已列明）', noReg.join(','));

  const names = SC.names();
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  ok(dup.length === 0, '自检名没有重复', dup.join(','));
  ok(names.length >= 10, '共 ' + names.length + ' 项启动期自检：' + names.join('/'));

  const scan = SC.scan();
  ok(scan.ok, '启动期自检全部通过（入口调 SelfCheck.run()，不过就抛）',
    scan.problems.slice(0, 5).join(' | '));
  ok(scan.ran.length === names.length,
    'scan() 跑过全部 ' + names.length + ' 项（含内置 registry）', scan.ran.join('/'));

  // 真能拦住：塞一条必然失败的自检，run() 必须**抛并且把问题清单带出来**
  let caught = null;
  try { SC.register('__probe_bad', () => ({ ok: false, problems: ['故意坏的'] })); SC.run(); }
  catch (e) { caught = String((e && e.message) || e); }
  ok(!!caught && caught.indexOf('故意坏的') >= 0 && caught.indexOf('1 条') >= 0,
    '坏掉的自检会让 run() 抛出，并把问题清单带在错误里（一次列全）',
    caught ? caught.split('\n')[0] : '(没抛)');
  ok(SC.names().indexOf('__probe_bad') >= 0, '（探针进了登记表；后续断言不再 run）');
  let dupCaught = null;
  try { SC.register('Scene', () => ({ ok: true, problems: [] })); } catch (e) { dupCaught = e.message; }
  ok(!!dupCaught, '同名注册会被拒绝（否则后一个静默顶掉前一个）', dupCaught || '(没抛)');
}

/* =========================================================
   3. 设置系统
   ========================================================= */
console.log('\n[3] 设置系统');
{
  const mem = Storage.memory();
  Storage.use(mem);
  Storage.wipe();

  const r = Settings.init();
  ok(r.loaded === false && Settings.loadedFrom() === 'defaults', '首次启动：没有任何存档 → 全部默认值', Settings.loadedFrom());
  ok(Settings.get('sound') === true && Settings.get('volume') === 0.22 && Settings.get('speed') === 1,
    '默认值正确', JSON.stringify(Settings.all()));

  // 校验：越界夹回、类型转换、非法拒绝
  ok(Settings.set('volume', 5) === 1, '音量超上限被夹到 1');
  ok(Settings.set('volume', -3) === 0, '音量超下限被夹到 0');
  ok(Settings.set('volume', '0.5') === 0.5, '字符串数值被接受（存档里是 JSON，类型可能松）');
  let threw = '';
  try { Settings.set('volume', 'abc'); } catch (e) { threw = e.message; }
  ok(/不合法/.test(threw), '非数值被拒绝（抛错而不是静默生效）', threw);
  threw = '';
  try { Settings.set('没有这项', 1); } catch (e) { threw = e.message; }
  ok(/没有这个设置项/.test(threw), '不存在的设置项被拒绝', threw);
  // 枚举：表里没列出的值直接拒绝（不能"夹"到最近的一个 —— 1x/2x 之间没有中间态）
  threw = '';
  try { Settings.set('speed', 3); } catch (e) { threw = e.message; }
  ok(/不合法/.test(threw) && Settings.get('speed') === 1,
    '枚举值只接受表里列出的（speed=3 被拒绝且原值不变）', threw);

  // 变更通知
  const seen = [];
  const off = Settings.onChange((k, v, src) => seen.push(k + '=' + v + '@' + src));
  Settings.set('sound', false, 'user');
  Settings.set('sound', false, 'user');          // 值没变 → 不该再通知
  Settings.set('fps', true);
  ok(seen.join(',') === 'sound=false@user,fps=true@code', '变更通知只在值真的变化时发出',
    seen.join(','));
  off();
  Settings.set('fps', false);
  ok(seen.length === 2, '退订之后不再收到通知');

  // 持久化：换一个"进程"（重新 load）能读回来
  Settings.set('volume', 0.66);
  Settings.set('shake', 0);
  const r2 = Settings.load();
  ok(r2.loaded === true && Settings.get('volume') === 0.66 && Settings.get('shake') === 0,
    '设置跨"进程"持久化（重新 load 读回）', Settings.loadedFrom());

  // 坏数据兜底
  mem.setItem(Storage.KEYS.settings, '{ 这不是 JSON');
  ok(Settings.load().loaded === false && Settings.get('volume') === 0.22,
    '设置存档损坏 → 退回默认值（不让游戏起不来）');
  mem.setItem(Storage.KEYS.settings, JSON.stringify({ v: 999, values: { volume: 0.1 } }));
  const r3 = Settings.load();
  ok(r3.loaded === false && r3.dropped.length > 0, '版本不符 → 丢弃并给出原因', r3.dropped.join(','));
  mem.setItem(Storage.KEYS.settings, JSON.stringify({
    v: Settings.VERSION, values: { volume: 99, speed: 7, 不存在的键: 1 }
  }));
  const r4 = Settings.load();
  ok(Settings.get('volume') === 1 && Settings.get('speed') === 1 && r4.dropped.indexOf('不存在的键') >= 0,
    '越界值被夹回、未知键被丢弃、缺失键补默认', JSON.stringify({ v: Settings.get('volume'), d: r4.dropped }));

  // 写不进去（配额满 / 无痕）不能让游戏崩
  const failing = {
    name: 'failing',
    getItem: () => null,
    setItem: () => { throw new Error('QuotaExceededError'); },
    removeItem: () => { throw new Error('nope'); }
  };
  Storage.use(failing);
  let crash = null;
  try { Settings.set('volume', 0.33); } catch (e) { crash = e.message; }
  ok(crash === null && Settings.get('volume') === 0.33,
    '存储写入失败时设置仍在本次会话内生效（不抛异常）', crash || '');
  ok(Storage.lastError() !== null, '写入失败被记录在 lastError 里');

  Storage.use(mem);   // 后面的测试用回内存适配器
  Storage.wipe();
  Settings.init();
}

/* =========================================================
   4. 存档系统
   ========================================================= */
console.log('\n[4] 存档系统：一局往返');
{
  const mem = Storage.memory();
  Storage.use(mem);
  Storage.init;
  Storage.wipe();

  ok(Save.hasRun() === false && Save.peekRun() === null, '没有存档时 hasRun/peekRun 都是空');
  ok(Save.loadRun() === null, '没有存档时 loadRun 返回 null（不抛）');

  // 造一局"打到第 4 波、有武器有道具有等级"的状态
  Game.newRun('gladiator', 4242);
  const sess = Game.getSession();
  holdRoom(sess);
  Game.addWeapon('minigun');
  Game.addWeapon('laser');
  sess.player.items.push(g.Comp.spawn('item', { def: Items.BY_ID['coffee'] }));
  sess.player.upgrades.damage = 0.5;
  sess.player.level = 7;
  sess.player.xp = 33;
  sess.player.scrap = 123;
  Game.recalcStats();
  sess.player.hp = Math.round(sess.stats.maxHp * 0.5);
  sess.stats_total.kills = 77;
  enterFightRoom(); Game._internals.startWave(4);
  for (let i = 0; i < 240; i++) Game.step(FIXED, { x: 0, y: 0 });

  const before = {
    char: sess.charDef.id, wave: Game.wave, level: sess.player.level,
    weapons: sess.player.weapons.map(w => w.id).sort().join(','),
    items: sess.player.items.length, mats: sess.player.scrap,
    dmgUp: sess.player.upgrades.damage, kills: sess.stats_total.kills,
    seed: sess.seed
  };

  ok(Save.saveRun() === true, 'saveRun 写入成功');
  ok(Save.hasRun() === true, 'hasRun 立刻为真');
  const peek = Save.peekRun();
  ok(peek && peek.wave === 4 && peek.char === 'gladiator' && peek.charName === '角斗士',
    '"继续上一局"能拿到摘要（不需要真的读档）', JSON.stringify(peek));

  // 丢弃当前会话，模拟"刷新页面"
  Game.setState('title', true);
  const restored = Save.loadRun();
  ok(!!restored, 'loadRun 恢复出一个会话');
  const p = restored.player;
  const after = {
    char: restored.charDef.id, wave: Game.wave, level: p.level,
    weapons: p.weapons.map(w => w.id).sort().join(','),
    items: p.items.length, mats: p.scrap,
    dmgUp: p.upgrades.damage, kills: restored.stats_total.kills,
    seed: restored.seed
  };
  ok(JSON.stringify(before) === JSON.stringify(after),
    '进度逐项还原（角色/波次/等级/武器/道具/材料/加点/累计击杀/种子）',
    '\n      前 ' + JSON.stringify(before) + '\n      后 ' + JSON.stringify(after));
  ok(Game.state === 'playing', '恢复后自动进入 playing（不用玩家再点一次）');
  ok(p.hp > 0 && p.hp <= restored.stats.maxHp, '生命被夹回合法范围', p.hp + '/' + restored.stats.maxHp);
  ok(p.level === 7 && p.xpNeed === Stats.xpNeeded(7), '等级与升级所需经验同步');

  // 恢复出来的一局能继续跑
  let runErr = null;
  try {
    for (let i = 0; i < 300; i++) {
      if (Game.state === 'playing') Game.step(FIXED, Game.autoInput(i / 60));
      else if (Game.state === 'levelup') Game.chooseLevelCard(0);
      else if (Game.state === 'shop') Game.nextWave();
    }
  } catch (e) { runErr = e.message; }
  ok(runErr === null, '恢复后的会话能继续正常跑 300 帧', runErr);
}

/* =========================================================
   4b. 存档往返：**进度不许丢 · 随机流要接着走 · 存档要幂等**
   ---------------------------------------------------------
   旧写法是逐项清单（"角色/波次/等级/武器/道具/材料/加点/累计击杀/种子"）——
   清单之外的东西丢了它不会响。这一节换三条**结构性**的判据：
     · 存档**幂等**：export → import → export 必须逐字段一致
       （任何"读档时重掷 / 重置"都会在这里露出来 —— 实测抓到过：货架被重掷、
        刷新价跌回最低、随机流从头开始、免费刷新白拿）
     · 随机流接着走：拿存档时的状态另开一个 rng 试抽 5 个，读档后必须抽到同样 5 个
     · 商店的"此刻"（货架/刷新价/锁定/契约）必须跟着走
   ========================================================= */
console.log('\n[4b] 存档往返：幂等 + 随机流接着走');
{
  Game.setState('title', true);
  Rec.start();                       // 录一局，顺便给 [4c] 用
  const sess = Game.newRun('ranger', 20240922, 1);
  Game.setState('playing', true);
  Game._internals.startWave(3);
  for (let i = 0; i < 600; i++) {
    if (Scene.simulates(Game.state)) Game.step(Game.cfg.fixedDt, Game.autoInput(i / 60));
    Rec.input(Game.autoInput(i / 60));
    Input.endFrame();
  }
  const p = sess.player;
  p.xp = 9999;
  Game._internals.checkLevelUp();
  let lg = 0;
  while (Game.state === 'levelup' && lg++ < 40) Game.chooseLevelCard(0);
  p.scrap = 500;
  Game._internals.openShop(20);
  Game.buyOffer(0);
  Game.reroll();
  Game.toggleLock();
  sess.pendingBoons = Boons.roll(2, sess.rnd);
  const picked = sess.pendingBoons[0];
  Game.pickBoon(picked);            // 契约：不可撤销 + 当场重算属性

  const rngState = sess.rnd.state();
  const probe = U.rng(1); probe.setState(rngState);
  const expectRng = [];
  for (let i = 0; i < 5; i++) expectRng.push(probe());
  const costBefore = sess.rerollCost, rerollsBefore = sess.rerolls;

  const d1 = Game.exportRun();
  Game.importRun(d1);
  const d2 = Game.exportRun();
  const drift = Object.keys(d1).filter(k => JSON.stringify(d1[k]) !== JSON.stringify(d2[k]));
  ok(drift.length === 0, '存档**幂等**：export → import → export 逐字段一致', drift.join(', '));

  const back = Game.getSession();
  const gotRng = [];
  for (let i = 0; i < 5; i++) gotRng.push(back.rnd());
  ok(expectRng.join(',') === gotRng.join(','),
    '随机流**接着走**（不从头开始）—— 否则读档后的商店/选卡是另一条序列',
    expectRng.map(x => x.toFixed(4)).join(' ') + ' vs ' + gotRng.map(x => x.toFixed(4)).join(' '));

  ok(JSON.stringify(d1.offers) === JSON.stringify(d2.offers) && d1.offers.length > 0,
    '货架按存档还原（**不重掷**）：' + d1.offers.length + ' 件', JSON.stringify(d1.offers).slice(0, 70));
  ok(back.rerollCost === costBefore && back.rerolls === rerollsBefore,
    '刷新价与刷新次数跟着走（以前读档会把价跌回最低 → 反复存读刷便宜刷新）',
    back.rerollCost + ' / ' + back.rerolls);
  ok(back.shopLocked === true, '商店的锁定状态跟着走（以前读档会自己解锁）');
  ok(back.boon === picked, '层间契约跟着走（不可撤销的东西不能读档就没了）', back.boon);
  ok(Array.isArray(back.runEvents), '本局见过的遭遇（剧情记账）跟着走');
  const tape = Rec.stop();
  ok(tape.events.some(e => e.cmd === 'pickBoon'), '带子里录下了 pickBoon',
    [...new Set(tape.events.map(e => e.cmd))].join(','));
}

/* =========================================================
   4b-2. 两次真实的坏档回归（都是实测出来的，各有各的静默方向）
   ========================================================= */
console.log('\n[4b-2] 读档不许"白送"也不许"吞掉"');
{
  /* (a) **开局道具每读一次档就多一件**。
     原因：`importRun` 走 `Game.newRun(…, opening)`，而它会把天赋/据点给的开局道具
     发进 `p.items`；`data.items` 里**也有**它们（`exportRun` 写的就是 `p.items`），
     于是旧的恢复循环是在"已经有"的基础上再 push 一遍。武器没这个洞，因为它有
     `p.weapons.length = 0` 那一行。实测过：items 1→2→3→4、攻速 0.10→0.26→0.42→0.60，
     天赋「工程师」的炮塔 1→2→3（读两次档白拿两个炮塔）。 */
  Game.setState('title', true);
  const opening = { stats: {}, weapons: [], items: ['coffee'], scrap: 0 };
  const s = Game.newRun('ranger', 777001, 0, opening);
  const first = s.player.items.length;
  const atk1 = s.stats.attackSpeed;
  let items = first, atk = atk1;
  for (let round = 0; round < 3; round++) {
    const data = JSON.parse(JSON.stringify(Game.exportRun()));
    Game.importRun(data);
    items = Game.getSession().player.items.length;
    atk = Game.getSession().stats.attackSpeed;
  }
  ok(first === 1, '开局道具发下来了（1 件）', first);
  ok(items === first,
    '连读 3 次档，开局道具**不多不少**（' + first + ' 件）—— 多了就是白送属性', items);
  ok(Math.abs(atk - atk1) < 1e-9,
    '攻速也没被读档叠上去（' + atk1 + ' → ' + atk + '）', atk);

  /* (b) **房间效果（roomFx）不许在读档后丢掉**。
     存档点是"清完这一间 → 商店"，如果这一间正好是**商店房**，它带着
     `shopSlots:2 / shopDiscount:0.10`；`restoreFloor` 只贴进度、不跑进门内容
     （那是**一次性**的，不能重跑），所以这一份必须从存档里贴回来。
     实测过：不贴时同一间房同一份进度，货架 12 件变 8 件、道具包 6 涨到 7。 */
  const rfData = {
    char: 'ranger', seed: 424242, danger: 0, wave: 2, level: 1, xp: 0, hp: 20, scrap: 100,
    upgrades: {}, weapons: [{ id: 'pistol', t: 1 }], items: [], totals: {},
    floor: 1, roomsCleared: [], roomsSeen: [], walls: [], offers: [],
    roomFx: { shopSlots: 2, shopDiscount: 0.1, fastMul: 0, slowMul: 0 }
  };
  const back = Game.importRun(rfData);
  ok(!!back && back.roomFx.shopSlots === 2 && Math.abs(back.roomFx.shopDiscount - 0.1) < 1e-9,
    '读档把这一间的房间效果贴回来了（商店房：货架 +2 / 九折）',
    back ? JSON.stringify(back.roomFx) : 'null');
  const rfMissing = JSON.parse(JSON.stringify(rfData));
  delete rfMissing.roomFx;
  const back2 = Game.importRun(rfMissing);
  ok(!!back2 && back2.roomFx.shopSlots === 0 && back2.roomFx.shopDiscount === 0,
    '老存档没有 roomFx 字段 → 按"没有房间效果"兜底（不是 NaN / undefined）',
    back2 ? JSON.stringify(back2.roomFx) : 'null');

  /* (c) **武器的成本（`paid`）必须跟着存档走**。
     它是回收价的上限（`data_weapons.ts` 的 salvageOf）：读档把它洗成 0，
     就等于"买一把 → 存档 → 读档 → 回收"又变成净赚 —— 折扣套利换个入口回来了。
     老存档没有这个字段 → 0（当作捡来的），这是兼容而不是漏洞：老档里的武器也无法证明付过钱。 */
  Game.setState('title', true);
  Game.newRun('ranger', 777002, 0);
  const s2 = Game.getSession();
  s2.player.scrap = 500;
  Game._internals.openShop(0);
  const offer = s2.offers.filter(o => o.type === 'weapon')[0];
  ok(!!offer && Game.buyOffer(s2.offers.indexOf(offer)) === true, '买一件武器用于往返测量');
  const bought2 = s2.player.weapons.filter(w => w.paid > 0)[0];
  ok(!!bought2 && bought2.paid === offer.price,
    '买进来的武器记下了成交价（' + (bought2 && bought2.paid) + ' = ' + offer.price + '）');
  const d2 = JSON.parse(JSON.stringify(Game.exportRun()));
  ok(d2.weapons.some(w => w.p > 0), '成本进了存档（weapons[].p）', JSON.stringify(d2.weapons));
  const back3 = Game.importRun(d2);
  const bought3 = back3.player.weapons.filter(w => w.paid > 0)[0];
  ok(!!bought3 && bought3.paid === bought2.paid,
    '读档后成本还在（回收价上限不会被洗掉）', bought3 && bought3.paid);
  ok(Weapons.salvageOf(bought3, back3.salvageRate) <= bought3.paid,
    '于是读档后回收它仍然不赚钱（' + Weapons.salvageOf(bought3, back3.salvageRate) + ' ≤ ' + bought3.paid + '）');
}

/* =========================================================
   4c. 回放保真：会改一局状态的命令**一条都不能漏**
   ---------------------------------------------------------
   成绩码承诺"可离线复算"，那前提是带子能重建同一局。
   漏一条命令的表现是"回放出来的局少了一段"，而它**不会报错** ——
   所以这里两件事都守：清单完整性（对着 Rec.commands 比），
   以及"pickBoon 在回放里真的生效"（缺它时实测：原局 boon=swift，回放 boon=空）。
   ========================================================= */
console.log('\n[4c] 回放保真：带子的命令清单');
{
  const REQUIRED = ['newRun', 'setState', 'chooseLevelCard', 'nextWave', 'buyOffer', 'sellWeapon',
    'reroll', 'toggleLock', 'buyPack', 'openCamp', 'campBuy', 'campSell', 'enterRoom',
    'autoExplore', 'pickBoon', 'combine'];
  const have = Rec.commands();
  const missing = REQUIRED.filter(c => have.indexOf(c) < 0);
  ok(missing.length === 0, '会改一局状态的 ' + REQUIRED.length + ' 条命令都在录制清单里', missing.join(','));
  const unknown = have.filter(c => typeof Game[c] !== 'function');
  ok(unknown.length === 0, '清单里没有已经不是命令的名字', unknown.join(','));

  const statBoon = Boons.LIST.find(d => {
    const f = Boons.fold(d.id);
    return f && f.stats && Object.keys(f.stats).length > 0;
  });
  const key = Object.keys(Boons.fold(statBoon.id).stats)[0];
  Game.setState('title', true);
  const s3 = Game.newRun('ranger', 4242, 0);
  Game.setState('playing', true);
  Game._internals.startWave(3);
  const beforeStat = s3.stats[key];
  s3.pendingBoons = [statBoon.id];
  Rec.play({
    v: 1, frames: 1, seed: 4242,
    events: [{ frame: 0, cmd: 'pickBoon', args: [statBoon.id], seed: 4242 }],
    inputs: [[0, 0]]
  }, (x, y) => { if (Scene.simulates(Game.state)) Game.step(Game.cfg.fixedDt, { x: x, y: y }); Input.endFrame(); });
  ok(Game.getSession().boon === statBoon.id && Game.getSession().stats[key] !== beforeStat,
    '回放里 pickBoon 真的生效（' + statBoon.id + ' → ' + key + ' ' + beforeStat + ' → ' +
    Game.getSession().stats[key] + '）');
}

console.log('\n[5] 存档系统：坏档 / 版本 / 修复');
{
  Storage.wipe();

  // 版本不符
  Storage.setJSON(Storage.KEYS.run, { v: 99, at: Date.now(), kind: 'run', data: { char: 'gladiator', wave: 3 } });
  ok(Save.hasRun() === false && Save.loadRun() === null && /版本不符/.test(Save.lastError() || ''),
    '版本不符的存档被拒绝，并说明原因', Save.lastError());

  // 类型不符（把记录塞进 run 槽）
  Storage.setJSON(Storage.KEYS.run, { v: Save.VERSION, at: 1, kind: 'records', data: { runs: 1 } });
  ok(Save.hasRun() === false && /类型不符/.test(Save.lastError() || ''), '类型不符被拒绝', Save.lastError());

  // 完全不是 JSON
  Storage.set(Storage.KEYS.run, 'garbage{{{');
  ok(Save.hasRun() === false && Save.loadRun() === null, '非 JSON 数据被拒绝（不抛）');

  // 未知角色
  Storage.setJSON(Storage.KEYS.run, { v: Save.VERSION, at: 1, kind: 'run', data: { char: '不存在', wave: 2 } });
  ok(Save.hasRun() === false, '未知角色被拒绝');

  // 非法波次
  Storage.setJSON(Storage.KEYS.run, { v: Save.VERSION, at: 1, kind: 'run', data: { char: 'ranger', wave: 0 } });
  ok(Save.hasRun() === false, '波次 < 1 被拒绝');

  // 能修的修：未知武器/道具丢掉、其它照常
  Storage.setJSON(Storage.KEYS.run, {
    v: Save.VERSION, at: 1, kind: 'run',
    data: {
      char: 'ranger', seed: 7, wave: 3, level: 2, xp: 5, hp: 99999, scrap: -50,
      weapons: ['pistol', '这把武器不存在', 'sword'], items: ['coffee', '没这个道具'],
      upgrades: { damage: 0.25, 未知键: 9 }
    }
  });
  const s2 = Save.loadRun();
  ok(!!s2, '部分损坏的存档仍能恢复（能修的修）');
  if (s2) {
    const ids = s2.player.weapons.map(w => w.id);
    ok(ids.indexOf('pistol') >= 0 && ids.indexOf('sword') >= 0 && ids.indexOf('这把武器不存在') < 0,
      '未知武器被丢掉，已知武器保留', ids.join(','));
    ok(s2.player.items.length === 1 && s2.player.items[0].def.id === 'coffee',
      '未知道具被丢掉，已知道具保留');
    ok(s2.player.scrap === 0, '负数材料被夹回 0', s2.player.scrap);
    ok(s2.player.hp > 0 && s2.player.hp <= s2.stats.maxHp, '越界生命被夹回上限内',
      s2.player.hp + '/' + s2.stats.maxHp);
    ok(!('未知键' in s2.player.upgrades), '未知加点键被忽略');
    ok(s2.player.upgrades.damage === 0.25, '已知加点被还原');
  }
}

console.log('\n[6] 存档系统：战绩记录');
{
  Storage.wipe();
  const empty = Save.records();
  ok(empty.runs === 0 && empty.bestWave === 0, '没有记录时返回全 0 的可用对象（不是 null）');

    /* ⚠ 这里的**两种货币刻意取不同的数**（earned 100/50/10 = 废料累计，
       materials 7/3/2 = 材料累计）：早先两边都是同一个数字，
       所以"战绩屏的累计收集读的是废料而不是材料"这个 bug **测不出来** ——
       它在这个夹具里恒等成立。用不同的数才量得出读的是哪一个。 */
    Save.addRun({ win: false, wave: 5, level: 6, kills: 40, earned: 100, materials: 7 });
    Save.addRun({ win: false, wave: 3, level: 9, kills: 80, earned: 50, materials: 3 });
    Save.addRun({ win: true, wave: 8, level: 12, kills: 20, earned: 10, materials: 2 });
  const r = Save.records();
  ok(r.runs === 3 && r.wins === 1, '局数与胜场累计', r.runs + '/' + r.wins);
  ok(r.bestWave === 8 && r.bestKills === 80 && r.bestLevel === 12,
    '最好成绩取最大值而不是最后一次', JSON.stringify({ w: r.bestWave, k: r.bestKills, l: r.bestLevel }));
    ok(r.totalKills === 140, '总击杀累加', r.totalKills);
    ok(r.totalMaterials === 12,
      '「累计收集」累加的是**材料**（7+3+2），不是废料（100+50+10）',
      'totalMaterials=' + r.totalMaterials);
  ok(Save.addRun(null) === null, '空 summary 不会写坏记录');

  // 记录损坏 → 退回空白记录，而不是崩
  // ⚠ **必须连备份一起写坏**：`Slots.readJSON` 会在主键坏掉时**自动回退到备份**
  // （那是崩溃安全的设计），所以只写坏主键的话读到的其实是上一份好档 ——
  // 这条断言会红，而红的原因是"备份机制生效了"，不是"坏档没兜住"。
  Storage.set(Slots.key(Storage.KEYS.records), 'oops');
  Storage.set(Storage.backupKey(Slots.key(Storage.KEYS.records)), 'oops2');
  ok(Save.records().runs === 0, '记录损坏 → 退回空白记录');

  Save.clearRecords();
  ok(Save.records().runs === 0, 'clearRecords 生效');
}

console.log('\n[7] 存储适配层');
{
  const mem = Storage.memory();
  ok(Storage.use(mem) === true, '接入合法适配器成功');
  ok(Storage.use({ getItem: 1 }) === false, '形状不对的适配器被拒绝（保持原适配器不变）');
  ok(Storage.use(null) === false, 'null 被拒绝');

  Storage.set('x', 'hello');
  ok(Storage.get('x') === 'hello', '读写往返');
  Storage.setJSON('obj', { a: [1, 2, 3] });
  ok(JSON.stringify(Storage.getJSON('obj')) === '{"a":[1,2,3]}', 'JSON 往返');
  Storage.set('bad', '{oops');
  ok(Storage.getJSON('bad') === null, 'JSON 解析失败返回 null（不抛）');
  ok(Storage.get('不存在') === null, '缺失键返回 null');

  // 单条上限：防一条坏数据吃光配额
  const huge = 'x'.repeat(Storage.MAX_BYTES + 10);
  ok(Storage.setJSON('huge', { s: huge }) === false && /太大/.test(Storage.lastError() || ''),
    '超过单条上限的负载被拒绝并记录原因', String(Storage.lastError()).slice(0, 60));
  ok(Storage.remove('x') === true && Storage.get('x') === null, 'remove 生效');
}

console.log('\n=== 结果 ===');
if (failures === 0) console.log('\x1b[32m全部通过 ✔\x1b[0m');
else console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m');
process.exit(failures ? 1 : 0);
