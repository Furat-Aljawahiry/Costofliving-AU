# Kmart + Big W + Target + JB Hi-Fi pre-order watcher

Pushes to your phone, and emails, the moment a Pokemon 30th product (or any
"30th anniversary" / "30th celebration" / "mini tin" product) appears on
kmart.com.au, bigw.com.au, target.com.au or jbhifi.com.au -- as a pre-order or
as an ordinary listing -- or anything new lands in Kmart's toys pre-order
category. Deployed by `../../lambda_kmart_watch.tf` into the same AWS account
as the price crawlers, sharing their SNS alerts topic and -- for Big W only --
their Decodo residential proxy.

Four retailers, one function, one table, one alarm. The retailer is a prefix on
the source spec (`browse:`/`search:` Kmart, `bigw:` Big W, `target:`/
`target-browse:` Target, `jb:` JB Hi-Fi) and non-Kmart rows are namespaced
`bigw:<id>` / `target:<id>` / `jb:<id>` in the shared dedupe table so ids can
never collide.

| retailer | engine | egress | cadence | pre-order signal |
| --- | --- | --- | --- | --- |
| Kmart | Constructor.io | direct | every tick | `isPreOrderActive` |
| Target | Constructor.io | direct | every tick | none -- `availableonlineqty` |
| JB Hi-Fi | **Algolia** | direct | every tick | `button == "PreOrder"` |
| Big W | own search API | Decodo residential | every 5th tick | none -- PREORDER in name |

### What it matches, and the miss that shaped it

On 17 Sep 2026 Kmart listed six Pokemon TCG 30th products as pre-orders,
named **"30th Celebration"**, not "30th Anniversary", and filed outside the
toys pre-order category. The watcher, then matching `30th\s*anniversary` on
the pre-order category plus one relevance-sorted search, saw none of them. Two
more -- "Pokemon 30th Anniversary 20cm Pastel Plush" and "Pokemon 30th
Anniversary Battle Figure Pack" -- were live as *ordinary* listings but sat at
rows 101-105 of a 100-row page. Three things changed as a result:

- the default pattern is `30th\s*(anniversary|celebration)|pokemon.*(anniversary|celebration|30th|30\s*years?)`,
  matched against the accent-stripped title (Big W writes "Pokémon" on some rows);
- Kmart searches use the site's own "New" sort, so a fresh listing is row one
  no matter how many older matches exist;
- both retailers get a plain `pokemon` search as the safety net: whatever the
  range ends up being called, the pattern filters the newest 100 / 48 Pokemon
  products on the site.

Pre-order status is never a condition. `isPreOrderActive` (Kmart) and the word
PREORDER in the name (Big W) only decorate the alert and drive the second
alert on a state change -- listed -> pre-order, or pre-order -> general sale.

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

Four sources are polled, because a drop can land any of these ways:

- `browse:e35ed26c9b1dfb7fd311f93557216816` — Toys > Latest Arrivals (455 items). This **was** `/category/toys/pre-order/` (`615bf6db…`); Kmart deleted that category, and on 2 Oct 2026 the old id returned 0 results *without erroring* — the worst failure mode here, since it is indistinguishable from a quiet day. There is no pre-order shelf left anywhere in Kmart's tree.
- `search:30th anniversary` — site-wide, catches it outside that category
- `search:30th celebration` — the wording Kmart actually used for the Pokemon TCG range
- `search:pokemon` — the safety net; the pattern filters the newest 100

Searches carry `sort_by=numberOfDaysSinceStartDate&sort_order=ascending`,
which is the "New" option in the `sort_options` block of every response. On
the default relevance order the "30th anniversary" search ran to 105 rows and
the page is 100, so two live Pokemon 30th items were invisible.

Each item carries `isPreOrderActive`, which decorates the alert. A product that
was already listed and then flips to pre-order-active (or back) alerts a
*second* time.

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

Two sources: `bigw:30th anniversary` and `bigw:pokemon` (the newest 48 Pokemon
products Big W itself sells, filtered through the pattern). Big W search ANDs
its terms -- `pokemon 30th` returned 0 rows on 21 Sep 2026 -- so the safety
net has to be the single broad word. `bigw:preorder` used to be the second
source; with the own-stock filter it returns 0 rows, because only marketplace
sellers write PREORDER into a name, so it was dropped. Rows are namespaced
`bigw:<articleId>` in the shared table so they can never collide with a Kmart id.

### Why Big W polls every 5 minutes, not every 1

