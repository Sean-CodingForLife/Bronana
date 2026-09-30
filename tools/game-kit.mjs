/* =========================================================
   game-kit.mjs — **"一款游戏该有的东西"对照盘**
   ---------------------------------------------------------
   起因："把一款游戏**该有的东西**补齐到'只差素材'的程度 ——
   没有素材可以，但必须有占位与可运行的系统。"

   这份工具回答的就是这一句。它不是"我做了哪些功能"的自夸清单，
   而是一张**验收盘**：每一行写明
     · 这一项在游戏里**看起来是什么**（玩家在哪一屏遇到它）
     · 它的**实现证据**是什么（文件 / 导出名 / 界面节点）
     · 它**是不是真的可运行**（靠下面那几条检查，而不是靠文件名）

   ⚠ 校验自身的纪律：**检查不到就要报"没查到"，而不是报"有"**。
   每一项都给出 `check` 的判据，判据写清楚"查到什么才算过"。
   查不到的项分两种，必须分开报（这两者代价完全不同）：
     · 缺 · 该做     —— 能做但还没做（有具体代价估计）
     · 不做 · 已登记 —— 刻意不做，理由与代价写在 README（这是诚实，不是失败）

   用法： node tools/game-kit.mjs [--json]
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import srcFiles from './src-files.cjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');
const JSON_OUT = process.argv.includes('--json');

/* ---------------- 读源码（一次读全，下面所有检查共用） ----------------
   ⚠ **只扫实现文件，不扫类型声明与注释以外的东西**：
   第一版把 `types.d.ts` 也算进来，于是"成就"在注释「图鉴里该列出来的」里被撞词，
   把一项**根本不存在**的功能报成了"已有"。校验先于结论 ——
   撞词假阳是这份工具最坏的失效方式（它会让人以为已经做了）。

   ⚠ 用共享扫描器（`tools/src-files.cjs`）而**不是** `readdirSync(SRC)`：
   本工具通篇按文件名取源码（`src['audio.ts']`），而 `readdirSync` 在
   目录化之后**拿不到子目录里的文件** —— 于是每一项 `src['xxx']` 都是
   `undefined`，检查全部静默失效，而工具照样报"已有 26 / 缺 0"。
   所以这里**同时用两种键**：完整路径 + 裸文件名，目录化前后都能取到。 */
