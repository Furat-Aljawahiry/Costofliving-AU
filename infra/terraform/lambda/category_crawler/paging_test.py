"""crawl_category paging: the organic tail spilling past ceil(total/PAGE_SIZE).

Models the measured Woolworths evening: every page carries 8 sponsored tiles
that repeat SKUs, so 36-tile pages hold 28 new products each, and the last
organic products land on a page the crawler would not have fetched if it
trusted total_reported / PAGE_SIZE alone (13-16 Sep, every 18:00 run partial
by 5-8 rows). Also pins the bound: a category whose reported total can never
be reached stops after OVERRUN_PAGES extra pages rather than paging forever.
"""

from __future__ import annotations

import os
import sys
import types

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import crawler  # noqa: E402


def fake_retailer(total, organic_per_page, sponsored_per_page, reachable=True):
    """A retailer whose pages hold `organic_per_page` fresh SKUs plus
    `sponsored_per_page` promoted repeats of SKU o0..oN, until `total` organic SKUs
    have been served (or forever if not reachable)."""
    r = types.SimpleNamespace()
    r.RETAILER, r.DATASET, r.PAGE_SIZE = "fake", "fake.products", 36
    served = {"n": 0}

    def fetch_page(target, n, session=None, state=None):
        start = served["n"]
        limit = total if reachable else 10 ** 9
        organic = [{"sku": f"o{i}", "ad": False} for i in range(start, min(start + organic_per_page, limit))]
        served["n"] = start + len(organic)
        # Sponsored tiles are category products promoted again, so they share
        # SKUs with the organic set and count once in `total`.
        sponsored = [{"sku": f"o{i}", "ad": True} for i in range(sponsored_per_page)]
        return {"total": total, "products": sponsored + organic}

    r.start = lambda *a, **k: {}
    r.fetch_page = fetch_page
    r.total_count = lambda d: d["total"]
    r.page_products = lambda d, state=None: d["products"]
    r.sku_of = lambda p: p["sku"]
    r.is_sponsored = lambda p: p["ad"]
    r.is_skipped = lambda p: False
    r.build_row = lambda p, ctx, state=None: {"sku": p["sku"], "price_aud": 1.0, "parse_warnings": ""}
    r.capture_extras = lambda state: {}
    return r


def crawl(r, **kw):
    rows, manifest = crawler.crawl_category(
        r, "cat", "/cat", "Cat", "run-1", delay_ms=0, probe=False, **kw
    )
    return rows, manifest


def check(name, cond):
    print(("ok   " if cond else "FAIL ") + name)
    if not cond:
        sys.exit(1)


# 472 products, 8 sponsored per page -> 28 organic per page -> 17 pages needed,
# but ceil(472/36) = 14. Before the fix the crawl stopped at 14 with ~400 rows.
rows, m = crawl(fake_retailer(472, 28, 8))
check("evening run reaches every organic product", len(rows) == 472)
check("status is complete", m["status"] == "complete")
check("paged past the computed count", m["counts"]["pages_fetched"] == 17)

# Morning: 70 sponsored across 14 pages -> 5/page -> 31 organic/page -> 16 pages.
rows, m = crawl(fake_retailer(472, 31, 5))
check("morning run complete", m["status"] == "complete" and len(rows) == 472)

# No sponsored tiles: stops exactly at ceil(total / PAGE_SIZE), as before.
rows, m = crawl(fake_retailer(488, 36, 0))
check("clean pages stop at the computed count", m["counts"]["pages_fetched"] == 14 and m["status"] == "complete")

# Reported total is a lie: new products keep coming but the bound holds.
rows, m = crawl(fake_retailer(100, 5, 0, reachable=False))
check("unreachable total stops after OVERRUN_PAGES", m["counts"]["pages_fetched"] == 3 + crawler.OVERRUN_PAGES)
check("and is reported partial", m["status"] == "partial")

# An exhausted category (pages go empty) still stops on the empty page.
rows, m = crawl(fake_retailer(60, 28, 8))
check("short category stops at first empty page", m["status"] == "complete" and len(rows) == 60)

# max_pages still caps the crawl for the CLI.
rows, m = crawl(fake_retailer(472, 28, 8), max_pages=2)
check("max_pages honoured", m["counts"]["pages_fetched"] == 2 and m["status"] == "partial")

print("\nall checks passed")
