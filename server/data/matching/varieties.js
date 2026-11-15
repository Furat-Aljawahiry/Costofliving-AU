// The variety lexicon — the middle layer that makes a cross-retailer match
// specific enough to be a price comparison.
//
// `canonical_group` joins the two retailers already (34 of 35 groups) but is far
// too coarse to compare prices on: "apples" is a group, and Pink Lady at $4.90/kg
// against Kanzi at $9.90/kg is not a price comparison, it is two different fruits.
// `itemKey` is specific enough but too literal to join — measured on the 16 Sep
// captures an exact key intersection reaches only 124 of ~406 items, because each
// retailer decorates the name differently:
//
//   W  Woolworths Jalapeno Chilli Hot        chilli|hot|jalapeno
//   C  Jalapeno Chilli                       chilli|jalapeno
//   W  Mushroom Portobello Flat Large Loose  flat|mushroom|portobello
//   C  Portobello Brown Mushrooms            brown|mushroom|portobello
//
// Note the second pair: neither key contains the other, so subset matching does
// not rescue it either. What both pairs share is a recognisable *variety*
// (jalapeno, portobello) inside a known group, plus decoration that differs.
//
// WHY A LEXICON AND NOT FUZZY MATCHING
// ------------------------------------
// Fuzzy or embedding matching answers "do these two token sets mean the same
// thing?" — unbounded, needs a tuned threshold, and fails *silently* by quietly
// pairing the wrong fruit. A lexicon inverts the question to "which known variety
// does this name contain?" — bounded, because the varieties of apple sold in
// Australia are enumerable, and it fails *loudly* as `variety: null`, which is a
// visible gap on the data-quality page rather than a wrong headline. For a
// solo-maintained project where a bad match becomes a bad press claim, failing
// loudly is worth more than recall.
//
// The shape follows produce_lexicon.py, which is proof this works on this data:
// declarative vocabulary, matched most-specific-first, kept separate from the
// matcher that runs over it.
//
// HOW MATCHING WORKS
// ------------------
// Each entry is `[slug, ...tokens]` and matches when EVERY token is present in
// the product's `itemKey` tokens (plus its brand tokens — Woolworths puts the
// cultivar in the `brand` column: Jazz, Kanzi, Envy, Bravo, Ambrosia).
//
// Two rules decide the winner:
//
//   1. MORE MATCHED TOKENS WINS. So `red-washed` beats both `red` and `washed`
//      for `Potato Red Washed`, and `baby-cos` beats `cos`.
//   2. ON A TIE, EARLIER IN THE LIST WINS. Order within a group is therefore
//      load-bearing and means "most identifying first": a cultivar outranks a
//      shape, and the bare head noun goes LAST as the fallback.
//
// Rule 2 exists because an alphabetical tie-break is not merely arbitrary, it is
// wrong. `Mushroom Portobello Flat Large Loose` matches both `portobello` and
// `flat` on one token each; alphabetically `flat` wins and the cultivar is lost,
// so the Woolworths portobello stops matching the Coles one. Ordering by
// specificity is the same device `PACK_RANK` in produceNames.js already uses.
//
// The bare head noun (`['carrot', 'carrot']`) is a real product — both retailers
// sell plain carrots — so every group whose plain form is sold gets one, last.
// Without it `Macro Organic Carrots` has no variety at all and never matches.
//
// BASE VARIETIES AND THE RESIDUAL RULE
// ------------------------------------
// A base variety (`['carrot', 'carrot']`) is a catch-all, and a catch-all pairs
// unrelated things. Eyeballing the first cut of matched keys found exactly that:
//
//   mushrooms:mushroom   W Mushroom Sliced          <-> C DRIED PORCINI Mushrooms
//   chillies:chilli      W Bird's Eye Chilli Hot    <-> C Red Cayanne Chillies
//   potatoes:potato      W MASHING Potatoes         <-> C ROASTING Potatoes
//
// In each case the name carried a real distinguishing word the lexicon did not
// know, so both sides fell through to the base and met each other there. The
// fix is not to delete base varieties — `Macro Organic Banana` <-> `Organic
// Banana` is a genuine match and needs one — but to refuse the base whenever the
// name has tokens left over that nothing accounted for:
//
//   banana                          residual {}                  -> base OK
//   dried|mushroom|porcini          residual {dried, porcini}     -> REFUSED
//   bird'|chilli|eye|hot            residual {bird', eye, hot}    -> REFUSED
//
// A refusal yields `variety: null`, so the row becomes group-only: browsable,
// never price-compared, and counted in the varietyGaps report as vocabulary to
// add. This is produce_lexicon.py's "residual report" idea used as a guard
// rather than only as a diagnostic.
//
// Nothing here is a guess: every entry below was read off the 16 Sep captures.
// A group with no entry, or a name matching none, yields `variety: null` and a
// `group-only` match — browsable, never price-compared.
import { GROUP_HEAD_TOKENS } from './groups.js'

