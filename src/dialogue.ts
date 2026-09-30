/* =========================================================
   dialogue.ts — 对话引擎（R41 那"缺的一半"）
   ---------------------------------------------------------
   R41 的普查把本作的对话与外部标准逐条对过账，结论是：

   > **对话有骨架缺一半** —— 已有的是"对话框 + 一次一句 + 头像 + 名牌 +
   > 条件台词 / 一次性 / 说过的过滤 + 新话角标"；
   > 缺的是"打字机 / 跳到整句 / 选择分支 / 对话历史 / 跳过 / 自动 /
   > 玩家侧头像 / 战斗短句（barks）"。

   这一模块补的正是**那几样里与"节奏"有关的部分** —— 它们有一个共同点：
   **都是时间的函数**（一个字一个字地出、按住跳过、自动往下走），
   而不是"再画一块界面"。所以它们能且应当在**模拟层之外**被算清：

     · 打字机：`indexAt(t)` —— 第 t 秒该露出几个字
     · 跳到整句：`skipTo()` —— 立刻露出全部（打字机的逆运算）
     · 自动：`autoDue()` —— 露完之后再等多久才往下走
     · 对话历史：一张**有上限**的环形清单（`pushHistory`）
     · 战斗短句：一张**声明表** + 一条**确定性的**节流规则

   ⚠ **本模块是纯的**：没有模块级可变状态、不读时钟（`t` 由调用方喂）、
     不认识 DOM、不认识 `Session`。那条"ring 上的状态"由 `ui.ts` 持有 ——
     于是同一套节奏规则能被无头测试直接跑（`test/dialogue.mjs`）。

   ⚠ **不许用 `Math.random`**：战斗短句要在模拟层的带子里可复现
     （`record.ts` 只录种子与逐帧输入）。所以"什么时候说哪一句"用的是
     **按事件序号的轮转**（`pick` 的 `nth` 参数）—— 确定，但一轮之内不重复。
   ========================================================= */

import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';

var Dialogue = {} as DialogueApi;

/* =========================================================
   1. 打字机的速度（唯一的两个数）
   ---------------------------------------------------------
   为什么是"每字多少秒"而不是"每秒多少字"：**中英混排**时后者的直觉是错的
   （一个汉字与一个字母占的宽度差三倍）。这里要的是"读完一句话要多久"，
   而那个量天然按**字数**算。

   `CHAR_SEC` 取 0.028：一句话 20 字 ≈ 0.56 秒、40 字 ≈ 1.1 秒。
   参照 Hades 的节奏 —— 快到来不及读，慢到不烦人。

   `HOLD_SEC` 是"露完之后停多久"（自动模式用），取 0.9 秒：
   比一次呼吸长一点，够眼睛落回句尾。
   ========================================================= */
Dialogue.CHAR_SEC = 0.028;
Dialogue.HOLD_SEC = 0.9;
/** 一句话最多打多久（超长台词不该让人干等）：超过它就整体加速 */
Dialogue.MAX_TYPE_SEC = 2.6;

/* =========================================================
   2. 打字机
   ========================================================= */
/** 这句话打完要多久（0 字 = 0 秒，认不出的输入当 0 字） */
Dialogue.durationOf = function (text) {
  var n = Dialogue.len(text);
  if (!n) return 0;
  return Math.min(Dialogue.MAX_TYPE_SEC, n * Dialogue.CHAR_SEC);
};

/**
 * 打到第 t 秒时该露出**几个字**。
 *
 * ⚠ 按**码点**数（`Array.from`）而不是 `.length`：汉字在 UTF-16 里是一个码元，
 *   但表情与部分符号是**代理对**（两个码元），按 `.length` 切会在它们中间断开 ——
 *   界面上表现为句尾一个"半个字"的方块。
 */
Dialogue.len = function (text) {
  if (!text) return 0;
  return Array.from(String(text)).length;
};

Dialogue.indexAt = function (text, t) {
  var n = Dialogue.len(text);
  if (!n) return 0;
  var sec = Math.max(0, Number(t) || 0);
  var dur = Dialogue.durationOf(text);
  if (dur <= 0) return n;
  if (sec >= dur) return n;
  /* 线性推进（不缓动）：缓动会让"前几个字"慢得像是卡了 */
  return Math.max(0, Math.min(n, Math.floor(n * (sec / dur))));
};

