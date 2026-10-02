/* =========================================================
   storage_fs.ts — **文件后端**（Node：CLI 与桌面外壳）
   ---------------------------------------------------------
   为什么需要它：`storage.ts` 的适配层已经有三个后端可用 ——
     浏览器 / 桌面外壳 → `window.localStorage`（Chromium 会把 localStorage
                          落在 `userData` 里，所以这两者本来就持久）
     CLI / 无头测试   → **内存**（进程结束就没了）
   于是 **CLI 是三种形态里唯一没有持久化的**：`pnpm cli` 跑完，
   设置与账号档案全丢。这个文件补的就是那一格。

   ## 为什么不能放进 `storage.ts`

   `storage.ts` 在**最底层**（工具与机制），而浏览器与模拟层都 import 它。
   这个文件要用 `node:fs` —— 一旦被 web 包引用，`vite build` 就会失败。
   所以它**单独一个模块**，只由 Node 侧入口（`cli.ts`）import；
   `vite.config.ts` 从 `index.html` → `src/main.ts` 打包，那条链上不碰它。

   ## 原子写：比 localStorage 那套更严

   `storage.ts` 的 `setJSONSafe` 是"写主键 + 写备份"**两次写**。
   在 localStorage 上够用（单键写本身是原子的），**在文件上不够**：
   写到一半断电会留下半截文件。

   所以这里按更严的做法：
     ① 写临时文件 `key.tmp`
     ② **`fsync`**（把字节真正刷到盘上，不只是交给操作系统缓存）
     ③ `rename` 覆盖目标（同卷上是原子的）
     ④ 覆盖之前把旧的留一份 `key.bak`

   `rename` 在 POSIX 同卷上原子，**Windows 上不保证** —— 所以第 ④ 步
   的备份才是真正兜底的东西（与 `storage.ts` 头部引用的那条注意事项一致）。
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';

/** 键名里的 `/` 之类不能直接当文件名 —— 换成一个固定字符 */
function safeName(key: string): string {
  return String(key).replace(/[^\w.-]/g, '_') + '.json';
}

export interface FileAdapterOptions {
  /** 存档目录（不存在会自动建） */
  dir: string;
  /** 出错时的回调（写不进去**不该让游戏崩** —— 与 storage.ts 同一条纪律） */
  onError?: (msg: string) => void;
}

/**
 * 造一个文件适配器。形状与 `localStorage` 一致（`getItem` / `setItem` / `removeItem`），
 * 所以 `Storage.use(...)` 直接收。
 *
 * ⚠ 它是**同步**的（`fs.writeFileSync` 一族）：`StorageAdapter` 的契约是同步的，
 * 而存档都是几 KB 的小文件 —— 异步化要动上层所有调用点，收益是零。
 */
export function fileAdapter(opts: FileAdapterOptions): StorageAdapter {
  const dir = opts.dir;
  const err = (m: string) => { if (opts.onError) opts.onError(m); };

  try { fs.mkdirSync(dir, { recursive: true }); }
  catch (e) { err('存档目录建不出来：' + (e as Error).message); }

  const p = (key: string) => path.join(dir, safeName(key));

  return {
    name: 'file:' + dir,

    getItem(key: string): string | null {
      try { return fs.readFileSync(p(key), 'utf8'); }
      catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') err('读 ' + key + ' 失败：' + (e as Error).message);
        return null;
      }
    },

    setItem(key: string, value: string): boolean {
      const target = p(key);
      const tmp = target + '.tmp';
      try {
        /* ① 写临时文件，并在关之前 `fsync` —— 少了它，断电可能留下空文件 */
        const fd = fs.openSync(tmp, 'w');
        try {
          fs.writeFileSync(fd, value, 'utf8');
          fs.fsyncSync(fd);
        } finally { fs.closeSync(fd); }

        /* ② 覆盖之前留一份旧的（Windows 上 rename 不保证原子，这份才是兜底） */
        try { fs.copyFileSync(target, target + '.bak'); } catch { /* 首次写入没有旧文件 */ }

        /* ③ rename 覆盖（POSIX 同卷上原子） */
        fs.renameSync(tmp, target);
        return true;
      } catch (e) {
        err('写 ' + key + ' 失败：' + (e as Error).message);
        try { fs.unlinkSync(tmp); } catch { /* 清不掉就算了 */ }
        return false;
      }
    },

    removeItem(key: string): boolean {
      try {
        fs.unlinkSync(p(key));
        try { fs.unlinkSync(p(key) + '.bak'); } catch { /* 没有备份就跳过 */ }
        return true;
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') return true;      // 本来就不在 = 已经达到目的
        err('删 ' + key + ' 失败：' + (e as Error).message);
        return false;
      }
    }
  };
}

/* =========================================================
   **工作区清单的发现与读盘**（E4 第 0 批：宿主只从清单读身份）
   ---------------------------------------------------------
   用户口径：「所有和 Bronana 有关系的**统统**移动到 Bronana 自己的工作区里去，
   二者要**彻底分离和无感知**」。**无感知**的第一步不是搬目录，而是：
   **宿主不再知道"自己跑的是哪个工作区"** —— 它只发现清单、读它、认它。

   为什么读盘落在这里而不是 `workspace.ts`：`workspace.ts` 在 L0，
   **连 `process` 都不许出现**（那是"67 套测试能在 Node 里跑"的前提）；
   而"发现目录"这件事**只有宿主干得了**。分工是：
     · 引擎侧 `Workspace.parse` —— 认不认这份清单（纯函数，不读盘）
     · 宿主侧 本文件         —— 找清单 / 读字节 / 交给引擎认
   ========================================================= */

/** 引擎仓库根（本文件在 `src/` 下 ⇒ 上一级）；⚠ 只用于**默认**发现，可被参数覆盖 */
export function repoRoot(): string {
  return path.resolve(import.meta.dirname, '..');
}

/** 盘上的工作区清单（`workspace/<目录>/teapot.workspace.json`，按路径字典序 —— 顺序确定） */
export function workspaceFiles(root?: string): string[] {
  const base = path.join(root || repoRoot(), 'workspace');
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(base, e.name, 'teapot.workspace.json'))
    .filter((p) => fs.existsSync(p))
    .sort();
}

/** 读一份清单的原始字节并解析（**解析失败就抛** —— "读不到"绝不静默，见 `workspace-spec.md` §五） */
export function readManifest(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** 默认的存档目录：`$TEAPOT_HOME`（**旧名 `$BRONANA_HOME` 仍然读** —— 改名兼容），
 *  否则 `~/.<工作区 id>`
 *  ⚠ **目录名从 `id` 派生**（用户口径 / `workspace-spec.md` §三）：路径类的东西只能从
 *    **稳定 id** 派生 —— Godot 那个"改名 = 存档搬家"的坑就是这么来的。
 *    ⚠ 传不进 `id`（没有清单）时退到**中性**目录名 `.teapot` ——
 *    **不许**在这里写死任何具体工作区的名字（那是"引擎认识内容"）。 */
export function defaultSaveDir(id?: string): string {
  const home = process.env.TEAPOT_HOME || process.env.BRONANA_HOME;
  if (home) return home;
  return path.join(process.env.HOME || process.env.USERPROFILE || '.', id ? '.' + id : '.teapot');
}