export const VARIETIES = {
  apples: [
    ['cosmic-crisp', 'cosmic', 'crisp'], ['granny-smith', 'granny', 'smith'],
    ['pink-lady', 'pink', 'lady'], ['golden-delicious', 'golden', 'delicious'],
    ['red-delicious', 'delicious'], ['royal-gala', 'gala'],
    ['jazz', 'jazz'], ['envy', 'envy'], ['kanzi', 'kanzi'], ['bravo', 'bravo'],
    ['ambrosia', 'ambrosia'], ['fuji', 'fuji'], ['sundowner', 'sundowner'],
    ['kids', 'kids'], ['mini', 'mini'], ['apple', 'apple'],
  ],
  pears: [
    ['beurre-bosc', 'bosc'], ['packham', 'packham'], ['corella', 'corella'],
    ['williams', 'williams'], ['green-nashi', 'nashi', 'green'], ['brown-nashi', 'nashi', 'brown'],
    ['nashi', 'nashi'], ['red-angel', 'angel'],
    ['josephine', 'josephine'], ['pear', 'pear'],
  ],
  citrus: [
    ['cara-cara-orange', 'cara_cara'], ['blood-orange', 'blood', 'orange'],
    ['navel-orange', 'navel'], ['valencia-orange', 'valencia'],
    ['juicing-orange', 'juicing', 'orange'], ['blood-lime', 'blood', 'lime'],
    ['ruby-grapefruit', 'ruby'], ['grapefruit', 'grapefruit'],
    ['lemon', 'lemon'], ['lime', 'lime'], ['orange', 'orange'],
  ],
  mandarins: [
    ['afourer', 'afourer'], ['amorette', 'amorette'], ['delite', 'delite'],
    ['murcott', 'murcott'], ['imperial', 'imperial'], ['orri', 'orri'],
    ['tangold', 'tangold'], ['summerina', 'summerina'], ['sumo', 'sumo'],
    ['nugget', 'nugget'], ['mini', 'mini'], ['mandarin', 'mandarin'],
  ],
  potatoes: [
    // Compounds first: a baby washed potato and a washed potato are different
    // products, and both retailers file them apart.
    ['baby-red-washed', 'baby', 'red', 'washed'], ['baby-white-washed', 'baby', 'white', 'washed'],
    ['baby-washed', 'baby', 'washed'], ['red-washed', 'red', 'washed'],
    ['white-washed', 'white', 'washed'], ['baby-brushed', 'baby', 'brushed'],
    ['desiree', 'desiree'], ['kipfler', 'kipfler'], ['sebago', 'sebago'],
    ['kestrel', 'kestrel'], ['carisma', 'carisma'], ['nicola', 'nicola'],
    ['royal-blue', 'royal'], ['creme-gold', 'creme'], ['spud-lite', 'spudlite'],
    ['dutch-cream', 'dutch'], ['brushed', 'brushed'], ['washed', 'washed'],
    ['roasting', 'roasting'], ['mashing', 'mashing'], ['lower-carb', 'carb'],
    ['baby', 'baby'], ['red', 'red'], ['white', 'white'], ['gold', 'gold'],
    ['potato', 'potato'],
  ],
  'sweet-potatoes': [
    ['gold', 'gold'], ['purple', 'purple'], ['white', 'white'], ['red', 'red'],
    ['sweet-potato', 'sweet_potato'],
  ],
  tomatoes: [
    ['cherry-truss', 'cherry', 'truss'], ['cocktail-truss', 'cocktail', 'truss'],
    // Coles writes "Tomatoes Cherry Vine Ripened" and Woolworths "Cherry
    // Tomatoes Loose" (whose raw name also carries `red`). Both are cherry
    // tomatoes; `vine` and `red` here account for those words without making
    // either ignorable everywhere — `vine` is a variety in its own right below,
    // and a bare `Vine Ripened Tomatoes` must keep reaching it.  — 2026-09-29
    ['cherry', 'cherry', 'vine'], ['cherry', 'cherry', 'red'],
    ['cherry', 'cherry'], ['grape', 'grape'],
    ['roma', 'roma'], ['cocktail', 'cocktail'], ['truss', 'truss'], ['solanato', 'solanato'],
    ['heirloom', 'heirloom'], ['gourmet', 'gourmet'], ['medley', 'medley'],
    ['cocktail', 'cocktail'], ['vine', 'vine'], ['tomato', 'tomato'],
  ],
  mushrooms: [
    // Cultivar before shape: `Mushroom Portobello Flat` is a portobello.
    ['portobello', 'portobello'], ['swiss-brown', 'swiss'], ['shiitake', 'shiitake'],
    ['oyster', 'oyster'], ['enoki', 'enoki'], ['button', 'button'],
    ['cup', 'cup'], ['flat', 'flat'], ['exotic', 'exotic'], ['mushroom', 'mushroom'],
  ],
  onions: [
    ['spring', 'spring_onion'], ['shallot', 'shallot'], ['pickling', 'pickling'],
    ['brown', 'brown'], ['red', 'red'], ['white', 'white'], ['onion', 'onion'],
  ],
  carrots: [
    ['baby', 'baby'], ['purple', 'purple'], ['juicing', 'juicing'],
    ['snacking', 'snacking'], ['carrot', 'carrot'],
  ],
  brassicas: [
    ['baby-broccoli', 'baby', 'broccoli'],
    // Mini compounds first: a mini red cabbage is a different head from a red
    // cabbage, and per-each they would otherwise compare directly.
    ['mini-red-cabbage', 'cabbage', 'mini', 'red'],
    ['mini-savoy-cabbage', 'cabbage', 'mini', 'savoy'],
    ['mini-drumhead-cabbage', 'cabbage', 'mini', 'drumhead'],
    ['green-cabbage', 'cabbage', 'green'],
    ['red-cabbage', 'cabbage', 'red'], ['savoy-cabbage', 'cabbage', 'savoy'],
    ['drumhead-cabbage', 'cabbage', 'drumhead'], ['mini-cabbage', 'cabbage', 'mini'],
    ['broccolini', 'broccolini'], ['brussels-sprouts', 'sprout'],
    ['wombok', 'wombok'], ['bok-choy', 'bok_choy'], ['pak-choy', 'pak_choy'],
    ['broccoli', 'broccoli'], ['cauliflower', 'cauliflower'], ['kale', 'kale'],
    ['cabbage', 'cabbage'],
  ],
  capsicums: [
    ['baby', 'baby'], ['mini', 'mini'], ['mixed', 'colour'],
    ['red', 'red'], ['green', 'green'], ['yellow', 'yellow'],
    ['capsicum', 'capsicum'],
  ],
  chillies: [
    ['cayenne-green', 'cayenne', 'green'], ['cayenne-red', 'cayenne', 'red'],
    // (the Coles "Cayanne" misspelling is handled once, in aliases.js)
    ['carolina-reaper', 'reaper'], ['jalapeno', 'jalapeno'],
    ['habanero', 'habanero'], ['birdseye', 'birdseye'], ['birdseye', "bird'", 'eye'],
    ['mixed', 'mixed'], ['chilli', 'chilli'],
  ],
  cucumbers: [
    ['lebanese', 'lebanese'], ['continental', 'continental'],
    ['qukes', 'quke'], ['baby', 'baby'], ['green', 'green'], ['cucumber', 'cucumber'],
  ],
  grapes: [
    ['white-seedless', 'white', 'seedless'], ['red-seedless', 'red', 'seedless'],
    ['black-seedless', 'black', 'seedless'], ['candy-snap', 'candy'],
    ['grape', 'grape'],
  ],
  berries: [
    ['strawberry', 'strawberry'], ['blueberry', 'blueberry'],
    ['raspberry', 'raspberry'], ['blackberry', 'blackberry'],
  ],
  melons: [
    ['rockmelon', 'rockmelon'], ['honeydew', 'honeydew'], ['watermelon', 'watermelon'],
  ],
  avocados: [['hass', 'hass'], ['shepard', 'shepard'], ['avocado', 'avocado']],
  bananas: [
    // `Bananas Kids` is a small-fruit lunchbox line, not a plain Cavendish, so
    // it gets its own variety rather than collapsing into the base.
    ['lady-finger', 'finger'], ['cavendish', 'cavendish'], ['red-tipped', 'tipped'],
    ['kids', 'kids'], ['mini', 'mini'], ['banana', 'banana'],
  ],
  mangoes: [
    ['kensington-pride', 'kensington'], ['calypso', 'calypso'],
    ['honey-gold', 'honey'], ['mango', 'mango'],
  ],
  'stone-fruit': [
    ['peach', 'peach'], ['nectarine', 'nectarine'], ['plum', 'plum'],
    ['apricot', 'apricot'], ['cherry', 'cherry'],
  ],
  'tropical-fruit': [
    ['custard-apple', 'custard'], ['dragonfruit', 'dragonfruit'],
    // Kiwifruit cultivars BEFORE the bare 'kiwifruit': gold and green are
    // different products at different prices, and a 1-token tie goes to
    // whichever entry is listed first.
    // SunGold is Zespri's trademarked gold kiwifruit and Coles sells the same
    // fruit as plain "Gold Kiwifruit", so all three spellings land on one slug.
    // Woolworths writes it two ways — "Sungold Kiwifruit Punnet" (no colour
    // word) and "Zespri SunGold Kiwifruit" (colour AND brand) — which is why
    // there are three entries rather than one.  — 2026-09-29
    ['gold-kiwifruit', 'kiwifruit', 'gold', 'sungold'],
    ['gold-kiwifruit', 'kiwifruit', 'gold'], ['gold-kiwifruit', 'sungold'],
    ['ruby-kiwifruit', 'kiwifruit', 'ruby'], ['green-kiwifruit', 'kiwifruit', 'green'],
    ['pineapple', 'pineapple'], ['kiwifruit', 'kiwifruit'],
    ['panama-passionfruit', 'passionfruit', 'panama'],
    ['passionfruit', 'passionfruit'], ['papaya', 'papaya'], ['pawpaw', 'pawpaw'],
    ['persimmon', 'persimmon'], ['pomegranate', 'pomegranate'],
    // A drinking (young, green) coconut is a different product from a mature
    // one: Coles sells it at $4.50/ea against $5.90/ea for `Coconut Whole`.
    // Two entries, one slug — Woolworths' name carries the colour
    // ("Coco Q Green Drinking Coconut For Drinking") and Coles' does not
    // ("Drinking Coconut"), and listing `green` here accounts for it without
    // making the word ignorable everywhere.  — 2026-09-29
    ['drinking-coconut', 'green', 'drinking', 'coconut'],
    ['drinking-coconut', 'drinking', 'coconut'],
    ['coconut', 'coconut'], ['lychee', 'lychee'], ['fig', 'fig'],
  ],
  lettuce: [
    ['baby-cos', 'baby', 'cos'], ['little-gem', 'gem'], ['oakleaf', 'oakleaf'],
    ['iceberg', 'iceberg'], ['cos', 'cos'], ['oak', 'oak'], ['lettuce', 'lettuce'],
  ],
  'leafy-greens': [
    ['baby-spinach', 'baby', 'spinach'], ['choy-sum', 'choy', 'sum'],
    ['bok-choy', 'buk', 'choy'], ['wombok', 'wombok'],
    ['silverbeet', 'silverbeet'], ['watercress', 'watercress'],
    ['rocket', 'rocket'], ['spinach', 'spinach'], ['kale', 'kale'],
  ],
  'peas-beans': [
    ['snow-pea', 'snow_pea'], ['sugar-snap', 'sugar_snap'],
    ['broad-bean', 'broad'], ['beanette', 'beanette'],
    ['green-bean', 'bean'], ['pea', 'pea'],
  ],
  'root-veg': [
    ['baby-beetroot', 'baby', 'beetroot'], ['parsnip', 'parsnip'],
    ['radish', 'radish'], ['swede', 'swede'], ['turnip', 'turnip'],
    ['celeriac', 'celeriac'], ['beetroot', 'beetroot'],
  ],
  'continental-veg': [
    ['lebanese-eggplant', 'eggplant', 'lebanese'], ['eggplant', 'eggplant'],
    ['fennel', 'fennel'], ['leek', 'leek'], ['artichoke', 'artichoke'],
  ],
  pumpkin: [
    ['butternut', 'butternut'], ['japnut', 'japnut'], ['kent', 'kent'],
    ['jap', 'jap'], ['grey', 'grey'], ['pumpkin', 'pumpkin'],
  ],
  asparagus: [
    ['baby', 'baby'], ['white', 'white'], ['purple', 'purple'],
    ['green', 'green'], ['asparagus', 'asparagus'],
  ],
  celery: [['stick', 'stick'], ['heart', 'heart'], ['trimmed', 'trimmed'], ['celery', 'celery']],
  garlic: [['head', 'head'], ['clove', 'clove'], ['black', 'black'], ['garlic', 'garlic']],
  dates: [['medjool', 'medjool'], ['date', 'date']],
  herbs: [
    ['thai-basil', 'basil', 'thai'], ['continental-parsley', 'continental', 'parsley'],
    ['kaffir-lime-leaf', 'kaffir'], ['curry-leaf', 'curry'],
    ['lemongrass', 'lemongrass'], ['coriander', 'coriander'], ['rosemary', 'rosemary'],
    ['oregano', 'oregano'], ['watercress', 'watercress'], ['parsley', 'parsley'],
    ['vietnamese-mint', 'mint', 'vietnamese'], ['lemon-thyme', 'thyme', 'lemon'],
    ['basil', 'basil'], ['thyme', 'thyme'], ['chive', 'chive'],
    ['mint', 'mint'], ['sage', 'sage'], ['dill', 'dill'],
  ],
  'sweet-corn': [['cobette', 'cobette'], ['cob', 'cob'], ['sweet-corn', 'corn']],
  zucchini: [
    ['flower', 'flower'], ['baby', 'baby'], ['yellow', 'yellow'],
    ['green', 'green'], ['zucchini', 'zucchini'],
  ],
  ginger: [['turmeric', 'turmeric'], ['ginger', 'ginger']],
  rhubarb: [['rhubarb', 'rhubarb']],
}

