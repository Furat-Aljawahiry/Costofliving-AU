// Category keying and the publish gate (categories.js), against a mixed
// archive: the 16 Sep Woolworths fruit fixture plus a meat run at each
// retailer that STARTS TWO MINUTES LATER — real rows from the 18 Oct meat
// discovery crawl, re-stamped. Two minutes is inside the 60-minute collapse
// window and the meat run is the newer one, which is exactly the shape that
// broke every per-retailer assumption in observations.js.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
process.env.DATA_DIR = path.join(HERE, 'fixtures', 'out-mixed')
process.env.DATA_SYNC = 'off'
delete process.env.ENABLED_CATEGORIES
// Meat is public since 18 Oct. The gate is exercised through the kill switch,
// which is the same code path a hidden category takes.
process.env.HIDDEN_CATEGORIES = 'meatAndPoultry'
const showMeat = (fn) => {
  const was = process.env.HIDDEN_CATEGORIES
  delete process.env.HIDDEN_CATEGORIES
  try { return fn() } finally { process.env.HIDDEN_CATEGORIES = was }
}

const { categoryOf, isPublicCategory, CATEGORIES } = await import('./categories.js')
const obs = await import('./observations.js')

const FRUIT_RUN = '20260916060037-ddfa7520'
const MEAT_RUN_W = '20260916060237-meat0001'

// ---------------------------------------------------------------- categoryOf

test('categoryOf: node ids map per retailer, legacy files default to fruit', () => {
  assert.equal(categoryOf({ retailer: 'woolworths', nodeId: '1-E5BEE36E' }), 'fruitAndVeg')
  assert.equal(categoryOf({ retailer: 'woolworths', nodeId: '1_D5A2236' }), 'meatAndPoultry')
  assert.equal(categoryOf({ retailer: 'coles', nodeId: 'meat-seafood' }), 'meatAndPoultry')
  assert.equal(categoryOf({ retailer: 'coles', file: 'x/coles/meatAndPoultry/dt=2026-10-18/r.csv' }), 'meatAndPoultry')
  assert.equal(categoryOf({ retailer: 'coles', file: 'data/out/coles_fruit-vegetables_2026-09-16.csv' }), 'fruitAndVeg')
})

test('categoryOf: an unknown node id is NOT silently fruit, and is never public', () => {
  const c = categoryOf({ retailer: 'coles', nodeId: 'dairy-eggs-fridge' })
  assert.equal(c, 'unknown:dairy-eggs-fridge')
  assert.equal(isPublicCategory(c), false)
})

test('meat is public; HIDDEN_CATEGORIES takes it off without a deploy', () => {
  assert.equal(CATEGORIES.meatAndPoultry.public, true, 'published 18 Oct after review')
  assert.equal(isPublicCategory('meatAndPoultry'), false, 'the kill switch wins over public')
  showMeat(() => assert.equal(isPublicCategory('meatAndPoultry'), true))
  // and it wins over ENABLED_CATEGORIES too
  process.env.ENABLED_CATEGORIES = 'meatAndPoultry'
  assert.equal(isPublicCategory('meatAndPoultry'), false)
  delete process.env.ENABLED_CATEGORIES
})

// ---------------------------------------------------------------- loader

test('a meat run two minutes after a fruit run does not collapse into it', () => {
  const idx = obs.loadObservations({ force: true, sync: false })
  const fruit = idx.runs.find((r) => r.runId === FRUIT_RUN)
  const meat = idx.runs.find((r) => r.runId === MEAT_RUN_W)
  assert.equal(fruit.category, 'fruitAndVeg')
  assert.equal(meat.category, 'meatAndPoultry')
  assert.equal(fruit.collapsedInto, null, 'the fruit run must survive')
  assert.equal(meat.collapsedInto, null)
})

test('the newer meat run does not become the fruit shelf\'s live run', () => {
  const idx = obs.loadObservations({ sync: false })
  assert.equal(idx.liveRuns['woolworths:fruitAndVeg'], FRUIT_RUN)
  assert.equal(idx.liveRuns['woolworths:meatAndPoultry'], MEAT_RUN_W)
  const fruitProducts = [...idx.products.values()].filter((p) => p.crawlCategory === 'fruitAndVeg')
  assert.ok(fruitProducts.length > 0)
  assert.ok(fruitProducts.every((p) => p.isLive === true), 'every fruit SKU is in its own shelf\'s newest run')
})

