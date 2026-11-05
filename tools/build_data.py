# -*- coding: utf-8 -*-
"""
把抓取结果整理成前端数据源 public/js/data.js。

输入：data/guazi_comics.json（tools/scrape_guazi.py 产出）
输出：public/js/data.js（window.COMICS = [...]）

只做三件事：
  1. 过滤掉连原站地址都没有的条目（有地址的一律保留，不留纯死链）
  2. 按「有章节优先 + 热度」排序并重新编号，id 从 1 开始
  3. 补齐前端用得到的派生字段（chapterNo / total / hasChs / pending）
"""
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'data', 'guazi_comics.json')
OUT = os.path.join(ROOT, 'public', 'js', 'data.js')
OUT_DETAIL = os.path.join(ROOT, 'public', 'js', 'data-detail.js')


def chapter_no(name):
    m = re.search(r'第?(\d+)', name or '')
    return int(m.group(1)) if m else 0


def main():
    if not os.path.exists(SRC):
        sys.exit('缺少 %s，请先运行 python tools/scrape_guazi.py --all' % SRC)
    raw = json.load(io.open(SRC, encoding='utf-8'))

    items = []
    for x in raw:
        # 至少要能跳到原站作品页，否则这条数据没有意义
        if not (x.get('detailUrl') or x.get('readUrl')):
            continue
        x['hasChs'] = 1 if x.get('chs') else 0
        # 章节没抓到的标记 pending：前端阅读入口改跳站内 404.html，
        # 不再把用户送去原站（源站对详情页限流，跳过去也是空的）
        x['pending'] = 0 if x['hasChs'] else 1
        x['chapterNo'] = chapter_no(x.get('chapter'))
        x['total'] = int(x.get('total') or len(x['chs']))
        x['heat'] = int(x.get('heat') or 0)
        x['rating'] = round(float(x.get('rating') or 0), 1)
        items.append(x)

    # 已有章节链接的排前面，其余按热度、标题排，保证首页看到的都是能直接开读的
    items.sort(key=lambda x: (-x['hasChs'], -x['heat'], x['title']))
    for i, x in enumerate(items):
        x['id'] = i + 1

    # 字段顺序固定，便于人工 review 与 diff。
    # 简介与章节目录（desc / chs）不在这里：它们合计占三成多，而只有详情页要用，
    # 单独生成 data-detail.js，别让首页为它们等上几秒。
    order = ['id', 'title', 'author', 'cover', 'tags', 'region', 'audience', 'rating',
             'status', 'chapter', 'chapterNo', 'total', 'heat', 'updated',
             'hasChs', 'pending', 'readUrl', 'detailUrl', 'srcId']
    clean = [{k: x.get(k) for k in order} for x in items]

    body = json.dumps(clean, ensure_ascii=False, indent=1)
    head = ('/* 漫画索引：由 tools/build_data.py 从 data/guazi_comics.json 生成，'
            '请勿手工编辑。\n'
            '   每条包含：作者 / 题材 / 地区-受众 / 评分 / 最新章节 / 热度 / 原站地址。\n'
            '   简介与章节目录在 data-detail.js（仅详情页加载）。\n'
            '   共计 %d 部作品。 */\n' % len(clean))
    js = head + 'window.COMICS = ' + body + ';\n'
    io.open(OUT, 'w', encoding='utf-8').write(js)

    # 详情包：按 id 索引，只装 desc 与 chs，空条目直接跳过
    detail = {}
    for x in items:
        entry = {}
        if x.get('desc'):
            entry['desc'] = x['desc']
        if x.get('chs'):
            entry['chs'] = x['chs']
        if entry:
            detail[str(x['id'])] = entry
    dbody = json.dumps(detail, ensure_ascii=False, separators=(',', ':'))
    dhead = ('/* 详情补充数据：简介 + 章节目录，由 tools/build_data.py 生成。\n'
             '   只有作品详情页会加载它，列表页不要引。 */\n')
    io.open(OUT_DETAIL, 'w', encoding='utf-8').write(dhead + 'window.COMIC_DETAIL = ' + dbody + ';\n')

    regions = {}
    for x in items:
        key = x['region'] or '未标注'
        regions[key] = regions.get(key, 0) + 1
    ready = sum(1 for x in items if x['hasChs'])
    print('作品 %d 部 · 可直接开读 %d 部 · 待补全 %d 部 · 平均 %d 话' % (
        len(items), ready, len(items) - ready,
        sum(x['total'] for x in items) / max(1, len(items))))
    print('地区分布：' + ' / '.join('%s %d' % (k, v) for k, v in
                                 sorted(regions.items(), key=lambda kv: -kv[1])))
    print('评分覆盖 %d 部，简介覆盖 %d 部' % (
        sum(1 for x in items if x['rating']), sum(1 for x in items if x['desc'])))
    print('输出 -> %s (%.0f KB) + %s (%.0f KB)' % (
        os.path.relpath(OUT, ROOT), os.path.getsize(OUT) / 1024,
        os.path.relpath(OUT_DETAIL, ROOT), os.path.getsize(OUT_DETAIL) / 1024))


if __name__ == '__main__':
    main()
