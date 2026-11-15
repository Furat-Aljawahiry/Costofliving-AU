// Numbers for "Did you know?" facts, computed from the ABS series at render
// time so they stay true after every `npm run fetch-abs`. A fact's `text(s)`
// receives the object from makeStats() and returns an array of strings and
// figures; `s.pct(v)` / `s.fig(str)` mark the bits that render as <Figure>.

// 17.04 -> "+17.0%", -7.26 -> "−7.3%", with `sign: false` -> "17.0%"
export function fmtPct(v, { sign = true, digits = 1 } = {}) {
  if (v == null) return "—";
  const s = `${Math.abs(v).toFixed(digits)}%`;
  if (!sign) return s;
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s;
}

// Rounds to the nearest whole percent, no sign: 46.8 -> "47%"
export function fmtWhole(v) {
  return v == null ? "—" : `${Math.round(Math.abs(v))}%`;
}

export function makeStats(series, periods, food) {
  const at = (p) => {
    const i = periods.indexOf(p);
    return i < 0 ? null : series.index[i];
  };
  const change = (from, to, s = series) => {
    const a = s.index[periods.indexOf(from)], b = s.index[periods.indexOf(to)];
    return a == null || b == null ? null : (b / a - 1) * 100;
  };
  const qoq = (p, s = series) => {
    const i = periods.indexOf(p);
    return i < 1 ? null : (s.index[i] / s.index[i - 1] - 1) * 100;
  };
  const yoyAt = (p, s = series) => {
    const i = periods.indexOf(p);
    return i < 0 ? null : s.yoy?.[i] ?? null;
  };
  const extreme = (pick) => {
    let best = null;
    series.index.forEach((v, i) => {
      if (v != null && (best == null || pick(v, series.index[best]))) best = i;
    });
    return best == null ? null : { i: best, period: periods[best], index: series.index[best] };
  };
  const qoqs = (s = series) => periods.slice(1).map((p) => qoq(p, s));
  const yoys = (s = series) => (s.yoy || []).filter((v) => v != null);
  // Mean q/q change for one calendar quarter (1..4) across all years.
  const seasonalMean = (q) => {
    const vals = periods.slice(1).filter((p) => p.endsWith(`Q${q}`)).map((p) => qoq(p)).filter((v) => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const count = (arr, pred) => arr.filter((v) => v != null && pred(v)).length;

  return {
    periods, series, food,
    first: periods[0], last: periods[periods.length - 1],
    at, change, qoq, yoyAt, qoqs, yoys, seasonalMean, count,
    minPoint: () => extreme((v, b) => v < b),
    maxPoint: () => extreme((v, b) => v > b),
    // Mark a value to render as the coloured <Figure> in the sentence.
    pct: (v, opts) => ({ figure: fmtPct(v, opts) }),
    whole: (v) => ({ figure: fmtWhole(v) }),
    fig: (str) => ({ figure: str }),
  };
}
