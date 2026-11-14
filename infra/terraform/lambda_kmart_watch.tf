# Kmart + Big W + Target + JB Hi-Fi pre-order watcher — unrelated to the price
# series, same account.
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
# (ac.cnstrc.com), which answers a bare request from a Lambda IP. Target
# (added 1 Oct 2026) is the same engine on the same host with its own key, and
# is why there is no separate target-watch function: a third Lambda would have
# duplicated ~600 lines to change a key and a sort field. Its homepage is not
# behind Akamai at all, so it is direct and free like Kmart. JB Hi-Fi (added
# 2 Oct 2026) is Shopify and uses ALGOLIA rather than Constructor, with the app
# id and public search key taken from its theme bundle; also direct, also free,
# but it needs its own filtering because its catalogue is 780k products and
# most of its "30th anniversary" stock is vinyl reissues — see
# kmart_watch_jb_exclude_types. Big W is
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
  description = <<-EOT
    Case-insensitive regex matched against accent-stripped product titles.
    "30th anniversary" alone missed the range this exists for: Kmart listed the
    Pokemon TCG 30th line on 17 Sep 2026 as "30th Celebration". The default
    takes either wording, or any Pokemon title carrying anniversary /
    celebration / 30th, so a rename does not blind it again.

    "mini tins?" was added 1 Oct 2026 for the Pokemon TCG 30th anniversary mini
    tins. It is tight enough to leave the tin CANDLES alone: a Target "mini
    tin" search returns "Anko Christmas Reindeer Tin Candle", which this regex
    does not match. Verified against the live feed with dry_run.py -- the four
    Target rows it selects are all genuine 30th anniversary products.
  EOT
  type        = string
  default     = "30th\\s*(anniversary|celebration)|mini\\s*tins?|pokemon.*(anniversary|celebration|30th|30\\s*years?)"
}

variable "kmart_watch_sources" {
  description = <<-EOT
    Comma-separated feed sources: "browse:<group_id>" and "search:<query>" are
    Kmart, "bigw:<query>" is Big W. Kmart is Toys > Latest Arrivals plus
    site-wide searches, all sorted newest-first, so a drop is caught whether it
    is filed under a category, sold as an ordinary listing, or named
    differently from what we expected: "pokemon" is the safety net, the pattern
    does the filtering.

    The browse group WAS 615bf6db4dee158ccbbc1ed5aef1ced9, the toys pre-order
    category. Kmart deleted that category; on 2 Oct 2026 the id returned 0
    results with no error, which is this watcher's worst failure mode because
    it is indistinguishable from a quiet day. There is no pre-order shelf left
    anywhere in Kmart's tree, so the replacement is Toys > Latest Arrivals. Big
    W has no browsable pre-order category on its API and no pre-order flag on
    its own stock, so it is the same two ideas as newest-first searches.
    (bigw:preorder returned 0 own-stock rows -- only marketplace sellers write
    PREORDER into a name -- and was dropped.)

    "target:<query>" and "target-browse:<group_id>" are Target. target-browse
    W1852642 is its "Pokemon Cards" group, which held 12 products on 1 Oct
    2026 -- small, and the obvious shelf for a TCG tin. The three searches are
    the same newest-first idea as Kmart's, plus "mini tin" for the range this
    was extended for. Target's group tree is NOT browsable the way Kmart's is
    (browse/group_id/all returns an empty groups array on its index), so new
    group ids are read off a product's data.group_ids instead -- see the
    README.

    "jb:<query>" is JB Hi-Fi, through Algolia. There is no browse kind for it:
    the index has no date-sorted replica, so instead of a newest-first page
    each query is narrowed to a rolling release_date window
    (kmart_watch_jb_release_window_days). Two queries, same shape as the
    others -- the broad "pokemon" safety net and the explicit wording.
  EOT
  type        = string
  default     = "browse:e35ed26c9b1dfb7fd311f93557216816,search:30th anniversary,search:30th celebration,search:pokemon,bigw:30th anniversary,bigw:pokemon,target-browse:W1852642,target:pokemon,target:30th anniversary,target:mini tin,jb:30th anniversary,jb:pokemon"
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
  description = <<-EOT
    Alert on ANY new item in Kmart's browse source, not just pattern matches.

    Was true, and was the point, while that source was the toys pre-order
    category: 2 items, so everything new in it was worth knowing. Kmart deleted
    that category (see kmart_watch_sources) and the replacement is Toys >
    Latest Arrivals -- 455 items, where taking everything is an alert per new
    toy. So this is now false and the pattern does the filtering, matching
    kmart_watch_target_alert_all_browse.
  EOT
  type        = bool
  default     = false
}

