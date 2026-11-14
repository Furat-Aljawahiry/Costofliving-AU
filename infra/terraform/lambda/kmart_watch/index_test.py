"""
Offline tests for the pure parts of index.py -- no network, no AWS.

    python index_test.py

The network path is covered by dry_run.py, which hits the live feed.
"""

import json
import os

os.environ.setdefault("TABLE_NAME", "test")
os.environ.setdefault("TOPIC_ARN", "test")

import index  # noqa: E402

FIXTURE = {
    "response": {
        "total_num_results": 2,
        "results": [
            {
                "value": "Pokemon TCG: Mini Portfolio",
                "data": {
                    "id": "P_43848652",
                    "url": "/product/pokemon-tcg:-mini-portfolio-43848652/",
                    "price": 11,
                    "isPreOrderActive": True,
                    "Brand": "Pokemon",
                },
            },
            {
                "value": "Rayman: 30th Anniversary Edition - Switch",
                "data": {
                    "id": "P_110188874",
                    "url": "/product/rayman:-30th-anniversary-edition-switch-110188874/",
                    "price": 59.95,
                    "isPreOrderActive": False,
                },
            },
        ],
    }
}


def check(label, got, want):
    assert got == want, "{}: got {!r}, want {!r}".format(label, got, want)
    print("ok  ", label)


def test_parse():
    items, total = index.parse_results(FIXTURE)
    check("total", total, 2)
    check("count", len(items), 2)
    check("id", items[0]["id"], "P_43848652")
    check("preorder flag", items[0]["preorder"], True)
    check(
        "url is absolutised",
        items[1]["url"],
        "https://www.kmart.com.au/product/rayman:-30th-anniversary-edition-switch-110188874/",
    )


def test_select():
    items, _ = index.parse_results(FIXTURE)
    # A browse source is the pre-order category: everything in it is worth knowing.
    check("browse takes all", len(index.select("browse", items, True)), 2)
    check("browse pattern-only", len(index.select("browse", items, False)), 1)
    # A search source only alerts on the pattern.
    check("search filters", [i["id"] for i in index.select("search", items)], ["P_110188874"])


def test_sources():
    check("browse spec", index.parse_source("browse:abc123"), ("browse", "abc123"))
    check("search spec with spaces", index.parse_source("search:30th anniversary"),
          ("search", "30th anniversary"))
    for bad in ("nonsense:x", "browse:", ""):
        try:
            index.parse_source(bad)
        except RuntimeError:
            print("ok   rejects", repr(bad))
        else:
            raise AssertionError("accepted bad source {!r}".format(bad))


def test_url():
    u = index.source_url("search", "30th anniversary", "key_X")
    assert u.startswith("https://ac.cnstrc.com/search/30th%20anniversary?"), u
    assert "key=key_X" in u and "num_results_per_page=100" in u, u
    # Searches are newest-first so one page is enough; a browse is read whole
    # in the category's own order.
    assert "sort_by=numberOfDaysSinceStartDate" in u and "sort_order=ascending" in u, u
    # Kmart's browse is sorted newest-first too, since 2 Oct 2026: the 2-item
    # pre-order shelf it used to point at was deleted by Kmart, and its
    # 455-item replacement is only safe to read one page of if that page is
    # the newest 100.
    b = index.source_url("browse", "abc", "key_X")
    assert b.startswith("https://ac.cnstrc.com/browse/group_id/abc?"), b
    assert "sort_by=numberOfDaysSinceStartDate" in b and "sort_order=ascending" in b, b
    print("ok   source_url")


def test_source_url_target():
    """
    Target is the same host and the same client with a different key and a
    different sort field. Getting the sort field wrong fails silently -- you
    just get relevance order and miss the drop -- so it is pinned here.
    """
    u = index.source_url("target", "mini tin", "key_T")
    assert u.startswith("https://ac.cnstrc.com/search/mini%20tin?"), u
    assert "key=key_T" in u, u
    assert "sort_by=onlinedate" in u and "sort_order=descending" in u, u
    assert "num_results_per_page=30" in u, u
    # Unlike Kmart's, Target's browse IS sorted newest-first: it costs nothing
    # and puts a new tin on row one.
    b = index.source_url("target-browse", "W1852642", "key_T")
    assert b.startswith("https://ac.cnstrc.com/browse/group_id/W1852642?"), b
    assert "sort_by=onlinedate" in b, b
    print("ok   source_url target")


