/* =========================================================
   banner_data.ts — **生成物**：`python design/banner.py` 写出来的
   ---------------------------------------------------------
   ⚠ **不要手改这个文件**：改横幅要改 `design/banner.py`，然后重新生成。
      生成器同时写出两样东西，而这两样是**同一份产物**：
        · `design/banner-*.txt` —— 十一份文本（给人看、给脚本贴）
        · `src/banner_data.ts`  —— 本文件（给引擎读）
      门 `banner`（`tools/banner-audit.mjs`）逐字节对账这两边。

   为什么是"生成 TS"而不是运行时去读 `.txt`：
     1. 引擎要在**三种宿主**下都能用（web / cli / desktop）—— 浏览器侧读不到磁盘；
     2. 本引擎的硬约束是**零素材**（`AGENTS.md` §四之三）：横幅是**代码**，不是资源文件。

   字段含义见 `src/types.d.ts` 的 `BannerDataEntry`。
   ========================================================= */

/** 引擎版本：**唯一声明处**是 `design/banner.py` 顶部的 VERSION —— 十一份里不许有第二个值 */
export var BANNER_VERSION = '0.1.0-alpha';

/** 十一份产物（四档版式 × 降级）。**加一档要改生成器**，不要手加 */
export var BANNER_DATA: BannerDataEntry[] = [
  {
    id: 'hero-color', tier: 'hero', variant: 'color',
    file: 'banner-hero.txt', cols: 39, rows: 12,
    lines: [
      "\u001b[38;2;143;191;107m  ──\u001b[0m",
      "    \u001b[38;2;255;255;255m█████ █████  ███  ████   ███  █████\u001b[0m",
      "    \u001b[38;2;255;255;255m  █   █     █   █ █   █ █   █   █\u001b[0m",
      "    \u001b[38;2;255;255;255m  █   █     █   █ █   █ █   █   █\u001b[0m",
      "    \u001b[38;2;255;255;255m  █   ████  █████ ████  █   █   █\u001b[0m",
      "    \u001b[38;2;255;255;255m  █   █     █   █ █     █   █   █\u001b[0m",
      "    \u001b[38;2;255;255;255m  █   █     █   █ █     █   █   █\u001b[0m",
      "    \u001b[38;2;255;255;255m  █   █████ █   █ █      ███    █\u001b[0m",
      "    \u001b[38;2;143;191;107mEVERYTHING IS A MODULE\u001b[0m",
      "    \u001b[38;2;125;154;99mTypeScript · 原生 ES 模块\u001b[0m",
      "    \u001b[38;2;125;154;99m零运行时依赖 · 零素材 · 无构建步\u001b[0m",
      "    \u001b[38;2;125;154;99m三种宿主：web · cli · desktop\u001b[0m",
    ]
  },
  {
    id: 'hero-light', tier: 'hero', variant: 'light',
    file: 'banner-hero-light.txt', cols: 39, rows: 12,
    lines: [
      "\u001b[38;2;143;191;107m  ──\u001b[0m",
      "    \u001b[38;2;74;107;51m█████ █████  ███  ████   ███  █████\u001b[0m",
      "    \u001b[38;2;74;107;51m  █   █     █   █ █   █ █   █   █\u001b[0m",
      "    \u001b[38;2;74;107;51m  █   █     █   █ █   █ █   █   █\u001b[0m",
      "    \u001b[38;2;74;107;51m  █   ████  █████ ████  █   █   █\u001b[0m",
      "    \u001b[38;2;74;107;51m  █   █     █   █ █     █   █   █\u001b[0m",
      "    \u001b[38;2;74;107;51m  █   █     █   █ █     █   █   █\u001b[0m",
      "    \u001b[38;2;74;107;51m  █   █████ █   █ █      ███    █\u001b[0m",
      "    \u001b[38;2;143;191;107mEVERYTHING IS A MODULE\u001b[0m",
      "    \u001b[38;2;90;107;74mTypeScript · 原生 ES 模块\u001b[0m",
      "    \u001b[38;2;90;107;74m零运行时依赖 · 零素材 · 无构建步\u001b[0m",
      "    \u001b[38;2;90;107;74m三种宿主：web · cli · desktop\u001b[0m",
    ]
  },
  {
    id: 'hero-nocolor', tier: 'hero', variant: 'nocolor',
    file: 'banner-hero-nocolor.txt', cols: 39, rows: 12,
    lines: [
      "  ──",
      "    █████ █████  ███  ████   ███  █████",
      "      █   █     █   █ █   █ █   █   █",
      "      █   █     █   █ █   █ █   █   █",
      "      █   ████  █████ ████  █   █   █",
      "      █   █     █   █ █     █   █   █",
      "      █   █     █   █ █     █   █   █",
      "      █   █████ █   █ █      ███    █",
      "    EVERYTHING IS A MODULE",
      "    TypeScript · 原生 ES 模块",
      "    零运行时依赖 · 零素材 · 无构建步",
      "    三种宿主：web · cli · desktop",
    ]
  },
  {
    id: 'hero-ascii', tier: 'hero', variant: 'ascii',
    file: 'banner-hero-ascii.txt', cols: 51, rows: 12,
    lines: [
      "  --",
      "    ##### #####  ###  ####   ###  #####",
      "      #   #     #   # #   # #   #   #",
      "      #   #     #   # #   # #   #   #",
      "      #   ####  ##### ####  #   #   #",
      "      #   #     #   # #     #   #   #",
      "      #   #     #   # #     #   #   #",
      "      #   ##### #   # #      ###    #",
      "    EVERYTHING IS A MODULE",
      "    TypeScript / native ES modules",
      "    zero runtime deps / zero assets / no build step",
      "    three hosts: web / cli / desktop",
    ]
  },
  {
    id: 'framed-color', tier: 'framed', variant: 'color',
    file: 'banner-framed.txt', cols: 66, rows: 15,
    lines: [
      "\u001b[38;2;74;107;51m╭────────────────────────────────────────────────────────────────╮\u001b[0m",
      "\u001b[38;2;74;107;51m│\u001b[0m                                                                \u001b[38;2;74;107;51m│\u001b[0m",
      "\u001b[38;2;74;107;51m│\u001b[0m              \u001b[38;2;255;255;255m█████ █████  ███  ████   ███  █████\u001b[0m               \u001b[38;2;74;107;51m│\u001b[0m",
      "\u001b[38;2;74;107;51m│\u001b[0m               \u001b[38;2;255;255;255m  █   █     █   █ █   █ █   █   █\u001b[0m                \u001b[38;2;74;107;51m│\u001b[0m",
      "\u001b[38;2;74;107;51m│\u001b[0m               \u001b[38;2;255;255;255m  █   █     █   █ █   █ █   █   █\u001b[0m                \u001b[38;2;74;107;51m│\u001b[0m",
      "\u001b[38;2;74;107;51m│\u001b[0m               \u001b[38;2;255;255;255m  █   ████  █████ ████  █   █   █\u001b[0m                \u001b[38;2;74;107;51m│\u001b[0m",
      "\u001b[38;2;74;107;51m│\u001b[0m               \u001b[38;2;255;255;255m  █   █     █   █ █     █   █   █\u001b[0m                \u001b[38;2;74;107;51m│\u001b[0m",
      "\u001b[38;2;74;107;51m│\u001b[0m               \u001b[38;2;255;255;255m  █   █     █   █ █     █   █   █\u001b[0m                \u001b[38;2;74;107;51m│\u001b[0m",
      "\u001b[38;2;74;107;51m│\u001b[0m               \u001b[38;2;255;255;255m  █   █████ █   █ █      ███    █\u001b[0m                \u001b[38;2;74;107;51m│\u001b[0m",
      "\u001b[38;2;74;107;51m│\u001b[0m                                                                \u001b[38;2;74;107;51m│\u001b[0m",
      "\u001b[38;2;74;107;51m│\u001b[0m                     \u001b[38;2;143;191;107mEVERYTHING IS A MODULE\u001b[0m                     \u001b[38;2;74;107;51m│\u001b[0m",
      "\u001b[38;2;74;107;51m│\u001b[0m                                                                \u001b[38;2;74;107;51m│\u001b[0m",
      "\u001b[38;2;74;107;51m│\u001b[0m   \u001b[38;2;125;154;99mv0.1.0-alpha  ·  TypeScript  ·  零运行时依赖  ·  无构建步\u001b[0m    \u001b[38;2;74;107;51m│\u001b[0m",
      "\u001b[38;2;74;107;51m│\u001b[0m                                                                \u001b[38;2;74;107;51m│\u001b[0m",
      "\u001b[38;2;74;107;51m╰────────────────────────────────────────────────────────────────╯\u001b[0m",
    ]
  },
  {
    id: 'framed-nocolor', tier: 'framed', variant: 'nocolor',
    file: 'banner-framed-nocolor.txt', cols: 66, rows: 15,
    lines: [
      "╭────────────────────────────────────────────────────────────────╮",
      "│                                                                │",
      "│              █████ █████  ███  ████   ███  █████               │",
      "│                 █   █     █   █ █   █ █   █   █                │",
      "│                 █   █     █   █ █   █ █   █   █                │",
      "│                 █   ████  █████ ████  █   █   █                │",
      "│                 █   █     █   █ █     █   █   █                │",
      "│                 █   █     █   █ █     █   █   █                │",
      "│                 █   █████ █   █ █      ███    █                │",
      "│                                                                │",
      "│                     EVERYTHING IS A MODULE                     │",
      "│                                                                │",
      "│   v0.1.0-alpha  ·  TypeScript  ·  零运行时依赖  ·  无构建步    │",
      "│                                                                │",
      "╰────────────────────────────────────────────────────────────────╯",
    ]
  },
  {
    id: 'framed-ascii', tier: 'framed', variant: 'ascii',
    file: 'banner-framed-ascii.txt', cols: 66, rows: 15,
    lines: [
      "+----------------------------------------------------------------+",
      "|                                                                |",
      "|              ##### #####  ###  ####   ###  #####               |",
      "|                 #   #     #   # #   # #   #   #                |",
      "|                 #   #     #   # #   # #   #   #                |",
      "|                 #   ####  ##### ####  #   #   #                |",
      "|                 #   #     #   # #     #   #   #                |",
      "|                 #   #     #   # #     #   #   #                |",
      "|                 #   ##### #   # #      ###    #                |",
      "|                                                                |",
      "|                     EVERYTHING IS A MODULE                     |",
      "|                                                                |",
      "|  v0.1.0-alpha  -  TypeScript  -  zero deps  -  no build step   |",
      "|                                                                |",
      "+----------------------------------------------------------------+",
    ]
  },
  {
    id: 'compact-color', tier: 'compact', variant: 'color',
    file: 'banner-compact.txt', cols: 51, rows: 3,
    lines: [
      "\u001b[38;2;143;191;107m ◜\u001b[0m\u001b[38;2;255;255;255m◝\u001b[0m  \u001b[38;2;74;107;51mT E A P O T   E N G I N E\u001b[0m   \u001b[38;2;125;154;99mv0.1.0-alpha\u001b[0m",
      "\u001b[38;2;90;107;74m ──────────────────────────────────────────────────\u001b[0m",
      "\u001b[38;2;125;154;99m 白瓷 · 茶绿 · TypeScript · 零运行时依赖 · 无构建步\u001b[0m",
    ]
  },
  {
    id: 'compact-ascii', tier: 'compact', variant: 'ascii',
    file: 'banner-compact-ascii.txt', cols: 67, rows: 3,
    lines: [
      " (_)  T E A P O T   E N G I N E   v0.1.0-alpha",
      " --------------------------------------------------",
      " white ceramic / tea green / TypeScript / zero deps / no build step",
    ]
  },
  {
    id: 'badge-color', tier: 'badge', variant: 'color',
    file: 'banner-badge.txt', cols: 40, rows: 1,
    lines: [
      "\u001b[38;2;74;107;51m│\u001b[0m\u001b[38;2;255;255;255m TEAPOT ENGINE \u001b[0m\u001b[38;2;74;107;51m│\u001b[0m\u001b[38;2;90;107;74m ── \u001b[0m\u001b[38;2;143;191;107mweb · cli · desktop\u001b[0m",
    ]
  },
  {
    id: 'badge-ascii', tier: 'badge', variant: 'ascii',
    file: 'banner-badge-ascii.txt', cols: 40, rows: 1,
    lines: [
      "| TEAPOT ENGINE | -- web / cli / desktop",
    ]
  },
];
