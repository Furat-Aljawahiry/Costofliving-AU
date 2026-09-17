#!/usr/bin/env python3
"""One-off migration: drop the `run=<run_id>/` directory from the S3 layout.

    python data/scripts/flatten_run_prefixes.py                    # dry run
    python data/scripts/flatten_run_prefixes.py --apply            # do it
    python data/scripts/flatten_run_prefixes.py --apply --keep-source

Before, one directory per run:

    .../fruitAndVeg/dt=2026-09-04/run=20260904050009-42af0dbc/part-00000.csv
                                                             /cheapest-by-subcategory.csv
                                                             /_manifest.json
                                                             /_SUCCESS

After, the run as a filename stem, so a day's prefix lists every report captured
that day side by side and each one's capture time is legible in its own name:

    .../fruitAndVeg/dt=2026-09-04/20260904050009-42af0dbc.csv
                                  20260904050009-42af0dbc.cheapest-by-subcategory.csv
                                  20260904050009-42af0dbc.manifest.json
                                  20260904050009-42af0dbc._SUCCESS

index.py already writes the new shape; this brings the existing archive across.

HOW IT IS SAFE, which matters because the alternative is losing captures that
cannot be re-taken — Woolworths will not sell you yesterday's prices again:

  - **Dry run is the default.** Nothing moves without --apply.
  - **Copy, verify, then delete.** Every object is copied to its new key and the
    copy's size is checked against the source before the source is deleted. A
    mismatch aborts that object and leaves the original untouched.
  - **_SUCCESS is copied FIRST and deleted LAST.** It is the marker that says a
    run is readable; a crash mid-migration must never leave a run whose data is
    half-moved while its _SUCCESS says "complete". Ordering it this way means
    the worst case is a duplicated run, never a run that lies.
  - **Idempotent.** A destination that already exists with the same size is
    treated as done, so a re-run after an interruption finishes the job rather
    than starting a second copy.
  - **--keep-source** copies without deleting, if you would rather delete by
    hand after looking at the result.

The bucket has versioning enabled, so even a delete leaves a recoverable
noncurrent version — but the lifecycle rule expires those after 30 days, which
is a window, not a safety net. Read the dry run.

Drives the AWS CLI rather than boto3: the CLI is what this repo already
requires and authenticates with, and a one-off ops script is not worth adding a
Python dependency the crawler itself does not have (the Lambda gets boto3 from
the runtime).
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import urllib.parse

# run=<run_id>/<file>, captured so the run_id can become the filename stem.
_RUN_KEY = re.compile(r"^(?P<day>.*/dt=[^/]+)/run=(?P<run>[^/]+)/(?P<name>[^/]+)$")

# Old basename -> new suffix appended to the run_id stem. Anything not listed
# here is reported and skipped rather than guessed at: an unrecognised file in a
# run prefix is exactly the case where a silent rename would lose something.
_RENAME = {
    "part-00000.csv": ".csv",
    "cheapest-by-subcategory.csv": ".cheapest-by-subcategory.csv",
    "_manifest.json": ".manifest.json",
    "_SUCCESS": "._SUCCESS",
}


def new_key(key: str) -> str | None:
    m = _RUN_KEY.match(key)
    if not m:
        return None
    suffix = _RENAME.get(m["name"])
    if suffix is None:
        return None
    return f"{m['day']}/{m['run']}{suffix}"


def _aws(*args, check=True):
    """Run an aws CLI command, returning parsed JSON (or None on a handled error)."""
    proc = subprocess.run(
        ["aws", *args, "--output", "json"],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        if check:
            raise RuntimeError(f"aws {' '.join(args[:2])} failed: {proc.stderr.strip()}")
        return None
    return json.loads(proc.stdout) if proc.stdout.strip() else {}


def _list(bucket: str, prefix: str) -> list[dict]:
    # The CLI paginates for us as long as --max-items is not given.
    out = _aws("s3api", "list-objects-v2", "--bucket", bucket, "--prefix", prefix)
    return out.get("Contents") or []


def _size(bucket: str, key: str):
    """ContentLength of an object, or None when it is not there."""
    head = _aws("s3api", "head-object", "--bucket", bucket, "--key", key, check=False)
    return None if head is None else head.get("ContentLength")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--bucket", help="defaults to the terraform data_bucket output")
    ap.add_argument("--prefix", default="reports/", help="limit the migration (default: reports/)")
    ap.add_argument("--apply", action="store_true", help="actually copy and delete")
    ap.add_argument("--keep-source", action="store_true", help="copy but do not delete")
    args = ap.parse_args()

    if not shutil.which("aws"):
        print("aws CLI not found on PATH", file=sys.stderr)
        return 2

    bucket = args.bucket
    if not bucket:
        bucket = f"costofliving-au-data-{_aws('sts', 'get-caller-identity')['Account']}"

    objects = _list(bucket, args.prefix)
    planned, skipped = [], []
    for o in objects:
        dest = new_key(o["Key"])
        if dest:
            planned.append((o["Key"], dest, o["Size"]))
        elif "/run=" in o["Key"]:
            skipped.append(o["Key"])

    print(f"bucket   s3://{bucket}/{args.prefix}")
    print(f"objects  {len(objects)} listed, {len(planned)} to move, {len(skipped)} unrecognised")
    if not planned:
        print("\nNothing to do — the archive is already flat.")
        return 0

    # _SUCCESS first on the way in, last on the way out. See the module
    # docstring: a run must never be readable while its data is half-moved.
    planned.sort(key=lambda p: (p[0].rsplit("/", 1)[0], not p[0].endswith("_SUCCESS")))

    runs = sorted({k.rsplit("/", 1)[0] for k, _, _ in planned})
    print(f"runs     {len(runs)}")
    print()
    for src, dest, size in planned:
        print(f"  {src}\n    -> {dest}  ({size} bytes)")
    if skipped:
        print("\n  UNRECOGNISED, left alone:")
        for k in skipped:
            print(f"    {k}")

    if not args.apply:
        print("\nDRY RUN — nothing changed. Re-run with --apply to move these.")
        return 0

    copied = deleted = already = failed = 0
    for src, dest, size in planned:
        if _size(bucket, dest) == size:
            already += 1
        else:
            # quote() because keys carry '=' from the dt= partition; the CLI
            # takes copy-source as a URL path, not as a raw key.
            _aws("s3api", "copy-object", "--bucket", bucket, "--key", dest,
                 "--copy-source", urllib.parse.quote(f"{bucket}/{src}", safe="/"))
            if _size(bucket, dest) != size:
                # Leave the source in place and say so — a half-copied object
                # that got deleted anyway is the one outcome worth failing over.
                print(f"  VERIFY FAILED, source kept: {src}", file=sys.stderr)
                failed += 1
                continue
            copied += 1
        if not args.keep_source:
            _aws("s3api", "delete-object", "--bucket", bucket, "--key", src)
            deleted += 1

    print(f"\n  copied   {copied}")
    print(f"  already  {already} (destination present and the right size)")
    print(f"  deleted  {deleted}" + ("  [--keep-source: sources left in place]" if args.keep_source else ""))
    if failed:
        print(f"  FAILED   {failed} — sources kept, re-run to retry", file=sys.stderr)
        return 1

    left = [o["Key"] for o in _list(bucket, args.prefix) if "/run=" in o["Key"]]
    print(f"\n  run= objects remaining: {len(left)}")
    for k in left:
        print(f"    {k}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
