/* =========================================================
   banner.ts — **终端启动横幅**（引擎能力，不是游戏内容）
   ---------------------------------------------------------
   用户 2026-10-02 的口径：「现在他不是游戏内容的，而是**游戏引擎的**」——
   所以横幅讲的是**引擎自己**（版本 / 零运行时依赖 / 零素材 / 三种宿主），
   一个字都不提本作的内容。三种宿主共用这一份能力：

     · **cli**（`src/cli.ts`）—— `help` 打主横幅；`sim` / `serve` 打单行徽标；
       `--json` 一律不打（机器可读输出里不许掺装饰），
       `NO_COLOR` / `--no-color` / 输出重定向走无颜色档。
     · **web / desktop**（`src/main.ts`）—— 启动时往控制台打一条徽标。
       桌面的页面就是 web 那一份，所以两者走同一条路；
       `desktop/shell.mjs` 自己的 stdout **没有接**，理由见 `design/README.md` §五。

   ## 三条纪律（每条都对应一类真实退化）

     1. **数据是生成物**：十一份产物的唯一真相是 `design/banner.py`，本模块读它生成的
        `banner_data.ts`。这同时满足本引擎的**零素材**硬约束 —— 横幅是**代码**，不是资源文件
        （所以浏览器侧也能用：不需要 fetch，也不需要 `public/`）。
     2. **选择是表驱动的**：`FALLBACK` / `VARIANT_FALLBACK` 两张表回答"装不下 / 这一档
        没有这个变体时给哪一份"，**调用点不写 if** —— 写在调用点就会有五种写法。
     3. **降级是判据，不是注释**：`ascii` 档真的无非 ASCII、`nocolor` 档真的无转义、
        `color` / `light` 档真的**有**颜色（"上了色的那一档其实没上色"是最难注意到的一类
        退化 —— 它在深色终端上看着只是"有点朴素"）。`audit()` 逐条判，
        并由 `SelfCheck.register` 在启动期跑。
   ========================================================= */
import { BANNER_DATA, BANNER_VERSION } from './banner_data.ts';
import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';

var Banners = {} as BannersApi;

/* =========================================================
   1. 声明表（四步齐全第 1 件）
   ---------------------------------------------------------
   `BANNER_DATA` 是**产物**（生成物）。这里声明的是**判据**：
   「四档版式各该有哪些变体」是人的决定 —— 抄 `design/README.md` §一 那张表。
   ⚠ 数量**一律从这张表算**（4 + 3 + 2 + 2 = 11），所以 `audit()` 里没有写死的 11。
   ========================================================= */
var TIERS: BannerTier[] = ['framed', 'hero', 'compact', 'badge'];
var VARIANTS: BannerVariant[] = ['color', 'light', 'nocolor', 'ascii'];

/** 每个版式**该有**哪些变体 —— `audit()` 拿它**两个方向**对账（缺一份 / 多一份都红） */
var REQUIRED: Record<BannerTier, BannerVariant[]> = {
  hero: ['color', 'light', 'nocolor', 'ascii'],
  framed: ['color', 'nocolor', 'ascii'],
  compact: ['color', 'ascii'],
  badge: ['color', 'ascii']
};

/** 装不下往哪走：**先保"装得下"，再保"降级档对不对"**（每一跳都拿候选自己的 cols 比） */
var FALLBACK: Record<BannerTier, BannerTier[]> = {
  framed: ['framed', 'hero', 'compact', 'badge'],
  hero: ['hero', 'compact', 'badge'],
  compact: ['compact', 'badge'],
  badge: ['badge']
};

/** 这一档没有这个变体时的替补（例：`light` 只有 `hero` 有 ⇒ 别的档退到无颜色） */
var VARIANT_FALLBACK: Record<BannerVariant, BannerVariant[]> = {
  color: ['color', 'nocolor', 'ascii'],
  light: ['light', 'nocolor', 'ascii'],
  nocolor: ['nocolor', 'ascii'],
  ascii: ['ascii']
};

/* =========================================================
   2. BY_ID（四步齐全第 2 件）
   ========================================================= */
var BY_ID: Record<string, BannerDataEntry> = {};
for (var bi = 0; bi < BANNER_DATA.length; bi++) BY_ID[BANNER_DATA[bi].id] = BANNER_DATA[bi];

