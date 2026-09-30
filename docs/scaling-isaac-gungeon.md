# 两款 Roguelike 的敌人数值曲线：外部基准（查不到即写「未取得」）

## 一、The Binding of Isaac: Rebirth / Afterbirth / Repentance

1. **敌人生命随进度**：非整数倍楼层跳档，而是「基础 HP + Stage HP 加成」两段式：`HP = BaseHP + (min(4,Stage) + 0.8 × bound(0, Stage−5, 5)) × StageHP`。即 stage1–4 每层加满 1 个 StageHP、stage5 加 0、stage6–10 每层加 0.8 个、stage10 封顶；仅 52 个小怪 + 18 个 Boss 生效。例：Dip（3 基础 +1 StageHP）在 Basement I = 4 HP、Womb II = 9.4、Void = 11。
来源: https://bindingofisaacrebirth.wiki.gg/wiki/Stage_HP
2. **敌人伤害随进度**：**几乎不涨且被刻意封顶**。Champion 一律「无视章节，造成满心伤害」；普通小怪伤害不随楼层变。即「血量涨、伤害不涨」——与 Gungeon 一致的共同设计。
来源: https://bindingofisaacrebirth.wiki.gg/wiki/Champions
3. **移速 / 攻速 / 弹幕密度**：本体无随楼层递增的全局倍率；压力靠换更强的敌人种类。Repentance Hard Mode 会提高**部分**敌人与 Boss 的 shot speed 与 movement speed（未给倍数），Harbingers 冲锋变快。
来源: https://bindingofisaacrebirth.wiki.gg/wiki/Hard_mode
4. **精英/变体倍率**：Champion 基础 = 视觉 +15%、**HP ×2**、造成满心伤害；细分 Red **×2.6**、Yellow ×1.5、Gray **×0.66**、Large **×3**、Crown **×6**、Rainbow 含 Large(×3)；White 无敌至其余敌人死亡。出现率 Normal 5%、Rebirth Hard 20%、Repentance Hard 5%、The Void 75%；Champion Belt +15%，Purple Heart 使概率翻倍且可叠到 100%。掉落：普通必掉、Hard 仅 33%、Greed 0%。精英倍率不随楼层继续放大。
来源: https://bindingofisaacrebirth.wiki.gg/wiki/Champions
5. **Boss 生命量级**：多数不吃 Stage HP，**固定 HP**。Satan 600；Isaac 2,000、The Lamb 2,000、??? 2,000；Ultra Greed 3,500 / Greedier 2,500；Mega Satan 5,000+2,000；Hush 6,666；Mother 2,222+2,000；Delirium 10,000；The Beast 10,000。另有 armor/DPS soft cap：生成后 4 秒内减伤最高 99%，单次伤害最低压到 **9%**。
来源: https://bindingofisaacrebirth.wiki.gg/wiki/Damage_Scaling
6. **玩家侧成长**：**√ 型衰减叠加 + 稀缺乘法器**。`EffectiveDmg = (CharBaseDmg × TotalDmgUps × 1.2 + 1 + FlatDmgUps) × Multipliers`（Isaac 基础 3.5）：第一个 Pentagram(+1) → 5.19，第二个 → 6.45（增量 1.69 掉到 1.26）；×2 乘法器可互乘到 ×4，Cricket's Head / Magic Mushroom 的 ×1.5 不互乘。品质为 Repentance 隐藏 Quality 0–4，影响 re-roll / Bag of Crafting / Abyss 输出，非线性强度。
来源: https://bindingofisaacrebirth.wiki.gg/wiki/Damage
来源: https://bindingofisaacrebirth.wiki.gg/wiki/Item_Quality
7. **难度旋钮**：Hard Mode = 每层多生成 **2–3 房**、难度 1 的简单房几乎消失、难度 15 房提前到第 2 层、心掉落减少（Rebirth 移除 66% / Repentance 34%）、诅咒更常见、老虎机产出减半；Rebirth Hard 另把 Champion 率 5%→20%。McMillen 明说难度是**解锁门控**：「Rebirth wont play the same as isaac+wrath, the extra floors/bosses will slowly unlock over playing and getting to XYZ.」（重生不会和以撒+羔羊之怒一样，额外楼层与 Boss 会随游玩与达成条件慢慢解锁。）Wrath of the Lamb 一次性放出高难内容曾遭批评。
来源: https://www.dualshockers.com/the-binding-of-isaac-rebirth-to-feature-a-difficulty-curve-designed-to-ease-in-newer-players/
8. **一局长度与成长次数**：**未取得**。
9. **玩家实际死在哪**：Steam 全球达成率：Hard Mode 解锁 **44.6%**、无伤过 Basement **47.0%**、Womb 无伤 32.5%、Depths 无伤 30.1%、Womb 章节解锁 65.8%、Revolution 结局 18.0%、Dead God 3.5%。即**过 Basement 的人约 6 成倒在前三章**。
来源: https://steamcommunity.com/stats/250900/achievements/

