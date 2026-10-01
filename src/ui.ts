/* =========================================================
ui.ts — 覆盖层界面（标题 / 角色 / 商店 / 升级 / 暂停 / 结算 / HUD）
========================================================= */

import { Art } from './art_spec.ts';
import { Sfx } from './audio.ts';
import { Affixes } from './affixes.ts';
import { Appearance } from './appearance.ts';
import { Chars } from './data_chars.ts';
import { Elems } from './data_elems.ts';
import { Camp } from './camp.ts';
import { Bonds } from './bonds.ts';
import { Boons } from './boons.ts';
import { Challenges } from './challenges.ts';
import { Daily } from './daily.ts';
import { Danger } from './danger.ts';
import { Dialogue } from './dialogue.ts';
import { Dungeon } from './dungeon.ts';
import { Economy } from './economy.ts';
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
import { Station } from './station.ts';
import { Story } from './story.ts';
import { Trade } from './trade.ts';
import { Synergy } from './synergy.ts';
import { Skills } from './skills.ts';
import { Talent } from './talents.ts';
import { Perf, U } from './utils.ts';

var UI = ({
  selectedChar: 'ranger',
  selectedDanger: 0,
  talentChar: 'ranger',
  /** 技能构筑屏正在看哪个角色（与天赋屏**各记一份**：两边可以同时看不同角色） */
  skillChar: 'ranger',
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
  el.rerollSigil = q('btn-reroll-sigil');
  el.sigilCount = q('sigil-count');
  el.packBasicCost = q('pack-basic-cost');
  el.packDeluxeCost = q('pack-deluxe-cost');
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
  el.trainList = q('train-list');
  el.bondList = q('bond-list');
  el.exchangeList = q('exchange-list');
  el.trainList = q('train-list');
  el.bondList = q('bond-list');
  el.exchangeList = q('exchange-list');
  el.talentHead = q('talent-head');
  el.talentList = q('talent-list');
  el.skillWho = q('skill-who');
  el.skillCards = q('skill-cards');
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
  el.hubTalk = q('hub-talk');
  el.hubNews = q('hub-news');
  /* 大厅（站）——**局内**的那一屏。前缀 `station-` 与枢纽那套（`hub-`）刻意分开：
     两者**都归局内**（大厅是这一局的起点 / 传送门房间，枢纽是这一局的家），
     只是复用同一套样式。 */
  el.stationBoard = q('station-board');
  el.toastWrap = q('toast-wrap');
  el.codexStory = q('codex-story');
  el.codexAffixes = q('codex-affixes');
  el.codexTabs = q('codex-tabs');
  el.shopBoons = q('shop-boons');
  el.shopDoors = q('shop-doors');
  el.campDoors = q('camp-doors');
  el.titleLogo = q('title-logo');
  /* 选存档 / 捏人（R50）：开局流程的前两步 */
  el.slotGrid = q('slot-grid');
  el.slotDetail = q('slot-detail');
  el.createPreview = q('create-preview');
  el.createName = q('create-name');
  el.createJob = q('create-job');
  el.createPalette = q('create-palette');
  el.createFace = q('create-face');
  el.createAccessory = q('create-accessory');
  el.createEntry = q('create-entry');
  /* R41 · 战斗短句那一条（表现层的东西：模拟层只广播 `bark` 事件） */
  el.barkLine = q('bark-line');

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
  hudNodes.skills = q('hud-skills');
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
  /* 选存档与捏人（R50）：两屏的内容都是**从存档读出来的**（档里有谁 / 捏成什么样），
     所以进屏必须重画 —— 不重画就会停在上一次进来时的样子。 */
  slots: function () { renderSlots(); },
  create: function () { renderCreate(); },
  shop: function () { renderShop(); },
  cards: function () { renderLevelCards(); },
  settings: function () { renderSettings(); },
  records: function () { renderRecords(); },
  codex: function () { renderCodex(); },
  talents: function () { renderTalents(); },
  skills: function () { renderSkills(); },
  camp: function () { renderCamp(); },
  keep: function () { renderKeep(); },
  hub: function () { renderHub(); },
  /* 大厅：三道门 + 公告板都是**从这一局读出来的**（门表 + 账 + 下一步），
     所以进站必须重画 —— 不重画就会停在上一次进来时的账。 */
  station: function () { renderStation(); },
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
   R50 · 选存档（开局流程的第二步）
   ---------------------------------------------------------
   用户原话：「点击开始游戏按钮，**选择存档**，进入游戏，第一个到的是大厅」。

   改造之前这一步**不存在**：三个槽位只在「设置 → 存档槽位」里切换，
   而开局直接把玩家丢进选人页。

   ⚠ 判据是**这个档里有没有人**（`Profile.character()` 读的是 `data.characters[槽位]`），
   **不是** `Slots.used()` —— 后者只看"这个槽位写过键没有"，
   设置里随手切一下槽位、或某一局写到一半就会让它变真，
   于是"新档"会被当成老档（玩家进不了捏人）。
   ========================================================= */
/** 正在看哪个槽位（**界面状态，不进档案** —— `Slots.current()` 才是真正生效的那个） */
var _slotView = 0;

function slotCharOf(slot) {
  var all = Profile.snapshot().characters || {};
  var c = all[String(slot)];
  return (c && c.charId) ? c : null;
}

/** 一个槽位卡片上的那行小字（有人的档写他是谁，空档写"空"） */
function slotSummary(c) {
  if (!c) return '空 存 档';
  var def = Chars.BY_ID[c.charId];
  var snap = Profile.snapshot().perChar || {};
  var p: PerCharRecord = snap[c.charId] || ({} as PerCharRecord);
  return (def ? def.name : c.charId) + ' · 第 ' + (p.bestWave || 0) + ' 波 · ' + (p.runs || 0) + ' 局';
}

function renderSlots() {
  if (!el.slotGrid) return;
  if (_slotView < 0 || _slotView >= Slots.COUNT) _slotView = Slots.current();
  U.clear(el.slotGrid);
  U.clear(el.slotDetail);
  for (var i = 0; i < Slots.COUNT; i++) {
    (function (slot) {
      var c = slotCharOf(slot);
      var card = U.el('div', 'slot-card' + (c ? '' : ' empty') + (slot === _slotView ? ' sel' : ''));
      card.dataset.slot = String(slot);
      var size = 74;
      var cc = S.domCanvas(size + 8, size + 8);
      var cv = cc ? cc.canvas : document.createElement('canvas');
      var cx = cc ? cc.ctx : cv.getContext('2d');
      card.appendChild(cv);
      card.appendChild(U.el('div', 'cn', '存 档 ' + (slot + 1)));
      card.appendChild(U.el('div', 'ce', c ? c.name : '空'));
      card.appendChild(U.el('div', 'ce', slotSummary(c)));
      card.addEventListener('click', function () {
        /* 点一下 = **选中并切过去**（不只是高亮）：切槽位会让 `Profile.load()`
           重读那一份档，于是下面那一排按钮说的就是这一档的事。 */
        _slotView = slot;
        Slots.select(slot);
        Profile.load();
        renderSlots();
        if (Sfx) Sfx.click();
      });
      el.slotGrid.appendChild(card);
      /* 头像按**这一档的人**画（没人的档画该槽位上一次选中的职业本色） */
      var def = Chars.BY_ID[(c && c.charId) || UI.selectedChar] || Chars.LIST[0];
      var port = S.bronanaPortrait(size, def, c ? c.look : null);
      if (port) cx.drawImage(port.canvas, 0, 0, port.width, port.height);
    })(i);
  }

  /* 详情 + 那一对按钮：有人的档「继续」，没人的档「开始新档」。
     ⚠ "继续"走的是 `startRun`（**同一个开局入口**，见它的注释）——
       不能另开一条只传角色的路（R38 那个 bug 就是这么长出来的）。 */
  var cur = slotCharOf(_slotView);
  var box = U.el('div', '');
  if (cur) {
    var jd = Chars.BY_ID[cur.charId];
    box.appendChild(U.el('h3', '', cur.name + ' —— ' + (jd ? jd.name : cur.charId)));
    box.appendChild(U.el('div', '', '外观：' + Appearance.palette(cur.look.palette).name +
      ' · ' + cur.look.face + ' · ' + Appearance.accessory(cur.look.accessory).name));
    box.appendChild(U.el('div', '', slotSummary(cur)));
  } else {
    box.appendChild(U.el('h3', '', '存 档 ' + (_slotView + 1) + ' · 还 没 有 人'));
    box.appendChild(U.el('div', '', '这是一个空档 —— 下一步是选职业与捏人。'));
  }
  var row = U.el('div', 'row center');
  /* ⚠ 两个动作**分开写**，不要写成三元表达式 `cur ? 'slot-continue' : 'slot-new'`：
     界面契约测试（`ui-check` 的 data-act 契约）按 `dataset.act\s*=\s*'...'` 静态抓
     "动态生成的按钮动作"，三元表达式只抓得到第一个 —— 于是 `slot-new` 会被报成
     "动作表里有一个动作没有按钮"。这条**实测踩过**。 */
  var go = U.el('button', 'btn big', cur ? '继 续 这 个 档' : '开 始 新 档');
  if (cur) go.dataset.act = 'slot-continue';
  else go.dataset.act = 'slot-new';
  row.appendChild(go);
  box.appendChild(row);
  el.slotDetail.appendChild(box);
}

/* =========================================================
   R50 · 捏人（新存档的角色创建）
   ---------------------------------------------------------
   用户原话：「选择新存档，就会需要**捏人选择初始角色外观，选择初始角色职业**，
   然后就能确定这个角色的**初始技能，初始属性，初始天赋**等
   确定人物以后开始世界冒险」。

   四块：名字 / 外观（色板 · 脸型 · 配件）/ 初始职业 / 入门三选。
   一律**程序化**（B02 / R30：零素材）—— 外观是配色与配件的变体，不是贴图。
   ========================================================= */
var _createSeed = 1;
/** 这一次那个"还没出发的人"是在哪个槽位里建起来的（-1 = 不是捏人页建的）。
 *  它**不进档案**：这是界面记账，用来回答"返回时该不该撤回他"。 */
var _draftSlot = -1;

/** 现在这份"正在捏"的形状。
 *
 *  ⚠ 它**可能还没落盘**（从选存档页进来时还没建人）—— 所以这里按需**先建一份**：
 *  "进了捏人页"这件事本身就是"这个档要有人"的意图，而半途离开由 `back-slots`
 *  负责撤回（它按 `_draftSlot` 这个**记账**判，不猜）。
 */
function draftCharacter() {
  var cur = Profile.character();
  if (cur) return cur;
  /* 空名字 → 归一成缺省名（见 `character.ts` 的 `DEFAULT_NAME`）；
     外观给 `null` → 缺省档（用职业本色），与"没捏过"逐位相同。 */
  var made = Game.saveCharacter({ name: '', look: null }, UI.selectedChar);
  _draftSlot = Slots.current();     // 记一笔：这个人是捏人页刚建起来的（可以撤回）
  return made as CharacterDef;
}

/** 一排"选一个"的小按钮（色板 / 脸型 / 配件共用这一个形状） */
function optionRow(host, list, picked, act) {
  U.clear(host);
  list.forEach(function (d) {
    var b = U.el('button', 'btn tiny' + (d.id === picked ? ' sel' : ''), d.name) as HTMLButtonElement;
    if (act === 'create-palette') b.dataset.act = 'create-palette';
    else if (act === 'create-face') b.dataset.act = 'create-face';
    else b.dataset.act = 'create-accessory';
    b.dataset.id = d.id;
    b.title = d.note;
    host.appendChild(b);
  });
}

function renderCreate() {
  if (!el.createEntry) return;
  var me = draftCharacter();
  var def = Chars.BY_ID[me.charId] || Chars.LIST[0];

  /* 名字输入框：只在值不同时写 —— 每帧写一次会打断正在输入的人（光标跳到最后） */
  if (el.createName && (el.createName as HTMLInputElement).value !== me.name) {
    (el.createName as HTMLInputElement).value = me.name;
  }
  if (el.createJob) {
    el.createJob.textContent = def.name + ' · ' + def.tag;
  }
  optionRow(el.createPalette, Appearance.PALETTES, me.look.palette, 'create-palette');
  optionRow(el.createFace, Appearance.FACES, me.look.face, 'create-face');
  optionRow(el.createAccessory, Appearance.ACCESSORIES, me.look.accessory, 'create-accessory');

  /* 入门三选：每一列一块，块里一档一行（名字 + 它给什么 + 说明） */
  U.clear(el.createEntry);
  Game.creationOptions().forEach(function (col) {
    var head = U.el('div', 'set-label', col.name + '　' + col.note);
    el.createEntry.appendChild(head);
    col.list.forEach(function (d) {
      var r = U.el('div', 'entry-row' + (d.picked ? ' sel' : ''));
      r.dataset.act = 'create-pick';
      r.dataset.col = col.key;
      r.dataset.id = d.id;
      r.appendChild(U.el('div', 'en-name', d.name));
      var body = U.el('div', '');
      body.appendChild(U.el('div', 'en-give', d.lines.join(' · ')));
      body.appendChild(U.el('div', 'en-note', d.note));
      r.appendChild(body);
      el.createEntry.appendChild(r);
    });
  });

  paintCreatePreview(me, def);
}

/** 捏人页左边那张大图：**正在捏的那一套**（不是存档里的旧样子） */
function paintCreatePreview(me, def) {
  if (!el.createPreview) return;
  var size = 216;
  var port = S.bronanaPortrait(size, def, me.look);
  var node = el.createPreview as HTMLCanvasElement;
  var x = node.getContext ? node.getContext('2d') : null;
  if (!x) return;
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.clearRect(0, 0, node.width, node.height);
  if (!port) return;
  /* 画布是设备像素比放大的，所以按画布尺寸铺满（`S.domCanvas` 那一套在这里不用：
     本元素写在 index.html 里，尺寸是固定的 256×256）。 */
  x.drawImage(port.canvas, 0, 0, node.width, node.height);
}

/** 改一项外观（走**存档那一个口**，不在这里维护第二份"正在捏"的状态） */
function setLook(patch) {
  var me = Profile.character();
  if (!me) return false;
  Game.setCharacterMeta({ look: patch });
  renderCreate();
  return true;
}

/** 改入门三选里的一档 */
function setEntry(col, id) {
  var me = Profile.character();
  if (!me) return false;
  var patch: Partial<CharacterEntryPick> = {};
  patch[col] = id;
  Game.setCharacterMeta({ entry: patch });
  renderCreate();
  return true;
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
  { id: 'affixes', name: '词 条', panel: 'codex-affixes' },
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

  var s = setRow('孢子', Game.growth());
  s += setRow('挑战完成', snap.done.length + ' / ' + Challenges.LIST.length);
  s += setRow('角色解锁', unlockedChars + ' / ' + Chars.LIST.length);
  s += setRow('解锁的武器 / 道具', Profile.unlockedIds('weapon').length + ' / ' + Profile.unlockedIds('item').length);
  el.codexSummary.innerHTML = s;

  // 挑战：完成的打勾；累计类给出进度；单局达成的不画进度条
  // （局外它的读数永远是 0，画一条空进度条等于给出错误读数）
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

  // 词条图鉴：19 条词条分别是什么、落在哪、每一档给多少（见 renderAffixBlock）
  renderAffixBlock();

  // 每日挑战：今天的规则 + 本地最好 + 最近一局的成绩码
  renderDailyBlock();

  renderCodexTabs();
}

/* =========================================================
   枢纽（N2：这一局的"家"—— 入口在大厅底栏 / 暂停菜单，出去走回大厅）
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
var _hubNpc = '';          // 当前开口的 NPC（界面状态，不进档案；走开自动清）
var _boardOn = false;      // 公告板是不是摊开着（同上：走开自动收）
/* =========================================================
   R41 · 对话的那几样"读法"状态（**全是界面状态，不进档案**）
   ---------------------------------------------------------
   改造前这一屏只有"这一句 + ▽继续说"。补上的东西各有各的一份状态，
   而它们的共同点是**都不该被持久化**：下次走进这间屋必须是干净的
   （"上次读到哪"不该跨局、跨存档带着走）—— 与 `_hubNpc` 同一条纪律。
   ========================================================= */
var _talkIdx = 0;          // 这一轮聊到说话人自己的第几句（`_hubNpc` 换了就归零）
var _talkLineT = 0;        // 当前这一句已经打了多久（秒）—— 打字机的唯一输入
var _talkSkip = false;     // 这一句别慢慢打（"点一下跳到整句"）
var _talkAuto = false;     // 说完就自己往下走（可以一边走一边读）
var _talkLine = '';        // 当前这一句的 id（换了就重置 `_talkLineT`）
var _talkBranch: StoryLineDef | null = null;   // 选了分支之后正在看的那一句
var _talkLog: DialogueHistoryEntry[] = [];     // 对话历史（上限在 dialogue.ts）
var _talkLogOpen = false;  // 历史摊开没有
var _tradeOpen = false;    // 交易面板摊开没有（R41；同一个"走到跟前才有"的形状）
var _barkTimer: number | null = null;          // 短句那条动画的复位句柄

/** 把"当前正在看的那一句"清干净（换人、走开、重进都要它） */
function talkReset() {
  _talkIdx = 0; _talkLineT = 0; _talkSkip = false;
  _talkLine = ''; _talkBranch = null; _talkLogOpen = false; _tradeOpen = false;
  /* ⚠ `_talkAuto` **不在这里清**：它是"读法"（一个模式），不是"这一句的状态"——
     走开再回来还得是自动模式，否则玩家每换一个人都要再按一次。 */
}

/** 当前该显示的那一条台词（没有就 null） */
function talkLineNow() {
  if (!_hubNpc) return null;
  if (_talkBranch) return _talkBranch;
  var lines = Profile.linesFor(_hubNpc);
  if (!lines.length) return null;
  return lines[Math.min(_talkIdx, lines.length - 1)];
}

/** 这一轮还剩几句（公告/提示里用） */
function talkRest() {
  if (!_hubNpc || _talkBranch) return 0;
  return Math.max(0, Profile.linesFor(_hubNpc).length - _talkIdx - 1);
}

/** 玩家侧头像（R41："玩家侧也有头像"）——用**这条存档的角色**，不是职业本色 */
function playerCanvas(size) {
  var cc = S.domCanvas(size + 8, size + 8);
  var cv = cc ? cc.canvas : document.createElement('canvas');
  var cx = cc ? cc.ctx : cv.getContext('2d');
  var me = Profile.character();
  var def = Chars.BY_ID[(me && me.charId) || UI.selectedChar] || Chars.LIST[0];
  var port = S.bronanaPortrait(size, def, me ? me.look : null);
  if (port) cx.drawImage(port.canvas, 0, 0, port.width, port.height);
  return cv;
}

/** 把这一句记进对话历史（**只记真的说出口的**，不记"正在打"的） */
function talkLogPush(line, speakerName, text) {
  if (!line || !text) return;
  /* 同一条台词 id 不重复进历史（重画一帧就塞一条的话，历史会被同一句灌满） */
  for (var i = _talkLog.length - 1; i >= 0; i--) if (_talkLog[i].line === line.id) return;
  _talkLog = Dialogue.pushHistory(_talkLog, {
    who: _hubNpc, name: speakerName, text: text, line: line.id, at: _talkLog.length
  });
}

/** 档案那一带：回答"档案里攒了什么"（一横条，每项 nowrap，永不折字）。
    以前它在枢纽屏的常驻状态带里；站点卡删掉之后，它并进**公告板**那张
    走到跟前按 E 才摊开的卡（同一个数字不再有第二个写入处）。 */
function profileStatusHtml() {
  var s = Profile.storySnapshot();
  var freePoints = 0;
  var chars = 0;
  Chars.LIST.forEach(function (c) {
    if (!isCharListed(c)) return;
    chars++;
    freePoints += Game.talentFree();
  });
  var rows: { k: string; v: string; warn?: boolean }[] = [
    { k: '材料', v: Game.material() + '（据点用）' },
    { k: '合金', v: Game.growth() + '（图纸工坊用：只由合成产出）' },
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
    html += '<span class="acct-item' + (r.warn ? ' warn' : '') + '"><b>' + r.k + '</b> ' + r.v + '</span>';
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
  /* 屋里站着谁由 `Profile.stationsFor()` 说了算（人有解锁条件：换档、洗档都会变）。
     ⚠ 界面**不再摆站点卡**（2026-10：用户"完全没必要再显示这个了"）——
     人在屋里站着、设施在地上摆着，走到跟前就是交互本身。这里只画**一样**：
       · **说话时**才出现的对话框（走到谁面前按 E）
     ⚠ 连那行常驻控制提示也删了（2026-10 第二轮：「底部只剩一行操作提示 不需要」）：
       "走到人面前按 E 说话"由 render.ts 在**那个人头上**写（`drawHallPrompt`），
       屏幕底下不再解释一遍。软引导（"下一步"）没丢 —— 它在大厅的公告板上，
       **走到板子前按 E** 才摊开（`renderBoard`）。
     选中的 NPC 必须还在屋里；进屋**不自动选中谁** —— 自动选中会让对话框
     在你还没走到人面前时就冒出来，那是"按钮列表"的残留，不是一间屋子。 */
  var stations = Profile.stationsFor();
  var still: StoryStationDef | null = null;
  for (var i = 0; i < stations.length; i++) if (stations[i].npc === _hubNpc) still = stations[i];
  /* ⚠ 判据是"人还站在这一间屋里"，而不是直接比状态名 ——
     哪一屏该长什么样由场景表说（表现层不再按状态名硬编码，见 test/states.mjs）；
     而 `Game.hall()` 只在屋里才有，`room` 就是这一间的 id（枢纽 / 大厅）。 */
  var here = Game.hall();
  if (!still || !here || here.room !== 'hub') { _hubNpc = ''; still = null; }

  /* 对话框：只画**当前这一句**。
     一次把七八句话倒出来等于什么都没说；"说一句 → 重画 → 下一句顶上来"
     才是 Hades 那种"跟人聊天"的节奏。没新话时说一句"他没别的说了"，
     而不是留一片空白（空白会让人以为界面坏了）。

     R41 之后这一屏多了五样（每条对着一次普查里标 ❌ 的那一栏）：
       · **打字机** —— 一个字一个字地出（`Dialogue.indexAt`）；点一下跳整句
       · **玩家侧头像** —— 左边是他、右边是你（改造前是单向广播）
       · **选择/分支** —— 这一句有 `choices` 就列选项，"继续说"让位
       · **读法工具条** —— 跳过 / 自动 / 历史（两个模式 + 一块回顾）
       · **对话历史** —— 说过的话可回看（上限在 `dialogue.ts`）
     ⚠ 台词与分支**全在 `story.ts`**，这里只负责画与"怎么读"。 */
  if (el.hubTalk) {
    U.clear(el.hubTalk);
    el.hubTalk.hidden = !still;
    if (still) {
      el.hubTalk.appendChild(stationCanvas(still.id, 64, 'tx-cv'));
      var body = U.el('div', 'tx-body');
      var who = U.el('div', 'tx-name', still.name);
      who.appendChild(U.el('span', 'tx-role', still.role));
      body.appendChild(who);
      var line = talkLineNow();
      if (line) {
        /* 打字机：`_talkLineT` 由 `hallSync` 每显示帧推进（**不在渲染里推进**：
           重画一次就多打一个字的话，帧率会变成打字速度）。 */
        var shown = _talkSkip ? line.text : Dialogue.slice(line.text, Dialogue.indexAt(line.text, _talkLineT));
        var lineEl = U.el('div', 'tx-line', shown);
        if (!_talkSkip && !Dialogue.done(line.text, _talkLineT)) {
          lineEl.appendChild(U.el('span', 'tx-caret', ''));   // 还在打：句尾一个光标
        }
        body.appendChild(lineEl);
        /* 打完之后才**记进历史**（"正在打"的半句话不该进回顾） */
        if (Dialogue.done(line.text, _talkLineT)) talkLogPush(line, still.name, line.text);

        /* 选择：两档以上就列选项。条件不满足的**不出现**（`choicesOf` 已经滤过） */
        var choices = Profile.choicesFor(line);
        if (choices.length) {
          var box = U.el('div', 'tx-choices');
          choices.forEach(function (ch) {
            var b = U.el('button', 'btn tiny tx-choice', '▸ ' + ch.text);
            b.dataset.act = 'hub-pick';
            b.dataset.choice = ch.id;
            box.appendChild(b);
          });
          body.appendChild(box);
        } else {
          // 一个小按钮（键盘/手柄/鼠标）：往前走一句
          var more = talkRest();
          var nx = U.el('button', 'btn tiny tx-next',
            _talkBranch ? '▽ 说完了' : ('▽ 继续说' + (more > 0 ? '（还有 ' + more + ' 句）' : '（最后一句）')));
          nx.dataset.act = 'hub-say';
          body.appendChild(nx);
        }

        /* 玩家侧：右边那一栏是你（R41 补的"玩家侧也有头像"）。
           改造前对话框是**单向广播** —— 说话的人有脸，听的人没有。
           ⚠ 角色名走**这条存档**的那一份（`Profile.character()`），
             昵称没建过就退回"你" —— 与标题页/档位卡同一条取法。 */
        var meRow = U.el('div', 'tx-row tx-me');
        meRow.appendChild(playerCanvas(40));
        var meBody = U.el('div', 'tx-body');
        var meName = U.el('div', 'tx-name', Profile.character() ? Profile.character().name : '你');
        meName.appendChild(U.el('span', 'tx-role', '你'));
        meBody.appendChild(meName);
        meRow.appendChild(meBody);
        body.appendChild(meRow);

        /* 读法工具条：跳过（这一句）/ 自动（之后每一句）/ 历史（回看）
           + **交易**（R41：他要是商人，这里多一个入口）。
           ⚠ 交易**不换屏**：它是这一间屋里、站在他跟前能做的一件事 ——
             换一屏就等于"走开去商店"，而这一屏的全部意义正是"你在跟人说话"。 */
        var tools = U.el('div', 'tx-tools');
        var skipBtn = U.el('button', 'btn tiny' + (_talkSkip ? ' sel' : ''), '跳过');
        skipBtn.dataset.act = 'hub-skip';
        tools.appendChild(skipBtn);
        var autoBtn = U.el('button', 'btn tiny' + (_talkAuto ? ' sel' : ''), '自动');
        autoBtn.dataset.act = 'hub-auto';
        tools.appendChild(autoBtn);
        var logBtn = U.el('button', 'btn tiny' + (_talkLogOpen ? ' sel' : ''), '历史');
        logBtn.dataset.act = 'hub-log';
        tools.appendChild(logBtn);
        if (Game.isTrader(_hubNpc)) {
          var tradeBtn = U.el('button', 'btn tiny' + (_tradeOpen ? ' sel' : ''), '交易');
          tradeBtn.dataset.act = 'hub-trade';
          tools.appendChild(tradeBtn);
        }
        tools.appendChild(U.el('span', 'tx-hint',
          _talkAuto ? '自动：说完就往下走' : '点这一句跳到整句'));
        body.appendChild(tools);

        /* **交易面板**（R41）：摆着他现在能给的东西 + 要什么。
           每一档单独一行 —— "给什么 / 要什么 / 为什么不能换" 三样都要看得见，
           否则玩家只会看到一片按钮而不知道哪一个买得起。 */
        if (_tradeOpen && Game.isTrader(_hubNpc)) {
          var tradeBox = U.el('div', 'tx-trade');
          var offers = Game.tradeOffers(_hubNpc);
          if (!offers.length) {
            tradeBox.appendChild(U.el('div', 'tx-quiet', '……他现在没什么可跟你换的。'));
          }
          offers.forEach(function (o) {
            var row = U.el('div', 'trade-row' + (o.ok ? '' : ' off'));
            var head = U.el('div', 'trade-head');
            head.appendChild(U.el('b', 'trade-name', o.name));
            head.appendChild(U.el('span', 'trade-give', '给：' + o.give));
            row.appendChild(head);
            row.appendChild(U.el('div', 'trade-note', o.note));
            var foot = U.el('div', 'trade-foot');
            foot.appendChild(U.el('span', 'trade-ask', '要：' + o.ask));
            if (o.ok) {
              var b = U.el('button', 'btn tiny', '换 一 个（这一波还剩 ' + o.left + ' 次）');
              b.dataset.act = 'trade-buy';
              b.dataset.offer = o.id;
              foot.appendChild(b);
            } else {
              foot.appendChild(U.el('span', 'set-note', o.reason));
            }
            row.appendChild(foot);
            tradeBox.appendChild(row);
          });
          /* 说明它换的是**下一局**的开局条件 —— 不说清楚玩家会以为东西没到账。
             ⚠ 这行文案**不许写 markdown**（`ui-check` 有一条判据查"渲染出来的 DOM
               里还有没有 `**`"）—— 想强调就写中文引号。 */
          tradeBox.appendChild(U.el('div', 'tx-hint',
            '换到的东西进的是下一局的开局携带；商店才是这一局的战力'));
          body.appendChild(tradeBox);
        }

        /* 历史：倒序（最新的在最上面） */
        if (_talkLogOpen) {
          var logBox = U.el('div', 'tx-log');
          if (!_talkLog.length) {
            logBox.appendChild(U.el('div', 'tx-log-row', '（还没说过什么）'));
          } else {
            Dialogue.recent(_talkLog, Dialogue.HISTORY_MAX).forEach(function (h) {
              var r = U.el('div', 'tx-log-row');
              r.appendChild(U.el('b', '', h.name + '：'));
              r.appendChild(U.el('span', '', h.text));
              logBox.appendChild(r);
            });
          }
          body.appendChild(logBox);
        }
      } else {
        body.appendChild(U.el('div', 'tx-quiet', '……他没别的要说了。下次回来再看。'));
      }
      el.hubTalk.appendChild(body);
    }
  }
  /* 「有人想说新话」的角标（`hub-news`）不画在这一屏 —— 它挂在**大厅**底栏的
     「枢纽」按钮上（枢纽的入口搬进局内之后就是这么摆的），由 renderStation 更新。
     这里不再重复一份：同一个元素两个写入处 = 迟早有一处忘了跟着改。 */
}

/**
 * 让当前选中的 NPC 说一句（说过的不再出现）—— 由"说下去"按钮调用。
 *
 * R41 之后它多了三件事，都是"节奏"而不是"规则"：
 *   ① **打完才记**：还在打字的时候按"继续说"= **跳到整句**（不是跳下一句）——
 *      这是打字机界面的通用约定，少了它玩家会觉得自己按太快漏了话
 *   ② **分支就让位**：这一句有选项时不走这里（界面列的是选项，见 `hubPick`）
 *   ③ 说完把计时归零、`skip` 复位，下一句从头开始打
 */
function hubSay() {
  var line = talkLineNow();
  if (!line) return false;
  /* ① 还在打 → 这一次点击是"跳到整句"，不记账、也不换句 */
  if (!_talkSkip && !Dialogue.done(line.text, _talkLineT)) {
    _talkSkip = true;
    renderHub();
    return true;
  }
  /* ② 有选项的那一句不由"继续说"推进（界面列的是选项） */
  if (Profile.hasChoices(line) && !_talkBranch) return false;
  Profile.say(line.id);
  /* 分支那一条看过就走（它是一次性的"回答"，不该留在池子里再出现一次） */
  _talkBranch = null;
  _talkIdx++;
  _talkSkip = false;
  _talkLine = '';
  _talkLineT = 0;
  // 说完立刻重画：下一句顶上来，这就是"一句话一句话地聊"
  renderHub();
  refreshContinueButton();
  return true;
}

/**
 * 挑了一条选项（R41 的"选择/分支"）。
 *
 * ⚠ 它**只推进对话**，不碰任何账本 —— `story.ts` 那条硬约束
 * （"叙事线一个铜板都不碰"）在这里同样成立：分支是**语气**的分支，
 * 不是"选左给钱、选右扣钱"。要给东西的话那是 NPC 交易该干的事（另一条路）。
 */
function hubPick(choiceId) {
  var line = talkLineNow();
  if (!line) return false;
  var next = Profile.branchOf(line, choiceId);
  /* 这一句记成说过了 —— 分支台词于是不会每次进屋都重问一遍 */
  Profile.say(line.id);
  _talkBranch = next;          // null = 这条选项通向"说完就结束"
  if (!next) _talkIdx++;
  _talkSkip = false;
  _talkLine = '';
  _talkLineT = 0;
  renderHub();
  refreshContinueButton();
  return true;
}

/**
 * 在枢纽里**走到某人面前按 E**（main.ts 的 hall 按键组把 `Game.hallAct()` 的
 * 回答交到这里）。
 *
 * 两次按键是两种动作，与 Hades 那种"站着跟人说话"的节奏一致：
 *   ① 第一次按 E → 选中他，亮出他现在要说的那一句（不记账）
 *   ② 再按一次   → 把这一句记成"说过了"，下一句顶上来
 * 走到另一个人面前再按 E，会换成他（选中的人跟着你站的位置走）。
 */
function hallTalk(npcId) {
  if (!npcId) return;
  if (_hubNpc === npcId) { hubSay(); return; }
  /* 换人 = 换一轮对话：打字计时、分支、这一句的"跳过"全部归零 */
  talkReset();
  _hubNpc = npcId;
  renderHub();
}

/** 走到公告板前按 E：把这一局的账与"下一步"读出来（不换屏，它不是门） */
function hallBoard() {
  _boardOn = true;
  renderStation();
  var gd = Game.guide();
  UI.toast(gd ? ('下一步：' + gd.text) : '循环转起来了 —— 三个模块随便挑一个推', 'good');
}

/**
 * 屋里两屏的**每显示帧同步**（main.ts 在 hall 那两屏每帧调一次）。
 *
 * 为什么需要它：这两屏的"面板"是**交互的产物**，不是常驻菜单 ——
 * 于是它必须跟着玩家的**位置**走：
 *   · 大厅：站在公告板前按过 E 才摊开；走开一步就收起来
 *   · 枢纽：走到谁面前按过 E 才有他的对话框；换个人、或走开，跟着变
 * ⚠ 只**收**不**弹**：走近谁**不会**自动开口（自动弹出来又变成"一份常驻列表"了，
 *   而且玩家还没走到人面前就有一句话糊在屏幕上）。开口只由按 E 触发。
 */
function hallSync() {
  var h = Game.hall();
  var room = h ? h.room : '';
  if (room === 'station') {
    var atBoard = !!(h && h.near && h.near.id === 'board');
    if (_boardOn && !atBoard) { _boardOn = false; renderStation(); }
    return;
  }
  if (room === 'hub') {
    var who = (h && h.near && h.near.npc) ? h.near.npc : '';
    if (_hubNpc && _hubNpc !== who) {
      _hubNpc = '';
      talkReset();
      renderHub();
      return;
    }
    /* R41 · 打字机 / 自动：**每显示帧推进一次**。
       ⚠ 为什么推进放在这里而不是 `renderHub` 里：`renderHub` 会被重画调用很多次
         （任何一次界面刷新都会），在渲染里推进等于"重画一次就多打一个字" ——
         帧率会变成打字速度。这里是"每一显示帧恰好一次"的那一处
         （main.ts 对 hall 那两屏每帧调一次，与帧率无关地喂 dt）。

       ⚠ `_talkLine` 是"当前这一句的**身份**"（`说话人:序号:分支id`）：
         它一变就说明换句了，计时必须归零 —— 否则新句会**接着上一句的进度**打
         （表现是"有时候一句话一出来就是完整的"，而这是最容易漏掉的一处）。 */
    if (_hubNpc) {
      var line = talkLineNow();
      if (line) {
        var sig = _hubNpc + ':' + _talkIdx + ':' + (_talkBranch ? _talkBranch.id : '');
        if (sig !== _talkLine) { _talkLine = sig; _talkLineT = 0; _talkSkip = false; }
        var prev = Dialogue.indexAt(line.text, _talkLineT);
        /* 用**固定步长**推进（不是真实 dt）：无头测试与 2× 速度下打字速度一致，
           而且"重画"与"打字"彻底解耦（见上面那条）。 */
        _talkLineT += Game.cfg.fixedDt;
        if (Dialogue.done(line.text, _talkLineT)) {
          /* 自动模式：露完再停 `HOLD_SEC` 就往下走 */
          if (Dialogue.autoDue(line.text, _talkLineT, _talkAuto)) {
            if (Profile.hasChoices(line) && !_talkBranch) {
              /* 有选项的那一句**不自动往下走**：那等于替玩家做了选择。
                 停在"打完了"的状态上等他点（计时不再涨，所以不会反复触发）。 */
              _talkLineT = Dialogue.durationOf(line.text);
            } else {
              hubSay();
              return;
            }
          }
        }
        /* 只有"露出的字数变了"才重画 —— 否则每帧重建一次 DOM（60 次/秒） */
        if (_talkSkip || Dialogue.indexAt(line.text, _talkLineT) !== prev) renderHub();
      }
    }
    return;
  }
  /* 不在屋里（暂停菜单 / 已经换屏）：两样都收起来，下次进来是干净的 */
  if (_boardOn || _hubNpc) { _boardOn = false; _hubNpc = ''; talkReset(); }
}

/* =========================================================
   大厅（站）——**局内**的起点，不是菜单
   ---------------------------------------------------------
   用户的设想（这一屏存在的全部理由）：「点击开始游戏选择角色存档，
   进入游戏大厅，然后选择去往各个不同的游戏模块地图进行游玩」
   （挺进地牢 / 深岩银河那一类）。

   界面只剩**一样**东西（2026-10 两轮：先"完全没必要再显示这个了"删掉站点卡，
   再"底部只剩一行操作提示 不需要"删掉那行提示）：
     · 底栏两个按钮 ——「枢纽」（这一局的**家**：NPC / 剧情那几站，枢纽也归局内）
       与「回标题」。这两个的去处**不在这间屋里**，所以它们才留在 HUD 上；
       "有人想说新话"的角标跟着「枢纽」走（角标 id 还是 `hub-news`，只是位置搬了）
   ⚠ 操作提示也不在 HUD 上：怎么走、怎么交互由**画面里**回答 —— 走近门 / 人 /
     板子时 `render.ts` 在**那件东西头上**写一行"按 E …"（`drawHallPrompt`），
     键位全表在「说明」那一屏。屏幕底下常驻一行解释，是这一屏最后的旧菜单残留。
   ⚠ 三道门与状态带**不再画在 HUD 上**：门在屋里摆着（走过去就进，门表仍然在
     `station.ts`，界面不自己造门），账在公告板上（走到跟前按 E 才摊开）。
     屋里有的东西不再在屏幕底下复制一份按钮列表 —— 那是旧菜单的残留。

   ⚠ 大厅**归局内**（见 scene.ts 的 station 一档）：没有会话时什么都不画，
     而不是抛异常。界面的三张表（RENDERERS / REFRESH / ACTIONS）会在测试里
     被当成"任意状态都能渲染"逐个走一遍 —— 抛异常等于整条链路断在那里。
   ========================================================= */

/** 账目那一带：这一局攒下了什么（四本账 + 战斗代币；核心素材归公告板） */
function stationStatusHtml(sess: Session) {
  var rows: { k: string; v: string; warn?: boolean }[] = [
    { k: '材料', v: Game.material() + '（全局货币：三个模块的行动成本）' },
    { k: '战斗', v: Math.round(sess.player.scrap) + '（战斗代币：只在本模块花）' },
    { k: '产能', v: Game.capacity() + '（经营代币）' },
    { k: '成长', v: Game.growth() + '（养成代币）' }
  ];
  /* 材料见底 = 三个模块都推不动（Guide 的第一条规则），所以这里要显眼 */
  if (Game.material() < 10) rows.push({ k: '提示', v: '材料见底了 —— 出击打一波', warn: true });
  var html = '';
  rows.forEach(function (r) {
    html += '<span class="acct-item' + (r.warn ? ' warn' : '') + '"><b>' + r.k + '</b> ' + r.v + '</span>';
  });
  return html;
}

/**
 * 公告板：**走到跟前按 E** 才摊开的那块板（走开自动收，见 `hallSync`）。
 *
 * 改造前它是常驻状态带 + 一排站点卡里的一格 —— 于是"这一局攒了什么"
 * 与"屋里有哪三道门"各在屏幕上复制了一份。现在屋里有的东西不再复制，
 * 账也只在一个地方读：这里。
 *
 * 一行一节，来源各自清楚：
 *   · 四本账   —— 这一局攒下的（`stationStatusHtml`）
 *   · 档案那一带 —— 跨局的（核心素材是**钥匙不是钱**，不在任何账本里，见 link.ts）
 *   · 下一步 / 这一波还剩 —— 软引导（v3 §8-15）与"模块内时间感独立"（§8-12）
 */
function renderBoard() {
  if (!el.stationBoard) return;
  var sess = Game.getSession();
  var st = Game.hall();
  var show = _boardOn && !!sess && !!st && st.room === 'station';
  el.stationBoard.hidden = !show;
  U.clear(el.stationBoard);
  if (!show) return;

  el.stationBoard.appendChild(U.el('div', 'acct-head', '公 告 板'));
  var live = U.el('div', 'acct-band');
  live.innerHTML = stationStatusHtml(sess);
  el.stationBoard.appendChild(live);
  var prof = U.el('div', 'acct-band');
  prof.innerHTML = profileStatusHtml();
  el.stationBoard.appendChild(prof);
  el.stationBoard.appendChild(U.el('div', 'tx-line',
    '核心素材：核心 ' + Profile.core() + ' · 遗物 ' + Game.relic() + ' · 徽记 ' + Game.sigil()));
  /* ⚠ `null` 不是"没有建议" —— 那是**循环转起来了**，换个说法（不然玩家会以为坏了） */
  var gd = Game.guide();
  el.stationBoard.appendChild(U.el('div', 'tx-line',
    gd ? ('下一步：' + gd.text) : '循环转起来了 —— 三个模块随便挑一个推'));
  var wb = Game.waveBudget();
  if (wb) {
    el.stationBoard.appendChild(U.el('div', 'tx-quiet',
      '这一波还剩 —— 出击：实时 · 工坊产线 ' + wb.craftLines + ' 条 · 训练 ' +
      wb.trainLeft + ' 次 · 相处 ' + wb.talkLeft + ' 次'));
  }
}

function renderStation() {
  /* 枢纽的入口在这一屏的底栏（枢纽也**归局内**）：有人想说新话的角标跟着它走。
     ⚠ 角标 id 仍然是 `hub-news`（界面契约按 id 认元素），只是位置从标题页搬到了这里。 */
  if (el.hubNews) el.hubNews.hidden = !Profile.hasStoryNews();
  /* 换屏/离屏之后把板子收起来：进来时是干净的，不会看到上一次的账 */
  var here = Game.hall();
  if (!here || here.room !== 'station') _boardOn = false;

  renderBoard();
}

/**
 * **词条图鉴**（`词 条` 那一页）。
 *
 * 为什么必须有这一页：词条在界面上**只在商店出现**，而且只有卡片那么大的地方 ——
 * 玩家没有任何地方能回答三个问题：
 *   ① 一共有哪些词条？  ② 这条词条到底加什么？  ③ 这件装备能滚出哪些？
 * 而这三件事系统内部**一直算得出来**（`Affixes.LIST` / `MODS[mod].note` /
 * `Affixes.pool(kind, def)` / `Affixes.wrongReason`）—— 只是从来没有出口。
 *
 * 改造前更糟的是"含义"根本没渲染：`MODS` 16/16 都写了 note、`FAMILIES` 2/2 也写了，
 * 而 `Affixes.html` 的 title 只有 `"锋锐 · 前缀 T1"` —— 于是
 * `锋锐 +6%`（武器伤害）、`远见 +6%`（攻击范围）、`加速 +6%`（攻击速度）
 * 在卡片上长得一模一样。这一页把 note 摆到明面上。
 *
 * 每一行给出四件事：**是哪一类**（前缀/后缀）、**加什么**（note）、
 * **能落在哪**（槽位 + 细分标签）、**每一档给多少**（阶梯，T1 到该条的 cap）。
 */
function renderAffixBlock() {
  if (!el.codexAffixes) return;
  var html = '';
  var fams = ['prefix', 'suffix'];
  for (var fi = 0; fi < fams.length; fi++) {
    var famId = fams[fi];
    var fam = Affixes.FAMILIES[famId];
    html += '<div class="codex-group">' + (fam ? fam.name + ' —— ' + fam.note : famId) + '</div>';
    for (var i = 0; i < Affixes.LIST.length; i++) {
      var d = Affixes.LIST[i];
      if (d.family !== famId) continue;
      var meta = Affixes.MODS[d.mod] || { note: '（表里没写说明）' };
      /* 能落在哪：把声明式槽位展开成能读的一段话（`armor:heavy` → "护具（仅重型）"） */
      var slots = [];
      for (var si = 0; si < d.slots.length; si++) {
        var ps = Affixes.parseSlot(d.slots[si]);
        var baseName = ps.base;
        for (var k = 0; k < Affixes.SLOTS.length; k++) {
          if (Affixes.SLOTS[k].base === ps.base) baseName = Affixes.SLOTS[k].name;
        }
        slots.push(baseName + (ps.tag ? '（仅' + ((Affixes.TAGS[ps.tag] || {}).name || ps.tag) + '）' : ''));
      }
      /* 阶梯：从 T1 到这条自己的 cap（用"这一档的最低值"当代表，单调性一眼看得出来） */
      var ladder = [];
      for (var t = 1; t <= d.cap; t++) {
        var lo = Math.abs(d.per) * (t - 1) + 1;
        ladder.push(Affixes.line({ id: d.id, t: t, v: d.per < 0 ? -lo : lo }));
      }
      html += '<div class="set-row"><span class="set-label">' +
        '<b>' + d.name + '</b>（' + d.en + '）：' + meta.note +
        '</span><span class="set-value">' + slots.join(' / ') + '</span></div>';
      html += '<div class="set-row"><span class="set-label" style="opacity:.65">' +
        '　T1→T' + d.cap + '：' + ladder.join(' → ') +
        '　·　权重 ' + d.w + '（只影响滚出来的概率，不影响强弱）' +
        '</span></div>';
    }
  }
  /* 滚的规则：`Affixes.pool` 一直算得出"这件装备能滚出哪些"，但没必要为 55 件装备各画一行 */
  html += '<div class="codex-group">怎么滚</div>';
  var rc = [];
  for (var tt = 1; tt <= 5; tt++) rc.push('T' + tt + ' 给 ' + Affixes.rollCount(tt) + ' 条');
  html += '<div class="set-row"><span class="set-label">' +
    '条数跟着<b>装备品级</b>：' + rc.join(' · ') +
    '；每条词条的<b>档位</b>上限 = min(装备品级, 该词条的 cap) —— 所以 T4 装备上的词条明显强于 T1/T2' +
    '</span></div>';
  html += '<div class="set-row"><span class="set-label">' +
    '落在哪由<b>装备自己的槽位与标签</b>决定（<code>Affixes.pool</code>）；同一件上不会出现两条同名；' +
    '合成两把同名武器时<b>各取更好的那一条</b>（<code>Affixes.merge</code>）' +
    '</span></div>';
  el.codexAffixes.innerHTML = html;
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
  var owned = Game.keepOwned();
  var spores = Game.growth();
  var core = Profile.core();

  var head = setRow('材料', String(Game.material()));
  /* **产能**（M2）：经营自己的钱。与材料并列显示 —— 它们**是两种钱**：
     材料是全局货币（出击打出来的行动成本），产能是经营模块自己运转出来的。 */
  head += setRow('产能', Game.capacity() + '（每波 +' + Game.capacityPerWave() + '）');
  /* **核心素材**（M4）：它们**不在任何账本里**（见 `link.ts`）——
     模块代币"产出与消费都在本模块"，而核心素材的存在意义就是**跨模块**。
     所以它们单独一行，与那四本账并列。 */
  head += setRow('核心素材', '遗物 ' + Game.relic() + ' · 徽记 ' + Game.sigil() +
    '（遗物：经营的关键建筑产出 → 图纸花；徽记：养成走通一条线产出 → 战斗花）');
  /* 核心材料单列一行：它是**唯一**一种"只有关底 Boss 掉"的资源，
     玩家看到这一行才知道"那 2 个数字要去哪挣"（而不是以为它又是孢子）。 */
  head += setRow('核心材料', String(core) + '（只有关底 Boss 掉）');
  head += setRow('已投入', Game.keepInvested() + ' 材料（这一局投的，不退还）');
  // **文案不在这里写** —— 键自己带文案（stronghold.ts 的 MOD_KEYS），
  // 界面只负责把折叠出来的修正翻成人话。新增一个键不需要动这个文件。
  var eff = Keep.effectLines(Game.keepMods());
  head += setRow('当前效果', eff.length ? eff.join(' · ') : '（无）');
  head += setRow('两条循环', '据点解锁能力（产线 / 目录 / 离线）→ 出击收集、工坊制造 → 打得更深 → 更多孢子 → 据点更强');
  head += setRow('前置链', '有些设施要先有别的（例如档案馆要钟楼）—— 【顺序本身也是决策】');
  el.keepHead.innerHTML = head;

  var html = '';
  Keep.LIST.forEach(function (d) {
    /* 等级走 `Game.keepLevel`（据点是**局内**的，界面不自己 `levelOf`）。 */
    var lvl = Game.keepLevel(d.id);
    /* ⚠ 产能也要传进来 —— 它是**建造子模块的钱**（M2）。界面与实际扣费用同一个
       `canBuy`，所以显示的价格与真正扣的必然一致。 */
    var chk = Keep.canBuy(owned, d.id, spores, core, Game.capacity());
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
      /* 造价在这里就**说全**：材料 + 产能（+ 核心材料）。
         三样缺哪一样都在按钮**之前**讲清楚 —— 让玩家点下去才发现缺东西是最差的一种顺序。 */
      var needCap = Keep.capacityFor(d.levels[lvl]);
      nextTxt = '下一级：' + parts.join('、') +
        (needCap > 0 ? '　【另需产能 ' + needCap + '】' : '') +
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
  var alloy = Game.growth();
  var owned = Game.forgeOwned();
  var mods = Game.forgeMods();
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
    var has = Game.isForged(d.id);
    var chk = Game.canForge(d.id);
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
  var state = Game.campOwned();
  var row = Game.campRow();
  var opts = Game.campOpts();
  var mats = Math.round(Game.material());
  var used = Camp.usedSlots(state);
  var fx = Game.campFx();
  var active = Camp.combosFor(row);
  var lines = Game.craftLines();
  var free = Game.craftFreeLines();

  /* ⚠ 这里是**纯文本**，不是 markdown —— 以前写着 `**带得出局**`，玩家看到的就是四个星号
     （`ui-shot` 的"文案可疑"那一栏抓的就是这一类：它扫渲染出来的文本里的 `**`）。 */
  var head = setRow('材料', String(mats) + '（出击打出来的，带得出局；建产线与制造都花这一笔）');
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
  head += setRow('设施是「跨局」的', '盖好就一直有；换一局不用重盖（这也是它和商店最大的区别）');
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
/* =========================================================
   技能构筑（**角色身份**；与天赋那份局外成长分开）
   ---------------------------------------------------------
   界面上只有两件事：**这是哪个角色** 与 **两张卡各选了什么**。
   所有规则（能不能打、候选有哪几个、折出来是什么）都在 `skills.ts` 里 ——
   界面不重写一份，否则「界面允许打、折叠时忽略」会在某一天悄悄出现。
   ========================================================= */
function renderSkills() {
  if (!el.skillCards) return;
  var charId = UI.skillChar;
  if (!Chars.BY_ID[charId]) { charId = UI.skillChar = Chars.LIST[0].id; }
  var cd = Chars.BY_ID[charId];
  var tree = Skills.treeFor(charId);
  var taken = Profile.skillBuild(charId);

  /* 角色切换条（与天赋屏同一套：隐藏角色要解锁了才出现） */
  var bar = q('skill-char');
  if (bar) {
    U.clear(bar);
    Chars.LIST.forEach(function (c) {
      if (!isCharListed(c)) return;
      var b = U.el('button', 'btn tiny' + (c.id === charId ? ' sel' : ''));
      b.textContent = c.name;
      b.dataset.charPick = c.id;
      b.dataset.act = 'skill-char';
      bar.appendChild(b);
    });
  }

  if (el.skillWho) {
    el.skillWho.textContent = cd.name + ' · ' + cd.tag +
      '　——　每个角色的技能与构筑都不一样（先选战斗方式，再选改造器）';
  }

  var html = '';
  if (!tree) {
    html = setRow('技能树', '这个角色还没有技能树（表里漏了他）');
  } else {
    tree.cards.forEach(function (card) {
      var picked = Skills.pickedOn(taken, card.id);
      html += setRow(card.name + '（' + card.note + '）',
        picked ? '已选：<b>' + Skills.nameOf(picked) + '</b>' : '（还没选）');
      card.options.forEach(function (opt) {
        var isPicked = picked === opt;
        var chk = isPicked ? { ok: false, reason: '已经选了这个' } : Skills.canPick(charId, card.id, opt, taken);
        var btn;
        if (isPicked) btn = '<button class="btn tiny" disabled>已选 ✓</button>';
        else if (chk.ok) btn = '<button class="btn tiny" data-act="skill-pick" data-card="' + card.id + '" data-opt="' + opt + '">选这个</button>';
        else btn = '<button class="btn tiny" disabled title="' + chk.reason + '">不可选</button>';
        html += '<div class="set-row"><span class="set-label">' +
          (card.kind === 'skill' ? '技能' : '符文') + ' <b>' + Skills.nameOf(opt) + '</b> —— ' +
          Skills.describe(opt) + '</span><span class="set-value">' + btn + '</span></div>';
      });
    });

    /* 折出来的结果：**唯一出口**直接显示 —— 玩家该看到「我这一局会放什么」，
       而不是自己把两张卡在脑子里折一遍。 */
    var fold = Profile.skillsFor(charId);
    var rows = [];
    fold.slots.forEach(function (sl) {
      rows.push(sl.name + '：冷却 ' + sl.cd + 's · 能量 ' + sl.cost +
        '　（' + Skills.FORMS[sl.form].note + ' × ' + Skills.PAYLOADS[sl.payload].note + '）');
    });
    html += setRow('这一局会放什么', rows.length ? rows.join('<br>') :
      '（还没有技能 —— 上面两张卡都选一个就有了；也可以直接开局，那样就是纯武器）');
  }
  el.skillCards.innerHTML = html;
}


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

  /* =========================================================
     **训练面板：养成模块的局内行动**（M3，2026-09）
     ---------------------------------------------------------
     养成模块的**产出**（`growth`）以前产在战斗端（结算按波次/合成发），
     而 v3 §5.2 没有"战斗 → 养成"那条边。现在产出点在这里：
     **花材料（行动成本）换成长点**，每波限次。
     ⚠ 它同时是 v3 要的**撞墙**：不训练 → 成长点不够 → 下面那些天赋点不动，
       但战斗与经营照常（游戏没有不让玩家继续）。
     ========================================================= */
  if (el.trainList) {
    U.clear(el.trainList);
    var tLeft = Game.trainingLeft();
    var trHead = U.el('div', 'set-row');
    trHead.appendChild(U.el('span', 'set-label', '训练（这一波还能 ' + tLeft + ' 次）'));
    trHead.appendChild(U.el('span', 'set-value', '材料 ' + Game.material() + ' → 成长点 ' + Game.growth()));
    el.trainList.appendChild(trHead);
    Game.trainingOptions().forEach(function (o) {
      var trRow = U.el('div', 'set-row');
      trRow.appendChild(U.el('span', 'set-label', o.name + ' —— ' + o.note));
      var trVal = U.el('span', 'set-value');
      if (o.ok) {
        var trBtn = U.el('button', 'btn tiny', '花 ' + o.cost + ' → +' + o.gain);
        trBtn.dataset.act = 'train-do';
        trBtn.dataset.drill = o.id;
        trVal.appendChild(trBtn);
      } else {
        trVal.appendChild(U.el('span', 'set-note', o.reason));
      }
      trRow.appendChild(trVal);
      el.trainList.appendChild(trRow);
    });
  }
  /* =========================================================
     **NPC 关系面板：v3 §8-3 的"共享关系状态"**
     ---------------------------------------------------------
     叙事线（`story.ts` 的台词）与养成线（相处）读的是**同一份**信任值；
     但只有养成这一侧能改经济 —— 相处**跨过关系阶段**时产成长点。
     ⚠ §6.5：NPC 互动**不能花战斗/经营的钱**，所以这里没有价钱，只有"这一波还能聊几次"。
     ========================================================= */
  if (el.bondList) {
    U.clear(el.bondList);
    var bHead = U.el('div', 'set-row');
    bHead.appendChild(U.el('span', 'set-label', '关系（每位每波 ' + Bonds.TALK_PER_WAVE + ' 次）'));
    bHead.appendChild(U.el('span', 'set-value', '聊到新阶段会给成长点'));
    el.bondList.appendChild(bHead);
    Game.bondsAll().forEach(function (b) {
      var bRow = U.el('div', 'set-row');
      bRow.appendChild(U.el('span', 'set-label', b.stageName + ' —— ' + b.note +
        (b.nextName ? '（再 ' + b.toNext + ' 次信任到「' + b.nextName + '」）' : '（已到顶）')));
      var bVal = U.el('span', 'set-value');
      if (b.left > 0) {
        var bBtn = U.el('button', 'btn tiny', '相处（还剩 ' + b.left + ' 次）');
        bBtn.dataset.act = 'bond-talk';
        bBtn.dataset.npc = b.id;
        bVal.appendChild(bBtn);
      } else {
        bVal.appendChild(U.el('span', 'set-note', '这一波聊够了'));
      }
      bRow.appendChild(bVal);
      el.bondList.appendChild(bRow);
    });
  }
  /* =========================================================
     **兑换面板**（M5，v3 §5.3 + §7-12）
     ---------------------------------------------------------
     模块代币之间**唯一**合法的通道。四条限制（高税 / 限额 / 单向 /
     消耗全局货币）都写在表里，这里只负责把**为什么贵**说出来 ——
     不说的结果就是玩家换一次觉得亏，然后再也不碰。
     ========================================================= */
  if (el.exchangeList) {
    U.clear(el.exchangeList);
    var exHead = U.el('div', 'set-row');
    exHead.appendChild(U.el('span', 'set-label', '兑换（模块代币之间 · 单向 · 亏一截）'));
    exHead.appendChild(U.el('span', 'set-value', '换的是近路，不是主路'));
    el.exchangeList.appendChild(exHead);
    Game.exchangeOpts().forEach(function (o) {
      var amt = Math.min(o.cap > 0 ? o.cap : 1, o.have);
      var exRow = U.el('div', 'set-row');
      exRow.appendChild(U.el('span', 'set-label', o.note + '（在「' + o.from + '」换）'));
      var exVal = U.el('span', 'set-value');
      if (o.ok) {
        var exBtn = U.el('button', 'btn tiny',
          '换 ' + amt + ' → ' + Math.max(1, Math.floor(amt * o.rate)) + '（手续费 ' + o.fee + ' 材料）');
        exBtn.dataset.act = 'exchange-do';
        exBtn.dataset.from = o.from;
        exBtn.dataset.to = o.to;
        exBtn.dataset.n = String(amt);
        exVal.appendChild(exBtn);
      } else {
        exVal.appendChild(U.el('span', 'set-note', o.reason));
      }
      exRow.appendChild(exVal);
      el.exchangeList.appendChild(exRow);
    });
  }

  var earned = Game.talentEarned();
  var spent = Game.talentSpent();
  var free = Game.talentFree();
  var taken = Game.talentsOf();
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
  /* ⚠ **洗点现在算在局内**（M3）：次数是这一局的（`Game.respecsUsed`），
     价钱与 `Game.respecTalents` 用同一个算法 —— 两处漂了的话界面显示的和实际扣的对不上，
     而那一类错**不报错**，只是悄悄骗玩家（`talents.mjs` 有一条断言盯着）。 */
  var freeLeft = Math.max(0, Talent.FREE_RESPECS - Game.respecsUsed());
  var nextCost = Talent.respecCost(Game.respecsUsed(), { free: Talent.FREE_RESPECS, discount: 0 });
  head += setRow('洗点', '免费还剩 ' + freeLeft + ' 次，之后每次 ' + nextCost +
    ' 材料（当前成长点 ' + Game.growth() + '）');
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
  var bedLv = Game.keepMods().offlineLevel;
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
   事件接入
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

  /* 「开始游戏」→ **选存档**（R50），不是直接进选人页。
     用户的流程原话：「点击开始游戏按钮，**选择存档**，进入游戏，
     第一个到的是大厅再通过大厅前往不同的模块」。 */
  'start': function () {
    _slotView = Slots.current();
    Game.setState('slots');
  },

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

/* =========================================================
   R50 · 选存档与捏人的动作
   ---------------------------------------------------------
   六个动作，分两组：
     · `slots` 那一屏：「继续这个档」（有人的档）/「开始新档」（空档），
       外加导出 / 导入 / 清空本档（**从设置里搬过来的** ——
       槽位的事现在有它自己的那一屏，摆在设置里等于把玩法入口当地选项）
     · `create` 那一屏：三样外观各一个动作、入门三选一个、随机一套、换职业
   ========================================================= */
var ACT_SLOTS: ActMap = {

  'slot-continue': function () {
    /* 「继续」= 用**这个档的那个人**开局，走的是**同一个**开局入口
       （`UI.startRun`）—— 不许另开一条只传角色的路：R38 那个 bug
       （技能构筑从来没被传进任何一局）就是这么长出来的。 */
    var me = Profile.character();
    if (!me) { UI.toast('这个档里没有人（先"开始新档"）', 'warn'); return; }
    UI.selectedChar = me.charId;
    UI.startRun();
    UI.toast('继续 · ' + me.name, 'good');
  },

  'slot-new': function () {
    /* 「开始新档」→ 选职业（`chars`）→ 捏人（`create`）。
       选职业那一屏已经存在（9 个角色 + 难度），不必再造一屏 ——
       捏人页只负责"外观 / 名字 / 入门三选"，职业显示在它顶上。 */
    Game.setState('chars');
  },

  'slot-export': function () {
    var text = Slots.exportText();
    var ok = U.copyText(text);
    UI.toast(ok ? I18n.t('存档已复制') : ('导出（复制失败，请手动选中）：' + text.slice(0, 60) + '…'),
      ok ? 'good' : 'warn');
  },

  'slot-import': function () {
    U.readClipboard(function (text) {
      var r = Slots.importText(text);
      if (!r.ok) { UI.toast('导入失败：' + r.reason, 'warn'); return; }
      Profile.load();
      var me = Profile.character();
      if (me) UI.selectedChar = me.charId;
      buildCharSelect();
      renderSlots();
      UI.toast(I18n.t('存档已导入'), 'good');
    });
  },

  'slot-wipe': function () {
    if (!armed('wipe-slot', refreshConfirmLabels)) return;
    Slots.reset(_slotView);
    Profile.load();
    buildCharSelect();
    renderSlots();
    UI.toast('存档 ' + (_slotView + 1) + ' 已清空（连备份一起）', 'warn');
  }
};

var ACT_CREATE: ActMap = {

  'create-palette': function (t) { setLook({ palette: (t.dataset && t.dataset.id) || '' }); },
  'create-face': function (t) { setLook({ face: (t.dataset && t.dataset.id) || '' }); },
  'create-accessory': function (t) { setLook({ accessory: (t.dataset && t.dataset.id) || '' }); },

  'create-pick': function (t) {
    var col = (t.dataset && t.dataset.col) || '';
    var id = (t.dataset && t.dataset.id) || '';
    if (col === 'skill' || col === 'stat' || col === 'talent') setEntry(col, id);
    else UI.toast('认不出的那一列：' + col, 'warn');
  },

  'create-random': function () {
    /* 种子化而不是 `Math.random`：捏人页要能被测试"点一下、看到什么、断言什么"，
       而且"随机出来那套好看、再点两下找回来"要复现得出来
       （见 `Character.randomLook`；界面只通过 `Game` 那一个口拿它）。
       名字**不随机** —— 那是玩家自己的事。 */
    _createSeed = (_createSeed * 1103515245 + 12345) >>> 0;
    Game.setCharacterMeta({ look: Game.randomLook(_createSeed) });
    renderCreate();
    if (Sfx) Sfx.click();
  },

  'create-job': function () {
    /* 「换职业」回选人页 —— 两边是**同一份存档角色**（改的是 `charId`） */
    Game.setState('chars');
  },

  'create-go': function () {
    /* 「确定 · 开始冒险」：名字从输入框读回来（玩家可能刚打完字没失焦）。 */
    if (el.createName) {
      Game.setCharacterMeta({ name: (el.createName as HTMLInputElement).value });
    }
    var me = Profile.character();
    if (!me) { UI.toast('还没有人（先捏一个）', 'warn'); return; }
    UI.selectedChar = me.charId;
    _draftSlot = -1;                 // 出发了 —— 这个人正式是这个档的人，不再可撤回
    UI.startRun();
    UI.toast('出发 · ' + me.name + '（' + (Chars.BY_ID[me.charId] || { name: me.charId }).name + '）', 'good');
  }
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
   于是这条校验红了。它红得对：那一组里同时住着"开关""循环切档""改键"
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

/**
 * **唯一**的开局入口：把"一局该带哪些局外状态"在这一个函数里凑齐。
 *
 * 为什么必须只有一处：改造前它有**两份**，而且两份都漏东西 ——
 *   · 选人页的「出发」传了 `opening` 与 `smods`，**漏了 `skillBuild`**；
 *   · 标题页的回车（`main.ts` 那条 `Game.newRun(UI.selectedChar)`）只传了角色，
 *     `opening` / `smods` / `skillBuild` **全漏**。
 *
 * 漏 `skillBuild` 的后果是**整个技能系统在正式游戏里从不发生**：
 * `Game.newRun` 内部是 `applySkillBuild(S, charId, skillBuild || [])`，
 * 空构筑 ⇒ 0 个技能槽 ⇒ `updateSkills` 第一行 `if (!S.skills.slots.length) return;` 直接返回。
 *
 * 实测（`.probe-skill2.mjs` 那一轮）：
 *   · 选人页的写法 → 技能槽 **0**
 *   · 显式把构筑传进去 → 技能槽 **1**，6 局释放 **2044** 次、命中 **6129** 次
 * 所以系统本身是好的，**断的就是这一根线**。
 *
 * 为什么一直没被发现：`test/skill.mjs` 全程用 `Game.newRun(…, null, null, build)`
 * 六参数形式 —— 它验的是模拟层，恰好**绕过**了这根线。测试全绿，玩家看不到技能。
 *
 * ⚠ 传的是 **`Profile.skillBuild`（构筑：打过哪几张卡）**，不是 `Profile.skillsFor`
 * （折好的载荷）—— `newRun` 收下构筑之后自己调 `Skills.fold` 折。
 * 这一点第一版写错过，是 `tsc` 抓的（载荷的类型对不上参数类型）。
 *
 * ⚠ 演示态（`main.ts` 的 `mode === 'loading' | 'end'`）、`Demo.stage`、`cli` 的无头跑
 * **刻意**不走这里：它们不吃局外状态（要的是可复现的固定场景）。
 */
UI.startRun = function () {
  Game.newRun(UI.selectedChar, undefined, UI.selectedDanger,
    Profile.openingOf(UI.selectedChar),
    /* ⚠ **据点从空开始**：它是**局内的**（v3 §二 —— 属于经营模块的建造那一半），
       每一局自己盖。以前这里传 `Profile.keepOwned()`（账号里的跨局资产）。
       ⚠ 别改成 `Game.keepOwned()`：开局这一刻还没有会话，它**碰巧**也是空的 ——
       而"碰巧对"会在下一个人加了一行之后变成错。就写 `{}`。
       图纸（`forge`）暂时仍然是账号资产，M3 搬。 */
    { owned: {}, forge: Game.forgeOwned() },
    Profile.skillBuild(UI.selectedChar));
  /* **开局落在大厅（站）**，不是直接落进战斗里：三个模块都在**局内**的
     一张图上，玩家从大厅的门去各个模块（用户的设计原话见 station.ts 顶部）。
     ⚠ 这是**界面层**的决定：`Game.newRun` 自己仍然落 `playing` ——
        挑战 / CLI / 无头测试那几条路直接吃 `newRun`，不该被界面的设计拖着走
        （`test/persist.mjs` / `smoke.mjs` / 行为指纹都在那几条路上）。 */
  Game.setState('station');
};

var ACT_CHARS: ActMap = {

  'back-slots': function () {
    /* ⚠ 「返回」要**撤回一个刚建起来、还没出发的角色**：
       进捏人页那一刻就已经建了人，而玩家如果只是点进来看看就退回去，
       这个档不该从此变成"有人"—— 否则下一次点「开始新档」会直接跳过捏人
       （判据是"这个档里有没有人"）。
       判据用**记账**（`_draftSlot`）而不是"名字是不是缺省名"这类猜测：
       只有**这一次**由捏人页建起来的人才会被撤回，老档永远不会被误删。 */
    if (_draftSlot === Slots.current()) {
      /* 撤回那个刚建起来、还没出发的人。
         ⚠ 只拿掉"人"这一格，**不碰进度** —— 玩家点进捏人页看了看再退出来，
           不该顺手清掉这个档的孢子与图鉴（所以不用 `Profile.reset`）。
         ⚠ 而且它**必须落盘**（`dropCharacter` 自己会写）：`Profile.load()`
           拿存储里那一份覆盖内存，只清内存的话切一次槽位他就回来了 —— 实测踩过。 */
      Profile.dropCharacter();
      _draftSlot = -1;
      buildCharSelect();
    }
    Game.setState('slots');
  },

  'confirm-char': function () {
    /* 门槛只在界面这一层：锁着的角色由按钮 disabled 挡住，这里再兜一次
       （手柄/键盘走的是 .click()，disabled 元素点不动，但焦点机制仍可能调到） */
    if (!isCharAvailable(Chars.BY_ID[UI.selectedChar])) {
      UI.toast('这个角色还没解锁：' + charUnlockHint(UI.selectedChar), 'warn');
      return;
    }
    /* **这个档已经有人** → 选人页就是"换职业"，直接拿他开局（老档继续那条路）。
       **还没有人** → 往下走一步到捏人（R50 的流程：选职业 → 捏人 → 出发）。 */
    var me = Profile.character();
    if (Game.hasCharacter() && me) {
      if (me.charId !== UI.selectedChar) Game.setCharacterMeta({ charId: UI.selectedChar });
      UI.startRun();
      UI.toast('出发 · ' + me.name +
        (UI.selectedDanger > 0 ? '（难度 ' + UI.selectedDanger + ' · ' + Danger.name(UI.selectedDanger) + '）' : ''), 'good');
      return;
    }
    Game.setState('create');
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
  /* **用徽记刷新**（M4）：徽记是养成走通一条能力线产出的，回到战斗里花。 */
  'reroll-sigil': function () {
    if (!Game.rerollWithSigil()) { UI.toast('没有徽记（走通一条天赋线才产）', 'warn'); return; }
    UI.toast('用徽记刷新了一次', 'good');
    renderShop();
  },
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
      if (fd) UI.toast('工坊建成：' + fd.name + ' Lv.' + Game.campLevel(fid), 'good');
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
  /* 训练一次：规则在 `training.ts`，钱与状态在会话（见 `Game.train`）。 */
  /* 兑换一次：四条限制的判定在 `Ledger.canExchange`，钱在会话（见 `Game.exchange`）。 */
  'exchange-do': function (t) {
    var from = (t.dataset && t.dataset.from) || '';
    var to = (t.dataset && t.dataset.to) || '';
    var n = Number((t.dataset && t.dataset.n) || 0);
    var r = Game.exchange(from, to, n);
    if (r.ok) UI.toast('换到 ' + r.got + '（手续费 ' + r.cost + ' 材料）', 'good');
    else UI.toast(r.reason, 'warn');
    renderTalents();
  },
  'train-do': function (t) {
    var drill = (t.dataset && t.dataset.drill) || '';
    var r = Game.train(drill);
    if (r.ok) UI.toast('+' + r.gain + ' 成长点（花了 ' + r.cost + ' 材料）', 'good');
    else UI.toast(r.reason, 'warn');
    renderTalents();
  },
  /* 相处一次：规则在 `bonds.ts`，状态在会话（见 `Game.talkTo`）。 */
  'bond-talk': function (t) {
    var npc = (t.dataset && t.dataset.npc) || '';
    var r = Game.talkTo(npc);
    if (r.ok) UI.toast(r.gain > 0 ? ('关系进了一步 · +' + r.gain + ' 成长点') : '聊了几句', r.gain > 0 ? 'good' : undefined);
    else UI.toast(r.reason, 'warn');
    renderTalents();
  },
  'talent-take': function (t) {
    var nodeId = (t.dataset && t.dataset.talent) || '';
    var r = Game.takeTalent(nodeId);
    if (r.ok) UI.toast('已点：' + (Talent.BY_ID[nodeId] ? Talent.BY_ID[nodeId].name : nodeId), 'good');
    else UI.toast(r.reason, 'warn');
    renderTalents();
  },
  'talent-undo': function () {
    var list = Game.talentsOf();
    if (!list.length) { UI.toast('还没点过天赋', 'warn'); return; }
    // 撤销上一点是**免费**的：误点不该被罚；换流派才走洗点（有成本）
    Game.undoTalent();
    UI.toast('已撤销上一点', '');
    renderTalents();
  },
  'talent-respec': function () {
    var res = Game.respecTalents(UI.talentChar);
    if (res.ok) {
      UI.toast(res.cost > 0 ? '已洗点（花了 ' + res.cost + ' 孢子）' : '已洗点（免费次数内）', '');
    } else UI.toast(res.reason, 'warn');
    renderTalents();
  },
  /* ---- 技能构筑（与天赋并列的另一块局外成长）---- */
  'skill-char': function (t) { UI.skillChar = (t.dataset && t.dataset.charPick) || ''; renderSkills(); },
  'skill-pick': function (t) {
    var charId = UI.skillChar;
    if (!Chars.BY_ID[charId]) return;
    var res = Profile.pickSkillCard(charId, (t.dataset && t.dataset.card) || '', (t.dataset && t.dataset.opt) || '');
    if (!res.ok) { UI.toast(res.reason, 'warn'); Sfx.deny(); return; }
    /* 打了一张卡之后**重建技能槽**（如果这一局正是这个角色，立刻生效）。
       为什么不是「读档才生效」：技能构筑是局外的东西，
       玩家会期待它马上改掉手感。 */
    if (Game.getSession && Game.getSession() && Game.getSession().charDef.id === charId) {
      Game.refreshSkills(Profile.skillBuild(charId));
    }
    Sfx.buy();
    renderSkills();
  },
  'skill-reset': function () {
    if (!Profile.resetSkillBuild(UI.skillChar)) return;
    if (Game.getSession && Game.getSession() && Game.getSession().charDef.id === UI.skillChar) {
      Game.refreshSkills([]);
    }
    UI.toast('技能构筑已重打（免费）', '');
    renderSkills();
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
    var kr = Game.keepBuy(kid);
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
    var zr = Game.forgeNode(zid);
    if (zr.ok) {
      var zd = Forge.BY_ID[zid];
      UI.toast('图纸解锁：' + (zd ? zd.name : zid) + ' —— ' +
        (zd ? Forge.nodeText(zd) : '') + '（花了 ' + zr.cost + ' 合金）', 'good');
    } else UI.toast(zr.reason, 'warn');
    renderKeep();
  },
};

var ACT_HUB: ActMap = {

  /* ---- 枢纽（N2）：人、话、出门 ---- */
  'hub-back': function () {
    /* 从哪来就回哪去：枢纽是**局内**的一间（大厅 / 暂停都走得进来），不是单向门。
       来处缺失、或已经不可达（测试里强制跳进来那类路径）才退回标题页 ——
       发一个必被拒绝的转换会让按钮看起来"点了没反应"。 */
    var from = Game._hubFrom;
    Game.setState(from && Game.canSetState(from) ? from : 'title');
  },
  'hub-say': function () { hubSay(); },
  /* R41 · 对话补完的四条动作（普查里那几栏 ❌ → ✅） */
  'hub-pick': function (t) { hubPick((t.dataset && t.dataset.choice) || ''); },
  'hub-skip': function () { _talkSkip = !_talkSkip; renderHub(); },
  'hub-auto': function () {
    _talkAuto = !_talkAuto;
    UI.toast(_talkAuto ? '自动：说完就往下走（有选项的那句会停下等你选）' : '自动：关', '');
    renderHub();
  },
  'hub-log': function () { _talkLogOpen = !_talkLogOpen; renderHub(); },
  /* ---- R41 · NPC 交易：**完全没有** → 有 ---- */
  'hub-trade': function () {
    _tradeOpen = !_tradeOpen;
    if (_tradeOpen) {
      /* 摊开的时候把"换的是下一局"讲一次 —— 这是它与商店最容易混的一处 */
      UI.toast('换到的东西进**下一局**的开局携带（商店才是这一局的战力）', '');
    }
    renderHub();
  },
  'trade-buy': function (t) {
    var id = (t.dataset && t.dataset.offer) || '';
    var r = Game.trade(id);
    if (!r.ok) { UI.toast(r.reason, 'warn'); renderHub(); return; }
    var o = Trade.byId(id);
    UI.toast('换到：' + r.got + (o ? '（' + o.name + '）' : '') + ' —— 下一局开局带上', 'good');
    renderHub();
  },
};

var ACT_CODEX: ActMap = {

  'codex-tab': function (t) {
    _codexTab = (t.dataset && t.dataset.tab) || '';
    renderCodexTabs();
  },
};

var ACT_CHALLENGE: ActMap = {

  /* ---- 挑战：实现在 main.ts（种子/角色/录制/成绩码都属于"接入"层）——
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
  slots: ACT_SLOTS,
  create: ACT_CREATE,
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

  /* 大厅 / 枢纽里按 E：模拟层广播"面前是谁 / 面前是什么"，界面决定画哪一句
     （接入层不替界面决定；见 game.ts 的 `Game.hallAct`）。 */
  G.on('hallTalk', function (d) { hallTalk(d && d.id); });
  G.on('hallBoard', function () { hallBoard(); });

  /* R41 · 战斗短句（barks）：模拟层只广播"说了哪一句 + 说的人在哪儿"，
     画在哪、飘多久在这里决定（与 `sfx` 那条"只广播意图"同一条纪律）。
     用一个**时序**（`setTimeout`）把元素收起来 —— 不收的话它会挂着最后一句话
     等下一次触发（而 CSS 动画只跑一次）。 */
  G.on('bark', function (d) {
    if (!el.barkLine || !d || !d.text) return;
    el.barkLine.textContent = String(d.text);
    el.barkLine.hidden = false;
    /* 重新触发动画：先摘掉类、强制重排、再挂回去（否则同一个类不会重播） */
    el.barkLine.classList.remove('on');
    void el.barkLine.offsetWidth;
    el.barkLine.classList.add('on');
    if (_barkTimer !== null) clearTimeout(_barkTimer);
    _barkTimer = setTimeout(function () {
      _barkTimer = null;
      if (el.barkLine) el.barkLine.hidden = true;
    }, Math.round(Dialogue.BARK_SEC * 1000));
  });

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

/* =========================================================
   技能栏（HUD）
   ---------------------------------------------------------
   一格一个技能：名字 + 冷却进度 + 能量够不够。
   为什么必须显示"能量够不够"：手动模式下玩家按下去如果没反应，
   他分不清是**冷却没好**、**能量不够**还是**按键坏了** ——
   三种情况的处理完全不同（等 / 攒 / 去设置里改键）。
   ========================================================= */
function updateSkillBar(sess) {
  var box = hudNodes.skills;
  if (!box) return;
  var slots = (sess.skills && sess.skills.slots) || [];
  if (box.childElementCount !== slots.length) {
    U.clear(box);
    for (var i = 0; i < slots.length; i++) box.appendChild(U.el('div', 'sk-slot'));
  }
  for (var k = 0; k < slots.length; k++) {
    var el2 = box.children[k] as HTMLElement;
    var st = slots[k];
    var ready = st.cd <= 0 && (sess.energy || 0) >= st.skill.cost;
    var cls = 'sk-slot' + (ready ? ' ready' : (st.cd > 0 ? ' cooling' : ' dry'));
    if (el2.className !== cls) el2.className = cls;
    /* 冷却进度用宽度表达（0..1）：比数字更快看懂"还有多久" */
    var frac = st.skill.cd > 0 ? U.clamp(1 - st.cd / st.skill.cd, 0, 1) : 1;
    var txt = st.skill.name + '　' + Math.round((sess.energy || 0)) + '/' + st.skill.cost;
    if (el2.dataset.sig !== txt) { el2.dataset.sig = txt; el2.textContent = txt; }
    var fill = el2.querySelector ? el2.querySelector('i') : null;
    if (!fill) { fill = U.el('i'); el2.appendChild(fill); }
    fill.style.width = U.pct1(frac);
    if (el2.title !== st.skill.note) el2.title = st.skill.note;
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
  updateSkillBar(sess);

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
  /* 徽记那一颗按钮：没有徽记就灰着 —— 而**说明里讲清它从哪来**，
     不然玩家只会看到一个永远点不动的按钮。 */
  if (el.sigilCount) el.sigilCount.textContent = '(' + Game.sigil() + ')';
  if (el.rerollSigil) (el.rerollSigil as HTMLButtonElement).disabled = Game.sigil() <= 0;
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
   ⚠ 这条接入是**必须**的，而不是可选优化：`Profile` 的内存副本属于**上一个槽位**，
   只切键不重读会得到一份"看起来对、其实错"的档案 ——
   实测（`test/slots.mjs`）表现是"切回 0 号槽读到的是 1 号槽的孢子"，
   而且**不报任何错**。放在这里而不是 `slots.ts` 里，是因为
   `slots.ts` 不该认识 Profile 的字段（见它的文件头）。 */
Slots.onChange(function () {
  /* 换槽位之后那个"还没出发的人"的记账要作废（见 `_draftSlot`）——
     否则在 1 号档捏到一半、切到 2 号档再点返回，会去清 2 号档。 */
  _draftSlot = -1;
  _slotView = Slots.current();
  afterSlotChange();
});

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
  /* ⚠ 「枢纽有人想说新话」的角标（`hub-news`）**不在这里**：标题页已经没有枢纽的
     入口了（枢纽归局内），角标跟着大厅底栏那个按钮走，由 renderStation 更新。 */
}
UI.refreshContinueButton = refreshContinueButton;
UI.renderSettings = renderSettings;
/* 屋里两屏的每显示帧同步：面板是**交互的产物**，要跟着玩家的位置收放 */
UI.hallSync = hallSync;

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
      (sess.growth || 0) + '（到据点解锁图纸）</div>';
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
