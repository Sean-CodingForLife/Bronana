/* =========================================================
   chamber.ts — **房间层**：地图状态 / 迷雾 / 门 / 暗门墙
   ---------------------------------------------------------
   这一块原先住在 `game.ts` 里。拆出来的判据是"**它管什么**"能一句话说清：

     · **当前在哪**：`S.floor` / `S.roomId` 以及由它查出来的那一间（`currentRoom`）
     · **看见了什么**：迷雾（`seeRoom`）——"进门 = 这一间看见，它的非密室邻房也看见"
     · **门**：门在战场上的像素位置（`doorPoint`）、贴着哪一扇（`doorNearby`）
     · **暗门墙**：当前间里还没打穿的那几面（`recalcWalls` / `hitWalls` / `breakWall`）
     · **翻层**：生成新一层并落到入口（`enterFloor`）
     · **深度回报**：`depthBonus` / `floorMeanDepth`（"绕进去清干净"的第二个理由）

   它**不认识**武器、伤害公式、波次、渲染 —— 这些仍然在 `game.ts` 里。
   与 `dungeon.ts` 的分工要写清楚，否则这两个名字会互相长进去：
     · `dungeon.ts` = **一层怎么长出来**（纯函数 `(种子, 层号) → 楼层图`），
       以及房间图的拓扑查询（邻居 / 连线 / 门的位置比例 / 墙的键）。
       它**不读会话**，同样一个种子永远长出同样一张图。
     · 本模块 = **玩家在这一层里走到哪了**（会话语义）。
       它读 `S`、写 `S.roomId` / `S.walls` / 房间的 `seen` 位。

   **为什么用 `make(ctx)` 而不是直接 import `game.ts` 的 `S` 与 `Game`**：
   反过来依赖会让分层表把这条边算成"房间层依赖模拟内核"，而它其实只依赖
   **会话数据**与两个回调（破墙特效、破墙音效）。注入之后依赖是单向的
   （`game.ts` → `chamber.ts`），本模块也不认识 `Game` / `sfx` / `Emit` 这些名字。
   ⚠ `session()` 是**函数**而不是对象快照：换局之后 `S` 会被整体替换。
   ========================================================= */
import { Arena } from './arena.ts';
import { Col } from './collide.ts';
import { Dungeon } from './dungeon.ts';
import { U } from './utils.ts';

/** `game.ts` 注入的能力（本模块不认识 `Game` / `Emit` / `sfx`） */
export interface ChamberCtx {
  /** 当前会话（**每次调用现取**：换局之后对象就换了） */
  session(): Session;
  /** 破墙的尘土（表现层的事，模拟层只声明"哪面墙破了"） */
  wallBreakFx(x: number, y: number): void;
  /** 破墙的声音（同一件事的另一半表现） */
  wallBreakSfx(): void;
  /** 破墙 / 翻层的事件（界面与统计据此更新） */
  onWallBreak(from: string, to: string, secret: boolean): void;
  onFloorEnter(floor: number, theme: string, name: string): void;
}

