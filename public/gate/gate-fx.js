/* ==========================================================================
   gate-fx.js · 罗生门的光尘层
   --------------------------------------------------------------------------
   一张静态插画摆在那儿不动，看久了像壁纸。这一层给它补几样会动的东西：

     · 空气 —— 几颗极淡的大虚焦光斑，缓慢漂移，做出景深；
     · 天空 —— 缓慢上浮的浮尘 + 几团横着飘的雾气，整片天在流动；
     · 门   —— 绕着门盘旋、被门缝吸进去的螺旋光尘（最抢眼的一层）
               + 门缝里向上冒的暖光 + 镶在门框上的柔光；
     · 水面 —— 横向拉长的碎光、几道极扁的波纹线、几片大范围的波光带；
               门正下方偏暖偏亮，因为那里是门光在水里的倒影。

   五条踩过的经验：
     1. 全是 1~3px 的小点根本看不见 —— 亮背景上白色小点没有对比度。
        真正撑起空气感的是「大而极淡」的大光斑和长条，小点只是点缀。
     2. 贴图缩小会稀释 alpha：64px 的渐变缩到 2px，一个输出像素会把整张图
        平均掉，0.4 的 alpha 只剩 0.05。所以小点用实心核的 'dot'，
        大光斑用柔和的 'halo'，两种贴图分开做。
     3. 速度是 px/秒，不是「每帧多少」—— 最早按每帧 0.05px 给，等于每秒 3px，
        一个屏幕要走 8 分钟，看上去就是「没动」。所有速度都在 10px/s 以上，
        肉眼才追得到。
     4. **不能整层都用 `lighter`**：加光混合会把金色顶成纯白，白点落在白门板、
        浅蓝天空上就等于隐形（画了一万多个不透明像素，屏幕上什么都没有）。
        现在分两遍画 —— 柔光用 lighter，实点用 source-over，各保住自己的颜色。
     5. 这颗插画偏暖（米黄、砖红），纯金点叠上去是同一个色系，看着像脏点。
        绕门的光珠所以用 'orb'：亮核外面裹一圈淡暗边，浅底深底都能压出轮廓。

   为什么用 Canvas 2D 而不是 WebGL：粒子总数五百多，而且全是把同一张预渲染
   好的贴图缩放贴上去，2D 足够用；省掉一整套着色器，手机上也更稳。

   坐标系：粒子按视口的 CSS 像素存。门的位置是 gate.js 用 cover 算出视口坐标
   后传进来的，门口光和水的倒影都挂在门矩形上 —— 所以换窗口比例、换手机，
   光尘依然贴着那扇门，不会飘到隔壁的建筑上。
   ========================================================================== */
