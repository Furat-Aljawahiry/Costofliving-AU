"""
Kmart pre-order watcher.

Alerts the first time a product matching MATCH_PATTERN (default "30th
anniversary") shows up, and again if that product later flips into
pre-order-active. One SNS message per batch, deduped through DynamoDB.

WHERE THE DATA COMES FROM
-------------------------
www.kmart.com.au/category/... is behind Akamai and returns 403 to anything
that is not a real browser, from a datacenter IP always. Measured 18 Sep 2026:

    GET /category/toys/pre-order/            -> 403 AkamaiGHost
    GET /                                    -> 200
    GET /_next/data/<buildId>/category/...   -> 200, but productResults: null

The grid is client-side; the page fetches it from Constructor.io's public
endpoint (ac.cnstrc.com) with a key that ships in the homepage HTML. That
endpoint is CDN-fronted, unauthenticated and NOT behind the bot wall -- 200
from a bare curl on an AWS IP. So this needs no proxy and no browser, unlike
the Woolworths/Coles crawlers next door.

robots.txt disallows /api/ and /checkout; ac.cnstrc.com is a different host and
the pages we link to are Allowed. We read only, one request per source.

SOURCES
-------
Two, because a 30th-anniversary drop can land either way:

  browse:615bf6db4dee158ccbbc1ed5aef1ced9   /category/toys/pre-order/
  search:30th anniversary                   site-wide, catches it anywhere

The browse source alerts on ANYTHING new when ALERT_ALL_PREORDER is true (the
category held 2 items on 18 Sep 2026, so this is quiet); the search source
alerts only on pattern matches.

Env vars:
  TABLE_NAME          DynamoDB table, partition key `product_id` (S). Required.
  TOPIC_ARN           SNS topic to publish to. Required.
  MATCH_PATTERN       Case-insensitive regex. Default: 30th\\s*anniversary
  SOURCES             Comma-separated "browse:<group_id>" / "search:<query>".
  ALERT_ALL_PREORDER  "true" -> any new item in a browse source alerts.
  CONSTRUCTOR_KEY     Override; otherwise scraped from the homepage and cached.
  TTL_DAYS            How long a seen product stays deduped. Default 90.
"""

import json
import logging
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request

import push

log = logging.getLogger()
log.setLevel(logging.INFO)

SITE = "https://www.kmart.com.au"
AC = "https://ac.cnstrc.com"
PAGE_URL = os.environ.get("PAGE_URL", SITE + "/category/toys/pre-order/")
MATCH_PATTERN = os.environ.get("MATCH_PATTERN", r"30th\s*anniversary")
TTL_DAYS = int(os.environ.get("TTL_DAYS", "90"))
ALERT_ALL_PREORDER = os.environ.get("ALERT_ALL_PREORDER", "true").lower() == "true"
DEFAULT_SOURCES = "browse:615bf6db4dee158ccbbc1ed5aef1ced9,search:30th anniversary"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
)

matcher = re.compile(MATCH_PATTERN, re.IGNORECASE)

_key_cache = os.environ.get("CONSTRUCTOR_KEY") or None
_table = None
_sns = None


# AWS clients are built lazily so the module imports (and the pure functions
# below are testable) without boto3 or credentials on the path.
def table():
    global _table
    if _table is None:
        import boto3

        _table = boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])
    return _table


def sns():
    global _sns
    if _sns is None:
        import boto3

        _sns = boto3.client("sns")
    return _sns


def fetch(url, attempts=3, timeout=15):
    """GET with a browser UA and linear backoff. Returns decoded text."""
    last = None
    for i in range(attempts):
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": UA,
                "Accept": "application/json, text/html, */*",
                "Accept-Language": "en-AU,en;q=0.9",
                "Referer": SITE + "/",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
            last = exc
            log.warning("fetch attempt %d/%d failed for %s: %s", i + 1, attempts, url, exc)
            if i < attempts - 1:
                time.sleep(2 * (i + 1))
    raise RuntimeError("could not fetch {}: {}".format(url, last))


def constructor_key(force=False):
    """
    The site's Constructor.io key, scraped from the homepage and cached for the
    life of the container. Keys rotate; re-scraping beats redeploying.
    """
    global _key_cache
    if _key_cache and not force:
        return _key_cache
    _key_cache = key_from_html(fetch(SITE + "/"))
    log.info("discovered constructor key %s", _key_cache)
    return _key_cache


def key_from_html(html):
    m = re.search(r'constructorApiKey"\s*:\s*"(key_[A-Za-z0-9]+)"', html)
    if not m:
        raise RuntimeError("no constructorApiKey on the homepage -- page shape changed")
    return m.group(1)


def parse_source(spec):
    kind, _, target = spec.partition(":")
    kind = kind.strip().lower()
    target = target.strip()
    if kind not in ("browse", "search") or not target:
        raise RuntimeError(
            "bad SOURCES entry {!r} -- want browse:<group_id> or search:<query>".format(spec)
        )
    return kind, target


