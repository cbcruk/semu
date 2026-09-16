"""Convert the crawl cache (.cache/pages + .cache/graph.json) into a Markdown tree.

Usage: python convert.py [DEST]   (default: <repo>/alfred-manual)

Each page is placed under the page that first linked to it. Pages with children
become a directory with README.md; leaf pages become NN-title.md.
The images/ directory in DEST (see localize_images.py) is preserved.
"""
import json
import os
import re
import shutil
import sys
from collections import Counter
from pathlib import Path

from bs4 import BeautifulSoup, NavigableString, Tag

from crawl import BASE, GRAPH, PAGES, norm

DEST = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[2] / "alfred-manual"

graph = json.loads(GRAPH.read_text())
unknown = Counter()

# key(as linked) -> page id
alias = {}
for pid, g in graph.items():
    alias[pid] = pid
    k = norm(g["url"])
    alias.setdefault(k, pid)
root_id = alias[""]


SKIP_PROP_TYPES = {"title", "created_time", "last_edited_time", "created_by", "last_edited_by", "person", "status", "date", "relation", "rollup", "formula", "button", "verification"}


def rich(v):
    out = []
    for seg in v or []:
        t = seg[0]
        link = next((a[1] for a in (seg[1] if len(seg) > 1 else []) if a and a[0] == "a"), None)
        out.append(f"[{t}]({link})" if link and link != t else (f"<{t}>" if link else t))
    return "".join(out).strip()


def page_props(pid):
    """Visible, human-meaningful database properties of a page: [(name, value)]."""
    h = (PAGES / graph[pid]["file"]).read_text()
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', h, re.S)
    if not m:
        return []
    pp = json.loads(m.group(1))["props"]["pageProps"]
    blk = pp.get("recordMap", {}).get("block", {}).get(pp.get("pageID"), {}).get("value", {})
    blk = blk.get("value", blk)
    schema = (pp.get("publicPageData") or {}).get("collectionSchema") or {}
    fmt = (pp.get("publicPageData") or {}).get("collectionFormat") or {}
    order = [x["property"] for x in fmt.get("collection_page_properties", []) if x.get("visible")] or list(schema)
    res = []
    for key in order:
        sc = schema.get(key)
        if not sc or sc.get("type") in SKIP_PROP_TYPES:
            continue
        val = rich((blk.get("properties") or {}).get(key))
        if val:
            res.append((sc["name"], val))
    return res


def btype(el):
    for c in el.get("class", []) if isinstance(el, Tag) else []:
        m = re.fullmatch(r"notion-(.+)-block", c)
        if m:
            return m.group(1)
    return None


def owner(el):
    """Nearest ancestor block of el (excluding el)."""
    p = el.parent
    while p is not None and not btype(p):
        p = p.parent
    return p


def child_blocks(el):
    return [d for d in el.find_all(True) if btype(d) and owner(d) is el]


# ---------- inline ----------

def link_target(href):
    k = norm(href)
    if k is None:
        return href
    pid = alias.get(k)
    if pid:
        return f"oopy:{pid}"
    return BASE + "/" + k if not href.startswith("http") else href


def inline(node, in_link=False):
    out = []
    for c in node.children:
        if isinstance(c, NavigableString):
            if c.__class__.__name__ in ("Comment",):
                continue
            out.append(str(c))
            continue
        if not isinstance(c, Tag):
            continue
        if btype(c):  # nested block – handled elsewhere
            continue
        if c.name in ("script", "style", "svg"):
            continue
        if c.name == "br":
            out.append("  \n")
            continue
        if c.name == "img":
            continue  # inline custom emoji icons
        if c.name == "a" and c.get("href") and not in_link:
            t = inline(c, True).strip()
            href = link_target(c["href"])
            if not t and href.startswith("oopy:"):
                t = graph.get(href[5:], {}).get("title", "")
            out.append(f"[{t or href}]({href})")
            continue
        t = inline(c, in_link)
        st = (c.get("style") or "").replace(" ", "")
        if t.strip():
            lead = t[: len(t) - len(t.lstrip())]
            trail = t[len(t.rstrip()):]
            core = t.strip()
            if c.name == "code" or "monospace" in st or "SFMono" in st:
                core = f"`{core}`"
            if "line-through" in st or c.name in ("s", "del"):
                core = f"~~{core}~~"
            if "font-style:italic" in st or c.name in ("em", "i"):
                core = f"*{core}*"
            if re.search(r"font-weight:(600|700|bold)", st) or c.name in ("b", "strong"):
                core = f"**{core}**"
            t = lead + core + trail
        out.append(t)
    return "".join(out)


def own_text(el):
    for d in el.find_all(True):
        if btype(d):
            if owner(d) is el:
                continue
        if owner(d) is not el:
            continue
        if d.get("data-root") == "true" or d.has_attr("placeholder") or d.name in ("h1", "h2", "h3", "h4"):
            return merge_links(clean(inline(d)))
    return ""


