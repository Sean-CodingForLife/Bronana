/* =========================================================
main.ts — 引导与主循环
固定步长模拟（Game.cfg.fixedDt）+ 累积器：逻辑帧与显示帧解耦。
显示帧把剩余累计时间折算成 alpha 交给渲染层做位置插值，
所以高刷屏上不会看到"同一个逻辑帧被画两遍"的顿挫。
========================================================= */

import { SelfCheck } from './selfcheck.ts';
import { Sfx } from './audio.ts';
import { Chars } from './data_chars.ts';
import { Crash } from './crash.ts';
import { Daily } from './daily.ts';
import { Danger } from './danger.ts';
import { Items } from './data_items.ts';
import { Weapons } from './data_weapons.ts';
import { Demo } from './demo.ts';
import { Dungeon } from './dungeon.ts';
import { Enemies } from './enemies.ts';
import { Emit } from './emit.ts';
import { Game } from './game.ts';
import { I18n } from './i18n.ts';
import { Input } from './input.ts';
import { Music } from './music.ts';
import { Profile } from './profile.ts';
import { Rec } from './record.ts';
import { Score } from './score.ts';
import { Season } from './season.ts';
import { R } from './render.ts';
import { Save } from './save.ts';
import { S } from './sprites.ts';
import { Scene } from './scene.ts';
import { Settings } from './settings.ts';
import { Skills } from './skills.ts';
import { Storage } from './storage.ts';
import { Slots } from './slots.ts';
import { UI } from './ui.ts';
import { PAL, Perf } from './utils.ts';

var acc = 0;
var last = 0;
var running = true;
var stepOnce = 0;
var lastTape = null;
var autoPauseEnabled = true;
/** 最近一次每日挑战的结果（结算页要显示成绩码，所以留一份） */
var lastDaily = null;

/* =========================================================
   音效接入：模拟层**广播意图**（`Game.events` 的 `'sfx'`），这里把它翻成具体音效。
   ---------------------------------------------------------
   改造前是模拟层直接 `import { Sfx } from './audio.ts'` 并 `Sfx.kill()` 共 9 处 ——
   那是全项目唯一的"模拟 → 造型"依赖边，模拟内核因此认识了 AudioContext 那一层。
   现在方向反过来：**谁想响谁自己听**（与 `buy` / `deny` 完全同一套路）。
   这张表同时是**契约**：模拟层能广播的意图只有这几个键（守卫会对齐两边，
   写错一个名字的表现是"那个音不响"，无声无息）。
   ========================================================= */
var SFX_BY_INTENT: Record<string, (arg?: string) => void> = {
  shoot: function (kind) { Sfx.shoot(kind); },
  melee: function () { Sfx.melee(); },
  hit: function () { Sfx.hit(); },
  kill: function () { Sfx.kill(); },
  hurt: function () { Sfx.hurt(); },
  explode: function () { Sfx.explode(); },
  pickup: function () { Sfx.pickup(); },
  /* ---- 这两条是**补接入**，不是新音效 ----
     test/arch.mjs 的 [4] 节拿「模拟层广播的意图」与「入口接的线」对账，
     而它一直是红的（多出来的正是这两个）：模拟层早就在发 buy / deny，
     入口却没接 —— 表现是「买了东西与点不动都没有声音」，
     而**无声是最难注意到的一类退化**（玩家会以为自己没开音量）。
     接上之后两边对上，那条判据从红变绿，而它守的正是这件事。 */
  buy: function () { Sfx.buy(); },
  deny: function () { Sfx.deny(); }
};

/* =========================================================
   持久化接入（只在浏览器侧做，模拟层保持零 DOM）
   ========================================================= */
/** 把一项设置应用到具体模块 —— 这是"值 → 行为"的唯一去处 */
function applySetting(key, value) {
  if (key === 'sound') { Sfx.setEnabled(!!value); Music.setEnabled(!!value); }
  else if (key === 'volume') {
    /* ⚠ 走 `Sfx.setVolume`，不要自己写 `master.gain.value = value` ——
       滑杆值要过一条**感知曲线**（响度是对数感知的，线性赋值会让滑杆"不灵"）。
       曲线只在 `audio.ts` 里实现一处，否则初始化与改设置会走两条不同的曲线。 */
    Sfx.setVolume(value);
  }
  /* 分组音量：走 `Sfx.setBusVolume`（同样有唯一实现）。
     它会把音乐总线推一遍，并**通知正在放的那首曲子**跟上 —— 所以滑杆
     是即时生效的，不用等下一首。 */
  else if (key === 'sfxVolume') Sfx.setBusVolume('sfx', value);
  else if (key === 'musicVolume') Sfx.setBusVolume('music', value);
  else if (key === 'music') Music.setEnabled(!!value);
  else if (key === 'speed') Game.speed = value >= 2 ? 2 : 1;
  else if (key === 'fps') R.showFps = !!value;
  else if (key === 'shake') applyShake();
  else if (key === 'autopause') autoPauseEnabled = !!value;
  else if (key === 'damageNumbers') Emit.showDamage = !!value;
  else if (key === 'reduceMotion') { Emit.visScale = value ? 0.5 : 1; applyShake(); }
  /* 命中定帧：设置里存的是**帧数**本身（0 = 关），不在这里做档位→帧数的换算 ——
     那张对照表住在 `Game.cfg.hitStop`（模拟层），这里只把玩家的选择转过去。 */
  else if (key === 'hitStop') Game.cfg.hitStop = Math.max(0, Math.floor(Number(value) || 0));
  /* 战斗模式：**只写一个字段**，模拟层自己按它分岔（两条路径都在 game.ts 里）。
     为什么不做成两套开关（自动攻击 / 自动技能各一个）：那会出现
     「自动攻击 + 手动技能」这种没人设计过的混合态，而它每一帧都要被测试。
     一个开关两种模式 = 两个可验证的状态，比四个半成品状态好。 */
  else if (key === 'combatMode') Game.cfg.combatMode = (value === 'manual') ? 'manual' : 'auto';
  /* ---- 这一轮补的三项 ----
     三项都走**同一个"设置项 → 一个副作用"**的形状，所以它们的位置就在这里，
     不另开分支树。`locale` 还要重新绑一次 DOM（HTML 里的静态文案要按新语言写回去）。 */
  else if (key === 'locale') { I18n.set(String(value)); }
  else if (key === 'fontScale') { applyFontScale(value); }
  else if (key === 'colourblind') { applyColourblind(value); }
  else if (key === 'keyUp' || key === 'keyDown' || key === 'keyLeft' || key === 'keyRight' || key === 'keyPause'
    || key === 'keySkill1' || key === 'keySkill2' || key === 'keyFire') {
    /* 一条分支覆盖全部可改键位：**靠 `Input.setBind` 里的映射表分派**，
       而不是在这里再列一遍键名 —— 列一遍就会漏。这一轮加了三个键，
       漏了的话表现是「按键能在设置里改，但改了没用」。 */
    Input.setBind(key, value);
  }
}

