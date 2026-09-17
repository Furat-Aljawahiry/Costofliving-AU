"""Shared crawl + parse logic for retailer browse categories.

Retailer-agnostic. Everything specific to one retailer — how a page is
requested, and how one of its product objects becomes a row — lives in an
adapter module (`woolworths.py`, `coles.py`) that this module drives.

That split is the whole point: `COLUMNS`, `to_csv()` and the size/unit parsing
are defined ONCE here, so the Woolworths CSV and the Coles CSV cannot drift
apart in shape. Two retailers, two files, one schema.

Imported by BOTH the Lambda handler (index.py) and the local CLIs
(data/scripts/crawl_*_category.py) so deployed and local output can never
diverge.

Output conforms to data/LAMBDA_OUTPUT_SPEC.md schema 1.1.
Standard library only.

--------------------------------------------------------------------------
The adapter contract (see woolworths.py / coles.py for the two live examples)

    RETAILER          str   slug matching STORES[].id in basket.js
    DATASET           str   "<retailer>.products"
    PAGE_SIZE         int   products per request, as the site caps it
    SOURCE_ENDPOINT   str   goes in the source_endpoint column, verbatim
    DEFAULTS          dict  {category, url, name} for the default target

    start(target, session, log)        -> state   per-run warm-up (may be {})
    fetch_page(target, n, session, st) -> payload raises on failure
    page_products(payload, state)      -> [raw product dicts]
    total_count(payload)               -> int | None
    sku_of(p)                          -> str | None
    is_sponsored(p)                    -> bool
    is_skipped(p)                      -> bool    marketplace/third-party tiles
    build_row(p, ctx, state)           -> dict    keys are exactly COLUMNS
    capture_extras(state)              -> dict    merged into capture_context
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import time
from datetime import datetime, timezone

from proxy import ProxyError, create_session, http_get_text, probe_exit_ip

SCHEMA_VERSION = "1.1"
MAX_RETRIES = 3

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

# Statuses that mean "this exit IP is unwelcome" rather than "the request was
# wrong". Worth burning the residential session over; a 400 is not.
_BLOCKED = {403, 407, 429}


def _is_blocked(status: int) -> bool:
    return status in _BLOCKED or status >= 500


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def new_run_id() -> str:
    import secrets as _secrets

    return datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S") + "-" + _secrets.token_hex(4)


# ---------------------------------------------------------------- fetch


class BlockedError(Exception):
    """The response came back but is not the resource we asked for.

    Coles' Imperva edge answers a block with HTTP 200 and an interstitial page
    (COLES_DISCOVERY.md section 5.3), so a status check alone would let a
    crawler parse garbage and write a confidently empty file. Adapters raise
    this from their own content assertions, and it is treated exactly like a
    403: rotate the exit IP, back off, and fail the run loudly if it persists.
    """


def fetch(url: str, headers: dict, session=None, label: str = "request", parse=None):
    """GET with retry/backoff and exit-IP rotation. Returns parse(body), or raises.

    Shared by every adapter so the block-handling policy is written once:
    403/407/429/5xx and a BlockedError burn the session and retry from a fresh
    exit IP; a 400 does not, because a 400 is our own malformed request and a
    different address cannot fix it.

    `parse` runs INSIDE the retry loop on purpose. A soft block arrives as a
    200 carrying an interstitial, so the only place it can be detected is in
    the parse — and it deserves the same rotate-and-retry a 403 gets.
    """
    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        rotate = False
        try:
            status, body = http_get_text(url, headers=headers, session=session)
            if status == 200:
                return parse(body) if parse else body
            last_err = f"HTTP {status}"
            if not _is_blocked(status):
                break
            rotate = True
        except BlockedError as e:
            last_err = str(e)
            rotate = True
        except ProxyError as e:
            last_err = str(e)
            # A 407 is bad credentials or an unparseable session username —
            # retrying through a different exit IP cannot fix that.
            if e.proxy_status == 407:
                break
            rotate = True
        except Exception as e:  # network noise: retry, but do not burn the IP
            last_err = str(e)

        # Fresh exit IP for the retry: the same blocked address retried twice
        # more just burns the backoff budget.
        if rotate and session:
            session.rotate()
        # Only BETWEEN attempts. Sleeping after the last one delays the raise by
        # 9s and buys nothing, which on a fully blocked category is 9s per page
        # out of a 15-minute Lambda budget.
        if attempt < MAX_RETRIES:
            time.sleep(attempt * attempt)  # 1s, 4s

    raise RuntimeError(f"{label}: {last_err}")


def json_parser(validate=None):
    """A `parse` for fetch(): JSON-decode, then assert the payload is ours.

    `validate(payload)` returning falsy rejects a response that decoded but is
    not the thing we asked for — the shape a soft block takes.
    """

    def parse(body):
        try:
            payload = json.loads(body)
        except json.JSONDecodeError as e:
            # HTML where JSON was expected is the signature of an interstitial.
            raise BlockedError(f"response was not JSON ({e})") from None
        if validate is not None and not validate(payload):
            raise BlockedError("response did not contain the expected payload")
        return payload

    return parse


# ---------------------------------------------------------------- parsing


def parse_package_size(raw, unit_field=None) -> dict:
    """"2kg" | "500g" | "each" | "6x375mL" | "Approx. 250g" -> normalised base units."""
    out = {
        "qty": None, "uom": None, "units_per_pack": 1, "net_value": None,
        "net_uom": None, "loose": False, "increment": None, "warn": None,
    }
    if not raw:
        # Fall back to the Unit field: "Each" is meaningful even with no size string
        if re.search(r"each", unit_field or "", re.I):
            out.update(units_per_pack=1, net_value=1, net_uom="ea", qty=1, uom="ea")
        else:
            out["warn"] = "PACK_SIZE_UNPARSED"
        return out

    s = str(raw).strip()

    if re.fullmatch(r"each|per each|ea", s, re.I):
        return {**out, "qty": 1, "uom": "ea", "net_value": 1, "net_uom": "ea"}

    # "per kg" / "per 200g" — loose, sold by weight. The displayed Price is the
    # price for ONE BASE UNIT (per kg / per L); the number here is the purchase
    # increment, NOT the pack's net size. Verified: "Mushroom Portobello Loose",
    # PackageSize "per 200g", Price 13.50, CupString "$13.50 / 1KG" — dividing
    # by 0.2 would report $67.50/kg. So net size is 1 base unit, and the
    # increment is recorded separately.
    per = re.fullmatch(r"per\s+([\d.]*)\s*(kg|g|l|ml)", s, re.I)
    if per:
        n = float(per.group(1)) if per.group(1) else 1
        base = to_base(n, per.group(2))
        return {**out, "qty": n, "uom": per.group(2).lower(), "loose": True,
                "increment": base["net_value"], "net_value": 1, "net_uom": base["net_uom"]}

    # "6x375mL" / "6 x 375 mL"
    multi = re.fullmatch(r"(?:approx\.?\s*)?(\d+)\s*[x×]\s*([\d.]+)\s*(kg|g|l|ml)", s, re.I)
    if multi:
        count, each = int(multi.group(1)), float(multi.group(2))
        base = to_base(each * count, multi.group(3))
        return {**out, "qty": each, "uom": multi.group(3).lower(), "units_per_pack": count, **base}

    # "2kg" / "500g" / "1.5L" / "Approx. 250g"
    simple = re.match(r"(?:approx\.?\s*)?([\d.]+)\s*(kg|g|l|ml)\b", s, re.I)
    if simple:
        n = float(simple.group(1))
        return {**out, "qty": n, "uom": simple.group(2).lower(), **to_base(n, simple.group(2))}

    # "6 pack" / "12 pack" / "1 Each" / "1 Bunch" / "1 Unit".
    # Coles states a countable size where Woolworths leaves it blank and says
    # "Each" in a separate field — measured, these four words cover every
    # countable size string in the Coles Fruit & Veg feed (82 of 481 rows).
    pk = re.fullmatch(r"(\d+)\s*(?:pack|pk|each|ea|bunch|unit|piece|pieces|pce)", s, re.I)
    if pk:
        n = int(pk.group(1))
        return {**out, "qty": n, "uom": "pack" if n > 1 else "ea",
                "units_per_pack": n, "net_value": n, "net_uom": "ea"}

    return {**out, "warn": "PACK_SIZE_UNPARSED"}


def to_base(value: float, uom: str) -> dict:
    u = str(uom).lower()
    if u == "kg":
        return {"net_value": value, "net_uom": "kg"}
    if u == "g":
        return {"net_value": value / 1000, "net_uom": "kg"}
    if u == "l":
        return {"net_value": value, "net_uom": "L"}
    if u == "ml":
        return {"net_value": value / 1000, "net_uom": "L"}
    return {"net_value": None, "net_uom": None}


def parse_cup_string(cup_string, cup_price, cup_measure) -> dict:
    """"$8.50 / 1KG" -> {value: 8.5, measure: '1KG'}; also handles "$0.53 per 10G".

    Coles' `pricing.comparable` ("$3.50/ 1kg") is the same shape, which is why
    this is shared rather than duplicated — and why Coles passes cup_measure as
    None: its `unit.ofMeasureUnits` disagrees with its own comparable string
    (`g` against `1kg`, measured), so the string is the trustworthy source.
    """
    measure = cup_measure
    if not measure:
        m = re.search(r"(?:/|per)\s*([\d.]*\s*[A-Za-z]+)\s*$", cup_string or "")
        measure = m.group(1).strip() if m else None
    value = None
    if cup_price is not None:
        try:
            value = float(cup_price)
        except (TypeError, ValueError):
            value = None
    else:
        m = re.search(r"\$([\d.]+)", cup_string or "")
        value = float(m.group(1)) if m else None
    return {"value": value, "measure": measure}


def cup_to_canonical(cup_value, cup_measure) -> dict:
    """Convert a retailer cup price to our canonical per-kg / per-L / per-each."""
    # A cup price of 0 is an out-of-stock marker, never a real $0.00/kg — the
    # same trap spec 6.4 calls out for price_aud. Publishing it would put
    # 0.0000 in a price_per_* column, which is the one value guaranteed to win
    # any MIN() and drag any average to the floor.
    if cup_value is None or cup_value <= 0 or not cup_measure:
        return {}
    m = re.fullmatch(r"([\d.]*)\s*([A-Za-z]+)", str(cup_measure).strip())
    if not m:
        return {}
    n = float(m.group(1)) if m.group(1) else 1
    u = m.group(2).upper()
    if not n:
        return {}
    if u == "KG":
        return {"per_kg": cup_value / n}
    if u == "G":
        return {"per_kg": (cup_value / n) * 1000}
    if u == "L":
        return {"per_l": cup_value / n}
    if u == "ML":
        return {"per_l": (cup_value / n) * 1000}
    if u == "EA":
        return {"per_each": cup_value / n}
    return {}


def classify(*text) -> dict:
    hay = " ".join(str(t or "") for t in text).lower()
    return {
        "is_organic": bool(re.search(r"\borganic\b", hay)),
        "is_prepared": bool(
            re.search(r"\b(prepared|steam|microwave|oven ready|stir fry|salad kit|cut veg|coleslaw)\b", hay)
        ),
    }


def canonical_key(name, brand, variety, net_uom, flags) -> str:
    """Stable grouping hash over retailer-independent attributes (spec 8.1).

    Deliberately excludes pack size, so every size of the same product groups
    together and can be compared on price_per_kg_aud — and deliberately
    identical across retailers, which is what lets a Woolworths row and a Coles
    row for the same thing meet in the absence of a GTIN.
    """
    cleaned = re.sub(r"[^a-z0-9\s]", " ", str(name or "").lower())
    tokens = sorted(
        t for t in cleaned.split()
        if t and not re.fullmatch(r"\d+(kg|g|l|ml|ea|pk|pack)?", t)
    )
    basis = "|".join([
        "-".join(tokens),
        (brand or "").lower(),
        (variety or "").lower(),
        net_uom or "",
        "org" if flags["is_organic"] else "",
        "prep" if flags["is_prepared"] else "",
    ])
    return hashlib.sha1(basis.encode("utf-8")).hexdigest()[:16]


def derive_unit_prices(price, pack, cup, canon) -> tuple[dict, list]:
    """Cross-check the retailer's unit price against one we derive ourselves.

    Returns ({per_kg, per_l, per_each}, warnings). Shared because the rule —
    trust the retailer's cup price, fill the gap when it is missing, and warn
    when the two disagree by more than 5% — must be identical for both files or
    the price_per_kg_aud columns are not comparable.
    """
    warns = []
    per_kg = canon.get("per_kg")
    per_l = canon.get("per_l")
    per_each = canon.get("per_each")

    # Spec 6.4: exactly ONE price_per_* is populated per row, and net_size_uom
    # decides which one. The retailer's cup basis does not always agree with the
    # pack we parsed — Coles quotes "$6.20/ 1ea" against a 700g pumpkin and
    # "$7.90/ 1kg" against a "1 each" bag of apples (6 rows in one measured
    # category). Keeping both fills two columns, and a consumer then compares a
    # per-kg figure against a per-each one believing both are the same series.
    # The pack's own basis wins, the disagreement is flagged, and the retailer's
    # number survives verbatim in unit_price_raw / _value / _measure, so history
    # stays re-derivable either way.
    cup_basis = "kg" if per_kg is not None else "L" if per_l is not None else "ea" if per_each is not None else None
    if cup_basis and pack["net_uom"] and cup_basis != pack["net_uom"]:
        per_kg = per_l = per_each = None
        warns.append("CUP_PRICE_BASIS_MISMATCH")

    # A multipack priced "$X / 1EA" means the retailer treats the whole pack as
    # one unit (e.g. "Bananas Kids", 5 pack, $3.50 / 1EA). Don't second-guess it
    # — but only while that per-each figure is the one we are publishing. Once
    # it has been dropped above, suppressing the derivation too would leave the
    # row with no unit price at all.
    cup_treats_pack_as_one = per_each is not None and bool(
        re.fullmatch(r"1?\s*EA", cup["measure"] or "", re.I)
    ) and pack["units_per_pack"] > 1

    if price is not None and pack["net_value"] and not cup_treats_pack_as_one:
        derived = price / pack["net_value"]
        target = per_kg if pack["net_uom"] == "kg" else per_l if pack["net_uom"] == "L" else per_each
        # `if target` and not `is not None`: a 0 target is not a comparison
        # base, it is a division by zero.
        if target and abs(derived - target) / target > 0.05:
            warns.append("CUP_PRICE_MISMATCH")
        if pack["net_uom"] == "kg" and per_kg is None:
            per_kg = derived
        if pack["net_uom"] == "L" and per_l is None:
            per_l = derived
        if pack["net_uom"] == "ea" and per_each is None:
            per_each = derived

    return {"per_kg": per_kg, "per_l": per_l, "per_each": per_each}, warns


def sold_by_of(pack: dict) -> str:
    # Order matters: "loose" (priced per base unit) beats the pack shape, which
    # describes the ordering unit rather than the pricing basis.
    if pack["loose"]:
        return "weight"
    if pack["units_per_pack"] > 1 or (pack["net_value"] is not None and pack["net_uom"] != "ea"):
        return "pack"
    return "each"


# ---------------------------------------------------------------- CSV

COLUMNS = [
    "schema_version", "dataset", "run_id", "retailer", "captured_at_utc", "source_endpoint", "confidence",
    "postcode", "fulfilment_store_id", "price_basis",
    "retailer_sku", "gtin", "product_url", "record_id",
    "product_name", "display_name", "brand", "variety",
    "dept_node_id", "dept_name", "category_node_id", "category_name", "subcategory_node_id", "subcategory_name",
    "sap_department", "sap_category", "sap_subcategory", "sap_segment",
    "is_organic", "is_prepared", "country_of_origin", "health_star_rating", "image_url",
    "package_size_raw", "pack_qty", "pack_uom", "units_per_pack", "net_size_value", "net_size_uom",
    "purchase_increment", "sold_by", "is_variable_weight",
    "price_aud", "was_price_aud", "savings_aud", "is_on_special", "promo_text",
    "unit_price_raw", "unit_price_value", "unit_price_measure",
    "price_per_kg_aud", "price_per_l_aud", "price_per_each_aud", "price_currency",
    "is_available", "is_in_stock", "is_purchasable", "availability_status", "is_age_restricted",
    "is_sponsored", "is_market_product", "source_category_id", "source_category_name",
    "canonical_product_key", "basket_item_id", "parse_warnings",
    # Schema 1.1, appended on the right per spec section 9.3. Coles' merchandise
    # hierarchy has one more level than Woolworths' (POTATOES between
    # VEGETABLES/SALAD and SWEET POTATOES); folding it into an existing column
    # would have changed what sap_subcategory means, and cheapest.py groups on
    # sap_subcategory. Empty for Woolworths, which has no such level.
    "sap_family",
]

_MONEY_2DP = {"price_aud", "was_price_aud", "savings_aud", "unit_price_value"}
_MONEY_4DP = {"price_per_kg_aud", "price_per_l_aud", "price_per_each_aud"}


def _csv_cell(col: str, v) -> str:
    if v is None or v == "":
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        if isinstance(v, float) and (v != v or v in (float("inf"), float("-inf"))):
            return ""
        if col in _MONEY_2DP:
            return f"{v:.2f}"
        if col in _MONEY_4DP:
            return f"{v:.4f}"
        # Whole floats print as ints, matching the JS output this replaced.
        if isinstance(v, float) and v.is_integer():
            return str(int(v))
        return str(v)
    return str(v)


def to_csv(rows: list[dict]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n", quoting=csv.QUOTE_MINIMAL)
    w.writerow(COLUMNS)
    for r in rows:
        w.writerow([_csv_cell(c, r.get(c)) for c in COLUMNS])
    return buf.getvalue()


# ---------------------------------------------------------------- crawl


def crawl_category(
    retailer,
    category: str,
    url: str,
    name: str,
    run_id: str,
    postcode: str = "2000",
    captured_at: str | None = None,
    max_pages: int = 0,
    delay_ms: int = 700,
    log=lambda m: None,
    proxy=None,
    probe: bool = False,
) -> tuple[list[dict], dict]:
    """Crawl every page of one browse category through a retailer adapter.

    Handles the two tile-contamination cases measured against the live sites
    (see spec section 10.1a, COLES_DISCOVERY.md section 3):
      - SPONSORED product tiles ride along on every page and repeat the same
        SKUs. They are real products, so they are kept and flagged, but deduped
        by SKU — otherwise they are counted once per page and skew any category
        average. (Woolworths: 8/page. Coles: none observed in Fruit & Veg.)
      - Third-party marketplace rows are skipped entirely for grocery datasets.
        (Woolworths "Everyday Market". Coles has no marketplace tier.)

    Banner/content-card ads never reach us: they are injected client-side and
    are absent from these JSON payloads, which is the main reason to consume the
    data route rather than scrape the rendered DOM.
    """
    captured_at = captured_at or utc_now_iso()
    ctx = {
        "run_id": run_id, "captured_at": captured_at, "postcode": postcode,
        "category_id": category, "category_name": name,
    }
    target = {"category": category, "url": url, "name": name}

    seen: dict[str, dict] = {}
    errors: list[dict] = []
    total = None
    pages = tiles = sponsored_tiles = dup_sponsored = market_skipped = 0

    # One sticky residential session for the whole category: a dozen pages from
    # one AU exit IP reads like a single shopper browsing, where a dozen
    # different IPs paging one category in 20s reads like exactly what it is.
    session = create_session(proxy)
    exit_ip = None
    if session:
        log(f"egress via {session.describe()}")
        if probe:
            try:
                seen_from = probe_exit_ip(session)
                exit_ip = seen_from["ip"]
                where = ", ".join(x for x in [seen_from["city"], seen_from["country"]] if x)
                log(f"exit ip {seen_from['ip']} ({where})")
            except Exception as e:
                # A failed probe is a strong signal, but the crawl itself is the
                # real test — let it run and let the pages report the truth.
                log(f"exit-ip probe failed: {e}")

    state = {}
    try:
        state = retailer.start(target, session, log)
    except Exception as e:
        # A warm-up that fails means every page would fail identically. Fail the
        # run here rather than logging the same error once per page.
        errors.append({"page": 0, "message": f"warm-up: {e}"})
        log(f"warm-up FAILED — {e}")

    n = 0
    while not errors:
        n += 1
        if max_pages and n > max_pages:
            break
        try:
            data = retailer.fetch_page(target, n, session, state)
        except Exception as e:
            errors.append({"page": n, "message": str(e)})
            log(f"page {n}: FAILED — {e}")
            break

        pages += 1
        if total is None:
            total = retailer.total_count(data)
            expected = -(-total // retailer.PAGE_SIZE) if total else 0
            log(f"{total} products reported, {expected} pages expected")

        products = retailer.page_products(data, state)
        tiles += len(products)

        added = 0
        for p in products:
            sku = retailer.sku_of(p)
            if not sku:
                continue
            if retailer.is_sponsored(p):
                sponsored_tiles += 1
            if retailer.is_skipped(p):
                market_skipped += 1
                continue
            if sku in seen:
                if retailer.is_sponsored(p):
                    dup_sponsored += 1
                continue
            seen[sku] = retailer.build_row(p, ctx, state)
            added += 1

        log(f"page {n:>2}: {len(products)} tiles -> +{added} new ({len(seen)} total)")

        if not products:
            break
        if total is not None and n >= -(-total // retailer.PAGE_SIZE):
            break
        if delay_ms:
            time.sleep(delay_ms / 1000)

    if session:
        session.close()

    rows = [seen[k] for k in sorted(seen)]
    complete = not errors and total is not None and len(rows) == total

    manifest = {
        "schema_version": SCHEMA_VERSION, "dataset": retailer.DATASET, "run_id": run_id,
        "retailer": retailer.RETAILER,
        "started_at_utc": captured_at,
        "finished_at_utc": utc_now_iso(),
        # 'complete' requires every reported product to be accounted for, not
        # merely that no page threw — a short crawl is 'partial' (spec 3.2).
        "status": "partial" if errors else ("complete" if complete else "partial"),
        # Egress is capture context: a run that came out of a Sydney residential
        # IP and one that came out of an AWS ap-southeast-2 IP are not
        # guaranteed to have been shown the same prices, and a reader comparing
        # two days of history deserves to know which is which.
        "capture_context": {
            "postcode": postcode,
            "price_basis": "online",
            "egress": "proxy" if session else "direct",
            "egress_country": (proxy.country or "unspecified") if session else "aws",
            "exit_ip": exit_ip or "",
            **retailer.capture_extras(state),
        },
        "requested_nodes": [{"node_id": category, "name": name}],
        "counts": {
            "total_reported": total, "pages_fetched": pages, "tiles_seen": tiles,
            "sponsored_tiles": sponsored_tiles, "sponsored_duplicates_dropped": dup_sponsored,
            "market_products_skipped": market_skipped,
            # Non-zero means we were blocked mid-crawl and changed IP to
            # recover. Persistent rotations are the early warning that the
            # endpoint has started fingerprinting us, well before it becomes a
            # 0-row failure.
            "proxy_rotations": session.rotations if session else 0,
            "rows_written": len(rows),
            "rows_with_price": sum(1 for r in rows if r["price_aud"] is not None),
            "rows_with_warnings": sum(1 for r in rows if r["parse_warnings"]),
        },
        "errors": errors,
    }
    return rows, manifest
