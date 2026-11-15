# Snacks & confectionery: discovery crawl, 22 Oct 2026

Before the category was built, both retailers were crawled locally, and the output was read by hand. This file records what that crawl showed. The rules in `server/data/snacks/` rest on it; the rulings it led to are in `docs/SNACKS_DATA_TODO.md`.

## How to reproduce

```sh
export MSYS_NO_PATHCONV=1    # Git Bash on Windows rewrites "/browse/..." into a Windows path otherwise
python data/scripts/crawl_category.py --retailer woolworths --category 1_717445A \
    --url /shop/browse/snacks-confectionery --name "Snacks & Confectionery" \
    --out data/scratch/snacks/woolworths_snacks-confectionery_<date>
python data/scripts/crawl_category.py --retailer coles --category chips-chocolates-snacks \
    --url /browse/chips-chocolates-snacks --name "Chips, Chocolates & Snacks" \
    --out data/scratch/snacks/coles_chips-chocolates-snacks_<date>
DATA_DIR=data/scratch/snacks node server/scripts/snacks-report.mjs    # -> data/review/snacks/
```

The output goes to `data/scratch/` (gitignored), **not** `data/out`. The server loads every CSV under `data/out`.

## The two shelves

One browse node at each retailer covers the same goods. The plan assumed Coles kept snacks under Pantry and biscuits on a separate shelf, which would have meant several Coles crawls. The live category tree says otherwise: "Chips, Chocolates & Snacks" is a **top-level** Coles node, and biscuits and crackers are inside it.

| | Coles | Woolworths |
|---|---|---|
| Category | `chips-chocolates-snacks`, "Chips, Chocolates & Snacks" | `1_717445A`, "Snacks & Confectionery" |
| Sub-shelves | Biscuits & Cookies, Chips, Chocolates, Crackers & Rice Cakes, Gum Mints & Lozenges, Lollies & Licorice, Snacks, New Snacks | Biscuits & Crackers, Chips, Confectionery, Gum Mints & Lozenges, Snacks, Christmas |
| Reported / written | 1,710 / **1,688** (status partial) | 2,751 / **1,810** (status partial) |
| Pages | 37 (48 per page) | 77 (36 per page) |
| Store (egress direct) | 7674 | 1101 |
| Rows with a price | 1,669 | 1,785 |

**Why Woolworths writes so few of what it reports.** 933 of its 2,751 listings are marketplace sellers, which the crawler skips (as on every shelf), and 608 sponsored tiles were duplicates. Nothing was lost to blocking: no proxy rotations.

**Coles' shortfall** is 22 rows, the same pagination drift the meat discovery run saw. The Lambda crawls through the residential proxy; check its first runs.

Both shelves carry nuts, dried fruit, muesli and protein bars, jerky and a seasonal block, so one category covers everything the old "Snacks" and "Chocolate & candy" tiles promised. They are one aisle now, as they are one ABS CPI line (115501).

## How each retailer states size

| Stated as | Who | Rows | What it means |
|---|---|---|---|
| `170g` | both | 1,668 C / 1,580 W | the total weight of the pack |
| `180g 12 pack` | Woolworths | ~60 | total weight and a count |
| `20g x 6 pack` | Woolworths | ~25 | **unit** weight × count (here 120 g) |
| `5 pack` | Woolworths | ~220 | a count only; the weight is implied by price ÷ the per-100g price |
| count in the **name** | Coles | many | "Share Pack 11 Pieces", "Multipack 8 Pack", "8x13g" |

Consequences:

1. The shelf price is the price of a fixed pack on both sides, unlike meat. Two listings of the same product in the same pack can be compared on what you actually pay.
2. The crawler wrote no `price_per_kg_aud` for Woolworths' count-only packs: it flags them `CUP_PRICE_BASIS_MISMATCH` because the package says "pack" and the cup says grams. The cup string (`$2.76 / 100G`) is still there, and the server reads the implied weight from it.
3. Pack weight cannot go in the match key, because one side may state only a count and the other only a weight (Coles "Kit Kat Muesli Bar 145g" is Woolworths' "5 pack"). The pack is checked when a pair is compared.

## Naming

- **Brand.** Coles puts it in the brand column and leaves it out of the name ("Arnott's" | "Tim Tam Chocolate Biscuits Original"). Woolworths starts every name with it ("Arnott's Tim Tam Original Chocolate Biscuits"): 1,810 of 1,810. 132 brands are spelled the same at both. The exceptions are rulings: "Kit Kat" / "KitKat", "Sour Patch" / "Sour Patch Kids", "5 Gum" / "5Gum", Coles' "Lindt Lindor" brand, and Coles filing KitKat bars under "Nestle".
- **Word order** differs freely: "Corn Chips Supreme Cheese" vs "Cheese Supreme Corn Chips". The key sorts its words.
- **Type words** are repeated or dropped at will: "Lollies Lollies", "Potato Chips" vs "Chips", "Milk Chocolate" vs nothing. The form (chip, biscuit, cracker, …) goes in the key; the words that say nothing in a form are dropped (rulings 5–7).
- **Own label** is about a quarter of each shelf (406 rows). A Coles chip is not a Woolworths chip, so these never match.

## Result (`data/review/snacks/summary.txt`)

530 match keys at both retailers. **588 SKU pairs are compared**, in an identical pack, on the shelf price. That is 39% of Coles' 1,518 branded products and 37% of Woolworths' 1,574.

A random sample of 60 compared pairs was read by hand and every one was the same product in the same pack. Three wrong pairs found while reading were fixed by rulings: Smith's 380 g Party Bag vs a 380 g 20-pack, Cadbury "Dairy Milk Snack" vs plain "Dairy Milk", and a 155 g Twisties bag vs a 152 g 8-pack.

497 of the 588 compared pairs have a special on at least one side at capture. Of the 588, 232 are the same price, Coles is cheaper on 192 and Woolworths on 164.

Every unmatched product is listed with its three nearest same-brand candidates and the exact difference that blocked each. `NEAR_MISS` (665 rows) is the bucket to read: same brand, form and pack, only the words differ.
