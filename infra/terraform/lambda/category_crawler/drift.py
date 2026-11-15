"""Did this run see the same category the previous runs saw?

Measured across twelve Woolworths Fruit & Veg runs: `total_reported` was
472/473 on ten of them, 403 and 400 on two, 516 on one. Every run had status
"complete" — the crawler fetched every product the API said existed — and the
manifests had nothing to say about why 70 products were missing. The cause
was the fulfilment store: the browse request carries no location, Woolworths
picks a store from the exit IP, and the category is that store's range
(store 1101 -> 472, store 7008 -> 400, store 3221 -> 516).

"complete" therefore cannot mean "comparable with yesterday". This module is
the check that says whether it is: the run's count against the median of the
trailing complete runs, and the run's store against the store those runs were
served from. The answer goes in the manifest, in a structured log line, and —
via CloudWatch Embedded Metric Format, which needs no extra IAM — into a
metric the Terraform alarm watches.

Pure functions first; the only AWS touch is `s3_history_reader`, which the
handler injects so this can be exercised (drift_test.py) with a list of dicts.
"""

from __future__ import annotations

import json
import re
import time

NAMESPACE = "CostOfLivingAU/Crawler"
DEFAULT_WINDOW = 7          # trailing complete runs the median is taken over
DEFAULT_THRESHOLD_PCT = 10.0
# Days to walk back looking for `window` complete runs. Generous: a week of
# blocked runs must not turn the check off by finding no history at all.
MAX_DAYS_BACK = 21

# A run that fetched at least this share of what the API said it had is close
# enough to be a baseline. See `_admissible` for why this exists at all.
MIN_COVERAGE = 0.95

_RUN_ID_RE = re.compile(r"^(\d{14}-[0-9a-f]+)\.")


# ---------------------------------------------------------------- assessment


def _median(xs: list) -> float | None:
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return None
    mid = len(xs) // 2
    return float(xs[mid]) if len(xs) % 2 else (xs[mid - 1] + xs[mid]) / 2.0


def _modal_store(history: list[dict]) -> str:
    counts: dict[str, int] = {}
    for h in history:
        sid = str(h.get("store_id") or "")
        if sid:
            counts[sid] = counts.get(sid, 0) + 1
    if not counts:
        return ""
    return sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]


def assess(total_reported, store_id: str, history: list[dict],
           threshold_pct: float = DEFAULT_THRESHOLD_PCT, expected_store: str = "") -> dict:
    """Compare one run against its trailing history.

    `history` is a list of {run_id, total_reported, store_id} for the trailing
    complete runs, newest first. Returns a dict that is written verbatim into
    the manifest under "drift":

        status        "ok" | "drift" | "no_history" | "no_total"
        pct           signed % change of total_reported from the trailing median
        store_changed this run's store differs from the baseline store
        alarm         True when pct exceeds the threshold OR the store changed —
                      the single bit the CloudWatch alarm is fed

    The store comparison is deliberately its own bit: a store change that
    happens to land on a similar count (1101 -> 3221 was +9%, under any
    sensible threshold) is still a different range and different prices.

    The baseline store is `expected_store` when the operator pinned one, else
    the modal store of the trailing runs. The pin exists because a trailing
    window can be poisoned: at the time of writing the four complete runs on
    record were 473, 403, 400, 472 — two of them the very incident — so their
    median (437.5) would wave a repeat 400 through at -8.6%. A pinned store
    catches it on the first run, and the manifests written before store ids
    were recorded contribute nothing to the modal store anyway.
    """
    totals = [h.get("total_reported") for h in history]
    median = _median(totals)
    modal_store = str(expected_store or "") or _modal_store(history)
    store_id = str(store_id or "")
    store_changed = bool(modal_store and store_id and store_id != modal_store)

    out = {
        "window": len(history),
        "trailing_runs": [h.get("run_id") for h in history],
        "trailing_median": median,
        "store_id": store_id,
        "trailing_store_id": modal_store,
        "store_baseline": "pinned" if expected_store else ("trailing" if modal_store else "none"),
        "threshold_pct": threshold_pct,
        "pct": None,
        "store_changed": store_changed,
        "alarm": store_changed,
        "status": "ok",
    }
    if total_reported is None:
        out["status"] = "no_total"
        out["alarm"] = True
        return out
    if median is None:
        out["status"] = "no_history"
        return out

    pct = (total_reported - median) / median * 100.0 if median else 0.0
    out["pct"] = round(pct, 2)
    if abs(pct) > threshold_pct:
        out["status"] = "drift"
        out["alarm"] = True
    elif store_changed:
        out["status"] = "drift"
    return out


