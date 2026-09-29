/* =========================================================
ui.ts — 覆盖层界面（标题 / 角色 / 商店 / 升级 / 暂停 / 结算 / HUD）
========================================================= */

import { Art } from './art_spec.ts';
import { Sfx } from './audio.ts';
import { Affixes } from './affixes.ts';
import { Chars } from './data_chars.ts';
import { Elems } from './data_elems.ts';
import { Camp } from './camp.ts';
import { Boons } from './boons.ts';
import { Challenges } from './challenges.ts';
import { Daily } from './daily.ts';
import { Danger } from './danger.ts';
import { Dungeon } from './dungeon.ts';
import { Items } from './data_items.ts';
import { Tiers } from './data_tiers.ts';
import { Weapons } from './data_weapons.ts';
import { Enemies } from './enemies.ts';
import { Forge } from './forge.ts';
import { Game } from './game.ts';
import { Input } from './input.ts';
import { Offline } from './offline.ts';
import { Season } from './season.ts';
import { Stronghold as Keep } from './stronghold.ts';
import { Profile } from './profile.ts';
import { R } from './render.ts';
import { Save } from './save.ts';
import { Diag } from './diag.ts';
import { Scene } from './scene.ts';
import { Settings } from './settings.ts';
import { I18n } from './i18n.ts';
import { Slots } from './slots.ts';
import { Storage } from './storage.ts';
import { Tutorial } from './tutorial.ts';
import { S } from './sprites.ts';
import { Stats } from './stats.ts';
import { Story } from './story.ts';
import { Synergy } from './synergy.ts';
import { Talent } from './talents.ts';
import { Perf, U } from './utils.ts';

var UI = ({
  selectedChar: 'ranger',
  selectedDanger: 0,
  talentChar: 'ranger',
  shopSelection: -1,
  // 参考段落默认折叠（见 renderShop：「我的武器」那一块才是操作面）
  showSyn: false,
  showSet: false,
  // 工坊的配方页签（武器 / 道具）
  craftTab: 'weapon'
} as unknown as UIApi);

var el: Record<string, HTMLElement> = {};

/* 覆盖层节点（`scr-<名字>`）：单独一本账，因为值是 `HTMLElement | null` 而不是 HTMLElement */
var screenEls: Record<string, HTMLElement | null> = {};

/* HUD 的两本账**刻意不放在 el 里**（以前是 el._hudEl / el._hud）：
   el 是"id → 节点"的一本账，而这两本是"字段名 → 节点"和"字段名 → 上次写的值"。
   混在一个 `Record<string, any>` 里，两件事都失去了类型（架构体检里 ui.ts 的 any 就是它）。 */
var hudNodes: Record<string, HTMLElement> = {};
var hudVals: Record<string, unknown> = {};

var inited = false;      // init 幂等：避免重复订阅导致事件翻倍

function q(id) { return document.getElementById(id); }

/**
 * 把标题字画到 `#title-logo` 那块画布上（宣传美术那一类，见 `sprites.ts` 的 `EMBLEMS`）。
 *
 * 画布属性尺寸 = 逻辑尺寸 × 设备倍率：与角色卡肖像同一条规矩 ——
 * 1× 画布被 CSS 放大到设备像素会让 3px 描边变成 2px 的胖台阶。
 * 无 DOM / 无画布时静默返回（无头测试就是这么跑的）。
 */
function paintTitleLogo() {
  var node = el.titleLogo as HTMLCanvasElement | null;
  if (!node || typeof node.getContext !== 'function') return false;
  var em = S.EMBLEM_BY_ID ? S.EMBLEM_BY_ID['title'] : null;
  if (!em) return false;
  var x = node.getContext('2d');
  if (!x) return false;
  var scale = Math.max(1, S.scale ? S.scale() : 1);
  node.width = Math.ceil(em.w * scale);
  node.height = Math.ceil(em.h * scale);
  /* CSS 尺寸**行内**设，不靠样式表：界面层画到 DOM 画布上的每一张
     （角色肖像 / 图标 / HUD 武器槽 / 这张标题）都走同一条规矩 ——
     属性尺寸 = 逻辑 × 倍率、CSS 尺寸 = 逻辑。只写属性会让 2× 屏上的
     3px 描边变成胖像素；而"靠样式表给 CSS 宽度"会在换布局时被漏掉
     （`test/ui-check.mjs` 会核对每一张 DOM 画布的这两个数）。 */
  if (node.style) { node.style.width = em.w + 'px'; node.style.height = em.h + 'px'; }
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.clearRect(0, 0, node.width, node.height);
  S.drawEmblem(x, em, scale);
  return true;
}

/* =========================================================
   初始化
   ========================================================= */
UI.init = function () {
  if (inited) return;          // 重复 init 不再重复订阅（否则事件会翻倍触发）
  inited = true;
  U.injectBaseCSS();

  // 覆盖层元素引用由场景表推导（状态 → 覆盖层 → 元素 id `scr-<overlay>`）。
  // 以前这里是手写的 7 条映射，加上 UI.show 里两组硬编码的可见性规则，
  // 加一个场景要同时改三处；现在这三件事都只在 scene.ts 里声明一次。
  Scene.overlayNames().forEach(function (name) {
    screenEls[name] = q('scr-' + name);
  });
  el.hud = q('hud');
  el.charGrid = q('char-grid');
  el.charDetail = q('char-detail');
  el.shopWeapons = q('shop-weapons');
  el.shopItems = q('shop-items');
  el.shopMats = q('shop-mats');
  el.shopWave = q('shop-wave');
  el.rerollCost = q('reroll-cost');
  el.packBasicCost = q('pack-basic-cost');
  el.packDeluxeCost = q('pack-deluxe-cost');
  el.packBuildCost = q('pack-build-cost');
  el.btnPackBuild = q('btn-pack-build');
  el.packOdds = q('pack-odds');
  el.btnPackBasic = q('btn-pack-basic');
  el.btnPackDeluxe = q('btn-pack-deluxe');
  el.levelCards = q('levelup-cards');
  el.endTitle = q('end-title');
  el.endBody = q('end-body');
  el.toastWrap = q('toast-wrap');
  el.diag = q('diag');
  el.diagBody = q('diag-body');
  el.weaponStrip = q('weapon-strip');
  el.pauseStats = q('pause-stats');
  el.recordsBody = q('records-body');
  el.dangerRow = q('danger-row');
  el.dangerInfo = q('danger-info');
  el.codexSummary = q('codex-summary');
  el.codexChallenges = q('codex-challenges');
  el.codexCatalog = q('codex-catalog');
  el.talentChar = q('talent-char');
  el.talentPoints = q('talent-points');
  el.talentHead = q('talent-head');
  el.talentList = q('talent-list');
  el.campHead = q('camp-head');
  el.campList = q('camp-list');
  el.campCraft = q('camp-craft');
  el.keepHead = q('keep-head');
  el.keepList = q('keep-list');
  el.forgeHead = q('forge-head');
  el.forgeList = q('forge-list');
  el.minimap = q('minimap');
  el.mmFloor = q('mm-floor');
  el.mmTheme = q('mm-theme');
  el.mmGrid = q('mm-grid');
  el.mmHint = q('mm-hint');
  el.bossBar = q('boss-bar');
  el.bossName = q('boss-name');
  el.bossFill = q('boss-fill');
  el.bossHp = q('boss-hp');
  el.hubStatus = q('hub-status');
  el.hubStations = q('hub-stations');
  el.hubTalk = q('hub-talk');
  el.hubNews = q('hub-news');
  el.toastWrap = q('toast-wrap');
  el.codexStory = q('codex-story');
  el.codexTabs = q('codex-tabs');
  el.shopBoons = q('shop-boons');
  el.shopDoors = q('shop-doors');
  el.campDoors = q('camp-doors');
  el.titleLogo = q('title-logo');

  /* 标题是**画出来的**（`sprites.ts` 的 promo 那一类），所以在 init 时烘一次塞进画布。
     为什么不用 CSS 文字：标题要锁死字形间距与 3px 描边 + 4px 硬边投影，
     而 `fillText`/CSS 的排版受字体与平台影响 —— 同一个标题在三台机器上宽度不同。
     无 DOM 环境（无头测试）下 `S.emblemSprite` 返回 null，这里静默跳过。 */
  paintTitleLogo();

  // HUD 元素引用 + 上一次写入的值（用于跳过无变化的 DOM 写入）
  // 注意：元素表与值缓存必须是两个对象，混用会让元素引用被值覆盖
  hudNodes.hpFill = q('hp-fill');
  hudNodes.hpText = q('hp-text');
  hudNodes.wave = q('hud-wave');
  hudNodes.timer = q('hud-timer');
  hudNodes.level = q('hud-level');
  hudNodes.xp = q('hud-xp');
  hudNodes.xpFill = q('xp-fill');
  hudNodes.mats = q('hud-mats');
  hudNodes.kills = q('hud-kills');
  hudNodes.speed = q('hud-speed');
  hudNodes.fps = q('hud-fps');
  hudNodes.room = q('hud-room');
  hudNodes.floor = q('hud-floor');
  buildCharSelect();
  wireActions();
  wireEvents();
  renderSettings();
  refreshContinueButton();

  UI.show('title');
};

/* =========================================================
   屏幕切换
   状态 → 屏幕的映射必须是**全的**（以前 refresh 用 else 兜底成 playing，
   于是 howto 状态下刷新界面会把帮助浮层换成游戏界面，而游戏并没有恢复）。
   ========================================================= */
/* 覆盖层 / HUD / 武器条的可见性全部来自场景表（scene.ts）：
   以前 SCREEN_FOR 一张表 + UI.show 里两组硬编码规则，三处各说各话。
   入参是**状态名**，覆盖层名字由场景表给（两者不总相同：paused → pause）。 */
UI.show = function (name) {
  var d = Scene.has(name) ? Scene.of(name) : null;
  var want = d ? d.overlay : null;
  var keys = Object.keys(screenEls);
  for (var i = 0; i < keys.length; i++) {
    var s = screenEls[keys[i]];
    if (s) s.classList.toggle('active', keys[i] === want);
  }
  el.hud.classList.toggle('hidden', !(d && d.hud));
  if (el.weaponStrip) el.weaponStrip.classList.toggle('hidden', !(d && d.strip));
  /* toast 的位置跟着"底部有没有武器条"走：局内抬到条之上，局外贴底。
     量过：不抬会压住武器条 26px，抬了会压住"再来一局"那排 30px —— 两种都得躲。 */
  if (el.toastWrap) el.toastWrap.classList.toggle('lifted', !!(d && d.strip));
};

/* 哪些界面"有内容要重画"由 scene.ts 声明（`Scene.refreshOf(state)` 给出一个**名字**），
   本模块只负责把那个名字接到一个渲染函数上 —— 所以这里是一张表，不是一条 if-else 链。
   两张表必须对得上：scene.ts 给出了名字却没有渲染函数 = 那一屏永远停在旧内容上。
   （`ui-check` 会对着全部状态逐个验，写法见 test/ui-check.mjs 的 [3b]） */
var RENDERERS: Record<string, () => void> = {
  /* 标题页没有"内容"要拼，但有两块**从存档/档案读出来的状态**：续玩按钮与枢纽角标。
     它们以前只在 init / runStart / runResumed / 某几个动作里更新，
     于是"放弃本局 → 回标题"这条路上按钮停在旧值。挂进这张表就自动被 stateChange 覆盖。 */
  title: function () { refreshContinueButton(); },
  shop: function () { renderShop(); },
  cards: function () { renderLevelCards(); },
  settings: function () { renderSettings(); },
  records: function () { renderRecords(); },
  codex: function () { renderCodex(); },
  talents: function () { renderTalents(); },
  camp: function () { renderCamp(); },
  keep: function () { renderKeep(); },
  hub: function () { renderHub(); },
  pause: function () { UI.renderPause(); }
};
/** 已注册的重画名（契约测试用它对着 scene.ts 的 REFRESH 比一遍） */
UI.renderNames = function () { return Object.keys(RENDERERS); };

UI.refresh = function () {
  focusSet(null);          // 界面重画了，旧的焦点元素已经不在文档里
  UI.show(Game.state);
  // 有内容的界面在刷新时要一并重画（名字来自场景表，函数来自 RENDERERS）
  var what = Scene.refreshOf(Game.state);
  var fn = what ? RENDERERS[what] : null;
  if (fn) fn();
};

/* =========================================================
   菜单焦点：一套通用的"方向键选、回车按"
   改造前只有升级卡认 1-4 号键，商店与菜单完全没有键盘/手柄操作 ——
   "手柄能移动、能暂停，却选不了升级卡"，等于半个手柄。
   这里不按界面写分支，而是在**当前覆盖层里找可聚焦元素**，
   于是升级卡 / 商店卡 / 角色卡 / 所有按钮一次性都有了两套输入。
   ========================================================= */
var FOCUS_SEL = '.card, .btn, .char-card';
var _focusEl: HTMLElement | null = null;

function focusables(): HTMLElement[] {
  var d = Scene.has(Game.state) ? Scene.of(Game.state) : null;
  var ov = d && d.overlay;
  var root = ov ? q('scr-' + ov) : null;
  if (!root || !root.querySelectorAll) return [];
  var list = root.querySelectorAll(FOCUS_SEL);
  var out: HTMLElement[] = [];
  for (var i = 0; i < list.length; i++) {
    var e = list[i] as HTMLElement;
    if (e.hidden || (e as HTMLButtonElement).disabled) continue;
    if (e.classList && (e.classList.contains('sold') || e.classList.contains('empty'))) continue;
    // 重画后残留的旧节点：不是当前界面的孩子就跳过
    if (root.contains && !root.contains(e)) continue;
    out.push(e);
  }
  return out;
}

function focusSet(e: HTMLElement | null) {
  if (_focusEl && _focusEl.classList) _focusEl.classList.remove('focused');
  _focusEl = e || null;
  if (_focusEl && _focusEl.classList) _focusEl.classList.add('focused');
  if (_focusEl && _focusEl.scrollIntoView) {
    try { _focusEl.scrollIntoView({ block: 'nearest' }); } catch (err) { /* 无布局时忽略 */ }
  }
}

/** 按 DOM 顺序移动焦点（右/下 = 下一个，左/上 = 上一个，到头发绕）。
    不做几何寻路：这几个界面的元素都是单行/单列的，顺序就够，而且无头环境没有布局。 */
function focusMove(dx, dy) {
  var list = focusables();
  if (!list.length) return false;
  var dir = (dx > 0 || dy > 0) ? 1 : -1;
  var i = _focusEl ? list.indexOf(_focusEl) : -1;
  var n = i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
  focusSet(list[n]);
  return true;
}

UI.focusMove = focusMove;
UI.focusClear = function () { focusSet(null); };
UI.hasFocus = function () { return !!_focusEl; };
UI.focusText = function () {
  if (!_focusEl) return '';
  return String(_focusEl.textContent || '').trim().slice(0, 24);
};
/** 激活焦点元素 —— 走 .click()，于是"键盘/手柄操作"和"鼠标点击"是同一条代码路径 */
UI.activateFocus = function () {
  if (!_focusEl || !_focusEl.click) return false;
  try { _focusEl.click(); return true; } catch (e) { return false; }
};

/* =========================================================
   角色选择
   ========================================================= */
function buildCharSelect() {
  U.clear(el.charGrid);
  Chars.LIST.forEach(function (c) {
    if (!isCharListed(c)) return;        // 隐藏角色：没解锁就连卡都不出现
    var available = isCharAvailable(c);
    var card = U.el('div', 'char-card' + (available ? '' : ' locked'));
    card.dataset.char = c.id;
    if (!available) card.title = '未解锁：' + charUnlockHint(c.id);
    var size = 74;
    // 用 S.domCanvas 而不是裸 createElement：属性尺寸按设备像素比放大、
    // CSS 尺寸写死逻辑像素，2× 屏上肖像才是清楚的（styles.css 里
    // image-rendering:pixelated 会把裸画布用最近邻放大成"胖像素"）。
    var cc = S.domCanvas(size + 8, size + 8);
    var cv = cc ? cc.canvas : document.createElement('canvas');
    var cx = cc ? cc.ctx : cv.getContext('2d');
    card.appendChild(cv);
    card.appendChild(U.el('div', 'cn', c.name));
    card.appendChild(U.el('div', 'ce', c.en));
    card.addEventListener('click', function () {
      UI.selectedChar = c.id;
      refreshCharSelection();
      if (Sfx) Sfx.click();
    });
    el.charGrid.appendChild(card);
    // 先绑定事件再贴图：即便某个角色的小图绘制失败，按钮依然可用
    var port = S.bronanaPortrait(size, c);
    if (port) cx.drawImage(port.canvas, 0, 0, port.width, port.height);   // 按逻辑尺寸贴
  });
  refreshCharSelection();
}

/* =========================================================
   图鉴与挑战（账号档案的可见面）
   没有这一屏，profile.ts 里那些东西玩家一辈子看不到。
   ========================================================= */
function setRow(k, v) {
  return '<div class="set-row"><span class="set-label">' + k + '</span>' +
    '<span class="set-value">' + v + '</span></div>';
}

/** 图鉴进度一行。怪物只有"见过"（出场即记录），所以不吹成三态 */
function codexLine(family) {
  var st = Profile.codexStats(family);
  if (family === 'enemy') return st.seen + ' / ' + st.total + ' 见过（出场即记录）';
  return '见过 ' + st.seen + ' · 用过 ' + st.used + ' · 满级过 ' + st.mastered + ' / ' + st.total;
}

/* =========================================================
   图鉴的标签页
   ---------------------------------------------------------
   五块内容（概览 / 挑战 / 图鉴 / 剧情 / 今日本周）是五种**不同的东西**，
   叠在一屏里谁也看不完：每块都长，flex 只能把它们一起压扁
   （实测：三张长列表被压到 28px 高，只剩下一条缝）。
   所以一次只显示一页 —— 选中的那一页吃掉整块高度，自己滚。
   ========================================================= */
var _codexTab = '';        // 当前那一页（界面状态，不进档案）

var CODEX_TABS = [
  { id: 'challenges', name: '挑 战', panel: 'codex-challenges' },
  { id: 'catalog', name: '图 鉴', panel: 'codex-catalog' },
  { id: 'story', name: '剧 情', panel: 'codex-story' },
  { id: 'daily', name: '今日 · 本周', panel: 'codex-daily' },
  { id: 'summary', name: '概 览', panel: 'codex-summary' }
];

/** 当前该显示哪一页（默认挑战：这一屏叫"图鉴**与挑战**"，进来看的多半是它） */
function codexTab() {
  for (var i = 0; i < CODEX_TABS.length; i++) if (CODEX_TABS[i].id === _codexTab) return _codexTab;
  return CODEX_TABS[0].id;
}

