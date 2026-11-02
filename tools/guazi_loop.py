# -*- coding: utf-8 -*-
"""
详情补全守护进程。【已弃用，改用 tools/scrape_scrapling.py】

弃用原因：本脚本调用的 scrape_guazi.py 走 urllib，TLS 指纹与 UA 对不上，
站点一轮就判定为爬虫并 403，靠长时间静默也恢复不了几个。
Scrapling 版（curl_cffi 指纹伪装 + 分级退避 + 断点续跑）同样地址稳定返回 200，
补充量从「一轮 40 部」提升到「一轮 200 部以上」。保留此文件仅作历史参考。

瓜子漫画对同一 IP 有频率限制：连续抓 150~200 个详情后会开始返回 403，
静默一段时间才会恢复。手动盯着不现实，所以交给这个脚本：

    循环探测 → 恢复就小批量补（1 并发 + 1.5s 间隔）→ 又 403 就退避等待
    每轮结束重建数据，随时停下都不影响已抓到的部分。

用法：
    python -u tools/guazi_loop.py --rounds 12 --interval 180 --batch 40
"""
import argparse
import io
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = sys.executable
BASE = 'https://www.guazimanhua.com'
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36')


def log(msg):
    print(time.strftime('[%H:%M:%S] ') + msg, flush=True)


def probe(comic_id):
    """返回 True 表示详情页可访问（未被限流）"""
    try:
        req = urllib.request.Request('%s/comic.php?id=%d' % (BASE, comic_id),
                                     headers={'User-Agent': UA, 'Referer': BASE + '/'})
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.status == 200 and len(resp.read(2000)) > 500
    except urllib.error.HTTPError as exc:
        return exc.code == 200
    except Exception:  # noqa: BLE001
        return False


def missing_ids():
    lst = json.load(io.open(os.path.join(ROOT, '.tmp', 'gz', 'list.json'), encoding='utf-8'))
    det_dir = os.path.join(ROOT, '.tmp', 'gz', 'details')
    done = {f[:-5] for f in os.listdir(det_dir) if f.endswith('.json')} if os.path.isdir(det_dir) else set()
    return [x['srcId'] for x in lst if str(x['srcId']) not in done]


def run(*args):
    subprocess.run([PY] + list(args), cwd=ROOT, check=False)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--rounds', type=int, default=12)
    ap.add_argument('--interval', type=int, default=180)
    ap.add_argument('--batch', type=int, default=40)
    args = ap.parse_args()

    for r in range(1, args.rounds + 1):
        todo = missing_ids()
        if not todo:
            log('详情已全部补齐，退出')
            break
        log('第 %d 轮 · 还差 %d 部' % (r, len(todo)))
        if not probe(todo[0]):
            log('  仍被限流，%d 秒后再试' % args.interval)
            time.sleep(args.interval)
            continue

        log('  站点已恢复，补 %d 部（单线程 + 1.5s 间隔）' % min(args.batch, len(todo)))
        run('-u', 'tools/scrape_guazi.py', '--detail', str(args.batch),
            '--workers', '1', '--delay', '1.5')
        run('tools/scrape_guazi.py', '--build')
        run('tools/build_data.py')
        time.sleep(args.interval)

    log('循环结束')


if __name__ == '__main__':
    main()
