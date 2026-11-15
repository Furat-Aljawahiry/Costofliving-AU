// node --test — meat, poultry & seafood: the name parser, the key, and the
// grams rules that decide whether two packs may be compared.
//
// fixtures/adversarial.json holds real product names from the 18 Oct
// discovery crawl and the 22 Oct review, each with the key it must get (`key: null` is an assertion
// that the matcher must REFUSE) and a note saying why. Every row was checked by
// hand; when a lexicon change moves one, the note says whether that is a fix or
// a regression.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { parseMeatName, meatSizeLabel } from './names.js'
import { meatKeyFor } from './key.js'
import { parsePackSize, weightInfo, sizeRatio, meatPackCompatible, meatBasis, meatPairOrder, PACK_RATIO } from './weights.js'
import { buildMatchIndex, matchesFor } from '../matching/index.js'

const FIX = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures/adversarial.json'), 'utf8'))

// ---------------------------------------------------------------- the fixture

for (const row of FIX) {
  test(`key: ${row.retailer} "${row.name}" -> ${row.key ?? 'REFUSED'}`, () => {
    const m = parseMeatName(row.name, row.ctx)
    assert.equal(meatKeyFor({ meat: m }).key, row.key, row.note)
    assert.equal(m.kind, row.kind, row.note)
  })
}

test('fixture: the pairs the review found equal really do share a key', () => {
  const key = (name) => FIX.find((r) => r.name === name).key
  const same = [
    ['Free Range Organic Chicken Breast Fillets Skin Off', 'Macro Organic Chicken Breast Fillet'],
    ['RSPCA Approved Chicken Tenders', 'Woolworths Chicken Tenders'],
    ['RSPCA Approved Chicken Kebabs Honey & Soy', 'Woolworths 12 Pack Honey Soy Chicken Kebabs'],
    ['No Added Hormone Beef Regular Mince', 'Woolworths Beef Mince'],
    ['Woolworths Beef Scotch Fillet Steak', 'Beef Scotch Steak Fillet 2 Pack'],
    ['Woolworths Raw Prawn Meat', 'Prawns Raw Peeled'],
    ['Talley\'s Chilled Mussels Marinated Garlic', 'Mussels Garlic'],
    ['Cooked Duck Breasts Peking Flavoured', 'Luv-A-Duck Peking Duck Breasts Slow Cooked'],
    ['BBQ Sausages 8 Pack', 'Market Value 8 Pack Thin BBQ Sausages'],
    ['Frozen Cooked Extra Large Black Tiger Prawns', 'Woolworths Frozen Cooked Extra Large Tiger Prawns Carton'],
  ]
  for (const [a, b] of same) assert.equal(key(a), key(b), `${a} ≡ ${b}`)
  const different = [
    ['Woolworths RSPCA Approved Chicken Thigh Fillets Skinless', 'Woolworths RSPCA Approved Chicken Thigh Cutlets'],
    ['Woolworths 12 Pack Honey Soy Chicken Kebabs', 'Woolworths 6 Pack Hoisin Chicken Kebabs'],
    ['RSPCA Approved Chicken Tenders', 'RSPCA Approved Chicken Tenderloins'],
    ['Woolworths Lean Beef Mince', 'Woolworths Heart Smart Extra Lean Beef Mince'],
    ['No Added Hormone Beef Short Rib Fingers', 'Beef Slow Cook Short Ribs'],
    ['Woolworths Beef Scotch Fillet Steak', 'Woolworths Australian Beef Rib Eye Bone Sharing Steak'],
    ['Woolworths Frozen Salmon Fillets Skin On', 'Tasmanian Salmon Portions Skin On 2 Pack'],
    ['Woolworths BBQ Chicken Wing Nibbles', 'RSPCA Approved Chicken Wing Nibbles'],
  ]
  for (const [a, b] of different) assert.notEqual(key(a), key(b), `${a} ≢ ${b}`)
})

// ---------------------------------------------------------------- parser rules

test('brand is ignored: the same product under two brands keys the same', () => {
  const a = meatKeyFor({ meat: parseMeatName('Woolworths Beef Sizzle Steak', { brand: 'Woolworths' }) }).key
  const b = meatKeyFor({ meat: parseMeatName('Beef Sizzle Steak', { brand: 'Coles' }) }).key
  assert.equal(a, 'meat:beef:sizzle')
  assert.equal(a, b)
})

