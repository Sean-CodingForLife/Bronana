/* =========================================================
   score.mjs — 给这一版打分（**可复现**：规则在代码里，不看人心情）
   ---------------------------------------------------------
   "你自己给游戏打分"如果没有规则，那就是一句自夸。
   所以这份工具做三件事：

     1. 八条轴，每条给出**实测值**
     2. 每条轴有**阈值**（取自公开设计基准，见 `docs/external-benchmarks.md`）与
        **分值**；总分 = 加权和，权重写在 `AXES[].w` 里
     3. 每条轴附**"差在哪"**：没到 4/5 的轴必须写出一句可执行的改进方向，
        否则那一条的报告就是空的

   ⚠ 两条纪律（这是这份工具唯一值得存在的地方）：
     · **拿不到数据的轴报 `—` 而不是给分**。缺数据时给分 = 编一个好看的数。
     · 分数**不评价"好不好玩"** —— 好玩只能靠人。这里量的是
       "这一版有没有达到同类作品的公开水位"。
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { loadAll, SIM_MODULES } from '../test/_load.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const MATRIX = argv.filter(a => /\.json$/.test(a));

await loadAll(SIM_MODULES);
const g = globalThis;
const { Curves, Chars, Weapons, Items, Profile, Challenges } = g;

const PAD = (s, n) => { s = String(s); return s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 127 ? 2 : 1), 0))); };
const PADL = (s, n) => ' '.repeat(Math.max(0, n - String(s).length)) + String(s);
const med = (a) => { const x = a.slice().sort((p, q) => p - q); return x.length ? x[Math.floor(x.length / 2)] : 0; };
const mean = (a) => a.length ? a.reduce((p, q) => p + q, 0) / a.length : 0;

/* ---------------- 读矩阵数据（可选：没给就只能算"不需要跑局"的轴） ---------------- */
const runs = [];
for (const f of MATRIX) {
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const r of (j.runs || [])) runs.push(r);
  } catch (e) { console.log('  读不了 ' + f + '：' + e.message); }
}

/* =========================================================
   八条轴。每条：
     id / name / unit
     bench（公开基准，人话）
     score(value) → 0~5
     fix（没满分时"差在哪"）
     need   = 'runs' 表示需要矩阵数据
   ========================================================= */
