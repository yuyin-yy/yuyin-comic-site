# -*- coding: utf-8 -*-
"""
抓取 guazimanhua.com 的漫画元数据。

为什么要换源：manhua3 的作品详情页对 IP 做了频率风控，且部分 slug 已失效，
导致「阅读最新一话」跳过去是 404。瓜子漫画的详情页内嵌 JSON-LD，
章节 id 与最新话都在里面，链接稳定可验证。

产出（全部落在项目内，不污染 public）：
  .tmp/gz_cache/*.html      原始页面缓存，断点续跑用
  .tmp/gz/details/<id>.json 单部作品的解析结果
  public/imgs/covers2/<id>.jpg  本地封面
  data/guazi_comics.json    汇总数据（供 tools/build_data.py 使用）

用法：
  python tools/scrape_guazi.py --list           # 只抓列表页
  python tools/scrape_guazi.py --detail 450     # 抓详情（含章节链接）
  python tools/scrape_guazi.py --cover          # 下载封面
  python tools/scrape_guazi.py --all 450        # 一条龙
"""
import argparse
import concurrent.futures as futures
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = 'https://www.guazimanhua.com'
CACHE = os.path.join(ROOT, '.tmp', 'gz_cache')
DETAIL_DIR = os.path.join(ROOT, '.tmp', 'gz', 'details')
COVER_DIR = os.path.join(ROOT, 'public', 'imgs', 'covers2')
OUT_JSON = os.path.join(ROOT, 'data', 'guazi_comics.json')

UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36')

for d in (CACHE, DETAIL_DIR, COVER_DIR, os.path.dirname(OUT_JSON)):
    os.makedirs(d, exist_ok=True)

# 题材词表（用于从 meta 里区分「作者」与「标签」）
TAG_VOCAB = {
    '耽美', '恋爱', '校园', '霸总', '都市', '穿越', '古风', '玄幻', '奇幻', '科幻',
    '灵异', '动作', '悬疑', '冒险', '搞笑', '热血', '恐怖', '系统', '逆袭', '脑洞',
    '复仇', '真人', '其它', '同人', '完结', '连载', '已完结', '连载中', '仙侠', '武侠',
}

# 列表任务：(查询串, 页数, 附加属性)
LIST_TASKS = [
    ('sort=hits', 6, {}),                 # 人气榜，保证前排都是热门
    ('city=338', 5, {'region': '国漫'}),  # 国漫
    ('city=78', 4, {'region': '日韩'}),   # 日韩
    ('city=42', 2, {'region': '国漫'}),   # 大陆
    ('city=43', 1, {'region': '欧美'}),   # 欧美
    ('city=77', 1, {'region': '港台'}),   # 港台
    ('audience=1', 3, {'audience': '男频'}),
    ('audience=2', 3, {'audience': '女频'}),
    ('is_end=1', 2, {'status': '已完结'}),
]


def log(msg):
    sys.stdout.write(msg + '\n')
    sys.stdout.flush()


def cache_file(url):
    name = re.sub(r'[^0-9a-zA-Z]+', '_', url.replace(BASE, ''))[:150] or 'root'
    return os.path.join(CACHE, name + '.html')


def fetch(url, retries=4, timeout=25, use_cache=True, binary=False):
    """带本地缓存与退避重试的 GET。binary=True 时不写缓存、返回 bytes。"""
    cp = cache_file(url)
    if use_cache and not binary and os.path.exists(cp) and os.path.getsize(cp) > 800:
        with io.open(cp, 'rb') as fh:
            return fh.read()
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={
                'User-Agent': UA,
                'Accept-Language': 'zh-CN,zh;q=0.9',
                'Referer': BASE + '/',
            })
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = resp.read()
            if use_cache and not binary:
                with io.open(cp, 'wb') as fh:
                    fh.write(data)
            return data
        except urllib.error.HTTPError as exc:
            if exc.code in (429, 503):
                time.sleep(8 * (i + 1))
                continue
            if i == retries - 1:
                log('  ! %s -> %s' % (url, exc))
                return None
            time.sleep(2 + i * 2)
        except Exception as exc:  # noqa: BLE001
            if i == retries - 1:
                log('  ! %s -> %s' % (url, exc))
                return None
            time.sleep(1.5 * (i + 1))
    return None


def text(html):
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', html or '')).strip()


# --------------------------------------------------------------------------
# 列表页
# --------------------------------------------------------------------------
CARD_RE = re.compile(r'<article class="card">(.*?)</article>', re.S)


