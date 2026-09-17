// Cost of Living AU — API server.
// Exposes the data the React client renders. Runs with zero config (mock data);
// set ENABLE_WOOLWORTHS=true in .env to pull live Woolworths prices.
import express from 'express'
import cors from 'cors'
import { CATEGORIES, STORES, BASKET } from './data/basket.js'
import { HISTORY } from './data/history.js'
import { getPrices, collect } from './store.js'
import { loadObservations, searchProducts, getProduct, getCheapest, getStatus } from './data/observations.js'

const app = express()
app.use(cors())
app.use(express.json())

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }))
app.get('/api/categories', (req, res) => res.json(CATEGORIES))
app.get('/api/stores', (req, res) => res.json(STORES))
app.get('/api/basket', (req, res) => {
  // strip server-only fields (base, keywords) from the public payload
  res.json(BASKET.map(({ base, keywords, ...pub }) => pub))
})
app.get('/api/history', (req, res) => res.json(HISTORY))
app.get('/api/prices', (req, res) => res.json(getPrices()))

// ---- Real observations from the crawler CSVs (data/out) --------------------
// These are the only endpoints backed by measured data. Everything above is
// the original mock/basket scaffolding.
app.get('/api/status', (req, res) => res.json(getStatus()))
app.get('/api/search', (req, res) => {
  const { q = '', retailer, limit } = req.query
  res.json(searchProducts(q, { retailer, limit: limit ? Number(limit) : undefined }))
})
app.get('/api/products/:retailer/:sku', (req, res) => {
  const p = getProduct(req.params.retailer, req.params.sku)
  if (!p) return res.status(404).json({ error: 'not found' })
  res.json(p)
})
app.get('/api/cheapest', (req, res) => res.json(getCheapest({ retailer: req.query.retailer })))
// Re-read data/out without restarting (after an `aws s3 sync`).
app.post('/api/reload', (req, res) => { loadObservations({ force: true }); res.json(getStatus()) })

// Trigger a collection cycle (also what a daily scheduled task would hit).
app.post('/api/collect', async (req, res) => {
  try { res.json(await collect()) }
  catch (e) { res.status(500).json({ error: String(e) }) }
})

const PORT = process.env.PORT || 4000
app.listen(PORT, () => {
  console.log(`\n  Cost of Living AU API  ->  http://localhost:${PORT}/api`)
  console.log(`  Live Woolworths: ${process.env.ENABLE_WOOLWORTHS === 'true' ? 'ON' : 'off (mock data)'}\n`)
})

// Optional: auto-collect daily if the process stays up.
if (process.env.ENABLE_WOOLWORTHS === 'true') {
  setInterval(() => collect().catch(() => {}), 24 * 60 * 60 * 1000)
}
