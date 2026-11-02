# -*- coding: utf-8 -*-
"""用 Scrapling 补抓 guazimanhua.com 的作品详情（章节 id / 简介 / 作者）。

为什么单开一个脚本：
  旧 tools/scrape_guazi.py 走 urllib，TLS 指纹与 UA 不匹配，站点对详情页
  限流后直接 403，且无法自愈。Scrapling 基于 curl_cffi，可伪装真实浏览器
  指纹（impersonate），实测同样地址返回 200。

防风控策略（核心，改动前请先读）：
  1. 单会话复用：FetcherSession 保持 cookie/连接，避免「新 IP 式」突增。
  2. 匀速 + 抖动：默认 1.8~3.2s 随机间隔，模拟人工浏览，不并发。
  3. 分批休眠：每 35 个请求插入 20~30s 长停顿，压低单位时间请求数。
  4. 分级退避：遇到 403/429/503 或验证页，冷却 90s→240s→480s→900s，
     并切换 impersonate 指纹再试；三次连续被拒视为本 IP 被封，直接收工。
  5. 断点续跑：每个详情单独落盘 .tmp/gz/details/<id>.json，重跑自动跳过。
  6. 失败留痕：.tmp/gz/failed_ids.json 记录失败 id/原因/时间，
     供 tools/build_data.py 生成 404 兜底（未抓到的作品前端跳 404.html）。

用法：
  python tools/scrape_scrapling.py --limit 200        # 补 200 部
  python tools/scrape_scrapling.py --all              # 补完全部缺口
  python tools/scrape_scrapling.py --stealth --limit 5 # 指纹被识破时的浏览器兜底
  python tools/scrape_scrapling.py --status           # 只看进度
"""
import argparse
import io
import json
import os
import random
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from scrapling.fetchers import FetcherSession, StealthyFetcher  # noqa: E402

import scrape_guazi as gz  # noqa: E402  复用 parse_detail，保持解析口径一致

ROOT = gz.ROOT
LIST_JSON = os.path.join(ROOT, '.tmp', 'gz', 'list.json')
DETAIL_DIR = gz.DETAIL_DIR
FAILED_JSON = os.path.join(ROOT, '.tmp', 'gz', 'failed_ids.json')
STATE_JSON = os.path.join(ROOT, '.tmp', 'gz', 'scrapling_state.json')
BASE = gz.BASE

# 轮换指纹：优先 Windows 桌面 Chrome，混一台 Mac Safari
PROFILES = ['chrome131', 'chrome136', 'chrome124', 'safari184', 'edge101', 'chrome142']

# 被判定为风控拦截的响应特征（只看 <title>，避免正文里出现「验证」就误报）
BLOCK_WORDS = ('访问过于频繁', '访问频繁', '请稍后再试', '安全检测', 'Just a moment',
               'Access denied', '403 Forbidden')


def log(msg):
    sys.stdout.write('[%s] %s\n' % (time.strftime('%H:%M:%S'), msg))
    sys.stdout.flush()


def read_json(path, default):
    if not os.path.exists(path):
        return default
    try:
        return json.load(io.open(path, encoding='utf-8'))
    except ValueError:
        return default


def write_json(path, data):
    tmp = path + '.tmp'
    with io.open(tmp, 'w', encoding='utf-8') as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def load_items():
    items = read_json(LIST_JSON, [])
    items.sort(key=lambda x: -gz.parse_heat(x.get('score')))
    return items


def pending_ids(items):
    out = []
    for it in items:
        p = os.path.join(DETAIL_DIR, '%s.json' % it['srcId'])
        if os.path.exists(p) and os.path.getsize(p) > 200:
            continue
        out.append(it['srcId'])
    return out


def page_title(page):
    try:
        t = page.css('title::text')
        return (t[0] if t else '') or ''
    except Exception:  # noqa: BLE001
        return ''


def is_block(page):
    """状态码优先；200 的响应再核对标题，避免正文含关键词造成误判。"""
    status = getattr(page, 'status', 0)
    if status in (403, 429, 503):
        return True
    if status != 200:
        return False
    title = page_title(page)
    return any(w in title for w in BLOCK_WORDS)


def parse(page, sid):
    """页面 -> 详情 dict。章节为空视为无效（作品不存在或页面残缺）。"""
    html = page.html_content if hasattr(page, 'html_content') else str(page.body)
    d = gz.parse_detail(html, sid)
    if not d.get('chapters'):
        return None
    return d


