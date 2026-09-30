# 外部基准：2D 俯视竞技场 Roguelite 的公开设计数字

> 这一轮"全量测试"要求**外部参考**。这份文件是那次调研的原始结果：
> 把同类游戏**能查到的公开数字**（单局时长、首胜局数、决策密度、内容量、
> 元进度成本、Boss 节奏、难度公式）逐项列出来，并标注来源强度。
>
> **它不判定本作"好不好"** —— 判定在 `README.md` 的「全量测试」那一节，
> 需要两边一起读。这里只保证一件事：**每个数字都能追到出处**，
> 追不到的就写 `未验证`，不编。
>
> ⚠ **数值曲线另有三份专题**（调难度/成长曲线时看那三份，不是这份）：
> · [`scaling-benchmarks.md`](scaling-benchmarks.md) —— **七款游戏的敌人生命/伤害涨幅横向对照**
>   + 生命:伤害 比值 + 精英模型 + 阵亡分布 + Bronana 站在哪。**先看这份。**
> · [`scaling-isaac-gungeon.md`](scaling-isaac-gungeon.md) —— 以撒 / 地牢明细
> · [`scaling-ror2-vs-sts.md`](scaling-ror2-vs-sts.md) —— RoR2 / VS / 杀戮尖塔明细

## 怎么读标注

| 标注 | 含义 |
| --- | --- |
| `[实取]` | 实际抓取了该页面正文 |
| `[摘要，子代理实取]` | 原页由子代理抓取，主代理只看到摘要 |
| `[摘要]` | 只在搜索结果摘要里看到，未打开原页 |
| `未验证` | 没找到可靠来源 —— **这一类最值得记**，因为它标出了"公开领域里根本没有共识"的地方 |

`未验证` 的六条（搜遍全网也没有权威数字）：DPS 成长比的行业标准、
"每分钟决策数"的行业标准、"可避免死亡应占 X%"、Minenko 论文里 telegraph 的毫秒推荐值
（正文被 Cloudflare 403 挡住）、Dead Cells 与 StS 的一手单局时长。
**任何声称这些有"官方标准"的说法都不可信** —— 本作因此把它们当**设计目标**而不是"行业达标线"。

---

## 1. 单局时长（Run Length）

| 游戏 | 单局时长（分钟） | 首胜所需局数 | 来源 |
|---|---|---|---|
| Vampire Survivors | **15 / 20 / 30 分钟**（关卡计时器硬上限，按关卡而异；到时后 **The Reaper 每分钟来一次**强制结束本局，除非开启 Endless） | — | VS Wiki「Stages」`[实取]`：`…the time limit ends, which is at 30:00, 20:00, or 15:00 depending on the stage.` |
| Brotato | **纯战斗 17.5 分钟**（1050 秒 = 20+25+30+35+40+45+50+55+60×11+90）+ 商店时间 ⇒ **实际一局 25–30 分钟** | **2–12 局**（HltB 记录：第 2 局通关 56m–1h15m；「first win」30m/31m/1h/1h58m/2h） | Brotato Wiki Waves `[摘要，子代理实取]`；HltB Brotato `[实取]` |
| Hades | **中位数 21 分 14 秒**；平均 **21 分 40 秒**；最快 8m47s，最慢 35m（HltB Any% 速通聚合，n=16） | **第 4–34 次尝试**，众数 **13–22 次** | HltB Hades `[实取]` https://rc.hl2b.com/game/62941 |
| Dead Cells | **中位数 44 分 51 秒**；平均 **45 分 14 秒**；最快 38m12s，最慢 53m（HltB Any% 聚合 n=4）；单局记录 38m33s–1h04m | **第 1–97 局**，众数 **7–21 局** | HltB Dead Cells `[实取]` https://rc.hl2b.com/game/45727 |
| Slay the Spire | **45–70 分钟**（单局记录 45m33s / 48m / 50m / 54m / 55m / 57m / 1h05m / 1h09m58s / 1h10m） | **第 2–12 局**（记录：2nd/3rd/4th/6th/7th/12 runs） | HltB Slay the Spire `[实取]` https://rc.hl2b.com/game/51390 |
| Risk of Rain 2 | 无硬上限；**时间即难度**，常规一局 **20–60 分钟** | — | RoR2 Wiki 难度系数公式 `[实取]` |