def parse_list(html):
    out = []
    for m in CARD_RE.finditer(html):
        body = m.group(1)
        idm = re.search(r'comic\.php\?id=(\d+)', body)
        img = re.search(r'<img class="cover"[^>]*src="([^"]+)"', body)
        score = re.search(r'<span class="score">([\d.]+)</span>', body)
        state = re.search(r'<span class="genre">([^<]+)</span>', body)
        title = re.search(r'<h3><a[^>]*>(.*?)</a></h3>', body, re.S)
        meta = re.search(r'<div class="meta">(.*?)</div>', body, re.S)
        if not (idm and title):
            continue
        parts = [p.strip() for p in text(meta.group(1)).split('·') if p.strip()] if meta else []
        author, tags = '', []
        for p in parts:
            if p in ('完结', '连载', '已完结', '连载中'):
                continue
            if p in TAG_VOCAB:
                tags.append(p)
            elif not author and len(p) <= 24:
                author = p
        out.append({
            'srcId': int(idm.group(1)),
            'title': text(title.group(1)),
            'cover_remote': img.group(1) if img else '',
            'score': score.group(1) if score else '',
            'state': state.group(1).strip() if state else '',
            'author': author,
            'tags': tags,
        })
    return out


def collect_lists():
    pool = {}
    for query, pages, extra in LIST_TASKS:
        got = 0
        for page in range(1, pages + 1):
            url = '%s/category.php?%s&page=%d' % (BASE, query, page)
            raw = fetch(url)
            time.sleep(0.5)
            if not raw:
                continue
            items = parse_list(raw.decode('utf-8', 'ignore'))
            if not items:
                log('  空页 %s' % url)
                break
            got += len(items)
            for it in items:
                cur = pool.setdefault(it['srcId'], {
                    'srcId': it['srcId'], 'title': it['title'],
                    'cover_remote': it['cover_remote'], 'score': it['score'],
                    'state': it['state'], 'author': it['author'],
                    'tags': list(it['tags']), 'region': '', 'audience': '',
                    'status_hint': '',
                })
                if not cur['author']:
                    cur['author'] = it['author']
                for t in it['tags']:
                    if t not in cur['tags']:
                        cur['tags'].append(t)
                if it['score'] and not cur['score']:
                    cur['score'] = it['score']
                if extra.get('region') and not cur['region']:
                    cur['region'] = extra['region']
                if extra.get('audience') and not cur['audience']:
                    cur['audience'] = extra['audience']
                if extra.get('status'):
                    cur['status_hint'] = extra['status']
                if it['state'] in ('完结', '已完结'):
                    cur['status_hint'] = cur['status_hint'] or '已完结'
        log('  %-14s %2d 页 / %3d 条' % (query, pages, got))
    log('列表合计 %d 部（去重后）' % len(pool))
    with io.open(os.path.join(ROOT, '.tmp', 'gz', 'list.json'), 'w', encoding='utf-8') as fh:
        json.dump(list(pool.values()), fh, ensure_ascii=False, indent=1)
    return list(pool.values())


# --------------------------------------------------------------------------
# 详情页：JSON-LD 里有作者、简介、章节 id
# --------------------------------------------------------------------------
def parse_jsonld(html):
    blocks = re.findall(
        r'<script type="application/ld\+json">(.*?)</script>', html, re.S)
    for b in blocks:
        try:
            data = json.loads(b)
        except ValueError:
            continue
        yield data


def parse_detail(html, src_id):
    res = {'srcId': src_id, 'chapters': []}
    for data in parse_jsonld(html):
        nodes = data.get('@graph') if isinstance(data, dict) and '@graph' in data else [data]
        for node in nodes or []:
            if not isinstance(node, dict):
                continue
            typ = node.get('@type')
            if typ == 'ComicStory':
                res['title'] = (node.get('name') or '').strip()
                author = node.get('author') or {}
                if isinstance(author, dict):
                    res['author'] = (author.get('name') or '').strip()
                res['desc'] = (node.get('description') or '').strip()
                res['cover_remote'] = node.get('image') or ''
                res['genres'] = [g for g in (node.get('genre') or []) if g]
                res['updated'] = (node.get('dateModified') or '')[:10]
                res['detailUrl'] = node.get('url') or ''
            elif typ == 'ItemList' and '章节目录' in str(node.get('name', '')):
                # 注意：这个列表通常只截取前 50 章，最新话要靠页面里的 latest-box
                res['total'] = int(node.get('numberOfItems') or 0)

    # 完整章节列表：all-chapter-grid 里是全部章节，新话在前
    grid = re.search(r'all-chapter-grid[^>]*>(.*?)</div>', html, re.S)
    if grid:
        for m in re.finditer(r'<a[^>]*href="/chapter\.php\?id=(\d+)"[^>]*>([^<]*)</a>', grid.group(1)):
            ch_id = int(m.group(1))
            name = text(m.group(2))
            if all(c[0] != ch_id for c in res['chapters']):
                res['chapters'].append([ch_id, name, ''])

    # 最近几话的更新日期（只有最新 4 条带日期，用于 updated 字段）
    dates = {}
    for m in re.finditer(
            r'<a class="latest-chapter[^"]*" href="/chapter\.php\?id=(\d+)">'
            r'<b>([^<]*)</b>(?:<span>([^<]*)</span>)?', html):
        d = (m.group(3) or '').strip()[:10]
        if d:
            dates[int(m.group(1))] = d
    for c in res['chapters']:
        if not c[2] and c[0] in dates:
            c[2] = dates[c[0]]

    # 最新话：优先取「最新更新」大按钮，其次取章节列表第一项
    box = re.search(r'latest-box[^"]*"\s+href="/chapter\.php\?id=(\d+)"', html)
    if box:
        res['latest_id'] = int(box.group(1))
    elif res['chapters']:
        res['latest_id'] = res['chapters'][0][0]

    if res['chapters']:
        res['updated'] = res['chapters'][0][2] or res.get('updated', '')
        res['total'] = max(res.get('total') or 0, len(res['chapters']))

    # 热度 / 最新话（页面右侧信息条）
    hot = re.search(r'<span>热度</span><b>([^<]+)</b>', html)
    if hot:
        res['heat_text'] = hot.group(1).strip()
    newest = re.search(r'<span>最新</span><b>([^<]+)</b>', html)
    if newest:
        res['newest_text'] = newest.group(1).strip()
    state = re.search(r'<span class="genre">([^<]+)</span>', html)
    if state:
        res['state'] = state.group(1).strip()
    if not res.get('title'):
        t = re.search(r'<title>([^<]+?)漫画在线阅读', html)
        if t:
            res['title'] = t.group(1).strip()
    return res