def source_url(kind, target, key, page=1, per_page=100):
    params = urllib.parse.urlencode(
        {
            "key": key,
            "i": "kmart-preorder-watcher",
            "s": "1",
            "c": "ciojs-client-2.6.0",
            "num_results_per_page": per_page,
            "page": page,
        }
    )
    path = (
        "/browse/group_id/" + urllib.parse.quote(target)
        if kind == "browse"
        else "/search/" + urllib.parse.quote(target)
    )
    return AC + path + "?" + params


def normalise(item):
    d = item.get("data") or {}
    url = d.get("url") or d.get("uri") or ""
    return {
        "id": str(d.get("id") or ""),
        "name": item.get("value") or "",
        "url": url if url.startswith("http") else SITE + url,
        "price": d.get("price"),
        "preorder": bool(d.get("isPreOrderActive")),
        "brand": d.get("Brand") or "",
    }


def parse_results(body):
    resp = body.get("response") or {}
    items = [normalise(i) for i in resp.get("results") or []]
    return [i for i in items if i["id"]], resp.get("total_num_results")


def read_source(kind, target, key):
    """One page of a source. Retries once with a re-scraped key if it is rejected."""
    try:
        raw = fetch(source_url(kind, target, key))
    except RuntimeError as exc:
        if "401" not in str(exc) and "403" not in str(exc):
            raise
        log.warning("source %s:%s rejected the key, re-scraping", kind, target)
        raw = fetch(source_url(kind, target, constructor_key(force=True)))
    try:
        body = json.loads(raw)
    except json.JSONDecodeError:
        raise RuntimeError("{}:{} did not return JSON -- endpoint changed".format(kind, target))

    items, total = parse_results(body)
    log.info("source %s:%s returned %d of %s", kind, target, len(items), total)
    return items


def select(kind, items, alert_all_preorder=ALERT_ALL_PREORDER):
    """Alert-worthy: the title matches, or it is new in a pre-order browse."""
    return [
        i
        for i in items
        if matcher.search(i["name"]) or (alert_all_preorder and kind == "browse")
    ]


def collect():
    key = constructor_key()
    specs = [s for s in os.environ.get("SOURCES", DEFAULT_SOURCES).split(",") if s.strip()]
    seen, hits = set(), []
    for spec in specs:
        kind, target = parse_source(spec)
        for item in select(kind, read_source(kind, target, key)):
            if item["id"] in seen:
                continue
            seen.add(item["id"])
            item["source"] = spec
            hits.append(item)
    return hits


def claim(item):
    """
    Conditional put -- True only if this product is new, or if it has since
    flipped into pre-order-active. That flip is the buy signal, so it earns a
    second alert. Doubles as the idempotency guard if two ticks overlap.
    """
    from botocore.exceptions import ClientError

    state = "preorder" if item["preorder"] else "listed"
    now = int(time.time())
    try:
        table().put_item(
            Item={
                "product_id": item["id"],
                "alert_state": state,
                "name": item["name"],
                "first_seen": now,
                "expires_at": now + TTL_DAYS * 86400,
            },
            ConditionExpression="attribute_not_exists(product_id) OR alert_state <> :s",
            ExpressionAttributeValues={":s": state},
        )
        return True
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return False
        raise


def message(hits):
    lines = []
    for p in hits:
        lines.append(("PRE-ORDER OPEN: " if p["preorder"] else "") + p["name"])
        if p["price"] is not None:
            lines.append("  ${}".format(p["price"]))
        lines.append("  " + p["url"])
        lines.append("")
    lines.append("Category: " + PAGE_URL)
    return "\n".join(lines)


def notify(hits):
    first = hits[0]
    subject = "Kmart{}: {}".format(" PRE-ORDER" if first["preorder"] else "", first["name"])[:100]
    sns().publish(TopicArn=os.environ["TOPIC_ARN"], Subject=subject, Message=message(hits))
    log.info("notified on %d product(s)", len(hits))


def lambda_handler(event, context):
    # Any RuntimeError here propagates on purpose: a silently broken watcher is
    # worse than no watcher, and the Errors alarm is what tells you.
    hits = collect()
    fresh = [p for p in hits if claim(p)]

    # {"seed": true} claims today's matches WITHOUT notifying. Invoke it once by
    # hand after the first deploy, or the first tick emails you the ~15 30th
    # anniversary products already on sale and you learn to ignore the alert.
    seed = bool((event or {}).get("seed"))
    pushed = 0
    if fresh and not seed:
        # Push FIRST — it is the channel with a chance of reaching you inside a
        # minute, and it is the whole point of the 1-minute tick. It swallows
        # its own failures, so the email below still goes either way.
        pushed = push.push(fresh)
        notify(fresh)

    result = {
        "candidates": len(hits),
        "new": len(fresh),
        "pushed": pushed,
        "seeded": seed,
        "new_names": [p["name"] for p in fresh],
    }
    log.info(json.dumps({"msg": "kmart.tick", **result}))
    return result
