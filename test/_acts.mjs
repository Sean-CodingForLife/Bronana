/* =========================================================
   test/_acts.mjs — "界面有没有接上这个动作"的**唯一问法**

   改造前：各个套件自己在 ui.ts 的源码里找 `case 'talent-take':`。
   那是脆的，也是错的：
     · 源码里出现 `case 'x':` 不代表它真的接上了（可能是永远走不到的死分支）
     · dispatch 一旦换成表（现在就是），那种检查会**直接失明**（正则一个都匹配不到）
   所以正确问法是**问那张表**：动作表在运行时可枚举（ui.ts 的 ACTIONS +
   scene.ts 的 SCREEN_ACTS，统一由 `UI.actNames()` 给出）。

   ui.ts 的模块级不碰 DOM（要 init 才碰），所以这里不需要 DOM 桩 ——
   这也是它能被 6 个原本只加载模拟层的套件共用的原因。
   ========================================================= */
import { loadAll, UI_MODULES } from './_load.mjs';

let cache = null;

/** 全部已注册的按钮动作名（Set） */
export async function uiActs() {
  if (!cache) {
    await loadAll(UI_MODULES);
    cache = new Set(globalThis.UI.actNames());
  }
  return cache;
}

/** 界面接上了这个动作吗（= 那个按钮不是死的） */
export async function uiHasAct(act) { return (await uiActs()).has(act); }

/** 一批动作都接上了吗；返回**没接上的那些**（测试直接打印它） */
export async function uiMissingActs(acts) {
  const have = await uiActs();
  return acts.filter(a => !have.has(a));
}
