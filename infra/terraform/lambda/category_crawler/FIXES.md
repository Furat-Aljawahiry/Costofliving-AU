# Crawler audit — defects found and fixed

Audit of `crawler.py`, `woolworths.py`, `coles.py`, `cheapest.py`, `proxy.py`,
`secrets_store.py` and `data/scripts/crawl_category.py` against
[`LAMBDA_OUTPUT_SPEC.md`](../../../../data/LAMBDA_OUTPUT_SPEC.md) and
[`COLES_DISCOVERY.md`](../../../../data/COLES_DISCOVERY.md).

Every defect below was reproduced before it was changed, most of them against
the two real captures in `data/out/` (472 Woolworths rows + 481 Coles rows).
Numeric changes were regression-tested by replaying `derive_unit_prices` over
all 953 archived rows with the old and the new code and diffing: the old replay
reproduces the published files exactly, and the new one differs on **6 rows,
all of them the defect in Critical 1**. Nothing else in either file moves.

---

## Critical

### 1. `crawler.derive_unit_prices` — two `price_per_*` columns on one row

**Wrong.** Spec §6.4: *"Exactly one of the three `price_per_*` columns is
populated per row"*, and each is *"populated when `net_size_uom` = kg / L / ea"*.
The function seeded the three columns from the retailer's cup price, then
derived `price / net_size_value` into the pack's own basis whenever that basis
was still empty. When the retailer quotes a cup price on a **different** basis
to the pack size we parsed, both fire and two columns come out populated.

**How it showed up.** 6 of 481 rows in the measured Coles Fruit & Veg capture:

| SKU | name | size | cup | published |
|---|---|---|---|---|
| 1000190 | Organic Japnut Pumpkin | `700g` | `$6.20/ 1ea` | kg `8.8571` **and** ea `6.2000` |
| 4433462 | Royal Gala Apples 1kg | `1 each` | `$7.90/ 1kg` | kg `7.9000` **and** ea `7.9000` |
| 1504510, 1504564, 1593430, 6391046 | | | | same shape |

