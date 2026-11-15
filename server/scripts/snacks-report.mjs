#!/usr/bin/env node
// The snacks & confectionery review lists — the evidence a human signs off
// before the category is published (categories.js `public: false` until then).
//
//   DATA_DIR=data/scratch/snacks node server/scripts/snacks-report.mjs [outDir]
//
// Writes to data/review/snacks/ (or outDir):
//
//   matched.csv / matched.txt     one row per Coles × Woolworths SKU pair that
//                                 shares a match key (same brand, form, line,
//                                 flavour and count), with both pack weights,
//                                 how each was read, both shelf prices, the
//                                 level the matcher gave the pair and why.
//   unmatched.csv / unmatched.txt every product with NO same-key counterpart,
//                                 with a reason code and its three nearest
//                                 candidates at the other retailer (same brand
//                                 first), each with the exact difference that
//                                 kept it from matching. NEAR_MISS is the
//                                 bucket to read for missed matches.
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
if (!process.env.DATA_DIR) process.env.DATA_DIR = path.join(REPO, 'data', 'scratch', 'snacks')
const OUT = path.resolve(process.argv[2] || path.join(REPO, 'data', 'review', 'snacks'))

const { loadObservations, getProduct } = await import('../data/observations.js')
const { snackWeight, samePack, fmtSnackG } = await import('../data/snacks/weights.js')
const { OVERRIDES } = await import('../data/matching/overrides.js')
const rejectOf = (key, ...ps) => OVERRIDES.find((o) => o.verdict === 'reject' && o.matchKey === key && ps.some((p) => p.retailer === o.retailer && String(p.sku) === String(o.sku))) || null

const idx = loadObservations({ sync: false })
const snacks = [...idx.products.values()].filter((p) => p.domain === 'snacks')
if (!snacks.length) {
  console.error(`no snack products under ${idx.dataDir} — run the discovery crawl first (see data/SNACKS_DISCOVERY.md)`)
  process.exit(1)
}
const RETAILERS = [...new Set(snacks.map((p) => p.retailer))].sort()
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
for (const p of snacks) if (p.matchKey) {
  if (!byKey.has(p.matchKey)) byKey.set(p.matchKey, [])
  byKey.get(p.matchKey).push(p)
}
const pairedSkus = new Set()
const comparedSkus = new Set()
const pages = new Map()
const pageOf = (p) => pages.get(p.key) || (pages.set(p.key, getProduct(p.retailer, p.sku, { includeHidden: true })), pages.get(p.key))
const keysBoth = [...byKey.entries()].filter(([, ps]) => new Set(ps.map((p) => p.retailer)).size > 1).sort(([a], [b]) => a.localeCompare(b))

for (const [key, ps] of keysBoth) {
  const [ra, rb] = RETAILERS
  const A = ps.filter((p) => p.retailer === ra), B = ps.filter((p) => p.retailer === rb)
  matchedTxt.push(`${key}   (${A.length} ${ra}, ${B.length} ${rb})`)
  for (const a of A) {
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
      const wa = snackWeight(a), wb = snackWeight(b)
      const pa = a.latest.price, pb = b.latest.price
      const delta = size?.comparable && pa && pb ? Math.round(((pb - pa) / pa) * 100) : null
      if (size?.comparable) { comparedSkus.add(a.key); comparedSkus.add(b.key) }
      const headline = m?.comparison?.other?.sku === b.sku
      matchedRows.push([
        key, rej ? 'rejected' : size?.level || 'strong', size?.comparable ? 'yes' : 'no', headline ? 'yes' : '',
        a.sku, a.displayName, a.brand, a.packageSize, wa.grams, wa.source, money(pa), a.latest.isOnSpecial ? 'special' : '', a.latest.promoText || '',
        b.sku, b.displayName, b.brand, b.packageSize, wb.grams, wb.source, money(pb), b.latest.isOnSpecial ? 'special' : '', b.latest.promoText || '',
        delta, rej ? `rejected by review (${rej.date}): ${rej.note}` : size?.notComparableReason || '',
      ])
      matchedTxt.push(
        `   ${size?.comparable ? (headline ? 'COMPARED ' : 'ok       ') : 'shown    '}` +
        `${short[a.retailer]} ${pad(a.displayName, 56)} ${pad(a.sizeLabel, 16)} ${pad(money(pa) + (a.latest.isOnSpecial ? '*' : ''), 8)}` +
        ` | ${short[b.retailer]} ${pad(b.displayName, 56)} ${pad(b.sizeLabel, 16)} ${pad(money(pb) + (b.latest.isOnSpecial ? '*' : ''), 8)}` +
        `${delta != null ? `  ${delta > 0 ? '+' : ''}${delta}%` : ''}` +
        `${size?.comparable ? '' : `  — ${rej ? `REJECTED BY REVIEW: ${rej.note}` : size?.notComparableReason || 'not compared'}`}`,
      )
    }
  }
  matchedTxt.push('')
}

