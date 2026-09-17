# Cost of Living AU — Architecture & Code Reference

This document exists so a new agent (or a new engineer) can understand this
codebase **without reading every file first**. It explains what the app is,
how data flows through it, what every file does, and the non-obvious
decisions baked into the code. Read this before making changes.

If you only read one section, read **"Mental model"** and **"Data flow"**.

---

## 1. Mental model

Cost of Living AU is a small full-stack web app with two halves:

- **`server/`** — a Node/Express API that owns all the data: a fixed
  "basket" of ~34 everyday Australian grocery items, a list of stores
  (Woolworths, Coles, Aldi, Market), a 2014→2026 yearly price-index history
  per category, and today's per-item/per-store prices.
- **`client/`** — a React (Vite) single-page app that fetches everything
  from `/api/*` and renders it: a home page of category tiles, and a
  per-category detail page with a price-history chart and a price-comparison
  table.

**Nothing is hard-coded in the UI.** The client is a pure rendering layer —
every number it shows came from an API response. This is the app's stated
design principle (see `server/index.js`'s comment and `client/src/services/api.js`).

Out of the box, all prices are **deterministic mock data** — no network
calls, no API keys, no scraping. There's an optional live mode
(`ENABLE_WOOLWORTHS=true`) that scrapes Woolworths' internal search API for
real current prices, with automatic fallback to mock data on failure.

---

## 2. Tech stack

| Layer     | Tech                                                                 |
|-----------|-----------------------------------------------------------------------|
| Server    | Node.js (ESM, `"type": "module"`), Express 4, `cors`                 |
| Client    | React 18, Vite 5, `recharts` (charts), CSS Modules + plain CSS       |
| Repo      | npm **workspaces** monorepo (`server`, `client`), root scripts run both |
| Data      | In-memory only — no database. Data lives in JS modules and a module-level variable in `store.js` |
| Fonts     | Google Fonts (Bricolage Grotesque, Instrument Sans) loaded via `<link>` in `client/index.html` |

No database, no auth, no persistence layer, no tests currently exist in
this repo.

---

## 3. Repo layout

```
costofliving-au/
├─ package.json              root workspace: `npm run dev` runs server+client together
├─ .env.example               documents server/client env vars (copy to .env to use)
├─ .gitignore                 node_modules, dist, .env, *.log
├─ README.md                  short human-facing quick-start
├─ ARCHITECTURE.md            this file
│
├─ server/                    Express API — port 4000
│  ├─ package.json            deps: express, cors. scripts: dev (--watch), start
│  ├─ index.js                defines all /api/* routes, starts the HTTP server
│  ├─ store.js                in-memory current-price cache + collection orchestration
│  ├─ data/
│  │  ├─ basket.js            SOURCE OF TRUTH: categories, stores, the 34-item basket
│  │  └─ history.js           2014→2026 yearly price index per category (mock, ABS-shaped)
│  └─ adapters/
│     ├─ mockPrices.js        default price source — deterministic, no network
│     └─ woolworths.js        optional live price source — scrapes Woolworths' search API
│
└─ client/                    React SPA (Vite) — port 5173
   ├─ index.html               HTML shell, loads Google Fonts, mounts #root
   ├─ vite.config.js           dev server config: port 5173, proxies /api -> :4000
   ├─ package.json             deps: react, react-dom, recharts
   └─ src/
      ├─ main.jsx               React entry point — renders <App /> into #root
      ├─ App.jsx                top-level state machine: loading / error / home / detail
      ├─ index.css              global DARK theme — used by App shell + CategoryDetail
      ├─ services/
      │  └─ api.js              THE ONLY place the client calls the backend (fetch wrapper)
      ├─ pages/
      │  ├─ Home.jsx            home page: hero stats + category tile grid (LIGHT theme)
      │  └─ Home.module.css     scoped styles for Home.jsx (oklch colors, own fonts)
      └─ components/
         └─ CategoryDetail.jsx  per-category page: line chart + store price-comparison table
```

---

## 4. Data flow

```
server/data/basket.js  ──┐
server/data/history.js ──┼──> server/index.js (Express routes) ──> HTTP /api/*
server/store.js        ──┘         ^
      (in-memory prices,           │
       fed by adapters)            │
                                    │
client/src/services/api.js  <──────┘   (fetch wrapper, one function per endpoint)
      │
      ▼
client/src/App.jsx   (fetches all 5 endpoints once on mount, holds it in state)
      │
      ├─ no `active` category selected ──> pages/Home.jsx (tile grid, derived stats)
      └─ `active` category selected     ──> components/CategoryDetail.jsx (chart + table)
```

Key point: **`App.jsx` fetches everything once** (`categories`, `stores`,
`basket`, `history`, `prices`) via `Promise.all` on mount, and passes the
combined object down as props. Neither `Home.jsx` nor `CategoryDetail.jsx`
normally re-fetch (though `Home.jsx` *can* fetch on its own if used without
the `data` prop — see §6.4).

---

## 5. Server — file by file

### 5.1 `server/data/basket.js` — the source of truth

Exports three constants, all served near-verbatim by the API:

- **`CATEGORIES`** — 6 categories, each `{ id, label, icon, blurb }`:
  `vegetables`, `meat`, `canned`, `snacks`, `chocolate`, `staples`.
- **`STORES`** — 4 stores, each `{ id, label, color }`:
  `woolworths`, `coles`, `aldi`, `market`.
- **`BASKET`** — ~34 grocery items, each:
  ```js
  { id, name, category, unit, brandTier, base, keywords }
  ```
  - `id` — slug used to join against prices/history (e.g. `'chicken-breast'`).
  - `category` — matches a `CATEGORIES[].id`.
  - `brandTier` — one of `'fresh'`, `'private_label'`, `'branded'`. Used by
    `mockPrices.js` to decide whether the `market` store stocks the item
    (market only carries `fresh`).
  - `base` — a hand-picked realistic AUD price used as the seed for mock
    pricing (e.g. potatoes `$3.50/kg`).
  - `keywords` — search term(s) used by the live Woolworths adapter; **not
    exposed to the client** (see below).

### 5.2 `server/data/history.js` — historical price index

A hard-coded, ABS-CPI-shaped mock series: 13 years (2014–2026), one index
number per category per year, base 100 = 2014. Exported as `HISTORY`, an
array of **wide-format rows**:
```js
[{ year: 2014, vegetables: 100, meat: 100, canned: 100, ... }, ..., { year: 2026, vegetables: 135, meat: 150, ... }]
```
The comment in this file explicitly says it's shaped to match real ABS Food
CPI (catalogue 6401.0) so it can be swapped for real figures with **no UI
changes** — same shape in, same shape out.

### 5.3 `server/index.js` — the Express app

Six routes, all thin wrappers around the data modules or `store.js`:

| Method | Path             | Returns                                                        |
|--------|------------------|------------------------------------------------------------------|
| GET    | `/api/health`    | `{ ok: true, time }` — liveness check                            |
| GET    | `/api/categories`| `CATEGORIES` verbatim                                            |
| GET    | `/api/stores`    | `STORES` verbatim                                                 |
| GET    | `/api/basket`    | `BASKET`, but **`base` and `keywords` stripped** from each item (server-internal fields — see line `BASKET.map(({ base, keywords, ...pub }) => pub)`) |
| GET    | `/api/history`   | `HISTORY` verbatim                                                |
| GET    | `/api/prices`    | `{ collectedAt, rows }` from `store.getPrices()`                  |
| POST   | `/api/collect`   | Triggers `store.collect()`, returns `{ collectedAt, live, total }` |

CORS is wide open (`app.use(cors())` with no options — any origin can call
this API). No auth on any route.

On boot, it logs whether live Woolworths collection is on. If
`ENABLE_WOOLWORTHS=true`, it also sets a `setInterval` to re-run `collect()`
once every 24 hours for as long as the process stays alive (naive
in-process scheduling, not a cron job — resets if the server restarts).

### 5.4 `server/store.js` — in-memory price cache

This is the only piece of server-side mutable state. Two module-level
variables: `prices` (array of price rows) and `lastCollected` (ISO
timestamp).

- **On module load**, `prices` is seeded with `mockPrices()` immediately —
  this is *why the app "just works" with no setup*: there's always data
  before any client ever asks.
- **`getPrices()`** just returns the current cache — synchronous, no I/O.
- **`collect()`** is the refresh cycle:
  1. Always generates a fresh full mock baseline (`mockPrices()`) — this
     guarantees every item/store combination has *some* price even if live
     collection is off or partially fails.
  2. If `ENABLE_WOOLWORTHS=true`, also calls `collectWoolworths()` inside a
     try/catch (failure → empty array, never throws).
  3. Merges live rows onto the mock base using a `itemId:storeId` key —
     **live rows win, mock fills every gap.** This is the "graceful
     degradation" pattern used throughout the project.
  4. Overwrites `prices` and `lastCollected`, returns a small summary.

### 5.5 `server/adapters/mockPrices.js` — deterministic mock prices

No network calls. For every `(item, store)` pair in the basket × store
cross-product:

- Skips the pair if `store.id === 'market'` and the item's `brandTier !==
  'fresh'` — i.e. **the Market "store" only ever has fresh produce**. This
  is why prices tables show `—` for Market on packaged goods.
- Computes a **seeded pseudo-random jitter** via `seeded(item.id +
  store.id)` — a small FNV-1a-style string hash normalized to `[0, 1)`.
  Because it's a pure function of the id strings (no `Date.now()` or
  `Math.random()`), the same item+store combination always jitters the same
  way — reproducible, not random per-call. Jitter range is `0.9–1.1` (±10%).
- Applies a flat **per-store multiplier** (`STORE_FACTOR`): Woolworths &
  Coles = 1.0, Market = 0.95, **Aldi = 0.86** (Aldi is deliberately modeled
  as cheapest, matching real-world positioning).
- Final price: `base * storeFactor * jitter`, rounded to 2 decimals.
- Row shape: `{ itemId, storeId, price, source: 'mock', collectedAt }`.

### 5.6 `server/adapters/woolworths.js` — optional live adapter

Only invoked when `ENABLE_WOOLWORTHS=true`. For each basket item, POSTs to
Woolworths' **internal, undocumented** product-search endpoint
(`https://www.woolworths.com.au/apis/ui/Search/products`) using the item's
first `keyword`, takes the first product result's price. Per-item errors
are swallowed (`try { } catch { skip }`) so one bad lookup doesn't kill the
whole run. Returns rows only for `storeId: 'woolworths'` — Coles/Aldi have
no adapter yet; the README notes they'd "slot in the same way."

This is explicitly called out (in README and code comments) as **free but
unofficial and may be rate-limited / bot-protected** — failures are
expected, not exceptional.

---

## 6. Client — file by file

### 6.1 `client/src/main.jsx` — entry point

Standard Vite/React bootstrap: mounts `<App />` into `#root` inside
`<React.StrictMode>`. Imports the global dark theme (`index.css`).

### 6.2 `client/src/services/api.js` — the only network boundary

```js
const BASE = import.meta.env.VITE_API_URL || '/api'
```
Every other client file that needs data goes through the exported `api`
object (`api.categories()`, `api.stores()`, `api.basket()`, `api.history()`,
`api.prices()`, `api.collect()`). In dev, `VITE_API_URL` is unset, so `BASE`
is `/api` and Vite's dev proxy (see `vite.config.js`) forwards it to
`localhost:4000`. In production, set `VITE_API_URL` to point at wherever the
API is actually deployed. **If you add a new endpoint on the server, add a
matching one-liner here — nothing else should call `fetch` directly.**

### 6.3 `client/src/App.jsx` — top-level state machine

Holds all app state in one component:
- `data` — `{ categories, stores, basket, history, prices, collectedAt }`,
  fetched once via `Promise.all` in `load()`, run once on mount.
- `error` — set if any of the 5 fetches reject; renders a friendly "can't
  reach the API" message telling the user to run `npm run dev`.
- `active` — `null` (home) or a category id (detail view). This is the
  **entire routing mechanism** — there is no react-router, no URL changes
  beyond a `#hash` set by `Home.jsx`'s anchor tags (which is cosmetic only;
  `onSelect` state is what actually drives the view).

