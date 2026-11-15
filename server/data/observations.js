// Real price observations, loaded from the crawler's own output files.
//
// The two Lambdas (see infra/terraform/lambda/category_crawler) write, per run
// and per retailer, a products CSV, a cheapest-by-subcategory CSV and a
// manifest JSON. This module reads every such file under DATA_DIR (default
// ../data/out), whatever it is named — the type of each file is decided by its
// `dataset` column/field, not its filename — and builds an in-memory index:
//
//   products     retailer:sku -> product + every observation of it, oldest first
//   items        retailer:itemKey -> the SKUs that are one product in several
//                sizes (produceNames.js decides what "one product" is)
//   cheapest     latest cheapest-by-subcategory rows, per retailer
//   runs         one entry per manifest (status, counts, capture context)
//
// Nothing here is estimated. If a number is not in a CSV, it is not served.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseProduceName, sizeLabel, sizeRank, pickItemName } from './produceNames.js'
import { bestBasisAcross, bestBasisOf, cheapestOn, priceOn, sharedBasis, basisLabel } from './basis.js'
import { buildMatchIndex, matchesFor, applyOverrides, matchingStatus, isRejected } from './matching/index.js'
import { parseMeatName, meatSizeLabel } from './meat/names.js'
import { parseSnackName, snackSizeLabel } from './snacks/names.js'
import { categoryOf, domainOf, isPublicCategory, runKey } from './categories.js'
import { dataDir, archive, syncPolicy } from '../config.js'

// ---------------------------------------------------------------- S3 sync
//
// The archive lives in S3; data/out is a working copy. The server pulls the
// archive down (incrementally — `aws s3 sync` copies only what changed) before
// every load, so a freshly booted server serves the newest run and a reload
// picks up last night's without anyone running a script.
//
// --delete keeps the mirror honest (the 17 Sep layout migration removed the
// old run= prefixes); it is safe because the crawler only ever appends.
// The CLI rather than the SDK: it is what this repo already assumes for
// credentials and region (data/scripts/pull_latest_reports.py does the same).
//
// `reason` is a code, not prose, because /api/status has to be able to tell
// "someone turned this off" from "this is broken". They used to look the same
// from the outside, which is how eight days went by unnoticed.
//   ok | disabled | cli-missing | auth | timeout | exit-N
let LAST_SYNC = { at: null, ok: null, reason: null, message: 'not yet run' }

function classify(r) {
  if (r.error?.code === 'ENOENT') return ['cli-missing', 'aws CLI not on PATH']
  if (r.error?.signal === 'SIGTERM' || r.error?.code === 'ETIMEDOUT') return ['timeout', 'aws s3 sync timed out after 5 min']
  const err = (r.stderr || r.error?.message || '').trim()
  const first = err.split('\n')[0] || `exit ${r.status}`
  if (/credential|AccessDenied|ExpiredToken|Unable to locate/i.test(err)) return ['auth', first]
  return [`exit-${r.status}`, first]
}

export function syncArchive() {
  const { enabled } = syncPolicy()
  if (!enabled) {
    LAST_SYNC = {
      at: new Date().toISOString(), ok: false, reason: 'disabled',
      message: 'DATA_SYNC=off — serving data/out as is; prices will be as old as this checkout',
    }
    return LAST_SYNC
  }
  const { bucket, prefix, region, syncDir } = archive()
  const started = Date.now()
  const r = spawnSync('aws', [
    '--region', region, 's3', 'sync', `s3://${bucket}/${prefix}`, syncDir,
    '--exclude', '*', '--include', '*.csv', '--include', '*.json', '--delete', '--no-progress',
  ], { encoding: 'utf8', timeout: 5 * 60 * 1000 })
  const ok = r.status === 0
  if (ok) {
    const copied = (r.stdout.match(/^download:/gm) || []).length
    LAST_SYNC = {
      at: new Date().toISOString(), ok: true, reason: 'ok',
      message: `${copied} files copied in ${Date.now() - started} ms`,
    }
    console.log(`[observations] s3 sync ok: ${LAST_SYNC.message}`)
  } else {
    const [reason, message] = classify(r)
    LAST_SYNC = { at: new Date().toISOString(), ok: false, reason, message }
    console.error(`[observations] s3 sync FAILED (${reason}): ${message}`)
  }
  return LAST_SYNC
}

// ---------------------------------------------------------------- CSV parsing

// RFC 4180-ish: quoted fields, doubled quotes, CRLF or LF.
export function parseCsv(text) {
  const rows = []
  let row = [], field = '', inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  if (!rows.length) return []
  const header = rows[0]
  return rows.slice(1).filter(r => r.length > 1).map(r => {
    const o = {}
    header.forEach((h, i) => { o[h] = r[i] ?? '' })
    return o
  })
}

