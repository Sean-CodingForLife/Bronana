import { Registry } from './registry.ts';
import { SelfCheck } from './selfcheck.ts';
/* =========================================================
data_chars.ts — 可选角色（豆豆职业）
========================================================= */
/* 默认角色：没有任何 locked 标记 = 一开始就能用。
   其余角色由 challenges.ts 里"进程"那一组的挑战解锁（打到第 2/4/6/9/12/15/18 波）。
   注意这只是**界面门槛**：Game.newRun(id) 不做校验 ——
   模拟层不认识账号档案，测试与 CLI 才能照常直接开局。 */
var C = {} as CharsApi;

C.LIST = [
  {
    id: 'ranger', name: '全能豆豆', en: 'Well-Rounded', tag: '均衡',
    desc: '没有任何短板的基准角色，六把武器随便配，最适合第一次上手。',
    stats: {}, startWeapons: ['pistol'],
    tint: ['#f2e3bd', '#d3bd8c'], face: 'stern'
  },
  {
    id: 'brawler', name: '狂战士', en: 'Brawler', tag: '近战特化', locked: true,
    desc: '近身就是他的主场。生命厚实、近战凶悍，但射程意识为零。',
    stats: { maxHp: 10, meleeDmg: 6, armor: 2, rangedDmg: -4, speed: 0.04 },
    startWeapons: ['knife'], tint: ['#e8c9a0', '#c4a075'], face: 'angry'
  },
  {
    id: 'mage', name: '元素法师', en: 'Mage', tag: '元素流', locked: true,
    desc: '元素伤害爆表，攻速飞快，代价是皮薄如纸。',
    stats: { elementalDmg: 8, attackSpeed: 0.15, damage: 0.05, maxHp: -6, armor: -1 },
    startWeapons: ['orb'], tint: ['#d9c2e8', '#a98cc4'], face: 'stern'
  },
  {
    id: 'engineer', name: '工程师', en: 'Engineer', tag: '工程学', locked: true,
    desc: '靠炮塔和机枪说话，工程学越高，所有工程武器越强。',
    stats: { engineering: 10, rangedDmg: 3, harvesting: 4, speed: -0.05 },
    startWeapons: ['turretgun'], tint: ['#c8d6b0', '#93a87a'], face: 'stern'
  },
  {
    id: 'masochist', name: '受虐狂', en: 'Masochist', tag: '极限', locked: true,
    desc: '挨打才是成长。受伤越多越强，但容错率极低。',
    stats: { maxHp: -8, damage: 0.22, attackSpeed: 0.12, armor: -2 },
    special: 'rage',
    startWeapons: ['axe'], tint: ['#e0b0a8', '#b8786e'], face: 'angry'
  },
  {
    id: 'gladiator', name: '角斗士', en: 'Gladiator', tag: '双持', locked: true,
    desc: '开局就带两把武器，武器槽全塞满才算完整形态。',
    stats: { damage: 0.08, speed: 0.06, maxHp: 4, dodge: 0.05 },
    startWeapons: ['sword', 'pistol'], tint: ['#f0d7a8', '#c9a670'], face: 'stern'
  },
  {
    id: 'collector', name: '收藏家', en: 'Collector', tag: '滚雪球', locked: true,
    desc: '收获极高，材料来得飞快，但战斗属性起点偏低。',
    stats: { harvesting: 14, luck: 8, damage: -0.08, maxHp: -2 },
    startWeapons: ['slingshot'], tint: ['#dcd0a8', '#ab9d74'], face: 'round'
  },
  {
    id: 'sprinter', name: '疾行者', en: 'Sprinter', tag: '机动', locked: true,
    desc: '快到模糊。靠走位躲过一切伤害，靠拾取范围吃满材料。',
    stats: { speed: 0.28, dodge: 0.14, pickupRange: 8, maxHp: -4, armor: -1 },
    startWeapons: ['smg'], tint: ['#bcd6d9', '#88a8ac'], face: 'round'
  },
  /* ---- 隐藏角色（G5）----
     它不在选人页上（`hidden`），要**发现 6 间密室**（隐藏挑战 hidden_wall）才会出现。
     玩法上它是"破墙的那个人"：自带裂地锤（重击家族）与厚血，走得慢 ——
     与"你能破墙、你能看见别人看不见的东西"这件事在数值上呼应。 */
  {
    id: 'mole', name: '掘进者', en: 'Mole', tag: '破墙', locked: true, hidden: true,
    desc: '在墙里生活过的东西。锤子够重、皮够厚，代价是它几乎不会跑。',
    stats: { maxHp: 14, meleeDmg: 8, armor: 3, harvesting: 6, speed: -0.12, rangedDmg: -3 },
    startWeapons: ['quake'], tint: ['#cbb08a', '#94795a'], face: 'stern'
  }
];

