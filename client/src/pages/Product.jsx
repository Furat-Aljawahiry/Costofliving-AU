import { useEffect, useMemo, useState } from "react";
import { api } from "../services/api";
import Masthead from "../components/Masthead";
import Footer from "../components/Footer";
import NotWired from "../components/NotWired";
import { STORE_LABEL, STORE_COLOUR, money, formatUnit, fmtDate, fmtDateShort, fmtUtc, pct } from "../lib/format";
import styles from "./Product.module.css";
import { AISLE_OF } from "../lib/categories";

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
          <a href="#/">Home</a> › <a href={`#/category/${AISLE_OF[p.crawlCategory] || "vegetables"}`}>{titleCase(p.department || p.sap.department)}</a> › {titleCase(p.subcategory || p.sap.subcategory)}
        </p>
        <div className={styles.intro}>
          <div className={styles.imageField}>
            {p.imageUrl ? <img src={p.imageUrl} alt={p.displayName} /> : <NotWired label="No image in capture" />}
          </div>
          <div className={styles.copy}>
            <p className={styles.kicker}>{(p.subcategory || p.sap.subcategory || "").toUpperCase()} · {store.toUpperCase()}</p>
            <h1 className={styles.title}>{p.itemLabel || p.displayName}</h1>
            <p className={styles.rawName}>Listed as “{p.displayName}”</p>

            {/* Every size this retailer sells the item in; each tab is that size's own SKU. */}
            <div className={styles.sizeTabs}>
              {p.sizes.map((s) => (
                s.sku === p.sku
                  ? <span key={s.sku} className={`${styles.sizeTab} ${styles.sizeTabActive}`}>{s.sizeLabel}</span>
                  : <a key={s.sku} href={`#/product/${s.retailer}/${s.sku}`} className={styles.sizeTab} title={formatUnit(s.latest) || money(s.latest.price)}>{s.sizeLabel}</a>
              ))}
              {p.sizes.length === 1 && <span className={styles.sizeNote}>only size at {store}</span>}
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
                {p.sizeGrade && <span> · Grade: {p.sizeGrade}</span>}
                {p.portion && p.portion !== "whole" && <span> · Portion: {p.portion}</span>}
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
          {RETAILERS.map((r) => {
            if (r === p.retailer) return <StorePrice key={r} retailer={r} obs={L} pack={p.sizeLabel} verdict={v.verdict} />;
            const m = v.matchByRetailer[r];
            // A matched retailer with a comparable price gets a real card. One
            // that is matched but not comparable gets the price AND the server's
            // reason, with no winner styling. `comparable` is the server's call —
            // the client never re-derives it from the level.
            //
            // `group-only` deliberately does NOT get a price card. It means "same
            // group, different or unknown variety" — printing a big price for a
            // butternut pumpkin on a japnut pumpkin's page is a comparison the
            // level exists to forbid, whatever the tag beside it says. It gets a
            // browse list instead.
            if (m && m.level !== "group-only") return <MatchedStorePrice key={r} match={m} />;
            if (m) return <GroupOnlyStore key={r} match={m} group={p.matchKeyKind === "snacks" ? "lines from this brand" : p.matchGroup} />;
            return (
              <div key={r} className={styles.storeMissing}>
                <span className={styles.storeName} style={{ color: STORE_COLOUR[r] }}>{STORE_LABEL[r].toUpperCase()}</span>
                <NotWired label={`No ${STORE_LABEL[r]} match`} needs={
                  r === "aldi" || r === "market"
                    ? `a ${STORE_LABEL[r]} crawler`
                    : p.matchKey
                      ? `a ${STORE_LABEL[r]} line matching ${p.matchKey} in the latest capture`
                      : "a variety we can name — this line is matched by group only, so it is not price-compared"
                } />
              </div>
            );
          })}
        </div>
        <p className={styles.priceSentence}>
          {store} today: {money(L.price)}{formatUnit(L) && ` (${formatUnit(L)})`}
          {L.isOnSpecial && L.wasPrice != null && ` — on special, marked down from ${money(L.wasPrice)}`}
          {!L.isAvailable && " — listed as unavailable at capture"}
          {v.deltaVsFirst != null && v.deltaVsFirst !== 0 && ` · ${v.deltaVsFirst > 0 ? "↑" : "↓"}${Math.abs(v.deltaVsFirst)}% vs ${fmtDate(p.firstSeen)}`}
          {v.deltaVsFirst === 0 && p.observations.length > 1 && ` · unchanged since ${fmtDate(p.firstSeen)}`}
          {/* The comparison clause appears ONLY when the server said comparable. */}
          {v.headline && ` · ${v.headline}`}.
        </p>
        {v.skewNote && <p className={styles.skewNote}>{v.skewNote}</p>}
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
            <span className={styles.skusCount}>
              {p.sizes.length} at {store}
              {v.matches.map((m) => ` · ${m.sizes.length} at ${STORE_LABEL[m.retailer]}`)}
            </span>
          </div>
          <table className={styles.table}>
            <thead><tr><th>Retailer</th><th>SKU</th><th>Listed as</th><th>Size</th><th>Price</th><th>Unit</th><th>Compared</th><th>Link out</th></tr></thead>
            <tbody>
              {p.sizes.map((s) => (
                <tr key={s.sku} style={s.sku === p.sku ? { fontWeight: 700 } : undefined}>
                  <td style={{ color: colour, fontWeight: 900 }}>{store.toUpperCase()}</td>
                  <td className="mono"><a href={`#/product/${s.retailer}/${s.sku}`}>{s.sku}</a></td>
                  <td>{s.displayName}</td>
                  <td className="mono">{s.sizeLabel}</td>
                  <td className="mono">{money(s.latest.price)}</td>
                  <td className="mono">{formatUnit(s.latest) || "—"}</td>
                  <td className={styles.mutedSmall}>same retailer</td>
                  <td><a href={s.productUrl} target="_blank" rel="noreferrer">{store} ↗</a></td>
                </tr>
              ))}
              {/* The other retailers' rows. Each carries its OWN comparability,
                  because the level is a property of a SKU pair: two Coles lines
                  under one key can differ, one per kg and one per each. */}
              {v.matches.flatMap((m) => m.sizes.map((s) => (
                <tr key={`${m.retailer}:${s.sku}`}>
                  <td style={{ color: STORE_COLOUR[m.retailer], fontWeight: 900 }}>{STORE_LABEL[m.retailer].toUpperCase()}</td>
                  <td className="mono"><a href={`#/product/${s.retailer}/${s.sku}`}>{s.sku}</a></td>
                  <td>{s.displayName}</td>
                  <td className="mono">{s.sizeLabel}</td>
                  <td className="mono">{money(s.latest?.price)}</td>
                  <td className="mono">{formatUnit(s.latest) || "—"}</td>
                  <td className={styles.mutedSmall} title={s.notComparableReason || ""}>
                    {s.comparable ? `yes, per ${basisWord(s.basis)}` : `no — ${s.notComparableReason || m.notComparableReason}`}
                  </td>
                  <td><a href={s.productUrl} target="_blank" rel="noreferrer">{STORE_LABEL[m.retailer]} ↗</a></td>
                </tr>
              )))}
            </tbody>
          </table>
          <p className={styles.mutedSmall}>
            {p.matchKey
              ? <>Matched on <code>{p.matchKey}</code> — group and variety read from the product name, brand and the retailer’s own subcategory. A row marked “no” is the same product listed in a way these two prices cannot be compared on.</>
              : <>This line is matched by group only — we cannot yet name its variety, so it is browsable but never price-compared. Adding it to the variety lexicon is what changes that.</>}
          </p>
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

