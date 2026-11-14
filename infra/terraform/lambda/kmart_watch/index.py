"""
Kmart + Big W + Target + JB Hi-Fi pre-order watcher.

Alerts the first time a product matching MATCH_PATTERN shows up -- as a
pre-order OR as an ordinary listing -- and again if it later changes state
(a listing that flips into pre-order, or a pre-order that goes on general
sale). One SNS message per batch, deduped through DynamoDB.

WHAT WE ARE MATCHING
--------------------
The target is the Pokemon 30th range. On 17 Sep 2026 Kmart listed six of them
as pre-orders under the name "Pokemon TCG: 30th Celebration ..." -- NOT "30th
Anniversary", which is what the original pattern wanted, and NOT in the toys
pre-order category (the browse source held 2 unrelated items). Every one was
missed. So the default pattern now takes "30th anniversary" OR "30th
celebration" OR any Pokemon title carrying anniversary/celebration/30th, names
are accent-stripped before matching (Big W writes "Pok\u00e9mon" on some rows),
and the Kmart search sources are sorted newest-first so a fresh listing is on
page one regardless of how many older matches exist (the relevance-sorted
"30th anniversary" search was 105 rows into a 100-row page).

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

Big W (measured 21 Sep 2026) is Woolworths Group and nastier: curl cannot
complete a TLS handshake with www, Python urllib gets the homepage once and is
then tarpitted for minutes after ~30 requests, every /c/ category path is 403
even through an AU residential exit, and the site's own search API answers a
laptop but TARPITS a Lambda IP (read timeout, not a 403). Through the Decodo
residential session the Woolworths crawler already uses, that API is clean:

    POST api.bigw.com.au/search/v1/search
         {"text": ..., "page": 0, "perPage": 48, "sort": "newDesc",
          "filter": {"soldBy": ["BIG W"]},
          "format": "1", "clientId": "web"}   -> 200 in ~3s

Reverse-engineered from the _app chunk: SearchService.search() posts to
endpoints.search() on the apiBase client. perPage caps at 150; sort is one of
relevance|nameAsc|nameDesc|priceAsc|priceDesc|newDesc; "filter" takes the
facets the page shows, and soldBy "BIG W" is the "Sold By" facet that
excludes marketplace sellers (266 of 273 "30th anniversary" results). Big W
has no pre-order flag -- sellers write "PREORDER" into the name, so that is
what we read. There is no category browse on this API that we found (the
"category" field is accepted and ignored), which is why Big W is search-only.

Target (measured 1 Oct 2026) is the easy one, and the reason this function
grew a third retailer instead of a second Lambda: target.com.au is Wesfarmers
like Kmart and runs the SAME Constructor.io engine, with its own key in its own
homepage HTML. No Akamai on the homepage, no proxy, no headless browser --
`GET /` is a plain 200 from a datacenter IP. Only two things differ from Kmart:

  * the newest-first sort is `onlinedate` descending, not
    `numberOfDaysSinceStartDate` ascending (both read off the sort_options
    block every response carries);
  * there is NO pre-order flag anywhere on the row. The buyable signal is
    `availableonlineqty` -- rows sit at 0 while a product is listed but not
    yet purchasable online, which is exactly the state a drop starts in.
    TARGET_STOCK_FLIP turns that into a second alert when it goes 0 -> >0;
    it is OFF by default, because on an ordinary restock it is noise.

Target ids are richer than Kmart's but shaped differently: `data.id` is
"P72301449" and `data.url` is already absolute.

JB Hi-Fi (measured 2 Oct 2026) is Shopify behind Cloudflare Workers, and its
search is ALGOLIA, not Constructor. The app id and the public search key are
hardcoded in the theme bundle (module 76099 of the homepage's bundle.*.js), so
they are defaults here and overridable by env when they rotate:

    POST https://VTVKM5URPX-dsn.algolia.net/1/indexes/shopify_products_families/query
         {"query": "30th anniversary", "hitsPerPage": 100,
          "numericFilters": ["release_date > <epoch>"],
          "filters": "isMarketplace:false AND NOT product_type:MUSIC
                      AND NOT button:DoNotDisplay"}   -> 200 in ~0.5s

Three things about this one are different enough to matter:

  * There is NO date-sorted replica index. Only `_price_asc` and `_price_desc`
    exist (probed by name; a wrong name 404s), so the "newest first" trick
    every other retailer here uses is simply unavailable. Instead the catalogue
    is narrowed by `release_date`, which IS numeric, to a rolling window --
    JB_RELEASE_WINDOW_DAYS. That is also the semantically right filter: a drop
    has a near-future release date, and a pre-order always does.
  * Relevance is an OR match, and the catalogue is 780,376 products. "30th
    anniversary" alone is 2,704 hits, of which the first 550 genuinely match
    the pattern -- reading that needs hitsPerPage 1000, which is 7.5 MB a
    request. attributesToRetrieve cuts a hit from ~7.5 KB to ~365 bytes, so
    100 rows is 36 KB. Both numbers measured.
  * MOST "30th anniversary" products on JB are VINYL REISSUES. Of 33 recent
    pattern matches, 29 were product_type MUSIC. So MUSIC is excluded by
    default (JB_EXCLUDE_TYPES) or this one source out-shouts the other three
    retailers combined. Note `department` is NOT usable for this: Magic: The
    Gathering products are filed under department "MOVIES". product_type is
    consistent.

`button` is JB's pre-order flag -- "Buy", "PreOrder", "DoNotDisplay", "None" --
read off the bundle's own `"Buy"===e.button||"PreOrder"===e.button` check. It
maps onto the same preorder/listed state the Kmart rows use, so a JB listing
that flips Buy <-> PreOrder earns the same second alert. DoNotDisplay rows are
dropped: they are not purchasable and they are noise.

JB's robots.txt disallows /search and /*?q*, so the site's own search is off
limits -- but Algolia is a different host, exactly as ac.cnstrc.com is for
Kmart and Target, and nothing we read is under a disallowed path. Product links
are /products/<handle>, which is Allowed.

So Kmart and Target go direct and Big W goes through the proxy, on a slower
cadence because residential bytes are metered. Kmart's robots.txt disallows /api/ and
both disallow /checkout; the hosts we read are different hosts, and the pages
we link to are Allowed. Read-only, one request per source per tick.

SOURCES
-------
  browse:e35ed26c9b1dfb7fd311f93557216816   Kmart Toys > Latest Arrivals (455)
  search:30th anniversary                   Kmart, site-wide, newest first
  search:30th celebration                   Kmart, site-wide, newest first
  search:pokemon                            Kmart, site-wide, newest first
  bigw:30th anniversary                     Big W, newest first
  bigw:pokemon                              Big W, newest first
  target-browse:W1852642                    Target "Pokemon Cards" (12 items)
  target:pokemon                            Target, site-wide, newest first
  target:30th anniversary                   Target, newest first
  target:mini tin                           Target, newest first
  jb:30th anniversary                       JB Hi-Fi, recent releases only
  jb:pokemon                                JB Hi-Fi, recent releases only

The Kmart browse source alerts on ANYTHING new when ALERT_ALL_PREORDER is true
(it held 2 items on 18 Sep 2026, so this is quiet). Every other source alerts
only on pattern matches. The "pokemon" searches are the safety net: whatever
the range ends up being called, it will have Pokemon in the title, and with
newest-first sort the top of that list is the newest Pokemon product on the
site. Big W search ANDs its terms ("pokemon 30th" -> 0 rows, 21 Sep 2026) so
a broad single word is the right query there. bigw:preorder was dropped: with
the own-stock filter it returns 0 rows, because only marketplace sellers
write PREORDER into a name. A source that fails is logged and skipped so the
others still run; the tick then raises at the end so the Errors alarm fires.

Env vars:
  TABLE_NAME          DynamoDB table, partition key `product_id` (S). Required.
  TOPIC_ARN           SNS topic to publish to. Required.
  MATCH_PATTERN       Case-insensitive regex, matched against the accent-
                      stripped title. Default: see DEFAULT_PATTERN.
  SOURCES             Comma-separated browse:<group_id> / search:<q> /
                      bigw:<q> / target:<q> / target-browse:<group_id> /
                      jb:<q>.
  ALERT_ALL_PREORDER  "true" -> any new item in a browse source alerts.
  TARGET_STOCK_FLIP   "true" -> re-alert when a Target row's
                      availableonlineqty goes 0 -> >0. Default false.
  TARGET_ALERT_ALL_BROWSE  "true" -> any new item in target-browse alerts,
                      not just pattern matches. Default false.
  JB_RELEASE_WINDOW_DAYS   How far back a JB release_date may be. Default 60.
  JB_EXCLUDE_TYPES    Comma-separated product_types to drop. Default "MUSIC".
  JB_INCLUDE_MARKETPLACE   "true" -> third-party JB sellers too. Default false.
  JB_APP_ID / JB_SEARCH_KEY / JB_INDEX   Algolia overrides when they rotate.
  TARGET_CONSTRUCTOR_KEY  Override; otherwise scraped off target.com.au.
  BIGW_INCLUDE_MARKETPLACE  "true" -> third-party sellers too. Default false.
  BIGW_EVERY_MINUTES  Big W cadence in minute-ticks. Default 5.
  PROXY_SECRET_ID / PROXY_URL  Decodo credential for Big W, as the crawler.
  CONSTRUCTOR_KEY     Override; otherwise scraped from the homepage and cached.
  TTL_DAYS            How long a seen product stays deduped. Default 90.
"""