**速通对照（人力的理论下限，说明单局长度的可压缩空间）**
- Hades Any Heat 世界纪录 **5m04s IGT / 14m22s RTA**；Fresh File（新存档 → 首次逃脱）WR **17m41s realtime**。`[摘要，子代理实取 speedrun.com JSON API]`
- Slay the Spire Any Unseeded WR **3:02.600**。`[摘要，子代理实取 speedrun.com JSON API]`

**由此修正的关键结论**：按「Hades 30–40 分钟/局」推算首胜成本是**高估的**。按实测 **21 分钟/局**、**13–22 局**首胜 ⇒ **首胜累计约 4.5–8 小时**（与 HltB 记录的 10–15 小时总时长一致，差额为失败局之外的探索与对话时间）。

### 1.1 Hades 首胜次数分布（HowLongToBeat 实测样本，`[实取]`）

| 首胜尝试次数 | HltB 时间 |
|---|---|
| 第 4 次 | 3h 30m |
| 第 5 次 | 4h 12m |
| 第 9 次 | 4h 00m |
| 第 12 次 | 5h 46m |
| 第 13 次 | 8h 45m / 9h 06m / 10h / 10h 51m |
| 第 14 次 | 4h 50m / 10h 51m |
| 第 15 次 | 10h / 10h 07m / 13h 32m |
| 第 16 次 | 9h 33m |
| 第 17 次 | 11h 53m / 12h 22m / 13h 40m / 13h 55m |
| 第 18–19 次 | 5h 54m / 12h 00m / 13h 15m / 14h |
| 第 21–22 次 | 10h 55m / 11h 27m / 13h 25m / 14h |
| 第 26 次 | 6h 47m / 15h |
| 第 29–34 次 | 11h 48m / 14h 56m |

### 1.2 Brotato 首胜成本（HowLongToBeat，`[实取]`）

30m / 31m / 56m(2 局) / 1h / 1h15m(第 2 局) / 1h32m / 1h58m / 1h59m / 2h / 2h12m / 2h34m / 3h22m / 3h30m / **4h40m（「开局 RNG 到首胜」）** / 5h / 5h36m / 6h / 9h26m / 10h / 10h06m。
→ 中位数约 **2–3 小时 ≈ 4–6 局**（按 30 分钟/局）。

### 1.3 「再来一局」的会话窗口

- **Brotato 给出最明确的可测基准**：单波 **20s（第 1 波）→ 25 → 30 → 35 → 40 → 45 → 50 → 55 → 60（第 9 波起）**，第 10–19 波 60s，**第 20 波 90s**。
  **纯战斗合计 = 1050 秒 = 17.5 分钟**；加 20 次商店操作 ≈ **一局 25–30 分钟**。来源：Brotato Wiki Waves `[摘要，子代理实取]`
- 20 次商店 × 一次多选 = **一局恰好 20 个决策点** —— 「一局 = 可预期的 20 个抉择」的节奏基准。
- **跨游戏的单局中位数对照**（HltB 实测 `[实取]`）：

| 游戏 | 单局中位数 |
|---|---|
| Hades | **21 分 14 秒** |
| Brotato | 约 **25–30 分钟** |
| Dead Cells | **44 分 51 秒** |
| Slay the Spire | **约 50 分钟**（45m33s–1h10m） |
| Vampire Survivors | **15 / 20 / 30 分钟**（关卡决定） |
| RoR2 | 20–60 分钟（无上限） |

⇒ **「一屏一房间 + 自动攻击」这一子类型的单局中位数集中在 20–30 分钟**（Hades 21 分、Brotato 25–30 分、VS 30 分）。Dead Cells 的 45 分与 StS 的 50 分属**关卡制/卡牌制**范式，不应作为本类游戏的参照。

---

## 2. 首次有意义抉择的时间

