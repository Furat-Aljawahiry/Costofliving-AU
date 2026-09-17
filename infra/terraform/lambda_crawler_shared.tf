# Shared plumbing for the category crawlers.
#
# ONE zip, deployed as one Lambda function per retailer. The retailer a function
# crawls is an env var, not a fork of the code — see lambda/category_crawler/
# index.py. That is what guarantees the Woolworths CSV and the Coles CSV have
# identical columns: both are written by the same crawler.to_csv.

data "archive_file" "category_crawler" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/category_crawler"
  output_path = "${path.module}/lambda/category_crawler.zip"

  # Local-only test harnesses and bytecode caches; no need to ship them.
  excludes = ["proxy_test.py", "handler_test.py", "cheapest_test.py", "coles_test.py", "batch_test.py", "taxonomy_test.py", "drift_test.py", "paging_test.py", "__pycache__"]
}

# --------------------------------------------------------------- drift check

# The crawlers are write-only to S3 with one exception: drift.py reads the
# trailing complete runs' manifests under a retailer's own prefix so it can
# compare this run's total_reported and fulfilment store against them.
# Measured: Woolworths served the category from three different stores across
# twelve runs, and the two 400-product runs were both "complete". Listing is
# scoped to the prefix with s3:prefix, and GetObject to the manifests, so the
# read grant is exactly as narrow as the write one.
locals {
  crawler_read_prefixes = compact([
    var.woolworths_output_prefix,
    var.coles_output_prefix,
  ])
}

data "aws_iam_policy_document" "crawler_read_manifests" {
  statement {
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.data.arn]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = [for p in local.crawler_read_prefixes : "${p}/*"]
    }
  }
  statement {
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = [for p in local.crawler_read_prefixes : "${aws_s3_bucket.data.arn}/${p}/*.manifest.json"]
  }
}

# One alarm per retailer, on the DriftAlarm metric drift.py emits through EMF.
# It fires when total_reported moves more than DRIFT_THRESHOLD_PCT from the
# trailing median, OR when the run was served by a store other than the one
# pinned / seen before. The Errors alarm cannot catch this: those runs succeed.
resource "aws_cloudwatch_metric_alarm" "crawler_drift" {
  for_each = toset(["woolworths", "coles"])

  alarm_name          = "${var.project_name}-${each.key}-category-drift"
  alarm_description   = "${each.key}: category count moved >${var.crawler_drift_threshold_pct}% from the trailing median, or the fulfilment store changed (see drift.py)"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  threshold           = 1
  period              = 86400
  statistic           = "Maximum"
  namespace           = "CostOfLivingAU/Crawler"
  metric_name         = "DriftAlarm"
  treat_missing_data  = "notBreaching"

  dimensions = {
    Retailer = each.key
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# --------------------------------------------------------------- proxy secret

# The secret is created and maintained OUT OF BAND (console or `aws
# secretsmanager put-secret-value`), and Terraform only reads its ARN to write
# the IAM policy. Deliberately a data source, not a resource:
#
#   - As a resource it would fight the existing secret on every apply, and an
#     accompanying secret_version would overwrite the real proxy password with
#     a placeholder — a silent credential wipe, with the crawler falling back to
#     direct AWS egress and still reporting success.
#   - Terraform never sees the value, so nothing sensitive reaches tfstate or a
#     saved plan. Only the ARN, which is not sensitive.
#
# Rotating the password is therefore an AWS CLI call with no Terraform run at
# all; the Lambdas pick it up on their next cold start. One account, one secret,
# shared by every retailer — each retailer decides separately whether to USE it.
data "aws_secretsmanager_secret" "crawler_proxy_url" {
  name = var.crawler_proxy_secret_name
}