def merge_links(s):
    pat = re.compile(r"\[([^\]]*)\]\(([^)\s]+)\)\[([^\]]*)\]\(\2\)")
    while True:
        n = pat.sub(lambda m: f"[{m.group(1)}{m.group(3)}]({m.group(2)})", s)
        if n == s:
            return s
        s = n


def clean(s):
    s = s.replace("\u00a0", " ")
    s = re.sub(r"\*\*\s*\*\*", "", s)
    s = re.sub(r"\*\*\*\*", "", s)
    return s.strip()


# ---------- blocks ----------

def img_src(img):
    return img.get("src") or img.get("data-src") or ""


def render_children(el):
    lines = []
    for ch in child_blocks(el):
        lines += render(ch)
    return lines


def indent(lines, n):
    return [("  " * n + l) if l.strip() else l for l in lines]


def render(el):
    t = btype(el)
    txt = own_text(el)
    kids = lambda: render_children(el)  # noqa: E731
    if t == "text":
        return ([txt, ""] if txt else []) + kids()
    if t in ("header", "sub_header", "sub_sub_header", "header_4"):
        lvl = {"header": 2, "sub_header": 3, "sub_sub_header": 4, "header_4": 5}[t]
        txt = txt.replace("**", "")
        return [f"{'#' * lvl} {txt}", ""] + kids() if txt else kids()
    if t == "toggle" and el.get_text(" ", strip=True).startswith("oppy hide"):
        return []  # Oopy: content hidden from site visitors
    if t in ("bulleted_list", "numbered_list", "to_do", "toggle"):
        if t == "numbered_list":
            mark = "1."
        elif t == "to_do":
            chk = el.find(attrs={"aria-checked": "true"}) or el.select_one("svg.checkboxSquare, svg.check")
            mark = "- [x]" if chk else "- [ ]"
        else:
            mark = "-"
        sub = kids()
        txt = txt.replace("\n", "\n  ")
        while sub and not sub[-1].strip():
            sub.pop()
        if sub and any(l.lstrip().startswith(("|", "![", "[![", ">", "```")) for l in sub):
            sub = [""] + sub  # block content needs a blank line to render inside the item
        res = [f"{mark} {txt}"] + indent(sub, 1)
        return res + [""]
    if t == "quote":
        body = [txt] + kids()
        return [("> " + l) if l else ">" for l in body] + [""]
    if t == "callout":
        icon = ""
        ic = el.select_one("[role=img], .notion-emoji")
        if ic and ic.get_text(strip=True):
            icon = ic.get_text(strip=True) + " "
        body = kids()
        while body and not body[-1].strip():
            body.pop()
        if body:
            body[0] = icon + body[0]
        return [("> " + l) if l.strip() else ">" for l in body] + [""]
    if t == "divider":
        return ["---", ""]
    if t == "image":
        img = el.find("img")
        if not img:
            return []
        cap = ""
        capel = el.select_one("figcaption, [placeholder='Write a caption']")
        if capel:
            cap = clean(inline(capel))
        a = img.find_parent("a")
        src = img_src(img)
        if a and a.get("href"):
            href = link_target(a["href"])
            title = cap or (graph.get(href[5:], {}).get("title", "") if href.startswith("oopy:") else "")
            return [f"[![{title}]({src})]({href})" + (f" — {title}" if title and href.startswith("oopy:") else ""), ""]
        return [f"![{cap}]({src})", ""] + ([f"*{cap}*", ""] if cap else [])
    if t in ("column_list", "column", "transclusion_container", "transclusion_reference", "synced_block"):
        return kids()
    if t == "code":
        code = el.select_one("code") or el
        return ["```", code.get_text().rstrip("\n"), "```", ""]
    if t == "equation":
        return ["$$", el.get_text(strip=True), "$$", ""]
    if t == "table":
        rows = []
        for tr in el.find_all("tr"):
            rows.append([clean(inline(td)).replace("|", "\\|").replace("\n", " ") for td in tr.find_all(["td", "th"])])
        if not rows:
            return []
        w = max(len(r) for r in rows)
        rows = [r + [""] * (w - len(r)) for r in rows]
        md = ["| " + " | ".join(rows[0]) + " |", "|" + " --- |" * w]
        md += ["| " + " | ".join(r) + " |" for r in rows[1:]]
        return md + [""]
    if t in ("page", "alias"):
        a = el.find("a", href=True)
        href = link_target(a["href"]) if a else ""
        title = clean(el.get_text(" ", strip=True))
        if href.startswith("oopy:"):
            title = graph.get(href[5:], {}).get("title") or title
        return [f"- 📄 [{title}]({href})", ""]
    if t in ("bookmark", "embed", "video", "file", "pdf", "audio", "link_preview"):
        a = el.find("a", href=True)
        src = a["href"] if a else ((el.find(["iframe", "video", "source"]) or {}).get("src") if el.find(["iframe", "video", "source"]) else "")
        label = clean(el.get_text(" ", strip=True)) or src
        return [f"[{label}]({src})", ""] if src else ([label, ""] if label else [])
    if t in ("collection_view", "collection_view_page"):
        return render_collection(el)
    # table_of_contents, breadcrumb etc.
    if t in ("table_of_contents", "breadcrumb"):
        return []
    unknown[t] += 1
    return ([txt, ""] if txt else []) + kids()


