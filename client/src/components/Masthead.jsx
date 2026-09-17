import { useEffect, useRef, useState } from "react";
import { api } from "../services/api";
import { STORE_LABEL, formatUnit, money } from "../lib/format";
import styles from "./Masthead.module.css";

const NAV = ["Categories", "Cheapest today", "Shrinkflation", "Specials checker", "My basket", "Methodology"];

/** Masthead from the Figma frame: wordmark, nav, and the product search. */
export default function Masthead({ productCount }) {
  return (
    <header className={styles.masthead}>
      <div className={styles.primaryNav}>
        <a href="#/" className={styles.wordmark}>Cost of Living AU</a>
        <nav className={styles.navLinks}>
          {NAV.map((n) => <a key={n} href="#/" onClick={(e) => e.preventDefault()} title="Not wired yet">{n}</a>)}
        </nav>
      </div>
      <Search productCount={productCount} />
    </header>
  );
}

/**
 * Live search over the crawler's product records (/api/search). Results are
 * real SKUs from the latest capture; choosing one opens its product page.
 */
function Search({ productCount }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const box = useRef(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setRes(null); return; }
    let alive = true;
    const t = setTimeout(() => {
      api.search(term, { limit: 10 })
        .then((r) => { if (alive) { setRes(r); setOpen(true); setActive(-1); } })
        .catch(() => alive && setRes({ error: true, results: [] }));
    }, 150);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

  useEffect(() => {
    const onDoc = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const go = (p) => { window.location.hash = `#/product/${p.retailer}/${p.sku}`; setOpen(false); setQ(""); };

  const onKey = (e) => {
    if (!res?.results?.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, res.results.length - 1)); setOpen(true); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); go(res.results[active]); }
    else if (e.key === "Escape") setOpen(false);
  };

  const placeholder = productCount
    ? `Search ${productCount.toLocaleString()} products — try 'potatoes'`
    : "Search products — try 'potatoes'";

  return (
    <div className={styles.searchWrap} ref={box}>
      <label className={styles.search}>
        <img src="/images/home/search.svg" alt="" className={styles.searchIcon} />
        <input type="search" value={q} placeholder={placeholder} autoComplete="off"
               onChange={(e) => setQ(e.target.value)} onFocus={() => res && setOpen(true)} onKeyDown={onKey}
               aria-label="Search products" aria-expanded={open} />
        {q && <span className={styles.count}>{res ? `${res.total} match${res.total === 1 ? "" : "es"}` : "…"}</span>}
      </label>

      {open && res && (
        <div className={styles.results} role="listbox">
          {res.error && <p className={styles.empty}>Search failed — is the API running?</p>}
          {!res.error && res.results.length === 0 && <p className={styles.empty}>Nothing matched “{q}” in the last capture.</p>}
          {res.results.map((p, i) => (
            <a key={p.key} href={`#/product/${p.retailer}/${p.sku}`} role="option" aria-selected={i === active}
               className={`${styles.result} ${i === active ? styles.resultActive : ""}`}
               onMouseEnter={() => setActive(i)} onClick={(e) => { e.preventDefault(); go(p); }}>
              <span className={styles.thumb}>{p.imageUrl && <img src={p.imageUrl} alt="" loading="lazy" />}</span>
              <span className={styles.resultBody}>
                <span className={styles.resultName}>{p.displayName}</span>
                <span className={styles.resultMeta}>
                  <span className={styles.store} style={{ color: `var(--${p.retailer})` }}>{STORE_LABEL[p.retailer]?.toUpperCase() || p.retailer}</span>
                  {p.brand && <span> · {p.brand}</span>}
                  {p.subcategory && <span> · {p.subcategory.toLowerCase()}</span>}
                </span>
              </span>
              <span className={styles.resultPrice}>
                <span className={styles.price}>{money(p.latest.price)}</span>
                <span className={styles.unit}>{formatUnit(p.latest)}</span>
                {p.latest.isOnSpecial && <span className={styles.special}>SPECIAL</span>}
              </span>
            </a>
          ))}
          {res.total > res.results.length && (
            <p className={styles.more}>{res.total - res.results.length} more — keep typing to narrow it down.</p>
          )}
        </div>
      )}
    </div>
  );
}
