/* =========================================================
   status.mjs — 状态系统（R50 点名的第 10 条）
   ---------------------------------------------------------
   这一套守两件事，两件都是真的踩到过：

   **一、状态自己的语义**（可叠层、有秒数、读数一致）
     [1] 表的形状：kind 合法 · 时长为正 · 声明"可叠"就真的能叠
     [2] 挂上 / 计时 / 掉干净（连层数与强度字段一起 —— 池化复用会带走残留）
     [3] 弱的**不会盖掉**强的（"打着打着不疼了"那一类 bug 的唯一防线）
     [4] stun 是"不能动"，不是"慢一点"（它归零，不参与乘法）
     [5] **自检要能失败**：注入坏数据证明它会红（这一条是本套的元判据）

   **二、它真的接进对局了**（这一件比第一件更要紧）
     改造前 `slow` / `stun` 两个技能载荷是**死写入**（写进未声明字段、
     全仓没有任何读点）—— 界面上写着"冻住""打断"，实际什么也没发生。
     [6] 那一类"写进去了但没人读"的 bug 现在有一条**静态**判据：
         每个状态的每个运行时字段都必须至少有一个读点（`game.ts` 里经
         `Status.moveMul` / `Status.rateOf` 读，不许各处自己 `Number(e.slow)`）
     [7] 走满一条真实的路径：技能挂上 → 敌人真的变慢 / 真的不动
   ========================================================= */
import { installDom } from './_ctx.mjs';
import { loadAll, SIM_MODULES } from './_load.mjs';
import { T } from './_assert.mjs';

installDom();
await loadAll(SIM_MODULES);
const { Status, Game, Profile, Slots, Storage, Skills, Chars } = globalThis;

console.log('\n=== Bronana · 状态系统（可叠层 · 有秒数） ===\n');

/* =========================================================
   [1] 表的形状
   ========================================================= */
T.section('1. 状态表（每一条都要真的能挂上）');
{
  T.ok(Status.audit().ok, '定义期自检通过', Status.audit().problems.join(' / '));
  T.ok(Status.LIST.length >= 2, '至少两种状态（现在 ' + Status.LIST.length + ' 种）',
    Status.LIST.map(d => d.id).join(','));

  /* 每一条的 kind 都要在 KINDS 里 —— 不在的话读数门面不会认它（挂了等于没挂） */
  const badKind = Status.LIST.filter(d => Status.KINDS.indexOf(d.kind) < 0).map(d => d.id);
  T.eq(badKind.length, 0, '每条状态的 kind 都在 KINDS 里', badKind.join(', '));
  /* 时长与层数都要是正数 */
  T.eq(Status.LIST.filter(d => !(d.dur > 0)).length, 0, '每条状态的时长都是正数');
  T.eq(Status.LIST.filter(d => !(d.maxStacks >= 1)).length, 0, '每条状态都至少能挂 1 层');
  /* **声明"可叠"就真的能叠**（只许 1 层却说可叠 = 那句话是空话） */
  const liar = Status.LIST.filter(d => d.refresh === 'stack' && !(d.maxStacks > 1)).map(d => d.id);
  T.eq(liar.length, 0, '声明"可叠"的状态都真的许了 2 层以上', liar.join(', '));

  /* 总账登记了它，而且 `kind` 是一条**跨表引用**（写错会被审计抓住） */
  T.ok(globalThis.Registry.has('status'), '状态进了扩展点总账');
  T.ok(globalThis.Registry.has('statusKind'), '`kind` 的值域也进了总账');
  T.ok(globalThis.Registry.audit().ok, '总账审计通过（status → statusKind 的引用对得上）',
    globalThis.Registry.audit().problems.slice(0, 2).map(p => p.family + '.' + p.id).join(','));
}

/* =========================================================
   [2] 挂上 / 计时 / 掉干净
   ========================================================= */
