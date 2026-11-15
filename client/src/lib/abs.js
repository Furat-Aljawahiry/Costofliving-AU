// Helpers for the ABS CPI series served by /api/history (quarterly, 2014 = 100).

const QTR_MONTH = { 1: "Mar", 2: "Jun", 3: "Sep", 4: "Dec" };

// "2026-Q2" -> "Jun qtr 2026"
export function periodLabel(p) {
  const m = /^(\d{4})-Q([1-4])$/.exec(p);
  return m ? `${QTR_MONTH[m[2]]} qtr ${m[1]}` : p;
}

// "2026-Q2" -> Date at the end of the quarter (for placing quarters on a real time axis).
export function periodDate(p) {
  const m = /^(\d{4})-Q([1-4])$/.exec(p);
  if (!m) return new Date(p);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) * 3, 0));
}

// "2026-Q2" -> Date at the start of the quarter (the left edge of a highlighted band).
export function periodStart(p) {
  const m = /^(\d{4})-Q([1-4])$/.exec(p);
  if (!m) return new Date(p);
  return new Date(Date.UTC(Number(m[1]), (Number(m[2]) - 1) * 3, 1));
}

// Latest non-null point of a series -> { i, period, index, yoy }
export function latest(series, periods) {
  for (let i = series.index.length - 1; i >= 0; i--) {
    if (series.index[i] != null) return { i, period: periods[i], index: series.index[i], yoy: series.yoy[i] };
  }
  return null;
}

// 3.1 -> "+3.1%", -4.4 -> "−4.4%", 0 -> "0.0%"
export function fmtYoy(v) {
  if (v == null) return "—";
  const s = Math.abs(v).toFixed(1);
  return v > 0 ? `+${s}%` : v < 0 ? `−${s}%` : `${s}%`;
}

// Our own captures start here; ABS is the backstory before it.
export const CAPTURES_START = "2026-08-28";
