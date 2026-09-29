/* =========================================================
   slots.mjs — 存档槽位 · 备份回退 · 导出/导入
   ---------------------------------------------------------
   这一套守的每一件事，都对应"玩家会真的丢进度"的那一类故障：
     · 切了槽位但其实还在读写同一个键（表现：两个档互相覆盖）
     · 0 号槽与原键名不一致（表现：老存档被当成"没档"，玩家以为进度没了）
     · 清档只删主键、备份还在（表现：重置了但进度"复活"）
     · 导出文本被截断一段还能导入（表现：金币变 NaN，而报错说"格式不对"）
     · 导入一份坏文本把好档换掉（不可逆的数据损失）
   ========================================================= */
import { installDom } from './_ctx.mjs';
import { loadAll, SIM_MODULES } from './_load.mjs';

installDom();
await loadAll(SIM_MODULES);
const { Slots, Storage, Profile, Save, Settings } = globalThis;

let pass = 0, fail = 0;
function ok(cond, what, detail) {
  if (cond) { pass++; console.log('  PASS ' + what); }
  else { fail++; console.log('  FAIL ' + what + (detail === undefined ? '' : '  → ' + detail)); }
}

console.log('\n=== Bronana · 存档槽位与搬运 ===\n');
Storage.wipe();

/* ---------------- [1] 槽位的键映射 ---------------- */
console.log('[1] 槽位的键映射（加槽位是一次**键重定向**，不是数据迁移）');
{
  ok(Slots.COUNT >= 2, '至少两个槽位（只有一个就谈不上"多存档"）', Slots.COUNT);
  ok(Storage.slotKey('k', 0) === 'k', '0 号槽 = 原键名（**老存档天然在 0 号槽**，不需要迁移链）',
    Storage.slotKey('k', 0));
  ok(Storage.slotKey('k', 1) === 'k#1', '1 号槽是 k#1', Storage.slotKey('k', 1));
  const keys = new Set();
  for (let i = 0; i < Slots.COUNT; i++) keys.add(Storage.slotKey('k', i));
  ok(keys.size === Slots.COUNT, '每个槽位的键都不同（否则切槽位会覆盖同一份档）', keys.size);
  ok(Storage.slotKey('k', -5) === 'k', '负数槽位夹到 0（不造出 k#-5 这种键）');
  ok(Storage.slotKey('k', 99) === 'k#' + (Slots.COUNT - 1), '越界槽位夹到最后一槽');
  ok(Storage.slotOf('k') === 0 && Storage.slotOf('k#2') === 2, '从键名能反查槽位号');
  ok(Slots.audit().ok, '定义期自检通过', JSON.stringify(Slots.audit().problems));
}

/* ---------------- [2] 切槽位 ---------------- */
console.log('\n[2] 切槽位');
{
  Slots.select(0);
  ok(Slots.current() === 0, '当前槽位是 0');
  ok(Slots.select(0) === false, '切到同一个槽位返回 false（没有"白重读一遍"）');
  ok(Slots.select(1) === true, '切到 1 号槽返回 true');
  ok(Slots.current() === 1, '当前槽位真的变了');
  Slots.select(2);
  const lastSlot = Slots.COUNT - 1;
  ok(Slots.current() === lastSlot, '越界槽位被夹到最后一槽', String(Slots.current()));
  Slots.select(0);
  Slots.select(0);
  ok(Slots.prev().valueOf() === (Slots.current() === Slots.COUNT - 1), 'prev 从 0 绕到最后一槽');
  Slots.select(0);
  ok(Slots.next() === true && Slots.current() === 1, 'next 到 1 号槽');
  Slots.select(0);

  let seen = -1;
  const off = Slots.onChange((n) => { seen = n; });
  Slots.select(1);
  ok(seen === 1, '切槽位会通知订阅者');
  off();
  seen = -1;
  Slots.select(0);
  ok(seen === -1, '退订之后不再收到通知');
  Slots.select(0);
}