function StorePrice({ retailer, obs, pack, verdict }) {
  const special = obs.isOnSpecial;
  return (
    <div className={`${styles.storePrice} ${special ? styles.storePriceSpecial : ""} ${verdict === "cheapest" ? styles.storePriceWins : ""}`}>
      <div className={styles.storeStatus}>
        <span className={styles.storeName} style={{ color: STORE_COLOUR[retailer] }}>{STORE_LABEL[retailer].toUpperCase()}</span>
        {/* Was hardcoded "ONLY RETAILER MATCHED" — now the real state, decided
            server-side from `comparable`, never from the level name. */}
        <span className={styles.cheapestTag}>
          {verdict === "cheapest" ? "CHEAPEST OF THE MATCHED" : verdict === "dearer" ? "DEARER THAN THE MATCH" : verdict === "level" ? "SAME PRICE" : "ONLY RETAILER MATCHED"}
        </span>
      </div>
      <p className={`${styles.bigPrice} ${special ? styles.bigPriceSpecial : ""}`}>{money(obs.price)}</p>
      <p className={styles.per}>{pack && pack !== "each" ? `per ${pack}` : "each"}</p>
      <hr className={styles.scaleDivider} />
      <p className={special ? styles.specialLine : styles.unitLine}>
        {special ? `SPECIAL${obs.wasPrice != null ? ` · was ${money(obs.wasPrice)}` : ""}${obs.promoText && obs.promoText !== "SPECIAL" ? ` · ${obs.promoText}` : ""}` : formatUnit(obs) || "unit price not captured"}
      </p>
    </div>
  );
}