const num = (v) => (v === '' || v == null ? null : Number(v))

// Coles names every per-each produce line "… 1 Each" and Woolworths "… each".
// Drop the suffix from the name — sold_by/package_size still carry the fact
// that it is priced per each, so nothing about the unit logic changes.
const cleanName = (n) => String(n || '').replace(/\s+(1\s+)?each\s*$/i, '').trim()
const cleanSize = (sz) => (/^1\s+each$/i.test(String(sz || '').trim()) ? 'each' : sz)
const bool = (v) => String(v).toLowerCase() === 'true' || v === '1'

// ---------------------------------------------------------------- walking

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p, out)
    else if (/\.(csv|json)$/i.test(ent.name)) out.push(p)
  }
  return out
}

// ---------------------------------------------------------------- index

let INDEX = null

export function loadObservations({ force = false, sync = true } = {}) {
  if (INDEX && !force) return INDEX
  if (sync) syncArchive()

  const products = new Map()    // key retailer:sku
  const cheapestCandidates = [] // every cheapest file; the newest COMPLETE run per retailer wins below
  const runs = new Map()         // run_id:retailer -> manifest summary
  const seenObs = new Set()      // retailer:sku:run_id
  const files = { products: 0, cheapest: 0, manifests: 0, skipped: 0 }
  const DIR = dataDir()

  for (const file of walk(DIR)) {
    try {
      if (file.endsWith('.json')) {
        const m = JSON.parse(fs.readFileSync(file, 'utf8'))
        if (!m || typeof m !== 'object' || Array.isArray(m) || !m.run_id) { files.skipped++; continue }
        files.manifests++
        // One run covers one category per retailer (index.py), so the run is
        // keyed by all three — see categories.js for why retailer alone is not
        // enough once there is more than one category.
        const category = categoryOf({ retailer: m.retailer, nodeId: m.requested_nodes?.[0]?.node_id, file })
        runs.set(`${m.run_id}:${runKey(m.retailer, category)}`, {
          runId: m.run_id, retailer: m.retailer, category, status: m.status,
          startedAt: m.started_at_utc, finishedAt: m.finished_at_utc,
          egress: m.capture_context?.egress, priceBasis: m.capture_context?.price_basis,
          storeId: m.capture_context?.store_id,
          rowsWritten: m.counts?.rows_written, rowsWithPrice: m.counts?.rows_with_price,
          pagesFetched: m.counts?.pages_fetched, errors: m.errors || [],
          cheapest: m.cheapest_by_subcategory || null,
          file: path.relative(DIR, file),
        })
        continue
      }

      const rows = parseCsv(fs.readFileSync(file, 'utf8'))
      const dataset = rows[0]?.dataset || ''
      if (dataset.endsWith('.products')) {
        files.products++
        for (const r of rows) ingestProduct(products, seenObs, r, file, DIR)
      } else if (dataset.endsWith('.cheapest_by_subcategory')) {
        files.cheapest++
        // The cheapest CSV carries no category id of its own; it is resolved
        // from its run's manifest once every file has been read (below).
        cheapestCandidates.push({
          retailer: rows[0].retailer, runId: rows[0].run_id, capturedAt: rows[0].captured_at_utc,
          file,
          selectionRule: rows[0].selection_rule,
          rows: rows.map(cheapestRow),
        })
      } else files.skipped++
    } catch (e) {
      console.warn(`[observations] skipped ${file}: ${e.message}`)
      files.skipped++
    }
  }

  // Collapse near-duplicate runs. Two hand invocations 13 s apart on 4 Sep
  // put two observations of every product on one day; the schedule's own two
  // runs (06:00 and 18:00 UTC) are twelve hours apart and both count. Rule:
  // per retailer, a run starting within COLLAPSE_WINDOW_MS of the previous
  // kept run is folded into it — the complete one wins, else the later one.
  const collapsed = collapseRuns([...runs.values()])
  const dropped = new Set(collapsed.filter(r => r.collapsedInto).map(r => `${r.retailer}:${r.category}:${r.runId}`))

  // run_id:retailer -> category, for the files that do not say (cheapest CSVs).
  const runCategory = new Map([...runs.values()].map(r => [`${r.runId}:${r.retailer}`, r.category]))
  for (const c of cheapestCandidates) {
    c.category = runCategory.get(`${c.runId}:${c.retailer}`) || categoryOf({ retailer: c.retailer, file: c.file })
  }

  // Finalise: drop observations from collapsed runs, sort, derive latest.
  for (const [key, p] of products) {
    p.observations = p.observations.filter(o => !dropped.has(`${p.retailer}:${o.category}:${o.runId}`))
    if (!p.observations.length) { products.delete(key); continue }
    p.observations.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
    p.latest = p.observations[p.observations.length - 1]
    p.firstSeen = p.observations[0].capturedAt
    p.lastSeen = p.latest.capturedAt
  }

  const items = buildItems(products)

  const runList = collapsed.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''))
  // "Last captured" is what the site shows, so it is taken over the public
  // categories only — a hidden meat run must not make stale fruit look fresh.
  const lastCapture = runList.find(r => !r.collapsedInto && isPublicCategory(r.category)
    && (r.status === 'complete' || r.status === 'partial')) || null

  // "Cheapest today" comes from the newest COMPLETE run per retailer: a
  // partial run's cheapest file is missing whatever the crawl missed, and a
  // cheapest line that was simply not fetched would read as "got dearer".
  // With no complete run at all for a retailer, the newest partial is used
  // and the status endpoint says so.
  // Keyed retailer:category — one cheapest set per shelf, not per retailer.
  const cheapestByRun = new Map()
  const statusOf = (c) => runs.get(`${c.runId}:${runKey(c.retailer, c.category)}`)?.status
  for (const c of cheapestCandidates.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))) {
    if (dropped.has(`${c.retailer}:${c.category}:${c.runId}`)) continue
    const k = runKey(c.retailer, c.category)
    const cur = cheapestByRun.get(k)
    const complete = statusOf(c) === 'complete'
    if (!cur || (complete && !cur.complete)) cheapestByRun.set(k, { ...c, complete })
  }

  const lastCapturedAt = lastCapture?.finishedAt || lastCapture?.startedAt || null

  // Per retailer, the run a product must appear in to count as "on the shelf
  // today". Newest complete run, falling back to the newest partial — the same
  // rule and the same reason as the cheapest sets above. The fallback is not
  // optional while P0.3 is open: no Woolworths run has earned `_SUCCESS` since
  // 22 Sep, so a strict complete-only test would suppress every Woolworths
  // comparison on the site.
  // The NEWEST run, complete or partial — deliberately not "the newest complete
  // run". Preferring completeness here looks safer and is actively wrong: no
  // Woolworths run has earned `_SUCCESS` since 22 Sep (P0.3), so the newest
  // Woolworths run is always the 18:00 partial, and picking the newest *complete*
  // run reached back to 06:00 and marked 564 of 568 Woolworths products "not on
  // the shelf today". That suppressed the Coles-vs-Woolworths panel on almost
  // every Coles page — the exact feature this is meant to protect.
  //
  // A partial run is a real observation of the products it did reach. What it
  // cannot support is "X is missing, therefore delisted", so absence from a
  // partial run is reported (`liveRunFromPartial`) rather than trusted, and
  // matching only ever uses this to withhold a comparison, never to assert one.
  //
  // Per retailer AND category (`woolworths:fruitAndVeg`): a meat run is not a
  // newer capture of the fruit shelf, and treating it as one marks every fruit
  // SKU "not on the shelf today".
  const liveRuns = {}
  const liveRunFromPartial = []
  for (const k of new Set(runList.map(r => runKey(r.retailer, r.category)))) {
    const pick = runList.find(r => runKey(r.retailer, r.category) === k && !r.collapsedInto
      && (r.status === 'complete' || r.status === 'partial'))
    if (pick) {
      liveRuns[k] = pick.runId
      if (pick.status !== 'complete') liveRunFromPartial.push(k)
    }
  }

  // Cross-retailer matching (P2.1). Derived here, at load, so that changing the
  // lexicon re-matches the whole archive on a reload — see matching/index.js.
  // Only produce cheapest sets feed the produce subcategory map: a meat
  // subcategory has no produce verdict to give, and two of the meat cheapest
  // rows were "rescued" into produce groups by name, which is noise there.
  const produceCheapest = [...cheapestByRun.values()].filter(c => domainOf(c.category) === 'produce')
  const matching = buildMatchIndex(products, produceCheapest, liveRuns)

  const publicProducts = [...products.values()].filter(isPublicRow)
  const hiddenCategories = {}
  for (const p of products.values()) {
    if (!isPublicRow(p)) hiddenCategories[p.crawlCategory] = (hiddenCategories[p.crawlCategory] || 0) + 1
  }

  INDEX = {
    dataDir: DIR, files, sync: LAST_SYNC,
    products, items, cheapest: cheapestByRun, runs: runList,
    matching, liveRuns, liveRunFromPartial, hiddenCategories,
    // Every figure here is what the site shows, so it counts public rows only.
    // A hidden category is reported by row count alone (hiddenCategories).
    summary: {
      productCount: publicProducts.length,
      // Per crawled shelf, for the aisle tiles (categories.js slugs).
      productsByCategory: publicProducts.reduce((m, p) => { m[p.crawlCategory] = (m[p.crawlCategory] || 0) + 1; return m }, {}),
      itemCount: [...items.values()].filter(it => it.skus.some(isPublicRow)).length,
      retailers: [...new Set(publicProducts.map(p => p.retailer))],
      observationCount: publicProducts.reduce((n, p) => n + p.observations.length, 0),
      lastCapturedAt,
      ...staleness(lastCapturedAt),
      runCount: runList.filter(r => !r.collapsedInto && isPublicCategory(r.category)).length,
      collapsedRunCount: collapsed.filter(r => r.collapsedInto && isPublicCategory(r.category)).length,
      cheapestFromPartial: [...cheapestByRun.values()].filter(c => !c.complete && isPublicCategory(c.category)).map(c => c.retailer),
    },
    loadedAt: new Date().toISOString(),
  }
  const hiddenNote = Object.entries(hiddenCategories).map(([c, n]) => `${n} ${c}`).join(', ')
  console.log(`[observations] ${INDEX.summary.productCount} products${hiddenNote ? ` (+ hidden: ${hiddenNote})` : ''}, ${INDEX.summary.observationCount} observations from ${files.products} product files, ${files.cheapest} cheapest files, ${files.manifests} manifests (${DIR})`)
  const produceKeys = [...matching.byKey.entries()].filter(([k]) => !k.startsWith('meat:') && !k.startsWith('snack:'))
  console.log(`[observations] matching: ${matching.stats.keyed} rows keyed into ${produceKeys.length} match keys, ${produceKeys.filter(([, m]) => m.size > 1).length} matched across retailers; ${matching.stats.noVariety} produce rows have no variety yet`)
  if (matching.stats.meat.rows) {
    const meatKeys = [...matching.byKey.entries()].filter(([k]) => k.startsWith('meat:'))
    console.log(`[observations] meat: ${matching.stats.meat.keyed} of ${matching.stats.meat.rows} rows keyed into ${meatKeys.length} keys, ${meatKeys.filter(([, m]) => m.size > 1).length} at both retailers`)
  }
  if (matching.stats.snacks.rows) {
    const snackKeys = [...matching.byKey.entries()].filter(([k]) => k.startsWith('snack:'))
    console.log(`[observations] snacks: ${matching.stats.snacks.keyed} of ${matching.stats.snacks.rows} rows keyed into ${snackKeys.length} keys, ${snackKeys.filter(([, m]) => m.size > 1).length} at both retailers`)
  }
  if (INDEX.summary.stale) {
    console.warn(`[observations] STALE: newest capture is ${INDEX.summary.stalenessHours} h old (threshold ${syncPolicy().staleAfterHours} h). The site is showing old prices.`)
  }
  return INDEX
}

