/* =========================================================
   story.ts — 剧情（**用已有的名词当骨架**，不另起一套）

   为什么这么设计：这个游戏里已经长出了一整套"菌"的词汇 ——
   孢子（局外货币）、菌床（据点设施）、拾荒堆、菌毯洞窟（楼层主题）、
   孢子牧者（敌人）、母巢（待做的 Boss）。剧情如果另起一套设定，
   就会和玩法各说各话；所以主线**直接用它们**：

     你是从菌床里长出来的一根东西。荒漠正在被菌毯吃掉。
     四个 Boss 是菌毯的四个器官。上一个文明留下 12 片记录。
     真结局在通关之后的那一层（深井）。

   借的是这几家的**结构**，不是他们的设定：
     · **Hades**：剧情放在**局与局之间**推进 —— 死后回枢纽，NPC 有新话。
       "死亡也是进度"是肉鸽 + 剧情唯一能成立的方式，所以枢纽对话由**局数**驱动。
     · **以撒**：结局是**可解锁的收藏**（每打赢一个 Boss 给一张结局卡），
       真结局挂在隐藏条件上。
     · **挺进地牢**：每个角色有自己的"过去"，通关后给一段自己的尾声。
     · **死亡细胞 / 以撒**：世界观藏在**碎片**里（密室/事件/Boss 掉落），
       玩家自己拼。碎片进图鉴，于是"探索"直接等于"读故事"。
     · **杀戮尖塔**：事件房给的是**选择**（代价与好处），不是一段旁白。

   三条硬约束（测试守着）：
     1. **本模块不碰模拟层**：没有随机、没有状态，只有表与纯函数。
        所以它不会影响确定性、回放与行为指纹（对话不进带子）。
     2. **不许剧透**：所有台词都带条件，没满足条件的台词**取不出来**。
     3. **枢纽 NPC 是对已有设施的拟人化**（菌床/拾荒堆/钟楼/图鉴各一位）——
        界面上的每一栏都能指到游戏里的某个东西。
   ========================================================= */

import { SelfCheck } from './selfcheck.ts';
import { Registry } from './registry.ts';

var Story = {} as StoryApi;

/* =========================================================
   1. 枢纽 NPC（每一位对应一个已有设施）
   ========================================================= */
var NPCS: StoryNpcDef[] = [
  {
    id: 'mother', name: '菌母', role: '菌床', at: '你从她身上长出来',
    note: '说话像在打嗝。她记得每一个被你放弃的局。',
    unlock: null
  },
  {
    id: 'picker', name: '拾荒者', role: '拾荒堆', at: '在废料堆里翻东西',
    note: '只关心你带回来什么。教你怎么把材料用得更值。',
    unlock: null
  },
  {
    id: 'keeper', name: '守钟人', role: '钟楼', at: '守着一口不走的钟',
    note: '负责解释"为什么又是这一层"。也是图鉴的看门人。',
    unlock: null
  },
  {
    id: 'archivist', name: '记录官', role: '图鉴', at: '把碎片抄在墙上',
    note: '你捡回来的每一片记录，最后都贴在他那面墙上。',
    unlock: { fragments: 1 }        // 捡到第一片碎片之后才会出现
  }
];

/* =========================================================
   1b. 枢纽站点（"家"里站着的人与摆着的设施）
   ---------------------------------------------------------
   为什么枢纽不是一份菜单：它是**一个地方**。参照 Hades 的"家" ——
   夜之镜（天赋）、承包商（建筑）、纪念品柜（配装）、经纪人（兑换）都摆在屋里，
   NPC 站在各自的角落，谁有新话谁头上挂个角标。玩家是"走过去"，不是"点列表"。

   所以这一屏的内容=站点的**位置与形象**，这张表就是那份清单：
     · `npc` 站：有人站在那儿 → 说话（没解锁就不出现，而不是灰着）
     · 设施站：走上去进入某个已有界面（天赋 / 据点 / 图鉴 / 出发）
   站点 id 同时是 `sprites.ts` 里的头像 id（总账会查"每一站都画得出来"）。
   ========================================================= */
