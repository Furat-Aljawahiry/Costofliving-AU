"""Coles adapter: how to ask coles.com.au for a browse category, and how to
turn one of its product objects into a spec row.

Everything shared with the other retailers — COLUMNS, the CSV writer, size and
unit-price parsing — lives in crawler.py. This module only knows Coles.

Surface: Coles' storefront is a Next.js app that renders browse pages on the
server, so the same payload the page is built from is available on its own from
Next's data route (COLES_DISCOVERY.md section 2):

    GET /_next/data/<buildId>/en/browse/<a>/<b>.json?slug=<a>&slug=<b>&page=<n>

44.9 KB per page of 48 products, against 657 KB for the HTML carrying the same
data. Two things about this surface drive the code below:

  - **The buildId is a moving part.** It changes on every Coles deploy and a
    stale one returns 404. The only place to read it is an HTML page — which is
    also the surface the edge blocks first — so it is fetched once per run,
    cached in `state`, refreshed at most once on a 404, and overridable via
    COLES_BUILD_ID when HTML is unavailable but the data route still answers.
  - **A block arrives as HTTP 200.** Imperva serves an interstitial with a
    success status (COLES_DISCOVERY.md section 5.3), so every response is
    asserted on content, never on status. That assertion is the difference
    between a loud failure and a confidently empty CSV.
"""

from __future__ import annotations

import os
import re
import urllib.parse

from crawler import (
    SCHEMA_VERSION,
    UA,
    BlockedError,
    canonical_key,
    classify,
    cup_to_canonical,
    derive_unit_prices,
    fetch,
    json_parser,
    parse_cup_string,
    parse_package_size,
    sold_by_of,
)

RETAILER = "coles"
DATASET = "coles.products"
PAGE_SIZE = 48  # fixed by the site; ?pageSize=100 is ignored, measured
# The buildId is elided on purpose: it changes on every Coles deploy, and a
# column that churns daily is no use for auditing which capture path a row came
# from. The buildId actually used is recorded in the manifest instead.
SOURCE_ENDPOINT = "/_next/data/{buildId}/en/browse/{slug}.json"

ORIGIN = "https://www.coles.com.au"

DEFAULTS = {
    "category": "fruit-vegetables",
    "url": "/browse/fruit-vegetables",
    "name": "Fruit & Vegetables",
}

# Fallback only. Every response carries its own assetsUrl, which wins.
ASSETS_URL = "https://cdn.productimages.coles.com.au/productimages"

_BUILD_ID_RE = re.compile(r'"buildId"\s*:\s*"([^"]+)"')

# Full navigational headers. Measured: the same /product/ request that was
# served an interstitial with a bare User-Agent came back real with these.
_HTML_HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-AU,en;q=0.9",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    "sec-ch-ua": '"Chromium";v="126", "Not:A-Brand";v="24"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
}


# ---------------------------------------------------------------- fetch


def _segments(target: dict) -> list:
    """['fruit-vegetables', 'vegetables', 'potatoes'] from the browse path."""
    raw = (target.get("url") or "").strip("/")
    parts = [p for p in raw.split("/") if p]
    if parts and parts[0] == "browse":
        parts = parts[1:]
    if not parts:
        parts = [p for p in str(target.get("category") or "").split("/") if p]
    if not parts:
        raise ValueError("coles target needs a /browse/... url or a slug path")
    return parts


def _browse_url(target: dict) -> str:
    return f"{ORIGIN}/browse/" + "/".join(_segments(target))


def _find_build_id(body: str) -> str:
    m = _BUILD_ID_RE.search(body or "")
    if not m:
        # The interstitial is a ~6 KB page with no __NEXT_DATA__ at all. Saying
        # so by name beats "regex did not match" in a 3am CloudWatch log.
        hint = "interstitial" if "Pardon Our Interruption" in (body or "") else "no buildId in page"
        raise BlockedError(f"buildId lookup blocked ({hint})")
    return m.group(1)


def start(target: dict, session=None, log=lambda m: None) -> dict:
    """Warm-up: resolve the buildId the data route needs.

    COLES_BUILD_ID skips the HTML request entirely. That is the escape hatch for
    the case measured in COLES_DISCOVERY.md section 5.3 — HTML interstitialed
    while the data route kept answering — and it is why a blocked warm-up must
    not be worked around silently.
    """
    pinned = (os.environ.get("COLES_BUILD_ID") or "").strip()
    if pinned:
        log(f"buildId {pinned} (pinned via COLES_BUILD_ID)")
        return {"build_id": pinned, "pinned": True, "store_id": "", "assets_url": ASSETS_URL}

    body = fetch(_browse_url(target), _HTML_HEADERS, session=session, label="buildId lookup")
    build_id = _find_build_id(body)
    log(f"buildId {build_id}")
    return {"build_id": build_id, "pinned": False, "store_id": "", "assets_url": ASSETS_URL}


