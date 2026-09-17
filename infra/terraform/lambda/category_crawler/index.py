"""Lambda: crawl retailer browse categories -> CSV + manifest in S3.

ONE codebase, ONE zip. A single invocation crawls one retailer or several —
`RETAILERS=woolworths,coles` crawls both, every page of Fruit & Veg at each,
back to back. Which retailers run is configuration, never a fork of the code,
because the entire value of the second retailer is that its file is
column-for-column joinable with the first, and the surest way to guarantee that
is for both to be written by the same `crawler.to_csv`.

Per retailer, this writes the artefacts required by data/LAMBDA_OUTPUT_SPEC.md
section 3, four objects sharing one <run_id> stem:
    <prefix>/dt=<UTC date>/<run_id>.csv
    <prefix>/dt=<UTC date>/<run_id>.cheapest-by-subcategory.csv
    <prefix>/dt=<UTC date>/<run_id>.manifest.json
    <prefix>/dt=<UTC date>/<run_id>._SUCCESS         <- written LAST, only on a
                                                        complete run
The run is a FILENAME STEM, not a directory: a day's prefix lists every report
captured that day side by side, and the run_id leads with its UTC timestamp
(YYYYMMDDHHMMSS-<rand>) so that listing sorts into capture order for free.

A consumer must ignore any run whose `<run_id>._SUCCESS` is absent: that is the
only protection against reading a half-written CSV from a timed-out invocation.
Runs are still never overwritten — the stem carries the run_id, so a re-run on
the same day lands beside its predecessor rather than on top of it.

Each retailer keeps its OWN prefix, so a bad Coles run can never contaminate the
Woolworths series. When more than one retailer runs and COMBINED_OUTPUT_PREFIX
is set, a fourth artefact is written: the union of both retailers' rows in one
CSV, under its own prefix, with the same header. That file is a convenience over
the per-retailer files, never a substitute — it is built from the very same
in-memory rows, so it cannot disagree with them.

All retailers in one invocation share a single `run_id`. That is what lets a
reader say "these two files are the same capture" rather than having to match on
timestamps that are minutes apart.

One retailer failing does not cancel the other: each is crawled, written and
reported independently, and the invocation raises at the very END if any of them
failed — after the good data is safely in S3, and still loudly enough to trip
the error alarm.

Runtime: python3.13. No dependencies beyond boto3, which the runtime bundles,
and the standard library. Nothing to build or vendor.

Egress optionally goes through a Decodo/Smartproxy residential session — see
proxy.py. The credential is read at cold start from the Secrets Manager secret
named by PROXY_SECRET_ID; unset, this behaves exactly as it did before and
crawls from the Lambda's own address.
"""

from __future__ import annotations

import json
import os

import coles
import woolworths
from cheapest import build_cheapest_rows
from cheapest import to_csv as cheapest_to_csv
from crawler import SCHEMA_VERSION, crawl_category, new_run_id, to_csv, utc_now_iso
from proxy import resolve_proxy

RETAILERS = {m.RETAILER: m for m in (woolworths, coles)}

# Crawl both by default. A function that is meant to crawl only one sets
# RETAILER (singular) or RETAILERS to just that name.
DEFAULT_RETAILERS = ["woolworths", "coles"]

DEFAULT_PREFIX = {
    "woolworths": "reports/supermarkets/woolworths/fruitAndVeg",
    "coles": "reports/supermarkets/coles/fruitAndVeg",
}

# Coles serves an anonymous request a default store rather than a located one,
# so its postcode is genuinely unknown and must stay empty rather than borrow
# the Woolworths pin (COLES_DISCOVERY.md section 5.5).
DEFAULT_POSTCODE = {"woolworths": "2000", "coles": ""}

# The union file is its own dataset, not an extension of either retailer's —
# spec section 9 rule 1. Same columns, same schema version, different name.
COMBINED_DATASET = "supermarkets.products"

BUCKET = os.environ.get("OUTPUT_BUCKET")
DELAY_MS = int(os.environ.get("PAGE_DELAY_MS", "700"))
# Probe the exit IP once per run by default: one extra request per day, and it
# puts the address we crawled from in the log next to the run id.
PROBE = os.environ.get("PROXY_PROBE", "true").lower() == "true"

_s3 = None


