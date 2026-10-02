/* =========================================================
   color-audit.mjs — **颜色门**（A07）：颜色只能有一个出处
   ---------------------------------------------------------
   为什么需要它（这是账本 A07，也是本项目**唯一一条"文档说了一道不存在的门"**）：

   `AGENTS.md` 第十节第 7 条写着"手写硬编码颜色会被 `hardcode` 与 `PAL` **两道门**抓"。
   实测第二道门**不存在**：
     · `tools/hardcode-audit.cjs` 的三条判据全是"算术式 / 格式化配方" ——
       **结构上匹配不到颜色字符串**；
     · 它还把 `sprites.ts` 那类渲染层文件**整文件排除**。
   于是一年下来攒了 **99 处颜色字面量**，其中 **9 处是 `PAL` 已有键的逐字节副本**
   （`render.ts` 的 `#e2564f = PAL.LASER` / `#100d0c = PAL.INK` / `#f2e6c8 = PAL.CREAM`
   / `#e8b23c = PAL.GOLD`，`sprites.ts` 的 `#8ab84f = PAL.TOXIC` / `#4a423b = PAL.DARK`），
   还有三组"**跨文件同一概念两份**"（血条底槽 / 三扇门色 / 豆豆高光）。

   ## 判据（三条，逐条对应一次实测）

     1. **`PAL` 已有键的逐字节副本 → 红**。`PAL` 是颜色的唯一出处（美术宪法第 3 条），
        照抄一个十六进制值就是把它变成**第二份真相** —— 改 `PAL` 时它不会跟着变。
        （实测：改 `PAL.INK` 那条宪法色，那 9 处副本全都不会变。）
     2. **同一个十六进制值出现在两个以上文件、且不在 `PAL` 里 → 红**（除非在允许清单）。
        这是"同一概念两份"的机器判据 —— 三扇门色那一组就是这么被抓出来的。
     3. **允许清单必须带理由**（照 `art_spec.DEFERRED` 与 `hardcode-audit` 基线的写法）。
        清单里的东西是**内容**（每个值属于某一条数据：怪物本色 / 道具 tint / 主题色），
        不是"散落的颜色" —— 两者性质不同，判据也不同。

   ⚠ **本门不判"美术层里出现了颜色"**（那是宪法第 3 条的字面意思，但一刀切会把
     数据表里的内容色全部误伤）。它判的是**同一个值有没有第二个出处**。
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');
const JSON_OUT = process.argv.includes('--json');
const VERBOSE = process.argv.includes('--all');

/* =========================================================
   1. `PAL` 的唯一出处
   ========================================================= */
const utilsSrc = fs.readFileSync(path.join(SRC, 'utils.ts'), 'utf8');
const PAL = {};
for (const m of utilsSrc.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*:\s*'(#[0-9a-fA-F]{3,8})'/gm)) {
  PAL[m[1]] = m[2].toLowerCase();
}
/* 同一 `PAL` 值可能有多个键（别名）—— 建反向表时保留全部，报告里说清是哪一个 */
const PAL_BY_HEX = {};
for (const k of Object.keys(PAL)) (PAL_BY_HEX[PAL[k]] = PAL_BY_HEX[PAL[k]] || []).push(k);

/* =========================================================
   2. 允许清单：**内容色**（每个值属于某一条数据 / 某个风格档）
   ---------------------------------------------------------
   清单里每一行都要写清"为什么它可以是字面量"。
   ⚠ 允许清单**只能变小或持平** —— 往里加一条等于把一处颜色变成内容，
     而"它是不是内容"要能一句话说清（说不清就是散落的颜色）。
   ========================================================= */
const ALLOW_FILES = {
  'appearance.ts': '**色板表**：34 个外观配色（肤色 / 发色 / 衣服）——每个值属于某一个外观档，是内容',
  'sprites.ts': '**`STATION_TINT`**（三扇门的站点色）与**怪物/装备的 tint 表**——每个值属于某一条数据，是内容',
  'enemies.ts': '**怪物本色**——每个值属于某一种怪，是内容',
  'data_items.ts': '**道具 tint**——每个值属于某一件道具，是内容',
  'data_weapons.ts': '**武器 tint**——每个值属于某一把武器，是内容',
  'dungeon.ts': '**楼层主题色**——每个值属于某一层的主题，是内容',
  'art_shaders.ts': '**着色器效果色**（打击白闪 / 毒绿 / 血红的叠色系数）——属于效果定义',
  'art_parallax.ts': '**视差层的层色**——每个值属于某一层背景',
  'art_tiles.ts': '**瓦片材质色**——每个值属于某一种材质',
  'bronana.ts': '**豆豆的配色注入点**（默认值会被 `appearance` 覆盖）——属于角色定义',
  'music.ts': '不是绘制颜色（频谱 / 音轨的标识色），与美术宪法无关',
  'audio.ts': '不是绘制颜色',
  'name-audit.mjs': '不是源码'
};

