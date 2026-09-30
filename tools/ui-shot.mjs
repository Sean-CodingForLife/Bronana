/* =========================================================
   tools/ui-shot.mjs — 界面"实机量尺"：离线渲染 + 逐屏截图 + 布局体检

   为什么需要它：界面问题（比例不对、文字被挤成竖排、面板超出视口）**看不见就修不好**。
   无头 DOM 桩能验证"元素在不在、类名对不对"，但量不出"这一屏到底多高、哪一行被裁了"。
   所以这里用 Electron 的**离屏渲染**（offscreen，show:false）真跑一次页面：
     · 不显示窗口（不打扰任何人，也没有"GUI 被打开"这回事）
     · 每个屏幕截一张 PNG（可以直接看图）
     · 同时回收每个元素的 getBoundingClientRect / scrollHeight 与"被裁掉的文字"清单

   用法：
     node_modules/electron/dist/electron.exe tools/ui-shot.mjs --sizes=1280x720,1600x900
     （先 pnpm run build，它量的是 dist/ 里那份构建产物）

   产出：ui-shots/<屏>-<宽>x<高>.png 与 ui-shots/report.json
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import { startTsServer } from './ui-serve.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

function arg(name, def) {
  const hit = process.argv.find(a => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : def;
}

/* 默认量**源码**那一份（.ts 现转，改了立刻看得见）；--dist=dist 则量构建产物 */
const DIST = arg('dist', '');
const SERVED = DIST ? path.resolve(ROOT, DIST) : ROOT;
const OUT = path.resolve(ROOT, arg('out', 'ui-shots'));
/* Windows 上 electron.exe 是 GUI 子系统程序，stdout 不接控制台 —— 
   所以日志一律写文件（否则跑挂了什么都看不到） */
const LOG = [];
function log(line) { LOG.push(line); try { console.log(line); } catch (e) { /* 没有控制台 */ } }
function flush() {
  try { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'run.log'), LOG.join('\n') + '\n'); }
  catch (e) { /* 连日志都写不了就只能放弃 */ }
}
log('# ui-shot 启动 ' + new Date().toISOString());
log('# 量的是 ' + SERVED);
flush();
const SIZES = arg('sizes', '1280x720').split(',').map(s => s.split('x').map(Number));
/* 每一屏怎么到达：从标题页开始按 data-act 点（`a>b` 表示连着点两下）。
   `-` 表示"停在标题页"。 */
const SHOTS = arg('shots',
  'title:-,chars:start,station:start>confirm-char,hub:hub,codex:codex,settings:settings,keep:keep,' +
  'records:records,howto:howto,talents:start>talents,' +
  // 开局先落**大厅（站）**：三个模块都在局内的一张图上，先过一道门才进战斗。
  // querySelector 命中的是第一道门（出击门 → playing）；它的入口间是安全房、
  // 一步就清完 → 点完门等一会儿自己就进了商店；
  // 暂停则用触屏那个按钮（鼠标设备上它是 display:none，但 .click() 照样派发）
  'shop:start>confirm-char>station-gate,pause:start>confirm-char>station-gate>pause,' +
  // 剩下几屏要用 main.ts 的 ?test= 钩子（它们没有"从标题点进去"的路径）
  'camp:start>confirm-char>station-gate>camp,levelup:?test=levelup,end:start>confirm-char>station-gate>pause>quit>quit,' +
  'daily:?daily=1,pick:?test=demo,play:?test=play,hud:?test=play>next-wave,' +
  // 合成屏：一局里摆出"可合成的一对 + 几个不同品级"（按钮与色条只在有合成对象时出现，
  // 满配演示的六把不同武器永远拍不到它们）
  'combine:?test=combine').split(',');
/* 可选的裁剪区（x,y,w,h，CSS 像素）：只看某一处细节时用 */
const CROP = (arg('crop', '') || '').split(',').map(Number).filter(n => !Number.isNaN(n));
const CROPRECT = CROP.length === 4 ? CROP : null;
/* --pokes=1：把每一屏上的每个 data-act 都点一遍（每个动作从干净状态重来），
   记下"按了没反应 / 一按就抛"。这是找界面 bug 最直接的一条。 */
