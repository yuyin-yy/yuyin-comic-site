# -*- coding: utf-8 -*-
"""从尾屏插画里抠出「头发」区域，生成动态层用的灰度遮罩。

思路：
  1. 手画一个粗略的头发多边形（头发占画面中间一大片，边界靠肉眼给就够）；
  2. 交给 grabCut 在颜色上再收敛一次，把多边形里的天空挖掉、把发丝捞回来；
  3. 连通域过滤掉零星噪声，最后大半径高斯模糊做羽化——
     遮罩只用来调制位移幅度，边缘必须软，硬边会在画面上留下折痕。

输出：
  public/imgs/poem/poem-hair.webp      与桌面底图同一套归一化坐标
  public/imgs/poem/poem-hair-m.webp    手机竖裁版（同一块区域裁出来的）
  .tmp/mask-check.png                  调试用：红色叠加 + 裁剪框

用法：python tools/make_poem_mask.py
"""
import os

import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'poem-bg.jpg')
OUT_DIR = os.path.join(ROOT, 'public', 'imgs', 'poem')

# 手机端裁切范围（像素）：左边一块，避开人物
MOBILE_CROP = (0, 0, 520, 1120)

# 头发外轮廓（归一化坐标 x, y）
HAIR_POLY = [
    (0.694, 0.075), (0.735, 0.100), (0.752, 0.165), (0.768, 0.245),
    (0.776, 0.330), (0.768, 0.410), (0.735, 0.455), (0.706, 0.500),
    (0.672, 0.545), (0.628, 0.575), (0.578, 0.592), (0.520, 0.588),
    (0.462, 0.570), (0.404, 0.553), (0.348, 0.545), (0.298, 0.552),
    (0.252, 0.572), (0.214, 0.548), (0.230, 0.500), (0.264, 0.456),
    (0.305, 0.424), (0.356, 0.398), (0.412, 0.374), (0.468, 0.348),
    (0.524, 0.318), (0.578, 0.288), (0.630, 0.250), (0.664, 0.200),
    (0.678, 0.135),
]

# 连通域种子：必须落在头发上，用来丢掉被误判的孤岛
SEEDS = [(0.700, 0.110), (0.660, 0.300), (0.560, 0.430),
         (0.430, 0.470), (0.320, 0.500), (0.600, 0.240)]

# 人物身体（脖子以下到脚）：要从遮罩里挖掉，否则裙摆和腿会跟着头发一起晃
BODY_POLY = [
    (0.688, 0.255), (0.716, 0.268), (0.748, 0.300), (0.768, 0.355),
    (0.782, 0.430), (0.790, 0.500), (0.800, 0.580), (0.812, 0.700),
    (0.815, 0.880), (0.770, 0.890), (0.752, 0.760), (0.735, 0.640),
    (0.712, 0.560), (0.680, 0.560), (0.664, 0.620), (0.650, 0.700),
    (0.638, 0.790), (0.628, 0.880), (0.600, 0.880), (0.612, 0.740),
    (0.626, 0.600), (0.640, 0.500), (0.648, 0.420), (0.656, 0.340),
]


def poly_mask(w, h, pts):
    m = np.zeros((h, w), np.uint8)
    arr = np.array([[int(x * w), int(y * h)] for x, y in pts], np.int32)
    cv2.fillPoly(m, [arr], 1)
    return m


def main():
    # cv2.imread 在中文路径下会失败，改用 fromfile + imdecode
    bgr = cv2.imdecode(np.fromfile(SRC, dtype=np.uint8), cv2.IMREAD_COLOR)
    h, w = bgr.shape[:2]

    # 统一按宽 960 处理，速度与精度折中
    s = 960.0 / w
    small = cv2.resize(bgr, (960, int(round(h * s))), interpolation=cv2.INTER_AREA)
    sh, sw = small.shape[:2]

    rough = poly_mask(sw, sh, HAIR_POLY)
    gc = np.full((sh, sw), cv2.GC_BGD, np.uint8)
    gc[rough > 0] = cv2.GC_PR_FGD
    # 头顶与几个发团给「确定前景」，grabCut 才有颜色参考
    for fx, fy in SEEDS:
        cv2.circle(gc, (int(fx * sw), int(fy * sh)), int(0.020 * sw), cv2.GC_FGD, -1)
    # 远离头发的地方给「确定背景」
    gc[: int(0.045 * sh), :] = cv2.GC_BGD
    gc[:, : int(0.10 * sw)] = cv2.GC_BGD
    gc[:, int(0.84 * sw):] = cv2.GC_BGD
    gc[int(0.72 * sh):, :] = cv2.GC_BGD

    bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    cv2.grabCut(small, gc, None, bgd, fgd, 4, cv2.GC_INIT_WITH_MASK)
    mask = np.where((gc == cv2.GC_FGD) | (gc == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)

    # 只保留被种子命中的连通块，去掉零散斑点
    n, lab, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    keep = set()
    for fx, fy in SEEDS:
        idx = lab[int(fy * sh), int(fx * sw)]
        if idx:
            keep.add(idx)
    mask = np.isin(lab, list(keep)).astype(np.uint8) * 255

    # 挖掉身体：裙摆、腿、手臂不该跟着风一起摆
    body = poly_mask(sw, sh, BODY_POLY)
    body = cv2.GaussianBlur(body.astype(np.uint8) * 255, (0, 0), 8)
    mask = (mask.astype(np.float32) * (1.0 - body.astype(np.float32) / 255.0)).astype(np.uint8)

    # 闭运算补发丝之间的孔洞，开运算去掉细刺
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k, iterations=2)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k, iterations=1)

    # 羽化：模糊半径按原图尺度给（960 宽下 26px ≈ 1920 宽下 52px）
    mask = cv2.GaussianBlur(mask, (0, 0), 26)

    os.makedirs(OUT_DIR, exist_ok=True)
    full = os.path.join(OUT_DIR, 'poem-hair.webp')
    ok, buf = cv2.imencode('.webp', mask, [cv2.IMWRITE_WEBP_QUALITY, 88])
    buf.tofile(full)

    # 手机竖裁版：坐标换算回原图再裁
    x0, y0, x1, y1 = MOBILE_CROP
    sub = mask[int(y0 * s):int(y1 * s), int(x0 * s):int(x1 * s)]
    sub = cv2.resize(sub, (x1 - x0, y1 - y0), interpolation=cv2.INTER_CUBIC)
    mfull = os.path.join(OUT_DIR, 'poem-hair-m.webp')
    ok, buf2 = cv2.imencode('.webp', sub, [cv2.IMWRITE_WEBP_QUALITY, 88])
    buf2.tofile(mfull)

    # 调试叠加图
    dbg = small.copy()
    red = np.zeros_like(dbg)
    red[:, :, 2] = 255
    a = (mask.astype(np.float32) / 255.0)[:, :, None] * 0.55
    dbg = (dbg * (1 - a) + red * a).astype(np.uint8)
    cv2.rectangle(dbg, (int(x0 * s), int(y0 * s)), (int(x1 * s), int(y1 * s)), (0, 255, 255), 2)
    ok, png = cv2.imencode('.png', dbg)
    png.tofile(os.path.join(ROOT, '.tmp', 'mask-check.png'))

    for p in (full, mfull):
        print('%-42s %5.1f KB' % (os.path.relpath(p, ROOT), os.path.getsize(p) / 1024.0))


if __name__ == '__main__':
    main()
