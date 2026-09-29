/* =========================================================
   i18n.ts — 本地化（文案表驱动 + 语言切换 + 缺键可查）
   ---------------------------------------------------------
   改造前：**零本地化**。中文直接写在 `index.html`（可见文本 111 条）
   与 `ui.ts` 的字面量里，改一句话要改三处、且没有任何一处能回答
   "哪些文案还没翻译"。

   这一版的设计只有三条，每一条都是为了**不制造新的漂移来源**：

   1. **以中文原文当键**（`T('开 始 游 戏')`）。
      为什么不另起一套 `menu.start` 之类的 id：
      另起 id 就多了一层"id ↔ 文案"的映射要维护，而那份映射**没有真相**
      —— 改了文案忘了改 id，表现是"界面显示旧文案"，最难查的那种。
      用原文当键时，`zh` 表可以**空着**（键就是它自己），
      于是"中文永远是对的"是结构保证，不是纪律。

   2. **界面是唯一真相，表是它的产物**。
      `tools/extract-ui-text.mjs` 从 `index.html` 抽出所有可见中文，
      `--check` 报"界面里有、表里没有"的键。
      于是**漏翻会被查出来**，而不是靠人记得。

   3. **缺键回退到键本身**（也就是回退到中文），并且**能被数出来**。
      缺键时界面显示中文而不是空白或 `menu.start` —— 半翻译的界面
      比全中文的界面更糟，这条路把它压到最小。

   覆盖率的诚实口径：`I18n.coverage()` 报的是"表里有多少条**有该语言的译文**"。
   **不追求 100%**：`zh` 结构上就是 100%（键即原文），`en` 是部分覆盖，
   而缺的那些在界面上会显示中文 —— 这件事会写进 README，不藏。
   ========================================================= */
import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';

var I18n = {} as I18nApi;

/* =========================================================
   1. 语言表（一张：加一种语言 = 加一行 + block 一份译文）
   ---------------------------------------------------------
   `dir` / `name` / `en` 都进表：界面按 `name` 显示语言自己怎么称呼自己
   （"简体中文" / "English"），而不是按当前语言翻译它 —— 一个只会中文的玩家
   在英文界面里要能找回中文，所以语言名**永远用它的母语写**。
   ========================================================= */
var LOCALES: LocaleDef[] = [
  { id: 'zh', name: '简体中文', en: 'Chinese (Simplified)', dir: 'ltr', default: true },
  { id: 'en', name: 'English', en: 'English', dir: 'ltr', default: false }
];

/** 当前语言（**可变状态**：`test/persist.mjs` 的 ALLOWED 里登记着它） */
var current = 'zh';

function localeOf(id) {
  for (var i = 0; i < LOCALES.length; i++) if (LOCALES[i].id === id) return LOCALES[i];
  return null;
}

/* =========================================================
   2. 文案表
   ---------------------------------------------------------
   结构：`MESSAGES['en']['中文原文'] = 'English'`。
   `zh` **不建表** —— 查不到就是原文（见文件头第 1 条）。
   ========================================================= */
var MESSAGES: Record<string, Record<string, string>> = Object.create(null);