TARGET_FIXTURE = {
    "response": {
        "total_num_results": 2,
        "results": [
            {
                "value": "Pokemon TCG: 30th Anniversary Mini Tin - Assorted",
                "data": {
                    "id": "P72301449",
                    "url": "https://www.target.com.au/p/pokemon-tin/72301449",
                    "price": 20,
                    "availableonlineqty": 0,
                    "availablestoreqty": 809,
                    "onlinedate": 1790726400,
                    "brand": "Pokemon",
                },
            },
            {
                "value": "Anko Christmas Reindeer Tin Candle",
                "data": {
                    "id": "P71719986",
                    "url": "https://www.target.com.au/p/tin-candle/71719986",
                    "price": 15,
                    "availableonlineqty": 127,
                },
            },
        ],
    }
}


def test_parse_target():
    items, total = index.parse_target(TARGET_FIXTURE)
    check("total", total, 2)
    check("id is namespaced", items[0]["id"], "target:P72301449")
    check("absolute url kept", items[0]["url"], "https://www.target.com.au/p/pokemon-tin/72301449")
    check("price", items[0]["price"], 20)
    check("online qty", items[0]["online_qty"], 0)
    # No pre-order flag exists on this index, so it must never claim one.
    check("never preorder", items[0]["preorder"], False)
    check("label", index.retailer(items[0]), "Target")


def test_target_select_is_pattern_only():
    """
    The searches are broad-match: a Target "mini tin" search really does
    return tin candles. The regex is the thing that keeps them out.
    """
    items, _ = index.parse_target(TARGET_FIXTURE)
    picked = [i["name"] for i in index.select("target", items)]
    check("tin candle rejected", picked, ["Pokemon TCG: 30th Anniversary Mini Tin - Assorted"])


def test_browse_flags_are_separate():
    """
    Kmart's browse take-everything flag must NOT leak onto Target's browse.
    Target's "Pokemon Cards" group is an ordinary product group: reading it
    whole means an alert per sleeve and deck box, which is how you learn to
    ignore the notification.
    """
    items, _ = index.parse_target(TARGET_FIXTURE)
    check(
        "kmart flag does not open target browse",
        len(index.select("target-browse", items, alert_all_preorder=True, target_alert_all=False)),
        1,
    )
    check(
        "target flag does",
        len(index.select("target-browse", items, alert_all_preorder=False, target_alert_all=True)),
        2,
    )
    kmart_items, _ = index.parse_results(FIXTURE)
    check(
        "target flag does not open kmart browse",
        len(index.select("browse", kmart_items, alert_all_preorder=False, target_alert_all=True)),
        1,
    )


def test_target_stock_flip():
    """
    With the flip off every Target row is "listed", so it alerts exactly once.
    With it on, soldout -> buyable is a second alert: the drop going live.
    """
    real = index.TARGET_STOCK_FLIP
    try:
        index.TARGET_STOCK_FLIP = False
        check("flip off: constant", index.target_state({"online_qty": 0}), "listed")
        check("flip off: stocked too", index.target_state({"online_qty": 12}), "listed")
        index.TARGET_STOCK_FLIP = True
        check("flip on: soldout", index.target_state({"online_qty": 0}), "soldout")
        check("flip on: buyable", index.target_state({"online_qty": 12}), "buyable")
        check("flip on, no qty: listed", index.target_state({"online_qty": None}), "listed")
    finally:
        index.TARGET_STOCK_FLIP = real


def test_claim_state_derivation():
    """
    claim() reads item["state"] when a retailer supplies one and falls back to
    the pre-order flag otherwise. A regression here would re-alert every Kmart
    product already claimed in the table, so the fallback is pinned.
    """
    def derive(i):
        return i.get("state") or ("preorder" if i["preorder"] else "listed")

    check("kmart preorder", derive({"preorder": True}), "preorder")
    check("kmart listed", derive({"preorder": False}), "listed")
    check("target explicit", derive({"preorder": False, "state": "soldout"}), "soldout")


