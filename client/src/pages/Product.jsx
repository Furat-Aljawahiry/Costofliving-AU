import { useEffect, useMemo, useState } from "react";
import { api } from "../services/api";
import Masthead from "../components/Masthead";
import Footer from "../components/Footer";
import NotWired from "../components/NotWired";
import { STORE_LABEL, STORE_COLOUR, money, formatUnit, fmtDate, fmtDateShort, fmtUtc, pct } from "../lib/format";
import styles from "./Product.module.css";

const RETAILERS = ["woolworths", "coles", "aldi", "market"];

/**
 * Product detail — implemented from the Figma "Potatoes product detail —
 * desktop" frame. One retailer SKU, every observation the crawler has made of
 * it. Anything the design shows that we cannot yet measure is a NotWired.
 */
export default function Product({ retailer, sku, status }) {
  const [p, setP] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setP(null); setError(null);
    api.product(retailer, sku)
      .then((d) => alive && setP(d))
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [retailer, sku]);

  const view = useMemo(() => (p ? buildView(p) : null), [p]);

  return (
    <div className={styles.page}>
      <Masthead productCount={status?.productCount} />
      {error && <div className="state">No record for {STORE_LABEL[retailer] || retailer} SKU {sku} in the loaded captures. ({error})</div>}
      {!error && !p && <div className="state">Loading the price record…</div>}
      {view && <ProductBody p={p} v={view} />}
      <Footer />
    </div>
  );
}

