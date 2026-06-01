variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment (staging or production)"
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "Must be staging or production."
  }
}

variable "domain_name" {
  description = "Primary domain name"
  type        = string
  default     = "unifiedtree.com"
}

variable "db_instance_class" {
  type    = string
  default = "db.t3.medium"
}

variable "redis_node_type" {
  type    = string
  default = "cache.t3.micro"
}

variable "eks_node_count" {
  type    = number
  default = 3
}

variable "eks_node_type" {
  type    = string
  default = "t3.large"
}

variable "db_password" {
  description = "RDS master password"
  type        = string
  sensitive   = true
}
