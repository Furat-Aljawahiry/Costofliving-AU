"""Woolworths adapter: how to ask woolworths.com.au for a browse category, and
how to turn one of its product objects into a spec row.

Everything shared with the other retailers — COLUMNS, the CSV writer, size and
unit-price parsing — lives in crawler.py. This module only knows Woolworths.

Surface: GET /apis/ui/browse/category, verified in LAMBDA_OUTPUT_SPEC.md
section 10.1a. `url` and `formatObject` are required query params; omitting
them returns 400 "Url is required.". The POST form of the same endpoint is
reset at TLS — only the GET form works.
"""

from __future__ import annotations

import json
import re
import urllib.parse

from crawler import (
    SCHEMA_VERSION,
    UA,
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

RETAILER = "woolworths"
DATASET = "woolworths.products"
PAGE_SIZE = 36  # hard cap: the API 400s above this
SOURCE_ENDPOINT = "/apis/ui/browse/category"

DEFAULTS = {
    "category": "1-E5BEE36E",
    "url": "/shop/browse/fruit-veg",
    "name": "Fruit & Veg",
}


# ---------------------------------------------------------------- fetch


def start(target, session, log) -> dict:
    """No warm-up needed: the endpoint is unauthenticated and stateless."""
    return {}


def capture_extras(state) -> dict:
    return {}


def fetch_page(target: dict, page_number: int, session=None, state=None) -> dict:
    qs = urllib.parse.urlencode(
        {
            "categoryId": target["category"],
            "pageNumber": str(page_number),
            "pageSize": str(PAGE_SIZE),
            "sortType": "TraderRelevance",
            "url": target["url"],
            "location": target["url"],
            "formatObject": json.dumps({"name": target["name"]}, separators=(",", ":")),
            "isSpecial": "false",
            "isBundle": "false",
            "isMobile": "false",
            "token": "",
            "gpBoost": "0",
            "isHideUnavailableProducts": "false",
            "enableAdReRanking": "false",
            "groupEdmVariants": "true",
            "categoryVersion": "v2",
        }
    )
    endpoint = "https://www.woolworths.com.au/apis/ui/browse/category?" + qs
    headers = {
        "User-Agent": UA,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-AU,en;q=0.9",
        "Referer": "https://www.woolworths.com.au" + target["url"],
    }
    return fetch(
        endpoint, headers, session=session, label=f"page {page_number}",
        parse=json_parser(lambda d: isinstance(d.get("Bundles"), list)),
    )


def page_products(payload: dict, state=None) -> list:
    return [p for b in (payload.get("Bundles") or []) for p in (b.get("Products") or []) if p]


def total_count(payload: dict):
    return payload.get("TotalRecordCount")


def sku_of(p: dict):
    return str(p["Stockcode"]) if p.get("Stockcode") else None


def is_sponsored(p: dict) -> bool:
    return p.get("IsSponsoredAd") is True


def is_skipped(p: dict) -> bool:
    # "Everyday Market" third-party listings are not groceries (spec 10.1).
    return p.get("IsMarketProduct") is True


# ---------------------------------------------------------------- row build


def _attr(p: dict, k: str):
    v = (p.get("AdditionalAttributes") or {}).get(k)
    return None if v is None or v == "" else str(v)


def build_row(p: dict, ctx: dict, state=None) -> dict:
    warns = []

    pack = parse_package_size(p.get("PackageSize"), p.get("Unit"))
    if pack["warn"]:
        warns.append(pack["warn"])

    cup = parse_cup_string(p.get("CupString"), p.get("CupPrice"), p.get("CupMeasure"))
    canon = cup_to_canonical(cup["value"], cup["measure"])
    # Spec 6.6 defines CUP_PRICE_UNPARSED and nothing was emitting it. A cup
    # string we could not read is the parser silently losing the retailer's own
    # unit price; the point of this column is to find that out before a chart
    # does. No cup string at all is not a failure — 33 of 472 rows have none.
    if p.get("CupString") and (cup["value"] is None or not cup["measure"]):
        warns.append("CUP_PRICE_UNPARSED")

    # Availability first — it decides whether price 0 is a real price or a marker.
    in_stock = p.get("IsInStock") is True
    purchasable = p.get("IsPurchasable") is True

    # Spec 6.4 / 10.1: price 0 means out-of-stock, never a real $0.00.
    price = None if p.get("Price") is None else float(p["Price"])
    if price == 0:
        price = None
        if purchasable:
            warns.append("PRICE_NULL_BUT_PURCHASABLE")
    if price is not None and price < 0.1:
        warns.append("PRICE_OUT_OF_BOUNDS")
        price = None

    unit, unit_warns = derive_unit_prices(price, pack, cup, canon)
    warns.extend(unit_warns)

    dept = _attr(p, "sapdepartmentname")
    cat = _attr(p, "sapcategoryname")
    sub = _attr(p, "sapsubcategoryname")
    seg = _attr(p, "sapsegmentname")
    flags = classify(p.get("Name"), p.get("DisplayName"), dept, cat, sub, seg)

    if not p.get("Barcode"):
        warns.append("MISSING_GTIN")
    if not p.get("Brand"):
        warns.append("MISSING_BRAND")
    if not dept and not cat:
        warns.append("TAXONOMY_INCOMPLETE")

    sku = str(p.get("Stockcode"))
    raw_name = str(p.get("Name") or "")
    name = re.sub(r"\s+", " ", raw_name).strip()
    if name != raw_name:
        warns.append("NAME_WHITESPACE_ANOMALY")

    # Woolworths sends WasPrice == Price when nothing is marked down, so the
    # "differs from Price" test is what separates a real pre-promotion price
    # from an echo. That test is meaningless once Price has been nulled: an
    # out-of-stock line (Price 0) sent WasPrice 5.00, and `5.00 != None` is
    # trivially true, which published a was_price on 33 of 472 measured rows
    # that were not on special and had no current price to be reduced from.
    # `> 0` for the same reason Coles has it: a 0 here is "unknown", not $0.00.
    was = p.get("WasPrice")
    was_price = (
        float(was)
        if price is not None and was is not None and float(was) > 0 and float(was) != price
        else None
    )
    promo = (p.get("CentreTag") or {}).get("TagContent") or (p.get("HeaderTag") or {}).get("TagContent") or ""

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
        "fulfilment_store_id": "" if p.get("FulfilmentStoreId") is None else str(p["FulfilmentStoreId"]),
        "price_basis": "online",
        # Block C.1 — identity
        "retailer_sku": sku,
        "gtin": str(p["Barcode"]) if p.get("Barcode") else "",
        "product_url": f"https://www.woolworths.com.au/shop/productdetails/{sku}/{p.get('UrlFriendlyName') or ''}",
        "record_id": f"{RETAILER}:{sku}:online",
        # Block C.2 — description & classification
        "product_name": name,
        "display_name": p.get("DisplayName") or "",
        "brand": p.get("Brand") or "",
        "variety": p.get("Variety") or "",
        "dept_node_id": "", "dept_name": dept or "",
        "category_node_id": "", "category_name": cat or "",
        "subcategory_node_id": "", "subcategory_name": sub or "",
        "sap_department": dept or "", "sap_category": cat or "",
        "sap_subcategory": sub or "", "sap_segment": seg or "",
        # Woolworths' hierarchy has no level between category and subcategory.
        "sap_family": "",
        "is_organic": flags["is_organic"],
        "is_prepared": flags["is_prepared"],
        "country_of_origin": _attr(p, "countryoforigin") or "",
        "health_star_rating": _attr(p, "healthstarrating") or "",
        "image_url": p.get("LargeImageFile") or p.get("MediumImageFile") or "",
        # Block C.3 — size & quantity
        "package_size_raw": p.get("PackageSize") or "",
        "pack_qty": pack["qty"],
        "pack_uom": pack["uom"] or "",
        "units_per_pack": pack["units_per_pack"],
        "net_size_value": pack["net_value"],
        "net_size_uom": pack["net_uom"] or "",
        "purchase_increment": pack["increment"],
        "sold_by": sold_by_of(pack),
        "is_variable_weight": bool(re.search(r"approx", p.get("PackageSize") or "", re.I)),
        # Block C.4 — price
        "price_aud": price,
        "was_price_aud": was_price,
        "savings_aud": float(p["SavingsAmount"]) if p.get("SavingsAmount") else None,
        "is_on_special": p.get("IsOnSpecial") is True,
        "promo_text": re.sub(r"\s+", " ", promo).strip(),
        "unit_price_raw": p.get("CupString") or "",
        "unit_price_value": cup["value"],
        "unit_price_measure": cup["measure"] or "",
        "price_per_kg_aud": unit["per_kg"],
        "price_per_l_aud": unit["per_l"],
        "price_per_each_aud": unit["per_each"],
        "price_currency": "AUD",
        # Block C.5 — availability
        "is_available": p.get("IsAvailable") is True,
        "is_in_stock": in_stock,
        "is_purchasable": purchasable,
        "availability_status": "InStock" if in_stock else "OutOfStock",
        "is_age_restricted": p.get("AgeRestricted") is True,
        # Provenance of the tile itself
        "is_sponsored": p.get("IsSponsoredAd") is True,
        "is_market_product": p.get("IsMarketProduct") is True,
        "source_category_id": ctx["category_id"],
        "source_category_name": ctx["category_name"],
        # Block C.6 — lineage & quality
        "canonical_product_key": canonical_key(
            p.get("Name"), p.get("Brand"), p.get("Variety"), pack["net_uom"], flags
        ),
        "basket_item_id": "",  # ALWAYS empty — L2 owns this (spec section 2)
        "parse_warnings": "|".join(dict.fromkeys(warns)),
    }
