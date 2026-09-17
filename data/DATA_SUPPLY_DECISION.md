# Data-supply decision: how the crawler reaches the retailers

**Decided:** 2026-09-17. Supersedes the unwritten decision of 2026-08-28.
**Status:** in force. The scheduled `fruitveg` function crawls through a
residential proxy; this page says why, what it costs, where the line is, and
what we say when asked.

## 1. The decision

Both retailers are crawled from AWS Lambda **through one sticky Australian
residential exit per run** (Decodo residential, `country-au`, one session per
invocation). Direct egress from the Lambda's own AWS address is **not** a
working path and is not the chosen path.

This is recorded in every manifest the archive holds:
`capture_context.egress = "proxy"`, `egress_country = "au"`, `exit_ip` = the
address the run actually left from, `counts.proxy_rotations` = how many times
the run changed address mid-crawl (to date: always `0`).

## 2. The evidence

| Date | Origin | Woolworths `/apis/ui/browse/category` | Coles Next.js data route |
|---|---|---|---|
| 2026-08-28 | Lambda, direct AWS IP | **403** on page 1 (spec §10.2a) | not tried |
| 2026-08-28 → 2026-09-16 | Lambda via AU residential exit | 12 runs: 11 fetched all 14 pages (6 `complete`, 5 `partial` by 3–8 rows — a tile-count issue, roadmap P0.3, not a block); the first (Aug 28) stopped at 43 rows during setup. 0 rotations in all 12 | 11 of 11 runs `complete`, 0 rotations |
| 2026-08-29, 2026-09-04 | Laptop, home connection, no proxy | works | works |
| **2026-09-17** | **Lambda, direct AWS IP (probe, `maxPages=1`)** | **403 on page 1** | HTML served, then the JSON route returned a **non-JSON interstitial** — a block by a different mechanism |

Two corrections to what the repo said before this page existed:

- The roadmap and `infra/README.md` said the proxy was "not enabled" and the
  archive was "direct AWS egress". **Wrong.** Every run in S3 since the first
  has been proxied. The Secrets Manager secret was created at 07:26 UTC on
  Aug 28 and the first proxied run left at 07:54 UTC — 28 minutes after the
  403 was found. The decision was made then; it was never written down.
- The three local manifests that said `egress: direct, egress_country: aws`
  (run_ids `20260829065914`, `20260904041620`, `20260904041651`) are not in
  S3. They were `crawl_category.py` runs from a home connection;
  `crawler.py` labels *any* no-proxy run `"aws"`. They were never evidence
  that AWS egress works. (Follow-up: label those runs honestly — see §7.)

The 2026-09-17 probe was run against the two standalone, unscheduled
functions with `PROXY_SECRET_ID` blanked, then restored. It wrote nothing to
the archive: 0 rows, no CSV, no `_SUCCESS`, a `RuntimeError`, and the error
alarm tripped. The pipeline's loud-failure design worked as specified.

## 3. Why this is the decision and not "stop"

