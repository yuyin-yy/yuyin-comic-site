/* ==========================================================================
 * pages/auth.js · 登录 / 注册
 * --------------------------------------------------------------------------
 * · Tab 切换登录与注册
 * · 前端校验（必填、密码长度、两次不一致），错误就近显示在字段下方
 * · 请求后端 /api/login、/api/register，失败时把服务端 message 原样展示
 * · 登录成功后写入 token 并跳转「我的追漫」
 * · 左侧唱片：点击或回车暂停/继续旋转
 *
 * 依赖：YY（core.js）
 * 暴露：YY.pages.auth.init()
 * ========================================================================== */
(function (YY) {
  'use strict';

  var $ = YY.$, $$ = YY.$$;

  /** 统一 POST，兼容「返回 JSON」与「返回纯文本」两种后端写法 */
  function post(path, body) {
    return fetch(YY.api + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.text().then(function (txt) {
        var data;
        try { data = JSON.parse(txt); } catch (e) { data = { message: txt }; }
        if (!res.ok) throw new Error(data.message || '请求失败');
        return data;
      });
    });
  }

  function init() {
    /* ------------------------- 登录 / 注册切换 ------------------------- */
    var tabs = $$('#authTabs button');
    var panes = { login: $('#loginForm'), reg: $('#regForm') };

    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        var key = t.getAttribute('data-tab');
        tabs.forEach(function (o) { o.setAttribute('aria-selected', String(o === t)); });
        Object.keys(panes).forEach(function (k) { panes[k].hidden = k !== key; });
        $('#authTitle').textContent = key === 'login' ? '欢迎回来' : '创建账号';
        $('#authSub').textContent = key === 'login'
          ? '登录后可同步你的追漫清单'
          : '注册后即可收藏喜欢的作品';
      });
    });

    /* ------------------------- 显示/隐藏密码 ------------------------- */
    $$('.pw-toggle').forEach(function (b) {
      b.addEventListener('click', function () {
        var input = b.parentNode.querySelector('input');
        var show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        b.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
      });
    });

    /* ------------------------- 唱片暂停 ------------------------- */
    var disc = $('#disc');
    if (disc) {
      var toggleDisc = function () { disc.classList.toggle('paused'); };
      disc.addEventListener('click', toggleDisc);
      disc.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleDisc(); }
      });
    }

    /* ------------------------- 校验工具 ------------------------- */
    /** 写入/清除某个字段的错误提示，返回是否通过 */
    function setErr(inputId, msg) {
      var input = $(inputId);
      var box = input.closest('.form-field').querySelector('.form-error');
      input.classList.toggle('is-error', !!msg);
      box.textContent = msg || '';
      return !msg;
    }

    function friendly(err) {
      return err.message === 'Failed to fetch'
        ? '无法连接后端服务，请先启动 node server.js'
        : err.message;
    }

    /* ------------------------- 登录 ------------------------- */
    $('#loginForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var u = $('#loginUsername').value.trim();
      var p = $('#loginPassword').value;

      setErr('#loginUsername', '');
      setErr('#loginPassword', '');
      var ok = true;
      if (!u) { setErr('#loginUsername', '请输入用户名'); ok = false; }
      if (p.length < 6) { setErr('#loginPassword', '密码至少 6 位'); ok = false; }
      if (!ok) return;

      var btn = $('#loginSubmit');
      btn.disabled = true;
      btn.textContent = '登录中…';

      post('/api/login', { username: u, password: p })
        .then(function (data) {
          if (!data.token) throw new Error(data.message || '登录失败');
          YY.user.save(data.token);
          // 先把本地匿名清单并入账号（内部已兜底，失败也不挡登录）
          YY.favs.onLogin().then(function () {
            YY.toast('登录成功，正在跳转');
            setTimeout(function () { location.href = 'my.html'; }, 400);
          });
        })
        .catch(function (err) {
          setErr('#loginPassword', friendly(err));
          btn.disabled = false;
          btn.textContent = '登录';
        });
    });

    /* ------------------------- 注册 ------------------------- */
    $('#regForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var u = $('#regUsername').value.trim();
      var p = $('#regPassword').value;
      var p2 = $('#regPassword2').value;

      setErr('#regUsername', '');
      setErr('#regPassword', '');
      setErr('#regPassword2', '');
      var ok = true;
      if (!u) { setErr('#regUsername', '请输入用户名'); ok = false; }
      if (p.length < 6) { setErr('#regPassword', '密码至少 6 位'); ok = false; }
      if (p !== p2) { setErr('#regPassword2', '两次输入的密码不一致'); ok = false; }
      if (!ok) return;

      var btn = $('#regSubmit');
      btn.disabled = true;
      btn.textContent = '提交中…';

      post('/api/register', { username: u, password: p })
        .then(function () {
          YY.toast('注册成功，请登录');
          tabs[0].click();
          $('#loginUsername').value = u;
          btn.disabled = false;
          btn.textContent = '注册';
        })
        .catch(function (err) {
          setErr('#regUsername', friendly(err));
          btn.disabled = false;
          btn.textContent = '注册';
        });
    });

    /* ------------------------- 已登录提示 ------------------------- */
    if (YY.user.name()) {
      $('#authNote').innerHTML = '当前已登录为 <b>' + YY.esc(YY.user.name()) + '</b>，' +
        '<a href="my.html" style="color:var(--accent)">进入我的追漫</a>';
    }
  }

  YY.pages = YY.pages || {};
  YY.pages.auth = { init: init };
})(window.YY);