def resolve_retailer(name: str):
    try:
        return RETAILERS[(name or "").strip().lower()]
    except KeyError:
        raise RuntimeError(
            f"unknown retailer {name!r}; expected one of {sorted(RETAILERS)}"
        ) from None


def resolve_retailers(event: dict) -> list:
    """Which retailers this invocation crawls, in order.

    Accepts a list (`retailers`) or a single name (`retailer`) from the event,
    then the same two from the environment, then both retailers. A
    comma-separated string is accepted everywhere a list is, because that is the
    only shape a Lambda env var can take.
    """
    raw = (
        event.get("retailers")
        or event.get("retailer")
        or os.environ.get("RETAILERS")
        or os.environ.get("RETAILER")
        or DEFAULT_RETAILERS
    )
    names = raw.split(",") if isinstance(raw, str) else list(raw)
    # "all" is spelled out rather than inferred, so an empty env var can never
    # silently mean "crawl everything".
    if [str(n).strip().lower() for n in names] == ["all"]:
        names = list(RETAILERS)

    out, seen = [], set()
    for n in names:
        m = resolve_retailer(n)
        if m.RETAILER not in seen:
            seen.add(m.RETAILER)
            out.append(m)
    if not out:
        raise RuntimeError("no retailers resolved; set RETAILERS=woolworths,coles")
    return out


def _setting(name: str, retailer: str, single: bool, default=None):
    """Per-retailer env var, falling back to the bare one only when alone.

    `COLES_CATEGORY_URL` beats `CATEGORY_URL`. The bare name is honoured only
    when this invocation crawls exactly ONE retailer — in a two-retailer
    function a bare `CATEGORY_ID` would be a Woolworths node id handed to Coles,
    which is not a misconfiguration worth being tolerant about.
    """
    names = [f"{retailer.upper()}_{name}"] + ([name] if single else [])
    for n in names:
        v = os.environ.get(n)
        if v:
            return v
    return default


def _setting_present(name: str, retailer: str, single: bool, default=None):
    """As `_setting`, but an explicitly EMPTY value counts as a real answer.

    Only postcode needs this: "" means "we do not know which store priced this",
    which is the honest Coles answer and must not fall through to a default.
    """
    names = [f"{retailer.upper()}_{name}"] + ([name] if single else [])
    for n in names:
        if n in os.environ:
            return os.environ[n]
    return default


def _s3_put(bucket: str, key: str, body: str, content_type: str):
    # Imported lazily so this module can be exercised with an injected writer
    # and no boto3 credentials on the path.
    global _s3
    if _s3 is None:
        import boto3

        _s3 = boto3.client("s3")
    return _s3.put_object(
        Bucket=bucket, Key=key, Body=body.encode("utf-8"), ContentType=content_type
    )


