import { useEffect, useMemo, useState } from "react";
import { api } from "../services/api";
import Masthead from "../components/Masthead";
import Footer from "../components/Footer";
import NotWired from "../components/NotWired";
import { STORE_LABEL, STORE_COLOUR, money, formatUnit, fmtDate } from "../lib/format";
import { CATEGORY_COPY } from "../lib/categories";
import styles from "./Category.module.css";

/**
 * Category page. Only Fruit & vegetables has measured data (that is the one
 * category the two Lambdas crawl), so it lists every real SKU; every other
 * category is an explicit NotWired until its crawl exists. The full Figma
 * category design (controls, per-store price cells, aside) is still to come.
 */
export default function Category({ id, status }) {
  const copy = CATEGORY_COPY[id];
  const measured = id === "vegetables";
  const [res, setRes] = useState(null);
  const [retailer, setRetailer] = useState("");
  const [sort, setSort] = useState("name");

  useEffect(() => {
    if (!measured) return;
    let alive = true;
    api.search("", { limit: 2000 }).then((r) => alive && setRes(r)).catch(() => alive && setRes({ results: [], total: 0 }));
    return () => { alive = false; };
  }, [measured]);

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
        <NotWired label="Category price index 2014 → today, YoY delta" needs="ABS Food CPI series (roadmap 0.1) + a year of our own captures" minHeight={140} />

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
