/* ==========================================================================
   gate-fx.js · 罗生门的光尘层
   --------------------------------------------------------------------------
   一张静态插画摆在那儿不动，看久了像壁纸。这一层给它补几样会动的东西：

     · 空气 —— 几颗极淡的大虚焦光斑，缓慢漂移，做出景深；
     · 天空 —— 缓慢上浮的浮尘 + 几团横着飘的雾气，整片天在流动；
     · 门   —— 左右两侧从水面升起的水汽（最抢眼的一层）：
               贴着门框往上走、越往上越往外散，像被门里的光吸上去；
               + 门缝里向上冒的光 + 镶在门框上的柔光；
     · 水面 —— 横向拉长的碎光、几道极扁的波纹线、几片大范围的波光带；
               门正下方偏亮，因为那里是门光在水里的倒影。

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
     5. 水汽不是「点」而是「缕」：单颗要用细长的竖条（h 远大于 w），
        十几颗沿同一条弧线错开上升，连起来才读成一股往上的流。
        原来的绕门金色丝带已经撤掉 —— 那一圈黄珠太抢，盖住了水面的走向。

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

  /** 竖条贴图（64×256）：水汽珠子专用。
   *  不用「圆点拉伸」—— 径向渐变拉长后中间亮、两头尖，缩到 10px 宽会读成
   *  一串叶片/虚线。这里改画「上下柔化的竖条」：纵向有一段真正不透明的主体，
   *  珠子上下交叠时才连成连续的一缕。 */
  function makeStreak(rgb) {
    var W2 = 64, H2 = 256;
    var c = document.createElement('canvas');
    c.width = W2; c.height = H2;
    var g = c.getContext('2d');

    g.fillStyle = 'rgba(' + rgb + ', 1)';
    g.fillRect(0, 0, W2, H2);

    // 先做横向柔边（左右淡出）
    g.globalCompositeOperation = 'destination-in';
    var gx = g.createLinearGradient(0, 0, W2, 0);
    gx.addColorStop(0, 'rgba(0,0,0,0)');
    gx.addColorStop(0.18, 'rgba(0,0,0,0.42)');
    gx.addColorStop(0.5, 'rgba(0,0,0,1)');
    gx.addColorStop(0.82, 'rgba(0,0,0,0.42)');
    gx.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gx;
    g.fillRect(0, 0, W2, H2);

    // 再做纵向：中间 72% 保持不透明，两头各留一段淡出
    var gy = g.createLinearGradient(0, 0, 0, H2);
    gy.addColorStop(0, 'rgba(0,0,0,0)');
    gy.addColorStop(0.16, 'rgba(0,0,0,1)');
    gy.addColorStop(0.84, 'rgba(0,0,0,1)');
    gy.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gy;
    g.fillRect(0, 0, W2, H2);

    return c;
  }

  function buildSprites() {
    sprites = {
      cool: makeSprite('158, 205, 255', 'dot'),    // 天空/水面：偏冷的天光
      soft: makeSprite('226, 240, 255', 'dot'),    // 更白一点的浮尘
      // 门缝的光是暖白，不是金黄：原来 255,214,140 落在浅色插画上像脏黄点
      warm: makeSprite('255, 236, 206', 'dot'),
      haloWarm: makeSprite('255, 238, 200', 'halo'),
      haloSoft: makeSprite('214, 232, 255', 'halo'),
      vapor: makeStreak('236, 246, 255'),
      vaporCool: makeStreak('206, 228, 255')
    };
  }

  /* ----------------------------- 粒子 ----------------------------- */

  /** k：1 天空浮尘 / 2 水面碎光 / 3 门缝光尘 / 4 大虚焦光斑
   *     5 水面波纹 / 6 门周围的大柔光 / 7 水面大波光带
   *     8 天空流雾 / 9 绕门盘旋的螺旋光尘 */

  /** 水面在视口里的高度。
   *  原图 1440×900 上量的：门顶 0.365、门底 0.778、建筑下沿 ≈0.635，
   *  所以水面线在门高的 0.654 处。以前写成 door.y - 0.05h（门顶上方），
   *  水面粒子会撒到建筑和天空上，看着像灰尘；水汽也从半空开始，像下雨。 */
  function waterTop() {
    return door ? door.y + door.h * 0.654 : H * 0.64;
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
        sp: sprites.haloSoft
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
        // 只用冷白：暖黄点落在蓝天/白门上会被读成「脏点」，
        // 想要的那点阳光感交给门缝与门框的柔光去给
        sp: Math.random() < 0.35 ? sprites.cool : sprites.soft
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
        sp: near > 0.5 ? sprites.soft : sprites.cool
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
        sp: sprites.haloSoft
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

  /** 门两侧升起的水汽 —— 这一层是「门在呼吸」的主角。
   *
   *  走向按参考图划的两条线来：从门脚的水面起步，贴着门框往上，
   *  一边升一边向外散，越过门顶之后淡掉。
   *
   *  和绕门光环一样用「丝带」：一条流 = 十几颗珠子沿同一条曲线错开高度，
   *  共用同一个摆动相位。散点会读成雨丝 / 雪花，只有连成一段连续的 S 形，
   *  才像一股被吸上去的水汽。
   */
  var VAPOR_SEG = 18;        // 每条流几颗
  var VAPOR_DU = 0.042;      // 相邻两颗在路径上的间距（18 颗盖住 0.76 段路）

  function addVapor(ribbons) {
    if (!door) return;

    function tape(side, slot) {
      var t = {
        side: side,
        u: Math.random(),               // 头的位置：0 出水、1 到顶
        spd: rnd(0.035, 0.075),         // 走完全程约 13~28 秒
        ph: Math.random() * 6.283,      // 整条流共用一个摆动相位
        amp: rnd(0.12, 0.22),           // 横向摆幅（门宽的倍数）
        // 同侧几条按 slot 错开，才会读成两三缕并排的流，而不是一坨雾
        off: 0.50 + slot * 0.065
      };
      for (var j = 0; j < VAPOR_SEG; j++) {
        var w = rnd(9, 15) * (lite ? 0.82 : 1);
        parts.push({
          k: 9,
          t: t,
          seg: j,
          x: 0, y: 0,
          w: w,
          // 高度要盖过「珠距」（约 0.042 段路 ≈ 15px）：短了会读成一串珠子
          h: w * rnd(3.4, 5.2),
          a: rnd(0.14, 0.26) * (1 - j / VAPOR_SEG * 0.28),
          jx: rnd(-1, 1) * w * 0.55,     // 每颗左右错开一点，整缕才不呆板
          fade: 0,
          sp: Math.random() < 0.28 ? sprites.vaporCool : sprites.vapor
        });
      }
    }

    // 左右各一半；两边的相位错开，不会像镜像一样同时摆
    var per = Math.max(1, Math.round(ribbons / 2));
    for (var i = 0; i < per; i++) {
      tape(1, i);
      tape(-1, i);
    }
  }

  /** 水汽的「体」：几团跟着同一条流上升的柔光，负责让流看起来有厚度。
   *  全是细条会显得像雨丝，加上这层才有蒸腾感。 */
  function addVaporWisp(n) {
    if (!door) return;
    for (var i = 0; i < n; i++) {
      var w = rnd(30, 62);
      parts.push({
        k: 10,
        side: i % 2 ? 1 : -1,
        u: Math.random(),
        spd: rnd(0.035, 0.07),
        w: w,
        h: w * rnd(2.6, 4.4),
        a: rnd(0.05, 0.1),
        off: rnd(0.55, 0.85),
        amp: rnd(0.05, 0.1),
        ph: Math.random() * 6.283,
        tw: rnd(0.12, 0.32),
        sw: rnd(2, 6),
        swp: rnd(0.2, 0.6),
        sp: sprites.haloSoft
      });
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
    // 门两侧的水汽：桌面每边 2 缕（4 × 18 颗），手机每边 2 缕
    addVapor(4);
    addVaporWisp(lite ? 8 : 18);
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
    return k === 4 || k === 5 || k === 6 || k === 7 || k === 8 || k === 10;
  }

  function step(dt) {
    if (burst > 0) burst = Math.max(0, burst - dt * 0.8);

    var cx = door ? door.x + door.w / 2 : W / 2;
    var cy = door ? door.y + door.h / 2 : H / 2;
    var wind = skyWind();         // 天空的整体气流
    var flow = waterFlow();       // 水面的整体水流

    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];

      /* 门两侧的水汽：整条流由头推进，珠子按 seg 错开高度。
         位置每帧由 u 现算，所以换窗口比例、换手机，水汽始终贴着这扇门。 */
      if (p.k === 9 || p.k === 10) {
        var cu, vside, voff, vph, vamp;

        if (p.k === 9) {
          var vt = p.t;
          if (p.seg === 0) {
            vt.u += vt.spd * dt * (1 + burst * 1.6);
            if (vt.u > 1.14) { vt.u = -0.12; vt.ph = Math.random() * 6.283; }
          }
          var vu = vt.u - p.seg * VAPOR_DU;
          cu = vu < 0 ? 0 : vu > 1 ? 1 : vu;
          vside = vt.side;
          voff = vt.off + 0.52 * cu;
          vph = vt.ph;
          vamp = vt.amp;
          // 两头淡进淡出：水里冒出来、顶上散掉，都不会凭空出现
          p.fade = (vu < 0 || vu > 1) ? 0 : Math.sin(Math.PI * vu);
        } else {
          p.u += p.spd * dt;
          if (p.u > 1.05) p.u = -0.05;
          cu = p.u < 0 ? 0 : p.u > 1 ? 1 : p.u;
          vside = p.side;
          voff = p.off + 0.52 * cu;
          vph = p.ph;
          vamp = p.amp;
          p.fade = Math.sin(Math.PI * cu);
        }

        var vy0 = door.y + door.h * 0.62;        // 出水口：门脚的水面
        var vy1 = door.y - door.h * 0.36;        // 越过门顶再散掉
        var vsw = Math.sin(cu * 4.4 + time * 0.42 + vph) * vamp * (0.35 + cu);
        p.x = cx + vside * door.w * (voff + vsw) + (p.jx || 0);
        p.y = vy0 + (vy1 - vy0) * cu;
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

        if (p.k === 9 || p.k === 10) a *= p.fade;

        if (a < 0.004) continue;

        // sw/swp 只有部分层有（水汽的位置已经由路径算好，不需要再摆）；
        // 缺字段时 Math.sin(undefined) = NaN，x 变 NaN 会让 drawImage 静默跳过
        var x = p.x + (p.sw ? Math.sin(time * p.swp + p.ph) * p.sw : 0);
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
            return [Math.round(p.x), Math.round(p.y), Math.round(p.w), +(p.a).toFixed(2),
                    Math.round(p.h), +(p.fade || 0).toFixed(2)];
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
