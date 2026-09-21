# Data Sourcing & Storage — Woolworths, Coles, Aldi, Foodworks, Costco + Market Veg Prices

This document is the plan for how **Cost of Living AU** gets real grocery
price data (beyond the current mock data) and how that data is stored so the
app can ingest it through the existing `/api/*` endpoints without UI changes.

Status: **draft v1** — written before agent review rounds. See the
"Revision log" at the bottom for what changed after feedback.

See also **[`LAMBDA_OUTPUT_SPEC.md`](LAMBDA_OUTPUT_SPEC.md)** — the column-by-column
contract for the file a collection Lambda writes, and the rules that keep
future Lambdas' output joinable with today's.

---

## 1. Per-retailer data access

> ⚠️ **Legal/ToS note (applies to every retailer in this table):** none of
> these retailers offer a public API for this purpose. Woolworths and Coles
> both run bot protection (e.g. Akamai) specifically to deter this kind of
> automated access, and their Terms of Use almost certainly prohibit
> scraping/automated data collection — being blockable is evidence of intent
> to block, not just an engineering hurdle. This is a real ToS/breach-of-
> contract exposure, not only a "might get rate-limited" risk. The
> "Reliability" column below is an **unverified guess** (Woolworths is the
> only one actually exercised in code so far) — treat Coles/Aldi entries as
> hypotheses to confirm during implementation, not settled facts. Anyone
> deploying this beyond a personal/hobby project should get a real legal
> read on scraping exposure before relying on it, and should keep the mock
> fallback as the permanent default it already is.

