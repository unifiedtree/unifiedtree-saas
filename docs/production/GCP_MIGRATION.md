# Railway → Google Cloud Migration Guide

Migrates the UnifiedTree HRMS **backend + database** from Railway to Google Cloud, on a **paid (Blaze) production tier**. Covers architecture, provisioning, data migration, app changes, cutover, rollback, cost, and observability.

> Scope: backend API + Postgres + face worker. **The website/web portal is not part of this migration** and is untouched. The mobile app changes only its `EXPO_PUBLIC_API_BASE_URL`.

Provisioning artifacts referenced here live in [`deployments/gcp/`](../../deployments/gcp/): `provision.sh`, `secrets.example.env`.

---

## 1. Target architecture

```
                         ┌──────────────────────────────────────────────┐
   Play Store app ──────▶│  Global External HTTPS LB  +  Cloud Armor     │  api.unifiedtree.com
   (mobile)              │  (managed TLS cert, WAF, per-IP rate limit)   │
                         └───────────────┬──────────────────────────────┘
                                         │ Serverless NEG
                         ┌───────────────▼──────────────┐
                         │  Cloud Run (2nd gen)          │  unifiedtree-saas
                         │  Spring Boot API, min=1        │  runtime SA (least priv)
                         │  Direct VPC egress             │
                         └───┬───────────────────────┬───┘
             private IP      │                       │ HTTPS
                         ┌───▼─────────────┐   ┌──────▼───────────────┐
                         │ Cloud SQL (PG18)│   │ Cloud Run: face-worker│  Python ONNX
                         │ HA regional      │   │ (min=0, scale to zero)│
                         │ private IP       │   └───────────────────────┘
                         └──────────────────┘
   Secret Manager  ─────▶ DB pwd, JWT, face key, PII key, SMTP, Brevo  (mounted as env)
   Artifact Registry ──▶ Docker images
   Cloud Logging / Monitoring / Error Reporting / Uptime  ──▶ dashboards + alerts
```

### Why these services (justification)

| Concern | Choice | Why |
|---|---|---|
| **Compute** | **Cloud Run (2nd gen)** | Single stateless Spring Boot HTTP container. Attendance traffic is bursty (9am/6pm punch spikes) → request‑based autoscaling is ideal. Zero server ops, built‑in TLS + revisions + traffic splitting for canary/rollback. **GKE** is rejected (no service mesh / multi‑service need; k8s ops burden). **Compute Engine** rejected (manual patching/scaling). |
| **Database** | **Cloud SQL for PostgreSQL 18, Enterprise, REGIONAL (HA)** | You're already on PG18. Managed backups, PITR, automatic failover to a synchronous standby, private IP. `Enterprise Plus` is the upgrade path for sub‑second failover + more cache if load demands. |
| **DB connectivity** | **Private IP + Direct VPC egress** (or Cloud SQL connector) | Keeps DB off the public internet. `provision.sh` uses the Cloud SQL socket‑factory form; a plain private‑IP JDBC URL also works (see §4). |
| **Secrets** | **Secret Manager** | Versioned, IAM‑scoped, mounted into Cloud Run as env vars. No secrets in images or env files. |
| **Images** | **Artifact Registry** | Regional Docker registry; Cloud Build pushes here. |
| **Object storage** | **Not required for faces** | Face **embeddings** are AES‑GCM encrypted **BYTEA in Postgres**; raw images are never persisted (7‑day ephemeral). Only add **Cloud Storage** if you move letter PDFs / employee documents off local disk (recommended — see §7). |
| **Edge** | **HTTPS LB + Cloud Armor** | Managed TLS, WAF rules, and **per‑IP rate limiting** (directly mitigates the open auth brute‑force finding O1 as defense‑in‑depth), plus DDoS protection. |
| **Region** | **asia‑south1 (Mumbai)** | Closest to the India user base → lowest latency. Cloud SQL HA standby stays in‑region. |

---

## 2. Prerequisites

- A GCP project on **billing (Blaze)**, e.g. `unifiedtree-prod`.
- `gcloud` CLI authenticated as Owner/Editor: `gcloud auth login && gcloud config set project unifiedtree-prod`.
- The existing (source) Railway Postgres connection string for the data migration.
- Fresh secret values generated (do **not** reuse anything shared over chat/WhatsApp — see O3):
  ```bash
  openssl rand -base64 48   # UNIFIEDTREE_JWT_SECRET
  openssl rand -base64 32   # UNIFIEDTREE_FACE_ENCRYPTION_KEY
  openssl rand -base64 32   # PII_ENCRYPTION_KEY   (NEW — see O2)
  openssl rand -base64 24   # DB_APP_PASSWORD (ut_app)
  ```

---

## 3. Provision the infrastructure

Fill the variables at the top of [`deployments/gcp/provision.sh`](../../deployments/gcp/provision.sh), then:

