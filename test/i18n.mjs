/* =========================================================
   i18n.mjs — 本地化：文案表 · 切换 · 缺键可查
   ---------------------------------------------------------
   这一套守四件事，每一件都对着一个**真实的静默故障**：
     · 切了语言但界面没变（`applyDom` 没接上）
     · 翻译漏了一句，界面上显示中文，而**没人知道**（缺键要能数出来）
     · 语言名被"翻译"了，于是只会中文的玩家在英文界面里找不回中文
     · 不认识的语言 id 被静默接受（表现是整屏缺译文，而不知道该改哪）
   ========================================================= */
import { installDom, makeDomEl } from './_ctx.mjs';
import { loadAll, UI_MODULES } from './_load.mjs';

installDom();
await loadAll(UI_MODULES);
const { I18n, Settings, Storage, Registry, SelfCheck } = globalThis;

let pass = 0, fail = 0;
function ok(cond, what, detail) {
  if (cond) { pass++; console.log('  PASS ' + what); }
  else { fail++; console.log('  FAIL ' + what + (detail === undefined ? '' : '  → ' + detail)); }
}

console.log('\n=== Bronana · 本地化 ===\n');

/* ---------------- [1] 语言表 ---------------- */
console.log('[1] 语言表');
{
  ok(I18n.LOCALES.length >= 2, '至少两种语言（只有一种就谈不上"切换"）', I18n.LOCALES.length);
  const ids = I18n.LOCALES.map(l => l.id);
  ok(new Set(ids).size === ids.length, '语言 id 不重复', ids.join(','));
  ok(I18n.has('zh') && I18n.has('en'), '中英都在清单里');
  const def = I18n.LOCALES.filter(l => l.default);
  ok(def.length === 1, '恰好一个默认语言', def.map(l => l.id).join(','));
  ok(I18n.DEFAULT === 'zh', '默认是中文（键就是中文原文）', I18n.DEFAULT);
  /* 语言名必须是**母语**：一个只懂中文的玩家要能在英文界面里找回中文 */
  const zh = I18n.LOCALES.find(l => l.id === 'zh');
  ok(/[\u4e00-\u9fff]/.test(zh.name), '语言名用母语写（简体中文 用的是汉字）', zh.name);
  ok(zh.name !== I18n.t(zh.name) || I18n.current() !== 'en', '语言名不被当前语言翻译（英文界面里仍显示「简体中文」）');
  ok(I18n.audit().ok, '定义期自检通过', JSON.stringify(I18n.audit().problems));
}

/* ---------------- [2] 取译文与回退 ---------------- */
console.log('\n[2] 取译文与缺键回退');
{
  I18n.set('zh');
  ok(I18n.t('开 始 游 戏') === '开 始 游 戏', '默认语言：键就是原文（中文表可以是空的）', I18n.t('开 始 游 戏'));
  I18n.set('en');
  ok(I18n.t('开 始 游 戏') === 'START', '英文：查到表里的译文', I18n.t('开 始 游 戏'));
  /* 缺键回退到**原文**（也就是中文），而不是空白或键名本身 ——
     半翻译的界面里，一句中文远好过一句 `menu.start`。 */
  const missingKey = '这句故意不在表里';
  ok(I18n.t(missingKey) === missingKey, '缺键回退到键本身（不返回空串、不抛）', I18n.t(missingKey));
  ok(I18n.t('') === '', '空键返回空串（不炸）');
  ok(I18n.t(null) === '', 'null 键返回空串（不炸）');
  ok(I18n.t('第 {n} 波 · {who}', { n: 3, who: '豆豆' }) === '第 3 波 · 豆豆', '插值替换全部占位符');
  ok(I18n.t('第 {n} 波', {}) === '第 {n} 波', '没给变量时占位符原样留着（不是 undefined）');
}

/* ---------------- [3] 切换 ---------------- */
console.log('\n[3] 切换语言');
{
  I18n.set('zh');
  ok(I18n.current() === 'zh', '切到中文生效');
  ok(I18n.set('en') === true, '切到英文返回 true');
  ok(I18n.current() === 'en', '当前语言真的变了');
  /* 不认识的 id **必须拒绝**：静默接受的表现是整屏缺译文，而不知道该改哪 */
  ok(I18n.set('jp') === false, '不认识的语言 id 被拒绝', I18n.current());
  ok(I18n.current() === 'en', '拒绝之后当前语言保持原样（没有静默变成英语或默认）');
  I18n.set('zh');
}

