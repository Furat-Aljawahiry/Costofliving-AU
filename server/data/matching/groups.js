// Which canonical produce group a product belongs to, and whether that group is
// produce at all.
//
// WHY THIS IS NOT A PORT OF produce_lexicon.py
// --------------------------------------------
// The crawler already computes `canonical_group` and `group_kind`, but only
// writes them to the cheapest-by-subcategory file — the products dataset has
// neither (69 columns, none of the three). Reimplementing taxonomy.py +
// produce_lexicon.py in JavaScript to fill that gap would duplicate ~400 terms,
// a VETO list and a three-way kind classification across a language boundary,
// and the duplicate would drift.
//
// It is not necessary, because the cheapest file is ALREADY a
// sap_subcategory -> (canonical_group, group_kind) mapping table: it holds one
// row per subcategory per run, each carrying the Lambda's own verdict. Reading
// it back resolves 413/472 Woolworths rows and 415/488 Coles rows — 87.5% and
// 85.0% — with no produce vocabulary in this file at all.
//
// The remainder is exactly the failure produce_lexicon.py documents in its own
// header: subcategories that name the department rather than the item.
// Measured here, the unresolved rows are
//
//   woolworths  ORGANICS (59)                       — an attribute
//   coles       VEGETABLES (34) PREPARED VEGETABLES (17) FRUITS (8)
//               VALUE ADDED (5) PREPACKED GRAPES (3) TROPICALS (2) …
//
// ~13% either side, matching the 13.7% the Python header measured on the 4 Sep
// captures. For those, HEAD_GROUP below reads the group out of the item's own
// tokens. It is deliberately small: head nouns only, no varieties, no pack words
// — `parseProduceName` has already stripped those.
//
// THE REAL FIX is for the Lambda to emit canonical_group / group_kind /
// group_source on the products dataset as additive schema 1.2 (the spec permits
// it in §9.3, and the Lambda already computes them). When that ships, `groupFor`
// prefers the column and this file's fallback retires itself quietly — which is
// why `groupSource` is reported on /api/status: it is how you find out whether
// that happened.
import { VETO_PREPARED, VETO_NON_PRODUCE } from './vetoes.js'
import { aliasToken } from './aliases.js'

// Head noun (as `parseProduceName` singularises it) -> canonical group.
// Values are groups the crawler's taxonomy.GROUPS also knows, so that the two
// sides can be compared where they overlap.
const HEAD_GROUP = {
  apple: 'apples', asparagus: 'asparagus', avocado: 'avocados', banana: 'bananas',
  blueberry: 'berries', raspberry: 'berries', strawberry: 'berries', blackberry: 'berries',
  broccoli: 'brassicas', broccolini: 'brassicas', cabbage: 'brassicas', cauliflower: 'brassicas',
  brussel: 'brassicas', sprout: 'brassicas', kale: 'brassicas', bok_choy: 'brassicas', pak_choy: 'brassicas',
  capsicum: 'capsicums', carrot: 'carrots', celery: 'celery', chilli: 'chillies',
  lemon: 'citrus', lime: 'citrus', orange: 'citrus', grapefruit: 'citrus',
  eggplant: 'continental-veg', fennel: 'continental-veg', leek: 'continental-veg', artichoke: 'continental-veg',
  cucumber: 'cucumbers', date: 'dates', garlic: 'garlic', ginger: 'ginger', turmeric: 'ginger',
  grape: 'grapes', basil: 'herbs', coriander: 'herbs', mint: 'herbs', parsley: 'herbs',
  rosemary: 'herbs', thyme: 'herbs', sage: 'herbs', dill: 'herbs', chive: 'herbs', oregano: 'herbs',
  spinach: 'leafy-greens', silverbeet: 'leafy-greens', watercress: 'leafy-greens', rocket: 'leafy-greens',
  lettuce: 'lettuce', cos: 'lettuce', radicchio: 'lettuce',
  mandarin: 'mandarins', mango: 'mangoes',
  melon: 'melons', rockmelon: 'melons', watermelon: 'melons', honeydew: 'melons',
  mushroom: 'mushrooms', onion: 'onions', shallot: 'onions', spring_onion: 'onions',
  pear: 'pears', pea: 'peas-beans', snow_pea: 'peas-beans', bean: 'peas-beans', beanette: 'peas-beans',
  potato: 'potatoes', pumpkin: 'pumpkin', rhubarb: 'rhubarb',
  beetroot: 'root-veg', beet: 'root-veg', parsnip: 'root-veg', radish: 'root-veg',
  swede: 'root-veg', turnip: 'root-veg', celeriac: 'root-veg',
  apricot: 'stone-fruit', cherry: 'stone-fruit', nectarine: 'stone-fruit', peach: 'stone-fruit',
  plum: 'stone-fruit', plumcot: 'stone-fruit',
  corn: 'sweet-corn', cobette: 'sweet-corn', sweet_potato: 'sweet-potatoes', tomato: 'tomatoes',
  kiwifruit: 'tropical-fruit', papaya: 'tropical-fruit', pawpaw: 'tropical-fruit',
  pineapple: 'tropical-fruit', passionfruit: 'tropical-fruit', lychee: 'tropical-fruit',
  fig: 'tropical-fruit', persimmon: 'tropical-fruit', pomegranate: 'tropical-fruit',
  quince: 'tropical-fruit', coconut: 'tropical-fruit', custard: 'tropical-fruit',
  dragonfruit: 'tropical-fruit', tamarillo: 'tropical-fruit', guava: 'tropical-fruit',
  zucchini: 'zucchini',
}