```bash
cd deployments/gcp
cp secrets.example.env secrets.env      # fill REAL values (git-ignored)
set -a; source secrets.env; set +a

./provision.sh apis        # enable APIs
./provision.sh network     # VPC + private services access (Cloud SQL peering)
./provision.sh sql         # Cloud SQL PG18, HA, private IP, PITR, 14-day backups
./provision.sh secrets     # push secrets to Secret Manager
./provision.sh registry    # Artifact Registry docker repo
./provision.sh iam         # runtime + deployer service accounts (least privilege)
# --- data migration happens here (section 5) BEFORE deploying ---
./provision.sh deploy      # Cloud Build image + Cloud Run deploy
./provision.sh lb          # HTTPS LB + Cloud Armor + managed cert
./provision.sh monitoring  # uptime check + alerts
```

The script is **idempotent** — safe to re‑run. IAM is least‑privilege: the runtime SA gets only `secretAccessor`, `cloudsql.client`, and log/metric/trace writers; the deployer SA gets build/deploy/artifact/actAs.

---

## 4. App code change required for Cloud SQL

Cloud Run reaches Cloud SQL either way:

- **Private IP (simplest, recommended):** set `DB_URL=jdbc:postgresql://<PRIVATE_IP>:5432/railway` and deploy with `--network/--subnet/--vpc-egress=private-ranges-only`. **No code change.**
- **Cloud SQL socket factory** (what `provision.sh deploy` shows): add the connector to `app/hrms-app/pom.xml`:
  ```xml
  <dependency>
    <groupId>com.google.cloud.sql</groupId>
    <artifactId>postgres-socket-factory</artifactId>
    <version>1.20.1</version>
  </dependency>
  ```
  and `DB_URL=jdbc:postgresql:///railway?cloudSqlInstance=<CONN>&socketFactory=com.google.cloud.sql.postgres.SocketFactory`.

**Recommendation:** use **private IP** — no new dependency, and it keeps the JDBC config identical to today. The Hikari pool (`DB_POOL_SIZE`), `ddl-auto: validate`, and `SPRING_FLYWAY_ENABLED=false` all carry over unchanged.

---

## 5. Data migration (Railway → Cloud SQL)

The proven procedure (already used once for the Railway→Railway move) with `pg_dump`/`psql` **version‑matched to Postgres 18**:

```bash
# 1. Roles/globals from the source superuser (captures ut_app / ut_migrator / hrms_app)
pg_dumpall -h <SRC_HOST> -p <SRC_PORT> -U postgres --globals-only > globals.sql

# 2. Full DB dump as the source superuser (RLS-bypassing → real rows)
pg_dump -h <SRC_HOST> -p <SRC_PORT> -U postgres -d railway \
        --format=plain --no-comments --file=full.sql

# 3. On Cloud SQL: create the app roles first (ut_app with the NEW password),
#    then restore. Connect via the Cloud SQL Auth Proxy:
cloud-sql-proxy <PROJECT>:<REGION>:ut-postgres &
psql "host=127.0.0.1 dbname=railway user=postgres" -v ON_ERROR_STOP=1 -f roles-init.sql
psql "host=127.0.0.1 dbname=railway user=postgres" -v ON_ERROR_STOP=1 --single-transaction -f full.sql
```

**Verification (do all three — this is a production cutover):**
1. **Row counts** per table must match source exactly.
2. **Object counts** — tables / indexes / RLS policies / functions / triggers / constraints must match.
3. **Per‑table content hash** (`md5(string_agg(md5(t.*::text) ORDER BY …))`) must match on every table.
4. `ut_app` can log in with the new password and RLS returns rows under a set tenant context.

Because **Flyway is disabled**, apply any migrations newer than the dump **manually** on the target (same as today), then re‑verify.

> The exact verification SQL and a worked example are in `RUNBOOK.md §"DB migration verification"`.

### Re‑encrypt PII with the new key (O2)
The `*_encrypted` PII columns were encrypted with `PII_ENCRYPTION_KEY`. If the source ran with the insecure all‑zeros default, you must **decrypt‑with‑old‑key / re‑encrypt‑with‑new‑key** during migration (a one‑off script) so the data is protected by the real key going forward. If the source already used a real key, just carry it into Secret Manager.

---

## 6. Cutover

1. Provision + migrate + verify (above) while Railway keeps serving — **zero downtime so far**.
2. Deploy the backend to Cloud Run; smoke‑test against `https://<run-url>/api/actuator/health` (expect `{"status":"UP"}`).
3. Point `api.unifiedtree.com` DNS at the LB IP (`provision.sh lb` prints it). Managed cert provisions in ~15–60 min.
4. Smoke‑test the full login + punch flow through the custom domain.
5. **Flip the mobile app:** set `EXPO_PUBLIC_API_BASE_URL=https://api.unifiedtree.com` in `eas.json` (all build profiles) and `.env`, then `eas update --branch production --clear-cache` (JS‑only) — existing installs move over on next reopen. Rebuild the AAB for the store with the same URL.
6. Keep Railway running for **48–72h** as a hot rollback, then decommission.

