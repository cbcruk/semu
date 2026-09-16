"""Crawl support.alfred.kr (Oopy/Notion) breadth-first with Playwright.

Saves each rendered page to .cache/pages/<page-id>.html and the link graph to
.cache/graph.json ({page id: {url, status, title, parent, links, file}}).
"""
import json
import re
import sys
import time
from collections import deque
from pathlib import Path
from urllib.parse import urlparse

BASE = "https://support.alfred.kr"
CACHE = Path(__file__).parent / ".cache"
PAGES = CACHE / "pages"
GRAPH = CACHE / "graph.json"
UUID = re.compile(r"([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})", re.I)

# "더 보기" buttons on database views
LOAD_MORE_JS = """
() => {
  const btns = [...document.querySelectorAll('.notion-page-content div, .notion-page-content button')]
    .filter(e => e.children.length === 0 && /^(더 보기|더보기|Load more|Show more)/.test((e.innerText || '').trim()));
  btns.forEach(e => e.click());
  return btns.length;
}
"""

# Links in the page body, ignoring toggles Oopy hides from visitors ("oppy hide :")
LINKS_JS = """
() => {
  const hidden = [...document.querySelectorAll('.notion-toggle-block')]
    .filter(t => /^oppy hide/.test((t.innerText || '').trim()));
  return [...document.querySelectorAll('.notion-page-content a[href], .notion-page-block a[href]')]
    .filter(a => !hidden.some(t => t.contains(a)))
    .map(a => a.getAttribute('href'));
}
"""


def norm(href):
    """Canonical page key for a link on this site ("" for the root), else None."""
    if not href:
        return None
    u = urlparse(href)
    if u.scheme and u.netloc and u.netloc not in ("support.alfred.kr", "www.support.alfred.kr"):
        return None
    if u.scheme not in ("", "http", "https"):
        return None
    m = UUID.search(u.path)
    if m:
        return "-".join(m.groups()).lower()
    return u.path.strip("/")


def expand_toggles(pg):
    """Open every collapsed toggle, including ones nested inside opened toggles."""
    for _ in range(10):
        btns = pg.locator('.notion-page-content [aria-label="펼치기"]')
        if not btns.count():
            return
        for _ in range(btns.count()):
            try:
                btns.nth(0).click(timeout=3000)
            except Exception:
                return
            pg.wait_for_timeout(150)
        pg.wait_for_timeout(800)


def main():
    from playwright.sync_api import sync_playwright

    PAGES.mkdir(parents=True, exist_ok=True)
    graph = {}
    queue = deque([("", None)])
    queued = {""}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        pg = browser.new_context(viewport={"width": 1400, "height": 1000}, locale="ko-KR").new_page()
        while queue:
            key, parent = queue.popleft()
            url = f"{BASE}/{key}"
            for attempt in range(3):
                try:
                    resp = pg.goto(url, wait_until="networkidle", timeout=60000)
                    break
                except Exception as e:
                    print("retry", url, e, file=sys.stderr)
                    time.sleep(3)
            else:
                graph[key] = {"url": url, "parent": parent, "error": "load failed"}
                continue
            pid = pg.evaluate("() => window.__NEXT_DATA__?.props?.pageProps?.pageID || null") or key
            if pid in graph:
                continue
            for _ in range(6):  # trigger lazy-loaded blocks
                pg.mouse.wheel(0, 3000)
                pg.wait_for_timeout(250)
            expand_toggles(pg)
            for _ in range(5):
                if not pg.evaluate(LOAD_MORE_JS):
                    break
                pg.wait_for_timeout(800)
            pg.wait_for_timeout(500)

            title = pg.evaluate("() => (document.querySelector('.notion-page-block h1')?.innerText || document.title).trim()")
            (PAGES / f"{pid}.html").write_text(pg.content())
            links = []
            for href in pg.evaluate(LINKS_JS):
                k = norm(href)
                if k is None or k in (key, pid) or k in links:
                    continue
                links.append(k)
                if k not in queued:
                    queued.add(k)
                    queue.append((k, pid))
            status = resp.status if resp else None
            graph[pid] = {"url": url, "status": status, "title": title, "parent": parent, "links": links, "file": f"{pid}.html"}
            print(f"[{len(graph)}] queue={len(queue)} {status} {title}", flush=True)
            GRAPH.write_text(json.dumps(graph, ensure_ascii=False, indent=1))
            time.sleep(0.5)
        browser.close()


if __name__ == "__main__":
    main()
