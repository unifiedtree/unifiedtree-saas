const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, 'backend', '.env.railway');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .reduce((acc, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return acc;
      const idx = trimmed.indexOf('=');
      if (idx === -1) return acc;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      acc[key] = value;
      return acc;
    }, {});
}

function toPgConnectionString(raw) {
  if (!raw) return '';
  return raw.replace(/^jdbc:/, '');
}

function pgConfig(rawUrl, dbUser, dbPassword) {
  const url = new URL(rawUrl);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    database: decodeURIComponent(url.pathname.replace(/^\//, '')),
    user: dbUser || (url.username ? decodeURIComponent(url.username) : undefined),
    password: dbPassword || (url.password ? decodeURIComponent(url.password) : undefined),
    ssl: url.hostname === 'localhost' || url.hostname === '127.0.0.1'
      ? false
      : { rejectUnauthorized: false },
  };
}

function qualify(table) {
  return `"${table.schema_name}"."${table.table_name}"`;
}

async function countTable(client, schema, table) {
  const exists = await client.query('SELECT to_regclass($1) AS oid', [`${schema}.${table}`]);
  if (!exists.rows[0].oid) return null;
  const result = await client.query(`SELECT COUNT(*)::bigint AS count FROM "${schema}"."${table}"`);
  return Number(result.rows[0].count);
}

async function main() {
  if (!process.argv.includes('--confirm-wipe')) {
    console.error('Refusing to run without --confirm-wipe');
    process.exit(1);
  }

  const fileEnv = loadEnvFile(envPath);
  const env = { ...fileEnv, ...process.env };
  const connectionString = toPgConnectionString(env.DATABASE_URL || env.DB_URL);
  if (!connectionString) {
    throw new Error('DATABASE_URL or DB_URL is required');
  }
  const dbUser = env.DB_USERNAME ? String(env.DB_USERNAME) : undefined;
  const dbPassword = env.DB_PASSWORD ? String(env.DB_PASSWORD) : undefined;

  const client = new Client(pgConfig(connectionString, dbUser, dbPassword));

  await client.connect();

  const trackedTables = [
    ['platform', 'tenants'],
    ['platform', 'tenant_domains'],
    ['platform', 'tenant_modules'],
    ['platform', 'accounts'],
    ['platform', 'account_workspaces'],
    ['auth', 'user_credentials'],
    ['auth', 'refresh_tokens'],
    ['rbac', 'user_roles'],
    ['org', 'companies'],
    ['hrms', 'employees'],
    ['attendance', 'records'],
    ['leave_mgmt', 'leave_requests'],
  ];

  console.log('Connected to Railway database. Customer-data reset starting.');
  console.log('Counts before wipe:');
  for (const [schema, table] of trackedTables) {
    const count = await countTable(client, schema, table);
    if (count !== null) console.log(`  ${schema}.${table}: ${count}`);
  }

  const preserve = new Set([
    'platform.module_catalog',
    'rbac.roles',
    'rbac.permissions',
    'rbac.role_permissions',
  ]);
  const managedSchemas = [
    'platform',
    'auth',
    'rbac',
    'org',
    'hrms',
    'attendance',
    'leave_mgmt',
    'settings',
    'audit',
    'letters',
  ];

  const tablesResult = await client.query(
    `
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_inherits i ON i.inhrelid = c.oid
    WHERE c.relkind IN ('r', 'p')
      AND n.nspname = ANY($1)
      AND i.inhrelid IS NULL
    ORDER BY n.nspname, c.relname
    `,
    [managedSchemas]
  );

  const tables = tablesResult.rows.filter(
    (row) => !preserve.has(`${row.schema_name}.${row.table_name}`)
  );

  for (const publicTable of ['geo_fence_audits', 'geo_fence_zones']) {
    const exists = await client.query('SELECT to_regclass($1) AS oid', [`public.${publicTable}`]);
    if (exists.rows[0].oid) {
      tables.push({ schema_name: 'public', table_name: publicTable });
    }
  }

  if (tables.length === 0) {
    console.log('No customer tables found to truncate.');
  } else {
    await client.query('BEGIN');
    try {
      const sql = `TRUNCATE TABLE ${tables.map(qualify).join(', ')} CASCADE`;
      await client.query(sql);
      await client.query('COMMIT');
      console.log(`Truncated ${tables.length} customer-data tables.`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  console.log('Counts after wipe:');
  for (const [schema, table] of trackedTables) {
    const count = await countTable(client, schema, table);
    if (count !== null) console.log(`  ${schema}.${table}: ${count}`);
  }

  console.log('Preserved catalog counts:');
  for (const [schema, table] of [['rbac', 'roles'], ['rbac', 'permissions'], ['rbac', 'role_permissions'], ['platform', 'module_catalog']]) {
    const count = await countTable(client, schema, table);
    if (count !== null) console.log(`  ${schema}.${table}: ${count}`);
  }

  await client.end();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