// Every group HEAD_GROUP can produce is produce by construction. The other two
// kinds only ever arrive from the Lambda's own verdict.
const KIND = { produce: 'produce', prepared: 'prepared', non_produce: 'non_produce' }

// group -> the head nouns that mean it. The residual rule in varieties.js needs
// this: `honeydew|melon` must not count `melon` as an unexplained leftover word,
// because `melon` is exactly what the group already says.
export const GROUP_HEAD_TOKENS = new Map()
for (const [token, group] of Object.entries(HEAD_GROUP)) {
  if (!GROUP_HEAD_TOKENS.has(group)) GROUP_HEAD_TOKENS.set(group, new Set())
  GROUP_HEAD_TOKENS.get(group).add(token)
}

// Unit separator: a byte that cannot occur in a retailer name or a subcategory.
// Built with fromCharCode rather than written as an escape, because an earlier
// version of this file put a literal NUL on disk and grep classed the whole
// module as binary.
const SEP = String.fromCharCode(0x1f)
const subKey = (retailer, subcategory) => `${retailer}${SEP}${subcategory}`

/**
 * The subcategory -> group table, read back out of the cheapest-by-subcategory
 * rows the loader already parsed. Per retailer, because the two retailers'
 * subcategory names collide (`VEGETABLES` means different things).
 *
 * A subcategory that maps to two groups across runs is dropped rather than
 * guessed at: an ambiguous entry would file products confidently and wrongly,
 * which is worse than falling through to the name.
 *
 * NOTE this table can only ever be as good as one row per subcategory allows.
 * A HETEROGENEOUS subcategory still resolves to a single group here — Coles files
 * rhubarb, silverbeet, fennel, radish, spinach, beetroot and kale under `BUNCH`,
 * whose cheapest row happened to be an onion — so `groupFor` cross-checks the
 * answer against the product's own name and lets the name win a disagreement.
 */
export function buildSubcategoryMap(cheapestSets) {
  const seen = new Map()   // retailer+SEP+subcat -> Map(group -> kind)
  for (const set of cheapestSets) {
    for (const row of set.rows) {
      const sub = row.sap?.subcategory
      if (!sub || !row.canonicalGroup) continue
      const k = subKey(set.retailer, sub)
      if (!seen.has(k)) seen.set(k, new Map())
      seen.get(k).set(row.canonicalGroup, row.groupKind || 'produce')
    }
  }
  const map = new Map()
  const ambiguous = []
  for (const [k, groups] of seen) {
    if (groups.size === 1) {
      const [[group, kind]] = [...groups]
      map.set(k, { group, kind })
    } else ambiguous.push({ key: k.replace(SEP, ' / '), groups: [...groups.keys()] })
  }
  return { map, ambiguous }
}

const vetoedPrepared = (tokens) => tokens.some((t) => VETO_PREPARED.has(t))
const vetoedNonProduce = (tokens) => tokens.some((t) => VETO_NON_PRODUCE.has(t))