test('residual rule: an unknown word refuses the key and names the word', () => {
  const m = parseMeatName('Beef Zorblax Steak', {})
  assert.equal(m.kind, 'unparsed')
  assert.deepEqual(m.residual, ['zorblax'])
  assert.equal(meatKeyFor({ meat: m }).key, null)
})

test('name weight and pack count are pulled out, not left as words', () => {
  const m = parseMeatName('Woolworths 2 Pack Salmon Portions Skin On 280g', { brand: 'Woolworths' })
  assert.equal(m.nameWeight, 280)
  assert.equal(m.count, 2)
  assert.deepEqual(m.residual, [])
})

test('meatSizeLabel says how the weight was stated', () => {
  assert.equal(meatSizeLabel('1.1kg - 1.7kg'), '1.1kg–1.7kg · priced at 1.7kg')
  assert.equal(meatSizeLabel('approx. 1.65Kg'), 'approx. 1.65kg')
  assert.equal(meatSizeLabel('per 100g'), 'per kg · service counter')
  assert.equal(meatSizeLabel('500g'), '500g')
})

// ---------------------------------------------------------------- grams

test('parsePackSize: the four ways weight is stated', () => {
  assert.deepEqual(parsePackSize('500g'), { mode: 'fixed', weightG: 500, priceWeightG: 500, rangeG: null, count: null })
  assert.deepEqual(parsePackSize('approx. 1.65Kg'), { mode: 'variable-pack', weightG: 1650, priceWeightG: 1650, rangeG: null, count: null })
  // A Woolworths range is priced at its TOP weight (95 of 95 rows, 18 Oct) and
  // compared on its midpoint.
  assert.deepEqual(parsePackSize('1.1kg - 1.7kg'), { mode: 'variable-pack', weightG: 1400, priceWeightG: 1700, rangeG: [1100, 1700], count: null })
  assert.deepEqual(parsePackSize('2.5kg - 4.6 kg').rangeG, [2500, 4600])
  assert.equal(parsePackSize('1.1kg -1.4kg').priceWeightG, 1400)
  assert.equal(parsePackSize('per 350g').mode, 'per-kg')
  assert.equal(parsePackSize('12 pack').mode, 'count-only')
  assert.equal(parsePackSize('12 pack').count, 12)
  assert.equal(parsePackSize('300g 2 pack').count, 2)
})

let skuSeq = 0
const prod = (packageSize, price, pricePerKg, extra = {}) => ({
  sku: String(++skuSeq), retailer: extra.retailer || 'coles', domain: 'meat', packageSize,
  meat: { nameWeight: extra.nameWeight ?? null, count: null },
  latest: { runId: 'R1', price, pricePerKg, isAvailable: true, capturedAt: '2026-10-18T00:37:00Z' },
  ...extra,
})

test('weightInfo: a Woolworths range is checked against its top weight, so it is NOT a mismatch', () => {
  // Macro Free Range Chicken Breast Fillets 1.1kg - 1.7kg, $23.29, $13.70/kg — the
  // row the crawler flags CUP_PRICE_MISMATCH because it reads the bottom weight.
  const w = weightInfo(prod('1.1kg - 1.7kg', 23.29, 13.7))
  assert.equal(w.weightG, 1400)
  assert.equal(w.priceWeightG, 1700)
  assert.equal(w.derivedKg, 13.7)
  assert.deepEqual(w.flags, [])
})

test('weightInfo: cup-price cross-check — ≤5% ok, 5–20% drift, >20% refused', () => {
  assert.deepEqual(weightInfo(prod('500g', 9.5, 19.0)).flags, [])            // 0%
  assert.deepEqual(weightInfo(prod('500g', 9.95, 19.0)).flags, [])           // 4.7%
  assert.deepEqual(weightInfo(prod('500g', 10.0, 19.0)).flags, ['CUP_DRIFT'])  // 5.3%
  assert.deepEqual(weightInfo(prod('500g', 10.5, 19.0)).flags, ['CUP_DRIFT'])  // 10.5%
  assert.deepEqual(weightInfo(prod('500g', 12.0, 19.0)).flags, ['CUP_MISMATCH']) // 26%
})