/** 画标签条，并把没选中的那几页藏起来（只留下当前这一页去吃掉高度） */
function renderCodexTabs() {
  if (el.codexTabs) {
    U.clear(el.codexTabs);
    var cur = codexTab();
    CODEX_TABS.forEach(function (t) {
      var b = U.el('button', 'btn tiny' + (t.id === cur ? ' sel' : ''), t.name);
      b.dataset.act = 'codex-tab';
      b.dataset.tab = t.id;
      el.codexTabs.appendChild(b);
    });
  }
  CODEX_TABS.forEach(function (t) {
    var p = q(t.panel);
    if (p) p.hidden = (t.id !== codexTab());
  });
}

function renderCodex() {
  if (!el.codexSummary) return;
  var snap = Profile.snapshot();
  var ctx = Challenges.context(null, Save.records(), snap.perChar);
  var doneMap: Record<string, boolean> = Object.create(null);
  for (var i = 0; i < snap.done.length; i++) doneMap[snap.done[i]] = true;

  var unlockedChars = 0;
  for (i = 0; i < Chars.LIST.length; i++) if (isCharAvailable(Chars.LIST[i])) unlockedChars++;

  var s = setRow('孢子', Profile.spores());
  s += setRow('挑战完成', snap.done.length + ' / ' + Challenges.LIST.length);
  s += setRow('角色解锁', unlockedChars + ' / ' + Chars.LIST.length);
  s += setRow('解锁的武器 / 道具', Profile.unlockedIds('weapon').length + ' / ' + Profile.unlockedIds('item').length);
  el.codexSummary.innerHTML = s;

  // 挑战：完成的打勾；累计类给出进度；单局达成的不画进度条
  // （局外它的读数永远是 0，画一条空进度条等于撒谎）
  // **隐藏挑战没完成前不列出来** —— 图鉴里突然多一条，本身就是一个"你发现了什么"的信号
  var html = '';
  var lastGroup = '';
  var list = Challenges.visible(function (id) { return doneMap[id] === true; });
  for (i = 0; i < list.length; i++) {
    var def = list[i];
    var done = doneMap[def.id] === true;
    var val;
    if (done) val = '✓ 已完成';
    else if (Challenges.progressKind(def) === 'run') val = '单局达成';
    else val = Math.min(Challenges.valueOf(def, ctx), def.atLeast) + ' / ' + def.atLeast;
    // 分组头：以前每一行都自带"· 进程 ·"这样的前缀，十几行读下来全是噪声
    if (def.group !== lastGroup) {
      html += '<div class="codex-group">' + def.group + '</div>';
      lastGroup = def.group;
    }
    html += '<div class="set-row"><span class="set-label">' +
      (done ? '✓ ' : '· ') + def.desc + '</span>' +
      '<span class="set-value">' + val + '</span></div>';
  }
  el.codexChallenges.innerHTML = html;

  var cat = setRow('武器图鉴', codexLine('weapon'));
  cat += setRow('道具图鉴', codexLine('item'));
  cat += setRow('怪物图鉴', codexLine('enemy'));
  el.codexCatalog.innerHTML = cat;

  renderStoryBlock();

  // 每日挑战：今天的规则 + 本地最好 + 最近一局的成绩码
  renderDailyBlock();

  renderCodexTabs();
}

/* =========================================================
   枢纽（N2：局与局之间的"家"）
   ---------------------------------------------------------
   为什么把它做成一个**屏幕**而不是一段弹窗：这一层要回答的是
   "我为什么又回来了" —— Hades 那套"死亡也推进剧情"必须有个**地方**发生。

   而"一个地方"在界面上有三个硬要求（缺一条就退化成设置页）：
     ① 要有**位置感**：站点是屋里的东西（站点头像 + 站名 + 职能），不是列表行
     ② 要有**状态**：这一趟回来我攒下了什么（状态带，一横条，不折行）
     ③ 要有**人**：对话框是"头像 + 名牌 + 当前这一句"，说完一句才出下一句

   两条纪律照旧：
     · 台词、条件、谁该出现、屋里有什么全在 `story.ts`（纯表 + 纯函数），这里只负责画
     · **说过的台词不再出现**（`Profile.say` 记账）：所以这一屏不是"越堆越长"，
       而是"每次回来头几个人有新东西说"
   ========================================================= */
var _hubNpc = '';          // 当前选中的 NPC（界面状态，不进档案）

/** 状态带：先回答"我在局外攒了什么"（一横条，每项 nowrap，永不折字） */
function hubStatusHtml() {
  var s = Profile.storySnapshot();
  var freePoints = 0;
  var chars = 0;
  Chars.LIST.forEach(function (c) {
    if (!isCharListed(c)) return;
    chars++;
    freePoints += Profile.talentFree(c.id);
  });
  var rows: { k: string; v: string; warn?: boolean }[] = [
    { k: '材料', v: Profile.material() + '（据点用）' },
    { k: '合金', v: Profile.alloy() + '（图纸工坊用：只由合成产出）' },
    { k: '记录碎片', v: s.fragments + ' / ' + Story.FRAGMENTS.length },
    { k: '打倒过的器官', v: s.bosses + ' / ' + Enemies.BOSSES.length },
    { k: '发现过的密室', v: String(s.secrets) },
    { k: '走过的局数', v: s.runs + ' 局 · 通关 ' + s.wins + ' 次 · 最深第 ' + s.bestFloor + ' 层' },
    { k: '角色', v: chars + ' 个可用' }
  ];
  /* 这里只留"现在该去哪儿"这一类**可行动**的提醒（账目归账目）。
     "有人想说新话"不在这条线上：站点卡上的角标已经在说同一件事，
     重复一遍只会把状态带挤成两行 —— 而它在一屏宽里必须是一行。 */
  if (freePoints > 0) rows.push({ k: '天赋点', v: freePoints + ' 点没用（去镜面）', warn: true });
  var html = '';
  rows.forEach(function (r) {
    html += '<span class="hs-item' + (r.warn ? ' warn' : '') + '"><b>' + r.k + '</b> ' + r.v + '</span>';
  });
  return html;
}

/** 一个站点的头像画布（站点 id 就是画法 id，见 sprites.stationPortrait） */
function stationCanvas(id, size, cls) {
  // 与角色卡同一条路：属性尺寸按设备像素比放大，CSS 尺寸写死逻辑像素
  var cc = S.domCanvas(size + 8, size + 8);
  var cv = cc ? cc.canvas : document.createElement('canvas');
  var cx = cc ? cc.ctx : cv.getContext('2d');
  if (cls) cv.className = cls;
  var port = S.stationPortrait(id, size);
  if (port) cx.drawImage(port.canvas, 0, 0, port.width, port.height);
  return cv;
}

function renderHub() {
  if (!el.hubStations) return;
  var stations = Profile.stationsFor();
  var news = Profile.newsByNpc();

  // 选中的 NPC 必须还在屋里（解锁表是活的：换档、洗档都会变）
  var still: StoryStationDef | null = null;
  for (var i = 0; i < stations.length; i++) if (stations[i].npc === _hubNpc) still = stations[i];
  if (!still) {
    _hubNpc = '';
    // 默认停在第一个**有人**的站点上：进屋第一眼就该有人跟你说话
    for (var q = 0; q < stations.length; q++) if (stations[q].npc) { _hubNpc = stations[q].npc; break; }
  }

  if (el.hubStatus) el.hubStatus.innerHTML = hubStatusHtml();

  U.clear(el.hubStations);
  stations.forEach(function (st) {
    var b = U.el('button', 'btn station' + (st.npc && st.npc === _hubNpc ? ' sel' : ''));
    b.dataset.act = 'hub-station';
    b.dataset.station = st.id;
    if (st.npc) b.dataset.npc = st.npc;
    if (st.screen) b.dataset.screen = st.screen;
    b.title = st.name + '：' + st.role;
    b.appendChild(stationCanvas(st.id, 68, 'st-cv'));
    b.appendChild(U.el('div', 'st-nm', st.name));
    b.appendChild(U.el('div', 'st-role', st.role));
    var n2 = news[st.npc || ''] || 0;
    if (n2 > 0) b.appendChild(U.el('span', 'st-news', String(n2)));
    el.hubStations.appendChild(b);
  });

  /* 对话框：只画**当前这一句**。
     一次把七八句话倒出来等于什么都没说；"说一句 → 重画 → 下一句顶上来"
     才是 Hades 那种"跟人聊天"的节奏。没新话时说一句"他没别的说了"，
     而不是留一片空白（空白会让人以为界面坏了）。 */
  if (el.hubTalk) {
    var npcSt = null;
    for (var j = 0; j < stations.length; j++) if (stations[j].npc === _hubNpc) npcSt = stations[j];
    U.clear(el.hubTalk);
    el.hubTalk.hidden = !npcSt;
    if (npcSt) {
      el.hubTalk.appendChild(stationCanvas(npcSt.id, 64, 'tx-cv'));
      var body = U.el('div', 'tx-body');
      var who = U.el('div', 'tx-name', npcSt.name);
      who.appendChild(U.el('span', 'tx-role', npcSt.role));
      body.appendChild(who);
      var lines = Profile.linesFor(npcSt.npc);
      if (lines.length) {
        body.appendChild(U.el('div', 'tx-line', lines[0].text));
        // 整块可点（鼠标）+ 一个小按钮（键盘/手柄）：两种输入都往前走一句
        var more = lines.length - 1;
        var nx = U.el('button', 'btn tiny tx-next',
          '▽ 继续说' + (more > 0 ? '（还有 ' + more + ' 句）' : '（最后一句）'));
        nx.dataset.act = 'hub-say';
        body.appendChild(nx);
      } else {
        body.appendChild(U.el('div', 'tx-quiet', '……他没别的要说了。下次回来再看。'));
      }
      el.hubTalk.appendChild(body);
    }
  }

  // 标题页那个"!"：有任何人想说新话就亮
  if (el.hubNews) el.hubNews.hidden = !Profile.hasStoryNews();
}

/** 让当前选中的 NPC 说一句（说过的不再出现）—— 由"说下去"按钮调用 */
function hubSay() {
  var lines = Profile.linesFor(_hubNpc);
  if (!lines.length) return false;
  Profile.say(lines[0].id);
  // 说完立刻重画：下一句顶上来，这就是"一句话一句话地聊"
  renderHub();
  refreshContinueButton();
  return true;
}

/**
 * 图鉴里的剧情一栏（N2）。
 * 两条纪律：
 *   · **没找到的碎片只说"第几片"** —— 标题与正文都不显示（收藏品不该被剧透）
 *   · **隐藏结局连名字都不显示**（显示"？？？"），这是"藏起来的那一层"
 */
function renderStoryBlock() {
  if (!el.codexStory) return;
  var snap = Profile.storySnapshot();
  var html = '';
  html += setRow('记录碎片', snap.fragments + ' / ' + Story.FRAGMENTS.length +
    (snap.fragments >= Story.FRAGMENTS.length ? '（齐了）' : ''));
  for (var i = 0; i < Story.FRAGMENTS.length; i++) {
    var f = Story.FRAGMENTS[i];
    var got = Profile.hasFragment(f.id);
    html += '<div class="set-row"><span class="set-label">' +
      (got ? '✓ ' + f.title + '：' + f.text : '· 第 ' + (i + 1) + ' 片（还没找到）') +
      '</span><span class="set-value">' + (got ? f.from : '') + '</span></div>';
  }
  var endings = Profile.endingsSeen();
  html += setRow('结局', endings.length + ' / ' + Story.ENDINGS.length);
  var have: Record<string, boolean> = Object.create(null);
  for (i = 0; i < endings.length; i++) have[endings[i].id] = true;
  for (i = 0; i < Story.ENDINGS.length; i++) {
    var e = Story.ENDINGS[i];
    var seen = have[e.id] === true;
    // 没解锁的：隐藏结局连名字都不给，其它结局给名字（让玩家知道"还有别的走法"）
    var label = seen ? '✓ ' + e.name + '：' + e.text
      : (e.secret ? '· ？？？' : '· ' + e.name + '（还没走到）');
    html += '<div class="set-row"><span class="set-label">' + label + '</span></div>';
  }
  var evs = Profile.eventsSeen();
  if (Game.ROOM_EVENTS.length) {
    var names = [];
    for (i = 0; i < Game.ROOM_EVENTS.length; i++) {
      names.push((evs.indexOf(Game.ROOM_EVENTS[i].id) >= 0 ? '✓ ' : '· ') + Game.ROOM_EVENTS[i].name);
    }
    html += setRow('遇到过的遭遇', names.join(' · '));
  }
  el.codexStory.innerHTML = html;
}

/* =========================================================
   据点（跨局经营，花材料）
   ---------------------------------------------------------
   与营地屏同构：一行一个设施，显示当前等级、下一级给什么、买不买得起。
   区别是它花**材料**（跨局钱包），而营地花**废料**（本局清零）。
   ========================================================= */
function renderKeep() {
  if (!el.keepList) return;
  var owned = Profile.keepOwned();
  var spores = Profile.spores();
  var core = Profile.core();

  var head = setRow('材料', String(Profile.material()));
  /* 核心材料单列一行：它是**唯一**一种"只有关底 Boss 掉"的资源，
     玩家看到这一行才知道"那 2 个数字要去哪挣"（而不是以为它又是孢子）。 */
  head += setRow('核心材料', String(core) + '（只有关底 Boss 掉）');
  head += setRow('已投入', Profile.keepInvested() + ' 材料（永久，不退还）');
  // **文案不在这里写** —— 键自己带文案（stronghold.ts 的 MOD_KEYS），
  // 界面只负责把折叠出来的修正翻成人话。新增一个键不需要动这个文件。
  var eff = Keep.effectLines(Profile.keepMods());
  head += setRow('当前效果', eff.length ? eff.join(' · ') : '（无）');
  head += setRow('两条循环', '据点解锁能力（产线 / 目录 / 离线）→ 出击收集、工坊制造 → 打得更深 → 更多孢子 → 据点更强');
  head += setRow('前置链', '有些设施要先有别的（例如档案馆要钟楼）—— 【顺序本身也是决策】');
  el.keepHead.innerHTML = head;

  var html = '';
  Keep.LIST.forEach(function (d) {
    var lvl = Keep.levelOf(owned, d.id);
    var chk = Keep.canBuy(owned, d.id, spores, core);
    var nextTxt;
    if (lvl >= d.levels.length) nextTxt = '已满级';
    else {
      // 同样：文案从键自己的声明里取（ui 不再列键名）
      var e = d.levels[lvl].effect;
      var parts = [];
      for (var ek in e) {
        if (!Object.prototype.hasOwnProperty.call(e, ek)) continue;
        parts.push.apply(parts, Keep.effectText(ek, e[ek]));
      }
      /* 要核心材料的那一级必须**在按钮之前**说出来：
         否则玩家攒够孢子、点下去、才知道要打过 Boss —— 那是最差的一种顺序。 */
      var needCore = Keep.coreFor(owned, d.id);
      nextTxt = '下一级：' + parts.join('、') +
        (needCore > 0 ? '　【另需核心材料 ' + needCore + '】' : '');
    }
    var btn;
    if (chk.ok) {
      btn = '<button class="btn tiny" data-act="keep-buy" data-keep="' + d.id + '">' +
        (lvl ? '升级 ' : '建造 ') + chk.cost + '</button>';
    } else if (chk.locked) {
      // 锁着（前置没满足）与"资源不够"是两种完全不同的等待，界面必须分开说
      btn = '<button class="btn tiny" disabled title="' + chk.reason + '">锁着</button>';
    } else {
      btn = '<button class="btn tiny" disabled title="' + chk.reason + '">' +
        (chk.reason === '已经满级' ? '满级'
          : (chk.core > 0 ? chk.cost + ' 材料 + ' + chk.core + ' 核心' : chk.cost + ' 材料')) + '</button>';
    }
    var reqTxt = d.req
      ? '<br><span class="camp-combo">前置：' + Keep.BY_ID[d.req.id].name + ' Lv.' + d.req.level +
      '（现在 Lv.' + lvl0(d.req.id, owned) + '）</span>'
      : '';
    html += '<div class="set-row"><span class="set-label">' +
      '<b>' + d.name + '</b>' + (lvl ? ' Lv.' + lvl : '') + ' —— ' + d.note + '。' + nextTxt + reqTxt +
      '</span><span class="set-value">' + btn + '</span></div>';
  });
  el.keepList.innerHTML = html;
  renderForge();
}

/* =========================================================
   图纸工坊（局外第三条腿：花合金，只解锁能力）
   ---------------------------------------------------------
   界面只显示与发起：树、前置、成本、文案全在 forge.ts。
   与据点那一块并排（都是"开局前改条件"），但**货币与分区都写明** ——
   两条曲线混在一起看，玩家会以为合金能买据点（那就白设计了）。
   ========================================================= */
function renderForge() {
  if (!el.forgeList) return;
  var alloy = Profile.alloy();
  var owned = Profile.forgeOwned();
  var mods = Profile.forgeMods();
  var head = setRow('合金', String(alloy) + '（只由「回收」产出：拆掉不要的装备 + 每次结算的基础产出）');
  /* 核心材料在两条局外线上是**同一笔**钱（据点与图纸都花它）：
     两处都显示它，玩家才看得出"这两个 2 是同一笔预算"。 */
  head += setRow('核心材料', String(Profile.core()) + '（只有关底 Boss 掉；据点与图纸共用这一笔）');
  head += setRow('已解锁', owned.length + ' / ' + Forge.LIST.length + ' 张（点满全部 ' + Forge.totalCost() + ' 合金）');
  var eff = Forge.effectLines(mods);
  head += setRow('当前效果', eff.length ? eff.join(' · ') : '（无）');
  head += setRow('与据点 / 天赋的分工', '据点（孢子）= 改这一局的规则与容量 · 天赋（点数）= 改开局属性 · 图纸（合金）= 改「能造什么」');
  el.forgeHead.innerHTML = head;

  var html = '';
  Forge.LIST.forEach(function (d) {
    var has = Profile.isForged(d.id);
    var chk = Profile.canForge(d.id);
    var btn;
    if (has) btn = '<button class="btn tiny" disabled>已解锁</button>';
    else if (chk.ok) btn = '<button class="btn tiny" data-act="forge-buy" data-forge="' + d.id + '">解锁 ' + chk.cost + '</button>';
    else if (chk.locked) btn = '<button class="btn tiny" disabled title="' + chk.reason + '">锁着</button>';
    else btn = '<button class="btn tiny" disabled title="' + chk.reason + '">' +
      (chk.core > 0 ? chk.cost + ' 合金 + ' + chk.core + ' 核心' : chk.cost + ' 合金') + '</button>';
    var reqTxt = (d.req && d.req.length)
      ? '<br><span class="camp-combo">前置：' + d.req.map(function (r) {
        return (Forge.BY_ID[r] ? Forge.BY_ID[r].name : r) + (Profile.isForged(r) ? ' ✔' : '');
      }).join('、') + '</span>'
      : '';
    /* 要核心材料的那张图纸要在**点之前**说出来（同据点那一条理由） */
    if (d.core > 0) reqTxt += '<br><span class="camp-combo">另需核心材料 ' + d.core + '（只有关底 Boss 掉）</span>';
    html += '<div class="set-row"><span class="set-label">' +
      '<b>' + d.name + '</b>（' + (Forge.TIER_NAME[d.tier] || ('T' + d.tier)) + '） —— ' + d.note +
      '<br><span class="buff">' + Forge.nodeText(d) + '</span>' + reqTxt +
      '</span><span class="set-value">' + btn + '</span></div>';
  });
  el.forgeList.innerHTML = html;
}

