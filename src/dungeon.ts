/* =========================================================
   dungeon.ts — 楼层地图（随机地牢的心跳）

   参照（都是"一局 = 一张随机图 + 随机 Boss"的经典）：
     · **以撒的结合**：房间网格 + 门连接；**死路放特殊房**（宝箱/商店/Boss）；
       **秘密房**必须与 2 个以上房间相邻、不显示在地图上、要**炸墙**才进得去
     · **挺进地牢**：每层随机房型与随机 Boss；隐藏层要靠特定条件才开
     · **死亡细胞 / 杀戮尖塔**：层与层之间有**路线选择**，不是一条直线
     · **Deep Rock**：地图与事件都由种子长出来，同一个种子所有人看到同一张图

   本模块只做**纯数据 + 纯函数**：给（种子, 层号）→ 一张地图。
   不碰模拟层、不碰渲染层，所以：
     · 同一份种子在任何机器上长出**完全一样**的地牢（成绩码因此可以复算）
     · 每日/每周挑战的"共享种子"直接等价于"同一天全世界同一座地牢"
     · 可以脱离对局单独测试（test/dungeon.mjs 会跑几百个种子）

   **隐藏要素从这一层就设计进去**（不能事后补）：
     · 密室（secret）不显示在小地图上，`seen` 为假时玩家根本不知道它存在
     · 它的门是**暗门**：与相邻房间之间的墙上有一道裂纹（`clueSeed` 给渲染层用），
       打穿那一面墙才开 —— 所以"往可疑的墙上打两枪"是一个真实动作，不是随机白给
     · 暗门**在数据上存在、但不算通路**：连通性自检要求"不破墙就走不到密室"
   ========================================================= */

import { SelfCheck } from './selfcheck.ts';
import { Registry } from './registry.ts';
import { U } from './utils.ts';

var Dungeon = {} as DungeonApi;

/* =========================================================
   1. 房间类型
   ========================================================= */
var TYPES: DungeonRoomTypeDef[] = [
  { id: 'start', name: '入口', icon: '▲', budgetMul: 0, note: '一层的第一间，安全', cls: 'start' },
  /* 图标是**给玩家看的路牌**：门按钮上写的就是这个字，所以普通战斗房也用看得懂的那个，
     而不是一个居中点（"· 战斗"看着像没画出来）。 */
  { id: 'fight', name: '战斗', icon: '⚔', budgetMul: 1.0, note: '普通遭遇', cls: 'fight' },
  {
    id: 'elite', name: '精英', icon: '◆', budgetMul: 1.7, elite: true,
    note: '整批精英化（更硬更疼），打完有一大笔材料', mods: { eliteChance: 0.35 }, cls: 'elite'
  },
  { id: 'treasure', name: '宝箱', icon: '▣', budgetMul: 0, note: '白给一件装备（武器或道具）', cls: 'treasure' },
  { id: 'shop', name: '商店', icon: '$', budgetMul: 0, note: '把商店搬进地牢', cls: 'shop' },
  { id: 'camp', name: '补给', icon: '⌂', budgetMul: 0, note: '回血 + 一笔建材（工坊的本钱）', cls: 'camp' },
  { id: 'event', name: '事件', icon: '?', budgetMul: 0, note: '一次选择，代价与好处并存', cls: 'event' },
  /* 限时房（G5）：同样刷怪，但**时限砍半**、按时清完的奖励翻倍、超时几乎什么都没有。
     它把"时钟"从背景音变成这一间的主角 —— 于是"打得快"本身成了一种玩法。 */
  {
    id: 'rush', name: '限时', icon: '⧗', budgetMul: 1.25,
    note: '窄门：时限只有一半，按时打完奖励翻倍（超时就什么都没有）',
    mods: { waveTime: 0.5 }, cls: 'rush'
  },
  {
    id: 'boss', name: '关底', icon: '☠', budgetMul: 3.0,
    note: '这一层的 Boss', mods: { bossEvery: 1 }, cls: 'boss'
  },
  {
    id: 'secret', name: '密室', icon: '✳', budgetMul: 0,
    note: '【不显示在地图上】墙上有裂纹，打穿才进得去；里面有合金', secret: true, cls: 'secret'
  }
];

var TYPE_BY_ID: Record<string, DungeonRoomTypeDef> = Object.create(null);
for (var ti = 0; ti < TYPES.length; ti++) TYPE_BY_ID[TYPES[ti].id] = TYPES[ti];

/* =========================================================
   2. 层环境（主题 = 难度带 + 这一局长什么样）
   ---------------------------------------------------------
   改造前这里只有 4 行、而且**层号直接查表**：`THEMES[min(len-1, f-1)]`。
   两个后果都是可以量的：
     · 第 1 层永远是碎石浅层、第 2 层永远是菌毯洞窟、第 3 层永远是熔渣裂谷 ——
       于是"这一层是什么地方"在一局开始前就知道了，跑一百局也一样；
     · 更彻底的是，`theme` 在渲染层**一次都没被读过**（render.ts 全文 0 处）：
       地面配色是写死的红棕 `PAL.G1..G6`，所以两层不同的"环境"在战场上
       **像素完全一样**。环境只是小地图标题上的两个字。

   现在拆成两件事，因为它们本来就不是一回事：
     · **多难 = 层号决定的"带"**（`bandOf`）。带心就是改造前那一档的值，
       所以抽签不会偷偷改难度（test/dungeon.mjs 断言带内均值 = 带心）；
     · **长什么样 = 种子决定的抽签**（`themeFor`）。同一带里 2~3 个环境，
       每一局抽一个 —— 同样是第 2 层，这一局可能是菌毯洞窟，下一局是晶簇矿脉。

   `themeFor` 用**独立的随机流**（盐 + 种子），不碰 `genFloor` 那一串 `rnd`：
   否则"换个环境"会顺手把房间布局也挪掉 —— 同种子的旧成绩码会全部作废，
   而这件事跟"环境该不该变"毫无关系。房间布局至今逐位不变（指纹可证）。
   ========================================================= */

/** 每个环境配色都是**一份平涂色表**（美术宪法：3px 描边 + 平涂、不用渐变）。
 *  `shallow` 那一份就是原样搬过来的 `PAL` 地面六色 ——
 *  于是"默认环境"的长相与改造前逐像素相同，变化全部发生在**别的**环境上。 */
