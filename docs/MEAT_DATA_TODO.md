# Meat, poultry & seafood: open rulings

The meat matcher is curated judgement. This file lists every call that was made without a rule to follow, so you can overturn it.

- A ruling is changed in `server/data/meat/lexicon.js` or `names.js`, or by a dated entry in `server/data/matching/overrides.js`. Never patch it in the matcher.
- After any change, re-run `node server/scripts/meat-report.mjs` and `npm run test:server`. The adversarial fixture (`server/data/meat/fixtures/adversarial.json`) pins each ruling below with a note.

## Status: live since 18 Oct 2026

- [x] **Lambda deployed.** `costofliving-au-meat-category` (`infra/terraform/lambda_meat.tf`) crawls both retailers at 06:30 and 18:30 UTC. Output goes to `reports/supermarkets/<retailer>/meatAndPoultry`. It has its own error alarm, and drift reads the meat history.
- [x] **Published.** `meatAndPoultry.public = true`. The meat aisle page, home tile and product pages read their own category (`?category=` on `/api/items` and `/api/cheapest`). Site-wide search covers both shelves.
- [x] **Kill switch.** `HIDDEN_CATEGORIES=meatAndPoultry` takes meat off the site on the next server start, with no deploy.
- [ ] **A complete Coles crawl.** The discovery run reached 555 of 572. Check the first Lambda runs (`summary.txt` after `node server/scripts/meat-report.mjs` with `DATA_DIR=data/out`).
- [ ] **Drift alarms are per retailer, not per shelf.** A meat drift pages through the same `<retailer>-category-drift` alarm as fruit. Its maths only compares meat with meat (separate prefix), but read the manifest to see which shelf. A `Category` EMF dimension in `drift.py` would split them.
- [ ] **"Last captured" is over all public shelves.** A fresh meat run can mask a stale fruit run in the staleness banner. Make it per category when the banner is built (ROADMAP P1.5).

## Found in the 18 Oct review, outside meat

- **Produce comparisons are one-sided.** `buildMatch` checks the other SKU's availability and liveness, not the product's own. An unavailable produce SKU's page can therefore headline a comparison. Meat checks both sides; produce was left alone so published produce comparisons don't move without a decision. One line to change in `matching/index.js` (the two `meat &&` guards).

## Rulings taken (overturn any of these)

