# Lambda Output Specification — Retailer Product Capture

**Status:** draft v1 · **Schema version:** `1.1` · **Reference datasets:** `woolworths.products`, `coles.products`

> **1.1 (2026-08-29)** — one column appended on the right, `sap_family`, per the
> additive rule in §9.3. It is empty for Woolworths and carries Coles' extra
> merchandise level. The first 66 columns are unchanged in name, order, type and
> meaning, so a 1.0 consumer reading by header name is unaffected.

Companion to [`DATA_SOURCING.md`](DATA_SOURCING.md) (which covers *where* data
comes from and *how it is stored server-side*). This document covers exactly one
thing: **the file a collection Lambda writes, column by column.**

If you are writing a new Lambda for a new retailer or a new kind of data, read
§2 (the layer model), §4 (the spine), and §9 (extensibility rules). Everything
else is the Woolworths-specific instance of those rules.

---

## 1. The problem this spec exists to solve

> *"A supermarket might have a lot of different potatoes — how do I start
> differentiating between them?"*

Woolworths' "Potatoes & Pumpkins" subcategory (node `1_03F7B3C`) contains dozens
of SKUs: brushed potatoes loose per kg, washed potatoes in a 2kg bag, a 4kg bag,
baby chats in a 750g punnet, Desiree, Kipfler, organic brushed, microwaveable
steam-in-bag potatoes, and Woolworths-brand vs grower-brand versions of several
of those.

There are three tempting-but-wrong ways to handle this:

| Wrong approach | Why it breaks |
|---|---|
| Have the Lambda search `"brushed potatoes"` and take result #1 | This is what [`server/adapters/woolworths.js`](../server/adapters/woolworths.js) does today. Result #1 is chosen by *Woolworths' relevance ranking*, which changes without notice. Your price index then moves because their search algorithm moved, not because potatoes got more expensive. This is a silent, uncorrectable data-quality failure. |
| Have the Lambda decide which SKU "is" the basket's potato | Bakes a judgement call into the scrape. When you later change the rule, all your history is unfixable — you never captured the alternatives. |
| Compare raw shelf prices across SKUs | `$6.00` for a 2kg bag and `$9.50` for a 4kg bag are not comparable numbers. Without normalising to `$/kg` you are comparing package sizes, not prices. |

**The rule this spec enforces: the Lambda captures, it does not choose.**

A Lambda run emits *every* SKU it saw in the categories it was asked to crawl,
with enough attributes attached that any downstream selection rule can be
applied — and re-applied retroactively to history, because the alternatives were
captured too.

Differentiation happens on three axes, all of which must be in the file:

1. **Identity** — `retailer_sku` (Woolworths Stockcode) is the true primary key.
   `gtin` is the cross-retailer join key.
2. **Attributes** — brand, variety, pack size, sold-by-weight vs each, organic,
   prepared-vs-raw. This is what separates "Brushed Potatoes 2kg" from "Baby
   Chat Potatoes 750g".
3. **Normalised unit price** — `price_per_kg_aud` / `price_per_l_aud` /
   `price_per_each_aud`. This is the only field on which two different SKUs can
   be honestly compared, and the only one an index should be built on.

---

## 2. Layer model — what a Lambda is and isn't responsible for

```
  +-----------------------------------------------------------------+
  |  L0  RAW CAPTURE          <- this spec.  Lambda writes this.    |
  |      One row per SKU per run, verbatim retailer values plus     |
  |      deterministic parsing. Immutable. Never edited, never      |
  |      overwritten, never deleted.                                |
  +-------------------------------+---------------------------------+
                                  |
  +-------------------------------v---------------------------------+
  |  L1  NORMALISED               <- derived columns, also in this  |
  |      pack size -> base units, price -> $/kg | $/L | $/each,     |
  |      canonical_product_key.  Computed in the Lambda because it  |
  |      is pure and cheap, but ALWAYS recomputable from L0.        |
  +-------------------------------+---------------------------------+
                                  |
  +-------------------------------v---------------------------------+
  |  L2  BASKET MAPPING        <- NOT the Lambda's job.             |
  |      SKU -> BASKET[].id, curated and versioned in the repo.     |
  |      Lives server-side so it can be changed and replayed        |
  |      against all captured history. See section 8.               |
  +-----------------------------------------------------------------+
```

The load-bearing consequence: **`basket_item_id` is emitted as an empty column
by the Lambda.** It exists in the schema so the file shape is stable across
layers, but the scraper never populates it. If you find yourself wanting to fill
it in the Lambda, re-read §1.

---

## 3. Output artefacts per run

A single Lambda invocation produces **three** objects under one run prefix:

```
s3://<bucket>/
  reports/supermarkets/woolworths/fruitAndVeg/
    dt=2026-09-04/                             # UTC capture date, partition key
      20260904050009-42af0dbc.csv                    # the data (sections 4-6)
      20260904050009-42af0dbc.cheapest-by-subcategory.csv   # derived (3.3)
      20260904050009-42af0dbc.manifest.json          # run metadata (3.2)
      20260904050009-42af0dbc._SUCCESS               # zero-byte; written last
```

- **The run is a filename stem, not a directory.** A day's prefix lists every
  report captured that day side by side, so finding "what do we have for the
  4th" is one listing rather than a walk of one directory per run. The `run_id`
  leads with its UTC timestamp (`YYYYMMDDHHMMSS-<rand>`), so that listing sorts
  into capture order for free and each run's time is legible in its own name.
- **`_SUCCESS` is written last, and only on a complete run.** Any consumer must
  ignore a run whose `<run_id>._SUCCESS` is absent. This is the only protection
  against reading a partially-flushed CSV from a Lambda that timed out.
