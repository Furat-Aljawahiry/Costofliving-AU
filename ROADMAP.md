# Cost of Living AU — Product Roadmap

**Status:** v2, written 2026-09-13. Supersedes v1 (2026-08-29).
**Companion docs:** [`docs/PRODUCT_IDEAS.md`](docs/PRODUCT_IDEAS.md) (feature
catalogue), [`docs/COMPETITIVE_POSITIONING.md`](docs/COMPETITIVE_POSITIONING.md)
(market + moat), [`ARCHITECTURE.md`](ARCHITECTURE.md) (**stale — predates the
observations API and the page rewrite; see §0**).

v1 said: *"you have built a serious data-capture system and a decent front end,
and between them sits a gap where the actual data supply should be."* Two weeks
on, most of that gap has been closed — Coles is crawled, the Lambdas are
deployed, the schedule was switched on today, and the UI only renders measured
numbers. What is left is (a) proving the pipeline runs **unattended**, (b) the
trust surface the design promises, and (c) the one algorithm every headline
feature is waiting on: matching a Woolworths SKU to the same Coles SKU.

---

## 0. Where the project actually is (verified 2026-09-13)

Everything below was checked against the code, the S3 bucket, CloudWatch and
the Terraform state — not against the docs, several of which are out of date.

### 0.1 Data pipeline

