# Meat, poultry & seafood: discovery crawl, 18 Oct 2026

Before the category was built, both retailers were crawled locally, and the output was read by hand. This file records what that crawl showed. The weight rules in `server/data/meat/weights.js` and the vocabulary in `server/data/meat/lexicon.js` rest on it.

## How to reproduce

```sh
export MSYS_NO_PATHCONV=1    # Git Bash on Windows rewrites "/browse/..." into a Windows path otherwise
python data/scripts/crawl_category.py --retailer coles --category meat-seafood \
    --url /browse/meat-seafood --name "Meat & Seafood" --out data/scratch/meat/coles_meat-seafood_<date>
python data/scripts/crawl_category.py --retailer woolworths --category 1_D5A2236 \
    --url /shop/browse/poultry-meat-seafood --name "Poultry, Meat & Seafood" \
    --out data/scratch/meat/woolworths_poultry-meat-seafood_<date>
node server/scripts/meat-report.mjs          # -> data/review/meat/
```

The output goes to `data/scratch/` (gitignored), **not** `data/out`. The server loads every CSV under `data/out`.

## The two shelves

| | Coles | Woolworths |
|---|---|---|
| Category | `meat-seafood`, "Meat & Seafood" | `1_D5A2236`, "Poultry, Meat & Seafood" |
| Reported / written | 572 / **555** (status partial, see below) | 606 / 606 (complete) |
| Store (egress direct) | 7674 | 1101 |
| Rows with a price | 555 | 553 (53 unavailable at $0) |

**Coles pagination drift.** Pages 9–12 returned tiles already seen, so 17 products were never reached. The crawl reported no error, just fewer rows. A second pass to fill the gap was blocked by the Coles interstitial on the direct IP, and no proxy was configured locally. The Lambda crawls through the residential proxy, so this does not carry over. A complete run is still needed before sign-off (see `docs/MEAT_DATA_TODO.md`).

**What else is on the shelves.** Both carry far more than fresh meat:
- Woolworths: about 110 deli-counter and smallgoods lines (shaved ham, salami, bacon), plus a large seafood section.
- Coles: a 54-row Halal block, an 18-row Kosher block, and ready meals ("Made Easy").

These rows are kept and listed, but out of scope rows are never matched.

## How each retailer states weight

This is the finding that decides how meat is compared.

| Stated as | Who | Rows | What the shelf price is |
|---|---|---|---|
| `500g`, `1Kg` | both | 409 C / 411 W | the price of that pack |
| `approx. 1.65kg` | Coles | 145 | $/kg × the approximate weight, an **estimate** (144 of 146 check out) |
| `1.1kg - 1.7kg` | Woolworths | 109 | $/kg × the **top** of the range (**95 of 95** check out) |
| `per 100g`, `per 350g` | Woolworths | 70 | the price **is** the $/kg (service counter, you choose the amount) |
| `each`, `12 pack` | both | 1 C / 16 W | no weight at all |

Consequences:

1. The crawler sets `net_size_value` to the **bottom** of a Woolworths range, but the price is set on the top. That alone produces 96 `CUP_PRICE_MISMATCH` warnings. After recomputing $/kg against the weight the price was actually set on, the numbers reconcile: 0 Woolworths mismatches, 1 drift. The remaining Coles mismatch is a typo, "approx. 1.02g" for 1.02 kg.
2. Woolworths marks no range as `is_variable_weight`, because it only looks for "approx".
3. Because a shelf price can be an estimate or a maximum, **meat is compared per kg only**. The retailer's cup price is the one figure both actually charge.
4. Weight still matters, for **size**: a 1 kg tray is cheaper per kg than a 500 g one. Packs more than 1.5× apart are shown side by side and not compared (decided with you on 18 Oct). Ranges use their midpoint, and counter lines compare with any pack.

## Naming

- **Brands.** Coles' own name usually omits the brand, which sits in the brand column: "Beef Mince", brand El-Amin's. Woolworths' name usually starts with it ("Woolworths …", "Macro …"). Brand is ignored for matching (your ruling, 18 Oct) and stripped first.
- **Mince grades.**
  - Coles: "Regular" / "3 Star", "Lean" (4 star), "Extra Lean" / "5 Star", and Cleaver's "Premium".
  - Woolworths: plain "Beef Mince" (regular), "Lean", and "Heart Smart Extra Lean".
- **Prepared lines.** These are named by flavour ("Honey & Soy" vs "Honey Soy"). Woolworths' marinated range puts **"BBQ"** in front of every line ("Woolworths BBQ Chicken Breast Steaks Greek Style"), so "BBQ" alone does not mean BBQ flavour.
- **Crumbed lines.** Both retailers put these in a `CRUMBED` subcategory, even when the name does not say so ("Chicken Tenders").
- **Single-quality brands.** Some brands say their quality only through the brand: The Bare Bird and Lilydale are always free range, Inglewood and Cleaver's always organic.

## Result (`data/review/meat/summary.txt`)

152 match keys at both retailers, covering 254 Coles and 220 Woolworths products: 505 SKU pairs, 281 of them comparable per kg. Comparable means from both products' pages, after the independent review. Every unmatched product is listed with its three nearest candidates at the other retailer and the exact difference that blocked each.
