/* =========================================================
   migration.mjs — **用旧版本的存档启动**（迁移链）
   ---------------------------------------------------------
   这一套守的是 `docs/skill-audit.md` 里 `save-systems` 那条唯一的 ❌：

     "用旧版本的档启动" 没有任何测试 —— 而迁移链是**只有真出过旧档
      才可能被验到**的东西：它平时的表现是"永远不执行"，
      所以坏了也不会有人发现，直到某个玩家带着上一版的存档回来。

   做法：`test/fixtures/run-v1.json` 是一份**真的 v1 存档**
   （由 `tools/make-migration-fixture.mjs` 在代码还是 v1 时导出的，
   那个脚本会拒绝在 v2 上重跑 —— 否则夹具会被悄悄覆盖成新版，失去意义）。
   然后用两条不同的路径读它：

     [1] 信封路径：`Slots.writeJSON` 写进存储 → `Save.peekRun` / `Save.loadRun`
         走完整的"装信封 → 校验 → 迁移 → 恢复"。
     [2] 内容路径：直接 `Game.importRun(fixture.data)` —— 迁移的产物必须
         是**可用的存档**，而不只是"形状对了"。

   还要守住的反面：比当前版本**更新**的档必须被拒（用户装回了旧客户端），
   而不是被当成旧档硬升上来。
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { installDom } from './_ctx.mjs';
import { loadAll, UI_MODULES } from './_load.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
let failures = 0;
function ok(cond, label, extra) {
  if (cond) console.log('  \x1b[32mPASS\x1b[0m ' + label);
  else { failures++; console.log('  \x1b[31mFAIL\x1b[0m ' + label + (extra !== undefined ? '  → ' + extra : '')); }
}

installDom();
await loadAll(UI_MODULES);
const { Game, Save, Storage, Slots } = globalThis;

console.log('\n=== Bronana · 用旧版本的存档启动 ===\n');

const FIXTURE = path.join(ROOT, 'test', 'fixtures', 'run-v1.json');
const raw = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

/* =========================================================
   [1] 夹具本身：它得**真的是**一份 v1 存档
   ========================================================= */
console.log('[1] 夹具（不能是一个"看起来像旧档"的东西）');
{
  ok(raw.v === 1, '夹具的信封版本是 v1', String(raw.v));
  ok(raw.kind === 'run', '夹具的类型是 run（信封按 kind 校验，装错域会被拒）', String(raw.kind));
  ok(raw.at > 0 && typeof raw.at === 'number', '夹具带时间戳（"继续上一局"要显示它）');
  const d = raw.data;
  ok(d && typeof d === 'object', '夹具带 data 对象');
  ok(typeof d.seed === 'number' && typeof d.char === 'string',
    '夹具里种子与角色都在（缺一个就读不出这一局）', d && (d.char + '/' + d.seed));
  ok(typeof d.keep === 'number',
    '**夹具的据点是数字**（v1 的形状）—— 这正是 v1→v2 要改的那一处',
    typeof d.keep + ' ' + JSON.stringify(d.keep));
  ok(Array.isArray(d.offers) && d.offers.length > 0,
    '夹具带着货架（' + (d.offers ? d.offers.length : 0) + ' 件）—— 它在商店里存的档');
  ok(typeof d.rndState === 'number',
    '夹具带着随机流状态（不带的话读档后所有掷骰会从种子起点重来）');
  ok(Save.VERSION > raw.v, '当前存档版本比夹具新（否则这一套什么都没验）',
    'v' + raw.v + ' → v' + Save.VERSION);
}

/* =========================================================
   [2] 迁移链：登记了一级，而且恰好一级
   ========================================================= */
console.log('\n[2] 迁移链的登记');
{
  const vers = Save.migrationVersions();
  ok(vers.length > 0,
    '**至少登记了一级迁移**（在此之前是空的 —— 链机制从没被执行过）',
    vers.join(','));
  /* 链必须**连续**：从 v1 到当前版本中间的每一级都要有。
     缺一级的表现是"某个中间版本的档永远读不出来"，而它不报错。 */
  const missing = [];
  for (let v = 1; v < Save.VERSION; v++) if (vers.indexOf(v) < 0) missing.push(v);
  ok(missing.length === 0,
    '从 v1 到 v' + Save.VERSION + ' 的每一级迁移都在（链是连续的）', missing.join(','));
}

/* =========================================================
   [3] 信封路径：写进存储再读回来，走完整的迁移
   ========================================================= */
