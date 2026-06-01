resource "aws_db_subnet_group" "unifiedtree" {
  name       = "unifiedtree-${var.environment}"
  subnet_ids = module.vpc.private_subnets
}

resource "aws_security_group" "rds" {
  name   = "unifiedtree-rds-${var.environment}"
  vpc_id = module.vpc.vpc_id

  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"]
  }
}

resource "aws_db_instance" "unifiedtree" {
  identifier            = "unifiedtree-${var.environment}"
  engine                = "postgres"
  engine_version        = "16.3"
  instance_class        = var.db_instance_class
  allocated_storage     = 100
  max_allocated_storage = 1000
  storage_encrypted     = true
  storage_type          = "gp3"

  db_name  = "unifiedtree"
  username = "nexus"
  password = var.db_password

  db_subnet_group_name   = aws_db_subnet_group.unifiedtree.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  backup_retention_period = 7
  backup_window           = "03:00-04:00"
  maintenance_window      = "Mon:04:00-Mon:05:00"

  deletion_protection       = var.environment == "production"
  skip_final_snapshot       = var.environment != "production"
  final_snapshot_identifier = var.environment == "production" ? "unifiedtree-final-${formatdate("YYYYMMDD", timestamp())}" : null

  performance_insights_enabled = true
  monitoring_interval          = 60

  tags = {
    Environment = var.environment
    Project     = "UnifiedTree"
  }
}