/**
 * 字号：缩放**界面层**（`.layer`），不是给每个元素写一遍字号。
 *
 * ⚠ 第一版改的是 `documentElement.style.fontSize` —— 那对本作**完全无效**：
 * 这份 CSS 里的尺寸全是 px（量过：font-size 68 处 px、0 处 rem），
 * 改根字号一个像素都不动。于是"字号"成了一个能存能读、界面不变的**无效开关**。
 * 现在写一个 CSS 变量 `--ui-zoom`，由 `.layer{zoom: var(--ui-zoom,1)}` 消费：
 *   · 缩放的是**界面层**，游戏画面（同层的 canvas）不受影响 —— 它的分辨率由 dpr 决定
 *   · `zoom` 会连布局一起重排，所以按钮不会被放大后的文字撑破
 */
function applyFontScale(v) {
  var k = Number(v) || 1;
  if (typeof document !== 'undefined' && document.documentElement && document.documentElement.style) {
    document.documentElement.style.setProperty('--ui-zoom', String(k));
    document.documentElement.setAttribute('data-font-scale', String(k));
  }
}

/**
 * 色弱：**换调色板**，不换玩法。
 *
 * 为什么值得做：本作的"危险"与"可拾取"在色相上分得很开（红 / 绿），
 * 而红绿色盲是最常见的一类。两档：
 *   1 = 红绿友好：危险改成蓝白光晕的**冷色**，拾取改成暖黄（蓝黄轴更好分辨）
 *   2 = 高对比：在 1 的基础上把前景/背景的明度差拉开
 *
 * ⚠ 这一档**只改颜色与对比**，不改任何判定、半径、时序 ——
 * 所以它对玩法指纹没有影响（`test/persist.mjs` 与指纹都不会动）。
 */
function applyColourblind(v) {
  var mode = Number(v) || 0;
  if (typeof document === 'undefined' || !document.documentElement) return;
  var root = document.documentElement;
  if (mode === 0) root.removeAttribute('data-colourblind');
  else root.setAttribute('data-colourblind', String(mode));
  /* canvas 里的颜色来自 `PAL`：换档要**连缓存一起作废** ——
     贴图是按颜色烘焙后缓存的（怪物剪影 / 拾取物 / 瓦片 / 视差层），
     不作废的表现是"有些东西换了色、有些没换"。那两下就是缓存的唯一出口。 */
  if (PAL.setMode(mode)) {
    try { S.setScale(S.scale()); } catch (e) { /* 无头环境没有 canvas：跳过 */ }
    try { R.invalidateBakes(); } catch (e) { }
  }
}

/** 抖动强度是两项设置的交集："减少动效"开着时直接归零，与抖动滑条无关 */
function applyShake() {
  R.shakeScale = Settings.get('reduceMotion') ? 0 : Settings.get('shake');
}

/**
 * 失焦 / 标签页隐藏时自动暂停。
 * 只在**真正在推进模拟**（playing）时动手：商店、升级、暂停本身就不跑模拟，
 * 再插一脚只会把"选卡选到一半"变成"被丢进暂停菜单"。
 */
function autoPause(reason) {
  if (!autoPauseEnabled) return;
  // 闸门走场景表，而不是在这里比较 Game.state（main.ts 不许按状态硬编码）
  if (!Scene.simulates(Game.state)) return;
  if (!Game.pause()) return;
  if (UI.renderPause) UI.renderPause();
  UI.toast('已自动暂停（' + reason + '）', '');
}

function initPersistence() {
  // localStorage 在无痕/被禁用时会抛，接不上就退回内存适配器（本次会话内仍生效）
  var ls = null;
  try { ls = (typeof window !== 'undefined') ? window.localStorage : null; } catch (e) { ls = null; }
  if (!Storage.use(ls)) {
    if (ls) console.warn('[storage] localStorage 形状不对，退回内存适配器');
  }

  Settings.init();
  for (var i = 0; i < Settings.keys().length; i++) {
    var k = Settings.keys()[i];
    applySetting(k, Settings.get(k));
  }
  Settings.onChange(applySetting);

  // 账号档案（跨局成长）：必须在任何一局开始前就绪，否则第一局的结算会丢
  var profInit = Profile.init();
  /* ⚠ **档案被拒时必须说出来**。三种情况要分清（`Profile.load()` 已经分了，只是没人读）：
       · 首次启动（盘上没档）    → 静默，正常
       · 存档读坏、已回退备份    → 记在 `Slots.lastRecovery()` 里，但**此前全项目零读取点**：
                                  译文 `'存档损坏，已回退到上一次的备份'` 早就写好了，没人用。
                                  玩家只会觉得"我怎么少了一半进度"。
       · 档案被拒（版本太新/坏 JSON）→ 此前 `Profile.init` 会拿空白档**盖掉它**，
                                  这是不可恢复的进度清零。现在不写了（见 profile.ts 的注释），
                                  但**必须告诉玩家盘上还有一份、别去动它**。 */
  if (profInit.discarded) {
    console.error('[profile] 账号档案被拒，**未覆盖**（盘上原档保留）：' + profInit.reason);
    if (UI.toast) UI.toast('账号档案读不出来（' + profInit.reason + '）—— 已保留原档案，没有覆盖它', '');
  }
  var rec = Slots.lastRecovery();
  if (rec) {
    console.warn('[storage] 读到坏档并已回退备份：' + rec.key + ' · ' + rec.reason);
    if (UI.toast) UI.toast('存档损坏，已回退到上一次的备份', '');
    Slots.clearRecovery();          // 只说一次：每局开局都提一遍会变成噪音
  }
  resetPeaks();

  // 自动存档点：换波（进入商店）、以及本局结束。
  // **回放期间一律不落账** —— 回放会真的跑到"一局结束"并触发 gameOver，
  // 不拦住的话按 L 放一遍录像就会往战绩与账号档案里写一局假数据。
  Game.events.on('waveClear', function () { if (Rec.replaying()) return; samplePeaks(); Save.saveRun(); });
  Game.events.on('shopOpen', function () { if (Rec.replaying()) return; Save.saveRun(); markOffersSeen(); });
  Game.events.on('waveStart', function () { if (Rec.replaying()) return; markWaveEnemiesSeen(); });
  Game.events.on('runStart', function () { if (Rec.replaying()) return; Save.clearRun(); resetPeaks(); });   // 新开一局 → 旧档作废
  Game.events.on('runResumed', function () { resetPeaks(); });
  Game.events.on('gameOver', function (sum) {
    if (Rec.replaying()) return;            // 回放不是玩家在打
    var summary = sum || Game.summary();
    Save.addRun(summary);                   // 记录并进
    Save.clearRun();                        // 这一局已经结算，不再"可继续"
    // 局外成长：并入账号档案（挑战 → 解锁、孢子、图鉴、每角色记录、难度阶梯）。
    // 顺序必须是"先并入 records 再喂 profile" —— 累计类挑战读的就是并入后的值。
    samplePeaks();                          // 死在波次中间时最后一波也得采到
    announceRun(Profile.applyRun(runInput(summary), Save.records()));
    finishChallenge(summary);               // 挑战局（每日/每周）：收带子、出成绩码、记当期最好
    Profile.touchSeen();                    // 一局结束也是"见面"的一次
  });

  // 标题页的"继续上一局"按钮：启动时按存档有无决定显不显示
  if (UI.refreshContinueButton) UI.refreshContinueButton();
  console.log('[storage] ' + Storage.adapterName() + ' · 设置来源 ' + Settings.loadedFrom() +
    ' · 账号档案 ' + Profile.loadedFrom() + '（成长点 ' + Profile.growth() + '）' +
    ' · ' + (Save.hasRun() ? '有可继续的存档' : '无存档'));
}

