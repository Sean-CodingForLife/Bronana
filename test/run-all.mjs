/* =========================================================
   run-all.mjs — 依次执行全部无头测试
   用法： node test/run-all.mjs
   ========================================================= */

import { spawnSync } from 'node:child_process';
import path from 'node:path';

const SUITES = [
  ['模拟层 / 战斗循环', 'smoke.mjs'],
  ['扩展点总账 / 跨表引用', 'registry.mjs'],
  ['数据契约 / 字段→家族 · 值域 · 未读字段', 'data-contract.mjs'],
  ['货币与循环 / 战斗·经营·养成三模块', 'economy.mjs'],
  ['数值曲线 / 角色与怪物的成长表', 'curves.mjs'],
  ['容器与对象管理 / 回收与上限', 'containers.mjs'],
  ['调试工具 / 存档迁移 · 录制回放 · 诊断面板', 'debug.mjs'],
  ['怪物行为 / 弹幕模式注册表', 'ai.mjs'],
  ['组件系统 / 组合与校验', 'comp.mjs'],
  ['骨架系统 / 骨头·部件·几何等价', 'rig.mjs'],
  ['碰撞体 / 帧模型 / 插值', 'frames.mjs'],
  ['三种运行形态 / web·cli·desktop', 'modes.mjs'],
  ['地牢地图 / 随机楼层与隐藏要素', 'dungeon.mjs'],
  ['房间接进对局 / 门·房型内容·暗门墙·翻层·存档', 'rooms.mjs'],
  ['随机 Boss 池 / 四种应对方式', 'boss.mjs'],
  ['深度层 / 限时房·层间契约·隐藏要素', 'g5.mjs'],
  ['剧情 / 枢纽对话·碎片·结局', 'story.mjs'],
  ['剧情接线 / 档案⇄剧情表⇄枢纽', 'hub.mjs'],
  ['武器联动 / 家族与四条轴', 'synergy.mjs'],
  ['词条 / 前缀后缀·档位·折叠·存档', 'affixes.mjs'],
  ['美术资源体系 / 规范·瓦片·自动规则·着色器·归属', 'art.mjs'],
  ['背景音乐与错误兜底 / 曲目表·场景映射·崩溃卡', 'audio.mjs'],
  ['武器合成 / 品级台阶与买武器的落位规则', 'combine.mjs'],
  ['制造 / 配方·费用·档位门槛·产线', 'craft.mjs'],
  ['全局状态 / 设置 / 存档', 'persist.mjs'],
  ['账号档案 / 挑战 / 局外成长', 'profile.mjs'],
  ['难度阶梯 / 通关条件 / 每角色进度', 'danger.mjs'],
  ['每日挑战 / 成绩码可复算', 'daily.mjs'],
  ['离线产出 / 每周挑战（附加内容）', 'extras.mjs'],
  ['角色天赋树 / 只改开局条件', 'talents.mjs'],
  ['局内营地 / 模拟经营第一级', 'camp.mjs'],
  ['跨局据点 / 两条循环互供', 'keep.mjs'],
  ['图纸工坊 / 合金·合成链的局外出口', 'forge.mjs'],
  ['状态机 / 转换表与守卫', 'states.mjs'],
  ['信号总线 / 异常隔离与重入', 'signals.mjs'],
  ['粒子发生器 / 对象池', 'particles.mjs'],
  ['随机道具包 / 定价与概率', 'packs.mjs'],
  ['本地化（文案表 / 切换 / 缺键）', 'i18n.mjs'],
  ['存档槽位（备份回退 / 导出导入）', 'slots.mjs'],
  ['首局引导（时机 / 只说一次 / 落盘）', 'tutorial.mjs'],
  ['道具的取舍 / 有得有失·代价轴·接线', 'items.mjs'],
  ['渲染层 / 美术宪法 / 绘制预算', 'render-check.mjs'],
  ['Z 深度 / 层带与 y 排序', 'depth.mjs'],
  ['缓存 / 烘焙倍率 / 条目收敛', 'cache.mjs'],
  ['界面层 / DOM 流程', 'ui-check.mjs'],
  ['架构 / 系统分层与依赖方向', 'arch.mjs'],
  ['输入层 / 键鼠·手柄·触摸', 'input.mjs'],
  ['性能基准 / 帧预算', 'perf.mjs']
];

let failed = 0;
for (const [label, file] of SUITES) {
  const r = spawnSync(process.execPath, [path.join(import.meta.dirname, file)], { stdio: 'inherit' });
  if (r.status !== 0) { failed++; console.log('\x1b[31m套件失败：' + label + '\x1b[0m\n'); }
}

console.log('=========================================');
if (failed === 0) {
  console.log('\x1b[32m全部 ' + SUITES.length + ' 套测试通过 ✔\x1b[0m');
  process.exit(0);
} else {
  console.log('\x1b[31m' + failed + ' 套测试失败 ✘\x1b[0m');
  process.exit(1);
}
