import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../services/api";
import Masthead from "../components/Masthead";
import Footer from "../components/Footer";
import NotWired from "../components/NotWired";
import IndexChart from "../components/IndexChart";
import DidYouKnow, { Figure } from "../components/DidYouKnow";
import { STORE_LABEL, STORE_COLOUR, money, formatUnit, fmtDate } from "../lib/format";
import { CATEGORY_COPY, CRAWLED } from "../lib/categories";
import { shelvesOf, groupLabel, itemHaystack, groupHaystack, matchesQuery, queryTerms, UNGROUPED } from "../lib/groups";
import { periodLabel, latest, fmtYoy, CAPTURES_START } from "../lib/abs";
import { makeStats } from "../lib/facts/compute";
import { FACTS_BY_AISLE, resolveFact } from "../lib/facts/vegetables";
import styles from "./Category.module.css";

/**
 * Category page. Every aisle gets its ABS CPI index 2014 -> today (the
 * server says which ABS group(s) it maps to and how honest the match is).
 * Aisles with a crawl behind them (lib/categories.js CRAWLED: fruit & veg,
 * meat, snacks) list every real SKU; every other category is an explicit NotWired
 * until its crawl exists. The full Figma category design
 * (controls, per-store price cells, aside) is still to come.
 *
 * A crawled aisle opens on its SHELVES — apples, citrus, cabbage & broccoli
 * (lib/groups.js) — a preview row each, rather than 917 cards in one wall.
 * A shelf has its own URL (#/category/vegetables/apples), so it is shareable
 * and the back button leaves it. Search and "view all products" both drop the
 * shelves and show one flat grid of whatever matched.
 */
const MATCH_TAG = { exact: "EXACT ABS GROUP", shared: "SHARED ABS GROUP", nearest: "NEAREST ABS GROUP", components: "ABS COMPONENTS" };
// Line colours for the aisle series; the Food headline is always the muted reference.
const LINE_COLOURS = ["var(--ink)", "var(--accent)", "var(--cheap)", "var(--market)"];
const SOURCE_TAG = { abs: "ABS CPI 6401.0", general: "GENERAL" };

// A fact's text is strings and { figure } items; the figure is the one coloured number.
const renderParts = (parts) => parts.map((p, i) => (p && typeof p === "object" ? <Figure key={i}>{p.figure}</Figure> : p));

// Cards shown per shelf before "View all" — one row on a wide screen, and few
// enough that the shelf list itself stays the thing you scan.
const PREVIEW = 5;

