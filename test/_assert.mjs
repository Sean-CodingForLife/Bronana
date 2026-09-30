/* =========================================================
   _assert.mjs — 共享断言库（测试用）
   ---------------------------------------------------------
   要解决的问题（用户提的"试错成本很大"）：
     ① **55 套各自复制了一份 `ok()`** —— 56 份副本，改一处要改 56 遍
     ② 失败只打一行 `FAIL <标签> → <附加>`，两个值都要**作者手拼**
     ③ **一条断言抛异常就炸掉整套** —— 它后面的几十条**一条都不跑**，
        于是只能一条一条解锁

   用法：
     import { T } from './_assert.mjs';
     T.section('3. 买与拆');
     T.ok(cond, '标签');
     T.eq(actual, expected, '标签');          // 失败时**两个值都打出来**
     T.try('会抛的那条', () => { ... });       // 抛了记成 FAIL，**继续跑**
     process.exit(T.done());

   ⚠ `T.try` 是这一层的重点：它把"一条抛异常"从"整套中断"
   变成"这一条失败、其余的照跑"。
   ========================================================= */
import { inspect } from 'node:util';

const fmt = (v) => {
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean' || v === null || v === undefined) return String(v);
  try { return inspect(v, { depth: 2, breakLength: 100, compact: true }); } catch { return String(v); }
};

let pass = 0;
let fail = 0;
let sectionName = '';
const failures = [];       // { section, label, detail }

const sections = [];

/** 开一节：打印 `[n] 名字`，并把后续失败归到这一节下 */
function section(name) {
  sectionName = name;
  sections.push(name);
  console.log('\n[' + sections.length + '] ' + name);
}

function record(okFlag, label, detail) {
  if (okFlag) { pass++; console.log('  \x1b[32mPASS\x1b[0m ' + label); return true; }
  fail++;
  console.log('  \x1b[31mFAIL\x1b[0m ' + label + (detail ? '  → ' + detail : ''));
  failures.push({ section: sectionName, label, detail: detail || '' });
  return false;
}

/** 普通断言。`extra` 仍然接受（保持与旧 `ok()` 的调用方式兼容） */
function ok(cond, label, extra) {
  return record(!!cond, label, extra === undefined ? '' : fmt(extra));
}

/** **两个值都打出来** —— 不再让作者手拼 `extra` */
function eq(actual, expected, label) {
  const good = Object.is(actual, expected) ||
    (typeof actual === 'object' && typeof expected === 'object' &&
      JSON.stringify(actual) === JSON.stringify(expected));
  return record(good, label, good ? '' : '得到 ' + fmt(actual) + ' · 期望 ' + fmt(expected));
}

/**
 * 包住**可能抛异常**的断言。
 * 抛了记成 FAIL 并**继续**（这是本库存在的首要理由）。
 */
function attempt(label, fn) {
  try { const r = fn(); return r; }
  catch (e) {
    record(false, label, '抛异常：' + (e && e.message ? e.message : String(e)));
    return undefined;
  }
}

/** 汇总并把退出码交给调用方（`process.exit(T.done())`） */
function done() {
  console.log(failures.length
    ? '\n  \x1b[31m' + fail + ' 项失败 ✘\x1b[0m（通过 ' + pass + '）'
    : '\n  全部通过 ✔（' + pass + ' 条断言）');
  if (failures.length) {
    console.log('\n  失败清单：');
    for (const f of failures) console.log('    · ' + (f.section ? '[' + f.section + '] ' : '') + f.label + (f.detail ? ' — ' + f.detail : ''));
  }
  return fail ? 1 : 0;
}

export const T = { section, ok, eq, try: attempt, done, get failures() { return failures.slice(); }, get passed() { return pass; } };
export { section, ok, eq, attempt as tryAssert, done };