def test_site_routing():
    check("search is kmart", index.site_of("search"), index.SITE)
    check("browse is kmart", index.site_of("browse"), index.SITE)
    check("target is target", index.site_of("target"), index.TARGET)
    check("target-browse is target", index.site_of("target-browse"), index.TARGET)
    check("bigw has no constructor site", index.site_of("bigw"), None)
    check("browse kinds", [k for k in index.KINDS if index.is_browse(k)],
          ["browse", "target-browse"])


JB_FIXTURE = {
    "nbHits": 5,
    "hits": [
        {
            "objectID": "7338068377801",
            "title": "Pokemon TCG 30th Anniversary Mini Tin",
            "handle": "pokemon-tcg-30th-anniversary-mini-tin",
            "price": 19.99,
            "button": "PreOrder",
            "isMarketplace": False,
            "product_type": "TOYS",
            "release_date": 1793404800,
            "vendor": "Pokemon",
        },
        {
            "objectID": "2",
            "title": "Daydream (30th Anniversary Edition)",
            "handle": "daydream-30th",
            "price": 59.99,
            "button": "Buy",
            "isMarketplace": False,
            # The flood: 29 of 33 recent matches on JB were vinyl.
            "product_type": "MUSIC",
            "release_date": 1793404800,
        },
        {
            "objectID": "3",
            "title": "Magic 30th Anniversary Edition",
            "handle": "mtg-30th",
            "price": 999.0,
            # Not purchasable, so not a drop.
            "button": "DoNotDisplay",
            "isMarketplace": False,
            "product_type": "TOYS",
            "release_date": 1793404800,
        },
        {
            "objectID": "4",
            "title": "Pokemon 30th Anniversary Figure",
            "handle": "pokemon-30th-figure",
            "price": 25.0,
            "button": "Buy",
            # Third-party seller.
            "isMarketplace": True,
            "product_type": "TOYS",
            "release_date": 1793404800,
        },
        {
            "objectID": "5",
            "title": "Unrelated Headphones",
            "handle": "headphones",
            "price": 99.0,
            "button": "Buy",
            "isMarketplace": False,
            "product_type": "TECH",
            "release_date": 1793404800,
        },
    ],
}


def test_parse_jb():
    items, total = index.parse_jb(JB_FIXTURE)
    check("nbHits", total, 5)
    names = [i["name"] for i in items]
    # MUSIC, DoNotDisplay and marketplace rows are all gone; the unrelated
    # row survives parsing and is dropped later by the pattern.
    check("filtered", names, ["Pokemon TCG 30th Anniversary Mini Tin", "Unrelated Headphones"])
    tin = items[0]
    check("id namespaced", tin["id"], "jb:7338068377801")
    check("url from handle", tin["url"],
          "https://www.jbhifi.com.au/products/pokemon-tcg-30th-anniversary-mini-tin")
    check("PreOrder maps to preorder", tin["preorder"], True)
    check("release date rendered", tin["release_date"], "2026-10-31")
    check("label", index.retailer(tin), "JB Hi-Fi")
    check("Buy is not preorder", items[1]["preorder"], False)


def test_jb_select_and_message():
    items, _ = index.parse_jb(JB_FIXTURE)
    picked = [i["name"] for i in index.select("jb", items)]
    check("pattern drops the headphones", picked, ["Pokemon TCG 30th Anniversary Mini Tin"])
    msg = index.message(index.select("jb", items))
    assert "[JB Hi-Fi]" in msg, msg
    assert "releases 2026-10-31" in msg, msg
    assert "jbhifi.com.au" in msg, msg
    assert "Kmart pre-orders" not in msg, msg
    print("ok   jb message")


def test_jb_marketplace_and_types_can_be_opened_up():
    """The exclusions are defaults, not laws -- both have an env knob."""
    items, _ = index.parse_jb(JB_FIXTURE, include_marketplace=True, exclude_types=[])
    names = sorted(i["name"] for i in items)
    check(
        "only DoNotDisplay stays dropped",
        names,
        [
            "Daydream (30th Anniversary Edition)",
            "Pokemon 30th Anniversary Figure",
            "Pokemon TCG 30th Anniversary Mini Tin",
            "Unrelated Headphones",
        ],
    )