/** 露出前 n 个**码点**（`n >= 全长` = 整句） */
Dialogue.slice = function (text, n) {
  var arr = Array.from(String(text || ''));
  var k = Math.max(0, Math.min(arr.length, Math.floor(Number(n) || 0)));
  return arr.slice(0, k).join('');
};

/** 全露出来（"点一下跳到整句"就是它） */
Dialogue.full = function (text) { return String(text || ''); };

/** 打完了没有 */
Dialogue.done = function (text, t) {
  return Dialogue.indexAt(text, t) >= Dialogue.len(text);
};

/* =========================================================
   3. 自动 / 跳过（两个开关，各管一半）
   ---------------------------------------------------------
   ⚠ **它们不是一回事**，所以是两个布尔量而不是一个三态：
     · `skip`  = "这一句别慢慢打"（只影响**当前这一句**，说话的人还是人）
     · `auto`  = "说完就自己往下走"（影响**之后每一句**，可以一边走一边读）
   Hades 里跳过是按住、自动是设置项 —— 本作把两者都做成这一屏上的开关。
   ========================================================= */
Dialogue.autoDue = function (text, t, auto) {
  if (!auto) return false;
  return (Number(t) || 0) >= Dialogue.durationOf(text) + Dialogue.HOLD_SEC;
};
Dialogue.skipDue = function (skip) { return !!skip; };

/* =========================================================
   4. 对话历史（backlog）
   ---------------------------------------------------------
   为什么要有上限：一局里能说几十句，而"上一句是什么"只对最近几句有意义。
   上限取 40：够翻回"这个人刚才说了什么"，又不至于让一张清单长到没人看。

   ⚠ 每条记的是**谁 + 说了什么**（不是"哪一条 id"）：历史是给玩家看的，
     而 `said` 那张表是给条件判定用的 —— 两者回答的不是同一个问题。
     一条记录里**两者都有**（`line` 用来查表，`text` 用来显示）。
   ========================================================= */
Dialogue.HISTORY_MAX = 40;

/**
 * 往历史里塞一条，返回**新的**数组（不改传进来的那个）。
 * 超上限时丢最老的。
 */
Dialogue.pushHistory = function (list, entry) {
  var out = (list || []).slice();
  if (!entry || !entry.text) return out;
  out.push({
    who: String(entry.who || ''),
    name: String(entry.name || ''),
    text: String(entry.text),
    line: String(entry.line || ''),
    at: Math.max(0, Math.floor(Number(entry.at) || 0))
  });
  while (out.length > Dialogue.HISTORY_MAX) out.shift();
  return out;
};

/** 翻历史时要看的那一份（最近 n 条，**倒序**：最新的在最上面） */
Dialogue.recent = function (list, n) {
  var src = (list || []).slice();
  var k = Math.max(0, Math.floor(Number(n) || 0));
  var tail = k > 0 ? src.slice(Math.max(0, src.length - k)) : src;
  return tail.reverse();
};

/* =========================================================
   5. 战斗短句（barks）
   ---------------------------------------------------------
   什么是 bark：战斗中**没有对话框**的那种短句（"痛快！" / "再来！"），
   飘一下就没。Hades / Dead Cells 里它们是"角色有脾气"的主要来源，
   而成本极低 —— 一句文案 + 一个触发条件。

   ⚠ **触发条件是"事件"不是"随机"**（不许 `Math.random`）：`record.ts`
     只录种子与逐帧输入，随机短句会让同一盘带子放出不同的话。
     所以这里用 `nth`（第几次触发）按表长取模 —— 确定，且一轮之内不重复。
   ========================================================= */
var BARKS: BarkDef[] = [
  { id: 'hurt_hard', when: 'hurtHard', text: '……还行。', note: '一次挨掉两成以上生命' },
  { id: 'hurt_hard2', when: 'hurtHard', text: '再来。', note: '同上（第二次会轮到这一句）' },
  { id: 'low_hp', when: 'lowHp', text: '快撑不住了 ——', note: '生命掉到三成以下（每局一次）' },
  { id: 'level_up', when: 'levelUp', text: '又长了一点。', note: '升级' },
  { id: 'boss_down', when: 'bossDown', text: '它的器官少了一个。', note: '打倒 Boss' },
  { id: 'secret', when: 'secret', text: '这墙是空的。', note: '发现密室' },
  { id: 'wave_clear', when: 'waveClear', text: '这一波清了。', note: '清场' },
  { id: 'overrun', when: 'overrun', text: '时间到了 —— 它们急了。', note: '超时狂暴' },
  { id: 'die', when: 'die', text: '……又要从头长一遍。', note: '阵亡' }
];

