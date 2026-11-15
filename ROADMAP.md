# Cost of Living AU — Product Roadmap

**Status:** v2.2, written 2026-09-13, **revised 2026-09-25** (§0 re-verified,
priorities re-scored). Supersedes v1 (2026-08-29).
**Companion docs:** [`docs/PRODUCT_IDEAS.md`](docs/PRODUCT_IDEAS.md) (feature
catalogue), [`docs/COMPETITIVE_POSITIONING.md`](docs/COMPETITIVE_POSITIONING.md)
(market + moat), [`ARCHITECTURE.md`](ARCHITECTURE.md) (**stale — predates the
observations API and the page rewrite; see §0**).

v1 said: *"you have built a serious data-capture system and a decent front end,
and between them sits a gap where the actual data supply should be."* Four weeks
on, that gap is closed: the schedule has fired unattended twice a day since
18 Sep, Coles lands clean every time, and the UI still renders nothing it did
not measure. Three things remain. (a) **Woolworths will not say `complete`** —
it now misses its own reported count by one to four rows, so it earns no
`_SUCCESS` and the archive's Woolworths side is formally `partial`. (b) The
**trust surface** the design promises — data-quality page, methodology,
staleness banner, downloads — is still hatched-out placeholders, and the site
is still `localhost`-only. (c) The **one algorithm** every headline feature
waits on: matching a Woolworths SKU to the same Coles SKU. P2.0 (21 Sep) built
the name parser that makes it tractable; the matcher itself is next.

---

## 0. Where the project actually is (re-verified 2026-09-25)

Everything below was checked against the code, the S3 bucket, CloudWatch and
the Terraform state — not against the docs, several of which are out of date.

### 0.0 What changed in the twelve days to 25 Sep

| | |
|---|---|
| **The clock is running** | Every scheduled firing 18–24 Sep landed. Coles: **27 runs, 27 `_SUCCESS`** — clean twice a day, no exceptions. Woolworths: 29 runs, 12 `_SUCCESS`. |
| **Woolworths is still `partial` — but by a hair** | P0.3's paging fix worked in kind, not in full. The evening shortfall went from 5–8 rows to **1–4**: 23 Sep 18:00 wrote 470 of 473 reported, 24 Sep 18:00 wrote 469 of 473. Since 23 Sep the *morning* runs miss too (472 of 473). So `_SUCCESS` stopped entirely on 23 Sep, and P0's three-clean-days test has **never been met**. This is now the oldest open item in the project. |
| **The drift alarm earned its keep** | 24 Sep 06:00: the exit IP resolved to **store 2631**, not the pinned 1101 — 452 products instead of 473. `store_changed: true, alarm: true`; the run was kept and flagged, not silently appended. P0.7 works as designed, and P2.3's series must read the flag. |
| **P1.2 shipped** (`2046e1d`) | Real ABS Food CPI end to end, the index chart, and a new full **Cheapest today** page (`#/cheapest`, `client/src/pages/Cheapest.jsx`). |
| **P2.0 shipped** (out of order, deliberately) | Same-retailer size grouping — `server/data/produceNames.js`, `/api/items`, real size tabs on the product page. It is the groundwork 2.1 needs; see P2.0. |
| **"Did you know?" facts** | `client/src/lib/facts/{compute,vegetables}.js` — aisle facts whose numbers are computed from the ABS series at render time, so they stay true after every `npm run fetch-abs`, with a `when(s)` guard that hides a fact which has stopped being true. The category page picks one per visit and unfolds the index chart with that fact's quarters shaded. The honesty rule is extended to prose: every fact carries `ABS CPI 6401.0` or `GENERAL` as its source tag. |
| **First tests exist** | `server/scripts/fetch-abs.test.mjs`, `server/data/produceNames.test.mjs`, run by `npm run test:server` (`node --test`). Not the view-model coverage P1.7 asks for, and still nothing on the client. |
| **Working tree committed** | 15 Nov: the whole 21 Sep → 15 Nov backlog is on `main` (`fdaee63`, 117 files) — meat/snacks/matching/season, `server/config.js` and the staleness rules, the client pages and facts, `lambda_{meat,snacks}.tf`, the 18–21 Oct captures and the review output. The tree is clean. |