Residential bytes are the one thing here with a marginal price: Decodo is
US$4/GB past the 3 GB plan, of which the crawlers use ~0.3 GB. The two Big W
searches, own-stock only, measured 21 Sep 2026 gzipped on the wire: "30th
anniversary" 10 KB (7 rows), "pokemon" 62 KB (a full 48 rows), ~72 KB a poll:

| `kmart_watch_bigw_every_minutes` | residential egress |
| --- | --- |
| 5 (default) | ~0.62 GB/month -- inside the existing plan |
| 2 | ~1.6 GB/month -- still inside, tighter |
| 1 | ~3.1 GB/month -- ~US$2/month overage |

Kmart is direct and free, so it stays on every tick. One retailer failing
never blinds the other: a source that raises is logged and skipped, the
alerts that did come through go out, and *then* the tick raises so the Errors
alarm counts it.

## How it reads Target

Measured 1 Oct 2026. Target is the easy one, and the reason this grew a third
retailer instead of a second Lambda: target.com.au is Wesfarmers like Kmart and
runs the **same Constructor.io engine**, with its own key in its own homepage
HTML. A separate `target_watch` function would have duplicated ~600 lines of
Constructor, dedupe and push logic in order to change a key and a sort field.

| request | from a datacenter IP |
| --- | --- |
| `GET /` with curl | **200** -- no Akamai, no challenge |
| `GET /robots.txt` | 200; `Disallow: /checkout/`, `/my-account/`, `/search/*` |
| `GET ac.cnstrc.com/search/...?key=key_kWcX...` | **200, the actual products** |

So no proxy, no headless browser, and Target rides every tick for free exactly
like Kmart. Only two things differ from Kmart, and both differ silently:

- **the newest-first sort is `onlinedate` descending**, not
  `numberOfDaysSinceStartDate` ascending. Both are read off the `sort_options`
  block every Constructor response carries (Target calls it "Latest"). Get this
  wrong and nothing errors -- you just quietly get relevance order and miss the
  drop, which is the Kmart failure of 17 Sep 2026 all over again. It is pinned
  in `index_test.py`.
- **there is no pre-order flag anywhere on the index.** No `isPreOrderActive`,
  no `preview` that is ever true, nothing. See below.

Target's group tree is *not* browsable the way Kmart's is --
`browse/group_id/all` returns an empty `groups` array on this index -- so new
group ids are read off a product instead; see "Finding another group_id" below.

### availableonlineqty is the buy signal

Instead of a pre-order flag, every Target row carries real stock numbers:

| field | |
| --- | --- |
| `availableonlineqty` | online stock. **0 while a product is listed but not yet purchasable online** |
| `availablestoreqty` | in-store stock, informational |
| `onlinedate` | epoch seconds the listing went live |

Rows really do sit at 0 -- on 1 Oct 2026 both the Pokemon 30th Anniversary
Battle Figure Multipack (`oq 0`, `sq 809`) and a Journey Together blister were
listed-but-not-buyable. That 0 is in the push body and the email, because it is
the difference between "go buy it" and "watch this one".

`kmart_watch_target_stock_flip = true` turns a `0 -> >0` flip into a **second**
alert, which is the moment a drop actually becomes buyable. It is **off by
default** because an ordinary restock of a product you were already alerted
about looks identical and is noise -- but for a drop you are actively waiting
on, it is the most useful signal in here. Turn it on for that window.

### Sources, and why the browse group has its own switch

- `target-browse:W1852642` -- the "Pokemon Cards" group, 12 products on 1 Oct 2026
- `target:pokemon` -- site-wide, newest first, the safety net
- `target:30th anniversary`
- `target:mini tin` -- the range this was extended for

`ALERT_ALL_PREORDER` deliberately does **not** govern Target's browse;
`kmart_watch_target_alert_all_browse` does, and it defaults to `false`. Kmart's
browse source is a *pre-order shelf* that held 2 items, so reading it whole is
quiet and is the entire point. Target's `W1852642` is an *ordinary product
group* of sleeves, deck boxes and blisters -- reading it whole means an alert
every time Target reshuffles an id, which is how you learn to ignore the
notification. The pattern does the work instead.

Target searches are broad-match, not AND like Big W's: a `mini tin` search
returns "Anko Christmas Reindeer Tin Candle" and "Pour PalZ Mini Keyring Party
Pack". The regex is the thing that keeps them out, and `mini\s*tins?` does --
verified against the live feed, where the four selected rows are all genuine
30th anniversary products. `TARGET_PER_PAGE` is 30 rather than Kmart's 100
because Target rows carry ~40 fields each (~5 KB a row against Kmart's ~250
bytes) and newest-first sort puts a drop on row one anyway.

## How it reads JB Hi-Fi

