# 行业判据自检清单（skill 体检）

> 这份文档把**引擎无关**的游戏开发判据逐条对着本项目检查，输出"达标 / 部分达标 / 未达标"。
>
> ## 为什么用 skill 当判据
>
> 这份仓库有自己的尺子（`pnpm verify` 的 13 道门），但它们量的是**内部一致性**
> （表 ↔ 运行时、家族有没有守卫、死代码…）。它们回答不了"**行业上这件事该怎么做**"。
> skill 里的清单正好补这一半：它们是**外部判据**，而且刻意写成引擎无关。
>
> ## ⚠ 适用面：本项目不用任何游戏引擎
>
> 本机 skill 目录里 **50 多个是引擎专用**的，**一条都不适用**：
>
> | 不适用的类别 | 例子 | 为什么 |
> | --- | --- | --- |
> | Godot | `godot-*`（14 个） | 本项目没有 `.tscn` / GDScript / `Node` 树 |
> | Unity | `unity-*`（8 个） | 没有 `MonoBehaviour` / `.asset` / `Animator` |
> | Unreal | `unreal-*`（6 个） | 没有 Blueprint / `.uasset` / Niagara |
> | Roblox | `roblox-*`（6 个） | 不是 Roblox 平台 |
> | 其它引擎 | `phaser-*` / `pixijs-*` / `threejs-*` / `bevy-*` / `love2d-*` / `pygame-*` | 不是这些框架 |
> | 具体引擎的输入/音频/瓦片 | `unity-input-system` / `godot-audio` / `godot-tilemap` … | 同上的引擎 API 绑定 |
>
> **适用的是"引擎无关"的那 9 个**（下表）。它们的判据是**做法**（分层、总线、
> 屏幕栈、池化、种子化），不是 API —— 所以对本项目的纯 Canvas 实现照样成立。
>
> 另外两个 `unity-scriptableobjects` / `godot-resources` 的**数据驱动思想**与本项目
> 的"声明表 + 注册表 + 自检"高度同源，但项目已有自己更严的一套，故不单列。

---

## 一、适用面一览

| # | skill | 为什么适用 | 本项目对应物 |
| --- | --- | --- | --- |
| ① | `game-ui-ux` | 有 HUD / 14 屏菜单 / 手柄 / 多分辨率 | `index.html` + `styles.css` + `ui.ts` + `scene.ts` |
| ② | `input-systems` | 有键鼠 / 手柄 / 触摸三种输入 | `input.ts` + `main.ts` 的键组分支 |
| ③ | `audio-design` | 有 13 音效 + 5 首 BGM + 设置 | `audio.ts` + `music.ts` |
| ④ | `save-systems` | 有 3 槽位 / 备份 / 导入导出 / 跨局档案 | `save.ts` + `profile.ts` + `storage.ts` + `slots.ts` |
| ⑤ | `game-feel` | 有命中/击杀/爆炸/受击的对反馈 | `game.ts` + `render.ts`（shake/flash/飘字） |
| ⑥ | `procedural-gen` | 地图与掉落全靠种子生成 | `dungeon.ts` + `game.ts` 的 `S.rnd` |
| ⑦ | `performance-optimization` | 有 300 怪压力场景与帧预算 | `test/perf.mjs` + `emit.ts` 的对象池 |
| ⑧ | `roguelike` | **体裁判据**（按 roguelite 取适用面） | 整体 |
| ⑨ | `game-ai` | 敌人决策 | `ai.ts` |

---

## 二、逐条自检

> 状态标记：**✅ 达标** · **🟡 部分达标** · **❌ 未达标** · **➖ 不适用**

### ① `game-ui-ux`（HUD / 菜单 / 焦点 / 屏幕栈）

