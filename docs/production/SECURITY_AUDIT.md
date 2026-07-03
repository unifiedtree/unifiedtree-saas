# Security Audit Report — UnifiedTree HRMS

Scope: backend API + database + mobile app. Website excluded. Frameworks referenced: **OWASP API Security Top 10 (2023)**, **OWASP Mobile Top 10 (2024)**, **OWASP ASVS**.

Legend: ✅ fixed & deployed · 🟡 staged (exact fix below) · 🔧 operational (env/console).

---

## 1. Summary by severity

| Sev | Count | Items |
|---|---|---|
| Critical | 0 open | (mobile white‑screen + PII‑in‑logs were Critical‑adjacent; **fixed**) |
| High | 6 | Auth brute‑force (O1), PII zero‑key (O2), secret rotation (O3), Spring Boot EOL (O4), privacy policy (O5), no mobile crash reporting |
| Medium | ~10 | default password, attendance uniqueness, audit RLS, JWT fallback, token TTL, WebSocket auth, FORCE RLS, plaintext PII, enum drift, tenant scan |
| Low | ~10 | see §4 |

**Already fixed & deployed this pass:** PII‑in‑logs (DEBUG/SQL/bind), actuator over‑exposure, OTP‑in‑response default, Swagger in prod, unbounded uploads, missing graceful shutdown, mobile null‑safety crashes, missing error boundary, dev‑mock PII in release binary, unused microphone permission.

---

## 2. OWASP API Security Top 10 (2023) mapping

| # | Risk | Status |
|---|---|---|
| API1 Broken Object Level Auth | **Strong.** Postgres RLS enforces tenant isolation on every query; tenant comes only from the signed JWT in prod. Gaps: `audit.events` has no RLS (🟡 O8), phase‑3 tables don't `FORCE` RLS (🟡 S4). |
| API2 Broken Authentication | **Open.** No rate limiting + dead lockout (🟡 O1); hardcoded JWT fallback that passes the length guard (🟡 S1); 12h non‑revocable tokens (🟡 S2); static `Welcome@123` (🟡 O6). BCrypt + hashed/rotated refresh tokens are good. |
| API3 Broken Object Property Level Auth | OK — DTOs/MapStruct control exposed fields. |
| API4 Unrestricted Resource Consumption | Partially fixed — multipart bounded ✅; **no rate limiting** 🟡 O1; O(N‑tenants) login scan 🟡 S8. |
| API5 Broken Function Level Auth | **Strong** — `@EnableMethodSecurity` + `@PreAuthorize` per endpoint, permission‑based RBAC. |
| API6 Sensitive Business Flow | Geofence enforced server‑side; face verify server‑side. OK. |
| API7 SSRF | Low — only the fixed face‑worker URL is called. |
| API8 Security Misconfiguration | **Mostly fixed** — actuator locked ✅, Swagger off ✅, CORS fail‑safe (narrow `*.vercel.app` 🟡 S‑CORS), WebSocket `*` origins 🟡 S3. |
| API9 Improper Inventory Mgmt | Swagger disabled in prod ✅; keep staging separate. |
| API10 Unsafe Consumption of 3rd‑party APIs | Brevo/SMTP over TLS; face worker over HTTPS. OK. |

## 3. OWASP Mobile Top 10 (2024) mapping

| # | Risk | Status |
|---|---|---|
| M1 Improper Credential Usage | Tokens in `expo-secure-store` (Keystore/Keychain) ✅. SecureStore write failure silently swallowed 🟡 S9. |
| M2 Inadequate Supply Chain | EAS‑managed signing; keep the upload keystore backed up. |
| M3 Insecure Auth/Authz | Biometric gate + JWT ✅. Session‑expiry UX rough 🟡 S9. |
| M4 Insufficient Input/Output Validation | Null‑safety crashes **fixed** ✅. |
| M5 Insecure Communication | HTTPS only; no cleartext ✅ (once prod URL is HTTPS — it is). |
| M6 Inadequate Privacy Controls | Biometric + location → **needs privacy policy + Data Safety** 🔧 O5. |
| M7 Insufficient Binary Protection | Hermes bytecode ✅; optional R8/ProGuard via `expo-build-properties`. |
| M8 Security Misconfiguration | Dev‑mock PII stripped from release ✅; unused mic permission removed ✅. |
| M9 Insecure Data Storage | No PII in AsyncStorage; only tokens in SecureStore ✅. |
| M10 Insufficient Cryptography | Face embeddings AES‑GCM server‑side ✅. |

---

## 4. Staged fixes — exact remediation

### 🟡 O1 — Auth rate limiting + revive account lockout (HIGH)
Bucket4j is already a dependency. Add a filter on the auth routes:
```java
// shared-security: RateLimitFilter registered before the auth endpoints
Bandwidth limit = Bandwidth.classic(10, Refill.greedy(10, Duration.ofMinutes(1)));
// key = clientIp + ":" + emailOrPhone ; on exceed -> 429 with Retry-After
```
And make the **existing** lockout fire in `platform/platform-rbac/.../AuthService.login` — after incrementing `failedLoginCount`, set `lockedUntil = now + 15min` once it crosses a threshold (e.g. 8), so the check at the top of `login()` actually blocks. Add **Cloud Armor** per‑IP rate limiting at the edge as defense‑in‑depth (already in `provision.sh lb`).