// How old is the newest capture, and is that old enough to be a problem?
// Exported shape is consumed by /api/status and, from P1.5, by the client's
// staleness banner — so `stale` is decided here once, not in each caller.
export function staleness(lastCapturedAt, now = Date.now()) {
  if (!lastCapturedAt) return { stalenessHours: null, stale: true }
  const ms = now - Date.parse(lastCapturedAt)
  if (!Number.isFinite(ms)) return { stalenessHours: null, stale: true }
  const hours = Math.round((ms / 36e5) * 10) / 10
  return { stalenessHours: hours, stale: hours > syncPolicy().staleAfterHours }
}

// Same retailer + same itemKey + same organic flag = one item in several
// sizes. Prepared lines group too (Coleslaw 250g / 800g) — grouping is about
// sizes, not about what counts as produce. Every product gets an itemId, even
// a group of one, so the client never special-cases singletons.
function buildItems(products) {
  const items = new Map()
  for (const p of products.values()) {
    if (!p.itemKey) continue
    // Produce ids are unchanged (they are in URLs); other domains are
    // namespaced so a meat itemKey can never fold into a produce item.
    const ns = p.domain && p.domain !== 'produce' ? `${p.domain}:` : ''
    const id = `${p.retailer}:${ns}${p.isOrganic ? 'organic:' : ''}${p.itemKey}`
    let it = items.get(id)
    if (!it) items.set(id, it = { id, retailer: p.retailer, itemKey: p.itemKey, isOrganic: p.isOrganic, skus: [] })
    it.skus.push(p)
  }
  for (const it of items.values()) {
    it.skus.sort((a, b) => sizeRank(a) - sizeRank(b) || (a.latest.unitPrice ?? 1e9) - (b.latest.unitPrice ?? 1e9))
    it.name = pickItemName(it.skus.map(p => p.itemName))
    for (const p of it.skus) { p.itemId = it.id; p.itemLabel = it.name; p.sizeCount = it.skus.length }
  }
  return items
}

