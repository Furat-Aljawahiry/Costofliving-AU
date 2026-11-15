// Shelves within an aisle, and the search over them.
//
// /api/items carries `group` — the canonical produce group the server's matcher
// put the item in (server/data/matching/groups.js): one vocabulary across both
// retailers, unlike each retailer's own `subcategory` ("APPLE" at Woolworths,
// "Apples" at Coles, 43 names against 68 that do not line up). That is what
// makes a browsable shelf list possible at all.
//
// LABEL is editorial: a slug a buyer wrote ("brassicas", "continental-veg") is
// not what a shopper calls the shelf. Anything not named here falls back to its
// slug with the dashes read as spaces, so a new group out of the crawler shows
// up readable rather than not at all.
const LABEL = {
  brassicas: "Cabbage & broccoli",
  citrus: "Citrus",
  "continental-veg": "Eggplant, leek & fennel",
  "root-veg": "Root vegetables",
  "leafy-greens": "Leafy greens",
  "peas-beans": "Peas & beans",
  "sweet-corn": "Sweet corn",
  "stone-fruit": "Stone fruit",
  "tropical-fruit": "Tropical fruit",
  "sweet-potatoes": "Sweet potatoes",
  prepared: "Prepared & ready to cook",
  salads: "Salads & bowls",
};

// Words a shopper would type that the shelf's own name does not contain.
// Searching "oranges" has to offer the Citrus shelf, which nothing else spells
// out. These reach the SHELF SUGGESTIONS only, never the item search — see
// itemHaystack.
const ALIASES = {
  citrus: "oranges lemons limes mandarins grapefruit",
  brassicas: "cabbage broccoli broccolini cauliflower kale brussels sprouts wombok",
  "continental-veg": "eggplant aubergine leek fennel",
  "root-veg": "beetroot radish parsnip turnip swede",
  "leafy-greens": "spinach rocket kale watercress silverbeet",
  "peas-beans": "peas beans snow sugar snap",
  "tropical-fruit": "kiwifruit pineapple papaya passionfruit coconut dragonfruit pomegranate mango",
  "stone-fruit": "peaches nectarines plums apricots cherries",
  prepared: "ready cut washed mixed medley",
  salads: "salad bowls kits slaw leaves coleslaw",
  herbs: "basil coriander parsley mint thyme rosemary",
};

export const UNGROUPED = "__other";

/**
 * The shelf an item belongs on.
 *
 * A produce group is already shelf-sized (`apples`, `brassicas`). The other two
 * domains key at the level a PRICE COMPARISON needs, which is far finer than
 * anything you would browse:
 *   meat    `meat:beef:mince`            — 300-odd cuts; the shelf is the species
 *   snacks  `snack:smiths:chips:crinkle` — per brand and flavour; the shelf is the form
 * Taking the segment that is a shelf keeps one browse UI over all three aisles
 * instead of a per-aisle special case. A `snack:` row whose form the parser
 * could not name is a remainder, not a shelf called "unknown".
 */
export function shelfOf(item) {
  const g = item.group;
  if (!g) return UNGROUPED;
  const meat = /^meat:([a-z0-9-]+)/.exec(g);
  if (meat) return meat[1];
  const snack = /^snack:[a-z0-9-]+:([a-z0-9-]+)/.exec(g);
  if (snack) return snack[1] === "unknown" ? UNGROUPED : snack[1];
  return g;
}

export const groupLabel = (g) =>
  g === UNGROUPED ? "Everything else" : LABEL[g] || String(g).replace(/[_-]/g, " ").replace(/^./, (c) => c.toUpperCase());

// Words, lowercased, single-spaced and padded at both ends — so a term can be
// tested against the START OF A WORD with a plain substring check and no regex.
const hay = (parts) => ` ${parts.filter(Boolean).join(" ").toLowerCase().replace(/[^a-z0-9&]+/g, " ").trim()} `;

/**
 * The haystack one item is searched against: its OWN words only.
 *
 * The shelf aliases above deliberately stay out. Put them in and every search
 * widens to the whole shelf — "broccolini" returned all 52 brassicas, red
 * cabbage included. A shopper searching a word wants the lines whose names
 * carry it; the shelf is offered separately, by groupHaystack.
 */
export const itemHaystack = (it) => hay([it.name, it.brand, it.subcategory, it.sap?.subcategory, it.sap?.segment]);

export const groupHaystack = (g) => hay([g, groupLabel(g), ALIASES[g]]);

/**
 * Shelves present in these items, biggest first, with the ungrouped remainder
 * always last — it is a remainder, not a shelf, and sorting it by size would
 * put it at the top (207 of the 917 produce items carry no group).
 */
export function shelvesOf(items) {
  const by = new Map();
  for (const it of items) {
    const g = shelfOf(it);
    if (!by.has(g)) by.set(g, []);
    by.get(g).push(it);
  }
  return [...by.entries()]
    .map(([group, its]) => ({ group, label: groupLabel(group), items: its }))
    .sort((a, b) => (a.group === UNGROUPED) - (b.group === UNGROUPED) || b.items.length - a.items.length || a.label.localeCompare(b.label));
}

// Every word of the query has to land somewhere ("red cabbage", "organic
// lemons"), so a second word narrows rather than widens. A term matches at the
// start of a word only: as a bare substring "apple" found Pineapple and
// "apples" found Applause grapes.
export const matchesQuery = (haystack, terms) => terms.every((forms) => forms.some((f) => haystack.includes(` ${f}`)));

/**
 * The query as terms, each term the forms worth looking for.
 *
 * Shopping words are plural and shelf words are not: "oranges" has to find
 * `Organic Orange Navel`, "tomatoes" the `Tomato Truss`. Dropping the plural is
 * the whole of the stemming — produce names are short and concrete, and
 * anything cleverer would start matching things nobody asked for.
 *
 * The -es rule only fires where English actually spells a plural that way
 * (tomatoes, peaches, boxes). Applied to every -es it took "apples" down to
 * "appl", which then matched `Applause White Grapes`.
 */
export const queryTerms = (q) =>
  String(q || "").toLowerCase().split(/[^a-z0-9&]+/).filter(Boolean).map((t) => {
    const forms = [t];
    if (t.length > 4 && /(?:ch|sh|s|x|z|o)es$/.test(t)) forms.push(t.slice(0, -2));
    else if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) forms.push(t.slice(0, -1));
    return forms;
  });