MESSAGES.en = {
  /* ---- 标题与主菜单 ---- */
  '开 始 游 戏': 'START',
  '继 续 上 一 局': 'CONTINUE',
  '每 日 挑 战': 'DAILY',
  '每 周 挑 战': 'WEEKLY',
  '枢 纽': 'HUB',
  '操 作 说 明': 'CONTROLS',
  '设 置': 'SETTINGS',
  '战 绩': 'RECORDS',
  '图 鉴 与 挑 战': 'CODEX & CHALLENGES',
  '据 点': 'STRONGHOLD',
  'WASD 移动 · 武器自动开火 · 波次结束进商店': 'WASD to move · weapons fire on their own · shop opens between waves',

  /* ---- 选人 / 难度 ---- */
  '选 择 角 色': 'CHOOSE A CHARACTER',
  '难度': 'Danger',
  '天 赋': 'Talents',
  '返 回': 'Back',
  '确 认 出 发': 'DEPART',

  /* ---- 商店 ---- */
  '商 店': 'SHOP',
  '废料': 'Scrap',
  '武 器': 'Weapons',
  '道 具': 'Items',
  '刷 新': 'Reroll',
  '锁 定 商 店': 'Lock shop',
  '去 营 地': 'To camp',
  '普通道具包': 'Basic pack',
  '高级道具包': 'Deluxe pack',
  '自动探索': 'Auto-explore',

  /* ---- 升级 / 暂停 ---- */
  '升 级 ！ 选 择 一 项 强 化': 'LEVEL UP — pick one',
  '暂 停': 'PAUSED',
  '继 续': 'Resume',
  '放 弃 本 局': 'Abandon run',

  /* ---- 设置项（与 `settings.ts` 的 label 一一对应） ---- */
  '音效': 'Sound',
  '背景音乐': 'Music',
  '音量': 'Volume',
  '游戏速度': 'Game speed',
  '屏幕抖动': 'Screen shake',
  '帧率叠加层': 'FPS overlay',
  '伤害数字': 'Damage numbers',
  '减弱动效': 'Reduce motion',
  '自动暂停': 'Auto-pause',
  '语言': 'Language',

  /* ---- 开关 ---- */
  '开': 'On',
  '关': 'Off',
  '总是': 'Always',
  '从不': 'Never',

  /* ---- 新增设置项（这一轮补的） ---- */
  '字号': 'Text size',
  '小': 'Small',
  '中': 'Medium',
  '大': 'Large',
  '色弱模式': 'Colour-blind mode',
  '高对比': 'High contrast',
  '存档槽位': 'Save slot',
  '槽位': 'Slot',
  '空': 'Empty',
  '导出存档': 'Export save',
  '导入存档': 'Import save',
  '复制到剪贴板': 'Copy to clipboard',
  '从文本导入': 'Import from text',
  '重置本槽位': 'Reset this slot',

  /* ---- 首局引导（`tutorial.ts` 的文案；键就是那几句中文原文） ---- */
  'WASD 移动 —— 武器会自己开火，你只管走位':
    'WASD to move — your weapons fire by themselves, just keep moving',
  '这里是商店：花废料买武器与道具。同名同档的两把可以合并成高一档':
    'This is the shop: spend scrap on weapons and items. Two of the same name and tier merge into the next tier',
  '清完一间就能选下一扇门 —— 门上的图标告诉你会遇到什么':
    'Clear a room to pick the next door — the icon on it tells you what you will find',
  '升级了：四张卡挑一张。带「防」字的是防御向，等级越高越常出现':
    'Level up: pick one of four cards. Cards marked DEF are defensive — they show up more often at higher levels',
  '血量过半了 —— 血到 0 就是这一局结束，但打到的材料会带出局（那是经营的本钱）':
    'Past half HP — at 0 this run ends, but the materials you gather come out with you',
  '关底 Boss：打倒它掉**核心材料** —— 局外的据点与图纸都要它':
    'Floor boss: beating it drops CORE MATERIAL — the stronghold and blueprints both need it',
  '工坊能自己造：花废料 + 占一条产线。设施位与产线是可以经营的':
    'The workshop crafts things: costs scrap and takes a production line. Both lines and slots are yours to manage',
  '这里是枢纽：据点是经营（产能与容量），天赋是养成（永久成长）':
    'This is the hub: the Stronghold is Management (capacity), Talents are Growth (permanent power)',

  /* ---- 存档与错误兜底 ---- */
  '存档已复制': 'Save copied',
  '存档已导入': 'Save imported',
  '导入失败：文本不是合法的存档': 'Import failed: not a valid save',
  '存档损坏，已回退到上一次的备份': 'Save was corrupt — rolled back to the last backup',
  '出了点问题': 'Something went wrong',
  '重新开始': 'Restart',
  '回到标题': 'Back to title'
};

/* =========================================================
   3. 查询与切换
   ========================================================= */
I18n.LOCALES = LOCALES;
I18n.DEFAULT = 'zh';

/** 清单里有没有这种语言 */
I18n.has = function (id) { return !!localeOf(id); };

I18n.current = function () { return current; };

/**
 * 切语言。
 * @param id   语言 id
 * @param root 可选：只重写这一棵子树（**测试与局部刷新用**）。
 *             缺省 = 整个 `document`（生产路径）。
 *
 * 只认清单里的 id —— 不认识的**保持原样**并返回 false（不静默变英文）。
 */
I18n.set = function (id, root) {
  if (!localeOf(id)) return false;
  if (id === current) return true;
  current = id;
  I18n.applyDom(root);
  return true;
};

