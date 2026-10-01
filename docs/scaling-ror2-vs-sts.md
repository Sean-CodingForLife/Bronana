---
title: "三款 roguelike 难度与成长曲线外部基准"
category: 外部参考
status: 现行
scope: "雨中冒险 2 / 吸血鬼幸存者 / 杀戮尖塔的**逐项数字**"
source: "逐项标注来源；未取得的不填"
links: ["scaling-benchmarks.md", "external-benchmarks.md"]
---
# 三款 roguelike 难度与成长曲线外部基准

本文标注的数字均来自公开来源；「未取得」= 未找到可信数字。RoR2 的 HPx/DMGx 是我依 wiki 公式的推导值（公式本身有来源）。

---

## 一、Risk of Rain 2

1. **敌人生命涨幅 — 公开公式**：`coeff = (playerFactor + 时间分钟 × timeFactor) × stageFactor`；`playerFactor = 0.7 + 0.3×玩家数`；`timeFactor = 0.0506 × 难度值 × 玩家数^0.2`；`stageFactor = 1.15^已通关卡数`。难度值 Drizzle 1 / Rainstorm 2 / Monsoon 3。单人开局 coeff = 1。形状 = **时间线性 × 关卡指数**，每过一关 coeff × 1.15。
来源: https://riskofrain2.fandom.com/wiki/Difficulty

2. **coeff 转倍率**：`enemyLevel = 1 + (coeff − playerFactor)/0.33`，敌人**每级 +30% 生命**（上限 99 级；Simulacrum 9999）。**每级 +20% 伤害**。→ **HP 与 damage 由同一个 coeff 驱动，但斜率 30% : 20%，倍率比恒为 3:2。**
来源: https://riskofrain2.fandom.com/wiki/Difficulty 、https://riskofrain2.fandom.com/wiki/Level

3. **推导总倍率（Rainstorm 单人）**

| 时间 | 关卡 | coeff | 敌人等级 | HPx | DMGx |
|---|---|---|---|---|---|
| 0 min | 0 | 1.00 | 1.0 | 1.00× | 1.00× |
| 10 min | 0 | 2.01 | 4.1 | 1.92× | 1.61× |
| 20 min | 0 | 3.02 | 7.1 | 2.84× | 2.23× |
| 25 min | 3 | 5.37 | 14.2 | 4.97× | 3.65× |
| 30 min | 5 | 8.12 | 22.6 | 7.47× | 5.31× |
| 60 min | 10 | 28.61 | 84.7 | 26.10× | 17.73× |

Monsoon 28 min/5 关：coeff 10.56，HPx 9.69×，DMGx 6.79×。99 级上限 = HPx 30.4× / DMGx 20.6×。
来源（公式）: https://riskofrain2.fandom.com/wiki/Difficulty

4. **数量/密度**：刷怪由 Director 的 credits 驱动，`creditsPerSecond = creditMultiplier × (1 + 0.4×coeff) × (玩家数+1)/2`，密度随 coeff 线性升；**地图硬上限 40 个怪**。Director 会拒刷"太便宜"的怪（阈值 = 该 tier 精英价值的 6 倍），故弱怪随时间绝迹。
来源: https://riskofrain2.fandom.com/wiki/Directors

5. **精英倍率（相对该怪当前等级，故随进度继续放大）**：Tier 1（Blazing/Glacial/Overloading）**4× HP / 2× DMG**（Mending 3×，Gilded 6×/3×），第 1 关起；Tier 2（Malachite/Celestine）**18× HP / 6× DMG**（Twisted 13×/10×），**第 5 关后**；Lunar 2×/2×；Void 1.5×/0.7×。精英 spawn 价值也按 tier 相乘（T0 Jellyfish 10 → T1 60 → T2 360 credits）。
来源: https://riskofrain2.fandom.com/wiki/Monsters 、https://riskofrain2.fandom.com/wiki/Directors