function ProductBody({ p, v }) {
  const store = STORE_LABEL[p.retailer] || p.retailer;
  const colour = STORE_COLOUR[p.retailer];
  const L = p.latest;

  return (
    <>
      {/* Product header */}
      <section className={styles.header}>
        <p className={styles.crumb}>
          <a href="#/">Home</a> › <a href="#/category/vegetables">{titleCase(p.department || p.sap.department)}</a> › {titleCase(p.subcategory || p.sap.subcategory)}
        </p>
        <div className={styles.intro}>
          <div className={styles.imageField}>
            {p.imageUrl ? <img src={p.imageUrl} alt={p.displayName} /> : <NotWired label="No image in capture" />}
          </div>
          <div className={styles.copy}>
            <p className={styles.kicker}>{(p.subcategory || p.sap.subcategory || "").toUpperCase()} · {store.toUpperCase()}</p>
            <h1 className={styles.title}>{p.displayName}</h1>

            <div className={styles.sizeTabs}>
              <span className={`${styles.sizeTab} ${styles.sizeTabActive}`}>{p.packageSize || (p.soldBy === "each" ? "each" : "—")}</span>
              <NotWired inline label="OTHER SIZES" needs="matching pack-size variants of the same product across SKUs" />
            </div>

            <span className={L.confidence === "measured" ? styles.measured : styles.estimated}>
              {L.confidence === "measured" ? "✓ MEASURED" : "~ ESTIMATED"}
            </span>

            <div className={styles.provenance}>
              <p>
                Source: {store} {L.priceBasis} · Run {L.runId} · Captured {fmtUtc(L.capturedAt)} · SKU {p.sku}
                {L.storeId && ` · Store ${L.storeId}`}
              </p>
              <img src="/images/home/barcode-wide.png" alt="" className={styles.barcode} />
              <p className={styles.provenanceLinks}>
                <a href={p.productUrl} target="_blank" rel="noreferrer">View at {store} ↗</a>
                <span> · {p.observations.length} observation{p.observations.length === 1 ? "" : "s"} since {fmtDate(p.firstSeen)}</span>
                {p.brand && <span> · Brand: {p.brand}</span>}
                {p.countryOfOrigin && <span> · Origin: {p.countryOfOrigin}</span>}
                {p.isOrganic && <span> · Organic</span>}
                {p.isPrepared && <span> · Prepared</span>}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Price now */}
      <section className={styles.priceNow}>
        <h2 className={styles.h2Light}>Price now</h2>
        <div className={styles.storePrices}>
          {RETAILERS.map((r) => (
            r === p.retailer
              ? <StorePrice key={r} retailer={r} obs={L} pack={p.packageSize} />
              : <div key={r} className={styles.storeMissing}>
                  <span className={styles.storeName} style={{ color: STORE_COLOUR[r] }}>{STORE_LABEL[r].toUpperCase()}</span>
                  <NotWired label={`No ${STORE_LABEL[r]} match`} needs={
                    r === "aldi" || r === "market" ? `a ${STORE_LABEL[r]} crawler` : "cross-retailer product matching (canonical keys don't match across retailers yet)"
                  } />
                </div>
          ))}
        </div>
        <p className={styles.priceSentence}>
          {store} today: {money(L.price)}{formatUnit(L) && ` (${formatUnit(L)})`}
          {L.isOnSpecial && L.wasPrice != null && ` — on special, marked down from ${money(L.wasPrice)}`}
          {!L.isAvailable && " — listed as unavailable at capture"}
          {v.deltaVsFirst != null && v.deltaVsFirst !== 0 && ` · ${v.deltaVsFirst > 0 ? "↑" : "↓"}${Math.abs(v.deltaVsFirst)}% vs ${fmtDate(p.firstSeen)}`}
          {v.deltaVsFirst === 0 && p.observations.length > 1 && ` · unchanged since ${fmtDate(p.firstSeen)}`}.
        </p>
      </section>

      {/* Price history */}
      <section className={styles.history}>
        <div className={styles.chartHeading}>
          <div>
            <p className={styles.kickerMono}>OBSERVATIONS · {v.unitLabel.toUpperCase()}</p>
            <h2 className={styles.h2}>Price history</h2>
          </div>
          <div className={styles.range}>
            {["1M", "3M", "1Y", "ALL"].map((r) => (
              <span key={r} className={`${styles.rangeBtn} ${r === "ALL" ? styles.rangeActive : styles.rangeDisabled}`}
                    title={r === "ALL" ? "" : `Needs more than ${v.spanDays} days of captures`}>{r}</span>
            ))}
          </div>
        </div>
        <div className={styles.legend}>
          <span style={{ color: colour }}>● {store.toUpperCase()}</span>
          {v.wasLine != null && <span style={{ color: "var(--coles)" }}>– – {store} says ‘was {money(v.wasLine)}’</span>}
          {v.specials > 0 && <span style={{ color: "var(--ink)" }}>▮ SPECIAL ({v.specials})</span>}
        </div>
        <PriceChart obs={p.observations} colour={colour} wasLine={v.wasLine} unit={v.unitLabel} runs={p.runs} store={store} />
        <p className={styles.chartSentence}>{v.historySentence}</p>
      </section>

      {/* Evidence */}
      <section className={styles.evidence}>
        <div className={styles.checks}>
          <WasPriceCheck p={p} v={v} />
          <PackSizes p={p} v={v} />
        </div>
        <div className={styles.shrink}>
          <div className={styles.shrinkHeading}>
            <p className={styles.tag}>PACKAGED VARIANT</p>
            <h3 className={styles.h3}>Shrinkflation record</h3>
            <p className={styles.mutedSmall}>Shown when a matched packaged item changes size.</p>
          </div>
          <NotWired className={styles.shrinkBody} label={
            p.netSizeValue != null ? `Net size ${p.netSizeValue}${p.netSizeUom} in every capture so far` : "No net size recorded for this line"
          } needs="a change in net_size_value for the same SKU across captures" />
        </div>
      </section>

      {/* More product records */}
      <section className={styles.more}>
        <h2 className={styles.h2}>Cheaper like-for-like in {titleCase(p.subcategory || p.sap.subcategory)}</h2>
        {p.alternatives.length ? (
          <div className={styles.subs}>
            {p.alternatives.map((a) => (
              <a key={a.key} href={`#/product/${a.retailer}/${a.sku}`} className={styles.sub}>
                <span className={styles.subImage}>{a.imageUrl && <img src={a.imageUrl} alt="" loading="lazy" />}</span>
                <span className={styles.subName}>{a.displayName}</span>
                <span className={styles.subStore} style={{ color: STORE_COLOUR[a.retailer] }}>{STORE_LABEL[a.retailer].toUpperCase()}</span>
                <span className={styles.subPrice}>{formatUnit(a.latest) || money(a.latest.price)}</span>
                <span className={styles.subDelta}>
                  {L.unitPrice != null && a.latest.unitPrice != null ? `${pct(L.unitPrice, a.latest.unitPrice)}% per ${v.unitShort}` : money(a.latest.price)}
                </span>
              </a>
            ))}
          </div>
        ) : (
          <p className={styles.noSubs}>Nothing cheaper per {v.unitShort} in this subcategory at {store} in the latest capture — this is the cheapest line.</p>
        )}

        <div className={styles.skus}>
          <div className={styles.skusHeading}>
            <h3 className={styles.h3}>All matched SKUs</h3>
            <span className={styles.skusCount}>1 match</span>
          </div>
          <table className={styles.table}>
            <thead><tr><th>Retailer</th><th>SKU</th><th>Display name</th><th>Size</th><th>Price</th><th>Unit</th><th>Link out</th></tr></thead>
            <tbody>
              <tr>
                <td style={{ color: colour, fontWeight: 900 }}>{store.toUpperCase()}</td>
                <td className="mono">{p.sku}</td>
                <td>{p.displayName}</td>
                <td className="mono">{p.packageSize || "—"}</td>
                <td className="mono">{money(L.price)}</td>
                <td className="mono">{formatUnit(L) || "—"}</td>
                <td><a href={p.productUrl} target="_blank" rel="noreferrer">{store} ↗</a></td>
              </tr>
            </tbody>
          </table>
          <p className={styles.mutedSmall}>Other retailers’ SKUs for this product appear here once cross-retailer matching exists.</p>
        </div>

        <details className={styles.obsTable}>
          <summary>Every observation of this SKU ({p.observations.length})</summary>
          <table className={styles.table}>
            <thead><tr><th>Captured (UTC)</th><th>Run</th><th>Price</th><th>Was</th><th>Special</th><th>Unit</th><th>Available</th><th>Source</th><th>File</th></tr></thead>
            <tbody>
              {[...p.observations].reverse().map((o) => (
                <tr key={o.runId}>
                  <td className="mono">{fmtUtc(o.capturedAt)}</td>
                  <td className="mono">{o.runId}</td>
                  <td className="mono">{money(o.price)}</td>
                  <td className="mono">{o.wasPrice != null ? money(o.wasPrice) : "—"}</td>
                  <td>{o.isOnSpecial ? (o.promoText || "yes") : "—"}</td>
                  <td className="mono">{formatUnit(o) || "—"}</td>
                  <td>{o.isAvailable ? "yes" : "no"}</td>
                  <td className="mono">{o.source}</td>
                  <td className="mono">{o.file}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>
    </>
  );
}

// ---- pieces -----------------------------------------------------------------

function StorePrice({ retailer, obs, pack }) {
  const special = obs.isOnSpecial;
  return (
    <div className={`${styles.storePrice} ${special ? styles.storePriceSpecial : ""}`}>
      <div className={styles.storeStatus}>
        <span className={styles.storeName} style={{ color: STORE_COLOUR[retailer] }}>{STORE_LABEL[retailer].toUpperCase()}</span>
        <span className={styles.cheapestTag}>ONLY RETAILER MATCHED</span>
      </div>
      <p className={`${styles.bigPrice} ${special ? styles.bigPriceSpecial : ""}`}>{money(obs.price)}</p>
      <p className={styles.per}>{pack && pack !== "each" ? `per ${pack} pack` : "each"}</p>
      <hr className={styles.scaleDivider} />
      <p className={special ? styles.specialLine : styles.unitLine}>
        {special ? `SPECIAL${obs.wasPrice != null ? ` · was ${money(obs.wasPrice)}` : ""}${obs.promoText && obs.promoText !== "SPECIAL" ? ` · ${obs.promoText}` : ""}` : formatUnit(obs) || "unit price not captured"}
      </p>
    </div>
  );
}

function WasPriceCheck({ p, v }) {
  const L = p.latest;
  if (L.wasPrice == null) {
    return (
      <div className={`${styles.check} ${styles.checkPlain}`}>
        <p className={styles.tag}>WAS IT EVER THAT PRICE?</p>
        <p className={styles.verdict}>No claim</p>
        <p className={styles.checkText}>{STORE_LABEL[p.retailer]} shows no ‘was’ price on this line in the latest capture.</p>
        <p className={styles.mutedSmall}>Compared against our own captures of the same SKU.</p>
      </div>
    );
  }
  const seenAtWas = p.observations.filter((o) => o.price != null && o.price >= L.wasPrice - 0.005).length;
  const n = p.observations.length;
  const verdict = seenAtWas === 0 ? "Questionable" : seenAtWas >= Math.ceil(n / 2) ? "Genuine" : "Mixed";
  return (
    <div className={`${styles.check} ${styles.checkTicket}`}>
      <p className={styles.tag}>WAS IT EVER THAT PRICE?</p>
      <p className={styles.verdict}>{verdict}</p>
      <p className={styles.checkText}>
        Marked down from {money(L.wasPrice)}. We observed it at {money(L.wasPrice)} or more in {seenAtWas} of our {n} capture{n === 1 ? "" : "s"}
        {n < 4 && " — too few captures yet to call it"}.
      </p>
      <p className={styles.mutedSmall}>Compared against our own captures of the same SKU since {fmtDate(p.firstSeen)}.</p>
    </div>
  );
}

function PackSizes({ p, v }) {
  return (
    <div className={styles.packs}>
      <h3 className={styles.h3}>Unit price across pack sizes</h3>
      <div className={styles.packBar}>
        <span className={styles.packLabel}>{p.packageSize || "this"}</span>
        <span className={styles.bar} style={{ width: 120 }} />
        <span className={styles.packPrice}>{formatUnit(p.latest) || money(p.latest.price)}</span>
      </div>
      <NotWired label="Other pack sizes of this product" needs="grouping SKUs of the same product by brand + variety (different net_size_value)" />
    </div>
  );
}

/**
 * Price history: one line per retailer (we have one), a dashed "was" line if
 * the retailer claims one, special captures as ticket markers, hover tooltip
 * with provenance. Plain SVG so it can grow with the archive.
 */
function PriceChart({ obs, colour, wasLine, unit, runs, store }) {
  const [hover, setHover] = useState(null);
  const W = 1200, H = 430, padL = 60, padR = 30, padT = 40, padB = 50;
  const pts = obs.filter((o) => o.price != null);
  if (!pts.length) return <NotWired label="No priced observations" minHeight={200} />;

  const t0 = new Date(pts[0].capturedAt).getTime();
  const t1 = new Date(pts[pts.length - 1].capturedAt).getTime();
  const span = Math.max(t1 - t0, 1);
  const prices = pts.map((o) => o.price).concat(wasLine != null ? [wasLine] : []);
  let lo = Math.min(...prices), hi = Math.max(...prices);
  if (hi - lo < 0.5) { lo -= 0.5; hi += 0.5; }
  lo = Math.max(0, lo - (hi - lo) * 0.15); hi = hi + (hi - lo) * 0.15;
  const x = (o) => pts.length === 1 ? (padL + (W - padL - padR) / 2) : padL + ((new Date(o.capturedAt).getTime() - t0) / span) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);

  const gridVals = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + f * (hi - lo));
  const path = pts.map((o, i) => `${i ? "L" : "M"}${x(o).toFixed(1)} ${y(o.price).toFixed(1)}`).join(" ");
  const xLabels = pts.length <= 6 ? pts : [pts[0], pts[Math.floor(pts.length / 2)], pts[pts.length - 1]];

  return (
    <div className={styles.plotWrap}>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.plot} onMouseLeave={() => setHover(null)}>
        <text x={8} y={18} className={styles.axisLabel}>{unit}</text>
        {gridVals.map((g) => (
          <g key={g}>
            <line x1={padL} x2={W - padR} y1={y(g)} y2={y(g)} className={styles.grid} />
            <text x={padL - 8} y={y(g) + 3} textAnchor="end" className={styles.axisLabel}>{money(g)}</text>
          </g>
        ))}
        {wasLine != null && (
          <g>
            <line x1={padL} x2={W - padR} y1={y(wasLine)} y2={y(wasLine)} className={styles.wasLine} />
            <text x={W - padR} y={y(wasLine) - 8} textAnchor="end" className={styles.wasLabel}>{store} says ‘was {money(wasLine)}’</text>
          </g>
        )}
        <path d={path} fill="none" stroke={colour} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((o, i) => (
          <g key={o.runId} onMouseEnter={() => setHover(i)}>
            {o.isOnSpecial
              ? <rect x={x(o) - 7} y={y(o.price) - 7} width={14} height={14} fill="var(--ticket)" stroke="var(--ink)" strokeWidth={1.5} />
              : <circle cx={x(o)} cy={y(o.price)} r={6} fill={colour} stroke="var(--paper-2)" strokeWidth={2} />}
            <circle cx={x(o)} cy={y(o.price)} r={18} fill="transparent" />
          </g>
        ))}
        {xLabels.map((o) => (
          <text key={o.runId} x={x(o)} y={H - 18} textAnchor="middle" className={styles.axisLabel}>{fmtDateShort(o.capturedAt)}</text>
        ))}
      </svg>
      {hover != null && (() => {
        const o = pts[hover];
        const run = runs?.find?.((r) => r && r.runId === o.runId);
        const left = (x(o) / W) * 100, top = (y(o.price) / H) * 100;
        return (
          <div className={styles.tooltip} style={{ left: `${Math.min(left, 78)}%`, top: `${Math.min(top, 60)}%` }}>
            <p>{fmtDateShort(o.capturedAt)} {new Date(o.capturedAt).getFullYear()}</p>
            <p className={styles.tooltipPrice}>{money(o.price)}{o.isOnSpecial ? " · SPECIAL" : ""}</p>
            <p className={styles.tooltipMeta}>
              {store} {o.priceBasis} · {o.runId} · captured {fmtUtc(o.capturedAt).slice(11)}
              {run && ` · run ${run.status}`}{formatUnit(o) && ` · ${formatUnit(o)}`}
            </p>
          </div>
        );
      })()}
    </div>
  );
}

