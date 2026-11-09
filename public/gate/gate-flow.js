/* ==========================================================================
   gate-flow.js · 罗生门的「活背景」
   --------------------------------------------------------------------------
   底图是一张静止插画。粒子能撑起空气感，但云和水面本身不动，看久了还是
   一张贴纸。这一层用 WebGL 把同一张底图重新画一遍，只在两个区域做位移：

     · 云层 —— 画面顶部。横向走一道慢波，云像被风梳过去；
     · 水面 —— 建筑下沿以下。横向的高频波纹，越近越明显。

   位移只给「云」和「水」，建筑与门不动：这两块的边缘是硬线，一扭就会
   露馅（窗框、屋檐、门框都会跟着抖）。所以用两条竖向的遮罩平滑过渡，
   幅度也压在几个像素以内 —— 要的是「在呼吸」，不是「在扭动」。

   和 gate-fx.js 的分工：这一层是背景，画在 .gate-art 之上、门之下；
   光尘层仍然独立画在最上面。两层都不碰 DOM 布局。

   退化策略（任一成立就完全不接管，页面保留 CSS 的静态底图）：
     没有 canvas / 系统开启「减少动态效果」/ 带 ?fx=0 / 不支持 WebGL /
     着色器编译失败 / 图片加载失败。

   依赖：无（读取 .gate-art 计算样式里的背景图地址）
   暴露：window.__gateFlow.info()   —— 控制台诊断
   ========================================================================== */
