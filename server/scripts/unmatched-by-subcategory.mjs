#!/usr/bin/env node
// The to-do list for P2.1, cut by subcategory: every shelf row the site CANNOT
// price-compare, and the reason it cannot, so the next lexicon pass can be
// aimed at whichever subcategory buys the most comparisons per hour of work.
//
//   node server/scripts/unmatched-by-subcategory.mjs [outDir]
//   node server/scripts/unmatched-by-subcategory.mjs --domain produce
//   node server/scripts/unmatched-by-subcategory.mjs --state no-match
//   node server/scripts/unmatched-by-subcategory.mjs --top 15
//
// "Not compared" is the headline the site actually lives by, and it has two
// very different halves — the distinction this report exists to draw:
//
//   no-match     nothing at the other retailer shares this row's match key.
//                Either the key is wrong/absent, or the product genuinely has
//                no counterpart. Fixing these RAISES the match count.
//   not-compared the matcher DID pair the row, then refused to put a number on
//                it (variety unknown, basis mismatch, absent from the latest
//                capture, ...). The pair already exists; fixing these raises
//                the comparison count without matching anything new.
//
// Writes to data/review/unmatched/ (or outDir):
//
//   by-subcategory.txt   the ranked table plus every item under each heading.
//   by-subcategory.csv   one row per subcategory, for a spreadsheet.
//   items.csv            one row per uncompared product, with its reason.
//   summary.txt          the counts, and the rate this is all trying to move.
//
// It runs the real loader and the real matcher, so a reason printed here is the
// reason the product page would give. Nothing is cached or hard-coded.
process.env.DATA_SYNC ??= 'off'

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const { loadObservations, getProduct, isPublicRow } = await import('../data/observations.js')

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const argv = process.argv.slice(2)
// Every flag here takes a value, so a bare word is the output directory only
// when the word before it is not one of them — otherwise `--top 5` silently
// writes the whole report into a directory called "5".
const VALUE_FLAGS = ['--domain', '--state', '--retailer', '--top']
const flag = (name, dflt = null) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? dflt : argv[i + 1]
}
const onlyDomain = flag('domain')
const onlyState = flag('state')
const onlyRetailer = flag('retailer')
const topN = Number(flag('top', 25))
const positional = argv.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.includes(argv[i - 1]))
const OUT = path.resolve(positional[0] || path.join(REPO, 'data', 'review', 'unmatched'))

const idx = loadObservations({ sync: false })

// The subcategory the retailer itself filed the row under. The two retailers do
// NOT share this vocabulary (Coles "BRUSHED POTATOES" vs Woolworths "POTATO"),
// which is why the matcher keys on its own groups instead — but it is still the
// right axis for a work queue, because it is how the shelf is laid out.
const subcatOf = (p) => p.sap?.subcategory || p.subcategory || '(unfiled)'
const sizeOf = (p) => p.sizeLabel || p.packageSize || (p.netSizeValue ? `${p.netSizeValue}${p.netSizeUom || ''}` : '')
const priceOf = (p) => (p.latest?.price == null ? '' : Number(p.latest.price).toFixed(2))

// One verdict per shelf row: the best outcome across all of its match edges.
function classify(p) {
  const d = getProduct(p.retailer, p.sku)
  const matches = d?.matches || []
  if (!matches.length) {
    return { state: 'no-match', reason: p.matchKey ? 'no counterpart under this key' : 'no match key — the lexicon could not key this row', level: '' }
  }
  const comparable = matches.find((m) => m.comparable)
  if (comparable) return { state: 'compared', reason: '', level: comparable.level }
  // Refused: report the edge that got closest, since that is the one to fix.
  const rank = { exact: 3, strong: 2, 'group-only': 1 }
  const best = [...matches].sort((a, b) => (rank[b.level] || 0) - (rank[a.level] || 0))[0]
  return { state: 'not-compared', reason: best.notComparableReason || '(no reason given)', level: best.level }
}

const rows = []
for (const p of idx.products.values()) {
  if (!isPublicRow(p)) continue
  const domain = p.domain || 'produce'
  if (onlyDomain && domain !== onlyDomain) continue
  if (onlyRetailer && p.retailer !== onlyRetailer) continue
  const v = classify(p)
  rows.push({
    domain,
    retailer: p.retailer,
    subcategory: subcatOf(p),
    name: p.displayName || p.name,
    size: sizeOf(p),
    price: priceOf(p),
    group: p.matchGroup || '',
    key: p.matchKey || '',
    sku: p.sku,
    ...v,
  })
}