Render logic: error → error message; no data yet → loading message;
`active` set → `<CategoryDetail>`; otherwise → `<Home>`. Note
`CategoryDetail` is wrapped in a `<div className="app">` (dark theme
container from `index.css`), but `<Home>` is returned **directly, without**
that wrapper — see §7 on the two-theme quirk.

### 6.4 `client/src/pages/Home.jsx` — the home page

Renders the hero section (title, lede, 3 stat tiles) and a grid of category
cards. Designed to work two ways (see its docstring):
1. **Preferred / actual usage**: parent (`App.jsx`) passes `data` +
   `onSelect` — Home is purely presentational.
2. **Standalone fallback**: if no `data` prop is given, it fetches its own
   data via the same `api` module. (Currently unused in this app since
   `App.jsx` always supplies `data`, but keeps `Home.jsx` reusable/portable
   — the code comments call this "the Claude Design page," implying it was
   authored/generated independently and wired in afterward.)

All the interesting logic is in the **view-model builder** at the bottom of
the file:

- **`buildView({ categories, basket, history, prices, stores })`** — turns
  raw API payloads into everything the JSX needs: per-category theme colors
  (`THEME` map, keyed by category id, `oklch()` accent + tint pairs, with a
  `DEFAULT_THEME` fallback for unknown ids), item counts per category
  (`groupBy`), and the 3 headline stats.
