// The crawled categories, and which of them the site may show.
//
// Every crawl run covers ONE browse category per retailer (index.py), so a run,
// its CSVs and its manifest all belong to exactly one of these. Before meat was
// crawled there was only Fruit & Veg and every piece of per-retailer state in
// observations.js — collapsed runs, the "on the shelf today" run, the cheapest
// sets — was implicitly per-category. With a second category that stops being
// true: a meat run started 30 min after a fruit run would be folded into it, and
// would become Woolworths' "live run", marking every fruit SKU as not on the
// shelf. So that state is keyed by `retailer:category`, and this table is where
// a row's category is decided.
//
// `public` is the publish gate. The server syncs everything under
// reports/supermarkets from S3 with no category filter, so a crawled shelf is
// loaded the moment its Lambda writes; this flag decides whether the site
// shows it. Meat was published on 18 Oct after the match lists were reviewed
// (data/review/meat, docs/MEAT_DATA_TODO.md). ENABLED_CATEGORIES switches a
// hidden category on for one server; HIDDEN_CATEGORIES switches a public one
// off without a deploy — the kill switch if a shelf's data goes bad.
//
// `nodes` are the category identifiers each retailer writes into
// `source_category_id` (CSV) and `requested_nodes[].node_id` (manifest).
// `prefixes` are the S3 path segments, a fallback for a file whose rows carry no
// id at all.

export const CATEGORIES = {
  fruitAndVeg: {
    slug: 'fruitAndVeg', domain: 'produce', public: true, label: 'Fruit & vegetables',
    nodes: { woolworths: ['1-E5BEE36E'], coles: ['fruit-vegetables'] },
    prefixes: ['fruitAndVeg'],
  },
  meatAndPoultry: {
    slug: 'meatAndPoultry', domain: 'meat', public: true, label: 'Meat, poultry & seafood',
    // Woolworths' node id is written with an underscore in its own API
    // (`1_D5A2236`); the hyphenated form is accepted too because the fruit id is
    // hyphenated and nothing guarantees the two will stay consistent.
    nodes: { woolworths: ['1_D5A2236', '1-D5A2236'], coles: ['meat-seafood'] },
    prefixes: ['meatAndPoultry'],
  },
  // Snacks & confectionery: chips, biscuits, crackers, chocolate, lollies,
  // gum, muesli bars, nuts and dried fruit. One browse node at each retailer
  // (found 22 Oct, data/SNACKS_DISCOVERY.md): Woolworths' top-level "Snacks &
  // Confectionery", Coles' top-level "Chips, Chocolates & Snacks" — Coles'
  // biscuits and crackers are inside it, not under Pantry. Hidden until the
  // match lists are reviewed (docs/SNACKS_DATA_TODO.md).
  snacks: {
    slug: 'snacks', domain: 'snacks', public: false, label: 'Snacks & confectionery',
    nodes: { woolworths: ['1_717445A', '1-717445A'], coles: ['chips-chocolates-snacks'] },
    prefixes: ['snacks'],
  },
}

// Files written before any of this existed are all Fruit & Veg.
export const LEGACY_CATEGORY = 'fruitAndVeg'

const BY_NODE = new Map()
for (const c of Object.values(CATEGORIES)) {
  for (const [retailer, ids] of Object.entries(c.nodes)) {
    for (const id of ids) BY_NODE.set(`${retailer}:${id.toLowerCase()}`, c.slug)
  }
}

/**
 * The category slug for a row, a manifest or a file.
 *
 * Order: the node id the crawler recorded, then the S3 path segment, then the
 * legacy default. An unknown node id does NOT fall through to the legacy
 * default — a third category crawled tomorrow must not silently become fruit —
 * it comes back as `unknown:<id>` and stays hidden (isPublicCategory is false).
 */
export function categoryOf({ retailer, nodeId, file } = {}) {
  const id = String(nodeId || '').trim().toLowerCase()
  if (id) return BY_NODE.get(`${retailer}:${id}`) || `unknown:${id}`
  const parts = String(file || '').split(/[\\/]/)
  for (const c of Object.values(CATEGORIES)) {
    if (c.prefixes.some((pre) => parts.includes(pre))) return c.slug
  }
  return LEGACY_CATEGORY
}

export const domainOf = (slug) => CATEGORIES[slug]?.domain || null

// ENABLED_CATEGORIES=meatAndPoultry,... switches a hidden category on for one
// server — the way to look at it locally before flipping `public`.
const envSet = (name) => new Set(String(process.env[name] || '').split(',').map((s) => s.trim()).filter(Boolean))

export function isPublicCategory(slug) {
  const c = CATEGORIES[slug]
  if (!c) return false
  if (envSet('HIDDEN_CATEGORIES').has(slug)) return false
  return c.public || envSet('ENABLED_CATEGORIES').has(slug)
}

export const runKey = (retailer, category) => `${retailer}:${category}`
