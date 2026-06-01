const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: 'postgresql://postgres:THYqKkKaGSWTkIciCKnpTUkqpbpQdElx@junction.proxy.rlwy.net:22145/railway'
  });
  await client.connect();

  const tenantId = 'b8110ce6-1d29-492b-845e-3cb7ffb0a320';

  console.log("ROLES:");
  const roles = await client.query(`SELECT * FROM rbac.roles WHERE tenant_id = $1`, [tenantId]);
  console.log(roles.rows);

  console.log("COMPANIES:");
  const companies = await client.query(`SELECT * FROM org.companies WHERE tenant_id = $1`, [tenantId]);
  console.log(companies.rows);

  console.log("DEPARTMENTS:");
  const departments = await client.query(`SELECT * FROM hrms.departments WHERE tenant_id = $1`, [tenantId]);
  console.log(departments.rows);

  await client.end();
}

main().catch(console.error);