/** 前置显示用的小助手（读当前等级） */
function lvl0(id, owned) { return Keep.levelOf(owned, id); }

/* =========================================================
   局内营地（模拟经营第一级）
   ---------------------------------------------------------
   界面只显示与发起；规则在 camp.ts，收钱与生效在 game.ts。
   要显示的三件事：**还剩几个位子**（瓶颈）、每个设施当前等级与下一级给什么、废料够不够。
   ========================================================= */
/* =========================================================
   局内工坊（制造这根柱子在局内的那一半）
   ---------------------------------------------------------
   界面只显示与发起：设施表 / 配方 / 费用 / 封顶全在 camp.ts 与 craft.ts。
   这一屏要回答三个问题（顺序也是玩家的思考顺序）：
     ① 我有几条产线、这一波还能用几条（每波重置 = 经营自己的回合）
     ② 我能造什么（只列**图纸够档**的；造不了的也列出来并说清为什么）
     ③ 造得起吗、造出来值不值（费用 vs 废料）
   ========================================================= */
var CAMP_RECIPE_PAGE = 24;      // 一屏铺多少条配方（53 条全铺会淹掉设施那一块）

function renderCamp() {
  if (!el.campList) return;
  var sess = Game.getSession();
  /* ⚠ 工坊的四样东西现在都在**档案**里（跨局），不在会话里：
       设施 / 建造顺序 / 材料 / 折叠效果。会话只提供"这一波还空着几条产线"。 */
  var state = Profile.campOwned();
  var row = Profile.campRowClean();
  var opts = Game.campOpts();
  var mats = Math.round(Profile.material());
  var used = Camp.usedSlots(state);
  var fx = Profile.campFx();
  var active = Camp.combosFor(row);
  var lines = Game.craftLines();
  var free = Game.craftFreeLines();

  var head = setRow('材料', String(mats) + '（出击打出来的，**带得出局**；建产线与制造都花这一笔）');
  head += setRow('产线', used + ' / ' + opts.slots + ' 座设施' +
    (Game.forgeMods().lines > 0 ? ' + 图纸 ' + Game.forgeMods().lines + ' 条' : '') +
    ' → 共 ' + lines + ' 条，这一波还空着 ' + free.length + ' 条' +
    (used >= opts.slots ? '（设施位满了 —— 升级已有设施不占新位子，也可以拆掉一个）' : '（还可以盖 ' + (opts.slots - used) + ' 个）'));
  // 建造顺序 = 「谁挨着谁」；相邻组合只看这一行
  var rowTxt = row.length
    ? row.map(function (id, i) {
      var name = Camp.BY_ID[id] ? Camp.BY_ID[id].name : id;
      if (i + 1 >= row.length) return name;
      var k = Camp.comboOf(id, row[i + 1]);
      return name + (k ? ' —〔' + k.name + '〕— ' : ' — ');
    }).join('')
    : '（还没建东西）';
  head += setRow('建造顺序', rowTxt);
  head += setRow('相邻组合', active.length
    ? active.map(function (k) { return k.name + '（' + k.note + '）'; }).join(' · ')
    : '（把有组合的两个设施【挨着建】才能生效：' + Camp.COMBOS.map(function (k) {
      return Camp.BY_ID[k.a].name + '+' + Camp.BY_ID[k.b].name;
    }).join(' / ') + '）');
  var effTxt = Camp.effectLines(fx);
  head += setRow('制造效果', effTxt.length ? effTxt.join(' · ') : '（无）');
  head += setRow('设施是**跨局**的', '盖好就一直有；换一局不用重盖（这也是它和商店最大的区别）');
  head += setRow('和商店的分工', '造 = 便宜但要图纸 + 占一条产线的一波；货架 = 应急成品（贵）与回收（回收产合金）');
  el.campHead.innerHTML = head;
  renderDoors(el.campDoors, sess);   // 工坊也能直接挑门走

  /* ---- 配方：只把**能造**的排前面，造不了的也列出来（否则玩家不知道图纸在干什么）---- */
  drawCraftList(sess, free, mats);

  var html = '';
  /* 费用 / 能不能盖 / 退款**全部来自 `Game.campFacilities()`** ——
     界面不再自己调 `Camp.canBuy` 与 `Camp.refundOf`。
     改造前这里各自调了一遍，而且**没传 opts**（据点给的位子与工匠的全额返还
     在按钮上都没算），于是按钮上的价钱与实际扣的钱可能不一致 ——
     这正是"界面自己算规则"必然掉进去的坑。 */
  var facs = Game.campFacilities();
  facs.forEach(function (f) {
    var d = Camp.BY_ID[f.id];
    if (!d) return;
    var lvl = f.level;
    var chk = { ok: f.ok, reason: f.reason, cost: f.cost };
    var nextTxt;
    if (lvl >= d.levels.length) nextTxt = '已满级';
    else {
      // 文案从键自己的声明里取（ui 不再列键名）
      var e = d.levels[lvl].effect;
      var parts = [];
      for (var ek in e) {
        if (!Object.prototype.hasOwnProperty.call(e, ek)) continue;
        parts.push.apply(parts, Camp.effectText(ek, e[ek]));
      }
      nextTxt = '下一级：' + parts.join('、');
    }
    var btn;
    if (chk.ok) {
      btn = '<button class="btn tiny" data-act="camp-buy" data-camp="' + d.id + '">' +
        (lvl ? '升级 ' : '建造 ') + chk.cost + '</button>';
    } else {
      btn = '<button class="btn tiny" disabled title="' + chk.reason + '">' +
        (chk.reason === '已经满级' ? '满级' : '不可') + '</button>';
    }
    var sell = lvl
      ? ' <button class="btn tiny" data-act="camp-sell" data-camp="' + d.id + '">拆（退 ' + f.refund + '）</button>'
      : '';
    // 这一个设施与"已经建好的邻居"能凑出什么组合 —— 让玩家在按下建造前就看得见
    var comboTxt = Camp.COMBOS.filter(function (k) { return k.a === d.id || k.b === d.id; })
      .map(function (k) {
        var other = k.a === d.id ? k.b : k.a;
        var has = Camp.levelOf(state, other) > 0;
        return (has ? '★ ' : '') + k.name + '（与' + Camp.BY_ID[other].name + '）';
      }).join('、');
    html += '<div class="set-row"><span class="set-label">' +
      '<b>' + d.name + '</b>' + (lvl ? ' Lv.' + lvl : '') + ' —— ' + d.note + '。' + nextTxt +
      '<br><span class="camp-combo">组合：' + comboTxt + '</span>' +
      '</span><span class="set-value">' + btn + sell + '</span></div>';
  });
  el.campList.innerHTML = html;
}

/**
 * 配方列表。**规则一行都不在这里**：`Game.craftOptions()` 已经把
 * "能不能造 / 为什么不能 / 费用多少 / 废料够不够"算好了，界面只翻译成按钮。
 * 分两类（武器 / 道具）展示，因为它决定造出来去哪：武器进武器栏，道具进道具栏。
 */
function drawCraftList(sess, freeLines, mats) {
  if (!el.campCraft) return;
  var opts = Game.craftOptions();
  var tab = UI.craftTab || 'weapon';
  var list = opts.filter(function (o) { return o.kind === tab; });
  var can = list.filter(function (o) { return o.ok; });
  var rest = list.filter(function (o) { return !o.ok; });
  var head = '可造 ' + can.length + ' / ' + list.length + ' 件' +
    (rest.length ? '（另有 ' + rest.length + ' 件要更高的图纸）' : '') +
    ' · 这一波空产线 ' + freeLines.length + ' 条';
  var tabs = '<div class="craft-tabs">' +
    '<button class="btn tiny' + (tab === 'weapon' ? ' on' : '') + '" data-act="craft-tab" data-kind="weapon">武器</button>' +
    '<button class="btn tiny' + (tab === 'item' ? ' on' : '') + '" data-act="craft-tab" data-kind="item">道具</button>' +
    '<span class="craft-note">' + head + '</span></div>';

  var html = tabs;
  var shown = can.concat(rest).slice(0, CAMP_RECIPE_PAGE);
  shown.forEach(function (o) {
    var btn;
    if (!o.ok) {
      btn = '<button class="btn tiny" disabled title="' + o.reason + '">缺图纸</button>';
    } else if (!freeLines.length) {
      btn = '<button class="btn tiny" disabled title="这一波的产线都用完了 —— 打一间房就有新的一波">产线忙</button>';
    } else if (!o.affordable) {
      btn = '<button class="btn tiny" disabled title="废料不够">' + o.cost + ' 废料</button>';
    } else {
      btn = '<button class="btn tiny" data-act="craft" data-line="' + freeLines[0] +
        '" data-recipe="' + o.id + '">造 ' + o.cost + '</button>';
    }
    html += '<div class="set-row' + (o.ok ? '' : ' dim') + '"><span class="set-label">' +
      '<b>' + o.name + '</b> T' + o.tier +
      (o.kind === 'weapon' ? '' : ' · 道具') +
      '</span><span class="set-value">' + btn + '</span></div>';
  });
  if (!shown.length) html += '<div class="set-row"><span class="set-label" style="opacity:.7">（这一类还没有配方）</span></div>';
  el.campCraft.innerHTML = html;
}

/* =========================================================
   天赋（角色养成）
   ---------------------------------------------------------
   界面只负责"显示与发起"，规则全在 talents.ts（纯数据 + 纯函数），
   账目在 profile.ts（点数 / 已点 / 洗点次数）。
   ========================================================= */
function renderTalents() {
  if (!el.talentList) return;
  var charId = UI.talentChar;
  if (!Chars.BY_ID[charId]) { charId = UI.talentChar = Chars.LIST[0].id; }
  var cd = Chars.BY_ID[charId];

  // 角色切换条（隐藏角色同样按"解锁了才出现"处理）
  U.clear(el.talentChar);
  Chars.LIST.forEach(function (c) {
    if (!isCharListed(c)) return;
    var b = U.el('button', 'btn tiny' + (c.id === charId ? ' sel' : ''));
    b.textContent = c.name;
    b.dataset.charPick = c.id;
    b.dataset.act = 'talent-char';
    el.talentChar.appendChild(b);
  });

  var earned = Profile.talentPoints(charId);
  var spent = Profile.talentSpent(charId);
  var free = Profile.talentFree(charId);
  var taken = Profile.talentsOf(charId);
  var home = Talent.AFFINITY[charId] || '';

  if (el.talentPoints) {
    el.talentPoints.textContent = '天赋点 ' + free + ' 可用 / 已用 ' + spent + ' / 累计 ' + earned +
      (home ? '（本命扇区：' + Talent.SECTORS[home].name + '，跨扇区 +1 费）' : '（无本命扇区：所有扇区同价）');
  }

  // 概览 + 开局条件（**天赋唯一的出口**，直接显示出来）
  var opening = Profile.openingOf(charId);
  var statsTxt = [];
  for (var k in opening.stats) {
    if (Object.prototype.hasOwnProperty.call(opening.stats, k)) {
      statsTxt.push(Stats.label(k) + Stats.pretty(k, opening.stats[k]));
    }
  }
  var extra = [];
  if (opening.weapons.length) extra.push('额外武器 ' + opening.weapons.map(function (id) { return Weapons.BY_ID[id] ? Weapons.BY_ID[id].name : id; }).join('/'));
  if (opening.items.length) extra.push('额外道具 ' + opening.items.map(function (id) { return Items.BY_ID[id] ? Items.BY_ID[id].name : id; }).join('/'));
  if (opening.scrap) extra.push('起始废料 +' + opening.scrap);

  var head = setRow('角色', cd.name + ' · ' + cd.tag);
  head += setRow('已点', taken.length ? taken.map(function (id) {
    var nd = Talent.BY_ID[id];
    var td = nd ? Talent.TYPES[nd.type] : null;
    // 名字里的类型不再靠名字自己带（以前基石叫「【基石】狂徒」，界面上就成了"[基石] 【基石】狂徒"）
    return nd ? (td ? '[' + td.label + '] ' : '') + nd.name : id;
  }).join(' / ') : '（还没点）');
  head += setRow('开局条件', (statsTxt.join(' ') || '无属性加成') + (extra.length ? ' · ' + extra.join(' · ') : ''));
  var freeLeft = Math.max(0, Profile.freeRespecsOf(charId) - Profile.perChar(charId).respecs);
  var nextCost = Profile.respecCostOf(charId);
  head += setRow('洗点', '免费还剩 ' + freeLeft + ' 次，之后每次 ' + nextCost +
    ' 孢子（当前孢子 ' + Profile.spores() + '）');
  el.talentHead.innerHTML = head;

  // 节点：共享大图按扇区分组，本职子树单独一组
  var html = '';
  var vis = Talent.visibleFor(charId);
  var groups: Array<{ title: string; nodes: TalentNodeDef[] }> = [];
  for (var s in Talent.SECTORS) {
    groups.push({
      title: (s === home ? '★ ' : '') + Talent.SECTORS[s].name + ' · ' + Talent.SECTORS[s].note,
      nodes: vis.filter(function (d) { return d.sector === s && !Talent.OWNER[d.id]; })
    });
  }
  groups.push({ title: '本职（' + cd.name + '）', nodes: vis.filter(function (d) { return Talent.OWNER[d.id] === charId; }) });

  groups.forEach(function (g) {
    if (!g.nodes.length) return;
    html += setRow(g.title, '');
    g.nodes.forEach(function (d) {
      var typeDef = Talent.TYPES[d.type];
      var cost = Talent.costFor(d, charId);
      var isTaken = taken.indexOf(d.id) >= 0;
      var chk = isTaken ? null : Talent.canTake(charId, d.id, taken, earned);
      var btn;
      if (isTaken) {
        btn = '<button class="btn tiny" disabled>已点 ✓</button>';
      } else if (chk.ok) {
        btn = '<button class="btn tiny" data-act="talent-take" data-talent="' + d.id + '">花 ' + cost + ' 点</button>';
      } else {
        btn = '<button class="btn tiny" disabled title="' + chk.reason + '">' + (chk.reason === '天赋点不够' ? cost + ' 点' : '不可点') + '</button>';
      }
      html += '<div class="set-row"><span class="set-label">' +
        '[' + typeDef.label + '] <b>' + d.name + '</b> —— ' + d.desc +
        '</span><span class="set-value">' + btn + '</span></div>';
    });
  });
  el.talentList.innerHTML = html;

  var rb = q('btn-talent-respec');
  if (rb) {
    // 与 Profile.respecTalents 用**同一个算法**（据点「档案馆」打折之后不会显示错价）
    var cost = Profile.respecCostOf(charId);
    rb.textContent = cost > 0 ? '洗 点（' + cost + ' 材料）' : '洗 点（免费）';
  }
}

/* =========================================================
   每日挑战（图鉴面板里的一块）
   ========================================================= */
function renderDailyBlock() {
  var box = q('codex-daily');
  if (!box) return;
  var rule = Daily.of();
  var best = Profile.dailyOf(rule.key);
  var charName = (Chars.BY_ID[rule.char] && Chars.BY_ID[rule.char].name) || rule.char;
  var html = setRow('今天的角色', charName + '（全场一致，无视解锁）');
  html += setRow('今天的种子', String(rule.seed));
  if (best) {
    html += setRow('今天最好', best.score + ' 分 · 第 ' + best.wave + ' 波 · 击杀 ' + best.kills +
      (best.win ? ' · 通关' : ''));
  } else {
    html += setRow('今天最好', '还没打过');
  }
  // 每周挑战：轮换角色与难度 —— 赛季制在零后端下能诚实做到的那一档
  var wk = Season.of();
  var wbest = Profile.seasonOf(wk.key);
  var wchar = (Chars.BY_ID[wk.char] && Chars.BY_ID[wk.char].name) || wk.char;
  html += setRow('本周角色 / 难度', wchar + ' · 难度 ' + wk.danger + '（' + Danger.name(wk.danger) + '）');
  html += setRow('本周最好', wbest
    ? wbest.score + ' 分 · 第 ' + wbest.wave + ' 波' + (wbest.win ? ' · 通关' : '')
    : '还没打过');
  // 离线产出：要买了菌床才有（等级读**折叠值**，与结算那条路同一个来源）
  var bedLv = Profile.keepMods().offlineLevel;
  html += setRow('离线产出', bedLv > 0
    ? '菌床 Lv.' + bedLv + ' → ' + Offline.rateAt(bedLv) + ' 孢子/分（单次最多 ' + Offline.MAX_HOURS + ' 小时）'
    : '还没买「菌床」—— 它是离线产出的开关');
  // 最近一局的成绩码：短，可整行复制给别人复算
  var last = UI.dailyResult ? UI.dailyResult() : null;
  if (last && last.code) {
    html += setRow('成绩码' + (last.kind === 'weekly' ? '（每周）' : '（每日）'),
      '<span class="score-code">' + last.code + '</span>');
  }
  html += setRow('成绩码怎么用',
    '给对方「成绩码 + 带子」，对方重放一遍就能验证真伪 —— 不需要服务器');
  box.innerHTML = html;
}

/* =========================================================
   角色解锁门槛（**只在界面这一层**）
   data_chars.ts 里的 locked 标记由"进程"组挑战解锁。
   模拟层不认识账号档案 —— Game.newRun(id) 不做校验，
   所以测试与 CLI 仍能直接开任意角色，而玩家看到的是锁着的卡。
   ========================================================= */
function isCharAvailable(c) {
  if (!c || !c.locked) return true;
  return Profile.isUnlocked('char', c.id);
}

/** 选人页上该不该出现这张卡：**隐藏角色**没解锁就连人带卡都不出现 */
function isCharListed(c) {
  if (!c) return false;
  if (c.hidden && !Profile.isUnlocked('char', c.id)) return false;
  return true;
}

/** 这个角色由哪条挑战解锁（给他看"还差什么"，而不是一句"未解锁"） */
function charUnlockHint(id) {
  for (var i = 0; i < Challenges.LIST.length; i++) {
    var d = Challenges.LIST[i];
    for (var u = 0; u < d.unlock.length; u++) {
      if (d.unlock[u].family === 'char' && d.unlock[u].id === id) return d.desc;
    }
  }
  return '';
}