const total = rows.length
const compared = rows.filter((r) => r.state === 'compared').length
const noMatch = rows.filter((r) => r.state === 'no-match').length
const notCompared = rows.filter((r) => r.state === 'not-compared').length
const pct = (n, d = total) => (d === 0 ? '—' : `${((100 * n) / d).toFixed(1)}%`)

// Roll up by subcategory. `blocked` is what this report ranks on: every row the
// site cannot show a comparison for, whatever the half it falls in.
const bySub = new Map()
for (const r of rows) {
  const k = `${r.domain}\u0000${r.subcategory}`
  if (!bySub.has(k)) bySub.set(k, { domain: r.domain, subcategory: r.subcategory, total: 0, compared: 0, noMatch: 0, notCompared: 0, items: [], reasons: new Map(), retailers: new Set() })
  const s = bySub.get(k)
  s.total++
  s.retailers.add(r.retailer)
  if (r.state === 'compared') s.compared++
  else {
    if (r.state === 'no-match') s.noMatch++
    else s.notCompared++
    if (!onlyState || r.state === onlyState) s.items.push(r)
    s.reasons.set(r.reason, (s.reasons.get(r.reason) || 0) + 1)
  }
}
const subs = [...bySub.values()]
  .map((s) => ({ ...s, blocked: s.noMatch + s.notCompared }))
  .filter((s) => s.blocked > 0)
  .sort((a, b) => b.blocked - a.blocked || a.subcategory.localeCompare(b.subcategory))

// ---------------------------------------------------------------- the lists
const pad = (s, n) => String(s ?? '').slice(0, n).padEnd(n)
const lpad = (s, n) => String(s ?? '').padStart(n)
const txt = []
const say = (l = '') => txt.push(l)

say('UNCOMPARED SHELF ROWS, BY SUBCATEGORY')
say('=====================================')
say('')
say(`data dir   ${idx.dataDir || path.join(REPO, 'data', 'out')}`)
say(`generated  ${new Date().toISOString()}`)
if (onlyDomain || onlyRetailer || onlyState) say(`filters    ${[onlyDomain && `domain=${onlyDomain}`, onlyRetailer && `retailer=${onlyRetailer}`, onlyState && `state=${onlyState}`].filter(Boolean).join('  ')}`)
say('')
say(`shelf rows                 ${lpad(total, 6)}`)
say(`  price-compared           ${lpad(compared, 6)}  ${pct(compared)}   <- the rate to move`)
say(`  matched, not compared    ${lpad(notCompared, 6)}  ${pct(notCompared)}   pair exists; the matcher refused a number`)
say(`  no counterpart at all    ${lpad(noMatch, 6)}  ${pct(noMatch)}   nothing shares the key`)
say('')
say('RANKED BY ROWS THAT CANNOT BE COMPARED')
say('--------------------------------------')
say(`${pad('subcategory', 34)}${pad('domain', 9)}${lpad('rows', 5)}${lpad('cmp', 6)}${lpad('rate', 7)}${lpad('nomatch', 9)}${lpad('refused', 9)}  top reason`)
for (const s of subs.slice(0, topN)) {
  const top = [...s.reasons.entries()].sort((a, b) => b[1] - a[1])[0]
  say(`${pad(s.subcategory, 34)}${pad(s.domain, 9)}${lpad(s.total, 5)}${lpad(s.compared, 6)}${lpad(pct(s.compared, s.total), 7)}${lpad(s.noMatch, 9)}${lpad(s.notCompared, 9)}  ${top ? `${top[1]}× ${top[0]}` : ''}`)
}
if (subs.length > topN) say(`… and ${subs.length - topN} more subcategories (all of them are in the CSVs)`)
say('')
say('')
say('EVERY UNCOMPARED ITEM, UNDER ITS SUBCATEGORY')
say('--------------------------------------------')
for (const s of subs) {
  say('')
  say('='.repeat(100))
  say(`${s.subcategory}  [${s.domain}]  — ${s.blocked} of ${s.total} rows not compared  (${s.noMatch} no-match, ${s.notCompared} refused)`)
  say('='.repeat(100))
  for (const [reason, n] of [...s.reasons.entries()].sort((a, b) => b[1] - a[1])) say(`   ${lpad(n, 4)}×  ${reason}`)
  say('')
  for (const r of s.items.sort((a, b) => a.retailer.localeCompare(b.retailer) || a.name.localeCompare(b.name))) {
    say(`  ${pad(r.retailer, 11)}${pad(r.name, 54)}${pad(r.size, 15)}${lpad(r.price ? `$${r.price}` : '—', 8)}  ${pad(r.state, 13)}${pad(r.group, 22)}${r.reason}`)
  }
}
say('')

