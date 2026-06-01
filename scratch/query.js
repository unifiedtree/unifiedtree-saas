const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: 'postgresql://postgres:THYqKkKaGSWTkIciCKnpTUkqpbpQdElx@junction.proxy.rlwy.net:22145/railway'
  });
  await client.connect();
  
  const res = await client.query("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ck_attendance_records_check_out_method'");
  console.log("Constraint:", res.rows);

  await client.end();
}

main().catch(console.error);
