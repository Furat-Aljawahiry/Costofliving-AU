# Snacks & confectionery crawler — ONE function, TWO schedules (one per retailer).
#
# Same zip, same handler, same CSV columns and proxy secret as Fruit & Veg and
# Meat (lambda_meat.tf). Only the targets and the output prefixes differ, so a
# bad snack run cannot touch another shelf's series and the drift check
# compares snacks with snacks:
#
#   reports/supermarkets/woolworths/snacks/dt=.../<run_id>.csv + ...
#   reports/supermarkets/coles/snacks/dt=.../<run_id>.csv      + ...
#
# One browse node per retailer, found by the 22 Oct discovery crawl
# (data/SNACKS_DISCOVERY.md): Woolworths' top-level "Snacks & Confectionery"
# (1_717445A, 2,751 listed, 77 pages) and Coles' top-level "Chips, Chocolates &
# Snacks" (1,710 listed, 37 pages). Coles' biscuits and crackers sit inside
# that node, not under Pantry, so one Coles target covers the same goods as
# the whole Woolworths shelf.
#
# Why two schedules rather than one invocation of both retailers, as meat does:
# 114 pages through the residential proxy is about four times the meat crawl,
# and run back to back it would sit near the 900 s Lambda ceiling. The event
# `{"retailer": "<name>"}` makes an invocation crawl that retailer alone; it
# still reads that retailer's WOOLWORTHS_* / COLES_* settings below, because the
# per-retailer names beat the bare ones (index.py `_setting`).
#
# Scheduled 30 minutes after meat, with the two retailers 20 minutes apart, so
# no two crawls hold proxy sessions at the same time.
#
# What the server does with the rows — the brand + line + flavour + form key,
# compared only for an identical pack — is server/data/snacks/ and
# docs/SNACKS_DATA_TODO.md. The category is hidden on the site until the match
# lists are reviewed (server/data/categories.js `public`).

locals {
  snacks_write_prefixes = compact([
    var.snacks_woolworths_output_prefix,
    var.snacks_coles_output_prefix,
  ])
  snacks_schedules = {
    woolworths = "cron(0 7,19 * * ? *)"
    coles      = "cron(20 7,19 * * ? *)"
  }
}

resource "aws_iam_role" "snacks_category" {
  name = "${var.project_name}-snacks-category"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "snacks_category_basic" {
  role       = aws_iam_role.snacks_category.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Drift history: trailing manifests under the crawl prefixes (shared policy,
# which includes the snack prefixes — lambda_crawler_shared.tf).
resource "aws_iam_role_policy" "snacks_category_read" {
  name   = "${var.project_name}-snacks-category-read"
  role   = aws_iam_role.snacks_category.id
  policy = data.aws_iam_policy_document.crawler_read_manifests.json
}

# Write scoped to exactly the two snack prefixes, never delete: raw runs are
# immutable. This role cannot write into the fruit or meat series.
resource "aws_iam_role_policy" "snacks_category_s3" {
  name = "${var.project_name}-snacks-category-s3"
  role = aws_iam_role.snacks_category.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:PutObject"]
      Resource = [for p in local.snacks_write_prefixes : "${aws_s3_bucket.data.arn}/${p}/*"]
    }]
  })
}

resource "aws_iam_role_policy" "snacks_category_secret" {
  count = var.snacks_proxy_enabled ? 1 : 0

  name = "${var.project_name}-snacks-category-secret"
  role = aws_iam_role.snacks_category.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = data.aws_secretsmanager_secret.crawler_proxy_url.arn
    }]
  })
}

resource "aws_cloudwatch_log_group" "snacks_category" {
  name              = "/aws/lambda/${var.project_name}-snacks-category"
  retention_in_days = 30
}

