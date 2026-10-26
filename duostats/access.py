"""Who's asking: this Mac (full control) or another computer on the network (view only), and the optional PIN.

Without --lan the server only listens on this Mac, so everyone is the host. With --lan, other computers on the
same network can open the page too, but can't change settings, the Riot key, or open pages on this Mac.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import socket
import subprocess
import threading
import time
from pathlib import Path

LOCAL_ADDRESSES = {"127.0.0.1", "::1", "::ffff:127.0.0.1"}


def _no_local(name: str) -> str:
    return name[:-len(".local")] if name.endswith(".local") else name
PIN_COOKIE = "duo_stats_pin"
MAX_PIN_TRIES = 5            # wrong PINs from one computer before it has to wait
PIN_LOCKOUT_SECONDS = 600


class Access:
    def __init__(self, lan: bool = False, pin: str = "", secret_file: Path | None = None):
        self.lan, self.pin = lan, (pin or "").strip()
        self.names = {"localhost", "127.0.0.1", "::1"} | (self._network_names() if lan else set())
        self._secret = self._load_secret(secret_file) if self.pin else b""
        self._fails = {}   # address -> (wrong tries, time of the first)
        self._lock = threading.Lock()

    # ---- who ----
    @staticmethod
    def is_host(address: str) -> bool:
        return address in LOCAL_ADDRESSES

    def host_allowed(self, host_header: str) -> bool:
        """Only answer requests addressed to this Mac by one of its own names. This stops other websites from using
        your browser to reach the app through a name they control (DNS rebinding)."""
        host = (host_header or "").strip().lower()
        if host.startswith("["):                       # [::1]:8765
            name = host[1:host.find("]")] if "]" in host else host
        else:
            name = host.rsplit(":", 1)[0] if host.count(":") == 1 else host
        return name in self.names

    # ---- this Mac's names on the network ----
    @staticmethod
    def bonjour_name() -> str:
        """e.g. "kevins-macbook-pro": this Mac is reachable as <name>.local on the network."""
        try:
            out = subprocess.run(["scutil", "--get", "LocalHostName"], capture_output=True, text=True, timeout=3)
            if out.returncode == 0 and out.stdout.strip():
                return out.stdout.strip().lower()
        except (OSError, subprocess.SubprocessError):
            pass
        return _no_local(socket.gethostname().lower())

    @staticmethod
    def network_addresses() -> list:
        """This Mac's IP addresses on the network (the main one first)."""
        found = []
        try:   # the address used to reach the outside world; nothing is actually sent
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.connect(("10.255.255.255", 1))
                found.append(s.getsockname()[0])
        except OSError:
            pass
        try:
            for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
                if info[4][0] not in found and not info[4][0].startswith("127."):
                    found.append(info[4][0])
        except OSError:
            pass
        return found

    def _network_names(self) -> set:
        host = socket.gethostname().lower()
        bonjour = self.bonjour_name()
        return {host, _no_local(host), _no_local(host) + ".local",
                bonjour, bonjour + ".local", *self.network_addresses()}

    def urls(self, port: int) -> list:
        return [f"http://{self.bonjour_name()}.local:{port}"] + [f"http://{ip}:{port}" for ip in self.network_addresses()]

    # ---- the PIN ----
    @staticmethod
    def _load_secret(path: Path | None) -> bytes:
        """A random secret kept on this Mac, so a remembered PIN keeps working after the app restarts."""
        if path:
            try:
                data = path.read_bytes()
                if len(data) >= 32:
                    return data
            except OSError:
                pass
        data = secrets.token_bytes(32)
        if path:
            try:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
            except OSError:
                pass
        return data

    def _token(self) -> str:
        return hmac.new(self._secret, self.pin.encode(), hashlib.sha256).hexdigest()

    def unlocked(self, cookie_header: str) -> bool:
        """True if no PIN is set, or this browser has already entered it."""
        if not self.pin:
            return True
        for part in (cookie_header or "").split(";"):
            name, _, value = part.strip().partition("=")
            if name == PIN_COOKIE and hmac.compare_digest(value, self._token()):
                return True
        return False

    def try_pin(self, address: str, pin: str):
        """(ok, cookie to set or error message). Too many wrong tries from one computer locks it out for a while."""
        with self._lock:
            tries, first = self._fails.get(address, (0, time.time()))
            if time.time() - first > PIN_LOCKOUT_SECONDS:
                tries, first = 0, time.time()
            if tries >= MAX_PIN_TRIES:
                return False, "Too many wrong PINs. Try again in a few minutes."
            if hmac.compare_digest(str(pin).strip(), self.pin):
                self._fails.pop(address, None)
                return True, f"{PIN_COOKIE}={self._token()}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict"
            self._fails[address] = (tries + 1, first)
            return False, "That PIN isn't right."