| 判据 | 状态 | 证据 | 差距 |
| --- | --- | --- | --- |
| 布局用锚点+容器，不用绝对像素 | ✅ | `styles.css` 的 `position` 15 处全是 `fixed`（覆盖层），无 `left:Npx` 硬定位 | — |
| 有断点适配 | ✅ | `@media (max-height:700px)` / `(max-width:900px)` / `(max-width:600px)` / `(pointer:coarse)` | — |
| 有参考分辨率 + 缩放策略 | 🟡 | `--ui-zoom`（`fontScale` 驱动）+ `.layer{zoom}` | 只在设置里改，没有"随窗口自动缩放"这一层 |
| 安全区（刘海/过扫） | ❌ | 全仓无 `env(safe-area-inset-*)` | 桌面游戏可接受；要上移动端必须补 |
| 每屏有默认焦点 | （待审计确认） | `_focusEl` / `UI.activateFocus` | — |
| 屏幕流是栈而非布尔标志 | 🟡 | **不是栈**：`Game.TRANSITIONS` + 三份"来处记录"（`_pauseFrom`/`_hubFrom`/`_returnFrom`） | 这是有意的（状态机可审计），但"从 A→B→C 返回哪"要靠人推 |
| HUD 事件驱动而非每帧轮询 | （待审计确认） | `Game.events` + `UI.refresh` | — |
| 字号可调 | ✅ | `fontScale` 设置项 + `--ui-zoom` | canvas 侧字号是否跟随需确认 |
| 文案外置（i18n 就绪） | ✅ | `i18n.ts`（键=中文原文）+ `data-i18n`；`pnpm run ui-text --check` 守"表中孤儿" | — |
| 色盲模式 | 🟡 | `PAL.setMode` 只换 **4 个键**（HP/HEAL/XP/MAT） | 覆盖面小；且图片素材不参与调色（见 README 的讨论） |
| "减少屏幕抖动"选项 | ❌ | `settings.ts` 无此项 | `game-feel` 清单明确要求 |
| 跨分辨率验证 | 🟡 | `tools/ui-shot.mjs` **支持** `--sizes=`，但默认只 `1280x720` | 缺超宽屏/窄屏的固定用例 |

### ② `input-systems`

| 判据 | 状态 | 证据 | 差距 |
| --- | --- | --- | --- |
| 动作映射（不读原始键） | （待审计确认） | `Scene.keyGroup` + 键组表 | — |
| 边沿 vs 持续分清 | （待审计确认） | — | — |
| 摇杆**径向**死区 | （待审计确认） | `input.ts` 手柄轮询 | — |
| 输入缓冲 / 宽容窗口 | （待审计确认） | — | — |
| 键位重绑定 + 持久化 | （待审计确认） | — | — |
| 设备切换时提示跟着换 | （待审计确认） | — | — |
| 可访问性（不强制同时按/灵敏度） | （待审计确认） | — | — |

### ③ `audio-design`

| 判据 | 状态 | 证据 | 差距 |
| --- | --- | --- | --- |
| 总线分组 `Master ← {Music, SFX}` | ❌ | 只有一条 `Sfx.master`（`audio.ts:18`）；音乐刻意复用它（`music.ts:227-229`） | 无法分别调音乐/音效；没有 UI 组 |
| 音量用感知曲线（非纯线性） | ❌ | `main.ts:71` `gain.value = Sfx.volume` —— 滑杆值**直接当线性增益** | 线性指针在感知上不是线性的（低端几乎没变化） |
| 留白 / 限幅防削波 | ❌ | 无 limiter / 压缩器；多个音效同时响会直接相加 | — |
| 闪避（ducking） | ❌ | 无 | 无语音，优先级较低 |
| 自适应音乐 | 🟡 | 5 首曲目 × 3 声部 × 16 格 + 3 档强度（`Music.intensityFor`） | **强度只改增益与八度**，`music.ts:244` 的"琶音加密"是**不可达分支** |
| 音效变化（随机音高/音色池） | ❌ | 13 个音效全是固定配方 | 连打同一个音效听感完全一样 |
| 换曲有淡入淡出 | ❌ | `Music.play` 先 `stop()` 再立刻排下一拍（硬切） | — |
| 一次性播放器正确释放 | ✅ | `osc.start(t0); osc.stop(t0 + dur + 0.04)` | — |
| 自动播放被拦的兜底与提示 | ❌ | 只有 pointerdown/keydown 两个 once 监听 | **纯手柄玩家永远解锁不到音频**，且界面无提示 |
| 音频设置项齐全 | ✅ | `sound` / `music` / `volume` 三项，三个 applySetting 分支都在 | — |
| 自检 / 家族登记 | 🟡 | `music.ts` 三样齐全；**`audio.ts` 三样全无** | — |