(function () {
  'use strict';

  var canvas = document.getElementById('gateFx');
  if (!canvas) return;

  var ctx = canvas.getContext('2d');
  if (!ctx) return;

  var media = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* 视口尺寸（CSS 像素）与设备像素比 */
  var W = 0, H = 0, DPR = 1;
  var door = null;              // 门在视口里的矩形，gate.js 传进来
  var parts = [];
  var sprites = null;
  var time = 0, last = 0, raf = 0;
  var burst = 0;                // 推门时的一次性爆发，1 → 0
  var alive = false;
  var hold = false;             // 换尺寸的空档先不画，免得旧坐标闪一下
  var lite = false;             // 掉帧后自动降档
  var rebuildT = 0;
  var hasDoorParts = false;     // 上次建粒子时手里有没有门（决定要不要补建）

  /* 掉帧检测：头 45 帧算平均帧时间 */
  var perfN = 0, perfT = 0, perfOn = true;

  var rnd = function (a, b) { return a + Math.random() * (b - a); };
  var clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };

  /* 总闸：单颗粒子的 p.a 已经按最终亮度标定过，这里只留一个统一微调的开关，
     免得以后想整体压一点或提一点时要挨个改参数。 */
  var GAIN = 1.15;

  /* 两股全局气流：所有粒子共享，才会被感知成「整片空气在动」，
     单颗各飘各的看起来只是零星闪烁。
     天空：左右往返的慢风；水面：同向的缓流。 */
  function skyWind() {
    return Math.sin(time * 0.13) * 8 + Math.sin(time * 0.041 + 1.3) * 12;
  }
  function waterFlow() {
    return Math.sin(time * 0.085) * 16 + Math.sin(time * 0.031 + 0.7) * 9;
  }

  /* --------------------------- 柔光贴图 --------------------------- */

  /** 画一张 64×64 的径向渐变贴图，颜色由 rgb 字符串给（如 '186, 216, 255'）。
   *
   *  三种形状：
   *   · 'dot'  —— 小粒子用。缩小到 2px 时一个输出像素会把整张图平均掉，
   *              所以要留一个够大的实心核，否则 alpha 从 0.4 掉到 0.05，
   *              看过去就是一层看不见的雾。
   *   · 'halo' —— 大光斑、长条用。要够柔，放大到 40px 才不会看出硬圆盘。
   *   · 'orb'  —— 绕门光环用。中心亮、外面裹一圈暗边：这张插画本来就是暖
   *              米黄，纯金色点叠上去和背景是同一个色系，看过去像脏点；有了
   *              暗边，浅背景和深背景都能把轮廓"压"出来。 */
  function makeSprite(rgb, shape) {
    var S = 64;
    var c = document.createElement('canvas');
    c.width = c.height = S;
    var g = c.getContext('2d');
    var grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);

    if (shape === 'orb') {
      grd.addColorStop(0, 'rgba(255, 248, 226, 1)');       // 核心近白
      grd.addColorStop(0.26, 'rgba(' + rgb + ',1)');       // 主体
      grd.addColorStop(0.46, 'rgba(' + rgb + ',0.92)');
      grd.addColorStop(0.68, 'rgba(150, 76, 18, 0.34)');   // 暗边（只用来压轮廓）
      grd.addColorStop(0.86, 'rgba(120, 56, 12, 0.12)');
      grd.addColorStop(1, 'rgba(120, 56, 12, 0)');
    } else if (shape === 'dot') {
      grd.addColorStop(0, 'rgba(' + rgb + ',1)');
      grd.addColorStop(0.45, 'rgba(' + rgb + ',0.98)');
      grd.addColorStop(0.7, 'rgba(' + rgb + ',0.5)');
      grd.addColorStop(0.9, 'rgba(' + rgb + ',0.13)');
      grd.addColorStop(1, 'rgba(' + rgb + ',0)');
    } else {
      grd.addColorStop(0, 'rgba(' + rgb + ',1)');
      grd.addColorStop(0.16, 'rgba(' + rgb + ',0.55)');
      grd.addColorStop(0.4, 'rgba(' + rgb + ',0.17)');
      grd.addColorStop(0.7, 'rgba(' + rgb + ',0.045)');
      grd.addColorStop(1, 'rgba(' + rgb + ',0)');
    }

    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
    return c;
  }

  function buildSprites() {
    sprites = {
      cool: makeSprite('158, 205, 255', 'dot'),    // 天空/水面：偏冷的天光
      soft: makeSprite('226, 240, 255', 'dot'),    // 更白一点的浮尘
      warm: makeSprite('255, 214, 140', 'dot'),    // 门缝里的暖光
      gold: makeSprite('255, 186, 74', 'orb'),     // 绕门的光环：带暗边，浅底深底都压得住
      goldPale: makeSprite('255, 224, 158', 'orb'),  // 光环里的浅色珠，跟主金拉开层次
      haloWarm: makeSprite('255, 238, 200', 'halo'),
      haloSoft: makeSprite('214, 232, 255', 'halo')
    };
  }

  /* ----------------------------- 粒子 ----------------------------- */

  /** k：1 天空浮尘 / 2 水面碎光 / 3 门缝光尘 / 4 大虚焦光斑
   *     5 水面波纹 / 6 门周围的大柔光 / 7 水面大波光带
   *     8 天空流雾 / 9 绕门盘旋的螺旋光尘 */

  /** 水面在视口里的高度。原图上水面比门顶还高一点点，
   *  所以从门的矩形反推最稳 —— 用固定的 H*0.4 在超宽屏上会跑偏，
   *  因为 cover 会把画面上下裁掉一条。 */
  function waterTop() {
    return door ? door.y - door.h * 0.05 : H * 0.4;
  }

  function addBokeh(n) {
    for (var i = 0; i < n; i++) {
      var w = rnd(26, 88);
      parts.push({
        k: 4,
        x: Math.random() * W,
        y: Math.pow(Math.random(), 0.9) * H * 0.92,
        w: w,
        h: w * rnd(0.8, 1.2),
        a: rnd(0.1, 0.22),
        ph: Math.random() * 6.283,
        tw: rnd(0.1, 0.28),       // 几乎不闪，只是很慢地呼吸
        sw: rnd(6, 22),
        swp: rnd(0.12, 0.34),
        vx: rnd(-5, 5),
        vy: rnd(-4, 1.5),
        pull: rnd(0.02, 0.06),
        sp: Math.random() < 0.4 ? sprites.haloWarm : sprites.haloSoft
      });
    }
  }

  /** 天空里的流雾：大而极淡，横着飘，是「天在动」最直接的信号。
   *  单靠小浮尘太细，看久了会以为画面是静止的。 */
  function addCloud(n) {
    for (var i = 0; i < n; i++) {
      var w = rnd(260, 720);
      parts.push({
        k: 8,
        x: rnd(-240, W + 240),
        y: rnd(-H * 0.06, H * 0.5),
        w: w,
        h: w * rnd(0.2, 0.38),
        a: rnd(0.045, 0.095),
        ph: Math.random() * 6.283,
        tw: rnd(0.05, 0.13),
        sw: 0,
        swp: 0,
        vx: rnd(7, 24) * (Math.random() < 0.5 ? -1 : 1),
        vy: rnd(-2, 2),
        pull: 0.14,
        sp: sprites.haloSoft
      });
    }
  }

  function addSky(n) {
    for (var i = 0; i < n; i++) {
      var w = 5 + Math.pow(Math.random(), 2) * 10;
      parts.push({
        k: 1,
        x: Math.random() * W,
        // 指数 >1 让分布偏上：天空在上半部，越靠地面越稀
        y: Math.pow(Math.random(), 1.3) * H * 0.94,
        w: w,
        h: w,
        a: rnd(0.55, 0.95),
        ph: Math.random() * 6.283,
        tw: rnd(0.35, 1.15),      // 闪烁角速度
        sw: rnd(4, 14),           // 横向摆动幅度（px）
        swp: rnd(0.5, 1.5),       // 摆动角速度
        vx: rnd(-7, 7),
        vy: rnd(-19, -6),         // 上升
        pull: rnd(0.04, 0.14),    // 推门时被吹开的程度
        // 蓝天是冷色，往里面放暖色的阳光尘才有色差；纯白点在亮天上等于没有
        sp: Math.random() < 0.3 ? sprites.warm : sprites.soft
      });
    }
  }

  function addWater(n) {
    if (!door) return;
    var top = waterTop();
    var cx = door.x + door.w / 2;
    for (var i = 0; i < n; i++) {
      // 指数 <1 让分布偏下：近处的水面反光更大更亮
      var y = top + Math.pow(Math.random(), 0.72) * (H - top);
      var x = Math.random() * W;

      // 离门中轴越近 = 越是门光的倒影
      var near = Math.max(0, 1 - Math.abs(x - cx) / (door.w * 2.4));

      parts.push({
        k: 2,
        x: x,
        y: y,
        w: rnd(7, 30) * (1 + near * 0.6),
        h: rnd(1, 2.6) * (1 + near * 0.4),     // 扁的：水面反光是被拉长的
        a: rnd(0.45, 0.8) * (1 + near * 0.9),
        ph: Math.random() * 6.283,
        tw: rnd(0.7, 2.2),
        sw: rnd(1.5, 5),
        swp: rnd(0.6, 1.6),
        vx: rnd(-16, 16),
        vy: 0,
        pull: 0,
        sp: near > 0.5 && Math.random() < 0.6 ? sprites.warm : sprites.cool
      });
    }
  }

  /** 水面最有效的一层：几道极扁极淡的横线，像波峰上的反光 */
  function addRipple(n) {
    if (!door) return;
    var top = waterTop() + H * 0.01;
    for (var i = 0; i < n; i++) {
      var y = top + Math.pow(Math.random(), 0.82) * (H - top);
      var near = y / H;                        // 越靠下越近：更长、更亮
      parts.push({
        k: 5,
        x: Math.random() * W,
        y: y,
        w: (34 + near * 160) * rnd(0.55, 1.35),
        h: rnd(1.6, 3.4),
        a: rnd(0.13, 0.26) * (0.55 + near * 0.95),
        ph: Math.random() * 6.283,
        tw: rnd(0.2, 0.6),
        sw: rnd(8, 30),
        swp: rnd(0.3, 0.8),
        vx: rnd(12, 40) * (Math.random() < 0.5 ? -1 : 1),
        vy: 0,
        pull: 0,
        sp: sprites.haloSoft
      });
    }
  }

  /** 水面的大范围波光：一大片极淡的横向光带，慢慢漂。
   *  小碎光负责「碎」，这一层负责「整片水在晃」。 */
  function addShimmer(n) {
    if (!door) return;
    var top = waterTop();
    for (var i = 0; i < n; i++) {
      var y = top + Math.pow(Math.random(), 0.8) * (H - top);
      // 越靠水面线越接近门脚，门光的倒影在那一段最强
      var near = Math.max(0, 1 - Math.abs(y - top) / (H - top) * 1.6);
      parts.push({
        k: 7,
        x: Math.random() * W,
        y: y,
        w: rnd(200, 620),
        h: rnd(6, 22),
        a: rnd(0.04, 0.095) * (0.6 + near * 0.9),
        ph: Math.random() * 6.283,
        tw: rnd(0.12, 0.34),
        sw: rnd(16, 52),
        swp: rnd(0.18, 0.5),
        vx: rnd(-18, 18),
        vy: 0,
        pull: 0,
        sp: Math.random() < 0.4 ? sprites.haloWarm : sprites.haloSoft
      });
    }
  }

  function addGate(n) {
    if (!door) return;
    for (var i = 0; i < n; i++) {
      // u 是「门宽上的位置」：门缝在中线，所以收在 0.32~0.68，
      // 越靠中线越亮，看上去就是光从门缝里渗出来
      var u = rnd(0.32, 0.68);
      var edge = 1 - Math.abs(u - 0.5) * 1.8;
      var w = rnd(5, 11);
      parts.push({
        k: 3,
        x: door.x + door.w * u,
        y: door.y + door.h * rnd(-0.03, 1),
        w: w,
        h: w,
        a: rnd(0.6, 0.98) * edge,
        ph: Math.random() * 6.283,
        tw: rnd(0.6, 1.8),
        sw: rnd(1.5, 5),
        swp: rnd(0.6, 1.5),
        vx: rnd(-6, 6),
        vy: rnd(-26, -8),         // 门里的热光，升得比天空浮尘快
        pull: rnd(0.5, 1.1),
        sp: sprites.warm
      });
    }
  }

  /** 门的柔光：铺在门板上是看不见的（白色叠白色），
   *  所以只镶在门框和门缝上 —— 那里背后是深色的建筑和水面，一点暖光就显形，
   *  晕开的边缘再漫到门板上，看上去才是「门里有光」。 */
  function addGlow(n) {
    if (!door) return;
    for (var i = 0; i < n; i++) {
      // 第 0 颗是门缝那道光柱，其余轮流落在左框 / 右框 / 门脚
      var pillar = i === 0;
      var slot = ['0.5', '0', '1', '0.5'][i % 4];
      var w = pillar ? door.w * rnd(0.26, 0.4) : door.w * rnd(0.32, 0.62);
      parts.push({
        k: 6,
        x: door.x + door.w * (parseFloat(slot) + rnd(-0.1, 0.1)),
        y: pillar
          ? door.y + door.h * 0.5
          : door.y + door.h * rnd(0.1, i % 4 === 3 ? 1.15 : 0.9),
        w: w,
        h: pillar ? door.h * rnd(1.05, 1.25) : w * rnd(1.1, 1.5),
        a: rnd(0.09, 0.17) * (pillar ? 1.35 : 1),
        ph: Math.random() * 6.283,
        tw: rnd(0.14, 0.34),
        sw: rnd(3, 8),
        swp: rnd(0.2, 0.5),
        vx: rnd(-2, 2),
        vy: pillar ? 0 : rnd(-7, -1.5),
        pull: pillar ? 0 : 0.3,
        sp: sprites.haloWarm
      });
    }
  }

  /** 绕门盘旋的光尘 —— 这一层是「活的门」的主角。
   *
   *  做法不是撒散点，而是「丝带」：一条丝带 = 十几颗珠子沿轨道排开、共享同
   *  一个角度、共享同一个呼吸相位，头亮尾淡。散点再多看过去也只是雪花，
   *  只有连成够长的一段弧，才像「有什么正绕着门转」。
   *  （珠子要是各自闪烁，弧会被切成碎点 —— 相位必须挂在 tape 上。）
   *
   *  丝带分两拨：
   *   · 外圈 —— rad 常驻 0.86~1.02、几乎不收，负责那一圈明确的光环；
   *   · 内流 —— rad 从外往里滑，被门缝吸进去，到缝口换个角度重来。
   *
   *  椭圆按门矩形给：横向 1 个门宽、纵向 0.72 个门高（≈184 对 ≈268）。
   *  门本身很瘦长（184×372），纵向半径必须超过半个门高，否则整条轨道都
   *  压在门板上，看过去只是「门上有几个点」，读不出环。 */
  var ORBIT_SEG = 22;        // 每条丝带几颗
  var ORBIT_STEP = 0.038;    // 相邻两颗的角度差（rad，约 2.2°）
                             // 22 颗 ≈ 48°，七条外圈就盖住 336°，几乎是一整圈。
                             // 球的有效直径只有设定值的六成，步长必须小到
                             // 「间隔 < 可见直径」，否则读成虚线

  function addOrbit(ring, flow) {
    if (!door) return;

    function tape(outer, ang0) {
      var t = {
        ang: ang0,                  // 由外面按角度均匀铺开，不随机
        // 外圈要「在同一个椭圆上」才连成环：rad 一散开，某几条会缩到门内，
        // 环上就露出缺口。内流那层才需要拉开距离。
        rad: outer ? rnd(0.9, 1.04) : rnd(0.3, 0.92),
        // 角速度 0.28~0.6 rad/s：绕一圈 10~22 秒。丝带是连着的，
        // 视觉上一直有东西在移动，不需要转得飞快
        spd: rnd(0.28, 0.6) * (Math.random() < 0.32 ? -1 : 1),
        // 外圈几乎不收（否则光环会散掉），内流收得快
        fall: outer ? rnd(0.006, 0.02) : rnd(0.055, 0.14),
        dy: rnd(-0.34, 0.34),       // 收进门缝时落在缝里的纵向位置
        wob: rnd(2, 5.5),           // 上下浮动，别像一根画上去的链子
        wobp: rnd(0.4, 1.1),
        // 手机屏幕小、轨道周长却没短多少，同一颗珠子会挤在一起连成粗链，
        // 所以小屏单独用细一号的珠子
        wid: lite
          ? (outer ? rnd(6.5, 9) : rnd(5, 7))
          : (outer ? rnd(11, 15) : rnd(7, 11)),
        a0: outer ? rnd(0.72, 1) : rnd(0.45, 0.78),
        ph: Math.random() * 6.283,  // 整条丝带共用一个呼吸相位
        tw: rnd(0.5, 1.3),
        warm: Math.random() < 0.7,
        outer: outer
      };
      for (var j = 0; j < ORBIT_SEG; j++) {
        parts.push({
          k: 9,
          t: t,                     // 同一条丝带共享轨道状态
          seg: j,                   // 第几颗（0 是头）
          x: 0, y: 0, w: 0, h: 0,   // 每帧由 ang/rad 算出来
          // 头亮尾淡，但别淡到看不见 —— 尾巴也是弧的一部分
          a: t.a0 * (1 - j / ORBIT_SEG * 0.55),
          ph: t.ph,
          tw: t.tw,
          sw: 0, swp: 0, vx: 0, vy: 0, pull: 0,
          sp: t.warm ? sprites.gold : sprites.goldPale
        });
      }
    }

    // 外圈均匀铺开（不然随机一挤就全凑在一侧，另一侧空着，看不出是环）；
    // 内流也铺开，但错开一个相位，免得和外圈叠在同一条线上
    for (var i = 0; i < ring; i++) tape(true, i / ring * 6.283 + rnd(-0.3, 0.3));
    for (var k = 0; k < flow; k++) {
      tape(false, k / flow * 6.283 + 6.283 / flow / 2 + rnd(-0.4, 0.4));
    }
  }

  function rebuild(on) {
    parts.length = 0;
    // 小屏直接用轻档：390 宽的屏塞五百多颗点会糊成一片。
    // on 是掉帧后主动降的档，两种都要认。
    lite = !!on || W <= 720;
    hasDoorParts = !!door;
    // 桌面视口面积是手机的十几倍，数量得跟上，否则密度差一截。
    // 手机维持现量级就够了 —— 竖屏时画面被放大，粒子本来就显眼。
    addBokeh(lite ? 4 : 10);
    addCloud(lite ? 3 : 7);
    addSky(lite ? 34 : 140);
    addRipple(lite ? 7 : 18);
    addShimmer(lite ? 4 : 9);
    addWater(lite ? 30 : 78);
    // 参数是「外圈条数, 内流条数」，每条 12 颗、约 49° 长：
    // 桌面 6 + 3 = 108 颗，外圈盖住 294°，看过去就是一道断续但均匀的光环
    addOrbit(lite ? 6 : 7, lite ? 3 : 3);
    addGate(lite ? 16 : 44);
    addGlow(lite ? 4 : 6);
  }

  /* ----------------------------- 尺寸 ----------------------------- */

  /** 返回 true 表示画布尺寸变了 */
  function sizeCanvas() {
    /* 不能只信 clientWidth：CSS 还没生效的时候，canvas 没有布局尺寸，
       clientWidth 退回到元素的内在宽度 300（不是 0），于是画布被按 300×150
       建起来，再被 CSS 拉伸到全屏 —— 粒子坐标就全错了。
       所以小于视口九成的值一律不认。 */
    var vw = window.innerWidth || document.documentElement.clientWidth;
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var w = canvas.clientWidth;
    var h = canvas.clientHeight;
    if (!(w > vw * 0.9)) w = vw;
    if (!(h > vh * 0.9)) h = vh;
    if (!w || !h) return false;

    // 手机把 DPR 压到 1.6：光点本来就是糊的，多出来的像素只是白烧 GPU
    var dpr = Math.min(window.devicePixelRatio || 1, w <= 720 ? 1.6 : 2);
    if (w === W && h === H && dpr === DPR) return false;

    W = w;
    H = h;
    DPR = dpr;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);   // 之后一律按 CSS 像素画
    return true;
  }

  /* ----------------------------- 每帧 ----------------------------- */

  /** 0.62~1 的不规则闪烁：两条不同倍频的正弦相乘，水面才会"碎"着亮。
   *  下限别压太低 —— 一压，同一时刻能看见的粒子就少一半，画面会显得空。 */
  function flicker(p) {
    var s1 = Math.sin(time * p.tw + p.ph);
    var s2 = Math.sin(time * p.tw * 2.31 + p.ph * 1.7);
    return 0.62 + 0.38 * (0.5 + 0.5 * s1 * (0.62 + 0.38 * s2));
  }

  /** 这一颗是「大而淡的柔光」还是「小而实的点」
   *  柔光：大虚焦光斑、门框暖光、水面波光带、天空流雾、水面波纹 */
  function isSoft(k) {
    return k === 4 || k === 5 || k === 6 || k === 7 || k === 8;
  }

  function step(dt) {
    if (burst > 0) burst = Math.max(0, burst - dt * 0.8);

    var cx = door ? door.x + door.w / 2 : W / 2;
    var cy = door ? door.y + door.h / 2 : H / 2;
    var wind = skyWind();         // 天空的整体气流
    var flow = waterFlow();       // 水面的整体水流

    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];

      /* 绕门的丝带：轨道状态挂在共用的 tape 上，只有头（seg 0）推进它 */
      if (p.k === 9) {
        var t = p.t;

        if (p.seg === 0) {
          t.ang += t.spd * dt;
          t.rad -= t.fall * dt;
          // 推门时被门里的光顶出去，散开再重新吸回来
          if (burst > 0) t.rad += burst * dt * 2.4;
          if (t.rad <= 0.03 || t.rad > 1.32) {
            // 外圈丝带收完了就回到外圈，内流的从最外圈重新开始
            t.rad = t.outer ? rnd(0.9, 1.02) : 1.02;
            t.ang = Math.random() * 6.283;
            t.dy = rnd(-0.34, 0.34);
          }
        }

        // 尾巴拖在身后：角速度为正就往负方向排，反之亦然
        var ang = t.ang - p.seg * ORBIT_STEP * (t.spd > 0 ? 1 : -1);
        // f 不从 0 起：收到最小的时候珠子停在门缝附近，而不是缩成一个点
        var f = 0.25 + 0.75 * t.rad;
        p.x = cx + Math.cos(ang) * door.w * 1 * f;
        p.y = cy + Math.sin(ang) * door.h * 0.72 * f + (1 - f) * door.h * t.dy +
              Math.sin(time * t.wobp + p.ph) * t.wob;
        p.w = p.h = t.wid * (1 - p.seg / ORBIT_SEG * 0.34);  // 尾巴略细
        continue;
      }

      if (p.k === 2 || p.k === 5 || p.k === 7) {
        // 水面只横向漂：竖直方向是水波，交给绘制时的正弦
        p.x += (p.vx + flow) * dt;
      } else {
        // 推门时从门心往外吹：越远的吹得越开
        var push = burst * p.pull;
        p.x += (p.vx + (p.k === 1 || p.k === 8 ? wind * 0.8 : 0) +
                (p.x - cx) * push * 0.8) * dt;
        p.y += (p.vy - push * 52) * dt;
      }

      if (p.x < -320) p.x = W + 320;
      else if (p.x > W + 320) p.x = -320;

      if (p.k === 1) {
        // 向上飘出天空 → 从底部换一列回来
        if (p.y < -40) { p.y = H * 0.94; p.x = Math.random() * W; }
      } else if (p.k === 3) {
        // 门缝的光飘出门顶 → 从门底重新开始
        if (p.y < door.y - 40) {
          p.y = door.y + door.h * rnd(0.86, 1);
          p.x = door.x + door.w * rnd(0.32, 0.68);
          p.a = rnd(0.6, 0.98) * (1 - Math.abs((p.x - door.x) / door.w - 0.5) * 1.8);
        }
      } else if (p.k === 6) {
        // 门周围的柔光飘高了就从门底回来
        if (p.y < door.y - 160 && p.vy !== 0) {
          p.y = door.y + door.h * rnd(0.7, 0.95);
          p.x = door.x + door.w * rnd(-0.25, 1.25);
        }
      }
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    /* 分两遍画，这一步很关键：
       柔光（大光斑、光带、门框光）用 'lighter' 叠加，重叠处互相点亮，
       才是空气里那团光的味道。
       但「小而实」的点必须用 'source-over' —— 在亮背景上用加光混色，
       金色会被直接顶到纯白，而白点落在白门板、浅蓝天空上等于隐形。
       之前整层环绕粒子「画了却看不见」，就是被这个加成白色吃掉的。 */
    for (var pass = 0; pass < 2; pass++) {
      var soft = pass === 0;
      ctx.globalCompositeOperation = soft ? 'lighter' : 'source-over';

      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        if (isSoft(p.k) !== soft) continue;

        var a = p.a * flicker(p) * GAIN;

        if (p.k === 3 && burst > 0) a *= 1 + burst * 1.7;   // 推门那一刻门缝最亮

        if (p.k === 9) {
          // 外圈淡入：丝带换角度重新开始时不会凭空冒出来
          a *= clamp((1.24 - p.t.rad) * 4.2, 0, 1) * 1.3;
        }

        if (a < 0.004) continue;

        var x = p.x + Math.sin(time * p.swp + p.ph) * p.sw;
        var y = p.y;
        if (p.k === 2 || p.k === 5 || p.k === 7) {
          y += Math.sin(time * p.swp * 1.4 + p.ph * 2) * 3.4;
        }

        ctx.globalAlpha = a > 1 ? 1 : a;
        try {
          ctx.drawImage(p.sp, x - p.w / 2, y - p.h / 2, p.w, p.h);
        } catch (e) {
          // 一颗坏贴图不该让后面所有层一起消失，但要把原因留下来
          window.__fxErr = 'k' + p.k + ' ' + (e && e.message);
        }
      }
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function loop(t) {
    if (!alive) return;
    raf = requestAnimationFrame(loop);

    if (!last) last = t;
    var dt = (t - last) / 1000;
    last = t;
    if (dt > 0.06) dt = 0.06;      // 切回标签页时别一步跳过大半秒
    time += dt;

    // 掉帧就降档一次：多半是低端机 / 高分屏，砍像素比和粒子数最有效
    if (perfOn) {
      perfN++;
      perfT += dt;
      if (perfN >= 45) {
        perfOn = false;
        if (perfT / perfN > 0.026) {
          DPR = 1;
          canvas.width = W;
          canvas.height = H;
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          rebuild(true);
        }
      }
    }

    step(dt);
    if (!hold) draw();
  }

  function start() {
    if (alive) return;
    alive = true;
    last = 0;
    raf = requestAnimationFrame(loop);
  }

  function stop() {
    alive = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  /* ----------------------------- 对外 ----------------------------- */

  function setDoor(rect) {
    door = rect;
    var resized = sizeCanvas();

    if (!parts.length) {          // 第一次：直接建起来开跑
      rebuild(false);
      start();
      return;
    }
    if (!hasDoorParts) {          // 上次建的时候还没拿到门，补建一次
      rebuild(lite);
      return;
    }
    if (resized) {                // 窗口变了：停画一会儿再重排，免得旧坐标闪
      hold = true;
      clearTimeout(rebuildT);
      rebuildT = setTimeout(function () {
        rebuild(lite);
        hold = false;
      }, 110);
    }
  }

  /** 推门：门缝的光炸一下，把周围的浮尘往外吹散 */
  function burstOnce() {
    burst = 1;
  }

  function init() {
    // 关了动效就不画：省电，也免得画面里凭空多出闪动的东西
    if (media.matches) {
      canvas.style.display = 'none';
      return;
    }
    buildSprites();

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop();
      else start();
    });

    /** 兜底：gate.js 那一次 layout 有可能比本文件先跑完（脚本顺序、CSS 尚未
     *  生效都会让它的 `if (window.GateFx)` 落空），那 door 会一直是 null ——
     *  水面波纹、门缝暖光、绕门丝带全都建不出来，画面上只剩天空的浮尘。
     *  所以在这里补一次：还没拿到门就喊一声 resize，让它重新 layout。 */
    function needDoor() {
      if (door) return;
      window.dispatchEvent(new Event('resize'));
    }

    // 200ms 时先补一次（多半这时 CSS 已经生效了），800ms 再补一次
    setTimeout(needDoor, 200);
    setTimeout(needDoor, 800);

    // 万一还是没人给门，至少让画面有东西，别是一片空的
    setTimeout(function () {
      if (!parts.length) { sizeCanvas(); rebuild(false); start(); }
    }, 900);
  }

  window.GateFx = {
    setDoor: setDoor,
    burst: burstOnce,
    stop: stop,
    /* 调样式时用：把某一层的坐标吐出来，方便对着截图核对。
       node tools/shot.js --probe "GateFx.debug(9)" */
    debug: function (k) {
      return {
        W: W, H: H, door: door, n: parts.length,
        pts: parts.filter(function (p) { return !k || p.k === k; })
          .map(function (p) {
            return [Math.round(p.x), Math.round(p.y), Math.round(p.w), +(p.a).toFixed(2)];
          })
      };
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
