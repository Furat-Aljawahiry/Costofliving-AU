import { useEffect, useMemo, useState } from "react";
import { api } from "../services/api";
import Masthead from "../components/Masthead";
import Footer from "../components/Footer";
import NotWired from "../components/NotWired";
import IndexChart from "../components/IndexChart";
import { STORE_LABEL, STORE_COLOUR, money, formatUnitBasis, fmtDate, pct } from "../lib/format";
import { CATEGORY_COPY, CRAWLED } from "../lib/categories";
import { buildWall, groupLabel } from "../lib/cheapest";
import { periodLabel, latest, fmtYoy, CAPTURES_START } from "../lib/abs";
import styles from "./Home.module.css";

// Home — implemented from the Figma "Cost of Living AU — desktop" frame.
//
// Rule: a number is rendered only if it came out of a crawler CSV or an ABS
// series. Every other figure the design calls for is a NotWired placeholder
// that says what data would light it up. Real today: capture status, the hero
// ticket and the "Cheapest today" wall (both from cheapest-by-subcategory.csv),
// and the ABS food CPI line + YoY chips (data/abs/cpi_food.json).

const IMG = (f) => `/images/home/${f}`;

// Bento layout from the frame: `span` is a fixed flex-basis in px, null flexes.
const TILE_ART = {
  vegetables: { field: "#c8d49a", image: "cat-vegetables.png" },
  meat:       { field: "#e9b7a8", image: "cat-meat.png" },
  canned:     { field: "#d7c9a7", image: "cat-canned.png" },
  snacks:     { field: "#f0cf72", image: "cat-snacks.png" },
  staples:    { field: "#c5d8d9", image: "cat-staples.png" },
};
const BENTO_ROWS = [
  { height: 470, tiles: [{ id: "vegetables", span: 760 }, { id: "meat", span: null }] },
  { height: 400, tiles: [{ id: "canned", span: 560 }, { id: "snacks", span: null }] },
  { height: 360, tiles: [{ id: "staples", span: null }] },
];

const FINDINGS = [
  { tag: "SHRINKFLATION", needs: "net_size_value changing for the same SKU across captures" },
  { tag: "SPECIALS CHECK", needs: "≥ 12 weeks of captures to test a ‘was’ price against" },
  { tag: "BIGGER ISN’T CHEAPER", needs: "pack-size variants of one product grouped together" },
];

const TRUST = [
  { title: "Methodology →",       text: "See exactly how we match products and unit prices." },
  { title: "Data quality →",      text: "Last runs, failures and current coverage." },
  { title: "Download the data →", text: "Weekly observations as CSV." },
  { title: "Independent →",       text: "No affiliate links, no retailer deals." },
];

