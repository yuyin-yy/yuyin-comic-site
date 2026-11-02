/* ==========================================================================
 * ui/nav.js · 顶部导航
 * --------------------------------------------------------------------------
 * 负责渲染全站导航，包含：
 *   1. 主导航：首页 / 分类 / 排行榜 / 最近更新 / 我的追漫
 *   2. 导航内搜索联想、随机一部、登录态、移动端抽屉
 *
 * 依赖：YY（core.js）
 * 暴露：YY.nav.render(activeKey)
 * ========================================================================== */
(function (YY) {
  'use strict';

  var $ = YY.$, esc = YY.esc, icons = YY.icons;

  /** 主导航项。key 用于高亮当前页 */
  var LINKS = [
    { href: 'index.html', label: '首页', key: 'home' },
    { href: 'category.html', label: '分类', key: 'category' },
    { href: 'rank.html', label: '排行榜', key: 'rank' },
    { href: 'updates.html', label: '最近更新', key: 'fresh' },
    { href: 'my.html', label: '我的追漫', key: 'mine' }
  ];

  /** 地区快捷入口（没有作品的地区会自动隐藏） */
  var REGIONS = ['国漫', '日漫', '日韩', '欧美', '港台', '韩漫'];

  /** 搜索联想：标题 / 作者 / 题材 任一命中 */
  function searchData(q) {
    q = (q || '').trim().toLowerCase();
    if (!q) return [];
    return YY.data.filter(function (x) {
      return (x.title + ' ' + (x.author || '') + ' ' + (x.tags || []).join(' '))
        .toLowerCase().indexOf(q) > -1;
    }).slice(0, 6);
  }

  /** 给输入框绑定联想下拉，回车跳分类页搜索 */
  function bindSuggest(input, panel, onEnter) {
    if (!input || !panel) return;
    var timer = null;

    function paint() {
      var list = searchData(input.value);
      if (!input.value.trim()) {
        panel.classList.remove('open');
        panel.innerHTML = '';
        return;
      }
      if (!list.length) {
        panel.innerHTML = '<div class="suggest-empty">没有找到「' + esc(input.value) + '」</div>';
      } else {
        panel.innerHTML = list.map(function (x) {
          return '<a class="suggest-item" href="index02.html?id=' + x.id + '">' +
            '<img src="' + x.cover + '" alt="" referrerpolicy="no-referrer" ' +
              'onerror="this.onerror=null;this.src=\'imgs/placeholder.svg\'">' +
            '<span><strong>' + esc(x.title) + '</strong>' +
            '<small>' + esc(x.author || '原站未标注') + ' · ' + esc(x.chapter) + '</small></span></a>';
        }).join('');
      }
      panel.classList.add('open');
    }

    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(paint, 120);
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        onEnter(input.value.trim());
        panel.classList.remove('open');
      }
      if (e.key === 'Escape') panel.classList.remove('open');
    });

    document.addEventListener('click', function (e) {
      if (!panel.contains(e.target) && e.target !== input) panel.classList.remove('open');
    });
  }

  /* ----------------------------- 渲染 ----------------------------- */
  function render(active) {
    var host = $('#app-nav');
    if (!host) return;

    var user = YY.user.name();
    var navLinks = LINKS.map(function (n) {
      var cur = n.key === active ? ' aria-current="page"' : '';
      return '<a class="nav-link" href="' + n.href + '"' + cur + '>' + n.label + '</a>';
    }).join('');

    host.className = 'site-header';
    host.innerHTML =
      '<div class="container">' +
        '<nav class="nav" aria-label="主导航">' +
          '<a class="brand" href="index.html">' +
            '<img class="brand-mark" src="imgs/offen/miku.jpg" alt="" width="36" height="36">' +
            '<span class="brand-text">余音的小破站</span>' +
          '</a>' +
          '<div class="nav-links">' + navLinks + '</div>' +
          '<div class="nav-right">' +
            '<label class="nav-search">' + icons.search +
              '<input type="search" id="navSearch" placeholder="搜索漫画 / 作者" ' +
                'aria-label="搜索漫画" autocomplete="off">' +
              '<div class="suggest" id="navSuggest" role="listbox"></div>' +
            '</label>' +
            '<a class="nav-icon" href="#" data-random="1" title="随便看一部" aria-label="随便看一部">' +
              icons.dice + '</a>' +
            '<a class="btn btn-sm ' + (user ? 'btn-ghost' : 'btn-dark') + '" ' +
              'href="' + (user ? 'my.html' : 'Login.html') + '">' +
              // 登录后统一用默认头像（imgs/offen/blblfmj.png），未登录仍是人形图标
              (user
                ? '<img class="nav-avatar" src="imgs/offen/blblfmj.png" alt="" width="22" height="22">'
                : icons.user) +
              '<span>' + (user ? esc(user) : '登录') + '</span>' +
            '</a>' +
            '<button class="nav-toggle" type="button" aria-label="展开菜单" aria-expanded="false">' +
              '<span></span></button>' +
          '</div>' +
        '</nav>' +
      '</div>' +
      '<div class="drawer" id="navDrawer">' +
        LINKS.map(function (n) {
          return '<a href="' + n.href + '">' + n.label + '</a>';
        }).join('') +
        '<div class="drawer-section"><h5>热门题材</h5><div class="drawer-tags">' +
          YY.tagStats().slice(0, 8).map(function (t) {
            return '<a href="category.html?tag=' + encodeURIComponent(t.tag) + '">' + esc(t.tag) + '</a>';
          }).join('') +
        '</div></div>' +
        '<div class="drawer-section"><h5>按地区</h5><div class="drawer-tags">' +
          REGIONS.filter(function (r) {
            return YY.data.some(function (x) { return x.region === r; });
          }).map(function (r) {
            return '<a href="category.html?region=' + encodeURIComponent(r) + '">' + r + '</a>';
          }).join('') +
        '</div></div>' +
      '</div>';

    /* 移动端抽屉 */
    var toggle = $('.nav-toggle', host);
    var drawer = $('#navDrawer', host);
    toggle.addEventListener('click', function () {
      var open = drawer.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    /* 搜索联想 */
    bindSuggest($('#navSearch', host), $('#navSuggest', host), function (q) {
      location.href = 'category.html' + (q ? '?q=' + encodeURIComponent(q) : '');
    });

    /* 随机一部：全站统一处理，避免每处复制逻辑 */
    document.addEventListener('click', function (e) {
      var trigger = e.target.closest('[data-random]');
      if (!trigger) return;
      e.preventDefault();
      var pool = YY.data;
      if (!pool.length) return;
      var pick = pool[Math.floor(Math.random() * pool.length)];
      location.href = 'index02.html?id=' + pick.id;
    });

    /* 滚动时给头部加投影 */
    var onScroll = function () {
      host.classList.toggle('is-solid', window.scrollY > 8);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  YY.nav = { render: render };
})(window.YY);
