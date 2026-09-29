/* =========================================================
   art-manifest.mjs — **这台游戏需要哪些图**（一份可生成的清单）
   ---------------------------------------------------------
   ## 为什么需要它

   项目有美术**规范**（`art_spec.ts`：命名前缀 / 尺寸上限 / 锚点 / 图集 / 混合模式）
   和**归属**（`Art.noteOwner`：哪一类由哪个模块产出），但**没有一张清单**
   回答那个最实际的问题："我要准备哪些图？"

   之前唯一一处真实声明是 `TILES_*` 那一条。于是"要接图片素材"这件事
   只能靠通读 `sprites.ts` 的 switch 分支去猜 —— 那不是一份能交给美术的清单。

   这个工具从**代码里已有的数据表**枚举出来（不另抄一份）：
     · 武器 22 种（`Weapons.LIST` + 各自的 `tints`）
     · 道具图标 21 种（`Items.LIST` 的 icon + tint）
     · 怪物 15 种（`Enemies.LIST`，含 4 个 Boss）
     · 角色 8 个（`Chars.LIST`）→ 躯干图集 + 肖像
     · 枢纽站点 8 个、掉落物 2 种、弹丸 13 种、粒子 8 种、宣传件 2 个…
     · 瓦片集 / 视差层 / 装饰物（来自 `ArtTiles` / `ArtParallax`）

   ## 两种输出

     node tools/art-manifest.mjs           给人读的分组清单（默认）
     node tools/art-manifest.mjs --csv     给美术/表格软件（每行一个变体）
     node tools/art-manifest.mjs --json    给程序（后续"资源加载"那一步会用）

   ## 它**不**做的事

   不生成占位图、不做加载、不改任何代码。它只回答"需要什么"。
   每一步"需要哪张图"都带 `来源`（哪个数据表/哪个文件），
   所以清单不会变成另一份会漂的手抄件。
   ========================================================= */
import path from 'node:path';
import { loadAll, SIM_MODULES } from '../test/_load.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const CSV = process.argv.includes('--csv');
const JSON_OUT = process.argv.includes('--json');

/* 需要在无 DOM 下也能读到的表（美术规范 + 内容数据） */
await loadAll(SIM_MODULES.concat(['art_shaders']));
const { Weapons, Items, Enemies, Chars, Art, ArtTiles, ArtParallax, Sprites } = globalThis;

/* =========================================================
   清单的声明表
   ---------------------------------------------------------
   每一行 = 一类资源。**`kind` 必须是 `Art.KINDS` 里真实存在的类别 id**
   （第一版我写了 `weapon`/`char` 这种"我以为是类别"的 id，于是规范复核
   报出 86 条"类别不在 Art.KINDS 里" —— 清单与规范各说各话。
   现在 `kind` 与 `prefix` 都从 `Art.KINDS` 取，不再手抄）。

   `items()` 从**代码里的表**现枚举；尺寸/锚点由图集的类别决定。
   ========================================================= */
const KIND = id => {
  const k = Art.kindOf(id);
  if (!k) throw new Error('art-manifest：类别 id 写错了：' + id + '（Art.KINDS 里没有它）');
  return k;
};

