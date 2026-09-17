// Deterministic mock price adapter — the plug-and-play default.
// Returns a plausible current price per item per store with no network needed.
import { BASKET, STORES } from '../data/basket.js'

const STORE_FACTOR = { woolworths: 1.0, coles: 1.0, aldi: 0.86, market: 0.95 }

function seeded(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) }
  return ((h >>> 0) % 1000) / 1000
}

export function mockPrices() {
  const collectedAt = new Date().toISOString()
  const rows = []
  for (const item of BASKET) {
    for (const store of STORES) {
      if (store.id === 'market' && item.brandTier !== 'fresh') continue
      const jitter = 0.9 + seeded(item.id + store.id) * 0.2
      const price = +(item.base * (STORE_FACTOR[store.id] ?? 1) * jitter).toFixed(2)
      rows.push({ itemId: item.id, storeId: store.id, price, source: 'mock', collectedAt })
    }
  }
  return rows
}