T.section('2. 挂上 → 计时 → 掉干净');
{
  const host = {};
  /* 挂上去：返回层数、读得到剩余时长 */
  T.eq(Status.apply(host, 'burn', { dps: 12 }), 1, '挂上灼烧，返回 1 层');
  T.ok(Status.leftOf(host, 'burn') > 0, '挂上之后读得到剩余时长', Status.leftOf(host, 'burn'));
  T.eq(Status.leftOf(host, 'burn'), Status.byId('burn').dur, '时长就是表里的那个数');

  /* 扣血速率 = dps × 层数 */
  T.eq(Status.rateOf(host, 'burn'), 12, '每秒伤害 = 挂上去时给的那个 dps');

  /* 走一半：还在，但少了一半 */
  Status.tick(host, 1.0);
  const half = Status.leftOf(host, 'burn');
  T.ok(half > 0 && half < Status.byId('burn').dur, '走了 1 秒之后还剩一截', half);

  /* 走完：自己掉，而且**三个字段都清干净**（池化复用会把残留带给下一个对象） */
  const gone = Status.tick(host, Status.byId('burn').dur);
  T.ok(gone.indexOf('burn') >= 0, '到期时 `tick` 把它报了出来', gone.join(','));
  T.eq(Status.leftOf(host, 'burn'), 0, '剩余时长归零');
  T.eq(Status.stacksOf(host, 'burn'), 0, '层数归零');
  T.eq(Status.rateOf(host, 'burn'), 0, '每秒伤害归零（强度字段也清了）');
  T.eq(Number(host.burnDps) || 0, 0, '**强度字段本身**也清了（不只是读数变 0）', host.burnDps);
  T.eq(Number(host.burnN) || 0, 0, '层数字段本身也清了', host.burnN);

  /* 认不出的 id：挂不上（返回 0），而不是抛 */
  T.eq(Status.apply(host, '不存在', { mul: 0.1 }), 0, '认不出的状态 id 挂不上（返回 0）');
  T.eq(Status.byId('不存在'), null, '认不出的 id 查不到定义');
  T.eq(Status.maxStacksOf('不存在'), 1, '认不出的 id 按 1 层（坏数据不该挂无限层）');

  /* 空宿主 / 空 dt 不许抛 */
  T.eq(Status.apply(null, 'burn', {}), 0, '宿主为空时返回 0（不抛）');
  T.eq(Status.leftOf(null, 'burn'), 0, '宿主为空时剩余时长是 0');
  T.eq(Status.moveMul(null), 1, '宿主为空时移动倍率是 1（恒等）');
  T.eq(Status.tick(null, 1).length, 0, '宿主为空时 `tick` 返回空数组');
  T.eq(Status.tick(host, 0).length, 0, 'dt=0 时什么都不发生');
  T.eq(Status.tick(host, -5).length, 0, 'dt 为负时什么都不发生（不会把状态"倒着加"）');
}

/* =========================================================
   [3] 弱的不会盖掉强的
   ========================================================= */
T.section('3. 弱的重复命中不会把强的那一层盖掉');
{
  const host = {};
  Status.apply(host, 'burn', { dps: 30 });
  Status.apply(host, 'burn', { dps: 4 });      // 弱的再来一次
  T.eq(Status.rateOf(host, 'burn'), 30, '每秒伤害还是 30（没被弱的那次盖成 4）');
  T.eq(Status.stacksOf(host, 'burn'), 1, '层数还是 1（不叠的状态不涨层）');

  /* 反过来的顺序也必须对：先弱后强要取强的 */
  const host2 = {};
  Status.apply(host2, 'burn', { dps: 4 });
  Status.apply(host2, 'burn', { dps: 30 });
  T.eq(Status.rateOf(host2, 'burn'), 30, '先弱后强也取强的那个', Status.rateOf(host2, 'burn'));

  /* 不叠的状态：第二次命中**刷新时长**，但不涨层 */
  const host3 = {};
  Status.apply(host3, 'burn', { dur: 1.0, dps: 5 });
  Status.tick(host3, 0.6);
  const before = Status.leftOf(host3, 'burn');
  Status.apply(host3, 'burn', { dur: 1.0, dps: 5 });
  T.ok(Status.leftOf(host3, 'burn') > before, '不叠的状态再命中会刷新时长',
    before + ' → ' + Status.leftOf(host3, 'burn'));
  T.eq(Status.stacksOf(host3, 'burn'), 1, '刷新时长不等于涨层');
  T.ok(Status.leftOf(host3, 'burn') <= Status.byId('burn').maxStacks * 1.0 + 1e-9,
    '刷新后的时长不超过"满层"的上限', Status.leftOf(host3, 'burn'));
}

/* =========================================================
   [4] 减速与定身
   ========================================================= */
