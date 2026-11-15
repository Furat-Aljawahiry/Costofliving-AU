# Meat, poultry & seafood crawler — ONE function, ONE trigger, BOTH retailers.
#
# The Fruit & Veg function (lambda_fruitveg.tf) pointed at a different shelf:
# same zip, same handler, same CSV columns, same proxy secret. Only the targets
# and the output prefixes differ, so a bad meat run cannot touch the fruit
# series and the drift check compares meat against meat:
#
#   reports/supermarkets/woolworths/meatAndPoultry/dt=.../<run_id>.csv + ...
#   reports/supermarkets/coles/meatAndPoultry/dt=.../<run_id>.csv      + ...
#
# The server picks these up with the rest of reports/supermarkets and files
# them by `source_category_id` (server/data/categories.js). What it does with
# them — the meat parser, the per-kg-only comparison, the 1.5x pack-size rule —
# is server/data/meat/ and docs/MEAT_DATA_TODO.md.
#
# Scheduled 30 minutes after Fruit & Veg so the two never hold proxy sessions
# at the same time, and so the two captures never start inside the server's
# 60-minute collapse window by accident (they are kept apart by category now,
# but there is no reason to test that every day).

locals {
  meat_write_prefixes = compact([
    var.meat_woolworths_output_prefix,
    var.meat_coles_output_prefix,
  ])
}

resource "aws_iam_role" "meat_category" {
  name = "${var.project_name}-meat-category"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "meat_category_basic" {
  role       = aws_iam_role.meat_category.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Drift history: trailing manifests under the crawl prefixes (shared policy,
# which now includes the meat prefixes — lambda_crawler_shared.tf).
resource "aws_iam_role_policy" "meat_category_read" {
  name   = "${var.project_name}-meat-category-read"
  role   = aws_iam_role.meat_category.id
  policy = data.aws_iam_policy_document.crawler_read_manifests.json
}

# Write scoped to exactly the two meat prefixes, never delete: raw runs are
# immutable. This role cannot write into the fruit series.
resource "aws_iam_role_policy" "meat_category_s3" {
  name = "${var.project_name}-meat-category-s3"
  role = aws_iam_role.meat_category.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:PutObject"]
      Resource = [for p in local.meat_write_prefixes : "${aws_s3_bucket.data.arn}/${p}/*"]
    }]
  })
}

resource "aws_iam_role_policy" "meat_category_secret" {
  count = var.meat_proxy_enabled ? 1 : 0

  name = "${var.project_name}-meat-category-secret"
  role = aws_iam_role.meat_category.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = data.aws_secretsmanager_secret.crawler_proxy_url.arn
    }]
  })
}

resource "aws_cloudwatch_log_group" "meat_category" {
  name              = "/aws/lambda/${var.project_name}-meat-category"
  retention_in_days = 30
}

resource "aws_lambda_function" "meat_category" {
  function_name = "${var.project_name}-meat-category"
  role          = aws_iam_role.meat_category.arn
  handler       = "index.handler"
  runtime       = "python3.13"

  filename         = data.archive_file.category_crawler.output_path
  source_code_hash = data.archive_file.category_crawler.output_base64sha256

  timeout     = var.meat_timeout
  memory_size = 512

  environment {
    variables = {
      RETAILERS     = join(",", var.meat_retailers)
      OUTPUT_BUCKET = aws_s3_bucket.data.id

      # Two CSVs, one per retailer. No union file.
      COMBINED_OUTPUT_PREFIX = ""

      WOOLWORTHS_OUTPUT_PREFIX = var.meat_woolworths_output_prefix
      WOOLWORTHS_CATEGORY_ID   = var.meat_woolworths_category_id
      WOOLWORTHS_CATEGORY_URL  = var.meat_woolworths_category_url
      WOOLWORTHS_CATEGORY_NAME = var.meat_woolworths_category_name
      WOOLWORTHS_POSTCODE      = var.woolworths_postcode
      # Same pinned store as Fruit & Veg: the discovery crawl was served by
      # 1101, and one store for both shelves keeps the two series comparable.
      WOOLWORTHS_EXPECTED_STORE_ID = var.woolworths_expected_store_id

      DRIFT_THRESHOLD_PCT = tostring(var.crawler_drift_threshold_pct)
      DRIFT_WINDOW        = tostring(var.crawler_drift_window)

      COLES_OUTPUT_PREFIX = var.meat_coles_output_prefix
      COLES_CATEGORY_ID   = var.meat_coles_category_id
      COLES_CATEGORY_URL  = var.meat_coles_category_url
      COLES_CATEGORY_NAME = var.meat_coles_category_name
      COLES_POSTCODE      = var.coles_postcode
      COLES_BUILD_ID      = var.coles_build_id

      PAGE_DELAY_MS = tostring(var.woolworths_page_delay_ms)

      PROXY_SECRET_ID       = var.meat_proxy_enabled ? data.aws_secretsmanager_secret.crawler_proxy_url.name : ""
      PROXY_COUNTRY         = var.crawler_proxy_country
      PROXY_SESSION_MINUTES = tostring(var.crawler_proxy_session_minutes)
      PROXY_REQUIRED        = var.meat_proxy_required ? "true" : "false"
      PROXY_PROBE           = var.crawler_proxy_probe ? "true" : "false"
    }
  }

  depends_on = [aws_cloudwatch_log_group.meat_category]
}

# --------------------------------------------------------------- schedule

resource "aws_cloudwatch_event_rule" "meat_category_daily" {
  name        = "${var.project_name}-meat-category-daily"
  description = "Twice-daily Meat, Poultry & Seafood crawl — Woolworths and Coles in one invocation, 30 min after Fruit & Veg"

  schedule_expression = "cron(30 6,18 * * ? *)"
  state               = var.meat_schedule_enabled ? "ENABLED" : "DISABLED"
}

resource "aws_cloudwatch_event_target" "meat_category_daily" {
  rule  = aws_cloudwatch_event_rule.meat_category_daily.name
  arn   = aws_lambda_function.meat_category.arn
  input = jsonencode({})
}

resource "aws_lambda_permission" "meat_category_events" {
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.meat_category.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.meat_category_daily.arn
}

# --------------------------------------------------------------- alarm

# Same meaning as the Fruit & Veg one: at least one retailer's half of today's
# meat capture is missing.
resource "aws_cloudwatch_metric_alarm" "meat_category_errors" {
  alarm_name          = "${var.project_name}-meat-category-errors"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  threshold           = 1
  period              = 86400
  statistic           = "Sum"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.meat_category.function_name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}