var STATIONS: StoryStationDef[] = [
  // —— 四位 NPC：站在房里的人（他们对应已有设施，也是剧情的出口）
  { id: 'mother', npc: 'mother', name: '菌母', role: '菌床 · 听她说话' },
  { id: 'picker', npc: 'picker', name: '拾荒者', role: '拾荒堆 · 听他说' },
  { id: 'keeper', npc: 'keeper', name: '守钟人', role: '钟楼 · 听他说' },
  { id: 'archivist', npc: 'archivist', name: '记录官', role: '记录墙 · 听他说' },
  // —— 四件设施：走上去就能用（都不是新系统，只是把已有界面摆进屋里）
  { id: 'mirror', name: '镜面', role: '天赋 · 永久成长', screen: 'talents' },
  { id: 'contract', name: '契约台', role: '据点 · 花孢子', screen: 'keep' },
  { id: 'wall', name: '档案墙', role: '图鉴 · 挑战', screen: 'codex' },
  { id: 'door', name: '门口', role: '出发 · 再下一局', screen: 'chars' }
];

/* =========================================================
   2b. flag 声明表（**唯一声明**）
   ---------------------------------------------------------
   台词条件里能用到的布尔 flag 必须在这里登记。
   为什么要有这张表：flag 是字符串，`keepClocktower` 写成 `keepClockTower`
   的话，那条台词**永远取不到**，而界面上没有任何异常 —— 这是最难查的一类问题。
   自检会验"台词里用到的 flag 都在这张表里"，测试会验"每个 flag 都被声明且可达"。
   ========================================================= */
var FLAGS: Record<string, string> = {
  keepClocktower: '据点里买下过钟楼（接线层在 keepBuy 成功后置位）',
  deepPit: '下到过第 4 层「深井」（地图层进入该层时置位）',
  sawSecret: '发现过至少一间密室（破墙成功时置位）',
  firstWin: '第一次通关（结算时置位）'
};

/* =========================================================
   3. 台词池
   ---------------------------------------------------------
   `when` 是条件（纯数据，测试会验它引用的东西都真实存在）：
     runs       : 至少打过几局（死亡也推进剧情 —— Hades 的那条）
     wins       : 至少通关几次
     floor      : 至少到过第几层
     fragments  : 至少捡到几片记录
     bosses     : 至少打赢过几个 Boss
     secrets    : 至少发现过几间密室
     endings    : 至少解锁几个结局
     flag       : 某个布尔 flag 为真（必须在 FLAGS 里登记）
   `once: true` 的台词说过就不再出现（枢纽的对话要有"清空"的进度感）。
   ========================================================= */
function L(npc, id, text, when?, once?) {
  return { npc: npc, id: id, text: text, when: when || {}, once: once !== false };
}

