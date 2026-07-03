#!/usr/bin/env bash
# =============================================================================
# UnifiedTree HRMS — Google Cloud production provisioning (idempotent).
#
# Migrates the backend + database from Railway to GCP. Safe to re-run: every
# command uses create-if-absent semantics or `|| true` on already-exists.
#
# Target architecture (justified in docs/production/GCP_MIGRATION.md):
#   - Cloud Run (2nd gen)      -> stateless Spring Boot API + Python face worker
#   - Cloud SQL for PostgreSQL -> managed HA Postgres 18 (private IP)
#   - Secret Manager           -> all secrets (DB pwd, JWT, face key, SMTP, Brevo)
#   - Artifact Registry        -> Docker images
#   - Direct VPC egress        -> Cloud Run reaches Cloud SQL over private IP
#   - Serverless NEG + HTTPS LB + Cloud Armor -> WAF, rate-limit, DDoS, custom domain
#   - Cloud Logging/Monitoring/Error Reporting/Uptime + alerting
#
# Prereqs on the machine running this:
#   gcloud CLI authenticated (gcloud auth login) with Owner/Editor on the project,
#   billing enabled (Blaze/paid), and the variables below filled in.
#
# Usage:
#   ./provision.sh apis          # enable required APIs
#   ./provision.sh network       # VPC + private services access
#   ./provision.sh sql           # Cloud SQL instance + db + user
#   ./provision.sh secrets       # create Secret Manager secrets (values from env)
#   ./provision.sh registry      # Artifact Registry repo
#   ./provision.sh iam           # runtime + deployer service accounts
#   ./provision.sh deploy        # build image + deploy Cloud Run
#   ./provision.sh lb            # HTTPS load balancer + Cloud Armor + domain
#   ./provision.sh monitoring    # uptime checks + alert policies
#   ./provision.sh all           # everything, in order
# =============================================================================
set -euo pipefail

# ----------------------------- CONFIG (EDIT ME) ------------------------------
PROJECT_ID="${PROJECT_ID:-unifiedtree-prod}"
REGION="${REGION:-asia-south1}"          # Mumbai — closest to India users
ZONE="${ZONE:-asia-south1-a}"

# Networking
VPC_NAME="ut-vpc"
SUBNET_NAME="ut-subnet"
SUBNET_RANGE="10.20.0.0/24"

# Cloud SQL
SQL_INSTANCE="ut-postgres"
SQL_TIER="db-custom-2-7680"              # 2 vCPU / 7.5 GB — right-size later
SQL_DB="railway"                         # keep the DB name the app already uses
SQL_APP_USER="ut_app"                    # the role the backend logs in as
SQL_EDITION="ENTERPRISE"                 # ENTERPRISE_PLUS for sub-second HA failover
SQL_AVAIL="REGIONAL"                     # REGIONAL = synchronous HA standby

# Artifact Registry
AR_REPO="ut-images"
IMAGE_NAME="hrms-backend"

# Cloud Run
RUN_SERVICE="unifiedtree-saas"
RUN_CPU="2"
RUN_MEM="1Gi"
RUN_MIN_INSTANCES="1"                    # paid tier: keep 1 warm, no cold starts
RUN_MAX_INSTANCES="10"
RUN_CONCURRENCY="80"

# Service accounts
RUN_SA="ut-run-runtime"                  # runtime identity (least privilege)
DEPLOYER_SA="ut-deployer"                # CI/CD deployer (used by GitHub Actions)

# Custom domain for the API (map after DNS is pointed)
API_DOMAIN="${API_DOMAIN:-api.unifiedtree.com}"

# ------------------------------- helpers -------------------------------------
gc(){ gcloud --project "$PROJECT_ID" "$@"; }
log(){ printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }

SQL_CONN="$PROJECT_ID:$REGION:$SQL_INSTANCE"
RUN_SA_EMAIL="$RUN_SA@$PROJECT_ID.iam.gserviceaccount.com"
DEPLOYER_SA_EMAIL="$DEPLOYER_SA@$PROJECT_ID.iam.gserviceaccount.com"
IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/$AR_REPO/$IMAGE_NAME"

# ------------------------------- steps ---------------------------------------
apis(){
  log "Enabling required APIs"
  gc services enable \
    run.googleapis.com \
    sqladmin.googleapis.com \
    secretmanager.googleapis.com \
    artifactregistry.googleapis.com \
    cloudbuild.googleapis.com \
    compute.googleapis.com \
    servicenetworking.googleapis.com \
    vpcaccess.googleapis.com \
    logging.googleapis.com \
    monitoring.googleapis.com \
    clouderrorreporting.googleapis.com \
    cloudscheduler.googleapis.com
}

