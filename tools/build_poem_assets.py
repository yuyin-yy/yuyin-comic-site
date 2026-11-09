# -*- coding: utf-8 -*-
"""尾屏插画转 webp 并出多档尺寸。

源图：assets/poem-bg.jpg（1920×1120）
输出：
  poem-bg-1920.webp  桌面 / 平板的原尺寸
  poem-bg-1280.webp  ≤1280 的笔记本，省一半像素
  poem-bg-m.webp     手机竖裁（只要左边那块，人物在右半张，裁掉）

用法：python tools/build_poem_assets.py
"""
import io
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'poem-bg.jpg')
OUT = os.path.join(ROOT, 'public', 'imgs', 'poem')

# 手机竖裁：x 0~520，整高 1120，比例 0.464，正好贴合 390×844
MOBILE_CROP = (0, 0, 520, 1120)

JOBS = [
    ('poem-bg-1920.webp', 1920, 78, None),
    ('poem-bg-1280.webp', 1280, 78, None),
    ('poem-bg-m.webp', 520, 82, MOBILE_CROP),
]


def main():
    os.makedirs(OUT, exist_ok=True)
    src = Image.open(SRC).convert('RGB')
    print('source %dx%d %.0fKB' % (src.size[0], src.size[1],
                                   os.path.getsize(SRC) / 1024.0))
    for name, w, q, crop in JOBS:
        im = src.crop(crop) if crop else src
        if im.size[0] != w:
            im = im.resize((w, round(w * im.size[1] / im.size[0])), Image.LANCZOS)
        p = os.path.join(OUT, name)
        im.save(p, 'WEBP', quality=q, method=6)
        print('%-20s %4dx%-4d %6.1f KB' % (name, im.size[0], im.size[1],
                                           os.path.getsize(p) / 1024.0))


if __name__ == '__main__':
    main()
