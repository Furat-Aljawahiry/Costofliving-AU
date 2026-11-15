// Eyeball tool for the cross-retailer matcher (P2.1). Everything it prints is
// derived from the CSVs in data/out at the moment you run it — nothing is
// cached, nothing is hard-coded, so this is how you check the matcher's claims
// for yourself rather than taking a number in a doc on trust.
//
// The companion to produce-names-report.mjs: that one shows how names collapse
// into items WITHIN a retailer, this one shows how items match ACROSS retailers.
//
//   node server/scripts/matching-report.mjs                  summary + how to read it
//   node server/scripts/matching-report.mjs keys             every matched key, both sides
//   node server/scripts/matching-report.mjs keys --group apples
//   node server/scripts/matching-report.mjs deltas           every live price comparison
//   node server/scripts/matching-report.mjs deltas --min 40  only gaps above 40%
//   node server/scripts/matching-report.mjs refused          matched but NOT compared, and why
//   node server/scripts/matching-report.mjs keys --full      every key + every matched SKU name
//   node server/scripts/matching-report.mjs unmatched        every product with NO counterpart, and why
//   node server/scripts/matching-report.mjs gaps             where the lexicon is blind
//   node server/scripts/matching-report.mjs product woolworths 310968
//   node server/scripts/matching-report.mjs check            the claims, asserted
//
// Add --retailer coles to narrow most views. DATA_SYNC=off is set for you so
// this never tries to reach S3.
process.env.DATA_SYNC ??= 'off'

const { loadObservations, getProduct, getStatus, isPublicRow } = await import('../data/observations.js')

const argv = process.argv.slice(2)
const cmd = argv.find((a) => !a.startsWith('--')) || 'summary'
const flag = (name, dflt = null) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? dflt : argv[i + 1]
}
const onlyRetailer = flag('retailer')
const onlyGroup = flag('group')

const idx = loadObservations({ sync: false })
// This report is about the public produce shelf; other crawled categories have
// their own (meat-report.mjs) and must not leak in here — getProduct() returns
// null for a hidden row, and a meat key is not a produce match.
const PRODUCTS = new Map([...idx.products].filter(([, p]) => (p.domain || 'produce') === 'produce' && isPublicRow(p)))
const isProduceKey = (k) => !k.startsWith('meat:')
const status = getStatus()
const M = status.matching

const money = (n) => (n == null ? '—' : `$${Number(n).toFixed(2)}`)
const pad = (s, n) => String(s ?? '').slice(0, n).padEnd(n)
const rule = (t) => console.log(`\n${t}\n${'-'.repeat(t.length)}`)

// Every match, flattened once, so each view is a filter over the same list.
function everyMatch() {
  const out = []
  for (const p of PRODUCTS.values()) {
    if (onlyRetailer && p.retailer !== onlyRetailer) continue
    if (onlyGroup && p.matchGroup !== onlyGroup) continue
    const d = getProduct(p.retailer, p.sku)
    for (const m of d.matches) out.push({ p: d, m })
  }
  return out
}

// ---------------------------------------------------------------- summary

