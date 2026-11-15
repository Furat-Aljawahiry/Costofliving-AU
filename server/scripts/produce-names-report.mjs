// Prints every within-retailer item group the normaliser forms from the
// product CSVs in data/out, with each member's raw name and derived size
// label. Eyeball tool for tuning produceNames.js.
//   node server/scripts/produce-names-report.mjs [--singles] [--retailer coles]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseProduceName, sizeLabel } from '../data/produceNames.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIR = path.resolve(HERE, '..', '..', 'data', 'out')
const args = process.argv.slice(2)
const singles = args.includes('--singles')
const only = args.includes('--retailer') ? args[args.indexOf('--retailer') + 1] : null

function csv(text) {
  const rows = []; let row = [], f = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++ } else q = false } else f += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(f); f = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = '' }
    else f += c
  }
  if (f || row.length) { row.push(f); rows.push(row) }
  const h = rows[0]
  return rows.slice(1).filter(r => r.length > 1).map(r => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ''])))
}

const groups = new Map()
for (const f of fs.readdirSync(DIR)) {
  if (!/\.csv$/.test(f) || /cheapest/.test(f)) continue
  for (const r of csv(fs.readFileSync(path.join(DIR, f), 'utf8'))) {
    if (only && r.retailer !== only) continue
    const ctx = { brand: r.brand, soldBy: r.sold_by, packageSize: r.package_size_raw }
    const p = parseProduceName(r.product_name, ctx)
    const key = `${r.retailer}:${p.itemKey}:${r.is_organic}`
    const g = groups.get(key) || { retailer: r.retailer, key: p.itemKey, organic: r.is_organic === 'true', members: new Map() }
    g.members.set(r.retailer_sku, { raw: r.product_name, item: p.itemName, size: sizeLabel(p, ctx), rawSize: r.package_size_raw, unit: r.unit_price_raw, price: r.price_aud, fmt: p.packFormat, portion: p.portion, grade: p.sizeGrade })
    groups.set(key, g)
  }
}
const list = [...groups.values()].sort((a, b) => a.retailer.localeCompare(b.retailer) || a.key.localeCompare(b.key))
let multi = 0
for (const g of list) {
  if (g.members.size > 1) multi++
  if (g.members.size < 2 && !singles) continue
  console.log(`\n${g.retailer.toUpperCase()}  ${g.key}${g.organic ? '  [organic]' : ''}`)
  for (const m of g.members.values())
    console.log(`   ${m.item.padEnd(34)} ${m.size.padEnd(22)} ${(m.grade || '').padEnd(7)} $${m.price.padEnd(6)} ${m.unit.padEnd(14)} <- ${m.raw}  [${m.rawSize}]`)
}
console.log(`\n${list.length} items, ${multi} with more than one size, ${[...groups.values()].reduce((n, g) => n + g.members.size, 0)} SKUs`)