6. **玩家侧**：靠等级 + 道具。玩家 `level = log₁.₅₅(1 + 0.0275×exp) + 1`，每级经验需求 **×1.55**（指数），而敌人等级由 coeff 推到 99 级。wiki 结论：**高等级后升级几乎不可能，玩家最终必须靠道具存活**——即敌人 ambient level 增速快于玩家等级。
来源: https://riskofrain2.fandom.com/wiki/Level

7. **递增形状**：线性 + 阶跃（每关 ×1.15 指数累乘）。wiki 原文：*"This increase is exponential, which means that as more Loops are completed, the game becomes exponentially harder."*
来源: https://riskofrain2.fandom.com/wiki/Difficulty

8. **一局长度**：正常通关 = 5 个主环境 + Commencement（第 6 关起 Tier 2 精英可出）。
来源: https://riskofrain2.fandom.com/wiki/Environments
**官方单局目标分钟数、成长机会次数：未取得**（Steam 帖中 30 min 与 2 h 并存，属玩家估计）。

9. **玩家死在哪 / 平衡讨论**：**通关率与死亡分布：未取得**。公开抱怨两方向都有：后期"Elites are just unfun bullet sponges (with malachite and celestine being twice as bad)… Elite enemies/bosses will eventually have 10x more health than normal enemies"、"Active enemy scaling means enemies and especially bosses can just heal the damage you did if you take too long"；前期"Way less safety nets for you not getting one-shot"。
来源: https://steamcommunity.com/app/632360/discussions/0/2733047810431375149

10. **"敌人伤害太低"**：RoR2 侧**未取得**该讨论；公开抱怨方向相反（"能活但打不动"）。数值上确有 20% < 30% 的结构，但社区表述为**子弹海绵**问题。

11. **开发者原文**（难度 +10% 补丁）：
> "Increase difficulty rate over time for all difficulties by +10%. *Developer Notes: In this update, we've buffed a ton of items - and also given players way more agency over the way a run progresses. Our goal is for players to be more engaged with the game - what we don't want is for the game to be suddenly much easier. This is a bit of a sanity check, and shouldn't dramatically change the difficulty.*"
> 译：把所有难度的时间难度增长率提高 10%。开发者注释：本次更新加强了大量道具，也让玩家对推进节奏有了更多掌控。目标是让玩家更投入——我们不希望游戏突然变简单。这是一次校准，不应剧烈改变难度。
>
> "We've had a lot of feedback that elite health has always felt a bit bloated - and that subsequently, it makes the Old Guillotine feel required. Our intent is to make characters less reliant on the Old Guillotine…"
> 译：我们收到大量反馈说精英血量一直过于臃肿，以至于让"断头台"显得是必需品。我们的意图是让角色不再依赖它。
来源: https://riskofrain2.fandom.com/wiki/Early_Access_Content_Update_5

---

## 二、Vampire Survivors

1. **敌人生命涨幅 — 不随时间，而随玩家等级**：敌人唯一相关技能 "**HP x Level**"：*"multiplies the enemy's health based on the player's level. This is applied the moment the enemy was spawned"*。即 `实际HP = 基础HP × 玩家等级`（快照式）。**玩家升级 = 敌人变厚，自动同步。**
来源: https://vampire-survivors.fandom.com/wiki/Enemies

2. **具体数字**：蝙蝠 Pipeestrello 基础 HP 1 / 5 / 5，伤害 5。20 级时该蝙蝠 = 100 HP，60 级 = 300 HP。
来源: https://vampire-survivors.fandom.com/wiki/Bat

3. **敌人伤害涨幅 — 基本不涨（关键不对称）**：wiki 称敌人伤害为 **Power**，仅定义为 *"contact damage … before modifications, such as Armor"*，**无任何等级或时间倍率**。蝙蝠伤害恒为 4–6 / 5 / 5。唯一提高敌人伤害的是 Endless 模式：**每循环 +25% damage**。
来源: https://vampire-survivors.fandom.com/wiki/Enemies 、https://vampire-survivors.fandom.com/wiki/Stages

