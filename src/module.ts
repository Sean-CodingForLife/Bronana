/* =========================================================
   module.ts — **引擎的功能单元**（模块）：声明 · 顺序 · 开关判据
   ---------------------------------------------------------
   用户 2026-10-01~02 的口径写在 `docs/workspace-spec.md`（D-004）：
   引擎自己就是**一堆模块**，插件与原生模块**走同一套加载器**，而
   **每个工作区各自声明**开哪些、关哪些（`teapot.workspace.json` 的
   `modules.enabled / disabled`）。

   ## 本模块**做到哪一步**（不许含糊）

   今天落地的是**声明与判据**，不是"动态装载器"：

     ✅ `MODULES`：引擎原生 9 个模块 + 各自的**依赖**（`requires` 向下、`alsoNeeds` 例外）
     ✅ `order()`：依赖**拓扑序**（不是 import 顺序）—— 环会被 `audit()` 指出在哪
     ✅ `check(manifest)`：这份清单的开关**成不成立**
        （未知 id · enabled 与 disabled 撞车 · **被禁用的模块不得被任何启用的模块依赖**）
     ❌ 按清单**只 import 被启用的那些模块** —— 那要等引擎侧真的按模块切目录（`src/modules/<id>/`）
        与一个动态装载器。⚠ **今天不要假装它有**：清单开关的效果是"**判据**"，
        宿主仍然是静态 import 全部（`cli.ts` 的 `registry: 'partial'` 那种手写例外就是它的替代品）。

   ## 为什么"模块"这份表要引擎自己声明（而不是从 `tools/systems.cjs` 读）

   `systems.cjs` 是**审计视角**（9 个系统 / 层号 / 例外清单），它住在 `tools/`；
   而 `src/` 里的模块**不许** import `tools/`（那是宿主侧的东西）。
   两张表于是必须**对账**——判据在 `test/arch.mjs` 第 [7] 节，四条：
     ① id 集合两边完全相同（两个方向）
     ② 每个 `requires` 都指向**严格更低层**的模块（声明不许自己造出向上的边）
     ③ `真实 import 图 \ requires` **恰好等于** `alsoNeeds`，且那些边在 `EXCEPTIONS` 里逐条登记过
     ④ `check()` 对"禁用 X"报出的受影响模块 == 真实图上 X 的依赖者

   ⚠ **"模块" ≠ "模块代币"。** `economy.ts` 的 `module` 角色、`hall.ts` 的
   `module: 'combat'` 说的是**玩法模块**（内容侧那一类：战斗 / 经营 / 养成）；
   这里说的是**引擎的功能单元**。两者是同一个词的两层含义，规范写在
   `workspace-spec.md` §一 —— 内容模块将来由**工作区自己的清单**声明。
   ========================================================= */
import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';
import { Workspace } from './workspace.ts';

var Module = {} as ModuleApi;

/* =========================================================
   1. 声明表（四步齐全第 1 件）
   ---------------------------------------------------------
   顺序写在这里只是为了**读起来**是自底向上的；真正的顺序由 `order()` 算。
   `requires` = "我起来时它们必须也启用"（向下的依赖）；
   `alsoNeeds` = "**向上**的依赖，但缺了我就起不来" —— 每一条都在
   `tools/systems.cjs` 的 `EXCEPTIONS` 里写明了理由（清单**只该变短**）。
   ========================================================= */
