"""Pins taxonomy.py against the subcategories both retailers actually publish.

    python infra/terraform/lambda/category_crawler/taxonomy_test.py

Offline. The fixtures below are the complete distinct `sap_subcategory` sets
from the 2026-09-04 captures — 43 at Woolworths, 87 at Coles. Every one must
resolve, because an unmapped subcategory is silently missing produce: its rows
are in the raw CSV but absent from any comparison.

The ordering checks are the ones worth keeping. Every rule in taxonomy.py's
first block exists because a broader rule below it swallowed a real string, and
those collisions come back the moment someone appends a rule to the end of the
table instead of thinking about where it goes.

The second half pins tier 2 — the product-name fallback — the same way: every
NAME_TRAP below is a real row that an earlier draft of the matcher filed wrong,
and every TIER_PRECEDENCE pair is a place where the two tiers disagree and the
subcategory has to win.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import produce_lexicon  # noqa: E402
from taxonomy import (  # noqa: E402
    GROUPS, SOURCE_PRODUCT_NAME, SOURCE_SUBCATEGORY, VAGUE_GROUPS,
    classify, classify_product, classify_row, is_produce,
)

WOOLWORTHS = [
    "APPLE", "ASPARAGUS", "AVOCADOS", "BANANA", "BLUEBERRY", "BRASSICA VEG",
    "CAPSICUM", "CARROT", "CELERY", "CHILLIES", "CITRUS", "CONDIMENTS & HERBS",
    "CONTINENTAL VEG", "CUCUMBER", "FRESH DATES", "GARLIC", "GINGER", "GRAPES",
    "HERB", "LEAFY VEG", "LETTUCE", "MANDARIN", "MANGOES", "MELONS", "MUSHROOM",
    "ONION", "ORGANICS", "PEAR", "PEAS / BEANS", "POTATO", "PUMPKIN",
    "READY MEALS PRE PACKED", "ROOT VEG (INC OTHERS)", "RUBUS AND OTHER BERRY",
    "SALAD", "STRAWBERRY", "SWEET CORN", "SWEET POTATO", "TOMATO",
    "TROPICAL FRUIT", "VALUE ADD FRUIT", "VALUE ADD VEG", "ZUCCHINI",
]

COLES = [
    "ALMONDS", "APPLES", "ASIAN VEGETABLES", "ASPARAGUS", "AVOCADOS",
    "BABY BROCCOLI", "BABY POTATOES", "BEANS", "BERRIES", "BLACK GRAPES",
    "BRAZIL", "BROCCOLI", "BROWN MUSHROOMS", "BRUSHED POTATOES",
    "BRUSSEL SPROUTS", "BUNCH", "CABBAGE", "CAPSICUMS", "CARROTS", "CASHEWS",
    "CAULIFLOWER", "CELERY", "CHILLIES", "CHRISTMAS", "COCONUTS", "CUCUMBERS",
    "DATES", "DECORATIVE LETTUCE", "DELI - STYLE SALAD", "DRIED FRUIT",
    "EGGPLANT", "EXOTIC MUSHROOMS", "FLORAL", "FRUIT", "FRUITS", "GARLIC",
    "GINGER", "GRAPEFRUIT", "HERBS", "IM PERFECT CITRUS", "KIWI FRUIT", "LEAF",
    "LEEKS", "LEMONS", "LIMES", "MACADAMIA", "MANDARINS", "MELONS", "MIXED",
    "MIXED FRUIT & NUT", "NATOORA", "ONION", "ORANGES", "OTHER CITRUS", "PAPAW",
    "PASSIONFRUIT", "PEANUTS", "PEARS", "PEAS", "PECAN", "PINEAPPLES",
    "PISTACHIO", "PRE PACK BANANAS", "PREPACKED GRAPES", "PREPARED VEGETABLES",
    "PUMPKIN", "RED GRAPES", "RED POTATOES", "REGULAR BANANAS", "ROOT VEG",
    "SALADS", "SAUCES", "SNACKS", "SOFT DRIED FRUIT", "SPROUTS",
    "SWEET POTATOES", "SWEETCORN", "TOMATOES", "TOMATOES P/P", "TROPICALS",
    "VALUE ADDED", "VEGETABLES", "WALNUTS", "WASHED POTATOES", "WHITE GRAPES",
    "WHITE MUSHROOMS", "ZUCCHINI",
]

# The collisions. Each pair is (subcategory, group it must NOT land in) and each
# one was produced by an earlier draft of the rule table.
TRAPS = [
    ("PINEAPPLES", "apples"),          # APPLE matches inside PINEAPPLES
    ("SWEET POTATOES", "potatoes"),    # POTATO matches inside SWEET POTATOES
    ("GRAPEFRUIT", "grapes"),          # GRAPE matches inside GRAPEFRUIT
    ("GRAPEFRUIT", "unclassified-fruit"),
    ("BRUSSEL SPROUTS", "leafy-greens"),  # SPROUT
    ("PEANUTS", "peas-beans"),         # PEA matches inside PEANUTS
    ("COCONUTS", "nuts"),              # NUT inside COCONUTS
    ("KIWI FRUIT", "unclassified-fruit"),
    ("DRIED FRUIT", "unclassified-fruit"),
    ("MIXED FRUIT & NUT", "unclassified"),
    ("PREPARED VEGETABLES", "unclassified-veg"),
    ("ASIAN VEGETABLES", "unclassified-veg"),
    ("VALUE ADD FRUIT", "unclassified-fruit"),
    ("VALUE ADD VEG", "unclassified-veg"),
    ("SOFT DRIED FRUIT", "unclassified-fruit"),
]

# Both retailers' names for one thing must land on one group. This is the entire
# point of the module — if any of these split, the two series stop being
# joinable and nothing else in the file matters.
CONVERGE = [
    ("POTATO", "WASHED POTATOES"),
    ("POTATO", "BABY POTATOES"),
    ("SWEET POTATO", "SWEET POTATOES"),
    ("CITRUS", "LEMONS"),
    ("CITRUS", "GRAPEFRUIT"),
    ("BLUEBERRY", "BERRIES"),
    ("RUBUS AND OTHER BERRY", "BERRIES"),
    ("STRAWBERRY", "BERRIES"),
    ("BRASSICA VEG", "CAULIFLOWER"),
    ("BRASSICA VEG", "BRUSSEL SPROUTS"),
    ("MUSHROOM", "EXOTIC MUSHROOMS"),
    ("GRAPES", "BLACK GRAPES"),
    ("BANANA", "PRE PACK BANANAS"),
    ("TOMATO", "TOMATOES P/P"),
    ("CONDIMENTS & HERBS", "HERBS"),
    ("PEAS / BEANS", "PEAS"),
    ("PEAS / BEANS", "BEANS"),
    ("TROPICAL FRUIT", "KIWI FRUIT"),
    ("TROPICAL FRUIT", "PINEAPPLES"),
    ("CONTINENTAL VEG", "EGGPLANT"),
    ("LEAFY VEG", "SPROUTS"),
    ("LETTUCE", "DECORATIVE LETTUCE"),
    ("SWEET CORN", "SWEETCORN"),
    ("FRESH DATES", "DATES"),
    ("ROOT VEG (INC OTHERS)", "ROOT VEG"),
    ("SALAD", "DELI - STYLE SALAD"),
    ("VALUE ADD VEG", "PREPARED VEGETABLES"),
]

NOT_PRODUCE = [
    "ALMONDS", "WALNUTS", "MIXED FRUIT & NUT", "DRIED FRUIT", "SOFT DRIED FRUIT",
    "SNACKS", "SAUCES", "FLORAL", "CHRISTMAS",
]

# Produce, but the retailer's bucket does not say which kind. Must NOT be
# claimed as produce: an unnamed item cannot enter a per-type comparison.
UNCLASSIFIED = ["FRUIT", "FRUITS", "VEGETABLES", "MIXED", "BUNCH", "NATOORA", "ORGANICS"]

# Salads changed kind on 2026-09-12: a salad kit is labour and packaging, not
# a lettuce price. The group survives so the series stays readable.
SALAD_BUCKETS = ["SALAD", "SALADS", "DELI - STYLE SALAD"]

# ------------------------------------------------------------------ tier 2

# (product name, group it must NOT land in). Every one is a live row that an
# earlier draft of classify_product filed exactly there.
NAME_TRAPS = [
    ("Potato Salad", "potatoes"),                     # veto must run first
    ("Apple Slices", "apples"),
    ("Dressings Berry Balsamic", "berries"),          # kind beats length
    ("Macro Organic Sweet Potato", "mixed"),          # span consumption
    ("Organic Silver Beet", "root-veg"),              # SILVER BEET eats BEET
    ("Cherry Tomatoes", "stone-fruit"),               # needs the e? in (?:e?s)?
    ("Perino Red Grape Tomatoes", "grapes"),
    ("Herb Punnets Lemon Thyme", "citrus"),
    ("Cut Fruit Pineapple", "tropical-fruit"),        # CUT FRUIT is a veto
    ("Fruit & Nut Trail Mix", "nuts"),
    ("Bunch Chrysanthemum White", "unclassified"),
]

# (product name, group it must land in). The rescues — rows tier 1 could not
# place that the name resolves. Each appears under a VAGUE bucket in the
# 2026-09-04 captures.
NAME_RESOLVES = [
    ("Zucchini", "zucchini"),
    ("Spring Onions", "onions"),
    ("Chives Bunch", "herbs"),
    ("Woolworths Whole Fresh Beetroot", "root-veg"),
    ("Woolworths Baby Leaf Spinach", "leafy-greens"),
    ("Watermelon", "melons"),
    ("Macro Organic Sweet Potato", "sweet-potatoes"),
    ("Organic Pak Choy Baby", "continental-veg"),
    ("Baby Cos Lettuce", "lettuce"),                  # 3-letter term, kept
    ("Medjool Dates", "dates"),
    ("Mixed Nuts Dry Roasted Mixed Nuts", "nuts"),
    ("Diced Melon & Pineapple Mix", "prepared"),      # DICED vetoes
    ("Butternut Pumpkin Cut", "pumpkin"),             # bare CUT does not
    ("Carrot Snacking", "carrots"),                   # SNACKING is not SNACK
    ("Macro Organic Fresh Carrot Juicing Bag", "carrots"),  # JUICING != JUICE
]

# (subcategory, product name, expected group, expected source). The contract:
# a specific bucket stands even against a name that says otherwise; a vague
# bucket defers to the name; a vague bucket with an unreadable name stays
# honestly vague.
TIER_PRECEDENCE = [
    ("HERBS", "Garlic Peeled", "herbs", SOURCE_SUBCATEGORY),
    ("HERBS", "Ginger", "herbs", SOURCE_SUBCATEGORY),
    ("LEAF", "Asian Choy Sum", "leafy-greens", SOURCE_SUBCATEGORY),
    ("TOMATOES P/P", "Cherry Tomatoes", "tomatoes", SOURCE_SUBCATEGORY),
    ("VEGETABLES", "Zucchini", "zucchini", SOURCE_PRODUCT_NAME),
    ("BUNCH", "Spring Onions", "onions", SOURCE_PRODUCT_NAME),
    ("NATOORA", "Unwaxed Blood Oranges", "citrus", SOURCE_PRODUCT_NAME),
    ("ORGANICS", "Macro Organic Avocado", "avocados", SOURCE_PRODUCT_NAME),
    ("SALAD", "Woolworths Whole Fresh Beetroot", "root-veg", SOURCE_PRODUCT_NAME),
    # Same kind both ways -> the retailer's bucket is the better group.
    ("SALAD", "Potato Salad", "salads", SOURCE_SUBCATEGORY),
    ("SALADS", "Caesar Salad Kit", "salads", SOURCE_SUBCATEGORY),
    # Name has nothing to say -> tier-1 verdict, untouched.
    ("VEGETABLES", "Xyzzy", "unclassified-veg", SOURCE_SUBCATEGORY),
    # Unseen bucket, readable name -> rescued, and still reported as unmapped
    # by the caller (cheapest.py keeps its own list).
    ("DRAGONFRUIT XYZ", "Dragonfruit", "tropical-fruit", SOURCE_PRODUCT_NAME),
]

checks = {}

unmapped = [s for s in WOOLWORTHS + COLES if classify(s)[1] == "unmapped"]
checks["every published subcategory resolves"] = not unmapped
if unmapped:
    print("  UNMAPPED:", unmapped)

bad_group = [s for s in WOOLWORTHS + COLES if classify(s)[0] and classify(s)[0] not in GROUPS]
checks["every rule points at a declared group"] = not bad_group

trapped = [(s, g) for s, g in TRAPS if classify(s)[0] == g]
checks["no rule swallows a string meant for another"] = not trapped
if trapped:
    print("  COLLIDED:", trapped)

split = [(w, c, classify(w)[0], classify(c)[0])
         for w, c in CONVERGE if classify(w)[0] != classify(c)[0]]
checks["both retailers' names land on one group"] = not split
if split:
    print("  SPLIT:", split)

checks["nuts, flowers and sauces are not produce"] = all(
    classify(s)[1] == "non_produce" for s in NOT_PRODUCE
)
checks["catch-all buckets are not claimed as produce"] = all(
    classify(s)[1] == "unclassified" and not is_produce(s) for s in UNCLASSIFIED
)
checks["prepared lines are their own kind"] = all(
    classify(s) == ("prepared", "prepared")
    for s in ("VALUE ADD VEG", "READY MEALS PRE PACKED", "PREPARED VEGETABLES", "VALUE ADDED")
)
checks["an unknown subcategory is reported, not guessed"] = classify("DRAGONFRUIT XYZ") == ("", "unmapped")
checks["an empty subcategory is unmapped"] = classify("")[1] == "unmapped" and classify(None)[1] == "unmapped"
checks["classification is case-insensitive"] = (
    classify("washed potatoes") == classify("WASHED POTATOES")
)

checks["salads are prepared, and still their own group"] = all(
    classify(s) == ("salads", "prepared") and not is_produce(s)
    for s in SALAD_BUCKETS
)

# ------------------------------------------------------------------ tier 2

lex_problems = produce_lexicon.validate(GROUPS)
checks["lexicon is coherent against GROUPS"] = not lex_problems
if lex_problems:
    for p in lex_problems:
        print("  LEXICON:", p)

checks["every vague group is a declared group"] = VAGUE_GROUPS <= set(GROUPS)
checks["no vague group is produce"] = all(GROUPS[g] != "produce" for g in VAGUE_GROUPS)

name_trapped = [(n, g) for n, g in NAME_TRAPS if classify_product(n)[0] == g]
checks["no product name lands in a group it was measured to collide with"] = not name_trapped
if name_trapped:
    print("  NAME COLLIDED:", name_trapped)

name_missed = [(n, g, classify_product(n)[0]) for n, g in NAME_RESOLVES if classify_product(n)[0] != g]
checks["every measured rescue still resolves"] = not name_missed
if name_missed:
    print("  NAME MISSED:", name_missed)

tier_wrong = [
    (s, n, classify_row(s, n)) for s, n, g, src in TIER_PRECEDENCE
    if classify_row(s, n)[0] != g or classify_row(s, n)[2] != src
]
checks["a specific bucket beats the name; a vague one defers to it"] = not tier_wrong
if tier_wrong:
    print("  TIER WRONG:", tier_wrong)

checks["classify_row never invents a source"] = all(
    classify_row(s, n)[2] in (SOURCE_SUBCATEGORY, SOURCE_PRODUCT_NAME)
    for s, n, _, _ in TIER_PRECEDENCE
)
checks["an empty product name is unmapped, not an error"] = (
    classify_product("")[1] == "unmapped" and classify_product(None)[1] == "unmapped"
)
checks["name classification is case-insensitive"] = (
    classify_product("ZUCCHINI") == classify_product("zucchini")
)

# The coverage number this exists to protect: how much of each file can enter a
# per-type comparison at all.
w_prod = sum(1 for s in WOOLWORTHS if is_produce(s))
c_prod = sum(1 for s in COLES if is_produce(s))
shared = {classify(s)[0] for s in WOOLWORTHS if is_produce(s)} & {
    classify(s)[0] for s in COLES if is_produce(s)
}
checks["at least 30 produce groups are present at both retailers"] = len(shared) >= 30

print(f"\n  woolworths  {w_prod}/{len(WOOLWORTHS)} subcategories are produce")
print(f"  coles       {c_prod}/{len(COLES)} subcategories are produce")
print(f"  groups present at BOTH retailers: {len(shared)}")
print(f"  ({', '.join(sorted(shared))})")

print("\nCHECKS:")
ok = True
for name, passed in checks.items():
    print(f"  {'PASS' if passed else 'FAIL'}  {name}")
    ok = ok and passed
sys.exit(0 if ok else 1)