4. **数量/密度 — 真正的旋钮**：Curse 按百分比同时提高敌人生命、移速、波次频率与数量，`effectiveSpawnInterval = spawnInterval / totalCurse`（200% Curse = 刷怪间隔减半）。单局可堆到 `+(玩家等级 + 280)%`；PowerUp 与 Skull O'Maniac 各上限 +50%，Gold Ring + Metaglio Right 各 +40%，Torrona's Box +100%。
来源: https://vampire-survivors.fandom.com/wiki/Curse
**普通模式每分钟敌人数值增长：未取得。** 唯一明确的每分钟公式是特定关卡 The Bone Zone：*"Every minute the enemies' health and speed scale by 0.3 and 0.05 respectively, without a cap."*
来源: https://vampire-survivors.fandom.com/wiki/Stages

5. **精英倍率**：无 RoR2 式通用精英倍率体系；难度 = 更强怪种 + Curse 倍率 + 玩家等级倍率。Boss 仅被描述为 "more health, dealing more damage…"，**具体倍率未取得**。The Reaper 基础 HP **655,350 × 玩家等级**，伤害固定 **65,535**。
来源: https://vampire-survivors.fandom.com/wiki/Enemies 、https://vampire-survivors.fandom.com/wiki/The_Reaper

6. **玩家侧**：靠 3–4 选 1 的升级成长。XP 需求 1→2 级 5 XP，**每级 +10 XP 至 20 级**；21–40 级每级 +13；41 级起每级 +16。20 / 40 级各有 600 / 2400 XP 的墙，但同级给 **+100% Growth** 抵消。累计 XP：20 级 ≈1,805；40 级 ≈8,835；60 级 ≈23,495。**道具槽上限 6 武器 + 6 被动**。
来源: https://vampire-survivors.fandom.com/wiki/Level_up 、https://vampire-survivors.fandom.com/wiki/Growth

7. **递增形状**：阶梯 + 分段线性。常规关有固定时间上限（基础 5 关 30 分钟量级；Bonus/Challenge 关 15 或 20 分钟），到点后 **Reaper 每分钟刷一个、必杀**。"突然压倒"是被显式设计的硬收束点。
来源: https://vampire-survivors.fandom.com/wiki/Stages 、https://vampire-survivors.fandom.com/wiki/The_Reaper

8. **一局长度与成长机会**：单关 15 / 20 / 30 分钟（依关卡）；成长机会 = 每次升级 3–4 选 1，到 60 级约 59 次，但受 6+6 槽位约束，之后升级只给金币/回血或 Limit Break。
来源: https://vampire-survivors.fandom.com/wiki/Stages 、https://vampire-survivors.fandom.com/wiki/Level_up

9. **玩家死在哪 / 通关率**：**权威死亡分布与通关率：未取得。** 设计上的主要死因是到点时被 Reaper 固定 65,535 伤害秒杀（除非用 Infinite Corridor / Crimson Shroud / 极高 Armor 对抗）。
来源: https://vampire-survivors.fandom.com/wiki/The_Reaper

10. **"敌人伤害太低导致中后期没有威胁" — 有明确公开讨论，且是三款里最确凿的一例**。Steam 帖 "Too easy (dlc)?" 楼主原文：
> "I just stand and wait for level up. Nothing to do, nothing to worry about… you should think about players like me and add something like enemies adjust their power to yours."
回复原文：**"there is very little that can be done to stop us or provide any kind of challenge… We are monsters"**
来源: https://steamcommunity.com/app/1794680/discussions/0/4365754151472423826
数值支撑：敌人 HP 随玩家等级涨，**但敌人伤害完全不随进度涨**，故后期唯一败因是"打不完"与 Reaper 固定秒杀。

---

## 三、Slay the Spire

