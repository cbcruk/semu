"""Download remote images referenced by the Markdown tree and relink them locally.

Usage: python localize_images.py [ROOT]   (default: <repo>/alfred-manual)

Images are saved to ROOT/images/, named by the CDN content hash so identical
images are stored once. URL -> filename is cached in .cache/imgmap.json.
"""
import hashlib
import json
import os
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from crawl import CACHE

ROOT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[2] / "alfred-manual"
IMG = ROOT / "images"
MAP = CACHE / "imgmap.json"
EXT = {"image/webp": ".webp", "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/svg+xml": ".svg"}
PAT = re.compile(r"(!\[[^\]]*\]\()(https://oopy\.lazyrockets\.com/[^)\s]+)(\))")


def fetch(url, mapping):
    if url in mapping and (IMG / mapping[url]).exists():
        return mapping[url], None
    err = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
                ctype = r.headers.get_content_type()
                final = r.geturl()
            if not ctype.startswith("image/"):
                raise ValueError(f"not an image: {ctype}")
            m = re.search(r"/([0-9a-f]{40,64})\.", final)
            name = (m.group(1) if m else hashlib.sha256(data).hexdigest())[:20] + EXT.get(ctype, ".bin")
            (IMG / name).write_bytes(data)
            return name, None
        except Exception as e:
            err = e
            time.sleep(2 * (attempt + 1))
    return None, str(err)


def main():
    IMG.mkdir(parents=True, exist_ok=True)
    mapping = json.loads(MAP.read_text()) if MAP.exists() else {}
    mds = list(ROOT.rglob("*.md"))
    urls = sorted({m.group(2) for f in mds for m in PAT.finditer(f.read_text())})

    fails = []
    with ThreadPoolExecutor(6) as ex:
        for i, (url, (name, err)) in enumerate(zip(urls, ex.map(lambda u: fetch(u, mapping), urls)), 1):
            if name:
                mapping[url] = name
            else:
                fails.append((url, err))
            if i % 50 == 0:
                print(f"{i}/{len(urls)}", flush=True)
    MAP.parent.mkdir(parents=True, exist_ok=True)
    MAP.write_text(json.dumps(mapping, indent=1))

    for f in mds:
        s = f.read_text()
        rel = os.path.relpath(IMG, f.parent)
        n = PAT.sub(lambda m: m.group(1) + (f"{rel}/{mapping[m.group(2)]}" if m.group(2) in mapping else m.group(2)) + m.group(3), s)
        if n != s:
            f.write_text(n)
    print(f"images: {len(urls)} referenced, {len(fails)} failed")
    for url, err in fails:
        print("FAIL", err, url)


if __name__ == "__main__":
    main()
