// Historical price index, 2014 -> today, from the ABS Consumer Price Index.
//
// Nothing here is modelled. `data/abs/cpi_food.json` is written by
// `npm run fetch-abs` (server/scripts/fetch-abs.mjs) straight from the ABS
// Data API: the headline Food group plus the sub-groups that map to our six
// aisles, quarterly, re-based to 2014 = 100. ABS is the backstory; our own
// captures take over from 28 Aug 2026. Served via /api/history.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ABS_FILE = path.resolve(process.env.ABS_DIR || path.join(HERE, '..', '..', 'data', 'abs'), 'cpi_food.json')

let HISTORY
try {
  HISTORY = JSON.parse(fs.readFileSync(ABS_FILE, 'utf8'))
} catch (e) {
  HISTORY = null
  console.warn(`[history] no ABS snapshot at ${ABS_FILE} (${e.code || e.message}); run \`npm run fetch-abs\``)
}

// null when the snapshot is missing — the route answers 503, the UI a NotWired.
export function getHistory() {
  return HISTORY
}