import json
import logging
import os
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

import push

# The Decodo session layer is the crawler's, not a copy: lambda_kmart_watch.tf
# zips proxy.py and secrets_store.py in from ../category_crawler. Locally that
# directory is a sibling, so fall back to it for dry_run.py and the tests.
try:
    import proxy
except ImportError:
    import sys

    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "category_crawler"))
    import proxy

log = logging.getLogger()
log.setLevel(logging.INFO)

SITE = "https://www.kmart.com.au"
AC = "https://ac.cnstrc.com"
BIGW = "https://www.bigw.com.au"
BIGW_SEARCH = "https://api.bigw.com.au/search/v1/search"
TARGET = "https://www.target.com.au"
JB = "https://www.jbhifi.com.au"
# /category/toys/pre-order/ was the original footer link. Kmart DELETED that
# category some time before 2 Oct 2026 -- see DEFAULT_SOURCES -- so linking to
# it would send you to a dead page.
PAGE_URL = os.environ.get("PAGE_URL", SITE + "/category/toys/")
TARGET_PAGE_URL = os.environ.get("TARGET_PAGE_URL", TARGET + "/c/toys/W138532")
# "30th anniversary" is how Rayman, Tomb Raider, Toy Story etc. are named;
# "30th celebration" is what Kmart actually called the Pokemon TCG range; the
# pokemon clause catches a differently worded Pokemon anniversary line such as
# Big W's "Pokemon 20cm Anniversary Pastel Plush". Titles are accent-stripped
# first, so "pokemon" also matches "Pok\u00e9mon".
# "mini tin" is the Pokemon TCG 30th anniversary mini tins specifically. It is
# tight enough to leave the tin CANDLES alone (a Target "mini tin" search
# returns "Anko Christmas Reindeer Tin Candle", which this regex does not
# match) while catching a tin whatever the set is called.
DEFAULT_PATTERN = r"30th\s*(anniversary|celebration)|mini\s*tins?|pokemon.*(anniversary|celebration|30th|30\s*years?)"
MATCH_PATTERN = os.environ.get("MATCH_PATTERN", DEFAULT_PATTERN)
TTL_DAYS = int(os.environ.get("TTL_DAYS", "90"))
# Was true, when browse: was a 2-item pre-order shelf and reading it whole was
# the point. Its replacement is a 455-item Latest Arrivals group, where taking
# everything means an alert per new toy -- so the pattern does the work and
# this defaults off, the same way TARGET_ALERT_ALL_BROWSE does.
ALERT_ALL_PREORDER = os.environ.get("ALERT_ALL_PREORDER", "false").lower() == "true"
# browse: was Kmart's /category/toys/pre-order/ group,
# 615bf6db4dee158ccbbc1ed5aef1ced9. On 2 Oct 2026 that group id returned
# total_num_results 0 with no error and no echoed group -- Kmart has removed
# the category, and there is no pre-order shelf anywhere in the tree any more
# (checked every child of Toys and of Entertainment). A source that returns
# zero rows without raising is the worst failure mode this watcher has: it
# looks exactly like "nothing dropped today", and it had been that way in
# production since at least 21 Sep.
#
# The replacement is Toys > Latest Arrivals (455 items on 2 Oct 2026), which
# is what that category was really for. Because it is 455 items rather than
# the old shelf's 2, it is read newest-first and filtered by the pattern
# rather than taken whole -- see ALERT_ALL_PREORDER, now default false.
DEFAULT_SOURCES = (
    "browse:e35ed26c9b1dfb7fd311f93557216816,"
    "search:30th anniversary,search:30th celebration,search:pokemon,"
    "bigw:30th anniversary,bigw:pokemon,"
    "target-browse:W1852642,"
    "target:pokemon,target:30th anniversary,target:mini tin,"
    "jb:30th anniversary,jb:pokemon"
)
# browse/search are Kmart, bigw is Big W, target/target-browse are Target.
# Kmart's bare kinds keep their names: renaming them would mean rewriting
# SOURCES in terraform.tfvars for no gain.
KINDS = ("browse", "search", "bigw", "target", "target-browse", "jb")
BROWSE_KINDS = ("browse", "target-browse")

