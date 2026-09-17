# --------------------------------------------------------------- alerting
#
# Every alarm in this stack ends in one SNS topic with one email subscription.
# Before 17 Sep 2026 the three -errors alarms existed with an empty
# alarm_actions list: they went to ALARM and paged nobody (roadmap P0.4).
#
# Three failure shapes, three alarms:
#   - the run CRASHES          -> AWS/Lambda Errors        (per function, existing)
#   - the run NEVER STARTS     -> Invocations < 1 in 36 h  (fruitveg only, below)
#   - the run ends PARTIAL     -> a "crawl.partial" log line, counted (below)
# The second is the one that actually happened, 5-13 Sep: the schedule was off
# and nothing noticed. The third is the Woolworths evening runs, 13-16 Sep,
# which returned normally and so never counted as an Error.

resource "aws_sns_topic" "alerts" {
  name = "${var.project_name}-alerts"
}

# The subscription is PendingConfirmation until the address clicks the link
# AWS emails it; Terraform cannot confirm it. Until then the topic delivers
# nothing, so check `aws sns list-subscriptions-by-topic` after the apply.
resource "aws_sns_topic_subscription" "alerts_email" {
  count = var.alert_email == "" ? 0 : 1

  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# ---- the run never starts -------------------------------------------------

# Two scheduled firings a day; a rolling 24 h with none means both were missed
# (schedule disabled, rule target lost, permission revoked). Missing data IS
# the signal here, so it must breach — the opposite of every other alarm.
# CloudWatch caps period x evaluation_periods at one day, which is why this
# is 24 h and not the 36 h the roadmap first asked for.
resource "aws_cloudwatch_metric_alarm" "fruitveg_no_data" {
  alarm_name          = "${var.project_name}-fruitveg-no-data-24h"
  alarm_description   = "The fruitveg crawler has not been invoked for 24 h. The schedule is off, its target is gone, or its permission is. Nothing is being archived."
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  threshold           = 1
  period              = 86400
  statistic           = "Sum"
  namespace           = "AWS/Lambda"
  metric_name         = "Invocations"
  treat_missing_data  = "breaching"

  dimensions = {
    FunctionName = aws_lambda_function.fruitveg_category.function_name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# ---- the run ends partial ---------------------------------------------------

# index.py prints {"msg": "crawl.partial", ...} once per retailer whose run did
# not earn _SUCCESS, and returns normally. Count those lines into a metric;
# any in a day is an alarm. The filter pattern is CloudWatch's JSON syntax.
resource "aws_cloudwatch_log_metric_filter" "fruitveg_partial" {
  name           = "${var.project_name}-fruitveg-partial"
  log_group_name = aws_cloudwatch_log_group.fruitveg_category.name
  pattern        = "{ $.msg = \"crawl.partial\" }"

  metric_transformation {
    name          = "PartialRuns"
    namespace     = "CostOfLivingAU/Crawler"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "fruitveg_partial" {
  alarm_name          = "${var.project_name}-fruitveg-partial-runs"
  alarm_description   = "A fruitveg run finished without _SUCCESS for at least one retailer in the last 24 h. Read the manifest's counts and errors; _SUCCESS-gated readers will skip it."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  threshold           = 1
  period              = 86400
  statistic           = "Sum"
  namespace           = "CostOfLivingAU/Crawler"
  metric_name         = "PartialRuns"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  depends_on = [aws_cloudwatch_log_metric_filter.fruitveg_partial]
}
