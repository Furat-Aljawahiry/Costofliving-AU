// Pull the S3 archive into data/out/s3 by hand.
//
// The same `aws s3 sync` the server runs at boot, exposed as `npm run
// sync-data` for when you want the mirror refreshed without starting the
// server. It imports config.js rather than repeating the bucket name, which
// package.json used to do — that copy drifted out of sight and was one of the
// four places the bucket was spelled.
import { spawnSync } from 'node:child_process'
import { archive, syncPolicy } from '../config.js'

const { enabled } = syncPolicy()
if (!enabled) {
  console.error('DATA_SYNC=off — nothing to sync. Unset it to pull the archive.')
  process.exit(1)
}

const { bucket, prefix, region, syncDir } = archive()
console.log(`s3://${bucket}/${prefix}  ->  ${syncDir}`)

const r = spawnSync('aws', [
  '--region', region, 's3', 'sync', `s3://${bucket}/${prefix}`, syncDir,
  '--exclude', '*', '--include', '*.csv', '--include', '*.json', '--delete',
], { stdio: 'inherit' })

if (r.error?.code === 'ENOENT') {
  console.error('\naws CLI not on PATH. Install it, or run the server with DATA_SYNC=off.')
  process.exit(1)
}
process.exit(r.status ?? 1)