var THEMES: FloorThemeDef[] = [
  /* ---- 带 1：浅层。带心 生命 ×1.00 / 伤害 ×1.00 / 池 +0 ---- */
  {
    id: 'shallow', name: '碎石浅层', note: '红棕荒漠，还算客气',
    band: 1, poolShift: 0, hpMul: 1.0, dmgMul: 1.0, prop: 'bone',
    pal: {
      base: '#a4623a', tones: ['#7a4630', '#8e5233', '#b8763f', '#c98a55', '#d9a26a'],
      pebble: '#6d4128', pebbleHi: '#c99a68',
      rock: '#5d4a45', rockHi: '#7b6660', rockDark: '#3f3230',
      crack: '#7a4630', propA: '#e2d6b8', propB: '#a89c8a'
    }
  },
  {
    id: 'moss', name: '苔原台地', note: '青苔盖住了碎石，安静得不对劲',
    band: 1, poolShift: 0, hpMul: 0.98, dmgMul: 1.02, prop: 'fungus',
    pal: {
      base: '#4d5c3e', tones: ['#37452c', '#45543a', '#536345', '#637550', '#75875c'],
      pebble: '#2f3a27', pebbleHi: '#93a473',
      rock: '#4a4f46', rockHi: '#666c60', rockDark: '#2c3029',
      crack: '#37452c', propA: '#c9b06a', propB: '#8a6f3f'
    }
  },
  {
    id: 'ashen', name: '灰烬滩', note: '烧过一遍的平原，风一吹全是灰',
    band: 1, poolShift: 0, hpMul: 1.02, dmgMul: 0.98, prop: 'bone',
    pal: {
      base: '#6b625c', tones: ['#4a443f', '#585049', '#665d55', '#7a7069', '#8f857d'],
      pebble: '#3d3833', pebbleHi: '#a99e95',
      rock: '#4f4a46', rockHi: '#6e6862', rockDark: '#332f2c',
      crack: '#4a443f', propA: '#ddd3c2', propB: '#a89c8a'
    }
  },

  /* ---- 带 2：中层。带心 生命 ×1.12 / 伤害 ×1.05 / 池 +1 ---- */
  {
    id: 'fungal', name: '菌毯洞窟', note: '敌人更硬，孢子更多',
    band: 2, poolShift: 1, hpMul: 1.12, dmgMul: 1.05, prop: 'fungus',
    pal: {
      base: '#63536b', tones: ['#453a4d', '#54465c', '#63536b', '#75647d', '#8a7890'],
      pebble: '#3a3142', pebbleHi: '#a58fb0',
      rock: '#4d4450', rockHi: '#6a5f6d', rockDark: '#312b34',
      crack: '#453a4d', propA: '#c07fb0', propB: '#7d5a86'
    }
  },
  {
    id: 'crystal', name: '晶簇矿脉', note: '整片岩层都在反光，扎脚',
    band: 2, poolShift: 1, hpMul: 1.10, dmgMul: 1.07, prop: 'crystal',
    pal: {
      base: '#5d6b7a', tones: ['#424e5c', '#4e5c6b', '#5d6b7a', '#6e7d8c', '#81909f'],
      pebble: '#37424e', pebbleHi: '#b6c6d4',
      rock: '#494f57', rockHi: '#656c76', rockDark: '#2e3238',
      crack: '#424e5c', propA: '#a8d8e8', propB: '#5f8fc4'
    }
  },
  {
    id: 'rust', name: '铁锈工场', note: '不知道谁留下来的骨架，锈成了橙色',
    band: 2, poolShift: 1, hpMul: 1.14, dmgMul: 1.03, prop: 'ember',
    pal: {
      base: '#7a5540', tones: ['#4f382a', '#5f4433', '#6d5040', '#7f6250', '#93745f'],
      pebble: '#43301f', pebbleHi: '#c08a5a',
      rock: '#4d433c', rockHi: '#6b5c52', rockDark: '#2f2925',
      crack: '#4f382a', propA: '#e07a3a', propB: '#a9743f'
    }
  },

  /* ---- 带 3：深层。带心 生命 ×1.20 / 伤害 ×1.15 / 池 +2 ---- */
  {
    id: 'molten', name: '熔渣裂谷', note: '更疼，但材料更多',
    band: 3, poolShift: 2, hpMul: 1.20, dmgMul: 1.15, prop: 'ember',
    pal: {
      base: '#5c382e', tones: ['#3f2620', '#4f2f27', '#5c382e', '#6d4436', '#82543f'],
      pebble: '#33201a', pebbleHi: '#c07a4a',
      rock: '#4a3a35', rockHi: '#67504a', rockDark: '#2b211e',
      crack: '#3f2620', propA: '#e07a3a', propB: '#8f3f33'
    }
  },
  {
    id: 'frost', name: '霜殒洞窟', note: '呼吸都结成冰，地面滑得站不住',
    band: 3, poolShift: 2, hpMul: 1.18, dmgMul: 1.17, prop: 'ice',
    pal: {
      base: '#556069', tones: ['#3d4852', '#48545e', '#556069', '#64707a', '#77838d'],
      pebble: '#38424a', pebbleHi: '#cfe0e8',
      rock: '#464e55', rockHi: '#616b73', rockDark: '#2b3136',
      crack: '#3d4852', propA: '#cfeef8', propB: '#7fc4d9'
    }
  },
  {
    id: 'void', name: '虚空裂隙', note: '光在这里走不直，深处有什么在看着你',
    band: 3, poolShift: 2, hpMul: 1.22, dmgMul: 1.13, prop: 'crystal',
    pal: {
      base: '#453c55', tones: ['#2e2838', '#393147', '#453c55', '#544a66', '#665b7a'],
      pebble: '#282231', pebbleHi: '#9b8cb5',
      rock: '#3d3746', rockHi: '#564e63', rockDark: '#24202b',
      crack: '#2e2838', propA: '#b48fe0', propB: '#6b5086'
    }
  },

  /* ---- 带 4：通关后的可选挑战。只有一个环境，所以带心必须逐位等于旧值 ---- */
  {
    id: 'abyss', name: '深井', note: '通关后的可选挑战',
    band: 4, poolShift: 3, hpMul: 1.35, dmgMul: 1.30, prop: 'crystal',
    pal: {
      base: '#3f3a44', tones: ['#2a262e', '#332f38', '#3f3a44', '#4c4653', '#5d5666'],
      pebble: '#242028', pebbleHi: '#8d84a0',
      rock: '#38333d', rockHi: '#514b58', rockDark: '#201d24',
      crack: '#2a262e', propA: '#9b8cb5', propB: '#5f5470'
    }
  }
];

var THEME_BY_ID: Record<string, FloorThemeDef> = Object.create(null);
var THEME_BY_BAND: Record<number, FloorThemeDef[]> = Object.create(null);
for (var hi = 0; hi < THEMES.length; hi++) {
  THEME_BY_ID[THEMES[hi].id] = THEMES[hi];
  var tb = THEME_BY_BAND[THEMES[hi].band] || (THEME_BY_BAND[THEMES[hi].band] = []);
  tb.push(THEMES[hi]);
}

/** 环境带数（= 通关后那层也算一带） */
var BANDS = 4;
/** 每一带的**难度中心**：就是改造前"层号查表"那一档的值。
 *  它是"抽签不改难度"的唯一依据 —— 带内的环境在它两侧抖动，均值必须落回来。 */
var BAND_CENTER: Record<number, { hp: number; dmg: number; shift: number }> = {
  1: { hp: 1.00, dmg: 1.00, shift: 0 },
  2: { hp: 1.12, dmg: 1.05, shift: 1 },
  3: { hp: 1.20, dmg: 1.15, shift: 2 },
  4: { hp: 1.35, dmg: 1.30, shift: 3 }
};
/** 装饰物种类。**唯一出处**：render.ts 必须认得每一个（自检会对着它查） */
var PROP_KINDS = ['bone', 'fungus', 'crystal', 'ember', 'ice'];