var LINES: StoryLineDef[] = [
  /* ---- 菌母：核心设定，随局数与通关推进 ---- */
  L('mother', 'm1', '……你醒了。好。别急着问自己是什么。', { runs: 0 }),
  L('mother', 'm2', '你是我从土里挤出来的。你身上有我。', { runs: 1 }),
  L('mother', 'm3', '外面那片荒漠，本来不是荒漠。', { runs: 3 }),
  L('mother', 'm4', '菌毯在长。它不吃土，它吃"还活着的东西"。', { floor: 2 }),
  L('mother', 'm5', '你死一次，我就多记得一点。别怕死，怕白死。', { runs: 5 }),
  L('mother', 'm6', '那四个……是它的器官。你砍一个，它就慢一点。', { bosses: 1 }),
  L('mother', 'm7', '你打赢过它的一部分了。它开始注意你了。', { bosses: 2 }),
  L('mother', 'm8', '深井下面还有一层。别下去。……我拦不住你，是不是。', { wins: 1 }),
  L('mother', 'm9', '你把十二片都捡齐了。那我告诉你：我不记得自己是谁。', { fragments: 12 }),

  /* ---- 拾荒者：把"经营"讲成他的话 ---- */
  L('picker', 'p1', '别把材料全塞进枪里。墙也是能用的。', { runs: 0 }),
  L('picker', 'p2', '你在营地里摆东西的顺序，比摆什么更要紧。', { runs: 2 }),
  L('picker', 'p3', '我见过有人把营火和哨塔挨着放，两样都变强了。别问我为什么。', { floor: 2 }),
  L('picker', 'p4', '菌床那老东西给你产孢子？省着花。孢子是给墙的，不是给枪的。', { runs: 4 }),
  L('picker', 'p5', '有些墙是空的。你打两下就知道了。', { secrets: 1 }),
  L('picker', 'p6', '打得准不如打得久。你懂我意思。', { wins: 1 }),

  /* ---- 守钟人：解释"循环"与难度阶梯 ---- */
  L('keeper', 'k1', '钟不走了。所以今天还是今天。', { runs: 0 }),
  L('keeper', 'k2', '你每往下走一层，外面的时间才动一格。', { floor: 2 }),
  L('keeper', 'k3', '想让它更难？你自己去选。我不会替你选。', { runs: 3 }),
  L('keeper', 'k4', '有个东西在深井底下敲钟。敲得和我一个节奏。', { floor: 3 }),
  L('keeper', 'k5', '通关不是结束。是钟又响了一次。', { wins: 1 }),
  L('keeper', 'k6', '你把钟塔修好过。你知道时间是可以买的。', { flag: 'keepClocktower' }),
  L('keeper', 'k7', '你说你"赢"了。……一根长出来的东西，赢了是什么意思？', { flag: 'firstWin' }),

  /* ---- 记录官：碎片与图鉴的看门人 ---- */
  L('archivist', 'a1', '拿来。……嗯。第一片。我贴这儿。', { fragments: 1 }),
  L('archivist', 'a2', '上一个文明也种过菌。他们种得比我们大。', { fragments: 3 }),
  L('archivist', 'a3', '他们写：' + '「不要喂它」' + '。后面被划掉了。', { fragments: 5 }),
  L('archivist', 'a4', '他们写：' + '「它会长成我们的样子」' + '。', { fragments: 8 }),
  L('archivist', 'a5', '最后一片的笔迹和第一片不一样。不是同一个人写的。', { fragments: 11 }),
  L('archivist', 'a6', '齐了。墙上这十二片连起来，是一封信。收信人是你。', { fragments: 12 }),
  L('archivist', 'a7', '你在下面见到它的时候，替我问一句：它记不记得自己种过什么。', { endings: 3 }),
  L('archivist', 'a8', '你把墙打穿了。上一个文明也这么干过 —— 他们打穿的那面墙后面，是它。', { flag: 'sawSecret' })
];

/* =========================================================
   3. 记录碎片（12 片）
   ---------------------------------------------------------
   `from` 说明这一片从哪来 —— 测试会验每一个来源都是真实存在的房型 / Boss / 事件。
   捡碎片这件事因此等于"探索"：密室、事件房、Boss、深井各给几片。
   ========================================================= */
var FRAGMENTS: StoryFragmentDef[] = [
  { id: 'f01', from: 'boss:warden', title: '第一片 · 播种', text: '我们把种子撒进风里。风把它带到了不该去的地方。' },
  { id: 'f02', from: 'boss:digger', title: '第二片 · 井', text: '有人往下挖，想找水。挖到的是别的东西，它也在往下挖。' },
  { id: 'f03', from: 'boss:brood', title: '第三片 · 喂养', text: '它一开始很小。我们喂它废料，它替我们清掉垃圾。这很划算。' },
  { id: 'f04', from: 'boss:pendulum', title: '第四片 · 计时', text: '钟楼是为了提醒我们撤退用的。后来没人撤了。' },
  { id: 'f05', from: 'secret', title: '第五片 · 不要喂它', text: '不要喂它。（后面被划掉了，划得很用力。）' },
  { id: 'f06', from: 'secret', title: '第六片 · 名单', text: '值守名单：菌母、拾荒、守钟、记录。第四个名字被人抠掉了。' },
  { id: 'f07', from: 'secret', title: '第七片 · 手术', text: '我们把它切开看过。里面是我们的形状，只是还没有长开。' },
  { id: 'f08', from: 'secret', title: '第八片 · 它醒了', text: '它醒了。它没有生气。它只是继续长。' },
  { id: 'f09', from: 'event', title: '第九片 · 一封没寄出的信', text: '如果你读到这里：不要替我报仇，替我把钟修好。' },
  { id: 'f10', from: 'event', title: '第十片 · 交换', text: '我们拿它要的东西换了三天晴天。三天之后它要得更多。' },
  { id: 'f11', from: 'deeppit', title: '第十一片 · 底下', text: '深井底下不是它的巢。是它的种子袋。' },
  { id: 'f12', from: 'deeppit', title: '第十二片 · 收信人', text: '如果你是长出来的那根：你不是我们的孩子，你是我们的回信。' }
];