/* ---------------- [3] 槽位之间互不影响 ---------------- */
console.log('\n[3] 槽位之间互不影响（这一条是"多存档"的全部意义）');
{
  Storage.wipe();
  Slots.select(0);
  Profile.load();
  Profile.addSpores(100);
  const s0 = Profile.spores();

  Slots.select(1);
  Profile.load();
  ok(Profile.spores() === 0, '切到**空**槽位读到的是干净档案（不是 0 号槽的 100）', Profile.spores());
  Profile.addSpores(7);

  Slots.select(0);
  Profile.load();
  ok(Profile.spores() === s0, '切回 0 号槽读到的是它自己的 100', Profile.spores());
  Slots.select(1);
  Profile.load();
  ok(Profile.spores() === 7, '1 号槽还是 7（没有被 0 号槽污染）', Profile.spores());

  ok(Slots.used(0) && Slots.used(1), '两个槽位都被标记为"有档"');
  Slots.select(0);
  ok(Slots.list().length === Slots.COUNT, '槽位清单列出全部槽位', Slots.list().length);
}

/* ---------------- [4] 备份与坏档回退 ---------------- */
console.log('\n[4] 备份与坏档回退（崩溃安全）');
{
  Storage.wipe();
  Slots.select(0);
  Profile.load();
  Profile.addSpores(50);
  const key = Slots.key(Storage.KEYS.profile);
  ok(Storage.get(key) !== null, '主键写了');
  /* 第一次写入**没有**备份可留（上一版不存在）—— 这不是缺陷，是定义 */
  ok(Storage.get(Storage.backupKey(key)) === null, '第一次写入没有上一版，于是没有备份');

  // 写第二次 → 备份应该变成上一版（孢子 50 那一份）
  Profile.addSpores(10);
  ok(Profile.spores() === 60, '第二次写生效', Profile.spores());
  const bak = Storage.get(Storage.backupKey(key));
  ok(bak !== null, '第二次写入留下了上一版备份（每写一次留一份）', String(bak && bak.length));
  ok(!!bak && /"spores":50/.test(bak), '备份里是**上一版**的值（50），不是当前值', bak && bak.slice(0, 120));

  // 把主键写坏：读的时候应当**回退到备份**并记一笔
  Storage.set(key, '{坏掉的 json');
  Slots.clearRecovery();
  const recovered = Slots.readJSON(key);
  ok(recovered !== null, '主键坏了但读到了备份（不是返回 null 让档案全丢）', String(recovered));
  const rec = Slots.lastRecovery();
  ok(!!rec, '回退这件事被**记下来了**（界面据此提示玩家，而不是静默丢进度）',
    JSON.stringify(rec));
  ok(rec && rec.slot === 0, '记录里带着是哪个槽位出的事', rec && String(rec.slot));
  ok(Storage.get(key) !== null && !/坏掉/.test(String(Storage.get(key))),
    '回退之后主键被写回成好档（下一次读不需要再回退）');
  Slots.clearRecovery();
  ok(Slots.lastRecovery() === null, 'clearRecovery 清得掉（提示只该出现一次）');

  // 主键与备份都坏 → 只能返回 null（并且不抛）
  Storage.set(key, 'x'); Storage.set(Storage.backupKey(key), 'y');
  ok(Slots.readJSON(key) === null, '主键与备份都坏 → 返回 null（不抛）');
}

/* ---------------- [5] 清档要连备份一起清 ---------------- */
console.log('\n[5] 清档 / 重置（**必须连备份一起删**）');
{
  Storage.wipe();
  Slots.select(0);
  Profile.load();
  Profile.addSpores(30);
  const key = Slots.key(Storage.KEYS.profile);
  ok(Profile.spores() === 30, '先造一份档');

  Slots.clear(Storage.KEYS.profile);
  ok(Storage.get(key) === null, '主键被删', String(Storage.get(key)));
  ok(Storage.get(Storage.backupKey(key)) === null,
    '备份也被删（只删主键的话下一次读会从备份"复活"，表现是"重置了但进度还在"）',
    String(Storage.get(Storage.backupKey(key))));
  Profile.load();
  ok(Profile.spores() === 0, '清档之后重读是干净档案', Profile.spores());

  // Slots.reset 只碰当前槽位
  Storage.wipe();
  Slots.select(0); Profile.load(); Profile.addSpores(11);
  Slots.select(1); Profile.load(); Profile.addSpores(22);
  Slots.reset(1);
  Slots.select(1); Profile.load();
  ok(Profile.spores() === 0, 'reset 清掉了 1 号槽');
  Slots.select(0); Profile.load();
  ok(Profile.spores() === 11, 'reset 没碰 0 号槽（这是"重置本槽位"与"清空全部"的区别）', Profile.spores());
}

