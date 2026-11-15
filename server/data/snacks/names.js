// A snack or confectionery product name, pulled apart.
//
//   parseSnackName("Smith's Crinkle Cut Potato Chips Original", { brand: "Smith's", packageSize: '170g' })
//     -> { brand: 'smiths', form: 'chip', tokens: ['crinkle_cut', 'original'],
//          count: null, sizeG: 170, kind: 'snack', ... }
//
// The rules, in order:
//   1. Brand. The brand column, canonicalised (lexicon.js BRAND_ALIASES), with a
//      parent company replaced by the sub-brand the name opens with ("Nestle" +
//      "Kit Kat Chunky" -> kitkat). Then the brand is cut from the front of the
//      name: Woolworths repeats it there ("Arnott's Tim Tam ..."), Coles does
//      not ("Tim Tam ..."). Own-label brands become `house-<retailer>`.
//   2. Size and count, from the package string first and the name second.
//      Woolworths writes "20g x 6 pack" (per unit), "180g 12 pack" (total) or
//      just "5 pack"; Coles writes the total weight and puts the count in the
//      name ("Share Pack 11 Pieces").
//   3. Phrases to single tokens (lexicon.js PHRASES).
//   4. The form (chip, cracker, biscuit, lolly, ...) from the name's own form
//      word, else from the retailer's subcategory. Form words leave the name.
//   5. Whatever is left, singular, packaging words out, sorted: the tokens.
//      An unknown word is kept, so it can only stop a match (lexicon.js).
import {
  HOUSE_BRANDS, BRAND_ALIASES, BRAND_WITH_LINE, PARENT_BRANDS, SUB_BRANDS, PHRASES, FORM_WORDS, FORM_FROM_SUBCATEGORY, IGNORABLE,
  DEFAULT_WORDS, REDUNDANT_IN_FORM, REDUNDANT_IN_MULTIPACK, REDUNDANT_WITH, BRAND_WORDS, KEPT_IN_FORM,
} from './lexicon.js'

