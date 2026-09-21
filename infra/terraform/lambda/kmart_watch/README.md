# Kmart + Big W pre-order watcher

Pushes to your phone, and emails, the moment a "30th anniversary" product
appears on kmart.com.au or bigw.com.au, or anything new lands in Kmart's toys
pre-order category. Deployed by `../../lambda_kmart_watch.tf` into the same AWS
account as the price crawlers, sharing their SNS alerts topic and -- for Big W
only -- their Decodo residential proxy.

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

## How it reads Big W

Measured 21 Sep 2026. Big W is Woolworths Group and its Akamai is tuned harder:

| request | from a laptop | from Lambda | via Decodo AU |
| --- | --- | --- | --- |
| `GET /` with curl | connection reset (TLS fingerprint) | -- | -- |
| `GET /` with Python | 200 once, then tarpitted after ~30 requests | -- | 200 |
| `GET /toys/c/674494` | 403 | -- | **403** |
| `GET /_next/data/.../c/674494.json` | 403 | -- | 403 |
| `POST api.bigw.com.au/search/v1/search` | **200** | **read timeout (tarpit)** | **200, ~3s** |

So the category pages are out even through a residential exit, but the site's
own search call is a separate host that answers a residential IP cleanly. It
was reverse-engineered from the `_app` chunk (`SearchService.search()` posts
`endpoints.search()` on the `apiBase` client):

```
POST https://api.bigw.com.au/search/v1/search
{"text": "30th anniversary", "page": 0, "perPage": 48, "sort": "newDesc",
 "filter": {"soldBy": ["BIG W"]}, "format": "1", "clientId": "web"}
```

**Marketplace sellers are excluded.** `soldBy: ["BIG W"]` is the site's own
"Sold By" facet, applied server-side; without it 266 of 273 "30th anniversary"
results were third-party sellers (The Nile, Gamerholic, KG Superstore...) and
Big W's own stock never made the newest-48 window. Behind that, every row is
also checked for `fulfilment.productChannel == "BIGW"`, so a marketplace row
can never reach an alert even if the filter stops being honoured. Note that
`information.vendors` is *not* the signal -- that is the supplier (Jazwares,
Scholastic), and Big W's own stock has one too. `BIGW_INCLUDE_MARKETPLACE=true`
turns both off.

`perPage` caps at 150; `sort` is one of `relevance|nameAsc|nameDesc|priceAsc|priceDesc|newDesc`.
`newDesc` puts the newest listing first, which is why 48 is enough -- a drop is
row one. Big W has no pre-order flag; sellers write `PREORDER` into the name,
so that is what is read. Product links are `https://www.bigw.com.au/p/<articleId>`.

Two sources: `bigw:30th anniversary` and `bigw:preorder` (every pre-order,
then filtered through the pattern). Rows are namespaced `bigw:<articleId>` in
the shared table so they can never collide with a Kmart id.

### Why Big W polls every 5 minutes, not every 1

Residential bytes are the one thing here with a marginal price: Decodo is
US$4/GB past the 3 GB plan, of which the crawlers use ~0.3 GB. Two Big W
searches at 48 results are ~90 KB gzipped on the wire:

| `kmart_watch_bigw_every_minutes` | residential egress |
| --- | --- |
| 5 (default) | ~0.76 GB/month -- inside the existing plan |
| 2 | ~1.9 GB/month -- still inside, tighter |
| 1 | ~3.8 GB/month -- ~US$5/month overage |

Kmart is direct and free, so it stays on every tick. One retailer failing
never blinds the other: a source that raises is logged and skipped, the
alerts that did come through go out, and *then* the tick raises so the Errors
alarm counts it.

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
python dry_run.py                 # hits both live feeds, prints what would alert
python index_test.py              # offline, no network
python push_test.py               # offline, no network
```

`dry_run.py` reaches Big W directly from your laptop -- a residential IP, so
that works. The Lambda cannot; it goes through the proxy, resolved the way the
crawler does it (`PROXY_SECRET_ID`, or `PROXY_URL` inline).

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
cat out.json                                       # expect "pushed": 0, "failed_sources": []

terraform apply                                    # schedule on, quiet
```

Seeding claims every current match silently. From then on you only hear about
new ones. It is idempotent, so re-running it costs nothing.

## Knobs

All in `../../lambda_kmart_watch.tf`, set them in `terraform.tfvars`:

| variable | default | |
| --- | --- | --- |
| `kmart_watch_pattern` | `30th\s*anniversary` | any case-insensitive regex |
| `kmart_watch_sources` | the four above | `browse:<group_id>` / `search:<query>` / `bigw:<query>` |
| `kmart_watch_interval_minutes` | `1` | EventBridge's floor; Kmart cadence |
| `kmart_watch_bigw_every_minutes` | `5` | Big W cadence, see the egress table above |
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