/**
 * The other retailer's price for the same product (P2.1).
 *
 * Two states, and the difference between them is the whole point of the feature:
 *
 *   comparable      the server found a shared unit basis and compatible pack
 *                   semantics, so the two numbers mean the same thing. Show the
 *                   delta and style a winner.
 *   not comparable  we found the same product but the prices are not
 *                   like-for-like (per-kg here, per-each there; a 6-pack against
 *                   a single; captured a day apart). Show BOTH prices and the
 *                   server's reason — never a delta, never a winner.
 *
 * The component branches on `match.comparable` only. It never inspects
 * `match.level`, because a client that can decide comparability can decide it
 * wrongly, and a wrong "cheaper at Coles" is the failure this project most has
 * to avoid.
 */
function MatchedStorePrice({ match }) {
  const r = match.retailer;
  const best = match.comparison?.other ?? match.sizes.find((s) => s.latest?.price != null) ?? match.sizes[0];
  const obs = best?.latest;
  const cheaper = match.comparison?.delta?.cheaper;
  const wins = cheaper === r;
  return (
    <div className={`${styles.storePrice} ${wins ? styles.storePriceWins : ""} ${match.comparable ? "" : styles.storePriceUncompared}`}>
      <div className={styles.storeStatus}>
        <span className={styles.storeName} style={{ color: STORE_COLOUR[r] }}>{STORE_LABEL[r].toUpperCase()}</span>
        <span className={styles.cheapestTag}>
          {match.comparable ? (wins ? "CHEAPER HERE" : cheaper ? "DEARER" : "SAME PRICE") : "NOT COMPARED"}
        </span>
      </div>
      <p className={styles.bigPrice}>{money(obs?.price)}</p>
      <p className={styles.per}>{best?.sizeLabel && best.sizeLabel !== "each" ? `per ${best.sizeLabel}` : "each"}</p>
      <hr className={styles.scaleDivider} />
      <p className={styles.unitLine}>{formatUnit(obs) || "unit price not captured"}</p>
      {match.comparable && match.comparison.delta?.pct != null && (
        <p className={styles.deltaLine}>
          {match.comparison.delta.pct === 0
            ? `same per ${basisWord(match.comparison.basis)}`
            : `${Math.abs(match.comparison.delta.pct)}% ${match.comparison.delta.pct < 0 ? "cheaper" : "dearer"} per ${basisWord(match.comparison.basis)}`}
        </p>
      )}
      {!match.comparable && <p className={styles.uncomparedLine}>{match.notComparableReason}</p>}
      {best?.productUrl && (
        <p className={styles.matchLink}>
          <a href={`#/product/${r}/${best.sku}`}>{best.displayName}</a>
          {" · "}
          <a href={best.productUrl} target="_blank" rel="noreferrer">at {STORE_LABEL[r]} ↗</a>
        </p>
      )}
    </div>
  );
}

