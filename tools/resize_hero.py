#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
resize_hero.py · 首屏图分档

原图 3000x1250 单档下发，手机也要解 15MB 像素，首屏会白很久。
这里按宽度切几档，CSS 用媒体查询挑选：

    <=720px : lliij-2-1400.webp
    <=1440px: lliij-2-2000.webp
    >1440px : lliij-2.webp（原图）

用法：python tools/resize_hero.py
需要 Pillow（本机 D:\\Python39\\python.exe 已装）。
"""
import os
from PIL import Image

SRC = os.path.join('public', 'imgs', 'offen', 'lliij-2.webp')
TIERS = [
    ('lliij-2-1400.webp', 1400, 82),
    ('lliij-2-2000.webp', 2000, 82),
]


def main():
    base = Image.open(SRC).convert('RGB')
    src_w, src_h = base.size
    print('source', src_w, src_h)

    for name, width, quality in TIERS:
        if width >= src_w:
            continue
        height = round(src_h * width / src_w)
        out = base.resize((width, height), Image.LANCZOS)
        path = os.path.join(os.path.dirname(SRC), name)
        out.save(path, 'WEBP', quality=quality, method=6)
        print('%-22s %4dx%-4d %6.1f KB' % (name, width, height,
                                           os.path.getsize(path) / 1024.0))


if __name__ == '__main__':
    main()
