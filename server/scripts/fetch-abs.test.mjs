// node --test server/  — pure functions of fetch-abs.mjs against a trimmed
// real ABS response (2 codes × 8 quarters, pulled 2026-09-17).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSdmx, rebase, yoy, buildHistory, buildUrl, CODES, AISLES } from './fetch-abs.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'abs_cpi_sample.json'), 'utf8'))

test('parseSdmx sorts periods and places every observation', () => {
  const { periods, raw } = parseSdmx(fixture)
  assert.deepEqual(periods, ['2014-Q1', '2014-Q2', '2014-Q3', '2014-Q4', '2015-Q1', '2015-Q2', '2015-Q3', '2015-Q4'])
  assert.deepEqual(Object.keys(raw).sort(), ['114120', '20001'])
  assert.equal(raw['20001'][0], 73.58)               // ABS Sep-2025-based value, as published
  assert.ok(raw['20001'].every((v) => v != null))
})

test('rebase makes the 2014 mean 100 and preserves ratios', () => {
  const { periods, raw } = parseSdmx(fixture)
  const v = raw['20001'], r = rebase(v, periods)
  const mean2014 = r.slice(0, 4).reduce((a, b) => a + b, 0) / 4
  assert.ok(Math.abs(mean2014 - 100) < 0.1)
  assert.ok(Math.abs(r[7] / r[0] - v[7] / v[0]) < 0.002)
  assert.throws(() => rebase(v.slice(0, 3), periods.slice(0, 3)), /expected 4 quarters/)
})

test('yoy is null for the first four quarters then v[i]/v[i-4]-1', () => {
  const y = yoy([100, 100, 100, 100, 102, 103.5, 99, 110])
  assert.deepEqual(y.slice(0, 4), [null, null, null, null])
  assert.deepEqual(y.slice(4), [2, 3.5, -1, 10])
})

test('buildHistory emits the API shape and refuses missing codes', () => {
  const parsed = parseSdmx(fixture)
  // The fixture only carries two codes; pretend the rest are there by copying.
  for (const c of Object.keys(CODES)) parsed.raw[c] ??= parsed.raw['20001']
  const h = buildHistory(parsed, { url: 'u', fetchedAt: 't' })
  assert.equal(h.source.firstPeriod, '2014-Q1')
  assert.equal(h.source.lastPeriod, '2015-Q4')
  assert.equal(h.periods.length, 8)
  assert.deepEqual(Object.keys(h.series).sort(), Object.keys(CODES).sort())
  assert.equal(h.series['114120'].parent, '20001')
  assert.equal(h.series['114120'].index.length, 8)
  assert.deepEqual(Object.keys(h.aisles).sort(), ['canned', 'chocolate', 'meat', 'snacks', 'staples', 'vegetables'])
  for (const a of Object.values(AISLES)) for (const c of a.lines) assert.ok(h.series[c], `aisle line ${c} served`)
  delete parsed.raw['40027']
  assert.throws(() => buildHistory(parsed, { url: 'u', fetchedAt: 't' }), /no series for code 40027/)
})

test('buildUrl targets CPI 2.0.0, index numbers, original, Australia, quarterly', () => {
  const u = buildUrl()
  assert.match(u, /^https:\/\/data\.api\.abs\.gov\.au\/rest\/data\/ABS,CPI,2\.0\.0\/1\.[\d+]+\.10\.50\.Q\?startPeriod=2014-Q1/)
})