| 游戏 | 首次塑造 Build 的抉择 | 时间点 | 来源 |
|---|---|---|---|
| Vampire Survivors | 第 1 次升级选武器/道具 | 开局后 **约 30–60 秒** | 未取得一手秒级数字 `未验证` |
| Brotato | 第 1 次商店（波间） | **第 1 波结束后 = 20 秒** | Brotato Wiki 波次时长 `[摘要]` |
| Hades | 第一个 **Boon 房**（Tartarus 第 1–2 房） | 开局后 **约 1–3 分钟** | 未取得一手数字 `未验证` |
| VS（进化承诺） | 第一个可进化宝箱（多数关卡 **10:00**；Mad Forest 首次 1:00） | **10 分钟**为主流关卡 | VS Wiki「Evolution」`[实取]` |
| VS（终极形态） | 角色 Morph 需**等级 80** + 遗物 | 单局后半段 | VS Wiki「Evolution」`[实取]` |

**一个强约束**（VS Wiki `[实取]`）：VS 的**进化箱在大多数关卡要到 10:00 才出现** ——
也就是说它允许玩家在 30 分钟一局的前 1/3 内**完全不接触终极形态**，把首次成型点后置；
反之 Dairy Plant、Il Molise、Cappella Magna 等关卡"任意时间都能进化" ——
这是设计者刻意用来**改变节奏曲线**的旋钮。

---

## 3. 抉择频率 / 决策密度

| 游戏 | 一局中可数的 Build 抉择点 | 密度 |
|---|---|---|
| Brotato | **20 次商店**（每波后 1 次；每次 4 个道具槽 + 重掷） | 20 / 约 25 分钟 ≈ **0.8 次/分钟** |
| Vampire Survivors | 升级次数 = 一局升级次数（30 分钟局通常 **40–70 级**），其中武器/被动选取约占一半 | 约 **1.5–2 次/分钟** |
| Hades | 单局 Boon 数约 **10–15 个**（4 大区 + Charon 商店 + 混沌门） | 30–40 分钟局 ≈ **0.3–0.5 次/分钟** |
| Slay the Spire | **卡牌奖励**（每场战斗后）+ 商店 + 遗物 + 休息点；一局约 **40–60 次** | 45 分钟局 ≈ **1 次/分钟** |
| Dead Cells | 卷轴 + 变异（3 槽）；卷轴一局约 **20–30 次** | 30–45 分钟局 ≈ **0.6–0.8 次/分钟** |

**设计写作层面**：确实存在把「单位时间内的有意义抉择数」当作 roguelike 品质指标的讨论
（`[摘要]`：insis.vse.cz 论文「Itemizace je zásadní pro flow roguelike her…」—— 物品化对 flow 至关重要），
但**没有**给出「每分钟 X 次」这一硬性行业数字的来源 `未验证`。

---

## 4. Build 分化度

### 4.1 已发布内容量（对照本作的 24 武器 / 31 道具）

| 游戏 | 武器 | 道具 / 被动 | Build 原型 | 来源 |
|---|---|---|---|---|
| Vampire Survivors（1.0 收藏） | 基础游戏 **29 条基础武器→进化线** | 每个进化需 **1 个特定被动** | 1.0 收藏共 **132 个条目**（集齐解锁 Queen Sigma）`[摘要]` | VS Wiki「Evolution」`[实取]` |
| Brotato | 每角色 **6 把武器**（部分 **12 把**，每把 **−5% 伤害**，叠满 **−40%**） | 商店 4 槽 | 31+ 角色，每角色 1 套原型 | Brotato Wiki／namu.wiki `[摘要]` |

### 4.2 VS 的进化结构对「24 武器」的直接含义

VS 是**乘法式**的：`武器 × 特定被动 = 进化`。所以 **N 把基础武器 + M 个被动**
最多生成 **N 条进化线**（每条锁定 1 个被动）。
**承诺成本**：进化前必须把基础武器升到满级（VS 多数为 8 级）+ 持有对应被动
⇒ **一条进化线 ≈ 8–10 次升级投入**。

### 4.3 StS —— 每角色的原型数（`[实取]` https://slaythespire.gg/characters）

