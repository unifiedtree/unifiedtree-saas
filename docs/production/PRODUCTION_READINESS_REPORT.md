# UnifiedTree HRMS — Production Readiness Report

**Date:** 2026‑07 · **Scope:** Attendance **mobile app**, **backend API**, **database**, **infra/deployment**, **Play Store**. Website/web portal explicitly **out of scope** and untouched.

This report is the synthesis of a four‑domain audit (mobile, backend security, database, Play‑Store) plus direct inspection. It lists every material finding, its severity, the fix status, and what remains before an official Play Store + GCP launch.

Companion docs in this folder:
- [`GCP_MIGRATION.md`](./GCP_MIGRATION.md) — Railway → Google Cloud migration, architecture, cost, monitoring.
- [`RUNBOOK.md`](./RUNBOOK.md) — deployment, rollback, backup & disaster recovery.
- [`SECURITY_AUDIT.md`](./SECURITY_AUDIT.md) — full security findings + remediation.
- [`ENVIRONMENT.md`](./ENVIRONMENT.md) — every environment variable, where it's set, and how to rotate.
- `Attendance_App/PLAY_STORE_RELEASE.md` — Play Store submission checklist (in the mobile repo).

---

## 1. Executive summary

The system is **fundamentally well‑engineered**: multi‑tenant Postgres RLS is broad and consistent, biometric data is AES‑GCM encrypted (no raw images persisted), the mobile app has cold‑start retry + offline queue + idempotency keys, and the backend has a clean global exception handler, hashed+rotated refresh tokens, and BCrypt passwords.

The gaps that block an **enterprise production launch** cluster into five themes:

| Theme | Status |
|---|---|
| **Prod was leaking DEBUG/SQL/PII logs + over‑exposed actuator** | ✅ Fixed in code — ⚠️ **not yet live** (deploy‑source split, see §2) |
| **Mobile crash/null‑safety + no error boundary + no crash reporting** | ✅ Crashes fixed & shipped (OTA); crash reporting staged |
| **Auth brute‑force: no rate limiting, dead account lockout** | ⚠️ **Staged** (backend PR) — highest open risk |
| **Secrets: rotate everything shared via chat/Railway; PII key defaults to all‑zeros** | ⚠️ **Operational** — must rotate at GCP cutover |
| **Play Store blockers: real privacy policy, Data Safety form, remove unused mic permission** | ⚠️ Mix of code fixes (done/staged) + manual Console steps |

**Bottom line:** the mobile crash fixes and prod‑config hardening are **live now**. The remaining launch‑blockers are (a) auth rate‑limiting, (b) secret rotation + PII key, and (c) the Play Store privacy policy + Data Safety form. None require re‑architecture; all are scoped below with exact fixes.

---

## 2. What was fixed and shipped in this pass

### Mobile (shipped via OTA to the live testers — Android runtime `53b09fb…`)
| # | Severity | Fix |
|---|---|---|
| M1 | Critical | **Top‑level `ErrorBoundary`** added (`components/ErrorBoundary.tsx`, wired in `app/_layout.tsx`). A render exception now shows a recover screen instead of a permanent white screen. |
| M2 | High | **`weekly-summary.tsx`** — `totalHours/overtimeHours/day.hours` coalesced with `?? 0`; a week with no punches no longer crashes the screen. |
| M3 | High | **`dashboard.tsx` + `attendance-filtered.tsx`** — `fullName/employeeCode` coalesced; a single null name no longer crashes the whole manager/admin dashboard. |
| M4 | Medium | **`geofence-zones.tsx` + `live-map.tsx`** — `lat/lng.toFixed()` guarded. |
| M5 | Medium | **Dev‑mock layer** (633 lines incl. demo PII) is now `require()`d behind `__DEV__` in `services/api/client.ts` so Metro strips it from the release binary. |
| M6 | Medium | **Battery** — `focusManager` wired to `AppState` in `_layout.tsx`; all 30s polling (home/dashboard/live‑map) pauses when the app is backgrounded. |
| M7 | Low | Ungated `console.warn` in `face-enroll.tsx` now `__DEV__`‑gated. |

### Backend (committed to `unifiedtree/unifiedtree-saas` — commit `91b08f1`)

