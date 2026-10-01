/* =========================================================
   demo.ts — 开发用测试场景（`?test=…` 的舞台搭建）
   从 main.ts 抽出来的原因不是"文件太长"，而是**这段代码以前够不到**：
   它直接手写对象字面量 push 进容器，绕过了组件系统 ——
     sess.decals.push({ x, y, r, seed, color, life })
   贴花原型实际有 9 个形状字段（seq / a1 / a2 / d1 / d2 / s1 / s2 …）它一个都没有，
   于是渲染这一帧会往 canvas 送 **14 次 NaN 参数**（arc(NaN,NaN,NaN…)），
   而它藏在入口文件里、测试碰不到，所以一直没人发现。
   现在它是可测的：`test/comp.mjs` 会把这几个场景的**每个容器里的每个对象**
   都过一遍 Comp.archOf / Comp.audit。
   ========================================================= */

import { Affixes } from './affixes.ts';
import { Comp } from './comp.ts';
import { Chars } from './data_chars.ts';
import { Items } from './data_items.ts';
import { Dungeon } from './dungeon.ts';
import { Game } from './game.ts';
import { Stats } from './stats.ts';
import { PAL } from './utils.ts';

var Demo = {} as DemoApi;

/**
 * 把一个新会话推进到"已经打到第 wave 波、满配"的状态：
 * 补齐成长、装满 6 把武器与几个道具，并跳到目标波次。
 * @param themeId 可选：**强行指定这一层的环境**（`?test=…&theme=molten`）。
 *                环境是每局抽签的，所以"另一个地方长什么样"没法靠换种子等着抽到 ——
 *                要么钉住它，要么就永远量不到（ui-shot 的 `env-*.png` 靠它）。
 * @returns { sess, p }
 */
Demo.stage = function (charId, wave, themeId) {
  var id = (Chars.BY_ID[charId]) ? charId : 'gladiator';
  var sess = Game.newRun(id);
  var p = sess.player;
  var i, k, keys;

  /* 环境必须在 startWave **之前**钉住：战场是按 `S.map.theme` 生成的，
     晚一步就只是改了个名字，画出来还是原来那个地方。 */
  if (themeId && Dungeon.THEME_BY_ID[themeId] && sess.map) sess.map.theme = themeId;

  // 直接搭出第 N 波。
  // 老实现是 `while (Game.wave < wave) Game.nextWave();` —— 那是**死循环**：
  // nextWave() 要求当前在 shop 状态（状态机测试专门守着这条），而 stage 是在
  // playing 状态下调用的，于是 nextWave 每次都返回 false、Game.wave 永不前进。
  // 也就是说 `?test=play|demo|levelup|shop`（wave 默认 8）会直接卡死浏览器。
  if (wave > 1) Game._internals.startWave(wave);

  for (i = 0; i < wave * 2; i++) {
    keys = Stats.KEYS;
    k = keys[(i * 7) % keys.length];
    p.upgrades[k] += Stats.DEF[k].kind === 'pct' ? 0.05 : 2;
  }

  p.weapons.length = 0;
  ['minigun', 'sword', 'shotgun', 'flame', 'laser', 'hammer'].forEach(function (wid) {
    Game.addWeapon(wid);
  });
  ['coffee', 'cloak2', 'scopeitem', 'charm'].forEach(function (iid) {
    if (!Items.BY_ID[iid]) return;
    /* 演示舞台走的是**同一个**生成规则（`Affixes.roll` + 同一条派生随机流）：
       它是开发工具，不该有一条只有它才有的"没有词条的道具"，
       也不该让词条在截图里永远缺席。 */
    var it = Comp.spawn('item', { def: Items.BY_ID[iid] });
    it.affixes = Affixes.roll('item', Items.BY_ID[iid], Items.BY_ID[iid].tier || 1, Game.affixRnd());
    p.items.push(it);
  });
  Game.recalcStats();
  p.hp = Math.round(sess.stats.maxHp * 0.72);
  p.xp = Math.round(p.xpNeed * 0.45);
  return { sess: sess, p: p };
};

/**
 * 合成的舞台：一局里同时摆出"可以合的一对"和几个不同品级。
 *
 * 为什么需要它：武器卡片上的「合并 / 回收」按钮与品级色条**只在有合成对象时才出现**，
 * 而满配演示（Demo.stage）用的是六把不同的武器 —— 于是"合成这一屏长什么样"
 * 在无头测量里从来没被量到过。这一份就是让 ui-shot 能拍到它。
 */
