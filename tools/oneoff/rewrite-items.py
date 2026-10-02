"""一次性改造：把 data_items.ts 的 I.LIST 换成"有得有失"的版本。

用法： py tools/rewrite-items.py
幂等：脚本以 `I.COST_KINDS` 这个标记判断是否已经跑过。
跑完即可删除。
"""
import io
import re
import sys

PATH = 'src/data_items.ts'
HEAD = "/* __ITEM_LIST_V2__ */"
MARK = "I.COST_KINDS"

# 槽位顺序：id, 槽位, tags, tier, price, icon, tint, stats, cost, special, desc
ITEMS = [
    # ---------------- T1 ----------------
    ("coffee", "consumable", None, 1, 8, "bottle", "#8a5a33",
     "{ attackSpeed: 0.12 }", "{ stat: { damage: -0.04 } }", None,
     "手更快，但每一击没那么重"),
    ("snack", "consumable", None, 1, 8, "bar", "#c98a55",
     "{ maxHp: 5 }", "{ stat: { speed: -0.04 } }", None,
     "血更厚，人也更沉"),
    ("helmet", "armor", None, 1, 9, "helm", "#8a5a33",
     "{ armor: 3 }", "{ stat: { critChance: -0.03 } }", None,
     "护住脑袋，也就看不清要害"),
    ("sneaker", "trinket", None, 1, 9, "boot", "#6f8fb0",
     "{ speed: 0.09 }", None, "plain",
     "跑得快一点。没有别的"),
    ("clover", "trinket", None, 1, 10, "clover", "#4f9d69",
     "{ luck: 4 }", None, "plain",
     "运气好一点。没有别的"),
    ("magnet", "trinket", None, 1, 10, "magnet", "#5f8fc4",
     "{ pickupRange: 8, harvesting: 3 }", "{ stat: { armor: -1 } }", None,
     "捡得又远又多，代价是身上更脆"),
    # ---------------- T2 ----------------
    ("whetstone", "gear", None, 2, 18, "stone", "#9c9384",
     "{ meleeDmg: 6 }", "{ stat: { rangedDmg: -3 } }", None,
     "近战更狠，手上的枪就顾不上了"),
    ("scopeitem", "gear", None, 2, 18, "scope", "#5f8fc4",
     "{ rangedDmg: 6 }", "{ stat: { meleeDmg: -3 } }", None,
     "远程更准，贴身肉搏就别指望了"),
    ("glove", "gear", None, 2, 16, "glove", "#c05a4a",
     "{ damage: 0.10, knockbackBonus: 0.30 }", "{ stat: { attackSpeed: -0.04 } }", None,
     "每一拳都重，但出手慢了半拍"),
    ("medicine", "consumable", None, 2, 17, "potion", "#cf5a6a",
     "{ hpRegen: 1.5, maxHp: 3 }", "{ fragile: 1.08 }", None,
     "一直在回血，代价是挨打也更疼（×1.08）"),
    ("tattoo", "trinket", None, 2, 18, "tattoo", "#8f6fae",
     "{ lifesteal: 0.05 }", "{ stat: { hpRegen: -0.5 } }", None,
     "打人回血，但不再自然愈合"),
    ("beret", "trinket", None, 2, 19, "helm", "#c96f9a",
     "{ luck: 8, harvesting: 4 }", "{ stat: { damage: -0.10 } }", None,
     "开出与捡到的都更好，代价是打得更轻"),
    ("cloak", "armor", None, 2, 20, "cloak", "#7d8a5a",
     "{ armor: 4, dodge: 0.04 }", "{ stat: { attackSpeed: -0.05 } }", None,
     "防得住也躲得开，就是挥不动"),
    ("treadmill", "trinket", None, 2, 19, "gear", "#b8763f",
     "{ speed: 0.15 }", "{ stat: { maxHp: -2 } }", None,
     "快得像换了个角色，代价是心更薄"),
    ("rations", "consumable", None, 2, 15, "bar", "#a8894f",
     "{ harvesting: 6 }", "{ stat: { maxHp: -3 } }", None,
     "收获更高（材料来得快），代价是身体被掏空"),
    ("warpipe", "consumable", None, 2, 14, "stone", "#7a5f8f",
     "{ luck: 5, harvesting: 5 }", "{ enemyHp: 1.10, enemyDmg: 1.06, enemySpeed: 1.04 }", None,
     "敌人更结实更快也更疼，但你开出与捡到的都更好"),
    # ---------------- T3 ----------------
    ("coffee2", "consumable", None, 3, 30, "bottle", "#5a3a22",
     "{ attackSpeed: 0.22 }", "{ stat: { damage: -0.10 } }", None,
     "快。很脆的快。"),
    ("bionic", "gear", None, 3, 32, "arm", "#b9bcc2",
     "{ rangedDmg: 10, damage: 0.06 }", "{ stat: { meleeDmg: -6 } }", None,
     "远程那条线拉满，近战等于没有"),
    ("ripper", "gear", None, 3, 32, "dagger", "#c6cad1",
     "{ meleeDmg: 10, critChance: 0.06 }", "{ stat: { rangedDmg: -6 } }", None,
     "近战暴击流的核心件，远程全废"),
    ("cloak2", "armor", ["heavy"], 3, 34, "armor", "#8d9198",
     "{ armor: 9 }", "{ stat: { dodge: -0.08, speed: -0.08 } }", None,
     "挨得住，但你再也躲不开了"),
    ("lens", "gear", None, 3, 33, "scope", "#e2564f",
     "{ critChance: 0.18 }", "{ stat: { attackSpeed: -0.08 } }", None,
     "每一下都可能爆，但出手慢"),
    ("scanner", "gear", None, 3, 31, "gear", "#5f8fc4",
     "{ range: 0.20, pickupRange: 10 }", "{ stat: { armor: -2 } }", None,
     "看得远、够得着，代价是更脆"),
    ("charm", "trinket", None, 3, 30, "bone", "#ded3b6",
     "{ lifesteal: 0.07 }", "{ stat: { armor: -3 } }", None,
     "以血养血：打得回来，但护甲没了"),
    ("goggles", "gear", None, 3, 30, "goggles", "#8ab84f",
     "{ engineering: 10 }", "{ fragile: 1.10 }", None,
     "工程流的核心件，代价是挨揍更疼（×1.10）"),
    # ---------------- T4 ----------------
    ("charcoal", "trinket", None, 4, 46, "stone", "#4a423b",
     "{ elementalDmg: 12, damage: 0.08 }", "{ stat: { hpRegen: -2 } }", None,
     "元素伤害拉满，代价是再也回不了血"),
    ("exo", "armor", ["heavy"], 4, 48, "armor", "#b9bcc2",
     "{ armor: 10 }", "{ stat: { dodge: -0.10, speed: -0.10 } }", None,
     "一件顶三件，代价是你从此站着挨打"),
    ("nano", "consumable", None, 4, 50, "potion", "#6fc07d",
     "{ hpRegen: 4, lifesteal: 0.05 }", "{ shopPrice: 1.15 }", None,
     "几乎死不了，代价是商店全线涨价 15%"),
    ("amulet", "trinket", None, 4, 54, "amulet", "#8f6fae",
     "{ damage: 0.26 }", "{ stat: { maxHp: -8 } }", None,
     "伤害爆炸，代价是血条只剩一半"),
    ("turretitem", "gear", None, 4, 56, "gear", "#9c9384",
     "{}", "{ noFreeReroll: 1 }", "turret",
     "每波开场白送一座炮塔，代价是**再没有免费刷新**"),
    ("duplicator", "gear", None, 4, 58, "chip", "#e8b23c",
     "{}", "{ stat: { damage: -0.15 } }", "extraProjectile",
     "远程每次多一发弹丸，代价是每一发都轻 15%"),
    ("berserk", "trinket", None, 4, 60, "heart", "#c05a4a",
     "{ damage: 0.32 }", "{ stat: { armor: -6 } }", None,
     "伤害翻一大截，代价是护甲被吃掉六点"),
]

