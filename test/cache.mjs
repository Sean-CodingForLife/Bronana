/* =========================================================
   cache.mjs — 缓存机制无头校验
   游戏里"生成一次、之后复用"的东西有四类，这里逐类守住它们的契约：
     1) 离屏贴图缓存（sprites.ts）：怪物 / 掉落 / 肖像 / 道具图标 / 白闪剪影
     2) 静态层烘焙（render.ts）：地面、岩石白骨 —— 每帧 900 次绘制压成 1 次 blit
     3) 每实例记忆：怪身上的 `_spr` / `_fl`，以及 HUD 的"上次写过的值"
     4) 复用缓冲：粒子自由链表、子弹候选数组（只验证"不随帧数增长"）

   本套测试要回答的是缓存最容易出事的三件事：
     · 会不会命中（不命中就是每帧重画，白写）
     · 会不会失控（条目 / 字节数随运行时间增长）
     · 倍率会不会被算错（画布是设备分辨率，绘制必须按逻辑尺寸）
   用法： node test/cache.mjs
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { installDom, makeProbeCtx, makeCanvas } from './_ctx.mjs';
import { loadAll, RENDER_MODULES } from './_load.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
let failures = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  \x1b[32mPASS\x1b[0m ' + label);
  else { failures++; console.log('  \x1b[31mFAIL\x1b[0m ' + label + (extra !== undefined ? '  → ' + extra : '')); }
}
function mb(bytes) { return (bytes / 1048576).toFixed(2) + 'MB'; }

const dom = installDom();
installDom();                       // window/document 桩必须在 loadAll 之前
const g = globalThis;

console.log('\n=== Bronana · 缓存机制无头校验 ===\n');
console.log('[1] 加载');
let loadErr = null;
try { await loadAll(RENDER_MODULES); } catch (e) { loadErr = e.message; }
if (loadErr) { console.log('  \x1b[31mFAIL\x1b[0m 加载失败 → ' + loadErr); process.exit(1); }
ok(true, '渲染层以 ES 模块方式加载成功');

const { S, R, Game, Arena, Enemies, D, Dungeon } = g;
const FIXED = Game.cfg.fixedDt;

/* =========================================================
   2. 无 DOM 环境：缓存必须"返回 null"而不是抛错
   ========================================================= */
console.log('\n[2] 无 DOM 环境的降级');
{
  const savedDoc = g.document;
  const def = Enemies.LIST[0];
  let err = null, spr = 'x', domCv = 'x';
  try {
    delete g.document;
    spr = S.enemySprite(def);
    domCv = S.domCanvas(40, 40);
  } catch (e) { err = e.message; }
  g.document = savedDoc;
  ok(!err, '没有 document 时贴图相关调用不抛异常', err);
  ok(spr === null, '无 DOM：怪物贴图返回 null（调用方走降级绘制）', String(spr));
  ok(domCv === null, '无 DOM：domCanvas 返回 null', String(domCv));
  ok(S.cacheStats().entries === 0, '无 DOM：一条缓存都没留下', S.cacheStats().entries);
}

/* =========================================================
   3. 命中：同参数第二次必须拿到同一个对象
   ========================================================= */
console.log('\n[3] 贴图缓存：命中与键空间');
let def0 = null, spr1 = null, spriteBytes1 = 0;
{
  def0 = Enemies.LIST[0];
  spr1 = S.enemySprite(def0);
  const spr2 = S.enemySprite(def0);
  ok(!!spr1, '怪物贴图能生成', def0.id);
  ok(spr1 === spr2, '同参数第二次调用返回**同一个**贴图对象（真的命中了）');
  ok(spr1.canvas.width === spr1.width && spr1.canvas.height === spr1.height,
    '倍率 1 时画布尺寸 = 逻辑尺寸', spr1.canvas.width + ' vs ' + spr1.width);

  const keysBefore = S.cacheStats().entries;
  S.enemySprite(def0);
  S.enemySprite(def0);
  ok(S.cacheStats().entries === keysBefore, '重复取用不增加条目（键是按原型算的）');
  ok(S.cacheStats().list.some(e => e.key === 'en-' + def0.id + '-' + (26 * (def0.scale || 1)).toFixed(1)),
    '键里带原型 id 与尺寸（不同尺寸的怪不会互相顶掉）');

  const icon = S.itemIcon('bottle', '#c98a55', 58);
  const icon2 = S.itemIcon('bottle', '#c98a55', 58);
  const iconBig = S.itemIcon('bottle', '#c98a55', 72);
  ok(icon === icon2 && icon !== iconBig, '图标按（图案 + 颜色 + 尺寸）分键');

  const pk = S.pickupSprite('mat');
  ok(!!pk && pk.width === 30 && pk.height === 30, '掉落贴图是 30×30 的逻辑尺寸');

  spriteBytes1 = S.cacheStats().bytes;
  console.log('    · 当前 ' + S.cacheStats().entries + ' 条贴图 · ' + mb(spriteBytes1) +
    ' · 倍率 ' + S.scale());
}