writeCsv('matched.csv', [
  'match_key', 'level', 'comparable', 'headline_pair',
  ...RETAILERS.flatMap((r) => [`${r}_sku`, `${r}_name`, `${r}_brand`, `${r}_package_size_raw`, `${r}_grams`, `${r}_weight_source`, `${r}_price`, `${r}_special`, `${r}_promo`]),
  `delta_pct_${RETAILERS[1]}_vs_${RETAILERS[0]}`, 'not_comparable_reason',
], matchedRows)

// ---------------------------------------------------------------- unmatched

const setOf = (p) => new Set(p.snack?.tokens || [])
const setDiff = (a, b) => [...a].filter((x) => !b.has(x))
const jaccard = (a, b) => {
  const inter = [...a].filter((x) => b.has(x)).length
  const uni = new Set([...a, ...b]).size
  return uni ? inter / uni : 0
}

// How close is candidate o to product p, and what exactly separates them.
function compare(p, o) {
  const s = p.snack, t = o.snack
  let score = 0
  const why = []
  if (s.brand && s.brand === t.brand) score += 2
  else why.push(`brand ${s.brand || '?'} ≠ ${t.brand || '?'}`)
  const a = setOf(p), b = setOf(o)
  score += 3 * jaccard(a, b)
  const onlyP = setDiff(a, b), onlyO = setDiff(b, a)
  if (onlyP.length || onlyO.length) why.push(`words ${onlyP.length ? '+' + onlyP.join('+') : '—'} here vs ${onlyO.length ? '+' + onlyO.join('+') : '—'} there`)
  if (s.form === t.form) score += 0.5
  else why.push(`form ${s.form || '?'} (${s.formSource || '-'}) ≠ ${t.form || '?'} (${t.formSource || '-'})`)
  if ((s.count || 1) === (t.count || 1)) score += 0.5
  else why.push(`count ${s.count || 1} ≠ ${t.count || 1}`)
  if (samePack(p, o)) score += 1
  else why.push(`size ${fmtSnackG(snackWeight(p).grams)} ≠ ${fmtSnackG(snackWeight(o).grams)}`)
  return { o, score: Math.round(score * 100) / 100, why: why.join('; ') || 'same key', onlyWordsDiffer: why.length === 1 && why[0].startsWith('words'), sizeOnly: why.length === 1 && why[0].startsWith('size') }
}

function reasonFor(p, nearest) {
  if (p.kind === 'unparsed') return 'UNPARSED:no-brand'
  if (p.snack.isHouseBrand) return 'HOUSE_BRAND'
  const top = nearest[0]
  if (!top || top.o.snack.brand !== p.snack.brand) return `BRAND_ONLY_AT_${p.retailer.toUpperCase()}`
  // Same brand, form, count and pack at the other retailer; only the words
  // differ. A real near miss, or a real different flavour — the bucket to read.
  if (top.onlyWordsDiffer) return `NEAR_MISS:${top.why}`
  return `NOT_AT_${other(p.retailer).toUpperCase()}:${top.why}`
}