(function () {
  'use strict';

  var MAX_DPR = 1.5;          // 背景是柔的，1.5 倍足够，省一半像素

  var VS = [
    'attribute vec2 aPos;',
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = aPos * 0.5 + 0.5;',
    '  gl_Position = vec4(aPos, 0.0, 1.0);',
    '}'
  ].join('\n');

  var FS = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D uTex;',
    'uniform vec2 uCanvas;',     // 画布 CSS 尺寸
    'uniform vec2 uImage;',      // 原图像素尺寸
    'uniform float uTime;',
    '',
    'void main() {',
    '  // p: 0..1，原点左上，和 CSS 的 background-position 同一套坐标',
    '  vec2 p = vec2(vUv.x, 1.0 - vUv.y);',
    '',
    '  // 复刻 background-size: cover 的裁切比例',
    '  float ia = uImage.x / uImage.y;',
    '  float ca = uCanvas.x / uCanvas.y;',
    '  vec2 s = vec2(min(1.0, ca / ia), min(1.0, ia / ca));',
    '  vec2 uv = 0.5 * (1.0 - s) + p * s;',
    '',
    '  float t = uTime;',
    '  float x = uv.x;',
    '  float y = uv.y;',
    '',
    '  // ---- 云层：顶部 0 ~ 0.34，往下收住，避免把建筑边缘带弯 ----',
    '  float sky = 1.0 - smoothstep(0.08, 0.34, y);',
    '',
    '  // 只让「亮的东西」动：木头架子、铁架是暗的，一扭就像果冻；',
    '  // 取原图这一点的亮度当遮罩，云（亮）走、结构（暗）钉住。',
    '  vec3 base = texture2D(uTex, clamp(vec2(uv.x, 1.0 - uv.y), 0.0, 1.0)).rgb;',
    '  float lum = dot(base, vec3(0.299, 0.587, 0.114));',
    '  sky *= smoothstep(0.30, 0.52, lum);',
    '',
    '  if (sky > 0.002) {',
    '    // 相位沿 y 推进：同一高度的云一起走，不同高度错开，',
    '    // 看起来就是一层一层被风吹过去，而不是整块平移',
    '    float ph = y * 17.0 + x * 2.6 - t * 0.5;',
    '    uv.x += (sin(ph) * 0.0026 + sin(ph * 0.43 + 1.7) * 0.0042) * sky;',
    '    uv.y += (cos(x * 8.0 + y * 6.0 - t * 0.35) * 0.0026',
    '           + sin(x * 3.0 - t * 0.20) * 0.0016) * sky;',
    '  }',
    '',
    '  // ---- 水面：建筑下沿（0.61）以下，越近越晃 ----',
    '  float wat = smoothstep(0.61, 0.73, y);',
    '  if (wat > 0.002) {',
    '    // 高频 + 低频叠一起：高频是细碎水纹，低频让整片水一起晃',
    '    float ph2 = y * 52.0 - t * 1.25 + sin(x * 3.4) * 1.4;',
    '    uv.x += (sin(ph2) * 0.0048 + sin(ph2 * 0.37 + 2.1) * 0.0026) * wat;',
    '    uv.y += sin(x * 16.0 + y * 40.0 - t * 1.05) * 0.0018 * wat;',
    '  }',
    '',
    '  vec2 fuv = clamp(vec2(uv.x, 1.0 - uv.y), 0.0, 1.0);',
    '  vec3 col = texture2D(uTex, fuv).rgb;',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

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

  /** 从 .gate-art 的计算样式里取当前断点用的那张底图 */
  function readArt() {
    var art = document.querySelector('.gate-art');
    if (!art) return '';
    var bg = window.getComputedStyle(art).backgroundImage || '';
    var m = /url\(["']?(.*?)["']?\)/.exec(bg);
    return m ? m[1] : '';
  }

  function init() {
    var root = document.getElementById('gate');
    var canvas = document.getElementById('gateFlow');
    if (!root || !canvas) return;

    if (/(?:^|[?&])fx=0(?:&|$)/.test(location.search)) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'low-power' });
    var isGL2 = !!gl;
    if (!gl) gl = canvas.getContext('webgl', { antialias: false, alpha: false });
    if (!gl) return;

    var prog = makeProgram(gl, VS, FS);
    if (!prog) return;

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1
    ]), gl.STATIC_DRAW);

    var loc = {
      aPos: gl.getAttribLocation(prog, 'aPos'),
      uTex: gl.getUniformLocation(prog, 'uTex'),
      uCanvas: gl.getUniformLocation(prog, 'uCanvas'),
      uImage: gl.getUniformLocation(prog, 'uImage'),
      uTime: gl.getUniformLocation(prog, 'uTime')
    };

    var tex = gl.createTexture();
    var imgW = 1, imgH = 1;
    var cssW = 0, cssH = 0, dpr = 1;
    var loadedUrl = '';
    var token = 0;
    var imageReady = false;
    var started = 0;
    var raf = 0;
    var visible = true;
    var stopped = false;

    function upload(img) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);   // 让 v=0 对应图片顶部
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      if (isGL2) {
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      }
    }

    function load(url) {
      if (!url || url === loadedUrl) return;
      loadedUrl = url;
      var my = ++token;
      imageReady = false;
      var img = new Image();
      img.decoding = 'async';
      img.onload = function () {
        if (my !== token) return;
        imgW = img.naturalWidth || 1440;
        imgH = img.naturalHeight || 900;
        upload(img);
        imageReady = true;
        resize();
        // 和底图一起淡入：底图 .is-ready 之后 0.5s，这里晚 0.1s 盖上去
        canvas.classList.add('is-on');
        start();
      };
      img.onerror = function () { /* 保持 CSS 静态底图 */ };
      img.src = url;
    }

    function resize() {
      var w = Math.max(1, Math.round(root.clientWidth || window.innerWidth));
      var h = Math.max(1, Math.round(root.clientHeight || window.innerHeight));
      dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);

      if (w !== cssW || h !== cssH) {
        cssW = w;
        cssH = h;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        gl.viewport(0, 0, canvas.width, canvas.height);
      }

      // 断点会换底图（手机换 800 那张），地址变了就整套重载
      var url = readArt();
      if (url && url !== loadedUrl) load(url);
    }

    function draw(t) {
      gl.disable(gl.BLEND);
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(loc.aPos);
      gl.vertexAttribPointer(loc.aPos, 2, gl.FLOAT, false, 0, 0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(loc.uTex, 0);
      gl.uniform2f(loc.uCanvas, cssW, cssH);
      gl.uniform2f(loc.uImage, imgW, imgH);
      gl.uniform1f(loc.uTime, t);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    function loop(now) {
      raf = 0;
      if (stopped) return;
      if (!started) started = now;
      if (document.hidden || !visible) return;
      draw((now - started) / 1000);
      raf = window.requestAnimationFrame(loop);
    }

    function start() {
      if (stopped || raf || !imageReady) return;
      raf = window.requestAnimationFrame(loop);
    }

    function stop() {
      if (raf) {
        window.cancelAnimationFrame(raf);
        raf = 0;
      }
    }

    var resizeTimer = 0;
    function onResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 120);
    }
    if (window.ResizeObserver) new ResizeObserver(onResize).observe(root);
    else window.addEventListener('resize', onResize);
    window.addEventListener('resize', onResize);

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop(); else start();
    });

    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      stopped = true;
      stop();
      canvas.classList.remove('is-on');   // 退回静态底图
    }, false);

    resize();
    load(readArt());

    window.__gateFlow = {
      info: function () {
        return {
          w: cssW, h: cssH, dpr: dpr, img: [imgW, imgH],
          ready: imageReady, url: loadedUrl
        };
      }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