/* ---------------- 扫源码 ---------------- */
const files = fs.readdirSync(SRC).filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts') && f !== 'utils.ts');
/* 六位与三位十六进制、带 `#`、在引号里（只认字符串字面量：变量名 / 注释不算） */
const HEX = /'#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})'|"#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})"/g;

const problems = [];
const notes = [];
const byHex = {};      // 值 → [{file,line}]
const literalTotal = { n: 0 };

for (const f of files) {
  const text = fs.readFileSync(path.join(SRC, f), 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    /* 去掉行注释，避免把注释里的示例色算进来（历史叙述里会写 `#100d0c`） */
    const code = line.replace(/\/\/.*$/, '');
    for (const m of code.matchAll(HEX)) {
      const hex = ('#' + (m[1] || m[2])).toLowerCase();
      literalTotal.n++;
      (byHex[hex] = byHex[hex] || []).push({ file: f, line: i + 1 });
    }
  });
}

/* ---------------- 判据 1：`PAL` 已有键的逐字节副本 ----------------
   ⚠ 这一条**不设"要几处才算"的门槛**：照抄一次也是把 `PAL` 变成第二份真相。
     实测踩到：第一版漏掉了 `render.ts:1533` 的 `#f2e6c8`（= `PAL.SPARK` / `PAL.CREAM`），
     因为它同时还出现在别的文件里、被跨文件那条的算法盖住了。
     **一条判据只能有一个理由**：这条的理由是"这个值 `PAL` 里已经有了"。 */
const CONTENT_FILES = {
  'data_chars.ts': '**角色 tint**（`tint: [本色, 暗色]` 属于某一个可选角色）——与 `enemies` / '
    + '`data_items` / `data_weapons` 的 tint 是同一类，**是内容**。'
    + '它撞上 `PAL.SKIN` 只是"某个角色的本色恰好等于默认肤色"，不是"散落的颜色"'
};
const palCopies = [];
for (const hex of Object.keys(byHex)) {
  if (!PAL_BY_HEX[hex]) continue;
  for (const at of byHex[hex]) {
    if (CONTENT_FILES[at.file] || ALLOW_FILES[at.file]) continue;
    palCopies.push({ hex, key: PAL_BY_HEX[hex][0], keys: PAL_BY_HEX[hex], ...at });
  }
}
for (const c of palCopies) {
  problems.push(c.file + ':' + c.line + ' 的 ' + c.hex + ' 是 `PAL.' + c.key + '` 的**逐字节副本**' +
    '（照抄 = 把它变成第二份真相：改 `PAL` 时这里不会跟着变）');
}
/* 内容文件里撞上 `PAL` 的：提示级（不判红，因为它属于某条数据） */
const palInContent = [];
for (const hex of Object.keys(byHex)) {
  if (!PAL_BY_HEX[hex]) continue;
  for (const at of byHex[hex]) {
    if (CONTENT_FILES[at.file] || ALLOW_FILES[at.file]) palInContent.push({ hex, key: PAL_BY_HEX[hex][0], ...at });
  }
}
/* `PAL` **自己**里的重复值：不判红（宪法已经这么定了），但值得知道 ——
   实测 `CREAM` 与 `SPARK` 是同一个值、两个名字。 */
const palSelfDup = Object.keys(PAL_BY_HEX).filter(h => PAL_BY_HEX[h].length > 1);

/* ---------------- 判据 2：跨文件同一个值（"同一概念两份"） ----------------
   ⚠ 这一条**改过一次**，写清为什么（第一版太松，放过了真问题）：
     第一版把"在允许清单里的文件"整个跳过。于是 `#c47a5c` 出现在
     `render.ts` ＋ `sprites.ts`（三扇门色那一组）**被放过了** ——
     因为 `sprites.ts` 在允许清单里，`outside` 就只剩一项。
     而"同一概念两份"的判据恰恰是**两处**：一处是内容（`sprites.ts` 的 `STATION_TINT`），
     另一处是**散落的副本**（`render.ts` 直接写死同一个值）。
   正确的算法：**先把允许清单里的出现剔除，再看剩下的非允许出现有几个** ——
     剩下的 ≥ 2 才算"两个地方各写一份"；剩下的恰好 1 个则由
     `PAL` 那一层回答（如果值在 `PAL` 里，判据 1 已经抓了；不在就提示级）。 */
