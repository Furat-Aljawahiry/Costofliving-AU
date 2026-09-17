# Fruit & Veg crawler — ONE function, ONE trigger, BOTH retailers.
#
# This is the function the daily schedule should point at. A single invocation
# crawls every page of Woolworths Fruit & Veg and every page of Coles Fruit &
# Vegetables, back to back, and writes TWO CSVs — one per retailer:
#
#   <woolworths_output_prefix>/dt=.../<run_id>.csv  + .cheapest… + .manifest.json
#   <coles_output_prefix>/dt=.../<run_id>.csv       + .cheapest… + .manifest.json
#
# Both carry the SAME run_id, which is the point: two files from one trigger are
# one capture, not two that happened to land close together.
#
# The per-retailer prefixes are unchanged from lambda_woolworths.tf /
# lambda_coles.tf on purpose — a bad Coles run still cannot contaminate the
# Woolworths series.
#
# A third, UNION file (both retailers' rows in one CSV, same header) is written
# only if combined_output_prefix is set. It is empty by default: two files is
# the deliverable, and joining them is L2's decision to make later — see
# LAMBDA_OUTPUT_SPEC.md section 8.1, and note that canonical_product_key does
# not currently match anything across the two retailers.
#
# The two single-retailer functions stay deployed and are still the right thing
# to invoke by hand when proving one retailer in isolation. Only ONE schedule
# should be enabled at a time, or the same category gets crawled twice a day.
#
# Same zip and same handler as both of them (lambda_crawler_shared.tf); the
# retailer list is the env var RETAILERS. Because two retailers run in one
# function, every target setting is namespaced per retailer —
# WOOLWORTHS_CATEGORY_ID, COLES_CATEGORY_URL — since index.py deliberately
# refuses to apply a bare CATEGORY_ID to both. A Woolworths node id means
# nothing to Coles.

locals {
  # Empty combined prefix means "do not write the union file"; compact() keeps
  # it out of the IAM policy rather than granting s3:PutObject on "/*".
  fruitveg_write_prefixes = compact([
    var.woolworths_output_prefix,
    var.coles_output_prefix,
    var.combined_output_prefix,
  ])
}

resource "aws_iam_role" "fruitveg_category" {
  name = "${var.project_name}-fruitveg-category"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "fruitveg_category_basic" {
  role       = aws_iam_role.fruitveg_category.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Write scoped to exactly the three prefixes this function writes, and never
# delete: raw runs are immutable. The only read is the trailing manifests for
# the drift check (lambda_crawler_shared.tf).
resource "aws_iam_role_policy" "fruitveg_category_read" {
  name   = "${var.project_name}-fruitveg-category-read"
  role   = aws_iam_role.fruitveg_category.id
  policy = data.aws_iam_policy_document.crawler_read_manifests.json
}

resource "aws_iam_role_policy" "fruitveg_category_s3" {
  name = "${var.project_name}-fruitveg-category-s3"
  role = aws_iam_role.fruitveg_category.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:PutObject"]
      Resource = [for p in local.fruitveg_write_prefixes : "${aws_s3_bucket.data.arn}/${p}/*"]
    }]
  })
}

resource "aws_iam_role_policy" "fruitveg_category_secret" {
  count = var.fruitveg_proxy_enabled ? 1 : 0

  name = "${var.project_name}-fruitveg-category-secret"
  role = aws_iam_role.fruitveg_category.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = data.aws_secretsmanager_secret.crawler_proxy_url.arn
    }]
  })
}

resource "aws_cloudwatch_log_group" "fruitveg_category" {
  name              = "/aws/lambda/${var.project_name}-fruitveg-category"
  retention_in_days = 30
}

