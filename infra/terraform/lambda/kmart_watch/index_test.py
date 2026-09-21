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
    print("ok   source_url")


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
    check("bigw pattern only", picked, ["bigw:9906045598", "bigw:9906124050"])


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
    check("bigw spec", index.parse_source("bigw:preorder"), ("bigw", "preorder"))


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
    index.read_source, index.constructor_key = fake_read, lambda force=False: "key_X"
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
    index.read_source, index.constructor_key = fake_read, lambda force=False: "key_X"
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
