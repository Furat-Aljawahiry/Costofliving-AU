# Infrastructure — Terraform + AWS

This folder holds the Infrastructure-as-Code for Cost of Living AU. Today
the app has no AWS footprint at all (in-memory data, no DB, no cloud
compute). This is where that changes — starting with a Lambda that collects
real-time grocery prices on a schedule.

## Decisions made for this setup

- **Region:** `ap-southeast-2` (Sydney) — matches the project's AU focus.
- **State:** local `terraform.tfstate` file for now (not committed to git).
  Fine for a solo project; revisit a remote S3+DynamoDB backend later if
  you start collaborating or running `apply` from CI.
- **Auth:** Terraform uses whatever AWS credentials the AWS CLI/SDK finds
  (env vars, `~/.aws/credentials`, SSO). Nothing is hard-coded into `.tf`
  files.

## 1. Prerequisites

### Install Terraform

Terraform isn't installed yet in this environment. On Windows, the easiest
path is:

```powershell
winget install HashiCorp.Terraform
```

or via Chocolatey:

```powershell
choco install terraform
```

Verify:

```bash
terraform -version
```

### Fix/configure AWS credentials

`aws sts get-caller-identity` currently fails here with
`SignatureDoesNotMatch` — that means the AWS CLI has credentials configured
but they're wrong/corrupted (bad secret key, or a stale/rotated key pair).

To fix:

1. In the AWS Console, go to **IAM → Users → your user → Security
   credentials** and create a new access key (delete the old one once the
   new one works).
2. Run `aws configure` and paste in the new **Access Key ID** and **Secret
   Access Key**, region `ap-southeast-2`, output format `json`.
3. Verify:
   ```bash
   aws sts get-caller-identity
   ```
   You should get back your account ID and user ARN, not an error.

Terraform will reuse this same AWS CLI configuration automatically — no
separate credentials file needed for Terraform itself.

**IAM permissions:** for the Lambda work coming next, the IAM
user/role you use to run Terraform will need permissions to manage Lambda,
IAM roles/policies, EventBridge rules, CloudWatch Logs, and (depending on
where collected data ends up) DynamoDB or S3. `AdministratorAccess` is the
easy path for a personal/solo AWS account; a scoped-down policy is safer if
this account has other things in it.

## 2. What's in `infra/terraform/`

```
infra/terraform/
├─ versions.tf     # required Terraform + AWS provider versions
├─ providers.tf     # configures the aws provider (region, no hard-coded creds)
├─ variables.tf     # input variables (region, project/env name, tags)
├─ outputs.tf        # values printed after `apply` (currently just account/region)
└─ .gitignore        # keeps state files and .terraform/ out of git
```

This is intentionally the smallest possible starting point — a provider
block and nothing else. No AWS resources are created yet. Next step
(Lambda) will add a `lambda.tf` / `eventbridge.tf` alongside this.

## 3. First run

```bash
cd infra/terraform
terraform init      # downloads the AWS provider plugin
terraform plan       # should show "No changes" — nothing defined yet
```

If `plan` runs without an auth error, Terraform is correctly wired up to
your AWS account and you're ready to start adding real resources (the
Lambda).

## 4. Next: the collector Lambda

The plan is to move the price-collection logic (currently
`server/adapters/*.js` + `server/store.js`'s `collect()`, run in-process on
a 24h `setInterval`) into a Lambda triggered on a schedule by EventBridge,
so it runs independent of whether the Express server is even up.

Open questions to settle before writing that Terraform + Lambda code:

- **Where does collected data land?** The current app has no persistence —
  a Lambda needs somewhere durable to write to (DynamoDB table is the
  natural fit for `{itemId, storeId, price, collectedAt}` rows; S3 is an
  alternative for simpler/cheaper storage).
- **How does the API read it back?** `server/store.js` would need to read
  from that same store instead of (or in addition to) its in-memory cache.
- **Packaging:** Python Lambda (`python3.13`), zip-deployed via Terraform's
  `archive_file` data source straight from source — no build step, no
  `node_modules`/`site-packages` to vendor, because the function uses only the
  standard library plus the `boto3` the runtime already bundles.

