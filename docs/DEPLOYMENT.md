# Deployment Guide

## Prerequisites

Before deploying to production, ensure the following are available:

- A Linux server (Ubuntu 22.04 LTS recommended) with Docker and Docker Compose v2
- A domain name with DNS control (for subdomain wildcard: `*.unifiedtree.com`)
- A PostgreSQL 16 instance (managed RDS or self-hosted)
- A Redis 7 instance (managed ElastiCache or self-hosted)
- A Kafka cluster (managed Confluent Cloud or self-hosted)
- An S3-compatible bucket for file storage
- GitHub Container Registry access (`ghcr.io`) or a private registry

## Environment Variables Reference

| Variable | Description | Example |
|---|---|---|
| `DB_URL` | JDBC connection string | `jdbc:postgresql://db.host:5432/unifiedtree` |
| `DB_USERNAME` | PostgreSQL user | `nexus` |
| `DB_PASSWORD` | PostgreSQL password | *(strong random)* |
| `REDIS_HOST` | Redis hostname | `redis.host` |
| `REDIS_PORT` | Redis port | `6379` |
| `REDIS_PASSWORD` | Redis password | *(strong random)* |
| `KAFKA_BROKERS` | Comma-separated broker list | `b1.kafka.host:9092` |
| `JWT_SECRET` | Minimum 256-bit signing key | *(32+ random chars)* |
| `STORAGE_PROVIDER` | `local` or `s3` | `s3` |
| `S3_BUCKET` | S3 bucket name | `unifiedtree-files` |
| `S3_REGION` | AWS region | `us-east-1` |
| `AWS_ACCESS_KEY_ID` | S3 IAM key | *(from IAM console)* |
| `AWS_SECRET_ACCESS_KEY` | S3 IAM secret | *(from IAM console)* |
| `STRIPE_SECRET_KEY` | Stripe secret key | `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing | `whsec_...` |
| `SMTP_HOST` | Mail server host | `smtp.sendgrid.net` |
| `SMTP_PORT` | Mail server port | `587` |
| `EMAIL_FROM` | Sender address | `noreply@unifiedtree.com` |
| `DOMAIN` | Root domain | `unifiedtree.com` |
| `CORS_ORIGIN_WEBSITE` | Website origin | `https://unifiedtree.com` |
| `CORS_ORIGIN_PLATFORM` | Platform origin | `https://<tenant>.unifiedtree.com` |
| `CORS_ORIGIN_ADMIN` | Admin origin | `https://admin.unifiedtree.com` |

## Docker Compose Production Deploy

1. SSH into the production server and clone the repository:

```bash
ssh user@your-server
git clone https://github.com/your-org/erp-platform.git /opt/unifiedtree
cd /opt/unifiedtree
```

2. Create the production environment file:

```bash
cp .env.example .env
# Edit .env with real production values
nano .env
```

3. Pull the latest Docker images:

```bash
export VERSION=v1.0.0
docker compose -f deployments/docker-compose.yml \
  -f deployments/docker-compose.prod.yml pull
```

4. Start all services:

```bash
docker compose -f deployments/docker-compose.yml \
  -f deployments/docker-compose.prod.yml up -d
```

5. Verify health:

```bash
curl https://api.unifiedtree.com/actuator/health
docker compose -f deployments/docker-compose.yml ps
```

## Kubernetes Deploy

Apply manifests in order:

```bash
# Create namespace first
kubectl apply -f deployments/k8s/namespace.yaml

# ConfigMap and Secrets (update secrets.yaml with real values before applying)
kubectl apply -f deployments/k8s/configmap.yaml
kubectl apply -f deployments/k8s/secrets.yaml

# Stateful services
kubectl apply -f deployments/k8s/postgres-statefulset.yaml
kubectl apply -f deployments/k8s/redis-statefulset.yaml

# Wait for DB to be ready
kubectl wait --for=condition=ready pod -l app=postgres -n unifiedtree --timeout=120s

# Application deployments
kubectl apply -f deployments/k8s/backend-deployment.yaml
kubectl apply -f deployments/k8s/frontend-deployments.yaml

# Ingress and autoscaling
kubectl apply -f deployments/k8s/ingress.yaml
kubectl apply -f deployments/k8s/hpa.yaml
```

