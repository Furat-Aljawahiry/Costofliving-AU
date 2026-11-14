# -*- coding: utf-8 -*-
"""
Hit every configured source on its own and report: did it answer, how many rows
did it return, how many of those would alert. A source returning 0 ROWS is the
thing to worry about -- it means the feed changed shape and the watcher has gone
quiet without erroring. 0 alert-worthy rows is normal and fine.

    python audit_sources.py
"""
import os
import sys
import time

os.environ.setdefault("TABLE_NAME", "audit")
os.environ.setdefault("TOPIC_ARN", "audit")

import index  # noqa: E402

RETAILER = {
    "browse": "Kmart", "search": "Kmart",
    "bigw": "Big W",
    "target": "Target", "target-browse": "Target",
    "jb": "JB Hi-Fi",
}


def main():
    specs = [s for s in os.environ.get("SOURCES", index.DEFAULT_SOURCES).split(",") if s.strip()]
    print("pattern: %s\n" % index.MATCH_PATTERN)
    print("%-9s %-34s %7s %7s %7s  %s" % ("RETAILER", "SOURCE", "ROWS", "ALERT", "SECS", "STATUS"))
    print("-" * 92)

    bad, empty = [], []
    for spec in specs:
        kind, target = index.parse_source(spec)
        t0 = time.time()
        try:
            rows = index.read_source(kind, target)
            picked = index.select(kind, rows)
            status, took = "ok", time.time() - t0
            if not rows:
                status = "EMPTY -- feed may have changed shape"
                empty.append(spec)
        except Exception as exc:  # noqa: BLE001 -- reporting, not isolating
            rows, picked, took = [], [], time.time() - t0
            status = "FAILED: %s: %s" % (type(exc).__name__, str(exc)[:46])
            bad.append(spec)
        print("%-9s %-34s %7d %7d %7.1f  %s"
              % (RETAILER.get(kind, "?"), spec[:34], len(rows), len(picked), took, status))

    print()
    # Per-retailer rollup, so a retailer that is wholly dead is obvious.
    by = {}
    for spec in specs:
        kind, _ = index.parse_source(spec)
        r = RETAILER.get(kind, "?")
        by.setdefault(r, [0, 0])
        by[r][0] += 1
        by[r][1] += 1 if spec in bad else 0
    for r in sorted(by):
        n, f = by[r]
        print("  %-9s %d/%d sources answering" % (r, n - f, n))

    print()
    if bad:
        print("FAILED sources (the live tick would raise and the alarm would fire):")
        for s in bad:
            print("   " + s)
    if empty:
        print("EMPTY sources (no error, but no rows -- check the feed shape):")
        for s in empty:
            print("   " + s)
    if not bad and not empty:
        print("All sources answered with rows.")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
