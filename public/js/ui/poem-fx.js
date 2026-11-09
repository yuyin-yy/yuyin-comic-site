/* ==========================================================================
 * ui/poem-fx.js · 尾屏诗句的背景动态层（原生 WebGL，零依赖）
 * --------------------------------------------------------------------------
 * 底图是一张「风吹长发」的插画。这里只做两件事：
 *   1. 发随风动 —— 用 tools/make_poem_mask.py 抠出的头发遮罩做 UV 位移，
 *      发根（头部）几乎不动，越到发梢摆得越开，相位沿发丝走向推进；
 *      风力跟着滚动进度走：诗句越往后，风越大。
 *   2. 浮光粒子 —— 顺着风向往左飘的细长光点，明灭、错落，给静止的画面一点空气感。
 *
 * 为什么不用 three.js：整块只有一个全屏四边形 + 一团点精灵，
 * 引一个 600KB 的渲染器换不来任何东西（同 hero-fx.js 的取舍）。
 *
 * 退化策略（任一成立就完全不接管，页面保留 CSS 的 .poem-bg 静态图）：
 *   没有 canvas / 系统开启「减少动态效果」/ 带 ?fx=0 / 不支持 WebGL / 着色器编译失败。
 *
 * 依赖：无
 * 暴露：YY.poemFx.setProgress(p)   —— 由 ui/poem.js 每帧喂进来的滚动进度 0~1
 *       window.__poemFx.info()     —— 控制台诊断
 * ========================================================================== */
