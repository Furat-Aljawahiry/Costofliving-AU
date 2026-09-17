"""Read the proxy credential from AWS Secrets Manager.

Deliberately NOT named secrets.py: Lambda puts the function directory at the
front of sys.path, so that name would shadow the standard library's `secrets`
module for every import in the process — including boto3's own.

boto3 is bundled in the Python managed runtimes, so unlike the Node version
there is no SigV4 to hand-roll and nothing to vendor.
"""

from __future__ import annotations

import json
import urllib.parse

_client = None


def _secrets_client():
    # Imported lazily and cached so this module can be unit-tested without boto3
    # or credentials on the path.
    global _client
    if _client is None:
        import boto3

        _client = boto3.client("secretsmanager")
    return _client


def get_secret_value(secret_id: str, key: str = "PROXY_URL") -> str:
    res = _secrets_client().get_secret_value(SecretId=secret_id)
    secret_string = res.get("SecretString")
    if not secret_string:
        raise ValueError(f"secret {secret_id} has no SecretString")
    return proxy_url_from_secret(secret_string, secret_id=secret_id, key=key)


def proxy_url_from_secret(secret_string: str, secret_id: str = "secret", key: str = "PROXY_URL") -> str:
    """Normalise whatever shape the secret is in into a proxy URL string.

    Three shapes are accepted, because all three are things a reasonable person
    types into the console:

        1. plaintext           "http://user-acct:pw@gate.decodo.com:7000"
        2. JSON, one key       {"PROXY_URL": "http://user-acct:pw@..."}
        3. JSON, separate keys {"username": "user-acct", "password": "pw",
                                "host": "gate.decodo.com", "port": "7000"}

    Shape 3 exists for a specific reason: a password containing @ : / or # is
    legal at Decodo but breaks URL parsing when pasted into shape 1 or 2, and
    the resulting error points nowhere near the real cause. Assembling the URL
    here lets us percent-encode the credentials properly, so any password works.
    """
    s = secret_string.strip()
    if not s.startswith("{"):
        return s

    try:
        parsed = json.loads(s)
    except json.JSONDecodeError:
        return s

    direct = parsed.get(key) or parsed.get("url") or parsed.get("PROXY_URL") or parsed.get("proxy_url")
    if direct:
        return str(direct).strip()

    username = parsed.get("username") or parsed.get("user")
    password = parsed.get("password") or parsed.get("pass")
    host = parsed.get("host") or parsed.get("endpoint") or parsed.get("gateway")
    if username and password and host:
        port = parsed.get("port", 7000)
        scheme = parsed.get("scheme", "http")
        user_q = urllib.parse.quote(str(username), safe="")
        pass_q = urllib.parse.quote(str(password), safe="")
        return f"{scheme}://{user_q}:{pass_q}@{host}:{port}"

    raise ValueError(
        f'secret {secret_id} is JSON but has no "{key}" key and no username/password/host trio '
        f"(found: {', '.join(parsed.keys())})"
    )
