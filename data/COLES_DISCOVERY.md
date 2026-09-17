# Coles — Discovery & Start Plan

**Status: discovery complete AND built.** Probed live 2026-08-29 from a
residential connection; the crawler described here is implemented in
`infra/terraform/lambda/category_crawler/coles.py` and verified against the live
site the same day — **481 rows against 481 reported**. It is **not deployed**:
the AWS-egress gate in §5.4 is still unmeasured. See
[`DATASETS.md`](DATASETS.md) for how to run it.

This is the Coles counterpart to [`LAMBDA_OUTPUT_SPEC.md`](LAMBDA_OUTPUT_SPEC.md)
§10 (which measured Woolworths), and it answers the three questions asked
before building anything:

1. **How is it going to work** — which surface we read, and why that one.
2. **How we pull the info** — the exact request sequence, page by page.
3. **What the blockers are** — five of them, one of which is a design change,
   not just an engineering cost.

Everything marked *measured* was actually requested against `coles.com.au` on
2026-08-29. Everything marked *unverified* is a hypothesis with the experiment
that settles it. `DATA_SOURCING.md` §1.2 guessed at
`GET /api/products?searchTerm=`; **that guess was wrong** and is superseded by
this document.

---

## 1. Headline: Coles is easier than Woolworths, except in two places