def capture_extras(state: dict) -> dict:
    # Which build served the run, and which store's prices we were shown. Both
    # belong with the capture, not on every row: a reader comparing two days of
    # history needs to know whether the store changed underneath them.
    return {
        "build_id": (state or {}).get("build_id", ""),
        "build_id_pinned": bool((state or {}).get("pinned")),
        "store_id": (state or {}).get("store_id", ""),
    }


def _page_url(target: dict, page_number: int, build_id: str) -> str:
    segs = _segments(target)
    qs = [("slug", s) for s in segs]
    if page_number > 1:
        qs.append(("page", str(page_number)))
    path = "/".join(segs)
    return f"{ORIGIN}/_next/data/{build_id}/en/browse/{path}.json?" + urllib.parse.urlencode(qs)


def _results_of(payload: dict):
    return ((payload.get("pageProps") or {}).get("searchResults") or {}).get("results")


def fetch_page(target: dict, page_number: int, session=None, state=None) -> dict:
    state = state if state is not None else {}
    headers = {
        "User-Agent": UA,
        "Accept": "*/*",
        "Accept-Language": "en-AU,en;q=0.9",
        "x-nextjs-data": "1",
        "Referer": _browse_url(target),
    }

    def get(build_id):
        return fetch(
            _page_url(target, page_number, build_id), headers, session=session,
            label=f"page {page_number}",
            # The content assertion, not the status code, is what proves this is
            # a real response. See the module docstring.
            parse=json_parser(lambda d: isinstance(_results_of(d), list)),
        )

    try:
        payload = get(state["build_id"])
    except RuntimeError as e:
        # 404 is what a stale buildId looks like. Re-resolve it once — a Coles
        # deploy mid-crawl is ordinary — but only once, so a genuinely missing
        # category cannot become a retry loop against the blocked HTML surface.
        if "HTTP 404" not in str(e) or state.get("build_id_refreshed") or state.get("pinned"):
            raise
        state["build_id_refreshed"] = True
        state["build_id"] = _find_build_id(
            fetch(_browse_url(target), _HTML_HEADERS, session=session, label="buildId refresh")
        )
        payload = get(state["build_id"])

    pp = payload.get("pageProps") or {}
    state["assets_url"] = pp.get("assetsUrl") or state.get("assets_url") or ASSETS_URL
    # An anonymous request is served a default store, not a chosen one
    # (COLES_DISCOVERY.md section 5.5). Record which one rather than assuming.
    store_id = ((pp.get("initialState") or {}).get("trolley") or {}).get("storeId")
    if store_id:
        state["store_id"] = str(store_id)
    return payload


def page_products(payload: dict, state=None) -> list:
    # Filter on _type, not on list length: a non-PRODUCT tile rides along on
    # some pages (measured: 49 tiles on one page of 48 products).
    return [p for p in (_results_of(payload) or []) if p and p.get("_type") == "PRODUCT"]


def total_count(payload: dict):
    return ((payload.get("pageProps") or {}).get("searchResults") or {}).get("noOfResults")


def sku_of(p: dict):
    return str(p["id"]) if p.get("id") is not None else None


def is_sponsored(p: dict) -> bool:
    return bool(p.get("adId")) or p.get("featured") is True


def is_skipped(p: dict) -> bool:
    # Coles has no third-party marketplace tier — the one Woolworths problem
    # this retailer does not have.
    return False


# ---------------------------------------------------------------- row build


def _slugify(*parts) -> str:
    return re.sub(r"[^a-z0-9]+", "-", " ".join(str(p or "") for p in parts).lower()).strip("-")


