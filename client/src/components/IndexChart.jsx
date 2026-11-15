import { useState } from "react";
import NotWired from "./NotWired";
import { periodLabel, periodDate, periodStart, fmtYoy } from "../lib/abs";
import { fmtDate } from "../lib/format";
import styles from "./IndexChart.module.css";

/**
 * Price index chart, 2014 = 100. One line per ABS series, quarterly, drawn on
 * a real time axis that runs to today — so the ABS line ends where ABS ends
 * and the gap to "our captures start" is visible. ABS is the backstory; our
 * own line takes over from the handover and stays a NotWired until it exists.
 * Plain SVG, same conventions as the product-page PriceChart.
 *
 * lines: [{ key, label, index: number[], yoy: number[], colour, width, dash }]
 * highlight: { from: "2022-Q1", to: "2022-Q3", label } shades those quarters (inclusive) —
 * how a "Did you know?" fact points at the stretch of the line it is talking about.
 */
export default function IndexChart({ periods, lines, tone = "light", handover, highlight, source, notWired, height = 260 }) {
  const [hover, setHover] = useState(null);
  const W = 1200, H = 430, padL = 52, padR = 24, padT = 28, padB = 44;
  if (!periods?.length || !lines?.length) return <NotWired label="No index series" minHeight={height} />;

  const t0 = Date.UTC(Number(periods[0].slice(0, 4)), 0, 1);
  const t1 = Math.max(Date.now(), handover ? new Date(handover.at).getTime() : 0);
  const all = lines.flatMap((l) => l.index).filter((v) => v != null);
  let lo = Math.floor(Math.min(...all) / 10) * 10, hi = Math.ceil(Math.max(...all) / 10) * 10;
  if (hi - lo < 20) hi = lo + 20;
  const x = (t) => padL + ((t - t0) / (t1 - t0)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const px = periods.map((p) => x(periodDate(p).getTime()));

  const step = hi - lo > 60 ? 20 : 10;
  const gridVals = [];
  for (let g = lo; g <= hi; g += step) gridVals.push(g);
  const years = [];
  for (let yr = Number(periods[0].slice(0, 4)); yr <= new Date(t1).getUTCFullYear(); yr += 2) years.push(yr);
  const pathOf = (idx) => idx
    .map((v, i) => (v == null ? null : `${i && idx[i - 1] != null ? "L" : "M"}${px[i].toFixed(1)} ${y(v).toFixed(1)}`))
    .filter(Boolean).join(" ");
  const lastI = periods.length - 1;
  const hx = handover ? x(new Date(handover.at).getTime()) : null;
  // Band edges: start of the first quarter to the end of the last, clamped to the plot.
  const band = highlight ? (() => {
    const bx0 = Math.max(padL, x(periodStart(highlight.from).getTime()));
    const bx1 = Math.min(W - padR, x(periodDate(highlight.to).getTime()));
    return bx1 > bx0 ? { x: bx0, w: bx1 - bx0 } : null;
  })() : null;
  // The label sits inside the band when it fits, otherwise just to its right.
  const bandLabelW = highlight?.label ? highlight.label.length * 6.5 + 12 : 0;
  const bandLabelInside = band && band.w >= bandLabelW;
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const mx = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    for (let i = 1; i < px.length; i++) if (Math.abs(px[i] - mx) < Math.abs(px[best] - mx)) best = i;
    setHover(best);
  };

  return (
    <div className={`${styles.wrap} ${tone === "dark" ? styles.dark : styles.light}`}>
      <div className={styles.legend}>
        {lines.map((l) => (
          <span key={l.key} className={styles.legendItem}>
            <i className={styles.swatch} style={{ background: l.colour, height: l.width || 3 }} />{l.label}
          </span>
        ))}
        {notWired && <NotWired inline className={styles.chip} label={notWired.label} needs={notWired.needs} />}
      </div>
      <div className={styles.plotWrap}>
        <svg viewBox={`0 0 ${W} ${H}`} className={styles.plot} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          <text x={4} y={14} className={styles.axisLabel}>2014 = 100</text>
          {band && (
            <g>
              <rect x={band.x} y={padT} width={band.w} height={H - padT - padB} className={styles.band} />
              {highlight.label && (
                <text x={bandLabelInside ? band.x + 6 : band.x + band.w + 6} y={padT + 12} className={styles.bandLabel}>
                  {highlight.label}
                </text>
              )}
            </g>
          )}
          {gridVals.map((g) => (
            <g key={g}>
              <line x1={padL} x2={W - padR} y1={y(g)} y2={y(g)} className={styles.grid} />
              <text x={padL - 8} y={y(g) + 3} textAnchor="end" className={styles.axisLabel}>{g}</text>
            </g>
          ))}
          {years.map((yr) => (
            <text key={yr} x={x(Date.UTC(yr, 0, 1))} y={H - 16} textAnchor="middle" className={styles.axisLabel}>{yr}</text>
          ))}
          {hx != null && (
            <g>
              <line x1={hx} x2={hx} y1={padT} y2={H - padB} className={styles.handover} />
              <text x={hx - 8} y={H - padB - 8} textAnchor="end" className={styles.handoverLabel}>{handover.label}</text>
            </g>
          )}
          {hover != null && <line x1={px[hover]} x2={px[hover]} y1={padT} y2={H - padB} className={styles.cursor} />}
          {lines.map((l) => (
            <path key={l.key} d={pathOf(l.index)} fill="none" stroke={l.colour} strokeWidth={l.width || 3}
                  strokeDasharray={l.dash} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {lines[0].index[lastI] != null && (
            <g>
              <circle cx={px[lastI]} cy={y(lines[0].index[lastI])} r={6} fill={lines[0].colour} />
              <text x={px[lastI]} y={y(lines[0].index[lastI]) - 12} textAnchor="middle" className={styles.endLabel}>
                ABS · {periodLabel(periods[lastI]).replace(" qtr", "")}
              </text>
            </g>
          )}
        </svg>
        {hover != null && (
          <div className={styles.tooltip} style={{ left: `${Math.min((px[hover] / W) * 100, 72)}%` }}>
            <p className={styles.tooltipPeriod}>{periodLabel(periods[hover])}</p>
            {lines.map((l) => (
              <p key={l.key}>
                <i className={styles.swatch} style={{ background: l.colour }} />
                {l.label}: <b>{l.index[hover] ?? "—"}</b> · {fmtYoy(l.yoy?.[hover])} YoY
              </p>
            ))}
            <p className={styles.tooltipMeta}>ABS CPI 6401.0 · original · Australia · 2014 = 100</p>
          </div>
        )}
      </div>
      {source && (
        <p className={styles.source}>
          Source: {source.name}, {source.measure.toLowerCase()}, {source.region}. Re-based {source.base.split(" (")[0]}.
          Data to {periodLabel(source.lastPeriod)}, fetched {fmtDate(source.fetchedAt)}. {source.licence}.
        </p>
      )}
    </div>
  );
}
