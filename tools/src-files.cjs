/* =========================================================
   src-files.cjs — **src/ 下的模块清单**（唯一的扫描出口）
   ---------------------------------------------------------
   为什么要有这个文件（而不是三个工具各自 `readdirSync`）：

   `src/` 现在是**完全平铺**的，所以 `fs.readdirSync('src')` 刚好能拿到全部模块。
   三个审计工具（`arch-audit` / `guard-gaps` / `game-kit`）都依赖这个巧合。
   而"目录化分层"是明确的下一步 —— 那时**子目录里的模块会被静默漏掉**：
   审计照样全绿，因为它根本没看见那些文件。
   这类"校验没坏、只是读漏了"的失效，本项目已经栽过多次（见 README 的失败史）。

   所以扫描收成一处，并且**递归**。顺带提供两件事：

     · `relName(file)` —— 把任意深度的路径压成"模块名"（`sim/game.ts` → `game.ts`）。
       分层表（`systems.cjs`）用的是**裸文件名**，两种写法必须能对上。
     · `parity()` —— 扫描结果与分层表互相对账：**每个模块要么在表里、要么在
       UNAFFILIATED 里**；表里有而盘上没有 = 表过期；盘上有而两处都没有 = 漏登记。
       这条对账以前没人做，于是 `types.d.ts` 一直不在任何系统里而没人发现。
   ========================================================= */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

/** 不属于任何"系统"的文件，**逐条写清为什么**（不是随手加白名单） */
const UNAFFILIATED = {
  /* 全局类型声明：只被编译器看见，没有任何 import 指向它。
     它不进分层表是对的 —— 分层表管的是"运行时模块之间的依赖方向"，
     而 `.d.ts` 不产生运行时边。但**必须登记**，否则"盘上有 66 个、
     表里 65 个"这种差额永远不会被发现。 */
  'types.d.ts': '全局 ambient 类型声明（无运行时依赖边，故不进分层表）'
};

/** 递归收集 src 下的 .ts（排除 .d.ts 之外的都算模块；调用方自己决定要不要排 .d.ts） */
function list() {
  const out = [];
  (function walk(dir, prefix) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, prefix + e.name + '/');
      else if (e.name.endsWith('.ts')) out.push(prefix + e.name);
    }
  })(SRC, '');
  return out.sort();
}

/** 任意深度的路径 → 模块名（与分层表同一种写法） */
function relName(rel) { return rel.split('/').pop(); }

/**
 * 与分层表对账。
 * @param systems tools/systems.cjs 的 SYSTEMS
 * @returns { ok, problems, files, declared }
 */
function parity(systems) {
  const files = list();
  const declared = Object.create(null);
  for (const s of systems) for (const m of s.modules) declared[m] = s.id;
  /* ⚠ 比较必须用**裸名**：分层表写的是 `game.ts`，而 `files` 里是 `sim/game.ts`。
     第一版这里写的是 `files.indexOf(m) < 0`（拿裸名去比完整路径）——
     平铺时恰好相等所以看不出问题，一旦目录化**每个模块都会"找不到"**，
     而这条校验会天天报 66 条假阳（然后被人关掉）。 */
  const presentBase = Object.create(null);
  for (const f of files) presentBase[relName(f)] = f;

  const problems = [];
  for (const rel of files) {
    const base = relName(rel);
    if (declared[base]) continue;
    if (UNAFFILIATED[base]) {
      /* 登记过的例外：只有**平铺**时才允许 —— 一旦它被搬进子目录，
         那条"它是全局类型声明"的理由就不再是它不在表里的原因了。 */
      if (rel !== base) problems.push('UNAFFILIATED 里的 ' + base + ' 被搬到了子目录 ' + rel + '（请重新评估它该不该进分层表）');
      continue;
    }
    problems.push('盘上有 src/' + rel + '，但它既不在分层表里、也不在 UNAFFILIATED 里');
  }
  for (const m of Object.keys(declared)) {
    if (!presentBase[m]) problems.push('分层表里有 ' + m + '，但盘上找不到（表过期了？）');
  }
  return { ok: problems.length === 0, problems, files, declared };
}

module.exports = { SRC, ROOT, list, relName, parity, UNAFFILIATED };