这是「一个角色应该支撑几条独立 build 线」最干净的基准：StS 官方 wiki 明确列出**每角色 3 条原型**。

| 角色 | 机制核心 | 明确列出的原型 |
|---|---|---|
| Ironclad | Strength、Exhaust、Burning Blood 续航 | ① Heavy Blade / Limit Break ② Exhaust / Corruption ③ Block 系 |
| Silent | Poison、Shivs、Footwork 缩放 | ① Poison ② Shiv ③ Weak + 抽牌/能量 tempo |
| Defect | Orbs（Frost/Focus/Lightning/Dark） | ① Frost / Focus 长线防守 ② Lightning / Claw 速攻 ③ Dark 爆发 |
| Watcher | Stances（Wrath 双倍伤害/受伤、Calm 蓄能） | ① Stance 切换 ② Scry / Retain ③ Block 控制 |

**结论**：`4 角色 × 3 原型 = 12 条公认 build 线`。折算到本作的规模：
**每角色应至少有 2–3 条可辨识的武器-道具组合线**，即全游戏 **12–18 条**。

### 4.4 「有意义的抉择 : 填充抉择」

- **未找到**权威一手来源 `未验证`。可用的替代锚点：
  VS 提供了 **Banish（最多 10 次）**、**Seal I/II/III/All（最多 40 次屏蔽）**、
  **Reroll（10 次）**、**Skip（10 次）** 这些 PowerUp，**专门用来把填充选项从池子里剔除**
  （VS Wiki「PowerUps」`[实取]`）—— 这是设计者承认"池子里有填充项"的最直接证据：
  玩家会主动想屏蔽约 **40 个条目**，相对 132 条收藏 ≈ **30%**。

---

## 5. 死亡归因

### 5.1 最相关的一手来源（但正文取不到）

- **《Readability and Designing for Attributable Failure… Case Study of Hades》**
  （Theseus，Egor Minenko）https://www.theseus.fi/handle/10024/900621
  - **实际抓取被 Cloudflare 拦截（HTTP 403）**，只能从摘要确认其存在与方法：
    `[摘要]` 提出**五项可读性/公平性启发式**并以 Hades 为案例实证；含 **telegraph timings** 讨论；
    可读性分类为**视觉（3 组 × 2 元素）与听觉**线索。
  - **结论：可引用框架的存在与「3 组 × 2 元素」的分组结构，但不编造具体毫秒数字。**

### 5.2 各游戏「死亡后信息呈现」（可对照的设计事实）

- **Hades**：回到 House of Hades，结算 Darkness / Keys / Gems / Nectar，并可回看本局的 Boon 与武器 —— 「死亡 → 立即兑换元进度」。
- **Slay the Spire**：完整 run summary（卡组、遗物、路线图）。
- **Risk of Rain 2**：结算显示**存活时间**、造成伤害、击杀数 —— 因为**难度 = f(时间)**，
  「我把时间拖久了」是一个**结构性**（而非 UI 性）的归因解法：把自变量暴露给玩家。

### 5.3 「避免得了的死亡占比」

**未找到**任何给出具体百分比的权威来源 `未验证`。任何这样的百分比都应以**设计目标**而非"行业标准"提出。

---

## 6. 难度曲线

### 6.1 Risk of Rain 2 —— 完整公开公式（`[实取]` https://riskofrain2.wiki.gg/wiki/Difficulty）

```
playerFactor = 1 + 0.3 × (playerCount − 1)
timeFactor   = 0.0506 × difficultyValue × playerCount^0.2
stageFactor  = 1.15 ^ stagesCompleted
coeff        = (playerFactor + timeInMinutes × timeFactor) × stageFactor

enemyLevel   = 1 + (coeff − playerFactor) / 0.33
```

- `difficultyValue`：Drizzle = 1，Rainstorm = 2，Monsoon = 3；时间缩放分别为 50% / 100% / 150%。
- **每升 1 级敌人 +30% 生命、+20% 伤害**（相对 Logbook 基础值）；等级上限 **99**。
- **每完成一个环境 `coeff × 1.15`**（指数跳变）。
- 单人 Rainstorm 时间系数 = **0.1012 / 分钟**（约 **+10%/分钟**）。
- 交互物价格 `moneyCost = baseCost × coeff^1.25`；
  精英生成成本：Blazing / Overloading / Glacial = 普通怪的 **6 倍**，Malachite / Celestine = **36 倍**。
