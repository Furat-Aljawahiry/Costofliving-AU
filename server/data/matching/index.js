// Cross-retailer product matching (ROADMAP P2.1).
//
// Turns "this Woolworths SKU" into "and here is the same thing at Coles, at this
// price, and here is whether those two numbers may honestly be compared".
//
// WHERE THIS RUNS, AND WHY IT IS NOT IN THE LAMBDA
// -----------------------------------------------
// LAMBDA_OUTPUT_SPEC.md §2 draws the line: L0/L1 are capture and pure
// derivation, written by the Lambda and immutable; L2 is curated mapping, which
// "lives server-side so it can be changed and replayed against all captured
// history". The variety lexicon is curated judgement that will be wrong and will
// change weekly for months, so it is L2 — here, in JS, derived at load. A rule
// change is then a server reload and the entire archive back to 28 Aug re-matches;
// had the key been written into the CSVs at capture time, every change would
// either orphan the archive or need a re-crawl of days that no longer exist.
// This is the same argument that already makes `basket_item_id` an empty column.
//
// `canonical_group`, by contrast, IS L1 — pure, cheap, recomputable — and the
// Lambda already computes it. groups.js prefers the Lambda's own answer and only
// falls back to a name, so there is no second vocabulary to drift.
//
// THE KEY
//   match_key = <group>:<variety>[:organic][:imperfect]
//
// e.g. apples:pink-lady · apples:pink-lady:organic · potatoes:brushed:imperfect
//
// CONFIDENCE LEVELS ARE PERMISSIONS, NOT LABELS
//   exact       same key, a shared basis, compatible pack semantics -> MAY be compared
//   strong      same key, no shared basis or pack semantics differ   -> show both, compare neither
//   group-only  same group, variety differs or is null               -> browse link only
//   unmatched   no counterpart                                       -> say so
//
// Called "levels" rather than "tiers" to stay distinct from spec §8.1's four
// matching *tiers* (GTIN / allowlist / attribute rule / unmatched), which are a
// different ladder about basket mapping.
import { basesOf, priceOn, sharedBasis, cheapestOn, basisLabel, BASIS_ORDER } from '../basis.js'
import { buildSubcategoryMap, groupFor, isProduce } from './groups.js'
import { varietyFor, GROUPS_WITH_LEXICON } from './varieties.js'
import { OVERRIDES } from './overrides.js'
import { aliasToken, aliasVariety } from './aliases.js'
import { meatKeyFor } from '../meat/key.js'
import { meatBasis, meatPackCompatible, meatPairOrder } from '../meat/weights.js'
import { snackKeyFor } from '../snacks/key.js'
import { snackBasis, snackPackCompatible, snackPairOrder } from '../snacks/weights.js'
import { runKey } from '../categories.js'

// The domains with their own parser and key (server/data/meat/, snacks/). Each
// one decides its own comparison basis, its own pack guard and how a partner
// is chosen; every other rule in this file — liveness, availability on BOTH
// sides, capture skew, overrides — is shared. Produce is the default path and
// is not in this table (its one-sided checks are a recorded open question,
// docs/MEAT_DATA_TODO.md).
const DOMAIN_RULES = {
  meat: {
    prefix: 'meat:', keyFor: meatKeyFor, basis: meatBasis, pack: meatPackCompatible, pairOrder: meatPairOrder,
    noBasis: 'no per-kg price on one side (sold per pack or each with no weight) — not compared',
    noKey: (p, retailer) => `no ${String(p.matchVariety || '').replace(/-/g, ' ')} at ${retailer} in the latest capture`,
  },
  snacks: {
    prefix: 'snack:', keyFor: snackKeyFor, basis: snackBasis, pack: snackPackCompatible, pairOrder: snackPairOrder,
    noBasis: 'no shelf price on one side at capture — not compared',
    noKey: (p, retailer) => `no listing of this exact product (same brand, flavour and pack count) at ${retailer} in the latest capture — related lines shown, not compared`,
  },
}
export const rulesFor = (p) => DOMAIN_RULES[p?.domain] || null
const domainOfKey = (k) => Object.entries(DOMAIN_RULES).find(([, r]) => String(k).startsWith(r.prefix))?.[0] || 'produce'

