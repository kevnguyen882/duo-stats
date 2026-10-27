"""The web server: serves the page and the small JSON API it talks to.

Normally it only listens on this Mac. With --lan, other computers on the network can open the page too: they can
look at everything but change nothing (see access.py), and may need a PIN first.
"""

from __future__ import annotations

import json
import mimetypes
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import config
from .access import Access
from .errors import DuoStatsError

STATIC_TYPES = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
                ".js": "text/javascript; charset=utf-8", ".png": "image/png"}
HOST_ONLY = ("/api/key", "/api/forget", "/api/settings", "/api/open")   # changes things: only from this Mac


class Handler(BaseHTTPRequestHandler):
    app = None      # set by make_server
    access = None   # an Access, set by make_server

    def log_message(self, *args):
        pass

    @property
    def viewer(self) -> bool:
        """True for another computer on the network (view only); False for this Mac."""
        return not self.access.is_host(self.client_address[0])

    # ---- responses ----
    def send(self, code: int, body, content_type: str = "application/json", cache: str = "no-store", headers=None):
        data = body if isinstance(body, bytes) else json.dumps(body).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", cache)
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(data)

    def send_static(self, relative: str):
        path = (config.WEB_DIR / relative).resolve()
        if config.WEB_DIR.resolve() not in path.parents or not path.is_file():
            return self.send(404, {"error": "Not found"})
        ctype = STATIC_TYPES.get(path.suffix) or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        # pictures (the logo, badge borders) are big and rarely change, so browsers may keep them for an hour;
        # code and styles are always fetched fresh
        cache = "max-age=3600" if relative.startswith("img/") else "no-store"
        self.send(200, path.read_bytes(), ctype, cache=cache)

    def allowed(self, path: str) -> bool:
        """Checks every request; sends the refusal (or the PIN page) itself and returns False when it's not allowed."""
        if not self.access.host_allowed(self.headers.get("Host", "")):
            self.send(403, {"error": "This address isn't one of this Mac's names."})
            return False
        if self.viewer and path != "/api/pin" and not path.startswith("/img/") and not self.access.unlocked(self.headers.get("Cookie", "")):
            if path in ("/", "/index.html", "/utopia", "/ducktopia"):
                self.send_static("pin.html")
            else:
                self.send(401, {"error": "Enter the PIN first."})
            return False
        return True

    # ---- routes ----
    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(url.query)
        app = self.app
        try:
            if not self.allowed(url.path):
                return
            if url.path in ("/", "/index.html"):
                return self.send_static("index.html")
            if url.path in ("/ducktopia", "/utopia"):   # Ducktopia, the idle game (/utopia: its first name)
                return self.send_static("utopia.html")
            if url.path.startswith(("/js/", "/style.css", "/utopia.css", "/img/")):
                return self.send_static(url.path.lstrip("/"))
            if url.path == "/api/status":
                return self.send(200, {**app.status(), "viewer": self.viewer})
            if url.path == "/api/settings":
                return self.send(200, app.settings())
            if url.path == "/api/live":
                return self.send(200, app.live_status(query.get("id", [])))
            if url.path == "/api/champions":
                return self.send(200, app.champions())
            if url.path == "/api/match":
                game_id = (query.get("id") or [""])[0]
                if not game_id.isdigit():
                    return self.send(400, {"error": "No such game."})
                return self.send(200, app.match(game_id))
            if url.path == "/api/showcase":
                return self.send(200, app.showcases())
            if url.path == "/api/utopia":
                return self.send(200, app.utopia.state(self.viewer))
            if url.path == "/api/augments":
                return self.send(200, app.augments.for_page())
            if url.path.startswith("/api/augicon/"):
                data = app.augments.icon(url.path.rsplit("/", 1)[-1])
                return self.send(200, data, "image/png", "max-age=86400") if data else self.send(404, {"error": "No icon"})
            self.send(404, {"error": "Not found"})
        except DuoStatsError as e:
            self.send(502, {"error": str(e)})
        except Exception as e:
            self.send(500, {"error": f"Unexpected error: {e}"})

    def do_POST(self):
        app = self.app
        try:
            if not self.allowed(self.path):
                return
            length = int(self.headers.get("Content-Length", 0) or 0)
            body = json.loads(self.rfile.read(length) or b"{}")
            if self.path == "/api/pin":
                ok, result = self.access.try_pin(self.client_address[0], body.get("pin", ""))
                return self.send(200, {"ok": True}, headers={"Set-Cookie": result}) if ok else self.send(403, {"error": result})
            if self.viewer and self.path in HOST_ONLY:
                return self.send(403, {"error": "Only the Mac running Duo Stats can change this."})
            routes = {
                "/api/key": lambda: {"ok": True, "saved": app.set_key(body.get("key", ""), bool(body.get("remember")))},
                "/api/forget": lambda: (app.forget_key(), {"ok": True})[1],
                "/api/settings": lambda: app.save_settings(body),
                "/api/stats": lambda: app.load_stats(body, save=not self.viewer),   # viewers see the host's settings
                "/api/srank": lambda: app.s_rank(body),
                "/api/showcase": lambda: app.save_showcase(body, self.viewer),
                "/api/utopia": lambda: app.utopia.act(body, self.viewer),
                "/api/open": lambda: {"ok": True, "result": app.ugg.open(str(body.get("url", "")))},
            }
            if self.path not in routes:
                return self.send(404, {"error": "Not found"})
            self.send(200, routes[self.path]())
        except PermissionError as e:
            self.send(403, {"error": str(e)})
        except ValueError as e:
            self.send(400, {"error": str(e)})
        except DuoStatsError as e:
            self.send(502, {"error": str(e)})
        except Exception as e:   # keep the app alive whatever happens
            self.send(500, {"error": f"Unexpected error: {e}"})


class DuoStatsServer(ThreadingHTTPServer):
    # the page loads ~20 files at once; Python's default queue of 5 waiting connections drops some of them
    # (connection reset) whenever the server is busy, e.g. while building stats
    request_queue_size = 64


def make_server(app, port: int, access: Access | None = None) -> ThreadingHTTPServer:
    access = access or Access()
    handler = type("DuoStatsHandler", (Handler,), {"app": app, "access": access})
    server = DuoStatsServer(("0.0.0.0" if access.lan else "127.0.0.1", port), handler)
    server.daemon_threads = True
    return server