var BARK_BY_ID: Record<string, BarkDef> = Object.create(null);
(function () { for (var i = 0; i < BARKS.length; i++) BARK_BY_ID[BARKS[i].id] = BARKS[i]; })();

Dialogue.BARKS = BARKS;

/* 触发条件的**唯一出处**（表里用到的那几个；自检拿它查"有没有白声明"）。
   ⚠ 它必须**定义在 `audit()` 之前**：自检在模块加载的最后就跑了一遍，
     而 `audit` 里要遍历它 —— 放在后面的话那一次跑读到的是 `undefined`。
     实测踩过（`Cannot read properties of undefined (reading 'length')`）。 */
Dialogue.WHENS = ['hurtHard', 'lowHp', 'levelUp', 'bossDown', 'secret', 'waveClear', 'overrun', 'die'];

/** 某个事件该说哪一句（`nth` = 这是这一局里第几次触发），没有就返回 null */
Dialogue.barkFor = function (when, nth) {
  var pool = BARKS.filter(function (b) { return b.when === when; });
  if (!pool.length) return null;
  var k = Math.max(0, Math.floor(Number(nth) || 0)) % pool.length;
  return pool[k];
};
Dialogue.byId = function (id) { return BARK_BY_ID[String(id || '')] || null; };
/** 短句飘多久（秒）—— 与打字机无关，它是"一句话飘过去"的时间 */
Dialogue.BARK_SEC = 1.6;

/* =========================================================
   6. 自检
   ========================================================= */