def scrape_once(ids, min_delay, max_delay, batch, batch_pause, deadline, stealth=False):
    """串行抓取一批 id，返回 (成功数, 失败 id 列表)。"""
    ok, failed = 0, []
    consec_blocks = 0
    profile_idx = 0
    total = len(ids)

    for n, sid in enumerate(ids, 1):
        if time.time() > deadline:
            log('到达时间上限，停止（剩余 %d 部）' % (total - n + 1))
            failed.extend(ids[n - 1:])
            break

        if n > 1 and n % batch == 1:
            pause = random.uniform(*batch_pause)
            log('-- 批次休眠 %.0fs（已处理 %d/%d）--' % (pause, n - 1, total))
            time.sleep(pause)

        url = '%s/comic.php?id=%d' % (BASE, sid)
        resp = None
        try:
            if stealth:
                resp = StealthyFetcher.fetch(url, headless=True, timeout=60000,
                                             network_idle=False)
            else:
                # 复用全局 session：保持 cookie 与连接，避免「新会话式」突增
                resp = SESSION.get(url, timeout=30, retries=0, stealthy_headers=True)
        except Exception as exc:  # noqa: BLE001
            log('  ! %d 请求异常 %s: %s' % (sid, type(exc).__name__, str(exc)[:120]))
            failed.append(sid)
            time.sleep(random.uniform(min_delay, max_delay))
            continue

        if is_block(resp):
            consec_blocks += 1
            cool = [90, 240, 480, 900][min(consec_blocks - 1, 3)] + random.uniform(0, 30)
            log('  ! %d 触发风控(HTTP %s)，冷却 %.0fs（第 %d 次）'
                % (sid, getattr(resp, 'status', '?'), cool, consec_blocks))
            failed.append(sid)
            time.sleep(cool)
            if consec_blocks >= 3:
                log('连续 3 次被拒，判定本 IP 受限，先收工（已存 %d 部）' % ok)
                failed.extend(ids[n:])
                break
            continue

        consec_blocks = 0
        if getattr(resp, 'status', 0) == 404:
            log('  - %d 原站 404（作品已下架）' % sid)
            failed.append(sid)
        else:
            d = parse(resp, sid)
            if d:
                write_json(os.path.join(DETAIL_DIR, '%d.json' % sid), d)
                ok += 1
                if ok % 20 == 0:
                    log('  已补 %d 部（当前 id=%d，共 %d 话）'
                        % (ok, sid, len(d.get('chapters') or [])))
            else:
                log('  - %d 页面无章节（残留/失效）' % sid)
                failed.append(sid)

        time.sleep(random.uniform(min_delay, max_delay))

    return ok, failed


SESSION = None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--all', action='store_true')
    ap.add_argument('--stealth', action='store_true', help='用真实浏览器抓（慢但更抗检测）')
    ap.add_argument('--min-delay', type=float, default=1.8)
    ap.add_argument('--max-delay', type=float, default=3.2)
    ap.add_argument('--batch', type=int, default=35, help='每多少个请求长休一次')
    ap.add_argument('--batch-pause', type=float, nargs=2, default=(20, 30))
    ap.add_argument('--max-minutes', type=float, default=25)
    ap.add_argument('--status', action='store_true')
    args = ap.parse_args()

    items = load_items()
    pend = pending_ids(items)
    log('列表 %d 部 · 已有详情 %d 部 · 待补 %d 部'
        % (len(items), len(items) - len(pend), len(pend)))

    if args.status:
        failed = read_json(FAILED_JSON, {})
        log('失败记录 %d 条' % len(failed))
        return

    if not pend:
        log('没有缺口，收工')
        return

    limit = len(pend) if (args.all or not args.limit) else min(args.limit, len(pend))
    ids = pend[:limit]
    deadline = time.time() + args.max_minutes * 60
    log('本轮目标 %d 部 · 间隔 %.1f~%.1fs · 每 %d 个休 %.0f~%.0fs · 上限 %.0f 分钟%s'
        % (len(ids), args.min_delay, args.max_delay, args.batch,
           args.batch_pause[0], args.batch_pause[1], args.max_minutes,
           ' · 浏览器模式' if args.stealth else ''))

    global SESSION
    started = time.time()
    if args.stealth:
        ok, failed = scrape_once(ids, args.min_delay, args.max_delay, args.batch,
                                 args.batch_pause, deadline, stealth=True)
    else:
        from scrapling.fetchers import FetcherSession as FS
        with FS(impersonate=PROFILES[0], stealthy_headers=True, timeout=30) as sess:
            SESSION = sess
            ok, failed = scrape_once(ids, args.min_delay, args.max_delay, args.batch,
                                     args.batch_pause, deadline)

    # 失败留痕（合并历史记录，成功的移除）
    failed_map = read_json(FAILED_JSON, {})
    for sid in failed:
        failed_map[str(sid)] = {'at': time.strftime('%Y-%m-%d %H:%M:%S'),
                                'reason': 'blocked_or_invalid'}
    for sid in ids:
        if str(sid) not in [str(f) for f in failed] and os.path.exists(
                os.path.join(DETAIL_DIR, '%d.json' % sid)):
            failed_map.pop(str(sid), None)
    write_json(FAILED_JSON, failed_map)
    write_json(STATE_JSON, {
        'last_run': time.strftime('%Y-%m-%d %H:%M:%S'),
        'ok': ok, 'failed': len(failed), 'seconds': round(time.time() - started, 1),
        'stealth': args.stealth,
    })

    remain = len(pending_ids(items))
    log('本轮完成 %d 部 · 失败/跳过 %d 部 · 用时 %.1f 分钟 · 仍缺 %d 部'
        % (ok, len(failed), (time.time() - started) / 60, remain))
    if remain:
        log('继续补抓：python tools/scrape_scrapling.py --all')


if __name__ == '__main__':
    main()
