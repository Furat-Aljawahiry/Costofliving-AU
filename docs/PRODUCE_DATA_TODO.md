# Produce data — open rulings

A working queue for the cross-retailer matcher ([design](CROSS_RETAILER_MATCHING.md)).

Everything here is a question the **data cannot answer** — it needs someone who
knows the shelf. The matcher is deliberately built to refuse rather than guess,
so each unresolved item below is a pair of products sitting unmatched, or matched
more coarsely than it should be, until someone rules.

**How an item gets closed:** answer it, and the answer goes into
[`server/data/matching/aliases.js`](../server/data/matching/aliases.js) (a spelling
or default-cultivar rule), [`varieties.js`](../server/data/matching/varieties.js)
(a new variety), [`vetoes.js`](../server/data/matching/vetoes.js) (not produce at
all), or [`overrides.js`](../server/data/matching/overrides.js) (a specific SKU
pair that the rules get wrong). Every entry carries the reason and the date, so
`git log` explains the decision later.

**How to find more:** `npm run matching-report unmatched` — the "variety not
named" bucket is the pool. `npm run matching-report keys --full` for anything
matched that should not be.

---

## 1. Imperfect / odd-bunch lines — is a mystery bag comparable? · OPEN

Both retailers run an odd-grade range under their own branding, and the matcher
already collapses the two brand names into one `imperfect` key segment, so they
group with each other and never with the regular line. **9 pairs match today:**

| key | Woolworths | Coles | |
|---|---|---|---|
| `apples:apple:imperfect` | The Odd Bunch Apples Prepacked Punnet **1kg** — $3.90/kg | I'm Perfect Apples Prepacked **2kg** — $3.95/kg | +1% |
| `avocados:avocado:imperfect` | The Odd Bunch Avocado Prepacked 1kg — $7.90/kg | I'm Perfect Avocados 1kg — $8.50/kg | +8% |
| `carrots:carrot:imperfect` | The Odd Bunch Carrots 1.5kg — $1.60/kg | I'm Perfect Carrots Prepacked 1.5kg — $1.73/kg | +8% |
| `citrus:lemon:imperfect` | The Odd Bunch Lemon Prepacked 500g — $6.20/kg | I'm Perfect Lemons Prepack 1kg — $7.50/kg | +21% |
| `citrus:lime:imperfect` | The Odd Bunch Lime Prepacked 500g — $18.20/kg | I'm Perfect Limes Prepacked 500g — $11.00/kg | −40% |
| `mandarins:mandarin:imperfect` | The Odd Bunch Mandarin Prepacked 1kg — $2.80/kg | I' M Perfect Mandarins Prepacked 1kg — $3.20/kg | +14% |
| `pears:pear:imperfect` | The Odd Bunch Pear Prepacked 1kg — $2.80/kg | I'm Perfect Pears Prepacked 1.5kg — $3.27/kg | +17% |
| `potatoes:potato:imperfect` | The Odd Bunch Potato Prepacked 4kg — $2.40/kg | I'm Perfect Potatoes Imperfect 4kg — $2.23/kg | −7% |
| `mushrooms` … | (see report) | | |

### The ruling needed

**An imperfect bag does not name its cultivar.** `apples:apple:imperfect` is a
1kg Woolworths punnet of unspecified apples against a 2kg Coles prepack of
unspecified apples. Per kilo they are $3.90 and $3.95 — but that is only a fair
comparison if the two bags hold a broadly similar mix. Nothing in the capture says
what is in either.

Three ways to go, and this is the decision:

1. **Keep comparing them** (what happens today). "Cheapest imperfect apples" is a
   real shopper question and per-kg is the right basis. Accepts that the cultivar
   mix is unknown on both sides.
2. **Match but never compare** — treat `imperfect` like `group-only`: show both
   prices, refuse the percentage. Safest, loses 9 live comparisons.
3. **Compare, but label it** — a note on the product page saying the bag's
   contents are not specified by either retailer.

Recommendation: **(1) with (3)**, because the alternative to an imperfect bag
*is* another imperfect bag — a shopper choosing between them has the same
information we do. But it is a judgement about what the site is willing to claim,
so it is yours.

### Separately — three odd-bunch lines lose their key to marketing words

These are matcher gaps, not policy questions, and they are cheap:

| Woolworths line | parsed tokens | why no key |
|---|---|---|
| The Odd Bunch **Crazy** Carrots 5kg | `carrot\|crazy\|imperfect` | `crazy` is pure branding; unread, so the row is refused |
| The Odd Bunch **Tasty Snacking** Tomato 350g | `imperfect\|snacking\|tasty\|tomato` | no `snacking` variety in tomatoes (see item 3) |
| The Odd Bunch **Mini** Cucumber Punnet 450g | `cucumber\|imperfect\|mini` | no `mini` variety in cucumbers (see item 4) |

`Crazy Carrots` should almost certainly join `carrots:carrot:imperfect`, which
already has a matched pair — **is "Crazy" just branding on ordinary imperfect
carrots?** If yes it is one word added to the ignore list.

### Also worth knowing

- **10 of 28 imperfect lines exist at one retailer only** — Woolworths has
  imperfect capsicum, strawberry, cucumber, tomato and zucchini; Coles has
  imperfect juicing orange, onion and sweet potato. Genuine assortment, nothing
  to fix.
- **Three have no unit price at all** in the capture (strawberry, mini cucumber,
  snacking tomato), so they could not be compared even if matched.
- **Pack sizes differ a lot** across a matched pair (1kg vs 2kg, 500g vs 1kg).
  Per-kg handles that correctly; flagging it because it is the thing that looks
  wrong at a glance and is not.

---

## 2. Is Coles' "Cabbage Half Drumhead White" the same as Woolworths' green cabbage? · OPEN

The `cavendish → banana` default-cultivar alias worked. The cabbage equivalent is
half-done:

```
woolworths  Cabbage Green Whole           -> brassicas:cabbage
coles       Cabbage Half Drumhead White   -> NO KEY  ('white' is an unread word)
```

