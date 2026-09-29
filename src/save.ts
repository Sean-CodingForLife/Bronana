/* =========================================================
   save.ts — 存档系统

    三样东西分开存（同一个存储适配器，互不牵连）：
      · 设置        settings.ts 自己管
      · 进行中的一局 `bronana.run`      —— 刷新/切后台回来能接着打
      · 战绩记录     `bronana.records`  —— 跨局的累计（最好波次/总击杀/局数）
      （账号级档案 `bronana.profile` 在 profile.ts，用它自己的版本号与迁移链）

    分工：**玩法层自己负责"一局怎么序列化"**（`Game.exportRun/importRun`），
    本模块只负责"信封、版本、校验、损坏兜底"。
    这样存档格式跟着玩法走，而存储层的规矩（版本不符就拒绝、坏数据绝不让游戏起不来）
    只有一份 —— 信封与迁移链的机制在 envelope.ts，档案那边复用同一份。
    ========================================================= */

import { Envelope } from './envelope.ts';
import { Game } from './game.ts';
import { Slots } from './slots.ts';
import { Storage } from './storage.ts';

var Save = {} as SaveApi;

/**
 * 信封机制共用，但**版本号与迁移链是本域自己的**：
 * 只改档案格式时不必让 run/records 跟着一起跨版本。
 * 约定见 envelope.ts：`migration(from, fn)` 把 from 版的 data 改成 from+1 版。
 */
var env = Envelope.create({ name: 'save', version: 2 });

/* =========================================================
   v1 → v2：把据点等级写成**对象**而不是数字
   ---------------------------------------------------------
   v1 的 `keep` 是"据点一共几级"这一个数字（早期据点只有一条升级线）。
   后来据点变成"多个设施各几级"，`Stronghold.modsFor(owned)` 要的是一个
   `{ 设施id: 等级 }` 映射 —— 于是新存档写的是对象，而**所有 v1 存档**里
   那个数字在新代码里含义完全不同：`levelOf(3, id)` 读出 `undefined`，
   表现是"读档之后据点加成全部消失"，而且不报错。

   迁移做的事：认形状。数字（v1）→ `{}`（这一局的据点修正归零）。
   为什么不能"把数字猜成某个设施几级"：那个数字说不出是哪座设施，
   猜错会**凭空送出一份加成**；而归零只是"这一局没有据点加成"，
   与"老档本来就没有多设施据点"这个事实一致。

   ⚠ 这一级迁移存在之后，`importRun` 里那条"形状不对就当空"的守卫
   **保留不删**：迁移管的是"从信封读进来的老档"，而 `importRun` 也可能
   被其它入口直接调用（成绩码、测试、将来的云存档）—— 两道防线守的是
   两条不同的路径，不是重复。
   ========================================================= */
env.migration(1, function (data) {
  var out: Record<string, any> = {};
  for (var k in data) if (Object.prototype.hasOwnProperty.call(data, k)) out[k] = data[k];
  if (typeof out.keep === 'number') out.keep = {};
  return out;
});

Save.VERSION = env.VERSION;
Save.migration = env.migration;
Save.migrationVersions = env.migrationVersions;
Save.lastError = env.lastError;

function envelope(kind, data) { return env.wrap(kind, data); }
function openEnvelope(raw, kind) { return env.open(raw, kind); }
function note(msg) { env.note(msg); }

/* =========================================================
   1. 进行中的一局
   ========================================================= */
/** 把当前这一局写进存档；返回是否成功 */
Save.saveRun = function () {
  var payload = Game.exportRun();
  if (!payload) return false;
  var ok = Slots.writeJSON(Storage.KEYS.run, envelope('run', payload)).ok;
  if (!ok) note('写入失败：' + Storage.lastError());
  return ok;
};

/** 有没有可继续的一局（顺带校验一次，坏档不算有） */
Save.hasRun = function () {
  return Save.peekRun() !== null;
};