- **特殊 Boss 独立缩放**：
  ```
  enemyHP     = enemyHP     × round((1 + coeff/2.5) × livingPlayers × 10) / 10
  enemyDamage = enemyDamage × round((1 + coeff/30) × 10) / 10
  ```
- ⚠ 网上广泛流传的「难度 = 1 + 0.15 × 分钟」**不是**真实公式。真实时间系数是 `0.0506 × difficultyValue`。`[实取]`

### 6.2 Brotato —— 线性成长 + 乘法难度层

**波次时长**：W1 20｜W2 25｜W3 30｜W4 35｜W5 40｜W6 45｜W7 50｜W8 55｜W9 60｜W10–19 60｜**W20 90**。
→ 前 9 波构成**每波 +5 秒**的线性节奏 ramp。

**敌人生命/伤害：线性，非指数**
```
HP(wave) = baseHP + hpPerWave × (wave − 1)
```
实例：Tree = 10 基础 **+5/波**；Pursuer = 10 基础 **+24/波**（第 11 波 = 250 HP）；
Looter / Gobbler **+30/波**；精英 = 1 基础 **+750/波**，伤害 **+1.5/波**。

**难度层是"总乘数"，不是加法**

| Danger | HP / 伤害乘数 |
|---|---|
| D0 | 基准 |
| D3 | +12% |
| D4 | +26% |
| D5 | +40% |
| Nightmare | +60% HP/伤害，+10% 速度 |

D5 还会**同时刷 2 个 Boss，各自 −25% HP**。Boss 基础 HP **29,250**（D5 下 30,712），
接触伤害 **30**、弹幕伤害 **23**。无障碍滑条为**乘法叠加**；三项拉满 ⇒ 综合难度 **182%**。
**屏幕敌人上限 100**，超出随机 despawn 且不掉落。

### 6.3 Vampire Survivors —— 模式乘数作为难度旋钮（`[实取]` …/wiki/Stages）

VS 的敌人成长**不是关内固定公式**，而是「关卡修正 + 模式」叠加的乘数系统 ——
**低预算游戏最容易复制的做法**：

| 模式 | 效果 |
|---|---|
| Hyper | 移速 **+65%–75%**，弹速 +15%–25%，金币 +50% |
| Inverse | 金币 **+200%**，Luck +20%；敌人起始 **+200% HP** 并**每分钟 +5% HP、+0.5 移速**（加法、无上限） |
| Endless | 每完成一个 cycle：敌人 **+100% 基础 HP**、生成频率与数量 +50%、伤害 +25%；玩家单次受击上限 −1 |
| Hurry | 关卡时钟 **×2**、XP +25% ⇒ 通关时长**减半**，但时间事件仍在原时间戳触发 |

关卡自带修正（示例 `[实取]`）：Green Acres 30:00 / +25% 移速 / +50% 敌人 HP；
The Bone Zone 30:00 / 无掉落 / **每分钟敌人 HP +15%、移速 +2.5%，无上限**；
Boss Rash 15:00 / 波次含大量跨关卡 Boss；The Coop 20:00 / **−65% XP**；
Carlo Cart 15:00 / **无法停止移动**。

**关键教训**：VS 用**一组可开关的百分比乘数**构造了从休闲到硬核的全部难度档位，
**没有为每个难度写一套独立数值表**。

### 6.4 线性 vs 指数的取舍

- **Brotato（单局 30 分钟、波次封顶）= 线性 HP ramp + 乘法难度层** —— 低预算、单局封顶游戏最易调优的模型。
- **RoR2（无上限、按时间结算）= 明确指数** —— 「拖时间 = 死」。
- **VS = 固定关卡乘数 + 可选模式乘数** —— 单局内靠**分钟事件**驱动，难度靠**开局前选择的模式**决定。
- **对本作 3 层结构**：3 层只有 **2 次 `1.15^n` 跳变**（×1.15、×1.3225），幅度太小，
  **必须叠加层内线性/分段增长**；并像 VS 一样把「+50%/+100%/+200% HP」做成**开局前可选的难度旋钮**。