/**
 * Same group, different or unknown variety. A browse list — names and links, no
 * prices at all. Showing a price here would be a comparison between two
 * different products, which is exactly what `group-only` withholds.
 */
function GroupOnlyStore({ match, group }) {
  const r = match.retailer;
  return (
    <div className={styles.storeGroupOnly}>
      <div className={styles.storeStatus}>
        <span className={styles.storeName} style={{ color: STORE_COLOUR[r] }}>{STORE_LABEL[r].toUpperCase()}</span>
        <span className={styles.cheapestTag}>NOT COMPARED</span>
      </div>
      <p className={styles.uncomparedLine}>{match.notComparableReason}</p>
      <p className={styles.groupOnlyLabel}>Other {String(group || "").replace(/-/g, " ")} at {STORE_LABEL[r]}:</p>
      <ul className={styles.groupOnlyList}>
        {match.sizes.slice(0, 5).map((s) => (
          <li key={s.sku}><a href={`#/product/${s.retailer}/${s.sku}`}>{s.displayName}</a></li>
        ))}
      </ul>
    </div>
  );
}

// "pack" is snacks: the server compares their shelf prices only when the two
// packs are identical (server/data/snacks/weights.js).
const basisWord = (b) => (b === "each" ? "each" : b === "L" ? "litre" : b === "pack" ? "pack" : "kg");

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

