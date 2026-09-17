# Coles category crawler Lambda.
#
# Same zip, same handler, same schema as the Woolworths function — the retailer
# is chosen by the RETAILER env var (see lambda_crawler_shared.tf). What differs
# is deliberately only what must: its own IAM role, its own S3 prefix, its own
# schedule and its own alarm.
#
# The prefixes are separate ON PURPOSE while Coles is being proven: identical
# columns, separate files, so a bad Coles run cannot contaminate the Woolworths
# series. Merging the two into one partitioned dataset is a later decision, and
# it is a decision about consumers, not about collection.
#
# Before enabling the schedule, read data/COLES_DISCOVERY.md section 5.4: the
# Woolworths crawler is deployed and 403s from AWS egress, and whether Coles
# does the same has NOT been measured. Invoke this by hand first and read the
# manifest before trusting anything it writes.

resource "aws_iam_role" "coles_category" {
  name = "${var.project_name}-coles-category"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "coles_category_basic" {
  role       = aws_iam_role.coles_category.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "coles_category_read" {
  name   = "${var.project_name}-coles-category-read"
  role   = aws_iam_role.coles_category.id
  policy = data.aws_iam_policy_document.crawler_read_manifests.json
}

resource "aws_iam_role_policy" "coles_category_s3" {
  name = "${var.project_name}-coles-category-s3"
  role = aws_iam_role.coles_category.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:PutObject"]
      Resource = "${aws_s3_bucket.data.arn}/${var.coles_output_prefix}/*"
    }]
  })
}

resource "aws_iam_role_policy" "coles_category_secret" {
  count = var.coles_proxy_enabled ? 1 : 0

  name = "${var.project_name}-coles-category-secret"
  role = aws_iam_role.coles_category.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = data.aws_secretsmanager_secret.crawler_proxy_url.arn
    }]
  })
}

resource "aws_cloudwatch_log_group" "coles_category" {
  name              = "/aws/lambda/${var.project_name}-coles-category"
  retention_in_days = 30
}

resource "aws_lambda_function" "coles_category" {
  function_name = "${var.project_name}-coles-category"
  role          = aws_iam_role.coles_category.arn
  handler       = "index.handler"
  runtime       = "python3.13"

  filename         = data.archive_file.category_crawler.output_path
  source_code_hash = data.archive_file.category_crawler.output_base64sha256

  # Fruit & Vegetables is 11 pages at ~0.4s each direct — measured, faster than
  # Woolworths on both counts. Same 300s budget so a bigger category and the
  # retry backoff both fit.
  timeout     = 300
  memory_size = 512

  environment {
    variables = {
      RETAILER      = "coles"
      OUTPUT_BUCKET = aws_s3_bucket.data.id
      OUTPUT_PREFIX = var.coles_output_prefix
      CATEGORY_ID   = var.coles_category_id
      CATEGORY_URL  = var.coles_category_url
      CATEGORY_NAME = var.coles_category_name
      # Empty on purpose. An anonymous Coles request is served a default store
      # rather than a located one (COLES_DISCOVERY.md section 5.5), so there is
      # no honest postcode to claim — the store id it WAS served is recorded on
      # every row and in the manifest instead.
      POSTCODE = var.coles_postcode

      DRIFT_THRESHOLD_PCT = tostring(var.crawler_drift_threshold_pct)
      DRIFT_WINDOW        = tostring(var.crawler_drift_window)
      PAGE_DELAY_MS       = tostring(var.coles_page_delay_ms)

      # Escape hatch for COLES_DISCOVERY.md section 5.3: the buildId can only be
      # read from an HTML page, and HTML is the surface the edge blocks first,
      # while the data route kept answering. Set this to skip the HTML request
      # entirely. Empty (the default) means resolve it per run, which is right
      # until it isn't.
      COLES_BUILD_ID = var.coles_build_id

      PROXY_SECRET_ID       = var.coles_proxy_enabled ? data.aws_secretsmanager_secret.crawler_proxy_url.name : ""
      PROXY_COUNTRY         = var.crawler_proxy_country
      PROXY_SESSION_MINUTES = tostring(var.crawler_proxy_session_minutes)
      PROXY_REQUIRED        = var.coles_proxy_required ? "true" : "false"
      PROXY_PROBE           = var.crawler_proxy_probe ? "true" : "false"
    }
  }

  depends_on = [aws_cloudwatch_log_group.coles_category]
}

# --------------------------------------------------------------- schedule

resource "aws_cloudwatch_event_rule" "coles_category_daily" {
  name        = "${var.project_name}-coles-category-daily"
  description = "Daily Coles category crawl"

  # 18:30 UTC — half an hour after Woolworths. Staggered deliberately: firing
  # both crawlers in the same minute is a burst pattern, and the two runs are
  # independent anyway.
  schedule_expression = "cron(30 18 * * ? *)"
  state               = var.coles_schedule_enabled ? "ENABLED" : "DISABLED"
}

resource "aws_cloudwatch_event_target" "coles_category_daily" {
  rule = aws_cloudwatch_event_rule.coles_category_daily.name
  arn  = aws_lambda_function.coles_category.arn

  # Empty input: the function falls back to its env-var category defaults. To
  # crawl another node, add a target with {"url": "/browse/<a>/<b>", "name": "..."}
  # — Coles needs no node id, the browse path is the identifier.
  input = jsonencode({})
}

resource "aws_lambda_permission" "coles_category_events" {
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.coles_category.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.coles_category_daily.arn
}

# --------------------------------------------------------------- alarm

# The crawler throws on 0 rows, and a Coles block arrives as an HTTP 200
# interstitial that the adapter rejects on content — so an invocation error is
# how a block reaches a human. Alarm on it.
resource "aws_cloudwatch_metric_alarm" "coles_category_errors" {
  alarm_name          = "${var.project_name}-coles-category-errors"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  threshold           = 1
  period              = 86400
  statistic           = "Sum"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.coles_category.function_name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}
