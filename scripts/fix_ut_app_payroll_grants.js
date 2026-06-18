// Grants USAGE on payroll schema + SELECT/INSERT/UPDATE/DELETE on all payroll
// tables to ut_app. Run this if DB_USERNAME in Railway dashboard is 'ut_app'.
// Safe to run as postgres superuser — idempotent (GRANT is no-op if already granted).

const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: 'postgresql://postgres:PDCfIAyzVhxfrEkhYvfpBGzdgqasJnav@thomas.proxy.rlwy.net:29991/railway'
  });
  await client.connect();

  await client.query('GRANT USAGE ON SCHEMA payroll TO ut_app');
  console.log('✓ GRANT USAGE ON SCHEMA payroll TO ut_app');

  const tables = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'payroll' AND table_type = 'BASE TABLE' ORDER BY table_name"
  );

  for (const row of tables.rows) {
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON payroll.${row.table_name} TO ut_app`);
    console.log(`✓ GRANT on payroll.${row.table_name}`);
  }

  // Verify
  const check = await client.query(
    "SELECT has_schema_privilege('ut_app', 'payroll', 'USAGE') AS has_usage"
  );
  console.log('\nVerification:', check.rows[0]);
  console.log('Done — ut_app can now access all payroll tables.');

  await client.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