export default function Category({ id, group = "", status }) {
  const copy = CATEGORY_COPY[id];
  // A crawled aisle is shown once the server publishes it (categories.js
  // `public`); until then /api/status counts no public SKUs for it and the
  // page says it is in review rather than rendering an empty grid.
  const crawled = !!CRAWLED[id];
  const published = !status?.productsByCategory || (status.productsByCategory[CRAWLED[id]] ?? 0) > 0;
  const crawlCategory = crawled && published ? CRAWLED[id] : null;
  const measured = !!crawlCategory;
  const [res, setRes] = useState(null);   // { total, items } — one row per item in any size
  const [retailer, setRetailer] = useState("");
  const [sort, setSort] = useState("name");
  const [q, setQ] = useState("");          // free-text search over the aisle
  const [viewAll, setViewAll] = useState(false); // flat grid instead of shelves
  const [picked, setPicked] = useState({}); // item id -> sku the viewer switched to
  const [history, setHistory] = useState(null); // ABS CPI snapshot; false = unavailable
  // "Did you know?" headline: a random fact per visit, cycled by "Another one".
  // The index chart unfolds underneath with the fact's quarters shaded.
  const factList = FACTS_BY_AISLE[id] ?? [];
  const [factIdx, setFactIdx] = useState(() => Math.floor(Math.random() * Math.max(factList.length, 1)));

  useEffect(() => {
    let alive = true;
    api.history().then((h) => alive && setHistory(h)).catch(() => alive && setHistory(false));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!crawlCategory) return;
    let alive = true;
    setRes(null);
    api.items({ category: crawlCategory }).then((r) => alive && setRes(r)).catch(() => alive && setRes({ items: [], total: 0 }));
    return () => { alive = false; };
  }, [crawlCategory]);

  const abs = useMemo(() => {
    const a = history?.aisles?.[id];
    if (!a) return null;
    const lines = a.lines.map((c, i) => ({ ...history.series[c], key: c, label: `ABS ${history.series[c].label}`, colour: LINE_COLOURS[i % LINE_COLOURS.length] }));
    const food = { ...history.series["20001"], key: "20001", label: "ABS food & non-alcoholic beverages", colour: "var(--rule)", width: 2 };
    // Headline stat: the aisle's own line when there is exactly one, else the Food group.
    // The chart only draws the aisle's own line(s); the Food headline is the fallback stat, not a reference curve.
    const stat = latest(lines.length === 1 ? lines[0] : food, history.periods);
    return { ...a, lines, stat, statLabel: lines.length === 1 ? lines[0].label : food.label };
  }, [history, id]);

  // Facts only exist for aisles with exactly one ABS line (the numbers are that line's).
  const facts = useMemo(() => {
    if (!abs || abs.lines.length !== 1 || !factList.length) return [];
    const s = makeStats(abs.lines[0], history.periods, history.series["20001"]);
    return factList.map((f) => resolveFact(f, s)).filter(Boolean);
  }, [abs, history, factList]);
  const fact = facts.length ? facts[factIdx % facts.length] : null;

  const nextFact = () => {
    setFactIdx((i) => (facts.length > 1 ? (i + 1 + Math.floor(Math.random() * (facts.length - 1))) % facts.length : i));
  };

  // One row per item; the size shown is the one the viewer picked, else the
  // cheapest per unit today. Sorting uses the shown size, so switching a
  // size moves the card.
  const rowsOf = useCallback((items) => {
    const r = items.map((it) => ({ it, p: it.sizes.find((s) => s.sku === picked[it.id]) || it.sizes.find((s) => s.sku === it.bestSku) || it.sizes[0] }));
    if (sort === "name") r.sort((a, b) => a.it.name.localeCompare(b.it.name) || a.it.retailer.localeCompare(b.it.retailer));
    if (sort === "unit") r.sort((a, b) => (a.p.latest.unitPrice ?? 1e9) - (b.p.latest.unitPrice ?? 1e9));
    if (sort === "price") r.sort((a, b) => (a.p.latest.price ?? 1e9) - (b.p.latest.price ?? 1e9));
    return r;
  }, [sort, picked]);

  // Narrowing happens in one direction: retailer chip -> shelf (from the URL)
  // -> search box. The shelf chips are built BEFORE the search, so their counts
  // do not move as you type and you can always jump to another shelf.
  const terms = useMemo(() => queryTerms(q), [q]);
  const inAisle = useMemo(() => (res ? res.items.filter((it) => !retailer || it.retailer === retailer) : []), [res, retailer]);
  const shelves = useMemo(() => shelvesOf(inAisle), [inAisle]);
  // The shelf named by the URL, only once the data backs it up — a stale link
  // to a shelf this crawl has nothing on says so rather than showing an empty grid.
  const shelf = useMemo(() => (group ? shelves.find((sh) => sh.group === group) || null : null), [shelves, group]);
  const missingShelf = !!group && !shelf && !!res;
  const scope = shelf ? shelf.items : inAisle;
  const found = useMemo(() => (terms.length ? scope.filter((it) => matchesQuery(itemHaystack(it), terms)) : scope), [scope, terms]);
  // Shelves the query names rather than describes: typing "oranges" should
  // offer the Citrus shelf, which no item name and no label spells out (the
  // aliases in lib/groups.js carry it).
  const suggested = useMemo(
    () => (terms.length && !shelf ? shelves.filter((sh) => matchesQuery(groupHaystack(sh.group), terms)) : []),
    [shelves, shelf, terms]
  );
  // One flat grid when the viewer asked for a specific set; the shelf previews
  // otherwise.
  const flat = !!shelf || viewAll || terms.length > 0;
  const rows = useMemo(() => rowsOf(found), [rowsOf, found]);
  const skuCount = useMemo(() => res?.items.reduce((n, it) => n + it.sizes.length, 0), [res]);

  const openShelf = (g) => { window.location.hash = g ? `#/category/${id}/${encodeURIComponent(g)}` : `#/category/${id}`; };

  return (
    <div className={styles.page}>
      <Masthead productCount={status?.productCount} />
      <section className={styles.header}>
        <p className={styles.crumb}>
          <a href="#/">Home</a> › {shelf ? <><a href={`#/category/${id}`}>{copy?.label || id}</a> › {shelf.label}</> : (copy?.label || id)}
        </p>
        <h1 className={styles.title}>{copy?.label || id}</h1>
        <p className={styles.blurb}>{copy?.blurb}</p>
        {measured && status && (
          <p className={styles.status}>
            {res ? `${res.total} items · ${skuCount} lines` : "…"} · last captured {fmtDate(status.lastCapturedAt, { time: true })} · {status.retailers.map((r) => STORE_LABEL[r]).join(" and ")}
          </p>
        )}
      </section>

      <section className={styles.body}>
        {abs ? (
          <DidYouKnow
            more={fact?.highlight ? "Show me on the chart" : "See the chart"}
            extra={facts.length > 1 && <button type="button" onClick={nextFact}>Another one ›</button>}
            detail={
              <>
                <IndexChart
                  tone="light"
                  periods={history.periods}
                  lines={abs.lines}
                  handover={{ at: CAPTURES_START, label: "our captures start" }}
                  highlight={fact?.highlight}
                  source={history.source}
                  height={260}
                />
                {fact && (
                  <>
                    <DidYouKnow.Meta tag={SOURCE_TAG[fact.source]}>
                      {fact.highlight
                        ? <>Shaded: {fact.highlight.label} · {periodLabel(fact.highlight.from)}{fact.highlight.to !== fact.highlight.from && ` – ${periodLabel(fact.highlight.to)}`}</>
                        : "Not tied to one stretch of the chart"}
                    </DidYouKnow.Meta>
                    <DidYouKnow.Note>{fact.note}</DidYouKnow.Note>
                  </>
                )}
                <DidYouKnow.Row>
                  <DidYouKnow.Meta tag={MATCH_TAG[abs.match]}>
                    Right now {copy?.label || id} prices are {abs.stat.yoy < 0 ? "down" : "up"} {fmtYoy(Math.abs(abs.stat.yoy)).replace("+", "")} this year ·{" "}
                    {abs.statLabel} · {periodLabel(abs.stat.period)} vs a year earlier · index {abs.stat.index} (2014 = 100)
                  </DidYouKnow.Meta>
                  <NotWired inline label="Our YoY —" needs="a year of our own captures for this aisle" />
                </DidYouKnow.Row>
                <DidYouKnow.Note>{abs.note}</DidYouKnow.Note>
              </>
            }
          >
            {fact
              ? renderParts(fact.parts)
              : <>{copy?.label || id} prices are {abs.stat.yoy < 0 ? "down" : "up"} <Figure>{fmtYoy(Math.abs(abs.stat.yoy)).replace("+", "")}</Figure> this year.</>}
          </DidYouKnow>
        ) : (
          <NotWired label="Category price index 2014 → today" needs={history === false ? "data/abs/cpi_food.json — run `npm run fetch-abs`" : "loading ABS series…"} minHeight={140} />
        )}

        {!measured && crawled && (
          <NotWired label={`${copy?.label || id}: in review`} needs="crawled at both retailers; published once the match lists are reviewed" minHeight={320} />
        )}
        {!measured && !crawled && (
          <NotWired label={`No ${copy?.label || id} crawl yet`} needs="a Lambda category target for this aisle — only fruit & veg, meat and snacks are captured today" minHeight={320} />
        )}

        {measured && (
          <>
            {/* Find a thing by name, variety, brand or shelf. Every price for
                this aisle is already in the page, so this filters in the
                browser — no request per keystroke. */}
            <div className={styles.find}>
              <label className={styles.search}>
                {/* Drawn rather than typed: the magnifier codepoint is missing
                    from most of the faces this site loads. */}
                <svg className={styles.glass} viewBox="0 0 16 16" aria-hidden="true">
                  <circle cx="6.5" cy="6.5" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                  <line x1="10" y1="10" x2="14.5" y2="14.5" stroke="currentColor" strokeWidth="1.6" />
                </svg>
                <input
                  type="search" value={q} onChange={(e) => setQ(e.target.value)}
                  placeholder={`Search ${(copy?.label || id).toLowerCase()} — apples, cabbage, organic lemons…`}
                  aria-label={`Search ${copy?.label || id}`}
                />
                {q && <button type="button" className={styles.clear} onClick={() => setQ("")} aria-label="Clear search">✕</button>}
              </label>
              {terms.length > 0 && (
                <p className={styles.findCount}>
                  {found.length} {found.length === 1 ? "item" : "items"} match “{q.trim()}”{shelf && ` in ${shelf.label.toLowerCase()}`}
                </p>
              )}
            </div>

            {/* The shelves. Counts are of items in the aisle (both sizes of the
                same item are one item), after the retailer chip and before the
                search, so a count is what clicking through will show. */}
            {shelves.length > 1 && (
              <div className={styles.shelves}>
                <button className={`${styles.chip} ${!shelf ? styles.chipActive : ""}`} onClick={() => openShelf("")}>
                  All shelves <span className={styles.count}>{inAisle.length}</span>
                </button>
                {shelves.map((sh) => (
                  <button key={sh.group} className={`${styles.chip} ${shelf?.group === sh.group ? styles.chipActive : ""}`} onClick={() => openShelf(sh.group)}>
                    {sh.label} <span className={styles.count}>{sh.items.length}</span>
                  </button>
                ))}
              </div>
            )}

            {suggested.length > 0 && (
              <p className={styles.suggest}>
                Shelf{suggested.length > 1 ? "s" : ""}:{" "}
                {suggested.map((sh) => (
                  <button key={sh.group} type="button" className={styles.suggestLink} onClick={() => { setQ(""); openShelf(sh.group); }}>
                    {sh.label} ({sh.items.length}) ›
                  </button>
                ))}
              </p>
            )}

            <div className={styles.controls}>
              <div className={styles.chips}>
                {["", "woolworths", "coles"].map((r) => (
                  <button key={r} className={`${styles.chip} ${retailer === r ? styles.chipActive : ""}`} onClick={() => setRetailer(r)}>
                    {r ? STORE_LABEL[r] : "Both retailers"}
                  </button>
                ))}
              </div>
              <div className={styles.chips}>
                {[["name", "A–Z"], ["unit", "Cheapest per unit"], ["price", "Cheapest shelf price"]].map(([k, l]) => (
                  <button key={k} className={`${styles.chip} ${sort === k ? styles.chipActive : ""}`} onClick={() => setSort(k)}>{l}</button>
                ))}
              </div>
            </div>

            {!res && <div className="state">Loading products…</div>}
            {missingShelf && (
              <NotWired label={`Nothing on the ${groupLabel(group).toLowerCase()} shelf`}
                needs="this shelf had no lines in the latest capture — pick another above" minHeight={160} />
            )}

            {flat ? (
              <>
                <div className={styles.sectionHead}>
                  <h2 className={styles.h2}>{shelf ? shelf.label : terms.length ? "Search results" : `All ${copy?.label || id}`}</h2>
                  <span className={styles.sectionCount}>{rows.length} {rows.length === 1 ? "item" : "items"}</span>
                  {(shelf || viewAll) && !terms.length && (
                    <button type="button" className={styles.back} onClick={() => { setViewAll(false); openShelf(""); }}>‹ All shelves</button>
                  )}
                </div>
                {res && rows.length === 0 && !missingShelf && (
                  <p className={styles.empty}>
                    Nothing here{terms.length ? ` for “${q.trim()}”` : ""}{retailer ? ` at ${STORE_LABEL[retailer]}` : ""}.{" "}
                    {terms.length > 0 && <button type="button" className={styles.suggestLink} onClick={() => setQ("")}>Clear the search ›</button>}
                  </p>
                )}
                <ItemGrid rows={rows} picked={picked} setPicked={setPicked} />
              </>
            ) : (
              <>
                {shelves.map((sh) => {
                  const shelfRows = rowsOf(sh.items);
                  return (
                    <section key={sh.group} className={styles.shelf}>
                      <div className={styles.sectionHead}>
                        <h2 className={styles.h2}>
                          {sh.group === UNGROUPED
                            ? sh.label
                            : <a href={`#/category/${id}/${encodeURIComponent(sh.group)}`} className={styles.h2Link}>{sh.label}</a>}
                        </h2>
                        <span className={styles.sectionCount}>{sh.items.length} {sh.items.length === 1 ? "item" : "items"}</span>
                        {shelfRows.length > PREVIEW && (
                          <button type="button" className={styles.viewAll} onClick={() => openShelf(sh.group)}>
                            View all {sh.items.length} ›
                          </button>
                        )}
                      </div>
                      <ItemGrid rows={shelfRows.slice(0, PREVIEW)} picked={picked} setPicked={setPicked} />
                    </section>
                  );
                })}
                {/* Everything in the aisle in one grid, for anyone who would
                    rather scan than browse. */}
                <button type="button" className={styles.viewAllProducts} onClick={() => setViewAll(true)}>
                  View all {inAisle.length} products{retailer ? ` at ${STORE_LABEL[retailer]}` : ""} ›
                </button>
              </>
            )}
          </>
        )}
      </section>
      <Footer />
    </div>
  );
}