## 二、Enter the Gungeon

1. **敌人生命随进度**：**楼层跳档固定乘数**：Keep of the Lead Lord **×1**、Gungeon Proper **×1.3**、Oubliette ×1.3333、Black Powder Mine **×1.6**、Abbey ×1.6666、Hollow / Rat's Lair **×1.85**、Forge / Bullet Hell **×2.1**。相邻主层 ≈ ×1.3 → ×1.23 → ×1.156 → ×1.135（**前陡后缓**）；开局到结局总倍率 **2.1×**。另有单发弹丸对敌伤害上限 300。
来源: https://enterthegungeon.fandom.com/wiki/Cult_of_the_Gundead
2. **敌人伤害随进度**：**未取得**（无楼层级敌方子弹伤害倍率表）；已知伤害按「半颗心」结算并封顶。以生命 ×2.1 对照逐层 DPS 上限 ×2.6 可反推：**伤害成长远慢于生命成长**，难度来自弹幕形状与敌种。
3. **移速 / 攻速 / 弹幕密度**：普通敌无随楼层全局倍率；变体敌改写参数（Veteran Bullet Kin 射速、弹速、移速、预判全上升）。Boss 侧有**逐层 DPS 上限**（A Farewell to Arms / Classic）：30/25、42/35、60/50、70/58、78/65、80/70 —— 后半程玩家输出上限提高 **2.6× 以上**。
来源: https://enterthegungeon.fandom.com/wiki/Bosses
来源: https://enterthegungeon.fandom.com/wiki/Bullet_Kin
4. **精英/变体倍率**：**Jammed（诅咒精英）**——造成整颗心伤害、移速与射速 **+50%**、冷却 **−33%**、必带接触伤害、生命 `health × 3.5 + 10`，上限 `175 × 该层生命倍率`；Jammed Boss 生命 `health × 1.2 + 100`。出现率随 Curse 线性上升：0 → 1(1%) → 5(5%) → 7(10%) → 9(25%) → **10(50%)**；10 点召唤不可击杀的 Lord of the Jammed。Boss 被 Jammed 概率 7 点起才有（20/30/50%）。**精英倍率不随楼层继续放大**，但乘上该层基础倍率。
来源: https://enterthegungeon.fandom.com/wiki/Curse
5. **Boss 生命**：**未取得**（官方 wiki 未列 Boss HP，仅单页散见 Base HP）。可得的是奖励与上限：Boss 必掉 Hegemony Credits + 1–3 拾取物；无伤过主层 Boss 给 Master Round；给枪概率 Chamber1 且 ≤3 把枪时 80%、≤2 把时 70%、否则 37.5% 枪 / 62.5% 道具。
来源: https://enterthegungeon.fandom.com/wiki/Bosses
6. **玩家侧成长**：**品质档位 + 数量堆叠并存**。每层固定 2 个宝箱房，**一个必出枪、一个必出道具**；品质分布随楼层右移（D/C/B/A/S）：F1 35/32/20/9/4 → F3 2/26/54/12.5/5.5 → F5 **0/10/42.5/35/12.5**。玩家伤害是倍率：`实际伤害 = 枪基础伤害 × Damage 倍率`（默认 1.0）；道具给 +10%/+20%/+25%/+30%/+35%/+41%/+70%，少数 ×2，Metronome 每杀 +2%（上限 +300%）。
来源: https://enterthegungeon.fandom.com/wiki/Chests
来源: https://enterthegungeon.fandom.com/wiki/Stats
7. **难度旋钮**：Curse（上述全套）、Rainbow Run（每层一个彩虹箱但**只能拿 1 件**）、Boss Rush（**取消 DPS 上限**）、Challenge 模式、Advanced Dragun。Crooks 明说难度刻意：「we've always designed our game only for players who like a challenge, so it's natural that some people find it difficult. I'd love everyone to overcome it and win… even with just the starter weapon, it's still possible for players to complete it.」（我们一直只为喜欢挑战的玩家设计，所以有人觉得难很正常。我希望人人都能克服并通关……即便只用初始武器，玩家依然可能通关。）
来源: http://www.gamelook.com.cn/2016/04/250870/
8. **一局长度与成长次数**：每层 2 件（枪+道具）+ Boss 1 件 + 商店/秘密房，主线 5 层 ≈ **11–13 件**。单局时长**未取得**。
来源: https://enterthegungeon.fandom.com/wiki/Chests
9. **玩家实际死在哪**：Steam 全球达成率（成就 = 通关对应层 N 次）：Clear Chamber 1 **18.6%**、Chamber 2 **13.4%**、Chamber 3 **11.5%**、Chamber 4 **10.3%**、Chamber 5 **10.6%**、Bullet Hell **10.0%**；杀自己过去 10.7%、杀 Jammed Boss 12.2%、Gungeon Acolyte 84.4%。换算流失：1 层→2 层流失 **28%**，其后每层仅 10–14%——**阵亡绝大多数集中在第 1–2 层**。
来源: https://steamcommunity.com/stats/311690/achievements/

