You are a senior product designer and art director. This is message 2 of 5 for the **Cost of Living AU** website. In this message design the **category page** (use "Canned & pantry" as the example) at desktop 1440 and mobile 390. Reuse the masthead, footer, type and tokens from the landing page you already designed.

## Context (same in every message)

Product: **Cost of Living AU** — the public price record for Australian groceries. Not a shopping app; a measurement system that shows its working. We crawl Woolworths and Coles weekly (Aldi and markets later), keep every capture, and can therefore backtrack any product's price over time, compare stores like-for-like on unit price ($/kg, $/L, $/each), show the cheapest line per subcategory, and check whether a "special" was ever really at its "was" price. Audience: Australian shoppers first, journalists and researchers second. Tone: honest, plain-spoken, slightly cheeky, Australian — data journalism (ABC News / Guardian Datablog) crossed with the physical language of a supermarket.

## Art direction (apply to everything)

- **Never:** purple/blue gradients, glassmorphism, 3D blobs or isometric illustrations, the "centred hero + three feature cards" template, stock photos of smiling families, emoji as icons, rounded-everything sameness, decorative sparkles.
- **Always:** editorial layout on a real grid, asymmetric composition, generous whitespace, big confident numbers. Type: high-contrast display serif for headlines (Fraunces / Instrument Serif) + neutral grotesk for UI + monospace for prices; tabular figures on every number.
- **Imagery:** real groceries — cut-outs on flat, slightly off-kilter colour fields; extreme close-ups (potato skin, milk splash, cracked egg) as full-bleed texture. Use supermarket vocabulary as *functional UI containers*: the yellow shelf-edge SPECIAL ticket is the price cell, the thermal receipt is the basket summary, the barcode is the provenance strip, the deli-scale readout is the big price number.
- **Colour:** warm paper off-white base, near-black ink, one produce-derived accent (tomato or beetroot). Semantic: cheapest = green ink; rise = red-orange; fall = green; special = ticket yellow. Retailer colours only on store badges and chart lines: Woolworths #178841, Coles #E01A22, Aldi #F0A500, Market #6A4C93. Light and dark modes as tokens. Small radii — not a bubbly UI.
- **Data:** AUD, two decimals, always show the unit basis. Real values only, no lorem ipsum. Last capture 4 Sep 2026.

## The category page

This is the page a visitor lands on after clicking "Canned & pantry" on the home page. Its job: **show every product in the category with its price at each store, side by side, and make the cheapest store obvious at a glance** — while showing how the category has moved over time.

### Header
- Breadcrumb "Home › Canned & pantry". Category name as display serif. Product count ("38 products · 9 subcategories"), last captured ("4 Sep 2026, 4:16am AEST").
- Right side: a category price index chart, 2014 → today, one line, with a YoY delta chip ("+4.8% YoY") and a one-line caption ("Tinned tomatoes drove most of this year's rise").
- A cut-out product image (a tin of diced tomatoes) tucked into the header, off-grid.

### Controls bar (sticky on scroll)
- Subcategory chips: All · Beans & legumes · Tomatoes · Tuna & fish · Pasta · Rice · Soup · Corn · Sauces.
- Sort dropdown: Cheapest per kg · Biggest rise · Biggest fall · Biggest store gap · A–Z.
- Toggles: exclude organic · exclude prepared · specials only.
- View switch: Cards · Table.

### Product list — one row per product (not per retailer SKU)
Row anatomy, left to right:
1. Thumbnail, product name, pack size ("400g"), tier tag (Fresh / Brand / Home brand).
2. **Four price cells — Woolworths · Coles · Aldi · Market.** Each cell shows shelf price large in mono and unit price small underneath ("$1.10 · $2.75/kg"). Store badge in the cell corner.
   - The **cheapest cell** gets the green-ink treatment: green price, thin green rule, small "Cheapest" label.
   - A **special** gets a shelf-edge ticket chip in ticket yellow: "SPECIAL · was $1.50".
   - **Not stocked** is a dashed, empty cell reading "not stocked".
   - **Stale** (no capture within 7 days) is greyed with "no recent data" — never show an old price as current.
3. A 12-month sparkline and a delta chip ("+9% YoY").
4. Spread: "Coles is 18% more" — the gap between dearest and cheapest.

Use these real rows: Diced tomatoes 400g — Woolworths $1.10 · Coles $1.30 · Aldi $0.99 (cheapest) · Market not stocked. Chickpeas 400g — Woolworths $1.20 · Coles $1.20 · Aldi $0.95 (cheapest). Baked beans 420g — Woolworths $2.20 SPECIAL was $2.60 · Coles $2.60 · Aldi $1.85 (cheapest). Tuna springwater 95g — Woolworths $1.50 · Coles $1.50 · Aldi $1.19 (cheapest). Corn kernels 420g — Woolworths $1.60 · Coles $1.70 · Aldi $1.35 (cheapest). Pasta 500g — Woolworths $1.40 · Coles $1.40 · Aldi $0.99 (cheapest). Rice 1kg — Woolworths $3.00 · Coles $3.20 · Aldi $2.49 (cheapest).

### Table view
Same data as a dense sortable table: sticky header, tabular numerals, store columns, cheapest cell tinted green, sort arrows, unit price as a secondary line in every cell.

### Right-hand aside (desktop)
- **"Cheapest basket for this category"** as a thermal receipt: one line per subcategory with the cheapest product, store badge and price; subtotal per store; a verdict line "Aldi wins this category by $4.12". Buttons: "Add to my basket", "Share".
- **Biggest movers this month:** five rows, product + delta chip + sparkline.
- **Selection rule** in small print: "Cheapest buyable line per subcategory, organic and prepared lines excluded, compared on unit price."

### Mobile (390)
Controls collapse into a filter sheet. Each product becomes a card: name and size on top, the four store prices as a 2×2 grid of ticket-style cells with the cheapest in green, sparkline and spread underneath. Aside content moves below the list.

## Before you finish

Ask: "Would a design-literate person guess this was AI-generated?" If yes, fix it — kill any gradient, break the grid, add an editorial caption or footnote, and let the product cut-outs and the ticket motif do the work.
