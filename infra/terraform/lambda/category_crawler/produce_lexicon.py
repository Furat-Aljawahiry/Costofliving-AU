"""Vocabulary lists for reading a canonical produce group out of a PRODUCT NAME.

This is the tier-2 half of classification. `taxonomy.py` reads the retailer's
own `sap_subcategory` and is right whenever the retailer bothered to be
specific. It is not always: measured on the 2026-09-04 captures, 131 of 953
rows (13.7%) land in a bucket that names the department rather than the item —

    coles       VEGETABLES (31)  FRUIT (9)  FRUITS (8)  BUNCH (9)
                NATOORA (13, a brand)  MIXED (1)
    woolworths  ORGANICS (60, an attribute)

— and for every one of those the product name says plainly what the item is
(`VEGETABLES | Zucchini`, `BUNCH | Spring Onions`, `NATOORA | Chives Bunch`).
This module is the vocabulary for reading that.

WHY THIS IS A FALLBACK AND NOT THE PRIMARY SIGNAL
-------------------------------------------------
A product name is marketing copy. It carries the item, but also the brand, the
pack format, the cut state and the dish. Matched naively it is actively worse
than `unclassified`, because it files things confidently and wrongly:

    Potato Salad                       -> potatoes   (it is a deli salad)
    Apple Slices                       -> apples     (ready-to-eat pack)
    Dressings Berry Balsamic           -> berries    (it is a dressing)
    Fruit & Nut Trail Mix              -> nuts?      (it is neither, alone)

So the order is load-bearing in a different way than in taxonomy.py: VETO runs
BEFORE TERMS, and a name matching two distinct produce groups is a mix, not a
coin toss. This file is the data; the matcher that runs on it is
`taxonomy.classify_product`, kept there so the Lambda and the local CLI
classify identically.

ON DROPPING SHORT WORDS
-----------------------
The tempting cheap filter — "ignore tokens of three letters or fewer, they are
noise like `The`, `odd`, `&`" — is not safe here. Short tokens in this domain
are disproportionately the *item itself*:

    COS (lettuce)   FIG   PEA   YAM   BOK (choy)   KALE   LIME   CORN
    LEEK   MINT   SAGE   DILL   OKRA   BEAN

`Baby Cos Lettuce` and `Macro Organic Snow Peas` are both in the live data. A
length filter would blind the matcher to exactly the words it needs. It also
buys nothing: ~950 rows against ~400 terms is microseconds either way, so
there is no efficiency to trade recall for. NOISE below is the explicit list
that does the same job precisely.

Standard library only, no imports: these are data.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# 1. TERMS — what the item IS
# ---------------------------------------------------------------------------
# group -> the surface forms that mean it, as they appear in AU retail copy.
#
# Values MUST be groups that taxonomy.GROUPS knows. validate() enforces that.
#
# LONGEST MATCH WINS at match time, and that is what replaces taxonomy.py's
# hand-ordered RULES list. Every collision below is resolved by term length
# alone, so this table can be appended to without thinking about ordering:
#
#     SWEET POTATO (12) beats POTATO (6)          Potatoes Sweet
#     CUSTARD APPLE (13) beats APPLE (5)
#     PINEAPPLE (9)     beats APPLE (5)           Cut Fruit Pineapple
#     GRAPEFRUIT (10)   beats GRAPE (5)
#     LEMONGRASS (10)   beats LEMON (5)
#     BEAN SHOOTS (11)  beats BEAN (4)
#     SILVER BEET (11)  beats BEET (4)
#     CHERRY TOMATO(13) beats CHERRY (6)
#     SPRING ONION (12) beats ONION (5)   (same group, but keeps intent clear)
TERMS: dict[str, list[str]] = {
    # ---------------------------------------------------------------- fruit
    "apples": [
        "apple", "granny smith", "pink lady", "royal gala", "red delicious",
        "golden delicious", "braeburn", "sundowner", "jazz apple",
        "envy apple", "kanzi", "bravo apple", "modi apple",
    ],
    "pears": [
        "pear", "nashi", "packham", "beurre bosc", "corella", "josephine",
    ],
    "bananas": [
        "banana", "cavendish", "lady finger banana", "ducasse",
    ],
    "berries": [
        "berry", "berries", "strawberry", "strawberries", "blueberry",
        "blueberries", "raspberry", "raspberries", "blackberry",
        "blackberries", "mulberry", "boysenberry", "rubus",
    ],
    "citrus": [
        "citrus", "lemon", "meyer lemon", "lime", "orange", "navel",
        "navel orange", "valencia", "blood orange", "cara cara",
        "grapefruit", "tangelo", "pomelo", "cumquat", "kumquat",
    ],
    "mandarins": [
        "mandarin", "imperial mandarin", "afourer", "murcott", "orri",
        "tangerine", "clementine",
    ],
    "grapes": [
        "grape", "grapes", "seedless grapes", "crimson grapes",
        "thompson grapes", "muscat grapes",
    ],
    "melons": [
        "melon", "watermelon", "rockmelon", "honeydew", "cantaloupe",
    ],
    "mangoes": [
        "mango", "kensington pride", "calypso mango", "honey gold mango",
        "r2e2",
    ],
    "avocados": [
        "avocado", "hass", "shepard avocado",
    ],
    "dates": [
        "date", "dates", "medjool",
    ],
    "stone-fruit": [
        "peach", "nectarine", "plum", "apricot", "cherry", "cherries",
        "yellow peach", "white nectarine", "blood plum",
    ],
    "tropical-fruit": [
        "pineapple", "papaya", "pawpaw", "papaw", "coconut", "passionfruit",
        "passion fruit", "kiwi", "kiwifruit", "kiwi fruit", "dragon fruit",
        "dragonfruit", "lychee", "rambutan", "custard apple", "guava",
        "jackfruit", "starfruit", "persimmon", "pomegranate", "fig", "figs",
        "feijoa", "tamarillo", "monstera",
    ],
    "rhubarb": ["rhubarb"],

    # ------------------------------------------------------------ vegetable
    "potatoes": [
        "potato", "potatoes", "brushed potato", "washed potato",
        "kipfler", "desiree", "sebago", "dutch cream", "nicola",
        "royal blue potato", "chat potato", "baby potato",
    ],
    "sweet-potatoes": [
        "sweet potato", "sweet potatoes", "kumara", "orange sweet potato",
        "purple sweet potato", "gold sweet potato",
    ],
    "carrots": [
        "carrot", "carrots", "dutch carrot", "baby carrot", "purple carrot",
    ],
    "onions": [
        "onion", "onions", "spring onion", "brown onion", "red onion",
        "white onion", "spanish onion", "shallot", "eschalot",
        "pickling onion", "salad onion",
    ],
    "brassicas": [
        "broccoli", "broccolini", "baby broccoli", "cauliflower", "cabbage",
        "red cabbage", "savoy cabbage", "wombok", "chinese cabbage",
        "brussels sprout", "brussel sprout", "brussels sprouts",
        "kohlrabi", "gai lan", "chinese broccoli", "romanesco",
    ],
    "leafy-greens": [
        "spinach", "baby spinach", "silverbeet", "silver beet", "chard",
        "rainbow chard", "swiss chard", "kale", "tuscan kale", "cavolo nero",
        "rocket", "wild rocket", "arugula", "watercress", "microgreens",
        "micro greens", "shoots", "bean shoots", "snow pea shoots",
        "alfalfa", "sorrel", "mizuna", "tatsoi", "english spinach",
    ],
    "lettuce": [
        "lettuce", "cos", "cos lettuce", "iceberg", "butter lettuce",
        "oak leaf", "mignonette", "radicchio", "endive", "witlof",
    ],
    "tomatoes": [
        "tomato", "tomatoes", "roma", "roma tomato", "truss tomato",
        "solanato", "oxheart", "medley tomato", "snacking tomato",
        "heirloom tomato", "vine ripened tomato", "perino",
        # Tomatoes named after another fruit — same job as the herbs above.
        # Without these, `Cherry Tomatoes` matches CHERRY (stone-fruit) as
        # well as TOMATO and gets thrown out as a mix; `Grape Tomatoes`
        # lands half in the grape series. Both are live rows.
        "cherry tomato", "grape tomato",
    ],
    "cucumbers": [
        "cucumber", "cucumbers", "lebanese cucumber", "continental cucumber",
        "telegraph cucumber", "qukes",
    ],
    "capsicums": [
        "capsicum", "capsicums", "bell pepper", "red capsicum",
        "green capsicum", "yellow capsicum",
    ],
    "chillies": [
        "chilli", "chillies", "chili", "jalapeno", "habanero", "birds eye",
        "cayenne", "serrano",
    ],
    "zucchini": ["zucchini", "courgette", "zucchini flower"],
    "pumpkin": [
        "pumpkin", "butternut", "kent pumpkin", "jap pumpkin", "japnut",
        "jarrahdale", "golden nugget", "squash", "button squash",
    ],
    "mushrooms": [
        "mushroom", "mushrooms", "swiss brown", "portobello", "shiitake",
        "oyster mushroom", "enoki", "button mushroom", "cup mushroom",
        "flat mushroom",
    ],
    "peas-beans": [
        "pea", "peas", "snow pea", "snow peas", "sugar snap", "snap pea",
        "bean", "beans", "green bean", "green beans", "round beans",
        "broad bean", "butter bean", "edamame", "borlotti",
    ],
    "sweet-corn": [
        "sweet corn", "sweetcorn", "corn", "corn cob", "cobette",
        "corn cobette",
    ],
    "asparagus": ["asparagus"],
    "celery": ["celery", "celery heart"],
    "garlic": ["garlic", "garlic bulb"],
    "ginger": ["ginger", "galangal", "turmeric"],
    "root-veg": [
        "beetroot", "beet", "radish", "daikon", "parsnip", "swede", "turnip",
        "celeriac", "yam", "taro", "cassava", "horseradish", "salsify",
    ],
    "continental-veg": [
        "eggplant", "aubergine", "leek", "fennel", "artichoke", "okra",
        "choy sum", "bok choy", "pak choy", "buk choy", "choy",
        "asian greens", "kang kong", "choko", "chokos",
    ],
    "herbs": [
        "herb", "herbs", "parsley", "continental parsley", "coriander",
        "basil", "mint", "thyme", "rosemary", "sage", "dill", "chives",
        "garlic chives", "oregano", "tarragon", "marjoram", "lemongrass",
        "curry leaf", "bay leaf",
        # Herbs named after a fruit. Each of these exists only to be longer
        # than the fruit inside it, so span consumption eats the whole phrase
        # and CITRUS never sees the `lemon` in `Herb Punnets Lemon Thyme`.
        "lemon thyme", "lemon balm", "lime leaf", "lime leaves",
        "kaffir lime leaf", "lemon verbena",
    ],

    # --------------------------------------------------------- not produce
    "nuts": [
        "almond", "almonds", "cashew", "cashews", "macadamia", "macadamias",
        "pecan", "pecans", "walnut", "walnuts", "pistachio", "pistachios",
        "hazelnut", "hazelnuts", "brazil nut", "brazil nuts", "peanut",
        "peanuts", "pine nut", "chestnut", "mixed nuts", "nut mix",
    ],
    "dried-fruit": [
        "sultana", "sultanas", "raisin", "raisins", "currant", "currants",
        "prune", "prunes", "dried apricot", "dried fruit", "craisin",
        "dried mango", "soft dried",
    ],
    "snacks": [
        "trail mix", "party mix", "snack medley", "popcorn", "muesli bar",
        "fruit bar", "snack pack",
    ],
    "sauces": [
        "sauce", "dressing", "dressings", "hummus", "hommus", "dip", "pesto",
        "salsa", "aioli", "vinaigrette",
    ],
    "floral": [
        "flower", "flowers", "bouquet", "chrysanthemum", "rose", "roses",
        "tulip", "tulips", "lily", "lilies", "orchid", "gerbera",
        "carnation", "daffodil", "native flower", "posy",
    ],
    "seasonal": ["christmas", "easter", "halloween", "valentine"],
}

# ---------------------------------------------------------------------------
# 2. VETO — what the item HAS BEEN DONE TO
# ---------------------------------------------------------------------------
# Checked BEFORE TERMS. A hit here ends the match: the row is `prepared`
# regardless of which fruit is named in it, because `Potato Salad` tracks
# labour and packaging, not the potato price.
#
# SCOPE: prepared FORMS ONLY — phrases that describe what was done to some
# produce item and that have no group of their own. Things that simply are not
# produce (a sauce, a bunch of flowers, a trail mix) do NOT belong here: they
# already have groups in TERMS, and KIND_PRECEDENCE below makes those groups
# win over any produce term in the same name. Listing them twice was the
# first version of this file and validate() rejects it, because two lists
# claiming the same phrase is exactly how the two drift apart.
#
# Every entry is a phrase observed in the live captures or its obvious
# variant. Deliberately NOT here, and why — these are the near misses that
# make a bigger veto list worse, not better:
#
#   "cut"       Butternut Pumpkin Cut / Pumpkin Kent Cut / Seedless
#               Watermelon Cut are whole vegetables halved for sale, priced
#               per kg like the whole item. Only the phrase CUT FRUIT (a
#               ready-to-eat pack: `Cut Fruit Pineapple`) is a veto.
#   "half"      Cauliflower Half, Half Papaya, Red Cabbage Half — same.
#   "mix"       Macro Organic Tomato Snacking Mix is still tomatoes. Only
#               the dish phrases (TRAIL MIX, SOUP MIX, STIR FRY MIX) veto.
#   "juicing"   Macro Organic Fresh Carrot Juicing Bag is whole carrots.
#               JUICE vetoes; JUICING does not — so match on word boundaries.
#   "snacking"  Carrot Snacking, Snacking Tomatoes are loose produce.
#               Same reason: SNACK on a boundary, so SNACKING is untouched.
VETO: list[str] = [
    # dishes and kits
    "salad", "salad kit", "slaw", "coleslaw", "kaleslaw", "beetslaw",
    "stir fry", "soup mix", "ready meal", "meal kit", "mash", "veggie mash",
    "roasting vegetables",
    # value-added cut states (ready-to-eat, not "halved for sale")
    "cut fruit", "fruit salad", "slices", "sliced", "diced", "shredded",
    "julienne", "florets", "batons", "crumbed", "microwave bag",
    "stuffed", "marinated", "pickled", "chargrilled",
    # turned into a liquid — the produce is an ingredient now
    "juice", "smoothie",
]

# Kind beats length. A name matching both a produce term and a non-produce or
# prepared one is the non-produce thing: `Dressings Berry Balsamic` is a
# dressing, `Bunch Chrysanthemum White` is flowers, `Fruit & Nut Trail Mix` is
# a trail mix. Length alone gets this right by luck and wrong just as often —
# STRAWBERRY (10) would beat DRESSING (8) and put a salad dressing in the
# berry series. So consumers resolve group collisions on this order first and
# fall back to longest-match only within a tier.
KIND_PRECEDENCE: list[str] = ["prepared", "non_produce", "produce"]

# Softer than VETO: these usually mean value-added, but each has at least one
# plain-produce counterexample in the live data, so they are reported rather
# than enforced until someone rules on them one at a time.
#
#   "sticks"    Carrot Sticks (is_prepared=true) vs Macro Organic Celery
#               Sticks (trimmed celery, arguably just celery)
#   "prepacked" Baby Beetroot Prepacked (is_prepared=true) vs Organic
#               Mandarins Prepacked (plain fruit in a bag)
VETO_SOFT: list[str] = ["sticks", "prepacked", "punnet", "kit"]


# ---------------------------------------------------------------------------
# 3. NOISE — what the name says that is not the item
# ---------------------------------------------------------------------------
# NOT used to rewrite the name before matching. Stripping first would be a
# second place for bugs to live, and longest-match already ignores anything it
# does not recognise. NOISE exists so the matcher can report the *residual*
# tokens of a name it failed to classify: whatever is left after removing
# TERMS and NOISE is either a new produce word to add above, or a new brand to
# add here. That residual report is how these lists grow without guesswork.
NOISE_BRANDS: list[str] = [
    "coles", "woolworths", "woolies", "macro", "natoora", "market lane",
    "coles kitchen", "kitchen", "i'm perfect", "im perfect", "perfect",
    "southern bliss", "the odd bunch", "odd bunch", "harvest", "fresh",
    "australian", "aust", "certified", "select", "essentials",
]

NOISE_PACKAGING: list[str] = [
    "pack", "packs", "prepack", "pre-pack", "prepacked", "punnet", "bag",
    "box", "bunch", "each", "ea", "loose", "net", "tray", "portion",
    "bulk", "value", "family", "selection", "approx", "kg", "g", "ml", "l",
    "piece", "pieces", "share", "sharing",
]

NOISE_DESCRIPTORS: list[str] = [
    "organic", "organics", "mini", "baby", "large", "medium", "small",
    "half", "whole", "big", "juicy", "crisp", "crunchy", "sweet", "seedless",
    "unwaxed", "washed", "brushed", "trimmed", "green", "red", "white",
    "yellow", "purple", "gold", "golden", "black", "brown", "premium",
    "gourmet", "seasonal", "new", "young", "wild", "extra", "classic",
    "style", "grown", "gluten", "free",
]

# Only the genuinely contentless tokens. This is the list that replaces
# "drop anything <= 3 letters" — see the module docstring for why length is
# the wrong test.
NOISE_STOPWORDS: list[str] = [
    "the", "and", "with", "for", "of", "in", "on", "a", "an", "or", "&",
    "per", "plus", "pk",
]

NOISE: list[str] = (
    NOISE_BRANDS + NOISE_PACKAGING + NOISE_DESCRIPTORS + NOISE_STOPWORDS
)


# ---------------------------------------------------------------------------
# 4. PLURALS — write terms SINGULAR, match both
# ---------------------------------------------------------------------------
# Terms above are stored in the singular and matched with this suffix, so
# APPLE catches `Apples`, POTATO catches `Potatoes` and CUCUMBER catches
# `Cucumbers` without either form being listed twice.
#
# The `e?` is not cosmetic. Measured on the captures: with a bare `s?`, the
# term CHERRY TOMATO fails to match the string `Cherry Tomatoes` (it is not
# `tomatos`), CHERRY matches on its own, and every cherry-tomato row in both
# retailers is discarded as a two-group mix. Six rows, one missing character.
PLURAL_SUFFIX = r"(?:e?s)?"

# Plurals this suffix cannot build, so they stay written out in TERMS above:
#
#   y -> ies    berry/berries  cherry/cherries  lily/lilies
#   f -> ves    leaf/leaves
#
# Everything else listed in both forms is merely redundant, not wrong.
# validate() reports those so the tables stay honest about which entries are
# load-bearing.
IRREGULAR_PLURALS: dict[str, str] = {
    "berry": "berries",
    "cherry": "cherries",
    "lily": "lilies",
    "leaf": "leaves",
}


# ---------------------------------------------------------------------------
# Derived views + integrity checks
# ---------------------------------------------------------------------------

def term_index() -> list[tuple[str, str]]:
    """Every (term, group) pair, LONGEST TERM FIRST.

    The sort is the whole disambiguation strategy: consumers scan this list in
    order, so SWEET POTATO is tested before POTATO and PINEAPPLE before APPLE
    without anyone maintaining a rule order.

    CONSUMERS MUST CONSUME THE MATCHED SPAN. Scanning longest-first is only
    half of it — a matcher that collects every hit and moves on will find both
    SWEET POTATO and POTATO in `Macro Organic Sweet Potato`, read that as two
    produce groups, and discard a plain sweet potato as an unclassifiable mix.
    Measured before the fix: 24 rows lost that way, including every
    `Sweet Potato`, `Silver Beet`, `Cherry Tomatoes` and `Grape Tomatoes` in
    both captures. Blank out each match before testing shorter terms and the
    multi-group signal goes back to meaning what it should — a name that
    really does list two different vegetables.
    """
    pairs = [(t.lower(), g) for g, terms in TERMS.items() for t in terms]
    return sorted(pairs, key=lambda p: (-len(p[0]), p[0]))


def validate(known_groups: dict[str, str] | None = None) -> list[str]:
    """Return a list of problems, empty when the lists are coherent.

    Catches the three mistakes these tables invite: a term mapped to a group
    that does not exist, the same surface form claimed by two groups (which
    would make the result depend on dict iteration order), and a phrase that
    is both a veto and a produce term.
    """
    problems: list[str] = []

    seen: dict[str, str] = {}
    for group, terms in TERMS.items():
        for t in terms:
            key = t.lower()
            if key in seen and seen[key] != group:
                problems.append(
                    f"term {t!r} claimed by both {seen[key]!r} and {group!r}"
                )
            seen[key] = group

    if known_groups is not None:
        for group in TERMS:
            if group not in known_groups:
                problems.append(f"group {group!r} is not in taxonomy.GROUPS")

    for phrase in VETO:
        if phrase.lower() in seen:
            problems.append(
                f"{phrase!r} is in both VETO and TERMS ({seen[phrase.lower()]})"
            )

    return problems


def redundant_plurals() -> list[str]:
    """Terms listed in both forms that PLURAL_SUFFIX would have covered.

    Not problems — they cost nothing and read fine. Reported separately so
    the difference between "spelled out because the suffix cannot build it"
    (berries, leaves) and "spelled out out of habit" (tomatoes) stays visible.
    """
    all_terms = {t.lower() for terms in TERMS.values() for t in terms}
    irregular = set(IRREGULAR_PLURALS.values())
    return [
        t for t in sorted(all_terms)
        if t.endswith("s")
        and t not in irregular
        and (t[:-1] in all_terms or t[:-2] in all_terms)
    ]


if __name__ == "__main__":
    import taxonomy

    issues = validate(taxonomy.GROUPS)
    idx = term_index()
    print(f"groups          {len(TERMS)}")
    print(f"terms           {len(idx)}")
    print(f"veto / soft     {len(VETO)} / {len(VETO_SOFT)}")
    print(f"noise           {len(NOISE)}")
    print(f"longest term    {idx[0][0]!r}")
    print(f"shortest term   {idx[-1][0]!r}")
    dupes = redundant_plurals()
    print(f"redundant plurals {len(dupes)}: {', '.join(dupes[:8])}"
          f"{' …' if len(dupes) > 8 else ''}")
    if issues:
        print("\nPROBLEMS")
        for p in issues:
            print("  -", p)
    else:
        print("\nlists are coherent")
