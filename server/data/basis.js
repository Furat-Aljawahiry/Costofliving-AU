// Unit-price basis: the one axis on which two prices may be compared.
//
// Why this module exists at all. A retailer's own `unit_price_measure` is not a
// safe comparison axis, for two separate reasons measured on the 16 Sep 2026
// captures:
//
//   case diverges   Woolworths writes 1KG / 1EA, Coles 1kg / 1ea
//   bases diverge   both emit 10G, 100G/100g and 1kg — three different
//                   denominators, and Coles adds 100mL and 8 empty strings
//
// So `unitPrice` + `unitMeasure` can only be compared after agreeing on a
// denominator, and case-folding alone is not enough. The CSVs already carry the
// normalised columns that solve this — `price_per_kg_aud`, `price_per_l_aud`,
// `price_per_each_aud` (92.8% coverage at Woolworths, 99.6% at Coles) — so
// every comparison in this codebase is computed on those and never on
// `unitPrice`.
//
// PREFERENCE ORDER is kg > L > each, which is the rule
// `client/src/lib/cheapest.js`'s `beats` already applies ("kg beats ea when
// mixed"). It is not arbitrary: per-kg is immune to fruit size, while per-each
// silently compares a small snack apple to a large loose one. Preferring kg is
// the structural half of the pack-semantics guard in matching.js.
export const BASIS_ORDER = ['kg', 'L', 'each']

// `pack` is the shelf price itself. It is never in BASIS_ORDER and never picked
// by basesOf: only a domain whose key already guarantees an identical pack
// (snacks — see snacks/weights.js) may ask for it.
const FIELD = { kg: 'pricePerKg', L: 'pricePerL', each: 'pricePerEach', pack: 'price' }

// The label the UI prints for a basis ("$4.90/kg").
export const basisLabel = (b) => (b === 'each' ? 'ea' : b)  // 'pack' prints as 'pack'

// What this observation is priced on, best basis first. Usually one entry;
// never assume it is.
export function basesOf(obs) {
  if (!obs) return []
  return BASIS_ORDER.filter((b) => obs[FIELD[b]] != null)
}

export function priceOn(obs, basis) {
  return obs && basis ? (obs[FIELD[basis]] ?? null) : null
}

// The best basis this observation carries, or null when the capture recorded
// none (34 Woolworths rows, 2 Coles rows — `Passionfruit`, `Cauliflower Half`).
export const bestBasisOf = (obs) => basesOf(obs)[0] ?? null

// The best basis BOTH sides carry. null means these two prices cannot be
// compared at all, which is a `strong` match at best — never `exact`.
export function sharedBasis(a, b) {
  const other = new Set(basesOf(b))
  return basesOf(a).find((x) => other.has(x)) ?? null
}

// The best basis present anywhere in a list of observations. Used to pick the
// axis a whole item is ranked on, so that an item whose SKUs span kg and each
// is ranked on kg rather than on whichever SKU happened to sort first.
export function bestBasisAcross(list) {
  const seen = new Set()
  for (const o of list) for (const b of basesOf(o)) seen.add(b)
  return BASIS_ORDER.find((b) => seen.has(b)) ?? null
}

/**
 * Cheapest of `skus` on `basis`, with a stated tie-break.
 *
 * The tie-break is not decoration. Coles sells `4438477` (Pink Lady Apples 1kg)
 * and `5111654` (Pink Lady Apples Medium, approx. 200g) at exactly $4.90/kg on
 * 16 Sep. Without a rule the winner depends on map iteration order, and a
 * winner that flips between runs makes the P2.3 daily series jitter for a
 * reason that has nothing to do with price.
 *
 * Order: available first, then cheaper, then larger net size, then lower SKU.
 * `pick` reads the observation off each candidate.
 */
export function cheapestOn(skus, basis, pick = (s) => s.latest) {
  const priced = skus.filter((s) => priceOn(pick(s), basis) != null)
  if (!priced.length) return null
  return priced.slice().sort((a, b) => {
    const oa = pick(a), ob = pick(b)
    return (ob.isAvailable === true) - (oa.isAvailable === true)
      || priceOn(oa, basis) - priceOn(ob, basis)
      || (b.netSizeValue ?? 0) - (a.netSizeValue ?? 0)
      || String(a.sku).localeCompare(String(b.sku))
  })[0]
}