Measured 2 Oct 2026. JB is Shopify served through Cloudflare Workers, answers a
datacenter IP, and is the only retailer here whose search is **Algolia** rather
than Constructor. The app id and public search key are hardcoded in the theme
bundle, so they are defaults in `index.py` and overridable by env when they
rotate:

```
POST https://VTVKM5URPX-dsn.algolia.net/1/indexes/shopify_products_families/query
{"query": "30th anniversary", "hitsPerPage": 100,
 "numericFilters": ["release_date > <epoch>"],
 "filters": "isMarketplace:false AND NOT button:DoNotDisplay
             AND NOT product_type:\"MUSIC\"",
 "attributesToRetrieve": [...], "attributesToHighlight": []}
```

To re-read the credentials after a rotation, pull any `bundle.*.js` off the
homepage and look for module 76099:

```bash
curl -s https://www.jbhifi.com.au/ \
  | grep -oE 'src="[^"]+bundle[^"]*\.js[^"]*"' | sed 's/^src="//;s/"$//;s|^//|https://|' \
  | while read -r u; do curl -s "$u"; done \
  | grep -ohE 'app_id:"[A-Z0-9]+",search_api_key:"[a-f0-9]+",[^}]*index_products:"[a-z_]+"'
```

JB's `robots.txt` disallows `/search` and `/*?q*`, so the site's own search is
off limits -- but Algolia is a different host, exactly as `ac.cnstrc.com` is for
Kmart and Target, and the `/products/<handle>` pages the alerts link to are
Allowed.

### Why this one needed its own filtering

Three measurements shaped it, and all three are load-bearing:

- **There is no date-sorted replica index.** Only `_price_asc` and
  `_price_desc` exist -- probed by name, since a wrong index name 404s. So the
  newest-first trick every other retailer here relies on is simply
  unavailable. Instead each query is narrowed by `release_date`, which *is*
  numeric, to a rolling 60-day window. That is also the semantically right
  filter for a drop: a pre-order's release date is in the future, so there is
  no forward bound.
- **The catalogue is 780,376 products and relevance is an OR match.** `30th
  anniversary` alone returns 2,704 hits, of which the first 550 genuinely match
  the pattern. Reading that would need `hitsPerPage: 1000` -- **7.5 MB** a
  request, every minute. `attributesToRetrieve` cuts a row from ~7.5 KB to
  ~365 bytes, so 100 rows is **36 KB**.
- **Most "30th anniversary" stock on JB is vinyl.** Of 33 recent pattern
  matches, **29 were `product_type` MUSIC** -- reissues, which JB sells
  constantly and labels "30th Anniversary Edition". Left in, this one source
  alerts more than the other three retailers combined, so MUSIC is excluded by
  default (`kmart_watch_jb_exclude_types`).

  Do **not** try to do that with `department`: Magic: The Gathering products
  are filed under department `"MOVIES"`. `product_type` is consistent.

`button` is JB's purchasability flag -- `Buy`, `PreOrder`, `DoNotDisplay`,
`None` -- read off the bundle's own `"Buy"===e.button||"PreOrder"===e.button`
check. It maps onto the same `preorder`/`listed` state the Kmart rows use, so a
JB listing that flips `Buy` <-> `PreOrder` earns the same second alert.
`DoNotDisplay` rows never reach an alert: you cannot buy them, and two of the
four non-music matches were exactly that. Marketplace sellers are excluded the
same way Big W's are, server-side **and** again in `parse_jb`, so a row cannot
reach an alert if Algolia ever stops honouring the filter.

With all of that on, the two JB sources selected 2 products on 2 Oct 2026.

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

### Making the tap open the Target app, not the browser

The link in the alert is **already** the right one -- there is nothing to
change in the Lambda, and no `targetau://`-style scheme to switch to. On both
platforms the modern deep-link mechanism *is* the `https://` URL, and Target
publishes both association files (checked 2 Oct 2026):

| file | declares | covers our link |
| --- | --- | --- |
| `/.well-known/assetlinks.json` | `com.lasoo.android.target` (+ `.dev`, `.qa`), `delegate_permission/common.handle_all_urls` | yes |
| `/.well-known/apple-app-site-association` | `T285U8BZ3P.com.targetaustralia.App`, paths incl. `/p/*` | yes |

Alerts link to `https://www.target.com.au/p/<slug>/<id>`, which is a `/p/*`
path. So when it opens the browser instead of the app, the missing piece is
**Android App Links verification**, which is a device setting:

> Settings -> Apps -> Target -> **Open by default** -> **Open supported links**

Set it to open in the app, and check the "supported web addresses" list
underneath has `target.com.au` / `www.target.com.au` enabled. Android 12+ fails
this *silently* and falls back to the browser when verification has not
completed -- which is the usual cause, and why nothing looks broken.