var MODULES: ModuleDef[] = [
  {
    id: 'mech', requires: [],
    note: '工具与机制：总账 / 自检 / 数学 / 容器 / 绘制原语 / 空间网格（不认识任何玩法概念）'
  },
  {
    id: 'data', requires: ['mech'],
    alsoNeeds: ['meta'],
    note: '数据表：曲线 / 词条 / 武器 / 道具 / 角色 / 怪物 + 四本账本' +
      '（⚠ `alsoNeeds: meta` 就是 `enemies.ts → danger.ts` 那条**向上**的例外：' +
      '怪物表要一份"恒等修正"当缺省，而修正键的唯一出处住在 meta 层）'
  },
  {
    id: 'dungeon', requires: ['mech', 'data'],
    note: '地牢与内容：地图与叙事都是纯函数（同种子必得同图），能脱离对局单测'
  },
  {
    id: 'meta', requires: ['mech', 'data', 'dungeon'],
    note: '局外成长：营地 / 据点 / 天赋 / 难度 / 档案 / 每日（修正**在开局时折成普通对象**）'
  },
  {
    id: 'sim', requires: ['mech', 'data', 'dungeon', 'meta'],
    alsoNeeds: ['art'],
    note: '模拟内核：每帧都在跑的那一层（纯逻辑、无 DOM、无 canvas）'
  },
  {
    id: 'art', requires: ['mech', 'data'],
    note: '造型与声音：角色骨架 / 贴图缓存 / 程序化音效（都不认识玩法状态）'
  },
  {
    id: 'run', requires: ['mech', 'data', 'meta', 'sim'],
    note: '一局的进出：序列化与结算（它**必须**读模拟层，所以坐在模拟层之上）'
  },
  {
    id: 'view', requires: ['mech', 'data', 'dungeon', 'meta', 'sim', 'art', 'run'],
    note: '表现与界面：渲染 / 界面 / 输入 / 诊断（**只读**模拟层）'
  },
  {
    id: 'boot', requires: ['mech', 'data', 'dungeon', 'meta', 'sim', 'art', 'run', 'view'],
    note: '入口：web / 命令行 / 调试舞台（唯有它们可以"什么都知道"）'
  }
];

/* =========================================================
   2. BY_ID（四步齐全第 2 件）
   ========================================================= */
var BY_ID: Record<string, ModuleDef> = {};
for (var mi = 0; mi < MODULES.length; mi++) BY_ID[MODULES[mi].id] = MODULES[mi];

/** 一个模块**直接**要的全部模块（向下的 `requires` + 向上但缺不了 `alsoNeeds`） */
function needsOf(id: string): string[] {
  var m = BY_ID[id];
  if (!m) return [];
  return (m.requires || []).concat(m.alsoNeeds || []);
}

/** 只看向下的 `requires`（= 层关系；**排序只认它**，见 `order()` 的注释） */
function requiresOf(id: string): string[] {
  var m = BY_ID[id];
  return m && m.requires ? m.requires : [];
}

Module.LIST = MODULES;
Module.BY_ID = BY_ID;
Module.ids = function () {
  var out: string[] = [];
  for (var i = 0; i < MODULES.length; i++) out.push(MODULES[i].id);
  return out;
};

/* =========================================================
   3. 顺序：**依赖拓扑排序**（不是 import 顺序）
   ---------------------------------------------------------
   为什么必须是"算出来的顺序"：`workspace-spec.md` §五 口径 1 写着
   「模块注册顺序由**依赖拓扑排序**决定」—— 而 import 顺序是**偶然的**
   （改一行 import 就会变），拿它当注册顺序等于把启动行为交给排版。
   ⚠ 同层之间按 **id 字典序** 出队：于是顺序是**确定**的（不依赖遍历顺序）——
   与门 `repro` 那条纪律同源（"同一份代码跑两遍必须一模一样"）。

   🔴 **`alsoNeeds` 不参与排序 —— 这是必须的，不是省事。**
   实测：真实 import 图在系统级**有环**（`data → meta` 那条例外 vs `meta → data` 的常态），
   所以 `tools/systems.cjs` 用的模型是「**层号 + 例外清单**」，不是纯 DAG。
   把例外也算进排序，拓扑序永远排不满 —— 那不是"发现了一个环"，那是**把两种关系混成一种**：
     · `requires`  = **层关系**（向下，天然无环）⇒ 决定**顺序**
     · `alsoNeeds` = **例外的真实依赖**（可能向上）⇒ 只决定"**能不能禁用**"
   判据在 `test/arch.mjs` 第 [7] 节：真实边 \ `requires` 必须**恰好**是 `alsoNeeds`，
   且那些边逐条登记在 `EXCEPTIONS` 里。
   ========================================================= */
