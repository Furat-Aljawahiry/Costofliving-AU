#!/usr/bin/env python3
"""Local CLI for the category crawlers — writes CSV + manifest to disk instead
of S3. Shares ALL crawl and parse logic with the Lambda via crawler.py and the
retailer adapters, so local output and deployed output cannot diverge.

    python data/scripts/crawl_category.py --retailer coles
    python data/scripts/crawl_category.py --retailer woolworths

    python data/scripts/crawl_category.py --retailer woolworths \\
        --category 1_D5A2236 \\
        --url /shop/browse/poultry-meat-seafood \\
        --name "Poultry, Meat & Seafood"

    python data/scripts/crawl_category.py --retailer coles \\
        --url /browse/fruit-vegetables/vegetables/potatoes \\
        --name "Potatoes"

Woolworths node ids come from GET /apis/ui/PiesCategoriesWithSpecials. Coles
needs no node id — the browse path IS the identifier — and its category tree,
with per-node product counts, rides along inside every page it returns.

Both retailers write the same columns (crawler.COLUMNS) to SEPARATE files.
Output contract: data/LAMBDA_OUTPUT_SPEC.md schema 1.1.

To crawl through the same Decodo/Smartproxy residential session the Lambda
uses, set PROXY_URL in the environment (or pass --proxy) — this is the way to
verify proxy config locally before spending a deploy on it:

    PROXY_URL=http://user-<account>:<pass>@gate.decodo.com:7000 \\
        python data/scripts/crawl_category.py --maxPages 1
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
sys.path.insert(0, str(REPO / "infra" / "terraform" / "lambda" / "category_crawler"))

from cheapest import build_cheapest_rows  # noqa: E402
from cheapest import to_csv as cheapest_to_csv  # noqa: E402
from crawler import crawl_category, new_run_id, to_csv, utc_now_iso  # noqa: E402
from index import resolve_retailer  # noqa: E402
from proxy import parse_proxy_url, proxy_from_env, redact  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description="Crawl one retailer browse category to CSV.")
    ap.add_argument("--retailer", default="woolworths", choices=["woolworths", "coles"])
    ap.add_argument("--category", default=None, help="node id (Woolworths) or slug path (Coles)")
    ap.add_argument("--url", default=None, help="browse path, e.g. /browse/fruit-vegetables")
    ap.add_argument("--name", default=None)
    ap.add_argument("--postcode", default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--maxPages", dest="max_pages", type=int, default=0)
    ap.add_argument("--proxy", default=None, help="proxy URL; overrides PROXY_URL")
    args = ap.parse_args()

    retailer = resolve_retailer(args.retailer)
    category = args.category or retailer.DEFAULTS["category"]
    url = args.url or retailer.DEFAULTS["url"]
    name = args.name or retailer.DEFAULTS["name"]
    # Coles is served a default store rather than a located one, so it has no
    # honest postcode to report (COLES_DISCOVERY.md section 5.5).
    postcode = args.postcode if args.postcode is not None else (
        "2000" if retailer.RETAILER == "woolworths" else ""
    )

    # --proxy wins over PROXY_URL so one shell can try several exits without
    # re-exporting the environment.
    if args.proxy:
        proxy = parse_proxy_url(args.proxy, country=os.environ.get("PROXY_COUNTRY", "au"))
    else:
        proxy = proxy_from_env()

    run_id = new_run_id()
    captured_at = utc_now_iso()

    print(f"run_id={run_id}  retailer={retailer.RETAILER}  category={name} ({category})")
    egress = (
        redact(f"http://{proxy.user}:x@{proxy.host}:{proxy.port}") if proxy else "direct"
    )
    print(f"egress={egress}")

    rows, manifest = crawl_category(
        retailer,
        category=category,
        url=url,
        name=name,
        postcode=postcode,
        run_id=run_id,
        captured_at=captured_at,
        max_pages=args.max_pages,
        proxy=proxy,
        probe=bool(proxy),  # locally the exit IP is the whole point of the check
        log=lambda m: print(f"  {m}"),
    )

    if not rows:
        print("\n  no rows — nothing written", file=sys.stderr)
        for e in manifest["errors"]:
            print(f"  page {e['page']}: {e['message']}", file=sys.stderr)
        return 1

    slug = [s for s in url.split("/") if s][-1]
    base = args.out or str(REPO / "data" / "out" / f"{retailer.RETAILER}_{slug}_{captured_at[:10]}")
    csv_path = Path(base if base.endswith(".csv") else base + ".csv")
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    # newline="" so Windows does not translate the csv writer's LF into CRLF.
    # The Lambda writes LF to S3, and local output must match it byte for byte
    # or the two are not actually comparable.
    with open(csv_path, "w", encoding="utf-8", newline="") as f:
        f.write(to_csv(rows))

    # Same derived report the Lambda writes next to the raw CSV, from the same
    # rows — so a local run and a deployed run are byte-comparable.
    cheapest_rows, cheapest_summary = build_cheapest_rows(rows, {
        "retailer": retailer.RETAILER,
        "run_id": run_id,
        "captured_at": captured_at,
        "postcode": postcode,
        "price_basis": manifest["capture_context"]["price_basis"],
    })
    manifest["cheapest_by_subcategory"] = cheapest_summary

    cheapest_path = csv_path.with_name(csv_path.stem + ".cheapest-by-subcategory.csv")
    with open(cheapest_path, "w", encoding="utf-8", newline="") as f:
        f.write(cheapest_to_csv(cheapest_rows))

    manifest_path = csv_path.with_suffix(".manifest.json")
    with open(manifest_path, "w", encoding="utf-8", newline="") as f:
        f.write(json.dumps(manifest, indent=2))

    c = manifest["counts"]
    print(f"\n  tiles seen        {c['tiles_seen']}")
    print(f"  sponsored tiles   {c['sponsored_tiles']} ({c['sponsored_duplicates_dropped']} duplicate rows dropped)")
    print(f"  market skipped    {c['market_products_skipped']}")
    print(f"  rows written      {c['rows_written']} / {c['total_reported']} reported")
    print(f"  with a price      {c['rows_with_price']}")
    print(f"  with warnings     {c['rows_with_warnings']}")

    cc = manifest["capture_context"]
    exit_ip = f" ({cc['exit_ip']})" if cc["exit_ip"] else ""
    print(f"\n  egress   {cc['egress']}{exit_ip}")
    if cc.get("build_id"):
        print(f"  buildId  {cc['build_id']}{' (pinned)' if cc.get('build_id_pinned') else ''}")
    if cc.get("store_id"):
        print(f"  store    {cc['store_id']}")
    if c["proxy_rotations"]:
        print(f"  rotations {c['proxy_rotations']} — blocked mid-crawl")
    print(f"  status   {manifest['status']}")
    print(f"\n  cheapest rows     {cheapest_summary['rows_written']} over "
          f"{cheapest_summary['subcategories']} subcategories ({cheapest_summary['on_special']} on special)")

    print(f"\n  CSV      {csv_path.relative_to(REPO) if csv_path.is_relative_to(REPO) else csv_path}")
    print(f"  cheapest {cheapest_path.relative_to(REPO) if cheapest_path.is_relative_to(REPO) else cheapest_path}")
    print(f"  manifest {manifest_path.relative_to(REPO) if manifest_path.is_relative_to(REPO) else manifest_path}")

    if manifest["status"] != "complete":
        print(f"\n  STATUS: partial — {len(manifest['errors'])} page error(s)", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