/* =========================================================
   4. 结局（可解锁的收藏；真结局挂在隐藏条件上）
   ========================================================= */
var ENDINGS: StoryEndingDef[] = [
  {
    id: 'shell', name: '破壳', order: 1,
    when: { bosses: 1 },
    text: '你砍下了它的第一只器官。它没有叫。你听见远处有东西在长。'
  },
  {
    id: 'harvest', name: '收割', order: 2,
    when: { bosses: 2 },
    text: '第二只也断了。荒漠露出下面的一层土 —— 是骨头，铺得很整齊。'
  },
  {
    id: 'wastelord', name: '暴君之死', order: 3,
    when: { wins: 1 },
    text: '你站在它的位置上。钟响了一次。你以为结束了。钟又响了一次。'
  },
  {
    id: 'letter', name: '回信', order: 4, secret: true,
    when: { wins: 1, fragments: 12, flag: 'deepPit' },
    text: '十二片连起来是一封信。你读完，把它放回墙上。' +
      '然后你往下走 —— 不是去找它，是去替他们把钟修好。'
  }
];

/* =========================================================
   5. 每个角色的一段"过去"（挺进地牢那套：通关后给尾声）
   ---------------------------------------------------------
   `chars` 的 id 必须真实存在（测试会验）。
   ========================================================= */
var PASTS: StoryPastDef[] = [
  { char: 'ranger', line: '均衡豆豆不记得自己为什么是均衡的。它只记得有人给它量过尺寸。', epilogue: '它把量尺折了，插进土里。' },
  { char: 'brawler', line: '狂战士是被菌毯吐出来的。它记得被吐出来的那一下。', epilogue: '它回去，把那口吐它的地方砸平了。' },
  { char: 'mage', line: '元素法师读过记录，所以它一直在找第四片。', epilogue: '它找到的时候，手抖得读不下去。' },
  { char: 'engineer', line: '工程师修过钟。它知道钟为什么停。', epilogue: '它没修好它 —— 它把钟拆了，重新装成别的。' },
  { char: 'masochist', line: '受虐狂不疼。它只是想知道别人为什么疼。', epilogue: '它最后明白了，然后它开始疼了。' },
  { char: 'gladiator', line: '角斗士的观众早就死光了。它还在打给谁看。', epilogue: '它打给荒漠看。荒漠看了。' },
  { char: 'collector', line: '收藏家囤的不是东西，是别人的时间。', epilogue: '它把囤的都倒出来，还是不够抵它欠的。' },
  { char: 'sprinter', line: '疾行者跑得比菌毯快。这就是它全部的计划。', epilogue: '它跑了很久，回头时发现菌毯没有追。它在等。' },
  /* 隐藏角色的过去：它只在被发现之后才可能出现在这一页 */
  { char: 'mole', line: '掘进者是从墙里面敲出来的。它一直以为外面是墙的另一面。', epilogue: '它把最后一面墙也拆了，然后坐了很久。' }
];

/* =========================================================
   6. 结局事件：某个 Boss 掉哪一片、某个来源给哪几片
   ========================================================= */
