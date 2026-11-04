# -*- coding: utf-8 -*-
"""
从插画里抠出「头发遮罩」，供首屏 WebGL 风场使用（hero-fx.js 的 uMask）。

背景：首页那张 lliij-2.webp 是单层平面图，没有分层信息。要让头发飘动，
     需要一张灰度遮罩告诉着色器「哪些像素属于头发，可以位移」。

做法（全自动，不需要 PS，但只是初版，边缘仍需人工或 AI 修）：
  1. 暗结构：绝对亮度低 + 比周围一圈明显暗（排除亮天空）
  2. 连通域：只保留与「头发种子点」相连的大块，甩掉散落的暗云
  3. 手绘多边形：把范围限制在角色头发所在区域，排除腿、礁石、左下角小人物
  4. 挖掉头/脸/上身：椭圆羽化后相减，否则动画时脸会被风吹变形
  5. 补洞 + 高斯羽化，输出半尺寸灰度 webp（体积约 7KB）

用法：
    D:/Python39/python.exe tools/make_hair_mask.py
产出：
    public/imgs/offen/lliij-2-hair.webp

换图时注意：种子点、多边形、身体椭圆都是按这张图量的，换图要重新标。
"""
import cv2
import numpy as np
from PIL import Image

SRC = 'public/imgs/offen/lliij-2.webp'
OUT = 'public/imgs/offen/lliij-2-hair.webp'

# 阈值：绝对亮度上限、相对背景的暗度（两者越严，越干净但越容易漏发丝）
L_MAX = 120
REL_DARK = -22

# 头发种子点（保证落在头发主体上即可，多处给几个更稳）
SEEDS = [(2500, 700), (2400, 500), (2700, 900), (2250, 420), (2950, 600)]

# 头发大致范围的多边形（图像坐标）
POLY = [[2085, 300], [2280, 225], [2520, 255], [2780, 330], [3000, 520],
        [3000, 1010], [2700, 1050], [2400, 1040], [2180, 860], [2090, 620]]

# 头 / 脸 / 上身：三个椭圆 (cx, cy, rx, ry, 旋转角)
BODY = [(2145, 470, 110, 150, -8), (2130, 700, 135, 130, 10)]


def main():
    im = Image.open(SRC).convert('RGB')
    a = np.asarray(im)
    h, w = a.shape[:2]

    lum = cv2.cvtColor(a, cv2.COLOR_RGB2GRAY).astype(np.float32)
    bg = cv2.GaussianBlur(lum, (0, 0), 80)
    rel = lum - bg

    # 1) 暗结构
    m = ((lum < L_MAX) & (rel < REL_DARK)).astype(np.uint8)

    # 2) 只留与种子点连通的块
    _, lab = cv2.connectedComponents(m, connectivity=8)
    keep = {lab[y, x] for x, y in SEEDS if lab[y, x]}
    m = np.isin(lab, list(keep)).astype(np.uint8)

    # 3) 限制在头发范围
    poly = np.zeros((h, w), np.uint8)
    cv2.fillPoly(poly, [np.array(POLY, np.int32)], 1)
    m = (m & poly).astype(np.uint8)

    # 4) 挖掉头/脸/上身（羽化后相减）
    body = np.zeros((h, w), np.float32)
    for cx, cy, rx, ry, ang in BODY:
        cv2.ellipse(body, (cx, cy), (rx, ry), ang, 0, 360, 1.0, -1)
    body = cv2.GaussianBlur(body, (0, 0), 18)
    m = np.clip(m.astype(np.float32) - body * 1.6, 0, 1)

    # 5) 补洞 + 羽化
    m = cv2.morphologyEx((m > 0.5).astype(np.uint8), cv2.MORPH_CLOSE, np.ones((13, 13), np.uint8))
    mask = cv2.GaussianBlur(m.astype(np.float32), (0, 0), 4.5)

    out = Image.fromarray((mask * 255).astype(np.uint8))
    out.resize((w // 2, h // 2), Image.LANCZOS).save(OUT, quality=90, method=6)
    print('%s 覆盖 %.1f%% → %s' % (SRC, mask.mean() * 100, OUT))


if __name__ == '__main__':
    main()
