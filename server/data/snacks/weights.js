// Pack size for snacks & confectionery, and whether two packs are the same.
//
// WHAT THE 22 OCT DISCOVERY CRAWL SHOWED (data/SNACKS_DISCOVERY.md)
// ---------------------------------------------------------------
// Unlike meat, the shelf price IS the price of a fixed pack on both sides, so
// two listings of the same product in the same pack can be compared on what you
// actually pay at the till. That is the comparison made here: per pack, and only
// for an identical pack. A 170 g bag against a 175 g bag of the same chips is
// shown, not compared — the user's ruling, 22 Oct ("the same exact product").
//
//   Coles   "170g"                 always the total weight.
//   Woolies "170g"                 the total weight.
//           "180g 12 pack"         the total weight and a count.
//           "20g x 6 pack"         a unit weight and a count (total 120 g).
//           "5 pack"               a count only; the weight has to be IMPLIED
//                                  from price ÷ the per-100g price, which is
//                                  rounded to the cent and so never exact.
//
// An implied weight may match a stated one within IMPLIED_TOLERANCE. Two stated
// weights must be equal.

import { CUP_OK, CUP_REFUSE } from '../meat/weights.js'

// 1%. The per-100g price is rounded to the cent, which puts an implied weight
// within about 0.5% of the truth ($4.50 at $2.96/100g is 152.0 g). 3% was
// tried first and let Coles' single "Twisties Chicken 155g" pair with
// Woolworths' 8 × 19 g multipack (152 g implied) — a different product.
export const IMPLIED_TOLERANCE = 0.01
const SAME_G = 0.5

/**
 * Grams in the pack, where they came from, and whether the three numbers
 * (price, grams, per-kg price) agree. Memoised on the product by latest run.
 */
export function snackWeight(p) {
  const latest = p.latest || {}
  const memo = p._snackWeight
  if (memo && memo.runId === latest.runId) return memo
  const s = p.snack || {}
  const price = latest.price > 0 ? latest.price : null
  // Liquids (salsa, dips) carry a per-litre price; the arithmetic is the same.
  const cupKg = latest.pricePerKg > 0 ? latest.pricePerKg : latest.pricePerL > 0 ? latest.pricePerL : cupFromUnit(latest)
  let grams = s.sizeG ?? null
  let source = s.sizeSource ?? null
  if (grams == null && price && cupKg) {
    grams = (price / cupKg) * 1000
    source = 'implied'
  }
  const flags = []
  let mismatch = null
  if (source !== 'implied' && grams && price && cupKg) {
    const derived = price / (grams / 1000)
    mismatch = Math.abs(derived - cupKg) / cupKg
    if (mismatch > CUP_REFUSE) flags.push('CUP_MISMATCH')
    else if (mismatch > CUP_OK) flags.push('CUP_DRIFT')
  }
  if (grams == null) flags.push('NO_WEIGHT')
  const info = {
    runId: latest.runId, grams: grams != null ? Math.round(grams * 10) / 10 : null, source, count: s.count ?? null, singleBag: !!s.singleBag,
    cupKg, mismatchPct: mismatch != null ? Math.round(mismatch * 1000) / 10 : null, flags,
  }
  Object.defineProperty(p, '_snackWeight', { value: info, writable: true, configurable: true, enumerable: false })
  return info
}

// The retailer's own cup price as $/kg, when the crawler did not normalise it.
// Woolworths' count-only packs ("5 pack") carry "$2.76 / 100G" but no
// price_per_kg_aud — the crawler flags them CUP_PRICE_BASIS_MISMATCH because
// the package says "pack" and the cup says grams. The cup is still the one
// statement of weight the listing makes.
const PER_KG = { '10G': 100, '100G': 10, '1KG': 1, '100ML': 10, '1L': 1 }
function cupFromUnit(o) {
  const f = PER_KG[String(o?.unitMeasure || '').toUpperCase().replace(/\s+/g, '')]
  return f && o.unitPrice > 0 ? o.unitPrice * f : null
}

export const fmtSnackG =(g) => (g == null ? 'no weight' : g >= 1000 ? `${Math.round(g / 10) / 100}kg` : `${Math.round(g)}g`)

/** Snacks are compared on the shelf price of an identical pack. */
export function snackBasis(a, b) {
  return a?.price > 0 && b?.price > 0 ? 'pack' : null
}

/** Is `b` the same pack as `a`? Two stated weights must be equal. */
export function samePack(a, b) {
  const wa = snackWeight(a), wb = snackWeight(b)
  if (wa.count && wb.count && wa.count !== wb.count) return false
  if ((wa.count && wb.singleBag) || (wb.count && wa.singleBag)) return false
  if (wa.grams == null || wb.grams == null) return false
  if (wa.source !== 'implied' && wb.source !== 'implied') return Math.abs(wa.grams - wb.grams) < SAME_G
  return Math.abs(wa.grams - wb.grams) / Math.max(wa.grams, wb.grams) <= IMPLIED_TOLERANCE
}

/**
 * May these two listings be compared? The key has already said brand, line,
 * flavour, form and count agree; this checks the numbers and the pack.
 */
export function snackPackCompatible(a, b) {
  for (const [x, label] of [[a, 'this'], [b, 'the other']]) {
    const w = snackWeight(x)
    if (w.flags.includes('CUP_MISMATCH')) {
      return { ok: false, reason: `${label} listing's per-100g price disagrees with its price ÷ weight by ${w.mismatchPct}% — not compared` }
    }
  }
  const wa = snackWeight(a), wb = snackWeight(b)
  // A count stated on both sides must agree: a 6-pack and a 5-pack of the
  // same 120 g are different products. Stated on one side only, the weight
  // decides (Coles' "Kit Kat Muesli Bar 145g" is Woolworths' "5 pack").
  if (wa.count && wb.count && wa.count !== wb.count) {
    return { ok: false, reason: `${wa.count}-pack vs ${wb.count}-pack — a different pack of the same product; shown, not compared` }
  }
  if ((wa.count && wb.singleBag) || (wb.count && wa.singleBag)) {
    return { ok: false, reason: `a ${(wa.count || wb.count)}-pack multipack vs a single share bag — a different pack of the same product; shown, not compared` }
  }
  if (wa.grams == null || wb.grams == null) return { ok: false, reason: 'no pack weight on one side — not compared' }
  if (!samePack(a, b)) {
    return { ok: false, reason: `${fmtSnackG(wa.grams)} vs ${fmtSnackG(wb.grams)} — a different pack size of the same product; shown, not compared` }
  }
  return { ok: true, reason: null }
}

/** Partner order: the same pack first (always, after the guard), then cheapest. */
export function snackPairOrder(product, x, y) {
  const d = (o) => Math.abs((snackWeight(o).grams ?? 1e9) - (snackWeight(product).grams ?? 0))
  return d(x) - d(y) || (x.latest?.price ?? 1e9) - (y.latest?.price ?? 1e9) || String(x.sku).localeCompare(String(y.sku))
}
