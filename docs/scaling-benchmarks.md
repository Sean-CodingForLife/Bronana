---
title: "难度与成长曲线的外部基准（七款游戏对照）"
category: 外部参考
status: 现行
scope: "七款同类游戏的**曲线对照** + 本作站在哪 —— 调数值前必读"
source: "外部来源带强度标注；本作那一列由 `pnpm run curves` 与 `tools/balance.mjs` 量"
links: ["scaling-isaac-gungeon.md", "scaling-ror2-vs-sts.md", "external-benchmarks.md"]
---
# 难度与成长曲线的外部基准（七款游戏对照）

> 这份文件回答一个问题：**"敌人数值该涨多快"这个行业里到底怎么做的**。
> 它只收**能查到出处的数字**；查不到的写「未取得」，不猜。
>
> 逐游戏的完整明细在另外两份里：
> · [`scaling-isaac-gungeon.md`](scaling-isaac-gungeon.md) —— 以撒的结合 / 挺进地牢
> · [`scaling-ror2-vs-sts.md`](scaling-ror2-vs-sts.md) —— 雨中冒险 2 / 吸血鬼幸存者 / 杀戮尖塔
>
> ⚠ 抓取方法备忘：`fandom.com` 与 `wiki.gg` 对普通 `web_fetch` 返回 **403**，
> 走 **MediaWiki API**（`api.php?action=parse&prop=wikitext`）可以取到原文；
> Steam 全球成就页可以直接抓，而且它是**最好的"玩家死在哪"数据源**。

---

## 1. 敌人成长：横向对照

| 游戏 | 敌人生命涨幅（开局→结局） | 敌人**伤害**涨幅 | 生命:伤害 | 移速/攻速 |
| --- | --- | --- | --- | --- |
| **Brotato** | ×10–14 @ 波20（线性） | **×12.4（与生命同一条公式）** | **1:1** | **完全不随波次变** |
| **Hades**（热度满级） | **+30%** | **+100%** | **1:3.3** | +40%（手动档） |
| **Dead Cells** | 超线性（LifeTier × 线性增量） | **独立的 AtkTier 与独立系数** | 刻意不同步 | 4 BSC 起加传送追击 |
| **以撒的结合** | ~×3（stage 1–4 加满、**stage 5 加 0**、stage 10 封顶） | **完全不随楼层涨**（champion 恒满心） | 只涨血 | 无全局倍率（换敌种） |
| **挺进地牢** | **×2.1 全程**（相邻 1.3→1.23→1.156→1.135，前陡后缓） | **不随楼层涨**（恒半心） | 只涨血 | 无全局倍率（换变体） |
| **雨中冒险 2** | ×7.47 @ 30min/5关 · ×26.1 @ 60min/10关 | ×5.31 · ×17.73 | **3:2**（HP +30%/级、伤害 +20%/级） | 无独立倍率 |
| **吸血鬼幸存者** | ×玩家等级（生成时快照） | **完全没有倍率**（蝙蝠恒 5） | 只涨血 | Curse 可加 |
| **杀戮尖塔** | 幅度极小（A7 使 Jaw Worm 40–44 → 42–46 = **+5%**） | **+9%**（略高于生命） | 1:1.8 | 无 |

> **Bronana 现在**：敌人生命 **×26.9 @ 间39**、伤害 **×4.34** → **生命:伤害 = 6:1**。
> 这个比值在七款里**没有一个与之同向** —— 唯一"只涨血"的三款（以撒 / 地牢 / VS）
> 生命涨幅都极小（2.1× ~ 3×），而 Bronana 借的是 Brotato 的量级（×27）。

---

## 2. 逐游戏要点

### 2.1 Brotato —— 线性、伤害与生命同式

- 敌人生命 `base + perWave × (波−1)`，**线性**；伤害走**同一套公式**；**移速不随波次变**。
- 实测：Tree 10→105（×10.5）、Baby Alien 3→41（×13.7）、Bruiser 20→229（×11.5）。
- 精英独立线性成长：**+750 HP/波**（第 11 波 ≈ 7,500+）。
- 玩家侧：升级 4 档稀有度，Damage `+5 / +8 / +12 / +16`（**×3.2**），且**等级门控** ——
  L1 保 T1、L5 保 T2、L10/15/20 保 T3、**L25 起每 5 级保 T4**。