const GROUPS = [
  {
    id: 'weapon', kind: 'device', name: '武器', anchor: 'foot',
    note: '形状本体。**每种 kind×tints 组合一张**（实测 24 组）—— 或者改成' +
      '"灰度部件 mask + 运行时着色"（那是另一条路，见 README 的讨论）',
    items() {
      const seen = new Set(), out = [];
      for (const w of (Weapons && Weapons.LIST) || []) {
        const tints = (w.tints || []).join('/');
        const key = w.kind + '|' + tints;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ id: 'DEV_Weapon' + cap(w.kind), variant: w.kind + ' · ' + (tints || '默认色'), src: 'data_weapons.ts' });
      }
      return out;
    }
  },
  {
    id: 'icon', kind: 'icon', name: '道具图标', anchor: 'center',
    note: '图标 × 各自 tint。UI 图集（与世界层不同批）',
    items() {
      const seen = new Set(), out = [];
      for (const it of (Items && Items.LIST) || []) {
        const key = it.icon + '|' + (it.tint || '');
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ id: 'ICON_' + cap(it.icon), variant: it.icon + ' · ' + (it.tint || '默认色'), src: 'data_items.ts' });
      }
      return out;
    }
  },
  {
    id: 'enemy', kind: 'anim', name: '怪物本体', anchor: 'foot',
    note: '每个怪种一张**带锚点**的贴图（`bodyY` / `foot` 由 `S.enemyBox` 算）。' +
      '本项目的怪物没有逐帧动画（挤压/浮沉是运行时算的），所以目前一帧就够',
    items() {
      return ((Enemies && Enemies.LIST) || []).map(e => ({
        id: 'ANIM_Enemy' + cap(e.id), variant: e.name + (e.boss ? '（Boss）' : ''), src: 'enemies.ts'
      }));
    }
  },
  {
    id: 'char', kind: 'anim', name: '角色躯干', anchor: 'foot',
    note: '**这是最贵的一类**：躯干现在是"骨架烘成图集"，按呼吸档分 26 张；' +
      '改成逐帧序列图会让份数按帧数再乘一遍（详见 README 的讨论）',
    items() {
      return ((Chars && Chars.LIST) || []).map(c => ({
        id: 'ANIM_Char' + cap(c.id), variant: c.name + ' 躯干', src: 'data_chars.ts'
      }));
    }
  },
  {
    /* 与"角色躯干"分开，而不是塞进同一组 —— 它们的**类别不同**：
       躯干是世界图集（贴地、按脚底排序），肖像只在界面状态出现（UI 图集）。
       第一版把两者放一组，于是资源名前缀（`UI_`）与组声明的类别（`anim`）
       对不上，规范复核直接报了 9 条。**组是按"类别 + 图集"分的，不是按主题分的。** */
    id: 'portrait', kind: 'ui', name: '角色肖像', anchor: 'center',
    note: '选人 / 结算界面用的立绘。与躯干分开：躯干是世界图集（贴地），肖像只在界面出现（UI 图集）',
    items() {
      return ((Chars && Chars.LIST) || []).map(c => ({
        id: 'UI_Char' + cap(c.id) + 'Portrait', variant: c.name + ' 肖像', src: 'data_chars.ts'
      }));
    }
  },
  {
    id: 'station', kind: 'ui', name: '枢纽站点头像', anchor: 'center',
    note: '8 个手画分支 + 一张兜底牌',
    items() {
      const ids = ['mother', 'picker', 'keeper', 'archivist', 'mirror', 'contract', 'wall', 'door'];
      return ids.map(id => ({ id: 'UI_Station' + cap(id), variant: id, src: 'sprites.ts 的 stationPortrait' }));
    }
  },
  {
    id: 'pickup', kind: 'device', name: '掉落物', anchor: 'foot',
    note: '材料 / 回血两种',
    items() {
      return [{ id: 'DEV_PickupMat', variant: '材料', src: 'sprites.ts' },
        { id: 'DEV_PickupHeal', variant: '回血', src: 'sprites.ts' }];
    }
  },
  {
    id: 'bullet', kind: 'fx', name: '弹丸', anchor: 'foot',
    note: '13 种。**形状可以给图，但朝向旋转与生命期 alpha 必须留在代码里**',
    items() {
      const ids = ['shot', 'knife', 'sword', 'spear', 'axe', 'hammer', 'bolt', 'ball', 'orb', 'rocket', 'flame', 'laser', 'bossball'];
      return ids.map(id => ({ id: 'FX_Bullet' + cap(id), variant: id, src: 'sprites.ts 的 drawBullet / drawEnemyBullet' }));
    }
  },
  {
    id: 'particle', kind: 'particle', name: '粒子', anchor: 'foot',
    note: '8 种画法。**同样只替换形状** —— 半径/线宽/alpha 随生命期的插值留在代码里',
    items() {
      const kinds = (Sprites && Sprites.kinds) ? Object.keys(Sprites.kinds) : [];
      return kinds.map(k => ({ id: 'PT_' + cap(k), variant: k, src: 'sprites.ts 的 S.register' }));
    }
  },
  {
    id: 'tileset', kind: 'tileset', name: '瓦片集', anchor: 'tile',
    note: '**必须给 16-mask 的规则瓦片集**（每格由邻居的 4 位掩码决定），' +
      '不能给一张"墙的图"。边长必须是绘制网格的整数倍',
    items() {
      const out = [];
      for (const ts of (ArtTiles && ArtTiles.TILESETS) || []) {
        for (const t of ts.tiles || []) {
          out.push({
            id: 'TILE_' + cap(ts.id) + cap(t.id),
            variant: ts.name + ' · ' + t.id + '（' + t.shape + '）',
            src: 'art_tiles.ts · ' + ts.id + ' 的 mask 表',
            w: ts.tileSize, h: ts.tileSize
          });
        }
      }
      return out;
    }
  },
  {
    id: 'bg', kind: 'bg', name: '视差背景层', anchor: 'center',
    note: '**要可无缝平铺**：`copiesOf` 会按视口算"铺几份"，一张不够',
    items() {
      return ((ArtParallax && ArtParallax.LAYERS) || []).map(l => ({
        id: 'BG_' + cap(l.id), variant: l.name + '（速率 ' + l.rate + '，重复 ' + l.repeat + 'px）', src: 'art_parallax.ts'
      }));
    }
  },
  {
    id: 'promo', kind: 'promo', name: '宣传件', anchor: 'center',
    note: '标题字是**逐字声明**的（字距与投影锁死），换成图会丢掉"宽度是算出来的"这一点',
    items() {
      return ((Sprites && Sprites.EMBLEMS) || []).map(e => ({
        id: 'PROMO_' + cap(e.id), variant: e.id + '（' + e.w + '×' + e.h + '）', src: 'sprites.ts'
      }));
    }
  }
];