/* =========================================================
   难度选择（阶梯逐级累加，所以只给"已解锁到哪一级"）
   没解锁的**显示为禁用而不是藏起来** —— 让玩家看见"再赢一级就开下一档"。
   ========================================================= */
function renderDangerPick() {
  if (!el.dangerRow) return;
  var maxLv = Profile.dangerOf(UI.selectedChar);
  if (UI.selectedDanger > maxLv) UI.selectedDanger = maxLv;
  if (UI.selectedDanger < 0) UI.selectedDanger = 0;
  U.clear(el.dangerRow);
  for (var lv = 0; lv <= Danger.MAX; lv++) {
    var b = U.el('button', 'btn tiny' + (lv === UI.selectedDanger ? ' sel' : '')) as HTMLButtonElement;
    b.textContent = String(lv);
    b.disabled = lv > maxLv;
    b.title = lv + ' · ' + Danger.name(lv) + ' —— ' + Danger.note(lv);
    (function (level) {
      b.addEventListener('click', function () {
        UI.selectedDanger = level;
        renderDangerPick();
        if (Sfx) Sfx.click();
      });
    })(lv);
    el.dangerRow.appendChild(b);
  }
  if (el.dangerInfo) {
    el.dangerInfo.textContent = UI.selectedDanger + ' · ' + Danger.name(UI.selectedDanger) +
      ' —— ' + Danger.note(UI.selectedDanger) +
      (maxLv < Danger.MAX ? '（已解锁到 ' + maxLv + '）' : '（已全部解锁）');
  }
}

function refreshCharSelection() {
  U.$$('.char-card', el.charGrid).forEach(function (card) {
    card.classList.toggle('sel', card.dataset.char === UI.selectedChar);
  });
  var c = Chars.BY_ID[UI.selectedChar];
  var lockHint = (c && isCharAvailable(c)) ? '' : charUnlockHint(UI.selectedChar);
  var html = '<h3>' + c.name + ' <span style="font-size:13px;opacity:.6">' + c.en + '</span></h3>';
  html += '<span class="tag">' + c.tag + '</span>';
  if (lockHint) {
    html += '<div style="margin-top:6px;color:#cf4a3f;font-weight:700">未解锁 —— ' + lockHint + '</div>';
  }
  html += '<div style="margin-top:6px;font-size:13px;">' + c.desc + '</div>';
  html += '<div class="cols">';
  Stats.describe(c.stats).forEach(function (r) {
    html += '<div>' + r.label + ' <span class="' + (r.good ? 'buff' : 'nerf') + '">' + r.text + '</span></div>';
  });
  html += '<div>起始武器 ' + c.startWeapons.map(function (id) {
    return '<b>' + Weapons.BY_ID[id].name + '</b>';
  }).join(' + ') + '</div>';
  html += '</div>';
  el.charDetail.innerHTML = html;

  // 确认按钮跟着锁走：锁着的角色点不动，而不是让玩家点了才被拒
  var btn = q('btn-confirm-char');
  if (btn) {
    (btn as HTMLButtonElement).disabled = !!lockHint;
    btn.textContent = lockHint ? '未 解 锁' : '确 认 出 发';
  }
  // 难度上限是按角色记的，所以换角色要重画难度条
  renderDangerPick();
}

/* =========================================================
   事件接线
   状态一律通过 Game.setState 切换（校验 + 发 stateChange），
   界面刷新由 stateChange 事件驱动，不再各处手动 UI.refresh()。

   动作**不再是 switch 的分支，而是一张表**（改造前这里是 380 行的 switch / 53 个 case）：
     · "去某个界面"的那一半动作是**数据**，住在 `scene.ts` 的 `SCREEN_ACTS` 里 ——
       值是状态名，所以"跳到一个不存在的界面"在启动期就会被抓住
     · `ACTIONS`：真正要做事的动作。**动作名 → 处理函数**，运行时可枚举，
       所以 `ui-check` 的 "每个 data-act 都有处理分支" 可以直接读这张表，
       而不必再去正则匹配源码里的 `case 'x':`（那才是脆弱的地方）
   两张表定义期就会查重名（对象字面量的重复键是编译错误）。
   ========================================================= */
/* ---- 按屏幕分组的动作处理器（44 个） ------------------------------------
   分组是**声明**（GROUPS），不是读出来的：每个动作只属于一组，
   合并时查重名（单张字面量里重名是编译错误，拆开之后这个保护会丢，所以显式补回来）。
   ui-check 会验"每个动作恰好属于一组、且每组都不是杂物箱"。 */
type ActMap = Record<string, (t: HTMLElement, act: string) => void>;

var ACT_SHELL: ActMap = {

  'start': function () { Game.setState('chars'); },

  'enter-room': function (t) {
    // 点小地图上相邻的一间就过去（与"走到门口"是同一条路，同一套校验）
    Game.enterRoom(Number(t.dataset.dir));
  },

  'continue-run': function () {
    var resumed = Save.loadRun();
    if (resumed) {
      UI.toast('继续第 ' + Game.wave + ' 波 · ' + resumed.charDef.name, 'good');
      UI.refresh();
    } else {
      UI.toast('存档读不出来（已忽略）', 'warn');
      refreshContinueButton();
    }
  },

  // 可返回覆盖层（帮助 / 设置 / 战绩）共用一个返回动作：
  // 来处由 setState 记录，回不去时退回 title（见 Game.returnFrom）
  'back': function () { Game.setState(Game.returnFrom(Game.state)); },
  'pause': function () {
    // 屏幕暂停键（触屏）：与 ESC 同一条路径
    Game.pause();
    UI.renderPause();
  },
  'resume': function () { Game.resume(); },
  'quit': function () {
    // 同样要确认：一局打到最后，误点一下就直接结算了
    if (!armed('quit', refreshConfirmLabels)) return;
    if (!Game.setState('end')) return;
    var qs = Game.getSession();
    q('end-title').textContent = '放 弃 本 局';
    var sum: RunSummary = qs ? Game.summary() : ({
      win: false, wave: 1, level: 1, kills: 0, scrap: 0,
      damage: 0, taken: 0, healed: 0, charName: '', weapons: [], items: [],
      stats: null, packs: 0, packSpent: 0
    } as RunSummary);
    sum.charName = qs ? qs.charDef.name : '';
    sum.quit = true;
    renderEnd(sum);
  },
  'again': function () { buildCharSelect(); Game.setState('chars'); },
  'diag-close': function () { UI.setDiag(false); },
};

var ACT_SETTINGS: ActMap = {

  /* ---- 设置：改动设置项 → 立刻重画设置页（值从表里读，见 settings.ts） ---- */
  'set-sound': function () { Settings.set('sound', !Settings.get('sound')); renderSettings(); },
  /* 音乐与音效是**两个开关**（不是"音量"的一半）：有人要音效不要音乐。
     但「音效」总开关会同时关掉音乐（见 main.ts 的 applySetting）——
     两个开关各管一半，就会出现"关掉音效音乐还在响"。 */
  'set-music': function () { Settings.set('music', !Settings.get('music')); renderSettings(); },
  'set-fps': function () { Settings.set('fps', !Settings.get('fps')); renderSettings(); },
  'set-autopause': function () { Settings.set('autopause', !Settings.get('autopause')); renderSettings(); },
  'set-damage': function () { Settings.set('damageNumbers', !Settings.get('damageNumbers')); renderSettings(); },
  'set-motion': function () { Settings.set('reduceMotion', !Settings.get('reduceMotion')); renderSettings(); },
  /* ---- 这一轮补的三项（本地化 + 可访问性）----
     每一项都是"在 `settings.ts` 的合法取值里循环"，不在这里写死下一个值 ——
     所以加一档（比如再加一种语言或一档字号）只需要改设置表。 */
  'set-locale': function () {
    var ids = I18n.LOCALES.map(function (l) { return l.id; });
    var i = ids.indexOf(Settings.get('locale'));
    Settings.set('locale', ids[(i + 1) % ids.length]);
    renderSettings();
  },
  'set-fontscale': function () {
    var vals = Settings.def('fontScale').values || [1];
    var i = vals.indexOf(Settings.get('fontScale'));
    Settings.set('fontScale', vals[(i + 1) % vals.length]);
    renderSettings();
  },
  'set-colourblind': function () {
    var vals = Settings.def('colourblind').values || [0];
    var i = vals.indexOf(Settings.get('colourblind'));
    Settings.set('colourblind', vals[(i + 1) % vals.length]);
    renderSettings();
  },
  'fullscreen': function () { U.toggleFullscreen(); renderSettings(); },
  'set-speed': function () { Settings.set('speed', Settings.get('speed') >= 2 ? 1 : 2); renderSettings(); },
  /* 战斗模式：在设置表的 `options` 里循环（不在这里写死两个值 —— 加一种模式只改设置表） */
  'set-combat': function () {
    var opts = Settings.def('combatMode').options || ['auto'];
    var i = opts.indexOf(Settings.get('combatMode'));
    Settings.set('combatMode', opts[(i + 1) % opts.length]);
    renderSettings();
  },
  /* 命中定帧：在设置表的 `values` 里循环（不在这里写档位 —— 加一档只改设置表） */
  'set-hitstop': function () {
    var vals = Settings.def('hitStop').values || [0];
    var i = vals.indexOf(Settings.get('hitStop'));
    Settings.set('hitStop', vals[(i + 1) % vals.length]);
    renderSettings();
  },
  'set-shake-up': function () { Settings.set('shake', Settings.get('shake') + Settings.def('shake').step); renderSettings(); },
  'set-shake-down': function () { Settings.set('shake', Settings.get('shake') - Settings.def('shake').step); renderSettings(); },
  'keys-default': function () {
    BIND_KEYS.forEach(function (k) { Settings.set(k, Settings.def(k).def); });
    renderSettings();
    UI.toast('按键已恢复默认', '');
  },
  'rebind': function (t) { startRebind((t.dataset && t.dataset.bind) || ''); },

  'set-reset': function () {
    // 破坏性操作要确认一次（改造前点一下就把存档/记录/设置全清了）
    if (!armed('reset', refreshConfirmLabels)) return;
    Save.resetAll();
    Profile.clear();          // 账号档案（解锁/图鉴/孢子）也要清，否则"清空存档"名不副实
    Settings.resetAll();
    renderSettings();
    refreshContinueButton();
    UI.toast('已清空存档、记录、账号档案与设置', 'warn');
  },
};

/* =========================================================
   音量（单独一组，**不是**设置组的一部分）
   ---------------------------------------------------------
   为什么拆出来：`test/ui-check.mjs` 有一条"没有杂物箱"的判据 ——
   **单组超过 20 个动作就先拆开**。加了分组音量之后设置组到了 21 个，
   于是这条尺子红了。它红得对：那一组里同时住着"开关""循环切档""改键"
   "清空存档"四类东西，本来就该按**它管什么**分开，而不是按"哪个界面"。

   四条增减动作写的是同一个形状（读 `Settings.def(...).step`，不写死步长）：
   把步长写进这里的话，改一次步长要改五处，而漏改一处就是"总音量能拖到
   0.02 一档、分组音量只能拖 0.05 一档"这种没人会发现的偏差。
   ========================================================= */
var ACT_VOLUME: ActMap = {
  'set-volume-up': function () { Settings.set('volume', Settings.get('volume') + Settings.def('volume').step); renderSettings(); },
  'set-volume-down': function () { Settings.set('volume', Settings.get('volume') - Settings.def('volume').step); renderSettings(); },
  'set-sfxvol-up': function () { Settings.set('sfxVolume', Settings.get('sfxVolume') + Settings.def('sfxVolume').step); renderSettings(); },
  'set-sfxvol-down': function () { Settings.set('sfxVolume', Settings.get('sfxVolume') - Settings.def('sfxVolume').step); renderSettings(); },
  'set-musvol-up': function () { Settings.set('musicVolume', Settings.get('musicVolume') + Settings.def('musicVolume').step); renderSettings(); },
  'set-musvol-down': function () { Settings.set('musicVolume', Settings.get('musicVolume') - Settings.def('musicVolume').step); renderSettings(); }
};

var ACT_CHARS: ActMap = {

  'confirm-char': function () {
    // 门槛只在界面这一层：锁着的角色由按钮 disabled 挡住，这里再兜一次
    // （手柄/键盘走的是 .click()，disabled 元素点不动，但焦点机制仍可能调到）
    if (!isCharAvailable(Chars.BY_ID[UI.selectedChar])) {
      UI.toast('这个角色还没解锁：' + charUnlockHint(UI.selectedChar), 'warn');
      return;
    }
    Game.newRun(UI.selectedChar, undefined, UI.selectedDanger,
      Profile.openingOf(UI.selectedChar),
      { owned: Profile.keepOwned(), forge: Profile.forgeOwned() });
    UI.toast('出发！第 1 波开始' +
      (UI.selectedDanger > 0 ? '（难度 ' + UI.selectedDanger + ' · ' + Danger.name(UI.selectedDanger) + '）' : ''), 'good');
  },
};

var ACT_SHOP: ActMap = {

  /* ---- 层间契约（boons.ts）：打完 Boss 在商店里挑一条 ---- */
  'boon-pick': function (t) {
    var bid = (t.dataset && t.dataset.boon) || '';
    if (Game.pickBoon(bid)) {
      var bd = Boons.BY_ID[bid];
      UI.toast('这一层的契约：' + (bd ? bd.name : bid) + ' —— ' + (bd ? bd.note : ''), 'good');
    }
    renderShop();
  },

  /* ---- 商店 / 波次 ---- */
  'next-wave': function () {
    // 只有确实完成了一次换波才提示（连点第二次会被状态校验拒绝）
    if (Game.nextWave()) {
      UI.toast('第 ' + Game.wave + ' 波 · ' + Enemies.describeWave(Game.wave), 'warn');
    }
  },
  'reroll': function () { Game.reroll(); renderShop(); },
  'lock': function () { Game.toggleLock(); renderShop(); },

  /* ---- 合成 / 回收（战斗 × 经营的交点，规则在 data_weapons.ts） ----
     两个动作以前都没有：武器只能"买"和"半价卖"。于是"手里两把一样的匕首"
     唯一的下场是白占一个格子 —— 玩家看得出这里少了一件事，
     因为原作（brotato）把"两把同名同档合成一把更高的"做成了核心爽点。
     为什么给按钮而不是"点卡片就合成"：卡片上现在有两个动作（合并 / 回收），
     而回收是**不可撤销**的；让整张卡片可点会把两者混成一个 —— 一次误点就少一把武器。 */
  'combine': function (t) {
    var d = (t && t.dataset) || {};
    var i = Math.floor(Number(d.i)), j = Math.floor(Number(d.j));
    var sess = Game.getSession();
    var before = sess ? sess.player.weapons[i] : null;
    var name = before ? before.def.name : '';
    if (Game.combine(i, j)) {
      var now = Game.getSession().player.weapons[i];
      UI.toast('合成：' + name + ' T' + (before ? Weapons.tierOf(before) : '?') +
        ' → T' + (now ? Weapons.tierOf(now) : '?') + '（伤害 ' +
        U.plusPct((now ? Weapons.mul(now, 'dmg') : 1) / (before ? Weapons.mul(before, 'dmg') : 1) - 1) + '）',
        'good');
    }
    renderShop();
  },
  'salvage': function (t) {
    var d = (t && t.dataset) || {};
    var i = Math.floor(Number(d.i));
    /* 结果由 `sell` 事件播报（它带着合金）—— 这里只发起与重画，不重复说一遍。 */
    Game.sellWeapon(i);
    renderShop();
  },

  /* ---- 参考资料折叠（联动 / 套装）----
     它们是"看"的，不是"做"的：默认折成一行，把高度让给买 / 合 / 卖。
     展开后那一段变长，列自己滚（`.shop-col` 本来就能滚）。 */
  'toggle-syn': function () { UI.showSyn = !UI.showSyn; renderShop(); },
  'toggle-set': function () { UI.showSet = !UI.showSet; renderShop(); },
  'pack-basic': function () { if (Game.buyPack('basic')) renderShop(); },
  'pack-deluxe': function () { if (Game.buyPack('deluxe')) renderShop(); },
  /* 建材包：商店的"原料"那一栏 —— 花废料买工坊的本钱（不划算，买的是时间）。 */
  'pack-build': function () {
    if (Game.buyBuild()) UI.toast('建材 +4（工坊的本钱）', 'good');
    renderShop();
  }
};

var ACT_CAMP: ActMap = {

  /* ---- 营地（局内经营） ---- */
  'camp': function () { Game.openCamp(); },
  /* ---- 制造 / 回收（经营那一侧的主行动）----
     `craft` 用哪条产线由界面选（`data-line` = 这一波第一条空产线），
     规则与费用全在 craft.ts / camp.ts / forge.ts —— 界面不判断"能不能造"。 */
  'craft': function (t) {
    var d = (t && t.dataset) || {};
    var line = Math.floor(Number(d.line) || 0);
    /* 结果由 `craft` 事件播报（它带着档位与"走运"）—— 这里只负责发起与重画，
       不重复说一遍"造成了什么"。 */
    Game.craft(line, d.recipe || '');
    renderCamp();
  },
  'craft-tab': function (t) {
    var k = (t && t.dataset && t.dataset.kind) || 'weapon';
    UI.craftTab = (k === 'item') ? 'item' : 'weapon';
    renderCamp();
  },
  'camp-buy': function (t) {
    var fid = (t.dataset && t.dataset.camp) || '';
    if (Game.campBuy(fid)) {
      var fd = Camp.BY_ID[fid];
      if (fd) UI.toast('工坊建成：' + fd.name + ' Lv.' + Profile.campLevel(fid), 'good');
    }
    renderCamp();
  },
  'camp-sell': function (t) {
    var sid = (t.dataset && t.dataset.camp) || '';
    if (Game.campSell(sid)) UI.toast('已拆除，材料退还', '');
    renderCamp();
  },
};

var ACT_TALENTS: ActMap = {

  /* ---- 天赋（角色养成） ---- */
  'talent-take': function (t) {
    var nodeId = (t.dataset && t.dataset.talent) || '';
    var r = Profile.takeTalent(UI.talentChar, nodeId);
    if (r.ok) UI.toast('已点：' + (Talent.BY_ID[nodeId] ? Talent.BY_ID[nodeId].name : nodeId), 'good');
    else UI.toast(r.reason, 'warn');
    renderTalents();
  },
  'talent-undo': function () {
    var list = Profile.talentsOf(UI.talentChar);
    if (!list.length) { UI.toast('还没点过天赋', 'warn'); return; }
    // 撤销上一点是**免费**的：误点不该被罚；换流派才走洗点（有成本）
    Profile.undoTalent(UI.talentChar);
    UI.toast('已撤销上一点', '');
    renderTalents();
  },
  'talent-respec': function () {
    var res = Profile.respecTalents(UI.talentChar);
    if (res.ok) {
      UI.toast(res.cost > 0 ? '已洗点（花了 ' + res.cost + ' 孢子）' : '已洗点（免费次数内）', '');
    } else UI.toast(res.reason, 'warn');
    renderTalents();
  },
  'talent-char': function (t) {
    var cid = (t.dataset && t.dataset.charPick) || '';
    if (Chars.BY_ID[cid]) { UI.talentChar = cid; renderTalents(); }
  },
};

