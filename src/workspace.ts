/* =========================================================
   workspace.ts — **工作区清单**的引擎侧校验器（纯函数）
   ---------------------------------------------------------
   用户 2026-10-02 的口径：「Bronana 已经在项目里**降级**了，它**只能住在自己的工作区里**，
   由**引擎**去管理工作区」。规范全文 `docs/workspace-spec.md`；
   六家引擎的外部取证（含出处与强度）`docs/external-workspace-conventions.md`。

   本模块只做一件事：**认不认一份清单**。它**不读文件** —— `src/` 不许碰 Node/DOM
   （那是"67 套测试能在 Node 里跑"的前提，见 `AGENTS.md` §四之二）。
   读盘是宿主的事（L8 的 `storage_fs.ts` 那种），读完把对象交给 `Workspace.set()`。

   ## 四条判据（每条都抄自一个真实的坑）

    1. **未知字段 = 报错，不是忽略。** 抄 Cargo 的反面：`[patch]` / `[profile]` 只在根
       清单生效、成员写了**被静默忽略**；`workspace.metadata` 官方原文是
       "ignored by Cargo and **will not be warned about**"。
       静默忽略的形态是「配置写了、不生效、没人告诉你」—— 本仓库最忌的一类。

    2. **缺必填 = 报错。** 抄 pnpm 官方自认的最坏失败：声明了 workspace 而缺那个 yaml 时，
       安装会 "**silently link no project at all**"。清单不全就不许开工。

    3. **`displayName` 与 `id` 是两件东西**（本模块最要紧的一条）。抄 Godot 的反面教材：
       它的 `application/config/name` **同时**决定 user data 目录 ⇒ **改名 = 存档搬家、
       旧档不迁移**，成因只是**复用了一个字段**。
       ⇒ 引擎写死：**路径/命名空间一律从 `id` 派生**，`displayName` 只准出现在给人看的地方。
       所以下面有一条**判据**：`storage.namespace` 必须**等于 `id`**，写成别的值当场报错。

    4. **`schema` 不认识 = 报错。** 清单是从**别的引擎版本**过来的，格式对不上时
       唯一安全的动作是停下来（抄 Godot：`config_version` 更高的项目在项目管理器里**置灰**，
       而不是"尽力打开"）。
   ========================================================= */
import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';

var Workspace = {} as WorkspaceApi;

/** 清单格式版本（**不是引擎版本**）：格式变了才 +1；迁移判据靠它 */
var SCHEMA = 1;

/* =========================================================
   1. 声明表（四步齐全第 1 件：**加字段只改这一张表**）
   ========================================================= */
var FIELDS: Record<string, WorkspaceFieldSpec> = {
  schema: { kind: 'number', required: true, note: '清单格式版本；引擎只认 SCHEMA 这一个值' },
  id: { kind: 'string', required: true, note: '**稳定 id**：存档目录 / 存储命名空间 / 产物名都从它派生（改它 = 迁移）' },
  displayName: { kind: 'string', required: true, note: '**纯显示名**：窗口标题与列表用；改它必须零副作用（不许影响任何路径）' },
  engine: { kind: 'string', required: true, note: '要求的引擎区间（今天只声明、由 `teapot ws doctor` 判；抄 Unreal 的 EngineAssociation，但**要可判**）' },
  entry: { kind: 'string', required: true, note: '从哪进（相对本清单）' },
  storage: { kind: 'object', required: true, note: '{ namespace } —— **必须等于 id**，见判据 3' },
  modules: { kind: 'object', required: false, note: '{ enabled[], disabled[] } —— 原生模块的开/关' },
  plugins: { kind: 'object', required: false, note: '{ enabled[] } —— 插件（与原生**同一套加载器**，E7）' },
  content: { kind: 'object', required: false, note: '{ src } —— 内容源码根' },
  note: { kind: 'string', required: false, note: '给人读的一句话（允许存在**只**为了让人看懂过渡状态）' }
};

/* =========================================================
   2. 校验（纯函数：给对象，回结论 —— 不读盘、不碰 DOM）
   ========================================================= */
Workspace.SCHEMA = SCHEMA;
Workspace.FIELDS = FIELDS;

