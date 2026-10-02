#!/usr/bin/env bash
# Release 2 database migrations (V143_50 -> V143_66, 14 files), applied by hand with psql.
# Read DEPLOY_RELEASE_2.md first. This script is step 4 of that checklist.
#
# Run it from the root of a checkout of the release commit (the files are read
# from backend/app/hrms-app/src/main/resources/db/canonical).
#
#   export PROD_URL='host=127.0.0.1 port=6543 dbname=railway user=<superuser>'   # or a postgresql:// URL
#   export PGPASSWORD='<password>'          # or use ~/.pgpass
#   bash apply_release2.sh                  # preflight, then every file in order, each one checked
#   bash apply_release2.sh --status         # only prints the status of the 14 files; changes nothing
#
# What it does for each file:
#   - runs it with  psql -X -v ON_ERROR_STOP=1  (and --single-transaction, except V143_53)
#   - then runs that file's check query; it must print  t
#   - stops at the first error or the first check that is not t
#
# Every file is safe to run again, so after fixing a failure just run the whole
# script again from the top (see "If a migration fails" in DEPLOY_RELEASE_2.md).
#
# Options (environment variables):
#   PSQL=<path to psql>          default: psql
#   MIGRATIONS_DIR=<dir>         default: backend/app/hrms-app/src/main/resources/db/canonical
#   LOCK_TIMEOUT=<duration>      default: 10s. A statement that waits longer than this for a
#                                table lock gives up instead of queueing every punch / leave
#                                request behind it. The file then stops; run the script again.

set -uo pipefail

: "${PROD_URL:?Set PROD_URL to the production connection string (a superuser login), e.g. host=127.0.0.1 port=6543 dbname=railway user=postgres}"
PSQL="${PSQL:-psql}"
DIR="${MIGRATIONS_DIR:-backend/app/hrms-app/src/main/resources/db/canonical}"
LOCK_TIMEOUT="${LOCK_TIMEOUT:-10s}"
export PGOPTIONS="${PGOPTIONS:-} -c lock_timeout=${LOCK_TIMEOUT}"

OWNER="'00000000-0000-0000-0000-000000000010'"

# -X: ignore ~/.psqlrc (a psqlrc with AUTOCOMMIT off would break V143_53's autocommit run).
q() { "$PSQL" "$PROD_URL" -X -At -v ON_ERROR_STOP=1 -c "$1"; }

# ── the 14 files, in the order they must run ──────────────────────────────────
# mode: tx   = psql --single-transaction (the whole file or nothing)
#       auto = psql autocommit, each statement commits on its own (V143_53 only)
FILES=(
  "V143_50__approval_decision_journal.sql|tx"
  "V143_52__employee_drafts_and_department_cost_centres.sql|tx"
  "V143_53__attendance_web_punch_and_punch_rules.sql|auto"
  "V143_54__shift_change_until_and_overtime_rules.sql|tx"
  "V143_55__team_messages_and_team_permissions.sql|tx"
  "V143_56__leave_apply_for_others_and_dates_index.sql|tx"
  "V143_57__expense_claim_on_behalf_permission.sql|tx"
  "V143_58__payslip_questions.sql|tx"
  "V143_59__hiring_history_offer_email_asset_care.sql|tx"
  "V143_60__letter_signatures_and_scheduled_distributions.sql|tx"
  "V143_61__review_milestones_company_kpis_learning_details.sql|tx"
  "V143_62__report_schedule_daily_weekdays_send_hour.sql|tx"
  "V143_65__timesheet_projects_and_weeks.sql|tx"
  "V143_66__overtime_requests.sql|tx"
)

