# Production Runbook — Deploy · Rollback · Backup · Disaster Recovery

Operational procedures for the UnifiedTree HRMS backend + database on Google Cloud (Cloud Run + Cloud SQL). Website is out of scope.

---

## 1. Deployment (zero‑downtime)

The backend builds from `backend/Dockerfile` (multi‑stage, non‑root JRE). Cloud Run deploys are **revision‑based** — a new revision receives traffic only after it passes its startup probe, and the old revision keeps serving until then, so deploys are inherently zero‑downtime.

### 1a. CI/CD (recommended) — GitHub Actions → Cloud Run
Use Workload Identity Federation (no long‑lived keys). A ready workflow is provided at `.github/workflows/gcp-backend-deploy.yml` (see below). On push to `main` affecting `backend/**`:
1. Cloud Build builds + pushes the image to Artifact Registry (tagged with the commit SHA).
2. `gcloud run deploy` rolls out a new revision.
3. Startup probe hits `/api/actuator/health/readiness`; traffic shifts only on success.

### 1b. Manual deploy
```bash
cd deployments/gcp
./provision.sh deploy        # builds + deploys latest
# or a specific image:
gcloud run deploy unifiedtree-saas --image <AR>/hrms-backend:<sha> --region asia-south1
```

### 1c. Health / readiness / liveness probes
The prod profile enables Spring Boot probes:
- **Readiness:** `/api/actuator/health/readiness` — Cloud Run startup probe. Fails while the DB pool is warming → traffic held back.
- **Liveness:** `/api/actuator/health/liveness` — restart signal.
- **Overall:** `/api/actuator/health` — uptime check (returns `{"status":"UP"}`).

Graceful shutdown is on (`server.shutdown: graceful`, 30s drain) so in‑flight punches/payroll finish before the old revision stops.

### 1d. Canary (optional)
```bash
gcloud run deploy unifiedtree-saas --image <new> --no-traffic --tag canary
gcloud run services update-traffic unifiedtree-saas --to-tags canary=10   # 10% canary
# watch metrics, then:
gcloud run services update-traffic unifiedtree-saas --to-latest            # 100%
```

---

## 2. Rollback

Cloud Run keeps every revision. Rollback is instant traffic re‑pointing — **no rebuild**.

```bash
gcloud run revisions list --service unifiedtree-saas --region asia-south1
gcloud run services update-traffic unifiedtree-saas \
    --to-revisions <PREVIOUS_REVISION>=100 --region asia-south1
```

**Rollback decision guide:**
| Symptom | Action |
|---|---|
| 5xx spike / health failing after deploy | Re‑point traffic to previous revision (above). < 30s. |
| Bad DB migration | See §4 DB rollback — restore from PITR/snapshot. |
| Bad env/secret | Fix the Secret Manager version or env var, redeploy (new revision). |
| Mobile OTA regression | `eas update --branch production` with the fix, or roll the update group back in the EAS dashboard. |

**Config/secret rollback:** Secret Manager keeps versions — pin the previous version in the Cloud Run env mapping and redeploy.

---

## 3. Backups

### Database (Cloud SQL)
Provisioned by `provision.sh sql`:
- **Automated daily backups** at 19:00, **14 retained**.
- **Point‑in‑Time Recovery (PITR)** on, **7 days** of transaction logs → restore to any second in the last week.
- **HA regional** → a synchronous standby in another zone; automatic failover.

**On‑demand backup before risky changes:**
```bash
gcloud sql backups create --instance ut-postgres
```

**Logical export (offsite, for portability / long‑term):**
```bash
gcloud sql export sql ut-postgres gs://unifiedtree-prod-backups/$(date +%F).sql.gz \
    --database=railway
```
Schedule this weekly via Cloud Scheduler → a small Cloud Run job, and set a **bucket lifecycle** to expire after 90 days. Keep the bucket in a **different region** than the DB for geo‑redundancy.

### Secrets
Secret Manager versions are retained. Additionally keep an **encrypted, offline copy** of the current secret set (password manager / KMS‑wrapped) so a project‑level loss is recoverable.

