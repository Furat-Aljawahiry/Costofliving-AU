"""Exercises the proxy layer against a FAKE CONNECT proxy on localhost — no
Decodo account, no network, no AWS.

    python infra/terraform/lambda/category_crawler/proxy_test.py

Takes ~15s: the last case deliberately walks the real retry backoff
(1s + 4s + 9s) to prove a blocked crawl rotates its exit IP each time.
"""

from __future__ import annotations

import base64
import http.server
import os
import sys
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from woolworths import fetch_page  # noqa: E402
from proxy import (  # noqa: E402
    ProxyError, create_session, http_get_text, parse_proxy_url, redact, session_username,
)
from secrets_store import proxy_url_from_secret  # noqa: E402

results = []


def check(name, fn):
    try:
        fn()
        results.append((True, name))
    except Exception as e:  # noqa: BLE001
        results.append((False, f"{name} — {e}"))


# ------------------------------------------------------------ pure config

def _parses_a_decodo_url():
    p = parse_proxy_url("http://user-acct:s3cret@gate.decodo.com:7000")
    assert p.host == "gate.decodo.com"
    assert p.port == 7000
    assert p.user == "user-acct"
    assert p.password == "s3cret"
    assert p.country == "au"


def _rejects_bad_urls():
    for bad in ("http://gate.decodo.com:7000", "socks5://u:p@gate.decodo.com:7000"):
        try:
            parse_proxy_url(bad)
        except ProxyError:
            continue
        raise AssertionError(f"{bad} should have been rejected")


def _builds_session_username():
    assert session_username("user-acct", country="au", session_id="abc123", session_minutes=30) == (
        "user-acct-country-au-session-abc123-sessionduration-30"
    )


def _leaves_pinned_session_alone():
    pinned = "user-acct-country-nz-session-mine-sessionduration-5"
    assert session_username(pinned, country="au", session_id="ignored") == pinned


def _redacts_password():
    assert redact("http://user-acct:s3cret@gate.decodo.com:7000") == "http://user-acct:***@gate.decodo.com:7000"


def _rotate_burns_session():
    s = create_session(parse_proxy_url("http://user-acct:p@gate.decodo.com:7000"))
    first = s.username
    s.rotate()
    assert s.username != first
    assert s.rotations == 1
    s.close()


check("parses a Decodo URL", _parses_a_decodo_url)
check("rejects credential-less and SOCKS URLs", _rejects_bad_urls)
check("builds the session username Decodo expects", _builds_session_username)
check("leaves an operator-pinned session alone", _leaves_pinned_session_alone)
check("redacts the password", _redacts_password)
check("rotate() burns the session id", _rotate_burns_session)


# ------------------------------------------------------------ secret shapes

def _plaintext_secret():
    assert proxy_url_from_secret("http://user-acct:pw@gate.decodo.com:7000") == (
        "http://user-acct:pw@gate.decodo.com:7000"
    )


def _console_key_value_secret():
    assert proxy_url_from_secret('{"PROXY_URL":"http://user-acct:pw@gate.decodo.com:7000"}') == (
        "http://user-acct:pw@gate.decodo.com:7000"
    )


def _separate_fields_encode_awkward_password():
    # A password with @ and : would break a hand-written URL; assembling it here
    # percent-encodes it so parse_proxy_url recovers the original exactly.
    url = proxy_url_from_secret(
        '{"username":"user-acct","password":"p@ss:w/rd","host":"gate.decodo.com","port":7000}'
    )
    p = parse_proxy_url(url)
    assert p.user == "user-acct"
    assert p.password == "p@ss:w/rd", p.password
    assert p.host == "gate.decodo.com"
    assert p.port == 7000


def _unusable_secret_names_keys():
    try:
        proxy_url_from_secret('{"proxyUrl":"oops"}')
    except ValueError as e:
        assert "found: proxyUrl" in str(e), str(e)
        return
    raise AssertionError("should have raised")


