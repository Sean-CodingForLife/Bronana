/* =========================================================
   art.mjs — 2D 美术资源体系与 TA 那一半

   这个项目**没有一张图片文件**（全部程序化绘制），所以这一套守的不是"图对不对"，
   而是**这套体系本身立不立得住**。四组：

     [1] 美术规范（`art_spec.ts`）：命名 / 尺寸 / 图集 / 混合 / 锚点 / 管线 / 检查判据
         —— 以及**资源归属**：规范里声明了 12 类，每一类都必须
         "有生产模块"或"登记了为什么不做的理由"。沉默 = 漏做。
     [2] 瓦片与自动规则瓦片（`art_tiles.ts`）：位掩码约定、
         16 格 mask 表填满、形状与 mask 对得上、autotile 算法**逐格**正确
     [3] 2D 着色器（`art_shaders.ts`）：合成操作只有四个、
         每一步都被执行器认识、美术宪法（无 filter / 渐变 / 阴影）
     [4] 接进游戏（`render.ts` / `sprites.ts`）：废墟铺装真的铺了、
         白闪真的走了 shader 库、静态层开销在预算里

   为什么 [2] 的"形状与 mask 对得上"是最要紧的一条：
   写错的唯一表现是"转角画成了直段"—— 它**看起来只是有点怪**，
   不会抛错、不会崩溃、没有别的测试能发现它。

   用法： node test/art.mjs
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { installDom, makeProbeCtx, makeCanvas } from './_ctx.mjs';
import { loadAll, UI_MODULES } from './_load.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
let failures = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  \x1b[32mPASS\x1b[0m ' + label);
  else { failures++; console.log('  \x1b[31mFAIL\x1b[0m ' + label + (extra !== undefined ? '  → ' + extra : '')); }
}

installDom();
/* 用**界面层**那一套模块：`ui` 这一类资源的归属登记在 `ui.ts` 末尾，
   少加载那一个文件，资源归属自检就会把"界面素材没人做"报成漏做。 */
await loadAll(UI_MODULES);
const { Art, ArtTiles, ArtShaders, Registry, R, S, Game } = globalThis;

console.log('\n=== Bronana · 2D 美术资源体系（规范 / 瓦片 / 着色器） ===\n');

/* =========================================================
   [1] 美术规范
   ========================================================= */