const AXES = [
  {
    id: 'length', name: '单局长度', unit: '分钟（中位）', w: 1.0, need: 'runs',
    bench: '同类 20~30 分钟（Hades 21 分 · Brotato 25–30 分 · VS 30 分）',
    get() {
      const s = runs.map(r => r.secs).filter(x => x > 0);
      return s.length ? med(s) / 60 : null;
    },
    score(v) {
      if (v === null) return null;
      if (v >= 18 && v <= 35) return 5;
      if (v >= 12 && v <= 45) return 4;
      if (v >= 8 && v <= 60) return 3;
      if (v >= 5) return 2;
      return 1;
    },
    fix: 'bot 的局总是以死亡收尾，人类会拖到硬上限 —— 这一条要判定得看人类胜利局时长；' +
      '若按 bot 数据调长，应该抬的是"每波时长/层数"而不是怪的血量（后者会拖慢节奏而不拉长时间感）'
  },
  {
    id: 'decision', name: '决策密度', unit: '次/分钟（中位）', w: 1.2, need: 'runs',
    bench: '同类 0.3~2.0（Brotato 0.8 · StS 1.0 · VS 1.5–2.0 · Hades 0.3–0.5）',
    get() {
      const v = runs.filter(r => r.secs > 30).map(r => (r.buildChoices || 0) / (r.secs / 60));
      return v.length ? med(v) : null;
    },
    score(v) {
      if (v === null) return null;
      if (v >= 1.5) return 5;
      if (v >= 0.8) return 4;
      if (v >= 0.4) return 3;
      if (v > 0) return 2;
      return 1;
    },
    fix: '密度低往往不是"商店太少"，而是"能做的决定太少"（钱不够 / 货都一样）——' +
      '先查"进商店时买得起的比例"，再看货架的差异度'
  },
  {
    id: 'diversity', name: '构筑分化', unit: '同角色内不重复终局构筑比例', w: 1.0, need: 'runs',
    bench: '目标 ≥ 80%（StS 每角色 3 条原型 ⇒ 同一角色也不该总是同一套）',
    get() {
      /* ⚠ **必须按角色分组算**，不能拿全部局算一遍全局不重复率 ——
         第一版就是这么写的：576 局里同一个角色有 64 局，"全局不重复率"于是
         被角色数一除就掉到 0.13，看着像"构筑完全不分"，
         而真相是"不同角色当然用不同装备"。**校验把角色差异当成了构筑差异。**
         正确的问法是：**同一个角色内部**，每局的终局装备有没有不一样。 */
      const by = {};
      for (const r of runs) {
        const k = r.char || r.key || '?';
        (by[k] = by[k] || []).push((r.weapons || []).slice().sort().join(',') + '|' +
          (r.items || []).slice().sort().join(','));
      }
      const keys = Object.keys(by).filter(k => by[k].length >= 4);
      if (!keys.length) return null;
      /* 取各角色"不重复比例"的中位数：单个角色样本少时那个比例不稳 */
      const ratios = keys.map(k => new Set(by[k]).size / by[k].length);
      return med(ratios);
    },
    score(v) {
      if (v === null) return null;
      if (v >= 0.95) return 5;
      if (v >= 0.8) return 4;
      if (v >= 0.6) return 3;
      if (v >= 0.4) return 2;
      return 1;
    },
    fix: '同角色内不重复率低 = **那个角色的可选项没起效**（它总被推向同一套）。' +
      '先看它的开局装备与专属机制是否把路径锁死了，再看商店里"它用得上的货"占比'
  },
  {
    id: 'charbalance', name: '角色平衡', unit: '最强 / 最弱（波次中位）', w: 1.5, need: 'runs',
    bench: '目标 ≤ 1.6×（超过 2× 说明有一个角色被落下了）',
    get() {
      const by = {};
      for (const r of runs) if (r.dim === 'char') (by[r.key] = by[r.key] || []).push(r.waves);
      const ms = Object.keys(by).filter(k => by[k].length >= 4).map(k => med(by[k]));
      if (ms.length < 3) return null;
      return Math.max(...ms) / Math.max(1, Math.min(...ms));
    },
    score(v) {
      if (v === null) return null;
      if (v <= 1.35) return 5;
      if (v <= 1.6) return 4;
      if (v <= 2.0) return 3;
      if (v <= 3.0) return 2;
      return 1;
    },
    fix: '倍差大的时候先分两种：**开局身位太薄**（第 2~3 波就死）与**成长曲线掉队**' +
      '（能活但打不动）。前者调初始属性/开局装备，后者调它的成长轴 —— 两者改的地方完全不同'
  },
  {
    id: 'difficulty', name: '难度阶梯', unit: 'D0→D9 波次差', w: 1.2, need: 'runs',
    bench: '目标：难度抬上去，**通关率**单调下降（波次不必单调 —— 每级改的东西不同）',
    get() {
      const by = {};
      for (const r of runs) if (r.dim === 'danger') (by[r.key] = by[r.key] || []).push(r);
      const ks = Object.keys(by).map(Number).sort((a, b) => a - b);
      if (ks.length < 5) return null;
      const win = ks.map(k => by[k].filter(r => r.won).length / by[k].length);
      /* 违约 = 后面某一级的通关率比前面高 0.15 以上（明显倒挂） */
      let viol = 0;
      for (let i = 1; i < win.length; i++) if (win[i] > win[i - 1] + 0.15) viol++;
      return { lo: win[0], hi: win[win.length - 1], viol: viol, levels: ks.length };
    },
    score(v) {
      if (v === null) return null;
      /* 两头都要有落差：低难度该容易、高难度该难 */
      if (v.lo - v.hi >= 0.25 && v.viol === 0) return 5;
      if (v.lo - v.hi >= 0.15 && v.viol <= 1) return 4;
      if (v.lo - v.hi > 0 || v.viol <= 2) return 3;
      return 1;
    },
    fix: '倒挂通常来自"某一级改的是完全不同的东西"（本作 D1/D2 抬血、D4 抬精英率、' +
      'D6 收紧时限、D8 提前对手、D9 双 Boss）—— 那是设计意图，不该硬掰成一条直线；' +
      '真正要看的是**最难的几级有没有真的更难**'
  },
  {
    id: 'reach', name: '内容触达', unit: '武器+道具被买走比例', w: 1.0, need: 'none',
    bench: '目标 ≥ 60%（摸不到的内容等于不存在）',
    get() {
      /* 这一条**不需要跑局**：`pnpm run matrix` 的 `[8]` 已经证明过"全部上过货架"，
         而"被买走"要看商店出口统计 —— 这里用一件静态事实代替：
         武器与道具都进得了货架（`Items.rollShop` / `Weapons.rollShop` 覆盖全表） */
      return null;   // 交给 --with-runs 时的矩阵数据
    },
    score() { return null; },
    fix: '需要 `pnpm run matrix` 的商店出口那一节'
  },
  {
    id: 'failure', name: '失败价值', unit: '零核心局比例', w: 1.2, need: 'runs',
    bench: 'VS：失败局产出 / 最便宜升级价 ≥ 10 倍。本作看"一局能带出多少 + 有多少局一无所获"',
    get() {
      const c = runs.map(r => r.coreEarned || 0);
      const sp = runs.map(r => r.materials || 0);
      if (!c.length) return null;
      return {
        zeroCore: c.filter(x => x <= 0).length / c.length,
        medCore: med(c),
        medMats: med(sp)
      };
    },
    score(v) {
      if (v === null) return null;
      if (v.zeroCore <= 0.15 && v.medCore >= 2) return 5;
      if (v.zeroCore <= 0.3) return 4;
      if (v.zeroCore <= 0.5) return 3;
      return 2;
    },
    fix: '"零核心局"比例高说明**打不到 Boss** —— 而核心材料是局外两条线唯一的门槛。' +
      '要么让第 1 层 Boss 更够得着（早一点的层），要么给"没打到 Boss 的局"一条替代的小额核心来源'
  },
  {
    id: 'integrity', name: '体系完整性', unit: '校验通过率', w: 1.5, need: 'none',
    bench: '这一项是"工程质量"：它不直接对应玩家体验，但**决定上面七条可不可信**',
    get() {
      /* 静态可查的那几样：自检登记、家族数、曲线数、挑战数、引导文案覆盖 */
      const names = g.SelfCheck.names();
      const fams = g.Registry.names();
      return {
        selfchecks: names.length,
        families: fams.length,
        curves: Curves.LIST.length,
        weapons: Weapons.LIST.length,
        items: Items.LIST.length,
        challenges: Challenges.LIST.length,
        chars: Chars.LIST.length,
        hints: g.Tutorial ? g.Tutorial.LIST.length : 0,
        locales: g.I18n ? g.I18n.LOCALES.length : 0
      };
    },
    score(v) {
      if (v === null) return null;
      let s = 0;
      if (v.selfchecks >= 20) s++;
      if (v.families >= 40) s++;
      if (v.curves >= 12) s++;
      if (v.chars >= 6 && v.weapons >= 20 && v.items >= 25) s++;
      if (v.locales >= 2 && v.hints >= 5) s++;
      return Math.max(1, s);
    },
    fix: '自检/家族数少 = 有模块没进总账（改了没人知道）；曲线少 = 数值散在各处'
  }
];

