// node --test — cross-retailer matching (P2.1).
//
// Two halves:
//   1. the adversarial fixture (fixtures/adversarial.json) driven as a table —
//      every row is a real product_name from the 16 Sep 2026 captures, and a
//      `key: null` is an assertion that the matcher must REFUSE to key it
//   2. the level/comparability rules, which are what the UI is permitted to do
//
// No I/O against data/out: fixtures only, so the suite does not change meaning
// when the archive grows.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { parseProduceName, sizeLabel } from '../produceNames.js'
import { buildSubcategoryMap, groupFor, isProduce } from './groups.js'
import { VETO_PREPARED, VETO_NON_PRODUCE } from './vetoes.js'
import { varietyFor } from './varieties.js'
import { aliasToken, aliasVariety, TOKEN_ALIASES, VARIETY_ALIASES } from './aliases.js'
import { matchKeyFor, packCompatible, buildMatchIndex, matchesFor, applyOverrides, matchingStatus, withAlias } from './index.js'
import { OVERRIDES } from './overrides.js'
import { sharedBasis, bestBasisAcross, cheapestOn, priceOn } from '../basis.js'

const FIX = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures/adversarial.json'), 'utf8'))

// The subcategory -> group table the loader builds from the cheapest files. Here
// it is stated explicitly so the fixture does not depend on data/out.
const CHEAPEST = [
  { retailer: 'woolworths', rows: [
    ['APPLE', 'apples'], ['CITRUS', 'citrus'], ['MELONS', 'melons'], ['CABBAGE', 'brassicas'],
    ['POTATO', 'potatoes'], ['CARROT', 'carrots'], ['CHILLIES', 'chillies'], ['MUSHROOM', 'mushrooms'],
    ['LETTUCE', 'lettuce'], ['BANANA', 'bananas'], ['PEAS / BEANS', 'peas-beans'],
    ['TOMATO', 'tomatoes'], ['GARLIC', 'garlic'], ['DATES', 'dates'], ['HERBS', 'herbs'],
    ['TROPICAL FRUIT', 'tropical-fruit'],
    ['SALAD', 'salads', 'prepared'], ['VALUE ADD VEG', 'prepared', 'prepared'],
  ] },
  { retailer: 'coles', rows: [
    ['APPLES', 'apples'], ['ORANGES', 'citrus'], ['MELONS', 'melons'], ['CABBAGE', 'brassicas'],
    ['BRUSHED POTATOES', 'potatoes'], ['WASHED POTATOES', 'potatoes'], ['BABY POTATOES', 'potatoes'],
    ['CARROTS', 'carrots'], ['CHILLIES', 'chillies'], ['BROWN MUSHROOMS', 'mushrooms'],
    ['LETTUCE', 'lettuce'], ['TOMATOES', 'tomatoes'], ['GARLIC', 'garlic'],
    ['HERBS', 'herbs'], ['PINEAPPLES', 'tropical-fruit'], ['TROPICAL FRUIT', 'tropical-fruit'],
    ['TOMATOES', 'tomatoes'],
    ['SALADS', 'salads', 'prepared'],
  ] },
].map((s) => ({
  retailer: s.retailer,
  rows: s.rows.map(([subcategory, canonicalGroup, groupKind = 'produce']) => ({
    sap: { subcategory }, canonicalGroup, groupKind,
  })),
}))

const { map: SUB_MAP } = buildSubcategoryMap(CHEAPEST)

// A fixture row -> the product shape the matcher consumes.
function productFrom(row) {
  const ctx = { brand: row.brand, soldBy: row.soldBy, packageSize: row.size }
  const parsed = parseProduceName(row.name, ctx)
  return {
    retailer: row.retailer, sku: row.sku || row.name, displayName: row.name, brand: row.brand || '',
    sap: { subcategory: row.sub }, isOrganic: !!row.organic,
    ...parsed, sizeLabel: sizeLabel(parsed, ctx),
    canonicalGroup: null, groupKind: null,
  }
}

// ---------------------------------------------------------------- 1. the fixture