/**
 * Group for one product.
 *
 * @returns {{group: string|null, kind: string, source: string}}
 *   source: column | veto | subcategory-map | name-over-map | name | unclassified
 */
export function groupFor(product, subMap) {
  // 1. The Lambda's own column, once schema 1.2 ships. Nothing else to decide.
  if (product.canonicalGroup) {
    return { group: product.canonicalGroup, kind: product.groupKind || 'produce', source: 'column' }
  }

  const tokens = String(product.itemKey || '').split('|').filter(Boolean).map(aliasToken)
  const fromName = [...new Set(tokens.map((t) => HEAD_GROUP[t]).filter(Boolean))]

  // 2. VETO, before anything reads the retailer's taxonomy.
  //
  // This used to run only in the name fallback below, on the reasoning that the
  // Lambda's verdict already encoded it. It does not: the subcategory table
  // resolves ~87% of rows, so ~87% of rows were never vetoed at all, and
  // `Mushroom Dry Shiitake 20g` — a $175/kg pantry good — was keyed as fresh
  // shiitake and compared against a $69/kg punnet. The Python side settles this
  // the same way: taxonomy.KIND_PRECEDENCE puts `prepared` ahead of `produce`,
  // because a name that says "dried" outranks a shelf that says "mushrooms".
  // 2a. A retailer filing something under NUTS, FLORAL, SAUCES or SNACKS is
  // making a positive statement that it is not produce, and that outranks a
  // name-token veto — which would only have said "prepared". 19 rows landed on
  // the wrong kind this way (`Dry Roasted Cashews`, `Bunch Chrysanthemum
  // White`, every salad dressing), and kind is what the produce views filter on.
  const early = subMap?.get(subKey(product.retailer, product.sap?.subcategory))
  if (early && early.kind === KIND.non_produce) {
    return { group: early.group, kind: KIND.non_produce, source: 'subcategory-map' }
  }

  // Not produce at all beats merely processed: `Walnuts In Shell`, filed by
  // Coles under CHRISTMAS, is not a prepared vegetable.
  if (vetoedNonProduce(tokens)) return { group: null, kind: KIND.non_produce, source: 'veto' }
  if (vetoedPrepared(tokens)) return { group: null, kind: KIND.prepared, source: 'veto' }

  // 3. The Lambda's verdict for this subcategory.
  const hit = subMap?.get(subKey(product.retailer, product.sap?.subcategory))
  if (hit) {
    // The cross-check, used rather than only logged. When the name names a group
    // of its own and the two disagree, the name is the more specific evidence —
    // this is what rescues Coles' `BUNCH` shelf from being filed as onions.
    //
    // ONLY when the retailer's verdict is itself `produce`. An earlier version
    // let the name override any verdict, which quietly resurrected 27 prepared
    // lines as fresh produce — `Cut Fruit Pineapple`, `Woolworths Fresh
    // Pineapple Tub`, `Potato & Egg Bacon`, `Just Veg. Carrot Sticks`, `Pumpkin
    // Cubes` — because each name contains a produce head noun. A retailer
    // filing something under VALUE ADD FRUIT is making a deliberate statement
    // about what it is; a retailer filing spring onions under BUNCH is not.
    // Same precedence the Python side uses: prepared outranks produce.
    if (hit.kind === KIND.produce && fromName.length === 1 && fromName[0] !== hit.group) {
      return { group: fromName[0], kind: KIND.produce, source: 'name-over-map' }
    }
    return { group: hit.group, kind: hit.kind, source: 'subcategory-map' }
  }

  // 4. The name alone. Reached for subcategories that name a department
  //    (ORGANICS, VEGETABLES, FRUITS) — ~13% of rows.
  if (!tokens.length) return { group: null, kind: 'unclassified', source: 'unclassified' }
  // Two distinct produce groups in one name is a mix, not a coin toss —
  // `Diced Melon & Pineapple Mix` is not melons.
  if (fromName.length > 1) return { group: null, kind: KIND.prepared, source: 'name' }
  if (fromName.length === 1) return { group: fromName[0], kind: KIND.produce, source: 'name' }
  return { group: null, kind: 'unclassified', source: 'unclassified' }
}

export const isProduce = (g) => g?.kind === 'produce' && !!g.group
