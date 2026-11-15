variable "aws_region" {
  description = "AWS region resources are deployed into"
  type        = string
  default     = "ap-southeast-2"
}

variable "project_name" {
  description = "Short name used to prefix/tag resources"
  type        = string
  default     = "costofliving-au"
}

variable "environment" {
  description = "Deployment environment name"
  type        = string
  default     = "dev"
}

# --------------------------------------------------------------- woolworths crawler

variable "woolworths_output_prefix" {
  description = "S3 key prefix for this crawl's reports. Each run writes dt=<UTC date>/<run_id>.csv beneath it — the run is a filename stem, not a directory, so a day lists its reports directly and runs still never collide."
  type        = string
  default     = "reports/supermarkets/woolworths/fruitAndVeg"
}

variable "woolworths_category_id" {
  description = "Browse category node id to crawl. Ids come from GET /apis/ui/PiesCategoriesWithSpecials. Default is Fruit & Veg."
  type        = string
  default     = "1-E5BEE36E"
}

variable "woolworths_category_url" {
  description = "Browse path for the category. Required by the API: omitting it returns 400 'Url is required.'"
  type        = string
  default     = "/shop/browse/fruit-veg"
}

variable "woolworths_category_name" {
  description = "Human-readable category name, sent in the API's formatObject param"
  type        = string
  default     = "Fruit & Veg"
}

variable "woolworths_postcode" {
  description = "Postcode the capture is scoped to. Woolworths prices vary by location, so this must stay pinned or the history gets an undetectable discontinuity (spec section 5). NOTE: this is a LABEL written into the output, not something the browse request sends — Woolworths resolves the store from the exit IP. See woolworths_expected_store_id."
  type        = string
  default     = "2000"
}

variable "woolworths_page_delay_ms" {
  description = "Delay between page requests. Keep polite; there is no need to crawl faster than this."
  type        = number
  default     = 700
}

variable "woolworths_schedule_enabled" {
  description = "Whether the daily EventBridge schedule is enabled. Defaults false so a deploy never starts crawling unattended."
  type        = bool
  default     = false
}

# --------------------------------------------------------------- coles crawler

# Same code, same schema, same zip as the Woolworths crawler — see
# lambda_coles.tf. Only the target and the destination prefix differ.

variable "woolworths_expected_store_id" {
  description = "FulfilmentStoreId the Woolworths series must be served from. The browse API carries no location, so the store is whatever Woolworths resolves from the exit IP; measured, store 1101 serves 472 Fruit & Veg products, 7008 serves 400 and 3221 serves 516. A run served by any other store trips the drift alarm. Empty disables the pin and falls back to the modal store of the trailing runs."
  type        = string
  default     = "1101"
}

variable "crawler_drift_threshold_pct" {
  description = "Drift alarm: a run whose total_reported moves more than this percentage from the median of the trailing complete runs is flagged (drift.py)."
  type        = number
  default     = 10
}

variable "crawler_drift_window" {
  description = "Drift alarm: how many trailing complete runs the median is taken over."
  type        = number
  default     = 7
}

variable "coles_output_prefix" {
  description = "S3 key prefix for the Coles crawl. Separate from the Woolworths prefix on purpose: identical columns, separate files, so a bad Coles run cannot contaminate the Woolworths series."
  type        = string
  default     = "reports/supermarkets/coles/fruitAndVeg"
}

variable "coles_category_id" {
  description = "Slug path of the browse node to crawl. Coles needs no node id — the browse path is the identifier — so this is recorded as source_category_id and nothing else."
  type        = string
  default     = "fruit-vegetables"
}

variable "coles_category_url" {
  description = "Browse path for the category, e.g. /browse/fruit-vegetables/vegetables/potatoes. Its segments become the ?slug= params the data route requires."
  type        = string
  default     = "/browse/fruit-vegetables"
}

variable "coles_category_name" {
  description = "Human-readable category name, recorded on every row as source_category_name"
  type        = string
  default     = "Fruit & Vegetables"
}

variable "coles_postcode" {
  description = "Postcode to stamp on Coles rows. Empty by default and it should stay empty: an anonymous request is served a DEFAULT store, not a located one (COLES_DISCOVERY.md section 5.5), and a wrong postcode is worse than an absent one. The store actually served is recorded from the payload."
  type        = string
  default     = ""
}

variable "coles_page_delay_ms" {
  description = "Pause between pages. 700ms matches the Woolworths crawler: 11 pages is well under a minute and stays a polite rate."
  type        = number
  default     = 700
}

variable "coles_build_id" {
  description = "Pin the Next.js buildId the data route needs, skipping the once-per-run HTML request that normally resolves it. Empty (recommended) resolves it per run. Set this only if the HTML surface starts returning interstitials while the data route still answers — see COLES_DISCOVERY.md section 5.3."
  type        = string
  default     = ""
}

variable "coles_schedule_enabled" {
  description = "Whether the daily EventBridge schedule is enabled. Defaults false: invoke by hand and read the manifest before letting Coles run unattended, because whether AWS egress is blocked has not been measured (COLES_DISCOVERY.md section 5.4)."
  type        = bool
  default     = false
}

