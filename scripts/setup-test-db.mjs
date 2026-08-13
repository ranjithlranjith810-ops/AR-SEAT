import 'dotenv/config';
import pg from 'pg';

const directUrl = process.env.DIRECT_URL;
const testUrl = process.env.TEST_DATABASE_URL;

if (!directUrl || !testUrl) {
  console.error('DIRECT_URL and TEST_DATABASE_URL must be configured.');
  process.exit(1);
}

const dbName = decodeURIComponent(new URL(testUrl).pathname.slice(1).split('?')[0]);
const adminUrl = new URL(directUrl.replace(/[?&]sslmode=[^&]*/, ''));
adminUrl.pathname = '/postgres';

const client = new pg.Client({ connectionString: adminUrl.toString(), ssl: { rejectUnauthorized: false } });
try {
  await client.connect();
  const res = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (res.rowCount === 0) {
    await client.query(`CREATE DATABASE ${JSON.stringify(dbName).replace(/"/g, '"')}`);
    console.log(`Created test database "${dbName}".`);
  } else {
    console.log(`Test database "${dbName}" already exists.`);
  }
} catch (e) {
  console.error('ERR', e.message);
  process.exit(1);
} finally {
  await client.end();
}