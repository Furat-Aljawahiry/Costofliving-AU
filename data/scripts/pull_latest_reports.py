#!/usr/bin/env python3
"""Pull the newest Lambda report per retailer from S3 into data/out.

    python data/scripts/pull_latest_reports.py             # pull + replace
    python data/scripts/pull_latest_reports.py --dry-run   # show what would happen
    python data/scripts/pull_latest_reports.py --keep-old  # pull, leave old files
    python data/scripts/pull_latest_reports.py --retailer coles
    python data/scripts/pull_latest_reports.py --allow-partial

For each retailer this finds the most recent run that earned a `_SUCCESS`
marker (LAMBDA_OUTPUT_SPEC.md section 3: a run without one is incomplete and
must be ignored), downloads its three artefacts, and writes them under the
names the rest of data/out already uses:

    data/out/woolworths_fruit-veg_<date>.csv
    data/out/woolworths_fruit-veg_<date>.cheapest-by-subcategory.csv
    data/out/woolworths_fruit-veg_<date>.manifest.json
    data/out/coles_fruit-vegetables_<date>.csv                   (etc.)

Once the new files are on disk, the previous reports for that retailer at the
top level of data/out are deleted, so the folder holds exactly one run per
retailer. Subfolders (data/out/woolies, data/out/s3) are never touched. The
delete happens only after every download for that retailer succeeded, so a
failed pull leaves the old files exactly as they were.

Drives the AWS CLI rather than boto3, like flatten_run_prefixes.py: the CLI is
what this repo already assumes for credentials and region.
"""
import argparse
import json
import os
import re
import subprocess
import sys

# Env first, literals only as the fallback: server/config.js is the canonical
# copy of these, and this script used to be a third place the bucket name was
# spelled out. Keep them in step by exporting DATA_BUCKET / DATA_PREFIX /
# AWS_REGION (or sourcing .env) rather than editing both.
DEFAULT_BUCKET = os.environ.get("DATA_BUCKET") or "costofliving-au-data-207208119513"
DEFAULT_REGION = os.environ.get("AWS_REGION") or "ap-southeast-2"
DEFAULT_PREFIX = os.environ.get("DATA_PREFIX") or "reports/supermarkets"
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "out")

# S3 prefix the Lambda writes to (infra/terraform/variables.tf) and the
# filename stem data/out already uses for that retailer.
# One entry per crawled category (server/data/categories.js slugs) — the
# meat prefixes are written by lambda_meat.tf.
CATEGORIES = {
    "fruitAndVeg": {
        "woolworths": {"prefix": f"{DEFAULT_PREFIX}/woolworths/fruitAndVeg", "stem": "woolworths_fruit-veg"},
        "coles": {"prefix": f"{DEFAULT_PREFIX}/coles/fruitAndVeg", "stem": "coles_fruit-vegetables"},
    },
    "meatAndPoultry": {
        "woolworths": {"prefix": f"{DEFAULT_PREFIX}/woolworths/meatAndPoultry", "stem": "woolworths_poultry-meat-seafood"},
        "coles": {"prefix": f"{DEFAULT_PREFIX}/coles/meatAndPoultry", "stem": "coles_meat-seafood"},
    },
}
RETAILERS = sorted({r for c in CATEGORIES.values() for r in c})

ARTEFACTS = [".csv", ".cheapest-by-subcategory.csv", ".manifest.json"]

RUN_ID_RE = re.compile(r"^(\d{14}-[0-9a-f]+)\.")


def aws(args, region):
    cmd = ["aws", "--region", region, "--output", "json"] + args
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        sys.exit(f"aws {' '.join(args)} failed:\n{res.stderr.strip()}")
    return res.stdout


def list_days(bucket, prefix, region):
    """Return dt=YYYY-MM-DD folder names under the prefix, newest first."""
    out = aws(["s3api", "list-objects-v2", "--bucket", bucket,
               "--prefix", prefix + "/", "--delimiter", "/"], region)
    data = json.loads(out or "{}")
    days = []
    for cp in data.get("CommonPrefixes", []):
        name = cp["Prefix"].rstrip("/").rsplit("/", 1)[-1]
        if name.startswith("dt="):
            days.append(name)
    return sorted(days, reverse=True)


