module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.0"

  cluster_name    = "unifiedtree-${var.environment}"
  cluster_version = "1.30"

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  cluster_endpoint_public_access = true

  eks_managed_node_groups = {
    main = {
      instance_types = [var.eks_node_type]
      min_size       = var.environment == "production" ? 2 : 1
      max_size       = var.environment == "production" ? 10 : 3
      desired_size   = var.eks_node_count

      labels = {
        Environment = var.environment
        Role        = "main"
      }

      tags = {
        "k8s.io/cluster-autoscaler/enabled"                      = "true"
        "k8s.io/cluster-autoscaler/unifiedtree-${var.environment}" = "owned"
      }
    }
  }

  tags = {
    Environment = var.environment
    Project     = "UnifiedTree"
    ManagedBy   = "Terraform"
  }
}
