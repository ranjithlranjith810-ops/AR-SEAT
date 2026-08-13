import "dotenv/config";
import pg from "pg";

// Create/ensure the private exam-documents bucket via the postgres superuser
// connection (buckets live in the storage schema). This is independent of any
// JWT and lets Storage serve the bucket; object uploads still use the Storage API.
const directUrl = (process.env.DIRECT_URL ?? "").replace(/[?&]sslmode=[^&]*/, "");
const bucketName = process.env.SUPABASE_STORAGE_BUCKET ?? "exam-documents";

const client = new pg.Client({ connectionString: directUrl, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();

  const exists = await client.query(
    'SELECT 1 FROM storage.buckets WHERE id = $1 AND name = $1',
    [bucketName],
  );
  if (exists.rowCount && exists.rowCount > 0) {
    console.log(`Storage bucket "${bucketName}" already exists.`);
    process.exit(0);
  }

  await client.query(
    `INSERT INTO storage.buckets (id, name, owner, public, file_size_limit, allowed_mime_types)
     VALUES ($1, $1, NULL, false, 52428800, ARRAY['application/pdf'])
     ON CONFLICT (id) DO NOTHING`,
    [bucketName],
  );
  console.log(`Created private storage bucket "${bucketName}".`);
} catch (e) {
  console.error("ERR", e.message);
  process.exit(1);
} finally {
  await client.end();
}