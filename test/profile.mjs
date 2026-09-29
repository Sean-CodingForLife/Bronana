/* =========================================================
   profile.mjs — 账号档案 / 挑战表 / 局外成长地基

   这一套守的是"跨局成长"的地基，重点在四类**静默故障**：
     1) 档案版本漂移：改了格式却没写迁移 → 老档静默作废（要能逐级升上来）
     2) 指标名写错：挑战永远不完成，而界面上看不出哪里错
     3) 解锁目标写错：解锁了一个不存在的武器 → 只要 registry 审计能抓到
     4) 重复结算：同一局被并入两次 → 孢子翻倍

   用法： node test/profile.mjs
   ========================================================= */
import { loadAll, SIM_MODULES } from './_load.mjs';

let failures = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  \x1b[32mPASS\x1b[0m ' + label);
  else { failures++; console.log('  \x1b[31mFAIL\x1b[0m ' + label + (extra !== undefined ? '  → ' + extra : '')); }
}

await loadAll(SIM_MODULES);
const { Storage, Slots, Envelope, Profile, Challenges, Registry, Save, Weapons } = globalThis;
console.error = function () { };

console.log('\n=== Bronana · 账号档案 / 挑战 / 局外成长 ===\n');

/* ---------------- 1. 信封与迁移链 ---------------- */
console.log('[1] 信封与迁移链（机制只有一份，各域独立）');
{
  const a = Envelope.create({ name: 'A', version: 1 });
  const w = a.wrap('thing', { x: 1 });
  ok(w.v === 1 && w.kind === 'thing' && w.data.x === 1, 'wrap 装上信封', JSON.stringify(w).slice(0, 60));
  ok(a.open(w, 'thing').x === 1, 'open 拆回原对象');
  ok(a.open(w, 'other') === null, '类型不符被拒绝');
  ok(a.open({ v: 99, kind: 'thing', data: {} }, 'thing') === null, '比当前版本新的档被拒绝（装回了旧客户端）');
  ok(a.open(null, 'thing') === null && a.open({ kind: 'thing' }, 'thing') === null, '没有档 / 没有 data 都返回 null 而不是抛');

  // 迁移链：v0 → v1 → v2
  const b = Envelope.create({ name: 'B', version: 2 });
  b.migration(0, d => ({ n: (d.n || 0) + 1 }));
  b.migration(1, d => ({ n: (d.n || 0) + 10 }));
  ok(b.open({ v: 0, kind: 'k', data: {} }, 'k').n === 11, 'v0 逐级升到 v2（0→1 加 1，1→2 加 10）');
  ok(b.open({ v: 1, kind: 'k', data: {} }, 'k').n === 10, 'v1 只跑一级');
  ok(b.migrationVersions().join(',') === '0,1', '迁移链可枚举', b.migrationVersions().join(','));

  const c = Envelope.create({ name: 'C', version: 3 });
  c.migration(0, d => d);
  const missing = c.open({ v: 1, kind: 'k', data: {} }, 'k');
  ok(missing === null && /缺少 v1/.test(c.lastError() || ''), '缺一级迁移 → 拒绝并说明是哪一级', c.lastError());

  const d2 = Envelope.create({ name: 'D', version: 1 });
  d2.migration(0, () => { throw new Error('boom'); });
  ok(d2.open({ v: 0, kind: 'k', data: {} }, 'k') === null && /boom/.test(d2.lastError() || ''),
    '迁移抛错 → 拒绝而不是让游戏起不来', d2.lastError());

  let dup = '';
  try { d2.migration(0, x => x); } catch (e) { dup = e.message; }
  ok(/已存在/.test(dup), '同一级迁移重复注册被拒绝（迁移链断裂最难查）', dup);

  // 关键新能力：两个域的版本与迁移链互不影响
  const e1 = Envelope.create({ name: 'E1', version: 5 });
  const e2 = Envelope.create({ name: 'E2', version: 1 });
  ok(e1.VERSION === 5 && e2.VERSION === 1 && e1.migrationVersions().length === 0,
    '两个域各有自己的版本号与迁移链（只改档案格式不必让存档跟着跨版本）');
  ok(e1.lastError !== e2.lastError, '两个域的失败原因各记各的');
}

/* ---------------- 2. 档案的加载与修复 ---------------- */
console.log('\n[2] 档案加载 / 损坏修复 / 落盘');
{
  const map = Object.create(null);
  Storage.use(Storage.memory(map));
  Storage.wipe();

  const r0 = Profile.init();
  ok(r0.loaded === false, '首次启动：没有档 → 用默认值', JSON.stringify(r0));
  ok(Profile.spores() === 0 && Profile.doneIds().length === 0, '默认档案是干净的');
  ok(Storage.get(Slots.key(Storage.KEYS.profile)) !== null, '首次启动就把默认档案落了盘');

  Profile.addSpores(30);
  ok(Profile.spores() === 30, '孢子写入内存');
  Profile.load();
  ok(Profile.spores() === 30, '重新加载后仍在（真的落盘了）');

  // 坏档：不是 JSON
  // ⚠ **连备份一起写坏**：`Slots.readJSON` 会在主键坏掉时**回退到备份**（那是崩溃安全
  // 的设计），所以只写坏主键的话读到的其实是上一份好档 —— 这条断言会红，
  // 而红的原因是"备份机制生效了"，不是"坏档没兜住"。
  Storage.set(Slots.key(Storage.KEYS.profile), '{ 这不是 json');
  Storage.set(Storage.backupKey(Slots.key(Storage.KEYS.profile)), 'oops');
  const r1 = Profile.load();
  ok(r1.loaded === false && r1.discarded === true && Profile.spores() === 0,
    '坏档 → 丢弃并回到默认值（不让游戏起不来）', JSON.stringify(r1));

  // 字段级修复：能修的修，坏值丢掉
  Storage.setJSON(Slots.key(Storage.KEYS.profile), {
    v: 1, at: Date.now(), kind: 'profile', data: {
      spores: -50,
      unlocked: { 'char:brawler': true, 'char:mage': 'yes' },
      codex: { 'weapon:axe': 2, 'weapon:sword': 99, 'item:coffee': 'x' },
      done: { reach_w2: true },
      perChar: { ranger: { runs: 3, kills: 'abc', bestWave: 7 }, junk: null }
    }
  });
  const r2 = Profile.load();
  ok(r2.loaded === true, '结构合法的档被读进来');
  ok(Profile.spores() === 0, '负数孢子被夹回 0', Profile.spores());
  ok(Profile.isUnlocked('char', 'brawler') === true, '合法解锁被保留');
  ok(Profile.isUnlocked('char', 'mage') === false, '值不是 true 的解锁被丢弃');
  ok(Profile.codexLevel('weapon', 'axe') === 2, '合法图鉴等级被保留');
  ok(Profile.codexLevel('weapon', 'sword') === 0, '越界图鉴等级（99）被丢弃');
  ok(Profile.codexLevel('item', 'coffee') === 0, '非数值图鉴等级被丢弃');
  ok(Profile.isDone('reach_w2') === true, '已完成挑战被保留');
  ok(Profile.perChar('ranger').runs === 3, '每角色记录被保留');
  ok(Profile.perChar('ranger').kills === 0, '每角色记录里的非数值字段归零', Profile.perChar('ranger').kills);
  ok(Profile.perChar('junk').runs === 0, '结构不对的每角色记录变成空记录');

  // 版本太新
  Storage.setJSON(Slots.key(Storage.KEYS.profile), { v: 99, kind: 'profile', data: { spores: 1 } });
  ok(Profile.load().loaded === false && /版本/.test(Profile.lastError() || ''),
    '档案版本比当前新 → 拒绝并说明', Profile.lastError());
}

/* ---------------- 3. 解锁 ---------------- */
console.log('\n[3] 解锁');
{
  Profile.reset();
  ok(Profile.isUnlocked('char', 'ranger') === false, '默认什么都没解锁（默认角色靠数据表的 locked 标记，不靠预置）');
  ok(Profile.unlock('char', 'brawler') === true, '第一次解锁返回 true');
  ok(Profile.unlock('char', 'brawler') === false, '重复解锁返回 false（界面不用自己去重）');
  Profile.unlock('weapon', 'axe');
  Profile.unlock('item', 'coffee');
  ok(Profile.unlockedIds('char').join(',') === 'brawler', '按家族取已解锁 id', Profile.unlockedIds('char').join(','));
  ok(Profile.unlockedIds('weapon').join(',') === 'axe', '家族之间不串（char:/weapon: 前缀隔离）');
}

/* ---------------- 4. 图鉴三态 ---------------- */
console.log('\n[4] 图鉴（见过 / 用过 / 满级过）');
{
  Profile.reset();
  ok(Profile.CODEX_SEEN === 1 && Profile.CODEX_USED === 2 && Profile.CODEX_MASTERED === 3, '三态常量', '1/2/3');
  ok(Profile.markCodex('weapon', 'axe', 1) === true, '第一次点亮返回 true');
  ok(Profile.markCodex('weapon', 'axe', 1) === false, '重复点亮同一级返回 false');
  ok(Profile.markCodex('weapon', 'axe', 2) === true, '只升不降：可以升级');
  ok(Profile.markCodex('weapon', 'axe', 1) === false && Profile.codexLevel('weapon', 'axe') === 2,
    '只升不降：低等级不会把记录打回去', Profile.codexLevel('weapon', 'axe'));
  Profile.markCodex('weapon', 'axe', 99);
  ok(Profile.codexLevel('weapon', 'axe') === 3, '越界等级被夹到最大', Profile.codexLevel('weapon', 'axe'));

  const st = Profile.codexStats('weapon');
  // **不写死件数**：从表里取。写死的话"加一把武器"就会红一条无关的测试，
  // 而那种红会让人养成"顺手改数字"的习惯 —— 那才是散落的开始。
  ok(st.total === Weapons.LIST.length, '按家族统计总数（武器 ' + Weapons.LIST.length + ' 件）', st.total);
  ok(st.mastered === 1 && st.used === 1 && st.seen === 1, '三态计数', JSON.stringify(st));
}

/* ---------------- 5. 孢子 ---------------- */
console.log('\n[5] 孢子（局外货币）');
{
  Profile.reset();
  const low = Profile.sporesForRun({ char: 'ranger', wave: 3, kills: 20, scrap: 40 });
  const high = Profile.sporesForRun({ char: 'ranger', wave: 15, kills: 400, scrap: 900 });
  ok(high > low * 3, '波次是主项：打得越久拿得越多', low + ' → ' + high);
  ok(Profile.sporesForRun(null) === 0 && Profile.sporesForRun({ char: 'x' }) === 0, '空输入返回 0');

  Profile.addSpores(50);
  ok(Profile.spendSpores(20) === true && Profile.spores() === 30, '够 → 扣掉');
  ok(Profile.spendSpores(1000) === false && Profile.spores() === 30, '不够 → 拒绝且不改状态', Profile.spores());
  ok(Profile.spendSpores(-5) === true && Profile.spores() === 30, '负数消费被当作 0（不会反向加钱）', Profile.spores());
}

/* ---------------- 6. 挑战表自身的合法性 ---------------- */
console.log('\n[6] 挑战表：指标名与解锁目标（静默故障的两大来源）');
{
  const ids = Challenges.LIST.map(c => c.id);
  ok(new Set(ids).size === ids.length, '挑战 id 不重复' + '（' + ids.length + ' 条）');
  // 分组数从表里取：加一个分组（比如 G5 的「隐藏」）不该让这条无关断言变红
  const groups = Challenges.groups();
  ok(groups.length === new Set(groups).size && groups.length >= 5,
    groups.length + ' 个分组：' + groups.join(' / '), groups.join(','));

  const badMetric = Challenges.LIST.filter(c => !Challenges.METRICS[c.metric]);
  ok(badMetric.length === 0,
    '每条挑战用的指标都在 METRICS 里（写错指标名 = 挑战永远不完成，界面上看不出来）',
    badMetric.map(c => c.id + ':' + c.metric).join(', '));

  const badNum = Challenges.LIST.filter(c => !(c.atLeast > 0));
  ok(badNum.length === 0, '每条阈值都是正数', badNum.map(c => c.id).join(','));

  // 这条是真被抓到过的 bug：角色挑战写 metric:'charBestWave'，
  // 而 valueOf 当时直接读 pc[def.metric] —— 指标名对了、字段名不对，挑战永远不完成。
  const charBad = Challenges.LIST.filter(c => c.char && !Challenges.CHAR_METRICS[c.metric]);
  ok(charBad.length === 0,
    '角色挑战的指标名都在 CHAR_METRICS 映射里（映射到 PerCharRecord 的字段）',
    charBad.map(c => c.id + ':' + c.metric).join(', '));
  const metricBad = Challenges.LIST.filter(c => !c.char && Challenges.CHAR_METRICS[c.metric]);
  ok(metricBad.length === 0, '非角色挑战不会误用角色指标',
    metricBad.map(c => c.id + ':' + c.metric).join(', '));

  const noUnlock = Challenges.LIST.filter(c => !c.unlock.length);
  ok(noUnlock.length === 0, '每条挑战都有解锁产物', noUnlock.map(c => c.id).join(','));

  const badTarget = [];
  for (const c of Challenges.LIST) {
    for (const u of c.unlock) {
      if (!Registry.has(u.family) || Registry.ids(u.family).indexOf(u.id) < 0) {
        badTarget.push(c.id + '→' + u.family + ':' + u.id);
      }
    }
  }
  ok(badTarget.length === 0, '每个解锁目标都真的存在（打错字会被审计抓到）', badTarget.join(', '));

  const badChar = Challenges.LIST.filter(c => c.char && !Registry.ids('char').includes(c.char));
  ok(badChar.length === 0, '角色挑战引用的角色都存在', badChar.map(c => c.id).join(','));

  const audit = Registry.audit();
  const inAudit = audit.problems.filter(p => p.family === 'challenge');
  ok(inAudit.length === 0, 'registry 审计对挑战家族也不报错',
    inAudit.slice(0, 3).map(p => p.id + '.' + p.field + '=' + p.value).join(', '));
}

/* ---------------- 7. 求值 ---------------- */
console.log('\n[7] 求值（纯函数：不碰存档）');
{
  const ctx = Challenges.context(
    { char: 'ranger', wave: 5, level: 7, kills: 120, scrap: 300, damage: 900, taken: 40, healed: 10, packs: 2, peaks: { maxWeapons: 6, maxHarvesting: 30 } },
    { runs: 3, wins: 0, bestWave: 6, bestKills: 200, bestLevel: 9, totalKills: 400, totalMaterials: 800 },
    { ranger: { runs: 3, kills: 400, scrap: 800, bestWave: 6, wins: 0, level: 9 } }
  );
  ok(ctx.flat.wave === 5 && ctx.flat.totalKills === 400, '摊平后的指标表同时含本局与累计', JSON.stringify(ctx.flat).slice(0, 80));
  ok(ctx.flat.maxWeapons === 6 && ctx.flat.maxHarvesting === 30, '峰值进了指标表');
  ok(ctx.flat.minHpWaveEnd === 0, '没有采样过换波生命 → 0（"只剩 1 点生命"不会被空值满足）');

  const byId = Challenges.BY_ID;
  ok(Challenges.valueOf(byId.reach_w2, ctx) === 5, '非角色挑战读 flat');
  ok(Challenges.valueOf(byId.char_brawler, ctx) === 0, '角色挑战读 perChar（没打过的角色为 0）');
  const ctx2 = Challenges.context({ char: 'brawler', wave: 9 }, {}, { brawler: { runs: 1, kills: 0, scrap: 0, bestWave: 9, wins: 0, level: 1 } });
  ok(Challenges.valueOf(byId.char_brawler, ctx2) === 9, '角色挑战读的是该角色的记录', Challenges.valueOf(byId.char_brawler, ctx2));

  const done = new Set(['reach_w2']);
  const fresh = Challenges.evaluate(ctx, id => done.has(id));
  const freshIds = fresh.map(c => c.id);
  ok(freshIds.indexOf('reach_w2') < 0, '已完成的不会重复返回');
  ok(freshIds.indexOf('kill_300') >= 0, '累计击杀 400 ≥ 300 → 完成');
  ok(freshIds.indexOf('gather_300') >= 0,
    '累计材料 800 也满足 300 → 一并返回（一次结算可以连过好几条）', freshIds.join(','));
  ok(freshIds.indexOf('reach_w4') >= 0 && freshIds.indexOf('extrem_full') >= 0,
    '本局波次与峰值同样参与求值', freshIds.join(','));

  const p = Challenges.progress(byId.kill_300, ctx, id => done.has(id));
  ok(p.value === 400 && p.atLeast === 300 && p.done === true, '进度对象给界面用', JSON.stringify(p));

  // 局外面板上，"单局达成"那类不画空进度条（局外读数永远是 0，画一条空的等于撒谎）
  ok(Challenges.progressKind(byId.kill_300) === 'account', '累计类 → account（可显示进度）',
    Challenges.progressKind(byId.kill_300));
  ok(Challenges.progressKind(byId.char_brawler) === 'char', '角色类 → char（读该角色记录）',
    Challenges.progressKind(byId.char_brawler));
  ok(Challenges.progressKind(byId.extrem_full) === 'run', '单局阈值类 → run（不画进度条）',
    Challenges.progressKind(byId.extrem_full));
  const kinds = Challenges.LIST.map(c => Challenges.progressKind(c));
  ok(kinds.every(k => k === 'account' || k === 'char' || k === 'run'), '每条都有明确的进度类型');
}

/* ---------------- 8. applyRun：一局并入档案 ---------------- */
console.log('\n[8] applyRun：并入一局（挑战 → 解锁 → 孢子 → 图鉴 → 每角色）');
{
  Profile.reset();
  const run = {
    char: 'ranger', wave: 5, level: 7, kills: 320, scrap: 400,
    damage: 900, taken: 40, healed: 10, packs: 2,
    weaponIds: ['pistol', 'knife'], itemIds: ['coffee'],
    masteredWeaponIds: ['hammer'], peaks: { maxWeapons: 6 }
  };
  const totals = { runs: 1, wins: 0, bestWave: 5, bestKills: 320, bestLevel: 7, totalKills: 320, totalMaterials: 400 };
  const rep = Profile.applyRun(run, totals);

  ok(rep.spores > 0, '拿到了孢子', rep.spores);
  ok(Profile.spores() === rep.spores, '孢子进了档案', Profile.spores());
  ok(rep.completed.some(c => c.id === 'reach_w2'), '完成"打到第 2 波"');
  ok(rep.completed.some(c => c.id === 'kill_300'), '完成"累计击杀 300"');
  ok(rep.unlocked.some(u => u.family === 'char' && u.id === 'brawler'), '解锁了角色 brawler',
    JSON.stringify(rep.unlocked));
  ok(Profile.isUnlocked('char', 'brawler') === true, '解锁落到了档案里');
  ok(Profile.codexLevel('weapon', 'pistol') === Profile.CODEX_USED, '带过的武器 → 图鉴"用过"');
  ok(Profile.codexLevel('weapon', 'hammer') === Profile.CODEX_MASTERED, '到顶层的武器 → 图鉴"满级过"');
  ok(Profile.perChar('ranger').runs === 1 && Profile.perChar('ranger').bestWave === 5, '每角色记录被更新',
    JSON.stringify(Profile.perChar('ranger')));

  // 重复并入同一局：挑战与解锁不重复报告（孢子按设计会再发一次 —— 那是"又打了一局"）
  const rep2 = Profile.applyRun(run, totals);
  ok(rep2.completed.length === 0, '同一局再并入不会重复"完成挑战"', rep2.completed.map(c => c.id).join(','));
  ok(rep2.unlocked.length === 0, '也不会重复"解锁"');
  ok(Profile.perChar('ranger').runs === 2, '但每角色对局数确实 +1（这是两局）');

  ok(Profile.applyRun(null, totals).spores === 0, '空输入不炸');
  const noChar = Profile.applyRun({ wave: 3 }, totals);
  ok(noChar.spores === 0, '没有角色 id 的输入被忽略（宁可不结算也不要写坏档案）');

  ok(Profile.writeOk() === true, '写盘成功');
}

/* ---------------- 9. 与存档/战绩的边界 ---------------- */
console.log('\n[9] 与 save / records 的边界');
{
  Profile.reset();
  Storage.wipe();
  Profile.init();
  Save.addRun({ win: true, wave: 4, level: 5, kills: 50, scrap: 60, damage: 1, taken: 1, healed: 1, charName: 'x', char: 'ranger', weapons: [], items: [], weaponIds: [], itemIds: [], masteredWeaponIds: [], masteredItemIds: [], stats: null, packs: 0, packSpent: 0 });
  const rec = Save.records();
  ok(rec.runs === 1 && rec.totalKills === 50, 'records 照旧工作（新增字段不影响它）', JSON.stringify(rec));

  const keys = Object.keys(Storage.KEYS).sort().join(',');
  ok(keys === 'profile,records,run,settings', '存储键共四把（新增 profile）', keys);

  Profile.clear();
  ok(Storage.get(Slots.key(Storage.KEYS.profile)) === null && Profile.spores() === 0, 'clear 把档案从存储与内存一起清掉');
}

console.log('\n=== 结果 ===');
if (failures === 0) { console.log('\x1b[32m全部通过 ✔\x1b[0m\n'); process.exit(0); }
console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m\n');
process.exit(1);
