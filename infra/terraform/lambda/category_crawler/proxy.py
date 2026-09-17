"""Egress proxy layer for the Woolworths crawler (Decodo, formerly Smartproxy).

Usage is OPTIONAL. With no proxy configured the crawler behaves exactly as it
did before and egresses from the Lambda's own public IP.

    PROXY_URL=http://user-<account>:<password>@gate.decodo.com:7000

Decodo's residential gate takes every session parameter in the USERNAME, not in
the path or a header:

    user-<account>-country-au-session-<id>-sessionduration-<minutes>

so a "session" here is just a derived username string plus its own opener.
See https://help.decodo.com/docs/residential-proxy-user-pass-requests

Standard library only: urllib does HTTP CONNECT tunnelling natively, so unlike
the Node version there is nothing to hand-roll here.
"""

from __future__ import annotations

import gzip
import json
import os
import secrets as _secrets
import urllib.error
import urllib.parse
import urllib.request
import zlib
from dataclasses import dataclass

# Decodo rotates a sticky session's exit IP after this many minutes. A Fruit &
# Veg crawl is ~20s, so 30 is generous headroom for a slow or retried run
# without holding an IP longer than we need it.
DEFAULT_SESSION_MINUTES = 30
DEFAULT_COUNTRY = "au"  # AU exit IPs: prices are location-scoped (spec 5)
REQUEST_TIMEOUT_S = 45


class ProxyError(Exception):
    """Raised when the PROXY itself refuses/fails, as distinct from a target error."""

    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.proxy_status = status


@dataclass(frozen=True)
class Proxy:
    host: str
    port: int
    user: str
    password: str
    country: str
    session_minutes: int
    scheme: str = "http"


# ---------------------------------------------------------------- config


def redact(s: str) -> str:
    """Never log a proxy URL raw — it carries the account password."""
    import re

    return re.sub(r"//([^:@/]+):[^@/]*@", r"//\1:***@", str(s))


def parse_proxy_url(
    raw: str,
    country: str = DEFAULT_COUNTRY,
    session_minutes: int = DEFAULT_SESSION_MINUTES,
) -> Proxy:
    # Accept the JSON shapes too, not just a bare URL: pasting the secret's raw
    # value into PROXY_URL is the obvious thing to try, and failing it with
    # 'unsupported proxy scheme ""' points nowhere near the real cause.
    from secrets_store import proxy_url_from_secret

    u = urllib.parse.urlparse(proxy_url_from_secret(raw.strip()))

    # We tunnel with CONNECT over a plain TCP hop to the gateway; the target
    # request inside the tunnel is still full TLS end-to-end, so http: here is
    # not a downgrade of the Woolworths connection.
    if u.scheme not in ("http", "https"):
        raise ProxyError(
            f'unsupported proxy scheme "{u.scheme}" — only http(s) CONNECT is implemented (SOCKS is not)'
        )
    if not u.hostname:
        raise ProxyError(f"PROXY_URL is not a valid URL: {redact(raw)}")
    if not u.username or not u.password:
        raise ProxyError(
            "PROXY_URL must include username:password — Decodo's gate rejects IP-whitelist auth"
        )

    try:
        minutes = int(session_minutes)
    except (TypeError, ValueError):
        minutes = DEFAULT_SESSION_MINUTES
    if not 1 <= minutes <= 1440:
        minutes = DEFAULT_SESSION_MINUTES

    return Proxy(
        host=u.hostname,
        port=u.port or (443 if u.scheme == "https" else 80),
        user=urllib.parse.unquote(u.username),
        password=urllib.parse.unquote(u.password),
        country=(country or "").strip().lower(),
        session_minutes=minutes,
        scheme=u.scheme,
    )


def session_username(
    base_user: str,
    country: str | None = None,
    session_id: str | None = None,
    session_minutes: int | None = None,
) -> str:
    """Build the per-session username Decodo expects.

    If the configured username already pins a session, it is passed through
    untouched — an operator who wrote out the full parameter string meant it.
    """
    if "-session-" in base_user:
        return base_user
    u = base_user
    if country and "-country-" not in u:
        u += f"-country-{country}"
    if session_id:
        u += f"-session-{session_id}"
        if session_minutes:
            u += f"-sessionduration-{session_minutes}"
    return u