function summary() {
  rule('WHAT IS LOADED')
  console.log(`data dir        ${status.dataDir}`)
  console.log(`products        ${status.productCount} across ${status.retailers.join(', ')}`)
  console.log(`newest capture  ${status.lastCapturedAt}  (${status.stalenessHours} h old${status.stale ? ', STALE' : ''})`)
  console.log(`"on shelf" run  ${JSON.stringify(status.liveRuns)}`)
  if (status.liveRunFromPartial?.length) {
    console.log(`                ${status.liveRunFromPartial.join(', ')}: that run is PARTIAL, so "missing" may mean "not fetched".`)
    console.log(`                A product absent from it is shown but never price-compared.`)
  }

  rule('MATCHING')
  console.log(`match keys                 ${M.keys}`)
  console.log(`  with BOTH retailers      ${M.matchedKeys}   <- the headline number`)
  for (const [r, v] of Object.entries(M.perRetailer)) {
    console.log(`  ${pad(r, 12)} ${v.matched} of ${v.items} products matched (${Math.round(v.matched / v.items * 100)}%), ${v.keyed} keyed`)
  }

  rule('WHERE EACH PRODUCT GOT ITS GROUP FROM')
  const srcNote = {
    'subcategory-map': "the crawler's own verdict, read back from the cheapest CSV",
    'name-over-map': 'the name disagreed with that verdict and won (see groups.js)',
    name: 'the retailer filed it under a department, so the name decided',
    veto: 'a dish/dried/paste line — deliberately NOT matched',
    unclassified: 'we could not tell. Not matched.',
    column: 'the Lambda emitted canonical_group (schema 1.2 has shipped)',
  }
  for (const [k, v] of Object.entries(M.groupSources).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pad(k, 17)} ${String(v).padStart(4)}   ${srcNote[k] || ''}`)
  }

  rule('HOW TO CHECK THIS YOURSELF')
  console.log(`  deltas    every price comparison the site will actually show.`)
  console.log(`            Sort by size and look at the big ones — a large gap is`)
  console.log(`            usually a matching mistake, not a bargain.`)
  console.log(`  keys      both retailers' product names under each key. If two`)
  console.log(`            names on one line are not the same thing, that is a bug.`)
  console.log(`  refused   pairs we matched but would not compare, with the reason.`)
  console.log(`            These are the near-misses; the reasons should read sensibly.`)
  console.log(`  unmatched every product with no counterpart, grouped by why.`)
  console.log(`  gaps      groups where the lexicon cannot name the variety.`)
  console.log(`  check     asserts the specific claims made in docs/CROSS_RETAILER_MATCHING.md`)
}

// ---------------------------------------------------------------- keys