- 一局 20 波 = 17.5 分钟纯战斗 + 商店 ⇒ **25–30 分钟**。
- 来源: <https://brotato.wiki.spellsandguns.com/index.php?title=Enemies> ·
  <https://brotato.wiki.spellsandguns.com/index.php?title=Upgrades>

### 2.2 Hades —— **伤害涨幅是生命涨幅的 3.3 倍**

Pact of Punishment（手动热度档，与进度解耦）上每一项的精确值：

| 热度项 | 每级 | 满级 |
| --- | --- | --- |
| Hard Labor（5 级） | 敌人**伤害** +20% | **+100%** |
| Calisthenics Program（2 级） | 敌人**生命** +15% | **+30%** |
| Forced Overtime（2 级） | 敌移速 + 攻速 +20% | +40% |
| Jury Summons（3 级） | 敌人**数量** +20% | +60% |
| Heightened Security | 陷阱伤害 +400% | — |

**关键**：同一套旋钮里，**伤害涨幅（+100%）是生命涨幅（+30%）的 3.3 倍** —— 两者刻意不同步，
方向是"更痛但不更肉"，避免把战斗时长拉长去稀释爽感。

另一条可借鉴的是 **God Mode 的连续兜底**：起始 **−20% 受伤**，每次死亡 **+2%**，上限 **−80%**
（约 30 次死亡到顶）—— 它是**连续**曲线，与热度的**离散**档位互补。

设计者 Greg Kasavin 原话：

> *"God Mode reinforces our belief that the way to approach difficulty settings may need to be
> proprietary to the game. It's not a one size fits all solution."*
> 中文：God Mode 强化了一种信念 —— 处理难度设定的方式可能需要**因游戏而异**，不存在放之四海皆准的方案。

> *"I think what sometimes is lost in the conversation around difficulty is that it's not easy to
> tune a video game."*
> 中文：关于难度的讨论里常被忽略的一点是，**给一款游戏做数值调校从来都不容易**。

Hades 官方 wiki **未公开**按区域的敌人数值表 → 该游戏的"随进度成长曲线"标为**未取得**。
来源: <https://segmentnext.com/hades-pact-of-punishment/> ·
<https://game-swamp.com/pact-of-punishment/> ·
<https://caniplaythat.com/2021/08/11/hades-god-mode-explained-by-supergiant-games/>

### 2.3 Dead Cells —— 两套独立系数 + **玩家 HP 封顶**

- 官方公式（wiki.gg）：`DMG = Base × MobScaleFactor(AtkTier−1) × (1+(AtkTier−1)×MobScaleMulPerTier)`；
  `HP = Base × MobLifeScaleFactor(LifeTier−1) × (1+(LifeTier−1)×MobLifeScaleMulPerTier) × (1+Enemy Type Bonus)`。
  **伤害用 `AtkTier`、生命用 `LifeTier` —— 两套变量、两套系数**，所以它俩**刻意不同步**。
- 敌人 Tier 随 Biome 跳升：囚牢 1–3 → 长廊 3–7 → 壁垒 7–13 → 钟楼 5 / 王座 7。
- Boss 随 BSC 阶梯成长：Concierge `24,577 → 167,306`（0→5 BSC）= **6.81×**；Time Keeper **10.96×**。
- 玩家侧：每点 Stat 伤害 **×1.15 复利**（20 点 = **14.23×**，约每 +5 点翻倍）；
  但**玩家 HP 是二次函数并被硬封顶**（Brutality 12.375 / Tactics 7.25 / Survival 22）。
- 装备 Gear Power 1→8：伤害 **+0% → +129%**（约 +29%/级）。
- **精英是固定额外倍率，不随进度二次乘算。**
- 死亡分布（Steam 全球成就）：到黑桥 **76.7%** → 杀第一个 Boss（Concierge）**72.4%** →
  到王座 48% → 杀王手 40.4% → 到 Astrolab 17.3%。
  ⇒ **第一个 Boss 只吃掉 4.3% 的人**；断崖在"首 Boss 之后到中段"。
