resource "aws_s3_bucket" "unifiedtree_files" {
  bucket = "unifiedtree-files-${var.environment}-${data.aws_caller_identity.current.account_id}"

  tags = {
    Environment = var.environment
    Project     = "UnifiedTree"
  }
}

resource "aws_s3_bucket_versioning" "unifiedtree_files" {
  bucket = aws_s3_bucket.unifiedtree_files.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "unifiedtree_files" {
  bucket = aws_s3_bucket.unifiedtree_files.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_public_access_block" "unifiedtree_files" {
  bucket                  = aws_s3_bucket.unifiedtree_files.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket" "unifiedtree_backups" {
  bucket = "unifiedtree-backups-${var.environment}-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_lifecycle_configuration" "unifiedtree_backups" {
  bucket = aws_s3_bucket.unifiedtree_backups.id

  rule {
    id     = "archive-old-backups"
    status = "Enabled"

    transition {
      days          = 30
      storage_class = "STANDARD_IA"
    }

    transition {
      days          = 90
      storage_class = "GLACIER"
    }

    expiration {
      days = 365
    }
  }
}

data "aws_caller_identity" "current" {}
