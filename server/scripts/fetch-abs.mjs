// Pull the ABS Consumer Price Index food series and write data/abs/cpi_food.json.
//
//   npm run fetch-abs
//
// Source: ABS Data API (SDMX-JSON, no key, CC BY 4.0), dataflow ABS,CPI,2.0.0.
// Key order is MEASURE.INDEX.TSEST.REGION.FREQ. We take index numbers (1),
// original series (10), Australia (50), quarterly (Q) from 2014-Q1 for the
// headline Food group and the sub-groups that map to our six aisles.
//
// ABS publishes the current dataflow re-based to Sep 2025 = 100; we re-base to
// 2014 = 100 (mean of the four 2014 quarters) so the chart reads as the design
// asks, and compute year-on-year change from the index ourselves — MEASURE 3
// (ABS's own % change) is not published for these codes via the API.
//
// Monthly (FREQ M) exists but sub-groups only run from 2017-09 and the headline
// Food series only from 2024-04, so quarterly is the backbone. ABS is the
// backstory here: it tells 2014 -> mid-2026, our own captures take over from
// 28 Aug 2026. Re-run this only if you want ABS's later quarters as well.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const OUT_FILE = path.resolve(process.env.ABS_DIR || path.join(HERE, '..', '..', 'data', 'abs'), 'cpi_food.json')

export const DATAFLOW = 'ABS,CPI,2.0.0'
export const START = '2014-Q1'
export const BASE_YEAR = '2014'

// ABS CL_CPI_INDEX codes we serve. `parent` is ABS's own hierarchy.
export const CODES = {
  '20001':  { label: 'Food and non-alcoholic beverages', parent: null },
  '114120': { label: 'Fruit and vegetables',             parent: '20001' },
  '30003':  { label: 'Meat and seafoods',                parent: '20001' },
  '30002':  { label: 'Bread and cereal products',        parent: '20001' },
  '30001':  { label: 'Dairy and related products',       parent: '20001' },
  '131179': { label: 'Food products n.e.c.',             parent: '20001' },
  '115501': { label: 'Snacks and confectionery',         parent: '131179' },
  '40001':  { label: 'Milk',                             parent: '30001' },
  '40005':  { label: 'Bread',                            parent: '30002' },
  '40027':  { label: 'Eggs',                             parent: '131179' },
  '40030':  { label: 'Coffee, tea and cocoa',            parent: '20001' },
}

// Which ABS line(s) each of the six aisles (client/src/lib/categories.js) shows,
// and how honest the match is. Rendered verbatim on the category page.
export const AISLES = {
  vegetables: { lines: ['114120'], match: 'exact',   note: 'ABS “Fruit and vegetables”.' },
  meat:       { lines: ['30003'],  match: 'exact',   note: 'ABS “Meat and seafoods” — the ABS group includes seafood.' },
  snacks:     { lines: ['115501'], match: 'shared',  note: 'ABS groups snacks and confectionery together, so this line is shared with Chocolate & candy.' },
  chocolate:  { lines: ['115501'], match: 'shared',  note: 'ABS groups snacks and confectionery together, so this line is shared with Snacks.' },
  canned:     { lines: ['131179'], match: 'nearest', note: 'Nearest ABS group: “Food products n.e.c.” — tinned and packaged goods sit in ABS’s not-elsewhere-classified group.' },
  staples:    { lines: ['40001', '40005', '40027', '40030'], match: 'components',
                note: 'ABS has no “staples” group; these are its Milk, Bread, Eggs and Coffee, tea and cocoa series.' },
}

export function buildUrl() {
  const key = `1.${Object.keys(CODES).join('+')}.10.50.Q`
  return `https://data.api.abs.gov.au/rest/data/${DATAFLOW}/${key}?startPeriod=${START}&dimensionAtObservation=AllDimensions`
}

