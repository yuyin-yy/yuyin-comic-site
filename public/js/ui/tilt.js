/* ==========================================================================
 * ui/tilt.js · 3D 倾斜 + 跟随光泽（详情页主封面 / 最近更新轮播）
 * --------------------------------------------------------------------------
 * 参考 foreverblog 首页卡片的悬停（home.js 的 bindCardGlare）：
 *   指针在卡片内的相对位置决定整张卡的姿态——
 *     rotateY = (x - 0.5) * 14  → 左右最大 ±7°
 *     rotateX = -(y - 0.5) * 11  → 上下最大 ±5.5°
 *   perspective 取 900，指针处点一盏柔光（--gx / --gy），
 *   配合封面外面那圈银框读成「装裱好的金属卡」。
 *
 * 与参考站的差别：
 *   - 不引 GSAP，用 rAF 指数逼近目标角度（约 0.4s 追平），手感接近 power3，
 *     停下就退出 rAF，不留空转；
 *   - 多一个 translateZ 抬起（perspective 下约放大 1.8%），鼠标进入时卡片
 *     朝观者浮起一点，离开再落回去。
 *
 * 两个目标（见 TARGETS）：
 *   详情页主封面  全身角度，银框 + 内阴影都在页面样式里；
 *   最近更新轮播  角度收得很小（±2.5°），因为它是满幅大块，
 *                 转多了会压到右边的「本周热门」，近处那点位移只当呼吸。
 *
 * 只在 `(hover: hover)`、非触屏、未开启「减少动效」时启用。
 * 触屏与键盘用户拿到的是静态封面，银框照常显示。
 *
 * 依赖：YY（core.js）
 * 暴露：YY.tilt
 * ========================================================================== */
(function (YY) {
  'use strict';

  var TARGETS = [
    // 这张图 262×349，比参考站的卡片还大一圈，角度反而要收着给，
    // 不然四角会甩出背景、盖到右边的文字上
    { page: 'detail', sel: '.detail-cover', ry: 14, rx: 11, persp: 900, lift: 18 },
    // 轮播是 1000px 级别的整块，边缘位移 = 宽度/2 × sin(角度)，
    // ±2.5° 差不多 22px，正好用阴影吃掉，不会真的贴到隔壁卡片
    { page: 'updates', sel: '#carousel', ry: 5, rx: 3.4, persp: 1600, lift: 6 }
  ];

  var EASE = 0.12;     // 每帧逼近比例（60fps 下约 0.4s 追平）

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  /* 用布局坐标算指针比例，不用 getBoundingClientRect：
     卡片一边转、包围盒一边变（262 宽的卡转 5° 后包围盒能宽出 29px），
     比例跟着漂，角度就会自己抖。offset 系列不受 transform 影响。 */
  function geom(el) {
    var op = el.offsetParent;
    if (!op) return el.getBoundingClientRect();
    var o = op.getBoundingClientRect();
    return {
      left: o.left + el.offsetLeft,
      top: o.top + el.offsetTop,
      width: el.offsetWidth,
      height: el.offsetHeight
    };
  }

  function attach(el, cfg) {
    var cur = { rx: 0, ry: 0, z: 0 };
    var tgt = { rx: 0, ry: 0, z: 0 };
    var raf = 0;

    function apply() {
      var moving = Math.abs(cur.rx) > 0.01 || Math.abs(cur.ry) > 0.01 || cur.z > 0.1;
      el.style.transform = moving
        ? 'perspective(' + cfg.persp + 'px) translate3d(0,0,' + cur.z.toFixed(1) + 'px) ' +
          'rotateX(' + cur.rx.toFixed(2) + 'deg) rotateY(' + cur.ry.toFixed(2) + 'deg)'
        : '';
      el.classList.toggle('is-tilt', moving);
    }

    function tick() {
      raf = 0;
      cur.rx += (tgt.rx - cur.rx) * EASE;
      cur.ry += (tgt.ry - cur.ry) * EASE;
      cur.z += (tgt.z - cur.z) * EASE;
      // 够近就落位，别让 rAF 为了 0.001 度一直转
      if (Math.abs(cur.rx - tgt.rx) < 0.02 &&
          Math.abs(cur.ry - tgt.ry) < 0.02 &&
          Math.abs(cur.z - tgt.z) < 0.2) {
        cur.rx = tgt.rx;
        cur.ry = tgt.ry;
        cur.z = tgt.z;
        apply();
        return;
      }
      apply();
      raf = requestAnimationFrame(tick);
    }

    function run() { if (!raf) raf = requestAnimationFrame(tick); }

    el.addEventListener('pointerenter', function (e) {
      if (e.pointerType !== 'mouse') return;
      tgt.z = cfg.lift;
      run();
    });

    el.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse') return;
      var r = geom(el);
      if (!r.width || !r.height) return;
      var x = clamp01((e.clientX - r.left) / r.width);
      var y = clamp01((e.clientY - r.top) / r.height);
      tgt.ry = (x - 0.5) * cfg.ry;
      tgt.rx = -(y - 0.5) * cfg.rx;
      tgt.z = cfg.lift;
      // 光斑中心跟着指针走（css 里按这个坐标铺径向渐变）
      el.style.setProperty('--gx', (x * 100).toFixed(1) + '%');
      el.style.setProperty('--gy', (y * 100).toFixed(1) + '%');
      run();
    });

    el.addEventListener('pointerleave', function () {
      tgt.rx = 0;
      tgt.ry = 0;
      tgt.z = 0;
      run();
    });

    el.__tiltOn = true;
  }

  function bind() {
    if (!window.matchMedia) return;
    if (!document.body) return;
    if (!window.matchMedia('(hover: hover)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    TARGETS.forEach(function (cfg) {
      if (!document.body.matches('body[data-page="' + cfg.page + '"]')) return;
      var el = document.querySelector(cfg.sel);
      if (!el || el.__tiltOn) return;
      attach(el, cfg);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  YY.tilt = { bind: bind };
})(window.YY);