1. **敌人生命涨幅 — 无时间轴，只有离散阶梯**。难度由**幕（Act）**与**进阶等级（Ascension）**决定。Jaw Worm：Act 1 HP **40–44**，**A7+ 为 42–46**（≈+5%）。
来源: https://slay-the-spire.fandom.com/wiki/Jaw_Worm

2. **敌人伤害涨幅**：Jaw Worm Chomp **11 → A2+ 12**（≈+9%）。Corrupt Heart：HP **750 → A9+ 800**（+6.7%）；Blood Shots **2×12 → A4+ 2×15**；Echo **40 → A4+ 45**。→ **伤害涨幅略高于生命涨幅，与 RoR2 方向相反。**
来源: https://slay-the-spire.fandom.com/wiki/Jaw_Worm 、https://slay-the-spire.fandom.com/wiki/Corrupt_Heart

3. **数量/密度**：固定遭遇表，不随时间增加。被 A 等级改变的是**遭遇内容**：A1 *"approximately 60% more Elites spawned in a map"*；A20 在 Act 3 末尾**同时打两个 Boss**。
来源: https://slay-the-spire.fandom.com/wiki/Ascension

4. **精英倍率**：A1 精英数量 +60%；**A8 精英血量提高；A3 精英伤害提高；A18 精英获得更难招式**。**具体倍率百分比：未取得**（wiki 仅定性）。成长是离散阶梯，不随局内时间推进。
来源: https://slay-the-spire.fandom.com/wiki/Ascension

5. **玩家侧成长与配比**：靠卡组 + 遗物 + 药水，**无任何等级数值**。关键结构差异：玩家侧在局内**持续变强**，敌人侧在局内**数值恒定**；敌人的成长全部发生在**元层面（A1→A20 永久阶梯）**，而非单局内。
来源: https://slay-the-spire.fandom.com/wiki/Ascension

6. **递增形状**：**纯阶梯/跳变**，A1–A20 效果**累加**（A3 含 A1+A2 全部效果），每级 +5% 分数（A20 满额 +100%）。局内近似平台期。A12 是唯一影响局内曲线的改动：升级卡出现率 Act 2 25%→12.5%、Act 3 50%→25%。
来源: https://slay-the-spire.fandom.com/wiki/Ascension

7. **一局长度与成长机会**：Act 1 = **floor 1–17**（floor 1 普通战、9 宝箱、15 篝火、16–17 Boss 与 Boss 宝箱）。三幕合计约 **50 层**，另加 Act 4。**每局成长机会的权威次数：未取得**（每场战斗 1 次卡牌奖励 + 篝火 + 商店 + 精英奖励）。
来源: https://slay-the-spire.fandom.com/wiki/Act_1 、https://slay-the-spire.fandom.com/wiki/Act_4

8. **玩家死在哪 — 三款中唯一有量化统计**：基于 **7,700 万玩家**数据集、抽样 18,215 局的硕士论文给出 **总体胜率 ≈ 9%**（原文：winning 1,513 vs. 16,702 runs，"Giving a win rate of ≈ 9%"），为**跨所有进阶等级的混合值**。胜者组进阶分布中 **A1 最普遍、A2 次之、A20 接近第三**。
来源: http://mau.diva-portal.org/smash/get/diva2:1563050/FULLTEXT02.pdf
**按 Act 拆分的死亡分布：未取得。**

9. **"早期暴死 vs 后期无解"**：StS 侧的公开讨论方向是**"前期最致命"**。A20 被社区描述为 "notorious for being extremely difficult… a test of your skill and game knowledge, with a healthy dose of good luck required"（来源: https://steamcommunity.com/app/646570/discussions/0/2576571891746197602）。论文亦指出 "a lot of players lose early on, not expanding their deck"。**"后期无解"一侧：未取得**——后期困难被归因于前中期决策累积，而非数值压倒。

10. **"敌人伤害太低"**：**未取得**；StS 设计上不存在该窗口（敌人数值恒定，变量在玩家资源）。

