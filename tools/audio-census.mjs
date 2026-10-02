/* =========================================================
   audio-census.mjs — **音效到底有没有被调用**（静态普查）
   ---------------------------------------------------------
   ## 为什么需要它

   `Sfx.audit()`（`audio.ts` 里那个）只验一件事：**声明表里的 id 都挂着函数**。
   它验不了另一半，而那一半才是真正的失败模式：

     `Sfx.LIST` 里有 13 个音效，`Sfx.waveStart` 也确实是个函数 ——
     但**没有任何地方调用它**。表现是"每波开始时没有声音"，
     而**无声是最难注意到的一类退化**（玩家会以为自己没开音量）。

   `audio.ts` 的文件头把这件事写明了：
     "「每个音效都有调用点」是检查期的活（要扫源码），本模块不方便做"。
   这个文件就是那一半。

   ## 判据（四条，都能当场验证 —— 不猜语义）

     A **声明过的音效至少有一个调用点**。
       `Sfx.X(` 出现在 `src/` 里任何一处即算。豁免要逐条写理由。
     B **模拟层广播的音效意图，入口必须接上**。
       模拟层只广播意图（`Game.events.emit('sfx', {name})`，见 `game.ts` 的 `sfx()`
       助手），真正响不响取决于 `main.ts` 的 `SFX_BY_INTENT`。
       广播了却没人接 = 那件事永远没声音。两个方向都要查。
     C **意图名必须是真实的音效函数**。
       `SFX_BY_INTENT` 里写了 `Sfx.xxx`，而 `Sfx.xxx` 不是函数 = 调用时当场抛。
     D **`Sfx.*(` 的调用点必须指向真实存在的音效**。
       写错一个字母（`Sfx.waveClear` → `Sfx.waveclear`）= `undefined is not a function`。
       这一条比 A 更早生效：它在**代码写错的那一刻**就报，A 要等"整条链都忘了调"。

   ## 为什么是静态普查而不是运行时探针

   无头环境**没有 `AudioContext`**（README 的"还剩什么"里如实记着）。
   所以"真的出声"只能靠人听 —— 但"**该响的时候有没有人去按那个按钮**"
   是纯静态事实，能扫得干干净净。这个文件只声称后者，**绝不**声称前者。

   用法：
     node tools/audio-census.mjs            报告
     node tools/audio-census.mjs --strict   把提示级也算成拦截
     node tools/audio-census.mjs --json
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import srcFiles from './src-files.cjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');
const STRICT = process.argv.includes('--strict');
const JSON_OUT = process.argv.includes('--json');

/* ---------------- 读源码 ----------------
   ⚠ 三条纪律，每一条都是"校验先于结论"：

   ① 用共享扫描器（`tools/src-files.cjs`）而不是 `readdirSync` ——
      目录化之后子目录里的模块会被静默漏掉，而本工具照样全绿。
   ② **必须去注释**。第一版没去，于是 `audio.ts` 自己那段
      "改造前是模拟层直接 `Sfx.kill()` 共 9 处"的注释被当成了调用点 ——
      它把"没有任何地方调用 Sfx.kill"这个真问题**报成了绿的**。
      这是本工具最坏的失效方式：一句解释性的注释让检查失效。
   ③ `types.d.ts` 不算：它只有类型，`Sfx.kill(): void` 那样的声明不是调用。 */
const relFiles = srcFiles.list().filter(f => !f.endsWith('.d.ts'));
const code = Object.create(null);
const raw = Object.create(null);
for (const rel of relFiles) {
  const name = srcFiles.relName(rel);
  /* ⚠ **去掉 `\r`**：这个仓库在 Windows 上签出成 CRLF，而下面所有块级正则都靠
     `\n};` 这样的形状定位 —— `\r` 会让它们全部匹配不上。
     这一条在第一版里就咬人了：`SFX_BY_INTENT` 明明在，正则却说找不到。
     两个选择：把正则写成 `\r?\n`（每个都要记得）或者在这里统一成 LF（只有一处）。
     选后者 —— 校验要读的是**代码，不是行尾风格**。 */
  raw[name] = fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r\n/g, '\n');
  code[name] = raw[name]
    .replace(/\/\*[\s\S]*?\*\//g, '')          // 块注释
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');     // 行注释（避开 https:// 里的 //）
}
const files = relFiles.map(srcFiles.relName);

/* ---------------- A. 声明表：从 audio.ts 读 ----------------
   ⚠ 解析的是**表里每一条的 id**，不是"Sfx 上所有函数"。
   `Sfx.setVolume` / `Sfx.gainOf` / `Sfx.duckFor` 那些是**混音控制**，
   它们不发声 —— 要求它们有调用点是对的，但它们不在 `LIST` 里
   （`Sfx.audit` 的 SKIP 表已经把这条边界写清楚了，这里跟着它走）。 */
