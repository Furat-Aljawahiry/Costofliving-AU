"""
Hit the real feed from your laptop, print what WOULD have alerted. No AWS, no
credentials, no writes. This is the thing to run before every deploy and any
time the alerts go quiet for longer than feels right.

    python dry_run.py
    python dry_run.py "pokemon tcg"          # try a different pattern
    python dry_run.py "30th anniversary" "browse:615bf6db4dee158ccbbc1ed5aef1ced9"
"""

import os
import sys

os.environ.setdefault("TABLE_NAME", "dry-run")
os.environ.setdefault("TOPIC_ARN", "dry-run")
if len(sys.argv) > 1:
    os.environ["MATCH_PATTERN"] = sys.argv[1]
if len(sys.argv) > 2:
    os.environ["SOURCES"] = ",".join(sys.argv[2:])

import index  # noqa: E402  -- env must be set before the module reads it


def main():
    print("key      :", index.constructor_key())
    print("pattern  :", index.MATCH_PATTERN)
    print("sources  :", os.environ.get("SOURCES", index.DEFAULT_SOURCES))
    print()

    hits = index.collect()
    if not hits:
        print("nothing would alert right now.")
        return
    print("would alert on {} product(s):\n".format(len(hits)))
    print(index.message(hits))


if __name__ == "__main__":
    main()
