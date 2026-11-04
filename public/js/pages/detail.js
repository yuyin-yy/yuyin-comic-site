/* ==========================================================================
 * pages/detail.js · 作品详情
 * --------------------------------------------------------------------------
 * 通过 ?id= 读取作品；缺省或 id 非法时回退到热度第一的作品。
 * 页面内容全部由数据填充，因此一份模板可服务全站所有作品。
 *
 * 数据里 chs 是「新话在前」的真实章节列表（含章节 id），
 * 所以每个章节按钮都指向原站可访问的地址，不会出现 404。
 * 例外：章节尚未抓到的条目（pending=1）不提供任何外链，
 * 阅读入口统一跳到站内 404.html，由那一页说明原因。
 *
 * 依赖：YY、YY.card
 * 暴露：YY.pages.detail.init()
 * ========================================================================== */
(function (YY) {
  'use strict';

  var $ = YY.$, esc = YY.esc, icons = YY.icons;

  /** 简介兜底：源站未收录简介时，用真实字段拼一句可读的说明，不编造剧情 */
  function fallbackDesc(item) {
    return '《' + item.title + '》是一部' + (item.region || '') + '作品，目前' +
      (item.status || '连载中') +
      (item.chapter && item.chapter !== '连载中' ? '，最新更新至' + item.chapter : '') +
      '。原站简介与章节目录尚未抓取，本站会分批补全。';
  }

  function init() {
    var id = YY.param('id');
    var item = YY.byId(id) || YY.data[0];
    if (!item) return;

    document.title = item.title + ' · 余音的小破站';
    if (item.desc) {
      var meta = document.querySelector('meta[name="description"]');
      if (meta) meta.setAttribute('content', item.desc.slice(0, 120));
    }

    /* ------------------------- 头部信息 ------------------------- */
    $('#dHeroBg').style.backgroundImage = 'url("' + item.cover + '")';
    $('#dCover').src = item.cover;
    $('#dCover').alt = '《' + item.title + '》封面';
    $('#dTitle').textContent = item.title;
    $('#dAuthor').textContent = item.author || '原站未标注';
    $('#dDesc').textContent = item.desc || fallbackDesc(item);
    $('#dStatus').textContent = item.status || '连载中';
    $('#dChapter').textContent = item.chapter || '连载中';
    $('#dUpdate').textContent = YY.daysAgo(item.updated) || '—';
    $('#dCrumb').textContent = item.title;
    $('#dHeat').textContent = YY.fmtHeat(item.heat);

    // 评分：缺失时显示破折号并降低透明度，不伪造分数
    var rating = Number(item.rating) || 0;
    $('#dRating').textContent = rating > 0 ? rating.toFixed(1) : '—';
    $('#dRatingLabel').textContent = rating > 0 ? '用户评分' : '暂无评分';
    $('#dRating').style.opacity = rating > 0 ? '1' : '0.5';

    $('#dTags').innerHTML = (item.tags || []).map(function (t) {
      return '<a href="category.html?tag=' + encodeURIComponent(t) + '">' + esc(t) + '</a>';
    }).join('') + (item.region
      ? '<a href="category.html?region=' + encodeURIComponent(item.region) + '">' + esc(item.region) + '</a>'
      : '');

    /* ------------------------- 简介展开 ------------------------- */
    var desc = $('#dDesc');
    var toggle = $('#descToggle');
    if (desc.scrollHeight <= desc.clientHeight + 4) toggle.style.display = 'none';
    toggle.addEventListener('click', function () {
      var open = desc.classList.toggle('expanded');
      toggle.textContent = open ? '收起简介' : '展开简介';
    });

    /* ------------------------- 追漫 ------------------------- */
    var favBtn = $('#dFav');
    function paintFav() {
      var on = YY.favs.has(item.id);
      favBtn.innerHTML = (on ? icons.heartSolid : icons.heart) +
        '<span>' + (on ? '已追漫' : '加入追漫') + '</span>';
      favBtn.classList.toggle('btn-primary', on);
      favBtn.classList.toggle('btn-ghost', !on);
      favBtn.setAttribute('aria-pressed', String(on));
    }
    paintFav();
    favBtn.addEventListener('click', function () {
      YY.favs.toggle(item.id);
      paintFav();
    });

    /* ------------------------- 阅读入口 ------------------------- */
    // readUrl 是原站最新一话的真实地址。
    // 章节没抓到的作品（pending）不再外链原站 —— 那边也是空页，
    // 统一落到站内 404.html 说明原因，并给出回到本站的出口。
    var readBtn = $('#dRead');
    var hasChs = !!(item.chs && item.chs.length);
    var nfURL = '404.html?from=pending&id=' + encodeURIComponent(item.id) +
      '&t=' + encodeURIComponent(item.title);

    if (hasChs && item.readUrl) {
      readBtn.href = item.readUrl;
      readBtn.target = '_blank';
      readBtn.rel = 'noopener noreferrer';
      readBtn.innerHTML = icons.play + '<span>阅读最新一话</span>';
    } else {
      // 没有章节数据：只承诺「内容待补全」，不谎称能直达最新一话
      readBtn.href = nfURL;
      readBtn.removeAttribute('target');
      readBtn.rel = '';
      readBtn.innerHTML = icons.play + '<span>内容待补全</span>';
      readBtn.title = '该作品的章节还没抓取到，点击查看说明';
    }

    // 原站作品页兜底：仅在章节已收录时才给，pending 的作品不外链
    var srcLink = $('#dSrc');
    if (srcLink && item.detailUrl && hasChs) {
      srcLink.href = item.detailUrl;
      srcLink.hidden = false;
    }

    /* ------------------------- 章节列表 ------------------------- */
    var chs = item.chs || [];
    var chapterHost = $('#chapterGrid');
    // 章节链接由 readUrl 换掉章节 id 得到，域名与参数都跟原站保持一致
    var chapterURL = function (cid) {
      return item.readUrl ? item.readUrl.replace(/id=\d+/, 'id=' + cid) : (item.detailUrl || '#');
    };
    if (chs.length) {
      chapterHost.innerHTML = chs.map(function (c, i) {
        return '<a class="chapter-link' + (i === 0 ? ' latest' : '') + '" ' +
          'href="' + esc(chapterURL(c[0])) + '" ' +
          'target="_blank" rel="noopener noreferrer" title="' + esc(c[1]) + '">' +
          esc(c[1]) + (i === 0 ? ' · 新' : '') + '</a>';
      }).join('');
      var note = $('#chapterNote');
      if (note) note.textContent = '显示最近 ' + chs.length + ' 话 · 共 ' + (item.total || chs.length) + ' 话';
    } else {
      var noteEl = $('#chapterNote');
      if (noteEl) noteEl.style.display = 'none';
      // 未收录章节：不引导去原站，改跳站内 404 说明页
      chapterHost.innerHTML = '<p class="chapter-empty">' +
        '该作品的章节目录还没抓取到（源站对详情页做了访问频率限制，本站每天分批补抓）。' +
        '可以<a href="' + esc(nfURL) + '">查看说明</a>，或先看' +
        '<a href="category.html">其他作品</a>。' +
        '</p>';
    }

    /* ------------------------- 相关推荐 ------------------------- */
    var firstTag = (item.tags || [])[0];
    var related = YY.data.filter(function (x) {
      return x.id !== item.id &&
        ((firstTag && (x.tags || []).indexOf(firstTag) > -1) || x.region === item.region);
    }).slice(0, 10);
    var relatedHost = $('#relatedGrid');
    var paintRelated = function () { YY.card.grid(relatedHost, related); };
    paintRelated();
    // 列数变化后要重画：10 部在 3 列下会剩 1 张，靠 grid 重新裁零头
    YY.card.watchCols(paintRelated);
  }

  YY.pages = YY.pages || {};
  YY.pages.detail = { init: init };
})(window.YY);