resource "aws_lambda_function" "snacks_category" {
  function_name = "${var.project_name}-snacks-category"
  role          = aws_iam_role.snacks_category.arn
  handler       = "index.handler"
  runtime       = "python3.13"

  filename         = data.archive_file.category_crawler.output_path
  source_code_hash = data.archive_file.category_crawler.output_base64sha256

  timeout     = var.snacks_timeout
  memory_size = 512

  environment {
    variables = {
      # The default for a hand-run invoke with no event; the schedules pass
      # one retailer each.
      RETAILERS     = join(",", var.snacks_retailers)
      OUTPUT_BUCKET = aws_s3_bucket.data.id

      # Two CSVs, one per retailer. No union file.
      COMBINED_OUTPUT_PREFIX = ""

      WOOLWORTHS_OUTPUT_PREFIX = var.snacks_woolworths_output_prefix
      WOOLWORTHS_CATEGORY_ID   = var.snacks_woolworths_category_id
      WOOLWORTHS_CATEGORY_URL  = var.snacks_woolworths_category_url
      WOOLWORTHS_CATEGORY_NAME = var.snacks_woolworths_category_name
      WOOLWORTHS_POSTCODE      = var.woolworths_postcode
      # Same pinned store as Fruit & Veg and Meat: the discovery crawl was
      # served by 1101, and one store for every shelf keeps the series
      # comparable.
      WOOLWORTHS_EXPECTED_STORE_ID = var.woolworths_expected_store_id

      DRIFT_THRESHOLD_PCT = tostring(var.crawler_drift_threshold_pct)
      DRIFT_WINDOW        = tostring(var.crawler_drift_window)

      COLES_OUTPUT_PREFIX = var.snacks_coles_output_prefix
      COLES_CATEGORY_ID   = var.snacks_coles_category_id
      COLES_CATEGORY_URL  = var.snacks_coles_category_url
      COLES_CATEGORY_NAME = var.snacks_coles_category_name
      COLES_POSTCODE      = var.coles_postcode
      COLES_BUILD_ID      = var.coles_build_id

      PAGE_DELAY_MS = tostring(var.woolworths_page_delay_ms)

      PROXY_SECRET_ID       = var.snacks_proxy_enabled ? data.aws_secretsmanager_secret.crawler_proxy_url.name : ""
      PROXY_COUNTRY         = var.crawler_proxy_country
      PROXY_SESSION_MINUTES = tostring(var.crawler_proxy_session_minutes)
      PROXY_REQUIRED        = var.snacks_proxy_required ? "true" : "false"
      PROXY_PROBE           = var.crawler_proxy_probe ? "true" : "false"
    }
  }

  depends_on = [aws_cloudwatch_log_group.snacks_category]
}

# --------------------------------------------------------------- schedules

resource "aws_cloudwatch_event_rule" "snacks_category_daily" {
  for_each = local.snacks_schedules

  name        = "${var.project_name}-snacks-${each.key}-daily"
  description = "Twice-daily Snacks & Confectionery crawl — ${each.key} only, after the meat crawl"

  schedule_expression = each.value
  state               = var.snacks_schedule_enabled ? "ENABLED" : "DISABLED"
}

resource "aws_cloudwatch_event_target" "snacks_category_daily" {
  for_each = local.snacks_schedules

  rule  = aws_cloudwatch_event_rule.snacks_category_daily[each.key].name
  arn   = aws_lambda_function.snacks_category.arn
  input = jsonencode({ retailer = each.key })
}

resource "aws_lambda_permission" "snacks_category_events" {
  for_each = local.snacks_schedules

  statement_id  = "AllowExecutionFromEventBridge-${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.snacks_category.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.snacks_category_daily[each.key].arn
}

# --------------------------------------------------------------- alarm

# Same meaning as the Fruit & Veg and Meat ones: at least one retailer's half
# of today's snack capture is missing.
resource "aws_cloudwatch_metric_alarm" "snacks_category_errors" {
  alarm_name          = "${var.project_name}-snacks-category-errors"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  threshold           = 1
  period              = 86400
  statistic           = "Sum"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.snacks_category.function_name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}
