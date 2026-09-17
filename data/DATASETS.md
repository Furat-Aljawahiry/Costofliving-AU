# Dataset Registry

Every dataset written by a collection Lambda gets one row here. This is the
index — the file shape itself is defined in
[`LAMBDA_OUTPUT_SPEC.md`](LAMBDA_OUTPUT_SPEC.md), and every dataset listed here
must carry that spec's spine columns (§4) regardless of what else it holds.

Adding a Lambda without adding a row here is how a pipeline becomes
undocumented. Add the row in the same change as the Lambda.

| Dataset | Status | Owning Lambda | Cadence | Schema | S3 prefix | Owner |
|---|---|---|---|---|---|---|
| `woolworths.products` | **deployed, blocked from AWS** (403 on datacenter IPs — spec §10.2a) | `costofliving-au-woolworths-category` | daily rule DISABLED | `1.1` | `s3://costofliving-au-data-207208119513/reports/supermarkets/woolworths/fruitAndVeg/` | — |
| `coles.products` | **built and verified locally, not yet deployed** — AWS egress unmeasured (COLES_DISCOVERY.md §5.4) | `costofliving-au-coles-category` | daily rule DISABLED (18:30 UTC, staggered) | `1.1` | `s3://costofliving-au-data-207208119513/reports/supermarkets/coles/fruitAndVeg/` | — |
| `supermarkets.products` | **built, OFF by default** — the optional union of the two above, written by the same invocation that writes them. `combined_output_prefix` is empty until someone wants it | `costofliving-au-fruitveg-category` | daily rule DISABLED (18:00 UTC) | `1.1` | `s3://costofliving-au-data-207208119513/reports/supermarkets/all/fruitAndVeg/` | — |

**Coverage so far**, each verified exact against the category's own reported count:

| Retailer | Category | Products | Pages | Verified |
|---|---|---|---|---|
| Woolworths | `Fruit & Veg` (`1-E5BEE36E`) | 472 / 472 | 14 | 2026-08-29 |
| Coles | `Fruit & Vegetables` (`/browse/fruit-vegetables`) | 481 / 481 | 11 | 2026-08-29 |

The two files carry **identical columns** — same 67-column header, written by
the same `crawler.to_csv` — into **separate prefixes**. That is deliberate while
Coles is being proven: a bad Coles run cannot contaminate the Woolworths series,
and the two are still joinable the moment anyone wants them joined.

`supermarkets.products` is that join available on demand, done at write time:
the same invocation that writes both per-retailer files can also concatenate the
rows it already has in memory into one CSV with the same header, under its own
prefix. `retailer` is a column, so the union needs no reshaping and cannot
disagree with the two files it came from.

It is **off by default** (`combined_output_prefix = ""`). Two CSVs, one per
retailer, is the collection deliverable; deciding which Woolworths row is the
same product as which Coles row is L2's job (§8.1) and has not been solved —
`canonical_product_key` is documented as the cross-retailer join key but
currently matches **0 rows** between the two files, because Woolworths populates
`variety` (260 of 472 rows) where Coles never does, and the two name their
products in different word order.

## The crawler

One codebase, one zip. A single invocation crawls one retailer or several: the
env var `RETAILERS=woolworths,coles` crawls every page of Fruit & Veg at both,
back to back, each into its own prefix and all under one shared `run_id`. Which
retailers run is configuration, not a fork of the code. Everything
retailer-specific is an adapter module; everything else, including the column
list and the CSV writer, is shared:

```
infra/terraform/lambda/category_crawler/
  crawler.py     shared: COLUMNS, to_csv, size/unit parsing, the crawl loop
  woolworths.py  adapter: fetch_page + build_row
  coles.py       adapter: buildId warm-up, fetch_page + build_row
  cheapest.py    shared derived report, retailer taken from the run
  taxonomy.py    shared: (sap_subcategory, product_name) -> one canonical produce group
  produce_lexicon.py  the vocabulary taxonomy.py reads product names with
  index.py       handler; crawls each retailer in RETAILERS, writes the union
```

Three Lambda functions share that one zip:

| Function | `RETAILERS` | Writes |
|---|---|---|
| `costofliving-au-fruitveg-category` | `woolworths,coles` | both per-retailer prefixes — this is the one the daily schedule should point at. Also the union, if `combined_output_prefix` is set |
| `costofliving-au-woolworths-category` | `woolworths` | Woolworths only — for proving one retailer in isolation |
| `costofliving-au-coles-category` | `coles` | Coles only |

Enable **one** schedule, not several, or the same categories get crawled more
than once a day. One retailer failing does not cancel the other: each is written
and reported independently, and the invocation raises at the end — after the
good data is in S3, and still loudly enough to trip the error alarm.

Two entrypoints share all of it, so local and deployed output cannot drift:

- **Lambda** — `infra/terraform/lambda/category_crawler/index.py`, writes to S3.
- **Local CLI** — `data/scripts/crawl_category.py`, writes to `data/out/`.

```bash
python data/scripts/crawl_category.py --retailer coles
python data/scripts/crawl_category.py --retailer woolworths

python data/scripts/crawl_category.py --retailer woolworths   --category 1_D5A2236 --url /shop/browse/poultry-meat-seafood --name "Poultry, Meat & Seafood"

python data/scripts/crawl_category.py --retailer coles   --url /browse/fruit-vegetables/vegetables/potatoes --name "Potatoes"
```

