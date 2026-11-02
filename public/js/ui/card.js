/* ==========================================================================
 * ui/card.js · 漫画卡片与网格
 * --------------------------------------------------------------------------
 * 站点里所有封面卡片都由这里生成，避免各页面重复写 HTML：
 *   card(item, index)  单张卡片（封面 + 地区/状态角标 + 评分 + 追漫按钮 + 标题 + 进度）
 *   grid(host, items)  批量渲染并接入滚动进场
 *   rank(host, items)  侧栏排行榜条目
 *   bindFav()          全局事件委托处理追漫按钮
 *   reveal(root)       滚动进场动画（渐进增强，未触发时内容依然可见）
 *
 * 依赖：YY（core.js）
 * 暴露：YY.card.render / YY.card.grid / YY.card.rank / YY.card.bindFav / YY.card.reveal
 * ========================================================================== */
(function (YY) {
  'use strict';

  var $ = YY.$, $$ = YY.$$, esc = YY.esc, icons = YY.icons;

  /** 图片兜底：外链失效或加载失败时切到占位图，避免破版 */
  var IMG_FALLBACK = 'onerror="this.onerror=null;this.src=\'imgs/placeholder.svg\'"';

  /** 卡片上的进度只保留「第 N 话」，长标题会撑破一行 */
  function chapterLabel(item) {
    if (item.chapterNo > 0) return '更新至第' + item.chapterNo + '话';
    return item.chapter || '连载中';
  }

  /**
   * 生成单张卡片
   * @param {Object} item  作品数据
   * @param {number} index 序号，用于错开进场动画
   */
  function card(item, index) {
    var fav = YY.favs.has(item.id);
    var delay = Math.min(index || 0, 8) * 45;
    var rating = Number(item.rating) || 0;

    // 评分缺失（源站未给）时不显示角标，避免出现假的 0.0
    var ratingHTML = rating > 0
      ? '<div class="card-rating">' + icons.star + rating.toFixed(1) + '</div>'
      : '';

    return '<article class="card reveal" style="--d:' + delay + 'ms">' +
      '<div class="card-cover">' +
        '<a class="card-link" href="index02.html?id=' + item.id + '" ' +
          'aria-label="查看《' + esc(item.title) + '》">' +
          '<img src="' + item.cover + '" alt="《' + esc(item.title) + '》封面" ' +
            'loading="lazy" referrerpolicy="no-referrer" ' + IMG_FALLBACK + '>' +
        '</a>' +
        '<div class="card-badges">' +
          // 地区缺失（源站未标注）时不渲染空角标
          (item.region
            ? '<span class="badge ' + (item.region === '国漫' ? 'badge-accent' : 'badge-dark') + '">' +
              esc(item.region) + '</span>'
            : '') +
          (item.status === '已完结' ? '<span class="badge">已完结</span>' : '') +
        '</div>' +
        ratingHTML +
        '<button class="card-fav' + (fav ? ' is-active' : '') + '" type="button" ' +
          'data-fav="' + item.id + '" aria-pressed="' + fav + '" ' +
          'aria-label="' + (fav ? '取消追漫' : '加入追漫') + '《' + esc(item.title) + '》">' +
          (fav ? icons.heartSolid : icons.heart) +
        '</button>' +
      '</div>' +
      '<div class="card-body">' +
        '<a class="card-title" href="index02.html?id=' + item.id + '" title="' + esc(item.title) + '">' +
          esc(item.title) + '</a>' +
        '<div class="card-meta">' +
          '<span class="chap">' + esc(chapterLabel(item)) + '</span>' +
          '<span class="dot"></span>' +
          '<span>' + esc((item.tags || [])[0] || '漫画') + '</span>' +
        '</div>' +
      '</div>' +
    '</article>';
  }

  /** 批量渲染网格 */
  function grid(host, items) {
    if (!host) return;
    if (!items || !items.length) {
      host.innerHTML = '';
      return;
    }
    host.innerHTML = items.map(card).join('');
    reveal(host);
  }

  /** 侧栏排行榜：名次 + 缩略图 + 标题 + 进度 */
  function rank(host, items) {
    if (!host) return;
    host.innerHTML = items.map(function (x, i) {
      var rating = Number(x.rating) || 0;
      return '<a class="rank-item" href="index02.html?id=' + x.id + '" title="' + esc(x.title) + '">' +
        '<span class="rank-no">' + String(i + 1).padStart(2, '0') + '</span>' +
        '<img class="rank-thumb" src="' + x.cover + '" alt="" loading="lazy" ' +
          'referrerpolicy="no-referrer" ' + IMG_FALLBACK + '>' +
        '<span class="rank-info"><b>' + esc(x.title) + '</b><span>' +
          esc(x.chapter || '连载中') +
          (rating > 0 ? ' · ' + rating.toFixed(1) + ' 分' : '') +
        '</span></span>' +
        // 热度用「万」压缩，比 2195.5k 短一截，标题能多放几个字
        '<span class="rank-heat">' + YY.fmtHeat(x.heat) + '</span>' +
      '</a>';
    }).join('');
  }

  /** 追漫按钮：事件委托，卡片动态增删都无需重新绑定 */
  function bindFav() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('.card-fav');
      if (!btn) return;
      e.preventDefault();
      var active = YY.favs.toggle(btn.getAttribute('data-fav'));
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
      btn.innerHTML = active ? icons.heartSolid : icons.heart;
    });
  }

  /* ------------------------------ 滚动进场 ------------------------------ */
  var io = null;

  /**
   * 给尚未进场的元素挂观察器。
   * 采用「默认可见 + 进入视口时播放动画」的渐进增强写法：
   * 即使 IntersectionObserver 不可用或被禁用，内容也不会隐身。
   */
  function reveal(root) {
    var nodes = $$('.reveal:not(.in)', root || document);
    if (!('IntersectionObserver' in window)) {
      nodes.forEach(function (n) { n.classList.add('in'); });
      return;
    }
    if (!io) {
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            en.target.classList.add('in');
            io.unobserve(en.target);
          }
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    }
    nodes.forEach(function (n) { io.observe(n); });
  }

  YY.card = { render: card, grid: grid, rank: rank, bindFav: bindFav, reveal: reveal };
})(window.YY);