/* =========================================================
   3. 显示宽度与转义
   ---------------------------------------------------------
   ⚠ JS 拿不到 Unicode 的 `East_Asian_Width`（正则的 `\p{}` 只支持二值属性与
   `General_Category` / `Script`），而横幅的**框线对齐全靠它**。所以这里**声明**两张表：

     · 宽（2 列）：W/F 两支的码点区间；
     · 窄（1 列）：横幅真的用到的那些**非 ASCII 装饰字符**，逐个点名。

   表外的字符**不算"凑合按 1 列"**，而是返回 NaN 由 `audit()` 点名报错 ——
   宽度猜错的表现是"框线右边补不齐"，而字对齐正是横幅的职责。
   生成器那边用的是 Python 的 `unicodedata`，两边**必须算出同一个数**；
   门 `banner` 会把生成物声明的列数与这里的算法逐份对账。
   ========================================================= */
var WIDE_RANGES = [
  [0x1100, 0x115f], [0x2e80, 0xa4cf], [0xa960, 0xa97f], [0xac00, 0xd7a3],
  [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6b], [0xff00, 0xff60], [0xffe0, 0xffe6]
];
var NARROW_CHARS = '·─│╭╮╰╯█◜◝';
var ESC_CHAR = String.fromCharCode(27);
var VER_RE = /v\d+\.\d+\.\d+(?:-[0-9a-z.]+)?/g;

/** 一个码点的列数：1 / 2 / **0 = 表外**（调用方负责报错） */
function charWidth(c) {
  if (c < 0x80) return 1;
  for (var i = 0; i < WIDE_RANGES.length; i++) {
    if (c >= WIDE_RANGES[i][0] && c <= WIDE_RANGES[i][1]) return 2;
  }
  if (NARROW_CHARS.indexOf(String.fromCodePoint(c)) >= 0) return 1;
  return 0;
}

/** 去掉真彩转义（数宽度只数**可见**的部分）—— 不用正则，免得把 ESC 写进源码字面量 */
Banners.strip = function (s) {
  var out = '';
  for (var i = 0; i < s.length; i++) {
    if (s.charAt(i) === ESC_CHAR) {
      while (i < s.length && s.charAt(i) !== 'm') i++;   // 跳到这个序列的结尾
      continue;
    }
    out += s.charAt(i);
  }
  return out;
};
Banners.hasEsc = function (s) { return s.indexOf(ESC_CHAR) >= 0; };
Banners.width = function (line) {
  var s = Banners.strip(line);
  var n = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.codePointAt(i);
    if (c > 0xffff) i++;                                  // 代理对：一个码点两格
    var w = charWidth(c);
    if (!w) return NaN;                                   // 表外：交给 audit 报错
    n += w;
  }
  return n;
};

/** 这一行里**宽度表外**的字符（报错用：连码点一起打出来，否则没人查得动） */
function outsideChars(line) {
  var s = Banners.strip(line), out = [], seen: Record<string, boolean> = {};
  for (var i = 0; i < s.length; i++) {
    var c = s.codePointAt(i);
    if (c > 0xffff) i++;
    if (charWidth(c)) continue;
    var ch = String.fromCodePoint(c);
    if (seen[ch]) continue;
    seen[ch] = true;
    out.push(ch + '(U+' + c.toString(16).toUpperCase() + ')');
  }
  return out;
}

/** 这几行里的非 ASCII 字符（去重，按出现顺序） */
function nonAsciiChars(lines) {
  var out = [], seen: Record<string, boolean> = {};
  for (var i = 0; i < lines.length; i++) {
    for (var j = 0; j < lines[i].length; j++) {
      var ch = lines[i].charAt(j);
      if (ch.charCodeAt(0) < 128 || seen[ch]) continue;
      seen[ch] = true;
      out.push(ch);
    }
  }
  return out;
}

function hasTier(t) {
  for (var i = 0; i < BANNER_DATA.length; i++) if (BANNER_DATA[i].tier === t) return true;
  return false;
}

/* =========================================================
   4. 选择：**宿主给能力，引擎给产物**（纯函数，不读环境、不打印）
   ========================================================= */
Banners.VERSION = BANNER_VERSION;
Banners.LIST = BANNER_DATA;
Banners.BY_ID = BY_ID;
Banners.TIERS = TIERS;
Banners.VARIANTS = VARIANTS;
Banners.REQUIRED = REQUIRED;
Banners.FALLBACK = FALLBACK;
Banners.VARIANT_FALLBACK = VARIANT_FALLBACK;
Banners.WIDE_RANGES = WIDE_RANGES;
Banners.NARROW_CHARS = NARROW_CHARS;

/** 宿主的能力 → 想要哪个变体（四条优先级是**声明**，不是散落的 if） */
function wantedVariant(env) {
  if (env.ascii) return 'ascii';
  if (env.color === false) return 'nocolor';
  if (env.light) return 'light';
  return 'color';
}

