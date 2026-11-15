// The first tests observations.js has had. The fixtures under fixtures/out
// are real rows trimmed from the 16 Sep Woolworths capture, plus a synthetic
// second run of the same twelve products so the dedupe, the "newest row wins"
// rule and the collapse logic have something to disagree about.
//
// DATA_DIR is set before importing, because until config.js existed the path
// was frozen at module load and none of this was reachable.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
process.env.DATA_DIR = path.join(HERE, 'fixtures', 'out')
process.env.DATA_SYNC = 'off'          // never touch S3 from a test
process.env.STALE_AFTER_HOURS = '48'

const { parseCsv, collapseRuns, staleness, loadObservations } = await import('./observations.js')

// ---------------------------------------------------------------- parseCsv

test('parseCsv: quoted fields, commas and doubled quotes', () => {
  const rows = parseCsv('a,b,c\n1,"two, with comma","say ""hi"""\n')
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0], { a: '1', b: 'two, with comma', c: 'say "hi"' })
})

test('parseCsv: CRLF and a missing trailing newline', () => {
  const crlf = parseCsv('a,b\r\n1,2\r\n3,4')
  assert.deepEqual(crlf, [{ a: '1', b: '2' }, { a: '3', b: '4' }])
})

test('parseCsv: a short row pads, and a one-field row is dropped', () => {
  // The filter is r.length > 1, so a lone trailing field is not a row.
  const rows = parseCsv('a,b,c\n1,2\nx\n')
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0], { a: '1', b: '2', c: '' })
})

test('parseCsv: empty input is no rows, not a crash', () => {
  assert.deepEqual(parseCsv(''), [])
  assert.deepEqual(parseCsv('a,b,c\n'), [])
})

// ---------------------------------------------------------------- collapseRuns

const run = (retailer, runId, startedAt, status) => ({ retailer, runId, startedAt, status })

test('collapseRuns: two runs 13 s apart are one capture', () => {
  // The 4 Sep incident: two hand invocations seconds apart.
  const list = collapseRuns([
    run('woolworths', 'a', '2026-09-04T06:00:00Z', 'complete'),
    run('woolworths', 'b', '2026-09-04T06:00:13Z', 'complete'),
  ])
  const collapsed = list.filter(r => r.collapsedInto)
  assert.equal(collapsed.length, 1)
  assert.equal(collapsed[0].runId, 'a', 'the earlier one folds into the later')
  assert.equal(collapsed[0].collapsedInto, 'b')
})

test('collapseRuns: the scheduled 06:00 and 18:00 runs both count', () => {
  const list = collapseRuns([
    run('woolworths', 'a', '2026-09-16T06:00:37Z', 'complete'),
    run('woolworths', 'b', '2026-09-16T18:00:37Z', 'complete'),
  ])
  assert.equal(list.filter(r => r.collapsedInto).length, 0)
})

test('collapseRuns: complete beats partial regardless of order', () => {
  const list = collapseRuns([
    run('coles', 'good', '2026-09-04T06:00:00Z', 'complete'),
    run('coles', 'bad', '2026-09-04T06:00:13Z', 'partial'),
  ])
  const dropped = list.find(r => r.collapsedInto)
  assert.equal(dropped.runId, 'bad', 'the partial one is the one that goes')
  assert.equal(dropped.collapsedInto, 'good')
})

test('collapseRuns: retailers are collapsed independently', () => {
  const list = collapseRuns([
    run('woolworths', 'w', '2026-09-04T06:00:00Z', 'complete'),
    run('coles', 'c', '2026-09-04T06:00:05Z', 'complete'),
  ])
  assert.equal(list.filter(r => r.collapsedInto).length, 0)
})

// ---------------------------------------------------------------- staleness

test('staleness: fresh data is not stale', () => {
  const now = Date.parse('2026-09-25T00:00:00Z')
  const s = staleness('2026-09-24T18:00:00Z', now)
  assert.equal(s.stalenessHours, 6)
  assert.equal(s.stale, false)
})

test('staleness: past the threshold is stale', () => {
  const now = Date.parse('2026-09-25T00:00:00Z')
  // The real bug: 17 Sep data being served on 25 Sep.
  const s = staleness('2026-09-17T01:30:42Z', now)
  assert.ok(s.stalenessHours > 48)
  assert.equal(s.stale, true)
})

test('staleness: exactly at the threshold is not yet stale', () => {
  const now = Date.parse('2026-09-25T00:00:00Z')
  assert.equal(staleness('2026-09-23T00:00:00Z', now).stale, false)
})

test('staleness: no capture at all is stale, not null', () => {
  // An empty archive must not read as healthy.
  assert.deepEqual(staleness(null), { stalenessHours: null, stale: true })
  assert.deepEqual(staleness('not a date'), { stalenessHours: null, stale: true })
})

// ---------------------------------------------------------------- the index

test('loadObservations: builds an index from the fixture archive', () => {
  const idx = loadObservations({ force: true, sync: false })
  assert.equal(idx.summary.productCount, 12)
  assert.deepEqual(idx.summary.retailers, ['woolworths'])
  assert.equal(idx.files.products, 2)
  assert.equal(idx.files.manifests, 2)
})

test('loadObservations: two runs give every product two observations', () => {
  const idx = loadObservations({ force: true, sync: false })
  const p = idx.products.get('woolworths:101638')
  assert.equal(p.observations.length, 2)
  assert.ok(p.observations[0].capturedAt < p.observations[1].capturedAt, 'oldest first')
  assert.equal(p.latest.capturedAt, '2026-09-16T18:00:39Z')
  assert.equal(p.latest.price, 6.5)
  assert.equal(p.firstSeen, '2026-09-16T06:00:39Z')
})

test('loadObservations: descriptive fields follow the newest row', () => {
  const idx = loadObservations({ force: true, sync: false })
  // ww2.csv renamed this product; the later capture wins.
  assert.equal(idx.products.get('woolworths:101638').name, 'Woolworths Red Washed Potatoes Bag 2kg')
})

test('loadObservations: the same run read twice is one observation', () => {
  // seenObs guards against a run being mirrored into two folders.
  const idx = loadObservations({ force: true, sync: false })
  for (const p of idx.products.values()) {
    const runIds = p.observations.map(o => o.runId)
    assert.equal(new Set(runIds).size, runIds.length, `${p.sku} has a duplicated run`)
  }
})

test('loadObservations: staleness rides on the summary', () => {
  const idx = loadObservations({ force: true, sync: false })
  assert.equal(idx.summary.lastCapturedAt, '2026-09-16T18:01:30Z')
  // The fixture is deliberately ancient, so this must read as stale.
  assert.equal(idx.summary.stale, true)
  assert.ok(idx.summary.stalenessHours > 48)
})
