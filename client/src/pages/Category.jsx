import { useEffect, useMemo, useState } from "react";
import { api } from "../services/api";
import Masthead from "../components/Masthead";
import Footer from "../components/Footer";
import NotWired from "../components/NotWired";
import IndexChart from "../components/IndexChart";
import DidYouKnow, { Figure } from "../components/DidYouKnow";
import { STORE_LABEL, STORE_COLOUR, money, formatUnit, fmtDate } from "../lib/format";
import { CATEGORY_COPY } from "../lib/categories";
import { periodLabel, latest, fmtYoy, CAPTURES_START } from "../lib/abs";
import styles from "./Category.module.css";

/**
 * Category page. Every aisle gets its ABS CPI index 2014 -> today (the
 * server says which ABS group(s) it maps to and how honest the match is).
 * Only Fruit & vegetables has measured data (that is the one category the two
 * Lambdas crawl), so it lists every real SKU; every other category is an
 * explicit NotWired until its crawl exists. The full Figma category design
 * (controls, per-store price cells, aside) is still to come.
 */
const MATCH_TAG = { exact: "EXACT ABS GROUP", shared: "SHARED ABS GROUP", nearest: "NEAREST ABS GROUP", components: "ABS COMPONENTS" };
// Line colours for the aisle series; the Food headline is always the muted reference.
const LINE_COLOURS = ["var(--ink)", "var(--accent)", "var(--cheap)", "var(--market)"];

export default function Category({ id, status }) {
  const copy = CATEGORY_COPY[id];
  const measured = id === "vegetables";
  const [res, setRes] = useState(null);
  const [retailer, setRetailer] = useState("");
  const [sort, setSort] = useState("name");
  const [history, setHistory] = useState(null); // ABS CPI snapshot; false = unavailable

  useEffect(() => {
    let alive = true;
    api.history().then((h) => alive && setHistory(h)).catch(() => alive && setHistory(false));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!measured) return;
    let alive = true;
    api.search("", { limit: 2000 }).then((r) => alive && setRes(r)).catch(() => alive && setRes({ results: [], total: 0 }));
    return () => { alive = false; };
  }, [measured]);

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

  const rows = useMemo(() => {
    if (!res) return [];
    let r = res.results.filter((p) => !retailer || p.retailer === retailer);
    if (sort === "name") r.sort((a, b) => a.displayName.localeCompare(b.displayName));
    if (sort === "unit") r.sort((a, b) => (a.latest.unitPrice ?? 1e9) - (b.latest.unitPrice ?? 1e9));
    if (sort === "price") r.sort((a, b) => (a.latest.price ?? 1e9) - (b.latest.price ?? 1e9));
    return r;
  }, [res, retailer, sort]);

  return (
    <div className={styles.page}>
      <Masthead productCount={status?.productCount} />
      <section className={styles.header}>
        <p className={styles.crumb}><a href="#/">Home</a> › {copy?.label || id}</p>
        <h1 className={styles.title}>{copy?.label || id}</h1>
        <p className={styles.blurb}>{copy?.blurb}</p>
        {measured && status && (
          <p className={styles.status}>
            {res ? `${res.total} products` : "…"} · last captured {fmtDate(status.lastCapturedAt, { time: true })} · {status.retailers.map((r) => STORE_LABEL[r]).join(" and ")}
          </p>
        )}
      </section>

      <section className={styles.body}>
        {abs ? (
          <DidYouKnow
            more="See how we got there"
            detail={
              <>
                <IndexChart
                  tone="light"
                  periods={history.periods}
                  lines={abs.lines}
                  handover={{ at: CAPTURES_START, label: "our captures start" }}
                  source={history.source}
                  height={260}
                />
                <DidYouKnow.Row>
                  <DidYouKnow.Meta tag={MATCH_TAG[abs.match]}>
                    {abs.statLabel} · {periodLabel(abs.stat.period)} vs a year earlier · index {abs.stat.index} (2014 = 100)
                  </DidYouKnow.Meta>
                  <NotWired inline label="Our YoY —" needs="a year of our own captures for this aisle" />
                </DidYouKnow.Row>
                <DidYouKnow.Note>{abs.note}</DidYouKnow.Note>
              </>
            }
          >
            {copy?.label || id} prices are {abs.stat.yoy < 0 ? "down" : "up"}{" "}
            <Figure>{fmtYoy(Math.abs(abs.stat.yoy)).replace("+", "")}</Figure> this year.
          </DidYouKnow>
        ) : (
          <NotWired label="Category price index 2014 → today" needs={history === false ? "data/abs/cpi_food.json — run `npm run fetch-abs`" : "loading ABS series…"} minHeight={140} />
        )}

        {!measured && (
          <NotWired label={`No ${copy?.label || id} crawl yet`} needs="a Lambda category target for this aisle — only Fruit & Veg is captured today" minHeight={320} />
        )}

        {measured && (
          <>
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
            <div className={styles.grid}>
              {rows.map((p) => (
                <a key={p.key} href={`#/product/${p.retailer}/${p.sku}`} className={styles.card}>
                  <span className={styles.thumb}>{p.imageUrl && <img src={p.imageUrl} alt="" loading="lazy" />}</span>
                  <span className={styles.name}>{p.displayName}</span>
                  <span className={styles.meta}>
                    <span style={{ color: STORE_COLOUR[p.retailer], fontWeight: 900 }}>{STORE_LABEL[p.retailer].toUpperCase()}</span>
                    {p.subcategory && ` · ${p.subcategory.toLowerCase()}`}
                  </span>
                  <span className={styles.priceRow}>
                    <span className={styles.price}>{money(p.latest.price)}</span>
                    <span className={styles.unit}>{formatUnit(p.latest)}</span>
                    {p.latest.isOnSpecial && <span className={styles.special}>SPECIAL</span>}
                  </span>
                </a>
              ))}
            </div>
          </>
        )}
      </section>
      <Footer />
    </div>
  );
}
