# Grocery list + savings receipt — execution plan

**Status:** plan only, written 2026-11-15. Nothing in this document is built yet.
**Companion docs:** [`ROADMAP.md`](../ROADMAP.md) (P3.7 "Watchlists / alerts — needs
accounts; last"), [`CROSS_RETAILER_MATCHING.md`](CROSS_RETAILER_MATCHING.md) (the
matcher this feature consumes), [`FIGMA_DESIGN_BRIEF.md`](FIGMA_DESIGN_BRIEF.md)
(the receipt metaphor).

The feature: every item can be added to a list; the list is a receipt grouped by
store, showing what the shop costs; where the same thing is cheaper at another
retailer, a yellow shelf-edge recommendation says so, and accepting it moves the
line to that store.

**This round's deliverable is the list logic, its tests, and a deliberately
unstyled page to click through.** The designed receipt is the round after.

---

## 1. The measured starting point

Measured 2026-11-15 against the committed archive (`DATA_SYNC=off`, newest capture
2026-11-14T18:32:15Z). These numbers decide what the feature can honestly say.

Measured against **what is on the shelf today** (any SKU of the item in its
retailer's live run). This is the honest denominator; measuring against every
item in the archive includes months of delisted seasonal lines and understates
coverage:

| | On shelf | Comparable match | Coverage |
|---|---|---|---|
| Fruit & veg | 771 | 170 | **22.0%** |
| Meat & seafood | 974 | 288 | **29.6%** |

Against every item the site currently lists, including off-shelf ones, it is
18.2% and 25.8% — see the `getItems` liveness gap in §10.

Of the comparable pairs:

| | Identical price | Genuinely different | Median diff | p90 | Max |
|---|---|---|---|---|---|
| Fruit & veg | 46 | 100 | 13% | 45% | 203% |
| Meat & seafood | 125 | 163 | 11% | 29% | 105% |

Net size (`netSizeValue` + `netSizeUom`) is present on **both sides of every
comparable pair** — 146/146 and 288/288. Same net size on both sides: 105/146
produce (72%), 169/288 meat (59%).

Three consequences the design must absorb rather than hide:

1. **Roughly three in four lines will carry no comparison at all.** "Not
   compared" is a designed state, not a gap.
2. **A third of comparable pairs are identical in price.** A recommendation must
   not fire on a zero saving.
3. **Two in five comparable pairs differ in pack size**, so the swap arithmetic
   in §4.3 is the normal path, not an edge case.

The top reasons a pair is not comparable, counted the same way:

| Reason | Produce | Meat |
|---|---|---|
| variety not yet known (lexicon gap) | 267 | — |
| no unit price on one side | 35 | 8 |
| priced per each here, per kg there | 46 | — |
| not in the retailer's latest capture | 15 | 33 |
| captured too far apart (capture skew) | 11 | — |
| listed unavailable at capture | — | 8 |
| no counterpart at the other retailer | — | 22 |

The single biggest lever on savings coverage is **the variety lexicon, not this
code**: 267 produce pairs are blocked on "we cannot yet tell which variety this
is". Curating those would raise coverage more than anything in this plan. It is
out of scope here and worth its own task.

---

## 2. Decisions

Locked in planning on 2026-11-15, with the reasoning, so a later reader knows
which are judgement and which are forced.

| # | Decision | Why |
|---|---|---|
| D1 | A line is `(retailer, sku, qty)` where qty is an integer **count of that size**. Cost = `qty × shelf price`. | Shelf price is 100% present; per-kg is not (92.8% / 99.6%). It also reads like a real receipt. |
| D2 | The receipt is **grouped by store**: one sub-receipt per retailer, each with its own subtotal, then a whole-list total. Lines keep the retailer they were added from. | Mirrors how a split shop actually happens, and generalises to N retailers for free. |
| D3 | A saving is **the cost of the real swap**: enough of the counterpart to get at least the same amount, packs rounded up. | Only a number you can actually pay at a till is shown. Feasible because net size is 100% covered on comparable pairs. |
| D4 | A line we cannot compare shows **its price plus a plain reason**, with a footer count. | Extends the `NotWired` honesty rule to the receipt. At 15–26% coverage, silence would read as "we checked and found nothing". |
| D5 | A line whose SKU has left the latest capture is **kept, flagged, and excluded from the subtotal**, which states its coverage ("covers 11 of 12 lines"). | Principle #2, loud failure over a quietly wrong total. |
| D6 | A recommendation is **acceptable**: an action re-points the line to the counterpart SKU, so it leaves one store's section and joins the other's. | Makes the savings pitch an action, not a fact. |
| D7 | The pricing logic is a **pure server module** plus a **stateless** `POST /api/list/price`. Persistence is `localStorage` for now. | See §7. The same code has to serve accounts, alerts and the weekly digest later; a Lambda cannot call client code. |
| D8 | **No retailer name is hardcoded** anywhere in the list module. | "We will get many more." Sections are derived from the lines present. |

---

## 3. What this feature is allowed to consume

The matcher shipped since ROADMAP v2.2 was written and is **already N-way**:
`matchesFor` returns "one entry per other retailer" off an index keyed
`match_key -> retailer -> [skus]` ([`matching/index.js:288`](../server/data/matching/index.js#L288)).
Extending to Aldi or IGA needs a crawler and a `nodes` entry in
[`categories.js`](../server/data/categories.js), not a change here.

Two constraints are load-bearing and must not be worked around:

- **Confidence levels are permissions, not labels.** Only `exact` /
  `comparable: true` may be compared. `strong` means show both, compare neither.
  `group-only` is a browse link.
- **`delta` is computed in exactly one place**, with the comment *"a client that
  can derive it can derive it for a pair that must not be compared"*
  ([`index.js:396`](../server/data/matching/index.js#L396)). The list module
  consumes that output; it never recomputes a comparison, and the client never
  computes money.

The list module therefore reads, and only reads:

- `getItems({ category })` — to resolve what was added
- `getProduct(retailer, sku)` — per line, giving `latest`, `isLive`, `matches`
- `basis.js` — `priceOn`, `basesOf`, `BASIS_ORDER`
- `categories.js` — `isPublicCategory`, so a hidden shelf (snacks is
  `public: false`) can never be priced into a public list

All in-process map lookups. No HTTP, no N+1 network cost; `O(lines)`.

---

## 4. The algorithm

### 4.1 Shapes

```
Line          { id, retailer, sku, qty }
PricedLine    { ...Line, name, size, unitPrice, lineCost, status, pricedOn,
                lastSeen?, notComparableReason?, recommendation? }
Section       { retailer, lines: PricedLine[], subtotal, pricedLines, totalLines }
Receipt       { sections, total, recommendations, savingsTotal,
                notCompared: { count, byReason }, capturedAt, coverage }
```

`status` is `'priced'` or `'not-on-shelf'` (D5). Only `'priced'` lines enter a
subtotal.

### 4.2 Money

**All arithmetic in integer cents**, converted once at the edge. Totals,
subtotals and savings are sums of cents; a float error that renders a $0.00
saving as "SAVE $0.01" is exactly the kind of wrongness this project treats as a
bug.

### 4.3 The swap

For a line at retailer A with SKU `a` and quantity `n`, and a match `m` to
retailer B whose counterpart is `b`:

```
if (!m.comparable) return null                  // permission, not preference

want   = netAmount(a) * n                       // normalised: g | ml | count
unit   = netAmount(b)
if (!want || !unit) return null                 // never seen in the archive; still guarded

buyQty = ceil(want / unit)                      // you cannot buy half a pack
got    = unit * buyQty
if (got / want > OVERSHOOT_BAND) return null    // 1.5, the band meat/weights.js already uses

swapCost = buyQty * priceCents(b)
saving   = lineCost - swapCost
if (saving < SAVING_FLOOR_CENTS) return null    // default 1; no $0.00 recommendations

return { toRetailer: m.retailer, toSku: b.sku, buyQty, swapCost, saving,
         overshoot: got - want }
```

Notes that matter:

- **`overshoot > 0` must be disclosed on screen** ("buys 500 g more"). A saving
  that requires buying more than you wanted is still a saving, but not silently.
- **Rejecting beyond the 1.5x band reuses an existing rule** rather than
  inventing a second size tolerance.
- **`each`-based pairs are 1:1 by construction.** `packCompatible` already
  refuses an each-priced pair whose pack weight, multipack count, bundle format,
  size grade or portion differ, so no rounding is possible or needed there.
- **`netAmount` is new and must not touch `packWeightGrams`.** That helper is
  load-bearing inside `packCompatible`, returns `null` below `PACK_GRAMS`, and
  handles only kg/g/ml/l. Extract a general `netAmount(p) -> { value, unit }`
  into a new `server/data/size.js` and leave the existing function's behaviour
  exactly as it is.

### 4.4 Determinism

Every ordering is specified, because an unstable receipt is untestable and makes
the page jitter between reloads for reasons that are not price:

- **Sections**: line count descending, then retailer name ascending.
- **Lines within a section**: insertion order.
- **Recommendations**: saving descending, then line id ascending.
- **Which counterpart**: whatever `matchesFor` already chose. The list does not
  re-rank candidates; `cheapestOn`'s stated tie-break already owns that.

### 4.5 List mutations (pure functions, all re-price after)

- `addLine(lines, { retailer, sku, qty })` — **merges on `(retailer, sku)`** and
  sums qty rather than creating a second line.
- `setQty(lines, id, qty)` — `qty <= 0` removes the line.
- `removeLine(lines, id)`
- `applyRecommendation(lines, id)` — re-points the line to `toSku` at
  `toRetailer` with `qty = buyQty` (D6). It then merges with an existing line for
  that SKU if one is already there.

The anchor is `(retailer, sku)` — the thing that was actually clicked, and an
immutable capture identity. This is deliberate: `match_key` is **L2 curated and
re-derived on every reload**, so a lexicon change rewrites it. Anchoring a saved
list on `match_key` would orphan lines whenever the lexicon improved.
Comparisons are resolved through `match_key` at render time; nothing durable is
keyed on it.

---

## 5. Honesty gates

A line may show a dollar saving only if **all** hold:

1. The match is `comparable: true` (`exact`).
2. Both sides are in their retailer's latest capture (`isLive !== false`).
3. Both sides were available at capture.
4. Capture skew is within the existing limit.
5. Net size is known on both sides.
6. The swap stays within the 1.5x overshoot band.
7. The saving is at or above the floor.

1–4 are already enforced by `matchesFor`; the list re-states them as assertions
rather than re-implementing them. 5–7 are new and belong to this module.

Anything failing 1–4 renders as D4: the price, plus `notComparableReason`
verbatim from the matcher. **The reason string is not rewritten by the client** —
it is written next to the rule that produced it and should stay that way.

---

## 6. API

```
POST /api/list/price
  body  { lines: [{ id, retailer, sku, qty }], includeHidden?: false }
  200   Receipt (§4.1)
        an unknown retailer/sku is reported on its own line, not as a 400 for the whole list
  400   malformed body
```

Stateless by design: it holds no list, so it is identical before and after
accounts exist. It respects `isPublicCategory`, so a hidden shelf cannot be
priced into a public list even if a SKU id is guessed.

`GET /api/status` gains a `list` block reporting comparable-match coverage per
category, so the numbers in §1 stop being something measured once by hand.

---

## 7. Why the logic is server-side, and what changes when accounts arrive

Server-side is the right answer **both now and later**, for three reasons.

1. The weekly digest (P3.3) and price alerts (P3.7) have to price a saved list
   with no browser in the loop. A Lambda cannot call client code.
2. Mirroring the comparison gates client-side duplicates exactly what the
   codebase warns against, and the second copy drifts.
3. The pricing module is pure, so it is testable today with `node --test` and no
   new dependency, while the client has no test runner at all.

What accounts change: **only storage.** Today `lines` live in `localStorage` and
are POSTed to be priced. With accounts they live in `lists` / `list_items` rows
and the same `priceList(lines, index)` runs against rows read from Postgres. The
pricing module, its tests and the endpoint are untouched. The migration path is
"we found a list on this device — save it to your account?", which is why the
anchor is a durable `(retailer, sku)` pair.

---

## 8. Test plan

The deliverable is verified by tests, not by eye. All under
`npm run test:server`, fixtures in the style of `matching/fixtures`.

**Not-comparable coverage — one fixture per reason measured in §1**

1. variety not yet known -> `group-only`, no recommendation, reason shown
2. no unit price on one side
3. per-each here vs per-kg there
4. counterpart absent from the latest capture (`isLive === false`)
5. capture skew beyond the limit
6. listed unavailable at capture
7. **the Coles `4433462` pack trap** — a 1 kg bag priced "1 each" against a
   single loose apple. This produced a live +527% reading once; it earns a named
   regression test.
8. multipack, bundle-format, size-grade and portion mismatches

**List arithmetic**

9. `qty × price`, multi-line subtotal, whole-list total, integer-cent exactness
10. equal net size -> dollar saving, `buyQty === qty`, `overshoot === 0`
11. rounding up -> 1 kg replaced by 2 × 500 g, saving computed after rounding
12. overshoot beyond the 1.5x band -> no recommendation
13. counterpart dearer -> no recommendation
14. **zero-delta pair -> no recommendation** (46 produce / 125 meat real cases)
15. delisted line -> kept, excluded from subtotal, coverage string correct
16. **three-retailer fixture (woolworths, coles, aldi)** -> three sections,
    correct subtotals, cheapest of three wins. This is the explicit proof of D8
    and the reason to write the module N-way from the start.
17. `applyRecommendation` moves the line between sections and merges on collision
18. `addLine` merges a duplicate SKU and sums qty
19. pricing twice is identical; section/line/recommendation order is stable
20. empty list, single line, a line whose SKU does not exist
21. a hidden-category SKU is refused even when named directly

---

## 9. Order of work

| Step | What | Done when |
|---|---|---|
| 1 | `server/data/size.js` — `netAmount`, unit normalisation | g/ml/count normalisation proven; `packWeightGrams` untouched |
| 2 | `server/data/list/price.js` — `priceList`, sections, subtotals, coverage | tests 9, 15, 19, 20 pass |
| 3 | swap + recommendations | tests 10–14, 16 pass |
| 4 | not-comparable passthrough | tests 1–8, 21 pass |
| 5 | `server/data/list/mutate.js` — add/setQty/remove/applyRecommendation | tests 17, 18 pass |
| 6 | `POST /api/list/price`, `/api/status` coverage block | endpoint returns a Receipt for a hand-written list |
| 7 | `client/src/lib/list/storage.js` — localStorage, versioned payload | survives reload; a corrupt payload degrades to empty, never throws |
| 8 | Add-to-list control on item cards; rough unstyled list page | a real list of real SKUs prices end to end in the browser |

Steps 1–5 are the actual deliverable. 6–8 make it clickable.

---

## 10. Risks and open items

- **Coverage is the feature's main limitation, and it is a data problem.** At
  15.2% / 25.8%, most lines say nothing. Curating the 267 variety-gap pairs is
  the highest-value follow-up and is not code.
- **The crawler's store-drift flag never reaches the loader.** `drift.py` records
  `store_changed` / `alarm` in the manifest (it fired on 24 Sep when the exit IP
  resolved to store 2631 instead of the pinned 1101 — 452 products instead of
  473), but `observations.js` reads only `complete` / `partial`. Savings computed
  off a drifted run compare two different shops. **Verify this before step 3**;
  if the flag is absent, surfacing it is a prerequisite, and it is the same gate
  the alerts in P3.7 will need.
- **Woolworths 18:00 runs do not earn `_SUCCESS`**, and the loader falls back to
  the newest partial. So evening pricing routinely runs against a partial
  Woolworths shelf, and SKUs the crawl missed appear as "not in latest capture".
  Expect the uncompared count to be visibly worse in the evening. That is honest
  behaviour, but it should be explained on the page, not discovered.
- **`match_key` churn** moves comparisons between reloads. Harmless by design
  (§4.5) — but a recommendation someone saw yesterday may be gone today, so the
  page must never imply a saving is durable.
- **The Figma frames were not available** when this was written (the connector
  needs authorization), so step 8 is deliberately unstyled and the designed
  receipt is planned from [`FIGMA_DESIGN_BRIEF.md`](FIGMA_DESIGN_BRIEF.md) plus
  the existing `--receipt` / `--ticket` tokens and `.receipt` styles in
  `Home.module.css`. The yellow recommendation is `--ticket: #ffd51f`, the
  shelf-edge SPECIAL ticket the brief already specifies.

---

## 11. Not in scope this round

Accounts and server-side persistence; the designed receipt; price alerts and the
weekly digest; multiple named lists; sharing a list; a "shop the whole list at
one store" optimisation; any retailer without a crawler behind it.
