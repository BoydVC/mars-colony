#!/usr/bin/env python3
"""Inline web/ (CSS + all <script src>) into dist/mars-colony.html (offline single file)."""
import os, re
HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, "web")
DIST = os.path.join(HERE, "dist")
os.makedirs(DIST, exist_ok=True)
html = open(os.path.join(WEB, "index.html"), encoding="utf-8").read()


def read(name):
    return open(os.path.join(WEB, name), encoding="utf-8").read()


# Callable replacements so re.sub never reinterprets backslashes inside CSS/JS.
out = re.sub(r'<link\s+rel="stylesheet"\s+href="([\w.-]+\.css)"\s*/?>',
             lambda m: "<style>\n" + read(m.group(1)) + "\n</style>", html)
out = re.sub(r'<script\s+src="([\w.-]+\.js)"\s*>\s*</script>',
             lambda m: "<script>\n" + read(m.group(1)).replace("</script", "<\\/script") + "\n</script>", out)
path = os.path.join(DIST, "mars-colony.html")
open(path, "w", encoding="utf-8").write(out)
open(os.path.join(DIST, "index.html"), "w", encoding="utf-8").write(out)
print(f"wrote {path} ({os.path.getsize(path):,} bytes)")
