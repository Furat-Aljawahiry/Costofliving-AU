// The only place the client talks to the backend. Every number the UI shows
// comes through here — swap the backend and the UI is unchanged.

const BASE = import.meta.env.VITE_API_URL || '/api'

async function get(path) {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`)
  return res.json()
}

export const api = {
  // Original scaffolding (basket / mock prices). The UI no
  // longer renders numbers from these — see NotWired placeholders.
  categories: () => get('/categories'),
  stores: () => get('/stores'),
  basket: () => get('/basket'),
  prices: () => get('/prices'),
  collect: () => fetch(`${BASE}/collect`, { method: 'POST' }).then(r => r.json()),

  // Measured data — the crawler CSVs in data/out.
  status: () => get('/status'),
  // ABS CPI food series 2014 -> today (data/abs snapshot, see server/scripts/fetch-abs.mjs).
  history: () => get('/history'),
  search: (q, { retailer, limit } = {}) => {
    const p = new URLSearchParams({ q })
    if (retailer) p.set('retailer', retailer)
    if (limit) p.set('limit', limit)
    return get(`/search?${p}`)
  },
  product: (retailer, sku) => get(`/products/${encodeURIComponent(retailer)}/${encodeURIComponent(sku)}`),
  // One row per item (same retailer, any size) with every size's latest price.
  // `category` is a server category slug (client/src/lib/categories.js CRAWLED).
  items: ({ retailer, category } = {}) => {
    const p = new URLSearchParams()
    if (retailer) p.set('retailer', retailer)
    if (category) p.set('category', category)
    return get(`/items${p.size ? `?${p}` : ''}`)
  },
  cheapest: (category) => get(`/cheapest${category ? `?category=${encodeURIComponent(category)}` : ''}`),
}