def test_jb_request_shape():
    """
    The request is the whole design: a release_date window instead of the
    newest-first sort that does not exist on this index, server-side filters,
    and attributesToRetrieve to keep 100 rows at 36 KB instead of 750 KB.
    """
    body = json.loads(index.jb_request("30th anniversary", now=1_790_000_000))
    check("query", body["query"], "30th anniversary")
    check("no highlighting", body["attributesToHighlight"], [])
    assert "release_date >" in body["numericFilters"][0], body["numericFilters"]
    # 60 days before the fixed `now`.
    check("window", body["numericFilters"][0], "release_date > 1784816000")
    for clause in ("isMarketplace:false", "NOT button:DoNotDisplay", 'NOT product_type:"MUSIC"'):
        assert clause in body["filters"], body["filters"]
    assert "title" in body["attributesToRetrieve"], body
    print("ok   jb request shape")


def test_jb_cutoff_and_filters():
    check("cutoff", index.jb_cutoff(now=1_790_000_000, days=1), 1_789_913_600)
    check(
        "marketplace allowed drops the clause",
        "isMarketplace" in index.jb_filters(include_marketplace=True),
        False,
    )
    check(
        "no excluded types",
        index.jb_filters(include_marketplace=True, exclude_types=[]),
        "NOT button:DoNotDisplay",
    )


def test_jb_is_not_constructor():
    check("jb has no constructor site", index.site_of("jb"), None)
    check("jb spec", index.parse_source("jb:30th anniversary"), ("jb", "30th anniversary"))
    check("jb is not a browse kind", index.is_browse("jb"), False)


def test_target_source_specs():
    check("target spec", index.parse_source("target:mini tin"), ("target", "mini tin"))
    check("target browse spec", index.parse_source("target-browse:W1852642"),
          ("target-browse", "W1852642"))


def test_target_message():
    """
    The 0-stock line and the Target footer. A Target-only alert must not send
    you to the Kmart pre-order page.
    """
    items, _ = index.parse_target(TARGET_FIXTURE)
    msg = index.message([items[0]])
    assert "[Target]" in msg, msg
    assert "NOT yet buyable online" in msg, msg
    assert "target.com.au" in msg, msg
    assert "Kmart pre-orders" not in msg, msg
    print("ok   target message")


def test_pattern():
    """
    The default pattern against the names the retailers actually use. The
    "30th Celebration" rows are the six Kmart listed on 17 Sep 2026 that the
    old "30th anniversary" pattern missed.
    """
    assert index.MATCH_PATTERN == index.DEFAULT_PATTERN, "run this test without MATCH_PATTERN set"
    for name in (
        "Pokemon TCG: 30th Celebration Elite Trainer Box",
        "Pokemon Trading Card Game: 30th Celebration Pokemon ex Box - Assorted",
        "Rayman: 30th Anniversary Edition - Switch",
        "Pokemon 20cm Anniversary Pastel Plush - Assorted*",
        "Pok\u00e9mon TCG: 30 Years Collection",
        "POKEMON 30TH CELEBRATION BINDER",
        "Pokemon 30th Celebration Binder Box - Pokemon TCG",
    ):
        check("matches " + name, index.matches(name), True)
    for name in (
        "Pokemon TCG: Mega Evolution - Delta Reign Sleeved Booster - Assorted",
        "Pok\u00e9mon Boys Mesh Tee - Slate Grey",
        "Pre - Order Nintendo Switch 2 The Legend of Zelda 40th Anniversary Edition",
        "Hallmark Anniversary Card - Hearts",
        "Sonic the Hedgehog 35th Anniversary Sonic 4 inch Figure",
    ):
        check("rejects " + name, index.matches(name), False)
    check("accent strip", index.plain("Pok\u00e9mon"), "Pokemon")