const audioSrc = code['audio.ts'] || '';
const listBlock = /Sfx\.LIST\s*=\s*\[([\s\S]*?)\n\];/.exec(audioSrc);
if (!listBlock) {
  console.error('[audio-census] 在 src/audio.ts 里找不到 `Sfx.LIST = [` —— 解析失败。');
  console.error('  这是**校验坏了**，不是代码坏了：请先修本文件的解析，别去改 audio.ts。');
  process.exit(2);
}
/* 每一条的形状是 `{ id: 'xxx', label: …, note: … }` */
const declared = [...listBlock[1].matchAll(/\bid\s*:\s*'([^']+)'/g)].map(m => m[1]);
if (!declared.length) {
  console.error('[audio-census] `Sfx.LIST` 里一条 id 都没解析到 —— 解析失败（同上，别改 audio.ts）。');
  process.exit(2);
}

/* ---------------- A′. 调用点：`Sfx.X(` 出现在哪 ----------------
   只在**别的文件**里找，还是 `audio.ts` 里也找？
   `audio.ts` 里对 `Sfx.X` 的调用只有两种：定义（`Sfx.X = function`）与
   内部互调（`Sfx.resume()`）。后者**不是发布点**（玩家听不到"内部调用"）。
   所以统计时排除 `Sfx.X =` 这个定义形状，其余都算。 */
function callSites(id) {
  const re = new RegExp('\\bSfx\\.' + id + '\\s*\\(');
  const def = new RegExp('\\bSfx\\.' + id + '\\s*=');
  const out = [];
  for (const f of files) {
    const c = code[f] || '';
    if (!re.test(c) || def.test(c)) {
      /* 同一文件里既有定义又有调用是可能的（audio.ts 内互调）——
         逐个匹配点判，而不是整文件一刀切。 */
      const lines = c.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i]) && !/Sfx\.[A-Za-z_$][\w$]*\s*=\s*(function|\()/.test(lines[i])) {
          out.push({ file: f, line: i + 1 });
        }
      }
      continue;
    }
    const lines = c.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i]) && !/Sfx\.[A-Za-z_$][\w$]*\s*=\s*(function|\()/.test(lines[i])) {
        out.push({ file: f, line: i + 1 });
      }
    }
  }
  return out;
}
const callsOf = Object.create(null);
for (const id of declared) callsOf[id] = callSites(id);

/* 逐条写理由的豁免。**刻意留空**：有豁免就说明判据还不够准。
   （与 `guard-gaps` 的 `GUARD_EXEMPT` 同一条纪律：
     宁可让它是红的让人来读，也不要用一张表把红压成绿。） */
const EXEMPT = Object.create(null);
const neverCalled = declared.filter(id => callsOf[id].length === 0 && !EXEMPT[id]);

/* ---------------- D. 调用点指向真实音效（比 A 更早生效） ----------------
   扫的是**别的模块**里的 `Sfx.X(`：X 必须在 `Sfx.LIST` 里，
   否则要么是错字（运行时 `undefined is not a function`），
   要么是没进清单的音效函数（那另一种病，`Sfx.audit` 的反向检查会报）。 */
const MIX_CTRL = ['init', 'resume', 'setEnabled', 'setVolume', 'gainOf', 'audit',
  'setBusVolume', 'duckFor', 'refreshMusic', 'onMusicVolume', 'click'];
const declaredSet = Object.create(null);
for (const id of declared) declaredSet[id] = true;
const unknownCalls = [];
for (const f of files) {
  if (f === 'audio.ts') continue;                 // 定义与内部互调不在这里判
  const lines = (code[f] || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(/\bSfx\.([A-Za-z_$][\w$]*)\s*\(/g)) {
      const id = m[1];
      if (declaredSet[id] || MIX_CTRL.indexOf(id) >= 0) continue;
      unknownCalls.push({ file: f, line: i + 1, id });
    }
  }
}

/* ---------------- B/C. 意图桥：模拟层广播 ↔ 入口接入 ----------------
   模拟层的唯一广播点是 `game.ts` 的 `sfx()` 助手（守卫 `test/arch.mjs` [4]
   就是用 `\bsfx\('name'` 这个正则对齐两边的）。这里跟着它走。
   ⚠ 这一段要在 A″ 之前：A″ 要用 `intentBlock` 的行号范围把"模拟层广播"
   与"界面手点"分开，而"用之前先算"是这个文件里已经栽过一次的坑。 */
