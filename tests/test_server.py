"""The web server, over real HTTP on a free port, with a stand-in for the app behind it."""

import json
import threading
import unittest
import urllib.error
import urllib.request

from duostats.access import Access
from duostats.errors import DuoStatsError
from duostats.server import make_server


class FakeApp:
    def __init__(self):
        self.saved = []

    def status(self):
        return {"hasKey": False}

    def settings(self):
        return {"players": ["Duo One#NA1"]}

    def save_settings(self, body):
        self.saved.append(body)
        return body

    def match(self, game_id):
        if game_id == "1":
            raise DuoStatsError("That game isn't saved on this Mac.")
        return {"matchId": game_id}


class OtherComputer(Access):
    """Every request looks like it comes from another computer on the network."""
    def is_host(self, address):
        return False


class ServerCase(unittest.TestCase):
    access = None

    def setUp(self):
        self.app = FakeApp()
        self.server = make_server(self.app, 0, self.access or Access())
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def call(self, path, body=None, headers=None):
        """(status, parsed JSON or raw bytes, response headers)"""
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, headers=headers or {})
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                status, raw, head = r.status, r.read(), r.headers
        except urllib.error.HTTPError as e:
            status, raw, head = e.code, e.read(), e.headers
        try:
            return status, json.loads(raw), head
        except ValueError:
            return status, raw, head


class HostServerTests(ServerCase):
    def test_page_and_static_files(self):
        status, body, head = self.call("/")
        self.assertEqual(status, 200)
        self.assertIn(b"<title>luggi duc</title>", body)
        self.assertEqual(self.call("/js/core.js")[2]["Cache-Control"], "no-store")
        self.assertEqual(self.call("/img/logo-dark.png")[2]["Cache-Control"], "max-age=3600")

    def test_files_outside_web_are_not_served(self):
        for path in ("/js/../../duostats/config.py", "/img/../../data/settings.json", "/js/missing.js"):
            self.assertEqual(self.call(path)[0], 404, path)

    def test_api(self):
        self.assertEqual(self.call("/api/status")[1], {"hasKey": False, "viewer": False})
        self.assertEqual(self.call("/api/match?id=abc")[0], 400)
        self.assertEqual(self.call("/api/match?id=5")[1], {"matchId": "5"})
        self.assertEqual(self.call("/api/match?id=1")[:2], (502, {"error": "That game isn't saved on this Mac."}))
        self.assertEqual(self.call("/api/nothing")[0], 404)
        self.assertEqual(self.call("/api/nothing", {})[0], 404)

    def test_host_can_change_settings(self):
        self.assertEqual(self.call("/api/settings", {"region": "EUW"})[0], 200)
        self.assertEqual(self.app.saved, [{"region": "EUW"}])

    def test_other_websites_names_are_refused(self):
        self.assertEqual(self.call("/api/status", headers={"Host": "evil.example"})[0], 403)


class ViewerServerTests(ServerCase):
    access = OtherComputer()

    def test_viewer_cannot_change_settings(self):
        self.assertEqual(self.call("/api/settings", {"region": "EUW"})[0], 403)
        self.assertEqual(self.app.saved, [])

    def test_viewer_without_a_pin_can_look(self):
        self.assertEqual(self.call("/api/status")[1]["viewer"], True)


class PinServerTests(ServerCase):
    access = OtherComputer(pin="1234")

    def test_pin_first(self):
        status, body, _ = self.call("/")
        self.assertIn(b"PIN", body)                      # the PIN page instead of the app
        self.assertEqual(self.call("/api/status")[0], 401)
        self.assertEqual(self.call("/img/logo-dark.png")[0], 200)   # the PIN page's own pictures load

    def test_right_pin_unlocks(self):
        self.assertEqual(self.call("/api/pin", {"pin": "0000"})[0], 403)
        status, _, head = self.call("/api/pin", {"pin": "1234"})
        self.assertEqual(status, 200)
        cookie = head["Set-Cookie"].split(";")[0]
        self.assertEqual(self.call("/api/status", headers={"Cookie": cookie})[0], 200)


if __name__ == "__main__":
    unittest.main()
