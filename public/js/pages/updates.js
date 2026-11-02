/* ==========================================================================
 * pages/updates.js · 最近更新
 * --------------------------------------------------------------------------
 * 1. 轮播：取最近更新的 5 部，每 3 秒自动切换；悬停暂停、箭头/圆点/左右键可切，
 *    底部有一条与计时同步的进度条，右侧是整幅封面（带缓慢推镜）。
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

  var AUTOPLAY = 3000;   // 自动轮播间隔（毫秒），进度条同步这个时长
  var QUARTER = 90;      // 「近一个季度」的天数，超出后改用卡片墙
  var CARD_STEP = 20;    // 卡片墙每次加载多少部（一行五列，四行）

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
    var slides = byFresh.slice(0, 5);
    var slideHost = $('#carSlides');

    slideHost.innerHTML = slides.map(function (x, i) {
      return '<div class="car-slide' + (i === 0 ? ' on' : '') + '">' +
        // 底图只做氛围（CSS 里压暗 + 模糊），右侧是整幅封面
        '<div class="art" style="background-image:url(\'' + x.cover + '\')"></div>' +
        '<a class="car-art" href="index02.html?id=' + x.id + '" tabindex="-1" aria-hidden="true">' +
          '<img src="' + x.cover + '" alt="《' + esc(x.title) + '》封面" ' +
            'referrerpolicy="no-referrer" ' + IMG_FALLBACK + '>' +
        '</a>' +
        '<div class="car-info">' +
          '<span class="car-kicker"><i></i>最近更新 · TOP ' + (i + 1) + '</span>' +
          '<h2><a href="index02.html?id=' + x.id + '">' + esc(x.title) + '</a></h2>' +
          '<p class="ch">最新 <b>' + esc(x.chapter || '连载中') + '</b> · ' +
            esc(YY.daysAgo(x.updated) || x.updated || '') + '更新</p>' +
          (x.desc ? '<p class="cdesc">' + esc(x.desc) + '</p>' : '') +
          '<div class="ctags">' + (x.tags || []).slice(0, 3).map(function (t) {
            return '<span>' + esc(t) + '</span>';
          }).join('') + '</div>' +
          '<div class="car-acts">' +
            (x.readUrl
              ? '<a class="car-btn primary" href="' + esc(x.readUrl) + '" target="_blank" ' +
                'rel="noopener noreferrer">' + icons.play + '<span>阅读最新</span></a>'
              : '') +
            '<a class="car-btn" href="index02.html?id=' + x.id + '">查看详情</a>' +
          '</div>' +
          '<div class="car-meta">' +
            '<div><span>作者</span><b>' + esc(x.author || '原站未标注') + '</b></div>' +
            '<div><span>热度</span><b class="hot">' + YY.fmtHeat(x.heat) + '</b></div>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    var dots = $('#carDots');
    dots.innerHTML = slides.map(function (x, i) {
      return '<button type="button" role="tab" data-i="' + i + '" aria-current="' +
        (i === 0) + '" aria-label="第 ' + (i + 1) + ' 张：' + esc(x.title) + '"></button>';
    }).join('') + '<span class="car-idx" id="carIdx">01 / ' + pad(slides.length) + '</span>';

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

    function go(i) {
      cur = (i + nodes.length) % nodes.length;
      nodes.forEach(function (n, idx) { n.classList.toggle('on', idx === cur); });
      YY.$$('button', dots).forEach(function (d, idx) {
        d.setAttribute('aria-current', String(idx === cur));
      });
      if (idxEl) idxEl.textContent = pad(cur + 1) + ' / ' + pad(nodes.length);
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
    var shownOld = CARD_STEP;

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
      shownOld += CARD_STEP;
      paint();
    });

    paint();
  }

  YY.pages = YY.pages || {};
  YY.pages.updates = { init: init };
})(window.YY);
