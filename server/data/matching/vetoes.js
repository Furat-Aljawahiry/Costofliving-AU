// Tokens that mean "this has been done to the produce", so the row is not the
// produce any more.
//
// Ported from produce_lexicon.py's VETO list, reduced to single tokens because
// `parseProduceName` has already split and singularised the name — the Python
// side matches phrases against raw copy, this side matches tokens against a
// parsed itemKey, so "salad kit" and "fruit salad" both arrive here as `salad`.
//
// The point, in the Python header's words: a name matched naively is *actively
// worse* than unclassified, because it files things confidently and wrongly.
//
//   Potato Salad                 -> potatoes  (it is a deli salad)
//   Apple Slices                 -> apples    (ready-to-eat pack)
//   Dressings Berry Balsamic     -> berries   (it is a dressing)
//
// A vetoed row is `prepared`, not `unclassified`: we know exactly what it is,
// and it is not the produce series. It stays captured and browsable; it is only
// excluded from cross-retailer price matching.
//
// VETO runs before the name fallback and never before the Lambda's own column —
// see groupFor().
// Two lists, because the KIND matters as much as the exclusion.
//
// A vetoed row is never matched either way, but `kind` is what the produce views
// filter on: `prepared` rows stay in the fruit & veg range (a salad kit is still
// sold in the aisle), while `non_produce` rows leave it entirely. Putting a
// bouquet of chrysanthemums and a coleslaw in one list meant cut flowers were
// being served as fruit and veg.

// PREPARED — real produce that has been done something to. Still in the aisle,
// still browsable, never matched (a $53/kg basil paste is not a basil price).
export const VETO_PREPARED = new Set([
  // dishes and kits
  'salad', 'slaw', 'coleslaw', 'kaleslaw', 'beetslaw', 'fry', 'meal', 'mash',
  // value-added cut states — ready-to-eat, as opposed to "halved for sale",
  // which is why `half` and `quarter` are NOT here (parseProduceName keeps
  // those in `portion`, and half a cabbage is still cabbage).
  'cut', 'cube', 'slice', 'sliced', 'diced', 'shredded', 'julienne', 'floret',
  'baton', 'chopped', 'crumbed', 'stuffed', 'marinated', 'pickled',
  'chargrilled', 'microwave',
  // dried or processed into a pantry good, priced per 20g rather than per kg
  'dried', 'dry', 'porcini',
  // condiments and pastes
  'paste', 'puree', 'pureed', 'minced', 'blend', 'blended', 'blende',
  'guacamole', 'hummus', 'butter', 'seasoning', 'roll',
  // turned into a liquid — the produce is an ingredient now
  'juice', 'smoothie',
])

// NON-PRODUCE — not fruit or veg at all, however it got into the crawl. Both
// retailers' "Fruit & Vegetables" departments carry these.
export const VETO_NON_PRODUCE = new Set([
  // nuts: 25 rows in the Coles crawl. Safe as single tokens — `butternut`,
  // `japnut` and `coconut` are each one token and never split to `nut`.
  'nut', 'walnut', 'almond', 'cashew', 'peanut', 'macadamia', 'pistachio', 'pecan',
  // confectionery and party food
  'pretzel', 'party', 'chocolate',
  // cut flowers and pot plants
  'bouquet', 'flower', 'chrysanthemum', 'rose', 'orchid', 'calandiva', 'potted',
  // dressings and sauces
  'dressing', 'sauce', 'dip',
])

// Kept for the residual report, unenforced: each has a plain-produce
// counterexample in the live data (`Macro Organic Celery Sticks` is trimmed
// celery; `Organic Mandarins Prepacked` is fruit in a bag).
export const VETO_SOFT = new Set(['stick', 'prepack', 'prepacked', 'kit'])

// Softer than VETO: each has a plain-produce counterexample in the live data
// (`Macro Organic Celery Sticks` is trimmed celery; `Organic Mandarins
// Prepacked` is fruit in a bag), so these are NOT enforced. Kept here so the
// residual-token report can surface them and someone can rule on them one at a
// time — the same stance produce_lexicon.py takes.
