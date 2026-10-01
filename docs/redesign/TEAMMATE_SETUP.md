# Teammate setup (Windows): run the app locally and work on redesign tasks

For: chakridol143 and his Claude. Lead: Saiteja's Claude (reviews, merges, pushes `main`).

## 0. Rules that never bend
1. **Never push to `main`. Never merge pull requests.** Work only on `redesign/<task>` branches; the lead merges.
2. **Tests run only against your LOCAL database.** Never point the backend, tests or scripts at production.
   - Production DB access is only for applying the migrations the lead lists at release time, in the given order.
3. **Never start the web app without `VITE_PROXY_TARGET`.** Without it, `apps/platform` sends API calls to the
   PRODUCTION API (`https://api.unifiedtree.com`). Always set it to your local backend.
4. **Only edit the files your task owns.** If you need a change elsewhere, write it in your pull request and the lead does it.
5. **Migration numbers come from the lead,** in the task. Never pick your own.
6. **No secrets in commits.** Commit messages are plain English, ending with the `Co-Authored-By` line your Claude normally adds.

## 1. Install (once)
- Git for Windows (includes Git Bash), Node 20 + pnpm 9 (`corepack enable`), JDK 21 (Eclipse Temurin), Maven 3.9+,
  PostgreSQL 16+ (we use 18), and the GitHub CLI (`winget install --id GitHub.cli`).
- Open a NEW terminal, then run `gh auth login` (GitHub.com, HTTPS, log in with the browser).

## 2. Get the code
```
git clone https://github.com/unifiedtree/unifiedtree-saas.git   (or: git fetch, if you have it)
cd unifiedtree-saas
git fetch origin
git switch -c redesign/<task> origin/redesign/int      # the task file tells you <task>
pnpm install --frozen-lockfile
```
Everything about the redesign is in `docs/redesign/`. Start with `docs/redesign/README.md`.

## 3. Local database (once)
Use psql as the `postgres` superuser:
```sql
CREATE ROLE ut_app LOGIN PASSWORD 'local_only';          -- the app's runtime user (non-owner, so RLS applies)
CREATE DATABASE ut_local OWNER postgres;
```
The backend's Flyway (run as `postgres`) creates every schema plus the demo data: tenant
`aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`, logins `admin@`, `hrm@`, `fin@`, `mgr@`, `reader@` `@unifiedtree.demo`, password `Hrms@12345`.

After the FIRST backend start (step 4), run these once, as `postgres`, on `ut_local`:
- `scripts/recovery-runtime-grants.sql` (grants `ut_app` access to every schema)
- `docs/redesign/setup/recovery-company-owner.sql` (adds `owner@unifiedtree.demo`, the OWNER login the tests use)

## 4. Run the backend (Git Bash)
```bash
cd backend
export JAVA_HOME="C:/Program Files/Eclipse Adoptium/jdk-21..."    # your JDK 21 path
mvn -q -o -pl app/hrms-app -am package -DskipTests              # drop -o the very first time (downloads deps)
export DB_URL='jdbc:postgresql://127.0.0.1:5432/ut_local' DATABASE_URL='jdbc:postgresql://127.0.0.1:5432/ut_local'
export DB_USERNAME=ut_app DB_PASSWORD=local_only
export UNIFIEDTREE_JWT_SECRET='local-only-dev-secret-at-least-32-characters-long'
export UNIFIEDTREE_SUBSCRIPTION_GRANDFATHER_TENANT_IDS='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
export UNIFIEDTREE_FACE_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")   # generate ONCE, keep it
java -Xmx1200m -jar app/hrms-app/target/hrms-app-1.0.0-SNAPSHOT.jar \
  --spring.profiles.active=canonical,canonical-prod --unifiedtree.firebase.enabled=false \
  --spring.flyway.locations=classpath:db/canonical,classpath:db/dev-seed \
  --spring.flyway.url=jdbc:postgresql://127.0.0.1:5432/ut_local --spring.flyway.user=postgres --spring.flyway.password=<your postgres password> \
  --spring.flyway.out-of-order=true \
  --unifiedtree.inspection.local-path=C:/temp/ut-inspection \
  --unifiedtree.mail.provider=smtp --spring.mail.host=127.0.0.1 --spring.mail.port=11025 \
  --spring.mail.username= --spring.mail.password= --spring.mail.properties.mail.smtp.auth=false \
  --spring.mail.properties.mail.smtp.starttls.enable=false \
  --server.port=8080 --management.server.port=18081
```
- Wait for `Started HrmsApplication`. The API is at `http://127.0.0.1:8080/api`.
- Optional local mail catcher, so no mail ever leaves your PC: `node scripts/local-mail-catcher.mjs` (port 11025).

## 5. Run the web app
```bash
cd apps/platform
VITE_PROXY_TARGET=http://127.0.0.1:8080 npx vite --port 3002 --strictPort
```
- Open **http://demo.localhost:3002** (Chrome/Edge resolve `*.localhost`) and sign in as `owner@unifiedtree.demo` / `Hrms@12345`.
- Node scripts can't resolve `demo.localhost`: in your own test code, call the API at `127.0.0.1`.

## 6. Checks before every pull request (all must pass)
From `apps/platform`:
- `npx tsc --noEmit`
- `npx eslint <your changed files>` (0 errors)
- `npx vite build`
- `npx vitest run src`

For backend tasks, from `backend`: `mvn -q -o -pl app/hrms-app -am test -Dtest='YourTest*' -Dsurefire.failIfNoSpecifiedTests=false`.

Your task's live test, against YOUR local backend and DB:
```bash
RECOVERY_APP_URL=http://demo.localhost:3002 RECOVERY_UI_URL=http://demo.localhost:3002 \
RECOVERY_API_URL=http://127.0.0.1:8080/api RECOVERY_DB=ut_local node e2e/recovery/<test>.mjs
```
- Tests that read SQL use `RECOVERY_DB`. Always pass `ut_local`. Never run a test without it.
- The existing tests for your pages (the task lists them) must keep every behavioural check; update selectors only.

**Screenshots:** reference images of every designed screen can be regenerated with
`node e2e/capture-handoff.mjs --proto docs/redesign/design/prototype --out <folder> --only <module>`.
Compare your page side by side at 1440 and 390 wide, light and dark.

## 7. Hand-in (every task)
1. Commit in small, clear pieces, then `git push -u origin redesign/<task>`.
2. Run `gh pr create --base redesign/int --head redesign/<task> --title "<task>: <summary>" --body-file <your report>`.
   The report uses the format in `docs/redesign/PACKAGE_BRIEF.md` ("Your final report").
3. The lead reviews and comments on the PR. Read them with `gh pr view <n> --comments`, fix, and push again.
4. When the lead merges, run `git fetch` and start the next task from the fresh `origin/redesign/int`.
