/* =========================================================
   record.ts — 输入录制与回放（引擎里的 demo / replay）
   ---------------------------------------------------------
   前提：模拟层已经是确定性的（固定 dt、种子化随机、行为指纹守着）。
   所以"回放"不需要存世界状态，只需要两样：
     1) **离散命令**：newRun / chooseLevelCard / nextWave / buyOffer / sellWeapon …
     2) **逐帧输入**：每逻辑帧的移动向量
   回放就是"按帧号把同样的命令与输入重新喂一遍"，结果必须逐位一致。

   实现上有两个必须处理的坑：
     · `Game.newRun(char)` 不传种子时**自己随机**一个 —— 录制时必须记下**落定后的种子**，
       回放时显式传回去，否则第一帧就分叉。
     · 命令是玩家在任意时刻点的（选卡、商店、暂停），所以要按**逻辑帧号**记录，
       回放时在对应帧把命令重放，再推进该帧。

   为什么不用"改 Game 的每个方法"：那样侵入太强。这里用一层薄薄的**包装**（wrapCommand），
   在模块加载后把几个状态变更方法包一遍 —— 调用点一行都不用改。
   ========================================================= */

import { Game } from './game.ts';

var Rec = {} as RecApi;

/** 会被录制的命令（只列**改变一局状态**的；纯查询不录） */
var COMMANDS = [
  'newRun', 'setState', 'chooseLevelCard', 'nextWave',
  'buyOffer', 'sellWeapon', 'reroll', 'toggleLock', 'buyPack',
  /* 合成：它**改变一局的装备**（两把变一把、档位抬高），所以必须进带子 ——
     漏了它的表现是"回放里武器比原局少一把、品级也低一档"，
     而成绩码承诺的是"可离线复算"。合成是纯函数式的（combine(i,j) 只看槽位号），
     所以它和 buyOffer 一样是安全可重放的命令。 */
  'combine',
  /* 制造：经营那一侧的主行动。它花材料、把装备放进武器栏/道具栏，
     而且**消耗一条产线的一波** —— 漏了它，回放里会少一件装备、
     而且产线状态与原局不一致（后面每一次制造的落点都会错开）。 */
  'craft',
  // 营地的进出也要录：campBuy 要求"当前在营地"，不录 openCamp 的话
  // 回放时状态还停在商店，建设会被状态校验拒掉 —— 整段营地都静默消失。
  'openCamp', 'campBuy', 'campSell',
  // 地牢：走门、自动探索也是会改一局的命令。
  // **注意**：模拟层自己触发的走门（玩家走进门口）走的是内部函数，不在这里 ——
  // 那条路径由逐帧输入重放出来，录进来反而会重复换房。
  'enterRoom', 'autoExplore',
  /* 层间契约：**不可撤销**，而且它折出三组修正、当场重算属性。
     漏了这一条时，带子里只剩 newRun/setState ——
     回放出来的局"契约是空的"，成绩码承诺的"可离线复算"在打过 Boss 的局上就是假的
     （实测：原局 boon=bounty，回放 boon=空）。任何到过第 2 层的局都会踩。 */
  'pickBoon'
];

var rec = false;
var replaying = false;
var events: RecEvent[] = [];
var inputs: number[][] = [];
var seedOfRun = 0;
var wrapped = false;
var t0 = 0;
/**
 * 命令的嵌套深度。**只记最外层那一条** —— 这是一个真 bug 的修法：
 *
 * `nextWave()` 内部会 `Game.setState('playing')`，而 setState 也是被录的命令，
 * 于是带子里出现两条：`setState(playing)` 与 `nextWave`，而且顺序是
 * "setState 在前（它是 nextWave 执行到一半时记下的）、nextWave 在后"。
 * 回放时先执行 setState(playing)，`nextWave` 就**不再满足"必须在 shop/camp"**
 * 而被状态校验拒掉 —— 表现是**回放永远卡在原来那一波**。
 * 因为玩家的真实操作（点"下一波"）发生在每一次进商店之后，
 * 这意味着任何进过商店的带子都回放不出来，成绩码的"可离线复算"对完整局是失效的。
 * 测试没抓到它，是因为既有那条回放用例活得太短、从没走到商店。
 *
 * 修法不是给 nextWave 开后门（那只是掩盖），而是：**嵌套里产生的那次状态变更
 * 不该被当成玩家的独立命令**。所以深度 > 0 时不记录。
 */
var depth = 0;