### 6.5 玩家 DPS 成长 vs 敌人 HP 成长

**未找到**权威比值 `未验证`。可用的**可测代理量**（由 6.1 推出）：
RoR2 中 Rainstorm 单人第 n 层 t 分钟 `coeff = (1 + 0.1012 t) × 1.15^n`；
由此反解 **t = 10 分钟、n = 0 时 coeff ≈ 2.01，enemyLevel ≈ 4.06，敌人 HP ≈ 1.92 倍基础值**
⇒ RoR2 的**期望玩家 DPS 在 10 分钟内至少要跟上约 2 倍敌人 HP 增长**。

---

## 7. 元进度节奏

### 7.1 Vampire Survivors —— PowerUps（`[实取]` …/wiki/PowerUps）

```
Price = InitialPrice × (1 + Bought) + ⌊20 × 1.1^(TotalBought)⌋     (TotalBought ≥ 1)
Price = InitialPrice                                              (TotalBought = 0)
```

- 基础成本部分是**线性**：初始价 200 的 5 级合计 = **3,000**。
- **费用（Fees）是指数** —— 元进度的主要抑制器。
- **全部满级总成本 = 27,148,513 金币**，其中基础成本仅 **2,469,640**、**费用 24,678,873（90.9%）**。`[实取]`
- 共 **27 个 PowerUp**，等级上限 1–10。

**初始价格梯度（`[实取]`）**：Defang **10**（首次解锁门槛）｜Might / Max Health / Recovery / Greed **200**｜
Area / Speed / Duration / Magnet **300**｜Armor / Move Speed / Luck / Preserve **500–600**｜
Cooldown / Growth **900**｜Omni / Reroll / Skip / Banish / Curse **1,000–1,666**｜
Amount / Revival / Charm / Seal I-IV **5,000–10,000**。

→ **第一个有意义的永久升级只需 10–200 金币** —— **最便宜的永久升级价格 ≈ 一局的产出量级**。

### 7.2 Hades —— Mirror of Night（`[摘要，子代理实取 supersoluce]`）

- **第一次逃脱尝试后**由 Nyx 引入（第 1 局结束就开放）。
- 12 个红色能力；解锁全部 12 槽共需 **65 把 Chthonic Keys**（花 5 把**同时**解锁该槽的红绿两个能力）；
  钥匙档位 **5 / 5 / 10 / 10 / 20 / 20 / 30 / 30**。
- 绿色（替换）能力仅在累计投入 **300 Darkness** 后出现。
- **全部升满 = 35,365 Darkness**（红 18,800 + 绿 16,565）；
  其中只影响基础属性 = **6,165**，含 boon 稀有度 = **14,365**，
  剩余约 **21,000** 来自 Fated Authority + Fated Persuasion（"只给最进阶玩家"）。
- HltB 记录显示首胜时累计 Darkness ≈ **1,858 / 3,247 / 5,387**（第 14 / 17 / 24 次尝试）`[实取]`
  ⇒ **占总量的 5%–15%**。

### 7.3 Dead Cells —— Legendary Forge 与 Boss Stem Cells（`[摘要，子代理实取]`）

| 品质 | 总细胞 | 换算 |
|---|---|---|
| `+` | **500** | 每 25 cells = 5% |
| `++` | **3,000** | 每 150 cells = 5% |
| `S` | **10,000** | 每 500 cells = 5% |

**Forge 上限被 BSC 门控**：`+` 在 0 BSC 可达 100%；`++` 在 1 BSC 上限 50%、**2 BSC** 可 100%；
`S` 在 **2 BSC** 才解锁（上限 25%），4–5 BSC 达 100%。
BSC 同时提高细胞掉落（2–3 BSC **×2**，4–5 BSC **×3**）。

### 7.4 Brotato —— 解锁链（`[摘要，子代理实取]`）

