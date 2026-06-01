# UnifiedTree — Production Deployment Guide

How to put UnifiedTree live on `unifiedtree.com` with unlimited tenant
subdomains (`company1.unifiedtree.com`, `company2…`, etc.).

- **Backend** -> Railway (Docker)
- **Website + Platform** -> Vercel (two projects)
- **Postgres** -> already provisioned (Railway)
- **DNS** -> your registrar, with a wildcard record + Vercel nameserver
  delegation for the free wildcard TLS cert.

There are **two** frontend apps to deploy (`apps/website`, `apps/platform`).
The old separate admin app was removed; workspace signup is now
instant-activate (no manual approval step), so no admin console is needed
for the core flow.

---

## 0. The hostname map

| Hostname | Serves | Host | Cert |
|---|---|---|---|
| `unifiedtree.com`, `www.unifiedtree.com` | `apps/website` (marketing + signup) | Vercel project **website** | per-host (auto) |
| `*.unifiedtree.com` | `apps/platform` (tenant workspace) | Vercel project **platform** | **wildcard** (needs NS delegation) |
| `api.unifiedtree.com` | Spring backend | **Railway** | auto (Railway) |

`company1.unifiedtree.com`, `company2.unifiedtree.com`, ... are all served
by the single **platform** project via the `*.unifiedtree.com` wildcard.
A new company does NOT create a DNS record or a Vercel domain — it is just
a new row in `platform.tenants`. Unlimited and free.

Reserved names (`www`, `api`, `admin`, `app`, `mail`, …) cannot be
registered as a company subdomain — enforced in `SaasService.checkSubdomain`.

---

## 1. Backend on Railway

### 1.1 Service settings
- **Source**: GitHub repo, Root Directory = `backend`
- **Builder**: Dockerfile (auto-detected; `backend/Dockerfile` present)
- **Config**: `backend/railway.toml` already sets healthcheck `/api/actuator/health`

### 1.2 Required env vars (Railway -> Variables)
```
SPRING_PROFILES_ACTIVE=canonical,canonical-prod
DB_URL=jdbc:postgresql://<railway-pg-host>:<port>/<db>
DB_USERNAME=ut_app
DB_PASSWORD=<ut_app password>
UNIFIEDTREE_JWT_SECRET=<openssl rand -base64 48>
UNIFIEDTREE_FACE_ENCRYPTION_KEY=<openssl rand -base64 32>
UNIFIEDTREE_ALLOWED_ORIGINS=https://unifiedtree.com,https://www.unifiedtree.com
UNIFIEDTREE_ALLOWED_ORIGIN_PATTERNS=https://*.unifiedtree.com
SPRING_FLYWAY_ENABLED=false
JAVA_TOOL_OPTIONS=-Duser.timezone=UTC
HRMS_KAFKA_ENABLED=false
```
> `UNIFIEDTREE_ALLOWED_ORIGIN_PATTERNS=https://*.unifiedtree.com` is the
> key line that lets every tenant subdomain talk to the API. Without it,
> only the apex/www origins pass CORS and tenant workspaces get blocked.

### 1.3 Run migrations once per release (separate from the app)
The app runs with `SPRING_FLYWAY_ENABLED=false` and `DB_USERNAME=ut_app`
(no DDL rights). Apply migrations with the **migrator** role before/at
release:

- One-shot job (or temporary redeploy) with:
  ```
  DB_USERNAME=ut_migrator
  DB_PASSWORD=<ut_migrator password>
  SPRING_FLYWAY_ENABLED=true
  ```
- Wait for `Successfully applied N migrations`, then revert to `ut_app` +
  `SPRING_FLYWAY_ENABLED=false` for the long-running service.

**CRITICAL — re-grant `ut_app` after any migration that adds tables.**
New tables are owned by the migrator/owner role; `ut_app` has no rights on
them until granted. Symptom if skipped: signup / any write throws
`permission denied for table <x>` -> HTTP 500. Run this as the DB **owner**
(`postgres`) after each migration release:

```sql
DO $$
DECLARE s text;
BEGIN
  FOR s IN SELECT nspname FROM pg_namespace
            WHERE nspname NOT LIKE 'pg_%'
              AND nspname NOT IN ('information_schema','public')
  LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO ut_app', s);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO ut_app', s);
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO ut_app', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ut_app', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO ut_app', s);
  END LOOP;
END $$;
```

The `ALTER DEFAULT PRIVILEGES` lines make future tables auto-grant.

See `backend/RAILWAY_DEPLOYMENT.md` for the two-role rationale.

### 1.4 Custom domain
- Railway service -> Settings -> Networking -> Custom Domain ->
  `api.unifiedtree.com`. Railway gives you a CNAME target; add it in DNS
  (step 3). Railway auto-issues the TLS cert.

---

## 2. Frontend on Vercel (two projects)

Create **two** Vercel projects from the same repo, different Root Directory.

