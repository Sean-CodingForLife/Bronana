/* =========================================================
   score.ts — 成绩码（可离线互验，零后端）

   这套东西成立的前提是本作**已经**具备的三件事：
     1. 模拟是确定性的（固定 dt + 种子化随机）
     2. `record.ts` 的带子 = { seed, 命令, 每帧输入 }
     3. 按带子重放就能逐位复现那一局

   于是成绩不需要信任提交者：给出「成绩码 + 带子」，任何人重放一遍就能验证真伪。
   所以**不需要榜单服务**：玩家之间交换一句字符串，各自在本地复算 ——
   本作是单机游戏，没有账号、没有服务器，这一条正好绕开了它们。

   两个产物，刻意分开：
     · **成绩码**：短，一行，用来展示与比较（含带子的哈希，所以改一个数字就对不上）
     · **带子**：大，是"证据"本身；`pack()` 可以把两者拼成一条可分享的字符串，
       但长局会很大，所以超过上限就直接拒绝（而不是悄悄截断 —— 截断的后果是
       "对方验证失败"，比"一开始就拒绝"难查得多）
   ========================================================= */

import { Chars } from './data_chars.ts';
import { Game } from './game.ts';
import { Rec } from './record.ts';
import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';

var Score = {} as ScoreApi;

/**
 * 成绩码里**声明**的字段（登记为 `scoreField` 家族）。
 * 顺序**就是**它在 `|` 分隔串里的位置：`make()` 按下标拼、`parse()` 按下标读，
 * 改动必须同时改这两处与版本号 —— 理由见文件末尾的 audit。
 */
var FIELDS: string[] = [
  'version', 'key', 'char', 'danger', 'seed', 'wave', 'kills', 'level', 'win', 'hash'
];

Score.VERSION = 1;
Score.PREFIX = 'BR1';
/** 单条分享串的字符上限（localStorage 单条 256KB，留出余量） */
Score.MAX_PACK_CHARS = 200000;

/* =========================================================
   1. 哈希（FNV-1a 32 位，零依赖、跨引擎一致）
   ========================================================= */
