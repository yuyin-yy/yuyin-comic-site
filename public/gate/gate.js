/* ==========================================================================
   gate.js · 罗生门（独立模块，只依赖 ../js/data.js 提供的作品清单）
   --------------------------------------------------------------------------
   一扇立在插画里的门。点一下：
     1. 按透视把门页推开，门后透出被抽中作品封面的颜色；
     2. 镜头往门心推近，同时压成白幕；
     3. 白幕上交代一句「进了哪一部」，然后落到它的详情页。

   门页不是另画的：它是「同一张底图裁下门那一块」。
   底图用 cover 铺满视口，门的实际像素位置每次都要按 cover 的缩放重算，
   否则不同窗口比例下门页会和画里的门对不上。
   门框坐标是在原图 1600×1000 上量的，比例见下面的 DOOR。

   用法：页面给好 #gate 结构，本文件末尾自动 init。
   ========================================================================== */
(function () {
  'use strict';

  /** 门在原图中的比例位置（左上角 + 宽高）
   *  原图 1600×1000 上量的：门框 704,365 → 908,778（778 是门底那条投影） */
  var DOOR = { x: 0.44, y: 0.365, w: 0.1275, h: 0.413 };

  /** 两档底图：宽屏 1440，窄屏 800，手机省一半流量 */
  var SRC_L = { url: 'img/gate-1440.webp', w: 1440, h: 900 };
  var SRC_S = { url: 'img/gate-800.webp', w: 800, h: 500 };

  /** 时间轴（ms）：开门 → 推镜 → 压白 → 落地 */
  var T_ENTER = 120;
  var T_VEIL = 430;
  var T_GO = 1400;
  var T_GO_REDUCE = 320;

  /** 站内落点：本模块在 /gate/ 下，详情页在上一层 */
  var DETAIL = '../index02.html?id=';
  var FALLBACK = '../category.html';

  var $ = function (id) { return document.getElementById(id); };

  var root = $('gate');
  if (!root) return;

  var world = $('gateWorld');
  var art = $('gateArt');
  var door = $('gateDoor');
  var leaf = $('gateLeaf');
  var holeCover = $('gateHoleCover');
  var hint = $('gateHint');
  var cardCover = $('gateCardCover');
  var cardTitle = $('gateCardTitle');

  var media = window.matchMedia('(prefers-reduced-motion: reduce)');
  var spec = pickSpec();
  var target = null;
  var isOpen = false;
  var navigated = false;
  var timers = [];
  var lastId = 0;

  try { lastId = Number(sessionStorage.getItem('yy-gate-last')) || 0; } catch (e) { /* 隐私模式 */ }

  /* ----------------------------- 尺寸 ----------------------------- */

  function pickSpec() {
    return window.innerWidth <= 720 ? SRC_S : SRC_L;
  }

  /** 底图和门页共用同一张图：只下载一次 */
  function setBackgrounds() {
    var css = 'url("' + spec.url + '")';
    art.style.backgroundImage = css;
    leaf.style.backgroundImage = css;
  }

  /** 按 cover 的规则把门还原到视口像素坐标 */
  function layout() {
    var W = root.clientWidth || window.innerWidth;
    var H = root.clientHeight || window.innerHeight;
    if (!W || !H) return;

    var s = Math.max(W / spec.w, H / spec.h);   // cover 的缩放比
    var dw = spec.w * s;
    var dh = spec.h * s;
    var ox = (W - dw) / 2;                      // cover 居中裁掉的偏移
    var oy = (H - dh) / 2;

    var dx = ox + DOOR.x * dw;
    var dy = oy + DOOR.y * dh;
    var dW = DOOR.w * dw;
    var dH = DOOR.h * dh;

    door.style.left = dx + 'px';
    door.style.top = dy + 'px';
    door.style.width = dW + 'px';
    door.style.height = dH + 'px';

    // 门页比门框上下左右各多铺 1px：关着时和底图重合，转开时边缘不留缝。
    // 背景偏移要用「整张图在视口里的原点」(ox/oy) 来算，不能直接用门的坐标：
    // cover 会横向或纵向裁掉一条，桌面端 oy/ox 恰好接近 0 才看不出来，手机上差得很远。
    leaf.style.backgroundSize = dw + 'px ' + dh + 'px';
    leaf.style.backgroundPosition = (ox - (dx - 1)) + 'px ' + (oy - (dy - 1)) + 'px';

    // 推镜要对准门心，不是屏幕中心
    world.style.transformOrigin =
      ((dx + dW / 2) / W * 100).toFixed(2) + '% ' +
      ((dy + dH / 2) / H * 100).toFixed(2) + '%';

    // 提示条贴在门脚下方，最多留到屏幕底部上方 52px
    hint.style.left = (dx + dW / 2) + 'px';
    hint.style.top = Math.min(dy + dH + 30, H - 52) + 'px';

    // 光尘层用同一套坐标：门缝的暖光、水面的倒影都得贴在这扇门上
    if (window.GateFx) {
      window.GateFx.setDoor({ x: dx, y: dy, w: dW, h: dH });
    }
  }

  var resizeTimer = null;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      var next = pickSpec();
      if (next.url !== spec.url) {
        spec = next;
        setBackgrounds();
      }
      layout();
    }, 120);
  }

  /* ----------------------------- 抽签 ----------------------------- */

  /** 随机一部；尽量不和上一次重复，免得连推两次还是同一本 */
  function pick() {
    var pool = window.COMICS || [];
    if (!pool.length) return null;

    var item = pool[Math.floor(Math.random() * pool.length)];
    var guard = 0;
    while (pool.length > 1 && item.id === lastId && guard++ < 8) {
      item = pool[Math.floor(Math.random() * pool.length)];
    }

    lastId = item.id;
    try { sessionStorage.setItem('yy-gate-last', String(item.id)); } catch (e) { /* 忽略 */ }
    return item;
  }

  /** 顺手把详情页 HTML 预热一下，落地时更快 */
  function prefetch(url) {
    var l = document.createElement('link');
    l.rel = 'prefetch';
    l.href = url;
    document.head.appendChild(l);
  }

  /* ----------------------------- 推门 ----------------------------- */

  function open() {
    if (isOpen) return;
    isOpen = true;

    var item = pick();
    if (!item) {
      root.classList.add('is-through');
      timers.push(setTimeout(function () { location.href = FALLBACK; }, 700));
      return;
    }
    target = item;

    // 门后的光染上这本封面的颜色
    holeCover.style.backgroundImage = 'url("' + item.cover + '")';
    cardCover.src = item.cover;
    cardTitle.textContent = item.title;

    // 封面先加载，白幕上的小卡片不会空着
    var probe = new Image();
    probe.src = item.cover;
    prefetch(DETAIL + item.id);

    root.classList.add('is-open');
    // 门缝的光跟着门一起炸开，把周围的浮尘往外吹
    if (window.GateFx) window.GateFx.burst();
    timers.push(setTimeout(function () { root.classList.add('is-entering'); }, T_ENTER));
    timers.push(setTimeout(function () { root.classList.add('is-through'); }, T_VEIL));
    timers.push(setTimeout(go, media.matches ? T_GO_REDUCE : T_GO));
  }

  function go() {
    if (navigated) return;
    navigated = true;
    timers.forEach(clearTimeout);
    timers = [];
    location.href = target ? DETAIL + target.id : FALLBACK;
  }

  /* ----------------------------- 事件 ----------------------------- */

  function onClick(e) {
    if (navigated) return;
    // 顶部那一条（返回站点、站点名）是出口，不参与推门
    if (e.target.closest && e.target.closest('.gate-top')) return;
    // 动画进行中再点一下 = 不等了，直接进
    if (isOpen) {
      e.preventDefault();
      go();
      return;
    }
    e.preventDefault();
    open();
  }

  function init() {
    setBackgrounds();
    layout();

    // 底图解出来再亮，避免先看到半张白/糊图；慢网兜底 1.2s
    var probe = new Image();
    probe.onload = probe.onerror = function () { root.classList.add('is-ready'); };
    probe.src = spec.url;
    setTimeout(function () { root.classList.add('is-ready'); }, 1200);

    window.addEventListener('resize', onResize, { passive: true });
    root.addEventListener('click', onClick);

    // 手机地址栏收起、或者窗口被拖大，视口高度会变：
    // 用 ResizeObserver 盯住容器本身，比只听 window.resize 稳（后者在移动端会漏）
    if (window.ResizeObserver) {
      new ResizeObserver(function () { layout(); }).observe(root);
    }
    window.addEventListener('load', layout);

    // 从详情页按返回时，浏览器可能直接还原成白幕：复位成等待推门的样子
    window.addEventListener('pageshow', function (e) {
      if (!e.persisted) return;
      timers.forEach(clearTimeout);
      timers = [];
      target = null;
      isOpen = false;
      navigated = false;
      root.classList.remove('is-open', 'is-entering', 'is-through');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