export function makeChamber(ctx: ChamberCtx) {
  var Ch = {} as ChamberApi;

  /* =========================================================
     1. 当前房与几何
     ========================================================= */

  /** 当前这一间（没有会话 / 没有地图时 null —— 调用点普遍靠它做守卫） */
  Ch.currentRoom = function () {
    var S = ctx.session();
    if (!S || !S.map) return null;
    return Dungeon.roomById(S.map, S.roomId);
  };

  /** 门在战场上的像素位置（归一化几何 × 战场尺寸，并夹进内边距内） */
  Ch.doorPoint = function (dir) {
    var f = Dungeon.doorFrac(dir);
    return {
      x: U.clamp(f.fx * Arena.W, Arena.PAD, Arena.W - Arena.PAD),
      y: U.clamp(f.fy * Arena.H, Arena.PAD, Arena.H - Arena.PAD)
    };
  };

  /** a → b 是哪一面（没有相邻就 -1）。**用于把"邻居"翻译成"门在哪个方向"** */
  Ch.dirTo = function (a, b) {
    var D = Dungeon.DIRS;
    for (var d = 0; d < 4; d++) if (b.x === a.x + D[d][0] && b.y === a.y + D[d][1]) return d;
    return -1;
  };

  /** 四个方向里某一方向上的邻房（没有就 null） */
  Ch.roomAtDir = function (cur, d) {
    var S = ctx.session();
    if (!cur || !S || !S.map) return null;
    var D = Dungeon.DIRS;
    var dd = D[d];
    if (!dd) return null;
    return Dungeon.at(S.map, cur.x + dd[0], cur.y + dd[1]);
  };

  /* =========================================================
     2. 迷雾（"看见"的唯一入口）
     ========================================================= */

  /**
   * 发现一间房。
   *
   * **迷雾的定义在这里**（`Dungeon.visible` 只画 `seen` 的房间）：
   * 进门 = 这一间看见，**它的非密室邻房也一并看见** —— 于是小地图是
   * "见过的 + 紧挨着的一圈"，玩家仍然能规划下一步（门牌上也写着邻房是什么），
   * 但看不到远处那一层有什么。密室**不参与**这一圈：看见它等于泄露隐藏要素。
   *
   * "被发现"的入口只有两个：进门、打穿它的墙（`breakWall` 里调它）。
   * 两个入口都走这里，所以"怎么来的"不会影响迷雾。
   */
  Ch.seeRoom = function (id) {
    var S = ctx.session();
    if (!S || !S.map) return null;
    var r = Dungeon.roomById(S.map, id);
    if (!r) return null;
    r.seen = true;
    var ns = Dungeon.neighbours(S.map, r);
    for (var i = 0; i < ns.length; i++) {
      if (ns[i].type === Dungeon.SECRET_TYPE) continue;
      ns[i].seen = true;
    }
    return r;
  };

  /* =========================================================
     3. 门：贴着就换房（以撒那一套）
     ========================================================= */

  /**
   * 玩家贴着哪一扇门？只在这一间**清干净之后**才判定：战斗中门是锁着的。
   * @returns 方向 0..3，或 -1
   *
   * 暗门不算"门"：它是墙，要先打穿（`Dungeon.wallOpen`）。
   * 这一条以前漏过 —— 没打穿的暗门也能穿过去，密室就不再是"藏起来的"。
   */
  Ch.doorNearby = function () {
    var S = ctx.session();
    var cur = Ch.currentRoom();
    if (!cur || !cur.cleared || !S) return -1;
    var p = S.player;
    var half = Dungeon.DOOR_HALF * Math.min(Arena.W, Arena.H);
    var reach = p.r + 18;
    for (var d = 0; d < 4; d++) {
      if (!cur.doors[d]) continue;
      var pt = Ch.doorPoint(d);
      /* 门是**开口**而不是点：南北两面看 y、东西两面看 x。
         用"轴对齐的矩形判定"而不是圆形 —— 玩家从门中间挤过去的手感靠它。 */
      var near = (d === 0 || d === 2)
        ? Math.abs(p.x - pt.x) <= half && Math.abs(p.y - pt.y) <= reach
        : Math.abs(p.y - pt.y) <= half && Math.abs(p.x - pt.x) <= reach;
      if (!near) continue;
      var to = Ch.roomAtDir(cur, d);
      if (!to) continue;
      var lk = Dungeon.link(S.map, cur, to);
      if (!lk || !lk.door) continue;
      if (lk.hidden && !Dungeon.wallOpen(S.walls, S.floor, cur.id, to.id)) continue;   // 暗门要先打穿
      return d;
    }
    return -1;
  };


  /* =========================================================
     4. 暗门墙
     ========================================================= */

  /**
   * 当前房间里"还没打穿的暗门墙"。
   * 只在**进房 / 破墙**时重算一次：模拟里每帧检查的是这一小份（最多 4 面）。
   * 这一条很重要 —— 每帧去问 `Dungeon.neighbours + link` 是每帧几次分配，
   * 而它只在两件事发生时才会变。
   */
  Ch.recalcWalls = function () {
    var S = ctx.session();
    if (!S) return;
    S.wallsNow.length = 0;
    var cur = Ch.currentRoom();
    if (!cur) return;
    var ns = Dungeon.neighbours(S.map, cur);
    for (var i = 0; i < ns.length; i++) {
      var n = ns[i];
      var lk = Dungeon.link(S.map, cur, n);
      if (!lk || !lk.door || !lk.hidden) continue;
      if (Dungeon.wallOpen(S.walls, S.floor, cur.id, n.id)) continue;
      var dir = Ch.dirTo(cur, n);
      if (dir < 0) continue;
      var pt = Ch.doorPoint(dir);
      S.wallsNow.push({
        from: cur.id, to: n.id, dir: dir, x: pt.x, y: pt.y,
        hp: Dungeon.WALL_HP, maxHp: Dungeon.WALL_HP
      });
    }
  };

  /**
   * 打墙：子弹/近战/爆炸都能打。打穿了就**发现**那间密室（它在小地图上才出现）。
   * @returns 是否打到了墙（打到了的子弹不再穿透）
   */
  Ch.hitWalls = function (x0, y0, x1, y1, r, dmg) {
    var S = ctx.session();
    if (!S || !S.wallsNow.length || !(dmg > 0)) return false;
    var half = Dungeon.DOOR_HALF * Math.min(Arena.W, Arena.H);
    for (var i = 0; i < S.wallsNow.length; i++) {
      var wall = S.wallsNow[i];
      /* 复用 `Col.segCircle`（**唯一实现**）。
         一开始这里手写了一份"线段 ∩ 圆"的等价物，那正是要被消灭的东西：
         两处实现只要有一处算错半径，"打得到"和"看起来打得到"就分叉，
         而分叉只表现为"有时候明明打中了却没反应"。 */
      var t = Col.segCircle(x0, y0, x1, y1, wall.x, wall.y, r + half);
      if (t < 0) continue;
      wall.hp -= dmg;
      wall.flash = 0.12;              // 渲染层据此画"刚被打中"的一下
      if (wall.hp <= 0) Ch.breakWall(wall.from, wall.to, wall.x, wall.y);
      else ctx.wallBreakFx(x1, y1);
      return true;
    }
    return false;
  };

  /** 打穿一面墙（内部动作：子弹/近战打中触发，所以**不**单独录制） */
  Ch.breakWall = function (from, to, x, y) {
    var S = ctx.session();
    if (!S) return false;
    var already = Dungeon.wallOpen(S.walls, S.floor, from, to);
    S.walls[Dungeon.wallKey(S.floor, from, to)] = true;
    Ch.seeRoom(to);                 // 打穿 = 发现（密室这时才出现在小地图上）
    Ch.recalcWalls();
    var sec = Dungeon.roomById(S.map, to);
    var isSecret = !!(sec && sec.type === 'secret');
    if (!already) {
      if (x !== undefined) ctx.wallBreakFx(x, y);
      ctx.wallBreakSfx();
    }
    ctx.onWallBreak(from, to, isSecret);
    return true;
  };

  /* =========================================================
     5. 翻层与深度回报
     ========================================================= */

  /** 生成一层并落到入口房（存档只存进度，地图**每次由种子重新长**） */
  Ch.enterFloor = function (f, opt?) {
    var S = ctx.session();
    opt = opt || {};
    S.floor = Math.max(1, Math.min(Dungeon.FLOORS, Math.floor(Number(f) || 1)));
    S.map = Dungeon.genFloor(S.seed, S.floor);
    S.roomId = S.map.start;
    Ch.seeRoom(S.roomId);           // 入口 + 它那一圈（迷雾的第一个圈）
    Ch.recalcWalls();
    if (!opt.silent) {
      var theme = Dungeon.THEME_BY_ID[S.map.theme];
      ctx.onFloorEnter(S.floor, S.map.theme, theme ? theme.name : '');
    }
  };

  Ch.floorMeanDepth = function () {
    var S = ctx.session();
    if (!S || !S.map || !S.map.rooms.length) return 0;
    var sum = 0;
    for (var i = 0; i < S.map.rooms.length; i++) sum += Math.max(0, S.map.rooms[i].depth || 0);
    return sum / S.map.rooms.length;
  };

  /**
   * 深度的回报：越深的层，**每次收集拿得越多**（浅层 ×1 → 深井 ×2 上下）。
   *
   * 为什么它必须存在：能不能翻层是**玩家自己选时机**的 —— 打 Boss 就结束这一层，
   * 没打的房间连同它们的东西全丢。可如果"走光这一层"永远最优，那个"时机"就
   * 不是选择，只是顺序（清光 → 关底 → 下一层，唯一解）。
   * 有了它，两条路各自成立：
   *   · 走光这一层 = 次数多（每一间都是一次收集 + 一次买卖 + 一个制造回合）
   *   · 早打关底   = 单次更肥（更高的层倍率叠在后面的每一间上）
   *
   * 用的是**已有的东西**，一个新元素都没有：
   *   · 层号（已有）
   *   · 层主题的 `hpMul`（已有，它本来就写着"敌人更硬"；难点就该更肥 ——
   *     主题的文案一直这么写，只是数值上没兑现）
   *   · `S.bonusMul`（已有的"这一间的奖励倍率"，事件房也用它）
   *
   * **一层之内也有深浅**：房间的 `depth`（离入口几步）以前只用来排序，
   * 不进任何收益公式 —— 于是"往深走"只有"那里放了特殊房"这一个理由。
   *
   * 关键取舍：这一项**以本层的平均深度为基准**（`rel = depth − 平均`），
   * 不是"每深一步 +7%"。后者是一份**全局通胀**（每间房平均 +20% 废料），
   * 而用户那一轮的抱怨恰好包含"成型过快" —— 加通胀会让它更快。
   * 以均值为基准之后：浅房略少、深房略多，**整层总量不变**；
   * 于是"一路冲关底"（跳过深处的支线）真的会少拿，而"绕进去清干净"才吃到加成。
   * 入口（depth 0）在浅层是略负的 —— 但入口不刷怪、不发波次奖励，实际无影响。
   */
  Ch.depthBonus = function (floor, depth) {
    var S = ctx.session();
    var t = S && S.map ? Dungeon.THEME_BY_ID[S.map.theme] : null;
    var hard = t && t.hpMul ? t.hpMul : 1;
    var f = Math.max(1, Math.floor(Number(floor) || 1));
    var d = Math.max(0, Math.floor(Number(depth) || 0));
    var rel = d - Ch.floorMeanDepth();
    var mul = (1 + (f - 1) * 0.30 + rel * 0.10) * hard;
    /* `U.round2` 而不是 `Math.round(mul * 100) / 100`：这两个是同一件事，
       而这个倍率会**出现在界面上**（"这一间 ×1.35"），所以它必须与
       别处显示的小数走同一个舍入 —— 两处各写一遍就会慢慢漂开。 */
    return Math.max(0.5, U.round2(mul));
  };

  return Ch;
}
