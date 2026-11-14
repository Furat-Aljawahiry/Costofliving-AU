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
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

log = logging.getLogger()

PUSH_TARGET = os.environ.get("PUSH_TARGET", "").strip()
PUSH_MAX = int(os.environ.get("PUSH_MAX", "5"))
TIMEOUT_S = 10


# ntfy carries the title in an HTTP header, which cannot hold non-ASCII, so it
# has to be transliterated. Dropping non-ASCII outright -- which is what this
# did until 1 Oct 2026 -- silently mangles both retailers' real titles:
#
#   "Mega Evolution\u2014Perfect Order Blister"  ->  "Mega EvolutionPerfect Order Blister"
#   "Pok\u00e9mon"                              ->  "Pokmon"
#
# Target writes em dashes into set names and Big W writes the accent, so both
# of those are everyday titles, not edge cases. Punctuation that actually
# occurs is mapped to its ASCII equivalent and accents are decomposed away
# first; only then is whatever is left dropped.
_HEADER_SUBS = {
    0x2014: u"-",    # em dash
    0x2013: u"-",    # en dash
    0x2212: u"-",    # minus sign
    0x2018: u"'",    # curly quotes
    0x2019: u"'",
    0x201C: u'"',
    0x201D: u'"',
    0x2026: u"...",  # ellipsis
    0x00A0: u" ",    # non-breaking space
    0x00AE: u"",     # (R)
    0x2122: u"",     # (TM)
}


def _header(text):
    """`text` reduced to ASCII without welding words together."""
    text = unicodedata.normalize("NFKD", text.translate(_HEADER_SUBS))
    text = "".join(c for c in text if not unicodedata.combining(c))
    return text.encode("ascii", "ignore").decode("ascii")


def _title(item):
    """
    "Target: Pokemon TCG 30th Anniversary Mini Tin". The retailer is set by
    index.collect(); falling back to Kmart keeps the old wording for anything
    that reaches here without it (the push tests, mainly).
    """
    shop = item.get("retailer") or "Kmart"
    head = "{} PRE-ORDER: ".format(shop) if item["preorder"] else shop + ": "
    return head + item["name"]


def _body(item):
    """
    Price, plus Target's online stock when the row has one. An alert on a row
    with 0 online stock means "it exists, it is not buyable yet" — worth
    saying on the notification itself, because that is the one you watch
    rather than tap.
    """
    bits = []
    if item.get("price") is not None:
        bits.append("${}".format(item["price"]))
    # JB pre-orders are the only rows with a release date, and on a pre-order
    # it is the thing you want on the lock screen.
    if item.get("release_date"):
        bits.append("releases " + item["release_date"])
    if item.get("online_qty") is not None:
        bits.append(
            "NOT yet buyable online" if item["online_qty"] == 0
            else "{} online".format(item["online_qty"])
        )
    bits.append("tap to open")
    return " — ".join(bits)


def _actions(item):
    """
    One ntfy action button: "Open in the Target app".

    On Android ntfy fires a `view` action as an ordinary ACTION_VIEW, which is
    the same path a tap on the notification body takes. So this does NOT
    bypass Android App Links verification -- it cannot; that is a device
    setting. What it buys is a labelled, unmissable target, and `clear=true`
    so the notification goes away when you use it.

    Target publishes assetlinks.json for com.lasoo.android.target with
    handle_all_urls, and the /p/<slug>/<id> links in these alerts are already
    the registered deep links, so once "Open supported links" is on for the
    app this opens the app rather than the browser. The README has the
    walkthrough.

    ntfy's syntax is comma-separated fields, so the label is quoted in case a
    retailer name ever carries one.
    """
    shop = item.get("retailer") or "Kmart"
    return 'view, "Open in {} app", {}, clear=true'.format(shop, item["url"])


def _post(url, data, headers=None):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method="POST")
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
        return resp.status


def _ntfy(target, item):
    topic = target
    base = "https://ntfy.sh"
    if topic.startswith("http"):  # self-hosted or a custom server
        base, _, topic = topic.rpartition("/")
    return _post(
        "{}/{}".format(base, topic),
        _body(item).encode("utf-8"),
        {
            # ASCII only in headers; see _header, which transliterates rather
            # than deleting so a set name keeps its word boundaries.
            "Title": _header(_title(item))[:200],
            "Priority": "urgent" if item["preorder"] else "high",
            "Tags": "shopping",
            "Click": item["url"],
            "Actions": _header(_actions(item)),
        },
    )


def _pushover(target, item):
    user, _, token = target.partition(":")
    if not token:
        raise ValueError("pushover target wants <user_key>:<app_token>")
    payload = {
        "token": token,
        "user": user,
        "title": _title(item),
        "message": _body(item),
        "url": item["url"],
        "url_title": "Open the product page",
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
    payload = {
        "chat_id": chat,
        "text": "{}\n{}\n{}".format(_title(item), _body(item), item["url"]),
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