console.log('[1] 美术规范：命名 / 尺寸 / 图集 / 混合 / 锚点 / 管线 / 检查判据');
{
  const v = Art.audit();
  ok(v.ok, '规范自检通过（' + v.counts.kinds + ' 类 · ' + v.counts.atlases + ' 图集 · ' +
    v.counts.blends + ' 混合 · ' + v.counts.anchors + ' 锚点 · ' + v.counts.stages + ' 道工序 · ' +
    v.counts.rules + ' 条判据）', v.problems.join(' | '));

  /* 前缀与类别一一对应：一个前缀只属于一类，否则文件名读不出它是什么 */
  const prefixes = Art.KINDS.map(k => k.prefix);
  ok(new Set(prefixes).size === prefixes.length, '命名前缀一一对应（没有两类共用一个前缀）');
  ok(Art.KINDS.every(k => k.examples.length >= 2), '每一类都给了至少两个命名示例');

  /* 尺寸规范自洽 */
  ok(Art.tileDivides(Art.SIZES.tile), '瓦片尺寸是绘制网格的整数倍（' + Art.SIZES.tile + ' / ' + Art.SIZES.grid + '）');
  ok(Art.tileDivides(32) && Art.tileDivides(16) && !Art.tileDivides(20),
    '整数倍的判据正确：16 ✓ 32 ✓ 20 ✗ —— 注意"整数倍"与"整除"在数值等价时含义相反');
  ok(Art.isPow2(256) && Art.isPow2(4096) && !Art.isPow2(300), '2 的幂判据正确（图集画布只许取 2 的幂）');
  ok(Art.ATLASES.every(a => a.maxSize <= Art.SIZES.pow2Max), '每个图集的尺寸上限都不超过规范上限');

  /* 锚点：世界层贴地物件必须是脚底（深度排序按脚底） */
  ok(Art.ANCHORS.some(a => a.id === 'foot'), '有"脚底"锚点（深度排序按它）');
  ok(Art.anchorFor('prop') === 'foot' && Art.anchorFor('icon') === 'center' && Art.anchorFor('tileset') === 'tile',
    '默认锚点按类别给：物件=脚底 / 图标=中心 / 瓦片=格心');
  const r = Art.anchorRatio('foot');
  ok(r.x === 0.5 && r.y === 1, '脚底锚点的归一化偏移是 (0.5, 1)', JSON.stringify(r));

  /* 管线：顺序固定、每道都有产物与检查 */
  ok(Art.PIPELINE.map(s => s.id).join(',') === 'paint,lint,bake,atlas,place,draw',
    '管线六道工序的顺序是固定的（画法→检查→烘焙→图集→摆放→合成）');
  ok(Art.PIPELINE.every(s => s.product && s.check), '每道工序都写了产物形式与检查方式（有检查才叫工序）');

  /* ---- 那条校验本身要能用 ---- */
  ok(Art.lintAsset({ name: 'PROP_Bone', kind: 'prop', w: 32, h: 48, anchor: 'foot' }).ok,
    '合规的资源声明通过 lint');
  const bad = Art.lintAsset({ name: 'prop bone', kind: 'nope', w: 9999, h: 0, anchor: 'nope' });
  const rules = bad.problems.map(p => (/^\[(\w+)\]/.exec(p) || [])[1]);
  ok(!bad.ok && rules.indexOf('name') >= 0 && rules.indexOf('kind') >= 0 &&
    rules.indexOf('size') >= 0 && rules.indexOf('anchor') >= 0,
    '坏声明会被四条判据同时拦下（name / kind / size / anchor）', bad.problems.join(' | '));
  ok(!Art.lintAsset({ name: 'PROP_Bone', kind: 'prop', w: 32, h: 32, anchor: 'center' }).ok,
    '世界层贴地物件用中心锚点会被拦（深度排序会排错）');
  ok(Art.lintAsset({ name: 'FX_Ring', kind: 'fx', w: 64, h: 64, anchor: 'center', blend: 'normal' }).problems
    .some(p => /blend/.test(p)),
    '混合模式与类别不一致会被拦（跨组混合会打断批处理）');
  ok(!Art.lintAsset({ name: 'TILE_Floor', kind: 'tileset', w: 20, h: 20, anchor: 'tile' }).ok,
    '瓦片尺寸不是网格整数倍会被拦（拼接处会落不到格线上）');
  ok(Art.lintAsset({ name: 'ICON_中文', kind: 'icon', w: 32, h: 32, anchor: 'center' }).problems
    .some(p => /中文|名字/.test(p)),
    '名字里有中文会被拦（跨平台文件名规范）');

  /* ---- 资源归属：这是"系统化"的硬门槛 ---- */
  Art.requireOwners = true;
  const owned = Art.audit();
  Art.requireOwners = false;
  ok(owned.ok, '资源归属自检通过：每一类要么有生产模块、要么登记了推迟理由',
    owned.problems.join(' | '));
  ok(Art.missingKinds().length === 0, '没有"既没人做、也没登记理由"的类别',
    Art.missingKinds().join(','));
  ok(Art.OWNERS.tileset && Art.OWNERS.tileset.length === 2,
    '瓦片集有两个贡献者（规范在 art_tiles.ts、绘制在 render.ts）', JSON.stringify(Art.OWNERS.tileset));
  ok(Art.DEFERRED.length === 0 || Art.DEFERRED.every(d => d.why && d.why.length > 20),
    '推迟清单要么空、要么每一条都有写清楚的理由（现在 ' + Art.DEFERRED.length + ' 条：' +
    Art.DEFERRED.map(d => d.kind).join(', ') + '）');

  /* 反证：把一个生产模块撤掉，必须报出来（校验不是装饰） */
  const saved = Art.OWNERS.icon;
  delete Art.OWNERS.icon;
  Art.requireOwners = true;
  const broke = Art.audit();
  Art.requireOwners = false;
  Art.OWNERS.icon = saved;
  ok(!broke.ok && broke.problems.some(p => /icon/.test(p)),
    '撤掉"图标"的生产模块 → 归属自检立刻红（不是空转）', broke.problems[0]);
  Art.requireOwners = true;
  ok(Art.audit().ok, '装回去之后重新通过');
  Art.requireOwners = false;

  /* 登记到总账 */
  ok(['artKind', 'artAtlas', 'artBlend', 'artAnchor', 'artStage'].every(f => Registry.has(f)),
    '规范的五张表都登记进了扩展点总账');
}

/* =========================================================
   [2] 瓦片与自动规则瓦片
   ========================================================= */