def _run_one(retailer, event, put, bucket, run_id, delay_ms, resolved_proxy, probe, single):
    """Crawl one retailer end to end and write its four artefacts.

    Returns (result, rows, cheapest_rows). Raises if the crawl produced nothing
    usable — the caller decides whether that ends the invocation.
    """
    slug = retailer.RETAILER
    prefix = _setting("OUTPUT_PREFIX", slug, single, DEFAULT_PREFIX[slug])
    postcode = _setting_present("POSTCODE", slug, single, DEFAULT_POSTCODE[slug])

    # Event-level target overrides address ONE category, so they only make sense
    # when one retailer is being crawled: a Woolworths node id means nothing to
    # Coles, whose identifier is the browse path.
    ev = event if single else {}
    category = ev.get("category") or _setting("CATEGORY_ID", slug, single) or retailer.DEFAULTS["category"]
    url = ev.get("url") or _setting("CATEGORY_URL", slug, single) or retailer.DEFAULTS["url"]
    name = ev.get("name") or _setting("CATEGORY_NAME", slug, single) or retailer.DEFAULTS["name"]

    if delay_ms is None:
        per_retailer = _setting("PAGE_DELAY_MS", slug, single)
        delay_ms = int(per_retailer) if per_retailer else DELAY_MS

    captured_at = utc_now_iso()

    print(json.dumps({
        "msg": "crawl.start", "runId": run_id, "retailer": slug,
        "category": category, "name": name, "bucket": bucket, "prefix": prefix,
        "egress": f"{resolved_proxy.host}:{resolved_proxy.port}" if resolved_proxy else "direct",
    }))

    rows, manifest = crawl_category(
        retailer,
        category=category, url=url, name=name,
        postcode=postcode,
        run_id=run_id, captured_at=captured_at,
        delay_ms=delay_ms,
        # 0 means every page, which is the point of the daily run. maxPages is
        # for hand invocations and for the test harness.
        max_pages=event.get("maxPages") or 0,
        proxy=resolved_proxy,
        probe=PROBE if probe is None else probe,
        log=lambda m: print(f"  [{slug}] {m}"),
    )

    if not rows:
        # Nothing usable: do not write _SUCCESS, and fail loudly so the alarm fires.
        print(json.dumps({"msg": "crawl.empty", "runId": run_id, "retailer": slug,
                          "manifest": manifest}))
        raise RuntimeError(f"crawl produced 0 rows for {name} ({category}) at {slug}")

    # Derived report: cheapest buyable line per sap_subcategory (spec 3.3).
    # Built from the same in-memory rows as the raw CSV, so the two can never
    # disagree about what was captured.
    cheapest_rows, cheapest_summary = build_cheapest_rows(rows, {
        "retailer": slug,
        "run_id": run_id,
        "captured_at": captured_at,
        "postcode": postcode,
        "price_basis": manifest["capture_context"]["price_basis"],
    })
    manifest["cheapest_by_subcategory"] = cheapest_summary

    day = f"{prefix}/dt={captured_at[:10]}"
    stem = f"{day}/{run_id}"

    put(f"{stem}.csv", to_csv(rows), "text/csv; charset=utf-8")
    put(f"{stem}.cheapest-by-subcategory.csv",
        cheapest_to_csv(cheapest_rows), "text/csv; charset=utf-8")
    put(f"{stem}.manifest.json", json.dumps(manifest, indent=2), "application/json")

    # _SUCCESS marks the run readable. Only a genuinely complete run earns it —
    # a 'partial' run leaves real data plus a manifest explaining the gap, but
    # consumers will skip it rather than silently under-report the category.
    if manifest["status"] == "complete":
        put(f"{stem}._SUCCESS", "", "text/plain")
    else:
        print(json.dumps({
            "msg": "crawl.partial", "runId": run_id, "retailer": slug,
            "counts": manifest["counts"], "errors": manifest["errors"],
        }))

    result = {
        "runId": run_id,
        "retailer": slug,
        "status": manifest["status"],
        "s3": f"s3://{bucket}/{stem}.csv",
        "dayPrefix": f"s3://{bucket}/{day}/",
        "rows": len(rows),
        "cheapestRows": cheapest_summary["rows_written"],
        "reported": manifest["counts"]["total_reported"],
        "pages": manifest["counts"]["pages_fetched"],
        "egress": manifest["capture_context"]["egress"],
        "proxyRotations": manifest["counts"]["proxy_rotations"],
        "sponsoredDuplicatesDropped": manifest["counts"]["sponsored_duplicates_dropped"],
    }
    print(json.dumps({"msg": "crawl.done", **result}))
    return result, rows, cheapest_rows


def _put_combined(put, bucket, run_id, started_at, prefix, members, rows, cheapest_rows, errors):
    """Write the union of every retailer's rows as one CSV under its own prefix.

    Same COLUMNS, same writer, so this file is the per-retailer files
    concatenated and nothing else — `retailer` is already a column, which is why
    a union needs no reshaping at all.

    The cheapest report is likewise the per-retailer reports concatenated, NOT
    recomputed across retailers: recomputing would return the cheaper of the two
    supermarkets per subcategory and quietly destroy the per-retailer series
    that the basket is actually built on.
    """
    stem = f"{prefix}/dt={started_at[:10]}/{run_id}"
    complete = not errors and all(m["status"] == "complete" for m in members)

    manifest = {
        "schema_version": SCHEMA_VERSION,
        "dataset": COMBINED_DATASET,
        "run_id": run_id,
        "retailers": [m["retailer"] for m in members],
        "started_at_utc": started_at,
        "finished_at_utc": utc_now_iso(),
        "status": "complete" if complete else "partial",
        # Where each half came from, so this file can always be traced back to
        # the authoritative per-retailer run it was built from.
        "members": members,
        "counts": {
            "rows_written": len(rows),
            "rows_by_retailer": {m["retailer"]: m["rows"] for m in members},
            "cheapest_rows_written": len(cheapest_rows),
        },
        "errors": errors,
    }

    put(f"{stem}.csv", to_csv(rows), "text/csv; charset=utf-8")
    put(f"{stem}.cheapest-by-subcategory.csv",
        cheapest_to_csv(cheapest_rows), "text/csv; charset=utf-8")
    put(f"{stem}.manifest.json", json.dumps(manifest, indent=2), "application/json")
    if complete:
        put(f"{stem}._SUCCESS", "", "text/plain")

    return {
        "s3": f"s3://{bucket}/{stem}.csv",
        "status": manifest["status"],
        "rows": len(rows),
        "cheapestRows": len(cheapest_rows),
    }