/* =========================================================
   账号档案接入（局外成长）
   ========================================================= */
/**
 * 本局峰值。只在**换波**与**本局结束**各采一次，代价可以忽略；
 * 不为挑战去改模拟层 —— 挑战只读这里已有的数据。
 */
var runPeaks: Record<string, number> = Object.create(null);

function resetPeaks() {
  runPeaks = Object.create(null);
  runPeaks.minHpWaveEnd = Infinity;    // 一次都没采到 → 不能靠空值满足"只剩 1 点生命"
}

function samplePeaks() {
  var sess = Game.getSession();
  if (!sess) return;
  var s = sess.stats;
  var p = sess.player;
  bump('maxHarvesting', s.harvesting);
  bump('maxLuck', s.luck);
  bump('maxEngineering', s.engineering);
  bump('maxRangedDmg', s.rangedDmg);
  bump('maxElementalDmg', s.elementalDmg);
  bump('maxMeleeDmg', s.meleeDmg);
  bump('maxRange', s.range);
  bump('maxHp', s.maxHp);
  bump('maxTurrets', sess.turrets ? sess.turrets.length : 0);
  bump('maxWeapons', p.weapons ? p.weapons.length : 0);
  runPeaks.minHpWaveEnd = Math.min(runPeaks.minHpWaveEnd, Number(p.hp) || 0);
}
function bump(key, v) {
  var x = Number(v) || 0;
  if (!(key in runPeaks) || x > runPeaks[key]) runPeaks[key] = x;
}

/** 在商店里出现过的东西 = 图鉴的"见过"。这一层在界面侧，模拟层不需要知道图鉴存在 */
function markOffersSeen() {
  var sess = Game.getSession();
  if (!sess || !sess.offers) return;
  var dirty = false;
  for (var i = 0; i < sess.offers.length; i++) {
    var o = sess.offers[i];
    if (!o || !o.def || !o.def.id) continue;
    if (Profile.markCodex(o.type === 'weapon' ? 'weapon' : 'item', o.def.id, Profile.CODEX_SEEN)) dirty = true;
  }
  if (dirty) Profile.save();
}

/** 本波会出场的怪 = 图鉴的"见过"。读的是已经建好的出场队列，不影响模拟 */
function markWaveEnemiesSeen() {
  var sess = Game.getSession();
  if (!sess || !sess.spawnQueue) return;
  var dirty = false;
  for (var i = 0; i < sess.spawnQueue.length; i++) {
    var e = sess.spawnQueue[i];
    if (!e || !e.id) continue;
    if (Profile.markCodex('enemy', e.id, Profile.CODEX_SEEN)) dirty = true;
  }
  if (dirty) Profile.save();
}

function runInput(summary): ProfileRunInput {
  var sess = Game.getSession();
  return {
    char: summary.char,
    wave: summary.wave, level: summary.level,
    kills: summary.kills, scrap: summary.scrap,
    /* **两种货币各报各的**（名字近、含义完全不同，混起来不报错）：
       · `earned`    = 这一局一共打出来多少**废料**（不是手里剩多少）
       · `materials` = 这一局打到多少**材料**（只有它能进材料钱包）
       档案层按这两个名字读，见 `Profile.applyRun` 里那段。 */
    earned: summary.earned,
    materials: summary.materials,
    damage: summary.damage, taken: summary.taken, healed: summary.healed,
    packs: summary.packs || 0, win: summary.win,
    danger: summary.danger || 0,
    kmods: sess ? sess.kmods : null,
    // 天赋的经济修正走同一条路径（接入层从会话上取，档案层不认识"天赋"）
    omods: sess ? sess.omods : null,
    // 合金：本局合成攒下来的那一份（结算时按 forge 表换成功坊货币）
    alloy: sess ? (sess.growth || 0) : 0,
    weaponIds: summary.weaponIds || [], itemIds: summary.itemIds || [],
    masteredWeaponIds: summary.masteredWeaponIds || [], masteredItemIds: summary.masteredItemIds || [],
    // 剧情要的"这一局碰到了什么来源"（模拟层报事实，怎么解释它通向哪片记录不在这里）
    floor: summary.floor || 0,
    bossesDown: summary.bossesDown || [],
    secrets: summary.secrets || 0,
    events: summary.events || [],
    peaks: runPeaks
  };
}

/** 把并入结果讲给玩家听（否则"解锁了什么"是看不见的） */
function announceRun(report) {
  if (!report) return;
  if (report.spores > 0) UI.toast('获得 ' + report.spores + ' 成长点', 'good');
  /* 合金单独说一句：它是**合成**那条链的产出，
     不点出来玩家不会把"局内合成"与"局外图纸"连起来（那样这条腿就白做了）。 */
  if (report.alloy > 0) {
    UI.toast('获得 ' + report.alloy + ' 成长点' +
      (Game.growthEarned() > 0 ? '（本局合成贡献 ' + Game.growthEarned() + '）' : '') +
      ' —— 到据点解锁图纸', 'good');
  }
  for (var i = 0; i < report.completed.length; i++) {
    UI.toast('挑战完成：' + report.completed[i].name, 'good');
  }
  for (i = 0; i < report.unlocked.length; i++) {
    UI.toast('解锁 ' + unlockLabel(report.unlocked[i]), 'good');
  }
  if (report.dangerUnlocked > 0) {
    UI.toast('难度 ' + report.dangerUnlocked + ' · ' + Danger.name(report.dangerUnlocked) + ' 已解锁', 'good');
  }
  if (report.pointsGained > 0) {
    UI.toast('获得 ' + report.pointsGained + ' 点天赋（到天赋页分配）', 'good');
  }
  /* 剧情：捡到记录 / 解锁结局都单独说一声 ——
     "探索 = 读故事"这条线如果不在界面上说出来，玩家根本不知道自己捡到了什么。 */
  var st = report.story;
  if (st) {
    for (i = 0; i < st.fragments.length; i++) {
      UI.toast('记录碎片：' + st.fragments[i].title, 'good');
    }
    for (i = 0; i < st.endings.length; i++) {
      UI.toast('结局解锁：' + st.endings[i].name, 'good');
    }
    if (Profile.hasStoryNews()) UI.toast('枢纽里有人说新话了', '');
  }
}

