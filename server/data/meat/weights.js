// Grams, for meat, poultry & seafood. How much is in the pack, how sure we are
// of that, and whether two packs are close enough in size to be compared.
//
// WHAT THE 18 OCT DISCOVERY CRAWL SHOWED (data/MEAT_DISCOVERY.md)
// --------------------------------------------------------------
// The two retailers state weight in three incompatible ways, and in two of them
// the shelf price is NOT the price of the stated weight:
//
//   Coles   "approx. 1.65kg"     variable weight. price = $/kg × 1.65 kg — an
//                                ESTIMATE; 144 of 146 such rows check out.
//   Woolies "1.1kg - 1.7kg"      a weight RANGE. price = $/kg × 1.7 kg — the
//                                TOP of the range, on 95 of 95 rows. The crawler
//                                records the BOTTOM (1.1) as net_size, which is
//                                why 96 Woolworths rows carry CUP_PRICE_MISMATCH.
//   Woolies "per 100g"/"per 350g" a service-counter line. price IS the $/kg.
//   both    "500g", "1Kg"         a fixed pack. price = the pack.
//
// So the shelf price is useless for comparing meat across retailers, and the
// only figure both retailers charge on honestly is the per-kg price (the cup
// price, `price_per_kg_aud`). Meat is therefore compared per kg and nothing
// else. The weight is still needed, for two reasons:
//
//   1. Size. A 1 kg tray is cheaper per kg than a 500 g one. Comparing them
//      reads as "X is 15% cheaper" when the difference is the pack, not the
//      shop. Packs more than PACK_RATIO apart are shown side by side, per kg,
//      with NO headline — the decision taken with the user on 18 Oct.
//   2. Sanity. price ÷ weight should land on the cup price. When it does not,
//      one of the three numbers is wrong (the Coles "approx. 1.02g" loin chops,
//      a stale cup string), and a comparison built on it must not be shown.
//
// This module recomputes all of it from package_size_raw + price + cup price
// at load time rather than trusting net_size_value, so fixing the rules here
// replays across the whole archive without a re-crawl.

// Heavier ÷ lighter. ≤ 1.5 is "the same size of pack" (500 g vs 700 g, a
// 1.6 kg vs a 2.2 kg chicken). The cut is a ratio, not a set of tiers, so there
// is no cliff at a band edge (740 g vs 760 g).
export const PACK_RATIO = 1.5

// |price ÷ weight − cup| ÷ cup. Up to 5% is rounding and "approx"; 5–20% is
// flagged in the review lists; above 20% one of the numbers is wrong and the
// row is never compared.
export const CUP_OK = 0.05
export const CUP_REFUSE = 0.2

// Name weight vs package weight. They should be the same number.
const WEIGHT_CONFLICT = 0.05

const grams = (v, u) => Number(v) * (/kg/i.test(u) ? 1000 : 1)
const NUM = '(\\d+(?:\\.\\d+)?)'
const UNIT = '\\s*(kg|g)\\b'

/**
 * Read a package_size_raw string.
 *
 *   mode          fixed | variable-pack | per-kg | count-only
 *   weightG       the weight used for SIZE comparisons (range midpoint)
 *   priceWeightG  the weight the shelf price was computed on (range top)
 *   rangeG        [lo, hi] for a range, else null
 *   count         "N pack" when stated
 */
