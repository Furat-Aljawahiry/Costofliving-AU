#!/usr/bin/env node
// The meat, poultry & seafood review lists — the evidence a human signs off
// before the category is published (categories.js `public: false` until then).
//
//   DATA_DIR=data/scratch/meat node server/scripts/meat-report.mjs [outDir]
//
// Writes to data/review/meat/ (or outDir):
//
//   matched.csv / matched.txt     one row per Coles × Woolworths SKU pair that
//                                 shares a match key, with both weights, how
//                                 each weight was read, the size ratio, both
//                                 per-kg prices, the recomputed per-kg price,
//                                 the level the matcher gave the pair and why.
//   unmatched.csv / unmatched.txt every product with NO same-key counterpart,
//                                 with a reason code, how many products at the
//                                 other retailer it was checked against, and
//                                 its three nearest candidates there, each with
//                                 a score and the exact difference that kept
//                                 it from matching.
//   summary.txt                   the counts.
//
// It runs the real loader and the real matcher — the levels and reasons in the
// lists are what the product page would show, not a re-implementation.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

process.env.DATA_SYNC = 'off'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
if (!process.env.DATA_DIR) process.env.DATA_DIR = path.join(REPO, 'data', 'scratch', 'meat')
const OUT = path.resolve(process.argv[2] || path.join(REPO, 'data', 'review', 'meat'))

const { loadObservations, getProduct } = await import('../data/observations.js')
const { weightInfo, sizeRatio, sizeTier, PACK_RATIO } = await import('../data/meat/weights.js')
const { OVERRIDES } = await import('../data/matching/overrides.js')
// A reviewed reject (overrides.js) for either SKU of a pair, or null.
const rejectOf = (key, ...ps) => OVERRIDES.find((o) => o.verdict === 'reject' && o.matchKey === key && ps.some((p) => p.retailer === o.retailer && String(p.sku) === String(o.sku))) || null

const idx = loadObservations({ sync: false })
const meat = [...idx.products.values()].filter((p) => p.domain === 'meat')
if (!meat.length) {
  console.error(`no meat products under ${idx.dataDir} — run the discovery crawl first (see data/MEAT_DISCOVERY.md)`)
  process.exit(1)
}
const RETAILERS = [...new Set(meat.map((p) => p.retailer))].sort()
const other = (r) => RETAILERS.find((x) => x !== r)
const short = { coles: 'C', woolworths: 'W' }
fs.mkdirSync(OUT, { recursive: true })

