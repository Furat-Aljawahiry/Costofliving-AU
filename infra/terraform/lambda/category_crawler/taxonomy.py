"""Map a retailer's `sap_subcategory` onto one canonical produce group.

The problem this solves, measured on the 2026-09-04 captures: Woolworths files
Fruit & Veg under 43 subcategories, Coles under 87, and only **10 of them share
a name**. The rest are the same produce described at different grain —

    woolworths  POTATO            coles  BRUSHED POTATOES / WASHED POTATOES
                                         RED POTATOES / BABY POTATOES
    woolworths  CITRUS            coles  LEMONS / LIMES / ORANGES /
                                         GRAPEFRUIT / OTHER CITRUS
    woolworths  BLUEBERRY         coles  BERRIES
                RUBUS AND OTHER BERRY
                STRAWBERRY

— so "who is cheaper on potatoes" cannot be answered by joining on the
subcategory name. This module is the join: both retailers map INTO a shared
vocabulary rather than one retailer's names being treated as canonical, because
the mapping is many-to-many in both directions (Coles splits potatoes four ways;
Woolworths splits berries three ways) and picking a side would force the other
retailer's distinctions to be thrown away.

TWO TIERS, STRICT ORDER
-----------------------
Tier 1 reads the SUBCATEGORY. A subcategory is the retailer's own classification
of its own product — stable, low-cardinality, and wrong only when the retailer
is wrong. It is the primary signal and it wins whenever it is specific.

Tier 2 reads the PRODUCT NAME, and fires ONLY when tier 1 has admitted it does
not know. Measured on the 2026-09-04 captures, 131 of 953 rows (13.7%) land in
a bucket that names the department, a brand, or an attribute rather than the
item — Coles VEGETABLES / FRUIT / BUNCH / NATOORA, Woolworths ORGANICS — and
every one of them carries a name that says plainly what it is:

    VEGETABLES | Zucchini          BUNCH | Spring Onions
    NATOORA    | Chives Bunch      SALAD | Whole Fresh Beetroot

Tier 2 is a FALLBACK and not a second opinion. Where a specific subcategory and
the name disagree (Coles files garlic and ginger under HERBS), the subcategory
stands and the disagreement is not acted on. A product name is marketing copy —
matched without that restraint it files `Potato Salad` under potatoes with total
confidence, which is worse than not knowing. The vocabulary and the traps that
shaped it live in produce_lexicon.py; `classify_product` is the matcher;
`VAGUE_GROUPS` is the whole contract between the tiers.

Standard library only. Imported by cheapest.py, so both the Lambda and the local
CLI classify identically.
"""

from __future__ import annotations

import re

import produce_lexicon as lex

# What a group IS, which decides whether it belongs in a produce price index:
#
#   produce       a real fruit or vegetable type — the thing being indexed
#   prepared      value-added / ready-to-eat. Real food, different series: a
#                 salad kit tracks packaging and labour as much as produce
#   non_produce   in the retailer's Fruit & Veg browse node but not produce —
#                 nuts, sauces, flowers. Excluding these is the whole reason
#                 the kind field exists
#   unclassified  genuinely produce, but the retailer's own bucket does not say
#                 which kind. Not an error; a known limit, and counted
KINDS = {
    "produce": "produce",
    "prepared": "prepared",
    "non_produce": "non_produce",
    "unclassified": "unclassified",
}