PLAIN_NOTE = {
    "sneaker": "开局走位锚点：前两波玩家还没有任何体系，需要一件'不用想就能拿'的东西",
    "clover": "幸运是'经济'那一轴的门票：第一件必须是纯的，否则没人敢碰这条线",
}


def entry(it):
    (iid, slot, tags, tier, price, icon, tint, stats, cost, special, desc) = it
    parts = ["  { id: '%s'," % iid]
    parts.append(" name: '%s'," % NAME[iid])
    parts.append(" en: '%s'," % EN[iid])
    parts.append(" slot: '%s'," % slot)
    if tags:
        parts.append(" tags: [%s]," % ", ".join("'%s'" % t for t in tags))
    parts.append(" tier: %d, price: %d," % (tier, price))
    parts.append(" icon: '%s'," % icon)
    parts.append(" tint: '%s'," % tint)
    if special == "plain":
        parts.append("\n    plain: true, plainNote: %s," % py_str(PLAIN_NOTE[iid]))
    parts.append("\n    stats: %s," % stats)
    if cost:
        parts.append("\n    cost: %s," % cost)
    if special and special != "plain":
        parts.append("\n    special: '%s'," % special)
    parts.append("\n    desc: %s }," % py_str(desc))
    return "".join(parts)


def py_str(s):
    return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"


