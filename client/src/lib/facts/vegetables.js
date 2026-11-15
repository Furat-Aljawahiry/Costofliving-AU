// "Did you know?" facts for the Fruit & vegetables aisle (ABS series 114120).
//
// Each fact: { id, source, highlight, text, note, when? }
//   source    "abs" — the number comes from the ABS series; "general" — a
//             well-known market fact we do not measure.
//   highlight { from, to, label } quarters to shade on the index chart, or
//             null when the period is off the chart (nothing to show).
//   text(s)   -> array of strings and { figure } items (see compute.js).
//             One plain sentence, the number as the figure, no quarter names —
//             those go in `note`, which is shown under the chart.
//   when(s)   optional guard: return false to hide a fact that has stopped
//             being true (e.g. "we're at an all-time high").

const FACTS = [
  {
    id: "volatile",
    source: "abs",
    highlight: null,
    text: (s) => {
      const big = s.count(s.qoqs(), (v) => Math.abs(v) > 3);
      const foodBig = s.count(s.qoqs(s.food), (v) => Math.abs(v) > 3);
      return ["Fruit & veg is the wildest thing in your trolley: prices moved more than 3% in ", s.fig(`${big} of ${s.qoqs().length}`), ` quarters since 2014. All food together did that ${foodBig === 1 ? "once" : `${foodBig} times`}.`];
    },
    note: "Fresh produce cannot be stockpiled and is almost all grown here, so supply — and price — is set by the weather. Quarter-to-quarter swings are four to five times bigger than for food overall.",
  },
  {
    id: "floods-2022",
    source: "abs",
    highlight: { from: "2022-Q1", to: "2022-Q3", label: "2022 floods" },
    text: (s) => ["Fruit & veg prices jumped ", s.pct(s.change("2021-Q4", "2022-Q3")), " in nine months in 2022 after the east-coast floods."],
    note: "The February–March 2022 floods (Lismore, Brisbane, Sydney) were followed by more flooding in July and October under La Niña, while fuel, freight and fertiliser costs rose after the invasion of Ukraine. The September 2022 quarter was up 16.2% on a year earlier — the biggest annual rise in the series.",
  },
  {
    id: "lettuce",
    source: "general",
    highlight: { from: "2022-Q2", to: "2022-Q2", label: "$12 lettuce" },
    text: (s) => ["Remember the ", s.fig("$12"), " iceberg lettuce? KFC swapped lettuce for cabbage in its burgers."],
    note: "In June 2022, after floods in Queensland and NSW, a head of iceberg lettuce was widely reported at $10–12 in the big supermarkets. KFC Australia announced it was using a lettuce-and-cabbage blend until supply recovered.",
  },
  {
    id: "crash-2022",
    source: "abs",
    highlight: { from: "2022-Q4", to: "2022-Q4", label: "supply recovers" },
    text: (s) => ["After the 2022 spike, fruit & veg prices fell ", s.pct(s.qoq("2022-Q4"), { sign: false }), " in a single quarter — the sharpest drop on record."],
    note: "December 2022 quarter. Flood-hit crops were replanted and harvested within months, and lettuce, broccoli and other vegetables dropped straight back to normal prices.",
  },
  {
    id: "covid-2020",
    source: "abs",
    highlight: { from: "2020-Q1", to: "2020-Q3", label: "COVID + bushfires" },
    text: (s) => ["COVID pushed fruit & veg up ", s.pct(s.qoq("2020-Q1")), " in a single quarter — and prices stayed high for the rest of 2020."],
    note: "March 2020 quarter. The ABS put the rise down to drought and the Black Summer bushfires cutting supply, plus panic-buying as lockdowns began. By the September 2020 quarter prices were 8.9% above a year earlier.",
  },
  {
    id: "borders-2021",
    source: "abs",
    highlight: { from: "2021-Q2", to: "2021-Q2", label: "no pickers" },
    text: (s) => ["Closed borders made your veg dearer: with no backpackers to pick crops, fruit & veg rose ", s.pct(s.qoq("2021-Q2")), " in one quarter while food overall rose ", s.pct(s.qoq("2021-Q2", s.food)), "."],
    note: "June 2021 quarter. International borders had been shut for over a year, and growers reported produce left in the field for want of seasonal workers.",
  },
  {
    id: "low-2016",
    source: "abs",
    highlight: { from: "2016-Q1", to: "2016-Q4", label: "2016 wet winter" },
    text: (s) => ["Early 2016 was the cheapest fruit & veg has been since 2014. Then a wet winter sent prices up ", s.pct(s.qoq("2016-Q3")), " in one quarter — the biggest jump in the series."],
    note: "A run of good seasons left prices 6% below 2014 levels in the March 2016 quarter. The June 2016 east-coast low and a very wet winter in Queensland, NSW and Victoria then wrecked vegetable and fruit crops; prices were up 12.8% on a year earlier by March 2017.",
  },
  {
    id: "glut-2017",
    source: "abs",
    highlight: { from: "2017-Q3", to: "2017-Q3", label: "over-planting" },
    text: (s) => ["Growers over-corrected after 2016: a year later fruit & veg was ", s.pct(s.yoyAt("2017-Q3"), { sign: false }), " cheaper than the year before — the biggest annual fall on record."],
    note: "September 2017 quarter. Everyone planted more after the 2016 prices, supply flooded back and prices collapsed.",
  },
  {
    id: "falls-often",
    source: "abs",
    highlight: null,
    text: (s) => {
      const ys = s.yoys();
      return ["Fruit & veg was cheaper than a year earlier in ", s.fig(`${s.count(ys, (v) => v < 0)} of ${ys.length}`), " quarters since 2015. Almost no other food category does that."];
    },
    note: "Annual change in the ABS fruit & vegetables index, quarterly. Bread, dairy and meat almost never post an annual fall; produce does it roughly a third of the time.",
  },
  {
    id: "long-run",
    source: "abs",
    highlight: null,
    text: (s) => ["For all its ups and downs, fruit & veg is up ", s.whole(s.change(s.first, s.last)), " since 2014 — almost exactly the same as food overall (", s.whole(s.change(s.first, s.last, s.food)), ")."],
    note: "The spikes and crashes cancel out over the long run. Fruit & veg is volatile, not more inflationary.",
  },
  {
    id: "pace-2020s",
    source: "abs",
    highlight: { from: "2020-Q1", to: null, label: "the 2020s" },
    text: (s) => ["In the six years before COVID, fruit & veg prices rose ", s.whole(s.change(s.first, "2019-Q4")), ". Since then they have risen ", s.whole(s.change("2019-Q4", s.last)), "."],
    note: "2014 to December 2019 versus December 2019 to the latest quarter. Drought, bushfires, COVID demand, labour shortages, floods and input costs all landed in the second period.",
  },
  {
    id: "seasonal",
    source: "abs",
    highlight: null,
    text: (s) => ["Buy in spring and summer: October to December is the only quarter when fruit & veg prices usually fall, by ", s.pct(s.seasonalMean(4), { sign: false }), " on average."],
    note: (s) => `Average quarter-on-quarter change since 2014: Jan–Mar ${pctS(s.seasonalMean(1))}, Apr–Jun ${pctS(s.seasonalMean(2))}, Jul–Sep ${pctS(s.seasonalMean(3))}, Oct–Dec ${pctS(s.seasonalMean(4))}. Prices climb as growing slows into winter and ease with the summer harvest.`,
  },
  {
    id: "cheaper-2023",
    source: "abs",
    highlight: { from: "2023-Q3", to: "2023-Q4", label: "good seasons" },
    text: (s) => ["In 2023 fruit & veg was the one thing getting cheaper: down ", s.pct(s.yoyAt("2023-Q3"), { sign: false }), " in a year while food overall was still rising ", s.pct(s.yoyAt("2023-Q3", s.food), { sign: false }), "."],
    note: "September 2023 quarter versus a year earlier. Favourable growing conditions and strong supply after the flood-hit 2022.",
  },
  {
    id: "berries-2024",
    source: "abs",
    highlight: { from: "2024-Q2", to: "2024-Q4", label: "berries & broccoli" },
    text: (s) => ["Berries and broccoli did it in 2024: poor growing weather sent fruit & veg up ", s.pct(s.qoq("2024-Q2")), " in a quarter — then most of it came back by Christmas."],
    note: "June 2024 quarter. The ABS named berries, grapes and brassicas (broccoli, cabbage, cucumbers) as the produce in short supply. The December 2024 quarter fell 3.3% as supply normalised.",
  },
  {
    id: "record-now",
    source: "abs",
    when: (s) => s.maxPoint()?.period === s.last,
    highlight: (s) => ({ from: s.last, to: s.last, label: "all-time high" }),
    text: (s) => ["Fruit & veg prices are at an all-time high right now — ", s.whole(s.change(s.minPoint().period, s.last)), " above their 2016 low."],
    note: (s) => `Latest ABS quarter index ${s.maxPoint().index} (2014 = 100) against the series low of ${s.minPoint().index} in the March 2016 quarter.`,
  },
  {
    id: "bananas",
    source: "general",
    highlight: null,
    text: (s) => ["One cyclone can more than double the price of bananas — they hit ", s.fig("$15/kg"), " after Cyclone Yasi."],
    note: "Australia bans banana imports on biosecurity grounds and about 90% of the crop is grown in Far North Queensland, so a single cyclone (Larry in 2006, Yasi in 2011) wipes out most of the supply. Both are before this chart starts.",
  },
  {
    id: "home-grown",
    source: "general",
    highlight: null,
    text: (s) => ["Over ", s.fig("90%"), " of the fresh vegetables Australians eat are grown in Australia — which is why local weather, not world markets, sets the price."],
    note: "Widely cited industry figure (AUSVEG / Hort Innovation). Imports fill gaps mostly in frozen and processed vegetables.",
  },
  {
    id: "scanner",
    source: "general",
    highlight: null,
    text: () => ["The ABS now prices fruit & veg from supermarket scanner data, so the index reflects what people actually paid — specials included."],
    note: "The ABS uses transactions (scanner) data from the major supermarkets for most grocery items in the CPI, alongside traditional price collection.",
  },
];

function pctS(v) {
  return v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`;
}

// Resolve one fact against the stats: evaluate guards, functions and text.
export function resolveFact(fact, s) {
  if (fact.when && !fact.when(s)) return null;
  const highlight = typeof fact.highlight === "function" ? fact.highlight(s) : fact.highlight;
  const note = typeof fact.note === "function" ? fact.note(s) : fact.note;
  const parts = fact.text(s);
  if (parts.some((p) => p && typeof p === "object" && /—/.test(p.figure))) return null; // a period fell off the series
  return { id: fact.id, source: fact.source, highlight: highlight && { ...highlight, to: highlight.to ?? s.last }, note, parts };
}

export const FACTS_BY_AISLE = { vegetables: FACTS };