var BOSS_FRAGMENT: Record<string, string> = {
  warden: 'f01', digger: 'f02', brood: 'f03', pendulum: 'f04'
};
/** 每个来源能给哪些碎片（事件房与深井是"多片池"，随机给一片没拿过的） */
var SOURCE_POOLS: Record<string, string[]> = {
  secret: ['f05', 'f06', 'f07', 'f08'],
  event: ['f09', 'f10'],
  deeppit: ['f11', 'f12']
};

/* =========================================================
   6b. 层间旁白（翻层时打在横幅上的那一句）
   ---------------------------------------------------------
   为什么要有它：房间制的层是**一局里最强的节奏信号**（BOOS 倒下 → 新的一层），
   如果那里只有一行"第 2 层"，玩家感受到的是"换了个贴图"。
   一句话 + 一句环境描写，成本极低，但把"往下走"这件事讲出来了。
   **不带条件**（旁白是环境音，不是剧情推进），所以它不会剧透任何东西。
   ========================================================= */
var NARRATION: StoryNarrationDef[] = [
  { floor: 1, text: '碎石浅层。风把菌毯的孢子吹进来了 —— 你已经在它里面。' },
  { floor: 2, text: '菌毯洞窟。地上那层软东西踩上去会响。它在听。' },
  { floor: 3, text: '熔渣裂谷。钟楼就在下面不远的某个地方，停着。' },
  { floor: 4, text: '深井。是你自己要下来的 —— 上面那些记录没让你来。' }
];

/** 这一层的旁白（没有就返回 null） */
Story.narration = function (floor) {
  var f = Math.max(1, Math.floor(Number(floor) || 1));
  for (var i = 0; i < NARRATION.length; i++) if (NARRATION[i].floor === f) return NARRATION[i].text;
  return null;
};

/* =========================================================
   7. 纯函数：条件判定 / 取可用台词 / 挑下一片碎片
   ========================================================= */
/** 条件是否满足（`ctx` 由接线层喂进来；这里只看数字与 flag） */
Story.match = function (when, ctx) {
  if (!when) return true;
  var c: any = ctx || {};
  var keys = ['runs', 'wins', 'floor', 'fragments', 'bosses', 'secrets', 'endings'];
  for (var i = 0; i < keys.length; i++) {
    var need = when[keys[i]];
    if (need === undefined) continue;
    if ((Number(c[keys[i]]) || 0) < Number(need)) return false;
  }
  if (when.flag && !(c.flags && c.flags[when.flag])) return false;
  return true;
};

/** 这一条台词现在能不能取到（`once` 的说过就不再出现） */
Story.lineAvailable = function (line, ctx, said) {
  if (!line || !Story.match(line.when, ctx)) return false;
  if (line.once && said && said[line.id]) return false;
  return true;
};

/** 某个 NPC 现在能说的台词（保持表里的顺序 —— 顺序就是"讲解的先后"） */
Story.linesFor = function (npcId, ctx, said) {
  var out = [];
  for (var i = 0; i < LINES.length; i++) {
    if (LINES[i].npc !== npcId) continue;
    if (Story.lineAvailable(LINES[i], ctx, said)) out.push(LINES[i]);
  }
  return out;
};

/** 枢纽里该出现哪些 NPC（没解锁的不出现，而不是灰着） */
Story.npcsFor = function (ctx) {
  var out = [];
  for (var i = 0; i < NPCS.length; i++) {
    if (Story.match(NPCS[i].unlock, ctx)) out.push(NPCS[i]);
  }
  return out;
};

/**
 * 枢纽里该出现哪些站点。
 * 设施站一直在；NPC 站跟着 NPC 的解锁条件走 —— 于是"屋里的人越站越多"
 * 和剧情进度是同一件事，不需要界面自己判断。
 */
Story.stationsFor = function (ctx) {
  var live: Record<string, boolean> = Object.create(null);
  var ns = Story.npcsFor(ctx);
  for (var i = 0; i < ns.length; i++) live[ns[i].id] = true;
  var out: StoryStationDef[] = [];
  for (var j = 0; j < STATIONS.length; j++) {
    if (STATIONS[j].npc && !live[STATIONS[j].npc]) continue;
    out.push(STATIONS[j]);
  }
  return out;
};