- Runs are **never** overwritten. A re-run of the same day gets a new `run_id`,
  and because the stem carries it, the new run lands *beside* its predecessor
  rather than on top of it. De-duplication is a read-time concern, not a
  write-time one.
- One CSV per run is expected at current volume (all of Woolworths food is
  roughly 30–60k SKUs). Split at ~250k rows if it ever grows, as
  `<run_id>.part-NNNNN.csv`.

### 3.1 CSV file conventions

Non-negotiable, because a CSV that is ambiguous about these is worse than no
file at all:

| Concern | Rule |
|---|---|
| Encoding | UTF-8, **no BOM** |
| Line ending | `\n` (LF) only |
| Dialect | RFC 4180. `,` delimiter, `"` quote char, `""` to escape a literal quote |
| Quoting | Quote a field if and only if it contains `,`, `"`, `\n`, or leading/trailing space. Product names contain commas constantly — this matters |
| Header | Required, exactly once, first line, column names as in §4–§6, `snake_case` |
| Column order | Consumers **must** read by header name, never by position. New columns are appended (§9) |
| Null | Empty string. Never `NULL`, `N/A`, `-`, or `nan` |
| Booleans | `true` / `false` lowercase. Empty means unknown, which is **not** the same as `false` |
| Numbers | Plain decimal, `.` separator, no thousands separator, no currency symbol |
| Money | Always 2 decimal places (`4.50`, not `4.5`). Format from a decimal, never from a float, so no `4.499999` artefacts |
| Timestamps | ISO 8601, UTC, `Z` suffix, second precision: `2026-08-28T19:04:11Z`. Storage is UTC always; Australia/Sydney conversion happens at display time only |
| Free text | Newlines inside text fields are collapsed to a single space at capture. Long HTML descriptions are **not** in this dataset (see `woolworths.product_detail`, §9.1) |

### 3.2 `_manifest.json`

Every run writes a manifest. Without it you cannot distinguish "Woolworths has
no organic potatoes today" from "the organic-potatoes page 403'd".

```jsonc
{
  "schema_version": "1.0",
  "dataset": "woolworths.products",
  "run_id": "01J9X2K4M7Q3F8ABCDEFGHJKM",
  "retailer": "woolworths",
  "lambda_version": "git:8f3a1c2",           // build provenance
  "started_at_utc": "2026-08-28T19:00:03Z",
  "finished_at_utc": "2026-08-28T19:41:52Z",
  "status": "complete",                      // complete | partial | failed
  "capture_context": {
    "postcode": "2000",                      // see section 5 - prices are location-scoped
    "fulfilment_store_id": "1234",
    "price_basis": "online",
    "egress": "proxy",                       // proxy | direct - see below
    "egress_country": "au",
    "exit_ip": "203.0.113.47"                // "" unless the exit-IP probe ran
  },
  "requested_nodes": [
    { "node_id": "1_03F7B3C", "name": "Potatoes & Pumpkins", "level": 3 }
  ],
  "counts": {
    "nodes_requested": 20,
    "nodes_succeeded": 19,
    "rows_written": 2418,
    "rows_rejected": 6,
    "distinct_skus": 2415,
    "proxy_rotations": 0                     // exit IPs burned to a block
  },
  "rejections": [                            // bounds-check failures, section 6.4
    { "code": "PRICE_OUT_OF_BOUNDS", "retailer_sku": "155321", "value": "0.00", "count": 1 }
  ],
  "errors": [
    { "node_id": "1_B1FAA13", "page": 3, "http_status": 429, "message": "rate limited after 2 retries" }
  ]
}
```

`egress` records how the run reached the retailer: `direct` from the Lambda's
own AWS address, or `proxy` through a residential session (infra/README section
5). This is capture context, not trivia — a run seen from a Sydney residential
IP and one seen from an AWS range are not guaranteed to have been shown the same
prices, and anyone comparing two days of history needs to know when that
changed. `proxy_rotations` above zero means the run was blocked mid-crawl and
changed exit IP to finish; a rising count across nights is the early warning
that the endpoint has started fingerprinting the crawler.

### 3.3 `cheapest-by-subcategory.csv`

The headline series: **the cheapest buyable line in each `sap_subcategory`** —
"what do potatoes cost at Woolworths today". Derived in the same invocation from
the same in-memory rows as `<run_id>.csv`, so the two can never disagree about
what was captured, and written **before** `_SUCCESS` like every other artefact.

It implements the fresh-produce representative-product policy of section 8.2 at
capture time, so that a daily tracker and the per-supermarket basket average
both read one small file instead of re-deriving the rule over the full CSV.
Being derived, it is not a second source of truth: delete it and it can be
rebuilt from the raw CSV of the same run, byte for byte.

Selection rule, recorded verbatim in the `selection_rule` column:

    min_unit_price_within_sap_subcategory_excl_organic_prepared

| Rule | Why |
|---|---|
| One row per (`sap_subcategory`, `unit_basis`) | A subcategory holds `$4.00/kg` bagged potatoes *and* `$1.31/ea` loose apples. A `min()` across bases returns whichever number is smaller, which is not a price. `kg`, `L` and `ea` are compared only against themselves |
| Organic and prepared lines excluded | A different product for index purposes. Falling back to organic on a day the conventional line is out of stock would show as a price spike no shopper experienced. Both are counted in `excluded_organic` / `excluded_prepared` |
| Only buyable lines | `price_aud > 0`, `is_in_stock`, `is_purchasable`. Counted in `excluded_unavailable` |
| Ties break on `price_aud`, then `retailer_sku` | Two equal-priced SKUs must not alternate between runs — that reads as churn in a series that did not move |
| No eligible candidate → **no row** | An absent row means *unknown*, never zero. Counted in `groups_with_no_candidate` in the manifest |