### 0.1 Data pipeline

| Piece | State |
|---|---|
| Crawler (`infra/terraform/lambda/category_crawler`) | One codebase, Woolworths + Coles adapters, 67-column spec, cheapest-by-subcategory report, produce taxonomy. 98 Python tests pass. Audited; defects in `FIXES.md` fixed. |
| Deployed | Three Lambdas + S3 bucket + EventBridge, all via Terraform (last crawler deploy 17 Sep 02:33 UTC). |
| Schedule | `fruitveg` rule **ENABLED** (`cron(0 6,18 * * ? *)`, both retailers in one invocation). **Proven unattended: 18–24 Sep, 14/14 firings landed for both retailers.** No run invoked by hand since 17 Sep. |
| The 403 wall (v1's blocker) | **Standing, for both retailers.** Direct AWS egress: Woolworths 403 (Aug 28, re-probed Sep 17), Coles serves an interstitial instead of JSON (probed Sep 17). Every run in the archive since Aug 28 has gone through one AU residential exit per run (`egress: proxy`, `proxy_rotations: 0`). The earlier claim here that runs went direct came from mislabelled laptop manifests. Decision and evidence: `data/DATA_SUPPLY_DECISION.md`. |
| Archive in S3 | **56 runs, 28 Aug → 24 Sep** (Woolworths 29, Coles 27), one layout (`dt=…/<run_id>.csv`) since the 17 Sep flatten. `_SUCCESS`: Coles 27/27; Woolworths 12/29 — every evening run, and every morning run from 23 Sep, is `partial` by 1–4 rows (§0.0, P0.3). |
| Archive on disk (`data/out`) | The server mirrors S3 into `data/out/s3/` itself (`aws s3 sync --delete`, CSV + JSON only) at boot, on `POST /api/reload` and every `SYNC_INTERVAL_MIN` (60). **No longer conditional on `.env`:** `server/config.js` defaults `DATA_BUCKET` to the real bucket, and a failed boot sync exits rather than serving old files (that gate is why the site sat on 17 Sep data for eight days). By hand: `npm run sync-data`. Top-level `data/out/*` remains the committed dev fallback (`npm run pull-reports`, which now reads the same env vars). |
| Same-retailer size grouping | **Done 21 Sep (P2.0).** `produceNames.js` parses every name into `itemName` / `packFormat` / `portion` / `sizeGrade` / `itemKey`; 1,047 SKUs collapse to 930 items; `/api/items` serves them and the product page's size tabs are real. |
| Cross-retailer matching | **Still does not exist.** `canonical_product_key` matches **0** rows between the two retailers. Unchanged as the one blocker under every headline feature — but 2.0 laid its foundation (`itemKey`), so 2.1 is now a variety lexicon, not a rewrite. |
| Basket matching | `basket_item_id` is empty in every row. The 34-item basket is not linked to any SKU. |
| Persistence | S3 is the archive (append-only, manifested; `_SUCCESS` written only on `complete`, which Woolworths currently is not — so the loader treats it as a preference, not a filter, and falls back to the newest `partial`). The Express server is a read-only in-memory index over the CSVs, rebuilt whole on every sync; at ~1 MB/run that is fine for a year or more, so v1's "add SQLite" stays unnecessary. Freshness is now part of the model, not an assumption: `summary.stale` / `stalenessHours` off a 48 h threshold, surfaced on `/api/status` and as a 503 on `/api/health`. The read model has no consumer outside this process yet — that is P1.9's publish step (`DATA_SOURCE=serving`). |

### 0.2 Application

| Piece | State |
|---|---|
| API (`server/`) | 14 endpoints. **7 are measured** (`/status`, `/search`, `/products/:retailer/:sku`, `/items` (new), `/cheapest`, `/history` (real ABS since P1.2), `/reload`). The rest (`/prices`, `/basket`, `/collect`, `store.js`, both adapters) are the original mock scaffolding — still served, no longer rendered. The live Woolworths Express adapter is dead code. |
| Client (`client/`) | Hash router (`#/`, `#/cheapest`, `#/category/:id`, `#/product/:retailer/:sku`). One Figma-derived design system (v1's two-theme clash is fixed). Working: masthead search, home hero ticket + "Cheapest today" wall, the full Cheapest page, capture-status line, the Fruit & Veg category page (**one card per item with size chips**, ABS index chart, "Did you know?" fact), product page with price-history chart, real size tabs and SKU table, provenance line, MEASURED badge, cheaper like-for-like list. |
| Honesty rule | Enforced. Every number on screen came from a CSV; everything else is a hatched `NotWired` block naming the data it needs. Today that is **most of the home page**: basket receipt, basket-vs-ABS chart, YoY on all six tiles, "cheapest at", all three findings cards, the trust strip, and every nav link. |
| Mobile | No. Home bento rows are fixed-pixel heights and spans. |
| Tests | **Two server suites** (`npm run test:server`: `fetch-abs`, `produceNames`). Nothing on the client, nothing yet on the view-model builders P1.7 names. |
| Hosting | None. Runs on `localhost` only. |
| Version control | Git, `main` on GitHub (P0.1, 17 Sep). Working tree clean as of 15 Nov; the Kmart/Big W watcher lives on the `pokemon` branch, out of main. |
| Docs | `README.md` still leads with "works immediately with realistic mock prices"; `ARCHITECTURE.md` (Aug 24) predates everything in §0.2. |

### 0.3 What v1 asked for, and what happened

| v1 item | Outcome |
|---|---|
| 0.1 Real ABS history | Done Sep 17 (P1.2). |
| 0.2 Persistence | **Closed 25–26 Sep.** Solved differently from v1's "add SQLite": S3 is the archive, the Express server is a read-only in-memory index, and the local sync is no longer manual — `server/config.js` owns the bucket/prefix/region, the server syncs at boot / on `POST /api/reload` / every `SYNC_INTERVAL_MIN`, a failed boot sync is fatal, `DATA_SYNC=off` is the only way out, `npm run sync-data` is the by-hand refresh, and staleness is computed (`STALE_AFTER_HOURS=48`) and served on `/api/status` + `/api/health` (503). Tested: `server/config.test.mjs`, `server/data/observations.test.mjs` (26 cases) against a fixture archive. **Left:** the client still reads none of it (P1.5), and `dataSource()` (`DATA_SOURCE` = `raw` or `serving`) is a declared seam with no serving stage behind it (P1.9). |
| 0.3 Loud failure in the Express adapter | Moot — the adapter should be deleted, not fixed. |
| 0.4 Data-supply decision | **Written (Sep 17): `data/DATA_SUPPLY_DECISION.md`.** Direct AWS egress does not work for either retailer; the proxy has been the path since Aug 28. Principle #6 amended to match. |
| 0.5 `confidence` end-to-end | Done on the product page; the API carries it everywhere. |
| 1.1–1.3 Methodology / quality dashboard / staleness | Not done — still true 25 Sep. The trust strip links to them and is dead. |
| 1.4 Provenance on every number | Done (product page). |
| 1.5 Tests on view-model builders | Started — two server suites exist, but not on the view-model builders. |
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

### P0 — Prove the clock is running (**one item left, 25 Sep**)

The moat is "days of history a competitor cannot backfill". That clock is now
running: 14/14 unattended firings 18–24 Sep, Coles clean every time. What is
not settled is whether a Woolworths run can say `complete` — and until it can,
every Woolworths day in the archive carries an asterisk.

| # | Work | Why first |
|---|---|---|
| **0.1** | ~~`git init`, commit, push~~ **Done.** Repo on GitHub, `main` in sync; tfstate never tracked; `.terraform/`, `*.tfvars`, `__pycache__/`, `*.zip`, `data/out/s3/` ignored (the `.pyc`s and the Lambda zip were untracked 17 Sep). | — |
| **0.2** | ~~Watch the runs~~ **Done.** 8/8 scheduled firings 13–16 Sep. Coles 8/8 `_SUCCESS`; Woolworths 4/8 — the evening runs, see 0.3. | — |
| **0.3** | **Make Woolworths earn `_SUCCESS`. REOPENED — the only open P0 item, and now the oldest open item in the project.** The 17 Sep paging fix (keep paging while pages yield new products, bounded at 4 extra) shrank the shortfall but did not close it. Evidence: 23 Sep 18:00 → 470 written of 473 reported (15 pages, 120 sponsored, 112 duplicates dropped); 24 Sep 18:00 → 469 of 473; 23 Sep **06:00** → 472 of 473, so the mornings now miss too, and no Woolworths run has earned `_SUCCESS` since 22 Sep. Shape of the remaining bug: a handful of tiles are counted in `total_reported` but never written — the candidates are sponsored-duplicate drops being subtracted from the wrong total, the 4-extra-page bound biting at 15 pages, or `total_reported` counting tiles the parser rejects. **Next step:** run one proxied capture with per-page tile IDs logged and diff the written SKU set against the tiles seen — three rows is few enough to name individually. Then decide honestly: fix the writer, or (if the reported total is itself wrong) treat "written ≥ reported − n" as complete and say so in the manifest rather than papering over it. | Without this, "N days of complete history" is only true for Coles, and P2.3's series has a hole in one retailer on every single day. |
| **0.4** | ~~No-data alarm → email~~ **Done 17 Sep** (`infra/terraform/alerting.tf`). SNS topic `costofliving-au-alerts` → furat.jawahiry@gmail.com (**confirm the subscription email**). Every alarm now has it as an action — the three `-errors` ones had none. New: `fruitveg-no-data-24h` (`Invocations < 1`, missing data breaches — CloudWatch caps a single window at 24 h, not 36) and `fruitveg-partial-runs` (metric filter on `crawl.partial`), plus the two drift alarms from 0.7. | Test by disabling the rule for a day, per the done-when. |
| **0.5** | ~~Write the data-supply decision~~ **Done Sep 17: `data/DATA_SUPPLY_DECISION.md`.** The premise here was wrong — direct AWS egress has never worked from Lambda; the proxy has been live since Aug 28. Decision: keep one residential exit per run, principle #6 amended openly, ~US$12/month. Remaining from it: turn rotate-on-block off in `proxy.py` (a 403 ends the run), fix the `egress_country: "aws"` label on laptop runs, and give the three error alarms an action. | The code and the principles disagreed. Now the principle says what the code does, and the page says why. |
| **0.6** | ~~Automate the archive → server path~~ **Done 17 Sep; the automation itself failed silently 17–25 Sep, fixed 25 Sep.** `observations.js` runs `aws s3 sync` into `data/out/s3/` at boot, on `POST /api/reload` and every 60 min. The 17 Sep version gated that on `DATA_BUCKET` being set and defaulted it to `''` — no `.env` exists in a fresh checkout, so the sync was a no-op and the site served 17 Sep data until 25 Sep while the crawler kept running perfectly. Nothing said so: `/api/health` was an unconditional `{ok:true}` and `lastCapturedAt` read as a fact, not a fault. Now: `server/config.js` is the single source of the bucket/prefix/region (it was spelled in four places), `DATA_BUCKET` defaults to the real bucket, `DATA_SYNC=off` is the only way to opt out, a failed sync at boot is **fatal**, and `/api/status` carries `stale`/`stalenessHours` while `/api/health` 503s on stale or disabled. First tests for `observations.js` (26) landed with it. | The site follows the schedule without a hand step — and says so when it doesn't. The lesson: an automation whose failure mode is "quietly does nothing" is not done until something screams. |
| **0.7** | ~~Pin down the 400-product Woolworths mornings~~ **Done 17 Sep.** The browse request carries no location; Woolworths resolves the store from the exit IP and the category *is* that store's range: 1101 → 472, 7008 → 400, 3221 → 516. The 400-run is not a subset — 99 SKUs absent, 27 different ones present; the absent skew to value-add packs, organics, potatoes. Manifests now record `store_id`; `drift.py` compares count and store against the trailing complete runs; `WOOLWORTHS_EXPECTED_STORE_ID=1101`; alarm per retailer. | A run from another store is flagged, not silently appended. Series code (P2.3) must treat it as a gap. |
| **0.8** | ~~Flatten the archive~~ **Done 17 Sep.** `flatten_run_prefixes.py --apply` (after fixing its percent-encoded copy-source): 23 objects copied, verified, deleted. One layout from 28 Aug. The three no-`_SUCCESS` Woolworths runs say `partial` in their own manifests. | P2.3's series starts 28 Aug. |
| **0.9** | **Retire the standalone Lambdas and the test function.** The clean week has arrived for the *schedule* (18–24 Sep, 14/14) even though 0.3 is open, and 0.3 is debugged with a local dry run rather than the standalone function — so this is now unblocked. Do it in the same sitting as 0.3's diagnosis, once that run is done with. | Three functions and six alarms for one pipeline is how the wrong one gets watched. |

**Done when:** three consecutive scheduled days have `_SUCCESS` for both
retailers at both times of day. **Status 25 Sep: not met, and never yet met.**
Coles has run 27/27 clean; Woolworths' best streak was 18–22 Sep mornings only,
and it ended on 23 Sep. Still also outstanding from P0: confirm the alarm
subscription email, and test `fruitveg-no-data-24h` by disabling the rule for a
day. Everything else in P0 closed on 17 Sep.

### P1 — Make the home page true (**the current tier; 1.2 done, 8 items left**)

Light up the `NotWired` blocks that need **no new data**, delete the mock
layer, and make the trust strip's promises real. This is v1's Phase 1 plus the
leftovers of Phase 2, re-ordered by what is cheapest per unit of credibility.

| # | Work | Unblocks |
|---|---|---|
| **1.1** | **Delete the mock layer. Not started; `store.js` and `adapters/` are still on disk and `/api/prices` + `/api/collect` still respond.** Remove `store.js`, `adapters/`, `/api/prices`, `/api/collect`, the mock `HISTORY`; keep `basket.js` (the basket definition is real, its prices were not). Rewrite `README.md` around the observations API. Retire or rewrite `ARCHITECTURE.md`. | Removes the last place a made-up number could leak from, and the README no longer contradicts the site. |
| **1.2** | ~~Real ABS Food CPI~~ **Done Sep 17.** `npm run fetch-abs` (`server/scripts/fetch-abs.mjs`) pulls dataflow `ABS,CPI,2.0.0` — Food & non-alcoholic beverages plus Fruit & veg, Meat & seafoods, Snacks & confectionery, Food products n.e.c., Milk, Bread, Eggs, Coffee/tea/cocoa (and their Dairy / Bread & cereal parents) — quarterly 2014-Q1 → 2026-Q2, re-based 2014 = 100, into the committed `data/abs/cpi_food.json`; `/api/history` serves it with a per-aisle mapping that says how honest the match is (`exact` / `shared` / `nearest` / `components`). Monthly was checked and skipped: sub-groups only run from 2017-09. **ABS is the backstory; our own captures take over from 28 Aug 2026** — the chart draws that handover, so the ABS pull is effectively one-off. | Home: white ABS line in the dark band, "ABS food CPI says +x.x%" on the receipt, `ABS ±x.x% YoY` chips on all six tiles. Category pages: YoY stat + 2014→today chart for every aisle with the match tag shown. The basket line stays `NotWired` until 2.2. |
| **1.3** | **Data-quality page** (`#/data`). **Now the highest-value item in P1**, because there is finally something worth showing: 14/14 unattended firings, 56 runs, Coles 27/27 `_SUCCESS`, and — told plainly — Woolworths' 1–4-row shortfall and the 24 Sep store-2631 drift. Everything it needs is already in `/api/status`: last run per retailer, status, rows written vs reported, warnings count, egress, store id, run history. Wire the "Data quality →" trust link and the masthead. | Public proof the pipeline runs. No competitor shows this. |
| **1.4** | **Methodology page** (`#/methodology`). Pure writing: what is captured, the 67-column contract in plain English, the cheapest-line selection rule verbatim from the manifest, the organic/prepared exclusion, what "measured" means, what is not captured (Aldi, in-store prices, other postcodes), and — verbatim in spirit from `data/DATA_SUPPLY_DECISION.md` §6 — that every run leaves from one Australian residential address because both retailers block cloud datacenters, and what happens if they block that too. Wire the nav and trust links. | Trust. Needed before any press or sharing. |
| **1.5** | **Staleness rule — server half done 25 Sep, client half untouched.** `/api/status` already carries `stale`, `stalenessHours`, `lastCapturedAt` and `sync` (`ok` / `reason` / `at` / `ageHours`), `/api/health` 503s on stale-or-disabled, and the boot log warns. **Nothing in `client/src` reads any of it** — `grep -rn "stale" client/src` returns nothing, so a week-old price still renders as "cheapest today". What is left: a banner on every page when `stale` ("no capture since …"), the hero ticket saying so instead of "cheapest today", and the same treatment when `sync.reason !== 'ok'` — a mirror that stopped updating is the same lie as a crawler that stopped running. `status` is already passed into every page component, so this is one shared component and a conditional, not plumbing. | The site runs unattended and the server knows when it has gone quiet; only the screen still doesn't say. |
| **1.6** | **Download the data.** Per-run CSV links straight from S3 (public-read on the `reports/` prefix or a signed-URL endpoint) plus a "latest" link. Licence statement (recommend CC BY 4.0). Wire the trust link. | v1's 4.3 at near-zero cost. Turns researchers into distribution. |
| **1.7** | **Tests. Started (two server suites: `fetch-abs`, `produceNames`).** What remains is Vitest on the pure functions carrying the analysis: `parseCsv`, `ingestProduct` dedupe, `getProduct` alternatives, `buildWall`, `buildView`, `formatUnit`, `pct`. A fixture of ~20 real rows. | Every later feature edits these functions. |
| **1.8** | **Mobile pass.** Replace the fixed-px bento (`BENTO_ROWS` heights/spans) with a responsive grid; card layout for category and search results under 600 px; hero ticket stacks. | Grocery price checking is a phone activity. |
| **1.9** | **Deploy.** Decide hosting and ship a public URL. Recommend the static path: a build step that writes the observation index, cheapest sets and per-product JSON to S3, client served by CloudFront; search runs client-side over a ~300 KB index (962 products; fine to ~10 k). No server to keep alive, no ops for a solo maintainer, and the data only changes twice a day anyway. Keep Express for local dev. The seam is already cut: `config.dataSource()` reads `DATA_SOURCE` = `raw` or `serving`, and nothing implements `serving` yet — this step is what fills it, so the publish job and the local server build the same index from the same code. If path-based routing is wanted for SEO (P3), do it in this step rather than twice. | Nothing exists outside `localhost`. |

**Done when:** a stranger can open the URL on a phone, see today's cheapest
potatoes, click through to why, read how it was measured, and download the
file it came from.

### P2 — Ship what the archive already supports (month 2–3)

| # | Work | Notes |
|---|---|---|
| **2.0** | ~~Same-retailer size grouping~~ **Done 21 Sep.** `server/data/produceNames.js` pulls every product name apart at load into `itemName` / `packFormat` (bag, punnet, bunch, loose, multipack…) / `portion` (half, quarter) / `sizeGrade` (medium, large) / a rescued weight (`Royal Gala Apples 1kg` whose size field said `1 each`), and an `itemKey` (sorted singular tokens, brand and pack words out). Same retailer + same key + same organic flag = one item in several sizes: 1,047 SKUs → 930 items. `/api/items` feeds the category grid (one card per item, size chips switch the price); the product page's size tabs, pack-size bars and SKU table are real. The measurement slot now carries what used to pollute the name (`2kg bag`, `250g punnet`, `bunch`, `each · half`). Tuning tool: `node server/scripts/produce-names-report.mjs`. Known gaps: Woolworths' `Variety` column is junk (`Lady Apples`, `Punnet`) and is ignored; the retailer's own bucket errors (`Potato & Egg Bacon` under FRUIT) are untouched. | The name normalisation 2.1 needs, verified by eye within one retailer first. |
| **2.1** | ~~**Cross-retailer product matching.**~~ **Done 26 Sep.** `match_key = group:variety[:organic][:imperfect]`, derived at load in `server/data/matching/` (L2, so a lexicon change replays the whole archive on reload). Group comes from the Lambda's own verdicts, read back out of the cheapest file as a `sap_subcategory -> (canonical_group, group_kind)` table — 87.5% of W rows, 85.0% of C — with a head-noun fallback in `groups.js` for the ~13% whose subcategory names a department (`ORGANICS`, `VEGETABLES`). Variety is a hand-maintained lexicon (`varieties.js`), most-identifying-first, reading name **and** brand (W keeps the cultivar in `brand`). Confidence is a **permission, not a label**: only `exact` may show a price comparison, and `comparable` is decided server-side so the client cannot re-derive it. Guards that earned their place: per-each comparisons require matching `multipack`/`sizeGrade`/`portion` (without this the flagship Pink Lady page compared a 6-pack of snack apples to one loose apple), a base variety is refused when the name has unexplained residual tokens (this is what stopped `Dried Porcini` matching `Mushroom Sliced` and bird's-eye matching cayenne), and a SKU absent from its retailer's newest run is never compared. **Coverage on the 16 Sep captures: 27%/24% -> 35%/29% of all rows, or 46%/45% of the produce rows that are matchable at all**; 125 keys matched across retailers over the whole archive. Tests went 65 -> 154. Two criticals were caught by audit *after* the first cut and are worth knowing about: a bulk weight priced per each (Coles lists `Royal Gala Apples 1kg` as "1 each" at $7.90/ea, with the kilo only in the NAME) read as +527% against a loose Woolworths apple; and picking the newest *complete* run as "on the shelf today" marked 564 of 568 Woolworths products stale, because P0.3 means no Woolworths run earns `_SUCCESS` — which suppressed the Woolworths panel on all but 4 Coles pages. Also fixed en route: `getItems` was choosing `bestSku` on a single unit basis and silently dropping every SKU on the other (29 items). Full write-up and what is still open: [`docs/CROSS_RETAILER_MATCHING.md`](docs/CROSS_RETAILER_MATCHING.md). Remaining: the 921-row golden file, the category-grid badge, `#/cheapest` variety winners, and the Lambda emitting `canonical_group` on the products dataset (schema 1.2). | **The single biggest unblock in the project** — now unblocked. The Coles-vs-Woolworths panel is live on every matched product page. |
| **2.2** | **Basket matching.** Populate `basket_item_id` for the ~8 produce basket items via 2.1 (`basket.js` `keywords` are the seed), then the home receipt becomes real for those 8 with the other 26 explicitly "not crawled yet". Cost-of-basket-this-week is then one sum. | Home page receipt; first step to "your personal CPI". |
| **2.3** | **The Potato Index — cheapest-line daily series.** `/api/series/:group`: the cheapest unit price per canonical group per retailer per day, from every run in the archive (data exists from Aug 28). Sparkline on each "Cheapest today" cell; full chart on the category page in place of the 2014→today `NotWired` (label it honestly: "since 28 Aug 2026"). | v1's 3.3. Front-page material, and it gets better every day the schedule runs. |
| **2.4** | **Specials checker v0 ("was it ever that price?").** Query: for each `is_on_special` row, compare `was_price_aud` against the max price actually observed for that SKU in the prior N weeks. Build and test the query now; gate the page on archive depth (show "N of 12 weeks captured" until qualified — ~late Nov 2026 if the schedule holds). | v1's 3.2. Most press-worthy feature; cannot be rushed. |
| **2.5** | **Shrinkflation detector v0.** Diff `net_size_value` per SKU across runs; flag size ↓ with price flat/↑. Works today; will find little in produce. Ship as "watching N products, 0 findings" and let it earn its findings. | Real value arrives with 2.6. |
| **2.6** | **Second and third categories.** *22 Oct: Snacks & confectionery is built and hidden.* The old Snacks and Chocolate tiles are now one aisle, and there is one browse node per retailer. The matcher keys on brand + line + flavour + form and compares only an identical pack, per pack: 588 pairs. Lambda written, not applied. See [`docs/SNACKS_DATA_TODO.md`](docs/SNACKS_DATA_TODO.md). The Lambda is category-parametrised; add EventBridge targets for packaged aisles where shrinkflation and specials actually happen — recommend **Chocolate & confectionery** first (highest CPI mover, brand-heavy, sizes change), then **Snacks/biscuits**, then **Dairy/eggs/bread**. Scope first: `taxonomy.py` / `produce_lexicon.py` / `cheapest.py` are produce-specific; packaged goods need grouping by canonical *product* (brand + line + size) rather than by subcategory, and a `$/100g` basis. | Turns four of the six home tiles from "NO CRAWL YET" to measured, and gives 2.4/2.5 something to find. |
| **2.8** | **Fact prose per aisle.** `client/src/lib/facts/` exists for Fruit & vegetables (`vegetables.js`); each new aisle in 2.6 needs its own fact file, and each fact needs its source tag (`ABS CPI 6401.0` / `GENERAL`) and its `when(s)` guard so it retires itself when it stops being true. Cheap, and it is what makes a category page worth reading before its own series is deep enough to plot. | Small; do it with 2.6. |
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

## 3. Suggested next four weeks (re-planned 25 Sep)

Weeks 1–2 of the previous plan happened out of order: P1.2 and P2.0 shipped
instead of P1.1/1.5/1.7, which is a fair trade — they are what made the
category and product pages real. The two things that slipped are the ones a
stranger would notice first: nothing is deployed, and the trust pages are still
hatched. This plan puts them first.

| Week | Focus |
|---|---|
| **1** (25 Sep –) | **Commit the working tree today.** Then P0.3: one instrumented Woolworths run, name the missing rows, fix or redefine `complete` in the manifest. Confirm the alarm email; test `no-data-24h`; retire the standalone Lambdas (0.9). |
| **2** | P1.1 delete the mock layer + rewrite `README.md` · P1.5 staleness banner · P1.7 tests on the view-model builders (`buildWall`, `buildView`, `getProduct` sizes, `formatUnit`). |
| **3** | P1.3 data-quality page (there is a real story to tell now) · P1.4 methodology · P1.6 downloads · P1.8 mobile. |
| **4** | P1.9 deploy publicly. Start P2.1 matching on 2.0's `itemKey`. |

By the end of week 4 the archive is ~7 weeks deep, Woolworths says `complete`,
the site is public and honest on a phone, and the matcher — which everything in
P2 waits on — is underway.

---

## 4. Things to delete or stop maintaining

- `server/store.js`, `server/adapters/*`, `/api/prices`, `/api/collect`, mock
  `HISTORY` (P1.1) — **all still present on 25 Sep**. `/api/history` is no
  longer on this list: P1.2 made it real.
- The `test` Lambda from Aug 24, still in Terraform state (P0.9, now unblocked).
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
| Work lost — no version control | Solved 17 Sep, and actually held as of 15 Nov: nothing uncommitted, `origin/main` current, and the meat/snacks Terraform is no longer laptop-only. | Keep the tree clean; `terraform plan` reports no drift. |
| Schedule fires but nobody notices it stop | **Occurred Sep 5–13.** Mitigated 17 Sep, pending email confirmation. | `fruitveg-no-data-24h` + SNS → email; every alarm has an action. |
| Woolworths never `complete` → never `_SUCCESS` | **Live, and now the project's top risk.** The 17 Sep fix reduced it (5–8 rows → 1–4) but did not remove it, and since 23 Sep the mornings miss too: 12 `_SUCCESS` in 29 runs. Every downstream "complete history" claim is Coles-only until this closes. | P0.3, reopened with a concrete next step. `fruitveg-partial-runs` is firing, which is the alarm working, not noise to be muted. |
| Retailer blocks the residential exit (AWS egress is already blocked by both) | Not currently. One rotation on 23 Sep 06:00 (`proxy_rotations: 1`) is the only sign so far. | `DATA_SUPPLY_DECISION.md` §4: stop that retailer, don't rotate. ABS-only mode (P1.2) keeps the trend story alive. |
| Stale data shown as current | **Live now** — the site has been running unattended for a week with no staleness rule, and the local mirror on this machine was eight days behind when checked. | P1.5, week 2. |
| Matching quality — a wrong "same product" is a wrong headline | Future (P2.1). | Show the confidence tier; never present a `weak` match as a price comparison; hand-verify the produce groups. |
| Solo-maintainer lapse | Structural. | P0.6 and P1.9 remove every recurring manual step (sync, reload, server uptime). |
| Legal / ToS exposure | Unchanged from v1; the stance is now written (`DATA_SUPPLY_DECISION.md` §6). | Get a real read before public launch (P1.9); the methodology page (P1.4) carries §6 in its own words. |
| Building UI ahead of data | Largely avoided by `NotWired`. | Keep the rule: a block lights up only when its data exists. |