export const norm = (s) => String(s || '')
  .toLowerCase()
  .replace(/[’'`]/g, '')
  .replace(/[éè]/g, 'e')
  .replace(/&/g, ' and ')
  .replace(/(\d)\s*%/g, '$1pct ')
  .replace(/[^a-z0-9.\s]/g, ' ')
  .replace(/(^|\s)\.|\.(\s|$)/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

// "the natural confectionery co" -> "thenaturalconfectioneryco"; "macy and
// tailor" and "macy tailor" both -> "macytailor".
export const compactBrand = (s) => norm(s).split(' ').filter((w) => w && w !== 'and').join('')

const IRREGULAR = { minis: 'mini', tinies: 'tiny', cookies: 'cookie', pieces: 'piece', chives: 'chive', berries: 'berry', cherries: 'cherry', strawberries: 'strawberry', raspberries: 'raspberry', blueberries: 'blueberry', cranberries: 'cranberry', jellies: 'jelly', lollies: 'lolly', patties: 'patty', candies: 'candy' }
function singular(t) {
  if (IRREGULAR[t]) return IRREGULAR[t]
  if (t.includes('_') || /\d/.test(t)) return t
  if (t.length >= 4 && /s$/.test(t) && !/(ss|us|is|ous)$/.test(t)) return t.slice(0, -1)
  return t
}

const GRAMS = { g: 1, kg: 1000, ml: 1, l: 1000 }
const toGrams = (v, u) => Number(v) * GRAMS[u.toLowerCase()]
const W = '(\\d+(?:\\.\\d+)?)\\s*(kg|g|ml|l)\\b'

/** "20g x 6 pack", "180g 12 pack", "5 pack", "1.1 kg", "320mL". */
export function parseSnackPack(raw) {
  const s = String(raw || '').trim().toLowerCase().replace(/\s+/g, ' ')
  let m
  if ((m = s.match(new RegExp(`^${W}\\s*x\\s*(\\d+)\\s*(pack|pk)?\\b`)))) {
    return { grams: toGrams(m[1], m[2]) * Number(m[3]), unitG: toGrams(m[1], m[2]), count: Number(m[3]), liquid: /ml|^l$/.test(m[2]) }
  }
  if ((m = s.match(new RegExp(`^${W}\\s+(\\d+)\\s*(pack|pk)\\b`)))) {
    return { grams: toGrams(m[1], m[2]), unitG: null, count: Number(m[3]), liquid: /ml|^l$/.test(m[2]) }
  }
  if ((m = s.match(new RegExp(`^${W}$`)))) return { grams: toGrams(m[1], m[2]), unitG: null, count: null, liquid: /ml|^l$/.test(m[2]) }
  if ((m = s.match(/^(\d+)\s*(pack|pk)$/))) return { grams: null, unitG: null, count: Number(m[1]), liquid: false }
  return { grams: null, unitG: null, count: null, liquid: false }
}

// Counts said in the name: "11 Pieces", "8 Pack", "3pk", "6 Twin Bars".
const COUNT_RE = /\b(\d+)\s*(pack|pk|pieces|piece|pcs|pc|count|ct|bags|packets|sachets|twin bars|bars|serves)\b/
const NAME_UNIT_X_RE = new RegExp(`\\b(\\d+)\\s*x\\s*${W}`)
const NAME_X_UNIT_RE = new RegExp(`\\b${W}\\s*x\\s*(\\d+)\\b`)
const NAME_WEIGHT_RE = new RegExp(`\\b${W}`)

const FORM_LIST = Object.entries(FORM_WORDS)
  .flatMap(([form, words]) => words.map((w) => [form, w]))
  .sort((a, b) => b[1].length - a[1].length)

function houseOf(retailer, brandNorm) {
  for (const [r, list] of Object.entries(HOUSE_BRANDS)) {
    if (retailer && r !== retailer) continue
    if (list.includes(brandNorm)) return r
  }
  return null
}

// Cut `brand` from the front of `s` (both normalised). Word by word, comparing
// compacted text, so "kit kat" in the name removes brand "kitkat" and "the
// natural confectionery co" removes "The Natural Confectionery Co.".
function stripLeading(s, compact) {
  if (!compact) return s
  const words = s.split(' ')
  let acc = ''
  for (let i = 0; i < words.length && acc.length < compact.length; i++) {
    if (words[i] === 'and') continue
    acc += words[i]
    if (acc === compact) return words.slice(i + 1).join(' ')
  }
  return s
}

export function parseSnackName(rawName, ctx = {}) {
  const retailer = ctx.retailer || null
  let s = norm(rawName)
  const brandNorm = norm(ctx.brand)
  let compact = compactBrand(ctx.brand)
  const line = []
  // The brand's own words. They are identity, already in `brand`, and never
  // product words: Red Rock Deli's "Deli Style Crackers" is "Style Crackers"
  // at both retailers, whichever one repeats the brand in the name.
  const brandWords = new Set(brandNorm.split(' ').filter((w) => w.length > 1))

  // 1. Brand.
  const house = houseOf(retailer, brandNorm)
  s = stripLeading(s, compact)
  if (BRAND_WITH_LINE[compact]) {
    line.push(...BRAND_WITH_LINE[compact].line)
    for (const w of BRAND_WITH_LINE[compact].line) brandWords.delete(w)
    compact = BRAND_WITH_LINE[compact].brand
    s = stripLeading(s, compact)
  }
  if (PARENT_BRANDS.includes(compact)) {
    for (const [phrase, sub] of Object.entries(SUB_BRANDS).sort((a, b) => b[0].length - a[0].length)) {
      if (s === phrase || s.startsWith(`${phrase} `)) {
        compact = sub
        s = s.slice(phrase.length).trim()
        for (const w of phrase.split(' ')) brandWords.add(w)
        break
      }
    }
  }
  // Woolworths sometimes repeats the brand after a sub-range ("Woolworths
  // Crinkle Cut Chips Original Crinkle Cut Original"); a second leading copy
  // of the brand goes too.
  s = stripLeading(s, compact)
  const brand = house ? `house-${house}` : (BRAND_ALIASES[compact] || compact || null)
  const brandCompact = house ? null : compact
  for (const w of BRAND_WORDS[brand] || []) brandWords.add(w)

  // 2. Size and count.
  const pack = parseSnackPack(ctx.packageSize)
  let nameWeight = null, nameCount = null, m
  if ((m = s.match(NAME_UNIT_X_RE))) { nameCount = Number(m[1]); nameWeight = toGrams(m[2], m[3]) * nameCount; s = s.replace(m[0], ' ') }
  else if ((m = s.match(NAME_X_UNIT_RE))) { nameCount = Number(m[3]); nameWeight = toGrams(m[1], m[2]) * nameCount; s = s.replace(m[0], ' ') }
  while ((m = s.match(NAME_WEIGHT_RE))) { nameWeight ??= toGrams(m[1], m[2]); s = s.replace(m[0], ' ') }
  while ((m = s.match(COUNT_RE))) {
    nameCount ??= Number(m[1])
    // "6 Twin Bars": the count goes, the variant word stays.
    s = s.replace(m[0], m[2] === 'twin bars' ? ' twin ' : ' ')
  }
  const count = pack.count ?? nameCount ?? null
  // A listing that calls itself one big bag ("Party Bag", "Share Bag",
  // "Family Size") is a single pack, whatever it weighs. Without this, Smith's
  // 380g Party Bag paired with Coles' 380g 20-pack lunchbox multipack: same
  // brand, flavour and weight, a different product. (A "Sharepack" is
  // Cadbury's word for a bag of mini bars, i.e. a multipack — not listed.)
  const singleBag = !count && /\b(party|share|sharing|family) (bag|size|pack)\b/.test(s)
  const sizeG = pack.grams ?? nameWeight ?? null
  const sizeSource = pack.grams != null ? 'package' : nameWeight != null ? 'name' : null

  // 3. Phrases.
  s = ` ${s.replace(/\s+/g, ' ').trim()} `
  for (const [re, to] of PHRASES) s = s.replace(re, to ? ` ${to} ` : ' ')

  // 4. Form.
  let form = null, formSource = null
  let firstAt = Infinity
  for (const [f, w] of FORM_LIST) {
    const at = s.indexOf(` ${w} `)
    if (at >= 0 && at < firstAt) { firstAt = at; form = f; formSource = 'name' }
  }
  for (const [, w] of FORM_LIST) s = s.split(` ${w} `).join(' ')
  if (!form) {
    const sub = norm(ctx.subcategory)
    for (const [re, f] of FORM_FROM_SUBCATEGORY) if (re.test(sub)) { form = f; formSource = 'subcategory'; break }
  }

  // 5. Tokens. Then the words that say nothing here (lexicon.js): the
  // default flavour, the brand's own words, words redundant in this form or in
  // a multipack, and a word made redundant by a more specific one.
  const multipack = (count ?? 0) > 1
  const raw = new Set([...line, ...s.split(' ')]
    .filter(Boolean)
    .map(singular)
    .filter((t) => (!IGNORABLE.has(t) || KEPT_IN_FORM[form]?.has(t)) && !DEFAULT_WORDS.has(t)))
  for (const [word, drops] of Object.entries(REDUNDANT_WITH)) if (raw.has(word)) for (const d of drops) raw.delete(d)
  const tokens = [...raw]
    // A brand word is dropped however the retailer spaced the brand: Coles
    // "5 Gum", Woolworths "5Gum" — so a word the compacted brand starts or
    // ends with counts too (3+ letters, so a stray "co" never does).
    .filter((t) => line.includes(t) || !(brandWords.has(t) || (t.length >= 3 && brandCompact && (brandCompact.startsWith(t) || brandCompact.endsWith(t)))))
    .filter((t) => !REDUNDANT_IN_FORM[form]?.has(t))
    .filter((t) => !(multipack && REDUNDANT_IN_MULTIPACK.has(t)))
    .sort()

  const kind = !brand ? 'unparsed' : 'snack'
  // Same item, any pack: the single bag and the multipack sit on one card.
  const itemKey = brand ? [brand, form || 'unknown', ...tokens].join('|') : null
  return {
    brand, isHouseBrand: !!house, form, formSource, tokens,
    count: count && count > 1 ? count : null, singleBag, sizeG, sizeSource, unitG: pack.unitG, liquid: pack.liquid,
    nameWeight, kind, itemKey,
    itemName: cleanItemName(rawName),
  }
}

// The name as shown on a size-grouped card: the retailer's own words, weight
// and count taken out because the size chips carry them.
function cleanItemName(raw) {
  return String(raw || '')
    .replace(/\b\d+(?:\.\d+)?\s*(kg|g|ml|l)\b(\s*x\s*\d+)?/gi, '')
    .replace(/\b\d+\s*(pack|pk)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** The measurement slot on a card: "170g", "6 × 20g", "12 pack · 180g". */
export function snackSizeLabel(packageSizeRaw) {
  const p = parseSnackPack(packageSizeRaw)
  const unit = p.liquid ? 'mL' : 'g'
  const fmt = (g) => (g >= 1000 ? `${Math.round(g / 10) / 100}${p.liquid ? 'L' : 'kg'}` : `${Math.round(g)}${unit}`)
  if (p.unitG && p.count) return `${p.count} × ${fmt(p.unitG)}`
  if (p.count && p.grams) return `${p.count} pack · ${fmt(p.grams)}`
  if (p.count) return `${p.count} pack`
  if (p.grams) return fmt(p.grams)
  return String(packageSizeRaw || '').trim() || null
}