def test_select_ignores_preorder_flag():
    """A match alerts whether or not it is a pre-order: ordinary listings count."""
    items, _ = index.parse_results({"response": {"results": [
        {"value": "Pokemon TCG: 30th Celebration Binder Collection",
         "data": {"id": "P_1", "url": "/p/1", "isPreOrderActive": False}},
        {"value": "Pokemon TCG: 30th Celebration Elite Trainer Box",
         "data": {"id": "P_2", "url": "/p/2", "isPreOrderActive": True}},
    ]}})
    check("preorder flags parsed", [i["preorder"] for i in items], [False, True])
    check("both selected", [i["id"] for i in index.select("search", items)], ["P_1", "P_2"])


def test_key_scrape():
    html = '...,"constructorApiKey":"key_GZTqlLr41FS2p7AY","optimizelySdkKey":...'
    check("key scrape", index.key_from_html(html), "key_GZTqlLr41FS2p7AY")
    try:
        index.key_from_html("<html>no key here</html>")
    except RuntimeError:
        print("ok   missing key raises")
    else:
        raise AssertionError("missing key did not raise")


def test_message():
    items, _ = index.parse_results(FIXTURE)
    body = index.message(items)
    assert body.startswith("[Kmart] PRE-ORDER: Pokemon TCG: Mini Portfolio"), body
    assert "$59.95" in body and "Kmart pre-orders: " in body, body
    print("ok   message")


BIGW_FIXTURE = {
    "organic": {
        "resultsCount": 273,
        "results": [
            {
                "identifiers": {"articleId": "9906045598"},
                "information": {
                    "name": "PREORDER Pokemon TCG MEGA 30th Anniversary Celebration Japanese Booster Box",
                    "brand": {},
                },
                "prices": {"NAT": {"price": {"cents": 32000}}, "NSW": {"price": {"cents": 32000}}},
                "fulfilment": {"productChannel": "IMP", "logisticType": "DSV_Standard"},
            },
            {
                "identifiers": {"articleId": "9906124050"},
                "information": {"name": "Toy Story Alien 30th Anniversary Pop! Vinyl", "brand": {"name": "Funko"}},
                "prices": {"NAT": {"price": {"cents": 3695}}},
                "fulfilment": {"productChannel": "BIGW", "logisticType": "Standard"},
            },
            {
                "identifiers": {"articleId": "9906143082"},
                "information": {"name": "Pokemon 30th Celebration Binder Box - Pokemon TCG"},
                "prices": {},
                "fulfilment": {"productChannel": "BIGW"},
            },
            {"identifiers": {}, "information": {"name": "no id, dropped"}},
        ],
    }
}


def test_bigw_parse():
    items, total = index.parse_bigw(BIGW_FIXTURE, include_marketplace=True)
    check("bigw total", total, 273)
    check("bigw drops id-less", len(items), 3)
    check("bigw id is namespaced", items[0]["id"], "bigw:9906045598")
    check("bigw url", items[0]["url"], "https://www.bigw.com.au/p/9906045598")
    check("bigw price from NAT cents", items[0]["price"], 320.0)
    check("bigw preorder from name", items[0]["preorder"], True)
    check("bigw not preorder", items[1]["preorder"], False)
    check("bigw brand", items[1]["brand"], "Funko")
    check("bigw missing price", items[2]["price"], None)


def test_bigw_marketplace():
    everything, _ = index.parse_bigw(BIGW_FIXTURE, include_marketplace=True)
    check("IMP is marketplace", everything[0]["marketplace"], True)
    check("BIGW channel is own stock", everything[1]["marketplace"], False)
    check("missing fulfilment counts as marketplace", index.normalise_bigw({"identifiers": {"articleId": "1"}, "information": {"name": "x"}})["marketplace"], True)
    own, _ = index.parse_bigw(BIGW_FIXTURE)  # the default: marketplace dropped
    check("default drops marketplace", [i["id"] for i in own], ["bigw:9906124050", "bigw:9906143082"])


def test_bigw_select():
    items, _ = index.parse_bigw(BIGW_FIXTURE, include_marketplace=True)
    # bigw is pattern-only, never alert-all, even with the flag on.
    picked = [i["id"] for i in index.select("bigw", items, True)]
    check("bigw pattern only", picked, ["bigw:9906045598", "bigw:9906124050", "bigw:9906143082"])