// The grid of item cards, shared by the shelf previews and both flat views.
function ItemGrid({ rows, picked, setPicked }) {
  return (
    <div className={styles.grid}>
      {rows.map(({ it, p }) => (
        <div key={it.id} className={styles.card}>
          <a href={`#/product/${p.retailer}/${p.sku}`} className={styles.cardLink}>
            <span className={styles.thumb}>{p.imageUrl && <img src={p.imageUrl} alt="" loading="lazy" />}</span>
            <span className={styles.name}>{it.name}{it.isOrganic && <span className={styles.organic}> organic</span>}</span>
            <span className={styles.meta}>
              <span style={{ color: STORE_COLOUR[it.retailer], fontWeight: 900 }}>{STORE_LABEL[it.retailer].toUpperCase()}</span>
              {it.subcategory && ` · ${it.subcategory.toLowerCase()}`}
            </span>
          </a>
          {/* Sizes this retailer sells the item in. One size: shown, not a control.
              Two SKUs in the same size (two parsley bunches) get the price on the chip. */}
          <span className={styles.sizes}>
            {it.sizes.map((s) => (
              it.sizes.length === 1
                ? <span key={s.sku} className={styles.sizeOne}>{s.sizeLabel}</span>
                : <button key={s.sku} type="button" title={formatUnit(s.latest) || money(s.latest.price)}
                    className={`${styles.size} ${s.sku === p.sku ? styles.sizeActive : ""} ${s.sku === it.bestSku ? styles.sizeBest : ""}`}
                    onClick={() => setPicked((m) => ({ ...m, [it.id]: s.sku }))}>
                    {s.sizeLabel}{it.sizes.some((o) => o !== s && o.sizeLabel === s.sizeLabel) && ` ${money(s.latest.price)}`}
                  </button>
            ))}
          </span>
          <a href={`#/product/${p.retailer}/${p.sku}`} className={styles.priceRow}>
            <span className={styles.price}>{money(p.latest.price)}</span>
            <span className={styles.unit}>{formatUnit(p.latest)}</span>
            {p.latest.isOnSpecial && <span className={styles.special}>SPECIAL</span>}
            {!p.latest.isAvailable && <span className={styles.unavailable}>unavailable</span>}
          </a>
        </div>
      ))}
    </div>
  );
}
