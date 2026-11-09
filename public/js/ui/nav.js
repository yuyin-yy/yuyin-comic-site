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
    // 罗生门是独立模块（public/gate/），只有这一页不在根目录
    { href: 'gate/index.html', label: '罗生门', key: 'gate' },
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

    // 首屏就带上正确的状态类，避免加载瞬间先渲染成白色再渐变到深色
    var isHome = document.body.getAttribute('data-page') === 'home';
    var atTop = (window.scrollY || window.pageYOffset || 0) <= 32;
    host.className = 'site-header' + (isHome && atTop ? ' is-over' : '');
    host.innerHTML =
      '<div class="container">' +
        '<nav class="nav" aria-label="主导航">' +
          '<a class="brand" href="index.html">' +
            '<img class="brand-mark" src="imgs/offen/miku.webp" alt="" width="36" height="36">' +
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
              // 登录后统一用默认头像（imgs/offen/blblfmj.webp），未登录仍是人形图标
              (user
                ? '<img class="nav-avatar" src="imgs/offen/blblfmj.webp" alt="" width="22" height="22">'
                : icons.user) +
              '<span>' + (user ? esc(user) : '登录') + '</span>' +
            '</a>' +
            '<button class="nav-toggle" type="button" aria-label="展开菜单" aria-expanded="false">' +
              '<span></span></button>' +
          '</div>' +
        '</nav>' +
      '</div>' +
      '<div class="drawer" id="navDrawer">' +
        // 手机端导航栏里的搜索已隐藏，这里补一个入口，免得搜索功能在手机上消失
        '<label class="drawer-search">' + icons.search +
          '<input type="search" id="drawerSearch" placeholder="搜索作品名 / 作者" ' +
            'aria-label="搜索漫画" autocomplete="off">' +
        '</label>' +
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

    /* 抽屉里的搜索：回车即跳分类页，跟导航搜索同一套落点 */
    var drawerSearch = $('#drawerSearch', host);
    if (drawerSearch) {
      drawerSearch.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        var q = (drawerSearch.value || '').trim();
        location.href = 'category.html' + (q ? '?q=' + encodeURIComponent(q) : '');
      });
    }

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

    /* 滚动时切头部状态：
       首页的导航浮在首屏图上，未滚动时用深色玻璃（is-over），滚动后回到白色玻璃；
       其余页面没有首屏大图，一直用白色玻璃。
       顺带处理「向下收起、向上放回」：只加一个 is-hidden 类，位移交给 CSS 的
       transform，所以收起时下面的内容不会跳。三种情况不收：
         · 已经回到页面顶部（96px 以内）
         · 抽屉展开着，或者焦点还在导航里（搜索框正被输入）
         · 系统开启了「减少动效」 */
    var overHero = document.body.getAttribute('data-page') === 'home';
    var threshold = overHero ? 32 : 8;
    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    var lastY = window.scrollY || window.pageYOffset || 0;
    var isHidden = false;

    function setHidden(v) {
      if (v === isHidden) return;          // 值没变就别碰 DOM
      isHidden = v;
      host.classList.toggle('is-hidden', v);
    }

    /** 导航正处于被操作的状态：抽屉开着，或光标停在搜索框里
     *  这里只认输入框——鼠标点过汉堡或链接后按钮仍带着焦点，
     *  若一并算「在用」，收起就会一直失效。 */
    function inUse() {
      if (drawer.classList.contains('open')) return true;
      var el = document.activeElement;
      return !!(el && host.contains(el) && /^(INPUT|TEXTAREA)$/.test(el.tagName));
    }

    var onScroll = function () {
      var y = window.scrollY || window.pageYOffset || 0;
      host.classList.toggle('is-solid', y > threshold);
      if (overHero) host.classList.toggle('is-over', y <= threshold);

      var dy = y - lastY;
      // 4px 以内当手抖/惯性噪声忽略，lastY 不动，位移会累积到下一次判断
      if (Math.abs(dy) < 4) return;
      lastY = y;

      if (reduceMotion.matches) { setHidden(false); return; }

      if (y <= 96) setHidden(false);                         // 顶部一律露出
      else if (dy > 0) { if (!inUse()) setHidden(true); }    // 向下：让出背景
      else setHidden(false);                                 // 向上：立刻回来
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    // 键盘 Tab 进到导航里时立刻放回，否则焦点会落在屏幕外看不见的链接上
    host.addEventListener('focusin', function () { setHidden(false); });
    onScroll();
  }

  YY.nav = { render: render };
})(window.YY);