const COLLAPSE_WINDOW_MS = 60 * 60 * 1000

export function collapseRuns(list) {
  const rank = (r) => (r.status === 'complete' ? 1 : 0)
  // Bucketed by retailer AND category: the fruit and the meat crawl starting
  // minutes apart are two different captures, not one captured twice.
  const byRetailer = new Map()
  for (const r of list) {
    r.collapsedInto = null
    const k = `${r.retailer}|${r.category || ''}`
    if (!byRetailer.has(k)) byRetailer.set(k, [])
    byRetailer.get(k).push(r)
  }
  for (const rs of byRetailer.values()) {
    rs.sort((a, b) => (a.startedAt || '').localeCompare(b.startedAt || ''))
    let kept = null
    for (const r of rs) {
      const close = kept && r.startedAt && kept.startedAt
        && (Date.parse(r.startedAt) - Date.parse(kept.startedAt)) < COLLAPSE_WINDOW_MS
      if (!close) { kept = r; continue }
      // Same capture, twice. Keep the better one; the later wins a tie.
      if (rank(r) >= rank(kept)) { kept.collapsedInto = r.runId; kept = r }
      else r.collapsedInto = kept.runId
    }
  }
  return list
}

function ingestProduct(products, seenObs, r, file, dir) {
  if (!r.retailer || !r.retailer_sku) return
  const key = `${r.retailer}:${r.retailer_sku}`
  const obsKey = `${key}:${r.run_id}`
  if (seenObs.has(obsKey)) return   // same run copied into two folders
  seenObs.add(obsKey)

  const crawlCategory = categoryOf({ retailer: r.retailer, nodeId: r.source_category_id, file })
  let p = products.get(key)
  if (p && p.crawlCategory !== crawlCategory) {
    // One SKU on two crawled shelves. It keeps the category it was first seen
    // in, and only that shelf's observations: the other shelf's runs are not
    // its live run, so mixing them in would mark it "not on the shelf today".
    if (!p._categoryWarned) console.warn(`[observations] ${key} seen in ${p.crawlCategory} and ${crawlCategory}; keeping ${p.crawlCategory}`)
    p._categoryWarned = true
    return
  }
  if (!p) {
    p = {
      key, retailer: r.retailer, sku: r.retailer_sku, gtin: r.gtin || null,
      // `category` below is the retailer's own category_name; `crawlCategory`
      // is which crawled shelf (categories.js) the row came from. A shelf with
      // no matcher yet is domain 'unknown' — indexed nowhere, published nowhere.
      crawlCategory, domain: domainOf(crawlCategory) || 'unknown',
      name: cleanName(r.product_name), displayName: cleanName(r.display_name), brand: r.brand,
      variety: r.variety || null,
      productUrl: r.product_url, imageUrl: r.image_url,
      department: r.dept_name, category: r.category_name, subcategory: r.subcategory_name,
      sap: { department: r.sap_department, category: r.sap_category, subcategory: r.sap_subcategory, segment: r.sap_segment, family: r.sap_family },
      isOrganic: bool(r.is_organic), isPrepared: bool(r.is_prepared),
      countryOfOrigin: r.country_of_origin || null,
      healthStarRating: num(r.health_star_rating),
      packageSize: cleanSize(r.package_size_raw), packQty: num(r.pack_qty), packUom: r.pack_uom,
      netSizeValue: num(r.net_size_value), netSizeUom: r.net_size_uom,
      soldBy: r.sold_by, isVariableWeight: bool(r.is_variable_weight),
      canonicalProductKey: r.canonical_product_key || null,
      // Absent from products schema 1.1; present once the Lambda emits them
      // (additive schema 1.2). groups.js prefers them over its own fallback, so
      // this is the seam by which that fallback retires itself.
      canonicalGroup: r.canonical_group || null,
      groupKind: r.group_kind || null,
      basketItemId: r.basket_item_id || null,
      sourceCategory: { id: r.source_category_id, name: r.source_category_name },
      observations: [],
    }
    products.set(key, p)
  }
  // The product's descriptive fields follow its most recent row.
  if (!p._newest || r.captured_at_utc > p._newest) {
    p._newest = r.captured_at_utc
    Object.assign(p, { name: cleanName(r.product_name), displayName: cleanName(r.display_name), brand: r.brand, imageUrl: r.image_url, productUrl: r.product_url, packageSize: cleanSize(r.package_size_raw) })
    // The name pulled apart: what it is, how it is sold, and the size slot.
    const ctx = { soldBy: r.sold_by, packageSize: r.package_size_raw }
    if (p.domain === 'meat') {
      const parsed = parseMeatName(r.product_name, {
        ...ctx, brand: r.brand, isOrganic: bool(r.is_organic),
        // Both: Coles' subcategory_name is a display shelf ("Breast Fillets"),
        // its sap_subcategory the buying group ("CRUMBED"); either can carry the fact.
        retailerCategory: r.category_name || r.sap_category, subcategory: `${r.subcategory_name || ''} ${r.sap_subcategory || ''}`.trim(),
      })
      Object.assign(p, {
        itemName: parsed.itemName, itemKey: parsed.itemKey, meat: parsed,
        packFormat: null, nameWeight: parsed.nameWeight, portion: null, sizeGrade: null,
        multipack: parsed.count, imperfect: false,
        sizeLabel: meatSizeLabel(r.package_size_raw, r.sold_by),
      })
    } else if (p.domain === 'snacks') {
      // Brand, line, flavour, form and count — the parts of "the same exact
      // product" (snacks/names.js). Woolworths' subcategory is the buying
      // group ("CHIPS - SHARING"), Coles' the display shelf ("Chips Sharing");
      // either names the form when the product name does not.
      const parsed = parseSnackName(r.product_name, {
        ...ctx, retailer: r.retailer, brand: r.brand,
        subcategory: `${r.subcategory_name || ''} ${r.sap_subcategory || ''}`.trim(),
      })
      Object.assign(p, {
        itemName: parsed.itemName, itemKey: parsed.itemKey, snack: parsed,
        packFormat: null, nameWeight: parsed.nameWeight, portion: null, sizeGrade: null,
        multipack: parsed.count, imperfect: false,
        sizeLabel: snackSizeLabel(r.package_size_raw),
      })
    } else {
      const parsed = parseProduceName(r.product_name, ctx)
      Object.assign(p, {
        itemName: parsed.itemName, itemKey: parsed.itemKey, packFormat: parsed.packFormat,
        nameWeight: parsed.nameWeight,
        portion: parsed.portion, sizeGrade: parsed.sizeGrade, multipack: parsed.multipack, imperfect: parsed.imperfect,
        sizeLabel: sizeLabel(parsed, ctx),
      })
    }
  }
  p.observations.push({
    runId: r.run_id, capturedAt: r.captured_at_utc, category: crawlCategory,
    source: r.source_endpoint, confidence: r.confidence, priceBasis: r.price_basis,
    storeId: r.fulfilment_store_id || null, postcode: r.postcode || null,
    price: num(r.price_aud), wasPrice: num(r.was_price_aud), savings: num(r.savings_aud),
    isOnSpecial: bool(r.is_on_special), promoText: r.promo_text || null,
    unitPrice: num(r.unit_price_value), unitMeasure: r.unit_price_measure || null, unitPriceRaw: r.unit_price_raw || null,
    pricePerKg: num(r.price_per_kg_aud), pricePerL: num(r.price_per_l_aud), pricePerEach: num(r.price_per_each_aud),
    isAvailable: bool(r.is_available), isInStock: bool(r.is_in_stock), isPurchasable: bool(r.is_purchasable),
    availabilityStatus: r.availability_status || null,
    isSponsored: bool(r.is_sponsored),
    warnings: r.parse_warnings || null,
    file: path.relative(dir, file),
  })
}