/**
 * The variety for one product, or null.
 *
 * @param group  canonical group, e.g. 'apples'
 * @param tokens itemKey tokens PLUS brand tokens (Woolworths keeps the cultivar
 *               in `brand`, which is why parseProduceName deliberately does not
 *               strip it)
 */
export function varietyFor(group, tokens, keyTokens = tokens) {
  const entries = VARIETIES[group]
  if (!entries) return null
  const have = new Set(tokens)
  let best = null, bestNeed = null, bestN = 0
  for (const [slug, ...need] of entries) {
    if (!need.every((t) => have.has(t))) continue
    // More matched tokens wins. On a tie the EARLIER entry wins, which is why
    // each list is ordered most-identifying first and the bare head noun last.
    if (need.length > bestN) { best = slug; bestNeed = need; bestN = need.length }
  }
  if (best == null) return null

  // THE RESIDUAL RULE. Applies to EVERY variety, not only to the bare head
  // nouns. Gating it on a list of base slugs was wrong in both directions:
  //
  //   too narrow  no herb slug was in that list, so `basil` was an unguarded
  //               catch-all and a "Cold Blended Paste 80g" matched a "Lightly
  //               Dried Sachet 10g" at +692%. Same hole for `medjool`, which
  //               paired a coconut date roll with plain dates.
  //   too strict  the accounted set left out the group's own head noun, so
  //               `honeydew|melon` had residual {melon} and two BYTE-IDENTICAL
  //               "Honeydew Melon Whole" listings refused to match. Cherry and
  //               grape tomatoes failed the same way, because those slugs are
  //               base varieties of OTHER groups.
  //
  // Accounted for: the tokens the variety matched, the group's own head nouns,
  // and a short list of words that say how a thing was grown or presented rather
  // than what it is. Anything left over means the name draws a distinction this
  // lexicon cannot read, so the row becomes group-only — browsable, never
  // price-compared, and counted in `varietyGaps` as vocabulary to add.
  const heads = GROUP_HEAD_TOKENS.get(group)
  const residual = keyTokens.filter((t) =>
    !bestNeed.includes(t) && !IGNORABLE_RESIDUE.has(t) && !(heads && heads.has(t)))
  if (residual.length) return null
  return best
}