- **`pctSince2014(history, categoryId)`** — `(last - first) / first`, from
  the wide-format history rows, formatted as a signed percentage string
  (e.g. `"+35%"`). This is the number shown on each category card.
- **`overallPct(history, categories)`** — averages the per-category percent
  changes (not a weighted basket average) — this is the hero stat "Average
  basket rise since 2014."
- **`cheapestStore(prices, stores)`** — sums all prices per store across
  the whole basket (excluding `market`, since it only has partial/fresh
  coverage and would look artificially cheap) and returns the store label
  with the lowest total. This is the hero stat "Cheapest today, on
  average."
- **`groupBy(arr, key)`** — generic array-to-object grouping helper.

`IMAGES` maps a category id to an optional hero image path under
`/public/images/`; only `snacks` has one currently
(`client/public/images/snacks.jpg`).

### 6.5 `client/src/components/CategoryDetail.jsx` — category page

Given a single `category` plus the full `basket`/`stores`/`history`/`prices`
arrays (filtered internally), renders:
- A back button (`onBack` callback, wired to `setActive(null)` in `App.jsx`).
- Two stat cards: overall `+N%` change 2014→2026 (recomputed locally, same
  formula as `pctSince2014` in Home, but not shared/deduped — it's
  reimplemented here) and item count.