Check rollout status:

```bash
kubectl rollout status deployment/unifiedtree-backend -n unifiedtree
kubectl get pods -n unifiedtree
```

## SSL/TLS with Let's Encrypt

### Docker Compose (Certbot)

The production compose includes a `certbot` service. To issue the first certificate:

```bash
docker compose -f deployments/docker-compose.yml \
  -f deployments/docker-compose.prod.yml run --rm certbot \
  certonly --webroot --webroot-path=/var/www/certbot \
  -d unifiedtree.com -d www.unifiedtree.com -d <tenant>.unifiedtree.com \
  -d admin.unifiedtree.com -d api.unifiedtree.com \
  --email admin@unifiedtree.com --agree-tos --no-eff-email
```

Add a cron job for auto-renewal:

```bash
0 12 * * * cd /opt/unifiedtree && docker compose run --rm certbot renew --quiet
```

### Kubernetes (cert-manager)

Install cert-manager:

```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml
```

Create a ClusterIssuer for Let's Encrypt (save as `letsencrypt-issuer.yaml`):

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: admin@unifiedtree.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
      - http01:
          ingress:
            class: nginx
```

```bash
kubectl apply -f letsencrypt-issuer.yaml
```

cert-manager automatically provisions and renews certificates referenced in the Ingress `tls` block.

## Database Backup Strategy

### Daily automated backup

```bash
#!/usr/bin/env bash
DATE=$(date +%Y-%m-%d-%H%M)
BACKUP_FILE="unifiedtree-$DATE.sql.gz"

pg_dump -h $DB_HOST -U $DB_USER -d unifiedtree | gzip > /tmp/$BACKUP_FILE
aws s3 cp /tmp/$BACKUP_FILE s3://$S3_BUCKET/backups/$BACKUP_FILE
rm /tmp/$BACKUP_FILE
echo "Backup complete: $BACKUP_FILE"
```

Add to cron:

```bash
0 2 * * * /opt/unifiedtree/scripts/backup-db.sh >> /var/log/unifiedtree-backup.log 2>&1
```

Retain backups for 30 days with S3 lifecycle rules.

### Restore

```bash
aws s3 cp s3://$S3_BUCKET/backups/unifiedtree-2026-01-01-0200.sql.gz /tmp/restore.sql.gz
gunzip /tmp/restore.sql.gz
psql -h $DB_HOST -U $DB_USER -d unifiedtree < /tmp/restore.sql
```

## Rollback Procedure

### Docker Compose

```bash
# Rollback to a specific version tag
export VERSION=v0.9.5
docker compose -f deployments/docker-compose.yml \
  -f deployments/docker-compose.prod.yml pull
docker compose -f deployments/docker-compose.yml \
  -f deployments/docker-compose.prod.yml up -d
```

### Kubernetes

```bash
# View rollout history
kubectl rollout history deployment/unifiedtree-backend -n unifiedtree

# Rollback to previous revision
kubectl rollout undo deployment/unifiedtree-backend -n unifiedtree

# Rollback to a specific revision
kubectl rollout undo deployment/unifiedtree-backend -n unifiedtree --to-revision=2
```

For database migrations, Flyway does not auto-rollback. Prepare a compensating migration script and apply it as the next version before rolling back the application.

## Health Check Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /actuator/health` | Overall application health |
| `GET /actuator/health/liveness` | Kubernetes liveness probe |
| `GET /actuator/health/readiness` | Kubernetes readiness probe |
| `GET /actuator/info` | Application version and build info |
| `GET /actuator/metrics` | Micrometer metrics |
| `GET /actuator/prometheus` | Prometheus scrape endpoint |