/** 有没有 NPC 想说新话（枢纽上那个"!"） */
Story.hasNews = function (ctx, said) {
  var list = Story.npcsFor(ctx);
  for (var i = 0; i < list.length; i++) {
    if (Story.linesFor(list[i].id, ctx, said).length) return true;
  }
  return false;
};

/** 已经解锁的结局（按 order 排） */
Story.endingsFor = function (ctx) {
  var out = [];
  for (var i = 0; i < ENDINGS.length; i++) {
    if (Story.match(ENDINGS[i].when, ctx)) out.push(ENDINGS[i]);
  }
  return out.sort(function (a, b) { return a.order - b.order; });
};

/**
 * 某个来源现在该给哪一片碎片。
 * @param have 已经拿到的碎片 id
 * @returns 碎片 id（没得给就 null）—— **不用随机**：按表里的顺序给下一片，
 *          这样"检查过的密室一定给东西"，而且回放/复算都不会因为对话而分叉。
 */
Story.fragmentFrom = function (source, have) {
  var haveMap: Record<string, boolean> = Object.create(null);
  for (var i = 0; i < (have || []).length; i++) haveMap[have[i]] = true;
  if (source && source.indexOf('boss:') === 0) {
    var boss = source.slice(5);
    var bid = BOSS_FRAGMENT[boss];
    return bid && !haveMap[bid] ? bid : null;
  }
  var pool = SOURCE_POOLS[source] || [];
  for (var j = 0; j < pool.length; j++) if (!haveMap[pool[j]]) return pool[j];
  return null;
};

Story.fragment = function (id) {
  for (var i = 0; i < FRAGMENTS.length; i++) if (FRAGMENTS[i].id === id) return FRAGMENTS[i];
  return null;
};

/** 一行行给人看（调试/图鉴共用） */
Story.describe = function () {
  var lines = ['剧情：' + NPCS.length + ' 位 NPC · ' + LINES.length + ' 条台词 · ' +
    FRAGMENTS.length + ' 片记录 · ' + ENDINGS.length + ' 个结局'];
  for (var i = 0; i < NPCS.length; i++) {
    var n = NPCS[i];
    var mine = LINES.filter(function (l) { return l.npc === n.id; }).length;
    lines.push('  ' + n.name + '（' + n.role + '）' + mine + ' 条');
  }
  return lines.join('\n');
};

/* =========================================================
   8. 自检
   ========================================================= */
