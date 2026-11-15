# Snacks & confectionery: open rulings

The snack matcher is curated judgement. This file lists every call that was made without a rule to follow, so you can overturn it.

The ruling it all rests on is yours (22 Oct): **two listings are compared only when they are the exact same product**: same brand, same line, same flavour, same form, and an identical pack. This is the opposite of meat, where brand is ignored.

- A ruling is changed in `server/data/snacks/lexicon.js`, or by a dated entry in `server/data/matching/overrides.js`. Never patch it in `names.js`.
- After any change, re-run `DATA_DIR=data/scratch/snacks node server/scripts/snacks-report.mjs` and `npm run test:server`. The fixture (`server/data/snacks/fixtures/adversarial.json`) pins each ruling below with a note.
- An unknown word is always **kept** in the key. A gap in the vocabulary can only cost a match, never make a wrong one.

## Status: built, hidden

- [x] **Discovery crawl, 22 Oct.** One node per retailer (`data/SNACKS_DISCOVERY.md`). Coles' biscuits and crackers are inside its "Chips, Chocolates & Snacks" node, so no second Coles crawl is needed.
- [x] **Matcher.** `server/data/snacks/`: 588 pairs compared in an identical pack, a sample of 60 checked by hand.
- [x] **One aisle.** "Snacks" and "Chocolate & candy" are merged into "Snacks & confectionery": home tile, aisle page, basket, ABS line 115501 (now `exact`, not `shared`). `#/category/chocolate` redirects.
- [x] **Lambda written.** `infra/terraform/lambda_snacks.tf`: one function, two schedules (Woolworths 07:00, Coles 07:20 UTC, and 19:00 / 19:20), each crawling one retailer. `terraform validate` passes. The plan adds 14 resources.
- [ ] **`terraform apply`.** Not run. The same plan also changes 10 existing resources from other uncommitted work (Kmart watcher; the crawler zip, because of `drift.py`), so apply after those are settled.
- [ ] **A complete crawl.** Both discovery runs were `partial` (Coles 1,688 of 1,710; Woolworths 1,810 of 2,751, of which 933 are marketplace sellers that are always skipped). Check the first Lambda runs.
- [ ] **Review `data/review/snacks/`**, then go through the rulings below and the open questions.
- [ ] **Publish.** Set `snacks.public = true` in `server/data/categories.js`. Until then `ENABLED_CATEGORIES=snacks` shows it on one server. `HIDDEN_CATEGORIES=snacks` stays the kill switch.
- [ ] **Drift alarms are per retailer, not per shelf.** As for meat (`docs/MEAT_DATA_TODO.md`).

## Rulings taken (overturn any of these)