The alternative — crawl direct, accept the 403, and stop — was on the table
and is what `LAMBDA_OUTPUT_SPEC.md` §10.2a and `DATA_SOURCING.md` §2.2
originally said to do. It was not taken, for one reason: **the archive is the
product** (principle #4), and with direct egress the archive is empty. There
is no per-SKU history without a working origin, and no "days of history a
competitor cannot backfill" without one either.

That reasoning is honest only if the cost is stated plainly, so here it is:
**a residential exit is used because a datacenter exit is blocked.** Both
retailers' bot protection treats AWS ranges as bots and residential ranges as
shoppers, and this crawler presents as the latter. That is not consistent
with principle #6 as it was first written ("no IP rotation to defeat
blocks"). Rather than argue the words, the principle is amended (§4) to say
what we actually do and do not do.

## 4. Principle #6, amended

> **Stay on the right side of the line.** One Australian residential exit
> per run, presenting as one shopper browsing one category at a polite rate.
> No CAPTCHA solving. No scraping behind a login. No keyword search
> (`robots.txt` disallows it). No pool of exits paging one category in
> parallel. If a retailer blocks the residential exit too, that is the
> retailer saying no, and the answer is to **stop that retailer and pursue
> an agreement or the ACCC-recommended price API — not to rotate through
> more addresses.**

What "stop" means operationally: `proxy_rotations` above zero on a normal
night is the early warning; a run that cannot fetch page 1 through its
session fails loudly and writes nothing. A retailer that fails two scheduled
runs in a row is disabled in the schedule, not retried harder. See §7 for
the code change that makes the second sentence literally true.

## 5. What it costs

- Decodo residential, pay-as-you-go **US$4.00/GB**; smallest plan **3 GB for
  US$11.25/month + VAT**.
- One Fruit & Veg run moves roughly 3–5 MB (Coles JSON pages measured at
  44.9 KB each; Woolworths browse pages larger). Two runs a day is
  **~0.3 GB/month**, so the bill is the plan minimum, not the bandwidth:
  **about US$12/month.**
- Plus US$0.40/month for the Secrets Manager secret. Compute is cents.

If the crawl widens (more categories, more retailers, a postcode panel) the
bandwidth scales linearly and stays well inside the smallest plan until
roughly 30 categories a day.

## 5a. A consequence of the residential exit: the store moves

The Woolworths browse request carries no location; Woolworths resolves the
store from the exit IP. With a different residential exit each run, three
of the twelve archived Woolworths runs were served by a different store
(`total_reported` 403 and 400 instead of ~472; 516 on Sep 15 evening) — a
product set that is not the same series. The direct-AWS path would have had
the opposite problem (one fixed store nobody shops from). The fix in flight
is to pin the expected store (`woolworths_expected_store_id`, default 1101)
and alarm on drift, so a run served by another store is flagged, not
silently appended. Coles is unaffected: it is served a default store.

## 6. When a journalist asks

*"You're using residential proxies to get around the supermarkets' bot
protection. Isn't that exactly what you said you wouldn't do?"*

Yes — and we changed the wording rather than hide the practice. The site
fetches the same public, unauthenticated pages any shopper sees, once or
twice a day, one page at a time, from one Australian address per run. The
supermarkets block requests from cloud datacenters; we send ours from a
residential address instead. We do not solve CAPTCHAs, log in, search, or
spread a crawl across many addresses. Every published number carries the
address it was fetched from. If a retailer blocks that too, we stop and say
so publicly, and we would rather have the data under an agreement or through
the price-transparency API the ACCC's supermarkets inquiry recommended. Until one exists,
this is the least intrusive way to keep an independent price record, and we
think an independent record is worth having.

*"Is it legal?"* Crawling public pages at a polite rate is not itself unlawful
in Australia, but the retailers' terms of use are a separate question and no
lawyer has reviewed this project. That review is a precondition of public
launch (roadmap P1.9), not of writing this page.

## 7. What this decision changes in the repo

Done with this page:

- `ROADMAP.md`: principle #6 amended as above; §0.1 "403 wall" row and §0.3
  row 0.4 corrected; P0.5 marked done; `proxy.py` removed from §4 "things to
  delete".
- `infra/README.md` §5: "off by default" corrected — Terraform defaults every
  crawler to the proxy and the schedule runs on it.
- `infra/terraform/variables.tf`: `fruitveg_proxy_required` and the
  per-retailer `*_proxy_required` now default to **`true`**, so a
  misconfigured secret fails the run before any request goes out instead of
  quietly crawling direct — which we now know would fail anyway, but with a
  less useful error. Takes effect at the next `terraform apply`.

Follow-ups (not done here, each a small change):

1. **Rotate-on-block off.** `proxy.py` currently burns the session and retries
   a 403 on a fresh exit IP. That is the one behaviour the amended principle
   forbids. Change: 403 ends the run; 429 and 5xx retry on the *same*
   session with the existing backoff. `proxy_rotations` then stays as a
   field but should read 0 forever.
2. **Honest local labels.** `crawler.py` writes `egress_country: "aws"` for
   any no-proxy run, including laptop runs. Write `"unspecified"` unless the
   code is actually in Lambda (`AWS_LAMBDA_FUNCTION_NAME` set).
3. **Error alarms have no action.** `costofliving-au-coles-category-errors`
   went to ALARM during the probe with an empty `AlarmActions` list. P0.4's
   SNS → email wiring should cover these three alarms too.
4. **Methodology page (roadmap 1.4)** must carry §6 in its own words, and the
   data-quality page (1.3) already has `egress` and `exit_ip` from
   `/api/status` — show them.