GROUPS = {
    # -------------------------------------------------------- produce
    "apples": "produce",
    "asparagus": "produce",
    "avocados": "produce",
    "bananas": "produce",
    "berries": "produce",
    "brassicas": "produce",
    "capsicums": "produce",
    "carrots": "produce",
    "celery": "produce",
    "chillies": "produce",
    "citrus": "produce",
    "continental-veg": "produce",
    "cucumbers": "produce",
    "dates": "produce",
    "garlic": "produce",
    "ginger": "produce",
    "grapes": "produce",
    "herbs": "produce",
    "leafy-greens": "produce",
    "lettuce": "produce",
    "mandarins": "produce",
    "mangoes": "produce",
    "melons": "produce",
    "mushrooms": "produce",
    "onions": "produce",
    "pears": "produce",
    "peas-beans": "produce",
    "potatoes": "produce",
    "pumpkin": "produce",
    "rhubarb": "produce",
    "root-veg": "produce",
    "stone-fruit": "produce",
    "sweet-corn": "produce",
    "sweet-potatoes": "produce",
    "tomatoes": "produce",
    "tropical-fruit": "produce",
    "zucchini": "produce",
    # -------------------------------------------------------- prepared
    "prepared": "prepared",
    # Was `produce` until 2026-09-12. Of the 101 rows under SALAD / SALADS /
    # DELI - STYLE SALAD, 90 are Caesar Salad Kit, Pasta Salad, Coleslaw — a
    # salad tracks labour and packaging, not the lettuce price. The GROUP is
    # kept so salad prices stay visible as their own series; only the kind
    # changes, which is what removes them from the produce index. The other 11
    # (bagged Baby Leaf Spinach, Whole Fresh Beetroot) are plain produce
    # Woolworths happens to file under SALAD, and tier 2 recovers them —
    # see VAGUE_GROUPS.
    "salads": "prepared",
    # A name that lists two different produce groups: `Diced Melon & Pineapple
    # Mix`. Not unclassified — we know exactly what it is, and it is not one
    # series. Only tier 2 produces this verdict.
    "mixed": "prepared",
    # -------------------------------------------------------- not produce
    "nuts": "non_produce",
    "dried-fruit": "non_produce",
    "snacks": "non_produce",
    "sauces": "non_produce",
    "floral": "non_produce",
    "seasonal": "non_produce",
    # -------------------------------------------------------- known unknowns
    # Woolworths files 60 rows under ORGANICS — an attribute, not a produce
    # type. Its own group rather than a guess: those rows carry is_organic and
    # cheapest.py excludes them anyway (spec 8.2), so misfiling them as, say,
    # salads would corrupt a series for no gain.
    "organics": "unclassified",
    # Coles catch-alls: real produce, but the bucket names the department, not
    # the item. VEGETABLES (31 rows), FRUIT + FRUITS (17), LEAF (20), SNACKS…
    "unclassified-fruit": "unclassified",
    "unclassified-veg": "unclassified",
    "unclassified": "unclassified",
}

# Ordered. FIRST MATCH WINS, and the order is load-bearing — every rule in the
# first block exists because a later, broader rule would otherwise swallow it.
# Adding a rule means deciding where it goes, not appending to the end.
RULES: list[tuple[str, str]] = [
    # ---------------------------------------------------------------- traps
    # Each of these is a real collision observed in the two live files.
    (r"SWEET\s*POTATO", "sweet-potatoes"),          # before POTATO
    (r"SWEET\s*CORN", "sweet-corn"),
    (r"BRUSSEL", "brassicas"),                      # before SPROUT -> leafy
    (r"ALMOND|BRAZIL|CASHEW|MACADAMIA|PEANUT|PECAN"
     r"|PISTACHIO|WALNUT|HAZELNUT|&\s*NUT", "nuts"),  # PEANUT before PEA
    (r"DRIED\s+FRUIT", "dried-fruit"),              # before FRUIT catch-all
    (r"\bKIWI\b", "tropical-fruit"),                # before FRUIT catch-all
    (r"VALUE\s*ADD|READY\s+MEAL|PREPARED\s+VEG", "prepared"),  # before VEG/FRUIT
    (r"ASIAN\s+VEG", "continental-veg"),            # before VEGETABLES

    # ---------------------------------------------------------------- produce
    # Anchored both ends: unanchored, APPLE matches inside PINEAPPLES and puts
    # Coles' pineapples in the apples series. Measured, not hypothetical.
    (r"\bAPPLES?\b", "apples"),
    (r"ASPARAGUS", "asparagus"),
    (r"AVOCADO", "avocados"),
    (r"BANANA", "bananas"),
    (r"BERR|RUBUS", "berries"),                     # BERRIES/BLUEBERRY/STRAWBERRY
    (r"BRASSICA|BROCCOLI|CABBAGE|CAULIFLOWER", "brassicas"),
    (r"CAPSICUM", "capsicums"),
    (r"CARROT", "carrots"),
    (r"CELERY", "celery"),
    (r"CHILLI", "chillies"),
    # GRAPEFRUIT is citrus, and this rule running before GRAPE is what keeps it
    # out of the grapes series.
    (r"CITRUS|LEMON|LIME|ORANGE|GRAPEFRUIT", "citrus"),
    (r"CUCUMBER", "cucumbers"),
    (r"\bDATES?\b", "dates"),
    (r"GARLIC", "garlic"),
    (r"GINGER", "ginger"),
    (r"GRAPE", "grapes"),
    (r"HERB", "herbs"),                             # incl. CONDIMENTS & HERBS
    (r"LETTUCE", "lettuce"),
    (r"LEAFY\s*VEG|\bLEAF\b|SPROUT", "leafy-greens"),
    (r"MANDARIN", "mandarins"),
    (r"MANGO", "mangoes"),
    (r"MELON", "melons"),
    (r"MUSHROOM", "mushrooms"),
    (r"ONION", "onions"),
    (r"PEAR", "pears"),
    (r"\bPEAS?\b|\bBEANS?\b", "peas-beans"),
    (r"POTATO", "potatoes"),
    (r"PUMPKIN", "pumpkin"),
    (r"ROOT\s*VEG", "root-veg"),
    (r"SALAD", "salads"),
    (r"TOMATO", "tomatoes"),
    (r"TROPICAL|PINEAPPLE|PAPAW|COCONUT|PASSIONFRUIT", "tropical-fruit"),
    (r"EGGPLANT|LEEK|CONTINENTAL\s*VEG", "continental-veg"),
    (r"ZUCCHINI", "zucchini"),

    # ---------------------------------------------------------- not produce
    (r"SNACK", "snacks"),
    (r"SAUCE", "sauces"),
    (r"FLORAL|FLOWER", "floral"),
    (r"CHRISTMAS|EASTER|HALLOWEEN", "seasonal"),

    # ------------------------------------------------------- known unknowns
    (r"ORGANIC", "organics"),
    # Last, and only reached when nothing specific matched. NATOORA is a brand
    # in a taxonomy slot; BUNCH and MIXED describe the packaging.
    (r"\bFRUITS?\b", "unclassified-fruit"),
    (r"\bVEGETABLES?\b|\bVEG\b", "unclassified-veg"),
    (r"\bMIXED\b|\bBUNCH\b|NATOORA", "unclassified"),
]

