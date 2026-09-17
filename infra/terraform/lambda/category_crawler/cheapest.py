"""Derived report: the cheapest buyable item in each `sap_subcategory`.

One row per (sap_subcategory x unit basis). This is the series the basket is
built on — "what do potatoes cost at Woolworths today" — and it implements the
fresh-produce representative-product policy from LAMBDA_OUTPUT_SPEC.md section
8.2: *cheapest per unit within subcategory, excluding organic and prepared*.

Two rules worth stating, because getting either wrong makes the series lie:

  - Comparison happens **within one unit basis**. A subcategory holds both
    `$4.00/kg` bagged potatoes and `$1.31/ea` loose apples; a min() across the
    two picks whichever unit happens to be numerically smaller, which is not a
    price at all. So kg, L and ea are separate rows, each self-consistent.
  - Organic and prepared lines are excluded, not merely deprioritised. They are
    a different product for index purposes, and letting a subcategory fall back
    to organic on a day the conventional line is out of stock would show as a
    price spike that no shopper experienced.

A subcategory with no eligible candidate emits **no row** and is counted in the
summary. An absent row means "nothing qualifying was on sale", which a consumer
must read as unknown — never as zero.

Standard library only. Imported by index.py (Lambda) and by the local CLI.
"""

from __future__ import annotations

import csv
import io
import statistics

import taxonomy

# 1.1: canonical_group / group_kind appended on the right (spec section 9.3,
# additive within a major version). Consumers read by header name, so a reader
# built against 1.0 is unaffected — it simply cannot join the two retailers.
# 1.2: group_source appended. A 1.1 reader sees the same columns it always did;
# the groups it reads are now filled in for rows that used to be blank.
SCHEMA_VERSION = "1.2"
DATASET_KIND = "cheapest_by_subcategory"

SELECTION_RULE = "min_unit_price_within_sap_subcategory_excl_organic_prepared"

# Exactly one of these is populated per source row (spec section 6.4); the one
# that is decides which basis the row can be compared on.
_BASES = (
    ("price_per_kg_aud", "kg"),
    ("price_per_l_aud", "L"),
    ("price_per_each_aud", "ea"),
)

COLUMNS = [
    "schema_version", "dataset", "run_id", "retailer", "captured_at_utc",
    "postcode", "fulfilment_store_id", "price_basis", "selection_rule",
    "sap_department", "sap_category", "sap_subcategory", "unit_basis",
    "unit_price_aud", "median_unit_price_aud", "max_unit_price_aud",
    "candidates", "excluded_organic", "excluded_prepared", "excluded_unavailable",
    "retailer_sku", "gtin", "product_name", "display_name", "brand",
    "package_size_raw", "net_size_value", "net_size_uom",
    "price_aud", "was_price_aud", "is_on_special", "promo_text",
    "product_url", "image_url", "canonical_product_key",
    # Schema 1.1. The two retailers file the same produce under different names
    # at different grain — Woolworths POTATO against Coles BRUSHED/WASHED/RED/
    # BABY POTATOES — so sap_subcategory cannot join them. canonical_group can:
    # both retailers map into one vocabulary (taxonomy.py), and a consumer
    # groups on it and takes the min across each retailer's rows.
    #
    # Deliberately an ANNOTATION, not the grouping key. Grouping on it here
    # would throw away the Coles detail that a shopper can actually buy — you
    # would lose "washed potatoes are $2.23/kg" to a single potatoes number.
    "canonical_group", "group_kind",
    # Schema 1.2. Which tier named the group: `subcategory` (the retailer's own
    # bucket) or `product_name` (taxonomy.py read the winning row's name because
    # the bucket was a catch-all like VEGETABLES or ORGANICS). A name-derived
    # group is a good guess, not a retailer fact, and a consumer measuring the
    # fallback's error rate needs to be able to pick those rows out.
    "group_source",
]

_MONEY_2DP = {"price_aud", "was_price_aud"}
_MONEY_4DP = {"unit_price_aud", "median_unit_price_aud", "max_unit_price_aud"}


def _unit_of(row: dict):
    """(basis label, unit price) for a row, or None when it is not comparable."""
    for col, label in _BASES:
        v = row.get(col)
        if isinstance(v, (int, float)) and v > 0:
            return label, float(v)
    return None


def _buyable(row: dict) -> bool:
    price = row.get("price_aud")
    return (
        isinstance(price, (int, float))
        and price > 0
        and row.get("is_purchasable") is True
        and row.get("is_in_stock") is True
    )