// The ladder, most confident first. Exported as the canonical order for any
// caller that needs to sort or compare levels.
export const LEVELS = ['exact', 'strong', 'group-only', 'unmatched']

// How far apart two captures may be and still be called one comparison. Both
// retailers are crawled twice daily, so same-day captures sit well inside this;
// a day-apart pair is shown but not compared, because a price that moved
// overnight is not a price difference between shops.
const MAX_CAPTURE_SKEW_HOURS = 24

// Hand-set spelling fixes are applied here, once, before anything looks a token
// up — so the lexicon, the residual rule and the veto all see the corrected
// form and none of them needs to know the alias exists. See aliases.js.
const keyTokensOf = (p) => String(p.itemKey || '').split('|').filter(Boolean).map(aliasToken)
const tokensOf = (p) => [
  ...keyTokensOf(p),
  ...String(p.brand || '').toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean).map(aliasToken),
]

/** `group:variety[:organic][:imperfect]`, or null when this row cannot carry one. */
export function matchKeyFor(product, subMap) {
  // Meat, poultry & seafood have their own parser and key (server/data/meat/).
  // The dispatch sits ahead of every produce rule so neither vocabulary can
  // reach the other's rows; keys are namespaced `meat:` so they cannot collide.
  const rules = rulesFor(product)
  if (rules) return rules.keyFor(product)
  // A row from a crawled category nobody has written a matcher for yet
  // (categories.js returns `unknown:<id>`) gets nothing — falling through to the
  // produce rules would publish it as fruit and veg.
  if (product.domain && product.domain !== 'produce') return { key: null, group: null, variety: null, source: 'unknown-category', kind: 'unclassified' }
  const g = groupFor(product, subMap)
  // Only produce is matched. The two crawls do not cover the same shelf — Coles'
  // carries 16 non-produce rows (cut flowers, walnuts, sauces) in six groups
  // Woolworths has none of — and running a produce variety lexicon over cut
  // flowers is how a matcher files things confidently and wrongly.
  if (!isProduce(g)) return { key: null, ...g, variety: null }
  // Brand tokens count for FINDING a variety (Woolworths keeps the cultivar
  // there) but not for the residual rule, which asks what the NAME left
  // unexplained — a brand is never an unexplained word.
  // aliasVariety collapses a named default cultivar onto the implied one
  // ("Cavendish Bananas" -> banana), AFTER the lexicon has done its work, so the
  // residual rule still sees the specific tokens the name actually carried.
  const variety = aliasVariety(g.group, varietyFor(g.group, tokensOf(product), keyTokensOf(product)))
  if (!variety) return { key: null, ...g, variety: null }
  const parts = [g.group, variety]
  if (product.isOrganic) parts.push('organic')
  if (product.imperfect) parts.push('imperfect')
  return { key: parts.join(':'), ...g, variety }
}

/**
 * Pack semantics, for per-each comparisons only.
 *
 * This guard exists because of a real pair in the 16 Sep captures that the naive
 * "same key + same basis" rule gets dangerously wrong:
 *
 *   W 105919  Fresh Pink Lady Apples        $1.31 / each   one loose apple
 *   C 2022580 Grab N Glow Pink Lady 6-pack  $1.25 / each   one small snack apple
 *
 * Same key, same basis, and a 5%-cheaper headline comparing different-sized
 * fruit. Per-kg comparisons are immune to this, which is the deeper reason
 * basis.js prefers kg; per-each ones need the pack to line up.
 *
 * `sizeGrade` is frequently null, and treating null as "compatible with
 * anything" would reopen the hole while treating it as incompatible would discard
 * many honest matches. The rule taken here: a *stated disagreement* blocks;
 * silence does not. So medium-vs-large blocks, medium-vs-null does not.
 */
