const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: 'postgresql://postgres:PDCfIAyzVhxfrEkhYvfpBGzdgqasJnav@thomas.proxy.rlwy.net:29991/railway'
  });
  await client.connect();

  console.log('Altering audit.events.actor_ip from inet -> varchar(45)...');
  await client.query(`
    ALTER TABLE audit.events
      ALTER COLUMN actor_ip TYPE varchar(45) USING actor_ip::text;
  `);
  console.log('Done.');

  await client.end();
}

main().catch(err => { console.error(err); process.exit(1); });