Alongside the winner the row carries `candidates`, `median_unit_price_aud` and
`max_unit_price_aud` for the same group — the section 8.2 diagnostic. A headline
far below the median is a single promotion, not a market move, and a consumer
charting the series can show that without re-reading the raw file.

The manifest gains a `cheapest_by_subcategory` block with `rows_written`,
`subcategories`, `groups_with_no_candidate`, `rows_without_subcategory`,
`on_special` and the `selection_rule`.

`status` rules: `complete` means every requested node fully paginated.
`partial` means some nodes or pages failed but at least one row was written —
the file is still usable, but a consumer building an index **must** treat
missing SKUs as unknown, not as delisted. `failed` means no usable rows, and no
`_SUCCESS` is written.

---

## 4. Column dictionary — Block A: the spine

**These columns are mandatory in every dataset produced by every Lambda, this
one and every future one.** They are what makes independently built files
joinable. See §9.

| Column | Type | Null? | Description |
|---|---|---|---|
| `schema_version` | string | no | Semver of this spec the row conforms to, e.g. `1.1`. Denormalised onto every row deliberately — a row must stay self-describing once it leaves its file |
| `dataset` | string | no | `<retailer>.<kind>`, e.g. `woolworths.products` |
| `run_id` | string | no | ULID, identical for every row in the run. Joins to `_manifest.json` and to `collection_runs.id` server-side |
| `retailer` | string | no | Stable slug matching `STORES[].id` in [`basket.js`](../server/data/basket.js): `woolworths` \| `coles` \| `aldi` \| `market` |
| `captured_at_utc` | timestamp | no | ISO 8601 UTC. **Identical for every row in a run** — it is the run's logical timestamp, not the moment each HTTP call returned. Do not use it as a uniqueness key (see `DATA_SOURCING.md` §3.2) |
| `source_endpoint` | string | no | The API path the row came from, e.g. `/apis/ui/browse/category`. Lets you audit which capture path produced which rows when you migrate endpoints |
| `confidence` | enum | no | `measured` \| `estimated`. Live scrape is `measured`; anything derived, modelled, or manually keyed is `estimated`. Same contract as `DATA_SOURCING.md` §3.4 — the UI is expected to badge `estimated` prices |

---

## 5. Block B: capture context (why the same SKU has two prices)

Woolworths prices are **not global**. They vary by fulfilment store / delivery
zone, and the online price frequently differs from the in-store shelf price for
the same SKU. A price without its context is not a fact.

| Column | Type | Null? | Description |
|---|---|---|---|
| `postcode` | string | no | Postcode the session was scoped to, e.g. `2000`. Pin this per Lambda and do not let it drift, or your history gets a discontinuity you cannot detect |
| `fulfilment_store_id` | string | yes | Retailer's store identifier for the scoped session, when exposed |
| `price_basis` | enum | no | `online` \| `instore`. Which price populated `price_aud`. Emit **one row per basis** if you capture both — never blend them into one row |

> **Consequence for the site:** two Lambdas pinned to different postcodes produce
> legitimately different prices for the same SKU on the same day. That is a
> feature (regional cost-of-living variation), but only if `postcode` is on every
> row. A national figure is then an aggregation over postcodes, computed
> downstream — never a single "the" price.

---

## 6. Block C: the product record

### 6.1 Identity

| Column | Type | Null? | Description |
|---|---|---|---|
| `retailer_sku` | string | no | Woolworths **Stockcode**, e.g. `133211`. The primary key within a retailer. Verified stable and dereferenceable: `/api/v3/ui/schemaorg/product/133211` returns that product. Store as a **string** — leading zeros exist and must not be eaten by a spreadsheet |
| `gtin` | string | yes | Barcode / GTIN-13, e.g. `0264011000002`. **The cross-retailer join key** — the same packaged product at Woolworths and Coles shares a GTIN, so this is how price comparison becomes exact rather than fuzzy. Null for much fresh produce (loose variable-weight items often have none), which is exactly why §8 needs a fallback path |
| `product_url` | string | no | Canonical URL, `https://www.woolworths.com.au/shop/productdetails/<sku>/<url-friendly-name>`. Powers the site's "see it at the retailer" link, and lets a human sanity-check a suspicious row in one click |
| `record_id` | string | no | `<retailer>:<retailer_sku>:<price_basis>` — the stable business key for a row across runs. Strictly derivable, but every consumer needs it, so compute it once |

### 6.2 Description and classification

| Column | Type | Null? | Description |
|---|---|---|---|
| `product_name` | string | no | Retailer `Name`. Real values carry stray whitespace (the live API returns `" Cavendish Bananas  each"`) — **trim and collapse internal runs of whitespace**, but do not otherwise rewrite it |
| `display_name` | string | yes | Retailer `DisplayName`, usually name plus pack size. Keep both; they differ, and downstream matching uses both |
| `brand` | string | yes | e.g. `Woolworths`, `Macro`, `Mitolo`. Frequently null on loose produce. **Do not infer it from the name in the Lambda** — record the null; inference is an L2 concern |
| `variety` | string | yes | e.g. `Brushed`, `Desiree`, `Kipfler`. Sparsely populated but high-signal for exactly the potato problem |
| `dept_node_id`, `dept_name` | string | no | Level-1 taxonomy, e.g. `1-E5BEE36E` / `Fruit & Veg` |
| `category_node_id`, `category_name` | string | no | Level-2, e.g. `1_AC17EDD` / `Vegetables` |
| `subcategory_node_id`, `subcategory_name` | string | yes | Level-3, e.g. `1_03F7B3C` / `Potatoes & Pumpkins`. **The single most useful differentiator you get for free** — it is the retailer's own opinion about what competes with what |
| `sap_department`, `sap_category`, `sap_subcategory`, `sap_segment` | string | yes | The retailer's own internal merchandising hierarchy, exposed on product payloads. Finer-grained and more stable than the browse tree; carry it when present. Mapped **by depth from the top**, not by the retailer's field names — Woolworths' `sapsubcategoryname` and Coles' `merchandiseHeir.subCategory` land in the same column |
| `sap_family` | string | yes | **Schema 1.1.** The extra level some retailers carry between category and subcategory (Coles: `POTATOES`, between `VEGETABLES/SALAD` and `SWEET POTATOES`). Empty where the retailer has no such level. Added rather than folded into a neighbour because `cheapest_by_subcategory` groups on `sap_subcategory`, and shifting that column's meaning would silently redefine the published series |