function keys() {
  const full = argv.includes('--full')
  rule(`EVERY MATCH KEY WITH BOTH RETAILERS PRESENT${full ? '' : '   (--full for every SKU)'}`)
  console.log('Read each row as a claim: "these are the same product". The verdict')
  console.log('column is what the site does with that claim. Where a comparison')
  console.log('exists, the two price columns are the exact pair it compared.')
  console.log('')

  const rows = [...idx.matching.byKey.entries()]
    .filter(([k, m]) => isProduceKey(k) && m.size > 1 && (!onlyGroup || k.startsWith(onlyGroup + ':')))
    .sort((a, b) => a[0].localeCompare(b[0]))

  if (full) {
    let skus = 0
    for (const [k, m] of rows) {
      const w = m.get('woolworths') || [], c = m.get('coles') || []
      skus += w.length + c.length
      console.log('')
      console.log(`${k}   (${w.length} Woolworths, ${c.length} Coles)`)
      for (const [label, ps] of [['WOOLWORTHS', w], ['COLES', c]]) {
        for (const p of ps) {
          console.log(`   ${pad(label, 11)} ${pad(p.displayName, 52)} ${pad(p.sizeLabel, 20)} ${pad(money(p.latest.price), 8)} ${pad(unitOf(p.latest), 13)} ${p.sku}`)
        }
      }
    }
    console.log('')
    console.log(`${rows.length} keys matched across retailers, covering ${skus} SKUs.`)
    return
  }

  // One line per key. The verdict comes from the real match the product page
  // would build, so this table cannot drift from what the site shows.
  console.log(`${pad('MATCH KEY', 34)} ${pad('W', 3)}${pad('C', 4)} ${pad('WOOLWORTHS', 15)} ${pad('COLES', 15)} ${pad('GAP', 7)} VERDICT`)
  console.log('-'.repeat(120))
  let compared = 0
  for (const [k, m] of rows) {
    const w = m.get('woolworths') || [], c = m.get('coles') || []
    // The verdict is a property of the KEY, not of whichever SKU happens to be
    // first. `apples:pink-lady` holds a loose apple (never comparable, it is
    // priced per each against a 6-pack) AND a 1kg punnet that compares fine at
    // -21%; judging the key by the loose apple reported the whole key as
    // withheld. Take the best outcome any SKU under the key achieves.
    let match = null
    for (const p of [...w, ...c]) {
      const cand = getProduct(p.retailer, p.sku).matches.find((x) => x.matchedOn === k)
      if (!cand) continue
      if (cand.comparable) { match = cand; break }
      if (!match) match = cand
    }
    // When a comparison exists these MUST be the two numbers it used, on its own
    // basis. Showing each retailer's cheapest line instead made the columns
    // disagree with the gap: onions:brown read "$2.25/kg vs $4.00/kg ... 0%",
    // because the compared pair was the two 1kg bags while the column showed
    // Woolworths' cheaper 2kg bag.
    const FIELD = { kg: 'pricePerKg', L: 'pricePerL', each: 'pricePerEach' }
    const unitOn = (o, b) => (o?.[FIELD[b]] == null ? '—' : `${money(o[FIELD[b]])}/${b === 'each' ? 'ea' : b}`)
    const best = (ps, retailer) => {
      if (match?.comparable) {
        const c = match.comparison
        const sku = retailer === match.retailer ? c.other.sku : c.this.sku
        const p = ps.find((x) => x.sku === sku)
        if (p) return unitOn(p.latest, c.basis)
      }
      const pick = ps.filter((p) => p.latest.pricePerKg != null).sort((a, b) => a.latest.pricePerKg - b.latest.pricePerKg)[0]
        || ps.filter((p) => p.latest.pricePerEach != null).sort((a, b) => a.latest.pricePerEach - b.latest.pricePerEach)[0]
      return pick ? unitOf(pick.latest) : '—'
    }
    let verdict
    if (match?.comparable) { verdict = `compared, ${match.comparison.delta.cheaper ?? 'level'}`; compared++ }
    else verdict = `not compared — ${match?.notComparableReason ?? '?'}`
    const gap = match?.comparable ? `${match.comparison.delta.pct > 0 ? '+' : ''}${match.comparison.delta.pct}%` : ''
    console.log(`${pad(k, 34)} ${pad(w.length, 3)}${pad(c.length, 4)} ${pad(best(w, 'woolworths'), 15)} ${pad(best(c, 'coles'), 15)} ${pad(gap, 7)} ${verdict.slice(0, 60)}`)
  }
  console.log('-'.repeat(120))
  console.log(`${rows.length} keys matched across retailers; ${compared} of them yield a live price comparison.`)
  console.log(`The rest are matched but withheld — run "refused" to see why, grouped by reason.`)
}

const unitOf = (o) => o.pricePerKg != null ? `${money(o.pricePerKg)}/kg`
  : o.pricePerEach != null ? `${money(o.pricePerEach)}/ea`
  : o.pricePerL != null ? `${money(o.pricePerL)}/L` : 'no unit price'

// ---------------------------------------------------------------- deltas

function deltas() {
  const min = Number(flag('min', 0))
  rule(`PRICE COMPARISONS THE SITE WILL SHOW${min ? ` (gap >= ${min}%)` : ''}`)
  console.log('Every one of these is a claim the UI makes out loud. A gap above')
  console.log('~70% is far more often a matching error than a real price difference.\n')
  const rows = everyMatch()
    .filter(({ m }) => m.comparable && m.comparison?.delta?.pct != null)
    .map(({ p, m }) => ({ p, m, pct: m.comparison.delta.pct }))
    .filter((r) => Math.abs(r.pct) >= min)
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
  for (const { p, m, pct } of rows) {
    const c = m.comparison
    console.log(`${String(pct > 0 ? '+' + pct : pct).padStart(6)}%  ${pad(c.basis, 4)} ${pad(p.retailer + ' ' + p.displayName, 44)} <-> ${pad(m.retailer + ' ' + c.other.displayName, 44)} [${m.matchedOn}]`)
  }
  console.log(`\n${rows.length} live comparisons${min ? ` at or above ${min}%` : ''}.`)
  if (!min) {
    const big = rows.filter((r) => Math.abs(r.pct) > 70).length
    console.log(`${big} of them are more than 70% apart — those are the ones worth reading closely.`)
  }
}