for (const group of FIX.cases) {
  for (const row of group.rows) {
    test(`[${row.retailer}] ${row.name} -> ${row.key ?? 'NO KEY'}`, () => {
      const p = productFrom(row)
      const m = matchKeyFor(p, SUB_MAP)
      assert.equal(m.key, row.key, `match_key (group=${m.group} variety=${m.variety} source=${m.source})`)
      // Where the fixture states a parse fact, hold the parser to it too — these
      // are the fields the level rules depend on.
      if (row.multipack != null) assert.equal(p.multipack, row.multipack, 'multipack')
      if (row.portion != null) assert.equal(p.portion ?? 'whole', row.portion, 'portion')
    })
  }
}

test('every fixture row that should key does so, and the null ones stay null', () => {
  const rows = FIX.cases.flatMap((c) => c.rows)
  const keyed = rows.filter((r) => r.key != null)
  const refused = rows.filter((r) => r.key == null)
  assert.ok(keyed.length >= 30, `expected a substantial fixture, got ${keyed.length} keyed rows`)
  assert.ok(refused.length >= 8, `expected refusals to be tested, got ${refused.length}`)
})

// ---------------------------------------------------------------- 2. the rules

test('organic is a key segment, so organic never price-compares to conventional', () => {
  const w = matchKeyFor(productFrom({ retailer: 'woolworths', name: 'Macro Organic Pink Lady Apple Punnet', brand: 'Macro', sub: 'ORGANICS', size: '1kg', soldBy: 'pack', organic: true }), SUB_MAP)
  const c = matchKeyFor(productFrom({ retailer: 'coles', name: 'Pink Lady Apples', brand: 'Coles', sub: 'APPLES', size: '1kg', soldBy: 'pack' }), SUB_MAP)
  assert.equal(w.key, 'apples:pink-lady:organic')
  assert.equal(c.key, 'apples:pink-lady')
  assert.notEqual(w.key, c.key, 'an 82% organic premium must not read as a price difference between shops')
})

test('the Lambda column beats this file\'s fallback when it is present', () => {
  const p = productFrom({ retailer: 'coles', name: 'Something Unrecognisable', sub: 'NOT IN THE MAP', size: 'each', soldBy: 'each' })
  assert.equal(groupFor(p, SUB_MAP).group, null)
  p.canonicalGroup = 'apples'; p.groupKind = 'produce'
  const g = groupFor(p, SUB_MAP)
  assert.equal(g.group, 'apples')
  assert.equal(g.source, 'column', 'schema 1.2 must retire the fallback, not race it')
})

test('non-produce is never keyed, however produce-ish the name looks', () => {
  const p = productFrom({ retailer: 'coles', name: 'Bouquet Mixed Chrysanthemum Pink', brand: 'Coles', sub: 'VEGETABLES', size: 'each', soldBy: 'each' })
  const m = matchKeyFor(p, SUB_MAP)
  assert.equal(m.key, null)
  assert.equal(isProduce(m), false)
})

// The nastiest form of the per-each trap: NOTHING in the structured columns
// gives it away, only the product name.
test('a bulk weight priced per each is not comparable to a single unit', () => {
  const loose = { multipack: null, sizeGrade: null, portion: null, nameWeight: null, netSizeValue: 1, netSizeUom: 'ea' }
  // Coles 4433462 "Royal Gala Apples 1kg": package_size_raw "1 each", net_size
  // "1ea", sold_by "each", price_per_each $7.90. The kilo appears ONLY in the
  // name. Against a single loose Royal Gala at $1.26/ea this read +527% and
  // rendered "84% cheaper at Woolworths" on the Coles page.
  const kiloPricedPerEach = { multipack: null, sizeGrade: null, portion: null, nameWeight: '1kg', netSizeValue: 1, netSizeUom: 'ea' }
  const r = packCompatible(loose, kiloPricedPerEach, 'each')
  assert.equal(r.ok, false)
  assert.match(r.reason, /1kg/)
  // Two loose single apples, one declaring an approximate piece weight, must
  // still compare: below the pack threshold that is one piece, not a pack.
  assert.equal(packCompatible(loose, { ...loose, netSizeValue: 0.17, netSizeUom: 'kg' }, 'each').ok, true)
  // Per kg the trap cannot arise at all.
  assert.equal(packCompatible(loose, kiloPricedPerEach, 'kg').ok, true)
})

