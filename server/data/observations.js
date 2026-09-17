// Real price observations, loaded from the crawler's own output files.
//
// The two Lambdas (see infra/terraform/lambda/category_crawler) write, per run
// and per retailer, a products CSV, a cheapest-by-subcategory CSV and a
// manifest JSON. This module reads every such file under DATA_DIR (default
// ../data/out), whatever it is named — the type of each file is decided by its
// `dataset` column/field, not its filename — and builds an in-memory index:
//
//   products     retailer:sku -> product + every observation of it, oldest first
//   cheapest     latest cheapest-by-subcategory rows, per retailer
//   runs         one entry per manifest (status, counts, capture context)
//
// Nothing here is estimated. If a number is not in a CSV, it is not served.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(HERE, '..', '..', 'data', 'out'))

// ---------------------------------------------------------------- S3 sync
//
// The archive lives in S3; data/out is a working copy. With DATA_BUCKET set
// the server pulls the archive down (incrementally — `aws s3 sync` copies only
// what changed) before every load, so a freshly booted server serves the
// newest run and a reload picks up last night's without anyone running a
// script. Without DATA_BUCKET, or when the CLI is missing or unauthenticated,
// it says so once and serves whatever data/out holds — the dev fallback.
//
// The CLI rather than the SDK: it is what this repo already assumes for
// credentials and region (data/scripts/pull_latest_reports.py does the same).
const DATA_BUCKET = process.env.DATA_BUCKET || ''
const DATA_PREFIX = process.env.DATA_PREFIX || 'reports/supermarkets'
const AWS_REGION = process.env.AWS_REGION || 'ap-southeast-2'
const SYNC_DIR = path.join(DATA_DIR, 's3')

let LAST_SYNC = { at: null, ok: null, message: DATA_BUCKET ? 'not yet run' : 'DATA_BUCKET not set; serving data/out as is' }

export function syncArchive() {
  if (!DATA_BUCKET) return LAST_SYNC
  const started = Date.now()
  const r = spawnSync('aws', [
    '--region', AWS_REGION, 's3', 'sync', `s3://${DATA_BUCKET}/${DATA_PREFIX}`, SYNC_DIR,
    '--exclude', '*', '--include', '*.csv', '--include', '*.json', '--no-progress',
  ], { encoding: 'utf8', timeout: 5 * 60 * 1000 })
  const ok = r.status === 0
  const copied = ok ? (r.stdout.match(/^download:/gm) || []).length : 0
  const failure = (r.error?.message || r.stderr || `exit ${r.status}`).trim().split('\n')[0]
  LAST_SYNC = {
    at: new Date().toISOString(), ok,
    message: ok ? `${copied} files copied in ${Date.now() - started} ms` : failure,
  }
  console.log(`[observations] s3 sync ${ok ? 'ok' : 'FAILED'}: ${LAST_SYNC.message}${ok ? '' : ' — serving local data/out'}`)
  return LAST_SYNC
}

// ---------------------------------------------------------------- CSV parsing