function unlockLabel(t) {
  if (t.family === 'char') {
    var c = Chars.BY_ID[t.id];
    return '角色「' + (c ? c.name : t.id) + '」';
  }
  if (t.family === 'weapon') {
    var w = Weapons.BY_ID[t.id];
    return '武器「' + (w ? w.name : t.id) + '」';
  }
  if (t.family === 'item') {
    var it = Items.BY_ID[t.id];
    return '道具「' + (it ? it.name : t.id) + '」';
  }
  return t.family + '「' + t.id + '」';
}

/* =========================================================
   共享种子挑战（每日 / 每周）
   ---------------------------------------------------------
   两者只差"期"的算法与难度：每日固定第 0 级，每周轮换难度。
   规则的推导在 daily.ts / season.ts（纯函数），
   **"这一局是不是挑战局"的标记放在这里** —— 它属于接入层，
   模拟层与规则模块都不需要知道"玩家正在打挑战"。
   ========================================================= */
var challenge: { kind: string; rule: any; code: string; tape: any; claims: any; rec: any; improved: boolean } | null = null;

function challengeRule(kind) {
  return kind === 'weekly' ? Season.of() : Daily.of();
}

/** 开始一局挑战。角色由期次轮换决定，**无视解锁门槛**（所有人要同一个角色才可比） */
function startChallenge(kind) {
  var rule = challengeRule(kind);
  Rec.start();                       // 整局录下来 —— 这就是成绩的"证据"
  Game.newRun(rule.char, rule.seed, rule.danger);
  challenge = { kind: kind, rule: rule, code: '', tape: null, claims: null, rec: null, improved: false };
  UI.toast((kind === 'weekly' ? '每周挑战 ' : '每日挑战 ') + rule.key +
    ' · ' + Chars.BY_ID[rule.char].name + ' · 难度 ' + rule.danger, 'good');
  return rule;
}

/** 一局挑战结束时：停录、算分、出成绩码、记当期最好 */
function finishChallenge(summary) {
  if (!challenge) return null;
  var mark = challenge;
  challenge = null;
  var tape = Rec.stop();
  var claims = {
    key: mark.rule.key,
    char: summary.char,
    danger: summary.danger || 0,
    seed: Game.getSession() ? (Game.getSession().seed >>> 0) : mark.rule.seed,
    wave: summary.wave,
    kills: summary.kills,
    level: summary.level,
    win: !!summary.win
  };
  var hash = Score.hashTape(tape);
  var code = Score.make(claims, hash);
  var rec = {
    key: mark.rule.key, seed: claims.seed, char: claims.char, danger: claims.danger,
    wave: claims.wave, kills: claims.kills, level: claims.level, win: claims.win,
    score: Daily.scoreOf(claims), at: Date.now(), frames: tape ? tape.frames : 0
  };
  var res = mark.kind === 'weekly' ? Profile.recordSeason(rec) : Profile.recordDaily(rec);
  lastDaily = { kind: mark.kind, code: code, tape: tape, claims: claims, rec: rec, improved: res.improved, prev: res.prev };
  UI.toast((mark.kind === 'weekly' ? '每周成绩 ' : '每日成绩 ') + Daily.scoreOf(claims) + ' 分' +
    (res.improved ? '（这一期最好）' : ''), 'good');
  return lastDaily;
}

/** 最近一次挑战的成绩（结算页/图鉴显示成绩码用） */
function lastDailyResult() { return lastDaily; }

/** 重放 lambda：与按 L 回放用的是同一个（场景闸门 + 收帧） */
function replayStep(x, y) {
  if (Scene.simulates(Game.state)) Game.step(Game.cfg.fixedDt, { x: x, y: y });
  Input.endFrame();
}

/* =========================================================
   逻辑帧的输入（**分岔只在这一处**）
   ---------------------------------------------------------
   自动模式：跟以前一样，只有移动向量 ——
   模拟层自己找目标、自己放技能。
   手动模式：把瞄准/开火/技能**打包进同一个对象** ——
     · 模拟层不认识 `Input`，也不认识鼠标（分层约束，也是回放能工作的前提）
     · `Rec` 记的就是这个对象，所以手动模式的回放**不需要真的有一只鼠标**

   为什么要成一个函数而不是在两处各写一遍：主循环里有**两个** `Game.step`
   （暂停单步与累积器）。各写一遍的话，手动模式在"暂停单步"时没有瞄准 ——
   而那正是调试手感时最需要它的场合（两处会慢慢分叉，这类分叉只在某一条路径上出现）。
   ========================================================= */
function frameInput(mv: { x: number; y: number }) {
  /* 类型写全（不写 `any`）：这个对象**跨层**交给模拟层，
     而"手动模式多带哪几个字段"正是这一轮新增的契约 —— 用 `any` 就等于不声明它。
     `slot` 与 `cast` 在自动模式下不出现（多带没人读，但声明里是可选的）。 */
  var out: { x: number; y: number; aimX?: number; aimY?: number; fire?: boolean; cast?: boolean; slot?: number } = { x: mv.x, y: mv.y };
  /* 每帧告诉输入层「玩家在屏幕上的哪一点」：鼠标 → 世界方向要用它。
     ⚠ 只给一个点，不给相机 —— 相机只属于渲染层。 */
  var sess = Game.getSession && Game.getSession();
  if (sess && sess.player && R.worldToScreen) {
    var sp = R.worldToScreen(sess.player.x, sess.player.y);
    Input.setAimOrigin(sp.x, sp.y);
  }
  if (String(Game.cfg.combatMode) === 'manual') {
    var mi = Input.manualInput();
    out.aimX = mi.aimX; out.aimY = mi.aimY;
    out.fire = mi.fire; out.cast = mi.cast; out.slot = mi.slot;
  }
  return out;
}

/* =========================================================
   启动期自检的失败页
   ---------------------------------------------------------
   表写错了要**能看见**：白屏对谁都没用，一条 console 错误在桌面外壳里也看不见。
   所以这里画一张最朴素的纸面报错页（不依赖 UI 模块，因为它可能正是坏掉的那部分）。
   ========================================================= */
