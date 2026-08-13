import 'dotenv/config';
import pg from 'pg';

const url = (process.argv[2] || process.env.DIRECT_URL).replace(/[?&]sslmode=[^&]*/, '');
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
try {
  await c.connect();
  const fns = await c.query("select proname from pg_proc where proname like 'es_%' order by proname");
  console.log('functions:', fns.rows.map((r) => r.proname).join(', ') || '(none)');
  const idx = await c.query(
    `select indexname from pg_indexes where schemaname='public'
     and indexname in ('seating_plans_one_published_per_exam','solve_jobs_one_active_per_exam') order by indexname`
  );
  console.log('manual idx:', idx.rows.map((r) => r.indexname).join(', ') || '(none)');
  const trg = await c.query(
    "select t.tgname, c.relname from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal and c.relname not like 'pg_%' and c.relnamespace = 'public'::regnamespace order by t.tgname"
  );
  console.log('triggers:', trg.rows.map((r) => `${r.tgname}@${r.relname}`).join(', ') || '(none)');
  const counts = await c.query(
    `select 'departments' as t, count(*)::int as n from departments
     union all select 'classes', count(*)::int from classes
     union all select 'students', count(*)::int from students
     union all select 'hall_seats', count(*)::int from hall_seats
     union all select 'exams', count(*)::int from exams
     union all select 'exam_candidates', count(*)::int from exam_candidates`
  );
  console.log('counts:', counts.rows.map((r) => `${r.t}=${r.n}`).join(', '));
  const migStatus = await c.query("select migration_name, finished_at is not null as done from _prisma_migrations");
  console.log('migrations:', JSON.stringify(migStatus.rows));
} catch (e) {
  console.error('ERR', e.message);
  process.exit(1);
} finally {
  await c.end();
}