console.log('\n[2] 瓦片：位掩码约定 / 16 格规则表 / autotile 算法');
{
  const v = ArtTiles.audit();
  ok(v.ok, '瓦片表自检通过（' + v.counts.sets + ' 套 · ' + v.counts.shapes + ' 形状 · ' +
    v.counts.tiles + ' 块瓦片）', v.problems.join(' | '));

  /* ---- 位掩码约定：与 DIRS 同序 ---- */
  ok(ArtTiles.DIRS.join(',') === 'N,E,S,W', '方向顺序是 上下左右（与 Dungeon.DIRS 同序）');
  ok(ArtTiles.BIT.N === 1 && ArtTiles.BIT.E === 2 && ArtTiles.BIT.S === 4 && ArtTiles.BIT.W === 8,
    '四位掩码的取值固定（N=1 E=2 S=4 W=8）');
  ok(ArtTiles.OFFSETS.length === 4 && ArtTiles.OFFSETS[0][1] === -1 && ArtTiles.OFFSETS[2][1] === 1,
    '偏移量与方向同序（上=(0,-1)、下=(0,1)）');
  ok(ArtTiles.maskLabel(0) === '....' && ArtTiles.maskLabel(15) === 'NESW' &&
    ArtTiles.maskLabel(5) === 'N.S.',
    '掩码可读化：0→"...." 15→"NESW" 5→"N.S."');

  /* ---- 形状由掩码唯一决定：16 格里每一种都要对 ---- */
  const expect = {
    0: 'isolated', 1: 'end', 2: 'end', 3: 'corner', 4: 'end', 5: 'straight', 6: 'corner', 7: 'tee',
    8: 'end', 9: 'corner', 10: 'straight', 11: 'tee', 12: 'corner', 13: 'tee', 14: 'tee', 15: 'fill'
  };
  let shapeBad = [];
  for (let m = 0; m <= 15; m++) if (ArtTiles.shapeOfMask(m) !== expect[m]) shapeBad.push(m);
  ok(shapeBad.length === 0, '16 个掩码 → 形状的映射逐格正确', shapeBad.join(','));
  ok(ArtTiles.shapeOfMask(-1) === '' && ArtTiles.shapeOfMask(16) === '',
    '越界掩码返回空串（而不是猜一个形状）');

  /* ---- 规则表：16 格填满 + 形状对得上 + 每块瓦片都被用到 ---- */
  let maskBad = [], shapeMismatch = [], unusedTile = [];
  for (const ts of ArtTiles.TILESETS) {
    if (ts.mask.length !== 16) maskBad.push(ts.id);
    const used = new Set(ts.mask);
    for (const td of ts.tiles) if (!used.has(td.id)) unusedTile.push(ts.id + '.' + td.id);
    for (let m = 0; m <= 15; m++) {
      const id = ts.mask[m];
      const td = ts.tiles.find(t => t.id === id);
      if (!td || td.shape !== expect[m]) shapeMismatch.push(ts.id + '#' + m);
    }
  }
  ok(maskBad.length === 0, '每一套瓦片集的 mask 表都是 16 格（' + ArtTiles.TILESETS.length + ' 套）', maskBad.join(','));
  ok(shapeMismatch.length === 0, '每一格 mask 指到的瓦片形状都与掩码对得上（写错的表现只是"有点怪"）', shapeMismatch.join(','));
  ok(unusedTile.length === 0, '没有"永远画不到"的瓦片', unusedTile.join(','));
  ok(ArtTiles.TILESETS.every(ts => Art.tileDivides(ts.tileSize)),
    '每一套的瓦片尺寸都是绘制网格的整数倍', ArtTiles.TILESETS.map(t => t.id + ':' + t.tileSize).join(' '));

  /* ---- autotile 算法：逐格核对，而不是"看起来对" ---- */
  const g = ArtTiles.blankGrid(5, 3);
  ArtTiles.fillRect(g, 0, 1, 4, 1, 1);                    // 一条横带
  ok(ArtTiles.maskAt(g, 0, 1) === 2 && ArtTiles.maskAt(g, 2, 1) === 10 && ArtTiles.maskAt(g, 4, 1) === 8,
    '横带上各格的掩码正确（左端=2 中段=10 右端=8）',
    [0, 2, 4].map(x => ArtTiles.maskAt(g, x, 1)).join('/'));
  const plan = ArtTiles.autotile('dungeonStructure', g, 0, 0);
  ok(plan.cells.length === 5, '五种非空格各出一块瓦片（越界当"不是"，所以两端自动收口）', plan.cells.length);
  ok(plan.cells[0].shape === 'end' && plan.cells[0].tile === 'wall_end' &&
    plan.cells[2].shape === 'straight' && plan.cells[2].tile === 'wall_straight',
    '算法挑出的瓦片与掩码一致（端头 / 直段）');
  ok(plan.cells.every(c => c.x % plan.tileSize === 0 && c.y % plan.tileSize === 0),
    '算出来的**像素坐标**落在格线上（调用方不必再乘一次）');
  ok(plan.counts.wall_end === 2 && plan.counts.wall_straight === 3,
    '按瓦片 id 的分档计数正确', JSON.stringify(plan.counts));

  /* 内部格：四面都有 → fill（这是数量最多的一格，短路优化就靠它） */
  const g2 = ArtTiles.blankGrid(4, 4);
  ArtTiles.fillRect(g2, 0, 0, 3, 3, 1);
  ok(ArtTiles.maskAt(g2, 1, 1) === 15 && ArtTiles.maskAt(g2, 2, 2) === 15 &&
    ArtTiles.tileFor(ArtTiles.get('dungeonStructure'), 15) === 'wall_fill',
    '四邻俱全的内部格掩码是 15 → fill');
  /* 孤立格 */
  const g3 = ArtTiles.blankGrid(3, 3);
  g3[1][1] = 1;
  ok(ArtTiles.maskAt(g3, 1, 1) === 0 && ArtTiles.autotile('dungeonStructure', g3, 0, 0).cells[0].tile === 'wall_isolated',
    '四面都不连 → isolated（掩码 0）');
  /* 一格都不铺时不许产出 / 不许抛 */
  const empty = ArtTiles.autotile('dungeonStructure', ArtTiles.blankGrid(4, 4), 0, 0);
  ok(empty.cells.length === 0, '空网格算出零块瓦片（不是抛错，也不是硬画一块）');
  ok(ArtTiles.autotile('nope', g, 0, 0).cells.length === 0, '未知瓦片集返回空清单而不是抛错');
  ok(ArtTiles.autotile('dungeonStructure', null, 0, 0).cells.length === 0, '没有网格时返回空清单');

  /* 偏移量真的进了坐标 */
  const off = ArtTiles.autotile('dungeonStructure', g, 100, 50);
  ok(off.cells[0].x === 100 && off.cells[0].y === 66, '原点偏移正确（100,50 + 第 1 行 → y=66）',
    off.cells[0].x + ',' + off.cells[0].y);

  /* 确定性：同一张网格算两次逐字段一样（渲染层的烘焙缓存靠这个） */
  const a1 = JSON.stringify(ArtTiles.autotile('ruinFloor', g2, 0, 0));
  const a2 = JSON.stringify(ArtTiles.autotile('ruinFloor', g2, 0, 0));
  ok(a1 === a2, 'autotile 是纯函数：同一张网格两次结果逐字段一致');

  /* 反证：把规则表的一格改成错的形状，自检必须报出来 */
  const ts0 = ArtTiles.get('dungeonStructure');
  const savedMask = ts0.mask[7];
  ts0.mask[7] = 'wall_straight';        // mask 7 是丁字，形状应当不符
  const broke = ArtTiles.audit();
  ts0.mask[7] = savedMask;
  ok(!broke.ok && broke.problems.some(p => /mask 7/.test(p)),
    '把 mask 7 指成直段 → 自检报"形状对不上"（这是最容易写错的一格）', broke.problems[0]);
  ok(ArtTiles.audit().ok, '改回来之后重新通过');

  ok(Registry.has('terrain') && Registry.has('tileShape'), '地形与形状两个家族都登记进了总账');
}