### ④ `save-systems`

| 判据 | 状态 | 证据 | 差距 |
| --- | --- | --- | --- |
| 存纯数据而非运行时对象 | ✅ | `exportRun` / `Profile.snapshot` 都是纯数据 | — |
| 有版本号字段 | ✅ | `Envelope.create({name, version:1})`（`profile.ts:37`） | — |
| **版本迁移链** | ❌ | `env.migration` 存在但**从未注册过任何迁移** | 至今靠"新字段缺省即默认"兼容；`Envelope.open` 对缺级会返回 null |
| 原子写 | 🟡 | `localStorage` 无改名语义；靠**双写 `.bak`** + 读坏回退 | Windows 上 rename 不保证原子，`.bak` 是实际保命的那一层 |
| 读档防御（逐字段夹取） | ✅ | `Profile.load` 逐字段夹取 + `onlyKnown` 白名单；`perChar` 用无原型对象防 `__proto__` | — |
| 坏档告知玩家 | ✅ | `Slots.lastRecovery()` → 界面提示"档坏过、已回退" | — |
| 槽位与自动存档分离 | ✅ | 3 槽位（`Storage.slotKey`）+ `Save.saveRun/clearRun` | — |
| 导入导出有校验和 | ✅ | `BRNA1.<base64>.<fnv1a>` | — |
| **"用旧版本的档启动"有测试** | ❌ | 没有这类测试 | 迁移链为空 = 这条永远没被验过 |

### ⑤ `game-feel`

| 判据 | 状态 | 证据 | 差距 |
| --- | --- | --- | --- |
| 离散事件钩子齐全 | ✅ | `Game.events` 的 `waveClear` / `craft` / `secretFound` 等 + `Emit.*` | — |
| 反馈分层（5–8 层/命中） | （待审计确认） | 音效+粒子+shake+闪白+飘字 | — |
| 屏幕震动用衰减 trauma 而非每帧随机 | （待审计确认） | `render.ts` 的 `addTrauma` / `updateShake` | — |
| **命中定帧（hit-stop）** | （待审计确认） | — | — |
| 挤压拉伸会回到静止 | （待审计确认） | `drawEnemy` 的 `squash` | — |
| 反馈按重要度分级 | （待审计确认） | — | — |
| 可访问性：减少抖动/闪烁 | ❌ | 无此设置项 | 与 ① 同一条缺口 |

### ⑥ `procedural-gen`

| 判据 | 状态 | 证据 | 差距 |
| --- | --- | --- | --- |
| 一个种子化 RNG 贯穿 | ✅ | `S.rnd` 单一来源；`Game.fingerprint` 三局可复现就是证明 | — |
| 不用全局随机 | 🟡 | `audio.ts:65` 有 `Math.random()`（噪声波形，**不进模拟**） | 模拟层内需确认无全局随机 |
| 生成与渲染解耦（先数据后绘制） | ✅ | `Dungeon` 是纯函数（同种子同图），`render.ts` 单独画 | — |
| 连通性校验 | （待确认） | `Dungeon` 的房间图 | — |
| 固定种子可复现（调试/每日挑战） | ✅ | `Seed` + 每日挑战 + `pnpm run fingerprint` | — |

### ⑦ `performance-optimization`

