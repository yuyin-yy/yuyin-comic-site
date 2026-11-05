/* ==========================================================================
 * pages/rank.js · 排行榜
 * --------------------------------------------------------------------------
 * 两种维度组合出榜单：
 *   board  榜单类型：hot 人气 / score 评分 / fresh 更新 / end 完结
 *   range  时间范围：day 今日 / week 本周 / month 本月 / all 总榜
 *
 * 版式：冠军海报 + TOP 8 表格 + 「更多排行」一行五列的图片网格（第 9 名往后）。
 *
 * 时间范围的实现要点：先把「本期有更新」的作品排在前面，再按榜单规则补足其余作品。
 * 这样切到「本周 / 本月」时顺序会真的变化，又不会因为样本太少出现空榜。
 *
 * 依赖：YY
 * 暴露：YY.pages.rank.init()
 * ========================================================================== */
(function (YY) {
  'use strict';

  var $ = YY.$, $$ = YY.$$, esc = YY.esc;

  var IMG_FALLBACK = 'onerror="this.onerror=null;this.src=\'imgs/placeholder.svg\'"';

  var TOP_N = 8;      // 表格展示前 8 名
  var GRID_ROWS = 4;  // 「更多排行」固定 4 行

  /** 「更多排行」当前列数：直接复用公共断点（card.cols），
      避免 JS 和 rank.css 各写一套，缩放时两边判断不一致会重新出现末行空位 */
  function gridCols() {
    return YY.card.cols();
  }

  /** 榜单类型定义 */
  var BOARDS = {
    hot: { label: '人气榜', sort: function (a, b) { return b.heat - a.heat; } },
    score: {
      label: '评分榜',
      sort: function (a, b) { return (b.rating || 0) - (a.rating || 0) || b.heat - a.heat; }
    },
    fresh: {
      label: '更新榜',
      sort: function (a, b) { return new Date(b.updated || 0) - new Date(a.updated || 0); }
    },
    end: {
      label: '完结榜',
      filter: function (x) { return x.status === '已完结'; },
      sort: function (a, b) { return b.heat - a.heat; }
    }
  };

  /** 时间范围：天数 */
  var RANGES = {
    day: { label: '今日', days: 3 },
    week: { label: '本周', days: 7 },
    month: { label: '本月', days: 30 },
    all: { label: '总榜', days: 0 }
  };

  function init() {
    var data = YY.data;
    if (!data.length) return;

    var boardKey = BOARDS[YY.param('board')] ? YY.param('board') : 'hot';
    var rangeKey = RANGES[YY.param('range')] ? YY.param('range') : 'all';

    // 高亮当前档位（链接本身就是真实地址，可以直接分享）
    $$('#rankBoards a').forEach(function (a) {
      if (a.getAttribute('data-board') === boardKey) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    $$('#rankRanges a').forEach(function (a) {
      if (a.getAttribute('data-range') === rangeKey) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });

    var board = BOARDS[boardKey];
    var range = RANGES[rangeKey];

    /* ------------------------- 选出榜单数据 ------------------------- */
    var pool = data.filter(board.filter || function () { return true; });
    // 更新榜只排有更新时间的作品，否则「无日期」的条目排序会错乱
    if (boardKey === 'fresh') {
      pool = pool.filter(function (x) { return x.updated; });
    }

    var freshCount = 0;
    if (range.days) {
      var now = Date.now();
      var inRange = [];
      var outRange = [];
      pool.forEach(function (x) {
        var t = x.updated ? new Date(x.updated + 'T00:00:00').getTime() : 0;
        if (t && now - t <= range.days * 86400000) inRange.push(x);
        else outRange.push(x);
      });
      freshCount = inRange.length;
      // 本期更新优先，其余按同一规则补在后面
      pool = inRange.slice().sort(board.sort).concat(outRange.slice().sort(board.sort));
    } else {
      pool = pool.slice().sort(board.sort);
    }

    /* ------------------------- 左侧冠军 ------------------------- */
    var top = pool[0];
    if (top) {
      $('#rankHero').innerHTML =
        '<div class="rank-hero-art" style="background-image:url(\'' + top.cover + '\')">' +
          '<span class="rank-crown">1</span>' +
        '</div>' +
        '<div class="rank-hero-body">' +
          '<h2>' + esc(top.title) + '</h2>' +
          '<div class="rank-hero-tags">' +
            (top.tags || []).slice(0, 3).map(function (t) {
              return '<a href="category.html?tag=' + encodeURIComponent(t) + '">' + esc(t) + '</a>';
            }).join('') +
            (top.region ? '<span>' + esc(top.region) + '</span>' : '') +
          '</div>' +
          '<p class="rank-hero-desc">' + esc(top.desc || '暂无简介。') + '</p>' +
          '<div class="rank-hero-latest">' +
            '<div><b>' + esc(top.chapter || '连载中') + '</b>' +
              '热度 ' + YY.fmtHeat(top.heat) + '</div>' +
            '<a class="go" href="index02.html?id=' + top.id + '">查看详情</a>' +
          '</div>' +
        '</div>';
    }

    /* ------------------------- 中间表格：TOP 8 ------------------------- */
    $('#rankRows').innerHTML = pool.slice(0, TOP_N).map(function (x, i) {
      var rank = i + 1;
      var cls = rank <= 3 ? ' top' + rank : '';
      return '<div class="rank-row">' +
        '<span class="rk' + cls + '">' + rank + '</span>' +
        '<a class="rank-book" href="index02.html?id=' + x.id + '">' +
          '<img src="' + YY.blank + '" data-src="' + x.cover + '" alt="" ' +
            'decoding="async" referrerpolicy="no-referrer" ' + IMG_FALLBACK + '>' +
          '<span class="rb-text"><b>' + esc(x.title) + '</b><small>' +
            esc(x.author || '原站未标注') + ' · ' + esc(x.status || '连载中') + '</small></span>' +
        '</a>' +
        '<span class="rk-tag">' + esc((x.tags || []).slice(0, 2).join(' / ') || '—') + '</span>' +
        '<span class="rk-heat">' + YY.fmtHeat(x.heat) + '</span>' +
      '</div>';
    }).join('');
    YY.card.lazyCovers($('#rankRows'));

    /* ------------------------- 更多排行：第 9 名往后 ------------------------- */
    // 抽成函数：列数随窗口变化，条目数必须在断点变化后重算，
    // 否则电脑端缩成手机宽度、或手机放大成电脑宽度时，末行会重新空出一格
    var grid = $('#rankGrid');
    function paintMore() {
      if (!grid) return;
      var rest = pool.slice(TOP_N, TOP_N + gridCols() * GRID_ROWS);
      grid.innerHTML = rest.map(function (x, i) {
        return '<a class="rc" href="index02.html?id=' + x.id + '" title="' + esc(x.title) + '">' +
          '<span class="rc-cover">' +
            '<img src="' + YY.blank + '" data-src="' + x.cover + '" ' +
              'alt="《' + esc(x.title) + '》封面" decoding="async" ' +
              'referrerpolicy="no-referrer" ' + IMG_FALLBACK + '>' +
            '<span class="rc-no">' + (TOP_N + i + 1) + '</span>' +
          '</span>' +
          '<b>' + esc(x.title) + '</b>' +
          '<span class="rc-meta">' + esc((x.tags || [])[0] || '漫画') + ' · ' +
            '<em>' + YY.fmtHeat(x.heat) + '</em></span>' +
        '</a>';
      }).join('');
      YY.card.lazyCovers(grid);
    }
    paintMore();
    YY.card.watchCols(paintMore);

    /* ------------------------- 右侧：题材与高分 ------------------------- */
    $('#rankTags').innerHTML = YY.tagStats().slice(0, 8).map(function (t) {
      return '<a href="category.html?tag=' + encodeURIComponent(t.tag) + '">' + esc(t.tag) + '</a>';
    }).join('');

    var best = data.slice().sort(function (a, b) {
      return (b.rating || 0) - (a.rating || 0) || b.heat - a.heat;
    }).slice(0, 5);

    $('#rankScore').innerHTML = best.map(function (x, i) {
      return '<a href="index02.html?id=' + x.id + '">' +
        '<em>' + (i + 1) + '</em><span>' + esc(x.title) + '</span>' +
        '<small style="color:var(--accent);font-weight:700">' +
          (Number(x.rating) > 0 ? x.rating.toFixed(1) : '—') + '</small></a>';
    }).join('');

    $('#rankNote').innerHTML = '当前为<b>' + board.label + '</b>（' + range.label + '）。' +
      (range.days
        ? '本期（近 ' + range.days + ' 天内更新）共 <b>' + freshCount +
          '</b> 部，排在本期作品之后的是按同样规则补足的其余作品。'
        : '按作品累计数据排序，热度为原站展示值。') +
      '数据整理自瓜子漫画公开目录。';

    document.title = board.label + ' · 排行榜 · 余音的小破站';
  }

  YY.pages = YY.pages || {};
  YY.pages.rank = { init: init };
})(window.YY);
