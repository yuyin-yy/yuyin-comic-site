/* ==========================================================================
 * core.js · 核心层
 * --------------------------------------------------------------------------
 * 全站唯一的基础设施：DOM 查询、转义、路由参数、存储、收藏、登录态、Toast、图标。
 * 其余模块通过全局命名空间 `YY` 访问，不直接互相引用，便于单独调试。
 *
 * 依赖：data.js（需先加载，提供 window.COMICS）
 * 暴露：window.YY
 * ========================================================================== */
window.YY = (function () {
  'use strict';

  /* ------------------------------ 常量 ------------------------------ */
  var FAV_KEY = 'yy-favs';       // 追漫清单（localStorage，存作品 id 数组）
  var TOKEN_KEY = 'yy-token';    // 登录令牌（JWT，仅存前端用于展示用户名）
  // 后端地址：本地开发（file:// 或 localhost）连 http://localhost:3000，
  // 部署到服务器后自动走同源 /api/*（否则会把请求发到访客自己的电脑上）。
  var API_BASE = /^(localhost|127\.0\.0\.1|)$/.test(location.hostname)
    ? 'http://localhost:3000'
    : '';

  var data = window.COMICS || [];
  // 简介与章节目录单独打包（data-detail.js），只有详情页会引：
  // 列表页拿到的 YY.data 里没有 desc / chs，别在别处读这两个字段。
  var detailMap = window.COMIC_DETAIL || {};

  /** 1x1 透明 GIF：懒加载图片先占位，有 src 才不会渲染 alt 文字与破图图标 */
  var BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

  /* ------------------------------ DOM ------------------------------ */
  /** 查询单个元素 */
  function $(sel, root) { return (root || document).querySelector(sel); }
  /** 查询元素集合，返回真数组（可使用 forEach/filter） */
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  /** HTML 转义：所有拼接进模板的用户/抓取数据都必须过一遍，避免 XSS 与破版 */
  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ------------------------------ 数据 ------------------------------ */
  /** 按 id 取作品（id 以字符串比较，兼容 URL 参数） */
  function byId(id) {
    for (var i = 0; i < data.length; i++) {
      if (String(data[i].id) === String(id)) return data[i];
    }
    return null;
  }

  /** 取详情补充数据 { desc, chs }；没引 data-detail.js 的页面返回 null */
  function detailOf(id) {
    return detailMap[String(id)] || null;
  }

  /** 读取地址栏参数，如 ?id=12 */
  function param(name) {
    var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
  }

  /** 相对时间：今天 / 昨天 / N 天前 / MM/DD */
  function daysAgo(dateStr) {
    var d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return '';
    var diff = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (diff <= 0) return '今天';
    if (diff === 1) return '昨天';
    if (diff < 30) return diff + ' 天前';
    return dateStr.slice(5).replace('-', '/');
  }

  /** 从「第 236 话」里取出 236；没有则返回 0 */
  function chapterNo(item) {
    var m = /第(\d+)话/.exec(item.chapter || '');
    return m ? parseInt(m[1], 10) : 0;
  }

  /** 统计各题材数量，返回按数量倒序的 [{tag, count}] */
  function tagStats(exclude) {
    var counts = {};
    data.forEach(function (x) {
      (x.tags || []).forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
    });
    return Object.keys(counts)
      .filter(function (t) { return t !== '漫画' && (exclude || []).indexOf(t) === -1; })
      .map(function (t) { return { tag: t, count: counts[t] }; })
      .sort(function (a, b) { return b.count - a.count; });
  }

  /** 热度格式化：1608900 -> 160.89万，便于榜单对齐 */
  function fmtHeat(n) {
    n = Number(n) || 0;
    if (n >= 100000000) return (n / 100000000).toFixed(2) + '亿';
    if (n >= 10000) return (n / 10000).toFixed(2).replace(/\.?0+$/, '') + '万';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.?0+$/, '') + 'k';
    return n > 0 ? String(n) : '—';
  }

  /* ------------------------------ 收藏 ------------------------------ */
  // 未登录：清单存 localStorage（FAV_KEY），行为和以前一致。
  // 登录后：以服务器 favorites 表为准，本地只留一份镜像（FAV_CACHE_KEY）
  // 供首屏渲染，避免爱心图标闪烁或误显示。
  var FAV_CACHE_KEY = 'yy-favs-cache';

  function readJSON(key) {
    try {
      var raw = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(raw) ? raw.map(String) : [];
    } catch (e) { return []; }
  }

  /** 带 token 的接口请求（收藏同步专用） */
  function favRequest(method, path, body) {
    var headers = { 'Content-Type': 'application/json' };
    var t = localStorage.getItem(TOKEN_KEY);
    if (t) headers.Authorization = 'Bearer ' + t;
    return fetch(API_BASE + path, {
      method: method,
      headers: headers,
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || data.success === false) throw new Error(data.message || '请求失败');
        return data;
      });
    });
  }

  var favs = {
    ready: false,   // 登录态下，服务器清单是否已拉到
    server: [],     // 登录态下的服务器清单（内存）

    /** 读取追漫 id 列表 */
    list: function () {
      if (localStorage.getItem(TOKEN_KEY)) {
        return favs.ready ? favs.server.slice() : readJSON(FAV_CACHE_KEY);
      }
      return readJSON(FAV_KEY);
    },

    has: function (id) { return favs.list().indexOf(String(id)) > -1; },

    /** 整体写入清单：未登录写本地；已登录算差异后同步服务器 */
    save: function (list) {
      if (!localStorage.getItem(TOKEN_KEY)) {
        localStorage.setItem(FAV_KEY, JSON.stringify(list));
        favs._emit(list);
        return;
      }
      var next = list.map(String);
      var prev = favs.list();
      var add = next.filter(function (x) { return prev.indexOf(x) === -1; });
      var del = prev.filter(function (x) { return next.indexOf(x) === -1; });

      favs.server = next;
      favs.ready = true;
      localStorage.setItem(FAV_CACHE_KEY, JSON.stringify(next));
      favs._emit(next);
      favs._sync(add, del);
    },

    /** 收藏/取消收藏，返回操作后是否已收藏 */
    toggle: function (id) {
      var list = favs.list();
      var key = String(id);
      var i = list.indexOf(key);
      var item = byId(id);
      var name = item ? '《' + item.title + '》' : '';
      if (i > -1) {
        list.splice(i, 1);
        toast('已取消追漫' + name);
        favs.save(list);
        return false;
      }
      list.unshift(key);
      toast('已加入追漫' + name);
      favs.save(list);
      return true;
    },

    _emit: function (list) {
      // 通知其他页面区块刷新（如「我的追漫」列表）
      document.dispatchEvent(new CustomEvent('yy:favs', { detail: list }));
    },

    _apply: function (list) {
      favs.server = (list || []).map(String);
      favs.ready = true;
      localStorage.setItem(FAV_CACHE_KEY, JSON.stringify(favs.server));
      favs._emit(favs.server);
    },

    _sync: function (add, del) {
      if (!add.length && !del.length) return Promise.resolve();
      return favRequest('POST', '/api/favs/sync', { add: add, remove: del })
        .then(function (data) { favs._apply(data.list || []); })
        .catch(function () {
          toast('清单同步失败，请检查网络');
          favs.refresh();
        });
    },

    /** 从服务器拉取账号清单（页面启动时调用） */
    refresh: function () {
      if (!localStorage.getItem(TOKEN_KEY)) return Promise.resolve([]);
      return favRequest('GET', '/api/favs')
        .then(function (data) { favs._apply(data.list || []); return favs.server; })
        .catch(function () { return favs.list(); });
    },

    /** 登录成功：把本地匿名清单并入账号，随后清空本地，避免污染其他账号 */
    onLogin: function () {
      var local = readJSON(FAV_KEY);
      favs.ready = false;
      var p = local.length
        ? favRequest('POST', '/api/favs/sync', { add: local, remove: [] })
            .then(function (data) {
              localStorage.removeItem(FAV_KEY);
              favs._apply(data.list || []);
            })
        : favs.refresh();
      return p.catch(function () { /* 合并失败不挡登录，下次刷新会自动纠正 */ });
    },

    /** 退出登录：回到本地清单视角 */
    onLogout: function () {
      favs.ready = false;
      favs.server = [];
      localStorage.removeItem(FAV_CACHE_KEY);
      favs._emit(readJSON(FAV_KEY));
    }
  };

  /* ------------------------------ 登录态 ------------------------------ */
  var user = {
    token: function () { return localStorage.getItem(TOKEN_KEY) || ''; },
    /** 解析 JWT payload 取用户名（仅用于显示，鉴权以后端为准） */
    name: function () {
      var t = user.token();
      if (!t) return '';
      try {
        var seg = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        var payload = JSON.parse(decodeURIComponent(escape(atob(seg))));
        return payload.username || '';
      } catch (e) { return ''; }
    },
    save: function (token) { localStorage.setItem(TOKEN_KEY, token); },
    clear: function () { localStorage.removeItem(TOKEN_KEY); }
  };

  /* ------------------------------ Toast ------------------------------ */
  /** 轻提示，2 秒后自动消失；同一位置可堆叠 */
  function toast(msg) {
    var wrap = $('.toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'toast-wrap';
      document.body.appendChild(wrap);
    }
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(function () {
      el.classList.add('out');
      setTimeout(function () { el.remove(); }, 260);
    }, 1900);
  }

  /* ------------------------------ 图标 ------------------------------ */
  /** 统一的内联 SVG，避免额外图标字体请求 */
  var icons = {
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4 6.2 20.5l1.1-6.5L2.6 9.4l6.5-.9L12 2.6z"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 20s-7.5-4.6-9.3-9A5.2 5.2 0 0 1 12 6.5 5.2 5.2 0 0 1 21.3 11c-1.8 4.4-9.3 9-9.3 9z"/></svg>',
    heartSolid: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 20.5S3.6 15.4 1.7 10.6A5.7 5.7 0 0 1 12 6.1a5.7 5.7 0 0 1 10.3 4.5C20.4 15.4 12 20.5 12 20.5z"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M13 6l6 6-6 6"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5-11-6.5z"/></svg>',
    grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/></svg>',
    fire: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3s5 4 5 8a5 5 0 0 1-10 0c0-2 1-3 1-3s0 3 2 3c1.5 0 1.5-1.6 1.5-3C11.5 6.4 12 3 12 3z"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    dice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><circle cx="8.5" cy="8.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="15.5" cy="15.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="15.5" cy="8.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="8.5" cy="15.5" r="1.3" fill="currentColor" stroke="none"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7"/></svg>',
    bookmark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M6 4.5h12v16l-6-4.2-6 4.2v-16z"/></svg>',
    empty: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-9z"/><path d="M4 10h16M9 14h6"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>'
  };

  // 已登录时启动即拉取账号清单（异步，不阻塞首屏；拉到后发 yy:favs 事件刷新）
  if (user.token()) favs.refresh();

  return {
    data: data,
    blank: BLANK,
    api: API_BASE,
    $: $, $$: $$, esc: esc,
    byId: byId, detailOf: detailOf, param: param, daysAgo: daysAgo, chapterNo: chapterNo, tagStats: tagStats,
    fmtHeat: fmtHeat,
    favs: favs,
    user: user,
    toast: toast,
    icons: icons
  };
})();
