#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
optimize_ui_assets.py · 站内小图瘦身

页头头像、页脚头像、左下角站娘这三张图每个页面都要加载，
原文件是按大图存的（640px 头像 42KB、256px 站娘 PNG 94KB），
而它们实际显示只有 22~104px，慢链路上白等好几秒。

这里按「显示尺寸 × 2（视网膜屏）」出 webp：
    miku.webp      96x96    页头/页脚头像（显示 36~42px）
    webtitle.webp  256x256  站娘（显示 76~104px），保留原 png 给 favicon
    blblfmj.webp   96x96    登录后默认头像（显示 22~46px）

用法：/d/Python39/python.exe tools/optimize_ui_assets.py
"""
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = os.path.join(ROOT, 'public', 'imgs', 'offen')

JOBS = [
    # 源文件, 输出, 边长, 质量
    ('miku.jpg', 'miku.webp', 96, 84),
    ('webtitle.png', 'webtitle.webp', 256, 82),
    ('blblfmj.png', 'blblfmj.webp', 96, 84),
]

# favicon：浏览器标签页只用得到 16~32px，没必要每页拉 94KB 的 256px PNG
FAVICON_SRC = ('webtitle.png', 'favicon.png', 64)


def main():
    for src_name, out_name, size, quality in JOBS:
        src = os.path.join(DIR, src_name)
        if not os.path.exists(src):
            print('  跳过（缺文件）：%s' % src_name)
            continue
        before = os.path.getsize(src)
        im = Image.open(src)
        # 带头透明就保留 alpha；调色板图（P）要把 transparency 一起算进来，
        # 否则透明区域会被压成黑底
        has_alpha = (im.mode in ('RGBA', 'LA') or
                     (im.mode == 'P' and 'transparency' in im.info))
        im = im.convert('RGBA' if has_alpha else 'RGB')
        im = im.resize((size, size), Image.LANCZOS)
        out = os.path.join(DIR, out_name)
        im.save(out, 'WEBP', quality=quality, method=6)
        print('%-16s %4dpx  %5.1fKB -> %5.1fKB  (%s)' % (
            out_name, size, before / 1024.0, os.path.getsize(out) / 1024.0,
            os.path.basename(src)))

    src_name, out_name, size = FAVICON_SRC
    src = os.path.join(DIR, src_name)
    before = os.path.getsize(src)
    im = Image.open(src).convert('RGBA').resize((size, size), Image.LANCZOS)
    out = os.path.join(DIR, out_name)
    im.save(out, 'PNG', optimize=True)
    print('%-16s %4dpx  %5.1fKB -> %5.1fKB  (%s)' % (
        out_name, size, before / 1024.0, os.path.getsize(out) / 1024.0, src_name))


if __name__ == '__main__':
    main()
