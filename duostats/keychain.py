"""The Riot API key, kept in the macOS Keychain when "Remember" is ticked."""

from __future__ import annotations

import subprocess

from . import config


class Keychain:
    def __init__(self, service: str = config.KEYCHAIN_SERVICE, account: str = "riot"):
        self.service, self.account = service, account

    def _run(self, *args):
        return subprocess.run(["security", *args], capture_output=True, text=True, timeout=10)

    def get(self) -> str:
        try:
            r = self._run("find-generic-password", "-s", self.service, "-a", self.account, "-w")
            return r.stdout.strip() if r.returncode == 0 else ""
        except Exception:
            return ""

    def set(self, key: str) -> bool:
        try:
            r = self._run("add-generic-password", "-U", "-s", self.service, "-a", self.account,
                          "-l", "Duo Stats Riot API key", "-w", key)
            return r.returncode == 0
        except Exception:
            return False

    def delete(self):
        try:
            self._run("delete-generic-password", "-s", self.service, "-a", self.account)
        except Exception:
            pass