function cheapestRow(r) {
  return {
    retailer: r.retailer, sku: r.retailer_sku, runId: r.run_id, capturedAt: r.captured_at_utc,
    sap: { department: r.sap_department, category: r.sap_category, subcategory: r.sap_subcategory },
    canonicalGroup: r.canonical_group || null, groupKind: r.group_kind || null,
    unitBasis: r.unit_basis, unitPrice: num(r.unit_price_aud),
    medianUnitPrice: num(r.median_unit_price_aud), maxUnitPrice: num(r.max_unit_price_aud),
    candidates: num(r.candidates),
    name: cleanName(r.product_name), displayName: cleanName(r.display_name), brand: r.brand,
    packageSize: cleanSize(r.package_size_raw), netSizeValue: num(r.net_size_value), netSizeUom: r.net_size_uom,
    price: num(r.price_aud), wasPrice: num(r.was_price_aud), isOnSpecial: bool(r.is_on_special), promoText: r.promo_text || null,
    productUrl: r.product_url, imageUrl: r.image_url,
  }
}

// ---------------------------------------------------------------- queries

// Public (list) shape of a product: descriptive fields + latest observation.
export function publicProduct(p) {
  const { observations, _newest, _categoryWarned, ...rest } = p
  return { ...rest, observationCount: observations.length }
}

