# Release 2 deploy checklist: database, backend, web app

**Who this is for:** the teammate deploying Release 2 of the HRMS redesign to production, and the owner checking it.
**What it is:** one checklist, top to bottom: database, backend, web app, then a smoke test per role. `apply_release2.sh` (next to this file) is step 4 as a script. `REHEARSAL.md` shows the same steps run on copies of a local database.

> **Read first: what is not routine about this release**
>
> 1. **V143_53 must NOT run in one transaction.** It changes two CHECK rules on `attendance.records`, which is partitioned (one table per month). Run it with psql in autocommit (no `--single-transaction`, no `BEGIN`). Each step then commits alone and the long step (VALIDATE) lets punches carry on. `apply_release2.sh` does this.
> 2. **V143_53 turns "Allow web check-in" ON for every company.** That is the client's decision of 1 Oct. Once the new web app is live, anyone who has enrolled their face can check in from the browser with a face scan and the browser's location (the geofence still applies). An admin can turn it off per company in HR Setup → HR Configuration → Attendance rules. If the client wants it off at launch, see step 4.4.
> 3. **V143_59 marks every asset that is issued today as "received".** This runs once, at the moment the file runs: hand-overs from before then count as confirmed (`source = BACKFILL`). Later ones wait for the employee to confirm. It depends on production's data and can't be repeated. Running the file again never backfills again.
> 4. **V143_56 is a plain `CREATE INDEX`, not `CONCURRENTLY`.** It blocks new leave requests and leave decisions while the index builds. `leave_mgmt.leave_requests` is small, so that is well under a second (check its size in step 3.3). It runs in a transaction like the others.
> 5. **V143_62 replaces two CHECK rules on `hrms.report_schedules`** (to allow DAILY and WEEKDAYS). Unlike V143_53's table, this one is small and not partitioned, so it runs inside one transaction: the old rule is dropped and the new one added together, and the new rule's scan of a few rows is instant. Because it is one transaction, there is never a moment when the table has no rule. **Do not split this file across transactions** — that would leave the table briefly unguarded.
> 6. **Short table locks.** V143_53 (on `attendance.records`), V143_54, V143_56 and V143_65 each take a brief exclusive lock on a table people use all day. The script sets `lock_timeout = 10s`. A file that can't get its lock in 10 s stops cleanly instead of making every punch wait behind it; then you run the script again. (While a statement waits for its lock, new queries on that table wait behind it, for up to those 10 s. `LOCK_TIMEOUT=5s bash apply_release2.sh` shortens that.) Prefer a quiet hour (not 09:00–10:30 or 18:00–19:30 India time, when people punch).
> 7. **Three new permissions are not given to ADMIN** (`hrms.team.message`, `hrms.probation.team.decide`, `hrms.timesheet.approve`), although ADMIN normally mirrors OWNER. That is how the files are written; it's an open question for the owner (steps 6 and 10).
>
> 8. **No new permission in V143_61 or V143_62.** Both reuse permissions that already exist.
>
> Everything else is additive: new tables, new nullable columns, new permissions, all re-runnable.

---

## 0. Before you start

You need:
- GCP project `unifiedtree-prod`, region `asia-south1`: Cloud SQL instance `ut-postgres` (database `railway`), Cloud Run service `unifiedtree-saas`.
- A database login that is a **superuser or has BYPASSRLS** (most new tables have row-level security; V143_59's backfill must see every workspace's rows). On Cloud SQL that is `postgres` or your migrator login.
- The GitHub repo (Actions tab) and the Vercel project for `apps/platform`.
- A checkout of the **release commit** (the `rd/int` branch once it is merged to `main`). Copy `apply_release2.sh` into the root of that checkout and run it from there: it reads the migration files from `backend/app/hrms-app/src/main/resources/db/canonical`.

Facts that shape this checklist (all checked in the code):
- **Production never migrates itself.** Cloud Run runs with `SPRING_FLYWAY_ENABLED=false` and profiles `canonical,canonical-prod` (`deployments/gcp/provision.sh`, `backend/Dockerfile`). You apply the files by hand.
- **The backend deploys itself** when a push to `main` changes `backend/**`. Release 2 changes `backend/**`, so the push starts a backend deploy. The web app deploys on Vercel from the same push.
- **No Java entity changes in Release 2.** Every new table and column is read with JDBC only. So Hibernate's `ddl-auto: validate` passes with or without the migrations: the new backend starts on the old database.
- **`OwnerPermissionInvariantCheck`** (runs once, at startup) stops the app if OWNER lacks any permission in `rbac.permissions`. Every new permission is granted to OWNER in the same file that creates it, and each file runs as one transaction, so the check passes before, during and after the migrations.

---

## 1. What ships

Release 2 = branch `rd/int`, built on the 26 Sep backend (`e32a4dc6`). The web app's Release 1 and 1.1 are in it too.