def new_session_id() -> str:
    return _secrets.token_hex(6)


def _session_opts_from_env(env) -> dict:
    return {
        "country": env.get("PROXY_COUNTRY", DEFAULT_COUNTRY),
        "session_minutes": env.get("PROXY_SESSION_MINUTES", DEFAULT_SESSION_MINUTES),
    }


def proxy_from_env(env=None) -> Proxy | None:
    """Read proxy config from PROXY_URL only — the local CLI path.

    Returns None when no proxy is configured; the caller then egresses directly.
    """
    env = os.environ if env is None else env
    raw = (env.get("PROXY_URL") or "").strip()
    if not raw:
        if str(env.get("PROXY_REQUIRED", "")).lower() == "true":
            raise ProxyError("PROXY_REQUIRED=true but PROXY_URL is not set")
        return None
    return parse_proxy_url(raw, **_session_opts_from_env(env))


# Module scope, so a warm container reuses the fetched value instead of calling
# Secrets Manager on every invocation. A daily schedule cold-starts every time
# anyway; this matters if the function is ever invoked in bursts, and keeps the
# per-10k-call charge at effectively zero.
_cached_secret_value: str | None = None


def resolve_proxy(env=None) -> Proxy | None:
    """Resolve proxy config from PROXY_URL, then PROXY_SECRET_ID via Secrets Manager.

    The Lambda uses the secret: the value lives only there, so no `terraform
    apply` can clobber it and it never enters tfstate or a plan file.

    Note the asymmetry: a *missing* configuration falls back to direct egress
    unless PROXY_REQUIRED says otherwise, but a configured secret that cannot be
    READ always throws. Setting PROXY_SECRET_ID is a statement of intent, and
    quietly crawling from the AWS IP because Secrets Manager had a bad minute is
    precisely the silent degradation this project's alarm exists to prevent.
    """
    global _cached_secret_value
    env = os.environ if env is None else env
    opts = _session_opts_from_env(env)

    inline = (env.get("PROXY_URL") or "").strip()
    if inline:
        return parse_proxy_url(inline, **opts)

    secret_id = (env.get("PROXY_SECRET_ID") or "").strip()
    if secret_id:
        if _cached_secret_value is None:
            from secrets_store import get_secret_value

            _cached_secret_value = get_secret_value(secret_id)
        return parse_proxy_url(_cached_secret_value, **opts)

    if str(env.get("PROXY_REQUIRED", "")).lower() == "true":
        raise ProxyError("PROXY_REQUIRED=true but neither PROXY_URL nor PROXY_SECRET_ID is set")
    return None


# ---------------------------------------------------------------- session


class Session:
    """A sticky egress session: one Decodo session id, one urllib opener.

    `rotate()` burns the current exit IP and starts a fresh session — call it
    when the target blocks us, not on ordinary network noise.
    """

    def __init__(self, proxy: Proxy):
        self.proxy = proxy
        self.id = ""
        self.username = ""
        self.opener: urllib.request.OpenerDirector | None = None
        self.rotations = 0
        self.rotate()
        self.rotations = 0  # the initial session is not a rotation

    def rotate(self) -> "Session":
        self.id = new_session_id()
        self.username = session_username(
            self.proxy.user,
            country=self.proxy.country,
            session_id=self.id,
            session_minutes=self.proxy.session_minutes,
        )
        # urllib reads the credentials out of the proxy URL and turns them into
        # the Proxy-Authorization header on the CONNECT, which is exactly where
        # Decodo expects the session parameters to arrive.
        auth = f"{urllib.parse.quote(self.username, safe='')}:{urllib.parse.quote(self.proxy.password, safe='')}"
        proxy_url = f"{self.proxy.scheme}://{auth}@{self.proxy.host}:{self.proxy.port}"
        self.opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({"http": proxy_url, "https": proxy_url})
        )
        self.rotations += 1
        return self

    def close(self) -> None:
        self.opener = None

    def describe(self) -> str:
        country = f" country={self.proxy.country}" if self.proxy.country else ""
        return f"{self.proxy.host}:{self.proxy.port} session={self.id}{country}"