// Grams of packed weight a listing declares, from the name first and the net
// size second. Only weights at or above PACK_GRAMS count: below that the figure
// is an approximate weight for ONE piece of fruit (`approx. 170g`), which is not
// a pack at all and must not disqualify two loose lines from comparing.
// Pack formats that hold MORE THAN ONE piece. `loose` and `each` are the single
// piece; everything else here is a bundle whose per-each price is the price of
// the whole bundle, not of one item.
const BUNDLE_FORMATS = new Set(['bunch', 'pack', 'multipack', 'prepack', 'bag', 'punnet', 'tray', 'box', 'net', 'packet', 'bulk'])

const PACK_GRAMS = 400
function packWeightGrams(p) {
  const m = String(p.nameWeight || '').match(/^(\d+(?:\.\d+)?)(kg|g|ml|l)$/i)
  let g = null
  if (m) g = Number(m[1]) * (/^(kg|l)$/i.test(m[2]) ? 1000 : 1)
  else if (p.netSizeValue != null && /^(kg|g)$/i.test(p.netSizeUom || '')) {
    g = p.netSizeValue * (/kg/i.test(p.netSizeUom) ? 1000 : 1)
  }
  return g != null && g >= PACK_GRAMS ? g : null
}

export function packCompatible(a, b, basis) {
  const rules = rulesFor(a)
  if (rules) return rules.pack(a, b)
  if (basis !== 'each') return { ok: true, reason: null }

  // A bulk weight priced per "each" is the nastiest version of this trap,
  // because nothing in the structured columns gives it away. Coles lists
  // `Royal Gala Apples 1kg` (sku 4433462) with package_size_raw "1 each",
  // net_size "1ea", sold_by "each" and price_per_each $7.90 — the only place the
  // kilo appears is the product NAME. Against Woolworths' single loose Royal Gala
  // at $1.26/ea that produced a +527% "Woolworths is cheaper" reading on a live
  // page. The multipack guard could not see it: multipack is null on both sides.
  const wa = packWeightGrams(a), wb = packWeightGrams(b)
  if (wa !== wb) {
    const say = (w) => (w == null ? 'a single unit' : w >= 1000 ? `${w / 1000}kg` : `${w}g`)
    return { ok: false, reason: `priced per each but one listing is ${say(wa)} and the other ${say(wb)}` }
  }

  const am = a.multipack ?? 1, bm = b.multipack ?? 1
  if (am !== bm) {
    return { ok: false, reason: `${am === 1 ? 'single' : `${am}-pack`} vs ${bm === 1 ? 'single' : `${bm}-pack`} — pack sizes differ` }
  }

  // A bundle is not a single piece. `Beetroot Bunch` against `Beetroot Loose`,
  // both priced per each, read +360% — the bunch is several beetroot and the
  // loose line is one. Same shape as the multipack trap, but the count lives in
  // the pack FORMAT rather than in a number, so multipack could not see it.
  const bundle = (x) => BUNDLE_FORMATS.has(x.packFormat)
  if (bundle(a) !== bundle(b)) {
    const say = (x) => (bundle(x) ? `a ${x.packFormat}` : 'a single piece')
    return { ok: false, reason: `priced per each but one listing is ${say(a)} and the other ${say(b)}` }
  }
  if (a.sizeGrade && b.sizeGrade && a.sizeGrade !== b.sizeGrade) {
    return { ok: false, reason: `graded ${a.sizeGrade} vs ${b.sizeGrade} — different fruit size` }
  }
  if (a.portion !== b.portion && (a.portion || 'whole') !== (b.portion || 'whole')) {
    return { ok: false, reason: `${a.portion || 'whole'} vs ${b.portion || 'whole'} — different portion` }
  }
  return { ok: true, reason: null }
}

const hoursBetween = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 36e5