`cheapest.py` reads the first populated basis in kg → L → ea order, so a row
whose `net_size_uom` is `ea` was silently entering the **per-kg** series of its
subcategory and being compared against loose produce priced by weight. That is
the one thing spec §3.3 says must never happen ("a `min()` across bases returns
whichever number is smaller, which is not a price").

**Changed.** The pack's own basis wins. When the cup price's basis disagrees
with `pack["net_uom"]`, the cup-derived value is dropped, the row is derived on
its own basis, and a new `CUP_PRICE_BASIS_MISMATCH` code goes into
`parse_warnings`. The retailer's own figure is untouched in `unit_price_raw`,
`unit_price_value` and `unit_price_measure`, so the drop is fully re-derivable
from L0 (spec §9.4) if the call is ever judged the other way.

The `cup_treats_pack_as_one` guard now also requires that the per-each figure
actually survived that drop — otherwise a multipack sized in kg/L but cup-priced
`/1EA` would lose its cup value to the drop *and* have its derivation suppressed,
leaving the row with no unit price at all.

**Effect on the archived Coles capture:** `APPLES/kg` loses one candidate
(12 → 11) and a new `APPLES/ea` row appears. No headline winner in any of the
88 groups changes.

### 2. `crawler.cup_to_canonical` + `derive_unit_prices` — cup price of `0`

**Wrong.** `cup_to_canonical(0.0, "1KG")` returned `{"per_kg": 0.0}`. Two
consequences, both bad:

- `price_per_kg_aud` is written as `0.0000` — the exact failure spec §6.4 calls
  out for `price_aud` ("a `0.00` in this column is always a bug"), and the one
  value guaranteed to win any `MIN()` and drag any average to the floor.
- `derive_unit_prices` then divides by that zero in its 5% cross-check:
  `abs(derived - target) / target` → **`ZeroDivisionError`**, which propagates
  out of `build_row` and kills the whole page, not just the row.

Reproduced directly:
`derive_unit_prices(2.0, parse_package_size("500g"), {...}, cup_to_canonical(0.0, "1KG"))`
→ `ZeroDivisionError: float division by zero`.

**How it showed up.** Not present in the two archived captures (no cup price of
0 in Fruit & Veg), but Woolworths demonstrably sends `Price: 0` as its
out-of-stock marker (spec §10.1 finding 2) and `CupPrice` travels with it; the
first category that carries one takes the Lambda down with an unhandled
exception and no CSV.

**Changed.** `cup_to_canonical` treats a non-positive cup value as no value at
all. The comparison in `derive_unit_prices` is now `if target:` rather than
`if target is not None:`, so a zero can never be a comparison base even if one
reaches it by another route.

---

## Moderate

### 3. `woolworths.build_row` — `was_price_aud` published on rows with no price

**Wrong.**
`float(was_price) if was_price is not None and float(was_price) != price else None`.
Woolworths echoes `WasPrice == Price` when nothing is marked down, so the
`!= price` test is what separates a real pre-promotion price from that echo. But
by the time it runs, `price` has already been set to `None` for out-of-stock
lines (`Price: 0`), and `5.00 != None` is trivially true. A `WasPrice` of `0`
also passed straight through, unlike the Coles adapter which requires `> 0`.

**How it showed up.** 33 of 472 rows in the archived Woolworths capture carry a
`was_price_aud` with an empty `price_aud`, `is_on_special = false` and
`is_in_stock = false` — e.g. SKU 105931 "Woolworths Fresh Onion White",
`was 5.00`, no price. Spec §6.4 defines the column as *"pre-promotion price when
on special"*, so the file was stating a discount that does not exist on 33 rows,
against a current price it also says is unknown. All 8 genuinely-on-special rows
and the one legitimate `is_on_special = false` markdown (SKU 218235, 4.50 → 4.00)
are unaffected.

**Changed.** `was_price_aud` is emitted only when there is a current price to
have been reduced from, the was-price is `> 0`, and it differs from the current
price. Verified on a fresh 2-page live capture: 0 rows with a was-price and no
price.

### 4. `crawler.fetch` — backoff sleeps after the final attempt

**Wrong.** `time.sleep(attempt * attempt)` ran at the bottom of every iteration
including the last, so a request that had exhausted its retries still slept 9s
before raising. The code's own comment says `# 1s, 4s`, i.e. two sleeps between
three attempts.

**How it showed up.** 14s instead of 5s per permanently-failing request. Against
a fully blocked category this is 9 wasted seconds *per page*, out of a 15-minute
Lambda budget, before the run can fail loudly — which is the behaviour spec
§10.2a praises. `proxy_test.py` measured 15s before, 6s after.

**Changed.** `if attempt < MAX_RETRIES:` around the sleep.

### 5. `coles.build_row` — `AttributeError` on a null `imageUris` entry

**Wrong.** `(p.get("imageUris") or [{}])[0].get("uri")` guards a missing or
empty list but not a **null element**, which the sibling line for `onlineHeirs`
one block above does guard (`... [0] or {}`). Reproduced:
`build_row({... "imageUris": [None]})` → `AttributeError: 'NoneType' object has
no attribute 'get'`.

**How it showed up.** One null image entry in a payload we do not control takes
out the whole page — `build_row` is called inside the page loop with no
per-product `try`, so the exception escapes `crawl_category` and the run dies.

**Changed.** `((p.get("imageUris") or [{}])[0] or {}).get("uri") or ""`.

---

## Minor

### 6. `coles.build_row` — image URL concatenated, not joined

**Wrong.** `f"{assets}{image}"` where `assets` comes from the response's own
`pageProps.assetsUrl`. Correct only while that base has no trailing slash — a
base we do not control. A trailing slash puts `…/productimages//4/4199503.jpg`
on every row of the run.

**Changed.** Base is `rstrip("/")`-ed and joined with exactly one separator.
Byte-identical output for the measured payload (`coles_test.py` pins the exact
URL and still passes).

### 7. `woolworths` / `coles` `build_row` — `CUP_PRICE_UNPARSED` was never emitted

**Wrong.** Spec §6.6 defines `CUP_PRICE_UNPARSED` as one of the warning codes,
and §6.6's whole point is *"this column is how you find out your parser broke
before a chart does"*. Nothing in either adapter ever emitted it, so a cup
string in a shape `parse_cup_string` cannot read was lost in silence — the row
just came out with empty unit-price columns, indistinguishable from a product
that has no cup price at all (33 Woolworths rows and 3 Coles rows genuinely
have none).

**Changed.** Both adapters warn when the retailer sent a cup / comparable string
**and** neither a value nor a measure came back out of it. 0 rows in either
archived capture and 0 in a fresh live capture are affected — this is a detector,
not a reclassification.

---

## Found, deliberately not fixed

- **`canonical_product_key` joins nothing across retailers.** `coles.py` says
  the hash "is the only thing left that can group the two retailers' rows, now
  that GTIN is gone, so the formula must stay identical on both sides", and
  COLES_DISCOVERY §4 says the same. The formula *is* identical; the inputs are
  not. Measured over the two real files: **0 keys in common** (461 distinct
  Woolworths keys, 466 Coles). Dropping `variety` (populated on 260/472
  Woolworths rows, never at Coles) gives 0. Dropping brand as well gives 6,
  because the names differ by word order ("Sweet Potato Gold" vs "Potatoes Sweet
  Gold"). Not a code defect — spec §8.1 mandates name tokens, brand, variety and
  the flags, and the code implements exactly that. But the claim that this
  formula keeps the two retailers groupable is false in practice, and tier-3
  matching (§8.1) needs a real matcher, which is L2's job. **This is the finding
  most worth acting on next.**
- **Bounds-check rejections are not in the manifest.** Spec §6.4 says a row
  priced below `$0.10` is *excluded from the CSV and recorded in
  `_manifest.json` `rejections`*. Both adapters instead keep the row, null the
  price and add `PRICE_OUT_OF_BOUNDS` to `parse_warnings`; `crawl_category`
  builds no `rejections` block at all. Fixing it means plumbing a rejection
  channel from `build_row` through `crawl_category` into the manifest — a
  structural change, and the task scope forbids restructuring.
- **`cheapest.py` groups on `(sap_department, sap_category, sap_subcategory,
  basis)`**, where spec §3.3 says *"one row per (`sap_subcategory`,
  `unit_basis`)"*. No duplicate `(subcategory, basis)` pair exists in either
  archived report, so today they agree. Left as-is deliberately: the current key
  is the safer of the two, since collapsing it would merge two genuinely
  different merchandise paths that happen to share a subcategory name.
- **`sold_by` is not derived the same way by the two adapters.** Coles overrides
  it to `weight` on `pricing.unit.isWeighted`; Woolworths has no such field and
  falls through to pack shape, so the same product ("Approx. 500g" sweet potato)
  is `weight` at Coles and `pack` at Woolworths. Aligning them means either
  inventing an `isWeighted` equivalent for Woolworths or dropping Coles' real
  signal; both change the meaning of a spec §6.3 enum on live data with no
  measurement to justify the direction.
- **`proxy.Session.close()` degrades to direct egress.** `http_get_text` picks
  `session.opener if session and session.opener else build_opener()`, so a
  request on a closed session silently egresses from the host's own IP instead
  of raising. Unreachable in the current flow — `crawl_category` closes the
  session only after the loop — so it is a latent footgun, not a live defect.
- **`crawl_category` has no page cap when `total_count()` returns `None`.**
  Termination then rests entirely on a page eventually coming back empty. Both
  live endpoints do that today (verified in the archived runs). If one ever
  clamps out-of-range pages to the last page instead, the loop runs until the
  Lambda times out. That failure is loud (no `_SUCCESS`, alarm fires), and
  guessing at a cap risks truncating a legitimately large category.
- **Woolworths `TotalRecordCount` vs skipped marketplace rows.** `complete`
  requires `len(rows) == total`. Marketplace tiles are skipped by design, so if
  `TotalRecordCount` counts them, any category containing one can never be
  `complete` and never earns `_SUCCESS`. `market_products_skipped` is 0 in the
  measured category, so which way the count goes is unverified — and guessing
  wrong either suppresses `_SUCCESS` or grants it to a short crawl.
- **`manifest.capture_context.egress_country` is `"aws"` for any direct run**,
  including one from a laptop (both archived manifests say so). Cosmetic; the
  crawler genuinely cannot tell where it is running, and `egress: "direct"` on
  the same object is accurate.
- **`fetch` rotates the exit IP on its final attempt too**, burning a session id
  it will never use. Harmless (no I/O, just a new username) and pinned by
  `proxy_test.py`'s `assert s403.rotations == 3`, so changing it would mean
  changing a test that is asserting deliberate behaviour.
- **`crawl_category` counts `market_products_skipped` before the SKU dedupe**,
  so a marketplace tile repeated across pages inflates the count. Manifest
  bookkeeping only; no row is affected.
- **`CUP_PRICE_BASIS_MISMATCH` (added by Critical 1) is not in spec §6.6's list
  of codes.** §6.6 says the list extends additively and both adapters already
  emit unlisted codes (`PROMO_MULTIBUY`, `PRICE_MISSING`), so this follows the
  established pattern — but the spec should be updated to list all four.
- **`proxy_test.py`'s docstring is now stale.** It says the run takes ~15s and
  walks "1s + 4s + 9s"; after Moderate 4 it takes ~6s and walks 1s + 4s. The
  test asserts nothing about timing and still passes; the test file was left
  untouched rather than edited to match a fix.

---

## Test results after the fixes

```
python coles_test.py      -> 35/35 PASS, exit 0
python cheapest_test.py   -> 18/18 PASS, exit 0
python proxy_test.py      -> 14/14 PASS, exit 0   (6s in backoff, was 15s)
python batch_test.py      -> 20/20 PASS, exit 0   (offline; fakes crawl_category)
python handler_test.py    -> 11/11 PASS, exit 0   (live; Woolworths crawled,
                             Coles skipped — its HTML surface was serving the
                             Imperva interstitial, which is the environment
                             condition COLES_DISCOVERY.md §5.3 describes and
                             which the test is written to skip)
```

No test encodes behaviour contradicted by these fixes; none was modified.