/* ---------------- [4] DOM 绑定与应用 ---------------- */
console.log('\n[4] DOM 绑定与应用');
{
  const wrap = makeDomEl('div');
  const btn = makeDomEl('button');
  btn.textContent = '开 始 游 戏';           // 表里有的键
  const num = makeDomEl('span');
  num.textContent = '42';                    // 表里没有：不该被绑定
  wrap.appendChild(btn); wrap.appendChild(num);

  const bound = I18n.bindDom(wrap);
  ok(bound === 1, '只绑定表里认得的那一条（数字不会被当文案）', bound);
  ok(btn._i18nKey === '开 始 游 戏', '绑定记下的是**原文**（之后切语言靠它）', btn._i18nKey);
  ok(num._i18nKey === undefined, '表外的文本不会被绑定', String(num._i18nKey));

  /* ⚠ 生产路径是 `I18n.set(id)` → 重写整个 `document`；测试里把范围收窄到这一棵子树，
     否则断言的是"真页面上有没有变"，而桩里根本没有真页面 ——
     那种测试会因为环境而红，然后被人加一个 `if` 跳过去。 */
  I18n.set('en', wrap);
  ok(btn.textContent === 'START', '切到英文后节点文本真的变了', btn.textContent);
  ok(num.textContent === '42', '没绑定的节点不受影响', num.textContent);
  I18n.set('zh', wrap);
  ok(btn.textContent === '开 始 游 戏', '切回中文后回到原文（可逆）', btn.textContent);

  /* 重复绑定不能把英文当成新键 —— 那会让切回中文失败 */
  I18n.set('en', wrap);
  I18n.bindDom(wrap);
  I18n.set('zh', wrap);
  ok(btn.textContent === '开 始 游 戏', '绑定是幂等的（切到英文再绑一次，仍能切回中文）', btn.textContent);

  /* 显式 data-i18n：用在"元素里混了子节点"的场合（那种结构反推不出原文） */
  const mixed = makeDomEl('div');
  mixed.textContent = '随机文案';
  if (mixed.setAttribute) mixed.setAttribute('data-i18n', '开 始 游 戏');
  I18n.bindDom(mixed);
  I18n.set('en', mixed);
  ok(mixed.textContent === 'START', 'data-i18n 显式标键的节点也会被翻译', mixed.textContent);
  I18n.set('zh', mixed);
}

/* ---------------- [5] 覆盖率与缺键清单 ---------------- */
console.log('\n[5] 覆盖率（诚实口径：没有该语言译文的条数）');
{
  const zh = I18n.coverage('zh');
  ok(zh.missing === 0 && zh.ratio === 1, '默认语言结构上全覆盖（键就是原文）',
    JSON.stringify(zh));
  const en = I18n.coverage('en');
  ok(en.total > 0, '英文表里有键', en.total);
  ok(en.translated + en.missing === en.total, '译 + 缺 = 总数（口径自洽）',
    en.translated + '+' + en.missing + '=' + en.total);
  ok(en.missing === 0, '英文表当前**没有**缺键（这一轮填满了）', I18n.missingKeys('en').join(','));
  ok(I18n.missingKeys('zh').length === 0, '默认语言没有"缺键"这个概念', String(I18n.missingKeys('zh').length));
  /* 覆盖率是**对外可读的数字**，它必须真的随表动 */
  const before = I18n.coverage('en').total;
  ok(typeof before === 'number' && before > 20, '覆盖率报的总数是真数字', before);
}

/* ---------------- [6] 与设置表接入 ---------------- */
console.log('\n[6] 与设置表接入');
{
  const def = Settings.def('locale');
  ok(!!def, '设置表里有 locale 这一项');
  ok(def.type === 'string', 'locale 是 string 型（它只收 options 里列出的值）', def.type);
  ok(Array.isArray(def.options) && def.options.length >= 2, 'locale 的合法取值来自 options', JSON.stringify(def.options));
  ok(def.options.every(o => I18n.has(o)), 'options 里每个 id 都是真实存在的语言（否则存下去就是"整屏缺译文"）',
    JSON.stringify(def.options));

  // 非法值被拒绝（不是夹回）
  let threw = false;
  try { Settings.set('locale', 'jp'); } catch (e) { threw = true; }
  ok(threw, '往设置里写不认识的语言 id 会被拒绝并抛（不静默存下去）');

  Settings.set('locale', 'en');
  ok(Settings.get('locale') === 'en', '写合法语言 id 生效');
  Settings.set('locale', 'zh');
  ok(Settings.get('locale') === 'zh', '切回来也生效');

  // 表里的每一项都能在总账里被查到（家族声明）
  const fam = Registry.ids('locale');
  ok(fam.length === I18n.LOCALES.length, '总账里的语言数与语言表一致', fam.length);
  ok(SelfCheck.names().indexOf('I18n') >= 0, 'i18n 的自检登记进了启动期自检', SelfCheck.names().join(','));
}

console.log('\n=== 结果 ===');
console.log('  ' + pass + ' 通过 · ' + (fail ? fail + ' \x1b[31m失败\x1b[0m' : '0 失败'));
console.log(fail ? '\n本地化未通过 ✘\n' : '\n本地化检查通过 ✔\n');
process.exit(fail ? 1 : 0);