def run(event=None, put=None, bucket=None, delay_ms=None, proxy=..., probe=None) -> dict:
    """Core run logic, with the object writer injected so it can be exercised
    without AWS. `put(key, body, content_type)` must not raise on success.

    Returns the single retailer's result dict when one retailer was crawled —
    unchanged from before — and a batch summary when several were.
    """
    event = event or {}
    bucket = bucket if bucket is not None else os.environ.get("OUTPUT_BUCKET")

    targets = resolve_retailers(event)
    single = len(targets) == 1

    # One run_id for the whole invocation: the Woolworths file and the Coles
    # file written by the same trigger carry the same id, which is what makes
    # them one capture rather than two that happened to be close in time.
    run_id = new_run_id()
    started_at = utc_now_iso()

    # Throws when PROXY_REQUIRED=true and nothing is configured — deliberately
    # before any request goes out, so a misconfigured deploy fails on the alarm
    # rather than quietly crawling from the Lambda's own AWS address.
    resolved_proxy = resolve_proxy() if proxy is ... else proxy

    print(json.dumps({
        "msg": "batch.start", "runId": run_id,
        "retailers": [t.RETAILER for t in targets], "bucket": bucket,
    }))

    results, failures = [], []
    all_rows, all_cheapest = [], []

    for retailer in targets:
        try:
            result, rows, cheapest = _run_one(
                retailer, event, put, bucket, run_id,
                delay_ms, resolved_proxy, probe, single,
            )
        except Exception as e:
            # One retailer being blocked is not a reason to throw away the
            # other's data — record it, keep going, and raise once at the end.
            failures.append({"retailer": retailer.RETAILER, "message": str(e)})
            print(json.dumps({
                "msg": "crawl.failed", "runId": run_id,
                "retailer": retailer.RETAILER, "error": str(e),
            }))
            continue
        results.append(result)
        all_rows.extend(rows)
        all_cheapest.extend(cheapest)

    if single:
        # Unchanged single-retailer contract: the one result, and the original
        # exception rather than a batch wrapper around it.
        if failures:
            raise RuntimeError(failures[0]["message"])
        return results[0]

    combined = None
    combined_prefix = os.environ.get("COMBINED_OUTPUT_PREFIX")
    if combined_prefix and all_rows:
        combined = _put_combined(
            put, bucket, run_id, started_at, combined_prefix,
            results, all_rows, all_cheapest, failures,
        )

    summary = {
        "runId": run_id,
        "status": (
            "failed" if not results
            else "complete" if not failures and all(r["status"] == "complete" for r in results)
            else "partial"
        ),
        "retailers": results,
        "rows": len(all_rows),
        "cheapestRows": len(all_cheapest),
        "combined": combined,
        "failures": failures,
    }
    print(json.dumps({"msg": "batch.done", **summary}))

    if failures:
        # Everything that worked is already in S3. Raise anyway: an invocation
        # error is how a block reaches a human (see the CloudWatch alarms).
        raise RuntimeError(
            "run {}: {} of {} retailers failed — {}".format(
                run_id, len(failures), len(targets),
                "; ".join(f"{f['retailer']}: {f['message']}" for f in failures),
            )
        )
    return summary


def handler(event=None, context=None):
    """Lambda entrypoint: wires `run` to real S3."""
    if not BUCKET:
        raise RuntimeError("OUTPUT_BUCKET env var is required")
    return run(
        event or {},
        put=lambda key, body, content_type: _s3_put(BUCKET, key, body, content_type),
    )
