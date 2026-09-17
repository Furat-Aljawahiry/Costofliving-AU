"""drift.py against the measured Woolworths history — no AWS, no network.

    python infra/terraform/lambda/category_crawler/drift_test.py

The twelve runs below are the real manifests from
s3://.../reports/supermarkets/woolworths/fruitAndVeg, 28 Aug – 16 Sep 2026,
with the fulfilment store read off the CSV rows (the manifests of the time did
not record it). The two 06:00 runs on 14 and 15 Sep are the incident this
module exists for.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import drift  # noqa: E402
import woolworths  # noqa: E402

# newest first, as s3_history_reader returns them; only _SUCCESS runs
HISTORY = [
    {"run_id": "20260913060037-5a6b6c02", "total_reported": 473, "store_id": "1101"},
    {"run_id": "20260829033121-31aafe09", "total_reported": 472, "store_id": "1101"},
]

failures = []


def check(name, cond, detail=""):
    print(("ok   " if cond else "FAIL ") + name + (f"  ({detail})" if detail else ""))
    if not cond:
        failures.append(name)


# 14 Sep 06:00 — 403 from store 7008 against a 472.5 median: -14.7%, new store.
r = drift.assess(403, "7008", HISTORY)
check("403-run is drift", r["status"] == "drift", str(r["pct"]))
check("403-run alarms", r["alarm"] is True)
check("403-run store change detected", r["store_changed"] is True and r["trailing_store_id"] == "1101")
check("pct is signed", r["pct"] < 0)

# 16 Sep 06:00 — 472 from store 1101: within tolerance, same store.
r = drift.assess(472, "1101", HISTORY)
check("472-run is ok", r["status"] == "ok" and r["alarm"] is False, str(r["pct"]))

# 15 Sep 18:00 — 516 from store 3221: +9.2%, UNDER the 10% threshold, but the
# store changed. This is the case that justifies the separate store bit.
r = drift.assess(516, "3221", HISTORY)
check("516-run under count threshold", abs(r["pct"]) < 10, str(r["pct"]))
check("516-run still alarms on store", r["alarm"] is True and r["status"] == "drift")

# Threshold is configurable and exclusive.
r = drift.assess(516, "1101", HISTORY, threshold_pct=9.0)
check("516-run drifts at 9% threshold", r["status"] == "drift" and r["alarm"])

# First run ever: nothing to compare against, and that is not an alarm.
r = drift.assess(472, "1101", [])
check("no history is not an alarm", r["status"] == "no_history" and not r["alarm"])

# A run whose API never said how many products exist cannot be assessed.
r = drift.assess(None, "1101", HISTORY)
check("missing total alarms", r["status"] == "no_total" and r["alarm"])

# A history with no store ids (manifests written before this change) still
# does the count comparison and never claims a store change.
old = [{**h, "store_id": ""} for h in HISTORY]
r = drift.assess(400, "7008", old)
check("pre-store history: count drift only", r["status"] == "drift" and not r["store_changed"])

# Median is robust to one bad day in the window: with the 403 run inside a
# 7-run window the median is still ~472, and the next 400 still trips.
window = [{"run_id": f"r{i}", "total_reported": t, "store_id": s}
          for i, (t, s) in enumerate([(403, "7008"), (473, "1101"), (473, "1101"), (472, "1101"),
                                      (473, "1101"), (472, "1101"), (472, "1101")])]
r = drift.assess(400, "7008", window)
check("one bad day does not move the median", r["trailing_median"] == 472 and r["alarm"])

# The measured history at the time of the incident: two of four complete runs
# ARE the incident, the median is 437.5, and none of them record a store.
# Without a pin a repeat 400 passes; with the pin it does not.
poisoned = [{"run_id": r, "total_reported": t, "store_id": ""}
            for r, t in [("0916", 472), ("0915", 400), ("0914", 403), ("0913", 473)]]
r = drift.assess(400, "7008", poisoned)
check("poisoned window alone misses a repeat 400", r["status"] == "ok" and not r["alarm"], str(r["pct"]))
r = drift.assess(400, "7008", poisoned, expected_store="1101")
check("pinned store catches it", r["alarm"] and r["store_changed"] and r["store_baseline"] == "pinned")
r = drift.assess(472, "1101", poisoned, expected_store="1101")
check("pinned store passes the right store", not r["alarm"] and r["status"] == "ok")
r = drift.assess(516, "3221", HISTORY, expected_store="1101")
check("pin overrides the trailing modal store", r["trailing_store_id"] == "1101" and r["alarm"])

# EMF record: metric values are what CloudWatch will alarm on.
e = drift.emf_record("woolworths", 403, drift.assess(403, "7008", HISTORY), "20260914060037-d47ad900")
check("emf namespace", e["_aws"]["CloudWatchMetrics"][0]["Namespace"] == drift.NAMESPACE)
check("emf DriftAlarm=1", e["DriftAlarm"] == 1)
check("emf drift pct is absolute", e["TotalReportedDriftPct"] > 10)
check("emf carries store ids", e["storeId"] == "7008" and e["trailingStoreId"] == "1101")

# Woolworths adapter records the store every tile reports.
state = woolworths.start({}, None, print)
payload = {"Bundles": [{"Products": [{"Stockcode": 1, "FulfilmentStoreId": 7008},
                                     {"Stockcode": 2, "FulfilmentStoreId": 7008},
                                     {"Stockcode": 3, "FulfilmentStoreId": 1101}]}]}
woolworths.page_products(payload, state)
woolworths.page_products(payload, state)
extras = woolworths.capture_extras(state)
check("adapter store_id is the modal store", extras["store_id"] == "7008", str(extras))
check("adapter lists every store seen", extras["store_ids_seen"] == {"1101": 2, "7008": 4})
check("adapter with no pages is empty", woolworths.capture_extras({}) == {"store_id": "", "store_ids_seen": {}})

# Manifest summary reads the store out of capture_context.
s = drift._manifest_summary({"run_id": "x", "counts": {"total_reported": 472},
                             "capture_context": {"store_id": "1101"}})
check("manifest summary", s == {"run_id": "x", "total_reported": 472, "store_id": "1101"})

print()
if failures:
    sys.exit(f"{len(failures)} failed: {failures}")
print("all checks passed")