// Is this row part of the fruit & veg range the site is about?
//
// Both crawls are of a "Fruit & Vegetables" department, and both retailers stock
// things there that are not produce at all. Coles' crawl carries 64 such rows:
//
//   nuts 25   snacks 22   sauces 7   floral 5   dried-fruit 5
//
// — roasted cashews, party mix, salad dressing, potted Calandiva, bouquets of
// chrysanthemums. They are captured faithfully (L0 is immutable and nothing is
// ever deleted from the archive) but they are not fruit and veg, they have no
// counterpart at the other retailer, and counting them drags every coverage
// figure down for a reason that has nothing to do with the matcher.
//
// `prepared` rows (salad kits, cut fruit — 172 of them) are deliberately NOT
// excluded here: they are a different question, still sold in the aisle, and
// removing them is a bigger call than removing cut flowers.
export const isProduceRow = (p) => p.kind !== 'non_produce'

// The publish gate (categories.js). Every public query filters on this; the
// review scripts pass `includeHidden` to see a category before it ships.
export const isPublicRow = (p) => isPublicCategory(p.crawlCategory)

// `category` (a categories.js slug) narrows a query to one crawled shelf. With
// more than one category public, an aisle page must pass it or it gets every
// shelf's items; site-wide search deliberately does not.
export function searchProducts(q, { retailer, limit = 24, includeNonProduce = false, includeHidden = false, category } = {}) {
  const idx = loadObservations()
  const terms = String(q || '').toLowerCase().split(/\s+/).filter(Boolean)
  const out = []
  for (const p of idx.products.values()) {
    if (!includeHidden && !isPublicRow(p)) continue
    if (category && p.crawlCategory !== category) continue
    if (retailer && p.retailer !== retailer) continue
    if (!includeNonProduce && !isProduceRow(p)) continue
    const hay = `${p.displayName} ${p.name} ${p.brand} ${p.subcategory} ${p.sap.subcategory}`.toLowerCase()
    if (terms.length && !terms.every(t => hay.includes(t))) continue
    // rank: name starts with query > name contains > elsewhere
    const name = p.displayName.toLowerCase()
    const first = terms[0] || ''
    const rank = (name.startsWith(first) ? 0 : name.includes(first) ? 1 : 2) + (p.isPrepared ? 3 : 0)
    out.push({ rank, p })
  }
  out.sort((a, b) => a.rank - b.rank || a.p.displayName.localeCompare(b.p.displayName))
  return { query: q, total: out.length, results: out.slice(0, limit).map(x => publicProduct(x.p)) }
}

