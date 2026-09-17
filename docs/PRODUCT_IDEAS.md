# Product Ideas — What to Display on the Website

Companion to [`../ROADMAP.md`](../ROADMAP.md). That document says *when*; this
one says *what*, and — more usefully — **what data each idea needs**, so you can
tell at a glance which ones are already unlocked and which are waiting on the
Phase 0 data supply.

Every idea below is scored on two axes:

- **Unlocked by** — the data it requires. `already have` means the current
  crawler schema or ABS already supplies it.
- **Moat** — how hard it is for a competitor to copy. **High** means it needs a
  historical archive or the size-normalised schema, i.e. it cannot be cloned by
  someone who starts today.

---

## Tier 1 — The headline features

These are the reasons someone would visit this site instead of one of the
existing shopping apps. Build these; everything else is supporting cast.

### 1. The Shrinkflation Tracker

> "Tim Tams cost the same as last year. There are two fewer biscuits in the pack."

**Unlocked by:** two or more captures of the same `canonical_product_key`, with
`net_size_value`, `pack_uom`, `units_per_pack` and `price_per_kg_aud`. Schema
already supports it; needs the archive running.
**Moat:** **High.** Requires history *and* size-aware capture. Price-only
competitors cannot retrofit this.

Detection is a diff: same product key, `net_size_value` decreased, `price_aud`
flat or up. Present it as a leaderboard — "the 20 products that shrank most this
year" — with a before/after pack illustration and the effective per-kg price
rise. The ACCC named shrinkflation an explicit consumer concern in its
supermarkets inquiry, which makes this both useful and newsworthy.

Second-order version worth building later: **skimpflation** — same size, cheaper
ingredients — is visible where `health_star_rating` moves without a size change.

### 2. "Was it ever that price?" — the special checker

> "This is marked down from $9.50. It has been $6.00 for eleven of the last twelve weeks."

**Unlocked by:** `was_price_aud`, `is_on_special`, `promo_text` plus your own
observed price history for the same SKU.
**Moat:** **High.** This is the archive doing something no snapshot can.

The retailer tells you what it claims the old price was. You know what the price
actually was, because you recorded it. Where those disagree, you have a finding.
The ACCC has pursued both major chains over allegedly illusory discounts and has
recommended mandatory disclosure of the reference price and the date range it
applied. Build the tool that checks it.

Presentation: a price-history sparkline with the claimed "was" price drawn as a
horizontal line, so the reader sees instantly whether it was ever touched.

### 3. The Potato Index — one honest number per subcategory, daily

**Unlocked by:** `already have` — `cheapest-by-subcategory.csv` is specified in
`LAMBDA_OUTPUT_SPEC.md` §3.3 and produced by the crawler today.
**Moat:** Medium-high (needs history to be interesting).

The cheapest buyable line in each `sap_subcategory`, organic and prepared lines
excluded, compared like-for-like on `$/kg`. This is the honest answer to "what
do potatoes cost", and the selection rule is already written down and
defensible. Make it the front page: a wall of small daily series, each clickable.

Show `candidates`, `median_unit_price_aud` and `max_unit_price_aud` alongside —
the spec already produces them — so a spike can be read as "one promotion ended"
rather than "the market moved".

### 4. Build your own basket → your personal CPI

**Unlocked by:** current basket + ABS series. Buildable in Phase 0/2.
**Moat:** Low technically, **high** emotionally. The share-driver.

Let a user tick the things they actually buy, then plot their basket's inflation
against the official ABS food figure. The gap between "the number on the news"
and "the number in my trolley" is the entire emotional premise of this project.
Save the basket to a URL so it is shareable and re-checkable.

### 5. Unit price truth — "bigger isn't cheaper"

> "The 1kg bag is $4.00/kg. The 2kg bag is $4.40/kg."

**Unlocked by:** `already have` — `price_per_kg_aud`, `price_per_l_aud`,
`price_per_each_aud` on every row of a single capture. **Works today, with one
crawl.**
**Moat:** Low, but it is the cheapest real feature on this list and it makes the
site immediately useful.

Australia mandates unit pricing precisely because pack sizes are hard to compare,
and the ACCC has recommended consultation on making unit pricing more legible.
Sort any subcategory by unit price and the anomalies pop out. A recurring
"bigger isn't cheaper" list is evergreen content.

---

## Tier 2 — Strong supporting features

### 6. Item detail pages
Per-item history, store spread, pack sizes, unit price, availability, and every
SKU that maps to it. The atomic page of the site, and the SEO landing target.
*Unlocked by: routing (Phase 2.1). Moat: low, but structurally required.*

### 7. The regional price penalty
Capture the same basket across a panel of postcodes — metro, outer suburban,
regional, remote — and publish the difference. `postcode` and
`fulfilment_store_id` are already columns; only one postcode (`2000`) is pinned
today. *Moat: **high**, and genuinely novel — this is under-reported in
Australia and would be original research.*