test('packCompatible only guards per-each, and only on a stated disagreement', () => {
  const one = { multipack: null, sizeGrade: null, portion: null }
  const six = { multipack: 6, sizeGrade: null, portion: null }
  // The Pink Lady trap: same key, same basis, and a 5%-cheaper headline built on
  // a 6-pack of snack apples versus one loose apple.
  assert.equal(packCompatible(one, six, 'each').ok, false)
  assert.match(packCompatible(one, six, 'each').reason, /pack sizes differ/)
  // Per kg the fruit size cannot distort the number, so the guard stands down.
  assert.equal(packCompatible(one, six, 'kg').ok, true)
  // Silence is not a disagreement: medium vs unstated stays comparable.
  assert.equal(packCompatible({ ...one, sizeGrade: 'medium' }, one, 'each').ok, true)
  assert.equal(packCompatible({ ...one, sizeGrade: 'medium' }, { ...one, sizeGrade: 'large' }, 'each').ok, false)
  // A half is not a whole.
  assert.equal(packCompatible({ ...one, portion: 'half' }, one, 'each').ok, false)
})

test('hand-set aliases are applied, and only where they are set', () => {
  // words: a spelling fix is safe everywhere, so it needs no group
  assert.equal(aliasToken('cayanne'), 'cayenne')
  assert.equal(aliasToken('sweetpotato'), 'sweet_potato')
  assert.equal(aliasToken('apple'), 'apple', 'an unaliased token passes through untouched')
  // products: a default-cultivar alias is scoped to its group
  assert.equal(aliasVariety('bananas', 'cavendish'), 'banana')
  assert.equal(aliasVariety('apples', 'cavendish'), 'cavendish', 'the alias must not leak into another group')
  assert.equal(aliasVariety('bananas', 'lady-finger'), 'lady-finger', 'only the DEFAULT cultivar collapses')
})

test('a default-cultivar alias never collapses a genuine cultivar', () => {
  // The rule that keeps VARIETY_ALIASES honest: an unqualified apple is not a
  // Royal Gala, so nothing in apples may alias to the base.
  for (const [group, map] of Object.entries(VARIETY_ALIASES)) {
    for (const [from, to] of Object.entries(map)) {
      assert.notEqual(from, to, `${group}: ${from} aliases to itself`)
      assert.ok(!(to in map), `${group}: ${to} is both a target and a source — chained aliases are not resolved`)
    }
  }
  assert.ok(!VARIETY_ALIASES.apples, 'apples must keep every cultivar distinct')
})

test('every alias carries a reason', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, 'aliases.js'), 'utf8')
  for (const token of Object.keys(TOKEN_ALIASES)) {
    assert.ok(src.includes(token), `${token} is not mentioned in the file body`)
  }
  assert.ok(/— 20\d\d-\d\d-\d\d/.test(src), 'entries should be dated')
})

// The produce views filter on `kind`, so getting the kind wrong puts cut flowers
// in the fruit & veg range — or drops a real vegetable out of it.
test('non-produce is separated from merely prepared', () => {
  const kindOf = (name, sub, retailer = 'coles') =>
    groupFor(productFrom({ retailer, name, brand: 'Coles', sub, size: '400g', soldBy: 'pack' }), SUB_MAP).kind

  // not fruit or veg at all, however they got into the crawl
  for (const [name, sub] of [
    ['Dry Roasted Cashews', 'VEGETABLES'], ['Walnuts In Shell', 'CHRISTMAS'],
    ['Bunch Chrysanthemum White', 'VEGETABLES'], ['Dressings Berry Balsamic', 'VEGETABLES'],
    ['Crunchy Snack Medley Party Mix', 'CHRISTMAS'], ['BBQ Flavoured Mixed Nuts', 'CHRISTMAS'],
  ]) assert.equal(kindOf(name, sub), 'non_produce', name)

  // real produce that has been done something to — stays in the aisle
  for (const [name, sub] of [
    ['Potato Salad', 'VEGETABLES'], ['Apple Slices', 'VEGETABLES'],
    ['Australian Diced Butternut Pumpkin', 'VEGETABLES'],
  ]) assert.equal(kindOf(name, sub), 'prepared', name)

  // and plain produce whose NAME contains a nut word must survive both lists
  for (const [name, sub] of [
    ['Butternut Pumpkin Whole', 'VEGETABLES'], ['Coconut Whole', 'TROPICAL FRUIT'],
    ['Drinking Coconut', 'TROPICAL FRUIT'],
  ]) assert.equal(kindOf(name, sub), 'produce', name)
})