Story.audit = function () {
  var problems = [];
  var seen: Record<string, boolean> = Object.create(null);
  var npcIds: Record<string, boolean> = Object.create(null);
  var i;
  for (i = 0; i < NPCS.length; i++) {
    if (npcIds[NPCS[i].id]) problems.push('NPC id 重复：' + NPCS[i].id);
    npcIds[NPCS[i].id] = true;
    if (!NPCS[i].name || !NPCS[i].role || !NPCS[i].note) problems.push(NPCS[i].id + ' 缺名字/职责/说明');
  }
  // 台词：id 唯一、归属真实、条件合法
  var i;
  for (i = 0; i < LINES.length; i++) {
    var l = LINES[i];
    if (seen[l.id]) problems.push('台词 id 重复：' + l.id);
    seen[l.id] = true;
    if (!npcIds[l.npc]) problems.push(l.id + ' 归属的 NPC 不存在：' + l.npc);
    if (!l.text || l.text.length < 4) problems.push(l.id + ' 的台词太短或为空');
    var wk = Object.keys(l.when || {});
    for (var w = 0; w < wk.length; w++) {
      if (['runs', 'wins', 'floor', 'fragments', 'bosses', 'secrets', 'endings', 'flag'].indexOf(wk[w]) < 0) {
        problems.push(l.id + ' 用了未知的条件键：' + wk[w]);
      }
    }
  }
  // **flag 必须声明**：写错一个字母，那条台词就永远取不到，而界面上毫无异常
  var flagUses = [];
  for (i = 0; i < LINES.length; i++) {
    if (LINES[i].when && LINES[i].when.flag) flagUses.push({ id: LINES[i].id, flag: LINES[i].when.flag });
  }
  for (i = 0; i < ENDINGS.length; i++) {
    if (ENDINGS[i].when && ENDINGS[i].when.flag) flagUses.push({ id: ENDINGS[i].id, flag: ENDINGS[i].when.flag });
  }
  for (i = 0; i < flagUses.length; i++) {
    if (!FLAGS[flagUses[i].flag]) {
      problems.push(flagUses[i].id + ' 用了未声明的 flag：' + flagUses[i].flag + '（这条台词将永远取不到）');
    }
  }
  // 每个声明过的 flag 至少被一条台词用上（声明了却没人用 = 白声明）
  for (var fk in FLAGS) {
    if (!Object.prototype.hasOwnProperty.call(FLAGS, fk)) continue;
    if (!flagUses.some(function (u) { return u.flag === fk; })) {
      problems.push('flag ' + fk + ' 声明了却没有任何台词用它');
    }
  }
  // **不许剧透**：每条 `once` 台词都必须带条件，否则第一次进城就全说完了
  var noCond = LINES.filter(function (x) { return x.once && !Object.keys(x.when || {}).length; });
  if (noCond.length > 2) {
    problems.push('太多无条件台词（' + noCond.length + ' 条）：枢纽的对话要有进度感');
  }
  // 每个 NPC 至少有一条台词（否则他站在那儿不说话）
  for (i = 0; i < NPCS.length; i++) {
    if (!LINES.some(function (x) { return x.npc === NPCS[i].id; })) {
      problems.push(NPCS[i].id + ' 一条台词都没有');
    }
  }
  // 碎片：id 唯一、来源合法、12 片都有主
  var fids: Record<string, boolean> = Object.create(null);
  var froms: Record<string, number> = Object.create(null);
  for (i = 0; i < FRAGMENTS.length; i++) {
    var f = FRAGMENTS[i];
    if (fids[f.id]) problems.push('碎片 id 重复：' + f.id);
    fids[f.id] = true;
    if (!f.title || !f.text) problems.push(f.id + ' 缺标题或正文');
    froms[f.from] = (froms[f.from] || 0) + 1;
  }
  if (FRAGMENTS.length < 12) problems.push('碎片太少（' + FRAGMENTS.length + '）：拼不出一个世界观');
  // 每个来源池里的碎片都真实存在
  var pools: string[] = Object.keys(SOURCE_POOLS).concat(['boss:warden', 'boss:digger', 'boss:brood', 'boss:pendulum']);
  for (i = 0; i < pools.length; i++) {
    var p = pools[i];
    var pool = p.indexOf('boss:') === 0 ? [BOSS_FRAGMENT[p.slice(5)]] : SOURCE_POOLS[p];
    if (!pool) { problems.push('来源没有池子：' + p); continue; }
    for (var q = 0; q < pool.length; q++) {
      if (!fids[pool[q]]) problems.push(p + ' 指向不存在的碎片：' + pool[q]);
    }
  }
  // 结局：条件必须够得着（wins 之类的数字不能超过游戏能给的量）
  for (i = 0; i < ENDINGS.length; i++) {
    var e = ENDINGS[i];
    if (!e.name || !e.text) problems.push(e.id + ' 缺名字或正文');
    var w2 = e.when || {};
    if ((Number(w2.fragments) || 0) > FRAGMENTS.length) {
      problems.push(e.id + ' 要求的碎片数超过总数（' + w2.fragments + ' > ' + FRAGMENTS.length + '）');
    }
    if ((Number(w2.bosses) || 0) > 4) problems.push(e.id + ' 要求的 Boss 数超过游戏里的数量');
  }
  if (!ENDINGS.some(function (x) { return x.secret; })) {
    problems.push('没有隐藏结局 —— 剧情也该有"藏起来的那一层"');
  }
  // 角色过去：角色 id 必须真实
  for (i = 0; i < PASTS.length; i++) {
    if (!PASTS[i].line || !PASTS[i].epilogue) problems.push(PASTS[i].char + ' 的过去缺正文或尾声');
  }
  /* 站点：id 唯一、引用的 NPC 存在、"说话站"与"设施站"各自完整。
     `screen` 指向的状态名由总账查（story.ts 不认识状态机）。 */
  var sids: Record<string, boolean> = Object.create(null);
  for (i = 0; i < STATIONS.length; i++) {
    var st = STATIONS[i];
    if (sids[st.id]) problems.push('枢纽站点 id 重复：' + st.id);
    sids[st.id] = true;
    if (!st.name || !st.role) problems.push('枢纽站点 ' + st.id + ' 缺名字或职能');
    if (st.npc && !npcIds[st.npc]) problems.push('枢纽站点 ' + st.id + ' 站的 NPC 不存在：' + st.npc);
    if (!st.npc && !st.screen) problems.push('枢纽站点 ' + st.id + ' 既不说话也不通向任何界面（走上去什么都不会发生）');
  }
  // 每位 NPC 都要在屋里有个位置（否则这个人永远见不到）
  for (i = 0; i < NPCS.length; i++) {
    if (!STATIONS.some(function (x) { return x.npc === NPCS[i].id; })) {
      problems.push(NPCS[i].id + ' 在枢纽里没有站点（他到不了玩家面前）');
    }
  }
  // 一个 NPC 至多一个站点（同一张脸在屋里站两处，看着像 bug）
  for (i = 0; i < NPCS.length; i++) {
    var cnt = STATIONS.filter(function (x) { return x.npc === NPCS[i].id; }).length;
    if (cnt > 1) problems.push(NPCS[i].id + ' 在枢纽里有 ' + cnt + ' 个站点');
  }
  return {
    ok: problems.length === 0, problems: problems,
    counts: {
      npcs: NPCS.length, lines: LINES.length, fragments: FRAGMENTS.length,
      endings: ENDINGS.length, pasts: PASTS.length, stations: STATIONS.length
    }
  };
};

