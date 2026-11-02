"""Scrapling 0.5 快速上手示例

运行：
    C:\\Users\\余音\\.workbuddy\\binaries\\python\\envs\\default\\Scripts\\python.exe scrapling_demo.py

两种抓取器，按页面类型选择：
    Fetcher          -> 纯 HTTP 请求，速度快、开销小，适合服务端直出 HTML 的站点
    StealthyFetcher  -> 启动真实浏览器，能执行 JS、绕过基础指纹检测，速度慢 10-50 倍

注意：0.5 版本已移除旧的 DynamicFetcher，浏览器抓取统一走 StealthyFetcher。
"""

from scrapling.fetchers import Fetcher, StealthyFetcher


def demo_http(url: str = "https://www.baidu.com") -> None:
    """纯 HTTP 抓取：0.3 秒级，适合批量翻列表页。"""
    page = Fetcher.get(url, timeout=25)

    print(f"[HTTP] 状态码 {page.status}，最终地址 {page.url}")
    print(f"[HTTP] 标题：{page.css('title::text')[0]}")

    links = page.css("a")
    print(f"[HTTP] 页内链接 {len(links)} 个，前 3 个：")
    for a in links[:3]:
        href = a.attrib.get("href", "")
        text = " ".join(a.get_all_text().split())[:20]
        print(f"       {text or '(无文字)'} -> {href[:60]}")

    # 提取为 Markdown，便于喂给模型或存成文档
    print(f"[HTTP] Markdown 片段：{page.markdown()[:80].replace(chr(10), ' ')}")


def demo_browser(url: str = "https://www.baidu.com") -> None:
    """浏览器抓取：能执行 JavaScript，首次启动约 15 秒。"""
    page = StealthyFetcher.fetch(url, headless=True, timeout=60000)
    print(f"[浏览器] 状态码 {page.status}，标题：{page.css('title::text')[0]}")


if __name__ == "__main__":
    demo_http()
    print("-" * 60)
    demo_browser()