test('the two veto lists do not overlap', () => {
  const both = [...VETO_NON_PRODUCE].filter((t) => VETO_PREPARED.has(t))
  assert.deepEqual(both, [], 'a token in both lists makes the kind depend on check order')
})

// ---------------------------------------------------------------- 3. end to end

const obs = (o) => ({ capturedAt: '2026-09-16T06:00:00Z', isAvailable: true, runId: 'R1', ...o })

function indexOf(rows) {
  const products = new Map()
  for (const r of rows) {
    const p = productFrom(r)
    p.sku = r.sku
    p.key = `${r.retailer}:${r.sku}`
    p.latest = obs(r.obs)
    p.lastSeen = p.latest.capturedAt
    p.netSizeValue = r.netSizeValue ?? null
    products.set(p.key, p)
  }
  const index = buildMatchIndex(products, CHEAPEST, { woolworths: 'R1', coles: 'R1' })
  return { products, index }
}
const shape = (p) => ({ retailer: p.retailer, sku: p.sku, displayName: p.displayName, sizeLabel: p.sizeLabel, latest: p.latest, multipack: p.multipack })

// The exact Pink Lady shelf as captured on 16 Sep, prices included.
const PINK_LADY = [
  { retailer: 'woolworths', sku: '105919', name: 'Fresh Pink Lady Apples', sub: 'APPLE', size: 'each', soldBy: 'each', obs: { pricePerEach: 1.31, price: 1.31 } },
  { retailer: 'woolworths', sku: '310968', name: 'Woolworths Fresh Pink Lady Apples Punnet', brand: 'Woolworths', sub: 'APPLE', size: '1kg', soldBy: 'pack', obs: { pricePerKg: 7.50, price: 7.50 } },
  { retailer: 'woolworths', sku: '160888', name: 'Macro Organic Pink Lady Apple Punnet', brand: 'Macro', sub: 'ORGANICS', size: '1kg', soldBy: 'pack', organic: true, obs: { price: null, isAvailable: false } },
  { retailer: 'coles', sku: '4438477', name: 'Pink Lady Apples', brand: 'Coles', sub: 'APPLES', size: '1kg', soldBy: 'pack', netSizeValue: 1000, obs: { pricePerKg: 4.90, price: 4.90 } },
  { retailer: 'coles', sku: '5111654', name: 'Pink Lady Apples Medium', brand: 'Coles', sub: 'APPLES', size: 'approx. 200g each', soldBy: 'weight', netSizeValue: 200, obs: { pricePerKg: 4.90, price: 0.98 } },
  { retailer: 'coles', sku: '2022580', name: 'Grab N Glow Pink Lady', brand: 'Fresh', sub: 'APPLES', size: '6 Pack', soldBy: 'pack', obs: { pricePerEach: 1.25, price: 7.50 } },
  { retailer: 'coles', sku: '4678233', name: 'Pink Lady Apple', brand: 'Coles Organic', sub: 'FRUITS', size: '1kg', soldBy: 'pack', organic: true, obs: { pricePerKg: 8.90, price: 8.90 } },
]

test('the per-kg Pink Lady comparison is the headline, and it is right', () => {
  const { products, index } = indexOf(PINK_LADY)
  const p = products.get('woolworths:310968')
  const [m] = matchesFor(p, index, shape)
  assert.equal(m.retailer, 'coles')
  assert.equal(m.level, 'exact')
  assert.equal(m.comparable, true)
  assert.equal(m.comparison.basis, 'kg', 'kg is preferred over each wherever both sides have it')
  assert.equal(m.comparison.delta.pct, -35, '$7.50/kg -> $4.90/kg')
  assert.equal(m.comparison.delta.cheaper, 'coles')
})

test('the per-each Pink Lady pair is shown but REFUSED as a comparison', () => {
  const { products, index } = indexOf(PINK_LADY)
  const p = products.get('woolworths:105919')       // one loose apple, $1.31/ea
  const [m] = matchesFor(p, index, shape)
  assert.equal(m.comparable, false, 'a 6-pack of snack apples is not one loose apple')
  assert.equal(m.comparison, null, 'and so there is no delta to mislead with')
  assert.match(m.notComparableReason, /pack sizes differ/)
  // It is still listed — the shopper sees the Coles prices, just not a verdict.
  assert.ok(m.sizes.length >= 3)
  assert.ok(m.sizes.every((s) => s.comparable === false))
})