test('weightInfo: the Coles "approx. 1.02g" loin chops typo is refused, not compared', () => {
  // Lamb Loin Chops Bulk (11x9) approx. 1.02g — a kilo written as a gram.
  const w = weightInfo(prod('approx. 1.02g', 26.52, 26.0))
  assert.ok(w.flags.includes('CUP_MISMATCH'))
  const ok = prod('approx. 1kg', 26.0, 26.0)
  assert.equal(meatPackCompatible(prod('approx. 1.02g', 26.52, 26.0), ok).ok, false)
})

test('weightInfo: a name weight that disagrees with the pack is a conflict', () => {
  const w = weightInfo(prod('500g', 10, 20, { meat: { nameWeight: 750, count: null } }))
  assert.ok(w.flags.includes('WEIGHT_CONFLICT'))
  // inside a range is agreement
  assert.deepEqual(weightInfo(prod('500g - 800g', 16, 20, { meat: { nameWeight: 600, count: null } })).flags, [])
})

test(`pack size: r ≤ ${PACK_RATIO} compares, r > ${PACK_RATIO} is shown but not compared`, () => {
  const a = prod('1000g', 15, 15)
  assert.equal(meatPackCompatible(a, prod('672g', 10.08, 15)).ok, true)    // r = 1.488
  assert.equal(meatPackCompatible(a, prod('667g', 10.0, 15)).ok, true)     // r = 1.499
  const far = meatPackCompatible(a, prod('662g', 9.93, 15))                // r = 1.511
  assert.equal(far.ok, false)
  assert.match(far.reason, /pack sizes differ/)
  // 500g vs 1kg mince: same product, not a fair per-kg comparison
  assert.equal(meatPackCompatible(prod('500g', 7.7, 15.4), prod('1kg', 15, 15)).ok, false)
  // approx 1.6kg vs a fixed 1.8kg chicken: like for like
  assert.equal(meatPackCompatible(prod('approx. 1.6kg', 13.6, 8.5), prod('1.8kg', 15.3, 8.5)).ok, true)
})

test('pack size: a service-counter line compares with any pack (bought by the amount)', () => {
  assert.equal(sizeRatio(prod('per 350g', 9.5, 9.5), prod('2kg', 20, 10)), 1)
  assert.equal(meatPackCompatible(prod('per 350g', 9.5, 9.5), prod('2kg', 20, 10)).ok, true)
})

test('basis: meat is per kg or not at all', () => {
  assert.equal(meatBasis({ pricePerKg: 10 }, { pricePerKg: 12 }), 'kg')
  assert.equal(meatBasis({ pricePerKg: 10, pricePerEach: 3 }, { pricePerKg: null, pricePerEach: 4 }), null)
})

test('partner choice: closest pack size first, then cheaper per kg', () => {
  const mine = prod('500g', 7.5, 15)
  const p1kg = prod('1kg', 13, 13), p550 = prod('550g', 8.8, 16), p520 = prod('520g', 8.6, 16.5)
  const order = [p1kg, p550, p520].sort((x, y) => meatPairOrder(mine, x, y))
  assert.deepEqual(order.map((p) => p.packageSize), ['520g', '550g', '1kg'])
})

test('review fixes: "2 x 500g", "1/2 kg", two weights in a name, a $0 price', () => {
  assert.deepEqual(parsePackSize('2 x 500g'), { mode: 'fixed', weightG: 1000, priceWeightG: 1000, rangeG: null, count: 2 })
  assert.equal(parseMeatName('Beef Mince 1/2 kg', {}).nameWeight, 500)
  const two = parseMeatName('Beef Mince 500g Value 1kg', {})
  assert.equal(two.nameWeight, 500)
  assert.deepEqual(two.residual, [])
  // Woolworths writes 0 for an unavailable line: no price, never a -100% "deal".
  assert.equal(meatBasis({ pricePerKg: 0 }, { pricePerKg: 12 }), null)
  assert.ok(weightInfo(prod('500g', 0, 0)).flags.includes('NO_KG_PRICE'))
})