def collect_details(ids, limit, workers=4, delay=0.2):
    jobs = []
    for sid in ids:
        f = os.path.join(DETAIL_DIR, '%s.json' % sid)
        if os.path.exists(f) and os.path.getsize(f) > 200:
            continue
        jobs.append(sid)
    jobs = jobs[:limit]
    log('待抓详情 %d 部' % len(jobs))
    if not jobs:
        return

    def work(sid):
        raw = fetch('%s/comic.php?id=%d' % (BASE, sid), use_cache=False)
        time.sleep(delay)
        if not raw:
            return None
        d = parse_detail(raw.decode('utf-8', 'ignore'), sid)
        if not d.get('chapters'):
            return None
        with io.open(os.path.join(DETAIL_DIR, '%s.json' % sid), 'w', encoding='utf-8') as fh:
            json.dump(d, fh, ensure_ascii=False)
        return d

    done = 0
    with futures.ThreadPoolExecutor(max_workers=workers) as pool:
        for d in pool.map(work, jobs):
            if d:
                done += 1
                if done % 25 == 0:
                    log('  详情 %d / %d' % (done, len(jobs)))
    log('详情完成 %d 部' % done)


# --------------------------------------------------------------------------
# 封面
# --------------------------------------------------------------------------
def download_covers(limit):
    items = json.load(io.open(os.path.join(ROOT, '.tmp', 'gz', 'list.json'), encoding='utf-8'))
    jobs = []
    for it in items[:limit]:
        ext = os.path.splitext(it['cover_remote'].split('?')[0])[1].lower() or '.jpg'
        if ext not in ('.jpg', '.jpeg', '.png', '.webp'):
            ext = '.jpg'
        path = os.path.join(COVER_DIR, '%d%s' % (it['srcId'], ext))
        if os.path.exists(path) and os.path.getsize(path) > 2000:
            continue
        if it['cover_remote']:
            jobs.append((it['cover_remote'], path))
    log('待下载封面 %d 张' % len(jobs))
    if not jobs:
        return

    def work(job):
        url, path = job
        data = fetch(url, use_cache=False, binary=True)
        if not data or len(data) < 1500:
            return False
        with io.open(path, 'wb') as fh:
            fh.write(data)
        return True

    ok = 0
    with futures.ThreadPoolExecutor(max_workers=6) as pool:
        for r in pool.map(work, jobs):
            ok += 1 if r else 0
    log('封面完成 %d 张' % ok)


# --------------------------------------------------------------------------
# 汇总
# --------------------------------------------------------------------------
def parse_heat(txt):
    """'160.89万' -> 1608900；'1.2亿' -> 120000000"""
    if not txt:
        return 0
    m = re.search(r'([\d.]+)\s*(亿|万)?', txt)
    if not m:
        return 0
    v = float(m.group(1))
    unit = m.group(2)
    if unit == '亿':
        v *= 100000000
    elif unit == '万':
        v *= 10000
    return int(v)