// RFC 4180-ish: quoted fields, doubled quotes, CRLF or LF.
function parseCsv(text) {
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

  for (const file of walk(DATA_DIR)) {
    try {
      if (file.endsWith('.json')) {
        const m = JSON.parse(fs.readFileSync(file, 'utf8'))
        if (!m || typeof m !== 'object' || Array.isArray(m) || !m.run_id) { files.skipped++; continue }
        files.manifests++
        runs.set(`${m.run_id}:${m.retailer}`, {
          runId: m.run_id, retailer: m.retailer, status: m.status,
          startedAt: m.started_at_utc, finishedAt: m.finished_at_utc,
          egress: m.capture_context?.egress, priceBasis: m.capture_context?.price_basis,
          storeId: m.capture_context?.store_id,
          rowsWritten: m.counts?.rows_written, rowsWithPrice: m.counts?.rows_with_price,
          pagesFetched: m.counts?.pages_fetched, errors: m.errors || [],
          cheapest: m.cheapest_by_subcategory || null,
          file: path.relative(DATA_DIR, file),
        })
        continue
      }

      const rows = parseCsv(fs.readFileSync(file, 'utf8'))
      const dataset = rows[0]?.dataset || ''
      if (dataset.endsWith('.products')) {
        files.products++
        for (const r of rows) ingestProduct(products, seenObs, r, file)
      } else if (dataset.endsWith('.cheapest_by_subcategory')) {
        files.cheapest++
        cheapestCandidates.push({
          retailer: rows[0].retailer, runId: rows[0].run_id, capturedAt: rows[0].captured_at_utc,
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
  const dropped = new Set(collapsed.filter(r => r.collapsedInto).map(r => `${r.retailer}:${r.runId}`))

  // Finalise: drop observations from collapsed runs, sort, derive latest.
  for (const [key, p] of products) {
    p.observations = p.observations.filter(o => !dropped.has(`${p.retailer}:${o.runId}`))
    if (!p.observations.length) { products.delete(key); continue }
    p.observations.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
    p.latest = p.observations[p.observations.length - 1]
    p.firstSeen = p.observations[0].capturedAt
    p.lastSeen = p.latest.capturedAt
  }

  const runList = collapsed.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''))
  const lastCapture = runList.find(r => !r.collapsedInto && (r.status === 'complete' || r.status === 'partial')) || null

  // "Cheapest today" comes from the newest COMPLETE run per retailer: a
  // partial run's cheapest file is missing whatever the crawl missed, and a
  // cheapest line that was simply not fetched would read as "got dearer".
  // With no complete run at all for a retailer, the newest partial is used
  // and the status endpoint says so.
  const cheapestByRun = new Map()
  const statusOf = (c) => runs.get(`${c.runId}:${c.retailer}`)?.status
  for (const c of cheapestCandidates.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))) {
    if (dropped.has(`${c.retailer}:${c.runId}`)) continue
    const cur = cheapestByRun.get(c.retailer)
    const complete = statusOf(c) === 'complete'
    if (!cur || (complete && !cur.complete)) cheapestByRun.set(c.retailer, { ...c, complete })
  }

  INDEX = {
    dataDir: DATA_DIR, files, sync: LAST_SYNC,
    products, cheapest: cheapestByRun, runs: runList,
    summary: {
      productCount: products.size,
      retailers: [...new Set([...products.values()].map(p => p.retailer))],
      observationCount: [...products.values()].reduce((n, p) => n + p.observations.length, 0),
      lastCapturedAt: lastCapture?.finishedAt || lastCapture?.startedAt || null,
      runCount: runList.filter(r => !r.collapsedInto).length,
      collapsedRunCount: dropped.size,
      cheapestFromPartial: [...cheapestByRun.values()].filter(c => !c.complete).map(c => c.retailer),
    },
    loadedAt: new Date().toISOString(),
  }
  console.log(`[observations] ${INDEX.summary.productCount} products, ${INDEX.summary.observationCount} observations from ${files.products} product files, ${files.cheapest} cheapest files, ${files.manifests} manifests (${DATA_DIR})`)
  return INDEX
}

const COLLAPSE_WINDOW_MS = 60 * 60 * 1000

function collapseRuns(list) {
  const rank = (r) => (r.status === 'complete' ? 1 : 0)
  const byRetailer = new Map()
  for (const r of list) {
    r.collapsedInto = null
    if (!byRetailer.has(r.retailer)) byRetailer.set(r.retailer, [])
    byRetailer.get(r.retailer).push(r)
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

function ingestProduct(products, seenObs, r, file) {
  if (!r.retailer || !r.retailer_sku) return
  const key = `${r.retailer}:${r.retailer_sku}`
  const obsKey = `${key}:${r.run_id}`
  if (seenObs.has(obsKey)) return   // same run copied into two folders
  seenObs.add(obsKey)

  let p = products.get(key)
  if (!p) {
    p = {
      key, retailer: r.retailer, sku: r.retailer_sku, gtin: r.gtin || null,
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
  }
  p.observations.push({
    runId: r.run_id, capturedAt: r.captured_at_utc,
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
    file: path.relative(DATA_DIR, file),
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
  const { observations, _newest, ...rest } = p
  return { ...rest, observationCount: observations.length }
}

export function searchProducts(q, { retailer, limit = 24 } = {}) {
  const idx = loadObservations()
  const terms = String(q || '').toLowerCase().split(/\s+/).filter(Boolean)
  const out = []
  for (const p of idx.products.values()) {
    if (retailer && p.retailer !== retailer) continue
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

export function getProduct(retailer, sku) {
  const idx = loadObservations()
  const p = idx.products.get(`${retailer}:${sku}`)
  if (!p) return null
  const { _newest, ...rest } = p

  // Same retailer, same SAP subcategory, cheaper per unit today — "like-for-like".
  const basis = p.latest.unitMeasure
  const alternatives = [...idx.products.values()]
    .filter(o => o !== p && o.retailer === p.retailer && o.sap.subcategory === p.sap.subcategory
      && o.latest.unitMeasure === basis && o.latest.unitPrice != null && p.latest.unitPrice != null
      && o.latest.unitPrice < p.latest.unitPrice && o.latest.isAvailable)
    .sort((a, b) => a.latest.unitPrice - b.latest.unitPrice)
    .slice(0, 3)
    .map(publicProduct)

  // Every SKU in the same subcategory across retailers — the honest "matched
  // SKUs" list until cross-retailer matching exists (canonical keys don't match
  // across retailers yet; see LAMBDA_OUTPUT_SPEC.md §8.1).
  const runsForProduct = p.observations.map(o => idx.runs.find(r => r.runId === o.runId && r.retailer === p.retailer) || null)

  return { ...rest, alternatives, runs: runsForProduct }
}

export function getCheapest({ retailer } = {}) {
  const idx = loadObservations()
  const sets = [...idx.cheapest.values()].filter(s => !retailer || s.retailer === retailer)
  return sets
}

export function getStatus() {
  const idx = loadObservations()
  return { ...idx.summary, dataDir: idx.dataDir, files: idx.files, sync: idx.sync, loadedAt: idx.loadedAt, runs: idx.runs }
}