/** 给 Game 上的命令套一层记录（只做一次） */
function wrapCommands() {
  if (wrapped) return;
  wrapped = true;
  for (var i = 0; i < COMMANDS.length; i++) {
    (function (name) {
      var fn = Game[name];
      if (typeof fn !== 'function') return;
      Game[name] = function () {
        var args = Array.prototype.slice.call(arguments);
        depth++;
        var r = fn.apply(Game, arguments);
        depth--;
        if (rec && depth === 0) {
          // newRun 的种子：调用后从会话里读回来（不传种子时是随机的）
          var sess = Game.getSession();
          if (name === 'newRun' && sess && sess.seed !== undefined) seedOfRun = sess.seed;
          events.push({ frame: t0, cmd: name, args: args, seed: seedOfRun });
        }
        return r;
      };
    })(COMMANDS[i]);
  }
}

/* =========================================================
   录制
   ========================================================= */
Rec.start = function () {
  wrapCommands();
  rec = true;
  events = [];
  inputs = [];
  t0 = 0;
  seedOfRun = 0;
  return true;
};
Rec.stop = function () { rec = false; return Rec.tape(); };
Rec.isRecording = function () { return rec; };

/** 每逻辑帧调一次：记下这一帧的输入（顺序即帧号） */
Rec.input = function (input) {
  if (!rec) return;
  inputs.push([input && input.x ? input.x : 0, input && input.y ? input.y : 0]);
  t0++;
};

/** 一份可序列化的"带子" */
Rec.tape = function () {
  return {
    v: 1,
    frames: inputs.length,
    seed: seedOfRun,
    events: events.map(function (e) { return { frame: e.frame, cmd: e.cmd, args: e.args, seed: e.seed }; }),
    inputs: inputs.map(function (p) { return [p[0], p[1]]; })
  };
};

/**
 * 给 newRun 重新拼参数：保留角色，**换成落定后的种子**，其余参数原样带着。
 *
 * 这里是"新增一个参数就静默出错"的高发点：只补种子的写法会在回放时
 * 丢掉后面的参数（已经踩过两次 —— 难度 args[2]、开局条件 args[3]），
 * 于是回放跑的是**另一个配置的对局**，而"逐位一致"看起来还成立。
 * 所以不逐个列举，而是整份拷过来只改种子。
 */
function reissueNewRun(args, seed) {
  var out = args.slice();
  out[1] = seed;
  return out;
}

/* =========================================================
   回放
   ========================================================= */
/**
 * 按带子重放一局。
 * @param tape   Rec.tape() 的产物
 * @param step   推进一逻辑帧的函数（默认 Game.step + 场景闸门），签名 (dt, input) => void
 * @returns 是否完整重放
 */
Rec.play = function (tape, step) {
  if (!tape || tape.v !== 1) throw new Error('record: 不认识的带子版本');
  // 回放期间必须停掉录制（否则包装层会把"回放的命令"再记一遍）
  var wasRec = rec;
  rec = false;
  // 回放会真的推进模拟，于是**一局正常结束时会触发 gameOver**。
  // 接入层（main.ts）靠这个标记判断"这是一次回放，不是玩家在打"，
  // 否则按 L 放一遍录像就会往战绩与账号档案里写一局假数据。
  replaying = true;
  var evs = tape.events.slice().sort(function (a, b) { return a.frame - b.frame; });
  var ei = 0;

  for (var f = 0; f < tape.frames; f++) {
    // 这一帧之前要重放的命令
    while (ei < evs.length && evs[ei].frame <= f) {
      var ev = evs[ei++];
      var args = ev.args.slice();
      // 种子：newRun 显式传回落定后的种子，保证随机序列一致。
      // **第三个参数（难度）必须原样带着** —— 只补种子会静默把它丢掉，
      // 于是高难度的带子回放成第 0 级，逐位一致就成了假象。
      if (ev.cmd === 'newRun' && ev.seed) args = reissueNewRun(args, ev.seed);
      var fn = Game[ev.cmd];
      if (typeof fn === 'function') fn.apply(Game, args);
    }
    var p = tape.inputs[f] || [0, 0];
    step(p[0], p[1], f);
  }
  // 收尾：帧号之后还有命令（比如最后一帧的结算）也要重放
  while (ei < evs.length) {
    var ev2 = evs[ei++];
    var a2 = ev2.args.slice();
    if (ev2.cmd === 'newRun' && ev2.seed) a2 = reissueNewRun(a2, ev2.seed);
    var fn2 = Game[ev2.cmd];
    if (typeof fn2 === 'function') fn2.apply(Game, a2);
  }
  rec = wasRec;
  replaying = false;
  return true;
};

/** 正在回放？接入层用它决定"这一局的结束要不要落账" */
Rec.replaying = function () { return replaying; };

Rec.stats = function () {
  return { recording: rec, replaying: replaying, frames: inputs.length, events: events.length, seed: seedOfRun };
};

/** 会被录制的命令清单（只读；测试用它验"会改一局状态的命令一条都没漏"） */
Rec.commands = function () { return COMMANDS.slice(); };

export { Rec };
