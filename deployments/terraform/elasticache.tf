resource "aws_elasticache_subnet_group" "unifiedtree" {
  name       = "unifiedtree-${var.environment}"
  subnet_ids = module.vpc.private_subnets
}

resource "aws_security_group" "redis" {
  name   = "unifiedtree-redis-${var.environment}"
  vpc_id = module.vpc.vpc_id

  ingress {
    from_port   = 6379
    to_port     = 6379
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"]
  }
}

resource "aws_elasticache_replication_group" "unifiedtree" {
  replication_group_id = "unifiedtree-${var.environment}"
  description          = "UnifiedTree Redis cluster"

  node_type          = var.redis_node_type
  num_cache_clusters = var.environment == "production" ? 2 : 1
  port               = 6379

  subnet_group_name  = aws_elasticache_subnet_group.unifiedtree.name
  security_group_ids = [aws_security_group.redis.id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true

  automatic_failover_enabled = var.environment == "production"

  tags = {
    Environment = var.environment
    Project     = "UnifiedTree"
  }
}
