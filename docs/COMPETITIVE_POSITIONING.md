# Competitive Positioning

Companion to [`../ROADMAP.md`](../ROADMAP.md) and
[`PRODUCT_IDEAS.md`](PRODUCT_IDEAS.md).

**Note on sourcing:** the competitor descriptions below come from public
marketing material and app-store listings as of August 2026. Treat feature
claims as *approximately* right rather than verified — check the live products
before repeating anything here in public material.

---

## 1. The landscape

| Who | What they do | Where they are strong | Where they leave room |
|---|---|---|---|
| **Frugl** | Mobile app. Compares a whole grocery list across Coles, Woolworths, IGA, Aldi, Drakes. Dietary filters (gluten-free, vegan, allergen). | Broad retailer coverage, list optimisation, a genuinely good dietary-filter angle. Mobile-native. | Present tense only. No historical record, no published methodology, no analysis. |
| **TrolleyChecker** | Web. Side-by-side prices by suburb across Woolworths, Coles, Aldi, IGA. Free for search and comparison. | Suburb-level search, no install friction, free tier. | Same-day snapshot. No trend, no shrinkflation, no provenance. |
| **Retailer apps** (Woolworths, Coles, Aldi) | Own-store prices, specials, loyalty. | Authoritative for their own prices, deep integration, huge distribution. | Structurally cannot compare across chains, and have no incentive to surface a price rise or a fake special. |
| **CHOICE supermarket basket surveys** | Periodic consumer-advocacy price surveys. | Trusted brand, methodological rigour, media reach. | Low frequency, small basket, not a live or queryable dataset. |
| **ABS CPI / food price index** | Official statistics. | Authoritative, free, permanent, unblockable. | An index, not a price. Cannot answer "what do potatoes cost today". Slow and abstract for a general audience. |
| **OzBargain and deal communities** | Crowdsourced deal posts. | Real-time, high engagement, strong community. | Deals, not prices. Nothing systematic, no series, no coverage guarantee. |
| **Numbeo and global cost-of-living sites** | Crowdsourced international comparisons. | Breadth. | Thin, unverified AU data; not grocery-specific. |

### The shape of the gap

Almost everyone above is answering **"where is my trolley cheapest this week?"**
That is a transactional, present-tense question, and it is crowded.

Nobody is authoritatively answering **"what has happened to the price of food in
Australia, at product level, and can I prove it?"** That is a record-keeping
question. It is unglamorous, it compounds over time, and it is where this
project's existing assets already point.

---

## 2. The positioning statement

> **Cost of Living AU is the public price record for Australian groceries.**
> Not a shopping app — a measurement system that shows its working.

Three implications that should govern product decisions:

1. **The unit of value is the series, not the search result.** Optimise for
   "here is what happened to this product over three years", not "here is
   today's cheapest trolley".
2. **The audience is broader than shoppers.** Journalists, researchers, policy
   people and curious consumers. That audience rewards rigour and citability
   over convenience, which is fortunate, because rigour is what the repo is
   already built for.
3. **Credibility is the product.** Every feature that makes the data more
   auditable is a competitive feature, not overhead.

---

## 3. The five advantages, and what backs each one

### 3.1 A historical archive that compounds
**Why it is defensible:** history cannot be backfilled. A competitor who starts
tomorrow is permanently behind by however long you have been running.
**What backs it:** the crawler, manifest and completeness guard are built and
verified against 472 real products.
**What is missing:** it is not currently running. This is the whole of Phase 0.
Every week not collecting is a week of moat not built.

### 3.2 Size-aware, unit-normalised capture
**Why it is defensible:** the 66-column schema records `net_size_value`,
`pack_uom`, `units_per_pack`, `price_per_kg_aud`, `is_organic`, `is_prepared`.
Shrinkflation detection, unit-price truth and like-for-like comparison all fall
out of it. A competitor storing only `{product, price}` cannot retrofit this
onto data they already collected — they would have to start over.
**What backs it:** `LAMBDA_OUTPUT_SPEC.md` §6.3, and the explicit
organic/prepared exclusion rule in §3.3.