def emf_record(retailer: str, total_reported, drift: dict, run_id: str) -> dict:
    """One log line in CloudWatch Embedded Metric Format.

    Printed by the Lambda, it becomes three metrics under NAMESPACE with a
    Retailer dimension and no PutMetricData call, no extra IAM, no SDK:
        TotalReported          the raw count, for the dashboard
        TotalReportedDriftPct  |pct| from the trailing median (0 when unknown)
        DriftAlarm             1 when the run should page someone
    """
    pct = drift.get("pct")
    return {
        "_aws": {
            "Timestamp": int(time.time() * 1000),
            "CloudWatchMetrics": [{
                "Namespace": NAMESPACE,
                "Dimensions": [["Retailer"]],
                "Metrics": [
                    {"Name": "TotalReported", "Unit": "Count"},
                    {"Name": "TotalReportedDriftPct", "Unit": "Percent"},
                    {"Name": "DriftAlarm", "Unit": "Count"},
                ],
            }],
        },
        "Retailer": retailer,
        "TotalReported": total_reported or 0,
        "TotalReportedDriftPct": abs(pct) if pct is not None else 0.0,
        "DriftAlarm": 1 if drift.get("alarm") else 0,
        # Ordinary log fields ride along for a human reading the log group.
        "msg": "crawl.drift",
        "runId": run_id,
        "status": drift.get("status"),
        "storeId": drift.get("store_id", ""),
        "trailingStoreId": drift.get("trailing_store_id", ""),
        "trailingMedian": drift.get("trailing_median"),
        "pct": pct,
    }


# ---------------------------------------------------------------- history


def _manifest_summary(m: dict) -> dict:
    cc = m.get("capture_context") or {}
    return {
        "run_id": m.get("run_id"),
        "total_reported": (m.get("counts") or {}).get("total_reported"),
        "store_id": str(cc.get("store_id") or ""),
    }


def _admissible(m: dict) -> bool:
    """Is this manifest a fair baseline to compare a new run against?

    This used to be `_SUCCESS exists`, and that turned out to be a trap. A run
    is only marked complete when rows_written == total_reported exactly, so a
    retailer that keeps landing a handful of rows short earns no `_SUCCESS` at
    all — Woolworths wrote none between 23 Sep and 25 Sep 2026 while still
    capturing 469 of 473 products twice a day. Under the old rule the trailing
    window emptied out, `assess` fell through to `no_history`, and the drift
    check quietly stopped checking precisely when it was most needed.

    A 99.2% run is a perfectly good baseline for a product count. A run that
    died on page 3 is not. Coverage is the honest line between them.
    """
    if m.get("status") == "complete":
        return True
    counts = m.get("counts") or {}
    total, written = counts.get("total_reported"), counts.get("rows_written")
    if not total or written is None:
        return False
    # Page errors mean the gap is unexplained; a clean short run is just short.
    if m.get("errors"):
        return False
    return (written / total) >= MIN_COVERAGE


def s3_history_reader(client, bucket: str):
    """Return `history(prefix, window)` reading trailing baseline runs from S3.

    Walks dt= day prefixes newest first, and within each day takes the runs
    `_admissible` accepts — complete, or short but clean. Needs s3:ListBucket
    on the bucket (scoped to the prefix) and s3:GetObject on the prefix — the
    crawler roles are otherwise write-only.
    """

    def list_days(prefix: str) -> list[str]:
        days = []
        token = None
        while True:
            kw = {"Bucket": bucket, "Prefix": prefix + "/", "Delimiter": "/"}
            if token:
                kw["ContinuationToken"] = token
            res = client.list_objects_v2(**kw)
            for cp in res.get("CommonPrefixes") or []:
                name = cp["Prefix"].rstrip("/").rsplit("/", 1)[-1]
                if name.startswith("dt="):
                    days.append(name)
            token = res.get("NextContinuationToken")
            if not token:
                break
        return sorted(days, reverse=True)

    def list_names(day_prefix: str) -> set[str]:
        names = set()
        token = None
        while True:
            kw = {"Bucket": bucket, "Prefix": day_prefix}
            if token:
                kw["ContinuationToken"] = token
            res = client.list_objects_v2(**kw)
            for o in res.get("Contents") or []:
                names.add(o["Key"][len(day_prefix):])
            token = res.get("NextContinuationToken")
            if not token:
                break
        return names

    def history(prefix: str, window: int = DEFAULT_WINDOW) -> list[dict]:
        out: list[dict] = []
        for day in list_days(prefix)[:MAX_DAYS_BACK]:
            day_prefix = f"{prefix}/{day}/"
            names = list_names(day_prefix)
            run_ids = sorted({m.group(1) for n in names if (m := _RUN_ID_RE.match(n))}, reverse=True)
            for run_id in run_ids:
                if f"{run_id}.manifest.json" not in names:
                    continue
                obj = client.get_object(Bucket=bucket, Key=f"{day_prefix}{run_id}.manifest.json")
                manifest = json.loads(obj["Body"].read())
                if not _admissible(manifest):
                    continue
                out.append(_manifest_summary(manifest))
                if len(out) >= window:
                    return out
        return out

    return history