var ACT_KEEP: ActMap = {

  /* ---- 据点（跨局经营） ---- */
  'keep-buy': function (t) {
    var kid = (t.dataset && t.dataset.keep) || '';
    var kr = Profile.keepBuy(kid);
    if (kr.ok) {
      var kd = Keep.BY_ID[kid];
      UI.toast('据点建成：' + (kd ? kd.name : kid) + ' Lv.' + kr.toLevel +
        '（花了 ' + kr.cost + ' 孢子）', 'good');
    } else UI.toast(kr.reason, 'warn');
    renderKeep();
  },

  /* ---- 图纸工坊（跨局养成第三条腿：花合金，只解锁能力） ---- */
  'forge-buy': function (t) {
    var zid = (t.dataset && t.dataset.forge) || '';
    var zr = Profile.forgeNode(zid);
    if (zr.ok) {
      var zd = Forge.BY_ID[zid];
      UI.toast('图纸解锁：' + (zd ? zd.name : zid) + ' —— ' +
        (zd ? Forge.nodeText(zd) : '') + '（花了 ' + zr.cost + ' 合金）', 'good');
    } else UI.toast(zr.reason, 'warn');
    renderKeep();
  },
};

var ACT_HUB: ActMap = {

  /* ---- 枢纽（N2）：人、话、出发 ---- */
  'hub-back': function () {
    /* 从暂停过来的就回暂停（那一局还在手里），否则回标题页。
       这一条是"枢纽是家、不是单向门"的具体体现。 */
    Game.setState(Game._hubFrom === 'paused' ? 'paused' : 'title');
  },
  'hub-station': function (t) {
    /* 站点：有人站着就选中他（说他的下一句），是设施就直接走上去。
       一个动作两种去处 —— 由站点自己声明（story.ts 的 STATIONS），
       界面不按站点 id 分支（加一站不用改这里）。 */
    var nid = (t.dataset && t.dataset.npc) || '';
    var scr = (t.dataset && t.dataset.screen) || '';
    if (nid) { _hubNpc = nid; renderHub(); }
    else if (scr) { Game.setState(scr as GameStateName); }
  },
  'hub-say': function () { hubSay(); },
};

var ACT_CODEX: ActMap = {

  'codex-tab': function (t) {
    _codexTab = (t.dataset && t.dataset.tab) || '';
    renderCodexTabs();
  },
};

var ACT_CHALLENGE: ActMap = {

  /* ---- 挑战：实现在 main.ts（种子/角色/录制/成绩码都属于"接线"层）——
         界面只负责发起，不认识"今天是什么种子" ---- */
  'daily': function () {
    if (UI.dailyStart) UI.dailyStart();
    else UI.toast('挑战需要浏览器环境', 'warn');
  },
  'weekly': function () {
    if (UI.weeklyStart) UI.weeklyStart();
    else UI.toast('挑战需要浏览器环境', 'warn');
  },
};

/**
 * 存档搬运：槽位切换 / 导出 / 导入 / 重置。
 *
 * 为什么单独成一组（而不是塞进 `ACT_SETTINGS`）：
 * 界面契约测试有一条"单组不超过 20 个动作"（防杂物箱），而这三个动作
 * 与"改偏好"**不是一回事** —— 它们动的是**存档本身**（会重读档案、可能丢进度），
 * 混在设置里会让"哪几个动作有破坏性"看不出来。
 */
var ACT_SAVES: ActMap = {
  'slot-prev': function () { Slots.prev(); afterSlotChange(); },
  'slot-next': function () { Slots.next(); afterSlotChange(); },
  'save-export': function () {
    var text = Slots.exportText();
    var ok = U.copyText(text);
    UI.toast(ok ? I18n.t('存档已复制') : I18n.t('导入失败：文本不是合法的存档'));
  },
  'save-import': function () {
    U.readClipboard(function (text) {
      var r = Slots.importText(text);
      UI.toast(r.ok ? I18n.t('存档已导入') : I18n.t('导入失败：文本不是合法的存档'));
      if (r.ok) afterSlotChange();
    });
  },
  'save-reset': function () {
    Slots.reset();
    UI.toast(I18n.t('重置本槽位') + ' ✔');
    afterSlotChange();
  }
};

var ACT_GROUPS: Record<string, ActMap> = {
  shell: ACT_SHELL,
  settings: ACT_SETTINGS,
  volume: ACT_VOLUME,
  saves: ACT_SAVES,
  chars: ACT_CHARS,
  shop: ACT_SHOP,
  camp: ACT_CAMP,
  talents: ACT_TALENTS,
  keep: ACT_KEEP,
  hub: ACT_HUB,
  codex: ACT_CODEX,
  challenge: ACT_CHALLENGE
};

/** 合并各屏的动作表：**重名直接抛**（否则后一组会静默盖掉前一组） */
function mergeActs(): ActMap {
  var out: ActMap = {};
  for (var g in ACT_GROUPS) {
    if (!Object.prototype.hasOwnProperty.call(ACT_GROUPS, g)) continue;
    var t = ACT_GROUPS[g];
    for (var a in t) {
      if (!Object.prototype.hasOwnProperty.call(t, a)) continue;
      if (out[a]) throw new Error("ui: 动作 " + a + " 在两组里都注册了（" + g + "）");
      out[a] = t[a];
    }
  }
  return out;
}
var ACTIONS: ActMap = mergeActs();

/** 按屏的动作分组（每个动作恰好一组；界面契约测试读它来判断"没有杂物箱"） */
UI.actGroups = function () {
  var out: Record<string, string[]> = {};
  for (var g in ACT_GROUPS) {
    if (Object.prototype.hasOwnProperty.call(ACT_GROUPS, g)) out[g] = Object.keys(ACT_GROUPS[g]);
  }
  return out;
};

/** 全部已注册的动作名（界面契约测试读它，不再去正则匹配源码里的 `case 'x':`） */
UI.actNames = function () {
  return Scene.screenActNames().concat(Object.keys(ACTIONS));
};

function wireActions() {
  document.addEventListener('click', function (e) {
    var target = e.target as Element | null;
    var t = target && target.closest ? (target.closest('[data-act]') as HTMLElement | null) : null;
    if (!t) return;
    var act = t.dataset.act;
    if (Sfx) Sfx.click();
    var fn = ACTIONS[act];
    if (fn) { fn(t, act); return; }
    // 一多半动作就是"去某个界面"：去处是数据，住在 scene.ts（总账会查那个状态真的存在）
    var to = Scene.screenActOf(act);
    if (to) Game.setState(to);
  });
}

function wireEvents() {
  var G = Game.events;

  // 状态变化 → 界面刷新（唯一驱动源，避免各处手动 refresh 漏掉某个状态）
  G.on('stateChange', function (d) {
    UI.refresh();
    if (d && d.to === 'end' && d.from !== 'paused') { /* 结算内容由 gameOver 事件填充 */ }
  });
  // 非法转换：给出可见反馈，方便定位"按钮点了没反应"
  G.on('stateDenied', function (d) {
    if (console && console.warn) {
      console.warn('[state] 拒绝非法转换 ' + d.from + ' → ' + d.to + (d.action ? '（' + d.action + '）' : ''));
    }
  });

  // 升级卡内容由事件驱动（连续升级时状态不变，靠这个事件重画）
  G.on('levelCards', function () { renderLevelCards(); });

  G.on('levelup', function () {
    UI.toast('等级提升！Lv.' + Game.getSession().player.level, 'good');
    if (Sfx) Sfx.levelUp();
  });

  G.on('shopOpen', function (d) {
    if (d && d.bonus) UI.toast('波次奖励 +' + d.bonus + ' 废料', 'good');
    if (Sfx) Sfx.waveClear();
  });

  /* 超时狂暴：这条以前**一个监听者都没有** —— 模拟层把每只怪加速加伤、把这一间奖励
     打到 0.8 倍，玩家只感到"怪突然变强、收益突然变少"，没有任何一处解释。
     （它一直没被发现，一半是因为 `overrun` 不在事件清单里：`registry.mjs` 的事件名正则
     漏掉了 `C.events().emit(` 那种写法，见那条测试里的说明。） */
  G.on('overrun', function (d) {
    var left = (d && d.left) || 0;
    UI.toast('这一间超时了 —— 剩下的 ' + left + ' 只狂暴（更快、更疼），这一间的奖励打折', 'warn');
  });

  G.on('waveStart', function (n) {
    /* 房间制之后"第 N 波"已经说不清你在哪了：横幅改成"第 N 间 · 房型"，
       是关底房就把**这一层的 Boss 名字**打出来（它是地图/剧情/存档三处一致的那个 id）。 */
    var sess = Game.getSession();
    var room = (sess && sess.map) ? Dungeon.roomById(sess.map, sess.roomId) : null;
    var td = room ? Dungeon.TYPE_BY_ID[room.type] : null;
    var who = td ? td.name : '第 ' + n + ' 间';
    if (sess && sess.bossId) {
      var bd = Enemies.BY_ID[sess.bossId];
      if (R) R.banner((bd ? bd.name : '关底') + ' · 第 ' + n + ' 间', 2.6);
    } else if (R) {
      R.banner('第 ' + n + ' 间 · ' + who, 1.8);
    }
    if (Sfx) Sfx.waveStart();
  });

  /* 翻层：一句旁白 + "这一层守着谁" + **这一层是什么地方**。
     层是一局里最强的节奏信号，那里只写"第 2 层"等于什么都没说。

     环境那一句是这一轮加的，而且**必须报出来**：环境现在是**每局抽签**的
     （同一层下一局可能是带内的另一个地方），它决定地面配色、岩石色、裂纹色
     和装饰物（白骨/菌伞/晶簇/余烬/冰棱）。不报名字的话，"不同的环境"就只体现为
     "背景颜色好像不太一样" —— 玩家认不出这是另一个地方。
     旁白存在时 banner 被旁白占着，所以环境走 toast 这一路。 */
  G.on('floorEnter', function (d) {
    var line = Story.narration(d && d.floor);
    if (R) R.banner(line || ('第 ' + (d ? d.floor : '?') + ' 层' + (d && d.name ? ' · ' + d.name : '')), 3.0);
    var bossId = Game.getSession() ? Enemies.bossFor(Game.getSession().seed, d ? d.floor : 1) : null;
    var bd = bossId ? Enemies.BY_ID[bossId] : null;
    if (bd) UI.toast('这一层守着：' + bd.name, 'warn');
    var th = d && d.theme ? Dungeon.THEME_BY_ID[d.theme] : null;
    if (th) UI.toast('这一层 · ' + th.name + ' —— ' + th.note, 'good');
    if (Sfx) Sfx.waveStart();
  });

  G.on('bossDown', function (d) {
    if (d && d.name) UI.toast(d.name + ' 倒下了 —— 它的那一片记录会留在枢纽的墙上', 'good');
  });

  G.on('waveClear', function () {
    if (R) R.banner('这一间清干净了', 1.6);
  });

  /* 进门效果（宝箱给了什么 / 精英给了多少废料 / 补给房回血与建材）。
     这一条以前**只发不收**：`applyRoomEntry()` 的返回值在三处调用点都被丢掉，
     而它发的 `roomEnter` 事件一个监听者都没有 —— 于是"宝箱房白给一件装备"
     这句话谁也看不见。表现就是玩家会拿着一件从没见过的装备（实测：宝箱能开出
     「克隆装置」，"所有远程武器额外发射 1 发弹丸"，看起来就是"子弹突然会分叉"）。
     接在这条既有 toast 上，房间内容才第一次真的可见。 */
  G.on('roomEnter', function (d) {
    if (!d || !d.msg) return;          // 普通遭遇房没有内容，不打扰
    UI.toast(d.msg, 'good');
  });

  G.on('buy', function (d) { UI.toast('获得 ' + d.name, 'good'); if (Sfx) Sfx.buy(); });

  G.on('packOpen', function (d) {
    var tierName = Tiers.nameOf(d.def.tier);
    var tag = d.delta > 0 ? '（赚 ' + d.delta + '）' : (d.delta < 0 ? '（亏 ' + (-d.delta) + '）' : '');
    UI.toast('道具包开出：' + d.def.name + ' T' + d.def.tier + ' ' + tierName + tag,
      d.def.tier >= 3 ? 'good' : (d.delta < 0 ? 'warn' : ''));
    if (Sfx) Sfx.buy();
    var sq = Game.getSession();
    if (sq) renderShop();
  });
  /* 回收：**必须把合金说出来** —— 它是图纸树唯一的稳定来源，
     而这句提示是玩家唯一能看到"我拆了它就离图纸更近一步"的地方。 */
  G.on('sell', function (d) {
    UI.toast('回收 ' + d.name + ' +' + d.refund + ' 废料' +
      (d.alloy ? ' +' + d.alloy + ' 合金' : ''), '');
  });
  /* 制造：结果档位与"走运"（锻台 / 淬火）都在事件里 —— 不播出来，
     玩家就永远不知道那 25% 发生过（这两条加成就是白做的）。 */
  G.on('craft', function (d) {
    var tag = d.kind === 'weapon' ? ('T' + d.tier) : '道具';
    var lucky = d.lucky ? (d.kind === 'weapon' ? ' · 淬火成功（高一档）' : ' · 一试两份') : '';
    UI.toast('造成：' + d.name + ' ' + tag + lucky + '（废料 -' + d.cost + '）',
      d.lucky ? 'good' : '');
  });
  G.on('reroll', function () { UI.toast('商店已刷新', ''); });
  G.on('lock', function (v) { UI.toast(v ? '商店已锁定' : '已解锁', ''); });
  G.on('deny', function (msg) { UI.toast(msg, 'warn'); if (Sfx) Sfx.deny(); });
  G.on('gameOver', function (sum) {
    // 有通关条件之后，"结束"有两种：赢与倒下。标题必须分开写，
    // 否则打赢了也显示"你被击倒了"。
    q('end-title').textContent = (sum && sum.win) ? '通 关 ！' : '你 被 击 倒 了';
    renderEnd(sum);
    UI.refresh();
    refreshContinueButton();
  });
  // 新开一局：上一局的存档立刻作废（否则标题页会挂着一个过期的"继续"）
  G.on('runStart', function () { refreshContinueButton(); });
  // 续玩：让标题页那个按钮消失（正在打的这一局不该再显示"继续上一局"）
  G.on('runResumed', function () { refreshContinueButton(); });

  /* =========================================================
     首局引导：**按时机**弹一次（规则全在 `tutorial.ts`，界面只负责"什么时候问"）
     ---------------------------------------------------------
     `say(when)` 做三件事：问有哪些该说的 → 逐条飘字 → 标记"说过了"。
     标记走 `Tutorial.mark`（它会通知 profile 落盘），所以**看完就记得**：
     下次进来不会再被同一句糊一次。

     为什么挂在几个**事件**上而不是"每帧检查玩家状态"：
     每帧检查会让同一条提示在满足条件的那一秒里反复触发，
     而"什么时候该说"本来就该是一个事件（开局 / 清间 / 进商店 / 升级 / 遇 Boss）。
     */
  G.on('runStart', function () { say('run-start'); });
  G.on('waveClear', function () { say('first-wave-cleared'); });
  G.on('shopOpen', function () { say('first-shop'); say('first-craft'); });
  G.on('levelup', function () { say('first-levelup'); });
  G.on('bossDown', function () { say('first-boss'); });
  /* 低血是**状态**不是事件：只在"第一次掉过半血"那一刻说一次。
     ⚠ 挂的必须是**真存在的事件**：第一版写的是 `playerHurt` —— 而那是
     `Emit.playerHurt`（粒子函数），**根本不是事件名**。
     它不抛错、什么都不发生，只是这条提示永远不会出现；
     抓到它的是 `test/signals.mjs` 那条"没有'订阅了但永远不会触发'的死订阅"。
     现在挂 `waveClear`（每次清间都发），在那一刻看一眼血量。 */
  G.on('waveClear', function () {
    if (_lowHpSaid) return;
    const s = Game.getSession();
    if (!s) return;
    if (s.player.hp < s.stats.maxHp * 0.5) { _lowHpSaid = true; say('low-hp'); }
  });

  // 全屏状态可能被浏览器/系统自己改（F11、Esc、macOS 绿灯），标签要跟着走
  document.addEventListener('fullscreenchange', function () { renderSettings(); });
  document.addEventListener('webkitfullscreenchange', function () { renderSettings(); });
}

/* =========================================================
   HUD
   每帧只写"变化过的" DOM 字段。
   textContent / style.width 的重复写入会触发样式重算与重排，
   在 60fps 下是本游戏第二大开销（仅次于曾经的静态地面重绘）。
   ========================================================= */
function setText(key, node, value) {
  if (hudVals[key] === value) return;
  hudVals[key] = value;
  node.textContent = value;
}
function setWidth(key, node, value) {
  if (hudVals[key] === value) return;
  hudVals[key] = value;
  node.style.width = value;
}

/* =========================================================
   诊断面板（?diag=1）
   引擎里这是 debug overlay：把"看不见的系统"显示出来 —— 扩展点总账、容器账目、
   深度层带、缓存预算。内容全由 diag.ts 聚合（那边只返回字符串，因此可无头测试）。
   节流到 4Hz：面板本身不该成为开销。
   ========================================================= */
var _diagAcc = 0;
var _diagLast = '';
var _diagOn = false;

UI.diagEnabled = function () { return _diagOn; };
UI.setDiag = function (on) {
  _diagOn = !!on;
  // 元素引用惰性解析：面板可能在 UI.init 之前就被打开（无头测试、?diag= 直开）
  if (_diagOn && (!el.diagBody)) {
    el.diag = el.diag || q('diag');
    el.diagBody = q('diag-body');
  }
  if (el.diag) el.diag.hidden = !_diagOn;
  if (_diagOn) UI.refreshDiag(true);
  return _diagOn;
};
UI.refreshDiag = function (force) {
  if (!_diagOn) return false;
  if (!force && _diagAcc < 0.25) return false;
  _diagAcc = 0;
  // 组合与呈现分开：文本总是算出来（可无头测试），写 DOM 只是"有元素才写"
  _diagLast = UI.diagFull ? Diag.full() : Diag.text();
  if (el.diagBody) el.diagBody.textContent = _diagLast;
  return true;
};
/** 最近一次生成的诊断文本（测试 / 控制台用） */
UI.diagText = function () { return _diagLast; };
/** 每帧调用（由 main.ts 主循环驱动；渲染帧率与逻辑帧率都不是它的约束） */
UI.tickDiag = function (dt) {
  if (!_diagOn) return;
  _diagAcc += dt;
  UI.refreshDiag(false);
};
/* =========================================================
   小地图（房间制的地图面板）
   ---------------------------------------------------------
   三件事必须同时成立，否则"选哪扇门"这个决策就看不见：
     · 只画**发现过**的房间（隐藏房在破墙之前根本不在 DOM 里 —— 界面不可能剧透）
     · 标记"这一间清干净了没 / 是不是已经打过"
     · 相邻且可走的那几间是**按钮**（点一下就过去，与走过去是同一条路）
   重建只在**内容签名**变化时发生：HUD 每帧被调用，小地图却几乎不变，
   无条件重建会让"无变化不写 DOM"这条纪律当场失效（cache 那套测试盯着它）。
   ========================================================= */
