// Cost of Living AU — API server.
// Exposes the data the React client renders. Pulls the price archive from S3
// at boot and hourly, and refuses to start if that fails (DATA_SYNC=off to run
// without it). Set ENABLE_WOOLWORTHS=true in .env for the live scrape.
import express from 'express'
import cors from 'cors'
import { CATEGORIES, STORES, BASKET } from './data/basket.js'
import { getHistory } from './data/history.js'
import { getPrices, collect } from './store.js'
import { loadObservations, searchProducts, getProduct, getItems, getCheapest, getStatus } from './data/observations.js'
import { syncPolicy, archive } from './config.js'

const app = express()
app.use(cors())
app.use(express.json())

// Health is about the DATA, not about Express being up. A process that is
// listening happily while serving week-old prices is not healthy, and the old
// unconditional { ok: true } is why nobody noticed for eight days.
app.get('/api/health', (req, res) => {
  const s = getStatus()
  const ok = !s.stale && s.sync.reason !== 'disabled'
  res.status(ok ? 200 : 503).json({
    ok, time: new Date().toISOString(),
    lastCapturedAt: s.lastCapturedAt, stalenessHours: s.stalenessHours, stale: s.stale,
    sync: { ok: s.sync.ok, reason: s.sync.reason, at: s.sync.at },
  })
})
app.get('/api/categories', (req, res) => res.json(CATEGORIES))
app.get('/api/stores', (req, res) => res.json(STORES))
app.get('/api/basket', (req, res) => {
  // strip server-only fields (base, keywords) from the public payload
  res.json(BASKET.map(({ base, keywords, ...pub }) => pub))
})
app.get('/api/prices', (req, res) => res.json(getPrices()))

// ---- Real observations from the crawler CSVs (data/out) --------------------
// These are the only endpoints backed by measured data. Everything above is
// the original mock/basket scaffolding.
app.get('/api/status', (req, res) => res.json(getStatus()))
// ABS CPI food series, 2014 -> today (data/abs/cpi_food.json, `npm run fetch-abs`).
app.get('/api/history', (req, res) => {
  const h = getHistory()
  if (!h) return res.status(503).json({ error: 'no ABS snapshot; run npm run fetch-abs' })
  res.json(h)
})
app.get('/api/search', (req, res) => {
  const { q = '', retailer, limit, category } = req.query
  res.json(searchProducts(q, { retailer, category, limit: limit ? Number(limit) : undefined }))
})
app.get('/api/products/:retailer/:sku', (req, res) => {
  const p = getProduct(req.params.retailer, req.params.sku)
  if (!p) return res.status(404).json({ error: 'not found' })
  res.json(p)
})
// One row per item in any size (same retailer), each with its sizes' prices.
// ?includeNonProduce=1 puts the nuts, cut flowers and salad dressings back in.
// They are captured and kept, just not served as fruit and veg by default.
// ?category=<slug> (server/data/categories.js) narrows to one crawled shelf —
// required by the client once more than one category is public.
app.get('/api/items', (req, res) => res.json(getItems({
  retailer: req.query.retailer, category: req.query.category,
  includeNonProduce: req.query.includeNonProduce === '1',
})))
app.get('/api/cheapest', (req, res) => res.json(getCheapest({ retailer: req.query.retailer, category: req.query.category })))
// Pull the archive from S3 and re-read it, without restarting. The same thing
// runs at boot and on a timer below, so the site follows the crawler's
// twice-daily schedule on its own; this is the manual override.
app.post('/api/reload', (req, res) => { loadObservations({ force: true }); res.json(getStatus()) })

// Trigger a collection cycle (also what a daily scheduled task would hit).
app.post('/api/collect', async (req, res) => {
  try { res.json(await collect()) }
  catch (e) { res.status(500).json({ error: String(e) }) }
})

// Boot: sync + load once up front so the first request is not the slow one.
const boot = loadObservations()
const policy = syncPolicy()

// Say out loud where the data is coming from. Every line below existed as a
// silent condition before, which is the whole reason this block does.
if (policy.enabled) console.log(`[boot] archive sync ON  -> s3://${archive().bucket}/${archive().prefix} every ${policy.intervalMin} min`)
else console.warn('[boot] archive sync OFF (DATA_SYNC=off) — serving data/out as is; prices will be as old as this checkout')

// A failed sync at boot is fatal by default. Serving stale prices silently is
// the failure this whole change exists to prevent, so the server refuses
// rather than pretending. DATA_SYNC=off is the supported way to work offline.
if (policy.required && boot.sync.reason !== 'ok') {
  console.error(`\n  Archive sync failed at boot (${boot.sync.reason}): ${boot.sync.message}`)
  console.error('  Fix the cause, or run without the archive:  DATA_SYNC=off npm run dev:server\n')
  process.exit(1)
}
if (boot.summary.stale) {
  console.warn(`[boot] newest capture is ${boot.summary.stalenessHours} h old — /api/health will report unhealthy`)
}

if (policy.intervalMin > 0) {
  setInterval(() => {
    try { loadObservations({ force: true }) } catch (e) { console.warn(`[observations] scheduled reload failed: ${e.message}`) }
  }, policy.intervalMin * 60 * 1000)
}

const PORT = process.env.PORT || 4000
app.listen(PORT, () => {
  console.log(`\n  Cost of Living AU API  ->  http://localhost:${PORT}/api`)
  console.log(`  Live Woolworths: ${process.env.ENABLE_WOOLWORTHS === 'true' ? 'ON' : 'off (mock data)'}\n`)
})

// Optional: auto-collect daily if the process stays up.
if (process.env.ENABLE_WOOLWORTHS === 'true') {
  setInterval(() => collect().catch(() => {}), 24 * 60 * 60 * 1000)
}