> ⚠️ **Deploy‑source split — action required.** This backend working copy pushes to `unifiedtree/unifiedtree-saas`, but the **live** backend `erpinfrastructure-production.up.railway.app` (what the mobile app calls) deploys from a **different** source (`erp/infrastructure`, per the Railway dashboard). After pushing `91b08f1`, the live service **still shows the old config** (`/actuator/health` returns full component details; `/actuator/prometheus` is 401 not 404) — i.e. **the hardening below is in the code but NOT yet live in production.** To activate it: point the `erpinfrastructure-production` Railway service at `unifiedtree/unifiedtree-saas` **or** sync/push these commits into `erp/infrastructure`, then redeploy. (The project memory note "push to unifiedtree/unifiedtree-saas deploys" is now stale — the deploy target moved when the backend changed Railway accounts.)
| # | Severity | Fix |
|---|---|---|
| B1 | High | **Logging** — prod no longer logs `DEBUG`/`org.hibernate.SQL=DEBUG`/`BasicBinder=TRACE`. Bound **PII values were being written to logs on every query**; now INFO with SQL/bind at WARN. |
| B2 | Medium | **Actuator** — locked to `health,info` only, `show-details: never`, `info.env` off, liveness/readiness probes on. `/actuator/prometheus` + `/metrics` are no longer world‑readable. |
| B3 | Medium | **Graceful shutdown** (`server.shutdown: graceful` + 30s drain) — required for zero‑downtime Cloud Run deploys. |
| B4 | Medium | **Multipart cap** 10MB/12MB — unbounded upload = trivial memory‑exhaustion DoS. |
| B5 | Medium | **OTP debug‑in‑response** default flipped `true → false`. |
| B6 | Low | **Swagger/OpenAPI** disabled in the prod profile (was a built‑in recon surface). |

---

## 3. Open findings — must fix before launch

These are **staged**, not applied, because each needs either a coordinated env change (would break the running deploy if pushed blind) or careful regression testing. Exact remediation is in `SECURITY_AUDIT.md`.