// SDMX-JSON (flat, AllDimensions) -> { periods: [...sorted], raw: { code: [value|null,...] } }
export function parseSdmx(json) {
  const st = json.data.structures[0]
  const dims = st.dimensions.observation
  const iIdx = dims.findIndex((d) => d.id === 'INDEX')
  const iTime = dims.findIndex((d) => d.id === 'TIME_PERIOD')
  if (iIdx < 0 || iTime < 0) throw new Error('SDMX response missing INDEX or TIME_PERIOD dimension')
  const periods = dims[iTime].values.map((v) => v.id).sort()
  const pos = Object.fromEntries(periods.map((p, i) => [p, i]))
  const raw = {}
  for (const v of dims[iIdx].values) raw[v.id] = new Array(periods.length).fill(null)
  for (const [key, obs] of Object.entries(json.data.dataSets[0].observations)) {
    const parts = key.split(':').map(Number)
    const code = dims[iIdx].values[parts[iIdx]].id
    const period = dims[iTime].values[parts[iTime]].id
    raw[code][pos[period]] = obs[0] == null ? null : Number(obs[0])
  }
  return { periods, raw }
}

// Re-base so the mean of the base year's quarters is 100. Ratios are unchanged.
export function rebase(values, periods, baseYear = BASE_YEAR) {
  const base = values.filter((v, i) => v != null && periods[i].startsWith(baseYear + '-'))
  if (base.length !== 4) throw new Error(`expected 4 quarters in ${baseYear}, got ${base.length}`)
  const mean = base.reduce((a, b) => a + b, 0) / base.length
  return values.map((v) => (v == null ? null : round1((v / mean) * 100)))
}

// Year-on-year % change, quarterly series: v[i] vs v[i-4]. First four are null.
export function yoy(values) {
  return values.map((v, i) => (i < 4 || v == null || values[i - 4] == null ? null : round1((v / values[i - 4] - 1) * 100)))
}

const round1 = (x) => Math.round(x * 10) / 10

export function buildHistory(parsed, { url, fetchedAt }) {
  const { periods, raw } = parsed
  const series = {}
  for (const [code, meta] of Object.entries(CODES)) {
    const values = raw[code]
    if (!values) throw new Error(`ABS response has no series for code ${code} (${meta.label})`)
    const missing = values.filter((v) => v == null).length
    if (missing) throw new Error(`series ${code} (${meta.label}) has ${missing} empty quarters`)
    const index = rebase(values, periods)
    series[code] = { code, label: meta.label, parent: meta.parent, index, yoy: yoy(index) }
  }
  for (const [aisle, a] of Object.entries(AISLES)) {
    for (const c of a.lines) if (!series[c]) throw new Error(`aisle ${aisle} references unknown code ${c}`)
  }
  return {
    source: {
      name: 'ABS Consumer Price Index (6401.0)',
      dataflow: DATAFLOW,
      region: 'Australia (weighted average of eight capital cities)',
      frequency: 'Q',
      measure: 'Index numbers, original',
      base: `${BASE_YEAR} = 100 (re-based from ABS Sep 2025 = 100)`,
      licence: 'CC BY 4.0',
      url,
      fetchedAt,
      firstPeriod: periods[0],
      lastPeriod: periods[periods.length - 1],
    },
    periods,
    series,
    aisles: AISLES,
  }
}

async function main() {
  const url = buildUrl()
  console.log(`GET ${url}`)
  const res = await fetch(url, { headers: { Accept: 'application/vnd.sdmx.data+json' } })
  if (!res.ok) throw new Error(`ABS API ${res.status} ${res.statusText}`)
  const json = await res.json()
  const history = buildHistory(parseSdmx(json), { url, fetchedAt: new Date().toISOString() })
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true })
  fs.writeFileSync(OUT_FILE, JSON.stringify(history, null, 1) + '\n')
  const n = Object.keys(history.series).length
  console.log(`${n} series × ${history.periods.length} quarters, ${history.source.firstPeriod} → ${history.source.lastPeriod}`)
  console.log(`wrote ${OUT_FILE}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message || e); process.exit(1) })
}