Banners.pick = function (env?: BannerEnv) {
  var e = env || {};
  var want: BannerVariant = wantedVariant(e);
  var tier: BannerTier = TIERS.indexOf(e.tier) >= 0 ? e.tier : 'hero';
  var cols = (typeof e.cols === 'number' && isFinite(e.cols) && e.cols > 0) ? e.cols : 80;
  var chain = FALLBACK[tier] || FALLBACK.hero;
  var subs = VARIANT_FALLBACK[want] || ['ascii'];
  var smallest = null;
  for (var t = 0; t < chain.length; t++) {
    for (var v = 0; v < subs.length; v++) {
      var hit = BY_ID[chain[t] + '-' + subs[v]];
      if (!hit) continue;
      if (hit.cols <= cols) return hit;
      /* 一档都装不下时给**最窄的那一份**：宁可挤一点，也不能什么都不打 */
      if (!smallest || hit.cols < smallest.cols) smallest = hit;
    }
  }
  return smallest;
};

Banners.text = function (env?: BannerEnv, tail?: boolean) {
  var e = Banners.pick(env);
  return e ? e.lines.join('\n') + (tail ? '\n' : '') : '';
};

/* =========================================================
   5. 启动期自检（四步齐全第 3 件）
   ---------------------------------------------------------
   每条判据都对应一类真实退化 —— 尤其是"上了色的档其实没上色"与
   "某一档的 ascii 化做了一半"（这两种在深色终端上**看着都正常**）。
   ========================================================= */
