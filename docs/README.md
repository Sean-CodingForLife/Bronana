---
title: "文档索引"
category: 门面
scope: "仓库全部文档**按读者分类**的索引 + 三条硬约定"
source: "盘上的 `*.md`（漏登记的文档由评审与这里对账）"
links: ["../README.md", "../AGENTS.md", "requirements.md"]
---
# 文档索引

本仓库的文档按**读者**分类。想找什么，先看这张表。

| 文档 | 类 | 写什么 | 什么时候更新 |
| --- | --- | --- | --- |
| [`../README.md`](../README.md) | 门面 | 玩法 · 操作 · **引擎与架构参考** · 性能 · 已知取舍。**只讲现在是什么样、为什么是这样** | 系统变动时 |
| [`../CHANGELOG.md`](../CHANGELOG.md) | 变更史 | 玩家可感知的变化（短，面向玩家） | 每次发版 |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | 协作 | 家法（声明 · 注册 · 自检 · 测试）· 行为指纹 · 分层纪律 · 怎么加测试 | 规则变时 |
| [`../SECURITY.md`](../SECURITY.md) | 安全 | 威胁模型与漏洞报告 | 罕见 |
| [`../CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md) | 协作 | 行为准则（含 AI 生成内容约定） | 罕见 |
| [`requirements.md`](requirements.md) | **需求账本** | 用户提的每一条需求 + 现状 + 证据；讨论在这里留痕。**未结条目看 §6.0 的四象限**（着手 / 决策 / 维护 / 不做） | 每次讨论 |
| [`external-benchmarks.md`](external-benchmarks.md) | 外部参考 | 同类游戏的公开设计数字（带来源强度标注） | 做设计决策前 |
| [`external-game-mechanics.md`](external-game-mechanics.md) | **外部参考·机制** | **20 款游戏的玩法机制档案**（核心循环 / 操作 / 分段 / 成长 / 失败代价 / 张力 / 取舍 / 独有机制 / 褒贬）+ 按三条轴的横向综合 + 来源强度分级 | **做设计决策前必读** |
| [`scaling-benchmarks.md`](scaling-benchmarks.md) | **外部参考·数值** | **七款游戏的难度与成长曲线对照**（Brotato / Hades / Dead Cells / 以撒 / 地牢 / RoR2 / VS / StS）+ Bronana 站在哪 | 调数值前必读 |
| [`scaling-isaac-gungeon.md`](scaling-isaac-gungeon.md) | 外部参考·明细 | 以撒的结合 / 挺进地牢的逐项数字（查不到即写「未取得」） | 同上 |
| [`scaling-ror2-vs-sts.md`](scaling-ror2-vs-sts.md) | 外部参考·明细 | 雨中冒险 2 / 吸血鬼幸存者 / 杀戮尖塔的逐项数字 | 同上 |
| [`skill-audit.md`](skill-audit.md) | 自检 | 按行业判据逐条体检本作，附"影响 ÷ 代价"排序 | 罕见 |
| [`techstack-upgrade-research.md`](techstack-upgrade-research.md) | 调研 | 技术栈升级的**联网取证**（Canvas2D 的边界 / WebGL2 的成本 / WebGPU 支持 / 渲染抽象层 / 引擎与内容分离 / 像素游戏现状）。每条带来源链接与强度。⚠ **顶部有作废横幅：结论不要再用，取证仍然有效** | 罕见（结论已由下面的决定文档取代） |
| [`techstack-upgrade-decision.md`](techstack-upgrade-decision.md) | **决定** | **拍板：渲染后端升级到 WebGL2（WebGPU 为目标态）**——用户的理由 / 原判据为什么不适用 / 四条硬约束（R1~R4）/ 接口形状（Target 一等对象）/ 文本与 3px 描边的真风险 / 预算 / 七阶段施工 | 施工时对照 |
| [`history/`](history/README.md) | 交付记录 | 逐轮改了什么、踩了什么坑、量出了什么 | 每轮追加 |
| [`../.github/`](../.github) | 协作 | PR 模板 · issue 模板 · CI | 罕见 |

## 三条约定

1. **`README.md` 只写"现在是什么样"**。逐轮过程写进 [`history/`](history/README.md)，
   新的一轮追加到 `history/` 的末尾或新开一卷 —— **不要再往 README 里追加交付记录**。
2. **需求走 [`requirements.md`](requirements.md)**。提需求 → 复述 → 讨论 → 动手 → 验证，
   五步走完才算完；状态与证据都记在那份文件里。
3. **设计决策写进 [`../CONTRIBUTING.md`](../CONTRIBUTING.md)** 描述的家法，
   而不是散在各处 —— 每个概念要"四步齐全（声明 · 注册 · 自检 · 测试）"。
