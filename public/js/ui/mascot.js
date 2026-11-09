/* ==========================================================================
 * ui/mascot.js · 站娘（左下角小人物）
 * --------------------------------------------------------------------------
 * 交互设计：
 *   · 左下角常驻角色，旁边一个表情按钮可收起 / 弹出（收起后按钮仍在，随时能叫回来）
 *   · 气泡打字机逐字输出，按时段问候，点击角色换下一句
 *   · 单击说话 / 双击被戳 / 连点 5 次、9 次各有一段彩蛋
 *   · 鼠标悬停 1.2 秒她会忍不住开口（40 秒内只犯一次）
 *   · 空闲 90 秒（无点击、无滚动、无按键）问一句「还在吗」
 *   · 切到别的标签页再回来、从很下面滚回顶部、滚到页底，各有单独台词
 *   · 点气泡可以立刻收起；收起状态写入 localStorage，刷新后保持
 *   · 登录页不注入，避免干扰填写
 *
 * 台词分池：LINES 是通用池（随机不重复），其余池只在对应场合出现。
 *
 * 依赖：YY（core.js）
 * 暴露：YY.mascot.init()
 * ========================================================================== */
(function (YY) {
  'use strict';

  var $ = YY.$;

  /** 通用台词池，随机不重复播放 */
  var LINES = [
    /* —— 站点功能 —— */
    '点封面右下角的小爱心，就能把我记进追漫清单。',
    '找不到想看的？顶部「分类」里按题材筛，比乱翻快多了。',
    '《葬送的芙莉莲》我私心推荐，慢慢看很舒服。',
    '登录之后，追漫清单会跟着账号走，换设备也不丢。',
    '详情页只列最近十几话，更早的章节要回原站看。',
    '站里所有作品信息都在 js/data.js，改一处就全站生效。',
    '这站是我自己手写的，从 Bootstrap 一路重做到现在。',
    '顶部那个骰子按钮，可以随机翻一部，很刺激。',
    '国漫和日漫分开筛，找起来会顺很多。',
    '顶部搜索认作品名，也认作者名，打两个字就出联想。',
    '标签比简介诚实，先扫一眼标签再看简介，踩雷率会低很多。',
    '完结的作品最省心，一口气看完不用等更。',
    '连载中的作品最折磨，也最上头。',
    '排行榜按热度排，我私底下还有一套自己的排序。',
    '罗生门那扇门推不推得开，看你手气。',
    '详情页那张主封面会跟着鼠标转，无聊的时候可以玩很久。',
    '这个站没有广告，没有弹窗，也没有「下载 App 才能看全文」。',
    '数据是从原站抓的，链接失效了那是原站的锅，不赖我。',
    '我给每部作品都配了封面，找图比写代码累多了。',
    '换设备的时候记得登录，不然追漫清单只留在这台机器上。',
    '往下翻的时候导航会一直贴在上面，不会跑丢。',
    '想找短的？简介只有两行的通常都不长。',

    /* —— 吐槽与日常 —— */
    '你点我一下我就说一句话，很划算吧？',
    '累了就眨眨眼，漫画不会跑。',
    '字数少不代表不好看，短篇有时候更上头。',
    '人类一天只有 24 小时，漫画却永远看不完，这不公平。',
    '我算过了，按你现在的速度，这些作品够看到明年。',
    '别问我哪部最好看，问就是全都要。',
    '看完一部好漫画的空虚感，只能用下一部填。',
    '剧透是社交事故，所以我什么都不说。',
    '眼睛干的话，眨眼比翻页重要。',
    '你上一次站起来是什么时候？',
    '喝口水吧，我等你。',
    '腰疼不是漫画的错，是椅子的错。',
    '如果生活也有分镜就好了，至少能跳过尴尬的那几格。',
    '我今天一句话都没说，就等你了。',
    '窗外的天气比剧情还难预测。',
    '周末的意义，就是可以毫无负罪感地躺一天。',
    '收藏夹里的「稍后再看」，后来都变成了「再也不看」。',
    '看到一半切出去，回来就找不到刚才那话了——别问我怎么知道的。',
    '好故事的结尾都让人舍不得翻下一页。',
    '有些作品看封面就赢了，有些得看到第三话才醒。',

    /* —— 深夜专属 —— */
    '凌晨三点看恐怖漫，你是真的很勇敢。',
    '「再一话就睡」这句话，我今晚已经听你说过四次了。',
    '天亮之前关掉屏幕，明天的你会感谢现在的你。'
  ];

  /** 按时段问候 */
  var GREETS = {
    morning: [
      '早上好，今天的第一话开始了吗？',
      '早呀，趁脑子清醒多看几话。',
      '早上适合看轻松点的，别一上来就虐。',
      '早，昨晚说好的早睡呢？'
    ],
    noon: [
      '午后犯困的话，来点恋爱漫提神？',
      '这个点儿，适合瘫着看漫画。',
      '午饭吃了吗？边吃边看容易呛到。',
      '下午最容易困，挑一部吵一点的看。'
    ],
    evening: [
      '晚上好，今晚要看点什么？',
      '天黑了，最适合开新坑。',
      '下班/放学路上别看太虐的，容易在车上红眼眶。',
      '晚上好，今天的更新我替你看过了，都在。'
    ],
    night: [
      '这么晚还在追更，小心明天起不来哦。',
      '夜猫子模式已启动，记得喝水。',
      '这个点还没睡的人，通常都在等一个结局。',
      '深夜看漫画的浓度，是白天的三倍。'
    ]
  };

  /** 被连戳两下 */
  var DOUBLE = [
    '戳两下也算喜欢吗？算的。',
    '别戳了别戳了，痒。',
    '双击是有什么暗号吗……哦，没有。',
    '两下。我记住你了。',
    '你再戳，我就要开始收费了。'
  ];

  /** 鼠标停在身上太久 */
  var HOVER = [
    '别盯着看，我会不好意思。',
    '在找我吗？我一直在这儿。',
    '看这么久，是想让我说点什么吧？',
    '你的鼠标离我太近了。'
  ];

  /** 长时间没动静 */
  var IDLE = [
    '还在吗？页面又不会自己翻。',
    '你是不是去看别的网站了。',
    '我在这儿站了很久了，你倒是说话呀。',
    '安静得能听见服务器风扇的声音。'
  ];

  /** 从别的标签页切回来 */
  var BACK = [
    '你回来了，刚才那页我替你留着。',
    '欢迎回来，刚才去哪儿了？',
    '离开这么久，我还以为你被剧情带走了。'
  ];

  /** 从很下面滚回顶部 */
  var TOP = [
    '回到顶上了，重新开始？',
    '上面是首页，下面是深渊，你选。',
    '又回到这儿了，看来你也没想好要看什么。'
  ];

  /** 滚到页面底部 */
  var BOTTOM = [
    '到底啦，没有更多了。要不要去首页看看今天的新番？',
    '到最底下了，今天的量就这么多。',
    '翻到底了还在翻？去排行榜换个口味吧。'
  ];

  /** 深夜点她（23 点后第一次） */
  var LATENIGHT = [
    '这个点还没睡，明天的你会恨现在的你。',
    '再一话就睡——你上次也是这么说的。'
  ];

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
    var burst = 0;            // 连击计数（双击 / 连点彩蛋用）
    var lastClickAt = 0;
    var lastSay = 0;          // 上一次开口的时间戳，用来给各种自发台词降噪
    var lastHoverSay = 0;
    var lastTopSay = 0;
    var lateNightSaid = false;
    var idleMark = Date.now();  // 最后一次「人在动」的时间

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

    /** 从池子里随机取一句，尽量不和上一句重复 */
    function pick(pool) {
      var line = pool[Math.floor(Math.random() * pool.length)];
      if (pool.length > 1 && line === pick.last) line = pool[(pool.indexOf(line) + 1) % pool.length];
      pick.last = line;
      return line;
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
      lastSay = Date.now();
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

    /** 只在「没人说话」的时候插一句，避免盖住用户刚点出来的台词 */
    function quip(pool, gap) {
      if (typing || bubble.classList.contains('show')) return false;
      if (Date.now() - lastSay < (gap || 12000)) return false;
      say(pick(pool));
      return true;
    }

    function greet() {
      var h = new Date().getHours();
      var slot = h < 5 ? 'night' : h < 11 ? 'morning' : h < 18 ? 'noon' : h < 23 ? 'evening' : 'night';
      say(pick(GREETS[slot]));
    }

    /* --------------------------- 交互事件 --------------------------- */
    btn.addEventListener('click', function () {
      btn.classList.remove('bounce', 'wiggle');
      void btn.offsetWidth; // 强制重排，让动画可以重复播放
      btn.classList.add('bounce');

      var now = Date.now();
      idleMark = now;

      // 连击计数：间隔短于 380ms 才算同一串，停下来就重新数
      burst = now - lastClickAt < 380 ? burst + 1 : 1;
      lastClickAt = now;

      if (burst >= 9) {                 // 第 9 下：最狠的那句
        burst = 0;
        btn.classList.add('wiggle');
        say('……你再点，我就要记住你了。', true);
        return;
      }
      if (burst === 5) {                // 第 5 下：老彩蛋
        say('再点就要收费了……骗你的，随便点。');
        return;
      }
      if (burst > 5) return;            // 6~8 下：不吭声，只晃，让她显得有点烦
      if (burst === 2) {                // 第 2 下：戳两下和戳一下不一样
        btn.classList.add('wiggle');
        say(pick(DOUBLE));
        return;
      }
      // 深夜第一次点她，先念一句（23 点到凌晨 5 点）
      var hour = new Date().getHours();
      if (!lateNightSaid && (hour >= 23 || hour < 5)) {
        lateNightSaid = true;
        say(pick(LATENIGHT));
        return;
      }
      say(nextLine());
    });

    // 点气泡直接收起，不用等 8 秒
    bubble.addEventListener('click', function () {
      clearInterval(typing);
      typing = null;
      clearTimeout(hideTimer);
      bubble.classList.remove('show');
    });

    // 悬停 1.2 秒，她会忍不住说一句（40 秒内只犯一次）
    var hoverTimer = null;
    btn.addEventListener('pointerenter', function (e) {
      if (e.pointerType !== 'mouse') return;
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(function () {
        if (box.classList.contains('hidden')) return;
        if (Date.now() - lastHoverSay < 40000) return;
        if (quip(HOVER, 16000)) lastHoverSay = Date.now();
      }, 1200);
    });
    btn.addEventListener('pointerleave', function () {
      clearTimeout(hoverTimer);
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

    /* --------------------------- 环境感应 --------------------------- */
    // 记录「人还在」的时刻：任何一种输入都算
    ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (ev) {
      window.addEventListener(ev, function () { idleMark = Date.now(); }, { passive: true });
    });

    // 90 秒完全没有动静
    setInterval(function () {
      if (document.hidden) return;
      if (Date.now() - idleMark < 90000) return;
      idleMark = Date.now();          // 说完重新计时，别每 15 秒问一次
      quip(IDLE, 60000);
    }, 15000);

    // 从别的标签页切回来
    var leftAt = 0;
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { leftAt = Date.now(); return; }
      if (leftAt && Date.now() - leftAt > 90000) quip(BACK, 20000);
      leftAt = 0;
    });

    // 滚到页面底部 / 从很下面滚回顶部
    var bottomSaid = false;
    var lastY = window.scrollY;
    window.addEventListener('scroll', function () {
      if (box.classList.contains('hidden')) return;
      var y = window.scrollY;
      var down = y > lastY;
      lastY = y;

      if (!bottomSaid) {
        var nearEnd = window.innerHeight + y >= document.body.scrollHeight - 200;
        if (nearEnd && document.body.scrollHeight > 1400) {
          bottomSaid = true;
          say(pick(BOTTOM));
        }
        return;
      }

      // 一路往上回到顶部（不是小幅度回弹）
      if (!down && y < 60 && Date.now() - lastTopSay > 300000) {
        lastTopSay = Date.now();
        quip(TOP, 10000);
      }
    }, { passive: true });

    paintToggle();
  }

  YY.mascot = { init: init };
})(window.YY);