- 来源: <https://deadcells.wiki.gg/wiki/Biomes> · <https://deadcells.wiki.gg/wiki/Bosses> ·
  <https://deadcells.wiki.gg/wiki/Stats> · <https://deadcells.wiki.gg/wiki/Gear> ·
  <https://gemelog.jp/games/dead-cells/achievements/>

### 2.4 以撒的结合 —— 生命温和上涨，**伤害完全不涨**

- 生命**不是**楼层倍率，而是两段式：
  `HP = BaseHP + (min(4,Stage) + 0.8 × bound(0, Stage−5, 5)) × StageHP`
  —— stage 1–4 每层加满、**stage 5 加 0**、stage 6–10 每层加 0.8、stage 10 封顶。
- 敌人**伤害不随楼层变**；champion "无视章节，造成满心伤害"。
- Champion 倍率**固定**：基础 HP ×2；Red ×2.6 / Large ×3 / Crown **×6** / Gray ×0.66。
  出现率 Normal 5% / Hard 20%。**倍率不随楼层放大。**
- Boss **固定 HP**：Satan 600 · Isaac/Lamb 2,000 · Mega Satan 5,000+2,000 · Hush 6,666 · Delirium 10,000。
- 玩家伤害是**平方根衰减**：`(base×ups×1.2+1)^0.5 × Multipliers` ——
  第 1 个 +1 伤害道具值 **1.69**，第 2 个只值 **1.26**；而稀缺的 ×2 乘法器可叠到 ×4。
- Steam：Hard Mode 解锁 44.6%、无伤过 Basement 47.0% ⇒ **过 Basement 的人约 6 成倒在前三章**。
- McMillen：难度是**解锁门控**而不是一开始就全放出来。

### 2.5 挺进地牢 —— **全程只涨 2.1×**，但 Boss 有逐层 DPS 上限

- 敌人生命按楼层跳档：`×1 → 1.3 → 1.6 → 1.85 → 2.1`（相邻比 1.3→1.23→1.156→1.135，**前陡后缓**）。
  **开局到结局总共 2.1×。**
- 敌人**子弹伤害不随楼层涨**（按半颗心结算并封顶）。
- **Boss 有逐层 DPS 上限**（A Farewell to Arms）：`30 / 42 / 60 / 70 / 78 / 80` ——
  后半程玩家允许的输出提高 **2.67×**，比敌血 2.1× 还快。**这是一条"设计者心里有目标 DPS"的证据。**
- Jammed（诅咒精英）：生命 `×3.5+10`、移速射速 **+50%**、冷却 **−33%**、
  出现率随 Curse `0 → 1% → 5% → 10% → 25% → 50%`。**倍率本身不随楼层放大。**
- 玩家变强主要靠**掉落品质迁移**：宝箱品质分布 D/C/B/A/S 从 F1 `35/32/20/9/4`
  右移到 F5 `0/10/42.5/35/12.5`。
- 死亡分布（Steam）：Clear Chamber1 **18.6%** → Chamber2 **13.4%** → 之后每层 10–14%。
  ⇒ **1→2 层流失 28%，其后每层只有 10–14%** —— 阵亡绝大多数集中在第 1–2 层。
- 设计者 Crooks 原话：
  > *"we've always designed our game only for players who like a challenge… even with just the
  > starter weapon, it's still possible for players to complete it."*
  > 中文：我们一直只为喜欢挑战的玩家设计……**即便只用初始武器，玩家依然可能通关。**

### 2.6 雨中冒险 2 —— 同一系数乘两边，但**斜率不同**

`coeff = (playerFactor + 分钟 × 0.0506 × 难度值 × 玩家数^0.2) × 1.15^已通关卡数`，
`enemyLevel = 1 + (coeff − playerFactor)/0.33`。

| 时间 | 关卡 | HP × | 伤害 × |
| --- | --- | --- | --- |
| 10 min | 0 | 1.92 | 1.61 |
| 30 min | 5 | **7.47** | **5.31** |
| 60 min | 10 | 26.10 | 17.73 |

