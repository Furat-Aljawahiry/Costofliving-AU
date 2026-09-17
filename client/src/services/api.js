// The only place the client talks to the backend. Every number the UI shows
// comes through here — swap the backend and the UI is unchanged.

const BASE = import.meta.env.VITE_API_URL || '/api'

async function get(path) {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`)
  return res.json()
}

export const api = {
  // Original scaffolding (basket / mock prices / modelled history). The UI no
  // longer renders numbers from these — see NotWired placeholders.
  categories: () => get('/categories'),
  stores: () => get('/stores'),
  basket: () => get('/basket'),
  history: () => get('/history'),
  prices: () => get('/prices'),
  collect: () => fetch(`${BASE}/collect`, { method: 'POST' }).then(r => r.json()),

  // Measured data — the crawler CSVs in data/out.
  status: () => get('/status'),
  search: (q, { retailer, limit } = {}) => {
    const p = new URLSearchParams({ q })
    if (retailer) p.set('retailer', retailer)
    if (limit) p.set('limit', limit)
    return get(`/search?${p}`)
  },
  product: (retailer, sku) => get(`/products/${encodeURIComponent(retailer)}/${encodeURIComponent(sku)}`),
  cheapest: () => get('/cheapest'),
}
