"""Exercises the multi-retailer invocation offline — no network, no AWS.

    python infra/terraform/lambda/category_crawler/batch_test.py

handler_test.py proves the two adapters work against the live sites. This file
proves the thing that sits above them: ONE trigger crawls BOTH retailers, each
writes its own artefacts, and the combined file is exactly their union. It fakes
`crawl_category` so it can assert on behaviour the live test cannot force —
notably that a blocked Coles does not cost us the Woolworths data.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import index  # noqa: E402
from crawler import COLUMNS  # noqa: E402

COMBINED_PREFIX = "reports/supermarkets/all/fruitAndVeg"

checks = {}
calls = []


def _row(retailer, sku, sub, price, per_kg):
    r = {c: "" for c in COLUMNS}
    r.update(
        retailer=retailer, retailer_sku=sku, product_name=f"{sub} {sku}",
        sap_department="FRUIT & VEG", sap_category="VEGETABLES", sap_subcategory=sub,
        price_aud=price, price_per_kg_aud=per_kg,
        is_organic=False, is_prepared=False,
        is_purchasable=True, is_in_stock=True, is_available=True,
        is_on_special=False, parse_warnings="",
    )
    return r


def fake_crawl(status="complete", rows_per_page=2, fail=None):
    """Stand-in for crawler.crawl_category with a recorded call log."""

    def crawl(retailer, **kw):
        calls.append({"retailer": retailer.RETAILER, **kw})
        if fail == retailer.RETAILER:
            raise RuntimeError("page 1: HTTP 403")
        slug = retailer.RETAILER
        rows = [
            _row(slug, f"{slug}-{i}", "POTATOES" if i % 2 else "TOMATOES", 3.0 + i, 4.0 + i)
            for i in range(rows_per_page)
        ]
        manifest = {
            "status": status,
            "capture_context": {"price_basis": "online", "egress": "direct"},
            "counts": {
                "total_reported": rows_per_page, "pages_fetched": 3,
                "proxy_rotations": 0, "sponsored_duplicates_dropped": 0,
            },
            "errors": [],
        }
        return rows, manifest

    return crawl


def collect(event, env=None, raises=False, **kw):
    """run() with a fake crawler and an in-memory writer.

    Returns (result, written). With raises=True the exception is returned in
    place of the result, so a failing run's artefacts can still be inspected —
    which is the whole point of the isolation check below.
    """
    store = {}
    old = dict(os.environ)
    os.environ.update(env or {})
    try:
        res = index.run(
            event,
            put=lambda k, b, ct: store.__setitem__(k, b),
            bucket="test-bucket", delay_ms=0, proxy=None, probe=False, **kw,
        )
    except RuntimeError as e:
        if not raises:
            raise
        res = e
    finally:
        os.environ.clear()
        os.environ.update(old)
    return res, store


_real_crawl = index.crawl_category

# ------------------------------------------------------------------ both retailers

index.crawl_category = fake_crawl()
calls.clear()
res, store = collect({}, {"COMBINED_OUTPUT_PREFIX": COMBINED_PREFIX})

keys = sorted(store)
woolies = [k for k in keys if "/woolworths/" in k]
coles = [k for k in keys if "/coles/" in k]
combined = [k for k in keys if k.startswith(COMBINED_PREFIX)]

checks["one trigger crawls both retailers"] = [c["retailer"] for c in calls] == [
    "woolworths", "coles"
]
checks["all pages: max_pages is 0 (unlimited) for both"] = all(
    c["max_pages"] == 0 for c in calls
)
checks["each retailer crawls its own fruit & veg default"] = (
    calls[0]["url"] == "/shop/browse/fruit-veg" and calls[1]["url"] == "/browse/fruit-vegetables"
)
checks["woolworths writes its four artefacts"] = len(woolies) == 4
checks["coles writes its four artefacts"] = len(coles) == 4
checks["both retailers share one run_id"] = (
    res["retailers"][0]["runId"] == res["retailers"][1]["runId"] == res["runId"]
)
checks["_SUCCESS written on a complete run"] = all(
    any(k.endswith("_SUCCESS") for k in group) for group in (woolies, coles, combined)
)
checks["every artefact shares the run_id stem"] = all(
    k.rsplit("/", 1)[1].startswith(res["runId"]) for k in keys
)
checks["combined csv is the union of both files"] = (
    res["combined"]["rows"] == res["retailers"][0]["rows"] + res["retailers"][1]["rows"]
)

combined_csv = store[next(k for k in combined if k.endswith(f"{res['runId']}.csv"))]
lines = combined_csv.strip().split("\n")
checks["combined csv uses the shared header"] = lines[0] == ",".join(COLUMNS)
checks["combined csv carries rows from both retailers"] = (
    any(",woolworths," in ln for ln in lines[1:]) and any(",coles," in ln for ln in lines[1:])
)
checks["combined cheapest report written"] = any(
    k.endswith("cheapest-by-subcategory.csv") for k in combined
)

# ------------------------------------------------------------------ the default: two CSVs

# COMBINED_OUTPUT_PREFIX unset is the deployed default. One trigger, two
# retailers, exactly two CSVs and no union — joining them is L2's decision,
# not collection's.
index.crawl_category = fake_crawl()
res_two, store_two = collect({}, {})
csvs = sorted(k for k in store_two if k.endswith(f"{res_two['runId']}.csv"))

checks["no run= directory is created"] = not any("/run=" in k for k in store_two)
checks["a day prefix holds the reports directly"] = all(
    k.count("/dt=") == 1 and k.split("/dt=")[1].count("/") == 1 for k in store_two
)
checks["the default writes exactly two CSVs, one per retailer"] = [
    k.split("/dt=")[0] for k in csvs
] == [
    "reports/supermarkets/coles/fruitAndVeg",
    "reports/supermarkets/woolworths/fruitAndVeg",
]
checks["the default writes no union file"] = res_two["combined"] is None and not [
    k for k in store_two if k.startswith(COMBINED_PREFIX)
]

# ------------------------------------------------------------------ isolation

index.crawl_category = fake_crawl(fail="coles")
calls.clear()
err, store2 = collect({}, {"COMBINED_OUTPUT_PREFIX": COMBINED_PREFIX}, raises=True)

checks["a blocked retailer still fails the invocation"] = (
    isinstance(err, RuntimeError) and "coles" in str(err) and "403" in str(err)
)
checks["a blocked retailer does not cost us the other's data"] = (
    len([k for k in store2 if "/woolworths/" in k]) == 4
    and not [k for k in store2 if "/coles/" in k]
)
checks["combined _SUCCESS withheld when a retailer failed"] = not any(
    k.startswith(COMBINED_PREFIX) and k.endswith("_SUCCESS") for k in store2
)

# ------------------------------------------------------------------ single retailer

index.crawl_category = fake_crawl()
calls.clear()
res3, store3 = collect({"retailer": "coles"})

checks["a single-retailer event still returns the flat result"] = (
    res3["retailer"] == "coles" and "retailers" not in res3
)
checks["a single-retailer run writes no combined file"] = not any(
    k.startswith(COMBINED_PREFIX) for k in store3
)
checks["only the requested retailer is crawled"] = [c["retailer"] for c in calls] == ["coles"]

# ------------------------------------------------------------------ configuration

index.crawl_category = fake_crawl()
calls.clear()
collect({}, {
    "COLES_CATEGORY_URL": "/browse/fruit-vegetables/vegetables",
    "WOOLWORTHS_POSTCODE": "3000",
})
by = {c["retailer"]: c for c in calls}
checks["per-retailer env vars target only their own retailer"] = (
    by["coles"]["url"] == "/browse/fruit-vegetables/vegetables"
    and by["woolworths"]["url"] == "/shop/browse/fruit-veg"
    and by["woolworths"]["postcode"] == "3000"
    and by["coles"]["postcode"] == ""
)

index.crawl_category = fake_crawl()
calls.clear()
collect({}, {"CATEGORY_URL": "/browse/should-be-ignored"})
checks["a bare CATEGORY_URL is ignored when two retailers run"] = all(
    c["url"] != "/browse/should-be-ignored" for c in calls
)

index.crawl_category = fake_crawl()
calls.clear()
collect({"retailer": "coles"}, {"CATEGORY_URL": "/browse/fruit-vegetables/fruit"})
checks["a bare CATEGORY_URL still configures a single-retailer function"] = (
    calls[0]["url"] == "/browse/fruit-vegetables/fruit"
)

index.crawl_category = fake_crawl()
calls.clear()
collect({}, {"RETAILERS": "coles,woolworths"})
checks["RETAILERS sets the order"] = [c["retailer"] for c in calls] == ["coles", "woolworths"]

index.crawl_category = fake_crawl()
calls.clear()
collect({"retailers": ["all"]}, {})
checks["'all' expands to every known retailer"] = sorted(c["retailer"] for c in calls) == [
    "coles", "woolworths"
]

calls.clear()
unknown, _ = collect({"retailer": "aldi"}, {}, raises=True)
checks["an unknown retailer fails before any request"] = (
    isinstance(unknown, RuntimeError) and "aldi" in str(unknown) and not calls
)

# ------------------------------------------------------------------ partial

index.crawl_category = fake_crawl(status="partial")
res4, store4 = collect({}, {"COMBINED_OUTPUT_PREFIX": COMBINED_PREFIX})
checks["a short crawl withholds every _SUCCESS"] = not any(
    k.endswith("_SUCCESS") for k in store4
)
checks["a short crawl reports partial"] = res4["status"] == "partial"

index.crawl_category = _real_crawl

print("CHECKS:")
ok = True
for name, passed in checks.items():
    print(f"  {'PASS' if passed else 'FAIL'}  {name}")
    ok = ok and passed
sys.exit(0 if ok else 1)
