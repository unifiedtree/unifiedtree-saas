const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: 'postgresql://postgres:PDCfIAyzVhxfrEkhYvfpBGzdgqasJnav@thomas.proxy.rlwy.net:29991/railway'
  });
  await client.connect();

  // Find surya tenant
  const tenant = await client.query(`SELECT * FROM org.tenants WHERE subdomain = 'surya'`);
  console.log('Tenant:', tenant.rows);

  if (tenant.rows.length === 0) {
    console.log('No surya tenant found - checking all tenants:');
    const all = await client.query(`SELECT id, subdomain, name FROM org.tenants ORDER BY created_at DESC LIMIT 10`);
    console.log(all.rows);
    await client.end(); return;
  }

  const tenantId = tenant.rows[0].id;

  const companies = await client.query(`SELECT id, name FROM org.companies WHERE tenant_id = $1`, [tenantId]);
  console.log(`\nCompanies for surya (${tenantId}):`, companies.rows);

  const employees = await client.query(`SELECT id, first_name, last_name, email FROM hrms.employees WHERE tenant_id = $1`, [tenantId]);
  console.log(`\nEmployees for surya (${tenantId}):`, employees.rows);

  await client.end();
}

main().catch(err => { console.error(err); process.exit(1); });
