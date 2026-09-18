# Kmart pre-order watcher

Emails you the moment a "30th anniversary" product appears on kmart.com.au, or
anything new lands in the toys pre-order category. Deployed by
`../../lambda_kmart_watch.tf` into the same AWS account as the price crawlers,
sharing only their SNS alerts topic.

## How it reads Kmart

Measured 18 Sep 2026, from a datacenter IP with plain curl:

| request | result |
| --- | --- |
| `GET /category/toys/pre-order/` | **403** `AkamaiGHost` |
| `GET /` | 200 |
| `GET /_next/data/<buildId>/category/toys/pre-order.json` | 200, but `productResults: null` |
| `GET ac.cnstrc.com/browse/group_id/<id>?key=…` | **200, the actual products** |

The category page is client-rendered: the grid comes from Constructor.io, whose
key ships in the homepage HTML (`constructorApiKey`). `ac.cnstrc.com` is a
different host, unauthenticated, and not behind the bot wall — so this watcher
needs no residential proxy and no headless browser, unlike `../category_crawler`.

Two sources are polled, because a drop can land either way:

- `browse:615bf6db4dee158ccbbc1ed5aef1ced9` — `/category/toys/pre-order/`
- `search:30th anniversary` — site-wide, catches it outside that category

Each item carries `isPreOrderActive`, which is the buy signal. A product that
was already listed and then flips to pre-order-active alerts a *second* time.

## Getting the message on your phone

Email is the backstop; it arrives when your mail client next syncs, which for a
drop is too late. So the function pushes to a handset first, with the product
link as the notification's tap target, then sends the email anyway.

Pick one and prove it before you deploy — `test_push.py` sends a single fake
hit and needs no AWS:

```bash
python test_push.py ntfy:kmart-<something-long-and-random>
python test_push.py pushover:<user_key>:<app_token>
python test_push.py telegram:<bot_token>:<chat_id>
```

**ntfy** is the one to start with: install the app, subscribe to a topic, done —
no account, no cost. The topic name is the only secret, so make it unguessable;
anyone who knows it can read your alerts and send you fake ones. **Pushover**
($5 once) is the most reliable of the three if this matters enough to pay for.

Then put the working target in `../../terraform.tfvars` (gitignored as
`*.tfvars`, so a Pushover or Telegram token stays out of the repo):

```hcl
kmart_watch_push_target = "ntfy:kmart-<something-long-and-random>"
```

Leave it unset and you get email only. A push failure is logged and swallowed —
it can never cost you the email or fail the tick.

## Before deploying

```bash
python dry_run.py                 # hits the live feed, prints what would alert
python index_test.py              # offline, no network
python push_test.py               # offline, no network
```

`dry_run.py` writes nothing and needs no credentials. Run it whenever the alerts
go quiet for longer than feels right — if Kmart reshapes the feed, this is where
you see it first.

## Deploy

**Seed before the schedule starts, not after.** The apply creates the rule
already ENABLED, and at a 1-minute tick it fires within seconds — well before
you can get a seed invoke in. That happened on the first deploy, 18 Sep 2026:
the 08:38:11 tick pushed 5 notifications and emailed all 15 anniversary products
already on sale, 38 seconds before the seed ran. So deploy dark:

```bash
cd ../..                          # infra/terraform
terraform apply -var kmart_watch_enabled=false     # function up, schedule off

aws lambda invoke --function-name costofliving-au-kmart-watch \
  --payload '{"seed": true}' --cli-binary-format raw-in-base64-out out.json
cat out.json                                       # expect "new": 15, "pushed": 0

terraform apply                                    # schedule on, quiet
```

Seeding claims every current match silently. From then on you only hear about
new ones. It is idempotent, so re-running it costs nothing.

## Knobs

All in `../../lambda_kmart_watch.tf`, set them in `terraform.tfvars`:

| variable | default | |
| --- | --- | --- |
| `kmart_watch_pattern` | `30th\s*anniversary` | any case-insensitive regex |
| `kmart_watch_sources` | the two above | `browse:<group_id>` / `search:<query>` |
| `kmart_watch_interval_minutes` | `1` | EventBridge's floor |
| `kmart_watch_push_target` | `""` | `ntfy:` / `pushover:` / `telegram:`, above |
| `kmart_watch_push_max` | `5` | pushes per tick; the email always lists all |
| `kmart_watch_alert_all_preorder` | `true` | any new pre-order item, not just matches |
| `kmart_watch_enabled` | `true` | `false` keeps it deployed but never fired |

### Finding another group_id

```bash
KEY=$(curl -s https://www.kmart.com.au/ | grep -o 'constructorApiKey":"key_[A-Za-z0-9]*' | cut -d'"' -f3)
curl -s "https://ac.cnstrc.com/browse/group_id/all?key=$KEY&num_results_per_page=1" \
  | python -c "import json,sys;
def w(g,d=0):
  print(' '*d, g['group_id'], g['display_name'], g['count']);
  [w(c,d+1) for c in g.get('children',[])]
[w(g) for g in json.load(sys.stdin)['response']['groups']]"
```

## What it deliberately does not do

It does not add anything to a cart and holds no Kmart credentials. `/bag`,
`/checkout` and `/login` are all `Disallow`ed in robots.txt and sit behind the
same Akamai bot wall that 403s the category pages, so an automated buy would
need a real logged-in browser session and would break on the first challenge —
usually at the worst moment. The alert links straight to the product page; you
tap and buy.