/* ---------------- 跑 ---------------- */
const rows = AXES.map(a => {
  let v = null, err = '';
  try { v = a.get(); } catch (e) { err = e.message; }
  const sc = err ? null : a.score(v);
  return { axis: a, value: v, score: sc, err: err };
});

console.log('\n=== Teapot · 打分（规则可复现：阈值取自公开基准）===\n');
console.log('  数据源：' + (MATRIX.length ? MATRIX.length + ' 个矩阵分片 · ' + runs.length + ' 局'
  : '**没有矩阵数据** —— 需要跑局的那几条轴会报 `—`（缺数据不给分）') + '\n');

let sum = 0, wsum = 0;
for (const r of rows) {
  const a = r.axis;
  const shown = r.value === null ? '—'
    : (typeof r.value === 'object' ? JSON.stringify(r.value) : (typeof r.value === 'number' ? r.value.toFixed(2) : String(r.value)));
  const sc = r.score === null ? '—' : r.score + '/5';
  console.log('  ' + PAD(a.name, 12) + PADL(shown, 30) + '  ' + PADL(sc, 6) + '  ×' + a.w + '  ' + a.unit);
  console.log('     基准：' + a.bench);
  if (r.err) console.log('     \x1b[31m取数失败：' + r.err + '\x1b[0m');
  else if (r.score !== null && r.score < 4) console.log('     \x1b[33m差在哪：' + a.fix + '\x1b[0m');
  if (r.score !== null) { sum += r.score * a.w; wsum += 5 * a.w; }
  console.log('');
}

const pct = wsum ? (sum / wsum) * 100 : 0;
const outOf10 = wsum ? (sum / wsum) * 10 : 0;
const evaluable = rows.filter(r => r.score !== null).length;
console.log('=== 结果 ===');
console.log('  加权总分：' + outOf10.toFixed(1) + ' / 10' +
  '（' + sum.toFixed(1) + ' / ' + wsum.toFixed(1) + ' 加权点）');
/* ⚠ **可评条数必须显眼**：只有 1 条可评时那个 "10.0/10" 毫无意义 ——
   它是"体系完整性"一条撑出来的。缺数据的轴报 `—` 是对的，
   但**只报总分不报可评比例**就成了另一种撒谎（用一个好看的数盖住"没量"）。 */
console.log('  可评：' + evaluable + ' / ' + rows.length + ' 条' +
  (evaluable < rows.length
    ? '  \x1b[33m← 缺数据的那些轴没给分（报 `—` 而不是编一个中位数）\x1b[0m'
    : '  \x1b[32m（全部有数据）\x1b[0m'));
if (evaluable < rows.length) {
  console.log('  没量到的：' + rows.filter(r => r.score === null).map(r => r.axis.name).join(' · '));
  console.log('  补数据：`pnpm run matrix` 跑完再把这些分片传进来：');
  console.log('      node tools/score.mjs .s1.json .s2.json … .d1.json …');
}
console.log('');
console.log('  ⚠ 这个分数**不评价"好不好玩"** —— 好玩只能靠人。');
console.log('     它量的是"这一版有没有达到同类作品的公开水位"，以及**哪几条轴还差**。');
console.log('     规则在 `tools/score.mjs` 里：阈值、权重、以及"没满分时差在哪"都写在代码里，');
console.log('     所以它可以被反驳（改阈值/权重再跑一次），而不是一句"我觉得挺好"。');
console.log('');
