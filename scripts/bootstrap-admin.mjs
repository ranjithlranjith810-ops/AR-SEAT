/**
 * Bootstrap the first ADMIN user for the minimal authentication layer.
 *
 * Reads ADMIN_USERNAME and ADMIN_PASSWORD from the environment and creates (or
 * updates) an ADMIN user with the given username. The password must be at
 * least 8 characters. Runs against the configured DATABASE_URL.
 *
 *   ADMIN_USERNAME=admin ADMIN_PASSWORD='<long-random-password>' npx tsx scripts/bootstrap-admin.mjs
 */
import "dotenv/config";
import { prisma } from "../src/db";
import { createUser } from "../src/phase4/auth/users";

const username = process.env.ADMIN_USERNAME;
const password = process.env.ADMIN_PASSWORD;

if (!username || !password) {
  console.error("ERROR: ADMIN_USERNAME and ADMIN_PASSWORD must be provided.");
  process.exit(1);
}
if (password.length < 8) {
  console.error("ERROR: ADMIN_PASSWORD must be at least 8 characters.");
  process.exit(1);
}

try {
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    console.error(`ERROR: user "${username}" already exists.`);
    process.exit(1);
  }
  const user = await createUser({ username, password, role: "ADMIN" });
  console.log(`Created ADMIN user "${user.username}" (${user.id}).`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
} finally {
  await prisma.$disconnect();
}