/* =========================================================
   4. 倍率：画布 = 逻辑 × 倍率，逻辑尺寸不变
   ========================================================= */
console.log('\n[4] 烘焙倍率（设备像素比）');
{
  ok(S.setScale(1) === false, '倍率没变时返回 false（不做无谓的整表作废）');
  ok(S.setScale(2) === true, '倍率变化返回 true');
  ok(S.cacheStats().entries === 0, '换倍率会把旧贴图全部作废（它们是按旧倍率烘焙的）');

  const spr = S.enemySprite(def0);
  ok(spr !== spr1, '重建后是新的贴图对象');
  ok(spr.width === spr1.width && spr.height === spr1.height,
    '逻辑尺寸不随倍率变化（渲染层照旧按逻辑尺寸画，位置不会跳）',
    spr.width + ' vs ' + spr1.width);
  ok(spr.canvas.width === Math.ceil(spr.width * 2), '画布宽 = 逻辑宽 × 2',
    spr.canvas.width + ' vs ' + spr.width);
  ok(spr.canvas.height === Math.ceil(spr.height * 2), '画布高 = 逻辑高 × 2',
    spr.canvas.height + ' vs ' + spr.height);

  ok(S.setScale(3) === false, '倍率被夹到上限 2（2 已经等于上限，故无变化）');
  ok(S.scale() === 2, '当前倍率是 2', S.scale());
  ok(S.setScale(0) === true && S.scale() === 1, '非法倍率（0）退回 1');
  ok(S.setScale(NaN) === false && S.scale() === 1, 'NaN 不改变现状（已夹到 1）');

  // 白闪剪影：逻辑尺寸必须与本体一致，否则白闪会"放大一圈"
  S.setScale(2);
  const body = S.enemySprite(def0);
  const flash = S.enemyFlash(def0);
  ok(flash.width === body.width && flash.height === body.height,
    '白闪剪影的逻辑尺寸与本体一致', flash.width + ' / ' + body.width);
  ok(flash.canvas.width === body.canvas.width, '白闪剪影的画布分辨率与本体一致');
}

/* =========================================================
   5. 绘制必须按"逻辑尺寸"贴，而不是画布的设备尺寸
   —— 这是倍率改造最容易错的地方：忘了传尺寸就会放大 2 倍
   ========================================================= */