function selfCheckFailPage(err) {
  var box = document.createElement('div');
  box.id = 'selfcheck-fail';
  box.setAttribute('style',
    'position:fixed;inset:0;overflow:auto;background:#e8dcc0;color:#100d0c;' +
    'font:13px/1.6 ui-monospace,Consolas,monospace;padding:24px;white-space:pre-wrap;z-index:99999');
  box.textContent = 'Bronana 启动自检未通过 —— 这是**代码里的表**有问题，不是你的操作。\n\n' +
    String((err && err.message) || err) +
    '\n\n（修好之后刷新即可；跑 `pnpm test` 能看到同一批问题。）';
  document.body.appendChild(box);
}

function boot() {
  var canvas = document.getElementById('game') as HTMLCanvasElement;
  /* 兜底先接上：`boot` 之后任何一处抛都不该让玩家看到一块卡住的画面 */
  Crash.hook();
  /* **崩溃卡的上下文由应用层注入**（R55 引擎/内容边界）：
     `crash.ts` 以前自己 `import { Game }` 去读"波次/状态/角色/层"才拼得出那句话 ——
     那让一个通用机制认识了游戏状态，于是它"换个游戏就不能原样用"。
     现在引擎只留"出了意外 + 触发点 + 栈"，**谁拥有游戏状态谁负责描述它**。
     收一个**函数**而不是字符串：崩溃可能发生在任何时候，快照会过时
     （boot 时写一次"波次 1"，第 9 波崩了卡片会报错波次 —— 那比没有卡片更坏）。
     读不到不该影响兜底本身，所以取值那一步在 crash.ts 里包了 try。 */
  Crash.whereProvider = function () {
    var s = Game.getSession();
    return '波次 ' + Game.wave + ' · 状态 ' + Game.state +
      (s ? ' · 角色 ' + s.charDef.id + ' · 层 ' + s.floor : ' · 还没有开局');
  };
  /* **技能树按真实角色表建一次**（`skills.ts` 自己不认识角色表 ——
     那一行 import 会让 `profile.ts`（meta 层）依赖它变成一条向上的边）。
     必须在 `SelfCheck.run()` **之前**：`Skills.audit()` 有一条判据是
     「每个角色都要有技能树」，而它读的正是这里注入的清单。 */
  var skillsRef = Skills.make({ chars: function () { return Chars.LIST; } });
  /* 档案层也要用它（技能构筑存在档案里），但它**不许 import** 本模块 ——
     那是向上的依赖边。所以走注入（与 `Input.onPadGesture` 同一种做法）。 */
  Profile.useSkills(skillsRef);
  /* 注入之后**立刻**自检：`skills.ts` 刻意不在模块级跑它（那时角色清单还是空的，
     跑出来全是误报），所以"记得跑一次"的责任在这里。失败就抛 ——
     与注册过的自检同样严格（半坏的表比坏掉更难查）。 */
  var skVerdict = skillsRef.audit();
  if (!skVerdict.ok) throw new Error('skills.ts 技能表自检失败：\n' + skVerdict.problems.join('\n'));

  /* 定义期自检：表有问题就**不要**进游戏（半坏的表比坏掉更难查）。
     放在 UI.init 之前：界面都还没搭起来时抛，才不会被"看着能跑"骗过去。 */
  try {
    SelfCheck.run();
  } catch (e) {
    selfCheckFailPage(e);
    throw e;
  }
  initPersistence();
  /* 本地化的两步**必须在 UI.init 之前**：
     ① `bindDom` 给 DOM 里的静态文案记下原文（它只认表里有的那些）
     ② `I18n.set` 把设置里选的语言写回去
     顺序反了的话，UI.init 里拼出来的动态文本会先按中文渲染一遍再被覆盖，
     看着像"闪一下"；而 bindDom 放在 UI.init 之后则会漏掉它新建的节点。 */
  I18n.bindDom(document);
  I18n.set(Settings.get('locale'));
  R.init(canvas);
  Input.init(canvas);
  UI.init();
  /* 起手把每一项设置**应用一遍**：以前是在各分支里分别调 applySetting，
     于是"表里加了一项但没人应用它"是一条静默的漏项（设置能存能读、
     就是不起作用）。现在唯一入口就是这里 + `Settings.onChange`。 */
  Settings.keys().forEach(function (k) { applySetting(k, Settings.get(k)); });

  // 每日挑战：由界面触发、由这里实现（种子/角色/录制/成绩码都属于"接入"这一层）
  UI.dailyStart = function () { return startChallenge('daily'); };
  UI.weeklyStart = function () { return startChallenge('weekly'); };
  UI.dailyResult = lastDailyResult;
  UI.replayStep = replayStep;

  // 离线产出：开机结算一次。**结算即前进**，所以反复刷新不会多拿
  var off = Profile.settleOffline();
  if (off.growth > 0) {
    UI.toast('离线产出 +' + off.growth + ' 成长点（' + Math.floor(off.minutesCounted) + ' 分钟' +
      (off.capped ? '，已按上限计' : '') + '）', 'good');
  }
  // 切后台 / 关页面时也记一次"见面"（离线产出按它与下次开机的间隔结算）
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) Profile.touchSeen();
  });
  window.addEventListener('beforeunload', function () { Profile.touchSeen(); });

  window.addEventListener('resize', function () { R.resize(); });
  watchDpr();   // 拖到另一块显示器上：dpr 变了但 resize 不一定触发
  document.addEventListener('pointerdown', function () { Sfx.resume(); }, { once: true });
  window.addEventListener('keydown', function () { Sfx.resume(); }, { once: true });
  /* **手柄玩家也要能解锁音频**：上面两个监听只覆盖鼠标/键盘，
     而 Gamepad API 是轮询的、不派发 DOM 事件 —— 只用手柄的人会**全程无声**
     且不知道原因（浏览器拦了自动播放）。输入层把"手柄第一次按下"这条边沿
     报出来（`Input.onPadGesture`），这里接上。
     不清除回调：`Sfx.resume()` 幂等，且浏览器可能在切标签、休眠后重新挂起。 */
  Input.onPadGesture = function () { Sfx.resume(); };
  Game.events.on('sfx', function (d) {
    if (!d) return;
    var f = SFX_BY_INTENT[d.name];
    if (f) f(d.arg);
  });

  // 失焦 / 切标签页自动暂停。
  // 浏览器里切标签页会停掉 rAF（画面自己就冻住了），但**窗口失焦不等于标签页隐藏**：
  // 桌面外壳里点开别的窗口、或浏览器里点了另一个窗口，rAF 照跑，不暂停就是"挂着挨打"。
  window.addEventListener('blur', function () { autoPause('窗口失去焦点'); });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) autoPause('切到后台');
  });

  last = now();

  // ?fps=1 打开性能详情叠加层（帧率 / 帧耗时 / 实体数）
  // ?z=1   再叠上深度报告（各层带这一帧画了多少、排序队列多长）
  var search = (window.location && window.location.search) || '';
  if (/[?&]fps=1/.test(search)) R.showFps = true;
  if (/[?&]z=1/.test(search)) { R.showDepth = true; R.showFps = true; }
  // 诊断面板（?diag=1 简报 / ?diag=2 展开体检报告）
  if (/[?&]diag=1/.test(search)) { UI.diagFull = false; UI.setDiag(true); }
  if (/[?&]diag=2/.test(search)) { UI.diagFull = true; UI.setDiag(true); }
  // 录制 / 回放（确定性已经保证，这里只负责"记下来 / 放一遍"）
  if (/[?&]rec=1/.test(search)) { Rec.start(); console.log('[rec] 开始录制'); }
  // ?daily=1 / ?weekly=1 直接开当期挑战（验收用；日常入口在标题页）
  if (/[?&]daily=1/.test(search)) startChallenge('daily');
  else if (/[?&]weekly=1/.test(search)) startChallenge('weekly');

  if (!applyTestModeOnce()) requestAnimationFrame(frame);
}

