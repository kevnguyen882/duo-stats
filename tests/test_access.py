import unittest
from unittest import mock

from duostats import access
from duostats.access import PIN_COOKIE, Access
from tests.helpers import TempStorageCase


class HostTests(unittest.TestCase):
    def test_only_this_mac_is_the_host(self):
        self.assertTrue(Access.is_host("127.0.0.1"))
        self.assertTrue(Access.is_host("::1"))
        self.assertFalse(Access.is_host("192.168.1.20"))

    def test_host_header_must_be_one_of_this_macs_names(self):
        a = Access()
        for ok in ("localhost:8765", "127.0.0.1:8765", "[::1]:8765", "LOCALHOST"):
            self.assertTrue(a.host_allowed(ok), ok)
        for bad in ("evil.example:8765", "", "localhost.evil.example", "[::2]:8765"):   # DNS rebinding
            self.assertFalse(a.host_allowed(bad), bad)

    def test_lan_adds_this_macs_network_names(self):
        with mock.patch.object(Access, "_network_names", return_value={"kevins-mac.local", "192.168.1.5"}):
            a = Access(lan=True)
        self.assertTrue(a.host_allowed("kevins-mac.local:8765"))
        self.assertTrue(a.host_allowed("192.168.1.5:8765"))


class PinTests(TempStorageCase):
    def access(self, pin="1234"):
        return Access(pin=pin, secret_file=self.tmp / "lan_secret")

    def test_no_pin_means_unlocked(self):
        self.assertTrue(Access().unlocked(""))

    def test_right_pin_sets_a_cookie_that_unlocks(self):
        a = self.access()
        self.assertFalse(a.unlocked(""))
        ok, cookie = a.try_pin("10.0.0.2", " 1234 ")
        self.assertTrue(ok)
        value = cookie.split(";")[0]
        self.assertTrue(value.startswith(PIN_COOKIE + "="))
        self.assertIn("HttpOnly", cookie)
        self.assertTrue(a.unlocked("other=1; " + value))
        self.assertFalse(a.unlocked(PIN_COOKIE + "=forged"))

    def test_cookie_survives_a_restart_but_not_a_new_pin(self):
        _, cookie = self.access().try_pin("10.0.0.2", "1234")
        value = cookie.split(";")[0]
        self.assertTrue(self.access().unlocked(value))           # same secret file, same PIN
        self.assertFalse(self.access("9999").unlocked(value))

    def test_too_many_wrong_pins_lock_that_computer_out(self):
        a = self.access()
        for _ in range(access.MAX_PIN_TRIES):
            self.assertEqual(a.try_pin("10.0.0.2", "0000"), (False, "That PIN isn't right."))
        ok, message = a.try_pin("10.0.0.2", "1234")              # even the right PIN waits now
        self.assertFalse(ok)
        self.assertIn("Too many", message)
        self.assertTrue(a.try_pin("10.0.0.3", "1234")[0])        # other computers aren't affected

    def test_lockout_ends(self):
        a = self.access()
        with mock.patch("duostats.access.time.time", return_value=1000.0):
            for _ in range(access.MAX_PIN_TRIES):
                a.try_pin("10.0.0.2", "0000")
        with mock.patch("duostats.access.time.time", return_value=1000.0 + access.PIN_LOCKOUT_SECONDS + 1):
            self.assertTrue(a.try_pin("10.0.0.2", "1234")[0])


if __name__ == "__main__":
    unittest.main()