NAME = {
    "coffee": "咖啡", "snack": "能量棒", "helmet": "皮质头盔", "sneaker": "旧球鞋",
    "clover": "四叶草", "magnet": "磁铁", "whetstone": "磨刀石", "scopeitem": "瞄准镜",
    "glove": "拳击手套", "medicine": "小药瓶", "tattoo": "图腾纹身", "beret": "幸运贝雷帽",
    "cloak": "轻甲斗篷", "treadmill": "跑步机", "rations": "压缩口粮", "warpipe": "异星烟斗",
    "coffee2": "浓缩咖啡", "bionic": "仿生手臂", "ripper": "解剖刀", "cloak2": "厚重护甲",
    "lens": "狙击透镜", "scanner": "战术雷达", "charm": "骨制护符", "goggles": "工程师护目镜",
    "charcoal": "燃烧炭块", "exo": "外骨骼", "nano": "纳米医疗", "amulet": "异星护符",
    "turretitem": "便携炮塔", "duplicator": "克隆装置", "berserk": "狂战士之心",
}
EN = {
    "coffee": "Coffee", "snack": "Snack", "helmet": "Leather Hood", "sneaker": "Sneakers",
    "clover": "Clover", "magnet": "Magnet", "whetstone": "Whetstone", "scopeitem": "Scope",
    "glove": "Boxing Glove", "medicine": "Medicine", "tattoo": "Tattoo", "beret": "Lucky Beret",
    "cloak": "Light Cloak", "treadmill": "Treadmill", "rations": "Rations", "warpipe": "Alien Pipe",
    "coffee2": "Espresso", "bionic": "Bionic Arm", "ripper": "Ripper", "cloak2": "Heavy Armor",
    "lens": "Sniper Lens", "scanner": "Radar", "charm": "Bone Charm", "goggles": "Goggles",
    "charcoal": "Charcoal", "exo": "Exoskeleton", "nano": "Nano Medic", "amulet": "Alien Amulet",
    "turretitem": "Portable Turret", "duplicator": "Duplicator", "berserk": "Berserker Heart",
}

src = io.open(PATH, encoding='utf-8').read()
if HEAD in src:
    print('已经跑过了（找到新表标记），什么都没做')
    sys.exit(0)

start = src.index('I.LIST = [')
end = src.index('\n];', start) + len('\n];')

groups = [
    ("  /* =========================================================\n"
     "     T1 · 便宜货 —— 前两波的锚点\n"
     "     ---------------------------------------------------------\n"
     "     这一档刻意留了 2 件**白板**（`plain: true`）：开局裸装时玩家需要一个\n"
     "     \"不用想就能拿\"的锚点，否则第一次进商店就要做四个取舍 —— 而那是在他\n"
     "     还没建立起任何体系之前。白板只允许出现在 T1/T2，而且有名额上限。\n"
     "     其余每一件都\"有得有失\"，而且**换的轴不一样**。\n"
     "     ========================================================= */", 0, 6),
    ("\n  /* =========================================================\n"
     "     T2 · 主力 —— 从这里开始每一件都是一次选择题\n"
     "     ========================================================= */", 6, 16),
    ("\n  /* =========================================================\n"
     "     T3 · 强力 —— 好处大、代价也重（构筑真正开始的地方）\n"
     "     ========================================================= */", 16, 24),
    ("\n  /* =========================================================\n"
     "     T4 · 神装 —— 每一件都在赌一件大事\n"
     "     ========================================================= */", 24, len(ITEMS)),
]

body = []
for header, a, b in groups:
    body.append(header)
    for it in ITEMS[a:b]:
        body.append(entry(it))
new_list = HEAD + '\nI.LIST = [\n' + '\n'.join(body) + '\n];'

io.open(PATH, 'w', encoding='utf-8', newline='\n').write(src[:start] + new_list + src[end:])
print('道具表已换成 v2：%d 件（%d 件白板）' % (len(ITEMS), sum(1 for i in ITEMS if i[9] == 'plain')))
