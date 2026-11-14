"""
Offline tests for push.py -- no network. Captures what WOULD be POSTed.

    python push_test.py

To send yourself a real one, see test_push.py.
"""

import os
import urllib.parse

os.environ.setdefault("TABLE_NAME", "test")
os.environ.setdefault("TOPIC_ARN", "test")

import push  # noqa: E402

ITEM = {
    "id": "P_43848652",
    "name": "Pokemon TCG: Mini Portfolio",
    "url": "https://www.kmart.com.au/product/pokemon-tcg:-mini-portfolio-43848652/",
    "price": 11,
    "preorder": True,
}
LISTED = dict(ITEM, id="P_2", name="Rayman: 30th Anniversary Edition", preorder=False, price=59.95)

sent = []


def fake_post(url, data, headers=None):
    sent.append({"url": url, "data": data.decode("utf-8"), "headers": headers or {}})
    return 200


push._post = fake_post


def check(label, got, want):
    assert got == want, "{}: got {!r}, want {!r}".format(label, got, want)
    print("ok  ", label)


def test_off_by_default():
    sent.clear()
    check("no target sends nothing", push.push([ITEM], target=""), 0)
    check("no items sends nothing", push.push([], target="ntfy:x"), 0)
    check("nothing posted", len(sent), 0)


def test_ntfy():
    sent.clear()
    check("sent", push.push([ITEM], target="ntfy:my-secret-topic"), 1)
    p = sent[0]
    check("url", p["url"], "https://ntfy.sh/my-secret-topic")
    check("click is the product", p["headers"]["Click"], ITEM["url"])
    check("urgent when preorder", p["headers"]["Priority"], "urgent")
    assert p["headers"]["Title"].startswith("Kmart PRE-ORDER: "), p["headers"]["Title"]
    print("ok   title")


def test_header_transliteration():
    """
    Real titles from both retailers, 1 Oct 2026. Deleting non-ASCII instead of
    transliterating it welded "Evolution" onto "Perfect" and turned "Pokemon"
    into "Pokmon", which is what this guards.
    """
    check(
        "em dash becomes a hyphen, not nothing",
        push._header(u"Pokemon TCG: Mega Evolution\u2014Perfect Order Blister"),
        "Pokemon TCG: Mega Evolution-Perfect Order Blister",
    )
    check("accent survives as its letter", push._header(u"Pok\u00e9mon Plush"), "Pokemon Plush")
    check("en dash", push._header(u"a \u2013 b"), "a - b")
    check("curly apostrophe", push._header(u"Trainer\u2019s Box"), "Trainer's Box")
    check("nbsp", push._header(u"30th\u00a0Anniversary"), "30th Anniversary")
    check("emoji still dropped", push._header(u"Sale \U0001F525 now"), "Sale  now")
    # The whole point is that it stays encodable -- a header that is not ASCII
    # makes urllib raise and costs you the push.
    push._header(u"Pok\u00e9mon\u2014Mega \U0001F525").encode("ascii")
    print("ok   header stays ascii-encodable")


def test_ntfy_target():
    """
    A Target row: retailer in the title, and the 0-stock warning in the body.
    That warning is the difference between "go buy it" and "watch this one",
    and the notification is the only place it is read in time.
    """
    sent.clear()
    tin = {
        "id": "target:P72301449",
        "name": "Pokemon TCG: 30th Anniversary Mini Tin",
        "url": "https://www.target.com.au/p/pokemon-tcg-30th-anniversary-mini-tin/72301449",
        "price": 20,
        "preorder": False,
        "retailer": "Target",
        "online_qty": 0,
    }
    check("sent", push.push([tin], target="ntfy:t"), 1)
    p = sent[0]
    check("title names Target", p["headers"]["Title"], "Target: " + tin["name"])
    assert "NOT yet buyable online" in p["data"], p["data"]
    print("ok   0-stock warning in body")
    check("no preorder flag means high, not urgent", p["headers"]["Priority"], "high")

    sent.clear()
    push.push([dict(tin, online_qty=37)], target="ntfy:t")
    assert "37 online" in sent[0]["data"], sent[0]["data"]
    print("ok   stock count in body")


def test_ntfy_action_button():
    """
    The action button carries the same deep link as the body tap, labelled per
    retailer. ntfy parses this header on commas, so the shape matters.
    """
    sent.clear()
    tin = dict(ITEM, retailer="Target",
               url="https://www.target.com.au/p/pokemon-tin/72301449")
    push.push([tin], target="ntfy:t")
    actions = sent[0]["headers"]["Actions"]
    check("one view action", actions.count("view,"), 1)
    assert actions.startswith('view, "Open in Target app", '), actions
    assert tin["url"] in actions, actions
    assert actions.endswith("clear=true"), actions
    print("ok   action button shape")
    # Same URL both ways, so whichever the thumb lands on behaves identically.
    check("action url matches click", sent[0]["headers"]["Click"], tin["url"])
    # Headers must stay ASCII or urllib raises and the push is lost.
    sent[0]["headers"]["Actions"].encode("ascii")
    print("ok   actions header is ascii")


def test_ntfy_self_hosted():
    sent.clear()
    push.push([ITEM], target="ntfy:https://push.example.com/topic9")
    check("custom host", sent[0]["url"], "https://push.example.com/topic9")


def test_ntfy_header_is_ascii():
    sent.clear()
    push.push([dict(ITEM, name="Pokemon 30th — Pastel Plush ❤")], target="ntfy:t")
    title = sent[0]["headers"]["Title"]
    title.encode("latin-1")  # raises if a stray em dash survived
    print("ok   title stays header-safe:", repr(title))


def test_pushover():
    sent.clear()
    check("sent", push.push([LISTED], target="pushover:USERKEY:APPTOKEN"), 1)
    body = dict(urllib.parse.parse_qsl(sent[0]["data"]))
    check("token", body["token"], "APPTOKEN")
    check("user", body["user"], "USERKEY")
    check("url", body["url"], LISTED["url"])
    check("normal priority when only listed", body["priority"], "0")


def test_telegram():
    sent.clear()
    check("sent", push.push([ITEM], target="telegram:123456:ABC-DEF:987654"), 1)
    check("url", sent[0]["url"], "https://api.telegram.org/bot123456:ABC-DEF/sendMessage")
    assert ITEM["url"] in sent[0]["data"], sent[0]["data"]
    print("ok   link in body")


def test_cap():
    sent.clear()
    items = [dict(ITEM, id="P_{}".format(n)) for n in range(20)]
    check("capped at PUSH_MAX", push.push(items, target="ntfy:t"), push.PUSH_MAX)


def test_failure_is_swallowed():
    sent.clear()

    def boom(*a, **k):
        raise TimeoutError("service down")

    push._post, real = boom, push._post
    try:
        check("returns 0, does not raise", push.push([ITEM], target="ntfy:t"), 0)
    finally:
        push._post = real


def test_unknown_kind():
    check("unknown kind is a no-op", push.push([ITEM], target="carrier-pigeon:bob"), 0)


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
    print("\nall passed")