If that screen shows no supported addresses at all, verification never ran or
failed. From a machine with adb:

```bash
adb shell pm get-app-links com.lasoo.android.target          # see the state
adb shell pm verify-app-links --re-verify com.lasoo.android.target
```

The notification also carries an explicit **"Open in Target app"** button
(ntfy's `Actions` header, see `_actions` in push.py). Be aware of what that
does and does not do: ntfy fires it as an ordinary `ACTION_VIEW`, the same as
a tap on the notification body, so it does **not** bypass verification -- it
just gives you a labelled target and clears the notification when used. If
verification cannot be made to stick, the only reliable Android route left is
an ntfy `broadcast` action into Tasker or MacroDroid, which launches the app
itself; that is a phone-side automation, not a change in here.

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
| `kmart_watch_pattern` | `30th\s*(anniversary\|celebration)\|mini\s*tins?\|pokemon.*(anniversary\|celebration\|30th\|30\s*years?)` | any case-insensitive regex, matched on the accent-stripped title |
| `kmart_watch_sources` | the twelve above | `browse:` / `search:` / `bigw:` / `target:` / `target-browse:` / `jb:` |
| `kmart_watch_interval_minutes` | `1` | EventBridge's floor; Kmart cadence |
| `kmart_watch_bigw_every_minutes` | `5` | Big W cadence, see the egress table above |
| `kmart_watch_push_target` | `""` | `ntfy:` / `pushover:` / `telegram:`, above |
| `kmart_watch_push_max` | `5` | pushes per tick; the email always lists all |
| `kmart_watch_alert_all_preorder` | `true` | any new item in **Kmart's** browse source, not just matches |
| `kmart_watch_target_alert_all_browse` | `false` | the same for Target's browse group; off, see above |
| `kmart_watch_target_stock_flip` | `false` | re-alert when a Target row goes 0 -> in-stock online |
| `kmart_watch_jb_exclude_types` | `MUSIC` | JB `product_type`s to drop; **the vinyl filter**, see above |
| `kmart_watch_jb_release_window_days` | `60` | how far back a JB `release_date` still counts as news |
| `kmart_watch_jb_include_marketplace` | `false` | third-party JB sellers |
| `kmart_watch_enabled` | `true` | `false` keeps it deployed but never fired |

### Finding another group_id

Kmart's group tree is browsable, so walk it:

```bash
KEY=$(curl -s https://www.kmart.com.au/ | grep -o 'constructorApiKey":"key_[A-Za-z0-9]*' | cut -d'"' -f3)
curl -s "https://ac.cnstrc.com/browse/group_id/all?key=$KEY&num_results_per_page=1" \
  | python -c "import json,sys;
def w(g,d=0):
  print(' '*d, g['group_id'], g['display_name'], g['count']);
  [w(c,d+1) for c in g.get('children',[])]
[w(g) for g in json.load(sys.stdin)['response']['groups']]"
```

**Target's is not** -- `browse/group_id/all` returns an empty `groups` array on
its index. Read the ids off a product instead: every row carries
`data.group_ids`, and a search response carries the matching `groups` block
with display names. That is how `W1852642` ("Pokemon Cards") was found:

```bash
KEY=$(curl -s https://www.target.com.au/ | grep -o 'constructorApiKey":"key_[A-Za-z0-9]*' | cut -d'"' -f3)
curl -s "https://ac.cnstrc.com/search/pokemon?key=$KEY&num_results_per_page=30&sort_by=onlinedate&sort_order=descending" \
  | python -c "import json,sys; d=json.load(sys.stdin)['response'];
[print(g['group_id'], g.get('display_name'), g.get('count')) for g in d['groups'][0]['children']];
[print(i['value'][:60], i['data'].get('group_ids')) for i in d['results'][:10]]"
```

## What it deliberately does not do

It does not add anything to a cart and holds no credentials for any of the
four retailers. `/bag`, `/checkout` and `/login` are `Disallow`ed in Kmart's
robots.txt and `/checkout/` and `/my-account/` in Target's, and all of them sit
behind bot protection, so an automated buy would need a real logged-in browser
session carrying a stored card and would break on the first challenge — usually
at the worst possible moment, with no way to tell you it had. The alert links
straight to the product page; you tap and buy.

If you want the tap to be as short as possible, the leverage is on the phone,
not in this Lambda: be signed in to the retailer app with the card and address
already saved, and keep the ntfy notification's tap target (the product page)
one tap from "add to bag". That is seconds, it never silently fails, and it
does not put your card in an environment variable.
