/* ==========================================================================
 * hero-fx.js · 首屏背景动态层（原生 WebGL，零依赖）
 * --------------------------------------------------------------------------
 * 把首页那张静态背景图变成「会呼吸」的画面，只做三件克制的事：
 *   1. 极缓的呼吸缩放 + UV 流动 —— 画面像被空气/水汽轻轻推动
 *   2. 从原图亮部采样出来的浮尘光点，缓慢上浮、明灭
 *   3. 指针视差 —— 鼠标移动时取景框轻微平移，光点反向偏移做出层次
 *
 * 为什么不用 three.js：这里只有「一个全屏四边形 + 一团点精灵」，
 * three.js 的渲染器 + 场景图约 600KB，抵得上一张封面图的体积，
 * 换来的能力（3D 模型、光照、后期）在这个场景里都用不上。
 * 见 MEMORY 里记的取舍说明。
 *
 * 退化策略：无 WebGL / 系统开启「减少动态效果」/ 加载失败 → 直接不接管，
 * 页面仍用 CSS 的 .hero-bg 静态背景，肉眼无差别。
 * ========================================================================== */
(function (YY) {
  'use strict';

  var MAX_DPR = 1.5;          // 高 DPI 屏只按 1.5 倍渲染，省一半像素
  var DUST_DESKTOP = 130;     // 桌面光点数量
  var DUST_MOBILE = 64;

  /* ---------------------------------------------------------------- 着色器 */

  var VS_QUAD = [
    'attribute vec2 aPos;',
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = aPos * 0.5 + 0.5;',
    '  gl_Position = vec4(aPos, 0.0, 1.0);',
    '}'
  ].join('\n');

  var FS_QUAD = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D uTex;',
    'uniform vec2 uCanvas;',   // 画布 CSS 尺寸
    'uniform vec2 uImage;',    // 原图像素尺寸
    'uniform vec2 uFocus;',    // 取景焦点，对应 CSS 的 background-position
    'uniform vec2 uPointer;',  // -1..1
    'uniform float uTime;',
    'uniform float uZoom;',    // 呼吸缩放，>1 为放大

    'void main() {',
    '  // p: 0..1，原点左上，和 CSS 的 background-position 同一套坐标',
    '  vec2 p = vec2(vUv.x, 1.0 - vUv.y);',

    '  // 复刻 background-size: cover 的裁切比例',
    '  float ia = uImage.x / uImage.y;',
    '  float ca = uCanvas.x / uCanvas.y;',
    '  vec2 s = vec2(min(1.0, ca / ia), min(1.0, ia / ca)) / uZoom;',

    '  vec2 f = clamp(uFocus + uPointer * 0.026, 0.0, 1.0);',
    '  vec2 imgUV = f * (1.0 - s) + p * s;',

    '  // 极缓流动：幅度约 3~5 图像像素，只在静止细看时能察觉',
    '  float t = uTime;',
    '  imgUV.x += sin(imgUV.y * 9.0 + t * 0.50) * 0.0013',
    '           + sin(imgUV.y * 3.3 - t * 0.27) * 0.0017;',
    '  imgUV.y += cos(imgUV.x * 5.0 + t * 0.36) * 0.0009;',

    '  vec3 col = texture2D(uTex, vec2(imgUV.x, 1.0 - imgUV.y)).rgb;',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  var VS_DUST = [
    'attribute vec2 aPos;',    // 画布 uv，0..1，原点左上
    'attribute float aSeed;',
    'attribute float aSize;',
    'attribute vec3 aColor;',
    'uniform float uTime;',
    'uniform float uDpr;',
    'uniform vec2 uPointer;',
    'varying float vAlpha;',
    'varying vec3 vColor;',
    'void main() {',
    '  float t = uTime;',
    '  float speed = 0.009 + aSeed * 0.017;',
    '  float y = mod(aPos.y + t * speed, 1.16) - 0.08;',   // 缓慢上浮并循环
    '  float x = aPos.x',
    '          + sin(t * (0.22 + aSeed * 0.38) + aSeed * 21.0) * (0.004 + aSeed * 0.006)',
    '          + uPointer.x * 0.020 * (0.35 + aSeed);',    // 与画面反向，拉开层次
    '  y += uPointer.y * 0.014 * (0.35 + aSeed);',
    '  vec2 clip = vec2(x * 2.0 - 1.0, 1.0 - y * 2.0);',
    '  gl_Position = vec4(clip, 0.0, 1.0);',
    '  float tw = 0.56 + 0.44 * sin(t * (0.7 + aSeed * 1.7) + aSeed * 33.0);',
    '  vAlpha = tw * (0.34 + 0.50 * aSeed);',
    '  vAlpha *= smoothstep(0.0, 0.07, x) * (1.0 - smoothstep(0.93, 1.0, x));',
    '  gl_PointSize = aSize * uDpr * (0.72 + 0.55 * tw);',
    '  vColor = aColor;',
    '}'
  ].join('\n');

  var FS_DUST = [
    'precision mediump float;',
    'varying float vAlpha;',
    'varying vec3 vColor;',
    'void main() {',
    '  float r = length(gl_PointCoord - 0.5);',
    '  float a = smoothstep(0.5, 0.03, r);',
    '  gl_FragColor = vec4(vColor, a * vAlpha);',
    '}'
  ].join('\n');

  /* ---------------------------------------------------------------- 工具 */

  function makeShader(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  function makeProgram(gl, vsSrc, fsSrc) {
    var vs = makeShader(gl, gl.VERTEX_SHADER, vsSrc);
    var fs = makeShader(gl, gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;
    var p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      gl.deleteProgram(p);
      return null;
    }
    return p;
  }

  /** 从元素的计算样式里取背景图地址与焦点百分比 */
  function readBackdrop(bg) {
    var cs = window.getComputedStyle(bg);
    var m = /url\(["']?(.*?)["']?\)/.exec(cs.backgroundImage || '');
    var pos = (cs.backgroundPosition || '50% 28%').split(/\s+/);
    var fx = parseFloat(pos[0]);
    var fy = parseFloat(pos[1] == null ? pos[0] : pos[1]);
    return {
      url: m ? m[1] : '',
      fx: isNaN(fx) ? 0.5 : fx / 100,
      fy: isNaN(fy) ? 0.28 : fy / 100
    };
  }

  /* ------------------------------------------------------------------ 主体 */

  function init() {
    var hero = document.querySelector('.hero');
    var bg = document.querySelector('.hero-bg');
    if (!hero || !bg) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // ?fx=0 关掉动态层，方便和静态版对比
    if (/(?:^|[?&])fx=0(?:&|$)/.test(location.search)) return;

    var canvas = document.getElementById('heroFx');
    if (!canvas) return;

    var gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'low-power' })
          || canvas.getContext('webgl', { antialias: false, alpha: false });
    if (!gl) return;

    var quadProg = makeProgram(gl, VS_QUAD, FS_QUAD);
    var dustProg = makeProgram(gl, VS_DUST, FS_DUST);
    if (!quadProg || !dustProg) return;

    /* 全屏四边形的两个三角形 */
    var quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1
    ]), gl.STATIC_DRAW);

    var quadLoc = {
      aPos: gl.getAttribLocation(quadProg, 'aPos'),
      uTex: gl.getUniformLocation(quadProg, 'uTex'),
      uCanvas: gl.getUniformLocation(quadProg, 'uCanvas'),
      uImage: gl.getUniformLocation(quadProg, 'uImage'),
      uFocus: gl.getUniformLocation(quadProg, 'uFocus'),
      uPointer: gl.getUniformLocation(quadProg, 'uPointer'),
      uTime: gl.getUniformLocation(quadProg, 'uTime'),
      uZoom: gl.getUniformLocation(quadProg, 'uZoom')
    };

    var dustLoc = {
      aPos: gl.getAttribLocation(dustProg, 'aPos'),
      aSeed: gl.getAttribLocation(dustProg, 'aSeed'),
      aSize: gl.getAttribLocation(dustProg, 'aSize'),
      aColor: gl.getAttribLocation(dustProg, 'aColor'),
      uTime: gl.getUniformLocation(dustProg, 'uTime'),
      uDpr: gl.getUniformLocation(dustProg, 'uDpr'),
      uPointer: gl.getUniformLocation(dustProg, 'uPointer')
    };

    var dustBuf = {
      pos: gl.createBuffer(),
      seed: gl.createBuffer(),
      size: gl.createBuffer(),
      color: gl.createBuffer()
    };
    var dustCount = 0;

    var texture = gl.createTexture();
    var imageReady = false;
    var imgW = 1;
    var imgH = 1;

    var cssW = 0, cssH = 0, dpr = 1;
    var focus = { fx: 0.5, fy: 0.28 };
    var pointer = { x: 0, y: 0 };      // 当前值（缓动）
    var pointerTo = { x: 0, y: 0 };    // 目标值
    var time = 0;
    var started = 0;
    var raf = 0;
    var visible = true;
    var disposed = false;

    /* ---------------------------------------------------------- 资源加载 */

    var back = readBackdrop(bg);
    var img = new Image();
    img.decoding = 'async';
    img.onload = function () {
      if (disposed) return;
      imgW = img.naturalWidth || 1920;
      imgH = img.naturalHeight || 800;

      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      // WebGL2 允许非 2 的幂贴图生成 mipmap，缩小时不会因为走样而抖
      if (gl.generateMipmap && canvas.getContext('webgl2')) {
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      }

      imageReady = true;
      resize(true);
      start();
      canvas.classList.add('is-on');
    };
    img.onerror = function () { /* 保持 CSS 静态背景 */ };
    img.src = back.url;

    /* -------------------------------------------------------------- 布局 */

    function resize(rebuild) {
      var rect = hero.getBoundingClientRect();
      var w = Math.max(1, Math.round(rect.width));
      var h = Math.max(1, Math.round(rect.height));
      dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);

      if (w !== cssW || h !== cssH) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        gl.viewport(0, 0, canvas.width, canvas.height);
        cssW = w;
        cssH = h;
      }

      var b = readBackdrop(bg);   // 断点会改 background-position，这里重新读
      back.fx = b.fx;
      back.fy = b.fy;
      focus.fx = b.fx;
      focus.fy = b.fy;

      if (rebuild) buildDust();
    }

    function coverScale() {
      var ia = imgW / imgH;
      var ca = (cssW || 1) / (cssH || 1);
      return {
        x: Math.min(1, ca / ia),
        y: Math.min(1, ia / ca)
      };
    }

    /* ------------------------------------------------------------ 光尘粒子 */

    /** 把原图缩成小图取像素，用来挑「亮部」撒光点，避免落在暗处显得脏 */
    function readPixels() {
      var sw = 240;
      var sh = Math.max(1, Math.round(sw * imgH / imgW));
      var c = document.createElement('canvas');
      c.width = sw;
      c.height = sh;
      var ctx = c.getContext('2d');
      if (!ctx) return null;
      try {
        ctx.drawImage(img, 0, 0, sw, sh);
      } catch (e) {
        return null;
      }
      try {
        return { data: ctx.getImageData(0, 0, sw, sh).data, w: sw, h: sh };
      } catch (e) {
        return null;    // 某些浏览器在 file:// 下会拒绝，直接不用亮度采样
      }
    }

    function buildDust() {
      if (!imageReady) return;          // 图片还没解码完，等 onload 里再建
      var isSmall = window.innerWidth <= 720;
      var want = isSmall ? DUST_MOBILE : DUST_DESKTOP;
      var s = coverScale();
      var pixels = readPixels();

      var pos = [], seed = [], size = [], color = [];
      var guard = 0;
      var maxGuard = want * 80;

      while (pos.length / 2 < want && guard < maxGuard) {
        guard++;
        var px = Math.random();
        var py = Math.random();

        // 画布 uv → 图像 uv → 小图像素
        var iu = focus.fx * (1 - s.x) + px * s.x;
        var iv = focus.fy * (1 - s.y) + py * s.y;

        var lum = 0.6;
        var r = 255, g = 255, b = 255;
        if (pixels) {
          var ix = Math.min(pixels.w - 1, Math.max(0, Math.round(iu * (pixels.w - 1))));
          var iy = Math.min(pixels.h - 1, Math.max(0, Math.round(iv * (pixels.h - 1))));
          var o = (iy * pixels.w + ix) * 4;
          r = pixels.data[o];
          g = pixels.data[o + 1];
          b = pixels.data[o + 2];
          lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        }

        // 越亮越可能成点，画面下半部（水面/人物）稍微少一些
        var chance = lum * lum * (1.25 - py * 0.55);
        if (Math.random() > chance) continue;

        pos.push(px, py);
        seed.push(Math.random());

        var sc = Math.random();
        size.push(isSmall ? 2.6 + sc * 3.4 : 3.0 + sc * 4.2);

        // 取像素本色再提亮，光点颜色跟着画面走（青蓝 / 暖金），不会突兀
        var k = 1.35;
        color.push(
          Math.min(1, r / 255 * k + 0.16),
          Math.min(1, g / 255 * k + 0.16),
          Math.min(1, b / 255 * k + 0.16)
        );
      }

      dustCount = pos.length / 2;
      if (!dustCount) return;

      gl.bindBuffer(gl.ARRAY_BUFFER, dustBuf.pos);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, dustBuf.seed);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(seed), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, dustBuf.size);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(size), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, dustBuf.color);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(color), gl.STATIC_DRAW);
    }

    /* ------------------------------------------------------------ 渲染循环 */

    function draw(t) {
      time = t;
      // 呼吸：22 秒一轮。基准 1.045 对齐 .hero-bg 的 transform: scale(1.04)，
      // 否则取景范围会比静态版大一圈，切换瞬间会看到画面「跳一下」
      var zoom = 1.045 + 0.012 * Math.sin(t * 0.285) + 0.004 * Math.sin(t * 0.13);
      // 指针缓动，避免鼠标一动画面就跳
      pointer.x += (pointerTo.x - pointer.x) * 0.055;
      pointer.y += (pointerTo.y - pointer.y) * 0.055;

      gl.disable(gl.BLEND);
      gl.useProgram(quadProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      gl.enableVertexAttribArray(quadLoc.aPos);
      gl.vertexAttribPointer(quadLoc.aPos, 2, gl.FLOAT, false, 0, 0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(quadLoc.uTex, 0);
      gl.uniform2f(quadLoc.uCanvas, cssW, cssH);
      gl.uniform2f(quadLoc.uImage, imgW, imgH);
      gl.uniform2f(quadLoc.uFocus, focus.fx, focus.fy);
      gl.uniform2f(quadLoc.uPointer, pointer.x, pointer.y);
      gl.uniform1f(quadLoc.uTime, t);
      gl.uniform1f(quadLoc.uZoom, zoom);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      if (!dustCount) return;

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);   // 叠加，光点互相提亮
      gl.useProgram(dustProg);

      gl.bindBuffer(gl.ARRAY_BUFFER, dustBuf.pos);
      gl.enableVertexAttribArray(dustLoc.aPos);
      gl.vertexAttribPointer(dustLoc.aPos, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, dustBuf.seed);
      gl.enableVertexAttribArray(dustLoc.aSeed);
      gl.vertexAttribPointer(dustLoc.aSeed, 1, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, dustBuf.size);
      gl.enableVertexAttribArray(dustLoc.aSize);
      gl.vertexAttribPointer(dustLoc.aSize, 1, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, dustBuf.color);
      gl.enableVertexAttribArray(dustLoc.aColor);
      gl.vertexAttribPointer(dustLoc.aColor, 3, gl.FLOAT, false, 0, 0);

      gl.uniform1f(dustLoc.uTime, t);
      gl.uniform1f(dustLoc.uDpr, dpr);
      gl.uniform2f(dustLoc.uPointer, pointer.x, pointer.y);
      gl.drawArrays(gl.POINTS, 0, dustCount);
    }

    function loop(now) {
      raf = 0;
      if (disposed) return;
      if (!started) started = now;
      if (document.hidden || !visible) return;   // 移出视口 / 切后台就停画
      draw((now - started) / 1000);
      if (window.__heroFx) window.__heroFx.frames++;
      raf = window.requestAnimationFrame(loop);
    }

    function start() {
      if (disposed || raf) return;
      raf = window.requestAnimationFrame(loop);
    }

    function stop() {
      if (raf) {
        window.cancelAnimationFrame(raf);
        raf = 0;
      }
    }

    /* -------------------------------------------------------------- 事件 */

    var resizeTimer = 0;
    function onResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { resize(true); }, 180);
    }

    if (window.ResizeObserver) {
      new ResizeObserver(onResize).observe(hero);
    } else {
      window.addEventListener('resize', onResize);
    }
    // 断点改的是 background-position，只有窗口宽度变了才需要重读
    window.addEventListener('resize', onResize);

    hero.addEventListener('pointermove', function (e) {
      var r = hero.getBoundingClientRect();
      pointerTo.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      pointerTo.y = ((e.clientY - r.top) / r.height) * 2 - 1;
    }, { passive: true });

    hero.addEventListener('pointerleave', function () {
      pointerTo.x = 0;
      pointerTo.y = 0;
    }, { passive: true });

    if (window.IntersectionObserver) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        if (visible) start(); else stop();
      }, { threshold: 0 }).observe(hero);
    }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop(); else start();
    });

    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      disposed = true;
      stop();
      canvas.classList.remove('is-on');   // 退回 CSS 静态背景
    }, false);

    // 暴露给调试用：确认帧是否在跑（不影响正常渲染）
    window.__heroFx = {
      frames: 0,
      info: function () {
        return { w: cssW, h: cssH, dpr: dpr, dust: dustCount, img: [imgW, imgH] };
      }
    };
  }

  YY.heroFx = { init: init };
})(window.YY);