| Retailer       | Best access method                                              | Reliability | Notes |
|-----------------|-------------------------------------------------------------------|-------------|-------|
| **Woolworths**  | Internal search API: `POST /apis/ui/Search/products`             | Medium (only source actually tested) | Already implemented (`server/adapters/woolworths.js`). Free, unofficial, unauthenticated, but bot-protected (Akamai) and can rate-limit/block by IP. |
| **Coles**       | Internal API: `GET /api/products?searchTerm=` (Coles' Next.js site calls this) | Unverified — untested guess | No official API. Endpoint shape changes often; needs realistic browser headers, and **may** need a session cookie from loading the site first (unconfirmed — verify by inspecting the Network tab against a live search before building against it). |
| **Aldi**        | No public product-search API — Aldi Australia's site is mostly static/catalogue-based (weekly specials only have structured data) | Low | Regular grocery lines aren't priced online per-store the way Woolies/Coles are — Aldi's model is closer to weekly catalogue + in-store pricing. Realistic options: scrape the weekly "Super Savings"/catalogue PDF or catalogue page, or fall back to representative pricing (survey-based) since there is no live per-SKU price feed. |
| **Foodworks**   | No API, no consistent site-wide catalogue — Foodworks is a banner of independently-owned stores (Metcash-supplied) | Very low | Prices vary store-to-store even under the same banner. Not scrapable in any general sense. Realistic option: manual/crowdsourced spot pricing, or exclude Foodworks from live pricing and keep it mock-only/representative. |
| **Costco**      | No API; requires membership login to see prices; product catalogue behind auth | Very low | Costco AU's public site shows limited items without login (some appear in the public weekly specials/flyer page — no login needed for those). Scraping the members-only catalogue requires an authenticated session, which is against ToS and out of scope. Realistic option: manual spot-checks for a small warehouse-format subset of the basket, refreshed manually/periodically, clearly labelled as "membership store — manual pricing." |

**Alternative worth weighing before building more scrapers:** paid
third-party grocery-price data aggregators/APIs exist and carry much lower
legal risk than direct scraping, at a dollar cost. Not evaluated in this
draft — worth a spike (cost + coverage check) before sinking more time into
Coles/Aldi scrapers, especially if this project ever moves beyond a
personal/hobby deployment.

**Practical grouping**, from most to least automatable:

1. **Tier 1 — live adapters (already or soon possible):** Woolworths (done),
   Coles (same pattern as Woolworths, new adapter).
2. **Tier 2 — catalogue/promo scraping only:** Aldi (weekly specials, not a
   general price feed).
3. **Tier 3 — no scraping surface:** Foodworks, Costco — these need a manual
   or crowdsourced pricing workflow, not a scraper. They should be modeled
   as a **separate `source: 'manual'` price feed**, not forced into the
   scraper pattern.

### 1.1 Woolworths (implemented)

- Endpoint: `https://www.woolworths.com.au/apis/ui/Search/products`
- Method: `POST`, body `{ SearchTerm, PageSize, PageNumber, SortType }`
- Auth: none required, but needs a realistic `User-Agent`.
- Failure mode: 403/429 under load — the adapter already catches per-item
  errors and continues (see `server/adapters/woolworths.js`).
- Gate: `ENABLE_WOOLWORTHS=true` in `.env`.

### 1.2 Coles (to build)

> **Superseded by [`COLES_DISCOVERY.md`](COLES_DISCOVERY.md)** (probed live
> 2026-08-29). The `/api/products?searchTerm=` endpoint guessed at below does
> not exist; the real capture surface is Coles' Next.js SSR data route,
> `/_next/data/<buildId>/en/browse/<slug>.json`. Read that document before
> building anything against the notes in this section.

- Endpoint pattern: Coles' site is a Next.js app; product search goes
  through `https://www.coles.com.au/api/...` (exact path changes — inspect
  Network tab against a live search before hard-coding it, and keep the same
  "graceful degradation" try/catch-per-item pattern as Woolworths).
- Some Coles endpoints reject requests without a valid session cookie
  (obtained by first `GET`-ing the site). Budget for a two-step fetch:
  warm-up request → search request.
- Gate behind a new `ENABLE_COLES=true` flag, following the exact
  `collectWoolworths()` pattern (`collectColes()` returning
  `{ itemId, storeId: 'coles', price, source: 'coles', collectedAt }[]`).

### 1.3 Aldi (partial automation)

- No general per-SKU price API. What *is* scrapable: the weekly "Super
  Savings" catalogue pages / PDFs, which cover promotional lines only — not
  the full basket.
- Recommended approach: keep Aldi on **modelled pricing**
  (`STORE_FACTOR.aldi` in `mockPrices.js`, already ~14% below Woolworths/Coles,
  matching real-world positioning) rather than pretending to have a live
  feed. If/when a promo item overlaps the basket, a small `aldi-promo.js`
  adapter could override just those items with scraped catalogue prices,
  `source: 'aldi-promo'`.

### 1.4 Foodworks & Costco (manual/crowdsourced tier)

- Neither has a scrapable, general product-price API.
- Foodworks: independently owned/priced stores under one banner — even a
  scraper for one store wouldn't represent "Foodworks" as a chain.
- Costco: prices are behind a membership login; scraping an authenticated
  session violates Costco's terms of use and isn't something this project
  should do. Costco AU's public weekly specials/flyer page *does* list some
  items without login — worth checking as a small, legitimate, no-auth
  source for a handful of basket items, even though it won't cover the
  whole basket.

**Realism check on "manual pricing sheet":** a plan that depends on someone
manually visiting a store and recording prices on a schedule (e.g. monthly)
has no owner, no incentive to keep doing it, and no fallback for when it
lapses — the risk is stale data being served as if it were current, with
no signal to the user that it's gone stale. If this project can't commit
to an actual person + process for that upkeep, the honest options are:

1. **Don't claim "live" or "manually verified — recent" for these two at
   all.** Keep Foodworks/Costco on modelled/representative pricing (same
   `mockPrices.js`-style derived estimate used for Aldi today), and be
   explicit in the UI that these are estimates, not measurements.
2. **If real prices matter enough to collect them**, prefer a
   crowdsourcing mechanism (a simple submission form, moderated) over a
   single manual maintainer — it survives one person losing interest, and
   naturally produces a "last reported {date} by a shopper" freshness
   signal instead of an assumed-current one.
3. If a manual sheet is still used, treat every entry as **evidence**, not
   ground truth: include a required freshness/staleness cutoff (e.g. if
   `collected_at` is older than 60 days, stop serving it / show a "no
   recent data" state instead of a silently-stale price), and ideally a
   `note`/photo-reference field for auditability — not just price + date.

If a manual/crowdsourced file is still used as the mechanism, its shape
stays as below, but gated by the freshness rule above:
`server/data/manual-prices.json`, loaded by a `manualPrices.js` "adapter"
the same way the other adapters are loaded, tagged `source: 'manual'` (or
`source: 'crowdsourced'` if that mechanism is used instead). The UI shows a
"last verified {date}" note, same way `collectedAt` is already shown, and
must hide/flag entries past the staleness cutoff rather than showing them
as if current.

### 1.5 Fresh produce / market prices

For "market" (fresh fruit & veg pricing outside the big chains), there are
actual public data sources, unlike the independents above:

- **ABS Food CPI (catalogue 6401.0)** — official government price index,
  **wired (Sep 17 2026)**: `npm run fetch-abs` pulls dataflow `ABS,CPI,2.0.0`
  from `https://data.api.abs.gov.au/rest/data/ABS,CPI,2.0.0/1.<codes>.10.50.Q`
  (index numbers · original · Australia · quarterly, SDMX-JSON, no key,
  CC BY 4.0) into `data/abs/cpi_food.json`, re-based from ABS's Sep 2025 = 100
  to 2014 = 100. Good for **historical trend**, not item-level "today's price."
- **Sydney Markets / Melbourne Market (wholesale) price reports** — both
  publish daily/weekly wholesale fruit & veg price sheets (PDF/table) for
  the wholesale trade. These are wholesale, not retail, prices — useful as
  a *proxy* for the "Market" store category (farmers' markets and grocers
  buy from these wholesale markets), but need a markup factor to look like
  a retail/market-stall price, not a wholesale one.
- **AUSVEG** (vegetable growers' industry body) publishes periodic vegetable
  price/market reports — good secondary source, lower frequency.
- **State government open-data portals** (e.g. data.nsw.gov.au,
  data.vic.gov.au) occasionally carry food-price or market datasets —
  worth a one-off search per state rather than relying on one source.
- **Hort Innovation** and **Freshlogic** publish horticulture/fresh-produce
  market reports (industry-funded, vegetable-levy-backed) — another
  secondary source alongside AUSVEG, generally lower frequency than
  wholesale market sheets.
- **The cheapest, already-working option: reuse the live Woolworths/Coles
  adapters' own produce lines.** Both retailers' basket items already
  include fresh vegetables (`brandTier: 'fresh'`), and once a Coles adapter
  exists, both chains are already returning real fresh-produce prices with
  zero extra scraping work. A wholesale-market pipeline is genuinely useful
  as an *independent* cross-check / non-chain proxy for "Market" pricing,
  but it shouldn't block on being the *only* produce source — blending in
  the chains' own fresh prices is a much smaller lift and should happen
  first.
- **Crowdsourced pricing** — a lightweight in-app "report a price you saw"
  form (or an existing community price-tracking app/dataset, if one with an
  open API can be found) is a real alternative to the wholesale+markup
  guess for market/farmers'-market pricing, and doubles as a way to fill
  Foodworks/Costco gaps too (see §1.4 rethink below).
- **Caveat on ABS CPI:** it's an *index* (relative % change), not an
  absolute dollar figure, so it can't by itself answer "what does today's
  market price look like" — it only anchors trend/history, not the current
  per-item price. Any "Market" absolute price still has to come from one of
  the other sources above.

Recommended approach: **first**, blend in the fresh-produce prices already
returned by the Woolworths/Coles adapters as the base for "Market" pricing;
**second**, treat wholesale-market data as an independent enrichment/cross-
check, refreshed manually or via a simple scheduled script that parses the
wholesale PDF/table, tagged `source: 'market-wholesale'`; **third**,
consider a crowdsourced submission form as a longer-term, more scalable
alternative to both.

---

## 2. Collection architecture (how data actually gets fetched)

Keep the existing pattern in `server/store.js` — it already implements
graceful degradation and is the right shape to extend:

1. **`mockPrices()`** always runs first — guarantees full basket×store
   coverage even if every live source fails. Keep this as the permanent
   safety net, not just a dev convenience.
2. **Each retailer gets its own adapter module** in `server/adapters/`,
   one async function returning `{ itemId, storeId, price, source,
   collectedAt }[]`, each independently try/caught so one retailer's
   failure never blocks another's.
3. **Each adapter is gated by its own `ENABLE_*` flag** in `.env` — lets
   you turn sources on/off independently (e.g. run Woolworths live daily,
   but only refresh Aldi/manual monthly).
4. **`store.collect()` merges** all rows onto the mock baseline by
   `itemId:storeId` key — live/manual data overrides mock, mock fills every
   gap. No change needed to this merge logic; it already generalizes to N
   adapters, not just one.
5. **Scheduling**: today it's a naive 24h `setInterval` in `server/index.js`.
   Different sources need different cadences (Woolworths: could run
   several times a day; manual/Costco/Foodworks: monthly at most). Recommend
   moving to **per-adapter cadences** — either separate intervals per
   adapter, or (better, once there's a real deployment target) an external
   cron / scheduled job per source instead of in-process timers, so a
   server restart doesn't silently reset the schedule.

### 2.1 Scraper health / anomaly detection (gap found in second review round)

Scrapers fail silently in a specific dangerous way: not by erroring, but by
successfully returning a *wrong* number when a retailer changes their page
(e.g. a redesign returns `$0.00`, a "from $X" range price, or a completely
unrelated product's price). The existing try/catch-per-item pattern only
catches hard failures (network error, non-2xx), not this kind of garbage
success. Before treating any live adapter as trustworthy, add a basic
sanity check in `store.collect()`'s merge step:

- **Bounds check**: reject a scraped price that's `<$0.10` or more than,
  say, `5x` the item's `base` mock price (or `>50%` different from that
  item/store's own price in the previous run) — log it into
  `collection_runs.errors` as an anomaly and fall back to the previous
  known-good price (or mock) for that item, rather than writing the
  suspicious value.
- **Run-over-run delta alerting**: if a whole adapter's run produces zero
  valid rows, or its bounds-check rejection rate spikes (e.g. >30% of
  items rejected in one run), that's a strong signal the retailer changed
  their page/endpoint — worth a log line loud enough to notice (this repo
  has no alerting infra yet, so "loud log line" is the realistic bar, not
  a paging system).

This is cheap to add and prevents the single worst failure mode of any
scraper-based pipeline: silently serving wrong prices as if they were real.

### 2.2 Rate limiting & ToS considerations

- Woolworths/Coles endpoints are undocumented and can rate-limit or block —
  keep request volume low (one request per basket item per run, once or a
  few times a day, not per-user-request), use a realistic `User-Agent`, and
  treat failures as expected/non-fatal (already the pattern).
- Do not attempt to bypass bot protection (CAPTCHA solving, IP rotation to
  evade blocks) — if a source starts hard-blocking, fall back to
  mock/manual for that source rather than working around the block.
- Costco specifically requires an authenticated membership session to see
  prices — do not scrape behind login; use manual entry only.

---

## 3. Storage format — how collected data is saved for the app

### 3.1 Current state (baseline, no change needed for "today's prices")

`server/store.js` holds `prices` as an **in-memory array**, shape:
```js
{ itemId, storeId, price, source, collectedAt }
```
This is fine for **current/latest** prices — no schema change needed here,
just more adapters feeding it (Coles, manual, market-wholesale) alongside
Woolworths and mock.

### 3.2 What's missing: persistence + history

Two gaps the current in-memory design doesn't cover, both needed once real
adapters are added:

1. **Restart durability** — currently all collected data is lost on server
   restart (re-seeded from mock). Once live/manual data has real value,
   losing it on every deploy/restart isn't acceptable.
2. **Time-series history** — `history.js` is a hand-authored mock series.
   Real collection runs should build actual history over time (this
   week's real Woolworths price vs. last month's), not just overwrite a
   single "current price" snapshot.

**Proposed storage: SQLite file, via a thin persistence layer.**

Why SQLite over alternatives:
- No new infrastructure to run (unlike Postgres) — fits this project's
  "plug-and-play, no config" philosophy from the README.
- Handles time-series `price_history` rows fine at this scale (a few
  hundred basket-item × store combinations × daily rows is tiny).
- Easy migration path to Postgres later if the app ever needs multi-instance
  deployment (SQLite is single-writer, fine for this app's current traffic).

Proposed schema:
```sql
CREATE TABLE prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  price REAL NOT NULL,
  source TEXT NOT NULL,          -- 'mock' | 'woolworths' | 'coles' | 'aldi-promo' | 'manual' | 'crowdsourced' | 'market-wholesale'
  collected_at TEXT NOT NULL,    -- ISO 8601, always UTC (see note below)
  run_id INTEGER NOT NULL,       -- FK -> collection_runs.id, so every row traces to the run that produced it
  UNIQUE (item_id, store_id, source, run_id)  -- idempotency guard keyed on run_id, NOT collected_at:
                                               -- collected_at is set once per collection run (all rows
                                               -- in a run share started_at), so it is NOT guaranteed
                                               -- unique per reading and must never be the uniqueness key
                                               -- (two runs could share a timestamp on retry/overlap,
                                               -- which would make INSERT OR IGNORE silently drop a
                                               -- legitimate row rather than erroring). run_id is
                                               -- guaranteed unique per attempt, so key on that instead.
);
CREATE INDEX idx_prices_latest ON prices(item_id, store_id, collected_at DESC);

CREATE TABLE collection_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  sources TEXT,                -- JSON array of sources attempted this run
  row_count INTEGER,
  errors TEXT                  -- JSON array of { source, itemId, error } — per-item/per-source
                                -- failures, not just per-run; an adapter that 403s partway through
                                -- still writes the rows it got before failing, plus an error entry
                                -- per item it couldn't fetch (mirrors the try/catch-per-item pattern
                                -- already used in woolworths.js — no new failure model needed)
);
```

Notes on gaps from the first review pass:
- **Idempotency**: the `UNIQUE` constraint above (plus an `INSERT OR IGNORE`
  / upsert on write) stops a concurrent or retried `collect()` from writing
  duplicate rows for the same reading.
- **Concurrent collect() runs**: `store.collect()` should hold a simple
  in-process lock (a boolean flag is enough) so a second `POST /api/collect`
  firing while one is already in flight, within the *same process*, is
  rejected or queued rather than racing writes. **This only protects a
  single process** — it does nothing against two processes (e.g. a rolling
  restart briefly running old+new instances, or any future multi-instance
  deployment) racing each other. If/when this app runs as more than one
  process, replace the in-memory flag with a DB-level guard instead (e.g.
  an `in_progress` row in `collection_runs`, or a SQLite advisory lock
  pattern) — don't assume the in-process flag scales past a single
  instance.
- **Latest-price query**: `/api/prices` must use an explicit "latest per
  group" query (e.g. `MAX(collected_at)` per `(item_id, store_id)`, or a
  window function `ROW_NUMBER() OVER (PARTITION BY item_id, store_id ORDER
  BY collected_at DESC)`), backed by `idx_prices_latest` — not a naive
  full-table scan. Call this out explicitly so whoever implements it
  doesn't reach for the slow version.
- **Timezone**: `collected_at` is always stored as **UTC** ISO 8601
  (`Z` suffix), full stop — any "today"/date-bucketed history queries
  convert to `Australia/Sydney` (or the relevant AU timezone) only at the
  display/aggregation layer, never in storage, to avoid off-by-one-day
  bugs across DST boundaries.
- **Concurrent reads during writes**: enable **SQLite WAL mode**
  (`PRAGMA journal_mode=WAL`) so `/api/prices` reads aren't blocked by an
  in-progress `collect()` write.
- **Retention**: unbounded row growth is fine for a long while at this
  app's scale (a few hundred item×store combos × a handful of runs/day),
  but isn't free forever. Plan for a simple retention job later — e.g.
  after 12 months, collapse daily rows into a single monthly-average row
  per `(item_id, store_id)` — rather than assuming infinite retention is
  fine by default.
- **History endpoint transition rule**: don't hand-wave "blend real history
  with `history.js`." Concrete rule: `history.js` remains the response for
  any year where real collected data doesn't yet cover a full year for that
  category; once a category has ≥12 months of real collected rows, that
  category's `/api/history` response switches to real aggregated data for
  the covered years and keeps `history.js` values only for earlier years
  (so a chart never has a real-vs-mock discontinuity mid-series — the cut
  is at a year boundary, not year 2026's data suddenly appearing next to
  2025's mock number).

- `GET /api/prices` becomes: latest row per `(item_id, store_id)` — same
  response shape as today, so **no client change needed**.
- A new `GET /api/history/:categoryId` (or extend `/api/history`) can be
  backed by aggregating `prices` over time instead of (or blended with) the
  hard-coded `history.js` series, once enough real data has accumulated,
  per the transition rule above.
- Every `POST /api/collect` **inserts** new rows (never overwrites) —
  that's what turns "current price snapshots" into "price history" for
  free, with no separate history-writing code path.

### 3.3 Manual & market-wholesale data files

Keep these as simple version-controlled input files, not part of the live
scrape pipeline, and feed them into the same `prices` table via the same
adapter interface:
- `server/data/manual-prices.json` — Foodworks/Costco spot checks:
  `[{ itemId, storeId, price, collectedAt, note }]`, hand-edited or filled
  via a small form/script by whoever does the store visit.
- `server/data/market-wholesale.json` (or a small parser script) — Sydney/
  Melbourne Market wholesale price extracts + the markup formula used to
  turn them into an estimated retail "Market" price.

### 3.4 Ingestion contract for the app (summary)

Regardless of source, every adapter — live scraper, manual entry, or
wholesale-derived — must produce rows in exactly this shape before they
reach `store.js`:
```ts
{
  itemId: string       // matches BASKET[].id in server/data/basket.js
  storeId: string      // matches STORES[].id
  price: number         // AUD, 2dp
  source: string          // provenance tag, see sources list above
  collectedAt: string       // ISO 8601 timestamp, UTC, shared by every row in one collection run
  confidence: 'measured' | 'estimated'   // NEW — see below
}
```
This is already the contract `mockPrices.js` and `woolworths.js` follow —
every new source (Coles, manual, market-wholesale) just needs to conform to
it, and `store.collect()`'s merge logic and the `/api/prices` /
`/api/collect` endpoints need no changes at all beyond adding this field.

**`confidence` field (gap found in second review round):** the plain
`source` string alone doesn't tell a client whether a price was actually
scraped from the retailer right now (`woolworths`, `coles` →
`'measured'`) versus derived/modelled (`mock`, `aldi-promo` markup,
`market-wholesale` markup, `manual`/`crowdsourced` entries →
`'estimated'`). Without this, the UI has no principled way to show users
which prices are real measurements and which are estimates — it would
otherwise present mock and scraped prices identically in the same table,
which is the same "silent staleness" risk already flagged for the manual
tier (§1.4), just applying to *all* non-live sources, not only Foodworks/
Costco. The client should visually distinguish `'estimated'` prices (e.g.
a small "est." badge) rather than rendering everything as if it were
today's shelf price. This is a UI change, not just a data change — flag it
to whoever builds the price-comparison table.

---

## 4. Rollout order (suggested)

1. **SQLite persistence layer under `store.js` first** — moved ahead of new
   adapters (was step 2 in the original draft). Building more live sources
   on top of the current in-memory store means real, hard-won Woolworths
   data is still thrown away on every restart during the highest-value
   collection period. Persistence should land before there's more data
   worth losing.
2. Coles live adapter (same pattern as Woolworths — highest-value,
   most-automatable remaining source; endpoint still needs verifying, see
   §1.2/§1 legal note).
3. Blend Woolworths/Coles fresh-produce lines into "Market" pricing (cheap,
   no new scraping — see §1.5) as the first real (non-mock) source for
   vegetable prices, ahead of building a wholesale-market pipeline.
4. Market-wholesale parser as an independent cross-check/enrichment for
   "Market" pricing (see §1.5), not the sole source.
5. Foodworks/Costco: decide up front between "keep modelled/representative"
   vs. "build a crowdsourced submission flow" (§1.4) — don't default into
   an unowned manual-sheet process.
6. Aldi promo-catalogue adapter (lowest priority — partial coverage only).

**Also worth a spike before step 2:** evaluate paid third-party
grocery-price data aggregators as a lower-legal-risk alternative to direct
Coles/Aldi scraping (see §1 note) — cost and coverage unknown, but the
comparison should happen before more scraper time is sunk in.

---

## 5. Revision log

- **v1** — initial pass, before agent feedback rounds.
- **v2** (this revision) — incorporated round-1 agent review:
  - Added explicit legal/ToS risk callout for all retailer scraping, and
    downgraded Coles/Aldi "Reliability" ratings from confident-sounding
    guesses to labeled hypotheses.
  - Added SQLite schema fixes: idempotency `UNIQUE` constraint + `run_id`
    FK, WAL mode note, explicit latest-price query guidance, UTC timezone
    rule, retention plan, concurrent-collect() locking, and a concrete
    mock→real history transition rule (year-boundary cutover, not a blend).
  - Reworked the Foodworks/Costco "manual pricing" tier — called out that
    an unowned manual process will silently go stale, added a staleness
    cutoff requirement, and proposed crowdsourcing as a more sustainable
    alternative.
  - Added more market/produce data sources (Hort Innovation, Freshlogic,
    crowdsourcing) and — the most actionable change — reprioritized
    "blend in the chains' own fresh-produce prices" ahead of building a
    separate wholesale-market pipeline, since it's nearly free once a
    Coles adapter exists.
  - Reordered rollout: persistence now comes before new adapters, not
    after, so real collected data survives restarts sooner.
  - Flagged paid third-party price-data aggregators as an alternative
    worth spiking before investing more in direct scraping.
- **v3** (current) — incorporated round-2 agent review (an independent
  pass checking whether the v2 fixes actually hold up, not just re-flagging
  the same issues):
  - Fixed a real flaw in the idempotency constraint: re-keyed the `UNIQUE`
    constraint on `run_id` instead of `collected_at`, since `collected_at`
    is shared by every row in a run and is not a safe uniqueness key —
    the original v2 constraint could have silently dropped legitimate rows
    on a timestamp collision.
  - Called out that the in-process collection lock only protects a single
    process, and named the DB-level alternative needed if this app is ever
    deployed as more than one instance.
  - Added a `confidence: 'measured' | 'estimated'` field to the ingestion
    contract — the previous draft had no way for the client to distinguish
    a real scraped price from a modelled/derived one beyond string-matching
    `source`, which meant mock/estimated prices could render identically
    to real ones in the UI (the same silent-staleness risk already flagged
    for the manual tier in v2, but it turned out to apply more broadly).
  - Added §2.1, a scraper sanity-check / anomaly-detection section — bounds
    checking and run-over-run delta alerting to catch a scraper silently
    returning garbage prices after a retailer page change, which nothing
    in v1/v2 addressed.
  - Confirmed (did not need further changes): the year-boundary history
    transition rule, the retention plan, WAL mode, and the manual/
    crowdsourcing rework from v2 all held up under the second review pass.