| Piece | State |
|---|---|
| Crawler (`infra/terraform/lambda/category_crawler`) | One codebase, Woolworths + Coles adapters, 67-column spec, cheapest-by-subcategory report, produce taxonomy. 98 Python tests pass. Audited; defects in `FIXES.md` fixed. |
| Deployed | Three Lambdas + S3 bucket + EventBridge, all via Terraform. All three functions redeployed **today 02:33 UTC**. |
| Schedule | `fruitveg` rule **ENABLED** (`cron(0 6,18 * * ? *)`, both retailers in one invocation). Target + invoke permission verified. **First unattended firing is 06:00 UTC today.** It has never fired on its own — every run in the archive so far was invoked by hand. |
| The 403 wall (v1's blocker) | **Standing, for both retailers.** Direct AWS egress: Woolworths 403 (Aug 28, re-probed Sep 17), Coles serves an interstitial instead of JSON (probed Sep 17). Every run in the archive since Aug 28 has gone through one AU residential exit per run (`egress: proxy`, `proxy_rotations: 0`). The earlier claim here that runs went direct came from mislabelled laptop manifests. Decision and evidence: `data/DATA_SUPPLY_DECISION.md`. |
| Archive in S3 | 23 runs, 28 Aug → 17 Sep, **one layout** (`dt=…/<run_id>.csv`) since the 17 Sep flatten. Aug 28 and both Sep 4 Woolworths runs are `partial` in their own manifests and have no `_SUCCESS`; that is the note. Scheduled runs 13–16 Sep: 8/8 fired. |
| Archive on disk (`data/out`) | The server mirrors S3 into `data/out/s3/` itself (`aws s3 sync --delete`) at boot, on `/api/reload` and hourly when `DATA_BUCKET` is set; 1,047 products, 9,980 observations, 22 runs after collapsing the Sep 4 double. Top-level `data/out/*` is the committed dev fallback (`npm run pull-reports`). |
| Cross-retailer matching | **Does not exist.** `canonical_product_key` matches **0** rows between the two retailers (word order + `variety` differ). Flagged in `FIXES.md` as "the finding most worth acting on next". Still true. |
| Basket matching | `basket_item_id` is empty in every row. The 34-item basket is not linked to any SKU. |
| Persistence | S3 is the archive (append-only, manifested, `_SUCCESS`-gated). The Express server is a read-only in-memory index over CSVs. At ~1 MB/run this is fine for a year or more; v1's "add SQLite" is no longer the priority. |

### 0.2 Application

| Piece | State |
|---|---|
| API (`server/`) | 13 endpoints. **5 are measured** (`/status`, `/search`, `/products/:retailer/:sku`, `/cheapest`, `/reload`). The rest (`/prices`, `/history`, `/basket`, `/collect`, `store.js`, both adapters) are the original mock scaffolding — still served, no longer rendered. The live Woolworths Express adapter is dead code. |
| Client (`client/`) | Hash router (`#/`, `#/category/:id`, `#/product/:retailer/:sku`). One Figma-derived design system (v1's two-theme clash is fixed). Working: masthead search, home hero ticket + "Cheapest today" wall, capture-status line, category list for Fruit & Veg (filter/sort), product page with real price-history chart, provenance line, MEASURED badge, cheaper like-for-like list. |
| Honesty rule | Enforced. Every number on screen came from a CSV; everything else is a hatched `NotWired` block naming the data it needs. Today that is **most of the home page**: basket receipt, basket-vs-ABS chart, YoY on all six tiles, "cheapest at", all three findings cards, the trust strip, and every nav link. |
| Mobile | No. Home bento rows are fixed-pixel heights and spans. |
| Tests | None on the app (client or server). |
| Hosting | None. Runs on `localhost` only. |
| Version control | **None. Neither this folder nor its parent is a git repository.** |
| Docs | `README.md` still leads with "works immediately with realistic mock prices"; `ARCHITECTURE.md` (Aug 24) predates everything in §0.2. |

### 0.3 What v1 asked for, and what happened

| v1 item | Outcome |
|---|---|
| 0.1 Real ABS history | Done Sep 17 (P1.2). |
| 0.2 Persistence | Solved differently — S3 archive + manifests. Local sync still manual. |
| 0.3 Loud failure in the Express adapter | Moot — the adapter should be deleted, not fixed. |
| 0.4 Data-supply decision | **Written (Sep 17): `data/DATA_SUPPLY_DECISION.md`.** Direct AWS egress does not work for either retailer; the proxy has been the path since Aug 28. Principle #6 amended to match. |
| 0.5 `confidence` end-to-end | Done on the product page; the API carries it everywhere. |
| 1.1–1.3 Methodology / quality dashboard / staleness | Not done. The trust strip links to them and is dead. |
| 1.4 Provenance on every number | Done (product page). |
| 1.5 Tests on view-model builders | Not done. |
| 2.1 Routing | Done (hash-based; path-based + SSR still needed for SEO). |
| 2.2 One design system | Done. |
| 2.3 Mobile | Not done. |
| 2.4 Search | Done. |
| 2.5 Item detail pages | Done. |
| 2.6 Accessibility | Not done. |
| Phase 3 differentiators | Not started; all blocked on matching or on archive depth. |
| Phase 5 "Coles source" | Done two phases early. |

---

## 1. Principles (unchanged from v1, one amendment)

1. Never show an estimate as a measurement. *(Now enforced by `NotWired`.)*
2. Loud failure over quiet wrongness.
3. Capture, don't choose — keep every column of every SKU.
4. The archive is the product. **Amendment:** the archive only compounds while
   the schedule fires unattended. Until that is proven, nothing else counts.
5. Publish the method.
6. Stay on the right side of the line. **Amended Sep 17** (full text and
   reasoning in `data/DATA_SUPPLY_DECISION.md` §4): one Australian residential
   exit per run, presenting as one shopper browsing one category at a polite
   rate; no CAPTCHA solving, no scraping behind a login, no keyword search, no
   pool of exits paging in parallel. If a retailer blocks the residential exit
   too, stop that retailer and pursue an agreement or the ACCC-recommended
   API — do not rotate through more addresses. Direct AWS egress is blocked by
   both retailers and the proxy has been the live path since Aug 28.

---

## 2. Priorities

Four tiers. P0 is days, P1 is weeks, P2 is the next month or two, P3 is after
that. Within a tier, items are ordered.

### P0 — Prove the clock is running (this week)

The moat is "days of history a competitor cannot backfill". Day count is zero
until a run lands without a human. Everything here is about making tonight's
06:00 UTC run, and every run after it, land and be noticed if it doesn't.

| # | Work | Why first |
|---|---|---|
| **0.1** | ~~`git init`, commit, push~~ **Done.** Repo on GitHub, `main` in sync; tfstate never tracked; `.terraform/`, `*.tfvars`, `__pycache__/`, `*.zip`, `data/out/s3/` ignored (the `.pyc`s and the Lambda zip were untracked 17 Sep). | — |
| **0.2** | ~~Watch the runs~~ **Done.** 8/8 scheduled firings 13–16 Sep. Coles 8/8 `_SUCCESS`; Woolworths 4/8 — the evening runs, see 0.3. | — |
| **0.3** | ~~Make Woolworths earn `_SUCCESS`~~ **Fixed 17 Sep, awaiting the 18:00 UTC run.** Cause: sponsored tiles take page slots, so the organic tail spills past `ceil(total / 36)`; every evening run (112–120 sponsored vs 60–70 mornings) stopped 5–8 rows short. `crawler.py` now keeps paging while pages yield new products, bounded at 4 extra (`paging_test.py`). A full proxied run on the new code: 472/472, complete. | The evening run is the proof; check `dt=2026-09-17/*180037*._SUCCESS` for Woolworths. |
| **0.4** | ~~No-data alarm → email~~ **Done 17 Sep** (`infra/terraform/alerting.tf`). SNS topic `costofliving-au-alerts` → furat.jawahiry@gmail.com (**confirm the subscription email**). Every alarm now has it as an action — the three `-errors` ones had none. New: `fruitveg-no-data-24h` (`Invocations < 1`, missing data breaches — CloudWatch caps a single window at 24 h, not 36) and `fruitveg-partial-runs` (metric filter on `crawl.partial`), plus the two drift alarms from 0.7. | Test by disabling the rule for a day, per the done-when. |
| **0.5** | ~~Write the data-supply decision~~ **Done Sep 17: `data/DATA_SUPPLY_DECISION.md`.** The premise here was wrong — direct AWS egress has never worked from Lambda; the proxy has been live since Aug 28. Decision: keep one residential exit per run, principle #6 amended openly, ~US$12/month. Remaining from it: turn rotate-on-block off in `proxy.py` (a 403 ends the run), fix the `egress_country: "aws"` label on laptop runs, and give the three error alarms an action. | The code and the principles disagreed. Now the principle says what the code does, and the page says why. |
| **0.6** | ~~Automate the archive → server path~~ **Done 17 Sep.** With `DATA_BUCKET` in `.env`, `observations.js` runs `aws s3 sync` into `data/out/s3/` at boot, on `POST /api/reload` and every 60 min, then loads as before; `data/out` stays the dev fallback. Same-retailer runs starting within an hour collapse into one (the Sep 4 double). "Cheapest today" comes from the newest *complete* run per retailer. | The site now follows the schedule without a hand step. |
| **0.7** | ~~Pin down the 400-product Woolworths mornings~~ **Done 17 Sep.** The browse request carries no location; Woolworths resolves the store from the exit IP and the category *is* that store's range: 1101 → 472, 7008 → 400, 3221 → 516. The 400-run is not a subset — 99 SKUs absent, 27 different ones present; the absent skew to value-add packs, organics, potatoes. Manifests now record `store_id`; `drift.py` compares count and store against the trailing complete runs; `WOOLWORTHS_EXPECTED_STORE_ID=1101`; alarm per retailer. | A run from another store is flagged, not silently appended. Series code (P2.3) must treat it as a gap. |
| **0.8** | ~~Flatten the archive~~ **Done 17 Sep.** `flatten_run_prefixes.py --apply` (after fixing its percent-encoded copy-source): 23 objects copied, verified, deleted. One layout from 28 Aug. The three no-`_SUCCESS` Woolworths runs say `partial` in their own manifests. | P2.3's series starts 28 Aug. |
| **0.9** | **Retire the standalone Lambdas and the test function** once `fruitveg` has a clean week. Not before: `woolworths-category` is the function the 17 Sep probes and smoke test ran on. | Three functions and six alarms for one pipeline is how the wrong one gets watched. |

**Done when:** three consecutive scheduled days have `_SUCCESS` for both retailers at both times of day (the 0.3 fix went live 17 Sep 01:20 UTC — count from the 17 Sep 18:00 run), the alarm email is confirmed and the no-data alarm has been tested by disabling the rule for a day. Everything else in P0 is done as of 17 Sep.

### P1 — Make the home page true (next 2–3 weeks)

Light up the `NotWired` blocks that need **no new data**, delete the mock
layer, and make the trust strip's promises real. This is v1's Phase 1 plus the
leftovers of Phase 2, re-ordered by what is cheapest per unit of credibility.

| # | Work | Unblocks |
|---|---|---|
| **1.1** | **Delete the mock layer.** Remove `store.js`, `adapters/`, `/api/prices`, `/api/collect`, the mock `HISTORY`; keep `basket.js` (the basket definition is real, its prices were not). Rewrite `README.md` around the observations API. Retire or rewrite `ARCHITECTURE.md`. | Removes the last place a made-up number could leak from, and the README no longer contradicts the site. |
| **1.2** | ~~Real ABS Food CPI~~ **Done Sep 17.** `npm run fetch-abs` (`server/scripts/fetch-abs.mjs`) pulls dataflow `ABS,CPI,2.0.0` — Food & non-alcoholic beverages plus Fruit & veg, Meat & seafoods, Snacks & confectionery, Food products n.e.c., Milk, Bread, Eggs, Coffee/tea/cocoa (and their Dairy / Bread & cereal parents) — quarterly 2014-Q1 → 2026-Q2, re-based 2014 = 100, into the committed `data/abs/cpi_food.json`; `/api/history` serves it with a per-aisle mapping that says how honest the match is (`exact` / `shared` / `nearest` / `components`). Monthly was checked and skipped: sub-groups only run from 2017-09. **ABS is the backstory; our own captures take over from 28 Aug 2026** — the chart draws that handover, so the ABS pull is effectively one-off. | Home: white ABS line in the dark band, "ABS food CPI says +x.x%" on the receipt, `ABS ±x.x% YoY` chips on all six tiles. Category pages: YoY stat + 2014→today chart for every aisle with the match tag shown. The basket line stays `NotWired` until 2.2. |
| **1.3** | **Data-quality page** (`#/data`). Everything it needs is already in `/api/status`: last run per retailer, status, rows written vs reported, warnings count, egress, store id, run history. Wire the "Data quality →" trust link and the masthead. | Public proof the pipeline runs. No competitor shows this. |
| **1.4** | **Methodology page** (`#/methodology`). Pure writing: what is captured, the 67-column contract in plain English, the cheapest-line selection rule verbatim from the manifest, the organic/prepared exclusion, what "measured" means, what is not captured (Aldi, in-store prices, other postcodes), and — verbatim in spirit from `data/DATA_SUPPLY_DECISION.md` §6 — that every run leaves from one Australian residential address because both retailers block cloud datacenters, and what happens if they block that too. Wire the nav and trust links. | Trust. Needed before any press or sharing. |
| **1.5** | **Staleness rule.** If `lastCapturedAt` is older than 48 h, every page shows a "no capture since …" banner and the hero ticket says so instead of "cheapest today". | The site now runs unattended; it must not present a week-old price as today's. |
| **1.6** | **Download the data.** Per-run CSV links straight from S3 (public-read on the `reports/` prefix or a signed-URL endpoint) plus a "latest" link. Licence statement (recommend CC BY 4.0). Wire the trust link. | v1's 4.3 at near-zero cost. Turns researchers into distribution. |
| **1.7** | **Tests.** Vitest on the pure functions carrying the analysis: `parseCsv`, `ingestProduct` dedupe, `getProduct` alternatives, `buildWall`, `buildView`, `formatUnit`, `pct`. A fixture of ~20 real rows. | Every later feature edits these functions. |
| **1.8** | **Mobile pass.** Replace the fixed-px bento (`BENTO_ROWS` heights/spans) with a responsive grid; card layout for category and search results under 600 px; hero ticket stacks. | Grocery price checking is a phone activity. |
| **1.9** | **Deploy.** Decide hosting and ship a public URL. Recommend the static path: a build step that writes the observation index, cheapest sets and per-product JSON to S3, client served by CloudFront; search runs client-side over a ~300 KB index (962 products; fine to ~10 k). No server to keep alive, no ops for a solo maintainer, and the data only changes twice a day anyway. Keep Express for local dev. If path-based routing is wanted for SEO (P3), do it in this step rather than twice. | Nothing exists outside `localhost`. |

**Done when:** a stranger can open the URL on a phone, see today's cheapest
potatoes, click through to why, read how it was measured, and download the
file it came from.

### P2 — Ship what the archive already supports (month 2–3)

| # | Work | Notes |
|---|---|---|
| **2.1** | **Cross-retailer product matching.** A real matcher in L2 (Python, run after each capture, or in the server at load): normalise names (token set, drop word order), fold `variety` into the token set, match on tokens + `is_organic` + `is_prepared` + size band. Emit a `match_group` per product with a confidence tier (`exact / strong / weak`) and *show* the tier. Start with produce, where the 951 products and ~90 canonical groups make it tractable and verifiable by eye. | **The single biggest unblock in the project.** Lights up "CHEAPEST AT" on every tile, the Coles-vs-Woolworths panel on every product page, and everything below. `FIXES.md` already named it the next thing to do. |
| **2.2** | **Basket matching.** Populate `basket_item_id` for the ~8 produce basket items via 2.1 (`basket.js` `keywords` are the seed), then the home receipt becomes real for those 8 with the other 26 explicitly "not crawled yet". Cost-of-basket-this-week is then one sum. | Home page receipt; first step to "your personal CPI". |
| **2.3** | **The Potato Index — cheapest-line daily series.** `/api/series/:group`: the cheapest unit price per canonical group per retailer per day, from every run in the archive (data exists from Aug 28). Sparkline on each "Cheapest today" cell; full chart on the category page in place of the 2014→today `NotWired` (label it honestly: "since 28 Aug 2026"). | v1's 3.3. Front-page material, and it gets better every day the schedule runs. |
| **2.4** | **Specials checker v0 ("was it ever that price?").** Query: for each `is_on_special` row, compare `was_price_aud` against the max price actually observed for that SKU in the prior N weeks. Build and test the query now; gate the page on archive depth (show "N of 12 weeks captured" until qualified — ~late Nov 2026 if the schedule holds). | v1's 3.2. Most press-worthy feature; cannot be rushed. |
| **2.5** | **Shrinkflation detector v0.** Diff `net_size_value` per SKU across runs; flag size ↓ with price flat/↑. Works today; will find little in produce. Ship as "watching N products, 0 findings" and let it earn its findings. | Real value arrives with 2.6. |
| **2.6** | **Second and third categories.** The Lambda is category-parametrised; add EventBridge targets for packaged aisles where shrinkflation and specials actually happen — recommend **Chocolate & confectionery** first (highest CPI mover, brand-heavy, sizes change), then **Snacks/biscuits**, then **Dairy/eggs/bread**. Scope first: `taxonomy.py` / `produce_lexicon.py` / `cheapest.py` are produce-specific; packaged goods need grouping by canonical *product* (brand + line + size) rather than by subcategory, and a `$/100g` basis. | Turns four of the six home tiles from "NO CRAWL YET" to measured, and gives 2.4/2.5 something to find. |
| **2.7** | **Accessibility.** Non-colour cue for "cheapest"; focus states; contrast check on the yellow ticket; alt text on product images. | v1's 2.6. Small, do it with 1.8 if convenient. |

**Done when:** every product page shows both retailers side by side with a
matching confidence, the home receipt has real prices, and there is a daily
series chart with more than 30 points on it.

### P3 — Distribution (after P2)

Unchanged from v1 in substance; re-ordered because P1.9 decides the platform.

1. **Path-based URLs + prerender/SSR** — `/price-of/potatoes`, one indexed page
   per canonical group. Requires the hosting decision in 1.9; hash routes are
   not indexable.
2. **Shareable OG cards** — auto-rendered "Potatoes: $X/kg, ↓Y% since Aug".
3. **Weekly digest email** — what moved in the basket. Needs 2.2.
4. **Public JSON API + licence page** — extends 1.6.
5. **Embeddable chart widget** for news sites.
6. **Multi-postcode capture** — metro vs regional. One extra Lambda target per
   postcode; the schema already carries `postcode`.
7. **Watchlists / alerts** — needs accounts; last.

---

## 3. Suggested next four weeks

| Week | Focus |
|---|---|
| **1** (this week) | P0: all done 17 Sep except 0.9 (deliberately after a clean week) and 0.3's proof (tonight's 18:00 UTC run). Confirm the alarm email. |
| **2** | 1.1 delete mocks + README · 1.2 ABS history · 1.5 staleness · 1.7 tests. |
| **3** | 1.3 data-quality page · 1.4 methodology · 1.6 downloads · 1.8 mobile. |
| **4** | 1.9 deploy publicly. Start 2.1 matching. |

By the end of week 4 the archive is ~4 weeks deep, the site is public and
honest, and the matcher — which everything in P2 waits on — is underway.

---

## 4. Things to delete or stop maintaining

- `server/store.js`, `server/adapters/*`, `/api/prices`, `/api/collect`, mock
  `HISTORY` (P1.1).
- The `test` Lambda from Aug 24, still in Terraform state.
- ~~`data/out/woolies/`~~ (deleted 17 Sep) — a duplicate of the Aug 28 run under a different name.
- `Product.jsx`'s Aldi / Market columns: keep the `NotWired` for Coles vs
  Woolworths, but two permanently hatched columns for retailers with no
  crawler planned add noise. Drop `market`; keep `aldi` only if a crawler is
  actually on the horizon.
- ~~`proxy.py`~~ — kept; it is the live egress path (`data/DATA_SUPPLY_DECISION.md`).
  What goes instead is its rotate-on-block behaviour (P0.5 follow-up).

---

## 5. Risks (updated)

| Risk | Status | Mitigation |
|---|---|---|
| Work lost — no version control | **Live, highest.** | P0.1 today. |
| Schedule fires but nobody notices it stop | **Occurred Sep 5–13.** Mitigated 17 Sep, pending email confirmation. | `fruitveg-no-data-24h` + SNS → email; every alarm has an action. |
| Woolworths never `complete` → never `_SUCCESS` | Evening runs only; fixed 17 Sep, unproven until 18:00 UTC. | P0.3; `fruitveg-partial-runs` alarm says if it recurs. |
| Retailer blocks the residential exit (AWS egress is already blocked by both) | Not currently; `proxy_rotations` is the early warning. | `DATA_SUPPLY_DECISION.md` §4: stop that retailer, don't rotate. ABS-only mode (P1.2) keeps the trend story alive. |
| Stale data shown as current | Live once unattended. | P1.5. |
| Matching quality — a wrong "same product" is a wrong headline | Future (P2.1). | Show the confidence tier; never present a `weak` match as a price comparison; hand-verify the produce groups. |
| Solo-maintainer lapse | Structural. | P0.6 and P1.9 remove every recurring manual step (sync, reload, server uptime). |
| Legal / ToS exposure | Unchanged from v1; the stance is now written (`DATA_SUPPLY_DECISION.md` §6). | Get a real read before public launch (P1.9); the methodology page (P1.4) carries §6 in its own words. |
| Building UI ahead of data | Largely avoided by `NotWired`. | Keep the rule: a block lights up only when its data exists. |
