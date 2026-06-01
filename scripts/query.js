const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: 'postgresql://postgres:THYqKkKaGSWTkIciCKnpTUkqpbpQdElx@junction.proxy.rlwy.net:22145/railway'
  });
  await client.connect();

  const tables = [
    'auth.user_credentials',
    'rbac.user_roles',
    'hrms.employees',
    'attendance.records',
    'attendance.event_logs'
  ];

  for (const t of tables) {
    const [schema, name] = t.split('.');
    const res = await client.query(`
      SELECT column_name, data_type, column_default, is_nullable
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position;
    `, [schema, name]);
    console.log(`\nTable: ${t}`);
    res.rows.forEach(r => {
      console.log(`  ${r.column_name} (${r.data_type}) [${r.is_nullable === 'YES' ? 'null' : 'not null'}] default: ${r.column_default}`);
    });
  }

  await client.end();
}

main().catch(console.error);