# Big W goes out through the residential proxy, and residential bytes are the
# one thing here that costs money (US$4/GB past the 3 GB plan). Measured 21 Sep
# 2026 with the soldBy filter, gzipped on the wire: "30th anniversary" 10 KB
# (7 rows), "pokemon" 62 KB (a full 48 rows). ~72 KB every 5th minute-tick is
# ~0.62 GB/month, inside the ~0.76 GB the cadence was originally sized for.
# Kmart is direct and free, so it stays on every tick.
BIGW_EVERY_MINUTES = int(os.environ.get("BIGW_EVERY_MINUTES", "5"))
BIGW_PER_PAGE = int(os.environ.get("BIGW_PER_PAGE", "48"))

# --------------------------------------------------------------- JB Hi-Fi
#
# App id and public search key as shipped in the theme bundle on 2 Oct 2026.
# They are frontend credentials -- search-only, served to every visitor -- but
# they do rotate, so env wins and the README says where to re-read them.
JB_APP_ID = os.environ.get("JB_APP_ID", "VTVKM5URPX")
JB_SEARCH_KEY = os.environ.get("JB_SEARCH_KEY", "a0c0108d737ad5ab54a0e2da900bf040")
JB_INDEX = os.environ.get("JB_INDEX", "shopify_products_families")
JB_PER_PAGE = int(os.environ.get("JB_PER_PAGE", "100"))

