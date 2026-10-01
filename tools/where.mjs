/* =========================================================
   where.mjs — **环境事实卡**：我在哪台机器上、这台机器设了什么
   ---------------------------------------------------------
   为什么要有它（用户 2026-10-02 的要求）：

     用户的原话：「我这个项目**不一定是固定机器上开发的**，所以**本机到底指的是哪台机器**，
     要说清楚」。

   所以本仓库的文档**不写"本机"这种没有主语的断言**，而是写「跑 `pnpm run where` 看事实卡」——
   因为一条环境事实（代理端口 / 存档目录 / tsc 路径）**只在那台机器上成立**，
   把它写进版本库就是"文档说了一道不存在的修复"。

   ## 三层（`AGENTS.md` §二 有同一条表）
     · **仓库层**（进版本库）= `.env.example`（键的声明）· `AGENTS.md`（机制陷阱）· 本工具
     · **机器层**（不进版本库）= `.env`（值）· `~/.gitconfig`（git 自己的那份，如代理）
     · **会话层**（不进版本库）= `tools/.session.json`（并行会话快照，见 `tools/env.mjs`）

   ## 它回答三个问题（每个都曾经真的坑过人）
     1. **我在哪台机器上** —— hostname / 用户 / OS / 仓库绝对路径 / 分支 / worktree
     2. **这台机器的值是什么、来自哪** —— `.env` 里写的 vs shell 里已有的
        （🔴 `--env-file` **不覆盖** shell；两个不一样时**要说出来**，不许静默）
     3. **git 能不能推** —— github.com 的代理配了没有（这是本仓库真实踩过的坑：
        git 不读 Windows 的 WinINET 代理，于是直连 github.com 会 reset / 超时 / 403）
   ========================================================= */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const git = (args) => { try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch (e) { return ''; } };

/** 极简 .env 解析（只认 `KEY=VALUE`；与 Node 的 --env-file 同一形状，不做花活） */
function dotenvKeys() {
  const p = path.join(ROOT, '.env');
  if (!fs.existsSync(p)) return null;
  const map = new Map();
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m) map.set(m[1], m[2].trim().replace(/^["']|["']$/g, ''));
  }
  return map;
}

/** `.env.example` 声明的键（`KEY=` 与 `# KEY=` 都认） */
function declared() {
  const p = path.join(ROOT, '.env.example');
  if (!fs.existsSync(p)) return [];
  const out = [];
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = /^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/.exec(line);
    if (m) out.push(m[1]);
  }
  return [...new Set(out)];
}

const mask = (v) => (v === undefined ? '（未设）' : v === '' ? '（空串）' : v);

console.log('\n=== Teapot · 环境事实卡 ===\n');

console.log('【1】这是哪台机器');
console.log('  机器      ' + os.hostname() + ' / ' + os.userInfo().username);
console.log('  系统      ' + os.platform() + ' ' + os.release() + '（' + os.arch() + '）· Node ' + process.version);
console.log('  仓库      ' + ROOT);
console.log('  分支      ' + (git(['rev-parse', '--abbrev-ref', 'HEAD']) || '(不是 git 仓库)') +
  '   ·   worktree ' + (git(['rev-parse', '--show-toplevel']) || '-'));
console.log('  未提交    ' + (git(['status', '--porcelain']).split('\n').filter(Boolean).length) + ' 处');

console.log('\n【2】环境变量：值是什么、从哪来');
const decl = declared();
const dot = dotenvKeys();
if (!decl.length) console.log('  ⚠ 读不到 .env.example —— 那些键的**唯一出处**，先把它修回来');
let shadowed = 0;
for (const k of decl) {
  const inDot = dot ? dot.get(k) : undefined;
  const inEnv = process.env[k];
  let from = '';
  if (inEnv !== undefined && inDot !== undefined) {
    if (inEnv === inDot) from = 'shell / .env（值相同，分不出）';
    else { from = '🔴 **shell 盖住了 .env**（' + k + '：shell=' + mask(inEnv) + '，.env=' + mask(inDot) + '）'; shadowed++; }
  } else if (inEnv !== undefined) from = 'shell';
  else if (inDot !== undefined) from = '.env（**本次进程没加载它** —— 要用 --env-file-if-exists=.env）';
  else { console.log('  ' + k.padEnd(24) + mask(undefined)); continue; }
  console.log('  ' + k.padEnd(24) + mask(inEnv !== undefined ? inEnv : inDot) + '   ← ' + from);
}
if (!dot) console.log('  （没有 .env —— 这是正常状态：值是机器层的，可选）');
if (shadowed) console.log('  ⚠ 有 ' + shadowed + ' 个键被 shell 盖住：**node --env-file 不覆盖已有变量**（实测）');

console.log('\n【3】git 能不能推（本仓库真实踩过的坑）');
const proxy = git(['config', '--get', 'http.https://github.com.proxy']);
const origin = git(['config', '--show-origin', '--get', 'http.https://github.com.proxy']);
console.log('  github.com 代理   ' + (proxy || '（未配）'));
if (origin) console.log('  配在哪            ' + origin.replace(/^file:/, ''));
console.log('  ⚠ git（libcurl）**不读 Windows 的 WinINET 代理**：若系统代理开着而这里没配，' +
  '\n                     git 会直连 github.com → reset / 21 秒超时 / 403。');
console.log('                     一行修：git config --global http.https://github.com.proxy http://127.0.0.1:<你的端口>');
console.log('  ⚠ 这条是**机器层**的事实：换机器/换 Windows 账号就**不存在**，要重新配。\n');
