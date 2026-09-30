/* =========================================================
   arena.ts — 战场（数据 + 程序化装饰生成）
   ---------------------------------------------------------
   地面为平涂色块 + 抖动过渡，点缀深色岩石碎石与白骨。

   **这里是"不同的地图 = 不同的环境"的落地点**：
   配色与装饰物种类**不再写死**，而是由层环境（`Dungeon.THEME_BY_ID[id].pal/prop`）
   给进来。以前这个模块只认一个写死的红棕色表，于是三层楼在战场上像素完全一样 ——
   "环境"只是小地图标题上的两个字。

   两种东西是**分开**的：
     · 配色（`pal`）与水/岩/裂纹的色 —— 平涂，直接换色号
     · 装饰物（`prop`）—— 白骨 / 菌伞 / 晶簇 / 余烬 / 冰棱，形状不同
   所以"换环境"不是一个滤镜，是另一套地形语言。
   ========================================================= */

import { U } from './utils.ts';
import { Dungeon } from './dungeon.ts';
import { World } from './world.ts';
var Arena = {} as ArenaApi;

/* 尺寸的**唯一出处是 `world.ts` 的区域表**（R51 收口）。
   ⚠ 这个模块仍然叫"战场"，但它不再回答"战场多大"——
   那是世界系统的事（`World.zone('arena')`），这里只说"战场上长什么"。 */
Arena.W = World.size('arena').w;
Arena.H = World.size('arena').h;
Arena.PAD = World.zone('arena').pad;   // 边界内缩（角色不可越过）

/** 每个环境配几种装饰物变体（画法在 render.ts 的 PROP_DRAW 里，按 kind 查） */
var PROP_VARIANTS: Record<string, string[]> = {
  bone: ['rib', 'skull'],
  fungus: ['cap', 'stalk'],
  crystal: ['shard', 'cluster'],
  ember: ['ember', 'vent'],
  ice: ['spike', 'block']
};

/**
 * 生成一块战场的静态装饰数据（纯数据，绘制在 render.ts）
 * @param themeId 层环境 id；缺省 = 默认环境（无会话/无头测试的降级路径，
 *                同时保证"没有主题"这件事不会画不出东西）
 */
Arena.build = function (wave, themeId) {
  var th = Dungeon.THEME_BY_ID[themeId] || Dungeon.THEME_BY_ID.shallow;
  var pal = th.pal;
  var prop = PROP_VARIANTS[th.prop] ? th.prop : 'bone';
  var variants = PROP_VARIANTS[prop];

  /* 随机流**仍然只吃波次**（`arena-wave-N`）：环境不参与种子 ——
     否则同一个波次换一层楼，地形装饰会跟着挪，"这一间我见过"就不再成立。
     环境只决定**用什么色、长什么形状**，不决定**摆在哪**。 */
  var rnd = U.rng(U.seedFromStr('arena-wave-' + wave));
  var a: ArenaData = {
    w: Arena.W,
    h: Arena.H,
    wave: wave,
    theme: th.id,
    pal: pal,
    prop: prop,
    patches: [],
    pebbles: [],
    rocks: [],
    cracks: [],
    props: [],
    seed: U.seedFromStr('arena' + wave)
  };

  var i, x, y, r;

  /* 大地块色斑（平涂）。色号顺序与改造前逐位一致：
     [浅带, 基色, 中带, 亮带, 暗带] —— 只是每一档换成了环境的色号 */
  var tones = [pal.tones[1], pal.base, pal.tones[2], pal.tones[3], pal.tones[0]];
  for (i = 0; i < 70; i++) {
    a.patches.push({
      x: rnd() * Arena.W,
      y: rnd() * Arena.H,
      rx: 90 + rnd() * 240,
      ry: 60 + rnd() * 170,
      rot: rnd() * U.TAU,
      pts: 7 + Math.floor(rnd() * 4),
      bump: 0.10 + rnd() * 0.16,
      seed: rnd() * 10,
      tone: tones[Math.floor(rnd() * tones.length)],
      form: rnd() < 0.35 ? 'flat' : 'blob'
    });
  }

  // 碎石
  for (i = 0; i < 210; i++) {
    a.pebbles.push({
      x: rnd() * Arena.W, y: rnd() * Arena.H,
      r: 2 + rnd() * 5,
      tone: rnd() < 0.55 ? pal.pebble : pal.pebbleHi,
      sq: 0.7 + rnd() * 0.6,
      rot: rnd() * U.TAU
    });
  }

  // 岩石障碍（纯装饰，不阻挡；数量少、色块干净）
  for (i = 0; i < 13; i++) {
    x = 120 + rnd() * (Arena.W - 240);
    y = 120 + rnd() * (Arena.H - 240);
    r = 22 + rnd() * 30;
    a.rocks.push({
      x: x, y: y, r: r,
      pts: [],
      seed: rnd() * 10,
      n: 6 + Math.floor(rnd() * 3),
      dark: rnd() < 0.5
    });
    // 岩石轮廓点
    var rock = a.rocks[a.rocks.length - 1];
    for (var k = 0; k < rock.n; k++) {
      var ang = k / rock.n * U.TAU;
      var rr = r * (0.68 + rnd() * 0.5);
      rock.pts.push([Math.cos(ang) * rr, Math.sin(ang) * rr * 0.82]);
    }
  }

  // 地面裂纹（细线，极简）
  for (i = 0; i < 16; i++) {
    var cx = rnd() * Arena.W, cy = rnd() * Arena.H;
    var pts = [[cx, cy]];
    var ang2 = rnd() * U.TAU;
    var n = 3 + Math.floor(rnd() * 4);
    for (var j = 0; j < n; j++) {
      ang2 += (rnd() - 0.5) * 1.1;
      var len = 22 + rnd() * 44;
      cx += Math.cos(ang2) * len; cy += Math.sin(ang2) * len;
      pts.push([cx, cy]);
    }
    a.cracks.push({ pts: pts, w: 2 + rnd() * 2 });
  }

  /* 环境装饰物。位置与改造前**同一串随机数**（每个 1 次 rnd），
     所以换环境不会把"这一间的石头在哪"也换掉 —— 只换形状与颜色。 */
  for (i = 0; i < 12; i++) {
    a.props.push({
      x: rnd() * Arena.W, y: rnd() * Arena.H,
      rot: rnd() * U.TAU, s: 0.7 + rnd() * 0.6,
      kind: variants[Math.floor(rnd() * variants.length)] || variants[0]
    });
  }

  return a;
};

/** 把坐标夹在战场内 */
Arena.clampPos = function (x, y, r) {
  r = r || 0;
  return {
    x: U.clamp(x, Arena.PAD + r, Arena.W - Arena.PAD - r),
    y: U.clamp(y, Arena.PAD + r, Arena.H - Arena.PAD - r)
  };
};

Arena.inside = function (x, y, r) {
  r = r || 0;
  return x >= Arena.PAD + r && x <= Arena.W - Arena.PAD - r &&
         y >= Arena.PAD + r && y <= Arena.H - Arena.PAD - r;
};

export { Arena };