# There is no date-sorted replica index on this app (only _price_asc and
# _price_desc exist), so a rolling release_date window is what keeps the read
# small and recent. 60 days back catches anything already on sale that we have
# not claimed yet; there is no forward bound, because a pre-order's release
# date is deliberately in the future.
JB_RELEASE_WINDOW_DAYS = int(os.environ.get("JB_RELEASE_WINDOW_DAYS", "60"))

# 29 of 33 recent "30th anniversary" matches on JB were vinyl reissues
# (product_type MUSIC). Without this the JB source alone out-shouts the other
# three retailers put together. Set JB_EXCLUDE_TYPES="" to hear all of it.
JB_EXCLUDE_TYPES = [
    t.strip().upper()
    for t in os.environ.get("JB_EXCLUDE_TYPES", "MUSIC").split(",")
    if t.strip()
]
JB_INCLUDE_MARKETPLACE = os.environ.get("JB_INCLUDE_MARKETPLACE", "false").lower() == "true"

# JB's own purchasability flag, straight off the bundle's
# `"Buy"===e.button||"PreOrder"===e.button`. DoNotDisplay and None are rows you
# cannot buy, so they never reach an alert.
JB_BUTTONS_WORTH_ALERTING = ("Buy", "PreOrder")


# Big W has no pre-order flag; sellers put it in the name, inconsistently.
PREORDER_IN_NAME = re.compile(r"pre-?\s?order", re.IGNORECASE)

# Target has no pre-order flag either, but it does carry a real online stock
# count. A row listed at availableonlineqty 0 that goes positive is the moment
# it becomes buyable -- the drop. Off by default because an ordinary restock
# of an already-alerted product looks identical and would be noise; turn it on
# for the window around a drop you are actually waiting for.
TARGET_STOCK_FLIP = os.environ.get("TARGET_STOCK_FLIP", "false").lower() == "true"

# Target's browse group is NOT governed by ALERT_ALL_PREORDER, and the split is
# deliberate. Kmart's browse source is a pre-order shelf that held 2 items, so
# taking everything new in it is both quiet and exactly the point. Target's
# "Pokemon Cards" is an ordinary product group holding 12 unrelated sleeves,
# deck boxes and blisters -- taking everything there means an alert every time
# Target reshuffles an id. So this defaults OFF and the pattern does the work.
# Turn it on to catch a tin filed under a name nobody predicted.
TARGET_ALERT_ALL_BROWSE = (
    os.environ.get("TARGET_ALERT_ALL_BROWSE", "false").lower() == "true"
)

# Marketplace listings are dropped unless asked for. The signal is
# fulfilment.productChannel: "BIGW" is Big W's own stock, "IMP" is a
# third-party seller (The Nile, Gamerholic, KG Superstore...). Measured 21 Sep
# 2026: 148 of 150 "30th anniversary" results and 109 of 109 "preorder"
# results were IMP. information.vendors is NOT the signal -- that is the
# supplier (Jazwares, Scholastic), and Big W's own stock has one too.
BIGW_INCLUDE_MARKETPLACE = os.environ.get("BIGW_INCLUDE_MARKETPLACE", "false").lower() == "true"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
)

matcher = re.compile(MATCH_PATTERN, re.IGNORECASE)

# Constructor keys, one per site: Kmart and Target each ship their own in their
# own homepage HTML, and they are not interchangeable.
_key_cache = {
    SITE: os.environ.get("CONSTRUCTOR_KEY") or None,
    TARGET: os.environ.get("TARGET_CONSTRUCTOR_KEY") or None,
}
_table = None
_sns = None
_bigw_session = None


def bigw_session():
    """
    One sticky residential session per container, resolved from PROXY_URL or
    PROXY_SECRET_ID exactly as the crawler does. With neither set this is None
    and Big W goes direct -- which the Lambda IP cannot do (it is tarpitted,
    measured 21 Sep 2026), but a laptop can, so dry_run.py still works.
    """
    global _bigw_session
    if _bigw_session is None:
        p = proxy.resolve_proxy()
        _bigw_session = proxy.create_session(p) or False
        log.info("bigw egress: %s", _bigw_session.describe() if _bigw_session else "direct")
    return _bigw_session or None


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


