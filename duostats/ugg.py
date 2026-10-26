"""Opening u.gg build pages, reusing a u.gg tab that's already open when the browser allows it."""

from __future__ import annotations

import re
import subprocess
import sys
import threading
import webbrowser

ALLOWED = re.compile(r"^https://u\.gg/lol/champions/[a-z0-9-]+(/[a-z0-9-]+)?$")

# AppleScript that points an existing u.gg tab at a new page, without bringing the browser to the front
_CHROMIUM = """
if application "{app}" is running then
  tell application "{app}"
    repeat with w in windows
      set i to 0
      repeat with t in tabs of w
        set i to i + 1
        if (URL of t) contains "u.gg/lol/champions" then
          set URL of t to "{url}"
          try
            set active tab index of w to i
          end try
          return "reused"
        end if
      end repeat
    end repeat
  end tell
end if
return "none"
"""
_SAFARI = """
if application "Safari" is running then
  tell application "Safari"
    repeat with w in windows
      repeat with t in tabs of w
        if (URL of t) contains "u.gg/lol/champions" then
          set URL of t to "{url}"
          try
            set current tab of w to t
          end try
          return "reused"
        end if
      end repeat
    end repeat
  end tell
end if
return "none"
"""
BROWSERS = ["Safari", "Google Chrome", "Arc", "Brave Browser", "Microsoft Edge"]   # Firefox can't be scripted


class UggOpener:
    def __init__(self):
        self._lock = threading.Lock()

    @staticmethod
    def _reuse_tab(url: str) -> bool:
        if sys.platform != "darwin":
            return False
        for app in BROWSERS:
            script = (_SAFARI if app == "Safari" else _CHROMIUM).format(app=app, url=url)
            try:
                r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=8)
                if r.stdout.strip() == "reused":
                    return True
            except Exception:
                continue   # browser not installed, or macOS didn't allow controlling it
        return False

    def open(self, url: str) -> str:
        """Opens a u.gg champion page (from the button on the Live tab), in a u.gg tab that's already open if there is one."""
        if not ALLOWED.match(url):
            raise ValueError("Only u.gg champion pages can be opened.")
        with self._lock:
            result = "reused" if self._reuse_tab(url) else "opened"
            if result == "opened":
                webbrowser.open(url)
            return result