/**
 * 盯住设备像素比。把窗口拖到另一块缩放不同的显示器上时 dpr 会变，
 * 但 CSS 尺寸没变 → 不触发 resize。dpr 变了必须让渲染层重建位图缓存
 * （离屏贴图与两层战场烘焙都是按倍率烘焙的），否则会继续用旧倍率那一份。
 * 用 matchMedia 监听"当前 dpr"这个查询失效；每次变化后按新值重新挂一次。
 */
function watchDpr() {
  if (typeof window.matchMedia !== 'function') return;
  var q;
  try { q = window.matchMedia('(resolution: ' + (window.devicePixelRatio || 1) + 'dppx)'); }
  catch (e) { return; }
  var onChange = function () { R.resize(); watchDpr(); };
  if (q.addEventListener) q.addEventListener('change', onChange, { once: true });
  else if (q.addListener) q.addListener(onChange);   // 老 Safari
}

var testModeApplied = false;

function applyTestModeOnce() {
  if (testModeApplied) return true;
  testModeApplied = applyTestMode();
  return testModeApplied;
}

/* =========================================================
   URL 调试入口（开发用，默认完全不生效）
     ?test=title | chars | demo | arena | levelup | shop | end | play
     &char=<角色id>   &wave=<波次>   &theme=<环境id>   &still=1（冻结时间）   &zoom=<倍数>
   `arena` = 只为拍战场地面而生的场景（没有升级弹窗、没有贴花）；
   `theme` = 钉住这一层的环境 —— 环境是每局抽签的，不钉住就等不到指定的那个。
   ========================================================= */
function applyTestMode() {
  var qs = (window.location && window.location.search) || '';
  if (!qs) return false;
  var m = /[?&]test=([a-z]+)/.exec(qs);
  if (!m) return false;
  var mode = m[1];
  var charM = /[?&]char=([a-z]+)/.exec(qs);
  var waveM = /[?&]wave=(\d+)/.exec(qs);
  /* `&theme=<环境id>`：钉住这一层的环境。
     环境是每局抽签的，所以"另一个地方长什么样"等不来 —— 必须能点单。 */
  var themeM = /[?&]theme=([a-z]+)/.exec(qs);
  var themeId = (themeM && Dungeon.THEME_BY_ID[themeM[1]]) ? themeM[1] : '';
  var charId = (charM && Chars.BY_ID[charM[1]]) ? charM[1] : 'gladiator';
  var wave = waveM ? Math.max(1, parseInt(waveM[1], 10)) : 8;

  var sess, p;

  if (mode === 'title') {
    Game.setState('title', true);
  } else if (mode === 'chars') {
    Game.setState('chars', true);
    UI.selectedChar = charId;
  } else if (mode === 'demo' || mode === 'arena' || mode === 'play' || mode === 'levelup' || mode === 'shop') {
    // 舞台搭建在 demo.ts 里（可被无头测试覆盖，见 test/comp.mjs 的容器审计）
    var staged = Demo.stage(charId, wave, themeId);
    sess = staged.sess;
    p = staged.p;

    if (mode === 'demo') Demo.scene(sess);
    /* arena：只为拍地面 —— 没有升级弹窗、没有贴花，环境才看得清 */
    if (mode === 'arena') Demo.arena(sess);
    if (mode === 'levelup') {
      p.xp = 999;
      Game._internals.checkLevelUp();
    }
    if (mode === 'shop') {
      sess.waveLeft = 0; sess.spawnQueue = []; sess.spawnIdx = 0; sess.enemies.length = 0;
      p.scrap = 220;
      Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });
    }
  } else if (mode === 'combine') {
    /* 合成演示：一屏里同时有"可合成的一对"与几个不同品级
       （按钮与品级色条只在确实有合成对象时才出现，所以它必须被单独摆一次） */
    var staged2 = Demo.stage(charId, wave);
    sess = staged2.sess;
    p = staged2.p;
    Demo.combine(sess);
    sess.waveLeft = 0; sess.spawnQueue = []; sess.spawnIdx = 0; sess.enemies.length = 0;
    p.scrap = 220;
    Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });
  } else if (mode === 'end') {
    Game.newRun(charId);
    sess = Game.getSession();
    sess.stats_total.kills = 1284;
    sess.stats_total.dmg = 486200;
    sess.stats_total.taken = 3190;
    sess.stats_total.healed = 860;
    sess.player.level = 27;
    Game.wave = 18;
    Game.setState('end', true);
    UI.show('end');
    document.getElementById('end-title').textContent = '你 被 击 倒 了';
    Game.events.emit('gameOver', Game.summary());
  } else if (mode === 'loading') {
    Game.newRun(charId);
    Game.setState('playing', true);
    UI.show('playing');
  }

  // 状态转换会发 stateChange，界面由该事件自动刷新

  if (/[?&]still=1/.test(qs)) {
    // 冻结时间；每帧重绘同一状态（Edge 截图前会重设 canvas 尺寸并清空位图，
    // 因此不能"只画一帧就停"，否则截到的是空白画布）
    var zoomM = /[?&]zoom=([0-9.]+)/.exec(qs);
    if (zoomM) R.cam.zoom = Math.max(0.5, Math.min(6, parseFloat(zoomM[1])));
    Game.time = 5;
    R.draw(Game.cfg.fixedDt);
    R.tick(Game.cfg.fixedDt);
    if (Game.getSession()) UI.updateHud();
    UI.show(['levelup', 'shop', 'end'].indexOf(mode) >= 0 ? mode : (mode === 'title' ? 'title' : 'playing'));
    return false;   // 继续跑 rAF，保持 canvas 有内容
  }
  return false;
}

