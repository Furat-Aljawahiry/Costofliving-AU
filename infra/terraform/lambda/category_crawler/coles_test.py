"""Exercises the Coles adapter's row mapping, and the schema parity that is the
whole reason the two retailers share a crawler.

    python infra/terraform/lambda/category_crawler/coles_test.py

No network, no AWS. Every product below is a real Coles browse-payload object
captured from /browse/fruit-vegetables on 2026-08-29, trimmed of fields the
adapter does not read — so a regression here is a regression against the live
feed, not against an invented one.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import coles  # noqa: E402
import woolworths  # noqa: E402
from crawler import COLUMNS, to_csv  # noqa: E402

CTX = {
    "run_id": "20260829040000-test",
    "captured_at": "2026-08-29T04:00:00Z",
    "postcode": "",
    "category_id": "fruit-vegetables",
    "category_name": "Fruit & Vegetables",
}
STATE = {
    "build_id": "20260825.4-04e74006",
    "store_id": "7674",
    "assets_url": "https://cdn.productimages.coles.com.au/productimages",
}


def _p(**kw):
    base = {
        "_type": "PRODUCT", "adId": None, "featured": False, "brand": "Coles",
        "availability": True, "availabilityType": "InStoreAndOnline",
        "restrictions": {"liquorAgeRestrictionFlag": False, "tobaccoAgeRestrictionFlag": False},
        "onlineHeirs": [{"aisle": "Potatoes", "category": "Vegetables",
                         "subCategory": "Fruit & Vegetables", "categoryId": "1303",
                         "aisleId": "545475", "subCategoryId": "2100"}],
    }
    return {**base, **kw}


# A loose, variable-weight line priced per kg: the shape most of the fresh
# produce basket is made of.
SWEET_POTATO = _p(
    id=4199503, name="Potatoes Sweet Gold", size="approx. 500g", availableQuantity=2614,
    imageUris=[{"uri": "/4/4199503.jpg"}],
    merchandiseHeir={"tradeProfitCentre": "FRESH PROD", "categoryGroup": "VEGETABLES/SALAD",
                     "category": "POTATOES", "subCategory": "SWEET POTATOES", "className": "LOOSE"},
    pricing={"now": 1.75, "was": 0, "comparable": "$3.50/ 1kg", "promotionType": "SPECIAL",
             "onlineSpecial": False,
             "unit": {"quantity": 500, "ofMeasureQuantity": 1, "ofMeasureUnits": "g",
                      "price": 3.5, "ofMeasureType": "g", "isWeighted": True,
                      "isIncremental": False}},
)

# A multibuy. `now` is the ordinary single-unit price and nothing is marked
# down: the promotion is "buy 2 and pay $2.40 each".
STRAWBERRIES = _p(
    id=5191256, name="Strawberries", size="250g", availableQuantity=444,
    imageUris=[{"uri": "/5/5191256.jpg"}],
    merchandiseHeir={"tradeProfitCentre": "FRESH PROD", "categoryGroup": "FRUIT",
                     "category": "BERRIES", "subCategory": "BERRIES", "className": "STRAWBERRIES"},
    onlineHeirs=[{"aisle": "Berries & Cherries", "category": "Fruit",
                  "subCategory": "Fruit & Vegetables", "categoryId": "1302",
                  "aisleId": "1701", "subCategoryId": "2100"}],
    pricing={"now": 3, "was": 0, "comparable": "$12.00/ 1kg", "promotionType": "SPECIAL",
             "specialType": "MULTI_SAVE", "onlineSpecial": False,
             "offerDescription": "Buy 2 for $4.80",
             "multiBuyPromotion": {"minQuantity": 2, "reward": 2.4,
                                   "unitPriceDisplay": "$9.60/ 1kg"},
             "unit": {"quantity": 1, "ofMeasureQuantity": 1, "ofMeasureUnits": "kg",
                      "price": 12, "ofMeasureType": "kg", "isWeighted": False,
                      "isIncremental": False}},
)

# "1 Each" — a countable size string Woolworths does not produce, and the one
# shape that used to fall through parse_package_size (82 of 481 rows).
AVOCADO = _p(
    id=5900530, name="Hass Avocados", size="1 Each", availableQuantity=4744,
    imageUris=[{"uri": "/5/5900530.jpg"}],
    merchandiseHeir={"tradeProfitCentre": "FRESH PROD", "categoryGroup": "FRUIT",
                     "category": "AVOCADOS", "subCategory": "AVOCADOS", "className": "LOOSE"},
    pricing={"now": 2.2, "was": 0, "comparable": "$2.20/ 1ea", "onlineSpecial": False,
             "unit": {"quantity": 1, "ofMeasureQuantity": 1, "ofMeasureUnits": "ea",
                      "price": 2.2, "ofMeasureType": "ea", "isWeighted": False,
                      "isIncremental": False}},
)

# Out of stock, but Coles still quotes a price — unlike Woolworths, which sends
# price 0. The price is real; the line is simply not buyable today.
BLUEBERRIES = _p(
    id=5543535, name="Blueberries", size="125g", availability=False, availableQuantity=0,
    imageUris=[{"uri": "/5/5543535.jpg"}],
    merchandiseHeir={"tradeProfitCentre": "FRESH PROD", "categoryGroup": "FRUIT",
                     "category": "BERRIES", "subCategory": "BERRIES", "className": "BLUEBERRIES"},
    pricing={"now": 3.3, "was": 0, "comparable": "$26.40/ 1kg", "promotionType": "SPECIAL",
             "onlineSpecial": False,
             "unit": {"quantity": 1, "ofMeasureQuantity": 1, "ofMeasureUnits": "kg",
                      "price": 26.4, "ofMeasureType": "kg", "isWeighted": False,
                      "isIncremental": False}},
)

ORGANIC_BANANA = _p(
    id=1039770, name="Organic Banana", size="approx. 170g", availableQuantity=448,
    imageUris=[{"uri": "/1/1039770.jpg"}],
    merchandiseHeir={"tradeProfitCentre": "FRESH PROD", "categoryGroup": "VEGETABLES/SALAD",
                     "category": "ORGANIC FRUIT & VEG", "subCategory": "FRUITS",
                     "className": "BANANAS"},
    pricing={"now": 1.11, "was": 0, "comparable": "$6.50/ 1kg", "onlineSpecial": False,
             "unit": {"quantity": 170, "ofMeasureQuantity": 1, "ofMeasureUnits": "g",
                      "price": 6.5, "ofMeasureType": "g", "isWeighted": True,
                      "isIncremental": False}},
)

# A 2-pack whose cup price is "$1.50/ 1ea" — the retailer is pricing ONE unit of
# the pack, so the pack must not be divided again.
LETTUCE_2PK = _p(
    id=4646485, name="Lettuce Cos Baby Hearts", size="2 Pack", availableQuantity=1897,
    imageUris=[{"uri": "/4/4646485.jpg"}],
    merchandiseHeir={"tradeProfitCentre": "FRESH PROD", "categoryGroup": "VEGETABLES/SALAD",
                     "category": "SOFT VEGETABLES", "subCategory": "DECORATIVE LETTUCE",
                     "className": "COS"},
    pricing={"now": 3, "was": 0, "comparable": "$1.50/ 1ea", "promotionType": "SPECIAL",
             "specialType": "MULTI_SAVE", "onlineSpecial": False,
             "offerDescription": "Pick any 2 for $5",
             "multiBuyPromotion": {"minQuantity": 2, "reward": 2.5,
                                   "unitPriceDisplay": "$1.25/ 1ea"},
             "unit": {"quantity": 1, "ofMeasureQuantity": 1, "ofMeasureUnits": "ea",
                      "price": 1.5, "ofMeasureType": "ea", "isWeighted": False,
                      "isIncremental": False}},
)

FIXTURES = [SWEET_POTATO, STRAWBERRIES, AVOCADO, BLUEBERRIES, ORGANIC_BANANA, LETTUCE_2PK]
rows = [coles.build_row(p, CTX, STATE) for p in FIXTURES]
by = {r["retailer_sku"]: r for r in rows}

# One Woolworths product, in the shape its own API returns it — here only to
# prove the two adapters still emit the same columns after the split.
WOOLIES = {
    "Stockcode": 133211, "Name": "Sweet Potato Gold", "DisplayName": "Sweet Potato Gold Each",
    "Brand": "Woolworths", "Variety": "Gold", "PackageSize": "Approx. 500g", "Unit": "Each",
    "Price": 2.10, "WasPrice": 2.10, "CupPrice": 4.20, "CupMeasure": "1KG",
    "CupString": "$4.20 / 1KG", "IsInStock": True, "IsPurchasable": True, "IsAvailable": True,
    "Barcode": "0264011000002", "FulfilmentStoreId": 1101,
    "AdditionalAttributes": {"sapdepartmentname": "FRUIT AND VEG",
                             "sapcategoryname": "VEG / FRESHCUTS / HARD PRODUCE",
                             "sapsubcategoryname": "SWEET POTATO",
                             "sapsegmentname": "SWEET POTATO LOOSE",
                             "countryoforigin": "Australia"},
}
woolies_row = woolworths.build_row(WOOLIES, {**CTX, "postcode": "2000"}, {})

sp = by["4199503"]
straw = by["5191256"]
avo = by["5900530"]
blue = by["5543535"]
lettuce = by["4646485"]

print("ROWS:")
for r in rows:
    print(f"  {r['retailer_sku']:<8} {r['product_name'][:26]:28} {str(r['price_aud']):>6}"
          f"  per_kg={str(r['price_per_kg_aud'])[:7]:>8} per_ea={str(r['price_per_each_aud'])[:7]:>8}"
          f"  {r['sap_subcategory']:<20} {r['parse_warnings']}")

checks = {
    # --- the point of the whole exercise -------------------------------------
    "Coles rows carry exactly the shared COLUMNS, no more, no less":
        all(set(r) == set(COLUMNS) for r in rows),
    "Woolworths rows carry exactly the same columns":
        set(woolies_row) == set(COLUMNS),
    "both retailers' CSVs share one header":
        to_csv(rows).split("\n")[0] == to_csv([woolies_row]).split("\n")[0] == ",".join(COLUMNS),
    "schema_version is stamped on every row":
        all(r["schema_version"] == "1.1" for r in rows),

    # --- identity and spine ---------------------------------------------------
    "retailer_sku is a string, so leading zeros survive a spreadsheet":
        isinstance(sp["retailer_sku"], str) and sp["retailer_sku"] == "4199503",
    "record_id is <retailer>:<sku>:<basis>":
        sp["record_id"] == "coles:4199503:online",
    "product_url is derived from name + size + id":
        sp["product_url"] == "https://www.coles.com.au/product/potatoes-sweet-gold-approx-500g-4199503",
    "source_endpoint elides the buildId, which churns on every deploy":
        sp["source_endpoint"] == "/_next/data/{buildId}/en/browse/{slug}.json",
    "store id comes from the payload, not from a guess":
        sp["fulfilment_store_id"] == "7674",
    "postcode stays empty: an anonymous request is served a default store":
        sp["postcode"] == "",
    "image url is the CDN base plus the payload's relative uri":
        sp["image_url"] == "https://cdn.productimages.coles.com.au/productimages/4/4199503.jpg",

    # --- taxonomy (COLES_DISCOVERY.md 4.1) ------------------------------------
    "merchandise levels map by depth, not by field name":
        (sp["sap_department"], sp["sap_category"], sp["sap_subcategory"], sp["sap_segment"])
        == ("FRESH PROD", "VEGETABLES/SALAD", "SWEET POTATOES", "LOOSE"),
    "the extra middle level goes to sap_family instead of shifting the rest":
        sp["sap_family"] == "POTATOES" and woolies_row["sap_family"] == "",
    "the online hierarchy is mapped by depth too — Coles names it upside down":
        (sp["dept_name"], sp["category_name"], sp["subcategory_name"])
        == ("Fruit & Vegetables", "Vegetables", "Potatoes"),
    "online node ids are captured, which the Woolworths feed cannot give":
        (sp["dept_node_id"], sp["category_node_id"], sp["subcategory_node_id"])
        == ("2100", "1303", "545475"),
    "organic is detected from the name and the hierarchy":
        by["1039770"]["is_organic"] is True and sp["is_organic"] is False,

    # --- size and unit price --------------------------------------------------
    "'approx. 500g' is a variable-weight half-kilo":
        sp["net_size_value"] == 0.5 and sp["net_size_uom"] == "kg"
        and sp["is_variable_weight"] is True and sp["sold_by"] == "weight",
    "'1 Each' parses — it used to fall through to PACK_SIZE_UNPARSED":
        "PACK_SIZE_UNPARSED" not in avo["parse_warnings"]
        and avo["net_size_value"] == 1 and avo["net_size_uom"] == "ea"
        and avo["sold_by"] == "each",
    "no fixture fails to parse its size":
        not any("PACK_SIZE_UNPARSED" in r["parse_warnings"] for r in rows),
    "the comparable string wins over unit.ofMeasureUnits, which disagrees with it":
        sp["unit_price_measure"] == "1kg" and sp["price_per_kg_aud"] == 3.5,
    "a 2-pack priced per-each is not divided twice":
        lettuce["units_per_pack"] == 2 and lettuce["price_per_each_aud"] == 1.5
        and "CUP_PRICE_MISMATCH" not in lettuce["parse_warnings"],
    "derived and published unit prices agree across every fixture":
        not any("CUP_PRICE_MISMATCH" in r["parse_warnings"] for r in rows),

    # --- price and promotions -------------------------------------------------
    "was: 0 means 'no previous price', never $0.00":
        all(r["was_price_aud"] is None for r in rows)
        and all(r["savings_aud"] is None for r in rows),
    "a multibuy is flagged as a promotion but not as a markdown":
        straw["is_on_special"] is True and straw["was_price_aud"] is None
        and "PROMO_MULTIBUY" in straw["parse_warnings"],
    "the multibuy's own unit price is NOT what we publish":
        straw["price_per_kg_aud"] == 12.0,  # $12.00/kg single, not the $9.60/kg multibuy
    "the promotion's terms are kept verbatim":
        straw["promo_text"] == "Buy 2 for $4.80",
    "a line with no promotion is not on special":
        avo["is_on_special"] is False and avo["promo_text"] == "",

    # --- availability ---------------------------------------------------------
    "an out-of-stock line keeps its price but is not buyable":
        blue["price_aud"] == 3.3 and blue["is_in_stock"] is False
        and blue["is_purchasable"] is False and blue["availability_status"] == "OutOfStock",
    "an in-stock line is buyable":
        sp["is_purchasable"] is True and sp["availability_status"] == "InStock",

    # --- the GTIN blocker, made visible in the data ---------------------------
    "every Coles row is flagged as unjoinable on GTIN":
        all(r["gtin"] == "" and "MISSING_GTIN" in r["parse_warnings"] for r in rows),
    "Woolworths still carries its barcode":
        woolies_row["gtin"] == "0264011000002",

    # --- provenance -----------------------------------------------------------
    "Coles has no marketplace tier to skip":
        all(r["is_market_product"] is False for r in rows)
        and coles.is_skipped(SWEET_POTATO) is False,
    "an unsponsored tile is not flagged":
        all(r["is_sponsored"] is False for r in rows),
    "a promoted tile is flagged, and kept":
        coles.is_sponsored({"adId": "abc"}) is True,
    "basket_item_id is always empty — L2 owns it":
        all(r["basket_item_id"] == "" for r in rows),
}

print("\nCHECKS:")
ok = True
for name, passed in checks.items():
    print(f"  {'PASS' if passed else 'FAIL'}  {name}")
    ok = ok and passed

# Not a pass/fail assertion — a standing note, printed so it cannot be
# forgotten. Coles' hierarchy is not uniformly one level deeper than
# Woolworths': SWEET POTATOES lines up with SWEET POTATO, but BERRIES is
# coarser than Woolworths' STRAWBERRY/BLUEBERRY. sap_subcategory is each
# retailer's own taxonomy, faithfully recorded; cross-retailer comparison goes
# through spec section 8 matching, never through sap_subcategory equality.
print("\nGRAIN NOTE (not a failure):")
for r in (sp, straw, blue):
    print(f"  {r['product_name']:<22} sap_subcategory={r['sap_subcategory']:<16} "
          f"sap_segment={r['sap_segment']}")

sys.exit(0 if ok else 1)