### Application config
Everything is in git (`unifiedtree/unifiedtree-saas`). The `provision.sh` script + `deployments/gcp/` reproduce the whole environment.

---

## 4. Disaster Recovery

**Objectives:** RPO ≤ 5 min (PITR), RTO ≤ 30 min (managed restore + redeploy).

### 4a. Cloud SQL data loss / corruption
```bash
# Restore to a point in time (creates a new instance)
gcloud sql instances clone ut-postgres ut-postgres-restored \
    --point-in-time '2026-07-01T09:15:00Z'
# Verify data, then repoint the app's DB_URL to the restored instance and redeploy.
```
Or restore a specific backup: `gcloud sql backups restore <BACKUP_ID> --restore-instance ut-postgres`.

### 4b. Zone failure
HA regional Cloud SQL fails over automatically to the standby. Cloud Run is regional/multi‑zone by default. No action for a single‑zone outage.

### 4c. Region failure (rare)
1. Restore the latest **cross‑region logical export** into a Cloud SQL instance in a backup region.
2. `provision.sh deploy` the backend to Cloud Run in that region.
3. Repoint DNS to the new LB.
(Keep the `deployments/gcp/` scripts + a recent export in a second region so this is a scripted, ~30‑min operation.)

### 4d. Full project loss
Everything is reproducible: infra from `provision.sh`, secrets from the offline copy, data from the offsite export. Re‑run provisioning in a new project and restore.

### 4e. Compromised secret
Rotate immediately (`ENVIRONMENT.md §rotation`): new Secret Manager version → redeploy. For the **JWT secret**, rotating invalidates all existing tokens (all users re‑login) — that's the correct response to a suspected leak.

---

## 5. DB migration verification (used at every DB cutover)

Because Flyway is disabled and migrations are applied manually, **always verify** after a data move or manual migration:

```sql
-- Row counts per table (run on source and target, diff the outputs)
SELECT format('%I.%I', schemaname, tablename) AS tbl,
       (xpath('/row/c/text()', query_to_xml(
          format('SELECT COUNT(*) c FROM %I.%I', schemaname, tablename), true,true,'')))[1]::text::bigint AS rows
FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY 1;

-- Object counts (must match)
SELECT (SELECT COUNT(*) FROM pg_tables  WHERE schemaname NOT IN ('pg_catalog','information_schema')) tables,
       (SELECT COUNT(*) FROM pg_indexes WHERE schemaname NOT IN ('pg_catalog','information_schema')) indexes,
       (SELECT COUNT(*) FROM pg_policy) policies,
       (SELECT COUNT(*) FROM pg_constraint
          WHERE connamespace NOT IN ('pg_catalog'::regnamespace,'information_schema'::regnamespace)) constraints;

-- Per-table content hash (strongest check; diff source vs target)
-- md5 over md5(row) sorted, per table — any 1-byte drift changes the hash.
```
Then confirm `ut_app` logs in with the expected password and RLS returns rows under a set tenant. Only cut over when **row counts + object counts + content hashes all match**.

---

## 6. Incident response quick reference

| Alert | First checks | Likely fix |
|---|---|---|
| Uptime check down | Cloud Run logs (Error Reporting), revision health, Cloud SQL up? | Rollback revision (§2) or restore DB (§4a). |
| 5xx spike | Recent deploy? recent migration? | Rollback revision / revert migration. |
| High latency | Cloud SQL CPU/connections; Hikari pool exhaustion | Scale DB tier / raise `DB_POOL_SIZE`; check the O8 per‑login tenant scan. |
| DB disk > 85% | storage‑auto‑increase should handle it | confirm autoresize on; investigate growth (audit.events partitions). |
| Auth brute‑force (many 401s from an IP) | Cloud Armor logs | Cloud Armor rate‑limit already bans; add an explicit deny rule if needed. Fix O1. |

---

*All commands assume `asia-south1` and instance/service names from `deployments/gcp/provision.sh`. Adjust if you changed them.*