test('cheapest sets are kept per retailer AND category', () => {
  const idx = obs.loadObservations({ sync: false })
  assert.ok(idx.cheapest.has('woolworths:fruitAndVeg'))
  assert.ok(idx.cheapest.has('woolworths:meatAndPoultry'))
  assert.equal(idx.cheapest.get('woolworths:fruitAndVeg').runId, FRUIT_RUN)
})

test('meat rows are parsed by the meat parser and keyed `meat:`', () => {
  const idx = obs.loadObservations({ sync: false })
  const meat = [...idx.products.values()].filter((p) => p.domain === 'meat')
  assert.equal(meat.length, 8)
  const mince = meat.find((p) => p.retailer === 'coles' && /Regular Mince/.test(p.name))
  assert.equal(mince.matchKey, 'meat:beef:mince:grade_regular')
  const ham = meat.find((p) => /From The Deli/.test(p.name))
  assert.equal(ham.kind, 'out_of_scope')
  assert.equal(ham.matchKey, null)
})

// ---------------------------------------------------------------- the gate

test('gate: hidden meat is absent from items, search, product, cheapest and the summary', () => {
  const idx = obs.loadObservations({ sync: false })
  const meatSku = [...idx.products.values()].find((p) => p.domain === 'meat')
  assert.ok(obs.getItems().items.every((it) => it.sizes.every((s) => s.crawlCategory !== 'meatAndPoultry')))
  assert.equal(obs.searchProducts('mince').total, 0)
  assert.equal(obs.getProduct(meatSku.retailer, meatSku.sku), null)
  assert.ok(obs.getCheapest().every((s) => s.category !== 'meatAndPoultry'))
  const status = obs.getStatus()
  assert.equal(status.productCount, [...idx.products.values()].filter((p) => p.crawlCategory === 'fruitAndVeg').length)
  assert.equal(status.hiddenCategories.meatAndPoultry, 8)
  assert.ok(status.runs.every((r) => r.category !== 'meatAndPoultry'))
  assert.equal(status.matching.matchKeyKind, 'produce')
})

test('gate: includeHidden lets the review scripts see meat, and the match is real', () => {
  const idx = obs.loadObservations({ sync: false })
  const w = [...idx.products.values()].find((p) => p.retailer === 'woolworths' && p.matchKey === 'meat:beef:mince:grade_regular' && /500g/.test(p.packageSize))
  const page = obs.getProduct('woolworths', w.sku, { includeHidden: true })
  assert.equal(page.matchKeyKind, 'meat')
  const coles = page.matches.find((m) => m.retailer === 'coles')
  assert.equal(coles.level, 'exact')
  assert.equal(coles.comparison.basis, 'kg')
})

test('gate: a shelf with no matcher (unknown category) is indexed and published nowhere', () => {
  // ww-unknown.csv: three real fruit rows re-stamped `source_category_id=9-BAKERY`
  // with new SKUs. Before the fix they fell through to the produce matcher and
  // appeared in /api/items and inside produce pages' matches (review, 18 Oct).
  const idx = obs.loadObservations({ sync: false })
  const unknown = [...idx.products.values()].filter((p) => p.crawlCategory === 'unknown:9-bakery')
  assert.equal(unknown.length, 3)
  assert.ok(unknown.every((p) => p.domain === 'unknown' && p.matchKey == null && p.matchGroup == null))
  const ids = new Set(unknown.map((p) => p.sku))
  for (const it of obs.getItems({ includeNonProduce: true }).items) {
    assert.ok(it.sizes.every((s) => !ids.has(s.sku)), `item ${it.id} carries a hidden SKU`)
  }
  for (const p of idx.products.values()) {
    const page = obs.getProduct(p.retailer, p.sku)
    if (!page) continue
    for (const m of page.matches) assert.ok(m.sizes.every((s) => !ids.has(s.sku)))
  }
  assert.equal(obs.getStatus().matching.perRetailer.woolworths.items,
    [...idx.products.values()].filter((p) => p.retailer === 'woolworths' && p.crawlCategory === 'fruitAndVeg').length)
})