def create_session(proxy: Proxy | None) -> Session | None:
    return Session(proxy) if proxy else None


# ---------------------------------------------------------------- request


def http_get_text(url: str, headers: dict | None = None, session: Session | None = None,
                  timeout: int = REQUEST_TIMEOUT_S) -> tuple[int, str]:
    """GET a URL, optionally through `session`'s proxy.

    Returns (status, body) with the body already decompressed. A non-2xx status
    is RETURNED, not raised, so the caller can decide what counts as a block;
    proxy-level failures raise ProxyError.
    """
    headers = dict(headers or {})
    headers.setdefault("Accept-Encoding", "gzip, deflate")
    req = urllib.request.Request(url, headers=headers, method="GET")
    opener = session.opener if session and session.opener else urllib.request.build_opener()

    try:
        with opener.open(req, timeout=timeout) as res:
            return res.status, _decode(res.read(), res.headers.get("Content-Encoding"))
    except urllib.error.HTTPError as e:
        # An error response is still a response — hand the status back.
        return e.code, _decode(e.read(), e.headers.get("Content-Encoding") if e.headers else None)
    except urllib.error.URLError as e:
        raise _as_proxy_error(e.reason, session) from e
    except OSError as e:
        raise _as_proxy_error(e, session) from e


def _as_proxy_error(err, session: Session | None) -> Exception:
    """Turn a transport failure into ProxyError when a proxy is in the path.

    http.client reports a refused CONNECT as OSError('Tunnel connection failed:
    407 Proxy Authentication Required'), which is the only place the proxy's own
    status code appears — so dig it out rather than losing it in a generic error.
    """
    msg = str(err)
    if session is None:
        return ConnectionError(msg)
    status = None
    if "Tunnel connection failed" in msg:
        import re

        m = re.search(r"Tunnel connection failed:\s*(\d{3})", msg)
        if m:
            status = int(m.group(1))
    return ProxyError(f"proxy {session.proxy.host}:{session.proxy.port}: {msg}", status)


def _decode(raw: bytes, encoding: str | None) -> str:
    enc = (encoding or "").lower()
    if enc == "gzip":
        raw = gzip.decompress(raw)
    elif enc == "deflate":
        raw = zlib.decompress(raw, -zlib.MAX_WBITS)
    return raw.decode("utf-8", errors="replace")


def probe_exit_ip(session: Session | None) -> dict:
    """Confirm the tunnel works and report the exit IP.

    One extra request, so it is opt-in — but it turns "the crawl returned 0
    rows" into "we egressed from the wrong country", which is the difference
    between a five-minute and a two-hour debug.

    Two endpoints, tried in order: Decodo's own reports country and city, which
    is what we actually want to check, but a probe is worthless if one host
    having a bad day costs us the provenance. The fallback yields the IP alone.
    """
    errors = []

    try:
        status, body = http_get_text("https://ip.decodo.com/json", session=session, timeout=15)
        if status != 200:
            raise ProxyError(f"exit-IP probe returned HTTP {status}", status)
        j = json.loads(body)
        country = j.get("country") or {}
        city = j.get("city") or {}
        return {
            "ip": (j.get("proxy") or {}).get("ip") or j.get("ip"),
            "country": country.get("code") or country.get("name"),
            "city": city.get("name"),
        }
    except Exception as e:  # noqa: BLE001
        errors.append(f"ip.decodo.com: {e}")

    try:
        status, body = http_get_text("https://api.ipify.org?format=json", session=session, timeout=15)
        if status == 200:
            return {"ip": json.loads(body).get("ip"), "country": None, "city": None}
        errors.append(f"api.ipify.org: HTTP {status}")
    except Exception as e:  # noqa: BLE001
        errors.append(f"api.ipify.org: {e}")

    raise ProxyError("; ".join(errors))
