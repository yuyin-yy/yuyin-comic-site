# -*- coding: utf-8 -*-
"""
封面压缩：把 public/imgs/covers2 里的原图统一转成 webp。

源站封面多为 300x400 的 jpg/webp，单张 90~150KB，近 600 张要占 60MB+。
转成 webp(q=82, 宽 300) 后单张约 20~30KB，肉眼几乎无差别。

依赖 Pillow，系统 Python 里已有（D:\\Python39\\python.exe）：
    /d/Python39/python tools/compress_covers.py
"""
import io
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COVER_DIR = os.path.join(ROOT, 'public', 'imgs', 'covers2')
MAX_W = 320
QUALITY = 82


def main():
    if not os.path.isdir(COVER_DIR):
        sys.exit('没有封面目录：%s' % COVER_DIR)
    before = after = 0
    files = [f for f in os.listdir(COVER_DIR)
             if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp'))]
    for name in files:
        path = os.path.join(COVER_DIR, name)
        size = os.path.getsize(path)
        before += size
        stem = os.path.splitext(name)[0]
        target = os.path.join(COVER_DIR, stem + '.webp')
        try:
            with Image.open(path) as im:
                im = im.convert('RGB')
                if im.width > MAX_W:
                    im = im.resize((MAX_W, int(im.height * MAX_W / im.width)),
                                   Image.LANCZOS)
                im.save(target, 'WEBP', quality=QUALITY, method=6)
        except Exception as exc:  # noqa: BLE001
            print('  ! %s -> %s' % (name, exc))
            after += size
            continue
        # 原始文件与目标不同名才删除，避免把刚写好的 webp 删掉
        if os.path.abspath(path) != os.path.abspath(target):
            os.remove(path)
        after += os.path.getsize(target)
    print('处理 %d 张：%.1f MB -> %.1f MB' % (
        len(files), before / 1048576, after / 1048576))


if __name__ == '__main__':
    main()