const gameSrc = code['game.ts'] || '';
const emitted = [...gameSrc.matchAll(/\bsfx\(\s*'([^']+)'/g)].map(m => m[1]);
const emittedSet = Object.create(null);
for (const e of emitted) emittedSet[e] = true;

const mainSrc = code['main.ts'] || '';
/* ⚠ 锚点必须用**惰性通配** `[\s\S]*?`，**不能**用 `[^=]*`：
   真实那行的类型里有一个 `=>`（`(arg?: string) => void`），
   而 `[^=]*` 会在**那个等号**上停住 —— 后面期待 `=\s*{` 于是匹配失败。
   第一版就是这么崩的，而且崩得很响（exit 2 说"解析失败"）——
   这正是要的：**校验坏了要喊，不要静默变绿。** */
const intentBlock = /var SFX_BY_INTENT[\s\S]*?=\s*\{([\s\S]*?)\n\};/.exec(mainSrc);
if (!intentBlock) {
  console.error('[audio-census] 在 src/main.ts 里找不到 `var SFX_BY_INTENT = {…}` —— 解析失败。');
  console.error('  这是**校验坏了**，不是代码坏了：请先修本文件的解析，别去改 main.ts。');
  process.exit(2);
}
const wired = Object.create(null);
for (const m of intentBlock[1].matchAll(/([A-Za-z_$][\w$]*)\s*:\s*function/g)) wired[m[1]] = true;
/* 每个意图转发到哪个音效（用于判据 C） */
const forwards = [];
for (const m of intentBlock[1].matchAll(/([A-Za-z_$][\w$]*)\s*:\s*function[^{]*\{\s*Sfx\.([A-Za-z_$][\w$]*)\s*\(/g)) {
  forwards.push({ intent: m[1], sfx: m[2] });
}
/* 那张表在 `main.ts` 里的行号范围（A″ 用它区分"模拟层广播"与"界面手点"） */
const intentStart = mainSrc.slice(0, intentBlock.index).split('\n').length;
const intentEnd = intentStart + intentBlock[0].split('\n').length - 1;

/* ---------------- A″. 这个调用点是"事件驱动"还是"界面手点" ----------------
   为什么这条要单独标出来：两者**给人的保证不一样**。

     · 在 `main.ts` 的 `SFX_BY_INTENT` 里 —— **模拟层广播的转发**。
       它的意思是"那件事在模拟层发生就必然有声"（击杀 / 命中 / 受伤 / 拾取…），
       与界面无关，所以是最强的一档。
     · 挂在 `G.on('xxx', …)` 里 —— 事件驱动的界面反应（升级 / 清波 / 翻层）。
     · 写在按钮处理里、或直接 `Sfx.click()` —— 只跟玩家的手走。

   判据是结构性的（**只认能当场读出来的形状**，不猜语义）。 */
function eventOf(lines, idx) {
  for (let i = idx; i >= 0 && i > idx - 12; i--) {
    const m = /G\.on\(\s*'([^']+)'/.exec(lines[i] || '');
    if (m) return m[1];
    /* 一行体的回调（`G.on('x', function () { … });`）也在这里被上面那条抓到 */
    if (/^\s*\}\);\s*$/.test(lines[i] || '') && i !== idx) return '';
  }
  return '';
}
/** 这个调用点是不是**模拟层广播的转发**（`main.ts` 的 SFX_BY_INTENT 里那一处）。
 *  它必须与"界面手点"分开：`Sfx.kill()` 写在转发表里，意味着**模拟层每次击杀都响** ——
 *  那是比"界面手点"强得多的保证，混在一起会让这一栏看起来比实际弱。 */
function isBridge(file, line) {
  if (file !== 'main.ts') return false;
  return line >= intentStart && line <= intentEnd;
}
for (const id of declared) {
  callsOf[id] = callsOf[id].map(c => {
    const lines = (code[c.file] || '').split('\n');
    return {
      file: c.file, line: c.line,
      event: isBridge(c.file, c.line) ? '模拟层广播' : eventOf(lines, c.line - 1)
    };
  });
}

const notWired = Object.keys(emittedSet).filter(k => !wired[k]);          // 广播了没人接
const neverEmitted = Object.keys(wired).filter(k => !emittedSet[k]);      // 接了没人广播
const badForward = forwards.filter(f => !declaredSet[f.sfx] && MIX_CTRL.indexOf(f.sfx) < 0);

/* ---------------- 报告 ---------------- */
const PAD = (s, n) => {
  s = String(s);
  return s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 127 ? 2 : 1), 0)));
};

if (JSON_OUT) {
  console.log(JSON.stringify({
    declared: declared.length,
    withCalls: declared.length - neverCalled.length,
    neverCalled,
    emitted: Object.keys(emittedSet).length,
    wired: Object.keys(wired).length,
    notWired, neverEmitted, unknownCalls, badForward
  }, null, 1));
  process.exit(neverCalled.length || notWired.length || unknownCalls.length || badForward.length ? 1 : 0);
}