Workspace.parse = function (raw: unknown) {
  /* 输入是**不受信任的 JSON**：先当 `unknown` 收进来，再显式断言成清单的形状。
     这比 `any` 安全 —— `any` 会让「读了一个根本不存在的字段」静默通过，
     而那正是本模块要抓的东西。（`any` 预算门当场抓过一次，这条注释就是它逼出来的。） */
  var obj = raw as WorkspaceManifest;
  var problems: string[] = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    problems.push('清单不是一个对象（实际是 ' + (Array.isArray(obj) ? 'array' : typeof obj) + '）');
    return { ok: false, problems: problems, value: null };
  }
  /* 判据 1：未知字段报错 —— 逐个点名，并给出"要么删、要么往 FIELDS 加"的处置 */
  for (var k in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
    if (!FIELDS[k]) problems.push('未知字段 `' + k + '` —— 清单**不许有引擎不认识的键**（处置：删掉它，或者往 workspace.ts 的 FIELDS 加一条）');
  }
  /* 判据 2：必填 + 类型 */
  for (var name in FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(FIELDS, name)) continue;
    var spec = FIELDS[name];
    var v = obj[name];
    if (v === undefined || v === null) {
      if (spec.required) problems.push('缺必填字段 `' + name + '`（' + spec.note + '）');
      continue;
    }
    if (typeof v !== spec.kind) {
      problems.push('`' + name + '` 应该是 ' + spec.kind + '，实际是 ' + typeof v);
    }
  }
  /* 判据 3：两条结构约束 —— 它们才是"改名会不会丢档"的开关 */
  if (obj.storage && typeof obj.storage === 'object') {
    if (typeof obj.storage.namespace !== 'string' || !obj.storage.namespace) {
      problems.push('`storage.namespace` 必须是字符串且非空（存储键的前缀由它决定，见 docs/workspace-spec.md §三）');
    } else if (typeof obj.id === 'string' && obj.storage.namespace !== obj.id) {
      problems.push('`storage.namespace`（' + obj.storage.namespace + '）**必须等于 `id`**（' + obj.id + '）—— ' +
        '命名空间是**路径类**的东西，只能从稳定的 id 派生；用 displayName 会让"改名"变成"搬家"（Godot 的坑）');
    }
  }
  for (var arr of ['modules', 'plugins', 'content']) {
    var o = obj[arr];
    if (o === undefined) continue;
    if (!o || typeof o !== 'object' || Array.isArray(o)) { problems.push('`' + arr + '` 应该是一个对象'); continue; }
    for (var k2 in o) {
      if (!Object.prototype.hasOwnProperty.call(o, k2)) continue;
      if (k2 === 'note') continue;
      if (!Array.isArray(o[k2]) && arr !== 'content') problems.push('`' + arr + '.' + k2 + '` 应该是数组');
    }
  }
  /* 判据 4：schema 不认识就停下（不许"尽力打开"） */
  if (obj.schema !== undefined && obj.schema !== SCHEMA) {
    problems.push('`schema` 是 ' + obj.schema + '，本引擎只认 ' + SCHEMA +
      ' —— 格式对不上时唯一安全的动作是**停下来**（别尽力打开）');
  }
  return { ok: problems.length === 0, problems: problems, value: problems.length ? null : obj };
};

/* =========================================================
   3. 当前清单（由宿主注入）+ 三个派生读点
   ========================================================= */
var current: WorkspaceManifest | null = null;

Workspace.set = function (m: WorkspaceManifest) { current = m; };
Workspace.get = function () { return current; };
Workspace.id = function () { return current ? current.id : null; };
Workspace.displayName = function () { return current ? current.displayName : null; };
/** 存储命名空间：**只**从 id 派生（E3 第 2 小步的那个注入点，现在有了唯一出处） */
Workspace.namespace = function () { return current && current.storage ? current.storage.namespace : null; };

/* 启动期自检（四步齐全第 3 件）：**无参、返回 { ok, problems }** */
Workspace.audit = function () {
  var problems: string[] = [];
  if (!current) {
    /* ⚠ **未注入不算错**（批次 1 收尾时想清楚的，实测真踩了一次）：
       这条自检管的是「**宿主注入了什么**」，不是「有没有工作区」。理由有二：
         · 浏览器侧读不到磁盘 —— 若写死「未注入 = 自检失败」，**web 与无头测试会当场起不来**
           （实测：`test/persist.mjs` 的「启动期自检全部通过」当场变红）；
         · 「必须有一个工作区」这件事的真相**在磁盘上**，所以它归**门 `workspace`** 守
           （门看盘，自检看注入）。
       把判据放在够不着真相的那一层，是本项目记过多次的同一类错。 */
  } else {
    var r = Workspace.parse(current);
    if (!r.ok) problems = problems.concat(r.problems);
  }
  return { ok: problems.length === 0, problems: problems };
};

Registry.family('workspace', {
  note: '工作区清单的字段集（**加字段只改这一张表**；未知字段会被判红）', owner: 'workspace.ts',
  values: function () { return Object.keys(FIELDS); }
});
SelfCheck.register('workspace', Workspace.audit);

export { Workspace };