| # | Ruling | Why | Where |
|---|---|---|---|
| 1 | **Brand ignored.** Lilydale ≡ Steggles ≡ house brand when species, cut and attributes agree | Your call, 18 Oct | `names.js` strips brand |
| 2 | Packs **> 1.5×** apart are shown, not compared | Your call, 18 Oct | `weights.js` `PACK_RATIO` |
| 3 | The comparison partner is the **closest pack size**, then the cheapest per kg | From the plan. Because brand is ignored, the closest pack can be a premium brand (e.g. Coles' house smoked salmon 150 g vs Tassal Premium 150 g, +58%). The alternative is the cheapest pack within 1.5×. **Your call.** | `weights.js` `meatPairOrder` |
| 4 | Mince with **no grade stated = regular** (3★). "Premium" (Cleaver's) = lean (4★) | Woolworths' plain "Beef Mince" sits beside its "Lean" and "Heart Smart" lines | `names.js` |
| 5 | Organic chicken ⇒ free range. Organic beef and lamb ⇒ grass fed | Australian organic certification | `names.js` |
| 6 | The Bare Bird and Lilydale ⇒ free range. Inglewood ⇒ organic + free range. Cleaver's ⇒ organic | Single-quality brands | `lexicon.js` `ATTRS_FROM_BRAND` |
| 7 | Tasmanian / "Tassie" / Atlantic salmon are one species. **King, coho and sockeye** are not. **Norwegian** origin is kept as an attribute | Tasmanian salmon is farmed Atlantic salmon | `lexicon.js` |
| 8 | A fish **fillet, portion and steak** are one cut | Sold interchangeably (Huon "Salmon Steak" vs Tassal "Portions") | `names.js` |
| 9 | A chicken **fillet is skinless and boneless** unless it says otherwise. A **thigh cutlet is bone-in**. A lamb leg or shoulder roast is **on the bone** unless it says boneless | Retailer defaults | `names.js` |
| 10 | A plain "**Thigh Large Pack**" / "**Chicken Breast Small Pack**" is the **fillet** | Coles' naming; same shelf as the fillets | `names.js` |
| 11 | Sausages are **thin** unless they say thick | "Thin BBQ Sausages" (Woolworths) ≡ "BBQ Sausages" (Coles Simply) | `names.js` |
| 12 | Sausages, burgers and rissoles with **no species** in the name get species `unspecified` and only match each other | "BBQ Sausages", "Country Style Rissoles" | `lexicon.js` `UNSPECIFIED_OK` |
| 13 | Woolworths "**Pork Rashers**" ≡ Coles "Pork Belly Slices" | Both are belly rashers | `names.js` |
| 14 | "**Heart Smart**" / "lean" on an already-lean cut (fillet, eye fillet, tenderloin, backstrap, medallion, schnitzel) is ignored. It still grades mince | Woolworths' "Pork Fillet Heart Smart" is just pork fillet | `names.js` |
| 15 | Generic prepared words (marinated, seasoning, rub, glaze, sauce, flavoured, **BBQ**) are dropped when a real flavour is named | Woolworths' BBQ range prefix; "Souvlaki Seasoning" ≡ "Souvlaki" | `names.js` `GENERIC_PREP` |
| 16 | "Cooked" meat (not seafood) ≡ slow cooked. Confit ⇒ slow cooked | Luv-A-Duck "Cooked Duck Breasts" ≡ "Duck Breasts Slow Cooked" | `names.js` |
| 17 | Halal, kosher, RSPCA Approved and "No Added Hormones" are **ignored** | Both house ranges carry RSPCA and HGP-free claims. Halal/kosher is certification, not a different cut | `lexicon.js` `PHRASES`, `IGNORABLE` |
| 18 | A peeled prawn is **tail-off** unless it says tail-on. "Prawn meat" = peeled | Retailer naming | `names.js` |
| 19 | **Out of scope** (listed, never matched): deli-counter meats ("from the deli", shaved); continental smallgoods (salami, mortadella, frankfurts, kransky, pancetta, pepperoni…); ready meals and kits (lasagne, curry, stroganoff, kit, parcel, pastry, roll, pulled, sliders, selection); fats and spreads; sauces, meaning any name **ending in "sauce"**, and a sauce or slow-cooked dish that names no cut | Not fresh meat. Full list: `OUT_OF_SCOPE` | `lexicon.js`, `names.js` |
| 20 | Coles Finest "**Rib Eye Steak approx. 800g**" (2086390) is **not** a scotch fillet | $64/kg, 35% above every scotch fillet; Coles calls its boneless cut "Scotch Fillet" | `overrides.js` |
| 21 | El-Amin's "**Halal Chicken Portions Family Pack**" (1852549) is **not** Woolworths' "Mixed Pieces" | $11/kg vs $4.50/kg. "Portions" does not say what is in it (review finding 11) | `overrides.js` |
| 22 | A **service-counter** line ("per 150g") is comparable with a pack of any size, but is the **partner of last resort**: a packaged line within 1.5× wins the headline | You buy the amount you want at the counter (review finding 6) | `weights.js` |
| 23 | Coles **Made Easy** / **Ready to Eat** / **Cooked Poultry** lines are cooked (`slow_cooked`), whatever the name says. Ham and bacon are exempt: they are cured anyway | "Honey Soy Wing Nibbles" (Made Easy) was being compared with raw nibbles (review finding 1) | `names.js` |
| 24 | Woolworths **SMALLGOODS MEAT / BULK** shelf lines are cooked deli (`deli_cooked`), except ham, bacon, smoked bones and hocks. Coles' sap "SMALLGOODS" shelf is **not** included: it holds raw Cleaver's sausages and meatballs | "Primo Corned Beef Silverside" is cooked, not the butcher's raw piece (review finding 10) | `names.js` |
| 25 | Frozen and thawed are never fresh. Frozen is read from the name, the category or the subcategory (`FZN`, `FROZEN …`) | | `names.js` |
| 26 | A `CRUMBED` subcategory adds `crumbed`. A lone generic word (sauce, seasoned, glaze) becomes `marinated` | | `names.js` |
| 27 | No species word: species is taken from a breed (wagyu, angus ⇒ beef), a single-species brand (The Bare Bird, K-Roo, Luv-A-Duck), a chicken-only cut (nibbles, drumstick), then the retailer's category ("Diced Casserole" ⇒ beef) | | `names.js` |
| 28 | Synonyms: beef "fillet steak" = eye fillet; sirloin = New York strip = porterhouse; rib eye = scotch fillet (unless "bone"); lamb fry = liver; gravy beef = shin; Woolworths chicken "leg fillet" = thigh fillet; steelhead and ocean trout = trout; picanha = rump cap | | `lexicon.js` |
| 29 | A fish with no cut named is a portion. Prawn and oyster size grades are kept; size words on anything else (small, large, "medium" steak) are dropped, because the weight says it | | `names.js` |
| 30 | "Signature", "Premium" (outside mince), "Classic", "Original", "Homestyle", "Mini" and "Easy Carve" are ignored | E.g. Grill'd Signature burger vs Woolworths Classic (−54%), a consequence of ruling 1 | `lexicon.js` `IGNORABLE` |
| 31 | **Bug fix.** "Garlic **&** Herb" = "Garlic **And** Herb" (likewise lemon & herb, mustard & dill, rosemary & garlic…) | `norm()` drops "&" before the phrases run, so `(and\|&)` only ever matched "and". Tassal "Mustard & Dill" now matches Coles "Mustard And Dill" (300 g, $73.33/kg both). Moved ~20 keys on both sides, lost no pair | `lexicon.js` `PHRASES` |
| 32 | A **thin-sliced steak cut** is the thin-cut steak | Woolworths "Scotch Fillet Thin Slice" ≡ Coles "Scotch Fillet Thin Cut" ($52.50/kg both) | `names.js` |
| 33 | Talley's "**Marinated Plain**" = plain | ≡ Coles "Mussels Natural" (also Talley's, 375 g). Its garlic sibling already matched | `lexicon.js` `PHRASES` |
| 34 | **Regal** ⇒ king salmon. "Manuka **wood**" / "beech **wood**" = manuka / beech | Coles and Woolworths both sell Regal's 100 g manuka slices, under different names | `lexicon.js` `ATTRS_FROM_BRAND`, `PHRASES` |
| 35 | **Cumberland** ⇒ pork | British Sausage Co "Cumberland Sausages" (Coles) ≡ Woolworths "Classic Cumberland Pork Sausages" | `lexicon.js` `SPECIES_FROM_FLAVOUR` |
| 36 | Pork **loin medallion** = medallion. Chicken **breast tender** = tender | Macro free range pork medallion ≡ Coles free range loin medallions | `names.js` |
| 37 | A lamb **shoulder** with no other cut is the **roast** | Woolworths "Boneless Lamb Shoulder Rolled" ≡ Coles "Lamb Boneless Shoulder Roast" ($23/kg both) | `names.js` |
| 38 | Beef "**Diced Steak**" = diced beef | Graze "Diced Steak" ≡ Macro "Diced Beef" ($26/kg both). From the list below | `names.js` |
| 39 | "Extra lean" on **stir fry** is ignored, as on a fillet (ruling 14) | Macro "Organic Extra Lean Stir Fry" ≡ Coles "Organic Grass-fed Beef Stirfry" ($34.44/kg, 450 g both). From the list below | `names.js` |
| 40 | **20 one-off pairs matched by alias** (your call, 22 Oct): lamb leg diced ≡ diced lamb; Market Value BBQ burgers are beef; organic chicken strips ≡ breast strips; Ingham's oven-roasted turkey breast ≡ Coles'; turkey rissoles ≡ herb & onion; Coles sausage mince is beef; the two 700 g kyivs; organic GF beef sausages ≡ Macro organic; thin-cut ≡ plain pork loin steaks; FR lean ≡ FR regular pork mince; Italian ≡ Italian fennel sausages; butterflied lamb leg rosemary & garlic ≡ garlic & herbs; frozen ≡ deli 1 kg cooked tiger prawns; WW pork leg mini roast is boneless; **easy-carve lamb leg ≡ boneless** (it leaves the bone-in leg roasts); Coles prawn meat is raw; Coles tuna steaks ≡ yellowfin skinless; honey ≡ honey & herb BBQ sausages; lamb strips ≡ slices souvlaki; Graze extra-trim cutlets ≡ WW extra trim | No lexicon rule could join them without moving other products. An alias only applies while the SKU still parses to the key it was reviewed under | `overrides.js` (`verdict: 'alias'`) |

## Known non-matches worth a second look

- **Lean beef strips.** Woolworths "Lean Beef Strips" vs Coles "Beef Stir Fry": not matched (strip vs stir fry, plus lean).
- **Wing price gap.** Coles "Chicken Wings Value Bag 2kg" at $4.40/kg vs Woolworths wings at $6.50 to $9.00/kg: a real gap at capture time, not a matching error.
- **Same price and size, kept apart by a ruling** (from the review; say if any should match):
  - (Graze diced steak, organic stir fry and lamb leg diced now match: rulings 38–40)
  - "Quick Cook" scotch and porterhouse vs plain (thin cut)
- **Counter salmon with no skin stated.** Woolworths "Fresh Tasmanian Atlantic Salmon Fillets per 200g" states no skin, so it matches nothing, because every Coles portion states skin on or off.
- **Beef hot dogs.** Cleaver's at both retailers. Out of scope by ruling 19 (smallgoods).

## Still to do

- `parse_package_size` (crawler.py): read Woolworths ranges as variable weight, priced at the top. The server already recomputes this, so this only cleans up the crawler's own `CUP_PRICE_MISMATCH` warning.
- Map the `basket.js` meat items (chicken breast, thigh, whole chicken, beef mince, bacon) to meat keys.
- A cross-retailer "cheapest" wall for meat. `/api/cheapest` per-subcategory rows are produce-shaped, and the Cheapest page asks for `fruitAndVeg` only.