/* 无原型表（`Object.create(null)`）：任何查 id 的地方都不该被 `__proto__` /
   `constructor` / `toString` 这类**原型键**骗过 —— `BY_ID['__proto__']` 在普通对象上
   是真值，于是存档里写 `char: "__proto__"` 会绕过"未知角色"那道守卫，
   读到的是 `Object.prototype`（实测：角色静默变成表格里的第一个，标题页还会显示
   `charName = "Object"`）。同类的还有 items / weapons / enemies / forge 四张表。 */
C.BY_ID = Object.create(null);
for (var i = 0; i < C.LIST.length; i++) C.BY_ID[C.LIST[i].id] = C.LIST[i];

/* =========================================================
   角色的**专属机制**（`CharDef.special`）
   ---------------------------------------------------------
   与 `data_items.ts` 的 `SPECIALS` 是同一套路，补上它是因为这一处曾经是
   **唯一一条没有声明表的机制族**：一件道具的 `special` 写错会当场被审计抓住，
   而一个角色的 `special` 写错（或改个名字）的表现是"这个角色变成白板"——
   不报错、不崩、界面上角色卡照常写着它的描述。
   实测：改造前 `'rage'` 这个字符串在 game.ts 里被裸比了 4 次（属性折算 / 移速 /
   受伤重算 / 开局），没有任何一处能回答"一共有几种角色机制、哪个没人读"。

   分工与道具那张一样：这里只**声明**（它是什么、谁读它），
   读点在 game.ts（改机制的地方），审计守住两条：
     · 每个角色写的 special 必须在表里（写错一个字母 = 这个角色没有机制）
     · 表里登记的键必须有读点（登记了没人读 = 界面上写着效果的假话）
   ========================================================= */
C.SPECIALS = {
  rage: { note: '受伤越重越强（属性按已失生命折算）', read: 'game.ts recalcStats（damage/attackSpeed）+ moveSpeed + hurt' }
};

/** 定义期自检：角色的 special 必须登记，登记的必须有读点 */
C.audit = function () {
  var problems = [];
  var seen: Record<string, boolean> = Object.create(null);
  for (var i = 0; i < C.LIST.length; i++) {
    var d = C.LIST[i];
    if (!d.id) problems.push('第 ' + i + ' 个角色没有 id');
    if (seen[d.id]) problems.push('角色 id 重复：' + d.id);
    seen[d.id] = true;
    if (!d.startWeapons || !d.startWeapons.length) problems.push(d.id + ' 没有起始武器（开局会是零武器，这一间永远清不掉）');
    if (d.special && !C.SPECIALS[d.special]) {
      problems.push(d.id + ' 的 special 没登记：' + d.special + '（这个角色的机制永远不会生效）');
    }
    /* 起始武器存不存在**不在这里查**：那要 import `data_weapons.ts`，而
       `data_weapons` 与 `data_chars` 是同层表 —— 加这条边换来的是**环**。
       这一条由 `Registry.family('char')` 的 `startWeapons[]` 引用查（regisry 审计
       已经覆盖，且那是"跨表引用"该待的地方）。 */
  }
  /* 「谁读它」那一栏必须指得出一个真实文件：写个空字符串等于没写 */
  for (var k in C.SPECIALS) {
    if (!Object.prototype.hasOwnProperty.call(C.SPECIALS, k)) continue;
    var s = C.SPECIALS[k];
    if (!s.note) problems.push('角色机制 ' + k + ' 没有说明');
    if (!s.read || !/\.ts/.test(s.read)) problems.push('角色机制 ' + k + ' 没写清谁读它（read）');
  }
  /* 反向：表里的每一条都得有角色在用（登记了没人用的键是死声明） */
  for (var k2 in C.SPECIALS) {
    if (!Object.prototype.hasOwnProperty.call(C.SPECIALS, k2)) continue;
    var used = false;
    for (var j = 0; j < C.LIST.length; j++) if (C.LIST[j].special === k2) { used = true; break; }
    if (!used) problems.push('角色机制 ' + k2 + ' 登记了却没有任何角色用它');
  }
  return {
    ok: problems.length === 0, problems: problems,
    counts: { chars: C.LIST.length, specials: Object.keys(C.SPECIALS).length }
  };
};

