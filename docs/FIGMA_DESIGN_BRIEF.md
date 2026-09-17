# Figma agent prompt — Cost of Living AU website

Copy everything below the line into Figma (Make / AI / First Draft) as one prompt.

---

You are a senior product designer and art director. Design the complete website UI for **Cost of Living AU** in Figma: landing page, category pages, product detail pages, supporting pages, a component library and design tokens. Every core screen at desktop (1440) and mobile (390).

## 1. What the product is

- The public price record for Australian groceries. **Not a shopping app — a measurement system that shows its working.**
- We crawl Woolworths and Coles (Aldi and local markets later) on a schedule and keep every capture, so we can backtrack a product's price over time, compare stores like-for-like on unit price ($/kg, $/L, $/each), show the cheapest line in every subcategory, and check whether a "special" was ever really at the "was" price.
- Audience: everyday Australian shoppers first; journalists and researchers who want a citable series second.
- Tone: honest, plain-spoken, slightly cheeky, Australian. Think a great data-journalism interactive (ABC News / Guardian Datablog) crossed with the physical language of a supermarket — shelf-edge tickets, receipts, price-gun stickers, deli scales. Not a fintech dashboard.

## 2. Art direction — it must not look AI-generated

**Hard no:** purple/blue gradients, glassmorphism, floating 3D blobs or isometric illustrations, the "centred hero + three feature cards" template, stock photos of smiling families with trolleys, emoji as icons, rounded-everything Dribbble sameness, decorative sparkles.

**Yes:**
- Editorial layout on a real grid, asymmetric composition, generous whitespace, big confident numbers.
- A distinctive type pairing: a high-contrast display serif for headlines (Fraunces / Instrument Serif / Tiempos-like) + a neutral grotesk for UI + a monospace for prices. Tabular figures everywhere a number appears.
- **Imagery concept:** real groceries, photographed or cut out, treated consistently. Product cut-outs on flat, slightly off-kilter colour fields. Extreme close-ups (potato skin, milk splash, cracked egg, the grain of a bread crust) as full-bleed textures. The supermarket's own graphic vocabulary as **functional UI containers, not decoration**: the yellow shelf-edge SPECIAL ticket becomes the price cell; the thermal receipt with perforated edge becomes the basket summary; the barcode becomes the provenance strip; the deli-scale readout becomes the big price number.
- **Colour:** warm paper/off-white base (not pure white), near-black ink. One brand accent derived from produce (tomato red-orange or beetroot). Semantic set: cheapest = green ink; price rise = red-orange; price fall = green; special = shelf-ticket yellow. Retailer colours appear **only** on store badges and chart lines, never as page colour: Woolworths `#178841`, Coles `#E01A22`, Aldi `#F0A500`, Market `#6A4C93`. Provide a dark theme as tokens too.
- **Motion notes for the prototype:** numbers count up, sparklines draw in, hovering a price reveals provenance. Nothing bouncy.

## 3. Screens

### 3.1 Landing page (Home)
Goal: within five seconds the visitor understands "this site tells me what groceries really cost, and it can prove it."

