const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: 'postgresql://postgres:PDCfIAyzVhxfrEkhYvfpBGzdgqasJnav@thomas.proxy.rlwy.net:29991/railway'
  });
  await client.connect();

  console.log("ROLES:");
  const roles = await client.query(`SELECT * FROM rbac.roles`);
  console.log(roles.rows);

  console.log("USER ROLES:");
  const userRoles = await client.query(`SELECT * FROM rbac.user_roles`);
  console.log(userRoles.rows);

  await client.end();
}

main().catch(console.error);
