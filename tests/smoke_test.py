#!/usr/bin/env python3
"""Mars Colony Sim smoke test.
1. Builds the offline snapshot and checks it is self-contained (no external URLs/tags).
2. Engine sanity in Node: autopilot wins, idle colony loses (quick 10-seed check).
3. Headless Chrome playthrough of dist/mars-colony.html (tests/play.mjs via CDP):
   build via mouse, sols advance, launch window + manifest + Starship arrival, storm,
   failure + repair, choice event, save/continue, loss paths, win path.
Usage: python3 tests/smoke_test.py   (or ./run.sh test)
"""
import json, os, re, subprocess, sys, time

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(HERE, "dist", "mars-colony.html")
RES = []


def check(ok, msg, info=""):
    RES.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + msg + (f"  [{info}]" if info else ""), flush=True)


def main():
    print(f"Mars Colony Sim smoke test · {time.strftime('%Y-%m-%d %H:%M %Z')}", flush=True)
    subprocess.run([sys.executable, os.path.join(HERE, "build.py")], check=True, capture_output=True)
    html = open(DIST, encoding="utf-8").read()
    size = os.path.getsize(DIST)
    check(size > 60000, f"offline snapshot built ({size:,} bytes)")
    check(open(os.path.join(HERE, "dist", "index.html"), encoding="utf-8").read() == html, "dist/index.html is an identical copy")
    check(html.count("<style>") == 1 and html.count("<script>") == 3, "CSS + 3 scripts inlined (engine, render, app)")
    bad_tags = re.findall(r'<(?:script|link|img|iframe|source)[^>]+(?:src|href)\s*=\s*["\'](?!data:)[^"\']+', html, re.I)
    check(not bad_tags, "no external script/link/img tags", str(bad_tags[:3]))
    urls = [u for u in re.findall(r"https?://[^\s\"'<>)]+", html) if "w3.org/2000/svg" not in u]
    check(not urls, "no http(s) URLs in the bundle", str(urls[:3]))
    check(not re.search(r"\bfetch\(|XMLHttpRequest|WebSocket|import\(", html), "no fetch/XHR/WebSocket/dynamic import in game code")
    check("window.__MC__" in html and "MarsEngine" in html, "test API + engine present")

    # Engine sanity (Node)
    js = r"""
const E=require(process.argv[1]); const out={autoWins:0,idleLoss:0,n:10};
for(let seed=1;seed<=10;seed++){
  let s=E.newGame({seed,difficulty:'commander'}); while(!s.over&&s.sol<900){E.autopilot(s);E.tick(s);} if(s.over&&s.over.win) out.autoWins++;
  s=E.newGame({seed,difficulty:'commander'}); while(!s.over&&s.sol<900){ if(s.pending)E.choose(s,1); E.tick(s);} if(s.over&&!s.over.win) out.idleLoss++;
}
const a=E.newGame({seed:77}), b=E.newGame({seed:77}); for(let i=0;i<120;i++){E.autopilot(a);E.tick(a);E.autopilot(b);E.tick(b);}
out.deterministic = JSON.stringify(a)===JSON.stringify(b);
console.log(JSON.stringify(out));"""
    r = subprocess.run(["node", "-e", js, os.path.join(HERE, "web", "engine.js")], capture_output=True, text=True, timeout=120)
    try:
        o = json.loads(r.stdout.strip().splitlines()[-1])
        check(o["autoWins"] >= 9, f"engine: autopilot wins Commander ({o['autoWins']}/10 seeds)")
        check(o["idleLoss"] == 10, f"engine: idle colony always fails ({o['idleLoss']}/10 seeds)")
        check(o["deterministic"], "engine: same seed + same moves = same game (deterministic)")
    except Exception as e:  # noqa: BLE001
        check(False, "engine sanity ran", (r.stdout + r.stderr)[-400:] or str(e))

    # Browser playthrough
    print("headless Chrome playthrough (tests/play.mjs) ...", flush=True)
    t0 = time.time()
    r = subprocess.run(["node", "--experimental-websocket", os.path.join(HERE, "tests", "play.mjs")],
                       capture_output=True, text=True, timeout=240, cwd=HERE)
    out = None
    for line in reversed(r.stdout.strip().splitlines()):
        if line.strip().startswith("{"):
            try:
                out = json.loads(line)
            except Exception:  # noqa: BLE001
                pass
            break
    if not out:
        check(False, "play.mjs produced JSON", (r.stdout + r.stderr)[-600:])
    else:
        for c in out["checks"]:
            check(c["ok"], "browser: " + c["msg"], c.get("info", "")[:160])
    print(f"     playthrough took {time.time() - t0:.1f}s", flush=True)

    shots = os.path.join(HERE, "screenshots")
    if os.path.isdir(shots):
        pngs = sorted(f for f in os.listdir(shots) if f.endswith(".png"))
        if pngs:
            best = [f for f in pngs if f.startswith("00-best-")]
            check(len(best) == 1, f"hero screenshot present ({len(pngs)} shots)", ",".join(best) or "none")

    n, p = len(RES), sum(RES)
    print(f"RESULT: {p}/{n} checks passed" + ("" if p == n else f" ({n - p} FAILED)"), flush=True)
    sys.exit(0 if p == n else 1)


if __name__ == "__main__":
    main()