export function getProduct(retailer, sku, { includeHidden = false } = {}) {
  const idx = loadObservations()
  const p = idx.products.get(`${retailer}:${sku}`)
  if (!p) return null
  if (!includeHidden && !isPublicRow(p)) return null
  const { _newest, _categoryWarned, ...rest } = p

  // Same retailer, same SAP subcategory, cheaper per unit today — "like-for-like".
  // Compared on the normalised basis rather than on the retailer's own
  // `unit_measure` string: within one retailer the casing is uniform so the old
  // exact-string test was never *wrong*, but it dropped every candidate the
  // retailer happened to quote per 100g against a per-kg line, which is the
  // same number expressed differently.
  const basis = bestBasisOf(p.latest)
  const mine = priceOn(p.latest, basis)
  const alternatives = (basis == null || mine == null ? [] : [...idx.products.values()]
    .filter(o => o !== p && o.retailer === p.retailer && o.crawlCategory === p.crawlCategory
      && o.sap.subcategory === p.sap.subcategory
      && priceOn(o.latest, basis) != null && priceOn(o.latest, basis) < mine && o.latest.isAvailable)
    .sort((a, b) => priceOn(a.latest, basis) - priceOn(b.latest, basis))
    .slice(0, 3))
    .map(publicProduct)

  // The runs behind each observation of this SKU, for the chart's provenance
  // tooltip.
  const runsForProduct = p.observations.map(o => idx.runs.find(r => r.runId === o.runId && r.retailer === p.retailer) || null)

  // Every size this retailer sells the same item in, this SKU included,
  // smallest first. One entry means "only sold in this size".
  const sizes = (idx.items.get(p.itemId)?.skus || [p]).map(publicProduct)

  // The other retailers' rows for the same product (P2.1). Every level and every
  // comparability decision is made server-side — see matching/index.js — so the
  // client renders `comparable` and never re-derives it from `level`.
  // Defence in depth for the gate: a hidden row never appears inside a public
  // page's matches, whatever the index says.
  const visible = (s) => includeHidden || isPublicCategory(s.crawlCategory)
  const matches = applyOverrides(p, matchesFor(p, idx.matching, publicProduct))
    .map(m => (m.sizes.every(visible) && (!m.comparison || visible(m.comparison.other)) ? m : {
      ...m, sizes: m.sizes.filter(visible),
      comparison: m.comparison && visible(m.comparison.other) ? m.comparison : null,
      comparable: !!(m.comparison && visible(m.comparison.other)),
    }))
    .filter(m => m.sizes.length)

  return { ...rest, alternatives, sizes, matches, matchKeyKind: p.domain || 'produce', runs: runsForProduct }
}