/** 只看不取：返回 { wave, char, charName, level, at } 或 null */
Save.peekRun = function () {
  var raw = Slots.readJSON(Slots.key(Storage.KEYS.run));
  var data = openEnvelope(raw, 'run');
  if (!data) return null;
  var info = Game.inspectRun(data);
  if (!info) { note('存档内容不可用（角色或字段不合法）'); return null; }
  return { wave: info.wave, char: info.char, charName: info.charName, level: info.level, at: raw.at };
};

/**
 * 读档并恢复到游戏里（会切换状态到 playing）。
 * @returns Session 或 null（没有存档 / 存档坏了）
 */
Save.loadRun = function () {
  var raw = Slots.readJSON(Slots.key(Storage.KEYS.run));
  var data = openEnvelope(raw, 'run');
  if (!data) return null;
  var sess = Game.importRun(data);
  if (!sess) note('恢复失败（存档里的角色/武器/道具无法还原）');
  return sess;
};

Save.clearRun = function () { return Slots.clear(Storage.KEYS.run); };

/* =========================================================
   2. 战绩记录（跨局累计）
   ========================================================= */
var EMPTY_RECORDS = {
  runs: 0, wins: 0, bestWave: 0, bestKills: 0, bestLevel: 0,
  totalKills: 0, totalMaterials: 0, updatedAt: 0
};

function blankRecords() {
  var o: Record<string, any> = {};
  for (var k in EMPTY_RECORDS) o[k] = EMPTY_RECORDS[k];
  return o;
}

/** 读记录；损坏/版本不符返回全新记录（而不是 null —— 调用方永远拿到可用对象） */
Save.records = function () {
  var raw = Slots.readJSON(Slots.key(Storage.KEYS.records));
  var data = openEnvelope(raw, 'records');
  if (!data) return blankRecords();
  var out = blankRecords();
  for (var k in EMPTY_RECORDS) {
    var v = Number(data[k]);
    out[k] = isFinite(v) && v >= 0 ? v : EMPTY_RECORDS[k];
  }
  out.updatedAt = Number(data.updatedAt) || 0;
  return out;
};

/**
 * 一局结束后并入记录（幂等性不做要求：同一局重复提交会重复计数，
 * 调用方应当只在 gameOver 时调一次）。
 * @param summary RunSummary（Game.summary() 的产物）
 */
Save.addRun = function (summary) {
  if (!summary) return null;
  var r = Save.records();
  var kills = Number(summary.kills) || 0;
  var wave = Number(summary.wave) || 0;
  var level = Number(summary.level) || 0;
  r.runs += 1;
  if (summary.win) r.wins += 1;
  r.totalKills += kills;
  /* 跨局累计收集：喂它的是 **earned**（带出去的材料），不是 `scrap`（局内废料）——
     ⚠ 三种东西名字近、含义完全不同，而**用错不报错**：
       · `scrap`     = 结算时手里还剩多少废料（取决于买了多少东西）
       · `earned`    = 这一局一共打出来多少**废料**
       · `materials` = 这一局打到多少**材料**（另一种货币，制造业的本钱）
     这里要的是第三种：战绩屏上的"累计收集"数的是带出去的材料。
     （早先读的是 `earned`，那时它装的是废料累计 —— 于是"累计收集"数的是废料，
     而界面上把它叫材料。） */
  r.totalMaterials += Number(summary.materials) || 0;
  if (wave > r.bestWave) r.bestWave = wave;
  if (kills > r.bestKills) r.bestKills = kills;
  if (level > r.bestLevel) r.bestLevel = level;
  r.updatedAt = Date.now();
  Slots.writeJSON(Storage.KEYS.records, envelope('records', r));
  return r;
};

Save.clearRecords = function () { return Slots.clear(Storage.KEYS.records); };
Save.resetAll = function () { Save.clearRun(); Save.clearRecords(); };

export { Save };
