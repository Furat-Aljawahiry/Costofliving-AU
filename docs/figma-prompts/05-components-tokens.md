You are a senior product designer and art director. This is message 5 of 5 for the **Cost of Living AU** website. In this message **consolidate everything into a component library, design tokens, file structure and prototype**, and then review every screen against the quality bar.

## Context (same in every message)

Product: **Cost of Living AU** — the public price record for Australian groceries. Not a shopping app; a measurement system that shows its working. We crawl Woolworths and Coles weekly (Aldi and markets later), keep every capture, and can therefore backtrack any product's price over time, compare stores like-for-like on unit price ($/kg, $/L, $/each), show the cheapest line per subcategory, and check whether a "special" was ever really at its "was" price. Audience: Australian shoppers first, journalists and researchers second. Tone: honest, plain-spoken, slightly cheeky, Australian — data journalism (ABC News / Guardian Datablog) crossed with the physical language of a supermarket.

## Art direction (apply to everything)

- **Never:** purple/blue gradients, glassmorphism, 3D blobs or isometric illustrations, the "centred hero + three feature cards" template, stock photos of smiling families, emoji as icons, rounded-everything sameness, decorative sparkles.
- **Always:** editorial layout on a real grid, asymmetric composition, generous whitespace, big confident numbers. Type: high-contrast display serif for headlines (Fraunces / Instrument Serif) + neutral grotesk for UI + monospace for prices; tabular figures on every number.
- **Imagery:** real groceries — cut-outs on flat, slightly off-kilter colour fields; extreme close-ups (potato skin, milk splash, cracked egg) as full-bleed texture. Use supermarket vocabulary as *functional UI containers*: the yellow shelf-edge SPECIAL ticket is the price cell, the thermal receipt is the basket summary, the barcode is the provenance strip, the deli-scale readout is the big price number.
- **Colour:** warm paper off-white base, near-black ink, one produce-derived accent (tomato or beetroot). Semantic: cheapest = green ink; rise = red-orange; fall = green; special = ticket yellow. Retailer colours only on store badges and chart lines: Woolworths #178841, Coles #E01A22, Aldi #F0A500, Market #6A4C93. Light and dark modes as tokens. Small radii — not a bubbly UI.
- **Data:** AUD, two decimals, always show the unit basis. Real values only, no lorem ipsum. Last capture 4 Sep 2026.

## 1. Component library (Figma components with variants, auto layout)

- **Store badge** — Woolworths / Coles / Aldi / Market; sizes S, M; with and without label.
- **Price cell** — variants: default · cheapest · special · unavailable · stale · estimated. Contains shelf price (mono), unit price, store badge, optional ticket chip.
- **Unit price label** — $/kg · $/L · $/ea.
- **Delta chip** — up (red-orange) · down (green) · flat; period label ("YoY", "vs 4 wks").
- **Shelf-edge ticket** — SPECIAL / was price; the yellow supermarket ticket, used as a real container.
- **Receipt module** — thermal receipt with perforated edge; line items, subtotals, verdict line; used for basket summaries.
- **Sparkline** — with optional dashed "was" line, special markers, and faint median/max reference lines.
- **Price history chart** — full chart with per-store lines (colour + marker shape + end label), range selector, tooltip.
- **Provenance tooltip / popover** — source · run id · captured-at · matched SKU, with the barcode-strip motif.
- **Measured / Estimated badge.**
- **Verdict chip** — Genuine · Questionable.
- **Product row** (category list) and **product card** (mobile).
- **Category tile** — bento sizes S, M, L. **Subcategory cell** (cheapest-today wall).
- **Filter chip, sort dropdown, segmented control, toggle, search input, quantity stepper.**
- **Staleness banner, empty state, skeleton loaders** (row, chart, receipt).
- **Masthead, footer, breadcrumb.**
- **Share card** — 1200×630 OG template for product pages and basket summaries.

## 2. Tokens (Figma variables)

- **Colour:** light and dark modes. Paper/ink base, one accent, semantic set (cheapest, rise, fall, special, stale), retailer colours, chart colours.
- **Spacing:** 4-pt scale. **Radius:** 2 / 4 / 8 — small; the ticket and receipt shapes are the only expressive silhouettes.
- **Type scale:** display serif (48–96), heading serif (24–40), grotesk body (14–18), mono for every number with tabular figures.
- **Chart tokens:** line weights, marker shapes per store, dashed "was" line style, ticket-yellow marker.

## 3. File structure

Pages: 00 Cover · 01 Tokens · 02 Components · 03 Home · 04 Category · 05 Product · 06 Cheapest today · 07 Basket · 08 Findings (Shrinkflation, Specials checker) · 09 Trust (Methodology, Data quality) · 10 Mobile · 11 Share cards · 12 States.

## 4. Prototype

Wire two flows with real hover states: Home → Category (Canned & pantry) → Product (Diced tomatoes 400g) → back; Home → Cheapest today → Product (Potatoes). Motion: numbers count up, sparklines draw in, provenance appears on hover. Nothing bouncy.

## 5. Realistic data to use everywhere (no lorem ipsum)

- Coles, captured 4 Sep 2026 04:16 UTC, run 20260904041651-f5d03077: Hass Avocados 1 each $2.50 ($2.50/ea) · I'm Perfect Apples Prepacked 2kg $5.90 SPECIAL ($2.95/kg, median $7.50/kg, 11 candidates) · Dry Roasted Almonds 400g $7.50 SPECIAL ($18.75/kg) · Coles Kitchen Potato Salad 800g $6.50 SPECIAL ($8.10/kg, median $16.00/kg, max $34.29/kg, 13 candidates).
- Basket items: Potatoes (brushed) $3.50/kg · Brown onions $2.50/kg · Carrots $2.20/kg · Tomatoes $6.00/kg · Iceberg lettuce $3.50 ea · Bananas $4.00/kg · Full cream milk 2L $3.30 · White bread loaf $2.90 · Free-range eggs dozen $6.50 · Butter 250g $6.90 · Rice 1kg $3.00 · Pasta 500g $1.40 · Instant coffee jar $9.50 · Beef mince $14.00/kg · Chicken breast $12.00/kg · Whole chicken $6.50/kg · Bacon $16.00/kg · Tim Tam original $4.50 · Smith's chips $4.50 · Cadbury Dairy Milk 180g $6.00 · Diced tomatoes 400g $1.10 · Chickpeas 400g $1.20 · Baked beans 420g $2.20 · Tuna springwater 95g $1.50.
- Captures on 29 Aug 2026 and 4 Sep 2026; index history back to 2014.

## 6. Accessibility

WCAG AA contrast in both modes. Store lines distinguishable by colour **and** marker shape **and** label. Minimum 14px body. Tabular numerals on every number. Focus states on every interactive element.

## 7. Quality bar — do this last

Go through every screen and ask: **"Would a design-literate person guess this was AI-generated?"** If yes, fix it: replace any generic hero, kill any gradient, break the grid asymmetrically, add a real editorial detail (caption, footnote, hand-set big number), make sure the ticket / receipt / barcode motifs are doing real work, and let the product photography carry the page. Then list what you changed.
