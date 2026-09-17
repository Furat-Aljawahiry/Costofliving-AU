You are a senior product designer and art director. This is message 3 of 5 for the **Cost of Living AU** website. In this message design the **product detail page** at desktop 1440 and mobile 390. Reuse the masthead, footer, type and tokens from the screens you already designed.

## Context (same in every message)

Product: **Cost of Living AU** — the public price record for Australian groceries. Not a shopping app; a measurement system that shows its working. We crawl Woolworths and Coles weekly (Aldi and markets later), keep every capture, and can therefore backtrack any product's price over time, compare stores like-for-like on unit price ($/kg, $/L, $/each), show the cheapest line per subcategory, and check whether a "special" was ever really at its "was" price. Audience: Australian shoppers first, journalists and researchers second. Tone: honest, plain-spoken, slightly cheeky, Australian — data journalism (ABC News / Guardian Datablog) crossed with the physical language of a supermarket.

## Art direction (apply to everything)

- **Never:** purple/blue gradients, glassmorphism, 3D blobs or isometric illustrations, the "centred hero + three feature cards" template, stock photos of smiling families, emoji as icons, rounded-everything sameness, decorative sparkles.
- **Always:** editorial layout on a real grid, asymmetric composition, generous whitespace, big confident numbers. Type: high-contrast display serif for headlines (Fraunces / Instrument Serif) + neutral grotesk for UI + monospace for prices; tabular figures on every number.
- **Imagery:** real groceries — cut-outs on flat, slightly off-kilter colour fields; extreme close-ups (potato skin, milk splash, cracked egg) as full-bleed texture. Use supermarket vocabulary as *functional UI containers*: the yellow shelf-edge SPECIAL ticket is the price cell, the thermal receipt is the basket summary, the barcode is the provenance strip, the deli-scale readout is the big price number.
- **Colour:** warm paper off-white base, near-black ink, one produce-derived accent (tomato or beetroot). Semantic: cheapest = green ink; rise = red-orange; fall = green; special = ticket yellow. Retailer colours only on store badges and chart lines: Woolworths #178841, Coles #E01A22, Aldi #F0A500, Market #6A4C93. Light and dark modes as tokens. Small radii — not a bubbly UI.
- **Data:** AUD, two decimals, always show the unit basis. Real values only, no lorem ipsum. Last capture 4 Sep 2026.

## The product detail page

The atomic page of the site and the SEO landing page ("the price of potatoes in Australia"). Design it for **Potatoes (brushed)** and make sure the same layout works for a packaged item like **Coles Kitchen Potato Salad 800g**.

### Header
- Breadcrumb "Home › Fruit & vegetables › Potatoes".
- Large product cut-out on a flat colour field, off-grid. Product name in display serif. Size options as tabs: 1kg · 2kg · 4kg · loose.
- A **Measured** badge (alternate variant: **Estimated**) with a provenance popover on hover: "Source: Coles online · Run 20260904041651-f5d03077 · Captured 4 Sep 2026 04:16 UTC · Matched SKU 3586446". Render the provenance strip as a barcode-style element.

### Price now
- One deli-scale readout per store — Woolworths · Coles · Aldi · Market — big mono price, unit price under it, store badge. The cheapest one in green ink with a "Cheapest" label. Example: Woolworths $4.50/kg · Coles $2.95/kg (cheapest, SPECIAL was $3.90) · Aldi $3.29/kg · Market $3.00/kg.
- A plain sentence beneath: "Cheapest today: Coles at $2.95/kg — 34% under Woolworths."

### Price history chart — the hero of this page
- Full-width line chart, one line per store. Colour **plus** a distinct marker shape and an end-of-line label per store, so it works for colourblind readers.
- Range selector: 1M · 3M · 1Y · All. Y-axis in $/kg. X-axis dates.
- **Overlay the retailer's claimed "was" price as a dashed horizontal line**, labelled "Coles says 'was $3.90'", so the reader can see whether the line ever touched it.
- Specials shown as small ticket-yellow markers on the line.
- Hover tooltip: date, price, unit price, "SPECIAL" flag if any, and a provenance line (source · run id · captured-at).
- Editorial caption under the chart: "Coles has been at or below $3.20/kg in 11 of the last 12 weeks."

### "Was it ever that price?" panel
A ticket-shaped panel: "Marked down from $3.90. Observed at $2.95 in 11 of the last 12 weeks." Verdict chip: **Questionable** (alternate: **Genuine**). Small print: "Compared against our own captures of the same SKU."

### Unit price across pack sizes
Horizontal bar comparison: 1kg $4.00/kg · 2kg $4.40/kg · 4kg $3.75/kg. When a larger pack is dearer per kg, add a callout "Bigger isn't cheaper: the 2kg bag costs 10% more per kilo than the 1kg."

### Shrinkflation panel (show it filled, for the packaged variant)
Before/after pack illustration side by side: "2025: 200g for $4.50 · 2026: 180g for $4.50 · effective rise +11% per 100g". Hide the panel when there is no size change.

### Substitutes
"Cheaper like-for-like in Potatoes": three small cards — product, store badge, unit price, "−22% per kg".

### All matched SKUs (collapsed by default)
Table: retailer · SKU · display name · size · price · link out.

### Share card preview
A 1200×630 card generated from this page: product cut-out, big price, store badge, sparkline, "costofliving.au" mark.

### Mobile (390)
Header stacks; deli-scale readouts become a 2×2 grid; chart is full-width with a horizontally scrollable range; panels stack in the same order.

## Before you finish

Ask: "Would a design-literate person guess this was AI-generated?" If yes, fix it — kill any gradient, add a real caption or footnote, and let the product photography and the chart carry the page.
