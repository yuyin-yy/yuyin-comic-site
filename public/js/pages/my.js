/* ==========================================================================
 * pages/my.js · 我的追漫
 * --------------------------------------------------------------------------
 * 追漫清单存在浏览器本地（localStorage），按加入顺序展示；
 * 登录后显示用户名与默认头像（imgs/offen/blblfmj.webp），并可退出登录。
 * 空状态给出引导，底部补一组「你可能还想看」。
 *
 * 依赖：YY、YY.card
 * 暴露：YY.pages.my.init()
 * ========================================================================== */
(function (YY) {
  'use strict';

  var $ = YY.$, esc = YY.esc;

  // 登录后的默认头像，换图只改这一处
  var DEFAULT_AVATAR = 'imgs/offen/blblfmj.webp';

  function init() {
    /* ------------------------- 顶部账号区 ------------------------- */
    var name = YY.user.name();
    var avatar = $('#myAvatar');
    if (avatar) {
      if (name) {
        avatar.innerHTML = '<img src="' + DEFAULT_AVATAR + '" alt="' + esc(name) + ' 的头像">';
      } else {
        avatar.className = 'my-avatar is-guest';
        avatar.innerHTML = YY.icons.user;
      }
    }

    if (name) {
      $('#myUser').textContent = name;
      var loginBtn = $('#myLoginBtn');
      var logout = document.createElement('button');
      logout.className = 'btn btn-ghost btn-sm';
      logout.type = 'button';
      logout.id = 'logoutBtn';
      logout.textContent = '退出登录';
      loginBtn.parentNode.replaceChild(logout, loginBtn);
      logout.addEventListener('click', function () {
        YY.user.clear();
        YY.favs.onLogout();
        YY.toast('已退出登录');
        setTimeout(function () { location.href = 'index.html'; }, 500);
      });
    }

    /* ------------------------- 列表渲染 ------------------------- */
    var grid = $('#myGrid');
    var empty = $('#myEmpty');

    function paint() {
      var ids = YY.favs.list();
      var items = ids.map(function (id) { return YY.byId(id); }).filter(Boolean);
      $('#myCount').textContent = items.length;

      if (!items.length) {
        grid.innerHTML = '';
        empty.style.display = 'block';
        return;
      }
      empty.style.display = 'none';
      YY.card.grid(grid, items);
    }

    paint();
    // 卡片上的爱心被点击时，这里会收到通知并实时刷新
    document.addEventListener('yy:favs', paint);
    // 列数变化后重画，让末行零头跟着重算
    YY.card.watchCols(paint);

    /* ------------------------- 清空 ------------------------- */
    $('#clearFavs').addEventListener('click', function () {
      if (!YY.favs.list().length) {
        YY.toast('清单已经是空的');
        return;
      }
      if (!confirm('确定清空全部追漫记录吗？')) return;
      YY.favs.save([]);
      YY.toast('已清空追漫记录');
    });

    /* ------------------------- 推荐补充 ------------------------- */
    var suggest = YY.data.filter(function (x) { return !YY.favs.has(x.id); }).slice(0, 10);
    var suggestHost = $('#mySuggest');
    var paintSuggest = function () { YY.card.grid(suggestHost, suggest); };
    paintSuggest();
    YY.card.watchCols(paintSuggest);
  }

  YY.pages = YY.pages || {};
  YY.pages.my = { init: init };
})(window.YY);