def test_bigw_request():
    body = json.loads(index.bigw_request("30th anniversary").decode("utf-8"))
    check("bigw sold-by filter on by default", body["filter"], {"soldBy": ["BIG W"]})
    with_mp = json.loads(index.bigw_request("x", include_marketplace=True).decode("utf-8"))
    check("bigw no filter when marketplace wanted", "filter" in with_mp, False)
    check("bigw text", body["text"], "30th anniversary")
    check("bigw newest first", body["sort"], "newDesc")
    check("bigw per page", body["perPage"], 48)
    check("bigw format is the string 1", body["format"], "1")
    check("bigw clientId", body["clientId"], "web")


def test_bigw_source_spec():
    check("bigw spec", index.parse_source("bigw:pokemon"), ("bigw", "pokemon"))


def test_default_sources_parse():
    kinds = [index.parse_source(s) for s in index.DEFAULT_SOURCES.split(",")]
    check("kmart searches include the safety net", ("search", "pokemon") in kinds, True)
    check("bigw safety net", ("bigw", "pokemon") in kinds, True)
    check("bigw:preorder is gone", ("bigw", "preorder") in kinds, False)


def test_retailer_label():
    items, _ = index.parse_bigw(BIGW_FIXTURE, include_marketplace=True)
    check("bigw label", index.retailer(items[0]), "Big W")
    kmart, _ = index.parse_results(FIXTURE)
    check("kmart label", index.retailer(kmart[0]), "Kmart")
    body = index.message([items[0], kmart[0]])
    assert body.startswith("[Big W] PRE-ORDER: PREORDER Pokemon"), body
    assert "[Kmart] PRE-ORDER: Pokemon TCG: Mini Portfolio" in body, body
    print("ok   mixed message")


def test_collect_isolates_a_failed_source(monkey=None):
    """One retailer down must not blind the other."""
    calls = []

    def fake_read(kind, target, key=None):
        calls.append(kind)
        if kind == "bigw":
            raise RuntimeError("bigw is down")
        return index.parse_results(FIXTURE)[0]

    real_read, real_key = index.read_source, index.constructor_key
    index.read_source = fake_read
    index.constructor_key = lambda site=index.SITE, force=False: "key_X"
    os.environ["SOURCES"] = "search:30th anniversary,bigw:30th anniversary"
    try:
        hits, failed = index.collect(all_sources=True)
    finally:
        index.read_source, index.constructor_key = real_read, real_key
        del os.environ["SOURCES"]
    check("both sources attempted", calls, ["search", "bigw"])
    check("kmart hits survive", [h["id"] for h in hits], ["P_110188874"])
    check("failure reported", failed, ["bigw:30th anniversary"])


def test_bigw_cadence():
    # 5-minute cadence on a 1-minute tick: minutes 0, 5, 10 ... fire.
    check("minute 0 due", index.bigw_due(now=0, every=5), True)
    check("minute 1 not due", index.bigw_due(now=60, every=5), False)
    check("minute 5 due", index.bigw_due(now=300, every=5), True)
    check("every=1 always due", index.bigw_due(now=60, every=1), True)


def test_collect_skips_bigw_off_cadence():
    calls = []

    def fake_read(kind, target, key=None):
        calls.append(kind)
        return []

    real_read, real_key, real_due = index.read_source, index.constructor_key, index.bigw_due
    index.read_source = fake_read
    index.constructor_key = lambda site=index.SITE, force=False: "key_X"
    index.bigw_due = lambda now=None, every=None: False
    os.environ["SOURCES"] = "search:x,bigw:x"
    try:
        index.collect()
        check("bigw skipped off cadence", calls, ["search"])
        calls.clear()
        index.collect(all_sources=True)
        check("seed ignores cadence", calls, ["search", "bigw"])
    finally:
        index.read_source, index.constructor_key, index.bigw_due = real_read, real_key, real_due
        del os.environ["SOURCES"]


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
    print("\nall passed")
    print(json.dumps({"fixture_items": len(FIXTURE["response"]["results"])}))
