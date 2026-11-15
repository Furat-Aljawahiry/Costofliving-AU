import { useEffect, useState } from 'react'
import { api } from './services/api.js'
import Home from './pages/Home.jsx'
import Product from './pages/Product.jsx'
import Category from './pages/Category.jsx'
import Cheapest from './pages/Cheapest.jsx'
import { MERGED_AISLES } from './lib/categories.js'

// Tiny hash router so every page has a shareable URL and refresh works:
//   #/                          home
//   #/product/:retailer/:sku    one retailer SKU and every observation of it
//   #/category/:id              category (a merged aisle id lands on its successor)
//   #/category/:id/:group       one shelf within it (apples, citrus, brassicas)
//   #/cheapest                  every produce group's cheapest line today
function parseRoute(hash) {
  const parts = (hash || '#/').replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  if (parts[0] === 'product' && parts[1] && parts[2]) return { name: 'product', retailer: parts[1], sku: parts[2] }
  if (parts[0] === 'category' && parts[1]) return { name: 'category', id: MERGED_AISLES[parts[1]] || parts[1], group: parts[2] || '' }
  if (parts[0] === 'cheapest') return { name: 'cheapest' }
  return { name: 'home' }
}

export default function App() {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash))
  const [status, setStatus] = useState(null)   // /api/status — what data is loaded
  const [error, setError] = useState(null)

  useEffect(() => {
    const onHash = () => { setRoute(parseRoute(window.location.hash)); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    api.status().then(setStatus).catch(e => setError(e.message))
  }, [])

  if (error) return (
    <div className="state">
      Couldn't reach the API ({error}).<br />
      Make sure the server is running — <code>npm run dev</code> starts both.
    </div>
  )

  if (route.name === 'product') return <Product retailer={route.retailer} sku={route.sku} status={status} />
  if (route.name === 'category') return <Category id={route.id} group={route.group} status={status} />
  if (route.name === 'cheapest') return <Cheapest status={status} />
  return <Home status={status} />
}