Banners.audit = function () {
  var problems: string[] = [];
  var byKey: Record<string, BannerDataEntry> = {};
  var seenId: Record<string, boolean> = {};
  var i, j;

  for (i = 0; i < BANNER_DATA.length; i++) {
    var b = BANNER_DATA[i];
    var key = b.tier + '-' + b.variant;
    if (byKey[key]) problems.push('同一档出了两份：' + key);
    byKey[key] = b;
    if (b.id !== key) problems.push('id「' + b.id + '」与「版式-变体」对不上（应当是「' + key + '」）');
    if (seenId[b.id]) problems.push('id 重复：' + b.id);
    seenId[b.id] = true;
    if (TIERS.indexOf(b.tier) < 0) problems.push(b.id + '：版式「' + b.tier + '」不在声明的四档里');
    if (VARIANTS.indexOf(b.variant) < 0) problems.push(b.id + '：变体「' + b.variant + '」不在声明的四种里');
    if (!b.lines || b.lines.length === 0) { problems.push(b.id + '：一行都没有'); continue; }
    if (b.rows !== b.lines.length) {
      problems.push(b.id + '：声明 ' + b.rows + ' 行，实际 ' + b.lines.length + ' 行');
    }
    /* 宽度：**逐字符**都要在声明的宽度表里 */
    var widest = 0;
    for (j = 0; j < b.lines.length; j++) {
      var w = Banners.width(b.lines[j]);
      if (w !== w) {                                     // NaN：宽度表外的字符
        problems.push(b.id + ' 第 ' + (j + 1) + ' 行有**宽度表外**的字符：' +
          outsideChars(b.lines[j]).join(' '));
        continue;
      }
      if (w > widest) widest = w;
    }
    if (widest !== b.cols) {
      problems.push(b.id + '：声明 ' + b.cols + ' 列，按显示宽度算是 ' + widest + ' 列');
    }
    /* 三条降级判据 —— **"降级"这两个字的意义全在这里** */
    var esc = false;
    for (j = 0; j < b.lines.length; j++) if (Banners.hasEsc(b.lines[j])) esc = true;
    if (b.variant === 'ascii') {
      var na = nonAsciiChars(b.lines);
      if (na.length) problems.push(b.id + ' 是 ascii 档，却有非 ASCII 字符：' + na.join(' '));
      if (esc) problems.push(b.id + ' 是 ascii 档，却带真彩转义');
    } else if (b.variant === 'nocolor') {
      if (esc) {
        problems.push(b.id + ' 是 nocolor 档，却带真彩转义' +
          '（重定向出去的文件里会多出一堆看不见的乱码）');
      }
    } else if (!esc) {
      problems.push(b.id + ' 是 ' + b.variant + ' 档，却**一处颜色都没有**' +
        '（上色是这一档的全部意义）');
    }
    /* 版本号只许有一个出处 */
    for (j = 0; j < b.lines.length; j++) {
      var plain = Banners.strip(b.lines[j]);
      var m = plain.match(VER_RE);
      if (!m) continue;
      for (var k = 0; k < m.length; k++) {
        if (m[k] !== 'v' + BANNER_VERSION) {
          problems.push(b.id + ' 里的版本 ' + m[k] + ' 不是生成器顶部声明的 v' + BANNER_VERSION);
        }
      }
    }
  }

  /* 矩阵**两个方向**：该有的一份都不许缺；没声明过的多一份也不许 */
  for (i = 0; i < TIERS.length; i++) {
    var tier = TIERS[i];
    for (j = 0; j < REQUIRED[tier].length; j++) {
      if (!byKey[tier + '-' + REQUIRED[tier][j]]) {
        problems.push('缺一份产物：' + tier + '-' + REQUIRED[tier][j] +
          '（`design/README.md` §一 的表声明过它）');
      }
    }
  }
  for (var kk in byKey) {
    if (!Object.prototype.hasOwnProperty.call(byKey, kk)) continue;
    var e2 = byKey[kk];
    if (REQUIRED[e2.tier] && REQUIRED[e2.tier].indexOf(e2.variant) >= 0) continue;
    problems.push('多出一份没声明过的产物：' + kk + '（要么补进 REQUIRED，要么从生成器删掉）');
  }

  /* 降级链：**每一跳都要真的落地**，否则"降级"会在运行期静默取到 undefined */
  for (i = 0; i < TIERS.length; i++) {
    var t2 = TIERS[i];
    var chain = FALLBACK[t2];
    if (!chain || !chain.length) { problems.push('缺少档 ' + t2 + ' 的降级链'); continue; }
    if (chain.indexOf(t2) !== 0) {
      problems.push('档 ' + t2 + ' 的降级链必须从它自己开始（现在第一跳是 ' + chain[0] + '）');
    }
    for (j = 0; j < chain.length; j++) {
      if (TIERS.indexOf(chain[j]) < 0) {
        problems.push('档 ' + t2 + ' 的降级链指向没声明的档 ' + chain[j]);
        continue;
      }
      if (!hasTier(chain[j])) {
        problems.push('档 ' + t2 + ' 的降级链指向一个**一份产物都没有**的档 ' + chain[j]);
      }
    }
  }
  for (i = 0; i < VARIANTS.length; i++) {
    var v = VARIANTS[i];
    var subs = VARIANT_FALLBACK[v];
    if (!subs || !subs.length) { problems.push('缺少变体 ' + v + ' 的替补链'); continue; }
    if (subs[subs.length - 1] !== 'ascii') {
      problems.push('变体 ' + v + ' 的替补链必须以 ascii 收尾' +
        '（ascii 是每一档都**一定存在**的那一份）');
    }
    for (j = 0; j < subs.length; j++) {
      if (VARIANTS.indexOf(subs[j]) < 0) problems.push('变体 ' + v + ' 的替补链里有没声明的变体 ' + subs[j]);
    }
  }
  if (!BANNER_VERSION) problems.push('BANNER_VERSION 是空的（生成器顶部那份 VERSION 没写？）');
  return { ok: problems.length === 0, problems: problems };
};

/* =========================================================
   6. 注册进总账（四步齐全第 4 件）
   ---------------------------------------------------------
   三个家族："四档版式"与"四种变体"是**值域**，`banner` 的每一条都**引用**它们 ——
   于是版式名 / 变体名写错由 `Registry.audit()` 抓（总账机制本来就干这个，不用自己写）。
   ========================================================= */
Registry.family('bannerTier', {
  note: '启动横幅的四档版式（**大 → 小**：卡框 / 主横幅 / 紧凑 / 徽标）', owner: 'banner.ts',
  values: function () { return TIERS.slice(); }
});
Registry.family('bannerVariant', {
  note: '启动横幅的四种降级变体（深底真彩 / 浅底真彩 / 无转义 / 纯 ASCII）', owner: 'banner.ts',
  values: function () { return VARIANTS.slice(); }
});
Registry.family('banner', {
  note: '引擎启动横幅的十一份产物（**生成物**：唯一真相是 `design/banner.py`）',
  owner: 'banner.ts / banner_data.ts',
  entries: function () {
    var out: RegistryEntry[] = [];
    for (var i = 0; i < BANNER_DATA.length; i++) {
      var b = BANNER_DATA[i];
      out.push({ id: b.id, refs: [
        { field: 'tier', value: b.tier, family: 'bannerTier' },
        { field: 'variant', value: b.variant, family: 'bannerVariant' }
      ] });
    }
    return out;
  }
});
SelfCheck.register('banner', Banners.audit);

export { Banners };
