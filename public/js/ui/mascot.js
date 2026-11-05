/* ==========================================================================
 * ui/mascot.js · 站娘（左下角小人物）
 * --------------------------------------------------------------------------
 * 交互设计：
 *   · 左下角常驻角色，旁边一个表情按钮可收起 / 弹出（收起后按钮仍在，随时能叫回来）
 *   · 气泡打字机逐字输出，按时段问候，点击角色换下一句，连续点击 5 次触发彩蛋
 *   · 空闲约 42 秒随机说话；滚动到页底会说一句
 *   · 收起状态写入 localStorage，刷新后保持；登录页不注入，避免干扰填写
 *
 * 依赖：YY（core.js）
 * 暴露：YY.mascot.init()
 * ========================================================================== */
(function (YY) {
  'use strict';

  var $ = YY.$;

  /** 通用台词池，随机不重复播放 */
  var LINES = [
    '点封面右下角的小爱心，就能把我记进追漫清单。',
    '找不到想看的？顶部「分类」里按题材筛，比乱翻快多了。',
    '《葬送的芙莉莲》我私心推荐，慢慢看很舒服。',
    '登录之后，追漫清单会跟着账号走，换设备也不丢。',
    '详情页只列最近 24 话，更早的章节要回原站看。',
    '站里所有作品信息都在 js/data.js，改一处就全站生效。',
    '这站是我自己手写的，从 Bootstrap 一路重做到现在。',
    '顶部那个骰子按钮，可以随机翻一部，很刺激。',
    '你点我一下我就说一句话，很划算吧？',
    '累了就眨眨眼，漫画不会跑。',
    '国漫和日漫分开筛，找起来会顺很多。',
    '字数少不代表不好看，短篇有时候更上头。'
  ];

  /** 按时段问候 */
  var GREETS = {
    morning: ['早上好，今天的第一话开始了吗？', '早呀，趁脑子清醒多看几话。'],
    noon: ['午后犯困的话，来点恋爱漫提神？', '这个点儿，适合瘫着看漫画。'],
    evening: ['晚上好，今晚要看点什么？', '天黑了，最适合开新坑。'],
    night: ['这么晚还在追更，小心明天起不来哦。', '夜猫子模式已启动，记得喝水。']
  };

  var KEY_STATE = 'yy-mascot';      // 'off' 表示已收起
  var KEY_VERSION = 'yy-mascot-v2'; // 版本号，用于修正旧版「没有任何入口」的问题

  function init() {
    // 登录页专注填写，不打扰
    if (document.body.getAttribute('data-page') === 'auth') return;
    if ($('#mascot')) return;

    // 旧版本只记了「关掉」，却没有重新打开入口，导致用户再也看不到站娘。
    // 这里做一次迁移：首次进入新版本时清空旧状态，让角色重新出现。
    if (!localStorage.getItem(KEY_VERSION)) {
      localStorage.removeItem(KEY_STATE);
      localStorage.setItem(KEY_VERSION, '1');
    }

    var collapsed = localStorage.getItem(KEY_STATE) === 'off';

    var box = document.createElement('aside');
    box.className = 'mascot' + (collapsed ? ' hidden' : '');
    box.id = 'mascot';
    box.innerHTML =
      '<button class="mascot-btn" id="mascotBtn" type="button" aria-label="和站娘聊聊">' +
        '<img src="imgs/offen/webtitle.webp" alt="站娘">' +
      '</button>' +
      '<div class="mascot-bubble" id="mascotBubble" role="status" aria-live="polite">' +
        '<span id="mascotText"></span>' +
      '</div>';
    document.body.appendChild(box);

    // 表情按钮：始终可见，收起后变成「叫回来」的入口
    var toggle = document.createElement('button');
    toggle.className = 'mascot-toggle';
    toggle.id = 'mascotToggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-controls', 'mascot');
    document.body.appendChild(toggle);

    var bubble = $('#mascotBubble', box);
    var textEl = $('#mascotText', box);
    var btn = $('#mascotBtn', box);

    var queue = [];
    var typing = null;
    var hideTimer = null;
    var clicks = [];

    /* --------------------------- 状态切换 --------------------------- */
    function paintToggle() {
      var hidden = box.classList.contains('hidden');
      toggle.textContent = hidden ? '◕‿◕' : 'T_T';
      toggle.title = hidden ? '叫出站娘' : '收起站娘';
      toggle.setAttribute('aria-expanded', String(!hidden));
      toggle.setAttribute('aria-label', hidden ? '展开站娘' : '收起站娘');
    }

    function setCollapsed(next) {
      box.classList.toggle('hidden', next);
      localStorage.setItem(KEY_STATE, next ? 'off' : 'on');
      paintToggle();
      if (!next) say('我回来啦，刚才说到哪儿了？');
    }

    toggle.addEventListener('click', function () {
      setCollapsed(!box.classList.contains('hidden'));
    });

    /* --------------------------- 气泡输出 --------------------------- */
    function shuffle(arr) {
      var a = arr.slice();
      for (var i = a.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a;
    }

    function nextLine() {
      if (!queue.length) queue = shuffle(LINES);
      return queue.pop();
    }

    /** 打字机效果；sticky=true 时不自动隐藏 */
    function say(line, sticky) {
      if (!line || box.classList.contains('hidden')) return;
      clearInterval(typing);
      clearTimeout(hideTimer);
      bubble.classList.add('show');
      textEl.textContent = '';
      var i = 0;
      typing = setInterval(function () {
        i += 1;
        textEl.textContent = line.slice(0, i);
        if (i >= line.length) {
          clearInterval(typing);
          typing = null;
          if (!sticky) {
            hideTimer = setTimeout(function () { bubble.classList.remove('show'); }, 8000);
          }
        }
      }, 42);
    }

    function greet() {
      var h = new Date().getHours();
      var slot = h < 5 ? 'night' : h < 11 ? 'morning' : h < 18 ? 'noon' : h < 23 ? 'evening' : 'night';
      var pool = GREETS[slot];
      say(pool[Math.floor(Math.random() * pool.length)]);
    }

    /* --------------------------- 交互事件 --------------------------- */
    btn.addEventListener('click', function () {
      btn.classList.remove('bounce');
      void btn.offsetWidth; // 强制重排，让动画可以重复播放
      btn.classList.add('bounce');

      var now = Date.now();
      clicks = clicks.filter(function (t) { return now - t < 2600; });
      clicks.push(now);

      if (clicks.length >= 5) {
        clicks = [];
        say('再点就要收费了……骗你的，随便点。');
        return;
      }
      say(nextLine());
    });

    // 首次进入时打一声招呼（每个会话一次）
    if (!sessionStorage.getItem('yy-mascot-greet')) {
      setTimeout(greet, 2200);
      sessionStorage.setItem('yy-mascot-greet', '1');
    }

    // 空闲时偶尔自言自语
    setInterval(function () {
      if (typing || bubble.classList.contains('show') || box.classList.contains('hidden')) return;
      if (Math.random() > 0.45) return;
      say(nextLine());
    }, 42000);

    // 滚到页面底部
    var bottomSaid = false;
    window.addEventListener('scroll', function () {
      if (bottomSaid || box.classList.contains('hidden')) return;
      var nearEnd = window.innerHeight + window.scrollY >= document.body.scrollHeight - 200;
      if (nearEnd && document.body.scrollHeight > 1400) {
        bottomSaid = true;
        say('到底啦，没有更多了。要不要去首页看看今天的新番？');
      }
    }, { passive: true });

    paintToggle();
  }

  YY.mascot = { init: init };
})(window.YY);
