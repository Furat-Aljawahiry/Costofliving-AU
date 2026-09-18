"""
Phone push, one notification per product, with the product link tappable.

SNS email is the backstop — it arrives, but it arrives when your mail client
next syncs, which for a drop you are trying to catch is too late. This sends a
push straight to the handset instead, in parallel, and never blocks the alert:
a push failure is logged and swallowed, because the email has already gone.

Configured by ONE env var, PUSH_TARGET. Empty means push is off.

    ntfy:<topic>                    free, no account. Install the ntfy app,
                                    subscribe to <topic>, done. Anyone who
                                    guesses the topic name gets your alerts, so
                                    make it long and random.
    pushover:<user_key>:<app_token> $5 one-off, the most reliable of the three.
    telegram:<bot_token>:<chat_id>  free, needs a bot from @BotFather.

PUSH_MAX caps how many pushes one tick may send (default 5) so a feed reshuffle
that suddenly "matches" fifty products cannot machine-gun your phone. The email
still lists all of them.
"""

import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request

log = logging.getLogger()

PUSH_TARGET = os.environ.get("PUSH_TARGET", "").strip()
PUSH_MAX = int(os.environ.get("PUSH_MAX", "5"))
TIMEOUT_S = 10


def _post(url, data, headers=None):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method="POST")
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
        return resp.status


def _ntfy(target, item):
    topic = target
    base = "https://ntfy.sh"
    if topic.startswith("http"):  # self-hosted or a custom server
        base, _, topic = topic.rpartition("/")
    title = ("PRE-ORDER: " if item["preorder"] else "Kmart: ") + item["name"]
    body = ("${} — tap to open".format(item["price"]) if item["price"] is not None
            else "tap to open")
    return _post(
        "{}/{}".format(base, topic),
        body.encode("utf-8"),
        {
            # Latin-1 only in headers; the title can carry a stray dash or emoji
            # from a product name, so strip anything that would 500 the request.
            "Title": title.encode("ascii", "ignore").decode("ascii")[:200],
            "Priority": "urgent" if item["preorder"] else "high",
            "Tags": "shopping",
            "Click": item["url"],
        },
    )


def _pushover(target, item):
    user, _, token = target.partition(":")
    if not token:
        raise ValueError("pushover target wants <user_key>:<app_token>")
    payload = {
        "token": token,
        "user": user,
        "title": ("PRE-ORDER: " if item["preorder"] else "Kmart: ") + item["name"],
        "message": "${}".format(item["price"]) if item["price"] is not None else "now listed",
        "url": item["url"],
        "url_title": "Open on kmart.com.au",
        "priority": 1 if item["preorder"] else 0,
    }
    return _post(
        "https://api.pushover.net/1/messages.json",
        urllib.parse.urlencode(payload).encode("utf-8"),
        {"Content-Type": "application/x-www-form-urlencoded"},
    )


def _telegram(target, item):
    token, _, chat = target.rpartition(":")
    if not token or not chat:
        raise ValueError("telegram target wants <bot_token>:<chat_id>")
    head = "PRE-ORDER OPEN" if item["preorder"] else "New match"
    price = " — ${}".format(item["price"]) if item["price"] is not None else ""
    payload = {
        "chat_id": chat,
        "text": "{}: {}{}\n{}".format(head, item["name"], price, item["url"]),
        "disable_web_page_preview": False,
    }
    return _post(
        "https://api.telegram.org/bot{}/sendMessage".format(token),
        json.dumps(payload).encode("utf-8"),
        {"Content-Type": "application/json"},
    )


SENDERS = {"ntfy": _ntfy, "pushover": _pushover, "telegram": _telegram}


def push(items, target=None):
    """
    Push up to PUSH_MAX items. Returns how many went out. Never raises: the
    email has already been sent by the time this runs, and a dead push service
    must not turn a successful tick into a Lambda error.
    """
    target = PUSH_TARGET if target is None else target
    if not target or not items:
        return 0

    kind, _, rest = target.partition(":")
    sender = SENDERS.get(kind.strip().lower())
    if sender is None:
        log.warning("unknown PUSH_TARGET kind %r — want one of %s", kind, sorted(SENDERS))
        return 0

    sent = 0
    for item in items[:PUSH_MAX]:
        try:
            sender(rest, item)
            sent += 1
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError) as exc:
            log.warning("push failed for %s: %s", item["id"], exc)
    if len(items) > PUSH_MAX:
        log.warning("pushed %d of %d; the rest are in the email only", sent, len(items))
    return sent