def build_row(p: dict, ctx: dict, state=None) -> dict:
    state = state or {}
    warns = []

    pricing = p.get("pricing") or {}
    unit = pricing.get("unit") or {}

    pack = parse_package_size(p.get("size"), None)
    if pack["warn"]:
        warns.append(pack["warn"])

    # cup_measure is passed as None deliberately: `unit.ofMeasureUnits` says
    # "g" on a product whose own comparable string says "$3.50/ 1kg" (measured).
    # The string is the one the shopper sees and the one that is right.
    cup = parse_cup_string(pricing.get("comparable"), unit.get("price"), None)
    canon = cup_to_canonical(cup["value"], cup["measure"])
    # Spec 6.6's CUP_PRICE_UNPARSED, same as the Woolworths adapter: a
    # comparable string we could not read means we lost the retailer's own unit
    # price silently. A product with no comparable at all is not a parse failure.
    if pricing.get("comparable") and (cup["value"] is None or not cup["measure"]):
        warns.append("CUP_PRICE_UNPARSED")

    # Availability first — it decides whether price 0 is a real price or a marker.
    available = p.get("availability") is True
    qty = p.get("availableQuantity")
    in_stock = available
    purchasable = available and (qty is None or qty > 0)

    # Spec 6.4: price 0 means unavailable, never a real $0.00.
    now = pricing.get("now")
    price = None if now is None else float(now)
    if price == 0:
        price = None
        if purchasable:
            warns.append("PRICE_NULL_BUT_PURCHASABLE")
    if price is None and not pricing:
        warns.append("PRICE_MISSING")
    if price is not None and price < 0.1:
        warns.append("PRICE_OUT_OF_BOUNDS")
        price = None

    unit_prices, unit_warns = derive_unit_prices(price, pack, cup, canon)
    warns.extend(unit_warns)

    mh = p.get("merchandiseHeir") or {}
    oh = (p.get("onlineHeirs") or [{}])[0] or {}

    # Grain, not field name (COLES_DISCOVERY.md section 4.1). Coles has five
    # merchandise levels to Woolworths' four; `subCategory` is the level that
    # lines up with Woolworths' sap_subcategory (SWEET POTATOES / SWEET POTATO),
    # and it is what cheapest.py groups on. The orphaned middle level
    # (POTATOES) goes to sap_family rather than shifting everything down one.
    dept = mh.get("tradeProfitCentre") or ""
    cat = mh.get("categoryGroup") or ""
    family = mh.get("category") or ""
    sub = mh.get("subCategory") or ""
    seg = mh.get("className") or ""

    flags = classify(p.get("name"), p.get("brand"), dept, cat, family, sub, seg,
                     oh.get("aisle"), oh.get("category"))

    # No barcode anywhere in this payload, and the detail page's gtin was null
    # on every product sampled (COLES_DISCOVERY.md section 5.1). The warning is
    # not noise — it is the flag that says "this row cannot join on GTIN".
    warns.append("MISSING_GTIN")
    if not p.get("brand"):
        warns.append("MISSING_BRAND")
    if not dept and not cat:
        warns.append("TAXONOMY_INCOMPLETE")

    sku = str(p.get("id"))
    raw_name = str(p.get("name") or "")
    name = re.sub(r"\s+", " ", raw_name).strip()
    if name != raw_name:
        warns.append("NAME_WHITESPACE_ANOMALY")
    size = str(p.get("size") or "").strip()

    # `was` is 0 on every row measured — Coles does not publish a previous price
    # on this surface, so was_price_aud is genuinely unknown rather than equal.
    was = pricing.get("was")
    was_price = float(was) if was and float(was) > 0 and float(was) != price else None
    savings = round(was_price - price, 2) if (was_price is not None and price is not None) else None

    promo_type = pricing.get("promotionType") or ""
    special_type = pricing.get("specialType") or ""
    promo_text = pricing.get("offerDescription") or promo_type

    # Coles' promotions on this surface are overwhelmingly multibuys ("Buy 2 for
    # $4.80"), where `now` is the ordinary single-unit price and nothing is
    # marked down. is_on_special stays true — there IS a promotion — but the
    # warning tells a consumer not to read the unit price as a discounted one,
    # and multiBuyPromotion.unitPriceDisplay is deliberately NOT used for
    # price_per_*: that would report a price nobody pays for one unit.
    if special_type.upper() == "MULTI_SAVE":
        warns.append("PROMO_MULTIBUY")

    # `or {}` on the element for the same reason onlineHeirs has it above: a
    # null entry in the list is a payload shape we do not control, and an
    # AttributeError here would kill the whole page, not just this tile.
    image = ((p.get("imageUris") or [{}])[0] or {}).get("uri") or ""
    # The payload's own assetsUrl wins, but it is a base we did not write, so
    # join it rather than concatenating: one stray slash on either side would
    # otherwise emit "…/productimages//4/x.jpg" on every row of the run.
    assets = (state.get("assets_url") or ASSETS_URL).rstrip("/")

    return {
        # Block A — spine
        "schema_version": SCHEMA_VERSION,
        "dataset": DATASET,
        "run_id": ctx["run_id"],
        "retailer": RETAILER,
        "captured_at_utc": ctx["captured_at"],
        "source_endpoint": SOURCE_ENDPOINT,
        "confidence": "measured",
        # Block B — capture context
        "postcode": ctx["postcode"],
        "fulfilment_store_id": state.get("store_id", ""),
        "price_basis": "online",
        # Block C.1 — identity
        "retailer_sku": sku,
        "gtin": "",
        "product_url": f"{ORIGIN}/product/{_slugify(name, size)}-{sku}",
        "record_id": f"{RETAILER}:{sku}:online",
        # Block C.2 — description & classification
        "product_name": name,
        # Coles has no separate display name; name alone is ambiguous between
        # pack sizes of the same line, which is exactly what DisplayName solves
        # at Woolworths.
        "display_name": f"{name} {size}".strip(),
        "brand": p.get("brand") or "",
        "variety": "",
        # Coles' online hierarchy is named the other way up: `subCategory` here
        # is "Fruit & Vegetables", the TOP level. Mapped by depth, not by name.
        "dept_node_id": str(oh.get("subCategoryId") or ""), "dept_name": oh.get("subCategory") or "",
        "category_node_id": str(oh.get("categoryId") or ""), "category_name": oh.get("category") or "",
        "subcategory_node_id": str(oh.get("aisleId") or ""), "subcategory_name": oh.get("aisle") or "",
        "sap_department": dept, "sap_category": cat,
        "sap_subcategory": sub, "sap_segment": seg,
        "sap_family": family,
        "is_organic": flags["is_organic"],
        "is_prepared": flags["is_prepared"],
        # Both are detail-page-only or absent on this surface (section 5.1).
        "country_of_origin": "",
        "health_star_rating": "",
        "image_url": f"{assets}/{image.lstrip('/')}" if image else "",
        # Block C.3 — size & quantity
        "package_size_raw": size,
        "pack_qty": pack["qty"],
        "pack_uom": pack["uom"] or "",
        "units_per_pack": pack["units_per_pack"],
        "net_size_value": pack["net_value"],
        "net_size_uom": pack["net_uom"] or "",
        "purchase_increment": pack["increment"],
        "sold_by": "weight" if unit.get("isWeighted") is True else sold_by_of(pack),
        "is_variable_weight": unit.get("isWeighted") is True or bool(re.search(r"approx", size, re.I)),
        # Block C.4 — price
        "price_aud": price,
        "was_price_aud": was_price,
        "savings_aud": savings,
        "is_on_special": bool(promo_type) or pricing.get("onlineSpecial") is True,
        "promo_text": re.sub(r"\s+", " ", str(promo_text)).strip(),
        "unit_price_raw": pricing.get("comparable") or "",
        "unit_price_value": cup["value"],
        "unit_price_measure": cup["measure"] or "",
        "price_per_kg_aud": unit_prices["per_kg"],
        "price_per_l_aud": unit_prices["per_l"],
        "price_per_each_aud": unit_prices["per_each"],
        "price_currency": "AUD",
        # Block C.5 — availability
        "is_available": available,
        "is_in_stock": in_stock,
        "is_purchasable": purchasable,
        "availability_status": "InStock" if in_stock else "OutOfStock",
        "is_age_restricted": bool(
            (p.get("restrictions") or {}).get("liquorAgeRestrictionFlag")
            or (p.get("restrictions") or {}).get("tobaccoAgeRestrictionFlag")
        ),
        # Provenance of the tile itself
        "is_sponsored": is_sponsored(p),
        "is_market_product": False,
        "source_category_id": ctx["category_id"],
        "source_category_name": ctx["category_name"],
        # Block C.6 — lineage & quality
        # Same hash function and same inputs as Woolworths — this is the only
        # thing left that can group the two retailers' rows, now that GTIN is
        # gone, so the formula must stay identical on both sides.
        "canonical_product_key": canonical_key(
            p.get("name"), p.get("brand"), "", pack["net_uom"], flags
        ),
        "basket_item_id": "",  # ALWAYS empty — L2 owns this (spec section 2)
        "parse_warnings": "|".join(dict.fromkeys(warns)),
    }
