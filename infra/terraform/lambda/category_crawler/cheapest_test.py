"""Exercises the cheapest-per-subcategory report on synthetic rows.

    python infra/terraform/lambda/category_crawler/cheapest_test.py

No network, no AWS. Every case here is one the live Fruit & Veg feed actually
produces, so a regression in any of them is a regression in the published
potato series.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from cheapest import COLUMNS, build_cheapest_rows, to_csv  # noqa: E402

CTX = {
    "retailer": "woolworths",
    "run_id": "20260829033121-test",
    "captured_at": "2026-08-29T03:31:21Z",
    "postcode": "2000",
    "price_basis": "online",
}


def row(sku, sub, price, *, kg=None, ea=None, organic=False, prepared=False,
        in_stock=True, purchasable=True, special=False, name=None):
    return {
        "retailer_sku": sku, "gtin": "", "product_name": name or f"Product {sku}",
        "display_name": name or f"Product {sku}", "brand": "Woolworths",
        "sap_department": "FRUIT AND VEG", "sap_category": "VEG", "sap_subcategory": sub,
        "is_organic": organic, "is_prepared": prepared,
        "package_size_raw": "", "net_size_value": 1, "net_size_uom": "kg" if kg else "ea",
        "price_aud": price, "was_price_aud": None, "is_on_special": special, "promo_text": "",
        "price_per_kg_aud": kg, "price_per_l_aud": None, "price_per_each_aud": ea,
        "is_in_stock": in_stock, "is_purchasable": purchasable,
        "product_url": "", "image_url": "", "canonical_product_key": "abc123",
        "fulfilment_store_id": "1101",
    }


ROWS = [
    row("1", "POTATO", 8.00, kg=4.00),
    row("2", "POTATO", 10.00, kg=2.50, name="Brushed Potatoes 4kg"),   # winner, kg
    row("3", "POTATO", 6.00, kg=1.20, organic=True),                   # excluded
    row("4", "POTATO", 5.00, kg=1.50, prepared=True),                  # excluded
    row("5", "POTATO", 4.00, kg=1.00, in_stock=False),                 # excluded
    row("6", "POTATO", 0.90, ea=0.90, name="Potato Red Washed each"),  # winner, ea
    row("7", "POTATO", 1.50, ea=1.50),
    row("8", "ONION", 3.00, kg=3.00, purchasable=False),               # only line: no row
    row("9", "TOMATO", 2.00, kg=2.00, special=True, name="Tomatoes"),
    row("10", "TOMATO", 2.00, kg=2.00),                                # ties with 9 -> sku wins
    {**row("11", "", 1.00, kg=1.00), "sap_subcategory": ""},           # unclassified
    row("12", "HERB", 3.00),                                           # no unit basis at all
]

out, summary = build_cheapest_rows(ROWS, CTX)
by = {(r["sap_subcategory"], r["unit_basis"]): r for r in out}

print("SUMMARY:", summary)
print("\nROWS:")
for r in out:
    print(f"  {r['sap_subcategory']:8} {r['unit_basis']:3} {r['unit_price_aud']:>7.2f}"
          f"  sku={r['retailer_sku']:<3} n={r['candidates']}")

csv_text = to_csv(out)
header, *lines = csv_text.split("\n")

checks = {
    "kg winner is the cheapest per kg, not the cheapest pack":
        by[("POTATO", "kg")]["retailer_sku"] == "2",
    "kg and ea are separate rows, never compared":
        by[("POTATO", "ea")]["retailer_sku"] == "6",
    "organic excluded and counted":
        by[("POTATO", "kg")]["excluded_organic"] == 1,
    "prepared excluded and counted":
        by[("POTATO", "kg")]["excluded_prepared"] == 1,
    "out of stock excluded and counted":
        by[("POTATO", "kg")]["excluded_unavailable"] == 1,
    "candidate count is post-exclusion":
        by[("POTATO", "kg")]["candidates"] == 2,
    "median is a diagnostic over candidates only":
        by[("POTATO", "kg")]["median_unit_price_aud"] == 3.25,
    "a subcategory with no eligible line emits no row":
        ("ONION", "kg") not in by,
    "empty group counted, not silently dropped":
        summary["groups_with_no_candidate"] == 1,
    "unclassified rows counted, never grouped":
        summary["rows_without_subcategory"] == 1,
    "rows with no unit basis are skipped":
        all(r["sap_subcategory"] != "HERB" for r in out),
    "ties break on sku, so the series does not churn":
        by[("TOMATO", "kg")]["retailer_sku"] == "10",
    "on_special counted in the summary":
        summary["on_special"] == 0,  # sku 10 won; the special (sku 9) did not
    "dataset and retailer come from the run, not from the module":
        out[0]["retailer"] == "woolworths"
        and out[0]["dataset"] == "woolworths.cheapest_by_subcategory"
        and build_cheapest_rows(ROWS, {**CTX, "retailer": "coles"})[0][0]["dataset"]
        == "coles.cheapest_by_subcategory",
    "header matches COLUMNS exactly":
        header == ",".join(COLUMNS),
    "money is 4dp for unit prices, 2dp for shelf prices":
        ",2.5000," in csv_text and ",10.00," in csv_text,
    "LF line endings, trailing newline":
        csv_text.endswith("\n") and "\r" not in csv_text,
    "one row per group":
        len(lines) - 1 == len(out),
}

print("\nCHECKS:")
ok = True
for name, passed in checks.items():
    print(f"  {'PASS' if passed else 'FAIL'}  {name}")
    ok = ok and passed
sys.exit(0 if ok else 1)
