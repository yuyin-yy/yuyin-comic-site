/* ==========================================================================
 * app.js · 启动器
 * --------------------------------------------------------------------------
 * 按 <body data-page="..."> 决定加载哪个页面模块，并统一初始化
 * 全站公共部分（导航、页脚、卡片事件、滚动进场、站娘）。
 *
 * 页面标识：home | category | rank | updates | detail | auth | my
 * 新增页面只需：加一个 pages/xxx.js 并在下面 ROUTES 里登记。
 * ========================================================================== */
(function (YY) {
  'use strict';

  /** 路由表：data-page → 页面模块名 + 导航高亮键 */
  var ROUTES = {
    home: { page: 'home', nav: 'home' },
    category: { page: 'category', nav: 'category' },
    rank: { page: 'rank', nav: 'rank' },
    updates: { page: 'updates', nav: 'fresh' },
    detail: { page: 'detail', nav: 'category' },
    auth: { page: 'auth', nav: '' },
    my: { page: 'my', nav: 'mine' }
  };

  function boot() {
    var key = document.body.getAttribute('data-page') || '';
    var route = ROUTES[key];

    YY.nav.render(route ? route.nav : '');
    YY.footer.render();
    YY.card.bindFav();
    YY.card.reveal();
    YY.mascot.init();

    if (route && YY.pages[route.page]) {
      YY.pages[route.page].init();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window.YY);
