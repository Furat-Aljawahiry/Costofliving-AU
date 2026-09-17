# Woolworths category crawler Lambda.
#
# The code, the zip and the proxy secret are shared with every other retailer —
# see lambda_crawler_shared.tf. This file is only what is Woolworths-specific:
# its IAM role, its S3 prefix, its schedule and its alarm.
#
# Deliberately NOT in a VPC: default Lambda networking gives free public egress,
# whereas a VPC would need a NAT Gateway (~$35/mo) for zero benefit here.
# See data/LAMBDA_OUTPUT_SPEC.md section 10.2.

resource "aws_iam_role" "woolworths_category" {
  name = "${var.project_name}-woolworths-category"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "woolworths_category_basic" {
  role       = aws_iam_role.woolworths_category.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Write scoped to this dataset's prefix, and never delete: raw runs are
# immutable. Scoping per retailer also means a bug in one crawler cannot
# overwrite the other's archive. The only read is the manifests of the trailing
# runs, for the drift check (lambda_crawler_shared.tf).
resource "aws_iam_role_policy" "woolworths_category_read" {
  name   = "${var.project_name}-woolworths-category-read"
  role   = aws_iam_role.woolworths_category.id
  policy = data.aws_iam_policy_document.crawler_read_manifests.json
}

resource "aws_iam_role_policy" "woolworths_category_s3" {
  name = "${var.project_name}-woolworths-category-s3"
  role = aws_iam_role.woolworths_category.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:PutObject"]
      Resource = "${aws_s3_bucket.data.arn}/${var.woolworths_output_prefix}/*"
    }]
  })
}

resource "aws_iam_role_policy" "woolworths_category_secret" {
  count = var.woolworths_proxy_enabled ? 1 : 0

  name = "${var.project_name}-woolworths-category-secret"
  role = aws_iam_role.woolworths_category.id

  # No kms:Decrypt needed: with the AWS-managed aws/secretsmanager key the
  # service decrypts on the caller's behalf. A customer-managed CMK would
  # require an explicit grant here.
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = data.aws_secretsmanager_secret.crawler_proxy_url.arn
    }]
  })
}

resource "aws_cloudwatch_log_group" "woolworths_category" {
  name              = "/aws/lambda/${var.project_name}-woolworths-category"
  retention_in_days = 30
}

resource "aws_lambda_function" "woolworths_category" {
  function_name = "${var.project_name}-woolworths-category"
  role          = aws_iam_role.woolworths_category.arn
  handler       = "index.handler"
  runtime       = "python3.13"

  filename         = data.archive_file.category_crawler.output_path
  source_code_hash = data.archive_file.category_crawler.output_base64sha256

  # Fruit & Veg is 14 pages / ~20s wall clock direct. A residential exit adds
  # roughly 1-3s per page, so budget ~60s proxied; 300s still leaves headroom
  # for a larger category and for the retry backoff in crawler.py without ever
  # approaching the 900s ceiling.
  timeout     = 300
  memory_size = 512

  environment {
    variables = {
      RETAILER      = "woolworths"
      OUTPUT_BUCKET = aws_s3_bucket.data.id
      OUTPUT_PREFIX = var.woolworths_output_prefix
      CATEGORY_ID   = var.woolworths_category_id
      CATEGORY_URL  = var.woolworths_category_url
      CATEGORY_NAME = var.woolworths_category_name
      POSTCODE      = var.woolworths_postcode
      PAGE_DELAY_MS = tostring(var.woolworths_page_delay_ms)

      # The store this series must be served from (drift.py). The browse
      # request carries no location, so Woolworths picks a store from the
      # exit IP; any other store is a different range and trips the alarm.
      EXPECTED_STORE_ID   = var.woolworths_expected_store_id
      DRIFT_THRESHOLD_PCT = tostring(var.crawler_drift_threshold_pct)
      DRIFT_WINDOW        = tostring(var.crawler_drift_window)

      # Egress proxy (see proxy.py). Only the secret's NAME is here — the
      # credential is read from Secrets Manager at cold start, so this env var
      # is not sensitive. Empty name => direct egress.
      PROXY_SECRET_ID       = var.woolworths_proxy_enabled ? data.aws_secretsmanager_secret.crawler_proxy_url.name : ""
      PROXY_COUNTRY         = var.crawler_proxy_country
      PROXY_SESSION_MINUTES = tostring(var.crawler_proxy_session_minutes)
      PROXY_REQUIRED        = var.woolworths_proxy_required ? "true" : "false"
      PROXY_PROBE           = var.crawler_proxy_probe ? "true" : "false"
    }
  }

  depends_on = [aws_cloudwatch_log_group.woolworths_category]
}

# --------------------------------------------------------------- schedule

resource "aws_cloudwatch_event_rule" "woolworths_category_daily" {
  name        = "${var.project_name}-woolworths-category-daily"
  description = "Daily Woolworths category crawl"

  # 18:00 UTC = 04:00/05:00 Australia/Sydney (DST-dependent) — off-peak for the
  # retailer, and the run lands before anyone looks at the site in the morning.
  # Coles runs 30 minutes later (lambda_coles.tf): two crawlers firing into the
  # same minute is a burst pattern neither site's edge has any reason to like.
  schedule_expression = "cron(0 18 * * ? *)"
  state               = var.woolworths_schedule_enabled ? "ENABLED" : "DISABLED"
}

resource "aws_cloudwatch_event_target" "woolworths_category_daily" {
  rule = aws_cloudwatch_event_rule.woolworths_category_daily.name
  arn  = aws_lambda_function.woolworths_category.arn

  # Empty input: the function falls back to its env-var category defaults.
  # To crawl additional categories, add more targets with an `input` JSON of
  # {"category": "...", "url": "...", "name": "..."}.
  input = jsonencode({})
}

resource "aws_lambda_permission" "woolworths_category_events" {
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.woolworths_category.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.woolworths_category_daily.arn
}

# --------------------------------------------------------------- alarm

# The crawler throws on 0 rows, so any invocation error means the run produced
# nothing usable — exactly the silent-degradation failure DATA_SOURCING.md
# section 2.1 warns about. Alarm on it rather than discovering it in a chart.
resource "aws_cloudwatch_metric_alarm" "woolworths_category_errors" {
  alarm_name          = "${var.project_name}-woolworths-category-errors"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  threshold           = 1
  period              = 86400
  statistic           = "Sum"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.woolworths_category.function_name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}