/**
 * Build the whole match index: match_key -> { retailer -> [skus] }, plus the
 * per-retailer freshness facts the expiry rule needs.
 *
 * `liveRuns` is `retailer:category` -> runId of the newest usable run, from the loader. A
 * SKU absent from its retailer's newest run has not been seen on that shelf
 * today, and `p.latest` alone cannot tell you that — it happily returns a price
 * from a week ago, which is how a delisted line keeps being compared forever.
 */
export function buildMatchIndex(products, cheapestSets, liveRuns) {
  const { map: subMap, ambiguous } = buildSubcategoryMap(cheapestSets)
  const byKey = new Map()
  const byGroup = new Map()
  const stats = {
    produce: 0, nonProduce: 0, keyed: 0, noVariety: 0, noGroup: 0,
    groupSources: {}, noVarietyByGroup: {}, groupsWithoutLexicon: new Set(),
    subcategoryMapSize: subMap.size, ambiguousSubcategories: ambiguous,
    // Meat and snacks are counted apart so the produce figures above stay
    // comparable run-on-run whether or not another crawl was loaded alongside.
    meat: { rows: 0, keyed: 0, kinds: {} },
    snacks: { rows: 0, keyed: 0, kinds: {} },
  }

  for (const p of products.values()) {
    const m = withAlias(p, matchKeyFor(p, subMap))
    p.matchKey = m.key
    p.matchGroup = m.group
    p.matchVariety = m.variety
    p.groupSource = m.source
    // produce | prepared | non_produce | unclassified. The produce-facing views
    // filter on this — see isProduceRow() in observations.js.
    // Meat rows: meat | meat_prepared | out_of_scope | unparsed (meat/key.js).
    p.kind = m.kind
    // The live run is per retailer AND crawled category (categories.js). A
    // product built without a category (unit tests) reads the retailer key.
    const live = p.crawlCategory ? liveRuns?.[runKey(p.retailer, p.crawlCategory)] : liveRuns?.[p.retailer]
    p.isLive = live ? p.latest?.runId === live : null

    if (rulesFor(p)) {
      const st = stats[p.domain]
      st.rows++
      st.kinds[m.kind] = (st.kinds[m.kind] || 0) + 1
      if (m.group) {
        if (!byGroup.has(m.group)) byGroup.set(m.group, new Map())
        pushTo(byGroup.get(m.group), p.retailer, p)
      }
      if (m.key) {
        st.keyed++
        if (!byKey.has(m.key)) byKey.set(m.key, new Map())
        pushTo(byKey.get(m.key), p.retailer, p)
      }
      continue
    }
    if (p.domain && p.domain !== 'produce') continue   // unknown category: indexed nowhere

    stats.groupSources[m.source] = (stats.groupSources[m.source] || 0) + 1
    if (!m.group) { stats.noGroup++; continue }
    if (m.kind !== 'produce') { stats.nonProduce++; continue }
    stats.produce++

    if (!byGroup.has(m.group)) byGroup.set(m.group, new Map())
    pushTo(byGroup.get(m.group), p.retailer, p)

    if (!m.key) {
      stats.noVariety++
      stats.noVarietyByGroup[m.group] = (stats.noVarietyByGroup[m.group] || 0) + 1
      if (!GROUPS_WITH_LEXICON.has(m.group)) stats.groupsWithoutLexicon.add(m.group)
      continue
    }
    stats.keyed++
    if (!byKey.has(m.key)) byKey.set(m.key, new Map())
    pushTo(byKey.get(m.key), p.retailer, p)
  }

  stats.groupsWithoutLexicon = [...stats.groupsWithoutLexicon]
  return { byKey, byGroup, subMap, stats }
}

function pushTo(map, retailer, p) {
  if (!map.has(retailer)) map.set(retailer, [])
  map.get(retailer).push(p)
}

/**
 * The matches for one product, one entry per other retailer.
 *
 * `shape(p)` turns a product into the public payload shape — passed in so this
 * module does not have to know about observations.js's `publicProduct`.
 */