variable "coles_proxy_enabled" {
  description = "Whether the Coles Lambda reads the shared proxy secret. False leaves the secret in place but crawls direct."
  type        = bool
  default     = true
}

variable "coles_proxy_required" {
  description = "Fail the run rather than silently crawling direct if no proxy is configured. Direct AWS egress is blocked by both retailers (data/DATA_SUPPLY_DECISION.md section 2), so a misconfigured secret should trip the error alarm, not go out on the AWS IP."
  type        = bool
  default     = true
}

# --------------------------------------------------------------- egress proxy

# Decodo (formerly Smartproxy) residential egress. Optional: with no proxy
# configured the crawler goes direct from the Lambda's own AWS address, exactly
# as it did before this was added.
#
# The credential itself is NOT a Terraform variable. It lives in the Secrets
# Manager secret below, is set out-of-band with the AWS CLI, and is read by the
# Lambda at cold start. Terraform manages the secret's existence and the IAM
# permission to read it, never its value — so no `apply` can clobber it, and it
# never lands in terraform.tfstate or a saved plan.
variable "woolworths_proxy_enabled" {
  description = "Whether the Lambda reads the proxy secret at all. False leaves the secret in place but crawls direct."
  type        = bool
  default     = true
}

variable "crawler_proxy_secret_name" {
  description = "Name of an EXISTING Secrets Manager secret holding http://user-<account>:<password>@gate.decodo.com:7000, shared by every retailer crawler. Terraform reads it, never writes it. Update the value with: aws secretsmanager put-secret-value --secret-id <this> --secret-string '<url>'"
  type        = string
  default     = "decodo_secrets"
}

variable "crawler_proxy_country" {
  description = "Exit country for the residential session. AU matters: both retailers scope prices and availability by location, so a non-AU exit would silently capture a different market."
  type        = string
  default     = "au"
}

variable "crawler_proxy_session_minutes" {
  description = "How long one sticky session holds its exit IP (1-1440). The crawl takes well under a minute; the headroom is for retries."
  type        = number
  default     = 30
}

variable "woolworths_proxy_required" {
  description = "Fail the run rather than silently crawling direct if no proxy is configured. Direct AWS egress is blocked by both retailers (data/DATA_SUPPLY_DECISION.md section 2), so a misconfigured secret should trip the error alarm, not go out on the AWS IP."
  type        = bool
  default     = true
}

variable "crawler_proxy_probe" {
  description = "Log the exit IP once per run (one extra request to ip.decodo.com). Cheap provenance: it also lands in the manifest's capture_context."
  type        = bool
  default     = true
}

# --------------------------------------------------------------- fruit & veg (both retailers)

# ONE function, ONE trigger, both retailers — see lambda_fruitveg.tf. It reuses
# every woolworths_* and coles_* target variable above; only the things that are
# specific to running the pair together live here.

variable "fruitveg_retailers" {
  description = "Retailers the combined Fruit & Veg function crawls, in crawl order. Each still writes to its own prefix; the list only decides who runs in one invocation."
  type        = list(string)
  default     = ["woolworths", "coles"]
}

variable "combined_output_prefix" {
  description = "S3 key prefix for an OPTIONAL union file: both retailers' rows in one CSV with the same header, written alongside (never instead of) the per-retailer files. Empty by default — the deliverable is two CSVs, one per retailer, and cross-retailer matching is a later decision that belongs to L2, not to collection. Set a prefix to start writing it."
  type        = string
  default     = ""
}

variable "fruitveg_timeout" {
  description = "Lambda timeout in seconds. Both crawls run sequentially in one invocation, so this is roughly double the single-retailer budget, with headroom for the retry backoff."
  type        = number
  default     = 600
}

variable "fruitveg_schedule_enabled" {
  description = "Whether the twice-daily EventBridge schedule is enabled. Enable THIS one rather than the two single-retailer schedules, or the same categories get crawled again on top of it."
  type        = bool
  default     = true
}

variable "fruitveg_proxy_enabled" {
  description = "Whether the combined function reads the shared proxy secret. False leaves the secret in place but crawls direct from the Lambda's own AWS address, which Woolworths is known to 403 (spec section 10.2a)."
  type        = bool
  default     = true
}

variable "fruitveg_proxy_required" {
  description = "Fail the run rather than silently crawling direct if no proxy is configured. Direct AWS egress is blocked by both retailers (data/DATA_SUPPLY_DECISION.md section 2), so a misconfigured secret should trip the error alarm, not go out on the AWS IP."
  type        = bool
  default     = true
}

# --------------------------------------------------------------- meat, poultry & seafood (both retailers)

# Same code and same shape as the Fruit & Veg function (lambda_meat.tf), its
# own prefixes. Targets verified by the 18 Oct discovery crawl
# (data/MEAT_DISCOVERY.md): Woolworths 606 products, Coles 572.

