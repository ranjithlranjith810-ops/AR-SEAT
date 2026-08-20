import "dotenv/config";
import pg from "pg";
const client = new pg.Client({
  connectionString: process.env.TEST_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
const db = await client.query("SELECT current_database() AS name");
const migs = await client.query(
  "SELECT migration_name, finished_at IS NOT NULL AS finished FROM _prisma_migrations ORDER BY started_at",
);
console.log("db", JSON.stringify(db.rows));
console.log("migrations", JSON.stringify(migs.rows));
await client.end();