check("reads a plaintext secret", _plaintext_secret)
check("reads the console key/value shape", _console_key_value_secret)
check("assembles separate fields, encoding an awkward password", _separate_fields_encode_awkward_password)
check("an unusable secret names the keys it did find", _unusable_secret_names_keys)


# ------------------------------------------------------------ fake proxy

class _FakeProxy(http.server.BaseHTTPRequestHandler):
    """Records every CONNECT it is asked for, then refuses with `status`.

    Refusal is enough: the point is what we SEND (target, credentials, rotated
    username) and how we react, not what a real residential exit would return.
    """

    protocol_version = "HTTP/1.1"

    def do_CONNECT(self):  # noqa: N802
        creds = base64.b64decode(
            self.headers.get("Proxy-Authorization", "Basic ").split(" ", 1)[1] or ""
        ).decode()
        user, _, password = creds.partition(":")
        self.server.seen.append({"target": self.path, "username": user, "password": password})
        self.send_response(self.server.refuse_with)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, *args):
        pass


def fake_proxy(status):
    server = http.server.HTTPServer(("127.0.0.1", 0), _FakeProxy)
    server.seen = []
    server.refuse_with = status
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_address[1]
    return server, f"http://user-acct:s3cret@127.0.0.1:{port}"


proxy407, url407 = fake_proxy(407)
s407 = create_session(parse_proxy_url(url407))
err407 = None
try:
    http_get_text("https://www.woolworths.com.au/apis/ui/browse/category", session=s407)
except Exception as e:  # noqa: BLE001
    err407 = e
s407.close()


def _tunnels_with_auth():
    assert len(proxy407.seen) == 1, f"exactly one CONNECT, saw {len(proxy407.seen)}"
    assert proxy407.seen[0]["target"] == "www.woolworths.com.au:443"
    assert proxy407.seen[0]["password"] == "s3cret"
    import re
    assert re.fullmatch(
        r"user-acct-country-au-session-[0-9a-f]{12}-sessionduration-30",
        proxy407.seen[0]["username"],
    ), proxy407.seen[0]["username"]


def _refused_connect_is_proxy_error():
    assert isinstance(err407, ProxyError), f"expected ProxyError, got {err407!r}"
    assert err407.proxy_status == 407, err407.proxy_status


check("tunnels through the proxy with Basic auth to the right target", _tunnels_with_auth)
check("a refused CONNECT surfaces as ProxyError, not a hang", _refused_connect_is_proxy_error)
proxy407.shutdown()


# ------------------------------------------------------------ rotation

import time  # noqa: E402

proxy403, url403 = fake_proxy(403)
s403 = create_session(parse_proxy_url(url403))
t0 = time.time()
blocked_err = None
try:
    fetch_page({"category": "1-E5BEE36E", "url": "/shop/browse/fruit-veg", "name": "Fruit & Veg"}, 1, s403)
except Exception as e:  # noqa: BLE001
    blocked_err = e
s403.close()


def _blocked_page_rotates_each_attempt():
    assert blocked_err is not None, "fetch_page should give up and raise"
    assert len(proxy403.seen) == 3, f"3 attempts, saw {len(proxy403.seen)}"
    assert len({c["username"] for c in proxy403.seen}) == 3, "each attempt needs its own session"
    assert s403.rotations == 3, s403.rotations


def _407_short_circuits():
    # proven by the 407 case above running exactly one CONNECT
    assert len(proxy407.seen) == 1


check("a blocked page is retried on a fresh exit IP each time", _blocked_page_rotates_each_attempt)
check("407 short-circuits instead of burning the retry budget", _407_short_circuits)
proxy403.shutdown()

print(f"\nCHECKS ({time.time() - t0:.0f}s in backoff):")
ok = True
for passed, name in results:
    print(f"  {'PASS' if passed else 'FAIL'}  {name}")
    ok = ok and passed
sys.exit(0 if ok else 1)
