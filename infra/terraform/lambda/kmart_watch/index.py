"""
Kmart + Big W pre-order watcher.

Alerts the first time a product matching MATCH_PATTERN (default "30th
anniversary") shows up, and again if that product later flips into
pre-order. One SNS message per batch, deduped through DynamoDB.

WHERE THE DATA COMES FROM
-------------------------
Both retailers' category pages are behind Akamai and 403 anything that is not
a real browser. Both, it turns out, have a product API next door that is not.

Kmart (measured 18 Sep 2026):

    GET /category/toys/pre-order/            -> 403 AkamaiGHost
    GET /_next/data/<buildId>/category/...   -> 200, but productResults: null
    GET ac.cnstrc.com/browse/group_id/<id>   -> 200, the products

The grid is client-side, fetched from Constructor.io's public endpoint with a
key that ships in the homepage HTML. Unauthenticated, CDN-fronted, not behind
the bot wall.

Big W (measured 21 Sep 2026) is nastier on the www host: curl cannot even
complete a request (TLS fingerprinting), Python urllib gets the homepage once
and is then tarpitted for minutes after ~30 requests, and every /c/ category
path is 403 even through an AU residential exit. But the site's own search
call is a separate host with none of that:

    POST api.bigw.com.au/search/v1/search
         {"text": ..., "page": 0, "perPage": 150, "sort": "newDesc",
          "format": "1", "clientId": "web"}   -> 200, up to 150 products

Reverse-engineered from the _app chunk: SearchService.search() posts to
endpoints.search() on the apiBase client. perPage caps at 150; sort is one of
relevance|nameAsc|nameDesc|priceAsc|priceDesc|newDesc. Big W has no pre-order
flag -- sellers write "PREORDER" into the product name, so that is what we
read. There is no category browse on this API that we found (the "category"
field is accepted and ignored), which is why Big W is search-only.

So neither retailer needs the residential proxy the Woolworths crawler uses.
Kmart's robots.txt disallows /api/ and both disallow /checkout; the hosts we
read are different hosts, and the pages we link to are Allowed. Read-only, one
request per source per tick.

SOURCES
-------
  browse:615bf6db4dee158ccbbc1ed5aef1ced9   Kmart /category/toys/pre-order/
  search:30th anniversary                   Kmart, site-wide
  bigw:30th anniversary                     Big W, newest first
  bigw:preorder                             Big W, every pre-order, then pattern

The Kmart browse source alerts on ANYTHING new when ALERT_ALL_PREORDER is true
(it held 2 items on 18 Sep 2026, so this is quiet). Every other source alerts
only on pattern matches. A source that fails is logged and skipped so the
others still run; the tick then raises at the end so the Errors alarm fires.

Env vars:
  TABLE_NAME          DynamoDB table, partition key `product_id` (S). Required.
  TOPIC_ARN           SNS topic to publish to. Required.
  MATCH_PATTERN       Case-insensitive regex. Default: 30th\\s*anniversary
  SOURCES             Comma-separated browse:<group_id> / search:<q> / bigw:<q>.
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
BIGW = "https://www.bigw.com.au"
BIGW_SEARCH = "https://api.bigw.com.au/search/v1/search"
PAGE_URL = os.environ.get("PAGE_URL", SITE + "/category/toys/pre-order/")
MATCH_PATTERN = os.environ.get("MATCH_PATTERN", r"30th\s*anniversary")
TTL_DAYS = int(os.environ.get("TTL_DAYS", "90"))
ALERT_ALL_PREORDER = os.environ.get("ALERT_ALL_PREORDER", "true").lower() == "true"
DEFAULT_SOURCES = (
    "browse:615bf6db4dee158ccbbc1ed5aef1ced9,search:30th anniversary,"
    "bigw:30th anniversary,bigw:preorder"
)
KINDS = ("browse", "search", "bigw")

# Big W has no pre-order flag; sellers put it in the name, inconsistently.
PREORDER_IN_NAME = re.compile(r"pre-?\s?order", re.IGNORECASE)

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


def fetch(url, attempts=3, timeout=15, data=None, headers=None):
    """
    GET (or POST, when `data` is given) with a browser UA and linear backoff.
    Returns decoded text. A 4xx/5xx is retried like a transport error: both
    retailers answer a bot-score blip with a one-off 403 that clears.
    """
    last = None
    h = {
        "User-Agent": UA,
        "Accept": "application/json, text/html, */*",
        "Accept-Language": "en-AU,en;q=0.9",
        "Referer": SITE + "/",
    }
    h.update(headers or {})
    for i in range(attempts):
        req = urllib.request.Request(url, data=data, headers=h, method="POST" if data else "GET")
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
    Kmart's Constructor.io key, scraped from the homepage and cached for the
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
    if kind not in KINDS or not target:
        raise RuntimeError(
            "bad SOURCES entry {!r} -- want browse:<group_id>, search:<query> or bigw:<query>".format(
                spec
            )
        )
    return kind, target


# ---------------------------------------------------------------- Kmart


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


def read_kmart(kind, target, key):
    """One page of a Kmart source. Retries once with a re-scraped key if rejected."""
    try:
        raw = fetch(source_url(kind, target, key))
    except RuntimeError as exc:
        if "401" not in str(exc) and "403" not in str(exc):
            raise
        log.warning("source %s:%s rejected the key, re-scraping", kind, target)
        raw = fetch(source_url(kind, target, constructor_key(force=True)))
    return parse_results(as_json(raw, kind, target))


# ---------------------------------------------------------------- Big W


def bigw_request(query, per_page=150):
    """The body the site's own SearchService posts. newDesc: newest listings first."""
    return json.dumps(
        {
            "text": query,
            "page": 0,
            "perPage": per_page,
            "sort": "newDesc",
            "format": "1",
            "clientId": "web",
        }
    ).encode("utf-8")


