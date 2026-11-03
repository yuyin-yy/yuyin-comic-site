/* ==========================================================================
 * pages/home.js · 首页
 * --------------------------------------------------------------------------
 * 1. Hero 区搜索与统计数字
 * 2. 「人气推荐」网格 + 综合/国漫/日漫/恋爱 四个切换
 * 3. 侧栏：今日排行榜、最近更新
 * 4. 底部「最近更新」大网格
 *
 * 依赖：YY、YY.card、YY.nav
 * 暴露：YY.pages.home.init()
 * ========================================================================== */
(function (YY) {
  'use strict';

  var $ = YY.$, esc = YY.esc, icons = YY.icons;

  /** 按更新时间倒序 */
  function byFresh(a, b) {
    return new Date(b.updated || 0) - new Date(a.updated || 0);
  }

  function init() {
    var data = YY.data;

    /* ------------------------- 首屏统计 ------------------------- */
    $('#statCount').textContent = data.length;
    $('#statOngoing').textContent = data.filter(function (x) {
      return x.status === '连载中';
    }).length;
    var tagSet = {};
    data.forEach(function (x) {
      (x.tags || []).forEach(function (t) { tagSet[t] = 1; });
    });
    $('#statTag').textContent = Object.keys(tagSet).length;

    /* ------------------------- 人气推荐 ------------------------- */
    // 一屏 5 列 × 4 行：比原来多一行，右侧栏不再孤零零地多出一大块空白
    var HOME_COUNT = 20;
    var gridHost = $('#homeGrid');

    /** 当前网格列数，与 css 断点保持一致（1080 → 4 列，720 → 3 列，460 → 2 列） */
    function cols() {
      return YY.card.cols();
    }

    /** 手机端只放 12 部（3 列 4 行 / 2 列 6 行），整页更短。
        末行零头由 YY.card.grid 统一裁掉，这里只负责数量上限。 */
    function fit(list) {
      return cols() <= 3 ? list.slice(0, 12) : list;
    }

    function paint(list) {
      if (!list.length) {
        gridHost.innerHTML = '<div class="empty">' + icons.empty +
          '<b>这个分类暂时没有作品</b><p>换一个标签看看，或去分类页按条件筛选</p></div>';
        return;
      }
      YY.card.grid(gridHost, fit(list));
    }

    // 切换分组：综合 / 国漫 / 日漫 / 恋爱
    // 地区用的是数据里的真实值（国漫 / 日韩 / 欧美 / 港台），
    // 之前写成「日漫」导致切过去一片空白
    var groups = {
      all: function () { return data.slice(0, HOME_COUNT); },
      guo: function () {
        return data.filter(function (x) { return x.region === '国漫'; }).slice(0, HOME_COUNT);
      },
      ri: function () {
        return data.filter(function (x) {
          return x.region === '日韩' || x.region === '日漫' || x.region === '韩漫';
        }).slice(0, HOME_COUNT);
      },
      love: function () {
        return data.filter(function (x) {
          return (x.tags || []).indexOf('恋爱') > -1;
        }).slice(0, HOME_COUNT);
      }
    };

    var activeGroup = 'all';
    paint(groups[activeGroup]());

    var tabs = YY.$$('#homeTabs button');
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        tabs.forEach(function (o) { o.setAttribute('aria-selected', 'false'); });
        t.setAttribute('aria-selected', 'true');
        activeGroup = t.getAttribute('data-group');
        paint(groups[activeGroup]());
      });
    });

    // 横竖屏切换会改变列数，零头需要重算一次
    var lastCols = cols(), resizeTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (cols() === lastCols) return;
        lastCols = cols();
        paint(groups[activeGroup]());
      }, 160);
    });

    /* ------------------------- 侧栏 ------------------------- */
    YY.card.rank($('#homeRank'), data.slice(0, 8));

    var updates = data.slice().sort(byFresh).slice(0, 6);
    $('#homeUpdates').innerHTML = updates.map(function (x) {
      return '<a class="update-item" href="index02.html?id=' + x.id + '">' +
        '<span class="u-title">' + esc(x.title) + '</span>' +
        '<span class="u-time">' + YY.daysAgo(x.updated) + '</span></a>';
    }).join('');

    /* ------------------------- 底部网格 ------------------------- */
    YY.card.grid($('#homeLatest'), data.slice().sort(byFresh).slice(0, 10));

    /* ------------------------- Hero 搜索 ------------------------- */
    var input = $('#heroSearch');
    var go = function () {
      var q = (input.value || '').trim();
      location.href = 'category.html' + (q ? '?q=' + encodeURIComponent(q) : '');
    };
    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') go();
      });
    }
    var btn = $('#heroSearchBtn');
    if (btn) btn.addEventListener('click', go);
  }

  YY.pages = YY.pages || {};
  YY.pages.home = { init: init };
})(window.YY);