const unmatchedRows = []
const unmatchedTxt = []
const unmatchedList = snacks.filter((p) => !pairedSkus.has(p.key))
const buckets = new Map()
const poolBy = new Map(RETAILERS.map((r) => [r, snacks.filter((o) => o.retailer === r)]))
for (const p of unmatchedList) {
  const pool = poolBy.get(other(p.retailer))
  const sameBrand = p.snack?.brand ? pool.filter((o) => o.snack?.brand === p.snack.brand) : []
  const nearest = (sameBrand.length ? sameBrand : pool.slice(0, 0)).map((o) => compare(p, o))
    .sort((a, b) => b.score - a.score || a.o.displayName.localeCompare(b.o.displayName)).slice(0, 3)
  const reason = reasonFor(p, nearest)
  const code = reason.split(':')[0]
  const w = snackWeight(p)
  unmatchedRows.push([
    p.retailer, p.sku, p.displayName, p.brand, p.packageSize, w.grams, w.source, money(p.latest.price),
    p.matchKey || '', p.kind, code, reason, sameBrand.length,
    ...nearest.flatMap((n) => [n.o.sku, n.o.displayName, n.o.matchKey || n.o.kind, n.score, n.why]),
  ])
  if (!buckets.has(code)) buckets.set(code, [])
  buckets.get(code).push({ p, reason, nearest, checked: sameBrand.length })
}
const nearestHeader = [1, 2, 3].flatMap((i) => [`nearest_${i}_sku`, `nearest_${i}_name`, `nearest_${i}_key`, `nearest_${i}_score`, `nearest_${i}_differs_by`])
writeCsv('unmatched.csv', [
  'retailer', 'sku', 'name', 'brand', 'package_size_raw', 'grams', 'weight_source', 'price',
  'match_key', 'kind', 'reason_code', 'reason', 'same_brand_at_other_retailer', ...nearestHeader,
], unmatchedRows)

const ORDER = ['NEAR_MISS', 'NOT_AT_COLES', 'NOT_AT_WOOLWORTHS', 'BRAND_ONLY_AT_COLES', 'BRAND_ONLY_AT_WOOLWORTHS', 'HOUSE_BRAND', 'UNPARSED']
const EXPLAIN = {
  NEAR_MISS: 'same brand, form, count and pack at the other retailer; only the words differ — read first: a missed synonym, or a genuinely different flavour',
  NOT_AT_COLES: 'the brand is at Coles, but no listing with this line, flavour, form, count and pack',
  NOT_AT_WOOLWORTHS: 'the brand is at Woolworths, but no listing with this line, flavour, form, count and pack',
  BRAND_ONLY_AT_COLES: 'Coles stocks this brand; Woolworths does not (in this capture)',
  BRAND_ONLY_AT_WOOLWORTHS: 'Woolworths stocks this brand; Coles does not (in this capture)',
  HOUSE_BRAND: 'own-label (Coles, Woolworths, Macro …) — a different product at the other retailer by definition',
  UNPARSED: 'no brand on the listing — refused rather than guessed',
}
for (const code of [...ORDER, ...[...buckets.keys()].filter((k) => !ORDER.includes(k))]) {
  const list = buckets.get(code)
  if (!list) continue
  unmatchedTxt.push('='.repeat(110), `${code}  (${list.length})  — ${EXPLAIN[code] || ''}`, '='.repeat(110))
  list.sort((a, b) => (a.p.snack?.brand || '').localeCompare(b.p.snack?.brand || '') || a.p.displayName.localeCompare(b.p.displayName))
  for (const { p, reason, nearest, checked } of list) {
    unmatchedTxt.push(`${short[p.retailer]} ${pad(p.displayName, 66)} ${pad(p.sizeLabel, 18)} ${pad(money(p.latest.price), 8)} ${p.sku}`)
    unmatchedTxt.push(`     key ${p.matchKey || '(none)'}   reason ${reason}   ${checked} same-brand products at ${other(p.retailer)}`)
    for (const n of nearest) unmatchedTxt.push(`     ~ ${pad(n.score.toFixed(2), 5)} ${short[n.o.retailer]} ${pad(n.o.displayName, 60)} ${pad(n.o.sizeLabel, 16)} — ${n.why}`)
  }
  unmatchedTxt.push('')
}

// ---------------------------------------------------------------- summary

