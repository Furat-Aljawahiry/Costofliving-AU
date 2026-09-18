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
    assert body.startswith("PRE-ORDER OPEN: Pokemon TCG: Mini Portfolio"), body
    assert "$59.95" in body and "Category: " in body, body
    print("ok   message")


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
    print("\nall passed")
    print(json.dumps({"fixture_items": len(FIXTURE["response"]["results"])}))