def normalise_bigw(item):
    ids = item.get("identifiers") or {}
    info = item.get("information") or {}
    pid = str(ids.get("articleId") or "")
    name = info.get("name") or ""
    # Prices are per state; NAT is the national one and always present.
    cents = (((item.get("prices") or {}).get("NAT") or {}).get("price") or {}).get("cents")
    return {
        # Namespaced so a Big W article number can never collide with a Kmart
        # id in the shared table. Kmart ids keep their bare form: changing
        # them would re-alert every product already claimed.
        "id": "bigw:" + pid if pid else "",
        "name": name,
        "url": "{}/p/{}".format(BIGW, pid),
        "price": cents / 100 if isinstance(cents, (int, float)) else None,
        "preorder": bool(PREORDER_IN_NAME.search(name)),
        "brand": (info.get("brand") or {}).get("name") or "",
    }


def parse_bigw(body):
    organic = body.get("organic") or {}
    items = [normalise_bigw(i) for i in organic.get("results") or []]
    return [i for i in items if i["id"]], organic.get("resultsCount")


def read_bigw(target):
    raw = fetch(
        BIGW_SEARCH,
        data=bigw_request(target),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Origin": BIGW,
            "Referer": BIGW + "/",
        },
    )
    return parse_bigw(as_json(raw, "bigw", target))


# ---------------------------------------------------------------- common


def as_json(raw, kind, target):
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        raise RuntimeError("{}:{} did not return JSON -- endpoint changed".format(kind, target))


def read_source(kind, target, key=None):
    """Every item one source returns this tick, normalised to the same shape."""
    if kind == "bigw":
        items, total = read_bigw(target)
    else:
        items, total = read_kmart(kind, target, key or constructor_key())
    log.info("source %s:%s returned %d of %s", kind, target, len(items), total)
    return items


def select(kind, items, alert_all_preorder=ALERT_ALL_PREORDER):
    """Alert-worthy: the title matches, or it is new in a Kmart pre-order browse."""
    return [
        i
        for i in items
        if matcher.search(i["name"]) or (alert_all_preorder and kind == "browse")
    ]


def collect():
    """
    Hits from every source. One retailer failing must not blind the other, so
    a source that raises is logged, skipped, and reported back in `failed`; the
    handler raises AFTER notifying on whatever did come through.
    """
    specs = [s for s in os.environ.get("SOURCES", DEFAULT_SOURCES).split(",") if s.strip()]
    kinds = [parse_source(s) for s in specs]
    key = constructor_key() if any(k != "bigw" for k, _ in kinds) else None

    seen, hits, failed = set(), [], []
    for spec, (kind, target) in zip(specs, kinds):
        try:
            items = read_source(kind, target, key)
        except RuntimeError as exc:
            log.error("source %s failed, skipping: %s", spec, exc)
            failed.append(spec)
            continue
        for item in select(kind, items):
            if item["id"] in seen:
                continue
            seen.add(item["id"])
            item["source"] = spec
            hits.append(item)
    return hits, failed


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


def retailer(item):
    return "Big W" if item["id"].startswith("bigw:") else "Kmart"


def message(hits):
    lines = []
    for p in hits:
        lines.append(
            "[{}] {}{}".format(retailer(p), "PRE-ORDER: " if p["preorder"] else "", p["name"])
        )
        if p["price"] is not None:
            lines.append("  ${}".format(p["price"]))
        lines.append("  " + p["url"])
        lines.append("")
    lines.append("Kmart pre-orders: " + PAGE_URL)
    return "\n".join(lines)


def notify(hits):
    first = hits[0]
    subject = "{}{}: {}".format(
        retailer(first), " PRE-ORDER" if first["preorder"] else "", first["name"]
    )[:100]
    sns().publish(TopicArn=os.environ["TOPIC_ARN"], Subject=subject, Message=message(hits))
    log.info("notified on %d product(s)", len(hits))


def lambda_handler(event, context):
    hits, failed = collect()
    fresh = [p for p in hits if claim(p)]

    # {"seed": true} claims today's matches WITHOUT notifying. Invoke it once by
    # hand after the first deploy, or the first tick emails you the ~15 30th
    # anniversary products already on sale and you learn to ignore the alert.
    seed = bool((event or {}).get("seed"))
    pushed = 0
    if fresh and not seed:
        # Push FIRST -- it is the channel with a chance of reaching you inside a
        # minute, and it is the whole point of the 1-minute tick. It swallows
        # its own failures, so the email below still goes either way.
        pushed = push.push(fresh)
        notify(fresh)

    result = {
        "candidates": len(hits),
        "new": len(fresh),
        "pushed": pushed,
        "seeded": seed,
        "failed_sources": failed,
        "new_names": [p["name"] for p in fresh],
    }
    log.info(json.dumps({"msg": "kmart.tick", **result}))

    # Raised LAST, after the alerts that did come through have gone out: a
    # silently broken source is worse than no watcher, and the Errors alarm is
    # what tells you. Three ticks in a row is the alarm threshold.
    if failed:
        raise RuntimeError("{} source(s) failed this tick: {}".format(len(failed), failed))
    return result