export function matchesFor(product, index, shape) {
  const out = []
  const keyed = product.matchKey ? index.byKey.get(product.matchKey) : null
  const grouped = product.matchGroup ? index.byGroup.get(product.matchGroup) : null
  const retailers = new Set([...(keyed?.keys() || []), ...(grouped?.keys() || [])])
  retailers.delete(product.retailer)

  // A reviewed reject (overrides.js) removes the SKU from its key BEFORE a
  // partner is chosen, so the next comparable partner takes its place; a
  // rejected product's own page has no same-key match at all.
  if (isRejected(product.matchKey, product)) return []

  for (const retailer of [...retailers].sort()) {
    const sameKey = (keyed?.get(retailer) || []).filter((o) => !isRejected(product.matchKey, o))
    if (sameKey.length) out.push(buildMatch(product, retailer, sameKey, shape))
    else {
      // Same group, different or unknown variety: a browse link, never a
      // comparison. Capped, and sorted so the list is stable between runs.
      const others = (grouped.get(retailer) || [])
        .filter((o) => o.latest?.isAvailable)
        .sort((a, b) => a.displayName.localeCompare(b.displayName))
        .slice(0, 6)
      if (!others.length) continue
      out.push({
        retailer, level: 'group-only', comparable: false,
        notComparableReason: rulesFor(product)
          ? rulesFor(product).noKey(product, retailer)
          : product.matchVariety
          ? `no ${product.matchVariety.replace(/-/g, ' ')} at ${retailer} in the latest capture`
          : `we cannot yet tell which variety this is, so it is not compared`,
        matchedOn: product.matchGroup, comparison: null, sizes: others.map(shape),
      })
    }
  }
  return out
}