def fetch(url, attempts=3, timeout=15, data=None, headers=None, opener=None):
    """
    GET (or POST, when `data` is given) with a browser UA and linear backoff,
    through `opener` when one is given (the proxy session's) else direct.
    Returns decoded text, gunzipped if the server compressed it. A 4xx/5xx is
    retried like a transport error: both retailers answer a bot-score blip with
    a one-off 403 that clears.
    """
    last = None
    h = {
        "User-Agent": UA,
        "Accept": "application/json, text/html, */*",
        "Accept-Language": "en-AU,en;q=0.9",
        "Accept-Encoding": "gzip",
        "Referer": SITE + "/",
    }
    h.update(headers or {})
    open_ = opener.open if opener else urllib.request.urlopen
    for i in range(attempts):
        req = urllib.request.Request(url, data=data, headers=h, method="POST" if data else "GET")
        try:
            with open_(req, timeout=timeout) as resp:
                return proxy._decode(resp.read(), resp.headers.get("Content-Encoding"))
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError) as exc:
            last = exc
            log.warning("fetch attempt %d/%d failed for %s: %s", i + 1, attempts, url, exc)
            if i < attempts - 1:
                time.sleep(2 * (i + 1))
    raise RuntimeError("could not fetch {}: {}".format(url, last))


def constructor_key(site=SITE, force=False):
    """
    A site's Constructor.io key, scraped from its homepage and cached for the
    life of the container. Keys rotate; re-scraping beats redeploying. Kmart
    and Target have separate keys and separate cache slots.
    """
    if _key_cache.get(site) and not force:
        return _key_cache[site]
    _key_cache[site] = key_from_html(fetch(site + "/", headers={"Referer": site + "/"}))
    log.info("discovered constructor key for %s: %s", site, _key_cache[site])
    return _key_cache[site]


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
            "bad SOURCES entry {!r} -- want one of {}".format(
                spec, ", ".join(k + ":<group_id|query>" for k in KINDS)
            )
        )
    return kind, target


def site_of(kind):
    """
    The homepage a kind's Constructor key is scraped from. None for the kinds
    that are not Constructor at all (Big W's own API, JB's Algolia).
    """
    if kind in ("target", "target-browse"):
        return TARGET
    if kind in ("bigw", "jb"):
        return None
    return SITE


def is_browse(kind):
    return kind in BROWSE_KINDS


# ------------------------------------------------- Kmart + Target (Constructor)

# Each site's own "newest first" sort option, read off the sort_options block
# that every Constructor response carries. The field names are unrelated --
# Kmart counts days since start ascending, Target sorts an epoch descending --
# so neither is guessable from the other and both are pinned here.
NEW_SORT = {
    SITE: ("numberOfDaysSinceStartDate", "ascending"),
    TARGET: ("onlinedate", "descending"),
}

# Target rows carry ~40 fields each (~5 KB a row against Kmart's ~250 bytes),
# so a 100-row page is half a megabyte of JSON for no benefit: newest-first
# sort puts a drop on row one. Kmart stays at 100 -- it is cheap there, and
# the 100-row page is what the relevance-sort miss of 17 Sep 2026 argued for.
PER_PAGE = {SITE: 100, TARGET: int(os.environ.get("TARGET_PER_PAGE", "30"))}


def source_url(kind, target, key, page=1, per_page=None):
    """
    Everything is sorted newest-first: that is the site's own "New"/"Latest"
    sort option, and it is what makes one page enough. On relevance the Kmart
    "30th anniversary" search had 105 rows and a new listing could sit past the
    100-row page.

    Kmart's browse used to be the exception -- left on the category's own order
    because the pre-order shelf held 2 items and was read whole. That shelf no
    longer exists (see DEFAULT_SOURCES); its replacement holds 455, of which we
    read 100, so an unsorted page would be an arbitrary 100 of 455 and a new
    arrival could sit outside it indefinitely. Verified 2 Oct 2026 that the
    group accepts the sort: the 4th row of the sorted page was the Pokemon TCG
    30th Celebration Mini Tin.
    """
    site = site_of(kind)
    params = {
        "key": key,
        "i": "target-preorder-watcher" if site == TARGET else "kmart-preorder-watcher",
        "s": "1",
        "c": "ciojs-client-2.6.0",
        "num_results_per_page": PER_PAGE[site] if per_page is None else per_page,
        "page": page,
    }
    params["sort_by"], params["sort_order"] = NEW_SORT[site]
    path = (
        "/browse/group_id/" + urllib.parse.quote(target)
        if is_browse(kind)
        else "/search/" + urllib.parse.quote(target)
    )
    return AC + path + "?" + urllib.parse.urlencode(params)


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


def read_constructor(kind, target, key):
    """One page of a Kmart or Target Constructor source, already normalised."""
    site = site_of(kind)
    try:
        raw = fetch(source_url(kind, target, key), headers={"Referer": site + "/"})
    except RuntimeError as exc:
        if "401" not in str(exc) and "403" not in str(exc):
            raise
        log.warning("source %s:%s rejected the key, re-scraping", kind, target)
        raw = fetch(
            source_url(kind, target, constructor_key(site, force=True)),
            headers={"Referer": site + "/"},
        )
    body = as_json(raw, kind, target)
    if site == TARGET:
        return parse_target(body)
    return parse_results(body)


def parse_results(body):
    resp = body.get("response") or {}
    items = [normalise(i) for i in resp.get("results") or []]
    return [i for i in items if i["id"]], resp.get("total_num_results")


