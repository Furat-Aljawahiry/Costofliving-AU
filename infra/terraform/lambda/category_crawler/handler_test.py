"""Exercises the Lambda's run() for BOTH retailers with an injected writer — no
AWS needed.

    python infra/terraform/lambda/category_crawler/handler_test.py

Hits both live sites for 2 pages each, so it needs a network connection. Two
pages is enough to exercise paging, the Woolworths sponsored-tile dedupe, and
the Coles buildId warm-up, while staying a trivially polite amount of traffic.

The check that matters most is the last one: both retailers' CSVs come out with
the same header. That is the whole reason they share a crawler.

If Coles' HTML surface is blocked (COLES_DISCOVERY.md section 5.3) the warm-up
fails loudly and this test skips the live Coles half rather than pretending. Set
COLES_BUILD_ID to run it anyway through the data route, which stays up:

    COLES_BUILD_ID=<buildId> python .../handler_test.py
"""

from __future__ import annotations

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from crawler import COLUMNS  # noqa: E402
from index import run  # noqa: E402

EXPECTED_PREFIX = {
    "woolworths": "reports/supermarkets/woolworths/fruitAndVeg",
    "coles": "reports/supermarkets/coles/fruitAndVeg",
}

results = {}
written = {}
checks = {}
skipped = []


def make_put(store):
    def put(key, body, content_type):
        store[key] = {"bytes": len(body or ""), "ct": content_type, "body": body}
    return put


for retailer in ("woolworths", "coles"):
    store = written[retailer] = {}
    # maxPages 2 keeps it light while still exercising paging + dedupe.
    # proxy=None forces direct egress regardless of the environment.
    try:
        res = results[retailer] = run(
            {"retailer": retailer, "maxPages": 2},
            put=make_put(store), bucket="test-bucket", delay_ms=200, proxy=None, probe=False,
        )
    except RuntimeError as e:
        # A blocked edge is an environment condition, not a code defect, and it
        # is one this project expects. Say so loudly and skip the live half —
        # coles_test.py covers the mapping and the column parity offline, with
        # no network at all.
        print(f"\nSKIPPED ({retailer}): {e}")
        print("  Looks blocked. Re-run through the data route with a pinned build id:")
        print("    COLES_BUILD_ID=<buildId> python infra/terraform/lambda/category_crawler/handler_test.py")
        skipped.append(retailer)
        continue

    print(f"\nRESULT ({retailer}):", json.dumps(res, indent=1))
    print(f"S3 KEYS WRITTEN ({retailer}):")
    for k, v in store.items():
        print(f"  {k}\n      ({v['bytes']} bytes, {v['ct']})")

    keys = list(store)
    csv_key = next((k for k in keys if k.endswith(f"{res['runId']}.csv")), None)
    checks.update({
        f"[{retailer}] csv written": csv_key is not None,
        f"[{retailer}] cheapest report written":
            any(k.endswith("cheapest-by-subcategory.csv") for k in keys),
        f"[{retailer}] manifest written": any(k.endswith(".manifest.json") for k in keys),
        f"[{retailer}] _SUCCESS withheld on partial":
            not any(k.endswith("._SUCCESS") for k in keys),
        # Flat: the day prefix holds the reports themselves, named by run_id.
        # No run= directory between the date and the file (spec 3).
        f"[{retailer}] prefix routes to its own dataset": bool(
            re.match(rf"^{EXPECTED_PREFIX[retailer]}/dt=\d{{4}}-\d{{2}}-\d{{2}}/\d{{14}}-[0-9a-f]+\.", keys[0])
        ),
        f"[{retailer}] no run= directory is created":
            not any("/run=" in k for k in keys),
        # A 2-page crawl of a many-page category is short by definition, and a
        # short crawl must never claim to be complete (spec 3.2).
        f"[{retailer}] status is partial": res["status"] == "partial",
        f"[{retailer}] retailer reported back": res["retailer"] == retailer,
        f"[{retailer}] rows written": res["rows"] > 0,
        f"[{retailer}] egress reported": res["egress"] == "direct",
        f"[{retailer}] header is the shared COLUMNS":
            store[csv_key]["body"].split("\n")[0] == ",".join(COLUMNS),
    })

# Sponsored tiles ride along on every Woolworths page, so paging twice must drop
# some. The exact count is live ad inventory (8/page one day, 7 the next) —
# pinning it makes this test fail on Woolworths' ad rotation rather than on our
# bug. Coles served no sponsored tiles in this category at all, so its dedupe
# count is legitimately 0 and is not asserted.
if "woolworths" not in skipped:
    checks["[woolworths] sponsored dedupe ran"] = (
        results["woolworths"]["sponsoredDuplicatesDropped"] > 0
    )

# The check this file exists for: two retailers, two files, one header.
if not skipped:
    w_csv = next(k for k in written["woolworths"] if k.endswith(f"{results['woolworths']['runId']}.csv"))
    c_csv = next(k for k in written["coles"] if k.endswith(f"{results['coles']['runId']}.csv"))
    checks["both retailers write one identical header"] = (
        written["woolworths"][w_csv]["body"].split("\n")[0]
        == written["coles"][c_csv]["body"].split("\n")[0]
    )
    checks["the two retailers write to different files"] = w_csv != c_csv

print("\nCHECKS:")
ok = True
for name, passed in checks.items():
    print(f"  {'PASS' if passed else 'FAIL'}  {name}")
    ok = ok and passed

if skipped:
    print(f"\n  NOT EXERCISED: {', '.join(skipped)} — blocked, see above. "
          "The cross-retailer header check did not run.")
sys.exit(0 if ok else 1)