Module.order = function () {
  var pending: Record<string, number> = {};          // 还没被满足的依赖数
  var dependents: Record<string, string[]> = {};     // 谁在等我
  var i, j;
  for (i = 0; i < MODULES.length; i++) {
    pending[MODULES[i].id] = 0;
    dependents[MODULES[i].id] = [];
  }
  for (i = 0; i < MODULES.length; i++) {
    var id = MODULES[i].id;
    var needs = requiresOf(id);
    for (j = 0; j < needs.length; j++) {
      if (!BY_ID[needs[j]]) continue;                // 幽灵依赖由 audit 报，不在这里炸
      pending[id]++;
      dependents[needs[j]].push(id);
    }
  }
  var ready: string[] = [];
  for (i = 0; i < MODULES.length; i++) if (!pending[MODULES[i].id]) ready.push(MODULES[i].id);
  ready.sort();
  var out: string[] = [];
  while (ready.length) {
    var cur = ready.shift() as string;
    out.push(cur);
    var next = dependents[cur].slice().sort();
    for (j = 0; j < next.length; j++) {
      if (--pending[next[j]] === 0) {
        /* 插进去之后仍然保持字典序（否则顺序会依赖"谁先被解锁"） */
        var at = 0;
        while (at < ready.length && ready[at] < next[j]) at++;
        ready.splice(at, 0, next[j]);
      }
    }
  }
  return out;                                        // 有环时长度 < MODULES.length（audit 会报）
};

/* =========================================================
   4. 清单判据：**纯函数**（给一份清单、回问题清单 —— 不读盘、不认识 Node）
   ---------------------------------------------------------
   语义（说死，免得两种读法）：
     · `enabled` 为空 = **全部启用**（缺省即"都要"）；
       非空 = 只启用列出的这些（其余视为关闭）；
     · `disabled` 与 `enabled` **不许撞车**（那是两个真相）；
     · 缺了必填的依赖 ⇒ **报错**（抄 pnpm 自认的最坏失败："silently link no project at all"）。
   ========================================================= */
Module.check = function (manifest: WorkspaceManifest) {
  var problems: string[] = [];
  var mods = (manifest && manifest.modules) as { enabled?: unknown; disabled?: unknown } | undefined;
  if (!mods) return problems;                        // 没声明 = 全默认（`Workspace.parse` 管形状）

  var known = BY_ID;
  function asIds(key: string, raw: unknown): string[] {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) { problems.push('`modules.' + key + '` 应该是数组'); return []; }
    var out: string[] = [];
    for (var i = 0; i < raw.length; i++) {
      var v = String(raw[i]);
      if (out.indexOf(v) >= 0) { problems.push('`modules.' + key + '` 里 `' + v + '` 写了两次'); continue; }
      if (!known[v]) {
        problems.push('`modules.' + key + '` 里的 `' + v + '` **不在引擎的模块表里**' +
          '（可用：' + Module.ids().join(' / ') + '）—— 写错了名字不许静默忽略');
      }
      out.push(v);
    }
    return out;
  }
  var enabled = asIds('enabled', mods.enabled);
  var disabled = asIds('disabled', mods.disabled);

  for (var d = 0; d < disabled.length; d++) {
    if (enabled.indexOf(disabled[d]) >= 0) {
      problems.push('`' + disabled[d] + '` 同时出现在 `enabled` 与 `disabled` 里' +
        '（两个真相 —— 引擎不许猜哪个算数）');
    }
  }

  /* **核心判据**（用户点名的句子）：被禁用的模块不得被任何启用的模块依赖。
     缺省（enabled 为空）= 全启用，于是"只写一个 disabled"就是有效声明。 */
  var on: Record<string, boolean> = {};
  var i;
  if (enabled.length) for (i = 0; i < enabled.length; i++) on[enabled[i]] = true;
  else for (i = 0; i < MODULES.length; i++) on[MODULES[i].id] = true;
  for (i = 0; i < disabled.length; i++) delete on[disabled[i]];

  for (i = 0; i < MODULES.length; i++) {
    var id = MODULES[i].id;
    if (!on[id]) continue;
    var need = needsOf(id);
    for (var j = 0; j < need.length; j++) {
      if (!BY_ID[need[j]]) continue;                 // 幽灵依赖：audit 报
      if (!on[need[j]]) {
        problems.push('`' + id + '` 是启用的，但它要的 `' + need[j] + '` 被禁用了' +
          ' —— **被禁用的模块不得被任何启用的模块依赖**' +
          (BY_ID[id].alsoNeeds && (BY_ID[id].alsoNeeds as string[]).indexOf(need[j]) >= 0
            ? '（这条是**向上**的例外依赖，理由登记在 `tools/systems.cjs` 的 `EXCEPTIONS` 里）' : ''));
      }
    }
  }
  return problems;
};

