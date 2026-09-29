/* =========================================================
   生成 v1 → v2 迁移的测试夹具
   ---------------------------------------------------------
   为什么要有**真的** v1 存档文本：迁移链的价值全在"用旧版本的档启动"
   这件事上，而合成一个假 v1 只能证明"我写的迁移函数对假数据有效"。
   这里在迁移注册**之前**（也就是代码还是 v1 语义时）导出一份真实存档，
   存成夹具，之后永远用它验。

   用法： node tools/make-migration-fixture.mjs
   ⚠ 只有在"当前版本是 1"时才能跑出正确的夹具；升到 v2 之后这个脚本
   会被自己的前置检查挡住（防止有人后来重跑它、把夹具重新生成成 v2）。
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { installDom } from '../test/_ctx.mjs';
import { loadAll, SIM_MODULES } from '../test/_load.mjs';

installDom();
await loadAll(SIM_MODULES);
const { Game, Save, Storage, Slots } = globalThis;

if (Save.VERSION !== 1) {
  console.error('当前存档版本是 v' + Save.VERSION + '，不是 1 —— 夹具只能从 v1 生成。');
  console.error('（这个检查是刻意的：重跑这个脚本会把夹具覆盖成新版，那它就失去意义了）');
  process.exit(1);
}

/* 打一局，走到"商店里"（存档点在那里），再导出 */
const s = Game.newRun('ranger', 20240922, 1, null, null);
Game.setState('playing');
for (let i = 0; i < 1200; i++) Game.step(Game.cfg.fixedDt, { x: 1, y: 0 });
Game.setState('shop');
const payload = Game.exportRun();
if (!payload) { console.error('exportRun 返回 null'); process.exit(1); }

/* 造一份"真的像 v1"的据点字段：v1 是**一个数字** */
payload.keep = 3;

const envelope = { v: 1, at: 1700000000000, kind: 'run', data: payload };
const out = path.join(import.meta.dirname, '..', 'test', 'fixtures', 'run-v1.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(envelope, null, 1) + '\n');

console.log('写出 ' + path.relative(path.join(import.meta.dirname, '..'), out));
console.log('  v = ' + envelope.v + ' · kind = ' + envelope.kind);
console.log('  char=' + payload.char + ' seed=' + payload.seed + ' wave=' + payload.wave +
  ' level=' + payload.level + ' scrap=' + payload.scrap +
  ' weapons=' + payload.weapons.length + ' keep=' + JSON.stringify(payload.keep));