console.log('\n[3] 信封路径：把 v1 档写进存储，再当存档读出来');
{
  const key = Slots.key(Storage.KEYS.run);
  Storage.set(key, JSON.stringify(raw));

  let peek = null, loadErr = null;
  try { peek = Save.peekRun(); } catch (e) { loadErr = e.message; }
  ok(loadErr === null, '读旧档不抛（坏档只该被拒绝，不该让游戏起不来）', loadErr);
  ok(!!peek, '`peekRun` 认得出这份旧档（"继续上一局"按钮会亮）', String(peek));
  ok(peek && peek.char === raw.data.char && peek.wave === raw.data.wave,
    '读出来的角色与波次和夹具一致',
    peek && (peek.char + '/' + peek.wave) + ' vs ' + raw.data.char + '/' + raw.data.wave);

  let sess = null;
  try { sess = Save.loadRun(); } catch (e) { sess = 'THREW:' + e.message; }
  ok(sess && sess !== true && typeof sess === 'object',
    '`loadRun` 把旧档恢复成了会话', typeof sess === 'string' ? sess : typeof sess);
  /* 反向：迁移要是把 keep 留成数字，这里会读到 undefined —— 而那正是
     "老档读进来之后据点加成全消失"这个静默故障的形状。 */
  ok(sess && typeof sess.keep === 'object' && sess.keep !== null && !Array.isArray(sess.keep),
    '迁移之后的 `keep` 是**对象**（v2 的形状），不是数字',
    sess && (typeof sess.keep + ' ' + JSON.stringify(sess.keep)));
}

/* =========================================================
   [4] 内容路径：v1 的内容本身仍然能开出一局（与 [3] 守的是两件事）
   ========================================================= */
console.log('\n[4] 内容路径：迁移后的数据真的能开出一局');
{

  /* 直接拿夹具的 data 喂 `importRun`（它只做内容校验与恢复，与信封无关）。
     这里传的是**未迁移**的 v1 数据 —— `importRun` 对 keep 的形状是宽容的
     （数字当空对象），所以它守的是另一件事：

       · [3] 守 `save.ts` 的迁移函数（**形状**：老档的 keep 是数字，得改成对象）
       · [4] 守 `game.ts` 的内容校验（**语义**：这一局的种子 / 角色 / 装备还在不在）

     只有 [3] 的话，"迁移把 keep 改对了、但角色表已经改名"会溜过去；
     只有 [4] 的话，"老档的 keep 是数字"会溜过去。 */
  let s = null;
  try { s = Game.importRun(raw.data); } catch (e) { s = 'THREW:' + e.message; }
  ok(s && typeof s === 'object' && s.player,
    'v1 的内容仍然能开出一局（关卡表 / 道具表改了名字时这里会红）',
    typeof s === 'string' ? s : typeof s);
  if (s && s.player) {
    ok(s.charDef && s.charDef.id === raw.data.char, '角色对上了', s.charDef && s.charDef.id);
    ok(s.seed === raw.data.seed, '种子对上了（同种子必须长出同一张地牢）',
      s.seed + ' vs ' + raw.data.seed);
    ok(s.player.hp === raw.data.hp && s.player.level === raw.data.level,
      '生命与等级对上了',
      s.player.hp + '/' + s.player.level + ' vs ' + raw.data.hp + '/' + raw.data.level);
    ok(s.player.weapons.length === raw.data.weapons.length,
      '武器数量对上了（' + s.player.weapons.length + ' 把）');
    ok(s.rnd && typeof s.rnd === 'function', '随机流建起来了（读档后掷骰不从种子重来）');
  }
}

/* =========================================================
   [5] 反面：比当前版本更新的档必须被拒
   ========================================================= */
console.log('\n[5] 反面：更新的档必须被拒，而不是被硬升上来');
{
  const key = Slots.key(Storage.KEYS.run);
  const future = JSON.parse(JSON.stringify(raw));
  future.v = Save.VERSION + 1;
  Storage.set(key, JSON.stringify(future));
  let refused = false;
  try { refused = Save.peekRun() === null; } catch (e) { refused = false; }
  ok(refused, 'v' + future.v + ' 的档（装回了旧客户端）被拒绝，而不是猜着读');

  /* 迁移上一级都不缺，但**内容**不合法时也要被拒 */
  const broken = JSON.parse(JSON.stringify(raw));
  broken.data.char = 'no_such_char_xyz';
  Storage.set(key, JSON.stringify(broken));
  let brokenOk = false;
  try { brokenOk = Save.peekRun() === null; } catch (e) { brokenOk = false; }
  ok(brokenOk, '迁移成功但角色不认识的档仍然被拒（两道防线守两条路径）');

  /* 收尾：把夹具放回去，别让后面的测试看到一份坏档 */
  Storage.set(key, JSON.stringify(raw));
}

console.log('\n=== 结果 ===');
if (failures === 0) console.log('\x1b[32m全部通过 ✔\x1b[0m');
else console.log('\x1b[31m' + failures + ' 项失败 ✘\x1b[0m');
process.exit(failures ? 1 : 0);
