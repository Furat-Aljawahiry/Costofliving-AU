# Cost of Living AU 🛒

A plug-and-play React app tracking how Australian grocery prices have moved over
the years, and comparing Woolworths / Coles / Aldi / market prices for the same
basket today.

The numbers are **served by an API**, not hard-coded into the UI: a small Node/
Express server exposes the basket, the historical index, and current prices. The
React client only ever calls `/api/*`, so you can swap the data source without
touching the UI.

## Quick start

```bash
npm install     # installs both client and server (npm workspaces)
npm run dev      # starts the API (:4000) AND the React app (:5173) together
```

Then open **http://localhost:5173**.

That's it — it works immediately with realistic mock prices. No keys, no config.

## What runs

| Part      | Folder    | Port | What it does                                  |
|-----------|-----------|------|-----------------------------------------------|
| API server| `server/` | 4000 | Serves basket, history, prices; runs collector|
| React app | `client/` | 5173 | Home tiles → category detail; calls the API   |

The client's Vite dev server proxies `/api` to the server, so everything is
same-origin in development.

## API endpoints (this is what "fills in the numbers")

```
GET  /api/categories   list of baskets (fruit & veg, meat, ...)
GET  /api/basket       tracked items
GET  /api/stores       Woolworths / Coles / Aldi / Market
GET  /api/history      price index by category, 2014 -> 2026
GET  /api/prices       today's prices per item per store        (MOCK — not rendered)
POST /api/collect      run a collection cycle (refreshes prices)

# Measured data — read from the crawler CSVs in data/out (see below)
GET  /api/status                       what is loaded: product/observation counts, last capture, every run manifest
GET  /api/search?q=potato&limit=10     real SKUs matching the query, with their latest observation
GET  /api/products/:retailer/:sku      one SKU, every observation of it, cheaper like-for-like lines
GET  /api/cheapest                     latest cheapest-by-subcategory rows per retailer
POST /api/reload                       re-read data/out without restarting
```

## Where the real numbers come from

The UI renders a number only if it came out of a crawler CSV. Anything the
design calls for that we cannot measure yet renders as a hatched **NOT WIRED
YET** block saying what data would light it up — so a mock can never be
mistaken for a result.

The server reads every `*.csv` / `*.json` under `data/out` on startup
(override with `DATA_DIR=`), working out each file's type from its `dataset`
column, so the Lambda's `part-00000.csv` / `_manifest.json` naming works as
well as the CLI's. To pull new Lambda runs down from S3:

```bash
npm run sync-data        # aws s3 sync … -> data/out/s3/
curl -X POST localhost:4000/api/reload
```

## Turning on real data

Copy `.env.example` to `.env`:

- **Live Woolworths prices:** set `ENABLE_WOOLWORTHS=true`. The server then hits
  Woolworths' internal search endpoint on `/api/collect` (and once a day while
  running). It's free but unofficial and may be rate-limited — failures fall back
  to mock automatically. Coles/Aldi adapters slot in the same way (see
  `server/adapters/`).
- **ABS history:** `server/data/history.js` serves `data/abs/cpi_food.json`, the
  ABS CPI food series (quarterly, 2014 = 100) written by `npm run fetch-abs`
  (`server/scripts/fetch-abs.mjs`). ABS is the backstory; our captures take over
  from 28 Aug 2026.

## Planning docs

| Doc | What it covers |
|-----|----------------|
| [`ROADMAP.md`](ROADMAP.md) | Phased plan: what to build, in what order, and why data work blocks everything else |
| [`docs/PRODUCT_IDEAS.md`](docs/PRODUCT_IDEAS.md) | Feature catalogue for the website, scored by data dependency and defensibility |
| [`docs/COMPETITIVE_POSITIONING.md`](docs/COMPETITIVE_POSITIONING.md) | The market, the positioning, and where the durable advantages are |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | How the code actually works today |
| [`data/DATA_SOURCING.md`](data/DATA_SOURCING.md) | How real price data gets collected and stored |
| [`data/LAMBDA_OUTPUT_SPEC.md`](data/LAMBDA_OUTPUT_SPEC.md) | Column-by-column contract for collected data |

## Structure

```
costofliving-au/
├─ package.json            workspaces + `npm run dev` (runs both)
├─ .env.example
├─ server/
│  ├─ index.js             Express API
│  ├─ store.js             in-memory prices + collection orchestration
│  ├─ data/basket.js       basket, categories, stores (source of truth)
│  ├─ data/history.js      ABS CPI food index 2014→today (data/abs/cpi_food.json)
│  └─ adapters/
│     ├─ mockPrices.js     default, no-network price source
│     └─ woolworths.js     live Woolworths collector
└─ client/
   ├─ vite.config.js       proxies /api -> :4000
   └─ src/
      ├─ services/api.js    the ONLY place the UI calls the backend
      ├─ App.jsx            home page + tiles
      └─ components/CategoryDetail.jsx
```

## Build for production

```bash
npm run build        # bundles the client into client/dist
npm start            # runs the API server; serve client/dist behind it or any static host
```
