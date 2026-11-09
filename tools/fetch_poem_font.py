# -*- coding: utf-8 -*-
"""下载「马善政毛笔楷书」行楷字体，并按实际用到的字裁成子集。

字体：Ma Shan Zheng / 马善政毛笔楷书（SIL Open Font License 1.1，可免费商用 / 自托管）。
      笔势连贯、字形方正，是行楷里辨识度较高的一款；早前用的是「刘建毛草」草书，
      连笔太多阅读困难，已换掉。
做法：把诗句用到的字拼进 Google Fonts 的 text= 参数，服务端直接返回
只含这些字形的 woff2（约 14KB），比下 5MB 全字库合理得多。
改了诗句就改下面的 CHARS 再跑一次。

用法：python tools/fetch_poem_font.py
输出：public/fonts/mashanzheng.woff2
"""
import io
import os
import re
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'fonts', 'mashanzheng.woff2')

FAMILY = 'Ma Shan Zheng'

# 诗句 + 署名用到的全部字符（重复的会自动去重）
CHARS = ('伫倚危楼风细细望极春愁衣带渐宽终不悔'
         '为伊消得人憔悴柳永蝶恋花·')

UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def main():
    text = ''.join(dict.fromkeys(CHARS))          # 去重且保序
    q = urllib.parse.quote(text, safe='')
    css_url = ('https://fonts.googleapis.com/css2?family=' + FAMILY.replace(' ', '+') +
               '&text=' + q + '&display=swap')
    css = get(css_url).decode('utf-8')
    m = re.search(r'url\((https://[^)]+)\)', css)
    if not m:
        raise SystemExit('没在 CSS 里找到字体地址：\n' + css[:400])

    data = get(m.group(1))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with io.open(OUT, 'wb') as f:
        f.write(data)
    print('字符数 %d -> %s (%.1f KB)'
          % (len(text), os.path.relpath(OUT, ROOT), len(data) / 1024.0))


if __name__ == '__main__':
    main()