/** `knife` → `Knife`（资源名的"词"用 PascalCase，规范里写明了为什么） */
function cap(s) { s = String(s); return s.charAt(0).toUpperCase() + s.slice(1); }

/* =========================================================
   枚举 + 用**现成的规范**复核每一行
   ---------------------------------------------------------
   不另写一套校验：每条都过 `Art.lintAsset`（名字前缀 / 尺寸 / 锚点 / 图集）。
   这样清单与规范不会各说各话。
   ========================================================= */
const rows = [];
const lintProblems = [];
for (const g of GROUPS) {
  /* 类别与图集**从规范取**，不手抄 —— 手抄就会出现"清单说 world、规范说 ui" */
  const kind = KIND(g.kind);
  for (const it of g.items()) {
    const rec = {
      group: g.id, groupName: g.name, id: it.id, variant: it.variant, src: it.src,
      kind: kind.id, atlas: kind.atlas, anchor: g.anchor,
      w: it.w || '', h: it.h || '', prefix: kind.prefix
    };
    rows.push(rec);
    /* 规范复核：拿这一行的**真实名字/尺寸/锚点/类别**去问 `Art.lintAsset`。
       这一条是清单与规范之间唯一的连接点 —— 它红了说明清单写错了，
       而不是说明规范太严。 */
    const spec = {
      name: it.id,
      kind: kind.id,
      w: it.w || Art.SIZES.grid * 2,
      h: it.h || Art.SIZES.grid * 2,
      anchor: g.anchor
    };
    const v = Art.lintAsset(spec);
    if (!v.ok) for (const p of v.problems) lintProblems.push(rec.id + '：' + p);
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify({
    total: rows.length,
    groups: GROUPS.map(g => ({ id: g.id, name: g.name, kind: g.kind, atlas: KIND(g.kind).atlas, count: rows.filter(r => r.group === g.id).length })),
    rows: rows,
    lintProblems: lintProblems
  }, null, 1));
  process.exit(lintProblems.length ? 1 : 0);
}

if (CSV) {
  /* 给表格软件：一行一个变体。故意用逗号 + 双引号转义（Excel 能直接开） */
  const esc = s => '"' + String(s).replace(/"/g, '""') + '"';
  console.log(['类别', '资源名', '变体', '图集', '锚点', '宽', '高', '来源'].map(esc).join(','));
  for (const r of rows) {
    console.log([r.groupName, r.id, r.variant, r.atlas, r.anchor, r.w, r.h, r.src].map(esc).join(','));
  }
  process.exit(lintProblems.length ? 1 : 0);
}

const PAD = (s, n) => { s = String(s); let w = 0; for (const c of s) w += c.charCodeAt(0) > 127 ? 2 : 1; return s + ' '.repeat(Math.max(0, n - w)); };

console.log('\n=== Bronana · 美术素材清单（从代码里的数据表现枚举）===\n');
console.log('  这份清单回答"要准备哪些图"，不是"怎么接入"（接入的先决条件见 README：');
console.log('  项目现在**没有资源加载层**，全仓 0 处图片加载代码）。\n');

console.log('[1] 按类别');
let total = 0;
for (const g of GROUPS) {
  const n = rows.filter(r => r.group === g.id).length;
  total += n;
  console.log('  ' + PAD(g.name, 18) + PAD(n + ' 项', 9) + '图集 ' + PAD(KIND(g.kind).atlas, 8) + '锚点 ' + g.anchor);
  console.log('  ' + ' '.repeat(18) + '\x1b[90m' + g.note + '\x1b[0m');
}
console.log('\n  \x1b[1m合计 ' + total + ' 项\x1b[0m');

console.log('\n[2] 逐项（前 40 条；完整清单用 --csv / --json）');
console.log('  ' + PAD('资源名', 34) + PAD('变体', 30) + '来源');
for (const r of rows.slice(0, 40)) {
  console.log('  ' + PAD(r.id, 34) + PAD(r.variant, 30) + '\x1b[90m' + r.src + '\x1b[0m');
}
if (rows.length > 40) console.log('  \x1b[90m…（还有 ' + (rows.length - 40) + ' 条）\x1b[0m');

console.log('\n[3] 规范复核（每一行都过 Art.lintAsset）');
if (!lintProblems.length) {
  console.log('  \x1b[32m✔ ' + total + ' 行全部通过规范（名字前缀 / 尺寸 / 锚点 / 图集）\x1b[0m');
} else {
  console.log('  \x1b[31m✘ ' + lintProblems.length + ' 处不符：\x1b[0m');
  for (const p of lintProblems.slice(0, 20)) console.log('    · ' + p);
}

console.log('\n=== 结果 ===');
console.log('  素材项：' + total + ' · 规范问题：' + lintProblems.length);
console.log('  导出：\x1b[36mpnpm run art-manifest -- --csv > art.csv\x1b[0m 或 \x1b[36m--json\x1b[0m');
console.log('');
process.exit(lintProblems.length ? 1 : 0);