/** 某一层属于哪一带（1..BANDS；越界一律夹回来） */
function bandOf(floor) {
  var f = Math.floor(Number(floor) || 1);
  if (!(f >= 1)) f = 1;
  return Math.min(BANDS, f);
}

/**
 * 这一层这一局是什么环境。
 * **纯函数 (种子, 层号)**，且**不吃地图的随机流**（见本节开头）——
 * 于是：同种子必得同环境（成绩码可复算 / 每日挑战全世界同一座地牢），
 * 而地图布局与"环境抽签"这件事完全解耦。
 */
function themeFor(seed, floor) {
  var band = bandOf(floor);
  var list = THEME_BY_BAND[band];
  if (!list || !list.length) return THEMES[0];
  var r = U.rng(U.seedFromStr('theme:' + band + ':' + ((seed >>> 0) || 0)));
  var i = Math.floor(r() * list.length);
  if (!(i >= 0 && i < list.length)) i = 0;
  return list[i];
}

/* =========================================================
   2b) 房间/主题 → 一波的修正（**与 danger.ts 同一套键名**）
   ---------------------------------------------------------
   这一层是"设计表 → 模拟层的数值"的唯一出口。规矩与 danger/stronghold/talents
   完全一致：**键名就是读取名**，所以模拟层（`Enemies.buildWave` / `spawnEnemy`）
   一行都不用改 —— 它拿到的仍然是一份折好的普通对象。

   为什么不让地牢自己发明 `hpMul2` 之类的新键：那样"声明了却没人读"只能靠人眼查。
   现在 `MOD_KEYS` 的每个键都必须能在 danger.ts 的 BASE 里找到同名的（test/dungeon.mjs
   静态对照），所以"地牢说它加了多少血"必然真的加到了怪身上。
   ========================================================= */
var MOD_KEYS: Record<string, DungeonModKey> = {
  waveBudget: { how: 'mul', note: '刷怪预算倍率（enemies.ts buildWave）' },
  waveTime: { how: 'mul', note: '房间时限倍率（game.ts startWave）—— 越小越紧' },
  enemyHp: { how: 'mul', note: '敌人生命倍率（game.ts spawnEnemy）' },
  enemyDmg: { how: 'mul', note: '敌人伤害倍率（game.ts spawnEnemy）' },
  enemySpeed: { how: 'mul', note: '敌人移速倍率（game.ts spawnEnemy）' },
  eliteChance: { how: 'add', note: '精英概率加成（enemies.ts buildWave）' },
  poolShift: { how: 'add', note: '怪物池按 wave+N 取（enemies.ts buildWave）' },
  bossEvery: { how: 'min', note: '每 N 间房出 Boss（Boss 房给 1 = 必出）' }
};

/** 恒等值。折叠时以它为准，所以"没有修正的房间"必然等于原样 */
var MOD_BASE: Record<string, number> = {
  waveBudget: 1, waveTime: 1, enemyHp: 1, enemyDmg: 1, enemySpeed: 1,
  eliteChance: 0, poolShift: 0, bossEvery: 99
};

function applyMod(out: Record<string, number>, key: string, v: number) {
  var def = MOD_KEYS[key];
  if (!def) return;                       // 未声明的键：忽略（audit 会报出来）
  if (def.how === 'mul') out[key] = out[key] * v;
  else if (def.how === 'add') out[key] = out[key] + v;
  else if (def.how === 'min') out[key] = Math.min(out[key], v);
  else out[key] = v;
}

/* =========================================================
   3. 生成
   ---------------------------------------------------------
   算法（以撒那一套的简化版，但规则一样）：
     1) 从中心格开始做**随机生长**：每次挑一个还有空邻格的房间，往空处扩一间
     2) 死路（只有 1 个邻居）**留给特殊房** —— 这是以撒的硬规则，不是审美
     3) 离起点最远的死路当 Boss 房（保证"越走越深"）
     4) 密室：找**与 2 个以上房间相邻的空格**（以撒的秘密房规则），
        它到每个邻居的门都是暗门
   ========================================================= */
var DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];   // 上 右 下 左（与 doors 的顺序一致）

function key(x, y) { return x + ',' + y; }

function roomId(floor, x, y) { return 'r' + floor + '_' + x + '_' + y; }

function makeRoom(floor, x, y, type) {
  return {
    id: roomId(floor, x, y), x: x, y: y, type: type, depth: 0,
    doors: [0, 0, 0, 0], hiddenDoors: {}, clueSeed: 0, cleared: false, seen: false
  };
}

/** 一格能不能放房间：必须在网格内 */
function inGrid(x, y) { return x >= -Dungeon.GRID && x <= Dungeon.GRID && y >= -Dungeon.GRID && y <= Dungeon.GRID; }

/* =========================================================
   2c) 一局的特殊房分配（**每局**保证，而不是每层保证）
   ---------------------------------------------------------
   改造前：每层都恰好是 宝箱 / 商店 / 补给 / 事件 **各一间** ——
   于是三层下来是"3 宝箱 + 3 商店 + 3 补给 + 3 事件"，**每一层完全一样**。
   实测（tools/map-audit.mjs 的房型分布）：每项都是 1.00 件/层，方差几乎是 0。
   那意味着"这一层有商店吗"从来不是问题 —— 而它本来该是：
   钱要不要留到下一层、这一层的补给值不值得绕，都是被"楼主有什么"决定的。

   现在：一局的 12 张特殊房票（3 层 × 4 间）**从"每层各四类一间"的基准出发，
   再在层与层之间随机换几对票**（3~5 次交换）。
   这样做的两个好处都是可证的：
     · **总产出与改造前完全一样**（每一类在本局仍然是恰好 3 次，一次不多一次不少）——
       变的只是"分在哪几层"，所以经济曲线不会被这次改动偷偷抬高或压低；
     · 某一层可能出现 0 间商店、另一层出现 2 间宝箱（期望上约三成的层会缺某一类），
       于是"钱留不留到二层""这一层的补给值不值得绕"成了真问题。
   还保证了"四类在本局都出现过"—— 表里有、局里没有 = 死内容，这条底线不能破。

   为什么是纯函数 `(seed) → 三层各 4 张票`：地图必须能按（种子, 层号）单独重建
   （存档只存进度，见 rooms.mjs [10]），所以三层之间**不能有隐藏的顺序依赖**。
   ========================================================= */
Dungeon.RUN_SPECIALS = ['treasure', 'shop', 'camp', 'event'];
Dungeon.runPlan = function (seed) {
  var rnd = U.rng(U.seedFromStr('plan:' + (seed >>> 0)));
  var kinds = Dungeon.RUN_SPECIALS;
  var floors: string[][] = [];
  var i;
  for (i = 0; i < Dungeon.FLOORS; i++) floors.push(kinds.slice());   // 基准：每层各一间
  var swaps = 3 + Math.floor(rnd() * 3);                            // 3~5 对
  for (i = 0; i < swaps; i++) {
    var a = Math.floor(rnd() * floors.length);
    var b = Math.floor(rnd() * floors.length);
    if (a === b) continue;
    var ia = Math.floor(rnd() * floors[a].length);
    var ib = Math.floor(rnd() * floors[b].length);
    var tmp = floors[a][ia];
    floors[a][ia] = floors[b][ib];
    floors[b][ib] = tmp;
  }
  return floors;
};