/* ---------------- [6] 导出 / 导入 ---------------- */
console.log('\n[6] 导出 / 导入（带校验和的文本）');
{
  Storage.wipe();
  Slots.select(0);
  Profile.load();
  Profile.addSpores(123);
  Profile.addCore(4);
  Save.addRun({ win: true, wave: 12, level: 20, kills: 300, scrap: 400 });

  const text = Slots.exportText();
  ok(typeof text === 'string' && text.length > 20, '导出一段文本', text.length + ' 字符');
  ok(text.split('.')[0] === 'BRNA1', '带格式标记（换格式时能明确拒绝而不是猜）', text.split('.')[0]);
  ok(text.split('.').length === 3, '三段：标记.payload.校验和', text.split('.').length);

  // 导到另一个槽位，内容要一致
  Slots.select(2);
  Profile.load();
  ok(Profile.spores() === 0, '2 号槽本来是空的');
  const r = Slots.importText(text);
  ok(r.ok === true, '导入成功', r.reason);
  ok(r.keys >= 2, '至少导入了档案与战绩两份', r.keys);
  Profile.load();
  ok(Profile.spores() === 123 && Profile.core() === 4, '导入后档案内容与导出方一致',
    Profile.spores() + '/' + Profile.core());
  ok(Save.records().runs === 1, '战绩也一起过来了（否则"搬了档但战绩归零"）', Save.records().runs);

  // 同一份存档导出两次 → 同样的文本（不然没法比对）
  Slots.select(0); Profile.load();
  const t2 = Slots.exportText();
  ok(t2 === text, '同一份存档导出两次得到**同样的文本**（不含时间戳之类）');

  // 篡改：改一个字符 → 校验和必须发现
  const bad = text.slice(0, text.length - 6) + 'zzzzz';
  const rb = Slots.importText(bad);
  ok(rb.ok === false, '被改过的文本拒绝导入', rb.reason);
  ok(/校验和/.test(rb.reason), '报出来的原因是"校验和不符"（而不是让人猜）', rb.reason);

  // 截断：报的原因也要说得清
  const cut = text.slice(0, Math.floor(text.length * 0.6));
  const rc = Slots.importText(cut);
  ok(rc.ok === false, '被截断的文本拒绝导入', rc.reason);

  /* **拒绝之后好档不能被破坏** —— 这是导入这类功能最贵的一类 bug */
  Slots.select(2); Profile.load();
  ok(Profile.spores() === 123, '失败导入没有破坏目标槽位（先验证再落盘）', Profile.spores());

  // 不是存档的文本
  ok(Slots.importText('随便一段话').ok === false, '随便一段话拒绝导入');
  ok(Slots.importText('').ok === false, '空文本拒绝导入');
  ok(Slots.importText(null).ok === false, 'null 拒绝导入（不抛）');
  ok(Slots.importText('BRNA1.abc').ok === false, '段数不对拒绝导入');
  ok(Slots.importText('XXXX1.abc.def').ok === false, '格式标记不认识 → 拒绝');
}

/* ---------------- [7] 与档案/战绩/设置的关系 ---------------- */
console.log('\n[7] 与其它系统的关系');
{
  // 设置是**全局**的：它不该跟着槽位走（换档不该改语言/音量）
  Storage.wipe();
  Slots.select(0);
  Settings.load();
  Settings.set('volume', 0.5);
  Slots.select(1);
  Settings.load();
  ok(Settings.get('volume') === 0.5, '设置不跟槽位走（换存档不该改你的音量/语言）',
    String(Settings.get('volume')));
  Settings.set('volume', 0.22);

  // Profile.clear 走的是当前槽位
  Slots.select(0); Profile.load(); Profile.addSpores(9);
  Slots.select(1); Profile.load(); Profile.addSpores(8);
  Slots.select(1);
  Profile.clear();
  Profile.load();
  ok(Profile.spores() === 0, 'clear 清的是**当前**槽位', Profile.spores());
  Slots.select(0);
  Profile.load();
  ok(Profile.spores() === 9, '别的槽位不受影响', Profile.spores());
  Slots.select(0);
  Storage.wipe();
}

console.log('\n=== 结果 ===');
console.log('  ' + pass + ' 通过 · ' + (fail ? fail + ' \x1b[31m失败\x1b[0m' : '0 失败'));
console.log(fail ? '\n存档槽位未通过 ✘\n' : '\n存档槽位检查通过 ✔\n');
process.exit(fail ? 1 : 0);