console.log('\n[5] 贴图绘制：逻辑尺寸 vs 设备尺寸');
{
  const ctx = makeProbeCtx();
  const def = def0;
  const e = {
    def: def, x: 100, y: 200, phase: 0.3, hitFlash: 0, elite: false,
    r: 26 * (def.scale || 1), _spr: null, _fl: null
  };
  S.drawEnemy(ctx, e, 0.5, 0, 0);
  const hit = ctx.images[0];
  ok(!!hit && hit.w === e._spr.width && hit.h === e._spr.height,
    '怪物按逻辑尺寸贴（不是画布的设备尺寸）',
    hit && (hit.w + '×' + hit.h + ' vs 逻辑 ' + e._spr.width + ' / 画布 ' + e._spr.canvas.width));
  ok(!!hit && hit.w < e._spr.canvas.width, '逻辑尺寸小于设备尺寸（倍率确实生效了）',
    hit && String(hit.w));

  // 白闪：叠一层同尺寸的剪影
  e.hitFlash = 0.5;
  const ctx2 = makeProbeCtx();
  S.drawEnemy(ctx2, e, 0.5, 0, 0);
  ok(ctx2.images.length === 2 && ctx2.images[1].w === e._spr.width,
    '受击白闪按同一逻辑尺寸叠加', ctx2.images.length + ' 次 drawImage');

  const ctx3 = makeProbeCtx();
  S.drawPickup(ctx3, { kind: 'mat', x: 10, y: 10, seed: 1, bob: 0 }, 0.2);
  ok(ctx3.images[0] && ctx3.images[0].w === 30 && ctx3.images[0].h === 30,
    '掉落按 30×30 逻辑尺寸贴', ctx3.images[0] && String(ctx3.images[0].w));

  // 每实例记忆必须跟着倍率走，否则换屏幕后手上的还是旧贴图
  const held = e._spr;
  S.setScale(1);
  const ctx4 = makeProbeCtx();
  S.drawEnemy(ctx4, e, 0.5, 0, 0);
  ok(e._spr !== held && e._spr.scale === 1, '换倍率后每实例的贴图记忆被刷新',
    'scale ' + e._spr.scale);
  ok(ctx4.images[0].w === e._spr.width, '刷新后仍然按逻辑尺寸贴');
}

/* =========================================================
   6. 静态层烘焙：命中 / 换波 / 显式作废 / 倍率
   ========================================================= */
console.log('\n[6] 静态层（地面 + 岩石白骨）烘焙');
{
  // R.init 需要一块主画布；重复 init 会重复注册 shake 监听，所以只做一次
  const mainCanvas = makeCanvas(1280, 720);
  R.init(mainCanvas);
  g.devicePixelRatio = 1;
  R.resize();

  Game.newRun('gladiator', 4242);
  const sess = Game.getSession();
  R.draw(FIXED);
  const g1 = R.ground.canvas, p1 = R.props.canvas;
  ok(!!g1 && !!p1, '首帧把地面与道具层烘焙出来了');

  R.draw(FIXED);
  ok(R.ground.canvas === g1 && R.props.canvas === p1,
    '第二帧命中缓存（不再重建画布）');
  ok(R.ground.wave === sess.arena.wave, '烘焙键是战场波次', String(R.ground.wave));

  // 换波 → 战场重建 → 必须重新烘焙
  const a2 = Arena.build(sess.arena.wave + 1);
  sess.arena = a2;
  R.draw(FIXED);
  ok(R.ground.canvas !== g1 && R.ground.wave === a2.wave,
    '换波后重新烘焙（键变了）');

  /* **同一波次、换环境** —— 这一条是这一轮新加的，因为缓存原来只以波次为键。
     它守的是一件很隐蔽的事：翻层换环境时波次可能没变，只认波次的话
     画出来的还是上一层的红棕地面，"环境"被缓存静默吃掉了。 */
  {
    const envA = Arena.build(sess.arena.wave, 'shallow');
    sess.arena = envA; R.draw(FIXED);
    const gEnv = R.ground.canvas;
    const envB = Arena.build(sess.arena.wave, 'molten');
    ok(envB.theme === 'molten' && envA.theme === 'shallow' &&
      envB.pal.base !== envA.pal.base && envB.prop !== envA.prop,
      '两个环境给出不同的配色与装饰物（' + envA.pal.base + '/' + envA.prop +
      ' vs ' + envB.pal.base + '/' + envB.prop + '）');
    sess.arena = envB; R.draw(FIXED);
    ok(R.ground.canvas !== gEnv && R.ground.theme === 'molten',
      '同一波次换环境也重新烘焙（烘焙键 = 波次 + 环境）');
    // 环境没变时仍然命中（不能因为加了主题就每帧重烘焙）
    const gSame = R.ground.canvas;
    sess.arena = Arena.build(sess.arena.wave, 'molten'); R.draw(FIXED);
    ok(R.ground.canvas === gSame, '同波次同环境仍然命中缓存（没有变成每帧重烘焙）');
  }

  // 显式作废
  R.invalidateBakes();
  ok(R.ground.canvas === null && R.props.canvas === null, 'invalidateBakes 把两层都清掉');
  R.draw(FIXED);
  ok(!!R.ground.canvas && !!R.props.canvas, '作废后下一帧自动重建');

  // 倍率：拖到 2× 屏上必须重烘焙，且画布是设备分辨率
  const lw = Arena.W + 80;
  g.devicePixelRatio = 2;
  R.resize();
  ok(R.dpr === 2 && S.scale() === 2, 'R.resize 把设备像素比同步给了贴图缓存与烘焙层',
    R.dpr + ' / ' + S.scale());
  ok(R.ground.canvas === null, '倍率变化后烘焙层立即作废（等下一帧重建）');
  R.draw(FIXED);
  const st = R.bakeStats();
  ok(st.scale === 2 && R.ground.canvas.width === Math.ceil(lw * 2),
    '2× 倍率下烘焙画布是设备分辨率', R.ground.canvas.width + ' vs ' + Math.ceil(lw * 2));
  console.log('    · 烘焙层账目：地面 ' + mb(st.ground.bytes) + ' + 道具 ' + mb(st.props.bytes) +
    ' = ' + mb(st.bytes) + '（倍率 ' + st.scale + '）');
  console.log('    · 两层总预算 ' + mb(st.maxPx * 4) + '（超了整体退回 1×，实测 2× 时正好在预算内）');
  ok(st.bytes <= st.maxPx * 4, '两层烘焙不超过显存总预算', mb(st.bytes) + ' ≤ ' + mb(st.maxPx * 4));

  g.devicePixelRatio = 1;
  R.resize();
  R.draw(FIXED);
  ok(R.bakeStats().scale === 1 && S.scale() === 1, '退回 1× 也重新烘焙', String(R.bakeStats().scale));
}