### 8. Seasonality view
"Avocados are cheapest in March." A year of produce captures gives a seasonal
curve per subcategory, which is directly actionable for shoppers and something
no shopping app shows. *Unlocked by: 12 months of archive. Moat: high.*

### 9. Substitution finder
Cheapest equivalent line within the same `sap_subcategory` and `unit_basis`,
excluding organic/prepared. "You are buying this; that one is 30% cheaper per
kg." *Unlocked by: already have. Moat: low.*

### 10. Brand vs private label gap
`brandTier` already distinguishes `branded` / `private_label` / `fresh`, and the
crawler carries `brand`. Track the premium over time — it widens and narrows in
interesting ways and is a good recurring chart. *Moat: medium.*

### 11. Health star vs price
`health_star_rating` is captured. "Does eating well cost more?" answered with
data, per category. Strong crossover appeal beyond the price-tracking audience.
*Moat: medium — few competitors capture this field at all.*

### 12. Availability / stock-out tracker
`is_in_stock`, `is_available`, `is_purchasable` and `availability_status` are all
captured per run. Nobody publishes an out-of-stock index. Shortages are news.
*Moat: high, and free — the data is already being collected.*

### 13. Price-per-100g-of-protein (and per-1000kJ)
Cheapest nutrition rather than cheapest product. Requires nutrition data beyond
the current schema, but it reframes the whole site around food security rather
than bargain hunting. *Moat: high. Effort: high.*

### 14. The time machine
Pick a date, see the receipt: what the standard basket cost that day, itemised.
Pure emotional payload once the archive is a few years deep. *Moat: high.*

---

## Tier 3 — Trust and credibility surface

These do not sound exciting and they are the reason people believe the rest.

- **15. Methodology page.** Basket selection, matching rules, the cheapest-line
  selection rule verbatim, known gaps. Linked in the footer of every page.
- **16. Public data quality dashboard.** Last run per source, coverage, row
  counts, warnings — straight from the manifests. Publishing your own failures
  is the strongest possible trust signal, and it costs nothing because the data
  already exists.
- **17. "Measured" vs "estimated" badges.** Required by `DATA_SOURCING.md` §3.4.
  Non-negotiable while any displayed price is modelled.
- **18. Provenance on hover.** Source, run id, captured-at, matched product.
- **19. Staleness states.** Past the cutoff, show "no recent data" — never a
  stale price rendered as current.
- **20. Changelog / "what changed in the data".** Basket changes, schema
  changes, corrections. Corrections published openly build more trust than never
  making mistakes.

---

## Tier 4 — Growth and distribution

- **21. Programmatic SEO pages.** One page per subcategory: "The price of milk in
  Australia", "The price of beef mince in Australia". Hundreds of pages from
  data you hold, each answering a real search query. Needs routing + SSR. The
  single highest-leverage growth item.
- **22. Auto-generated share cards.** OG images per item and per finding.
- **23. Public API + bulk CSV.** Under a clear licence. Turns researchers and
  journalists into your distribution.
- **24. Embeddable widget.** A chart a news site can drop in, attribution baked
  in.
- **25. Weekly digest email.** "What moved in your basket." The retention loop.
- **26. Price alerts / watchlist.** Needs accounts; defer until there is traffic
  worth converting.
- **27. Crowdsourced price reports.** A "report a price you saw" form with photo
  reference. Fills the Foodworks/Costco/market gap that has no scraping surface,
  and is more sustainable than an unowned manual sheet — see `DATA_SOURCING.md`
  §1.4. Needs moderation to be worth anything.

---

## Explicit non-goals

Worth writing down, because each is a plausible-sounding trap:

- **Not a shopping-list optimiser.** Frugl and TrolleyChecker do this well and
  it is a crowded, transactional market that requires complete real-time
  coverage of every retailer. You do not have that and the blocked data supply
  means you may never.
- **No affiliate links or retailer partnerships.** They are the fastest
  available revenue and they destroy the only asset that makes this project
  different — the ability to publish an unflattering finding.
- **No account wall on the core data.** The price record should be public.
- **No "cheapest store" claim without complete coverage.** The current
  cheapest-store stat is computed over modelled prices with Aldi hard-coded ~14%
  cheaper. Until coverage is real, that headline is fiction and should be
  labelled or removed.

---

## Quick wins available right now

If you want something visible this week that does not depend on Phase 0:

1. **Unit price sorting** (#5) — works off a single existing crawl file.
2. **"est." badges** (#17) — small change, large credibility gain.
3. **Real ABS history** (Roadmap 0.1) — makes the headline chart true.
4. **One theme** (Roadmap 2.2) — removes the most obvious "unfinished" signal.
5. **Methodology page** (#15) — pure writing, no new data.