function buildMatch(product, retailer, candidates, shape) {
  const mine = product.latest
  // Rate every candidate on its own terms: the level is a property of a SKU
  // PAIR, not of the match. Pink Lady has 2 Woolworths and 3 Coles SKUs across
  // two bases on each side, so one level per match cannot describe it.
  const rules = rulesFor(product)
  const rated = candidates.map((o) => {
    // Meat is compared per kg or not at all — see meat/weights.js. Snacks on
    // the shelf price of an identical pack — see snacks/weights.js.
    const basis = rules ? rules.basis(mine, o.latest) : sharedBasis(mine, o.latest)
    if (!basis) {
      const mineB = basesOf(mine)[0], theirs = basesOf(o.latest)[0]
      return {
        p: o, basis: null, level: 'strong', comparable: false,
        reason: rules
          ? rules.noBasis
          : !mineB || !theirs
          ? 'the capture recorded no unit price for one side'
          : `priced per ${basisLabel(mineB)} here and per ${basisLabel(theirs)} there — only comparable through an approximate weight, which we do not measure`,
      }
    }
    const pack = packCompatible(product, o, basis)
    if (!pack.ok) return { p: o, basis, level: 'strong', comparable: false, reason: pack.reason }
    // Meat and snacks check THIS side too, so a pair gets the same verdict from
    // both of its pages. (Produce does not yet — see docs/MEAT_DATA_TODO.md;
    // changing it would move published produce comparisons, which is its own
    // decision.)
    if (rules && mine.isAvailable === false) return { p: o, basis, level: 'strong', comparable: false, reason: 'this line was listed as unavailable at capture' }
    if (rules && product.isLive === false) return { p: o, basis, level: 'strong', comparable: false, reason: `this line is not in ${product.retailer}'s latest capture` }
    if (o.latest.isAvailable === false) return { p: o, basis, level: 'strong', comparable: false, reason: 'listed as unavailable at capture' }
    // A SKU missing from its retailer's newest run has not been seen on that
    // shelf today. Showing it as a live comparison is how a delisted line keeps
    // being compared forever.
    if (o.isLive === false) return { p: o, basis, level: 'strong', comparable: false, reason: `not in ${retailer}'s latest capture — last seen ${(o.lastSeen || '').slice(0, 10)}` }
    const skew = hoursBetween(mine.capturedAt, o.latest.capturedAt)
    if (skew > MAX_CAPTURE_SKEW_HOURS) return { p: o, basis, level: 'strong', comparable: false, reason: `captured ${Math.round(skew)} h apart — not a like-for-like comparison` }
    return { p: o, basis, level: 'exact', comparable: true, reason: null, skew }
  })

  const ok = rated.filter((r) => r.comparable)
  // Rank on ONE basis, chosen by the same kg > L > each preference used
  // everywhere else, and compare only the candidates actually priced on it.
  // Ranking on `ok[0].basis` while displaying the winner's own basis would let a
  // match whose candidates span two bases price on a basis the ranking never used.
  const rankBasis = [...BASIS_ORDER, 'pack'].find((b2) => ok.some((r) => r.basis === b2)) ?? null
  const onBasis = ok.filter((r) => r.basis === rankBasis)
  // Meat: the partner is the closest pack size first, cheapest per kg second —
  // every candidate here is already within the 1.5x size band, but a 500g
  // pack is still a fairer partner for a 500g pack than a 700g one is.
  const best = !onBasis.length ? null
    : rules ? [...onBasis].sort((x, y) => rules.pairOrder(product, x.p, y.p))[0].p
    : (cheapestOn(onBasis.map((r) => r.p), rankBasis) ?? onBasis[0].p)
  const bestRated = best ? onBasis.find((r) => r.p === best) : null
  // The match's own level is the best any of its SKUs achieved.
  const level = ok.length ? 'exact' : 'strong'
  // Which failure to explain, when several candidates failed for different
  // reasons. Prefer the one that got furthest: a candidate that shares a basis
  // and fell at the pack-semantics guard tells the shopper something useful
  // ("we found it, but it is a 6-pack"), whereas "priced per kg there" is a
  // property of the listing rather than of the product.
  const worst = rated.filter((r) => !r.comparable).sort((a, b) => (b.basis ? 1 : 0) - (a.basis ? 1 : 0))[0]

  let comparison = null
  if (bestRated) {
    const basis = bestRated.basis
    const a = priceOn(mine, basis), b = priceOn(best.latest, basis)
    comparison = {
      basis,
      this: { sku: product.sku, [basis === 'pack' ? 'price' : `pricePer${basis === 'each' ? 'Each' : basis === 'L' ? 'L' : 'Kg'}`]: a },
      other: shape(best),
      // delta is computed here and nowhere else: a client that can derive it can
      // derive it for a pair that must not be compared.
      delta: a != null && b != null && a !== 0
        ? { pct: Math.round(((b - a) / a) * 100), cheaper: b < a ? best.retailer : b > a ? product.retailer : null }
        : null,
      captureSkewHours: Math.round((bestRated.skew ?? 0) * 10) / 10,
    }
  }

  return {
    retailer, level,
    comparable: !!comparison,
    notComparableReason: comparison ? null : (worst?.reason ?? null),
    matchedOn: product.matchKey,
    comparison,
    sizes: rated.map((r) => ({
      ...shape(r.p), basis: r.basis, level: r.level,
      comparable: r.comparable, notComparableReason: r.reason,
    })),
  }
}

/**
 * Apply the curated overrides. A `reject` verdict unmatches a pair the lexicon
 * got wrong; a `confirm` records a pair a human has checked.
 *
 * This is the correction path that matters in practice: a bad match is fixed by a
 * reviewable data change with a note and a date, not by a subtle edit to a
 * scoring function. Six months on, `git log` on overrides.js explains why a
 * decision was made; a tuned threshold never does.
 */
/**
 * A reviewed alias (overrides.js `verdict: 'alias'`) moves one meat SKU onto
 * another key: the human said "this is the same product as that", where no
 * lexicon rule could say it without dragging other products along. It applies
 * only while the SKU still parses to the key it was reviewed under, so a later
 * lexicon change cannot silently carry it somewhere else.
 */