/**
 * 生成一层。
 * @param seed  这一层的种子（由"本局种子 + 层号"派生，所以同种子必然同图）
 * @param floor 层号（1 起）
 */
Dungeon.genFloor = function (seed, floor) {
  var f = Math.max(1, Math.floor(Number(floor) || 1));
  var rnd = U.rng(U.seedFromStr('dungeon:' + (seed >>> 0) + ':' + f));
  var at: Record<string, DungeonRoom> = Object.create(null);
  var rooms: DungeonRoom[] = [];

  function add(x, y, type) {
    var r = makeRoom(f, x, y, type);
    at[key(x, y)] = r;
    rooms.push(r);
    return r;
  }
  function get(x, y) { return at[key(x, y)] || null; }
  function freeNeighbours(r) {
    var out = [];
    for (var d = 0; d < 4; d++) {
      var nx = r.x + DIRS[d][0], ny = r.y + DIRS[d][1];
      if (inGrid(nx, ny) && !get(nx, ny)) out.push(d);
    }
    return out;
  }
  function neighbourRooms(r) {
    var out = [];
    for (var d = 0; d < 4; d++) {
      var n = get(r.x + DIRS[d][0], r.y + DIRS[d][1]);
      if (n) out.push({ dir: d, room: n });
    }
    return out;
  }

  // 1) 随机生长。房间数随层数小幅上涨（越深越像迷宫）
  var target = 8 + Math.min(4, f);
  var start = add(0, 0, 'start');
  var guard = 0;
  while (rooms.length < target && guard++ < 4000) {
    var growable = rooms.filter(function (r) { return freeNeighbours(r).length > 0; });
    if (!growable.length) break;
    var pick = growable[Math.floor(rnd() * growable.length)];
    var dirs = freeNeighbours(pick);
    // 偏好"往空地多"的方向：让地图长成团，而不是一根面条
    dirs.sort(function (a, b) {
      var na = freeNeighbours({ x: pick.x + DIRS[a][0], y: pick.y + DIRS[a][1] }).length;
      var nb = freeNeighbours({ x: pick.x + DIRS[b][0], y: pick.y + DIRS[b][1] }).length;
      return nb - na;
    });
    var d2 = dirs[Math.min(dirs.length - 1, rnd() < 0.55 ? 0 : Math.floor(rnd() * dirs.length))];
    add(pick.x + DIRS[d2][0], pick.y + DIRS[d2][1], 'fight');
  }

  // 2) 深度（BFS 步数）
  var byId: Record<string, DungeonRoom> = Object.create(null);
  for (var i = 0; i < rooms.length; i++) { byId[rooms[i].id] = rooms[i]; rooms[i].depth = -1; }
  start.depth = 0;
  var queue = [start];
  while (queue.length) {
    var cur = queue.shift();
    var ns = neighbourRooms(cur);
    for (var n = 0; n < ns.length; n++) {
      if (ns[n].room.depth < 0) { ns[n].room.depth = cur.depth + 1; queue.push(ns[n].room); }
    }
  }
  /* 2b) **保证有足够的死路**。
     跑 900 层实测出来的两个坑：
       · 随机生长会长出"一团没有死路"的图（3×3 方块：中心 4 个邻居、角上 2 个），
         于是没有地方放 Boss 房 —— 那一层根本没有 Boss
       · 第一版补救是"从最深的房间一路往外接"，结果**把 7×7 网格填满**（49 间、零死路），
         因为每接一间就把那个死路吃掉了：净收益 0，只是把地图撑大了
     正确做法是**从分叉点长叶子**：给一个已经有 ≥2 个邻居（不是死路）的房间再接一间，
     净收益 +1 个死路。死路够了再顺手"加深"（Boss 离入口至少 2 步）。
     这一段现在会被调用**两次**（见下面 4) 之后那一次）：密室是在特殊房之后才凿的，
     而凿一间密室会把 2~4 个邻居从死路变成走廊 —— 实测把"≥5 个死路"这个意图
     悄悄吃掉了（720 层实测只剩 3.06 个），于是"可选的分支"也跟着变少。 */
  function deadEndsNow() {
    return rooms.filter(function (r) { return r !== start && neighbourRooms(r).length === 1; });
  }
  function topUpDeadEnds(want, budget, maxDepth?) {
    var addGuard = 0;
    while (deadEndsNow().length < want && addGuard++ < budget) {
      // 只有"**只贴着一间房**的空格"才算真叶子：贴两间的长出来就不是死路，
      // 净收益 0（这正是上一版把网格填满、死路却还是 0 的原因）。
      var leafSpots = [];
      for (var li = 0; li < rooms.length; li++) {
        var hr = rooms[li];
        if (neighbourRooms(hr).length < 2) continue;        // 从死路往外接 = 净收益 0，不干
        /* **不能接在密室后面**：密室的门全是暗门，接出来的叶子就只有一条"要破墙"的路 ——
           实测（900 层）抓到 3 层出现"不破墙走不到的普通房"。 */
        if (hr.type === 'secret') continue;
        if (maxDepth !== undefined && hr.depth + 1 > maxDepth) continue;
        var fd = freeNeighbours(hr);
        for (var fi = 0; fi < fd.length; fi++) {
          var tx = hr.x + DIRS[fd[fi]][0], ty = hr.y + DIRS[fd[fi]][1];
          var touch2 = 0;
          for (var td = 0; td < 4; td++) if (get(tx + DIRS[td][0], ty + DIRS[td][1])) touch2++;
          if (touch2 === 1) leafSpots.push({ host: hr, dir: fd[fi] });
        }
      }
      if (!leafSpots.length) break;                          // 没有可长的地方了
      leafSpots.sort(function (a, b) { return b.host.depth - a.host.depth; });
      var spot2 = leafSpots[0];
      var leaf = add(spot2.host.x + DIRS[spot2.dir][0], spot2.host.y + DIRS[spot2.dir][1], 'fight');
      leaf.depth = spot2.host.depth + 1;
    }
  }
  /** 这一层的种子驱动的洗牌（**必须传 rnd**：用 Math.random 会毁掉"同种子同地图"）。
      为什么不放 utils：`U.shuffle` 当年就是因为"默认 rnd 退化成 Math.random"被删掉的，
      这里只在生成器内部用一次，参数是显式的。 */
  function shuffle(list) {
    for (var i = list.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var tmp = list[i]; list[i] = list[j]; list[j] = tmp;
    }
    return list;
  }
  topUpDeadEnds(5, 16);
  // 2c) 加深：死路够了但都贴着入口时，从最深的房间再往外接一间
  var deepGuard = 0;
  while (deepGuard++ < 6) {
    var de = deadEndsNow();
    var deepest2 = de.length ? Math.max.apply(null, de.map(function (r) { return r.depth; })) : -1;
    if (deepest2 >= 2) break;
    var deep = rooms.filter(function (r) { return freeNeighbours(r).length > 0; })
      .sort(function (a, b) { return b.depth - a.depth; });
    if (!deep.length) break;
    var host3 = deep[0];
    var d3s = freeNeighbours(host3);
    var leaf2 = add(host3.x + DIRS[d3s[0]][0], host3.y + DIRS[d3s[0]][1], 'fight');
    leaf2.depth = host3.depth + 1;
  }

  // 3) 死路留给特殊房。Boss 放在**最深的死路**（保证越走越深）
  var deadEnds = deadEndsNow();
  deadEnds.sort(function (a, b) { return b.depth - a.depth; });
  var boss = deadEnds.length ? deadEnds[0] : null;
  /* 四间特殊房：宝箱 / 商店 / 营地 / **事件**。
     事件房必须真的会出现 —— 只在房型表里声明、生成器从不放它，
     就是"表里有、局里没有"的死内容（这正是 G2 第一版的实际状态，被 rooms.mjs 抓到）。

     **落点洗牌**（这一步改的）：以前是按固定顺序从"由深到浅排好的死路"里取 ——
     于是每一层都是 关底(最深) → 宝箱 → 商店 → 补给 → 事件，
     720 层实测的深度排名是 1.00 / 0.90 / 0.75 / 0.57 / 0.46，**每一层都一样**。
     那就等于地图没有路线选择：既然"越深越好"，**往最深的那一簇钻永远是最优解**
     （连"这一层该先走哪一支"都不用问）。洗牌之后，宝箱这次可能在浅的那一支、
     商店可能在最深的死路 —— "先走哪一支"才第一次变成一个真决定。
     用**这一层的种子**洗，所以"同种子同地图"这条承诺不受影响；
     Boss 的"最深"保持不变（它是结构："越走越深"说的是关底）。 */
  var used: Record<string, boolean> = Object.create(null);
  if (boss) { boss.type = 'boss'; used[boss.id] = true; }
  /* 这一层有哪四间特殊房：由**本局的分配表**给（见上面 runPlan）。
     兜底：万一表坏了（长度不对），退回"四类各一间"，绝不让这一层少给东西。 */
  var specials = (Dungeon.runPlan(seed)[f - 1] || []).slice();
  if (specials.length !== 4) specials = ['treasure', 'shop', 'camp', 'event'];
  /* 候选座位 = **最深的那些死路**（死路不够时用较深的普通房补）。
     注意这一步**不能**从"所有死路/所有普通房"里随机抽 —— 实测过一版：
     那样特殊房会落到浅处，于是"一路冲关底"顺手就能捡到（加权收获 3.09 → 4.89 件/层），
     绕路的压力反而没了。保留"深"这个梯度（深 = 要绕、也值得绕），
     只把**哪种房落在哪一支**洗掉 —— 这才是"每一层都要重新看一眼地图"的来源。 */
  var seatPool = deadEnds.filter(function (r) { return !used[r.id]; });
  if (seatPool.length < specials.length) {
    var spare = rooms.filter(function (r) {
      return !used[r.id] && r.type === 'fight' && seatPool.indexOf(r) < 0;
    }).sort(function (a, b) { return b.depth - a.depth; });
    seatPool = seatPool.concat(spare.slice(0, specials.length - seatPool.length));
  }
  var seats = shuffle(seatPool);
  for (var s = 0; s < specials.length && s < seats.length; s++) {
    seats[s].type = specials[s];
    used[seats[s].id] = true;
  }
  /* 剩下的死路里再按概率加几间精英房（死路 = 值得挑战的地方） */
  for (var dei = 0; dei < deadEnds.length; dei++) {
    if (!used[deadEnds[dei].id]) {
      if (rnd() < 0.45) { deadEnds[dei].type = 'elite'; used[deadEnds[dei].id] = true; }
    }
  }
  /* 精英房：**每层保证一间**（与限时房同一个理由：它是玩法，不是点缀）。
     为什么必须"保证"而不是"按概率"：上面那条按概率的循环实际上**几乎从不生效** ——
     死路的下限是 5 个，而 Boss + 宝箱 + 商店 + 补给 + 事件正好吃掉 5 个，
     剩下的死路常常一个不剩。于是"精英房"在房型表里躺了很久却几乎没有玩家见过它
     （rooms.mjs 的"表里有、局里没有"那一类）。
     挑一间普通战斗房改掉，优先深的 —— 和限时房错开（它也用同一批候选）。 */
  var elitePool = rooms.filter(function (r) { return !used[r.id] && r.type === 'fight'; })
    .sort(function (a, b) { return b.depth - a.depth; });
  if (elitePool.length) {
    var eliteHost = elitePool[Math.floor(rnd() * Math.min(2, elitePool.length))];
    eliteHost.type = 'elite';
    used[eliteHost.id] = true;
  }
  /* 限时房：**每层保证一间**，挑一间普通战斗房改掉（优先深的）。
     为什么用"保证一间"而不是"按概率"：限时房是一种**玩法**，
     概率会让某些层完全没有它 —— 那玩家就学不会"这一间要抢时间"。
     也不放在死路上：死路已经让给特殊房了。 */
  var rushPool = rooms.filter(function (r) { return !used[r.id] && r.type === 'fight'; })
    .sort(function (a, b) { return b.depth - a.depth; });
  if (rushPool.length) {
    var rushHost = rushPool[Math.floor(rnd() * Math.min(3, rushPool.length))];
    rushHost.type = 'rush';
    used[rushHost.id] = true;
  }

  // 4) 密室：与 2 个以上房间相邻的空格（以撒的秘密房规则）
  var secretSpots = [];
  for (var sx = -Dungeon.GRID; sx <= Dungeon.GRID; sx++) {
    for (var sy = -Dungeon.GRID; sy <= Dungeon.GRID; sy++) {
      if (get(sx, sy)) continue;
      var touch = 0;
      for (var d3 = 0; d3 < 4; d3++) if (get(sx + DIRS[d3][0], sy + DIRS[d3][1])) touch++;
      if (touch >= 2) secretSpots.push({ x: sx, y: sy, touch: touch });
    }
  }
  secretSpots.sort(function (a, b) { return b.touch - a.touch; });
  var secrets: string[] = [];
  var wantSecrets = 1 + (f >= 2 && rnd() < 0.45 ? 1 : 0);   // 一层 1 个；二层起有概率 2 个
  for (var ss = 0; ss < secretSpots.length && secrets.length < wantSecrets; ss++) {
    var spot = secretSpots[ss];
    var sec = add(spot.x, spot.y, 'secret');
    sec.seen = false;
    sec.clueSeed = 1 + Math.floor(rnd() * 1e9);
    secrets.push(sec.id);
    // 它到**每一个**邻居的门都是暗门（破哪一面都行，和以撒一样）
    var touchRooms = neighbourRooms(sec);
    for (var t = 0; t < touchRooms.length; t++) sec.hiddenDoors[touchRooms[t].room.id] = true;
  }
  /* 4b) 凿完密室再补一次死路：凿一间会把 2~4 个邻居从死路变成走廊，
     实测（720 层）把"≥5 个死路"这个意图吃成了 3.06 —— 而"可选的分支"正是死路。
     补出来的叶子是普通战斗房（特殊房已经放完了），它们就是**可以跳过**的那部分。
     深度**封在 Boss 那一层**：补死路是为了多几条可选支线，不是为了把关底变成中继站
     （"Boss 是最深的死路"这条不变式由 test/dungeon.mjs 守着）。 */
  topUpDeadEnds(5, 8, boss ? boss.depth : undefined);

  // 5) 门：相邻两间房各开一面（暗门照开，但"通行"要看 hiddenDoors）
  for (var r2 = 0; r2 < rooms.length; r2++) {
    var rr = rooms[r2];
    for (var d4 = 0; d4 < 4; d4++) {
      if (get(rr.x + DIRS[d4][0], rr.y + DIRS[d4][1])) rr.doors[d4] = 1;
    }
  }

  var out: DungeonFloor = {
    key: 'F' + f + '-' + (seed >>> 0),
    seed: seed >>> 0,
    floor: f,
    theme: themeFor(seed, f).id,
    rooms: rooms,
    start: start.id,
    boss: boss ? boss.id : start.id,
    secrets: secrets,
    count: rooms.length - secrets.length
  };
  return out;
};