Dialogue.audit = function () {
  var problems = [];
  var i;

  /* 打字机：三条边界（0 字 / 半途 / 超时）必须都对。
     这些是"界面看着像卡了"那一类故障的唯一防线。 */
  var s = '这是一句话';
  if (Dialogue.indexAt(s, 0) !== 0) problems.push('t=0 时露出的字不是 0 个');
  if (Dialogue.indexAt(s, 9999) !== Dialogue.len(s)) problems.push('t 很大时没有露完');
  if (Dialogue.indexAt('', 1) !== 0) problems.push('空串露出的字不是 0 个');
  /* 单调：t 越大露出的字**只能不减**（打字机不能倒着打） */
  var last = -1, mono = true;
  for (var t = 0; t <= 4; t += 0.05) {
    var k = Dialogue.indexAt(s, t);
    if (k < last) mono = false;
    last = k;
  }
  if (!mono) problems.push('打字机会倒着打（t 变大而露出的字变少）');
  /* **超长台词不许让人干等**：`MAX_TYPE_SEC` 是硬上限 */
  var long = '字'.repeat(500);
  if (Dialogue.durationOf(long) > Dialogue.MAX_TYPE_SEC + 1e-9) {
    problems.push('超长台词的打字时间超过了上限 ' + Dialogue.MAX_TYPE_SEC + 's');
  }
  /* `slice` 与 `indexAt` 必须**同一个口径**（一个按字算、一个按码元切 = 句尾少半个字） */
  for (var q = 0; q <= Dialogue.len(s); q++) {
    if (Dialogue.len(Dialogue.slice(s, q)) !== q) {
      problems.push('slice(' + q + ') 的长度不是 ' + q + '（与 indexAt 的口径不一致）');
      break;
    }
  }
  /* 代理对（表情）不许被切开：这是 `.length` 与码点数最容易分叉的地方 */
  var emo = '好🙂坏';
  if (Dialogue.len(emo) !== 3) problems.push('代理对被算成了 ' + Dialogue.len(emo) + ' 个字（应该 3）');
  var half = Dialogue.slice(emo, 2);
  if (half.indexOf('\uFFFD') >= 0) problems.push('切到代理对中间时产生了半个字符');

  /* 自动：三态必须都对（没开 / 刚打完还没等够 / 等够了） */
  if (Dialogue.autoDue(s, 0, false)) problems.push('没开自动却说"该往下走了"');
  if (Dialogue.autoDue(s, 0, true)) problems.push('刚显示就说"该往下走了"');
  if (!Dialogue.autoDue(s, 999, true)) problems.push('打了很久还说"不该往下走"');

  /* 历史：上限真的生效，而且是**丢最老的** */
  var h: DialogueHistoryEntry[] = [];
  for (i = 0; i < Dialogue.HISTORY_MAX + 12; i++) {
    h = Dialogue.pushHistory(h, { who: 'mother', name: '菌母', text: '第 ' + i + ' 句' });
  }
  if (h.length !== Dialogue.HISTORY_MAX) problems.push('历史的长度没有封顶（' + h.length + '）');
  if (h[h.length - 1].text !== '第 ' + (Dialogue.HISTORY_MAX + 11) + ' 句') problems.push('最新的一句没有留在历史里');
  if (h[0].text !== '第 12 句') problems.push('丢掉的不是最老的那几条（第一条是 ' + h[0].text + '）');
  if (Dialogue.pushHistory(h, null).length !== h.length) problems.push('空记录被写进了历史');
  /* `pushHistory` 必须**不改传进来的数组**（界面上两份状态会互相污染） */
  var before = h.length;
  Dialogue.pushHistory(h, { text: 'x' });
  if (h.length !== before) problems.push('pushHistory 改了传进来的那个数组');
  /* `recent` 是倒序（最新的在最上面），且不超要的条数 */
  var r = Dialogue.recent(h, 3);
  if (r.length !== 3) problems.push('recent(3) 返回了 ' + r.length + ' 条');
  if (r[0].text !== h[h.length - 1].text) problems.push('recent 的第一条不是最新的那一句');

  /* 短句：每一句都要有触发条件与文案；同一个条件至少有一句 */
  var seen: Record<string, boolean> = Object.create(null);
  for (i = 0; i < BARKS.length; i++) {
    var b = BARKS[i];
    if (!b.id) { problems.push('第 ' + i + ' 条短句没有 id'); continue; }
    if (seen[b.id]) problems.push('短句 id 重复：' + b.id);
    seen[b.id] = true;
    if (!b.when) problems.push(b.id + ' 没有触发条件（它永远不会被说出来）');
    if (!b.text) problems.push(b.id + ' 没有文案');
    if (!b.note) problems.push(b.id + ' 没有说明（界面上写不出它是干什么的）');
  }
  if (!BARKS.length) problems.push('短句表是空的（"战斗中短句"那一栏就是 ❌）');
  /* 每一个**声明过的**触发条件都要真的能被取到 */
  var whens = Dialogue.WHENS;
  for (i = 0; i < whens.length; i++) {
    if (!BARKS.some(function (x) { return x.when === whens[i]; })) {
      problems.push('触发条件 ' + whens[i] + ' 没有任何一句短句 —— 那条事件永远不出声');
    }
  }
  /* `barkFor` 的轮转必须**确定**（同一个 nth 两次同一句）且一轮之内不重复 */
  var a1 = Dialogue.barkFor('hurtHard', 0), a2 = Dialogue.barkFor('hurtHard', 0);
  var a3 = Dialogue.barkFor('hurtHard', 1);
  if (!a1 || !a2 || a1.id !== a2.id) problems.push('barkFor 对同一个 nth 给出了不同的句子（不可复现）');
  if (a1 && a3 && a1.id === a3.id) problems.push('barkFor 的轮转没有推进（连着两次同一句）');
  if (Dialogue.barkFor('没有这个条件', 0) !== null) problems.push('barkFor 对未知条件没有返回 null');

  return { ok: problems.length === 0, problems: problems, counts: { barks: BARKS.length, whens: whens.length } };
};

/* 触发条件的唯一出处已经在上面（`Dialogue.WHENS`）—— 那里写清了"为什么必须在前面" */

var verdict = Dialogue.audit();
if (!verdict.ok) throw new Error('dialogue.ts 自检失败：\n' + verdict.problems.join('\n'));
SelfCheck.register('Dialogue', Dialogue.audit);

/* =========================================================
   7. 登记进扩展点总账
   ========================================================= */
Registry.family('barkWhen', {
  note: '战斗短句的触发条件（每一个都必须至少有一句，否则那条事件永远不出声）',
  owner: 'dialogue.ts',
  values: function () { return Dialogue.WHENS.slice(); }
});
Registry.family('bark', {
  note: '战斗短句（战斗中飘一下就没的短句；**不是**对话框）', owner: 'dialogue.ts',
  entries: function () {
    return BARKS.map(function (b) {
      return { id: b.id, refs: [{ field: 'when', value: b.when, family: 'barkWhen' }] };
    });
  }
});

export { Dialogue };
