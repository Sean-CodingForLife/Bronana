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

/** 默认的存档目录：`$BRONANA_HOME`，否则 `~/.bronana` */
export function defaultSaveDir(): string {
  const home = process.env.BRONANA_HOME ||
    path.join(process.env.HOME || process.env.USERPROFILE || '.', '.bronana');
  return home;
}