export function withAlias(p, m) {
  if (!rulesFor(p) || !m.key) return m
  const a = OVERRIDES.find((o) => o.verdict === 'alias' && o.matchKey === m.key
    && o.retailer === p.retailer && String(o.sku) === String(p.sku))
  if (!a) return m
  const parts = a.to.split(':')
  // snack:<brand>:<form>:<tokens> — the group is the key itself.
  // meat:<species>:<cut>[:attrs] — the group is the first three parts.
  if (p.domain === 'snacks') return { ...m, key: a.to, group: a.to, variety: parts[3] || 'plain', aliased: a }
  return { ...m, key: a.to, group: parts.slice(0, 3).join(':'), variety: parts.slice(3).join(':') || 'plain', aliased: a }
}

/** Has review rejected this SKU from this key? (overrides.js) */
export function isRejected(matchKey, p) {
  if (!matchKey || !p) return false
  return OVERRIDES.some((o) => o.verdict === 'reject' && o.matchKey === matchKey
    && o.retailer === p.retailer && String(o.sku) === String(p.sku))
}

export function applyOverrides(product, matches) {
  const rules = OVERRIDES.filter((o) => o.matchKey === product.matchKey)
  if (!rules.length) return matches
  const rejected = new Set(rules.filter((o) => o.verdict === 'reject').map((o) => `${o.retailer}:${o.sku}`))
  if (!rejected.size) return matches
  // A reject is a statement about the SKU ("this is not a scotch fillet"), so
  // it holds from both sides: the rejected SKU's own page loses the matches too.
  if (rejected.has(`${product.retailer}:${product.sku}`)) return []
  return matches.map((m) => {
    const sizes = m.sizes.filter((s) => !rejected.has(`${s.retailer}:${s.sku}`))
    if (sizes.length === m.sizes.length) return m
    if (!sizes.length) return null
    const stillComparable = m.comparison && !rejected.has(`${m.comparison.other.retailer}:${m.comparison.other.sku}`)
    return {
      ...m, sizes,
      comparable: !!stillComparable,
      comparison: stillComparable ? m.comparison : null,
      notComparableReason: stillComparable ? null : 'the matched line was rejected by review — see overrides.js',
    }
  }).filter(Boolean)
}

/** The metrics block for /api/status. See the data-quality page (P1.3). */
export function matchingStatus(index, products, { domain = 'produce' } = {}) {
  const { stats } = index
  const inDomain = (p) => (p.domain || 'produce') === domain
  const perRetailer = {}
  for (const p of products.values()) {
    if (!inDomain(p)) continue
    const r = (perRetailer[p.retailer] ||= { items: 0, keyed: 0, matched: 0 })
    r.items++
    if (p.matchKey) {
      r.keyed++
      const sides = index.byKey.get(p.matchKey)
      if (sides && sides.size > 1) r.matched++
    }
  }
  const domainKeys = [...index.byKey.entries()].filter(([k]) => domainOfKey(k) === domain)
  const matchedKeys = domainKeys.filter(([, m]) => m.size > 1)
  return {
    matchKeyKind: domain,
    keys: domainKeys.length,
    matchedKeys: matchedKeys.length,
    perRetailer,
    produceRows: stats.produce,
    nonProduceRows: stats.nonProduce,
    rowsWithoutGroup: stats.noGroup,
    rowsWithoutVariety: stats.noVariety,
    groupSources: stats.groupSources,
    // The lexicon's own to-do list, worst first: where adding vocabulary buys
    // the most assortment.
    varietyGaps: Object.entries(stats.noVarietyByGroup).sort((a, b) => b[1] - a[1]).map(([group, rows]) => ({ group, rows })),
    groupsWithoutLexicon: stats.groupsWithoutLexicon,
    subcategoryMapSize: stats.subcategoryMapSize,
    ambiguousSubcategories: stats.ambiguousSubcategories,
    overrides: OVERRIDES.filter((o) => domainOfKey(o.matchKey) === domain).length,
  }
}