// ---------------------------------------------------------------- the files
fs.mkdirSync(OUT, { recursive: true })
const csvCell = (v) => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const writeCsv = (file, header, data) =>
  fs.writeFileSync(path.join(OUT, file), [header, ...data].map((r) => r.map(csvCell).join(',')).join('\n') + '\n')

writeCsv('by-subcategory.csv', ['domain', 'subcategory', 'retailers', 'rows', 'compared', 'compared_pct', 'no_match', 'not_compared', 'blocked', 'top_reason', 'top_reason_rows'],
  subs.map((s) => {
    const top = [...s.reasons.entries()].sort((a, b) => b[1] - a[1])[0] || ['', 0]
    return [s.domain, s.subcategory, [...s.retailers].sort().join('+'), s.total, s.compared, pct(s.compared, s.total), s.noMatch, s.notCompared, s.blocked, top[0], top[1]]
  }))

writeCsv('items.csv', ['domain', 'subcategory', 'retailer', 'sku', 'name', 'size', 'price_aud', 'state', 'match_level', 'match_group', 'match_key', 'reason'],
  rows.filter((r) => r.state !== 'compared' && (!onlyState || r.state === onlyState))
    .sort((a, b) => a.domain.localeCompare(b.domain) || a.subcategory.localeCompare(b.subcategory) || a.retailer.localeCompare(b.retailer) || a.name.localeCompare(b.name))
    .map((r) => [r.domain, r.subcategory, r.retailer, r.sku, r.name, r.size, r.price, r.state, r.level, r.group, r.key, r.reason]))

fs.writeFileSync(path.join(OUT, 'by-subcategory.txt'), txt.join('\n'))

const summary = []
summary.push('UNCOMPARED SHELF ROWS — SUMMARY')
summary.push('===============================')
summary.push('')
summary.push(`generated  ${new Date().toISOString()}`)
summary.push('')
summary.push(`shelf rows               ${lpad(total, 6)}`)
summary.push(`  price-compared         ${lpad(compared, 6)}  ${pct(compared)}`)
summary.push(`  matched, not compared  ${lpad(notCompared, 6)}  ${pct(notCompared)}`)
summary.push(`  no counterpart at all  ${lpad(noMatch, 6)}  ${pct(noMatch)}`)
summary.push('')
summary.push('BY DOMAIN')
for (const d of [...new Set(rows.map((r) => r.domain))].sort()) {
  const rs = rows.filter((r) => r.domain === d)
  const c = rs.filter((r) => r.state === 'compared').length
  summary.push(`  ${pad(d, 10)}${lpad(rs.length, 6)} rows  ${lpad(c, 6)} compared  ${lpad(pct(c, rs.length), 7)}`)
}
summary.push('')
summary.push('EVERY REASON A PAIRED ROW WAS NOT COMPARED')
const allReasons = new Map()
for (const r of rows.filter((x) => x.state === 'not-compared')) allReasons.set(r.reason, (allReasons.get(r.reason) || 0) + 1)
for (const [reason, n] of [...allReasons.entries()].sort((a, b) => b[1] - a[1])) summary.push(`  ${lpad(n, 5)}  ${reason}`)
summary.push('')
summary.push('WORST SUBCATEGORIES BY BLOCKED ROWS')
for (const s of subs.slice(0, 20)) summary.push(`  ${lpad(s.blocked, 5)}  ${pad(s.subcategory, 34)}${pad(s.domain, 9)}${lpad(pct(s.compared, s.total), 7)} compared`)
fs.writeFileSync(path.join(OUT, 'summary.txt'), summary.join('\n') + '\n')

console.log(txt.slice(0, txt.indexOf('EVERY UNCOMPARED ITEM, UNDER ITS SUBCATEGORY') - 2).join('\n'))
console.log(`\nwrote  ${path.join(OUT, 'by-subcategory.txt')}`)
console.log(`       ${path.join(OUT, 'by-subcategory.csv')}   ${subs.length} subcategories`)
console.log(`       ${path.join(OUT, 'items.csv')}            ${rows.filter((r) => r.state !== 'compared').length} uncompared rows`)
console.log(`       ${path.join(OUT, 'summary.txt')}`)