const money = (v) => (v == null ? '' : `$${Number(v).toFixed(2)}`)
const csvCell = (v) => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const writeCsv = (file, header, rows) =>
  fs.writeFileSync(path.join(OUT, file), [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n')
const pad = (s, n) => String(s ?? '').slice(0, n).padEnd(n)

// ---------------------------------------------------------------- matched

const matchedRows = []
const matchedTxt = []
const byKey = new Map()
for (const p of meat) if (p.matchKey) {
  if (!byKey.has(p.matchKey)) byKey.set(p.matchKey, [])
  byKey.get(p.matchKey).push(p)
}
const pairedSkus = new Set()
const pages = new Map()
const pageOf = (p) => pages.get(p.key) || (pages.set(p.key, getProduct(p.retailer, p.sku, { includeHidden: true })), pages.get(p.key))
const keysBoth = [...byKey.entries()].filter(([, ps]) => new Set(ps.map((p) => p.retailer)).size > 1).sort(([a], [b]) => a.localeCompare(b))

for (const [key, ps] of keysBoth) {
  const [ra, rb] = RETAILERS
  const A = ps.filter((p) => p.retailer === ra), B = ps.filter((p) => p.retailer === rb)
  matchedTxt.push(`${key}   (${A.length} ${ra}, ${B.length} ${rb})`)
  for (const a of A) {
    // The matcher's own verdict for every candidate, from a's product page.
    const page = pageOf(a)
    const m = page.matches.find((x) => x.retailer === rb)
    for (const b of B) {
      pairedSkus.add(a.key); pairedSkus.add(b.key)
      // The verdict from BOTH pages: a pair is comparable only if each side's
      // page would compare it (each checks its own availability and liveness).
      const fromA = m?.sizes.find((s) => s.sku === b.sku)
      const fromB = pageOf(b).matches.find((x) => x.retailer === a.retailer)?.sizes.find((s) => s.sku === a.sku)
      const size = fromA?.comparable && fromB?.comparable ? fromA
        : { level: 'strong', comparable: false, notComparableReason: (fromA && !fromA.comparable ? fromA : fromB)?.notComparableReason || 'not compared' }
      const rej = rejectOf(key, a, b)
      const wa = weightInfo(a), wb = weightInfo(b)
      const r = sizeRatio(a, b)
      const ka = a.latest.pricePerKg, kb = b.latest.pricePerKg
      const delta = size?.comparable && ka && kb ? Math.round(((kb - ka) / ka) * 100) : null
      const headline = m?.comparison?.other?.sku === b.sku
      matchedRows.push([
        key, rej ? 'rejected' : size?.level || 'strong', size?.comparable ? 'yes' : 'no', headline ? 'yes' : '',
        a.sku, a.displayName, a.brand, a.packageSize, wa.weightG, wa.source, wa.mode, money(a.latest.price), money(ka), money(wa.derivedKg), wa.mismatchPct,
        b.sku, b.displayName, b.brand, b.packageSize, wb.weightG, wb.source, wb.mode, money(b.latest.price), money(kb), money(wb.derivedKg), wb.mismatchPct,
        r != null ? Math.round(r * 100) / 100 : '', delta, rej ? `rejected by review (${rej.date}): ${rej.note}` : size?.notComparableReason || '',
      ])
      matchedTxt.push(
        `   ${size?.comparable ? (headline ? 'COMPARED ' : 'ok       ') : 'shown    '}` +
        `${short[a.retailer]} ${pad(a.displayName, 48)} ${pad(a.sizeLabel, 26)} ${pad(money(ka) + '/kg', 11)}` +
        ` | ${short[b.retailer]} ${pad(b.displayName, 48)} ${pad(b.sizeLabel, 26)} ${pad(money(kb) + '/kg', 11)}` +
        ` r=${r != null ? (Math.round(r * 100) / 100).toFixed(2) : ' n/a'}` +
        `${delta != null ? `  ${delta > 0 ? '+' : ''}${delta}%` : ''}` +
        `${size?.comparable ? '' : `  — ${rej ? `REJECTED BY REVIEW: ${rej.note}` : size?.notComparableReason || 'not compared'}`}`,
      )
    }
  }
  matchedTxt.push('')
}

writeCsv('matched.csv', [
  'match_key', 'level', 'comparable', 'headline_pair',
  `${RETAILERS[0]}_sku`, `${RETAILERS[0]}_name`, `${RETAILERS[0]}_brand`, `${RETAILERS[0]}_package_size_raw`, `${RETAILERS[0]}_grams`, `${RETAILERS[0]}_weight_source`, `${RETAILERS[0]}_pricing_mode`, `${RETAILERS[0]}_price`, `${RETAILERS[0]}_per_kg`, `${RETAILERS[0]}_derived_per_kg`, `${RETAILERS[0]}_cup_mismatch_pct`,
  `${RETAILERS[1]}_sku`, `${RETAILERS[1]}_name`, `${RETAILERS[1]}_brand`, `${RETAILERS[1]}_package_size_raw`, `${RETAILERS[1]}_grams`, `${RETAILERS[1]}_weight_source`, `${RETAILERS[1]}_pricing_mode`, `${RETAILERS[1]}_price`, `${RETAILERS[1]}_per_kg`, `${RETAILERS[1]}_derived_per_kg`, `${RETAILERS[1]}_cup_mismatch_pct`,
  'size_ratio', `delta_pct_${RETAILERS[1]}_vs_${RETAILERS[0]}`, 'not_comparable_reason',
], matchedRows)

// ---------------------------------------------------------------- unmatched

const tokensOf = (p) => new Set(String(p.itemKey || '').split('|').filter(Boolean))
const jaccard = (a, b) => {
  const inter = [...a].filter((x) => b.has(x)).length
  const uni = new Set([...a, ...b]).size
  return uni ? inter / uni : 0
}
const setDiff = (a, b) => [...a].filter((x) => !b.has(x))

// How close is candidate o to product p, and what exactly separates them.
function compare(p, o) {
  const m = p.meat, n = o.meat
  let score = 0
  const why = []
  if (m.species && m.species === n.species) score += 1
  else why.push(`species ${m.species || '?'} ≠ ${n.species || '?'}`)
  const cm = new Set(m.cut), cn = new Set(n.cut)
  if (m.cutKey && m.cutKey === n.cutKey) score += 2
  else {
    score += 2 * jaccard(cm, cn)
    why.push(`cut ${m.cutKey || '?'} ≠ ${n.cutKey || '?'}`)
  }
  const am = new Set(m.attrs), an = new Set(n.attrs)
  score += [...am].filter((x) => an.has(x)).length * 0.5
  const onlyP = setDiff(am, an), onlyO = setDiff(an, am)
  if (onlyP.length || onlyO.length) why.push(`attrs ${onlyP.length ? '+' + onlyP.join('+') : '—'} here vs ${onlyO.length ? '+' + onlyO.join('+') : '—'} there`)
  const fm = new Set(m.flavours), fn = new Set(n.flavours)
  const fOnlyP = setDiff(fm, fn), fOnlyO = setDiff(fn, fm)
  if (fOnlyP.length || fOnlyO.length) why.push(`flavour ${fm.size ? [...fm].join('+') : 'plain'} ≠ ${fn.size ? [...fn].join('+') : 'plain'}`)
  score += jaccard(tokensOf(p), tokensOf(o))
  if (o.kind === 'out_of_scope') why.push('other side is out of scope')
  if (o.kind === 'unparsed') why.push('other side has no key (unparsed)')
  return { o, score: Math.round(score * 100) / 100, why: why.join('; ') || 'same key' }
}

function sameGroupAt(p) {
  const o = p.matchGroup && meat.find((x) => x.retailer === other(p.retailer) && x.matchGroup === p.matchGroup)
  return o ? compare(p, o) : null
}

function reasonFor(p, nearest) {
  if (p.kind === 'out_of_scope') return `OUT_OF_SCOPE:${p.meat.outOfScope.join('+')}`
  if (p.kind === 'unparsed') {
    if (p.meat.residual.length) return `UNPARSED:${p.meat.residual.join('+')}`
    if (!p.meat.species) return 'UNPARSED:no-species'
    return 'UNPARSED:no-cut'
  }
  // Same species and cut anywhere at the other retailer, not just in the top 3.
  const top = nearest.find((n) => n.o.matchGroup === p.matchGroup) || sameGroupAt(p)
  if (top && top.o.matchGroup === p.matchGroup) {
    // Same species and cut at the other retailer, but an attribute or flavour differs.
    return `ATTR_MISMATCH:${top.why}`
  }
  return `ONLY_AT_${p.retailer.toUpperCase()}`
}

const unmatchedRows = []
const unmatchedTxt = []
const unmatchedList = meat.filter((p) => !pairedSkus.has(p.key))
const buckets = new Map()
for (const p of unmatchedList) {
  const pool = meat.filter((o) => o.retailer === other(p.retailer))
  const sameSpecies = p.meat.species ? pool.filter((o) => o.meat.species === p.meat.species) : pool
  const nearest = pool.map((o) => compare(p, o)).sort((a, b) => b.score - a.score || a.o.displayName.localeCompare(b.o.displayName)).slice(0, 3)
  const reason = reasonFor(p, nearest)
  const code = reason.split(':')[0]
  const w = weightInfo(p)
  unmatchedRows.push([
    p.retailer, p.sku, p.displayName, p.brand, p.packageSize, w.weightG, w.mode, money(p.latest.price), money(p.latest.pricePerKg),
    p.matchKey || '', p.kind, code, reason, sameSpecies.length,
    ...nearest.flatMap((n) => [n.o.sku, n.o.displayName, n.o.matchKey || n.o.kind, n.score, n.why]),
  ])
  if (!buckets.has(code)) buckets.set(code, [])
  buckets.get(code).push({ p, reason, nearest, checked: sameSpecies.length })
}
const nearestHeader = [1, 2, 3].flatMap((i) => [`nearest_${i}_sku`, `nearest_${i}_name`, `nearest_${i}_key`, `nearest_${i}_score`, `nearest_${i}_rejected_because`])
writeCsv('unmatched.csv', [
  'retailer', 'sku', 'name', 'brand', 'package_size_raw', 'grams', 'pricing_mode', 'price', 'per_kg',
  'match_key', 'kind', 'reason_code', 'reason', 'checked_against_n', ...nearestHeader,
], unmatchedRows)

const ORDER = ['ATTR_MISMATCH', 'ONLY_AT_COLES', 'ONLY_AT_WOOLWORTHS', 'UNPARSED', 'OUT_OF_SCOPE']
const EXPLAIN = {
  ATTR_MISMATCH: 'same species and cut at the other retailer, but an attribute or flavour differs — the bucket to read first for missed matches',
  ONLY_AT_COLES: 'no Woolworths product with this species and cut',
  ONLY_AT_WOOLWORTHS: 'no Coles product with this species and cut',
  UNPARSED: 'the name has words the lexicon does not know, or no species/cut — refused rather than guessed',
  OUT_OF_SCOPE: 'deli counter, smallgoods, ready meals, sauces — captured, deliberately not matched',
}
for (const code of [...ORDER, ...[...buckets.keys()].filter((k) => !ORDER.includes(k))]) {
  const list = buckets.get(code)
  if (!list) continue
  unmatchedTxt.push('='.repeat(110), `${code}  (${list.length})  — ${EXPLAIN[code] || ''}`, '='.repeat(110))
  list.sort((a, b) => (a.p.matchGroup || '').localeCompare(b.p.matchGroup || '') || a.p.displayName.localeCompare(b.p.displayName))
  for (const { p, reason, nearest, checked } of list) {
    unmatchedTxt.push(`${short[p.retailer]} ${pad(p.displayName, 60)} ${pad(p.sizeLabel, 28)} ${pad(money(p.latest.pricePerKg) + '/kg', 11)} ${p.sku}`)
    unmatchedTxt.push(`     key ${p.matchKey || '(none)'}   reason ${reason}   checked against ${checked} ${other(p.retailer)} products`)
    for (const n of nearest) unmatchedTxt.push(`     ~ ${pad(n.score.toFixed(2), 5)} ${short[n.o.retailer]} ${pad(n.o.displayName, 56)} ${pad(n.o.sizeLabel, 24)} — ${n.why}`)
  }
  unmatchedTxt.push('')
}

// ---------------------------------------------------------------- summary

const count = (xs, f) => xs.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m }, {})
const pairsComparable = matchedRows.filter((r) => r[2] === 'yes').length
const summary = []
summary.push('MEAT, POULTRY & SEAFOOD — MATCH REVIEW', '='.repeat(40), '')
summary.push(`data dir     ${idx.dataDir}`)
summary.push(`products     ${meat.length}  (${RETAILERS.map((r) => `${r} ${meat.filter((p) => p.retailer === r).length}`).join(', ')})`)
summary.push(`captured     ${[...new Set(meat.map((p) => p.latest.capturedAt.slice(0, 16)))].sort().join(', ')}`, '')
summary.push('MATCHING')
summary.push(`  match keys at both retailers   ${keysBoth.length}`)
summary.push(`  SKU pairs under those keys     ${matchedRows.length}`)
summary.push(`    comparable (per kg, ≤${PACK_RATIO}× pack size)   ${pairsComparable}`)
summary.push(`    shown, not compared            ${matchedRows.length - pairsComparable}`)
for (const r of RETAILERS) {
  const mine = meat.filter((p) => p.retailer === r)
  const paired = mine.filter((p) => pairedSkus.has(p.key)).length
  summary.push(`  ${pad(r, 12)} ${paired} of ${mine.length} products have a same-key counterpart (${Math.round((paired / mine.length) * 100)}%)`)
}
summary.push('', 'WHY THE REST ARE NOT MATCHED')
for (const code of ORDER) {
  const list = buckets.get(code) || []
  summary.push(`  ${pad(code, 20)} ${pad(list.length, 5)} ${EXPLAIN[code]}`)
}
summary.push('', 'NOT-COMPARED REASONS (matched pairs)')
const reasonsShort = count(matchedRows.filter((r) => r[2] === 'no'), (r) => String(r[28]).replace(/\d[\d.,]*(kg|g|%|×)?/g, 'N').slice(0, 90))
for (const [k, v] of Object.entries(reasonsShort).sort((a, b) => b[1] - a[1])) summary.push(`  ${pad(v, 5)} ${k}`)
summary.push('', 'BY SPECIES  (products / with a same-key counterpart)')
const bySpecies = count(meat, (p) => p.meat.species || '(none)')
for (const [sp, n] of Object.entries(bySpecies).sort((a, b) => b[1] - a[1])) {
  const paired = meat.filter((p) => (p.meat.species || '(none)') === sp && pairedSkus.has(p.key)).length
  summary.push(`  ${pad(sp, 22)} ${pad(n, 5)} ${paired}`)
}
summary.push('', 'KIND x RETAILER')
for (const r of RETAILERS) summary.push(`  ${pad(r, 12)} ${JSON.stringify(count(meat.filter((p) => p.retailer === r), (p) => p.kind))}`)
summary.push('', 'HOW THE WEIGHT WAS STATED  (pricing mode x retailer)')
for (const r of RETAILERS) summary.push(`  ${pad(r, 12)} ${JSON.stringify(count(meat.filter((p) => p.retailer === r), (p) => weightInfo(p).mode))}`)
summary.push('', 'WEIGHT / PRICE FLAGS  (per kg recomputed from price ÷ the weight the price was set on)')
for (const r of RETAILERS) summary.push(`  ${pad(r, 12)} ${JSON.stringify(count(meat.filter((p) => p.retailer === r).flatMap((p) => weightInfo(p).flags.length ? weightInfo(p).flags : ['ok']), (f) => f))}`)
summary.push('', 'SIZE TIERS (label only)')
for (const r of RETAILERS) summary.push(`  ${pad(r, 12)} ${JSON.stringify(count(meat.filter((p) => p.retailer === r), (p) => sizeTier(weightInfo(p).weightG) || (weightInfo(p).mode === 'per-kg' ? 'counter' : 'none')))}`)

fs.writeFileSync(path.join(OUT, 'matched.txt'), matchedTxt.join('\n') + '\n')
fs.writeFileSync(path.join(OUT, 'unmatched.txt'), unmatchedTxt.join('\n') + '\n')
fs.writeFileSync(path.join(OUT, 'summary.txt'), summary.join('\n') + '\n')
console.log(summary.join('\n'))
console.log(`\nwrote ${path.relative(REPO, OUT)}/{matched,unmatched}.{csv,txt}, summary.txt`)
