// In-memory price store + collection orchestration.
// Seeds with mock prices at boot so the app shows data immediately (plug-and-play).
// A collection run refreshes prices: live Woolworths where enabled, mock elsewhere.
import { mockPrices } from './adapters/mockPrices.js'
import { collectWoolworths } from './adapters/woolworths.js'

let prices = mockPrices()          // current price rows
let lastCollected = new Date().toISOString()

export function getPrices() {
  return { collectedAt: lastCollected, rows: prices }
}

// Run a collection cycle. Live where configured, mock as the base layer.
export async function collect() {
  const base = mockPrices()        // guarantees full coverage of every item/store
  let live = []
  if (process.env.ENABLE_WOOLWORTHS === 'true') {
    try { live = await collectWoolworths() } catch { live = [] }
  }
  // Overlay live rows onto the mock base (live wins where present).
  const key = (r) => `${r.itemId}:${r.storeId}`
  const map = new Map(base.map(r => [key(r), r]))
  for (const r of live) map.set(key(r), r)
  prices = [...map.values()]
  lastCollected = new Date().toISOString()
  return { collectedAt: lastCollected, live: live.length, total: prices.length }
}
