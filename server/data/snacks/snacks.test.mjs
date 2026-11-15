// node --test — snacks & confectionery: the name parser, the key, and the pack
// rules that decide whether two listings are the same product in the same pack.
//
// fixtures/adversarial.json holds real product names from the 22 Oct discovery
// crawl, each with the key it must get and a note saying why. Every row was
// checked by hand against the review lists (data/review/snacks); when a lexicon
// change moves one, the note says whether that is a fix or a regression.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { parseSnackName, parseSnackPack, snackSizeLabel } from './names.js'
import { snackKeyFor } from './key.js'
import { snackWeight, snackPackCompatible, snackBasis, samePack } from './weights.js'
import { buildMatchIndex, matchesFor } from '../matching/index.js'

const FIX = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures/adversarial.json'), 'utf8'))
const parse = (row) => parseSnackName(row.name, { ...row.ctx, retailer: row.retailer })
const keyOf = (row) => snackKeyFor({ snack: parse(row) }).key
const byName = (name) => {
  const row = FIX.find((r) => r.name === name)
  assert.ok(row, `fixture row "${name}"`)
  return row
}

// ---------------------------------------------------------------- the fixture

for (const row of FIX) {
  test(`key: ${row.retailer} "${row.name}" -> ${row.key}`, () => {
    const s = parse(row)
    assert.equal(snackKeyFor({ snack: s }).key, row.key, row.note)
    assert.equal(s.count, row.count, row.note)
    assert.equal(s.singleBag, row.singleBag, row.note)
  })
}

// A pair "is the same product" only if it shares a key AND passes the pack
// check. These pairs are both, on real 22 Oct listings.
const asProduct = (row, price = 5) => ({
  snack: parse(row), packageSize: row.ctx.packageSize,
  latest: { runId: 'R1', price, pricePerKg: null, unitPrice: null, unitMeasure: null },
})

test('fixture: the pairs the review found identical share a key and a pack', () => {
  const same = [
    ['Tim Tam Chocolate Biscuits Original', "Arnott's Tim Tam Original Chocolate Biscuits"],
    ['Shapes Original Barbecue Cracker Biscuits', "Arnott's Shapes Barbecue Cracker Biscuits"],
    ['Mini Milk Chocolate Share Pack 11 Pieces', 'KitKat Milk Chocolate Mini Bars'],
    ['Chocolate Party Share Bag 12 Pieces', 'Snickers Milk Chocolate Fun Size Bars'],
    ['Lindor Milk Chocolate Block', 'Lindt Lindor Milk Chocolate Block'],
    ['Kids Watermelon Lollies', 'Sour Patch Kids Watermelon Lollies'],
    ['Sweet Chilli & Sour Cream Deli Style Crackers', 'Red Rock Deli Style Crackers Sweet Chilli & Sour Cream'],
    ['Roses Tin', 'Cadbury Roses Chocolate Tin'],
    ['Dairy Milk Caramello Chocolate Block', 'Cadbury Dairy Milk Caramel Chocolate Caramello Block'],
    ['Scoops Mexican Cheese', 'Doritos Scoops Corn Chips Mexican Cheese'],
    ['Lollies Snakes Alive Lolly Bag', "Allen's Snakes Alive Lollies"],
    ['Grape Spark Sugar Free Chewing Gum', '5Gum Grape Spark Sugar Free Chewing Gum'],
  ]
  for (const [a, b] of same) {
    assert.equal(byName(a).key, byName(b).key, `${a} ≡ ${b}`)
    assert.ok(samePack(asProduct(byName(a)), asProduct(byName(b))), `${a} and ${b} are the same pack`)
  }
})

test('fixture: different products never share a key', () => {
  const different = [
    ['Tim Tam Chocolate Biscuits Original', 'Tim Tam Chocolate Biscuits Double Coat'],
    ['Crackers Sour Cream & Onion', "Smith's Crinkle Cut Sour Cream & Onion Potato Chips"],
    ['Original Crinkle Cut Chips', 'Woolworths Crinkle Cut Chips Original Crinkle Cut Original'],
    ['Dairy Milk Hazelnut Chocolate Block', 'Dairy Milk Fruit & Nut Chocolate Block'],
    ['Lindt Excellence Dark Chocolate 70% Cocoa Block', 'Lindt Excellence Dark Chocolate 85% Cocoa Block'],
    ['Doritos Medium Salsa', 'Doritos Hot Salsa'],
    ['Dairy Milk Caramello Chocolate Block', 'Cadbury Dairy Milk Oreo Chocolate Block'],
    ['Dairy Milk Snack Chocolate Block', 'Cadbury Dairy Milk Chocolate Block'],
  ]
  for (const [a, b] of different) assert.notEqual(byName(a).key, byName(b).key, `${a} ≢ ${b}`)
})