variable "kmart_watch_target_alert_all_browse" {
  description = <<-EOT
    The same idea for Target's browse group, deliberately a separate switch and
    deliberately off. Kmart's browse source is a pre-order shelf that held 2
    items, so reading it whole is quiet and is the point. Target's W1852642 is
    an ordinary "Pokemon Cards" group of 12 sleeves, deck boxes and blisters;
    reading it whole means an alert every time Target reshuffles an id, which
    is how you learn to ignore the notification. The pattern does the work
    instead. Turn this on for the window around a drop if you would rather see
    a tin filed under a name nobody predicted than miss it.
  EOT
  type        = bool
  default     = false
}

variable "kmart_watch_jb_exclude_types" {
  description = <<-EOT
    Comma-separated Algolia product_type values dropped from JB Hi-Fi results.

    This one is not cosmetic. Of 33 recent "30th anniversary" matches on JB on
    2 Oct 2026, 29 were product_type MUSIC -- vinyl reissues, which JB sells
    constantly and labels "30th Anniversary Edition". Left in, this single
    source alerts more than the other three retailers combined and you learn
    to ignore the notification.

    Note that `department` is NOT usable for this: Magic: The Gathering
    products are filed under department "MOVIES". product_type is consistent.
    Set to "" to hear the vinyl too.
  EOT
  type        = string
  default     = "MUSIC"
}

variable "kmart_watch_jb_release_window_days" {
  description = <<-EOT
    How far back a JB release_date may be for a product to still count as
    news. This is how the JB source stays small: its catalogue is 780,376
    products and "30th anniversary" alone matches 2,704, of which the first
    550 genuinely match the pattern -- reading that would need hitsPerPage
    1000, which is 7.5 MB a request. A 60-day window plus attributesToRetrieve
    puts one query at ~36 KB.

    There is deliberately no forward bound: a pre-order's release date is in
    the future, and those are the ones worth catching.
  EOT
  type        = number
  default     = 60
}

variable "kmart_watch_jb_include_marketplace" {
  description = "true -> third-party JB Hi-Fi sellers too. Same idea as Big W's."
  type        = bool
  default     = false
}

variable "kmart_watch_target_stock_flip" {
  description = <<-EOT
    Target has no pre-order flag anywhere on its index -- but it does publish
    availableonlineqty, and rows really do sit at 0 while listed but not yet
    purchasable (measured 1 Oct 2026 on the Pokemon 30th Battle Figure
    Multipack and a Journey Together blister). true makes a 0 -> >0 flip earn a
    SECOND alert, which is the moment a drop actually becomes buyable.

    Off by default because an ordinary restock of a product you were already
    alerted about looks identical and is noise. For a drop you are waiting on,
    this is the single most useful signal here -- turn it on for that window.
  EOT
  type        = bool
  default     = false
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

  # Two Kmart requests (~1s), four Target requests (~1s each, direct), two
  # JB Hi-Fi Algolia requests (~0.5s each, direct), two
  # Big W requests through the residential exit
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
      # Was /category/toys/pre-order/, a category Kmart has since deleted.
      PAGE_URL = "https://www.kmart.com.au/category/toys/"

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

      # Target. Direct and free like Kmart, so it rides every tick and has no
      # cadence knob. TARGET_PER_PAGE is 30 rather than Kmart's 100 because
      # Target rows carry ~40 fields each (~5 KB a row), and newest-first sort
      # puts a drop on row one anyway.
      TARGET_PAGE_URL         = "https://www.target.com.au/c/toys/W138532"
      TARGET_PER_PAGE         = "30"
      TARGET_ALERT_ALL_BROWSE = var.kmart_watch_target_alert_all_browse ? "true" : "false"
      TARGET_STOCK_FLIP       = var.kmart_watch_target_stock_flip ? "true" : "false"

      # JB Hi-Fi. Direct and free like Kmart and Target, so it rides every
      # tick. JB_APP_ID / JB_SEARCH_KEY / JB_INDEX are deliberately unset:
      # they default to the values read out of JB's theme bundle, and the
      # README says how to re-read them if they rotate.
      JB_RELEASE_WINDOW_DAYS = tostring(var.kmart_watch_jb_release_window_days)
      JB_EXCLUDE_TYPES       = var.kmart_watch_jb_exclude_types
      JB_INCLUDE_MARKETPLACE = var.kmart_watch_jb_include_marketplace ? "true" : "false"

      TTL_DAYS = "90"
      # CONSTRUCTOR_KEY and TARGET_CONSTRUCTOR_KEY deliberately unset: the
      # function scrapes each site's key off its own homepage and caches it per
      # container, so a key rotation self-heals.
    }
  }

  depends_on = [aws_cloudwatch_log_group.kmart_watch]
}

# --------------------------------------------------------------- schedule

resource "aws_cloudwatch_event_rule" "kmart_watch" {
  name        = "${var.project_name}-kmart-watch"
  description = "Poll the Kmart, Big W, Target and JB Hi-Fi feeds for ${var.kmart_watch_pattern}"
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
  alarm_description   = "The Kmart/Big W/Target/JB watcher is erroring: a feed changed shape, a Constructor or Algolia key rotated, or one retailer is blocking. The tick log names the failed source; run lambda/kmart_watch/dry_run.py locally to see what it returns now."
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