### 🟡 O2 — Remove all‑zeros PII key default (HIGH)
`shared/hrms-core/.../crypto/FieldEncryptor.java`:
```java
// BEFORE: @Value("${app.pii.encryption-key}") default resolves to 32 zero bytes
// AFTER:  no default; fail fast on blank/placeholder (mirror the face key check)
@Value("${app.pii.encryption-key:}") String keyB64;
@PostConstruct void check() {
  if (keyB64.isBlank() || isAllZero(decode(keyB64)))
    throw new IllegalStateException("PII_ENCRYPTION_KEY must be set to a real 32-byte key");
}
```
**Order of operations:** set a real `PII_ENCRYPTION_KEY` in the environment and **re‑encrypt existing rows** *before* deploying this, or the app will refuse to start.

### 🟡 S1 — Remove hardcoded JWT fallback (MEDIUM)
`platform/platform-rbac/.../auth/service/JwtService.java`: change `@Value("${unifiedtree.jwt.secret:change-me-…}")` → `@Value("${unifiedtree.jwt.secret}")` and reject known placeholders. Prod already supplies `UNIFIEDTREE_JWT_SECRET`, so this only closes the "property unset" hole.

### 🟡 O6 — Static default password (MEDIUM)
`PlatformUserController` / `EmployeeController` `temporaryPasswordOrDefault` → generate a random one‑time password (or force the existing token invitation flow); require reset on first login.

### 🟡 S3 — WebSocket auth (MEDIUM)
`WebSocketConfig`: restrict `setAllowedOriginPatterns` to real origins; add a `ChannelInterceptor` that authenticates the JWT on `CONNECT` and authorizes the caller's tenant/dept on `SUBSCRIBE`. (Mobile app doesn't use WS; this protects the web dashboards' live topics.)

### 🟡 O7 / O8 / S4 — DB hardening (MEDIUM) — apply in a maintenance window
```sql
-- O7: no duplicate daily attendance (partition key included, so allowed)
ALTER TABLE attendance.records
  ADD CONSTRAINT uq_att_emp_day UNIQUE (tenant_id, employee_id, attendance_date);

-- O8: close the audit.events cross-tenant read hole
ALTER TABLE audit.events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_audit ON audit.events
  USING (tenant_id = current_tenant_id()
         OR current_setting('app.is_platform_admin', true) = 'true');

-- S4: match the FORCE-RLS invariant on phase-3 tables (V067–V078)
--     ALTER TABLE <schema>.<table> FORCE ROW LEVEL SECURITY;   (per table)
-- and confirm ut_app is NOSUPERUSER NOBYPASSRLS.
```

### 🟡 6.1 — Standardize tenant binding (LOW)
Replace the 5 `jdbc.execute("SET LOCAL app.tenant_id = '" + tenantId + "'")` sites with the bound form already used in `AuthService`: `jdbc.queryForObject("SELECT set_config('app.tenant_id', ?, true)", String.class, tenantId.toString())`. UUID‑safe today; removes the latent RLS‑bypass‑by‑injection risk.

### 🟡 8.1 — Malformed‑body handler (LOW)
`GlobalExceptionHandler` — for `HttpMessageNotReadableException`, log the cause but return a static `"Request body is malformed or contains an invalid value."` instead of `getMostSpecificCause().getMessage()` (which leaks Jackson/enum/class internals).

---

## 5. Operational (🔧) — secret rotation (O3)

Treat every secret ever shared over chat/WhatsApp or stored in Railway as **compromised**. Rotate **all** at the GCP cutover and store only in Secret Manager:

| Secret | Impact if leaked | Rotate |
|---|---|---|
| `UNIFIEDTREE_JWT_SECRET` | Forge a token for **any** tenant/user | New 48‑byte value; invalidates all sessions (all users re‑login). |
| Postgres superuser + `ut_app` password | Full DB / RLS bypass | New passwords; update Secret Manager + `ut_app` role. |
| `UNIFIEDTREE_FACE_ENCRYPTION_KEY` | Decrypt face embeddings | New key + re‑encrypt (or re‑enroll). |
| `PII_ENCRYPTION_KEY` | Decrypt PAN/Aadhaar/bank | Set a real key + re‑encrypt (O2). |
| `BREVO_API_KEY`, `SMTP_PASS` | Send mail as you | Rotate in Brevo/Gmail. |
| Platform admin password | Admin takeover | Rotate. |

Delete the on‑disk `backend/.env.railway*`, `.env.production-secrets`, `.env.platform-admin` artifacts after migrating — they hold plaintext secrets (they are **not** git‑tracked, confirmed, but they exist in the working tree).

---

## 6. What's already strong (do not regress)

Multi‑tenant RLS (JWT‑only tenant, fail‑closed, partition‑child propagation) · AES‑GCM biometric encryption with no raw‑image persistence · BCrypt passwords · SHA‑256‑hashed, rotated refresh tokens · fail‑safe prod CORS (rejects bare `*`, credentials off) · stack‑trace‑safe global exception handler · non‑root multi‑stage JRE Docker image · `ddl-auto: validate` · prod actuator lockdown + graceful shutdown + PII‑safe logging (this pass).