def normalise_target(item):
    """
    A Target row. Same engine as Kmart, different field names:

      data.id                  "P72301449" -- the P is Target's, not ours
      data.url                 already absolute
      data.price               dollars
      data.availableonlineqty  online stock; 0 while listed-but-not-buyable
      data.availablestoreqty   in-store stock, informational only
      data.onlinedate          epoch seconds the listing went live

    There is no pre-order flag of any kind on this index, so `preorder` is
    False for every Target row and the alert is decorated from stock instead.
    """
    d = item.get("data") or {}
    pid = str(d.get("id") or "")
    url = d.get("url") or ""
    oq = d.get("availableonlineqty")
    return {
        # Namespaced like the Big W rows so a Target id can never collide with
        # a Kmart one in the shared table.
        "id": "target:" + pid if pid else "",
        "name": item.get("value") or "",
        "url": url if url.startswith("http") else TARGET + url,
        "price": d.get("price"),
        "preorder": False,
        "brand": d.get("brand") or "",
        "online_qty": oq if isinstance(oq, (int, float)) else None,
        "store_qty": d.get("availablestoreqty"),
        "online_date": d.get("onlinedate"),
    }


def target_state(item):
    """
    What `claim` stores as alert_state for a Target row. With the flip off this
    is a constant, so a Target product alerts exactly once -- ever. With it on,
    "soldout" -> "buyable" earns a second alert, which is the drop going live.
    """
    if not TARGET_STOCK_FLIP or item.get("online_qty") is None:
        return "listed"
    return "buyable" if item["online_qty"] > 0 else "soldout"


def parse_target(body):
    resp = body.get("response") or {}
    items = [normalise_target(i) for i in resp.get("results") or []]
    items = [i for i in items if i["id"]]
    for i in items:
        i["state"] = target_state(i)
    return items, resp.get("total_num_results")


# ---------------------------------------------------------------- Big W


def bigw_request(query, per_page=BIGW_PER_PAGE, include_marketplace=BIGW_INCLUDE_MARKETPLACE):
    """
    The body the site's own SearchService posts. newDesc puts the newest
    listing first, which is why 48 results is enough: a drop is row one.

    The soldBy filter is the site's own "Sold By: BIG W" facet, applied
    server-side. Without it the newest-48 window is all marketplace (266 of
    273 on 21 Sep 2026) and Big W's own stock never makes the page; with it the
    window is all own stock and the response is a fraction of the bytes, which
    matters because this goes over the metered residential exit.
    """
    body = {
        "text": query,
        "page": 0,
        "perPage": per_page,
        "sort": "newDesc",
        "format": "1",
        "clientId": "web",
    }
    if not include_marketplace:
        body["filter"] = {"soldBy": ["BIG W"]}
    return json.dumps(body).encode("utf-8")


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
        "marketplace": (item.get("fulfilment") or {}).get("productChannel") != "BIGW",
    }


def parse_bigw(body, include_marketplace=BIGW_INCLUDE_MARKETPLACE):
    organic = body.get("organic") or {}
    items = [normalise_bigw(i) for i in organic.get("results") or []]
    items = [i for i in items if i["id"]]
    if not include_marketplace:
        # Belt and braces behind the server-side soldBy filter: if Big W ever
        # stops honouring it, marketplace rows still never reach an alert.
        own = [i for i in items if not i["marketplace"]]
        if len(own) != len(items):
            log.warning("bigw: %d marketplace rows leaked past the soldBy filter", len(items) - len(own))
        items = own
    return items, organic.get("resultsCount")


def read_bigw(target):
    # Two attempts at 15s, not three at the default: the failure mode here is
    # a tarpit, not a refusal, and a tarpitted request holds the whole tick.
    session = bigw_session()
    raw = fetch(
        BIGW_SEARCH,
        attempts=2,
        timeout=15,
        data=bigw_request(target),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Origin": BIGW,
            "Referer": BIGW + "/",
        },
        opener=session.opener if session else None,
    )
    return parse_bigw(as_json(raw, "bigw", target))