| | Woolworths (spec §10) | Coles (measured today) |
|---|---|---|
| Page render | Client-rendered; DOM has 0 tiles | **Server-rendered** — products are in the HTML |
| Capture surface | `/apis/ui/browse/category` (undocumented JSON) | `/_next/data/<buildId>/en/browse/<slug>.json` (the site's own SSR payload) |
| Products per request | 36 | **48** |
| Fruit & Veg category | 472 products, 14 pages | **481 products, 11 pages** |
| Completeness on a real crawl | 472 rows / 472 reported | **481 rows / 481 reported** |
| Sponsored-tile contamination | 8 promoted tiles/page, 104 dupes to drop | **0 in this category** — `adId` present but null |
| Latency per page | ~1.0 s | **~0.4 s** |
| Grocery catalogue size | 41,940 SKUs / ~1,200 requests | **~19,600 SKUs / ~410 requests** |
| Taxonomy discovery | Extra call to `PiesCategoriesWithSpecials` | **Free** — full 1,480-node tree with per-node counts is embedded in every page |
| Bot defence | Akamai; **403 from AWS** (§10.2a) | Imperva/Incapsula; **fails open with HTTP 200** — see §5.3 |
| Cross-retailer join key (GTIN) | Present on most packaged SKUs | **Absent** — see §5.1 |

The two places it is *harder* are the ones that matter: **no GTIN**, and a bot
defence that returns `200 OK` when it blocks you.

---

## 2. How it works — the capture surface

Coles' storefront is a Next.js app. A browse page is rendered on the server, so
the full product payload for the category ships inside
`<script id="__NEXT_DATA__">` in the HTML. The same payload is available on its
own, without the 657 KB of HTML around it, from Next's data route:

```
GET https://www.coles.com.au/_next/data/<buildId>/en/browse/<a>/<b>/<c>.json
    ?slug=<a>&slug=<b>&slug=<c>&page=<n>

Headers: User-Agent: <real Chrome UA>
         Accept: */*
         x-nextjs-data: 1
         Referer: https://www.coles.com.au/browse/<a>/<b>/<c>
```

*Measured:* `200`, **44.9 KB** for one page of 48 products, ~0.4 s. The HTML
equivalent is 657 KB for the same data — **15x cheaper on the JSON route.**

The response is the page's props verbatim:

```
pageProps.searchResults
  .noOfResults   481      <- total in the category; the completeness check
  .start         0        <- page index, 0-based (NOT an offset)
  .pageSize      48       <- fixed; ?pageSize=100 is ignored, still 48
  .results[]              <- one object per product, _type: "PRODUCT"
```

And, at no extra cost, every browse response also carries the entire category
tree with product counts, in
`pageProps.initialState.digitalGraphQLApi.queries["GetProductCategories(...)"]`
— 22 departments, **1,480 nodes**, each with `seoToken`, `id` and
`productCount`. This is the Coles equivalent of `PiesCategoriesWithSpecials`,
and it means the enumerator and the crawler are the same request.

### 2.1 One product, as returned

```json
{ "_type": "PRODUCT", "id": 4199503, "adId": null, "featured": false,
  "name": "Potatoes Sweet Gold", "brand": "Coles", "size": "approx. 500g",
  "availability": true, "availabilityType": "InStoreAndOnline",
  "availableQuantity": 2614,
  "imageUris": [{ "uri": "/4/4199503.jpg" }],
  "merchandiseHeir": { "tradeProfitCentre": "FRESH PROD",
                       "categoryGroup": "VEGETABLES/SALAD",
                       "category": "POTATOES", "subCategory": "SWEET POTATOES",
                       "className": "LOOSE" },
  "onlineHeirs": [{ "aisle": "Potatoes", "aisleId": "545475",
                    "category": "Vegetables", "categoryId": "1303",
                    "subCategory": "Fruit & Vegetables", "subCategoryId": "2100" }],
  "pricing": { "now": 1.75, "rawPriceNow": 1.75, "was": 0,
               "unit": { "quantity": 500, "ofMeasureQuantity": 1,
                         "ofMeasureUnits": "g", "price": 3.5,
                         "ofMeasureType": "g", "isWeighted": true,
                         "isIncremental": false },
               "comparable": "$3.50/ 1kg", "promotionType": "SPECIAL",
               "onlineSpecial": false } }
```

That is enough to fill every column in `LAMBDA_OUTPUT_SPEC.md` §6 **except
`gtin`, `country_of_origin` and `health_star_rating`** (§5.1).

### 2.2 What robots.txt says

*Measured:* `200`, and it is permissive where we need it.

- **No `Disallow` on `/browse/`** — the capture surface is not disallowed.
- `Allow: /product/*-*` — product detail pages are explicitly allowed.
- Disallowed, and therefore off-limits: `/search/`, `/brand/*`,
  `*/on-special*`, `*/half-price-specials*`, `/store-locator/`, `/lists/`,
  `/account/`, and any URL carrying `?filter_Special=`.
- Publishes five sitemaps, including `sitemap-categories.xml` (1,104 category
  URLs, *measured*) and `sitemap-index-products.xml` → two product sitemaps.

Same standing caveat as spec §10.3: robots.txt is not the Terms of Use, and
permission to crawl a page is not permission to redistribute its prices.

---

## 3. How we pull it — the exact sequence

```
  1. GET /browse/<any category>            (HTML, ONCE per run at most)
        -> scrape "buildId":"20260825.4-04e74..." out of __NEXT_DATA__
        -> cache it (S3 or SSM Parameter Store)
        -> also yields the full 1,480-node taxonomy, free

  2. for each target category node:
       for page in 1..ceil(noOfResults / 48):
         GET /_next/data/<buildId>/en/browse/<slug>.json?slug=..&page=<n>
         assert pageProps.searchResults.results is a non-empty list   <-- §5.3
         dedupe by results[].id
         sleep 700 ms
       assert len(unique ids) == noOfResults   -> else manifest status "partial"

  3. write <run_id>.csv + .cheapest-by-subcategory.csv + .manifest.json
  4. write _SUCCESS last, only if status == "complete"
```

Step 1 is the only HTML request in the whole run, which matters because HTML is
the surface Imperva blocks first (§5.3). On a `404` from step 2 — which is what
a stale `buildId` returns, *measured* — re-run step 1 once and retry; a second
404 is a hard failure, not a retry loop.

*Measured, full crawl of `/browse/fruit-vegetables`:*

```
page  1: 200  48 tiles -> +48 new (48)   0.36s
...
page 10: 200  48 tiles -> +48 new (480)  1.04s
page 11: 200   1 tile  -> + 1 new (481)  0.34s
TOTAL reported 481, unique 481, tiles 482, sponsored 0, duplicates 0
```

481 unique against 481 reported — the arithmetic closes exactly, the same
completeness guarantee the Woolworths crawler already asserts. (One page
returned 49 tiles; the extra was a non-`PRODUCT` tile and was skipped on
`_type`, which is why the filter must be on `_type` and not on array length.)

---

## 4. Column mapping — Coles → `LAMBDA_OUTPUT_SPEC.md` §6

The spec is retailer-agnostic and holds. Notable mappings and traps:

| Spec column | Coles source | Note |
|---|---|---|
| `retailer` | `"coles"` | matches `STORES[].id` in [`basket.js`](../server/data/basket.js) |
| `dataset` | `"coles.products"` | as anticipated in spec §9.1 |
| `source_endpoint` | `/_next/data/{buildId}/en/browse/{slug}.json` | decide once whether the buildId is elided |
| `retailer_sku` | `id` | integer in JSON → **store as string** (spec §6) |
| `record_id` | `coles:<id>:online` | |
| `product_url` | `/product/<kebab(name + " " + size)>-<id>` | pattern verified on 2 products; **treat as derived, not authoritative** |
| `gtin` | **none** | see §5.1 — always `""` plus `MISSING_GTIN` |
| `product_name` / `brand` | `name` / `brand` | `brand` was populated on 481/481 |
| `dept_node_id` / `_name` | `onlineHeirs[0].subCategoryId` / `.subCategory` | **Coles' naming is inverted** — `subCategory` here is `"Fruit & Vegetables"`, the *top* level |
| `category_node_id` / `_name` | `onlineHeirs[0].categoryId` / `.category` | `"Vegetables"` |
| `subcategory_node_id` / `_name` | `onlineHeirs[0].aisleId` / `.aisle` | `"Potatoes"`. These six columns are empty in the Woolworths file; Coles can fill them |
| `sap_*` | `merchandiseHeir` | grain problem — §4.1 |
| `package_size_raw` | `size` | `"approx. 500g"`, `"1 Each"`, `"6 Pack"` — the existing `parse_package_size()` already handles all three shapes |
| `price_aud` | `pricing.now` | |
| `was_price_aud` | `pricing.was` | **`was: 0` means "no previous price", not $0.00** — the same trap spec §6.4 calls out for `price`. Map `0` → null |
| `is_on_special` | *unresolved* | `promotionType: "SPECIAL"` appeared on a product with `was: 0` and `onlineSpecial: false`. Do not trust one flag alone — §7, question 3 |
| `unit_price_raw` | `pricing.comparable` (`"$3.50/ 1kg"`) | parses with the existing `_parse_cup_string` / `_cup_to_canonical` unchanged |
| `unit_price_value` / `_measure` | `pricing.unit.price` / `ofMeasureQuantity` + `ofMeasureUnits` | |
| `sold_by` / `is_variable_weight` | `pricing.unit.isWeighted`; `size` starting `"approx."` | |
| `is_in_stock` / `is_purchasable` | `availability`, `availableQuantity > 0` | 42/481 had `availability: false` |
| `is_age_restricted` | `restrictions.liquorAgeRestrictionFlag` or `tobaccoAgeRestrictionFlag` | |
| `is_sponsored` | `adId != null` or `featured` | 0 in Fruit & Veg; verify on a department that does carry ads |
| `is_market_product` | always `false` | Coles has no marketplace tier — the one Woolworths problem Coles does not have |
| `country_of_origin`, `health_star_rating` | **not in the browse payload** | PDP-only / absent — §5.1 |
| `canonical_product_key` | same hash function, `variety` fed `""` | Coles has no `variety` field; the formula must stay byte-identical or the two retailers stop grouping together |

### 4.1 The taxonomy grain problem (decide before writing the parser)

`cheapest.py` groups on `sap_subcategory`. Coles gives **five** merchandise
levels where Woolworths gives four, so this mapping decides how coarse the
derived report is — and a mismatched grain makes the Woolworths and Coles
"cheapest" series non-comparable, which is the entire point of adding Coles.

Same product, both retailers, *measured*:

| Level | Woolworths (`Sweet Potato Gold`) | Coles (`Potatoes Sweet Gold`) |
|---|---|---|
| department | `FRUIT AND VEG` | `FRESH PROD` (`tradeProfitCentre`) |
| category | `VEG / FRESHCUTS / HARD PRODUCE` | `VEGETABLES/SALAD` (`categoryGroup`) |
| — | *(no equivalent)* | `POTATOES` (`category`) |
| subcategory | `SWEET POTATO` | `SWEET POTATOES` (`subCategory`) |
| segment | `SWEET POTATO LOOSE` | `LOOSE` (`className`) |

**Decision (implemented):** map by grain, not by field name —
`sap_department ← tradeProfitCentre`, `sap_category ← categoryGroup`,
`sap_subcategory ← subCategory`, `sap_segment ← className`, with the orphaned
`merchandiseHeir.category` (`POTATOES`) going to a new `sap_family` column — an
append-only addition that bumps the schema `1.0 → 1.1` under spec §9.3, which is
permitted and costs existing consumers nothing.

> **Correction to this section's first draft.** It claimed this mapping "keeps
> the cheapest-by-subcategory series directly comparable". Checking a second
> product against the real Woolworths file shows that is **not** true in
> general — Coles' hierarchy is not uniformly one level deeper:
>
> | Product | Woolworths `sap_subcategory` | Coles `subCategory` | Coles `className` |
> |---|---|---|---|
> | Sweet potato | `SWEET POTATO` | `SWEET POTATOES` | `LOOSE` |
> | Strawberries | `STRAWBERRY` | `BERRIES` | `STRAWBERRIES` |
> | Blueberries | `BLUEBERRY` | `BERRIES` | `BLUEBERRIES` |
>
> Potatoes line up; berries do not — Coles groups both berries under `BERRIES`
> where Woolworths splits them. No mapping fixes this, because the two
> taxonomies genuinely disagree about depth by department. The right response is
> the one the spec already prescribes: `sap_*` is **each retailer's own
> taxonomy, recorded faithfully**, and cross-retailer comparison goes through
> §8 matching, never through `sap_subcategory` equality. The
> cheapest-by-subcategory report stays a per-retailer series. This is now stated
> in the spec's §6 column dictionary and pinned by a printed note in
> `coles_test.py`.

---

## 5. Blockers

### 5.1 No GTIN — a design change, not a missing column *(confirmed)*

The browse payload has **no barcode field at all**. The product detail page has
a `gtin` key, and it was **`null` on all three products tested**, including a
national brand. GTIN is spec §8.1 **tier 1** — the mechanism that makes
Woolworths↔Coles comparison exact rather than fuzzy — and spec §6 calls it
"the cross-retailer join key".

**Consequence:** for Coles, tier 1 does not exist. Matching falls to:

- **tier 2, a curated `sku-map.json`** — already the *preferred* path for
  branded staples under spec §8.1, and now the only reliable one. Adding Coles
  means hand-mapping the ~34 basket items to Coles SKUs, once, in version
  control.
- **tier 3, attribute rules over `canonical_product_key`** — already the plan
  for fresh produce, and unaffected.

Survivable, and it barely changes the recommended design — but it must be
decided **before** anyone writes a join that assumes `gtin`. Re-test `gtin` on
~20 packaged SKUs across departments before closing this out: three nulls is
suggestive, not conclusive.

### 5.2 The `buildId` is a moving part *(confirmed)*

`_next/data` requires the current build hash — today
`20260825.4-04e74006a8bbaa6cbf7882b792617e5c7de5081a`. A stale one returns
**404** (*measured*). It changes on every Coles deploy, and the only place to
read it is an HTML page — the surface most likely to be blocked (§5.3).

**Mitigation:** cache the buildId; refresh it from HTML only on a 404; at most
one HTML request per run. Do **not** pin a buildId in Terraform or an env var.

### 5.3 Imperva blocks with `HTTP 200` — a silent-corruption risk *(confirmed)*

`x-cdn: Imperva`. After roughly 30 requests across ~10 minutes from one
residential IP, the site began returning a **6,058-byte "Pardon Our
Interruption" interstitial with status `200 OK`** — first on `/product/`, then
on every HTML page, including browse pages that had worked minutes earlier.
Full browser-realistic headers (`Sec-Fetch-*`, `sec-ch-ua`,
`Upgrade-Insecure-Requests`) recovered `/product/` once, then stopped working.

Two things follow, and the first is the important one:

1. **A status-code check is not a success check.** A crawler that trusts `200`
   will parse an interstitial, find no products, and — if careless — write an
   empty or partial file. That is precisely the silent degradation
   `DATA_SOURCING.md` §2.1 forbids, and the failure Woolworths' honest `403`
   protected us from. **Every response must be validated on content**
   (`pageProps.searchResults.results` is a list) and on size, and a failed
   assertion must fail the run loudly, exactly as the existing 0-row guard does.
2. **The JSON route survived the block.** With HTML fully interstitialed,
   `/_next/data/...json` still returned real data (*measured, twice, after the
   block*), as did the sitemaps and `robots.txt`. That is consistent with a
   defence tuned for document navigations. It is a useful property, **not** a
   guarantee, and must not be leaned on: it is one afternoon, from one IP.

Send full browser headers, keep the 700 ms delay, keep runs to once a day, and
treat a block as a stop signal — `DATA_SOURCING.md` §2.2 rules out working
around it.

**Reproduced during implementation, and handled.** Mid-build the HTML surface
started returning the interstitial again while the data route kept serving. The
crawler's behaviour was exactly what this section asks for: the warm-up named
the interstitial (`buildId lookup blocked (interstitial)`), the run wrote **no**
CSV, wrote **no** `_SUCCESS`, recorded the reason in the manifest and threw, so
the CloudWatch alarm would fire. Nothing wrong entered the archive. Two things
came out of it:

- `COLES_BUILD_ID` (Terraform: `coles_build_id`) pins the build hash and skips
  the HTML request entirely — the honest escape hatch for exactly this state,
  and deliberately an explicit operator choice rather than an automatic
  fallback.
- Every page response is validated on `pageProps.searchResults.results` being a
  list before a single row is built, and a rejected response is retried from a
  fresh exit IP like any other block.

### 5.4 AWS egress is unmeasured, and the precedent is bad *(unverified — settle this first)*

The Woolworths Lambda is deployed and **403s from `ap-southeast-2`**
(spec §10.2a). Coles sits behind Imperva rather than Akamai, so the answer
genuinely may differ — but if it is the same, **everything else in this
document is moot**, and the honest options are the four in spec §10.2a (ask,
buy, use ABS, or stay on modelled data).

**This is the gate. Measure it before writing a line of crawler code**, using
the throwaway function that already exists at
`infra/terraform/lambda/test/handler.py`: point it at one browse page and one
`_next/data` URL, deploy, invoke, print status and byte count. Half an hour of
work, and it decides whether the next two weeks are worth spending.

### 5.5 Store/postcode scoping is unpinned *(unverified)*

`initialState.trolley.storeId` is `"7674"` while
`initialState.shoppingMethod.localisation` is **empty** — so an anonymous
request gets a default store rather than a chosen one, and Coles prices vary by
store.

Until the pinning mechanism (cookie? query param? a localisation call?) is
understood, `postcode` **must not** be written as `2000` to match the
Woolworths file. Write `postcode = ""` and `fulfilment_store_id = "7674"`, and
let the manifest's `capture_context` say plainly that this was the anonymous
default store. A wrong postcode is worse than an absent one.

### 5.6 Terms of Use — unchanged, and still the real exposure

`DATA_SOURCING.md` §1's warning applies in full. robots.txt permitting
`/browse/` is a meaningful machine-readable signal, and this plan honours every
`Disallow` in it — but it is not the ToU, and it is not permission to
redistribute prices. Mock stays the permanent default. Anyone taking this past
a personal project needs a real legal read first.

---

## 6. How we should start — phased, with a gate

**Phase 0 — measure, before any crawler code (half a day).** Four experiments,
each of which can kill or reshape the plan:

1. **AWS egress probe** (§5.4). *Gate: if `_next/data` is blocked from Lambda,
   stop and re-open the spec §10.2a options.*
2. **Store pinning** (§5.5) — find how a store is selected, and whether pinning
   one changes prices. Determines whether `postcode` is meaningful at all.
3. **GTIN sample** (§5.1) — 20 packaged SKUs across departments. Determines
   whether tier-1 matching exists.
4. **`buildId` lifetime** (§5.2) — check it daily for a week; sets the refresh
   policy.

**Phase 1 — local CLI first, exactly as Woolworths was done.**
`data/scripts/crawl_coles_category.py`, crawling `fruit-vegetables`. The
success criterion is already known and falsifiable: **481 rows against 481
reported**, plus a spot-check of five prices against the live site.
Deliberately the same category as the existing Woolworths file, so the first
output is an immediate apples-to-apples comparison rather than a schema
exercise.

**Phase 2 — factor the shared code, then add the Lambda.** `to_csv`, `COLUMNS`,
`parse_package_size`, `_cup_to_canonical`, `_canonical_key`, `cheapest.py`,
`proxy.py` and `secrets_store.py` are all retailer-agnostic, and are the
majority of the Woolworths Lambda by line count. Only `fetch_page` and
`build_row` are Woolworths-specific.

> **Packaging decision to make here:** Terraform's `archive_file` takes a single
> `source_dir`, so two Lambdas cannot simply share a sibling directory. Copying
> the files is how they drift — which is exactly what `crawler.py`'s module
> docstring says it exists to prevent. **Recommendation: a Lambda layer** built
> from `lambda/common/`, attached to both functions.

Then `infra/terraform/lambda_coles.tf`, mirroring `lambda_woolworths.tf`:
write-only IAM scoped to a `coles` prefix, its own log group, its own
EventBridge rule (**staggered** — do not fire both crawlers into the same
minute at 18:00 UTC), its own error alarm, and the schedule left `DISABLED`
until a manual run has succeeded.

**Phase 3 — register and wire up.** A `coles.products` row in
[`DATASETS.md`](DATASETS.md); the schema `1.1` note for `sap_family` (§4.1);
a `server/adapters/coles.js` behind `ENABLE_COLES=true`, following the
`collectWoolworths()` shape; and the tier-2 `sku-map.json` entries that the
missing GTIN now forces (§5.1).

**Explicitly not in scope for v1:** a full 19,600-SKU catalogue crawl; the
product-detail dataset (`coles.product_detail` — where GTIN, nutrition and
country of origin would live, and which needs the *most*-blocked surface); and
`/search/` in any form (robots-disallowed).

---

## 7. Open questions

1. **Does `_next/data` work from AWS?** §5.4. The gate on everything else.
2. **Can a store be pinned deterministically, and does it move prices?** §5.5.
   If yes, a small postcode panel becomes possible for both retailers.
3. ~~**What is the reliable "on special" signal?**~~ **Resolved.** Across all
   481 products: `was` is `0` on **every single row** — Coles publishes no
   previous price on this surface — and all 118 rows carrying
   `promotionType: "SPECIAL"` are `specialType: "MULTI_SAVE"` multibuys
   ("Buy 2 for $4.80"), where `now` is the ordinary single-unit price and
   nothing is marked down. So: `was_price_aud` is always null, `is_on_special`
   means "this line has a promotion", `promo_text` carries its terms verbatim,
   and a `PROMO_MULTIBUY` warning tells a consumer the headline price is not a
   discounted one. The multibuy's own `unitPriceDisplay` is deliberately **not**
   used for `price_per_*`: it would report a price nobody pays for one unit.
4. **Is `merchandiseHeir.category` worth a `1.1` column?** §4.1. Recommendation
   is yes, as `sap_family`.
5. **Is the product URL slug rule (`kebab(name + size) + "-" + id`) stable?**
   Verified on two products only. If not, `product_url` is derived and possibly
   wrong, and should either be dropped or validated against the product
   sitemap.