- A **recharts** `<LineChart>` plotting `history` for just this category's
  key (`dataKey={category.id}`), colored via a local `COLORS` map (separate
  from `Home.jsx`'s `THEME` — hex strings here vs `oklch()` there, another
  sign these two files evolved independently).
- A price-comparison **table**: one row per basket item in this category,
  one column per store. `priceFor(itemId, storeId)` looks up the matching
  row in the flat `prices` array (linear `.find()` — fine at this data
  size, ~34 items × 4 stores). The lowest non-null price in each row gets
  the `.cheapest` CSS class (green, bold) via a `Math.min` over that row's
  values.

### 6.6 Styling — two separate design systems

- **`client/src/index.css`** — global dark theme (CSS custom properties:
  `--bg`, `--panel`, `--text`, `--accent`, etc.), used by the `.app` shell
  wrapper in `App.jsx` and consumed via plain class names
  (`.panel`, `.tile`, `.chip`, `table`/`th`/`td`, `.stat`, `.state`) inside
  `CategoryDetail.jsx`.
- **`client/src/pages/Home.module.css`** — a completely separate **light**
  theme, scoped via CSS Modules (`styles.page`, `styles.hero`, etc.), using
  `oklch()` colors and its own font stack declared in `client/index.html`
  (Bricolage Grotesque for headings, Instrument Sans for body). Not
  connected to `index.css`'s custom properties at all.

See §7 for why this matters.

---

## 7. Non-obvious behaviors & gotchas

- **The home page and the rest of the app use different visual themes.**
  `Home.jsx` is light-mode with its own font system; `App.jsx`'s wrapper
  (`.app`) and `CategoryDetail.jsx` are dark-mode using `index.css`
  variables. This isn't a bug in the sense of broken functionality, but if
  you're asked to make the app "visually consistent," this is the first
  thing to reconcile — currently going Home → category detail is a jarring
  light→dark transition.
- **`/api/basket` intentionally omits `base` and `keywords`** from each
  item — these are server-internal (pricing seed, scraper search term).
  Don't add them to the public payload without checking if that's actually
  wanted; the exclusion looks deliberate (explicit comment).