// ---- derivation -------------------------------------------------------------

function buildView(p) {
  const obs = p.observations.filter((o) => o.price != null);
  const first = obs[0], last = obs[obs.length - 1];
  const unitLabel = last.pricePerKg != null ? "$/kg" : last.pricePerL != null ? "$/L" : last.pricePerEach != null ? "$/each" : "$ shelf price";
  const unitShort = unitLabel.replace("$/", "").replace("$ shelf price", "unit");
  const spanDays = Math.round((new Date(last.capturedAt) - new Date(first.capturedAt)) / 86400000);
  const prices = obs.map((o) => o.price);
  const lo = Math.min(...prices), hi = Math.max(...prices);
  const wasLine = last.wasPrice ?? obs.map((o) => o.wasPrice).filter((w) => w != null).pop() ?? null;
  const specials = obs.filter((o) => o.isOnSpecial).length;
  const deltaVsFirst = obs.length > 1 ? pct(first.price, last.price) : null;

  let historySentence;
  if (obs.length === 1) historySentence = `One capture so far, on ${fmtDate(first.capturedAt)}. The line fills in as the twice-daily crawl runs.`;
  else if (lo === hi) historySentence = `${STORE_LABEL[p.retailer]} has held this at ${money(lo)} in all ${obs.length} captures over ${spanDays} days.`;
  else historySentence = `Across ${obs.length} captures over ${spanDays} days it ranged from ${money(lo)} to ${money(hi)}${specials ? `, on special ${specials} time${specials === 1 ? "" : "s"}` : ""}.`;

  return { unitLabel, unitShort, spanDays, wasLine, specials, deltaVsFirst, historySentence };
}


function titleCase(s) {
  return String(s || "").toLowerCase().replace(/(^|\s|\/)\w/g, (c) => c.toUpperCase()).replace(/\bAnd\b/g, "and");
}