/* =========================================================
   7. 烘焙键的成立前提：(波次, 环境) 合起来决定一切
    · 同一 (波次, 环境) 两次生成必须逐字段一致（否则缓存会把上一局的岩石画到这一局）
    · 同一波次换环境时，**位置必须不变**（环境只决定色号与形状，不决定摆在哪）——
      这条守住的是"arena 的随机流仍然只吃波次"，于是"这一间我见过"依然成立
    ========================================================= */
console.log('\n[7] 烘焙键的成立前提');
{
  const a1 = Arena.build(7), a2 = Arena.build(7);
  ok(JSON.stringify(a1) === JSON.stringify(a2),
    '同一波次两次生成战场装饰逐字段一致（烘焙缓存键可信）');
  Game.newRun('ranger', 111);
  const s1 = Game.getSession();
  const again = Arena.build(7);
  ok(JSON.stringify(again) === JSON.stringify(a2),
    '换一局（换种子 / 换角色）后同一波次的战场不变（战场是按波次派生的，与存档种子无关）',
    'run seed ' + (s1.seed || 0));

  /* 换环境：位置逐位相同，只有色号与装饰物种类不同。
     `kind`（肋骨/晶簇/菌伞…）**不参与**位置比较 —— 它本来就该不同。 */
  const envA = Arena.build(7, 'shallow'), envB = Arena.build(7, 'frost');
  const posOf = a => JSON.stringify({
    patches: a.patches.map(p => [p.x, p.y, p.rx, p.ry, p.rot, p.pts, p.bump, p.seed, p.form]),
    pebbles: a.pebbles.map(p => [p.x, p.y, p.r, p.sq, p.rot]),
    rocks: a.rocks.map(r => [r.x, r.y, r.r, r.n, r.dark, r.pts]),
    cracks: a.cracks.map(c => [c.pts, c.w]),
    props: a.props.map(p => [p.x, p.y, p.rot, p.s])
  });
  ok(posOf(envA) === posOf(envB),
    '同一波次换环境时地形**位置逐位不变**（环境只换色号与形状，不换"东西摆在哪"）');
  ok(envA.pal.base !== envB.pal.base && envA.pal.tones.join() !== envB.pal.tones.join(),
    '两个环境的地面配色确实不同（' + envA.pal.base + ' vs ' + envB.pal.base + '）');
  ok(envA.prop !== envB.prop, '两个环境的装饰物种类确实不同（' + envA.prop + ' vs ' + envB.prop + '）');
  ok(envA.theme === 'shallow' && envB.theme === 'frost', '战场数据里带着环境 id（缓存靠它失效）');
  const worst = Arena.build(7, '不存在这个环境');
  ok(worst.theme === 'shallow', '环境 id 不认识时退回默认环境（不会画不出东西）', worst.theme);
}

