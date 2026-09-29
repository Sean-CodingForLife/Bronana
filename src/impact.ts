/* =========================================================
   impact.ts — **打中之后的痕迹**：血迹贴花 + 屏幕抖动请求
   ---------------------------------------------------------
   这一块原先住在 `game.ts` 里。它的判据是"**它只做一件事**"：
   把"打中了/受伤了"变成地上一块痕迹，以及向渲染层要一次抖动。

   它与 `emit.ts` 的分工（两个名字容易混，所以写清楚）：
     · `emit.ts`   = **活的**表现（粒子、飘字、枪口火光、爆炸）——
       有生命周期、要回收、进行为指纹，所以它自己有一张池化表。
     · 本模块     = **留在地上的**痕迹（贴花）与**一个数字**（抖动强度）。
       贴花没有生命周期（环形缓冲，满了覆盖最旧的），抖动交给渲染层去解释。

   ⚠ **`addStain` 会消费 `S.rnd()`**（血迹形状在生成时随机一次）。
   所以它不是"纯表现"：动这里的随机次数会挪动主随机流、改变行为指纹。
   这一点写在 `fingerprint.mjs` 的纪律里，也写在下面的注释里 ——
   因为在 `render.ts` 里改颜色是安全的，在这里改随机次数不是。
   ========================================================= */
import { Comp } from './comp.ts';
import { U } from './utils.ts';

/** `game.ts` 注入的能力（本模块不认识 `Game`） */
export interface ImpactCtx {
  /** 当前会话（**每次调用现取**：换局之后对象就换了） */
  session(): Session;
  /** 贴花总数的上限（住 `Game.cfg.decalCap` —— 配置在模拟层的门口，不在这里写死） */
  decalCap(): number;
  /** 向渲染层请求一次屏幕抖动（模拟层只声明"冲击多大"，不解释怎么抖） */
  onShake(amount: number): void;
}

export function makeImpact(ctx: ImpactCtx) {
  var Imp = {} as ImpactApi;

  /**
   * 留一块血迹（**环形缓冲**）。
   *
   * 旧实现是 `if (S.decals.length < 90) push(...)` —— 满了就**永久**停止添加。
   * 实测一波 391 次击杀里 **77% 完全没有血迹**，而且三个圆的偏移写死，
   * 每个血迹形状一模一样（`seq` 存了却从没被用过）。
   * 现在：满了覆盖最旧的一个 → 每一次击杀都留痕，血迹永远反映**最近的**战斗；
   * 形状在生成时随机一次（角度/距离/半径系数），渲染时零计算。
   *
   * 环形缓冲的游标是 `S.decalCursor`，上限是 `Game.cfg.decalCap` ——
   * 两者必须一致，否则"表满了"与"游标越界"会同时发生（覆盖到别的玩家的血迹上）。
   */
  Imp.addStain = function (x, y, r, color) {
    var S = ctx.session();
    if (!S) return null;
    var cap = ctx.decalCap();
    var d;
    if (S.decals.length < cap) {
      d = Comp.spawn('decal');
      S.decals.push(d);
    } else {
      d = S.decals[S.decalCursor];
      S.decalCursor++;
      if (S.decalCursor >= cap) S.decalCursor = 0;
    }
    d.x = x; d.y = y; d.r = r; d.color = color;
    /* `seq` 单调递增：渲染层据此判断"这块是新的还是旧的"（新旧血迹浓度不同）。
       用数组下标做不到这件事 —— 环形缓冲里同一个下标会对应很多块不同的痕迹。 */
    d.seq = ++S.decalSeq;
    /* ⚠ 这六行**消耗主随机流**（6 次 `S.rnd()`）。它可以改，但改了就必须
       重设行为指纹基线 —— 与 `emit.ts` 里那些"配方消费 rnd"的地方同一条纪律。 */
    var rnd = S.rnd;
    d.a1 = rnd() * U.TAU;
    d.a2 = rnd() * U.TAU;
    d.d1 = 0.42 + rnd() * 0.42;
    d.d2 = 0.42 + rnd() * 0.52;
    d.s1 = 0.44 + rnd() * 0.30;
    d.s2 = 0.24 + rnd() * 0.26;
    return d;
  };

  /**
   * 命中溅血：**受预算限制**，超预算就跳过（击杀那一刀不受限）。
   *
   * 为什么要有预算：命中每秒可以上百次，每次都留一块血迹会把地面铺满 ——
   * 而铺满之后画面反而"没有血迹"，因为满地都是。
   * 预算由 `S.stainBudget` 每秒回满（在 `step` 里），所以它表达的是
   * "这一秒最多能溅几块"，而不是"这一局最多几块"（后者就是旧实现的 bug）。
   */
  Imp.tryHitStain = function (e) {
    var S = ctx.session();
    if (!S || !e) return null;
    if (S.stainBudget < 1) return null;
    /* 0.3：三次命中里大约一次留痕。**这个数也是主随机流上的一次消耗**，
       所以它属于"改了就动指纹"的那一类常量。 */
    if (S.rnd() > 0.3) return null;
    S.stainBudget -= 1;
    return Imp.addStain(e.x + (S.rnd() - 0.5) * e.r, e.y + e.r * 0.25,
      e.r * (0.22 + S.rnd() * 0.16), e.def.dark);
  };

  /**
   * 请求屏幕抖动：模拟层只声明"冲击有多大"（0~1），
   * 具体怎么抖、抖多久由 `render.ts` 决定 —— 模拟层不依赖任何渲染实现。
   */
  Imp.requestShake = function (amount) { ctx.onShake(amount); };

  return Imp;
}