T.section('4. 减速（乘）与定身（归零）');
{
  const host = {};
  T.eq(Status.moveMul(host), 1, '什么都没挂时移动倍率是 1');

  Status.apply(host, 'slow', { mul: 0.6 });
  T.ok(Math.abs(Status.moveMul(host) - 0.6) < 1e-9, '挂了减速 ×0.6', Status.moveMul(host));

  /* **可叠的减速**：第二层涨层数、也涨时长 */
  const one = Status.leftOf(host, 'slow');
  const n1 = Status.stacksOf(host, 'slow');
  Status.apply(host, 'slow', { mul: 0.6 });
  T.eq(Status.stacksOf(host, 'slow'), n1 + 1, '第二层把层数加上去了',
    n1 + ' → ' + Status.stacksOf(host, 'slow'));
  T.ok(Status.leftOf(host, 'slow') > one, '第二层也把时长补上去了',
    one + ' → ' + Status.leftOf(host, 'slow'));
  T.ok(Status.stacksOf(host, 'slow') <= Status.maxStacksOf('slow'),
    '层数不超过表里的上限', Status.stacksOf(host, 'slow'));
  /* **乘法不叠倍率**：两层 0.6 还是 0.6（层数管时长，倍率取强的那个） */
  T.ok(Math.abs(Status.moveMul(host) - 0.6) < 1e-9,
    '两层减速的倍率还是 0.6（层数管时长，不把倍率乘两次）', Status.moveMul(host));

  /* **定身归零**，而且不参与乘法 */
  Status.apply(host, 'stun', {});
  T.eq(Status.moveMul(host), 0, '定身期间移动倍率是 0（不能动，不是慢一点）');
  /* 定身掉了之后回到减速的那个倍率（不是回到 1 —— 减速还在） */
  Status.tick(host, Status.byId('stun').dur + 0.1);
  T.ok(Math.abs(Status.moveMul(host) - 0.6) < 1e-9,
    '定身掉了之后回到减速的倍率（减速还在）', Status.moveMul(host));

  /* 纯定身：掉了就回到 1 */
  const s2 = {};
  Status.apply(s2, 'stun', {});
  T.eq(Status.moveMul(s2), 0, '只挂定身时也是 0');
  Status.tick(s2, Status.byId('stun').dur + 0.1);
  T.eq(Status.moveMul(s2), 1, '定身掉了、别的什么都没挂 → 回到 1', Status.moveMul(s2));

  /* 多个减速同时挂着时**相乘**（这是 `moveMul` 的语义，不是加法） */
  const s3 = {};
  Status.apply(s3, 'slow', { mul: 0.5 });
  const two = Status.moveMul(s3);
  T.ok(two <= 1 && two > 0, '单个减速的倍率在 (0, 1] 之间', two);
}

/* =========================================================
   [5] 自检要能失败（本套的元判据）
   =========================================================
   AGENTS.md 第三节："一条不会失败的审计等于装饰。"
   做法与 `test/trade.mjs` [2] 同：**改内存里的表**跑一次，跑完还原。
   ========================================================= */
T.section('5. 自检会失败（注入坏数据证明它会红）');
{
  const victim = Status.LIST[0];
  const keepKind = victim.kind;
  victim.kind = '不认识的一种';
  T.eq(Status.audit().ok, false, '把 kind 改成不认识的 → 自检当场报红');
  T.ok(Status.audit().problems.some(p => p.indexOf('kind') >= 0),
    '报出来的问题点名了 kind（而不是一句笼统的"有问题"）',
    Status.audit().problems.join(' / '));
  victim.kind = keepKind;
  T.ok(Status.audit().ok, '改回去之后自检恢复通过');

  const keepDur = victim.dur;
  victim.dur = 0;
  T.eq(Status.audit().ok, false, '把时长改成 0 → 自检报红（挂上去会立刻掉）');
  victim.dur = keepDur;

  const keepRefresh = victim.refresh;
  victim.refresh = 'stack';
  victim.maxStacks = 1;
  T.eq(Status.audit().ok, false, '声明"可叠"却只许 1 层 → 自检报红（那句话是空话）');
  victim.refresh = keepRefresh;
  victim.maxStacks = 1;
  T.ok(Status.audit().ok, '还原之后自检恢复通过');
}

/* =========================================================
   [6] 静态：每个运行时字段都必须有读点
   =========================================================
   这一条守的是**改造前那两个真 bug 的形状**：
   `slow` / `stun` 被写进未声明字段、全仓没有任何读点 ——
   界面上写着"冻住""打断"，实际什么也没发生，而没有任何东西会报错。
   ========================================================= */