Demo.combine = function (sess) {
  var p = sess.player;
  p.weapons.length = 0;
  Game.addWeapon('knife');            // T1
  Game.addWeapon('knife');            // T1 —— 与上一把同名同档：卡片上会出现「合并」
  Game.addWeapon('knife', 2);         // T2 —— 已经合过一次的（有品级角标）
  Game.addWeapon('sword');            // T2 —— 出身档就是 T2 的（不该被当成"合上去的"）
  Game.addWeapon('shotgun', 4);       // T4 —— 色条 + 角标 + 多一格穿透
  Game.addWeapon('crossbow');         // T2
  sess.combineCount = 3;              // 「已合成 ×3」那行也量得到
  Game.recalcStats();
  return sess;
};

/**
 * **只为量地面而生的场景**：几只站着不动的怪 + 干净的地面，没有贴花、没有飘字、
 * 也没有升级弹窗。`?test=arena&theme=<环境id>` 就是它的入口。
 *
 * 为什么不能复用 `Demo.scene`：那个场景打死了怪 → 掉经验 → **升级界面弹出来**，
 * 于是截图拍到的是 `scr-levelup` 而不是战场。这不是工具的问题，是它本来就在测别的东西：
 * 一轮改造里"环境是每局抽签的"这条要能**看见**（10 套配色、5 种装饰物），
 * 而在此之前没有任何一屏拍得到战场地面 —— ui-shot 现有的 play/demo 两屏
 * 分别停在商店和升级界面上。
 */
Demo.arena = function (sess) {
  var p = sess.player;
  var spots: Array<[string, number, number]> = [
    ['grub', -260, -120], ['spike', 240, -160], ['spitter', 300, 140],
    ['brute', -300, 170], ['orbiter', 60, -240]
  ];
  spots.forEach(function (s) {
    var e = Game._internals.spawnEnemy(s[0], p.x + s[1], p.y + s[2], {});
    if (e) e.spawnT = 0;
  });
  // 怪站着不动，玩家也不动：这一屏量的是**环境**，动起来只会糊掉地面
  p.invuln = 1e9;
  for (var i = 0; i < 30; i++) Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });
  return sess;
};

/** 一个密集团战现场：多方向混合怪群 + 残血 + 掉落 + 贴花 + 特效 */
Demo.scene = function (sess) {
  var p = sess.player;
  var i;
  var spots: Array<[string, number, number]> = [
    ['grub', 120, -40], ['grub', 150, 60], ['grub', 90, 130], ['spike', -130, 40],
    ['spike', -90, -110], ['spitter', 240, -150], ['orbiter', -230, -160],
    ['brute', -170, 170], ['exploder', 170, 200], ['splitter', -250, 60],
    ['shielder', 60, -230], ['grub', -60, 220], ['spike', 230, 130], ['grub', -300, -60]
  ];
  spots.forEach(function (s, idx) {
    var e = Game._internals.spawnEnemy(s[0], p.x + s[1], p.y + s[2], { elite: idx % 5 === 0 });
    if (e) { e.spawnT = 0; e.hp = e.maxHp * (0.35 + (idx % 4) * 0.2); if (idx % 3 === 0) e.burn = 1.5; } // status-field-ok：只是给演示摆出"几只怪在烧"的样子，不参与任何状态语义
  });
  Game._internals.spawnEnemy('giant', p.x + 300, p.y - 200, {});
  sess.enemies.forEach(function (e) { if (e.def.boss) e.spawnT = 0; });

  // 掉落与贴花都必须走组件/公开入口：
  // 以前这里是手写字面量，贴花少了 7 个形状字段 → 渲染时 14 次 NaN 参数
  for (i = 0; i < 22; i++) {
    sess.pickups.push(Comp.spawn('pickup', {
      kind: i % 7 === 0 ? 'heal' : 'mat',
      x: p.x + Math.cos(i) * (60 + i * 7), y: p.y + Math.sin(i * 1.7) * (50 + i * 5),
      vx: 0, vy: 0, seed: i, value: 2
    }));
  }
  for (i = 0; i < 16; i++) {
    Game._internals.addStain(
      p.x + Math.cos(i * 2.1) * (80 + i * 12),
      p.y + Math.sin(i * 3.3) * (70 + i * 9),
      10 + (i % 4) * 5,
      i % 2 ? PAL.BLOOD : PAL.E2D);
  }

  // 命中特效与飘字
  if (sess.enemies[0]) Game.damageEnemy(sess.enemies[0], 1, { showText: true });
  if (sess.enemies[1]) Game.damageEnemy(sess.enemies[1], 99999, { showText: true });
  for (i = 0; i < 60; i++) Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });
  return sess;
};

export { Demo };
