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
# Kmart is direct: its grid comes from Constructor.io's public endpoint
# (ac.cnstrc.com), which answers a bare request from a Lambda IP. Big W is
# Woolworths Group and behaves like Woolworths: its search API
# (api.bigw.com.au/search/v1/search) answers a laptop but TARPITS a Lambda IP
# — a read timeout, not a 403, measured 21 Sep 2026 — so Big W goes out through
# the same Decodo residential session lambda_woolworths.tf uses, and on a
# slower cadence because residential bytes are metered (see
# kmart_watch_bigw_every_minutes). Both retailers' category pages are 403
# behind Akamai regardless; the module docstring in lambda/kmart_watch/index.py
# has the measurements.
#
# Cost at the 1-minute default: ~43,200 invocations a month, each ~1s at
# 128 MB — about 5,400 GB-s against a 400,000 GB-s free tier — plus a couple of
# on-demand DynamoDB writes per hit, plus ~0.76 GB/month of residential egress
# that fits inside the crawlers' existing 3 GB Decodo plan. Free in practice.

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

variable "kmart_watch_bigw_every_minutes" {
  description = <<-EOT
    Big W is polled on every Nth minute-tick, Kmart on every tick. Big W goes
    out through the Decodo residential exit, whose bytes are the only thing in
    this stack with a marginal price (US$4/GB past the 3 GB plan the crawlers
    use ~0.3 GB of). Two searches at 48 results are ~90 KB gzipped, so:
      5 -> ~0.76 GB/month, fits inside the existing plan   (default)
      2 -> ~1.9 GB/month, still fits, tighter
      1 -> ~3.8 GB/month, overage of roughly US$5/month
  EOT
  type        = number
  default     = 5
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

# Four files, named one by one rather than a source_dir: two are the watcher's
# own and two are borrowed from the crawler. proxy.py and secrets_store.py are
# the Decodo session layer lambda_woolworths.tf already ships; Big W needs the
# same residential exit, so the zip takes the crawler's copy and there is one
# implementation to fix when Decodo changes something. The local harnesses
# (*_test.py, dry_run.py, test_push.py) are simply not listed.
data "archive_file" "kmart_watch" {
  type        = "zip"
  output_path = "${path.module}/lambda/kmart_watch.zip"

  source {
    filename = "index.py"
    content  = file("${path.module}/lambda/kmart_watch/index.py")
  }
  source {
    filename = "push.py"
    content  = file("${path.module}/lambda/kmart_watch/push.py")
  }
  source {
    filename = "proxy.py"
    content  = file("${path.module}/lambda/category_crawler/proxy.py")
  }
  source {
    filename = "secrets_store.py"
    content  = file("${path.module}/lambda/category_crawler/secrets_store.py")
  }
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
      # The crawler's Decodo credential, read at cold start for the Big W
      # sources only. Same secret, same grant shape as lambda_woolworths.tf;
      # no kms:Decrypt for the same reason (AWS-managed key).
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [data.aws_secretsmanager_secret.crawler_proxy_url.arn]
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

  # Two Kmart requests (~1s), two Big W requests through the residential exit
  # (~5s, or 2x15s each when tarpitted -- that is the measured failure mode,
  # not a 403), a homepage fetch for the Constructor key on a cold container,
  # and up to kmart_watch_push_max pushes at 10s each. 90s is the worst case
  # with every one of those retrying; the ordinary tick is under 2s.
  timeout     = 90
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

      # Big W only. Kmart is direct and never touches the proxy. Only the
      # secret's NAME is here; the credential is read at cold start. If the
      # secret cannot be read the Big W sources fail loudly (alarm) rather
      # than going out on the AWS IP, which Big W tarpits anyway.
      PROXY_SECRET_ID    = data.aws_secretsmanager_secret.crawler_proxy_url.name
      PROXY_COUNTRY      = var.crawler_proxy_country
      BIGW_EVERY_MINUTES = tostring(var.kmart_watch_bigw_every_minutes)
      BIGW_PER_PAGE      = "48"

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
  description = "Poll the Kmart and Big W feeds for ${var.kmart_watch_pattern}"
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