/* =========================================================
   4. 查询（纯函数）
   ========================================================= */
Dungeon.roomById = function (fl, id) {
  if (!fl) return null;
  for (var i = 0; i < fl.rooms.length; i++) if (fl.rooms[i].id === id) return fl.rooms[i];
  return null;
};
Dungeon.at = function (fl, x, y) {
  if (!fl) return null;
  for (var i = 0; i < fl.rooms.length; i++) if (fl.rooms[i].x === x && fl.rooms[i].y === y) return fl.rooms[i];
  return null;
};
Dungeon.neighbours = function (fl, room) {
  var out = [];
  if (!fl || !room) return out;
  for (var d = 0; d < 4; d++) {
    var n = Dungeon.at(fl, room.x + DIRS[d][0], room.y + DIRS[d][1]);
    if (n) out.push(n);
  }
  return out;
};

/**
 * 这两间之间有没有通道。
 * @returns { door, hidden } —— `hidden` 为真时**门在数据上有、但不算通**（要破墙）
 */
Dungeon.link = function (fl, room, to) {
  if (!fl || !room || !to) return null;
  var dx = to.x - room.x, dy = to.y - room.y;
  var dir = -1;
  for (var d = 0; d < 4; d++) if (DIRS[d][0] === dx && DIRS[d][1] === dy) dir = d;
  if (dir < 0 || !room.doors[dir]) return null;
  var hidden = !!(room.hiddenDoors && room.hiddenDoors[to.id]) ||
    !!(to.hiddenDoors && to.hiddenDoors[room.id]);
  return { door: true, hidden: hidden };
};