const count = (xs, f) => xs.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m }, {})
const pairsComparable = matchedRows.filter((r) => r[2] === 'yes').length
const summary = []
summary.push('SNACKS & CONFECTIONERY — MATCH REVIEW', '='.repeat(40), '')
summary.push(`data dir     ${idx.dataDir}`)
summary.push(`products     ${snacks.length}  (${RETAILERS.map((r) => `${r} ${snacks.filter((p) => p.retailer === r).length}`).join(', ')})`)
summary.push(`captured     ${[...new Set(snacks.map((p) => p.latest.capturedAt.slice(0, 16)))].sort().join(', ')}`, '')
summary.push('MATCHING  (same brand, form, line, flavour and count)')
summary.push(`  match keys at both retailers   ${keysBoth.length}`)
summary.push(`  SKU pairs under those keys     ${matchedRows.length}`)
summary.push(`    comparable (identical pack, per pack)   ${pairsComparable}`)
summary.push(`    shown, not compared            ${matchedRows.length - pairsComparable}`)
for (const r of RETAILERS) {
  const mine = snacks.filter((p) => p.retailer === r)
  const branded = mine.filter((p) => !p.snack?.isHouseBrand)
  const paired = mine.filter((p) => pairedSkus.has(p.key)).length
  const compared = mine.filter((p) => comparedSkus.has(p.key)).length
  summary.push(`  ${pad(r, 12)} ${paired} of ${mine.length} products share a key with the other retailer; ${compared} are compared in an identical pack (${Math.round((compared / branded.length) * 100)}% of ${branded.length} branded)`)
}
summary.push('', 'WHY THE REST ARE NOT MATCHED')
for (const code of ORDER) {
  const list = buckets.get(code) || []
  summary.push(`  ${pad(code, 26)} ${pad(list.length, 5)} ${EXPLAIN[code]}`)
}
summary.push('', 'NOT-COMPARED REASONS (matched pairs)')
const reasonsShort = count(matchedRows.filter((r) => r[2] === 'no'), (r) => String(r[r.length - 1]).replace(/\d[\d.,]*(kg|g|%)?/g, 'N').slice(0, 100))
for (const [k, v] of Object.entries(reasonsShort).sort((a, b) => b[1] - a[1])) summary.push(`  ${pad(v, 5)} ${k}`)
summary.push('', 'BY FORM  (products / share a key / compared)')
const byForm = count(snacks, (p) => p.snack?.form || '(none)')
for (const [f, n] of Object.entries(byForm).sort((a, b) => b[1] - a[1])) {
  const inForm = snacks.filter((p) => (p.snack?.form || '(none)') === f)
  summary.push(`  ${pad(f, 16)} ${pad(n, 5)} ${pad(inForm.filter((p) => pairedSkus.has(p.key)).length, 5)} ${inForm.filter((p) => comparedSkus.has(p.key)).length}`)
}
summary.push('', 'FORM SOURCE x RETAILER')
for (const r of RETAILERS) summary.push(`  ${pad(r, 12)} ${JSON.stringify(count(snacks.filter((p) => p.retailer === r), (p) => p.snack?.formSource || 'none'))}`)
summary.push('', 'HOW THE WEIGHT WAS STATED x RETAILER')
for (const r of RETAILERS) summary.push(`  ${pad(r, 12)} ${JSON.stringify(count(snacks.filter((p) => p.retailer === r), (p) => snackWeight(p).source || 'none'))}`)
summary.push('', 'WEIGHT / PRICE FLAGS  (per-kg recomputed from price ÷ stated weight)')
for (const r of RETAILERS) summary.push(`  ${pad(r, 12)} ${JSON.stringify(count(snacks.filter((p) => p.retailer === r).flatMap((p) => snackWeight(p).flags.length ? snackWeight(p).flags : ['ok']), (f) => f))}`)

fs.writeFileSync(path.join(OUT, 'matched.txt'), matchedTxt.join('\n') + '\n')
fs.writeFileSync(path.join(OUT, 'unmatched.txt'), unmatchedTxt.join('\n') + '\n')
fs.writeFileSync(path.join(OUT, 'summary.txt'), summary.join('\n') + '\n')
console.log(summary.join('\n'))
console.log(`\nwrote ${path.relative(REPO, OUT)}/{matched,unmatched}.{csv,txt}, summary.txt`)