const DIR_NAME = ['上', '右', '下', '左'];
var _mmSig = '';

/** 地图面板的内容签名（房间状态 + 当前位置 + 墙） */
function mapSignature(sess) {
  if (!sess || !sess.map) return '';
  var out = [sess.floor, sess.roomId, sess.map.theme || '', sess.wallsNow.length,
    sess.roomFx ? (sess.roomFx.shopSlots || 0) + '/' + (sess.roomFx.shopDiscount || 0) : 0];
  var vis = Dungeon.visible(sess.map);
  for (var i = 0; i < vis.length; i++) {
    var r = vis[i];
    out.push(r.id + ':' + r.type + (r.cleared ? 'c' : '') + (r.seen ? 's' : ''));
  }
  return out.join('|');
}

function dirBetween(a, b) {
  for (var d = 0; d < 4; d++) {
    if (b.x === a.x + Dungeon.DIRS[d][0] && b.y === a.y + Dungeon.DIRS[d][1]) return d;
  }
  return -1;
}

/** 这一扇门现在能不能走（有门 + 不是没破过的暗门） */
function doorOpen(sess, a, b) {
  var lk = Dungeon.link(sess.map, a, b);
  if (!lk || !lk.door) return false;
  if (lk.hidden && !Dungeon.wallOpen(sess.walls, sess.floor, a.id, b.id)) return false;
  return true;
}

function updateMinimap(sess) {
  if (!el.minimap) return;
  if (!sess || !sess.map) { el.minimap.classList.add('hidden'); _mmSig = ''; return; }
  el.minimap.classList.remove('hidden');
  var sig = mapSignature(sess);
  if (sig === _mmSig) return;
  _mmSig = sig;

  var th = Dungeon.THEME_BY_ID[sess.map.theme];
  setText('mmf', el.mmFloor, '第 ' + sess.floor + ' 层');
  setText('mmt', el.mmTheme, th ? th.name : '');

  var cur = Dungeon.roomById(sess.map, sess.roomId);
  var vis = Dungeon.visible(sess.map);
  var at: Record<string, DungeonRoom> = Object.create(null);
  for (var i = 0; i < vis.length; i++) at[vis[i].x + ',' + vis[i].y] = vis[i];

  var N = Dungeon.GRID;
  var size = N * 2 + 1;
  el.mmGrid.style.gridTemplateColumns = 'repeat(' + size + ', 17px)';
  U.clear(el.mmGrid);
  for (var y = -N; y <= N; y++) {
    for (var x = -N; x <= N; x++) {
      var r = at[x + ',' + y];
      if (!r) { el.mmGrid.appendChild(U.el('div', 'mm-cell empty')); continue; }
      var t = Dungeon.TYPE_BY_ID[r.type];
      var dir = cur ? dirBetween(cur, r) : -1;
      var canGo = !!(cur && cur.cleared && !r.cleared && dir >= 0 && doorOpen(sess, cur, r));
      // 样式类也在房型表里（界面不按房型 id 分支 —— 加一种房型不用改界面）
      var cls = 'mm-cell' + (t && t.cls ? ' mm-' + t.cls : '');
      if (r.cleared) cls += ' done';
      if (r.id === sess.roomId) cls += ' here';
      else if (canGo) cls += ' go';
      var cell = U.el(canGo ? 'button' : 'div', cls, t ? t.icon : '·');
      cell.title = (t ? t.name : r.type) + (r.cleared ? '（已清）' : '') +
        (r.id === sess.roomId ? '（你在这里）' : canGo ? '（点一下过去）' : '');
      if (canGo) { cell.dataset.act = 'enter-room'; cell.dataset.dir = String(dir); }
      el.mmGrid.appendChild(cell);
    }
  }

  /* 提示语：把"现在该做什么"写在面板上。
     "墙上有裂纹"是隐藏要素唯一的线索来源 —— 没有它，秘密房等于不存在。 */
  var hint = '走到门口就过去，或点小地图';
  var warn = false;
  if (sess.wallsNow.length) {
    var names = [];
    for (var w = 0; w < sess.wallsNow.length; w++) names.push(DIR_NAME[sess.wallsNow[w].dir]);
    hint = '⚠ ' + names.join('/') + ' 墙上有裂纹 —— 打穿它';
    warn = true;
  } else if (cur && !cur.cleared) {
    hint = '门锁着：先把这一间清干净';
  } else if (cur && cur.type === Dungeon.BOSS_TYPE) {
    hint = '打完这一间就下一层';
  }
  el.mmHint.className = 'mm-hint' + (warn ? ' warn' : '');
  setText('mmh', el.mmHint, hint);
}

/** 关底血条：场上最大的那只怪就是关底（`def.boss`）。
    刻意**不**在怪头上画小血条（3 倍体型下既看不清也说不清"这是关底"），
    统一走屏幕上方这条；没有关底时整条收起来。 */
var _bossSig = '';
function updateBossBar(sess) {
  if (!el.bossBar) return;
  var boss = null;
  for (var i = 0; i < sess.enemies.length; i++) {
    if (sess.enemies[i].def.boss && !sess.enemies[i].dead) { boss = sess.enemies[i]; break; }
  }
  if (!boss) {
    if (_bossSig !== '') { el.bossBar.classList.add('hidden'); _bossSig = ''; }
    return;
  }
  el.bossBar.classList.remove('hidden');
  var k = U.clamp(boss.hp / boss.maxHp, 0, 1);
  setWidth('bossfill', el.bossFill, U.pct1(k) + '%');
  setText('bosshp', el.bossHp, Math.max(0, Math.ceil(boss.hp)) + ' / ' + Math.round(boss.maxHp));
  var sig = boss.def.id + (boss.burrowed ? '|burrow' : '');
  if (sig !== _bossSig) {
    _bossSig = sig;
    setText('bossname', el.bossName, boss.def.name + (boss.burrowed ? '（钻地中）' : ''));
  }
}

UI.updateHud = function () {
  var sess = Game.getSession();
  if (!sess) return;
  var p = sess.player, s = sess.stats;
  var h = hudNodes;

  var hpK = U.clamp(p.hp / s.maxHp, 0, 1);
  setWidth('hpw', h.hpFill, U.pct1(hpK) + '%');
  setText('hpt', h.hpText, Math.ceil(p.hp) + ' / ' + s.maxHp);

  setText('wave', h.wave, Game.wave);
  var t = sess.waveLeft;
  setText('timer', h.timer, (t > 0 ? Math.ceil(t) + 's' : (sess.enemies.length ? '清场 ' + sess.enemies.length : '通关')));

  setText('lvl', h.level, p.level);
  setText('xp', h.xp, Math.floor(p.xp) + '/' + p.xpNeed);
  setWidth('xpw', h.xpFill, U.pct1(U.clamp(p.xp / p.xpNeed, 0, 1)) + '%');

  setText('mats', h.mats, Math.floor(p.scrap || 0));
  setText('kills', h.kills, sess.stats_total.kills);
  setText('speed', h.speed, Game.speed + 'x');
  setText('fps', h.fps, Perf.fps ? Perf.fps.toFixed(0) : '--');

  // 所在：层 + 房型（房间制之后"第几波"已经不足以说明你在哪）
  var room = sess.map ? Dungeon.roomById(sess.map, sess.roomId) : null;
  var typeDef = room ? Dungeon.TYPE_BY_ID[room.type] : null;
  setText('room', h.room, typeDef ? typeDef.icon + ' ' + typeDef.name : '—');
  setText('floor', h.floor, sess.floor + 'F');
  updateMinimap(sess);
  updateBossBar(sess);

  // 武器槽
  var strip = el.weaponStrip;
  if (strip.childElementCount !== Game.cfg.maxWeapons) {
    U.clear(strip);
    for (var i = 0; i < Game.cfg.maxWeapons; i++) {
      strip.appendChild(U.el('div', 'wslot empty'));
    }
  }
  for (var k = 0; k < Game.cfg.maxWeapons; k++) {
    var slot = strip.children[k] as HTMLElement;
    var w = p.weapons[k];
    if (!w) {
      if (!slot.classList.contains('empty')) { U.clear(slot); slot.classList.add('empty'); slot.title = ''; slot.dataset.wid = ''; }
      continue;
    }
    if (slot.dataset.wid !== w.id + ':' + Weapons.tierOf(w)) {
      U.clear(slot);
      slot.classList.remove('empty');
      slot.dataset.wid = w.id + ':' + Weapons.tierOf(w);
      var size = 40;
      var wc = S.domCanvas(size, size);
      var cv = wc ? wc.canvas : document.createElement('canvas');
      var cx = wc ? wc.ctx : cv.getContext('2d');
      if (!wc) { cv.width = size; cv.height = size; }
      cx.translate(size / 2, size / 2);
      cx.scale(0.52, 0.52);
      S.drawWeapon(cx, w.def.kind, -Math.PI / 5, w.def.tints, 0, 1);
      slot.appendChild(cv);
      /* 品级角标：只在 T2+ 出现 —— T1 是默认，给它也点一个点只是噪音。
         这是**战斗**那一环唯一"一眼看出合成生效了"的地方：
         商店之外，玩家盯着的是这个武器条。 */
      var wt = Weapons.tierOf(w);
      if (wt > 1) slot.appendChild(U.el('i', 'pip ' + Tiers.clsOf(wt)));
      slot.title = w.def.name + ' T' + wt +
        (wt > 1 ? '（伤害 ×' + Weapons.mul(w, 'dmg').toFixed(2) + '）' : '');
    }
  }
};

/* =========================================================
   Toast
   ========================================================= */
UI.toast = function (msg, kind) {
  var t = U.el('div', 'toast' + (kind ? ' ' + kind : ''), msg);
  el.toastWrap.appendChild(t);
  setTimeout(function () {
    if (t.parentNode) t.parentNode.removeChild(t);
  }, 1500);
  /* 最多**两条**。以前是 5 —— 一条 toast 34px，5 条加上间隙就是 194px 的一摞，
     正好糊在屏幕中下方（菜单按钮 / 武器条都在那一带）。实机量过：
     两条时"压住按钮"最坏 37px，五条会直接把整排按钮盖掉。 */
  while (el.toastWrap.childElementCount > 2) el.toastWrap.removeChild(el.toastWrap.firstChild);
};

/* =========================================================
   商店
   ========================================================= */
/* 档位名字与颜色类**只住在 data_tiers.ts**：以前这里有两个数组副本
   （'普通/精良/稀有/传说'），加一档时界面会把它显示成空白。 */
function tierName(t) { return Tiers.nameOf(t); }

function weaponCard(offer, idx) {
  var d = offer.def;
  /* 货架上的档位取自**报价**而不是 def：据点的「工坊」会把某一件抬到更高档
     （见 market.ts 的结构性解锁），而 def.tier 只是"这把武器通常出现在哪一档"。 */
  var otier = Weapons.clampTier(offer.tier || d.tier);
  var tcls = Tiers.clsOf(otier);
  var card = U.el('div', 'card ' + tcls);
  card.dataset.offer = idx;
  var tier = U.el('div', 'tier ' + tcls, 'T' + otier + ' ' + tierName(otier));
  card.appendChild(tier);

  var cs = 62;
  var wcc = S.domCanvas(cs, cs);
  var cv = wcc ? wcc.canvas : document.createElement('canvas');
  var cx = wcc ? wcc.ctx : cv.getContext('2d');
  if (!wcc) { cv.width = cs; cv.height = cs; }
  cx.translate(cs / 2 - 6, cs / 2);
  cx.scale(0.76, 0.76);
  S.drawWeapon(cx, d.kind, -Math.PI / 9, d.tints, 0, 1);
  var wrap = U.el('div', 'cv');
  wrap.appendChild(cv);
  card.appendChild(wrap);

  card.appendChild(U.el('div', 'nm', d.name));
  card.appendChild(U.el('div', 'en', d.en + ' · ' + (d.type === 'melee' ? '近战' : '远程')));

  var edmg = d.dmg * Weapons.mulFor(d, otier, 'dmg');
  var ecd = d.cd * Weapons.mulFor(d, otier, 'cd');
  var dps = (edmg / ecd).toFixed(1);
  var info = '<div>伤害 ' + (Math.round(edmg * 10) / 10) + ' · 冷却 ' + ecd.toFixed(2) + 's</div>';
  info += '<div>射程/范围 ' + Math.round(d.reach * Weapons.mulFor(d, otier, 'reach')) + ' · 击退 ' +
    Math.round((d.knock || d.kb || 0) * Weapons.mulFor(d, otier, 'knock')) + '</div>';
  /* 细节行**合并**：穿透 / 弹丸 / 爆炸 / 元素以前各占一行，一张卡能长到 6 行 ——
     而货架那 215px 直接决定了下面「我的武器」还剩多少地方（实测：它把
     武器联动那一行顶到了滚动区外面）。信息一行不少，行数少一半。 */
  /* 穿透用**同一处规则**（`Weapons.pierceBonus`）：以前这里把"+1 穿透"的规则
     又抄了一遍，还是写死 `otier >= TIER_MAX ? 1 : 0` —— 加一档就会显示错的数。 */
  var epierce = (d.pierce || 0) + Weapons.pierceBonus({ id: d.id, def: d, cd: 0, swing: 0, tier: otier });
  var bits = [];
  if (epierce) bits.push('穿透 ' + (epierce > 90 ? '无限' : epierce));
  if (d.shots) bits.push('弹丸 ' + d.shots + ' 发');
  if (d.blast) bits.push('爆炸 ' + d.blast);
  if (d.element) bits.push('元素：' + Elems.nameOf(d.element));
  if (bits.length) info += '<div>' + bits.join(' · ') + '</div>';
  /* 买下来会发生什么，提前说清楚 —— 这是"武器槽满了"这个拒绝最容易被误解的地方：
     玩家的心智是"格子满了买不了"，而实际规则是"满了就**并进去**"。
     **只说一行**：以前这里每个卡片各写两三行（"槽位已满：买下会与第 N 格合并 → T3"），
     四张卡一起把货架撑到 215px，正好把下面的"我的武器"挤成 70px 的滚动框。
     现在完整规则写在「我 的 武 器」那一行的标题里，卡片只留一句短的。 */
  var sess = Game.getSession();
  if (sess && sess.player) {
    var full = sess.player.weapons.length >= Game.cfg.maxWeapons;
    var mate = Weapons.partnerOf(sess.player.weapons, { id: d.id, def: d, cd: 0, swing: 0, tier: otier }, -1);
    if (full) {
      info += mate >= 0 && otier < Weapons.TIER_MAX
        ? '<div class="buff">买下即与第 ' + (mate + 1) + ' 格合并 → T' + (otier + 1) + '</div>'
        : '<div class="nerf">槽满且无法合并</div>';
    }
  }
  /* 词条在**这一件**上（不是这一类）：前缀 / 后缀各写自己那一行。
     它是"这件比那件值不值这个价"的唯一依据，所以必须画在卡片里 ——
     塞进 title 提示等于没画（触屏上根本没有 hover）。 */
  var wAffix = affixHtml(offer.affixes);
  if (wAffix) info += wAffix;
  card.appendChild(U.el('div', 'ds', info));

  card.appendChild(U.el('div', 'pr',
    '<span>废料 ' + offer.price + '</span><span style="opacity:.55">DPS ' + dps + '</span>'));

  if (offer.sold) card.classList.add('sold');
  card.addEventListener('click', function () {
    if (offer.sold) return;
    if (Game.buyOffer(idx)) renderShop();
  });
  return card;
}

/**
 * 一套词条的 HTML（**界面唯一的词条渲染处**）。
 * 文案来自 `Affixes.html`（表里的 `text` 函数），这里只做拼接 ——
 * 于是"加一条词条"在界面侧需要改动的是 **0 行**。
 * @param set 词条集合（可能是 null：老对象 / 还没生成的装备）
 */
function affixHtml(set) {
  var list = (set && set.list) ? set.list : [];
  var out = '';
  for (var i = 0; i < list.length; i++) out += Affixes.html(list[i]);
  return out;
}
/** 词条的纯文本（title 提示用；与上面的 HTML 同一份文案来源） */
function affixText(set) {
  var lines = Affixes.lines(set);
  return lines.length ? '\n词条：' + lines.join('　') : '';
}

/**
 * **代价行**（界面唯一的一处）：把一件道具的"失"渲染成红色几行。
 *
 * 两类来源合在一起，因为对玩家来说它们都是"我为它付了什么"：
 *   · 属性型的代价（`stats` 里的负值）—— 由 `Stats.describe` 分出来
 *   · 结构化的代价（`codec` / 敌人 / 规则）—— 文案来自 `Items.COST_KINDS`
 *     （**不是**在这里再写一份；界面只负责拼装与着色）
 * @param d 道具定义
 * @param losses `Stats.describe` 里 `good === false` 的那几行
 */
function lossLines(d, losses) {
  var html = '';
  for (var i = 0; i < losses.length; i++) {
    html += '<div class="nerf">' + losses[i].label + ' ' + losses[i].text + '</div>';
  }
  var kinds = Items.COST_KINDS;
  var cost = d.cost || {};
  for (var k in cost) {
    if (!Object.prototype.hasOwnProperty.call(cost, k)) continue;
    var def = kinds[k];
    if (!def) continue;
    var v = Number(cost[k]);
    var txt;
    if (def.how === 'add') txt = def.note;
    else if (v >= 1) txt = def.note + ' ×' + v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    else txt = def.note + ' ×' + v.toFixed(2);
    html += '<div class="nerf">' + txt + '</div>';
  }
  return html;
}