| # | Ruling | Why | Where |
|---|---|---|---|
| 1 | **Own label never matches.** Coles, Coles Simply, Coles Finest, Woolworths, Macro … are keyed `house-<retailer>` | A Coles chip is not a Woolworths chip, whatever the name says | `lexicon.js` `HOUSE_BRANDS` |
| 2 | **Brand cut from the name.** A word of the brand is never a product word, however the brand is spaced | Woolworths repeats the brand in every name. Red Rock **Deli** "Deli Style Crackers"; Coles "5 Gum" vs Woolworths "5Gum" | `names.js` |
| 3 | **Brand spellings.** Kit Kat = KitKat; Sour Patch = Sour Patch Kids; Macy & Tailor; a parent company (Nestle, Mars, Mondelez, Ferrero, PepsiCo) in the brand column gives way to the sub-brand the name opens with; Coles' "Lindt Lindor" brand = Lindt + line Lindor | Coles files "Kit Kat Chunky Strawberry" under Nestle | `lexicon.js` `BRAND_ALIASES`, `PARENT_BRANDS`, `SUB_BRANDS`, `BRAND_WITH_LINE` |
| 4 | **"Original" and "Plain" are the unflavoured product** | Coles "Shapes **Original** Barbecue" = Woolworths "Shapes Barbecue"; Coles "**Plain** Biscuits Marie" = "Marie Biscuits" | `lexicon.js` `DEFAULT_WORDS` |
| 5 | **Confectionery: "chocolate", "milk" and "Dairy Milk" are the default.** Dark, white, Old Gold and every flavour still count | "Cadbury Crunchie Milk Chocolate Bar" = "Crunchie Chocolate Bar"; "Roses Tin" = "Cadbury Roses Chocolate Tin" | `lexicon.js` `REDUNDANT_IN_FORM` |
| 6 | **Chips: "potato" and "corn" say nothing** once the brand is known | Doritos "Scoops **Corn** Chips Mexican Cheese" = "Scoops Mexican Cheese" | `lexicon.js` `REDUNDANT_IN_FORM` |
| 7 | **Multipacks: "mini (bars)" and "fun size" describe the pieces** | Snickers "Fun Size Bars 180g 12 pack" = "Party Share Bag 12 Pieces 180g" | `lexicon.js` `REDUNDANT_IN_MULTIPACK` |
| 8 | **Packaging words are ignored:** pack, bag, share, sharing, sharepack, value, family, party, size, large, jumbo, lunchbox, school, multipack, piece(s), block, bar, tin, box, tub, tube, canister, pouch, carton, new; "snack & share", "limited edition", "ready to eat". **Kept:** medium/mild/hot, deluxe, classic, mini (outside a multipack), mega, light, thins, australian | Each kept word names a real variant somewhere on these shelves (Doritos **Medium** Salsa, Tim Tam **Deluxe**, **Mega** Snakes) | `lexicon.js` `IGNORABLE` |
| 9 | **"Snack" is a product in confectionery** (Cadbury Dairy Milk Snack). On chips and bars it is packaging | Review caught Dairy Milk **Snack** 180g paired with plain Dairy Milk 180g | `lexicon.js` `KEPT_IN_FORM` |
| 10 | **Form is part of the key:** chip, cracker, biscuit, lolly, confectionery, muesli bar, popcorn, nuts, refresh (gum, mints), dip (salsa). The name's own form word wins, else the retailer's subcategory | Smith's makes chips **and** crackers in the same flavour | `lexicon.js` `FORM_WORDS`, `FORM_FROM_SUBCATEGORY` |
| 11 | **Compared only for an identical pack.** Two stated weights must be equal. A weight implied from the $/100g (Woolworths' count-only "5 pack") may be within 1% (the cent rounding of the per-100g price; 3% let a 155 g single bag pair with a 152 g 8-pack). Other packs of the same product are shown beside it, not compared | Your ruling. A 170g bag is not compared with a 175g one | `weights.js` `samePack`, `IMPLIED_TOLERANCE` |
| 12 | **Pack count:** stated on both sides, it must agree. Stated on one side only, the weight decides | Coles gives only the weight of a box of bars ("Kit Kat Muesli Bar 145g") that Woolworths calls "5 pack" | `weights.js` |
| 13 | **A single share, party or family bag never pairs with a multipack** of the same weight | Smith's 380g Party Bag vs Coles' 380g 20-pack lunchbox multipack (review) | `names.js` `singleBag`, `weights.js` |
| 14 | **Compared on the shelf price as captured**, specials included and flagged; multi-buy offers ("2 for $6") are not applied | It is what you pay for one pack that day | `weights.js` `snackBasis` |
| 15 | Synonyms: & = and; choc = chocolate; bbq/barbeque = barbecue; covered = coated; crinkle = crinkle cut; assorted/varieties = variety; cheddar cheese = cheddar; chili = chilli; supreme cheese = cheese supreme; vinegar & sea salt = salt & vinegar; caramello makes caramel redundant | | `lexicon.js` `PHRASES`, `REDUNDANT_WITH` |
| 16 | **KitKat "4 finger" is the standard bar.** "2 finger" still counts | Coles "Kit Kat Chocolate Milk 4 Finger Bar 42g" = Woolworths "KitKat Chocolate Bar 42g" | `lexicon.js` `PHRASES` |
| 17 | Woolworths "Snickers Chocolate Bar Peanuts Caramel **Nougat** 44g" = Coles "Snickers Milk Chocolate Bar Peanuts Caramel 44g" | Every Snickers has nougat, but "nougat" names the variant elsewhere (Milky Way), so it is one alias, not a rule | `overrides.js` (alias, 22 Oct) |

## Open questions (your call)

- **Tim Tam Double Coat vs Double Chocolate.** Coles "Tim Tam Chocolate Biscuits Double Coat 200g" and Woolworths "Tim Tam Double Chocolate Biscuits 200g" are probably the same biscuit. Kept apart until confirmed; one alias in `overrides.js` joins them.
- **Burger Rings 90g.** Coles "Burger Rings Snacks 90g" (no count) is compared with Woolworths "Burger Rings Snacks 90g 5 pack" under ruling 12. Confirm the Coles one is also the 5-pack, or reject it in `overrides.js`.
- **Headlines on a special.** 497 of the 588 compared pairs have a special on at least one side at capture, and most of the large gaps are a Coles half-price week (Shapes, Arnott's cream biscuits, Lindt). The comparison is true on the day. Should the product page say "on special" beside the headline, or compare regular prices?
- **Kellogg's LCMs.** Coles adds "Rice Bubbles" to the name ("LCMs Rice Bubbles Choc Chip 5 Pack") and Woolworths does not. Same product; needs an alias per flavour, or a ruling that "rice bubbles" is redundant for LCMs.
- **Grain Waves.** Woolworths adds "Wholegrain", Coles sometimes "Wholemeal" or nothing. Same chips, kept apart.

## Still to do

- Map the basket's snack items (Smith's, Shapes, Tim Tam, Doritos, Cadbury 180g, KitKat, Snickers, Snakes Alive, Lindt) to snack keys. All nine are compared in an identical pack in the 22 Oct capture.
- A cross-retailer "cheapest" view for snacks. `/api/cheapest` per-subcategory rows are produce-shaped.
- `client/src/lib/facts/snacks.js`: fact prose for the aisle (ROADMAP P2.8).