- **同一个 `coeff` 同时乘生命与伤害，但 HP 每级 +30%、伤害每级 +20% ⇒ 比值恒为 3:2。**
- 精英 Tier 1 = **4× HP / 2× DMG**（第 1 关起）；Tier 2 = **18× HP / 6× DMG**（第 5 关后）；
  **相对当前等级乘算，所以随进度同步放大**。
- ⚠ **它为此挨过打**：补丁把精英血**两次下调**（470%→400%、2350%→1800%），原话
  > *"We've had a lot of feedback that elite health has always felt a bit bloated — and that
  > subsequently, it makes the Old Guillotine feel required."*
  > 中文：大量反馈说精英血量一直感觉虚胖 —— 以至于**某件道具变成了必需品**（Old Guillotine）。
  ⇒ **可操作判据：若某一件道具成为"打精英的默认解"，那是精英倍率过高，不是道具太强。**

### 2.7 吸血鬼幸存者 —— 伤害**完全不涨**，难度全在数量

- 敌人生命 = `基础HP × 玩家等级`（**生成时快照**）。
- 敌人伤害**没有任何等级或时间倍率**（蝙蝠三个变体恒为 4–6 / 5 / 5）。
- 难度旋钮是**数量**：`effectiveSpawnInterval = spawnInterval / totalCurse`
  （200% Curse = 刷怪间隔减半），单局可堆到 `+(玩家等级 + 280)%`。
- 社区公开批评正是**"太简单、敌人打不死你"**（"I just stand and wait for level up."）。

### 2.8 杀戮尖塔 —— 局内敌人数值恒定，成长全在元层面

- A7 使 Jaw Worm HP `40–44 → 42–46`（**+5%**）；A2+ 使伤害 `11 → 12`（**+9%**）。
  **伤害涨幅略高于生命**（与 RoR2 同向，与以撒/地牢反向）。
- 基于 7,700 万玩家、抽样 18,215 局的硕士论文：**总体胜率 ≈ 9%**
  （1,513 胜 / 16,702 负；跨所有进阶等级的混合值）。
- 论文另指出："a lot of players lose early on, not expanding their deck"（很多人**很早就输**）。

---

## 3. 跨游戏的六条共识

| # | 共识 | 谁支持它 |
| --- | --- | --- |
| 1 | **敌人伤害的涨幅 ≥ 生命的涨幅**；若伤害不涨，则生命也**几乎不涨** | Brotato 1:1 · RoR2 3:2 · Hades 1:3.3 · StS 1:1.8；以撒/地牢/VS 是"两边都不涨"那一类 |
| 2 | **生命涨幅的量级在 2×~15×**，没有一款到 27× | 地牢 2.1× · 以撒 ~3× · Brotato 10–14× · RoR2 7.5×(30min) |
| 3 | **精英是"离散、条件触发、倍率固定"**，不随进度二次放大 | 以撒 ×2–×6 固定 · 地牢 ×3.5+10 固定 · Dead Cells 固定；**唯一例外 RoR2 会同步放大 → 被反馈"虚胖"并两次下调** |
| 4 | 难度主要靠**数量 / 弹幕形状 / 敌人种类 / 掉落品质迁移**，不是全局乘一个伤害系数 | VS 全靠数量 · 地牢靠弹幕+品质迁移 · 以撒靠换敌种 |
| 5 | 玩家侧要**衰减收益 + 稀缺乘法器** | 以撒平方根（1.69→1.26） · Dead Cells ×1.15 复利但 **HP 封顶** |
| 6 | **首 Boss 不该是墙**；阵亡集中在前段但要有"能过"的比例 | Dead Cells 首 Boss 只吃 **4.3%** · 地牢 1→2 层流失 28%（最高）· 以撒过 Basement 者 6 成倒在前三章 |

---

## 4. Bronana 站在哪（实测对照）

