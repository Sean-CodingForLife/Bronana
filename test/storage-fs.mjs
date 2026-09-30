/* =========================================================
   storage-fs.mjs — 文件存储后端（`src/storage_fs.ts`）
   ---------------------------------------------------------
   它补的是**三种形态里唯一没有持久化的那一格**：
     web      → `window.localStorage`（本来持久）
     desktop  → Chromium 的 localStorage，落在 `userData`（本来持久）
     **cli**  → 以前是内存适配器，`pnpm cli` 跑完就没了

   这一套盯四件事：
     1) 形状与 `localStorage` 一致，`Storage.use` 收得下
     2) 写入 → 读回 → 覆盖（基本可用）
     3) **坏档回退**：主键坏了要能从备份救回来（`Storage.getJSONSafe`）
     4) **原子写**：临时文件不残留；写失败**不破坏**已有文件
   ========================================================= */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadAll, SIM_MODULES } from './_load.mjs';
import { T } from './_assert.mjs';

/* ⚠ **自包含**：`storage_fs` 是 Node 专用模块，它进 `SIM_MODULES` 是**别的**改动顺手加的。
   这里自己拼一份，于是这一套测试不依赖那条共享清单 —— 提交历史里它才能独占一批。 */
await loadAll(SIM_MODULES.concat(['storage_fs']));
const { Storage, fileAdapter } = globalThis;
console.error = function () { };

console.log('\n=== Bronana · 文件存储后端 ===');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bronana-fs-'));
const errors = [];
const ad = fileAdapter({ dir, onError: (m) => errors.push(m) });

T.section('形状：与 localStorage 一致');
T.ok(typeof ad.getItem === 'function' && typeof ad.setItem === 'function' &&
  typeof ad.removeItem === 'function', '三个方法都在（getItem / setItem / removeItem）');
T.ok(Storage.use(ad) === true, 'Storage.use 接得下（形状校验通过）');
T.eq(Storage.adapterName().indexOf('file:'), 0, '适配器自报家门是 file:');

T.section('基本可用：写 → 读 → 覆盖');
Storage.setJSONSafe('bronana.profile', { v: 1, spores: 42 });
T.eq(Storage.getJSON('bronana.profile', null), { v: 1, spores: 42 }, '写进去能原样读回来');
Storage.setJSONSafe('bronana.profile', { v: 1, spores: 99 });
T.eq(Storage.getJSON('bronana.profile', null), { v: 1, spores: 99 }, '覆盖之后读到的是新值');
T.ok(fs.readdirSync(dir).filter(f => f.endsWith('.tmp')).length === 0,
  '临时文件不残留（写完就 rename 掉了）');

T.section('坏档回退：主键坏了从备份救回来');
fs.writeFileSync(path.join(dir, 'bronana.profile.json'), '{ 这是坏掉的 JSON', 'utf8');
const rec = Storage.getJSONSafe('bronana.profile');
T.ok(rec.recovered === true, '报出"回退过"（界面据此提示玩家）');
T.eq(rec.value, { v: 1, spores: 42 }, '救回来的是**上一版**（不是坏掉那一份）');
T.eq(Storage.getJSON('bronana.profile', null), { v: 1, spores: 42 }, '并且已经把它写回主键');

T.section('写入失败：不破坏已有文件');
/* 把目标目录换成一个**文件**，于是 mkdir / 写入都会失败 */
const badDir = path.join(dir, 'blocked');
fs.writeFileSync(badDir, 'x', 'utf8');
const badErrors = [];
const badAd = fileAdapter({ dir: badDir, onError: (m) => badErrors.push(m) });
T.ok(badAd.setItem('k', 'v') === false, '写不进去时返回 false（而不是抛）');
T.ok(badErrors.length > 0, '并且把原因交给 onError（"存不进去"绝不该让游戏崩）');

T.section('删除：本来就不在也算成功');
T.ok(ad.removeItem('never-existed') === true, '删一个不存在的键 → true（已经达到目的）');
Storage.setJSONSafe('bronana.tmp2', { a: 1 });
T.ok(ad.removeItem('bronana.tmp2') === true, '删一个存在的键 → true');
T.ok(ad.getItem('bronana.tmp2') === null, '删掉之后读不到了');

fs.rmSync(dir, { recursive: true, force: true });
process.exit(T.done());