test('review fix: a counter line is the partner of last resort, not the closest size', () => {
  // Coles "Chicken Drumsticks Large Pack approx. 1.5kg" was headlining against
  // Woolworths "Drumsticks per 150g" instead of the 10 Pack 1.1–1.9kg.
  const mine = prod('approx. 1.5kg', 7.2, 4.8)
  const counter = prod('per 150g', 4.8, 4.8), pack = prod('1.1kg - 1.9kg', 9.12, 4.8), bulk2 = prod('2kg', 9.6, 4.8)
  const order = [counter, bulk2, pack].sort((x, y) => meatPairOrder(mine, x, y))
  assert.deepEqual(order.map((p) => p.packageSize), ['1.1kg - 1.9kg', '2kg', 'per 150g'])
  // ...but it is still the partner when nothing packaged is in the band.
  const lone = [counter, prod('500g', 2.4, 4.8)].sort((x, y) => meatPairOrder(mine, x, y))
  assert.equal(lone[0].packageSize, 'per 150g')
})

// ---------------------------------------------------------------- through the matcher

test('matcher: a pair has the same verdict from both pages (own availability checked)', () => {
  const mk = (retailer, sku, available) => ({
    key: `${retailer}:${sku}`, retailer, sku, domain: 'meat', crawlCategory: 'meatAndPoultry',
    meat: parseMeatName('Beef Sizzle Steak', {}), packageSize: '400g', displayName: 'Beef Sizzle Steak', lastSeen: '2026-10-18',
    latest: { runId: 'R1', price: 11.5, pricePerKg: 28.75, isAvailable: available, capturedAt: '2026-10-18T00:37:00Z' },
  })
  const c = mk('coles', 'C1', true), w = mk('woolworths', 'W1', false)
  const idx = buildMatchIndex(new Map([[c.key, c], [w.key, w]]), [], { 'coles:meatAndPoultry': 'R1', 'woolworths:meatAndPoultry': 'R1' })
  const shape = (p) => ({ retailer: p.retailer, sku: p.sku })
  const [fromC] = matchesFor(c, idx, shape)
  const [fromW] = matchesFor(w, idx, shape)
  assert.equal(fromC.comparable, false)
  assert.equal(fromW.comparable, false, 'the unavailable line\'s own page must not headline a comparison either')
  assert.match(fromW.sizes[0].notComparableReason, /this line was listed as unavailable/)
})

test('matcher: 500g vs 1kg mince is strong (both shown, no headline); 500g vs 500g is exact', () => {
  const mk = (retailer, sku, size, price, kg) => {
    const m = parseMeatName(`${retailer === 'woolworths' ? 'Woolworths ' : ''}Beef Mince`, { brand: retailer === 'woolworths' ? 'Woolworths' : 'Coles' })
    return {
      key: `${retailer}:${sku}`, retailer, sku, domain: 'meat', crawlCategory: 'meatAndPoultry', meat: m,
      packageSize: size, displayName: 'Beef Mince', lastSeen: '2026-10-18',
      latest: { runId: 'R1', price, pricePerKg: kg, isAvailable: true, capturedAt: '2026-10-18T00:37:00Z' },
    }
  }
  const products = new Map()
  const c500 = mk('coles', 'C500', '500g', 7.5, 15)
  const w500 = mk('woolworths', 'W500', '500g', 7.7, 15.4)
  const w1kg = mk('woolworths', 'W1K', '1kg', 15, 15)
  for (const p of [c500, w500, w1kg]) products.set(p.key, p)
  const idx = buildMatchIndex(products, [], { 'coles:meatAndPoultry': 'R1', 'woolworths:meatAndPoultry': 'R1' })
  assert.equal(c500.matchKey, 'meat:beef:mince:grade_regular')
  const [m] = matchesFor(c500, idx, (p) => ({ retailer: p.retailer, sku: p.sku }))
  assert.equal(m.level, 'exact')
  assert.equal(m.comparison.basis, 'kg')
  assert.equal(m.comparison.other.sku, 'W500', 'the 500g pack is the partner, not the cheaper-per-kg 1kg')
  assert.equal(m.comparison.delta.pct, 3)
  const big = m.sizes.find((s) => s.sku === 'W1K')
  assert.equal(big.comparable, false)
  assert.match(big.notComparableReason, /500g vs 1kg — pack sizes differ/)
})