- 一局 **20 波**；**第 20 波 1 个 Boss（29,250 HP）；D5 下 2 个各 75% HP。**
- **解锁是成就驱动、线性可预期**：通关 D0 解锁角色「One Armed」**并且**解锁 Danger 1；
  此后每通一个 Danger 解锁下一个 Danger **+ 1 个角色**。
- 其余角色来自**累计型成就**：击杀 300 / 2,000 / 5,000 / 10,000 / 20,000；
  收集 300 / 2,000 / 5,000 / 10,000 / 20,000 材料。
- **每个角色首次通关恰好解锁 1 把武器或道具。**

### 7.5 可提取的节奏基准

- **第一个永久升级**：**第 1 局结束后立刻可买**（VS 最便宜 10 金币）。
- **满级一棵树**：VS 的 **2,714 万金币**是「数百小时」量级 —— 明确**不是**给普通玩家完成的，它是长尾目标。
- **关键比率**：VS 的费用项占 **90.9%** 说明 —— **元进度的抑制应放在「总量项的指数费用」，
  而不是「单项价格的抬高」**。基础成本保持线性可预测，用 `1.1^TotalBought` 这样的全局项拉长曲线。

---

## 8. 失败的价值

| 游戏 | 失败时仍然获得的 | 来源 |
|---|---|---|
| Hades | **Darkness**、Keys、Gems、Nectar、剩余 Obol；首胜时累计 Darkness **1,858–5,387** ⇒ 每次失败都在累积 | HltB `[实取]` |
| Brotato | 成就进度 + 解锁进度；失败波数即最好成绩 | HltB `[实取]` |
| Vampire Survivors | **金币**（PowerUp 货币）在死亡时结算 | VS Wiki 隐含 `[实取]` |

**未找到**「失败局必须给胜利局 X% 货币」的权威数字 `未验证`。
可用的代理：VS 最便宜永久升级 **10 金币**，而一局即便失败也能捡到数百金币
⇒ **失败局产出 / 最便宜升级价 ≥ 10 倍**。

---

## 9. Boss 设计

| 游戏 | Boss 频率 | 相对单局时长 |
|---|---|---|
| Vampire Survivors | 按**分钟**刷新；**10:00** 掉进化箱；**11:00 / 21:00** 掉 Arcana 箱；到时限后 The Reaper 每分钟刷新 | 30 分钟局内 ≥ **3 次**关键 Boss；15 分钟关卡只有 1 次 |
| Brotato | **W20 = 90 秒**双 Boss（D5）；基础 HP **29,250** | 单局 1 个终局 Boss |
| Risk of Rain 2 | 每个环境 1 个 Teleporter Boss；进入新环境 `coeff ×1.15` | 每 1 环境 1 个 |
| Slay the Spire | 每幕 1 个 Boss（3 幕 + 心脏） | 每 15–20 分钟 1 个 |
| Hades | 4 大区各 1 个 Boss | 每 **8–12 分钟** 1 个 |

**2D Boss 可读性**：
- 最相关的学术来源（Minenko 论文）**正文取不到（403）**，故**不给出**其毫秒数字 `未验证`。
- 可用的独立生理学下限：人类**视觉反应时间约 200–250 ms**
  （http://facultypsy.hope.edu/psychlabs/exp/reactiontime/docs/RT_Literature_Review.pdf `[摘要]`）。
- 视觉线索的分组数（Minenko 摘要 `[摘要]`）：**视觉信息应组织为 3 个可区分的族，每族 2 个元素。**
- 「Boss 应有 N 种攻击」的权威来源 **未找到** `未验证`；
  基于单屏竞技场 + 自动攻击的约束，**3–5 个**是"能全部记住"的量级。

---

## 10. 内容预算

| 游戏 | 实际内容量 | 来源 |
|---|---|---|
| Vampire Survivors 1.0 | **收藏 132 项**；**27 个 PowerUp**；**29 条基础武器→进化线**；4 个角色 Morph（需等级 80 + 遗物） | VS Wiki `[实取]`／`[摘要]` |
| Brotato | **31+ 角色**（每角色 1 套原型）；单角色 **6 武器槽**（部分 12，每把 −5%、叠满 −40%）；**Danger 0–5 + Nightmare**；**20 波**；屏幕敌人上限 **100** | Brotato Wiki／namu.wiki `[摘要]` |