Score.hash = function (str) {
  var h = 2166136261 >>> 0;
  for (var i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
};

/**
 * 带子的**规范序列化**：字段顺序固定、数字用 String()。
 * 之所以敢直接用 String(浮点)：ECMAScript 对 Number→String 是精确定义的
 * （最短往返表示），所以同一串数字在任何引擎上得到同一个字符串 —— 这跟
 * Math.sin 之类的实现差异不是一回事。
 */
Score.canonTape = function (tape) {
  if (!tape) return '';
  var parts = ['v' + tape.v, 'f' + (tape.frames | 0), 's' + (tape.seed >>> 0)];
  var evs = tape.events || [];
  for (var i = 0; i < evs.length; i++) {
    var e = evs[i];
    var args = e.args || [];
    var a = [];
    for (var j = 0; j < args.length; j++) a.push(argText(args[j]));
    parts.push('e' + (e.frame | 0) + ',' + String(e.cmd) + ',' + (e.seed >>> 0) + ',' + a.join(','));
  }
  var ins = tape.inputs || [];
  for (i = 0; i < ins.length; i++) {
    parts.push('i' + String(ins[i][0]) + ',' + String(ins[i][1]));
  }
  return parts.join(';');
};
/**
 * 参数转文本。**`undefined` 与 `null` 必须得到同一个结果** ——
 * 因为分享串是 JSON，而 `JSON.stringify([undefined])` 会把它变成 `null`：
 * 不归一化的话，"打包再解回来"会让哈希凭空变掉，成绩码连自己都验不过
 * （这条是测试当场抓到的，不是推出来的）。
 */
function argText(v) { return (v === undefined || v === null) ? '' : String(v); }
Score.hashTape = function (tape) { return Score.hash(Score.canonTape(tape)); };

/* =========================================================
   2. 成绩码
   ========================================================= */
/**
 * @param claims { key, char, danger, seed, wave, kills, level, win }
 * @param hash   带子的哈希（Score.hashTape）
 * @returns 形如 `BR1|2026-05-01|engineer|0|123456|12|540|18|0|a1b2c3d4`
 */
Score.make = function (claims, hash) {
  var c = claims || {};
  return [
    Score.PREFIX,
    String(c.key || 'free'),
    String(c.char || '?'),
    String(Math.max(0, Math.floor(num(c.danger)))),
    String(num(c.seed) >>> 0),
    String(Math.max(0, Math.floor(num(c.wave)))),
    String(Math.max(0, Math.floor(num(c.kills)))),
    String(Math.max(0, Math.floor(num(c.level)))),
    c.win ? '1' : '0',
    String(hash || '')
  ].join('|');
};

/** 解析成绩码；结构不对返回 null（不抛） */
Score.parse = function (code) {
  if (typeof code !== 'string') return null;
  var p = code.trim().split('|');
  if (p.length !== 10 || p[0] !== Score.PREFIX) return null;
  var danger = Number(p[3]), seed = Number(p[4]), wave = Number(p[5]);
  var kills = Number(p[6]), level = Number(p[7]);
  if (!isFinite(danger) || !isFinite(seed) || !isFinite(wave) || !isFinite(kills) || !isFinite(level)) return null;
  if (!/^[0-9a-f]{8}$/.test(p[9])) return null;
  if (p[1] !== 'free' && !/^\d{4}-\d{2}-\d{2}$/.test(p[1])) return null;
  if (!Chars.BY_ID[p[2]]) return null;
  return {
    key: p[1], char: p[2], danger: danger, seed: seed, wave: wave,
    kills: kills, level: level, win: p[8] === '1', hash: p[9]
  };
};

/** 给人看的一行摘要 */
Score.describe = function (claims) {
  if (!claims) return '';
  return '第 ' + claims.wave + ' 波 · 击杀 ' + claims.kills + ' · Lv.' + claims.level +
    (claims.win ? ' · 通关' : '') + ' · 难度 ' + claims.danger;
};

/* =========================================================
   3. 重放并取回"实际成绩"
   ---------------------------------------------------------
   重放会**真的**跑一遍模拟（它就是这样工作的），所以调用方必须保证：
     · 传入的 step 与 main.ts 里那次一致（同一个场景闸门 + Input.endFrame）
     · 别在玩家打着一局的时候调用
   `Rec.replaying()` 为真期间，接入层不写存档 —— 见 main.ts。
   ========================================================= */
/**
 * @param play (x, y, frame) => void  推进一逻辑帧（通常就是 main.ts 里那个 lambda）
 * @returns 重放后的实际成绩
 */
Score.replayClaims = function (tape, play) {
  Rec.play(tape, play);
  var sess = Game.getSession();
  if (!sess) return null;
  var p = sess.player;
  return {
    key: 'free',                    // 重放本身不知道日期，调用方用成绩码里的
    char: sess.charDef.id,
    danger: sess.danger,
    seed: sess.seed >>> 0,
    wave: Game.wave,
    kills: Math.round(sess.stats_total.kills),
    level: p.level,
    /* 通关与否读**模拟层写下的事实**（S.won，见 game.ts winRun）。
       它以前是"波次 ≥ finalWave"推断出来的 —— 那个推断在房间制下不再成立：
       一局的长度由地图（三层）决定，波次只是全局进度计数，
       "打到第 39 间"和"通关"之间没有等价关系（这正是改造后必须改掉的一处派生值）。 */
    win: !!sess.won
  };
};

/**
 * 验证一份成绩（成绩码 + 带子）。
 * @returns { ok, reason, actual }
 */
Score.verify = function (code, tape, play) {
  var claims = Score.parse(code);
  if (!claims) return { ok: false, reason: '成绩码格式不对', actual: null };
  if (!tape) return { ok: false, reason: '没有带子（成绩码只有哈希，验证必须带证据）', actual: null };

  var h = Score.hashTape(tape);
  if (h !== claims.hash) return { ok: false, reason: '带子与成绩码不匹配（哈希对不上，改过）', actual: null };

  var actual = Score.replayClaims(tape, play);
  if (!actual) return { ok: false, reason: '重放没有产生会话', actual: null };

  var mism = [];
  if (actual.char !== claims.char) mism.push('角色 ' + claims.char + '→' + actual.char);
  if (actual.danger !== claims.danger) mism.push('难度 ' + claims.danger + '→' + actual.danger);
  if (actual.seed !== claims.seed) mism.push('种子 ' + claims.seed + '→' + actual.seed);
  if (actual.wave !== claims.wave) mism.push('波次 ' + claims.wave + '→' + actual.wave);
  if (actual.kills !== claims.kills) mism.push('击杀 ' + claims.kills + '→' + actual.kills);
  if (actual.level !== claims.level) mism.push('等级 ' + claims.level + '→' + actual.level);
  if (actual.win !== claims.win) mism.push('通关 ' + claims.win + '→' + actual.win);
  if (mism.length) return { ok: false, reason: '重放结果与成绩码不符：' + mism.join('、'), actual: actual };
  return { ok: true, reason: '重放一致', actual: actual };
};

/* =========================================================
   4. 分享串（成绩码 + 带子）
   ========================================================= */
Score.pack = function (code, tape) {
  var packed = JSON.stringify({ c: String(code || ''), t: tape || null });
  if (packed.length > Score.MAX_PACK_CHARS) {
    // 拒绝而不是截断：截断的后果是"对方验证失败"，比"这里就说清楚"难查得多
    return { ok: false, reason: '这一局太长（' + packed.length + ' 字符 > 上限 ' +
      Score.MAX_PACK_CHARS + '），成绩码可以照常展示，但带子不适合整体分享', text: null };
  }
  return { ok: true, reason: '', text: packed };
};

Score.unpack = function (text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  var o;
  try { o = JSON.parse(text); } catch (e) { return null; }
  if (!o || typeof o !== 'object' || typeof o.c !== 'string') return null;
  return { code: o.c, tape: o.t || null };
};

function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

/* =========================================================
   5. 定义期自检（`scoreField` 的守卫）
   ---------------------------------------------------------
   `scoreField` 是"成绩码里有哪几段、什么顺序"的声明。它自己不会坏，
   坏的是它与 `make` / `parse` / `hash` **三处代码脱节** —— 而脱节没有任何症状：
   本地生成照常、展示照常，只有"别人拿去验"或"自己解回来"的时候才发现，
   而那时报文是"成绩码格式不对"，看不出是哪一段错了。

   每条判据都对着一个真实的静默故障：
     · 段数 ≠ 声明字段数 → `parse` 硬要求 10 段：多一段/少一段会让**每一张成绩码
       都解析失败**（包括你自己刚生成的那张）
     · 前缀：`make` 拼的与 `parse` 比的是同一个 `PREFIX`；谁改成硬写字面量，
       全线不认自己人
     · `PREFIX` 里的版本号与 `VERSION` 不一致 → 旧码/新码的兼容性判定错
     · `hash()` 的输出不符合 `parse` 的 `/^[0-9a-f]{8}$/` → 同样"自己的码自己解析不了"
     · `make → parse` 往返后逐字段相等：字段顺序就是位置，**错位**会把波次读成击杀数，
       值看起来很正常（这就是最难查的那种）
     · `MAX_PACK_CHARS` 不是有限正数 → `packed.length > NaN` 恒 false：永不拒绝，
       超限的分享串被 localStorage 静默丢掉（"对方验证失败"就是这么来的）
     · `args` 里的 `undefined` 与 `null` 必须得到同一个带子哈希：分享串是 JSON，
       `JSON.stringify([undefined])` 会变成 `null` —— 不归一化的话，
       "打包再解回来"让哈希凭空变掉，成绩码连自己都验不过（**这条是测试当场抓到的**）
   ========================================================= */
Score.audit = function () {
  var problems: string[] = [];
  var charId = (Chars.LIST && Chars.LIST.length) ? Chars.LIST[0].id : '';
  if (!charId) {
    problems.push('角色表是空的：成绩码里的角色过不了 parse 的 Chars.BY_ID 校验（每一张码都会被判非法）');
  }
  var hash = Score.hash('probe');
  var claims: Partial<ScoreClaims> = {
    key: '2026-01-05', char: charId, danger: 3, seed: 12345,
    wave: 7, kills: 42, level: 5, win: false
  };
  var made = Score.make(claims, hash);
  var segs = made.split('|');
  if (segs.length !== FIELDS.length) {
    problems.push('成绩码有 ' + segs.length + ' 段，而 scoreField 声明了 ' + FIELDS.length +
      ' 个字段（parse 按固定段数解析：多一段/少一段会让每一张成绩码都解析失败）');
  }
  if (made.indexOf(Score.PREFIX + '|') !== 0) {
    problems.push('make() 产出的码不是以 PREFIX 开头：' + made.slice(0, 16) + '（parse 比的是同一个 PREFIX）');
  }
  if (Score.PREFIX !== 'BR' + Score.VERSION) {
    problems.push('PREFIX(' + Score.PREFIX + ') 与 VERSION(' + Score.VERSION +
      ') 不一致（版本兼容性判定会错）');
  }
  if (!/^[0-9a-f]{8}$/.test(hash)) {
    problems.push('hash() 的输出不满足 parse 要求的 8 位小写十六进制：' + hash +
      '（那样自己生成的码自己解析不了）');
  }
  var back = Score.parse(made);
  if (!back) {
    problems.push('make() 产出的成绩码 parse() 解析不了：' + made);
  } else {
    if (back.key !== String(claims.key)) problems.push('往返后 key 变了：' + claims.key + ' → ' + back.key);
    if (back.char !== String(claims.char)) problems.push('往返后 char 变了：' + claims.char + ' → ' + back.char);
    if (back.danger !== claims.danger) problems.push('往返后 danger 变了：' + claims.danger + ' → ' + back.danger);
    if (back.seed !== claims.seed) problems.push('往返后 seed 变了：' + claims.seed + ' → ' + back.seed);
    if (back.wave !== claims.wave) problems.push('往返后 wave 变了：' + claims.wave + ' → ' + back.wave + '（字段错位：读出来的是别人的值，而它看起来很合理）');
    if (back.kills !== claims.kills) problems.push('往返后 kills 变了：' + claims.kills + ' → ' + back.kills);
    if (back.level !== claims.level) problems.push('往返后 level 变了：' + claims.level + ' → ' + back.level);
    if (back.win !== !!claims.win) problems.push('往返后 win 变了：' + claims.win + ' → ' + back.win);
    if (back.hash !== hash) problems.push('往返后 hash 变了：' + hash + ' → ' + back.hash);
  }
  var cap = Score.MAX_PACK_CHARS;
  if (!(typeof cap === 'number' && isFinite(cap) && cap > 0)) {
    problems.push('MAX_PACK_CHARS 不是有限正数：' + String(cap) +
      '（NaN → pack 永不拒绝，超限的分享串被 localStorage 静默丢掉）');
  }
  /* undefined / null 归一化：造两条只在这一点上不同的带子，哈希必须相同 */
  var ev1: RecEvent[] = [{ frame: 0, cmd: 'move', seed: 1, args: [undefined] }];
  var ev2: RecEvent[] = [{ frame: 0, cmd: 'move', seed: 1, args: [null] }];
  var t1: RecTape = { v: 1, frames: 1, seed: 1, events: ev1, inputs: [] };
  var t2: RecTape = { v: 1, frames: 1, seed: 1, events: ev2, inputs: [] };
  if (Score.hashTape(t1) !== Score.hashTape(t2)) {
    problems.push('args 里的 undefined 与 null 得到不同的带子哈希（打包成 JSON 会把 undefined 归一成 null，' +
      '于是"打包再解回来"哈希凭空变掉：成绩码连自己都验不过）');
  }
  return { ok: problems.length === 0, problems: problems };
};

/* =========================================================
   6. 登记进扩展点总账
   ========================================================= */
Registry.family('scoreField', {
  note: '成绩码字段（顺序即字符串里的位置，改动必须同时改版本号）', owner: 'score.ts',
  values: function () { return FIELDS.slice(); }
});

/* 定义期自检：不过就抛。它只读本模块的纯函数与声明表（Chars 是直接 import，
   求值顺序由 ES 模块保证），所以加载期跑是安全的。 */
var scoreVerdict = Score.audit();
if (!scoreVerdict.ok) {
  throw new Error('score.ts 成绩码自检失败：\n' + scoreVerdict.problems.join('\n'));
}
SelfCheck.register('Score', Score.audit);

export { Score };