resource "aws_lambda_function" "fruitveg_category" {
  function_name = "${var.project_name}-fruitveg-category"
  role          = aws_iam_role.fruitveg_category.arn
  handler       = "index.handler"
  runtime       = "python3.13"

  filename         = data.archive_file.category_crawler.output_path
  source_code_hash = data.archive_file.category_crawler.output_base64sha256

  # Both crawls run sequentially in one invocation: Woolworths is 14 pages,
  # Coles is 11, roughly 20s each direct and ~60s each through a residential
  # exit. 600s is double the single-retailer budget so the pair, the 700ms
  # inter-page delay and crawler.py's retry backoff all fit with headroom, and
  # it is still well under the 900s ceiling.
  timeout     = var.fruitveg_timeout
  memory_size = 512

  environment {
    variables = {
      # The whole difference between this function and the two single-retailer
      # ones. Order is the crawl order.
      RETAILERS     = join(",", var.fruitveg_retailers)
      OUTPUT_BUCKET = aws_s3_bucket.data.id

      # Empty by default: two CSVs, one per retailer, and nothing else. Set
      # combined_output_prefix to also write their union; the per-retailer
      # files are unaffected either way.
      COMBINED_OUTPUT_PREFIX = var.combined_output_prefix

      # Namespaced per retailer — index.py will not apply a bare CATEGORY_ID to
      # two retailers, which is what stops a Woolworths node id reaching Coles.
      WOOLWORTHS_OUTPUT_PREFIX = var.woolworths_output_prefix
      WOOLWORTHS_CATEGORY_ID   = var.woolworths_category_id
      WOOLWORTHS_CATEGORY_URL  = var.woolworths_category_url
      WOOLWORTHS_CATEGORY_NAME = var.woolworths_category_name
      WOOLWORTHS_POSTCODE      = var.woolworths_postcode
      # See lambda_woolworths.tf: the store this series must be served from.
      WOOLWORTHS_EXPECTED_STORE_ID = var.woolworths_expected_store_id

      DRIFT_THRESHOLD_PCT = tostring(var.crawler_drift_threshold_pct)
      DRIFT_WINDOW        = tostring(var.crawler_drift_window)

      COLES_OUTPUT_PREFIX = var.coles_output_prefix
      COLES_CATEGORY_ID   = var.coles_category_id
      COLES_CATEGORY_URL  = var.coles_category_url
      COLES_CATEGORY_NAME = var.coles_category_name
      # Empty on purpose. An anonymous Coles request is served a default store
      # rather than a located one (COLES_DISCOVERY.md section 5.5), so there is
      # no honest postcode to claim — the store id it WAS served is recorded on
      # every row and in the manifest instead.
      COLES_POSTCODE = var.coles_postcode

      # Escape hatch for COLES_DISCOVERY.md section 5.3: the buildId can only be
      # read from an HTML page, and HTML is the surface the edge blocks first.
      # Empty (the default) means resolve it per run.
      COLES_BUILD_ID = var.coles_build_id

      # One politeness delay for both — it describes how fast we are willing to
      # crawl anyone, not anything retailer-specific.
      PAGE_DELAY_MS = tostring(var.woolworths_page_delay_ms)

      PROXY_SECRET_ID       = var.fruitveg_proxy_enabled ? data.aws_secretsmanager_secret.crawler_proxy_url.name : ""
      PROXY_COUNTRY         = var.crawler_proxy_country
      PROXY_SESSION_MINUTES = tostring(var.crawler_proxy_session_minutes)
      PROXY_REQUIRED        = var.fruitveg_proxy_required ? "true" : "false"
      PROXY_PROBE           = var.crawler_proxy_probe ? "true" : "false"
    }
  }

  depends_on = [aws_cloudwatch_log_group.fruitveg_category]
}

# --------------------------------------------------------------- schedule

resource "aws_cloudwatch_event_rule" "fruitveg_category_daily" {
  name        = "${var.project_name}-fruitveg-category-daily"
  description = "Twice-daily Fruit & Veg crawl — Woolworths and Coles in one invocation"

  # Twice a day. 18:00 UTC = 04:00/05:00 Australia/Sydney (DST-dependent) —
  # off-peak for both retailers, and the run lands before anyone looks at the
  # site in the morning. 06:00 UTC = 16:00/17:00 Sydney — catches the specials
  # and markdowns that change through the day, so a "was/now" claim can be
  # checked against a morning AND an afternoon observation.
  # No staggering needed: the two crawls are sequential inside one invocation.
  schedule_expression = "cron(0 6,18 * * ? *)"
  state               = var.fruitveg_schedule_enabled ? "ENABLED" : "DISABLED"
}

resource "aws_cloudwatch_event_target" "fruitveg_category_daily" {
  rule = aws_cloudwatch_event_rule.fruitveg_category_daily.name
  arn  = aws_lambda_function.fruitveg_category.arn

  # Empty input: the function falls back to its env-var targets and crawls every
  # page of each. maxPages exists for hand invocations only — a scheduled run
  # that stops early would write a 'partial' file every day.
  input = jsonencode({})
}

resource "aws_lambda_permission" "fruitveg_category_events" {
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.fruitveg_category.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.fruitveg_category_daily.arn
}

# --------------------------------------------------------------- alarm

# The function raises if EITHER retailer produced nothing usable — after writing
# whatever the other one did produce. So an invocation error means "at least one
# half of today's capture is missing", which is exactly the silent-degradation
# failure DATA_SOURCING.md section 2.1 warns about. Read the manifests to see
# which half.
resource "aws_cloudwatch_metric_alarm" "fruitveg_category_errors" {
  alarm_name          = "${var.project_name}-fruitveg-category-errors"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  threshold           = 1
  period              = 86400
  statistic           = "Sum"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.fruitveg_category.function_name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}