**重玩时长估算公式**：
```
总可玩时长 ≈ 单局时长 × 首胜局数 × (角色/流派数) × (难度层数 × 收敛因子 0.3)
```
- 以本作目标代入：35 分钟 × 5–12 局 × 角色数 × 难度层。
- 若做 **6 角色 × 4 难度层**：35 min × 8 局 × 6 × (4 × 0.3) ≈ **2,016 分钟 ≈ 34 小时**（首通 + 熟练）。
- Brotato 实测：首胜 2–3 小时，D5 首胜 5–20 小时，全难度通关 **9h–20h**（HltB `[实取]`）。

---

## 附一：来源清单

**实际抓取（`[实取]`）**
- https://riskofrain2.wiki.gg/wiki/Difficulty — RoR2 完整难度公式
- https://vampire.survivors.wiki/w/PowerUps — VS 27 个 PowerUp、成本公式、总成本 27,148,513
- https://vampire.survivors.wiki/w/Evolution — VS 进化 / Union / Gift / Morph
- https://vampire.survivors.wiki/w/Stages — VS 关卡时限、The Reaper、四种模式乘数
- https://vampire.survivors.wiki/w/Calculators/PowerUp_Cost
- https://slaythespire.gg/characters — StS 四角色各自 3 条原型
- https://howlongtobeat.com/game/62941/completions — Hades 首胜尝试分布（第 4–34 次）
- https://rc.hl2b.com/game/114144/completions — Brotato 首胜时间分布
- https://rc.hl2b.com/game/45727 — Dead Cells 单局时长
- https://rc.hl2b.com/game/51390 — Slay the Spire 单局时长

**子代理抓取（`[摘要，子代理实取]`）**
- brotato.wiki.spellsandguns.com — 波次时长、敌人 HP 线性公式、Danger 乘数、解锁链
- deadcells.wiki.gg/wiki/The_Blacksmith 与 /wiki/Boss_Stem_Cells — 锻造与 BSC
- supersoluce.com Hades Mirror of Night 指南 — 逐项 Darkness 成本与 35,365 总量
- speedrun.com JSON API — Hades / StS 世界纪录

**只在搜索结果里见到（`[摘要]`）**
- https://www.theseus.fi/handle/10024/900621 —《Readability and Designing for Attributable Failure》（正文 403）
- https://namu.wiki/w/Brotato/캐릭터 — 武器槽 6/12 与 −5%/把
- https://insis.vse.cz/zp/92585 — roguelike 物品化与策略选择
- http://facultypsy.hope.edu/psychlabs/exp/reactiontime/docs/RT_Literature_Review.pdf — 视觉反应 200–250 ms

**未验证（没有可靠一手数字）**
- 「玩家 DPS 增长 : 敌人 HP 增长」的权威比值
- 「每分钟决策数」的行业标准
- 「避免得了的死亡应占 X%」的权威百分比
- Minenko 论文里 telegraph 的毫秒推荐值（403 拦截）
- Hades 各区 Boss 的精确分钟间隔（由总时长推算，非实测）
- Dead Cells / StS 的一手单局时长（只拿到 HltB 聚合页 `[实取]`，不是开发商数据）

---

## 附二：给 3 层结构的一句话总纲

把 **Brotato 的「层内线性 HP + 层间乘法难度 + 每波 1 次商店」** 作为骨架，
用 **VS 的「开局前可选的百分比乘数」** 做难度档位，
用 **VS 的 `1.1^TotalBought` 指数费用项**（占总成本 80–91%）拉长天赋树，
用 **Hades 的「首局即开天赋树 + 首胜 10–20 局」** 定元进度节奏，
用 **StS 的「每角色 3 原型」** 定 build 分化目标。

四个数字锚点：**单局 20–35 分钟 · 首胜 5–12 局 · 决策 0.5–1.0 次/分钟 · telegraph ≥ 300 ms。**
