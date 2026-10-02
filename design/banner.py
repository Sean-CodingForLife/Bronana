#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Teapot Engine 终端启动横幅 —— 生成器
  python design/banner.py

横幅只做两件事：**字对齐 + 上色**。

本文件是自足的：色值与版本号在本文件顶部各声明一次，不依赖别的文件。
产物是**同一份产物的两个载体**，都由本脚本覆盖生成：
  · `banner-*.txt` 十一份（四档版式 × 降级）—— 给人看、给脚本贴
  · `../src/banner_data.ts` —— 给**引擎**读（web / cli / desktop 三种宿主共用同一份）
⚠ 不要去改那些产物：**改横幅要改本脚本**，然后重新生成。
"""
import json
import os
import re
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = HERE
TS = os.path.join(os.path.dirname(HERE), 'src', 'banner_data.ts')
ANSI = re.compile(r'\x1b\[([0-9;]*)m')

# ── 色值（**唯一声明处**，横幅是自足的）──────────────────────────
#   四个绿是四个角色：
#     TEA    主体字色 / 副标题 / 徽标点缀
#     TEA_D  版本号旁的强调、框线、分隔
#     FADE   次要信息（元信息行）
#     DIM    分隔线（最淡）
#   全在暖白底与深底两档下都验过；深底上的那一档挑的是明度更高的一支。
TEA = '8fbf6b'
TEA_D = '4a6b33'
FADE = '7d9a63'
DIM = '5a6b4a'
WHITE = 'ffffff'

# ── 版本（**唯一声明处**）───────────────────────────────────────
#   这是**引擎**的版本，与 `package.json` 的 `version` 是**两条轴**：
#     引擎版本跟着**引擎能力**走（这里）；`package.json` 那个跟着**工作区内容**走。
#   所以它**刻意不从 `package.json` 读** —— 那会把两条轴焊成一条，
#   而且"引擎版本"要在一个**没有任何游戏内容**的仓库里也说得出来。
#   ⚠ 十一份产物与 `src/banner_data.ts` 都从这里取版本号：
#     `selfcheck()` 第 ④ 条会检查它们**没有第二处声明**。
VERSION = '0.1.0-alpha'


def fg(h, s):
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return '\x1b[38;2;{};{};{}m{}\x1b[0m'.format(r, g, b, s)


def dw(s):
    """显示宽度：CJK / 全角算 2 列（框线全靠它才算得准）。"""
    n = 0
    for ch in s:
        n += 2 if unicodedata.east_asian_width(ch) in ('W', 'F') else 1
    return n


def strip_ansi(s):
    return ANSI.sub('', s)


def center(s, w):
    return ' ' * max(0, (w - dw(strip_ansi(s))) // 2) + s


def pad_to(s, w):
    return s + ' ' * max(0, w - dw(strip_ansi(s)))


# ─────────────────────────────────────────────────────────────
# 5×7 点阵字
# ─────────────────────────────────────────────────────────────
FONT = {
    'A': ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    'D': ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    'E': ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    'G': ["01110", "10001", "10000", "10111", "10001", "10001", "01110"],
    'H': ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    'I': ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    'L': ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    'M': ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    'N': ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    'O': ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    'P': ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    'R': ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    'S': ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    'T': ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    'U': ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    'V': ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    'Y': ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    '0': ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    '1': ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    '3': ["01110", "10001", "00001", "00110", "00001", "10001", "01110"],
    '.': ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
    '-': ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
    '·': ["00000", "00000", "01100", "01100", "00000", "00000", "00000"],
    ' ': ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
}


def bigword(text, on):
    rows = ['' for _ in range(7)]
    for ch in text.upper():
        g = FONT.get(ch, FONT[' '])
        for r in range(7):
            rows[r] += ''.join(on if c == '1' else ' ' for c in g[r]) + ' '
    return [r.rstrip() for r in rows]


# ─────────────────────────────────────────────────────────────
# 变体
# ─────────────────────────────────────────────────────────────
def hero(ascii_mode=False, colored=True, dark=True):
    """
    主横幅：纯排印版。

    浅底档必须换字色：字标在深底上是白的，搬到浅底就是"白写白"，
    所以 `dark=False` 时字标走 TEA_D。
    """
    c = (lambda h, s: fg(h, s)) if colored else (lambda h, s: s)
    word = bigword('TEAPOT', on='#' if ascii_mode else '█')
    word_c = WHITE if dark else TEA_D
    meta_c = FADE if dark else DIM
    tag = 'EVERYTHING IS A MODULE'
    if ascii_mode:
        meta = ['TypeScript / native ES modules',
                'zero runtime deps / zero assets / no build step',
                'three hosts: web / cli / desktop']
    else:
        meta = ['TypeScript · 原生 ES 模块',
                '零运行时依赖 · 零素材 · 无构建步',
                '三种宿主：web · cli · desktop']
    mark = '  --' if ascii_mode else '  ──'
    rows = [c(TEA, mark)]
    for ln in word:
        rows.append('    ' + c(word_c, ln))
    rows.append('    ' + c(TEA, tag))
    for m in meta:
        rows.append('    ' + c(meta_c, m))
    return rows


def compact(ascii_mode=False, colored=True):
    c = (lambda h, s: fg(h, s)) if colored else (lambda h, s: s)
    hz = '-' if ascii_mode else '─'
    if ascii_mode:
        return [
            ' (_)  T E A P O T   E N G I N E   v' + VERSION,
            ' ' + hz * 50,
            ' white ceramic / tea green / TypeScript / zero deps / no build step',
        ]
    return [
        c(TEA, ' ◜') + c(WHITE, '◝') + '  ' + c(TEA_D, 'T E A P O T   E N G I N E') +
        '   ' + c(FADE, 'v' + VERSION),
        c(DIM, ' ' + hz * 50),
        c(FADE, ' 白瓷 · 茶绿 · TypeScript · 零运行时依赖 · 无构建步'),
    ]


def badge(ascii_mode=False, colored=True):
    c = (lambda h, s: fg(h, s)) if colored else (lambda h, s: s)
    if ascii_mode:
        return ['| TEAPOT ENGINE | -- web / cli / desktop']
    return [c(TEA_D, '│') + c(WHITE, ' TEAPOT ENGINE ') + c(TEA_D, '│') +
            c(DIM, ' ── ') + c(TEA, 'web · cli · desktop')]


def framed(ascii_mode=False, colored=True):
    c = (lambda h, s: fg(h, s)) if colored else (lambda h, s: s)
    if ascii_mode:
        tl = tr = bl = br = '+'
        hz, vt = '-', '|'
    else:
        tl, tr, bl, br, hz, vt = '╭', '╮', '╰', '╯', '─', '│'
    inner = 64
    word = bigword('TEAPOT', on='#' if ascii_mode else '█')
    tag = 'EVERYTHING IS A MODULE'
    ver = ('v' + VERSION + '  -  TypeScript  -  zero deps  -  no build step' if ascii_mode
           else 'v' + VERSION + '  ·  TypeScript  ·  零运行时依赖  ·  无构建步')
    body = ['']
    body += [center(c(WHITE, l), inner) for l in word]
    body.append('')
    body.append(center(c(TEA, tag), inner))
    body.append('')
    body.append(center(c(FADE, ver), inner))
    body.append('')
    out = [c(TEA_D, tl + hz * inner + tr)]
    out += [c(TEA_D, vt) + pad_to(l, inner) + c(TEA_D, vt) for l in body]
    out.append(c(TEA_D, bl + hz * inner + br))
    return out


# ─────────────────────────────────────────────────────────────
# 产物清单（**唯一一份**）：`.txt` 十一份与 `src/banner_data.ts` 都从它出
#   ⚠ 以前这里是 `main()` 里十一行 `write(...)` 各写各的 —— 那种写法下
#     "写出去的文件"与"引擎读的数据"是**两张清单**，迟早漂开。
#     现在只有这一张：加一档要在这里加一行，两个载体一起动。
# ─────────────────────────────────────────────────────────────
def products():
    """(版式, 变体, 文件名, 行)—— 顺序就是打包顺序（版式从大到小）。"""
    return [
        ('hero',    'color',   'banner-hero.txt',           hero()),
        ('hero',    'light',   'banner-hero-light.txt',     hero(dark=False)),
        ('hero',    'nocolor', 'banner-hero-nocolor.txt',   hero(colored=False)),
        ('hero',    'ascii',   'banner-hero-ascii.txt',     hero(ascii_mode=True, colored=False)),
        ('framed',  'color',   'banner-framed.txt',         framed()),
        ('framed',  'nocolor', 'banner-framed-nocolor.txt', framed(colored=False)),
        ('framed',  'ascii',   'banner-framed-ascii.txt',   framed(ascii_mode=True, colored=False)),
        ('compact', 'color',   'banner-compact.txt',        compact()),
        ('compact', 'ascii',   'banner-compact-ascii.txt',  compact(ascii_mode=True, colored=False)),
        ('badge',   'color',   'banner-badge.txt',          badge()),
        ('badge',   'ascii',   'banner-badge-ascii.txt',    badge(ascii_mode=True, colored=False)),
    ]


def render(lines):
    """
    **唯一的规范化处**：文件与 TS 都从它出，两边才可能逐字节一致。

    与旧版的等价性：旧版写盘时做的是"join 之后整体 rstrip"，而每一行本来
    就已经 rstrip 过 —— 所以那只可能去掉**末尾的空行**。这里就是这件事。
    """
    out = [l.rstrip() for l in lines]
    while out and out[-1] == '':
        out.pop()
    return out


def write(name, lines):
    """写一份 `.txt`，**返回它真正落盘的那几行**（TS 侧用同一份，见 `render`）。"""
    L = render(lines)
    p = os.path.join(OUT, name)
    with open(p, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(L) + '\n')
    print('  %-28s %2d 行 · 最宽 %2d 列' % (name, len(L),
                                            max(dw(strip_ansi(l)) for l in L)))
    return L


TS_HEAD = '''/* =========================================================
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
   ========================================================= */'''


def emit_ts(entries):
    """把同一份产物写成引擎侧的数据表（**唯一入口**：`main()` 调它）。"""
    L = [TS_HEAD, '']
    L.append('/** 引擎版本：**唯一声明处**是 `design/banner.py` 顶部的 VERSION —— 十一份里不许有第二个值 */')
    L.append("export var BANNER_VERSION = '%s';" % VERSION)
    L.append('')
    L.append('/** 十一份产物（四档版式 × 降级）。**加一档要改生成器**，不要手加 */')
    L.append('export var BANNER_DATA: BannerDataEntry[] = [')
    for e in entries:
        L.append('  {')
        L.append("    id: '%s', tier: '%s', variant: '%s'," % (e['id'], e['tier'], e['variant']))
        L.append("    file: '%s', cols: %d, rows: %d," % (e['name'], e['cols'], e['rows']))
        L.append('    lines: [')
        for x in e['lines']:
            L.append('      ' + json.dumps(x, ensure_ascii=False) + ',')
        L.append('    ]')
        L.append('  },')
    L.append('];')
    with open(TS, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(L) + '\n')
    print('  %-28s %2d 条 · %d 行' % ('../src/banner_data.ts', len(entries), len(L)))


def selfcheck(entries):
    """
    四条自检（家法：一条不会失败的审计等于装饰 —— 每条都对应一次真踩过的坑）：

      ① **色值只有一个声明处** —— 代码里出现的每个 `#rrggbb` 字面量都必须在顶部那份声明里；
      ② **四个 `-ascii.txt` 必须真的是纯 ASCII** —— `ord(c) > 127` 一处都不许有；
      ③ **两个载体必须是同一份东西** —— 刚写出的 `.txt` 与 `src/banner_data.ts` 里那一条
         逐字节一致（症状：引擎打的横幅与 `design/` 里的对不上，而**没有门看得见**）；
      ④ **版本号只有一个声明处** —— 十一份里不许出现第二个版本字面量
         （改版本最典型的漏改就是只改了一半产物）。
    """
    problems = []
    declared = {TEA, TEA_D, FADE, DIM, WHITE}
    src = open(os.path.abspath(__file__), encoding='utf-8').read()
    body = re.sub(r'#[^\n]*', '', src)          # 去掉注释，只看真正被引用的
    for m in re.finditer(r"'([0-9a-fA-F]{6})'", body):
        lit = m.group(1).lower()
        if lit not in declared:
            problems.append('色值字面量 #%s 不在顶部声明里' % lit)
    for f in sorted(os.listdir(OUT)):
        if not f.endswith('-ascii.txt'):
            continue
        raw = open(os.path.join(OUT, f), encoding='utf-8').read()
        bad = sorted({ch for ch in raw if ord(ch) > 127})
        if bad:
            problems.append('%s 不是纯 ASCII：%s' % (f, ''.join(bad)))
    # ③ 两个载体逐字节一致（同一份产物的两种写法）
    for e in entries:
        p = os.path.join(OUT, e['name'])
        want = '\n'.join(e['lines']) + '\n'
        got = open(p, encoding='utf-8', newline='').read()
        if got != want:
            problems.append('%s 与 src/banner_data.ts 里那一条不一致'
                            '（.txt %d 字节 · TS %d 字节）'
                            % (e['name'], len(got.encode('utf-8')), len(want.encode('utf-8'))))
    # ④ 版本只有一个声明处
    for e in entries:
        for ln in e['lines']:
            for m in re.finditer(r'v(\d+\.\d+\.\d+(?:-[0-9a-z.]+)?)', strip_ansi(ln)):
                if m.group(1) != VERSION:
                    problems.append('%s 里的版本 %s 不是顶部声明的 v%s'
                                    % (e['name'], m.group(0), VERSION))
    return problems


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    print('=== 生成 Teapot Engine 启动横幅 ===')
    print('色值（本文件顶部唯一声明）：TEA=%s TEA_D=%s FADE=%s DIM=%s WHITE=%s'
          % ('#' + TEA, '#' + TEA_D, '#' + FADE, '#' + DIM, '#' + WHITE))
    print('版本（本文件顶部唯一声明）：v%s' % VERSION)
    print('--- 生成 .txt（十一份）---')
    entries = []
    for tier, variant, name, lines in products():
        L = write(name, lines)
        entries.append({
            'id': tier + '-' + variant,
            'tier': tier,
            'variant': variant,
            'name': name,
            'lines': L,
            'rows': len(L),
            'cols': max(dw(strip_ansi(x)) for x in L),
        })
    print('--- 生成 src/banner_data.ts ---')
    emit_ts(entries)
    print('--- 自检 ---')
    problems = selfcheck(entries)
    if problems:
        for p in problems:
            print('  FAIL ' + p)
        return 1
    print('  OK  色值/版本各只有一个声明处；四个 ascii 档 0 处非 ASCII；'
          '十一份 .txt 与 banner_data.ts 逐字节一致')
    print('完成。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