---

## 7. Object storage (optional but recommended)

`LetterStorageService` writes letter PDFs to **local disk** (`basePath/<tenant>/<letter>.pdf`). On Cloud Run that filesystem is **ephemeral** — PDFs vanish on every new revision. Before relying on letter generation in production, move it to **Cloud Storage**:
- Create a bucket `gs://unifiedtree-prod-letters` (uniform access, private).
- Grant the runtime SA `roles/storage.objectAdmin` on the bucket.
- Swap `LetterStorageService` to the GCS client (store/`load` by object path; keep the tenant/UUID key scheme).
- Employee document uploads (`employee_documents.file_url`) — same treatment.

---

## 8. Cost optimization (Blaze tier)

| Component | Config | Approx. monthly (asia‑south1) | Notes |
|---|---|---|---|
| Cloud Run API | 2 vCPU / 1 GiB, min=1, max=10 | ~$45–70 (min‑instance) + per‑request | `min=1` avoids cold starts. Drop to `min=0` for a staging service. |
| Cloud SQL | db‑custom‑2‑7680, REGIONAL HA, 20 GB SSD | ~$180–260 | HA doubles compute. Start `db-custom-1-3840` if load is light; enable **committed‑use discounts** (1‑yr) for ~25–52% off. |
| Cloud Run face‑worker | min=0 (scale to zero) | ~$0–15 | Pays only per verify; cold start acceptable (mobile tolerates 12s). |
| HTTPS LB + Cloud Armor | 1 forwarding rule + WAF | ~$18 + $5/policy + traffic | Flat + egress. |
| Secret Manager / Artifact Registry / Logging | low volume | ~$5–15 | Set a **Logging retention** of 30 days and a **log exclusion** for health‑check spam to cut cost. |
| **Estimated total** | | **~$250–370/mo** | Right‑size Cloud SQL after 2 weeks of real metrics; that's the biggest lever. |

**Levers:** committed‑use discounts on Cloud SQL + Cloud Run; `min=0` on non‑prod; a log‑exclusion filter for `/actuator/health`; `--cpu-throttling` on Cloud Run (default) so you pay CPU only during requests; right‑size the DB tier from metrics.

---

## 9. Monitoring, logging & alerting

- **Cloud Logging:** Cloud Run ships stdout/stderr automatically. Structured JSON logs improve searchability — add a `logback-spring.xml` with a JSON encoder under the prod profile (the app already logs at INFO). Add a **log‑based metric** for `ERROR`‑level entries.
- **Error Reporting:** automatically groups stack traces from the logs — zero setup; watch the dashboard post‑launch.
- **Cloud Monitoring dashboards:** Cloud Run request count / p95 latency / instance count / container memory; Cloud SQL CPU / connections / disk / replication lag.
- **Uptime check:** HTTPS GET `api.unifiedtree.com/api/actuator/health` every 60s (in `provision.sh monitoring`).
- **Alert policies (recommended):**
  - Uptime check failing ≥2 checks → page.
  - Cloud Run 5xx rate > 2% (5 min) → page.
  - Cloud Run p95 latency > 3s (10 min) → warn.
  - Cloud SQL CPU > 80% (15 min) or disk > 85% → warn.
  - Cloud SQL replication lag > 10s → warn.
  - Secret Manager access denied spike → warn (possible misconfig/attack).
- **Prometheus (optional):** the app exposes `/actuator/prometheus`, but it is **not** publicly reachable in prod (locked to `health,info`). To scrape it, expose it on a **separate management port bound to the VPC** and use Google Managed Prometheus — never on the public ingress.

---

## 10. Migration checklist

- [ ] Project + billing + `gcloud` ready; secrets freshly generated.
- [ ] `provision.sh apis / network / sql / secrets / registry / iam`.
- [ ] Data migrated + **all four verifications pass**; newer migrations applied manually; PII re‑encrypted with the new key.
- [ ] `provision.sh deploy`; `/api/actuator/health` = UP; login + punch smoke test on the run URL.
- [ ] `provision.sh lb`; DNS A‑record → LB IP; managed cert ACTIVE; smoke test on `api.unifiedtree.com`.
- [ ] `provision.sh monitoring`; alert policies created.
- [ ] Mobile `EXPO_PUBLIC_API_BASE_URL` → `api.unifiedtree.com`; `eas update` + AAB rebuild.
- [ ] Railway kept 48–72h as rollback, then decommissioned; secrets deleted from Railway.