| 判据 | 状态 | 证据 | 差距 |
| --- | --- | --- | --- |
| 先测再优化（有预算数字） | ✅ | `test/perf.mjs`：三档场景（真实波次 / 300 怪 / 弹幕），报截尾均值/P95/预算占比 | — |
| 有明确的帧预算 | ✅ | 16.6ms（60fps）；实测压力场景占 **5.4%** | — |
| 对象池（弹丸/粒子/飘字） | ✅ | `emit.ts` 的 `particles` / `freeParticles` + `Emit.audit`（查重复引用） | — |
| 减少绘制调用（图集/批处理） | ✅ | 角色姿态图集 + 武器图集 + 两层静态烘焙（`R.ground`/`R.props`） | — |
| 每帧零分配 | 🟡 | `Rig.instance` 用定长 `Float64Array`；但 `draw-census` 统计 391 处 `D.*` 调用 | 无 GC 压力测量 |
| 有工具量"花在谁身上" | ✅ | `tools/draw-census.mjs`（按调用来源与 phase 归类） | — |
| 预算进 CI | ✅ | `pnpm test` 含 `perf.mjs`；CI 门 2 跑它 | — |

### ⑧ `roguelike`（**按 roguelite 取适用面**）

| 判据 | 状态 | 证据 | 差距 |
| --- | --- | --- | --- |
| **随机环境生成** | ✅ | `dungeon.ts` 按种子长图，三层 | — |
| **永久死亡** | 🟡 | 死了进结算；但有"继续这一局"的存档（`Save.saveRun`） | roguelite 常见，但**要意识到它可以 save-scum** |
| **回合制 / 网格制** | ➖ | 本作是**实时动作** roguelite | 刻意不适用 |
| **复杂度（道具/怪物交互）** | ✅ | 24 武器 × 29 道具 × 词条 × 元素反应 × 联动 | — |
| **资源管理** | ✅ | 5 笔货币 + 局内废料经济 | — |
| **探索与发现** | ✅ | 房间制地图 + 图鉴 + 剧情碎片 | — |
| 可分享种子 | ✅ | 种子可输入 | — |
| **元进度不覆盖存档** | ✅ | `Profile`（跨局）与一局存档分离 | — |
| run 经济（材料/废料分工） | 🟡 | 上一轮刚重塑 | 见 `CHANGELOG` 的"结余"：经济流被战力流支配 |

### ⑨ `game-ai`

| 判据 | 状态 | 证据 | 差距 |
| --- | --- | --- | --- |
| 有决策层（FSM/BT） | （待确认） | `ai.ts` 的行为表 | — |
| 不每帧全场景重算 | （待确认） | — | — |

---

## 三、结论：最值得做的（按 影响 ÷ 代价）

### 批次 A —— **纯增量、不改行为**（行为指纹可保持不变）

1. **音量加感知曲线**（`audio.ts` + `main.ts`）：线性滑杆 → 感知映射（幂曲线或 dB）。
   代价极小（一个函数），只影响音量观感，**不影响模拟**。
2. **音效加随机变化**：同一音效每次响有轻微音高/音量偏移。
   `audio.ts` 里合成参数加极小随机扰动 —— **不进模拟层**，不改指纹。
3. **"减少屏幕抖动/闪烁"设置项**：`settings.ts` 加一项 + `render.ts` 读它。
   这是两份 skill 清单（game-ui-ux 与 game-feel）**都明确要求**的可访问性项。
4. **`audio.ts` 补齐四件套**：现在音乐有 `Music.audit` + `Registry.family`，音效一样都没有。
5. **超宽屏/窄屏进入界面截图用例**：`ui-shot` 已支持 `--sizes`，只是清单里没列。

### 批次 B —— **会改行为**（要更新指纹基线 + 写 `CHANGELOG`）

6. **音频总线分组**：`Master ← {Music, SFX}` + 独立音乐音量。会改 `settings` 结构。
7. **换曲淡入淡出**：`Music.play` 的硬切改成短交叉淡入。改听感，不改模拟。
8. **命中定帧（hit-stop）**：**会改模拟时序** → 一定改指纹，需要单独论证。
9. **存档迁移链**：注册第一条真正的迁移（`env.migration`），并加"用旧档启动"的测试。
10. **`music.ts:244` 那个不可达分支**：要么实现它（改编排），要么删掉它（改注释与 README）。

---

*本文件由自检产出；带"待审计确认"的行会在下一轮补上，其余每行都有 `文件:行号` 证据。*
