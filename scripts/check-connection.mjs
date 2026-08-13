import 'dotenv/config';
import pg from 'pg';

const url = process.argv[2] || process.env.DIRECT_URL;
if (!url) {
  console.error('No DIRECT_URL configured.');
  process.exit(1);
}
const sanitized = url.replace(/[?&]sslmode=[^&]*/, '');
const c = new pg.Client({ connectionString: sanitized, ssl: { rejectUnauthorized: false } });
try {
  await c.connect();
  const r = await c.query('select current_database(), current_user');
  console.log(JSON.stringify(r.rows[0]));
  const dbs = await c.query("select datname from pg_database where datistemplate=false order by datname");
  console.log('databases:', dbs.rows.map((x) => x.datname).join(', '));
  const tabs = await c.query(
    "select count(*)::int as n from information_schema.tables where table_schema='public'"
  );
  console.log('public tables in current db:', tabs.rows[0].n);
} catch (e) {
  console.error('ERR', e.message);
  process.exit(1);
} finally {
  await c.end();
}