// ---------------------------------------------------------------- refused

function refused() {
  rule('MATCHED BUT NOT COMPARED, AND WHY')
  console.log('The matcher found the same product but refused to put a number on it.')
  console.log('Each reason should be one you would accept from a shop assistant.\n')
  const byReason = new Map()
  for (const { p, m } of everyMatch()) {
    if (m.comparable || m.level === 'group-only') continue
    const key = (m.notComparableReason || 'no reason given').replace(/\d+(\.\d+)?(kg|g|h)\b/g, 'N$2').replace(/\b\d+-pack\b/g, 'N-pack')
    if (!byReason.has(key)) byReason.set(key, [])
    byReason.get(key).push(`${p.retailer} ${p.displayName}  <->  ${m.retailer} ${m.sizes[0]?.displayName ?? ''}`)
  }
  for (const [reason, examples] of [...byReason].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n${examples.length}x  ${reason}`)
    examples.slice(0, 3).forEach((e) => console.log(`      ${e}`))
  }
}

// ---------------------------------------------------------------- unmatched

// Everything with no counterpart at the other retailer, and the reason. The
// reasons matter more than the count: "this shelf is genuinely only at Coles" is
// a fact about the shops, while "we cannot name its variety" is a to-do.
function unmatched() {
  rule('PRODUCTS WITH NO COUNTERPART AT THE OTHER RETAILER')
  console.log('Grouped by WHY. The first group is the lexicon\'s to-do list; the')
  console.log('others are facts about the shelves, not gaps in the matcher.')

  const buckets = new Map()
  const put = (why, p, extra = '') => {
    if (!buckets.has(why)) buckets.set(why, [])
    buckets.get(why).push({ p, extra })
  }

  for (const p of PRODUCTS.values()) {
    if (onlyRetailer && p.retailer !== onlyRetailer) continue
    if (onlyGroup && p.matchGroup !== onlyGroup) continue

    if (p.matchKey) {
      const sides = idx.matching.byKey.get(p.matchKey)
      if (sides && sides.size > 1) continue          // matched; not our business here
      put(`ONLY ONE RETAILER STOCKS THIS — no ${p.retailer === 'coles' ? 'Woolworths' : 'Coles'} line under this key`, p, p.matchKey)
      continue
    }
    if (p.matchGroup && p.groupSource === 'veto') put('DELIBERATELY NOT MATCHED — a dish, dried, pasted or otherwise processed line', p, p.matchGroup)
    else if (p.matchGroup) put('VARIETY NOT NAMED — matched to a group but the lexicon cannot read the variety', p, p.matchGroup)
    else if (p.groupSource === 'veto') put('DELIBERATELY NOT MATCHED — a dish, dried, pasted or otherwise processed line', p)
    else put('NOT PRODUCE, OR UNREADABLE — never a candidate for matching', p, p.groupSource)
  }

  const order = [...buckets.entries()].sort((a, b) => b[1].length - a[1].length)
  for (const [why, items] of order) {
    console.log('')
    console.log(`${'='.repeat(100)}`)
    console.log(`${items.length}  ${why}`)
    console.log(`${'='.repeat(100)}`)
    const byGroup = new Map()
    for (const it of items) {
      const g = it.extra || '(none)'
      if (!byGroup.has(g)) byGroup.set(g, [])
      byGroup.get(g).push(it.p)
    }
    for (const [g, ps] of [...byGroup].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${g}  (${ps.length})`)
      for (const p of ps.sort((a, b) => a.retailer.localeCompare(b.retailer) || a.displayName.localeCompare(b.displayName))) {
        console.log(`     ${pad(p.retailer, 11)} ${pad(p.displayName, 54)} ${pad(p.sizeLabel, 18)} ${pad(money(p.latest.price), 8)} ${p.sku}`)
      }
    }
  }

  const total = [...buckets.values()].reduce((n, v) => n + v.length, 0)
  console.log('')
  console.log(`${total} products with no cross-retailer counterpart, of ${PRODUCTS.size} in the archive.`)
}