export function parsePackSize(raw) {
  const s = String(raw || '').trim().toLowerCase().replace(/\s+/g, ' ')
  const count = Number(s.match(/(\d+)\s*pack\b/)?.[1]) || null
  let m
  // Service counter: "per 100g". The price is per kg; the figure is a typical
  // serve, not a pack — the shopper chooses the amount.
  if ((m = s.match(new RegExp(`^per ${NUM}${UNIT}`)))) {
    return { mode: 'per-kg', weightG: null, priceWeightG: 1000, rangeG: null, count, counterG: grams(m[1], m[2]) }
  }
  // "2 x 500g": a multipack whose weight is the total.
  if ((m = s.match(new RegExp(`^(\\d+) ?x ?${NUM}${UNIT}`)))) {
    const g = Number(m[1]) * grams(m[2], m[3])
    return { mode: 'fixed', weightG: g, priceWeightG: g, rangeG: null, count: Number(m[1]) }
  }
  // Woolworths range: "380g - 800g", "1.1kg -1.4kg", "2.5kg - 4.6 kg".
  if ((m = s.match(new RegExp(`^${NUM}${UNIT}\\s*-\\s*${NUM}${UNIT}`)))) {
    const lo = grams(m[1], m[2]), hi = grams(m[3], m[4])
    return { mode: 'variable-pack', weightG: (lo + hi) / 2, priceWeightG: hi, rangeG: [lo, hi], count }
  }
  // Coles approximate weight: "approx. 1.65kg", "approx 1kg", "approx. 488g each".
  if ((m = s.match(new RegExp(`^approx\\.? ?${NUM}${UNIT}`)))) {
    const g = grams(m[1], m[2])
    return { mode: 'variable-pack', weightG: g, priceWeightG: g, rangeG: null, count }
  }
  if ((m = s.match(new RegExp(`^${NUM}${UNIT}`)))) {
    const g = grams(m[1], m[2])
    return { mode: 'fixed', weightG: g, priceWeightG: g, rangeG: null, count }
  }
  // "12 pack", "each", "250mL": no weight at all.
  return { mode: 'count-only', weightG: null, priceWeightG: null, rangeG: null, count }
}

/**
 * Everything the matcher and the review lists need to know about one product's
 * weight, from its package string, the weight in its name, and its latest
 * observation. Pure; memoised on the product by latest run.
 */
export function weightInfo(p) {
  const latest = p.latest || {}
  const memo = p._weightInfo
  if (memo && memo.runId === latest.runId) return memo
  const pack = parsePackSize(p.packageSize)
  const nameG = p.meat?.nameWeight ?? null
  const flags = []

  let weightG = pack.weightG, priceWeightG = pack.priceWeightG, source = weightG != null ? 'package' : null
  if (weightG == null && pack.mode !== 'per-kg' && nameG != null) {
    weightG = priceWeightG = nameG
    source = 'name'
  }
  // The name and the package should agree. For a range, inside the range is
  // agreement.
  if (pack.weightG != null && nameG != null) {
    const inRange = pack.rangeG && nameG >= pack.rangeG[0] * 0.95 && nameG <= pack.rangeG[1] * 1.05
    // "2 x 500g" in the name and on the pack: the name states one of the two.
    const perUnit = pack.count && Math.abs(nameG * pack.count - pack.weightG) / pack.weightG <= WEIGHT_CONFLICT
    if (!inRange && !perUnit && Math.abs(nameG - pack.weightG) / pack.weightG > WEIGHT_CONFLICT) flags.push('WEIGHT_CONFLICT')
  }

  // A zero is "no price" (Woolworths writes 0 for an unavailable line), never $0.
  const price = latest.price > 0 ? latest.price : null
  const cupKg = latest.pricePerKg > 0 ? latest.pricePerKg : null
  let mode = pack.mode
  if (mode === 'count-only' && weightG != null) mode = 'fixed'
  // Weight implied by the two prices, as a last resort for a variable-weight
  // line that states none.
  if (weightG == null && mode !== 'per-kg' && price && cupKg) {
    weightG = priceWeightG = (price / cupKg) * 1000
    source = 'implied'
  }

  let derivedKg = null, mismatch = null
  if (price != null && priceWeightG) {
    derivedKg = price / (priceWeightG / 1000)
    if (cupKg) mismatch = Math.abs(derivedKg - cupKg) / cupKg
  }
  if (mismatch != null && mismatch > CUP_REFUSE) flags.push('CUP_MISMATCH')
  else if (mismatch != null && mismatch > CUP_OK) flags.push('CUP_DRIFT')
  if (cupKg == null) flags.push('NO_KG_PRICE')

  const info = {
    runId: latest.runId, mode, weightG: weightG != null ? Math.round(weightG) : null,
    priceWeightG: priceWeightG != null ? Math.round(priceWeightG) : null,
    rangeG: pack.rangeG, count: pack.count ?? p.meat?.count ?? null, source,
    nameWeightG: nameG, cupKg, derivedKg: derivedKg != null ? Math.round(derivedKg * 100) / 100 : null,
    mismatchPct: mismatch != null ? Math.round(mismatch * 1000) / 10 : null, flags,
  }
  Object.defineProperty(p, '_weightInfo', { value: info, writable: true, configurable: true, enumerable: false })
  return info
}

