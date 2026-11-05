/* ==========================================================================
 * ui/footer.js · 页脚
 * --------------------------------------------------------------------------
 * 渲染全站页脚：站点说明 + 联系与声明 + 版权条。
 * 刻意不放导航分类与题材入口——页头已经提供了这些，重复堆在页脚只会显得吵。
 *
 * 依赖：YY（core.js）
 * 暴露：YY.footer.render()
 * ========================================================================== */
(function (YY) {
  'use strict';

  var $ = YY.$;

  function render() {
    var host = $('#app-footer');
    if (!host) return;

    var year = new Date().getFullYear();

    host.className = 'site-footer';
    host.innerHTML =
      '<div class="container">' +
        '<div class="footer-grid">' +
          '<div class="footer-about">' +
            '<div class="footer-brand">' +
              '<img src="imgs/offen/miku.webp" alt="站点头像">' +
              '<span>余音的小破站</span>' +
            '</div>' +
            '<p>个人维护的漫画索引：整理国漫、日漫与韩漫的连载进度、评分与简介，' +
              '共收录 ' + YY.data.length + ' 部作品。' +
              '本站不存储任何漫画内容，版权归原作者与原平台所有。</p>' +
          '</div>' +
          '<div class="footer-contact">' +
            '<h4>联系与声明</h4>' +
            '<p>开发者：余音 · QQ 3078480339</p>' +
            '<p>阅读入口指向原站，如涉侵权请联系删除。</p>' +
            '<p>本站仅供学习交流，请勿用于商业用途。</p>' +
          '</div>' +
        '</div>' +
        '<div class="footer-bottom">' +
          '<span>© ' + year + ' 余音的小破站</span>' +
          '<span>数据整理自公开目录 · 章节入口均校验自原站</span>' +
        '</div>' +
      '</div>';
  }

  YY.footer = { render: render };
})(window.YY);
