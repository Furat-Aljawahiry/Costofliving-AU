// Editorial copy for the five aisles. This is copy, not data — the same text as
// server/data/basket.js CATEGORIES, kept here so the pages render without a
// round trip. Numbers for these aisles come from the API or not at all.
// Aisles that have a crawl behind them, and the server category each one reads
// (server/data/categories.js). An aisle not listed here is NotWired.
export const CRAWLED = { vegetables: "fruitAndVeg", meat: "meatAndPoultry", snacks: "snacks" };
// server category -> aisle id, for links back from a product page.
export const AISLE_OF = Object.fromEntries(Object.entries(CRAWLED).map(([a, c]) => [c, a]));

export const CATEGORY_COPY = {
  vegetables: { label: "Fruit & vegetables", blurb: "Fresh produce — the most volatile prices, hit hard by weather and floods." },
  meat:       { label: "Meat, poultry & seafood", blurb: "Chicken, beef, lamb, pork and seafood — steadily the biggest riser since 2014. Compared per kg only." },
  canned:     { label: "Canned & pantry",    blurb: "Long-life staples: tinned veg, beans, tuna." },
  snacks:     { label: "Snacks & confectionery", blurb: "Chips, biscuits, chocolate and lollies — cocoa costs sent these soaring. Compared only when brand, flavour and pack size are identical." },
  staples:    { label: "Everyday staples",   blurb: "Milk, bread, eggs, coffee — the headline cost-of-living basket." },
};
// Aisles that were merged into another. "Chocolate & candy" became part of
// Snacks & confectionery on 22 Oct 2026 (one ABS line, one shelf at each
// retailer); old links land on the combined aisle.
export const MERGED_AISLES = { chocolate: "snacks" };
