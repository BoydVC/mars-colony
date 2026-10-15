#!/usr/bin/env python3
"""Capture 1280x800 gameplay screenshots into screenshots/ via headless Chrome CDP,
then copy the hero shot to screenshots/00-best-<name>.png.
Usage: python3 tests/shots.py   (or ./run.sh shots)
"""
import os, shutil, subprocess, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(HERE, "screenshots")
BEST = "04-starship-landing.png"
os.makedirs(SHOTS, exist_ok=True)
for f in os.listdir(SHOTS):
    if f.endswith(".png"):
        os.remove(os.path.join(SHOTS, f))
subprocess.run([sys.executable, os.path.join(HERE, "build.py")], check=True)
r = subprocess.run(["node", "--experimental-websocket", os.path.join(HERE, "tests", "_shots_run.mjs")],
                   cwd=HERE, capture_output=True, text=True, timeout=240)
print(r.stdout)
if r.returncode != 0:
    print(r.stderr[-800:], file=sys.stderr)
    sys.exit(r.returncode)
src = os.path.join(SHOTS, BEST)
if os.path.isfile(src):
    shutil.copyfile(src, os.path.join(SHOTS, "00-best-" + BEST.split("-", 1)[1]))
for name in sorted(os.listdir(SHOTS)):
    if name.endswith(".png"):
        print(f"ok  {os.path.join(SHOTS, name)} ({os.path.getsize(os.path.join(SHOTS, name)):,} bytes)")