/** 密室相邻的**可破墙**（破任何一面都行） */
Dungeon.breakables = function (fl, secretId) {
  var sec = Dungeon.roomById(fl, secretId);
  var out = [];
  if (!sec) return out;
  var ns = Dungeon.neighbours(fl, sec);
  for (var i = 0; i < ns.length; i++) out.push({ from: ns[i].id, to: sec.id });
  return out;
};

/* =========================================================
   4b) 门与墙的几何（**归一化** 0..1；乘 Arena.W/H 才是像素）
   ---------------------------------------------------------
   放在这里而不是 render/game 里：门的位置是"地图数据"的一部分
   （哪一面墙有门、哪一面墙是暗门），画的时候与走的时候必须是同一个数。
   归一化让 dungeon.ts 不需要认识 Arena（地图层不该知道战场多大）。
   ========================================================= */
var DOOR_FRAC = [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]];   // 上 右 下 左，与 DIRS/doors 同序

/** 这一面的开口中心（归一化坐标） */
Dungeon.doorFrac = function (dir) {
  var d = DOOR_FRAC[dir] || DOOR_FRAC[0];
  return { fx: d[0], fy: d[1] };
};
/** 开口的半宽（归一化，按战场短边算）与暗门墙的厚度 */
Dungeon.DOOR_HALF = 0.055;
Dungeon.WALL_HP = 34;

/**
 * 一面墙的唯一键（无向：A→B 与 B→A 是同一面墙）。
 *
 * **必须带层号**：房间 id 里已经带着层（`r2_1_1`），但那只说明"这是第 2 层的
 * 那间房"，读档时 `restoreFloor` 只重建**当前这一层**的地图 ——
 * 于是别的层的房间 id 查不到，那一层的破墙记录会被静默丢掉
 * （实测：三层跑到第 2 层读档，`walls` 从 2 条变 1 条）。带层号之后
 * 键自己就区分了层，读档只恢复对应层的那一份，其余原样留着。
 */
Dungeon.wallKey = function (fl, a, b) {
  var f = Math.max(1, Math.floor(Number(fl) || 1));
  return f + '|' + (a < b ? a + '|' + b : b + '|' + a);
};

/** 这一面墙破了吗？（破过 = 暗门可以通过）。`fl` = 哪一层 */
Dungeon.wallOpen = function (walls, fl, a, b) {
  return !!(walls && walls[Dungeon.wallKey(fl, a, b)]);
};

/**
 * 从 from 走到 to 的**最短路径**（房间 id 数组，含两端）。
 * 暗门默认**不算通路** —— 没破墙就走不到密室（这是"隐藏"的数据层定义）；
 * 传了 walls 之后，破过的那些暗门才算通。
 * @returns string[] 空数组 = 走不到
 */
Dungeon.path = function (fl, fromId, toId, walls) {
  if (!fl) return [];
  var from = Dungeon.roomById(fl, fromId), to = Dungeon.roomById(fl, toId);
  if (!from || !to) return [];
  if (from.id === to.id) return [from.id];
  var prev: Record<string, string> = Object.create(null);
  var seen: Record<string, boolean> = Object.create(null);
  seen[from.id] = true;
  var q = [from];
  while (q.length) {
    var cur = q.shift();
    var ns = Dungeon.neighbours(fl, cur);
    for (var i = 0; i < ns.length; i++) {
      var n = ns[i];
      if (seen[n.id]) continue;
      var lk = Dungeon.link(fl, cur, n);
      if (!lk || !lk.door) continue;
      if (lk.hidden && !Dungeon.wallOpen(walls, fl.floor, cur.id, n.id)) continue;
      seen[n.id] = true;
      prev[n.id] = cur.id;
      if (n.id === to.id) {
        var out2 = [n.id];
        var c = n.id;
        while (prev[c]) { c = prev[c]; out2.unshift(c); }
        return out2;
      }
      q.push(n);
    }
  }
  return [];
};

/* =========================================================
   4c) 修正折叠（纯函数）
   ========================================================= */
/** 这一层这一间房贡献的修正（恒等起算，缺房间/层时就是恒等） */
Dungeon.modsFor = function (fl, roomId) {
  var out: Record<string, number> = {};
  for (var k in MOD_BASE) out[k] = MOD_BASE[k];
  if (!fl) return out;
  var th = THEME_BY_ID[fl.theme];
  if (th) {
    applyMod(out, 'enemyHp', th.hpMul);
    applyMod(out, 'enemyDmg', th.dmgMul);
    applyMod(out, 'poolShift', th.poolShift);
  }
  var room = Dungeon.roomById(fl, roomId);
  if (room) {
    var t = TYPE_BY_ID[room.type];
    if (t) {
      applyMod(out, 'waveBudget', t.budgetMul);
      if (t.mods) for (var key in t.mods) applyMod(out, key, t.mods[key]);
    }
  }
  return out;
};