test('fixture: same key, different pack — shown, never compared', () => {
  // 380g party bag vs 380g 20-pack: same brand, flavour and weight.
  const party = asProduct(byName("Smith's Crinkle Cut Potato Chips Party Bag Original"))
  const multi = asProduct(byName('Crinkle Cut Chips Lunchbox Multipack 20 Pack'))
  assert.equal(snackKeyFor(party).key, snackKeyFor(multi).key)
  const v = snackPackCompatible(party, multi)
  assert.equal(v.ok, false)
  assert.match(v.reason, /20-pack multipack vs a single share bag/)
  // 170g vs 60g of the same chips.
  const big = asProduct(byName('Crinkle Cut Salt And Vinegar Potato Chips'))
  const small = asProduct(byName("Smith's Crinkle Cut Chips Salt & Vinegar"))
  assert.equal(snackKeyFor(big).key, snackKeyFor(small).key)
  assert.match(snackPackCompatible(big, small).reason, /170g vs 60g — a different pack size/)
})

// ---------------------------------------------------------------- parser rules

test('house brands are keyed per retailer and never cross', () => {
  const c = parseSnackName('Original Crinkle Cut Chips', { retailer: 'coles', brand: 'Coles', packageSize: '175g' })
  const w = parseSnackName('Woolworths Crinkle Cut Chips Original', { retailer: 'woolworths', brand: 'Woolworths', packageSize: '175g' })
  assert.equal(c.brand, 'house-coles')
  assert.equal(w.brand, 'house-woolworths')
  assert.ok(c.isHouseBrand && w.isHouseBrand)
})

test('brand: spelling, apostrophes and the brand repeated in the name', () => {
  const a = parseSnackName("Smith's Crinkle Cut Potato Chips Original", { brand: "Smith's", packageSize: '170g' })
  const b = parseSnackName('Crinkle Cut Original Potato Chips', { brand: 'Smiths', packageSize: '170g' })
  assert.equal(a.brand, 'smiths')
  assert.deepEqual(a.tokens, b.tokens)
})

test('an unknown word is kept, so it can only stop a match', () => {
  const plain = parseSnackName('Tim Tam Chocolate Biscuits', { brand: "Arnott's" })
  const odd = parseSnackName('Tim Tam Zorblax Chocolate Biscuits', { brand: "Arnott's" })
  assert.ok(odd.tokens.includes('zorblax'))
  assert.notEqual(snackKeyFor({ snack: plain }).key, snackKeyFor({ snack: odd }).key)
})

test('package strings: per-unit, total-with-count, count only, plain weight', () => {
  assert.deepEqual(parseSnackPack('20g x 6 pack'), { grams: 120, unitG: 20, count: 6, liquid: false })
  assert.deepEqual(parseSnackPack('180g 12 pack'), { grams: 180, unitG: null, count: 12, liquid: false })
  assert.deepEqual(parseSnackPack('5 pack'), { grams: null, unitG: null, count: 5, liquid: false })
  assert.deepEqual(parseSnackPack('1.1 kg'), { grams: 1100, unitG: null, count: null, liquid: false })
  assert.equal(snackSizeLabel('20g x 6 pack'), '6 × 20g')
  assert.equal(snackSizeLabel('180g 12 pack'), '12 pack · 180g')
})

test('counts in the name: "11 Pieces", "8x13g", "6 Twin Bars"', () => {
  assert.equal(parseSnackName('Mini Beef Sticks Original 8x13g 104g', { brand: "Jack Link's" }).count, 8)
  const twin = parseSnackName('Crunchy Oats & Honey 6 Twin Bars', { brand: 'Nature Valley', packageSize: '252g' })
  assert.equal(twin.count, 6)
  assert.ok(twin.tokens.includes('twin'), 'the count goes, the variant word stays')
})

// ---------------------------------------------------------------- weights

test('weight: a count-only Woolworths pack implies its weight from the $/100g', () => {
  const p = { snack: parseSnackName("Carman's Protein Bar Cinnamon Scroll", { brand: "Carman's", packageSize: '5 pack' }),
    latest: { runId: 'R1', price: 8.5, pricePerKg: null, unitPrice: 4.25, unitMeasure: '100G' } }
  const w = snackWeight(p)
  assert.equal(w.source, 'implied')
  assert.equal(w.grams, 200)
  const coles = { snack: parseSnackName('Protein Bars Cinnamon Scroll', { brand: "Carman's", packageSize: '200g' }),
    latest: { runId: 'R1', price: 8.5, pricePerKg: 42.5 } }
  assert.equal(snackPackCompatible(p, coles).ok, true)
})