# ── one check per file: prints t once the whole file has run ──────────────────
# Each one looks at the LAST thing the file does (its grants), plus its key object.
grant_ok() {  # table, privilege -> SQL that is true when ut_app holds it (false, not an error, if the table is missing)
  echo "(CASE WHEN to_regclass('$1') IS NULL THEN false ELSE has_table_privilege('ut_app', '$1', '$2') END)"
}
perm_ok() {   # permission code, comma-separated quoted role codes: true when every one of those built-in roles holds it
  echo "((SELECT count(*) FROM rbac.role_permissions rp JOIN rbac.roles r ON r.id = rp.role_id WHERE r.tenant_id IS NULL AND rp.permission_code = '$1' AND r.code IN ($2))
         = (SELECT count(*) FROM rbac.roles WHERE tenant_id IS NULL AND code IN ($2)) AND EXISTS (SELECT 1 FROM rbac.role_permissions WHERE role_id = $OWNER AND permission_code = '$1'))"
}
check_sql() {
  case "$1" in
    V143_50) echo "SELECT $(grant_ok hrms.approval_decisions INSERT)" ;;
    V143_52) echo "SELECT $(grant_ok hrms.employee_drafts DELETE) AND $(grant_ok hrms.department_cost_centres DELETE)" ;;
    V143_53) echo "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'settings' AND table_name = 'hr_configuration' AND column_name = 'allow_web_punch')
                AND (SELECT count(*) FROM pg_constraint WHERE conrelid = 'attendance.records'::regclass
                      AND conname IN ('ck_attendance_records_check_in_method', 'ck_attendance_records_check_out_method')
                      AND convalidated AND pg_get_constraintdef(oid) LIKE '%''WEB''%') = 2
                AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'attendance.records'::regclass AND conname LIKE '%\\_method\\_web')
                AND $(grant_ok hrms.employee_punch_rules DELETE)" ;;
    V143_54) echo "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'attendance' AND table_name = 'shift_change_requests' AND column_name = 'requested_end_date')
                AND $(grant_ok attendance.overtime_rules DELETE)" ;;
    V143_55) echo "SELECT $(perm_ok hrms.probation.team.decide "'OWNER','SUPER_ADMIN'")
                AND $(perm_ok hrms.team.message "'OWNER','SUPER_ADMIN','DEPT_MANAGER','MANAGER'")
                AND $(grant_ok hrms.team_message_recipients DELETE)" ;;
    V143_56) echo "SELECT $(perm_ok hrms.leave.apply.others "'OWNER','SUPER_ADMIN','ADMIN','HR_MANAGER','FINANCE_LEAD'")
                AND EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid = to_regclass('leave_mgmt.idx_leave_requests_tenant_dates') AND i.indisvalid)" ;;
    V143_57) echo "SELECT $(perm_ok hrms.expense.claim.others "'OWNER','SUPER_ADMIN','ADMIN','HR_MANAGER','FINANCE_LEAD'")" ;;
    V143_58) echo "SELECT $(grant_ok payroll.payslip_queries INSERT)" ;;
    V143_59) echo "SELECT $(grant_ok hiring_mgmt.candidate_stage_events DELETE) AND $(grant_ok hiring_mgmt.offer_candidate_emails DELETE)
                AND $(grant_ok hrms.asset_confirmations DELETE) AND $(grant_ok hrms.asset_issue_reports DELETE)" ;;
    V143_60) echo "SELECT $(grant_ok letters.letter_signatures DELETE) AND $(grant_ok letters.distribution_schedules DELETE)" ;;
    V143_61) echo "SELECT $(grant_ok performance_mgmt.review_cycle_milestones DELETE) AND $(grant_ok performance_mgmt.company_kpis DELETE)
                AND $(grant_ok performance_mgmt.goal_kpi_links DELETE) AND $(grant_ok learning_mgmt.program_locations DELETE)
                AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'learning_mgmt' AND table_name = 'skill_assessments' AND column_name = 'certification_name')" ;;
    V143_62) echo "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'hrms' AND table_name = 'report_schedules' AND column_name = 'send_hour')
                AND (SELECT count(*) FROM pg_constraint WHERE conrelid = 'hrms.report_schedules'::regclass
                      AND conname IN ('ck_report_schedules_frequency', 'ck_report_schedules_day')
                      AND convalidated AND pg_get_constraintdef(oid) LIKE '%WEEKDAYS%') = 2
                AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'hrms.report_schedules'::regclass AND conname = 'ck_report_schedules_send_hour')" ;;
    V143_65) echo "SELECT $(perm_ok hrms.timesheet.approve "'OWNER','SUPER_ADMIN','HR_MANAGER','DEPT_MANAGER'")
                AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'hrms' AND table_name = 'time_entries' AND column_name = 'project_id')
                AND $(grant_ok hrms.timesheet_weeks DELETE)" ;;
    V143_66) echo "SELECT $(grant_ok attendance.overtime_requests DELETE)" ;;
  esac
}

status() {
  local all=0
  for entry in "${FILES[@]}"; do
    local f="${entry%%|*}" v; v="${f%%__*}"
    local r; r=$(q "$(check_sql "$v")" 2>&1) || r="error: $r"
    printf '  %-8s %s\n' "$v" "$r"
    [ "$r" = "t" ] || all=1
  done
  return $all
}