/**
 * 把"难度折叠结果"与"地牢折叠结果"合成一份 —— **开局/进房时算一次**，
 * 模拟里不回表（与 dmods/kmods/omods 同一套路）。
 * 只认 base 里已经有的键：地牢不能凭空往里塞键（塞了 buildWave 也读不到）。
 */
Dungeon.foldMods = function (base, fl, roomId) {
  var out: Record<string, any> = {};
  for (var k in base) out[k] = base[k];
  var rm = Dungeon.modsFor(fl, roomId);
  for (var key in rm) {
    if (!Object.prototype.hasOwnProperty.call(base, key)) continue;
    applyMod(out, key, rm[key]);
  }
  return out;
};

/** 给人看的一行：这一层的环境 */
Dungeon.themeLines = function (fl) {
  if (!fl) return [];
  var th = THEME_BY_ID[fl.theme];
  if (!th) return [];
  var out = ['第 ' + fl.floor + ' 层 · ' + th.name + '（第 ' + th.band + ' 带）—— ' + th.note];
  out.push('  敌人生命 ×' + th.hpMul.toFixed(2) + ' · 伤害 ×' + th.dmgMul.toFixed(2) +
    (th.poolShift ? ' · 怪物池前移 ' + th.poolShift : '') +
    ' · 这一带的环境有 ' + (THEME_BY_BAND[th.band] || []).length + ' 种（同种子同层必得同一种）');
  return out;
};

/** 给人看的一行：这是一间什么房 */
Dungeon.roomText = function (room) {
  if (!room) return '（没有房间）';
  var t = TYPE_BY_ID[room.type];
  if (!t) return room.id;
  return t.icon + ' ' + t.name + ' —— ' + t.note;
};

/** 小地图上应该画出来的房间（**只画见过的** —— 迷雾在模拟层这一处定义）。
 *
 *  改造前它返回**除密室以外的全部房间**：于是小地图从开局就是一张全图，
 *  地图实际退化成一个菜单（"去哪里"一眼就能算完，没有探索）。
 *  现在按 `seen` 过滤；而"见过"由 game.ts 的 `seeRoom` 给：
 *  进门 = 这一间 + **它的非密室邻房**（以撒那种"看见一格就看见下一格的门"）。
 *  密室照旧：`seen` 为假时谁也画不出来，发现（进门或打穿墙）之后才出现。 */
Dungeon.visible = function (fl) {
  var out = [];
  if (!fl) return out;
  for (var i = 0; i < fl.rooms.length; i++) {
    var r = fl.rooms[i];
    if (!r.seen) continue;
    out.push(r);
  }
  return out;
};

/** 一行行给人看（调试与界面共用）。
 *  **默认不泄露隐藏房** —— 这个函数会被界面复用，一不小心就把惊喜说出来了；
 *  要调试就看 `Dungeon.describe(fl, true)`。 */
Dungeon.describe = function (fl, reveal) {
  if (!fl) return '（没有地图）';
  var total = fl.count + (reveal ? fl.secrets.length : 0);
  var lines = ['第 ' + fl.floor + ' 层 · ' + THEME_BY_ID[fl.theme].name + ' · ' + total + ' 间' +
    (reveal && fl.secrets.length ? '（含 ' + fl.secrets.length + ' 间密室）' : '')];
  var vis = Dungeon.visible(fl).slice().sort(function (a, b) {
    return a.depth - b.depth || a.y - b.y || a.x - b.x;
  });
  for (var i = 0; i < vis.length; i++) {
    var r = vis[i];
    lines.push('  ' + TYPE_BY_ID[r.type].icon + ' ' + TYPE_BY_ID[r.type].name +
      '  (' + r.x + ',' + r.y + ')  深度 ' + r.depth + (r.cleared ? '  已清' : ''));
  }
  return lines.join('\n');
};

/* =========================================================
   5. 自检（跑很多种子 —— 地图生成是最容易"偶尔生出一张坏图"的地方）
   ========================================================= */