function itemCard(offer, idx) {
  var d = offer.def;
  var card = U.el('div', 'card');
  card.dataset.offer = idx;
  card.appendChild(U.el('div', 'tier ' + Tiers.clsOf(d.tier), 'T' + d.tier + ' ' + tierName(d.tier)));

  var wrap = U.el('div', 'cv');
  var ic = S.itemIcon(d.icon, d.tint, 58);
  if (ic) { ic.canvas.style.width = ic.width + 'px'; ic.canvas.style.height = ic.height + 'px'; wrap.appendChild(ic.canvas); }
  card.appendChild(wrap);

  card.appendChild(U.el('div', 'nm', d.name));
  card.appendChild(U.el('div', 'en', d.en));

  /* 收益与代价**分两段**列出来（`.buff` 绿 / `.nerf` 红）：
     这是"有得有失"在界面上唯一能被读出来的地方 —— 如果它们混在一行里，
     玩家看到的就是一串数字，而不是一次取舍。
     `Stats.describe` 已经按正负分了 good，所以属性型的代价（负 stats）
     自动落在红那一类；下面再把 `cost` 里那三类（经济 / 敌人 / 规则）翻译成人的话。 */
  var rows = Stats.describe(d.stats || {});
  var gains = rows.filter(function (r) { return r.good; });
  var losses = rows.filter(function (r) { return !r.good; });
  var html = gains.map(function (r) {
    return '<div class="buff">' + r.label + ' ' + r.text + '</div>';
  }).join('');
  /* 词条（affixes.ts）：**这一件**身上的随机加成。
     货架上的每一件按品级滚 1~3 条，所以"这件 T2 值不值这个价"第一次有答案。
     文案全部来自词条表（`Affix.html` 只包一层颜色），界面不写第二份。 */
  html += affixHtml(offer.affixes);
  if (!html) html = '<div style="opacity:.65">' + d.desc + '</div>';
  else if (d.special) html += '<div class="buff">' + d.desc + '</div>';
  var costHtml = lossLines(d, losses);
  if (costHtml) html += costHtml;
  card.appendChild(U.el('div', 'ds', html));

  card.appendChild(U.el('div', 'pr', '<span>废料 ' + offer.price + '</span><span style="opacity:.55">道具</span>'));
  if (offer.sold) card.classList.add('sold');
  card.addEventListener('click', function () {
    if (offer.sold) return;
    if (Game.buyOffer(idx)) renderShop();
  });
  return card;
}

/**
 * 层间契约：打完 Boss 之后在商店里挑一条（**不可撤销**）。
 * 只在有候选时出现；挑完就收起 —— 它不是常驻面板，而是"两层之间那一次决定"。
 * 文案全部来自 boons.ts（键自带 note），这里只做布局。
 */
function renderBoonPick(sess) {
  if (!el.shopBoons) return;
  var choices = Game.boonChoices();
  var picked = Game.boonId();
  if (!choices.length && !picked) { el.shopBoons.hidden = true; U.clear(el.shopBoons); return; }
  el.shopBoons.hidden = false;
  U.clear(el.shopBoons);
  if (choices.length) {
    el.shopBoons.appendChild(U.el('div', 'col-h', '层 间 契 约（只能挑一条，挑完不可改）'));
    var row = U.el('div', 'boon-row');
    choices.forEach(function (id) {
      var def = Boons.BY_ID[id];
      if (!def) return;
      var card = U.el('button', 'boon-card');
      card.dataset.act = 'boon-pick';
      card.dataset.boon = id;
      card.appendChild(U.el('div', 'bn-name', def.name));
      card.appendChild(U.el('div', 'bn-note', def.note));
      card.appendChild(U.el('div', 'bn-eff', Boons.lines(id).join(' · ')));
      row.appendChild(card);
    });
    el.shopBoons.appendChild(row);
  } else {
    var d = Boons.BY_ID[picked];
    el.shopBoons.appendChild(U.el('div', 'col-h',
      '这一层的契约：' + (d ? d.name + '（' + Boons.lines(picked).join(' · ') + '）' : picked)));
  }
}

/**
 * "自己选房间"：把这一间的门画成可点的按钮（Hades / 以撒那种）。
 *
 * 规则全在 `Game.doors()` 里（有没有门 / 锁没锁 / 暗门破没破），
 * 界面**不重复判断、也不按房型 id 分支** —— 房型名与图标来自 dungeon.ts 的房型表。
 * 走不了的门也画出来，但禁用并把原因写在 title 上：
 * 藏起来玩家会以为地图画错了。
 */
function renderDoors(host, sess) {
  if (!host) return;
  U.clear(host);
  if (!sess) return;
  var list = Game.doors ? Game.doors() : [];
  host.appendChild(U.el('span', 'door-head', list.length ? '门：自己挑一间' : '这里没有别的门'));
  list.forEach(function (d) {
    var b = U.el('button', 'btn door' + (d.open ? '' : ' shut'), d.icon + ' ' + d.name);
    if (d.open) {
      b.dataset.act = 'enter-room';       // 与"走到门口就过去"是同一条路、同一套校验
      b.dataset.dir = String(d.dir);
      b.title = '走过去：' + d.name;
    } else {
      (b as HTMLButtonElement).disabled = true;
      b.title = d.why;
    }
    host.appendChild(b);
  });
}

function renderShop() {
  var sess = Game.getSession();
  if (!sess) return;
  el.shopMats.textContent = String(Math.floor(sess.player.scrap || 0));
  el.shopWave.textContent = '· 第 ' + Game.wave + ' 间结束 · ' + sess.floor + 'F';
  el.rerollCost.textContent = '(' + sess.rerollCost + ')';
  renderDoors(el.shopDoors, sess);
  renderBoonPick(sess);

  // 宿主容器（用于挂载"我的武器/道具"子分区）
  var weaponHost = el.shopWeapons.parentNode || el.shopWeapons;
  var itemHost = el.shopItems.parentNode || el.shopItems;

  U.clear(el.shopWeapons);
  U.clear(el.shopItems);
  for (var i = 0; i < sess.offers.length; i++) {
    var o = sess.offers[i];
    var card = o.type === 'weapon' ? weaponCard(o, i) : itemCard(o, i);
    (o.type === 'weapon' ? el.shopWeapons : el.shopItems).appendChild(card);
  }

  /* 已携带武器（可合成 / 可回收）
     ---------------------------------------------------------
     **为什么是这种小格子，而不是之前那种大卡片**：实测过一版大卡片（137×213，
     与货架同款），六把武器在 1.6fr 那一列里排成**两行 438px** ——
     而整个 shop-cols 只有 427px。于是"我的武器"被压成一个 ~70px 高的滚动框：
     卡片只露出图标和名字，**伤害行与「合并」按钮全在框外**，玩家永远找不到它。
     （量出来的证据：`#my-weapons` 高 70px，而里面的 .card 高 213px。）
     小格子（96×107）六把排一行只要 616px，信息密度换的是"看得见"：
     图标 + 品级 + 名字（详情进 title 提示）+ 两个动作按钮。 */
  var extra = U.$('#my-weapons');
  if (!extra) {
    extra = U.el('div', 'shop-sub');
    extra.id = 'my-weapons';
    weaponHost.appendChild(extra);
  }
  U.clear(extra);
  var plans = Game.combinePlans();
  var fullSlots = sess.player.weapons.length >= Game.cfg.maxWeapons;
  var holder = sess.player.weapons.length ? -1 : 0;
  for (var pw = 0; pw < plans.length && holder < 0; pw++) holder = plans[pw].i;
  extra.appendChild(U.el('div', 'col-h', '我 的 武 器' +
    (sess.combineCount ? '（合成 ×' + sess.combineCount + '）' : '') +
    /* 槽位满了这件事**只在这里说一次**（以前写在每一张货架卡上）：
       一句话讲清楚"买同名同档的会并进去"，而不是让四张卡各重复两行。 */
    (fullSlots
      ? '（槽位已满：买同名同档的会与第 ' + (holder + 1) + ' 格合并 → 高一档）'
      : '（同名同档的两把可合并 → 高一档）')));
  var wrow = U.el('div', 'wrow');
  sess.player.weapons.forEach(function (w, idx) {
    var t = Weapons.tierOf(w);
    var dmg = Math.round(w.def.dmg * Weapons.mul(w, 'dmg'));
    var cd = (w.def.cd * Weapons.mul(w, 'cd')).toFixed(2);
    var reach = Math.round(w.def.reach * Weapons.mul(w, 'reach'));
    var b = U.el('div', 'wbox ' + Tiers.clsOf(t));
    b.appendChild(U.el('div', 'tier ' + Tiers.clsOf(t), 'T' + t));
    var wc2 = S.domCanvas(40, 40);
    var cv = wc2 ? wc2.canvas : document.createElement('canvas');
    var cx = wc2 ? wc2.ctx : cv.getContext('2d');
    if (!wc2) { cv.width = 40; cv.height = 40; }
    cx.translate(20, 20);
    cx.scale(0.5, 0.5);
    S.drawWeapon(cx, w.def.kind, -Math.PI / 9, w.def.tints, 0, 1);
    b.appendChild(cv);
    b.appendChild(U.el('div', 'nm', w.def.name));
    /* 自己的武器也要**看得见词条**（不只是货架上）：它们是这一局的随机产物，
       而"我这把是锋锐 3 还是残暴 1"是"要不要把它当燃料"的唯一依据。
       title 里给全量文案（小格子放不下），格子里只放短行。 */
    var aHtml = affixHtml(w.affixes);
    if (aHtml) b.appendChild(U.el('div', 'ds', aHtml));
    b.title = w.def.name + ' T' + t + '（' + tierName(t) + '）\n伤害 ' + dmg +
      ' · 冷却 ' + cd + 's · 射程 ' + reach +
      affixText(w.affixes) +
      '\n回收 +' + Game.salvageOf(w) + ' 废料';
    var acts = U.el('div', 'acts');
    var pi = -1;
    for (var pi2 = 0; pi2 < plans.length; pi2++) if (plans[pi2].i === idx) pi = pi2;
    if (pi >= 0) {
      var pl = plans[pi];
      if (pl.locked) {
        /* 顶档锁着：**画出来但按不动**，理由写在按钮上。
           直接不画会让"顶档要图纸"变成一条玩家永远看不到的规则 ——
           而它恰好是养成那一侧在战斗里唯一能被感觉到的地方。 */
        var bl = U.el('button', 'btn tiny dim', '合 并（需图纸）');
        (bl as HTMLButtonElement).disabled = true;
        bl.title = pl.why;
        acts.appendChild(bl);
      } else {
        var bc = U.el('button', 'btn tiny', '合 并');
        bc.dataset.act = 'combine';
        bc.dataset.i = String(pl.i);
        bc.dataset.j = String(pl.j);
        /* 合出什么写在提示里。**合金不在这里了**（这一步改的）：
           合金现在只从**回收**来 —— 合成是把已有装备加工一下，不产新东西。 */
        bc.title = '与第 ' + (pl.j + 1) + ' 格的同名武器合并（T' + pl.partnerTier + '）→ T' + pl.to +
          '（伤害 ×' + pl.dmgMul.toFixed(2) + '，少占一格）';
        acts.appendChild(bc);
      }
    }
    /* 最后一把武器不许回收：按钮**画出来但按不动**，理由写在按钮上
       （与上面「合 并（需图纸）」同一个做法）。为什么不干脆不画：
       玩家会以为"回收"这个功能时有时无；写清楚才知道这是规则，
       也才知道"再买一把就能回收旧的"。规则本身在 market.sellWeapon。 */
    if (sess.player.weapons.length <= 1) {
      var bsLast = U.el('button', 'btn tiny dim', '回 收');
      (bsLast as HTMLButtonElement).disabled = true;
      bsLast.title = '这是最后一把武器 —— 回收掉就没有东西能打，这一间再也清不掉（先买一把再来回收）';
      acts.appendChild(bsLast);
    } else {
      var bs = U.el('button', 'btn tiny', '回 收');
      bs.dataset.act = 'salvage';
      bs.dataset.i = String(idx);
      bs.title = '低价卖回：+' + Game.salvageOf(w) + ' 废料（返还 ' +
        Number(U.pct((Game.getSession() && Game.getSession().salvageRate) || Weapons.salvageRate)) +
        '% 的当前价值，含品级）—— 同时产出**合金**，那是图纸树唯一的稳定来源';
      acts.appendChild(bs);
    }
    b.appendChild(acts);
    wrow.appendChild(b);
  });
  for (var s = sess.player.weapons.length; s < Game.cfg.maxWeapons; s++) {
    var eb = U.el('div', 'wbox empty');
    eb.appendChild(U.el('div', 'nm', '空'));
    eb.title = '空武器槽：在货架上买一把填进来';
    wrow.appendChild(eb);
  }
  extra.appendChild(wrow);

  // 已有道具（只读）：同款小格子（道具本来就不能操作，大卡片只是占地方）
  var itemsBox = U.$('#my-items');
  if (!itemsBox) {
    itemsBox = U.el('div', 'shop-sub');
    itemsBox.id = 'my-items';
    itemHost.appendChild(itemsBox);
  }
  U.clear(itemsBox);
  itemsBox.appendChild(U.el('div', 'col-h', '我 的 道 具（' + sess.player.items.length + '）'));
  var irow = U.el('div', 'wrow');
  if (!sess.player.items.length) {
    irow.appendChild(U.el('div', 'wbox empty', '<div class="nm">还没有道具</div>'));
  }
  sess.player.items.forEach(function (it) {
    var c = U.el('div', 'wbox item');
    var ic = S.itemIcon(it.def.icon, it.def.tint, 36);
    if (ic) { ic.canvas.style.width = ic.width + 'px'; ic.canvas.style.height = ic.height + 'px'; c.appendChild(ic.canvas); }
    c.appendChild(U.el('div', 'nm', it.def.name));
    var iHtml = affixHtml(it.affixes);
    if (iHtml) c.appendChild(U.el('div', 'ds', iHtml));
    c.title = it.def.name + ' · T' + it.def.tier + ' ' + tierName(it.def.tier) +
      affixText(it.affixes) + '\n' + (it.def.desc || '');
    irow.appendChild(c);
  });
  itemsBox.appendChild(irow);

  /* 武器联动：把四条轴的**进度**画出来（规则在 synergy.ts，界面只翻译）。
     只显示"已经触发"的会让人不知道自己离下一档差几件，所以整条轴都画。
     **默认折叠**：这一块是参考资料，不是操作；展开时它自己那一段变长，
     列可以滚 —— 但折叠状态下它只占一行，买 / 合 / 卖才有地方站。 */
  var synBox = U.$('#my-synergy');
  if (!synBox) {
    synBox = U.el('div', 'shop-sub');
    synBox.id = 'my-synergy';
    weaponHost.appendChild(synBox);
  }
  U.clear(synBox);
  var rows = Synergy.progress(sess.player.weapons.map(function (w) { return w.def; }));
  var synHit = rows.filter(function (r) { return r.tier; });
  var synBtn = U.el('button', 'btn tiny sub-h', '武 器 联 动 ' + (UI.showSyn ? '▾' : '▸') +
    '　' + (synHit.length
      ? synHit.map(function (r) { return r.valueName + '【' + r.tier.title + '】'; }).join(' · ')
      : '（还没触发任何一档）'));
  synBtn.dataset.act = 'toggle-syn';
  synBtn.title = '把四条家族轴的进度铺开看（每一档差几件）';
  synBox.appendChild(synBtn);
  if (UI.showSyn) {
    var sList = U.el('div', 'settings');
    if (!rows.length) {
      sList.appendChild(U.el('div', 'set-row', '<span class="set-label" style="opacity:.7">（还没有武器）</span>'));
    }
    rows.forEach(function (r) {
      var label = r.valueName + ' ×' + r.count;
      var txt = r.tier
        ? '【' + r.tier.title + '】' + r.tier.text
        : '再拿 ' + r.need + ' 件 → ' + r.next.title + '：' + r.next.text;
      sList.appendChild(U.el('div', 'set-row',
        '<span class="set-label">' + label + '<br><span class="camp-combo">' + r.axisName + '</span></span>' +
        '<span class="set-value">' + txt + '</span>'));
    });
    synBox.appendChild(sList);
  }

  /* 道具套装：与武器联动同一套画法（同一份表结构），只是数据源换成道具。
     件数为 0 的套装也列出来 —— 否则玩家永远不知道"这几件是一套"。同样默认折叠。 */
  var setBox = U.$('#my-itemset');
  if (!setBox) {
    setBox = U.el('div', 'shop-sub');
    setBox.id = 'my-itemset';
    itemHost.appendChild(setBox);
  }
  U.clear(setBox);
  var setRows = Synergy.setProgress(sess.player.items.map(function (it) { return it.def; }));
  var setHit = setRows.filter(function (r) { return r.tier; });
  var setBtn = U.el('button', 'btn tiny sub-h', '道 具 套 装 ' + (UI.showSet ? '▾' : '▸') +
    '　' + (setHit.length
      ? setHit.map(function (r) { return r.valueName + '【' + r.tier.title + '】'; }).join(' · ')
      : '（还没凑出任何一套）'));
  setBtn.dataset.act = 'toggle-set';
  setBtn.title = '把四套道具的进度铺开看（每一档差几件）';
  setBox.appendChild(setBtn);
  if (UI.showSet) {
    var setList = U.el('div', 'settings');
    if (!setRows.length) {
      setList.appendChild(U.el('div', 'set-row', '<span class="set-label" style="opacity:.7">（还没有套装）</span>'));
    }
    setRows.forEach(function (r) {
      var label = r.valueName + ' ×' + r.count;
      var txt = r.tier
        ? '【' + r.tier.title + '】' + r.tier.text
        : '再拿 ' + r.need + ' 件 → ' + r.next.title + '：' + r.next.text;
      setList.appendChild(U.el('div', 'set-row',
        '<span class="set-label">' + label + '</span>' +
        '<span class="set-value">' + txt + '</span>'));
    });
    setBox.appendChild(setList);
  }

  q('btn-lock').textContent = sess.shopLocked ? '已 锁 定' : '锁 定 商 店';

  // 随机道具包：价格与概率都由 data_items.ts 统一算出（价格 = 基准期望值 × 折扣）
  var mats = sess.player.scrap || 0;
  var basicCost = Game.packPrice('basic');
  var deluxeCost = Game.packPrice('deluxe');
  var deluxeOk = Items.packAvailable(Game.wave, 'deluxe');
  el.packBasicCost.textContent = '(' + basicCost + ')';
  el.packDeluxeCost.textContent = deluxeOk ? '(' + deluxeCost + ')' : '第 3 波解锁';
  el.packOdds.textContent = '普通 ' + Game.packOdds('basic') +
    (deluxeOk ? '　·　高级 ' + Game.packOdds('deluxe') : '');
  (el.btnPackBasic as HTMLButtonElement).disabled = mats < basicCost;
  (el.btnPackDeluxe as HTMLButtonElement).disabled = !deluxeOk || mats < deluxeCost;
  // 建材包（商店的"原料"栏）：废料换工坊的本钱
  var buildCost = Game.buildPrice();
  if (el.packBuildCost) el.packBuildCost.textContent = '(' + buildCost + ')';
  if (el.btnPackBuild) (el.btnPackBuild as HTMLButtonElement).disabled = mats < buildCost;
}

