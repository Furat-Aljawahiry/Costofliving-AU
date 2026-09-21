# Kmart + Big W pre-order watcher — unrelated to the price series, same account.
#
# Polls both retailers' product feeds every minute and pushes to a phone — plus
# emails — the moment a "30th anniversary" product appears, or anything new
# lands in Kmart's toys pre-order category. Nothing is written to the data
# bucket and nothing here touches the crawlers; the only shared resource is the
# alerts topic, so a watcher alert and a crawler alarm arrive at the same
# address. One function, one table, one alarm for both retailers: the retailer
# is a prefix on the source spec, and Big W rows are namespaced "bigw:<id>".
#
# Neither needs the proxy lambda_woolworths.tf does. Kmart's grid comes from
# Constructor.io's public endpoint (ac.cnstrc.com); Big W's from the site's own
# search API (api.bigw.com.au/search/v1/search). Both answer a bare request
# from a Lambda IP, while both retailers' category pages are 403 behind Akamai
# — see the module docstring in lambda/kmart_watch/index.py for the
# measurements, including Big W tarpitting the www host after ~30 requests.
#
# Cost at the 1-minute default: ~43,200 invocations a month, each ~1s at
# 128 MB — about 5,400 GB-s against a 400,000 GB-s free tier — plus a couple of
# on-demand DynamoDB writes per hit. Free in practice, cents at worst. That is
# four requests a minute across two CDN-fronted APIs, which is nothing.

variable "kmart_watch_enabled" {
  description = "Master switch. false leaves the function deployed but never fired."
  type        = bool
  default     = true
}

variable "kmart_watch_pattern" {
  description = "Case-insensitive regex matched against product titles."
  type        = string
  default     = "30th\\s*anniversary"
}

variable "kmart_watch_sources" {
  description = <<-EOT
    Comma-separated feed sources: "browse:<group_id>" and "search:<query>" are
    Kmart, "bigw:<query>" is Big W. The Kmart pair is the toys pre-order
    category (group id read off the Constructor group tree on 18 Sep 2026) plus
    a site-wide title search, so a drop is caught whether or not it is filed
    under pre-order. Big W has no browsable pre-order category on its API, so
    it is two searches, newest first: the pattern itself, and "preorder" (the
    word sellers put in the name) filtered through the pattern.
  EOT
  type        = string
  default     = "browse:615bf6db4dee158ccbbc1ed5aef1ced9,search:30th anniversary,bigw:30th anniversary,bigw:preorder"
}

variable "kmart_watch_interval_minutes" {
  description = "Poll interval. 1 is the EventBridge floor and costs nothing worth counting."
  type        = number
  default     = 1
}

variable "kmart_watch_push_target" {
  description = <<-EOT
    Phone push, so the alert does not wait on a mail sync. Empty = email only.
      ntfy:<topic>                     free, no account, install the ntfy app
      pushover:<user_key>:<app_token>
      telegram:<bot_token>:<chat_id>
    Prove it with `python lambda/kmart_watch/test_push.py <target>` first. This
    holds a credential for the last two, so it belongs in terraform.tfvars —
    which .gitignore already keeps out of the repo as *.tfvars.
  EOT
  type        = string
  default     = ""
  sensitive   = true
}

variable "kmart_watch_push_max" {
  description = "Most pushes one tick may send. The email always lists everything."
  type        = number
  default     = 5
}

variable "kmart_watch_alert_all_preorder" {
  description = "Alert on ANY new item in a browse source, not just pattern matches."
  type        = bool
  default     = true
}

# --------------------------------------------------------------- package

data "archive_file" "kmart_watch" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/kmart_watch"
  output_path = "${path.module}/lambda/kmart_watch.zip"

  # Local harnesses: *_test.py are offline, dry_run.py and test_push.py go live.
  excludes = ["index_test.py", "push_test.py", "dry_run.py", "test_push.py", "__pycache__", "README.md"]
}

# --------------------------------------------------------------- dedupe table

# One row per product, TTL'd so a long-dead listing eventually stops costing
# storage. `alert_state` is what makes a product alert a SECOND time when it
# flips from listed to pre-order-active — that flip is the buy signal.
resource "aws_dynamodb_table" "kmart_seen" {
  name         = "${var.project_name}-kmart-seen"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "product_id"

  attribute {
    name = "product_id"
    type = "S"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }
}

# --------------------------------------------------------------- role