/**
 * 取一句译文。
 * @param key 中文原文（**键就是原文**，见文件头第 1 条）
 * @param vars 可选插值：`T('第 {n} 波', { n: 3 })`
 *
 * 查不到就返回 key 本身 —— 也就是**回退到中文**。
 * 这是刻意的：半翻译的界面里，一句中文远好过一句 `menu.start`。
 */
I18n.t = function (key, vars) {
  var s = String(key == null ? '' : key);
  var table = MESSAGES[current];
  if (table && Object.prototype.hasOwnProperty.call(table, s) && table[s]) s = table[s];
  if (vars) {
    for (var k in vars) {
      if (!Object.prototype.hasOwnProperty.call(vars, k)) continue;
      s = s.split('{' + k + '}').join(String(vars[k]));
    }
  }
  return s;
};

/* =========================================================
   4. DOM 应用
   ---------------------------------------------------------
   机制：**按当前语言重新绑定**。
   · 进界面时给每个"纯文本元素"记下它的**原文**（`_i18nKey`），
     于是切语言时不需要重扫一遍源码，也不会把已翻译的英文当成新键。
   · `data-i18n` 属性可以显式标一个键（用在"元素里混了子节点"的场合，
     那种结构没法从 textContent 反推原文）。
   ========================================================= */
function isTranslatableText(s) {
  return s.length > 0 && s.length <= 40;
}

/** 绑定的候选集：**传进来那个节点本身也要算**。
    第一版只遍历 `querySelectorAll('*')`（后代不含自己），于是
    `I18n.bindDom(el)` 对 el 自己**永远不生效** —— 测试里正好撞上这个坑。 */
function elementsIn(scope) {
  var out = [];
  var hasTag = scope && typeof scope.tagName === 'string' && scope.tagName !== '';
  if (hasTag) out.push(scope);
  if (scope && typeof scope.querySelectorAll === 'function') {
    var nodes = scope.querySelectorAll('*');
    for (var i = 0; i < nodes.length; i++) out.push(nodes[i]);
  }
  return out;
}

/** 绑定：把当前 DOM 里的中文原文记下来（**只记一次**，之后切换语言都靠它） */
I18n.bindDom = function (root) {
  if (typeof document === 'undefined') return 0;
  var nodes = elementsIn(root || document);
  var n = 0;
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    var tag = (el.tagName || '').toLowerCase();
    if (tag === 'canvas' || tag === 'script' || tag === 'style') continue;
    var explicit = el.getAttribute ? el.getAttribute('data-i18n') : null;
    if (explicit) { el._i18nKey = explicit; n++; continue; }
    /* 只认"元素里只有一段文字"的那种：有子元素就跳过 ——
       混合结构用 textContent 反推会把子节点的字也吞进来。 */
    if (el.children && el.children.length) continue;
    var txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!txt || !isTranslatableText(txt)) continue;
    /* 只把**表里认得的**记下来：否则整屏每一个文本节点都会被记住，
       切语言时都要跑一遍查找（而且很容易把数字/动态值当成文案）。 */
    if (!MESSAGES.en || !Object.prototype.hasOwnProperty.call(MESSAGES.en, txt)) continue;
    el._i18nKey = txt;
    n++;
  }
  return n;
};

/** 应用：按当前语言把绑过的节点写回去 */
I18n.applyDom = function (root) {
  if (typeof document === 'undefined') return 0;
  var nodes = elementsIn(root || document);
  var n = 0;
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    if (!el._i18nKey) continue;
    var want = I18n.t(el._i18nKey);
    if (el.textContent !== want) { el.textContent = want; n++; }
  }
  return n;
};

/* =========================================================
   5. 覆盖率（诚实口径：没有该语言译文的条数）
   ========================================================= */
I18n.coverage = function (id) {
  var loc = localeOf(id || current);
  if (!loc) return { total: 0, translated: 0, missing: 1, ratio: 0 };
  if (loc.id === I18n.DEFAULT) {
    /* 默认语言结构上就是全覆盖：键就是原文 */
    var total0 = Object.keys(MESSAGES.en || {}).length;
    return { total: total0, translated: total0, missing: 0, ratio: 1 };
  }
  var table = MESSAGES[loc.id] || {};
  var keys = Object.keys(MESSAGES.en || {});
  var missing = 0;
  for (var i = 0; i < keys.length; i++) {
    var v = table[keys[i]];
    if (!v || !String(v).trim()) missing++;
  }
  return {
    total: keys.length, translated: keys.length - missing, missing: missing,
    ratio: keys.length ? (keys.length - missing) / keys.length : 1
  };
};