/* =========================================================
   5. 启动期自检（四步齐全第 3 件）：**表自身** + **当前清单**
   ========================================================= */
Module.audit = function () {
  var problems: string[] = [];
  var i, j;
  var seen: Record<string, boolean> = {};
  for (i = 0; i < MODULES.length; i++) {
    var m = MODULES[i];
    if (!m || !m.id) { problems.push('第 ' + (i + 1) + ' 个模块没有 id'); continue; }
    if (seen[m.id]) problems.push('模块 id 重复：' + m.id);
    seen[m.id] = true;
    if (!m.note || m.note.length < 8) problems.push(m.id + '：说明太短（一句话说清它是干什么的）');
    var all = needsOf(m.id);
    for (j = 0; j < all.length; j++) {
      if (all[j] === m.id) problems.push(m.id + ' 依赖它自己');
      else if (!BY_ID[all[j]]) problems.push(m.id + ' 依赖一个不存在的模块：' + all[j] + '（拼错了？）');
    }
  }
  /* 环：拓扑序排不满就是有环，把环上的模块点名（只说"有环"等于没给线索） */
  var ordered = Module.order();
  if (ordered.length !== MODULES.length) {
    var left: string[] = [];
    for (i = 0; i < MODULES.length; i++) if (ordered.indexOf(MODULES[i].id) < 0) left.push(MODULES[i].id);
    problems.push('模块依赖成环，环上（或指向环）的模块：' + left.join(' / ') +
      ' —— 拓扑序排不出全部 ' + MODULES.length + ' 个');
  }
  /* 当前清单（宿主注入的）：**未注入不算错** —— 与 `Workspace.audit` 同一条纪律
     （管的是"宿主注入了什么"，不是"有没有工作区"；有没有归门 `workspace` 看盘）。 */
  var ws = Workspace.get();
  if (ws) problems = problems.concat(Module.check(ws));
  return { ok: problems.length === 0, problems: problems };
};

/* =========================================================
   6. 注册进总账（四步齐全第 4 件）
   ---------------------------------------------------------
   `requires` / `alsoNeeds` 的每一个值都**指向本家族自己** ——
   于是"依赖写了个不存在的模块名"由 `Registry.audit()` 免费抓住（机制本来就是干这个的）。
   ========================================================= */
Registry.family('module', {
  note: '引擎的功能单元（模块）：9 个原生模块 + 各自的依赖（`requires` 向下 · `alsoNeeds` 例外）',
  owner: 'module.ts',
  entries: function () {
    var out: RegistryEntry[] = [];
    for (var i = 0; i < MODULES.length; i++) {
      var m = MODULES[i];
      var refs: Array<{ field: string; value: unknown; family: string }> = [];
      var k;
      for (k = 0; k < (m.requires || []).length; k++) {
        refs.push({ field: 'requires', value: m.requires[k], family: 'module' });
      }
      for (k = 0; k < (m.alsoNeeds || []).length; k++) {
        refs.push({ field: 'alsoNeeds', value: (m.alsoNeeds as string[])[k], family: 'module' });
      }
      out.push({ id: m.id, refs: refs });
    }
    return out;
  }
});
SelfCheck.register('module', Module.audit);

export { Module };