_COMPILED = [(re.compile(p, re.I), g) for p, g in RULES]

# Returned when no rule matches. NOT an error to swallow: it means the retailer
# introduced a subcategory we have never seen, and every row under it is
# missing from the comparison until someone adds a rule. cheapest.py surfaces
# the offending names in the manifest for exactly that reason.
UNMAPPED = ""
UNMAPPED_KIND = "unmapped"


def classify(subcategory: str) -> tuple[str, str]:
    """`sap_subcategory` -> (canonical_group, kind).

    Retailer-agnostic on purpose: one rule table, both files, so a Woolworths
    POTATO row and a Coles WASHED POTATOES row cannot end up in different groups
    because someone edited one retailer's rules and not the other's.
    """
    s = (subcategory or "").strip()
    if not s:
        return UNMAPPED, UNMAPPED_KIND
    for pattern, group in _COMPILED:
        if pattern.search(s):
            return group, GROUPS[group]
    return UNMAPPED, UNMAPPED_KIND


def is_produce(subcategory: str) -> bool:
    """True only for a real fruit/vegetable type — the index filter.

    Excludes prepared lines, nuts and flowers, and excludes the catch-alls:
    an `unclassified` row is produce we cannot name, which is not the same as
    produce we can compare.
    """
    return classify(subcategory)[1] == "produce"


# ============================================================ tier 2: name

# The tier-1 verdicts that hand off to the product name. This set IS the
# contract between the tiers: a group listed here means "the retailer's bucket
# does not name the item", and nothing else ever triggers tier 2.
#
#   unclassified-*  Coles VEGETABLES / FRUIT / FRUITS — the department
#   unclassified    Coles MIXED / BUNCH / NATOORA — packaging or a brand
#   organics        Woolworths ORGANICS — an attribute, 60 rows
#   salads          holds both `Potato Salad` and `Whole Fresh Beetroot`.
#                   The same test as VEGETABLES: a bucket that cannot tell a
#                   dish from a vegetable is not naming the item
#
# Plus the UNMAPPED sentinel — an unseen subcategory is also not an answer.
VAGUE_GROUPS = frozenset({
    "unclassified-fruit", "unclassified-veg", "unclassified",
    "organics", "salads",
})