test('a tie on price breaks on net size, not on map order', () => {
  const { products, index } = indexOf(PINK_LADY)
  const p = products.get('woolworths:310968')
  const [m] = matchesFor(p, index, shape)
  // 4438477 and 5111654 are both exactly $4.90/kg; the 1kg pack wins on size.
  assert.equal(m.comparison.other.sku, '4438477')
})

test('an unpriced unavailable SKU is never the comparison', () => {
  const { products, index } = indexOf(PINK_LADY)
  const p = products.get('coles:4678233')            // Coles organic
  const ms = matchesFor(p, index, shape)
  const w = ms.find((m) => m.retailer === 'woolworths')
  // Its only organic counterpart at Woolworths is 160888, which has no price.
  assert.equal(w.comparable, false)
  assert.equal(w.comparison, null)
})

test('organic and conventional never appear in each other\'s matches', () => {
  const { products, index } = indexOf(PINK_LADY)
  const organic = matchesFor(products.get('coles:4678233'), index, shape)
  const skus = organic.flatMap((m) => m.sizes.map((s) => s.sku))
  assert.ok(!skus.includes('310968'), 'the conventional 1kg punnet must not be offered as the organic match')
})

test('a SKU missing from its retailer\'s newest run is not compared', () => {
  const products = new Map()
  for (const r of PINK_LADY) {
    const p = productFrom(r); p.sku = r.sku; p.key = `${r.retailer}:${r.sku}`
    p.latest = obs({ ...r.obs, runId: r.retailer === 'coles' ? 'OLD' : 'R1' })
    p.lastSeen = '2026-09-01T06:00:00Z'
    p.netSizeValue = r.netSizeValue ?? null
    products.set(p.key, p)
  }
  const index = buildMatchIndex(products, CHEAPEST, { woolworths: 'R1', coles: 'R1' })
  const [m] = matchesFor(products.get('woolworths:310968'), index, shape)
  assert.equal(m.comparable, false, 'a delisted Coles line must not keep being compared')
  assert.match(m.notComparableReason, /latest capture/)
})

test('captures more than a day apart are shown, not compared', () => {
  const rows = PINK_LADY.map((r) => (r.retailer === 'coles'
    ? { ...r, obs: { ...r.obs, capturedAt: '2026-09-10T06:00:00Z' } } : r))
  const { products, index } = indexOf(rows)
  const [m] = matchesFor(products.get('woolworths:310968'), index, shape)
  assert.equal(m.comparable, false)
  assert.match(m.notComparableReason, /apart/)
})

test('same group, different variety is group-only and never comparable', () => {
  const { products, index } = indexOf([
    ...PINK_LADY,
    { retailer: 'coles', sku: '999', name: 'Granny Smith Apples', brand: 'Coles', sub: 'APPLES', size: '1kg', soldBy: 'pack', obs: { pricePerKg: 3.90, price: 3.90 } },
  ])
  const p = products.get('woolworths:310968')
  const [m] = matchesFor(p, index, shape)
  // Pink Lady still matches Pink Lady exactly; Granny Smith must not be in it.
  assert.equal(m.level, 'exact')
  assert.ok(!m.sizes.some((s) => s.sku === '999'), 'a different cultivar is a different product')
})

test('group-only appears when the variety has no counterpart', () => {
  const { products, index } = indexOf([
    { retailer: 'woolworths', sku: 'W1', name: 'Kanzi Apple', brand: 'Kanzi', sub: 'APPLE', size: 'each', soldBy: 'each', obs: { pricePerEach: 1.50 } },
    { retailer: 'coles', sku: 'C1', name: 'Granny Smith Apples', brand: 'Coles', sub: 'APPLES', size: '1kg', soldBy: 'pack', obs: { pricePerKg: 3.90 } },
  ])
  const [m] = matchesFor(products.get('woolworths:W1'), index, shape)
  assert.equal(m.level, 'group-only')
  assert.equal(m.comparable, false)
  assert.equal(m.comparison, null)
  assert.match(m.notComparableReason, /kanzi|variety/i)
})

