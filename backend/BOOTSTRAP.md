# UnifiedTree Production Bootstrap

How to create the first tenant + first SUPER_ADMIN user on a fresh
production database WITHOUT putting a known password in the migration
files.

## TL;DR

1. Deploy the backend with `SPRING_PROFILES_ACTIVE=canonical,canonical-prod`
   on an empty Postgres database. Flyway will create all schemas + the
   permission/role catalog but ZERO users.
2. Set these env vars on the deploy:
   ```
   UNIFIEDTREE_BOOTSTRAP_ENABLED=true
   UNIFIEDTREE_BOOTSTRAP_TENANT_SUBDOMAIN=<your-company>
   UNIFIEDTREE_BOOTSTRAP_TENANT_DISPLAY_NAME=<Your Company Name>
   UNIFIEDTREE_BOOTSTRAP_ADMIN_EMAIL=<your-admin-email>
   UNIFIEDTREE_BOOTSTRAP_ADMIN_PASSWORD=<a long random password>
   UNIFIEDTREE_JWT_SECRET=<a different long random secret, 32+ chars>
   ```
3. Start the app. The `InitialAdminBootstrap` CommandLineRunner sees
   `auth.user_credentials` is empty, creates the tenant + admin, and logs:
   ```
   Bootstrap complete: tenant=<subdomain> admin=<email> userId=<uuid>.
   REMOVE the UNIFIEDTREE_BOOTSTRAP_* environment variables now.
   ```
4. **Immediately remove** the `UNIFIEDTREE_BOOTSTRAP_*` env vars from the
   deploy and restart. The bootstrap is then idempotent (no users will
   be created on subsequent boots because the user count is no longer
   zero) but removing the envs is belt-and-suspenders.
5. Log in via `POST /v1/canonical-auth/login` with the tenant id you can
   read from the platform.tenants table (or curl the bootstrap log line).

## Why this design

- **No known passwords in source.** The canonical Flyway migrations
  contain zero rows in `auth.user_credentials`. There is nothing for an
  attacker who reads the repo to log in as.
- **No bootstrap endpoint reachable from the network.** A common
  alternative -- a one-shot HTTP endpoint that creates the first admin --
  is an attack surface: every redeploy temporarily exposes it. Using a
  CommandLineRunner gated by an env var means the entry point only
  exists for the operator who controls the deploy environment.
- **Safe to leave the code in.** Once the database has a user, the
  bootstrap silently does nothing on every subsequent boot. It is not a
  "delete after first use" hack; it is permanently inert once seeded.
- **Refuses weak credentials.** Passwords shorter than 12 chars are
  rejected; the operator must commit to a real secret.

## Verifying after bootstrap

```bash
# On the DB:
psql -c "SELECT count(*) FROM auth.user_credentials;"
# expect 1

psql -c "SELECT subdomain, status FROM platform.tenants;"
# expect 1 row, status=ACTIVE

# On the API:
curl -s -X POST https://<host>/api/v1/canonical-auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"tenantId\":\"<tenant-uuid>\",\"email\":\"<admin-email>\",\"password\":\"<the-password>\"}"
# expect 200 with accessToken
```

## What happens in dev / smoke mode

Profile `canonical` (no `canonical-prod`) loads two Flyway directories:

```
classpath:db/canonical        -- schemas + permission catalog + V017 role->perm
classpath:db/dev-seed         -- V900 demo tenant + admin@unifiedtree.demo
                                 + reader@unifiedtree.demo (password Hrms@12345)
```

That gives a one-command developer experience: clone repo, point at any
Postgres, `mvn install`, run app, login with the demo creds.

Profile `canonical-prod` overrides `spring.flyway.locations` to
`classpath:db/canonical` only. The dev-seed file IS shipped in the jar
(it's a classpath resource) but is never executed by Flyway in prod.
If you want to be doubly safe and physically exclude it from the
production artifact, add a Maven `<resources>` exclude or use a `prod`
build profile -- not required, but supported.

## Multi-tenant note

`InitialAdminBootstrap` creates the FIRST tenant. Subsequent tenants
come through the (future) public-signup-and-platform-approval flow:

```
POST /v1/public/signup-request   -> tenant in PENDING_APPROVAL
POST /v1/platform/tenants/{id}/approve   (super-admin only)
```

This signup flow exists in the legacy `com.hrms.api.saas` controllers
and will be ported to canonical in a later phase.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| App starts, no admin appears, logs say "skipping" | At least one env var missing | Re-set all 4 `UNIFIEDTREE_BOOTSTRAP_*` vars |
| App starts but log says "users already exist" | Bootstrap already ran successfully | Done -- log in normally |
| Login returns 401 / 422 | Tenant id mismatch or wrong password | Check the tenant UUID via `psql platform.tenants`; passwords are case-sensitive |
| App refuses to start with "secret must be at least 32 characters" | `UNIFIEDTREE_JWT_SECRET` too short | Use `openssl rand -base64 48` to generate one |