const POKES = arg('pokes', '') === '1';
/* --toastbottom=N：临时把 toast 抬到 N px（用来**量**哪个位置压得最少，而不是拍脑袋） */
const TOASTBOTTOM = arg('toastbottom', '') === '' ? null : Number(arg('toastbottom', ''));
/* --dump=<选择器>：把命中的元素逐层打出来（盒子 + 文字）。
   几何检查只能回答"看起来对不对"，回答不了"这个子节点到底有没有被建出来" ——
   "我的武器"卡片那次就是靠它才分清"被压扁"和"根本没 append"。 */
const DUMP = arg('dump', '');
let pokeFail = 0;
const pokes = [];

app.disableHardwareAcceleration();          // 无头机器上别指望 GPU
app.commandLine.appendSwitch('force-device-scale-factor', '1');

/* 量尺脚本：在页面里跑，回答"这一屏装得下吗、哪块被裁了/被压扁了" */
const PROBE = `(() => {
  const box = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return {
      x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height),
      bottom: Math.round(b.bottom), right: Math.round(b.right),
      scrollH: el.scrollHeight, clientH: el.clientHeight,
      overY: el.scrollHeight > el.clientHeight + 1,
      overX: el.scrollWidth > el.clientWidth + 1
    };
  };
  /* 渲染出来的**文本**里有没有不该出现的东西：
     undefined / NaN / null / [object Object] / 残留 markdown ——
     这类 bug 不影响任何几何检查，但玩家一眼就能看见。 */
  const SUSPECT = /undefined|NaN|\\[object |\\*\\*|Infinity/;
  const act = document.querySelector('.screen.active');
  const out = { vw: innerWidth, vh: innerHeight, docH: document.documentElement.scrollHeight,
    screen: act ? act.id : null, panels: [], beyond: [], clipped: [], squeezed: [], overlaps: [], spill: [],
    crushed: [], badText: [], uiText: [], hudText: {} };
  /* HUD / 小地图 / 武器条 / 关底血条 / toast **不在 .screen 里**（它们是 #ui 下的兄弟节点），
     而且 playing 状态**没有覆盖层** —— 恰恰是最该看的那一屏。
     所以这一段在"有没有 act"两条路径上都要跑。（注意：PROBE 本身是模板字符串，
     里面不能出现反引号，注释里也不行。） */
  const snapshotUI = () => {
    document.querySelectorAll('#hud, #minimap, #weapon-strip, #boss-bar, #toast-wrap')
      .forEach(root => {
        if (root.hidden || (root.classList && root.classList.contains('hidden'))) return;
        root.querySelectorAll('*').forEach(e => {
          if (e.children.length) return;
          const t = (e.textContent || '').trim();
          if (!t || !SUSPECT.test(t)) return;
          out.uiText.push((root.id || '?') + ' ' + String(e.className || e.tagName).slice(0, 14) + ' = ' + t.slice(0, 30));
        });
      });
    out.uiText = out.uiText.slice(0, 10);
    ['hp-text', 'hud-wave', 'hud-timer', 'hud-room', 'hud-floor', 'hud-level', 'hud-xp',
      'hud-mats', 'hud-kills', 'hud-speed', 'hud-fps', 'boss-name', 'boss-hp',
      'mm-floor', 'mm-theme', 'mm-hint'].forEach(id => {
      const e = document.getElementById(id);
      if (e) out.hudText[id] = (e.textContent || '').trim().slice(0, 24);
    });
    return out;
  };
  /* toast 压住别人没有？toast 是 **pointer-events:none**，所以被压住的按钮还能点，
     但"看不见按钮"本身就是看得见的 bug。这里量的是矩形相交。 */
  const clashOf = () => {
    const tw = document.getElementById('toast-wrap');
    if (!tw) return [];
    const ts = [...tw.children].map(e => e.getBoundingClientRect()).filter(b => b.height > 0);
    if (!ts.length) return [];
    const hits = [];
    document.querySelectorAll('#hud, #minimap, #weapon-strip, .screen.active .menu .btn, .screen.active .shop-foot .btn, .screen.active .settings .btn')
      .forEach(t => {
        if (t.hidden || (t.classList && t.classList.contains('hidden'))) return;
        const b = t.getBoundingClientRect();
        if (b.width < 1 || b.height < 1) return;
        for (const tb of ts) {
          const h = Math.min(b.bottom, tb.bottom) - Math.max(b.top, tb.top);
          const w = Math.min(b.right, tb.right) - Math.max(b.left, tb.left);
          if (h > 1 && w > 1) {
            hits.push((t.id || t.className || t.tagName).toString().slice(0, 18) + ' 被 toast 压 ' +
              Math.round(h) + 'px');
            break;
          }
        }
      });
    return hits.slice(0, 6);
  };
  if (!act) { out.clashes = clashOf(); return snapshotUI(); }
  out.clashes = clashOf();
  const kids = [...act.children].filter(e => e.getBoundingClientRect().height > 0);
  out.panels = kids.map(e => ({ cls: String(e.className || e.tagName).slice(0, 30), ...box(e) }));
  /* 面板装不下自己的内容、又不能滚 → 内容会**溢出去压住后面的东西**
     （商店的武器列压住"下一波"就是这样：面板自己的矩形是小的，交叠检查看不见） */
  out.spill = kids.filter(e => {
    const st = getComputedStyle(e);
    if (st.overflowY !== 'visible') return false;
    return e.scrollHeight > e.clientHeight + 2;
  }).map(e => String(e.className || e.tagName).slice(0, 30) + ' 内容 ' + e.scrollHeight + ' > 框 ' + e.clientHeight);
  out.beyond = kids.filter(e => {
    const b = e.getBoundingClientRect();
    if (b.bottom <= innerHeight + 1) return false;
    /* 整屏能滚的话，"超出视口"是够得着的（短窗口的兜底），不算 bug */
    return getComputedStyle(act).overflowY === 'visible';
  }).map(e => String(e.className || e.tagName).slice(0, 30));
  /* 顶层面板互相压住：flex 把面板压扁时，下一个面板的背景会盖掉上一个的内容
     （角色页"起始武器"那一行就是这么消失的）——两个面板的矩形相交就是 bug */
  for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
    const a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect();
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (h > 1) out.overlaps.push(String(kids[i].className || kids[i].tagName).slice(0, 22) + ' ∩ ' +
      String(kids[j].className || kids[j].tagName).slice(0, 22) + ' ' + Math.round(h) + 'px');
  }
  /* 最近的"会裁剪的祖先"：**能滚到的不算被裁**（列表本来就要滚），
     只有 overflow:hidden 这种"够不着"的才算 bug */
  const clipAnc = (e) => {
    let p = e.parentElement;
    while (p && p !== act.parentElement) {
      const st = getComputedStyle(p);
      if (st.overflowY !== 'visible' && st.overflowY !== 'auto' && st.overflowY !== 'scroll') return p;
      p = p.parentElement;
    }
    return null;
  };
  act.querySelectorAll('*').forEach(e => {
    if (e.children.length || !e.textContent.trim()) return;
    const eb = e.getBoundingClientRect();
    if (eb.width < 1 || eb.height < 1) return;
    const a = clipAnc(e);
    if (a) {
      const ab = a.getBoundingClientRect();
      if (eb.bottom > ab.bottom + 1 || eb.right > ab.right + 1 || eb.top < ab.top - 1 || eb.left < ab.left - 1) {
        out.clipped.push({ cls: String(e.className || e.tagName).slice(0, 20),
          t: e.textContent.trim().slice(0, 15), w: Math.round(eb.width), h: Math.round(eb.height) });
      }
    }
    /* 被挤成竖排：盒子比 3 个字还窄，而文字折成了两行以上
       （上一版枢纽的"走过的局数"就是这样：一行一两个字） */
    const fs = parseFloat(getComputedStyle(e).fontSize) || 14;
    const txt = e.textContent.trim();
    if (txt.length >= 4 && eb.width < fs * 3.2 && e.scrollHeight > fs * 2.1) {
      out.squeezed.push({ cls: String(e.className || e.tagName).slice(0, 22),
        t: txt.slice(0, 14), w: Math.round(eb.width), fs: Math.round(fs) });
    }
  });
  out.clipped = out.clipped.slice(0, 12);
  out.squeezed = out.squeezed.slice(0, 12);
  /* 被**压没**的文字：有字、有自己的行高，盒子却比半行还矮。
     这是 flex 最阴的一手 —— 装不下时它按比例压所有子元素，于是一整行文字
     会安静地变成 0 高（上面那条 clipped 检查跳过 height < 1 的元素，正好漏掉这一类）。
     只看**叶子上的文字**：canvas 溢出自己的框 5px 是正常的（图标故意画大一点），
     而"一行字没了"没有任何正常情况。实测：报告里 t 为空的 .cv 就是那种假阳性。 */
  if (act) {
    act.querySelectorAll('*').forEach(e => {
      if (e.children.length) return;
      const txt = (e.textContent || '').trim();
      if (!txt) return;
      const st = getComputedStyle(e);
      if (st.display === 'none' || st.visibility === 'hidden') return;
      if (e.offsetParent === null) return;            // 自己在被隐藏的子树里
      const b = e.getBoundingClientRect();
      if (b.width < 1) return;
      const lh = parseFloat(st.lineHeight) || (parseFloat(st.fontSize) || 14) * 1.2;
      if (b.height < lh * 0.6) {
        out.crushed.push({
          cls: String(e.className || e.tagName).slice(0, 24),
          t: txt.slice(0, 14), h: Math.round(b.height), need: Math.round(lh)
        });
      }
    });
    out.crushed = out.crushed.slice(0, 12);
  }
  if (act) {
    act.querySelectorAll('*').forEach(e => {
      if (e.children.length) return;
      const t = (e.textContent || '').trim();
      if (!t || !SUSPECT.test(t)) return;
      out.badText.push(String(e.className || e.tagName).slice(0, 20) + ' = ' + t.slice(0, 40));
    });
    out.badText = out.badText.slice(0, 10);
  }
  /* HUD / 小地图 / 武器条 / 关底血条 / toast **不在 .screen 里**，
     它们是 #ui 下的兄弟节点 —— 只在 .screen 里扫会漏掉玩家最常看的那一块。 */
  out.uiText = [];
  document.querySelectorAll('#hud, #minimap, #weapon-strip, #boss-bar, #toast-wrap')
    .forEach(root => {
      if (root.hidden || (root.classList && root.classList.contains('hidden'))) return;
      root.querySelectorAll('*').forEach(e => {
        if (e.children.length) return;
        const t = (e.textContent || '').trim();
        if (!t || !SUSPECT.test(t)) return;
        out.uiText.push((root.id || '?') + ' ' + String(e.className || e.tagName).slice(0, 14) + ' = ' + t.slice(0, 30));
      });
    });
  out.uiText = out.uiText.slice(0, 10);
  /* HUD 的实际读数（不是查错，是**快照**）：一屏一屏看数字对不对，
     比截图更快也更准（数字错了在缩略图里根本看不清）。 */
  out.hudText = {};
  ['hp-text', 'hud-wave', 'hud-timer', 'hud-room', 'hud-floor', 'hud-level', 'hud-xp',
    'hud-mats', 'hud-kills', 'hud-speed', 'hud-fps', 'boss-name', 'boss-hp',
    'mm-floor', 'mm-theme', 'mm-hint'].forEach(id => {
    const e = document.getElementById(id);
    if (e) out.hudText[id] = (e.textContent || '').trim().slice(0, 24);
  });
  const g = (sel) => document.querySelector(sel);
  out.hub = act.id === 'scr-hub' ? {
    room: box(g('.hub-room')), status: box(g('#hub-status')), stations: box(g('#hub-stations')),
    firstCard: box(g('.station')), talk: box(g('#hub-talk')),
    perRow: (() => {
      const cards = [...document.querySelectorAll('.station')];
      if (!cards.length) return 0;
      const top = Math.round(cards[0].getBoundingClientRect().top);
      return cards.filter(c => Math.abs(c.getBoundingClientRect().top - top) < 3).length;
    })(),
    cards: document.querySelectorAll('.station').length
  } : null;
  return out;
})()`;

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

