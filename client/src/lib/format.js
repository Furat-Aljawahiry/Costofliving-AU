// Formatting helpers shared by every page. Prices are AUD, two decimals,
// always with the unit basis where one exists.

export const STORE_LABEL = { woolworths: "Woolworths", coles: "Coles", aldi: "Aldi", market: "Market" };
export const STORE_COLOUR = { woolworths: "var(--woolworths)", coles: "var(--coles)", aldi: "var(--aldi)", market: "var(--market)" };

export function money(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return `$${Number(n).toFixed(2)}`;
}

// Unit price in the form the site uses: "$2.95/kg", "$1.18/ea", "$1.60/100g".
export function formatUnit(obs) {
  if (!obs) return "";
  if (obs.pricePerKg != null) return `${money(obs.pricePerKg)}/kg`;
  if (obs.pricePerL != null) return `${money(obs.pricePerL)}/L`;
  if (obs.pricePerEach != null) return `${money(obs.pricePerEach)}/ea`;
  if (obs.unitPrice != null && obs.unitMeasure) return `${money(obs.unitPrice)}/${obs.unitMeasure.replace(/^1/, "").toLowerCase()}`;
  return obs.unitPriceRaw ? obs.unitPriceRaw.replace(/\s+/g, "") : "";
}

// Unit basis used by cheapest-by-subcategory rows ("kg", "ea", "l").
export function formatUnitBasis(price, basis) {
  return `${money(price)}/${basis === "l" ? "L" : basis}`;
}

export function pct(from, to) {
  if (!from || to == null) return null;
  return Math.round(((to - from) / from) * 100);
}

const AEST_OPTS = { timeZone: "Australia/Sydney" };
export function fmtDate(iso, { time = false } = {}) {
  if (!iso) return "—";
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-AU", { ...AEST_OPTS, day: "numeric", month: "short", year: "numeric" });
  if (!time) return date;
  const t = d.toLocaleTimeString("en-AU", { ...AEST_OPTS, hour: "numeric", minute: "2-digit" }).replace(" ", "");
  return `${date}, ${t} AEST`;
}
export function fmtDateShort(iso) {
  return new Date(iso).toLocaleDateString("en-AU", { ...AEST_OPTS, day: "numeric", month: "short" }).toUpperCase();
}
export function fmtUtc(iso) {
  return iso ? iso.replace("T", " ").replace(/:\d\dZ$/, " UTC") : "—";
}