def list_keys(bucket, prefix, region):
    out = aws(["s3api", "list-objects-v2", "--bucket", bucket, "--prefix", prefix], region)
    data = json.loads(out or "{}")
    return [o["Key"] for o in data.get("Contents", [])]


def newest_run(bucket, prefix, region, allow_partial, max_days=14):
    """Find (day, run_id) of the newest complete run, walking back up to
    max_days day-prefixes. Returns None if nothing qualifies."""
    for day in list_days(bucket, prefix, region)[:max_days]:
        day_prefix = f"{prefix}/{day}/"
        keys = list_keys(bucket, day_prefix, region)
        names = {k[len(day_prefix):] for k in keys}
        run_ids = sorted({m.group(1) for n in names if (m := RUN_ID_RE.match(n))}, reverse=True)
        for run_id in run_ids:
            complete = f"{run_id}._SUCCESS" in names
            has_all = all(f"{run_id}{a}" in names for a in ARTEFACTS)
            if not has_all:
                continue
            if complete or allow_partial:
                return day, run_id, complete
    return None


def local_reports(stem):
    """Existing top-level files in data/out for this retailer's stem."""
    pat = re.compile(rf"^{re.escape(stem)}_\d{{4}}-\d{{2}}-\d{{2}}\.")
    return sorted(f for f in os.listdir(OUT_DIR)
                  if pat.match(f) and os.path.isfile(os.path.join(OUT_DIR, f)))


def pull(retailer, cfg, args):
    found = newest_run(args.bucket, cfg["prefix"], args.region, args.allow_partial)
    if not found:
        print(f"[{retailer}] no complete run found under s3://{args.bucket}/{cfg['prefix']}/")
        return False
    day, run_id, complete = found
    date = day[len("dt="):]
    local_stem = f"{cfg['stem']}_{date}"
    status = "complete" if complete else "PARTIAL"
    print(f"[{retailer}] newest run {run_id} ({day}, {status}) -> {local_stem}.*")

    old = [f for f in local_reports(cfg["stem"]) if not f.startswith(local_stem + ".")]

    for suffix in ARTEFACTS:
        src = f"s3://{args.bucket}/{cfg['prefix']}/{day}/{run_id}{suffix}"
        dst = os.path.join(OUT_DIR, local_stem + suffix)
        if args.dry_run:
            print(f"  would copy {src}\n         -> {os.path.relpath(dst)}")
            continue
        subprocess.run(["aws", "--region", args.region, "s3", "cp", "--only-show-errors", src, dst],
                       check=True)
        print(f"  copied {os.path.relpath(dst)} ({os.path.getsize(dst):,} bytes)")

    if args.keep_old:
        return True
    for f in old:
        p = os.path.join(OUT_DIR, f)
        if args.dry_run:
            print(f"  would delete {os.path.relpath(p)}")
        else:
            os.remove(p)
            print(f"  deleted {os.path.relpath(p)}")
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--bucket", default=os.environ.get("REPORTS_BUCKET", DEFAULT_BUCKET))
    ap.add_argument("--region", default=os.environ.get("AWS_REGION", DEFAULT_REGION))
    ap.add_argument("--retailer", choices=sorted(RETAILERS), action="append",
                    help="only this retailer (repeatable); default: all")
    ap.add_argument("--category", choices=sorted(CATEGORIES), action="append",
                    help="only this crawled category (repeatable); default: all")
    ap.add_argument("--allow-partial", action="store_true",
                    help="accept the newest run even if it has no _SUCCESS marker")
    ap.add_argument("--keep-old", action="store_true",
                    help="do not delete the previous reports in data/out")
    ap.add_argument("--dry-run", action="store_true", help="list actions without copying or deleting")
    args = ap.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)
    ok = True
    for category in args.category or sorted(CATEGORIES):
        for retailer in args.retailer or RETAILERS:
            ok = pull(f"{retailer}/{category}", CATEGORIES[category][retailer], args) and ok
    if not args.dry_run and ok:
        print("done. Restart the server or POST /api/reload to pick up the new files.")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