1. **Masthead:** wordmark "Cost of Living AU"; nav: Categories · Cheapest today · Shrinkflation · Specials checker · My basket · Methodology; search field, placeholder "Search 2,000+ products — try 'potatoes'".
2. **Hero — editorial, not a centred card.** Left: headline "What does food actually cost in Australia?" and subline "Every price, every week, from Woolworths and Coles. Recorded so you can check." Right, bleeding off the edge: one heroic product photo (a potato, larger than life) wearing a live shelf ticket: "$2.95/kg · cheapest brushed potatoes today · Coles · ↓12% vs 4 weeks ago". Below: a status line "Last captured 4 Sep 2026, 4:16am AEST · 472 products · 2 retailers".
3. **The Basket strip:** a receipt-style module. "A fixed basket of 34 everyday items costs $187.40 this week — up 3.1% on last year. ABS food CPI says 2.4%." Small chart showing our line and the ABS line diverging.
4. **Categories grid (the click-through to section 3.2):** Fruit & vegetables · Meat & poultry · Canned & pantry · Snacks · Chocolate & candy · Everyday staples. Each tile: product cut-out image, name, one-line blurb, tiny sparkline, YoY delta chip, "cheapest at [store badge]". Tiles are **unequal sizes** — an editorial bento, not a uniform 3×2.
5. **Cheapest today wall:** a dense grid of small multiples, one per subcategory (Apples, Avocados, Potatoes, Milk…), each with the cheapest buyable line, its $/kg, store badge and a 30-day sparkline. Scannable, every cell clickable.
6. **Findings row:** three editorial cards from our data — Shrinkflation ("Tim Tams: same price, two fewer biscuits"), Specials check ("'Was $9.50' — it's been $6.00 for 11 of the last 12 weeks"), Bigger isn't cheaper ("1kg bag $4.00/kg. 2kg bag $4.40/kg.").
7. **Trust strip:** Methodology · Data quality (last runs, coverage) · Download the data · Independent — no affiliate links, no retailer deals.
8. Footer.

### 3.2 Category page (e.g. "Canned & pantry")
The page for "click Pantry → see Coles vs Woolies prices and who's cheapest."

- **Header:** category name, product count, last captured, a category price index chart (2014 → today) with YoY delta.
- **Controls:** subcategory chips (Beans · Tomatoes · Tuna · Pasta · Rice…); sort (Cheapest per kg / Biggest rise / Biggest fall / A–Z); toggles "exclude organic", "exclude prepared", "specials only"; view switch Cards / Table.
- **Product rows** (one per canonical product, not per retailer SKU):
  - thumbnail, name, pack size(s), tier tag (Fresh / Brand / Home brand)
  - **one price cell per store** (Woolworths, Coles, Aldi, Market), each showing shelf price and unit price. The cheapest cell gets the green "Cheapest" treatment. Specials show a shelf-ticket chip "SPECIAL · was $X". Unavailable shows a dashed empty cell "not stocked".
  - a 12-month sparkline and delta chip
  - a spread figure: "Coles is 18% more"
- **Table view:** same data, dense and sortable, sticky header, tabular numbers.
- **Aside:** "Cheapest basket for this category" — a receipt of the cheapest line per subcategory today and which store wins overall; plus "Biggest movers this month".
- **Stale state:** "No recent data for Aldi" — never render a stale price as current.

### 3.3 Product detail page (the atomic page; SEO landing)
E.g. "Potatoes (brushed), 1kg" or "Coles Kitchen Potato Salad 800g".

- **Header:** product image, name, size options as tabs (500g / 1kg / 2kg), breadcrumb (Fruit & veg › Potatoes), a **Measured / Estimated** badge with provenance popover: source, run id, captured-at, matched SKU.
- **Price now:** big deli-scale number per store with unit price; cheapest highlighted; a sentence "Cheapest today: Coles $2.95/kg — 34% under Woolworths".
- **Price history chart — the hero of this page.** One line per store (colour + distinct marker shape + label so it works for colourblind users). Range selector 1M / 3M / 1Y / All. Hover tooltip: exact price, date, special flag, provenance. **Overlay the retailer's claimed "was" price as a dashed horizontal line** so you can see whether it was ever touched. Specials appear as small yellow ticket markers on the line.
- **"Was it ever that price?" panel:** "Marked down from $9.50. Observed at $6.00 in 11 of the last 12 weeks." Verdict chip: Genuine / Questionable.
- **Unit price across pack sizes:** bar comparison with a "bigger isn't cheaper" callout when the larger pack has a higher $/kg.
- **Shrinkflation panel** (when applicable): before/after pack illustration, net size then vs now, effective per-kg rise.
- **Substitutes:** "Cheaper like-for-like in this subcategory" — three cards.
- **All matched SKUs** (retailer, SKU, size, link) — collapsible.
- **Share card preview** (auto-generated OG image).