// Words that may remain in a name without disqualifying a variety: they describe
// growing, grading or presentation, not identity. Kept deliberately short — every
// addition widens the catch-all the residual rule exists to narrow.
// (parseProduceName has already removed brand, pack and grade words.)
const IGNORABLE_RESIDUE = new Set([
  'imperfect',                                    // already its own key segment
  'seedless', 'pitted', 'unwaxed', 'trimmed', 'grown', 'ripen', 'ripened',
  'australian', 'aussie', 'premium', 'select', 'quality', 'special',
  'fresh', 'loose', 'whole', 'hot', 'mild', 'sweet', 'snacker',
  'herb', 'produce', 'glasshouse', 'greenhouse', 'hydroponic', 'field',
  'certified', 'family', 'value', 'entertainer', 'batch', 'sleeve',
  // shape and colour flourishes left over AFTER a more specific variety matched.
  // Safe because a colour that IS the variety has its own entry and therefore
  // its own slug, so two colours never collapse into one key.
  'flat', 'brown', 'royal', 'large', 'long', 'round', 'heart',
  // Trim and marketing. `Topless Pineapple` (Coles) is a whole pineapple with
  // the crown cut off; `Pineapple Naturally Sweet Whole` (Woolworths) is the
  // same fruit with a slogan. Neither word changes what is in the bag, and the
  // two lines could not meet while either was unread.  — 2026-09-29
  'topless', 'naturally', 'crownless',
])

// For the metrics report: which groups have no lexicon at all yet. This is the
// lexicon's own to-do list, and it is why `variety: null` is reported per group.
export const GROUPS_WITH_LEXICON = new Set(Object.keys(VARIETIES))
