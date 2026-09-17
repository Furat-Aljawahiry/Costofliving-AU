You are a senior product designer and art director. This is message 1 of 5 for the **Cost of Living AU** website. In this message design the **landing page** at desktop 1440 and mobile 390.

## Context (same in every message)

Product: **Cost of Living AU** — the public price record for Australian groceries. Not a shopping app; a measurement system that shows its working. We crawl Woolworths and Coles weekly (Aldi and markets later), keep every capture, and can therefore backtrack any product's price over time, compare stores like-for-like on unit price ($/kg, $/L, $/each), show the cheapest line per subcategory, and check whether a "special" was ever really at its "was" price. Audience: Australian shoppers first, journalists and researchers second. Tone: honest, plain-spoken, slightly cheeky, Australian — data journalism (ABC News / Guardian Datablog) crossed with the physical language of a supermarket.

## Art direction (apply to everything)

- **Never:** purple/blue gradients, glassmorphism, 3D blobs or isometric illustrations, the "centred hero + three feature cards" template, stock photos of smiling families, emoji as icons, rounded-everything sameness, decorative sparkles.
- **Always:** editorial layout on a real grid, asymmetric composition, generous whitespace, big confident numbers. Type: high-contrast display serif for headlines (Fraunces / Instrument Serif) + neutral grotesk for UI + monospace for prices; tabular figures on every number.
- **Imagery:** real groceries — cut-outs on flat, slightly off-kilter colour fields; extreme close-ups (potato skin, milk splash, cracked egg) as full-bleed texture. Use supermarket vocabulary as *functional UI containers*: the yellow shelf-edge SPECIAL ticket is the price cell, the thermal receipt is the basket summary, the barcode is the provenance strip, the deli-scale readout is the big price number.
- **Colour:** warm paper off-white base, near-black ink, one produce-derived accent (tomato or beetroot). Semantic: cheapest = green ink; rise = red-orange; fall = green; special = ticket yellow. Retailer colours only on store badges and chart lines: Woolworths #178841, Coles #E01A22, Aldi #F0A500, Market #6A4C93. Light and dark modes as tokens. Small radii — not a bubbly UI.
- **Data:** AUD, two decimals, always show the unit basis. Real values only, no lorem ipsum. Last capture 4 Sep 2026.

## The landing page

Goal: within five seconds the visitor understands "this site tells me what groceries really cost, and it can prove it."

Sections, top to bottom:

1. **Masthead.** Wordmark "Cost of Living AU". Nav: Categories · Cheapest today · Shrinkflation · Specials checker · My basket · Methodology. Search field, placeholder "Search 2,000+ products — try 'potatoes'".

2. **Hero — editorial, not a centred card.** Left column: headline "What does food actually cost in Australia?" and subline "Every price, every week, from Woolworths and Coles. Recorded so you can check." Right column, bleeding off the page edge: one heroic product photo (a brushed potato, larger than life) wearing a live shelf-edge ticket that reads "$2.95/kg · cheapest brushed potatoes today · Coles · ↓12% vs 4 weeks ago". Under the hero a quiet status line: "Last captured 4 Sep 2026, 4:16am AEST · 472 products · 2 retailers".

3. **The Basket strip.** A receipt-style module with perforated edge. "A fixed basket of 34 everyday items costs $187.40 this week — up 3.1% on last year. ABS food CPI says 2.4%." Beside it a small two-line chart: our basket vs the ABS line, diverging. Link "Build your own basket →".

4. **Categories grid — the main click-through.** Six tiles: Fruit & vegetables · Meat & poultry · Canned & pantry · Snacks · Chocolate & candy · Everyday staples. Each tile: a product cut-out image (avocado, chicken, tin of tomatoes, chips, chocolate block, milk), category name, one-line blurb, a tiny 12-month sparkline, a YoY delta chip (e.g. "+6.2% YoY"), and "cheapest at [store badge]". Tiles are **unequal sizes** — an editorial bento, not a uniform 3×2. Blurbs: Fruit & veg "Fresh produce — the most volatile prices, hit hard by weather and floods." Meat "Chicken, beef and pork — steadily the biggest riser since 2014." Canned & pantry "Long-life staples: tinned veg, beans, tuna." Snacks "Chips, crackers and biscuits from the famous brands." Chocolate "Blocks, bars and lollies — cocoa costs sent these soaring." Staples "Milk, bread, eggs, coffee — the headline cost-of-living basket."

5. **Cheapest today wall.** A dense grid of small multiples, one per subcategory (Apples, Avocados, Potatoes, Bananas, Milk, Eggs, Mince…). Each cell: subcategory name, the cheapest buyable line today, its unit price in mono, a store badge, a 30-day sparkline. Example cells: "Apples · I'm Perfect Apples 2kg · $2.95/kg · Coles · SPECIAL"; "Avocados · Hass Avocado · $2.50/ea · Coles"; "Almonds · Dry Roasted 400g · $18.75/kg · Coles". Scannable, every cell clickable, "See all 60 subcategories →".

6. **Findings row.** Three editorial cards from our own data, each with a big number and a one-line caption: Shrinkflation — "Tim Tams: same price, two fewer biscuits"; Specials check — "'Was $9.50.' It has been $6.00 for 11 of the last 12 weeks."; Bigger isn't cheaper — "1kg bag $4.00/kg. 2kg bag $4.40/kg."

7. **Trust strip.** Four quiet items: Methodology · Data quality (last runs, coverage) · Download the data (CSV) · Independent — no affiliate links, no retailer deals.

8. **Footer.** Wordmark, sitemap, "Prices are observed, not advertised. Source and capture time shown on every price."

## Mobile (390)

Same order. Hero stacks with the potato photo cropped tight behind the ticket. Categories become a single column of unequal-height tiles. Cheapest-today wall becomes a horizontally scrolling strip with a "See all" link. Search moves into the masthead as an icon that expands.

## Motion notes for the prototype

Numbers count up on load, sparklines draw in, hovering any price reveals a provenance tooltip (source, run id, captured-at). Nothing bouncy.

## Before you finish

Ask: "Would a design-literate person guess this was AI-generated?" If yes, fix it — replace the generic hero, kill any gradient, break the grid asymmetrically, add a real editorial detail (caption, footnote, hand-set big number), and let the product photography carry the page.