function now() {
  return (performance && performance.now) ? performance.now() : Date.now();
}

/**
 * 暂停键是"可改的第三个"：Esc 与空格永远有效，改键只改第三个。
 *
 * `third` 由 `hotkeys()` 在**最前面**先读好再传进来 —— 因为 `Input.once()` 是
 * "读一次就清边沿"：谁先读谁拿到。以前这里自己读，于是任何排在它前面的裸读都能把它吃掉
 * （实测：默认的 `p` 被"结束录制"那条无条件消费，**默认暂停键从来没生效过**）。
 * Esc / 空格不能提前读：它们是"返回 / 确认"那一套共用的键，只能在分组里按场景读。
 */
function pauseKeyPressed(third) {
  var k = Input.bind.pause;
  if (Input.once('esc') || Input.once('space')) return true;
  return !!third;
}

/** 这个键现在是不是被绑成了游戏操作（移动 4 个 + 暂停 1 个） */
function isBoundKey(k) {
  var b = Input.bind;
  return k === b.up || k === b.down || k === b.left || k === b.right || k === b.pause;
}

/**
 * 调试热键的读取（`.` / r / l / g / m）。
 *
 * **绑定键优先**：`Input.once()` 是"读一次就清边沿"，所以顺序错了就等于把玩家的键吃掉。
 * 实测过的后果：默认暂停键是 `p`，而"结束录制"那一条无条件先 `Input.once('p')` ——
 * 一次按键的边沿在那一行就被消费掉，`pauseKeyPressed()` 读到的永远是 false，
 * **默认暂停键从来就没生效过**（Esc 能暂停，`p` 不能）。当时只测了 Esc 所以没发现。
 * 把绑定键让开之后，"暂停改绑到 r/l/g/m"这类改法也不会再变成死键。
 */
function debugKey(k) {
  return !isBoundKey(k) && Input.once(k);
}

/* ---------------- 全局热键 ----------------
   按"场景的按键组"派发（scene.ts 里声明），不再各处比较 Game.state。
   分组与改造前逐一对应，行为不变：
     menu   标题/选人：回车
     battle 战斗中：暂停（改造前也只有 playing 能暂停）
     cards  升级选卡：1-4
     shop   商店：回车/n 进下一波
     pause  暂停中：esc/p/空格 恢复
     back   帮助/设置/战绩：esc/回车/空格 返回来处（改造前帮助浮层不接热键）
     none   结算：不接热键 */
function hotkeys() {
  /* **第三个暂停键必须在最前面读**（理由见 `pauseKeyPressed` 的注释）：
     它可改，所以任何一条排在它前面的裸读都有可能是同一个键，会先把边沿吃掉。 */
  var pauseBind = Input.bind.pause;
  var pauseThird = (pauseBind !== 'esc' && pauseBind !== 'space') && Input.once(pauseBind);

  // 调试用的通用热键（引擎标准配置）：单步 / 录制 / 回放 / 诊断面板
  if (Input.once('.')) { stepOnce = 1; }                 // 单步一逻辑帧（配合暂停看时序）
  /* R = 录制开关（按一次开始、再按一次结束）。
     以前"开始"是 R、"结束"是 P —— 而 P 就是**默认暂停键**：`Input.once('p')` 是
     "读一次就清边沿"，录制那条分支先读，`pauseKeyPressed()` 再读就永远是 false，
     于是默认暂停键从来按不动（实测：一次 keydown(p)，第一次 once('p')=true、第二次=false）。
     现在收成一个键，把 P 完整地还给"暂停"。 */
  if (debugKey('r')) {
    if (Rec.isRecording()) {
      var tape = Rec.stop();
      lastTape = tape;
      console.log('[rec] 录制结束 ' + tape.frames + ' 帧 / ' + tape.events.length + ' 条命令');
      UI.toast('已录制 ' + tape.frames + ' 帧', 'good');
    } else {
      Rec.start();
      UI.toast('开始录制（再按 R 结束）', 'good');
    }
  }
  if (debugKey('l')) {                                    // l = 放一遍刚录的
    if (lastTape) {
      UI.toast('回放中…', '');
      Rec.play(lastTape, replayStep);
      UI.toast('回放结束', 'good');
    } else UI.toast('还没有带子（先按 R 录一段）', 'warn');
  }
  if (debugKey('g')) { UI.setDiag(!UI.diagEnabled()); }    // g = 诊断面板开关
  // M = 静音（放在分组判断之前，任何界面都能用：结算页想静音也得能按）
  if (debugKey('m')) {
    Settings.set('sound', !Settings.get('sound'));
    UI.toast(Settings.get('sound') ? '音效已开' : '已静音（M 恢复）', '');
    if (UI.renderSettings) UI.renderSettings();
  }
  var group = Scene.keyGroup(Game.state);

  /* 菜单焦点：一套通用的"方向键选、回车按"，覆盖所有非战斗场景（含结算页）。
     手柄的 dpad 映射成方向键、A 映射成 enter，所以这一段同时就是手柄的菜单操作 ——
     改造前手柄能移动、能暂停，却选不了升级卡，等于半个手柄。
     战斗中不接管方向键：那里方向键是移动。 */
  /* 战斗中不接管方向键（那里方向键是移动）；大厅 / 枢纽同理 ——
     那两屏是**能走的房间**，方向键必须留给角色，而不是菜单焦点。 */
  if (group !== 'battle' && group !== 'hall') {
    var fx = 0, fy = 0;
    if (Input.once('arrowright') || Input.once('d')) fx = 1;
    else if (Input.once('arrowleft') || Input.once('a')) fx = -1;
    else if (Input.once('arrowdown') || Input.once('s')) fy = 1;
    else if (Input.once('arrowup') || Input.once('w')) fy = -1;
    if (fx || fy) {
      if (UI.focusMove(fx, fy)) UI.toast('选中：' + UI.focusText(), '');
    }
    // 只有**已经有焦点**时才吃掉回车；否则原样留给下面的分支
    // （商店里回车 = 下一波，这条老行为不能被焦点机制弄丢）
    if (UI.hasFocus() && Input.once('enter')) {
      UI.activateFocus();
      return;
    }
  }

  if (group === 'none') return;

  // 速度切换：任何有画面的场景都能切；写进设置里，刷新后仍然记得
  if (Input.once('f')) {
    Settings.set('speed', Settings.get('speed') >= 2 ? 1 : 2);
    if (UI.renderSettings) UI.renderSettings();
    UI.toast('游戏速度 ' + Game.speed + 'x', '');
  }

  if (group === 'hall') {
    /* 屋里：Esc / 手柄 Start 暂停（暂停菜单里有"回大厅"），
       E / 回车 / 空格 = 与面前的人或公告板交互。
       ⚠ 走门**不用按键**：走进传送门就换屏（与地牢里走进门换房同一条规矩），
       所以这里只处理"面前的东西"。 */
    if (pauseKeyPressed(pauseThird)) {
      Game.pause();
      UI.renderPause();
      return;
    }
    if (Input.once('e') || Input.once('enter') || Input.once('space')) {
      /* 面前的交互由模拟层回答，并通过 `hallTalk` / `hallBoard` 广播给界面层
         （接入层只管把按键送进去，不替界面决定画什么）。 */
      Game.hallAct();
    }
    return;
  }

  if (group === 'pause') {
    if (pauseKeyPressed(pauseThird)) Game.resume();
    return;
  }
  if (group === 'battle') {
    if (pauseKeyPressed(pauseThird)) {
      Game.pause();
      UI.renderPause();
    }
    return;
  }
  if (group === 'back') {
    // 可返回覆盖层（帮助 / 设置 / 战绩）：来处由 setState 记录，回不去时退回 title
    if (Input.once('esc') || Input.once('enter') || Input.once('space')) {
      Game.setState(Game.returnFrom(Game.state));
    }
    return;
  }
  if (group === 'cards') {
    for (var i = 0; i < 4; i++) {
      if (Input.once(String(i + 1))) { Game.chooseLevelCard(i); break; }
    }
    return;
  }
  if (group === 'shop' || group === 'camp') {
    // 商店与营地共用"回车进下一波"（营地是从商店过去的可选去处）
    if (Input.once('enter') || Input.once('n')) {
      if (Game.nextWave()) {
        UI.toast('第 ' + Game.wave + ' 波 · ' + Enemies.describeWave(Game.wave), 'warn');
      }
    }
    return;
  }
  // menu：标题页回车进选人；start：选人页回车开局
  if (group === 'menu') {
    if (Input.once('enter')) Game.setState('chars');
    return;
  }
  if (group === 'start') {
    /* ⚠ 必须走 `UI.startRun()`，不能自己 `Game.newRun(UI.selectedChar)` ——
       那样会漏掉 `opening` / `smods` / `skillBuild` **三样**，其中 `skillBuild`
       一漏整个技能系统就不会发生（见 `ui.ts` 里 `UI.startRun` 的注释）。 */
    if (Input.once('enter')) UI.startRun();
  }
}