export const fmtG = (g) => (g == null ? 'no weight' : g >= 1000 ? `${Math.round(g / 10) / 100}kg` : `${Math.round(g)}g`)

/** Heavier ÷ lighter, or null when either side has no pack weight. */
export function sizeRatio(a, b) {
  const wa = weightInfo(a), wb = weightInfo(b)
  if (wa.mode === 'per-kg' || wb.mode === 'per-kg') return 1
  if (!wa.weightG || !wb.weightG) return null
  return Math.max(wa.weightG, wb.weightG) / Math.min(wa.weightG, wb.weightG)
}

/** Meat is compared per kg or not at all. */
export function meatBasis(a, b) {
  return a?.pricePerKg > 0 && b?.pricePerKg > 0 ? 'kg' : null
}

/**
 * May these two packs be compared? Order of the checks is the order of how
 * badly each failure would mislead: a wrong number first, then a wrong size.
 */
export function meatPackCompatible(a, b) {
  for (const [x, label] of [[a, 'this'], [b, 'the other']]) {
    const w = weightInfo(x)
    if (w.flags.includes('WEIGHT_CONFLICT')) {
      return { ok: false, reason: `${label} listing states two different weights (${fmtG(w.nameWeightG)} in the name, ${x.packageSize} on the pack) — not compared` }
    }
    if (w.flags.includes('CUP_MISMATCH')) {
      return { ok: false, reason: `${label} listing's per-kg price disagrees with its price ÷ weight by ${w.mismatchPct}% — not compared` }
    }
  }
  const wa = weightInfo(a), wb = weightInfo(b)
  // A counter line is bought by the amount, so its "size" is whatever the
  // shopper asks for: per kg against any pack is like-for-like.
  if (wa.mode === 'per-kg' || wb.mode === 'per-kg') return { ok: true, reason: null }
  const r = sizeRatio(a, b)
  if (r == null) return { ok: false, reason: 'no pack weight on one side — not compared' }
  if (r > PACK_RATIO) {
    return {
      ok: false,
      reason: `${fmtG(wa.weightG)} vs ${fmtG(wb.weightG)} — pack sizes differ (${Math.round(r * 10) / 10}×), and bulk packs are priced differently per kg; both shown, not compared`,
    }
  }
  return { ok: true, reason: null }
}

/**
 * Sort order for picking the comparison partner: closest size, then cheapest
 * per kg. A service-counter line is comparable with any pack, but it is the
 * partner of last resort: a packaged line of about the same size is the fairer
 * comparison, so a counter line ranks just behind the edge of the size band.
 */
const COUNTER_DISTANCE = Math.log(PACK_RATIO) + 1e-6
function distance(product, other) {
  if (weightInfo(product).mode === 'per-kg' || weightInfo(other).mode === 'per-kg') {
    // Both counter lines: as close as can be.
    return weightInfo(product).mode === weightInfo(other).mode ? 0 : COUNTER_DISTANCE
  }
  return Math.abs(Math.log(sizeRatio(product, other) ?? 1e9))
}
export function meatPairOrder(product, x, y) {
  const dx = distance(product, x)
  const dy = distance(product, y)
  if (Math.abs(dx - dy) > 1e-9) return dx - dy
  return (x.latest?.pricePerKg ?? 1e9) - (y.latest?.pricePerKg ?? 1e9) || String(x.sku).localeCompare(String(y.sku))
}

/** Display tier — a label only, never a gate. */
export function sizeTier(g) {
  if (g == null) return null
  return g < 400 ? 'S' : g <= 750 ? 'M' : g <= 1500 ? 'L' : 'Bulk'
}