/** 缺哪些键（界面与体检工具都读同一份判据） */
I18n.missingKeys = function (id) {
  var loc = localeOf(id || current);
  /* 默认语言**没有"缺键"这个概念**：键就是原文，它天然全覆盖。
     第一版这里照样去查表，于是 `missingKeys('zh')` 报出 65 条 ——
     一个吓人但毫无意义的数字（那把尺子量错了对象）。 */
  if (loc && loc.id === I18n.DEFAULT) return [];
  var table = MESSAGES[(loc && loc.id) || I18n.DEFAULT] || {};
  var keys = Object.keys(MESSAGES.en || {});
  var out = [];
  for (var i = 0; i < keys.length; i++) {
    var v = table[keys[i]];
    if (!v || !String(v).trim()) out.push(keys[i]);
  }
  return out;
};

/* =========================================================
   6. 定义期自检
   ========================================================= */
I18n.audit = function () {
  var problems = [];
  var seen: Record<string, boolean> = Object.create(null);
  var i, j;
  var def = 0;

  for (i = 0; i < LOCALES.length; i++) {
    var l = LOCALES[i];
    if (!l.id) problems.push('第 ' + i + ' 种语言没有 id');
    if (seen[l.id]) problems.push('语言 id 重复：' + l.id);
    seen[l.id] = true;
    if (!l.name) problems.push(l.id + ' 没有母语名（语言名必须用它的母语写）');
    if (l.dir !== 'ltr' && l.dir !== 'rtl') problems.push(l.id + ' 的 dir 只能是 ltr / rtl');
    if (l.default) def++;
  }
  if (def !== 1) problems.push('必须有且只有一个默认语言（现在 ' + def + ' 个）');
  if (!localeOf(I18n.DEFAULT)) problems.push('默认语言 ' + I18n.DEFAULT + ' 不在清单里');

  /* 每种语言的表：不能有空白译文（空白 = 缺，但在表里"看起来有了"） */
  for (var id in MESSAGES) {
    if (!localeOf(id)) { problems.push('有一张语言的表但清单里没有它：' + id); continue; }
    var table = MESSAGES[id];
    for (var k in table) {
      if (!Object.prototype.hasOwnProperty.call(table, k)) continue;
      if (!String(table[k]).trim()) problems.push(id + ' 的「' + k + '」是空白译文 —— 空白比缺键更坏（看着像翻过了）');
      /* 译文与原文一模一样：不一定是错（专有名词就该一样），但值得数出来 */
      if (table[k] === k) problems.push(id + ' 的「' + k + '」译文与原文相同（要么是专有名词，要么忘了翻）');
    }
  }
  /* 默认语言的表**不该存在**：键就是原文（存在就等于有两份真相） */
  if (MESSAGES[I18n.DEFAULT]) problems.push('默认语言不该有表（键就是原文），但它有一张');

  return { ok: problems.length === 0, problems: problems, counts: { locales: LOCALES.length, keys: Object.keys(MESSAGES.en || {}).length } };
};

if (!I18n.audit().ok) throw new Error('i18n 自检失败：\n' + I18n.audit().problems.join('\n'));
SelfCheck.register('I18n', I18n.audit);

/* =========================================================
   7. 登记进扩展点总账
   ========================================================= */
Registry.family('locale', {
  note: '语言（加一种 = 加一行 + 一份译文；语言名永远用它的母语写）', owner: 'i18n.ts',
  /* ⚠ **不能写 `refs` 指回自己**：总账的跨表引用检查要求"引用落在**别的**家族里"，
     而"哪一种语言是默认语言"是这张表**自己**的性质，不是跨表引用 ——
     第一版写成 `refs: [{field:'default', family:'locale'}]`，
     审计立刻报 `locale.zh.default=yes` 越界。这里改成 values 就够了。 */
  values: function () { return LOCALES.map(function (l) { return l.id + (l.default ? '(default)' : ''); }); }
});
Registry.family('messageKey', {
  note: '文案键（= 中文原文；界面漏翻由 `tools/extract-ui-text.mjs --check` 查）', owner: 'i18n.ts',
  values: function () { return Object.keys(MESSAGES.en || {}); }
});

export { I18n };