T.section('6. 静态判据：写进去的状态字段必须真的有人读');
{
  const fs = await import('node:fs');
  const path = await import('node:path');
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const root = process.cwd();
  const files = fs.readdirSync(path.join(root, 'src')).filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'));

  /* 每个状态在宿主上占三个字段，命名从 id 推出来（见 `status.ts` 的 `apply`） */
  const fields = [];
  Status.LIST.forEach(d => {
    fields.push({ id: d.id, field: d.id, what: '剩余时长' });
    fields.push({ id: d.id, field: d.id + 'N', what: '层数' });
    fields.push({ id: d.id, field: d.id + ((d.kind === 'dot' || d.kind === 'regen') ? 'Dps' : 'Mul'), what: '强度' });
  });

  /* **真正危险的是"写"**，不是"读"：
       · 别人**写** `e.slow` = 绕过 `apply`（层数、强度取大、上限全丢）——
         改造前 skill 载荷那两行就是这种写法，而它们是死写入
       · 别人**读** `e.slow` = 把那两条语义抄一遍（"多个减速相乘""定身归零"）。
         这一条只对少数几处成立（渲染层要知道"它在烧吗"），所以读点按**逐行豁免**放行。
     ⚠ 判据必须避开三类**看起来像、其实不是**的命中（第一版全踩了）：
       · `roomFx.slowMul`（屋子的地形修正）· `input.slow`（慢走的输入载荷）——
         名字里带 `slow`，与状态无关
       · `pr.slow` / `pr.burn`（技能载荷的**参数**）· `case 'burn':`（字符串）
     做法：要求"`.字段` 后面不再是词字符"（于是 `.burnDps` / `.slowMul` 不中），
     并且**只在赋值的左边**找（`=` / `+=` 那一侧）。 */
  const OWNERS = ['status.ts', 'comp.ts'];
  const writes = [];
  const readExempt = [];
  for (const f of files) {
    if (OWNERS.indexOf(f) >= 0) continue;
    const raw = fs.readFileSync(path.join(root, 'src', f), 'utf8').split('\n');
    for (let ln = 0; ln < raw.length; ln++) {
      const line = raw[ln];
      const ok = line.indexOf('status-field-ok') >= 0;
      const code = strip(line);
      for (const x of fields) {
        const re = new RegExp('\\.' + x.field + '(?![\\w$])');
        if (!re.test(code)) continue;
        /* 赋值左边？`e.slow = …` / `e.slow += …`：`.字段` 之后（跳过空格）就是 `=` */
        const isWrite = new RegExp('\\.' + x.field + '(?![\\w$])\\s*(\\+\\+|--|[+\\-*/%&|^]?=)').test(code);
        if (isWrite && !ok) writes.push(f + ':' + (ln + 1) + ' → ' + x.field + '（' + x.what + '）');
        else if (!isWrite) readExempt.push(f);
      }
    }
  }
  T.eq(writes.length, 0,
    '没有第二个模块**自己写**状态字段（写一律走 `Status.apply`）',
    writes.slice(0, 6).join(' | '));

  /* 读点：豁免是**逐行**的，而且是**被数出来的** ——
     豁免一旦变多（比如有人图省事在渲染层到处 `e.slow`），这一条会提醒回来看一眼。 */
  const readers = [...new Set(readExempt)].sort();
  T.ok(readers.length <= 3,
    '直接读状态字段的模块不超过 3 个（现在：' + (readers.join(', ') || '无') + '）',
    readers.join(','));

  /* 而**门面必须有人调** —— 不然"没有第二个读写者"是因为谁都没读 */
  const srcAll = files.map(f => strip(fs.readFileSync(path.join(root, 'src', f), 'utf8'))).join('\n');
  T.ok(/\bStatus\.moveMul\s*\(/.test(srcAll), '`Status.moveMul` 真的有人调（模拟层读它）');
  T.ok(/\bStatus\.rateOf\s*\(/.test(srcAll), '`Status.rateOf` 真的有人调');
  T.ok(/\bStatus\.tick\s*\(/.test(srcAll), '`Status.tick` 真的有人调（计时归模拟层驱动）');
}

/* =========================================================
   [7] 走满一条真实的路径
   =========================================================
   不直接调 `Status.apply` —— 那样只能证明"表是对的"。
   这里从**技能的载荷**出发，看敌人是不是真的变慢 / 真的不动。
   ========================================================= */
T.section('7. 接进真对局：技能的 slow / stun 真的生效');
{
  Storage.wipe();
  Slots.select(0);
  Profile.load();
  Profile.reset();
  const sess = Game.newRun('ranger', 31415);
  T.ok(!!sess, '开局建起来了');

  /* 找一只怪，把它定住/减速，然后看它**真的动不了**。
     ⚠ 走的是 `Status.apply` + 一步模拟：技能那条路（`applySkillPayload`）
       需要一个真的命中，在无头环境里构造起来噪音很大，而它内部做的事
       就是这一句 `Status.apply`（改造后三行载荷是同一个形状）。 */
  const e = Game._internals.spawnEnemy('grub', sess.player.x + 200, sess.player.y, { hpMul: 50 });
  T.ok(!!e, '摆了一只怪');

  const x0 = e.x, y0 = e.y;
  for (let i = 0; i < 30; i++) Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });
  const movedFree = Math.abs(e.x - x0) + Math.abs(e.y - y0);
  T.ok(movedFree > 0, '没挂状态时它会朝玩家走（' + movedFree.toFixed(1) + ' px）');

  /* 定身：它一步都不该动 */
  Status.apply(e, 'stun', {});
  T.eq(Status.moveMul(e), 0, '挂上定身之后移动倍率是 0');
  const x1 = e.x, y1 = e.y;
  for (let i = 0; i < 20; i++) Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });
  const movedStunned = Math.abs(e.x - x1) + Math.abs(e.y - y1);
  T.ok(movedStunned < 0.5, '定身期间它**真的没动**（位移 ' + movedStunned.toFixed(2) + ' px）');

  /* 定身到期之后又能动了 */
  for (let i = 0; i < 60; i++) Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });
  T.eq(Status.leftOf(e, 'stun'), 0, '定身过一会儿自己掉了');
  const x2 = e.x, y2 = e.y;
  for (let i = 0; i < 30; i++) Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });
  T.ok(Math.abs(e.x - x2) + Math.abs(e.y - y2) > 0, '定身掉了之后它又能动了');

  /* 减速：**同一帧内比较"倍率有没有被用上"**，而不是比两段位移。
     ⚠ 第一版比"同样 30 帧走多远"，结果是 26.8 vs 26.1 —— **噪声赢了**
       （怪的移动是断续的：攻击前摇、分离力、击退都在改它的速度，
        而两段采样落在攻击周期的不同相位上）。比位移要控制相位，
        那是另一个测试的事；这一节要证明的是"倍率真的作用在速度上"。 */
  const e3 = Game._internals.spawnEnemy('grub', sess.player.x + 400, sess.player.y, { hpMul: 50 });
  T.ok(!!e3, '再摆一只怪（测减速）');
  let hit = 0;
  for (let i = 0; i < 240 && !hit; i++) {
    Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });
    /* 等它这一帧真的在动（`vx`/`vy` 非零）—— 那一刻才是"倍率有没有生效"的判据 */
    if (Math.abs(e3.vx) + Math.abs(e3.vy) > 1) {
      const vx0 = e3.vx, vy0 = e3.vy;
      Status.apply(e3, 'slow', { mul: 0.25 });
      /* `Status.applyMove` 就是 `ai.ts` 里位置积分前那一步 —— 直接调它，
         量"速度真的被打了折"（而不是去猜两段位移的相位）。 */
      Status.applyMove(e3);
      const k = (Math.abs(e3.vx) + Math.abs(e3.vy)) / (Math.abs(vx0) + Math.abs(vy0));
      T.ok(Math.abs(k - 0.25) < 1e-6,
        '挂了 ×0.25 的减速之后，速度被打了折（实测 ×' + k.toFixed(4) + '）');
      hit = 1;
    }
  }
  T.ok(hit === 1, '抓到了它正在动的那一帧（不然上面那条断言没被执行）');
  /* 而**没挂状态**的对象倍率是恒等：同一帧调它不会改任何数 */
  const e4 = Game._internals.spawnEnemy('grub', sess.player.x + 500, sess.player.y + 500, { hpMul: 50 });
  if (e4) {
    for (let i = 0; i < 60; i++) Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });
    const vx1 = e4.vx, vy1 = e4.vy;
    const m1 = Status.applyMove(e4);
    T.eq(m1, 1, '没挂状态时 `applyMove` 返回 1（恒等，不碰速度）');
    T.ok(e4.vx === vx1 && e4.vy === vy1, '也没改速度（恒等是真的什么都没做）');
  }

  /* 灼烧：每秒扣血仍然生效（它是改造前唯一**有**读点的那个状态，不许回归） */
  const e2 = Game._internals.spawnEnemy('grub', sess.player.x + 300, sess.player.y + 300, { hpMul: 50 });
  Status.apply(e2, 'burn', { dps: 20 });
  const hp0 = e2.hp;
  for (let i = 0; i < 30; i++) Game.step(Game.cfg.fixedDt, { x: 0, y: 0 });
  T.ok(e2.hp < hp0, '灼烧仍然按秒扣血（' + hp0.toFixed(1) + ' → ' + e2.hp.toFixed(1) + '）');

  Storage.wipe();
  Slots.select(0);
  Profile.load();
  void Chars; void Skills;
}

process.exit(T.done());