// The category page browses by shelf (client/src/lib/groups.js), and the only
// vocabulary shared by both retailers is the matcher's canonical group — each
// retailer's own subcategory_name is its own ("APPLE" vs "Apples"). So the
// group has to ride on the items payload, not be guessed at in the client.
test('items: every item carries its canonical group, or null when unplaced', () => {
  const idx = obs.loadObservations({ sync: false })
  const items = obs.getItems({ category: 'fruitAndVeg' }).items
  assert.ok(items.length > 0)
  assert.ok(items.every((it) => 'group' in it))
  for (const it of items) {
    const lead = idx.items.get(it.id).skus[0]
    assert.equal(it.group, lead.matchGroup || null)
  }
  // The fixture is the 16 Sep Woolworths fruit run; apples are in it, and a
  // group is a slug, never a retailer's display shelf.
  const groups = new Set(items.map((it) => it.group).filter(Boolean))
  assert.ok(groups.has('apples'), [...groups].join(', '))
  assert.ok([...groups].every((g) => /^[a-z0-9-]+$/.test(g)))
})

test('status: hidden shelves appear by count only, not in liveRuns', () => {
  const s = obs.getStatus()
  assert.ok(Object.keys(s.liveRuns).every((k) => k.endsWith(':fruitAndVeg')))
  assert.ok(s.liveRunFromPartial.every((k) => k.endsWith(':fruitAndVeg')))
})

test('category filter: ?category narrows items, search and cheapest to one shelf', () => showMeat(() => {
  const meatItems = obs.getItems({ category: 'meatAndPoultry' }).items
  assert.ok(meatItems.length > 0)
  assert.ok(meatItems.every((it) => it.sizes.every((s) => s.crawlCategory === 'meatAndPoultry')))
  const fruitItems = obs.getItems({ category: 'fruitAndVeg' }).items
  assert.ok(fruitItems.length > 0 && fruitItems.every((it) => it.sizes.every((s) => s.crawlCategory === 'fruitAndVeg')))
  assert.equal(obs.searchProducts('mince', { category: 'fruitAndVeg' }).total, 0)
  assert.ok(obs.searchProducts('mince').total > 0, 'site-wide search covers every public shelf')
  assert.ok(obs.getCheapest({ category: 'fruitAndVeg' }).every((c) => c.category === 'fruitAndVeg'))
  assert.ok(obs.getCheapest().some((c) => c.category === 'meatAndPoultry'))
}))

test('published: with the kill switch off, meat pages render with their match', () => showMeat(() => {
  const idx = obs.loadObservations({ sync: false })
  const w = [...idx.products.values()].find((p) => p.retailer === 'woolworths' && p.matchKey === 'meat:beef:mince:grade_regular' && /500g/.test(p.packageSize))
  const page = obs.getProduct('woolworths', w.sku)
  assert.ok(page, 'public meat product page')
  assert.equal(page.matches.find((m) => m.retailer === 'coles').comparison.basis, 'kg')
  assert.equal(obs.getStatus().hiddenCategories.meatAndPoultry, undefined)
}))

test('snacks: both retailers\' browse nodes file under one category, hidden until reviewed', () => {
  assert.equal(categoryOf({ retailer: 'woolworths', nodeId: '1_717445A' }), 'snacks')
  assert.equal(categoryOf({ retailer: 'woolworths', nodeId: '1-717445A' }), 'snacks')
  assert.equal(categoryOf({ retailer: 'coles', nodeId: 'chips-chocolates-snacks' }), 'snacks')
  assert.equal(categoryOf({ retailer: 'coles', file: 'reports/supermarkets/coles/snacks/dt=2026-10-22/x.csv' }), 'snacks')
  // A Woolworths node id at Coles is not a snack shelf.
  assert.equal(categoryOf({ retailer: 'coles', nodeId: '1_717445A' }), 'unknown:1_717445a')
  assert.equal(CATEGORIES.snacks.domain, 'snacks')
  assert.equal(isPublicCategory('snacks'), false)
  process.env.ENABLED_CATEGORIES = 'snacks'
  try { assert.equal(isPublicCategory('snacks'), true) } finally { delete process.env.ENABLED_CATEGORIES }
})