### 2.1 Project: website
- Root Directory: `apps/website`
- Framework preset: Vite (auto). `apps/website/vercel.json` provides the
  SPA rewrite + asset caching.
- Install command: `pnpm install` (repo is a pnpm workspace; set the
  project's Node + pnpm in Vercel settings if needed)
- Build command: `pnpm build` (from vercel.json)
- Output dir: `dist`
- Env var:
  ```
  VITE_API_URL=https://api.unifiedtree.com/api
  ```
- Domains: `unifiedtree.com`, `www.unifiedtree.com`

### 2.2 Project: platform
- Root Directory: `apps/platform`
- Same Vite preset / `vercel.json`
- Env var:
  ```
  VITE_API_URL=https://api.unifiedtree.com/api
  ```
- Domain: `*.unifiedtree.com`  (add the wildcard domain to THIS project)

> Vercel resolves exact-match domains before wildcards, so `unifiedtree.com`
> and `www.` stay on the website project even though `*.unifiedtree.com`
> exists on platform. `api.unifiedtree.com` is on Railway (not Vercel) and
> is unaffected.

---

## 3. DNS + wildcard TLS (the one real setup step)

The wildcard cert for `*.unifiedtree.com` is the only thing that needs
care. Two supported paths:

### Path A (recommended): delegate nameservers to Vercel
1. In Vercel (either project) -> Settings -> Domains -> add
   `unifiedtree.com`. Vercel shows two nameservers, e.g.
   `ns1.vercel-dns.com`, `ns2.vercel-dns.com`.
2. At your registrar, set the domain's nameservers to those.
3. Back in Vercel:
   - Assign `unifiedtree.com` + `www.unifiedtree.com` to **website**.
   - Assign `*.unifiedtree.com` to **platform**. Vercel auto-issues the
     wildcard Let's Encrypt cert (DNS-validated, free, auto-renew).
   - Add a DNS record for `api.unifiedtree.com` -> CNAME to the Railway
     target from step 1.4 (Vercel DNS panel lets you add it).
4. Done. Every `companyN.unifiedtree.com` now serves the platform app over
   valid HTTPS with zero per-company setup.

### Path B: keep your registrar/Cloudflare DNS
1. Add records at your DNS host:
   - `unifiedtree.com` (apex) -> Vercel (A `76.76.21.21` or ALIAS to the
     website project's `*.vercel-dns.com` target Vercel gives you)
   - `www` -> CNAME -> website project target
   - `*` (wildcard) -> CNAME -> platform project target
   - `api` -> CNAME -> Railway target
2. Wildcard TLS on Vercel without NS delegation requires the domain be
   verified and the wildcard added; if Vercel cannot DNS-validate, put
   **Cloudflare** in front (orange-cloud proxy) which terminates wildcard
   TLS for free. Cloudflare path: set SSL mode "Full", add the wildcard
   CNAME proxied.

> If you only have time for one thing: **Path A** is the least-moving-parts
> way to get free unlimited wildcard HTTPS.

---

## 4. Smoke test after deploy

```bash
# backend up
curl https://api.unifiedtree.com/api/actuator/health        # {"status":"UP"}

# reserved subdomain rejected
curl "https://api.unifiedtree.com/api/v1/public/subdomains/check?slug=admin"
# -> { "available": false, "reason": "...reserved..." }

# a real one is available
curl "https://api.unifiedtree.com/api/v1/public/subdomains/check?slug=acmecorp"
# -> { "available": true, "reason": "Available" }
```

Then in a browser:
1. `https://unifiedtree.com` -> sign up a company "acmecorp"
2. You are redirected to / can open `https://acmecorp.unifiedtree.com`
3. Workspace status is ACTIVE (instant activation), log in with the
   admin email + password you signed up with -> role-based dashboard.

---

## 5. Cost reality

- **Subdomains**: unlimited, free. One wildcard record + one wildcard cert
  cover infinite companies. New company = one Postgres row.
- **Vercel**: Hobby is free but its ToS restricts commercial use; a real
  paying product needs **Pro ($20/mo flat)**. No per-subdomain charge on
  any plan.
- **Railway**: usage-based (~$5/mo hobby after trial credit) for the
  backend + the already-provisioned Postgres.
- **Face worker** (`face-verification-worker`): only needed for the
  Attendance App's face punch-in, not for the website/platform launch.
  Deploy it later as a separate private Railway service; never expose it
  publicly.

---

## 6. What is NOT covered yet (known gaps before scale)

- `/v1/canonical-auth/refresh` not implemented -> sessions force re-login
  when the 15-min access token expires.
- Per-tenant rate limiting not wired (Bucket4j dependency present).
- Email/notifications (workspace-created email, password reset) not wired.
- The face worker + Attendance App are a separate deployment track.
- Vercel Pro required before commercial launch (licensing, not technical).