def bigw_due(now=None, every=BIGW_EVERY_MINUTES):
    """Big W runs on the minute-ticks divisible by BIGW_EVERY_MINUTES."""
    now = time.time() if now is None else now
    return every <= 1 or int(now // 60) % every == 0


# ---------------------------------------------------------------- JB Hi-Fi


def jb_cutoff(now=None, days=None):
    """Epoch floor for release_date. Products older than this are not news."""
    now = time.time() if now is None else now
    days = JB_RELEASE_WINDOW_DAYS if days is None else days
    return int(now - days * 86400)


def jb_filters(include_marketplace=None, exclude_types=None):
    """
    The server-side filter string. Every clause here is a measured decision --
    see the module docstring -- and doing it server-side rather than in Python
    is what keeps the response at 36 KB instead of megabytes.
    """
    include_marketplace = (
        JB_INCLUDE_MARKETPLACE if include_marketplace is None else include_marketplace
    )
    exclude_types = JB_EXCLUDE_TYPES if exclude_types is None else exclude_types

    clauses = []
    if not include_marketplace:
        clauses.append("isMarketplace:false")
    # Rows you cannot buy are not a drop.
    clauses.append("NOT button:DoNotDisplay")
    for t in exclude_types:
        clauses.append('NOT product_type:"{}"'.format(t))
    return " AND ".join(clauses)


def jb_request(query, per_page=None, now=None):
    """
    The Algolia query body. attributesToRetrieve is not an optimisation detail
    here, it is the difference between 365 bytes and 7.5 KB a row, and this
    runs every tick.
    """
    body = {
        "query": query,
        "hitsPerPage": JB_PER_PAGE if per_page is None else per_page,
        "numericFilters": ["release_date > {}".format(jb_cutoff(now))],
        "filters": jb_filters(),
        "attributesToRetrieve": [
            "objectID",
            "title",
            "handle",
            "price",
            "button",
            "isMarketplace",
            "product_type",
            "release_date",
            "vendor",
            "sku",
        ],
        "attributesToHighlight": [],
    }
    return json.dumps(body).encode("utf-8")


def jb_release_date(hit):
    """release_date is epoch seconds; render it as a date or not at all."""
    rd = hit.get("release_date")
    if not isinstance(rd, (int, float)):
        return None
    try:
        return time.strftime("%Y-%m-%d", time.gmtime(rd))
    except (ValueError, OSError):
        return None


def normalise_jb(hit):
    pid = str(hit.get("objectID") or "")
    handle = hit.get("handle") or ""
    price = hit.get("price")
    return {
        # Namespaced like the other non-Kmart retailers so ids cannot collide.
        "id": "jb:" + pid if pid else "",
        "name": hit.get("title") or "",
        "url": "{}/products/{}".format(JB, handle) if handle else JB,
        "price": price if isinstance(price, (int, float)) else None,
        # Same semantics as Kmart's isPreOrderActive, so a Buy <-> PreOrder
        # flip earns a second alert through the shared claim() path.
        "preorder": hit.get("button") == "PreOrder",
        "brand": hit.get("vendor") or "",
        "button": hit.get("button"),
        "product_type": hit.get("product_type"),
        "release_date": jb_release_date(hit),
        "marketplace": bool(hit.get("isMarketplace")),
    }


def parse_jb(body, include_marketplace=None, exclude_types=None):
    """
    Belt and braces behind the server-side filters: if Algolia ever stops
    honouring one, a marketplace row, an excluded type or an unbuyable row
    still cannot reach an alert.
    """
    include_marketplace = (
        JB_INCLUDE_MARKETPLACE if include_marketplace is None else include_marketplace
    )
    exclude_types = JB_EXCLUDE_TYPES if exclude_types is None else exclude_types

    items = [normalise_jb(h) for h in body.get("hits") or []]
    items = [i for i in items if i["id"]]

    kept = []
    for i in items:
        if not include_marketplace and i["marketplace"]:
            continue
        if i["button"] not in JB_BUTTONS_WORTH_ALERTING:
            continue
        if (i["product_type"] or "").upper() in exclude_types:
            continue
        kept.append(i)
    if len(kept) != len(items):
        log.info("jb: dropped %d of %d rows post-filter", len(items) - len(kept), len(items))
    return kept, body.get("nbHits")


def read_jb(target):
    url = "https://{}-dsn.algolia.net/1/indexes/{}/query".format(
        JB_APP_ID, urllib.parse.quote(JB_INDEX)
    )
    raw = fetch(
        url,
        data=jb_request(target),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-Algolia-Application-Id": JB_APP_ID,
            "X-Algolia-API-Key": JB_SEARCH_KEY,
            "Referer": JB + "/",
        },
    )
    return parse_jb(as_json(raw, "jb", target))


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
    elif kind == "jb":
        items, total = read_jb(target)
    else:
        site = site_of(kind)
        items, total = read_constructor(kind, target, key or constructor_key(site))
    log.info("source %s:%s returned %d of %s", kind, target, len(items), total)
    return items


def plain(name):
    """Accent-stripped, so a pattern written as "pokemon" matches "Pok\u00e9mon"."""
    return "".join(
        c for c in unicodedata.normalize("NFKD", name) if not unicodedata.combining(c)
    )


def matches(name):
    return bool(matcher.search(plain(name)))


def select(
    kind,
    items,
    alert_all_preorder=ALERT_ALL_PREORDER,
    target_alert_all=TARGET_ALERT_ALL_BROWSE,
):
    """
    Alert-worthy: the title matches, or it is new in a browse source whose
    take-everything flag is on. Pre-order status is deliberately NOT a
    condition -- a matching product that goes straight to ordinary sale alerts
    just the same.

    The two browse kinds have separate flags on purpose; see
    TARGET_ALERT_ALL_BROWSE. Both now default off: Kmart's pre-order shelf -- 2
    items, worth reading whole -- was deleted by Kmart, and both retailers'
    browse sources are now ordinary product groups of 455 and 12 items.
    """
    if kind == "target-browse":
        take_all = target_alert_all
    else:
        take_all = alert_all_preorder and kind == "browse"
    return [i for i in items if matches(i["name"]) or take_all]