| 维度 | 外部区间 | Bronana 实测 | 判断 |
| --- | --- | --- | --- |
| 敌人生命 @ 20 关 | — | ×9.0 | — |
| 敌人生命 @ 39 关 | **2×~15×** | **×26.9** | ⚠ **超出全部七款** |
| 敌人伤害 @ 39 关 | 与生命同量级，或更快 | **×4.34** | ⚠ |
| **生命 : 伤害** | 1:1 · 3:2 · 1:3.3 · 1:1.8 | **6:1** | ⚠ **七款里没有一款与它同向** |
| 敌人移速 | 以撒/地牢/VS/Brotato = **0** | ×1.25（1.35 封顶） | ✔ 接近 |
| 精英 | 离散、条件触发、**倍率固定** | 逐只掷、上限 24%、×3.2 固定 | 🟡 倍率固定 ✔，但"逐只掷"让它必然出现 |
| 首 Boss 门槛 | Dead Cells **4.3%** · 地牢 1→2 层 **28%** | 房间 **4–5 吃掉 42%** | ⚠⚠ **比地牢还陡，是 Dead Cells 的 10 倍** |
| 玩家 HP @ 终局 | Dead Cells 二次且**硬封顶** | 20 → 53（中位）×2.65 | 🟡 无上限 |
| 一局长度 | 20–30 分钟（Brotato/Hades/VS） | 24.8 分钟（中位） | ✔ |

**结论一句话**：Bronana 借了**以撒/地牢的"形状"**（只涨血、伤害平），
却用了**Brotato 的量级**（×27 而不是 ×2.1）—— 这个组合七款里没有先例。

---

## 5. 来源清单

**Brotato** — <https://brotato.wiki.spellsandguns.com/index.php?title=Enemies> ·
<https://brotato.wiki.spellsandguns.com/index.php?title=Upgrades>

**Hades** — <https://segmentnext.com/hades-pact-of-punishment/> ·
<https://game-swamp.com/pact-of-punishment/> ·
<https://caniplaythat.com/2021/08/11/hades-god-mode-explained-by-supergiant-games/> ·
<https://gemelog.jp/games/hades/achievements/>

**Dead Cells** — <https://deadcells.wiki.gg/wiki/Biomes> · <https://deadcells.wiki.gg/wiki/Bosses> ·
<https://deadcells.wiki.gg/wiki/Stats> · <https://deadcells.wiki.gg/wiki/Gear> ·
<https://deadcells.wiki.gg/wiki/Enemies> · <https://deadcells.wiki.gg/wiki/Boss_Stem_Cells> ·
<https://gemelog.jp/games/dead-cells/achievements/>

**以撒的结合** — <https://bindingofisaacrebirth.wiki.gg/wiki/Stage_HP> ·
<https://bindingofisaacrebirth.wiki.gg/wiki/Champions> ·
<https://bindingofisaacrebirth.wiki.gg/wiki/Damage_Scaling> ·
<https://bindingofisaacrebirth.wiki.gg/wiki/Damage> ·
<https://steamcommunity.com/stats/250900/achievements/>

**挺进地牢** — <https://enterthegungeon.fandom.com/wiki/Bosses> ·
<https://enterthegungeon.fandom.com/wiki/Curse> ·
<https://enterthegungeon.fandom.com/wiki/Chests> ·
<https://enterthegungeon.fandom.com/wiki/Stats> ·
<https://steamcommunity.com/stats/311690/achievements/>

**雨中冒险 2** — <https://riskofrain2.fandom.com/wiki/Difficulty> ·
<https://riskofrain2.fandom.com/wiki/Level> · <https://riskofrain2.fandom.com/wiki/Monsters> ·
<https://riskofrain2.fandom.com/wiki/Early_Access_Content_Update_5>

**吸血鬼幸存者** — <https://vampire-survivors.fandom.com/wiki/Enemies> ·
<https://vampire-survivors.fandom.com/wiki/Curse> · <https://vampire-survivors.fandom.com/wiki/Level_up>

**杀戮尖塔** — <http://mau.diva-portal.org/smash/get/diva2:1563050/FULLTEXT02.pdf>

**方法论** — <https://github.com/raduacg/game-mechanics-optimizations/blob/main/D_21_difficulty_ramping.md>
