/* ==========================================================================
 * pages/category.js · 分类页
 * --------------------------------------------------------------------------
 * 五行筛选（分类 / 地区 / 受众 / 进度 / 排序）+ 关键词 + 分页。
 * 所有条件都存在 state 里，任何一项变化只重绘一次；同时把条件写回地址栏，
 * 因此筛选结果可以直接复制链接分享（例如 category.html?tag=热血&sort=评分）。
 *
 * 依赖：YY、YY.card
 * 暴露：YY.pages.category.init()
 * ========================================================================== */
(function (YY) {
  'use strict';

  var $ = YY.$, $$ = YY.$$, esc = YY.esc, icons = YY.icons;
  var PAGE_SIZE = 36;

  /** 排序策略；「今日热门」= 近 7 天有更新的优先，其次按热度 */
  var SORTERS = {
    '全部': function (a, b) { return b.heat - a.heat; },
    '今日热门': function (a, b) {
      var now = Date.now();
      var fa = now - new Date(a.updated || 0).getTime() < 7 * 86400000 ? 1 : 0;
      var fb = now - new Date(b.updated || 0).getTime() < 7 * 86400000 ? 1 : 0;
      return fb - fa || b.heat - a.heat;
    },
    '人气': function (a, b) { return b.heat - a.heat; },
    '更新': function (a, b) { return new Date(b.updated || 0) - new Date(a.updated || 0); },
    '评分': function (a, b) { return (b.rating || 0) - (a.rating || 0) || b.heat - a.heat; }
  };

  /** 去重保序 */
  function uniq(arr) {
    var seen = {};
    return arr.filter(function (x) {
      if (!x || seen[x]) return false;
      seen[x] = 1;
      return true;
    });
  }

  function init() {
    var data = YY.data;
    if (!data.length) return;

    /* 页头背景用热度第一的封面，避免额外图片资源 */
    var heroBg = $('#catHeroBg');
    if (heroBg) heroBg.style.backgroundImage = 'url("' + data[0].cover + '")';

    var state = {
      q: YY.param('q'),
      tag: YY.param('tag') || '全部',
      region: YY.param('region') || '全部',
      audience: YY.param('audience') || '全部',
      status: YY.param('status') || '全部',
      sort: YY.param('sort') || '全部',
      page: Math.max(1, parseInt(YY.param('page'), 10) || 1)
    };

    /* ------------------------- 生成条件行 ------------------------- */
    var tags = YY.tagStats().slice(0, 18).map(function (t) { return t.tag; });
    var regions = uniq(data.map(function (x) { return x.region; })).filter(Boolean);
    var audiences = uniq(data.map(function (x) { return x.audience; })).filter(Boolean);

    var ROWS = [
      { key: 'tag', label: '分类', options: ['全部'].concat(tags) },
      { key: 'region', label: '地区', options: ['全部'].concat(regions) },
      { key: 'audience', label: '受众', options: ['全部'].concat(audiences) },
      { key: 'status', label: '进度', options: ['全部', '连载中', '已完结'] },
      { key: 'sort', label: '排序', options: ['全部', '今日热门', '人气', '更新', '评分'] }
    ];

    $('#catFilters').innerHTML = ROWS.map(function (row) {
      // 选项数据里没有的（如某地区 0 部）不渲染，避免点进去是空页
      var opts = row.options.filter(function (o) {
        return o === '全部' || o === state[row.key] ||
          (row.key === 'status' && (o === '连载中' || o === '已完结')) ||
          (row.key === 'sort') ||
          data.some(function (x) {
            if (row.key === 'tag') return (x.tags || []).indexOf(o) > -1;
            if (row.key === 'region') return x.region === o;
            if (row.key === 'audience') return x.audience === o;
            return false;
          });
      });
      return '<div class="f-row" data-row="' + row.key + '">' +
        '<span>' + row.label + '</span>' +
        '<div class="f-opts">' +
          opts.map(function (o) {
            return '<button class="f-opt" type="button" data-value="' + esc(o) + '" ' +
              'aria-pressed="' + (state[row.key] === o) + '">' + esc(o) + '</button>';
          }).join('') +
        '</div>' +
      '</div>';
    }).join('');

    /* ------------------------- 过滤 ------------------------- */
    function filtered() {
      var q = state.q.trim().toLowerCase();
      return data.filter(function (x) {
        if (state.tag !== '全部' && (x.tags || []).indexOf(state.tag) === -1) return false;
        if (state.region !== '全部' && x.region !== state.region) return false;
        if (state.audience !== '全部' && x.audience !== state.audience) return false;
        if (state.status !== '全部' && x.status !== state.status) return false;
        if (q) {
          var hay = (x.title + ' ' + (x.author || '') + ' ' + (x.tags || []).join(' ')).toLowerCase();
          if (hay.indexOf(q) === -1) return false;
        }
        return true;
      }).sort(SORTERS[state.sort] || SORTERS['全部']);
    }

    /* ------------------------- 分页控件 ------------------------- */
    function pagerHTML(totalPage) {
      if (totalPage <= 1) return '';
      var cur = state.page;
      var list = [];
      // 首尾 + 当前页附近，其余用省略号
      var pages = [];
      for (var i = 1; i <= totalPage; i++) {
        if (i === 1 || i === totalPage || Math.abs(i - cur) <= 2) pages.push(i);
        else if (pages[pages.length - 1] !== '...') pages.push('...');
      }
      list.push('<button type="button" data-page="' + (cur - 1) + '"' +
        (cur <= 1 ? ' disabled' : '') + '>上一页</button>');
      pages.forEach(function (p) {
        if (p === '...') {
          list.push('<span class="gap">…</span>');
          return;
        }
        list.push('<button type="button" data-page="' + p + '"' +
          (p === cur ? ' aria-current="page"' : '') + '>' + p + '</button>');
      });
      list.push('<button type="button" data-page="' + (cur + 1) + '"' +
        (cur >= totalPage ? ' disabled' : '') + '>下一页</button>');
      return list.join('');
    }

    /* ------------------------- 渲染 ------------------------- */
    var gridHost = $('#catGrid');
    var pagerHost = $('#catPager');
    var emptyHost = $('#catEmpty');

    function paint() {
      var list = filtered();
      var totalPage = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
      if (state.page > totalPage) state.page = totalPage;

      var start = (state.page - 1) * PAGE_SIZE;
      var show = list.slice(start, start + PAGE_SIZE);

      YY.card.grid(gridHost, show);
      gridHost.style.display = show.length ? 'grid' : 'none';

      // 右上角：当前筛选结果与页码，和主流目录站的写法一致
      $('#catMeta').innerHTML = '当前筛选 <b>' + list.length + '</b> 部作品 · 第 ' +
        state.page + ' / ' + totalPage + ' 页 · 每页 ' + PAGE_SIZE + ' 部';

      var cond = [];
      if (state.tag !== '全部') cond.push('题材「' + state.tag + '」');
      if (state.region !== '全部') cond.push(state.region);
      if (state.audience !== '全部') cond.push(state.audience);
      if (state.status !== '全部') cond.push(state.status);
      if (state.q) cond.push('关键词「' + state.q + '」');
      $('#catCount').innerHTML = '共 <b>' + list.length + '</b> 部' +
        (cond.length ? ' · ' + esc(cond.join(' · ')) : ' · 全站收录');
      $('#catNote').textContent = '数据来源：瓜子漫画公开目录 · 更新于 ' +
        (data[0].updated || new Date().toISOString().slice(0, 10));

      pagerHost.innerHTML = pagerHTML(totalPage);

      if (!list.length) {
        emptyHost.style.display = 'block';
        emptyHost.innerHTML = '<div class="empty">' + icons.empty +
          '<b>没有匹配的漫画</b><p>换个关键词，或点「全部」重置筛选条件</p></div>';
      } else {
        emptyHost.style.display = 'none';
      }

      // 条件同步到地址栏，刷新/分享都能还原
      var qs = [];
      ['q', 'tag', 'region', 'audience', 'status', 'sort'].forEach(function (k) {
        var v = state[k];
        if (v && v !== '全部') qs.push(k + '=' + encodeURIComponent(v));
      });
      if (state.page > 1) qs.push('page=' + state.page);
      history.replaceState(null, '', qs.length ? '?' + qs.join('&') : location.pathname);
    }

    /* ------------------------- 事件 ------------------------- */
    $('#catFilters').addEventListener('click', function (e) {
      var btn = e.target.closest('.f-opt');
      if (!btn) return;
      var row = btn.closest('.f-row').getAttribute('data-row');
      state[row] = btn.getAttribute('data-value');
      state.page = 1;
      $$('.f-opt', btn.closest('.f-row')).forEach(function (b) {
        b.setAttribute('aria-pressed', String(b === btn));
      });
      paint();
    });

    var timer = null;
    var qInput = $('#catQuery');
    qInput.value = state.q;
    qInput.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        state.q = qInput.value;
        state.page = 1;
        paint();
      }, 180);
    });

    pagerHost.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-page]');
      if (!btn || btn.disabled) return;
      state.page = Math.max(1, parseInt(btn.getAttribute('data-page'), 10) || 1);
      paint();
      var top = $('.filter-card');
      if (top) window.scrollTo({ top: top.offsetTop - 90, behavior: 'smooth' });
    });

    paint();
  }

  YY.pages = YY.pages || {};
  YY.pages.category = { init: init };
})(window.YY);
