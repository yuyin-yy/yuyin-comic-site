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
    'uniform sampler2D uMask;',  // 头发遮罩（灰度），r 通道
    'uniform vec2 uCanvas;',   // 画布 CSS 尺寸
    'uniform vec2 uImage;',    // 原图像素尺寸
    'uniform vec2 uFocus;',    // 取景焦点，对应 CSS 的 background-position
    'uniform vec2 uPointer;',  // -1..1
    'uniform float uTime;',
    'uniform float uZoom;',    // 呼吸缩放，>1 为放大
    'uniform float uHair;',    // 0/1：遮罩就绪才开风场

    'void main() {',
    '  // p: 0..1，原点左上，和 CSS 的 background-position 同一套坐标',
    '  vec2 p = vec2(vUv.x, 1.0 - vUv.y);',

    '  // 复刻 background-size: cover 的裁切比例',
    '  float ia = uImage.x / uImage.y;',
    '  float ca = uCanvas.x / uCanvas.y;',
    '  vec2 s = vec2(min(1.0, ca / ia), min(1.0, ia / ca)) / uZoom;',

    '  vec2 f = clamp(uFocus + uPointer * 0.026, 0.0, 1.0);',
    '  vec2 imgUV = f * (1.0 - s) + p * s;',

    '  float t = uTime;',

    '  // 极缓流动：幅度约 3~5 图像像素，只在静止细看时能察觉',
    '  vec2 uv = imgUV;',
    '  uv.x += sin(uv.y * 9.0 + t * 0.50) * 0.0013',
    '        + sin(uv.y * 3.3 - t * 0.27) * 0.0017;',
    '  uv.y += cos(uv.x * 5.0 + t * 0.36) * 0.0009;',

    '  // 头发风场：只在遮罩内生效；发根（靠近头部）几乎不动，发梢摆幅最大',
    '  float hm = texture2D(uMask, vec2(imgUV.x, 1.0 - imgUV.y)).r * uHair;',
    '  if (hm > 0.004) {',
    '    float root = smoothstep(0.66, 1.0, imgUV.x);',
    '    float gust = 0.75 + 0.35 * sin(t * 0.21);',           // 阵风：强弱有起伏
    '    float amp = hm * (0.18 + 0.82 * root) * gust;',
    '    // 相位沿发丝走向（由左上到右下）推进，看起来是「风从发根刮向发梢」',
    '    float phase = (imgUV.x * 0.90 + imgUV.y * 0.75) * 7.0 - t * 1.25;',
    '    float w1 = sin(phase) * 0.0072;',
    '    float w2 = sin(phase * 0.45 + 1.7) * 0.0046;',
    '    uv.x += (w1 + w2) * amp;',
    '    uv.y += cos(phase * 0.9 + 0.6) * 0.0022 * amp;',
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

  /**
   * 初始化动态层。以下任一条件成立时直接返回、不接管画布，
   * 页面保留 CSS 的 .hero-bg 静态背景：
   *   没有 .hero / .hero-bg / #heroFx、系统开启「减少动态效果」、
   *   带 ?fx=0、浏览器不支持 WebGL、着色器编译失败。
   */
  function init() {
    var hero = document.querySelector('.hero');
    var bg = document.querySelector('.hero-bg');
    if (!hero || !bg) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // ?fx=0 关掉动态层，方便和静态版对比
    if (/(?:^|[?&])fx=0(?:&|$)/.test(location.search)) return;

    var canvas = document.getElementById('heroFx');
    if (!canvas) return;

    var gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'low-power' });
    var isGL2 = !!gl;                    // WebGL2 才允许非 2 的幂贴图开 mipmap
    if (!gl) {
      gl = canvas.getContext('webgl', { antialias: false, alpha: false });
    }
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
      uMask: gl.getUniformLocation(quadProg, 'uMask'),
      uHair: gl.getUniformLocation(quadProg, 'uHair'),
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
    var maskTex = gl.createTexture();      // 头发遮罩，与底图同一套 UV
    var imageReady = false;
    var maskReady = false;
    var imgW = 1;
    var imgH = 1;

    var cssW = 0, cssH = 0, dpr = 1;
    var focus = { fx: 0.5, fy: 0.28 };
    var pointer = { x: 0, y: 0 };      // 当前值（缓动）
    var pointerTo = { x: 0, y: 0 };    // 目标值
    var started = 0;
    var frameCount = 0;                // 仅用于诊断（info().frames）
    var raf = 0;
    var visible = true;
    var disposed = false;

    /* ---------------------------------------------------------- 资源加载 */

    var bgSrc = readBackdrop(bg);   // 启动时读一次：图片地址 + 初始焦点
    focus.fx = bgSrc.fx;
    focus.fy = bgSrc.fy;

    var img = new Image();
    img.decoding = 'async';
    img.onload = function () {
      if (disposed) return;
      imgW = img.naturalWidth || 1920;
      imgH = img.naturalHeight || 800;

      // 底图会从 3000px 缩到屏幕宽度，走 mipmap 才能避免运动时出现摩尔纹
      uploadTexture(texture, img, isGL2);

      imageReady = true;
      resize(true);
      start();
      canvas.classList.add('is-on');
      loadMask();
    };
    img.onerror = function () { /* 保持 CSS 静态背景 */ };
    img.src = bgSrc.url;

    /** 头发遮罩：与底图同名的灰度图（xxx.webp → xxx-hair.webp），缺图则不平移。
     *  底图按屏宽分档后叫 lliij-2-1400.webp，遮罩只有一份（lliij-2-hair.webp）：
     *  遮罩按归一化 UV 采样，分辨率和底图不必一致，先剥掉 -1400 这类宽度后缀再拼。 */
    function loadMask() {
      var src = bgSrc.url
        .replace(/-\d+(\.(webp|jpe?g|png))$/i, '$1')
        .replace(/\.(webp|jpe?g|png)$/i, '-hair.webp');
      if (src === bgSrc.url) return;
      var m = new Image();
      m.decoding = 'async';
      m.onload = function () {
        if (disposed) return;
        // 遮罩不参与缩小显示，不需要 mipmap
        uploadTexture(maskTex, m, false);
        maskReady = true;
      };
      m.onerror = function () { /* 拿不到遮罩就退化为「只有呼吸和光点」 */ };
      m.src = src;
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

    /**
     * 同步画布像素尺寸与取景焦点。
     * rebuild=true 时重建光点：列数/尺寸变了，光点密度要跟着重算。
     */
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

      // 断点会改 background-position（手机端 76% / 14%），每次尺寸变化都重读
      var b = readBackdrop(bg);
      focus.fx = b.fx;
      focus.fy = b.fy;

      if (rebuild) buildDust();
    }

    /** cover 裁切后，画布只显示原图的这一比例（另一维为 1，表示铺满） */
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

    /**
     * 生成光点。位置是随机的，但落在亮部的概率更高（lum² 加权），
     * 这样光点分布与画面里本身的星光/高光一致，不会在暗处显脏。
     * 颜色直接取该点像素并整体提亮，保证与画面同一色系。
     */
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

    /** 渲染一帧：底图（含呼吸、头发挥动）→ 叠加光点 */
    function draw(t) {
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
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, maskTex);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(quadLoc.uTex, 0);
      gl.uniform1i(quadLoc.uMask, 1);
      gl.uniform1f(quadLoc.uHair, maskReady ? 1 : 0);
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
      frameCount++;
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

    // 诊断钩子：控制台可用 __heroFx.info() 查看尺寸、光点数、遮罩是否就绪
    window.__heroFx = {
      info: function () {
        return {
          w: cssW, h: cssH, dpr: dpr, frames: frameCount,
          dust: dustCount, img: [imgW, imgH], hair: maskReady
        };
      }
    };
  }

  YY.heroFx = { init: init };
})(window.YY);