if [ "${1:-}" = "--status" ]; then
  echo "Release 2 migration status (t = applied):"
  status
  exit 0
fi

# ── preflight: stop before changing anything if the database isn't ready ──────
echo "== preflight"
fail=0
pf() {  # label, SQL that must print t
  local r; r=$(q "$2" 2>&1) || r="error: $r"
  printf '  %-62s %s\n' "$1" "$r"
  [ "$r" = "t" ] || fail=1
}
pf "this login is a superuser or bypasses row-level security" \
   "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user"
pf "the app role ut_app exists (the grants go to it)" \
   "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ut_app')"
pf "V143_40 (last migration of the 26 Sep deploy) is applied" \
   "SELECT EXISTS (SELECT 1 FROM rbac.role_permissions WHERE role_id = $OWNER AND permission_code = 'attendance.assisted_punch.any')"
pf "current_tenant_id() exists (used by every new RLS policy)" \
   "SELECT to_regprocedure('public.current_tenant_id()') IS NOT NULL"
pf "every punch method in attendance.records is one V143_53 allows" \
   "SELECT NOT EXISTS (SELECT 1 FROM attendance.records
      WHERE (check_in_method  IS NOT NULL AND check_in_method::text  NOT IN ('MANUAL','FACE_RECOGNITION','BIOMETRIC_FINGERPRINT','MOBILE_GPS','KIOSK','GEO_FENCE','API','GPS','PIN','MANAGER_OVERRIDE','BIOMETRIC_DEVICE','WEB'))
         OR (check_out_method IS NOT NULL AND check_out_method::text NOT IN ('MANUAL','FACE_RECOGNITION','BIOMETRIC_FINGERPRINT','MOBILE_GPS','KIOSK','GEO_FENCE','API','GPS','PIN','MANAGER_OVERRIDE','BIOMETRIC_DEVICE','WEB')))"
pf "every report schedule's frequency is one V143_62 allows"    "SELECT NOT EXISTS (SELECT 1 FROM hrms.report_schedules WHERE frequency NOT IN ('WEEKLY', 'MONTHLY', 'DAILY', 'WEEKDAYS'))
       OR to_regclass('hrms.report_schedules') IS NULL"
pf "every report schedule still names the day its frequency needs"    "SELECT to_regclass('hrms.report_schedules') IS NULL
       OR NOT EXISTS (SELECT 1 FROM hrms.report_schedules
                       WHERE NOT ((frequency = 'WEEKLY' AND day_of_week IS NOT NULL)
                               OR (frequency = 'MONTHLY' AND day_of_month IS NOT NULL)
                               OR (frequency IN ('DAILY', 'WEEKDAYS') AND day_of_week IS NULL AND day_of_month IS NULL)))"
if [ "$fail" -ne 0 ]; then
  echo "STOPPED: a preflight check is not t. Nothing was changed. See DEPLOY_RELEASE_2.md step 3."
  exit 2
fi

# ── apply ─────────────────────────────────────────────────────────────────────
echo "== applying (lock_timeout=${LOCK_TIMEOUT})"
for entry in "${FILES[@]}"; do
  f="${entry%%|*}"; mode="${entry##*|}"; v="${f%%__*}"
  [ -f "$DIR/$f" ] || { echo "STOPPED: $DIR/$f not found. Run this from the root of the release checkout."; exit 3; }
  start=$(date +%s)
  if [ "$mode" = "tx" ]; then
    echo "-- $f  (one transaction)"
    "$PSQL" "$PROD_URL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$DIR/$f" \
      || { echo "STOPPED at $f: it failed and was rolled back (nothing from this file is applied). Fix the cause, then run this script again."; exit 4; }
  else
    echo "-- $f  (autocommit: each statement on its own; NOT one transaction)"
    "$PSQL" "$PROD_URL" -X -q -v ON_ERROR_STOP=1 -f "$DIR/$f" \
      || { echo "STOPPED at $f: the statements before the failing one ARE applied. The file is written to resume: fix the cause, then run this script again."; exit 4; }
  fi
  r=$(q "$(check_sql "$v")" 2>&1) || r="error: $r"
  echo "   check: $r   ($(( $(date +%s) - start ))s)"
  [ "$r" = "t" ] || { echo "STOPPED: the check for $v is not t. See DEPLOY_RELEASE_2.md step 4.2."; exit 5; }
done

echo "== all 14 applied. Status:"
status && echo "DONE: every Release 2 migration reads t."