# Where a verdict came from. Written into the report so every name-derived
# group is auditable and the fallback's error rate can be measured on its own.
SOURCE_SUBCATEGORY = "subcategory"
SOURCE_PRODUCT_NAME = "product_name"


def _word(phrase: str, plural: bool) -> re.Pattern:
    tail = lex.PLURAL_SUFFIX if plural else ""
    return re.compile(r"\b" + re.escape(phrase) + tail + r"\b", re.I)


# Compiled once at import. Term order is the lexicon's longest-first order and
# is load-bearing — see the span-consumption note on classify_product.
_VETO = [(_word(p, plural=False), p) for p in lex.VETO]
_TERMS = [(_word(t, plural=True), t, g) for t, g in lex.term_index()]
_KIND_RANK = {k: i for i, k in enumerate(lex.KIND_PRECEDENCE)}

_MIXED = "mixed"


def classify_product(product_name: str) -> tuple[str, str]:
    """product name -> (canonical_group, kind), reading the NAME alone.

    Order is everything here, and each step exists because the step below it
    gets a real row wrong on its own:

    1. VETO first. `Potato Salad` names a potato; it is a deli salad. A
       prepared-form phrase ends the match before any produce term is tried.
    2. Longest term first, CONSUMING each matched span before trying shorter
       terms. `Macro Organic Sweet Potato` contains both SWEET POTATO and
       POTATO; without consumption that reads as two groups and the row is
       thrown out as a mix. 24 rows were lost that way before the fix.
    3. Kind beats length. `Dressings Berry Balsamic` has BERRY (5) and
       DRESSINGS (9) — fine — but `Strawberry Dressing` has STRAWBERRY (10)
       beating DRESSING (8). Precedence by kind makes both a dressing.
    4. Two distinct produce groups left standing is a mix, not a coin toss.
    5. Nothing matched is `unmapped`, same sentinel as tier 1, so a caller
       cannot tell a missing term from a missing rule without asking — which
       is the point: both mean "someone needs to add a line".
    """
    name = (product_name or "").strip()
    if not name:
        return UNMAPPED, UNMAPPED_KIND

    for pattern, _ in _VETO:
        if pattern.search(name):
            return "prepared", GROUPS["prepared"]

    hits: list[tuple[str, str]] = []
    work = name
    for pattern, term, group in _TERMS:
        work, n = pattern.subn(" ", work)
        if n:
            hits.append((term, group))
    if not hits:
        return UNMAPPED, UNMAPPED_KIND

    hits.sort(key=lambda h: (_KIND_RANK.get(GROUPS[h[1]], 99), -len(h[0])))
    best_group = hits[0][1]
    best_kind = GROUPS[best_group]
    if best_kind == "produce":
        distinct = {g for _, g in hits if GROUPS[g] == "produce"}
        if len(distinct) > 1:
            return _MIXED, GROUPS[_MIXED]
    return best_group, best_kind


def classify_row(subcategory: str, product_name: str) -> tuple[str, str, str]:
    """(subcategory, product name) -> (canonical_group, kind, source).

    The two-tier orchestration and the only entry point report builders should
    use. Tier 1 stands whenever it is specific. Tier 2 is consulted only when
    tier 1's group is in VAGUE_GROUPS or unmapped, and if tier 2 also has no
    answer the tier-1 verdict is returned unchanged — so an `unclassified`
    stays honestly `unclassified`, and `source` is always the tier whose
    answer you are looking at.

    Tier 2 must also SAY MORE to win. When both tiers agree on the kind, the
    retailer's own bucket is the better group: `SALAD | Potato Salad` is
    (salads, prepared) from tier 1 and (prepared, prepared) from the veto —
    same kind, and `salads` is the one that keeps salad prices readable as a
    series. Only a verdict that changes the kind replaces the bucket.
    """
    group, kind = classify(subcategory)
    if group not in VAGUE_GROUPS and kind != UNMAPPED_KIND:
        return group, kind, SOURCE_SUBCATEGORY

    name_group, name_kind = classify_product(product_name)
    if name_kind == UNMAPPED_KIND or name_kind == kind:
        return group, kind, SOURCE_SUBCATEGORY
    return name_group, name_kind, SOURCE_PRODUCT_NAME