11. **设计者说法**：我找到的 Giovannetti 播客访谈中出现的 "Ascension" 指**他早年参与的同名桌游**，非 StS 进阶模式，该集无 A1–A20 设计论述。**进阶模式设计意图的直接开发者引述：未取得。**
来源: https://podscripts.co/podcasts/think-like-a-game-designer/anthony-giovannetti-crafting-slay-the-spire-nurturing-team-dynamics-balancing-life-and-launches-and-embracing-the-magic-of-mods-59
可用的官方原始说明为 A9 补丁发布文本：
> "This mode can be accessed by defeating all of the Act 3 bosses… Each Ascension run will get harder as you emerge victorious. But beware, each victory will add another layer of difficulty… Currently, there are 10 Ascension Levels to fight through!"
> 译：击败所有第三幕 Boss 后解锁本模式……每次获胜后进阶难度都会更高。但注意，每次胜利都会再加一层难度……目前共有 10 个进阶等级可供挑战。
来源: https://slay-the-spire.fandom.com/wiki/Ascension

---

## 四、对 roguelite 的可操作结论

1. **把"生命涨幅"与"伤害涨幅"当两个独立参数，别绑成一个系数。** RoR2 用一个 coeff 同时乘 HP 与 damage，但斜率 **+30% HP / +20% damage 每级**，导致 30 分钟时 HPx 7.47× 而 DMGx 仅 5.31×，倍率比恒为 3:2，玩家"死不了但打不动"（来源: https://riskofrain2.fandom.com/wiki/Difficulty）。若你希望后期仍然致命，就让伤害斜率 ≥ 生命斜率；StS 是反例（+9% dmg vs +5% HP）。
2. **用"时间线性 × 关卡指数"双旋钮，但要预期指数项主导。** 5 关后 stageFactor 已达 2.01×。含义：**若想让玩家靠"多刷一会儿"追赶，指数项就不能按关卡数累乘**，否则慢速玩家被关数而非时间惩罚。更省事的替代是仿 VS 让敌人 HP 直接乘玩家等级（来源: https://vampire-survivors.fandom.com/wiki/Enemies），成长与难度自动同步，无需手调两条曲线。
3. **把"密度"当一等旋钮，并设硬上限。** RoR2 刷怪预算随 coeff 线性增长但**封顶 40 个怪**（来源: https://riskofrain2.fandom.com/wiki/Directors）；VS 用 `spawnInterval = 基础间隔 / Curse` 让玩家**自愿**加倍密度并同时提高收益（来源: https://vampire-survivors.fandom.com/wiki/Curse）。后者是把难度旋钮交给玩家的好范式。
4. **精英倍率要沿"相对当前等级"叠加，且不能强到变成必需品。** RoR2 Tier 1 = **4× HP / 2× DMG**、Tier 2（第 5 关后）= **18× HP / 6× DMG**，因是相对当前等级的乘数而随进度放大（来源: https://riskofrain2.fandom.com/wiki/Monsters）。Hopoo 因"精英血量臃肿到让断头台成为必需品"而两次下调（470%→400%、2350%→1800%，来源: https://riskofrain2.fandom.com/wiki/Early_Access_Content_Update_5）。**判据：若某件道具成为打精英的默认解，是精英倍率过高，而非道具太强。**
5. **给"结束"设显式硬收束点，别只靠曲线自然压倒。** VS 用 The Reaper——超时后每分钟一个、固定 **65,535 伤害**（来源: https://vampire-survivors.fandom.com/wiki/The_Reaper），让"这局必须结束了"确定可预期，避免 RoR2 式"谁也打不死谁"的僵局（Boss 回血超过玩家输出，来源: https://steamcommunity.com/app/632360/discussions/0/2733047810431375149）。但 VS 也因此被公开批评"敌人几乎打不死你"（来源: https://steamcommunity.com/app/1794680/discussions/0/4365754151472423826）——**若敌人伤害不随进度成长，就必须靠硬收束点或资源枯竭来制造失败压力。**