// ---------------------------------------------------------------- gaps

function gaps() {
  rule("WHERE THE LEXICON CANNOT NAME A VARIETY")
  console.log('These rows are browsable but never price-compared. Some are genuine')
  console.log('vocabulary gaps; some are the residual rule correctly declining to')
  console.log('guess at a name it cannot read. Both look the same from here.\n')
  for (const { group, rows } of M.varietyGaps) {
    console.log(`\n${group}  (${rows} rows)`)
    const names = [...PRODUCTS.values()]
      .filter((p) => p.matchGroup === group && !p.matchKey)
      .slice(0, 6).map((p) => p.displayName)
    names.forEach((n) => console.log(`     ${n}`))
  }
  if (M.groupsWithoutLexicon.length) console.log(`\nGroups with no lexicon at all: ${M.groupsWithoutLexicon.join(', ')}`)
  if (M.ambiguousSubcategories.length) {
    console.log(`\nSubcategories that mapped to two groups (dropped rather than guessed):`)
    M.ambiguousSubcategories.forEach((a) => console.log(`     ${a.key} -> ${a.groups.join(' / ')}`))
  }
}

// ---------------------------------------------------------------- product

function product() {
  const rest = argv.filter((a) => !a.startsWith('--') && a !== 'product')
  const [retailer, sku] = rest
  if (!retailer || !sku) return console.log('usage: matching-report.mjs product <retailer> <sku>')
  const p = getProduct(retailer, sku)
  if (!p) return console.log(`No ${retailer} SKU ${sku} in the loaded captures.`)
  rule(`${p.displayName}   [${retailer} ${sku}]`)
  console.log(`match key    ${p.matchKey ?? '(none — group-only)'}`)
  console.log(`group        ${p.matchGroup} (from: ${p.groupSource})`)
  console.log(`variety      ${p.matchVariety ?? '(not named)'}`)
  console.log(`this price   ${money(p.latest.price)}  ${p.latest.pricePerKg != null ? money(p.latest.pricePerKg) + '/kg' : p.latest.pricePerEach != null ? money(p.latest.pricePerEach) + '/ea' : 'no unit price'}   [${p.sizeLabel}]`)
  console.log(`in newest run? ${p.isLive === false ? 'NO — shown, never compared' : p.isLive === true ? 'yes' : 'unknown'}`)
  for (const m of p.matches) {
    console.log(`\n  ${m.retailer.toUpperCase()}  level=${m.level}  comparable=${m.comparable}`)
    if (m.comparable) {
      const c = m.comparison
      console.log(`     COMPARED on ${c.basis}: ${c.other.displayName} — ${money(c.other.latest?.price)}, delta ${c.delta.pct}% (${c.delta.cheaper ?? 'level'}), captures ${c.captureSkewHours} h apart`)
    } else {
      console.log(`     NOT compared: ${m.notComparableReason}`)
    }
    for (const s of m.sizes) {
      console.log(`       ${pad(s.sku, 9)} ${pad(s.displayName, 42)} ${pad(s.sizeLabel, 18)} ${pad(money(s.latest?.price), 8)} ${s.comparable ? 'comparable' : 'no — ' + (s.notComparableReason ?? '')}`)
    }
  }
}

// ---------------------------------------------------------------- check