network(){
  log "Creating VPC + subnet + private services access for Cloud SQL"
  gc compute networks create "$VPC_NAME" --subnet-mode=custom || true
  gc compute networks subnets create "$SUBNET_NAME" \
    --network="$VPC_NAME" --region="$REGION" --range="$SUBNET_RANGE" || true

  # Reserve a range + create the private connection Cloud SQL peers into.
  gc compute addresses create ut-sql-psa \
    --global --purpose=VPC_PEERING --prefix-length=20 --network="$VPC_NAME" || true
  gc services vpc-peerings connect \
    --service=servicenetworking.googleapis.com \
    --ranges=ut-sql-psa --network="$VPC_NAME" || true
}

sql(){
  log "Creating Cloud SQL Postgres 18 (HA, private IP)"
  gc sql instances create "$SQL_INSTANCE" \
    --database-version=POSTGRES_18 \
    --edition="$SQL_EDITION" \
    --tier="$SQL_TIER" \
    --region="$REGION" \
    --availability-type="$SQL_AVAIL" \
    --storage-type=SSD --storage-size=20GB --storage-auto-increase \
    --network="projects/$PROJECT_ID/global/networks/$VPC_NAME" \
    --no-assign-ip \
    --backup --backup-start-time=19:00 \
    --enable-point-in-time-recovery \
    --retained-backups-count=14 \
    --retained-transaction-log-days=7 \
    --maintenance-window-day=SUN --maintenance-window-hour=20 \
    --database-flags=cloudsql.iam_authentication=on || true

  log "Creating application database + role"
  gc sql databases create "$SQL_DB" --instance="$SQL_INSTANCE" || true
  # App role password comes from Secret Manager (set in secrets step / env).
  : "${DB_APP_PASSWORD:?export DB_APP_PASSWORD before running sql step}"
  gc sql users create "$SQL_APP_USER" --instance="$SQL_INSTANCE" \
    --password="$DB_APP_PASSWORD" || \
  gc sql users set-password "$SQL_APP_USER" --instance="$SQL_INSTANCE" \
    --password="$DB_APP_PASSWORD"
}

secrets(){
  log "Creating Secret Manager secrets"
  # Each secret's value is read from an env var of the same name. Fill them in
  # from deployments/gcp/secrets.example.env (do NOT commit real values).
  create_secret(){
    local name="$1" val="${!2:-}"
    [ -z "$val" ] && { echo "  skip $name (env $2 empty)"; return; }
    if gc secrets describe "$name" >/dev/null 2>&1; then
      printf '%s' "$val" | gc secrets versions add "$name" --data-file=- >/dev/null
      echo "  + new version: $name"
    else
      printf '%s' "$val" | gc secrets create "$name" --replication-policy=automatic --data-file=-
      echo "  created: $name"
    fi
  }
  create_secret DB_PASSWORD               DB_APP_PASSWORD
  create_secret UNIFIEDTREE_JWT_SECRET    UNIFIEDTREE_JWT_SECRET
  create_secret UNIFIEDTREE_FACE_ENCRYPTION_KEY UNIFIEDTREE_FACE_ENCRYPTION_KEY
  create_secret SMTP_PASS                 SMTP_PASS
  create_secret BREVO_API_KEY             BREVO_API_KEY
}

registry(){
  log "Creating Artifact Registry Docker repo"
  gc artifacts repositories create "$AR_REPO" \
    --repository-format=docker --location="$REGION" \
    --description="UnifiedTree container images" || true
}

iam(){
  log "Creating runtime + deployer service accounts (least privilege)"
  gc iam service-accounts create "$RUN_SA" \
    --display-name="Cloud Run runtime (UnifiedTree API)" || true
  gc iam service-accounts create "$DEPLOYER_SA" \
    --display-name="CI/CD deployer (GitHub Actions)" || true

  # Runtime SA: read secrets, connect Cloud SQL, write logs/metrics/traces.
  for role in \
    roles/secretmanager.secretAccessor \
    roles/cloudsql.client \
    roles/logging.logWriter \
    roles/monitoring.metricWriter \
    roles/cloudtrace.agent; do
    gc projects add-iam-policy-binding "$PROJECT_ID" \
      --member="serviceAccount:$RUN_SA_EMAIL" --role="$role" --condition=None >/dev/null
  done

  # Deployer SA: build images, push, deploy Cloud Run, act-as runtime SA.
  for role in \
    roles/run.admin \
    roles/cloudbuild.builds.editor \
    roles/artifactregistry.writer \
    roles/iam.serviceAccountUser; do
    gc projects add-iam-policy-binding "$PROJECT_ID" \
      --member="serviceAccount:$DEPLOYER_SA_EMAIL" --role="$role" --condition=None >/dev/null
  done
}