def render_collection(el):
    lines = []
    seen = set()
    for a in el.find_all("a", href=True):
        href = link_target(a["href"])
        if href in seen:
            continue
        seen.add(href)
        t = graph.get(href[5:], {}).get("title") if href.startswith("oopy:") else None
        t = t or clean(a.get_text(" ", strip=True)) or href
        extra = ""
        if href.startswith("oopy:") and href[5:] in graph:
            pr = [v for n, v in page_props(href[5:]) if not v.startswith(("http", "[", "<"))]
            extra = " — " + " · ".join(pr) if pr else ""
        lines.append(f"- [{t}]({href}){extra}")
    if not lines:
        tx = clean(el.get_text(" ", strip=True))
        return [tx, ""] if tx else []
    return lines + [""]


def page_markdown(pid):
    g = graph[pid]
    s = BeautifulSoup((PAGES / g["file"]).read_text(), "html.parser")
    pc = s.select_one(".notion-page-content")
    lines = [f"# {g['title']}", "", f"> 원문: {g['url']}", ""]
    if pc:
        for ch in [d for d in pc.find_all(True) if btype(d) and not pc_contains_block_ancestor(d, pc)]:
            lines += render(ch)
    md = "\n".join(lines)
    if len(lines) <= 4:
        pr = page_props(pid)
        if pr:
            esc = lambda v: v.replace("|", "\\|")  # noqa: E731
            md += "\n| 항목 | 내용 |\n| --- | --- |\n" + "\n".join("| %s | %s |" % (n, esc(v)) for n, v in pr) + "\n"
    md = re.sub(r"\n{3,}", "\n\n", md)
    md = re.sub(r"(?m)^(\s*(?:- |1\. ).*)\n\n(?=\s*(?:- |1\. ))", r"\1\n", md)
    md = re.sub(r"(?m)^(\s*(?:- |1\. ).*)\n\n(?=\s*(?:- |1\. ))", r"\1\n", md)
    return md.strip() + "\n"


def pc_contains_block_ancestor(d, pc):
    p = d.parent
    while p is not None and p is not pc:
        if btype(p):
            return True
        p = p.parent
    return False


# ---------- tree layout ----------

def slug(t):
    t = re.sub(r"[^\w.\-·]", " ", t)
    t = re.sub(r"[\s-]+", "-", t.strip())
    return t[:60] or "untitled"


def build():
    children = {pid: [] for pid in graph}
    for pid, g in graph.items():
        if pid == root_id or "error" in g or g.get("status") != 200:
            continue
        par = alias.get(g["parent"], root_id) if g["parent"] is not None else root_id
        children[par].append(pid)
    # order children by appearance in parent's links
    for par, lst in children.items():
        order = {alias.get(k): i for i, k in enumerate(graph[par].get("links", []))}
        lst.sort(key=lambda c: order.get(c, 1e9))

    paths = {}

    def assign(pid, dirpath, idx):
        name = f"{idx:02d}-{slug(graph[pid]['title'])}"
        if children[pid]:
            d = dirpath / name
            paths[pid] = d / "README.md"
            for i, c in enumerate(children[pid], 1):
                assign(c, d, i)
        else:
            paths[pid] = dirpath / f"{name}.md"

    paths[root_id] = Path("README.md")
    for i, c in enumerate(children[root_id], 1):
        assign(c, Path("."), i)

    if DEST.exists():
        for p in DEST.iterdir():
            if p.name != "images":
                shutil.rmtree(p) if p.is_dir() else p.unlink()
    for pid in [p for p in graph if p not in paths]:
        alias.pop(pid, None)
    for pid, rel in paths.items():
        md = page_markdown(pid)

        def sub(m):
            tgt = m.group(1)
            if tgt not in paths:
                return graph.get(tgt, {}).get("url", BASE + "/" + tgt)
            r = os.path.relpath(paths[tgt], rel.parent)
            return r.replace(" ", "%20")

        md = re.sub(r"oopy:([0-9a-f-]{36})", sub, md)
        if children[pid] and pid != root_id:
            md += "\n## 하위 페이지\n\n" + "\n".join(
                f"- [{graph[c]['title']}]({os.path.relpath(paths[c], rel.parent)})" for c in children[pid]) + "\n"
        if pid == root_id:
            md += "\n---\n\n## 전체 문서 트리\n\n" + "\n".join(tree_lines(root_id, children, paths, 0)) + "\n"
        out = DEST / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(md)
    print("pages:", len(paths), "unknown blocks:", dict(unknown))


def tree_lines(pid, children, paths, depth):
    res = []
    for c in children[pid]:
        res.append("  " * depth + f"- [{graph[c]['title']}]({paths[c].as_posix()})")
        res += tree_lines(c, children, paths, depth + 1)
    return res


if __name__ == "__main__":
    build()
