// Runs live-rd-theme (both themes, every role) WITH unread notifications present, so the bell's
// unread count is on screen and its contrast is checked. Gives each demo person one unread
// notification in the disposable database (RECOVERY_DB, ut_w3_dev only), runs the theme test,
// then deletes them. Exit code = the theme test's.
//
//   node e2e/recovery/live-rd-f3b-theme-badge.mjs      (inside the live slot)
import { execFileSync, spawnSync } from 'node:child_process'

const db = process.env.RECOVERY_DB || 'ut_w3_dev'
if (db !== 'ut_w3_dev') { console.error(`refusing to write fixtures to ${db}: run this inside the live slot (ut_w3_dev)`); process.exit(2) }
const psql = process.env.PSQL || 'C:/Program Files/PostgreSQL/18/bin/psql.exe'
const sql = (q) => execFileSync(psql, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', q],
  { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8' }).trim()

const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const marker = `f3b-badge-${Date.now()}`
sql(`INSERT INTO notif.notifications(tenant_id, user_id, type, title, body, data)
     SELECT '${tenant}', uc.employee_id, 'GENERAL', 'Contrast check', '${marker}', '{}'::jsonb
       FROM auth.user_credentials uc
      WHERE uc.tenant_id = '${tenant}' AND uc.employee_id IS NOT NULL
        AND uc.email IN ('owner@unifiedtree.demo', 'hrm@unifiedtree.demo', 'fin@unifiedtree.demo', 'mgr@unifiedtree.demo', 'reader@unifiedtree.demo')`)
console.log(`fixture: ${sql(`SELECT count(*) FROM notif.notifications WHERE body = '${marker}'`)} unread notifications added`)
let code = 1
try {
  const r = spawnSync(process.execPath, ['e2e/recovery/live-rd-theme.mjs'], { stdio: 'inherit', env: process.env })
  code = r.status ?? 1
} finally {
  sql(`DELETE FROM notif.notifications WHERE body = '${marker}'`)
  console.log(`cleanup: test notifications deleted (${sql(`SELECT count(*) FROM notif.notifications WHERE body = '${marker}'`)} left)`)
}
process.exit(code)