> ⚠️ **These columns are each retailer's own taxonomy, recorded faithfully — not
> a normalised cross-retailer one.** The grain is not even consistent between
> departments: Coles' `SWEET POTATOES` lines up with Woolworths' `SWEET POTATO`,
> but Coles' `BERRIES` is one level coarser than Woolworths' `STRAWBERRY` /
> `BLUEBERRY`. Cross-retailer comparison goes through §8 matching
> (`basket_item_id`, `canonical_product_key`), **never** through
> `sap_subcategory` equality.
| `is_organic` | bool | yes | Derived: true when the taxonomy path or name marks it organic (e.g. node `1_B02ADA6` *Organic Vegetables*). Organic SKUs otherwise wreck any "cheapest potato" rule |
| `is_prepared` | bool | yes | Derived: cut / steam-bag / oven-ready items (nodes under *Prepared Vegetables*, `1_4875273`). Same reasoning — economically a different product |
| `country_of_origin` | string | yes | From product attributes where present |
| `health_star_rating` | decimal | yes | 0.5–5.0 where present |
| `image_url` | string | yes | e.g. `https://cdn0.woolworths.media/content/wowproductimages/large/133211.jpg` — verified pattern. Store the URL, never the bytes |

### 6.3 Size and quantity — the differentiator

| Column | Type | Null? | Description |
|---|---|---|---|
| `package_size_raw` | string | yes | Verbatim retailer string: `2kg`, `each`, `500g`, `6x375mL`, `Approx. 250g`. **Always keep the raw string**, even when parsing succeeds — every parser is eventually wrong, and this is what lets you fix history |
| `pack_qty` | decimal | yes | Parsed magnitude: `2` from `2kg` |
| `pack_uom` | enum | yes | `kg` \| `g` \| `L` \| `mL` \| `ea` \| `pack` |
| `units_per_pack` | int | yes | `6` from `6x375mL`; `1` otherwise |
| `net_size_value` | decimal | yes | Normalised total content: `2` (kg), `2.25` (L from 6×375 mL), `1` (ea) |
| `net_size_uom` | enum | yes | `kg` \| `L` \| `ea` — exactly three allowed values. All mass to kg, all volume to L, all countables to ea |
| `sold_by` | enum | no | `weight` (loose, priced per kg) \| `each` \| `pack`. Determines which normalised price column is meaningful |
| `is_variable_weight` | bool | yes | True for `Approx. 250g` style items, where the shelf price is an estimate against an actual weigh-out |

### 6.4 Price

| Column | Type | Null? | Description |
|---|---|---|---|
| `price_aud` | decimal(2) | yes | Current price for `price_basis`. Null when not purchasable — **null, not `0.00`**. A `0.00` in this column is always a bug |
| `was_price_aud` | decimal(2) | yes | Pre-promotion price when on special |
| `savings_aud` | decimal(2) | yes | Retailer-stated saving |
| `is_on_special` | bool | no | Promotional price currently applied |
| `promo_text` | string | yes | e.g. `Half Price`, `2 for $6`. Multi-buys are **not** decomposed into an effective unit price here — that is an L2 decision with policy in it |
| `unit_price_raw` | string | yes | Retailer's own "cup price" string, e.g. `$2.25 / 1KG`. Keep verbatim |
| `unit_price_value` | decimal | yes | Parsed from the above, e.g. `2.25` |
| `unit_price_measure` | string | yes | Parsed measure, e.g. `1KG`, `100G` |
| `price_per_kg_aud` | decimal(4) | yes | **Derived, canonical.** Populated when `net_size_uom = kg` |
| `price_per_l_aud` | decimal(4) | yes | **Derived, canonical.** Populated when `net_size_uom = L` |
| `price_per_each_aud` | decimal(4) | yes | **Derived, canonical.** Populated when `net_size_uom = ea` |
| `price_currency` | string | no | `AUD` |

Exactly one of the three `price_per_*` columns is populated per row. **These are
the only columns any cross-SKU comparison, chart, or index may use.** Prefer
recomputing them as `price_aud / net_size_value` over trusting the retailer's
cup price, but emit both — a disagreement between them is a strong parse-failure
signal (see `parse_warnings`).

Sanity bounds are applied at write time, per `DATA_SOURCING.md` §2.1: a row whose
price is below `$0.10`, or whose normalised price is implausible for its
subcategory, is **excluded from the CSV and recorded in `_manifest.json`
`rejections`**. Never write a value you believe is garbage; never silently drop
one either.

### 6.5 Availability

| Column | Type | Null? | Description |
|---|---|---|---|
| `is_available` | bool | yes | Retailer-stated availability in this fulfilment context |
| `is_in_stock` | bool | yes | Stock signal where distinct from availability |
| `is_purchasable` | bool | yes | Can currently be added to a cart |
| `availability_status` | string | yes | Raw status string, e.g. `InStock` (schema.org `availability` verified present) |
| `is_age_restricted` | bool | yes | Alcohol/tobacco flag; useful for excluding from a grocery index |

