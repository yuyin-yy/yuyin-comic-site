/* ==========================================================================
 * ui/poem.js · 尾屏诗句（滚动浮字）
 * --------------------------------------------------------------------------
 * 复刻 nexmoe.com 的「滚到一屏停住、诗句逐句浮现」效果。
 * 原站用 GSAP ScrollTrigger 的 pin + scrub；这里不引第三方库，用等价的两件事实现：
 *
 *   1) 钉屏 —— .poem 撑高（260vh），内部的 .poem-pin 用 position: sticky 咬住视口；
 *   2) 跟手 —— 把「已滚过的行程 / 总行程」换算成 0~1 的进度，逐帧写入每个字的透明度。
 *
 * 注意：滚轮从未被拦截。所谓「显示完才能继续下滑」是观感——画面钉住了，
 * 滚动条照走，滚满这段行程才放开。真正的锁滚动（preventDefault）会破坏
 * 触控板惯性、键盘翻页和无障碍，不做。
 *
 * 逐字而不是逐列：把每列拆成 <span>，按列内序号错开各自的起点，
 * 同一列的字就会像被一笔一笔写出来，而不是整块淡入。
 *
 * 依赖：无
 * 暴露：YY.poem.init()
 * ========================================================================== */
(function (YY) {
  'use strict';

  /* 每列诗句的浮现区间（占整段行程的比例）。
     对应原站 timeline 的节奏：每段耗时 1、彼此间隔 0.5，
     归一化后留出末尾 30% 作为定格阅读时间。 */
  var STEPS = [
    [-0.16, 0.05],   // 起手大幅提前：钉住那一刻第一列已经写完，不会只露两三个字
    [0.20, 0.34],
    [0.40, 0.54],
    [0.60, 0.74]
  ];

  /* 主句浮现的同时，前几列压暗到六成，把视线留给最后一句。
     白字压在深色底上，压得太狠就只剩影子，六成是还能回看的底线。 */
  var DIM = [0.60, 0.70];
  var CREDIT = [0.70, 0.80];
  var HINT = [0.00, 0.05];

  /* 一个字占本列时长的比例：前 62% 用来依次起步，末尾 38% 是单字淡入的跨度，
     这样最后一个字正好在列结束时写完。 */
  var LEAD = 0.62;
  var FADE = 0.38;

  var RISE = 16;   // 每个字浮现时的初始下移量（px）

  /** 进度映射：p 落在 [a, b] 内线性取 0~1，区间外截断 */
  function ramp(p, a, b) {
    if (p <= a) return 0;
    if (p >= b) return 1;
    return (p - a) / (b - a);
  }

  /** 平滑首尾：滚动跟手时，线性起止会有明显的「咔」一下 */
  function smooth(t) {
    return t * t * (3 - 2 * t);
  }

  /** 写样式并缓存，值没变就不碰 DOM */
  function apply(el, op, dy) {
    var o = op.toFixed(3);
    if (el._o !== o) {
      el._o = o;
      el.style.opacity = o;
    }
    if (dy === null) return;
    var y = dy.toFixed(1);
    if (el._y !== y) {
      el._y = y;
      el.style.transform = 'translate3d(0,' + y + 'px,0)';
    }
  }

  /** 把一列文字拆成逐字的 span，返回字数组 */
  function split(line) {
    var text = line.textContent || '';
    var chars = [];
    var frag = document.createDocumentFragment();
    for (var i = 0; i < text.length; i++) {
      var s = document.createElement('span');
      s.className = 'poem-ch';
      s.textContent = text.charAt(i);
      frag.appendChild(s);
      chars.push(s);
    }
    line.textContent = '';
    line.appendChild(frag);
    return chars;
  }

  function init() {
    var section = document.getElementById('poem');
    if (!section) return;

    var pin = section.querySelector('.poem-pin');
    var lineEls = [].slice.call(section.querySelectorAll('[data-poem-line]'));
    if (!pin || !lineEls.length) return;

    var credit = section.querySelector('[data-poem-credit]');
    var hint = section.querySelector('[data-poem-hint]');

    // 系统开启「减少动效」时不钉屏，交给 CSS 静态呈现
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reduce && reduce.matches) return;   // 静态版交给 CSS 的 reduce 分支

    // 拆字：拆完才知道每列几个字，起点才能按字错开
    var lines = lineEls.map(function (el, i) {
      var step = STEPS[i] || STEPS[STEPS.length - 1];
      return {
        el: el,
        chars: split(el),
        a: step[0],
        b: step[1],
        dim: i < lineEls.length - 1   // 最后一列不压暗
      };
    });

    var travel = 1;      // 除首屏之外的可滚行程（px）
    var ticking = false; // rAF 节流
    var bound = false;   // 是否已挂 scroll 监听

    function measure() {
      // 用钉住层自身高度而不是 innerHeight：移动端 100svh 与 innerHeight 不等
      travel = section.offsetHeight - pin.offsetHeight;
      if (travel < 1) travel = 1;
    }

    function paint() {
      var p = -section.getBoundingClientRect().top / travel;
      p = p < 0 ? 0 : (p > 1 ? 1 : p);

      // 逐列推进：列内每个字按序号错开起点，列容器只负责最后的压暗
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var span = line.b - line.a;
        var n = line.chars.length;
        var leadStart = line.a;
        var leadSpan = span * LEAD;
        var fadeSpan = span * FADE;

        for (var j = 0; j < n; j++) {
          // 每个字的起点按序号线性错开，窗口末端固定为 fadeSpan
          var start = leadStart + (n > 1 ? (j / n) * leadSpan : 0);
          var t = smooth(ramp(p, start, start + fadeSpan));
          apply(line.chars[j], t, (1 - t) * RISE);
        }

        // 列容器只负责「压暗」，与字的透明度自然相乘。
        // 压到四成：再低就只剩影子，读不出字了；最后一列不压。
        var dim = line.dim ? 1 - 0.42 * smooth(ramp(p, DIM[0], DIM[1])) : 1;
        apply(line.el, dim, null);
      }

      if (credit) apply(credit, smooth(ramp(p, CREDIT[0], CREDIT[1])), null);
      if (hint) apply(hint, 1 - smooth(ramp(p, HINT[0], HINT[1])), null);

      // 同一份进度喂给背景动态层：越往后风越大，头发摆得越开
      if (YY.poemFx) YY.poemFx.setProgress(p);
    }

    function onScroll() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(function () {
        ticking = false;
        paint();
      });
    }

    function bind() {
      if (bound) return;
      bound = true;
      window.addEventListener('scroll', onScroll, { passive: true });
    }

    function unbind() {
      if (!bound) return;
      bound = false;
      window.removeEventListener('scroll', onScroll);
    }

    // 只在接近这一屏时挂监听，离开后摘掉，避免全站滚动都跑这里的计算
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (list) {
        if (list[0].isIntersecting) {
          measure();
          paint();
          bind();
        } else {
          unbind();
        }
      }, { rootMargin: '400px 0px' }).observe(section);
    } else {
      bind();
    }

    window.addEventListener('resize', function () {
      measure();
      paint();
    });

    measure();
    paint();
  }

  YY.poem = { init: init };
})(window.YY);