def collect(all_sources=False):
    """
    Hits from every source due this tick. One retailer failing must not blind
    the other, so a source that raises is logged, skipped, and reported back in
    `failed`; the handler raises AFTER notifying on whatever did come through.
    `all_sources` ignores the Big W cadence -- the seed run uses it.
    """
    specs = [s for s in os.environ.get("SOURCES", DEFAULT_SOURCES).split(",") if s.strip()]
    kinds = [parse_source(s) for s in specs]
    # Keys are resolved per site inside read_source and cached per container.
    # Deliberately NOT pre-resolved here any more: with two Constructor sites
    # in play, a failed Target key scrape must cost Target its tick and not
    # Kmart's, and the per-source try/except below is what gives that.
    skip_bigw = not all_sources and not bigw_due()

    seen, hits, failed = set(), [], []
    for spec, (kind, target) in zip(specs, kinds):
        if kind == "bigw" and skip_bigw:
            continue
        try:
            items = read_source(kind, target)
        except Exception as exc:  # noqa: BLE001 -- isolation is the point
            # Broad on purpose: a ProxyError or a Secrets Manager failure on
            # the Big W side must not cost the Kmart sources their tick.
            log.error("source %s failed, skipping: %s: %s", spec, type(exc).__name__, exc)
            failed.append(spec)
            continue
        for item in select(kind, items):
            if item["id"] in seen:
                continue
            seen.add(item["id"])
            item["source"] = spec
            # push.py titles the notification with this; it has no other way
            # to tell which retailer a hit came from.
            item["retailer"] = retailer(item)
            hits.append(item)
    return hits, failed


def claim(item):
    """
    Conditional put -- True only if this product is new, or if its state has
    changed since: listed -> pre-order (the pre-order opened) or pre-order ->
    listed (it went on general sale). Either flip is a buy signal, so it earns
    a second alert. Doubles as the idempotency guard if two ticks overlap.
    """
    from botocore.exceptions import ClientError

    # Target rows carry their own state (see target_state); Kmart and Big W
    # derive it from the pre-order flag, which is what they have.
    state = item.get("state") or ("preorder" if item["preorder"] else "listed")
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
    if item["id"].startswith("bigw:"):
        return "Big W"
    if item["id"].startswith("target:"):
        return "Target"
    if item["id"].startswith("jb:"):
        return "JB Hi-Fi"
    return "Kmart"


def message(hits):
    lines = []
    for p in hits:
        lines.append(
            "[{}] {}{}".format(retailer(p), "PRE-ORDER: " if p["preorder"] else "", p["name"])
        )
        if p["price"] is not None:
            lines.append("  ${}".format(p["price"]))
        # Target is the only retailer here that gives a real number, and for a
        # drop it is the whole story: 0 online means listed but not yet
        # buyable, so the link is worth keeping open rather than tapping once.
        # JB's pre-orders are the only rows here with a release date, and for a
        # pre-order it is the thing you actually want to know.
        if p.get("release_date"):
            lines.append("  releases {}".format(p["release_date"]))
        if p.get("online_qty") is not None:
            lines.append(
                "  online stock: {}{}".format(
                    p["online_qty"],
                    "  (listed, NOT yet buyable online)" if p["online_qty"] == 0 else "",
                )
            )
        lines.append("  " + p["url"])
        lines.append("")
    # Only the shelves a hit actually came from, so the email does not send you
    # to Kmart for a Target tin.
    shops = {retailer(p) for p in hits}
    if "Kmart" in shops or "Big W" in shops:
        lines.append("Kmart pre-orders: " + PAGE_URL)
    if "Target" in shops:
        lines.append("Target toys: " + TARGET_PAGE_URL)
    if "JB Hi-Fi" in shops:
        lines.append("JB Hi-Fi: " + JB + "/")
    return "\n".join(lines)


def notify(hits):
    first = hits[0]
    subject = "{}{}: {}".format(
        retailer(first), " PRE-ORDER" if first["preorder"] else "", first["name"]
    )[:100]
    sns().publish(TopicArn=os.environ["TOPIC_ARN"], Subject=subject, Message=message(hits))
    log.info("notified on %d product(s)", len(hits))


def lambda_handler(event, context):
    # {"seed": true} claims today's matches WITHOUT notifying, across every
    # source regardless of cadence. Invoke it once by hand after a deploy that
    # adds a source, or the first tick emails you everything already on sale
    # and you learn to ignore the alert.
    seed = bool((event or {}).get("seed"))
    hits, failed = collect(all_sources=seed)
    fresh = [p for p in hits if claim(p)]
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