var cverdict = C.audit();
if (!cverdict.ok) throw new Error('data_chars.ts 角色表自检失败：\n' + cverdict.problems.join('\n'));
SelfCheck.register('Chars', C.audit);

/**
 * 这个角色有没有 `name` 这条机制。**唯一的读法** ——
 * 模拟层不再写 `charDef.special === 'rage'`（那种写法有三份，
 * 而"一共有几种角色机制"没有任何一处能回答）。
 * 认不出的角色 / 未登记的机制一律 false（坏存档不会因此崩，只是没有那条机制）。
 */
C.specialOf = function (charId, name) {
  if (!charId || !name) return false;
  var d = C.BY_ID[charId];
  return !!(d && d.special === name && C.SPECIALS[name]);
};

/* 登记到扩展点总账：起始武器必须存在、眼睛风格必须有画法、标签必须是表里那一档、
   `special` 必须是一条**登记过的**角色机制 */
Registry.family('char', {
  note: '角色表（9 个）', owner: 'data_chars.ts',
  entries: function () {
    return C.LIST.map(function (d) {
      var refs = [
        { field: 'face', value: d.face || 'stern', family: 'enemyEye' },
        { field: 'tag', value: d.tag, family: 'charTag' },
        /* `special` 是一次跨表引用：写一个表里没有的机制名（或表里登记了却没人读），
           这个角色就是**白板** —— 而它的描述还在选人页上写着效果。 */
        { field: 'special', value: d.special, family: 'charSpecial' }
      ];
      for (var i = 0; i < d.startWeapons.length; i++) {
        refs.push({ field: 'startWeapons[' + i + ']', value: d.startWeapons[i], family: 'weapon' });
      }
      return { id: d.id, refs: refs };
    });
  }
});
Registry.family('charTag', {
  note: '角色定位标签（**从角色表算出来**，不再手抄一份）', owner: 'data_chars.ts',
  /* 以前这里是一串手写的 `values: [...]`，与每行的 `tag` 是**两份**东西：
     改一行的标签而忘了改这里，自检不会响（`values()` 家族不查"表里有没有人用"）。
     现在从表里算，于是它**不可能**漂移。 */
  values: function () {
    var out: string[] = [];
    for (var i = 0; i < C.LIST.length; i++) if (out.indexOf(C.LIST[i].tag) < 0) out.push(C.LIST[i].tag);
    return out;
  }
});
Registry.family('charSpecial', {
  note: '角色的专属机制（写错 = 这个角色是白板，而描述照旧）+ 谁读它', owner: 'data_chars.ts',
  values: function () { return Object.keys(C.SPECIALS); }
});
/* 字段 → 家族的声明（守卫读它，见 test/data-contract.mjs）：
   角色表上的 `special` 属于 `charSpecial`（道具表上的同名字段属于 `itemSpecial`），
   而 `tag` / `startWeapons` 各自的值域也在这里一次说清。 */
Registry.uses('special', 'charSpecial');
Registry.uses('tag', 'charTag');
Registry.uses('startWeapons', 'weapon');
/* 角色的脸用的是**怪物眼睛的画法**（`enemyEye` 家族，由 enemies.ts 登记）：
   两者共用同一套造型关键字（stern / angry / round …），所以值域是同一个。
   这是一条**跨模块的视觉依赖**，写在这里而不是藏起来 ——
   `data_chars.ts` 的 entries 早就引用了那个家族，只是从没声明过。 */
Registry.uses('face', 'enemyEye');

export { C as Chars };