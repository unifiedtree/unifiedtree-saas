output "vpc_id" {
  value       = module.vpc.vpc_id
  description = "VPC ID"
}

output "eks_cluster_name" {
  value       = module.eks.cluster_name
  description = "EKS cluster name"
}

output "eks_cluster_endpoint" {
  value       = module.eks.cluster_endpoint
  description = "EKS cluster endpoint"
  sensitive   = true
}

output "rds_endpoint" {
  value       = aws_db_instance.unifiedtree.endpoint
  description = "RDS PostgreSQL endpoint"
  sensitive   = true
}

output "redis_endpoint" {
  value       = aws_elasticache_replication_group.unifiedtree.primary_endpoint_address
  description = "Redis primary endpoint"
  sensitive   = true
}

output "s3_files_bucket" {
  value       = aws_s3_bucket.unifiedtree_files.bucket
  description = "S3 bucket for file uploads"
}
