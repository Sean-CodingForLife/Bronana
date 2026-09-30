"""生成 `src/curves.ts` 里"逐点表"那一段的源码文本。

为什么要生成：敌人三条成长曲线的**逐点值**必须与改造前逐位相同，
而多项式展开会换掉浮点运算顺序（`18` 处 10.35 vs 10.350000000000001）。
用一张逐点表代替公式，"查询即得原值"，同时把每个房间号的值**摊在纸上** ——
那正是玩法设计要看的东西。

用法： py tools/gen-curve-tables.py
"""
import io


def pace(t):
    return 1 + (t - 1) * 0.55


def hp(t):
    w = pace(t) - 1
    return 1 + 0.30 * w + 0.045 * w * w


def dmg(t):
    # ⚠ 2026-09 行为变更（**不是**重构）：系数 0.16 → 0.37。
    # 起因：实测 生命:伤害 = 26.9 : 4.34 = **6.2 : 1**，而七款同类游戏的区间是
    # 0.3:1 ~ 1.5:1（Brotato 1:1 · RoR2 1.5:1 · 杀戮尖塔 1:1.8 · Hades 1:3.3）。
    # 6.2:1 属于"只涨血、伤害基本平"的形状，而那一类（以撒 / 地牢 / VS）的生命
    # 涨幅只有 2~3× —— 本作借了它们的形状，却用了 Brotato 的量级（×27）。
    # 改动后：r39 伤害 ×8.73（原 ×4.34），比值 26.9 : 8.73 = 3.08 : 1。
    # 依据与实测见 docs/scaling-benchmarks.md；改这里**必须同时改** curves.ts 的 LEGACY。
    return 1 + 0.37 * (pace(t) - 1)


def spd(t):
    return min(1.35, 1 + 0.012 * (pace(t) - 1))


def bud(t):
    ew = pace(t)
    return 13 + ew * 9 + ew * ew * 0.55


N = 145


def arr(fn):
    return '[' + ', '.join(repr(fn(t)) for t in range(1, N + 1)) + ']'


out = []
out.append('/* ---------------- 逐点表（房间号 1..%d，由 tools/gen-curve-tables.py 生成）-----------------' % N)
out.append('   为什么用逐点表而不是公式：这些值会乘进**怪物生命**，必须与改造前**逐位相同**，')
out.append('   而把 `1 + 0.30w + 0.045w²` 展开成 `t` 的多项式会换掉浮点运算顺序')
out.append('   （实测第 18 间：10.35 vs 10.350000000000001）。逐点表还有一个好处：')
out.append('   每个房间号的强度**摊在纸上**，调曲线时不用算，直接看。 */')
out.append('var T = {} as Record<string, number[]>;')
out.append('T.pace = %s;' % arr(pace))
out.append('T.hp = %s;' % arr(hp))
out.append('T.dmg = %s;' % arr(dmg))
out.append('T.spd = %s;' % arr(spd))
out.append('T.budget = %s;' % arr(bud))

io.open('tools/_curve-tables.txt', 'w', encoding='utf-8', newline='\n').write('\n'.join(out) + '\n')
print('已写出 tools/_curve-tables.txt（%d 行）' % len(out))