/* =========================================================
   8. 长局：贴图只增不换（条目数有界，且长局之后没有被重建过）
   "条目数不随时间增长"这个说法是错的：波次推进会引入新的怪种，
   每个怪种本来就该有一张。真正该守住的是
     · 条目数 = 每种怪的（本体 + 白闪）+ 掉落，没有多余/漂移的键
     · 长局之后同一个 def 拿到的还是**同一个对象**（没有反复重建 = 没有每帧重画）
   ========================================================= */
console.log('\n[8] 长局：只增不换、条目有界');
{
  // 先把全部敌人贴图取一遍：之后长局里新出现的怪种都在这份名单里
  const held = {};
  for (const def of Enemies.LIST) { held[def.id] = [S.enemySprite(def), S.enemyFlash(def)]; }
  // 两种掉落也先取一遍（"开局手上就有的那批"要以它为准，而不是以一条算术公式为准）
  held['@mat'] = [S.pickupSprite('mat')];
  held['@heal'] = [S.pickupSprite('heal')];
  /* 建完这批"手上就有的贴图"之后**立刻记一次账**：之后长局里新增的键必须
     **只有**角色图集与武器图集两类。
     改造前的写法是 `st.entries === 怪×2 + 2 + atlas + wp` —— 一条**算术恒等式**：
     它能发现"数目对不上"，却说不出"多/少的是哪个键"，而且它假定"两种掉落一定都被
     画过"（只有材料掉到地上时，那条就假失败了）。现在改成按**键前缀分类**核对：
     每一条键都必须能被归到五类之一，且"开局那批一张都不能少"。 */
  const baseKeys = S.cacheStats().list.map(e => e.key);
  ok(baseKeys.length >= Enemies.LIST.length * 2 + 2,
    '开局手上那批贴图都在缓存里（' + baseKeys.length + ' 条）');

  Game.newRun('gladiator', 909);
  enterFightRoom(); Game._internals.startWave(6);
  const seenWaves = new Set();
  const marks = [];
  let err = null;
  try {
    for (let i = 0; i < 1500; i++) {
      if (Game.state === 'playing') Game.step(FIXED, Game.autoInput(i * FIXED));
      else if (Game.state === 'levelup') Game.chooseLevelCard(0);
      else if (Game.state === 'shop') Game.nextWave();
      R.draw(FIXED);
      seenWaves.add(Game.wave);
      if (i % 300 === 299) {
        const s2 = S.cacheStats();
        marks.push({ frame: i + 1, entries: s2.entries, bytes: s2.bytes });
      }
    }
  } catch (e) { err = e.message + '\n      ' + (e.stack.split('\n')[1] || '').trim(); }
  ok(!err, '1500 帧 更新+渲染 无异常', err);

  const st = S.cacheStats();
  console.log('    · 跑过 ' + seenWaves.size + ' 个波次后的贴图缓存：' + st.entries + ' 条 · ' +
    mb(st.bytes) + '（倍率 ' + st.scale + '）');
  for (const m of marks) console.log('      第 ' + String(m.frame).padStart(4) + ' 帧：' + m.entries + ' 条 · ' + mb(m.bytes));

  const rebuilt = [];
  for (const def of Enemies.LIST) {
    const h = held[def.id];
    if (S.enemySprite(def) !== h[0]) rebuilt.push(def.id + '(本体)');
    if (S.enemyFlash(def) !== h[1]) rebuilt.push(def.id + '(白闪)');
  }
  if (S.pickupSprite('mat') !== held['@mat'][0]) rebuilt.push('掉落(材料)');
  if (S.pickupSprite('heal') !== held['@heal'][0]) rebuilt.push('掉落(回血)');
  ok(rebuilt.length === 0, '长局之后每张贴图都还是原来那个对象（没有被反复重建）',
    rebuilt.slice(0, 3).join(', '));
  /* 按键前缀分类，逐类核对 —— 每一类都有明确的**来源**：
       en-*    怪物本体（每个怪种一张）
       fl-*    受击白闪剪影
       pk-*    掉落（材料 / 回血）
       atlas-* 角色姿态图集（每个呼吸档一张，有界）
       wp-*    武器图集（每把武器一张，有界）
     出现第六类键，说明有新的贴图来源没人记账（缓存就会慢慢失控）。 */
  const byPrefix = p => st.list.filter(e => e.key.indexOf(p) === 0);
  const mobN = byPrefix('en-').length, flashN = byPrefix('fl-').length;
  const dropN = byPrefix('pk-').length, atlasN = byPrefix('atlas-').length, wpN = byPrefix('wp-').length;
  const nowKeys = st.list.map(e => e.key);
  const lost = baseKeys.filter(k => nowKeys.indexOf(k) < 0);
  const extra = nowKeys.filter(k => baseKeys.indexOf(k) < 0 &&
    k.indexOf('atlas-') !== 0 && k.indexOf('wp-') !== 0);
  ok(lost.length === 0, '长局跑完，"开局就有的那批贴图"一张都没被顶掉', lost.join(', '));
  ok(extra.length === 0, '长局新增的键只有角色图集与武器图集两类（没有第三类悄悄进来）', extra.join(', '));
  ok(mobN === Enemies.LIST.length && flashN === Enemies.LIST.length,
    '每一只怪都有本体与白闪各一张（各 ' + Enemies.LIST.length + ' 张）', mobN + '/' + flashN);
  ok(dropN === 2, '两种掉落贴图都在（材料 / 回血）', dropN + ' 张');
  ok(st.entries === mobN + flashN + dropN + atlasN + wpN,
    '条目数正好等于五类之和（怪 ' + mobN + ' + 白闪 ' + flashN + ' + 掉落 ' + dropN +
    ' + 角色图集 ' + atlasN + ' + 武器图集 ' + wpN + '），没有第六类键',
    st.entries + ' vs ' + (mobN + flashN + dropN + atlasN + wpN));
  ok(atlasN > 0 && atlasN <= 30, '角色姿态图集条目有界（一次呼吸只覆盖 0.975~1.025 的档位）', atlasN + ' 张');
  ok(wpN > 0 && wpN <= 40, '武器图集条目有界（每把武器一张，形状随 swing 变的那种按档）', wpN + ' 张');
  const dup = st.list.length - new Set(st.list.map(e => e.key)).size;
  ok(dup === 0, '没有任何键被重复计入（账目本身可信）', String(dup));
  ok(st.bytes <= 16 * 1048576, '贴图缓存内存有界（≤16MB）', mb(st.bytes));
}

