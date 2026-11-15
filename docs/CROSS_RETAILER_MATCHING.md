# Cross-retailer product matching — implementation plan (P2.1)

**Status:** IMPLEMENTED 2026-09-26 (phases 0-6; 7 partial) · **Drafted:** 2026-09-25 · **Implements:** ROADMAP P2.1
**Scope:** fresh produce only (`group_kind === 'produce'`). See §3.4 for why this key does not extend to packaged goods.
**Unblocks:** P2.2 (basket), P2.3 (series), the Coles-vs-Woolworths panel on every product page

> The user-visible goal, stated concretely: on `#/product/woolworths/310968`
> ("Woolworths Fresh Pink Lady Apples Punnet") the **Price now** panel shows a
> real Coles price for Pink Lady apples, with a link out to the Coles product —
> and the same panel on the Coles page links back to Woolworths.

Today that panel renders a `NotWired` placeholder reading *"cross-retailer
product matching (canonical keys don't match across retailers yet)"*
([Product.jsx](../client/src/pages/Product.jsx)). This document is the plan to
remove that placeholder honestly.

---

## 0. What shipped, and what the numbers came out at

Implemented 26 Sep 2026, then audited and corrected (§0.2). Phases 0-6 are in;
phase 7 is partial (`overrides.js` is wired and tested but empty, and the metrics
are on `/api/status` rather than on a page, because the P1.3 data-quality page
does not exist yet).

| | files |
|---|---|
| Basis | `server/data/basis.js` (new) |
| Matching | `server/data/matching/{index,groups,varieties,vetoes,overrides}.js` (new) |
| Fixture + tests | `server/data/matching/fixtures/adversarial.json`, `matching.test.mjs` (new) |
| Wiring | `server/data/observations.js`, `server/data/produceNames.js` |
| UI | `client/src/pages/Product.jsx`, `Product.module.css` |

`npm run test:server`: **154 passing** (was 65 before this work).

### 0.1 Coverage

Two denominators, because they answer different questions and mixing them
flatters the result. Measured on the 16 Sep 2026 captures, the same pair the
baseline was measured on:

| | Woolworths | Coles |
|---|---|---|
| Baseline — exact `itemKey` join, as a share of **all rows** | 109 items · 27% | 24% |
| Shipped — as a share of **all rows** (same denominator) | 164/472 · **35%** | 141/488 · **29%** |
| Shipped — as a share of **produce rows**, which is all that is matchable | 164/353 · **46%** | 141/316 · **45%** |

Over the whole archive (1,063 products): **125 match keys** present at both
retailers, 183 Woolworths and 154 Coles products matched, 113 Coles→Woolworths
and 104 Woolworths→Coles comparisons that are actually comparable.

**Recall was traded away for precision, deliberately and twice.** `matchedKeys`
peaked at 161, and each correctness fix below pushed it down — 161 → 145 → 126 →
125. A wrong "cheaper at Coles" is the failure mode this project can least afford,
so the number going down was the work succeeding, not regressing.

### 0.2 What the audit found — two criticals

Both were live, both produced a wrong number on a real page, and neither was
caught by the tests written alongside the implementation.

**The per-each trap was only half-closed.** §3.3.1 rule 2 guards per-each
comparisons using `multipack`, and that caught the Grab N Glow 6-pack only because
Coles wrote "6 Pack" in `package_size_raw`. The same trap with a **weight in the
name** was wide open:

| | listing | columns | price |
|---|---|---|---|
| W `155003` | Apple Royal Gala | one loose apple | $1.26 **/ea** |
| C `4433462` | Royal Gala Apples **1kg** | `package_size_raw` "1 each", `net_size` "1ea", `sold_by` each | $7.90 **/ea** |

Nothing structured gives the kilo away — it exists only in the product name. Both
sides had `multipack: null`, shared basis `each`, so the guard passed and the page
rendered **+527%**, i.e. "84% cheaper at Woolworths", on the Coles side. Fixed by
propagating `nameWeight` (parsed all along but never carried onto the product) and
adding a pack-weight test to `packCompatible`, with a unit test.

**The expiry rule suppressed almost the entire Coles half of the feature.** §6.3
rule 1 picked "the newest **complete** run" per retailer. Because no Woolworths
run has earned `_SUCCESS` since 22 Sep (P0.3), the newest Woolworths run is always
the 18:00 partial, so the rule reached back to 06:00 and marked **564 of 568**
Woolworths products "not on the shelf today". Every Coles page therefore refused
to show Woolworths: **4 of 202 comparable**. Fixed to use the newest run whatever
its status — a partial run is a real observation of what it reached, and absence
from one is reported (`liveRunFromPartial`) rather than trusted. Coles→Woolworths
comparability went 4 → 113.

### 0.3 Match quality — what eyeballing found, in two rounds

Reviewing matched keys by hand is the single highest-yield check in this work, and
it found a systematic fault each time.

**Round one: a bare head-noun variety is a catch-all, and a catch-all pairs
unrelated things.**

| key | Woolworths | Coles |
|---|---|---|
| `mushrooms:mushroom` | Mushroom Sliced | **Dried Porcini** Mushrooms |
| `chillies:chilli` | **Bird's Eye** Chilli Hot | Red **Cayanne** Chillies |
| `potatoes:potato` | **Mashing** Potatoes | **Roasting** Potatoes |

In each case the name carried a real distinguishing word the lexicon did not know,
so both sides fell through to the base and met each other there. Deleting base
varieties was not an option — `Macro Organic Banana` ↔ `Organic Banana` is a
genuine match that needs one. Hence the **residual rule**: a variety is only
trusted when the name has no tokens left that nothing accounted for.

**Round two: the residual rule was wrong in both directions at once.**

- *Too narrow.* It was gated on a list of base slugs, and **no herb slug was in
  it**, so `basil` was an unguarded catch-all: a "Cold Blended Paste 80g" matched a
  "Lightly Dried Sachet 10g" at **+692%**. Every herb key paired a ~$53/kg paste
  against a ~$220-420/kg punnet. Same hole for `medjool`, which paired a coconut
  date roll with plain dates.
- *Too strict.* The accounted set left out **the group's own head noun**, so
  `honeydew|melon` had residual `{melon}` and two **byte-identical** "Honeydew
  Melon Whole" listings refused to match. Cherry and grape tomatoes failed
  identically, because those slugs are base varieties of *other* groups. Most of
  the "tomatoes gap" `varietyGaps` was reporting as missing vocabulary was this
  bug.

The rule now applies to every variety and accounts for the matched tokens, the
group's head nouns, and a short list of presentation words. Processed forms are
handled where they belong — in VETO — which exposed a third fault:

**VETO was dead for 87% of rows.** It ran only in the name fallback, on the
reasoning that the Lambda's verdict already encoded it. It does not: the
subcategory table resolves ~87% of rows, so those rows were never vetoed at all,
and `Mushroom Dry Shiitake 20g` (a $175/kg pantry good) was keyed as fresh
shiitake against a $69/kg punnet. VETO now runs before any taxonomy lookup, which
is also what the Python side does — `taxonomy.KIND_PRECEDENCE` puts `prepared`
ahead of `produce`, because a name saying "dried" outranks a shelf saying
"mushrooms".

**And the subcategory table mis-filed whole shelves.** Coles files rhubarb,
silverbeet, fennel, radish, spinach, beetroot and kale under `BUNCH`, whose
cheapest row happened to be an onion — so all of them resolved to `onions` and
could never match their Woolworths counterparts. §3.1's promised cross-check is now
implemented and *used* rather than logged: when the name names a group of its own
and the table disagrees, the name wins (`groupSource: 'name-over-map'`, 62 rows).

Net effect on the implausible-delta count — comparisons more than 70% apart, which
are usually a matching error rather than a bargain: **10 → 3**, and the three that
remain (a 2kg onion bag against a 1kg bag, a beetroot bunch against loose
beetroot) look like real bulk and format differences.

Smaller findings, all now vocabulary or ordering: gold/green/SunGold kiwifruit were
one key; `Mini Red Cabbage` sat with whole red cabbage; **Coles misspells "Cayanne"
in the live data**, so the lexicon carries the misspelling rather than fuzzy-matching
every token in the file; `garlic` ranked `clove` above `head`, so a 3-pack of garlic
heads was keyed as cloves; Vietnamese mint and lemon thyme were mint and thyme;
green and brown nashi pears were one key; and `Paw Paw` could never reach its own
lexicon entry because both words share a singular and deduped to `paw`.

### 0.4 Other corrections made during implementation

- **`group-only` was rendered as a price card.** 427 of them. On a japnut
  pumpkin's page the Woolworths card printed **$2.61 "Butternut Pumpkin Cut"** in
  the big-price slot with "NOT COMPARED" beside it. §3.3 says group-only is a
  browse link, never a comparison; a headline price for a different variety is not
  a browse link. It now renders a list of names with no prices at all.
- **The `alternatives` "bug" in §4.1 was correctly re-diagnosed, then found again
  elsewhere.** `getItems` was picking `bestSku` on one basis and silently dropping
  every SKU on the other — 29 items affected.
- **Three fixture expectations were wrong, not the code.** `Potato Red Washed` is
  `potatoes:red-washed`; `Baby Washed Potatoes` is `potatoes:baby-washed`;
  `Bananas Kids` is its own lunchbox line.
- **Tie-breaking by slug name was wrong.** `Mushroom Portobello Flat` matched both
  `portobello` and `flat` at one token each, and alphabetical order lost the
  cultivar. Order within a group is now load-bearing: most identifying first, bare
  head noun last.
- **`canonical_group` is still derived in JS, contrary to §3.1's recommendation.**
  The Lambda change (additive schema 1.2) has NOT been made, because the existing
  archive has no such column and matching had to work on the data on disk today.
  What shipped reads the group out of the **cheapest file's own rows** — the
  Lambda's own verdicts — which resolves 87.5% of Woolworths rows and 85.0% of
  Coles rows with no vocabulary duplicated. `groupFor` already prefers
  `product.canonicalGroup` when present, so emitting the column later retires the
  fallback without a rewrite; `groupSources` on `/api/status` is how you would see
  that happen.
- `groups.js` had been written with a literal NUL byte as its map separator, which
  made grep class the module as binary. Rewritten with `String.fromCharCode(0x1f)`.

### 0.5 Still open

**Data rulings that need a human are queued in
[PRODUCE_DATA_TODO.md](PRODUCE_DATA_TODO.md)** — questions the captures cannot
answer (is an unqualified cabbage the green one? is a "snacking tomato" its own
product?). The matcher refuses rather than guesses, so each open item there is a
pair sitting unmatched until someone rules.

- The **921-row golden file** (§5.1) is not written. The adversarial fixture is,
  and it is what drove development — it caught three lexicon design faults on its
  first run. The golden file should now be generated from the settled lexicon and
  reviewed.
- `#/cheapest` and the **category grid badge** (§6.2). `/api/items` carries
  `matchKey` and `matchedRetailers`; nothing renders them yet.
- The **Lambda schema 1.2** change (§3.1).
- **`varietyGaps` is the to-do list.** Read it with §0.3's caution: some of what it
  reports is the residual rule declining to guess, which is correct behaviour, not
  missing vocabulary. Herbs and leafy-greens are dominated by pastes and bagged
  salad blends, which are arguably `prepared` rather than unvocabularied.
- **A basket of known-good and known-bad pairs would be worth more than more
  vocabulary.** Every fault in §0.3 was found by a human reading a list; none was
  found by a test. That asymmetry is the strongest argument for the golden file.

---

## 1. What is actually true today (measured, not assumed)

Every number below was measured against the 16 Sep 2026 captures
(`data/out/woolworths_fruit-veg_2026-09-16.csv`, 472 rows;
`coles_fruit-vegetables_2026-09-16.csv`, 488 rows).

| Asset | State | Evidence |
|---|---|---|
| `canonical_group` (coarse: `apples`, `potatoes`) | **Works cross-retailer — but only after filtering `group_kind === 'produce'`.** Filtered: 35 W / 34 C, **34 overlap**, 0 Coles-only. **Unfiltered: 37 W / 42 C, 36 overlap, and 6 Coles-only groups** — `floral`, `nuts`, `seasonal`, `sauces`, `snacks`, `dried-fruit` (16 `non_produce` rows) | [`buildWall`](../client/src/lib/cheapest.js) applies that filter; the 34/0 figure is a consequence of it, not a property of the data |
| …but only in the **cheapest** dataset | **Absent from the products dataset**, along with `group_kind` and `group_source`. The product page has no group at all | The products header has 69 columns and none of the three |
| `canonical_product_key` (fine-grained hash) | **Useless across retailers. 0 overlap** of 461 W × 473 C keys | Spec §8.1 claims it is retailer-independent; in practice the hash absorbs retailer-specific inputs |
| `gtin` | **Dead end for produce.** 472/472 populated at W, **0/488 at C** | W values are private-label barcodes (`9300633…`) or PLU-derived (`0265030000004`) — they could never match Coles. Note this is a *produce* conclusion; see §3.4 |
| `variety` column | **Dead end. Junk at W, empty at C.** 258/472 populated at Woolworths with pack words, not cultivars — `Bag`, `Pre Pack Punnet`, `Half`, `Lady Apples`, `Beetroot Punnet`. **0/488 at Coles** | Already flagged junk-and-ignored in ROADMAP P2.0. `ingestProduct` reads it into `p.variety` and the API serves it; nothing should consume it. The new concept in §3.2 is called *variety* and is unrelated to this column |
| `itemKey` from [`produceNames.js`](../server/data/produceNames.js) | **The real foundation**, but naive exact join gives only **109 matched items = 26.8% of W, 24.3% of C** | Measured by parsing both CSVs through `parseProduceName` and intersecting item ids as `buildItems` forms them |

**Conclusion:** tier 1 (GTIN) and `canonical_product_key` are both unavailable.
The workable path is the one P2.1 already predicted — build on `itemKey` — but
`itemKey` alone recovers only a quarter of the assortment, and *why* it misses
is the whole design problem. That taxonomy is §2.

### 1.1 The one number to beat

> **Baseline: 109 matched items (26.8% W / 24.3% C) on the 16 Sep captures.**

Every phase in §7 states its **measured or expected** effect on that number. Where
a figure is measured, it says so. If a phase does not move the number and does not
enable a phase that does, the phase was wrong.

---

## 2. Why 73% miss — the failure taxonomy

Five distinct causes, each needing a different fix, listed in cost-to-fix order.
Only §2.1 is cheap; §2.4 and §2.5 must never be "fixed" at all.

### 2.1 `organic` token pollution — *every organic line fails*

`is_organic` is reliable on both retailers (verified). But the word "organic"
also survives into `itemKey`, and only one retailer puts it in the name:

| | product name | `is_organic` | `itemKey` |
|---|---|---|---|
| W | `Macro Organic Beetroot Punnet` | `true` | `organic:beetroot|organic` |
| C | `Beetroot` (brand `Coles Organic`) | `true` | `organic:beetroot` |

The asymmetry is systematic and measured: **Woolworths puts "organic" in the
product name on 57 of its 59 organic rows; Coles puts it in the brand column on
41 of its 53.** The flag already prefixes the item id, so the token is pure
duplication — and it makes the two organic lines of the *same* item un-joinable.

**Fix:** drop `organic` from the token set in `parseProduceName` (the flag keeps
the fact). One line. Also improves *within*-retailer grouping, so it stands on
its own merits.

**Measured effect:** organic matches **3 → 18**; total matched items
**109 → 124 (+13.8%)**. Real, and the cheapest win available — but note this is
a 14% improvement, not a transformation. The lexicon (§3.2) is where the bulk is.

### 2.2 Descriptor asymmetry — *each retailer adds a different adjective*

| | name | `itemKey` |
|---|---|---|
| W | `Woolworths Jalapeno Chilli Hot` | `chilli|hot|jalapeno` |
| C | `Jalapeno Chilli` | `chilli|jalapeno` |
| W | `Mushroom Portobello Flat Large Loose` | `flat|mushroom|portobello` |
| C | `Portobello Brown Mushrooms` | `brown|mushroom|portobello` |

Note the second pair: **neither key is a subset of the other** — W says "flat",
C says "brown". So subset/containment matching is not sufficient either. What
both pairs share is a *core* (`jalapeno`+`chilli`, `portobello`+`mushroom`) plus
retailer-specific decoration.

**Fix:** the variety lexicon (§3). Match on a recognised core, treat the rest as
decoration that may differ.

### 2.3 Implied head noun — *the item word is simply absent*

`Grab N Glow Pink Lady` (Coles, SAP subcategory `APPLES`) → `lady|pink`. The
word "apple" never appears, so it cannot join `apple|lady|pink`.

**Fix:** when the retailer's own taxonomy names the group, use it to supply the
head noun. This is exactly the fallback
[`produce_lexicon.py`](../infra/terraform/lambda/category_crawler/produce_lexicon.py)
already performs in the crawler, in reverse.

### 2.4 Genuinely single-retailer lines — *must stay unmatched*

`Woolworths Beanette Pre Pack Punnet`, `Bananas Kids`,
`Woolworths Mixed Vegetables Soup Starter With Celery`. These have no Coles
counterpart. **Unmatched is the correct answer** and the spec agrees (§8.1 tier
4: *"Unmapped is a perfectly good state"*). A plan that drives the match rate to
100% is a plan that has started lying.

### 2.5 Not a matching failure at all — the two crawls differ in scope

Distinct from §2.4, and easy to misattribute. The two category crawls
(`fruit-veg` at W, `fruit-vegetables` at C) do not cover the same shelf: Coles'
crawl contains 16 `non_produce` rows in six groups Woolworths' does not have at
all — `floral`, `nuts`, `seasonal`, `sauces`, `snacks`, `dried-fruit` (cut
flowers, walnuts in shell).

These will never match, and they should never be *attempted*: a produce variety
lexicon run over cut flowers and sauces is how a matcher files things
confidently and wrongly. **The matcher must be scoped to
`group_kind === 'produce'`**, which is why §3.1 asks the Lambda to emit
`group_kind` alongside `canonical_group` rather than leaving the server to infer
it. Counting these as "unmatched items" in the match-rate metric would also
permanently depress the denominator for a reason that has nothing to do with
matching.

---

## 3. The design — a match key, four confidence levels, one lexicon

### 3.1 Where matching lives — and the L1/L2 line that decides it

This is the load-bearing architectural decision, and the spec already made it.
[LAMBDA_OUTPUT_SPEC.md §2](../data/LAMBDA_OUTPUT_SPEC.md) layer model:

```
L0 RAW CAPTURE     Lambda. Immutable.
L1 NORMALISED      Lambda. Pure, cheap, ALWAYS recomputable from L0.
L2 BASKET MAPPING  NOT the Lambda's job. Curated, versioned in the repo,
                   "so it can be changed and replayed against all captured history."
```

**`variety`, the tiers and the overrides are L2.** They go in `server/`, in
JavaScript, derived from the CSVs at load time — **not** into the Lambda.

The reason is not tidiness, it is replay. Variety rules will be wrong and will
change weekly for months. If the match key is written into the CSV at capture
time, every rule change either orphans the existing archive or requires
re-crawling history that no longer exists to be crawled. Deriving at load means
a rule change is a server reload and the entire archive back to 28 Aug
re-matches instantly. This is also why `basket_item_id` is deliberately an empty
column in Lambda output (§2) — the same argument, already settled for the basket.

**But `canonical_group` is L1, not L2, and belongs in the products CSV.**

An earlier draft of this plan refused to add it, on the same replay grounds. That
was wrong, and the distinction matters enough to state explicitly:

- The spec puts `canonical_product_key` at **L1** precisely because it is *"pure
  and cheap, ALWAYS recomputable from L0"*. `canonical_group` is the same kind of
  derivation from the same inputs — `sap_subcategory`, falling back to
  `product_name` — and the Lambda **already computes it today** for the cheapest
  file. L1 columns cannot be orphaned by a rule change, because L1 is
  recomputable by definition.
- Replay only requires L2 treatment for things that are *curated judgement*.
  `group` is not; `variety` is.
- The cost of refusing is a JS reimplementation of `taxonomy.py` +
  `produce_lexicon.py` — including the VETO list, the `product_name` fallback and
  the `produce` / `prepared` / `non_produce` classification that §2.5 now shows is
  load-bearing. That is a large surface to duplicate, and its divergence log
  would be dominated by the two behaviours the duplication is most likely to get
  wrong.

**Recommendation:** add `canonical_group`, `group_kind` and `group_source` to the
products dataset as an additive schema change (1.2), which §9.3 of the spec
explicitly permits and which is one small Lambda change reusing shipped code. The
server then derives only `variety` and the tiers.

Two consequences to handle:

1. **Back-compat.** Captures before the schema change lack the columns. The server
   must tolerate their absence per row, and the match-rate metric must report how
   much of the archive predates them — otherwise a rising match rate will be
   read as better matching when it is only newer data.
2. **The cross-check survives, cheaply.** Where the cheapest file and the products
   file both carry a group for the same SKU, assert they agree and log
   divergence. Free regression signal, no duplicated vocabulary.

### 3.2 The key

```
match_key = <group>:<variety>[:organic][:imperfect]
```

| Part | Source | Example |
|---|---|---|
| `group` | 34 groups already proven to join (§1), derived in JS from name + SAP subcategory | `apples` |
| `variety` | **new** per-group variety lexicon | `pink-lady` |
| `organic` | `is_organic` column (reliable both sides) | — |
| `imperfect` | existing `IMPERFECT_PHRASES`, already collapses `I'm Perfect` + `The Odd Bunch` | — |

So: `apples:pink-lady`, `apples:granny-smith:organic`, `potatoes:brushed`,
`mushrooms:portobello`.

**Why a lexicon beats general token matching.** The problem in §2.2 is
open-ended — you cannot enumerate every adjective two retailers might add. But
you *can* enumerate the varieties of apple sold in Australia. A lexicon inverts
the problem from "do these token sets mean the same thing?" (unbounded, needs
fuzzy matching, fails silently) to "which known variety does this name contain?"
(bounded, longest-match-wins, fails *loudly* as `variety: null`). The crawler's
existing `produce_lexicon.py` is the proof this shape works on this data, and it
already documents the two rules that matter: **longest match wins** and **VETO
runs before TERMS** (`Potato Salad` is not a potato). Port both.

Assortment overlap is good enough to make this worthwhile: Pink Lady, Granny
Smith, Royal Gala, Jazz, Envy, Bravo, Navel, Blood, Cara Cara, and
brushed/washed/baby potatoes all exist at both retailers.

One note from the data: Woolworths puts the **cultivar in the `brand` column**
(`Jazz`, `Kanzi`, `Envy`, `Bravo`) — which is why `parseProduceName` already
deliberately does not strip `brand`. The variety lexicon must read name **and**
brand.

### 3.3 Confidence levels — and what each one is allowed to do in the UI

This is the governance surface. A confidence level is not a label, it is a
permission. (Called *levels*, not *tiers*, to keep them distinct from spec §8.1's
four *matching tiers*, which are a different ladder — see §5.2.)

| Level | Condition | UI is allowed to |
|---|---|---|
| `exact` | same `match_key`, **a shared comparison basis, and compatible pack semantics** (§3.3.1) | **Show a price comparison.** Name a winner. Feed P2.3 series. |
| `strong` | same `match_key`, no shared basis or incompatible pack semantics | Show both prices, **clearly not compared**, with the reason. Never name a winner. |
| `group-only` | same `group`, variety differs or is `null` | Show as *"other apples at Coles"* — a browse link, never a comparison. |
| `unmatched` | no counterpart | Say so plainly. Keep the existing honest placeholder. |

The rule that keeps this honest, and it is already ROADMAP policy (Risks: *"a
wrong 'same product' is a wrong headline"*): **never present a non-`exact` match
as a price comparison.** Halves and quarters match the whole item for browsing but
are never price-compared to it.

#### 3.3.1 The level is a property of a SKU pair, not of a match

This is the correction that most changes the design, and Pink Lady — the
motivating example — is the counter-example that forces it. All seven SKUs, as
captured 16 Sep:

| | SKU | name | `/kg` | `/ea` | avail |
|---|---|---|---|---|---|
| W | `105919` | Fresh Pink Lady Apples (loose) | — | **1.31** | yes |
| W | `310968` | Woolworths Fresh Pink Lady Apples Punnet 1kg | **7.50** | — | yes |
| W | `160888` | Macro Organic Pink Lady Apple Punnet | — | — | **no, unpriced** |
| C | `4438477` | Pink Lady Apples 1kg | **4.90** | — | yes |
| C | `5111654` | Pink Lady Apples Medium (approx. 200g) | **4.90** | — | yes |
| C | `2022580` | Grab N Glow Pink Lady 6-pack | — | **1.25** | yes |
| C | `4678233` | Pink Lady Apple (Coles Organic) | 8.90 | — | yes |

So the non-organic `apples:pink-lady` match has **2 W and 3 C SKUs, on two
different bases on each side.** A single `tier` + single `basis` per match cannot
describe this. Four rules follow:

1. **Choose the comparison basis, don't inherit it.** Prefer `kg` > `L` > `each`,
   taking the best basis present on *both* sides. This is exactly the rule
   [`cheapest.js`](../client/src/lib/cheapest.js)'s `beats` already encodes
   (*"kg beats ea when mixed"*) — reuse it rather than inventing a second one.
   Here that gives the right headline: W `310968` $7.50/kg vs C `4438477`
   $4.90/kg → **Coles 35% cheaper**.
2. **`each` comparisons additionally require compatible pack semantics.** Without
   this rule, W `105919` ($1.31/ea, one loose full-size apple) and C `2022580`
   ($1.25/ea, one apple from a 6-pack of small snack apples) share a key and a
   basis, and would land `exact` — a 5%-cheaper headline built on comparing
   different-sized fruit. `multipack` and `sizeGrade` are already parsed by
   `produceNames.js`; a mismatch on either downgrades an `each` comparison to
   `strong`. Per-kg comparisons are immune, which is the deeper reason to prefer
   kg.
3. **Unpriced or unavailable SKUs can never be `best`.** W `160888` has no price
   and `is_available=false`. `alternatives` already filters on
   `o.latest.isAvailable`; `matches` must do the same, and an unpriced SKU listed
   in `sizes` must be visibly unpriced rather than rendered as a blank price.
4. **Ties need a stated rule.** C `4438477` and `5111654` are both exactly
   $4.90/kg. Break on: available first, then larger net size, then lower shelf
   price, then lower SKU. Arbitrary is fine; *unstated* is not, because an
   unstable winner makes P2.3's series jitter for no reason.

---

### 3.4 This key is produce-only, and that is a decision with a shelf life

`group:variety` is a **fresh-produce** key. It should be scoped to
`group_kind === 'produce'` (§2.5) and it will not extend to the packaged aisles
ROADMAP P2.6 adds next (chocolate first, then snacks, then dairy/eggs/bread). The
roadmap already says so: *"packaged goods need grouping by canonical product
(brand + line + size) rather than by subcategory, and a `$/100g` basis."*

Three of this plan's foundations invert for packaged goods:

| | Produce (this plan) | Packaged goods (P2.6) |
|---|---|---|
| GTIN | Dead end — 0/488 at Coles, private-label barcodes at W (§1) | **Decisive.** Spec §8.1 tier 1 becomes the primary path; a matcher is barely needed |
| Brand | Noise. `BRAND_WORDS` in `produceNames.js` discards `woolworths`, `coles`, `macro` | **Identity.** Discarding `Cadbury` is exactly wrong |
| `net_size_value` | A size axis to collapse — all sizes of one item group together | **Part of product identity**, and the thing shrinkflation watches |

So P2.6 needs a second key, not an extension of this one. **The action for this
plan is to keep that door open:** the API must carry `matchKey` as an opaque
string with a declared `matchKeyKind` (`produce` for now), so that adding a
GTIN-based packaged key later is a new kind rather than a breaking change to
`/api/products` and to whatever P2.2 and P2.3 have built on it by then. Getting
this wrong costs a migration of the two features the roadmap calls the biggest
unblocks.

## 4. The comparability problem — bigger than matching

This is the finding most likely to be missed, and it will silently corrupt every
comparison if not handled first.

Matching two products is *not* sufficient to compare their prices. Measured
`unit_price_measure` values:

| Retailer | values |
|---|---|
| Woolworths | `1KG` (270), `1EA` (166), `10G` (27), `100G` (9) |
| Coles | `1kg` (332), `1ea` (96), `10g` (27), `100g` (18), `100mL` (7), `""` (8) |

Two separate problems:

1. **Case diverges** — `1KG` vs `1kg`.
2. **The bases themselves differ** — `10G` vs `100g` vs `1kg` are three different
   denominators. Case-folding is not enough; comparing raw `unitPrice` across
   those is meaningless.

**The fix is already in the data.** The CSVs carry pre-normalised columns:

| | `price_per_kg_aud` | `price_per_l_aud` | `price_per_each_aud` | no basis at all | coverage |
|---|---|---|---|---|---|
| Woolworths (n=472) | 282 | 0 | 156 | 34 | 92.8% |
| Coles (n=488) | 378 | **7** | 101 | 2 | 99.6% |

**Comparisons must be computed on `pricePerKg` / `pricePerL` / `pricePerEach` —
never on `unitPrice` + `unitMeasure`.** The 7 Coles `price_per_l_aud` rows are the
reason `L` belongs in the basis preference order in §3.3.1 and not as an
afterthought.

A `kg` line and an `each` line are only comparable through an approximate unit
weight, which this project does not measure. Where one side has only `each` and
the other only `kg`, the level is `strong`: show both, compare neither. The
no-basis rows (`Passionfruit`, `Cauliflower Half`) are `strong` at best.

### 4.1 The live defect this exposes — and it is not where you would look

An earlier draft of this plan claimed the bug was in `getProduct`'s `alternatives`
comparing `o.latest.unitMeasure === basis` as an exact string. That was wrong:
`alternatives` filters `o.retailer === p.retailer`, so it is **never**
cross-retailer, and within one retailer the casing is uniform. Case-folding there
is a no-op, and the exact-string compare costs coverage but never produces a wrong
number.

**The real defect is in `getItems`**, which the category grid renders:

```js
const basis = priced[0]?.latest.unitMeasure
const best  = priced.filter(s => s.latest.unitMeasure === basis)…[0]
```

The basis is taken from whichever SKU happens to sort first, then every SKU on a
different basis is dropped from the `bestSku` choice. **29 items have SKUs spanning
two bases** — `apple|lady|pink` (each + kg), `brushed|potato`, `potato|red|washed`,
`rockmelon`, `packham|pear`, `onion|red`, `apple|granny|smith`, and more. For each
of those the grid's "cheapest size" silently ignores some SKUs, and *which* ones
depends on `sizeRank` ordering.

This is a shipped, user-visible correctness bug, independent of matching, and it is
the thing Phase 0 should actually fix.

---

## 5. What "a big corporation would do" — the parts that are not code

A matcher is easy to write and hard to trust. In a team where a wrong match
becomes a wrong press headline, four things exist around the algorithm. Each is
cheap here and each is the reason the algorithm stays correct after the author
stops looking at it.

### 5.1 A golden file as the specification

ROADMAP P2.1 asks for *"a golden file of every distinct name in the 16 Sep
captures"* as *"the spec and the test"*. That is right in substance, and it is the
highest-value artefact here — it is simultaneously the spec (what *should* match),
the regression test (`npm run test:server`), and the review surface (a diff to it
states in human-readable terms what a lexicon change did).

Two corrections to how an earlier draft planned it:

**It is 921 distinct product names** (925 distinct name × retailer over 960 rows),
not the ~700 first estimated. That is ~30% more hand-verification than budgeted,
and it recurs partially after each lexicon change.

**It cannot be written before the lexicon exists.** The expected `match_key` values
are unwriteable until the lexicon has fixed its own vocabulary — whether the token
is `pink-lady` or `pink_lady`, whether the group is `mushrooms` or `mushroom`, how a
`null` variety renders. Written first, the file is a guess that gets rewritten
wholesale once the lexicon lands, and the diff — the very thing that makes it a
review surface — becomes meaningless noise.

So it splits in two:

| Artefact | When | Size | Purpose |
|---|---|---|---|
| `fixtures/adversarial.json` | Phase 2, hand-written | ~60 rows | The cases that must not regress, chosen to hurt: `Potato Salad` (VETO), `Grab N Glow Pink Lady` (implied head noun **and** the `each` pack-semantics trap), the `Flat`/`Brown` mushroom pair, both organic spellings, all 7 Pink Lady SKUs with their bases, a tie at $4.90/kg, an unpriced unavailable SKU |
| `golden.json` | End of Phase 4, **generated then reviewed** | 921 rows | Full coverage. Generate from the finished lexicon, review the output by eye, freeze. Thereafter every diff is a reviewable claim |

The adversarial fixture is what actually drives Phase 4 development, and it is
small enough to write honestly in an hour.

### 5.2 Decisions are data, and they are reviewable

Three versioned files under `server/data/matching/`, checked into git:

- `varieties.json` — the lexicon. Per group: variety → surface forms.
- `overrides.json` — `{ match_key, retailer, sku, verdict: confirm | reject, note, date }`.
  The escape hatch for what the lexicon gets wrong.

  > **Vocabulary note.** This is *not* spec §8.1 tier 2. That tier ("curated SKU
  > allowlist") is the **primary** matching path for branded staples, where a fixed
  > representative product must be tracked over time. `overrides.json` is a
  > correction layer over an attribute rule, which is spec tier 3. Two four-item
  > ladders with similar names is how a document that claims spec conformance
  > quietly stops conforming — hence *levels* for confidence (§3.3) and *tiers*
  > only for the spec's basket-mapping ladder. Spec tier 2 becomes relevant at
  > P2.6 (§3.4), where GTINs exist and a representative SKU is the right model.
- `vetoes.json` — names that must never match a produce group (`Potato Salad`,
  `Apple Slices`, `Dressings Berry Balsamic`), ported from `produce_lexicon.py`'s
  VETO list.

The property that matters: a bad match is fixed by a **reviewable data change
with a note and a date**, not by a subtle edit to a scoring function. Six months
later `git log` on `overrides.json` explains why a decision was made, which a
tuned threshold never does.

### 5.3 The match rate is a monitored metric, not a vibe

Extend `/api/status` with a `matching` block: total items, matched by tier,
match rate per retailer, and the count of `variety: null` within each group.

`variety: null` is the actionable one — it is the lexicon's own to-do list,
ranked by how much assortment each gap costs. And because the whole archive
re-derives on load, a lexicon change's effect on the match rate is visible
immediately, on real data, before it ships.

Wire this into the **P1.3 data-quality page** that the roadmap already plans.
Matching quality then becomes something the site says out loud, which is the
strongest possible forcing function for keeping it honest.

### 5.4 One derivation, shared by every surface

`buildWall` already exists so that the Home wall and `#/cheapest` *"name the
same winner for every produce group"*. The matcher must extend that discipline,
not break it: one module, `server/data/matching/`, consumed by the product page,
the category grid, the cheapest page and the future series. If two surfaces can
disagree about whether Coles is cheaper on Pink Lady apples, the feature is worse
than not shipping it.

---

## 6. API and UI

### 6.1 API

Matching is a property of an item, so it rides on the existing endpoints rather
than adding a parallel one.

**`GET /api/products/:retailer/:sku`** — add a `matches` array. Replaces the
current cross-retailer-shaped-but-empty `sizes`-only story:

```jsonc
"matchKey": "apples:pink-lady",
"matchKeyKind": "produce",                 // §3.4 — lets a GTIN key join later
"matches": [
  {
    "retailer": "coles",
    "level": "exact",                      // the level of the BEST comparison found
    "comparable": true,                    // the client branches on THIS, not on level
    "notComparableReason": null,           // e.g. "Woolworths priced per each, Coles per kg"

    // The comparison the UI should lead with: best shared basis, kg > L > each (§3.3.1)
    "comparison": {
      "basis": "kg",
      "this": { "sku": "310968", "pricePerKg": 7.50 },
      "other": { "sku": "4438477", "displayName": "Pink Lady Apples",
                 "sizeLabel": "1kg", "price": 4.90, "pricePerKg": 4.90,
                 "productUrl": "https://…", "capturedAt": "2026-09-16T…",
                 "runId": "01J…", "isAvailable": true },
      "delta": { "pct": -35, "cheaper": "coles" },
      "captureSkewHours": 0.2
    },

    // Every other SKU under this key at that retailer, each carrying its own
    // basis and its own level. Pink Lady has 3 here (§3.3.1).
    "sizes": [
      { "sku": "5111654", "sizeLabel": "approx. 200g", "pricePerKg": 4.90,
        "basis": "kg", "level": "exact", "comparable": true, "isAvailable": true },
      { "sku": "2022580", "sizeLabel": "6 pack", "pricePerEach": 1.25,
        "basis": "each", "level": "strong", "comparable": false,
        "notComparableReason": "6-pack vs single — pack sizes differ" }
    ]
  }
]
```

Rules baked into the response, so no client can get them wrong:

- **`comparable` is the flag the UI branches on.** Not `level`. An earlier draft had
  §6.2 replacing the product page's winner styling based on tier, which would have
  put the comparability rule back in the client — precisely what this section exists
  to prevent. The server decides; the client renders. `level` stays in the payload
  for display and for the data-quality page, not for logic.
- **`delta` is `null` whenever `comparable` is false.** The client never computes it.
- **`basis` is per comparison and per size**, always one of `kg` / `L` / `each`, from
  the normalised columns (§4) — never from `unitMeasure`.
- **`captureSkewHours`** is present on every comparison, because two prices captured
  twelve hours apart are not like-for-like and the UI has to be able to say so.
- Unpriced or unavailable SKUs appear in `sizes` with explicit nulls and
  `isAvailable: false`; they are never `comparison.other` (§3.3.1 rule 3).

**`GET /api/items`** — add `matchKey` and a compact `matched` summary per item,
so the category grid can render a "CHEAPEST AT" badge without N+1 requests.

**`GET /api/status`** — the `matching` metrics block (§5.3).

[`client/src/services/api.js`](../client/src/services/api.js) needs no new
function for the product page — the existing `api.product()` response simply
carries more. `api.status()` likewise. This is the payoff of the
one-network-boundary rule the file already enforces.

### 6.2 UI — the Pink Lady journey, end to end

**Product page, "Price now"** — the target of the whole plan. The panel already
loops `RETAILERS` and renders a `NotWired` for each store it has no match for,
so the shape is right and the change is a fill-in, not a rewrite:

- `comparable: true` → a real `StorePrice` card for Coles: price, unit price, size,
  link out, and winner/runner-up styling. The hardcoded `ONLY RETAILER MATCHED` tag
  (currently unconditional in `StorePrice`) becomes server-driven.
- `comparable: false` with a match → both prices shown, the server's
  `notComparableReason` rendered verbatim, and **no** winner styling.
- `group-only` / `unmatched` → the existing `NotWired`, with a better `needs`
  string. Aldi and Market keep *"a Coles crawler"*-style messaging since they have
  no crawler at all — a different absence, worth keeping distinct.
- `priceSentence` gains the comparison clause only when `comparable`.
- Where `captureSkewHours` is material, the panel says which price is older.

**"All matched SKUs" table** — the footnote *"Other retailers' SKUs for this
product appear here once cross-retailer matching exists"* is deleted, and the
table gains the matched retailer's rows. Its `Retailer` column already exists and
is already coloured per retailer; today it can only ever print one value.

**Category grid** — a "CHEAPEST AT · COLES" badge per tile for `exact` matches.

**`#/cheapest`** — **add variety-level winners beside the group-level ones; do not
replace them.** An earlier draft called replacing them "a much stronger claim". It
would have been a coverage regression: today `buildWall` names a winner for all 34
shared produce groups straight from the Lambda's cheapest file, with **no matching
required at all**. Variety-level winners require a cross-retailer match, and only
124 item-ids match post-Phase-1 — so most groups would have no variety-level winner
and the page would lose rows it currently has. The group-level wall is the floor;
variety winners are an enrichment on top of it.

**Provenance stays visible.** Both retailers' prices must carry their own
`capturedAt` and run id. Two prices captured twelve hours apart are not a
like-for-like comparison, and the site's whole credibility rests on saying so.
Where the two captures are from different runs, say which and when.

---

### 6.3 Discontinuation — a match must expire

This is the plan's largest correctness risk and it was missing from the first
draft entirely.

`ingestProduct` keeps a product forever once it has been seen, and `p.latest` is
simply its most recent observation — however old that is. `staleness()` exists but
is **global** (how old is the newest capture overall), not per-SKU. So when Coles
delists `4438477`, nothing expires: the Woolworths product page keeps rendering a
Coles comparison against a price that is no longer on any shelf, and P2.3's series
would draw a flat line where the honest answer is a gap.

Three rules:

1. **`comparable` requires both sides to appear in their own retailer's newest
   *complete* run.** Not merely "to exist in the index". This reuses the
   complete-vs-partial distinction `loadObservations` already draws for the
   cheapest sets, and for the same reason: a line that was simply not fetched must
   not read as a line that changed price.
2. **A SKU absent from its retailer's newest run is `strong` at best**, shown with
   its last-seen date, and degrades to `unmatched` after a stated number of runs.
3. **P2.3's series emits `null`, never carry-forward.** A gap is data; an
   interpolated price is an invention.

Rule 1 interacts with **P0.3**: while Woolworths earns no `_SUCCESS` and its runs
are formally `partial`, a strict "newest complete run" test would suppress *every*
Woolworths comparison. So the rule must be "newest complete run, or newest partial
if the retailer has no complete run, and say which" — the same fallback
`loadObservations` already applies to cheapest sets, and the same honesty the
status endpoint already reports via `cheapestFromPartial`.

---

## 7. Phasing

Ordered so each phase is independently shippable. An earlier draft claimed phases
0+1 would "roughly double the match rate"; **measured, they yield 109 → 124
(+13.8%)**, all of it from Phase 1. That claim is withdrawn — the lexicon is where
the bulk is, and the ordering below no longer pretends otherwise.

| Phase | Work | Effect on the 109 baseline |
|---|---|---|
| **1 — organic token** | Drop `organic` from `itemKey` tokens (§2.1). One line + test. Do this first: it is the cheapest real win in the plan. | **Measured: 109 → 124 (+13.8%).** Organic pairs 3 → 18 |
| **0 — basis hygiene** | Fix `getItems`' mixed-basis `bestSku` selection (§4.1, **29 affected items**); introduce a shared basis-preference helper (`kg` > `L` > `each`) reusing `cheapest.js`'s `beats` semantics. | 0 new matches. **Not a blocker** — nothing downstream requires it — but it is a live user-visible bug and the helper is needed by Phase 5 anyway |
| **2 — adversarial fixture** | ~60 hand-written rows that must not regress (§5.1). Not the full golden file. | 0 matches; makes 3–5 safe |
| **3 — group + `group_kind`** | Add `canonical_group`/`group_kind`/`group_source` to the products dataset as additive schema 1.2 (§3.1); server tolerates their absence on older captures. Scope the matcher to `produce` (§2.5). Fixes §2.3. | Recovers implied-head-noun lines (`Grab N Glow Pink Lady`); removes 16 non-produce Coles rows from the denominator |
| **4 — variety lexicon** | `varieties.json`, longest-match-wins, VETO-first (§3.2). Reads name **and** brand. The bulk of the work. Ends with `golden.json` generated and reviewed (§5.1) | The main jump. Apples, potatoes, pears, citrus, mushrooms |
| **5 — levels + API** | Per-SKU-pair levels (§3.3.1), expiry rules (§6.3), `matches` on `/api/products`, `matchKey`/`matchKeyKind` on `/api/items`, `matching` on `/api/status`. | — |
| **6 — UI** | §6.2. The Pink Lady panel goes live. | — |
| **7 — governance** | `overrides.json` honoured; match metrics onto the P1.3 data-quality page. | Ongoing |

Phases 0 and 1 are renumbered rather than reordered in place, to keep cross-
references stable: **run 1 before 0.** Phase 1 is one line and moves the number;
Phase 0 is a genuine bug fix that moves nothing and blocks nothing.

**Definition of done** (from the ROADMAP's own P2 bar): every product page shows
both retailers side by side *with a matching confidence*. Not every product page
shows a second price — most fresh-produce lines genuinely have no counterpart, and
saying so is the feature.

### 7.1 Sequencing against the rest of the roadmap

Three conflicts worth naming plainly.

**P0.3 is still open.** Woolworths misses its reported count by 1–4 rows and no run
has earned `_SUCCESS` since 22 Sep, so the archive's Woolworths side is formally
`partial`. That does not block matching (matching reads whatever rows exist), but a
missing Coles-vs-Woolies match may be a *crawl* gap rather than a *matching* gap.
The match-rate metric (§5.3) must be read alongside run status, or Phase 4 tuning
will chase ghosts. It also forces the fallback in §6.3.

**This plan is written about three weeks early.** The roadmap's own four-week
sequence puts P0.3, the mock-layer deletion (P1.1), the staleness banner (P1.5) and
view-model tests (P1.7) in weeks 1–3, and *"start P2.1 matching"* in week 4. Nothing
here argues for resequencing that. Phase 1 (one line, +13.8%) and Phase 0 (a live
grid bug) are small enough to land opportunistically; Phases 2–7 should wait their
turn.

**The working tree has 19 modified and 9 untracked files.** Committing them is on
the roadmap's week-1 list. Starting a multi-phase feature on top of an uncommitted
tree of that size makes every phase boundary unreviewable, which is exactly the
property §5.2 is trying to buy.

P2.2 (basket) and P2.3 (series) both consume `match_key` and should not start until
Phase 5 has settled its shape — including `matchKeyKind` (§3.4), without which P2.6
becomes a breaking change to both.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| **A wrong match becomes a wrong headline.** The project's stated top risk. | Tiers as permissions (§3.3): only `exact` may compare. Golden file as gate. `overrides.json` for a fast, auditable correction path. |
| **Lexicon rot.** New varieties appear each season; the lexicon silently stops covering the shelf. | `variety: null` counts per group are a monitored metric (§5.3) and surfaced on the data-quality page. The lexicon's gaps report themselves. |
| **Comparing prices captured 12 h apart.** | Show both `capturedAt`s (§6.2). Consider refusing `exact` when captures are more than 24 h apart — worth deciding in Phase 5, not guessing now. |
| **A delisted line keeps being compared.** The highest-severity gap; `p.latest` never expires. | §6.3: `comparable` requires presence in the retailer's newest run; series emit `null`, never carry-forward. |
| **Python/JS vocabulary divergence.** | Largely avoided by keeping `group` at L1 in the Lambda (§3.1) instead of reimplementing `taxonomy.py` in JS. Only `variety` lives in JS, and it has no Python counterpart to diverge from. |
| **The key hardens around produce, then P2.6 arrives.** Chocolate inverts the GTIN, brand and net-size assumptions (§3.4). | `matchKeyKind` from day one, so a GTIN-based packaged key is an addition rather than a migration of P2.2 and P2.3. |
| **`#/cheapest` loses rows.** Variety winners need matches; group winners do not. | §6.2: add beside, never replace. The group-level wall stays the floor. |
| **Over-matching to chase a number.** The match rate is the metric, so the temptation is to loosen rules until it rises. | The rate is reported *per tier*. `group-only` rising is not progress. The honest ceiling is well below 100% (§2.4). |

---

## 9. Open questions

1. **Should `exact` require captures within N hours of each other?** Recommend yes,
   N=24, decided in Phase 5 against real run timings. `captureSkewHours` is in the
   payload either way (§6.1).
2. **Do halves/quarters share a `match_key` with the whole item?** Recommend yes for
   browsing (they are the same item), with price comparison suppressed — `portion`
   is already parsed, so this is a level rule, not a key change.
3. **Organic as a key segment vs a filter facet.** Currently a key segment, so
   organic and conventional never compare. Correct for a price index; revisit only
   if users want to see the organic premium, which would want them deliberately
   adjacent. Note the data supports it: C `4678233` at $8.90/kg against C `4438477`
   at $4.90/kg is an 82% premium on the same shelf.
4. **How strict should `each` pack-semantics compatibility be?** ~~An earlier draft
   claimed `Grab N Glow Pink Lady` "will land `strong` because the matched
   Woolworths line is per kg".~~ **That was factually wrong** — W `105919` is priced
   per *each* ($1.31/ea), so under a naive same-key-same-basis rule Grab N Glow
   ($1.25/ea, one apple from a 6-pack of small snack apples) lands **`exact`**, and
   the plan's flagship example produces exactly the misleading 5%-cheaper headline
   the plan exists to prevent. §3.3.1 rule 2 closes it by requiring `multipack` and
   `sizeGrade` compatibility for `each` comparisons. The open question is how strict
   that test should be — `sizeGrade` is frequently `null`, and treating `null` as
   "compatible with anything" reopens the hole while treating it as "incompatible"
   discards many honest per-each matches. Decide in Phase 5 against the adversarial
   fixture. The deeper mitigation is structural: prefer `kg`, where fruit size
   cannot distort the comparison at all.
5. **Should the match rate be reported per group?** A single headline rate hides
   that apples might be at 90% and herbs at 5%. Recommend per-group, since that is
   also the lexicon's work queue (§5.3).