console.log('\n=== Teapot · 音效调用普查 ===\n');
console.log('  回答一个问题：**该响的时候，有没有人真的去按那个按钮。**');
console.log('  ⚠ 它不回答"声音真的出来了" —— 无头环境没有 `AudioContext`，那一条只能靠人听。\n');

console.log('[A] 声明过的音效 × 调用点（' + declared.length + ' 个）\n');
console.log('  ' + PAD('音效', 16) + PAD('调用点', 8) + PAD('事件', 24) + '出现在');
for (const id of declared) {
  const c = callsOf[id];
  const evs = [...new Set(c.map(x => x.event).filter(Boolean))];
  const where = c.length
    ? [...new Set(c.map(x => x.file))].join(', ') + (c.length > 1 ? '（' + c.length + ' 处）' : '')
    : '\x1b[31m—— 一处都没有\x1b[0m';
  console.log('  ' + (c.length ? '\x1b[32m✔\x1b[0m' : '\x1b[31m✘\x1b[0m') + ' ' +
    PAD(id, 14) + PAD(c.length, 8) + PAD(evs.length ? evs.join(',') : '（界面手点）', 24) + where);
}
console.log('  \x1b[90m「事件」栏有三档，保证强度从高到低：\x1b[0m');
console.log('  \x1b[90m  · 模拟层广播 —— 写在 `main.ts` 的 SFX_BY_INTENT 里，那件事在模拟层发生就必然有声；\x1b[0m');
console.log('  \x1b[90m  · 事件名     —— 挂在 `G.on(…)` 上（升级 / 清波 / 翻层），事件驱动；\x1b[0m');
console.log('  \x1b[90m  · 界面手点   —— 只跟玩家的手走（按钮 / 点击）。这也是对的，只是保证不同。\x1b[0m');

console.log('\n[B] 模拟层广播的音效意图（' + Object.keys(emittedSet).length + ' 个）\n');
console.log('  ' + PAD('意图', 14) + PAD('入口接入', 10) + '转发到');
for (const k of Object.keys(emittedSet).sort()) {
  const fw = forwards.find(f => f.intent === k);
  console.log('  ' + (wired[k] ? '\x1b[32m✔\x1b[0m' : '\x1b[31m✘\x1b[0m') + ' ' +
    PAD(k, 12) + PAD(wired[k] ? '有' : '无', 10) + (fw ? 'Sfx.' + fw.sfx : '\x1b[31m——\x1b[0m'));
}

console.log('\n[C] 入口接入里没人广播的意图\n');
if (!neverEmitted.length) console.log('  \x1b[32m✔ 无\x1b[0m');
else for (const k of neverEmitted) {
  console.log('  \x1b[33m!\x1b[0m ' + k + ' —— 接上了，但模拟层从来不发它（死键）');
}

console.log('\n[D] 调用点指向的音效是否存在\n');
if (!unknownCalls.length && !badForward.length) console.log('  \x1b[32m✔ 每个 `Sfx.X(` 与每条转发都指向声明表里的音效\x1b[0m');
else {
  for (const u of unknownCalls) {
    console.log('  \x1b[31m✘\x1b[0m ' + u.file + ':' + u.line + ' 调用 `Sfx.' + u.id + '` —— 它不在 `Sfx.LIST` 里');
  }
  for (const b of badForward) {
    console.log('  \x1b[31m✘\x1b[0m 意图 `' + b.intent + '` 转发到 `Sfx.' + b.sfx + '` —— 它不在 `Sfx.LIST` 里');
  }
  console.log('  \x1b[90m  这类错的表现是运行期 `Sfx.x is not a function`，或者"那件事永远没声音"。\x1b[0m');
}

console.log('\n=== 结果 ===');
const defects = neverCalled.length + notWired.length + unknownCalls.length + badForward.length;
console.log('  ' + (defects
  ? '\x1b[31m缺陷级\x1b[0m ' + defects + ' 个 \x1b[31m✘\x1b[0m'
  : '\x1b[32m✔ 每个声明过的音效都有调用点、每个意图都被接上了\x1b[0m'));
console.log('  \x1b[36m提示级\x1b[0m：没人广播的接入 ' + neverEmitted.length +
  ' · 从未调用的音效 ' + neverCalled.length);
if (neverCalled.length) {
  console.log('\n  修法二选一：① 在真正发生那件事的地方调用它（这才是"补上声音"）；');
  console.log('              ② 如果它确实不该再响，就从 `Sfx.LIST` 里删掉 ——');
  console.log('                 留着一条永远不会响的声明比没有更糟（下一个照清单改的人会以为它在响）。');
}
console.log('');
process.exit(defects > 0 ? 1 : (STRICT && neverEmitted.length > 0 ? 1 : 0));
