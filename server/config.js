// Where the data comes from, in one place.
//
// The bucket name, prefix and region used to be repeated in four files
// (observations.js, package.json's sync-data script, pull_latest_reports.py
// and .env.example). They are here now, and everything else asks.
//
// Two deliberate choices, both of them reactions to the same bug:
//
//  1. Everything is a FUNCTION, not a module-load constant. observations.js
//     used to read DATA_DIR at import time, which meant a test could not point
//     it at a fixture tree without re-importing the module. Reading env lazily
//     costs nothing and makes the seam testable.
//
//  2. DATA_BUCKET defaults to the real bucket, NOT to ''. It used to default
//     to empty, so a missing .env silently turned the S3 sync into a no-op and
//     the server served whatever stale files were on disk — which is exactly
//     how the site sat on 17 September data for eight days. Serving the
//     archive is the normal case; running without it is the exception and now
//     has to be asked for by name (DATA_SYNC=off).
const DEFAULT_BUCKET = 'costofliving-au-data-207208119513'
const DEFAULT_PREFIX = 'reports/supermarkets'
const DEFAULT_REGION = 'ap-southeast-2'

// A capture every 12 h, so 48 h is two missed runs — past the point where a
// hiccup explains it. P1.5 shows a banner on the same threshold.
const DEFAULT_STALE_AFTER_HOURS = 48

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.join(HERE, '..')

const env = (k, fallback) => {
  const v = process.env[k]
  return v == null || v === '' ? fallback : v
}

export function dataDir() {
  return path.resolve(env('DATA_DIR', path.join(REPO, 'data', 'out')))
}

export function archive() {
  return {
    bucket: env('DATA_BUCKET', DEFAULT_BUCKET),
    prefix: env('DATA_PREFIX', DEFAULT_PREFIX),
    region: env('AWS_REGION', DEFAULT_REGION),
    syncDir: path.join(dataDir(), 's3'),
  }
}

// `enabled`  — should we pull from S3 at all?
// `required` — if the pull fails at boot, is that fatal? Default yes: a server
//              that quietly serves week-old prices is worse than one that
//              refuses to start and tells you why. Opt out with DATA_SYNC=off,
//              which is the supported way to work offline.
export function syncPolicy() {
  const mode = env('DATA_SYNC', 'on').toLowerCase()
  const enabled = mode !== 'off' && Boolean(archive().bucket)
  return {
    enabled,
    required: enabled && env('DATA_SYNC_REQUIRED', 'true').toLowerCase() !== 'false',
    intervalMin: Number(env('SYNC_INTERVAL_MIN', enabled ? '60' : '0')),
    staleAfterHours: Number(env('STALE_AFTER_HOURS', String(DEFAULT_STALE_AFTER_HOURS))),
  }
}

// Which producer builds the in-memory index: the raw CSV walk we have today,
// or the published serving/ artifacts once the publish stage exists (Stage 2).
export function dataSource() {
  return env('DATA_SOURCE', 'raw').toLowerCase()
}

export const DEFAULTS = { bucket: DEFAULT_BUCKET, prefix: DEFAULT_PREFIX, region: DEFAULT_REGION }