def build():
    items = json.load(io.open(os.path.join(ROOT, '.tmp', 'gz', 'list.json'), encoding='utf-8'))
    out = []
    for it in items:
        sid = it['srcId']
        det_path = os.path.join(DETAIL_DIR, '%s.json' % sid)
        # 详情抓不到的（被限流）也保留：有作者/标签/评分与作品页地址，
        # 前端会标成「待补全」并只提供作品页入口，不会产生死链。
        det = json.load(io.open(det_path, encoding='utf-8')) if os.path.exists(det_path) else {}
        chs = det.get('chapters') or []
        if chs:
            # 章节按「新话在前」排列：chs[0] 就是最新话
            latest_id = det.get('latest_id') or chs[0][0]
            latest_name = chs[0][1]
        else:
            latest_id, latest_name = 0, ''
        total = det.get('total') or len(chs)

        cover = ''
        for ext in ('.jpg', '.jpeg', '.png', '.webp'):
            p = os.path.join(COVER_DIR, '%d%s' % (sid, ext))
            if os.path.exists(p) and os.path.getsize(p) > 2000:
                cover = 'imgs/covers2/%d%s' % (sid, ext)
                break
        if not cover:
            cover = 'imgs/placeholder.svg'

        tags = [t for t in (det.get('genres') or []) if t] or it.get('tags') or []
        tags = [t for t in tags if t not in ('完结', '连载', '已完结', '连载中')]

        try:
            rating = round(float(it.get('score') or 0) / 2, 1)
        except ValueError:
            rating = 0
        if rating > 5:
            rating = 5.0

        state = det.get('state') or it.get('state') or ''
        if it.get('status_hint') == '已完结' or state in ('完结', '已完结'):
            status = '已完结'
        else:
            status = '连载中'

        chapter = latest_name or ('已完结' if it.get('status_hint') == '已完结' else '连载中')
        m = re.match(r'^(\d+)\s*[-_.、:：]?\s*(.*)$', chapter) if latest_name else None
        if m:
            chapter = '第%d话' % int(m.group(1)) + ((' ' + m.group(2)) if m.group(2) else '')
        elif not chapter:
            chapter = '第%d话' % total if total else '连载中'

        # 章节名做同样的规范化，保证详情页展示统一
        norm_chs = []
        for c in (chs[:16] if chs else []):
            name = c[1]
            mm = re.match(r'^(\d+)\s*[-_.、:：]?\s*(.*)$', name)
            if mm:
                name = '第%d话' % int(mm.group(1)) + ((' ' + mm.group(2)) if mm.group(2) else '')
            norm_chs.append([c[0], name, c[2] if len(c) > 2 else ''])

        out.append({
            'srcId': sid,
            'title': det.get('title') or it['title'],
            'author': det.get('author') or it.get('author') or '',
            'cover': cover,
            'tags': tags[:4],
            'region': it.get('region') or '',
            'audience': it.get('audience') or '',
            'rating': rating,
            'status': status,
            'chapter': chapter,
            'total': total,
            'heat': parse_heat(det.get('heat_text')),
            'updated': det.get('updated') or '',
            'desc': det.get('desc') or '',
            'readUrl': ('%s/chapter.php?id=%d' % (BASE, latest_id)) if latest_id else '',
            'detailUrl': det.get('detailUrl') or '%s/comic.php?id=%d' % (BASE, sid),
            'chs': norm_chs,
        })

    # 同名去重：保留章节更多的一条
    uniq = {}
    for x in out:
        key = re.sub(r'[\s·:：!！?？]+', '', x['title']).lower()
        old = uniq.get(key)
        if old is None or x['total'] > old['total']:
            uniq[key] = x
    out = list(uniq.values())
    out.sort(key=lambda x: -x['heat'])
    json.dump(out, io.open(OUT_JSON, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    log('汇总 %d 部 -> %s' % (len(out), os.path.relpath(OUT_JSON, ROOT)))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--list', action='store_true')
    ap.add_argument('--detail', type=int, default=0)
    ap.add_argument('--cover', type=int, default=0)
    ap.add_argument('--build', action='store_true')
    ap.add_argument('--all', type=int, default=0)
    ap.add_argument('--workers', type=int, default=4, help='详情并发数，站点限流时设为 1')
    ap.add_argument('--delay', type=float, default=0.2, help='每个详情请求后的间隔秒数')
    args = ap.parse_args()

    if args.all:
        args.list = True
        args.detail = args.all
        args.cover = args.all

    if args.list:
        log('[1/4] 列表页…')
        collect_lists()
    if args.detail:
        log('[2/4] 详情页…')
        lst = json.load(io.open(os.path.join(ROOT, '.tmp', 'gz', 'list.json'), encoding='utf-8'))
        lst.sort(key=lambda x: -(parse_heat(x.get('score'))))
        collect_details([x['srcId'] for x in lst], args.detail, args.workers, args.delay)
    if args.cover:
        log('[3/4] 封面…')
        download_covers(args.cover)
    if args.build or args.all:
        log('[4/4] 汇总…')
        build()


if __name__ == '__main__':
    main()
