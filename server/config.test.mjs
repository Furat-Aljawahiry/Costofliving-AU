// config.js is small, but it is where the 17 September bug actually lived:
// DATA_BUCKET defaulted to '' and an absent .env silently disabled the sync.
// These tests pin the inverted default so it cannot quietly come back.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { archive, syncPolicy, dataDir, dataSource, DEFAULTS } from './config.js'

const KEYS = ['DATA_BUCKET', 'DATA_PREFIX', 'AWS_REGION', 'DATA_SYNC', 'DATA_SYNC_REQUIRED', 'SYNC_INTERVAL_MIN', 'STALE_AFTER_HOURS', 'DATA_DIR', 'DATA_SOURCE']
beforeEach(() => { for (const k of KEYS) delete process.env[k] })

test('an unset DATA_BUCKET means the real bucket, not nothing', () => {
  // The whole point. Before, this returned '' and sync became a no-op.
  assert.equal(archive().bucket, DEFAULTS.bucket)
  assert.equal(syncPolicy().enabled, true)
})

test('an empty DATA_BUCKET is treated as unset, not as "off"', () => {
  // A blank line in .env must not silently disable the archive.
  process.env.DATA_BUCKET = ''
  assert.equal(archive().bucket, DEFAULTS.bucket)
  assert.equal(syncPolicy().enabled, true)
})

test('DATA_SYNC=off is the one way to opt out', () => {
  process.env.DATA_SYNC = 'off'
  const p = syncPolicy()
  assert.equal(p.enabled, false)
  assert.equal(p.required, false, 'an opt-out must never be fatal at boot')
  assert.equal(p.intervalMin, 0, 'and must not leave a timer running')
})

test('DATA_SYNC=off is case-insensitive', () => {
  process.env.DATA_SYNC = 'OFF'
  assert.equal(syncPolicy().enabled, false)
})

test('a failed sync is fatal by default, and can be downgraded', () => {
  assert.equal(syncPolicy().required, true)
  process.env.DATA_SYNC_REQUIRED = 'false'
  assert.equal(syncPolicy().required, false)
})

test('env overrides win over the defaults', () => {
  process.env.DATA_BUCKET = 'other-bucket'
  process.env.DATA_PREFIX = 'reports/elsewhere'
  process.env.AWS_REGION = 'us-east-1'
  assert.deepEqual(
    (({ bucket, prefix, region }) => ({ bucket, prefix, region }))(archive()),
    { bucket: 'other-bucket', prefix: 'reports/elsewhere', region: 'us-east-1' },
  )
})

test('config is read lazily, so a test can move DATA_DIR', () => {
  // observations.js used to freeze this at import time, which is why it had
  // no tests at all.
  const before = dataDir()
  process.env.DATA_DIR = '/tmp/somewhere-else'
  assert.notEqual(dataDir(), before)
})

test('the sync mirror lives under the data dir', () => {
  assert.equal(archive().syncDir.startsWith(dataDir()), true)
})

test('defaults: hourly sync, 48 h staleness, raw source', () => {
  const p = syncPolicy()
  assert.equal(p.intervalMin, 60)
  assert.equal(p.staleAfterHours, 48)
  assert.equal(dataSource(), 'raw')
})
