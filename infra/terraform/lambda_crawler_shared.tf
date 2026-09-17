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
  excludes = ["proxy_test.py", "handler_test.py", "cheapest_test.py", "coles_test.py", "batch_test.py", "taxonomy_test.py", "__pycache__"]
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