(function (YY) {
  'use strict';

  var MAX_DPR = 1.5;          // 高 DPI 屏按 1.5 倍渲染，省一半像素
  var DUST_DESKTOP = 110;     // 桌面光点数量
  var DUST_MOBILE = 54;

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
    'uniform sampler2D uMask;',  // 头发遮罩（灰度），r 通道
    'uniform vec2 uCanvas;',     // 画布 CSS 尺寸
    'uniform vec2 uImage;',      // 原图像素尺寸
    'uniform vec2 uFocus;',      // 取景焦点，对应 CSS 的 background-position
    'uniform vec2 uPointer;',    // -1..1
    'uniform float uTime;',
    'uniform float uZoom;',      // 呼吸缩放，>1 为放大
    'uniform float uHair;',      // 0/1：遮罩就绪才开风场
    'uniform float uWind;',      // 风力，跟滚动进度联动

    'void main() {',
    '  // p: 0..1，原点左上，和 CSS 的 background-position 同一套坐标',
    '  vec2 p = vec2(vUv.x, 1.0 - vUv.y);',

    '  // 复刻 background-size: cover 的裁切比例',
    '  float ia = uImage.x / uImage.y;',
    '  float ca = uCanvas.x / uCanvas.y;',
    '  vec2 s = vec2(min(1.0, ca / ia), min(1.0, ia / ca)) / uZoom;',

    '  vec2 f = clamp(uFocus + uPointer * 0.020, 0.0, 1.0);',
    '  vec2 imgUV = f * (1.0 - s) + p * s;',

    '  float t = uTime;',

    '  // 极缓的空气流动，幅度只有几个像素，静止细看才察觉',
    '  vec2 uv = imgUV;',
    '  uv.x += sin(uv.y * 8.0 + t * 0.42) * 0.0011',
    '        + sin(uv.y * 3.1 - t * 0.23) * 0.0014;',
    '  uv.y += cos(uv.x * 4.6 + t * 0.31) * 0.0008;',

    '  // 头发风场：只在遮罩内生效。发根在头部（画面右侧 x≈0.70），',
    '  // 发梢一路甩到左下方的 x≈0.22，所以位移强度随 x 减小而增大。',
    '  float hm = texture2D(uMask, vec2(imgUV.x, 1.0 - imgUV.y)).r * uHair;',
    '  if (hm > 0.004) {',
    '    float tip = smoothstep(0.02, 0.44, 0.72 - imgUV.x);',
    '    float gust = 0.78 + 0.26 * sin(t * 0.17) + 0.10 * sin(t * 0.61 + 1.3);',
    '    float amp = hm * tip * gust * uWind;',
    '    // 相位从发根往发梢推进（x 越小越靠后），看起来是风把头发往左吹过去',
    '    float phase = (0.72 - imgUV.x) * 13.0 + imgUV.y * 3.4 - t * 1.30;',
    '    float w1 = sin(phase) * 0.0122;',
    '    float w2 = sin(phase * 0.43 + 1.9) * 0.0072;',
    '    float w3 = sin(phase * 1.9 - t * 0.7) * 0.0026;',   // 高频小抖，像发丝末端被风撩
    '    uv.x -= (w1 + w2 + w3 * tip) * amp;',          // 风向朝左
    '    uv.y += cos(phase * 0.88 + 0.7) * 0.0032 * amp;',
    '  }',

    '  vec3 col = texture2D(uTex, vec2(uv.x, 1.0 - uv.y)).rgb;',
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
    'uniform float uWind;',
    'uniform vec2 uPointer;',
    'varying float vAlpha;',
    'varying vec3 vColor;',
    'void main() {',
    '  float t = uTime;',
    '  float seed = aSeed;',
    '  // 顺着风向往左飘：越大的种子飘得越快，飘出左边界从右边补回来',
    '  float speed = (0.007 + seed * 0.020) * (0.55 + 0.75 * uWind);',
    '  float x = mod(aPos.x - t * speed + 0.08, 1.16) - 0.08;',
    '  float y = aPos.y',
    '          + sin(t * (0.30 + seed * 0.45) + seed * 27.0) * (0.006 + seed * 0.010)',
    '          + uPointer.y * 0.012 * (0.3 + seed);',
    '  x += uPointer.x * 0.016 * (0.3 + seed);',
    '  vec2 clip = vec2(x * 2.0 - 1.0, 1.0 - y * 2.0);',
    '  gl_Position = vec4(clip, 0.0, 1.0);',
    '  float tw = 0.50 + 0.50 * sin(t * (0.6 + seed * 1.9) + seed * 31.0);',
    '  // 大的当成虚焦光斑，小的才是亮火星：尺寸越大越淡，才不会糊成一片白点',
    '  vAlpha = tw * (0.34 + 0.46 * seed) * (7.0 / (aSize + 3.5));',
    '  // 左右边缘淡出，避免看到粒子凭空冒出来',
    '  vAlpha *= smoothstep(0.0, 0.09, x) * (1.0 - smoothstep(0.92, 1.0, x));',
    '  gl_PointSize = aSize * uDpr * (0.75 + 0.5 * tw);',
    '  vColor = aColor;',
    '}'
  ].join('\n');

  var FS_DUST = [
    'precision mediump float;',
    'varying float vAlpha;',
    'varying vec3 vColor;',
    'void main() {',
    '  // 横向拉长成一小道光，比圆点更像被风带起来的光尘',
    '  vec2 q = gl_PointCoord - 0.5;',
    '  q.x *= 0.42;',
    '  float a = smoothstep(0.5, 0.02, length(q));',
    '  gl_FragColor = vec4(vColor, a * vAlpha);',
    '}'
  ].join('\n');

  /* ---------------------------------------------------------------- 工具 */

  /** 编译单个着色器；失败返回 null（调用方据此放弃整个动态层） */
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

  /** 链接顶点/片元着色器为程序；失败返回 null。着色器对象链接后即可释放 */
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
    var pos = (cs.backgroundPosition || '50% 44%').split(/\s+/);
    var fx = parseFloat(pos[0]);
    var fy = parseFloat(pos[1] == null ? pos[0] : pos[1]);
    return {
      url: m ? m[1] : '',
      fx: isNaN(fx) ? 0.5 : fx / 100,
      fy: isNaN(fy) ? 0.44 : fy / 100
    };
  }

  /** 由底图地址推出同源的遮罩地址：poem-bg-1280 → poem-hair，poem-bg-m → poem-hair-m */
  function maskSrc(url) {
    if (/poem-bg-m\./.test(url)) return url.replace(/poem-bg-m\./, 'poem-hair-m.');
    return url.replace(/poem-bg(-[\w]+)?\./, 'poem-hair.');
  }

  /* ------------------------------------------------------------------ 进度 */

  /** 当前滚动进度 0~1，只用来调风力，不参与任何布局 */
  var progress = 0;

  /** 由 ui/poem.js 每帧调用；还没接管画布时它也是安全的空转 */
  function setProgress(p) {
    progress = p > 1 ? 1 : (p < 0 ? 0 : p);
  }

  /* ------------------------------------------------------------------ 主体 */

  function init() {
    var section = document.getElementById('poem');
    var bg = section && section.querySelector('.poem-bg');
    var canvas = document.getElementById('poemFx');
    if (!section || !bg || !canvas) return;

    // ?fx=0 关掉动态层，方便和静态版对比
    if (/(?:^|[?&])fx=0(?:&|$)/.test(location.search)) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'low-power' });
    var isGL2 = !!gl;                     // WebGL2 才允许非 2 的幂贴图开 mipmap
    if (!gl) gl = canvas.getContext('webgl', { antialias: false, alpha: false });
    if (!gl) return;

    var quadProg = makeProgram(gl, VS_QUAD, FS_QUAD);
    var dustProg = makeProgram(gl, VS_DUST, FS_DUST);
    if (!quadProg || !dustProg) return;

    var quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1
    ]), gl.STATIC_DRAW);

    var quadLoc = {
      aPos: gl.getAttribLocation(quadProg, 'aPos'),
      uTex: gl.getUniformLocation(quadProg, 'uTex'),
      uMask: gl.getUniformLocation(quadProg, 'uMask'),
      uHair: gl.getUniformLocation(quadProg, 'uHair'),
      uWind: gl.getUniformLocation(quadProg, 'uWind'),
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
      uWind: gl.getUniformLocation(dustProg, 'uWind'),
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
    var maskTex = gl.createTexture();
    var imageReady = false;
    var maskReady = false;
    var imgW = 1;
    var imgH = 1;

    var cssW = 0, cssH = 0, dpr = 1;
    var focus = { fx: 0.5, fy: 0.44 };
    var pointer = { x: 0, y: 0 };      // 当前值（缓动）
    var pointerTo = { x: 0, y: 0 };    // 目标值
    var started = 0;
    var frameCount = 0;
    var raf = 0;
    var visible = false;
    var disposed = false;
    var loadedUrl = '';
    var loadToken = 0;

    /* ---------------------------------------------------------- 资源加载 */

    /** 读取并上传底图；地址变了（跨断点）才重新读 */
    function loadImage(url) {
      if (!url || url === loadedUrl) return;
      loadedUrl = url;
      var token = ++loadToken;
      imageReady = false;
      maskReady = false;

      var img = new Image();
      img.decoding = 'async';
      img.onload = function () {
        if (disposed || token !== loadToken) return;
        imgW = img.naturalWidth || 1920;
        imgH = img.naturalHeight || 1120;
        // 底图会缩到屏幕尺寸以下，走 mipmap 才能避免运动时出现摩尔纹
        uploadTexture(texture, img, isGL2);
        imageReady = true;
        resize(true);
        start();
        canvas.classList.add('is-on');
        loadMask(token);
      };
      img.onerror = function () { /* 保持 CSS 静态背景 */ };
      img.src = url;
    }

    /** 头发遮罩：灰度图，只用来调制位移幅度；缺图就退化成「只有呼吸和光点」 */
    function loadMask(token) {
      var m = new Image();
      m.decoding = 'async';
      m.onload = function () {
        if (disposed || token !== loadToken) return;
        uploadTexture(maskTex, m, false);   // 遮罩不做缩放显示，不需要 mipmap
        maskReady = true;
        start();
      };
      m.onerror = function () { /* 拿不到遮罩就只跑呼吸与光点 */ };
      m.src = maskSrc(loadedUrl);
    }

    /** 上传一张图片为贴图；mipmap 仅在 WebGL2 下可用（它允许非 2 的幂） */
    function uploadTexture(tex, source, mipmap) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);   // 让 v=0 对应图片顶部
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      if (mipmap) {
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      }
    }

    /* -------------------------------------------------------------- 布局 */

    function resize(rebuild) {
      var pin = section.querySelector('.poem-pin');
      var rect = pin.getBoundingClientRect();
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

      // 断点会换底图（手机换竖裁版），地址变了就整套重载
      var b = readBackdrop(bg);
      focus.fx = b.fx;
      focus.fy = b.fy;
      if (imageReady && b.url !== loadedUrl) loadImage(b.url);

      if (rebuild) buildDust();
    }

    /** cover 裁切后，画布只显示原图的这一比例（另一维为 1，表示铺满） */
    function coverScale() {
      var ia = imgW / imgH;
      var ca = (cssW || 1) / (cssH || 1);
      return { x: Math.min(1, ca / ia), y: Math.min(1, ia / ca) };
    }

    /* ------------------------------------------------------------ 浮光粒子 */

    function buildDust() {
      if (!imageReady) return;
      var isSmall = window.innerWidth <= 720;
      var want = isSmall ? DUST_MOBILE : DUST_DESKTOP;
      var pos = [], seed = [], size = [], color = [];

      for (var i = 0; i < want; i++) {
        // x 偏向左侧：天空都在左边，人物那一带少撒，别糊在人身上
        var px = Math.pow(Math.random(), 1.45) * 0.92 + 0.02;
        var py = 0.06 + Math.random() * 0.86;
        pos.push(px, py);
        seed.push(Math.random());
        var sc = Math.random();
        // 三成是虚焦的大光斑，其余是细小的亮尘，层次比均匀撒点自然
        var big = Math.random() < 0.32;
        size.push(big
          ? (isSmall ? 7.0 + sc * 7.0 : 8.0 + sc * 9.0)
          : (isSmall ? 2.2 + sc * 2.0 : 2.6 + sc * 2.4));
        // 冷白偏青，和天空同一色系；少量偏暖，像被夕阳照到的浮尘
        var warm = Math.random() < 0.18;
        color.push(1.0, warm ? 0.95 : 0.99, warm ? 0.86 : 1.0);
      }

      dustCount = pos.length / 2;
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
      // 呼吸很轻：这块是长时间停留的阅读画面，幅度大了会晕
      var zoom = 1.02 + 0.008 * Math.sin(t * 0.23);
      pointer.x += (pointerTo.x - pointer.x) * 0.05;
      pointer.y += (pointerTo.y - pointer.y) * 0.05;

      gl.disable(gl.BLEND);
      gl.useProgram(quadProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      gl.enableVertexAttribArray(quadLoc.aPos);
      gl.vertexAttribPointer(quadLoc.aPos, 2, gl.FLOAT, false, 0, 0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, maskTex);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(quadLoc.uTex, 0);
      gl.uniform1i(quadLoc.uMask, 1);
      gl.uniform1f(quadLoc.uHair, maskReady ? 1 : 0);
      gl.uniform1f(quadLoc.uWind, 0.72 + 0.5 * progress);
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
      gl.uniform1f(dustLoc.uWind, 0.72 + 0.5 * progress);
      gl.uniform2f(dustLoc.uPointer, pointer.x, pointer.y);
      gl.drawArrays(gl.POINTS, 0, dustCount);
    }

    function loop(now) {
      raf = 0;
      if (disposed) return;
      if (!started) started = now;
      if (document.hidden || !visible) return;   // 移出视口 / 切后台就停画
      draw((now - started) / 1000);
      frameCount++;
      raf = window.requestAnimationFrame(loop);
    }

    function start() {
      if (disposed || raf || !imageReady) return;
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
      new ResizeObserver(onResize).observe(section.querySelector('.poem-pin'));
    } else {
      window.addEventListener('resize', onResize);
    }
    window.addEventListener('resize', onResize);

    section.addEventListener('pointermove', function (e) {
      var r = section.getBoundingClientRect();
      pointerTo.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      pointerTo.y = ((e.clientY - r.top) / r.height) * 2 - 1;
    }, { passive: true });

    section.addEventListener('pointerleave', function () {
      pointerTo.x = 0;
      pointerTo.y = 0;
    }, { passive: true });

    if (window.IntersectionObserver) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        if (visible) start(); else stop();
      }, { rootMargin: '200px 0px' }).observe(section);
    } else {
      visible = true;
    }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop(); else start();
    });

    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      disposed = true;
      stop();
      canvas.classList.remove('is-on');   // 退回静态底图
    }, false);

    var bg0 = readBackdrop(bg);
    focus.fx = bg0.fx;
    focus.fy = bg0.fy;
    resize(false);
    loadImage(bg0.url);

    // 诊断钩子：控制台可用 __poemFx.info() 看尺寸、光点数、遮罩是否就绪
    window.__poemFx = {
      info: function () {
        return {
          w: cssW, h: cssH, dpr: dpr, frames: frameCount,
          dust: dustCount, img: [imgW, imgH], hair: maskReady,
          wind: +(0.72 + 0.5 * progress).toFixed(2)
        };
      }
    };
  }

  // 没有 #poem 的页面调用 init 会立刻返回，setProgress 也只是写一个变量
  YY.poemFx = { init: init, setProgress: setProgress };
})(window.YY);
