const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: 'postgresql://postgres:PDCfIAyzVhxfrEkhYvfpBGzdgqasJnav@thomas.proxy.rlwy.net:29991/railway'
  });
  await client.connect();

  const tables = [
    ['org.companies',       'SELECT id, name FROM org.companies'],
    ['hrms.employees',      'SELECT id, first_name, last_name, email FROM hrms.employees'],
    ['auth.user_credentials','SELECT id, email FROM auth.user_credentials'],
    ['rbac.tenants',        'SELECT id, subdomain FROM rbac.tenants'],
  ];

  for (const [label, sql] of tables) {
    try {
      const r = await client.query(sql);
      console.log(`\n── ${label} (${r.rowCount} rows) ──`);
      console.log(r.rows);
    } catch (e) {
      console.log(`\n── ${label}: ERROR: ${e.message}`);
    }
  }

  await client.end();
}

main().catch(err => { console.error(err); process.exit(1); });