/* =========================================================
   [3] 2D 着色器
   ========================================================= */
console.log('\n[3] 2D 着色器：合成操作 / 步骤 / 美术宪法');
{
  const v = ArtShaders.audit();
  ok(v.ok, '着色器库自检通过（' + v.counts.shaders + ' 条 · 贴图级 ' + v.counts.sprite +
    ' / 屏幕级 ' + v.counts.screen + ' · 已接入 ' + v.counts.used + '）', v.problems.join(' | '));

  ok(ArtShaders.OPS.length === 4, '合成操作正好 4 个（over / in / atop / add）——多一个就是浏览器差异的赌注');
  ok(ArtShaders.canvasOp('in') === 'source-in' && ArtShaders.canvasOp('add') === 'lighter' &&
    ArtShaders.canvasOp('nope') === 'source-over',
    'op → canvas 合成模式正确，且认不出的回退 source-over（不抛）');

  /* 美术宪法：这条与 render-check 的运行时拦截是同一件事的两道 */
  const src = fs.readFileSync(path.join(ROOT, 'src', 'art_shaders.ts'), 'utf8');
  const decls = JSON.stringify(ArtShaders.LIST);
  ok(!/gradient|shadow/i.test(decls) && !/filter/i.test(decls.replace(/filter \/ 渐变 \/ 阴影/g, '')),
    'shader 声明里没有渐变 / 阴影 / 原生 filter（违反美术宪法）');
  ok(/不许出现原生 `filter`/.test(src), '文件头写明了"不许用原生 filter"这条约束');

  /* 执行器：每条 shader 都能画，且真的落了绘制调用 */
  const ctx = makeProbeCtx({ ops: true });
  let painted = 0;
  for (const sh of ArtShaders.LIST) {
    try { if (ArtShaders.paint(ctx, sh.id, 64, 64, { color: '#ffffff', width: 3, alpha: 0.5, dx: 2, threshold: 0.4 })) painted++; }
    catch (e) { ok(false, '执行 shader ' + sh.id + ' 抛异常', e.message); }
  }
  ok(painted === ArtShaders.LIST.length, '全部 ' + painted + ' 条 shader 都能被执行器画出来');
  ok(ctx.rects.length >= ArtShaders.LIST.length, '每一步都真的产生了绘制（不是空转）', ctx.rects.length + ' 次 fillRect');
  ok(ctx.badArgs.length === 0, '绘制参数里没有 NaN / ∞', ctx.badArgs.slice(0, 3).join(' | '));
  ok(ArtShaders.paint(ctx, 'nope', 10, 10) === false && ArtShaders.paint(null, 'hitFlash', 10, 10) === false,
    '未知 shader / 没有上下文时返回 false（不抛）');

  /* 颜色解析：参数名 → 参数值；认不出的回退成白（**绝不产出 undefined**） */
  const c2 = makeProbeCtx();
  ArtShaders.paint(c2, 'hitFlash', 32, 32, { color: '#ff00ff' });
  ok(c2.rects.some(r => r.style === '#ff00ff'), '参数里的颜色真的落到了 fillStyle');
  const c3 = makeProbeCtx();
  ArtShaders.paint(c3, 'hitFlash', 32, 32, {});      // 参数写错 / 忘了给
  ok(c3.rects.every(r => typeof r.style === 'string' && r.style !== 'undefined'),
    '参数缺失时回退成白色而不是 undefined（失败要可见，不能是"上一次的颜色"）',
    c3.rects.map(r => r.style).join(','));

  /* 使用方登记：接上了的与没接入的都说得清 */
  ok(ArtShaders.usersOf('hitFlash').length >= 1, '白闪登记了使用方（' + ArtShaders.usersOf('hitFlash').join(',') + '）');
  ok(ArtShaders.usersOf('elite').length >= 1, '精英色登记了使用方（' + ArtShaders.usersOf('elite').join(',') + '）');
  ok(ArtShaders.usersOf('vignette').length >= 1, '暗角登记了使用方（屏幕级那一条）（' + ArtShaders.usersOf('vignette').join(',') + '）');
  ok(ArtShaders.unused().indexOf('hitFlash') < 0, '已接入的 shader 不在"没人用"清单里');

  /* 接入状态：每条 shader 要么接上了，要么登记为**备用并写清条件** */
  ArtShaders.requireWiring = true;
  const wired = ArtShaders.audit();
  ArtShaders.requireWiring = false;
  ok(wired.ok, '接入状态自检通过：' + wired.counts.used + ' 条已接入 · ' +
    wired.counts.reserved + ' 条登记为备用 · 漏接 ' + ArtShaders.missingWiring().length,
    wired.problems.join(' | '));
  ok(ArtShaders.missingWiring().length === 0, '没有"既没接入、也没登记理由"的 shader',
    ArtShaders.missingWiring().join(','));
  ok(ArtShaders.RESERVED.every(r => r.why && r.why.length > 20),
    '备用效果都写清了"等什么条件才用"（' + ArtShaders.RESERVED.map(r => r.id).join(', ') + '）');

  /* 反证：撤掉一个使用方，接入自检必须红 */
  const savedUse = ArtShaders.USED_BY.hitFlash;
  delete ArtShaders.USED_BY.hitFlash;
  ArtShaders.requireWiring = true;
  const broke = ArtShaders.audit();
  ArtShaders.requireWiring = false;
  ArtShaders.USED_BY.hitFlash = savedUse;
  ok(!broke.ok && broke.problems.some(p => /hitFlash/.test(p)),
    '撤掉白闪的使用方 → 接入自检立刻红（不是空转）', broke.problems[0]);
  ArtShaders.requireWiring = true;
  ok(ArtShaders.audit().ok, '装回去之后重新通过');
  ArtShaders.requireWiring = false;

  let threw = false;
  try { ArtShaders.noteUse('nope', 'x.ts'); } catch (e) { threw = true; }
  ok(threw, '登记一个不存在的 shader 会抛（写错名字不该静默通过）');

  ok(Registry.has('shader') && Registry.has('shaderOp'), '着色器与合成操作两个家族都登记进了总账');
}