/* ---------------- 主循环 ---------------- */
function frame() {
  if (!running) return;
  var t = now();
  var dt = (t - last) / 1000;
  last = t;
  if (dt > Game.cfg.maxFrameDt) dt = Game.cfg.maxFrameDt;     // 切后台防跳帧
  acc += dt;
  Perf.sample(dt);

  if (globalThis.__still) {
    // 冻结模式：时间停止，但持续重绘同一帧，保证 canvas 始终有内容。
    // 注意 dt 不能为 0：摄像机靠 lerp 收敛，dt=0 会让它永远停在初始位置。
    Game.time = 5;
    R.alpha = 1;                // 冻结时直接画当前逻辑帧，不做插值
    R.draw(Game.cfg.fixedDt); R.tick(0);
    UI.updateHud();
    Perf.sample(Game.cfg.fixedDt);
    requestAnimationFrame(frame);
    return;
  }

  // 手柄要每显示帧轮询一次（Gamepad API 没有按键事件），
  // 且必须在 hotkeys() 之前 —— 热键读的是"这一帧新按下的键"。
  Input.poll();
  hotkeys();

  var FIXED = Game.cfg.fixedDt;
  var steps = 0;
  var maxSteps = Game.cfg.maxSteps;
  // 单步（.）：暂停状态下只推进一个逻辑帧 —— 引擎的标准调试开关
  if (stepOnce > 0) {
    stepOnce = 0;
    acc = 0;
    if (Scene.simulates(Game.state)) {
      var mv = Input.moveVec();
      Rec.input(mv);
      Game.step(FIXED, frameInput(mv));
    }
    Input.endFrame();
  }
  while (acc >= FIXED && steps < maxSteps) {
    acc -= FIXED;
    steps++;
    if (Scene.simulates(Game.state)) {
      var reps = Game.speed >= 2 ? 2 : 1;
      for (var r = 0; r < reps; r++) {
        var inp = Input.moveVec();
        Rec.input(inp);                 // 录制：每逻辑帧记一次输入
        Game.step(FIXED, frameInput(inp));
      }
    }
    Input.endFrame();
  }
  if (steps >= maxSteps) acc = 0;

  // 显示帧插值系数：还剩多少没被逻辑帧吃掉的时间（0=刚跑完一帧，1=马上要跑下一帧）
  R.alpha = acc / FIXED;
  if (!(R.alpha >= 0 && R.alpha <= 1)) R.alpha = 1;

  // 渲染：画世界还是待机背景，由场景表决定（title/chars 没有会话，画待机背景）
  if (Game.getSession() && Scene.drawsWorld(Game.state)) {
    R.draw(dt);
    R.tick(dt);
    UI.tickDiag(dt);
  } else {
    R.drawIdle(dt);
  }

  if (Scene.showsHud(Game.state)) UI.updateHud();
  /* 屋里（大厅 / 枢纽）：HUD 要跟着**玩家的位置**收放 —— 走到公告板前按 E 才摊开
     这一局的账，走开一步就收起来；站在谁面前才有谁的对话框。所以它是每显示帧
     同步的，不是"进屏刷一次"（那样对话框会留在屏幕上，又变成一份常驻面板）。 */
  if (Scene.keyGroup(Game.state) === 'hall') UI.hallSync();

  /* 背景音乐：**每个显示帧调一次 `update`**，由它按场景决定放什么。
     为什么不让界面各自调 `Music.play`：那样"哪个界面放哪首"会散到十几处，
     改一次要改五处，而漏掉的那个只会表现为"进这个界面音乐停了"。
     `update` 对"已经在放同一首"是幂等的（不会把曲子掐回第一拍）。 */
  Music.update(Game.state, musicIntensity());

  requestAnimationFrame(frame);
}

/**
 * 战斗音乐的强度档：**唯一的读点**。
 * 它读的是"波次 + 层 + 这一间是不是关底"，而不是渲染层的任何东西 ——
 * 音乐是听感，但它跟着**玩法状态**走（关底那间就该是 Boss 那首）。
 */
function musicIntensity() {
  var sess = Game.getSession();
  if (!sess) return 0;
  var cur = sess.map ? (sess.map.rooms.filter(function (r) { return r.id === sess.roomId; })[0]) : null;
  return Music.intensityFor(Game.wave, sess.floor, !!(cur && cur.type === 'boss'));
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}