// The claims in docs/CROSS_RETAILER_MATCHING.md §0, asserted against live data.
// If the doc and the code ever disagree, this fails and the doc is wrong.
function check() {
  rule('ASSERTING THE DOCUMENTED CLAIMS')
  let pass = 0, fail = 0
  const it = (name, fn) => {
    try { const detail = fn(); console.log(`  PASS  ${pad(name, 62)} ${detail ?? ''}`); pass++ }
    catch (e) { console.log(`  FAIL  ${pad(name, 62)} ${e.message}`); fail++ }
  }
  const eq = (a, b, what) => { if (a !== b) throw new Error(`${what}: got ${a}, expected ${b}`) }
  const ok = (c, msg) => { if (!c) throw new Error(msg) }

  it('Pink Lady 1kg punnet compares to Coles, per kg', () => {
    const p = getProduct('woolworths', '310968')
    const m = p.matches.find((x) => x.retailer === 'coles')
    eq(p.matchKey, 'apples:pink-lady', 'match key'); ok(m?.comparable, 'not comparable')
    eq(m.comparison.basis, 'kg', 'basis')
    return `${m.comparison.delta.pct}% -> ${m.comparison.other.displayName}`
  })

  it('a loose apple is NOT compared to a 6-pack of snack apples', () => {
    const m = getProduct('woolworths', '105919').matches.find((x) => x.retailer === 'coles')
    ok(m && !m.comparable, 'it WAS comparable — the per-each guard has regressed')
    ok(/pack sizes differ/.test(m.notComparableReason), `reason was: ${m.notComparableReason}`)
    return m.notComparableReason
  })

  it('a 1kg bag priced per-each is NOT compared to one loose apple', () => {
    const m = getProduct('woolworths', '155003').matches.find((x) => x.retailer === 'coles')
    ok(m && !m.comparable, 'it WAS comparable — the weight guard has regressed')
    return m.notComparableReason
  })

  it('organic never price-compares to conventional', () => {
    let bad = 0
    for (const p of PRODUCTS.values()) {
      const d = getProduct(p.retailer, p.sku)
      for (const m of d.matches) {
        if (!m.comparable) continue
        if (!!p.isOrganic !== !!PRODUCTS.get(`${m.retailer}:${m.comparison.other.sku}`)?.isOrganic) bad++
      }
    }
    eq(bad, 0, 'organic/conventional comparisons'); return '0 found'
  })

  it('no comparison without comparable, and none the other way', () => {
    let bad = 0
    for (const p of PRODUCTS.values()) {
      for (const m of getProduct(p.retailer, p.sku).matches) {
        if (m.comparable !== !!m.comparison) bad++
        if (m.level === 'group-only' && m.comparison) bad++
      }
    }
    eq(bad, 0, 'invariant violations'); return '0 found'
  })

  it('every product page renders without throwing', () => {
    let n = 0
    for (const p of PRODUCTS.values()) { getProduct(p.retailer, p.sku); n++ }
    return `${n} products`
  })

  it('both retailers are matched to each other', () => {
    for (const [r, v] of Object.entries(M.perRetailer)) ok(v.matched > 50, `${r} only matched ${v.matched}`)
    return Object.entries(M.perRetailer).map(([r, v]) => `${r} ${v.matched}`).join(', ')
  })

  it('implausible deltas (>70%) stay rare', () => {
    const big = everyMatch().filter(({ m }) => m.comparable && Math.abs(m.comparison.delta?.pct ?? 0) > 70)
    ok(big.length <= 8, `${big.length} comparisons are >70% apart — inspect with: deltas --min 70`)
    return `${big.length} (inspect: deltas --min 70)`
  })

  console.log(`\n${pass} passed, ${fail} failed.`)
  if (fail) process.exitCode = 1
}

const COMMANDS = { summary, keys, deltas, refused, unmatched, gaps, product, check }
;(COMMANDS[cmd] || (() => console.log(`unknown command "${cmd}". Try: ${Object.keys(COMMANDS).join(', ')}`)))()