deploy(){
  log "Building image via Cloud Build (context = backend/, Dockerfile there)"
  gc builds submit ../../backend \
    --tag "$IMAGE:latest" \
    --gcs-log-dir="gs://${PROJECT_ID}_cloudbuild/logs" 2>/dev/null || \
  gc builds submit ../../backend --tag "$IMAGE:latest"

  log "Deploying Cloud Run service"
  gc run deploy "$RUN_SERVICE" \
    --image="$IMAGE:latest" \
    --region="$REGION" \
    --service-account="$RUN_SA_EMAIL" \
    --cpu="$RUN_CPU" --memory="$RUN_MEM" \
    --min-instances="$RUN_MIN_INSTANCES" --max-instances="$RUN_MAX_INSTANCES" \
    --concurrency="$RUN_CONCURRENCY" \
    --port=8080 \
    --timeout=120 \
    --no-allow-unauthenticated \
    --network="$VPC_NAME" --subnet="$SUBNET_NAME" --vpc-egress=private-ranges-only \
    --add-cloudsql-instances="$SQL_CONN" \
    --set-env-vars="SPRING_PROFILES_ACTIVE=canonical,canonical-prod,SPRING_FLYWAY_ENABLED=false,SPRING_BATCH_JDBC_INITIALIZE_SCHEMA=never,HRMS_KAFKA_ENABLED=false,JAVA_TOOL_OPTIONS=-Duser.timezone=UTC -XX:MaxRAMPercentage=75,DB_USERNAME=$SQL_APP_USER,DB_URL=jdbc:postgresql:///${SQL_DB}?cloudSqlInstance=${SQL_CONN}&socketFactory=com.google.cloud.sql.postgres.SocketFactory,UNIFIEDTREE_ALLOWED_ORIGIN_PATTERNS=https://*.unifiedtree.com,MAIL_PROVIDER=brevo,UNIFIEDTREE_FACE_WORKER_URL=https://ut-face-worker-xxxx.${REGION}.run.app" \
    --set-secrets="DB_PASSWORD=DB_PASSWORD:latest,UNIFIEDTREE_JWT_SECRET=UNIFIEDTREE_JWT_SECRET:latest,UNIFIEDTREE_FACE_ENCRYPTION_KEY=UNIFIEDTREE_FACE_ENCRYPTION_KEY:latest,SMTP_PASS=SMTP_PASS:latest,BREVO_API_KEY=BREVO_API_KEY:latest"

  # NOTE: the app requires the pgjdbc Cloud SQL SocketFactory on the classpath
  # (com.google.cloud.sql:postgres-socket-factory). See GCP_MIGRATION.md §"App
  # code changes for Cloud SQL". If you use Direct-VPC private IP instead, the
  # DB_URL is a plain jdbc:postgresql://<PRIVATE_IP>:5432/<db> and no socket
  # factory dependency is needed.
}

lb(){
  log "HTTPS Load Balancer + Cloud Armor (WAF, rate limiting) + managed cert"
  # Serverless NEG -> backend service -> URL map -> HTTPS proxy -> forwarding rule
  gc compute network-endpoint-groups create ut-run-neg \
    --region="$REGION" --network-endpoint-type=serverless \
    --cloud-run-service="$RUN_SERVICE" || true

  gc compute security-policies create ut-armor \
    --description="Rate-limit + WAF for the HRMS API" || true
  # Per-IP rate limit: 300 req/min, then 429 for 60s. Tune per real traffic.
  gc compute security-policies rules create 1000 \
    --security-policy=ut-armor \
    --expression="true" \
    --action=rate-based-ban --rate-limit-threshold-count=300 \
    --rate-limit-threshold-interval-sec=60 --ban-duration-sec=60 \
    --conform-action=allow --exceed-action=deny-429 \
    --enforce-on-key=IP || true

  gc compute backend-services create ut-run-backend \
    --global --load-balancing-scheme=EXTERNAL_MANAGED \
    --security-policy=ut-armor || true
  gc compute backend-services add-backend ut-run-backend \
    --global --network-endpoint-group=ut-run-neg \
    --network-endpoint-group-region="$REGION" || true

  gc compute url-maps create ut-url-map --default-service=ut-run-backend || true
  gc compute ssl-certificates create ut-api-cert \
    --domains="$API_DOMAIN" --global || true
  gc compute target-https-proxies create ut-https-proxy \
    --url-map=ut-url-map --ssl-certificates=ut-api-cert || true
  gc compute addresses create ut-api-ip --global || true
  gc compute forwarding-rules create ut-https-fr \
    --global --target-https-proxy=ut-https-proxy \
    --address=ut-api-ip --ports=443 --load-balancing-scheme=EXTERNAL_MANAGED || true

  log "Reserved public IP for DNS A-record:"
  gc compute addresses describe ut-api-ip --global --format='value(address)'
  echo "Point $API_DOMAIN A-record at the IP above. Managed cert provisions in ~15-60 min."
}

monitoring(){
  log "Uptime check + alert policy on the health endpoint"
  # Uptime check hits the public LB URL /api/actuator/health (expects 200 UP).
  gc monitoring uptime create ut-api-health \
    --resource-type=uptime-url \
    --resource-labels=host="$API_DOMAIN",project_id="$PROJECT_ID" \
    --path="/api/actuator/health" --port=443 --protocol=https \
    --period=1 --timeout=10 2>/dev/null || \
    echo "  (create the uptime check + alert policy in Cloud Monitoring UI; see MONITORING.md)"
}

all(){ apis; network; sql; secrets; registry; iam; deploy; lb; monitoring; }

"${1:-all}"
