/* ==========================================================================
 * tools/shot.js · 本地截图（CDP 精确视口）
 * --------------------------------------------------------------------------
 * 无头 Chrome 的 --window-size 与实际视口对不上（会差掉一百多像素），
 * 用它调版式很容易看错。这里直接连 DevTools 协议，用
 * Emulation.setDeviceMetricsOverride 把视口钉死成指定宽高再截。

 * 用法：
 *   node tools/shot.js --url http://localhost:3100/gate/ --w 1440 --h 900 --out .tmp/a.png
 *   可选：--click "#gateLeaf"   截图前点一下（用来截开门动画）
 *         --eval "js"          截图前执行一段脚本（用来定格某个状态）
 *         --wait 1200          点击后等多久再截（ms）
 *         --hover "sel|0.8|0.2" 把鼠标移到某元素里的相对位置（真 hover，
 *                              脚本派发的 PointerEvent 不会让 :hover 生效）
 *         --touch              模拟移动端（含 DPR 2）
 *         --dpr 2              只提像素密度，不改视口（看边框这种细节用）
 *         --reduce             模拟「减少动态效果」(prefers-reduced-motion: reduce)
 * ========================================================================== */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 ? process.argv[i + 1] : def;
}
function flag(name) {
  return process.argv.includes('--' + name);
}

const URL_ = arg('url', 'http://localhost:3100/gate/');
const W = parseInt(arg('w', '1440'), 10);
const H = parseInt(arg('h', '900'), 10);
const OUT = arg('out', '.tmp/shot.png');
const CLICK = arg('click', '');
const EVAL = arg('eval', '');
const PROBE = arg('probe', '');
const WAIT = parseInt(arg('wait', '900'), 10);
const HOVER = arg('hover', '');
const TOUCH = flag('touch');
const DPR = parseFloat(arg('dpr', TOUCH ? '2' : '1'));
const REDUCE = flag('reduce');

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find((p) => fs.existsSync(p));

if (!CHROME) {
  console.error('找不到 Chrome / Edge');
  process.exit(1);
}

const PORT = 9333 + Math.floor(Math.random() * 200);
const PROFILE = path.join(os.tmpdir(), 'shot-profile-' + PORT);

const child = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--no-first-run',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE,
  'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function version() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/version');
      if (r.ok) return r.json();
    } catch (e) { /* 还没起来 */ }
    await sleep(150);
  }
  throw new Error('Chrome 没起来');
}

(async () => {
  const v = await version();
  const ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const waiting = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && waiting.has(msg.id)) {
      const { resolve, reject } = waiting.get(msg.id);
      waiting.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  };
  function send(method, params, sessionId) {
    return new Promise((resolve, reject) => {
      const mid = ++id;
      waiting.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params: params || {}, sessionId }));
    });
  }

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });

  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  /* 必须关缓存：user-data-dir 是复用的，Chrome 会把 www/js/css 全缓存下来，
     改完样式再截图可能跑的还是上一版脚本 —— 表现是「改了参数完全没反应」。 */
  await send('Network.enable', {}, sessionId);
  await send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
  await send('Emulation.setDeviceMetricsOverride', {
    width: W,
    height: H,
    deviceScaleFactor: DPR,
    mobile: TOUCH,
    screenWidth: W,
    screenHeight: H
  }, sessionId);

  if (REDUCE) {
    await send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
    }, sessionId);
  }

  /* CDP 新建的标签是「后台页」，后台页里 requestAnimationFrame 和 CSS
     过渡都会被浏览器暂停 —— 不置前，截出来永远是第一帧，做帧间差分
     会得到「天空水面完全静止」这种假结论。 */
  await send('Page.bringToFront', {}, sessionId);

  await send('Page.navigate', { url: URL_ }, sessionId);
  await sleep(1800);                       // 等脚本与图片解码

  if (EVAL) {
    await send('Runtime.evaluate', { expression: EVAL, awaitPromise: false }, sessionId);
  }

  if (CLICK) {
    await send('Runtime.evaluate', {
      expression: 'document.querySelector(' + JSON.stringify(CLICK) + ').click()',
      awaitPromise: false
    }, sessionId);
  }

  /* --hover 走 CDP 的真实鼠标事件：`:hover` 由浏览器自己算，
     用 dispatchEvent 造的 PointerEvent 不会点亮它，光斑永远是 opacity:0。
     格式 "选择器|横向比例|纵向比例"，比例省略按 0.5。 */
  if (HOVER) {
    const parts = HOVER.split('|');
    const sel = parts[0];
    const rx = parseFloat(parts[1] || '0.5');
    const ry = parseFloat(parts[2] || '0.5');
    const box = await send('Runtime.evaluate', {
      expression: 'JSON.stringify((function(){var e=document.querySelector(' + JSON.stringify(sel) + ');' +
        'if(!e)return null;var b=e.getBoundingClientRect();' +
        'return {x:b.left+b.width*' + rx + ',y:b.top+b.height*' + ry + ',w:b.width,h:b.height}})())',
      returnByValue: true
    }, sessionId);
    const p = box.result.value ? JSON.parse(box.result.value) : null;
    if (p && p.w > 0) {
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: p.x, y: p.y, button: 'none'
      }, sessionId);
      console.log('hover at', Math.round(p.x), Math.round(p.y));
    } else {
      console.log('hover 目标没找到：', sel);
    }
  }

  /* --wait 必须无条件生效：只挂在 --eval / --click 上的时候，单纯截图会在
     页面刚加载 1.8s 就按下快门 —— 那时候淡入还没开始，带 opacity 过渡的
     图层全是透明的，会把「还在淡入」误判成「根本没画」。 */
  await sleep(WAIT);

  if (PROBE) {
    const r = await send('Runtime.evaluate', {
      expression: 'JSON.stringify(' + PROBE + ')',
      returnByValue: true
    }, sessionId);
    console.log('probe:', r.result.value);
  }

  /* --shots 2 --gap 1200：同一次加载里连拍，用来做两帧差分验证「到底动不动」。
     不同次加载的粒子是随机初始化的，帧间差分会完全失真。 */
  const SHOTS = +arg('shots', 1);
  const GAP = +arg('gap', 1200);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  for (let i = 0; i < SHOTS; i++) {
    if (i) await sleep(GAP);
    const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    const file = SHOTS === 1 ? OUT : OUT.replace(/\.png$/, '-' + i + '.png');
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
    console.log('saved', file);
  }

  const metrics = await send('Runtime.evaluate', {
    expression: 'JSON.stringify({w:innerWidth,h:innerHeight,url:location.pathname+location.search,cls:(document.getElementById("gate")||{}).className||""})',
    returnByValue: true
  }, sessionId);
  console.log('saved', OUT, '|', metrics.result.value);

  ws.close();
  child.kill();
  process.exit(0);
})().catch((e) => {
  console.error('失败：', e.message);
  try { child.kill(); } catch (_) { /* 忽略 */ }
  process.exit(1);
});
