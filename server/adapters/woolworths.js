// Live price adapter — Woolworths internal product-search endpoint.
// Enabled only when ENABLE_WOOLWORTHS=true (see .env). Free but unofficial and
// may be rate-limited / bot-protected; failures are expected and non-fatal.
import { BASKET } from '../data/basket.js'

async function searchOne(keyword) {
  const res = await fetch('https://www.woolworths.com.au/apis/ui/Search/products', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0',
    },
    body: JSON.stringify({ SearchTerm: keyword, PageSize: 1, PageNumber: 1, SortType: 'TraderRelevance' }),
  })
  if (!res.ok) throw new Error(`Woolworths ${res.status}`)
  const data = await res.json()
  const p = data?.Products?.[0]?.Products?.[0]
  return p ? Number(p.Price) : null
}

// Returns rows for the woolworths store only; caller merges with other stores.
export async function collectWoolworths() {
  const collectedAt = new Date().toISOString()
  const rows = []
  for (const item of BASKET) {
    try {
      const price = await searchOne(item.keywords[0])
      if (price != null) rows.push({ itemId: item.id, storeId: 'woolworths', price, source: 'woolworths', collectedAt })
    } catch {
      // skip this item this run
    }
  }
  return rows
}