resource "aws_iam_role" "kmart_watch" {
  name = "${var.project_name}-kmart-watch"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "kmart_watch_basic" {
  role       = aws_iam_role.kmart_watch.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# PutItem only — the watcher never reads the table back and never deletes from
# it. The conditional expression does the "have I seen this?" work server-side,
# which is also what makes two overlapping ticks idempotent.
resource "aws_iam_role_policy" "kmart_watch" {
  name = "${var.project_name}-kmart-watch"
  role = aws_iam_role.kmart_watch.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem"]
        Resource = [aws_dynamodb_table.kmart_seen.arn]
      },
      {
        Effect   = "Allow"
        Action   = ["sns:Publish"]
        Resource = [aws_sns_topic.alerts.arn]
      },
    ]
  })
}

# --------------------------------------------------------------- function

resource "aws_cloudwatch_log_group" "kmart_watch" {
  name              = "/aws/lambda/${var.project_name}-kmart-watch"
  retention_in_days = 30
}

resource "aws_lambda_function" "kmart_watch" {
  function_name = "${var.project_name}-kmart-watch"
  role          = aws_iam_role.kmart_watch.arn
  handler       = "index.lambda_handler"
  runtime       = "python3.13"

  filename         = data.archive_file.kmart_watch.output_path
  source_code_hash = data.archive_file.kmart_watch.output_base64sha256

  # Four feed requests, plus a homepage fetch for the Constructor key on a cold
  # container, plus up to kmart_watch_push_max pushes at a 10s timeout each.
  # 60s is the worst case with every one of those retrying.
  timeout     = 60
  memory_size = 128

  environment {
    variables = {
      TABLE_NAME         = aws_dynamodb_table.kmart_seen.name
      TOPIC_ARN          = aws_sns_topic.alerts.arn
      MATCH_PATTERN      = var.kmart_watch_pattern
      SOURCES            = var.kmart_watch_sources
      ALERT_ALL_PREORDER = var.kmart_watch_alert_all_preorder ? "true" : "false"
      PAGE_URL           = "https://www.kmart.com.au/category/toys/pre-order/"

      # Sent BEFORE the SNS email, because it is the half that can plausibly
      # reach a phone inside a minute. push.py swallows its own failures, so a
      # dead push service never costs you the email.
      PUSH_TARGET = var.kmart_watch_push_target
      PUSH_MAX    = tostring(var.kmart_watch_push_max)

      TTL_DAYS = "90"
      # CONSTRUCTOR_KEY deliberately unset: the function scrapes it off the
      # homepage and caches it per container, so a key rotation self-heals.
    }
  }

  depends_on = [aws_cloudwatch_log_group.kmart_watch]
}

# --------------------------------------------------------------- schedule

resource "aws_cloudwatch_event_rule" "kmart_watch" {
  name        = "${var.project_name}-kmart-watch"
  description = "Poll the Kmart pre-order feed for ${var.kmart_watch_pattern}"
  # EventBridge rejects "rate(1 minutes)" — the unit is singular at 1 and plural
  # everywhere else, and 1 is this rule's default.
  schedule_expression = "rate(${var.kmart_watch_interval_minutes} ${var.kmart_watch_interval_minutes == 1 ? "minute" : "minutes"})"
  state               = var.kmart_watch_enabled ? "ENABLED" : "DISABLED"
}

resource "aws_cloudwatch_event_target" "kmart_watch" {
  rule = aws_cloudwatch_event_rule.kmart_watch.name
  arn  = aws_lambda_function.kmart_watch.arn

  # Empty input. {"seed": true} is for hand invocations only: it claims every
  # current match without emailing, so the first scheduled tick is quiet.
  input = jsonencode({})
}

resource "aws_lambda_permission" "kmart_watch_events" {
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.kmart_watch.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.kmart_watch.arn
}

# --------------------------------------------------------------- alarm

# The handler raises when the feed stops answering or stops returning JSON —
# which is the failure that matters here, because the quiet failure mode is
# "we polled 720 times today and found nothing" and it looks identical to
# "nothing dropped today". Threshold 3 rather than 1: at a 2-minute tick a
# single Akamai blip is not worth an email.
resource "aws_cloudwatch_metric_alarm" "kmart_watch_errors" {
  alarm_name          = "${var.project_name}-kmart-watch-errors"
  alarm_description   = "The Kmart/Big W watcher is erroring: a feed changed shape, the Constructor key rotated, or one retailer is blocking. The tick log names the failed source; run lambda/kmart_watch/dry_run.py locally to see what it returns now."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  threshold           = 3
  period              = 900
  statistic           = "Sum"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.kmart_watch.function_name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

output "kmart_watch_function_name" {
  value = aws_lambda_function.kmart_watch.function_name
}