variable "meat_woolworths_output_prefix" {
  description = "S3 key prefix for Woolworths meat, poultry & seafood runs. The server maps the path segment to its category (server/data/categories.js)."
  type        = string
  default     = "reports/supermarkets/woolworths/meatAndPoultry"
}

variable "meat_coles_output_prefix" {
  description = "S3 key prefix for Coles meat & seafood runs."
  type        = string
  default     = "reports/supermarkets/coles/meatAndPoultry"
}

variable "meat_woolworths_category_id" {
  description = "Woolworths browse node id for Poultry, Meat & Seafood (from GET /apis/ui/PiesCategoriesWithSpecials)."
  type        = string
  default     = "1_D5A2236"
}

variable "meat_woolworths_category_url" {
  type    = string
  default = "/shop/browse/poultry-meat-seafood"
}

variable "meat_woolworths_category_name" {
  type    = string
  default = "Poultry, Meat & Seafood"
}

variable "meat_coles_category_id" {
  description = "Coles browse slug; the path is the identifier."
  type        = string
  default     = "meat-seafood"
}

variable "meat_coles_category_url" {
  type    = string
  default = "/browse/meat-seafood"
}

variable "meat_coles_category_name" {
  type    = string
  default = "Meat & Seafood"
}

variable "meat_retailers" {
  description = "Retailers the meat function crawls, in crawl order."
  type        = list(string)
  default     = ["woolworths", "coles"]
}

variable "meat_timeout" {
  description = "Lambda timeout in seconds. 17 Woolworths + 12 Coles pages, sequential, through the proxy — the same budget as Fruit & Veg."
  type        = number
  default     = 600
}

variable "meat_schedule_enabled" {
  description = "Whether the twice-daily meat schedule is enabled."
  type        = bool
  default     = true
}

variable "meat_proxy_enabled" {
  description = "Whether the meat function reads the shared proxy secret. Coles blocked the direct discovery crawl after one pass; leave this on."
  type        = bool
  default     = true
}

variable "meat_proxy_required" {
  description = "Fail rather than crawl direct from the AWS address when no proxy is configured."
  type        = bool
  default     = true
}

# --------------------------------------------------------------- alerting

variable "alert_email" {
  description = "Address every alarm in the stack emails (alerting.tf). Empty creates the topic with no subscription. The address must click AWS's confirmation email before anything is delivered."
  type        = string
  default     = ""
}

# --------------------------------------------------------------- snacks & confectionery (both retailers)

# Same code and same shape as the Meat function (lambda_snacks.tf), its own
# prefixes. Targets verified by the 22 Oct discovery crawl
# (data/SNACKS_DISCOVERY.md): Woolworths 2,751 listed (1,810 after marketplace
# sellers are skipped), Coles 1,710.

variable "snacks_woolworths_output_prefix" {
  description = "S3 key prefix for Woolworths snacks & confectionery runs. The server maps the path segment to its category (server/data/categories.js)."
  type        = string
  default     = "reports/supermarkets/woolworths/snacks"
}

variable "snacks_coles_output_prefix" {
  description = "S3 key prefix for Coles chips, chocolates & snacks runs."
  type        = string
  default     = "reports/supermarkets/coles/snacks"
}

variable "snacks_woolworths_category_id" {
  description = "Woolworths browse node id for Snacks & Confectionery (from GET /apis/ui/PiesCategoriesWithSpecials)."
  type        = string
  default     = "1_717445A"
}

variable "snacks_woolworths_category_url" {
  type    = string
  default = "/shop/browse/snacks-confectionery"
}

variable "snacks_woolworths_category_name" {
  type    = string
  default = "Snacks & Confectionery"
}

variable "snacks_coles_category_id" {
  description = "Coles browse slug; the path is the identifier. Top-level, and it holds Coles' biscuits and crackers too."
  type        = string
  default     = "chips-chocolates-snacks"
}

variable "snacks_coles_category_url" {
  type    = string
  default = "/browse/chips-chocolates-snacks"
}

variable "snacks_coles_category_name" {
  type    = string
  default = "Chips, Chocolates & Snacks"
}

variable "snacks_retailers" {
  description = "Retailers a hand-run invoke with no event crawls. The schedules pass one retailer each (lambda_snacks.tf)."
  type        = list(string)
  default     = ["woolworths", "coles"]
}

variable "snacks_timeout" {
  description = "Lambda timeout in seconds, for ONE retailer per scheduled invocation: 77 Woolworths or 37 Coles pages through the proxy. A hand-run invoke of both retailers needs the full 900."
  type        = number
  default     = 900
}

variable "snacks_schedule_enabled" {
  description = "Whether the twice-daily snack schedules are enabled."
  type        = bool
  default     = true
}

variable "snacks_proxy_enabled" {
  description = "Whether the snack function reads the shared proxy secret. Both retailers block direct AWS egress; leave this on."
  type        = bool
  default     = true
}

variable "snacks_proxy_required" {
  description = "Fail rather than crawl direct from the AWS address when no proxy is configured."
  type        = bool
  default     = true
}