/* =========================================================
   升级卡
   ========================================================= */
function renderLevelCards() {
  var sess = Game.getSession();
  if (!sess) return;
  U.clear(el.levelCards);
  sess.levelCards.forEach(function (card, i) {
    var c = U.el('div', 'card');
    var rows = Stats.describe((function () { var o = {}; o[card.key] = card.amt; return o; })());
    var r = rows[0];
    c.appendChild(U.el('div', 'nm', r.label + ' ' + r.text));
    c.appendChild(U.el('div', 'ds',
      '<div>' + descFor(card.key) + '</div>' +
      '<div style="opacity:.7;margin-top:6px">当前：' + Stats.pretty(card.key, sess.stats[card.key]) + '</div>'));
    c.appendChild(U.el('div', 'pr', '<span>等级提升</span><span style="opacity:.55">' + (i + 1) + ' 号键</span>'));
    c.addEventListener('click', function () {
      Game.chooseLevelCard(i);
      UI.refresh();
    });
    el.levelCards.appendChild(c);
  });
}

function descFor(key) {
  var map = {
    maxHp: '提高生命上限，容错更高。',
    hpRegen: '持续恢复生命，长线战斗更稳。',
    damage: '所有武器伤害的通用倍率。',
    meleeDmg: '近战武器额外伤害。',
    rangedDmg: '远程武器额外伤害。',
    elementalDmg: '元素武器的额外伤害。',
    attackSpeed: '缩短所有武器的冷却。',
    critChance: '暴击造成 185% 伤害。',
    armor: '护甲减伤，收益递减。',
    dodge: '概率完全闪避一次伤害。',
    speed: '移动速度，走位的本钱。',
    luck: '幸运：影响掉落与商店价格。',
    harvesting: '收获：废料获取量提升。',
    pickupRange: '拾取范围：更远吸附废料。',
    range: '攻击范围：武器射程与近战半径。',
    lifesteal: '造成伤害时按比例回血。',
    engineering: '工程学：强化炮塔类武器。'
  };
  return map[key] || '';
}

/* =========================================================
   暂停统计
   ========================================================= */
UI.renderPause = function () {
  var sess = Game.getSession();
  if (!sess) return;
  var s = sess.stats;
  var rows = [
    ['最大生命', s.maxHp], ['生命回复', U.round2(s.hpRegen)],
    ['生命窃取', Stats.pretty('lifesteal', s.lifesteal)],
    ['伤害', Stats.pretty('damage', s.damage)],
    ['近战伤害', s.meleeDmg], ['远程伤害', s.rangedDmg], ['元素伤害', s.elementalDmg],
    ['攻击速度', Stats.pretty('attackSpeed', s.attackSpeed)],
    ['暴击率', Stats.pretty('critChance', s.critChance)],
    ['护甲', s.armor], ['闪避', Stats.pretty('dodge', s.dodge)],
    ['移动速度', Stats.pretty('speed', s.speed)],
    ['幸运', s.luck], ['收获', s.harvesting],
    ['拾取范围', s.pickupRange], ['攻击范围', Stats.pretty('range', s.range)],
    ['工程学', s.engineering],
    ['开出道具包', sess.packsOpened || 0],
    ['击杀 / 累计伤害', sess.stats_total.kills + ' / ' + U.fmtNum(sess.stats_total.dmg)]
  ];
  var html = '';
  rows.forEach(function (r) {
    html += '<div class="k">' + r[0] + '</div><div class="v">' + r[1] + '</div>';
  });
  el.pauseStats.innerHTML = html;
  renderSettings();
};

/* =========================================================
   破坏性操作的二次确认
   不引入 window.confirm（阻塞式、样式不可控、桌面外壳里体验割裂），
   而是"同一个按钮点两次"：第一次把文案换成确认语并起 3 秒倒计时，
   超时自动复位。这样不需要新的对话框系统，也不会多出 data-act 契约。
   ========================================================= */
var _armedKey = '';
var _armedTimer = null;

function armed(key, onLabel) {
  if (_armedKey === key) {
    _armedKey = '';
    if (_armedTimer) { clearTimeout(_armedTimer); _armedTimer = null; }
    refreshConfirmLabels();
    return true;                       // 第二次点击：放行
  }
  _armedKey = key;
  if (_armedTimer) clearTimeout(_armedTimer);
  _armedTimer = setTimeout(function () {
    _armedKey = '';
    _armedTimer = null;
    refreshConfirmLabels();
  }, 3000);
  refreshConfirmLabels();
  if (onLabel) onLabel();
  return false;
}

/** 把两个"待确认"按钮的文案同步到当前武装状态 */
function refreshConfirmLabels() {
  var r = q('set-reset');
  if (r) r.textContent = _armedKey === 'reset' ? '再点一次确认清空' : '清空存档与记录';
  var qt = q('btn-quit');
  if (qt) qt.textContent = _armedKey === 'quit' ? '再点一次确认放弃' : '放 弃 本 局';
}

/* =========================================================
   改键
   流程是"点一下 → 按下想用的键"：捕获期间那一次按键**不会**同时被当成游戏输入
   （否则改"上"的时候角色会先往上走一步）。Esc 取消。
   ========================================================= */
// 可改键位的清单只有一份来源（input.ts 的表），这里不抄第二份
var BIND_KEYS = Object.keys(Input.bindFields());
var _rebindKey = '';

/** 键名 → 给人看的短标签 */
function keyLabel(k) {
  if (k === 'space') return '空格';
  if (k === 'shift') return 'Shift';
  if (k === 'enter') return '回车';
  if (k === 'esc') return 'Esc';
  if (k === 'tab') return 'Tab';
  var arrows: Record<string, string> = { arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→' };
  if (arrows[k]) return arrows[k];
  return String(k || '?').toUpperCase();
}

function startRebind(key) {
  if (BIND_KEYS.indexOf(key) < 0) return;
  _rebindKey = key;
  renderSettings();
  if (Sfx) Sfx.click();
  Input.captureNext(function (k) {
    _rebindKey = '';
    if (k === null) { renderSettings(); UI.toast('已取消改键', ''); return; }
    // 同一个键绑两个动作 = 两个动作一起触发，几乎总是手滑
    var clash = '';
    BIND_KEYS.forEach(function (other) {
      if (other !== key && Settings.get(other) === k) clash = other;
    });
    if (clash) {
      renderSettings();
      UI.toast('这个键已经绑给「' + Settings.def(clash).label + '」了', 'warn');
      return;
    }
    Settings.set(key, k);
    renderSettings();
    UI.toast('「' + Settings.def(key).label + '」已改为 ' + keyLabel(k), 'good');
  });
}

/* =========================================================
   设置面板
   控件写死在 index.html（静态 id 契约），这里只按 settings 表填值。
   ========================================================= */
/**
 * 换槽位之后要做的事：**重新读一遍这一槽的档案**，然后刷新所有依赖它的界面。
 *
 * 为什么集中在 `ui.ts` 而不是让 `slots.ts` 自己去 profile 里戳：
 * `slots.ts` 只认识"键名与一段文本"（见它的文件头），它**不该**认识
 * Profile / Save / Score 的字段 —— 那样一改档案字段它就要跟着改。
 * 所以"换槽位 = 重读哪几样"这件事由界面层写下来，是**一处**显式的清单。
 */
function afterSlotChange() {
  try { Profile.load(); } catch (e) { /* 坏档不该让界面卡住（load 自己会退回默认） */ }
  /* `Save.records()` **每次都从存储读**（没有内存缓存），所以换槽位之后
     不需要额外"重读战绩" —— 它下一次被调就是新槽位的。这一条值得写下来：
     否则下一个人会以为漏了一步，去加一个多余的 reload。 */
  UI.toast(I18n.t('槽位') + ' ' + (Slots.current() + 1));
  renderSettings();
  refreshContinueButton();
  try { renderHub(); } catch (e) { }
}
UI.afterSlotChange = afterSlotChange;

/* 把"换槽位 → 重读"接到总线上。
   ⚠ 这条接线是**必须**的，而不是可选优化：`Profile` 的内存副本属于**上一个槽位**，
   只切键不重读会得到一份"看起来对、其实错"的档案 ——
   实测（`test/slots.mjs`）表现是"切回 0 号槽读到的是 1 号槽的孢子"，
   而且**不报任何错**。放在这里而不是 `slots.ts` 里，是因为
   `slots.ts` 不该认识 Profile 的字段（见它的文件头）。 */
Slots.onChange(function () { afterSlotChange(); });

/* `Storage.wipe()`（"清空存档"那条路）之后**也要重读档案**：
   否则内存里那份旧档会继续活着，表现是"点了清空，数值还在"。
   订阅放在这里而不是 `storage.ts`：storage 不认识 profile 的字段。 */
Storage.onWipe(function () {
  try { Profile.load(); } catch (e) { }
  try { Settings.load(); } catch (e) { }
  try { renderSettings(); } catch (e) { }
});

/**
 * 说一次"这个时机"的提示（规则在 `tutorial.ts`；这里只负责问与显示）。
 * @param when 时机名；不在表里就什么都不做（不是错）
 */
function say(when) {
  var list = Tutorial.pending(when);
  for (var i = 0; i < list.length; i++) {
    /* 文案过 `I18n.t`：表里的键就是那句中文原文（缺译文时回退中文） */
    UI.toast('💡 ' + I18n.t(list[i].text), 'good');
    Tutorial.mark(list[i].id);
  }
  return list.length;
}
UI.say = say;
/** 低血那条只在"第一次掉过半血"时问一次（状态型触发，用标记守住） */
var _lowHpSaid = false;

function renderSettings() {
  var qq = (id) => q(id);
  var s = qq('set-sound'); if (s) s.textContent = Settings.get('sound') ? '开' : '关';
  var mu = qq('set-music'); if (mu) mu.textContent = Settings.get('music') ? '开' : '关';
  var v = qq('set-volume-val'); if (v) v.textContent = U.pct(Settings.get('volume')) + '%';
  var sv = qq('set-sfxvol-val'); if (sv) sv.textContent = U.pct(Settings.get('sfxVolume')) + '%';
  var mv = qq('set-musvol-val'); if (mv) mv.textContent = U.pct(Settings.get('musicVolume')) + '%';
  var sp = qq('set-speed'); if (sp) sp.textContent = Settings.get('speed') + 'x';
  /* 战斗模式：标签写「自动 / 手动」而不是内部值 ——
     玩家选的是玩法，不是 'auto' 这个字符串。 */
  var cb = qq('set-combat');
  if (cb) cb.textContent = Settings.get('combatMode') === 'manual' ? I18n.t('手动') : I18n.t('自动');
  var sh = qq('set-shake-val'); if (sh) sh.textContent = U.pct(Settings.get('shake')) + '%';
  var fp = qq('set-fps'); if (fp) fp.textContent = Settings.get('fps') ? '开' : '关';
  var ap = qq('set-autopause'); if (ap) ap.textContent = Settings.get('autopause') ? '开' : '关';
  // 全屏没有"设置项"：它是当前状态，不是偏好（所以标签读的是 API 而不是 Settings）
  var fs = qq('set-fullscreen');
  if (fs) {
    fs.textContent = U.isFullscreen() ? '开' : '关';
    (fs as HTMLButtonElement).disabled = !U.fullscreenSupported();
  }
  var dm = qq('set-damage'); if (dm) dm.textContent = Settings.get('damageNumbers') ? '开' : '关';
  var rm = qq('set-motion'); if (rm) rm.textContent = Settings.get('reduceMotion') ? '开' : '关';
  /* 命中定帧：标签写"关 / 轻 / 中 / 重"而不是帧数 ——
     玩家选的是手感，不是数字；数字住在 `Game.cfg.hitStop`（模拟层）。 */
  var hs = qq('set-hitstop');
  if (hs) {
    var lv = Math.max(0, (Settings.def('hitStop').values || [0]).indexOf(Settings.get('hitStop')));
    hs.textContent = I18n.t(['关', '轻', '中', '重'][lv] || '关');
  }
  /* ---- 这一轮补的三项 + 槽位 ----
     文案一律过 `I18n.t`：切语言之后这些**动态标签**（开/关/档位名）也要跟着变，
     而它们不是 HTML 里的静态文本（`bindDom` 抓不到），所以必须在这里显式翻。 */
  var lc = qq('set-locale');
  if (lc) {
    var cur = I18n.LOCALES.filter(function (l) { return l.id === Settings.get('locale'); })[0];
    /* 语言名**永远用它的母语写**：一个只懂中文的玩家在英文界面里要能找回中文 */
    lc.textContent = cur ? cur.name : Settings.get('locale');
  }
  var fsc = qq('set-fontscale');
  if (fsc) {
    var lvl = Settings.get('fontScale');
    fsc.textContent = lvl >= 1.29 ? I18n.t('大') : (lvl >= 1.14 ? I18n.t('中') : I18n.t('小'));
  }
  var cb = qq('set-colourblind');
  if (cb) cb.textContent = [I18n.t('关'), I18n.t('色弱模式'), I18n.t('高对比')][Settings.get('colourblind')] || I18n.t('关');
  var sv = qq('set-slot-val');
  if (sv) {
    sv.textContent = I18n.t('槽位') + ' ' + (Slots.current() + 1) + (Slots.used() ? '' : ' · ' + I18n.t('空'));
  }
  // 改键按钮：正在等的那个显示"按任意键…"
  BIND_KEYS.forEach(function (key) {
    var btn = qq('bind-' + key);
    if (!btn) return;
    var armed = (_rebindKey === key);
    btn.textContent = armed ? '按任意键…' : keyLabel(Settings.get(key));
    btn.classList.toggle('sel', armed);
  });
  refreshConfirmLabels();
}

/** 标题页的"继续上一局"：只有存在**可用**存档时才出现（坏档不算） */
function refreshContinueButton() {
  var btn = q('btn-continue');
  if (!btn) return;
  var info = Save.peekRun();
  if (!info) { btn.hidden = true; }
  else {
    btn.hidden = false;
    var span = q('continue-info');
    if (span) span.textContent = '（' + info.charName + ' · 第 ' + info.wave + ' 波 · Lv.' + info.level + '）';
  }
  // 标题页那个"枢纽有人想说新话"的角标：与"继续上一局"同一条路径更新
  //（两个都是"从档案里读出来的标题页状态"，放一起就不会漏掉一处）
  var news = q('hub-news');
  if (news) news.hidden = !Profile.hasStoryNews();
}
UI.refreshContinueButton = refreshContinueButton;
UI.renderSettings = renderSettings;

/* =========================================================
   战绩（跨局累计）
   数据一直在写（main.ts 的 gameOver → Save.addRun），改造前**没有任何界面读它**。
   ========================================================= */
function renderRecords() {
  if (!el.recordsBody) return;
  var r = Save.records();
  var rows: Array<[string, string | number]> = [
    ['总对局数', r.runs],
    ['撑到过第', r.bestWave > 0 ? r.bestWave + ' 波' : '—'],
    ['单局最多击杀', r.bestKills],
    ['达到过的最高等级', r.bestLevel],
    ['累计击杀', U.fmtNum(r.totalKills)],
    ['累计收集废料', U.fmtNum(r.totalMaterials)],
    ['最后更新', r.updatedAt ? new Date(r.updatedAt).toLocaleString() : '—']
  ];
  var html = '';
  rows.forEach(function (row) {
    html += '<div class="k">' + row[0] + '</div><div class="v">' + row[1] + '</div>';
  });
  if (r.runs === 0) html += '<div class="k" style="grid-column:1/-1">还没有打完过一局</div>';
  el.recordsBody.innerHTML = html;
}

/* =========================================================
   结算
   ========================================================= */
/**
 * 与历史最佳的对比。注意调用顺序：`gameOver` 事件里先 `Save.addRun(sum)`（记录并进），
 * 界面上再取历史——所以这里看到的"最佳"**已包含本局**，于是要标出"本局刷新了纪录"
 * 而不是"差了 3 波"，否则每一局都会显示成"你就是最佳"，等于没有信息。
 */
function historyLine(sum) {
  var r = Save.records();
  var bits = [];
  if (sum.wave >= r.bestWave && r.bestWave > 0) bits.push('最高波次');
  if (sum.kills >= r.bestKills && r.bestKills > 0) bits.push('最多击杀');
  if (sum.level >= r.bestLevel && r.bestLevel > 0) bits.push('最高等级');
  var best = '<div style="margin-top:8px;font-size:13px">历史最佳：第 ' + r.bestWave + ' 波 · 击杀 ' +
    r.bestKills + ' · Lv.' + r.bestLevel + '（共 ' + r.runs + ' 局）</div>';
  if (bits.length && r.runs > 1) {
    best += '<div style="font-size:13px;color:#e8b23c">本局刷新纪录：' + bits.join(' / ') + '</div>';
  }
  return best;
}

function renderEnd(sum) {
  var rows = '';
  rows += '<div>角色 <b>' + (sum.charName || '—') + '</b></div>';
  rows += '<div>存活到第 <span class="big-num">' + sum.wave + '</span> 波</div>';
  rows += '<div>等级 ' + sum.level + ' · 击杀 ' + sum.kills + ' · 累计伤害 ' + U.fmtNum(sum.damage) + '</div>';
  rows += '<div>收集废料 ' + sum.scrap + ' · 承受伤害 ' + U.fmtNum(sum.taken) + ' · 回复 ' + U.fmtNum(sum.healed) + '</div>';
  if (sum.packs) rows += '<div>开出道具包 ' + sum.packs + ' 个（花费 ' + sum.packSpent + ' 废料）</div>';
  /* 这一局合了几次、攒了多少合金 —— 结算页是"看清这一局做了什么"的地方，
     而合成是唯一通向局外图纸的动作，必须在这里露一次脸。 */
  var sess = Game.getSession();
  if (sess && sess.combineCount) {
    rows += '<div>合成 <span class="big-num">' + sess.combineCount + '</span> 次 · 合金 +' +
      (sess.alloy || 0) + '（到据点解锁图纸）</div>';
  }
  // 与历史最佳对比：这一局的成绩要放在坐标里才有意义
  rows += historyLine(sum);
  if (sum.weapons && sum.weapons.length) rows += '<div style="margin-top:8px;font-size:13px">武器：' + sum.weapons.join(' / ') + '</div>';
  if (sum.items && sum.items.length) rows += '<div style="font-size:13px">道具：' + sum.items.join(' / ') + '</div>';
  el.endBody.innerHTML = rows;
}

/* 美术资源归属：本文件生产 `ui` 这一类（面板 / 控件 / 角标 / 徽章）。
   界面素材**不进图集**（`atlas: 'ui'` 指的是它自己那一组）——
   它们由 DOM + CSS 承担布局，画布只嵌在需要程序化绘制的地方（角色卡 / 道具图标）。 */
Art.noteOwner('ui', 'ui.ts');

export { UI };
