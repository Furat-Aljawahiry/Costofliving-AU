"""
Send yourself ONE real push, to prove the channel works before you deploy.
No AWS, no writes, nothing touched but your phone.

    python test_push.py ntfy:some-long-random-topic
    python test_push.py pushover:<user_key>:<app_token>
    python test_push.py telegram:<bot_token>:<chat_id>

It sends a fake pre-order hit with a real Kmart link, so you can check the
notification is tappable and lands where you expect.
"""

import os
import sys

os.environ.setdefault("TABLE_NAME", "dry-run")
os.environ.setdefault("TOPIC_ARN", "dry-run")

import push  # noqa: E402

SAMPLE = {
    "id": "TEST",
    "name": "TEST — Pokemon 30th Anniversary Plush",
    "url": "https://www.kmart.com.au/category/toys/pre-order/",
    "price": 19,
    "preorder": True,
}


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit(2)
    target = sys.argv[1]
    print("sending one test push to", target.split(":")[0], "...")
    n = push.push([SAMPLE], target=target)
    if n:
        print("sent. Check your phone — tapping it should open the pre-order category.")
        print("\nIf that worked, put it in infra/terraform/terraform.tfvars:")
        print('  kmart_watch_push_target = "{}"'.format(target))
    else:
        print("nothing sent — see the warning above for why.")


if __name__ == "__main__":
    main()
