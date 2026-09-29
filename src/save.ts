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
 * 现在只有 v1，所以迁移表是空的 —— 价值在于"下次改格式时不必再想机制"，
 * 测试用合成旧档（v0）验证这条链真的能跑通。
 */
var env = Envelope.create({ name: 'save', version: 1 });

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
     两个是不同的问题："这一局一共打出来多少" 与 "局内花剩多少"。
     用错的那个会让战绩屏上的"累计收集"随着玩家少买东西而变少。 */
  r.totalMaterials += Number(summary.earned) || 0;
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