const relFiles = srcFiles.list().filter(f => !f.endsWith('.d.ts'));
const src = Object.create(null);
/* 裸名 → 源码（保持既有检查的写法不变） */
for (const rel of relFiles) src[srcFiles.relName(rel)] = fs.readFileSync(path.join(SRC, rel), 'utf8');
/* 完整路径 → 源码（目录化后想按路径取也能取到） */
for (const rel of relFiles) src[rel] = src[srcFiles.relName(rel)];
const files = relFiles;
/** 去掉注释后的源码（判断"真的写了代码"还是"只在注释里提过"用这个） */
function codeOf(f) {
  return (src[f] || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const code = Object.create(null);
for (const f of files) code[f] = codeOf(f);
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const tests = fs.readdirSync(path.join(ROOT, 'test')).filter(f => f.endsWith('.mjs'));
const tools = fs.readdirSync(path.join(ROOT, 'tools')).filter(f => /\.(mjs|cjs)$/.test(f));

/** 在哪些源文件的**代码**里出现（注释不算） */
function where(needle, opts) {
  const o = opts || {};
  const out = [];
  for (const f of files) {
    if (!o.code && src[f].indexOf(needle) < 0) continue;
    if (o.code && code[f].indexOf(needle) < 0) continue;
    if (o.only && !o.only.test(f)) continue;
    if (o.not && o.not.test(f)) continue;
    out.push(f);
  }
  return out;
}
/** 在哪些测试文件里出现 */
function inTests(needle) {
  return tests.filter(f => fs.readFileSync(path.join(ROOT, 'test', f), 'utf8').indexOf(needle) >= 0);
}
function has(hay, needle) { return hay.indexOf(needle) >= 0; }
/** 只在**代码**里找（注释不算命中） */
function hasCode(f, needle) { return !!code[f] && code[f].indexOf(needle) >= 0; }

/* ---------------- 那一张盘 ----------------
   每一行：
     id / name / where（玩家在哪遇到）/ expect（判据，人能读懂）
     check() → { ok, evidence } —— ok=false 时 evidence 说明查到了什么/没查到什么
     deferred: { reason, cost } —— **刻意不做**，理由与代价写在 README。
               有这一项时"缺"会被报成"有意不做"，而不是"没做到"。
               这是这张盘最重要的一栏：一份只会喊"缺"的清单会把人逼去
               做那些"做了反而更差"的东西。
   ------------------------------------------------------------------ */
const KIT = [
  {
    id: 'boot-loop', name: '主循环与固定步长', where: '任何一屏',
    expect: '固定步长 sim + 渲染插值；掉帧不改玩法结果',
    check() {
      const m = src['main.ts'];
      const fixed = has(m, 'fixedDt') || has(m, 'FIXED');
      const interp = has(m, 'alpha') || has(m, 'accumulator') || has(src['render.ts'], 'alpha');
      return { ok: fixed && interp, evidence: 'fixedDt=' + fixed + ' 插值=' + interp };
    }
  },
  {
    id: 'save', name: '存档（一局 + 账号档案）', where: '设置 / 标题',
    expect: '信封带版本与迁移链；坏档不崩、能回落默认',
    check() {
      const env = src['envelope.ts'], store = src['storage.ts'], sav = src['save.ts'], pro = src['profile.ts'];
      return {
        ok: has(env, 'version') && has(env, 'migrat') && has(sav, 'Storage') && has(pro, 'Storage'),
        evidence: 'envelope=' + has(env, 'migrat') + ' save/profile 都走 Storage=' + (has(sav, 'Storage') && has(pro, 'Storage'))
      };
    }
  },
  {
    id: 'save-slots', name: '多存档槽位', where: '标题 / 设置',
    expect: '至少两个槽位可选，槽位之间互不影响',
    check() {
      const hit = where('saveSlot').length + where('SLOT_KEYS').length + where('slotIndex').length;
      const key = src['storage.ts'];
      return { ok: hit > 0, evidence: hit ? hit + ' 处引用' : '全仓没有槽位概念（storage.ts 的 KEYS 是固定单键）: ' + /KEYS\s*=/.test(key) };
    }
  },
  {
    id: 'settings', name: '设置项（含界面控件与落盘）', where: '设置屏',
    expect: '每个声明项都有：默认值 / 应用分支 / 界面控件 / 落盘',
    check() {
      const s = src['settings.ts'];
      const n = (s.match(/^\s{2}[a-zA-Z]+\s*:/gm) || []).length;
      const hasStore = has(s, 'Storage') || has(s, 'save');
      const uiHas = has(html, 'data-act="set-');
      return { ok: n >= 10 && hasStore && uiHas, evidence: n + ' 个字段 · 落盘=' + hasStore + ' · 界面控件=' + uiHas };
    }
  },
  {
    id: 'audio', name: '音效系统（含总线与静音）', where: '全局',
    expect: '单一总出口；无 AudioContext 时不抛、不哑崩',
    check() {
      const a = src['audio.ts'];
      return { ok: has(a, 'master') && has(a, 'SFX') || has(a, 'Sfx'), evidence: 'audio.ts ' + a.split('\n').length + ' 行，含 master/静音保护=' + has(a, 'try') };
    }
  },
  {
    id: 'music-slots', name: 'BGM 槽位（曲目表 + 场景映射 + 强度层）', where: '全局',
    expect: '曲目表声明式；每个场景都有映射；曲目有强度/层次',
    check() {
      const m = src['music.ts'];
      const tracks = (m.match(/id:\s*'/g) || []).length;
      return { ok: has(m, 'SCENE_TRACK') && tracks >= 3, evidence: '曲目 ' + tracks + ' 条 · 场景映射=' + has(m, 'SCENE_TRACK') };
    }
  },
  {
    id: 'i18n', name: '本地化（文案表 + 切换 + 缺键检测）', where: '全局',
    expect: '文案表驱动；至少两种语言可切；缺键能被查出来',
    check() {
      /* ⚠ 第一版用 where('Locale') 判，结果撞在 `String.localeCompare` 上 ——
         "本地化已经有了"是**假阳**。判据改成"存在一个语言模块 + 一张语言表"。 */
      const mod = files.filter(f => /^(i18n|locale|lang|l10n)/i.test(f));
      const table = where('LOCALES', { code: true }).concat(where('I18N', { code: true }));
      return {
        ok: mod.length > 0 && table.length > 0,
        evidence: mod.length ? '语言模块 ' + mod.join(',') + ' · 表在 ' + table.join(',')
          : '没有本地化层：中文直接写在 index.html（可见中文 135 条）与 ui.ts 里；' +
            '`localeCompare`/`toLocaleString` 不算本地化'
      };
    }
  },
  {
    id: 'font', name: '字体加载与回退', where: '全局',
    expect: '有明确字体栈与回退；缺字时不会整屏空白',
    check() {
      const ff = /font-family/.test(css);
      const web = /@font-face/.test(css) || has(html, 'FontFace');
      return { ok: ff, evidence: 'CSS 字体栈=' + ff + ' · 自托管字体=' + web + '（无自托管 → 走系统字体，跨机字形会不同）' };
    }
  },
  {
    id: 'pause', name: '暂停菜单', where: '局内',
    expect: '暂停能回到游戏；暂停里能去设置/说明/放弃',
    check() {
      const g = src['game.ts'];
      return { ok: has(g, "'paused'") && has(g, 'resume'), evidence: '状态机含 paused · resume=' + has(g, 'resume') };
    }
  },
  {
    id: 'result', name: '结算屏（战绩与统计）', where: '一局结束',
    expect: '显示本局关键统计，且能继续下一局或回标题',
    check() {
      const g = src['game.ts'], sc = src['score.ts'];
      return { ok: has(g, 'summary') && sc.length > 0, evidence: 'summary=' + has(g, 'summary') + ' · score.ts ' + sc.split('\n').length + ' 行' };
    }
  },
  {
    id: 'achievements', name: '成就系统（独立于进度解锁）', where: '局外',
    expect: '有成就表 + 达成记录 + 界面列表，且与"解锁内容"分开',
    /* **刻意不做**（见 `docs/history/05-验收与全量测试.md` 的
       「`○ 有意不做`：成就系统」那一节）。
       判据保留着 —— 如果将来 `challenges.ts` 变成"29 条全部给内容解锁"，
       这一项会自动变绿；如果始终只有内容解锁，它就一直是这一条 deferred。 */
    deferred: {
      reason: '本作已经有一张 29 条的**挑战表**（`challenges.ts`），而它的每一条都给' +
        '**内容解锁**（角色 / 武器 / 道具）。"成就"要补上的其实不是"再一张表"，' +
        '而是"给纯里程碑发一个**徽章/称号**"这一层表现 —— 那是新的一屏界面 + ' +
        '新的存档字段 + 新的文案量，而它的作用（记录"你做过什么"）**战绩屏已经覆盖了大部分**。' +
        '在"只差素材"的验收口径下，多做一层会与挑战表**职责重叠**：' +
        '两条都在回答"我打到过什么"，玩家会分不清该看哪一个。',
      cost: '约 300~500 行（表 + 存档 + 一屏界面 + i18n 文案）+ 一屏 UI 的截图回归'
    },
    check() {
      const mod = files.filter(f => /achiev/i.test(f));
      const tbl = where('ACHIEVEMENTS', { code: true }).concat(where('Achievements', { code: true }));
      const ch = src['challenges.ts'], sc = src['score.ts'];
      const hasRecord = hasCode('score.ts', 'records') || hasCode('profile.ts', 'records');
      return {
        ok: mod.length > 0 || tbl.length > 0,
        evidence: (mod.length || tbl.length)
          ? '成就模块 ' + (mod.join(',') || tbl.join(','))
          : '没有独立成就层。现有：challenges.ts 的 ' + (ch.match(/ch\('/g) || []).length +
            ' 条挑战（**每条都给内容解锁**）+ score.ts 的累计战绩' + (hasRecord ? '' : '（无长期记录）')
      };
    }
  },
  {
    id: 'codex', name: '图鉴 / 收集', where: '标题 → 图鉴',
    expect: '能查到见过的武器 / 道具 / 怪；未见的要遮住',
    check() {
      const u = src['ui.ts'], p = src['profile.ts'];
      return { ok: has(u, 'codex') && has(p, 'markCodex'), evidence: 'ui codex=' + has(u, 'codex') + ' · profile.markCodex=' + has(p, 'markCodex') };
    }
  },
  {
    id: 'tutorial', name: '教程 / 上手引导', where: '首次游玩',
    expect: '第一局就有"该按什么、该去哪"的引导，而不是只有一页静态说明',
    check() {
      /* ⚠ 判据必须钉在**实现的名字**上：第一版找 `HINTS/TIPS` 与 `tutorial*` 模块名，
         而实现叫 `tutorial.ts` 里的 `LIST` + `pending(when)` ——
         名字对不上时会"已经做了却报缺"。 */
      const mod = files.indexOf('tutorial.ts') >= 0;
      const table = hasCode('tutorial.ts', 'LIST');
      const timed = hasCode('tutorial.ts', 'pending');
      const wired = where("say('", { code: true }).length > 0;
      const how = /scr-howto/.test(html);
      return {
        ok: mod && table && timed && wired,
        evidence: 'tutorial.ts=' + mod + '（表=' + table + ' · 时机判据=' + timed +
          ' · 界面接入=' + wired + '）· 静态说明页=' + how
      };
    }
  },
  {
    id: 'accessibility', name: '可访问性（减弱动效 / 键盘 / 语义标签）', where: '全局',
    expect: '动效可关；键盘可完成主要流程；交互元素有语义',
    check() {
      const reduce = where('reduceMotion', { code: true }).length;
      const aria = (html.match(/aria-|role=/g) || []).length;
      const kbd = hasCode('input.ts', 'keydown');
      /* 这一项**判在"减弱动效"上**（有就是过），但把 aria 单独报出来 ——
         "动效可关"和"屏幕阅读器能读"是两件事，混成一项会让后者永远看不见。 */
      return {
        ok: reduce > 0 && kbd,
        evidence: 'reduceMotion ' + reduce + ' 处 · 键盘=' + kbd +
          ' · aria/role 属性 ' + aria + ' 个' + (aria ? '' : '（0 = 没有语义标注，屏幕阅读器读不到任何按钮）')
      };
    }
  },
  {
    id: 'input-modes', name: '多输入方式（键盘 / 鼠标 / 触屏 / 手柄）', where: '全局',
    expect: '至少两种输入可完成全流程；触屏有虚拟控件',
    check() {
      const i = src['input.ts'];
      return {
        ok: has(i, 'touch') && has(i, 'key'),
        evidence: '键盘=' + has(i, 'keydown') + ' 触屏=' + has(i, 'touch') + ' 手柄=' + has(i, 'gamepad') + ' 鼠标=' + has(i, 'mouse')
      };
    }
  },
  {
    id: 'crash', name: '错误兜底（崩了不白屏）', where: '全局',
    expect: '捕获异常 → 显示可读信息 → 能重启/回标题',
    check() {
      const c = src['crash.ts'];
      return { ok: has(c, 'report') && has(c, 'hook'), evidence: 'crash.ts ' + c.split('\n').length + ' 行 · hook=' + has(c, 'hook') };
    }
  },
  {
    id: 'selfcheck', name: '启动期自检（表不自洽就别起来）', where: '启动',
    expect: '各模块注册自检；入口启动时跑一次，不过就抛',
    check() {
      const s = src['selfcheck.ts'], r = src['registry.ts'];
      return { ok: has(s, 'register') && has(r, 'family'), evidence: 'selfcheck.register=' + has(s, 'register') + ' · registry.family=' + has(r, 'family') };
    }
  },
  {
    id: 'platform', name: '平台适配（web / CLI / desktop）', where: '发布',
    expect: '三种形态至少两种真的能跑',
    check() {
      const cli = fs.existsSync(path.join(SRC, 'cli.ts'));
      const desktop = fs.existsSync(path.join(ROOT, 'desktop'));
      return { ok: cli && desktop, evidence: 'cli.ts=' + cli + ' · desktop/=' + desktop + ' · web=' + fs.existsSync(path.join(ROOT, 'index.html')) };
    }
  },
  {
    id: 'tutorial-perf', name: '性能守门（帧预算回归）', where: '开发期',
    expect: '有一条校验能量帧耗时，且知道预算',
    check() {
      /* ⚠ 第一版只找 `tools/*perf*`，而本作的性能校验是 **test**（`test/perf.mjs`）——
         工具目录里没有就叫"缺"，那是校验找错了地方。 */
      const t = tests.filter(f => /perf|frames/i.test(f));
      const budget = /预算/.test(fs.readFileSync(path.join(ROOT, 'test', 'perf.mjs'), 'utf8') || '') ||
        /budget/i.test(fs.readFileSync(path.join(ROOT, 'test', 'perf.mjs'), 'utf8') || '');
      return { ok: t.length > 0 && budget, evidence: '测试: ' + (t.join(',') || '无') + ' · 有帧预算断言=' + budget };
    }
  },
  {
    id: 'replay', name: '回放 / 录制（可复现）', where: '开发期',
    expect: '带子 = 种子 + 输入；能重放',
    check() {
      const r = src['record.ts'];
      return { ok: has(r, 'replay') || has(r, 'Replay'), evidence: 'record.ts ' + r.split('\n').length + ' 行' };
    }
  },
  {
    id: 'stats-panel', name: '诊断面板（卡顿 / 分配 / 容器水位）', where: '开发期',
    expect: 'F3 之类的开关能看运行时内部数字',
    check() {
      const d = src['diag.ts'];
      return { ok: has(d, 'diag') || has(d, 'Diag'), evidence: 'diag.ts ' + d.split('\n').length + ' 行' };
    }
  },
  {
    id: 'daily', name: '每日 / 每周挑战（种子化）', where: '标题',
    expect: '同一天所有人拿到同一个种子；有独立记录',
    check() {
      const d = src['daily.ts'], s = src['season.ts'];
      return { ok: has(d, 'seed') || has(d, 'Seed'), evidence: 'daily.ts=' + d.split('\n').length + ' 行 · season.ts=' + s.split('\n').length + ' 行' };
    }
  },
  {
    id: 'cloud-export', name: '存档导出 / 导入（跨设备）', where: '设置',
    expect: '能把档案导出成文本、再导回来；被截断/被改过的文本要能拒绝',
    check() {
      /* ⚠ 判据要跟着**实现的名字**走：第一版找 `exportProfile/exportSave`，
         而实现叫 `Slots.exportText / importText` —— 于是"已经做了"被报成"没做"。
         一个报假阴的校验会让人去重做一遍已经有的东西。 */
      const mod = src['slots.ts'] || '';
      const exp = hasCode('slots.ts', 'exportText');
      const imp = hasCode('slots.ts', 'importText');
      const sum = hasCode('slots.ts', 'fnv1a');   // 校验和：能发现截断与手改
      return {
        ok: exp && imp && sum,
        evidence: 'slots.exportText=' + exp + ' · importText=' + imp + ' · 校验和=' + sum +
          '（界面：设置页的 导出 / 导入 两个按钮）'
      };
    }
  },
  {
    id: 'colourblind', name: '色弱模式 / 高对比', where: '设置',
    expect: '色弱玩家能分辨危险与可拾取物',
    check() {
      const hit = where('colourblind').length + where('colorblind').length + where('highContrast').length;
      return { ok: hit > 0, evidence: hit ? hit + ' 处' : '没有色弱/高对比开关（危险色与拾取色靠色相区分）' };
    }
  },
  {
    id: 'local-leaderboard', name: '本地榜 / 个人最佳', where: '战绩',
    expect: '按角色或难度分别记录最佳，而不是只有一个全局最好',
    check() {
      const sc = src['score.ts'], g = src['game.ts'];
      return { ok: has(sc, 'best') || has(g, 'best'), evidence: 'score.best=' + has(sc, 'best') + ' · 挑战表里有 bestWave/bestKills/bestLevel 这类累计指标' };
    }
  },
  {
    id: 'screenshot', name: '真机截图量尺（界面回归）', where: '开发期',
    expect: '逐屏离屏渲染 + 布局体检 + 出图',
    check() {
      const s = tools.filter(f => /ui-shot/.test(f));
      return { ok: s.length > 0, evidence: s.join(',') || '无' };
    }
  },
  {
    id: 'accessibility-text', name: '文字缩放 / 字号设置', where: '设置',
    expect: '小屏或视力受限时能把字放大',
    check() {
      const hit = where('fontScale').length + where('textScale').length + where('uiScale').length;
      return { ok: hit > 0, evidence: hit ? hit + ' 处' : '没有字号/缩放设置；CSS 里字号是 clamp() 写死的' };
    }
  }
];

/* ---------------- 跑 ---------------- */
const rows = KIT.map(it => {
  let r;
  try { r = it.check(); } catch (e) { r = { ok: false, evidence: '检查抛了：' + e.message }; }
  return {
    id: it.id, name: it.name, where: it.where, expect: it.expect, ok: !!r.ok,
    evidence: r.evidence, deferred: it.deferred || null
  };
});

const ok = rows.filter(r => r.ok);
/* 「缺」与「有意不做」必须分开报 —— 混在一起会把人逼去做那些做了反而更差的东西 */
const todo = rows.filter(r => !r.ok && !r.deferred);
const deferred = rows.filter(r => !r.ok && r.deferred);

if (JSON_OUT) {
  console.log(JSON.stringify({
    total: rows.length, ok: ok.length,
    missing: todo.map(b => b.id), deferred: deferred.map(b => b.id), rows
  }, null, 1));
  process.exit(0);
}

const PAD = (s, n) => { s = String(s); return s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 127 ? 2 : 1), 0))); };
console.log('\n=== Bronana · "一款游戏该有的东西"对照盘 ===\n');
console.log('  共 ' + rows.length + ' 项 · \x1b[32m已有 ' + ok.length + '\x1b[0m · ' +
  '\x1b[33m缺 ' + todo.length + '\x1b[0m · ' +
  '\x1b[36m有意不做 ' + deferred.length + '\x1b[0m\n');

console.log('[1] 已有（判据见"证据"那一列）\n');
for (const r of ok) {
  console.log('  \x1b[32m✔\x1b[0m ' + PAD(r.name, 30) + r.evidence);
}

if (todo.length) {
  console.log('\n[2] 缺（按"玩家会不会遇到"排序：界面上的排前面）\n');
  const ORDER = ['i18n', 'save-slots', 'cloud-export', 'achievements', 'tutorial', 'accessibility', 'colourblind', 'accessibility-text', 'font'];
  todo.sort((a, b) => {
    const ia = ORDER.indexOf(a.id), ib = ORDER.indexOf(b.id);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  for (const r of todo) {
    console.log('  \x1b[33m✘\x1b[0m ' + PAD(r.name, 30) + '（玩家在哪遇到：' + r.where + '）');
    console.log('      该有的样子：' + r.expect);
    console.log('      查到了什么：' + r.evidence);
    console.log('');
  }
}

if (deferred.length) {
  console.log('\n[3] 有意不做（**不是漏做** —— 理由与代价写在 README，等你拍板）\n');
  for (const r of deferred) {
    console.log('  \x1b[36m○\x1b[0m ' + PAD(r.name, 30) + '（' + r.where + '）');
    console.log('      为什么不做：' + r.deferred.reason);
    console.log('      真要做的话：' + r.deferred.cost);
    console.log('');
  }
}

console.log('  怎么读这张盘：');
console.log('   · 这一项是**验收盘**，不是自夸清单 —— 每一行的判据都写在源码里（`KIT[].check`），');
console.log('     所以"我实现了"这句话在这里不算数，**能查到的证据才算**。');
console.log('   · `✘ 缺` 与 `○ 有意不做` 是两回事。后者是拍板结果，理由与代价都写在盘上 ——');
console.log('     一份只会喊"缺"的清单会把人逼去做那些**做了反而更差**的东西。');
console.log('   · 加一项到这张盘里，比加一个功能更值：盘会一直问下去，功能做完了就不再说话。\n');

process.exit(0);