### 3.4 Cheapest today (the Potato Index page)
The full wall of small multiples, filterable by department / category. State the selection rule verbatim at the top: "the cheapest buyable line in each subcategory, organic and prepared lines excluded, compared on unit price." Each cell shows median and max as faint reference so a spike reads as "one promotion ended", not "the market moved". Show the candidate count.

### 3.5 Build your basket → personal CPI
Tick the items you actually buy (searchable checklist), set quantities, see your basket's cost today and its inflation line against the ABS food CPI line. Save and share as a URL. Design the shareable summary card.

### 3.6 Shrinkflation leaderboard
"The 20 products that shrank most this year" — before/after pack illustrations, size then vs now, price then vs now, effective % rise.

### 3.7 Specials checker
Search a product or paste a retailer URL; get the verdict and the sparkline with the claimed "was" line.

### 3.8 Methodology + Data quality dashboard
Plain and credible: basket selection, matching rules, the cheapest-line rule, known gaps. Dashboard of last run per retailer, coverage %, row counts, warnings — we publish our own failures.

### 3.9 Search results, 404, loading skeletons, error and empty states.

## 4. Component library (Figma components with variants)

- Store badge (Woolworths / Coles / Aldi / Market; S / M)
- Price cell (default · cheapest · special · unavailable · stale · estimated)
- Unit price label ($/kg · $/L · $/ea)
- Delta chip (up · down · flat; with period label)
- Shelf-edge ticket (SPECIAL / was price)
- Receipt module (basket summary)
- Sparkline (optional was-line and special markers)
- Price history chart + provenance tooltip
- Measured / Estimated badge with provenance popover
- Product card · subcategory tile · category tile (bento sizes)
- Filter chip · sort dropdown · segmented control · search input
- Staleness banner · empty state · skeleton loaders
- Nav · footer · share card (1200×630 OG template)

## 5. Use realistic data — no lorem ipsum

- Coles, captured 4 Sep 2026: Hass Avocados 1 each $2.50 ($2.50/ea) · I'm Perfect Apples Prepacked 2kg $5.90 SPECIAL ($2.95/kg, median $7.50/kg, 11 candidates) · Dry Roasted Almonds 400g $7.50 SPECIAL ($18.75/kg) · Coles Kitchen Potato Salad 800g $6.50 SPECIAL ($8.10/kg, median $16.00/kg, 13 candidates).
- Basket items: Potatoes (brushed) $3.50/kg · Brown onions $2.50/kg · Full cream milk 2L $3.30 · White bread loaf $2.90 · Free-range eggs dozen $6.50 · Butter 250g $6.90 · Beef mince $14.00/kg · Chicken breast $12.00/kg · Tim Tam original $4.50 · Cadbury Dairy Milk 180g $6.00 · Diced tomatoes 400g $1.10 · Tuna springwater 95g $1.50.
- Captures on 29 Aug 2026 and 4 Sep 2026; index history back to 2014.
- Currency AUD, two decimals, always show the unit basis.

## 6. Tokens and deliverables

- Figma variables: colour (light + dark modes), spacing (4-pt), radius (small — this is not a bubbly UI), type scale, chart colours.
- Auto layout throughout; responsive frames at 1440 and 390 for Home, Category, Product, Cheapest today.
- Prototype flows: Home → Category (Canned & pantry) → Product → back; Home → Cheapest today → Product.
- Page structure: 00 Cover · 01 Tokens · 02 Components · 03 Home · 04 Category · 05 Product · 06 Cheapest today · 07 Basket · 08 Findings (Shrinkflation, Specials) · 09 Trust (Methodology, Data quality) · 10 Mobile · 11 Share cards.
- Accessibility: WCAG AA contrast; colourblind-safe store lines (colour + marker shape + label); 14px minimum body; tabular numerals.

## 7. Quality bar

Before finishing, review every screen against one question: **"Would a design-literate person guess this was AI-generated?"** If yes, fix it — replace the generic hero, kill the gradient, break the grid asymmetrically, add a real editorial detail (a caption, a footnote, a hand-set big number), and let the product photography carry the page.