let failures = 0;
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startTsServer(SERVED, 0);
  const report = { served: SERVED, sizes: [], generatedAt: new Date().toISOString() };
  // 独立的档案目录：每次量尺都是干净存档（结果可复现）
  app.setPath('userData', path.join(OUT, '.profile'));
  /* 一个窗口，逐个尺寸改大小 —— 每个尺寸开一个新窗口会踩到
     "销毁离屏窗口后下一次 loadURL 直接 ERR_FAILED" */
  const win = new BrowserWindow({
    width: SIZES[0][0], height: SIZES[0][1], show: false, frame: false, useContentSize: true,
    webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true }
  });
  let last = null;
  win.webContents.on('paint', (e, dirty, image) => { last = image; });
  win.webContents.setFrameRate(30);
  /* 装错误收集器：每次文档就绪后挂上（重载会清掉 window，所以要在 dom-ready 里重挂） */
  win.webContents.on('dom-ready', () => {
    win.webContents.executeJavaScript(
      'window.__errs = window.__errs || [];' +
      'window.addEventListener("error", function (e) {' +
      '  window.__errs.push(String((e && e.message) || e) + " @" + (e && e.filename ? e.filename.split("/").pop() : "?") + ":" + (e && e.lineno));' +
      '});' +
      'window.addEventListener("unhandledrejection", function (e) {' +
      '  window.__errs.push("未处理的 Promise 拒绝: " + String(e && e.reason));' +
      '});'
    ).catch(() => {});
  });
  await win.loadURL(server.url + 'index.html');
  await wait(500);                       // 等主循环起来（画布要有内容）

  for (const [w, h] of SIZES) {
    win.setContentSize(w, h);
    await wait(300);
    const entry = { w, h, shots: [] };
    for (const spec of SHOTS) {
      const i = spec.indexOf(':');
      const name = spec.slice(0, i);
      const chain = spec.slice(i + 1);
      /* 先回标题页（点掉上一屏的返回键不可靠）。
         用**被 await 的 loadURL** 而不是 location.reload()：reload 是异步的，
         紧接着的 loadURL 会把它打断，报 ERR_ABORTED (-3) —— 那是量尺自己的 bug。 */
      await win.loadURL(server.url + 'index.html');
      await wait(400);
      let ok = true;
      if (chain !== '-') {
        for (const a of chain.split('>')) {
          if (a.startsWith('?')) {
            /* 带查询串重新加载：main.ts 有一批 ?test= / ?daily=1 的钩子，
               那些屏（升级选卡 / 结算 / 每日挑战 / 密集团战）没有"从标题点进去"的路径 */
            await win.loadURL(server.url + 'index.html?' + a.slice(1));
            await wait(500);
            continue;
          }
          if (a.startsWith('key:')) {
            /* 键盘那一步（暂停/背包这类没有按钮入口的界面）：
               派发一个真的 keydown 到 window，走的是与玩家同一条按键路径 */
            const k = a.slice(4);
            await win.webContents.executeJavaScript(
              `window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true }))`);
            await wait(240);
            continue;
          }
          const clicked = await win.webContents.executeJavaScript(
            `(() => { const b = document.querySelector('[data-act="${a}"]'); if (!b) return false; b.click(); return true; })()`);
          if (!clicked) ok = false;
          await wait(220);
        }
      }
      await wait(260);
      if (TOASTBOTTOM !== null) {
        await win.webContents.executeJavaScript(
          `(() => { const w = document.getElementById('toast-wrap'); if (w) w.style.bottom = '${TOASTBOTTOM}px'; })()`);
      } else {
        /* **钉住两条 toast**：真实 toast 有自己的寿命，测出来的"压住"会随它什么时候消失
           而变（我第一轮就被这个骗过）。这里直接放两条固定高度的，位置测量才是可比的。 */
        await win.webContents.executeJavaScript(
          `(() => { const w = document.getElementById('toast-wrap');` +
          ` if (w) w.innerHTML = '<div class="toast">压住测试一</div><div class="toast">压住测试二</div>'; })()`);
      }
      await wait(60);
      const probe = await win.webContents.executeJavaScript(PROBE);
      /* 页面里攒下来的 JS 错误：**这是找 bug 最直接的一条** ——
         某个 render / 动作抛了异常时，界面可能只是"某块空着"，肉眼看不出，
         但 window.onerror / unhandledrejection 一定记得住。 */
      const pageErrs = await win.webContents
        .executeJavaScript('(window.__errs || []).slice(0, 6)').catch(() => []);
      probe.jsErrors = pageErrs;

      /* ---- 点遍这一屏上的每个 data-act（--pokes=1）----------------------------
         找 bug 最直接的一条：界面"看着对"但某个动作一按就抛 / 按了没反应，
         量尺的几何检查看不见。做法是**每个动作都从干净状态重来一次**
         （重载 → 重新走到这一屏 → 点它），于是不会互相污染。 */
      if (POKES && w === SIZES[0][0] && h === SIZES[0][1]) {
        const list = await win.webContents.executeJavaScript(
          `[...document.querySelectorAll('.screen.active [data-act]')]
             .map(e => ({ act: e.dataset.act, t: (e.textContent || '').trim().slice(0, 10) }))
             .filter(x => x.act)`);
        const seen = new Set();
        pokes.push({ screen: probe.screen, acts: list.length });
        for (const item of list) {
          if (seen.has(item.act)) continue;
          seen.add(item.act);
          // 回到这一屏（与上面同一条路径）
          await win.loadURL(server.url + 'index.html');
          await wait(260);
          if (chain !== '-') {
            for (const a of chain.split('>')) {
              if (a.startsWith('?')) { await win.loadURL(server.url + 'index.html?' + a.slice(1)); await wait(400); continue; }
              await win.webContents.executeJavaScript(
                `(() => { const b = document.querySelector('[data-act="${a}"]'); if (b) b.click(); })()`);
              await wait(180);
            }
          }
          await wait(150);
          const r = await win.webContents.executeJavaScript(
            `(() => {
               const b = document.querySelector('.screen.active [data-act="' + ${JSON.stringify(item.act)} + '"]');
               if (!b) return { missing: true };
               const before = (document.querySelector('.screen.active') || {}).id || '';
               b.click();
               const after = (document.querySelector('.screen.active') || {}).id || '';
               return { before: before, after: after, errs: (window.__errs || []).slice(0, 3) };
             })()`).catch(e => ({ errs: ['执行失败: ' + e.message] }));
          const line = '      · ' + item.act.padEnd(14) + (item.t ? '"' + item.t + '" ' : '') +
            (r.missing ? '✗ 找不到按钮' : (r.before === r.after ? '（界面不变）' : r.before + ' → ' + r.after)) +
            (r.errs && r.errs.length ? '   ✗ JS 错误: ' + r.errs.join(' | ') : '');
          if (r.missing || (r.errs && r.errs.length)) { pokeFail++; failures++; }
          log(line);
        }
        log('      —— 这一屏点过 ' + seen.size + ' 个动作，其中抛错/找不到按钮 ' + pokeFail + ' 个');
      }
      /* --dump=<选择器>：把命中的元素的**子节点层级 + 盒子**打出来。
         用途：分清"内容被压扁了"与"这个子节点根本没被建出来"。 */
      if (DUMP) {
        const dump = await win.webContents.executeJavaScript(
          `(() => {
             const roots = [...document.querySelectorAll(${JSON.stringify(DUMP)})];
             const fmt = (e, d) => {
               const b = e.getBoundingClientRect();
               const st = getComputedStyle(e);
               const txt = (e.childElementCount ? '' : (e.textContent || '').trim().slice(0, 26));
               return '  '.repeat(d) + e.tagName.toLowerCase() +
                 (e.className ? '.' + String(e.className).split(/\\s+/).join('.') : '') +
                 '  ' + Math.round(b.width) + 'x' + Math.round(b.height) +
                 ' @' + Math.round(b.x) + ',' + Math.round(b.y) +
                 '  fs=' + st.fontSize + ' lh=' + st.lineHeight + ' shrink=' + st.flexShrink +
                 (e.hidden || st.display === 'none' ? ' [hidden]' : '') +
                 (txt ? ' "' + txt + '"' : '');
             };
             const out = [];
             out.push('命中 ' + roots.length + ' 个：' + ${JSON.stringify(DUMP)});
             roots.slice(0, 3).forEach(r => {
               const walk = (e, d) => {
                 out.push(fmt(e, d));
                 if (d < 3) [...e.children].slice(0, 14).forEach(c => walk(c, d + 1));
               };
               walk(r, 0);
             });
             return out;
           })()`).catch(e => ['dump 失败: ' + e.message]);
        dump.forEach(l => log('      ' + l));
      }
      const png = path.join(OUT, name + '-' + w + 'x' + h + '.png');
      if (last) fs.writeFileSync(png, last.toPNG());
      /* 想看清细节时给一个裁剪区（CSS 像素）：--crop=x,y,w,h
         （离屏渲染没法"放大到某个元素"，但 NativeImage 能裁 —— 裁出来就是原始像素） */
      if (last && CROPRECT) {
        const [cx, cy, cw, ch] = CROPRECT;
        try {
          const cut = last.crop({ x: Math.round(cx), y: Math.round(cy), width: Math.round(cw), height: Math.round(ch) });
          fs.writeFileSync(path.join(OUT, name + '-' + w + 'x' + h + '-crop.png'), cut.toPNG());
        } catch (e) { log('  裁剪失败：' + e.message); }
      }
      /* "没有覆盖层"不等于出错：playing 状态本来就没有覆盖层（只有 HUD），
         而 HUD 那一屏正是要看这种情况。所以判据是"有覆盖层 **或** HUD 活着"。 */
      const gotUI = !!(probe.screen || (probe.hudText && probe.hudText['hud-wave']));
      const bad = !ok || !gotUI || probe.beyond.length || probe.clipped.length ||
        probe.squeezed.length || probe.overlaps.length || probe.spill.length ||
        probe.crushed.length ||
        probe.jsErrors.length || probe.badText.length || probe.uiText.length || probe.docH > probe.vh + 1;
      if (bad) failures++;
      entry.shots.push({ name, reached: probe.screen, clickOk: ok, png: path.basename(png), ...probe });
      const flag = bad ? '  ✗' : '  ✓';
      log(flag + ' ' + name.padEnd(9) + ' ' + (probe.screen || '(无)') +
        '  vh=' + probe.vh + ' docH=' + probe.docH +
        (probe.jsErrors.length ? '  JS 错误: ' + probe.jsErrors.join(' | ') : '') +
        (probe.badText.length ? '  文案可疑: ' + probe.badText.join(' | ') : '') +
        (probe.uiText.length ? '  HUD 文案可疑: ' + probe.uiText.join(' | ') : '') +
        (probe.clashes && probe.clashes.length ? '  toast 压住: ' + probe.clashes.join(' | ') : '') +
        (probe.beyond.length ? '  超出视口: ' + probe.beyond.join(',') : '') +
        (probe.overlaps.length ? '  面板相压: ' + probe.overlaps.join(' | ') : '') +
        (probe.clipped.length ? '  被裁: ' + probe.clipped.map(c => c.t).join(' / ') : '') +
        (probe.squeezed.length ? '  挤成竖排: ' + probe.squeezed.map(c => c.t + '(' + c.w + 'px)').join(' / ') : '') +
        (probe.spill.length ? '  内容溢出面板: ' + probe.spill.join(' | ') : '') +
        (probe.crushed.length ? '  被压没: ' + probe.crushed.map(c => c.cls + '(' + c.h + '/' + c.need + 'px)').join(' / ') : ''));
      if (name === 'hud' || name === 'play') {
        log('      HUD 读数：' + Object.keys(probe.hudText)
          .map(k => k + '=' + probe.hudText[k]).join('  '));
      }
      if (probe.hub) {        const hb = probe.hub;
        log('      枢纽: 房 ' + (hb.room ? hb.room.w + '×' + hb.room.h : '—') +
          ' · 每行 ' + hb.perRow + ' 站 × 共 ' + hb.cards +
          ' · 卡 ' + (hb.firstCard ? hb.firstCard.w + '×' + hb.firstCard.h : '—') +
          ' · 状态带 ' + (hb.status ? hb.status.h : '—') + ' · 对话框 ' + (hb.talk ? hb.talk.h : '—') +
          (hb.room && hb.room.overY ? '  [房内滚动]' : ''));
      }
    }
    report.sizes.push(entry);
  }
  win.destroy();
  server.close();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  log('\n报告：' + path.join(OUT, 'report.json') + '（' + SIZES.length + ' 种尺寸）');
  log(failures ? (failures + ' 张截图有问题 ✘') : '全部屏幕装得下、没有被裁的文字 ✔');
  flush();
  app.exit(failures ? 1 : 0);
}

app.whenReady().then(() => main().catch(e => {
  log('出错：' + (e && e.stack ? e.stack : e));
  flush();
  app.exit(2);
}));