export default function Home({ status }) {
  const [cheapest, setCheapest] = useState(null);
  const [heroProduct, setHeroProduct] = useState(null);
  const [history, setHistory] = useState(null); // ABS CPI snapshot; false = unavailable

  useEffect(() => {
    let alive = true;
    api.cheapest("fruitAndVeg").then((c) => alive && setCheapest(c)).catch(() => alive && setCheapest([]));
    api.history().then((h) => alive && setHistory(h)).catch(() => alive && setHistory(false));
    return () => { alive = false; };
  }, []);

  const food = history ? latest(history.series["20001"], history.periods) : null;
  // The ABS YoY for a tile: its aisle's first mapped line, or the Food headline
  // where ABS has no single group (staples).
  const tileAbs = (id) => {
    if (!history) return null;
    const a = history.aisles[id];
    const s = a?.lines.length === 1 ? history.series[a.lines[0]] : history.series["20001"];
    const l = s && latest(s, history.periods);
    return l && { ...l, label: s.label, single: a?.lines.length === 1 };
  };

  const wall = useMemo(() => (cheapest ? buildWall(cheapest) : null), [cheapest]);
  const hero = wall?.byGroup.potatoes || null;

  // The ticket's delta is real: this SKU's latest price vs our first capture of it.
  useEffect(() => {
    if (!hero) return;
    let alive = true;
    api.product(hero.retailer, hero.sku).then((p) => alive && setHeroProduct(p)).catch(() => {});
    return () => { alive = false; };
  }, [hero?.retailer, hero?.sku]);

  const heroDelta = useMemo(() => {
    const obs = heroProduct?.observations?.filter((o) => o.price != null);
    if (!obs || obs.length < 2) return null;
    return { pct: pct(obs[0].price, obs[obs.length - 1].price), since: obs[0].capturedAt };
  }, [heroProduct]);

  return (
    <div className={styles.page}>
      <Masthead productCount={status?.productCount} />

      {/* Hero */}
      <section className={styles.hero}>
        <div className={styles.heroStory}>
          <div className={styles.heroCopy}>
            <p className={styles.kicker}>The public price record</p>
            <h1 className={styles.heroTitle}>What does food actually cost in Australia?</h1>
            <p className={styles.heroLede}>Every price, every week, from Woolworths and Coles. Recorded so you can check.</p>
          </div>
          <div className={styles.heroImage}>
            <img src={IMG("hero-potato.png")} alt="A brushed potato, larger than life" />
            {hero ? (
              <a href={`#/product/${hero.retailer}/${hero.sku}`} className={styles.ticket}>
                <div className={styles.ticketHead}>
                  <span>Cheapest today</span>
                  <span style={{ color: STORE_COLOUR[hero.retailer] }}>{STORE_LABEL[hero.retailer].toUpperCase()}</span>
                </div>
                <div className={styles.ticketPrice}>{formatUnitBasis(hero.unitPrice, hero.unitBasis)}</div>
                <div className={styles.ticketWhat}>cheapest potatoes today · {hero.displayName}</div>
                <div className={styles.ticketDelta}>
                  {heroDelta == null ? `${hero.candidates} candidates · median ${formatUnitBasis(hero.medianUnitPrice, hero.unitBasis)}`
                    : heroDelta.pct === 0 ? `unchanged since ${fmtDate(heroDelta.since)}`
                    : `${heroDelta.pct < 0 ? "↓" : "↑"}${Math.abs(heroDelta.pct)}% vs ${fmtDate(heroDelta.since)}`}
                </div>
                <img src={IMG("barcode.png")} alt="" className={styles.barcode} />
              </a>
            ) : (
              <div className={styles.ticketMissing}>
                <NotWired label={cheapest ? "No potatoes in the latest cheapest-by-subcategory file" : "Loading shelf ticket…"} needs="cheapest-by-subcategory.csv with a ‘potatoes’ group" />
              </div>
            )}
          </div>
        </div>
        <p className={styles.captureStatus}>
          {status
            ? `Last captured ${fmtDate(status.lastCapturedAt, { time: true })} · ${status.productCount.toLocaleString()} products · ${status.retailers.length} retailer${status.retailers.length === 1 ? "" : "s"} · ${status.observationCount.toLocaleString()} observations across ${status.runCount} runs`
            : "Reading capture manifests…"}
        </p>
      </section>

      {/* Basket index */}
      <section className={styles.basketIndex}>
        <div className={styles.receiptWrap}>
          <article className={styles.receipt}>
            <p className={styles.receiptWeek}>THE BASKET</p>
            <hr className={styles.perforation} />
            <NotWired label="A fixed basket of everyday items and what it costs this week" needs="the 34-item basket matched to real SKUs (basket_item_id is empty in every capture so far)" minHeight={150} />
            {food && <p className={styles.receiptAbs}>ABS food CPI says {fmtYoy(food.yoy)} on a year ago ({periodLabel(food.period)})</p>}
            <hr className={styles.perforation} />
            <span className={styles.receiptCta} title="Not wired yet">Build your own basket →</span>
          </article>
        </div>
        <div className={styles.basketChart}>
          <div className={styles.chartHead}>
            <p className={styles.chartTitle}>Annual change, indexed</p>
            {food && <p className={styles.absReadout}>ABS food CPI: {fmtYoy(food.yoy)} YoY · {periodLabel(food.period)} · index {food.index}</p>}
          </div>
          {history ? (
            <IndexChart
              tone="dark"
              periods={history.periods}
              lines={[{ ...history.series["20001"], key: "20001", label: "ABS food & non-alcoholic beverages", colour: "#FFFDF7" }]}
              handover={{ at: CAPTURES_START, label: "our captures start" }}
              notWired={{ label: "Our basket —", needs: "the 34-item basket matched to real SKUs (roadmap 2.2) + a year of captures" }}
              source={history.source}
              height={240}
            />
          ) : (
            <NotWired label="Our basket vs ABS Food CPI" needs={history === false ? "data/abs/cpi_food.json — run `npm run fetch-abs`" : "loading ABS series…"} minHeight={260} />
          )}
        </div>
      </section>

      {/* Categories */}
      <section className={styles.categories}>
        <div className={styles.sectionHeading}>
          <h2 className={styles.h2}>What are you paying for?</h2>
          <p className={styles.sectionBlurb}>Five aisles. Thousands of weekly observations. Start where your grocery bill hurts.</p>
        </div>
        <div className={styles.bento}>
          {BENTO_ROWS.map((row, ri) => (
            <div className={styles.bentoRow} key={ri} style={{ height: row.height }}>
              {row.tiles.map(({ id, span }) => {
                const art = TILE_ART[id], copy = CATEGORY_COPY[id];
                const measured = !!CRAWLED[id];
                const skuCount = status?.productsByCategory?.[CRAWLED[id]];
                const abs = tileAbs(id);
                return (
                  <a key={id} href={`#/category/${id}`} className={styles.tile}
                     style={{ background: art.field, flex: span ? `0 0 ${span}px` : "1 1 0" }}>
                    <div className={styles.tileImage}><img src={IMG(art.image)} alt="" /></div>
                    <div className={styles.tileDetails}>
                      <div className={styles.tileTitleRow}>
                        <h3>{copy.label}</h3>
                        {abs
                          ? <span className={styles.yoy} title={`ABS “${abs.label}”, ${periodLabel(abs.period)}${abs.single ? "" : " — ABS has no single group for this aisle"}. Our own YoY needs a year of captures.`}>ABS {fmtYoy(abs.yoy)} YoY</span>
                          : <NotWired inline label="YoY —" needs="a year of captures for this aisle" />}
                      </div>
                      <p className={styles.tileBlurb}>{copy.blurb}</p>
                      <div className={styles.tileFoot}>
                        {measured && skuCount
                          ? <span className={styles.tileMeasured}>✓ {skuCount.toLocaleString()} SKUs MEASURED</span>
                          : measured && status
                          ? <NotWired inline label="IN REVIEW" needs="crawled, not yet published — the match lists are being reviewed" />
                          : <NotWired inline label="NO CRAWL YET" needs="a Lambda category target for this aisle" />}
                        <NotWired inline label="CHEAPEST AT —" needs="cross-retailer basket matching" />
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      {/* Cheapest today */}
      <section className={styles.cheapest}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.readoutKicker}>LIVE SHELF READOUT{wall ? ` · CAPTURED ${fmtDate(wall.capturedAt).toUpperCase()}` : ""}</p>
            <h2 className={styles.h2}>Cheapest today</h2>
          </div>
          <a href="#/cheapest" className={styles.seeAll}>{wall ? `See all ${wall.groups.length} produce groups →` : ""}</a>
        </div>
        {!wall && <div className="state">Reading cheapest-by-subcategory…</div>}
        {wall && wall.groups.length === 0 && <NotWired label="No cheapest-by-subcategory file loaded" needs="a crawler run in data/out" />}
        {wall && (
          <div className={styles.priceWall}>
            {wall.groups.slice(0, 8).map((c) => (
              <a key={c.canonicalGroup} href={`#/product/${c.retailer}/${c.sku}`} className={styles.priceCell}>
                <div className={styles.cellHead}>
                  <span className={styles.cellSub}>{groupLabel(c.canonicalGroup)}</span>
                  {c.isOnSpecial && <span className={styles.specialTicket}>SPECIAL</span>}
                </div>
                <p className={styles.cellName}>{c.displayName}</p>
                <p className={styles.cellPrice}>{formatUnitBasis(c.unitPrice, c.unitBasis)}</p>
                <div className={styles.cellFoot}>
                  <span className={styles.cellStore} style={{ color: STORE_COLOUR[c.retailer] }}>{STORE_LABEL[c.retailer].toUpperCase()}</span>
                  <span className={styles.cellMeta}>{c.candidates} candidates · median {formatUnitBasis(c.medianUnitPrice, c.unitBasis)}</span>
                </div>
              </a>
            ))}
          </div>
        )}
        {wall && <p className={styles.rule}>Selection rule: {wall.selectionRule?.replace(/_/g, " ")}. Compared on unit price across {wall.retailers.map((r) => STORE_LABEL[r]).join(" and ")}.</p>}
      </section>

      {/* Findings */}
      <section className={styles.findings}>
        <h2 className={styles.h2}>What the receipts reveal</h2>
        <div className={styles.findingCards}>
          {FINDINGS.map((f) => (
            <article key={f.tag} className={styles.finding}>
              <p className={styles.findingTag}>{f.tag}</p>
              <NotWired label="No finding yet" needs={f.needs} minHeight={220} />
            </article>
          ))}
        </div>
      </section>

      {/* Trust strip */}
      <section className={styles.trust}>
        {TRUST.map((t) => (
          <span key={t.title} className={styles.trustItem} title="Not wired yet">
            <span className={styles.trustTitle}>{t.title}</span>
            <span className={styles.trustText}>{t.text}</span>
          </span>
        ))}
      </section>

      <Footer />
    </div>
  );
}