/* =========================================================
   [4] 接进游戏
   ========================================================= */
console.log('\n[4] 接进游戏：废墟铺装与白闪');
{
  /* 贴图覆盖层（白闪 / 精英色）真的走了 shader 库，而且**只有一处**执行点。
     这里查的是形状而不是行为：行为上"画错地方"看不出差别（老实现照样出图），
     而错的地方正是"合成步骤被抄了第二份、或者在世界画布上现画"。 */
  const spritesSrc = fs.readFileSync(path.join(ROOT, 'src', 'sprites.ts'), 'utf8');
  const paintCalls = spritesSrc.match(/ArtShaders\.paint\(/g) || [];
  ok(paintCalls.length === 1 && /ArtShaders\.paint\(x, shaderId/.test(spritesSrc),
    'shader 在贴图层只有一个执行点（`bakeOverlay` 按 id 执行，两条效果共用）', paintCalls.length + ' 处');
  ok(/return bakeOverlay\('fl-', def, 'hitFlash'/.test(spritesSrc),
    'enemyFlash 走 shader 库的 hitFlash（效果的合成步骤只有一处出处）');
  ok(/return bakeOverlay\('el-', def, 'elite'/.test(spritesSrc),
    'enemyElite 走 shader 库的 elite —— **烘到贴图上**，而不是在世界画布上现铺一块金色矩形');
  const overlayBody = /function bakeOverlay[\s\S]*?\n\}/.exec(spritesSrc);
  ok(!!overlayBody && overlayBody[0].indexOf('globalCompositeOperation') < 0,
    '覆盖层烘焙里不裸写合成模式（那是同一件事的第二个执行点）');
  /* 精英色的那一步合成必须是 `atop`：`add`(=lighter) 不认目标 alpha，
     在世界画布上会连同背景一起染成一块金色矩形（老实现就是那块 90×86 的矩形）。 */
  const eliteDef = ArtShaders.get('elite');
  ok(!!eliteDef && eliteDef.steps.every(s => s.op === 'atop'),
    'elite 的合成步骤是 atop（认目标 alpha，才能"只落在轮廓内"）',
    eliteDef ? eliteDef.steps.map(s => s.op).join(',') : 'null');

  /* 白闪贴图仍然出得来，且是**设备分辨率**（与本体同倍率） */
  const { Enemies } = globalThis;
  const def = Enemies.LIST[0];
  const fl = S.enemyFlash(def);
  ok(!!fl && fl.canvas.width > 0, '白闪剪影仍然生成得出来', fl ? fl.canvas.width + 'x' + fl.canvas.height : 'null');
  const spr = S.enemySprite(def);
  ok(!!spr && fl.canvas.width === spr.canvas.width && fl.width === spr.width,
    '白闪与本体同尺寸同锚点（否则它会错位）');

  /* 废墟铺装：真的铺了砖，且铺装是**稀疏**的（不然整片都是砖） */
  Game.newRun('ranger', 20260901);
  R.init(makeCanvas(1280, 720));
  globalThis.Game.setState('playing', true);
  R.draw(1 / 60);
  const t = R.terrain;
  ok(t.tiles > 0, '废墟铺装真的铺了砖（' + t.tiles + ' 块，来自 ' + t.cells + ' 格）');
  ok(t.cells < 105 * 79 * 0.5, '铺装是稀疏的：候选格少于战场总格数的一半（' + t.cells + '/' + (105 * 79) + '）');
  ok(t.set === 'ruinFloor', '用的是 ruinFloor 那一套瓦片集', t.set);

  /* 计算量守卫：铺装不能把静态层烘焙顶穿（`test/render-check.mjs` 的同一条校验） */
  ok(t.tiles * 8 < 60000, '铺装的绘制预算在静态层上限内（' + t.tiles + ' 块 × 约 8 笔 = ' +
    (t.tiles * 8) + ' < 60000）');

  /* 同一个波次两次烘焙得到同一份铺装（烘焙缓存键的前提） */
  const g1 = JSON.stringify(R.terrain);
  R.invalidateBakes();
  R.draw(1 / 60);
  ok(JSON.stringify(R.terrain) === g1, '同一波次重复烘焙得到同一份铺装（烘焙缓存键可信）');
}

/* =========================================================
   [5] 分层视差与状态动画
   ========================================================= */
console.log('\n[5] 分层视差与状态动画：镜头平移 → 键帧取样');
{
  const { ArtParallax, Arena } = globalThis;
  const v = ArtParallax.audit();
  ok(v.ok, '视差与动画表自检通过（' + v.counts.layers + ' 层 · ' + v.counts.clips +
    ' 条 clip · ' + v.counts.keys + ' 个关键帧）', v.problems.join(' | '));

  /* ---- rate 的取值区间与层次 ---- */
  ok(ArtParallax.LAYERS.every(l => l.rate > 0 && l.rate < 1),
    '每层的 rate 都严格落在 (0,1)：0 = 贴屏幕、1 = 跟地面同速（都看不出来）');
  const rates = ArtParallax.LAYERS.slice().sort((a, b) => a.rate - b.rate).map(l => l.rate);
  let minGap = 9;
  for (let i = 1; i < rates.length; i++) minGap = Math.min(minGap, rates[i] - rates[i - 1]);
  ok(minGap >= 0.05, '相邻层的 rate 差 ≥ 0.05（差太小肉眼分不出层次，那两层是白画）',
    '最小差 ' + minGap.toFixed(3));

  /* ---- offsetOf 是纯函数，且"越远越慢" ---- */
  const half = Arena.W / 2;
  const oSky = ArtParallax.offsetOf('sky', half + 200, Arena.H / 2, 1280, 720, Arena.W, Arena.H);
  const oRuin = ArtParallax.offsetOf('ruin', half + 200, Arena.H / 2, 1280, 720, Arena.W, Arena.H);
  ok(oSky.x > 0 && oSky.x < oRuin.x, '镜头右移时两层都跟着移，且远景移得更少（' +
    oSky.x.toFixed(1) + ' < ' + oRuin.x.toFixed(1) + '）');
  ok(Math.abs(ArtParallax.offsetOf('sky', half, Arena.H / 2, 1280, 720, Arena.W, Arena.H).x) < 1e-9,
    '镜头在正中时偏移为 0（同种子下可复现）');

  /* ---- 副本份数是**算出来的**：少一份的表现是"走到角落背景断了" ---- */
  for (const ly of ArtParallax.LAYERS) {
    const copies = ArtParallax.copiesOf(ly, 1280, 720, Arena.W, Arena.H);
    const maxPan = Math.max((Arena.W - 1280) / 2, (Arena.H - 720) / 2);
    const need = maxPan * ly.rate;
    ok(copies * ly.repeat >= need * 2, ly.id + ' 的副本份数覆盖得住最大平移（' +
      copies + ' × ' + ly.repeat + ' ≥ ' + (need * 2).toFixed(0) + '）');
  }
  /* 极端：视口比战场大 → 镜头钉在中心 → 一份就够 */
  ok(ArtParallax.copiesOf('ruin', 4000, 3000, Arena.W, Arena.H) === 1,
    '视口比战场大时只需要一份（镜头没有可平移的余地）');

  /* ---- layout：位置只由镜头决定，不受 tick 影响 ---- */
  const L1 = ArtParallax.layout('ridge', half + 120, Arena.H / 2 + 60, 1280, 720, Arena.W, Arena.H, 0);
  const L2 = ArtParallax.layout('ridge', half + 120, Arena.H / 2 + 60, 1280, 720, Arena.W, Arena.H, 9999);
  ok(L1.length === L2.length && L1.every((it, i) => it.x === L2[i].x && it.y === L2[i].y),
    '同一镜头的两次 layout 位置逐字段一致（tick 只影响装饰性抖动，不影响位置）');
  ok(L1.every(it => it.flick >= 0 && it.flick <= 1), '抖动值落在 0..1');
  ok(ArtParallax.layout('nope', 0, 0, 1280, 720, Arena.W, Arena.H).length === 0,
    '未知层返回空清单而不是抛错');

  /* ---- 动画 clip：取样必须是插值，不是阶跃 ---- */
  const open = ArtParallax.clip('doorOpen');
  ok(!!open && open.keys[0].t === 0 && open.keys[open.keys.length - 1].t === 1,
    'doorOpen 的首尾关键帧封口（0 与 1）');
  const v0 = ArtParallax.valueAt('doorOpen', 0);
  const vMid = ArtParallax.valueAt('doorOpen', open.duration * 0.55);
  const vEnd = ArtParallax.valueAt('doorOpen', open.duration);
  ok(Math.abs(v0 - 1) < 1e-9 && Math.abs(vEnd) < 1e-9,
    '起点 1（门闩压着）、终点 0（抬到底）', v0 + ' → ' + vEnd);
  ok(vMid < 0, '中途过冲为负（"抬起"要有惯性）—— 关键帧写的过冲真的生效了', String(vMid));
  ok(ArtParallax.valueAt('doorOpen', -5) === v0 && ArtParallax.valueAt('doorOpen', 999) === vEnd,
    '越界的 elapsed 被钳住（不 extrapolate）');
  ok(ArtParallax.valueAt('nope', 1) === 0 && ArtParallax.sample(null, 0.5) === 0,
    '未知 clip 返回 0 而不是抛错');
  /* 循环的 clip：进度取小数部分 */
  const spin = ArtParallax.clip('shrineSpin');
  ok(spin.loop === true && Math.abs(ArtParallax.progress('shrineSpin', spin.duration * 2.5) - 0.5) < 1e-9,
    '循环 clip 的进度取小数部分（持续旋转）');

  /* 反证：把 rate 改成与 depth 反向，自检必须报出来 */
  const sky = ArtParallax.get('sky');
  const savedRate = sky.rate;
  sky.rate = 0.9;                       // 最远的一层反而最快
  const broke = ArtParallax.audit();
  sky.rate = savedRate;
  ok(!broke.ok && broke.problems.some(p => /不同向/.test(p)),
    '把远景的 rate 调成最快 → 自检报"越远必须越慢"', broke.problems[0]);
  ok(ArtParallax.audit().ok, '改回来之后重新通过');

  /* 反证：关键帧不封口会被拦 */
  const dk = open.keys[open.keys.length - 1].t;
  open.keys[open.keys.length - 1].t = 0.9;
  const broke2 = ArtParallax.audit();
  open.keys[open.keys.length - 1].t = dk;
  ok(!broke2.ok && broke2.problems.some(p => /t=1/.test(p)),
    '关键帧不封口（末尾不在 t=1）→ 自检报出来', broke2.problems[0]);

  ok(Registry.has('parallaxLayer') && Registry.has('animClip'),
    '视差层与动画 clip 两个家族都登记进了总账');

  /* ---- 接进渲染：这一帧真的画了视差层，且真在动 ---- */
  const c1 = R.parallax;
  ok(c1.layers === ArtParallax.LAYERS.length && c1.items > 0,
    '渲染一帧真的画了 ' + c1.layers + ' 层视差、' + c1.items + ' 份副本');
  ok(c1.items <= ArtParallax.LAYERS.reduce((a, l) =>
    a + ArtParallax.copiesOf(l, R.cam.w, R.cam.h, Arena.W, Arena.H), 0),
    '副本数不超过"铺得满"所需（没有多画保险份）');

  /* doorBoltLift：状态一变就重播，且**门闩会真的抬起来**。
     用一个只属于这条断言的房间 id（`r-bolt`）—— 计时表是按房间存的，
     用测试里已经出现过的 id 会读到那一条的计时，断言就变成了"碰运气"。 */
  const RID = 'r-bolt-' + Math.random().toString(36).slice(2, 8);
  const f1 = R.doorBoltLift(1 / 60, RID, false);
  ok(Math.abs(f1 - 1) < 1e-9, '锁着时门闩压到底（抬升量 = 1）');
  const f2 = R.doorBoltLift(1 / 60, RID, true);
  ok(f2 < 1, '门一变清就开始抬（抬升量 < 1）', String(f2));
  let f3 = f2;
  for (let i = 0; i < 40; i++) f3 = R.doorBoltLift(1 / 60, RID, true);
  ok(Math.abs(f3) < 1e-9, '0.3 秒之后抬到底（抬升量 = 0）', String(f3));
  ok(R.doorBoltLift(1 / 60, RID + '-other', false) === 1, '另一间房的门不受影响（计时按房间分开）');
}

/* =========================================================
   [6] 宣传美术：标题字与徽记
   ========================================================= */
console.log('\n[6] 宣传美术（promo）：标题字与徽记是**画出来的**');
{
  ok(S.EMBLEMS.length >= 2 && S.EMBLEMS.every(e => e.w > 0 && e.h > 0 && e.note),
    '有两枚以上的宣传美术件，各自声明了逻辑尺寸与说明（' +
    S.EMBLEMS.map(e => e.id + ' ' + e.w + '×' + e.h).join(' · ') + '）');
  ok(S.EMBLEMS.every(e => Art.sizeOk(e.w, e.h)),
    '宣传美术件的尺寸过得了美术规范那条校验（< ' + Art.SIZES.assetMax + 'px）');
  /* 标题字必须**逐字声明**（不是一句文案）：字距与投影靠它锁死 */
  const title = S.EMBLEM_BY_ID.title;
  ok(title && title.glyphs.length === 7 && title.glyphs.map(g => g.ch).join('') === 'Bronana',
    '标题是逐字声明的（7 个字形拼出 Bronana）——宽度是算出来的，不受平台字体影响');
  ok(title.glyphs.some(g => g.dy), '字形带基线错落（手写标题的进深）');

  /* 画得出来，且落了绘制调用 */
  const px = makeProbeCtx();
  const drew = S.drawEmblem(px, 'title', 1);
  ok(drew && px.texts.length >= 7, '标题画得出来（' + px.texts.length + ' 次 fillText = 7 字形 + 副题）');
  ok(px.badArgs.length === 0, '绘制参数里没有 NaN / ∞', px.badArgs.slice(0, 2).join(' | '));
  const px2 = makeProbeCtx();
  S.drawEmblem(px2, 'emblem', 1);
  ok(px2.rects.length + px2.strokes.length > 0, '徽记画得出来（豆形 + 光环）');

  /* 未知件返回 false，不抛 */
  ok(S.drawEmblem(px, 'nope', 1) === false && S.drawEmblem(null, 'title', 1) === false,
    '未知宣传美术件 / 没有上下文时返回 false（不抛）');

  /* 烘成贴图：走**共用**的缓存前缀（不新开一族，否则 cache.mjs 的守卫会红） */
  const spr = S.emblemSprite('title');
  ok(!!spr && spr.width === title.w, '标题烘成了缓存贴图（' + (spr ? spr.width + '×' + spr.height : 'null') + '）');
  ok(S.emblemSprite('title') === spr, '同一件第二次取用命中同一张贴图（不是每次重烘）');
  const keys = S.cacheStats().list.map(e => e.key);
  ok(keys.some(k => k.indexOf('pk-title') === 0), '缓存键用的是共用前缀 pk-（没有新开一族）');
  ok(S.emblemSprite('nope') === null, '未知 id 返回 null');

  /* 界面真的把它画上去了（标题页那块画布） */
  const uiSrc = fs.readFileSync(path.join(ROOT, 'src', 'ui.ts'), 'utf8');
  ok(/function paintTitleLogo/.test(uiSrc) && /S\.drawEmblem\(x, em, scale\)/.test(uiSrc),
    '界面层把标题画到了 title-logo 那块画布上');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  ok(/id="title-logo"/.test(html) && !/<h1 class="logo">/.test(html),
    'index.html 里的标题已经从 <h1> 换成画布');

  /* 资源体检里 promo 这一类从此有主 */
  ok(Art.ownersOf('promo').length === 1 && Art.ownersOf('promo')[0] === 'sprites.ts',
    '`promo` 这一类登记了生产模块（sprites.ts）');
  Art.requireOwners = true;
  const owned = Art.audit();
  Art.requireOwners = false;
  ok(owned.ok && owned.counts.unowned === 0,
    '12 类资源**全部有主**（在做 ' + (Art.KINDS.length - owned.counts.unowned) + ' 类 · 推迟 ' +
    Art.DEFERRED.length + ' 类 · 漏做 0 类）', owned.problems.join(' | '));
}

console.log('\n=== 结果 ===');
if (failures === 0) console.log('\x1b[32m全部通过 ✔\x1b[0m');
else console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m');
process.exit(failures ? 1 : 0);
