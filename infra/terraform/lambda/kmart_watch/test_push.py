"""
Send yourself ONE real push, to prove the channel works before you deploy.
No AWS, no writes, nothing touched but your phone.

    python test_push.py ntfy:some-long-random-topic
    python test_push.py pushover:<user_key>:<app_token>
    python test_push.py telegram:<bot_token>:<chat_id>

With no second argument it sends a fake pre-order hit with a real Kmart link,
so you can check the notification is tappable and lands where you expect.

Give it a product name and it finds that product on the LIVE feed instead and
pushes the real row -- real title, real price, real stock, real link:

    python test_push.py ntfy:<topic> "perfect order blister"
    python test_push.py ntfy:<topic> "mini tin" --kmart

That is the more useful test of the two, because it exercises the whole chain
(fetch -> normalise -> _title/_body -> push) rather than just the channel, and
a Target row is the only way to see the availableonlineqty line render. The
product does NOT have to match MATCH_PATTERN -- the lookup is a plain substring
search, deliberately, so you can test with whatever is on the shelf today.

`tfvars` in place of the target reads kmart_watch_push_target out of
../../terraform.tfvars, so the topic never has to go on your command line:

    python test_push.py tfvars "perfect order blister"
"""

import os
import re
import sys

os.environ.setdefault("TABLE_NAME", "dry-run")
os.environ.setdefault("TOPIC_ARN", "dry-run")

import push  # noqa: E402

SAMPLE = {
    "id": "TEST",
    "name": "TEST — Pokemon 30th Anniversary Plush",
    "url": "https://www.kmart.com.au/category/toys/",
    "price": 19,
    "preorder": True,
}

TFVARS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "terraform.tfvars")

# Where to look for a named product, in order. The browse group is second
# because it is small and specific: a search can out-rank the thing you asked
# for, but "Pokemon Cards" either holds it or does not.
TARGET_SOURCES = ["target:{}", "target-browse:W1852642"]
KMART_SOURCES = ["search:{}", "browse:e35ed26c9b1dfb7fd311f93557216816"]


def target_from_tfvars():
    """The push target already in terraform.tfvars, so it stays off the CLI."""
    with open(TFVARS, encoding="utf-8") as fh:
        m = re.search(r'kmart_watch_push_target\s*=\s*"([^"]+)"', fh.read())
    if not m:
        raise SystemExit("no kmart_watch_push_target in {}".format(TFVARS))
    return m.group(1)


def find(query, sources):
    """
    First live row whose title contains every word of `query`. Accent-stripped
    and case-insensitive, the same way the alert pattern is matched, so
    "pokemon" finds "Pokémon".
    """
    import index

    words = [w for w in index.plain(query).lower().split() if w]
    for template in sources:
        spec = template.format(query) if "{}" in template else template
        kind, target = index.parse_source(spec)
        print("  looking in {} ...".format(spec))
        try:
            items = index.read_source(kind, target)
        except Exception as exc:  # noqa: BLE001 -- this is a hand-run probe
            print("    {} failed: {}".format(spec, exc))
            continue
        for item in items:
            name = index.plain(item["name"]).lower()
            if all(w in name for w in words):
                item["retailer"] = index.retailer(item)
                return item, spec
    return None, None


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit(2)

    target = sys.argv[1]
    if target == "tfvars":
        target = target_from_tfvars()
    args = sys.argv[2:]
    kmart = "--kmart" in args
    query = " ".join(a for a in args if not a.startswith("--"))

    if query:
        sources = KMART_SOURCES if kmart else TARGET_SOURCES
        print('finding "{}" on the live feed:'.format(query))
        item, spec = find(query, sources)
        if item is None:
            raise SystemExit('could not find "{}" -- try fewer words'.format(query))
        print("  found in {}: {}".format(spec, item["name"]))
        print("    price      : {}".format(item.get("price")))
        print("    online qty : {}".format(item.get("online_qty")))
        print("    url        : {}".format(item["url"]))
    else:
        item = SAMPLE
        print("sending the built-in fake sample (pass a product name for a real one)")

    print("\nsending one push to {} ...".format(target.split(":")[0]))
    n = push.push([item], target=target)
    if n:
        print("sent. Check your phone -- tapping it should open:")
        print("  " + item["url"])
    else:
        print("nothing sent -- see the warning above for why.")


if __name__ == "__main__":
    main()
