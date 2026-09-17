# The "data" bucket — holds all collected report output.
#
# S3 bucket names are globally unique across every AWS account on earth, so a
# bare "data" is not available. The account id suffix keeps it unique while
# keeping "data" as the recognisable middle segment.
#
# Contents are immutable: runs are never overwritten or edited, and a re-run
# writes a new run_id prefix (data/LAMBDA_OUTPUT_SPEC.md section 2).

resource "aws_s3_bucket" "data" {
  bucket = "${var.project_name}-data-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "data" {
  bucket = aws_s3_bucket.data.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "data" {
  bucket = aws_s3_bucket.data.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Versioning guards against an accidental overwrite of an archived run. The
# pipeline never intends to overwrite, so this should stay dormant — it exists
# as a backstop, not as a workflow.
resource "aws_s3_bucket_versioning" "data" {
  bucket = aws_s3_bucket.data.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "data" {
  bucket = aws_s3_bucket.data.id

  # Reports stay readable forever but get cheaper with age. Nothing expires
  # current versions — the archive is the point.
  rule {
    id     = "transition-old-runs"
    status = "Enabled"

    filter {}

    transition {
      days          = 90
      storage_class = "STANDARD_IA"
    }

    transition {
      days          = 365
      storage_class = "GLACIER_IR"
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}