## 三、对 roguelite 的可操作结论

1. **生命涨幅 ≫ 伤害涨幅，伤害应尽早封顶**：Isaac 敌人伤害完全不随楼层涨、Champion 恒定满心；Gungeon 生命 ×2.1 而伤害按半心结算。建议敌方单发伤害做成**离散心数档**并全局恒定，难度增长全押在血量、数量与弹幕形状。
2. **用「平方根衰减 + 稀缺乘法器」控制成长曲线**：`(base×ups×1.2+1)^0.5` 让第 1 个 +1 道具值 +1.69、第 2 个只值 +1.26，而 ×2 乘法器可叠到 ×4。既防数值爆炸又保住关键道具爽感，优于线性加法。
3. **品质档位随楼层右移，而非加大单件数值**：Gungeon F5 的 S 级箱概率是 F1 的 3.1 倍（12.5% vs 4%），D 级从 35% 掉到 0%。建议把「变强」做成稀有度分布迁移 + 每层 2 次保底获取（共约 11–13 次）。
4. **难度旋钮应是「条件触发的高倍率精英」，不是全局乘法**：Jammed 为 `×3.5+10` 生命、+50% 移速射速、−33% 冷却，出现率 0→50% 由玩家 Curse 自选；Isaac Champion 为 ×2/×2.6/×3/×6 加 5%→20% 出现率。两者都把「难」做成分阶段、可归因的离散事件。
5. **刻意让前期平缓、把阵亡集中在可控中段**：Gungeon 1 层→2 层流失 28%，其后每层仅 10–14%；Isaac 过 Basement 者约 6 成倒在前三章。配合相邻层倍率前陡后缓（×1.3→×1.23→×1.156→×1.135），建议把最大一级倍率放在**第 1→2 关**建立学习墙，后续靠机制而非数值加压。