Story.NPCS = NPCS;
Story.STATIONS = STATIONS;
Story.LINES = LINES;
Story.FLAGS = FLAGS;
Story.FRAGMENTS = FRAGMENTS;
Story.ENDINGS = ENDINGS;
Story.PASTS = PASTS;
Story.NARRATION = NARRATION;
Story.BOSS_FRAGMENT = BOSS_FRAGMENT;
Story.SOURCE_POOLS = SOURCE_POOLS;

SelfCheck.register('Story', Story.audit);

/* =========================================================
   9. 登记进扩展点总账
   ========================================================= */
Registry.family('storyNpc', {
  note: '枢纽 NPC（各对应一个已有设施）', owner: 'story.ts',
  values: function () { return NPCS.map(function (n) { return n.id; }); }
});
/* 枢纽站点：**表里每一站都要画得出来**（头像 id 就是站点 id），
   通向的界面必须是真实存在的状态 —— 这两条以前只能靠人肉对照。 */
Registry.family('hubStation', {
  note: '枢纽站点（屋里站着的人与摆着的设施）', owner: 'story.ts',
  entries: function () {
    return STATIONS.map(function (s) {
      return {
        id: s.id,
        refs: [
          { field: 'npc', value: s.npc, family: 'storyNpc' },
          { field: 'screen', value: s.screen, family: 'state' }
        ]
      };
    });
  }
});
Registry.family('storyEnding', {
  note: '结局（可解锁的收藏，含一个隐藏结局）', owner: 'story.ts',
  values: function () { return ENDINGS.map(function (e) { return e.id; }); }
});
Registry.family('storySource', {
  note: '碎片的来源（密室 / 事件 / Boss / 深井）', owner: 'story.ts',
  values: function () {
    return Object.keys(SOURCE_POOLS).concat(Object.keys(BOSS_FRAGMENT).map(function (b) { return 'boss:' + b; }));
  }
});
Registry.family('storyFlag', {
  note: '剧情 flag（台词条件里能用的布尔量；拼错一个字母台词就永远取不到）', owner: 'story.ts',
  values: function () { return Object.keys(FLAGS); }
});

export { Story };