// Unit price of every size of this item at this retailer, on the same
// basis as this SKU. Sizes priced on another basis (loose per each beside a
// per-kg bag) are listed but not drawn — a bar would compare $/ea to $/kg.
function PackSizes({ p, v }) {
  const basis = p.latest.unitMeasure;
  const same = p.sizes.filter((s) => s.latest.unitMeasure === basis && s.latest.unitPrice != null);
  const other = p.sizes.filter((s) => !same.includes(s));
  const max = Math.max(...same.map((s) => s.latest.unitPrice), 0.01);
  const cheapest = same.reduce((a, s) => (!a || s.latest.unitPrice < a.latest.unitPrice ? s : a), null);
  return (
    <div className={styles.packs}>
      <h3 className={styles.h3}>Unit price across pack sizes</h3>
      {same.map((s) => (
        <a key={s.sku} href={`#/product/${s.retailer}/${s.sku}`} className={`${styles.packBar} ${s.sku === p.sku ? styles.packBarThis : ""}`}>
          <span className={styles.packLabel}>{s.sizeLabel}</span>
          <span className={styles.bar} style={{ width: `${Math.round((s.latest.unitPrice / max) * 100)}%`, background: s === cheapest ? "var(--cheap)" : "var(--ink)" }} />
          <span className={styles.packPrice}>{formatUnit(s.latest)}{s.sku === p.sku ? " ◂" : ""}</span>
        </a>
      ))}
      {same.length > 1 && cheapest && cheapest.sku !== p.sku && (
        <p className={styles.mutedSmall}>
          The {cheapest.sizeLabel} is {Math.abs(pct(p.latest.unitPrice, cheapest.latest.unitPrice))}% cheaper per {v.unitShort} than this {p.sizeLabel}.
        </p>
      )}
      {same.length === 1 && !other.length && <p className={styles.mutedSmall}>Only one size of this item at {STORE_LABEL[p.retailer]} in the latest capture.</p>}
      {other.length > 0 && (
        <p className={styles.mutedSmall}>
          Also sold {other.map((s) => `${s.sizeLabel} at ${formatUnit(s.latest) || money(s.latest.price)}`).join(", ")} — priced per {other[0].latest.unitMeasure?.replace(/^1/, "").toLowerCase() || "unit"}, so not on this scale.
        </p>
      )}
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
  // A line that was out of stock in every capture has no priced observation at
  // all; fall back to the raw captures so the page still renders.
  const first = obs[0] ?? p.observations[0], last = obs[obs.length - 1] ?? p.latest;
  const unitLabel = last.pricePerKg != null ? "$/kg" : last.pricePerL != null ? "$/L" : last.pricePerEach != null ? "$/each" : "$ shelf price";
  const unitShort = unitLabel.replace("$/", "").replace("$ shelf price", "unit");
  const spanDays = Math.round((new Date(last.capturedAt) - new Date(first.capturedAt)) / 86400000);
  const prices = obs.map((o) => o.price);
  const lo = Math.min(...prices), hi = Math.max(...prices);
  const wasLine = last.wasPrice ?? obs.map((o) => o.wasPrice).filter((w) => w != null).pop() ?? null;
  const specials = obs.filter((o) => o.isOnSpecial).length;
  const deltaVsFirst = obs.length > 1 ? pct(first.price, last.price) : null;

  let historySentence;
  if (obs.length === 0) historySentence = `No price yet — ${STORE_LABEL[p.retailer]} listed this as unavailable in all ${p.observations.length} capture${p.observations.length === 1 ? "" : "s"} since ${fmtDate(first.capturedAt)}.`;
  else if (obs.length === 1) historySentence = `One capture so far, on ${fmtDate(first.capturedAt)}. The line fills in as the twice-daily crawl runs.`;
  else if (lo === hi) historySentence = `${STORE_LABEL[p.retailer]} has held this at ${money(lo)} in all ${obs.length} captures over ${spanDays} days.`;
  else historySentence = `Across ${obs.length} captures over ${spanDays} days it ranged from ${money(lo)} to ${money(hi)}${specials ? `, on special ${specials} time${specials === 1 ? "" : "s"}` : ""}.`;

  // Cross-retailer matches (P2.1), indexed by retailer for the Price now row.
  const matches = p.matches || [];
  const matchByRetailer = Object.fromEntries(matches.map((m) => [m.retailer, m]));
  // Only a `comparable` match may produce a headline. There is deliberately no
  // fallback branch here: if the server did not say comparable, nothing is said.
  const comparable = matches.filter((m) => m.comparable && m.comparison?.delta?.pct != null);
  const cheapestElsewhere = comparable
    .filter((m) => m.comparison.delta.pct < 0)
    .sort((a, b) => a.comparison.delta.pct - b.comparison.delta.pct)[0];
  const verdict = !comparable.length ? null
    : cheapestElsewhere ? "dearer"
    : comparable.every((m) => m.comparison.delta.pct === 0) ? "level" : "cheapest";

  let headline = null;
  if (cheapestElsewhere) {
    const c = cheapestElsewhere.comparison;
    const there = c.basis === "pack" ? `${money(c.other.latest.price)} for the same ${c.other.sizeLabel || "pack"}` : formatUnit(c.other.latest);
    headline = `${Math.abs(c.delta.pct)}% cheaper at ${STORE_LABEL[cheapestElsewhere.retailer]} (${there})`;
  } else if (verdict === "cheapest") {
    const m = comparable[0];
    const per = m.comparison.basis === "pack" ? "pack" : unitShort;
    headline = `cheaper than ${STORE_LABEL[m.retailer]} by ${Math.abs(m.comparison.delta.pct)}% per ${per}`;
  } else if (verdict === "level") {
    const per = comparable[0].comparison.basis === "pack" ? "pack" : unitShort;
    headline = `the same price per ${per} as ${STORE_LABEL[comparable[0].retailer]}`;
  }

  // Two prices captured hours apart are not strictly like-for-like, and the
  // site's credibility rests on saying so rather than on hiding it.
  const skew = Math.max(0, ...comparable.map((m) => m.comparison.captureSkewHours || 0));
  const skewNote = skew >= 1
    ? `Compared prices were captured ${skew} h apart — the nearest runs either side of each other, not the same instant.`
    : null;

  return {
    unitLabel, unitShort, spanDays, wasLine, specials, deltaVsFirst, historySentence,
    matches, matchByRetailer, verdict, headline, skewNote,
  };
}


function titleCase(s) {
  return String(s || "").toLowerCase().replace(/(^|\s|\/)\w/g, (c) => c.toUpperCase()).replace(/\bAnd\b/g, "and");
}