const crossFile = [];
for (const hex of Object.keys(byHex)) {
  const at = byHex[hex];
  const all = [...new Set(at.map(a => a.file))];
  if (all.length < 2) continue;
  const outside = at.filter(a => !ALLOW_FILES[a.file]);
  const outsideFiles = [...new Set(outside.map(a => a.file))];
  if (outsideFiles.length < 2) {
    if (outside.length) {
      notes.push('跨文件的 ' + hex + ' 只有一处**不在**允许清单里（' + outsideFiles[0] +
        ':' + outside[0].line + '）—— 另一处是内容，不再判"两份"');
    }
    continue;
  }
  crossFile.push({ hex, files: all, outsideFiles, at, outside, palKey: PAL_BY_HEX[hex] ? PAL_BY_HEX[hex][0] : null });
}
for (const c of crossFile) {
  problems.push('同一个颜色值 ' + c.hex + ' 在 ' + c.outsideFiles.length + ' 个**非内容**文件里各写了一份' +
    (c.palKey ? '（`PAL.' + c.palKey + '` 已经是它的出处）' : '（且不在 `PAL` 里 —— 需要给它一个名字）') +
    '：' + c.outside.map(a => a.file + ':' + a.line).join('  '));
}

const result = {
  palKeys: Object.keys(PAL).length,
  literalTotal: literalTotal.n,
  filesWithLiterals: Object.keys(byHex).length ? [...new Set(Object.values(byHex).flat().map(a => a.file))].length : 0,
  palCopies: palCopies.length, palInContent: palInContent.length,
  crossFile: crossFile.length, palSelfDup, problems
};

if (JSON_OUT) { console.log(JSON.stringify(result)); process.exit(problems.length ? 1 : 0); }

console.log('\n=== Teapot · 颜色门（A07）===\n');
console.log('  `PAL` 键 ' + result.palKeys + ' 个 · 源码里的颜色字面量 ' + literalTotal.n +
  ' 处（' + result.filesWithLiterals + ' 个文件）');
console.log('  判据：**同一个颜色值不许有第二个出处**（照抄 `PAL` / 跨文件各写一份）');

console.log('\n[1] `PAL` 已有键的逐字节副本（判红）');
if (!palCopies.length) console.log('    ✔ 一处都没有 —— 颜色只有一个出处');
else {
  console.log('    ✘ ' + palCopies.length + ' 处：');
  for (const p of palCopies) console.log('      · ' + p.file + ':' + p.line + '  ' + p.hex + ' → `PAL.' + p.key + '`');
}

console.log('\n[2] 跨文件的同一个值（"同一概念两份"，判红）');
const cfProblems = crossFile;
if (!cfProblems.length) console.log('    ✔ 没有');
else for (const c of cfProblems) {
  console.log('    ✘ ' + c.hex + (c.palKey ? '（= PAL.' + c.palKey + '）' : '') + ' 在 ' +
    c.outsideFiles.join(' + '));
}

if (VERBOSE) {
  console.log('\n[·] 全部颜色字面量（--all）');
  for (const hex of Object.keys(byHex).sort()) {
    console.log('    ' + hex + '  ×' + byHex[hex].length + '  ' +
      byHex[hex].map(a => a.file).filter((v, i, s) => s.indexOf(v) === i).join(' '));
  }
}

console.log('\n[3] 提示级（不判红）');
console.log('    允许清单里的文件（**内容是颜色的合法住处**）：');
for (const f of Object.keys(ALLOW_FILES)) {
  const n = files.includes(f) ? (Object.values(byHex).flat().filter(a => a.file === f).length) : 0;
  if (n) console.log('      ' + f.padEnd(20) + ' ×' + String(n).padEnd(4) + ALLOW_FILES[f]);
}
if (palInContent.length) {
  console.log('    内容文件里撞上 `PAL` 值的 ' + palInContent.length + ' 处（**不判红**：它属于某条数据，' +
    '但值得看一眼是不是该直接读 `PAL`）：');
  for (const p of palInContent.slice(0, 6)) console.log('      ' + p.file + ':' + p.line + '  ' + p.hex + '（= `PAL.' + p.key + '`）');
  if (palInContent.length > 6) console.log('      …… 还有 ' + (palInContent.length - 6) + ' 处');
}
if (palSelfDup.length) {
  console.log('    `PAL` 自己里的重复值（两个名字同一个值，宪法已定，不判红）：');
  for (const h of palSelfDup) console.log('      ' + h + ' → ' + PAL_BY_HEX[h].join(' / '));
}
for (const n of notes.slice(0, 6)) console.log('    · ' + n);

console.log('\n=== 结果 ===');
if (problems.length) {
  console.log('  ✘ 颜色有两个出处 ' + problems.length + ' 处');
  console.log('    处置：**改回读 `PAL.<键>`**（零可见变化）；真需要新名字就往 `PAL` 加一个键。');
  console.log('    ⚠ 不要靠往允许清单里加文件来变绿 —— 清单里只放**内容色**（每个值属于某条数据），');
  console.log('      而"它是不是内容"要能一句话说清。');
  process.exit(1);
}
console.log('  ✔ 颜色只有一个出处（`PAL`），跨文件没有同一概念两份');