test('weight: two stated weights must be identical; a count on both sides must agree', () => {
  const mk = (pkg, name = 'Tim Tam Original Chocolate Biscuits') => ({
    snack: parseSnackName(name, { brand: "Arnott's", packageSize: pkg }), latest: { runId: 'R1', price: 6, pricePerKg: null } })
  assert.equal(snackPackCompatible(mk('200g'), mk('200g')).ok, true)
  assert.equal(snackPackCompatible(mk('200g'), mk('201g')).ok, false)
  assert.match(snackPackCompatible(mk('120g 6 pack'), mk('120g 5 pack')).reason, /6-pack vs 5-pack/)
})

test('weight: price ÷ weight far from the cup price refuses the pair', () => {
  const bad = { snack: parseSnackName('Tim Tam Original', { brand: "Arnott's", packageSize: '200g' }), latest: { runId: 'R1', price: 6, pricePerKg: 60 } }
  const ok = { snack: parseSnackName('Tim Tam Original', { brand: "Arnott's", packageSize: '200g' }), latest: { runId: 'R1', price: 6, pricePerKg: 30 } }
  assert.ok(snackWeight(bad).flags.includes('CUP_MISMATCH'))
  assert.match(snackPackCompatible(ok, bad).reason, /disagrees with its price ÷ weight/)
})

test('basis: snacks are compared on the shelf price, and a $0 is no price', () => {
  assert.equal(snackBasis({ price: 5 }, { price: 6 }), 'pack')
  assert.equal(snackBasis({ price: 0 }, { price: 6 }), null)
})

// ---------------------------------------------------------------- through the matcher

test('matcher: the identical pack is the comparison; the other pack is shown, not compared', () => {
  const mk = (retailer, sku, name, brand, pkg, price, available = true) => ({
    key: `${retailer}:${sku}`, retailer, sku, domain: 'snacks', crawlCategory: 'snacks', displayName: name, lastSeen: '2026-10-22',
    snack: parseSnackName(name, { retailer, brand, packageSize: pkg, subcategory: 'Chips Sharing' }), packageSize: pkg,
    latest: { runId: 'R1', price, pricePerKg: null, isAvailable: available, capturedAt: '2026-10-22T04:34:00Z' },
  })
  const c = mk('coles', 'C170', 'Crinkle Cut Original Potato Chips', "Smith's", '170g', 5)
  const w170 = mk('woolworths', 'W170', "Smith's Crinkle Cut Potato Chips Original", "Smith's", '170g', 3)
  const w60 = mk('woolworths', 'W60', "Smith's Crinkle Cut Potato Chips Original", "Smith's", '60g', 3)
  const products = new Map([c, w170, w60].map((p) => [p.key, p]))
  const idx = buildMatchIndex(products, [], { 'coles:snacks': 'R1', 'woolworths:snacks': 'R1' })
  assert.equal(c.matchKey, 'snack:smiths:chip:crinkle_cut')
  const [m] = matchesFor(c, idx, (p) => ({ retailer: p.retailer, sku: p.sku }))
  assert.equal(m.level, 'exact')
  assert.equal(m.comparison.basis, 'pack')
  assert.equal(m.comparison.other.sku, 'W170')
  assert.equal(m.comparison.this.price, 5)
  assert.deepEqual(m.comparison.delta, { pct: -40, cheaper: 'woolworths' })
  const small = m.sizes.find((s) => s.sku === 'W60')
  assert.equal(small.comparable, false)
  assert.match(small.notComparableReason, /170g vs 60g/)
})

test('matcher: an unavailable line is not compared from either page', () => {
  const mk = (retailer, sku, available) => ({
    key: `${retailer}:${sku}`, retailer, sku, domain: 'snacks', crawlCategory: 'snacks', displayName: 'Tim Tam', lastSeen: '2026-10-22',
    snack: parseSnackName('Tim Tam Original Chocolate Biscuits', { retailer, brand: "Arnott's", packageSize: '200g' }), packageSize: '200g',
    latest: { runId: 'R1', price: 6, pricePerKg: 30, isAvailable: available, capturedAt: '2026-10-22T04:34:00Z' },
  })
  const c = mk('coles', 'C1', true), w = mk('woolworths', 'W1', false)
  const idx = buildMatchIndex(new Map([[c.key, c], [w.key, w]]), [], { 'coles:snacks': 'R1', 'woolworths:snacks': 'R1' })
  const shape = (p) => ({ retailer: p.retailer, sku: p.sku })
  assert.equal(matchesFor(c, idx, shape)[0].comparable, false)
  assert.equal(matchesFor(w, idx, shape)[0].comparable, false)
})