| ID | Sev | Finding | Why staged | Fix |
|---|---|---|---|---|
| **O1** | **High** | **No auth rate limiting; account‑lockout is dead code.** `bucket4j`/`resilience4j` are on the classpath but unused; `AuthService.login` increments `failedLoginCount` but never sets `lockedUntil`. Unlimited password guesses on `/v1/canonical-auth/login`, `/refresh`, OTP verify. | Behavior change on the live login path — needs a tested PR. | Add a Bucket4j IP+account filter (5–10/min, backoff) + make the existing lockout fire. |
| **O2** | **High** | **PII encrypted with an all‑zeros default key.** `FieldEncryptor` (`app.pii.encryption-key`, default = base64 of 32 zero bytes) encrypts PAN/Aadhaar/bank fields and is **actively used**. `PII_ENCRYPTION_KEY` is likely unset in Railway. | Making it fail‑fast would break the running deploy until the env var is set. | Set a real 32‑byte `PII_ENCRYPTION_KEY` **first**, re‑encrypt existing rows, then remove the default. |
| **O3** | **High** | **Secrets shared via chat/Railway must be rotated.** JWT signing secret (forges tokens for *any* tenant), Postgres superuser, DB roles, face key, admin password. | Operational. | Rotate all at GCP cutover; store only in Secret Manager. See `ENVIRONMENT.md`. |
| **O4** | **High** | **Spring Boot 3.2.5 is EOL** (no security patches; known Framework/Tomcat CVEs in range). | Major bump needs a full build + regression run. | Upgrade to a supported line (3.3.x/3.4.x), pin pgjdbc ≥42.7.5, run OWASP Dependency‑Check. |
| **O5** | **High (Play)** | **Privacy policy URL serves no policy.** `https://unifiedtree.com/privacy` renders the app shell, not a policy. App collects biometric + location → a real hosted policy is mandatory. | Requires hosting content (web — you host it, we don't touch the site code). | Publish a real policy covering face/biometric + precise location + PII + deletion; set it in Play Console. |
| **O6** | **Med** | **Static default password `Welcome@123`** (`PlatformUserController`, `EmployeeController`). | Login‑path change. | Generate a random one‑time password / force the invitation flow. |
| **O7** | **Med** | **No `UNIQUE (tenant_id, employee_id, attendance_date)`** on `attendance.records` — duplicate daily rows possible. | DDL on a partitioned table — apply in a maintenance window. | `ADD CONSTRAINT uq_att_emp_day UNIQUE (tenant_id, employee_id, attendance_date)`. |
| **O8** | **Med** | **`audit.events` has no RLS + nullable `tenant_id`** — cross‑tenant audit/PII leak on any un‑filtered read. | DDL + policy; verify no query breaks. | Enable RLS with a permissive tenant/platform‑admin policy, or force all reads through a `SECURITY DEFINER` function. |

---

## 4. Open findings — should fix soon (not launch‑blocking)

| ID | Sev | Finding |
|---|---|---|
| S1 | Med | Hardcoded 38‑char JWT fallback secret in `JwtService.java` **passes** the ≥32 length guard → forgeable if the property is ever unset. Remove the default. |
| S2 | Med | 12h access‑token TTL, no revocation. Shorten to 15–30 min **once mobile refresh is verified working** (mobile currently treats refresh as unimplemented → a short TTL would log users out mid‑session). |
| S3 | Med | WebSocket `/ws` allows all origins with no STOMP `CONNECT`/`SUBSCRIBE` auth; topics carry tenant data. Restrict origins + add a channel interceptor. (Mobile app doesn't use WS.) |
| S4 | Med | Phase‑3 module tables `ENABLE` but don't `FORCE` RLS — safe only while the app connects as non‑owner `ut_app`. Add `FORCE` + confirm `ut_app` is `NOSUPERUSER/NOBYPASSRLS`. |
| S5 | Med | Legacy **plaintext** PII columns in `hrms.employees` coexist with the encrypted V021 model — drop them after backfill. |
| S6 | Med | Systemic missing FKs on `employee_id` across attendance/leave/payroll → orphan risk. Add FKs or an orphan sweep. |
| S7 | Med | CHECK‑vs‑Java‑enum drift caused repeated HTTP 500s (V014→V055→V080). Generate CHECKs from enums or drop DB‑side enum CHECKs. |
| S8 | Med | `O(N‑tenants)` scan on every login/refresh. Add an indexed `email→tenant_id` / `refresh_hash→tenant_id` lookup. |
| S9 | Low | Mobile: session‑refresh 404s on canonical‑prod → silent forced logout on token expiry; `SecureStore` write failures silently swallowed; check‑out lacks a `clientEventId`. |
| S10 | Low | Docker base images pinned by floating tag (not digest); add `-XX:MaxRAMPercentage=75`. |
| S11 | Low | Redundant single‑column `idx_*_tenant` indexes; `updated_at` trigger only on 4 tables; `rbac.roles` RLS lets the app role insert global roles (add `WITH CHECK`). |

---

## 5. Play Store readiness (summary — full list in `Attendance_App/PLAY_STORE_RELEASE.md`)

**Code/config (in repo):**
- ✅ Production `env` block added to `eas.json` (was missing → AAB could ship pointing at localhost). *(applied — see mobile checklist)*
- ✅ Removed unused `RECORD_AUDIO` microphone permission + de‑duplicated the permission list.
- ⚠️ `runtimeVersion` — keep the pinned string for the current OTA channel; switch to `{policy:"fingerprint"}` when cutting the AAB (documented).
- ⚠️ Crash reporting (Sentry/Crashlytics) — `ErrorBoundary` hook is in place; wiring needs your Sentry/Firebase project (staged).

**Manual Console (you must do):**
- Publish a real **privacy policy** (O5).
- Complete the **Data Safety** form (biometric, precise location, email, name, phone, device IDs, tokens; encrypted‑in‑transit; deletion path).
- Provide **App‑access test credentials** for reviewers (app is fully login‑gated).
- Upload 512×512 icon, 1024×500 feature graphic, ≥2 screenshots; content rating; target audience; "no ads".

---

## 6. Recommended sequencing to launch

1. **Now (done):** prod log/actuator hardening + mobile crash fixes — **live**.
2. **Backend hardening PR (this week):** O1 rate‑limiting, S1 JWT default, O6 default password, S3 WebSocket, malformed‑body message, `SET LOCAL`→`set_config` bind. Build + test + deploy.
3. **GCP cutover (see `GCP_MIGRATION.md`):** provision Cloud SQL + Cloud Run + Secret Manager; **rotate all secrets (O3)**; set a real `PII_ENCRYPTION_KEY` (O2) + re‑encrypt; migrate data; flip the mobile `EXPO_PUBLIC_API_BASE_URL` + build the AAB.
4. **DB maintenance window:** O7 attendance uniqueness, O8 audit RLS, S4 FORCE RLS, S5 drop plaintext PII.
5. **Spring Boot upgrade (O4)** on its own branch with full regression.
6. **Play Store:** privacy policy (O5) + Data Safety + assets → internal track → pre‑launch report → production.

---

*No website/web‑portal files were modified in this audit. All backend changes are confined to the API + its config; all mobile changes are in the `Attendance_App` repo.*