Dungeon.audit = function () {
  var problems = [];
  var ids: Record<string, boolean> = Object.create(null);
  for (var i = 0; i < TYPES.length; i++) {
    var t = TYPES[i];
    if (ids[t.id]) problems.push('房型 id 重复：' + t.id);
    ids[t.id] = true;
    if (!t.name || !t.icon || !t.note) problems.push(t.id + ' 缺名字/图标/说明');
    if (!(t.budgetMul >= 0)) problems.push(t.id + ' 的预算倍率不合法');
    // 房型自带的修正键必须是**声明过的**（否则界面上看不见、模拟里也读不到）
    if (t.mods) {
      for (var mk in t.mods) {
        if (!Object.prototype.hasOwnProperty.call(t.mods, mk)) continue;
        if (!MOD_KEYS[mk]) problems.push(t.id + ' 用了未声明的修正键：' + mk);
        if (!(typeof t.mods[mk] === 'number' && isFinite(t.mods[mk]))) {
          problems.push(t.id + ' 的 ' + mk + ' 不是合法数值');
        }
      }
    }
  }
  if (!TYPE_BY_ID.start || !TYPE_BY_ID.boss || !TYPE_BY_ID.secret) problems.push('缺少 start/boss/secret 房型');
  // 不刷怪的房型（budgetMul 0）不能同时带精英加成 —— 那是自相矛盾的表
  for (i = 0; i < TYPES.length; i++) {
    if (TYPES[i].budgetMul === 0 && TYPES[i].mods && TYPES[i].mods.eliteChance) {
      problems.push(TYPES[i].id + ' 不刷怪却带精英加成');
    }
  }
  // Boss 房必须**必然**出 Boss（否则"关底"可能是一间空房）
  var bossDef = TYPE_BY_ID.boss;
  if (bossDef && !(bossDef.mods && bossDef.mods.bossEvery === 1)) {
    problems.push('Boss 房没有保证出 Boss（mods.bossEvery 必须是 1）');
  }
  if (!MOD_KEYS.waveBudget || !MOD_KEYS.enemyHp) problems.push('缺少关键修正键声明');
  for (var bkey in MOD_BASE) {
    if (!MOD_KEYS[bkey]) problems.push('MOD_BASE 里的 ' + bkey + ' 没有声明（没人知道怎么折）');
  }
  if (Dungeon.WALL_HP <= 0) problems.push('暗门墙必须有血量（否则"打穿墙"不是个动作）');
  if (!(Dungeon.DOOR_HALF > 0 && Dungeon.DOOR_HALF < 0.5)) problems.push('门的半宽不合法');
  /* 环境表自检。它现在要回答四个问题（改造前只有"id 不重复 + 倍数为正"）：
       1. 配色齐不齐 —— 少一个色就是渲染层 undefined（画不出东西，且只有肉眼能发现）
       2. 每一带有没有环境 —— 空带 = 那一层抽不出东西 = 退回默认环境，玩家看不出来
       3. **带内均值 = 带心** —— 这是"抽签只改环境、不改难度"的**唯一**依据。
          没有这一条的话，往某一带里塞一个 hpMul 1.4 的环境就能偷偷把三层变难。
       4. 装饰物种类是声明过的 —— 声明了却没人画 = 它不存在
     还有一条跨带的：带越深必须越狠（改造前那条"越深越狠"不能因为抽签而失效）。 */
  var tids: Record<string, boolean> = Object.create(null);
  var propSeen: Record<string, boolean> = Object.create(null);
  for (var h = 0; h < THEMES.length; h++) {
    var th = THEMES[h];
    if (tids[th.id]) problems.push('主题 id 重复：' + th.id);
    tids[th.id] = true;
    if (!th.name || !th.note) problems.push(th.id + ' 缺名字/说明');
    if (th.hpMul <= 0 || th.dmgMul <= 0) problems.push(th.id + ' 的倍率必须是正数');
    if (!(th.band >= 1 && th.band <= BANDS && th.band === Math.floor(th.band))) {
      problems.push(th.id + ' 的 band 不合法：' + th.band);
    }
    if (PROP_KINDS.indexOf(th.prop) < 0) problems.push(th.id + ' 用了未声明的装饰物种类：' + th.prop);
    propSeen[th.prop] = true;
    var pal = th.pal;
    if (!pal) { problems.push(th.id + ' 没有配色'); continue; }
    if (!(pal.tones && pal.tones.length === 5)) problems.push(th.id + ' 的配色必须给 5 条纵向带');
    var keys = ['base', 'pebble', 'pebbleHi', 'rock', 'rockHi', 'rockDark', 'crack', 'propA', 'propB'];
    for (var pk = 0; pk < keys.length; pk++) {
      if (!/^#[0-9a-f]{6}$/i.test(String(pal[keys[pk]]))) {
        problems.push(th.id + ' 的配色 ' + keys[pk] + ' 不是 #rrggbb：' + pal[keys[pk]]);
      }
    }
    for (var tk = 0; tk < (pal.tones || []).length; tk++) {
      if (!/^#[0-9a-f]{6}$/i.test(String(pal.tones[tk]))) {
        problems.push(th.id + ' 的配色 tones[' + tk + '] 不是 #rrggbb：' + pal.tones[tk]);
      }
    }
  }
  for (var pki = 0; pki < PROP_KINDS.length; pki++) {
    if (!propSeen[PROP_KINDS[pki]]) problems.push('装饰物种类 ' + PROP_KINDS[pki] + ' 没有任何环境在用（死内容）');
  }
  // 每一带非空 + 带内均值 = 带心（难度没被抽签改动）+ 带越深越狠
  var prevHp = 0, prevDmg = 0, prevShift = -1;
  for (var b = 1; b <= BANDS; b++) {
    var list = THEME_BY_BAND[b] || [];
    if (!list.length) { problems.push('第 ' + b + ' 带没有环境（那一层抽不出东西）'); continue; }
    var c = BAND_CENTER[b];
    if (!c) { problems.push('第 ' + b + ' 带没有难度中心'); continue; }
    var sh = 0, sd = 0;
    for (var li = 0; li < list.length; li++) { sh += list[li].hpMul; sd += list[li].dmgMul; }
    var mh = sh / list.length, md = sd / list.length;
    if (Math.abs(mh - c.hp) > 0.02) {
      problems.push('第 ' + b + ' 带的生命均值 ' + mh.toFixed(3) + ' 偏离带心 ' + c.hp + '（抽签偷偷改了难度）');
    }
    if (Math.abs(md - c.dmg) > 0.02) {
      problems.push('第 ' + b + ' 带的伤害均值 ' + md.toFixed(3) + ' 偏离带心 ' + c.dmg + '（抽签偷偷改了难度）');
    }
    for (li = 0; li < list.length; li++) {
      if (list[li].poolShift !== c.shift) {
        problems.push(list[li].id + ' 的怪物池偏移 ' + list[li].poolShift + ' ≠ 本带中心 ' + c.shift);
      }
    }
    if (mh <= prevHp || md <= prevDmg || c.shift <= prevShift) {
      problems.push('第 ' + b + ' 带不比上一带更狠（越深越狠这条不能因为抽签失效）');
    }
    prevHp = mh; prevDmg = md; prevShift = c.shift;
  }
  if (THEMES.length < Dungeon.FLOORS + 1) {
    problems.push('主题数（' + THEMES.length + '）不够：至少要 FLOORS+1 个（含通关后的可选层）');
  }
  return { ok: problems.length === 0, problems: problems, counts: { types: TYPES.length, themes: THEMES.length, bands: BANDS } };
};

Dungeon.FLOORS = 3;
Dungeon.GRID = 3;
Dungeon.TYPES = TYPES;
Dungeon.TYPE_BY_ID = TYPE_BY_ID;
Dungeon.THEMES = THEMES;
Dungeon.THEME_BY_ID = THEME_BY_ID;
Dungeon.THEME_BY_BAND = THEME_BY_BAND;
Dungeon.BANDS = BANDS;
Dungeon.BAND_CENTER = BAND_CENTER;
Dungeon.PROP_KINDS = PROP_KINDS;
Dungeon.bandOf = bandOf;
Dungeon.themeFor = themeFor;
Dungeon.MOD_KEYS = MOD_KEYS;
Dungeon.MOD_BASE = MOD_BASE;
/** 四方向步长：[上, 右, 下, 左]，与 doors / doorFrac 同序（模拟层走门要用） */
Dungeon.DIRS = DIRS;
/** "关底"这个房型 id 的**唯一**出处（界面/S 层要判"这是不是关底"时读它，
    不许各处写 'boss' 字面量 —— 那样子改 id 会漏掉一半） */
Dungeon.BOSS_TYPE = 'boss';
Dungeon.START_TYPE = 'start';
Dungeon.SECRET_TYPE = 'secret';

SelfCheck.register('Dungeon', Dungeon.audit);

/* =========================================================
   6. 登记进扩展点总账
   ========================================================= */
Registry.family('roomType', {
  note: '地牢房间类型（含**隐藏房**）', owner: 'dungeon.ts',
  entries: function () {
    return TYPES.map(function (t) {
      var refs = [];
      // 主题给的是同类键，房型自带的修正键也要指到 roomMod 家族去查
      if (t.mods) for (var k in t.mods) refs.push({ field: 'mods.' + k, value: k, family: 'roomMod' });
      return { id: t.id, refs: refs };
    });
  }
});
Registry.family('floorTheme', {
  note: '楼层环境（难度带 + 这一局长什么样）', owner: 'dungeon.ts',
  values: function () { return THEMES.map(function (t) { return t.id; }); }
});
Registry.family('themeProp', {
  note: '环境装饰物种类（声明了却没人画 = 它不存在；render.ts 必须认得每一个）',
  owner: 'dungeon.ts',
  values: function () { return PROP_KINDS.slice(); }
});
Registry.family('roomMod', {
  note: '地牢给一波的修正键（与 danger.ts 同名；声明了却没人读 = 这条修正不存在）',
  owner: 'dungeon.ts',
  values: function () { return Object.keys(MOD_KEYS); }
});

export { Dungeon };