test('a reject override removes the pair and drops the comparison with it', () => {
  const { products, index } = indexOf(PINK_LADY)
  const p = products.get('woolworths:310968')
  const before = matchesFor(p, index, shape)
  assert.equal(before[0].comparable, true)
  // Simulate the override list holding a reject for the winning Coles line.
  const after = applyOverrides(p, before.map((m) => ({
    ...m, sizes: m.sizes.filter((s) => s.sku !== '4438477'),
    comparable: false, comparison: null,
    notComparableReason: 'the matched line was rejected by review — see overrides.js',
  })))
  assert.equal(after[0].comparable, false)
  assert.equal(after[0].comparison, null)
})

test('group-only is never given a comparison, whatever else happens', () => {
  const { products, index } = indexOf([
    { retailer: 'woolworths', sku: 'W1', name: 'Kanzi Apple', brand: 'Kanzi', sub: 'APPLE', size: 'each', soldBy: 'each', obs: { pricePerEach: 1.50 } },
    { retailer: 'coles', sku: 'C1', name: 'Granny Smith Apples', brand: 'Coles', sub: 'APPLES', size: 'each', soldBy: 'each', obs: { pricePerEach: 0.90 } },
  ])
  const [m] = matchesFor(products.get('woolworths:W1'), index, shape)
  assert.equal(m.level, 'group-only')
  assert.equal(m.comparison, null, 'two different cultivars must never carry a delta')
  assert.equal(m.comparable, false)
})

test('matchingStatus reports the lexicon\'s own gaps', () => {
  const { products, index } = indexOf(PINK_LADY)
  const s = matchingStatus(index, products)
  assert.equal(s.matchKeyKind, 'produce')
  assert.ok(s.keys > 0)
  assert.ok(s.matchedKeys > 0)
  assert.equal(typeof s.perRetailer.coles.matched, 'number')
  assert.ok(Array.isArray(s.varietyGaps))
})

// ---------------------------------------------------------------- 4. basis

test('basis prefers kg over each, and shared basis is null when there is none', () => {
  const kg = { pricePerKg: 5 }, ea = { pricePerEach: 1 }, both = { pricePerKg: 5, pricePerEach: 1 }
  assert.equal(sharedBasis(kg, ea), null, 'kg vs each needs a weight we do not measure')
  assert.equal(sharedBasis(both, ea), 'each')
  assert.equal(sharedBasis(both, kg), 'kg')
  assert.equal(bestBasisAcross([ea, kg]), 'kg', 'an item sold both ways is ranked on kg')
  assert.equal(priceOn(kg, 'each'), null)
})

test('cheapestOn prefers available, then price, then the larger pack', () => {
  const mk = (sku, price, isAvailable = true, netSizeValue = 0) => ({ sku, netSizeValue, latest: { pricePerKg: price, isAvailable } })
  const won = cheapestOn([mk('a', 5), mk('b', 4), mk('c', 4, true, 1000)], 'kg')
  assert.equal(won.sku, 'c', 'tie at 4 goes to the larger net size')
  const avail = cheapestOn([mk('x', 1, false), mk('y', 9)], 'kg')
  assert.equal(avail.sku, 'y', 'an unavailable line is not the cheapest anything')
})

test('alias override: moves a meat SKU onto the reviewed key, only while it still parses to the reviewed key', () => {
  const a = OVERRIDES.find((o) => o.verdict === 'alias')
  assert.ok(a, 'overrides.js carries at least one alias')
  const p = { domain: 'meat', retailer: a.retailer, sku: a.sku }
  const m = withAlias(p, { key: a.matchKey, group: 'x', variety: 'y', kind: 'meat' })
  assert.equal(m.key, a.to)
  assert.equal(m.group, a.to.split(':').slice(0, 3).join(':'))
  // The lexicon moved it since review: the alias no longer applies.
  assert.equal(withAlias(p, { key: `${a.matchKey}:changed`, group: 'x' }).key, `${a.matchKey}:changed`)
  // Another SKU, or produce, is untouched.
  assert.equal(withAlias({ ...p, sku: 'nope' }, { key: a.matchKey }).key, a.matchKey)
  assert.equal(withAlias({ ...p, domain: 'produce' }, { key: a.matchKey }).key, a.matchKey)
  // An alias moves a SKU within its own domain (meat or snacks), never across.
  const domainOf = (k) => String(k).split(':')[0]
  for (const o of OVERRIDES.filter((x) => x.verdict === 'alias')) {
    assert.ok(['meat', 'snack'].includes(domainOf(o.matchKey)) && domainOf(o.to) === domainOf(o.matchKey) && o.note && o.date, `alias ${o.sku} is complete`)
  }
})
