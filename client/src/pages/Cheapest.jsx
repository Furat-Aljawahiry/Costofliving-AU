import { useEffect, useMemo, useState } from "react";
import { api } from "../services/api";
import Masthead from "../components/Masthead";
import Footer from "../components/Footer";
import NotWired from "../components/NotWired";
import { STORE_LABEL, STORE_COLOUR, money, formatUnitBasis, fmtDate } from "../lib/format";
import { buildWall, groupLabel } from "../lib/cheapest";
import styles from "./Cheapest.module.css";

/**
 * Cheapest today, in full. Every canonical produce group from the newest
 * complete crawl, one row each: the winning line across retailers up front,
 * the other store's cheapest line for the same group beside it so the gap is
 * visible. Same derivation as the Home wall (lib/cheapest.js).
 */
export default function Cheapest({ status }) {
  const [sets, setSets] = useState(null);
  const [sort, setSort] = useState("candidates");
  const [store, setStore] = useState("");

  useEffect(() => {
    let alive = true;
    api.cheapest("fruitAndVeg").then((c) => alive && setSets(c)).catch(() => alive && setSets([]));
    return () => { alive = false; };
  }, []);

  const wall = useMemo(() => (sets ? buildWall(sets) : null), [sets]);

  const rows = useMemo(() => {
    if (!wall) return [];
    let r = wall.groups.map((w) => ({ winner: w, others: Object.values(wall.byStore[w.canonicalGroup] || {}).filter((x) => x !== w) }));
    if (store) r = r.filter((x) => x.winner.retailer === store);
    if (sort === "name") r.sort((a, b) => a.winner.canonicalGroup.localeCompare(b.winner.canonicalGroup));
    if (sort === "price") r.sort((a, b) => a.winner.unitPrice - b.winner.unitPrice);
    return r; // default: most candidate lines first, as buildWall sorts
  }, [wall, sort, store]);

  return (
    <div className={styles.page}>
      <Masthead productCount={status?.productCount} />
      <section className={styles.header}>
        <p className={styles.crumb}><a href="#/">Home</a> › Cheapest today</p>
        <p className={styles.kicker}>LIVE SHELF READOUT{wall?.capturedAt ? ` · CAPTURED ${fmtDate(wall.capturedAt, { time: true }).toUpperCase()}` : ""}</p>
        <h1 className={styles.title}>Cheapest today</h1>
        <p className={styles.blurb}>
          {wall ? `${wall.groups.length} produce groups` : "…"} · the cheapest line per group across {wall ? wall.retailers.map((r) => STORE_LABEL[r]).join(" and ") : "the stores"}, compared on unit price, from the latest complete crawl. Organic, prepared and unavailable lines are left out.
        </p>
      </section>

      <section className={styles.body}>
        {wall && wall.groups.length > 0 && (
          <div className={styles.controls}>
            <div className={styles.chips}>
              <button className={`${styles.chip} ${!store ? styles.chipActive : ""}`} onClick={() => setStore("")}>Both stores</button>
              {wall.retailers.map((r) => (
                <button key={r} className={`${styles.chip} ${store === r ? styles.chipActive : ""}`} onClick={() => setStore(r)}>Cheapest at {STORE_LABEL[r]}</button>
              ))}
            </div>
            <div className={styles.chips}>
              {[["candidates", "Most lines"], ["name", "A–Z"], ["price", "Cheapest per unit"]].map(([k, l]) => (
                <button key={k} className={`${styles.chip} ${sort === k ? styles.chipActive : ""}`} onClick={() => setSort(k)}>{l}</button>
              ))}
            </div>
          </div>
        )}

        {!wall && <div className="state">Reading cheapest-by-subcategory…</div>}
        {wall && wall.groups.length === 0 && <NotWired label="No cheapest-by-subcategory file loaded" needs="a crawler run in data/out" minHeight={200} />}

        {rows.length > 0 && (
          <div className={styles.list}>
            {rows.map(({ winner: w, others }) => (
              <article key={w.canonicalGroup} className={styles.row}>
                <div className={styles.group}>
                  <h2 className={styles.groupName}>{groupLabel(w.canonicalGroup)}</h2>
                  <p className={styles.groupMeta}>{w.candidates} lines · median {formatUnitBasis(w.medianUnitPrice, w.unitBasis)}</p>
                </div>
                <Cell row={w} winner note={`${money(w.price)} on the shelf`} />
                {others.length ? others.map((o) => <Cell key={o.retailer} row={o} note={gapNote(o, w)} />) : (
                  <div className={styles.cellEmpty}>
                    <NotWired inline label="Only one store lists this group" needs="a matching subcategory at the other retailer" />
                  </div>
                )}
              </article>
            ))}
          </div>
        )}

        {wall && <p className={styles.rule}>Selection rule: {wall.selectionRule?.replace(/_/g, " ")}. One store's line beats the other only when both are priced on the same basis; per-kg lines beat per-each when mixed.</p>}
      </section>
      <Footer />
    </div>
  );
}

function Cell({ row: r, winner = false, note }) {
  return (
    <a href={`#/product/${r.retailer}/${r.sku}`} className={`${styles.cell} ${winner ? styles.winner : ""}`}>
      <div className={styles.cellHead}>
        <span className={styles.cellStore} style={{ color: STORE_COLOUR[r.retailer] }}>{STORE_LABEL[r.retailer].toUpperCase()}</span>
        {r.isOnSpecial && <span className={styles.special}>SPECIAL</span>}
      </div>
      <p className={styles.cellName}>{r.displayName}</p>
      <p className={styles.cellPrice}>{formatUnitBasis(r.unitPrice, r.unitBasis)}</p>
      <p className={styles.cellNote}>{note}</p>
    </a>
  );
}

// How the runner-up compares with the winner, in words.
function gapNote(o, w) {
  if (o.unitBasis !== w.unitBasis) return `priced per ${o.unitBasis}, not comparable`;
  if (o.unitPrice <= w.unitPrice) return "same price";
  return `+${Math.round((o.unitPrice / w.unitPrice - 1) * 100)}% dearer`;
}