> **Absence is not delisting.** A SKU missing from today's file may be genuinely
> gone, or may sit behind a node that 429'd. Only a `complete` run licenses the
> inference "this SKU is no longer sold" — and even then, prefer "not seen in N
> consecutive complete runs".

### 6.6 Lineage and quality

| Column | Type | Null? | Description |
|---|---|---|---|
| `canonical_product_key` | string | yes | Derived grouping key (§8.1) — groups the *same* product across retailers and across pack sizes |
| `basket_item_id` | string | yes | **Always empty in Lambda output.** Reserved for L2. See §2 |
| `parse_warnings` | string | yes | Pipe-separated codes, e.g. `PACK_SIZE_UNPARSED\|CUP_PRICE_MISMATCH`. Empty when clean. This column is how you find out your parser broke *before* a chart does |

Defined warning codes (extend additively): `PACK_SIZE_UNPARSED`,
`CUP_PRICE_UNPARSED`, `CUP_PRICE_MISMATCH` (derived vs retailer unit price
differ by more than 5%), `NAME_WHITESPACE_ANOMALY`, `MISSING_GTIN`,
`MISSING_BRAND`, `PRICE_NULL_BUT_PURCHASABLE`, `TAXONOMY_INCOMPLETE`.

---

## 7. Worked example — the potatoes

Abridged to the columns that do the differentiating:

| retailer_sku | product_name | brand | subcategory_name | package_size_raw | net_size_value | net_size_uom | sold_by | price_aud | price_per_kg_aud | is_organic | is_prepared |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 144781 | Brushed Potatoes | | Potatoes & Pumpkins | per kg | 1 | kg | weight | 3.50 | 3.5000 | false | false |
| 132663 | Washed Potatoes | Woolworths | Potatoes & Pumpkins | 2kg | 2 | kg | pack | 6.00 | 3.0000 | false | false |
| 723441 | Washed Potatoes | Woolworths | Potatoes & Pumpkins | 4kg | 4 | kg | pack | 9.50 | 2.3750 | false | false |
| 165228 | Baby Chat Potatoes | | Potatoes & Pumpkins | 750g | 0.75 | kg | pack | 5.50 | 7.3333 | false | false |
| 281774 | Organic Brushed Potatoes | Macro | Organic Vegetables | 1.5kg | 1.5 | kg | pack | 8.00 | 5.3333 | true | false |
| 447120 | Steam Baby Potatoes | Woolworths | Prepared Vegetables | 400g | 0.4 | kg | pack | 4.20 | 10.5000 | false | true |

*(SKUs and prices here are illustrative; the taxonomy names and node structure
are verified live — see §10.)*

Everything the site needs is now answerable, and answerable *retroactively*:

- **"What does a kilo of potatoes cost at Woolworths?"** — filter
  `subcategory_name = 'Potatoes & Pumpkins'`, `is_organic = false`,
  `is_prepared = false`, then `MIN(price_per_kg_aud)` gives `2.3750`.
- **"Has the cheapest option changed?"** — the winning `retailer_sku` moved from
  the 2kg to the 4kg bag, and you can see that, because both were captured.
- **"Is the headline number a fair comparison?"** — yes, and you can prove it,
  because organic and prepared were excluded by an explicit flag rather than by
  a search term that happened not to match them.

Note how badly the naive approach fares on this same data: a search for
`"potatoes"` could have returned the steam-bag SKU at an effective `$10.50/kg`,
and nothing in the output would have told you anything was wrong.

---

## 8. From SKUs to the basket (L2 — server-side, not the Lambda)

The site's basket ([`BASKET` in `basket.js`](../server/data/basket.js)) has one
`potato` entry. Mapping thousands of SKUs onto its ~34 items is a curated,
versioned decision that lives in the repo — because it must be **replayable**
against captured history when it changes.

### 8.1 Matching, in strict tier order

1. **GTIN exact** — for branded packaged goods, `gtin` is decisive. Same barcode
   at Woolworths and Coles means the same product, no judgement required.
2. **Curated SKU allowlist** — a version-controlled `server/data/sku-map.json`
   of `{ basket_item_id, retailer, retailer_sku }`. For a cost-of-living index
   this is the **preferred** path for branded staples: the index should track a
   fixed representative product over time, so that a change in the number means
   a change in price, not a change in which product you looked at.
3. **Attribute rule** — for fresh produce, where GTINs are absent and the
   specific SKU legitimately rotates. A rule is a declarative filter over the
   columns in §6:
   ```json
   {
     "basket_item_id": "potato",
     "retailer": "woolworths",
     "include": { "subcategory_node_id": "1_03F7B3C", "name_matches": "potato" },
     "exclude": { "is_organic": true, "is_prepared": true },
     "select": "min_price_per_kg"
   }
   ```
4. **Unmatched** — everything else stays captured but unmapped. Unmapped is a
   perfectly good state: the file is the archive, the basket is only one view
   over it.

`canonical_product_key` supports tier 3 as a stable grouping hash over
retailer-independent attributes — normalised name tokens, brand, variety,
`net_size_uom`, and the organic/prepared flags — deliberately **excluding**
`net_size_value`, so that all pack sizes of the same product group together and
can be compared on `price_per_kg_aud`.

### 8.2 Representative-product policy

Whichever rule you pick, state it, version it, and surface it in the UI. Three
defensible policies, and the recommendation:

- **Fresh produce** — *cheapest per kg within subcategory, excluding organic and
  prepared*. Matches how people actually shop for potatoes, and survives
  seasonal SKU rotation.
