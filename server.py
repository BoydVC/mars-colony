"""Mars Colony Sim server on 127.0.0.1:4353 (Python stdlib only)."""
import http.server, os, socketserver
HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("MC_PORT", "4353"))
ROUTES = {"/": "dist/mars-colony.html", "/index.html": "dist/mars-colony.html", "/mars-colony.html": "dist/mars-colony.html"}


class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        p = self.path.split("?")[0]
        if p == "/healthz":
            return self._send(200, b'{"ok":true,"game":"mars-colony"}', "application/json")
        rel = ROUTES.get(p)
        if not rel and p.startswith("/web/") and ".." not in p:
            rel = p.lstrip("/")  # dev: serve unbundled sources
        if not rel:
            return self._send(404, b"not found", "text/plain")
        path = os.path.join(HERE, rel)
        if not os.path.isfile(path):
            return self._send(404, b"not found", "text/plain")
        ct = {"css": "text/css", "js": "application/javascript"}.get(path.rsplit(".", 1)[-1], "text/html")
        self._send(200, open(path, "rb").read(), ct + "; charset=utf-8")

    def _send(self, code, body, ct):
        self.send_response(code)
        self.send_header("Content-Type", ct)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


class S(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    print(f"Mars Colony Sim on http://127.0.0.1:{PORT}", flush=True)
    S(("127.0.0.1", PORT), H).serve_forever()