- **Team:** Team today, Team schedule, Approvals inbox with **Undo** (10 minutes), message your team, probation confirm/extend.
- **Attendance:** Daily tracking (Mark leave for someone, bulk mark), face punches by calendar, **web face check-in** (behind the company switch), **timesheet** by project with Submit week and approval, muster roll, Shifts & overtime (overtime rules: a 60-minute minimum as a threshold and an optional monthly cap; employees' overtime requests), temporary shift change ("Until"), "Anywhere (no geofence)" per person.
- **Home:** the self-service Home for employees and managers (my requests, needs you, around me, WFH days, apply for leave, shift change with Until).
- **Org chart** (its own page for every role, plus a tab in Organization setup).
- **Search and notifications:** one search dialog (it now also finds holidays and requests) and the new notifications popover.
- **Letters and documents (P-DOCS):** letter preview before saving, ask an employee to sign (click to accept), **Send on a date** (scheduled distributions), employee vault, docs to review, my documents, my assets.
- **Performance, learning and exit (P-GROW):** review cycle dates with "hold feedback until shared", company KPIs that goals count towards, where a classroom program happens, the certification named on a skill proposal.
- **Reports and analytics (P-REPORTS):** report emails **every day** or **every weekday**, at a **chosen hour** (7–23 IST), with the CSV next to the PDF.
- **Profile:** the Access tab.
- **Leave, Payroll and My pay, Expenses / PLI / Advances / F&F:** the teammate's screens on the new kit.
- **Backend for packages whose screens come later:** employee drafts and department cost centres, expense claims on someone's behalf, Ask payroll (payslip questions), hiring stage history and funnel, offer email, asset confirmation and problem reports, and more (see the table in step 4.2).
- **Database:** 14 migrations, **V143_50 → V143_66** (there is no V143_51, and no V143_63 or V143_64).

Not part of this deploy: the mobile app. It keeps working unchanged; it just shows the new notification types with a plain bell (step 9).

---

## 2. The order, and why

**Recommended order: database first, then push.**

1. Back up (step 3.1).
2. Apply the 14 migrations with `apply_release2.sh` (step 4). The current production backend keeps serving, unchanged.
3. Merge and push to `main` (step 5). The backend (Cloud Run) and the web app (Vercel) deploy from that push.
4. Check, then smoke-test (steps 5–8).

Why database first:
- **When the new screens appear, their tables are already there.** Nobody sees "not ready yet" panels on day one, and you don't need a second restart.
- **The current backend runs fine on the migrated database.** All changes are additive. It never writes `WEB` as a punch method, its entities don't map the new columns, and its startup check passes because OWNER gets every new permission. Rehearsal C in `REHEARSAL.md` started the current `main` backend on a fully migrated copy and checked it.
- **If a migration fails, nothing has been released yet.** You fix it and run the script again, with no user-visible change.

**Backend first is also safe**, if the database window has to come later. The new backend starts on the old database (no entity changes; the startup check passes because the new permissions don't exist yet). Every new feature then degrades on its own (table in step 4.3), and nothing that works today breaks. Once you apply the migrations, the features come alive **without a restart**: the backend looks for each table on every call, not once at startup. Rehearsal B shows this.

Either way: **people sign out and back in once** after the migrations to see buttons that need a new permission (Message team, Mark leave, Approve timesheets). The server itself checks the database within 60 seconds, so the endpoints answer at once. The web app only shows the buttons once the sign-in token carries the permission (tokens last 12 hours).

---

## 3. Before the migrations (15 min)

### 3.1 Back up

```bash
gcloud sql backups create --instance=ut-postgres --project=unifiedtree-prod \
  --description="before Release 2 migrations V143_50-V143_66"
gcloud sql backups list --instance=ut-postgres --project=unifiedtree-prod --limit=3
```
Wait for `SUCCESSFUL`.

### 3.2 Connect

```bash
cloud-sql-proxy unifiedtree-prod:asia-south1:ut-postgres --port 6543 &
export PROD_URL='host=127.0.0.1 port=6543 dbname=railway user=<superuser>'
export PGPASSWORD='<password>'      # or use ~/.pgpass
psql "$PROD_URL" -X -c "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;"
```
`rolsuper` or `rolbypassrls` must be `t`.

### 3.3 Look before you change anything (read-only)

1. **Nothing from Release 2 is there yet:**
   ```bash
   bash apply_release2.sh --status
   ```
   Every line should read `f`. If some read `t`, someone has applied them already. That's fine, the files are re-runnable.
2. **Table sizes**, to judge the lock times in the warning box at the top:
   ```sql
   SELECT relname, n_live_tup FROM pg_stat_user_tables
    WHERE (schemaname, relname) IN (('leave_mgmt','leave_requests'), ('attendance','shift_change_requests'),
          ('hrms','time_entries'), ('settings','hr_configuration'), ('hrms','asset_allocations'))
       OR (schemaname = 'attendance' AND relname LIKE 'records%')
    ORDER BY n_live_tup DESC;
   ```
   Expected: tens of thousands of rows at most. If `attendance.records*` together run into many millions, allow a few minutes for V143_53's VALIDATE step. Punches carry on while it runs.
3. **The two CHECK rules V143_53 replaces** (it expects exactly these 11 methods, and adds `WEB`):
   ```sql
   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conrelid = 'attendance.records'::regclass AND conname LIKE 'ck_attendance_records_check_%_method%';
   ```
   Expected: `ck_attendance_records_check_in_method` and `ck_attendance_records_check_out_method`, each listing `MANUAL, FACE_RECOGNITION, BIOMETRIC_FINGERPRINT, MOBILE_GPS, KIOSK, GEO_FENCE, API, GPS, PIN, MANAGER_OVERRIDE, BIOMETRIC_DEVICE`. If production lists a method that isn't in that list, stop: V143_53's new rule would reject existing rows, and the script's preflight will say so.
4. **The report schedules V143_62's new rules must still accept** (the script's preflight checks the same thing):
   ```sql
   SELECT frequency, day_of_week, day_of_month, count(*)
     FROM hrms.report_schedules GROUP BY 1, 2, 3 ORDER BY 1;
   ```
   Expected: only `WEEKLY` (with a `day_of_week`) and `MONTHLY` (with a `day_of_month`). Anything else would be refused by the new rule, and the preflight stops before changing anything.
5. **Assets that V143_59 will mark as received** (so you can tell the owner the number):
   ```sql
   SELECT count(*) FROM hrms.asset_allocations al
     JOIN hrms.onboarding_assets a ON a.id = al.asset_id AND a.tenant_id = al.tenant_id
    WHERE al.returned_at IS NULL AND a.status = 'ASSIGNED' AND a.employee_id = al.employee_id;
   ```

---

## 4. Apply the migrations (5–15 min)

### 4.1 Run the script

From the root of the release checkout:
```bash
bash apply_release2.sh 2>&1 | tee release2-migrations.log
```
What it does:
1. **Preflight** (changes nothing). Every line must be `t`: superuser or BYPASSRLS; the `ut_app` role exists; V143_40 (the last file of the 26 Sep deploy) is applied; `current_tenant_id()` exists; every punch method already stored is one V143_53 allows. If one is not `t`, it stops before changing anything.
2. **The 14 files in order**, each followed by its check (must print `t`). It stops at the first failure and says what state it left.
3. **The status of all 14** at the end. All must read `t`.

On a second run you see many `NOTICE: relation … already exists, skipping` lines. They are expected.

`-X` (ignore `~/.psqlrc`) matters: a psqlrc that turns autocommit off would put V143_53 back into one transaction.

If you'd rather type it by hand, these are the exact commands, in this order:

```bash
DIR=backend/app/hrms-app/src/main/resources/db/canonical
export PGOPTIONS='-c lock_timeout=10s'
psql "$PROD_URL" -X -v ON_ERROR_STOP=1 --single-transaction -f $DIR/V143_50__approval_decision_journal.sql
psql "$PROD_URL" -X -v ON_ERROR_STOP=1 --single-transaction -f $DIR/V143_52__employee_drafts_and_department_cost_centres.sql
psql "$PROD_URL" -X -v ON_ERROR_STOP=1                      -f $DIR/V143_53__attendance_web_punch_and_punch_rules.sql   # NOT in one transaction
psql "$PROD_URL" -X -v ON_ERROR_STOP=1 --single-transaction -f $DIR/V143_54__shift_change_until_and_overtime_rules.sql
psql "$PROD_URL" -X -v ON_ERROR_STOP=1 --single-transaction -f $DIR/V143_55__team_messages_and_team_permissions.sql
psql "$PROD_URL" -X -v ON_ERROR_STOP=1 --single-transaction -f $DIR/V143_56__leave_apply_for_others_and_dates_index.sql
psql "$PROD_URL" -X -v ON_ERROR_STOP=1 --single-transaction -f $DIR/V143_57__expense_claim_on_behalf_permission.sql
psql "$PROD_URL" -X -v ON_ERROR_STOP=1 --single-transaction -f $DIR/V143_58__payslip_questions.sql
psql "$PROD_URL" -X -v ON_ERROR_STOP=1 --single-transaction -f $DIR/V143_59__hiring_history_offer_email_asset_care.sql
psql "$PROD_URL" -X -v ON_ERROR_STOP=1 --single-transaction -f $DIR/V143_60__letter_signatures_and_scheduled_distributions.sql
psql "$PROD_URL" -X -v ON_ERROR_STOP=1 --single-transaction -f $DIR/V143_61__review_milestones_company_kpis_learning_details.sql
psql "$PROD_URL" -X -v ON_ERROR_STOP=1 --single-transaction -f $DIR/V143_62__report_schedule_daily_weekdays_send_hour.sql
psql "$PROD_URL" -X -v ON_ERROR_STOP=1 --single-transaction -f $DIR/V143_65__timesheet_projects_and_weeks.sql
psql "$PROD_URL" -X -v ON_ERROR_STOP=1 --single-transaction -f $DIR/V143_66__overtime_requests.sql
```
Stop at the first command that fails. Run each file's check (step 4.2) after it.

Only **V143_53** must not be wrapped in a transaction. Every other file runs in one (`--single-transaction`), so a failure leaves nothing half-done — including **V143_62**, whose CHECK swap must stay in one transaction so the table is never left without a rule. No file uses `CREATE INDEX CONCURRENTLY`, so none of them breaks inside a transaction.

### 4.2 The migrations, with their checks

Each check returns `t` once the file has run. The script runs the same checks. "Re-run" says what a second run does; the rehearsal ran the whole script twice.

| # | File | What it adds | Re-run | Check (expected `t`) |
|---|---|---|---|---|
| 1 | V143_50 | `hrms.approval_decisions`: the Undo journal for approve/reject of leave, WFH, attendance fixes, shift changes and expense claims | Safe, no change | `SELECT has_table_privilege('ut_app', 'hrms.approval_decisions', 'INSERT');` |
| 2 | V143_52 | `hrms.employee_drafts` (Save draft on Add employee) and `hrms.department_cost_centres` | Safe, no change | `SELECT has_table_privilege('ut_app', 'hrms.employee_drafts', 'DELETE') AND has_table_privilege('ut_app', 'hrms.department_cost_centres', 'DELETE');` |
| 3 | **V143_53** (autocommit) | Column `settings.hr_configuration.allow_web_punch` (default **TRUE**); `WEB` added to the two punch-method CHECKs on `attendance.records` (add NOT VALID → validate → drop old → rename); `hrms.employee_punch_rules` ("Anywhere") | Safe, no change. Also resumes from any point if it stopped halfway | See the V143_53 check below |
| 4 | V143_54 | `attendance.shift_change_requests.requested_end_date` (+ a CHECK: end ≥ start); `attendance.overtime_rules` | Safe, no change | `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'attendance' AND table_name = 'shift_change_requests' AND column_name = 'requested_end_date') AND has_table_privilege('ut_app', 'attendance.overtime_rules', 'DELETE');` |
| 5 | V143_55 | `hrms.team_messages`, `hrms.team_message_recipients`; permissions `hrms.probation.team.decide`, `hrms.team.message` | Safe, no change | `SELECT count(*) = 6 FROM rbac.role_permissions rp JOIN rbac.roles r ON r.id = rp.role_id WHERE r.tenant_id IS NULL AND rp.permission_code IN ('hrms.probation.team.decide', 'hrms.team.message');` (5 if the database has no built-in MANAGER role) |
| 6 | V143_56 | Permission `hrms.leave.apply.others`; index `leave_mgmt.idx_leave_requests_tenant_dates` | Safe, no change | `SELECT EXISTS (SELECT 1 FROM rbac.role_permissions WHERE role_id = '00000000-0000-0000-0000-000000000010' AND permission_code = 'hrms.leave.apply.others') AND (SELECT indisvalid FROM pg_index WHERE indexrelid = 'leave_mgmt.idx_leave_requests_tenant_dates'::regclass);` |
| 7 | V143_57 | Permission `hrms.expense.claim.others` (no tables) | Safe, no change | `SELECT EXISTS (SELECT 1 FROM rbac.role_permissions WHERE role_id = '00000000-0000-0000-0000-000000000010' AND permission_code = 'hrms.expense.claim.others');` |
| 8 | V143_58 | `payroll.payslip_queries` (Ask payroll) | Safe, no change | `SELECT has_table_privilege('ut_app', 'payroll.payslip_queries', 'INSERT');` |
| 9 | **V143_59** | `hiring_mgmt.candidate_stage_events`, `hiring_mgmt.offer_candidate_emails`, `hrms.asset_confirmations` (**backfilled once**), `hrms.asset_issue_reports` | Safe, and **the backfill never repeats** (it only runs when it creates the table) | `SELECT has_table_privilege('ut_app', 'hrms.asset_confirmations', 'DELETE') AND has_table_privilege('ut_app', 'hrms.asset_issue_reports', 'DELETE') AND has_table_privilege('ut_app', 'hiring_mgmt.candidate_stage_events', 'DELETE');` |
| 10 | V143_60 | `letters.letter_signatures` (sign a letter), `letters.distribution_schedules` (Send on a date) | Safe, no change | `SELECT has_table_privilege('ut_app', 'letters.letter_signatures', 'DELETE') AND has_table_privilege('ut_app', 'letters.distribution_schedules', 'DELETE');` |
| 11 | V143_61 | `performance_mgmt.review_cycle_milestones` (review cycle dates, "hold feedback until shared"), `performance_mgmt.company_kpis` + `goal_kpi_links`, `learning_mgmt.program_locations`, column `learning_mgmt.skill_assessments.certification_name` | Safe, no change | `SELECT has_table_privilege('ut_app', 'performance_mgmt.company_kpis', 'DELETE') AND has_table_privilege('ut_app', 'performance_mgmt.review_cycle_milestones', 'DELETE') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'learning_mgmt' AND table_name = 'skill_assessments' AND column_name = 'certification_name');` |
| 12 | **V143_62** | Replaces `ck_report_schedules_frequency` and `ck_report_schedules_day` on `hrms.report_schedules` to allow `DAILY` and `WEEKDAYS`; adds `send_hour SMALLINT` (7–23, NULL = today's behaviour) | Safe, no change: each rule is swapped only while it still lacks the new values | See the V143_62 check below |
| 13 | V143_65 | `hrms.time_entries.project_id` (+ foreign key, index), `hrms.projects.code`, `hrms.timesheet_weeks`; permission `hrms.timesheet.approve` | Safe, no change | `SELECT EXISTS (SELECT 1 FROM rbac.role_permissions WHERE role_id = '00000000-0000-0000-0000-000000000010' AND permission_code = 'hrms.timesheet.approve') AND has_table_privilege('ut_app', 'hrms.timesheet_weeks', 'DELETE');` |
| 14 | V143_66 | `attendance.overtime_requests` (employees ask for overtime on a day) | Safe, no change | `SELECT has_table_privilege('ut_app', 'attendance.overtime_requests', 'DELETE');` |

An error such as `relation … does not exist` from a check also means "not applied".

**V143_53 check** (expected `t`; all four parts must hold):
```sql
SELECT EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'settings' AND table_name = 'hr_configuration' AND column_name = 'allow_web_punch')
   AND (SELECT count(*) FROM pg_constraint WHERE conrelid = 'attendance.records'::regclass
         AND conname IN ('ck_attendance_records_check_in_method', 'ck_attendance_records_check_out_method')
         AND convalidated AND pg_get_constraintdef(oid) LIKE '%''WEB''%') = 2
   AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'attendance.records'::regclass
                    AND conname LIKE '%\_method\_web')
   AND has_table_privilege('ut_app', 'hrms.employee_punch_rules', 'DELETE');
```

**V143_62 check** (expected `t`; the column, both widened rules, and the range rule):
```sql
SELECT EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'hrms' AND table_name = 'report_schedules' AND column_name = 'send_hour')
   AND (SELECT count(*) FROM pg_constraint WHERE conrelid = 'hrms.report_schedules'::regclass
         AND conname IN ('ck_report_schedules_frequency', 'ck_report_schedules_day')
         AND convalidated AND pg_get_constraintdef(oid) LIKE '%WEEKDAYS%') = 2
   AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'hrms.report_schedules'::regclass
                AND conname = 'ck_report_schedules_send_hour');
```

**Who holds the new permissions** (run after V143_65; compare with step 6):
```sql
SELECT rp.permission_code, string_agg(r.code, ', ' ORDER BY r.code)
  FROM rbac.role_permissions rp JOIN rbac.roles r ON r.id = rp.role_id
 WHERE r.tenant_id IS NULL
   AND rp.permission_code IN ('hrms.team.message', 'hrms.probation.team.decide', 'hrms.leave.apply.others',
                              'hrms.expense.claim.others', 'hrms.timesheet.approve')
 GROUP BY 1 ORDER BY 1;
```
Expected:
```
hrms.expense.claim.others  | ADMIN, FINANCE_LEAD, HR_MANAGER, OWNER, SUPER_ADMIN
hrms.leave.apply.others    | ADMIN, FINANCE_LEAD, HR_MANAGER, OWNER, SUPER_ADMIN
hrms.probation.team.decide | OWNER, SUPER_ADMIN
hrms.team.message          | DEPT_MANAGER, MANAGER, OWNER, SUPER_ADMIN
hrms.timesheet.approve     | DEPT_MANAGER, HR_MANAGER, OWNER, SUPER_ADMIN
```

### 4.3 If the backend is deployed before a migration

What each feature does on the new backend while its file is missing. Checked in the code (every check reads the catalog on each call, nothing is cached) and in Rehearsal B. "503" means `503 FEATURE_NOT_READY`; the web shows a "not available yet" state for that panel only.

| File missing | What happens | Comes alive after the file |
|---|---|---|
| V143_50 | Approve/reject work as before; no Undo is offered; "recent decisions" answers 503 | At once, for decisions made after it |
| V143_52 | Employee drafts answer 503; department cost centre stays empty (saving one answers 503) | At once |
| V143_53 | Web check-in is refused (`WEB_PUNCH_NOT_ALLOWED`; the web says web check-in is off and shows the day read-only); the HR Configuration switch and "Anywhere" answer 503; geofence works as today for everyone | At once |
| V143_54 | Shift change with "Until" answers 503 (without Until it works); overtime rules answer 503 and the 60-minute default minimum applies | At once |
| V143_55 | Team messages answer 503; "Message team" and probation confirm/extend answer 403 (nobody holds the permission) | At once on the server (≤ 60 s); buttons after signing in again |
| V143_56 | "Mark leave" for someone answers 403 and is hidden; leave reads run without the new index | Same as above |
| V143_57 | Claim on someone's behalf answers 403 | Same as above |
| V143_58 | Ask payroll answers 503 (no screen uses it yet) | At once |
| V143_59 | Hiring funnel answers 503; offer email falls back to the candidate's email; asset confirm/problem answer 503; candidate moves are not recorded (the funnel starts counting from when the table exists) | At once |
| V143_60 | Sign a letter and Send on a date answer 503; generating and sending letters work as before; `DistributionScheduleJob` (every 10 min, across all workspaces) returns at once, with no query but a table lookup and no log line (seen at startup and at a 10-minute tick in Rehearsal B) | At once |
| V143_61 | Company KPIs answer 503, and goals show no KPI link. Review cycles keep working, with no step dates; **"hold feedback until shared" counts as off**, so reviews are shown exactly as they are today (nothing is hidden by accident). Learning programs work, with no location. A skill proposal can't name a certification | At once |
| V143_62 | **Report emails keep going out** as weekly and monthly, at 07:05 IST, as today. `GET /v1/reports/schedules/options` answers 200 with `ready:false` and only WEEKLY/MONTHLY, so the screen hides "every day", "every weekday" and the send-time box. Choosing one anyway answers 503 | At once |
| V143_65 | Timesheet projects, Submit week and approvals answer 503 (approvals 403: no permission); plain time entries work as before | Same as V143_55 |
| V143_66 | Overtime requests answer 503 | At once |

Startup is safe in that state: Rehearsal B started the new backend on an unmigrated copy, and the startup check printed `OwnerPermissionInvariantCheck: PASS`.

### 4.4 Optional: web check-in off at launch

Only if the client wants web check-in off for every company at launch (it's on by default). Run after V143_53:
```sql
UPDATE settings.hr_configuration SET allow_web_punch = false;
```
Companies without an HR configuration row still count as on. An admin can switch any company back on in HR Configuration.

### 4.5 If a migration fails halfway

- **Any file except V143_53:** it ran in one transaction, so **nothing from it is applied**. Read the error, fix the cause (usually the login lacks rights, or `lock_timeout` hit because a long query held the table), then run `apply_release2.sh` again **from the top**. The files before it are re-run as no-ops.
- **V143_53:** the statements before the failing one are committed; the file is written to resume. The states it can stop in are all safe for both the old and the new backend:
  - stopped while step a waited for its lock (the rehearsal provoked this): nothing of step a exists; only the new column is there.
  - after step a: a second, NOT VALID copy of each CHECK (named `…_method_web`) exists. Both rules apply to new rows; the new one allows more, so nothing is refused.
  - after step b (validated) but before c/d: the same, just validated.
  - In every case the new backend refuses web check-in until both CHECKs carry `WEB` under their own names.
  Fix the cause and run the script again. It picks up where it stopped.
  - If VALIDATE fails because old rows carry a method the new rule doesn't list (the preflight checks this), the rows must be looked at first. Meanwhile you can remove the extra rule and leave the table as it was:
    ```sql
    ALTER TABLE attendance.records DROP CONSTRAINT IF EXISTS ck_attendance_records_check_in_method_web;
    ALTER TABLE attendance.records DROP CONSTRAINT IF EXISTS ck_attendance_records_check_out_method_web;
    ```
- **Don't restore the backup for a failed migration.** Nothing is lost: every file only adds. Restore only if data is actually wrong.
- **Undoing a whole migration is not needed for a backend rollback:** the previous backend runs on the migrated database (Rehearsal C).

---

## 5. Push and deploy the backend (15 min)

1. Merge the release into `main` and push. The backend workflow (**Deploy backend to Cloud Run**) starts by itself because `backend/**` changed; Vercel starts the web app.
2. Watch the service:
   ```bash
   gcloud run services describe unifiedtree-saas --region asia-south1 --project unifiedtree-prod \
     --format='yaml(status.latestCreatedRevisionName,status.latestReadyRevisionName,status.traffic)'
   ```
   `latestCreatedRevisionName` must equal `latestReadyRevisionName`, with 100% of traffic on it.
3. Startup lines of the new revision:
   ```bash
   gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="unifiedtree-saas" AND resource.labels.revision_name="<REVISION>"' \
     --project unifiedtree-prod --freshness=1h --limit=500 --format='value(textPayload)' \
     | grep -E 'Started HrmsApplication|OwnerPermissionInvariantCheck|Application run failed|FEATURE_NOT_READY'
   ```
   Must show `Started HrmsApplication` and `OwnerPermissionInvariantCheck: PASS`. With the database migrated first, `FEATURE_NOT_READY` should not appear. If it does, the line names the missing table: apply that file (step 4) and reload; no restart is needed.
4. `curl -s https://<service-url>/api/actuator/health` → `{"status":"UP"}`.
5. No new environment variables. Web check-in and face enrollment use the existing face worker (`UNIFIEDTREE_FACE_WORKER_URL`), and browsers allow the camera and location only on https.

**Rollback:** send traffic back to the previous revision (`RUNBOOK.md` §2, about 30 s). Leave the database as it is; the previous backend runs on it.

**During the push** the web app (Vercel, ~2 min) may be live a few minutes before the backend (Cloud Run, ~10 min). In that window the new screens call endpoints the old backend doesn't have yet: those panels show "couldn't load" (404) until the backend is up. Nothing is written wrongly. Tell users to reload once the backend is ready.

---

## 6. New permissions

All five appear on Roles & permissions with a plain-English name, in the module group shown. They are granted to the built-in roles only. Custom roles a workspace made itself don't get them automatically.

| Permission | Shown as | Group | Given to | Risk |
|---|---|---|---|---|
| `hrms.team.message` | Message your team | HRMS | OWNER, SUPER_ADMIN, DEPT_MANAGER, MANAGER | Low |
| `hrms.probation.team.decide` | Confirm or extend team probation | HRMS | OWNER, SUPER_ADMIN only (managers can be given it) | Medium |
| `hrms.leave.apply.others` | Apply for leave for others | Leave | OWNER, SUPER_ADMIN, ADMIN, HR_MANAGER, FINANCE_LEAD | Medium |
| `hrms.expense.claim.others` | Raise expense claims for others | Expense | OWNER, SUPER_ADMIN, ADMIN, HR_MANAGER, FINANCE_LEAD | Medium |
| `hrms.timesheet.approve` | Approve timesheets | Attendance | OWNER, SUPER_ADMIN, HR_MANAGER, DEPT_MANAGER | Medium |

**Not given to ADMIN:** `hrms.team.message`, `hrms.probation.team.decide`, `hrms.timesheet.approve`. Since 26 Sep (V143_18) ADMIN holds everything OWNER has except buying modules and the danger zone, so this is probably an oversight. Ask the owner. To give ADMIN all three:
```sql
INSERT INTO rbac.role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM rbac.roles r
  CROSS JOIN (VALUES ('hrms.team.message'), ('hrms.probation.team.decide'), ('hrms.timesheet.approve')) AS p(code)
 WHERE r.tenant_id IS NULL AND r.code = 'ADMIN'
ON CONFLICT DO NOTHING;
```

---

## 7. Web app (Vercel) (5 min)

- The latest **Production** deployment must be on the pushed commit and **Ready**.
- No new environment variables.
- A quick sign the new web app is live: Home (`/me`) shows the new self-service Home, and the rail has **My team** for managers.

---

## 8. Smoke test, role by role (60 min)

Use real accounts. **Sign out and back in first**, so the new permissions are in your session. Cancel forms rather than saving where a line says so. **Don't process, lock or pay a payroll run**, and don't send a real letter or a real report email to staff.

**Everyone first:** sign in. Home loads with no red error panels. The search dialog opens (type 2 letters of a name) and finds a person, a page and a record. The bell opens the notifications popover.

### Owner (or Admin)
Attendance, team and company:
- [ ] **Org chart** (`/hrms/org-chart`) shows the reporting lines; it's also a tab in Organization setup.
- [ ] **HR Setup → HR Configuration → Attendance rules:** "Allow web check-in" is there and **on**. Don't change it (unless step 4.4 was decided).
- [ ] **Attendance → Shifts & Overtime:** the overtime minimum shows **60 minutes**, no monthly cap. Cancel without saving.
- [ ] **Attendance → Daily Tracking:** today's list loads; a row's ⋮ has **Mark leave** (opens a panel with leave types; cancel).
- [ ] **Attendance → Attendance Analytics** opens for a past month.

Performance, learning and exit (P-GROW):
- [ ] **Performance Center** loads. A review cycle shows its **step dates** (goals by, self-reviews by, manager reviews by, shared on) and the **"hold feedback until shared"** switch. Don't change them.
- [ ] **Company KPIs:** the list loads. Create a test KPI, link nothing to it, then delete it. Its progress shows as the weighted average of linked goals (empty = no progress).
- [ ] **Learning & Skills:** a classroom program shows its **location**. Skill proposals list, and one with a certification shows the name.
- [ ] **Employee exit:** Resignation & Exit and Full & Final Settlement open (don't settle anything).

Reports (P-REPORTS):
- [ ] **Reports Center** opens; download one report.
- [ ] **Report emails:** the frequency list offers **Every day** and **Every weekday** besides Weekly and Monthly, and there's a **send time** (7–23). Set up a test email to yourself only, check it, then delete it. (If "every day" is missing, V143_62 isn't applied: step 4.)
- [ ] **Workforce Analytics** opens.

Letters and documents:
- [ ] **Letters:** preview a letter before saving; the distribution wizard offers **Send on a date**; the scheduled list loads. Cancel.
- [ ] **Employee Vault** and **Docs to Review** open.

Pay:
- [ ] **Payroll Dashboard**, **Salary Structure**, **Processing & Payslips** (open a past run, don't process it), **Payroll Settings**.
- [ ] **Expenses**, **Advances & Loans**, **Production-Linked Incentive**, **Bank Disbursement** open.

Access:
- [ ] **Roles & permissions** lists the five new permissions of step 6 with their names and descriptions.
- [ ] **Profile → Access tab** shows this person's roles and single permissions.

### HR manager
- [ ] **My team → Approvals** (or Attendance → attendance fixes): approve a test request, then **Undo** it within 10 minutes. It returns to pending and the employee is told.
- [ ] **Daily Tracking → Mark leave** for a test employee on a future date; it goes to their approver and they're told. Then cancel it.
- [ ] **Leave Operations Center:** balances, the calendar and approvals load; a holiday can be edited.
- [ ] **Performance:** a cycle's step dates are visible; **Share** a finished test cycle only if the client agrees (it reveals reviews to employees). Otherwise just check the button is there.
- [ ] **Learning:** add a location to a classroom program, then undo it.
- [ ] **Employee record:** Leave and Expenses tabs load; **Enroll / Re-enroll face** is there; the **Access tab** opens.
- [ ] **Timesheet tab:** the team's submitted weeks list loads (may be empty).
- [ ] **Reports:** Reports Center opens; the email frequency list offers every day / every weekday.
- [ ] **Employee Vault / Docs to Review** open.

### Finance lead
- [ ] **Payroll** → Dashboard and a past run (don't process it), **Payroll Settings**.
- [ ] **Expenses:** the claim list, the **Policies** tab and category caps load. **Raise a claim for someone else** is offered (cancel it).
- [ ] **Advances**, **PLI** and **Full & Final Settlement** open.
- [ ] **Bank Disbursement** opens (don't post a file).
- [ ] **Master → Payroll Configuration**: Salary Components and Statutory Settings open.
- [ ] Search only returns what finance may open.

### Department manager
- [ ] **My team → Team today** loads: who's in, on leave, late, probation due.
- [ ] **Message team:** send a short test message; it says how many people it went to, and a team member sees it on Home and in notifications.
- [ ] **Approvals** shows leave, WFH, attendance fixes, shift changes, expenses and timesheet weeks. Approve one test item and Undo it.
- [ ] **Team schedule** shows the week.
- [ ] **Probation:** a team member's date shows, but **Confirm / Extend are not offered** (OWNER/SUPER_ADMIN only; step 6).
- [ ] **Performance:** the team's reviews and goals; a goal can be linked to a **company KPI**.
- [ ] Manager **Home**: "Needs you" lists what's waiting.

### Employee
- [ ] **Home:** my requests, needs you, around me (who's off, birthdays), team messages.
- [ ] **Web check-in** (https, at the office, face enrolled): Attendance → Check in → camera and location → checked in. Outside the geofence: "Outside the work area". Check out the same way.
- [ ] **Timesheet:** add an entry (with a project, if the company has projects) and **Submit week**. The manager sees it; once approved the week is locked.
- [ ] **Overtime request:** My shift → ask for overtime with a reason, then withdraw it.
- [ ] **Shift change with Until:** request a temporary change with an end date, then withdraw it.
- [ ] **My leave:** apply for leave, then cancel it.
- [ ] **My pay:** Payslips and Salary open; a locked or paid payslip offers **Ask payroll** only once its screen ships (the backend is live either way).
- [ ] **My growth:** Reviews & goals (a review shows its **due date** from the cycle), Learning (a classroom program shows its **location**), and a skill proposal can name a **certification**.
- [ ] **My documents:** Letters → a letter asking for a signature shows **Sign** (don't sign a real one), My documents and **My assets** (issued equipment shows as received, from the V143_59 backfill).
- [ ] **Expense claims** and **Advances** open from My pay.
- [ ] The **mobile app** still signs in and punches as before.

If something fails: DevTools → Network, find the red request. `503 FEATURE_NOT_READY` = a migration is missing (run `apply_release2.sh --status`). `404` on a new endpoint = the old backend is still serving (step 5). `403` on a new button = sign out and back in.

---

## 9. Mobile app: new notification types it doesn't know

The mobile app (`SRC-ORGanisation/attendance`, `types/notification.types.ts`) lists 20 types. Release 2 adds 14 more (13 have a sender in this release). The app shows them in its list with the default bell icon and their title and text; nothing crashes. Tapping one follows its `route`. Six routes are web addresses the phone app doesn't have, so those taps will probably land on the app's "unmatched route" screen (check on a phone).

| Type | Sent when | Route the phone gets |
|---|---|---|
| `OVERTIME_REQUESTED` | an employee asks for overtime (to the approver) | `/hrms/shifts?tab=overtime` (web) |
| `DECISION_UNDONE` | an approver takes a decision back | `/leave-history`, `/wfh-apply`, `/my-corrections`, `/shift-change` or `/my-claims` |
| `CHECKIN_REMINDER` | a manager/HR reminds someone to check in | `/(tabs)` |
| `PERFORMANCE_REVIEW_REMINDER` | HR presses Remind on a review | not sent yet: in the catalog, no sender in this release |
| `TEAM_MESSAGE` | a manager messages the team | `/notifications` |
| `ASSET_ISSUE_REPORTED` | an employee reports an asset problem (to HR) | `/hrms/onboarding/instances?view=assets` (web) |
| `PAYSLIP_QUERY_RAISED` | an employee asks payroll (to the payroll team) | `/hrms/payroll-dashboard` (web) |
| `PAYSLIP_QUERY_ANSWERED` | payroll answers | `/me/payslips` (web) |
| `LEAVE_APPLIED_ON_BEHALF` | HR applies leave in your name | `/leave-history` |
| `EXPENSE_CLAIM_RAISED_FOR_YOU` | HR/finance raises a claim in your name | `/my-claims` (not in the phone app; same as today's expense notifications) |
| `TIMESHEET_SUBMITTED` | someone submits a week (to the approver) | `/requests-tab` |
| `TIMESHEET_DECIDED` | the week is approved/rejected | none |
| `LETTER_SIGNATURE_REQUESTED` | HR asks you to sign a letter | `/hrms/letters/my` (web) |
| `PROBATION_TEAM_DECISION` | a manager confirms/extends probation | `/notifications` |

For the mobile team: add the 14 names to `NotificationType` and an icon each, and decide where the web-only routes should go on the phone.

---

## 10. Open questions for the owner

> **The owner approved Release 2 on 2 Oct.** Question 1 below was answered: **apply all 14 now.** The rest are still open.

1. **Apply the files whose screens aren't built yet now, or with their screens?** — **decided: all 14 now.** Kept here for the record.

   | File | Screen in Release 2? | If applied now | If applied later, with its screens |
   |---|---|---|---|
   | V143_52 employee drafts, cost centres | No | Two empty tables; nothing visible | A second manual DB window later. Nothing is lost meanwhile |
   | V143_56 leave on behalf | **Yes**: Daily Tracking → **Mark leave** | Mark leave works for HR, admins, finance, owner | Mark leave stays hidden (403). **So apply it now** |
   | V143_57 expense on behalf | No | A permission on Roles & permissions that no screen uses yet; the API works if called directly | Later window; nothing is lost |
   | V143_58 Ask payroll | No | One empty table; nothing visible | Later window; nothing is lost |
   | V143_61 performance milestones, company KPIs, learning details | **Yes**: Performance Center and Learning & Skills | Review dates, company KPIs and program locations work | Those panels stay unavailable. **So apply it now** |
   | V143_62 report daily/weekday/send-hour | **Yes**: Reports Center's email setup | Every day / every weekday / send time can be chosen | The new choices stay hidden; weekly and monthly keep working. **So apply it now** |
   | V143_59 hiring history, offer email, asset care | No | **Hiring stage history starts recording today**, so the funnel is exact from today. The asset backfill marks today's issued assets as received; anything handed over between now and the asset screens' release waits for the employee to confirm it | The funnel starts counting only from that later day (moves in between are never recorded). The backfill then covers everything handed over until that day |

   **Recommendation (adopted): apply all 14 now.** One database window instead of several. Each file is additive and re-runnable. The backend for these packages already ships in this release, so their later screens become a web-only deploy. The one real trade-off is V143_59's asset cut-off date. If the owner prefers to postpone something, V143_52, V143_57 and V143_58 can simply be left out of the script's list. V143_59 is the only one where the date you run it changes the result.
2. **ADMIN and three new permissions** (step 6): give ADMIN `hrms.team.message`, `hrms.probation.team.decide` and `hrms.timesheet.approve`, as V143_18's rule would suggest?
3. **Web check-in on for every company at launch** (client decision, 1 Oct): still wanted? The production face worker URL must be the real one (`provision.sh` has a placeholder).
4. **Mobile:** add the 14 notification types and decide where the six web-only routes go on the phone (step 9).
5. **Custom roles** that a workspace created don't get the new permissions. Fine as is, or should a later migration add them?
6. **Merging `rd/int` into `main`:** `main` carries Release 1 and 1.1 as its own commits (`accff811`, `11d3fbf8`, `6820b10f`, `00b66620`), which `rd/int` doesn't contain, although it has the same work. The merge needs to be prepared before step 5. Main's backend is unchanged since `e32a4dc6`, so the migration list above is complete.

---

## 11. When it's done

Run `bash apply_release2.sh --status` one last time (all `t`), save `release2-migrations.log` with the deploy notes, and tell the team it's live.