- **Branded packaged goods** — *named SKU from the allowlist*. A Vegemite index
  has to track the same jar.
- **Diagnostic only** — *subcategory median per kg*. Useful for spotting when
  the cheapest-SKU series is being driven by a single promotion, but too noisy
  to publish as the headline.

---

## 9. Extensibility — rules for the next Lambda

The site will grow and you will add Lambdas. These rules keep independently
built files joinable.

1. **One Lambda equals one dataset equals one file shape.** Do not add a second
   kind of record to an existing dataset. `woolworths.products` and
   `woolworths.specials` are separate datasets even though they overlap.
2. **The spine (§4) is mandatory everywhere.** Any new dataset — a Coles
   scraper, a fuel-price Lambda, a rent-index Lambda — carries
   `schema_version`, `dataset`, `run_id`, `retailer`, `captured_at_utc`,
   `source_endpoint`, `confidence`. That is what makes a file written by a
   Lambda next year joinable to one written today.
3. **Additive-only within a major version.** New columns are appended on the
   right and bump the minor version (`1.0` to `1.1`). Consumers read by header
   name, so appending is safe. **Removing a column, renaming one, or changing
   its type or units is a major bump** (`2.0`) and takes a new dataset partition
   path — never silently redefine a column in place.
4. **Raw is immutable.** A backfill, a reparse, or a bug fix writes a *new* run;
   it never edits an old file. Derived columns must be recomputable from raw
   columns in the same row — which is why `package_size_raw` and
   `unit_price_raw` are retained alongside their parsed forms.
5. **Register the dataset.** Every dataset gets a row in `data/DATASETS.md`:
   name, owning Lambda, cadence, schema version, S3 prefix, owner.
6. **Cadence belongs to the schedule, not the schema.** Woolworths daily,
   manual/Costco monthly — same file shape, different EventBridge rules.

### 9.1 Anticipated future datasets

| Dataset | What it adds | Notes |
|---|---|---|
| `coles.products` | Second retailer — **built** | Same schema, different `retailer`, separate prefix. Does **not** join on `gtin`: Coles publishes no barcode on any reachable surface (COLES_DISCOVERY.md §5.1), so matching falls to §8.1 tiers 2 and 3 |
| `aldi.products` | Third retailer | Limited online catalogue; expect heavy `confidence = estimated` |
| `woolworths.product_detail` | Ingredients, allergens, nutrition, full description | Deliberately separate: one row per SKU, low cadence, large text fields that would bloat the daily price file |
| `woolworths.specials` | Promotion-only sweep | Higher cadence than the full crawl |
| `market.wholesale` | Sydney/Melbourne market wholesale prices | `confidence = estimated`; feeds the `market` store |
| `retailer.stores` | Store locations and postcodes | Gives `postcode` and `fulfilment_store_id` real meaning across regions |

---

## 10. Access surfaces (probed live, 2026-08-28)

Measured against `woolworths.com.au` from a residential connection. **These
numbers are the basis for the crawl design in §10.2 — re-measure from Lambda
before committing, because egress IP matters.**

### 10.1 What works, what doesn't

| Surface | Method | Result |
|---|---|---|
| `/robots.txt` | GET | **200.** Disallows `/shop/search`; **does not** disallow `/shop/productdetails/`; publishes a sitemap index |
| `/sitemap_index.xml` -> `sitemap-products-{1..4}.xml` | GET | **200.** 72,196 product URLs, `lastmod` refreshed daily. Full enumeration costs **4 requests, ~1 second** |
| `/shop/productdetails/{sku}/{slug}` (HTML) | GET | **200, p50 990 ms**, 6.3 req/s at concurrency 8, no throttling. ~604 KB/page. Carries the **full embedded product payload**: `Stockcode`, `PackageSize`, `CupPrice`, `CupString`, `WasPrice`, `IsOnSpecial`, `AdditionalAttributes` |
| `/api/v3/ui/schemaorg/product/{sku}` (JSON) | GET | **200, 100% success, but p50 9.3 s** — a fixed per-request tarpit. Thin fields only: `sku`, `gtin13`, `name`, `brand`, `description`, `image`, `offers.price`, `offers.availability` |
| **`/apis/ui/browse/category` (GET)** | GET | **200 — the primary capture surface.** Full product payload for a whole category, 36 products per request. See §10.1a |
| `/apis/ui/browse/category` | POST | **ECONNRESET** — same endpoint, POST form only |
| `/apis/ui/Search/products` | POST | **ECONNRESET** at TLS, with and without full browser headers |
| `/apis/ui/product/detail/{sku}` | GET | **ECONNRESET** |
| `/apis/ui/PiesCategoriesWithSpecials` | GET | **200.** Full 26-department taxonomy, 3 levels, `NodeId` + `Description` + `UrlFriendlyName` |

### 10.1a The browse endpoint is the right surface (verified by a real crawl)

The browse category page is **client-rendered** — a plain GET of
`/shop/browse/fruit-veg?pageNumber=1` returns 0 product tiles, because the grid
is hydrated by JS. The DOM you see in DevTools is not what the server sends.

But the JSON call behind it works, **as a GET**, unauthenticated:

```
GET /apis/ui/browse/category
    ?categoryId=1-E5BEE36E&pageNumber=1&pageSize=36
    &url=/shop/browse/fruit-veg&location=/shop/browse/fruit-veg
    &formatObject={"name":"Fruit & Veg"}&sortType=TraderRelevance
    &isSpecial=false&isBundle=false&isMobile=false&categoryVersion=v2
```

`url` and `formatObject` are required — omitting them returns
`400 "Url is required."`. The POST form of this same endpoint is reset at TLS;
only the GET form works.

This is strictly better than the sitemap-plus-detail-page approach:

- **It returns the complete product object**, every field §6 needs:
  `Stockcode`, `Barcode`, `Brand`, `Variety`, `PackageSize`, `Unit`, `CupPrice`,
  `CupMeasure`, `CupString`, `Price`, `WasPrice`, `SavingsAmount`,
  `IsOnSpecial`, `IsInStock`, `IsAvailable`, `IsPurchasable`, `Rating`,
  `FulfilmentStoreId`, plus `AdditionalAttributes` carrying `sapdepartmentname`,
  `sapcategoryname`, `sapsubcategoryname`, `sapsegmentname`, `countryoforigin`
  and `healthstarrating`.
- **It gives category membership**, which the sitemap cannot. This is what makes
  the §8.1 tier-3 attribute rules ("everything in Potatoes & Pumpkins")
  expressible at all.
- **It is ~36x fewer requests.** 472 products in 14 requests, versus 472
  individual page fetches. Extrapolated, the full 41,940-SKU core catalogue is
  roughly **1,200 requests instead of 41,940** — which collapses the §10.2
  runtime from ~110 minutes to well inside a single Lambda invocation.

**`pageSize` is hard-capped at 36**; `pageSize=100` returns 400. Pagination is
mandatory, not optional.

#### Sponsored tiles and ads (measured across all 14 pages)

There are **two different things** on the page that are not ordinary results,
and they need opposite handling. Confusing them is easy, because only one of
them looks like an ad.

**1. Banner / content cards — 1 per page, and already invisible to us.**
The single obviously-ad-shaped square (e.g. a "UnionPay Rebate" promo) is an
Adobe Target `mbox` card: a `mboxv2_component_mbox-wrapper` div injected
**client-side**. It never appears in the browse JSON at all. Consuming the API
instead of scraping the rendered DOM eliminates this entire class of problem for
free — no filtering required.

**2. Promoted product tiles — 8 per page, and they look exactly like products.**
These are the dangerous ones. They carry `IsSponsoredAd: true`,
`AdStatus: "Promoted"`, and an `AdIndex`, and in the rendered DOM their only
visual tell is a small `<div class="sponsored-text">Promoted</div>`. Measured
over all 14 pages of Fruit & Veg:

| | |
|---|---|
| Sponsored tiles per page | **8, on every one of the 14 pages** |
| Unique sponsored SKUs | **8** — the identical set each page |
| Grid positions (`AdIndex`) | `0,1,2,3` and `10,11,12,13` — two blocks of four |
| Total sponsored tiles seen | 112, of which **104 are duplicates** |

Left unhandled, a 472-product category becomes 576 rows and those 8 promoted
products are counted **14 times each** in any category average. Handling:

- **Keep them, flag them, dedupe by `Stockcode`.** A promoted product is still a
  real product legitimately in the category (here: Cosmic Crisp apples, Kanzi
  apples, Gourmet Garden pastes). Dropping them would lose real SKUs; keeping
  them undeduped would skew every aggregate. `is_sponsored` records how the tile
  was served so downstream can exclude them from an index if it wants to.
- **`IsMarketProduct`** marks third-party "Everyday Market" listings — skipped
  entirely for grocery datasets (§10.1 finding 3).

The arithmetic closes exactly: 464 organic results + 8 promoted = 472 reported.

Verified end-to-end by `data/scripts/crawl_category.py --retailer woolworths`: 576 tiles
seen, 104 sponsored duplicates dropped, **472 rows written against 472
reported** — an exact match.

Four findings that drive the design:

1. **The HTML page beats the JSON API on both speed and completeness.** It is
   12x faster and carries the cup price and pack size the JSON endpoint omits.
   The tarpit on the JSON endpoint is *fixed per request* — throughput scales
   linearly with concurrency (measured: 1.17 req/s at 12, 2.92 req/s at 30), so
   it is a latency penalty, not a rate cap. Crawl HTML, not JSON.
2. **`price: 0` is real and means out-of-stock.** SKU `272150` returns
   `{"price": 0, "availability": "OutOfStock"}`. This is exactly the failure
   §6.4 forbids: map it to **null `price_aud` plus `is_in_stock = false`**,
   never to `0.00`. A zero here would silently drag any average downward.
3. **42% of the catalogue is not groceries.** Of 72,196 URLs, 30,256 have
   10-digit stockcodes and are third-party "Everyday Market" listings (sheet
   music, appliances). Core supermarket SKUs have 7-digit-or-shorter stockcodes
   and number **41,940**. Filter on stockcode length at enumeration time.
4. **The sitemap contains stale URLs.** A 404 rate of roughly 1-in-16 appeared
   in sampling. 404s are normal and must be counted in the manifest, not treated
   as errors.

### 10.2 Can a Lambda pull the entire catalogue?

Yes — but not in one Lambda, and it should not run daily. At the measured
6.3 req/s the full 41,940-SKU crawl is ~110 minutes and ~26 GB of transfer,
against a hard **15-minute Lambda timeout**. That forces fan-out:

```
  EventBridge (schedule)
        |
        v
  [enumerator]  4 GETs, ~1s: sitemaps -> filter short SKUs -> shard
        |                                        41,940 SKUs
        v
      SQS queue  (batches of ~500 SKUs)
        |
        +--> [worker] x N   concurrency ~8-10 each, parse, bounds-check
        |                   write part-NNNNN.csv to the run prefix
        v
  [finaliser]  write _manifest.json, then _SUCCESS
```

- **~20 workers** at 500 SKUs each finishes inside the timeout with margin.
- **Stay out of a VPC.** Default Lambda networking gives free public egress;
  a VPC would need a NAT Gateway and add real cost for zero benefit here.