This will be tackled in `infra/terraform/lambda.tf` next.

## 5. Egress proxy (Decodo / Smartproxy)

The Woolworths crawler can send every request through a Decodo residential
session instead of the Lambda's own AWS address. It is **off by default** —
with no proxy URL configured the crawler behaves exactly as it did before.

### How it is wired

- `lambda/category_crawler/proxy.py` — the whole layer, shared by every
  retailer crawler. `urllib` does HTTP
  `CONNECT` tunnelling natively, so the proxy hop is a `ProxyHandler` and an
  opener rather than anything hand-rolled. Standard library only.
- **One sticky session per run.** Decodo takes session parameters in the
  username — `user-<account>-country-au-session-<id>-sessionduration-30` — so
  all 14 pages of a category leave from a single AU residential IP. Fourteen
  different IPs paging one category in twenty seconds is a stranger signal than
  one shopper browsing.
- **Rotate only on a block.** A 403/429/5xx (or a proxy-level failure) burns the
  session and retries the page on a fresh exit IP, on the existing 1s/4s/9s
  backoff. A 407 short-circuits immediately: that is bad credentials or an
  unparseable username, and no other IP will fix it.
- **Provenance in the manifest.** `capture_context.egress`, `egress_country`,
  `exit_ip`, and `counts.proxy_rotations` are written into `_manifest.json`.
  Rotations creeping above zero on a normal night is the early warning that the
  endpoint has started fingerprinting us — well before it becomes a 0-row
  failure and an alarm.

### Where the credential lives

In **AWS Secrets Manager** — never in Terraform.

Terraform owns the secret's *existence* and the IAM permission to read it;
`lifecycle { ignore_changes = [secret_string] }` on the placeholder version
means the value you set is invisible to it. Consequences worth knowing:

- **No `apply` can clobber it.** Terraform manages the whole
  `environment.variables` map as one attribute, so a proxy password set by hand
  in the Lambda console would be wiped by the next unrelated apply — silently,
  with the crawler falling back to direct AWS egress. Keeping the value out of
  Terraform's model removes that failure entirely.
- **Nothing secret reaches `terraform.tfstate` or a saved plan.** Only the
  secret's *name* appears, which is not sensitive.
- The Lambda reads it once per **cold start** and caches it in module scope, so
  a daily schedule makes roughly one `GetSecretValue` call per day.
- **Cost:** $0.40/month for the secret, plus $0.05 per 10,000 calls — so about
  $4.80/year, which is more than the proxy bandwidth itself. Worth knowing, not
  worth worrying about.

`secrets_store.py` uses `boto3`, which the Python managed runtimes bundle and
document as bundled — so unlike the Node version there is no SigV4 to sign by
hand. It is deliberately **not** named `secrets.py`: Lambda puts the function
directory first on `sys.path`, so that name would shadow the standard library's
`secrets` module for every import in the process, boto3's included.

It accepts all three shapes a person might reasonably create in the console:

| Shape | Content |
|---|---|
| Plaintext | `http://user-acct:pw@gate.decodo.com:7000` |
| Key/value, one key | `PROXY_URL` = the full URL |
| Key/value, separate keys | `username`, `password`, `host`, `port` |

Prefer the third if your Decodo password contains `@ : / #` — those are legal in
the password but break URL parsing when pasted into the first two, and the
resulting error points nowhere near the real cause. Given separate fields the
credentials are percent-encoded during assembly, so any password works.

### Configure it

```bash
cd infra/terraform
terraform apply                     # creates the secret (placeholder value)

aws secretsmanager put-secret-value   --secret-id "costofliving-au/woolworths/proxy-url"   --secret-string "http://user-<account>:<password>@gate.decodo.com:7000"
```

No redeploy is needed after `put-secret-value` — the next cold start picks it up.

Once the proxy is the intended path, set `woolworths_proxy_required = true` so a
misconfiguration fails the run and trips the CloudWatch error alarm rather than
quietly falling back to the AWS IP. Note the asymmetry already built in: a
*missing* configuration can fall back to direct, but a secret that is configured
and cannot be *read* always throws.

### Verify before you deploy

