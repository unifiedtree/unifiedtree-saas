# Environment Variable Reference — Backend

Every environment variable the backend reads, whether it's a **secret** (→ Secret Manager) or **config** (→ Cloud Run env), its default, and rotation notes. The active profile in prod is `canonical,canonical-prod`.

> **Secrets** must live in **Secret Manager** and be mounted (`--set-secrets`), never in `--set-env-vars`, images, or committed files.

## Secrets (Secret Manager → Cloud Run `--set-secrets`)

| Var | Purpose | Default | Rotation |
|---|---|---|---|
| `DB_PASSWORD` | `ut_app` DB role password | none (required) | New value + `ALTER ROLE ut_app PASSWORD`. |
| `UNIFIEDTREE_JWT_SECRET` | HS256 JWT signing key (≥32 chars) | `CHANGE_ME` → app refuses to boot | New 48‑byte value; invalidates all sessions. |
| `UNIFIEDTREE_FACE_ENCRYPTION_KEY` | AES‑GCM key for face embeddings (32‑byte b64) | empty → app refuses to boot | New key + re‑enroll/re‑encrypt. |
| `PII_ENCRYPTION_KEY` | AES key for PAN/Aadhaar/bank fields (32‑byte b64) | **all‑zeros (INSECURE)** → set a real one (O2) | New key + re‑encrypt existing rows. |
| `SMTP_PASS` | Gmail app password (SMTP fallback) | empty | Rotate in Google account. |
| `BREVO_API_KEY` | Brevo REST API key (primary mail) | empty | Rotate in Brevo. |
| `UNIFIEDTREE_PLATFORM_ADMIN_PASSWORD` | platform admin seed | — | Rotate; don't reuse. |

## Config (Cloud Run `--set-env-vars`)

| Var | Purpose | Prod value |
|---|---|---|
| `SPRING_PROFILES_ACTIVE` | active profiles | `canonical,canonical-prod` |
| `DB_URL` | JDBC URL | `jdbc:postgresql://<CLOUD_SQL_PRIVATE_IP>:5432/railway` |
| `DB_USERNAME` | DB role | `ut_app` |
| `DB_POOL_SIZE` | Hikari max pool | `10` (raise with load) |
| `SPRING_FLYWAY_ENABLED` | **must stay** `false` | `false` (migrations applied manually) |
| `SPRING_BATCH_JDBC_INITIALIZE_SCHEMA` | batch schema | `never` |
| `HRMS_KAFKA_ENABLED` | Kafka listeners | `false` |
| `JAVA_TOOL_OPTIONS` | JVM flags | `-Duser.timezone=UTC -XX:MaxRAMPercentage=75` |
| `UNIFIEDTREE_ALLOWED_ORIGINS` | exact CORS origins | your web origins (no wildcards) |
| `UNIFIEDTREE_ALLOWED_ORIGIN_PATTERNS` | CORS wildcard patterns | `https://*.unifiedtree.com` (drop `*.vercel.app` in prod — S‑CORS) |
| `UNIFIEDTREE_CORS_ALLOW_CREDENTIALS` | cookie flow | `false` |
| `UNIFIEDTREE_FACE_WORKER_URL` | Python face worker | its Cloud Run URL |
| `MAIL_PROVIDER` | mail backend | `brevo` |
| `BREVO_FROM_EMAIL` / `BREVO_FROM_NAME` | sender identity | as configured |
| `INVITE_URL_BASE` / `UNIFIEDTREE_BASE_DOMAIN` | invite links | `https://unifiedtree.com` |
| `OTP_DEBUG_RESPONSE_ENABLED` | OTP in response | **`false`** (default now false; never true in prod) |
| `UNIFIEDTREE_JWT_ACCESS_TTL_MIN` | access token TTL | `720` today → `15`–`30` once mobile refresh verified (S2) |
| `LOG_LEVEL_APP` / `LOG_LEVEL_SECURITY` | log verbosity | `INFO` (never `DEBUG` in prod) |
| `UNIFIEDTREE_MAX_UPLOAD_SIZE` / `UNIFIEDTREE_MAX_REQUEST_SIZE` | multipart caps | `10MB` / `12MB` |
| `PORT` | listen port | injected by Cloud Run |

## Mobile (`EXPO_PUBLIC_*` — baked into the JS bundle at build/OTA time)

| Var | Purpose | Value |
|---|---|---|
| `EXPO_PUBLIC_API_BASE_URL` | backend base URL | `https://erpinfrastructure-production.up.railway.app` → `https://api.unifiedtree.com` after GCP cutover |
| `EXPO_PUBLIC_WEB_API_BASE_URL` | web build base URL | same as above |
| `EXPO_PUBLIC_DEFAULT_TENANT_ID` | default tenant | `d4a33bfd-2041-4fb2-b0d5-840286fe2746` |
| `EXPO_PUBLIC_DEV_MOCK_API` | in‑app mock layer | **`false`** in every release profile |

> `EXPO_PUBLIC_*` values are **public** (visible in the APK) — never put a secret behind that prefix. Set them in `eas.json` per profile (done) so store builds are deterministic; changing them requires `eas update --clear-cache` (JS) or a rebuild (native).

## Rules
- Prod **must** provide `UNIFIEDTREE_JWT_SECRET`, `UNIFIEDTREE_FACE_ENCRYPTION_KEY`, `PII_ENCRYPTION_KEY`, `DB_PASSWORD` — the app fail‑fasts on the first two (and should on the others after O2/S1).
- Keep `SPRING_FLYWAY_ENABLED=false` — `ut_app` can't read the Flyway history table; migrations are applied manually.
- Never set `LOG_LEVEL_APP=DEBUG` or `OTP_DEBUG_RESPONSE_ENABLED=true` in prod.