Woolworths node ids come from `GET /apis/ui/PiesCategoriesWithSpecials`. Coles
needs no node id — the browse path *is* the identifier — and its full category
tree, with per-node product counts, rides along inside every page it returns.
The script writes a CSV, a cheapest-by-subcategory CSV and a `.manifest.json`
beside it, per spec §3.

Tests, all runnable on their own:

```bash
python infra/terraform/lambda/category_crawler/produce_lexicon.py # offline, word lists coherent
python infra/terraform/lambda/category_crawler/taxonomy_test.py   # offline, both tiers
python infra/terraform/lambda/category_crawler/coles_test.py      # offline, incl. column parity
python infra/terraform/lambda/category_crawler/cheapest_test.py   # offline
python infra/terraform/lambda/category_crawler/proxy_test.py      # offline
python infra/terraform/lambda/category_crawler/batch_test.py      # offline, both-retailers invocation
python infra/terraform/lambda/category_crawler/handler_test.py    # needs network, both retailers
```

## Joining the two retailers: `canonical_group`

`sap_subcategory` cannot join the two files. Measured on the 2026-09-04
captures, Woolworths files Fruit & Veg under 43 subcategories and Coles under
87, and **only 10 share a name** — the rest are the same produce at different
grain:

| Woolworths | Coles |
|---|---|
| `POTATO` | `BRUSHED POTATOES`, `WASHED POTATOES`, `RED POTATOES`, `BABY POTATOES` |
| `CITRUS` | `LEMONS`, `LIMES`, `ORANGES`, `GRAPEFRUIT`, `OTHER CITRUS`, `IM PERFECT CITRUS` |
| `BLUEBERRY`, `RUBUS AND OTHER BERRY`, `STRAWBERRY` | `BERRIES` |

`taxonomy.py` is the join: an ordered regex table mapping **both** retailers'
subcategories into one shared vocabulary, rather than treating either
retailer's names as canonical — the mapping is many-to-many in both directions,
so picking a side would throw away the other's distinctions.

It classifies in **two tiers, strict order**:

1. **Subcategory** — the retailer's own classification of its own product.
   Stable, low-cardinality, and it wins whenever it is specific.
2. **Product name** — consulted *only* when tier 1 lands in a bucket that names
   the department, a brand or an attribute rather than the item. On 2026-09-04
   that was 131 of 953 rows: Coles `VEGETABLES` (31), `NATOORA` (13), `BUNCH`
   (9), `FRUIT`/`FRUITS` (17), `MIXED` (1), and Woolworths `ORGANICS` (60) —
   plus both retailers' `SALAD` buckets, which hold `Potato Salad` and
   `Whole Fresh Beetroot` alike. Every one carries a name that says what it is.
   The vocabulary is `produce_lexicon.py`; the matcher is
   `taxonomy.classify_product`. Tier 2 is a **fallback, not a second opinion**:
   where a specific subcategory and the name disagree (Coles files garlic and
   ginger under `HERBS`), the subcategory stands.

`cheapest-by-subcategory.csv` carries the result as three appended columns
(schema `1.2`):

- **`canonical_group`** — `potatoes`, `citrus`, `berries`, … Group on this to
  compare the retailers; it is an *annotation*, not the grouping key, so
  "washed potatoes are $2.23/kg" is not lost to a single potatoes number.
- **`group_kind`** — `produce` · `prepared` · `non_produce` · `unclassified`.
  Filter to `produce` for an index. This is what keeps Coles' `ALMONDS`,
  `FLORAL` and `SAUCES` — all shipped inside its Fruit & Vegetables browse node
  — out of a fruit-and-veg series. `salads` is `prepared` (a salad kit tracks
  labour and packaging, not lettuce) but keeps its own group so salad prices
  stay readable as a series.
- **`group_source`** — `subcategory` or `product_name`. Which tier named the
  group. A name-derived group is a good guess, not a retailer fact; this is
  how a consumer picks those rows out and measures the fallback on its own.
  `manifest.cheapest_by_subcategory.rows_by_group_source` carries the count.

Coverage on 2026-09-04: **34 produce groups present at both retailers**.
Woolworths files 38 of 43 subcategories as produce, Coles 62 of 87 (both down
by one from before: `SALAD`). Across the two captures tier 2 resolved
**131 of 131** rows tier 1 could not — 130 to produce, the rest to prepared or
non-produce — and moved **no** row whose subcategory was already specific.

One limit, reported rather than hidden.
`manifest.cheapest_by_subcategory.unmapped_subcategories` lists any subcategory
no rule matched. It is reported even when tier 2 rescued every row under it:
the name is a fallback, and a new bucket still needs a rule. Empty today.

## Status values

- **planned** — specified, not built.
- **active** — running on schedule, output trusted.
- **degraded** — running but producing `partial` runs, or a known field is
  unavailable. Consumers should still read it; treat gaps as unknown.
- **retired** — no longer running. Historical files remain readable and are
  never deleted.

## Adding a dataset

1. Confirm the output conforms to [`LAMBDA_OUTPUT_SPEC.md`](LAMBDA_OUTPUT_SPEC.md)
   §4 (the spine) — those columns are mandatory in every dataset.
2. Name it `<retailer>.<kind>`. One Lambda, one dataset, one file shape.
3. Add the row above, including the schema version you are writing.
4. On a **minor** schema bump (additive columns only), update the `Schema`
   cell. On a **major** bump, add a new row with a new S3 prefix rather than
   editing the old one — old files keep their old shape forever.
