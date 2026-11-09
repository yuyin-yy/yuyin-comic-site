/* ==========================================================================
 * ui/orb.js · 封面球（首页「最近更新」）
 * --------------------------------------------------------------------------
 * 思路参考 foreverblog 首页的照片球：
 *   1. 用黄金角（Fibonacci sphere）把 N 个封面均匀撒在球面上；
 *   2. 每张卡片贴在球面的切平面上——越靠边越侧、背面被纸色雾气吃掉；
 *   3. 鼠标拖动带惯性自转，松手后继续慢慢转；
 *   4. 滚轮把整批卡片「摊平」成网格，再往回滚收成球（逐张错开落位）。
 *
 * 用法：
 *   var orb = YY.orb.create(host, {
 *     items: [...],            // 作品数组，取前 40
 *     cols: function () {},    // 平铺时的列数（2~6），一般传 YY.card.cols
 *     onMode: function (m) {}  // 'sphere' | 'grid'，用于同步分段按钮
 *   });
 *   orb.setMode('grid') / orb.toggle() / orb.relayout() / orb.destroy()
 *
 * 依赖：YY（core.js）
 * 暴露：YY.orb
 * ========================================================================== */
(function (YY) {
  'use strict';

  var esc = YY.esc;

  var TAU = Math.PI * 2;
  var GA = Math.PI * (3 - Math.sqrt(5));   // 黄金角，球面撒点最均匀
  var TILT = -0.1;                         // 静止时的俯仰（略微低头看球）
  var SPIN = 0.16;                         // 自转角速度 rad/s

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  var nowMs = (window.performance && window.performance.now)
    ? function () { return window.performance.now(); }
    : function () { return Date.now(); };

  /** 角度归一到 [-π, π)，插值时不会绕远路 */
  function wrap(a) {
    a = (a + Math.PI) % TAU;
    if (a < 0) a += TAU;
    return a - Math.PI;
  }

  function ease(t) {
    t = clamp(t, 0, 1);
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function n1(v) { return Math.round(v * 10) / 10; }
  function n3(v) { return Math.round(v * 1000) / 1000; }

  /** 球体状态下的舞台高度：随屏宽收放，手机上不至于占掉一整屏 */
  function baseHeight(w) {
    if (w <= 460) return 400;
    if (w <= 720) return 460;
    if (w <= 900) return 540;
    if (w <= 1080) return 620;
    return 720;
  }

  /** 卡片副标题：和网格卡片同一套说法，太长会被省略号截断 */
  function metaOf(item) {
    if (item.chapterNo > 0) return '更新至第' + item.chapterNo + '话';
    return item.chapter || '连载中';
  }

  function create(host, opt) {
    opt = opt || {};
    if (!host) return null;

    // 屏越宽球越大，需要更多封面才铺得满。但也不能太密：
    // N 个点的球面间距约 R·√(4π/N)，N=48 时只有 0.51R，小于卡片高度 0.56R，
    // 相邻两张必然互相插进去（穿模）。40 张时 0.56R，刚好贴住不重叠。
    var vw0 = window.innerWidth;
    var cap = vw0 <= 720 ? 28 : vw0 <= 900 ? 32 : vw0 <= 1080 ? 36 : 40;
    var items = (opt.items || []).slice(0, cap);
    if (!items.length) return null;

    var N = items.length;
    var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    /* ------------------------------ 骨架 ------------------------------ */
    host.innerHTML = '';
    host.classList.add('orb');
    host.setAttribute('role', 'group');
    if (!host.getAttribute('aria-label')) host.setAttribute('aria-label', '最近更新的作品封面');

    var glow = document.createElement('div');
    glow.className = 'orb-glow';
    glow.setAttribute('aria-hidden', 'true');

    var world = document.createElement('div');
    world.className = 'orb-world';

    var hint = document.createElement('span');
    hint.className = 'orb-hint';
    hint.textContent = window.innerWidth <= 720 ? '拖动旋转' : '拖动旋转 · 滚轮平铺';

    host.appendChild(glow);
    host.appendChild(world);
    host.appendChild(hint);

    /* ------------------------------ 卡片 ------------------------------ */
    var tiles = items.map(function (item, i) {
      // 球面坐标：y 从 1 均匀降到 -1，绕 y 轴按黄金角错开
      var y = 1 - (i + 0.5) / N * 2;
      var r = Math.sqrt(Math.max(0, 1 - y * y));
      var th = GA * i;

      var el = document.createElement('a');
      el.className = 'orb-card';
      el.href = 'index02.html?id=' + encodeURIComponent(item.id);
      el.setAttribute('aria-label', '查看《' + item.title + '》');
      el.tabIndex = -1;
      el.innerHTML =
        '<span class="orb-shot">' +
          '<img src="' + item.cover + '" alt="" loading="lazy" decoding="async" draggable="false" ' +
            'referrerpolicy="no-referrer" ' +
            'onerror="this.onerror=null;this.src=\'imgs/placeholder.svg\'">' +
          '<i class="orb-veil"></i>' +
        '</span>' +
        '<span class="orb-cap"><b>' + esc(item.title) + '</b>' +
          '<em>' + esc(metaOf(item)) + '</em></span>';

      world.appendChild(el);

      return {
        el: el,
        veil: el.querySelector('.orb-veil'),
        cap: el.querySelector('.orb-cap'),
        d: [Math.cos(th) * r, y, Math.sin(th) * r],
        s: 0.96 + ((i * 0.618) % 1) * 0.08,   // 每张略大略小，球面不那么机械
        i: i,
        delay: 0,
        lastT: '',
        lastV: -1,
        capOn: false
      };
    });

    var st = {
      w: 0, baseH: 640, cy: 320, R: 240, P: 600, BW: 152, BH: 202,
      cols: 5, rows: 1, grid: [], gridH: 0,
      prog: 0, target: 0, mode: 'sphere',
      ax: TILT, ay: 0.6, vx: 0, vy: 0,
      drag: null, on: true, raf: 0, last: 0, suppress: false, hinted: false
    };

    /* ------------------------------ 布局 ------------------------------ */
    function layout() {
      var w = host.clientWidth || 1;
      var vw = window.innerWidth;
      var mob = w < 720;

      st.w = w;
      st.baseH = opt.height ? opt.height(vw) : baseHeight(vw);
      st.cy = st.baseH / 2;

      // 球半径：纵向留白优先，太宽时按舞台宽收一点，免得两侧卡片贴边
      st.R = Math.min(st.cy * (mob ? 0.86 : 0.76), w * (mob ? 0.44 : 0.37));
      st.P = Math.round(st.R * 4.2);
      st.BW = Math.round(st.R * (mob ? 0.44 : 0.4));
      st.BH = Math.round(st.BW * 4 / 3);

      host.style.perspective = st.P + 'px';
      // 舞台在平铺时会变高，球心仍固定在「球体高度」的正中，
      // 否则盒子一长，球会跟着往下漂
      host.style.perspectiveOrigin = '50% ' + Math.round(st.cy) + 'px';
      world.style.top = Math.round(st.cy) + 'px';

      // 平铺：列数跟站点网格一致，末行不满时居中
      var cols = clamp((opt.cols ? opt.cols() : 5) | 0, 2, 6);
      var gapX = mob ? 12 : 20;
      var capH = mob ? 42 : 48;
      var gapY = mob ? 20 : 26;
      var tw = Math.max(40, (w - gapX * (cols - 1)) / cols);
      var th = tw * 4 / 3;
      var rowH = th + capH + gapY;

      // 平铺只铺 4 行（窄屏放 6 行）：48 张全摊开要把页面拉长到 3600px，
      // 多出来的封面原地淡出——球需要密度，网格不需要那么长
      var showN = Math.min(N, cols * (cols >= 4 ? 4 : 6));
      var rows = Math.ceil(showN / cols);

      st.cols = cols;
      st.rows = rows;
      st.showN = showN;
      st.gridH = Math.round(rows * rowH - gapY + 4);
      st.grid = tiles.map(function (t, i) {
        // 多出来的封面留在球面原位淡出：飞向球心会正好压在第一行网格上
        t.gone = i >= showN;
        if (t.gone) return { x: 0, y: 0, sc: t.s };
        var c = i % cols;
        var r = (i / cols) | 0;
        var lastN = showN - (rows - 1) * cols;
        var off = r === rows - 1 ? (cols - lastN) * (tw + gapX) / 2 : 0;
        return {
          x: -w / 2 + off + c * (tw + gapX) + tw / 2,
          y: r * rowH + th / 2 - st.cy,     // 顶端对齐，与球心无关
          sc: tw / st.BW
        };
      });

      tiles.forEach(function (t, i) {
        t.el.style.width = st.BW + 'px';
        t.el.style.height = st.BH + 'px';
        t.el.style.left = (-st.BW / 2) + 'px';
        t.el.style.top = (-st.BH / 2) + 'px';
        // 落位先后：先按列、再按行，像翻书一样铺开
        t.delay = (i % cols) / cols * 0.16 + ((i / cols) | 0) / rows * 0.14;
        t.lastT = '';
        // 字随卡片缩放反向补偿，平铺后屏幕上仍是 13.5px
        t.cap.style.fontSize = n1(13.5 / st.grid[i].sc) + 'px';
      });

      syncOut();
      applyHeight();
      draw();
    }

    /** 平铺时超出 4 行的封面：原地淡出（球体状态下全部在场） */
    function syncOut() {
      var grid = st.target > 0.4;
      tiles.forEach(function (t) {
        var out = grid && t.i >= st.showN;
        t.el.classList.toggle('is-out', out);
        // 球体状态不进 tab 序列（48 个链接会把人困住），摊平后才逐个可聚焦
        t.el.tabIndex = grid && !out ? 0 : -1;
      });
    }

    /** 舞台高度：球体一套、平铺一套，切换时交给 css 的 height 过渡 */
    function applyHeight() {
      var h = st.target > 0.4 ? st.gridH : st.baseH;
      var px = h + 'px';
      if (host.style.height !== px) host.style.height = px;
    }

    function setTarget(v) {
      v = clamp(v, 0, 1);
      if (v === st.target) return;
      st.target = v;

      var grid = v > 0.4;
      host.classList.toggle('is-grid', grid);
      applyHeight();
      syncOut();

      var mode = grid ? 'grid' : 'sphere';
      if (mode !== st.mode) {
        st.mode = mode;
        if (opt.onMode) opt.onMode(mode);
      }
    }

    /* ------------------------------ 逐帧 ------------------------------ */
    function pose(t) {
      var ca = Math.cos(st.ax), sa = Math.sin(st.ax);
      var cb = Math.cos(st.ay), sb = Math.sin(st.ay);
      var d = t.d;

      // 绕 y 轴（自转）再绕 x 轴（俯仰）
      var x1 = d[0] * cb + d[2] * sb;
      var z1 = -d[0] * sb + d[2] * cb;
      var y1 = d[1];
      var y2 = y1 * ca - z1 * sa;
      var z2 = y1 * sa + z1 * ca;

      var px = x1 * st.R;
      var py = y2 * st.R;
      var pz = z2 * st.R;
      // 贴住球面的切平面，但只收 0.82：完全贴合时相邻两张的平面在球面处相交，
      // 边缘卡片侧成一条线插进邻卡里——这就是「穿模」的观感来源
      var rx = Math.asin(clamp(-y2, -1, 1)) * 0.82;
      var ry = Math.atan2(x1, z2) * 0.82;
      // 透视会把正前方那张放大 1.3 倍，看着比周围大一圈；
      // 按 z 轻微回缩一点，远近差还在，但不会有一张跳出来
      var sc = t.s * (1 - z2 * 0.07);

      // 0 = 球体，1 = 网格；每张按 delay 错开一点
      var m = t.gone ? 0 : clamp((st.prog - t.delay) / (1 - 0.32), 0, 1);
      if (!reduce) m = ease(m);

      if (m > 0) {
        var g = st.grid[t.i];
        px += (g.x - px) * m;
        py += (g.y - py) * m;
        pz += (0 - pz) * m;
        sc += (g.sc - sc) * m;
        rx *= 1 - m;
        ry = wrap(ry) * (1 - m);
      }

      var tr = 'translate3d(' + n1(px) + 'px,' + n1(py) + 'px,' + n1(pz) + 'px)' +
        ' rotateY(' + n3(ry) + 'rad) rotateX(' + n3(rx) + 'rad) scale(' + n3(sc) + ')';
      if (tr !== t.lastT) {
        t.el.style.transform = tr;
        t.lastT = tr;
      }

      // 纵深只靠明暗：光从正面来——正面清楚，边缘转暗，背面沉进阴影里
      var veil = (z2 >= 0 ? (1 - z2) * 0.34 : 0.34 + (-z2) * 0.42) * (1 - m);
      veil = Math.round(veil * 40) / 40;
      if (veil !== t.lastV) {
        t.veil.style.opacity = veil;
        t.lastV = veil;
      }

      var capOn = m > 0.62;
      if (capOn !== t.capOn) {
        t.cap.style.opacity = capOn ? 1 : 0;
        t.capOn = capOn;
      }
    }

    function draw() {
      for (var i = 0; i < N; i++) pose(tiles[i]);
    }

    function frame(now) {
      st.raf = requestAnimationFrame(frame);
      if (!st.on || document.hidden) { st.last = 0; return; }

      var ds = st.last ? Math.min(0.05, (now - st.last) / 1000) : 0.016;
      var k = ds * 60;                     // 折算成「60fps 下的帧数」，速度与刷新率无关
      st.last = now;

      // 滚轮推进的形态进度带一点惯性追上来
      if (st.prog !== st.target) {
        st.prog += (st.target - st.prog) * (1 - Math.pow(0.93, k));
        if (Math.abs(st.target - st.prog) < 0.0015) st.prog = st.target;
      }

      if (!st.drag && st.prog < 0.02) {
        st.ay += st.vy * k;
        st.ax = clamp(st.ax + st.vx * k, -0.8, 0.8);
        st.vy *= Math.pow(0.94, k);
        st.vx *= Math.pow(0.9, k);
        if (!reduce && Math.abs(st.vy) < 0.012) st.ay += SPIN * ds;
        st.ax += (TILT - st.ax) * (1 - Math.pow(0.97, k));
      }

      draw();
    }

    /* ------------------------------ 交互 ------------------------------ */
    function hideHint() {
      if (st.hinted) return;
      st.hinted = true;
      hint.classList.add('is-off');
    }

    function onDown(e) {
      if (e.button) return;
      st.suppress = false;
      st.drag = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, id: e.pointerId, moved: false, t: nowMs() };
      st.vx = 0;
      st.vy = 0;
    }

    function onMove(e) {
      var D = st.drag;
      if (!D) return;

      var dx = e.clientX - D.lx;
      var dy = e.clientY - D.ly;

      if (!D.moved && Math.abs(e.clientX - D.x) + Math.abs(e.clientY - D.y) > 6) {
        D.moved = true;
        try { host.setPointerCapture(D.id); } catch (err) { /* 老浏览器忽略 */ }
        host.classList.add('is-drag');
        hideHint();
      }

      if (D.moved && st.prog < 0.25) {
        var kk = 2.4 / Math.max(300, st.R * 2.2);
        // 拖动过程中不能截断位移：鼠标甩得快时 dx 很大，
        // 一 clamp 就会「球跟不上手」。上限只在松手后当惯性时才用（见 onUp）
        st.vy = dx * kk;
        st.vx = -dy * kk * (e.pointerType === 'mouse' ? 1 : 0);
        st.ay += st.vy;
        st.ax = clamp(st.ax + st.vx, -0.8, 0.8);
        st.suppress = true;
      }

      D.lx = e.clientX;
      D.ly = e.clientY;
      D.t = nowMs();
    }

    function onUp() {
      var D = st.drag;
      st.drag = null;
      // 松手前若已经停住（超过 90ms 没动），就别再甩出去
      if (D && nowMs() - D.t > 90) {
        st.vy = 0;
        st.vx = 0;
      }
      st.vy = clamp(st.vy, -0.12, 0.12);
      st.vx = clamp(st.vx, -0.06, 0.06);
      host.classList.remove('is-drag');
    }

    function onWheel(e) {
      var d = e.deltaMode === 1 ? e.deltaY * 18
        : e.deltaMode === 2 ? e.deltaY * host.clientHeight
        : e.deltaY;
      if (!d) return;

      // 两端交给页面滚动：球体再往上、网格再往下都不拦
      if ((st.target <= 0.0001 && d < 0) || (st.target >= 0.9999 && d > 0)) return;

      e.preventDefault();
      hideHint();
      setTarget(st.target + d / 520);
    }

    host.addEventListener('pointerdown', onDown);
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerup', onUp);
    host.addEventListener('pointercancel', onUp);
    host.addEventListener('wheel', onWheel, { passive: false });
    host.addEventListener('click', function (e) {
      // 拖完手一松会补一个 click，别让它跳走
      if (!st.suppress) return;
      e.preventDefault();
      st.suppress = false;
    }, true);
    // 拖动时别选中文字、别触发浏览器自带的图片拖拽
    host.addEventListener('dragstart', function (e) { e.preventDefault(); });

    // ResizeObserver 只认宽度：切换球体/网格时 height 要做 0.7s 过渡，
    // 不加这个判断就会在那 0.7 秒里每帧重排一遍（40 张卡全量重写），非常卡
    var lastW = 0;
    var ro = window.ResizeObserver ? new ResizeObserver(function () {
      var w = host.clientWidth;
      if (Math.abs(w - lastW) < 2) return;
      lastW = w;
      layout();
    }) : null;
    if (ro) ro.observe(host);
    else window.addEventListener('resize', layout);

    var io = window.IntersectionObserver ? new IntersectionObserver(function (en) {
      st.on = en[0].isIntersecting;
      if (st.on) st.last = 0;
    }, { rootMargin: '140px 0px' }) : null;
    if (io) io.observe(host);

    layout();
    // 首屏之外的区块：进场时再用 0.5s 依次亮起，避免「凭空出现」
    tiles.forEach(function (t, i) {
      t.el.style.transitionDelay = Math.min(i, 18) * 26 + 'ms';
    });
    setTimeout(function () {
      tiles.forEach(function (t) { t.el.style.transitionDelay = ''; });
    }, 1400);
    requestAnimationFrame(function () { host.classList.add('is-live'); });
    st.raf = requestAnimationFrame(frame);

    return {
      setMode: function (m) { setTarget(m === 'grid' ? 1 : 0); },
      toggle: function () { setTarget(st.target > 0.5 ? 0 : 1); },
      mode: function () { return st.mode; },
      progress: function () { return st.target; },
      relayout: layout,
      destroy: function () {
        if (st.raf) cancelAnimationFrame(st.raf);
        if (ro) ro.disconnect();
        if (io) io.disconnect();
        if (world.parentNode) world.parentNode.removeChild(world);
      }
    };
  }

  YY.orb = { create: create };
})(window.YY);