def build_cheapest_rows(rows: list[dict], ctx: dict) -> tuple[list[dict], dict]:
    """Reduce a run's product rows to one cheapest row per subcategory+basis.

    `ctx` carries the run spine (retailer, run_id, captured_at, postcode,
    price_basis) so the report stands alone: a consumer reading only this file
    still knows which capture it came from. Retailer-agnostic on purpose — one
    implementation, so the Woolworths and Coles series are computed by exactly
    the same rule and stay comparable.

    Returns (rows, summary) where summary goes into `_manifest.json`.
    """
    groups: dict[tuple, dict] = {}
    skipped_no_subcategory = 0
    unmapped: set[str] = set()

    for r in rows:
        sub = (r.get("sap_subcategory") or "").strip()
        if not sub:
            # Unclassified rows cannot anchor a series; they stay in the raw CSV.
            skipped_no_subcategory += 1
            continue
        basis = _unit_of(r)
        if basis is None:
            continue
        label, unit_price = basis
        # A subcategory the rule table has never seen means every row under it
        # drops out of any cross-retailer comparison. The row is still written;
        # the name is reported in the summary so it gets a rule.
        if taxonomy.classify(sub)[1] == "unmapped":
            unmapped.add(sub)
        key = (
            (r.get("sap_department") or "").strip(),
            (r.get("sap_category") or "").strip(),
            sub,
            label,
        )
        g = groups.setdefault(key, {
            "candidates": [], "organic": 0, "prepared": 0, "unavailable": 0,
        })

        if r.get("is_organic") is True:
            g["organic"] += 1
            continue
        if r.get("is_prepared") is True:
            g["prepared"] += 1
            continue
        if not _buyable(r):
            g["unavailable"] += 1
            continue
        g["candidates"].append((unit_price, r))

    out: list[dict] = []
    empty_groups = 0

    for (dept, cat, sub, label), g in sorted(groups.items()):
        if not g["candidates"]:
            empty_groups += 1
            continue

        # Deterministic winner: cheapest per unit, then cheapest pack, then SKU.
        # Without the tiebreakers two equal-priced SKUs would alternate between
        # runs and read as churn in a series that did not actually move.
        unit_price, win = min(
            g["candidates"],
            key=lambda c: (c[0], c[1].get("price_aud") or 0, str(c[1].get("retailer_sku") or "")),
        )
        prices = [c[0] for c in g["candidates"]]

        # Classified AFTER the winner is chosen, on purpose: the group is one
        # subcategory but many names, and only the winning row's name can say
        # what the winning row is. Under a catch-all like Coles VEGETABLES the
        # cheapest item might be zucchini today and onions tomorrow.
        group, kind, source = taxonomy.classify_row(sub, win.get("product_name"))

        out.append({
            "schema_version": SCHEMA_VERSION,
            "dataset": f"{ctx['retailer']}.{DATASET_KIND}",
            "run_id": ctx["run_id"],
            "retailer": ctx["retailer"],
            "captured_at_utc": ctx["captured_at"],
            "postcode": ctx.get("postcode", ""),
            "fulfilment_store_id": win.get("fulfilment_store_id", ""),
            "price_basis": ctx.get("price_basis", "online"),
            "selection_rule": SELECTION_RULE,
            "sap_department": dept,
            "sap_category": cat,
            "sap_subcategory": sub,
            "unit_basis": label,
            "unit_price_aud": unit_price,
            # Diagnostics, per spec 8.2: a headline that is far below the median
            # is a single promotion, not a market move.
            "median_unit_price_aud": statistics.median(prices),
            "max_unit_price_aud": max(prices),
            "candidates": len(prices),
            "excluded_organic": g["organic"],
            "excluded_prepared": g["prepared"],
            "excluded_unavailable": g["unavailable"],
            "retailer_sku": win.get("retailer_sku", ""),
            "gtin": win.get("gtin", ""),
            "product_name": win.get("product_name", ""),
            "display_name": win.get("display_name", ""),
            "brand": win.get("brand", ""),
            "package_size_raw": win.get("package_size_raw", ""),
            "net_size_value": win.get("net_size_value", ""),
            "net_size_uom": win.get("net_size_uom", ""),
            "price_aud": win.get("price_aud"),
            "was_price_aud": win.get("was_price_aud"),
            "is_on_special": win.get("is_on_special"),
            "promo_text": win.get("promo_text", ""),
            "product_url": win.get("product_url", ""),
            "image_url": win.get("image_url", ""),
            "canonical_product_key": win.get("canonical_product_key", ""),
            "canonical_group": group,
            "group_kind": kind,
            "group_source": source,
        })

    summary = {
        "rows_written": len(out),
        "subcategories": len({(k[0], k[1], k[2]) for k in groups}),
        "groups_with_no_candidate": empty_groups,
        "rows_without_subcategory": skipped_no_subcategory,
        "on_special": sum(1 for r in out if r["is_on_special"] is True),
        "selection_rule": SELECTION_RULE,
        # How much of this report can enter a cross-retailer comparison, and
        # what is stopping the rest. `unmapped_subcategories` non-empty is the
        # signal that taxonomy.py needs a rule, not that the retailer changed
        # its prices.
        "produce_rows": sum(1 for r in out if r["group_kind"] == "produce"),
        "canonical_groups": len({r["canonical_group"] for r in out if r["canonical_group"]}),
        "rows_by_group_kind": {
            k: sum(1 for r in out if r["group_kind"] == k)
            for k in sorted({r["group_kind"] for r in out})
        },
        # How many groups came from the product name rather than the bucket.
        # This number should be small and stable; a jump means a retailer moved
        # rows into a catch-all, and the fallback is now carrying weight it
        # was not measured for.
        "rows_by_group_source": {
            s: sum(1 for r in out if r["group_source"] == s)
            for s in sorted({r["group_source"] for r in out})
        },
        "rescued_by_product_name": sum(
            1 for r in out
            if r["group_source"] == taxonomy.SOURCE_PRODUCT_NAME
            and r["group_kind"] == "produce"
        ),
        # Still reported even when tier 2 rescued every row under it: an unseen
        # subcategory still needs a rule, because the name is a fallback and
        # not a substitute.
        "unmapped_subcategories": sorted(unmapped),
    }
    return out, summary


# ---------------------------------------------------------------- CSV

def _cell(col: str, v) -> str:
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
        if isinstance(v, float) and v.is_integer():
            return str(int(v))
        return str(v)
    return str(v)


def to_csv(rows: list[dict]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n", quoting=csv.QUOTE_MINIMAL)
    w.writerow(COLUMNS)
    for r in rows:
        w.writerow([_cell(c, r.get(c)) for c in COLUMNS])
    return buf.getvalue()