Test the credentials locally first — the CLI shares the same proxy code path as
the Lambda, and prints the exit IP it actually got:

```bash
PROXY_URL="http://user-<account>:<password>@gate.decodo.com:7000" \
  python data/scripts/crawl_category.py --retailer woolworths --maxPages 1
```

The layer's own tests need neither an account nor a network — they run against a
fake CONNECT proxy on localhost (~15s, most of it real retry backoff):

```bash
python infra/terraform/lambda/category_crawler/proxy_test.py
python infra/terraform/lambda/category_crawler/cheapest_test.py
python infra/terraform/lambda/category_crawler/coles_test.py
python infra/terraform/lambda/category_crawler/handler_test.py   # needs network, both retailers
```

## 6. The Fruit & Veg crawler — one trigger, both retailers

`costofliving-au-fruitveg-category` (`lambda_fruitveg.tf`) is the function the
daily schedule should point at. **One invocation crawls every page of Woolworths
Fruit & Veg and every page of Coles Fruit & Vegetables**, back to back, and
writes **two CSVs — one per retailer** — under run prefixes that carry the
**same `run_id`**:

```
reports/supermarkets/woolworths/fruitAndVeg/dt=<UTC date>/
reports/supermarkets/coles/fruitAndVeg/dt=<UTC date>/
```

The run is a **filename stem, not a directory** — a day's prefix lists every
report captured that day side by side:

```
dt=2026-09-04/
  20260904050009-42af0dbc.csv
  20260904050009-42af0dbc.cheapest-by-subcategory.csv
  20260904050009-42af0dbc.manifest.json
  20260904050009-42af0dbc._SUCCESS      <- only on a complete run
```

The `run_id` leads with its UTC timestamp, so the listing sorts into capture
order and each run's time is legible in its own name. Same 67-column header at
both retailers, because both come out of the same `crawler.to_csv`.

Why one function rather than two scheduled functions:

- **One `run_id` per capture.** Two files written by one trigger are one
  capture. Matching them on timestamps that are minutes apart is guesswork.
- **Failure stays isolated.** A blocked Coles does not cost you the Woolworths
  data: each retailer is crawled, written and reported independently, and the
  invocation raises at the very end — after the good data is in S3, and still
  loudly enough to trip the error alarm. Read the manifests to see which half
  is missing.

Setting `combined_output_prefix` adds a third, optional file: both retailers'
rows in one CSV, same header, built from the same in-memory rows. It is empty by
default. Two files is the deliverable, and joining them is a later decision that
belongs to L2 — `canonical_product_key` is documented as the cross-retailer join
key but currently matches nothing between the two files.

The two single-retailer functions (`-woolworths-category`, `-coles-category`)
stay deployed and are still the right thing to invoke by hand when proving one
retailer in isolation. **Enable exactly one schedule**, or the same categories
get crawled more than once a day.

```bash
terraform output fruitveg_invoke_command   # run both, on demand
terraform apply -var 'fruitveg_schedule_enabled=true'
```

Because two retailers share one function, every target setting is namespaced —
`WOOLWORTHS_CATEGORY_ID`, `COLES_CATEGORY_URL`. `index.py` deliberately refuses
to apply a bare `CATEGORY_ID` to two retailers: a Woolworths node id means
nothing to Coles, whose identifier is the browse path. The bare names still
configure the single-retailer functions, where they are unambiguous.

Offline test for this layer, no network and no AWS:

```bash
python infra/terraform/lambda/category_crawler/batch_test.py
```

### Migrating an older archive

Runs written before this layout used a `run=<run_id>/` directory between the
date and the files. `data/scripts/flatten_run_prefixes.py` brings them across —
dry run by default, and it copies and size-verifies before deleting anything:

```bash
python data/scripts/flatten_run_prefixes.py            # show what would move
python data/scripts/flatten_run_prefixes.py --apply    # move it
```

It drives the AWS CLI, not boto3, so it needs no Python dependency beyond the
standard library. `_SUCCESS` is copied first and deleted last, so an interrupted
migration can leave a duplicated run but never a run whose `_SUCCESS` claims
data that is only half-moved. Re-running finishes an interrupted job.