Coles has **no other conventional plain cabbage** in the crawl — its only
unqualified "Cabbage Whole" is flagged organic (and that one now matches
Woolworths' organic green cabbage, which the alias did fix).

"Drumhead white" is the standard green cabbage under another name, but that is
shelf knowledge, not something the capture states. **Same product or not?**

If yes: `white` becomes ignorable in brassicas, or `drumhead-white-cabbage`
aliases to `cabbage`. There is already an inert `drumhead-cabbage → cabbage`
entry in `aliases.js` awaiting this ruling — **it should be removed if the answer
is no.**

---

## 3. Snacking tomatoes — a whole cluster unmatched · OPEN

No `snacking` variety exists in the tomatoes lexicon, so every one of these is
unkeyed at both retailers:

```
coles       Snacking Tomatoes 200g
woolworths  Macro Organic Snacking Tomato Punnet 200g
woolworths  Macro Organic Tomato Snacking Mix 200g
woolworths  The Odd Bunch Tasty Snacking Tomato 350g
```

Adding `snacking` to `VARIETIES.tomatoes` would key all four. The organic flag
keeps the Macro lines separate from the Coles one, so the conventional pair that
would actually match is Coles' with the Odd Bunch line — **and those are not the
same thing** (one is imperfect, one is not… though the `imperfect` segment already
separates them).

**Is "snacking tomato" a product category worth its own key, or is it just small
tomatoes?** Note `snacking` deliberately came *out* of the ignore list earlier,
because treating it as noise merged snacking tomatoes with plain tomatoes at
+114% — so it is meaningful, it just has no entry.

---

## 4. Snackable vs snacking carrots — one unread word · OPEN, probably trivial

```
coles       Snacking Carrots 250g              -> carrots:snacking
woolworths  Woolworths Snackable Snacking Carrot 250g  -> NO KEY
```

Identical products. The Woolworths name carries **both** "Snackable" and
"Snacking"; `snacking` matches the variety, `snackable` is left unexplained and
the residual rule refuses the row.

`snackable` is marketing, not a distinction. **Confirm and it goes in the ignore
list** — one word, one match recovered.

Same question for `mini` in cucumbers (item 1): is a "Mini Cucumber" a qukes/baby
cucumber, which already has a variety, or its own line?

---

## Closed

### Non-produce removed from the fruit & veg range · 2026-09-29

**Ruled:** nuts, snacks, cut flowers, sauces and dried fruit are not fruit and
veg and should not be served as such.

**77 rows** now classed `non_produce` and excluded from the produce views — the
category grid, search, and the item counts. Nothing is deleted: L0 is immutable,
the rows stay in the archive, and `?includeNonProduce=1` on `/api/items` and
`/api/search` puts them back.

```
nuts 25   snacks 22   sauces 7   floral 5   dried-fruit 5   + 13 found by name
```

Items in the range: **940 → 871**. No matched key was lost (130 either way),
which is the check that matters — none of this was produce.

Two faults found on the way:

- **`kind` was being decided by whichever rule ran first.** The name-token veto
  ran before the retailer's own subcategory verdict, so 19 rows the retailer
  explicitly filed under `NUTS`, `FLORAL` or `SAUCES` came out as merely
  `prepared` — and `prepared` stays in the aisle. A retailer filing something as
  nuts is making a positive statement; that now outranks the veto.
- **The veto list conflated two different things.** A bouquet of chrysanthemums
  and a coleslaw were in one list, so cut flowers were being served as fruit and
  veg. Split into `VETO_PREPARED` (real produce that has been done something to —
  stays in the aisle, never matched) and `VETO_NON_PRODUCE` (not produce at all —
  leaves the range). A test asserts the two lists never overlap, since a token in
  both would make the kind depend on check order.

Care taken with the nut words: `butternut`, `japnut` and `coconut` are each a
single token and never split to `nut`, so `Butternut Pumpkin Whole`, `Coconut
Whole` and `Drinking Coconut` all stay produce. There is a test for exactly that.

**Still in the range, deliberately:** 253 `prepared` rows — salad kits, cut
fruit, `Butternut Pumpkin Cut`. They are sold in the aisle and are a bigger call
to remove. Say the word if they should go too.

**7 rows remain `unclassified`**, and they are vocabulary gaps rather than
exclusions — `Tuscan Cavolo Nero`, `Young Shoot Microgreens`, `Organic Rainbow
Chard`, `Choy Pack`, `Tangelos Minneola`, `Macro Organic Tumeric` (Woolworths'
own misspelling of turmeric). Each needs a lexicon entry.



### Pineapple — match the whole fruit, exclude anything cut · 2026-09-29

**Ruled:** match lines whose name is just pineapple and that are not prepared;
keep the cut lines out.

Before, the *only* row keyed as pineapple was the cut one:

```
woolworths  Woolworths Fresh Pineapple Tub 200g   -> tropical-fruit:pineapple   (a $22.50/kg cut tub)
coles       Topless Pineapple            $5.90/ea -> no key
woolworths  Pineapple Naturally Sweet Whole $4.90/ea -> no key
```

Three changes:

- `topless`, `naturally` and `crownless` are now ignorable residue. A topless
  pineapple is a whole pineapple with the crown cut off, and "Naturally Sweet" is
  a slogan; neither changes the fruit, and while either was unread the two
  retailers' plain pineapples could not meet.
- `cut` and `cube` joined the veto list.
- **A bug this exposed:** `name-over-map` was overriding *any* retailer verdict,
  including `prepared`, which quietly resurrected **27 prepared lines as fresh
  produce** — `Cut Fruit Pineapple`, `Fresh Pineapple Tub`, `Potato & Egg Bacon`,
  `Just Veg. Carrot Sticks`, `Pumpkin Cubes` — because each name contains a
  produce head noun. It now only overrides a verdict that is itself `produce`.
  A retailer filing something under `VALUE ADD FRUIT` is making a deliberate
  statement; filing spring onions under `BUNCH` is not. Cost: 3 Woolworths
  products, all correctly reclassified.

Result: `tropical-fruit:pineapple` — Woolworths $4.90/ea vs Coles $5.90/ea,
**+20%, compared**. The tub, the cut fruit and the melon mix are all excluded.

### Drinking coconut · 2026-09-29

**Ruled:** match on "drink" + coconut; a young drinking coconut is its own
product, not a mature coconut.

```
coles       Drinking Coconut                            $4.50/ea
woolworths  Coco Q Green Drinking Coconut For Drinking  $4.50/ea
```

- New variety `drinking-coconut`, listed in two shapes with one slug:
  `[green, drinking, coconut]` and `[drinking, coconut]`. Woolworths' name
  carries the colour and Coles' does not, and listing `green` in the entry
  accounts for it without making the word ignorable everywhere.
- `for` joined the stopword list in `produceNames.js` (the raw Woolworths name is
  "…Drinking Coconut **For** Drinking"), and `coco`/`q` joined `BRAND_WORDS` as
  the Coco Q brand.

Result: `tropical-fruit:drinking-coconut` — **$4.50/ea both sides, compared** —
and it stays distinct from `tropical-fruit:coconut` at $5.90/ea, which is the
point: the two products are a dollar-forty apart.