/* =========================================================
   9. 复用缓冲不能变成"每帧新建"—— 只有死状态检查做得到
   ========================================================= */
console.log('\n[9] 缓存/复用的代码卫生');
{
  const draw2d = fs.readFileSync(path.join(ROOT, 'src', 'draw2d.ts'), 'utf8');
  ok(!/segsCache/.test(draw2d), 'draw2d.ts 里已经没有任何"声明了没人用"的缓存变量');

  const persist = fs.readFileSync(path.join(ROOT, 'test', 'persist.mjs'), 'utf8');
  const spritesAllow = /'sprites\.ts':\s*\[([^\]]*)\]/.exec(persist);
  ok(!!spritesAllow && spritesAllow[1].indexOf('CACHE_SCALE') >= 0,
    '贴图倍率是登记在册的模块级可变状态（不会被"状态盘点"漏掉）');
  const drawAllow = /'draw2d\.ts':\s*\[([^\]]*)\]/.exec(persist);
  ok(!!drawAllow && drawAllow[1].trim() === '',
    'draw2d.ts 的白名单已经清空（删掉的死状态没有留在清单里）');

  // 缓存统计接口本身要有意义：它给出的字节数必须与画布尺寸吻合
  const st = S.cacheStats();
  let sum = 0;
  for (const e of st.list) sum += e.px;
  ok(sum === st.px && st.bytes === st.px * 4, 'cacheStats 的像素/字节账目自洽',
    st.px + ' px → ' + mb(st.bytes));
}

console.log('\n=== 结果 ===');
if (failures === 0) { console.log('\x1b[32m全部通过 ✔\x1b[0m'); process.exit(0); }
console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m');
process.exit(1);
