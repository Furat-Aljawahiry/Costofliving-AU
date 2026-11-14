"""
Hit the real feed from your laptop, print what WOULD have alerted. No AWS, no
credentials, no writes. This is the thing to run before every deploy and any
time the alerts go quiet for longer than feels right.

    python dry_run.py
    python dry_run.py "pokemon tcg"          # try a different pattern
    python dry_run.py "30th anniversary" "browse:e35ed26c9b1dfb7fd311f93557216816"
    python dry_run.py "pokemon" "bigw:pokemon"   # Big W only

To keep the default pattern and only narrow the sources, set SOURCES in the
environment instead of passing a pattern you then have to keep in sync:

    SOURCES="target-browse:W1852642,target:mini tin" python dry_run.py

Target reads the same way Kmart does -- same host, its own key, direct from a
laptop or a Lambda -- so a Target-only run needs nothing special. Big W is the
only source that needs the residential exit.
"""

import os
import sys

os.environ.setdefault("TABLE_NAME", "dry-run")
os.environ.setdefault("TOPIC_ARN", "dry-run")
if len(sys.argv) > 1:
    os.environ["MATCH_PATTERN"] = sys.argv[1]
if len(sys.argv) > 2:
    os.environ["SOURCES"] = ",".join(sys.argv[2:])

import logging

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

import index  # noqa: E402  -- env must be set before the module reads it


def main():
    print("pattern  :", index.MATCH_PATTERN)
    print("sources  :", os.environ.get("SOURCES", index.DEFAULT_SOURCES))
    print()

    hits, failed = index.collect(all_sources=True)  # ignore the Big W cadence
    if failed:
        print("FAILED sources (the tick would raise after alerting):", failed, "\n")
    if not hits:
        print("nothing would alert right now.")
        return
    by = {}
    for h in hits:
        by[index.retailer(h)] = by.get(index.retailer(h), 0) + 1
    print("would alert on {} product(s) {}:\n".format(len(hits), by))
    print(index.message(hits))


if __name__ == "__main__":
    main()