### 3.3 Provenance as a feature
**Why it is defensible:** it is a cultural commitment more than a technical one,
and commercial apps with retailer relationships structurally cannot match it.
`run_id`, `captured_at_utc`, `confidence`, per-run manifests, a published
selection rule, and a public quality dashboard that shows your own failed runs.
**What backs it:** the spec already mandates most of it. The `confidence` field
is specified and unbuilt — see Roadmap 0.5.

### 3.4 Regulatory tailwind
**Why it matters:** the ACCC's supermarket inquiry final report recommended that
large chains publish prices online and provide APIs for dynamic price
information, recommended new disclosure requirements for discount promotions
(including the reference price and the date range it applied), and named
shrinkflation as a key consumer concern.

Read that as a product brief. It describes, almost exactly, the two Tier 1
features in [`PRODUCT_IDEAS.md`](PRODUCT_IDEAS.md) — the shrinkflation tracker
and the special checker. And if the API recommendation is ever implemented, the
403 problem in `LAMBDA_OUTPUT_SPEC.md` §10.2a dissolves and this project is
already built to consume the feed on day one.

**How to use it:** frame the site as consumer-interest infrastructure, not a
bargain app. That framing attracts the media coverage, the research citations
and the institutional goodwill that a shopping app cannot get.

### 3.5 Editorial independence
**Why it is defensible:** no affiliate revenue, no retailer partnerships, no
commercial reason to soften a finding. Apps that monetise via retailer
relationships cannot publish "this chain's specials are mostly fake" — you can.
This is the thing that turns the archive into influence.
**What it costs:** a harder monetisation path. Decide deliberately; see §5.

---

## 4. Where you are weaker, honestly

Do not build a strategy that ignores these.

| Weakness | Reality |
|---|---|
| **No live data** | The single largest problem. Competitors have working coverage of four-plus retailers; you currently show modelled prices. Phase 0. |
| **One retailer, one category, one postcode** | Even when unblocked: Woolworths Fruit & Veg at postcode 2000. Coles is unverified, Aldi has no feed at all, Foodworks and Costco have no scraping surface. |
| **No mobile app** | Competitors are app-native and grocery checking is a phone activity. Mitigate with a strong mobile web experience rather than chasing an app build. |
| **Solo project** | Competitors have teams and funding. The strategy must favour things that compound automatically over things needing recurring human effort. |
| **No audience yet** | The archive strategy is slow to pay off. Tier 1 features plus the SEO play in Roadmap 4.1 are the acceleration path. |
| **Legal exposure on collection** | Documented in `DATA_SOURCING.md` §2.2. Constrains growth and rules out the aggressive tactics competitors may be using. |

---

## 5. Monetisation options, ranked by fit

Not urgent, but worth deciding before accepting the first offer that arrives.

1. **Nothing, for now.** Run it as a public-interest project. Cheapest, keeps
   every option open, and the archive keeps compounding regardless.
2. **Data licensing.** Sell archive access to researchers, media and analysts —
   the audience that most values exactly what makes you different, and the only
   revenue model that *strengthens* the credibility pitch.
3. **Grants and institutional support.** Consumer-advocacy and research funding
   exists for precisely this kind of price transparency work.
4. **Reader support / donations.** Fits the independent-publication framing.
5. **Ads.** Workable but dilutes the trust surface.
6. **Retailer affiliate links.** Best short-term revenue, and it destroys 3.5.
   Recommended: rule it out explicitly and in public — the refusal is itself a
   credibility asset.

---

## 6. The one-line strategy

Everyone else is telling shoppers where to shop this week. Be the thing that
remembers what everything cost — and can prove it.

**Sources for §1 and §3.4:**
[Frugl](https://www.frugl.com.au/) ·
[TrolleyChecker](https://trolleychecker.com.au/) ·
[ACCC supermarket inquiry recommendations](https://www.accc.gov.au/media-release/accc-recommends-supermarket-reforms-to-provide-better-outcomes-for-consumers-and-suppliers) ·
[CHOICE on the ACCC final report](https://www.choice.com.au/shopping/everyday-shopping/supermarkets/articles/accc-final-supermarkets-report)
