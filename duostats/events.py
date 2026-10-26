"""The League client's event stream.

The client pushes events over a WebSocket (using the WAMP protocol) whenever something
changes: the game phase, a chat message, the end-of-game stats. Listening to that means
the app hears about things the moment they happen instead of checking every few seconds.

Python's standard library has no WebSocket client, so a small one is included here. It
only needs to talk to the client on 127.0.0.1, which keeps it simple.
"""

from __future__ import annotations

import base64
import json
import os
import socket
import struct
import threading

from .errors import ClientUnavailable
from .league_client import LOCAL_SSL, LeagueClient

# the events the app cares about (the client names them after their API path)
SUBSCRIPTIONS = [
    "OnJsonApiEvent_lol-gameflow_v1_gameflow-phase",
    "OnJsonApiEvent_lol-chat_v1_conversations",
    "OnJsonApiEvent_lol-end-of-game_v1_eog-stats-block",
]


class WebSocketClosed(Exception):
    pass


class WebSocket:
    """A minimal WebSocket client: text messages, pings, close. Enough for the League client."""

    def __init__(self, port: int, auth_header: str, host: str = "127.0.0.1"):
        self.host, self.port, self.auth = host, port, auth_header
        self.sock = None

    def connect(self, timeout=10):
        raw = socket.create_connection((self.host, self.port), timeout=timeout)
        self.sock = LOCAL_SSL.wrap_socket(raw, server_hostname=self.host)
        key = base64.b64encode(os.urandom(16)).decode()
        request = (f"GET / HTTP/1.1\r\nHost: {self.host}:{self.port}\r\nUpgrade: websocket\r\n"
                   f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n"
                   f"Sec-WebSocket-Protocol: wamp\r\nAuthorization: {self.auth}\r\n\r\n")
        self.sock.sendall(request.encode())
        response = b""
        while b"\r\n\r\n" not in response:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise WebSocketClosed("connection closed during handshake")
            response += chunk
        status = response.split(b"\r\n", 1)[0]
        if b" 101 " not in status + b" ":
            raise WebSocketClosed(f"handshake refused: {status.decode(errors='replace')}")
        self._buffer = response.split(b"\r\n\r\n", 1)[1]

    # ---- frames ----
    def _read(self, n: int) -> bytes:
        out = self._buffer[:n]
        self._buffer = self._buffer[n:]
        while len(out) < n:
            chunk = self.sock.recv(n - len(out))
            if not chunk:
                raise WebSocketClosed("connection closed")
            out += chunk
        return out

    def _send_frame(self, opcode: int, payload: bytes):
        header = bytes([0x80 | opcode])
        n = len(payload)
        if n < 126:
            header += bytes([0x80 | n])
        elif n < 65536:
            header += bytes([0x80 | 126]) + struct.pack(">H", n)
        else:
            header += bytes([0x80 | 127]) + struct.pack(">Q", n)
        mask = os.urandom(4)   # clients must mask what they send
        self.sock.sendall(header + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))

    def send_text(self, text: str):
        self._send_frame(0x1, text.encode("utf-8"))

    def recv(self, idle_timeout: float = 1.0):
        """Next text message, or None if nothing arrived within idle_timeout seconds."""
        parts, opcode = [], None
        while True:
            if not self._buffer:
                self.sock.settimeout(idle_timeout if not parts else 15)
                try:
                    first = self.sock.recv(1)
                except socket.timeout:
                    if parts:
                        raise WebSocketClosed("message cut off")
                    return None
                if not first:
                    raise WebSocketClosed("connection closed")
                self._buffer = first
            self.sock.settimeout(15)
            b0, b1 = self._read(2)
            fin, op = b0 & 0x80, b0 & 0x0F
            n = b1 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._read(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._read(8))[0]
            mask = self._read(4) if b1 & 0x80 else None
            payload = self._read(n)
            if mask:
                payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
            if op == 0x9:                       # ping -> pong
                self._send_frame(0xA, payload)
                continue
            if op == 0xA:                       # pong
                continue
            if op == 0x8:                       # close
                raise WebSocketClosed("closed by the client")
            if op in (0x1, 0x2):
                opcode, parts = op, [payload]
            elif op == 0x0:                     # continuation of a fragmented message
                parts.append(payload)
            if fin and parts:
                return b"".join(parts).decode("utf-8", "replace")

    def close(self):
        try:
            self._send_frame(0x8, b"")
        except Exception:
            pass
        try:
            self.sock.close()
        except Exception:
            pass


class ClientEventStream:
    """Keeps a connection to the client's event stream open, reconnecting whenever League restarts.

    on_event(uri, event_type, data) is called for each event; on_connection(bool) when the
    connection opens or drops.
    """

    RETRY_SECONDS = 5

    def __init__(self, client: LeagueClient, on_event, on_connection):
        self.client = client
        self.on_event, self.on_connection = on_event, on_connection
        self.connected = False
        self._stop = threading.Event()
        self._thread = None

    def start(self):
        self._thread = threading.Thread(target=self._run, name="client-events", daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()

    def _set_connected(self, value: bool):
        if value != self.connected:
            self.connected = value
            try:
                self.on_connection(value)
            except Exception as e:
                print(f"[events] {e}")

    def _run(self):
        while not self._stop.is_set():
            ws = None
            try:
                port, _ = self.client.creds()
                ws = WebSocket(port, self.client.auth_header())
                ws.connect()
                for name in SUBSCRIPTIONS:
                    ws.send_text(json.dumps([5, name]))
                self._set_connected(True)
                while not self._stop.is_set():
                    text = ws.recv()
                    if text:
                        self._dispatch(text)
            except ClientUnavailable:
                pass
            except Exception as e:   # League closed or restarted: try again shortly
                if self.connected:
                    print(f"Lost the League client's event stream ({e}); reconnecting when it's back.")
            finally:
                if ws:
                    ws.close()
                self.client.forget_creds()
                self._set_connected(False)
            self._stop.wait(self.RETRY_SECONDS)

    def _dispatch(self, text: str):
        try:
            msg = json.loads(text)
        except ValueError:
            return
        if isinstance(msg, list) and len(msg) >= 3 and msg[0] == 8 and isinstance(msg[2], dict):
            payload = msg[2]
            try:
                self.on_event(payload.get("uri", ""), payload.get("eventType", ""), payload.get("data"))
            except Exception as e:   # one bad event must never stop the stream
                print(f"[events] couldn't handle {payload.get('uri')}: {e}")
