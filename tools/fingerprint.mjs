/* =========================================================
   fingerprint.mjs — 模拟层"行为指纹"
   重构前后最怕的不是报错，而是"悄悄跑出不一样的对局"。
   这个工具用固定种子跑几段固定长度的对局，把状态压成一个哈希：
   位置/血量/等级/材料/场上各种对象数量/武器与道具清单。

   用途：
     · 先跑一次记下指纹 → 做纯结构重构（抽模块、换注册表）→ 再跑一次比对；
     · test/smoke.mjs 里有一条断言钉住同样的指纹，重构动了行为就会红。

   注意：指纹对"随机数消费顺序"极其敏感 —— 这正是我们要的，
   因为把一次 rnd() 挪到别处同样是行为变化。
   用法： node tools/fingerprint.mjs
   ========================================================= */
import { loadAll, SIM_MODULES } from '../test/_load.mjs';

await loadAll(SIM_MODULES);
const { Game } = globalThis;
const FIXED = Game.cfg.fixedDt;

function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

export function runCase(charId, seed, wave, frames) {
  Game.newRun(charId, seed);
  /* 房间制：先挪进一间**会刷怪的**房再开波。
     入口间是安全房（budgetMul = 0），在它里面 startWave 会得到一片空场 ——
     那样指纹就只剩"空场地里走 1800 帧"，等于把这一段测废了。 */
  const s0 = Game.getSession();
  const fight = s0.map ? s0.map.rooms.find(r => r.type === 'fight') : null;
  if (fight) Game._internals.warpTo(fight.id);
  Game._internals.startWave(wave);
  for (let i = 0; i < frames; i++) {
    if (Game.state === 'playing') Game.step(FIXED, Game.autoInput(i * FIXED));
    else if (Game.state === 'levelup') Game.chooseLevelCard(0);
    else if (Game.state === 'shop') Game.nextWave();
    else break;
  }
  const s = Game.getSession();
  const pos = [];
  const bag = (arr, pick) => { for (const o of arr) pos.push(pick(o)); };
  bag(s.enemies, e => [e.x, e.y, e.hp, e.vx, e.vy].map(v => v.toFixed(2)).join(','));
  bag(s.bullets, b => [b.x, b.y, b.life].map(v => v.toFixed(2)).join(','));
  bag(s.ebullets, b => [b.x, b.y, b.a !== undefined ? b.a : 0].map(v => v.toFixed(2)).join(','));
  bag(s.pickups, p => [p.x, p.y, p.kind].join(','));
  bag(s.decals, d => [d.x, d.y, d.r].map(v => v.toFixed(1)).join(','));

  const parts = [
    Game.state, Game.wave, s.player.level, s.player.xp, s.player.hp, s.player.scrap,
    s.stats_total ? s.stats_total.kills : 0, s.enemies.length, s.bullets.length,
    s.ebullets.length, s.pickups.length, s.particles.length, s.decals.length,
    s.player.weapons.map(w => w.id).join('+'),
    s.player.items.map(i => i.def.id).join('+'),
    pos.join(';')
  ];
  return { text: parts.join('|'), hash: fnv(parts.join('|')) };
}

const CASES = [
  ['ranger', 20240922, 5, 1800],
  ['gladiator', 777, 9, 1800],
  ['engineer', 4242, 13, 1200]
];

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  console.log('=== 模拟层行为指纹 ===');
  for (const [c, seed, wave, frames] of CASES) {
    const r = runCase(c, seed, wave, frames);
    console.log('  ' + c.padEnd(10) + 'seed ' + String(seed).padEnd(9) + 'wave ' + String(wave).padEnd(3) +
      frames + ' 帧  →  ' + r.hash);
  }
}
