You are a senior product designer and art director. This is message 4 of 5 for the **Cost of Living AU** website. In this message design the **supporting pages**: Cheapest today, Build your basket, Shrinkflation leaderboard, Specials checker, Methodology + Data quality, and the utility states. Desktop 1440 for all; mobile 390 for Cheapest today and Build your basket. Reuse the masthead, footer, type and tokens from earlier screens.

## Context (same in every message)

Product: **Cost of Living AU** — the public price record for Australian groceries. Not a shopping app; a measurement system that shows its working. We crawl Woolworths and Coles weekly (Aldi and markets later), keep every capture, and can therefore backtrack any product's price over time, compare stores like-for-like on unit price ($/kg, $/L, $/each), show the cheapest line per subcategory, and check whether a "special" was ever really at its "was" price. Audience: Australian shoppers first, journalists and researchers second. Tone: honest, plain-spoken, slightly cheeky, Australian — data journalism (ABC News / Guardian Datablog) crossed with the physical language of a supermarket.

## Art direction (apply to everything)

- **Never:** purple/blue gradients, glassmorphism, 3D blobs or isometric illustrations, the "centred hero + three feature cards" template, stock photos of smiling families, emoji as icons, rounded-everything sameness, decorative sparkles.
- **Always:** editorial layout on a real grid, asymmetric composition, generous whitespace, big confident numbers. Type: high-contrast display serif for headlines (Fraunces / Instrument Serif) + neutral grotesk for UI + monospace for prices; tabular figures on every number.
- **Imagery:** real groceries — cut-outs on flat, slightly off-kilter colour fields; extreme close-ups (potato skin, milk splash, cracked egg) as full-bleed texture. Use supermarket vocabulary as *functional UI containers*: the yellow shelf-edge SPECIAL ticket is the price cell, the thermal receipt is the basket summary, the barcode is the provenance strip, the deli-scale readout is the big price number.
- **Colour:** warm paper off-white base, near-black ink, one produce-derived accent (tomato or beetroot). Semantic: cheapest = green ink; rise = red-orange; fall = green; special = ticket yellow. Retailer colours only on store badges and chart lines: Woolworths #178841, Coles #E01A22, Aldi #F0A500, Market #6A4C93. Light and dark modes as tokens. Small radii — not a bubbly UI.
- **Data:** AUD, two decimals, always show the unit basis. Real values only, no lorem ipsum. Last capture 4 Sep 2026.

## 1. Cheapest today (the "Potato Index" page)

The full wall of small multiples from the home page. At the top, the selection rule verbatim in a ticket-shaped callout: "The cheapest buyable line in each subcategory, organic and prepared lines excluded, compared on unit price." Filters: department (Fresh produce · Pantry · Meat · Dairy…) and retailer. Grid of cells, one per subcategory. Each cell: subcategory name, cheapest product, unit price in mono, store badge, SPECIAL chip if applicable, a 30-day sparkline with **median and max drawn as faint reference lines** so a spike reads as "one promotion ended", plus a small "13 candidates" count. Real cells: Apples · I'm Perfect Apples Prepacked 2kg · $2.95/kg · Coles · SPECIAL · median $7.50 · max $7.90 · 11 candidates. Avocados · Hass Avocado · $2.50/ea · Coles · 1 candidate. Almonds · Dry Roasted Almonds 400g · $18.75/kg · Coles · SPECIAL · median $18.75 · max $20.00 · 5 candidates. Deli salads · Coles Kitchen Potato Salad 800g · $8.10/kg · Coles · SPECIAL · median $16.00 · max $34.29 · 13 candidates. Mobile: two-column grid, filters in a sheet.

## 2. Build your basket → your personal CPI

Two-column layout. Left: a searchable checklist of products grouped by category, each with a checkbox and a quantity stepper (Potatoes 1kg ×2, Full cream milk 2L ×3, White bread ×1, Free-range eggs dozen ×1, Beef mince 500g ×1, Tim Tam ×1…). Right, sticky: a thermal receipt that updates live — line items, subtotal per store, "Cheapest overall: Aldi $61.20", and a big number "Your basket is up 5.4% on last year — ABS food CPI says 2.4%". Under it a two-line chart, your basket vs ABS, from 2014. Buttons: "Save & share link", "Download CSV". Also design the **shareable summary card** (1200×630): receipt motif, the two numbers, the sparkline, "costofliving.au". Mobile: checklist on top, receipt as a collapsible bottom sheet.

## 3. Shrinkflation leaderboard

Headline "The 20 products that shrank most this year". Sub: "Same price. Less in the packet." A ranked list; each row has a before/after pack illustration, product name, "2025: 200g · 2026: 180g", price then/now, and a big red-orange "+11% per 100g" figure. Row 1 example: Tim Tam Original — 200g → 180g, $4.50 → $4.50, +11.1%. Filter by category. A footnote explains detection: "Same product key, net size decreased, shelf price flat or up."

## 4. Specials checker

A single search box: "Search a product or paste a Woolworths / Coles link". Result card: product, the retailer's claim "Was $9.50, now $6.00", a sparkline with the claimed "was" price as a dashed line, and a verdict ticket — **Questionable**: "Observed at $6.00 in 11 of the last 12 weeks. Never seen at $9.50." Alternate **Genuine** variant: "Sold at $9.50 for 9 of the last 12 weeks." Show a recent-checks list beneath.

## 5. Methodology and Data quality

**Methodology:** plain long-form page, serif headings, numbered sections — basket selection, product matching, the cheapest-line rule, unit price normalisation, what "Measured" vs "Estimated" means, known gaps. Pull quotes in the margin. **Data quality dashboard:** a grid of run cards, one per retailer — last run time, status (OK / partial / failed), products captured (e.g. "472 / 480"), coverage %, warnings count — plus a 30-day run history strip. Failed runs shown honestly in red-orange; the caption reads "We publish our own failures."

## 6. Utility states

Search results page (product rows with store prices and cheapest highlighted). 404 with a product cut-out and "This aisle doesn't exist." Loading skeletons for a product row, a chart and a receipt. An API error state: "Couldn't reach the price record. Try again shortly." A staleness banner: "No capture in the last 7 days — prices shown are from 29 Aug 2026." An empty state for a category with no data yet.

## Before you finish

Ask: "Would a design-literate person guess this was AI-generated?" If yes, fix it — kill any gradient, break the grid, add an editorial caption or footnote, and let the receipts, tickets and product cut-outs carry the page.
