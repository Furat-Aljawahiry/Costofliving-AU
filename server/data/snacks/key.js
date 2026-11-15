// The snack match key.
//
//   snack:<brand>:<form>:<token.token...>
//
// e.g. snack:smiths:chip:crinkle_cut.original ·
//      snack:kitkat:confectionery:chocolate.milk.mini
//
// Brand, form and every word of line and flavour are in it; two listings share
// a KEY only when all of those agree. The PACK is not — neither its weight nor
// its count — because the two retailers do not state it the same way:
// Woolworths may give only "5 pack" (weight implied from the per-100g price,
// never exact) where Coles gives only "145g". The pack is checked when a pair
// is compared instead (weights.js): only an identical pack is compared, and the
// product's other packs are shown beside it, not compared.

export function snackKeyFor(p) {
  const s = p.snack
  if (!s || s.kind !== 'snack') return { key: null, group: null, variety: null, source: 'snack', kind: s?.kind || 'unparsed' }
  const body = s.tokens.length ? s.tokens.join('.') : 'plain'
  const key = `snack:${s.brand}:${s.form || 'unknown'}:${body}`
  return { key, group: key, variety: body, source: 'snack', kind: 'snack' }
}
