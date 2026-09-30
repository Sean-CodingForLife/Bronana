/* =========================================================
   tutorial.mjs — 首局引导：时机 · 只说一次 · 落盘
   ---------------------------------------------------------
   这一套守四件事：
     · 提示挂的时机**真的存在**（挂错名字的提示永远不会出现，而且不报错）
     · 一条只说一次，且**看完就落盘**（不然每次开游戏都被同一句糊一次）
     · 开关关掉之后不弹，但记录不丢（关一下再开，不该把学过的东西忘掉）
     · 文案都在 i18n 表里（否则切英文之后这几句一直是中文）
   ========================================================= */
import { installDom } from './_ctx.mjs';
import { loadAll, SIM_MODULES } from './_load.mjs';

installDom();
await loadAll(SIM_MODULES);
const { Tutorial, I18n, Profile, Storage, Registry, SelfCheck } = globalThis;

let pass = 0, fail = 0;
function ok(cond, what, detail) {
  if (cond) { pass++; console.log('  PASS ' + what); }
  else { fail++; console.log('  FAIL ' + what + (detail === undefined ? '' : '  → ' + detail)); }
}

console.log('\n=== Bronana · 首局引导 ===\n');
Storage.wipe();

/* ---------------- [1] 表本身 ---------------- */
console.log('[1] 声明表');
{
  ok(Tutorial.LIST.length >= 5, '至少 5 条提示（太少等于没有引导）', Tutorial.LIST.length);
  const ids = Tutorial.LIST.map(h => h.id);
  ok(new Set(ids).size === ids.length, 'id 不重复', ids.join(','));
  ok(Tutorial.audit().ok, '定义期自检通过', JSON.stringify(Tutorial.audit().problems));
  /* 每个时机都有提示用它 —— 声明了时机却没人用 = 那条时机是装饰 */
  const whens = new Set(Tutorial.LIST.map(h => h.when));
  ok(Tutorial.whenNames().every(w => whens.has(w)),
    '每个声明的时机都有提示用它', Tutorial.whenNames().filter(w => !whens.has(w)).join(','));
  /* 文案必须在 i18n 表里，否则切英文之后这几句一直是中文 */
  const keys = Registry.ids('messageKey');
  const missing = Tutorial.LIST.filter(h => keys.indexOf(h.text) < 0).map(h => h.id);
  ok(missing.length === 0, '每条文案都进了 i18n 表（切英文时不会漏）', missing.join(','));
  ok(Tutorial.LIST.every(h => h.note && h.note.length > 4),
    '每条都写了"为什么要有它"（说不出理由的提示不该存在）');
}

/* ---------------- [2] 时机判据 ---------------- */
console.log('\n[2] 时机判据');
{
  Tutorial.forget();
  Tutorial.setEnabled(true);
  ok(Tutorial.pending('run-start').length === 1, 'run-start 时机有一条待说', Tutorial.pending('run-start').length);
  ok(Tutorial.pending('不存在的时机').length === 0, '不存在的时机返回空（不抛）', '');
  /* `pending` **不改状态** —— 问两次结果一样（调用点会每帧问） */
  ok(Tutorial.pending('run-start').length === 1, 'pending 可以重复问（它不改状态）');
  ok(Tutorial.isSeen('move') === false, '问过之后仍然"没说"（标记要显式做）');
  ok(Tutorial.mark('move') === true, 'mark 第一次返回 true');
  ok(Tutorial.mark('move') === false, 'mark 第二次返回 false（不会重复说）');
  ok(Tutorial.pending('run-start').length === 0, '说过之后这个时机没有待说了');
  ok(Tutorial.mark('不存在的id') === false, '标记一个不存在的 id 返回 false（不污染记录）');
  ok(Tutorial.forget() === true && Tutorial.seenCount() === 0, 'forget 清空记录');
}

/* ---------------- [3] 开关 ---------------- */
console.log('\n[3] 开关');
{
  Tutorial.forget();
  Tutorial.setEnabled(false);
  ok(Tutorial.pending('run-start').length === 0, '关掉之后不弹', Tutorial.pending('run-start').length);
  Tutorial.mark('move');
  Tutorial.setEnabled(true);
  ok(Tutorial.isSeen('move') === true, '关掉期间标记过的仍然记得（关不该丢记录）');
  ok(Tutorial.pending('run-start').length === 0, '重新打开不会把已经说过的再说一遍');
  /* force：设置页"再看一遍引导" */
  ok(Tutorial.pending('run-start', { force: true }).length === 1, 'force 能无视记录（给"再看一遍"用）');
  Tutorial.forget();
}

/* ---------------- [4] 落盘（与账号档案接入） ---------------- */
console.log('\n[4] 落盘');
{
  Storage.wipe();
  Profile.load();
  Tutorial.forget();
  ok(Profile.snapshot().tutorialSeen !== undefined, '账号档案里有 tutorialSeen 这个字段');

  Tutorial.mark('move');
  /* mark 会通知 profile 落盘 —— 于是"看过提示"这件事跟着这一份档走 */
  const raw = Storage.get(Storage.KEYS.profile);
  ok(raw !== null && /tutorialSeen/.test(raw), 'mark 之后档案落盘了（含 tutorialSeen）', String(raw && raw.slice(0, 80)));
  ok(/"move":true/.test(String(raw)), '落盘的内容里真的有这一条', String(raw && raw.slice(0, 200)).slice(-80));

  // 重新加载 → 记录还在（这是"只说一次"能跨进程成立的前提）
  Profile.load();
  ok(Tutorial.isSeen('move') === true, '重新加载档案之后记录还在', String(Tutorial.isSeen('move')));
  ok(Tutorial.seenCount() === 1, '记录数正确', Tutorial.seenCount());

  /* 坏值保护：档案里混进一个不存在的 id，重载时应当被丢掉 */
  const bad = JSON.parse(String(Storage.get(Storage.KEYS.profile)));
  bad.data.tutorialSeen = { move: true, '不存在的提示': true };
  Storage.set(Storage.KEYS.profile, JSON.stringify(bad));
  Profile.load();
  ok(Tutorial.seenCount() === 1, '坏 id 被丢掉（只留表里真有的）', Tutorial.seenCount());
  ok(Tutorial.isSeen('不存在的提示') === false, '不存在的 id 没有被记住');
}

/* ---------------- [5] i18n 接入 ---------------- */
console.log('\n[5] 与本地化接入');
{
  const h = Tutorial.LIST[0];
  const zh = I18n.t(h.text);
  ok(zh === h.text, '中文下取到的就是原文', zh.slice(0, 20));
  I18n.set('en');
  const en = I18n.t(h.text);
  ok(en !== h.text, '英文下真的换了（说明这句在表里）', en.slice(0, 30));
  ok(/[\x20-\x7e]/.test(en) && !/[\u4e00-\u9fff]/.test(en), '英文译文里没有中文残留', en);
  I18n.set('zh');
}

/* ---------------- [6] 注册与自检 ---------------- */
console.log('\n[6] 注册与自检');
{
  ok(Registry.ids('tutorialHint').length === Tutorial.LIST.length,
    '总账里的提示数与表一致', Registry.ids('tutorialHint').length);
  ok(SelfCheck.names().indexOf('Tutorial') >= 0, '自检登记进了启动期自检', '');
}

console.log('\n=== 结果 ===');
console.log('  ' + pass + ' 通过 · ' + (fail ? fail + ' \x1b[31m失败\x1b[0m' : '0 失败'));
console.log(fail ? '\n首局引导未通过 ✘\n' : '\n首局引导检查通过 ✔\n');
process.exit(fail ? 1 : 0);