- **Market only stocks `brandTier: 'fresh'` items** — both in mock price
  generation (`mockPrices.js`) and in the "cheapest store" calculation
  (`Home.jsx` explicitly excludes `market` from that comparison, since
  partial coverage would make it look artificially cheap).
- **Mock prices are deterministic, not random-per-request** — the seeded
  hash means calling `/api/prices` repeatedly (without hitting `/api/collect`)
  returns identical numbers. A fresh `POST /api/collect` regenerates the
  mock baseline (same seeded values, since seed = item+store id, not time)
  and re-attempts live collection.
- **`collectedAt` updates even for the mock baseline** — it's a wall-clock
  timestamp per collection run, not tied to the underlying price actually
  changing.
- **No persistence** — restarting the server resets `prices` to a freshly
  seeded mock baseline; any live-collected data is lost. There is no
  database anywhere in this project.
- **No pagination/filtering** on any endpoint — basket is small (~34 items)
  so full payloads are returned every time.
- **Aldi is hard-coded ~14% cheaper** than Woolworths/Coles in mock data
  (`STORE_FACTOR.aldi = 0.86`) — this is a modeling choice, not scraped
  fact, and will always make Aldi "win" the cheapest-store stat unless real
  adapters for Coles/Aldi are added.
- **Only Woolworths has a live adapter.** Coles and Aldi are mock-only
  regardless of `.env` settings — there's no `ENABLE_COLES` or similar flag
  yet.
- **The Woolworths adapter hits an undocumented internal API** — expect it
  to break silently (caught and ignored) if Woolworths changes that
  endpoint; there's no alerting, just silent fallback to mock.

---

## 8. Running the app

```bash
npm install     # root install; npm workspaces also installs server/ and client/
npm run dev     # runs API (:4000) and React app (:5173) concurrently
```
Open `http://localhost:5173`. The Vite dev server proxies `/api/*` to
`:4000` (see `client/vite.config.js`), so the client's `fetch('/api/...')`
calls work same-origin in dev without CORS involvement (though the server
also sets permissive CORS headers regardless).

Individual pieces: `npm run dev:server`, `npm run dev:client`.

Production: `npm run build` (bundles client into `client/dist`), `npm start`
(runs just the API — you're expected to serve `client/dist` separately, e.g.
behind the same Express instance, a static host, or a CDN; that wiring
doesn't exist in the repo yet).

### Environment variables (`.env`, copy from `.env.example`)

| Var                 | Default   | Effect                                                        |
|----------------------|-----------|------------------------------------------------------------------|
| `PORT`               | `4000`    | API server port                                                  |
| `ENABLE_WOOLWORTHS`  | `false`   | Turns on live Woolworths scraping (on `/api/collect` + daily interval) |
| `APIFY_TOKEN`        | (unset)   | Documented for a future paid/more-reliable scraping path — **not currently read anywhere in the code**; present only as a placeholder for future work |
| `VITE_API_URL`       | (unset)   | Client-side: overrides API base URL; leave blank to use the Vite dev proxy |

---

## 9. Likely extension points

If asked to extend this app, these are the natural seams (per the README
and code comments):

- **Real historical data**: replace the `SERIES` object in
  `server/data/history.js` with actual ABS Food CPI (6401.0) figures — same
  row shape, zero UI changes required.
- **Real Coles/Aldi prices**: add `server/adapters/coles.js` /
  `server/adapters/aldi.js` following the exact pattern of
  `woolworths.js` (a `collectX()` async function returning
  `{ itemId, storeId, price, source, collectedAt }[]`), then call it from
  `store.js`'s `collect()` the same way Woolworths is called, gated behind
  its own `ENABLE_*` env flag.
- **New basket items/categories**: edit `server/data/basket.js` only — the
  client derives everything (theme colors default gracefully via
  `DEFAULT_THEME` in `Home.jsx` for unknown category ids, though
  `CategoryDetail.jsx`'s `COLORS` map has no such fallback and would render
  `undefined` as a chart stroke color for a brand-new category id — add an
  entry there too).
- **Persistence**: `store.js`'s in-memory `prices` variable is the obvious
  place to swap in a real database or file-based cache if prices need to
  survive a restart.
