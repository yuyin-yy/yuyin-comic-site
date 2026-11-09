/* ==========================================================================
 * pages/updates.js · 最近更新
 * --------------------------------------------------------------------------
 * 1. 轮播：站内插画（imgs/banner/art-01…08），满幅铺底，4.5 秒自动切换；
 *    悬停暂停、箭头/圆点/左右键可切，底部有一条与计时同步的进度条。
 *    除第一张外都先只带 data-src，轮到它前面一张时才真正下载。
 * 2. 本周热门：按热度取前 3。
 * 3. 更新流：**近一个季度**用完整列表（按天分组），**更早**的折成一行五列的卡片墙，
 *    这样长列表不会一直拉下去，老作品也能带图露出。
 *
 * 依赖：YY
 * 暴露：YY.pages.updates.init()
 * ========================================================================== */
(function (YY) {
  'use strict';

  var $ = YY.$, esc = YY.esc, icons = YY.icons;
  var IMG_FALLBACK = 'onerror="this.onerror=null;this.src=\'imgs/placeholder.svg\'"';

  var AUTOPLAY = 4500;   // 自动轮播间隔（毫秒），进度条同步这个时长
  var QUARTER = 90;      // 「近一个季度」的天数，超出后改用卡片墙

  // 轮播插画：public/imgs/banner/art-01…0N，每张两档（1600 / 900）。
  // 换图只要按同样命名丢进去，再改这里的张数。
  var ART_N = 8;
  function artSrc(i, small) {
    var n = i + 1 < 10 ? '0' + (i + 1) : String(i + 1);
    return 'imgs/banner/art-' + n + (small ? '-sm' : '') + '.webp';
  }

  /** 卡片墙每次加载多少部：列数 × 4 行。
      按列数算而不是写死 20，手机端 3/2 列时才不会每次都在末行留半行空位；桌面仍是 20。 */
  function cardStep() {
    var c = YY.card && YY.card.cols ? YY.card.cols() : 5;
    return c * 4;
  }

  /** 日期 → 「今天 / 昨天 / 10月28日 周三」 */
  function dayLabel(dateStr) {
    if (!dateStr) return '更早';
    var d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return dateStr;
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var diff = Math.round((today - d) / 86400000);
    if (diff === 0) return '今天';
    if (diff === 1) return '昨天';
    var week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + week;
  }

  /** 日期字符串是否在最近 n 天内 */
  function within(dateStr, days) {
    if (!dateStr) return false;
    var t = new Date(dateStr + 'T00:00:00').getTime();
    if (isNaN(t)) return false;
    return Date.now() - t <= days * 86400000;
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function init() {
    // 更新流只统计有更新时间的作品（其余是还没补全详情的条目）
    var data = YY.data.filter(function (x) { return x.updated; });
    if (!data.length) return;

    var byFresh = data.slice().sort(function (a, b) {
      return new Date(b.updated || 0) - new Date(a.updated || 0) || b.heat - a.heat;
    });

    /* ------------------------- 轮播 ------------------------- */
    var slideHost = $('#carSlides');
    var count = ART_N;

    slideHost.innerHTML = new Array(count).fill(0).map(function (_, i) {
      var big = artSrc(i), small = artSrc(i, true);
      // 第一张直接给 src（首屏必须立刻有画面），其余等轮到再换上去
      var attr = i === 0
        ? ' src="' + big + '" srcset="' + small + ' 900w, ' + big + ' 1600w"'
        : ' data-src="' + big + '" data-srcset="' + small + ' 900w, ' + big + ' 1600w"';
      return '<div class="car-slide' + (i === 0 ? ' on' : '') + '" role="group" ' +
          'aria-roledescription="slide" aria-label="第 ' + (i + 1) + ' 张，共 ' + count + ' 张">' +
        '<img class="car-img" alt="站内插画 ' + (i + 1) + '" ' +
          'sizes="(max-width: 1080px) 96vw, 900px"' +
          ' decoding="async" ' + (i === 0 ? 'fetchpriority="high"' : '') + attr + '>' +
        '<span class="car-cap"><i></i>插画选<em>ILLUSTRATION</em></span>' +
      '</div>';
    }).join('');

    var dots = $('#carDots');
    dots.innerHTML = new Array(count).fill(0).map(function (_, i) {
      return '<button type="button" role="tab" data-i="' + i + '" aria-current="' +
        (i === 0) + '" aria-label="第 ' + (i + 1) + ' 张插画"></button>';
    }).join('') + '<span class="car-idx" id="carIdx">01 / ' + pad(count) + '</span>';

    var nodes = YY.$$('.car-slide', slideHost);
    var idxEl = $('#carIdx');
    var prog = $('#carProg');
    var cur = 0;
    var timer = null;

    /** 进度条：与自动播放同步，切张时重新计时 */
    function resetProg(run) {
      if (!prog) return;
      prog.style.transition = 'none';
      prog.style.width = '0%';
      // 强制一次重排，让上面的「归零」立即生效，否则宽度过渡不会重播
      void prog.offsetWidth;
      if (run) {
        prog.style.transition = 'width ' + AUTOPLAY + 'ms linear';
        prog.style.width = '100%';
      }
    }

    /** 悬停暂停时把进度条停在当前位置 */
    function freezeProg() {
      if (!prog) return;
      var box = prog.parentNode.getBoundingClientRect().width || 1;
      var w = prog.getBoundingClientRect().width / box * 100;
      prog.style.transition = 'none';
      prog.style.width = w + '%';
    }

    /** 提前把下一张的地址挂上去。除首图外都先是 data-src，
        轮播到它之前的那一张时才真正开始下载，首屏不用等 1.5MB 的图。 */
    function warm(i) {
      var n = nodes[(i + nodes.length) % nodes.length];
      var img = n && n.querySelector('img');
      if (!img || !img.getAttribute('data-src')) return;
      img.src = img.getAttribute('data-src');
      img.srcset = img.getAttribute('data-srcset');
      img.removeAttribute('data-src');
      img.removeAttribute('data-srcset');
    }

    function go(i) {
      cur = (i + nodes.length) % nodes.length;
      // 点圆点可能一下跳很远，目标这张也可能还没下载过
      warm(cur);
      nodes.forEach(function (n, idx) { n.classList.toggle('on', idx === cur); });
      YY.$$('button', dots).forEach(function (d, idx) {
        d.setAttribute('aria-current', String(idx === cur));
      });
      if (idxEl) idxEl.textContent = pad(cur + 1) + ' / ' + pad(nodes.length);
      warm(cur + 1);
    }

    function play() {
      stop();
      timer = setInterval(function () { go(cur + 1); resetProg(true); }, AUTOPLAY);
      resetProg(true);
    }

    function stop() {
      if (timer) clearInterval(timer);
      timer = null;
      freezeProg();
    }

    $('#carPrev').addEventListener('click', function () { go(cur - 1); play(); });
    $('#carNext').addEventListener('click', function () { go(cur + 1); play(); });
    dots.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-i]');
      if (!b) return;
      go(parseInt(b.getAttribute('data-i'), 10));
      play();
    });

    var box = $('#carousel');
    box.addEventListener('mouseenter', stop);
    box.addEventListener('mouseleave', play);

    // 触屏左右划动切换：手机上圆点小，滑动才是本能
    var tStartX = 0, tStartY = 0;
    box.addEventListener('touchstart', function (e) {
      var t = e.touches[0];
      tStartX = t.clientX;
      tStartY = t.clientY;
    }, { passive: true });
    box.addEventListener('touchend', function (e) {
      var t = e.changedTouches[0];
      var dx = t.clientX - tStartX;
      var dy = t.clientY - tStartY;
      // 横向位移够大、且明显比纵向大，才算划动，避免和页面滚动打架
      if (Math.abs(dx) < 44 || Math.abs(dx) < Math.abs(dy)) return;
      go(cur + (dx < 0 ? 1 : -1));
      play();
    }, { passive: true });

    // 页签不可见时停掉定时器，省电也避免回来时跳帧
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop(); else play();
    });
    document.addEventListener('keydown', function (e) {
      if (e.target && /input|textarea/i.test(e.target.tagName)) return;
      if (e.key === 'ArrowLeft') { go(cur - 1); play(); }
      if (e.key === 'ArrowRight') { go(cur + 1); play(); }
    });

    if (nodes.length > 1) play();
    warm(1);

    /* ------------------------- 本周热门 ------------------------- */
    $('#weekList').innerHTML = YY.data.slice(0, 3).map(function (x, i) {
      return '<a class="week-item" href="index02.html?id=' + x.id + '">' +
        '<em>' + (i + 1) + '</em>' +
        '<img src="' + x.cover + '" alt="" loading="lazy" referrerpolicy="no-referrer" ' + IMG_FALLBACK + '>' +
        '<span class="wt"><b>' + esc(x.title) + '</b>' +
          '<small>' + esc((x.tags || []).slice(0, 2).join(' / ') || '漫画') + ' · ' +
          YY.fmtHeat(x.heat) + '</small></span>' +
      '</a>';
    }).join('');

    /* ------------------------- 更新流 ------------------------- */
    var feed = $('#updBody');

    // near：近一个季度，用完整列表；old：更早，用卡片墙
    var nearItems = byFresh.filter(function (x) { return within(x.updated, QUARTER); });
    var oldItems = byFresh.filter(function (x) { return !within(x.updated, QUARTER); });
    var shownOld = cardStep();

    function rowHTML(x) {
      return '<div class="upd-row">' +
        '<a href="index02.html?id=' + x.id + '">' +
          '<img src="' + x.cover + '" alt="" loading="lazy" referrerpolicy="no-referrer" ' + IMG_FALLBACK + '>' +
        '</a>' +
        '<div class="upd-t">' +
          '<b><a href="index02.html?id=' + x.id + '">' + esc(x.title) + '</a></b>' +
          '<p>' + esc((x.tags || []).slice(0, 3).join(' · ') || '漫画') +
            ' · ' + esc(x.status || '连载中') + '</p>' +
        '</div>' +
        '<div class="upd-ch">' + esc(x.chapter || '连载中') +
          '<small>' + esc(x.updated || '') + ' 更新</small></div>' +
        (x.readUrl
          ? '<a class="upd-go" href="' + esc(x.readUrl) + '" target="_blank" rel="noopener noreferrer">' +
            '阅读最新' + icons.arrow + '</a>'
          : '<a class="upd-go" href="index02.html?id=' + x.id + '">查看详情' + icons.arrow + '</a>') +
      '</div>';
    }

    /** 更早的作品：一行五列，带封面，点封面进详情 */
    function cardHTML(x) {
      return '<a class="uc" href="index02.html?id=' + x.id + '">' +
        '<span class="uc-cover">' +
          '<img src="' + x.cover + '" alt="《' + esc(x.title) + '》封面" loading="lazy" ' +
            'referrerpolicy="no-referrer" ' + IMG_FALLBACK + '>' +
        '</span>' +
        '<b>' + esc(x.title) + '</b>' +
        '<span class="uc-meta">' + esc(x.updated || '') + '</span>' +
      '</a>';
    }

    function paint() {
      var html = '';
      var lastDay = null;

      // 近一个季度：按天分组，信息完整
      nearItems.forEach(function (x) {
        var label = dayLabel(x.updated);
        if (label !== lastDay) {
          var count = nearItems.filter(function (y) { return dayLabel(y.updated) === label; }).length;
          html += '<div class="upd-day">' + label + '<i>' + count + ' 部更新</i></div>';
          lastDay = label;
        }
        html += rowHTML(x);
      });

      if (!nearItems.length) {
        html += '<div class="upd-day">近三个月暂无更新<i>下面按时间倒序列出更早的作品</i></div>';
      }

      // 更早：卡片墙
      if (oldItems.length) {
        html += '<div class="upd-divider">更早更新<i>共 ' + oldItems.length + ' 部</i></div>' +
          '<div class="upd-cards">' + oldItems.slice(0, shownOld).map(cardHTML).join('') + '</div>';
      }

      feed.innerHTML = html;
      $('#updCount').textContent =
        '近三个月 ' + nearItems.length + ' 部 · 更早 ' + oldItems.length + ' 部';
      $('#updMore').style.display = shownOld < oldItems.length ? 'flex' : 'none';
    }

    $('#updMore').addEventListener('click', function () {
      shownOld += cardStep();
      paint();
    });

    paint();

    // 列数变化后每次加载的张数（列数 × 4 行）也变了，
    // 从第一批重新画，否则旧批次 20 张在 3 列下仍会剩 1 格
    YY.card.watchCols(function () {
      shownOld = cardStep();
      paint();
    });
  }

  YY.pages = YY.pages || {};
  YY.pages.updates = { init: init };
})(window.YY);