- **Compute cost is negligible** (single-digit dollars/month); the real
  consideration is 26 GB of inbound transfer per full crawl, which is free to
  AWS but is load on Woolworths — see the cadence rule below.
- **Idempotency**: shard by SKU so a retried batch rewrites the same part file.
  `_SUCCESS` last, always (§3).

**Recommended cadence — do not full-crawl daily:**

| Scope | SKUs | Cadence | Runtime |
|---|---|---|---|
| Basket subcategories (the ~20 nodes the basket maps to) | ~2,000 | daily | ~5 min, single Lambda, no fan-out |
| Full core catalogue | 41,940 | weekly or monthly | ~110 min fanned out |
| Marketplace (10-digit SKUs) | 30,256 | never | not groceries |

The daily job is what feeds the site. The periodic full crawl exists to discover
new SKUs and to let you re-derive history under a changed selection rule (§8) —
that is the payoff for "capture, don't choose", and it does not need to be fresh
to deliver it.

### 10.2a DEPLOYED AND BLOCKED: AWS egress returns 403 (verified 2026-08-28)

The Lambda in `infra/terraform/lambda/category_crawler/` was deployed to
`ap-southeast-2` and invoked. **It cannot reach the endpoint from AWS.**

| Origin | Same code, same minute, same request | Result |
|---|---|---|
| Residential connection | `GET /apis/ui/browse/category` | **200**, `TotalRecordCount: 472` |
| Lambda (AWS egress IP) | identical request | **403 on page 1** |

Reproduced across two invocations. This is not rate limiting and not a transient
error — it is bot protection blocking datacenter IP ranges outright, and it is
precisely the risk §10.2 flagged ("assume it will be *worse* from Lambda's
shared egress IPs, not better").

**The pipeline behaved correctly under failure**, which is the one good outcome
here: the crawler broke on the 403 without retrying (retries are reserved for
429/5xx), wrote **no** CSV, wrote **no** `_SUCCESS`, threw so the CloudWatch
alarm fires, and left the bucket empty. No partial or wrong data entered the
archive. The failure was loud, which is the entire design goal of §3's
`_SUCCESS`-last rule and `DATA_SOURCING.md` §2.1.

**Do not attempt to defeat this.** Rotating IPs, routing through residential
proxy pools, or otherwise disguising the origin to get around a deliberate block
is exactly what `DATA_SOURCING.md` §2.2 rules out, and a 403 aimed at datacenter
ranges is an unusually explicit statement of intent. Relocating the crawler to a
non-datacenter IP purely to dodge the block is the same act wearing a different
hat — if that route is taken, it should be a decision made with open eyes, not
an implementation detail.

Honest options, best first:

1. **Ask Woolworths.** A commercial/API agreement is the only route that makes
   scheduled collection durable rather than adversarial.
2. **Buy the data.** Third-party grocery price aggregators exist and carry far
   lower legal risk than direct collection (already flagged in
   `DATA_SOURCING.md` §1 as worth a spike before building more scrapers).
3. **Use official public data.** The ABS publishes CPI and food price index
   series free, designed for exactly this use, and would source the site's
   headline "cost of living" trend without touching a retailer at all. It gives
   no per-SKU detail, so it complements rather than replaces §8.
4. **Keep the modelled/mock feed** as the site's permanent default, which is
   what it already is. Nothing about the site breaks — this was always the
   fallback, not a stopgap.

The infrastructure itself is sound and stays useful under any of these: the
schema, parser, dedupe, manifest and completeness guard are all verified against
472 real products and are retailer-agnostic. Only the network origin is blocked.

### 10.3 Standing constraints

`robots.txt` permitting `/shop/productdetails/` and publishing a product sitemap
is a meaningful signal that crawling those pages is anticipated — it is the
site's own machine-readable statement, and the design above deliberately uses
that surface and honours the `/shop/search` disallow. But **robots.txt is not
the Terms of Use**, and permission to crawl a page is not permission to
redistribute its prices. Everything in `DATA_SOURCING.md` §2.2 still holds:
crawl at a polite rate, no CAPTCHA solving, no IP rotation to evade blocks, no
scraping behind a login, and mock stays the permanent fallback. Full-catalogue
collection is a materially larger footprint than basket-scoped collection, which
is the main reason §10.2 recommends running it monthly rather than nightly.
Anyone taking this past a personal project should get a real legal read first.

### 10.4 Consequence for the current adapter

[`server/adapters/woolworths.js`](../server/adapters/woolworths.js) posts to
`/apis/ui/Search/products` — the one endpoint being reset. Its per-item
`try/catch` swallows the failure, so it degrades to mock data **silently**: the
exact failure mode `DATA_SOURCING.md` §2.1 warns about, already happening
today. Worth fixing regardless of whether the Lambda gets built.

---

## 11. Open questions

1. **Crawl breadth** — the full food catalogue (~40k SKUs, longer runtime,
   higher block risk) or only the subcategories the basket touches (~2k SKUs)?
   Full breadth is what makes "capture, don't choose" pay off later; narrow is
   safer to operate now. Recommendation: narrow but whole-subcategory — every
   SKU in the ~20 subcategories the basket maps to, and never a keyword search.
2. **Postcode set** — one pinned postcode to start (recommend `2000`), or a
   small panel of metro and regional postcodes for regional comparison?
3. **CSV vs Parquet** — CSV as specified is right for now: human-inspectable,
   zero dependencies, git-diffable samples. Revisit if the archive passes a few
   GB, at which point Parquet is a mechanical conversion, since the schema is
   already columnar and typed.
4. **Where L2 runs** — in the Express server at read time, or as a fourth Lambda
   writing a derived `basket_prices` dataset? The latter scales better and keeps
   the server dumb; the former is less machinery today.