// Items (one per product-in-any-size) with every size's latest price, for
// the category grid. `bestSku` is the cheapest size per unit today, which is
// what the grid sorts on; the client picks which size to show.
export function getItems({ retailer, includeNonProduce = false, includeHidden = false, category } = {}) {
  const idx = loadObservations()
  const out = []
  for (const it of idx.items.values()) {
    if (!includeHidden && !it.skus.some(isPublicRow)) continue
    if (category && it.skus[0].crawlCategory !== category) continue
    if (retailer && it.retailer !== retailer) continue
    // Cut flowers and roasted cashews are not fruit and veg — see isProduceRow.
    if (!includeNonProduce && !it.skus.some(isProduceRow)) continue
    const sizes = it.skus.map(publicProduct)
    // The basis is chosen across every size (kg > L > each), not taken from
    // whichever SKU sorted first. 29 items in the 16 Sep captures sell the same
    // item on two bases — `apple|lady|pink` as a loose each AND a 1kg punnet,
    // `brushed|potato`, `rockmelon`, `packham|pear` — and reading the basis off
    // `priced[0]` dropped every SKU on the other basis from this choice, so the
    // grid's "cheapest size" silently ignored half the range and which half
    // depended on sizeRank ordering.
    const basis = bestBasisAcross(sizes.map(s => s.latest))
    const best = cheapestOn(sizes, basis) || sizes[0]
    const lead = it.skus[0]
    out.push({
      id: it.id, retailer: it.retailer, name: it.name, isOrganic: it.isOrganic, isPrepared: lead.isPrepared,
      subcategory: lead.subcategory, sap: lead.sap, imageUrl: lead.imageUrl,
      bestSku: best.sku, basis, sizes,
      // The canonical produce group (matching/groups.js): `apples`, `citrus`,
      // `brassicas`. Unlike `subcategory` it is one vocabulary across both
      // retailers, which is what lets the category page browse by shelf.
      // null for a row the group rules could not place.
      group: lead.matchGroup || null,
      // Enough for a "CHEAPEST AT" badge per tile without N+1 requests. The
      // grid shows which retailers this item is matched to; the product page is
      // where the comparison itself is made.
      matchKey: lead.matchKey || null,
      // Same rules as the product page: a reviewed reject (either side) and a
      // hidden row do not count as a match.
      matchedRetailers: lead.matchKey && !isRejected(lead.matchKey, lead)
        ? [...(idx.matching.byKey.get(lead.matchKey)?.entries() || [])]
          .filter(([r, ps]) => r !== it.retailer
            && ps.some(o => !isRejected(lead.matchKey, o) && (includeHidden || isPublicRow(o))))
          .map(([r]) => r)
        : [],
    })
  }
  return { total: out.length, items: out }
}

export function getCheapest({ retailer, includeHidden = false, category } = {}) {
  const idx = loadObservations()
  const sets = [...idx.cheapest.values()]
    .filter(s => includeHidden || isPublicCategory(s.category))
    .filter(s => !category || s.category === category)
    .filter(s => !retailer || s.retailer === retailer)
  return sets
}

export function getStatus() {
  const idx = loadObservations()
  const syncAgeHours = idx.sync.at ? Math.round(((Date.now() - Date.parse(idx.sync.at)) / 36e5) * 10) / 10 : null
  return {
    ...idx.summary,
    dataDir: idx.dataDir, files: idx.files,
    sync: { ...idx.sync, ageHours: syncAgeHours },
    // Produce only: the site's matching metrics must not move because a hidden
    // category was loaded alongside.
    matching: matchingStatus(idx.matching, idx.products, { domain: 'produce' }),
    // Which run each retailer's "on the shelf today" test points at, and whether
    // that run is only a partial. The match rate has to be read alongside this or
    // lexicon tuning chases crawl gaps (P0.3) instead of vocabulary gaps.
    // Public categories only: a hidden shelf is reported by count alone.
    liveRuns: Object.fromEntries(Object.entries(idx.liveRuns).filter(([k]) => isPublicCategory(k.split(':').slice(1).join(':')))),
    liveRunFromPartial: idx.liveRunFromPartial.filter(k => isPublicCategory(k.split(':').slice(1).join(':'))),
    // A category that is crawled but not yet published, by row count only.
    hiddenCategories: [...idx.products.values()].filter(p => !isPublicRow(p))
      .reduce((m, p) => { m[p.crawlCategory] = (m[p.crawlCategory] || 0) + 1; return m }, {}),
    loadedAt: idx.loadedAt, runs: idx.runs.filter(r => isPublicCategory(r.category)),
  }
}
